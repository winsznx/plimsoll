import { userMemberships } from "@/server/services/org-members";
import { OrgSwitcherMenu } from "./org-switcher-menu";

/** Renders only for people who belong to more than one organization. */
export async function OrgSwitcher({ userId, activeOrgId }: { userId: string; activeOrgId: string | null }) {
  const orgs = await userMemberships(userId);
  if (orgs.length < 2) return null;
  return <OrgSwitcherMenu orgs={orgs.map((o) => ({ id: o.orgId, name: o.name, role: o.role }))} activeOrgId={activeOrgId} />;
}
