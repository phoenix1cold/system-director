import fs from "node:fs";
import assert from "node:assert/strict";
import { WIDGET_TYPES, WIDGET_VARIANTS, WIDGET_PALETTE_ORDER } from "../module/builder/widget-registry.mjs";
import { COLOR_SCHEMES, COLOR_SCHEMES_V2 } from "../module/helpers/color-schemes.mjs";

const root = new URL("..", import.meta.url);
const read = rel => fs.readFileSync(new URL(rel, root), "utf8");
const manifest = JSON.parse(read("system.json"));
const modern = read("styles/sd-widget-modern.css");
const legacy = read("styles/sd-widget-variants.css");
const themes = read("styles/sd-themes.css");
const fx = read("styles/sd-theme-fx.css");
const en = JSON.parse(read("lang/en.json"));
const ru = JSON.parse(read("lang/ru.json"));

assert.equal(manifest.version, "1.3.5");
assert.ok(manifest.styles.includes("styles/sd-widget-modern.css"));
assert.equal(new Set(WIDGET_PALETTE_ORDER).size, WIDGET_PALETTE_ORDER.length);
for (const type of WIDGET_PALETTE_ORDER) {
  assert.ok(WIDGET_TYPES[type], `missing widget ${type}`);
  const variants = WIDGET_VARIANTS[type];
  assert.ok(Array.isArray(variants) && variants.length >= 2, `${type} needs variants`);
  assert.equal(variants[0], "default", `${type} default variant first`);
  assert.equal(new Set(variants).size, variants.length, `${type} duplicate variants`);
  assert.equal(WIDGET_TYPES[type].defaults.variant, "default", `${type} default not applied`);
  const stable = type.replace(/[^A-Za-z0-9-]/g, "").toLowerCase();
  for (const variant of variants) {
    const selector = `.sd-w-${stable}.sd-v-${variant}`;
    assert.ok((legacy + modern).includes(selector), `missing CSS hook ${selector}`);
  }
}

const mustHaveVariants = {
  tracker:["hearts","stress","ammo","hex"], tokenPool:["coins","gems","charges","souls"],
  diceTray:["combat-log","critical","terminal"], vsection:["panel","quest","terminal","glass"],
  widgetBuilder:["panel","hud","glass","terminal"], inventory:["loot","tactical","survival"],
  resource:["rpg-bar","boss","survival"], spellbook:["codex","hotbar","arcane"]
};
for (const [type, variants] of Object.entries(mustHaveVariants)) {
  for (const variant of variants) assert.ok(WIDGET_VARIANTS[type].includes(variant), `${type}/${variant}`);
}

const ids = COLOR_SCHEMES.map(x => x.id);
const fxIds = COLOR_SCHEMES_V2.map(x => x.id);
assert.equal(ids.length, 17);
assert.equal(new Set(ids).size, ids.length);
for (const id of ["default","tactical","darkFantasy","wasteland","royal","cyber","horror"]) {
  assert.ok(ids.includes(id), `missing theme ${id}`);
  assert.ok(fxIds.includes(id), `missing fx ${id}`);
  assert.ok(themes.includes(`[data-sd-theme="${id}"]`), `missing theme CSS ${id}`);
  assert.ok(en.SD.Theme[COLOR_SCHEMES.find(x => x.id === id).label.split(".").at(-1)], `missing EN label ${id}`);
  assert.ok(ru.SD.Theme[COLOR_SCHEMES.find(x => x.id === id).label.split(".").at(-1)], `missing RU label ${id}`);
}
for (const id of ["tactical","darkFantasy","wasteland","royal","cyber","horror"]) {
  assert.ok(fx.includes(`data-sd-theme-fx="${id}"`), `missing FX CSS ${id}`);
}
assert.equal((modern.match(/{/g) ?? []).length, (modern.match(/}/g) ?? []).length, "modern CSS braces");
assert.equal((themes.match(/{/g) ?? []).length, (themes.match(/}/g) ?? []).length, "theme CSS braces");
assert.ok(modern.includes("prefers-reduced-motion"));
assert.ok(modern.includes(":focus-visible"));
assert.ok(modern.includes("@container"));
console.log(`System Director 1.3.5 widget visuals: ${WIDGET_PALETTE_ORDER.length} widgets, ${Object.values(WIDGET_VARIANTS).flat().length} variants, ${COLOR_SCHEMES.length} themes`);
