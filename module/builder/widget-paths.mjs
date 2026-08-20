const REGISTRY_KEY = "__widgetPaths";
export const WIDGET_PATH_REGISTRY_PATH = `system.flags.${REGISTRY_KEY}`;

const DATA_PATH_FIELDS = Object.freeze([
  "path",
  "pathValue",
  "pathMax",
  "maxPath",
  "currencyPath",
  "flagPath"
]);

function cleanPath(value) {
  return typeof value === "string" ? value.trim() : "";
}

function storedRegistry(doc) {
  const raw = doc?.system?.flags?.[REGISTRY_KEY];
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const value of raw) {
    const entry = typeof value === "string" ? { path: value } : value;
    const path = cleanPath(entry?.path);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    out.push({
      path,
      widgetId: String(entry?.widgetId ?? ""),
      widgetType: String(entry?.widgetType ?? ""),
      label: String(entry?.label ?? ""),
      field: String(entry?.field ?? "path")
    });
  }
  return out;
}

function directWidgetPathRecords(widget) {
  if (!widget || typeof widget !== "object") return [];
  const records = [];
  for (const field of DATA_PATH_FIELDS) {
    const path = cleanPath(widget[field]);
    if (!path) continue;
    records.push({
      path,
      widgetId: String(widget.id ?? ""),
      widgetType: String(widget.type ?? ""),
      label: String(widget.label ?? ""),
      field
    });
  }
  return records;
}

function visitWidget(widget, records) {
  if (!widget || typeof widget !== "object") return;
  records.push(...directWidgetPathRecords(widget));
  if (Array.isArray(widget.widgets)) {
    for (const child of widget.widgets) visitWidget(child, records);
  }
  if (Array.isArray(widget.elements)) {
    for (const element of widget.elements) visitWidget(element?.widget, records);
  }
}

export function collectWidgetPathRecords(source) {
  const records = [];
  const tabs = Array.isArray(source)
    ? source
    : (source?.system?.customTabs ?? source?.customTabs ?? []);
  for (const tab of (tabs ?? [])) {
    for (const row of (tab?.rows ?? [])) {
      for (const widget of (row?.widgets ?? [])) visitWidget(widget, records);
    }
  }
  return records;
}

function addAdditionalRecords(additionalWidgets, records) {
  for (const widget of (additionalWidgets ?? [])) visitWidget(widget, records);
}

export function getUsedWidgetDataPaths(doc, { tabs = null, additionalWidgets = [] } = {}) {
  const used = new Set(storedRegistry(doc).map(entry => entry.path));
  const records = collectWidgetPathRecords(tabs ?? doc);
  addAdditionalRecords(additionalWidgets, records);
  for (const entry of records) used.add(entry.path);
  return used;
}

function numberedPath(path, ordinal) {
  if (ordinal <= 1) return path;
  const segments = String(path).split(".");
  if (!segments.length) return path;
  const valueLeaf = /^(value|max|current|rank)$/i.test(segments.at(-1) ?? "");
  const index = Math.max(0, valueLeaf && segments.length > 1 ? segments.length - 2 : segments.length - 1);
  const segment = segments[index] ?? "field";
  const match = segment.match(/^(.*?)(\d+)$/);
  segments[index] = match
    ? `${match[1]}${Number(match[2]) + ordinal - 1}`
    : `${segment}${ordinal}`;
  return segments.join(".");
}

function assignOneWidget(widget, used) {
  const fields = directWidgetPathRecords(widget);
  if (fields.length) {
    let ordinal = 1;
    let candidates = fields.map(entry => numberedPath(entry.path, ordinal));
    while (candidates.some(path => used.has(path))) {
      ordinal += 1;
      candidates = fields.map(entry => numberedPath(entry.path, ordinal));
    }
    fields.forEach((entry, index) => {
      widget[entry.field] = candidates[index];
      used.add(candidates[index]);
    });
  }
  if (Array.isArray(widget.widgets)) {
    for (const child of widget.widgets) assignOneWidget(child, used);
  }
  if (Array.isArray(widget.elements)) {
    for (const element of widget.elements) {
      if (element?.widget) assignOneWidget(element.widget, used);
    }
  }
}

/**
 * Mutates a newly-created or duplicated widget so every writable data path is
 * unique for this document. Numbering starts at 2: myField, myField2, ...
 */
export function assignUniqueWidgetDataPaths(widget, doc = null, options = {}) {
  const used = options.usedPaths instanceof Set
    ? new Set(options.usedPaths)
    : getUsedWidgetDataPaths(doc, options);
  assignOneWidget(widget, used);
  return widget;
}

export function buildWidgetPathRegistryUpdate(doc, tabs = null) {
  const byPath = new Map(storedRegistry(doc).map(entry => [entry.path, entry]));
  for (const entry of collectWidgetPathRecords(tabs ?? doc)) {
    byPath.set(entry.path, { ...(byPath.get(entry.path) ?? {}), ...entry });
  }
  const entries = [...byPath.values()].sort((a, b) =>
    a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: "base" })
  );
  return { [WIDGET_PATH_REGISTRY_PATH]: entries };
}

export function getWidgetPathRows(doc) {
  const live = collectWidgetPathRecords(doc);
  const liveByPath = new Map();
  for (const entry of live) {
    const current = liveByPath.get(entry.path);
    if (!current) liveByPath.set(entry.path, { ...entry, count: 1 });
    else current.count += 1;
  }
  const byPath = new Map(storedRegistry(doc).map(entry => [entry.path, { ...entry, inUse: false, count: 0 }]));
  for (const [path, entry] of liveByPath) {
    byPath.set(path, { ...(byPath.get(path) ?? {}), ...entry, inUse: true });
  }
  return [...byPath.values()].sort((a, b) =>
    a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: "base" })
  );
}

export function deletionPatchFor(path) {
  const parts = cleanPath(path).split(".").filter(Boolean);
  if (parts.length < 2) return {};
  const leaf = parts.pop();
  const parent = parts.join(".");
  return { [`${parent}.-=${leaf}`]: null };
}

function valueAtPath(source, path) {
  let current = source;
  for (const part of cleanPath(path).split(".").filter(Boolean)) {
    if (!current || typeof current !== "object" || !(part in current)) return undefined;
    current = current[part];
  }
  return current;
}

function cloneWithoutUndefined(value) {
  if (Array.isArray(value)) return value.map(cloneWithoutUndefined).filter(entry => entry !== undefined);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined) continue;
    const clean = cloneWithoutUndefined(entry);
    if (clean !== undefined) out[key] = clean;
  }
  return out;
}

function modelDefaultAtPath(doc, path) {
  const parts = cleanPath(path).split(".").filter(Boolean);
  if (parts[0] === "system") parts.shift();
  let field = doc?.system?.schema;
  for (const part of parts) {
    if (!field) return undefined;
    field = field.fields?.[part] ?? field.element ?? null;
  }
  if (!field) return undefined;
  try {
    const value = field.getInitialValue?.({});
    if (value !== undefined) return cloneWithoutUndefined(value);
  } catch {}
  const initial = field.options?.initial ?? field.initial;
  try {
    return cloneWithoutUndefined(typeof initial === "function" ? initial() : initial);
  } catch {
    return undefined;
  }
}

function isFixedSchemaPath(doc, path) {
  const parts = cleanPath(path).split(".").filter(Boolean);
  if (parts[0] === "system") parts.shift();
  let field = doc?.system?.schema;
  for (const part of parts) {
    if (!field?.fields || !(part in field.fields)) return false;
    field = field.fields[part];
  }
  return !!field;
}

function schemaSafeDeletionPatch(doc, path) {
  const current = valueAtPath(doc, path);
  if (current === undefined) return {};
  const fixedSchema = isFixedSchemaPath(doc, path);
  const fallback = fixedSchema ? modelDefaultAtPath(doc, path) : undefined;
  // Deleting a required field from a fixed SchemaField produces an intermediate
  // `undefined` during DataModel#updateSource. Reset it to the schema initial
  // value instead. Dynamic ObjectField paths can still be removed with `-=`.
  if (fixedSchema) return fallback === undefined ? {} : { [cleanPath(path)]: fallback };
  return deletionPatchFor(path);
}

/** Remove an unused reservation and clear its stored value so the slot is reusable. */
export async function releaseWidgetDataPath(doc, path) {
  const target = cleanPath(path);
  if (!target) return { ok: false, reason: "empty" };
  if (collectWidgetPathRecords(doc).some(entry => entry.path === target)) {
    return { ok: false, reason: "in-use" };
  }
  const next = storedRegistry(doc).filter(entry => entry.path !== target);
  const valuePatch = schemaSafeDeletionPatch(doc, target);
  await doc.update({
    [WIDGET_PATH_REGISTRY_PATH]: next,
    ...valuePatch
  });
  return { ok: true };
}

export const __widgetPathTest = Object.freeze({ numberedPath, directWidgetPathRecords, storedRegistry, modelDefaultAtPath, schemaSafeDeletionPatch });
