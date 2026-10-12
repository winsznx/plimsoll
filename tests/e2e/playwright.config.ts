import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

const CHROME_PATHS = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/opt/google/chrome/chrome", "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"];

// Use the installed Google Chrome so local runs need no browser download; fall back to Playwright's Chromium in CI.
const channel = process.env.E2E_CHANNEL ?? (CHROME_PATHS.some((p) => existsSync(p)) ? "chrome" : undefined);

const desktop = { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, channel };
const mobile = { ...devices["Desktop Chrome"], viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, channel };

// The mutating scenario writes to testnet once; running it per theme and viewport would only repeat chain work.
const ONCE = /full-scenario\.spec\.ts/;

export default defineConfig({
  testDir: "./specs",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  outputDir: "test-results",
  use: {
    baseURL: process.env.PLIMSOLL_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop-light", use: { ...desktop, colorScheme: "light" } },
    { name: "desktop-dark", use: { ...desktop, colorScheme: "dark" }, testIgnore: ONCE },
    { name: "mobile-light", use: { ...mobile, colorScheme: "light" }, testIgnore: ONCE },
    { name: "mobile-dark", use: { ...mobile, colorScheme: "dark" }, testIgnore: ONCE },
  ],
});
