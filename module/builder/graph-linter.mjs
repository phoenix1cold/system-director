import { pinSubtype, arePinsCompatible } from "./pin-types.mjs";
import { isLegacyNodeType }              from "./node-migration.mjs";
import { resolveNodePin, resolveNodePins } from "./node-pin-resolver.mjs";

/** Field keys that can carry a widget reference on widget-aware nodes. */
const WIDGET_KEY_FIELDS = ["widgetKey", "key", "widget"];

/**
 * @param {object} graph
 * @param {object} NODE_DEFS
 * @param {object} [options]
 * @param {Array<string>} [options.widgetKeys] Keys/labels of widgets that exist
 *   on the document owning this graph. Enables the "widget not found" check.
 */
export function lintGraph(graph, NODE_DEFS, options = {}) {
  const out   = [];
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];
  const byId  = new Map(nodes.map(n => [n.id, n]));
  const edgeKeys = new Set();

  const norm = value => String(value ?? "").trim().toLowerCase();
  const widgetKeys = new Set((options?.widgetKeys ?? []).map(norm).filter(Boolean));

  for (const n of nodes) {
    if (isLegacyNodeType(n.type)) {
      out.push({ severity:"error", code:"E002", nodeId:n.id,
        message:`Deprecated node type "${n.type}" — should have been auto-migrated. Reload the graph to retrigger migration.` });
      continue;
    }
    const def = NODE_DEFS[n.type];
    if (!def) {
      out.push({ severity:"error", code:"E001", nodeId:n.id,
        message:`Unknown node type "${n.type}". Was it removed or provided by a missing module?` });
      continue;
    }

    // W005 - the node still works, but it is retired and no longer improved.
    // Widget-config and function anchors are internal by design, not retired.
    if (def.hidden && !def.isWidgetConfig && !def.isFunctionAnchor) {
      const replacements = Array.isArray(def.replacementNodes) ? def.replacementNodes : null;
      let advice = " It still runs, but it will not be improved further.";
      if (replacements?.length) {
        const titles = replacements.map(type => NODE_DEFS[type]?.title ?? type).join(" → ");
        advice = ` Rebuild it with: ${titles}.`;
      } else if (def.replacement) {
        advice = ` Replace it with "${NODE_DEFS[def.replacement]?.title ?? def.replacement}".`;
      }
      out.push({ severity:"info", code:"W005", nodeId:n.id,
        message:`"${def.title ?? n.type}" is a retired node.${advice}` });
    }

    // W006 - a widget node that points at nothing silently does nothing.
    const widgetAware = /^widget_(get|set)_/.test(n.type)
      || n.type === "get_widget"
      || n.type === "sheet_widget_event";
    if (widgetAware) {
      const driven = edges.some(e => e.toNode === n.id && WIDGET_KEY_FIELDS.includes(e.toPin));
      let chosen = "";
      for (const field of WIDGET_KEY_FIELDS) {
        const raw = String(n.data?.[field] ?? "").trim();
        if (raw) { chosen = raw; break; }
      }
      if (!chosen && !driven) {
        out.push({ severity:"warn", code:"W006", nodeId:n.id,
          message:`"${def.title ?? n.type}" has no widget selected, so it will do nothing.` });
      } else if (chosen && !driven && widgetKeys.size && !widgetKeys.has(norm(chosen))) {
        out.push({ severity:"warn", code:"W006", nodeId:n.id,
          message:`"${def.title ?? n.type}" points at widget "${chosen}", which is not on this sheet. Rename or re-pick it.` });
      }
    }
  }

  for (const e of edges) {
    const edgeKey = `${e.fromNode}:${e.fromPin}>${e.toNode}:${e.toPin}`;
    if (edgeKeys.has(edgeKey)) {
      out.push({ severity:"warn", code:"W003", nodeId:e.toNode,
        message:`Duplicate edge ${e.fromNode}.${e.fromPin} → ${e.toNode}.${e.toPin}` });
      continue;
    }
    edgeKeys.add(edgeKey);
    const from = byId.get(e.fromNode);
    const to   = byId.get(e.toNode);
    if (!from || !to) {
      out.push({ severity:"error", code:"E004",
        message:`Dangling edge ${e.fromNode}.${e.fromPin} → ${e.toNode}.${e.toPin}` });
      continue;
    }
    const fromDef = NODE_DEFS[from.type];
    const toDef   = NODE_DEFS[to.type];
    const pinErrors = [];
    const pinOptions = { onError:error => pinErrors.push(error) };
    const fromPin = resolveNodePin(fromDef, from, "output", e.fromPin, pinOptions);
    const toPin   = resolveNodePin(toDef, to, "input", e.toPin, pinOptions);
    if (!fromPin || !toPin) {
      out.push({ severity:"warn", code:"E004", nodeId:to.id,
        message:`Edge references missing pin: ${from.type}.${e.fromPin} → ${to.type}.${e.toPin}` });
      continue;
    }
    if (pinErrors.length) {
      out.push({ severity:"warn", code:"W003", nodeId:to.id,
        message:`Dynamic pin resolver failed while checking ${from.type} → ${to.type}.` });
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

  // Side-effect nodes connected only by values are still unreachable. Walk
  // execution pins from every event/macro entry and report inactive actions.
  const entries = nodes.filter(node => {
    const def = NODE_DEFS[node.type];
    return node.type === "on_click" || def?.isEvent || def?.isMacroInput || def?.isFunctionInputs;
  });
  const reachable = new Set(entries.map(node => node.id));
  const queue = [...reachable];
  while (queue.length) {
    const id = queue.shift();
    const node = byId.get(id);
    const def = NODE_DEFS[node?.type];
    const execPins = new Set(resolveNodePins(def, node, "output").filter(pin => pin.type === "exec").map(pin => pin.id));
    for (const edge of edges) {
      if (edge.fromNode !== id || !execPins.has(edge.fromPin) || reachable.has(edge.toNode)) continue;
      reachable.add(edge.toNode);
      queue.push(edge.toNode);
    }
  }
  for (const node of nodes) {
    const def = NODE_DEFS[node.type];
    if (!def?.isAction || def?.isFunctionOutputs || reachable.has(node.id)) continue;
    out.push({ severity:"warn", code:"W004", nodeId:node.id,
      message:`Action node "${def.title ?? node.type}" is not reachable from an execution entry.` });
  }

  return out;
}

export function lintSummary(report) {
  const c = { error:0, warn:0, info:0 };
  for (const r of report) c[r.severity] = (c[r.severity] ?? 0) + 1;
  return `${c.error} errors, ${c.warn} warnings, ${c.info} notes`;
}
