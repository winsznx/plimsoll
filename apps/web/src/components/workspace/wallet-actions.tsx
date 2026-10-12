"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, errorMessage, newIdempotencyKey } from "@/lib/api";
import { signWithFreighter } from "@/lib/freighter";
import { Drop, LinkSimple } from "@phosphor-icons/react";
import { useToast } from "@/components/toast";
import styles from "./workspace.module.css";

export interface WalletState {
  exists: boolean;
  trustline: boolean;
}

interface Props {
  address: string;
  isDemoCustody: boolean;
  networkPassphrase: string;
  explorerBase: string | null;
  assetCode: string;
  /** Null when RPC could not be read; actions stay available but nothing is assumed. */
  state: WalletState | null;
  faucet: { amountLabel: string; blocked: string | null } | null;
}

type Phase = { kind: "idle" } | { kind: "busy"; text: string } | { kind: "done"; text: string; txHash: string } | { kind: "error"; message: string };

function trustlineBlocked(p: Props): string | null {
  if (p.isDemoCustody) return "Demo custody signs deal actions on the server only. Add trustlines from your own wallet.";
  if (p.state?.exists === false) return "Account not on the network yet. Fund it with Friendbot first.";
  if (p.state?.trustline) return `${p.assetCode} trustline in place.`;
  return null;
}

export function WalletActions(props: Props) {
  const { address, networkPassphrase, explorerBase, assetCode, state, faucet } = props;
  const router = useRouter();
  const toast = useToast();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const busy = phase.kind === "busy";
  const trustBlock = trustlineBlocked(props);
  const faucetBlock = faucet ? (faucet.blocked ?? (state && !state.trustline ? `Add the ${assetCode} trustline first.` : null)) : null;

  const addTrustline = async () => {
    try {
      setPhase({ kind: "busy", text: "Preparing trustline transaction…" });
      const { xdr } = await api<{ xdr: string; networkPassphrase: string }>("/wallets/trustline", { body: { address } });
      setPhase({ kind: "busy", text: "Review and sign the change-trust operation in Freighter…" });
      const signedXdr = await signWithFreighter(xdr, networkPassphrase, address);
      setPhase({ kind: "busy", text: "Submitting and waiting for the ledger…" });
      const { txHash } = await api<{ txHash: string }>("/wallets/submit", { body: { signedXdr } });
      setPhase({ kind: "done", text: `${assetCode} trustline confirmed on-chain.`, txHash });
      toast(`${assetCode} trustline added`);
      router.refresh();
    } catch (e) {
      setPhase({ kind: "error", message: errorMessage(e) });
    }
  };

  const requestTokens = async () => {
    try {
      setPhase({ kind: "busy", text: `Requesting ${assetCode} from the testnet issuer…` });
      const { txHash } = await api<{ txHash: string }>("/wallets/faucet", { body: { address }, idempotencyKey: newIdempotencyKey() });
      setPhase({ kind: "done", text: `Demo tokens confirmed on-chain.`, txHash });
      toast(`${assetCode} demo tokens received`);
      router.refresh();
    } catch (e) {
      setPhase({ kind: "error", message: errorMessage(e) });
    }
  };

  return (
    <div className="stack tight">
      <div className="btn-group">
        <button type="button" className="btn sm" onClick={addTrustline} disabled={busy || trustBlock !== null}>
          <LinkSimple aria-hidden />
          Add {assetCode} trustline
        </button>
        {faucet ? (
          <button type="button" className="btn sm" onClick={requestTokens} disabled={busy || faucetBlock !== null}>
            <Drop aria-hidden />
            Get demo tokens
          </button>
        ) : null}
      </div>
      {trustBlock ? <p className="why-not">{trustBlock}</p> : null}
      {faucet ? (faucetBlock ? <p className="why-not">{faucetBlock}</p> : <p className="tiny faint">Sends {faucet.amountLabel} from the testnet issuer. Demo token, not USDC.</p>) : null}
      <p className={styles.statusLine} role="status" aria-live="polite">
        {phase.kind === "busy" ? phase.text : null}
        {phase.kind === "error" ? <span style={{ color: "var(--alert)" }}>{phase.message}</span> : null}
        {phase.kind === "done" ? (
          <span className={styles.ok}>
            {phase.text}{" "}
            {explorerBase ? (
              <a className="ext mono" href={`${explorerBase}/tx/${phase.txHash}`} target="_blank" rel="noreferrer">
                tx {phase.txHash.slice(0, 8)}
              </a>
            ) : (
              <span className="mono">tx {phase.txHash.slice(0, 8)}</span>
            )}
          </span>
        ) : null}
      </p>
    </div>
  );
}
