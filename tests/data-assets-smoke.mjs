import assert from "node:assert/strict";
globalThis.foundry={utils:{randomID:()=>"abcdefgh",deepClone:structuredClone,getProperty:(o,p)=>String(p).split(".").reduce((a,k)=>a?.[k],o)}};
globalThis.game={settings:{get:()=>({version:1,databases:[]})},user:{isGM:true}};
const db=await import("../module/helpers/shared-database.mjs");
const config=db.normalizeDatabaseConfig({databases:[
 {id:"states",name:"States",kind:"enum",storage:"world",records:[{id:"idle",name:"Idle",type:"text",default:"idle"}]},
 {id:"classes",name:"Classes",kind:"dataTable",records:[{id:"warrior",name:"Warrior",type:"object",default:{hp:12,role:"tank"}}]}
]});
assert.equal(config.databases[0].kind,"enum");assert.equal(config.databases[1].kind,"dataTable");
const oldGet=game.settings.get;game.settings.get=()=>config;
assert.equal(db.databaseSelectOptions("enum")[1].value,"states");
assert.equal(db.getEnumEntries("states")[0].id,"idle");
assert.deepEqual(db.readDataAsset("classes","warrior"),{hp:12,role:"tank"});
assert.equal(db.readDataAsset("classes","warrior","hp"),12);
game.settings.get=oldGet;
console.log("PASS: System Director Data Assets smoke tests");
