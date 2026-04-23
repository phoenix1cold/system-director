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

    // Build a temporary Item from the snapshot data.
    // We do NOT embed it in the actor -- it lives only in memory.
    const cls  = getDocumentClass("Item");
    const data = foundry.utils.deepClone(snapshot);
    // Ensure it has a valid _id so Foundry doesn't complain
    if (!data._id) data._id = foundry.utils.randomID();

    // Capture the snapshot's _id so _refresh can find it by identity
    // rather than by index (index can shift if siblings are added/removed).
    const snapId = data._id;

    // Create a synthetic item in-memory (no DB write)
    const tempItem = new cls(data, { parent: null });

    // Inline getContents -- avoids async import inside the hot hook path
    const _getContents = (item, sid) =>
      item?.system?.slotContents?.[String(sid)]?.contents ?? [];

    const _refresh = () => {
      const freshContents = _getContents(parentItem, slotId);

      // Prefer lookup by _id (robust against index shifts).
      const freshSnap =
        freshContents.find(c => (c._id ?? c.id) === snapId) ??
        freshContents[slotIndex] ??
        null;

      if (!freshSnap) {
        // The snapshot was removed -- close the editor gracefully.
        tempItem.sheet?.close();
        return;
      }

      // Overwrite all in-memory state with the fresh snapshot, preserving _id
      const preserved = { _id: tempItem._id };
      foundry.utils.mergeObject(
        tempItem._source,
        { ...freshSnap, ...preserved },
        { insertKeys: false, insertValues: false, overwrite: true }
      );
      // system is a plain mutable object -- safe to insert new keys here.
      if (tempItem.system && freshSnap.system) {
        // Use a full deepClone replacement so deleted slot entries are also removed,
        // not just overwritten -- avoids stale slot rows after removeFromSlot.
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
      // Only react to the exact parentItem, identified by uuid for safety.
      if (doc.uuid !== parentItem.uuid) return;
      _refresh();
    });

    // Override update() -- writes edits back to the slot snapshot
    tempItem.update = async function(changes, options = {}) {
      // FIX 2
      const expanded = foundry.utils.expandObject(changes);

      foundry.utils.mergeObject(this._source, expanded,
        { insertKeys: true, insertValues: true });
      foundry.utils.mergeObject(this.system, expanded.system ?? {},
        { insertKeys: true, insertValues: true });

      // Read the current slot contents fresh (avoid stale reference)
      const { SlotManager } = await import("../data/item-slots.mjs");
      const contents = [...(_getContents(parentItem, slotId))];
      if (!contents[slotIndex]) return;

      foundry.utils.mergeObject(contents[slotIndex], expanded,
        { insertKeys: true, insertValues: true });
      await parentItem.update({
        [`system.slotContents.${slotId}.contents`]: contents
      });

      // The updateItem hook above will fire after parentItem.update() and
      // re-render this sheet -- no need to call render() here explicitly.
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
