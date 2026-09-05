/** 1.12.0 — sheet presets, style nodes, widget Height, Present Roll text and Message Composer controls. */
import assert from "node:assert/strict";
import fs from "node:fs";
import { materializeDeferredActionSnapshot } from "../module/helpers/deferred-action-snapshot.mjs";
import { SHEET_STYLE_PRESETS, normalizeSheetStyle, sheetStyleFromPreset, applySheetStyle } from "../module/helpers/sheet-style.mjs";

const read = name => fs.readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
const getProperty = (object, path) => String(path ?? "").split(".").reduce((value, key) => value?.[key], object);
const setProperty = (object, path, value) => {
  const keys = String(path).split("."); let cursor = object;
  for (const key of keys.slice(0, -1)) cursor = cursor[key] ??= {};
  cursor[keys.at(-1)] = value; return true;
};
const deepClone = value => value === undefined ? undefined : structuredClone(value);

// Presets and CSS variable application.
assert.equal(Object.keys(SHEET_STYLE_PRESETS).length, 5);
assert.equal(sheetStyleFromPreset("rightRail").layout, "tabs-right");
assert.equal(sheetStyleFromPreset("leftRail").layout, "tabs-left");
assert.equal(sheetStyleFromPreset("topIcons").layout, "tabs-top-icons");
assert.equal(sheetStyleFromPreset("dashboard").layout, "dashboard");
assert.equal(normalizeSheetStyle({ tabSize:999 }).tabSize, 84, "tab size is clamped");
assert.equal(normalizeSheetStyle({ layout:"not-css" }).layout, "classic", "layout is allow-listed");
const cssVars = new Map();
const fakeElement = { dataset:{}, style:{setProperty:(key,value)=>cssVars.set(key,value),removeProperty:key=>cssVars.delete(key)} };
applySheetStyle(fakeElement, sheetStyleFromPreset("rightRail"));
assert.equal(fakeElement.dataset.sdSheetLayout, "tabs-right");
assert.equal(cssVars.get("--sd-sheet-rail-width"), "64px");

// Foundry/Blueprint stubs.
class Field { constructor(...args) { this.args=args; } }
const fieldProxy = new Proxy({}, {get:()=>Field});
globalThis.foundry = {
  utils:{getProperty,setProperty,deepClone,randomID:()=>"abcdefgh",escapeHTML:String,mergeObject:(a,b)=>Object.assign({},a,b),getDocumentClass:()=>globalThis.Item},
  data:{fields:fieldProxy}, abstract:{TypeDataModel:class{},DataModel:class{}},
  applications:{api:{ApplicationV2:class{},HandlebarsApplicationMixin:Base=>Base,DialogV2:class{}}}
};
globalThis.Actor=class Actor{}; globalThis.Item=class Item{}; globalThis.ActiveEffect=class{};
globalThis.Application=class{}; globalThis.FormApplication=class{};
globalThis.Hooks={on(){},once(){},off(){},call(){},callAll(){}};
globalThis.CONFIG={SD:{currencies:[]},Actor:{documentClass:Actor},Item:{documentClass:Item}};
globalThis.CONST={DOCUMENT_OWNERSHIP_LEVELS:{OWNER:3},CHAT_MESSAGE_TYPES:{OTHER:0}};
globalThis.game={settings:{get:()=>({database:[]}),set:async()=>{}},i18n:{localize:key=>key,format:key=>key},user:{id:"gm",isGM:true,targets:new Set()},users:[],actors:new Map(),items:new Map(),modules:new Map(),scenes:new Map()};
globalThis.ui={notifications:{warn(){},info(){},error(){}}}; globalThis.canvas={tokens:{controlled:[],get:()=>null},scene:null};
globalThis.fromUuid=async()=>null; globalThis.fromUuidSync=()=>null; globalThis.renderTemplate=async()=>""; globalThis.fetch=async()=>({ok:false});
globalThis.TextEditor={enrichHTML:async value=>value}; globalThis.loadTemplates=async()=>{}; globalThis.Dialog=class{}; globalThis.FilePicker=class{};
globalThis.document={getElementById:()=>null,createElement:()=>({style:{},appendChild(){}}),head:{appendChild(){}},body:{appendChild(){}}};

const nodes=new Map(), tokens=new Map(), actions=new Map();
globalThis.SD={nodeRegistry:{registerNode:(id,def)=>nodes.set(id,def),registerCategory(){}}};
globalThis.SD_NODE_RUNTIME={registerToken:(prefix,handler)=>tokens.set(prefix,handler),registerAction:(type,handler)=>actions.set(type,handler)};
const styleNodes=await import("../module/builder/style-nodes.mjs");
styleNodes.initStyleNodes();
for (const id of ["style_get_widget","style_set_widget","style_get_sheet","style_set_sheet","style_get_tab","style_set_tab"]) assert.ok(nodes.has(id), `missing ${id}`);
assert.equal(nodes.get("style_get_widget").computeDynamicOutputs({data:{property:"boxH"}})[0].type,"value.number");
assert.equal(nodes.get("style_get_sheet").computeDynamicOutputs({data:{property:"tabLabels"}})[0].type,"value.bool");

const actor={system:{sheetStyle:{},customTabs:[{id:"main",label:"Main",rows:[{widgets:[{id:"hp-id",widgetKey:"hp",type:"number",label:"HP"}]}]}]},async update(changes){for(const [path,value] of Object.entries(changes))setProperty(this,path,value);}};
await actions.get("sdSetWidgetStyle")({actor,action:{widgetKey:"b64:aHA=",property:"boxH",operation:"set",value:"132"},resolveValue:async value=>value});
assert.equal(actor.system.customTabs[0].rows[0].widgets[0].boxH,132);
assert.equal(tokens.get("sdWidgetStyle:")("boxH:b64:aHA=",{actor}),132);
await actions.get("sdSetSheetStyle")({actor,action:{property:"layout",operation:"set",value:"tabs-left"},resolveValue:async value=>value});
assert.equal(actor.system.sheetStyle.layout,"tabs-left");
await actions.get("sdSetTabStyle")({actor,action:{tabKey:"b64:bWFpbg==",property:"emoji",operation:"set",value:"⚔️"},resolveValue:async value=>value});
assert.equal(actor.system.customTabs[0].emoji,"⚔️");

// Height now wins over previous external !important defaults.
const renderer=read("module/builder/widget-renderer.mjs");
const widgetCss=read("styles/sd-widget-modern.css");
assert.ok(renderer.includes("height:var(--sd-widget-height)!important"));
assert.ok(widgetCss.includes("height: var(--sd-widget-height, 60px) !important"));
assert.ok(widgetCss.includes("height: var(--sd-widget-height, 104px) !important"));
assert.ok(renderer.includes("_decorateWidgetLabel"));
assert.ok(read("module/builder/widget-config-popup.mjs").includes('"Label emoji","labelEmoji","style-text"'));

// Present Roll exposes dynamic Label/Text pins and Message Composer exposes Roll Result + fields.
const graphSource=read("module/builder/formula-graph.mjs");
assert.ok(graphSource.includes('{id:"text",label:"Roll text",type:"value.string"}'));
assert.ok(graphSource.includes('text:inp.text??n.data.text??""'));
assert.ok(graphSource.includes('{key:"includeRoll",label:"Embed Present Roll",type:"bool"'));
assert.ok(graphSource.includes('return control ? `{__messageField:${control.id}}` : null'));
assert.ok(read("module/helpers/button-executor.mjs").includes("sd-message-composer-roll"));
assert.ok(read("sd.mjs").includes('runtime.__messageFields = { ...(runtime.__messageFields ?? {}), ...messageFields }'));

// Deferred button actions retain live field tokens, including embedded strings.
const deferred=materializeDeferredActionSnapshot({type:"message",messageParts:["Answer: {__messageField:field0}"]},()=>"WRONG-SNAPSHOT");
assert.equal(deferred.messageParts[0],"Answer: {__messageField:field0}");

// Compile a real mini graph: the dynamic value output remains a click-time token.
const { FormulaGraph }=await import("../module/builder/formula-graph.mjs");
const graph=Object.create(FormulaGraph.prototype);
graph.nodes=[
  {id:"composer",type:"act_message_composer",data:{title:"Prompt",includeRoll:true,buttons:[{id:"btn0",enabled:true,label:"Submit",icon:"fas fa-check",variant:"primary"}],controls:[{id:"field0",enabled:true,label:"Answer",type:"text",defaultValue:"",placeholder:"Type",options:"",required:true}]}},
  {id:"message",type:"act_message",data:{message:"Chosen:"}}
];
graph.edges=[
  {id:"exec",fromNode:"composer",fromPin:"btn0",toNode:"message",toPin:"exec"},
  {id:"value",fromNode:"composer",fromPin:"field0",toNode:"message",toPin:"text0"}
];
const compiled=JSON.parse(graph._compileExecChain("composer"));
assert.equal(compiled[0].type,"messageComposer");
assert.equal(compiled[0].includeRoll,true);
assert.equal(compiled[0].controls[0].id,"field0");
assert.equal(compiled[0].btn0Actions[0].messageParts[1],"{__messageField:field0}");
assert.equal(compiled[0].rollResult,"{__rollResult}");

// Execute the composer once: roll, form and buttons must share one ChatMessage.
const createdMessages=[];
globalThis.ChatMessage=class ChatMessage { static getSpeaker(){return{};} static async create(data){createdMessages.push(data);return{id:"message-id"};} };
globalThis.Roll=class Roll {};
const { ButtonExecutor }=await import("../module/helpers/button-executor.mjs");
await ButtonExecutor._runAction({
  type:"messageComposer", title:"One card", message:"Choose", includeRoll:true,
  rollResult:{type:"sd.roll-result",formula:"2d6",total:9,dice:[4,5]},
  controls:[
    {id:"field0",type:"text",label:"Name",defaultValue:"A",placeholder:"Text",required:true},
    {id:"field1",type:"number",label:"Amount",defaultValue:2},
    {id:"field2",type:"textarea",label:"Notes",defaultValue:"Hello"},
    {id:"field3",type:"select",label:"Mode",defaultValue:"b",options:"Alpha|a, Beta|b"},
    {id:"field4",type:"checkbox",label:"Confirm",defaultValue:true}
  ],
  buttons:[{id:"btn0",label:"Submit",icon:"fas fa-check",variant:"primary"}], btn0Actions:[]
},null,actor,{},{});
assert.equal(createdMessages.length,1,"embedded roll and form are posted as one message");
const runtimeCard=createdMessages[0];
assert.match(runtimeCard.content,/sd-message-composer-roll/);
assert.match(runtimeCard.content,/sd-message-roll-total[^>]*>9</);
for(const id of ["field0","field1","field2","field3","field4"])assert.match(runtimeCard.content,new RegExp(`data-sd-message-field="${id}"`));
assert.match(runtimeCard.content,/data-sd-message-button="btn0"/);
assert.equal(runtimeCard.flags.sd.messageComposer.version,2);
assert.equal(runtimeCard.flags.sd.messageComposer.rollResult.total,9);

assert.ok(read("module/data/actor-character.mjs").includes("sheetStyle: new ObjectField"));
assert.ok(read("templates/actor/sheet-header.hbs").includes('data-action="openSheetAppearance"'));
assert.ok(read("system.json").includes("styles/sd-sheet-layouts.css"));
console.log("PASS: sheet presets, style nodes, Height, Present Roll text, embedded roll and dynamic Message Composer fields (1.12.0).");
