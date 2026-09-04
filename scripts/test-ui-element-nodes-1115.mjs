/**
 * 1.11.5 — per-element UI Blueprint nodes + settings node graph removal.
 *
 *  - The Node Graph section is gone from System Configuration (an idle output
 *    node hung around there and the graph had no purpose).
 *  - Every UI Blueprint element type gets its own Get/Set node pair, exactly
 *    like sheet widgets do, with typed pins (a List really takes and returns an
 *    array).
 *  - Elements are chosen from a dropdown of elements placed in the blueprint.
 *  - `UIWidgetState.getVar()` never existed, so the legacy UI Get nodes always
 *    read an empty value. They now go through `getVariable`/`getWidgetProperty`.
 */

import assert from "node:assert/strict";
import fs from "node:fs";

const read = name => fs.readFileSync(new URL(`../${name}`, import.meta.url), "utf8");

// ---------------------------------------------------------------------------
// Foundry stubs
// ---------------------------------------------------------------------------

const getProperty = (object, path) => String(path ?? "").split(".").reduce((value, key) => value?.[key], object);
const setProperty = (object, path, value) => {
  const keys = String(path).split(".");
  let cursor = object;
  for (const key of keys.slice(0, -1)) cursor = cursor[key] ??= {};
  cursor[keys.at(-1)] = value;
};
const deepClone = value => value === undefined ? undefined : structuredClone(value);

class DummyField { constructor(...args) { this.args = args; } }
const fieldProxy = new Proxy({}, { get: () => DummyField });

globalThis.foundry = {
  utils: {
    randomID: (n = 10) => "abcdefghij".slice(0, n),
    deepClone, getProperty, setProperty, escapeHTML: String,
    mergeObject: (a, b, { inplace = true } = {}) => Object.assign(inplace ? a : deepClone(a), deepClone(b))
  },
  abstract: { TypeDataModel: class { static defineSchema() { return {}; } }, DataModel: class {} },
  data: { fields: fieldProxy },
  applications: { api: { DialogV2: class {} } }
};

const userFlags = {};
globalThis.game = {
  user: {
    id: "gm", isGM: true,
    getFlag: (_scope, key) => getProperty(userFlags, key),
    setFlag: async (_scope, key, value) => setProperty(userFlags, key, value)
  },
  users: { contents: [
    { id: "gm", name: "GM", isGM: true, active: true },
    { id: "p1", name: "Player One", isGM: false, active: true }
  ] },
  actors: { get: () => null, getName: () => null },
  items: [],
  settings: { get: () => "all" },
  socket: { emit() {} },
  i18n: { localize: key => key, format: key => key }
};
globalThis.ui = { notifications: { warn() {}, error() {}, info() {} } };
globalThis.CONFIG = { SD: {} };
globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OWNER: 3 } };
globalThis.Hooks = { on() {}, once() {}, off() {}, call() {}, callAll() {} };
globalThis.fromUuidSync = () => null;

// Fake node registry + runtime, same extension points the system exposes.
const nodes = new Map();
const tokens = new Map();
const actions = new Map();
globalThis.SD = {
  nodeRegistry: {
    registerNode: (id, def) => nodes.set(id, def),
    registerCategory: () => {}
  }
};
globalThis.SD_NODE_RUNTIME = {
  registerToken: (prefix, handler) => tokens.set(prefix, handler),
  registerAction: (type, handler) => actions.set(type, handler)
};

// ---------------------------------------------------------------------------
// 1. Settings node graph is gone, localization survived
// ---------------------------------------------------------------------------

const hbs = read("templates/config/system-config.hbs");
const configApp = read("module/helpers/system-config.mjs");

assert.ok(!hbs.includes("editDatabaseGraph"), "settings template must not open a node graph");
assert.ok(!hbs.includes("Node Graph"), "settings template must not show a Node Graph section");
assert.ok(!configApp.includes("_onEditDatabaseGraph"), "the settings graph handler must be gone");
assert.ok(!configApp.includes("databaseGraph.hasGraph"), "no graph context is prepared for settings");

// the rest of System Configuration is untouched
assert.ok(hbs.includes('{{localize "SD.Settings.Localization"}}'), "localization section survives");
assert.ok(hbs.includes('data-action="addLanguage"'), "language creation survives");
assert.ok(hbs.includes('name="localizationLanguage"'), "display language picker survives");
assert.ok(hbs.includes('data-action="saveAndClose"'), "settings can still be saved");
assert.ok(configApp.includes("_onEditCalcGraph"), "calculation graphs still open");
assert.ok(configApp.includes("_onEditInitiativeGraph"), "initiative graph still opens");
// stored graph data is kept so nothing is lost in existing worlds
assert.ok(configApp.includes("databaseGraph: { nodes: [], edges: [], comments: [] }"), "stored graph data is preserved");

// ---------------------------------------------------------------------------
// 2. Element picker + element index in the graph editor
// ---------------------------------------------------------------------------

const graph = read("module/builder/formula-graph.mjs");
assert.ok(graph.includes("uiElements:[]"), "smart index tracks placed UI elements");
assert.ok(graph.includes("_collectUiElements"), "placed UI elements are collected");
assert.ok(graph.includes('field.type==="ui-element-picker"'), "the element picker field renders");
assert.ok(graph.includes("- no element placed -"), "the picker explains an empty blueprint");
assert.ok(graph.includes('field.type==="widget-picker"'), "the sheet widget picker still renders");

// ---------------------------------------------------------------------------
// 3. getVar() never existed on UIWidgetState
// ---------------------------------------------------------------------------

const legacyNodes = read("module/ui-blueprint/ui-widget-nodes.mjs");
const elements = read("module/ui-blueprint/ui-widget-elements.mjs");
const runtime = read("module/ui-blueprint/ui-widget-runtime.mjs");

assert.ok(!legacyNodes.includes("getVar?.("), "legacy UI nodes no longer call the missing getVar()");
assert.ok(!elements.includes("getVar?.("), "the List element no longer calls the missing getVar()");
assert.ok(!elements.includes("setVar?.("), "the List element no longer calls the missing setVar()");
assert.ok(legacyNodes.includes("function readVar(rec, name)"), "a real variable reader was added");
for (const legacy of ['registerNode("ui_get_field"', 'registerNode("ui_set_field"',
                      'registerNode("ui_list_get"', 'registerNode("ui_list_set"']) {
  assert.ok(legacyNodes.includes(legacy), `existing graphs keep working: ${legacy}`);
}
assert.ok(runtime.includes("hasWidgetProperty"), "the renderer honours node written property overrides");

// ---------------------------------------------------------------------------
// 4. A node pair per element type
// ---------------------------------------------------------------------------

const { UI_ELEMENT_TYPES, elementDef } = await import("../module/ui-blueprint/ui-widget-elements.mjs");
const { UIWidgetState } = await import("../module/ui-blueprint/ui-widget-state.mjs");
const { registerInstance } = await import("../module/ui-blueprint/ui-widget-registry.mjs");
const elementNodes = await import("../module/ui-blueprint/ui-element-nodes.mjs");

elementNodes.initUIElementNodes();

const types = Object.keys(UI_ELEMENT_TYPES);
assert.ok(types.length >= 20, `expected the full element palette, got ${types.length}`);

for (const type of types) {
  const get = nodes.get(`ui_el_get_${type}`);
  const set = nodes.get(`ui_el_set_${type}`);
  assert.ok(get, `missing Get node for element type '${type}'`);
  assert.ok(set, `missing Set node for element type '${type}'`);

  assert.ok(get.outputs.length >= 1, `'${type}' Get node needs outputs`);
  assert.equal(get.cat, "UI Elements");
  const getPicker = get.fields.find(field => field.type === "ui-element-picker");
  assert.ok(getPicker, `'${type}' Get node must offer the placed-element dropdown`);
  assert.equal(getPicker.elementType, type, `'${type}' Get picker must be filtered to its own type`);
  assert.match(get.compile({ data: { elementRef: "x" } }, {}), new RegExp(`^\\{sdUiElement:${type}:`),
    `'${type}' Get node must compile to an element token`);

  assert.equal(set.isAction, true, `'${type}' Set node must be an action`);
  assert.ok(set.inputs.some(pin => pin.id === "exec"), `'${type}' Set node needs an exec input`);
  assert.ok(set.outputs.some(pin => pin.id === "exec"), `'${type}' Set node needs an exec output`);
  const setPicker = set.fields.find(field => field.type === "ui-element-picker");
  assert.ok(setPicker, `'${type}' Set node must offer the placed-element dropdown`);
  assert.equal(setPicker.elementType, type);
  const propertyField = set.fields.find(field => field.key === "property");
  assert.ok(propertyField?.options?.length, `'${type}' Set node must list settable properties`);
  assert.equal(set.toAction({ data: {} }, {}).type, "sdUiElementSet");
}

// Typed pins: containers and lists speak arrays, numbers speak numbers.
const listGet = nodes.get("ui_el_get_list");
const listSet = nodes.get("ui_el_set_list");
assert.equal(listGet.outputs.find(pin => pin.id === "items").type, "value.array",
  "Get List must return a real array");
assert.equal(listSet.inputs.find(pin => pin.id === "value").type, "value.array",
  "Set List must accept a real array");
assert.equal(listSet.fields.find(field => field.key === "property").default, "source",
  "Set List targets the row source by default");
assert.equal(elementNodes.setValuePinType("list"), "value.array");
assert.equal(elementNodes.setValuePinType("slider"), "value.number");
assert.equal(elementNodes.setValuePinType("checkbox"), "value.bool");
assert.equal(elementNodes.setValuePinType("canvas"), "value.array");
assert.equal(nodes.get("ui_el_get_canvas").outputs.find(pin => pin.id === "children").type, "value.array");
assert.equal(nodes.get("ui_el_get_slider").outputs.find(pin => pin.id === "percent").type, "value.number");
assert.equal(nodes.get("ui_el_get_checkbox").outputs.find(pin => pin.id === "value").type, "value.bool");
assert.equal(nodes.get("ui_el_get_dropdown").outputs.find(pin => pin.id === "choices").type, "value.array");
assert.match(listGet.compilePin({ data: { elementRef: "loot-list" } }, {}, "count"), /:count:/);

// ---------------------------------------------------------------------------
// 5. Reading and writing a live window
// ---------------------------------------------------------------------------

const blueprint = {
  id: "bp", uuid: "Item.bp", name: "Hero HUD", type: "uiwidget", isOwner: true,
  system: {
    schemaVersion: 3, blueprintId: "hero-hud", widgetKey: "hero-hud", worldState: {},
    variables: [{ id: "loot", name: "Loot", type: "array", scope: "instance", default: [] }],
    elements: [
      { id: "loot-list", name: "LootList", type: "list", props: { source: "", labelKey: "name" }, bind: {} },
      { id: "hp-bar", name: "HpBar", type: "progress", props: { value: 3, max: 10 }, bind: {} },
      { id: "root", name: "Root", type: "canvas", props: {}, bind: {} },
      { id: "child-1", name: "Child", type: "label", parent: "root", props: { text: "Hello" }, bind: {} }
    ]
  }
};
game.items = [blueprint];

const state = new UIWidgetState(blueprint, { actor: null, item: null, initial: {} });
registerInstance({ id: "inst-1", widgetKey: "hero-hud", state });

const token = tokens.get("sdUiElement:");
assert.ok(typeof token === "function", "the element value token must be registered");
const enc = value => `b64:${Buffer.from(String(value ?? ""), "utf8").toString("base64")}`;
const pin = (type, name, ref, instance = "inst-1", property = "") =>
  token(`${type}:${name}:${enc(ref)}|${enc(instance)}|${enc(property)}`, {});

// numbers / derived pins
assert.equal(pin("progress", "value", "hp-bar"), 3);
assert.equal(pin("progress", "max", "hp-bar"), 10);
assert.equal(pin("progress", "percent", "hp-bar"), 30);
assert.equal(pin("progress", "full", "hp-bar"), 0);
// elements resolve by name too, not only by id
assert.equal(pin("progress", "percent", "HpBar"), 30);
// containers expose their children
assert.deepEqual(pin("canvas", "children", "root"), [{ id: "child-1", name: "Child", type: "label" }]);
assert.equal(pin("canvas", "count", "root"), 1);
assert.equal(pin("label", "value", "child-1"), "Hello");
// arbitrary property pin
assert.equal(pin("progress", "prop", "hp-bar", "inst-1", "max"), 10);
// unknown element resolves to an empty value instead of throwing
assert.equal(pin("list", "items", "nope"), "");

// a real array in, a real array out
await state.setWidgetProperty("loot-list", "source", [{ name: "Sword" }, { name: "Shield" }]);
assert.deepEqual(pin("list", "items", "loot-list"), [{ name: "Sword" }, { name: "Shield" }]);
assert.equal(pin("list", "count", "loot-list"), 2);
assert.equal(pin("list", "csv", "loot-list"), "Sword, Shield");
assert.deepEqual(pin("list", "labels", "loot-list"), ["Sword", "Shield"]);
assert.deepEqual(pin("list", "first", "loot-list"), { name: "Sword" });

// the clicked row is stored in `<element>__index` and read back by the node
await state.setVariable("LootList__index", 1);
assert.equal(pin("list", "index", "loot-list"), 1);
assert.deepEqual(pin("list", "selected", "loot-list"), { name: "Shield" });

// ---------------------------------------------------------------------------
// 6. The Set action, including array modes
// ---------------------------------------------------------------------------

const setAction = actions.get("sdUiElementSet");
assert.ok(typeof setAction === "function", "the element write action must be registered");

const run = async (overrides) => setAction({
  resolveValue: value => value,
  action: {
    type: "sdUiElementSet", elementType: "list", widgetKey: "hero-hud",
    elementRef: enc("loot-list"), property: "source", mode: "set", value: [], ...overrides
  }
});

await run({ mode: "append", value: [{ name: "Potion" }] });
assert.equal(pin("list", "count", "loot-list"), 3, "append must extend the array");

await run({ mode: "prepend", value: [{ name: "Torch" }] });
assert.deepEqual(pin("list", "first", "loot-list"), { name: "Torch" }, "prepend must insert in front");

await run({ mode: "remove", value: [{ name: "Sword" }] });
assert.deepEqual(pin("list", "labels", "loot-list"), ["Torch", "Shield", "Potion"], "remove must drop matches");

// CSV / JSON text is still accepted where an array is expected
await run({ mode: "set", value: "Rope, Chalk" });
assert.deepEqual(pin("list", "labels", "loot-list"), ["Rope", "Chalk"], "text is coerced into rows");
await run({ mode: "set", value: '[{"name":"Map"}]' });
assert.deepEqual(pin("list", "items", "loot-list"), [{ name: "Map" }], "JSON text is coerced into rows");

await run({ mode: "clear" });
assert.deepEqual(pin("list", "items", "loot-list"), [], "clear must empty the array");

// numbers and universal properties
await setAction({
  resolveValue: value => value,
  action: { elementType: "progress", widgetKey: "hero-hud", elementRef: enc("hp-bar"), property: "value", mode: "add", value: 4 }
});
assert.equal(pin("progress", "value", "hp-bar"), 7, "add must accumulate");
assert.equal(pin("progress", "percent", "hp-bar"), 70);

await setAction({
  resolveValue: value => value,
  action: { elementType: "progress", widgetKey: "hero-hud", elementRef: enc("hp-bar"), property: "visible", mode: "set", value: false }
});
assert.equal(pin("progress", "visible", "hp-bar"), 0, "universal properties are writable");

await setAction({
  resolveValue: value => value,
  action: { elementType: "progress", widgetKey: "hero-hud", elementRef: enc("hp-bar"), property: "visible", mode: "reset" }
});
assert.equal(pin("progress", "visible", "hp-bar"), 1, "reset restores the designed value");
assert.equal(state.hasWidgetProperty("hp-bar", "visible"), false, "reset drops the override");

// ---------------------------------------------------------------------------
// 7. Manifest
// ---------------------------------------------------------------------------

const manifest = JSON.parse(read("system.json"));
assert.match(manifest.version, /^1\.(11\.([5-9]|\d{2,})|(1[2-9]|[2-9]\d)\.\d+)$/,
  `unexpected version ${manifest.version}`);
assert.ok(elementDef("list"), "the list element definition is still registered");

console.log(`PASS: settings graph removed, ${types.length * 2} per-element UI nodes with typed array pins (1.11.5).`);
