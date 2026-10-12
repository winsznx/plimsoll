import { formatAmount } from "@plimsoll/domain";
import { percentOf, shortAddress } from "@/lib/format";
import { Figure } from "../instruments/figure";
import styles from "./disputes.module.css";

interface Side {
  name: string;
  address?: string;
  units: bigint;
}

/**
 * The frozen tranche split in two: refunded to the buyer on the left, paid to the payee on the
 * right, anything not yet allocated stays hatched red because it is still held.
 */
export function SplitBar({ total, buyer, payee, code }: { total: bigint; buyer: Side; payee: Side; code: string }) {
  const allocated = buyer.units + payee.units;
  const over = allocated > total;
  const scale = over ? allocated : total > 0n ? total : 1n;
  const share = (v: bigint) => Number((v * 1000n) / scale);
  const open = over ? 0n : total - allocated;
  const label = `Split of ${formatAmount(total)} ${code}: ${formatAmount(buyer.units)} to ${buyer.name}, ${formatAmount(payee.units)} to ${payee.name}${open > 0n ? `, ${formatAmount(open)} unallocated` : ""}${over ? `, over by ${formatAmount(allocated - total)}` : ""}`;
  return (
    <div className={styles.split}>
      <div className={`${styles.splitBar} ${over ? styles.splitOver : ""}`} role="img" aria-label={label}>
        {buyer.units > 0n ? <span className={styles.toBuyer} style={{ flexGrow: share(buyer.units) }} /> : null}
        {open > 0n ? <span className={styles.unallocated} style={{ flexGrow: share(open) }} /> : null}
        {payee.units > 0n ? <span className={styles.toPayee} style={{ flexGrow: share(payee.units) }} /> : null}
      </div>
      <div className={styles.splitLegend}>
        <div>
          <span className={styles.splitLabel}>
            <i className={styles.toBuyer} aria-hidden />
            To buyer · {percentOf(buyer.units, total)}%
          </span>
          <Figure units={buyer.units} size="md" />
          <span className={styles.splitWho}>
            {buyer.name}
            {buyer.address ? <span className="mono"> {shortAddress(buyer.address)}</span> : null}
          </span>
        </div>
        <div>
          <span className={styles.splitLabel}>
            To payee · {percentOf(payee.units, total)}%
            <i className={styles.toPayee} aria-hidden />
          </span>
          <Figure units={payee.units} size="md" />
          <span className={styles.splitWho}>
            {payee.name}
            {payee.address ? <span className="mono"> {shortAddress(payee.address)}</span> : null}
          </span>
        </div>
      </div>
    </div>
  );
}
