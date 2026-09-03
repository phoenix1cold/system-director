import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const read=rel=>fs.readFileSync(path.join(root,rel),"utf8");

const registry=read("module/builder/widget-registry.mjs");
assert.match(registry,/resource:\s*\{[\s\S]*?label:\s*"Resource Bar"/);
assert.match(registry,/WIDGET_PALETTE_ORDER\s*=\s*\[[\s\S]*?"resource"/);
assert.doesNotMatch(registry,/LEGACY_WIDGET_TYPES\s*=\s*new Set\(\["resource"/);
const designer=read("module/builder/widget-builder-designer.mjs");
assert.doesNotMatch(designer,/BLOCKED[^\n]*"resource"/);

const settings={database:[
  {id:"actor_hp",name:"Actor HP",type:"number",scope:"actor",initial:10},
  {id:"item_uses",name:"Item Uses",type:"number",scope:"item",initial:2},
  {id:"shared_level",name:"Shared Level",type:"integer",scope:"both",initial:1}
]};
globalThis.foundry={utils:{deepClone:value=>structuredClone(value),getProperty:()=>undefined}};
globalThis.game={settings:{get:(namespace,key)=>namespace==="sd"&&key==="systemSettings"?settings:{}}};
const values=await import(pathToFileURL(path.join(root,"module/helpers/value-database.mjs")).href+`?t=${Date.now()}`);
assert.deepEqual(values.getValueDefinitions("actor").map(v=>v.id),["actor_hp","shared_level"]);
assert.deepEqual(values.getValueDefinitions("item").map(v=>v.id),["item_uses","shared_level"]);

const progression=read("module/helpers/progression-app.mjs");
assert.match(progression,/dbVariableOptions\(this\._levelVariableId,"actor"\)/);
assert.match(progression,/dbVariableOptions\(fc\.variableId\|\|fc\.path,"actor"\)/);
assert.match(progression,/getValueDefinitions\("actor"\)/);

const graph=read("module/builder/formula-graph.mjs");
const eventStart=graph.indexOf("sheet_widget_event: {");
const eventEnd=graph.indexOf("\n  sequence:",eventStart);
assert.ok(eventStart>=0&&eventEnd>eventStart,"ordinary sheet widget event node must exist");
const eventNode=graph.slice(eventStart,eventEnd);
assert.match(eventNode,/title:"On Sheet Widget Event"/);
assert.match(eventNode,/eventHook:"sdSheetWidgetEvent"/);
assert.match(eventNode,/type:"widget-picker"/);
for(const event of ["click","change","input","toggle"])assert.match(eventNode,new RegExp(`value:"${event}"`));
assert.doesNotMatch(eventNode,/blueprintId|UI Blueprint/);
assert.match(graph,/_sgMenu:menu,key,widgetId,event:"click"/);
assert.match(graph,/\{type:"sheet_widget_event",label:`On \$\{label\} Event`/);
assert.match(graph,/ctx\.isSheetTrigger && type === "ui_widget_event"/);
assert.match(graph,/collectWidgets\(widget\.widgets\)/);
assert.match(graph,/widget\.elements/);

const uiNodes=read("module/ui-blueprint/ui-widget-blueprint-nodes.mjs");
assert.match(uiNodes,/add\("ui_widget_event",\{title:"On UI Widget Event"/);
const sheet=read("module/sheets/character-sheet.mjs");
assert.match(sheet,/return dispatchSheetWidgetEvent\(doc,\{/);
assert.doesNotMatch(sheet,/Hooks\.callAll\("sdSheetWidgetEvent"/);
assert.match(sheet,/widgetKey:String\(w\.widgetKey\|\|w\.id/);
const bus=read("module/helpers/event-bus.mjs");
assert.match(bus,/sdSheetWidgetEvent:\s*\["sdSheetWidgetEvent"\]/);
assert.match(bus,/case "sdSheetWidgetEvent"/);
assert.match(bus,/__sheetWidgetValue/);

console.log("PASS: Resource Bar, Progression scope variables and ordinary Sheet Widget events.");
