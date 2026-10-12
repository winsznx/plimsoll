import { route, parseBody } from "@/server/http";
import { createDraft, draftInput, listDeals } from "@/server/services/deals";
import { sendDealInvite } from "@/server/services/invites";

export const GET = route(async ({ session, req }) => {
  const q = req.nextUrl.searchParams.get("q")?.toLowerCase() ?? "";
  const status = req.nextUrl.searchParams.get("status");
  const rows = await listDeals(session);
  return rows
    .filter((d) => (!status || d.status === status) && (!q || `${d.reference} ${d.title} ${d.terms.supplier.legalName} ${d.terms.buyer.legalName}`.toLowerCase().includes(q)))
    .map((d) => ({ id: d.id, reference: d.reference, title: d.title, status: d.status, totalUnits: d.terms.totalUnits, assetCode: d.terms.asset.code, buyer: d.terms.buyer.legalName, supplier: d.terms.supplier.legalName, escrowContractId: d.escrowContractId, updatedAt: d.updatedAt.toISOString() }));
});

export const POST = route(
  async ({ req, session }) => {
    const draft = await createDraft(session, await parseBody(req, draftInput));
    const inviteEmail = draft.inviteToken ? await sendDealInvite(draft.inviteToken) : null;
    return { ...draft, inviteEmail };
  },
  { idempotent: true },
);
