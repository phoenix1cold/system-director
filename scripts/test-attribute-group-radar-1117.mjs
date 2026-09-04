/**
 * System Director tests
 * 1.11.7 - Attribute Group radar variant, element-key dropdowns, Database variable pickers.
 */
import assert from "node:assert";
import fs from "node:fs";

const read = name => fs.readFileSync(new URL(`../${name}`, import.meta.url), "utf8");

const renderer = read("module/builder/widget-renderer.mjs");
const registry = read("module/builder/widget-registry.mjs");
const popup = read("module/builder/widget-config-popup.mjs");
const nodes = read("module/builder/widget-nodes.mjs");
const graph = read("module/builder/formula-graph.mjs");
const css = read("styles/sd-widget-variants.css");
const sheet = read("module/sheets/character-sheet.mjs");
const manifest = JSON.parse(read("system.json"));

// 1. Radar variant renders a diagram and nothing else -----------------------
assert.ok(renderer.includes("static _render_attributeGroup_radar(w, items, lbl, ic)"), "the radar renderer must exist");
assert.ok(renderer.includes('this._sanitizeVariant(w.variant) === "radar"'), "the radar variant must be dispatched");

const radarStart = renderer.indexOf("static _render_attributeGroup_radar");
const radarEnd = renderer.indexOf("static _render_attributeGroup(w, doc)", radarStart);
assert.ok(radarStart > 0 && radarEnd > radarStart, "the radar renderer must sit next to the widget renderer");
const radarBody = renderer.slice(radarStart, radarEnd);

assert.ok(radarBody.includes('class="attr-radar-ring"'), "radar must draw grid rings");
assert.ok(radarBody.includes('class="attr-radar-axis"'), "radar must draw axis lines");
assert.ok(radarBody.includes('class="attr-radar-shape"'), "radar must draw the data polygon");
assert.ok(radarBody.includes('class="attr-radar-dot"'), "radar must draw draggable-looking vertices");
assert.ok(!radarBody.includes("attr-item-score"), "the radar variant must not render the attribute list");
assert.ok(!radarBody.includes("sd-hud-pop-row"), "the radar variant must not render the popover list");

// Clicking an axis or a vertex must fire the widget's On Click event.
assert.ok(radarBody.includes('data-action="wbElement"'), "radar hit areas must use the wbElement click contract");
assert.ok(radarBody.includes("data-element-key="), "radar hit areas must carry the element key");
assert.ok(radarBody.includes("data-event-name="), "radar hit areas must name the click event");
assert.strictEqual((radarBody.match(/hit\(it\)/g) ?? []).length, 2, "both the vertex and the label group must be clickable");

// 2. Attribute keys come from Database variables -----------------------------
assert.ok(renderer.includes("Array.isArray(w.attributeKeys)"), "attributeKeys must accept an array");
assert.ok(renderer.includes("valueStoragePath(dbDef.id)"), "Database variables must resolve to their own storage path");
assert.ok(renderer.includes("tokens = rawKeys.map(parseToken)"), "the resolved list must drive the rendered attributes");
assert.ok(renderer.includes("const name   = dbName"), "the Database variable name must win over a guessed label");

// 3. Widget settings offer a dropdown, not a text field ----------------------
assert.ok(popup.includes('"attributeKeys","dbvarlist"'), "the widget popup must offer a Database variable multi-select");
assert.ok(!popup.includes('"attributeKeys","text"'), "the manual comma-separated field must be gone");
assert.ok(popup.includes('"radarMax","number"'), "the radar scale must be configurable");
assert.ok(registry.includes('"tactical", "radar"]'), "radar must be a registered attributeGroup variant");
assert.ok(registry.includes('key: "attributeKeys", type: "dbvarlist"'), "the registry config field must use the dropdown");
assert.ok(registry.includes("attributeKeys: []"), "the default must be an empty list");

// 4. Element key is a dropdown on the dedicated Attribute Group node --------
assert.ok(nodes.includes('attributeGroup: [["score"'), "Attribute Group needs its own typed pins");
assert.ok(nodes.includes('type: "widget-element-picker"'), "the Get node must use the element dropdown");
assert.ok(nodes.includes("const EXTRA_GET_FIELDS"), "per-type extra fields must exist");
assert.ok(nodes.includes("elementSuffix(type, n, i)"), "the picked element must travel with the compiled token");
assert.ok(nodes.includes('tail.join(":").split("|")'), "the token must carry an optional element key");
assert.ok(nodes.includes("entry?.[3]?.(widget, doc, elementKey)"), "pin getters must receive the element key");

// 5. Element key is a dropdown on the event node ----------------------------
assert.ok(graph.includes('label:"Element Key (optional)",type:"widget-element-picker"'), "On Sheet Widget Event must use the dropdown");
assert.ok(graph.includes('if(field.type==="widget-element-picker")'), "the graph must render the element picker");
assert.ok(graph.includes("elements: _widgetElementKeys(w)"), "the smart index must list every widget's elements");
assert.ok(graph.includes("const _widgetElementKeys"), "the element key collector must exist");
assert.ok(graph.includes('"- pick the widget first -"'), "the picker must explain an empty widget selection");

// 6. Ordinary clicks report their element key, styles exist ------------------
assert.ok(sheet.includes('target?.closest?.("[data-element-key]")?.dataset?.elementKey'), "widget clicks must report the clicked element key");
assert.ok(css.includes(".sd-v-radar .attr-radar-shape"), "radar styles must exist");
assert.ok(css.includes(".sd-v-radar .attr-radar-dot"), "radar vertices must be styled");

// 7. Runtime: element resolution and token reads ----------------------------
globalThis.Hooks = { once: () => {}, on: () => {}, off: () => {}, call: () => {}, callAll: () => {} };
globalThis.ui = { notifications: { warn: () => {}, error: () => {}, info: () => {} } };
globalThis.game = {
  settings: { get: () => [], set: async () => {}, register: () => {} },
  i18n: { localize: key => key, format: key => key },
  items: [], actors: [], user: { isGM: true }
};
const getProperty = (obj, path) => String(path ?? "").split(".").reduce((acc, part) => (acc == null ? acc : acc[part]), obj);
globalThis.foundry = {
  utils: {
    getProperty,
    setProperty: () => {},
    deepClone: value => structuredClone(value),
    mergeObject: (a, b) => ({ ...a, ...b }),
    randomID: () => "id0000"
  }
};
globalThis.CONFIG = {
  SD: {
    attributes: { str: "Strength", dex: "Dexterity", con: "Constitution" },
    attributesEnabled: {},
    computeModifier: score => Math.floor((Number(score) - 10) / 2)
  }
};

const tokens = {};
globalThis.SD_NODE_RUNTIME = {
  registerToken: (prefix, handler) => { tokens[prefix] = handler; },
  registerAction: () => {}
};

const mod = await import("../module/builder/widget-nodes.mjs");

const widget = {
  id: "w1", type: "attributeGroup", widgetKey: "attrs", label: "Attributes",
  attributeKeys: ["str", "dex", "con"]
};
const doc = {
  documentName: "Actor",
  uuid: "Actor.1",
  system: {
    attributes: { str: { value: 16 }, dex: { value: 12 }, con: { value: 9 } },
    customTabs: [{ rows: [{ widgets: [widget] }] }]
  }
};

const entries = mod.attributeGroupEntries(widget, doc);
assert.strictEqual(entries.length, 3, "every listed attribute must resolve");
assert.deepStrictEqual(entries.map(entry => entry.key), ["str", "dex", "con"], "keys keep their configured order");
assert.deepStrictEqual(entries.map(entry => entry.score), [16, 12, 9], "scores must be read from the document");
assert.deepStrictEqual(entries.map(entry => entry.mod), [3, 1, -1], "modifiers must use the system formula");
assert.deepStrictEqual(entries.map(entry => entry.name), ["Strength", "Dexterity", "Constitution"], "labels must be resolved");

assert.strictEqual(mod.attributeGroupEntry(widget, doc, "dex").score, 12, "the element key must select one attribute");
assert.strictEqual(mod.attributeGroupEntry(widget, doc, "Constitution").score, 9, "a display name must also match");
assert.strictEqual(mod.attributeGroupEntry(widget, doc, "").key, "str", "a blank element key falls back to the first attribute");
assert.strictEqual(mod.attributeGroupEntry(widget, doc, "nope"), null, "an unknown element key resolves to nothing");

assert.deepStrictEqual(
  mod.attributeGroupKeys({ attributeKeys: " str , dex " }),
  ["str", "dex"],
  "legacy comma-separated keys must still parse"
);

mod.installWidgetTokens();
const reader = tokens["sdWidget:"];
assert.ok(typeof reader === "function", "the widget token must be registered");

const enc = value => `b64:${Buffer.from(String(value), "utf8").toString("base64")}`;
const ctx = { doc };
assert.strictEqual(String(reader(`attributeGroup:score:${enc("attrs")}|${enc("con")}`, ctx)), "9", "the token must read the picked element");
assert.strictEqual(String(reader(`attributeGroup:mod:${enc("attrs")}|${enc("dex")}`, ctx)), "1", "the modifier pin must follow the element key");
assert.strictEqual(String(reader(`attributeGroup:score:${enc("attrs")}`, ctx)), "16", "a legacy token without an element key still works");
assert.strictEqual(String(reader(`attributeGroup:count:${enc("attrs")}`, ctx)), "3", "aggregate pins ignore the element key");
assert.strictEqual(String(reader(`attributeGroup:name:${enc("attrs")}|${enc("dex")}`, ctx)), "Dexterity", "the name pin must follow the element key");

const arrayPin = reader(`attributeGroup:scores:${enc("attrs")}`, ctx);
assert.ok(Array.isArray(arrayPin), "the scores pin must stay an array");
assert.deepStrictEqual(arrayPin, [16, 12, 9], "the scores pin must list every attribute");

// 8. Manifest -----------------------------------------------------------------
assert.match(
  manifest.version,
  /^1\.(11\.([7-9]|\d{2,})|(1[2-9]|[2-9]\d)\.\d+)$/,
  "this feature set ships in 1.11.7 or newer"
);

console.log(`PASS: Attribute Group radar variant, element-key dropdowns, Database variable pickers (${manifest.version}).`);
