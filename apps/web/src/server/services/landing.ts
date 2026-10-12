import { and, asc, eq } from "drizzle-orm";
import { chainConfig } from "../env";
import { explorer, isChainConfigured, network } from "../chain";
import { db, ensureMigrated, schema } from "../db/client";
import { loadSnapshot } from "./snapshot";

const SAMPLE_REFERENCE = "PL-2048";

type TxKind = (typeof schema.CHAIN_TX_KINDS)[number];

function describeTx(kind: TxKind, actor: string, milestone: string | null, buyer: string, supplier: string): string {
  const on = milestone ? ` for ${milestone}` : "";
  switch (kind) {
    case "deploy":
      return "Escrow contract deployed with the frozen terms digest";
    case "accept":
      return actor === buyer ? "Buyer accepted the terms on chain" : actor === supplier ? "Supplier accepted the terms on chain" : "Terms accepted on chain";
    case "fund":
      return "Buyer funded the escrow in full";
    case "anchor":
      return `Evidence digest anchored${on}`;
    case "approve":
      return `Appointed approver signed${on}`;
    case "release":
      return `Released to the payee${on}`;
    case "revoke":
      return `Approval revoked${on}`;
    case "dispute":
      return `Dispute opened${on}`;
    case "resolve":
      return `Resolver allocated funds${on}`;
    case "refund":
      return `Refunded to buyer${on}`;
    case "cancel":
      return "Agreement cancelled";
    case "ttl":
      return "Contract storage lifetime extended";
  }
}

export interface ReplayEntry {
  kind: TxKind | "finding";
  at: string;
  label: string;
  detail: string | null;
  ledger: number | null;
  amount: string | null;
  txHash: string | null;
  explorerUrl: string | null;
}

/**
 * Public read of the seeded sample agreement for the landing page. Only confirmed chain
 * transactions and open blocking findings of a sample deal; never a customer deal.
 */
export async function sampleReplay() {
  await ensureMigrated();
  const samples = await db().select().from(schema.deals).where(eq(schema.deals.isSample, true));
  const deal = samples.find((d) => d.reference === SAMPLE_REFERENCE && d.escrowContractId) ?? samples.find((d) => d.escrowContractId);
  if (!deal) return null;

  const [txs, findings] = await Promise.all([
    db()
      .select()
      .from(schema.chainTransactions)
      .where(and(eq(schema.chainTransactions.dealId, deal.id), eq(schema.chainTransactions.status, "confirmed")))
      .orderBy(asc(schema.chainTransactions.createdAt)),
    db()
      .select()
      .from(schema.discrepancies)
      .where(and(eq(schema.discrepancies.dealId, deal.id), eq(schema.discrepancies.active, true), eq(schema.discrepancies.state, "open"), eq(schema.discrepancies.severity, "blocking"))),
  ]);

  const terms = deal.terms;
  const milestoneName = (ordinal: number | null): string | null => {
    if (ordinal === null) return null;
    const m = terms.milestones.find((x) => x.ordinal === ordinal);
    return m ? `milestone ${ordinal + 1} (${m.name})` : `milestone ${ordinal + 1}`;
  };
  const snap = deal.chainSnapshot ? loadSnapshot(deal.chainSnapshot) : null;
  const settled = new Set(snap?.milestones.filter((m) => m.status !== "Open" && m.status !== "Disputed").map((m) => m.id) ?? []);

  const entries: ReplayEntry[] = [
    ...txs.map((t) => {
      const label = describeTx(t.kind, t.actorAddress, milestoneName(t.milestoneOrdinal), terms.buyer.address, terms.supplier.address);
      return {
        kind: t.kind,
        at: t.createdAt.toISOString(),
        label: label.charAt(0).toUpperCase() + label.slice(1),
        detail: null,
        ledger: t.ledger,
        amount: t.amountUnits === null || (t.kind !== "fund" && t.kind !== "release" && t.kind !== "refund") ? null : String(t.amountUnits),
        txHash: t.txHash,
        explorerUrl: t.txHash ? explorer("tx", t.txHash) : null,
      };
    }),
    ...findings.map((f) => {
      const blocked = terms.milestones.filter((m) => {
        const required: readonly string[] = m.requiredDocuments;
        return !settled.has(m.ordinal) && (required.includes(f.actual.documentType) || required.includes(f.expected.documentType));
      });
      return {
        kind: "finding" as const,
        at: f.firstSeenAt.toISOString(),
        label: f.message,
        detail: blocked.length > 0 ? `Blocks evidence for ${blocked.map((m) => `milestone ${m.ordinal + 1} (${m.name})`).join(", ")} until corrected or waived.` : null,
        ledger: null,
        amount: null,
        txHash: null,
        explorerUrl: null,
      };
    }),
  ];
  entries.sort((a, b) => a.at.localeCompare(b.at));

  return {
    reference: deal.reference,
    publicRef: deal.publicRef,
    title: deal.title,
    poNumber: terms.poNumber,
    buyer: terms.buyer.legalName,
    supplier: terms.supplier.legalName,
    incoterm: `${terms.goods.incoterm.rule} ${terms.goods.incoterm.namedPlace}`,
    route: `${terms.goods.originPort} to ${terms.goods.destinationPort}`,
    assetCode: terms.asset.code,
    total: terms.totalUnits,
    contractId: deal.escrowContractId,
    contractExplorerUrl: deal.escrowContractId ? explorer("contract", deal.escrowContractId) : null,
    chain: snap ? { status: snap.agreement.status, funded: String(snap.agreement.funded), released: String(snap.agreement.released), balance: String(snap.balance), ledger: snap.ledger, readAt: snap.readAt } : null,
    milestones: terms.milestones.map((m) => ({ ordinal: m.ordinal, name: m.name, amount: m.amountUnits, quorum: m.quorum, status: snap?.milestones.find((x) => x.id === m.ordinal)?.status ?? null })),
    entries,
  };
}

export type SampleReplay = NonNullable<Awaited<ReturnType<typeof sampleReplay>>>;

/** Deployment identifiers anyone can check on the explorer; null when testnet bootstrap has not run. */
export function deploymentProof() {
  if (!isChainConfigured()) return null;
  const cfg = chainConfig();
  const net = network();
  return {
    network: net.label,
    passphrase: net.passphrase,
    wasmHash: cfg.wasmHash,
    tokenContractId: cfg.asset.contractId,
    tokenExplorerUrl: explorer("contract", cfg.asset.contractId),
    assetCode: cfg.asset.code,
    assetIsDemo: cfg.asset.isDemo,
  };
}

export function networkBadge(): string {
  return isChainConfigured() ? network().label.toUpperCase() : "CHAIN NOT CONFIGURED";
}
