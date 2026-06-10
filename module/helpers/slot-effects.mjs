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

function _buildExpectedEffects(parentItem) {
  const out = [];
  const defs = parentItem?.system?.slotDefinitions ?? [];
  for (const def of defs) {
    const changes = (def.changes ?? []).filter(c => c?.itemFieldPath && c?.actorFieldPath);
    if (!changes.length) continue;

    const contents = parentItem.system?.slotContents?.[def.id]?.contents ?? [];
    for (let i = 0; i < contents.length; i++) {
      const slotted = contents[i];
      const itemKey = slotted?._id ?? `idx${i}`;
      const tag = `${parentItem.id}|${def.id}|${itemKey}|${i}`;

      const aeChanges = changes.map(ch => {
        const raw = foundry.utils.getProperty(slotted, ch.itemFieldPath);
        return {
          key:      String(ch.actorFieldPath),
          mode:     Number.isFinite(Number(ch.mode)) ? Number(ch.mode) : _AE_MODES.ADD,
          value:    raw === undefined || raw === null ? "0" : String(raw),
          priority: Number.isFinite(Number(ch.priority)) ? Number(ch.priority) : 20
        };
      });

      out.push({
        tag,
        parentItemId: parentItem.id,
        slotId:       def.id,
        itemKey,
        index:        i,
        name:         `[Slot: ${def.label ?? def.id}] ${slotted?.name ?? "Item"}`,
        img:          slotted?.img ?? "icons/svg/aura.svg",
        changes:      aeChanges
      });
    }
  }
  return out;
}

function _changesEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    if (String(x.key) !== String(y.key)) return false;
    if (Number(x.mode) !== Number(y.mode)) return false;
    if (String(x.value) !== String(y.value)) return false;
    if (Number(x.priority ?? 20) !== Number(y.priority ?? 20)) return false;
  }
  return true;
}

export class SlotEffectSync {

  static async sync(parentItem) {
    if (!parentItem) return;
    const actor = parentItem.actor;
    if (!actor) return;
    if (!game?.user?.isGM) return;

    const expected = _buildExpectedEffects(parentItem);
    const existing = actor.effects.filter(ae => ae.flags?.sd?.[SD_SLOT_EFFECT_FLAG]?.parentItemId === parentItem.id);

    const expectedByTag = new Map(expected.map(e => [e.tag, e]));
    const existingByTag = new Map(existing.map(ae => [ae.flags.sd[SD_SLOT_EFFECT_FLAG].tag, ae]));

    const toDelete = [];
    for (const [tag, ae] of existingByTag) {
      if (!expectedByTag.has(tag)) toDelete.push(ae.id);
    }

    const toCreate = [];
    const toUpdate = [];
    for (const [tag, exp] of expectedByTag) {
      const ae = existingByTag.get(tag);
      if (!ae) {
        toCreate.push({
          name:      exp.name,
          img:       exp.img,
          icon:      exp.img,
          changes:   exp.changes,
          disabled:  false,
          transfer:  false,
          flags: {
            sd: {
              [SD_SLOT_EFFECT_FLAG]: {
                tag:          exp.tag,
                parentItemId: exp.parentItemId,
                slotId:       exp.slotId,
                itemKey:      exp.itemKey,
                index:        exp.index
              }
            }
          }
        });
        continue;
      }

      const dataChanges = (ae.changes ?? []).map(c => ({
        key: String(c.key), mode: Number(c.mode), value: String(c.value), priority: Number(c.priority ?? 20)
      }));
      const nameMatches = ae.name === exp.name;
      const imgMatches  = (ae.img ?? ae.icon) === exp.img;

      if (!_changesEqual(dataChanges, exp.changes) || !nameMatches || !imgMatches) {
        toUpdate.push({
          _id:     ae.id,
          name:    exp.name,
          img:     exp.img,
          icon:    exp.img,
          changes: exp.changes
        });
      }
    }

    try {
      if (toDelete.length) await actor.deleteEmbeddedDocuments("ActiveEffect", toDelete);
      if (toCreate.length) await actor.createEmbeddedDocuments("ActiveEffect", toCreate);
      if (toUpdate.length) await actor.updateEmbeddedDocuments("ActiveEffect", toUpdate);
    } catch (err) {
      console.warn("SD | SlotEffectSync.sync failed:", err);
    }
  }

  static async cleanupFor(parentItem) {
    if (!parentItem?.actor) return;
    if (!game?.user?.isGM) return;
    const existing = parentItem.actor.effects.filter(ae =>
      ae.flags?.sd?.[SD_SLOT_EFFECT_FLAG]?.parentItemId === parentItem.id);
    if (!existing.length) return;
    try {
      await parentItem.actor.deleteEmbeddedDocuments("ActiveEffect", existing.map(ae => ae.id));
    } catch (err) {
      console.warn("SD | SlotEffectSync.cleanupFor failed:", err);
    }
  }

  static async cleanupOrphans(actor) {
    if (!actor) return;
    if (!game?.user?.isGM) return;
    const orphans = actor.effects.filter(ae => {
      const tag = ae.flags?.sd?.[SD_SLOT_EFFECT_FLAG];
      if (!tag?.parentItemId) return false;
      return !actor.items.get(tag.parentItemId);
    });
    if (!orphans.length) return;
    try {
      await actor.deleteEmbeddedDocuments("ActiveEffect", orphans.map(ae => ae.id));
    } catch (err) {
      console.warn("SD | SlotEffectSync.cleanupOrphans failed:", err);
    }
  }

  static async syncActor(actor) {
    if (!actor) return;
    for (const item of actor.items) {
      const defs = item.system?.slotDefinitions ?? [];
      if (!defs.some(d => (d.changes ?? []).length)) continue;
      await this.sync(item);
    }
    await this.cleanupOrphans(actor);
  }

  static install() {
    Hooks.on("updateItem", (item, _changes, _opts, userId) => {
      if (userId !== game.user?.id) return;
      if (!item?.actor) return;
      const defs = item.system?.slotDefinitions ?? [];
      if (!defs.some(d => (d.changes ?? []).length)) return;
      this.sync(item).catch(e => console.warn("SD | slot-effects sync (updateItem) failed:", e));
    });

    Hooks.on("createItem", (item, _opts, userId) => {
      if (userId !== game.user?.id) return;
      if (!item?.actor) return;
      const defs = item.system?.slotDefinitions ?? [];
      if (!defs.some(d => (d.changes ?? []).length)) return;
      this.sync(item).catch(e => console.warn("SD | slot-effects sync (createItem) failed:", e));
    });

    Hooks.on("preDeleteItem", (item) => {
      if (!item?.actor) return;
      if (!game.user?.isGM) return;
      const aes = item.actor.effects.filter(ae => ae.flags?.sd?.[SD_SLOT_EFFECT_FLAG]?.parentItemId === item.id);
      if (!aes.length) return;
      item.actor.deleteEmbeddedDocuments("ActiveEffect", aes.map(ae => ae.id))
        .catch(e => console.warn("SD | slot-effects cleanup (preDeleteItem) failed:", e));
    });

    Hooks.once("ready", () => {
      if (!game.user?.isGM) return;
      try {
        for (const actor of (game.actors ?? [])) this.syncActor(actor).catch(() => {});
      } catch {}
    });
  }
}
