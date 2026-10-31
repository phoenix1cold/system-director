import { resolveNodePins } from "./node-pin-resolver.mjs";

/** Stack-safe compilation of static, computed and expandable value pins.
 * Action compilePin describes a value, never executes its side effects.
 */
export function compileGraphValue(graph, node, visited, fromPin, definitions, isSpecial) {
  const nodes = new Map(graph.nodes.map(entry => [entry.id, entry]));
  const incoming = new Map();
  for (const edge of graph.edges) {
    let pins = incoming.get(edge.toNode);
    if (!pins) incoming.set(edge.toNode, pins = new Map());
    pins.set(edge.toPin, edge);
  }
  const active = new Set(visited), memo = new Map(), stack = [{ node, pin: fromPin }];
  let result;
  const finish = (frame, value) => {
    stack.pop();
    if (frame.entered) active.delete(frame.node.id);
    if (!frame.cyclic) {
      let pins = memo.get(frame.node.id);
      if (!pins) memo.set(frame.node.id, pins = new Map());
      pins.set(frame.pin, value);
    }
    if (stack.length) stack.at(-1).inputs[frame.target] = value;
    else result = value;
  };
  while (stack.length) {
    const frame = stack.at(-1), current = frame.node, def = definitions[current.type];
    if (!frame.entered) {
      if (active.has(current.id)) {
        for (const entry of stack) entry.cyclic = true;
        finish(frame, "0");
        continue;
      }
      const cached = memo.get(current.id);
      if (cached?.has(frame.pin)) { finish(frame, cached.get(frame.pin)); continue; }
      if (!def || isSpecial(current, def, frame.pin) || (def.isAction && !def.compilePin)) {
        finish(frame, graph._compileValueRecursive(current, active, frame.pin));
        continue;
      }
      frame.entered = true;
      active.add(current.id);
      frame.inputs = {};
      frame.dependencies = [];
      frame.index = 0;
      for (const pin of resolveNodePins(def, current, "input")) {
        if (pin.type === "exec") continue;
        const edge = incoming.get(current.id)?.get(pin.id), source = nodes.get(edge?.fromNode);
        if (source) frame.dependencies.push({ node: source, pin: edge.fromPin, target: pin.id });
      }
    }
    if (frame.index < frame.dependencies.length) { stack.push(frame.dependencies[frame.index++]); continue; }
    finish(frame, def.compilePin
      ? (def.compilePin(current, frame.inputs, frame.pin) ?? "0")
      : (def.compile?.(current, frame.inputs) ?? "0"));
  }
  return result;
}
