import { createWidget } from "./widget-registry.mjs";

export class GridManager {

  // Tab CRUD

  static getTabs(doc) {
    return doc.system.customTabs ?? [];
  }

  static async addTab(doc, overrides = {}) {
    const tabs = foundry.utils.deepClone(this.getTabs(doc));
    const tab = {
      id:    foundry.utils.randomID(8),
      label: "New Tab",
      icon:  "fa-star",
      order: tabs.length + 1,
      rows:  [],
      ...overrides
    };
    tabs.push(tab);
    await doc.update({ "system.customTabs": tabs });
    return tab;
  }

  static async updateTab(doc, tabId, changes) {
    const tabs = foundry.utils.deepClone(this.getTabs(doc));
    const idx  = tabs.findIndex(t => t.id === tabId);
    if (idx < 0) return;
    foundry.utils.mergeObject(tabs[idx], changes);
    await doc.update({ "system.customTabs": tabs });
  }

  static async removeTab(doc, tabId) {
    const tabs = foundry.utils.deepClone(this.getTabs(doc));
    const next = tabs.filter(t => t.id !== tabId);
    await doc.update({ "system.customTabs": next });
  }

  // Row CRUD

  static async addRow(doc, tabId, afterRowId = null) {
    const tabs  = foundry.utils.deepClone(this.getTabs(doc));
    const tab   = tabs.find(t => t.id === tabId);
    if (!tab) return;
    const row = { id: foundry.utils.randomID(8), widgets: [] };
    if (afterRowId) {
      const idx = tab.rows.findIndex(r => r.id === afterRowId);
      tab.rows.splice(idx + 1, 0, row);
    } else {
      tab.rows.push(row);
    }
    await doc.update({ "system.customTabs": tabs });
    return row;
  }

  static async removeRow(doc, tabId, rowId) {
    const tabs = foundry.utils.deepClone(this.getTabs(doc));
    const tab  = tabs.find(t => t.id === tabId);
    if (!tab) return;
    tab.rows = tab.rows.filter(r => r.id !== rowId);
    await doc.update({ "system.customTabs": tabs });
  }

  static async moveRow(doc, tabId, rowId, direction) {
    const tabs = foundry.utils.deepClone(this.getTabs(doc));
    const tab  = tabs.find(t => t.id === tabId);
    if (!tab) return;
    const idx  = tab.rows.findIndex(r => r.id === rowId);
    const newIdx = direction === "up" ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= tab.rows.length) return;
    [tab.rows[idx], tab.rows[newIdx]] = [tab.rows[newIdx], tab.rows[idx]];
    await doc.update({ "system.customTabs": tabs });
  }

  // Widget CRUD

  static async addWidget(doc, tabId, rowId, widgetType, overrides = {}) {
    const tabs    = foundry.utils.deepClone(this.getTabs(doc));
    const tab     = tabs.find(t => t.id === tabId);
    if (!tab) return;
    const row = tab.rows.find(r => r.id === rowId);
    if (!row) return;
    const widget  = createWidget(widgetType, overrides);
    row.widgets.push(widget);
    await doc.update({ "system.customTabs": tabs });
    return widget;
  }

  static async updateWidget(doc, tabId, rowId, widgetId, changes) {
    const tabs = foundry.utils.deepClone(this.getTabs(doc));
    const tab  = tabs.find(t => t.id === tabId);
    if (!tab) return;
    const row  = tab.rows.find(r => r.id === rowId);
    if (!row) return;
    const w    = row.widgets.find(w => w.id === widgetId);
    if (!w) return;
    Object.assign(w, changes);
    await doc.update({ "system.customTabs": tabs });
  }

  static async removeWidget(doc, tabId, rowId, widgetId) {
    const tabs = foundry.utils.deepClone(this.getTabs(doc));
    const tab  = tabs.find(t => t.id === tabId);
    if (!tab) return;
    const row  = tab.rows.find(r => r.id === rowId);
    if (!row) return;
    row.widgets = row.widgets.filter(w => w.id !== widgetId);
    await doc.update({ "system.customTabs": tabs });
  }

  /** Move widget from one row/position to another */
  static async moveWidget(doc, tabId, fromRowId, toRowId, widgetId, toIndex) {
    const tabs    = foundry.utils.deepClone(this.getTabs(doc));
    const tab     = tabs.find(t => t.id === tabId);
    if (!tab) return;
    const fromRow = tab.rows.find(r => r.id === fromRowId);
    const toRow   = tab.rows.find(r => r.id === toRowId);
    if (!fromRow || !toRow) return;
    const wIdx    = fromRow.widgets.findIndex(w => w.id === widgetId);
    if (wIdx < 0) return;
    const [widget] = fromRow.widgets.splice(wIdx, 1);
    toRow.widgets.splice(toIndex ?? toRow.widgets.length, 0, widget);
    await doc.update({ "system.customTabs": tabs });
  }

  // Templates

  /** Save current tabs as a named world-level template */
  static async saveTemplate(doc, templateName) {
    const stored = foundry.utils.deepClone(
      game.settings.get("sd", "sheetTemplates") ?? {}
    );
    stored[templateName] = {
      name:    templateName,
      tabs:    foundry.utils.deepClone(this.getTabs(doc)),
      created: Date.now()
    };
    await game.settings.set("sd", "sheetTemplates", stored);
    ui.notifications.info(`Template "${templateName}" saved.`);
  }

  /** Apply a named template to a document (replaces all customTabs) */
  static async applyTemplate(doc, templateName) {
    const stored = game.settings.get("sd", "sheetTemplates") ?? {};
    const tmpl   = stored[templateName];
    if (!tmpl) return ui.notifications.warn(`Template "${templateName}" not found.`);
    const freshTabs = this._freshenIds(foundry.utils.deepClone(tmpl.tabs));
    await doc.update({ "system.customTabs": freshTabs });
    ui.notifications.info(`Template "${templateName}" applied.`);
  }

  /** Apply to all actors/items of a given type */
  static async applyTemplateToAll(templateName, documentType, subtype) {
    const collection = documentType === "Actor" ? game.actors : game.items;
    let count = 0;
    for (const doc of collection) {
      if (doc.type !== subtype) continue;
      await this.applyTemplate(doc, templateName);
      count++;
    }
    ui.notifications.info(`Applied "${templateName}" to ${count} ${subtype}(s).`);
  }

  static listTemplates() {
    return Object.values(game.settings.get("sd", "sheetTemplates") ?? {});
  }

  static async deleteTemplate(templateName) {
    const stored = foundry.utils.deepClone(game.settings.get("sd", "sheetTemplates") ?? {});
    delete stored[templateName];
    await game.settings.set("sd", "sheetTemplates", stored);
  }

  /** Re-generate all IDs in a tabs array to avoid collisions */
  static _freshenIds(tabs) {
    return tabs.map(tab => ({
      ...tab,
      id:   foundry.utils.randomID(8),
      rows: (tab.rows ?? []).map(row => ({
        ...row,
        id:      foundry.utils.randomID(8),
        widgets: (row.widgets ?? []).map(w => ({
          ...w,
          id: foundry.utils.randomID(8)
        }))
      }))
    }));
  }
}
