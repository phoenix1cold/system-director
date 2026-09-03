import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "system.json"), "utf8"));
const source = fs.readFileSync(path.join(root, "module/builder/formula-graph.mjs"), "utf8");
const start = source.indexOf("  _fnWireDetail(detail, fn, rerender) {");
const end = source.indexOf("  async _fnExport(fid) {", start);
assert.ok(start >= 0 && end > start, "Manage Functions wiring block is missing");
const block = source.slice(start, end);

assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
assert.match(block, /let updateQueue = Promise\.resolve\(\)/, "function edits must be serialized");
assert.match(block, /const applyDraft = f =>/, "one complete DOM draft must be saved");
assert.match(block, /rerenderDetail: false/, "draft saves must not replace focused fields");
assert.match(block, /addEventListener\("input", scheduleDraftSave\)/, "typing must autosave without rerendering");
assert.match(block, /addEventListener\("change", \(\) => \{ void flushDraft\(\); \}\)/, "blur must flush the current draft");
assert.doesNotMatch(block, /const debouncedSave =/, "legacy destructive manager rerender must be removed");
assert.doesNotMatch(block, /if \(ok\) \{ rerender\(\); this\._refreshPalette/, "ordinary draft saves must not always rerender the manager");

console.log("PASS: Manage Functions preserves focused name and pin drafts.");
