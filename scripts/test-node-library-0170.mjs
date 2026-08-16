import assert from "node:assert/strict";

globalThis.document={getElementById(){return{}},createElement(){return{textContent:"",style:{},appendChild(){},setAttribute(){},addEventListener(){},classList:{add(){},remove(){}}}},head:{appendChild(){}},body:{appendChild(){}}};
globalThis.window=globalThis;
globalThis.Actor=class Actor{}; globalThis.Item=class Item{};
function getProperty(o,p){return String(p).split('.').reduce((v,k)=>v?.[k],o)}
globalThis.foundry={utils:{getProperty,setProperty(o,p,v){const a=String(p).split('.');let c=o;for(const k of a.slice(0,-1))c=c[k]??={};c[a.at(-1)]=v;return true},deepClone:v=>structuredClone(v),randomID:()=>"id"}};
const selfActor=Object.assign(new Actor(),{id:"self",uuid:"Actor.self"});
const onlineActor=Object.assign(new Actor(),{id:"online",uuid:"Actor.online",hasPlayerOwner:true});
const offlineActor=Object.assign(new Actor(),{id:"offline",uuid:"Actor.offline",hasPlayerOwner:true});
const sceneActor=Object.assign(new Actor(),{id:"scene",uuid:"Actor.scene"});
globalThis.game={user:{character:onlineActor,targets:new Set()},users:{contents:[{isGM:false,active:true,character:onlineActor},{isGM:false,active:false,character:offlineActor}]},actors:{contents:[onlineActor,offlineActor]},i18n:{localize:k=>k,has:()=>false}};
globalThis.canvas={tokens:{controlled:[],placeables:[{actor:sceneActor}]}};
globalThis.fromUuidSync=()=>null;

const {NODE_DEFS,COMPOSITE_NODE_REPLACEMENTS}=await import("../module/builder/formula-graph.mjs");
const {FormulaEngine}=await import("../module/helpers/formula-engine.mjs");

assert.equal(NODE_DEFS.act_choice_from_array.cat,"Flow Control");
for(const id of ["convert_number","convert_text","convert_boolean","convert_array","is_valid"])assert.ok(NODE_DEFS[id],id);
assert.equal(FormulaEngine.evaluate(NODE_DEFS.convert_number.compile({data:{default:7}},{value:'"42"'}),selfActor),42);
assert.equal(FormulaEngine.evaluate(NODE_DEFS.convert_number.compile({data:{default:7}},{value:'"nope"'}),selfActor),7);
assert.equal(FormulaEngine.evaluate(NODE_DEFS.convert_text.compile({data:{}},{value:'"hello"'}),selfActor),"hello");
assert.equal(FormulaEngine.evaluate(NODE_DEFS.convert_boolean.compile({data:{}},{value:'"off"'}),selfActor),0);
assert.equal(FormulaEngine.evaluate(NODE_DEFS.convert_boolean.compile({data:{}},{value:'"yes"'}),selfActor),1);
assert.equal(FormulaEngine.evaluate(NODE_DEFS.convert_array.compile({data:{}},{value:'"a,b,c"'}),selfActor),"a,b,c");
assert.equal(FormulaEngine.evaluate(NODE_DEFS.is_valid.compile({data:{}},{value:'"value"'}),selfActor),1);
assert.equal(FormulaEngine.evaluate(NODE_DEFS.is_valid.compile({data:{}},{value:'""'}),selfActor),0);

assert.equal(NODE_DEFS.get_actors_array.title,"Get Actors");
assert.deepEqual(FormulaEngine._collectTargetUuids("self_actor",selfActor),["Actor.self"]);
assert.deepEqual(FormulaEngine._collectTargetUuids("user_character",selfActor),["Actor.online"]);
assert.deepEqual(FormulaEngine._collectTargetUuids("players_online",selfActor),["Actor.online"]);
assert.deepEqual(FormulaEngine._collectTargetUuids("players_all",selfActor).sort(),["Actor.offline","Actor.online"]);
assert.deepEqual(FormulaEngine._collectTargetUuids("scene",selfActor),["Actor.scene"]);
assert.equal(NODE_DEFS.get_all_targets.hidden,true);
assert.equal(NODE_DEFS.get_player_actors.hidden,true);

const addAction=NODE_DEFS.act_add_item.toAction({data:{uuid:"Item.static",qty:1,inventoryWidget:""}},{items:"Item.a,Item.b",qty:2});
assert.equal(addAction.type,"createItemArray");assert.equal(addAction.items,"Item.a,Item.b");assert.equal(addAction.qty,2);
const removeAction=NODE_DEFS.act_remove_item.toAction({data:{uuid:"",itemName:"Sword",inventoryWidget:""}},{items:"Item.a,Item.b"});
assert.equal(removeAction.type,"removeItemArray");assert.equal(removeAction.items,"Item.a,Item.b");
assert.equal(NODE_DEFS.act_add_item_array.hidden,true);assert.equal(NODE_DEFS.act_remove_item_array.hidden,true);

for(const [legacy,ids] of Object.entries(COMPOSITE_NODE_REPLACEMENTS)){
 assert.equal(NODE_DEFS[legacy]?.hidden,true,`${legacy} must remain hidden legacy`);
 for(const id of ids)assert.ok(NODE_DEFS[id],`${legacy} replacement ${id}`);
}
const src=await import("node:fs").then(fs=>fs.readFileSync(new URL("../module/builder/formula-graph.mjs",import.meta.url),"utf8"));
assert.match(src,/\{id:"Conversion",\s+color:"#2f8a72"\}/);
console.log("Node library 0.17.0 composition and cleanup tests: OK");
