import { route } from "@/server/http";
import { readVersionBytes } from "@/server/services/documents";

export const GET = route<{ id: string; vid: string }>(async ({ params, session }) => {
  const { bytes, mediaType, fileName } = await readVersionBytes(session, params.id, params.vid);
  return new Response(Buffer.from(bytes), {
    headers: { "content-type": mediaType, "content-disposition": `inline; filename="${fileName.replace(/[^\w.\-]/g, "_")}"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" },
  });
});
