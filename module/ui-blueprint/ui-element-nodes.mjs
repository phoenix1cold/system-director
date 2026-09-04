/**
 * Per-element UI Blueprint nodes.
 *
 * The character-sheet graph gives every placed sheet widget its own dedicated
 * pair of nodes (see `module/builder/widget-nodes.mjs`). UI Widget blueprints
 * only had one generic value pair plus a single hand written List pair, so a
 * graph could not tell a Progress bar from a Dropdown, and arrays had to be
 * smuggled through comma separated text.
 *
 * This module mirrors the sheet-widget pattern for UI Blueprint elements:
 *
 *   Get <Element>  - typed outputs per element type. A List returns a real
 *                    array, a Slider returns value/min/max/percent, a container
 *                    returns its children, ...
 *   Set <Element>  - exec node writing one property of one placed element with
 *                    array aware modes (replace / append / prepend / remove).
 *
 * The element itself is chosen from a dropdown of the elements actually placed
 * in the blueprint (`ui-element-picker` field, indexed by formula-graph.mjs),
 * so the graph shows the real UI instead of asking for a typed name.
 *
 * Everything is registered through the public extension points only:
 *   SD.nodeRegistry.registerNode / registerCategory
 *   SD_NODE_RUNTIME.registerToken / registerAction
 */

import { MODULE_ID, AUDIENCES } from "./ui-widget-const.mjs";
import {
  resolveInstance, allInstances, findInstancesByKey, getLastInstanceForGraph
} from "./ui-widget-registry.mjs";
import { resolveAudienceUsers, dispatchSetVar } from "./ui-widget-net.mjs";
import { findUIWidgetItem, listUIWidgetItems } from "./ui-widget-document.mjs";
import { UI_ELEMENT_TYPES, elementDef } from "./ui-widget-elements.mjs";

const OWNER = "sd-ui-element-nodes";
const CATEGORY = "UI Elements";
const COLOR_GET = "#2f7d6b";
const COLOR_SET = "#c2683a";

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const b64 = value => { try { return btoa(unescape(encodeURIComponent(String(value ?? "")))); } catch { return ""; } };
const b64d = value => { try { return decodeURIComponent(escape(atob(String(value ?? "")))); } catch { return ""; } };
export const arg = value => `b64:${b64(value)}`;
export const unarg = raw => { const s = String(raw ?? ""); return s.startsWith("b64:") ? b64d(s.slice(4)) : s; };

const num = value => { const n = Number(value); return Number.isFinite(n) ? n : 0; };
const pct = (value, max) => { const m = num(max); return m > 0 ? Math.round((num(value) / m) * 100) : 0; };

function boolish(value) {
  if (typeof value === "boolean") return value;
  if (value === undefined || value === null) return false;
  const n = Number(value);
  if (Number.isFinite(n)) return n !== 0;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

/** Array | JSON array | comma / newline separated text -> array. */
function toList(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  if (typeof value === "object") return [value];
  const text = String(value).trim();
  if (!text) return [];
  if (text.startsWith("[")) {
    try { const parsed = JSON.parse(text); if (Array.isArray(parsed)) return parsed; } catch { /* not JSON */ }
  }
  // An unresolved formula (`{var:items}`) is not data - the window evaluates it.
  if (text.startsWith("{") && text.endsWith("}")) return [];
  return text.split(/[,\n]/).map(entry => entry.trim()).filter(Boolean);
}

const labelOf = item => (item && typeof item === "object")
  ? String(item.name ?? item.label ?? item.value ?? "")
  : String(item ?? "");

const choiceValue = choice => (choice && typeof choice === "object")
  ? (choice.value ?? choice.key ?? choice.label ?? choice.name ?? "")
  : choice;

const prettify = type => String(type ?? "").replace(/[-_]/g, " ").replace(/\b\w/g, chr => chr.toUpperCase());

/** Element/property labels are i18n keys; fall back to a readable default. */
function locLabel(key, fallback) {
  const raw = String(key ?? "");
  if (!raw) return prettify(fallback);
  const out = globalThis.game?.i18n?.localize?.(raw) ?? raw;
  return (!out || out === raw) ? prettify(fallback) : out;
}

function resolveActor(ref, fallbackDoc) {
  const fallback = () => {
    if (fallbackDoc?.documentName === "Actor") return fallbackDoc;
    if (fallbackDoc?.actor) return fallbackDoc.actor;
    return null;
  };
  if (!ref) return fallback();
  if (ref?.documentName === "Actor") return ref;
  const raw = String(unarg(ref) ?? "").trim().replace(/^['"]|['"]$/g, "");
  if (!raw || raw === "0" || raw === "self" || raw === "actor") return fallback();
  if (raw === "user_character") return game.user?.character ?? null;
  try {
    const doc = globalThis.fromUuidSync?.(raw);
    if (doc?.documentName === "Actor") return doc;
    if (doc?.actor) return doc.actor;
  } catch { /* not a uuid */ }
  return game.actors?.get?.(raw) ?? game.actors?.getName?.(raw) ?? null;
}

// ---------------------------------------------------------------------------
// Element lookup
// ---------------------------------------------------------------------------

/**
 * Resolve one placed element by id, name or partial name.
 *
 * Matching is forgiving so the "Element" pin can be driven by a human typed
 * name. `elementType` narrows the search to one element type so two elements
 * sharing a name cannot shadow each other; an untyped hit is still accepted so
 * older graphs keep working.
 */
export function findElement(system, ref, { elementType = "" } = {}) {
  const raw = String(ref ?? "").trim();
  if (!raw) return null;
  const all = Array.isArray(system?.elements) ? system.elements : [];
  if (!all.length) return null;
  const loose = raw.toLowerCase().replace(/\s+/g, " ");
  const wantType = String(elementType ?? "").trim();

  const pick = list => {
    let byId = null, byName = null, byNameCI = null, byPartial = null;
    for (const el of list) {
      if (!el) continue;
      const id = String(el.id ?? el.widgetId ?? "");
      const name = String(el.name ?? "").trim();
      if (!byId && id && id === raw) byId = el;
      if (!byName && name && name === raw) byName = el;
      if (!byNameCI && name && name.toLowerCase() === loose) byNameCI = el;
      if (!byPartial && name && loose.length > 2 && name.toLowerCase().includes(loose)) byPartial = el;
    }
    return byId ?? byName ?? byNameCI ?? byPartial;
  };

  const typed = wantType ? all.filter(el => String(el?.type ?? "") === wantType) : all;
  return pick(typed) ?? (wantType ? pick(all) : null);
}

/**
 * Resolve the window instance, the blueprint item and the element record.
 * Works at design time too (no open window): the blueprint is then found by
 * widget key, or by scanning the blueprints for the element id.
 */
export function resolveTarget({ instanceId = "", widgetKey = "", ref = "", elementType = "" } = {}) {
  const inst = String(instanceId ?? "").trim();
  const key = String(widgetKey ?? "").trim();

  let rec = resolveInstance({ instanceId: inst, widgetKey: key || inst });
  let blueprint = rec?.state?.blueprint ?? null;
  if (!blueprint && (key || inst)) blueprint = findUIWidgetItem(key || inst) ?? null;

  let el = blueprint ? findElement(blueprint.system, ref, { elementType }) : null;
  if (!el) {
    for (const item of (listUIWidgetItems() ?? [])) {
      const hit = findElement(item?.system, ref, { elementType });
      if (!hit) continue;
      el = hit;
      blueprint = item;
      rec ??= findInstancesByKey(item?.system?.widgetKey ?? "")[0] ?? null;
      break;
    }
  }
  return { rec, blueprint, el };
}

/** Every open window this action should write to on THIS client. */
function localInstances({ instanceId = "", widgetKey = "" } = {}) {
  const inst = String(instanceId ?? "").trim();
  const key = String(widgetKey ?? "").trim();
  if (inst) { const rec = resolveInstance({ instanceId: inst }); return rec ? [rec] : []; }
  if (key) return findInstancesByKey(key);
  return allInstances();
}

/**
 * Current value of one element property, using the same precedence as the
 * renderer: per-instance override written by a node, then the authored binding,
 * then the value variable, then the literal prop/style value.
 */
export function readProp(rec, el, key, fallback) {
  if (!el) return fallback;
  const state = rec?.state;
  const id = el.id ?? el.widgetId ?? el.name;

  if (state?.hasWidgetProperty?.(id, key)) return state.getWidgetProperty(id, key, fallback);

  const binding = el.bind?.[key];
  if (binding && typeof binding === "object") {
    if (binding.kind === "variable") {
      const value = state?.getVariable?.(binding.variableId);
      if (value !== undefined) return value;
    } else if (binding.kind === "widget") {
      const value = state?.getWidgetProperty?.(binding.widgetId, binding.property ?? key);
      if (value !== undefined) return value;
    }
  }

  if (key === "value" && state) {
    const value = state.getWidgetProperty?.(id, "value", undefined);
    if (value !== undefined) return value;
  }

  const raw = el.props?.[key] ?? el.style?.[key];
  return raw === undefined ? fallback : raw;
}

const valueOf = (rec, el) => readProp(rec, el, "value", "");
const textOf = (rec, el) => String(valueOf(rec, el) ?? "");
const numberOf = (rec, el) => num(valueOf(rec, el));
const boolOf = (rec, el) => boolish(valueOf(rec, el)) ? 1 : 0;

const childrenOf = (blueprint, el) => (blueprint?.system?.elements ?? [])
  .filter(entry => String(entry?.parent ?? "") === String(el?.id ?? "\u0000"))
  .map(entry => ({ id: entry.id, name: entry.name ?? entry.id, type: entry.type ?? "" }));

/** Rows of a List element: what a node pushed in, the binding, or literal text. */
const listItems = (rec, el) => toList(readProp(rec, el, "source", []));
const listIndex = (rec, el) => {
  const name = `${el?.name ?? el?.id}__index`;
  const raw = rec?.state?.getVariable?.(name);
  const index = Number(raw);
  return Number.isFinite(index) ? index : -1;
};
const choicesOf = (rec, el) => toList(readProp(rec, el, "choices", []));
const choiceIndex = (rec, el) => {
  const current = String(valueOf(rec, el) ?? "");
  return choicesOf(rec, el).findIndex(choice =>
    String(choiceValue(choice)) === current || labelOf(choice) === current);
};

// ---------------------------------------------------------------------------
// Output pins per element type
// ---------------------------------------------------------------------------

const VISIBLE_PIN = ["visible", "Visible?", "value.bool", (r, e) => boolish(readProp(r, e, "visible", true)) ? 1 : 0];
const ENABLED_PIN = ["enabled", "Enabled?", "value.bool", (r, e) => boolish(readProp(r, e, "enabled", true)) ? 1 : 0];

const CONTAINER_PINS = [
  ["children", "Children (array)", "value.array", (r, e, bp) => childrenOf(bp, e)],
  ["count", "Child count", "value.number", (r, e, bp) => childrenOf(bp, e).length],
  ["names", "Child names (array)", "value.array", (r, e, bp) => childrenOf(bp, e).map(child => child.name)],
  VISIBLE_PIN
];

const DEFAULT_PINS = [
  ["value", "Value", "value.any", (r, e) => valueOf(r, e)],
  ["text", "Text", "value.string", textOf],
  ["number", "Number", "value.number", numberOf],
  ["bool", "Bool", "value.bool", boolOf],
  VISIBLE_PIN
];

export const ELEMENT_NODE_CONTRACTS = Object.freeze({
  label: [
    ["value", "Text", "value.string", (r, e) => String(readProp(r, e, "text", valueOf(r, e)) ?? "")],
    ["length", "Length", "value.number", (r, e) => String(readProp(r, e, "text", valueOf(r, e)) ?? "").length],
    VISIBLE_PIN
  ],
  richtext: [
    ["value", "HTML", "value.string", (r, e) => String(readProp(r, e, "html", valueOf(r, e)) ?? "")],
    VISIBLE_PIN
  ],
  image: [
    ["src", "Image path", "value.string", (r, e) => String(readProp(r, e, "src", valueOf(r, e)) ?? "")],
    VISIBLE_PIN
  ],
  icon: [
    ["icon", "Icon class", "value.string", (r, e) => String(readProp(r, e, "icon", valueOf(r, e)) ?? "")],
    VISIBLE_PIN
  ],
  button: [
    ["value", "Value", "value.any", (r, e) => valueOf(r, e)],
    ["text", "Label", "value.string", (r, e) => String(readProp(r, e, "text", "") ?? "")],
    ENABLED_PIN,
    VISIBLE_PIN
  ],
  progress: [
    ["value", "Value", "value.number", numberOf],
    ["max", "Max", "value.number", (r, e) => num(readProp(r, e, "max", 0))],
    ["percent", "Percent", "value.number", (r, e) => pct(valueOf(r, e), readProp(r, e, "max", 0))],
    ["full", "Full?", "value.bool", (r, e) => num(valueOf(r, e)) >= num(readProp(r, e, "max", 0)) ? 1 : 0],
    VISIBLE_PIN
  ],
  separator: [VISIBLE_PIN],
  spacer: [VISIBLE_PIN],
  textbox: [
    ["value", "Text", "value.string", textOf],
    ["length", "Length", "value.number", (r, e) => textOf(r, e).length],
    ["number", "As number", "value.number", numberOf],
    ENABLED_PIN,
    VISIBLE_PIN
  ],
  textarea: [
    ["value", "Text", "value.string", textOf],
    ["length", "Length", "value.number", (r, e) => textOf(r, e).length],
    ["lines", "Lines (array)", "value.array", (r, e) => textOf(r, e).split(/\n/)],
    ENABLED_PIN,
    VISIBLE_PIN
  ],
  number: [
    ["value", "Number", "value.number", numberOf],
    ["min", "Min", "value.number", (r, e) => num(readProp(r, e, "min", 0))],
    ["max", "Max", "value.number", (r, e) => num(readProp(r, e, "max", 0))],
    ENABLED_PIN,
    VISIBLE_PIN
  ],
  slider: [
    ["value", "Number", "value.number", numberOf],
    ["min", "Min", "value.number", (r, e) => num(readProp(r, e, "min", 0))],
    ["max", "Max", "value.number", (r, e) => num(readProp(r, e, "max", 0))],
    ["percent", "Percent", "value.number", (r, e) => pct(valueOf(r, e), readProp(r, e, "max", 0))],
    ENABLED_PIN,
    VISIBLE_PIN
  ],
  checkbox: [
    ["value", "Checked", "value.bool", boolOf],
    ["text", "Label", "value.string", (r, e) => String(readProp(r, e, "text", "") ?? "")],
    ENABLED_PIN,
    VISIBLE_PIN
  ],
  switch: [
    ["value", "On", "value.bool", boolOf],
    ["text", "Label", "value.string", (r, e) => String(readProp(r, e, "text", "") ?? "")],
    ENABLED_PIN,
    VISIBLE_PIN
  ],
  dropdown: [
    ["value", "Selected", "value.any", (r, e) => valueOf(r, e)],
    ["text", "Selected text", "value.string", textOf],
    ["choices", "Choices (array)", "value.array", choicesOf],
    ["count", "Choice count", "value.number", (r, e) => choicesOf(r, e).length],
    ["index", "Selected index", "value.number", choiceIndex],
    ENABLED_PIN,
    VISIBLE_PIN
  ],
  radiogroup: [
    ["value", "Selected", "value.any", (r, e) => valueOf(r, e)],
    ["text", "Selected text", "value.string", textOf],
    ["choices", "Choices (array)", "value.array", choicesOf],
    ["count", "Choice count", "value.number", (r, e) => choicesOf(r, e).length],
    ["index", "Selected index", "value.number", choiceIndex],
    ENABLED_PIN,
    VISIBLE_PIN
  ],
  colorpick: [
    ["value", "Color", "value.string", textOf],
    ENABLED_PIN,
    VISIBLE_PIN
  ],
  list: [
    ["items", "Items (array)", "value.array", listItems],
    ["count", "Count", "value.number", (r, e) => listItems(r, e).length],
    ["selected", "Clicked item", "value.any", (r, e) => {
      const index = listIndex(r, e);
      const items = listItems(r, e);
      return index >= 0 ? (items[index] ?? valueOf(r, e)) : valueOf(r, e);
    }],
    ["index", "Clicked index", "value.number", listIndex],
    ["value", "Selected value", "value.any", (r, e) => valueOf(r, e)],
    ["labels", "Labels (array)", "value.array", (r, e) => listItems(r, e).map(labelOf)],
    ["csv", "Text (CSV)", "value.string", (r, e) => listItems(r, e).map(labelOf).join(", ")],
    ["first", "First", "value.any", (r, e) => listItems(r, e)[0] ?? ""],
    ["last", "Last", "value.any", (r, e) => { const items = listItems(r, e); return items[items.length - 1] ?? ""; }],
    VISIBLE_PIN
  ],
  timer: [
    ["remaining", "Remaining", "value.number", (r, e) => num(readProp(r, e, "remaining", readProp(r, e, "seconds", 0)))],
    ["seconds", "Duration", "value.number", (r, e) => num(readProp(r, e, "seconds", 0))],
    ["running", "Running?", "value.bool", (r, e) => boolish(readProp(r, e, "running", readProp(r, e, "autoStart", false))) ? 1 : 0],
    ["value", "Value", "value.any", (r, e) => valueOf(r, e)],
    VISIBLE_PIN
  ],
  sdwidget: [
    ["value", "Value", "value.any", (r, e) => valueOf(r, e)],
    ["widgetType", "Widget type", "value.string", (r, e) => String(readProp(r, e, "widgetType", "") ?? "")],
    VISIBLE_PIN
  ]
});

/** Node type ids of one element type. */
export const elementGetNodeType = type => `ui_el_get_${type}`;
export const elementSetNodeType = type => `ui_el_set_${type}`;

export function pinsOf(type) {
  const contract = ELEMENT_NODE_CONTRACTS[type];
  if (contract) return contract;
  return elementDef(type)?.container ? CONTAINER_PINS : DEFAULT_PINS;
}

/** Value pin type of the Set node - a List takes a real array, not text. */
export function setValuePinType(type) {
  if (type === "list" || elementDef(type)?.container) return "value.array";
  if (["number", "slider", "progress", "timer"].includes(type)) return "value.number";
  if (["checkbox", "switch"].includes(type)) return "value.bool";
  if (["label", "richtext", "textbox", "textarea", "colorpick", "image", "icon"].includes(type)) return "value.string";
  return "value.any";
}

const SEMANTIC_GROUPS = ["content", "data", "behaviour", "behavior"];

/** Properties the Set node offers: the element's own semantic props + value. */
export function settableProps(type) {
  const def = elementDef(type);
  const schema = (def?.props ?? []).filter(prop => !prop.style && SEMANTIC_GROUPS.includes(String(prop.group ?? "")));
  const out = [];
  const push = (value, label) => { if (value && !out.some(entry => entry.value === value)) out.push({ value, label }); };

  if (!def?.container) push("value", "Value");
  for (const prop of schema) push(prop.key, locLabel(prop.label, prop.key));
  push("visible", "Visible");
  push("enabled", "Enabled");
  push("tooltip", "Tooltip");
  return out;
}

/** Sensible default target property per element type. */
export function defaultSetProp(type) {
  const keys = settableProps(type).map(entry => entry.value);
  const preferred = { list: "source", timer: "seconds", label: "text", richtext: "html", image: "src", icon: "icon" }[type];
  if (preferred && keys.includes(preferred)) return preferred;
  if (keys.includes("value")) return "value";
  const content = (elementDef(type)?.props ?? []).find(prop => SEMANTIC_GROUPS.includes(String(prop.group ?? "")) && keys.includes(prop.key));
  return content?.key ?? keys[0] ?? "value";
}

// ---------------------------------------------------------------------------
// Value tokens
// ---------------------------------------------------------------------------

function tokenBody(node, inputs = {}) {
  const data = node?.data ?? {};
  return [
    arg(inputs.elementRef ?? data.elementRef ?? ""),
    arg(inputs.instanceId ?? data.instanceId ?? ""),
    arg(data.property ?? "")
  ].join("|");
}

export function installElementTokens() {
  const RUNTIME = globalThis.SD_NODE_RUNTIME;
  if (!RUNTIME?.registerToken) {
    console.warn(`${MODULE_ID} | SD_NODE_RUNTIME.registerToken unavailable - element value nodes will not resolve.`);
    return;
  }
  RUNTIME.registerToken("sdUiElement:", (rest, _ctx) => {
    const [type, pin, ...tail] = String(rest ?? "").split(":");
    const [refPart, instancePart, propertyPart] = String(tail.join(":")).split("|");
    const ref = unarg(refPart);
    const instanceId = unarg(instancePart);
    const property = unarg(propertyPart);

    const { rec, blueprint, el } = resolveTarget({
      instanceId, widgetKey: instanceId, ref, elementType: type
    });
    if (!el) return "";

    try {
      if (pin === "prop") return readProp(rec, el, property || "value", "") ?? "";
      const pins = pinsOf(el.type ?? type);
      const entry = pins.find(item => item[0] === pin) ?? pins[0];
      const value = entry?.[3]?.(rec, el, blueprint);
      return value === undefined ? "" : value;
    } catch (error) {
      console.warn(`${MODULE_ID} | element node read failed`, error);
      return "";
    }
  }, { owner: OWNER });
}

// ---------------------------------------------------------------------------
// Set action
// ---------------------------------------------------------------------------

function applyMode(mode, current, raw, { wantsArray = false } = {}) {
  switch (String(mode || "set")) {
    case "add":     return num(current) + num(raw);
    case "sub":     return num(current) - num(raw);
    case "toggle":  return !boolish(current);
    case "append":  return [...toList(current), ...toList(raw)];
    case "prepend": return [...toList(raw), ...toList(current)];
    case "remove": {
      const drop = toList(raw).map(entry => JSON.stringify(entry));
      return toList(current).filter(entry => !drop.includes(JSON.stringify(entry)));
    }
    case "clear":
      if (Array.isArray(current) || wantsArray) return [];
      if (typeof current === "number") return 0;
      if (typeof current === "boolean") return false;
      return "";
    default:
      return wantsArray ? toList(raw) : raw;
  }
}

export function installElementActions() {
  const RUNTIME = globalThis.SD_NODE_RUNTIME;
  if (!RUNTIME?.registerAction) return;

  RUNTIME.registerAction("sdUiElementSet", async (ctx) => {
    const action = ctx.action ?? {};
    const elementType = String(action.elementType ?? "");
    const ref = unarg(action.elementRef);
    const key = String(action.widgetKey ?? "").trim();
    let instanceId = String(action.instanceId ?? "").trim();
    if (!instanceId && !key && action.__graphId) instanceId = getLastInstanceForGraph(action.__graphId) ?? "";

    const mode = String(action.mode ?? "set");
    const property = String(action.property || defaultSetProp(elementType) || "value");
    const raw = (await ctx.resolveValue?.(action.value)) ?? action.value;

    const { rec, blueprint, el } = resolveTarget({ instanceId, widgetKey: key, ref, elementType });
    if (!el) {
      console.warn(`${MODULE_ID} | Set element: no "${elementType}" element matched "${ref}"`);
      return;
    }

    const targetKey = key || blueprint?.system?.widgetKey || rec?.widgetKey || "";
    const wantsArray = setValuePinType(el.type ?? elementType) === "value.array"
      || ["source", "choices", "items"].includes(property);
    const current = readProp(rec, el, property, undefined);
    const next = applyMode(mode, current, raw, { wantsArray });

    const actor = resolveActor(action.owningActor, ctx.actor ?? ctx.item);
    const targets = resolveAudienceUsers(action.audience ?? AUDIENCES.self, {
      actor, userList: action.users ?? "", callerId: game.user?.id
    });

    // "Reset" drops the override so the authored value / binding takes over.
    if (mode === "reset") {
      for (const inst of localInstances({ instanceId, widgetKey: targetKey })) {
        inst.state?.clearWidgetProperty?.(el.id, property);
        inst.app?.refresh?.();
      }
      return;
    }

    // Variable backed writes travel over the socket, so remote clients update too.
    const binding = el.bind?.[property];
    const boundVariable = (binding && typeof binding === "object" && binding.kind === "variable")
      ? binding.variableId : null;
    const valueVariable = property === "value" ? (el.valueVariableId || null) : null;
    const variableId = boundVariable ?? valueVariable;

    if (variableId) {
      await dispatchSetVar({ widgetKey: targetKey, instanceId, name: variableId, value: next, targets });
      return;
    }

    for (const inst of localInstances({ instanceId, widgetKey: targetKey })) {
      try { await inst.state?.setWidgetProperty?.(el.id, property, next); }
      catch (error) { console.warn(`${MODULE_ID} | element write failed`, error); }
      inst.app?.refresh?.();
    }
  }, { owner: OWNER });
}

// ---------------------------------------------------------------------------
// Node definitions
// ---------------------------------------------------------------------------

const AUDIENCE_FIELD = {
  key: "audience", label: "Apply for", type: "select", default: AUDIENCES.self,
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

const MODE_FIELD = {
  key: "mode", label: "Mode", type: "select", default: "set",
  options: [
    { value: "set", label: "Set / replace" },
    { value: "add", label: "Add" },
    { value: "sub", label: "Subtract" },
    { value: "toggle", label: "Toggle" },
    { value: "append", label: "Append to array" },
    { value: "prepend", label: "Prepend to array" },
    { value: "remove", label: "Remove matching" },
    { value: "clear", label: "Clear" },
    { value: "reset", label: "Reset to designed value" }
  ]
};

export function registerElementNodes() {
  const REG = globalThis.SD?.nodeRegistry ?? globalThis.CONFIG?.SD?.nodeRegistry;
  const registerNode = REG?.registerNode ?? REG?.registerNodeDefinition;
  const registerCategory = REG?.registerCategory ?? REG?.registerNodeCategory;
  if (typeof registerNode !== "function") {
    console.error(`${MODULE_ID} | node registry unavailable - per element nodes skipped.`, REG);
    return 0;
  }
  try { registerCategory?.({ id: CATEGORY, color: COLOR_GET }, { owner: OWNER }); }
  catch (error) { console.warn(`${MODULE_ID} | category registration failed:`, error); }

  let registered = 0;
  for (const type of Object.keys(UI_ELEMENT_TYPES)) {
    const def = elementDef(type);
    const label = locLabel(def?.label, type);
    const pins = pinsOf(type);
    const pickerField = {
      key: "elementRef", label: "Element", type: "ui-element-picker", default: "",
      elementType: type, allowManual: true,
      hint: "Pick one of the elements placed in this UI Widget, or type its name."
    };
    const instanceField = {
      key: "instanceId", label: "Instance / Widget Key", type: "text", default: "",
      hint: "Blank = the open window of this blueprint."
    };

    // ----- Get ------------------------------------------------------------
    registerNode(elementGetNodeType(type), {
      title: `Get ${label}`,
      color: COLOR_GET, cat: CATEGORY, wideNode: true,
      desc: `Read the placed ${label} element: ${pins.map(pin => pin[1]).join(", ")}. `
          + "Values come from the running window, so this works while the UI is open.",
      inputs: [
        { id: "elementRef", label: "Element (id / name)", type: "value.string" },
        { id: "instanceId", label: "Instance / Key", type: "value.string" }
      ],
      outputs: [
        ...pins.map(([id, pinLabel, pinType]) => ({ id, label: pinLabel, type: pinType })),
        { id: "prop", label: "Property (field below)", type: "value.any" }
      ],
      fields: [
        pickerField,
        instanceField,
        { key: "property", label: "Property for the 'Property' pin", type: "text", default: "" }
      ],
      compile: (n, i) => `{sdUiElement:${type}:${pins[0][0]}:${tokenBody(n, i)}}`,
      compilePin: (n, i, pin) => {
        const valid = pin === "prop" || pins.some(entry => entry[0] === pin) ? pin : pins[0][0];
        return `{sdUiElement:${type}:${valid}:${tokenBody(n, i)}}`;
      }
    }, { owner: OWNER });
    registered++;

    // ----- Set ------------------------------------------------------------
    const properties = settableProps(type);
    const defaultProp = defaultSetProp(type);
    registerNode(elementSetNodeType(type), {
      title: `Set ${label}`,
      color: COLOR_SET, cat: CATEGORY, wideNode: true,
      isAction: true,
      desc: `Write one property of the placed ${label} element (${properties.map(entry => entry.label).join(", ")}). `
          + (setValuePinType(type) === "value.array"
            ? "The Value pin takes a real array, so widget/inventory nodes can feed it directly."
            : "Bound and shared variables propagate by themselves; use 'Apply for' to reach other clients."),
      inputs: [
        { id: "exec", label: "", type: "exec" },
        { id: "elementRef", label: "Element (id / name)", type: "value.string" },
        { id: "value", label: "Value", type: setValuePinType(type) },
        { id: "instanceId", label: "Instance / Key", type: "value.string" },
        { id: "actor", label: "Actor", type: "value.actor" }
      ],
      outputs: [{ id: "exec", label: "Then \u2192", type: "exec" }],
      fields: [
        pickerField,
        { key: "widgetKey", label: "Widget Key (blank = any open window)", type: "text", default: "" },
        { key: "property", label: "Property", type: "select", default: defaultProp, options: properties },
        MODE_FIELD,
        { key: "value", label: "Value", type: "text", default: "" },
        AUDIENCE_FIELD,
        USERS_FIELD
      ],
      toAction: (n, inp = {}) => ({
        type: "sdUiElementSet",
        elementType: type,
        elementRef: arg(inp.elementRef ?? n.data.elementRef ?? ""),
        instanceId: inp.instanceId ?? n.data.instanceId ?? "",
        widgetKey: n.data.widgetKey ?? "",
        property: n.data.property ?? defaultProp,
        mode: n.data.mode ?? "set",
        value: inp.value ?? n.data.value ?? "",
        audience: n.data.audience ?? AUDIENCES.self,
        users: n.data.users ?? "",
        owningActor: inp.actor ?? ""
      })
    }, { owner: OWNER });
    registered++;
  }
  return registered;
}

export function initUIElementNodes() {
  installElementTokens();
  installElementActions();
  if (globalThis.SD?.nodeRegistry) registerElementNodes();
  else Hooks.once("sdNodeRegistryReady", () => registerElementNodes());
}
