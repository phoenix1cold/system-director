import assert from "node:assert/strict";
import fs from "node:fs";

globalThis.foundry={utils:{deepClone:v=>structuredClone(v),getProperty:(o,p)=>String(p).split('.').reduce((v,k)=>v?.[k],o)}};
globalThis.game={settings:{get:()=>({database:{values:[{id:"health",name:"Health",type:"number",scope:"actor",initial:10}]}})}};
const db=await import("../module/helpers/value-database.mjs");
const defs=db.normalizeValueDatabase({values:[{id:"Health Value",name:"Health",type:"number",scope:"actor",initial:"12"}]});
assert.equal(defs[0].id,"health_value");assert.equal(defs[0].initial,12);
assert.equal(db.valueStoragePath("health"),"system.values.health");
const actor={system:{values:{health:7}}};
game.settings.get=()=>({database:[{id:"health",name:"Health",type:"number",scope:"actor",initial:10}]});
assert.equal(db.readDatabaseValue(actor,"health"),7);

const cfg=fs.readFileSync(new URL("../templates/config/system-config.hbs",import.meta.url),"utf8");
assert.match(cfg,/Database/);assert.match(cfg,/Node Graph/);assert.doesNotMatch(cfg,/Resource Bars|System Paths|Attributes/);
const graph=fs.readFileSync(new URL("../module/builder/formula-graph.mjs",import.meta.url),"utf8");
assert.match(graph,/get_value:/);assert.match(graph,/set_value:/);assert.match(graph,/Only Variable/);assert.match(graph,/Legacy Get Path/);
const effects=fs.readFileSync(new URL("../module/helpers/effect-applier.mjs",import.meta.url),"utf8");
assert.match(effects,/Database variable/);assert.doesNotMatch(effects,/Attribute key/);
const widget=fs.readFileSync(new URL("../module/builder/widget-config-popup.mjs",import.meta.url),"utf8");
// 1.11.0: widget bindings are widget-owned values, no Database variable picker.
assert.match(widget,/widget-variables\.mjs/);assert.match(widget,/own value/);assert.match(widget,/getValueDefinitions/);
assert.doesNotMatch(widget,/Choose a typed Database variable/);
console.log("Database-only values 1.8.0 regression: OK");
