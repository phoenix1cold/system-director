const STATE_KEY = Symbol.for("sd.nodeRuntimeRegistry");
const state = globalThis[STATE_KEY] ?? (globalThis[STATE_KEY] = {
  actions: new Map(),
  tokens: [],
  owners: new Map()
});

function ownerSet(owner) {
  const key = String(owner ?? "external");
  const set = state.owners.get(key) ?? new Set();
  state.owners.set(key, set);
  return { key, set };
}

export function registerNodeActionHandler(type, handler, { owner = "external" } = {}) {
  const id = String(type ?? "").trim();
  if (!id || typeof handler !== "function") throw new Error("SD runtime action requires a type and handler");
  state.actions.set(id, { handler, owner: String(owner) });
  ownerSet(owner).set.add(`action:${id}`);
  return () => { if (state.actions.get(id)?.handler === handler) state.actions.delete(id); };
}

export function registerFormulaTokenResolver(prefix, handler, { owner = "external" } = {}) {
  const id = String(prefix ?? "").trim();
  if (!id || typeof handler !== "function") throw new Error("SD formula resolver requires a prefix and handler");
  const record = { prefix: id, handler, owner: String(owner) };
  state.tokens = state.tokens.filter(entry => !(entry.prefix === id && entry.owner === record.owner));
  state.tokens.unshift(record);
  ownerSet(owner).set.add(`token:${id}`);
  return () => { state.tokens = state.tokens.filter(entry => entry !== record); };
}

export function unregisterNodeRuntimeExtension(ownerValue) {
  const owner = String(ownerValue ?? "");
  for (const [type, record] of state.actions) if (record.owner === owner) state.actions.delete(type);
  state.tokens = state.tokens.filter(record => record.owner !== owner);
  state.owners.delete(owner);
}

export async function runNodeActionHandler(type, context = {}) {
  const record = state.actions.get(String(type ?? ""));
  if (!record) return { handled: false, value: undefined };
  return { handled: true, value: await record.handler(context) };
}

/** Store a typed output record for a concrete graph node execution. */
export function storeNodeResult(runtime, nodeId, value) {
  const id = String(nodeId ?? "").trim();
  if (!runtime || typeof runtime !== "object" || !id) return value;
  const outputs = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : { value };
  runtime.__nodeResults ??= Object.create(null);
  runtime.__nodeResults[id] = outputs;
  runtime.__lastNodeResult = outputs;
  return value;
}

/** Read one output without coupling later nodes to a global "last result". */
export function readNodeResult(runtime, nodeId, outputId = "value") {
  const result = runtime?.__nodeResults?.[String(nodeId ?? "")];
  if (!result || typeof result !== "object") return undefined;
  return result[String(outputId ?? "value")];
}

export function resolveNodeFormulaToken(token, context = {}) {
  const raw = String(token ?? "");
  for (const record of state.tokens) {
    if (!raw.startsWith(record.prefix)) continue;
    return { handled: true, value: record.handler(raw.slice(record.prefix.length), { ...context, token: raw, prefix: record.prefix }) };
  }
  return { handled: false, value: undefined };
}

export function getNodeRuntimeSnapshot() {
  return {
    actions: [...state.actions.keys()],
    tokenPrefixes: state.tokens.map(entry => entry.prefix),
    owners: Object.fromEntries([...state.owners].map(([owner, entries]) => [owner, [...entries]]))
  };
}

globalThis.SD_NODE_RUNTIME = Object.freeze({
  registerAction: registerNodeActionHandler,
  registerToken: registerFormulaTokenResolver,
  unregisterExtension: unregisterNodeRuntimeExtension,
  snapshot: getNodeRuntimeSnapshot,
  storeResult: storeNodeResult,
  readResult: readNodeResult
});
