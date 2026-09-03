import assert from "node:assert/strict";
const store=new Map([["sd.effectPresets",{}],["sd.allowPlayerEffectApplier",true],["sd.localizationLanguages",[{id:"base",name:"Base",enabled:true,primary:true}]],["sd.localizationLanguage","base"],["sd.translationEditLanguage","base"]]);
class App {constructor(){this.element=null;}render(){this.rendered=true;return this;} }
class Dialog {static async confirm(){return true;}}
globalThis.foundry={applications:{api:{ApplicationV2:App,DialogV2:Dialog}},utils:{deepClone:v=>structuredClone(v),randomID:()=>"preset123"}};
globalThis.game={user:{isGM:true},settings:{register:(m,k,c)=>{if(!store.has(`${m}.${k}`))store.set(`${m}.${k}`,structuredClone(c.default));},get:(m,k)=>store.get(`${m}.${k}`),set:async(m,k,v)=>(store.set(`${m}.${k}`,structuredClone(v)),v)}};
globalThis.ui={notifications:{info(){},warn(){}}};globalThis.Hooks={callAll(){}};
let created=[];
const makeActor=()=>({isOwner:true,effects:[],async createEmbeddedDocuments(type,docs){created.push({type,docs});return docs;},async updateEmbeddedDocuments(type,docs){created.push({type,docs,update:true});return docs;},async deleteEmbeddedDocuments(type,ids){created.push({type,ids,deleted:true});return ids;}});
const actor=makeActor();const actor2=makeActor();
// The same actor selected twice must only receive the effect once.
globalThis.canvas={tokens:{controlled:[{actor},{actor},{actor:actor2}]}};
const E=await import("../module/helpers/effect-applier.mjs");E.registerEffectApplierSettings();
const app=new E.EffectApplierApp();app._presets={p1:{id:"p1",name:"Bless",description:"",icon:"icons/svg/aura.svg",disabled:false,transfer:false,duration:{rounds:2,seconds:0},changes:[{key:"system.test",mode:2,value:"1",priority:20}],i18n:{}}};app._selected="p1";
await app._apply();
assert.equal(created.length,2,"two distinct actors, duplicates removed");assert.equal(created[0].type,"ActiveEffect");assert.equal(created[0].docs[0].changes[0].key,"system.test");assert.equal(created[0].docs[0].flags.sd.effectPresetId,"p1");
created=[];await app._run("remove");assert.equal(created.length,0,"nothing to remove when no effect is present");
actor.effects=[{id:"e1",disabled:false,flags:{sd:{effectPresetId:"p1"}},getFlag:(s,k)=>s==="sd"&&k==="effectPresetId"?"p1":undefined}];
created=[];await app._run("remove");assert.equal(created[0]?.deleted,true,"remove deletes the preset effect");
created=[];await app._run("toggle");assert.equal(created[0]?.update,true,"toggle flips the existing effect");
actor.effects=[];
game.user.isGM=false;actor.isOwner=false;actor2.isOwner=false;created=[];await app._apply();assert.equal(created.length,0,"players must not apply to unowned actors");
console.log("Effect Applier 0.19.0 regression: OK");
