/**
 * Equip / unequip safety net.
 *
 * Foundry passes partial update payloads through `DataModel.migrateData`, so a
 * data migration can inject schema defaults into an update that was only meant
 * to flip a single flag. That is how equipping an item used to clear its
 * Equippable checkbox: the payload `{ "system.equipped": true }` was enriched
 * with `equippable: false` and that default was written to the database.
 *
 * Two rules keep the item flags stable:
 * 1. Defaults are only ever added to a *complete* document source.
 * 2. An equip toggle may only write `system.equipped`.
 */

/** Update option every equip / unequip call site sets. */
export const EQUIP_TOGGLE_OPTION = "sdEquipToggle";

/** `system.*` keys an equip toggle is allowed to write. */
export const EQUIP_TOGGLE_KEYS = ["equipped", "widgetFields"];

/** Categories that were equippable before `system.equippable` existed. */
export const LEGACY_EQUIP_CATEGORIES = ["weapon", "armor", "shield", "tool"];

/** Anchor keys that only a complete `inventory` system source carries. */
export const INVENTORY_SOURCE_ANCHORS = [
  "category", "rarity", "quantity", "weight", "price", "currency", "hiddenFields", "description"
];

/** Coerce the loose values legacy worlds stored in `hiddenFields`. */
export function asEquipBool(value) {
  return !(value === false || value === "false" || value === 0 || value === "0"
    || value === "" || value === null || value === undefined);
}

/** True when this update was issued by an equip / unequip toggle. */
export function isEquipToggleUpdate(options) {
  return options?.[EQUIP_TOGGLE_OPTION] === true;
}

/**
 * Root-level `system.*` keys carried by an update payload. Accepts both the
 * dot-notation form (`{ "system.equipped": true }`) and the expanded form
 * (`{ system: { equipped: true } }`).
 */
export function systemDiffRootKeys(changed) {
  const keys = new Set();
  if (!changed || typeof changed !== "object") return keys;
  for (const [key, value] of Object.entries(changed)) {
    if (key === "system") {
      if (value && typeof value === "object") for (const inner of Object.keys(value)) keys.add(inner);
    } else if (key.startsWith("system.")) {
      const root = key.slice("system.".length).split(".")[0];
      if (root) keys.add(root);
    }
  }
  return keys;
}

/**
 * Remove every `system.*` key an equip toggle must not touch. Mutates `changed`
 * so the sanitised payload is what actually reaches the database.
 */
export function stripEquipToggleNoise(changed, allowed = EQUIP_TOGGLE_KEYS) {
  if (!changed || typeof changed !== "object") return changed;
  const keep = new Set(allowed);
  for (const key of Object.keys(changed)) {
    if (key === "system") {
      const system = changed.system;
      if (!system || typeof system !== "object") continue;
      for (const inner of Object.keys(system)) if (!keep.has(inner)) delete system[inner];
      if (!Object.keys(system).length) delete changed.system;
    } else if (key.startsWith("system.")) {
      const root = key.slice("system.".length).split(".")[0];
      if (!keep.has(root)) delete changed[key];
    }
  }
  return changed;
}

/**
 * Distinguish a complete document source from a partial update payload.
 * A stored source serialises every schema field, so it carries the anchor keys;
 * an update diff carries only the handful of keys that actually changed.
 */
export function isFullDocumentSource(source, anchors, minimum = anchors.length - 1) {
  if (!source || typeof source !== "object" || Array.isArray(source)) return false;
  let hits = 0;
  for (const key of anchors) if (Object.prototype.hasOwnProperty.call(source, key)) hits++;
  return hits >= minimum;
}

/** True when `source` is a complete `inventory` system source. */
export function isFullInventorySource(source) {
  if (!source || typeof source !== "object") return false;
  return Object.prototype.hasOwnProperty.call(source, "hiddenFields")
    && isFullDocumentSource(source, INVENTORY_SOURCE_ANCHORS, 5);
}

/**
 * Resolve `system.equippable` for an inventory source.
 * - An explicit value always wins, so the checkbox sticks.
 * - The legacy `hiddenFields.equippable` mirror is adopted once.
 * - The old category heuristic runs for complete legacy sources only.
 * Returns `undefined` when the payload must be left untouched.
 */
export function resolveEquippableFlag(source) {
  if (!source || typeof source !== "object") return undefined;
  if (Object.prototype.hasOwnProperty.call(source, "equippable") && source.equippable !== undefined) {
    return undefined;
  }
  const legacy = source.hiddenFields?.equippable;
  if (legacy !== undefined) return asEquipBool(legacy);
  if (!isFullInventorySource(source)) return undefined;
  return LEGACY_EQUIP_CATEGORIES.includes(String(source.category ?? "gear"));
}

/** Apply the equippable migration to an inventory system source. Mutates `source`. */
export function applyEquippableMigration(source) {
  if (!source || typeof source !== "object") return source;
  const resolved = resolveEquippableFlag(source);
  if (resolved !== undefined) source.equippable = resolved;
  // The mirror is dropped only once the real field carries the value, so a
  // partial payload can never delete the last copy of the legacy flag.
  if (Object.prototype.hasOwnProperty.call(source, "equippable")
    && source.hiddenFields && typeof source.hiddenFields === "object"
    && Object.prototype.hasOwnProperty.call(source.hiddenFields, "equippable")) {
    delete source.hiddenFields.equippable;
  }
  return source;
}

/** Equippable state of a slot snapshot, tolerating the legacy mirror. */
export function snapshotEquippable(snapshot) {
  const system = snapshot?.system;
  if (!system || typeof system !== "object") return false;
  if (Object.prototype.hasOwnProperty.call(system, "equippable") && system.equippable !== undefined) {
    return asEquipBool(system.equippable);
  }
  return asEquipBool(system.hiddenFields?.equippable);
}
