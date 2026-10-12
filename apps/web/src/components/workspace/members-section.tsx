import { Chip } from "@/components/chip";
import type { SessionContext } from "@/server/auth/session";
import { listMembers } from "@/server/services/org-members";
import { MembersPanel } from "./members-panel";

export async function MembersSection({ session }: { session: SessionContext }) {
  const data = await listMembers(session);
  return (
    <section className="panel" id="members" aria-labelledby="members-h">
      <div className="panel-head">
        <div>
          <h2 id="members-h" style={{ fontSize: 15 }}>
            Members
          </h2>
          <p className="sub">See every deal of {session.org?.legalName}. Owners set roles. Owners and admins invite and remove.</p>
        </div>
        {data.manageBlocked ? <Chip tone="awaiting">Read only</Chip> : null}
      </div>
      <MembersPanel {...data} emailVerified={session.user.emailVerifiedAt !== null} />
    </section>
  );
}
