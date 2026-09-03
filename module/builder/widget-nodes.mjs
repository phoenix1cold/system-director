/**
 * Per-widget Blueprint nodes.
 *
 * Every sheet widget owns its data (`system.widgetVars.<key>.<field>`), so every
 * widget type gets its own dedicated node pair:
 *
 *   Get <Widget>  — typed outputs (inventory returns an item array, tags an
 *                   array of strings, resources value/max/percent, ...)
 *   Set <Widget>  — exec node writing the widget's own variables
 *
 * Registration goes through the public extension points only:
 *   SD.nodeRegistry.registerNode / registerCategory
 *   SD_NODE_RUNTIME.registerToken / registerAction
 */

import { WIDGET_TYPES } from "./widget-registry.mjs";
import { WIDGET_VARIABLES, widgetVarKey, widgetVarPath, coerceWidgetValue } from "../helpers/widget-variables.mjs";

const OWNER = "sd-widget-nodes";
const CATEGORY = "Sheet Widgets";
const COLOR_GET = "#2f7d6b";
const COLOR_SET = "#c2683a";

const b64 = value => { try { return btoa(unescape(encodeURIComponent(String(value ?? "")))); } catch { return ""; } };
const b64d = value => { try { return decodeURIComponent(escape(atob(String(value ?? "")))); } catch { return ""; } };
export const arg = value => `b64:${b64(value)}`;
export const unarg = raw => { const s = String(raw ?? ""); return s.startsWith("b64:") ? b64d(s.slice(4)) : s; };

/** Walk every widget of a document, including nested and builder children. */
export function forEachWidget(doc, callback) {
  const visit = widget => {
    if (!widget || typeof widget !== "object") return;
    callback(widget);
    for (const child of (widget.widgets ?? [])) visit(child);
    for (const element of (widget.elements ?? [])) visit(element?.widget);
  };
  for (const tab of (doc?.system?.customTabs ?? [])) {
    for (const row of (tab?.rows ?? [])) {
      for (const widget of (row?.widgets ?? [])) visit(widget);
    }
  }
}

/**
 * Resolve one widget by Widget Key, widget id or label.
 *
 * Matching is deliberately forgiving so the "Widget" pin can be driven by a
 * human-typed name: exact key/id wins, then case-insensitive key/label, then a
 * partial label match. `widgetType` narrows the search to one widget type so
 * two widgets sharing a label cannot shadow each other.
 */
export function findWidget(doc, key, { widgetType = "" } = {}) {
  const raw = String(key ?? "").trim();
  if (!doc || !raw) return null;
  const loose = raw.toLowerCase().replace(/\s+/g, " ");
  const wantType = String(widgetType ?? "").trim();
  let byKey = null, byId = null, byKeyCI = null, byLabel = null, byPartial = null;
  forEachWidget(doc, widget => {
    if (wantType && String(widget.type ?? "") !== wantType) return;
    const wKey = widgetVarKey(widget);
    const wLabel = String(widget.label ?? "").trim().toLowerCase().replace(/\s+/g, " ");
    if (!byKey && wKey === raw) byKey = widget;
    if (!byId && String(widget.id ?? "") === raw) byId = widget;
    if (!byKeyCI && wKey.toLowerCase() === loose) byKeyCI = widget;
    if (!byLabel && wLabel && wLabel === loose) byLabel = widget;
    if (!byPartial && wLabel && loose.length > 2 && wLabel.includes(loose)) byPartial = widget;
  });
  const hit = byKey ?? byId ?? byKeyCI ?? byLabel ?? byPartial;
  // A typed name that only matches a different widget type still resolves, so an
  // untyped legacy graph keeps working after the node gained a type filter.
  if (!hit && wantType) return findWidget(doc, key);
  return hit;
}

/** Current value of one widget variable. */
export function readWidgetValue(doc, widget, field = "value") {
  if (!widget) return undefined;
  const descriptor = (WIDGET_VARIABLES[widget.type] ?? []).find(entry => entry.field === field);
  const stored = doc ? foundry.utils.getProperty(doc, widgetVarPath(widget, field)) : undefined;
  if (stored !== undefined) return stored;
  const local = widget.varDefaults?.[field];
  if (local !== undefined) return local;
  return descriptor?.initial ?? "";
}

const num = value => { const n = Number(value); return Number.isFinite(n) ? n : 0; };
const pct = (value, max) => { const m = num(max); return m > 0 ? Math.round((num(value) / m) * 100) : 0; };
const arr = value => Array.isArray(value) ? value : (typeof value === "string" && value.trim() ? value.split(",").map(entry => entry.trim()).filter(Boolean) : []);
const itemData = item => ({
  id: item.id, uuid: item.uuid, name: item.name, img: item.img, type: item.type,
  quantity: num(item.system?.quantity ?? 1), weight: num(item.system?.weight ?? 0),
  price: num(item.system?.price ?? 0), equipped: !!item.system?.equipped,
  rarity: item.system?.rarity ?? "", description: item.system?.description ?? ""
});
const effectData = effect => ({
  id: effect.id, uuid: effect.uuid, name: effect.name ?? effect.label, img: effect.img ?? effect.icon,
  disabled: !!effect.disabled, duration: effect.duration?.seconds ?? effect.duration?.rounds ?? null,
  changes: (effect.changes ?? []).map(change => ({ key: change.key, mode: change.mode, value: change.value })),
  origin: effect.origin ?? ""
});
const docItems = (doc, types) => {
  const source = doc?.documentName === "Actor" ? doc : doc?.parent?.documentName === "Actor" ? doc.parent : null;
  const list = [...(source?.items ?? [])];
  return types ? list.filter(item => types.includes(item.type)) : list;
};
const docEffects = doc => [...(doc?.effects ?? []), ...(doc?.appliedEffects ?? [])]
  .filter((effect, index, all) => all.findIndex(entry => entry.id === effect.id) === index);

/**
 * Output pins of every widget type.
 * `get(widget, doc)` runs on the client that resolves the token.
 */
export const WIDGET_NODE_CONTRACTS = Object.freeze({
  text:      [["value", "Text", "value.string", (w, d) => String(readWidgetValue(d, w, "path") ?? "")],
              ["length", "Length", "value.number", (w, d) => String(readWidgetValue(d, w, "path") ?? "").length]],
  richtext:  [["value", "Notes", "value.string", (w, d) => String(readWidgetValue(d, w, "path") ?? "")]],
  number:    [["value", "Number", "value.number", (w, d) => num(readWidgetValue(d, w, "path"))]],
  counter:   [["value", "Count", "value.number", (w, d) => num(readWidgetValue(d, w, "path"))]],
  attribute: [["value", "Score", "value.number", (w, d) => num(readWidgetValue(d, w, "path"))],
              ["mod", "Modifier", "value.number", (w, d) => Math.floor((num(readWidgetValue(d, w, "path")) - 10) / 2)]],
  skill:     [["value", "Rank", "value.number", (w, d) => num(readWidgetValue(d, w, "path"))],
              ["total", "Rank + Modifier", "value.number", (w, d) => num(readWidgetValue(d, w, "path")) + num(w.attrMod)]],
  toggle:    [["value", "Enabled", "value.bool", (w, d) => readWidgetValue(d, w, "path") ? 1 : 0]],
  select:    [["value", "Selected", "value.string", (w, d) => String(readWidgetValue(d, w, "path") ?? "")],
              ["options", "Options", "value.array", w => arr(w.options)],
              ["index", "Index", "value.number", (w, d) => arr(w.options).indexOf(String(readWidgetValue(d, w, "path") ?? ""))]],
  tags:      [["tags", "Tags", "value.array", (w, d) => arr(readWidgetValue(d, w, "path"))],
              ["count", "Count", "value.number", (w, d) => arr(readWidgetValue(d, w, "path")).length],
              ["csv", "Text (CSV)", "value.string", (w, d) => arr(readWidgetValue(d, w, "path")).join(", ")]],
  clock:     [["value", "Filled", "value.number", (w, d) => num(readWidgetValue(d, w, "path"))],
              ["max", "Segments", "value.number", w => num(w.segments ?? w.max ?? 4)],
              ["full", "Full?", "value.bool", (w, d) => num(readWidgetValue(d, w, "path")) >= num(w.segments ?? w.max ?? 4) ? 1 : 0]],
  resource:  [["value", "Value", "value.number", (w, d) => num(readWidgetValue(d, w, "pathValue"))],
              ["max", "Max", "value.number", (w, d) => num(readWidgetValue(d, w, "pathMax"))],
              ["percent", "Percent", "value.number", (w, d) => pct(readWidgetValue(d, w, "pathValue"), readWidgetValue(d, w, "pathMax"))],
              ["empty", "Empty?", "value.bool", (w, d) => num(readWidgetValue(d, w, "pathValue")) <= 0 ? 1 : 0]],
  progress:  [["value", "Value", "value.number", (w, d) => num(readWidgetValue(d, w, "pathValue"))],
              ["max", "Max", "value.number", (w, d) => num(readWidgetValue(d, w, "pathMax"))],
              ["percent", "Percent", "value.number", (w, d) => pct(readWidgetValue(d, w, "pathValue"), readWidgetValue(d, w, "pathMax"))]],
  tracker:   [["value", "Filled", "value.number", (w, d) => num(readWidgetValue(d, w, "path"))],
              ["max", "Max", "value.number", (w, d) => num(readWidgetValue(d, w, "maxPath"))]],
  tokenPool: [["value", "Tokens", "value.number", (w, d) => num(readWidgetValue(d, w, "path"))],
              ["max", "Max", "value.number", (w, d) => num(readWidgetValue(d, w, "maxPath"))]],
  derived:   [["value", "Result", "value.any", (w, d) => readWidgetValue(d, w, "path") ?? ""]],
  image:     [["src", "Image", "value.string", w => String(w.img ?? w.src ?? "")]],
  button:    [["label", "Label", "value.string", w => String(w.label ?? "")]],
  section:   [["label", "Title", "value.string", w => String(w.label ?? "")]],
  vsection:  [["children", "Child widgets", "value.number", w => (w.widgets ?? []).length]],
  widgetBuilder: [["elements", "Elements", "value.array", w => (w.elements ?? []).map(entry => ({ id: entry.id, name: entry.name, type: entry.widget?.type ?? entry.kind }))],
              ["count", "Count", "value.number", w => (w.elements ?? []).length]],
  inventory: [["items", "Items", "value.array", (w, d) => docItems(d, ["inventory"]).map(itemData)],
              ["count", "Item count", "value.number", (w, d) => docItems(d, ["inventory"]).length],
              ["names", "Names (CSV)", "value.string", (w, d) => docItems(d, ["inventory"]).map(item => item.name).join(", ")],
              ["equipped", "Equipped", "value.array", (w, d) => docItems(d, ["inventory"]).filter(item => item.system?.equipped).map(itemData)],
              ["weight", "Total weight", "value.number", (w, d) => docItems(d, ["inventory"]).reduce((sum, item) => sum + num(item.system?.weight) * num(item.system?.quantity ?? 1), 0)],
              ["currency", "Currency", "value.number", (w, d) => num(readWidgetValue(d, w, "currencyPath"))]],
  spellbook: [["spells", "Spells", "value.array", (w, d) => docItems(d, ["ability"]).map(itemData)],
              ["count", "Count", "value.number", (w, d) => docItems(d, ["ability"]).length],
              ["prepared", "Prepared", "value.array", (w, d) => docItems(d, ["ability"]).filter(item => item.system?.prepared).map(itemData)]],
  slot:      [["items", "Slot contents", "value.array", (w, d) => (foundry.utils.getProperty(d, `system.slotContents.${w.slotId}.items`) ?? []).map(entry => ({ id: entry?._id ?? "", name: entry?.name ?? "", img: entry?.img ?? "", uuid: entry?._sourceUuid ?? entry?.uuid ?? "" }))],
              ["count", "Count", "value.number", (w, d) => (foundry.utils.getProperty(d, `system.slotContents.${w.slotId}.items`) ?? []).length],
              ["first", "First name", "value.string", (w, d) => (foundry.utils.getProperty(d, `system.slotContents.${w.slotId}.items`) ?? [])[0]?.name ?? ""]],
  effects:   [["effects", "Effects", "value.array", (w, d) => docEffects(d).map(effectData)],
              ["count", "Count", "value.number", (w, d) => docEffects(d).length],
              ["active", "Active", "value.array", (w, d) => docEffects(d).filter(effect => !effect.disabled).map(effectData)],
              ["names", "Names (CSV)", "value.string", (w, d) => docEffects(d).map(effect => effect.name ?? effect.label).join(", ")]],
  diceTray:  [["label", "Label", "value.string", w => String(w.label ?? "")]]
});

/** Node type id of the dedicated node of a widget type. */
export const widgetGetNodeType = type => `widget_get_${type}`;
export const widgetSetNodeType = type => `widget_set_${type}`;

function pinsOf(type) { return WIDGET_NODE_CONTRACTS[type] ?? [["value", "Value", "value.any", (w, d) => readWidgetValue(d, w, "path")]]; }

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

export function installWidgetTokens() {
  const RUNTIME = globalThis.SD_NODE_RUNTIME;
  if (!RUNTIME?.registerToken) return;
  RUNTIME.registerToken("sdWidget:", (rest, ctx) => {
    const doc = ctx?.doc ?? ctx?.actor ?? ctx?.item ?? null;
    const [type, pin, ...tail] = String(rest ?? "").split(":");
    const widgetKey = unarg(tail.join(":"));
    const widget = findWidget(doc, widgetKey);
    if (!widget) return "";
    const entry = pinsOf(widget.type ?? type).find(item => item[0] === pin) ?? pinsOf(widget.type ?? type)[0];
    try { return entry?.[3]?.(widget, doc) ?? ""; }
    catch (error) { console.warn("[sd] widget node read failed", error); return ""; }
  }, { owner: OWNER });
}

export function installWidgetActions() {
  const RUNTIME = globalThis.SD_NODE_RUNTIME;
  if (!RUNTIME?.registerAction) return;
  RUNTIME.registerAction("sdSetWidgetValue", async (ctx) => {
    const action = ctx.action ?? {};
    const doc = ctx.doc ?? ctx.actor ?? ctx.item ?? null;
    const widget = findWidget(doc, unarg(action.widgetKey), { widgetType: action.widgetType });
    if (!widget || !doc?.update) {
      if (!widget) console.warn(`[sd] Set Widget: no widget matched "${unarg(action.widgetKey)}"`);
      return;
    }
    const field = String(action.field || (WIDGET_VARIABLES[widget.type]?.[0]?.field ?? "path"));
    const descriptor = (WIDGET_VARIABLES[widget.type] ?? []).find(entry => entry.field === field);
    const raw = ctx.resolveValue ? await ctx.resolveValue(action.value) : action.value;
    const current = readWidgetValue(doc, widget, field);
    let next;
    switch (String(action.mode || "set")) {
      case "add":    next = num(current) + num(raw); break;
      case "sub":    next = num(current) - num(raw); break;
      case "toggle": next = !current; break;
      case "push":   next = [...arr(current), raw]; break;
      case "clear":  next = descriptor?.type === "array" ? [] : descriptor?.type === "number" ? 0 : ""; break;
      default:       next = raw;
    }
    await doc.update({ [widgetVarPath(widget, field)]: coerceWidgetValue(next, descriptor?.type ?? "text") });
  }, { owner: OWNER });
}

// ---------------------------------------------------------------------------
// Node definitions
// ---------------------------------------------------------------------------

export function registerWidgetNodes() {
  const REG = globalThis.SD?.nodeRegistry ?? globalThis.CONFIG?.SD?.nodeRegistry;
  const registerNode = REG?.registerNode ?? REG?.registerNodeDefinition;
  const registerCategory = REG?.registerCategory ?? REG?.registerNodeCategory;
  if (!registerNode) return;
  try { registerCategory?.({ id: CATEGORY, color: COLOR_GET }, { owner: OWNER }); } catch {}

  for (const [type, def] of Object.entries(WIDGET_TYPES)) {
    const pins = pinsOf(type);
    const label = def?.label ?? type;

    registerNode(widgetGetNodeType(type), {
      title: `Get ${label}`,
      color: COLOR_GET, cat: CATEGORY, wideNode: true,
      desc: `Read the ${label} widget: ${pins.map(pin => pin[1]).join(", ")}.`,
      inputs: [{ id: "widgetKey", label: "Widget (by name)", type: "value.string" }],
      outputs: pins.map(([id, pinLabel, pinType]) => ({ id, label: pinLabel, type: pinType })),
      fields: [{
        key: "widgetKey", label: "Widget", type: "widget-picker", default: "",
        widgetType: type, allowManual: true,
        hint: "Pick a widget, type a name, or drive it from the Widget pin."
      }],
      compile: (n, i) => `{sdWidget:${type}:${pins[0][0]}:${arg(i.widgetKey ?? n.data.widgetKey ?? "")}}`,
      compilePin: (n, i, pin) => {
        const valid = pins.some(entry => entry[0] === pin) ? pin : pins[0][0];
        return `{sdWidget:${type}:${valid}:${arg(i.widgetKey ?? n.data.widgetKey ?? "")}}`;
      }
    }, { owner: OWNER });

    const variables = WIDGET_VARIABLES[type] ?? [];
    if (!variables.length) continue;
    registerNode(widgetSetNodeType(type), {
      title: `Set ${label}`,
      color: COLOR_SET, cat: CATEGORY, wideNode: true,
      isAction: true,
      desc: `Write the ${label} widget's own value (${variables.map(entry => entry.label).join(", ")}).`,
      inputs: [
        { id: "exec", label: "", type: "exec" },
        { id: "widgetKey", label: "Widget (by name)", type: "value.string" },
        { id: "value", label: "Value", type: "value.any" }
      ],
      outputs: [{ id: "exec", label: "Then →", type: "exec" }],
      fields: [
        {
          key: "widgetKey", label: "Widget", type: "widget-picker", default: "",
          widgetType: type, allowManual: true,
          hint: "Pick a widget, type a name, or drive it from the Widget pin."
        },
        { key: "field", label: "Variable", type: "select", default: variables[0].field, options: variables.map(entry => ({ value: entry.field, label: entry.label })) },
        { key: "mode", label: "Mode", type: "select", default: "set", options: [
          { value: "set", label: "Set" }, { value: "add", label: "Add" }, { value: "sub", label: "Subtract" },
          { value: "toggle", label: "Toggle" }, { value: "push", label: "Append to list" }, { value: "clear", label: "Clear" }
        ] },
        { key: "value", label: "Value", type: "text", default: "" }
      ],
      toAction: (n, inp = {}) => ({
        type: "sdSetWidgetValue",
        widgetType: type,
        widgetKey: arg(inp.widgetKey ?? n.data.widgetKey ?? ""),
        field: n.data.field ?? variables[0].field,
        mode: n.data.mode ?? "set",
        value: inp.value ?? n.data.value ?? ""
      })
    }, { owner: OWNER });
  }
}

export function initWidgetNodes() {
  installWidgetTokens();
  installWidgetActions();
  if (globalThis.SD?.nodeRegistry) registerWidgetNodes();
  else Hooks.once("sdNodeRegistryReady", () => registerWidgetNodes());
}
