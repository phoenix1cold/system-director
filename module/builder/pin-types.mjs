/** Map subtype → colour used when rendering the wire. */
export const PIN_SUBTYPE_COLORS = Object.freeze({
  "exec":          "#ffca6b",
  "value.any":     null,
  "value.number":  "#74c0ff", // blue
  "value.string":  "#e06bff", // magenta
  "value.bool":    "#ff7b7b", // red
  "value.path":    "#c8a268", // tan
  "value.uuid":    "#a76bff", // purple
  "value.actor":   "#5dd6a8", // green
  "value.item":    "#ffd94a", // yellow
  "value.token":   "#3ec8e0", // cyan
  "value.array":   "#d0d0d0"  // grey
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

export function arePinsCompatible(outType, inType) {
  const a = pinSubtype(outType);
  const b = pinSubtype(inType);
  if (a === "exec" || b === "exec") return a === b;
  if (a === "value.any" || b === "value.any") return true;
  return a === b;
}
