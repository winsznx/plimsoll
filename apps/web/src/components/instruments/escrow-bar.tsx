import { formatAmount } from "@plimsoll/domain";
import styles from "./escrow-bar.module.css";

/**
 * A deal's escrow position from list-level figures only: what has left the escrow (released or
 * refunded), what it still holds, and what is not yet funded. List rows carry no milestones, so
 * this stands in for a per-tranche rail; the cockpit draws the real split.
 */
export function EscrowBar({ total, funded, escrow }: { total: string; funded: string | null; escrow: string | null }) {
  const t = BigInt(total);
  const f = funded === null ? 0n : BigInt(funded);
  const held = escrow === null ? 0n : BigInt(escrow);
  const out = f > held ? f - held : 0n;
  const unfunded = t > f ? t - f : 0n;
  const scale = t > 0n ? t : 1n;
  const share = (part: bigint) => Number((part * 1000n) / scale);
  const label = `Out of escrow ${formatAmount(out)}, in escrow ${formatAmount(held)}, unfunded ${formatAmount(unfunded)}, of ${formatAmount(t)}`;
  return (
    <div className={styles.bar} role="img" aria-label={label} title={label}>
      {out > 0n ? <span className={styles.out} style={{ flexGrow: share(out) }} /> : null}
      {held > 0n ? <span className={styles.held} style={{ flexGrow: share(held) }} /> : null}
      {unfunded > 0n || t === 0n ? <span className={styles.unfunded} style={{ flexGrow: Math.max(share(unfunded), 1) }} /> : null}
    </div>
  );
}

export function EscrowLegend() {
  return (
    <ul className={styles.legend} aria-hidden>
      <li>
        <i className={styles.out} />
        Out
      </li>
      <li>
        <i className={styles.held} />
        In escrow
      </li>
      <li>
        <i className={styles.unfunded} />
        Unfunded
      </li>
    </ul>
  );
}
