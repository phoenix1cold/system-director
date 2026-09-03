import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = rel => fs.readFileSync(path.join(root, rel), "utf8");

const graph = read("module/builder/formula-graph.mjs");
const eventBus = read("module/helpers/event-bus.mjs");
const renderer = read("module/builder/widget-renderer.mjs");
const progression = read("module/helpers/progression-app.mjs");
const characterSheet = read("module/sheets/character-sheet.mjs");
const itemSheet = read("module/sheets/item-sheet.mjs");
const manifest = JSON.parse(read("system.json"));

assert.match(graph, /deletionUpdate\("system\.sdTriggerGraph", staleKeys\)/, "saving a Sheet Trigger must remove stale compiled runtime keys");
assert.doesNotMatch(graph, /sdTriggerGraph\.-=/, "stale key removal must use the v14 deletion operator");
assert.match(graph, /sdSkipEventBus:\s*true/, "saving a Sheet Trigger must not execute On Update");
assert.match(eventBus, /options\?\.sdSkipEventBus === true/, "event bus must honour internal graph-save updates");

assert.match(renderer, /_resolveDynamicColours\(widgetDef, doc\)/, "widget colours must resolve against the current document");
assert.match(renderer, /"color", "bgColor", "fillColor", "accentColor"/, "all widget colour families must be data-path aware");
const inventoryCompact = renderer.slice(
  renderer.indexOf("static _render_inventory_compact"),
  renderer.indexOf("static _render_effects_compact")
);
assert.ok(!inventoryCompact.includes('sd-hud-pop-count">0'), "empty compact Inventory must not render a stray zero badge");

assert.match(progression, /normalizeActorPath/, "progression must normalize custom and shorthand actor paths");
assert.match(progression, /buildFieldUpdate\(actor, \{ \.\.\.fc, path \}, updates\)/, "multiple level rewards must accumulate against pending values");
assert.match(progression, /lv\.skillPointsGranted/, "imported Class levels must support explicit skill-point grants");

for (const source of [characterSheet, itemSheet]) {
  assert.match(source, /hostUuid/, "slot drag payloads must identify the actual slot host");
  assert.match(source, /data-slot-item-drag/, "slot contents must be draggable");
}
assert.match(characterSheet, /_resolveSlotHost/, "slot moves must resolve Actor and Item slot hosts");
assert.match(characterSheet, /removeFromSlot\(srcHost/, "slot source must only be removed after a successful move");

// FormulaEngine regression: dotted embedded UUIDs and stale slot UUIDs must
// resolve without losing the field path, and real zero values stay real zeros.
globalThis.Actor = class Actor {};
globalThis.foundry = {
  utils: {
    getProperty(object, dotted) {
      return String(dotted ?? "").split(".").reduce((value, key) => value?.[key], object);
    }
  }
};

const actor = new globalThis.Actor();
actor.id = "ACTOR1";
actor.uuid = "Actor.ACTOR1";
const liveItem = {
  id: "LIVE1",
  uuid: "Actor.ACTOR1.Item.LIVE1",
  name: "Live Item",
  system: { hiddenFields: { value: 37, zero: 0 } }
};
const items = [liveItem];
items.get = id => items.find(item => item.id === id) ?? null;
actor.items = items;
actor.system = {
  slotContents: {
    slot1: {
      contents: [{
        _id: "DEAD1",
        _sourceUuid: "Actor.ACTOR1.Item.DEAD1",
        name: "Slotted Item",
        system: { hiddenFields: { value: 19, zero: 0 } }
      }]
    }
  }
};

globalThis.game = {
  actors: { get: id => id === actor.id ? actor : null },
  items: { get: () => null, getName: () => null, find: () => null }
};
globalThis.fromUuidSync = uuid => uuid === liveItem.uuid ? liveItem : null;

const { FormulaEngine } = await import("../module/helpers/formula-engine.mjs");
assert.equal(Number(FormulaEngine.evaluate("{item:id:Actor.ACTOR1.Item.LIVE1.system.hiddenFields.value}", actor)), 37);
assert.equal(Number(FormulaEngine.evaluate("{item:id:Actor.ACTOR1.Item.LIVE1.system.hiddenFields.zero}", actor)), 0);
assert.equal(Number(FormulaEngine.evaluate("{item:id:Actor.ACTOR1.Item.DEAD1.system.hiddenFields.value}", actor)), 19);
assert.equal(Number(FormulaEngine.evaluate('{slotFind:"self"|slot1|system.hiddenFields.value}', actor)), 19);
assert.equal(FormulaEngine.evaluate('{slotUuidFind:"self"|slot1}', actor), "Actor.ACTOR1.Item.DEAD1");

// Get Name must also work when Ref is wired from another node.  Array/string
// refs are quoted during formula substitution; the lookup layer must strip
// that transport quoting before resolving the Item UUID.
const wiredRef = "{arrayGet:b64:QWN0b3IuQUNUT1IxLkl0ZW0uTElWRTE=|b64:MA==|b64:}";
const wiredName = Buffer.from(`{__sdName:auto|${Buffer.from(wiredRef, "utf8").toString("base64")}}`, "utf8").toString("utf8");
assert.equal(FormulaEngine.evaluate(wiredName, actor), "Live Item");

assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
console.log("PASS: System Director 1.3.3 bug regressions.");
