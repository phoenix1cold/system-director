import assert from "node:assert/strict";
import fs from "node:fs";

globalThis.foundry = {
  applications: { api: {} },
  utils: {
    deepClone: value => structuredClone(value),
    randomID: () => "abcdefgh",
    getProperty: (object, path) => String(path).split(".").reduce((value, key) => value?.[key], object),
    escapeHTML: value => String(value ?? "")
  }
};
globalThis.game = { settings: { get: () => ({ database: { values: [
  { id: "strength", name: "Strength", type: "number", scope: "actor", initial: 0 },
  { id: "luck", name: "Luck", type: "number", scope: "both", initial: 0 }
] } }) } };

const registry = await import("../module/builder/widget-registry.mjs");
const easy = await import("../module/builder/easy-button-wizard.mjs");

assert.ok(registry.WIDGET_TYPES.easyButton, "Easy Button must be registered");
assert.ok(registry.WIDGET_PALETTE_ORDER.includes("easyButton"), "Easy Button must be in the palette");
assert.ok(registry.CLICKABLE_WIDGET_TYPES.has("easyButton"), "Easy Button must emit click events");
assert.equal(registry.REMOVED_WIDGET_TYPES.dice, "easyButton", "legacy Dice Button must migrate to Easy Button");
assert.equal(registry.createWidget("easyButton").formula, "1d20");

const constructed = {
  easyMode: "constructor",
  diceTerms: [{ count: 2, sides: 6 }, { count: 1, sides: 8 }],
  variableTerms: [{ operator: "+", variableId: "strength" }, { operator: "-", variableId: "luck" }],
  widgetTerms: [{ operator: "+", widgetKey: "damage_bonus" }]
};
assert.equal(easy.buildEasyButtonFormula(constructed), "2d6 + 1d8 + {system.values.strength} - {system.values.luck} + {widget:damage_bonus}");
assert.equal(easy.buildEasyButtonFormula({ easyMode: "formula", customFormula: "3d10kh2 + 4" }), "3d10kh2 + 4");

const normalized = easy.normalizeEasyButtonConfig({ easyMode: "constructor", diceTerms: [{count:0,sides:0}] });
assert.deepEqual(normalized.diceTerms, [{count:1,sides:2}]);

const renderer = fs.readFileSync(new URL("../module/builder/widget-renderer.mjs", import.meta.url), "utf8");
const character = fs.readFileSync(new URL("../module/sheets/character-sheet.mjs", import.meta.url), "utf8");
const item = fs.readFileSync(new URL("../module/sheets/item-sheet.mjs", import.meta.url), "utf8");
const config = fs.readFileSync(new URL("../module/builder/widget-config-popup.mjs", import.meta.url), "utf8");
assert.match(renderer, /data-formula-raw/);
assert.match(renderer, /_render_easyButton/);
assert.match(character, /openEasyButtonWizard/);
assert.match(item, /openEasyButtonWizard/);
assert.match(config, /OPEN EASY BUTTON CONSTRUCTOR/);

console.log("Easy Button 2.2.0 regression: OK");
