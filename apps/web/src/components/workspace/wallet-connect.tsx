"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { connectFreighter, signLinkMessage } from "@/lib/freighter";
import { shortAddress } from "@/lib/format";
import { useToast } from "@/components/toast";
import styles from "./workspace.module.css";

type Step = { kind: "idle" } | { kind: "working"; text: string } | { kind: "error"; message: string };

interface Props {
  networkPassphrase: string;
  networkLabel: string;
}

/**
 * Proves control of a Freighter account by signing a one-time server challenge. Only the public
 * address and the signature leave the browser; Freighter never shares the secret key.
 */
export function WalletConnect({ networkPassphrase, networkLabel }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [step, setStep] = useState<Step>({ kind: "idle" });

  const connect = async () => {
    try {
      setStep({ kind: "working", text: "Waiting for Freighter access…" });
      const address = await connectFreighter(networkPassphrase);
      setStep({ kind: "working", text: `Requesting a link challenge for ${shortAddress(address)}…` });
      const { message } = await api<{ message: string }>("/wallets/challenge", { body: { address } });
      setStep({ kind: "working", text: "Sign the link message in Freighter…" });
      const signature = await signLinkMessage(message, networkPassphrase, address);
      setStep({ kind: "working", text: "Verifying signature…" });
      await api<{ ok: true }>("/wallets/link", { body: { address, message, signature } });
      setStep({ kind: "idle" });
      toast(`Wallet ${shortAddress(address)} linked`);
      router.refresh();
    } catch (e) {
      setStep({ kind: "error", message: errorMessage(e) });
    }
  };

  return (
    <div className="stack tight">
      <div className="row wrap">
        <button type="button" className="btn primary" onClick={connect} disabled={step.kind === "working"}>
          {step.kind === "working" ? "Connecting…" : "Connect Freighter"}
        </button>
        <span className="tiny faint">Set Freighter to {networkLabel}.</span>
      </div>
      <p className={`${styles.statusLine} ${step.kind === "error" ? styles.error : ""}`} role="status" aria-live="polite">
        {step.kind === "working" ? step.text : step.kind === "error" ? step.message : null}
      </p>
    </div>
  );
}
