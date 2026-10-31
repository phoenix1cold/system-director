import { openFoundryWindow } from "../helpers/foundry-window-host.mjs";
import { openQuickActionsEditor, compileQuickActions, normalizeQuickActions } from "./quick-actions.mjs";

const esc = value => String(value ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const clone = value => foundry.utils.deepClone(value);
export const TRIGGER_EVENTS = {
  onClick: "Use / Click (item)", sdSheetOpen: "Sheet opened", sdMapLoaded: "Map loaded",
  updateDocument: "Document / Database changed", createDocument: "Document created", deleteDocument: "Document deleted",
  combatTurnStart: "Turn started", combatTurnEnd: "Turn ended", combatEncounterStart: "Combat started", combatEncounterEnd: "Combat ended",
  createActiveEffect: "Effect created", itemEquipped: "Item equipped", itemUnequipped: "Item unequipped",
  sdSheetWidgetEvent: "Widget interaction", sdCustomEvent: "Custom event", sdMacroUse: "Macro used"
};

/** Replace only entries owned by this editor. Graph events and macros remain intact. */
export function triggerManagerPayload(current, entries) {
  const payload = clone(current && typeof current === "object" ? current : {});
  payload._trigger = "multi";
  payload._events ??= {};
  for (const [key, event] of Object.entries(payload._events)) if (event?._quickActions) delete payload._events[key];
  for (const entry of entries) {
    if (!TRIGGER_EVENTS[entry.hook]) throw new Error("Unknown trigger event");
    if (!entry.id || (payload._events[entry.id] && !payload._events[entry.id]._quickActions)) throw new Error("Trigger ID conflicts with a graph event");
    const config = normalizeQuickActions(entry.config);
    payload._events[entry.id] = { hook: entry.hook, data: { outOfSheet:true, ...clone(entry.data ?? {}) }, actions: entry.enabled === false ? [] : compileQuickActions(config.steps),
      _quickActions: config, _label: String(entry.label ?? "Trigger"), _enabled: entry.enabled !== false };
  }
  return payload;
}

export async function saveManagedTriggers(doc, entries) {
  if (doc.isOwner === false) throw new Error("You do not own this document");
  const previous = doc.system?.sdTriggerGraph ?? {};
  const payload = triggerManagerPayload(previous, entries);
  const update = { "system.sdTriggerGraph": payload };
  // ObjectField updates merge recursively: explicit deletion prevents removed triggers firing.
  for (const [key, event] of Object.entries(previous._events ?? {})) {
    if (event?._quickActions && !payload._events[key]) update[`system.sdTriggerGraph._events.-=${key}`] = null;
  }
  await doc.update(update, { sdSkipEventBus: true });
  const { EVENT_BUS } = await import("../helpers/event-bus.mjs");
  EVENT_BUS.refreshDocument(doc);
}

/** Edit the actual onClick event consumed by SDItem.use; preserve graph and other events. */
export async function openItemUseActions(doc) {
  const current = doc.system?.sdTriggerGraph ?? {};
  const events = Object.entries(current._events ?? {}).filter(([,event]) => event?.hook === "onClick");
  const managed = events.find(([,event]) => event?._quickActions);
  const config = await openQuickActionsEditor(managed?.[1]?._quickActions ?? {steps:[]}, doc, {showEvent:false,title:`Use · ${doc.name}`,windowTitle:"On Use · Quick Actions"});
  if (!config) return false;
  const entries = Object.entries(current._events ?? {}).filter(([,event]) => event?._quickActions).map(([id,event])=>({id,hook:event.hook,data:event.data,label:event._label,enabled:event._enabled,config:event._quickActions}));
  const id = managed?.[0] ?? `use_${foundry.utils.randomID(16)}`;
  const entry = {id,hook:"onClick",label:"On Use",enabled:true,data:managed?.[1]?.data ?? {},config};
  const index = entries.findIndex(value=>value.id === id);
  if (index >= 0) entries[index] = entry; else entries.push(entry);
  await saveManagedTriggers(doc, entries);
  return true;
}

export function openTriggerManager(doc) {
  const events = doc.system?.sdTriggerGraph?._events ?? {};
  const entries = Object.entries(events).filter(([, event]) => event?._quickActions).map(([id, event]) => ({
    id, hook: event.hook, data: clone(event.data ?? {}), label: event._label, enabled: event._enabled !== false, config: clone(event._quickActions)
  }));
  const legacyCount = Object.values(events).filter(event => !event?._quickActions).length;
  const root = document.createElement("div");
  root.style.cssText = "display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden;padding:14px;gap:12px;background:var(--sd-bg,#171b2b);color:var(--sd-text,#eee)";
  let app;
  const sync = () => root.querySelectorAll("[data-trigger]").forEach(row => {
    const entry = entries[Number(row.dataset.trigger)];
    entry.label = row.querySelector("[data-label]").value;
    entry.hook = row.querySelector("[data-hook]").value;
    entry.enabled = row.querySelector("[data-enabled]").checked;
    for (const input of row.querySelectorAll("[data-filter]")) entry.data[input.dataset.filter] = input.value;
  });
  const render = () => {
    root.innerHTML = `<style>.sd .window-content .sdtm-row{flex:none;padding:12px;border:1px solid var(--sd-border,#3a4260);border-radius:8px;display:flex;flex-direction:column;gap:10px}.sdtm-top{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.sdtm-top input[data-label]{flex:1;min-width:120px}.sdtm-top select{flex:1;min-width:160px}.sdtm-filters{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px}.sdtm-filters label{display:flex;flex-direction:column;align-items:stretch;white-space:normal;text-transform:none}.sd .window-content .sdtm-top button{width:auto;padding:6px 12px;min-height:30px}.sdtm-top input[type=checkbox]{width:16px;flex:none}</style>
      <b>Trigger Manager · ${esc(doc.name)}</b><small>Choose an event and configure its steps with Quick Actions.${legacyCount ? ` ${legacyCount} existing graph event(s) are preserved unchanged.` : ""}</small>
      <div style="flex:1 1 0;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:10px">${entries.map((entry,index) => `<section class="sdtm-row" data-trigger="${index}">
        <div class="sdtm-top"><input type="checkbox" data-enabled aria-label="Enabled" ${entry.enabled ? "checked" : ""}><input type="text" data-label aria-label="Trigger name" value="${esc(entry.label)}"><select data-hook aria-label="Event">${Object.entries(TRIGGER_EVENTS).filter(([hook]) => hook !== "onClick" || doc.documentName === "Item" || entry.hook === hook).map(([hook,label]) => `<option value="${hook}" ${entry.hook === hook ? "selected" : ""}>${label}</option>`).join("")}</select></div>
        <div class="sdtm-filters">${(entry.hook === "updateDocument" ? [["variableId","Database variable ID (empty = any)"]] : entry.hook === "sdSheetWidgetEvent" ? [["widgetKey","Widget key"],["event","Interaction (click, change, toggle, hover)"]] : entry.hook === "sdCustomEvent" ? [["name","Event name"]] : []).map(([key,label]) => `<label>${label}<input type="text" data-filter="${key}" value="${esc(entry.data[key])}"></label>`).join("")}</div>
        <div class="sdtm-top"><button type="button" data-steps>Quick Actions (${entry.config.steps.length})</button><button type="button" data-remove>Remove</button></div></section>`).join("") || "<p>No triggers yet.</p>"}</div>
      <div class="sdtm-top"><button type="button" data-add>Add trigger</button><button type="button" data-save>Save</button><button type="button" data-cancel>Cancel</button><small data-error role="alert"></small></div>`;
    root.querySelectorAll("[data-trigger]").forEach(row => {
      const index = Number(row.dataset.trigger);
      row.querySelector("[data-hook]").addEventListener("change", () => { sync(); entries[index].data = {}; render(); });
      row.querySelector("[data-remove]").addEventListener("click", () => { sync(); entries.splice(index,1); render(); });
      row.querySelector("[data-steps]").addEventListener("click", async () => {
        sync(); const entry = entries[index];
        const result = await openQuickActionsEditor(entry.config, doc, { showEvent:false, title:entry.label, windowTitle:"Trigger Quick Actions" });
        if (result) entry.config = result;
        render();
      });
    });
    root.querySelector("[data-add]").addEventListener("click", () => { sync(); entries.push({id:`easy_${foundry.utils.randomID(16)}`, label:"Trigger", hook:"sdSheetOpen", enabled:true, data:{}, config:{steps:[]}}); render(); });
    root.querySelector("[data-cancel]").addEventListener("click", () => app.close());
    root.querySelector("[data-save]").addEventListener("click", async event => {
      sync(); event.currentTarget.disabled = true;
      try { await saveManagedTriggers(doc, entries); await app.close(); }
      catch (error) { root.querySelector("[data-error]").textContent = error.message; root.querySelector("[data-save]").disabled = false; }
    });
  };
  render();
  app = openFoundryWindow({id:`sd-triggers-${doc.id}`, title:"Trigger Manager", width:760, height:640, content:root});
  return app;
}
