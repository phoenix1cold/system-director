export const PIN_TYPE_META = Object.freeze({
  "exec":                { color:"#F5C451", glyph:"▶", label:"Execution",       short:"Exec",   shape:"exec" },
  "value.any":           { color:"#8B93A7", glyph:"?", label:"Any value",       short:"Any",    shape:"circle" },
  "value.number":        { color:"#42A5F5", glyph:"#", label:"Number",          short:"Num",    shape:"circle" },
  "value.string":        { color:"#E052D1", glyph:"T", label:"Text",            short:"Text",   shape:"circle" },
  "value.bool":          { color:"#EF5350", glyph:"✓", label:"Boolean",         short:"Bool",   shape:"diamond" },
  "value.path":          { color:"#C49A6C", glyph:"/", label:"Data path",       short:"Path",   shape:"diamond" },
  "value.uuid":          { color:"#7E57C2", glyph:"◇", label:"UUID reference",  short:"UUID",   shape:"diamond", reference:true },
  "value.actor":         { color:"#35C98A", glyph:"A", label:"Actor",           short:"Actor",  shape:"capsule", reference:true },
  "value.item":          { color:"#F2B84B", glyph:"I", label:"Item",            short:"Item",   shape:"square", reference:true },
  "value.token":         { color:"#26C6DA", glyph:"●", label:"Token",           short:"Token",  shape:"diamond", reference:true },
  "value.array":         { color:"#7C8CFF", glyph:"[]",label:"Array",           short:"Array",  shape:"array", container:true },
  "value.card":          { color:"#F57C3D", glyph:"C", label:"Card",            short:"Card",   shape:"square", reference:true },
  "value.cards":         { color:"#FFAB5A", glyph:"≡", label:"Card array",      short:"Cards",  shape:"array", container:true },
  "value.token_pool":    { color:"#00BFA5", glyph:"••",label:"Token Pool",      short:"Pool",   shape:"array", container:true },
  "value.roll_result":   { color:"#3D7DFF", glyph:"⚄", label:"Roll Result",     short:"Roll",   shape:"hex", structured:true },
  "value.effect":        { color:"#B05CFF", glyph:"✦", label:"Effect",          short:"Effect", shape:"diamond", structured:true },
  "value.aoe_template":  { color:"#FF7043", glyph:"◎", label:"AOE Region",      short:"AOE",    shape:"target", structured:true },
  "value.aoe_templates": { color:"#FF8A65", glyph:"◉", label:"AOE Region array",short:"AOEs",   shape:"array", container:true, structured:true },
  "value.dialog_result": { color:"#D65DB1", glyph:"▣", label:"Dialog Result",   short:"Dialog", shape:"square", structured:true },
  "value.object":        { color:"#9AA4B8", glyph:"{}",label:"Object",          short:"Object", shape:"hex", structured:true }
});

export const PIN_SUBTYPE_COLORS = Object.freeze(Object.fromEntries(
  Object.entries(PIN_TYPE_META).map(([type, meta]) => [type, meta.color])
));

export function pinSubtype(t) {
  if (!t) return "value.any";
  if (t === "exec") return "exec";
  if (t === "value") return "value.any";
  if (t.startsWith("value.")) return t;
  return "value.any";
}

export function pinTypeMeta(t) {
  const subtype = pinSubtype(t);
  return PIN_TYPE_META[subtype] ?? PIN_TYPE_META["value.any"];
}

export function subtypeColor(t) {
  return pinTypeMeta(t).color;
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
