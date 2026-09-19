import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const bindings = await import("../module/ui-blueprint/ui-widget-bindings.mjs");
const schema = await import("../module/ui-blueprint/ui-widget-blueprint.mjs");

assert.equal(schema.BLUEPRINT_SCHEMA_VERSION, 4);
assert.deepEqual(bindings.parseCollection('[{"name":"A"},{"name":"B"}]').map(row => row.name), ["A", "B"]);
assert.deepEqual(bindings.filterAndSortCollection([{name:"Beta"},{name:"Alpha"}], { sortKey:"name", limit:1 }), [{name:"Alpha"}]);
assert.equal(bindings.applyBindingTransform(0.42, { transform:"percent", suffix:"%" }), "42%");
assert.equal(bindings.resolveBindingValue({kind:"row",path:"stats.hp",transform:"number"}, {local:{row:{stats:{hp:"17"}}}}), 17);
assert.equal(bindings.resolveBindingValue({kind:"context",path:"actor.name"}, {context:{actor:{name:"Hero"}}}), "Hero");
assert.equal(bindings.resolveBindingValue({kind:"variable",variableId:"score"}, {state:{getVariable:id=>id==="score"?12:null}}), 12);
assert.equal(bindings.resolveBindingValue({kind:"widget",widgetId:"health",property:"value"}, {state:{getWidgetProperty:(id,key)=>`${id}:${key}`}}), "health:value");

const migrated = schema.migrateBlueprintData({
  schemaVersion: 3,
  blueprintId: "cards",
  variables: [{id:"rows",name:"Rows",type:"array",scope:"instance",default:[]}],
  elements: [{id:"cards",name:"Cards",type:"repeater",props:{templateId:"row-card"},bind:{source:{kind:"variable",variableId:"rows"}}}],
  templates: [{id:"row-card",name:"Row Card",elements:[{id:"name",name:"Name",type:"label",props:{text:"{row.name}"}}]}]
});
assert.equal(migrated.schemaVersion, 4);
assert.equal(migrated.elements[0].bind.source.kind, "variable");
assert.equal(migrated.templates[0].id, "row-card");
assert.equal(schema.validateBlueprint(migrated).valid, true);
assert.equal(schema.validateBlueprint({...migrated,elements:[{...migrated.elements[0],props:{templateId:"missing"}}]}).valid, false);

const elements = await readFile(new URL("../module/ui-blueprint/ui-widget-elements.mjs", import.meta.url), "utf8");
const runtime = await readFile(new URL("../module/ui-blueprint/ui-widget-runtime.mjs", import.meta.url), "utf8");
const editor = await readFile(new URL("../module/ui-blueprint/ui-widget-editor.mjs", import.meta.url), "utf8");
const events = await readFile(new URL("../module/ui-blueprint/ui-widget-events.mjs", import.meta.url), "utf8");
assert.match(elements, /define\("component"/);
assert.match(elements, /define\("repeater"/);
assert.match(runtime, /_renderTemplateInstance/);
assert.match(runtime, /visibilityMode/);
assert.match(editor, /Widget property/);
assert.match(editor, /Repeater row/);
assert.match(events, /case "row"/);
assert.match(events, /__uiCount/);

console.log("PASS: UI Blueprint v4 components, repeaters, typed bindings, transforms and event context");
