/**
 * module/documents/snapshot-item.mjs
 *
 * A temporary in-memory Item document backed by a slot snapshot.
 * When the user edits and saves it, changes are written back to
 * the parent item's slotContents instead of to any database record.
 *
 * Fixes applied:
 *  1. Registers a Hooks.on("updateItem") on parentItem so the sheet
 *     automatically re-renders whenever the live parent updates its
 *     slotContents (e.g. after removeFromSlot / addToSlot on a nested item).
 *  2. Calls foundry.utils.expandObject(changes) in update() before
 *     merging, because Foundry passes dot-notation keys such as
 *     "system.slotContents.2.contents" that mergeObject does NOT expand
 *     -- without this, drag-dropped items end up as literal string keys
 *     on the snapshot object and are lost on the next re-render.
 */

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

    // Create a synthetic item in-memory (no DB write).
    // IMPORTANT: pass parent: null (not the actor) so Foundry does NOT
    // register tempItem in actor.items.  If we pass the actor as parent,
    // Foundry adds the item to the in-memory EmbeddedCollection, and then
    // SDItem._onUpdate iterates actor.items, finds tempItem, and calls
    // actor.updateEmbeddedDocuments([{ _id: tempItem.id }]) -- which throws
    // "undefined id does not exist in the EmbeddedCollection" because the
    // item was never persisted to the database.
    // tempItem.update() is fully overridden below, so it doesn't need actor
    // context for saving; roll data still works via explicit getRollData().
    const tempItem = new cls(data, { parent: null });

    // Inline getContents -- avoids async import inside the hot hook path
    const _getContents = (item, sid) =>
      item?.system?.slotContents?.[String(sid)]?.contents ?? [];

    // Refresh tempItem's in-memory state from the live parentItem
    // Called whenever parentItem receives an updateItem event so that the
    // open snapshot sheet always reflects the current server-side data.
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

      // Overwrite all in-memory state with the fresh snapshot, preserving _id.
      // Use insertKeys:false on _source because Foundry V12+ seals it as
      // non-extensible -- adding new properties (e.g. _sourceUuid) throws a
      // TypeError.  We only need to overwrite existing top-level fields and
      // let the system merge (below) handle nested schema data.
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

      // Force full re-render so new/removed slot contents appear immediately.
      // render(false) in ApplicationV2 only re-renders if nothing changed --
      // passing true (force) ensures the DOM is always rebuilt from fresh data.
      const s = tempItem.sheet;
      if (s) {
        if (typeof s.render === "function") {
          try { s.render(true); } catch { try { s.render({ force: true }); } catch {} }
        }
      }
    };

    // Hook: watch parentItem for server-side updates
    // This fires after removeFromSlot / addToSlot (or any other code) writes
    // new slotContents to parentItem, keeping the snapshot sheet in sync.
    let _hookId = Hooks.on("updateItem", (doc, changes, options, userId) => {
      // Only react to the exact parentItem, identified by uuid for safety.
      if (doc.uuid !== parentItem.uuid) return;
      _refresh();
    });

    // Override update() -- writes edits back to the slot snapshot
    tempItem.update = async function(changes, options = {}) {
      // FIX 2: Expand dot-notation keys BEFORE merging.
      // Foundry's SlotManager (and other callers) passes flat paths like
      // "system.slotContents.2.contents" which mergeObject treats as a
      // literal string key rather than a nested path.  expandObject turns
      // them into the proper nested structure first.
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

    // Clean up the hook when the sheet is closed
    // Wrap close() so we remove the updateItem listener when the user shuts
    // the snapshot editor.  Works for both ApplicationV1 and ApplicationV2.
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
