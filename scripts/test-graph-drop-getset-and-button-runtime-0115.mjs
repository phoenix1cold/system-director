/**
 * 1.10.5 regression test.
 *
 * Covers the four defects reported after 1.10.4:
 *   1. Dragging a widget / variable from My Blueprint onto the canvas did not
 *      offer Get or Set.
 *   2. The multi-option drop dialog crashed
 *      ("Cannot read properties of undefined (reading 'value')") because
 *      DialogV2 v14 drops a nested <form>, so button.form.elements was empty.
 *   3. Button node logic never ran: the sheet only broadcast the event through
 *      the event bus, whose registry is stale right after a graph save, and
 *      inner controls swallowed the click with stopPropagation.
 *   4. Legacy forced-deletion keys ("-=_trigger", "-=_events", spell slots,
 *      widget paths) logged v14 compatibility errors, and a numeric Database
 *      variable name produced an unusable id (“435”).
 */
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = rel => fs.readFileSync(path.join(root, rel), "utf8");
const has = (source, needle, label) => assert.ok(source.includes(needle), `${label}: missing ${needle}`);
const lacks = (source, needle, label) => assert.ok(!source.includes(needle), `${label}: should no longer contain ${needle}`);

const manifest = JSON.parse(read("system.json"));
assert.ok(/^1\.(10\.([5-9]|\d{2,})|(1[1-9]|[2-9]\d)\.\d+)$/.test(manifest.version), `unexpected version ${manifest.version}`);

const graph = read("module/builder/formula-graph.mjs");
const characterSheet = read("module/sheets/character-sheet.mjs");
const itemSheet = read("module/sheets/item-sheet.mjs");
const eventBus = read("module/helpers/event-bus.mjs");
const valueDb = read("module/helpers/value-database.mjs");
const identity = read("module/builder/widget-identity.mjs");
const widgetPaths = read("module/builder/widget-paths.mjs");
const compatSource = read("module/helpers/foundry-compat.mjs");
const sheetEventsSource = read("module/helpers/sheet-widget-events.mjs");

/* 1. Drag & drop offers Get / Set / event ------------------------------- */
has(graph, "async _pickDropChoice(clientX, clientY, options)", "drop menu");
has(graph, "choice = await this._pickDropChoice(ev.clientX, ev.clientY, menu)", "drop menu");
has(graph, "const extra = { ...base, ...(choice.data ?? {}) };", "drop menu");

has(graph, '{type:"get_value",label:`Get ${label}`', "database variable drag");
has(graph, '{type:"set_value",label:`Set ${label}`', "database variable drag");
has(graph, '{type:"var_read",label:`Get ${variableData.name}`', "graph variable drag");
has(graph, '{type:"var_write",label:`Set ${variableData.name}`', "graph variable drag");
has(graph, '{type:"get_widget",label:`Get ${label} (generic)`', "sheet widget drag");

// 1.11.1: the drop menu must also offer the widget's own dedicated Get/Set
// nodes. They were looked up on SD_NODE_REGISTRY - the frozen public API
// object, which never holds node types - so they were always skipped silently.
has(graph, "const getType=`widget_get_${widgetType}`, setType=`widget_set_${widgetType}`;", "dedicated widget nodes");
has(graph, "const hasOwnGet=!!NODE_DEFS?.[getType], hasOwnSet=!!NODE_DEFS?.[setType];", "dedicated widget nodes");
lacks(graph, "SD_NODE_REGISTRY?.[getType]", "dedicated widget nodes");
has(graph, '{type:"sheet_widget_event",label:`On ${label} Event`', "sheet widget drag");

has(graph, 'data-variable-name="${esc(variable.name)}"', "My Blueprint rows");
has(graph, 'data-widget-name="${esc(widget.name)}"', "My Blueprint rows");
has(graph, 'data-variable-id="${esc(widget.variableId)}"', "My Blueprint rows");
has(graph, 'variableId:String(widget.variableId ?? "").trim()', "widget collection");

/* 2. No DialogV2 nested-form reads anywhere in the drop path ------------ */
lacks(graph, "button.form.elements", "graph editor");
lacks(graph, "Create Blueprint Node", "graph editor");
lacks(graph, '<form class="sd-blueprint-drop-menu">', "graph editor");
lacks(graph, '<form class="sd-graph-variable-create">', "graph editor");
lacks(valueDb, "button.form.elements", "value database");
lacks(valueDb, '<form class="sd-db-variable-create">', "value database");
lacks(valueDb, '<form class="sd-doc-db-editor">', "value database");
lacks(identity, "button.form.elements", "widget identity");
lacks(identity, '<form class="sd-widget-identity-dialog">', "widget identity");
has(identity, 'dialogText(event,button,"widgetKey")', "widget identity");

/* 3. Ordinary widget events run the document's own Blueprint ------------ */
has(characterSheet, "import { emitSheetWidgetEvent as dispatchSheetWidgetEvent }", "actor sheet");
has(characterSheet, "return dispatchSheetWidgetEvent(doc,{", "actor sheet");
has(characterSheet, "cell._sdEmitWidgetEvent=emitSheetWidgetEvent;", "actor sheet");
has(characterSheet, 'emitSheetWidgetEvent("input",event),true);', "actor sheet capture phase");
has(characterSheet, 'emitSheetWidgetEvent("change",event),true);', "actor sheet capture phase");
lacks(characterSheet, 'Hooks.callAll("sdSheetWidgetEvent"', "actor sheet");
has(itemSheet, "return dispatchSheetWidgetEvent(doc,{", "item sheet");
has(itemSheet, 'emit("input",event),true);', "item sheet capture phase");
lacks(itemSheet, 'Hooks.callAll("sdSheetWidgetEvent"', "item sheet");
has(graph, "EVENT_BUS?.refreshDocument?.(this.doc)", "graph save");
has(eventBus, "refreshDocument(doc) {", "event bus");
has(eventBus, "__sdSheetGraphOwner", "event bus de-duplication");

/* 4. Foundry v14 deletion syntax + variable naming ---------------------- */
has(compatSource, "foundry?.data?.operators?.ForcedDeletion", "compat helper");
has(graph, 'deletionUpdate("system.sdTriggerGraph", staleKeys)', "graph save");
lacks(graph, "system.sdTriggerGraph.-=", "graph save");
lacks(characterSheet, "system.spellSlots.-=", "actor sheet");
has(characterSheet, 'deletionUpdate("system.spellSlots", lvl)', "actor sheet");
has(widgetPaths, "deletionUpdate(parent, leaf)", "widget paths");
lacks(widgetPaths, ".-=${leaf}", "widget paths");
has(valueDb, "/^[0-9]+$/.test(rawName)", "database variable naming");
has(sheetEventsSource, "SHEET_WIDGET_GRAPH_OWNER_KEY", "sheet widget events");

/* Behaviour of the new helpers ----------------------------------------- */
class ForcedDeletion {}
globalThis.foundry = { data: { operators: { ForcedDeletion } } };
const compat = await import(new URL("../module/helpers/foundry-compat.mjs", import.meta.url));

const modern = compat.deletionUpdate("system.sdTriggerGraph", ["_trigger", "_events"]);
assert.deepStrictEqual(Object.keys(modern), ["system.sdTriggerGraph"]);
assert.ok(modern["system.sdTriggerGraph"]._trigger instanceof ForcedDeletion, "_trigger must use ForcedDeletion");
assert.ok(modern["system.sdTriggerGraph"]._events instanceof ForcedDeletion, "_events must use ForcedDeletion");
assert.ok(!JSON.stringify(Object.keys(modern)).includes("-="), "no legacy deletion keys on v14");
assert.deepStrictEqual(compat.deletionUpdate("system.spellSlots", []), {}, "nothing to delete => empty patch");

const input = { value: "  Health  " };
const button = {
  form: { elements: {} },
  closest: selector => (selector === ".application"
    ? { querySelector: query => (query === '[name="name"]' ? input : null) }
    : null)
};
assert.strictEqual(compat.dialogText({}, button, "name"), "Health", "nested-form reads must still work");
assert.strictEqual(compat.dialogValue({}, button, "missing", "fallback"), "fallback", "missing fields fall back");
assert.doesNotThrow(() => compat.dialogValue({}, undefined, "name"), "helpers never throw");

delete globalThis.foundry;
assert.deepStrictEqual(
  compat.deletionUpdate("system.spellSlots", "3"),
  { "system.spellSlots.-=3": null },
  "older cores keep the legacy syntax"
);

const sheetEvents = await import(new URL("../module/helpers/sheet-widget-events.mjs", import.meta.url));
assert.strictEqual(sheetEvents.SHEET_WIDGET_GRAPH_OWNER_KEY, "__sdSheetGraphOwner");
const actor = {
  documentName: "Actor",
  uuid: "Actor.abc",
  system: {
    sdTriggerGraph: {
      _events: {
        "sheet_widget_event::n1": {
          hook: "sdSheetWidgetEvent",
          data: { key: "action", event: "click" },
          actions: [{ type: "message" }]
        },
        "on_update::n2": { hook: "updateActor", data: {}, actions: [{ type: "message" }] },
        "sheet_widget_event::n3": { hook: "sdSheetWidgetEvent", data: {}, actions: [] }
      }
    }
  }
};
const entries = sheetEvents.sheetWidgetGraphEvents(actor);
assert.strictEqual(entries.length, 1, "only compiled widget events with actions are collected");
assert.ok(sheetEvents.matchesSheetWidgetEvent(entries[0].data, { widgetKey: "action", event: "click" }));
assert.ok(sheetEvents.matchesSheetWidgetEvent({ key: "action" }, { widgetId: "action", event: "click" }), "widget id also matches");
assert.ok(sheetEvents.matchesSheetWidgetEvent({}, { widgetKey: "anything", event: "click" }), "empty key matches every widget");
assert.ok(!sheetEvents.matchesSheetWidgetEvent(entries[0].data, { widgetKey: "other", event: "click" }));
assert.ok(!sheetEvents.matchesSheetWidgetEvent(entries[0].data, { widgetKey: "action", event: "change" }));
assert.ok(!sheetEvents.matchesSheetWidgetEvent({ key: "action", elementKey: "btn2" }, { widgetKey: "action", elementKey: "btn1", event: "click" }));
assert.strictEqual(sheetEvents.sheetWidgetGraphEvents(null).length, 0);
assert.strictEqual(sheetEvents.sheetWidgetGraphEvents({ system: {} }).length, 0);

console.log("PASS: My Blueprint drags offer Get/Set, drop menu is crash-free, ordinary widget events run the sheet graph, v14 deletion syntax is clean.");
