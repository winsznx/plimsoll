/**
 * Writes tests/fixtures/packing-list-v1-scanned.pdf: the short-shipped packing list rasterised to a
 * greyscale page image with no text layer, so rule extraction reads nothing and the
 * model-assisted path is the only way to get values out of it. Needs poppler's `pdftoppm`.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { imageOnlyPdf, packingListSpec, renderTradeDocument } from "@plimsoll/documents";

const out = resolve(import.meta.dirname, "../tests/fixtures/packing-list-v1-scanned.pdf");
const work = mkdtempSync(join(tmpdir(), "plimsoll-scan-"));
try {
  const source = join(work, "source.pdf");
  writeFileSync(source, await renderTradeDocument(packingListSpec(false)));
  try {
    execFileSync("pdftoppm", ["-png", "-gray", "-r", "150", source, join(work, "page")]);
  } catch (e) {
    throw new Error(`pdftoppm failed (${e instanceof Error ? e.message : String(e)}). Install poppler, e.g. \`brew install poppler\` or \`apt-get install poppler-utils\`.`);
  }
  const pages = readdirSync(work)
    .filter((f) => f.startsWith("page") && f.endsWith(".png"))
    .sort()
    .map((f) => new Uint8Array(readFileSync(join(work, f))));
  const pdf = await imageOnlyPdf(pages, "Packing List (scanned copy)");
  writeFileSync(out, pdf);
  console.log(`wrote tests/fixtures/packing-list-v1-scanned.pdf (${pdf.length} bytes, ${pages.length} page image${pages.length === 1 ? "" : "s"})`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
