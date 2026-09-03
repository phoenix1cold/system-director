/**
 * Node graph integration.
 *
 * Everything goes through the system's public extension points:
 *   SD.nodeRegistry.registerNode / registerCategory   — node definitions
 *   SD_NODE_RUNTIME.registerAction                    — exec-node handlers
 *   SD_NODE_RUNTIME.registerToken                     — `{sdUiWidget:…}` tokens
 *
 * Two things changed compared to the previous version:
 *
 *   - `Call UI Widget` (formerly Open UI Widget) has an **Audience** setting, so
 *     a graph can show the window to the caller only, to a specific actor's
 *     owners, to all players, or to everybody. Remote opening is relayed through
 *     a GM client (see ui-widget-net.mjs).
 *   - `On UI Widget Event` is a real event node bound to the `sdCustomEvent`
 *     hook, which the system's event bus already understands. The old
 *     implementation depended on `SD.system.runGraphById`, which does not exist,
 *     so those triggers never fired at all.
 */

import { MODULE_ID, AUDIENCES } from "./ui-widget-const.mjs";
import {
  getInstance, findInstancesByKey, allInstances, resolveInstance,
  setInstanceField, getInstanceField, setLastInstanceForGraph, getLastInstanceForGraph,
  localBroadcast, refreshByKey, isKeyOpen
} from "./ui-widget-registry.mjs";
import { findUIWidgetItem } from "./ui-widget-document.mjs";
import { resolveAudienceUsers, dispatchOpen, dispatchClose, dispatchSetVar, dispatchBroadcast } from "./ui-widget-net.mjs";
import { resolveEventPin } from "./ui-widget-events.mjs";

const OWNER = MODULE_ID;
const CATEGORY = "UI Widget";

let _lastInstanceId = "";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function b64(value) {
  try { return btoa(unescape(encodeURIComponent(String(value ?? "")))); }
  catch { return ""; }
}
function b64d(value) {
  try { return decodeURIComponent(escape(atob(String(value ?? "")))); }
  catch { return ""; }
}
const arg = (value) => `b64:${b64(value)}`;
function unarg(raw) {
  const s = String(raw ?? "");
  return s.startsWith("b64:") ? b64d(s.slice(4)) : s;
}
function unquote(value) {
  const s = String(value ?? "").trim();
  if (s.length >= 2 && ((s[0] === '"' && s.at(-1) === '"') || (s[0] === "'" && s.at(-1) === "'"))) return s.slice(1, -1);
  return s;
}

function resolveActor(ref, fallbackDoc) {
  const fallback = () => {
    if (fallbackDoc?.documentName === "Actor") return fallbackDoc;
    if (fallbackDoc?.actor) return fallbackDoc.actor;
    return null;
  };
  if (!ref) return fallback();
  if (ref?.documentName === "Actor") return ref;
  const raw = unquote(unarg(ref));
  if (!raw || raw === "0" || raw === "self" || raw === "actor") return fallback();
  if (raw === "user_character") return game.user?.character ?? null;
  try {
    const doc = fromUuidSync?.(raw);
    if (doc?.documentName === "Actor") return doc;
    if (doc?.actor) return doc.actor;
  } catch { /* not a uuid */ }
  return game.actors?.get?.(raw) ?? game.actors?.getName?.(raw) ?? null;
}

function usersOwningActor(actor, { onlineOnly = false, includeGM = false } = {}) {
  if (!actor) return [];
  const OWNER_LEVEL = CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
  return (game.users?.contents ?? []).filter(u => {
    if (!includeGM && u.isGM) return false;
    if (onlineOnly && !u.active) return false;
    if (typeof actor.testUserPermission === "function") return actor.testUserPermission(u, "OWNER");
    return (actor.ownership?.[u.id] ?? 0) >= OWNER_LEVEL;
  });
}

function parseVars(raw) {
  if (raw && typeof raw === "object") return raw;
  const text = String(unarg(raw) ?? "").trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return (parsed && typeof parsed === "object") ? parsed : {};
  } catch {
    // `a=1, b=hello` shorthand
    const out = {};
    for (const chunk of text.split(/[,;]/)) {
      const [key, ...rest] = chunk.split("=");
      if (!key?.trim()) continue;
      out[key.trim()] = rest.join("=").trim();
    }
    return out;
  }
}

const AUDIENCE_FIELD = {
  key: "audience", label: "Show to", type: "select", default: AUDIENCES.self,
  options: [
    { value: AUDIENCES.self, label: "Only me (the client running this graph)" },
    { value: AUDIENCES.gm, label: "GM clients" },
    { value: AUDIENCES.owners, label: "Owners of the Actor pin" },
    { value: AUDIENCES.players, label: "All players" },
    { value: AUDIENCES.everyone, label: "Everyone (players + GM)" },
    { value: AUDIENCES.users, label: "Specific users (list below)" }
  ]
};
const USERS_FIELD = { key: "users", label: "User ids / names (CSV)", type: "text", default: "" };

// ---------------------------------------------------------------------------
// Formula tokens
// ---------------------------------------------------------------------------

export function installFormulaTokens() {
  const RUNTIME = globalThis.SD_NODE_RUNTIME;
  if (!RUNTIME?.registerToken) {
    console.warn(`${MODULE_ID} | SD_NODE_RUNTIME.registerToken unavailable — value nodes will not resolve.`);
    return;
  }
  RUNTIME.registerToken("sdUiWidget:", (rest, ctx) => {
    const doc = ctx?.doc;
    const [head, ...tail] = String(rest ?? "").split(":");
    const op = String(head ?? "").trim();
    let body = tail.join(":");

    const takePin = (allowed) => {
      const match = body.match(new RegExp(`^(${allowed.join("|")}):(.*)$`));
      if (!match) return allowed[0];
      body = match[2];
      return match[1];
    };

    switch (op) {
      case "owningPCs": {
        const pin = takePin(["uuids", "count", "first"]);
        const [actorRef, onlineOnly = "no", includeGM = "no"] = body.split("|");
        const actor = resolveActor(actorRef, doc);
        const users = usersOwningActor(actor, { onlineOnly: onlineOnly === "yes", includeGM: includeGM === "yes" });
        const uuids = [...new Set(users.map(u => u.character?.uuid).filter(Boolean))];
        if (pin === "count") return uuids.length;
        if (pin === "first") return uuids[0] ?? "";
        return uuids.join(",");
      }
      case "ownerOnline": {
        const pin = takePin(["online", "count", "userIds"]);
        const [actorRef, includeGM = "no", requireAssigned = "no"] = body.split("|");
        const actor = resolveActor(actorRef, doc);
        let users = usersOwningActor(actor, { onlineOnly: true, includeGM: includeGM === "yes" });
        if (requireAssigned === "yes") users = users.filter(u => u.character);
        if (pin === "count") return users.length;
        if (pin === "userIds") return users.map(u => u.id).join(",");
        return users.length ? 1 : 0;
      }
      case "uiField": {
        const pin = takePin(["value", "text", "number", "bool"]);
        const [instanceRef, nameRef] = body.split("|");
        const instanceId = unarg(instanceRef);
        const name = unarg(nameRef ?? "");
        const rec = resolveInstance({ instanceId, widgetKey: instanceId });
        const raw = rec?.state?.getVar?.(name);
        if (raw === undefined) return "";
        if (pin === "text") return String(raw ?? "");
        if (pin === "number") { const n = Number(raw); return Number.isFinite(n) ? n : 0; }
        if (pin === "bool") {
          if (typeof raw === "boolean") return raw ? 1 : 0;
          const n = Number(raw);
          if (Number.isFinite(n)) return n !== 0 ? 1 : 0;
          return ["1", "true", "yes", "on"].includes(String(raw).toLowerCase()) ? 1 : 0;
        }
        return raw;
      }
      case "uiList": {
        const pin = takePin(["items", "count", "selected", "index", "csv", "first", "last"]);
        const [instanceRef, nameRef] = body.split("|");
        const instanceId = unarg(instanceRef);
        const name = unarg(nameRef ?? "");
        const rec = resolveInstance({ instanceId, widgetKey: instanceId });
        const raw = rec?.state?.getVar?.(name);
        let items = [];
        if (Array.isArray(raw)) items = raw;
        else {
          const text = String(raw ?? "").trim();
          if (text.startsWith("[")) { try { const parsed = JSON.parse(text); items = Array.isArray(parsed) ? parsed : []; } catch { items = []; } }
          if (!items.length && text) items = text.split(/[,\n]/).map(entry => entry.trim()).filter(Boolean);
        }
        const labelOf = item => (item && typeof item === "object") ? String(item.name ?? item.label ?? item.value ?? "") : String(item ?? "");
        const index = Number(rec?.state?.getVar?.(`${name}__index`) ?? -1);
        if (pin === "count") return items.length;
        if (pin === "csv") return items.map(labelOf).join(", ");
        if (pin === "first") return items[0] ?? "";
        if (pin === "last") return items[items.length - 1] ?? "";
        if (pin === "index") return Number.isFinite(index) ? index : -1;
        if (pin === "selected") return index >= 0 ? (items[index] ?? "") : "";
        return items;
      }
      case "isOpen": {
        const pin = takePin(["open", "count", "instances"]);
        const key = unarg(body);
        const list = findInstancesByKey(key);
        if (pin === "count") return list.length;
        if (pin === "instances") return list.map(rec => rec.id).join(",");
        return list.length ? 1 : 0;
      }
      case "lastInstance":
        return _lastInstanceId;
      case "ctx":
        return resolveEventPin(body || "value");
      default:
        return "";
    }
  }, { owner: OWNER });
}

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

export function installActionHandlers() {
  const RUNTIME = globalThis.SD_NODE_RUNTIME;
  if (!RUNTIME?.registerAction) return;

  RUNTIME.registerAction("sdUiWidgetOpen", async (ctx) => {
    const action = ctx.action ?? {};
    const key = String(action.widgetKey ?? "").trim();
    if (!key) { ui.notifications?.warn?.("Call UI Widget: widget key is empty"); return ""; }
    const item = findUIWidgetItem(key);
    if (!item) {
      ui.notifications?.warn?.(game.i18n.format("SDUI.Runtime.MissingWidget", { key }));
      return "";
    }
    const actor = resolveActor(action.owningActor, ctx.actor ?? ctx.item);
    const targets = resolveAudienceUsers(action.audience ?? AUDIENCES.self, {
      actor,
      userList: action.users ?? "",
      callerId: game.user?.id
    });
    const instanceId = await dispatchOpen({
      widgetKey: key,
      targets,
      actorUuid: actor?.uuid ?? "",
      itemUuid: String(action.contextItem ?? "").replace(/^['"]|['"]$/g, ""),
      mode: action.mode ?? "",
      vars: parseVars(action.vars),
      unique: action.unique !== "no",
      title: action.title ?? ""
    });
    if (instanceId) {
      _lastInstanceId = instanceId;
      if (action.__graphId) setLastInstanceForGraph(action.__graphId, instanceId);
    }
    return instanceId ?? "";
  }, { owner: OWNER });

  RUNTIME.registerAction("sdUiWidgetClose", async (ctx) => {
    const action = ctx.action ?? {};
    const key = String(action.widgetKey ?? "").trim();
    let instanceId = String(action.instanceId ?? "").trim();
    if (!instanceId && !key && action.__graphId) instanceId = getLastInstanceForGraph(action.__graphId) ?? "";
    const actor = resolveActor(action.owningActor, ctx.actor ?? ctx.item);
    const targets = resolveAudienceUsers(action.audience ?? AUDIENCES.self, {
      actor, userList: action.users ?? "", callerId: game.user?.id
    });
    await dispatchClose({ widgetKey: key, instanceId, targets });
  }, { owner: OWNER });

  RUNTIME.registerAction("sdUiWidgetSetField", async (ctx) => {
    const action = ctx.action ?? {};
    const name = String(action.element ?? "").trim();
    if (!name) return;
    const value = (await ctx.resolveValue?.(action.value)) ?? action.value;
    const key = String(action.widgetKey ?? "").trim();
    let instanceId = String(action.instanceId ?? "").trim();
    if (!instanceId && !key && action.__graphId) instanceId = getLastInstanceForGraph(action.__graphId) ?? "";
    const actor = resolveActor(action.owningActor, ctx.actor ?? ctx.item);
    const targets = resolveAudienceUsers(action.audience ?? AUDIENCES.self, {
      actor, userList: action.users ?? "", callerId: game.user?.id
    });
    await dispatchSetVar({ widgetKey: key, instanceId, name, value, targets });
  }, { owner: OWNER });

  RUNTIME.registerAction("sdUiWidgetSetList", async (ctx) => {
    const action = ctx.action ?? {};
    const name = String(action.element ?? "").trim();
    if (!name) return;
    const resolved = (await ctx.resolveValue?.(action.value)) ?? action.value;
    let items = [];
    if (Array.isArray(resolved)) items = resolved;
    else {
      const text = String(resolved ?? "").trim();
      if (text.startsWith("[")) { try { const parsed = JSON.parse(text); items = Array.isArray(parsed) ? parsed : []; } catch { items = []; } }
      if (!items.length && text) items = text.split(/[,\n]/).map(entry => entry.trim()).filter(Boolean);
    }
    const key = String(action.widgetKey ?? "").trim();
    let instanceId = String(action.instanceId ?? "").trim();
    if (!instanceId && !key && action.__graphId) instanceId = getLastInstanceForGraph(action.__graphId) ?? "";
    const actor = resolveActor(action.owningActor, ctx.actor ?? ctx.item);
    const targets = resolveAudienceUsers(action.audience ?? AUDIENCES.self, {
      actor, userList: action.users ?? "", callerId: game.user?.id
    });
    const mode = String(action.mode ?? "set");
    let next = items;
    if (mode !== "set") {
      const rec = resolveInstance({ instanceId, widgetKey: key });
      const current = rec?.state?.getVar?.(name);
      const list = Array.isArray(current) ? [...current] : [];
      if (mode === "append") next = [...list, ...items];
      else if (mode === "prepend") next = [...items, ...list];
      else if (mode === "remove") next = list.filter(entry => !items.some(item => JSON.stringify(item) === JSON.stringify(entry)));
      else if (mode === "clear") next = [];
    }
    await dispatchSetVar({ widgetKey: key, instanceId, name, value: next, targets });
  }, { owner: OWNER });

  RUNTIME.registerAction("sdUiWidgetBroadcast", async (ctx) => {
    const action = ctx.action ?? {};
    const key = String(action.widgetKey ?? "").trim();
    if (!key) return;
    const payload = (await ctx.resolveValue?.(action.payload)) ?? action.payload;
    const actor = resolveActor(action.owningActor, ctx.actor ?? ctx.item);
    const targets = resolveAudienceUsers(action.audience ?? AUDIENCES.everyone, {
      actor, userList: action.users ?? "", callerId: game.user?.id
    });
    dispatchBroadcast({ widgetKey: key, event: String(action.event ?? "custom"), payload, targets });
  }, { owner: OWNER });

  RUNTIME.registerAction("sdUiWidgetRefresh", async (ctx) => {
    const action = ctx.action ?? {};
    const key = String(action.widgetKey ?? "").trim();
    if (key) refreshByKey(key);
    else for (const rec of allInstances()) rec.app?.refresh?.();
  }, { owner: OWNER });
}

// ---------------------------------------------------------------------------
// Node definitions
// ---------------------------------------------------------------------------

export function registerUINodes() {
  const REG = globalThis.SD?.nodeRegistry ?? globalThis.CONFIG?.SD?.nodeRegistry;
  const registerNode = REG?.registerNode ?? REG?.registerNodeDefinition;
  const registerCategory = REG?.registerCategory ?? REG?.registerNodeCategory;
  if (typeof registerNode !== "function") {
    console.error(`${MODULE_ID} | node registry unavailable (SD.nodeRegistry missing).`, REG);
    return;
  }
  try { registerCategory?.({ id: CATEGORY, color: "#6a4ac0" }, { owner: OWNER }); }
  catch (err) { console.warn(`${MODULE_ID} | category registration failed:`, err); }

  // --- Close ----------------------------------------------------------
  registerNode("ui_close_widget", {
    title: "Close UI Widget",
    color: "#6a4ac0", cat: CATEGORY, wideNode: true,
    desc: "Close windows by instance id, or every window of a widget key. 'Show to' selects whose clients close it.",
    isAction: true,
    inputs: [
      { id: "exec", label: "", type: "exec" },
      { id: "instanceId", label: "Instance Id", type: "value.string" },
      { id: "actor", label: "Actor", type: "value.actor" }
    ],
    outputs: [{ id: "exec", label: "Then →", type: "exec" }],
    fields: [
      { key: "widgetKey", label: "Widget Key (blank = use instance)", type: "text", default: "" },
      AUDIENCE_FIELD,
      USERS_FIELD
    ],
    toAction: (n, inp = {}) => ({
      type: "sdUiWidgetClose",
      widgetKey: n.data.widgetKey ?? "",
      instanceId: inp.instanceId ?? "",
      audience: n.data.audience ?? AUDIENCES.self,
      users: n.data.users ?? "",
      owningActor: inp.actor ?? ""
    })
  }, { owner: OWNER });

  // --- Set value ------------------------------------------------------
  registerNode("ui_set_field", {
    title: "Set UI Widget Value",
    color: "#6a4ac0", cat: CATEGORY, wideNode: true,
    desc: "Write a widget variable. Variables declared 'shared' propagate to every client by themselves; "
        + "for local/user variables use 'Show to' to reach other clients.",
    isAction: true,
    inputs: [
      { id: "exec", label: "", type: "exec" },
      { id: "instanceId", label: "Instance Id", type: "value.string" },
      { id: "elementName", label: "Variable", type: "value.string" },
      { id: "value", label: "Value", type: "value.any" },
      { id: "actor", label: "Actor", type: "value.actor" }
    ],
    outputs: [{ id: "exec", label: "Then →", type: "exec" }],
    fields: [
      { key: "widgetKey", label: "Widget Key", type: "text", default: "" },
      { key: "elementName", label: "Variable name", type: "text", default: "" },
      { key: "value", label: "Value", type: "text", default: "" },
      AUDIENCE_FIELD,
      USERS_FIELD
    ],
    toAction: (n, inp = {}) => ({
      type: "sdUiWidgetSetField",
      widgetKey: n.data.widgetKey ?? "",
      instanceId: inp.instanceId ?? "",
      element: inp.elementName ?? n.data.elementName ?? "",
      value: inp.value ?? n.data.value ?? "",
      audience: n.data.audience ?? AUDIENCES.self,
      users: n.data.users ?? "",
      owningActor: inp.actor ?? ""
    })
  }, { owner: OWNER });

  // --- Get value ------------------------------------------------------
  registerNode("ui_get_field", {
    title: "Get UI Widget Value",
    color: "#3a6a8a", cat: CATEGORY, wideNode: true,
    desc: "Read a widget variable from an open window. Instance Id may also be a widget key.",
    inputs: [
      { id: "instanceId", label: "Instance / Key", type: "value.string" },
      { id: "elementName", label: "Variable", type: "value.string" }
    ],
    outputs: [
      { id: "value", label: "Value", type: "value.any" },
      { id: "text", label: "Text", type: "value.string" },
      { id: "number", label: "Number", type: "value.number" },
      { id: "bool", label: "Bool", type: "value.bool" }
    ],
    fields: [
      { key: "instanceId", label: "Instance / Key", type: "text", default: "" },
      { key: "elementName", label: "Variable name", type: "text", default: "" }
    ],
    compile: (n, i) => `{sdUiWidget:uiField:value:${arg(i.instanceId ?? n.data.instanceId ?? "")}|${arg(i.elementName ?? n.data.elementName ?? "")}}`,
    compilePin: (n, i, pin) => {
      const p = ["value", "text", "number", "bool"].includes(pin) ? pin : "value";
      return `{sdUiWidget:uiField:${p}:${arg(i.instanceId ?? n.data.instanceId ?? "")}|${arg(i.elementName ?? n.data.elementName ?? "")}}`;
    }
  }, { owner: OWNER });

  // --- List in / out --------------------------------------------------
  registerNode("ui_list_set", {
    title: "Set UI List Items",
    color: "#6a4ac0", cat: CATEGORY, wideNode: true,
    desc: "Feed an array into a List element (or any variable). Accepts arrays from widget nodes, "
        + "JSON text or comma separated text. Objects may carry name/label/img and are rendered as rows.",
    isAction: true,
    inputs: [
      { id: "exec", label: "", type: "exec" },
      { id: "instanceId", label: "Instance / Key", type: "value.string" },
      { id: "elementName", label: "List variable", type: "value.string" },
      { id: "items", label: "Items (array)", type: "value.array" },
      { id: "actor", label: "Actor", type: "value.actor" }
    ],
    outputs: [{ id: "exec", label: "Then →", type: "exec" }],
    fields: [
      { key: "widgetKey", label: "Widget Key", type: "text", default: "" },
      { key: "elementName", label: "List variable", type: "text", default: "" },
      { key: "mode", label: "Mode", type: "select", default: "set", options: [
        { value: "set", label: "Replace" }, { value: "append", label: "Append" },
        { value: "prepend", label: "Prepend" }, { value: "remove", label: "Remove matching" },
        { value: "clear", label: "Clear" }
      ] },
      { key: "items", label: "Items (CSV or JSON)", type: "text", default: "" },
      AUDIENCE_FIELD,
      USERS_FIELD
    ],
    toAction: (n, inp = {}) => ({
      type: "sdUiWidgetSetList",
      widgetKey: n.data.widgetKey ?? "",
      instanceId: inp.instanceId ?? "",
      element: inp.elementName ?? n.data.elementName ?? "",
      value: inp.items ?? n.data.items ?? "",
      mode: n.data.mode ?? "set",
      audience: n.data.audience ?? AUDIENCES.self,
      users: n.data.users ?? "",
      owningActor: inp.actor ?? ""
    })
  }, { owner: OWNER });

  registerNode("ui_list_get", {
    title: "Get UI List",
    color: "#3a6a8a", cat: CATEGORY, wideNode: true,
    desc: "Read a List element: the whole array, the row the player clicked, its index, or a text summary.",
    inputs: [
      { id: "instanceId", label: "Instance / Key", type: "value.string" },
      { id: "elementName", label: "List variable", type: "value.string" }
    ],
    outputs: [
      { id: "items", label: "Items (array)", type: "value.array" },
      { id: "count", label: "Count", type: "value.number" },
      { id: "selected", label: "Clicked item", type: "value.any" },
      { id: "index", label: "Clicked index", type: "value.number" },
      { id: "csv", label: "Text (CSV)", type: "value.string" },
      { id: "first", label: "First", type: "value.any" },
      { id: "last", label: "Last", type: "value.any" }
    ],
    fields: [
      { key: "instanceId", label: "Instance / Key", type: "text", default: "" },
      { key: "elementName", label: "List variable", type: "text", default: "" }
    ],
    compile: (n, i) => `{sdUiWidget:uiList:items:${arg(i.instanceId ?? n.data.instanceId ?? "")}|${arg(i.elementName ?? n.data.elementName ?? "")}}`,
    compilePin: (n, i, pin) => {
      const p = ["items", "count", "selected", "index", "csv", "first", "last"].includes(pin) ? pin : "items";
      return `{sdUiWidget:uiList:${p}:${arg(i.instanceId ?? n.data.instanceId ?? "")}|${arg(i.elementName ?? n.data.elementName ?? "")}}`;
    }
  }, { owner: OWNER });

  // --- Is open? -------------------------------------------------------
  registerNode("ui_is_open", {
    title: "UI Widget Open?",
    color: "#3a6a8a", cat: CATEGORY,
    desc: "True when at least one window with this key is open on THIS client.",
    inputs: [{ id: "key", label: "Widget Key", type: "value.string" }],
    outputs: [
      { id: "open", label: "Open", type: "value.bool" },
      { id: "count", label: "Count", type: "value.number" },
      { id: "instances", label: "Instance ids (CSV)", type: "value.string" }
    ],
    fields: [{ key: "widgetKey", label: "Widget Key", type: "text", default: "" }],
    compile: (n, i) => `{sdUiWidget:isOpen:open:${arg(i.key ?? n.data.widgetKey ?? "")}}`,
    compilePin: (n, i, pin) => {
      const p = ["open", "count", "instances"].includes(pin) ? pin : "open";
      return `{sdUiWidget:isOpen:${p}:${arg(i.key ?? n.data.widgetKey ?? "")}}`;
    }
  }, { owner: OWNER });

  // --- Refresh --------------------------------------------------------
  registerNode("ui_refresh_widget", {
    title: "Refresh UI Widget",
    color: "#6a4ac0", cat: CATEGORY,
    desc: "Re-render open windows so bindings pick up new data. Blank key = every open window.",
    isAction: true,
    inputs: [{ id: "exec", label: "", type: "exec" }],
    outputs: [{ id: "exec", label: "Then →", type: "exec" }],
    fields: [{ key: "widgetKey", label: "Widget Key", type: "text", default: "" }],
    toAction: (n) => ({ type: "sdUiWidgetRefresh", widgetKey: n.data.widgetKey ?? "" })
  }, { owner: OWNER });

  // --- Broadcast ------------------------------------------------------
  registerNode("ui_broadcast", {
    title: "Broadcast UI Widget Event",
    color: "#6a4ac0", cat: CATEGORY, wideNode: true,
    desc: "Send a named event with a payload to open windows of this key on the selected clients.",
    isAction: true,
    inputs: [
      { id: "exec", label: "", type: "exec" },
      { id: "payload", label: "Payload", type: "value.any" },
      { id: "actor", label: "Actor", type: "value.actor" }
    ],
    outputs: [{ id: "exec", label: "Then →", type: "exec" }],
    fields: [
      { key: "widgetKey", label: "Widget Key", type: "text", default: "" },
      { key: "event", label: "Event name", type: "text", default: "custom" },
      { ...AUDIENCE_FIELD, default: AUDIENCES.everyone },
      USERS_FIELD
    ],
    toAction: (n, inp = {}) => ({
      type: "sdUiWidgetBroadcast",
      widgetKey: n.data.widgetKey ?? "",
      event: n.data.event ?? "custom",
      payload: inp.payload ?? "",
      audience: n.data.audience ?? AUDIENCES.everyone,
      users: n.data.users ?? "",
      owningActor: inp.actor ?? ""
    })
  }, { owner: OWNER });

  // --- On UI Widget Event (real event node) ----------------------------
  //
  // Bound to `sdCustomEvent`, which the system's event bus already binds and
  // filters by `data.name`. UI Widget windows emit `<element>:<event>` names.
  registerNode("ui_on_event", {
    title: "On UI Widget Event",
    color: "#c04040", cat: CATEGORY, wideNode: true,
    desc: "Fires when a UI Widget element raises an event. Name format is '<element>:<event>', "
        + "e.g. 'attackButton:click' or 'hpInput:change'. Events: click, change, submit, open, close, tick, finished. "
        + "Enable 'Works outside a sheet' when this graph lives on a world item.",
    inputs: [],
    outputs: [{ id: "exec", label: "→ On Event", type: "exec" }],
    fields: [
      { key: "name", label: "Element:Event", type: "text", default: "", placeholder: "myButton:click", uniqueEventName: true },
      { key: "outOfSheet", label: "Works outside a sheet", type: "select", default: "yes", options: ["yes", "no"] }
    ],
    isEvent: true,
    eventHook: "sdCustomEvent"
  }, { owner: OWNER });

  // --- Event data (pure) ----------------------------------------------
  registerNode("ui_event_data", {
    title: "UI Widget Event Data",
    color: "#3a6a8a", cat: CATEGORY, wideNode: true,
    desc: "Values of the UI Widget event currently being handled: element value, element name, instance id and source.",
    inputs: [],
    outputs: [
      { id: "value", label: "Value", type: "value.any" },
      { id: "number", label: "Number", type: "value.number" },
      { id: "bool", label: "Bool", type: "value.bool" },
      { id: "element", label: "Element", type: "value.string" },
      { id: "event", label: "Event", type: "value.string" },
      { id: "instanceId", label: "Instance Id", type: "value.string" },
      { id: "widgetKey", label: "Widget Key", type: "value.string" },
      { id: "index", label: "Row index", type: "value.number" },
      { id: "actor", label: "Owner Actor", type: "value.actor" }
    ],
    fields: [],
    compile: () => "{sdUiWidget:ctx:value}",
    compilePin: (_n, _i, pin) => {
      const allowed = ["value", "number", "bool", "element", "event", "instance", "widgetKey", "index", "actor"];
      const p = pin === "instanceId" ? "instance" : pin;
      return allowed.includes(p) ? `{sdUiWidget:ctx:${p}}` : "{sdUiWidget:ctx:value}";
    }
  }, { owner: OWNER });

  // --- Owning player characters ---------------------------------------
  registerNode("owning_player_characters", {
    title: "Owning Player Characters",
    color: "#2a5a7a", cat: CATEGORY, wideNode: true,
    desc: "Player-character actors assigned to users owning the Actor input. Blank Actor pin → current graph actor.",
    inputs: [{ id: "actor", label: "Actor", type: "value.actor" }],
    outputs: [
      { id: "uuids", label: "UUIDs (array)", type: "value.array" },
      { id: "count", label: "Count", type: "value.number" },
      { id: "first", label: "First UUID", type: "value.string" }
    ],
    fields: [
      { key: "onlineOnly", label: "Online users only", type: "select", default: "no", options: ["no", "yes"] },
      { key: "includeGM", label: "Include GM users", type: "select", default: "no", options: ["no", "yes"] }
    ],
    compile: (n, i) => `{sdUiWidget:owningPCs:uuids:${arg(i.actor ?? "")}|${n.data.onlineOnly ?? "no"}|${n.data.includeGM ?? "no"}}`,
    compilePin: (n, i, pin) => {
      const p = ["uuids", "count", "first"].includes(pin) ? pin : "uuids";
      return `{sdUiWidget:owningPCs:${p}:${arg(i.actor ?? "")}|${n.data.onlineOnly ?? "no"}|${n.data.includeGM ?? "no"}}`;
    }
  }, { owner: OWNER });

  // --- Owner online? --------------------------------------------------
  registerNode("is_actor_owner_online", {
    title: "Owner Online?",
    color: "#2a5a7a", cat: CATEGORY, wideNode: true,
    desc: "True when at least one non-GM user owning the Actor is connected.",
    inputs: [{ id: "actor", label: "Actor", type: "value.actor" }],
    outputs: [
      { id: "online", label: "Online", type: "value.bool" },
      { id: "count", label: "Online owners", type: "value.number" },
      { id: "userIds", label: "User Ids (CSV)", type: "value.string" }
    ],
    fields: [
      { key: "includeGM", label: "Any owner (incl. GM)", type: "select", default: "no", options: ["no", "yes"] },
      { key: "requireAssigned", label: "Must have assigned character", type: "select", default: "no", options: ["no", "yes"] }
    ],
    compile: (n, i) => `{sdUiWidget:ownerOnline:online:${arg(i.actor ?? "")}|${n.data.includeGM ?? "no"}|${n.data.requireAssigned ?? "no"}}`,
    compilePin: (n, i, pin) => {
      const p = ["online", "count", "userIds"].includes(pin) ? pin : "online";
      return `{sdUiWidget:ownerOnline:${p}:${arg(i.actor ?? "")}|${n.data.includeGM ?? "no"}|${n.data.requireAssigned ?? "no"}}`;
    }
  }, { owner: OWNER });
}

export function initUINodes() {
  installFormulaTokens();
  installActionHandlers();
  if (globalThis.SD?.nodeRegistry) registerUINodes();
  else Hooks.once("sdNodeRegistryReady", () => registerUINodes());
}

/** Exposed for the module API / debugging. */
export function nodeRuntimeState() {
  return { lastInstanceId: _lastInstanceId, instances: allInstances().length };
}

export { getInstance, getInstanceField, setInstanceField, isKeyOpen, localBroadcast };
