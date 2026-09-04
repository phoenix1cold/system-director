/**
 * 1.11.4 regression: the System Configuration window must expose the display
 * language picker and language creation again, and switching the language must
 * refresh already open windows (Foundry v13+ keeps them in a Map).
 */
import assert from "node:assert";
import fs from "node:fs";

const read = name => fs.readFileSync(new URL(`../${name}`, import.meta.url), "utf8");

/* -------------------------------------------------- 1. settings window markup */
const hbs = read("templates/config/system-config.hbs");

for (const needle of [
  'name="localizationLanguage"',
  'name="translationEditLanguage"',
  'class="sd-language-row"',
  'data-language-id="{{l.id}}"',
  "data-language-name",
  "data-language-fallback",
  "data-language-enabled",
  "data-language-primary",
  'data-action="addLanguage"',
  'data-duplicate-language="{{l.id}}"',
  'data-remove-language="{{l.id}}"',
  'data-action="exportLanguages"',
  'data-action="importLanguages"',
  'data-role="importLanguagesFile"',
  '{{localize "SD.Settings.Localization"}}',
  '{{localize "SD.Settings.DisplayLanguage"}}'
]) {
  assert.ok(hbs.includes(needle), `system-config.hbs is missing ${needle}`);
}

// Players cannot open the GM-only sections, but the display language is a
// client setting, so the non-GM branch has to offer the picker too.
const elseBranch = hbs.slice(hbs.lastIndexOf("{{else}}"));
assert.ok(elseBranch.includes('name="localizationLanguage"'),
  "non-GM branch must still offer the display language picker");
assert.ok(!elseBranch.includes('data-action="addLanguage"'),
  "non-GM branch must not offer language creation");

// The base language may be disabled/renamed away by accident otherwise.
assert.ok(hbs.includes("{{#unless l.isBase}}<button type=\"button\" class=\"config-remove-btn\" data-remove-language"),
  "base language must not offer a remove button");

/* -------------------------------------------------- 2. window wiring in JS */
const cfg = read("module/helpers/system-config.mjs");
for (const needle of [
  '"[name=\'localizationLanguage\']"',
  '"[name=\'translationEditLanguage\']"',
  '"[data-action=\'addLanguage\']"',
  '"[data-remove-language]"',
  '"[data-duplicate-language]"',
  '"[data-action=\'exportLanguages\']"',
  '"[data-action=\'importLanguages\']"',
  ".sd-language-row",
  "saveLanguages(rows)",
  'L("AddLanguageTitle")',
  'L("LanguageExists")',
  "SD.Settings.LanguageAdded",
  "SD.Settings.TranslationsImported",
  "SD.Settings.TranslationsInvalid",
  "SD.Settings.BaseLanguageLocked"
]) {
  assert.ok(cfg.includes(needle), `system-config.mjs is missing ${needle}`);
}
assert.ok(cfg.includes("languageRows.filter(f=>f.id!==l.id)"),
  "fallback options must not offer the language itself");
assert.ok(cfg.includes("foundry.utils?.saveDataToFile??globalThis.saveDataToFile"),
  "translation export must use the namespaced saveDataToFile");

/* -------------------------------------------------- 3. localization runtime */
const store = new Map();
const registered = new Map();
const rendered = [];

class FakeApp {
  constructor(id) { this.id = id; this.rendered = true; }
  render() { rendered.push(this.id); }
}

globalThis.foundry = {
  utils: { deepClone: v => JSON.parse(JSON.stringify(v ?? null)) },
  applications: { instances: new Map([["v2-sheet", new FakeApp("v2-sheet")]]) }
};
globalThis.ui = { windows: { 1: new FakeApp("v1-window") }, notifications: { info(){}, warn(){}, error(){} } };
const hookCalls = [];
globalThis.Hooks = { on(){}, once(){}, off(){}, call(){ return true; }, callAll(...a){ hookCalls.push(a); return true; } };
globalThis.game = {
  user: { isGM: true },
  settings: {
    settings: registered,
    register(ns, key, config) {
      registered.set(`${ns}.${key}`, config);
      if (!store.has(`${ns}.${key}`)) store.set(`${ns}.${key}`, config.default);
    },
    get(ns, key) { return store.get(`${ns}.${key}`); },
    async set(ns, key, value) {
      store.set(`${ns}.${key}`, value);
      try { registered.get(`${ns}.${key}`)?.onChange?.(value); } catch {}
      return value;
    }
  }
};

const L = await import("../module/helpers/localization.mjs");
L.registerLocalizationSettings();

// The picker has to be visible in Foundry's own settings list as well, so a
// player without access to System Configuration can still switch languages.
const pickerConfig = registered.get("sd.localizationLanguage");
assert.equal(pickerConfig.config, true, "display language must be a visible client setting");
assert.equal(pickerConfig.scope, "client");
assert.equal(pickerConfig.name, "SD.Settings.DisplayLanguage");
assert.ok(pickerConfig.choices.base, "choices must include the base language");
assert.ok(pickerConfig.choices.ru, "choices must include the bundled languages");

// Creating a language keeps the picker choices in sync without a reload.
await L.saveLanguages([...L.getLanguages(), { id: "de", name: "Deutsch", enabled: true, fallback: "base" }]);
assert.ok(registered.get("sd.localizationLanguage").choices.de?.includes("Deutsch"),
  "a new language must appear in the display language choices");

// Switching the language must actually re-render what is on screen.
rendered.length = 0;
await L.setCurrentLanguage("de");
assert.equal(L.currentLanguage(), "de");
assert.deepEqual([...new Set(rendered)].sort(), ["v1-window", "v2-sheet"],
  "both ApplicationV2 (Map) and legacy windows must be re-rendered");
assert.ok(hookCalls.some(([hook, lang]) => hook === "sdLanguageChanged" && lang === "de"),
  "sdLanguageChanged must fire with the new language");

// Translations follow the fallback chain of the freshly created language.
const field = { label: "Sword", i18n: { de: { label: "Schwert" } } };
assert.equal(L.localizedField(field, "label"), "Schwert",
  "the freshly created language must be used for display");
assert.equal(L.localizedField({ label: "Sword" }, "label"), "Sword",
  "missing translations must fall back to the base text");
assert.equal(L.localizeTree(field).label, "Schwert",
  "widget trees must be localized with the selected language");

/* -------------------------------------------------- 4. i18n keys */
const KEYS = [
  "Localization", "LocalizationHint", "DisplayLanguage", "DisplayLanguageHint",
  "TranslationEditLanguage", "TranslationEditLanguageHint", "LanguageCode", "LanguageName",
  "LanguageEnabled", "LanguageFallback", "LanguagePrimary", "AddLanguage", "AddLanguageTitle",
  "AddLanguageHint", "LanguageAdded", "LanguageExists", "DuplicateLanguage", "RemoveLanguage",
  "BaseLanguageLocked", "BaseLanguageNote", "ExportTranslations", "ImportTranslations",
  "TranslationsImported", "TranslationsInvalid"
];
for (const file of ["lang/en.json", "lang/ru.json"]) {
  const settings = JSON.parse(read(file)).SD.Settings;
  for (const key of KEYS) {
    assert.ok(typeof settings[key] === "string" && settings[key].trim(),
      `${file} is missing SD.Settings.${key}`);
  }
  assert.ok(settings.LanguageAdded.includes("{name}"), `${file}: LanguageAdded needs the {name} slot`);
}

/* -------------------------------------------------- 5. manifest */
const manifest = JSON.parse(read("system.json"));
assert.ok(/^1\.(11\.([4-9]|\d{2,})|(1[2-9]|[2-9]\d)\.\d+)$/.test(manifest.version),
  `unexpected manifest version ${manifest.version}`);

console.log("PASS: language picker and language creation restored in system settings (1.11.4).");
