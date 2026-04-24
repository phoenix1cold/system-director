export const NODE_TYPE_MIGRATIONS = {

  attr_score: {
    newType: "attr_score_val"
    // fields/pins identical → no data/pin remap needed
  },

  for_loop: {
    newType: "act_loop",
    // field `count` kept as-is; act_loop also supports `delay` (default "0")
    dataMap: (d) => ({ count: String(d?.count ?? 3), delay: "0" }),
    // output `loop` was renamed to `body`; `done`, `index` unchanged
    pinMapOut: { loop: "body" }
  },

  sequence4: {
    newType: "sequence",
    // sequence uses a `count` field that caps how many `aN` pins render
    dataMap: (d) => ({ count: 4, ...(d ?? {}) }),
    // sequence4 used a/b/c/d; sequence uses a0..a3
    pinMapOut: { a: "a0", b: "a1", c: "a2", d: "a3" }
  },

  actor_level: {
    newType: "get_path",
    dataMap: (d) => ({ path: d?.path ?? "system.advancement.level" })
  },

  condition_check: {
    newType: "has_effect",
    // has_effect field name is `name`, not `effectName`; target values align
    // (both accept "actor" and "token_target"; has_effect also allows "self"/"selected_token")
    dataMap: (d) => ({
      name:   d?.effectName ?? "",
      target: d?.target ?? "actor"
    })
    // outputs: both expose the bool on pin id "v"
  },

  act_set_field: {
    newType: "act_modify",
    dataMap: (d) => ({
      where: d?.where ?? "self",
      path:  d?.path  ?? "system.hiddenFields.field",
      op:    "set"
    }),
    // act_set_field has input pin `value` carrying the new value;
    // act_modify uses `amount` for the same role (op="set" → setValue)
    pinMapIn: { value: "amount" }
    // outputs: both expose exec + newValue -- identical pin ids
  }
};

/**

 *
 * @param {{nodes: Array, edges: Array}} graph
 * @returns {{changed: number}} statistics
 */
export function migrateGraph(graph) {
  if (!graph || !Array.isArray(graph.nodes)) return { changed: 0 };
  const edges = Array.isArray(graph.edges) ? graph.edges : [];

  let changed = 0;

  for (const node of graph.nodes) {
    const rule = NODE_TYPE_MIGRATIONS[node?.type];
    if (!rule) continue;

    const oldType = node.type;
    const oldData = node.data ?? {};

    // Rewrite type + data
    node.type = rule.newType;
    node.data = rule.dataMap ? rule.dataMap(oldData) : { ...oldData };
    changed++;

    // Rewrite edges whose pin ids changed
    if (rule.pinMapIn || rule.pinMapOut) {
      for (const edge of edges) {
        if (edge.toNode === node.id && rule.pinMapIn && rule.pinMapIn[edge.toPin]) {
          edge.toPin = rule.pinMapIn[edge.toPin];
        }
        if (edge.fromNode === node.id && rule.pinMapOut && rule.pinMapOut[edge.fromPin]) {
          edge.fromPin = rule.pinMapOut[edge.fromPin];
        }
      }
    }
  }

  return { changed };
}

export function isLegacyNodeType(type) {
  return Object.prototype.hasOwnProperty.call(NODE_TYPE_MIGRATIONS, type);
}
