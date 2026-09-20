import assert from "node:assert/strict";

globalThis.document = { getElementById: () => ({}), createElement: () => ({ textContent: "", appendChild() {} }), head: { appendChild() {} } };
globalThis.window = { addEventListener() {} };
globalThis.Hooks = { once() {}, on() {}, callAll() {} };
globalThis.game = { settings: { get() {} }, i18n: { lang: "en" }, actors: [], items: [] };
globalThis.Actor = class {};
globalThis.Item = class {};
globalThis.foundry = { utils: { getProperty: (o, p) => String(p).split(".").reduce((v, k) => v?.[k], o), deepClone: structuredClone } };
globalThis.foundry.data = { fields: {} };
globalThis.foundry.applications = { api: { ApplicationV2: class {} } };

const { NODE_DEFS, SD_NODE_REGISTRY, FormulaGraph } = await import("../module/builder/formula-graph.mjs");
const { registerModelNodes, installModelActions } = await import("../module/three/model-nodes.mjs");
const { runNodeActionHandler, storeNodeResult, readNodeResult } = await import("../module/helpers/node-runtime-api.mjs");
const { FormulaEngine } = await import("../module/helpers/formula-engine.mjs");
const { modelURL, disposeModels, ModelViewer } = await import("../module/three/model-viewer.mjs");
const { ButtonExecutor } = await import("../module/helpers/button-executor.mjs");
registerModelNodes(SD_NODE_REGISTRY);

const defs = Object.entries(NODE_DEFS).filter(([key]) => key.startsWith("model3d_"));
assert.equal(defs.length, 9);
for (const [type, def] of defs) {
  const action = def.toAction({ id: type, data: {} });
  assert.equal(action.type, type);
  assert.equal(action.__resultNodeId, type);
  for (const side of ["inputs", "outputs"]) assert.equal(new Set(def[side].map(p => p.id)).size, def[side].length);
}

const graph = Object.create(FormulaGraph.prototype);
graph.nodes = [
  { id: "path", type: "literal_str", data: { value: "worlds/test/models/Куб 1.glb" } },
  { id: "open", type: "model3d_open", data: { viewerId: "first", title: "Куб" } },
  { id: "move", type: "model3d_transform", data: { ry: 45, scale: 2 } },
  { id: "reset", type: "model3d_reset", data: {} },
  { id: "close", type: "model3d_close", data: {} }
];
graph.edges = [
  { fromNode: "path", fromPin: "v", toNode: "open", toPin: "src" },
  ...[["open", "move"], ["move", "reset"], ["reset", "close"]].flatMap(([fromNode, toNode]) => [
    { fromNode, fromPin: "exec", toNode, toPin: "exec" },
    { fromNode, fromPin: "viewerId", toNode, toPin: "viewerId" }
  ])
];
const actions = JSON.parse(graph._compileExecChain("open"));
assert.equal(actions.length, 4);
assert.equal(actions[1].args.viewerId, "{__nodeResult:open|viewerId}");
assert.equal(graph._compileValue(graph.nodes[1], new Set(), "success"), "{__nodeResult:open|success}");

const records = new Map(), calls = [];
installModelActions(async () => ({
  async openModelViewer(args) {
    if (args.src === "missing.glb") throw new Error("404 model missing");
    calls.push(["open", args]);
    records.set(args.viewerId, { model: {}, transform: a => calls.push(["transform", a]), resetCamera: () => calls.push(["reset"]), animate: (...a) => calls.push(["animate", ...a]) });
  },
  getModelViewer: id => records.get(id),
  async closeModelViewer(id) { records.delete(id); }
}));
const runtime = {};
async function run(action) {
  const result = await runNodeActionHandler(action.type, { action, runtime, resolveValue: async value => {
    if (typeof value !== "string") return value;
    const match = value.match(/^\{__nodeResult:([^|}]+)\|([^}]+)\}$/);
    return match ? readNodeResult(runtime, match[1], match[2]) : FormulaEngine.evaluate(value, {});
  } });
  assert.equal(result.handled, true);
  storeNodeResult(runtime, action.__resultNodeId, result.value);
  return result.value;
}
for (const action of actions) assert.equal((await run(action)).success, true);
assert.equal(calls[0][1].src, "worlds/test/models/Куб 1.glb");
assert.equal(calls[0][1].title, "Куб");
assert.equal(calls[1][1].viewerId, "first");
assert.equal(calls[1][1].ry, 45);
assert.equal(calls[1][1].scale, 2);
assert.equal(records.size, 0);
const actualRuntime = {};
for (const action of actions) {
  const result = await ButtonExecutor._runAction(action, null, {}, {}, actualRuntime);
  assert.equal(result.success, true, result.error);
}
assert.equal(readNodeResult(actualRuntime, "move", "viewerId"), "first");
assert.equal(readNodeResult(actualRuntime, "close", "success"), true);
assert.equal((await run(actions[1])).success, false, "Closed viewer must fail transforms");
const failure = await run(NODE_DEFS.model3d_open.toAction({ id: "failed", data: { src: "missing.glb" } }));
assert.equal(failure.success, false);
assert.match(failure.error, /404/);
assert.equal(readNodeResult(runtime, "failed", "success"), false);
assert.equal((await run(actions[3])).success, true, "Close is idempotent");
assert.equal(modelURL("worlds/test/Куб.glb", "https://example.org/vtt/"), "https://example.org/vtt/worlds/test/%D0%9A%D1%83%D0%B1.glb");
assert.throws(() => modelURL("javascript:alert(1)", "https://example.org/"));
assert.throws(() => modelURL("https://example.org/test.obj"));
assert.throws(() => modelURL(""));

const count = { geometry: 0, material: 0, texture: 0, image: 0 };
const geometry = { dispose: () => count.geometry++ };
const texture = { isTexture: true, dispose: () => count.texture++, source: { data: { close: () => count.image++ } } };
const material = { map: texture, normalMap: texture, dispose: () => count.material++ };
const root = { traverse: callback => { callback({ geometry, material: [material, material] }); callback({ geometry, material }); } };
disposeModels([root, root]);
assert.deepEqual(count, { geometry: 1, material: 1, texture: 1, image: 1 });

// Closing must release the caller immediately and dispose any eventual response.
const pending = new ModelViewer("pending");
let complete;
const loading = pending.loadModel({ loadAsync: () => new Promise(resolve => { complete = resolve; }) }, "https://example.org/test.glb");
pending.dispose();
await assert.rejects(loading, /closed/);
complete({ scenes: [root] });
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(count.geometry, 2);
pending.dispose();
assert.equal(count.geometry, 2, "Disposal must be idempotent");
console.log("PASS: nine 3D action nodes, real graph compilation and formula resolution, typed results, failures, URL validation and cancellation/disposal");
