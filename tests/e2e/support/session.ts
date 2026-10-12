import { expect, type APIRequestContext, type Page } from "@playwright/test";

export type Persona = "BUYER" | "SUPPLIER" | "INSPECTOR" | "FORWARDER" | "RESOLVER";

/** The judge-demo deals. Specs only ever read them; mutating flows create their own deal. */
export const SEEDED = { funded: "PL-2048", disputed: "PL-2049" } as const;

export interface DealRef {
  id: string;
  reference: string;
  publicRef: string;
}

/** Signs in the way a reviewer would: the persona card on /sign-in. */
export async function signInWithPicker(page: Page, persona: Persona): Promise<void> {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: new RegExp(`^${persona.toLowerCase()}\\b`, "i") }).click();
  await page.waitForURL("**/overview");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

/** Signs in through the API for specs that test pages rather than the sign-in flow. Shares the page's cookie jar. */
export async function signInWithApi(page: Page, persona: Persona): Promise<void> {
  const res = await page.request.post("/api/v1/auth/demo", { data: { persona } });
  expect(res.ok(), `demo sign-in as ${persona}: HTTP ${res.status()}`).toBe(true);
}

export async function signOut(page: Page): Promise<void> {
  await page.getByRole("banner").getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL((url) => url.pathname === "/");
}

/** Resolves a deal reference to ids at run time so specs survive a reseed. Requires a signed-in request context. */
export async function findDeal(request: APIRequestContext, reference: string): Promise<DealRef> {
  const list = await request.get("/api/v1/deals");
  expect(list.ok(), `GET /api/v1/deals: HTTP ${list.status()}`).toBe(true);
  const deals = (await list.json()) as { id: string; reference: string }[];
  const deal = deals.find((d) => d.reference === reference);
  if (!deal) throw new Error(`${reference} is not visible to this persona; is the demo seeded?`);
  const detail = await request.get(`/api/v1/deals/${deal.id}`);
  expect(detail.ok()).toBe(true);
  const { publicRef } = (await detail.json()) as { publicRef: string };
  return { id: deal.id, reference, publicRef };
}
