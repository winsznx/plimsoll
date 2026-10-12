import { LinkBreak } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { PublicCard, PublicFooter, PublicHeader, PublicNotice, PublicStage } from "@/components/public/public-frame";
import { fmtDateTime } from "@/lib/format";
import { optionalSession } from "@/server/auth/guard";
import { network } from "@/server/chain";
import { ApiError } from "@/server/http";
import { invitePreview } from "@/server/services/invites";
import { networkBadge } from "@/server/services/landing";
import { AcceptInvite } from "./accept-invite";

export const metadata: Metadata = { title: "Invitation", robots: { index: false } };

type Preview = Awaited<ReturnType<typeof invitePreview>>;

async function loadPreview(token: string): Promise<Preview | null> {
  try {
    return await invitePreview(token);
  } catch (e) {
    if (e instanceof ApiError && e.code === "NOT_FOUND") return null;
    throw e;
  }
}

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const session = await optionalSession();
  const preview = await loadPreview(token);
  const net = network();

  return (
    <>
      <PublicHeader signedIn={session !== null} networkLabel={networkBadge()} />
      <PublicStage>
        {preview ? (
          <PublicCard id="invite-title" eyebrow={`${preview.reference} · ${preview.network}`} title={`${preview.buyer} invited you to join as ${preview.role}`} sub="Check who is asking before you sign in or link a wallet.">
            <dl className="kv">
              <dt>Agreement</dt>
              <dd>
                <span className="mono tiny">{preview.reference}</span> {preview.title}
              </dd>
              <dt>Buyer</dt>
              <dd>{preview.buyer}</dd>
              <dt>Your seat</dt>
              <dd>
                {preview.role}, as {preview.invitedAs}
              </dd>
              {preview.inviteEmail ? (
                <>
                  <dt>Sent to</dt>
                  <dd>{preview.inviteEmail}</dd>
                </>
              ) : null}
              <dt>Expires</dt>
              <dd className="mono small">{fmtDateTime(preview.expiresAt)}</dd>
              <dt>Network</dt>
              <dd>{preview.network}</dd>
            </dl>
            <p className="tiny muted">Accepting adds your signing address to the draft terms. Nothing moves until both parties accept the frozen terms.</p>
            {session ? (
              <AcceptInvite
                token={token}
                networkLabel={net.label}
                wallets={session.wallets.filter((w) => w.network === net.id).map((w) => ({ address: w.address, label: w.label, custodial: w.accountKind === "demo_custodial" }))}
              />
            ) : (
              <div className="stack tight">
                <div>
                  <Link className="btn primary" href="/sign-in">
                    Sign in to accept
                  </Link>
                </div>
                <p className="tiny muted">Sign in or create your organization, then reopen this link.</p>
              </div>
            )}
          </PublicCard>
        ) : (
          <PublicNotice
            id="invite-title"
            tone="held"
            icon={<LinkBreak weight="bold" aria-hidden />}
            title="This invitation is invalid or has expired"
            actions={
              <Link className="btn" href={session ? "/overview" : "/"}>
                {session ? "Go to your workspace" : "Go to the Plimsoll home page"}
              </Link>
            }
          >
            It was used or has expired. Ask the buyer for a new link.
          </PublicNotice>
        )}
      </PublicStage>
      <PublicFooter />
    </>
  );
}
