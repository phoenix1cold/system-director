const {
  StringField, NumberField, BooleanField,
  ArrayField, ObjectField, SchemaField
} = foundry.data.fields;

export function SlotDefinitionField() {
  return new SchemaField({
    id:                new StringField({ required: true, blank: false, initial: "slot1" }),
    label:             new StringField({ initial: "Slot", blank: false }),
    allowedTypes:      new ArrayField(new StringField({ blank: false })),
    allowedCategories: new ArrayField(new StringField({ blank: false })),
    attrFilters: new ArrayField(new SchemaField({
      id:            new StringField({ required: true, blank: false, initial: () => foundry.utils.randomID(8) }),
      fieldPath:     new StringField({ initial: "", blank: true }),
      fieldLabel:    new StringField({ initial: "", blank: true }),
      operator:      new StringField({ initial: "==", blank: false }),
      expectedValue: new StringField({ initial: "", blank: true })
    })),
    maxCount:        new NumberField({ required: true, integer: true, initial: 1, min: 1, nullable: false }),
    displayMode:     new StringField({ initial: "compact", choices: ["compact","full","icon"] }),
    removable:       new BooleanField({ initial: true }),
    consumeOnRemove: new BooleanField({ initial: false }),
    placeholderIcon: new StringField({ initial: "", blank: true }),
    accentColor:     new StringField({ initial: "", blank: true }),
    changes: new ArrayField(new SchemaField({
      id:             new StringField({ required: true, blank: false, initial: () => foundry.utils.randomID(8) }),
      itemFieldPath:  new StringField({ initial: "", blank: true }),
      actorFieldPath: new StringField({ initial: "", blank: true }),
      mode:           new NumberField({ required: true, integer: true, initial: 2, min: 0, max: 5, nullable: false }),
      priority:       new NumberField({ required: true, integer: true, initial: 20, nullable: false })
    }))
  });
}

export function SlotContentField() {
  return new SchemaField({
    contents: new ArrayField(new ObjectField()),
    count:    new NumberField({ required: true, integer: true, initial: 0, min: 0, nullable: false })
  });
}

export class SlotManager {

  static _slotAutoEquip(parentDoc, sid) {
    const scan = (widgets) => {
      for (const w of widgets ?? []) {
        if (w?.type === "slot" && String(w.slotId ?? "") === sid && w.autoEquip) return true;
        if (w?.type === "vsection" && scan(w.widgets)) return true;
      }
      return false;
    };
    for (const tab of parentDoc?.system?.customTabs ?? []) {
      for (const row of tab.rows ?? []) if (scan(row.widgets)) return true;
    }
    return false;
  }

  static async addToSlot(parentItem, slotId, droppedItem) {
    const sid = String(slotId ?? "");
    const def = this.getDefinition(parentItem, sid);
    CONFIG.debug?.sd && console.log("[SD] SlotManager.addToSlot | parent:", parentItem?.name??parentItem?.id, "sid:", sid, "item:", droppedItem?.name, "def:", def ? {id:def.id,maxCount:def.maxCount} : "NOT FOUND");
    if (!def) throw new Error(`Slot "${sid}" not found on ${parentItem?.name ?? "unknown"}`);

    const contents = this.getContents(parentItem, sid);

    if (contents.length >= def.maxCount) {
      ui.notifications.warn(`Slot "${def.label}" is full (max ${def.maxCount}).`);
      return null;
    }

    const itemData = droppedItem instanceof Item ? droppedItem.toObject() : droppedItem;
    if (droppedItem instanceof Item && droppedItem.uuid) {
      itemData._sourceUuid = droppedItem.uuid;
    }

    if (def.allowedTypes.length && !def.allowedTypes.includes(itemData.type)) {
      ui.notifications.warn(`Slot "${def.label}" only accepts types: ${def.allowedTypes.join(", ")}`);
      return null;
    }

    if (def.allowedCategories.length && !def.allowedCategories.includes(itemData.system?.category)) {
      ui.notifications.warn(`Slot "${def.label}" only accepts categories: ${def.allowedCategories.join(", ")}`);
      return null;
    }

    if ((def.attrFilters ?? []).length > 0) {
      const { AttrFilter } = await import("../builder/attr-ref.mjs");
      const { pass, failed } = AttrFilter.check(itemData, def);
      if (!pass) {
        ui.notifications.warn(`"${itemData.name}" blocked by slot filter: ${failed.join("; ")}`);
        return null;
      }
    }

    if (this._slotAutoEquip(parentItem, sid) && itemData.type === "inventory" && itemData.system?.equippable && !itemData.system?.equipped) {
      foundry.utils.setProperty(itemData, "system.equipped", true);
      if (droppedItem instanceof Item && droppedItem.parent?.items?.has?.(droppedItem.id)) {
        try { await droppedItem.update({ "system.equipped": true }); }
        catch (e) { console.warn("SD | slot auto-equip failed:", e); }
      }
    }

    const newContents = [...contents, itemData];
    return parentItem.update({
      [`system.slotContents.${sid}.contents`]: newContents,
      [`system.slotContents.${sid}.count`]:    newContents.length
    });
  }

  static async removeFromSlot(parentItem, slotId, index) {
    const sid = String(slotId ?? "");
    const def = this.getDefinition(parentItem, sid);
    CONFIG.debug?.sd && console.log("[SD] SlotManager.removeFromSlot | parent:", parentItem?.name??parentItem?.id, "sid:", sid, "index:", index, "def:", def ? {id:def.id,removable:def.removable} : "NOT FOUND");
    if (def && def.removable === false) {
      console.warn("[SD] SlotManager.removeFromSlot: BLOCKED — slot is not removable. sid=", sid);
      return null;
    }

    const contents = [...this.getContents(parentItem, sid)];
    if (!def && contents.length === 0) {
      console.warn("[SD] SlotManager.removeFromSlot: nothing to remove (no def and empty contents). sid=", sid);
      return null;
    }
    CONFIG.debug?.sd && console.log("[SD] SlotManager.removeFromSlot | contents before:", contents.length, contents.map(c=>c.name??c._id));
    contents.splice(index, 1);
    CONFIG.debug?.sd && console.log("[SD] SlotManager.removeFromSlot | contents after:", contents.length);

    return parentItem.update({
      [`system.slotContents.${sid}.contents`]: contents,
      [`system.slotContents.${sid}.count`]:    contents.length
    });
  }

  static async updateSlottedField(parentItem, slotId, index, fieldPath, value) {
    const sid = String(slotId ?? "");
    const contents = foundry.utils.deepClone(this.getContents(parentItem, sid));
    if (!contents[index]) return null;
    foundry.utils.setProperty(contents[index], fieldPath, value);
    return parentItem.update({ [`system.slotContents.${sid}.contents`]: contents });
  }

  static getDefinition(parentItem, slotId) {
    const sid = String(slotId ?? "");
    return (parentItem?.system?.slotDefinitions ?? []).find(d => String(d.id) === sid);
  }

  static getContents(parentItem, slotId) {
    const sid = String(slotId ?? "");
    return parentItem?.system?.slotContents?.[sid]?.contents ?? [];
  }

  static resolveSlotPath(parentItem, path) {
    const match = path.match(/^slots\.([^.]+)\.(\d+)\.(.+)$/);
    if (!match) return undefined;
    const [, slotId, idx, fieldPath] = match;
    const item = this.getContents(parentItem, slotId)[parseInt(idx)];
    return item ? foundry.utils.getProperty(item, fieldPath) : undefined;
  }

  static async setSlotPath(parentItem, path, value) {
    const match = path.match(/^slots\.([^.]+)\.(\d+)\.(.+)$/);
    if (!match) return;
    const [, slotId, idx, fieldPath] = match;
    await this.updateSlottedField(parentItem, slotId, parseInt(idx), fieldPath, value);
  }

  static prepareForSheet(item) {
    return (item.system.slotDefinitions ?? []).map(def => {
      const contents = this.getContents(item, def.id).map((c, i) => ({
        ...c, _slotIndex: i, _slotId: def.id
      }));
      return { def, contents, count: contents.length, isFull: contents.length >= def.maxCount, isEmpty: contents.length === 0 };
    });
  }

  static _SLOT_NODE_TYPES = new Set([
    "slot_count",
    "act_add_to_slot",
    "act_remove_from_slot",
    "act_use_slot_item",
    "act_modify_slot_item_field",
    "get_slot_item",
    "get_slot_uuid",
    "get_actor_slot_id",
    "inv_item_slot_count",
    "inv_use_slot_item",
    "inv_add_to_slot"
  ]);

  static _purgeSlotFromGraph(graph, slotId) {
    if (!graph || typeof graph !== "object") return false;
    const nodes = graph.nodes;
    const edges = graph.edges;
    if (!Array.isArray(nodes) || !nodes.length) return false;
    const sid = String(slotId);
    const removedIds = new Set();
    const kept = [];
    for (const n of nodes) {
      if (this._SLOT_NODE_TYPES.has(n?.type) && String(n?.data?.slotId ?? "") === sid) {
        removedIds.add(n.id);
        continue;
      }
      kept.push(n);
    }
    if (!removedIds.size) return false;
    graph.nodes = kept;
    if (Array.isArray(edges)) {
      graph.edges = edges.filter(e => !removedIds.has(e.fromNode) && !removedIds.has(e.toNode));
    }
    return true;
  }

  static _purgeSlotFromWidgets(widgets, slotId) {
    if (!Array.isArray(widgets)) return false;
    let changed = false;
    for (const w of widgets) {
      if (!w || typeof w !== "object") continue;
      if (this._purgeSlotFromGraph(w.graphData, slotId)) changed = true;
      if (this._purgeSlotFromGraph(w.configGraph, slotId)) changed = true;
      if (this._purgeSlotFromGraph(w.onClickGraph, slotId)) changed = true;
      if (w.attrGraphs && typeof w.attrGraphs === "object") {
        for (const k of Object.keys(w.attrGraphs)) {
          const ag = w.attrGraphs[k];
          if (this._purgeSlotFromGraph(ag?.graphData, slotId)) changed = true;
        }
      }
      if (Array.isArray(w.widgets)) {
        if (this._purgeSlotFromWidgets(w.widgets, slotId)) changed = true;
      }
    }
    return changed;
  }

  static buildSlotPurgeUpdates(doc, slotId) {
    const sid = String(slotId ?? "");
    if (!sid) return null;
    const updates = {};
    const tabs = foundry.utils.deepClone(doc?.system?.customTabs ?? []);
    let tabsChanged = false;
    for (const t of tabs) {
      for (const r of (t.rows ?? [])) {
        if (this._purgeSlotFromWidgets(r.widgets, sid)) tabsChanged = true;
      }
    }
    if (tabsChanged) updates["system.customTabs"] = tabs;

    const ocg = foundry.utils.deepClone(doc?.system?.onClickGraph ?? null);
    if (ocg && this._purgeSlotFromGraph(ocg, sid)) {
      updates["system.onClickGraph"] = ocg;
      updates["system.onClickFormula"] = "0";
    }

    const stg = foundry.utils.deepClone(doc?.system?.sdTriggerGraph ?? null);
    if (stg && stg._graphData && this._purgeSlotFromGraph(stg._graphData, sid)) {
      updates["system.sdTriggerGraph"] = stg;
    }

    return Object.keys(updates).length ? updates : null;
  }
}
