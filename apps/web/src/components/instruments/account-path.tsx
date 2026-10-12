import styles from "./instruments.module.css";

/** A movement written as the ledger sees it: source account, arrow, destination account. */
export function AccountPath({ from, to, held = false }: { from: string; to: string; held?: boolean }) {
  return (
    <span className={styles.path}>
      <span className={styles.tag}>{from}</span>
      <span className={styles.arrow} aria-label={held ? "held at" : "to"}>
        {held ? "⇥" : "→"}
      </span>
      <span className={`${styles.tag} ${held ? styles.held : styles.to}`}>{to}</span>
    </span>
  );
}
