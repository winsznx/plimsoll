import Link from "next/link";
import type { ReactNode } from "react";
import { Brand } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import styles from "./public-frame.module.css";

/** Header for unauthenticated pages; signed-in visitors get a way back into their workspace. */
export function PublicHeader({ signedIn, networkLabel }: { signedIn: boolean; networkLabel: string }) {
  return (
    <header className={styles.header}>
      <div className={styles.headerInner}>
        <Link href="/" aria-label="Plimsoll home">
          <Brand />
        </Link>
        <div className={styles.headerTools}>
          <span className="env">
            <span className="dot" aria-hidden="true" />
            {networkLabel}
          </span>
          <ThemeToggle />
          {signedIn ? (
            <Link className="btn sm primary" href="/overview">
              Open workspace
            </Link>
          ) : (
            <Link className="btn sm primary" href="/sign-in">
              Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

export function PublicFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.footerInner}>
        <p>Stellar testnet · demo token with no value. Escrow software, not a bank or a letter of credit.</p>
        <nav className={styles.footerLinks} aria-label="Footer">
          <Link className="ext" href="/sign-in">
            Sign in
          </Link>
          <Link className="ext" href="/#limits">
            Limits
          </Link>
        </nav>
      </div>
    </footer>
  );
}

/** Main landmark with one compact card centred in it. */
export function PublicStage({ children, narrow = false }: { children: ReactNode; narrow?: boolean }) {
  return (
    <main id="main" className={styles.stage}>
      <div className={`${styles.stageInner} ${narrow ? styles.narrow : ""}`}>{children}</div>
    </main>
  );
}

/** A public link that still works: who is asking, the facts, then the one action. */
export function PublicCard({ id, eyebrow, title, sub, children }: { id: string; eyebrow?: string; title: string; sub?: string; children: ReactNode }) {
  return (
    <section className={`panel ${styles.card}`} aria-labelledby={id}>
      <div className={styles.cardHead}>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1 id={id} className={styles.cardTitle}>
          {title}
        </h1>
        {sub ? <p className={styles.cardSub}>{sub}</p> : null}
      </div>
      <div className={styles.cardBody}>{children}</div>
    </section>
  );
}

/** A terminal state for a public link: one mark, one heading, one line, the way out. */
export function PublicNotice({ id, tone, icon, eyebrow, title, children, actions }: { id: string; tone: "held" | "done" | "neutral"; icon: ReactNode; eyebrow?: string; title: string; children: ReactNode; actions: ReactNode }) {
  return (
    <section className={`panel ${styles.notice}`} aria-labelledby={id}>
      <span className={`${styles.mark} ${styles[tone] ?? ""}`}>{icon}</span>
      {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
      <h1 id={id} className={styles.noticeTitle}>
        {title}
      </h1>
      <p className={styles.noticeBody}>{children}</p>
      <div className="btn-group">{actions}</div>
    </section>
  );
}
