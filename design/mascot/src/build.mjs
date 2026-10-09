// Builds the model sheets and the comparison page: node design/mascot/src/build.mjs
import { writeFileSync } from "node:fs";
import { concepts } from "./concepts.mjs";
import { comparisonPage } from "./page.mjs";
import { sheet } from "./sheet.mjs";

const out = new URL("../", import.meta.url);
for (const c of concepts) {
  writeFileSync(new URL(`${c.id}-model-sheet.svg`, out), sheet(c, { standalone: true }));
}
writeFileSync(new URL("index.html", out), comparisonPage(concepts));
