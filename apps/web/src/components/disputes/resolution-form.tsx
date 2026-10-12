"use client";

import { useState } from "react";
import { formatAmount, parseAmount } from "@plimsoll/domain";
import { units } from "@/lib/format";
import { ChainActionButton } from "../chain-action";
import { SplitBar } from "./split-bar";
import styles from "./disputes.module.css";

interface Party {
  name: string;
  address: string;
}

interface Props {
  dealId: string;
  milestoneOrdinal: number;
  amount: string;
  assetCode: string;
  networkLabel: string;
  buyer: Party;
  payee: Party;
}

type Parsed = { units: bigint | null; error: string | null };

function parse(value: string): Parsed {
  if (!value.trim()) return { units: null, error: null };
  try {
    return { units: parseAmount(value), error: null };
  } catch {
    return { units: null, error: "Digits only, at most 7 decimal places." };
  }
}

const plain = (v: bigint): string => formatAmount(v, { grouping: false, minFraction: 0 });

const MIN_RATIONALE = 10;

export function ResolutionForm({ dealId, milestoneOrdinal, amount, assetCode, networkLabel, buyer, payee }: Props) {
  const [toBuyer, setToBuyer] = useState("");
  const [toPayee, setToPayee] = useState("");
  const [rationale, setRationale] = useState("");
  const total = BigInt(amount);
  const b = parse(toBuyer);
  const p = parse(toPayee);
  const allocated = (b.units ?? 0n) + (p.units ?? 0n);
  const remaining = total - allocated;
  const complete = b.units !== null && p.units !== null && remaining === 0n;
  const rationaleOk = rationale.trim().length >= MIN_RATIONALE;

  const disabledReason = b.error || p.error ? "Fix the amount format first." : b.units === null || p.units === null ? "Enter both amounts. Use 0 for a side that gets nothing." : remaining > 0n ? `Allocate the remaining ${units(remaining, assetCode)}.` : remaining < 0n ? `Over the frozen amount by ${units(-remaining, assetCode)}.` : !rationaleOk ? `Rationale needs at least ${MIN_RATIONALE} characters.` : null;

  const fill = (buyerShare: bigint) => {
    setToBuyer(plain(buyerShare));
    setToPayee(plain(total - buyerShare));
  };

  return (
    <div className={styles.form}>
      <SplitBar total={total} code={assetCode} buyer={{ name: buyer.name, address: buyer.address, units: b.units ?? 0n }} payee={{ name: payee.name, address: payee.address, units: p.units ?? 0n }} />
      <p className={`${styles.tally} ${remaining === 0n && complete ? styles.tallyOk : remaining < 0n ? styles.off : ""}`} aria-live="polite">
        {remaining > 0n ? `Unallocated ${units(remaining, assetCode)}` : remaining < 0n ? `Over by ${units(-remaining, assetCode)}` : complete ? `Allocates exactly ${units(total, assetCode)}` : `Frozen ${units(total, assetCode)}`}
      </p>

      <div className="form-grid">
        <label className="field">
          <span className="label">To buyer ({assetCode})</span>
          <input className="input mono" inputMode="decimal" autoComplete="off" value={toBuyer} onChange={(e) => setToBuyer(e.target.value)} aria-invalid={Boolean(b.error)} placeholder="0.00" />
          <span className="hint">{buyer.name}</span>
          {b.error ? <span className="err">{b.error}</span> : null}
        </label>
        <label className="field">
          <span className="label">To payee ({assetCode})</span>
          <input className="input mono" inputMode="decimal" autoComplete="off" value={toPayee} onChange={(e) => setToPayee(e.target.value)} aria-invalid={Boolean(p.error)} placeholder="0.00" />
          <span className="hint">{payee.name}</span>
          {p.error ? <span className="err">{p.error}</span> : null}
        </label>
      </div>
      <div className="btn-group">
        <button type="button" className="btn sm" onClick={() => fill(total)}>
          All to buyer
        </button>
        <button type="button" className="btn sm" onClick={() => fill(0n)}>
          All to payee
        </button>
      </div>

      <label className="field">
        <span className="label">Rationale</span>
        <textarea className="input" value={rationale} onChange={(e) => setRationale(e.target.value)} minLength={MIN_RATIONALE} maxLength={4000} />
        <span className="hint">Shown to both parties with the resolution.</span>
      </label>

      <p className="tiny faint">{networkLabel} · both transfers settle in one contract call, which rejects any split that doesn&apos;t total the frozen amount.</p>
      <ChainActionButton
        dealId={dealId}
        input={() => (complete && rationaleOk && b.units !== null && p.units !== null ? { action: "resolve_dispute", milestoneOrdinal, toBuyer: plain(b.units), toPayee: plain(p.units), rationale: rationale.trim() } : null)}
        label="Review and sign resolution"
        tone="primary"
        assetCode={assetCode}
        disabledReason={disabledReason}
      />
    </div>
  );
}
