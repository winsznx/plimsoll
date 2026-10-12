import { Figure } from "@/components/instruments/figure";
import type { Tranche } from "@/components/instruments/tranche";
import { TrancheRail } from "@/components/instruments/tranche-rail";
import { percentOf } from "@/lib/format";
import { StepConsequences } from "./consequences";
import { REVIEW_STEP, effectiveAmounts, goodsTotal, safeUnits, type WizardContext, type WizardState } from "./model";
import styles from "./wizard.module.css";

/** The escrow as the form currently sizes it: every tranche waits, since nothing is deployed yet. */
export function WizardPreview({ s, ctx, step }: { s: WizardState; ctx: WizardContext; step: number }) {
  const total = goodsTotal(s);
  const amounts = effectiveAmounts(s);
  const tranches: Tranche[] = s.milestones.map((m, i) => ({ ordinal: i, name: m.name.trim() || `Milestone ${i + 1}`, amount: safeUnits(amounts[i] ?? "") ?? 0n, state: "waiting" }));
  const allocated = tranches.reduce((a, t) => a + t.amount, 0n);
  const gap = total - allocated;

  return (
    <aside className={`panel ${styles.preview}`} aria-label="Escrow preview">
      <div className={styles.previewHead}>
        <div className="spread">
          <span className="eyebrow">Escrow total</span>
          <span className="tiny faint">
            {ctx.asset.networkLabel}
            {ctx.asset.isDemo ? " · demo token" : ""}
          </span>
        </div>
        <Figure units={total} code={ctx.asset.code} size="lg" />
      </div>

      <div className={styles.previewSplit}>
        {total > 0n && allocated > 0n ? <TrancheRail tranches={tranches} size="thick" labels legend={false} /> : <div className={styles.railEmpty}>{total > 0n ? "Set milestone amounts" : "Add line items to size the escrow"}</div>}
        <ol className={styles.tranches}>
          {tranches.map((t) => (
            <li key={s.milestones[t.ordinal]?.key ?? t.ordinal}>
              <span className={styles.mTag}>M{t.ordinal + 1}</span>
              <span className={styles.mName}>{t.name}</span>
              <span className={styles.mShare}>{total > 0n && t.amount > 0n ? `${percentOf(t.amount, total).toFixed(1)}%` : ""}</span>
              <Figure units={t.amount} size="sm" />
            </li>
          ))}
        </ol>
        {total > 0n && gap !== 0n ? (
          <p className={`err ${styles.gap}`}>
            {gap > 0n ? "Unallocated" : "Over by"} <Figure units={gap > 0n ? gap : -gap} size="sm" />
          </p>
        ) : null}
      </div>

      <div className={styles.previewBody}>
        <h3 className={styles.previewTitle}>{step === REVIEW_STEP ? "On create" : "This step commits you to"}</h3>
        {step === REVIEW_STEP ? (
          <ul className="consequences">
            <li>Every term goes into the digest both parties sign.</li>
            <li>Economic terms are fixed once the escrow deploys. Changing them needs a bilateral amendment and a redeploy.</li>
          </ul>
        ) : (
          <StepConsequences step={step} s={s} ctx={ctx} />
        )}
      </div>
    </aside>
  );
}
