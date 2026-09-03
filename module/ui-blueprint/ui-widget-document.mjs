/** Typed v3 UI Blueprint asset. Runtime values live in UIWidgetState, not in the design document. */
export class UIWidgetItemData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    const F = foundry.data.fields;
    return {
      schemaVersion: new F.NumberField({ required: true, nullable: false, initial: 3, integer: true, min: 1 }),
      blueprintId: new F.StringField({ required: true, blank: false, initial: "ui-blueprint" }),
      title:    new F.StringField({ required: true, blank: false, initial: "New UI Widget" }),
      widgetKey:new F.StringField({ required: true, blank: false, initial: "my-widget",
        validate: (value) => /^[a-z0-9][a-z0-9-]{0,62}$/.test(String(value)),
        validationError: "widgetKey must be kebab-case (a-z, 0-9, -)" }),
      layout:   new F.StringField({ required: true, blank: false,
        choices: ["window", "fullscreen", "dock-left", "dock-right", "dock-top", "dock-bottom"],
        initial: "window" }),
      size: new F.SchemaField({
        w: new F.NumberField({ required: true, nullable: false, initial: 720, min: 200, max: 3840, integer: true }),
        h: new F.NumberField({ required: true, nullable: false, initial: 520, min: 120, max: 2160, integer: true })
      }),
      canvas: new F.SchemaField({
        w: new F.NumberField({ required: true, nullable: false, initial: 0, min: 0, max: 3840, integer: true }),
        h: new F.NumberField({ required: true, nullable: false, initial: 0, min: 0, max: 2160, integer: true })
      }),
      wbLayout:     new F.StringField({ choices: ["grid", "free"], initial: "free" }),
      columns:      new F.NumberField({ initial: 4, min: 1, max: 24, integer: true }),
      gap:          new F.NumberField({ initial: 8, min: 0, max: 128, integer: true }),
      gridSize:     new F.NumberField({ initial: 16, min: 4, max: 128, integer: true }),
      snap:         new F.NumberField({ initial: 4, min: 0, max: 128, integer: true }),
      persistState: new F.BooleanField({ initial: true }),
      graphId:      new F.StringField({ required: false, blank: true, initial: "" }),
      customCss:    new F.StringField({ required: false, blank: true, initial: "" }),

      /** Typed widget variables: { name, type, scope, default, desc }. */
      variables: new F.ArrayField(new F.ObjectField(), { initial: () => [] }),
      /** Element tree (flat list, `parent` links). */
      elements: new F.ArrayField(new F.ObjectField(), { initial: () => [] }),
      functions:    new F.ArrayField(new F.ObjectField(), { initial: () => [] }),
      customEvents: new F.ArrayField(new F.ObjectField(), { initial: () => [] }),
      enums:        new F.ArrayField(new F.ObjectField(), { initial: () => [] }),
      structs:      new F.ArrayField(new F.ObjectField(), { initial: () => [] }),
      dataTables:   new F.ArrayField(new F.ObjectField(), { initial: () => [] }),
      templates:    new F.ArrayField(new F.ObjectField(), { initial: () => [] }),
      eventGraph:   new F.ObjectField({ initial: () => ({ nodes: [], edges: [], comments: [] }) }),
      worldState:   new F.ObjectField({ initial: () => ({}) }),
      legacy:       new F.ObjectField({ initial: () => ({}) }),
      customTabs:   new F.ArrayField(new F.ObjectField(), { initial: () => [] })
    };
  }
}

/**
 * Small registry of currently loaded UI Widget items indexed by widgetKey —
 * so nodes can resolve a key to an Item document without scanning game.items
 * each call.
 */
const _byKey = new Map();
const _byKeyByUuid = new Map();

function _refreshKeyIndex(doc) {
  if (!doc || doc.documentName !== "Item" || doc.type !== "uiwidget") return;
  // Remove old mapping if the key changed
  const previousKey = _byKeyByUuid.get(doc.uuid);
  if (previousKey && previousKey !== doc.system.widgetKey) {
    const set = _byKey.get(previousKey);
    if (set) { set.delete(doc.uuid); if (!set.size) _byKey.delete(previousKey); }
  }
  const key = String(Number(doc.system?.schemaVersion ?? 1) >= 2 ? (doc.system?.blueprintId ?? doc.system?.widgetKey) : doc.system?.widgetKey).trim();
  if (!key) return;
  _byKeyByUuid.set(doc.uuid, key);
  const set = _byKey.get(key) ?? new Set();
  set.add(doc.uuid);
  _byKey.set(key, set);
}

function _dropFromIndex(doc) {
  const key = _byKeyByUuid.get(doc.uuid);
  if (!key) return;
  const set = _byKey.get(key);
  if (set) { set.delete(doc.uuid); if (!set.size) _byKey.delete(key); }
  _byKeyByUuid.delete(doc.uuid);
}

/** Rebuild the whole index once at ready. */
export function rebuildUIWidgetIndex() {
  _byKey.clear();
  _byKeyByUuid.clear();
  for (const it of game.items ?? []) {
    if (it.type === "uiwidget") _refreshKeyIndex(it);
  }
}

/**
 * Look up the FIRST Item document whose widgetKey matches `key`, in world
 * items and open compendia caches. Returns null if not found.
 */
export function findUIWidgetItem(key) {
  const raw = String(key ?? "").trim().toLowerCase();
  if (!raw) return null;
  const uuids = _byKey.get(raw);
  if (uuids) {
    for (const uuid of uuids) {
      const doc = fromUuidSync?.(uuid);
      if (doc) return doc;
    }
  }
  // Fallback: scan world items (rare — happens once for freshly loaded worlds)
  for (const it of game.items ?? []) {
    if (it.type !== "uiwidget") continue;
    const key = Number(it.system?.schemaVersion ?? 1) >= 2 ? (it.system?.blueprintId ?? it.system?.widgetKey) : it.system?.widgetKey;
    if (String(key ?? "").toLowerCase() === raw) {
      _refreshKeyIndex(it);
      return it;
    }
  }
  return null;
}

/** List every uiwidget Item in the world (for the manager UI). */
export function listUIWidgetItems() {
  return (game.items ?? []).filter(it => it.type === "uiwidget");
}

/** Hooks that keep the key index in sync. */
export function installUIWidgetIndexHooks() {
  Hooks.on("createItem",  _refreshKeyIndex);
  Hooks.on("updateItem",  _refreshKeyIndex);
  Hooks.on("deleteItem",  _dropFromIndex);
}
