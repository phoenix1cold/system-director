import { createWidget } from "./widget-registry.mjs";

export class GridManager {

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

  static async moveTab(doc, tabId, targetTabId, placement = "before") {
    const tabs = foundry.utils.deepClone(this.getTabs(doc));
    const fromIndex = tabs.findIndex(tab => tab.id === tabId);
    const originalTargetIndex = tabs.findIndex(tab => tab.id === targetTabId);
    if (fromIndex < 0 || originalTargetIndex < 0 || tabId === targetTabId) return false;

    const [moved] = tabs.splice(fromIndex, 1);
    const targetIndex = tabs.findIndex(tab => tab.id === targetTabId);
    const insertIndex = placement === "after" ? targetIndex + 1 : targetIndex;
    tabs.splice(Math.max(0, Math.min(tabs.length, insertIndex)), 0, moved);
    tabs.forEach((tab, index) => { tab.order = index + 1; });

    const changed = tabs.some((tab, index) => tab.id !== this.getTabs(doc)[index]?.id);
    if (!changed) return false;
    await doc.update({ "system.customTabs": tabs });
    return true;
  }

  static async shiftTab(doc, tabId, delta) {
    const tabs = this.getTabs(doc);
    const fromIndex = tabs.findIndex(tab => tab.id === tabId);
    const toIndex = Math.max(0, Math.min(tabs.length - 1, fromIndex + Number(delta || 0)));
    if (fromIndex < 0 || toIndex === fromIndex) return false;
    const target = tabs[toIndex];
    return this.moveTab(doc, tabId, target.id, delta > 0 ? "after" : "before");
  }

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

  static _refreshWidgetIds(widget) {
    if (!widget || typeof widget !== "object") return widget;
    widget.id = foundry.utils.randomID(8);
    if (Array.isArray(widget.widgets)) {
      for (const child of widget.widgets) this._refreshWidgetIds(child);
    }
    return widget;
  }

  static async duplicateWidget(doc, tabId, rowId, widgetId) {
    const tabs = foundry.utils.deepClone(this.getTabs(doc));
    const tab  = tabs.find(t => t.id === tabId);
    if (!tab) return null;
    const row  = tab.rows.find(r => r.id === rowId);
    if (!row) return null;
    const idx  = row.widgets.findIndex(w => w.id === widgetId);
    if (idx < 0) return null;
    const clone = foundry.utils.deepClone(row.widgets[idx]);
    this._refreshWidgetIds(clone);
    row.widgets.splice(idx + 1, 0, clone);
    await doc.update({ "system.customTabs": tabs });
    return clone;
  }

  static async insertWidgetData(doc, tabId, rowId, widgetData, atIndex = null) {
    if (!widgetData || typeof widgetData !== "object") return null;
    const tabs = foundry.utils.deepClone(this.getTabs(doc));
    const tab  = tabs.find(t => t.id === tabId);
    if (!tab) return null;
    const row  = tab.rows.find(r => r.id === rowId);
    if (!row) return null;
    const clone = foundry.utils.deepClone(widgetData);
    this._refreshWidgetIds(clone);
    if (atIndex == null || atIndex < 0 || atIndex > row.widgets.length) {
      row.widgets.push(clone);
    } else {
      row.widgets.splice(atIndex, 0, clone);
    }
    await doc.update({ "system.customTabs": tabs });
    return clone;
  }

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

  static async applyTemplate(doc, templateName) {
    const stored = game.settings.get("sd", "sheetTemplates") ?? {};
    const tmpl   = stored[templateName];
    if (!tmpl) return ui.notifications.warn(`Template "${templateName}" not found.`);
    const freshTabs = this._freshenIds(foundry.utils.deepClone(tmpl.tabs));
    await doc.update({ "system.customTabs": freshTabs });
    ui.notifications.info(`Template "${templateName}" applied.`);
  }

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
