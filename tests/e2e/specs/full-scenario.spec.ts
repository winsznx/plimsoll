import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { billOfLadingSpec, renderTradeDocument } from "@plimsoll/documents";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { signInWithPicker, signOut, type Persona } from "../support/session";

// Mutating: creates and settles its own deal on Stellar testnet. Never touches PL-2048 or PL-2049.
// Run with E2E_MUTATING=1 (pnpm e2e:browser:full). Each chain step waits for ledger confirmation.

const FIXTURES = resolve(import.meta.dirname, "../../fixtures");
const CHAIN_STEP_MS = 3 * 60_000;
const ANALYSIS_MS = 3 * 60_000;
const DEAL_TOTAL_WHOLE_TOKENS = 148_600n;

interface UploadFile {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

function fixture(name: string): UploadFile {
  return { name, mimeType: "application/pdf", buffer: readFileSync(resolve(FIXTURES, name)) };
}

/** The bill number must be unused across deals, or the duplicate rule blocks the milestone. */
async function uniqueBillOfLading(): Promise<UploadFile> {
  const billNumber = `UI${Date.now().toString(36).toUpperCase()}`;
  return { name: `${billNumber}-copy.pdf`, mimeType: "application/pdf", buffer: Buffer.from(await renderTradeDocument(billOfLadingSpec({ billNumber }))) };
}

/**
 * Chain steps either confirm or surface a refusal in the UI. Waiting only for success would turn a
 * contract or RPC refusal into a silent multi-minute timeout, so fail as soon as the refusal shows.
 */
async function waitForOutcome(what: string, succeeded: () => Promise<boolean>, failure: Locator, timeout = CHAIN_STEP_MS): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await failure.first().isVisible()) throw new Error(`${what} failed: ${await failure.first().innerText()}`);
    if (await succeeded()) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${what}: no outcome after ${timeout / 1000}s`);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function errorToast(page: Page): Locator {
  return page.getByRole("status").locator(".toast.error");
}

async function switchTo(page: Page, persona: Persona): Promise<void> {
  await signOut(page);
  await signInWithPicker(page, persona);
}

async function openDeal(page: Page, reference: string): Promise<void> {
  await page.goto("/deals");
  await page.getByRole("searchbox", { name: "Search" }).fill(reference);
  await page.getByRole("button", { name: "Apply" }).click();
  await page.getByRole("main").getByRole("link", { name: reference, exact: true }).click();
  await expect(page.getByText(new RegExp(`^${reference}\\s*/`))).toBeVisible();
}

/** Drives ChainActionButton: prepare, read the consequences, sign with the demo custody key, wait for the ledger. */
async function signChainAction(page: Page, scope: Locator | Page, label: string | RegExp): Promise<void> {
  await scope.getByRole("button", { name: label }).click();
  const dialog = page.getByRole("dialog");
  const sign = dialog.getByRole("button", { name: "Sign and submit" });
  const refused = dialog.getByRole("alert");
  await waitForOutcome(`Preparing "${String(label)}"`, () => sign.isVisible(), refused, 60_000);
  await expect(dialog.locator(".consequences li").first()).toBeVisible();
  await sign.click();
  await waitForOutcome(`Submitting "${String(label)}"`, async () => !(await dialog.isVisible()), refused);
}

async function upload(page: Page, documentType: string, file: UploadFile, asNewVersion = false): Promise<void> {
  const form = page.getByRole("region", { name: "Required documents" });
  await form.getByRole("combobox", { name: "Document type" }).selectOption({ label: documentType });
  if (asNewVersion) {
    const target = form.getByRole("combobox", { name: "Upload as" });
    const value = await target.locator("option", { hasText: `New version of ${documentType}` }).getAttribute("value");
    if (!value) throw new Error(`No existing ${documentType} to version`);
    await target.selectOption(value);
  }
  await form.getByLabel("File").setInputFiles(file);
  await form.getByRole("button", { name: asNewVersion ? "Upload new version" : "Upload and analyse" }).click();
  const uploaded = form.getByText(new RegExp(`^Uploaded ${escapeRegExp(documentType.toLowerCase())} v\\d+ · sha256`));
  await waitForOutcome(`Uploading ${file.name}`, () => uploaded.isVisible(), form.getByRole("alert"), 60_000);
}

async function optionValue(select: Locator, text: string): Promise<string> {
  const value = await select.locator("option", { hasText: text }).first().getAttribute("value");
  if (!value) throw new Error(`No "${text}" option to choose`);
  return value;
}

test.describe("full scenario on a fresh deal", () => {
  test.skip(process.env.E2E_MUTATING !== "1", "Mutates testnet state; run with E2E_MUTATING=1");
  test.describe.configure({ timeout: 10 * 60_000 });

  test("wizard to ledger-confirmed release with a corrected document", async ({ page }) => {
    test.slow();
    const title = `Browser e2e ${new Date().toISOString().slice(0, 16)}`;
    let reference = "";

    await test.step("#given a buyer with enough demo tokens to fund the agreement", async () => {
      await signInWithPicker(page, "BUYER");
      await page.goto("/settings");
      const balance = (await page.locator('dt:has-text("DEMOUSD balance") + dd').innerText()).match(/^([\d,]+)\./)?.[1];
      if (balance !== undefined && BigInt(balance.replaceAll(",", "")) >= DEAL_TOTAL_WHOLE_TOKENS) return;
      await page.getByRole("button", { name: "Get demo tokens" }).click();
      const status = page.getByRole("main").getByRole("status");
      await waitForOutcome("Demo faucet", () => status.getByText("Demo tokens confirmed on-chain.").isVisible(), status.locator('[style*="--alert"]'));
    });

    await test.step("#when the buyer drafts the deal through all seven wizard steps", async () => {
      await page.goto("/deals");
      await page.getByRole("main").getByRole("link", { name: "New deal" }).click();
      await expect(page.getByRole("heading", { level: 1, name: "Draft a deal" })).toBeVisible();
      const step = (name: string): Locator => page.getByRole("region", { name });
      const next = (to: string): Promise<void> => page.getByRole("button", { name: `Next: ${to}` }).click();

      const parties = step("Parties");
      await parties.getByLabel("Deal title").fill(title);
      await parties.getByLabel("Purchase order number").fill("PO-88231");
      const supplierOrg = parties.getByRole("combobox", { name: "Organization" });
      await supplierOrg.selectOption(await optionValue(supplierOrg, "Kestrel Ceramics"));
      await expect(parties.getByLabel("Supplier signing address")).toHaveValue(/^G[A-Z2-7]{55}$/);
      await parties.getByLabel("Appoint inspector").check();
      const knownInspector = parties.getByRole("combobox", { name: "Fill from a inspector on your other deals" });
      await knownInspector.selectOption(await optionValue(knownInspector, "Tidewater"));
      await expect(parties.getByLabel("Inspector name")).toHaveValue("Tidewater Inspection Services");
      await next("Goods and delivery terms");

      const goods = step("Goods and delivery terms");
      const lines = [
        ["KC-TILE-60", "Porcelain floor tile 600x600 matt", "320", "cartons", "285.00"],
        ["KC-TILE-30", "Porcelain wall tile 300x600 gloss", "160", "cartons", "358.75"],
      ] as const;
      await goods.getByRole("button", { name: "Add line item" }).click();
      for (const [i, [sku, description, quantity, uom, unitPrice]] of lines.entries()) {
        await goods.getByLabel(`Line ${i + 1} SKU`).fill(sku);
        await goods.getByLabel(`Line ${i + 1} description`).fill(description);
        await goods.getByLabel(`Line ${i + 1} quantity`).fill(quantity);
        await goods.getByLabel(`Line ${i + 1} unit of measure`).fill(uom);
        await goods.getByLabel(`Line ${i + 1} unit price`).fill(unitPrice);
      }
      await goods.getByLabel("Incoterms® 2020 rule").selectOption("FOB");
      await goods.getByLabel("Named place").fill("Ningbo");
      await goods.getByLabel("Transport mode").selectOption("sea");
      await goods.getByLabel("Origin port or place").fill("Ningbo");
      await goods.getByLabel("Destination port or place").fill("Felixstowe");
      await next("Assets and economics");

      await expect(step("Assets and economics").getByLabel("Milestone 2 amount")).toHaveValue(/^89,?160(\.0+)?$/);
      await next("Releases and quorum");
      await expect(step("Releases and quorum").getByRole("checkbox", { name: /^Inspector/ }).nth(1)).toBeChecked();
      await next("Documents");
      await expect(step("Documents").getByRole("group", { name: /Carrier handoff/ }).getByRole("checkbox", { name: "Packing list" })).toBeChecked();
      await next("Deadlines and disputes");

      const deadlines = step("Deadlines and disputes");
      await deadlines.getByLabel("Governing law").fill("England and Wales");
      await deadlines.getByLabel("Dispute forum").fill("Named resolver");
      const knownResolver = deadlines.getByRole("combobox", { name: "Fill from a resolver on your other deals" });
      await knownResolver.selectOption(await optionValue(knownResolver, "Harbour Arbitration"));
      await next("Review and create");
      await page.getByRole("button", { name: "Create draft" }).click();
      await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible({ timeout: 60_000 });
      reference = (await page.getByText(/^PL-\d+\s*\/\s*PO-88231$/).innerText()).split("/")[0]!.trim();
    });

    await test.step("#then the buyer freezes the terms and accepts on-chain", async () => {
      await page.getByRole("button", { name: "Freeze terms and deploy" }).click();
      const accept = page.getByRole("button", { name: "Sign terms" });
      const reread = page.getByRole("button", { name: "Re-read ledger" });
      // The first escrow readback lands from a background job after deploy and the cockpit does not
      // poll for it, so do what a reviewer would: ask for a fresh ledger read until terms can be accepted.
      await waitForOutcome(
        "Freezing terms",
        async () => {
          if (await accept.isVisible()) return true;
          const deploying = await page.getByRole("button", { name: /^(Freeze terms and deploy|Deploying escrow…)$/ }).isVisible();
          if (!deploying && (await reread.isEnabled().catch(() => false))) await reread.click();
          await page.waitForTimeout(2_000);
          return accept.isVisible();
        },
        errorToast(page),
      );
      await signChainAction(page, page, "Sign terms");
    });

    await test.step("#when the supplier accepts and the buyer funds", async () => {
      await switchTo(page, "SUPPLIER");
      await openDeal(page, reference);
      await signChainAction(page, page, "Sign terms");
      await switchTo(page, "BUYER");
      await openDeal(page, reference);
      await signChainAction(page, page, /^Fund 148,600\.00/);
      await expect(page.getByText("Fully funded.", { exact: false })).toBeVisible({ timeout: CHAIN_STEP_MS });
    });

    const findings = page.getByRole("region", { name: "Findings" });

    await test.step("#when the supplier uploads the documents, #then the short packing list is flagged", async () => {
      await switchTo(page, "SUPPLIER");
      await openDeal(page, reference);
      await page.getByRole("main").getByRole("link", { name: /^Documents/ }).first().click();
      await expect(page.getByRole("heading", { level: 1, name: "Document comparison" })).toBeVisible();
      await upload(page, "Commercial invoice", fixture("commercial-invoice.pdf"));
      await upload(page, "Packing list", fixture("packing-list-v1-short.pdf"));
      await upload(page, "Bill of lading (copy)", await uniqueBillOfLading());
      await expect(findings.getByRole("button", { name: /Blocking.*R-QTY.*148 cartons of KC-TILE-30/ })).toBeVisible({ timeout: ANALYSIS_MS });
    });

    await test.step("#when the supplier uploads the corrected packing list, #then nothing blocks", async () => {
      await upload(page, "Packing list", fixture("packing-list-v2-corrected.pdf"), true);
      await expect(page.getByText(/\b0 blocking\b/).first()).toBeVisible({ timeout: ANALYSIS_MS });
      await expect(findings.getByRole("button", { name: /Blocking.*Open.*R-QTY/ })).toHaveCount(0);
    });

    await test.step("#when the supplier prepares and anchors the carrier handoff evidence", async () => {
      await page.getByRole("main").getByRole("link", { name: "Agreement", exact: true }).click();
      const handoff = page.getByRole("article", { name: "Carrier handoff" });
      await handoff.getByRole("button", { name: "Bundle evidence" }).click();
      await expect(handoff.getByRole("button", { name: "Anchor evidence" })).toBeVisible({ timeout: 60_000 });
      await signChainAction(page, handoff, "Anchor evidence");
    });

    await test.step("#when the inspector and then the buyer approve the anchored digest", async () => {
      await switchTo(page, "INSPECTOR");
      await openDeal(page, reference);
      await signChainAction(page, page.getByRole("article", { name: "Carrier handoff" }), /^Approve$/);
      await switchTo(page, "BUYER");
      await openDeal(page, reference);
      await signChainAction(page, page.getByRole("article", { name: "Carrier handoff" }), /^Approve$/);
    });

    await test.step("#then the release is paid and confirmed from the ledger", async () => {
      const handoff = page.getByRole("article", { name: "Carrier handoff" });
      await handoff.getByRole("button", { name: /^Release 89,160\.00/ }).click();
      await waitForOutcome("Release", () => handoff.getByText("Released", { exact: true }).isVisible(), handoff.getByRole("alert"));
      await page.getByRole("main").getByRole("link", { name: "Settlement", exact: true }).first().click();
      const settled = page.getByRole("article", { name: "Carrier handoff" });
      await expect(settled).toContainText(/Released at ledger \d+/);
      await expect(settled.getByRole("link", { name: /^settlement transaction [0-9a-f]{64} on explorer$/ })).toHaveAttribute("href", /stellar\.expert\/explorer\/testnet\/tx\//);
    });
  });
});
