import { expect, test } from "@playwright/test";
import { SEEDED } from "../support/session";

test.describe("public pages", () => {
  test("landing shows the recorded testnet session and the deployment proof", async ({ page }) => {
    // #when
    await page.goto("/");

    // #then
    await expect(page.getByRole("heading", { level: 1, name: "Trade agreements that know when to pay." })).toBeVisible();
    const replay = page.getByRole("region", { name: "Recorded testnet session" });
    await expect(replay).toContainText(SEEDED.funded);
    const events = replay.getByRole("list", { name: `Ledger events for ${SEEDED.funded}, oldest first` });
    await expect(events.getByRole("listitem").first()).toContainText("Escrow contract deployed");
    await expect(events.getByRole("link", { name: /^Transaction [0-9a-f]{64} on the explorer$/ }).first()).toHaveAttribute("href", /stellar\.expert\/explorer\/testnet\/tx\/[0-9a-f]{64}$/);
    await expect(events).toContainText("Packing list shows 148 cartons of KC-TILE-30");

    const proof = page.getByRole("region", { name: "Deployment proof" });
    await expect(proof).toContainText("Stellar Testnet");
    await expect(proof.getByRole("button", { name: "Copy escrow wasm hash" })).toBeVisible();
    await expect(proof.getByRole("link", { name: /^token contract C[A-Z2-7]{55} on explorer$/ })).toBeVisible();
    await expect(proof.getByRole("link", { name: /^\/verify\// })).toBeVisible();
  });

  test("public proof shows the contract, conservation and a matching recomputed digest", async ({ page }) => {
    // #given
    await page.goto("/");
    await page.getByRole("region", { name: "Recorded testnet session" }).getByRole("link", { name: "Check the public proof" }).click();
    await page.waitForURL(/\/verify\/[\w-]+$/);
    await expect(page.getByRole("heading", { level: 1, name: `Escrow record for ${SEEDED.funded}` })).toBeVisible();
    await expect(page.getByRole("link", { name: /^escrow contract C[A-Z2-7]{55} on explorer$/ }).first()).toHaveAttribute("href", /stellar\.expert\/explorer\/testnet\/contract\//);
    await expect(page.getByRole("status").filter({ hasText: "Conservation check holds" })).toBeVisible();

    // #when
    const checker = page.getByRole("region", { name: "Check it yourself" });
    await checker.getByRole("button", { name: "Recompute digests" }).click();

    // #then
    await expect(checker.getByText("Digest matches").first()).toBeVisible();
    await expect(checker.getByText("Mismatch", { exact: true })).toHaveCount(0);
  });

  test("an unknown proof reference renders the 404 page", async ({ page }) => {
    // #when
    const res = await page.goto("/verify/does-not-exist-0000");

    // #then
    expect(res?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1, name: "Nothing is recorded at this address" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Go to the home page" })).toBeVisible();
  });
});
