/** 2.1.5 — Set Value target-aware picker and actual runtime resolution. */
import assert from "node:assert/strict";
import fs from "node:fs";

const getProperty=(object,path)=>String(path??"").split(".").reduce((value,key)=>value?.[key],object);
const setProperty=(object,path,value)=>{
  const parts=String(path).split("."); let cursor=object;
  for(const key of parts.slice(0,-1))cursor=cursor[key]??={};
  cursor[parts.at(-1)]=value; return true;
};
class Field{constructor(...args){this.args=args;}}
class Actor{
  constructor(id,name){this.id=id;this.uuid=`Actor.${id}`;this.name=name;this.documentName="Actor";this.system={values:{}};this.isOwner=true;this.updates=[];}
  async update(patch){this.updates.push(patch);for(const [path,value] of Object.entries(patch))setProperty(this,path,value);}
}
class Item{
  constructor(id,name,actor=null){this.id=id;this.uuid=actor?`${actor.uuid}.Item.${id}`:`Item.${id}`;this.name=name;this.documentName="Item";this.type="inventory";this.actor=actor;this.parent=actor;this.system={values:{}};this.isOwner=true;this.updates=[];}
  async update(patch){this.updates.push(patch);for(const [path,value] of Object.entries(patch))setProperty(this,path,value);}
}
const DB=[
  {id:"strength",name:"Strength",type:"number",scope:"actor",initial:10},
  {id:"weight",name:"Weight",type:"number",scope:"item",initial:1},
  {id:"currency",name:"Currency",type:"number",scope:"both",initial:0}
];
const warnings=[];
globalThis.Actor=Actor; globalThis.Item=Item; globalThis.ActiveEffect=class {};
globalThis.foundry={
  utils:{getProperty,setProperty,deepClone:value=>structuredClone(value),mergeObject:(a,b)=>({...a,...b}),randomID:()=>"id",getDocumentClass:()=>Item},
  data:{fields:{StringField:Field,NumberField:Field,BooleanField:Field,ArrayField:Field,ObjectField:Field,SchemaField:Field}},
  applications:{api:{ApplicationV2:class {},HandlebarsApplicationMixin:Base=>Base,DialogV2:class {}}}
};
globalThis.Application=class {};globalThis.FormApplication=class {};
globalThis.Hooks={on:()=>0,once:()=>0,off(){},call(){},callAll(){}};
globalThis.CONFIG={SD:{currencies:[]},Actor:{documentClass:Actor},Item:{documentClass:Item}};
globalThis.CONST={DOCUMENT_OWNERSHIP_LEVELS:{OWNER:3},CHAT_MESSAGE_TYPES:{OTHER:0}};
globalThis.ui={notifications:{warn:message=>warnings.push(String(message)),info(){},error(){}}};
globalThis.canvas={tokens:{controlled:[],get:()=>null},scene:null};
globalThis.renderTemplate=async()=>"";globalThis.fetch=async()=>({ok:false});
globalThis.TextEditor={enrichHTML:async value=>value};globalThis.loadTemplates=async()=>{};
globalThis.Dialog=class {};globalThis.FilePicker=class {};globalThis.AudioHelper={play(){}};
globalThis.ChatMessage=class {static getSpeaker(){return {};}static async create(){return null;}};
globalThis.Roll=class {constructor(){this.total=0;this.terms=[];}async evaluate(){return this;}};
globalThis.document={getElementById:()=>null,createElement:()=>({style:{},appendChild(){}}),head:{appendChild(){}},body:{appendChild(){}}};

const hero=new Actor("A1","Hero");
const sword=new Item("I1","Iron Sword",hero);
const potion=new Item("I2","Potion",hero);
hero.items={contents:[sword,potion],get:id=>[sword,potion].find(item=>item.id===id)??null};
const uuidDocs=new Map([[hero.uuid,hero],[sword.uuid,sword],[potion.uuid,potion]]);
globalThis.fromUuid=async uuid=>uuidDocs.get(uuid)??null;
globalThis.fromUuidSync=uuid=>uuidDocs.get(uuid)??null;
globalThis.game={
  settings:{get:()=>({database:DB}),set:async()=>{}},i18n:{localize:key=>key,format:key=>key},
  user:{targets:new Set(),isGM:true,id:"u"},users:[],modules:new Map(),scenes:new Map(),
  actors:{get:id=>id===hero.id?hero:null,getName:name=>name===hero.name?hero:null},
  items:{get:()=>null,getName:()=>null}
};

const db=await import("../module/helpers/value-database.mjs");
const {ButtonExecutor}=await import("../module/helpers/button-executor.mjs");

// Picker scopes: compatible variables + shared values, never the wrong document scope.
const actorOptions=db.valueSelectOptionsForScope("actor",{selected:"strength"});
assert.ok(actorOptions.some(option=>option.value==="strength"));
assert.ok(actorOptions.some(option=>option.value==="currency"));
assert.ok(!actorOptions.some(option=>option.value==="weight"));
const itemOptions=db.valueSelectOptionsForScope("item",{selected:"weight"});
assert.ok(itemOptions.some(option=>option.value==="weight"));
assert.ok(itemOptions.some(option=>option.value==="currency"));
assert.ok(!itemOptions.some(option=>option.value==="strength"));
assert.match(db.valueSelectOptionsForScope("actor",{selected:"weight"}).find(option=>option.value==="weight")?.label??"",/incompatible target/);

// Auto follows graph execution context: Actor graph -> Actor, Item graph -> Item.
await ButtonExecutor._runAction({type:"setDatabaseValue",source:"self",variableId:"strength",operation:"set",value:"14"},null,hero,{},{});
assert.equal(hero.system.values.strength,14);
await ButtonExecutor._runAction({type:"setDatabaseValue",source:"self",variableId:"weight",operation:"set",value:"3"},sword,hero,{},{});
assert.equal(sword.system.values.weight,3);

// Item graph can explicitly modify its owning Actor.
await ButtonExecutor._runAction({type:"setDatabaseValue",source:"actor",variableId:"strength",operation:"add",value:"2"},sword,hero,{},{});
assert.equal(hero.system.values.strength,16);

// Actor graph can select a concrete owned Item without wiring a UUID.
await ButtonExecutor._runAction({type:"setDatabaseValue",source:"owned item",itemId:"I2",variableId:"weight",operation:"set",value:"5"},null,hero,{},{});
assert.equal(potion.system.values.weight,5);

// Wired document refs have priority over the static target and keep object identity.
await ButtonExecutor._runAction(
  {type:"setDatabaseValue",source:"actor",variableId:"weight",operation:"set",ref:"{__nodeResult:target|value}",value:"7"},
  null,hero,{}, {__nodeResults:{target:{value:sword}}}
);
assert.equal(sword.system.values.weight,7);

// Runtime scope guard prevents invalid writes even in old or dynamically wired graphs.
const before=sword.updates.length;
await ButtonExecutor._runAction({type:"setDatabaseValue",source:"item",variableId:"strength",operation:"set",value:"99"},sword,hero,{},{});
assert.equal(sword.updates.length,before);
assert.ok(warnings.some(message=>message.includes("belongs to actor")&&message.includes("target is item")));

const graph=fs.readFileSync(new URL("../module/builder/formula-graph.mjs",import.meta.url),"utf8");
assert.match(graph,/Auto — graph owner/);
assert.match(graph,/Owned Item — from current actor/);
assert.match(graph,/setValueVariableOptions/);
assert.match(graph,/edge\.toPin==="ref"/);
assert.match(graph,/itemId:n\.data\?\.itemId/);
const manifest=JSON.parse(fs.readFileSync(new URL("../system.json",import.meta.url),"utf8"));
assert.equal(manifest.version,"2.1.5");
console.log("PASS: Set Value picker, context targets, owned Items, wired refs, and scope guard (2.1.5).");
