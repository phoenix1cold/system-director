import assert from "node:assert/strict";

/**
 * 1.11.2 regression: arrays -> text everywhere, Database driven widget filters
 * and typing-format hints for Database variables.
 */

const getProperty = (object, path) => String(path ?? "").split(".").filter(Boolean).reduce((value, key) => value?.[key], object);
const setProperty = (object, path, value) => { const parts = String(path).split(".").filter(Boolean); let target = object; for (const key of parts.slice(0, -1)) target = target[key] ??= {}; target[parts.at(-1)] = value; return true; };
globalThis.foundry = { utils: { getProperty, setProperty, deepClone: value => structuredClone(value) } };
globalThis.Actor = class Actor {};

const DB = [
  { id: "category", name: "Category",  type: "text",  scope: "item",  initial: "" },
  { id: "weight",   name: "Weight",    type: "number",scope: "item",  initial: 0 },
  { id: "tags",     name: "Tags",      type: "array", scope: "both",  initial: [] },
  { id: "ab_type",  name: "Spell Type",type: "text",  scope: "item",  initial: "" }
];
globalThis.game = {
  settings: { get: () => ({ database: DB }) },
  actors: { get: () => null },
  items: { get: () => null, getName: () => null, find: () => null },
  user: { targets: new Set(), isGM: true },
  i18n: { localize: key => key, format: key => key }
};
globalThis.canvas = { tokens: { get: () => null, controlled: [] } };
globalThis.Hooks = { once: () => {}, on: () => {}, off: () => {}, call: () => true, callAll: () => true };
globalThis.CONFIG = { SD: { currencies: [] } };
globalThis.ui = { notifications: { warn: () => {}, info: () => {}, error: () => {} } };

const db = await import("../module/helpers/value-database.mjs");

// --- 1. every variable type documents how its value must be typed in ---------
for (const type of db.VALUE_DATABASE_TYPES) {
  const format = db.valueTypeFormat(type);
  assert.ok(format.example && format.hint, `missing format hint for ${type}`);
  assert.equal(typeof db.valueTypePlaceholder(type), "string");
  assert.match(db.valueTypeFormatHint(type), /.+ - .+/);
}
assert.match(db.valueTypeFormat("array").example, /\[/);
assert.match(db.valueTypeFormat("boolean").example, /true/);

// --- 2. array variables: storage, coercion, listing --------------------------
assert.deepEqual(db.coerceDatabaseValue('["ammo","magazine"]', { type: "array" }), ["ammo", "magazine"]);
assert.deepEqual(db.coerceDatabaseValue("ammo, magazine", { type: "array" }), ["ammo", "magazine"]);
assert.deepEqual(db.coerceDatabaseValue(["a", "b"], { type: "array" }), ["a", "b"]);
assert.equal(db.databaseValueToText(["ammo", "magazine"]), "ammo, magazine");
assert.equal(db.databaseValueToText([{ name: "Iron Sword" }, { name: "Potion" }]), "Iron Sword, Potion");
assert.deepEqual(db.databaseValueList('["ammo","magazine"]'), ["ammo", "magazine"]);

const sword  = { documentName: "Item", id: "I1", uuid: "Actor.A1.Item.I1", name: "Iron Sword", type: "inventory", system: { values: { category: "weapon", weight: 3, tags: ["metal", "melee"] } } };
const potion = { documentName: "Item", id: "I2", uuid: "Actor.A1.Item.I2", name: "Potion",     type: "inventory", system: { values: { category: "consumable", weight: 1, tags: ["drink"] } } };
const bolt   = { documentName: "Item", id: "I3", uuid: "Actor.A1.Item.I3", name: "Fire Bolt",  type: "ability",   system: { values: { ab_type: "spell" } } };

assert.deepEqual(db.readDatabaseValueList(sword, "tags"), ["metal", "melee"]);
assert.equal(db.readDatabaseValue(sword, "category"), "weapon");

// filter: matches when at least one accepted value equals the item's variable
assert.equal(db.databaseValueMatchesAny(sword,  "category", ["weapon", "armor"]), true);
assert.equal(db.databaseValueMatchesAny(potion, "category", ["weapon", "armor"]), false);
assert.equal(db.databaseValueMatchesAny(sword,  "tags", ["melee"]), true);   // array variable
assert.equal(db.databaseValueMatchesAny(sword,  "category", []), true);      // empty = all

// --- 3. widget renderer: Database driven filters and extra columns -----------
const { WidgetRenderer } = await import("../module/builder/widget-renderer.mjs");
const invWidget = { type: "inventory", label: "Inventory", categoryVariable: "category", categories: ["weapon", "ammo"], columnVariables: ["weight", "tags"] };
assert.equal(WidgetRenderer._sdFilterMatches(sword,  invWidget.categoryVariable, sword.system?.category,  invWidget.categories), true);
assert.equal(WidgetRenderer._sdFilterMatches(potion, invWidget.categoryVariable, potion.system?.category, invWidget.categories), false);
const cols = WidgetRenderer._sdExtraColumns(invWidget);
assert.deepEqual(cols.map(col => col.label), ["Weight", "Tags"]);
assert.equal(WidgetRenderer._sdColumnValue(cols[0], sword), "3");
assert.equal(WidgetRenderer._sdColumnValue(cols[1], sword), "metal, melee");
// legacy hiddenFields columns keep working
const legacy = WidgetRenderer._sdExtraColumns({ columns: ["damage"] });
assert.deepEqual(legacy, [{ id: "damage", label: "damage", variable: false }]);
assert.equal(WidgetRenderer._sdColumnValue(legacy[0], { system: { hiddenFields: { damage: "1d8" } } }), "1d8");
// spellbook type filter
assert.equal(WidgetRenderer._sdFilterMatches(bolt, "ab_type", bolt.system?.hiddenFields?.type, ["spell", "technique"]), true);
assert.equal(WidgetRenderer._sdFilterMatches(bolt, "ab_type", undefined, ["technique"]), false);
// legacy hiddenFields type fallback when no variable is selected
assert.equal(WidgetRenderer._sdFilterMatches({ system: { hiddenFields: { type: "power" } } }, "", "power", ["power"]), true);

// --- 4. arrays -> text in the formula engine (To Text / Array Join / Message) -
const { FormulaEngine } = await import("../module/helpers/formula-engine.mjs");
const { registerFormulaTokenResolver } = await import("../module/helpers/node-runtime-api.mjs");
const enc = value => `b64:${Buffer.from(String(value), "utf8").toString("base64")}`;

const itemArray = [
  { id: "I1", uuid: sword.uuid,  name: "Iron Sword", quantity: 1 },
  { id: "I2", uuid: potion.uuid, name: "Potion",     quantity: 3 }
];
registerFormulaTokenResolver("testInv:", () => itemArray, { owner: "test" });

assert.equal(FormulaEngine.valueToText(itemArray), "Iron Sword, Potion");
assert.equal(FormulaEngine.valueToText(["a", "b"], " | "), "a | b");
assert.deepEqual(FormulaEngine.valueToList(itemArray), ["Iron Sword", "Potion"]);

// To Text node: {convertValue:text|<array>} and with a custom separator
assert.equal(FormulaEngine._resolveToken(`convertValue:text|${enc("{testInv:x}")}`, sword), "Iron Sword, Potion");
assert.equal(FormulaEngine._resolveToken(`convertValue:text|${enc("{testInv:x}")}|${enc(" / ")}`, sword), "Iron Sword / Potion");
// Array Join node keeps the separator spacing
assert.equal(FormulaEngine._resolveToken(`arrayJoin:${enc("{testInv:x}")}|${enc(", ")}`, sword), "Iron Sword, Potion");
assert.equal(FormulaEngine._resolveToken(`arrayLength:${enc("{testInv:x}")}`, sword), 2);
assert.equal(FormulaEngine._resolveToken(`arrayAt:${enc("{testInv:x}")}|${enc("1")}`, sword), "Potion");
// To Array + Array Get on a real array
assert.equal(FormulaEngine._resolveToken(`convertValue:array|${enc("{testInv:x}")}`, sword), "Iron Sword,Potion");
// Message: an array fed straight into a text pin must not print [object Object]
const messaged = FormulaEngine.evaluate("{testInv:x}", sword);
assert.equal(String(messaged), "Iron Sword, Potion");
assert.doesNotMatch(String(messaged), /\[object Object\]/);
// interpolated inside a sentence
assert.equal(FormulaEngine.evaluate("Backpack: {testInv:x}", sword), "Backpack: Iron Sword, Potion");
// array Database variable through the value token
registerFormulaTokenResolver("testTags:", () => ["metal", "melee"], { owner: "test" });
assert.equal(FormulaEngine._resolveToken(`convertValue:text|${enc("{testTags:x}")}`, sword), "metal, melee");
assert.equal(FormulaEngine._resolveToken(`arraySplit:${enc("{testTags:x}")}|${enc(",")}`, sword), "metal,melee");

console.log("PASS: 1.11.2 Database arrays, widget variable filters and array -> text.");
