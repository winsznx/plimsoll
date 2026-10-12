import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { findDeal, SEEDED, signInWithApi, type DealRef } from "../support/session";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];

interface AuditedPage {
  name: string;
  signedIn: boolean;
  path: (deal: DealRef) => string;
}

const PAGES: AuditedPage[] = [
  { name: "landing", signedIn: false, path: () => "/" },
  { name: "sign-in", signedIn: false, path: () => "/sign-in" },
  { name: "public proof", signedIn: false, path: (d) => `/verify/${d.publicRef}` },
  { name: "overview", signedIn: true, path: () => "/overview" },
  { name: "deals index", signedIn: true, path: () => "/deals" },
  { name: "deal cockpit", signedIn: true, path: (d) => `/deals/${d.id}` },
  { name: "document comparison", signedIn: true, path: (d) => `/deals/${d.id}/documents` },
  { name: "settlement", signedIn: true, path: (d) => `/deals/${d.id}/settlement` },
  { name: "settings", signedIn: true, path: () => "/settings" },
];

async function settle(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // Paper replicas and other client panels render skeletons until their data arrives; audit the loaded state.
  await expect(page.locator(".skeleton")).toHaveCount(0);
}

function describeViolations(violations: Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"]): string {
  return violations
    .map((v) => {
      const nodes = v.nodes
        .slice(0, 5)
        .map((n) => `    ${n.target.join(" ")}\n      ${n.failureSummary?.replaceAll("\n", "\n      ") ?? ""}`)
        .join("\n");
      return `[${v.impact ?? "unknown"}] ${v.id}: ${v.help} (${v.nodes.length} node${v.nodes.length === 1 ? "" : "s"})\n${nodes}`;
    })
    .join("\n\n");
}

test.describe("accessibility and layout audit", () => {
  let deal: DealRef;

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await signInWithApi(page, "BUYER");
    deal = await findDeal(page.request, SEEDED.funded);
    await page.close();
  });

  for (const audited of PAGES) {
    test(`${audited.name} passes axe WCAG 2.2 AA and does not scroll sideways`, async ({ page }) => {
      // #given
      if (audited.signedIn) await signInWithApi(page, "BUYER");

      // #when
      await page.goto(audited.path(deal));
      await settle(page);
      const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
      const overflow = await page.evaluate(() => ({ scrollWidth: document.scrollingElement?.scrollWidth ?? 0, innerWidth: window.innerWidth }));

      // #then
      expect.soft(results.violations.map((v) => v.id), describeViolations(results.violations)).toEqual([]);
      expect(overflow.scrollWidth, `page is ${overflow.scrollWidth}px wide in a ${overflow.innerWidth}px viewport`).toBeLessThanOrEqual(overflow.innerWidth);
    });
  }
});
