export const PIN_SUBTYPE_COLORS = Object.freeze({
  "exec":          "#ffca6b",
  "value.any":     null,
  "value.number":  "#74c0ff",
  "value.string":  "#e06bff",
  "value.bool":    "#ff7b7b",
  "value.path":    "#c8a268",
  "value.uuid":    "#a76bff",
  "value.actor":   "#5dd6a8",
  "value.item":    "#ffd94a",
  "value.token":   "#3ec8e0",
  "value.array":   "#d0d0d0",
  "value.card":    "#ff9b3a",
  "value.cards":   "#ffb877"
});

export function pinSubtype(t) {
  if (!t) return "value.any";
  if (t === "exec") return "exec";
  if (t === "value") return "value.any";
  if (t.startsWith("value.")) return t;
  return "value.any";
}

export function subtypeColor(t) {
  return PIN_SUBTYPE_COLORS[pinSubtype(t)] ?? null;
}

// Subtypes that are interchangeable at the graph-edge level. A UUID is a
// plain string at runtime, so any node that needs a string can consume a
// `value.uuid` and vice-versa (e.g. Slot Item UUID → Modify Item Field).
// Listed as ordered pairs `[a, b]`; the relation is treated as symmetric.
const _INTERCHANGEABLE = Object.freeze([
  ["value.uuid", "value.string"]
]);

export function arePinsCompatible(outType, inType) {
  const a = pinSubtype(outType);
  const b = pinSubtype(inType);
  if (a === "exec" || b === "exec") return a === b;
  if (a === "value.any" || b === "value.any") return true;
  if (a === b) return true;
  for (const [x, y] of _INTERCHANGEABLE) {
    if ((a === x && b === y) || (a === y && b === x)) return true;
  }
  return false;
}
