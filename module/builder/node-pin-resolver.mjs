/**
 * Canonical pin resolution for every System Director graph consumer.
 *
 * Node definitions may expose static pins, computed pins and legacy expandable
 * input groups.  Keeping that logic in one place prevents the editor, linter,
 * debugger and AI assistant from disagreeing about the graph contract.
 */

function _appendUnique(target, values) {
  for (const pin of (Array.isArray(values) ? values : [])) {
    if (!pin?.id || target.some(existing => existing.id === pin.id)) continue;
    target.push(pin);
  }
}

function _evaluatePins(source, node, context) {
  if (typeof source !== "function") return Array.isArray(source) ? source : [];
  try {
    const value = source(node, context);
    return Array.isArray(value) ? value : [];
  } catch (error) {
    context?.onError?.(error);
    return [];
  }
}

/**
 * Resolve all pins for one side of a node.
 *
 * @param {object} definition Node definition.
 * @param {object|null} node Runtime graph node carrying dynamic field values.
 * @param {"input"|"output"} side Side to resolve.
 * @param {object} options Resolution options.
 * @param {boolean} options.includeDynamicGroups Include legacy dynamicPins groups.
 * @param {number} options.dynamicGroupLimit Maximum pins emitted from each group.
 * @param {boolean} options.includeCatalogOutputs Include catalog-only outputs.
 * @returns {Array<object>}
 */
export function resolveNodePins(definition, node, side, options = {}) {
  if (!definition || (side !== "input" && side !== "output")) return [];
  const pins = [];
  const context = options.context ?? options;
  const staticSource = side === "output" ? definition.outputs : definition.inputs;
  _appendUnique(pins, _evaluatePins(staticSource, node, context));

  const computed = side === "output"
    ? definition.computeDynamicOutputs
    : definition.computeDynamicInputs;
  _appendUnique(pins, _evaluatePins(computed, node, context));

  if (side === "output" && options.includeCatalogOutputs) {
    _appendUnique(pins, _evaluatePins(definition.catalogOutputs, node, context));
  }

  if (side === "input" && options.includeDynamicGroups !== false) {
    const groups = Array.isArray(definition.dynamicPins)
      ? definition.dynamicPins
      : (definition.dynamicPins ? [definition.dynamicPins] : []);
    const cap = Number.isFinite(Number(options.dynamicGroupLimit))
      ? Math.max(0, Number(options.dynamicGroupLimit))
      : Infinity;
    for (const group of groups) {
      const base = String(group?.base ?? "").trim();
      const max = Math.min(Math.max(0, Number(group?.max ?? 0) || 0), cap);
      if (!base || !max) continue;
      for (let index = 0; index < max; index++) {
        _appendUnique(pins, [{
          id: `${base}${index}`,
          label: `${group.label ?? base} ${index + 1}`,
          type: group.type ?? "value.any",
          dynamicGroup: base,
          dynamicIndex: index
        }]);
      }
    }
  }
  return pins;
}

export function resolveNodePin(definition, node, side, pinId, options = {}) {
  return resolveNodePins(definition, node, side, options)
    .find(pin => pin.id === pinId) ?? null;
}

export function nodeHasDynamicPins(definition, side = null) {
  if (!definition) return false;
  if (!side || side === "input") {
    if (definition.dynamicPins || typeof definition.computeDynamicInputs === "function") return true;
  }
  if (!side || side === "output") {
    if (typeof definition.computeDynamicOutputs === "function") return true;
  }
  return false;
}
