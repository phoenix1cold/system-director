import { FormulaEngine } from "./formula-engine.mjs";
import { getValueDefinitions, getValueDefinition, readDatabaseValue } from "./value-database.mjs";

/** Shared sources for widget and 3D point visibility editors. */
export function showIfSources(doc, excludeKey = "") {
  const sources = new Map();
  const visit = value => {
    if (!value || typeof value !== "object") return;
    if (value.widgetKey && value.widgetKey !== excludeKey) sources.set(`widget:${value.widgetKey}`, {value:`widget:${value.widgetKey}`, label:`Widget: ${value.label || value.widgetKey} [${value.widgetKey}]`});
    for (const child of Object.values(value)) if (child && typeof child === "object") visit(child);
  };
  visit(doc?.system?.customTabs ?? []);
  for (const variable of getValueDefinitions()) sources.set(variable.id, {value:variable.id, label:`Database: ${variable.name} · ${variable.type} [${variable.id}]`});
  return [...sources.values()];
}

export function showIfSelectionVisible(condition, doc) {
  const key = String(condition.showIfKey ?? "").trim();
  if (!key) return true;
  let actual;
  try {
    if (key.startsWith("widget:")) actual = FormulaEngine.evaluate(`{${key}}`, doc);
    else if (key.startsWith("hidden:")) actual = doc?.system?.hiddenFields?.[key.slice(7)];
    else if (getValueDefinition(key)) actual = readDatabaseValue(doc, key);
    else actual = globalThis.foundry?.utils?.getProperty(doc, key);
  } catch { return false; }
  const value = String(actual ?? "");
  const expected = String(condition.showIfValue ?? "").trim();
  return expected === "" ? !!value && value !== "0" && value !== "false"
    : value === expected || (value.trim() !== "" && String(Number(value)) === expected);
}
