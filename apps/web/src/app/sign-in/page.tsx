import type { Metadata } from "next";
import Link from "next/link";
import { PasskeyRegister, PasskeySignIn } from "@/components/auth/passkey-forms";
import { PersonaPicker } from "@/components/auth/persona-picker";
import { Brand } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { isChainConfigured, network } from "@/server/chain";
import { personaOptions } from "@/server/personas";
import styles from "./sign-in.module.css";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage() {
  const configured = isChainConfigured();
  const networkLabel = network().label;
  return (
    <>
      <header className={styles.bar}>
        <div className={styles.barInner}>
          <Link href="/" aria-label="Plimsoll home">
            <Brand />
          </Link>
          <div className={styles.tools}>
            <span className="env">
              <span className="dot" aria-hidden="true" />
              {configured ? networkLabel.toUpperCase() : "CHAIN NOT CONFIGURED"}
            </span>
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main id="main" className={styles.stage}>
        <div className={styles.layout}>
          <section className={styles.demo} aria-labelledby="demo-title">
            <h1 id="demo-title" className={styles.title}>
              Enter the demo as any party.
            </h1>
            <p className={styles.sub}>Seeded parties, real {networkLabel} transactions. No wallet needed.</p>
            {configured ? (
              <PersonaPicker personas={personaOptions()} />
            ) : (
              <p className="callout small">
                Run <code>pnpm bootstrap:testnet</code> to provision the demo asset, personas and escrow code.
              </p>
            )}
            <p className={styles.custody}>Demo personas sign with testnet-only keys held by this deployment.</p>
          </section>

          <div className={styles.side}>
            <section className="panel" aria-labelledby="passkey-title">
              <div className="panel-head">
                <h2 id="passkey-title" className={styles.panelTitle}>
                  Sign in
                </h2>
              </div>
              <div className="panel-body">
                <PasskeySignIn />
              </div>
            </section>
            <section className="panel" id="start" aria-labelledby="start-title">
              <div className="panel-head">
                <div>
                  <h2 id="start-title" className={styles.panelTitle}>
                    Start a trade
                  </h2>
                  <p className="sub">Create your organization on {networkLabel}.</p>
                </div>
              </div>
              <div className="panel-body">
                <PasskeyRegister />
              </div>
            </section>
          </div>
        </div>
      </main>
    </>
  );
}
