import assert from "node:assert/strict";
import fs from "node:fs";

globalThis.document = {
  getElementById() { return {}; },
  createElement() { return { textContent:"", style:{}, appendChild() {} }; },
  head:{ appendChild() {} },
  body:{ appendChild() {} }
};
globalThis.window = globalThis;
globalThis.Actor = class Actor {};
globalThis.Item = class Item {};
globalThis.foundry = { utils:{
  getProperty() {},
  setProperty() {},
  deepClone:value => structuredClone(value),
  randomID:() => "id"
} };
let graphLanguage = "en";
globalThis.game = {
  user:{ targets:new Set() },
  users:{ contents:[] },
  actors:{ contents:[] },
  settings:{ get:(_scope, key) => key === "nodeGraphLanguage" ? graphLanguage : undefined },
  i18n:{ localize:key => key, has:() => false }
};
globalThis.canvas = { tokens:{ controlled:[], placeables:[] } };
globalThis.fromUuidSync = () => null;
globalThis.fetch = async url => {
  const lang = String(url).endsWith("/ru.json") ? "ru" : "en";
  const data = JSON.parse(fs.readFileSync(new URL(`../lang/${lang}.json`, import.meta.url), "utf8"));
  return { ok:true, json:async () => data };
};

const { FormulaGraph, NODE_DEFS, _loadNodeGraphLangs } = await import("../module/builder/formula-graph.mjs");
await _loadNodeGraphLangs();
const graph = Object.create(FormulaGraph.prototype);
graph.nodes = [];
graph.edges = [];

// New function nodes expose all pins dynamically. They must not be mistaken
// for disconnected entry points by the debugger.
const fnNode = {
  id:"fn",
  type:"function_call",
  data:{},
  __sig:{ inputs:[{id:"amount",label:"Amount",type:"value.number"}], outputs:[] }
};
const fnInputs = graph._dbgInputPins(fnNode, NODE_DEFS.function_call);
assert.ok(fnInputs.some(pin => pin.id === "_exec" && pin.type === "exec"));
assert.ok(fnInputs.some(pin => pin.id === "amount" && pin.type === "value.number"));
assert.ok(graph._dbgExecInPins(fnNode, NODE_DEFS.function_call).has("_exec"));

// Dynamic value pins used by Message and similar newer nodes participate in
// the same compile check as static inputs.
const messageNode = { id:"msg", type:"act_message", data:{} };
const messageInputs = graph._dbgInputPins(messageNode, NODE_DEFS.act_message);
assert.ok(messageInputs.some(pin => pin.id === "text0"));
assert.ok(messageInputs.some(pin => pin.id === "text9"));

// compilePin-only sources (Quest, Cards, Scene, etc.) must be dry-compiled.
const questNode = { id:"quest", type:"quest_status", data:{ questId:"quest-1" } };
graph.nodes = [questNode];
graph.edges = [];
assert.deepEqual(graph._debugEvalNode(questNode), { ok:true });

// Broken dynamic/value source wires should be reported, not silently ignored.
const notifyNode = { id:"notify", type:"act_notify", data:{} };
graph.nodes = [notifyNode];
graph.edges = [{ id:"broken", fromNode:"missing", fromPin:"v", toNode:"notify", toPin:"text" }];
const broken = graph._debugEvalNode(notifyNode);
assert.equal(broken.ok, false);
assert.equal(broken.msg, "Broken wire: source node not found");

// Debug follows the dedicated Node Graph language setting, not Foundry's
// interface language independently of that setting.
graphLanguage = "en";
assert.equal(graph._dbgT("Button"), "Debug");
assert.equal(graph._dbgT("Title"), "Graph Debug — dry run");
graphLanguage = "ru";
assert.equal(graph._dbgT("Button"), "Отладка");
assert.equal(graph._dbgT("Title"), "Отладка графа — пробный запуск");

console.log("Graph Debug 0.19.0 dynamic-node and graph-language regression: OK");
