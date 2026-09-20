import { FormulaEngine } from "../helpers/formula-engine.mjs";

/** Same formula language as sheet Show If; blank means visible. */
export function modelPointVisible(point, doc) {
  const expression = String(point?.showIf ?? "").trim();
  if (!expression) return true;
  try {
    const value = FormulaEngine.evaluate(expression, doc ?? {});
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      return !["", "0", "false", "null", "undefined"].includes(normalized) && !normalized.startsWith("!err:");
    }
    return !!value;
  } catch { return false; }
}
