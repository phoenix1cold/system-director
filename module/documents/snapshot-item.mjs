export class SnapshotItem extends Item {

  /**
   * Open an editable sheet for a slot snapshot.
   *
   * @param {object}  snapshot    -- raw snapshot data from slotContents.contents[idx]
   * @param {Item}    parentItem  -- the live Foundry Item that owns the slot
   * @param {string}  slotId     -- slot id on parentItem
   * @param {number}  slotIndex  -- index of this snapshot in the slot contents array
   */
  static async openForSnapshot(snapshot, parentItem, slotId, slotIndex) {
    if (!snapshot || !parentItem) return null;

    const cls  = getDocumentClass("Item");
    const data = foundry.utils.deepClone(snapshot);
    if (!data._id) data._id = foundry.utils.randomID();

    const snapId = data._id;

    const tempItem = new cls(data, { parent: null });

    const _getContents = (item, sid) =>
      item?.system?.slotContents?.[String(sid)]?.contents ?? [];

    const _refresh = () => {
      const freshContents = _getContents(parentItem, slotId);

      const freshSnap =
        freshContents.find(c => (c._id ?? c.id) === snapId) ??
        freshContents[slotIndex] ??
        null;

      if (!freshSnap) {
        tempItem.sheet?.close();
        return;
      }

      const preserved = { _id: tempItem._id };
      foundry.utils.mergeObject(
        tempItem._source,
        { ...freshSnap, ...preserved },
        { insertKeys: false, insertValues: false, overwrite: true }
      );
      if (tempItem.system && freshSnap.system) {
        const freshSystem = foundry.utils.deepClone(freshSnap.system);
        for (const key of Object.keys(freshSystem)) {
          try { tempItem.system[key] = freshSystem[key]; } catch {}
        }
      }

      const s = tempItem.sheet;
      if (s) {
        if (typeof s.render === "function") {
          try { s.render(true); } catch { try { s.render({ force: true }); } catch {} }
        }
      }
    };

    let _hookId = Hooks.on("updateItem", (doc, changes, options, userId) => {
      if (doc.uuid !== parentItem.uuid) return;
      _refresh();
    });

    tempItem.update = async function(changes, options = {}) {
      // FIX 2
      const expanded = foundry.utils.expandObject(changes);

      foundry.utils.mergeObject(this._source, expanded,
        { insertKeys: true, insertValues: true });
      foundry.utils.mergeObject(this.system, expanded.system ?? {},
        { insertKeys: true, insertValues: true });

      const { SlotManager } = await import("../data/item-slots.mjs");
      const contents = [...(_getContents(parentItem, slotId))];
      if (!contents[slotIndex]) return;

      foundry.utils.mergeObject(contents[slotIndex], expanded,
        { insertKeys: true, insertValues: true });
      await parentItem.update({
        [`system.slotContents.${slotId}.contents`]: contents
      });

      return this;
    };

    const sheet = tempItem.sheet;
    if (sheet) {
      const _origClose = sheet.close.bind(sheet);
      sheet.close = async function(...args) {
        if (_hookId !== null) {
          Hooks.off("updateItem", _hookId);
          _hookId = null;
        }
        return _origClose(...args);
      };
    }

    // Render the sheet
    tempItem.sheet.render(true);
    return tempItem;
  }
}
