const {
  StringField, NumberField, BooleanField,
  ArrayField, ObjectField, SchemaField
} = foundry.data.fields;

// Schema fields

export function SlotDefinitionField() {
  return new SchemaField({
    id:                new StringField({ required: true, blank: false, initial: "slot1" }),
    label:             new StringField({ initial: "Slot", blank: false }),
    allowedTypes:      new ArrayField(new StringField({ blank: false })),
    allowedCategories: new ArrayField(new StringField({ blank: false })),
    // Attribute filters: check hidden fields on dropped items
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
    consumeOnRemove: new BooleanField({ initial: false })
  });
}

export function SlotContentField() {
  return new SchemaField({
    contents: new ArrayField(new ObjectField()),
    count:    new NumberField({ required: true, integer: true, initial: 0, min: 0, nullable: false })
  });
}

// SlotManager

export class SlotManager {

  static async addToSlot(parentItem, slotId, droppedItem) {
    const sid = String(slotId ?? "");
    const def = this.getDefinition(parentItem, sid);
    CONFIG.debug?.sd && console.log("[SD] SlotManager.addToSlot | parent:", parentItem?.name??parentItem?.id, "sid:", sid, "item:", droppedItem?.name, "def:", def ? {id:def.id,maxCount:def.maxCount} : "NOT FOUND");
    if (!def) throw new Error(`Slot "${sid}" not found on ${parentItem?.name ?? "unknown"}`);

    const contents = this.getContents(parentItem, sid);

    // Capacity
    if (contents.length >= def.maxCount) {
      ui.notifications.warn(`Slot "${def.label}" is full (max ${def.maxCount}).`);
      return null;
    }

    const itemData = droppedItem instanceof Item ? droppedItem.toObject() : droppedItem;
    // uuid is a computed getter -- toObject() doesn't include it, so store it explicitly
    // so edit/use buttons can always find the live document via fromUuid()
    if (droppedItem instanceof Item && droppedItem.uuid) {
      itemData._sourceUuid = droppedItem.uuid;
    }

    // Type restriction
    if (def.allowedTypes.length && !def.allowedTypes.includes(itemData.type)) {
      ui.notifications.warn(`Slot "${def.label}" only accepts types: ${def.allowedTypes.join(", ")}`);
      return null;
    }

    // Category restriction
    if (def.allowedCategories.length && !def.allowedCategories.includes(itemData.system?.category)) {
      ui.notifications.warn(`Slot "${def.label}" only accepts categories: ${def.allowedCategories.join(", ")}`);
      return null;
    }

    // Attribute filter check (hidden fields)
    if ((def.attrFilters ?? []).length > 0) {
      const { AttrFilter } = await import("../builder/attr-ref.mjs");
      const { pass, failed } = AttrFilter.check(itemData, def);
      if (!pass) {
        ui.notifications.warn(`"${itemData.name}" blocked by slot filter: ${failed.join("; ")}`);
        return null;
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
    if (!def?.removable) {
      console.warn("[SD] SlotManager.removeFromSlot: BLOCKED — def not found or not removable. def=", def);
      return null;
    }

    const contents = [...this.getContents(parentItem, sid)];
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
    // Normalize to string -- widget slotId can be configured as "33" (string) or 33 (number)
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
}
