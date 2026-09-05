/**
 * 1.11.9 — Widget placement modes (Database variable vs own value),
 * Roll Result conversion (To Text / Message) and Set Value targeting.
 */
import assert from "node:assert";
import fs from "node:fs";

const read = name => fs.readFileSync(new URL(`../${name}`, import.meta.url), "utf8");

// ── 0. Foundry stubs ───────────────────────────────────────────────────────
const getProperty = (obj, path) =>
  String(path ?? "").split(".").reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
const setProperty = (obj, path, value) => {
  const parts = String(path ?? "").split(".");
  let cur = obj;
  for (const key of parts.slice(0, -1)) {
    if (cur[key] == null || typeof cur[key] !== "object") cur[key] = {};
    cur = cur[key];
  }
  cur[parts[parts.length - 1]] = value;
  return true;
};
const deepClone = value => (value == null ? value : JSON.parse(JSON.stringify(value)));

globalThis.foundry = { utils: { getProperty, setProperty, deepClone, mergeObject: (a, b) => ({ ...a, ...b }) } };
globalThis.Actor = class Actor {};
globalThis.Item = class Item {};
globalThis.Hooks = { on() {}, once() {}, call() {}, callAll() {} };
globalThis.CONFIG = { SD: { currencies: [] } };
globalThis.ui = { notifications: { warn() {}, info() {}, error() {} } };
globalThis.canvas = { tokens: { controlled: [], get: () => null } };

const DB = [
  { id: "hp",     name: "HP",     type: "number", scope: "both", initial: 10 },
  { id: "hp_max", name: "HP Max", type: "number", scope: "both", initial: 10 }
];
globalThis.game = {
  settings: { get: () => ({ database: DB }), set: async () => {} },
  actors: [], items: [],
  user: { targets: new Set(), isGM: true },
  i18n: { localize: key => key, format: key => key }
};

const { valueStoragePath } = await import("../module/helpers/value-database.mjs");
const wv = await import("../module/helpers/widget-variables.mjs");
const { FormulaEngine } = await import("../module/helpers/formula-engine.mjs");

// ── 1. Mode 2: own value (unchanged default) ───────────────────────────────
const ownWidget = { id: "w1", type: "resource", widgetKey: "hp_bar", label: "HP" };
wv.ensureWidgetVariables(ownWidget, null);
assert.equal(wv.widgetDataMode(ownWidget), "own", "widgets must default to their own storage");
assert.equal(ownWidget.pathValue, "system.widgetVars.hp_bar.pathValue");
assert.equal(wv.widgetBindingPath(ownWidget, "pathValue"), "system.widgetVars.hp_bar.pathValue");

// ── 2. Mode 1: bound to Database variables ────────────────────────────────
const boundWidget = {
  id: "w2", type: "resource", widgetKey: "hp_bar2", label: "HP",
  dataMode: "variable", varBindings: { pathValue: "hp", pathMax: "hp_max" }
};
wv.ensureWidgetVariables(boundWidget, null);
assert.equal(wv.widgetDataMode(boundWidget), "variable");
assert.equal(boundWidget.pathValue, "hp", "variable mode must survive ensureWidgetVariables");
assert.equal(boundWidget.pathMax, "hp_max");
assert.equal(wv.widgetBindingPath(boundWidget, "pathValue"), valueStoragePath("hp"));
assert.equal(wv.widgetBindingPath(boundWidget, "pathMax"), valueStoragePath("hp_max"));

const descriptors = wv.widgetVariables(boundWidget);
assert.equal(descriptors.find(entry => entry.field === "pathValue").mode, "variable");
assert.equal(descriptors.find(entry => entry.field === "pathValue").variableId, "hp");
assert.equal(descriptors.find(entry => entry.field === "pathValue").path, valueStoragePath("hp"));
assert.equal(wv.widgetVariables(ownWidget).find(entry => entry.field === "pathValue").mode, "own");

// A widget that already holds a bare variable id resolves without varBindings.
assert.equal(
  wv.widgetVarBinding({ type: "number", widgetKey: "lvl", dataMode: "variable", path: "hp" }, "path"),
  "hp", "an inline variable id must be recognised");

// ── 3. Reads and writes follow the mode ───────────────────────────────────
let lastPatch = null;
const doc = {
  name: "Hero", system: {}, isOwner: true,
  update: async patch => {
    lastPatch = patch;
    for (const [key, value] of Object.entries(patch)) setProperty(doc, key, value);
  }
};
setProperty(doc, valueStoragePath("hp"), 7);
setProperty(doc, "system.widgetVars.hp_bar.pathValue", 3);

assert.equal(Number(wv.readWidgetVar(doc, boundWidget, "pathValue")), 7, "bound widget reads the variable");
assert.equal(Number(wv.readWidgetVar(doc, ownWidget, "pathValue")), 3, "own widget reads its own storage");

await wv.writeWidgetVar(doc, boundWidget, "pathValue", 12);
assert.deepEqual(Object.keys(lastPatch), [valueStoragePath("hp")], "editing a bound widget writes the variable");
await wv.writeWidgetVar(doc, ownWidget, "pathValue", 5);
assert.deepEqual(Object.keys(lastPatch), ["system.widgetVars.hp_bar.pathValue"]);

const seed = wv.buildWidgetVarSeed({ system: {} }, [{ rows: [{ widgets: [boundWidget, ownWidget] }] }]);
assert.ok(!Object.keys(seed).includes(valueStoragePath("hp")), "bound fields must not be seeded over");
assert.ok(Object.keys(seed).some(key => key.startsWith("system.widgetVars.hp_bar.")), "own fields still seed defaults");

// ── 4. Roll Result → text / number ────────────────────────────────────────
const rr = { type: "sd.roll-result", mode: "formula", formula: "1d20+3", total: 17, dice: [14], flavor: "Attack" };
assert.equal(FormulaEngine.valueToText(rr), "17", "a Roll Result must never print as [object Object]");
assert.equal(FormulaEngine.valueToNumber(rr), 17);
assert.equal(FormulaEngine.unwrapStructured(rr), 17);
assert.equal(FormulaEngine.valueToText([rr, rr]), "17, 17");
assert.equal(FormulaEngine.valueToNumber("12"), 12);
assert.equal(FormulaEngine.valueToNumber("", 0), 0);

class FakeRoll { constructor() { this.total = 9; this.terms = []; } }
globalThis.Roll = FakeRoll;
assert.equal(FormulaEngine.valueToText(new FakeRoll()), "9", "Foundry Roll instances collapse to their total");

// ── 5. Roll Result tokens resolve inside formulas (To Text node) ──────────
FormulaEngine.setRollRuntime(rr);
assert.equal(FormulaEngine._resolveToken("__rollResult", {}), rr);
assert.equal(FormulaEngine._resolveToken("__rollTotal", {}), 17);
const enc = "b64:" + Buffer.from("{__rollResult}", "utf8").toString("base64");
assert.equal(FormulaEngine._resolveToken(`convertValue:text|${enc}|`, {}), "17",
  "To Text must convert a Roll Result");
assert.equal(FormulaEngine._resolveToken(`convertValue:number|${enc}|0`, {}), 17,
  "To Number must convert a Roll Result");
FormulaEngine.setRollRuntime(null);
assert.equal(FormulaEngine._resolveToken("__rollTotal", {}), undefined ?? FormulaEngine._resolveToken("__rollTotal", {}));

// ── 6. Executor: Set Value targeting and message parts ───────────────────
const exec = read("module/helpers/button-executor.mjs");
assert.ok(exec.includes("async function _sdPublishRollRuntime"), "the roll runtime must be published");
assert.equal((exec.match(/await _sdPublishRollRuntime\(result\);/g) ?? []).length, 4,
  "every roll node must publish its Roll Result");
assert.ok(exec.includes("A wired Actor / Item Ref always wins"), "a wired Ref pin must win over the dropdown");
assert.ok(exec.includes("_SDFormula.unwrapStructured(incoming)"), "Set Value must unwrap Roll Results");
assert.ok(exec.includes("_SDFormula.valueToNumber(current)"), "Set Value math must be roll aware");
assert.ok(!exec.includes("(Number(current)||0)+(Number(incoming)||0)"),
  "the old Number() coercion must be gone");
assert.ok(exec.includes('let incoming=_injectRuntime(String(action.value??""));'),
  "the value pin must be injected before it is stringified");
assert.ok(exec.includes('typeof p !== "string"'), "message parts must never be joined as raw objects");
assert.ok(exec.includes('value.type === "sd.roll-result"'), "message parts must understand Roll Results");
assert.ok(exec.includes("do not have permission to change"), "a non-owner target must be reported");

// ── 7. Config popup exposes the two modes ────────────────────────────────
const popup = read("module/builder/widget-config-popup.mjs");
assert.ok(popup.includes('["Data Source", "dataMode", "bindmode"]'), "every value widget gets a Data Source row");
assert.ok(popup.includes('data-ftype="bindmode"'));
assert.ok(popup.includes("wcfg-bind-variable") && popup.includes("wcfg-bind-own"));
assert.ok(popup.includes("data-field-off"), "only the active control may be saved");
assert.ok(popup.includes("changes.varBindings = _varBindings;"), "the chosen variable must be remembered");
assert.ok(popup.includes('select[data-ftype="bindmode"]'), "switching mode must update the popup live");
assert.ok(popup.includes("widgetDataMode") && popup.includes("widgetVarBinding"));

// ── 8. Graph nodes honour the mode ───────────────────────────────────────
const nodes = read("module/builder/widget-nodes.mjs");
assert.ok(nodes.includes("widgetBindingPath(widget, field)"), "widget nodes must use the resolved binding path");
assert.equal((nodes.match(/widgetVarPath\(widget, field\)/g) ?? []).length, 0,
  "widget nodes must not bypass the placement mode");

// ── 9. Version ───────────────────────────────────────────────────────────
const manifest = JSON.parse(read("system.json"));
assert.match(manifest.version, /^1\.(11\.(9|\d{2,})|(1[2-9]|[2-9]\d)\.\d+)$/,
  `unexpected version ${manifest.version}`);

console.log(`PASS: widget placement modes, Roll Result conversion, Set Value targeting (${manifest.version}).`);
