import { GridManager }    from "./grid-manager.mjs";
import { WidgetRenderer } from "./widget-renderer.mjs";
import { WIDGET_TYPES } from "./widget-registry.mjs";
import { FormulaGraph }   from "./formula-graph.mjs";

export function BuilderMixin(Base) {
  return class extends Base {

    _editMode = false;

    async _prepareContext(options) {
      const ctx = await super._prepareContext(options);

      const doc      = this.document;
      const rawTabs  = GridManager.getTabs(doc);
      const editMode = this._editMode;

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

    _onRender(context, options) {
      super._onRender?.(context, options);
      this._wireCustomTabs(context);
      this._wireBuilderDrop();
      this._wireWidgetInteractions();
    }

    _wireCustomTabs(context) {
      const root = this.element;
      if (!root) return;

      const nav = root.querySelector(".sheet-tabs");
      if (!nav) return;

      root.querySelectorAll(".tab-link.custom-tab").forEach(el => el.remove());

      const { customTabs = [], editMode } = context;

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

      this._renderCustomTabPanels(customTabs, editMode);

      root.classList.toggle("sheet-edit-mode", editMode);

      const emBtn = root.querySelector(".edit-mode-btn");
      if (emBtn) {
        emBtn.classList.toggle("active", editMode);
        emBtn.addEventListener("click", () => {
          this._editMode = !this._editMode;
          this.render();
        }, { once: true });
      }

      if (editMode) {
        this._addEditModeSaveButton(root);
      }

      this._wireFormulaDropZones(root);
    }

    _addEditModeSaveButton(root) {
      const header = root.querySelector(".sheet-header");
      if (!header) return;

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
      const attrs = this._collectItemAttributes(item);

      if (attrs.length === 0) {
        ui.notifications.warn(`No accessible attributes found on "${item.name}"`);
        return;
      }

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

      if (system.quantity !== undefined) attrs.push({ path: "system.quantity", label: "Quantity" });
      if (system.weight !== undefined) attrs.push({ path: "system.weight", label: "Weight" });
      if (system.price !== undefined) attrs.push({ path: "system.price", label: "Price" });

      if (system.hiddenFields) {
        for (const [key, val] of Object.entries(system.hiddenFields)) {
          attrs.push({ path: `system.hiddenFields.${key}`, label: val.label ?? key });
        }
      }

      if (system.slotDefinitions) {
        for (const slot of system.slotDefinitions) {
          attrs.push({ path: `slots.${slot.id}`, label: `Slot: ${slot.label}` });
        }
      }

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

      root.querySelectorAll(".custom-tab-content").forEach(el => el.remove());

      customTabs.forEach(tab => {
        const panel = document.createElement("div");
        panel.className     = "custom-tab-content tab-content";
        panel.dataset.tab   = `ctab_${tab.id}`;
        panel.dataset.group = "sheet";

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
                <div class="wo-group wo-left">
                  <button type="button" class="wo-btn wo-drag" data-tab-id="${tab.id}" data-row-id="${row.id}" data-widget-id="${w.id}" draggable="true" title="Drag to move"><i class="fas fa-up-down-left-right"></i></button>
                  <button type="button" class="wo-btn" data-action="configWidget" data-tab-id="${tab.id}" data-row-id="${row.id}" data-widget-id="${w.id}" title="Settings"><i class="fas fa-gear"></i></button>
                  <button type="button" class="wo-btn" data-action="duplicateWidget" data-tab-id="${tab.id}" data-row-id="${row.id}" data-widget-id="${w.id}" title="Duplicate"><i class="fas fa-clone"></i></button>
                  <button type="button" class="wo-btn" data-action="changeWidgetSpan" data-tab-id="${tab.id}" data-row-id="${row.id}" data-widget-id="${w.id}" title="Change width"><i class="fas fa-arrows-left-right"></i></button>
                </div>
                <div class="wo-group wo-right">
                  <button type="button" class="wo-btn danger" data-action="removeWidget" data-tab-id="${tab.id}" data-row-id="${row.id}" data-widget-id="${w.id}" title="Remove"><i class="fas fa-trash"></i></button>
                </div>`;
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

      root.querySelectorAll("[data-group='sheet'][data-tab]").forEach(el => {
        el.classList.remove("active");
      });

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
      const root = this.element;
      if (!root) return;

      root.querySelectorAll(".widget input[data-path]:not([name])").forEach(inp => {
        inp.addEventListener("change", async () => {
          const path = inp.dataset.path;
          const val  = inp.type === "number" ? Number(inp.value) : inp.value;
          await this.document.update({ [path]: val });
        });
      });
    }

    _wireBuilderDrop() {
      const root = this.element;
      if (!root) return;

      root.querySelectorAll(".wo-drag").forEach(handle => {
        handle.addEventListener("dragstart", ev => {

          const tabId    = handle.dataset.tabId;
          const fromRow  = handle.dataset.rowId;
          const widgetId = handle.dataset.widgetId;
          let snapshot   = null;
          try {
            const tabs = GridManager.getTabs(this.document);
            const row  = tabs.find(t => t.id === tabId)?.rows?.find(r => r.id === fromRow);
            const w    = row?.widgets?.find(w => w.id === widgetId);
            if (w) snapshot = foundry.utils.deepClone(w);
          } catch {  }
          ev.dataTransfer.setData("text/plain", JSON.stringify({
            sdType:    "moveWidget",
            srcDocUuid: this.document?.uuid ?? null,
            tabId, fromRowId: fromRow, widgetId,
            widget:    snapshot
          }));
          ev.dataTransfer.effectAllowed = "copyMove";
        });
        handle.addEventListener("click", ev => ev.preventDefault());
      });

      root.querySelectorAll(".widget-drop-zone[data-drop-type='widget']").forEach(dz => {
        dz.addEventListener("dragover", ev => { ev.preventDefault(); dz.classList.add("drag-over"); });
        dz.addEventListener("dragleave", () => dz.classList.remove("drag-over"));
        dz.addEventListener("drop", async ev => {
          dz.classList.remove("drag-over");
          const data = this._parseDrop(ev);
          if (!data) return;
          if (data.sdType === "widget") {
            GridManager.addWidget(this.document, dz.dataset.tabId, dz.dataset.rowId, data.widgetType);
          } else if (data.sdType === "moveWidget" || data.sdType === "widget-move") {

            const snapshot = data.widget ?? data.widgetSnapshot ?? null;
            const fromRowId = data.fromRowId ?? data.rowId ?? null;
            const sameDoc = data.srcDocUuid && this.document?.uuid
              ? data.srcDocUuid === this.document.uuid
              : data.tabId === dz.dataset.tabId;
            if (sameDoc && data.tabId === dz.dataset.tabId && fromRowId && data.widgetId) {
              await GridManager.moveWidget(this.document, data.tabId, fromRowId, dz.dataset.rowId, data.widgetId);
            } else if (snapshot) {
              await GridManager.insertWidgetData(this.document, dz.dataset.tabId, dz.dataset.rowId, snapshot);
            } else {
              ui.notifications?.warn?.("Cannot copy widget: source data unavailable");
              return;
            }
            this.render();
          }
        });
      });

      root.querySelectorAll("[data-drop-zone='item']").forEach(dz => {
        dz.addEventListener("dragover", ev => { ev.preventDefault(); dz.classList.add("drag-over"); });
        dz.addEventListener("dragleave", () => dz.classList.remove("drag-over"));
        dz.addEventListener("drop", async ev => {
          dz.classList.remove("drag-over");

          if (this.document instanceof Actor) return;

          ev.preventDefault();
          ev.stopPropagation();
          const data = this._parseDrop(ev);
          if (!data) return;

          if (data.type === "Item" || data.uuid?.startsWith("Item") || data.actorId) {
            await this._handleItemDrop(data);
          }
        });
      });

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

      root.addEventListener("click", this._onBuilderClick.bind(this));
    }

    async _handleItemDrop(data) {
      try {
        let item;

        if (data.uuid) {
          item = await fromUuid(data.uuid);
        }

        else if (data.actorId) {
          const sourceActor = game.actors.get(data.actorId);
          item = sourceActor?.items.get(data.id);
        }

        if (!item) {
          ui.notifications.warn("Could not find item to drop");
          return;
        }

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

        case "duplicateWidget":
          await GridManager.duplicateWidget(this.document, tabId, rowId, widgetId);
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

        case "widgetNumStep": {
          ev.preventDefault();
          const step   = parseFloat(btn.dataset.step ?? 1);
          const path   = btn.dataset.path;
          if (!path || !Number.isFinite(step)) break;
          const dsMin  = btn.dataset.min;
          const dsMax  = btn.dataset.max;
          const rawMin = (dsMin !== undefined && dsMin !== "") ? parseFloat(dsMin) : -Infinity;
          const rawMax = (dsMax !== undefined && dsMax !== "") ? parseFloat(dsMax) :  Infinity;
          const min    = Number.isFinite(rawMin) ? rawMin : -Infinity;
          const max    = Number.isFinite(rawMax) ? rawMax :  Infinity;
          const curRaw = parseFloat(foundry.utils.getProperty(this.document, path) ?? 0);
          const cur    = Number.isFinite(curRaw) ? curRaw : 0;
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

    async _openWidgetConfig(tabId, rowId, widgetId) {
      const tabs   = GridManager.getTabs(this.document);
      const tab    = tabs.find(t => t.id === tabId);
      const row    = tab?.rows.find(r => r.id === rowId);
      const widget = row?.widgets.find(w => w.id === widgetId);
      if (!widget) return;

      const typeDef = WIDGET_TYPES[widget.type];
      if (!typeDef) return;

      const popup = document.createElement("div");
      popup.className = "sd-widget-popup";

      const cellEl = this.element.querySelector(`[data-widget-id="${widgetId}"]`);
      if (cellEl) {
        const rect = cellEl.getBoundingClientRect();
        let top = rect.bottom + 8;
        let left = rect.left;

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
                   border:1px solid var(--sd-accent);background:var(--sd-bg-4);color:var(--sd-accent);display:flex;align-items:center;gap:6px;
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

      popup.querySelectorAll("[data-config-type='path'], [data-config-type='text']").forEach(inp => {
        this._wirePathAutocomplete(inp, popup);
        this._wirePathDrop(inp, popup);
      });

      popup.querySelectorAll("[data-config-type='number'], [data-config-type='formula']").forEach(inp => {
        this._wirePathDrop(inp, popup);
      });

      return new Promise(resolve => {
        popup.querySelector("#popup-graph")?.addEventListener("click", async () => {
          popup.remove();
          resolve(null);
          const tabs   = GridManager.getTabs(this.document);
          const tab    = tabs.find(t => t.id === tabId);
          const row    = tab?.rows.find(r => r.id === rowId);
          const widget = row?.widgets.find(w => w.id === widgetId);
          if (!widget) return;
          const graph = new FormulaGraph(
            null,
            this.document,
            widget,
            { tab, row, w: widget, doc: this.document },
            null,
            { mode: "config" }
          );
          const origClose = graph.close.bind(graph);
          graph.close = (...args) => {
            origClose(...args);
            this.render();
          };
          graph.open();
        });

        const cancelBtn = popup.querySelector("#popup-cancel");
        if (cancelBtn) {
          cancelBtn.addEventListener("click", () => {
            popup.remove();
            resolve(null);
          });
        }

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

    _wirePathAutocomplete(_input, _popup) {}

    _wirePathDrop(input, popup) {
      input.addEventListener("dragover", ev => {
        ev.preventDefault();
        input.classList.add("drag-over");
        input.style.borderColor = "var(--sd-accent)";
        input.style.boxShadow = "0 0 0 2px var(--sd-accent-dim)";
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

        if (data.sdType === "path") {
          input.value = data.path;
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
          return;
        }

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
                  <p style="margin-bottom:8px;color:var(--sd-text-2)">Select attribute:</p>
                  <select name="attrPath" style="width:100%;background:var(--sd-bg-3);border:1px solid var(--sd-border);color:var(--sd-text);padding:6px;border-radius:4px">${attrOptions}</select>
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
