/** Writes the canonical, clearly labelled sample trade documents to tests/fixtures/. */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderCanonicalFixtures } from "@plimsoll/documents";

const dir = resolve(import.meta.dirname, "../tests/fixtures");
mkdirSync(dir, { recursive: true });
for (const [name, bytes] of Object.entries(await renderCanonicalFixtures())) {
  writeFileSync(resolve(dir, name), bytes);
  console.log(`wrote tests/fixtures/${name} (${bytes.length} bytes)`);
}
