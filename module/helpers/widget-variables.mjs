/**
 * Widget-owned variables.
 *
 * Every widget is a small set of typed variables that live inside the widget
 * itself (`system.widgetVars.<widgetKey>.<field>`).  Widgets are never bound to
 * a Database variable any more: their value is edited by hand (like a text
 * field) or driven by nodes.
 */

import {
  getValueDefinition, valueStoragePath, variableIdForLegacyPath,
  readDatabaseValue, coerceDatabaseValue
} from "./value-database.mjs";

const ROOT = "widgetVars";

/** Storage root for one widget, e.g. `system.widgetVars.hp_bar`. */
export function widgetVarRoot(widget) {
  return `system.${ROOT}.${widgetVarKey(widget)}`;
}

/** Stable per-widget key. Widget Key wins so renaming a label keeps the data. */
export function widgetVarKey(widget) {
  const key = String(widget?.widgetKey ?? "").trim();
  if (key) return key.replace(/[^\p{L}\p{N}_-]/gu, "_");
  return String(widget?.id ?? "widget").replace(/[^\p{L}\p{N}_-]/gu, "_");
}

/** Full document path of one widget variable. */
export function widgetVarPath(widget, field = "value") {
  return `${widgetVarRoot(widget)}.${String(field || "value")}`;
}

/** True when a stored binding already points at the widget's own storage. */
export function isWidgetVarPath(path) {
  return /^system\.widgetVars\./.test(String(path ?? ""));
}

/** The two placement modes a value widget can be dropped in. */
export const WIDGET_DATA_MODES = Object.freeze(["own", "variable"]);

/** Placement mode of one widget: "variable" (Database) or "own" (self storage). */
export function widgetDataMode(widget) {
  return String(widget?.dataMode ?? "own") === "variable" ? "variable" : "own";
}

/** Database variable id chosen for one binding field, if any. */
export function widgetVarBinding(widget, field = "value") {
  const resolve = raw => {
    const value = String(raw ?? "").trim();
    if (!value || isWidgetVarPath(value)) return "";
    return getValueDefinition(value)?.id || variableIdForLegacyPath(value) || "";
  };
  return resolve(widget?.varBindings?.[field]) || resolve(widget?.[field]);
}

/**
 * Where one binding field reads and writes.  Variable mode points at the shared
 * Database variable, own mode at the widget's private storage.
 */
export function widgetBindingTarget(widget, field = "value") {
  if (widgetDataMode(widget) === "variable") {
    const variableId = widgetVarBinding(widget, field);
    if (variableId) return { mode: "variable", variableId, path: valueStoragePath(variableId) };
  }
  return { mode: "own", variableId: "", path: widgetVarPath(widget, field) };
}

/** Document path one binding field reads and writes. */
export function widgetBindingPath(widget, field = "value") {
  return widgetBindingTarget(widget, field).path;
}

/**
 * Typed variables owned by each widget type.
 * `field` is the widget property that stores the binding path.
 */
export const WIDGET_VARIABLES = Object.freeze({
  text:      [{ field: "path",      label: "Text",     type: "text",    initial: "" }],
  number:    [{ field: "path",      label: "Number",   type: "number",  initial: 0 }],
  counter:   [{ field: "path",      label: "Count",    type: "number",  initial: 0 }],
  attribute: [{ field: "path",      label: "Score",    type: "number",  initial: 10 }],
  skill:     [{ field: "path",      label: "Rank",     type: "number",  initial: 0 }],
  toggle:    [{ field: "path",      label: "Enabled",  type: "boolean", initial: false }],
  select:    [{ field: "path",      label: "Selected", type: "text",    initial: "" }],
  richtext:  [{ field: "path",      label: "Notes",    type: "text",    initial: "" }],
  tags:      [{ field: "path",      label: "Tags",     type: "array",   initial: [] }],
  clock:     [{ field: "path",      label: "Filled",   type: "number",  initial: 0 }],
  resource:  [{ field: "pathValue", label: "Value",    type: "number",  initial: 10 },
              { field: "pathMax",   label: "Max",      type: "number",  initial: 10 }],
  progress:  [{ field: "pathValue", label: "Value",    type: "number",  initial: 0 },
              { field: "pathMax",   label: "Max",      type: "number",  initial: 100 }],
  tracker:   [{ field: "path",      label: "Filled",   type: "number",  initial: 0 },
              { field: "maxPath",   label: "Max",      type: "number",  initial: 5 }],
  tokenPool: [{ field: "path",      label: "Filled",   type: "number",  initial: 0 },
              { field: "maxPath",   label: "Max",      type: "number",  initial: 5 }],
  inventory: [{ field: "currencyPath", label: "Currency", type: "number", initial: 0 }],
  derived:   [],
  effects:   [],
  slot:      [],
  spellbook: [],
  button:    [],
  section:   [],
  vsection:  [],
  image:     [],
  diceTray:  [],
  widgetBuilder: []
});

/** Variable descriptors of one widget instance. */
export function widgetVariables(widget) {
  const list = WIDGET_VARIABLES[String(widget?.type ?? "")] ?? [];
  return list.map(entry => {
    const target = widgetBindingTarget(widget, entry.field);
    return {
      ...entry,
      key: entry.field,
      path: target.path,
      mode: target.mode,
      variableId: target.variableId,
      name: `${String(widget?.label ?? widget?.type ?? "Widget")} · ${entry.label}`
    };
  });
}

/** Coerce a raw input into the declared variable type. */
export function coerceWidgetValue(value, type = "text") {
  if (type === "number") return Number(value) || 0;
  if (type === "integer") return Math.trunc(Number(value) || 0);
  if (type === "boolean") return value === true || value === 1 || ["true", "1", "yes", "on"].includes(String(value ?? "").toLowerCase());
  if (type === "array") {
    if (Array.isArray(value)) return value;
    try { const parsed = JSON.parse(String(value ?? "[]")); return Array.isArray(parsed) ? parsed : []; }
    catch { return String(value ?? "").split(",").map(entry => entry.trim()).filter(Boolean); }
  }
  if (type === "object") {
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
    try { const parsed = JSON.parse(String(value ?? "{}")); return parsed && typeof parsed === "object" ? parsed : {}; }
    catch { return {}; }
  }
  return String(value ?? "");
}

/**
 * Point every binding field of a widget at the widget's own storage and keep a
 * local default in `widget.varDefaults`.  Legacy Database bindings are turned
 * into a plain starting value so existing sheets keep the number they show.
 */
export function ensureWidgetVariables(widget, doc = null) {
  if (!widget || typeof widget !== "object") return widget;
  const descriptors = WIDGET_VARIABLES[String(widget.type ?? "")] ?? [];
  widget.varDefaults = (widget.varDefaults && typeof widget.varDefaults === "object") ? widget.varDefaults : {};
  widget.varBindings = (widget.varBindings && typeof widget.varBindings === "object") ? widget.varBindings : {};
  if (descriptors.length) widget.dataMode = widgetDataMode(widget);
  for (const descriptor of descriptors) {
    const previous = widget[descriptor.field];
    const selfPath = widgetVarPath(widget, descriptor.field);
    if (widgetDataMode(widget) === "own" && typeof previous === "string" && previous && !isWidgetVarPath(previous) && doc) {
      // Carry the currently displayed value over as the widget's own value.
      try {
        const legacy = foundry.utils.getProperty(doc, previous);
        if (legacy !== undefined && widget.varDefaults[descriptor.field] === undefined) {
          widget.varDefaults[descriptor.field] = coerceWidgetValue(legacy, descriptor.type);
        }
      } catch {}
    }
    if (widget.varDefaults[descriptor.field] === undefined) {
      widget.varDefaults[descriptor.field] = coerceWidgetValue(descriptor.initial, descriptor.type);
    }
    // Variable mode keeps the chosen Database variable, own mode keeps self storage.
    const boundVariable = widgetDataMode(widget) === "variable" ? widgetVarBinding(widget, descriptor.field) : "";
    if (boundVariable) {
      widget.varBindings[descriptor.field] = boundVariable;
      widget[descriptor.field] = boundVariable;
    } else {
      widget[descriptor.field] = selfPath;
    }
  }
  for (const child of (widget.widgets ?? [])) ensureWidgetVariables(child, doc);
  for (const element of (widget.elements ?? [])) if (element?.widget) ensureWidgetVariables(element.widget, doc);
  return widget;
}

/** Read one widget variable, falling back to the widget's own default. */
export function readWidgetVar(doc, widget, field = "value") {
  const descriptor = (WIDGET_VARIABLES[String(widget?.type ?? "")] ?? []).find(entry => entry.field === field)
    ?? { field, type: "text", initial: "" };
  const target = widgetBindingTarget(widget, field);
  let stored;
  if (target.mode === "variable") {
    try { stored = readDatabaseValue(doc, target.variableId); } catch {}
  } else {
    try { stored = foundry.utils.getProperty(doc, target.path); } catch {}
  }
  if (stored !== undefined && stored !== null) return stored;
  const fallback = widget?.varDefaults?.[field];
  return coerceWidgetValue(fallback !== undefined ? fallback : descriptor.initial, descriptor.type);
}

/** Write one widget variable on the document. */
export async function writeWidgetVar(doc, widget, field, value) {
  if (!doc?.update || !widget) return false;
  const descriptor = (WIDGET_VARIABLES[String(widget?.type ?? "")] ?? []).find(entry => entry.field === field);
  const target = widgetBindingTarget(widget, field);
  if (target.mode === "variable") {
    const definition = getValueDefinition(target.variableId) ?? { id: target.variableId, type: descriptor?.type ?? "text" };
    await doc.update({ [target.path]: coerceDatabaseValue(value, definition) });
    return true;
  }
  await doc.update({ [target.path]: coerceWidgetValue(value, descriptor?.type ?? "text") });
  return true;
}

/** Seed missing widget variables so a fresh sheet shows the configured defaults. */
export function buildWidgetVarSeed(doc, tabs = null) {
  const patch = {};
  const walk = list => {
    for (const widget of (list ?? [])) {
      if (!widget || typeof widget !== "object") continue;
      for (const descriptor of widgetVariables(widget)) {
        if (descriptor.mode === "variable") continue;
        let current;
        try { current = foundry.utils.getProperty(doc, descriptor.path); } catch {}
        if (current === undefined) {
          patch[descriptor.path] = coerceWidgetValue(
            widget.varDefaults?.[descriptor.field] ?? descriptor.initial, descriptor.type);
        }
      }
      walk(widget.widgets);
      walk((widget.elements ?? []).map(entry => entry?.widget).filter(Boolean));
    }
  };
  for (const tab of (tabs ?? doc?.system?.customTabs ?? [])) for (const row of (tab?.rows ?? [])) walk(row?.widgets);
  return patch;
}

/** Every widget variable of a document, for pickers and node panels. */
export function collectWidgetVariables(doc, tabs = null) {
  const out = [];
  const walk = list => {
    for (const widget of (list ?? [])) {
      if (!widget || typeof widget !== "object") continue;
      for (const descriptor of widgetVariables(widget)) {
        out.push({
          ...descriptor,
          widgetId: String(widget.id ?? ""),
          widgetKey: String(widget.widgetKey ?? ""),
          widgetType: String(widget.type ?? ""),
          widgetLabel: String(widget.label ?? widget.type ?? "Widget")
        });
      }
      walk(widget.widgets);
      walk((widget.elements ?? []).map(entry => entry?.widget).filter(Boolean));
    }
  };
  for (const tab of (tabs ?? doc?.system?.customTabs ?? [])) for (const row of (tab?.rows ?? [])) walk(row?.widgets);
  return out;
}
