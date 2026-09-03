/**
 * Registry of UI Widget windows open on THIS client, plus a tiny event bus that
 * graph nodes and the socket layer talk to.
 *
 * Instance record: { id, widgetKey, actor, app, state }
 * Values live in `state` (see ui-widget-state.mjs), never duplicated here.
 */

import { MODULE_ID } from "./ui-widget-const.mjs";

const _instances = new Map();            // id → record
const _listeners = new Set();            // (event) => void
const _lastByGraph = new Map();          // graph exec id → instance id

function _emit(event) {
  for (const fn of _listeners) {
    try { fn(event); } catch (err) { console.warn(`${MODULE_ID} | bus listener failed:`, err); }
  }
  try { Hooks.callAll("sdUiWidget:event", event); } catch { /* Hooks may be down */ }
}

export function registerInstance({ id, widgetKey, actor = null, item = null, app = null, state = null }) {
  const rec = { id, widgetKey: String(widgetKey ?? ""), actor, item, app, state };
  _instances.set(id, rec);
  _emit({ type: "open", instanceId: id, widgetKey: rec.widgetKey, actor });
  return rec;
}

export function unregisterInstance(id) {
  const rec = _instances.get(id);
  if (!rec) return;
  _instances.delete(id);
  _emit({ type: "close", instanceId: id, widgetKey: rec.widgetKey, actor: rec.actor });
}

export function getInstance(id) {
  return _instances.get(String(id ?? "")) ?? null;
}

export function allInstances() {
  return [..._instances.values()];
}

export function findInstancesByKey(key) {
  const k = String(key ?? "").trim();
  if (!k) return [];
  return allInstances().filter(rec => rec.widgetKey === k);
}

export function isKeyOpen(key) {
  return findInstancesByKey(key).length > 0;
}

export function setLastInstanceForGraph(graphId, instanceId) {
  if (!graphId) return;
  _lastByGraph.set(String(graphId), String(instanceId));
}

export function getLastInstanceForGraph(graphId) {
  return _lastByGraph.get(String(graphId ?? "")) ?? null;
}

/**
 * Resolve an instance from an id, a widget key, or nothing (→ the only open
 * instance, when unambiguous). Keeps node fields forgiving.
 */
export function resolveInstance({ instanceId = "", widgetKey = "" } = {}) {
  const byId = instanceId ? getInstance(instanceId) : null;
  if (byId) return byId;
  if (widgetKey) return findInstancesByKey(widgetKey)[0] ?? null;
  const all = allInstances();
  return all.length === 1 ? all[0] : null;
}

/** Write a variable into an instance (used by Set UI Widget Value nodes). */
export async function setInstanceField(instanceId, name, value) {
  const rec = getInstance(instanceId) ?? resolveInstance({ instanceId });
  if (!rec?.state) return false;
  const previous = rec.state.getVariable(name);
  await rec.state.setVariable(name, value);
  _emit({
    type: "change", instanceId: rec.id, widgetKey: rec.widgetKey,
    element: String(name ?? ""), value, previous, actor: rec.actor
  });
  try { rec.app?.refresh?.(); } catch { /* window gone */ }
  return true;
}

export function getInstanceField(instanceId, name) {
  const rec = getInstance(instanceId) ?? resolveInstance({ instanceId });
  if (!rec?.state) return undefined;
  return rec.state.getVariable(name);
}

/** Emit a synthetic bus event (called by the app / element wiring). */
export function emitEvent({ instanceId, element, type = "click", value, actor }) {
  const rec = getInstance(instanceId);
  _emit({
    type,
    instanceId: rec?.id ?? String(instanceId ?? ""),
    widgetKey: rec?.widgetKey ?? "",
    element: String(element ?? ""),
    value,
    actor: actor ?? rec?.actor ?? null
  });
}

export function subscribe(handler) {
  _listeners.add(handler);
  return () => _listeners.delete(handler);
}

/** Deliver a broadcast event to every local instance with a matching key. */
export function localBroadcast(widgetKey, event, payload) {
  for (const rec of findInstancesByKey(widgetKey)) {
    _emit({
      type: `broadcast:${event}`, instanceId: rec.id, widgetKey: rec.widgetKey,
      event, payload, actor: rec.actor
    });
    try { rec.app?.onBroadcast?.(event, payload); } catch { /* ignore */ }
  }
}

export function refreshByKey(widgetKey) {
  for (const rec of findInstancesByKey(widgetKey)) {
    try { rec.app?.refresh?.(); } catch { /* ignore */ }
  }
}

export function snapshotRegistry() {
  return {
    instances: allInstances().map(rec => ({
      id: rec.id,
      key: rec.widgetKey,
      actor: rec.actor?.uuid ?? null,
      item: rec.item?.uuid ?? null,
      vars: Object.fromEntries((rec.state?.varDefs?.() ?? []).map(def => [def.name, rec.state.getVariable(def.id)]))
    })),
    listeners: _listeners.size
  };
}
