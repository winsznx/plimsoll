import { Compass } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { PublicFooter, PublicHeader, PublicNotice, PublicStage } from "@/components/public/public-frame";
import { optionalSession } from "@/server/auth/guard";
import { networkBadge } from "@/server/services/landing";

export const metadata: Metadata = { title: "Not found" };

export default async function NotFound() {
  const session = await optionalSession();
  return (
    <>
      <PublicHeader signedIn={session !== null} networkLabel={networkBadge()} />
      <PublicStage narrow>
        <PublicNotice
          id="nf-title"
          tone="neutral"
          icon={<Compass weight="bold" aria-hidden />}
          eyebrow="404"
          title="Nothing is recorded at this address"
          actions={
            session ? (
              <>
                <Link className="btn primary" href="/overview">
                  Open workspace
                </Link>
                <Link className="btn" href="/deals">
                  All agreements
                </Link>
              </>
            ) : (
              <>
                <Link className="btn primary" href="/">
                  Go to the home page
                </Link>
                <Link className="btn" href="/sign-in">
                  Sign in
                </Link>
              </>
            )
          }
        >
          The link is mistyped, or the page does not exist here. Agreements you are not party to also show this page.
        </PublicNotice>
      </PublicStage>
      <PublicFooter />
    </>
  );
}
