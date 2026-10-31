import { resolveNodePins } from "./node-pin-resolver.mjs";

/** Conservative execution/data-flow checks. Values can pass through pure nodes
 * before reaching an action; a mere reachable producer is not sufficient.
 */
export function lintGraphFlow(nodes, edges, definitions) {
  const out = [], byId = new Map(nodes.map(node => [node.id, node]));
  const exec = new Map(), values = new Map(), predecessors = new Map();
  const add = (map, key, value) => { if (!map.has(key)) map.set(key, []); map.get(key).push(value); };
  for (const edge of edges) {
    const node = byId.get(edge.fromNode), def = definitions[node?.type];
    const pin = resolveNodePins(def, node, "output").find(pin => pin.id === edge.fromPin);
    if (!pin) continue;
    if (pin.type === "exec") {
      add(exec, edge.fromNode, edge);
      add(predecessors, edge.toNode, edge.fromNode);
    } else add(values, edge.fromNode, edge);
  }
  const entries = nodes.filter(node => {
    const def = definitions[node.type];
    return node.type === "on_click" || def?.isEvent || def?.isMacroInput || def?.isFunctionInputs;
  }).map(node => node.id);
  const reachable = new Set(entries), queue = [...entries];
  for (let index = 0; index < queue.length; index++) {
    for (const edge of exec.get(queue[index]) ?? []) {
      if (!reachable.has(edge.toNode)) { reachable.add(edge.toNode); queue.push(edge.toNode); }
    }
  }
  const dominators = new Map([...reachable].map(id => [id, entries.includes(id) ? new Set([id]) : new Set(reachable)]));
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of reachable) {
      if (entries.includes(id)) continue;
      const parents = (predecessors.get(id) ?? []).filter(parent => reachable.has(parent));
      let next = new Set(dominators.get(parents[0]) ?? []);
      for (const parent of parents.slice(1)) next = new Set([...next].filter(value => dominators.get(parent).has(value)));
      next.add(id);
      const old = dominators.get(id);
      if (old.size !== next.size || [...old].some(value => !next.has(value))) { dominators.set(id, next); changed = true; }
    }
  }
  const consumers = start => {
    const result = new Set(), seen = new Set(), pending = [start];
    while (pending.length) {
      const id = pending.pop();
      if (seen.has(id)) continue;
      seen.add(id);
      const def = definitions[byId.get(id)?.type];
      if (resolveNodePins(def, byId.get(id), "input").some(pin => pin.type === "exec")) result.add(id);
      else for (const edge of values.get(id) ?? []) pending.push(edge.toNode);
    }
    return result;
  };
  const reported = new Set();
  for (const producer of nodes) {
    const def = definitions[producer.type];
    if (!def) continue;
    for (const edge of values.get(producer.id) ?? []) {
      const sinks = consumers(edge.toNode);
      if (def.isAction && !def.valuePassthrough) {
        for (const sink of sinks) {
          if (!reachable.has(sink)) continue;
          if (sink !== producer.id && dominators.get(sink)?.has(producer.id)) continue;
          const key = `result:${producer.id}:${sink}`;
          if (reported.has(key)) continue;
          reported.add(key);
          out.push({ severity: "warn", code: "W007", nodeId: sink,
            message: `Result from ${producer.type}.${edge.fromPin} is not guaranteed before ${byId.get(sink)?.type}. Connect its execution path before the consumer.` });
        }
      }
      if (!def.isLoop) continue;
      // Loop values are runtime-scoped, including when accessed through pure nodes.
      const body = (exec.get(producer.id) ?? []).filter(edge => !["done", "exec"].includes(edge.fromPin));
      const scope = new Set(), pending = body.map(edge => edge.toNode);
      while (pending.length) {
        const id = pending.pop();
        if (id === producer.id || scope.has(id)) continue;
        scope.add(id);
        for (const next of exec.get(id) ?? []) pending.push(next.toNode);
      }
      for (const sink of sinks) {
        if (scope.has(sink)) continue;
        const key = `loop:${producer.id}:${sink}`;
        if (reported.has(key)) continue;
        reported.add(key);
        out.push({ severity: "warn", code: "W008", nodeId: sink,
          message: `Loop value ${producer.type}.${edge.fromPin} is used outside its body; Done restores the enclosing loop context.` });
      }
    }
  }
  return out;
}
