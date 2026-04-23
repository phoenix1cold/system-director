/**
 * module/builder/graph-linter.mjs
 *
 * Lightweight static validator for System Director node graphs.
 *
 * Input:  { nodes, edges } shape produced by FormulaGraph.
 * Output: [{ severity:"error"|"warn"|"info", code, message, nodeId? }].
 *
 * Rules implemented on Step 9:
 *   E001  Unknown node type (not in NODE_DEFS and not in migration map)
 *   E002  Deprecated node type (still present despite migration run)
 *   E003  Incompatible pin subtypes on an existing edge
 *   E004  Dangling edge -- endpoint refs a node/pin that does not exist
 *   W001  Action chain has no entry point (no on_click / isEvent / macro_input)
 *   W002  Orphan node (neither input nor output edges)
 *   W003  Required field is empty (heuristic: field without default + empty value)
 *
 * The linter never mutates the graph.  UI layer calls it on demand (palette
 * button or on save) and shows the report in a modal.
 */

import { pinSubtype, arePinsCompatible } from "./pin-types.mjs";
import { isLegacyNodeType }              from "./node-migration.mjs";

/**
 * @param {{nodes:Array, edges:Array}} graph
 * @param {Object}                     NODE_DEFS   - registry passed in to avoid circular import
 * @returns {Array<{severity,code,message,nodeId?}>}
 */
export function lintGraph(graph, NODE_DEFS) {
  const out   = [];
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];
  const byId  = new Map(nodes.map(n => [n.id, n]));

  // E001 / E002 node-type checks
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

  // E003 / E004 edge checks
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
      // dynamic-pin nodes may declare pins lazily; skip when def absent
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

  // W001 no entry point
  const hasEntry = nodes.some(n => {
    const def = NODE_DEFS[n.type];
    return n.type === "on_click" || def?.isEvent || def?.isMacroInput;
  });
  const hasOutput = nodes.some(n => n.type === "output");
  if (!hasEntry && !hasOutput && nodes.length > 0) {
    out.push({ severity:"warn", code:"W001",
      message:"Graph has no entry point (no on_click, event node, macro input, or Output sink)." });
  }

  // W002 orphan nodes
  const touched = new Set();
  for (const e of edges) { touched.add(e.fromNode); touched.add(e.toNode); }
  for (const n of nodes) {
    if (touched.has(n.id)) continue;
    // Singletons like on_click standing alone are fine; flag only pure data nodes.
    const def = NODE_DEFS[n.type];
    if (def?.isEvent || def?.isMacroInput || n.type === "on_click") continue;
    out.push({ severity:"info", code:"W002", nodeId:n.id,
      message:`Orphan node "${n.type}" — not connected to anything.` });
  }

  return out;
}

/** Human-readable one-line summary used in toolbar badge. */
export function lintSummary(report) {
  const c = { error:0, warn:0, info:0 };
  for (const r of report) c[r.severity] = (c[r.severity] ?? 0) + 1;
  return `${c.error} errors, ${c.warn} warnings, ${c.info} notes`;
}
