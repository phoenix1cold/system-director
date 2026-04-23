/**
 * module/builder/pin-types.mjs
 *
 * Pin-subtype registry for System Director's node graph.
 *
 * The legacy pin-type space is just two values:
 *   "exec"    -- execution wires (orange)
 *   "value"   -- data wires (blue→green gradient, any value)
 *
 * Step 2 extends "value" with a dotted subtype suffix:
 *   value.number   value.string   value.bool   value.path
 *   value.uuid     value.actor    value.item   value.token
 *   value.array    value.any      (legacy "value" alone == "value.any")
 *
 * Compatibility at connect-time:
 *   exec ↔ exec          -- OK
 *   value.any ↔ anything -- OK (coercion fallback)
 *   value.X ↔ value.X    -- OK
 *   value.X ↔ value.Y    -- REJECTED
 *
 * Runtime (button-executor) does NOT enforce subtypes -- it still treats all
 * wires as string formulas.  Subtypes are purely editor-side affordances:
 *   • colour-coded wires
 *   • connection rejection in _endConn
 *   • later: autocomplete "drag pin into empty → filter compatible nodes"
 */

/** Map subtype → colour used when rendering the wire. */
export const PIN_SUBTYPE_COLORS = Object.freeze({
  "exec":          "#ffca6b", // orange — execution flow
  "value.any":     null,      // null  → use legacy blue→green gradient
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

/**
 * Return the normalised subtype of a pin.type string.
 *   "value"          → "value.any"
 *   "value.number"   → "value.number"
 *   "exec"           → "exec"
 *   undefined/""     → "value.any"
 */
export function pinSubtype(t) {
  if (!t) return "value.any";
  if (t === "exec") return "exec";
  if (t === "value") return "value.any";
  if (t.startsWith("value.")) return t;
  return "value.any";
}

/**
 * Wire stroke colour for an output pin.  Returns `null` for value.any so the
 * caller can fall back to the gradient URL reference.
 */
export function subtypeColor(t) {
  return PIN_SUBTYPE_COLORS[pinSubtype(t)] ?? null;
}

/**
 * True if two pin types are compatible for connection.
 * Exec only connects to exec; value.any connects to any value; typed pins
 * must match or touch a value.any on the other side.
 */
export function arePinsCompatible(outType, inType) {
  const a = pinSubtype(outType);
  const b = pinSubtype(inType);
  if (a === "exec" || b === "exec") return a === b;
  if (a === "value.any" || b === "value.any") return true;
  return a === b;
}
