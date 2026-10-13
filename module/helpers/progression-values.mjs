import { FormulaEngine } from "./formula-engine.mjs";
import { getValueDefinitions, getValueDefinition, readDatabaseValue } from "./value-database.mjs";

export function resolveProgressionValue(actor, value, pending = {}) {
  const system = foundry.utils.deepClone(actor?.system ?? {});
  const view = { system, name: actor?.name, documentName: actor?.documentName, actor: actor?.actor };
  for (const [path, val] of Object.entries(pending)) {
    const keys = path.split("."); let current = view;
    for (const key of keys.slice(0,-1)) current = current[key] ??= {};
    current[keys.at(-1)] = val;
  }
  const raw = String(value ?? "0").trim();
  const result = getValueDefinition(raw) ? readDatabaseValue(view, raw) : FormulaEngine.evaluate(raw, view);
  const number = Number(result);
  if (!Number.isFinite(number)) throw new Error(`Invalid progression value: ${raw}`);
  return number;
}

/** Add a picker alongside existing value inputs; keep storage as a formula string. */
export function bindProgressionValuePickers(root) {
  const selector = ".sd-prog-fc-value,.nc-value,.cls-fc-val,.cls-choice-fc-val";
  for (const input of root?.querySelectorAll?.(selector) ?? []) {
    if (input.dataset.sdDbPicker) continue;
    input.dataset.sdDbPicker = "1";
    input.title = "Number or formula, e.g. {system.values.strength} * 2";
    const select = document.createElement("select");
    select.className = "sd-progression-value-picker";
    select.title = "Use Database variable as value";
    select.setAttribute("aria-label", "Use Database variable as value");
    const empty = document.createElement("option"); empty.value = ""; empty.textContent = "Database…"; select.append(empty);
    for (const def of getValueDefinitions("actor").filter(d => ["number","integer"].includes(d.type))) {
      const option = document.createElement("option"); option.value = def.id; option.textContent = def.name ?? def.id; select.append(option);
    }
    select.addEventListener("change", () => {
      if (!select.value) return;
      input.value = `{system.values.${select.value}}`;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const wrapper = document.createElement("span");
    wrapper.className = "sd-progression-value-editor";
    const row = input.closest(".sd-prog-fc-row,.sd-field-change-row");
    if (row) {
      row.classList.add("sd-progression-value-row");
      row.querySelector(":is(.sd-prog-fc-variable,.nc-variable,.cls-fc-variable,.cls-choice-fc-variable)")?.classList.add("sd-progression-change-variable");
      row.querySelector(":is(.sd-prog-fc-mode,.nc-mode,.cls-fc-mode,.cls-choice-fc-mode)")?.classList.add("sd-progression-change-mode");
      row.querySelector(":is(.sd-prog-fc-del,.nc-del-fc,.cls-del-fc,.cls-del-choice-opt)")?.classList.add("sd-progression-change-delete");
    }
    input.replaceWith(wrapper); wrapper.append(input, select);
    // Old value inputs may have inline 36/54/56px widths. Layout belongs to
    // the new wrapper now; do not inherit their flex basis as a column height.
    input.style.removeProperty("width");
    const reflectValue = () => {
      const match = input.value.trim().match(/^\{system\.values\.([^{}]+)\}$/);
      const id = match?.[1] ?? (getValueDefinition(input.value.trim())?.id || "");
      select.value = [...select.options].some(option => option.value === id) ? id : "";
    };
    input.addEventListener("input", reflectValue);
    input.addEventListener("change", reflectValue);
    reflectValue();
  }
}
