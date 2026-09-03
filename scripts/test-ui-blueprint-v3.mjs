import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const getProperty = (object, path) => String(path ?? "").split(".").reduce((value, key) => value?.[key], object);
const setProperty = (object, path, value) => {
  const keys = String(path).split(".");
  let cursor = object;
  for (const key of keys.slice(0, -1)) cursor = cursor[key] ??= {};
  cursor[keys.at(-1)] = value;
};
const flags = {};
globalThis.foundry = { utils: { deepClone: value => structuredClone(value), getProperty, setProperty } };
globalThis.game = {
  user: {
    id: "gm", isGM: true,
    getFlag: (_scope, key) => getProperty(flags, key),
    setFlag: async (_scope, key, value) => setProperty(flags, key, value)
  },
  users: { contents: [
    { id: "gm", name: "GM", isGM: true, active: true },
    { id: "p1", name: "Player One", isGM: false, active: true }
  ] },
  settings: { get: () => "all" }, socket: { emit() {} }, i18n: { localize: key => key }
};
globalThis.ui = { notifications: { warn() {}, error() {}, info() {} } };

globalThis.fromUuidSync = () => null;

const schema = await import("../module/ui-blueprint/ui-widget-blueprint.mjs");
const { UIWidgetState } = await import("../module/ui-blueprint/ui-widget-state.mjs");
const { resolveAudienceUsers } = await import("../module/ui-blueprint/ui-widget-net.mjs");

assert.equal(schema.BLUEPRINT_SCHEMA_VERSION, 3);
assert.equal(schema.coerceBlueprintValue("17", "number"), 17);
assert.equal(schema.coerceBlueprintValue("yes", "boolean"), true);
assert.deepEqual(schema.coerceBlueprintValue("x", "array"), ["x"]);
assert.deepEqual(schema.coerceBlueprintValue([], "struct"), {});
assert.equal(schema.pinType("actor"), "value.actor");

const migrated = schema.migrateBlueprintData({
  schemaVersion: 1,
  widgetKey: "hero-hud",
  hiddenFields: { score: 5 },
  variables: [{ name: "Visible", type: "boolean", scope: "local", default: "yes" }],
  elements: [
    { id: "Score Label", name: "Score", type: "label", props: { path: "system.hiddenFields.score" } },
    { id: "Score Label", name: "Score Copy", type: "label", bind: { visible: "{ui.Visible}" } }
  ],
  functions: [{ name: "Damage", inputs: [{ name: "Amount", type: "number" }], outputs: [{ name: "Result", type: "number" }] }],
  customEvents: [{ name: "Changed", inputs: [{ name: "Value", type: "number" }] }],
  enums: [{ name: "State", entries: [{ name: "Ready" }] }],
  structs: [{ name: "Row", fields: [{ name: "Title", type: "string" }] }],
  dataTables: [{ name: "Rows", rows: [{ name: "First", values: { title: "Hello" } }] }]
});
assert.equal(migrated.schemaVersion, 3);
assert.equal(migrated.hiddenFields, undefined);
assert.equal(migrated.vars, undefined);
assert.equal(migrated.elements[0].valueVariableId, "score");
assert.equal(migrated.elements[0].props.path, undefined);
assert.notEqual(migrated.elements[0].id, migrated.elements[1].id);
assert.equal(schema.validateBlueprint(migrated).valid, true);
assert.equal(migrated.functions[0].inputs[0].type, "number");
assert.equal(migrated.customEvents[0].parameters[0].type, "number");
assert.equal(migrated.structs[0].fields[0].type, "string");

const duplicate = schema.validateBlueprint({ elements: [{ id: "same" }, { id: "SAME" }] });
assert.equal(duplicate.valid, false);
assert.equal(duplicate.errors[0].code, "widget_id_duplicate");

function document(uuid, legacy = {}) {
  return {
    uuid,
    documentName: uuid.startsWith("Actor") ? "Actor" : "Item",
    system: { hiddenFields: legacy, blueprintState: {} },
    async update(patch) { for (const [path, value] of Object.entries(patch)) setProperty(this, path, value); }
  };
}
const actor = document("Actor.hero", { hp: 9 });
const item = document("Item.sword", { charges: 2 });
const blueprint = {
  uuid: "Item.blueprint", id: "blueprint", name: "HUD", isOwner: true,
  system: {
    blueprintId: "hero-hud", worldState: {},
    variables: [
      { id: "local", name: "Local", type: "number", scope: "instance", default: 1 },
      { id: "hp", name: "HP", type: "number", scope: "actor", default: 0 },
      { id: "charges", name: "Charges", type: "number", scope: "item", default: 0 },
      { id: "note", name: "Note", type: "string", scope: "user", default: "" },
      { id: "shared", name: "Shared", type: "boolean", scope: "world", default: false }
    ],
    elements: [{ id: "hp-text", name: "HP Text", type: "label", valueVariableId: "hp", props: { text: "HP" } }]
  },
  async update(patch) { for (const [path, value] of Object.entries(patch)) setProperty(this, path, value); }
};
const state = new UIWidgetState(blueprint, { actor, item, initial: { local: "7" } });
assert.equal(state.getVariable("local"), 7);
assert.equal(state.getVariable("hp"), 9, "actor scope reads legacy value during migration");
assert.equal(state.getVariable("charges"), 2, "item scope reads legacy value during migration");
await state.setVariable("hp", "12");
await state.setVariable("charges", 4);
await state.setVariable("note", "saved");
await state.setVariable("shared", "true");
assert.equal(getProperty(actor, "system.blueprintState.hero-hud.hp"), 12);
assert.equal(getProperty(item, "system.blueprintState.hero-hud.charges"), 4);
assert.equal(state.getVariable("note"), "saved");
assert.equal(blueprint.system.worldState.shared, true);
await state.setWidgetProperty("hp-text", "visible", false);
assert.equal(state.getWidgetProperty("hp-text", "visible"), false);
assert.equal(state.snapshot().widgets["hp-text"].value, 12);
assert.equal(state.buildContext().system.hiddenFields, undefined);

assert.deepEqual(resolveAudienceUsers("self", { callerId: "p1" }), ["p1"]);
assert.deepEqual(resolveAudienceUsers("everyone", {}), ["gm", "p1"]);
assert.deepEqual(resolveAudienceUsers("users", { userList: "Player One" }), ["p1"]);

const graphSource = await readFile(new URL("../module/builder/formula-graph.mjs", import.meta.url), "utf8");
const nodeSource = await readFile(new URL("../module/ui-blueprint/ui-widget-blueprint-nodes.mjs", import.meta.url), "utf8");
const editorSource = await readFile(new URL("../module/ui-blueprint/ui-widget-editor.mjs", import.meta.url), "utf8");
assert.match(graphSource, /Array\.isArray\(d\._sgMenu\)/, "graph drop offers node operation choices");
assert.match(nodeSource, /ui_custom_event_entry/, "custom event entry node registered");
assert.match(nodeSource, /computeDynamicInputs/, "typed assets generate dynamic input pins");
assert.match(nodeSource, /ui_control_effect/, "effect control node registered");
assert.match(editorSource, /pointerWindow = wrapper\.ownerDocument/, "free drag tracks the actual Foundry window");
assert.match(editorSource, /_applyLivePosition/, "free drag updates widget position live");
assert.match(editorSource, /_saveSelectionAsTemplate/, "reusable UI templates are available");

console.log("PASS: UI Blueprint v3 schema, migration, scopes, Widget IDs, graph nodes, drag and audiences");
