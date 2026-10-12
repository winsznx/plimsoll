import { Bell, Buildings, Code, Key, PaintBrush, ShieldCheck, UsersThree, Wallet as WalletIcon, WebhooksLogo } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Chip } from "@/components/chip";
import { Hash } from "@/components/hash";
import { ThemeToggle } from "@/components/theme-toggle";
import { ApiKeysPanel } from "@/components/workspace/api-keys-panel";
import { EmailPanel, EmailVerificationBanner } from "@/components/workspace/email-settings";
import { MembersSection } from "@/components/workspace/members-section";
import { VerificationChip } from "@/components/workspace/verification-chip";
import { WalletActions, type WalletState } from "@/components/workspace/wallet-actions";
import { WalletConnect } from "@/components/workspace/wallet-connect";
import { WebhooksPanel } from "@/components/workspace/webhooks-panel";
import { Figure } from "@/components/instruments/figure";
import styles from "@/components/workspace/workspace.module.css";
import { fmtDate } from "@/lib/format";
import { requireSession } from "@/server/auth/guard";
import type { SessionContext } from "@/server/auth/session";
import { explorer, isChainConfigured, issuerKeypair, network } from "@/server/chain";
import { chainConfig } from "@/server/env";
import { listApiKeys, listWebhooks } from "@/server/services/integrations";
import { OUTBOUND_EVENTS } from "@/server/services/notify";
import { walletStatus } from "@/server/services/wallets";
import st from "./settings.module.css";

export const metadata: Metadata = { title: "Settings" };

type Wallet = SessionContext["wallets"][number];

const SIGNATURE_EXAMPLE = `const signed = \`\${timestamp}.\${eventId}.\${rawBody}\`;
const expected = createHmac("sha256", secret).update(signed).digest("hex");
const given = signatureHeader.replace(/^v1=/, "");
const valid = given.length === expected.length
  && timingSafeEqual(Buffer.from(given), Buffer.from(expected));`;

const PAYLOAD_EXAMPLE = `{
  "id": "<event id, same as plimsoll-event-id>",
  "type": "milestone.release.confirmed",
  "createdAt": "<ISO 8601>",
  "data": { "dealId": "<uuid>", "reference": "PL-…", … }
}`;

async function WalletStatusBlock({ wallet, passphrase, explorerBase }: { wallet: Wallet; passphrase: string; explorerBase: string | null }) {
  const isDemoCustody = wallet.accountKind === "demo_custodial";
  const net = network();
  let state: WalletState | null = null;
  let balance: string | null = null;
  let assetCode = "token";
  let isDemoAsset = false;
  let unavailable: string | null = null;
  try {
    const cfg = chainConfig();
    assetCode = cfg.asset.code;
    isDemoAsset = cfg.asset.isDemo;
    const s = await walletStatus(wallet.address);
    state = { exists: s.exists, trustline: s.trustline };
    balance = s.balance;
  } catch (e) {
    unavailable = isChainConfigured() ? "Stellar RPC did not answer. Account, trustline and balance unknown." : "The chain is not configured on this server.";
    console.warn("[settings] wallet status unavailable", e instanceof Error ? e.message : e);
  }
  const faucet = net.id === "testnet" && isDemoAsset ? { blocked: issuerKeypair() ? null : "The testnet issuer key is not configured on this server." } : null;

  return (
    <div className="stack tight">
      {unavailable ? (
        <p className={`small ${styles.error}`}>Status unavailable. {unavailable}</p>
      ) : (
        <dl className={st.stats}>
          <div>
            <dt>Account</dt>
            <dd>{state?.exists ? <Chip tone="confirmed">On {net.label}</Chip> : <Chip tone="awaiting">Not found</Chip>}</dd>
          </div>
          <div>
            <dt>{assetCode} trustline</dt>
            <dd>{state?.trustline ? <Chip tone="confirmed">In place</Chip> : <Chip tone="awaiting">Missing</Chip>}</dd>
          </div>
          <div>
            <dt>{assetCode} balance</dt>
            <dd>
              {balance !== null ? <Figure units={balance} size="md" /> : <span className="faint">Unknown</span>}
              {isDemoAsset ? <span className={st.note}> demo, not USDC</span> : null}
            </dd>
          </div>
        </dl>
      )}
      <WalletActions
        address={wallet.address}
        isDemoCustody={isDemoCustody}
        networkPassphrase={passphrase}
        explorerBase={explorerBase}
        assetCode={assetCode}
        state={state}
        faucet={faucet ? { blocked: faucet.blocked, amountLabel: `a fixed amount of ${assetCode}` } : null}
      />
    </div>
  );
}

function WalletRow({ wallet, passphrase, explorerBase }: { wallet: Wallet; passphrase: string; explorerBase: string | null }) {
  const isDemoCustody = wallet.accountKind === "demo_custodial";
  return (
    <div className={st.wallet}>
      <div className={st.walletHead}>
        <div style={{ minWidth: 0 }}>
          <p className={st.walletName}>{isDemoCustody ? "Demo custody (testnet)" : wallet.label}</p>
          <Hash value={wallet.address} href={explorer("account", wallet.address)} label="wallet address" />
        </div>
        <div className="row wrap" style={{ gap: 6 }}>
          <Chip tone="neutral">{wallet.network}</Chip>
          <Chip tone={isDemoCustody ? "attention" : "confirmed"}>{isDemoCustody ? "Demo custody" : "External"}</Chip>
        </div>
      </div>
      <p className={st.note}>{isDemoCustody ? "Server-held testnet key so personas can sign without an extension. Never shown or exported." : `Ownership proven by signed challenge${wallet.verifiedAt ? ` on ${fmtDate(wallet.verifiedAt)}` : ""}. Plimsoll never sees the secret key.`}</p>
      <Suspense fallback={<div className="skeleton" style={{ height: 64 }} aria-label="Reading account status from the ledger" />}>
        <WalletStatusBlock wallet={wallet} passphrase={passphrase} explorerBase={explorerBase} />
      </Suspense>
    </div>
  );
}

const SECTIONS = [
  { id: "wallets", label: "Wallets", icon: WalletIcon },
  { id: "organization", label: "Organization", icon: Buildings },
  { id: "members", label: "Members", icon: UsersThree },
  { id: "email", label: "Email", icon: Bell },
  { id: "session", label: "Sign-in", icon: ShieldCheck },
  { id: "theme", label: "Theme", icon: PaintBrush },
  { id: "webhooks", label: "Webhooks", icon: WebhooksLogo },
  { id: "api-keys", label: "API keys", icon: Key },
] as const;

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const { welcome } = await searchParams;
  const session = await requireSession();
  const webhooks = await listWebhooks(session);
  const apiKeys = await listApiKeys(session);
  const net = network();
  const chainReady = isChainConfigured();
  const assetCode = chainReady ? chainConfig().asset.code : "token";
  const isAdmin = session.role === "owner" || session.role === "admin";
  const adminBlocked = !session.org ? "Join or create an organization to manage integrations." : isAdmin ? null : `Owners and admins manage integrations. Your role: ${session.role ?? "none"}.`;
  const hasExternalWallet = session.wallets.some((w) => w.accountKind === "external");
  const sections = SECTIONS.filter((x) => x.id !== "members" || session.org);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <div className="sub">
            <span>{session.org?.legalName ?? "No organization"}</span>
            <span className="faint">
              {session.user.displayName} · {session.user.email}
            </span>
          </div>
        </div>
      </div>

      <EmailVerificationBanner email={session.user.email} verified={session.user.emailVerifiedAt !== null} />

      {welcome === "1" ? (
        <div className={st.welcome} role="status">
          <strong>Passkey registered. Before your first deal:</strong>
          <ol className={styles.steps}>
            <li>
              <a className="ext" href="#wallets">
                Connect Freighter
              </a>{" "}
              {hasExternalWallet ? "(done)" : `on ${net.label}. It signs approvals, your passkey does not.`}
            </li>
            <li>Add the {assetCode} trustline.</li>
            <li>Get demo tokens. Demo token, not USDC.</li>
            <li>
              <Link className="ext" href="/deals/new">
                Create a deal
              </Link>{" "}
              and invite your supplier.
            </li>
          </ol>
        </div>
      ) : null}

      <div className={st.layout}>
        <nav className={st.subnav} aria-label="Settings sections">
          <ul>
            {sections.map(({ id, label, icon: Icon }) => (
              <li key={id}>
                <a href={`#${id}`}>
                  <Icon aria-hidden />
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className={st.sections}>
          <section className="panel" id="wallets" aria-labelledby="wallets-h">
            <div className="panel-head">
              <div>
                <h2 id="wallets-h" className={st.h}>
                  Wallets
                </h2>
                <p className="sub">Stellar accounts that sign approvals, funding and disputes on {net.label}.</p>
              </div>
            </div>
            <div className="panel-body flush">
              {session.wallets.length === 0 ? (
                <p className="empty">
                  <strong>No wallet linked</strong>
                  Your passkey signs you in. Freighter signs deal actions.
                </p>
              ) : (
                session.wallets.map((w) => <WalletRow key={w.id} wallet={w} passphrase={net.passphrase} explorerBase={net.explorerBase} />)
              )}
            </div>
            <div className={st.foot}>
              {chainReady ? (
                <WalletConnect networkPassphrase={net.passphrase} networkLabel={net.label} />
              ) : (
                <>
                  <button type="button" className="btn primary" disabled>
                    Connect Freighter
                  </button>
                  <p className="why-not">Stellar is not configured on this server.</p>
                </>
              )}
            </div>
          </section>

          <section className="panel" id="organization" aria-labelledby="org-h">
            <div className="panel-head">
              <h2 id="org-h" className={st.h}>
                Organization
              </h2>
              {session.org ? <VerificationChip state={session.org.verificationState} /> : null}
            </div>
            <div className="panel-body">
              {session.org ? (
                <dl className={st.stats}>
                  <div>
                    <dt>Legal name</dt>
                    <dd>{session.org.legalName}</dd>
                  </div>
                  <div>
                    <dt>Jurisdiction</dt>
                    <dd>{session.org.jurisdiction}</dd>
                  </div>
                  <div>
                    <dt>Your role</dt>
                    <dd style={{ textTransform: "capitalize" }}>{session.role ?? "None"}</dd>
                  </div>
                </dl>
              ) : (
                <p className="small muted">Not a member of an organization. Deals you were invited to stay under Deals.</p>
              )}
            </div>
          </section>

          {session.org ? <MembersSection session={session} /> : null}

          <EmailPanel email={session.user.email} verified={session.user.emailVerifiedAt !== null} notifications={session.user.emailNotifications} isDemo={session.user.isDemo} />

          <div className={st.pair}>
            <section className="panel" id="session" aria-labelledby="session-h">
              <div className="panel-head">
                <h2 id="session-h" className={st.h}>
                  Sign-in
                </h2>
                {session.method === "passkey" ? <Chip tone="confirmed">Passkey</Chip> : <Chip tone="attention">Demo persona</Chip>}
              </div>
              <div className="panel-body stack tight">
                <p className="small">{session.method === "passkey" ? "Passkey on this device. It proves who you are to Plimsoll, nothing more." : "Seeded demo persona. Deal actions sign with server-held testnet keys."}</p>
                <p className={st.note}>Signing in and signing on Stellar are separate. Deal actions are always signed by the wallet appointed on the deal.</p>
              </div>
            </section>

            <section className="panel" id="theme" aria-labelledby="theme-h">
              <div className="panel-head">
                <h2 id="theme-h" className={st.h}>
                  Theme
                </h2>
                <ThemeToggle />
              </div>
              <div className="panel-body">
                <p className="small">Light for document review, dark for monitoring. Saved in this browser. Follows your system until you choose.</p>
              </div>
            </section>
          </div>

          <section id="integrations" className="stack" aria-labelledby="int-h">
            <div className={st.groupHead}>
              <div>
                <h2 id="int-h" className={st.h}>
                  Integrations
                </h2>
                <p className="small muted">Signed webhooks for confirmed events. Sandbox API keys.</p>
              </div>
              {!isAdmin ? <Chip tone="awaiting">Read only</Chip> : null}
            </div>

            <section className="panel" id="webhooks" aria-labelledby="wh-h">
              <div className="panel-head">
                <div>
                  <h3 id="wh-h">Webhooks</h3>
                  <p className="sub">HTTPS POST, HMAC-SHA256 signed, retried for about 24 hours.</p>
                </div>
              </div>
              <div className="panel-body">
                <WebhooksPanel endpoints={webhooks} events={OUTBOUND_EVENTS} adminBlocked={adminBlocked} />
              </div>
              <details className={st.details}>
                <summary>
                  <Code aria-hidden />
                  <span id="schema-h">Event schema and verification</span>
                </summary>
                <div className="stack tight">
                  <dl className="kv">
                    <dt className="mono tiny">plimsoll-event-id</dt>
                    <dd className="small">Stable event id. Retries reuse it.</dd>
                    <dt className="mono tiny">plimsoll-timestamp</dt>
                    <dd className="small">Unix seconds when this attempt was signed.</dd>
                    <dt className="mono tiny">plimsoll-signature</dt>
                    <dd className="small">
                      <span className="mono">v1=</span> + hex HMAC-SHA256 of <span className="mono">&lt;timestamp&gt;.&lt;eventId&gt;.&lt;body&gt;</span>, keyed with the endpoint secret.
                    </dd>
                  </dl>
                  <pre className={styles.code} aria-label="Payload shape" tabIndex={0}>
                    {PAYLOAD_EXAMPLE}
                  </pre>
                  <pre className={styles.code} aria-label="Node.js signature check" tabIndex={0}>
                    {SIGNATURE_EXAMPLE}
                  </pre>
                  <p className="small">
                    <strong>Retries.</strong> Non-2xx or a 10 s timeout retries with exponential backoff from 1 minute, doubling to a 2 hour cap, for about 24 hours (19 attempts). Then the delivery is parked for operator review.
                  </p>
                  <p className="small">
                    <strong>Replay protection.</strong> Sign over the raw body before parsing, reject timestamps older than 5 minutes, and store processed event ids so a retry applies once.
                  </p>
                  <p className={st.note}>Money events fire only after Plimsoll reads the result back from the ledger. A webhook is a notification, not proof. Check the explorer or the public verify page.</p>
                </div>
              </details>
            </section>

            <section className="panel" id="api-keys" aria-labelledby="keys-h">
              <div className="panel-head">
                <div>
                  <h3 id="keys-h">API keys</h3>
                  <p className="sub">
                    Shown once, stored as SHA-256. Send <code>Authorization: Bearer &lt;key&gt;</code> to <code>/api/v1</code>. Acts as its creator, audited the same way.
                  </p>
                </div>
              </div>
              <div className="panel-body">
                <ApiKeysPanel keys={apiKeys} adminBlocked={adminBlocked} />
              </div>
            </section>
          </section>
        </div>
      </div>
    </>
  );
}
