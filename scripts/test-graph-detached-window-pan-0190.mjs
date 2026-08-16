import assert from "node:assert/strict";
import fs from "node:fs";

globalThis.document = {
  getElementById(){ return {}; },
  createElement(){ return { textContent:"", style:{}, appendChild(){} }; },
  head:{ appendChild(){} }, body:{ appendChild(){}, contains(){ return true; } }
};
globalThis.window = globalThis;
globalThis.Actor = class Actor {};
globalThis.Item = class Item {};
globalThis.foundry = { utils:{ getProperty(){}, setProperty(){}, deepClone:value=>structuredClone(value), randomID:()=>"id" } };
globalThis.game = { user:{targets:new Set()}, users:{contents:[]}, actors:{contents:[]}, settings:{get(){}}, i18n:{localize:key=>key,has:()=>false} };
globalThis.canvas = { tokens:{controlled:[],placeables:[]} };
globalThis.fromUuidSync = () => null;
globalThis.fetch = async () => ({ok:false,json:async()=>({})});

const { FormulaGraph } = await import("../module/builder/formula-graph.mjs");
const graph = Object.create(FormulaGraph.prototype);
const detachedView = { name:"detached" };
const detachedDoc = { defaultView:detachedView, body:{contains:()=>true} };
graph.win = { ownerDocument:detachedDoc };
assert.equal(graph._uiDocument(), detachedDoc, "graph must use the detached window document");
assert.equal(graph._uiWindow(), detachedView, "graph must use the detached window viewport");

const source = fs.readFileSync(new URL("../module/builder/formula-graph.mjs", import.meta.url), "utf8");
assert.match(source, /const nextDoc = win\.ownerDocument \?\? globalThis\.document/);
assert.match(source, /win\.addEventListener\("pointerdown", _syncEventDocument, true\)/);
assert.match(source, /wrap\.setPointerCapture\?\.\(ev\.pointerId\)/);
assert.match(source, /wrap\.releasePointerCapture\?\.\(ev\.pointerId\)/);
assert.match(source, /ev\.buttons === 0/);
assert.doesNotMatch(source, /ds = \{ x: ev\.clientX - win\.offsetLeft/);
assert.match(source, /cursor:default;user-select:none/);
console.log("Graph detached-window pan regression: OK");
