import { pinSubtype, arePinsCompatible } from "./pin-types.mjs";
import { isLegacyNodeType }              from "./node-migration.mjs";

export function lintGraph(graph, NODE_DEFS) {
  const out   = [];
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];
  const byId  = new Map(nodes.map(n => [n.id, n]));

  for (const n of nodes) {
    if (isLegacyNodeType(n.type)) {
      out.push({ severity:"error", code:"E002", nodeId:n.id,
        message:`Deprecated node type "${n.type}" — should have been auto-migrated. Reload the graph to retrigger migration.` });
      continue;
    }
    if (!NODE_DEFS[n.type]) {
      out.push({ severity:"error", code:"E001", nodeId:n.id,
        message:`Unknown node type "${n.type}". Was it removed or provided by a missing module?` });
    }
  }

  for (const e of edges) {
    const from = byId.get(e.fromNode);
    const to   = byId.get(e.toNode);
    if (!from || !to) {
      out.push({ severity:"error", code:"E004",
        message:`Dangling edge ${e.fromNode}.${e.fromPin} → ${e.toNode}.${e.toPin}` });
      continue;
    }
    const fromDef = NODE_DEFS[from.type];
    const toDef   = NODE_DEFS[to.type];
    const fromPin = fromDef?.outputs?.find(p => p.id === e.fromPin);
    const toPin   = toDef?.inputs?.find(p => p.id === e.toPin);
    if (!fromPin || !toPin) {
      if (!fromDef?.dynamicPins && !toDef?.dynamicPins) {
        out.push({ severity:"warn", code:"E004",
          message:`Edge references missing pin: ${from.type}.${e.fromPin} → ${to.type}.${e.toPin}` });
      }
      continue;
    }
    if (!arePinsCompatible(fromPin.type, toPin.type)) {
      out.push({ severity:"error", code:"E003", nodeId:to.id,
        message:`Incompatible pin types on edge ${from.type}.${e.fromPin} (${pinSubtype(fromPin.type)}) → ${to.type}.${e.toPin} (${pinSubtype(toPin.type)})` });
    }
  }

  const hasEntry = nodes.some(n => {
    const def = NODE_DEFS[n.type];
    return n.type === "on_click" || def?.isEvent || def?.isMacroInput;
  });
  const hasOutput = nodes.some(n => n.type === "output");
  if (!hasEntry && !hasOutput && nodes.length > 0) {
    out.push({ severity:"warn", code:"W001",
      message:"Graph has no entry point (no on_click, event node, macro input, or Output sink)." });
  }

  const touched = new Set();
  for (const e of edges) { touched.add(e.fromNode); touched.add(e.toNode); }
  for (const n of nodes) {
    if (touched.has(n.id)) continue;
    const def = NODE_DEFS[n.type];
    if (def?.isEvent || def?.isMacroInput || n.type === "on_click") continue;
    out.push({ severity:"info", code:"W002", nodeId:n.id,
      message:`Orphan node "${n.type}" — not connected to anything.` });
  }

  return out;
}

export function lintSummary(report) {
  const c = { error:0, warn:0, info:0 };
  for (const r of report) c[r.severity] = (c[r.severity] ?? 0) + 1;
  return `${c.error} errors, ${c.warn} warnings, ${c.info} notes`;
}
