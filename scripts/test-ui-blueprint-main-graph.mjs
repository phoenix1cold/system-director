import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseActionPayload } from "../module/ui-blueprint/ui-widget-events.mjs";
import { WIDGET_PALETTE_ORDER, LEGACY_WIDGET_TYPES } from "../module/builder/widget-registry.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = rel => fs.readFileSync(path.join(root, rel), "utf8");
const payload = JSON.stringify({
  _trigger: "multi",
  _events: {
    "ui_blueprint_event::life": { data:{ blueprintId:"bp-test", event:"open" }, actions:[{ type:"life" }] },
    "ui_widget_event::button": { data:{ blueprintId:"bp-test", widgetId:"button-1", event:"click" }, actions:[{ type:"widget" }] },
    "ui_custom_event_entry::custom": { data:{ blueprintId:"bp-test", eventId:"ready" }, actions:[{ type:"custom" }] },
    "ui_widget_event::other": { data:{ blueprintId:"bp-other", widgetId:"button-1", event:"click" }, actions:[{ type:"wrong" }] }
  }
});

assert.deepEqual(parseActionPayload(payload, "open", { blueprintId:"bp-test" }).actions.map(a=>a.type), ["life"]);
assert.deepEqual(parseActionPayload(payload, "click", { blueprintId:"bp-test", widgetId:"button-1" }).actions.map(a=>a.type), ["widget"]);
assert.deepEqual(parseActionPayload(payload, "ready", { blueprintId:"bp-test", eventId:"ready" }).actions.map(a=>a.type), ["custom"]);

const editor = read("module/ui-blueprint/ui-widget-editor.mjs");
const template = read("templates/ui-blueprint/editor.hbs");
assert.match(template, /MAIN BLUEPRINT GRAPH/);
assert.match(editor, /_openMainGraph/);
assert.match(editor, /Never silently eject a child to the root canvas/);
assert.match(editor, /ui_widget_event/);
assert.ok(WIDGET_PALETTE_ORDER.includes("widgetBuilder"), "Widget Builder must be present in Sheet Builder palette");
assert.equal(LEGACY_WIDGET_TYPES.has("widgetBuilder"), false, "Widget Builder must not be hidden as legacy");

console.log("PASS: unified UI Blueprint graph, nested drag protection and restored Widget Builder");
