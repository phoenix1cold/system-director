import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

globalThis.game={settings:{get:()=>({database:{values:[
  {id:"hp",name:"HP",type:"number",scope:"actor",initial:10},
  {id:"charges",name:"Charges",type:"integer",scope:"item",initial:0},
  {id:"note",name:"Note",type:"text",scope:"both",initial:""}
]}})}};
globalThis.foundry={utils:{deepClone:value=>structuredClone(value),getProperty:(object,path)=>String(path).split(".").reduce((value,key)=>value?.[key],object)}};
const db=await import("../module/helpers/value-database.mjs");
assert.deepEqual(db.valueSelectOptionsForScope("actor").slice(1).map(entry=>entry.value),["hp","note"]);
assert.deepEqual(db.valueSelectOptionsForScope("item").slice(1).map(entry=>entry.value),["charges","note"]);
const graph=await readFile(new URL("../module/builder/formula-graph.mjs",import.meta.url),"utf8");
const executor=await readFile(new URL("../module/helpers/button-executor.mjs",import.meta.url),"utf8");
assert.match(graph,/Actor — self \/ item owner/);
assert.match(graph,/Owned Item — from current actor/);
assert.match(graph,/valueSelectOptionsForScope\(scope\)/);
assert.match(graph,/itemId:n\.data\?\.itemId/);
assert.match(executor,/action\.source==="owned item"/);
assert.match(executor,/definition\.scope!=="both"/);
assert.match(executor,/wired Actor \/ Item Ref always wins/);
console.log("PASS: Set Value target picker, owned items, references and scope guard (2.2.0)");
