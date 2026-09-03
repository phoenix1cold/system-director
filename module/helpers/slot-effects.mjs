import { readDatabaseValue, valueStoragePath, variableIdForLegacyPath } from "./value-database.mjs";
export const SD_SLOT_EFFECT_FLAG = "slotEffect";

const _AE_MODES = {
  CUSTOM:    0,
  MULTIPLY:  1,
  ADD:       2,
  DOWNGRADE: 3,
  UPGRADE:   4,
  OVERRIDE:  5
};

export const SLOT_EFFECT_MODE_CHOICES = [
  { value: _AE_MODES.ADD,       label: "Add" },
  { value: _AE_MODES.MULTIPLY,  label: "Multiply" },
  { value: _AE_MODES.OVERRIDE,  label: "Override" },
  { value: _AE_MODES.UPGRADE,   label: "Upgrade" },
  { value: _AE_MODES.DOWNGRADE, label: "Downgrade" },
  { value: _AE_MODES.CUSTOM,    label: "Custom" }
];

const _SD_TYPE_TO_LEGACY_MODE = {
  custom: 0, multiply: 1, add: 2, downgrade: 3, upgrade: 4, override: 5
};

function _clone(value) {
  try { return foundry.utils.deepClone(value); }
  catch { return structuredClone(value); }
}

function _docName(doc) {
  if (doc?.documentName) return String(doc.documentName);
  if (doc?.constructor?.name?.includes("Actor")) return "Actor";
  return "Item";
}

function _resolveHostActor(host) {
  if (_docName(host) === "Actor") return host;
  if (_docName(host?.actor) === "Actor") return host.actor;
  if (_docName(host?.parent) === "Actor") return host.parent;
  return null;
}

function _hostMarker(host) {
  const hostDocumentName = _docName(host);
  return {
    hostDocumentName,
    hostId: String(host?.id ?? host?._id ?? ""),
    // Keep the old field for compatibility with effects produced before 0.10.1.
    parentItemId: hostDocumentName === "Item" ? String(host?.id ?? host?._id ?? "") : null
  };
}

function _hostHasSlots(host) {
  if ((host?.system?.slotDefinitions ?? []).length) return true;
  return Object.keys(host?.system?.slotContents ?? {}).length > 0;
}

function _isEquippableInventory(data) {
  return data?.type === "inventory" && data?.system?.equippable === true;
}

function _hostContentsActive(host, inheritedActive) {
  if (!inheritedActive) return false;
  if (_isEquippableInventory(host) && host.system?.equipped !== true) return false;
  return true;
}

function _sdModeNum(change) {
  const type = change?.type;
  if (typeof type === "string" && _SD_TYPE_TO_LEGACY_MODE[type.toLowerCase()] !== undefined) {
    return _SD_TYPE_TO_LEGACY_MODE[type.toLowerCase()];
  }
  const mode = Number(change?.mode);
  return Number.isFinite(mode) ? mode : _AE_MODES.ADD;
}

function _normaliseChanges(changes) {
  return (changes ?? []).map(change => ({
    key: String(change?.key ?? ""),
    mode: _sdModeNum(change),
    value: String(change?.value ?? ""),
    priority: Number.isFinite(Number(change?.priority)) ? Number(change.priority) : 20
  }));
}

function _changesEqual(a, b) {
  const left = _normaliseChanges(a);
  const right = _normaliseChanges(b);
  if (left.length !== right.length) return false;
  return left.every((change, index) => {
    const other = right[index];
    return change.key === other.key
      && change.mode === other.mode
      && change.value === other.value
      && change.priority === other.priority;
  });
}

function _normaliseStatuses(value) {
  if (value instanceof Set) return [...value].map(String).sort();
  if (Array.isArray(value)) return value.map(String).sort();
  return [];
}

function _sameJson(a, b) {
  try { return JSON.stringify(a ?? null) === JSON.stringify(b ?? null); }
  catch { return false; }
}

function _sourceEffects(snapshot) {
  if (Array.isArray(snapshot?.effects)) return snapshot.effects;
  if (Array.isArray(snapshot?.system?.effects)) return snapshot.system.effects;
  return [];
}

function _effectMode(effect) {
  const explicit = effect?.flags?.sd?.effectTransferMode;
  if (["always", "equipped", "item"].includes(explicit)) return explicit;
  if (effect?.transfer === false) return "item";
  return effect?.flags?.sd?.activateOnEquip ? "equipped" : "always";
}

function _buildTransferredSnapshotEffect({ host, marker, snapshot, effect, effectIndex, path, inheritedActive }) {
  const mode = _effectMode(effect);
  if (mode === "item") return null;
  if (!inheritedActive) return null;
  if (mode === "equipped" && snapshot?.system?.equipped !== true) return null;
  // A manually disabled always-transfer effect stays disabled. Equipped-only mode is
  // driven by the equipment state, matching live SDItem behaviour.
  if (mode === "always" && effect?.disabled === true) return null;

  const sourceEffectId = String(effect?._id ?? effect?.id ?? `effect${effectIndex}`);
  const tag = `${marker.hostDocumentName}:${marker.hostId}|${path}|effect:${sourceEffectId}`;
  const flags = _clone(effect?.flags ?? {});
  flags.sd ??= {};
  delete flags.sd.activateOnEquip;
  flags.sd[SD_SLOT_EFFECT_FLAG] = {
    ...marker,
    tag,
    sourceKind: "slottedItemEffect",
    sourceEffectId,
    sourceItemId: String(snapshot?._id ?? snapshot?.id ?? ""),
    sourceMode: mode,
    slotPath: path
  };

  const img = effect?.img ?? effect?.icon ?? snapshot?.img ?? "icons/svg/aura.svg";
  const data = {
    name: String(effect?.name ?? snapshot?.name ?? "Item Effect"),
    img,
    icon: img,
    changes: _clone(effect?.changes ?? effect?.system?.changes ?? []),
    disabled: false,
    transfer: false,
    flags,
    origin: host?.uuid ?? null
  };
  if (effect?.duration) data.duration = _clone(effect.duration);
  if (effect?.description !== undefined) data.description = effect.description;
  const statuses = _normaliseStatuses(effect?.statuses);
  if (statuses.length) data.statuses = statuses;
  if (effect?.tint) data.tint = effect.tint;
  return { tag, data };
}

/**
 * Build actor-owned ActiveEffects represented by slot data on an Actor or owned
 * Item. This includes both slot field mappings and transferable effects from
 * slotted item snapshots. Equipped-only item effects are emitted only while the
 * snapshot is equipped, including when a Slot widget auto-equips it.
 */
export function collectExpectedSlotEffects(host) {
  const actor = _resolveHostActor(host);
  if (!host || !actor) return [];

  const marker = _hostMarker(host);
  const out = [];

  const walk = (container, path, inheritedActive = true) => {
    const contentsActive = _hostContentsActive(container, inheritedActive);
    const defs = container?.system?.slotDefinitions ?? [];

    for (const def of defs) {
      const slotId = String(def?.id ?? "");
      if (!slotId) continue;
      const contents = container?.system?.slotContents?.[slotId]?.contents ?? [];
      const changes = (def?.changes ?? []).filter(change => (change?.itemVariableId||change?.itemFieldPath) && (change?.actorVariableId||change?.actorFieldPath));

      for (let index = 0; index < contents.length; index++) {
        const snapshot = contents[index];
        if (!snapshot) continue;
        const itemKey = String(snapshot?._id ?? snapshot?.id ?? `idx${index}`);
        const itemPath = `${path}/slot:${slotId}/item:${itemKey}:${index}`;

        if (contentsActive && changes.length) {
          const tag = `${marker.hostDocumentName}:${marker.hostId}|${itemPath}|mapped`;
          const mappedChanges = changes.map(change => {
            const itemVariableId=change.itemVariableId||variableIdForLegacyPath(change.itemFieldPath);
            const actorVariableId=change.actorVariableId||variableIdForLegacyPath(change.actorFieldPath);
            const raw = itemVariableId?readDatabaseValue(snapshot,itemVariableId):foundry.utils.getProperty(snapshot,change.itemFieldPath);
            return {
              key: actorVariableId?valueStoragePath(actorVariableId):String(change.actorFieldPath),
              mode: Number.isFinite(Number(change.mode)) ? Number(change.mode) : _AE_MODES.ADD,
              value: raw === undefined || raw === null ? "0" : String(raw),
              priority: Number.isFinite(Number(change.priority)) ? Number(change.priority) : 20
            };
          });
          const img = snapshot?.img ?? "icons/svg/aura.svg";
          out.push({
            tag,
            data: {
              name: `[Slot: ${def.label ?? slotId}] ${snapshot?.name ?? "Item"}`,
              img,
              icon: img,
              changes: mappedChanges,
              disabled: false,
              transfer: false,
              origin: host?.uuid ?? null,
              flags: {
                sd: {
                  [SD_SLOT_EFFECT_FLAG]: {
                    ...marker,
                    tag,
                    sourceKind: "slotFieldMapping",
                    slotId,
                    sourceItemId: itemKey,
                    sourceMode: "equippedHost",
                    slotPath: itemPath
                  }
                }
              }
            }
          });
        }

        const sourceEffects = _sourceEffects(snapshot);
        for (let effectIndex = 0; effectIndex < sourceEffects.length; effectIndex++) {
          const expected = _buildTransferredSnapshotEffect({
            host,
            marker,
            snapshot,
            effect: sourceEffects[effectIndex],
            effectIndex,
            path: itemPath,
            inheritedActive: contentsActive
          });
          if (expected) out.push(expected);
        }

        // Nested Item Slots are supported. An unequipped equippable container
        // suppresses its nested slot mappings/effects, but an always-transfer
        // effect on that container itself still follows its own transfer mode.
        walk(snapshot, itemPath, contentsActive);
      }
    }
  };

  walk(host, "root", true);
  return out;
}

function _effectBelongsToHost(effect, marker) {
  const flag = effect?.flags?.sd?.[SD_SLOT_EFFECT_FLAG];
  if (!flag) return false;
  const flagType = String(flag.hostDocumentName ?? "Item");
  const flagId = String(flag.hostId ?? flag.parentItemId ?? "");
  return flagType === marker.hostDocumentName && flagId === marker.hostId;
}

function _needsUpdate(effect, expected) {
  const data = expected.data;
  const currentImg = effect?.img ?? effect?.icon ?? "";
  if (String(effect?.name ?? "") !== String(data.name ?? "")) return true;
  if (String(currentImg) !== String(data.img ?? data.icon ?? "")) return true;
  if (effect?.disabled !== false || effect?.transfer !== false) return true;
  if (!_changesEqual(effect?.system?.changes ?? effect?.changes ?? [], data.changes ?? [])) return true;
  if (!_sameJson(_normaliseStatuses(effect?.statuses), _normaliseStatuses(data.statuses))) return true;
  if (!_sameJson(effect?.duration, data.duration)) return true;
  const currentFlag = effect?.flags?.sd?.[SD_SLOT_EFFECT_FLAG];
  const expectedFlag = data?.flags?.sd?.[SD_SLOT_EFFECT_FLAG];
  return !_sameJson(currentFlag, expectedFlag);
}

export class SlotEffectSync {

  static async sync(host) {
    if (!host) return;
    const actor = _resolveHostActor(host);
    if (!actor) return;
    if (!game?.user?.isGM && !actor.isOwner) return;

    const marker = _hostMarker(host);
    const expected = collectExpectedSlotEffects(host);
    const existing = (actor.effects ?? []).filter(effect => _effectBelongsToHost(effect, marker));
    const expectedByTag = new Map(expected.map(record => [record.tag, record]));
    const existingByTag = new Map(existing.map(effect => [effect.flags.sd[SD_SLOT_EFFECT_FLAG].tag, effect]));

    const toDelete = [];
    for (const [tag, effect] of existingByTag) {
      if (!expectedByTag.has(tag)) toDelete.push(effect.id);
    }

    const toCreate = [];
    const toUpdate = [];
    for (const [tag, record] of expectedByTag) {
      const effect = existingByTag.get(tag);
      if (!effect) {
        toCreate.push(record.data);
      } else if (_needsUpdate(effect, record)) {
        toUpdate.push({ _id: effect.id, ...record.data });
      }
    }

    try {
      if (toDelete.length) await actor.deleteEmbeddedDocuments("ActiveEffect", toDelete);
      if (toCreate.length) await actor.createEmbeddedDocuments("ActiveEffect", toCreate);
      if (toUpdate.length) await actor.updateEmbeddedDocuments("ActiveEffect", toUpdate);
    } catch (error) {
      console.warn("SD | SlotEffectSync.sync failed:", error);
    }
  }

  static async cleanupFor(host) {
    const actor = _resolveHostActor(host);
    if (!actor) return;
    if (!game?.user?.isGM && !actor.isOwner) return;
    const marker = _hostMarker(host);
    const existing = (actor.effects ?? []).filter(effect => _effectBelongsToHost(effect, marker));
    if (!existing.length) return;
    try {
      await actor.deleteEmbeddedDocuments("ActiveEffect", existing.map(effect => effect.id));
    } catch (error) {
      console.warn("SD | SlotEffectSync.cleanupFor failed:", error);
    }
  }

  static async cleanupOrphans(actor) {
    if (!actor) return;
    if (!game?.user?.isGM && !actor.isOwner) return;
    const orphans = (actor.effects ?? []).filter(effect => {
      const flag = effect?.flags?.sd?.[SD_SLOT_EFFECT_FLAG];
      if (!flag) return false;
      const hostType = String(flag.hostDocumentName ?? "Item");
      const hostId = String(flag.hostId ?? flag.parentItemId ?? "");
      if (hostType === "Actor") return hostId !== String(actor.id);
      return !actor.items?.get?.(hostId);
    });
    if (!orphans.length) return;
    try {
      await actor.deleteEmbeddedDocuments("ActiveEffect", orphans.map(effect => effect.id));
    } catch (error) {
      console.warn("SD | SlotEffectSync.cleanupOrphans failed:", error);
    }
  }

  static async syncActor(actor) {
    if (!actor) return;
    if (_hostHasSlots(actor)) await this.sync(actor);
    for (const item of actor.items ?? []) {
      if (_hostHasSlots(item)) await this.sync(item);
    }
    await this.cleanupOrphans(actor);
  }

  static _shouldRunSync(userId) {
    const activeGM = game.users?.activeGM ?? null;
    if (activeGM) return activeGM.isSelf === true;
    return userId === game.user?.id;
  }

  static install() {
    Hooks.on("updateItem", (item, _changes, _opts, userId) => {
      if (!SlotEffectSync._shouldRunSync(userId) || !item?.actor || !_hostHasSlots(item)) return;
      this.sync(item).catch(error => console.warn("SD | slot-effects sync (updateItem) failed:", error));
    });

    Hooks.on("createItem", (item, _opts, userId) => {
      if (!SlotEffectSync._shouldRunSync(userId) || !item?.actor || !_hostHasSlots(item)) return;
      this.sync(item).catch(error => console.warn("SD | slot-effects sync (createItem) failed:", error));
    });

    Hooks.on("updateActor", (actor, _changes, _opts, userId) => {
      if (!SlotEffectSync._shouldRunSync(userId) || !_hostHasSlots(actor)) return;
      this.sync(actor).catch(error => console.warn("SD | slot-effects sync (updateActor) failed:", error));
    });

    Hooks.on("preDeleteItem", item => {
      if (!item?.actor) return;
      if (game.users?.activeGM ? !game.users.activeGM.isSelf : !game.user?.isGM) return;
      this.cleanupFor(item).catch(error => console.warn("SD | slot-effects cleanup (preDeleteItem) failed:", error));
    });

    Hooks.once("ready", () => {
      if (!game.user?.isGM) return;
      try {
        for (const actor of game.actors ?? []) this.syncActor(actor).catch(() => {});
      } catch {}
    });
  }
}
