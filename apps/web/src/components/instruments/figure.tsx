import { formatAmount } from "@plimsoll/domain";
import styles from "./instruments.module.css";

/** A money figure as an instrument reads it: whole units large, cents raised, asset code beside. */
export function Figure({ units, code, size = "lg" }: { units: string | bigint; code?: string; size?: "xl" | "lg" | "md" | "sm" }) {
  const [whole, cents = "00"] = formatAmount(BigInt(units)).split(".");
  return (
    <span className={`${styles.figure} ${styles[size]}`}>
      {code ? <span className={styles.code}>{code}</span> : null}
      <span>
        {whole}
        <sup>.{cents}</sup>
      </span>
    </span>
  );
}
