import {
  Address,
  Asset,
  BASE_FEE,
  Contract,
  FeeBumpTransaction,
  Keypair,
  Operation,
  Transaction,
  TransactionBuilder,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import { CONTRACT_ERRORS, type ChainMilestone, type ChainSnapshot } from "@plimsoll/domain";
import { decodeAgreement, decodeMilestone, scv, toJsonSafe } from "./codec";
import type { NetworkConfig } from "./network";

export type ChainStage = "simulation" | "submission" | "execution";

export class ChainRejectedError extends Error {
  constructor(
    readonly stage: ChainStage,
    readonly contractErrorCode: number | null,
    detail: string,
    readonly txHash: string | null = null,
  ) {
    const known = contractErrorCode !== null ? CONTRACT_ERRORS[contractErrorCode] : undefined;
    super(known ? `${known.code}: ${known.explanation}` : detail);
    this.name = "ChainRejectedError";
  }

  get contractError(): string | null {
    return this.contractErrorCode !== null ? (CONTRACT_ERRORS[this.contractErrorCode]?.code ?? `Contract#${this.contractErrorCode}`) : null;
  }
}

/**
 * Type guards by name, not instanceof: Next.js bundles server code more than once (instrumentation
 * worker vs route handlers), so a shared gateway can throw a class from another module copy.
 */
export function isChainRejected(e: unknown): e is ChainRejectedError {
  return e instanceof Error && e.name === "ChainRejectedError";
}

export function isRpcUnavailable(e: unknown): e is RpcUnavailableError {
  return e instanceof Error && e.name === "RpcUnavailableError";
}

export class RpcUnavailableError extends Error {
  constructor(cause: unknown) {
    super(`Stellar RPC unavailable: ${describeCause(cause)}`, { cause });
    this.name = "RpcUnavailableError";
  }
}

const TRANSPORT_CODES = new Set(["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "ECONNABORTED", "EPIPE", "ERR_NETWORK"]);

/** Network-level failures and HTTP 429/5xx from RPC, found anywhere in the cause chain. */
export function isTransportFailure(e: unknown): boolean {
  let cur: unknown = e;
  for (let depth = 0; cur && depth < 5; depth++) {
    if (!(cur instanceof Error)) return false;
    const err = cur as Error & { code?: string; response?: { status?: number }; status?: number };
    const status = err.response?.status ?? err.status;
    if (err.code && (TRANSPORT_CODES.has(err.code) || err.code.startsWith("UND_ERR"))) return true;
    if (typeof status === "number" && (status === 429 || status >= 500)) return true;
    if (err.name === "TimeoutError" || err.name === "AbortError" || /fetch failed|network error|socket hang up|timed? ?out/i.test(err.message)) return true;
    cur = err.cause;
  }
  return false;
}

/** Network errors from fetch hide the useful part (ECONNRESET, ETIMEDOUT) in nested causes. */
function describeCause(e: unknown): string {
  const parts: string[] = [];
  let cur: unknown = e;
  for (let depth = 0; cur && depth < 4; depth++) {
    if (cur instanceof Error) {
      const code = (cur as Error & { code?: string }).code;
      parts.push(code ? `${cur.message} [${code}]` : cur.message);
      cur = cur.cause;
    } else {
      parts.push(String(cur));
      break;
    }
  }
  return parts.join(" <- ");
}

export interface SubmitResult {
  hash: string;
  status: "SUCCESS" | "PENDING";
  ledger: number | null;
  returnValue: unknown;
}

export interface ChainEvent {
  id: string;
  ledger: number;
  ledgerClosedAt: string;
  txHash: string;
  contractId: string;
  type: string;
  milestoneId: number | null;
  data: Record<string, unknown>;
}

const RESOURCE_FEE_MARGIN_PCT = 15n;
const CONTRACT_ERROR_PATTERN = /Error\(Contract, #(\d+)\)/;

export function parseContractError(text: string): number | null {
  const m = CONTRACT_ERROR_PATTERN.exec(text);
  return m ? Number(m[1]) : null;
}

/**
 * Thin, explicit wrapper over Stellar RPC. Every write goes simulate → assemble → sign →
 * fee-bump → send → poll; every read is a direct ledger-entry lookup, never a cached value.
 */
export class EscrowGateway {
  readonly server: rpc.Server;

  constructor(
    readonly network: NetworkConfig,
    private readonly relayer: Keypair,
  ) {
    this.server = new rpc.Server(network.rpcUrl, { allowHttp: network.rpcUrl.startsWith("http://") });
  }

  get relayerAddress(): string {
    return this.relayer.publicKey();
  }

  /** Only transport failures become RpcUnavailableError; anything else is a real bug and propagates. */
  private async call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (isChainRejected(e) || !isTransportFailure(e)) throw e;
      throw new RpcUnavailableError(e);
    }
  }

  /** Simulates and assembles a contract invocation with `source` as transaction source and signer. */
  async prepareInvocation(opts: { contractId: string; method: string; args: xdr.ScVal[]; source: string }): Promise<Transaction> {
    return this.assemble(opts.source, new Contract(opts.contractId).call(opts.method, ...opts.args));
  }

  /** Builds against the account's current sequence; called again after a restore consumed one. */
  private async build(source: string, op: xdr.Operation): Promise<Transaction> {
    const account = await this.call(() => this.server.getAccount(source));
    return new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: this.network.passphrase }).addOperation(op).setTimeout(300).build();
  }

  /**
   * Simulate, then assemble with a resource-fee margin: a fee bump cannot raise the inner
   * resource fee, so a tight estimate would fail on-chain with the relayer still paying.
   * Since Protocol 23 archived entries are restored inside the invocation itself; the explicit
   * restore below only runs when simulation says the footprint is too large for that.
   */
  private async assemble(source: string, op: xdr.Operation): Promise<Transaction> {
    let tx = await this.build(source, op);
    let sim = await this.call(() => this.server.simulateTransaction(tx));
    if (rpc.Api.isSimulationRestore(sim)) {
      await this.restore(sim.restorePreamble.transactionData.build(), sim.restorePreamble.minResourceFee);
      tx = await this.build(source, op);
      sim = await this.call(() => this.server.simulateTransaction(tx));
    }
    if (rpc.Api.isSimulationError(sim)) {
      throw new ChainRejectedError("simulation", parseContractError(sim.error), sim.error);
    }
    if (!rpc.Api.isSimulationSuccess(sim)) throw new ChainRejectedError("simulation", null, "Archived state could not be restored");
    sim.transactionData.setResourceFee((BigInt(sim.minResourceFee) * (100n + RESOURCE_FEE_MARGIN_PCT)) / 100n);
    return rpc.assembleTransaction(tx, sim).build();
  }

  /** Restores archived entries using the relayer, so long-idle escrows stay usable. */
  private async restore(data: xdr.SorobanTransactionData, minResourceFee: string): Promise<void> {
    const account = await this.call(() => this.server.getAccount(this.relayer.publicKey()));
    const tx = new TransactionBuilder(account, { fee: (Number(BASE_FEE) + Number(minResourceFee)).toString(), networkPassphrase: this.network.passphrase })
      .setSorobanData(data)
      .addOperation(Operation.restoreFootprint({}))
      .setTimeout(300)
      .build();
    tx.sign(this.relayer);
    await this.sendAndPoll(tx);
  }

  /** Simulation only: used to show that the contract itself rejects an action. */
  async simulate(opts: { contractId: string; method: string; args: xdr.ScVal[]; source?: string }): Promise<{ ok: true; result: unknown } | { ok: false; error: ChainRejectedError }> {
    try {
      const tx = await this.prepareInvocation({ ...opts, source: opts.source ?? this.relayer.publicKey() });
      const sim = await this.call(() => this.server.simulateTransaction(tx));
      const ret = rpc.Api.isSimulationSuccess(sim) && sim.result ? scValToNative(sim.result.retval) : null;
      return { ok: true, result: toJsonSafe(ret) };
    } catch (e) {
      if (isChainRejected(e)) return { ok: false, error: e };
      throw e;
    }
  }

  /** Relayer-sourced invocation for permissionless methods (release, refund, TTL maintenance). */
  async invokeAsRelayer(opts: { contractId: string; method: string; args: xdr.ScVal[] }): Promise<SubmitResult> {
    const tx = await this.prepareInvocation({ ...opts, source: this.relayer.publicKey() });
    tx.sign(this.relayer);
    return this.sendAndPoll(tx);
  }

  /** Deploys one escrow instance with its constructor; returns the new contract address. */
  async deployEscrow(opts: { wasmHash: string; constructorArgs: xdr.ScVal[]; salt: Uint8Array }): Promise<SubmitResult & { contractId: string }> {
    const op = Operation.createCustomContract({
      address: Address.fromString(this.relayer.publicKey()),
      wasmHash: Buffer.from(opts.wasmHash, "hex"),
      constructorArgs: opts.constructorArgs,
      salt: Buffer.from(opts.salt),
    });
    const prepared = await this.assemble(this.relayer.publicKey(), op);
    prepared.sign(this.relayer);
    const result = await this.sendAndPoll(prepared);
    if (result.status !== "SUCCESS" || typeof result.returnValue !== "string") {
      throw new ChainRejectedError("execution", null, "Deployment did not return a contract address", result.hash);
    }
    return { ...result, contractId: result.returnValue };
  }

  /** Uploads contract code once; per-deal escrows are then instantiated from the hash. */
  async uploadWasm(wasm: Uint8Array): Promise<string> {
    const prepared = await this.assemble(this.relayer.publicKey(), Operation.uploadContractWasm({ wasm }));
    prepared.sign(this.relayer);
    const result = await this.sendAndPoll(prepared);
    if (typeof result.returnValue !== "string") throw new ChainRejectedError("execution", null, "Upload did not return a wasm hash", result.hash);
    return result.returnValue;
  }

  /** Deploys the Stellar Asset Contract for a classic asset, or returns the existing one. */
  async ensureAssetContract(asset: Asset): Promise<string> {
    const contractId = asset.contractId(this.network.passphrase);
    try {
      await this.server.getContractInstance(contractId);
      return contractId;
    } catch {
      const prepared = await this.assemble(this.relayer.publicKey(), Operation.createStellarAssetContract({ asset }));
      prepared.sign(this.relayer);
      await this.sendAndPoll(prepared);
      return contractId;
    }
  }

  /**
   * Wraps a user-signed transaction in a relayer fee bump. The relayer only sponsors fees;
   * the inner transaction's own signatures carry all authority.
   */
  async submitSponsored(signedInner: Transaction): Promise<SubmitResult> {
    const bump = TransactionBuilder.buildFeeBumpTransaction(this.relayer, (Number(BASE_FEE) * 10).toString(), signedInner, this.network.passphrase);
    bump.sign(this.relayer);
    return this.sendAndPoll(bump);
  }

  async sendAndPoll(tx: Transaction | FeeBumpTransaction): Promise<SubmitResult> {
    const sent = await this.call(() => this.server.sendTransaction(tx));
    if (sent.status === "ERROR" || sent.status === "TRY_AGAIN_LATER") {
      const detail = sent.errorResult ? sent.errorResult.result.type : sent.status;
      throw new ChainRejectedError("submission", null, `Transaction not accepted: ${detail}`, sent.hash);
    }
    const final = await this.call(() => this.server.pollTransaction(sent.hash, { attempts: 30, sleepStrategy: rpc.LinearSleepStrategy }));
    if (final.status === rpc.Api.GetTransactionStatus.SUCCESS) {
      const ret = final.returnValue ? scValToNative(final.returnValue) : null;
      return { hash: sent.hash, status: "SUCCESS", ledger: final.ledger, returnValue: toJsonSafe(ret) };
    }
    if (final.status === rpc.Api.GetTransactionStatus.FAILED) {
      const diag = (final.diagnosticEventsXdr ?? []).map(describeDiagnostic).join(" ");
      throw new ChainRejectedError("execution", parseContractError(diag), `Transaction failed on-chain ${diag}`.trim(), sent.hash);
    }
    return { hash: sent.hash, status: "PENDING", ledger: null, returnValue: null };
  }

  async transactionStatus(hash: string): Promise<{ status: "SUCCESS" | "FAILED" | "NOT_FOUND"; ledger: number | null }> {
    const res = await this.call(() => this.server.getTransaction(hash));
    if (res.status === rpc.Api.GetTransactionStatus.SUCCESS) return { status: "SUCCESS", ledger: res.ledger };
    if (res.status === rpc.Api.GetTransactionStatus.FAILED) return { status: "FAILED", ledger: res.ledger };
    return { status: "NOT_FOUND", ledger: null };
  }

  private dataKey(contractId: string, key: xdr.ScVal): xdr.LedgerKey {
    return xdr.LedgerKey.contractData(
      new xdr.LedgerKeyContractData({
        contract: new Address(contractId).toScAddress(),
        key,
        durability: xdr.ContractDataDurability.persistent,
      }),
    );
  }

  private async readEntries(contractId: string, keys: xdr.ScVal[]): Promise<{ values: Map<string, xdr.ScVal>; ledger: number }> {
    const values = new Map<string, xdr.ScVal>();
    if (keys.length === 0) {
      const latest = await this.call(() => this.server.getLatestLedger());
      return { values, ledger: latest.sequence };
    }
    const res = await this.call(() => this.server.getLedgerEntries(...keys.map((k) => this.dataKey(contractId, k))));
    for (const entry of res.entries) {
      if (entry.val.type !== "contractData") continue;
      const data = entry.val.contractData;
      values.set(data.key.toXDR("base64"), data.val);
    }
    return { values, ledger: res.latestLedger };
  }

  /** Independent readback of escrow state straight from ledger entries and the token contract. */
  async readSnapshot(contractId: string, asset: { code: string; issuer: string }): Promise<ChainSnapshot> {
    const agreementKey = scv.enumKey("Agreement");
    const first = await this.readEntries(contractId, [agreementKey]);
    const agreementVal = first.values.get(agreementKey.toXDR("base64"));
    if (!agreementVal) throw new ChainRejectedError("execution", null, `No agreement state found for ${contractId}`);
    const agreement = decodeAgreement(agreementVal);

    const milestoneKeys = Array.from({ length: agreement.milestoneCount }, (_, i) => scv.enumKey("Milestone", scv.u32(i)));
    const second = await this.readEntries(contractId, milestoneKeys);
    const milestones = milestoneKeys.map((k) => {
      const v = second.values.get(k.toXDR("base64"));
      if (!v) throw new ChainRejectedError("execution", null, "Milestone entry missing or archived");
      return decodeMilestone(v);
    });

    const approvalKeys = milestones.flatMap((m) => m.approvers.map((a) => ({ m: m.id, a, key: scv.enumKey("Approval", scv.u32(m.id), scv.address(a)) })));
    const [third, balance] = await Promise.all([
      this.readEntries(contractId, approvalKeys.map((x) => x.key)),
      this.call(() => this.server.getSACBalance(contractId, new Asset(asset.code, asset.issuer), this.network.passphrase)),
    ]);

    const withApprovals: ChainMilestone[] = milestones.map((m) => ({
      ...m,
      approvals: approvalKeys
        .filter((x) => x.m === m.id)
        .filter((x) => {
          const v = third.values.get(x.key.toXDR("base64"));
          if (!v || v.type !== "scvBytes" || m.evidenceDigest === null) return false;
          return Buffer.from(v.bytes.toBytes()).toString("hex") === m.evidenceDigest;
        })
        .map((x) => x.a),
    }));

    return {
      contractId,
      ledger: Math.max(first.ledger, second.ledger, third.ledger),
      readAt: new Date().toISOString(),
      agreement,
      milestones: withApprovals,
      balance: BigInt(balance.balanceEntry?.amount ?? "0"),
    };
  }

  async latestLedger(): Promise<number> {
    return (await this.call(() => this.server.getLatestLedger())).sequence;
  }

  /**
   * Pulls contract events for up to 25 escrows per request. RPC scans at most 10,000 ledgers per
   * call and returns a cursor at the end of that window even when it found nothing, so paging
   * continues until the cursor reaches the tip. A start older than RPC retention is clamped and
   * reported as a gap, which callers must cover with a full ledger-state readback.
   */
  async fetchEvents(contractIds: string[], startLedger: number): Promise<{ events: ChainEvent[]; latestLedger: number; gap: boolean }> {
    const health = await this.call(() => this.server.getHealth());
    const from = Math.max(startLedger, health.oldestLedger);
    const chunks: string[][] = [];
    for (let i = 0; i < contractIds.length; i += 5) chunks.push(contractIds.slice(i, i + 5));
    const out: ChainEvent[] = [];
    let latestLedger = health.latestLedger;
    for (let i = 0; i < chunks.length; i += 5) {
      const filters = chunks.slice(i, i + 5).map((ids) => ({ type: "contract" as const, contractIds: ids }));
      let cursor: string | undefined;
      for (let page = 0; page < 1_000; page++) {
        const res = await this.call(() => this.server.getEvents(cursor ? { filters, cursor, limit: EVENT_PAGE } : { filters, startLedger: from, limit: EVENT_PAGE }));
        latestLedger = res.latestLedger;
        for (const e of res.events) out.push(decodeEvent(e));
        const reachedTip = res.events.length < EVENT_PAGE && (cursorLedger(res.cursor) ?? res.latestLedger) >= res.latestLedger;
        if (reachedTip || !res.cursor || res.cursor === cursor) break;
        cursor = res.cursor;
      }
    }
    return { events: out, latestLedger, gap: startLedger < health.oldestLedger };
  }
}

const EVENT_PAGE = 200;

/** Event cursors are "<toid>-<index>"; a TOID keeps the ledger sequence in its upper 32 bits. */
export function cursorLedger(cursor: string | undefined): number | null {
  const toid = cursor?.split("-")[0];
  if (!toid || !/^\d+$/.test(toid)) return null;
  return Number(BigInt(toid) >> 32n);
}

function describeDiagnostic(e: xdr.DiagnosticEvent): string {
  const body = e.event.body;
  if (body.type !== "v0") return "";
  return [...body.v0.topics, body.v0.data].map((v) => JSON.stringify(toJsonSafe(scValToNative(v)))).join(" ");
}

function decodeEvent(e: rpc.Api.EventResponse): ChainEvent {
  const topics = e.topic.map((t) => scValToNative(t) as unknown);
  const type = String(topics[0] ?? "unknown");
  const milestoneId = typeof topics[2] === "number" ? topics[2] : null;
  const data = toJsonSafe(scValToNative(e.value));
  return {
    id: e.id,
    ledger: e.ledger,
    ledgerClosedAt: e.ledgerClosedAt,
    txHash: e.txHash,
    contractId: e.contractId?.contractId() ?? "",
    type,
    milestoneId,
    data: data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : { value: data },
  };
}

export function transactionFromXdr(xdrBase64: string, passphrase: string): Transaction {
  const tx = TransactionBuilder.fromXDR(xdrBase64, passphrase);
  if (tx instanceof FeeBumpTransaction) throw new TypeError("Expected an inner transaction, received a fee bump");
  return tx;
}

export { Keypair };
