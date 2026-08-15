import { FormulaEngine } from "./formula-engine.mjs";

/** Recursively collect every widget which can expose a Widget Key. */
export function collectDocumentWidgets(doc, tabsOverride = null) {
  const tabs = Array.isArray(tabsOverride) ? tabsOverride : (doc?.system?.customTabs ?? []);
  const out = [];
  const walk = (widgets) => {
    if (!Array.isArray(widgets)) return;
    for (const w of widgets) {
      if (!w || typeof w !== "object") continue;
      out.push(w);
      walk(w.widgets);
      walk((w.elements ?? []).map(el => el?.widget).filter(Boolean));
    }
  };
  for (const tab of tabs) for (const row of (tab?.rows ?? [])) walk(row?.widgets);
  return out;
}

function _hasOwn(obj, key) {
  return Boolean(obj && Object.prototype.hasOwnProperty.call(obj, key));
}

function _pendingValue(doc, changed, path) {
  if (!path) return undefined;
  if (_hasOwn(changed, path)) return changed[path];
  try {
    const nested = foundry.utils.getProperty(changed, path);
    if (nested !== undefined) return nested;
  } catch {}
  try { return foundry.utils.getProperty(doc, path); }
  catch { return undefined; }
}

function _hasPendingValue(changed, path) {
  if (!path) return false;
  if (_hasOwn(changed, path)) return true;
  try { return foundry.utils.getProperty(changed, path) !== undefined; }
  catch { return false; }
}

function _pendingTabs(doc, changed) {
  if (_hasOwn(changed, "system.customTabs")) return changed["system.customTabs"];
  try {
    const nested = foundry.utils.getProperty(changed, "system.customTabs");
    if (nested !== undefined) return nested;
  } catch {}
  return doc?.system?.customTabs ?? [];
}

function _primaryPath(w) {
  const type = String(w?.type ?? "");
  if (type === "resource" || type === "progress") return w.pathValue ?? w.path ?? "";
  return w?.path ?? w?.pathValue ?? "";
}

function _cleanStoredValue(value) {
  if (value === undefined) return null;
  if (typeof value === "number" && !Number.isFinite(value)) return 0;
  if (typeof value === "function") return null;
  return value;
}

function _widgetValuePath(key) {
  return key ? `system.widgetFields.${key}.value` : "";
}

function _selectOptions(w) {
  return String(w?.choices ?? "").split(",").map(v => v.trim()).filter(Boolean);
}

function _readSelectValue(w, doc, changed, key) {
  const options = _selectOptions(w);
  const canonicalPath = _widgetValuePath(key);
  const boundPath = _primaryPath(w);

  // A direct widget-value update is always authoritative.
  if (_hasPendingValue(changed, canonicalPath)) {
    const value = _pendingValue(doc, changed, canonicalPath);
    if (!options.length || options.includes(String(value))) return value;
  }

  // A valid external update to Data Path still participates in two-way binding.
  if (_hasPendingValue(changed, boundPath)) {
    const value = _pendingValue(doc, changed, boundPath);
    if (!options.length || options.includes(String(value))) return value;
  }

  // Widget state is independent from Data Path and survives an incompatible or
  // rejected bound-field update (for example a text Select bound to a number).
  const stored = canonicalPath ? _pendingValue(doc, {}, canonicalPath) : undefined;
  if (stored !== undefined && stored !== null && (!options.length || options.includes(String(stored)))) return stored;

  // Adopt a compatible legacy bound value, otherwise the visible first option
  // is also the real value returned by Get Widget Value.
  if (boundPath && boundPath !== canonicalPath) {
    const bound = _pendingValue(doc, {}, boundPath);
    if (bound !== undefined && bound !== null && (!options.length || options.includes(String(bound)))) return bound;
  }
  return options[0] ?? "";
}

function _readWidgetValue(w, doc, changed, key) {
  if (String(w?.type ?? "") === "select") return _readSelectValue(w, doc, changed, key);
  const path = _primaryPath(w);
  if (path) {
    const pending = _pendingValue(doc, changed, path);
    if (pending !== undefined) return pending;
  }
  try { return FormulaEngine._readWidgetValue(w, doc); }
  catch { return w?.staticValue ?? null; }
}

/**
 * Build the real system.widgetFields mirror used by Get Field Value and UUID reads.
 * Live widget definitions remain the source of truth; this object is a persistent,
 * inspectable cache that is refreshed on every Actor/Item update.
 */
export function buildWidgetFieldsSnapshot(doc, changed = {}) {
  const tabs = _pendingTabs(doc, changed);
  if (!Array.isArray(tabs)) return {};
  const fields = {};

  for (const w of collectDocumentWidgets(doc, tabs)) {
    const key = String(w?.widgetKey ?? "").trim();
    if (!key) continue;

    const path = _primaryPath(w);
    const entry = {
      value: _cleanStoredValue(_readWidgetValue(w, doc, changed, key)),
      label: String(w.label ?? ""),
      type: String(w.type ?? ""),
      path: String(path ?? "")
    };

    if (w.pathMax || w.maxPath) {
      entry.max = _cleanStoredValue(_pendingValue(doc, changed, w.pathMax ?? w.maxPath));
    }

    if (String(w.type ?? "") === "widgetBuilder" && w.wbOutputs && typeof w.wbOutputs === "object") {
      for (const [outputKey, formula] of Object.entries(w.wbOutputs)) {
        const outKey = String(outputKey ?? "").trim();
        if (!outKey) continue;
        let value = formula;
        try { value = FormulaEngine.evaluate(String(formula ?? ""), doc); } catch {}
        entry[outKey] = { value: _cleanStoredValue(value) };
      }
    }

    fields[key] = entry;
  }
  return fields;
}

/** Add a fresh widgetFields snapshot to an in-flight Document update. */
export function injectWidgetFieldsSnapshot(doc, changed) {
  if (!doc?.system || !changed || typeof changed !== "object") return changed;
  const hasTabs = Array.isArray(doc.system.customTabs)
    || _hasOwn(changed, "system.customTabs")
    || foundry.utils.getProperty(changed, "system.customTabs") !== undefined;
  if (!hasTabs) return changed;
  foundry.utils.setProperty(changed, "system.widgetFields", buildWidgetFieldsSnapshot(doc, changed));
  return changed;
}

/** Make the path immediately readable after prepareData, even before a save. */
export function refreshWidgetFieldsRuntime(doc) {
  if (!doc?.system || !Array.isArray(doc.system.customTabs)) return;
  const snapshot = buildWidgetFieldsSnapshot(doc, {});
  const target = doc.system.widgetFields;
  if (target && typeof target === "object" && !Array.isArray(target)) {
    for (const key of Object.keys(target)) delete target[key];
    Object.assign(target, snapshot);
  } else {
    try { doc.system.widgetFields = snapshot; } catch {}
  }
}

/**
 * Persist the widget's own state first, then best-effort mirror it to Data Path.
 * A schema mismatch on Data Path must never make Get Widget Value lose the UI
 * selection.
 */
export async function persistWidgetValue(doc, widget, value) {
  if (!doc || !widget) return;
  const key = String(widget.widgetKey ?? "").trim();
  const canonicalPath = _widgetValuePath(key);
  const boundPath = _primaryPath(widget);

  if (canonicalPath) await doc.update({ [canonicalPath]: value });

  if (boundPath && boundPath !== canonicalPath) {
    try { await doc.update({ [boundPath]: value }); }
    catch (error) {
      console.warn(`SD | Widget ${key || widget.id || "?"}: Data Path rejected value; widget value was still saved.`, error);
    }
  } else if (!canonicalPath && boundPath) {
    await doc.update({ [boundPath]: value });
  }
}
