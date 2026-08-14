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
  "value.cards":   "#ffb877",
  "value.token_pool":    "#42d6c8",
  "value.roll_result":   "#8ab4ff",
  "value.effect":        "#c783ff",
  "value.aoe_template":  "#ff9f68",
  "value.aoe_templates": "#ffb58f",
  "value.dialog_result": "#d89bff",
  "value.object":        "#b8b8c8"
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

const _INTERCHANGEABLE = Object.freeze([
  ["value.uuid", "value.string"],
  ["value.token_pool", "value.array"],
  ["value.aoe_templates", "value.array"],
  ["value.roll_result", "value.object"],
  ["value.effect", "value.object"],
  ["value.aoe_template", "value.object"],
  ["value.dialog_result", "value.object"]
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
