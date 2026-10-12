export function GET(): Response {
  return Response.json({ status: "live", at: new Date().toISOString() });
}
