export const NODE_TYPE_MIGRATIONS = {

  attr_score: {
    newType: "attr_score_val"
  },

  for_loop: {
    newType: "act_loop",
    dataMap: (d) => ({ count: String(d?.count ?? 3), delay: "0" }),
    pinMapOut: { loop: "body" }
  },

  sequence4: {
    newType: "sequence",
    dataMap: (d) => ({ count: 4, ...(d ?? {}) }),
    pinMapOut: { a: "a0", b: "a1", c: "a2", d: "a3" }
  },

  actor_level: {
    newType: "get_path",
    dataMap: (d) => ({ path: d?.path ?? "system.advancement.level" })
  },

  condition_check: {
    newType: "has_effect",
    dataMap: (d) => ({
      name:   d?.effectName ?? "",
      target: d?.target ?? "actor"
    })
  },

  act_set_field: {
    newType: "act_modify",
    dataMap: (d) => ({
      where: d?.where ?? "self",
      path:  d?.path  ?? "system.hiddenFields.field",
      op:    "set"
    }),
    pinMapIn: { value: "amount" }
  }
};

/**
 * Pure function: walk {nodes, edges} and apply all registered migrations
 * in-place.  Safe to call multiple times -- migrated nodes are identified by
 * having the current type, so second passes are no-ops.
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
