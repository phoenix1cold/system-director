import assert from "node:assert/strict";import fs from "node:fs";
const toolbox=fs.readFileSync(new URL("../module/builder/toolbox-app.mjs",import.meta.url),"utf8");
const market=fs.readFileSync(new URL("../module/helpers/market-app.mjs",import.meta.url),"utf8");
const config=fs.readFileSync(new URL("../templates/config/system-config.hbs",import.meta.url),"utf8");
for(const token of ["languages:","effectPresets:","sdSheetTemplate: 2","sdSheetTemplateBundle: 2","_mergeLanguages"])assert.ok(toolbox.includes(token),`template bridge missing ${token}`);
for(const token of ['"localizationLanguages"','"effectPresets"','"allowPlayerEffectApplier"','localizations:true','effectPresets:true'])assert.ok(market.includes(token),`market bridge missing ${token}`);
assert.ok(config.includes("{{#if isGM}}"));assert.ok(config.includes("localizationLanguage"));assert.ok(config.includes("allowPlayerEffectApplier"));
console.log("Market/template localization 0.19.0 regression: OK");
