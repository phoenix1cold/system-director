import { getValueDefinition, variableIdForLegacyPath } from "./value-database.mjs";
import { resolveProgressionValue } from "./progression-values.mjs";

export function progressionFieldType(change, current) {
  const ref = change?.variableId || change?.path || "";
  const definition = getValueDefinition(ref) || getValueDefinition(variableIdForLegacyPath(ref));
  return definition?.type ?? (typeof current === "string" ? "text" : "number");
}

export function progressionFieldValue(change, current, actor, pending = {}) {
  const type = progressionFieldType(change, current);
  const mode = change?.mode || "add";
  if (type === "text") {
    if (mode !== "set") throw new Error("Text progression variables support Set (=) only.");
    return String(change?.value ?? "");
  }
  if (!["number", "integer"].includes(type)) throw new Error(`Unsupported progression variable type: ${type}`);
  const safe = resolveProgressionValue(actor, change?.value, pending);
  const from = Number(current ?? 0);
  switch (mode) {
    case "set": return safe;
    case "multiply": return from * safe;
    default: return from + safe;
  }
}

// Keep invalid saved modes visible until explicitly repaired with Set.
export function bindProgressionFieldMode(variable, mode) {
  if (!variable || !mode || variable._sdProgressionMode === mode) return;
  variable._sdProgressionMode = mode;
  const refresh = () => {
    const text = progressionFieldType({ variableId: variable.value }) === "text";
    for (const option of mode.options) option.disabled = text && option.value !== "set";
    mode.title = text ? "Text variables support Set (=) only." : "";
  };
  variable.addEventListener("change", refresh);
  refresh();
}
