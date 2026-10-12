import { CheckCircle, LinkBreak } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { PublicCard, PublicFooter, PublicHeader, PublicNotice, PublicStage } from "@/components/public/public-frame";
import { optionalSession } from "@/server/auth/guard";
import { verificationPreview } from "@/server/services/email-verification";
import { networkBadge } from "@/server/services/landing";
import { ConfirmEmail } from "./confirm-email";

export const metadata: Metadata = { title: "Confirm email", robots: { index: false } };

const DEAD_LINK: Record<"expired" | "closed" | "unknown", { title: string; body: string }> = {
  expired: { title: "This link expired", body: "Links work for 24 hours. Resend the email from Settings." },
  closed: { title: "This link was replaced", body: "A newer email was sent. Use its link, or resend from Settings." },
  unknown: { title: "This link is not valid", body: "It may be incomplete. Copy the whole link, or resend from Settings." },
};

export default async function VerifyEmailPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const session = await optionalSession();
  const preview = await verificationPreview(token);
  const home = session ? "/settings#email" : "/sign-in";

  return (
    <>
      <PublicHeader signedIn={session !== null} networkLabel={networkBadge()} />
      <PublicStage narrow>
        {preview.state === "usable" ? (
          <PublicCard id="verify-title" title="Confirm your email" sub="Proves you control the address on your account.">
            <dl className="kv">
              <dt>Address</dt>
              <dd className="mono small">{preview.email}</dd>
            </dl>
            <p className="tiny muted">Unlocks creating deals and inviting colleagues. Organization verification is a separate check.</p>
            <ConfirmEmail token={token} signedIn={session !== null} />
          </PublicCard>
        ) : preview.state === "verified" ? (
          <PublicNotice
            id="verify-title"
            tone="done"
            icon={<CheckCircle weight="fill" aria-hidden />}
            title="Your email is already confirmed"
            actions={
              <Link className="btn primary" href={session ? "/overview" : "/sign-in"}>
                {session ? "Go to your workspace" : "Sign in"}
              </Link>
            }
          >
            Nothing else to do here.
          </PublicNotice>
        ) : (
          <PublicNotice
            id="verify-title"
            tone="held"
            icon={<LinkBreak weight="bold" aria-hidden />}
            title={DEAD_LINK[preview.state].title}
            actions={
              <Link className="btn primary" href={home}>
                {session ? "Resend from Settings" : "Sign in"}
              </Link>
            }
          >
            {DEAD_LINK[preview.state].body}
          </PublicNotice>
        )}
      </PublicStage>
      <PublicFooter />
    </>
  );
}
