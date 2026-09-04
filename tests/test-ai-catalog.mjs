import assert from "node:assert/strict";
import fs from "node:fs";
const manifest = JSON.parse(fs.readFileSync(new URL("../system.json", import.meta.url)));
const graph = fs.readFileSync(new URL("../module/builder/formula-graph.mjs", import.meta.url), "utf8");
const main = fs.readFileSync(new URL("../sd.mjs", import.meta.url), "utf8");
assert.match(manifest.version, /^1\.(11\.([1-9]|\d{2,})|(1[2-9]|[2-9]\d)\.\d+)$/, "unexpected manifest version");
for (const name of ["exportNodeCatalog", "validateGraphPlan", "importNodeTemplates"]) {
  assert.match(graph, new RegExp(`export (?:async )?function ${name}\\b`));
  assert.match(main, new RegExp(name));
}
assert.match(main, /game\.sd\.ai = SD_AI_API/);
assert.match(main, /game\.system\.api\.ai = SD_AI_API/);
assert.match(main, /globalThis\.SD = \{ ai: SD_AI_API/);
console.log("AI node catalog API: OK");
