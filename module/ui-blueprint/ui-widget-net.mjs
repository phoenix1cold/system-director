/**
 * Socket layer: opening / closing / updating UI Widget windows on other clients.
 *
 * Foundry sockets are a broadcast bus, so every message carries an explicit
 * `targets` array of user ids and each client acts only when it is addressed.
 *
 * Trust model
 * -----------
 * Pushing a window onto somebody else's screen is a privileged action. Players
 * never emit those messages themselves: they send a `request` to the primary GM
 * client, which validates it against the `broadcastPolicy` setting and re-emits
 * the authoritative message. With the default policy ("all") any graph may ask,
 * but the fan-out always happens on a GM client, so a disconnected GM means no
 * remote windows rather than an unmoderated free-for-all.
 *
 * The same relay is used for `shared` variables, because writing to the widget
 * Item requires document ownership that players do not have.
 */

import { MODULE_ID, SOCKET_NS, SETTINGS, AUDIENCES } from "./ui-widget-const.mjs";
import { normalizeVariables, coerceBlueprintValue } from "./ui-widget-blueprint.mjs";

const MAX_TARGETS = 100;
const MAX_PATCH_KEYS = 100;
const MAX_PAYLOAD_BYTES = 64 * 1024;
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const REQUEST_TTL_MS = 5 * 60 * 1000;
const RATE_WINDOW_MS = 10 * 1000;
const RATE_LIMIT = 30;
const _processedRequests = new Map();
const _requestRate = new Map();

function _acceptPlayerRequest(userId, requestId) {
  const now = Date.now();
  for (const [id, time] of _processedRequests) {
    if (now - time > REQUEST_TTL_MS) _processedRequests.delete(id);
  }
  if (!SAFE_ID.test(String(requestId ?? "")) || _processedRequests.has(requestId)) return false;
  const recent = (_requestRate.get(userId) ?? []).filter(time => now - time < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) {
    _requestRate.set(userId, recent);
    return false;
  }
  recent.push(now);
  _requestRate.set(userId, recent);
  _processedRequests.set(requestId, now);
  return true;
}

function _payloadSize(value) {
  try { return new TextEncoder().encode(JSON.stringify(value)).length; }
  catch { return Infinity; }
}

function _activeUser(id) {
  const user = game.users?.get?.(String(id ?? ""))
    ?? (game.users?.contents ?? []).find(entry => entry.id === String(id ?? ""));
  return user?.active ? user : null;
}

function _sanitizeTargets(values = []) {
  const activeIds = new Set((game.users?.contents ?? []).filter(user => user.active).map(user => user.id));
  return [...new Set(Array.isArray(values) ? values : [])]
    .filter(id => activeIds.has(id))
    .slice(0, MAX_TARGETS);
}

function _sanitizeRemoteMessage(message) {
  if (!message || typeof message !== "object" || _payloadSize(message) > MAX_PAYLOAD_BYTES) return null;
  if (!["open", "close", "setVar", "broadcast", "refresh"].includes(message.kind)) return null;
  const clean = { ...message, targets:_sanitizeTargets(message.targets) };
  if (clean.widgetKey != null) clean.widgetKey = String(clean.widgetKey).slice(0, 128);
  if (clean.instanceId != null) clean.instanceId = String(clean.instanceId).slice(0, 128);
  if (clean.event != null) clean.event = String(clean.event).slice(0, 128);
  if (clean.name != null) clean.name = String(clean.name).slice(0, 64);
  if (clean.kind === "setVar" && !SAFE_ID.test(clean.name ?? "")) return null;
  return clean;
}

/** Local executors, injected by main.mjs to avoid an import cycle. */
let _handlers = {
  openLocal: async () => null,
  closeLocal: async () => {},
  setVarLocal: async () => {},
  broadcastLocal: () => {},
  refreshLocal: () => {}
};

export function setNetHandlers(handlers = {}) {
  _handlers = { ..._handlers, ...handlers };
}

function _emit(payload) {
  try { game.socket?.emit?.(SOCKET_NS, payload); }
  catch (err) { console.warn(`${MODULE_ID} | socket emit failed:`, err); }
}

/** The GM client responsible for relaying — one, deterministic, and active. */
export function primaryGM() {
  const active = (game.users?.contents ?? []).filter(u => u.isGM && u.active);
  active.sort((a, b) => a.id.localeCompare(b.id));
  return active[0] ?? null;
}

export function isPrimaryGM() {
  return primaryGM()?.id === game.user?.id;
}

function policy() {
  try { return game.settings.get(MODULE_ID, SETTINGS.broadcastPolicy); }
  catch { return "all"; }
}

/**
 * Turn an audience descriptor into a list of active user ids.
 * @param {string} audience  one of AUDIENCES
 * @param {object} options
 * @param {Actor|null} options.actor    context actor (for "owners")
 * @param {string} options.userList     CSV of user ids or names (for "users")
 * @param {string} options.callerId     user id that triggered the action
 */
export function resolveAudienceUsers(audience, { actor = null, userList = "", callerId = "" } = {}) {
  const users = game.users?.contents ?? [];
  const active = users.filter(u => u.active);
  const caller = callerId || game.user?.id;

  switch (audience) {
    case AUDIENCES.gm:
      return active.filter(u => u.isGM).map(u => u.id);
    case AUDIENCES.owners: {
      if (!actor) return [caller];
      return active.filter(u => !u.isGM && actor.testUserPermission?.(u, "OWNER")).map(u => u.id);
    }
    case AUDIENCES.players:
      return active.filter(u => !u.isGM).map(u => u.id);
    case AUDIENCES.everyone:
      return active.map(u => u.id);
    case AUDIENCES.users: {
      const wanted = String(userList ?? "").split(/[,;]/).map(s => s.trim()).filter(Boolean);
      const ids = new Set();
      for (const token of wanted) {
        const byId = users.find(u => u.id === token);
        const byName = users.find(u => u.name?.toLowerCase() === token.toLowerCase());
        const hit = byId ?? byName;
        if (hit?.active) ids.add(hit.id);
      }
      return [...ids];
    }
    case AUDIENCES.self:
    default:
      return [caller];
  }
}

function _requestOrEmit(message) {
  const targets = message.targets ?? [];
  const me = game.user?.id;
  const remote = targets.filter(id => id !== me);

  // Purely local: the caller already handled it, no traffic needed.
  if (!remote.length) return true;

  if (game.user?.isGM) {
    _emit({ ...message, origin: me });
    return true;
  }
  if (policy() !== "all") {
    ui.notifications?.warn?.(game.i18n.localize("SDUI.Notify.BroadcastDenied"));
    return false;
  }
  const gm = primaryGM();
  if (!gm) {
    ui.notifications?.warn?.(game.i18n.localize("SDUI.Notify.NoGM"));
    return false;
  }
  _emit({ kind: "request", requestId:foundry.utils.randomID(16), relayTo: gm.id, origin: me, message });
  return true;
}

// ---------------------------------------------------------------------------
// Outbound helpers
// ---------------------------------------------------------------------------

/**
 * Open a widget for a set of users. Runs locally when we are one of the targets.
 * @returns {Promise<string|null>} local instance id, when opened here
 */
export async function dispatchOpen({ widgetKey, targets = [], actorUuid = "", itemUuid = "", mode = "", vars = {}, unique = true, title = "" }) {
  const me = game.user?.id;
  const message = { kind: "open", targets, widgetKey, actorUuid, itemUuid, mode, vars, unique, title };
  let localId = null;
  if (targets.includes(me)) {
    localId = await _handlers.openLocal({ widgetKey, actorUuid, itemUuid, mode, vars, unique, title });
  }
  _requestOrEmit(message);
  return localId;
}

export async function dispatchClose({ widgetKey = "", instanceId = "", targets = [] }) {
  const me = game.user?.id;
  const message = { kind: "close", targets, widgetKey, instanceId };
  if (targets.includes(me)) await _handlers.closeLocal({ widgetKey, instanceId });
  _requestOrEmit(message);
}

export async function dispatchSetVar({ widgetKey = "", instanceId = "", name, value, targets = [] }) {
  const me = game.user?.id;
  const message = { kind: "setVar", targets, widgetKey, instanceId, name, value };
  if (targets.includes(me)) await _handlers.setVarLocal({ widgetKey, instanceId, name, value });
  _requestOrEmit(message);
}

export function dispatchBroadcast({ widgetKey, event, payload, targets = [] }) {
  const me = game.user?.id;
  const message = { kind: "broadcast", targets, widgetKey, event, payload };
  if (targets.includes(me)) _handlers.broadcastLocal(widgetKey, event, payload);
  _requestOrEmit(message);
}

/**
 * Write `shared` variables onto the widget Item. GMs write directly; players ask
 * the primary GM to do it for them.
 */
export async function requestWorldWrite(item, patch) {
  if (!item || !patch || !Object.keys(patch).length) return;
  const changes = _worldStateChanges(item, patch);
  if (!Object.keys(changes).length) return;

  if (item.isOwner || game.user?.isGM) {
    try { await item.update(changes); }
    catch (err) { console.warn(`${MODULE_ID} | shared write failed:`, err); }
    return;
  }
  const gm = primaryGM();
  if (!gm) {
    ui.notifications?.warn?.(game.i18n.localize("SDUI.Notify.NoGM"));
    return;
  }
  _emit({ kind: "request", requestId:foundry.utils.randomID(16), relayTo: gm.id, origin: game.user?.id, message: { kind: "worldWrite", itemUuid: item.uuid, patch } });
}

// ---------------------------------------------------------------------------
// Inbound
// ---------------------------------------------------------------------------

function _worldStateChanges(item, patch) {
  if (!item || (item.type !== "uiwidget" && !item.system?.blueprintId) || !patch || typeof patch !== "object") return {};
  if (_payloadSize(patch) > MAX_PAYLOAD_BYTES) return {};
  const writable = new Map(normalizeVariables(item.system?.variables)
    .filter(variable => variable.scope === "world" && !variable.readOnly)
    .map(variable => [variable.id, variable]));
  const changes = {};
  for (const [name, value] of Object.entries(patch).slice(0, MAX_PATCH_KEYS)) {
    if (!SAFE_ID.test(name)) continue;
    const variable = writable.get(name);
    if (!variable) continue;
    changes[`system.worldState.${name}`] = coerceBlueprintValue(value, variable.type);
  }
  return changes;
}

async function _applySharedWrite({ itemUuid, patch }) {
  const item = await fromUuid(itemUuid).catch(() => null);
  if (!item || item.type !== "uiwidget") return;
  const changes = _worldStateChanges(item, patch);
  if (!Object.keys(changes).length) return;
  try { await item.update(changes); }
  catch (err) { console.warn(`${MODULE_ID} | relayed shared write failed:`, err); }
}

async function _handleMessage(msg) {
  if (!msg || typeof msg !== "object") return;
  const me = game.user?.id;

  // Player → GM requests.
  if (msg.kind === "request") {
    if (msg.relayTo !== me || !isPrimaryGM()) return;
    const requester = _activeUser(msg.origin);
    if (!requester || requester.isGM || _payloadSize(msg) > MAX_PAYLOAD_BYTES) return;
    if (!_acceptPlayerRequest(requester.id, msg.requestId)) return;
    const inner = msg.message ?? {};
    if (inner.kind === "worldWrite") return _applySharedWrite(inner);
    if (policy() !== "all") return;
    const clean = _sanitizeRemoteMessage(inner);
    if (!clean) return;
    // Re-emit as an authoritative message, and honour it locally if addressed.
    _emit({ ...clean, origin: me, relayedFor: msg.origin, requestId:msg.requestId ?? foundry.utils.randomID(16) });
    if ((clean.targets ?? []).includes(me)) return _handleMessage({ ...clean, origin: me });
    return;
  }

  // Remote UI commands are accepted only from the deterministic GM relay.
  if (msg.origin !== primaryGM()?.id) return;

  const clean = _sanitizeRemoteMessage(msg);
  if (!clean) return;
  msg = clean;
  const targets = msg.targets ?? [];
  if (targets.length && !targets.includes(me)) return;

  switch (msg.kind) {
    case "open":
      await _handlers.openLocal(msg);
      break;
    case "close":
      await _handlers.closeLocal(msg);
      break;
    case "setVar":
      await _handlers.setVarLocal(msg);
      break;
    case "broadcast":
      _handlers.broadcastLocal(msg.widgetKey, msg.event, msg.payload);
      break;
    case "refresh":
      _handlers.refreshLocal(msg.widgetKey);
      break;
    default:
      break;
  }
}

export function installSocket() {
  game.socket?.on?.(SOCKET_NS, (msg) => {
    // We always handle our own side inline before emitting, so ignore the echo.
    if (msg?.origin === game.user?.id && msg?.kind !== "request") return;
    _handleMessage(msg).catch(err => console.warn(`${MODULE_ID} | socket handler failed:`, err));
  });
}
