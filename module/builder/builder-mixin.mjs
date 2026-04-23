/**
 * module/builder/builder-mixin.mjs
 *
 * BuilderMixin -- applied to CharacterSheet, NPCSheet, SDItemSheet.
 *
 * Adds:
 *  - Custom tabs rendering (from system.customTabs)
 *  - Edit Mode toggle
 *  - Drop zones for New Tab / Widget drops from Toolbox
 *  - Widget interactions: roll, toggle, number step
 *  - Widget config popup on gear click
 *  - Row/widget CRUD forwarding to GridManager
 *
 * Usage:
 *   class CharacterSheet extends BuilderMixin(HandlebarsApplicationMixin(ActorSheetV2)) { ... }
 */

import { GridManager }    from "./grid-manager.mjs";
import { WidgetRenderer } from "./widget-renderer.mjs";
import { WIDGET_TYPES, KNOWN_PATHS } from "./widget-registry.mjs";
import { FormulaGraph }   from "./formula-graph.mjs";

export function BuilderMixin(Base) {
  return class extends Base {

    // Edit mode state (per-instance, not persisted)
    _editMode = false;

    // Context: add customTabs data

    async _prepareContext(options) {
      const ctx = await super._prepareContext(options);

      const doc      = this.document;
      const rawTabs  = GridManager.getTabs(doc);
      const editMode = this._editMode;

      // Render widget HTML for each tab/row/widget
      const customTabs = rawTabs.map(tab => ({
        ...tab,
        rows: tab.rows.map(row => ({
          ...row,
          widgets: row.widgets.map(w => ({
            ...w,
            html: WidgetRenderer.render(w, doc, editMode)
          }))
        }))
      }));

      return { ...ctx, customTabs, editMode };
    }

    // _onRender: wire tabs, drag-drop, interactions

    _onRender(context, options) {
      super._onRender?.(context, options);
      this._wireCustomTabs(context);
      this._wireBuilderDrop();
      this._wireWidgetInteractions();
    }

    // Custom tab nav + content

    _wireCustomTabs(context) {
      const root = this.element;
      if (!root) return;

      const nav = root.querySelector(".sheet-tabs");
      if (!nav) return;

      // Remove old custom tab links
      root.querySelectorAll(".tab-link.custom-tab").forEach(el => el.remove());

      const { customTabs = [], editMode } = context;

      // Build nav links
      customTabs.forEach(tab => {
        const a = document.createElement("a");
        a.className    = "item tab-link custom-tab";
        a.dataset.tab  = `ctab_${tab.id}`;
        a.dataset.group = "sheet";
        a.innerHTML    = `<i class="fas ${tab.icon ?? "fa-star"}"></i> ${tab.label}`;
        if (editMode) {
          const editBtn  = document.createElement("span");
          editBtn.className = "tab-edit-btn";
          editBtn.innerHTML = "✎";
          editBtn.dataset.action = "editTabLabel";
          editBtn.dataset.tabId  = tab.id;
          a.appendChild(editBtn);
        }
        a.addEventListener("click", ev => {
          ev.preventDefault();
          this._switchToCustomTab(tab.id);
        });
        if (editMode) {
          const editBtn2 = a.querySelector(".tab-edit-btn");
          editBtn2?.addEventListener("click", ev => {
            ev.stopPropagation();
            this._editTabLabel(tab.id);
          });
        }
        nav.appendChild(a);
      });

      // "+" drop zone on nav for New Tab
      let addZone = root.querySelector(".add-tab-btn");
      if (!addZone) {
        addZone = document.createElement("a");
        addZone.className = "item tab-link add-tab-btn";
        addZone.innerHTML = '<i class="fas fa-plus"></i>';
        addZone.title     = "Drop here to add tab, or click to add blank";
        addZone.addEventListener("click", () => this._addCustomTab());
        addZone.addEventListener("dragover", ev => { ev.preventDefault(); addZone.classList.add("drag-over"); });
        addZone.addEventListener("dragleave", () => addZone.classList.remove("drag-over"));
        addZone.addEventListener("drop",  ev => {
          addZone.classList.remove("drag-over");
          const data = this._parseDrop(ev);
          if (data?.sdType === "newTab") this._addCustomTab();
        });
        nav.appendChild(addZone);
      }

      // Inject custom tab content panels after sheet tabs part
      this._renderCustomTabPanels(customTabs, editMode);

      // Edit-mode class on sheet
      root.classList.toggle("sheet-edit-mode", editMode);

      // Wire edit-mode toggle button
      const emBtn = root.querySelector(".edit-mode-btn");
      if (emBtn) {
        emBtn.classList.toggle("active", editMode);
        emBtn.addEventListener("click", () => {
          this._editMode = !this._editMode;
          this.render();
        }, { once: true });
      }

      // Add save button in edit mode
      if (editMode) {
        this._addEditModeSaveButton(root);
      }

      // Wire formula drop zones for drag & drop attribute references
      this._wireFormulaDropZones(root);
    }

    _addEditModeSaveButton(root) {
      const header = root.querySelector(".sheet-header");
      if (!header) return;

      // Remove existing save button
      header.querySelectorAll(".edit-save-btn").forEach(el => el.remove());

      const saveBtn = document.createElement("button");
      saveBtn.type = "button";
      saveBtn.className = "edit-save-btn btn btn-primary";
      saveBtn.innerHTML = '<i class="fas fa-save"></i> Save Layout';
      saveBtn.addEventListener("click", async () => {
        ui.notifications.info("Sheet layout saved!");
        this._editMode = false;
        this.render();
      });
      header.appendChild(saveBtn);
    }

    _wireFormulaDropZones(root) {
      // Wire all formula input fields for drag & drop
      root.querySelectorAll('input[data-config-key="formula"], input.formula-input, input[data-formula-drop]').forEach(inp => {
        inp.addEventListener("dragover", ev => {
          ev.preventDefault();
          inp.classList.add("drag-over");
        });
        inp.addEventListener("dragleave", () => inp.classList.remove("drag-over"));
        inp.addEventListener("drop", async ev => {
          ev.preventDefault();
          inp.classList.remove("drag-over");
          const data = this._parseDrop(ev);
          if (!data) return;

          // Handle item drop - show attribute selector
          if (data.type === "Item" || data.uuid?.startsWith("Item")) {
            const item = await fromUuid(data.uuid);
            if (item) {
              await this._insertItemReference(inp, item);
            }
          }
        });
      });
    }

    async _insertItemReference(input, item) {
      // Collect available attributes from the item
      const attrs = this._collectItemAttributes(item);

      if (attrs.length === 0) {
        ui.notifications.warn(`No accessible attributes found on "${item.name}"`);
        return;
      }

      // Show dialog to select attribute
      const attrOptions = attrs.map(a => `<option value="${a.path}">${a.label} (${a.path})</option>`).join("");

      const result = await foundry.applications.api.DialogV2.wait({
        window: { title: `Reference from: ${item.name}` },
        content: `
          <div style="padding:8px">
            <p style="margin-bottom:8px;color:var(--sd-text-2)">Select attribute to reference:</p>
            <select name="attrPath" style="width:100%">${attrOptions}</select>
            <p style="margin-top:8px;font-size:11px;color:var(--sd-text-3)">
              <i class="fas fa-info-circle"></i> This will insert a reference like @items.${item.id}.system.attr
            </p>
          </div>`,
        buttons: [
          { action: "insert", label: "Insert", default: true, callback: (ev, btn) => btn.form },
          { action: "cancel", label: "Cancel" }
        ]
      });

      if (result?.attrPath) {
        const ref = `@items.${item.id}.${result.attrPath.value}`;
        const cursorPos = input.selectionStart ?? input.value.length;
        const before = input.value.substring(0, cursorPos);
        const after = input.value.substring(cursorPos);
        input.value = before + ref + after;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }

    _collectItemAttributes(item) {
      const attrs = [];
      const system = item.system ?? {};

      // Add common item attributes
      if (system.quantity !== undefined) attrs.push({ path: "system.quantity", label: "Quantity" });
      if (system.weight !== undefined) attrs.push({ path: "system.weight", label: "Weight" });
      if (system.price !== undefined) attrs.push({ path: "system.price", label: "Price" });

      // Add hidden fields
      if (system.hiddenFields) {
        for (const [key, val] of Object.entries(system.hiddenFields)) {
          attrs.push({ path: `system.hiddenFields.${key}`, label: val.label ?? key });
        }
      }

      // Add slot contents if item has slots
      if (system.slotDefinitions) {
        for (const slot of system.slotDefinitions) {
          attrs.push({ path: `slots.${slot.id}`, label: `Slot: ${slot.label}` });
        }
      }

      // Add any numeric/string system fields
      for (const [key, val] of Object.entries(system)) {
        if (typeof val === "number" && !attrs.find(a => a.path === `system.${key}`)) {
          attrs.push({ path: `system.${key}`, label: key.charAt(0).toUpperCase() + key.slice(1) });
        }
      }

      return attrs;
    }

    _renderCustomTabPanels(customTabs, editMode) {
      const root    = this.element;
      const content = root.querySelector(".window-content");
      if (!content) return;

      // Remove old custom panels
      root.querySelectorAll(".custom-tab-content").forEach(el => el.remove());

      customTabs.forEach(tab => {
        const panel = document.createElement("div");
        panel.className     = "custom-tab-content tab-content";
        panel.dataset.tab   = `ctab_${tab.id}`;
        panel.dataset.group = "sheet";

        // Build rows
        tab.rows.forEach(row => {
          const rowDiv = document.createElement("div");
          rowDiv.className = `widget-row ${editMode ? "edit-mode" : ""}`;
          rowDiv.dataset.tabId = tab.id;
          rowDiv.dataset.rowId = row.id;

          if (editMode) {
            rowDiv.innerHTML += `
              <div class="widget-row-controls">
                <button type="button" class="row-ctrl-btn" data-action="moveRow" data-tab-id="${tab.id}" data-row-id="${row.id}" data-dir="up">↑</button>
                <button type="button" class="row-ctrl-btn" data-action="moveRow" data-tab-id="${tab.id}" data-row-id="${row.id}" data-dir="down">↓</button>
                <button type="button" class="row-ctrl-btn danger" data-action="removeRow" data-tab-id="${tab.id}" data-row-id="${row.id}">✕</button>
              </div>`;
          }

          row.widgets.forEach(w => {
            const cell = document.createElement("div");
            cell.className         = "widget-cell";
            cell.dataset.span      = w.span ?? 1;
            cell.dataset.tabId     = tab.id;
            cell.dataset.rowId     = row.id;
            cell.dataset.widgetId  = w.id;
            cell.style.gridColumn  = `span ${w.span ?? 1}`;
            cell.innerHTML         = w.html ?? "";

            if (editMode) {
              const overlay = document.createElement("div");
              overlay.className = "widget-overlay";
              overlay.innerHTML = `
                <button type="button" class="wo-btn" data-action="configWidget" data-tab-id="${tab.id}" data-row-id="${row.id}" data-widget-id="${w.id}"><i class="fas fa-gear"></i></button>
                <button type="button" class="wo-btn" data-action="changeWidgetSpan" data-tab-id="${tab.id}" data-row-id="${row.id}" data-widget-id="${w.id}"><i class="fas fa-arrows-left-right"></i></button>
                <button type="button" class="wo-btn danger" data-action="removeWidget" data-tab-id="${tab.id}" data-row-id="${row.id}" data-widget-id="${w.id}"><i class="fas fa-trash"></i></button>`;
              cell.appendChild(overlay);
            }

            rowDiv.appendChild(cell);
          });

          if (editMode) {
            const dz = document.createElement("div");
            dz.className = "widget-drop-zone";
            dz.dataset.dropType = "widget";
            dz.dataset.tabId    = tab.id;
            dz.dataset.rowId    = row.id;
            dz.innerHTML = '<i class="fas fa-arrow-down-to-line"></i>';
            rowDiv.appendChild(dz);
          }

          panel.appendChild(rowDiv);
        });

        // Add row button
        const addRow = document.createElement("div");
        addRow.className    = "add-row-btn";
        addRow.dataset.action = "addRow";
        addRow.dataset.tabId  = tab.id;
        addRow.innerHTML      = '<i class="fas fa-plus"></i> Add Row';
        panel.appendChild(addRow);

        content.appendChild(panel);
      });
    }

    _switchToCustomTab(tabId) {
      const root  = this.element;
      if (!root) return;
      const key   = `ctab_${tabId}`;
      // Deactivate all
      root.querySelectorAll("[data-group='sheet'][data-tab]").forEach(el => {
        el.classList.remove("active");
      });
      // Activate target
      root.querySelectorAll(`[data-group='sheet'][data-tab='${key}']`).forEach(el => {
        el.classList.add("active");
      });
      if (this.tabGroups) this.tabGroups.sheet = key;
    }

    async _addCustomTab(label = "New Tab") {
      await GridManager.addTab(this.document, { label });
      this.render();
    }

    async _editTabLabel(tabId) {
      const tab   = GridManager.getTabs(this.document).find(t => t.id === tabId);
      if (!tab) return;
      const label = await this._promptText("Tab Name", tab.label);
      if (label) await GridManager.updateTab(this.document, tabId, { label });
    }

    _wireWidgetInteractions() {
      // Widget text/number inputs use name= attributes → handled by AppV2 form (submitOnChange).
      // Dice/toggle/step buttons use data-action= → handled by _onBuilderClick click delegation.
      // This method is a hook for any extra wiring needed per sheet type.
      const root = this.element;
      if (!root) return;

      // Wire any input that has data-path but no name= (fallback for widgets not using form names)
      root.querySelectorAll(".widget input[data-path]:not([name])").forEach(inp => {
        inp.addEventListener("change", async () => {
          const path = inp.dataset.path;
          const val  = inp.type === "number" ? Number(inp.value) : inp.value;
          await this.document.update({ [path]: val });
        });
      });
    }

    // Drop wiring

    _wireBuilderDrop() {
      const root = this.element;
      if (!root) return;

      // Drop zones inside custom tab panels
      root.querySelectorAll(".widget-drop-zone[data-drop-type='widget']").forEach(dz => {
        dz.addEventListener("dragover", ev => { ev.preventDefault(); dz.classList.add("drag-over"); });
        dz.addEventListener("dragleave", () => dz.classList.remove("drag-over"));
        dz.addEventListener("drop", ev => {
          dz.classList.remove("drag-over");
          const data = this._parseDrop(ev);
          if (!data) return;
          if (data.sdType === "widget") {
            GridManager.addWidget(this.document, dz.dataset.tabId, dz.dataset.rowId, data.widgetType);
          }
        });
      });

      // Inventory drop zone
      root.querySelectorAll("[data-drop-zone='item']").forEach(dz => {
        dz.addEventListener("dragover", ev => { ev.preventDefault(); dz.classList.add("drag-over"); });
        dz.addEventListener("dragleave", () => dz.classList.remove("drag-over"));
        dz.addEventListener("drop", async ev => {
          ev.preventDefault();
          dz.classList.remove("drag-over");
          const data = this._parseDrop(ev);
          if (!data) return;

          // Handle item drop
          if (data.type === "Item" || data.uuid?.startsWith("Item") || data.actorId) {
            await this._handleItemDrop(data);
          }
        });
      });

      // Slot drop zone
      root.querySelectorAll("[data-drop-slot]").forEach(dz => {
        dz.addEventListener("dragover", ev => { ev.preventDefault(); dz.classList.add("drag-over"); });
        dz.addEventListener("dragleave", () => dz.classList.remove("drag-over"));
        dz.addEventListener("drop", async ev => {
          ev.preventDefault();
          dz.classList.remove("drag-over");
          const data = this._parseDrop(ev);
          if (!data) return;

          const slotId = dz.dataset.dropSlot;
          await this._handleSlotDrop(slotId, data);
        });
      });

      // Action buttons inside custom panels
      root.addEventListener("click", this._onBuilderClick.bind(this));
    }

    async _handleItemDrop(data) {
      try {
        let item;

        // From compendium
        if (data.uuid) {
          item = await fromUuid(data.uuid);
        }
        // From another actor
        else if (data.actorId) {
          const sourceActor = game.actors.get(data.actorId);
          item = sourceActor?.items.get(data.id);
        }

        if (!item) {
          ui.notifications.warn("Could not find item to drop");
          return;
        }

        // Create item on this actor
        const itemData = item.toObject();
        if (this.document instanceof Actor) {
          await this.document.createEmbeddedDocuments("Item", [itemData]);
          ui.notifications.info(`Added "${item.name}" to ${this.document.name}`);
          this.render();
        }
      } catch (err) {
        console.error("SD | Item drop error:", err);
        ui.notifications.error("Failed to add item");
      }
    }

    async _handleSlotDrop(slotId, data) {
      try {
        let item;

        if (data.uuid) {
          item = await fromUuid(data.uuid);
        } else if (data.actorId) {
          const sourceActor = game.actors.get(data.actorId);
          item = sourceActor?.items.get(data.id);
        }

        if (!item) {
          ui.notifications.warn("Could not find item to drop");
          return;
        }

        // Check if document is an Item with slots
        if (this.document instanceof Item && this.document.system.slotDefinitions) {
          const { SlotManager } = await import("../data/item-slots.mjs");
          await SlotManager.addToSlot(this.document, slotId, item);
          ui.notifications.info(`Added "${item.name}" to slot`);
          this.render();
        }
      } catch (err) {
        console.error("SD | Slot drop error:", err);
        ui.notifications.error("Failed to add item to slot");
      }
    }

    _parseDrop(ev) {
      try { return JSON.parse(ev.dataTransfer.getData("text/plain")); }
      catch { return null; }
    }

    // Builder click handler

    async _onBuilderClick(ev) {
      const btn = ev.target.closest("[data-action]");
      if (!btn) return;

      const { action, tabId, rowId, widgetId, dir } = btn.dataset;

      switch (action) {
        case "addRow":
          await GridManager.addRow(this.document, tabId);
          this.render(); break;

        case "removeRow":
          await GridManager.removeRow(this.document, tabId, rowId);
          this.render(); break;

        case "moveRow":
          await GridManager.moveRow(this.document, tabId, rowId, dir);
          this.render(); break;

        case "removeWidget":
          await GridManager.removeWidget(this.document, tabId, rowId, widgetId);
          this.render(); break;

        case "configWidget":
          await this._openWidgetConfig(tabId, rowId, widgetId);
          break;

        case "changeWidgetSpan": {
          const tabs   = GridManager.getTabs(this.document);
          const widget = tabs.find(t => t.id === tabId)?.rows
            .find(r => r.id === rowId)?.widgets.find(w => w.id === widgetId);
          if (widget) {
            const spans = [1, 2, 3];
            const next  = spans[(spans.indexOf(widget.span ?? 1) + 1) % 3];
            await GridManager.updateWidget(this.document, tabId, rowId, widgetId, { span: next });
            this.render();
          }
          break;
        }

        // Widget interactions
        case "widgetNumStep": {
          ev.preventDefault();
          const step   = parseFloat(btn.dataset.step ?? 1);
          const path   = btn.dataset.path;
          const min    = btn.dataset.min !== "" ? parseFloat(btn.dataset.min) : -Infinity;
          const max    = btn.dataset.max !== "" ? parseFloat(btn.dataset.max) :  Infinity;
          const cur    = parseFloat(foundry.utils.getProperty(this.document, path) ?? 0);
          const next   = Math.clamp(cur + step, min, max);
          await this.document.update({ [path]: next });
          break;
        }

        case "widgetToggle": {
          const path = btn.dataset.path;
          const cur  = foundry.utils.getProperty(this.document, path);
          await this.document.update({ [path]: !cur });
          break;
        }

        case "widgetRoll": {
          const formula = btn.dataset.formula;
          const flavor  = btn.dataset.flavor;
          if (!formula) break;
          const roll = new Roll(formula, this.document.getRollData?.() ?? {});
          await roll.evaluate();
          await roll.toMessage({
            speaker: ChatMessage.getSpeaker({ actor: this.document }),
            flavor:  flavor || formula
          });
          break;
        }

        // Inventory widget actions
        case "itemEdit": {
          const itemId = btn.dataset.itemId;
          const item = this.document.items?.get(itemId);
          if (item) item.sheet.render(true);
          break;
        }

        case "itemDelete": {
          const itemId = btn.dataset.itemId;
          const item = this.document.items?.get(itemId);
          if (item) {
            const confirm = await foundry.applications.api.DialogV2.confirm({
              content: `Delete "${item.name}"?`
            });
            if (confirm) await item.delete();
          }
          break;
        }

        case "removeFromSlot": {
          const slotId = btn.dataset.slotId;
          const slotIndex = parseInt(btn.dataset.slotIndex);
          if (this.document instanceof Item) {
            const { SlotManager } = await import("../data/item-slots.mjs");
            await SlotManager.removeFromSlot(this.document, slotId, slotIndex);
            this.render();
          }
          break;
        }
      }
    }

    // Widget Config Popup

    async _openWidgetConfig(tabId, rowId, widgetId) {
      const tabs   = GridManager.getTabs(this.document);
      const tab    = tabs.find(t => t.id === tabId);
      const row    = tab?.rows.find(r => r.id === rowId);
      const widget = row?.widgets.find(w => w.id === widgetId);
      if (!widget) return;

      const typeDef = WIDGET_TYPES[widget.type];
      if (!typeDef) return;

      // Build popup DOM
      const popup = document.createElement("div");
      popup.className = "sd-widget-popup";

      // Position near the widget cell
      const cellEl = this.element.querySelector(`[data-widget-id="${widgetId}"]`);
      if (cellEl) {
        const rect = cellEl.getBoundingClientRect();
        // Position below the widget, but ensure it stays on screen
        let top = rect.bottom + 8;
        let left = rect.left;

        // Adjust if would go off-screen
        if (top + 300 > window.innerHeight) {
          top = rect.top - 300;
        }
        if (left + 380 > window.innerWidth) {
          left = window.innerWidth - 390;
        }
        if (left < 10) left = 10;

        popup.style.top  = `${Math.max(10, top)}px`;
        popup.style.left = `${left}px`;
      } else {
        // Center of screen as fallback
        popup.style.top  = "50%";
        popup.style.left = "50%";
        popup.style.transform = "translate(-50%, -50%)";
      }

      popup.innerHTML = `
        <div class="popup-title" style="display:flex;align-items:center;gap:8px;font-size:12px;font-weight:700;text-transform:uppercase;color:var(--sd-accent);padding-bottom:8px;border-bottom:1px solid var(--sd-border)">
          <i class="fas ${typeDef.icon}" style="opacity:0.8"></i> ${typeDef.label}
        </div>
        <div class="popup-fields" style="display:flex;flex-direction:column;gap:8px">
          ${typeDef.configFields.map(f => this._buildConfigField(f, widget)).join("")}
        </div>
        <div class="popup-footer" style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding-top:12px;margin-top:12px;border-top:1px solid var(--sd-border)">
          <button type="button" class="btn btn-graph" id="popup-graph"
            style="padding:7px 12px;font-size:11px;font-weight:600;border-radius:4px;cursor:pointer;
                   border:1px solid #7b68ee;background:#1a1040;color:#9d8fff;display:flex;align-items:center;gap:6px;
                   transition:background .15s"
            title="Configure all settings visually via the node graph editor">
            🔷 Configure via Graph
          </button>
          <div style="display:flex;gap:8px">
            <button type="button" class="btn btn-cancel" id="popup-cancel" style="padding:8px 16px;font-size:12px;font-weight:600;border-radius:4px;cursor:pointer;border:1px solid var(--sd-border);background:var(--sd-bg-3);color:var(--sd-text-2)">
              <i class="fas fa-times"></i> Cancel
            </button>
            <button type="button" class="btn btn-primary" id="popup-save" style="padding:8px 16px;font-size:12px;font-weight:600;border-radius:4px;cursor:pointer;border:none;background:var(--sd-accent);color:#fff">
              <i class="fas fa-check"></i> Save
            </button>
          </div>
        </div>`;

      document.body.appendChild(popup);

      // Path autocomplete and drop handling
      popup.querySelectorAll("[data-config-type='path'], [data-config-type='text']").forEach(inp => {
        this._wirePathAutocomplete(inp, popup);
        this._wirePathDrop(inp, popup);
      });

      // Number and formula fields also accept drops
      popup.querySelectorAll("[data-config-type='number'], [data-config-type='formula']").forEach(inp => {
        this._wirePathDrop(inp, popup);
      });

      return new Promise(resolve => {
        // "Configure via Graph" button -- opens node graph editor in config mode
        popup.querySelector("#popup-graph")?.addEventListener("click", async () => {
          popup.remove();
          resolve(null);
          const tabs   = GridManager.getTabs(this.document);
          const tab    = tabs.find(t => t.id === tabId);
          const row    = tab?.rows.find(r => r.id === rowId);
          const widget = row?.widgets.find(w => w.id === widgetId);
          if (!widget) return;
          // Preload any unsaved inline-field changes (config node will mirror widget data)
          const graph = new FormulaGraph(
            null,
            this.document,
            widget,
            { tab, row, w: widget, doc: this.document },
            null,
            { mode: "config" }
          );
          // Re-render sheet after graph is closed so changes appear immediately
          const origClose = graph.close.bind(graph);
          graph.close = (...args) => {
            origClose(...args);
            this.render();
          };
          graph.open();
        });

        // Cancel button
        const cancelBtn = popup.querySelector("#popup-cancel");
        if (cancelBtn) {
          cancelBtn.addEventListener("click", () => {
            popup.remove();
            resolve(null);
          });
        }

        // Save button
        const saveBtn = popup.querySelector("#popup-save");
        if (saveBtn) {
          saveBtn.addEventListener("click", async () => {
            const changes = {};
            popup.querySelectorAll("[data-config-key]").forEach(el => {
              const key = el.dataset.configKey;
              const type = el.dataset.configType;
              if (type === "checkbox") {
                changes[key] = el.checked;
              } else if (type === "number") {
                changes[key] = parseFloat(el.value) || 0;
              } else if (type === "tags") {
                // Collect tags from tag-chip elements
                const tags = [];
                el.querySelectorAll(".tag-chip").forEach(chip => {
                  const tagText = chip.textContent.replace("×", "").trim();
                  if (tagText) tags.push(tagText);
                });
                changes[key] = tags;
              } else {
                changes[key] = el.value;
              }
            });
            popup.remove();
            await GridManager.updateWidget(this.document, tabId, rowId, widgetId, changes);
            this.render();
            resolve(changes);
          });
        }

        // Tag removal and addition handlers
        popup.querySelectorAll("[data-remove-tag]").forEach(btn => {
          btn.addEventListener("click", (ev) => {
            ev.stopPropagation();
            btn.closest(".tag-chip")?.remove();
          });
        });
        popup.querySelectorAll("[data-add-tag]").forEach(inp => {
          inp.addEventListener("keydown", (ev) => {
            if (ev.key === "Enter" && inp.value.trim()) {
              ev.preventDefault();
              const editor = inp.closest(".tags-editor");
              const newTag = document.createElement("span");
              newTag.className = "tag-chip";
              newTag.innerHTML = `${this._esc(inp.value.trim())}<button type="button" class="chip-remove" data-remove-tag="${inp.dataset.addTag}">×</button>`;
              newTag.querySelector(".chip-remove").addEventListener("click", (e) => {
                e.stopPropagation();
                newTag.remove();
              });
              editor.insertBefore(newTag, inp);
              inp.value = "";
            }
          });
        });

        // Click outside closes
        const outside = (ev) => {
          if (!popup.contains(ev.target)) { popup.remove(); document.removeEventListener("click", outside, true); resolve(null); }
        };
        setTimeout(() => document.addEventListener("click", outside, true), 100);
      });
    }

    _buildConfigField(fieldDef, widget) {
      const val  = widget[fieldDef.key] ?? "";
      const mono = fieldDef.mono ? `style="font-family:var(--sd-mono)"` : "";
      if (fieldDef.type === "checkbox") {
        return `<div class="popup-field">
          <label>${fieldDef.label}</label>
          <input type="checkbox" data-config-key="${fieldDef.key}" data-config-type="checkbox" ${val ? "checked" : ""}>
        </div>`;
      }
      if (fieldDef.type === "color") {
        return `<div class="popup-field">
          <label>${fieldDef.label}</label>
          <input type="color" data-config-key="${fieldDef.key}" data-config-type="color" value="${val}" style="height:36px;width:100%;padding:2px;border-radius:6px;cursor:pointer;">
        </div>`;
      }
      if (fieldDef.type === "number") {
        return `<div class="popup-field">
          <label>${fieldDef.label}</label>
          <input type="number" data-config-key="${fieldDef.key}" data-config-type="number" value="${val}">
        </div>`;
      }
      if (fieldDef.type === "tags") {
        const tags = Array.isArray(val) ? val : [];
        const tagsHtml = tags.map(t => `<span class="tag-chip">${this._esc(t)}<button type="button" class="chip-remove" data-remove-tag="${fieldDef.key}">×</button></span>`).join("");
        return `<div class="popup-field popup-field-tags">
          <label>${fieldDef.label}</label>
          <div class="tags-editor" data-config-key="${fieldDef.key}" data-config-type="tags">
            ${tagsHtml}
            <input type="text" class="tag-new-input" placeholder="Add + Enter" data-add-tag="${fieldDef.key}">
          </div>
        </div>`;
      }
      return `<div class="popup-field">
        <label>${fieldDef.label}</label>
        <input type="text" data-config-key="${fieldDef.key}" data-config-type="${fieldDef.type}" value="${val}" ${mono}>
      </div>`;
    }

    _esc(str) {
      return String(str ?? "")
        .replace(/&/g, "&amp;").replace(/"/g, "&quot;")
        .replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }

    _wirePathAutocomplete(input, popup) {
      let list = popup.querySelector(".path-suggestions");
      if (!list) {
        list = document.createElement("ul");
        list.className = "path-suggestions";
        input.parentElement.insertAdjacentElement("afterend", list);
      }

      const refresh = () => {
        const q = input.value.toLowerCase();
        const matches = Object.entries(KNOWN_PATHS).filter(([p, l]) =>
          p.includes(q) || l.toLowerCase().includes(q)
        ).slice(0, 8);
        list.innerHTML = matches.map(([p, l]) =>
          `<li class="path-suggestion" data-path="${p}">${l} <span style="opacity:.5;font-size:9px">${p}</span></li>`
        ).join("");
        list.style.display = matches.length ? "block" : "none";
        list.querySelectorAll(".path-suggestion").forEach(li => {
          li.addEventListener("click", () => {
            input.value = li.dataset.path;
            list.style.display = "none";
          });
        });
      };

      input.addEventListener("input", refresh);
      input.addEventListener("focus", refresh);
    }

    _wirePathDrop(input, popup) {
      input.addEventListener("dragover", ev => {
        ev.preventDefault();
        input.classList.add("drag-over");
        input.style.borderColor = "#7b68ee";
        input.style.boxShadow = "0 0 0 2px rgba(123,104,238,.3)";
      });
      input.addEventListener("dragleave", () => {
        input.classList.remove("drag-over");
        input.style.borderColor = "";
        input.style.boxShadow = "";
      });
      input.addEventListener("drop", async ev => {
        ev.preventDefault();
        input.classList.remove("drag-over");
        input.style.borderColor = "";
        input.style.boxShadow = "";

        const data = this._parseDrop(ev);
        if (!data) return;

        // Path from Toolbox
        if (data.sdType === "path") {
          input.value = data.path;
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
          return;
        }

        // Item dropped - show attribute selector
        if (data.type === "Item" || data.uuid?.startsWith("Item")) {
          const item = await fromUuid(data.uuid);
          if (item) {
            const attrs = this._collectItemAttributes(item);
            if (attrs.length === 0) {
              ui.notifications.warn(`No accessible attributes on "${item.name}"`);
              return;
            }

            const attrOptions = attrs.map(a => `<option value="${a.path}">${a.label}</option>`).join("");
            const result = await foundry.applications.api.DialogV2.wait({
              window: { title: `Insert from: ${item.name}` },
              content: `
                <div style="padding:8px">
                  <p style="margin-bottom:8px;color:#888">Select attribute:</p>
                  <select name="attrPath" style="width:100%;background:#2a2a38;border:1px solid #3a3a52;color:#e0e0ee;padding:6px;border-radius:4px">${attrOptions}</select>
                </div>`,
              buttons: [
                { action: "insert", label: "Insert", default: true, callback: (ev, btn) => btn.form },
                { action: "cancel", label: "Cancel" }
              ]
            });

            if (result?.attrPath) {
              const ref = `@items.${item.id}.${result.attrPath.value}`;
              input.value = ref;
              input.dispatchEvent(new Event("input", { bubbles: true }));
              input.dispatchEvent(new Event("change", { bubbles: true }));
            }
          }
        }
      });
    }

    // Helpers

    async _promptText(title, current = "") {
      return new Promise(resolve => {
        const dlg = new foundry.applications.api.DialogV2({
          window: { title },
          content: `<input type="text" name="val" value="${current}" style="width:100%;margin:8px 0">`,
          buttons: [
            { label: "OK", callback: (ev, btn) => {
                const dlgRoot = btn.closest?.("[data-application]") ?? document;
                resolve(dlgRoot.querySelector("input[name='val']")?.value?.trim() || null);
              }},
            { label: "Cancel", callback: () => resolve(null) }
          ]
        });
        dlg.render(true);
      });
    }
  };
}
