import { DOCUMENT_TYPES, type DocumentType } from "@plimsoll/domain";
import { ApiError, route } from "@/server/http";
import { MAX_UPLOAD_BYTES, uploadDocument } from "@/server/services/documents";
import { buildDocumentViews, requireDealAccess } from "@/server/services/views";

type P = { id: string };
export const GET = route<P>(async ({ params, session }) => {
  await requireDealAccess(session, params.id);
  return buildDocumentViews(params.id);
});

export const POST = route<P>(async ({ req, params, session }) => {
  const form = await req.formData();
  const file = form.get("file");
  const type = String(form.get("documentType") ?? "");
  const documentId = form.get("documentId");
  if (!(file instanceof File)) throw new ApiError("VALIDATION_FAILED", "Attach a file.");
  if (file.size > MAX_UPLOAD_BYTES) throw new ApiError("VALIDATION_FAILED", "Documents are limited to 20 MB.");
  if (!DOCUMENT_TYPES.includes(type as DocumentType)) throw new ApiError("VALIDATION_FAILED", "Choose a document type.");
  return uploadDocument(session, params.id, { documentType: type as DocumentType, documentId: typeof documentId === "string" && documentId ? documentId : null, fileName: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
});
