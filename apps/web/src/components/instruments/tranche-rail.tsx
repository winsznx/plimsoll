import { formatAmount } from "@plimsoll/domain";
import styles from "./instruments.module.css";
import { STATE_LABEL, type Tranche } from "./tranche";

/** One bar split by tranche, sized by amount: yellow released, hatched red held, ringed ready, pale waiting. */
export function TrancheRail({ tranches, size = "thin", labels = false, legend = false }: { tranches: Tranche[]; size?: "thin" | "thick"; labels?: boolean; legend?: boolean }) {
  const total = tranches.reduce((a, t) => a + t.amount, 0n) || 1n;
  const summary = tranches.map((t) => `${t.name}: ${STATE_LABEL[t.state]} ${formatAmount(t.amount)}`).join("; ");
  const states = [...new Set(tranches.map((t) => t.state))];
  return (
    <div>
      <div className={`${styles.rail} ${styles[size]}`} role="img" aria-label={summary}>
        {tranches.map((t) => (
          <div key={t.ordinal} className={`${styles.seg} ${styles[t.state]} ${t.fresh ? styles.fresh : ""}`} style={{ flexGrow: Number((t.amount * 1000n) / total) }} title={`${t.name} · ${STATE_LABEL[t.state]} · ${formatAmount(t.amount)}`}>
            {labels ? <span>{formatAmount(t.amount, { minFraction: 0 })}</span> : null}
          </div>
        ))}
      </div>
      {legend ? (
        <ul className={styles.legend} style={{ listStyle: "none", padding: 0, margin: "10px 0 0" }}>
          {states.map((s) => (
            <li key={s}>
              <i className={`${styles.seg} ${styles[s]}`} />
              {STATE_LABEL[s]}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
