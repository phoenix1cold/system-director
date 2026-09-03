/**
 * System Director UI Blueprint schema.
 *
 * Version 3 is deliberately reference based: designers work with typed variables,
 * Widget IDs, functions and assets. Legacy data paths are accepted only by the
 * one-time migration and never emitted by the new editor.
 */

export const BLUEPRINT_SCHEMA_VERSION = 3;

export const VARIABLE_TYPES = [
  "boolean", "number", "string", "color", "actor", "item", "effect",
  "widget", "enum", "struct", "array", "any"
];

export const VARIABLE_SCOPES = ["instance", "user", "actor", "item", "world"];

export function safeId(value, fallback = "entry") {
  const out = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
  return out || fallback;
}

export function uniqueId(records, requested, { key = "id", ignore = "", fallback = "entry" } = {}) {
  const used = new Set((records ?? [])
    .filter(record => String(record?.[key] ?? "") !== String(ignore))
    .map(record => String(record?.[key] ?? "").toLowerCase()));
  const base = safeId(requested, fallback);
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}_${n}`)) n += 1;
  return `${base}_${n}`;
}

export function pinType(type) {
  return ({
    boolean: "value.bool",
    number: "value.number",
    string: "value.string",
    color: "value.color",
    actor: "value.actor",
    item: "value.item",
    effect: "value.effect",
    widget: "value.widget_ref",
    enum: "value.enum",
    struct: "value.struct",
    array: "value.array",
    any: "value.any"
  })[String(type ?? "any")] ?? "value.any";
}

export function defaultForType(type) {
  switch (type) {
    case "boolean": return false;
    case "number": return 0;
    case "string":
    case "color":
    case "enum": return "";
    case "array": return [];
    case "struct": return {};
    default: return null;
  }
}

export function coerceBlueprintValue(value, type) {
  switch (type) {
    case "number": {
      const number = Number(value);
      return Number.isFinite(number) ? number : 0;
    }
    case "boolean": {
      if (typeof value === "boolean") return value;
      if (typeof value === "number") return value !== 0;
      return ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
    }
    case "string":
    case "color":
    case "enum": return value == null ? "" : String(value);
    case "array": return Array.isArray(value) ? value : (value == null || value === "" ? [] : [value]);
    case "struct": return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    default: return value;
  }
}

export function normalizeVariable(raw = {}, index = 0, used = new Set()) {
  const name = String(raw.name ?? raw.label ?? `Variable ${index + 1}`).trim() || `Variable ${index + 1}`;
  let id = safeId(raw.id ?? raw.variableId ?? name, `variable_${index + 1}`);
  const base = id;
  let suffix = 2;
  while (used.has(id)) id = `${base}_${suffix++}`;
  used.add(id);
  const type = VARIABLE_TYPES.includes(raw.type) ? raw.type : "any";
  const oldScope = raw.scope === "local" ? "instance" : raw.scope === "shared" ? "world" : raw.scope;
  const scope = VARIABLE_SCOPES.includes(oldScope) ? oldScope : "instance";
  return {
    id,
    name,
    type,
    scope,
    default: raw.default === undefined ? defaultForType(type) : coerceBlueprintValue(raw.default, type),
    exposeOnSpawn: !!(raw.exposeOnSpawn ?? raw.spawn),
    readOnly: !!raw.readOnly,
    category: String(raw.category ?? "Default"),
    description: String(raw.description ?? raw.desc ?? ""),
    enumId: String(raw.enumId ?? ""),
    structId: String(raw.structId ?? ""),
    replicated: raw.replicated !== false
  };
}

export function normalizeVariables(raw = []) {
  const used = new Set();
  return (Array.isArray(raw) ? raw : []).map((variable, index) => normalizeVariable(variable, index, used));
}

export function variableByRef(system, ref) {
  const value = String(ref ?? "");
  const variables = normalizeVariables(system?.variables);
  return variables.find(variable => variable.id === value)
    ?? variables.find(variable => variable.name === value)
    ?? null;
}

/** Widget ID is canonical. Name fallback exists only for imported v1 content. */
export function widgetByRef(system, ref) {
  const value = String(ref ?? "");
  const widgets = system?.elements ?? [];
  const byId = widgets.find(widget => String(widget?.id ?? widget?.widgetId ?? "") === value);
  if (byId) return byId;
  const byName = widgets.filter(widget => String(widget?.name ?? "") === value);
  return byName.length === 1 ? byName[0] : null;
}

function clone(source) {
  if (globalThis.foundry?.utils?.deepClone) return foundry.utils.deepClone(source);
  return structuredClone(source ?? {});
}

function normalizeAssetList(raw, prefix, mapper = value => value) {
  const list = Array.isArray(raw) ? raw : [];
  const used = new Set();
  return list.map((record, index) => {
    const source = record && typeof record === "object" ? clone(record) : {};
    source.name = String(source.name ?? `${prefix} ${index + 1}`).trim() || `${prefix} ${index + 1}`;
    source.id = uniqueId([...used].map(id => ({ id })), source.id ?? source.name, { fallback: `${safeId(prefix)}_${index + 1}` });
    used.add(source.id);
    return mapper(source, index);
  });
}

export function normalizeBlueprintAssets(system = {}) {
  return {
    functions: normalizeAssetList(system.functions, "Function", fn => ({
      ...fn,
      inputs: normalizeVariables(fn.inputs ?? []),
      outputs: normalizeVariables(fn.outputs ?? []),
      graphData: fn.graphData && typeof fn.graphData === "object" ? fn.graphData : { nodes: [], edges: [], comments: [] }
    })),
    customEvents: normalizeAssetList(system.customEvents, "Event", event => ({
      ...event,
      parameters: normalizeVariables(event.parameters ?? event.inputs ?? [])
    })),
    enums: normalizeAssetList(system.enums, "Enum", enumeration => ({
      ...enumeration,
      entries: normalizeAssetList(enumeration.entries, "Entry", entry => ({ ...entry, value: entry.value ?? entry.id }))
    })),
    structs: normalizeAssetList(system.structs, "Struct", struct => ({
      ...struct,
      fields: normalizeVariables(struct.fields ?? [])
    })),
    dataTables: normalizeAssetList(system.dataTables, "Data Table", table => ({
      ...table,
      structId: String(table.structId ?? ""),
      rows: normalizeAssetList(table.rows, "Row", row => ({ ...row, values: row.values && typeof row.values === "object" ? row.values : {} }))
    })),
    templates: normalizeAssetList(system.templates, "Template", template => ({
      ...template,
      category: String(template.category ?? "General"),
      elements: Array.isArray(template.elements) ? template.elements : []
    }))
  };
}

const LEGACY_VAR_RE = /^(?:ui\.|var\.|system\.vars\.|system\.hiddenFields\.|system\.flags\.)(.+)$/;

/** Upgrade a v1/v2 UI asset without exposing the legacy storage model again. */
export function migrateBlueprintData(source = {}) {
  const system = clone(source ?? {});
  system.schemaVersion = BLUEPRINT_SCHEMA_VERSION;
  system.blueprintId = safeId(system.blueprintId ?? system.widgetKey ?? system.title, "ui-blueprint");
  system.widgetKey = system.blueprintId;

  const variables = normalizeVariables(system.variables);
  const byId = new Map(variables.map(variable => [variable.id, variable]));
  const byName = new Map(variables.map(variable => [variable.name, variable]));
  const variableFor = (rawName, initial) => {
    const name = String(rawName ?? "value").split(".")[0];
    const normalized = safeId(name, "value");
    let variable = byId.get(normalized) ?? byName.get(name);
    if (!variable) {
      const type = typeof initial === "boolean" ? "boolean" : typeof initial === "number" ? "number" : "any";
      variable = normalizeVariable({ id: normalized, name, type, scope: "instance", default: initial }, variables.length, new Set(variables.map(entry => entry.id)));
      variables.push(variable);
      byId.set(variable.id, variable);
      byName.set(variable.name, variable);
    }
    return variable;
  };

  for (const [name, value] of Object.entries(system.hiddenFields ?? system.vars ?? {})) variableFor(name, value);

  const elements = Array.isArray(system.elements) ? clone(system.elements) : [];
  const used = new Set();
  for (const [index, element] of elements.entries()) {
    let id = safeId(element.id ?? element.widgetId ?? element.name, `widget_${index + 1}`);
    const base = id;
    let suffix = 2;
    while (used.has(id)) id = `${base}_${suffix++}`;
    used.add(id);
    element.id = id;
    element.widgetId = id;
    element.name = String(element.name ?? element.type ?? `Widget ${index + 1}`);
    element.bind = element.bind && typeof element.bind === "object" ? element.bind : {};
    element.events = element.events && typeof element.events === "object" ? element.events : {};
    element.props = element.props && typeof element.props === "object" ? element.props : {};

    const path = String(element.props.path ?? element.path ?? "").trim();
    const match = path.match(LEGACY_VAR_RE);
    if (match) {
      const variable = variableFor(match[1]);
      element.valueVariableId = variable.id;
      delete element.props.path;
      delete element.path;
    } else if (path) {
      // Preserve unsupported document bindings for the compatibility renderer,
      // but do not surface them in the v3 Designer.
      element.legacyPath = path;
      delete element.props.path;
      delete element.path;
    }

    for (const [property, binding] of Object.entries(element.bind)) {
      if (typeof binding !== "string") continue;
      const exact = binding.trim().replace(/^\{|\}$/g, "").match(LEGACY_VAR_RE);
      if (!exact) continue;
      const variable = variableFor(exact[1]);
      element.bind[property] = { kind: "variable", variableId: variable.id };
    }
  }

  const assets = normalizeBlueprintAssets(system);
  Object.assign(system, assets, {
    variables,
    elements,
    eventGraph: system.eventGraph && typeof system.eventGraph === "object"
      ? system.eventGraph
      : { nodes: [], edges: [], comments: [] },
    worldState: system.worldState && typeof system.worldState === "object"
      ? system.worldState
      : { ...(system.sharedState ?? {}) },
    legacy: {
      ...(system.legacy ?? {}),
      migratedAt: new Date().toISOString(),
      sourceVersion: Number(source?.schemaVersion ?? 1)
    }
  });

  delete system.sharedState;
  delete system.hiddenFields;
  delete system.widgetFields;
  delete system.vars;
  delete system.flags;
  return system;
}

export function validateBlueprint(system = {}) {
  const errors = [];
  const widgetIds = new Set();
  for (const widget of system.elements ?? []) {
    const id = String(widget?.id ?? widget?.widgetId ?? "").trim();
    if (!id) errors.push({ code: "widget_id_missing", message: `Widget '${widget?.name ?? "?"}' has no Widget ID` });
    else if (widgetIds.has(id.toLowerCase())) errors.push({ code: "widget_id_duplicate", message: `Duplicate Widget ID: ${id}` });
    widgetIds.add(id.toLowerCase());
  }
  const variableIds = new Set();
  for (const variable of normalizeVariables(system.variables)) {
    if (variableIds.has(variable.id.toLowerCase())) errors.push({ code: "variable_id_duplicate", message: `Duplicate variable ID: ${variable.id}` });
    variableIds.add(variable.id.toLowerCase());
  }
  return { valid: errors.length === 0, errors };
}
