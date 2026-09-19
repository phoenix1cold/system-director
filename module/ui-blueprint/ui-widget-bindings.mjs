/** Typed property bindings and collection helpers for UI Blueprint v4. */

export const BINDING_KINDS = ["variable", "widget", "formula", "context", "row", "literal"];
export const BINDING_TRANSFORMS = ["none", "text", "number", "boolean", "round", "percent"];

const pathValue = (object, path) => {
  const raw = String(path ?? "").trim().replace(/^\$?\.?/, "");
  if (!raw) return object;
  return raw.split(".").reduce((value, key) => value == null ? undefined : value[key], object);
};

export function isTruthy(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) && value !== 0;
  return !["", "0", "false", "no", "off", "null", "undefined"].includes(String(value ?? "").trim().toLowerCase());
}

export function normalizeBinding(raw) {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw === "string") return { kind: "formula", formula: raw, transform: "none" };
  if (typeof raw !== "object") return { kind: "literal", value: raw, transform: "none" };
  const kind = BINDING_KINDS.includes(String(raw.kind)) ? String(raw.kind) : "formula";
  return {
    ...raw,
    kind,
    transform: BINDING_TRANSFORMS.includes(String(raw.transform)) ? String(raw.transform) : "none",
    fallback: raw.fallback ?? "",
    prefix: String(raw.prefix ?? ""),
    suffix: String(raw.suffix ?? "")
  };
}

export function applyBindingTransform(value, binding = {}) {
  const transform = String(binding?.transform ?? "none");
  let result = value;
  if ((result === undefined || result === null || result === "") && binding?.fallback !== undefined && binding.fallback !== "") result = binding.fallback;
  if (transform === "text") result = result == null ? "" : (typeof result === "object" ? JSON.stringify(result) : String(result));
  else if (transform === "number") { const n = Number(result); result = Number.isFinite(n) ? n : 0; }
  else if (transform === "boolean") result = isTruthy(result);
  else if (transform === "round") { const n = Number(result); result = Number.isFinite(n) ? Math.round(n) : 0; }
  else if (transform === "percent") { const n = Number(result); result = Number.isFinite(n) ? Math.round(n * 100) : 0; }
  if (typeof result !== "object" && (binding?.prefix || binding?.suffix)) result = `${binding?.prefix ?? ""}${result ?? ""}${binding?.suffix ?? ""}`;
  return result;
}

/** Resolve a binding without exposing arbitrary document writes. */
export function resolveBindingValue(raw, env = {}, depth = 0) {
  if (depth > 8) return undefined;
  const binding = normalizeBinding(raw);
  if (!binding) return undefined;
  let value;
  switch (binding.kind) {
    case "variable": value = env.state?.getVariable?.(binding.variableId); break;
    case "widget": value = env.state?.getWidgetProperty?.(binding.widgetId, binding.property ?? "value"); break;
    case "context": value = pathValue(env.context ?? {}, binding.path); break;
    case "row": value = pathValue(env.local?.row ?? env.local?.item, binding.path); break;
    case "literal": value = binding.value; break;
    case "formula":
    default: value = env.evaluate?.(binding.formula ?? binding.value ?? "", env.local ?? {}); break;
  }
  return applyBindingTransform(value, binding);
}

export function parseCollection(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    if (Array.isArray(raw.contents)) return raw.contents;
    return Object.values(raw);
  }
  const text = String(raw ?? "").trim();
  if (!text) return [];
  if (text.startsWith("[") || text.startsWith("{")) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed;
      if (parsed && typeof parsed === "object") return Object.values(parsed);
    } catch { /* fall through */ }
  }
  return text.split(/[,\n]/).map(value => value.trim()).filter(Boolean);
}

export function filterAndSortCollection(rows, { filter = "", sortKey = "", descending = false, limit = 0 } = {}) {
  let result = [...parseCollection(rows)];
  const query = String(filter ?? "").trim().toLowerCase();
  if (query) result = result.filter(row => {
    if (row && typeof row === "object") return Object.values(row).some(value => String(value ?? "").toLowerCase().includes(query));
    return String(row ?? "").toLowerCase().includes(query);
  });
  const key = String(sortKey ?? "").trim();
  if (key) result.sort((a, b) => String(pathValue(a, key) ?? "").localeCompare(String(pathValue(b, key) ?? ""), undefined, { numeric: true }));
  if (descending) result.reverse();
  const max = Math.max(0, Math.floor(Number(limit) || 0));
  return max ? result.slice(0, max) : result;
}

export { pathValue as bindingPathValue };
