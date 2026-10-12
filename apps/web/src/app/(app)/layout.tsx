import Link from "next/link";
import type { ReactNode } from "react";
import { Brand } from "@/components/logo";
import { Nav } from "@/components/nav";
import { OrgSwitcher } from "@/components/org-switcher";
import { SignOutButton } from "@/components/sign-out";
import { ThemeToggle } from "@/components/theme-toggle";
import { requireSession } from "@/server/auth/guard";
import { isChainConfigured, network } from "@/server/chain";
import { overview, unreadCount } from "@/server/services/workspace";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();
  const [unread, ov] = await Promise.all([unreadCount(session), overview(session)]);
  const mismatches = ov.documentMismatches.reduce((a, m) => a + m.count, 0);
  const initials = session.user.displayName.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  const wallet = session.wallets[0];
  const net = network();

  return (
    <div className="shell">
      <aside className="rail">
        <Link href="/overview" aria-label="Plimsoll overview">
          <Brand />
        </Link>
        <Nav unread={unread} mismatches={mismatches} />
        <div className="rail-foot">
          <div className="rail-card">
            <p className="eyebrow">
              Signing
            </p>
            {wallet ? (
              <>
                <p style={{ marginTop: 6, fontWeight: 600 }}>{wallet.accountKind === "demo_custodial" ? "Demo custody (testnet)" : wallet.label}</p>
                <p className="mono faint tiny">
                  {wallet.address.slice(0, 6)}…{wallet.address.slice(-4)}
                </p>
              </>
            ) : (
              <p style={{ marginTop: 6 }}>
                No wallet linked. <Link className="ext" href="/settings">Connect one</Link>
              </p>
            )}
          </div>
          <div className="profile">
            <span className="avatar" aria-hidden="true">
              {initials}
            </span>
            <div className="who grow">
              <div className="small" style={{ fontWeight: 600 }}>
                {session.user.displayName}
              </div>
              <div className="tiny muted">{session.org?.legalName ?? "No organization"}</div>
            </div>
          </div>
        </div>
      </aside>
      <div className="main">
        <header className="masthead">
          <div className="crumbs">
            <span>{session.org?.displayName ?? "Plimsoll"}</span>
            {session.user.isDemo ? <span className="env">DEMO PERSONA</span> : null}
          </div>
          <div className="tools">
            <OrgSwitcher userId={session.user.id} activeOrgId={session.org?.id ?? null} />
            <span className="env" title={net.passphrase}>
              <span className="dot" aria-hidden="true" />
              {isChainConfigured() ? net.label.toUpperCase() : "CHAIN NOT CONFIGURED"}
            </span>
            <ThemeToggle />
            <SignOutButton />
          </div>
        </header>
        <main className="work" id="main">
          {children}
        </main>
      </div>
    </div>
  );
}
