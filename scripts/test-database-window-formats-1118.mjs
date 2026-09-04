import assert from "node:assert/strict";
import fs from "node:fs";

/**
 * 1.11.8 regression: every Database editor must expose a single "Add Variable"
 * button and must document how a value of each variable type is typed in.
 */

const read = name => fs.readFileSync(new URL(`../${name}`, import.meta.url), "utf8");

const app = read("module/helpers/value-database-app.mjs");
const dbcss = read("styles/shared-database.css");
const cfg = read("module/helpers/system-config.mjs");
const hbs = read("templates/config/system-config.hbs");
const syscss = read("styles/system.css");
const manifest = JSON.parse(read("system.json"));

// --- 1. Database window: exactly one Add Variable button --------------------
const appButtons = app.match(/Add Variable<\/button>/g) ?? [];
assert.equal(appButtons.length, 1, `the Database window must render one Add Variable button, found ${appButtons.length}`);
assert.ok(!app.includes('class="sd-db-secondary" data-action="addVariable"'), "the duplicated footer button must be gone");
assert.ok(app.includes('class="sd-db-add" data-action="addVariable"'), "the header button must stay");
assert.ok(app.includes("sd-db-foot-note"), "the footer must say where the button lives");

// --- 2. Database window: per-type format hints ------------------------------
assert.ok(app.includes("valueTypeFormat, valueTypePlaceholder, valueTypeFormatHint"), "format helpers must be imported");
assert.ok(app.includes("const AUTO_INITIALS"), "per-type default initial values must exist");
assert.ok(app.includes("data-draft-format"), "draft rows must carry a format line");
assert.ok(app.includes('placeholder="${esc(valueTypePlaceholder(draft.type))}"'), "the initial value input needs a typed placeholder");
assert.ok(app.includes("${formatChip(def.type)}"), "existing rows must show their format chip");
assert.ok(app.includes('root.querySelectorAll(\'[data-draft="type"]\')'), "switching the type must refresh the hint live");
assert.ok(/placeholder="\$\{ph\}" title="\$\{hint\}"/.test(app), "value controls must expose placeholder + tooltip");
assert.ok(!app.includes('placeholder="Initial value"'), "the generic placeholder must be replaced by the typed one");
for (const selector of [".sd-db-draft-format", ".sd-db-fmt-chip", ".sd-db-foot-note"]) {
  assert.ok(dbcss.includes(selector), `missing style for ${selector}`);
}

// --- 3. System Settings: one button + a format legend -----------------------
const hbsButtons = hbs.match(/data-action="addDatabaseValue"/g) ?? [];
assert.equal(hbsButtons.length, 1, `the settings Database section must render one Add Variable button, found ${hbsButtons.length}`);
assert.ok(hbs.includes("config-db-formats"), "the settings Database section needs the format legend");
assert.ok(hbs.includes("{{#each databaseFormats as |f|}}"), "the legend must iterate every type");
assert.ok(hbs.includes('placeholder="{{v.formatPlaceholder}}"'), "the default value input needs the typed placeholder");
assert.ok(hbs.includes('title="{{v.formatHint}}"'), "the default value input needs the format tooltip");
assert.ok(!hbs.includes('placeholder="Default"'), "the generic Default placeholder must be gone");
assert.ok(cfg.includes("valueTypeFormat, valueTypePlaceholder, VALUE_DATABASE_TYPES"), "the config app must import the format helpers");
assert.ok(/databaseFormats:\s*VALUE_DATABASE_TYPES\.map/.test(cfg), "the context must build the legend from the type list");
assert.ok(cfg.includes("formatPlaceholder:valueTypePlaceholder(v.type)"), "every row must carry its own placeholder");
for (const selector of [".config-db-formats", ".config-db-fmt", ".config-db-formats-title"]) {
  assert.ok(syscss.includes(selector), `missing style for ${selector}`);
}

// --- 4. runtime: every type documents its input format ----------------------
const getProperty = (object, path) => String(path ?? "").split(".").filter(Boolean).reduce((value, key) => value?.[key], object);
const setProperty = (object, path, value) => { const parts = String(path).split(".").filter(Boolean); let target = object; for (const key of parts.slice(0, -1)) target = target[key] ??= {}; target[parts.at(-1)] = value; return true; };
globalThis.foundry = { utils: { getProperty, setProperty, deepClone: value => structuredClone(value) } };
globalThis.Actor = class Actor {};
globalThis.game = {
  settings: { get: () => ({ database: [] }) },
  actors: { get: () => null },
  items: { get: () => null, getName: () => null, find: () => null },
  user: { targets: new Set(), isGM: true },
  i18n: { localize: key => key, format: key => key }
};
globalThis.canvas = { tokens: { get: () => null, controlled: [] } };
globalThis.Hooks = { once: () => {}, on: () => {}, off: () => {}, call: () => true, callAll: () => true };
globalThis.CONFIG = { SD: { currencies: [] } };
globalThis.ui = { notifications: { warn: () => {}, info: () => {}, error: () => {} } };

const db = await import("../module/helpers/value-database.mjs");

for (const type of db.VALUE_DATABASE_TYPES) {
  const format = db.valueTypeFormat(type);
  assert.ok(format.example && format.hint, `type ${type} must document example + hint`);
  assert.equal(typeof db.valueTypePlaceholder(type), "string", `type ${type} must expose a placeholder`);
  assert.match(db.valueTypeFormatHint(type), /.+ - .+/, `type ${type} must build a one line hint`);
}
assert.match(db.valueTypeFormat("array").example, /\[/, "the array example must show JSON syntax");
assert.match(db.valueTypeFormat("object").hint, /JSON/i, "the object hint must mention JSON");

// --- 5. manifest ------------------------------------------------------------
assert.match(
  manifest.version,
  /^1\.(11\.([8-9]|\d{2,})|(1[2-9]|[2-9]\d)\.\d+)$/,
  "this fix ships in 1.11.8 or newer"
);

console.log(`PASS: one Add Variable button per editor, per-type value format hints (${manifest.version}).`);
