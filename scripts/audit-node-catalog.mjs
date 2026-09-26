// Palette audit for the Blueprint node catalog. Reports what docs/blueprint-review.md
// tracks: visible vs retired nodes per category, retired nodes whose replacement is
// itself retired, nodes hidden only by the "exposes a path" rule, untyped pins and
// oversized nodes. Usage: node scripts/audit-node-catalog.mjs [out.json]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

globalThis.document ??= {
  getElementById: () => ({}),
  createElement: () => ({ textContent: "", appendChild() {}, style: {} }),
  head: { appendChild() {} },
  body: { appendChild() {} }
};
globalThis.window ??= { addEventListener() {} };

const { NODE_DEFS, NODE_CATEGORIES, getNodeKind } = await import(
  pathToFileURL(path.join(root, "module/builder/formula-graph.mjs")).href
);

const PATH_FIELD_RE = /(^|_)(path|pathfilter|hppath|flagpath|saveattr|modifierpath|rerollpath|historypath|acpath)$/i;
const isUntyped = pin => !pin?.type || pin.type === "value" || pin.type === "value.any";
const isVisible = def => def && !def.hidden && !def.internal;

const nodes = Object.entries(NODE_DEFS).map(([id, def]) => {
  const inputs = def.inputs ?? [], outputs = def.outputs ?? [], fields = def.fields ?? [];
  return {
    id, cat: def.cat ?? "", title: def.title ?? id, kind: getNodeKind(def),
    visible: isVisible(def),
    replacement: def.replacement ?? null,
    replacementNodes: def.replacementNodes ?? null,
    inputs: inputs.length, outputs: outputs.length, fields: fields.length,
    untypedPins: [...inputs, ...outputs].filter(isUntyped).length,
    autoFieldPins: inputs.filter(p => p.__autoFromField).length,
    pathFields: fields.filter(f => f?.type === "path" || PATH_FIELD_RE.test(String(f?.key ?? ""))).map(f => f.key),
    flags: Object.keys(def).filter(k => /^is[A-Z]/.test(k) && def[k] === true)
  };
});
const byId = new Map(nodes.map(n => [n.id, n]));

const categories = {};
for (const n of nodes) {
  const entry = (categories[n.cat || "(none)"] ??= { total: 0, visible: 0, inPalette: NODE_CATEGORIES.some(c => c.id === n.cat) });
  entry.total++;
  if (n.visible) entry.visible++;
}

// A replacement string may name several nodes ("a + b") or annotate one ("a (pool mode)").
const replacementTargets = n => String(n.replacement ?? "")
  .split(/\s*[+/]\s*/).map(s => s.replace(/\(.*?\)/g, "").trim()).filter(t => byId.has(t));

// Widget-config nodes are internal by design (never in the palette), so a chain
// between two of them is not a palette regression.
const retiredToRetired = nodes
  .filter(n => !n.visible && n.replacement && !n.id.startsWith("wcfg_"))
  .map(n => ({ id: n.id, replacement: n.replacement, hiddenTargets: replacementTargets(n).filter(t => !byId.get(t).visible) }))
  .filter(r => r.hiddenTargets.length);

// Hidden by the blanket "exposesPath" rule rather than an explicit hidden:true.
const pathRuleHidden = nodes.filter(n => !n.visible && ["get_value", "set_value"].includes(n.replacement)
  && !["get_path", "get_widget_path"].includes(n.id))
  .map(n => ({ id: n.id, kind: n.kind, pathFields: n.pathFields }));

const visibleNodes = nodes.filter(n => n.visible);
const summary = {
  total: nodes.length,
  visible: visibleNodes.length,
  retired: nodes.length - visibleNodes.length,
  kinds: nodes.reduce((acc, n) => ((acc[n.kind] = (acc[n.kind] ?? 0) + 1), acc), {}),
  pins: nodes.reduce((a, n) => a + n.inputs + n.outputs, 0),
  untypedPins: nodes.reduce((a, n) => a + n.untypedPins, 0),
  autoFieldPins: nodes.reduce((a, n) => a + n.autoFieldPins, 0),
  visiblePins: visibleNodes.reduce((a, n) => a + n.inputs + n.outputs, 0),
  visibleUntypedPins: visibleNodes.reduce((a, n) => a + n.untypedPins, 0),
  emptyCategories: Object.entries(categories).filter(([, c]) => c.visible === 0).map(([id]) => id),
  hiddenEvents: nodes.filter(n => n.kind === "event" && !n.visible).map(n => n.id),
  bigVisibleNodes: visibleNodes.filter(n => n.fields >= 8).map(n => ({ id: n.id, fields: n.fields, inputs: n.inputs }))
};

const report = { generatedAt: new Date().toISOString(), summary, categories, retiredToRetired, pathRuleHidden, nodes };

console.log(`Nodes: ${summary.total} (visible ${summary.visible}, retired/internal ${summary.retired})`);
console.log(`Kinds: ${JSON.stringify(summary.kinds)}`);
console.log(`Untyped pins: ${summary.untypedPins}/${summary.pins} (auto-from-field ${summary.autoFieldPins}); visible only: ${summary.visibleUntypedPins}/${summary.visiblePins}`);
console.log(`Categories without visible nodes: ${summary.emptyCategories.join(", ") || "-"}`);
console.log(`Hidden events: ${summary.hiddenEvents.join(", ") || "-"}`);
console.log(`Retired -> retired replacement chains (${retiredToRetired.length}):`);
for (const r of retiredToRetired) console.log(`  ${r.id} -> ${r.replacement}   [hidden: ${r.hiddenTargets.join(", ")}]`);
console.log(`Hidden only by the path rule (${pathRuleHidden.length}):`);
for (const r of pathRuleHidden) console.log(`  ${r.id.padEnd(28)} ${r.kind.padEnd(11)} ${r.pathFields.join(",") || "(pin/title)"}`);
console.log("Visible nodes with >= 8 fields:", summary.bigVisibleNodes.map(n => `${n.id}(${n.fields})`).join(", "));

const outPath = process.argv[2];
if (outPath) {
  fs.writeFileSync(path.resolve(outPath), JSON.stringify(report, null, 2) + "\n");
  console.log(`Wrote ${outPath}`);
}
