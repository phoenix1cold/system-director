/**
 * Regression test: blank widget style fields must not emit CSS.
 *
 * The Widget Config popup harvests every [data-field] control on save, so any
 * untouched numeric style field is stored as an empty string. `Number("")` is
 * 0 (not NaN), so the old `_buildStyle` helpers read a blank "Opacity" field as
 * a real zero and emitted `opacity:0`, making the entire widget invisible after
 * saving any setting. The same bug forced `font-weight:100` from a blank
 * font-weight select.
 */
import fs from "node:fs";
import assert from "node:assert/strict";

// Minimal Foundry global stubs so the renderer module can be imported.
globalThis.Hooks = { once: () => {}, on: () => {}, callAll: () => {}, call: () => {} };
globalThis.game = { i18n: { localize: k => k, format: k => k }, settings: { get: () => undefined } };
globalThis.foundry = {
  utils: {
    deepClone: v => structuredClone(v),
    mergeObject: (a, b) => Object.assign({}, a, b),
    getProperty: () => undefined,
    randomID: () => "stubid",
  },
  applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: b => b } },
};
globalThis.CONFIG = {};
globalThis.ui = { notifications: { warn: () => {}, error: () => {}, info: () => {} } };

const root = new URL("..", import.meta.url);
const { WidgetRenderer } = await import(new URL("module/builder/widget-renderer.mjs", root));
const build = w => WidgetRenderer._buildStyle(w);

/* ---- blank values must be treated as "unset" ---------------------------- */

const BLANKS = ["", "   ", null, undefined];

for (const blank of BLANKS) {
  const label = JSON.stringify(blank);
  assert.doesNotMatch(build({ opacity: blank }), /opacity/,
    `blank opacity ${label} must not emit opacity`);
  assert.doesNotMatch(build({ fontWeight: blank }), /font-weight/,
    `blank fontWeight ${label} must not emit font-weight`);
  assert.doesNotMatch(build({ boxW: blank }), /width/,
    `blank boxW ${label} must not emit width`);
}

// A widget saved with every style field blank must produce no inline style at
// all. This is exactly the shape the config popup persists on first save.
const allBlank = {
  boxW: "", boxH: "", boxMinH: "", boxMaxH: "", boxPad: "", boxMargin: "", boxGap: "",
  boxBg: "", boxFg: "", labelColor: "", boxBorder: "", boxBorderWidth: "", boxBorderStyle: "",
  boxRadius: "", fontSize: "", labelFontSize: "", fontWeight: "", textAlign: "",
  contentAlign: "", opacity: "", overflow: "", iconColor: "", iconSize: "",
  labelIcon: "", labelEmoji: "", labelIconPosition: "",
};
assert.equal(build(allBlank), "", "an all-blank widget must emit no inline style");

/* ---- real values must still be honoured --------------------------------- */

assert.match(build({ opacity: 0.5 }), /opacity:0\.5/, "explicit opacity must apply");
assert.match(build({ opacity: "0.25" }), /opacity:0\.25/, "string opacity must apply");
assert.match(build({ opacity: 0 }), /opacity:0/, "an explicit 0 opacity is still allowed");
assert.match(build({ fontWeight: "700" }), /font-weight:700/, "explicit font weight must apply");
assert.match(build({ boxW: 120 }), /width:120px/, "explicit width must apply");
assert.match(build({ boxW: "120" }), /width:120px/, "string width must apply");

// Clamping must survive the blank-aware guards.
assert.match(build({ opacity: 5 }), /opacity:1/, "opacity clamps to 1");
assert.match(build({ fontWeight: 5000 }), /font-weight:900/, "font-weight clamps to 900");

// Garbage must not leak into CSS.
for (const junk of ["abc", true, false, NaN]) {
  const out = build({ opacity: junk, fontWeight: junk });
  assert.doesNotMatch(out, /opacity|font-weight/, `junk ${String(junk)} must be ignored`);
}

/* ---- sheet appearance wiring -------------------------------------------- */

const read = rel => fs.readFileSync(new URL(rel, root), "utf8");
const layouts = read("styles/sd-sheet-layouts.css");
const sheetStyle = read("module/helpers/sheet-style.mjs");
const charSheet = read("module/sheets/character-sheet.mjs");

// "Widget gap" must not be overridden by a hardcoded inline gap on the panel.
assert.doesNotMatch(charSheet, /gap:8px; min-height:0/,
  "tab panels must not hardcode gap:8px");
assert.match(charSheet, /gap:var\(--sd-sheet-widget-gap/,
  "tab panels must honour --sd-sheet-widget-gap");
assert.match(charSheet, /padding:var\(--sd-sheet-panel-padding/,
  "tab panels must honour --sd-sheet-panel-padding");

// "Accent colour" must cascade into the global accent tokens.
assert.match(sheetStyle, /setProperty\("--sd-accent", style\.accent\)/,
  "sheet accent must drive --sd-accent");

// "Density" must actually be consumed, not just declared.
assert.match(layouts, /var\(--sd-density-multiplier/,
  "--sd-density-multiplier must have at least one consumer");

// The Opacity control must present its real default (1) instead of a blank box.
const popup = read("module/builder/widget-config-popup.mjs");
assert.match(popup, /isBlank && key === "opacity" \? 1/,
  "the opacity style cell must default to 1");
assert.match(popup, /min="0" max="1" step="0\.05"/,
  "opacity must be range-limited to 0..1");

// Switching Data Source must move the harvested field between the two boxes,
// otherwise the chosen Database variable is silently dropped on save.
assert.match(popup, /el\.setAttribute\("data-field", el\.dataset\.fieldOff\)/,
  "bind-mode switch must activate the newly visible control");
assert.match(popup, /el\.setAttribute\("data-field-off", el\.dataset\.field\)/,
  "bind-mode switch must deactivate the hidden control");

// The Template button must collapse to its icon in the narrow vertical rails
// instead of having its label clipped.
assert.match(charSheet, /<span class="sd-tpl-label">Template<\/span>/,
  "the Template label must be a separate span");
assert.match(charSheet, /tplBtn\.className = "sd-tpl-btn"/,
  "the Template button needs a stable class");
assert.match(layouts, /\.sd-tpl-btn \.sd-tpl-label \{\s*display: none/,
  "rail layouts must hide the Template label");

// Background image must be pickable with the FilePicker, not typed by hand.
assert.match(charSheet, /class="sd-sheet-style-fp" data-fp-target="backgroundImage"/,
  "the sheet appearance dialog needs a file picker button");
assert.match(charSheet, /foundry\.applications\?\.apps\?\.FilePicker\?\.implementation/,
  "the picker must resolve the configured FilePicker implementation");

// ---------------------------------------------------------------------------
// Attribute widget: the modifier is a value of its own, not only a derivation.
// ---------------------------------------------------------------------------
const widgetVars = read("module/helpers/widget-variables.mjs");
const widgetNodes = read("module/builder/widget-nodes.mjs");
const rendererSrc = read("module/builder/widget-renderer.mjs");
const registrySrc = read("module/builder/widget-registry.mjs");

// A second declared variable is what gives the widget's Set node a Modifier
// entry, because those inputs are generated from WIDGET_VARIABLES.
assert.match(widgetVars, /field: "pathMod",\s+label: "Modifier"/,
  "the attribute widget must declare its own Modifier variable");
assert.match(widgetNodes, /export function attributeModifier\(widget, doc\)/,
  "the modifier must be resolved through a shared helper");
assert.match(widgetNodes, /\["mod", "Modifier", "value\.number", \(w, d\) => attributeModifier\(w, d\)\]/,
  "the node mod pin must go through attributeModifier");
assert.doesNotMatch(widgetNodes, /Math\.floor\(\(num\(readWidgetValue\(d, w, "path"\)\) - 10\) \/ 2\)/,
  "the hardcoded modifier formula must be gone from the node contract");
assert.match(registrySrc, /modSource: "derived"/,
  "existing sheets must keep the derived modifier by default");
assert.match(popup, /\["Modifier","pathMod","path"\]/,
  "the config popup must expose the modifier variable");
assert.match(rendererSrc, /const ownMod\s+= String\(w\.modSource \?\? "derived"\) === "own"/,
  "the renderer must honour the modifier source");

// Rendered output: derived stays a button, own becomes an editable input.
const derivedHtml = WidgetRenderer._render_attribute(
  { type: "attribute", label: "Might", path: "", varDefaults: {} }, null);
assert.match(derivedHtml, /class="attr-mod"/, "derived modifier stays a button");
assert.doesNotMatch(derivedHtml, /attr-mod-input/, "derived modifier is not editable");

const ownHtml = WidgetRenderer._render_attribute(
  { type: "attribute", label: "Might", path: "", pathMod: "", modSource: "own", varDefaults: {} }, null);
assert.match(ownHtml, /class="attr-mod-input"/, "an own modifier is editable on the sheet");
assert.match(ownHtml, /fa-dice-d20/, "an own modifier keeps a roll affordance");

// The score and the modifier must be two independent inputs.
assert.equal((ownHtml.match(/<input /g) ?? []).length, 2,
  "score and modifier must be separate inputs");

console.log("test-widget-blank-style-values: all assertions passed");
