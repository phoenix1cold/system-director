import assert from "node:assert/strict";import fs from "node:fs";
const toolbox=fs.readFileSync(new URL("../module/builder/toolbox-app.mjs",import.meta.url),"utf8");
const market=fs.readFileSync(new URL("../module/helpers/market-app.mjs",import.meta.url),"utf8");
const config=fs.readFileSync(new URL("../templates/config/system-config.hbs",import.meta.url),"utf8");
for(const token of ["languages:","effectPresets:","sdSheetTemplate: SHEET_TEMPLATE_FORMAT","sdSheetTemplateBundle: SHEET_TEMPLATE_FORMAT","_mergeLanguages"])assert.ok(toolbox.includes(token),`template bridge missing ${token}`);
// 1.11.1: templates carry widget values plus the world-level things their graphs
// point at, so a restored sheet no longer references values that do not exist.
for(const token of ["export const SHEET_TEMPLATE_FORMAT = 3","widgetVars:","widgetPathRegistry:","dependencies: {","_restoreTemplateDependencies","formatVersion:"])assert.ok(toolbox.includes(token),`template dependency bundle missing ${token}`);
// Packaging ships shared Database variables and screens the package first.
for(const token of ['"sharedDatabases"',"PACKAGE_EXCLUDED_SETTING_KEYS","_validatePackage","_confirmPackage"])assert.ok(market.includes(token),`market packaging missing ${token}`);
for(const token of ['"localizationLanguages"','"effectPresets"','"allowPlayerEffectApplier"','localizations:true','effectPresets:true'])assert.ok(market.includes(token),`market bridge missing ${token}`);
assert.ok(config.includes("{{#if isGM}}"));assert.ok(config.includes("Database"));assert.ok(!config.includes("Node Graph"),"1.11.5: the settings node graph was removed");assert.ok(config.includes("localizationLanguage"),"1.11.4: the display language picker belongs to System Configuration");
console.log("Market/template bridge with Database-only SystemConfig regression: OK");
