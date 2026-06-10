import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function installDomStubs() {
  globalThis.document = globalThis.document ?? {
    getElementById: () => ({}),
    createElement: () => ({ textContent: "", appendChild() {} }),
    head: { appendChild() {} }
  };
  globalThis.window = globalThis.window ?? { addEventListener() {} };
}

function serialise(value) {
  return JSON.parse(JSON.stringify(value, (_key, val) => typeof val === "function" ? { __fn: true } : val));
}

function normaliseField(field) {
  if (!field || typeof field !== "object") return field;
  const out = { ...field };
  if ("def" in out && !("default" in out)) out.default = out.def;
  return out;
}

installDomStubs();
const [{ NODE_DEFS }, { WIDGET_TYPES, WIDGET_VARIANTS, WIDGET_PALETTE_ORDER }] = await Promise.all([
  import(path.join(root, "module/builder/formula-graph.mjs")),
  import(path.join(root, "module/builder/widget-registry.mjs"))
]);

const nodeOrder = Object.keys(NODE_DEFS);
const nodes = {};
for (const id of nodeOrder) {
  const def = serialise(NODE_DEFS[id]);
  def.id = def.id ?? id;
  def.inputs = (def.inputs ?? []).map(p => ({ ...p }));
  def.outputs = (def.outputs ?? []).map(p => ({ ...p }));
  def.fields = (def.fields ?? []).map(normaliseField);
  nodes[id] = def;
}

const byCat = {};
for (const id of nodeOrder) {
  const cat = nodes[id].cat || "Widget Config";
  (byCat[cat] ??= []).push(id);
}

const widgets = {};
const widgetOrder = [...new Set([...(WIDGET_PALETTE_ORDER ?? []), ...Object.keys(WIDGET_TYPES)])];
for (const id of widgetOrder) {
  const def = WIDGET_TYPES[id];
  if (!def) continue;
  widgets[id] = serialise(def);
  widgets[id].id = widgets[id].id ?? id;
  widgets[id].variants = WIDGET_VARIANTS[id] ?? [];
}

fs.writeFileSync(path.join(__dirname, "data/nodes.json"), JSON.stringify(nodes, null, 2) + "\n");
fs.writeFileSync(path.join(__dirname, "data/nodes-by-category.json"), JSON.stringify(byCat, null, 2) + "\n");
fs.writeFileSync(path.join(__dirname, "data/widgets.json"), JSON.stringify(widgets, null, 2) + "\n");
console.log(`Generated ${Object.keys(nodes).length} nodes and ${Object.keys(widgets).length} widgets.`);
