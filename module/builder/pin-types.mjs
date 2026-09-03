export const PIN_TYPE_META = Object.freeze({
  "exec":                { color:"#F5C451", glyph:"▶", label:"Execution",       short:"Exec",   shape:"exec" },
  "value.any":           { color:"#8B93A7", glyph:"?", label:"Any value",       short:"Any",    shape:"circle" },
  "value.number":        { color:"#42A5F5", glyph:"#", label:"Number",          short:"Num",    shape:"circle" },
  "value.integer":       { color:"#42A5F5", glyph:"Z", label:"Integer",         short:"Int",    shape:"circle" },
  "value.string":        { color:"#E052D1", glyph:"T", label:"Text",            short:"Text",   shape:"circle" },
  "value.formula":       { color:"#F59E0B", glyph:"ƒ", label:"Formula",         short:"Formula",shape:"hex" },
  "value.color":         { color:"#EC4899", glyph:"◐", label:"Color",           short:"Color",  shape:"circle" },
  "value.bool":          { color:"#EF5350", glyph:"✓", label:"Boolean",         short:"Bool",   shape:"diamond" },
  "value.path":          { color:"#C49A6C", glyph:"/", label:"Data path",       short:"Path",   shape:"diamond" },
  "value.uuid":          { color:"#7E57C2", glyph:"◇", label:"UUID reference",  short:"UUID",   shape:"diamond", reference:true },
  "value.actor":         { color:"#35C98A", glyph:"A", label:"Actor",           short:"Actor",  shape:"capsule", reference:true },
  "value.item":          { color:"#F2B84B", glyph:"I", label:"Item",            short:"Item",   shape:"square", reference:true },
  "value.user":          { color:"#60A5FA", glyph:"U", label:"User",            short:"User",   shape:"capsule", reference:true },
  "value.scene":         { color:"#22C55E", glyph:"S", label:"Scene",           short:"Scene",  shape:"square", reference:true },
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
  ,"value.ui_instance":  { color:"#5E9FE8", glyph:"UI",label:"UI Instance",      short:"UI",     shape:"capsule", reference:true }
  ,"value.widget_ref":   { color:"#46A171", glyph:"W", label:"Widget Reference", short:"Widget", shape:"capsule", reference:true }
  ,"value.enum":         { color:"#D5803B", glyph:"E", label:"Enum",             short:"Enum",   shape:"diamond", structured:true }
  ,"value.struct":       { color:"#D5803B", glyph:"{}",label:"Struct",           short:"Struct", shape:"hex", structured:true }
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
  if (/^value\.array<.+>$/.test(subtype)) return PIN_TYPE_META["value.array"];
  return PIN_TYPE_META[subtype] ?? PIN_TYPE_META["value.any"];
}

export function subtypeColor(t) {
  return pinTypeMeta(t).color;
}

const _INTERCHANGEABLE = Object.freeze([
  ["value.number", "value.integer"],
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
  const arrayA = String(outType ?? "").match(/^value\.array<(.+)>$/);
  const arrayB = String(inType ?? "").match(/^value\.array<(.+)>$/);
  if (arrayA || arrayB) {
    if (!arrayA || !arrayB) return a === "value.array" || b === "value.array";
    return arePinsCompatible(arrayA[1], arrayB[1]);
  }
  for (const [x, y] of _INTERCHANGEABLE) {
    if ((a === x && b === y) || (a === y && b === x)) return true;
  }
  return false;
}

/**
 * Return the visible conversion node required to connect otherwise incompatible
 * value pins. These pairs deliberately remain incompatible at the edge level:
 * the graph stores a real converter node instead of hiding a runtime cast.
 */
export function automaticPinConverter(outType, inType) {
  const from = pinSubtype(outType);
  const to = pinSubtype(inType);
  if (from === "exec" || to === "exec" || from === to) return null;
  const converters = {
    "value.string>value.number": { type:"convert_number", inputPin:"value", outputPin:"v" },
    "value.number>value.string": { type:"convert_text", inputPin:"value", outputPin:"v" },
    "value.bool>value.string":   { type:"convert_text", inputPin:"value", outputPin:"v" },
    "value.string>value.bool":   { type:"convert_boolean", inputPin:"value", outputPin:"v" },
    "value.number>value.bool":   { type:"convert_boolean", inputPin:"value", outputPin:"v" },
    "value.string>value.array":  { type:"convert_array", inputPin:"value", outputPin:"v" }
  };
  const converter = converters[`${from}>${to}`];
  return converter ? Object.freeze({ ...converter }) : null;
}

export function canConnectPins(outType, inType) {
  return arePinsCompatible(outType, inType) || !!automaticPinConverter(outType, inType);
}
