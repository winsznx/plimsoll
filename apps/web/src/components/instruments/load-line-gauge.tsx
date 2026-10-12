import { formatAmount } from "@plimsoll/domain";
import styles from "./instruments.module.css";
import { STATE_LABEL, type Tranche } from "./tranche";

const DECK = 24;
const KEEL = 236;
const LEFT = 46;
const RIGHT = 154;
const DEPTH = KEEL - DECK;

const FILL: Record<Tranche["state"], string> = {
  released: "url(#ll-gone)",
  refunded: "url(#ll-refunded)",
  eligible: "var(--hull)",
  held: "url(#ll-held)",
  disputed: "url(#ll-held)",
  waiting: "color-mix(in srgb, var(--hull) 16%, var(--surface))",
};

/**
 * The escrow drawn as a hull. Tranches stack from the deck down in milestone order, so the first
 * to pay out sits at the top; what has left the escrow is drawn above the load line, what is
 * still held below it. Heights are exact shares of the agreement total.
 */
export function LoadLineGauge({ tranches, funded, total, code }: { tranches: Tranche[]; funded: bigint; total: bigint; code: string }) {
  const sum = total > 0n ? total : 1n;
  const h = (amount: bigint) => (Number((amount * 100_000n) / sum) / 100_000) * DEPTH;
  let y = DECK;
  const bands = tranches.map((t) => {
    const top = y;
    const height = h(t.amount);
    y += height;
    return { t, top, height };
  });
  const gone = tranches.filter((t) => t.state === "released" || t.state === "refunded").reduce((a, t) => a + t.amount, 0n);
  const waterY = DECK + h(gone);
  const unfundedHeight = h(total - funded);
  const held = total - gone;
  const label = `Escrow load line: ${formatAmount(held)} ${code} below the line of ${formatAmount(total)}; ${tranches.map((t) => `${t.name} ${STATE_LABEL[t.state]}`).join(", ")}`;
  const hullPath = `M${LEFT} ${DECK} L${LEFT} ${KEEL - 34} Q${LEFT} ${KEEL} 100 ${KEEL} Q${RIGHT} ${KEEL} ${RIGHT} ${KEEL - 34} L${RIGHT} ${DECK}`;

  return (
    <svg className={styles.hull} viewBox="0 0 220 260" role="img" aria-label={label}>
      <defs>
        <clipPath id="ll-clip">
          <path d={`${hullPath} Z`} />
        </clipPath>
        <pattern id="ll-held" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="8" height="8" fill="var(--held)" />
          <rect width="3" height="8" fill="color-mix(in srgb, var(--held) 70%, #fff)" />
        </pattern>
        <pattern id="ll-gone" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" fill="var(--signal-soft)" />
          <rect width="2" height="6" fill="var(--signal)" />
        </pattern>
        <pattern id="ll-refunded" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
          <rect width="6" height="6" fill="var(--surface-2)" />
          <rect width="1.5" height="6" fill="var(--line-2)" />
        </pattern>
      </defs>

      <g clipPath="url(#ll-clip)">
        <rect x={LEFT} y={DECK} width={RIGHT - LEFT} height={DEPTH} fill="var(--surface-2)" />
        {bands.map(({ t, top, height }) => (
          <rect key={t.ordinal} x={LEFT} y={top} width={RIGHT - LEFT} height={Math.max(height - 1.5, 0.5)} fill={FILL[t.state]} />
        ))}
        {unfundedHeight > 0 ? <rect x={LEFT} y={KEEL - unfundedHeight} width={RIGHT - LEFT} height={unfundedHeight} fill="var(--surface)" opacity="0.82" /> : null}
      </g>
      <path d={hullPath} fill="none" stroke="var(--ink)" strokeWidth="2.5" strokeLinejoin="round" />

      {bands.map(({ t, top, height }) =>
        height >= 14 ? (
          <text key={`l${t.ordinal}`} x={RIGHT + 10} y={top + height / 2 + 3.5} fontSize="9.5" fill="var(--ink-2)">
            {t.ordinal + 1} · {formatAmount(t.amount, { minFraction: 0 })}
          </text>
        ) : null,
      )}
      {bands.slice(1).map(({ t, top }) => (
        <line key={`t${t.ordinal}`} x1={LEFT - 10} x2={LEFT} y1={top} y2={top} stroke="var(--ink-3)" strokeWidth="1.2" />
      ))}

      <line x1={6} x2={214} y1={waterY} y2={waterY} stroke="var(--signal)" strokeWidth="3" />
      <circle cx={100} cy={waterY} r="15" fill="var(--surface)" stroke="var(--ink)" strokeWidth="2.5" />
      <line x1={82} x2={118} y1={waterY} y2={waterY} stroke="var(--signal)" strokeWidth="3" />
      <text x={6} y={DECK - 8} fontSize="9" fill="var(--ink-3)">
        {formatAmount(total, { minFraction: 0 })} {code}
      </text>
    </svg>
  );
}
