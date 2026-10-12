import { expect, test, type Locator } from "@playwright/test";
import { SEEDED, signInWithPicker } from "../support/session";

// Read-only by contract: these journeys run against the sacred judge-demo deals, so they never
// click anything that prepares, signs, uploads or records a decision.

const MONEY = /\d{1,3}(,\d{3})*\.\d{2}/;

// The "Locked" prefix is CSS generated content, so match the explanation inside the .why-not element.
function whyNot(scope: Locator, text: string | RegExp): Locator {
  return scope.locator(".why-not").filter({ hasText: text });
}

test.describe("buyer journey on the funded deal", () => {
  test("overview, cockpit why-not, document comparison and confirmed settlement", async ({ page }) => {
    // #given
    await signInWithPicker(page, "BUYER");

    // #then the overview shows escrow exposure and links to the blocking mismatch
    await expect(page.getByRole("heading", { level: 1, name: "Global trade overview" })).toBeVisible();
    const exposure = page.getByRole("region", { name: "Exposure and actions" });
    await expect(exposure.getByText("Held in escrow", { exact: true })).toBeVisible();
    await expect(exposure).toContainText(MONEY);
    await expect(exposure).toContainText("demo token, not USDC");
    const mismatch = exposure.getByRole("region", { name: "Blocking document mismatch" });
    await expect(mismatch.getByRole("link", { name: new RegExp(`^${SEEDED.funded}`) })).toHaveAttribute("href", /\/deals\/[\w-]+\/documents$/);

    // #when the buyer finds the deal in the index and opens the cockpit
    await page.getByRole("main").getByRole("link", { name: "All deals" }).first().click();
    await page.getByRole("searchbox", { name: "Search" }).fill(SEEDED.funded);
    await page.getByRole("button", { name: "Apply" }).click();
    await page.getByRole("main").getByRole("link", { name: SEEDED.funded, exact: true }).click();

    // #then the next milestone's release is explained, not just disabled
    await expect(page.getByRole("heading", { level: 1, name: "Porcelain tile, Ningbo → Felixstowe" })).toBeVisible();
    const handoff = page.getByRole("article", { name: "Carrier handoff" });
    await expect(handoff.getByRole("button", { name: "Attempt release" })).toBeVisible();
    await expect(whyNot(handoff, "No evidence bundle has been anchored on-chain.")).toBeVisible();
    await expect(handoff).toContainText("1 blocking mismatch");

    // #when the buyer opens the document comparison and selects the quantity finding
    await page.getByRole("link", { name: /^Documents · 1 blocking$/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Document comparison" })).toBeVisible();
    const finding = page.getByRole("list", { name: /^Findings\./ }).getByRole("button", { name: /R-QTY/ });
    await finding.click();

    // #then the packing list line is marked as the mismatch and the invoice line as agreeing
    await expect(finding).toHaveAttribute("aria-pressed", "true");
    const packingList = page.getByRole("region", { name: /^Right document: Packing list/ });
    const invoice = page.getByRole("region", { name: /^Left document: Commercial invoice/ });
    await expect(packingList.locator(".paper-line.hit").filter({ hasText: "KC-TILE-30" })).toContainText("148");
    await expect(invoice.locator(".paper-line.ok").filter({ hasText: "KC-TILE-30" })).toContainText("160");

    // #when the buyer opens the settlement detail
    await page.getByRole("main").getByRole("link", { name: "Settlement", exact: true }).click();

    // #then the released deposit is backed by a confirmed transaction with an explorer link
    await expect(page.getByRole("heading", { level: 1, name: "Settlement" })).toBeVisible();
    const deposit = page.getByRole("article", { name: "Purchase confirmed" });
    await expect(deposit).toContainText(/Released at ledger \d+/);
    await expect(deposit.getByRole("link", { name: /^settlement transaction [0-9a-f]{64} on explorer$/ })).toHaveAttribute("href", /stellar\.expert\/explorer\/testnet\/tx\/[0-9a-f]{64}$/);
  });
});

test.describe("dispute on the disputed deal", () => {
  test("the named resolver sees the decision form", async ({ page }) => {
    // #given
    await signInWithPicker(page, "RESOLVER");

    // #when
    await page.getByRole("region", { name: "Open dispute" }).getByRole("link", { name: new RegExp(`^${SEEDED.disputed}`) }).click();

    // #then
    await expect(page.getByRole("heading", { level: 1, name: /^Dispute: / })).toBeVisible();
    const decision = page.getByRole("region", { name: "Resolver decision" });
    await expect(decision.getByRole("textbox", { name: /^To buyer/ })).toBeEditable();
    await expect(decision.getByRole("textbox", { name: /^To payee/ })).toBeEditable();
    await expect(decision.getByRole("textbox", { name: /^Rationale/ })).toBeVisible();
    await expect(decision.getByRole("button", { name: "Review and sign resolution" })).toBeDisabled();
    await expect(decision.locator(".why-not")).toBeVisible();
  });

  test("the buyer sees why only the resolver can split the frozen amount", async ({ page }) => {
    // #given
    await signInWithPicker(page, "BUYER");

    // #when
    await page.getByRole("region", { name: "Open dispute" }).getByRole("link", { name: new RegExp(`^${SEEDED.disputed}`) }).click();

    // #then
    const decision = page.getByRole("region", { name: "Resolver decision" });
    await expect(whyNot(decision, /^Only the named resolver/)).toBeVisible();
    await expect(decision.getByRole("button", { name: "Review and sign resolution" })).toHaveCount(0);
  });
});
