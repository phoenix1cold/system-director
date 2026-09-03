import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assignUniqueWidgetDataPaths,
  buildWidgetPathRegistryUpdate,
  getWidgetPathRows,
  releaseWidgetDataPath
} from "../module/builder/widget-paths.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = rel => fs.readFileSync(path.join(root, rel), "utf8");

const formulaGraph = read("module/builder/formula-graph.mjs");
const characterSheet = read("module/sheets/character-sheet.mjs");
const itemSheet = read("module/sheets/item-sheet.mjs");
const gridManager = read("module/builder/grid-manager.mjs");
const widgetPopup = read("module/builder/widget-config-popup.mjs");
const manifest = JSON.parse(read("system.json"));

assert.match(formulaGraph, /act_roll_v2:[\s\S]*?\{id:"dice",label:"Dice",type:"value\.array"\}/, "Roll must expose a Dice array output");
assert.ok(formulaGraph.includes('act_roll_v2: { result:"{__rollResult}", total:"{__rollTotal}", dice:"{__rollDice}"'), "Roll Dice output must compile to the runtime array token");

const tabs = [{ id:"tab", rows:[{ id:"row", widgets:[
  { id:"w1", type:"text", label:"First", path:"system.flags.myField" }
]}]}];
const doc = { system:{ customTabs:tabs, flags:{ __widgetPaths:[{ path:"system.flags.myField3" }] } } };
const second = { id:"w2", type:"text", label:"Second", path:"system.flags.myField" };
assignUniqueWidgetDataPaths(second, doc);
// 1.11.0: every widget owns its value, so bindings are repointed at the widget's own storage.
assert.match(second.path, /^system\.widgetVars\./, "widget values live on the widget itself");
assert.notEqual(second.path, tabs[0].rows[0].widgets[0].path, "two widgets never share one storage slot");

const attribute = { id:"a2", type:"attribute", path:"system.attributes.attr1.value" };
assignUniqueWidgetDataPaths(attribute, { system:{ customTabs:[{rows:[{widgets:[{id:"a1",type:"attribute",path:"system.attributes.attr1.value"}]}]}], flags:{} } });
assert.equal(attribute.path, "system.attributes.attr1.value", "legacy bindings stay private and are never renumbered");

const resource = { id:"r2", type:"resource", pathValue:"system.resources.hp.value", pathMax:"system.resources.hp.max" };
assignUniqueWidgetDataPaths(resource, { system:{ customTabs:[{rows:[{widgets:[{id:"r1",type:"resource",pathValue:"system.resources.hp.value",pathMax:"system.resources.hp.max"}]}]}], flags:{} } });
assert.equal(resource.pathValue, "system.resources.hp.value");
assert.equal(resource.pathMax, "system.resources.hp.max");

const nextTabs = structuredClone(tabs);
nextTabs[0].rows[0].widgets.push(second);
const registryUpdate = buildWidgetPathRegistryUpdate(doc, nextTabs);
assert.ok(registryUpdate["system.flags.__widgetPaths"].some(entry => entry.path === "system.flags.myField"));
const rows = getWidgetPathRows({ system:{ ...doc.system, customTabs:nextTabs } });
// 1.11.0: a widget passed through the path assigner owns its value, while
// widgets already stored on the document keep their old binding until the
// 1.11.0 migration converts them.
assert.ok(rows.some(entry => entry.path === "system.widgetVars.w2.path" && entry.inUse), "the widget owns its own value");
assert.ok(rows.some(entry => entry.path === "system.flags.myField" && entry.inUse), "existing bindings are left alone here");
assert.ok(rows.some(entry => entry.path === "system.flags.myField3" && !entry.inUse));

let removalPatch = null;
const removableDoc = {
  system:{ customTabs:[], flags:{ __widgetPaths:[{path:"system.flags.myField"},{path:"system.flags.myField2"}], myField2:"old" } },
  async update(patch){ removalPatch = patch; }
};
assert.deepEqual(await releaseWidgetDataPath(removableDoc, "system.flags.myField2"), {ok:true});
assert.ok(!removalPatch["system.flags.__widgetPaths"].some(entry => entry.path === "system.flags.myField2"));
assert.equal(removalPatch["system.flags.-=myField2"], null, "releasing a path must clear its stored value");

let schemaRemovalPatch = null;
const field = initial => ({ options:{ initial }, getInitialValue:()=>initial });
const schemaDoc = {
  system:{
    customTabs:[],
    flags:{ __widgetPaths:[{path:"system.skills.skill1.rank"}] },
    skills:{ skill1:{ rank:4, attribute:"", bonus:4, label:"Skill 1" } },
    schema:{ fields:{ skills:{ fields:{ skill1:{ fields:{ rank:field(0), attribute:field(""), bonus:field(0), label:field("Skill 1") } } } } } }
  },
  async update(patch){ schemaRemovalPatch = patch; }
};
assert.deepEqual(await releaseWidgetDataPath(schemaDoc, "system.skills.skill1.rank"), {ok:true});
assert.equal(schemaRemovalPatch["system.skills.skill1.rank"], 0, "required schema fields must reset to their initial value instead of becoming undefined");
assert.equal(schemaRemovalPatch["system.skills.skill1.-=rank"], undefined);

let inUseUpdated = false;
const inUseDoc = {
  system:{ customTabs:tabs, flags:{ __widgetPaths:[{path:"system.flags.myField"}] } },
  async update(){ inUseUpdated = true; }
};
assert.deepEqual(await releaseWidgetDataPath(inUseDoc, "system.flags.myField"), {ok:false,reason:"in-use"});
assert.equal(inUseUpdated, false, "an active widget path cannot be removed");

for (const source of [characterSheet, itemSheet]) {
  assert.doesNotMatch(source, /Widget Data Paths/, "manual path management must not return to the sheet UI");
  assert.doesNotMatch(source, /releaseWidgetDataPath/, "path release stays an internal migration utility");
  assert.match(source, /assignUniqueWidgetDataPaths/);
  assert.match(source, /buildWidgetPathRegistryUpdate/);
}
assert.match(gridManager, /assignUniqueWidgetDataPaths/);
assert.match(gridManager, /buildWidgetPathRegistryUpdate/);
assert.match(widgetPopup, /additionalWidgets:/, "nested Widget Builder widgets must participate in allocation");
assert.match(manifest.version, /^\d+\.\d+\.\d+$/);

console.log("PASS: Roll dice array and shared Database-variable widget bindings.");
