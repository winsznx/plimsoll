import { LinkBreak } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { PublicCard, PublicFooter, PublicHeader, PublicNotice, PublicStage } from "@/components/public/public-frame";
import { VerificationChip } from "@/components/workspace/verification-chip";
import { fmtDateTime } from "@/lib/format";
import { optionalSession } from "@/server/auth/guard";
import { sameEmail } from "@/server/auth/tokens";
import { networkBadge } from "@/server/services/landing";
import { orgInvitePreview } from "@/server/services/org-members";
import { AcceptOrgInvite } from "./accept-org-invite";

export const metadata: Metadata = { title: "Join organization", robots: { index: false } };

const DEAD_LINK: Record<"expired" | "closed" | "unknown", string> = {
  expired: "Invitations expire after 7 days. Ask for a new one.",
  closed: "It was already accepted or withdrawn. Ask an owner or admin to invite you again.",
  unknown: "The link may be incomplete. Copy the whole link from the email.",
};

export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const session = await optionalSession();
  const preview = await orgInvitePreview(token);

  return (
    <>
      <PublicHeader signedIn={session !== null} networkLabel={networkBadge()} />
      <PublicStage>
        {preview.state === "usable" ? (
          <PublicCard id="join-title" title={`${preview.invitedBy} invited you to join ${preview.orgName}`} sub="Members see every deal this organization is party to.">
            <dl className="kv">
              <dt>Organization</dt>
              <dd>
                {preview.orgName} <span className="muted small">({preview.jurisdiction})</span>
              </dd>
              <dt>Identity check</dt>
              <dd>
                <VerificationChip state={preview.verificationState} />
              </dd>
              <dt>Your role</dt>
              <dd style={{ textTransform: "capitalize" }}>{preview.role}</dd>
              <dt>Sent to</dt>
              <dd className="mono small">{preview.email}</dd>
              <dt>Expires</dt>
              <dd className="mono small">{fmtDateTime(preview.expiresAt)}</dd>
            </dl>
            {!session ? (
              <div className="stack tight">
                <div>
                  <Link className="btn primary" href="/sign-in">
                    Sign in to accept
                  </Link>
                </div>
                <p className="tiny muted">Sign in or register as {preview.email}, then reopen this link.</p>
              </div>
            ) : !sameEmail(session.user.email, preview.email) ? (
              <div className="stack tight">
                <div>
                  <button type="button" className="btn primary" disabled>
                    Join {preview.orgName}
                  </button>
                </div>
                <p className="why-not">
                  Signed in as {session.user.email}. This invitation is for {preview.email}.
                </p>
              </div>
            ) : (
              <AcceptOrgInvite token={token} orgName={preview.orgName} />
            )}
          </PublicCard>
        ) : (
          <PublicNotice
            id="join-title"
            tone="held"
            icon={<LinkBreak weight="bold" aria-hidden />}
            title="This invitation can't be used"
            actions={
              <Link className="btn" href={session ? "/overview" : "/"}>
                {session ? "Go to your workspace" : "Go to the Plimsoll home page"}
              </Link>
            }
          >
            {DEAD_LINK[preview.state]}
          </PublicNotice>
        )}
      </PublicStage>
      <PublicFooter />
    </>
  );
}
