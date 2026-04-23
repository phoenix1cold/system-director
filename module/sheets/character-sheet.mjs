/**
 * module/sheets/character-sheet.mjs
 *
 * Blank canvas sheet. No preset tabs.
 * Everything is built via the Toolbox drag-drop builder.
 *
 * PARTS:
 *   header  -- portrait, name, basic token bars
 *   tabnav  -- nav bar (built tabs + "+" drop zone)
 *   canvas  -- custom tab panels rendered via JS
 */

import { TabManager } from "../helpers/tabs.mjs";
import { WidgetRenderer } from "../builder/widget-renderer.mjs";
import { GridManager }    from "../builder/grid-manager.mjs";
import { ButtonExecutor } from "../helpers/button-executor.mjs";

const { ActorSheetV2 } = foundry.applications.sheets;
const { HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Shared prompt for tab rename dialogs used by _addTab and _renameTab.
 * Returns the trimmed name on Save, or null on Cancel / empty.
 * `modal:true` keeps the dialog in the browser top-layer so it renders above
 * the sheet and any graph windows.
 */
function _promptTabName(current = "") {
  return new Promise(resolve => {
    const esc = s => String(s ?? "").replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;");
    const readInput = btn => {
      const r = btn?.closest?.("[data-application]") ?? btn?.closest?.("dialog") ?? document;
      return r.querySelector("input[name='tabName']")?.value?.trim() || null;
    };
    new foundry.applications.api.DialogV2({
      modal: true,
      window: { title: "Tab Name" },
      content: `<div style="padding:6px 0"><input type="text" name="tabName" value="${esc(current)}" style="width:100%;background:#2a2a38;border:1px solid #3a3a52;color:#e0e0ee;border-radius:4px;padding:4px 8px;font-size:13px" autofocus></div>`,
      buttons: [
        { action:"save", label:"Save", icon:"fas fa-floppy-disk", default:true,
          callback:(ev,btn)=>{ resolve(readInput(btn)); } },
        { action:"cancel", label:"Cancel", icon:"fas fa-xmark",
          callback:()=>resolve(null) }
      ],
      submit: () => {}   // prevent default "submit" behaviour — we already resolved
    }).render(true);
  });
}

export class CharacterSheet extends HandlebarsApplicationMixin(ActorSheetV2) {

  static DEFAULT_OPTIONS = {
    classes:  ["sd", "sheet", "actor", "character"],
    position: { width: 780, height: 620 },
    window: {
      resizable: true,
      controls: [
        { icon: "fas fa-toolbox",     label: "Sheet Builder",    action: "openBuilder"      },
        { icon: "fas fa-bolt",        label: "Sheet Triggers",   action: "openSheetTriggers"},
        { icon: "fas fa-pen-ruler",   label: "Toggle Edit Mode", action: "toggleEditMode"   }
      ]
    },
    actions: {
      editImage:         CharacterSheet._onEditImage,
      openRollDialog:    CharacterSheet._onOpenRollDialog,
      openProgression:   CharacterSheet._onOpenProgression,
      openBuilder:       CharacterSheet._onOpenBuilder,
      openSheetTriggers: CharacterSheet._onOpenSheetTriggers,
      toggleEditMode:    CharacterSheet._onToggleEditMode
    },
    form: { submitOnChange: true }
  };

  static PARTS = {
    header: { template: "systems/sd/templates/actor/sheet-header.hbs" },
    canvas: { template: "systems/sd/templates/actor/sheet-canvas.hbs" }
  };

  tabGroups = { sheet: "" };
  _editMode = false;

  get title() { return this.document.name; }

  async _prepareContext(options) {
    const base   = await super._prepareContext(options);
    const actor  = this.document;
    const system = actor.system;

    return {
      ...base,
      actor,
      system,
      isEditable: this.isEditable,
      editMode:   this._editMode,
      customTabs: system.customTabs ?? [],
      hp: system.resources?.hp ?? { value: 0, max: 0 },
      mp: system.resources?.mp ?? { value: 0, max: 0 }
    };
  }

  // Render: build tab nav + panels from customTabs

  _onRender(context, options) {
    this._buildTabNav();
    this._buildTabPanels();
    this._wireHeaderInputs();
    this._showEditModeBadge();
    this._wireInventoryDropZones();
    this._wireTrackerDelegation();
    TabManager.activate(this);
  }

  /**
   * Delegated listener for tracker / clock interactions -- survives partial
   * re-renders of nested widgets (slot rows, inventory rows, spellbook rows)
   * where _wireWidget() is not called again for the inner cell.
   *
   * v2 (PR6): tracker click semantics match the clock widget -- click pip N
   * fills to N+1; click already-filled pip N unfills back to N.  No more
   * shift/right-click overloads.  Reset button always sets to 0.
   */
  _wireTrackerDelegation() {
    const root = this.element;
    if (!root || root.dataset.sdTrackerDelegated === "1") return;
    root.dataset.sdTrackerDelegated = "1";

    const _readPath = p => foundry.utils.getProperty(this.document, p);

    const _applyFill = async (el, maxDataKey) => {
      const path  = el.dataset.path;
      const index = Number(el.dataset.index);
      const max   = Number(el.dataset[maxDataKey] ?? 0) || 0;
      if (!path) return;
      const cur  = Number(_readPath(path)) || 0;
      const next = cur > index ? index : index + 1;
      await this.document.update({ [path]: Math.min(max, Math.max(0, next)) });
    };

    root.addEventListener("click", async ev => {
      const pip = ev.target.closest(".sd-tracker-pip[data-path]");
      if (pip && !pip.dataset.sdDirect) {
        ev.stopPropagation();
        await _applyFill(pip, "max");
        return;
      }
      const reset = ev.target.closest(".sd-tracker-reset[data-path]");
      if (reset && !reset.dataset.sdDirect) {
        ev.stopPropagation();
        await this.document.update({ [reset.dataset.path]: 0 });
        return;
      }
      const seg = ev.target.closest(".sd-clock-segment[data-path]");
      if (seg && !seg.dataset.sdDirect) {
        ev.stopPropagation();
        await _applyFill(seg, "segs");
        return;
      }
      const cReset = ev.target.closest(".sd-clock-reset[data-path]");
      if (cReset && !cReset.dataset.sdDirect) {
        ev.stopPropagation();
        await this.document.update({ [cReset.dataset.path]: 0 });
      }
    });
  }

  _buildTabNav() {
    const root = this.element;
    if (!root) return;

    let nav = root.querySelector(".sd-tab-nav");
    if (!nav) {
      nav = document.createElement("nav");
      nav.className = "sd-tab-nav";
      nav.style.cssText = "display:flex;flex-wrap:wrap;gap:2px;padding:5px 12px 0;background:#22222e;border-bottom:1px solid #3a3a52;flex-shrink:0;";
      // Always append to window-content -- it will appear after the header PART div
      root.querySelector(".window-content")?.appendChild(nav);
    }

    nav.innerHTML = "";

    const tabs      = this.document.system.customTabs ?? [];
    const activeTab = this.tabGroups.sheet || tabs[0]?.id || "";

    tabs.forEach(tab => {
      const isActive = tab.id === activeTab;
      const a = document.createElement("a");
      a.className       = "sd-tab-btn";
      a.dataset.tabId   = tab.id;
      a.style.cssText   = `
        padding:5px 11px; font-size:11px; font-weight:700; text-transform:uppercase;
        letter-spacing:.04em; cursor:pointer; border-radius:4px 4px 0 0;
        border:1px solid ${isActive ? "#3a3a52" : "transparent"}; border-bottom:none;
        color:${isActive ? "#7b68ee" : "#666"}; background:${isActive ? "#1a1a24" : "transparent"};
        display:inline-flex; align-items:center; gap:4px; white-space:nowrap; user-select:none;
      `;
      a.innerHTML = `${tab.label}
        ${this._editMode
          ? `<span data-rename="${tab.id}" style="opacity:.35;font-size:9px;cursor:pointer" title="Rename">✎</span>
             <span data-deltab="${tab.id}" style="opacity:.35;font-size:9px;cursor:pointer" title="Delete">✕</span>`
          : ""}`;

      a.addEventListener("click", ev => {
        if (ev.target.dataset.rename) { ev.stopPropagation(); this._renameTab(tab.id); return; }
        if (ev.target.dataset.deltab) { ev.stopPropagation(); this._deleteTab(tab.id); return; }
        this._switchTab(tab.id);
      });

      nav.appendChild(a);
    });

    // "+" button
    if (this._editMode) {
      const plus = document.createElement("a");
      plus.className    = "sd-tab-btn sd-add-tab";
      plus.title        = "Click to add tab, or drop 'New Tab' here";
      plus.innerHTML    = '<i class="fas fa-plus"></i>';
      plus.style.cssText = "padding:5px 10px;font-size:11px;cursor:pointer;border-radius:4px 4px 0 0;border:1px dashed #7b68ee;border-bottom:none;color:#7b68ee;opacity:.6;display:inline-flex;align-items:center;transition:opacity .15s,background .15s;";
      plus.addEventListener("click",     () => this._addTab());
      plus.addEventListener("dragover",  ev => { ev.preventDefault(); plus.style.opacity="1"; plus.style.background="rgba(123,104,238,.15)"; });
      plus.addEventListener("dragleave", () => { plus.style.opacity=".6"; plus.style.background=""; });
      plus.addEventListener("drop",      ev => {
        ev.preventDefault(); plus.style.opacity=".6"; plus.style.background="";
        try { const d=JSON.parse(ev.dataTransfer.getData("text/plain")); if(d.sdType==="newTab") this._addTab(); } catch { this._addTab(); }
      });
      nav.appendChild(plus);
    }

    // Right side: system tab + Save as Template button
    const spacer = document.createElement("div");
    spacer.style.cssText = "flex:1";
    nav.appendChild(spacer);

    // Hidden Fields sys tab
    const isHFActive = this.tabGroups.sheet === "_sys_hidden";
    const hfTab = document.createElement("a");
    hfTab.className = "sd-tab-btn";
    hfTab.dataset.tabId = "_sys_hidden";
    hfTab.style.cssText = `padding:5px 9px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;cursor:pointer;border-radius:4px 4px 0 0;border:1px solid ${isHFActive?"#3a3a52":"transparent"};border-bottom:none;color:${isHFActive?"#5ae07a":"#444"};background:${isHFActive?"#1a1a24":"transparent"};display:inline-flex;align-items:center;gap:3px;`;
    hfTab.innerHTML = `<i class='fas fa-eye-slash'></i>`;
    hfTab.title = "Hidden Fields";
    hfTab.addEventListener("click", () => {
      // Toggle: if already active, go back to first custom tab (or close)
      if (this.tabGroups.sheet === "_sys_hidden") {
        const tabs = this.document.system.customTabs ?? [];
        this._switchTab(tabs[0]?.id ?? "");
      } else {
        this._switchTab("_sys_hidden");
      }
    });
    nav.appendChild(hfTab);

    // Save as Template button
    const tplBtn = document.createElement("a");
    tplBtn.style.cssText = "padding:4px 9px;font-size:10px;cursor:pointer;border-radius:4px 4px 0 0;border:1px solid #3a3a52;border-bottom:none;color:#888;background:transparent;display:inline-flex;align-items:center;gap:4px;white-space:nowrap;";
    tplBtn.innerHTML = `<i class="fas fa-floppy-disk"></i> Template`;
    tplBtn.title = "Save sheet layout as template (use Sheet Builder → Templates → Create)";
    tplBtn.addEventListener("click", () => this._saveAsTemplate());
    nav.appendChild(tplBtn);

    if (!this.tabGroups.sheet && tabs.length > 0) {
      this.tabGroups.sheet = tabs[0].id;
    }
  }

  _buildTabPanels() {
    const root = this.element;
    if (!root) return;

    // Use or create a single dedicated container for all panels
    let container = root.querySelector(".sd-panels-container");
    if (!container) {
      container = document.createElement("div");
      container.className = "sd-panels-container";
      container.style.cssText = "flex:1;display:flex;flex-direction:column;min-height:0;overflow:hidden;position:relative;";
      root.querySelector(".window-content")?.appendChild(container);
    }

    // Clear everything inside it
    container.innerHTML = "";

    const tabs = this.document.system.customTabs ?? [];

    // Ensure active tab is valid -- includes _sys_hidden
    const validIds = [...tabs.map(t => t.id), "_sys_hidden"];
    if (!this.tabGroups.sheet || !validIds.includes(this.tabGroups.sheet)) {
      this.tabGroups.sheet = tabs[0]?.id ?? "";
    }

    // Hidden Fields panel -- built first so it's part of the container flow
    container.appendChild(this._buildHiddenFieldsPanel(this.tabGroups.sheet === "_sys_hidden"));

    tabs.forEach(tab => {
      const panel = document.createElement("div");
      panel.className     = "sd-tab-panel";
      panel.dataset.tab   = tab.id;
      const isActive      = tab.id === this.tabGroups.sheet;
      panel.style.cssText = `
        display:${isActive ? "flex" : "none"};
        flex:1; overflow-y:auto; padding:12px 14px;
        flex-direction:column; gap:8px; min-height:0;
      `;

      (tab.rows ?? []).forEach(row => {
        panel.appendChild(this._buildRow(tab, row));
      });

      if (this._editMode) {
        panel.appendChild(this._makeDropZone(tab, null, "Drop a widget here to add a new row"));
      }

      container.appendChild(panel);
    });

    // Empty state -- only when no tabs
    if (tabs.length === 0) {
      const empty = document.createElement("div");
      empty.style.cssText = "flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;color:#444;";
      empty.innerHTML = `
        <i class="fas fa-toolbox" style="font-size:40px;opacity:.3"></i>
        <p style="font-size:13px;text-align:center;max-width:260px;line-height:1.6;margin:0">
          Click <strong style="color:#7b68ee">Builder</strong> in the title bar,<br>
          then drag <strong>New Tab</strong> onto the <strong style="color:#7b68ee">+</strong>
        </p>
      `;
      container.appendChild(empty);
    }
  }

  _buildHiddenFieldsPanel(isActive) {
    const panel = document.createElement("div");
    panel.className = "sd-tab-panel";
    panel.dataset.tab = "_sys_hidden";
    panel.style.cssText = `display:${isActive?"flex":"none"};flex:1;overflow-y:auto;padding:12px 14px;flex-direction:column;gap:8px;min-height:0;`;
    const sys = this.document.system;
    const ed  = this.isEditable;
    const e   = s => String(s??"").replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;");
    const hf  = Object.entries(sys.hiddenFields??{});

    let html = `<div style="font-size:11px;color:#555;margin-bottom:8px;line-height:1.6">
      GM-only key/value pairs attached to this actor. Path: <code style="background:#1e1e2a;padding:1px 5px;border-radius:3px;font-size:10px;color:#9d8fff">system.hiddenFields.name</code>
      ${ed ? `<button data-hf-action="add" style="margin-left:8px;background:#2a2a38;border:1px solid #3a3a52;border-radius:3px;color:#7b68ee;cursor:pointer;font-size:10px;padding:2px 8px">+ Add</button>` : ""}
    </div>`;

    if (!hf.length) {
      html += `<div style="color:#333;font-size:11px;font-style:italic;text-align:center;padding:20px 0">No hidden fields yet.</div>`;
    } else {
      for (const [k, v] of hf) {
        html += `<div style="display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid #1e1e2a">
          <input type="text" data-hf-key="${e(k)}" data-hf-rename value="${e(k)}" style="width:130px;background:#1e1e2a;border:1px solid #2a2a38;border-radius:4px;color:#9d8fff;font-size:11px;font-family:monospace;padding:3px 6px" ${!ed?"disabled":""}>
          <input type="text" data-hf-key="${e(k)}" data-hf-val value="${e(String(v))}" style="flex:1;background:#1e1e2a;border:1px solid #2a2a38;border-radius:4px;color:#e0e0ee;font-size:11px;padding:3px 6px" ${!ed?"disabled":""}>
          <button type="button" data-hf-action="copy-path" data-hf-key="${e(k)}" title="Copy path: system.hiddenFields.${e(k)}" style="background:none;border:none;color:#555;cursor:pointer;font-size:11px;padding:0 4px" tabindex="-1"><i class="fas fa-copy"></i></button>
          ${ed?`<button data-hf-action="remove" data-hf-key="${e(k)}" style="background:none;border:none;color:#444;cursor:pointer;font-size:12px;padding:0 4px">✕</button>`:""}
        </div>`;
      }
    }

    panel.innerHTML = html;

    // Wire copy-path
    panel.querySelectorAll("[data-hf-action='copy-path']").forEach(btn => {
      btn.addEventListener("click", async () => {
        const path = `system.hiddenFields.${btn.dataset.hfKey}`;
        try { await navigator.clipboard.writeText(path); ui.notifications.info(`Copied: ${path}`); }
        catch { ui.notifications.warn("Could not copy to clipboard"); }
      });
    });

    // Shared helper: replace entire hiddenFields object (avoids all
    //   ForcedDeletion / dotted-path deletion quirks in Foundry v14) ──────────
    const _hfReplace = async (newFields) => {
      // Foundry's ObjectField merge will only ADD/UPDATE keys via dotted paths.
      // To remove a key we must first null every existing key then set the new set.
      const current = this.document.system.hiddenFields ?? {};
      const patch = {};
      // Null-out every key that should disappear
      for (const k of Object.keys(current)) {
        if (!(k in newFields)) patch[`system.hiddenFields.-=${k}`] = null;
      }
      // Set every surviving / new key
      for (const [k, v] of Object.entries(newFields)) {
        patch[`system.hiddenFields.${k}`] = v;
      }
      await this.document.update(patch);
    };

    // Wire add
    let _adding = false;
    panel.querySelector("[data-hf-action='add']")?.addEventListener("click", async () => {
      if (_adding) return;
      _adding = true;
      try {
        const fields = foundry.utils.deepClone(this.document.system.hiddenFields ?? {});
        let i = Object.keys(fields).length + 1;
        let k = `field${i}`;
        while (k in fields) { i++; k = `field${i}`; }
        fields[k] = "";
        await _hfReplace(fields);
      } finally { _adding = false; }
    });

    // Wire remove
    panel.querySelectorAll("[data-hf-action='remove']").forEach(btn => {
      btn.addEventListener("click", async () => {
        const fields = foundry.utils.deepClone(this.document.system.hiddenFields ?? {});
        delete fields[btn.dataset.hfKey];
        await _hfReplace(fields);
      });
    });

    // Wire value save
    panel.querySelectorAll("[data-hf-val]").forEach(inp => {
      inp.addEventListener("change", async () => {
        await this.document.update({ [`system.hiddenFields.${inp.dataset.hfKey}`]: inp.value });
      });
    });

    // Wire key rename
    panel.querySelectorAll("[data-hf-rename]").forEach(inp => {
      inp.addEventListener("change", async () => {
        const oldKey = inp.dataset.hfKey;
        const newKey = inp.value.trim().replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_]/g, "");
        if (!newKey || newKey === oldKey) return;
        const fields = foundry.utils.deepClone(this.document.system.hiddenFields ?? {});
        const val = fields[oldKey] ?? "";
        delete fields[oldKey];
        fields[newKey] = val;
        await _hfReplace(fields);
      });
    });

    return panel;
  }

  async _saveAsTemplate() {
    const name = await foundry.applications.api.DialogV2.wait({
      window: { title: "Save as Template" },
      content: `<div style="padding:8px 0">
        <label style="font-size:12px;color:#888">Template name:</label>
        <input type="text" name="tplName" value="${this.document.name} Template"
          style="width:100%;margin-top:4px;background:#2a2a38;border:1px solid #3a3a52;color:#e0e0ee;border-radius:4px;padding:4px 8px;font-size:13px;box-sizing:border-box">
      </div>`,
      buttons: [
        {
          action: "save",
          label: "Save",
          icon: "fas fa-floppy-disk",
          default: true,
          callback: (event, button, dialog) =>
            dialog.element.querySelector("input[name='tplName']")?.value?.trim() || null
        },
        { action: "cancel", label: "Cancel", callback: () => null }
      ],
      rejectClose: false
    }).catch(() => null);
    if (!name) return;

    const doc = this.document;
    const sys = doc.system ?? {};

    // Save full sheet builder state to game.settings -- NOT as an Actor copy
    const stored = foundry.utils.deepClone(game.settings.get("sd", "sheetTemplates") ?? {});
    stored[name] = {
      name,
      docType:         "Actor",
      itemType:        doc.type ?? "character",
      customTabs:      foundry.utils.deepClone(sys.customTabs      ?? []),
      hiddenFields:    foundry.utils.deepClone(sys.hiddenFields     ?? {}),
      declaredAttrs:   foundry.utils.deepClone(sys.declaredAttrs    ?? []),
      slotDefinitions: foundry.utils.deepClone(sys.slotDefinitions  ?? []),
      // Sheet-level event trigger graph -- preserves actor-wide on_* hooks
      sdTriggerGraph:  foundry.utils.deepClone(sys.sdTriggerGraph   ?? {}),
      created: Date.now()
    };
    await game.settings.set("sd", "sheetTemplates", stored);

    // Refresh Toolbox panel if it is open
    try {
      const tb = Object.values(foundry.applications.instances ?? {})
        .find(a => a.constructor?.name === "Toolbox");
      tb?.render?.();
    } catch {}

    ui.notifications.info(`Template "${name}" saved — use "Create" in Sheet Builder → Templates.`);
  }

  _buildRow(tab, row) {
    const rowEl = document.createElement("div");
    rowEl.dataset.rowId  = row.id;
    rowEl.style.cssText  = `
      display:grid; grid-template-columns:repeat(3,1fr); gap:8px;
      align-items:start; position:relative;
      padding:8px 8px 8px 8px;
      border:1px dashed rgba(123,104,238,.12); border-radius:6px;
    `;

    // Row delete button (edit mode only)
    if (this._editMode) {
      const del = document.createElement("button");
      del.type = "button";
      del.innerHTML = "✕";
      del.title = "Delete row";
      del.style.cssText = `
        position:absolute; top:-9px; right:4px; z-index:10;
        background:#1a1a24; border:1px solid #3a3a52; border-radius:3px;
        color:#555; cursor:pointer; font-size:10px; padding:0 5px; line-height:17px;
      `;
      del.addEventListener("click", () => this._deleteRow(tab.id, row.id));
      rowEl.appendChild(del);
    }

    // Widgets
    (row.widgets ?? []).forEach(w => {
      rowEl.appendChild(this._buildWidget(tab, row, w));
    });

    // Intra-row drop zone
    if (this._editMode) {
      rowEl.appendChild(this._makeDropZone(tab, row, "Drop widget here"));
    }

    return rowEl;
  }

  _buildWidget(tab, row, w) {
    const span = w.span ?? 1;
    const cell = document.createElement("div");
    cell.dataset.widgetId = w.id;
    cell.style.cssText    = `grid-column:span ${span}; position:relative; min-width:0;`;

    // Widget body -- honour showIf: if hidden, collapse cell to zero size
    const val = this._getVal(w);
    const html = this._widgetHTML(w, val);
    if (!html && !this._editMode) {
      // showIf evaluated false -- remove from layout entirely
      cell.style.display = "none";
      return cell;
    }
    cell.innerHTML = html || "";
    this._wireWidget(cell, w);

    // Edit overlay (visible on hover in edit mode)
    if (this._editMode) {
      const ov = document.createElement("div");
      ov.className = "sd-widget-ov";
      ov.style.cssText = `
        display:none; position:absolute; top:2px; right:2px; z-index:20;
        flex-direction:row; gap:2px;
      `;
      ov.innerHTML = `
        <button type="button" title="Configure" data-action="wcfg"
          style="background:#1a1a24;border:1px solid #7b68ee;border-radius:3px;color:#7b68ee;cursor:pointer;font-size:10px;padding:0 5px;line-height:18px">⚙</button>
        <button type="button" title="Width (${span})" data-action="wspan"
          style="background:#1a1a24;border:1px solid #3a3a52;border-radius:3px;color:#888;cursor:pointer;font-size:10px;padding:0 5px;line-height:18px">↔${span}</button>
        <button type="button" title="Remove" data-action="wdel"
          style="background:#1a1a24;border:1px solid #e05a5a;border-radius:3px;color:#e05a5a;cursor:pointer;font-size:10px;padding:0 5px;line-height:18px">✕</button>
      `;
      ov.querySelector('[data-action="wcfg"]').addEventListener("click",  ev => { ev.stopPropagation(); this._configWidget(tab, row, w); });
      ov.querySelector('[data-action="wspan"]').addEventListener("click", ev => { ev.stopPropagation(); this._cycleSpan(tab, row, w); });
      ov.querySelector('[data-action="wdel"]').addEventListener("click",  ev => { ev.stopPropagation(); this._deleteWidget(tab, row, w); });

      cell.addEventListener("mouseenter", () => ov.style.display = "flex");
      cell.addEventListener("mouseleave", () => ov.style.display = "none");
      cell.appendChild(ov);
    }

    return cell;
  }

  _getVal(w) {
    const doc = this.document;
    // valueFormula takes priority -- evaluated synchronously by FormulaEngine
    if (w.valueFormula?.trim()) {
      try {
        const FE = globalThis._SD_FE?.FormulaEngine;
        if (FE) return FE.evaluate(w.valueFormula, doc);
      } catch {}
    }
    if (w.path)      return foundry.utils.getProperty(doc, w.path) ?? "";
    if (w.pathValue) return foundry.utils.getProperty(doc, w.pathValue) ?? 0;
    return "";
  }

  _widgetHTML(w, val) {
    const e   = s => String(s ?? "").replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;");

    // showIf guard -- hide widget when formula evaluates to false/0
    if (w.showIf && String(w.showIf).trim()) {
      try {
        const FE = globalThis._SD_FE?.FormulaEngine;
        if (FE) {
          const result = FE.evaluate(w.showIf, this.document);
          if (!result || result === "0" || result === 0 || result === false) return "";
        }
      } catch { /* show on error */ }
    }

    const lbl = w.label ? `<div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#888;margin-bottom:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${e(w.label)}</div>` : "";
    const inp = `style="width:100%;background:#22222e;border:1px solid #3a3a52;border-radius:4px;color:#e0e0ee;font-size:12px;padding:4px 7px;box-sizing:border-box;min-width:0"`;
    const hasFormula = !!w.valueFormula?.trim();

    switch (w.type) {
      case "text":
        if (hasFormula) return `${lbl}<div style="width:100%;background:#22222e;border:1px solid #2a2a42;border-radius:4px;color:#e0e0ee;font-size:12px;padding:4px 7px;box-sizing:border-box;min-width:0" title="Formula: ${e(w.valueFormula)}">${e(String(val))}<span style="float:right;color:#5a4ec0;font-size:9px">ƒ</span></div>`;
        if (w.readOnly === true || w.readOnly === "true") return `${lbl}<div style="width:100%;background:#111120;border:1px solid #2a2a38;border-radius:4px;color:#8888aa;font-size:12px;padding:4px 7px;box-sizing:border-box;min-width:0">${e(String(val))} <span style="float:right;opacity:.4" title="Read only">🔒</span></div>`;
        return `${lbl}<input type="text" data-path="${e(w.path)}" value="${e(val)}" ${inp}>`;

      case "number":
        if (hasFormula) return `${lbl}<div style="text-align:center;font-weight:700;font-size:18px;color:#e0e0ee;padding:4px 2px;background:#22222e;border:1px solid #2a2a42;border-radius:4px" title="Formula: ${e(w.valueFormula)}">${e(String(val))}<span style="font-size:9px;color:#5a4ec0;margin-left:4px">ƒ</span></div>`;
        return `${lbl}<div style="display:flex;align-items:center;gap:3px">
          <button data-step="-${w.step||1}" data-path="${e(w.path)}"
            style="width:26px;height:26px;flex-shrink:0;background:#22222e;border:1px solid #3a3a52;border-radius:4px;color:#a0a0c0;cursor:pointer;font-size:16px;line-height:1">−</button>
          <input type="number" data-path="${e(w.path)}" value="${e(val)}"
            style="flex:1;text-align:center;font-weight:700;font-size:15px;background:#22222e;border:1px solid #3a3a52;border-radius:4px;color:#e0e0ee;padding:2px;box-sizing:border-box;min-width:0">
          <button data-step="${w.step||1}" data-path="${e(w.path)}"
            style="width:26px;height:26px;flex-shrink:0;background:#22222e;border:1px solid #3a3a52;border-radius:4px;color:#a0a0c0;cursor:pointer;font-size:16px;line-height:1">+</button>
        </div>`;

      case "resource": {
        const doc = this.document;
        const vv  = Number(foundry.utils.getProperty(doc, w.pathValue) ?? 0);
        const mx  = Number(foundry.utils.getProperty(doc, w.pathMax)   ?? 0);
        const pct = mx > 0 ? Math.round(Math.clamp(vv / mx, 0, 1) * 100) : 0;
        const clr = w.color ?? "#7b68ee";
        return `${lbl}
          <div style="display:flex;align-items:center;gap:4px">
            <input type="number" data-path="${e(w.pathValue)}" value="${e(vv)}"
              style="width:46px;text-align:center;font-weight:700;font-size:14px;background:#22222e;border:1px solid #3a3a52;border-radius:4px;color:#e0e0ee;padding:2px;box-sizing:border-box">
            <span style="color:#555;flex-shrink:0">/</span>
            <input type="number" data-path="${e(w.pathMax)}" value="${e(mx)}"
              style="width:46px;text-align:center;font-size:13px;background:#22222e;border:1px solid #3a3a52;border-radius:4px;color:#a0a0c0;padding:2px;box-sizing:border-box">
          </div>
          <div style="height:5px;background:#111;border-radius:3px;overflow:hidden;margin-top:3px">
            <div style="height:100%;width:${pct}%;background:${e(clr)};border-radius:3px;transition:width .3s"></div>
          </div>`;
      }

      case "dice": {
        const diceFormula = w.formula ?? "1d20";
        const diceMacroScript = `// ${e(w.label ?? "Roll")}\\nconst actor = token?.actor ?? game.user.character;\\nconst roll = new Roll("${e(diceFormula)}", actor?.getRollData() ?? {});\\nawait roll.evaluate();\\nawait roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: "${e(w.label ?? "Roll")}" });`;
        return `${lbl}<div style="display:flex;align-items:center;gap:4px">
          <button type="button" data-roll="${e(diceFormula)}" data-flavor="${e(w.label ?? "Roll")}"
            style="flex:1;padding:6px 8px;background:#22222e;border:1px solid #3a3a52;border-radius:4px;color:#e0e0ee;cursor:pointer;font-size:12px;font-weight:600;display:flex;align-items:center;justify-content:center;gap:6px;box-sizing:border-box;transition:border-color .15s">
            <i class="fas fa-dice-d20" style="color:#7b68ee"></i>
            ${e(w.label ?? "Roll")}
            <span style="opacity:.4;font-size:10px;margin-left:2px">${e(diceFormula)}</span>
          </button>
          <button type="button" data-copy-macro="${e(diceMacroScript)}" title="Copy as Macro"
            style="background:none;border:1px solid #3a3a52;border-radius:4px;color:#444;cursor:pointer;font-size:10px;padding:4px 6px;flex-shrink:0;transition:color .15s,border-color .15s"
            onmouseover="this.style.color='#7b68ee';this.style.borderColor='#7b68ee'" onmouseout="this.style.color='#444';this.style.borderColor='#3a3a52'">
            <i class="fas fa-scroll"></i>
          </button>
        </div>`;
      }

      case "toggle": {
        const on  = !!val;
        const lv  = on ? (w.onLabel ?? "On") : (w.offLabel ?? "Off");
        return `${lbl}<div data-toggle="${e(w.path)}" data-on="${on}"
          style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:3px 0;user-select:none">
          <div style="width:36px;height:20px;flex-shrink:0;background:${on ? "#7b68ee" : "#22222e"};border:1px solid ${on ? "#7b68ee" : "#3a3a52"};border-radius:10px;position:relative;transition:background .2s">
            <div style="position:absolute;top:2px;left:${on ? "18px" : "2px"};width:14px;height:14px;background:${on ? "#fff" : "#555"};border-radius:50%;transition:left .2s"></div>
          </div>
          <span style="font-size:12px;color:#a0a0c0">${e(lv)}</span>
        </div>`;
      }

      case "section":
        return `<div style="grid-column:span 3;display:flex;align-items:center;gap:8px;padding:4px 0">
          <span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#a0a0c0;white-space:nowrap">${e(w.label)}</span>
          <div style="flex:1;height:1px;background:#3a3a52"></div>
        </div>`;

      case "richtext":
        return WidgetRenderer._render_richtext(w, this.document);

      case "attribute": {
        const score = Number(foundry.utils.getProperty(this.document, w.path) ?? 10);
        let mod;
        if (w.modValueFormula) {
          try {
            const resolved = Number(w.modValueFormula.replace(/\{([^}]+)\}/g, (_, p) => {
              const v = foundry.utils.getProperty(this.document, p);
              return v !== undefined && v !== null ? v : 0;
            }));
            mod = isNaN(resolved) ? Math.floor((score - 10) / 2) : resolved;
          } catch { mod = Math.floor((score - 10) / 2); }
        } else {
          mod = Math.floor((score - 10) / 2);
        }
        const ms = mod >= 0 ? `+${mod}` : `${mod}`;
        // onClickFormula -- exec graph wired from on_click node; falls back to plain roll
        const onClickFml = w.onClickFormula ?? null;
        const clickAttrs = onClickFml
          ? `data-attr-onclick="${e(onClickFml)}"`
          : `data-attr-roll="1d20+(${mod})" data-flavor="${e(w.flavor || w.label)}"`;
        return `${lbl}
          <div style="display:flex;flex-direction:column;align-items:center;gap:2px;background:#22222e;border:1px solid #3a3a52;border-radius:6px;padding:6px">
            <input type="number" data-path="${e(w.path)}" value="${e(score)}"
              style="width:52px;text-align:center;font-size:18px;font-weight:700;background:transparent;border:none;border-bottom:1px solid #3a3a52;color:#e0e0ee;padding:0;box-sizing:border-box">
            <button type="button" data-action="attrModClick" ${clickAttrs}
              style="font-size:14px;font-weight:700;color:#7b68ee;cursor:pointer;padding:2px 8px;border-radius:4px;background:none;border:none"
              title="${onClickFml ? "Click to execute action" : "Click to roll"}">${ms}</button>
          </div>`;
      }

      case "skill": {
        const rank = Number(foundry.utils.getProperty(this.document, w.path) ?? 0);
        const bonus = rank + (w.attrMod ?? 0);
        const bs = bonus >= 0 ? `+${bonus}` : `${bonus}`;
        // Use custom formula if set, otherwise default 1d20+bonus
        const skillRollFormula = (w.rollFormula && w.rollFormula.trim()) ? w.rollFormula.trim() : `1d20+${bonus}`;
        const skillMacroScript = `// ${e(w.label)} skill roll\\nconst actor = token?.actor ?? game.user.character;\\nif (!actor) return ui.notifications.warn("No actor selected");\\nconst rank = foundry.utils.getProperty(actor, "${e(w.path)}") ?? 0;\\nconst bonus = rank + ${w.attrMod ?? 0};\\nconst formula = ${w.rollFormula?.trim() ? `"${e(w.rollFormula.trim())}"` : "`1d20+${bonus}`"};\\nconst roll = new Roll(formula, actor.getRollData());\\nawait roll.evaluate();\\nawait roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: "${e(w.label)}" });`;
        return `<div style="display:flex;align-items:center;gap:6px;padding:3px 0;position:relative">
          <span style="flex:1;font-size:12px;color:#e0e0ee;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${e(w.label)}</span>
          <input type="number" data-path="${e(w.path)}" value="${e(rank)}"
            style="width:36px;text-align:center;background:#22222e;border:1px solid #3a3a52;border-radius:4px;color:#e0e0ee;font-size:12px;padding:2px;box-sizing:border-box">
          <span data-roll="${e(skillRollFormula)}" data-flavor="${e(w.label)}"
            style="font-size:12px;font-weight:700;color:#7b68ee;cursor:pointer;min-width:28px;text-align:right;padding:2px 4px;border-radius:4px"
            title="Roll check (${e(skillRollFormula)})">${bs}</span>
          <button type="button" data-copy-macro="${e(skillMacroScript)}" title="Copy as Macro"
            style="background:none;border:none;color:#444;cursor:pointer;font-size:9px;padding:1px 3px;flex-shrink:0;border-radius:3px;transition:color .15s"
            onmouseover="this.style.color='#7b68ee'" onmouseout="this.style.color='#444'">
            <i class="fas fa-scroll"></i>
          </button>
        </div>`;
      }

      case "slot": {
        // Shows contents of a slot defined on this actor/item
        const slotId   = w.slotId ?? "";
        const contents = this.document.system?.slotContents?.[slotId]?.contents ?? [];
        const defs     = this.document.system?.slotDefinitions ?? [];
        const def      = defs.find(d => d.id === slotId);
        const max      = def?.maxCount ?? w.maxCount ?? 1;
        const items    = contents.map((c, i) => `
          <div style="display:flex;align-items:center;gap:5px;padding:3px 0;border-bottom:1px solid #2a2a38" draggable="true" data-item-id="${e(c._id ?? "")}" data-item-uuid="${e(c._sourceUuid ?? c.uuid ?? "")}" data-slot-item-drag>
            <img src="${e(c.img ?? 'icons/svg/item-bag.svg')}" style="width:20px;height:20px;border-radius:3px;object-fit:cover;flex-shrink:0">
            <span style="flex:1;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${e(c.name ?? '?')}</span>
            <button type="button" data-sd-slot-use="${e(slotId)}" data-sd-slot-idx="${i}"
              style="background:none;border:none;color:#7b68ee;cursor:pointer;padding:0 4px;font-size:10px;flex-shrink:0;opacity:.7;transition:opacity .15s" title="Use item"
              onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='.7'">
              <i class="fas fa-play"></i>
            </button>
            <button type="button" data-sd-slot-edit="${e(slotId)}" data-sd-slot-idx="${i}" data-item-id="${e(c._id ?? "")}" data-item-uuid="${e(c._sourceUuid ?? c.uuid ?? "")}"
              style="background:none;border:none;color:#9d8fff;cursor:pointer;padding:0 4px;font-size:10px;flex-shrink:0;opacity:.7;transition:opacity .15s" title="Edit item"
              onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='.7'">
              <i class="fas fa-pen"></i>
            </button>
            <button type="button" data-sd-slot-remove="${e(slotId)}" data-sd-slot-idx="${i}"
              style="background:none;border:none;color:#555;cursor:pointer;padding:0 4px;font-size:11px;flex-shrink:0" title="Remove">✕</button>
          </div>`).join('');
        return `${lbl}
          <div style="background:#22222e;border:1px solid #3a3a52;border-radius:4px;padding:5px">
            <div style="font-size:10px;color:#555;margin-bottom:${items ? '4' : '0'}px">${contents.length}/${max}</div>
            ${items}
            <div data-sd-slot-drop="${e(slotId)}"
              style="margin-top:${items ? '5' : '2'}px;border:1px dashed rgba(123,104,238,.25);border-radius:3px;padding:4px 6px;text-align:center;font-size:10px;color:#555;cursor:pointer;transition:background .15s">
              <i class="fas fa-arrow-down-to-line" style="margin-right:3px"></i>Drop item here
            </div>
          </div>`;
      }

      case "button":
        // Delegate to WidgetRenderer -- it produces the sd-action-btn with data-action="widgetButton"
        return WidgetRenderer._render_button(w, this.document);

      case "inventory": {
        // Delegate to WidgetRenderer for full inventory rendering
        return WidgetRenderer._render_inventory(w, this.document);
      }

      case "effects": {
        return WidgetRenderer._render_effects(w, this.document);
      }

      case "spellbook": {
        return WidgetRenderer._render_spellbook(w, this.document);
      }

      // New widget types -- delegate to WidgetRenderer
      case "progress":
      case "select":
      case "clock":
      case "tracker":
      case "tags":
      case "image":
      case "derived":
      case "counter":
      case "rollButton":
      case "tokenPool":
      case "diceTray":
        return WidgetRenderer.render(w, this.document);

      default:
        // Any unknown widget type: try WidgetRenderer first, fall back to placeholder
        return WidgetRenderer.render(w, this.document)
          ?? `${lbl}<span style="font-size:11px;color:#555;font-style:italic">[${e(w.type)}]</span>`;
    }
  }

  _wireWidget(cell, w) {
    const doc = this.document;

    // Input change → save
    cell.querySelectorAll("input[data-path]").forEach(inp => {
      inp.addEventListener("change", async () => {
        const v = inp.type === "number" ? Number(inp.value) : inp.value;
        await doc.update({ [inp.dataset.path]: v });
      });
    });

    // ± step buttons.  Also dispatches for widgets that use
    // `data-action="widgetNumStep"` (counter, tokenPool) -- per-button
    // `data-min` / `data-max` attributes take precedence over `w.min` /
    // `w.max`, so those widgets get proper clamping without needing a
    // second listener (which caused duplicate doc.update()s in PR6).
    cell.querySelectorAll("[data-step]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const step   = parseFloat(btn.dataset.step);
        const path   = btn.dataset.path;
        const cur    = Number(_readPath(path) ?? 0);
        const dsMin  = btn.dataset.min;
        const dsMax  = btn.dataset.max;
        const min    = (dsMin  !== undefined && dsMin  !== "") ? parseFloat(dsMin)
                     : (w.min != null ? w.min : -Infinity);
        const max    = (dsMax  !== undefined && dsMax  !== "") ? parseFloat(dsMax)
                     : (w.max != null ? w.max :  Infinity);
        await doc.update({ [path]: Math.clamp(cur + step, min, max) });
      });
    });

    // Roll button / modifier click (legacy data-roll attribute from widget renderer)
    cell.querySelectorAll("[data-roll]").forEach(el => {
      el.addEventListener("click", async () => {
        let formula = el.dataset.roll;
        if (!formula || formula.trim().startsWith("[")) return; // action graph — not a roll formula
        try {
          const { FormulaEngine } = await import("../helpers/formula-engine.mjs");
          formula = FormulaEngine.resolveForRoll(formula, doc);
        } catch(e) {}
        try {
          const roll = new Roll(formula, doc.getRollData?.() ?? {});
          await roll.evaluate();
          await roll.toMessage({
            speaker: ChatMessage.getSpeaker({ actor: doc }),
            flavor:  el.dataset.flavor
          });
        } catch(e) {
          console.error("SD | data-roll error:", e, "formula:", formula);
        }
      });
    });

    // Toggle
    cell.querySelectorAll("[data-toggle]").forEach(tog => {
      tog.addEventListener("click", async () => {
        await doc.update({ [tog.dataset.toggle]: tog.dataset.on !== "true" });
      });
    });

    // Attribute modifier click -- runs onClickFormula (exec graph) or falls back to roll
    cell.querySelectorAll("[data-action='attrModClick']").forEach(btn => {
      btn.addEventListener("click", async () => {
        const onClickFml = btn.dataset.attrOnclick;
        if (onClickFml) {
          // Execute compiled action graph
          const trimmed = onClickFml.trim();
          if (trimmed.startsWith("[")) {
            try {
              const actions = JSON.parse(trimmed);
              const actorCtx = doc instanceof Actor ? doc : doc.actor ?? null;
              const itemCtx = doc instanceof Actor ? null : doc;
              // Shared buttonDef + runtime so actions can pass data to each other
              // (e.g. rollValue stores __lastRoll, chatDamage reads it)
              const fakeBtnDef = { label: btn.dataset.flavor ?? "" };
              const runtime = {};
              for (const action of actions) {
                await ButtonExecutor._runAction(action, itemCtx ?? { system: {}, actor: actorCtx }, actorCtx, fakeBtnDef, runtime);
              }
            } catch(err) { console.error("SD | attrModClick exec error:", err); }
            return;
          }
        }
        // Fallback: plain roll via data-attr-roll
        let formula = btn.dataset.attrRoll || "1d20";
        try {
          const { FormulaEngine } = await import("../helpers/formula-engine.mjs");
          formula = FormulaEngine.resolveForRoll(formula, doc);
        } catch(e) { console.warn("SD | attrModClick formula resolve:", e); }
        try {
          const roll = new Roll(formula, doc.getRollData?.() ?? {});
          await roll.evaluate();
          await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor: doc }), flavor: btn.dataset.flavor });
        } catch(e) { console.error("SD | attrModClick roll error:", e, "formula:", formula); }
      });
    });

    // WidgetRenderer action buttons (widgetRoll, widgetNumStep, widgetToggle)
    cell.querySelectorAll("[data-action='widgetRoll']").forEach(btn => {
      btn.addEventListener("click", async () => {
        let formula = btn.dataset.formulaRaw || btn.dataset.formula || "1d20";
        // JSON action graph -- delegate to ButtonExecutor instead of Roll
          if (formula.trim().startsWith("[")) {
            try {
              const actions = JSON.parse(formula.trim());
              const actorCtx = doc instanceof Actor ? doc : doc.actor ?? null;
              const itemCtx = doc instanceof Actor ? null : doc;
              const fakeBtnDef = { label: btn.dataset.flavor ?? "" };
              const runtime = {};
              for (const action of actions) {
                await ButtonExecutor._runAction(action, itemCtx ?? { system: {}, actor: actorCtx }, actorCtx, fakeBtnDef, runtime);
              }
          } catch(e) { console.error("SD | widgetRoll action error:", e); }
          return;
        }
        try {
          const { FormulaEngine } = await import("../helpers/formula-engine.mjs");
          formula = FormulaEngine.resolveForRoll(formula, doc);
        } catch(e) { console.warn("SD | formula resolve:", e); }
        try {
          const roll = new Roll(formula, doc.getRollData?.() ?? {});
          await roll.evaluate();
          await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor: doc }), flavor: btn.dataset.flavor });
        } catch(e) { console.error("SD | widgetRoll error:", e, "formula:", formula); }
      });
    });
    // widgetNumStep dispatch is now handled by the generic [data-step] loop
    // above (PR7 fix for Devin Review BUG_0001 on PR6 -- double doc.update per
    // click when both selectors matched the same button).
    cell.querySelectorAll("[data-action='widgetToggle']").forEach(btn => {
      btn.addEventListener("click", async () => {
        await doc.update({ [btn.dataset.path]: !_readPath(btn.dataset.path) });
      });
    });

    // Plain action button
    cell.querySelectorAll("[data-action='widgetButton']").forEach(btn => {
      btn.addEventListener("click", async () => {
        const rawFormula = btn.dataset.formulaRaw || btn.dataset.formula;
        if (!rawFormula) {
          // No formula -- just post a plain chat message with the flavor label
          if (btn.dataset.flavor) {
            ChatMessage.create({ content: btn.dataset.flavor, speaker: ChatMessage.getSpeaker({ actor: doc }) });
          }
          return;
        }

        // Detect compiled action graph (array "[" or multi-trigger object "{")
        const trimmed = rawFormula.trim();
        if (trimmed.startsWith("[") || trimmed.startsWith("{\"_trigger\"")) {
          try {
            let actions = null;
            let macros  = null;
            if (trimmed.startsWith("[")) {
              actions = JSON.parse(trimmed);
            } else {
              const payload = JSON.parse(trimmed);
              if (payload?._trigger === "onClick") actions = payload.actions ?? [];
              else if (payload?._trigger === "multi") actions = payload._events?.onClick ?? payload.onClick ?? [];
              macros = payload?._macros ?? null;
            }
            if (!Array.isArray(actions)) return;
            const fakeBtnDef = { label: btn.dataset.flavor ?? "", formula: trimmed, __macros: macros };
            const actorCtx = doc instanceof Actor ? doc : doc.actor ?? null;
            const itemCtx = doc instanceof Actor ? null : doc;
            const runtime = {};
            for (const action of actions) {
              await ButtonExecutor._runAction(action, itemCtx ?? { system: {}, actor: actorCtx }, actorCtx, fakeBtnDef, runtime);
            }
          } catch(e) {
            console.error("SD | widgetButton action graph error:", e);
            ui.notifications.error("Button action failed: " + e.message);
          }
          return;
        }

        // Plain dice formula → roll it
        let formula = rawFormula;
        try {
          const { FormulaEngine } = await import("../helpers/formula-engine.mjs");
          formula = FormulaEngine.resolveForRoll(rawFormula, doc);
        } catch(e) {}
        try {
          const roll = new Roll(formula, doc.getRollData?.() ?? {});
          await roll.evaluate();
          await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor: doc }), flavor: btn.dataset.flavor });
        } catch(e) {
          console.error("SD | widgetButton roll error:", e, "formula:", formula);
          ui.notifications.error(`Roll failed: "${formula}" — ${e.message}`);
        }
      });
    });

    // Slot widget: use button (fires item.use() on slotted item data)
    cell.querySelectorAll("[data-action='slotItemUse']").forEach(btn => {
      btn.addEventListener("click", async () => {
        const slotId = btn.dataset.slotId;
        const idx    = parseInt(btn.dataset.slotIndex ?? "0");
        const { SlotManager } = await import("../data/item-slots.mjs");
        const contents = SlotManager.getContents(doc, slotId);
        const itemData = contents[idx];
        if (!itemData) return;
        const actor = doc instanceof Actor ? doc : doc.actor;
        // 1. Live actor item by stored _id
        let item = actor?.items?.get(itemData._id) ?? null;
        // 2. Live actor item by name
        if (!item) item = actor?.items?.find(i => i.name === itemData.name) ?? null;
        // 3. Live source item via _sourceUuid (stored by SlotManager.addToSlot).
        //    This is the primary path for slotted items that are NOT in actor.items
        //    (e.g. a world item like "gun" dropped into a character slot).
        //    fromUuid() returns the live document with up-to-date slotContents, so
        //    any ammo/clip changes made after the snapshot was taken are visible.
        if (!item && itemData._sourceUuid) {
          try { item = await fromUuid(itemData._sourceUuid); } catch {}
        }
        // 4. Build a temporary Item from the stored snapshot only as last resort.
        //    NOTE: the snapshot may be stale -- it was frozen at addToSlot time.
        let isSnapshot = false;
        if (!item) {
          try {
            const ItemCls = foundry.utils.getDocumentClass("Item");
            item = new ItemCls(itemData, { parent: null });
            isSnapshot = true;
          } catch(e) { console.warn("SD | slotItemUse: could not build temp item:", e); }
        }
        // When item came from _sourceUuid (live world/compendium item) or is a snapshot,
        // intercept update() so mutations are written back to doc's slotContents.
        if (item && (isSnapshot || itemData._sourceUuid)) {
          const _snapSlotId = slotId;
          const _snapIdx    = idx;
          const _origUpdate = item.update.bind(item);
          item.update = async function(changes, _opts = {}) {
            const expanded = foundry.utils.expandObject(changes);
            // Keep in-memory system in sync for the rest of this use() call.
            if (this.system && expanded.system) {
              foundry.utils.mergeObject(this.system, expanded.system,
                { insertKeys: true, insertValues: true, overwrite: true });
            }
            // Write back: take the LIVE current data (fresh from doc), apply changes on
            // top so we never lose mutations made by earlier steps in the same action chain.
            const currentSnap = foundry.utils.deepClone(
              SlotManager.getContents(doc, _snapSlotId)[_snapIdx] ?? {}
            );
            foundry.utils.mergeObject(currentSnap, expanded,
              { insertKeys: true, insertValues: true, overwrite: true });
            const fresh = [...SlotManager.getContents(doc, _snapSlotId)];
            fresh[_snapIdx] = currentSnap;
            await doc.update({
              [`system.slotContents.${_snapSlotId}.contents`]: fresh,
              [`system.slotContents.${_snapSlotId}.count`]:    fresh.length,
            });
            return this;
          };
        }
        if (item) await item.use({});
      });
    });

    // Slot widget: use button
    cell.querySelectorAll("[data-sd-slot-use]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const slotId = btn.dataset.sdSlotUse;
        const idx    = parseInt(btn.dataset.sdSlotIdx ?? "0");
        const { SlotManager } = await import("../data/item-slots.mjs");
        const contents = SlotManager.getContents(doc, slotId);
        const itemData = contents[idx];
        if (!itemData) return;
        const actor = doc instanceof Actor ? doc : doc.actor;
        // 1. Live actor item by stored _id
        let liveItem = actor?.items?.get(itemData._id) ?? null;
        // 2. Live actor item by name
        if (!liveItem) liveItem = actor?.items?.find(i => i.name === itemData.name) ?? null;
        // 3. Live source item via _sourceUuid (stored by SlotManager.addToSlot).
        //    This is the primary path for slotted items not embedded in actor.items.
        //    Returns the live document with up-to-date nested slotContents.
        if (!liveItem && itemData._sourceUuid) {
          try { liveItem = await fromUuid(itemData._sourceUuid); } catch {}
        }
        // 4. Build a temporary Item from the stored snapshot only as last resort.
        let isSnapshot = false;
        if (!liveItem) {
          try {
            const ItemCls = foundry.utils.getDocumentClass("Item");
            liveItem = new ItemCls(itemData, { parent: null });
            isSnapshot = true;
          } catch(e) { console.warn("SD | slot use: could not build temp item:", e); }
        }
        // When item came from _sourceUuid or is a snapshot, intercept update() so
        // mutations are written back to doc's slotContents and not just the world item.
        if (liveItem && (isSnapshot || itemData._sourceUuid)) {
          const _snapSlotId = slotId;
          const _snapIdx    = idx;
          liveItem.update = async function(changes, _opts = {}) {
            const expanded = foundry.utils.expandObject(changes);
            // Keep in-memory system in sync for the rest of this use() call.
            if (this.system && expanded.system) {
              foundry.utils.mergeObject(this.system, expanded.system,
                { insertKeys: true, insertValues: true, overwrite: true });
            }
            // Write back into character slot: base on the current live snapshot from
            // doc (not from this._source) so we don't lose changes made between
            // addToSlot time and now (e.g. ammo manually added after first use).
            const currentSnap = foundry.utils.deepClone(
              SlotManager.getContents(doc, _snapSlotId)[_snapIdx] ?? {}
            );
            foundry.utils.mergeObject(currentSnap, expanded,
              { insertKeys: true, insertValues: true, overwrite: true });
            const fresh = [...SlotManager.getContents(doc, _snapSlotId)];
            fresh[_snapIdx] = currentSnap;
            await doc.update({
              [`system.slotContents.${_snapSlotId}.contents`]: fresh,
              [`system.slotContents.${_snapSlotId}.count`]:    fresh.length,
            });
            return this;
          };
        }
        if (liveItem) await liveItem.use({});
        else ui.notifications.warn(`Could not use item "${itemData.name}" from slot.`);
      });
    });

    // Slot widget: remove button (legacy direct SlotManager call -- only for top-level slots on doc)
    cell.querySelectorAll("[data-sd-slot-remove]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const { SlotManager } = await import("../data/item-slots.mjs");
        CONFIG.debug?.sd && console.log("[SD] sd-slot-remove clicked | doc:", doc?.name??doc?.id, "slotId:", btn.dataset.sdSlotRemove, "idx:", btn.dataset.sdSlotIdx);
        await SlotManager.removeFromSlot(doc, btn.dataset.sdSlotRemove, parseInt(btn.dataset.sdSlotIdx));
      });
    });

    // Shared helper: resolve a live Item from slotted snapshot data
    const _resolveSlottedItem = async (itemId, itemUuid, snapshot, parentDoc) => {
      const actor = parentDoc instanceof Actor ? parentDoc : parentDoc?.actor ?? null;
      CONFIG.debug?.sd && console.log("[SD] _resolveSlottedItem | itemId:", itemId, "itemUuid:", itemUuid, "snapshot:", snapshot?.name, "_sourceUuid:", snapshot?._sourceUuid, "actor:", actor?.id);
      // 1. Live actor-embedded item by stored _id
      let item = itemId ? (actor?.items?.get(itemId) ?? null) : null;
      CONFIG.debug?.sd && console.log("[SD]   step1 by _id:", item?.name ?? "null");
      // 2. Via stored _sourceUuid (most reliable -- set by SlotManager.addToSlot)
      if (!item && itemUuid) {
        try { item = await fromUuid(itemUuid); } catch(e) { console.warn("[SD]   step2 fromUuid error:", e.message); }
        CONFIG.debug?.sd && console.log("[SD]   step2 by itemUuid:", item?.name ?? "null");
      }
      // 3. Snapshot has _sourceUuid field directly
      if (!item && snapshot?._sourceUuid) {
        try { item = await fromUuid(snapshot._sourceUuid); } catch(e) { console.warn("[SD]   step3 fromUuid error:", e.message); }
        CONFIG.debug?.sd && console.log("[SD]   step3 by snapshot._sourceUuid:", item?.name ?? "null");
      }
      // 4. Try as world item by _id
      if (!item && itemId) {
        try { item = await fromUuid("Item." + itemId); } catch(e) { console.warn("[SD]   step4 fromUuid error:", e.message); }
        CONFIG.debug?.sd && console.log("[SD]   step4 by world Item._id:", item?.name ?? "null");
      }
      // 5. Actor-embedded search by name
      if (!item && snapshot?.name) {
        item = actor?.items?.find(i => i.name === snapshot.name) ?? null;
        CONFIG.debug?.sd && console.log("[SD]   step5 by name:", item?.name ?? "null");
      }
      CONFIG.debug?.sd && console.log("[SD] _resolveSlottedItem RESULT:", item?.name ?? "NOT FOUND");
      return item ?? null;
    };

    // Slot widget: edit button (legacy data-sd-slot-edit from _widgetHTML)
    cell.querySelectorAll("[data-sd-slot-edit]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const { SlotManager } = await import("../data/item-slots.mjs");
        const slotId   = btn.dataset.sdSlotEdit;
        const idx      = parseInt(btn.dataset.sdSlotIdx ?? "0");
        const snapshot = SlotManager.getContents(doc, slotId)[idx] ?? null;
        const item = await _resolveSlottedItem(btn.dataset.itemId, btn.dataset.itemUuid, snapshot, doc);
        if (item) item.sheet.render(true);
        else ui.notifications.warn(`Could not open item "${snapshot?.name ?? "?"}" — try re-adding it to the slot.`);
      });
    });

    // Slot widget: edit button -- opens snapshot editor, saves back to slot
    cell.querySelectorAll("[data-action='slotItemEdit']").forEach(btn => {
      btn.addEventListener("click", async () => {
        const { SlotManager } = await import("../data/item-slots.mjs");
        const { SnapshotItem } = await import("../documents/snapshot-item.mjs");
        const slotId   = btn.dataset.slotId;
        const idx      = parseInt(btn.dataset.slotIndex ?? "0");
        const snapshot = SlotManager.getContents(doc, slotId)[idx] ?? null;
        if (!snapshot) { ui.notifications.warn("Slot item not found."); return; }
        await SnapshotItem.openForSnapshot(snapshot, doc, slotId, idx);
      });
    });

    // Draggable items: inventory rows + slot items (sets UUID in drag data for slot drops)
    cell.querySelectorAll("[data-item-drag], [data-slot-item-drag]").forEach(el => {
      el.setAttribute("draggable", "true");
      el.addEventListener("dragstart", ev => {
        const actor = doc instanceof Actor ? doc : doc.actor;
        const itemId = el.dataset.itemId;
        const uuid   = el.dataset.itemUuid
          ?? (itemId ? (actor?.items?.get(itemId)?.uuid ?? doc.items?.get(itemId)?.uuid) : null);
        if (!uuid && !itemId) return;
        const dragData = { type: "Item", uuid, _id: itemId };
        ev.dataTransfer.setData("text/plain", JSON.stringify(dragData));
        ev.dataTransfer.effectAllowed = "move";
      });
    });

    // Spellbook ability rows: make draggable
    cell.querySelectorAll(".sb-ability-row[draggable]").forEach(row => {
      row.addEventListener("dragstart", ev => {
        const actor  = doc instanceof Actor ? doc : doc.actor;
        const itemId = row.dataset.itemId;
        const item   = actor?.items?.get(itemId) ?? doc.items?.get(itemId);
        if (!item) return;
        ev.dataTransfer.setData("text/plain", JSON.stringify({ type: "Item", uuid: item.uuid, _id: item.id }));
        ev.dataTransfer.effectAllowed = "move";
      });
    });

    // Slot widget: drop zone
    cell.querySelectorAll("[data-sd-slot-drop]").forEach(dz => {
      dz.addEventListener("dragover", ev => {
        ev.preventDefault();
        dz.style.background = "rgba(123,104,238,.12)";
        dz.style.color = "#7b68ee";
        dz.style.borderColor = "#7b68ee";
      });
      dz.addEventListener("dragleave", () => {
        dz.style.background = "";
        dz.style.color = "#555";
        dz.style.borderColor = "rgba(123,104,238,.25)";
      });
      dz.addEventListener("drop", async ev => {
        ev.preventDefault();
        dz.style.background = "";
        dz.style.color = "#555";
        dz.style.borderColor = "rgba(123,104,238,.25)";
        try {
          const data = JSON.parse(ev.dataTransfer.getData("text/plain"));
          const item = data.uuid ? await fromUuid(data.uuid) : null;
          if (item) {
            const { SlotManager } = await import("../data/item-slots.mjs");
            const slotId = dz.dataset.sdSlotDrop;

            // Auto-create slot definition on actor if missing
            const defs = doc.system.slotDefinitions ?? [];
            if (!defs.find(d => d.id === slotId)) {
              const allWidgets = (doc.system.customTabs ?? [])
                .flatMap(t => (t.rows ?? []).flatMap(r => r.widgets ?? []));
              const wCfg = allWidgets.find(ww => ww.type === "slot" && ww.slotId === slotId);
              const newDefs = foundry.utils.deepClone(defs);
              newDefs.push({
                id:              slotId,
                label:           wCfg?.label ?? slotId,
                allowedTypes:    [],
                allowedCategories: [],
                attrFilters:     [],
                maxCount:        wCfg?.maxCount ?? 1,
                displayMode:     "compact",
                removable:       true,
                consumeOnRemove: false
              });
              await doc.update({ "system.slotDefinitions": newDefs });
            }

            await SlotManager.addToSlot(doc, slotId, item);
          }
        } catch(err) { console.warn("SD | slot drop:", err); }
      });
    });

    // Inventory widget: item edit/delete/use actions (from WidgetRenderer HTML)
    cell.querySelectorAll("[data-action='itemUse']").forEach(btn => {
      btn.addEventListener("click", async () => {
        const item = doc.items?.get(btn.dataset.itemId);
        if (item) await item.use({});
      });
    });
    cell.querySelectorAll("[data-action='itemEdit']").forEach(btn => {
      btn.addEventListener("click", () => {
        const item = doc.items?.get(btn.dataset.itemId);
        if (item) item.sheet.render(true);
      });
    });
    cell.querySelectorAll("[data-action='itemDelete']").forEach(btn => {
      btn.addEventListener("click", async () => {
        const item = doc.items?.get(btn.dataset.itemId);
        if (!item) return;
        const ok = await foundry.applications.api.DialogV2.confirm({
          window: { title: "Delete Item" },
          content: `<p>Delete <strong>${item.name}</strong>?</p>`
        });
        if (ok) await item.delete();
      });
    });

    // Effects widget: create / toggle / edit / delete
    cell.querySelectorAll("[data-action='effectCreate']").forEach(btn => {
      btn.addEventListener("click", async () => {
        const cls = foundry.utils.getDocumentClass("ActiveEffect");
        cls.createDialog({}, { parent: doc });
      });
    });
    cell.querySelectorAll("[data-action='effectToggle']").forEach(btn => {
      btn.addEventListener("click", async () => {
        const ef = doc.effects?.get(btn.dataset.effectId);
        if (ef) await ef.update({ disabled: !ef.disabled });
      });
    });
    cell.querySelectorAll("[data-action='effectEdit']").forEach(btn => {
      btn.addEventListener("click", () => {
        const ef = doc.effects?.get(btn.dataset.effectId);
        if (ef) ef.sheet.render(true);
      });
    });
    cell.querySelectorAll("[data-action='effectDelete']").forEach(btn => {
      btn.addEventListener("click", async () => {
        const ef = doc.effects?.get(btn.dataset.effectId);
        if (!ef) return;
        const ok = await foundry.applications.api.DialogV2.confirm({
          window: { title: "Delete Effect" },
          content: `<p>Delete <strong>${ef.name}</strong>?</p>`
        });
        if (ok) await ef.delete();
      });
    });

    cell.querySelectorAll("[data-action='abilityCast']").forEach(btn => {
      btn.addEventListener("click", async () => {
        const item = doc.items?.get(btn.dataset.itemId);
        if (!item) return;

        const hf       = item.system?.hiddenFields ?? {};
        const cost     = Number(hf.cost ?? 0) || 0;
        const pathUses = String(hf.pathUses ?? "").trim();

        if (cost > 0 && pathUses) {
          // Resolve ".value" shortcut -- if path points at {value,max} object,
          // use .value; otherwise treat pathUses as the value path directly.
          let valuePath = pathUses;
          const atPath = foundry.utils.getProperty(doc, pathUses);
          if (atPath && typeof atPath === "object" && "value" in atPath) {
            valuePath = pathUses + ".value";
          }
          const cur = Number(foundry.utils.getProperty(doc, valuePath) ?? 0);
          if (cur < cost) {
            ui.notifications.warn(`Not enough resource to use ${item.name} (needs ${cost}, have ${cur} at ${pathUses}).`);
            return;
          }
          await doc.update({ [valuePath]: cur - cost });
        }

        // Use the ability (runs onClick graph, fires chat card, etc.)
        await item.use({});
      });
    });

    // Edit ability
    cell.querySelectorAll("[data-action='abilityEdit']").forEach(btn => {
      btn.addEventListener("click", () => {
        const item = doc.items?.get(btn.dataset.itemId);
        if (item) item.sheet.render(true);
      });
    });

    // Slot pip toggle -- clicking pip at index i sets value = i+1 (fill up to here),
    // or i if that pip was already the last filled (tap last filled pip to reduce by 1).
    // data-value-path overrides the default spellSlots path (used in config-driven mode).
    cell.querySelectorAll("[data-action='slotToggle'], [data-action='slotRestore']").forEach(btn => {
      btn.addEventListener("click", async () => {
        const lvl       = btn.dataset.level;
        const idx       = Number(btn.dataset.slotIdx ?? 0);
        const valuePath = btn.dataset.valuePath || `system.spellSlots.${lvl}.value`;
        const maxAttr   = Number(btn.dataset.max ?? 99);
        const sv        = Number(foundry.utils.getProperty(doc, valuePath) ?? 0);
        const newVal    = (sv === idx + 1) ? idx : Math.min(maxAttr, idx + 1);
        await doc.update({ [valuePath]: newVal });
      });
    });

    // Spell slot max editor (slots mode: inline number input per level)
    cell.querySelectorAll("[data-action='slotSetMax']").forEach(inp => {
      inp.addEventListener("change", async () => {
        const lvl     = inp.dataset.level;
        const newMax  = Math.max(0, Math.min(20, parseInt(inp.value) || 0));
        const slotPath = `system.spellSlots.${lvl}`;
        const slot     = foundry.utils.getProperty(doc, slotPath) ?? {};
        const sv       = Math.min(Number(slot.value ?? 0), newMax);
        await doc.update({ [`${slotPath}.max`]: newMax, [`${slotPath}.value`]: sv });
      });
    });

    // Add a new spell slot level
    cell.querySelectorAll("[data-action='slotAddLevel']").forEach(btn => {
      btn.addEventListener("click", async () => {
        const existing = Object.keys(doc.system?.spellSlots ?? {})
          .map(Number).filter(n => !isNaN(n)).sort((a, b) => a - b);
        // Find first gap starting from 1
        let next = 1;
        while (existing.includes(next)) next++;
        if (next > 20) { ui.notifications.warn("Maximum 20 spell slot levels."); return; }
        await doc.update({ [`system.spellSlots.${next}.value`]: 0, [`system.spellSlots.${next}.max`]: 1 });
      });
    });

    // Remove a spell slot level (uses -= Foundry deletion syntax for ObjectField)
    cell.querySelectorAll("[data-action='slotRemoveLevel']").forEach(btn => {
      btn.addEventListener("click", async () => {
        const lvl = btn.dataset.level;
        await doc.update({ [`system.spellSlots.-=${lvl}`]: null });
      });
    });

    // Mana bar inputs (mana mode) -- save on change
    cell.querySelectorAll(".sb-mana-input").forEach(inp => {
      inp.addEventListener("change", async () => {
        const v = Math.max(0, parseInt(inp.value) || 0);
        await doc.update({ [inp.name]: v });
      });
    });

    // Delete ability from actor (spellbook widget)
    cell.querySelectorAll("[data-action='abilityDelete']").forEach(btn => {
      btn.addEventListener("click", async () => {
        const item = doc.items?.get(btn.dataset.itemId);
        if (!item) return;
        const ok = await foundry.applications.api.DialogV2.confirm({
          window: { title: "Remove Ability" },
          content: `<p>Remove <strong>${item.name}</strong> from this actor?</p>`
        }).catch(() => false);
        if (ok) await item.delete();
      });
    });

    // Spellbook drop zone -- drag ability items from sidebar to add to actor.
    // If the widget has a `type` filter, dropped abilities inherit that type
    // in their hiddenFields so they show up immediately.
    cell.querySelectorAll(".sb-drop-zone").forEach(dz => {
      dz.addEventListener("dragover", ev => {
        ev.preventDefault();
        dz.style.background  = "rgba(123,104,238,.12)";
        dz.style.color       = "#9d8fff";
        dz.style.borderColor = "#7b68ee";
      });
      dz.addEventListener("dragleave", () => {
        dz.style.background  = "";
        dz.style.color       = "#555";
        dz.style.borderColor = "rgba(123,104,238,.25)";
      });
      dz.addEventListener("drop", async ev => {
        ev.preventDefault();
        dz.style.background  = "";
        dz.style.color       = "#555";
        dz.style.borderColor = "rgba(123,104,238,.25)";
        try {
          const data = JSON.parse(ev.dataTransfer.getData("text/plain"));
          const item = data.uuid ? await fromUuid(data.uuid) : null;
          if (!item) return;
          if (item.type !== "ability") {
            ui.notifications.warn(`"${item.name}" is not an ability item.`);
            return;
          }
          if (doc instanceof Actor) {
            const wantType = String(dz.dataset.wantType ?? "").trim();
            const obj = item.toObject();
            obj.system ??= {};
            obj.system.hiddenFields = {
              cost:     "",
              pathUses: "",
              type:     "",
              ...(obj.system.hiddenFields ?? {})
            };
            // If the widget has a type filter, stamp the dropped ability with
            // that type (unless it already has a non-empty, non-matching type
            // -- respect manually set values).
            if (wantType && !String(obj.system.hiddenFields.type ?? "").trim()) {
              obj.system.hiddenFields.type = wantType;
            }
            await doc.createEmbeddedDocuments("Item", [obj]);
            ui.notifications.info(`Added "${item.name}" to ${doc.name}`);
          }
        } catch(err) { console.warn("SD | spellbook drop:", err); }
      });
    });

    // Copy roll formula as macro script
    cell.querySelectorAll("[data-copy-macro]").forEach(btn => {
      btn.addEventListener("click", async ev => {
        ev.stopPropagation();
        const script = btn.dataset.copyMacro;
        if (!script) return;
        try {
          await navigator.clipboard.writeText(script);
          // Brief visual feedback
          const icon = btn.querySelector("i");
          if (icon) {
            icon.className = "fas fa-check";
            icon.style.color = "#5a9e5a";
            setTimeout(() => {
              icon.className = "fas fa-scroll";
              icon.style.color = "";
            }, 1200);
          }
          ui.notifications.info("Macro script copied to clipboard!");
        } catch {
          // Fallback: open a small dialog with the script text for manual copy
          await foundry.applications.api.DialogV2.prompt({
            window: { title: "Macro Script" },
            content: `<p style="font-size:11px;color:#888;margin-bottom:6px">Copy the script below into a new Macro (type: Script):</p>
              <textarea style="width:100%;height:160px;font-family:monospace;font-size:11px;background:#1a1a24;color:#c0c0e0;border:1px solid #3a3a52;border-radius:4px;padding:6px;box-sizing:border-box;resize:vertical"
                readonly onclick="this.select()">${script}</textarea>`,
            ok: { label: "Close" }
          });
        }
      });
    });
    // Copy path buttons
    cell.querySelectorAll(".widget-copy-path").forEach(btn => {
      btn.addEventListener("click", async ev => {
        ev.stopPropagation();
        ev.preventDefault();
        const path = btn.dataset.copyPath;
        if (!path) return;
        try {
          await navigator.clipboard.writeText(path);
          const icon = btn.querySelector("i");
          if (icon) {
            const prev = icon.className;
            icon.className = "fas fa-check";
            btn.style.color = "#5ae07a";
            setTimeout(() => { icon.className = prev; btn.style.color = ""; }, 1200);
          }
        } catch {
          ui.notifications?.info?.(`Path: ${path}`);
        }
      });
    });

    // Helper: read a path value, bypassing DataModel Proxy for hiddenFields
    // (foundry.utils.getProperty does not traverse DataModel proxies reliably)
    const _readPath = (path) => {
      if (!path) return 0;
      if (path.startsWith("system.hiddenFields.")) {
        const key = path.slice("system.hiddenFields.".length);
        return this.document?.system?.hiddenFields?.[key] ?? 0;
      }
      return foundry.utils.getProperty(this.document, path) ?? 0;
    };

    // Clock segments (sd-clock-segment)
    cell.querySelectorAll(".sd-clock-segment").forEach(seg => {
      seg.addEventListener("click", async ev => {
        ev.stopPropagation();
        const path  = seg.dataset.path;
        const index = Number(seg.dataset.index);
        const segs  = Number(seg.dataset.segs ?? 4);
        if (!path) return;
        const cur   = Number(_readPath(path)) || 0;
        // Click filled → unfill (set to index), click unfilled → fill (set to index+1)
        const next  = cur > index ? index : index + 1;
        await this.document.update({ [path]: Math.min(segs, Math.max(0, next)) });
      });
    });

    // Tracker pip clicks are handled by the root-level delegated listener
    // installed in _wireTrackerDelegation() so that partial re-renders of
    // inner cells (inventory rows, slot rows, spellbook rows) don't lose
    // their handlers.

    // Clock reset (sd-clock-reset)
    cell.querySelectorAll(".sd-clock-reset[data-path]").forEach(btn => {
      btn.addEventListener("click", async ev => {
        ev.stopPropagation();
        const path = btn.dataset.path;
        if (!path) return;
        await this.document.update({ [path]: 0 });
      });
    });

    // Tracker reset (sd-tracker-reset)
    cell.querySelectorAll(".sd-tracker-reset[data-path]").forEach(btn => {
      btn.addEventListener("click", async ev => {
        ev.stopPropagation();
        const path = btn.dataset.path;
        if (!path) return;
        await this.document.update({ [path]: 0 });
      });
    });

    // Select widget (widget-select-input)
    cell.querySelectorAll(".widget-select-input[data-path]").forEach(sel => {
      sel.addEventListener("change", async () => {
        const path = sel.dataset.path;
        if (!path) return;
        await this.document.update({ [path]: sel.value });
      });
    });

    // Tags -- add pill
    cell.querySelectorAll(".sd-tag-add[data-path]").forEach(btn => {
      btn.addEventListener("click", async ev => {
        ev.stopPropagation();
        const path = btn.dataset.path;
        if (!path) return;
        const tag = await foundry.applications.api.DialogV2.prompt({
          window:  { title: "Add Tag" },
          content: `<input type="text" name="tag" placeholder="tag name" style="width:100%">`,
          ok:      { callback: (_ev, _btn, dlg) => dlg.element.querySelector("[name=tag]")?.value?.trim() ?? null }
        }).catch(() => null);
        if (!tag) return;
        const cur = String(foundry.utils.getProperty(this.document, path) ?? "");
        const tags = cur.split(",").map(t => t.trim()).filter(Boolean);
        if (!tags.includes(tag)) {
          tags.push(tag);
          await this.document.update({ [path]: tags.join(", ") });
        }
      });
    });

    // Tags -- remove pill
    cell.querySelectorAll(".sd-tag-remove[data-path]").forEach(btn => {
      btn.addEventListener("click", async ev => {
        ev.stopPropagation();
        const path = btn.dataset.path;
        const tag  = btn.dataset.tag;
        if (!path || !tag) return;
        const cur  = String(foundry.utils.getProperty(this.document, path) ?? "");
        const tags = cur.split(",").map(t => t.trim()).filter(t => t && t !== tag);
        await this.document.update({ [path]: tags.join(", ") });
      });
    });

    // Image widget -- click to pick (sd-img-pick)
    cell.querySelectorAll(".sd-img-pick[data-path]").forEach(btn => {
      btn.addEventListener("click", async ev => {
        ev.stopPropagation();
        const path = btn.dataset.path;
        if (!path) return;
        const cur  = String(foundry.utils.getProperty(this.document, path) ?? "");
        const fp   = new FilePicker({
          type:     "image",
          current:  cur,
          callback: src => this.document.update({ [path]: src })
        });
        fp.render(true);
      });
    });

    cell.querySelectorAll(".richtext-display").forEach(display => {
      const widget   = display.closest(".widget-richtext");
      const editWrap = widget?.querySelector(".richtext-edit-wrap");
      const textarea = widget?.querySelector(".richtext-editor");
      const btnSave  = widget?.querySelector(".richtext-save");
      const btnCancel= widget?.querySelector(".richtext-cancel");
      if (!textarea || !editWrap) return;

      const openEdit = () => {
        display.style.display  = "none";
        editWrap.style.display = "block";
        textarea.focus();
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      };

      const closeEdit = (newVal) => {
        const html = newVal
          ? newVal.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\n/g,"<br>")
          : "<span style='opacity:.35;font-style:italic'>Click to edit…</span>";
        display.innerHTML       = html;
        editWrap.style.display  = "none";
        display.style.display   = "block";
      };

      const saveRichtext = async () => {
        const val  = textarea.value;
        const path = textarea.dataset.path;
        if (path) await doc.update({ [path]: val });
        closeEdit(val);
      };

      const cancelRichtext = () => {
        const oldVal = String(foundry.utils.getProperty(doc, textarea.dataset.path) ?? "");
        textarea.value = oldVal;
        closeEdit(oldVal);
      };

      display.addEventListener("click", openEdit);
      btnSave?.addEventListener("click", saveRichtext);
      btnCancel?.addEventListener("click", cancelRichtext);

      textarea.addEventListener("keydown", ev => {
        if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); saveRichtext(); }
        if (ev.key === "Escape") { ev.preventDefault(); cancelRichtext(); }
      });
    });
  }

  _makeDropZone(tab, row, label = "Drop here") {
    const dz = document.createElement("div");
    dz.style.cssText = `
      ${row ? "" : "grid-column:span 3;"}
      border:1px dashed rgba(123,104,238,.2); border-radius:5px;
      padding:8px; text-align:center; font-size:11px; color:#444; cursor:pointer;
      transition:background .15s,color .15s,border-color .15s;
      user-select:none;
    `;
    dz.innerHTML = `<i class="fas fa-arrow-circle-down" style="margin-right:5px;opacity:.5"></i>${label}`;

    dz.addEventListener("dragover", ev => {
      ev.preventDefault();
      dz.style.background   = "rgba(123,104,238,.1)";
      dz.style.color        = "#7b68ee";
      dz.style.borderColor  = "#7b68ee";
    });
    dz.addEventListener("dragleave", () => {
      dz.style.background  = "";
      dz.style.color       = "#444";
      dz.style.borderColor = "rgba(123,104,238,.2)";
    });
    dz.addEventListener("drop", async ev => {
      ev.preventDefault();
      dz.style.background  = "";
      dz.style.color       = "#444";
      dz.style.borderColor = "rgba(123,104,238,.2)";
      try {
        const data = JSON.parse(ev.dataTransfer.getData("text/plain"));
        if (data.sdType === "widget") {
          await this._addWidget(tab.id, row?.id ?? null, data.widgetType);
        }
      } catch(e) { console.warn("SD | drop:", e); }
    });
    return dz;
  }

  // Tab/Row/Widget CRUD

  _switchTab(tabId) {
    this.tabGroups.sheet = tabId;
    const root = this.element;

    // Update nav link styles
    root.querySelectorAll(".sd-tab-btn[data-tab-id]").forEach(a => {
      const active = a.dataset.tabId === tabId;
      a.style.color      = active ? "#7b68ee" : "#666";
      a.style.background = active ? "#1a1a24" : "transparent";
      a.style.borderColor = active ? "#3a3a52 #3a3a52 #1a1a24" : "transparent";
    });

    // Show correct panel
    root.querySelectorAll(".sd-tab-panel").forEach(p => {
      p.style.display = p.dataset.tab === tabId ? "flex" : "none";
    });
  }

  async _addTab(label = "New Tab") {
    const tabs = foundry.utils.deepClone(this.document.system.customTabs ?? []);
    const id   = foundry.utils.randomID(8);
    tabs.push({ id, label, icon: "", rows: [] });
    await this.document.update({ "system.customTabs": tabs });
    // Immediately open the rename dialog so the new tab gets a real name.
    // User can still hit Cancel and keep the "New Tab" default.
    this._renameTab(id);
  }

  async _renameTab(tabId) {
    const tab  = this.document.system.customTabs?.find(t => t.id === tabId);
    const name = await _promptTabName(tab?.label ?? "");
    if (name == null) return;
    const tabs = foundry.utils.deepClone(this.document.system.customTabs ?? []);
    const t    = tabs.find(t => t.id === tabId);
    if (t) { t.label = name; await this.document.update({ "system.customTabs": tabs }); }
  }

  async _deleteTab(tabId) {
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Delete Tab" },
      content: "<p>Delete this tab and all its widgets?</p>"
    }).catch(() => false);
    if (!ok) return;
    const tabs = (this.document.system.customTabs ?? []).filter(t => t.id !== tabId);
    await this.document.update({ "system.customTabs": tabs });
  }

  async _deleteRow(tabId, rowId) {
    const tabs = foundry.utils.deepClone(this.document.system.customTabs ?? []);
    const tab  = tabs.find(t => t.id === tabId);
    if (tab) { tab.rows = (tab.rows ?? []).filter(r => r.id !== rowId); }
    await this.document.update({ "system.customTabs": tabs });
  }

  async _addWidget(tabId, rowId, widgetType) {
    const defaults = {
      text:      { label: "Label",    path: "system.flags.myField" },
      number:    { label: "Number",   path: "system.flags.myNumber" },
      resource:  { label: "Resource", pathValue: "system.resources.hp.value", pathMax: "system.resources.hp.max", color: "#e05a5a" },
      dice:      { label: "Roll",     formula: "1d20" },
      button:    { label: "Action",   icon: "fa-bolt", color: "#7b68ee", formula: "", flavor: "" },
      toggle:    { label: "Toggle",   path: "system.flags.myToggle", onLabel: "On", offLabel: "Off" },
      section:   { label: "Section",  span: 3 },
      richtext:  { label: "Notes",    path: "system.biography.notes", span: 3 },
      attribute: { label: "Attribute", path: "system.attributes.attr1.value" },
      skill:     { label: "Skill",    path: "system.skills.skill1.rank" },
      slot:      { label: "Slot",     slotId: "", maxCount: 1, span: 2 },
      inventory: { label: "Inventory", categories: [], columns: [], showCurrency: true, showWeight: true, span: 3 },
      effects:   { label: "Effects", showDisabled: true, showPassive: true, span: 3 },
      spellbook: { label: "Spellbook", abilityType: "", span: 3 }
    };

    const widget = {
      id:   foundry.utils.randomID(8),
      span: 1,
      ...(defaults[widgetType] ?? { label: widgetType }),
      type: widgetType   // after spread: defaults can't clobber widget.type
    };

    const tabs = foundry.utils.deepClone(this.document.system.customTabs ?? []);
    const tab  = tabs.find(t => t.id === tabId);
    if (!tab) return;

    if (rowId) {
      const row = tab.rows?.find(r => r.id === rowId);
      if (row) { row.widgets ??= []; row.widgets.push(widget); }
    } else {
      tab.rows ??= [];
      tab.rows.push({ id: foundry.utils.randomID(8), widgets: [widget] });
    }

    await this.document.update({ "system.customTabs": tabs });
  }

  async _cycleSpan(tab, row, w) {
    const newSpan = (w.span ?? 1) >= 3 ? 1 : (w.span ?? 1) + 1;
    const tabs    = foundry.utils.deepClone(this.document.system.customTabs ?? []);
    const widget  = tabs.find(t=>t.id===tab.id)?.rows?.find(r=>r.id===row.id)?.widgets?.find(x=>x.id===w.id);
    if (widget) { widget.span = newSpan; await this.document.update({ "system.customTabs": tabs }); }
  }

  async _deleteWidget(tab, row, w) {
    const tabs = foundry.utils.deepClone(this.document.system.customTabs ?? []);
    const r    = tabs.find(t=>t.id===tab.id)?.rows?.find(r=>r.id===row.id);
    if (r) { r.widgets = r.widgets.filter(x => x.id !== w.id); await this.document.update({ "system.customTabs": tabs }); }
  }

  async _configWidget(tab, row, w) {
    const { openWidgetConfigPopup } = await import("../builder/widget-config-popup.mjs");
    // Always read fresh from doc so graphData is not stale after a previous save
    const freshTabs   = this.document.system.customTabs ?? [];
    const freshTab    = freshTabs.find(t => t.id === tab.id) ?? tab;
    const freshRow    = freshTab.rows?.find(r => r.id === row.id) ?? row;
    const freshWidget = freshRow.widgets?.find(x => x.id === w.id) ?? w;
    await openWidgetConfigPopup(freshWidget, freshTab, freshRow, this.document);
  }


  // Wire inventory + slot drop zones via event delegation

  _wireInventoryDropZones() {
    const root = this.element;
    if (!root) return;

    // Use a single delegated drop handler on the panels container
    // This survives tab switches and mode toggles without re-wiring
    const con = root.querySelector(".sd-panels-container") ?? root.querySelector(".window-content");
    if (!con || con._sdDropWired) return;
    con._sdDropWired = true;

    // dragover: highlight the nearest droppable zone
    con.addEventListener("dragover", ev => {
      const zone = ev.target.closest("[data-drop-zone='inventory'], [data-sd-slot-drop], .inventory-drop-zone");
      if (!zone) return;
      ev.preventDefault();
      zone.style.background   = "rgba(123,104,238,.12)";
      zone.style.borderColor  = "#7b68ee";
      zone.style.color        = "#9d8fff";
    });

    con.addEventListener("dragleave", ev => {
      const zone = ev.target.closest("[data-drop-zone='inventory'], [data-sd-slot-drop], .inventory-drop-zone");
      if (!zone) return;
      zone.style.background  = "";
      zone.style.borderColor = "";
      zone.style.color       = "";
    });

    con.addEventListener("drop", async ev => {
      const zone = ev.target.closest("[data-drop-zone='inventory'], [data-sd-slot-drop], .inventory-drop-zone");
      if (!zone) return;
      ev.preventDefault();
      zone.style.background  = "";
      zone.style.borderColor = "";
      zone.style.color       = "";

      let data;
      try { data = JSON.parse(ev.dataTransfer.getData("text/plain")); } catch { return; }

      // Slot drop
      if (zone.dataset.sdSlotDrop !== undefined) {
        const slotId = zone.dataset.sdSlotDrop;
        const item   = data.uuid ? await fromUuid(data.uuid) : null;
        if (item) {
          const { SlotManager } = await import("../data/item-slots.mjs");

          // Auto-create the slot definition on the actor if it doesn't exist yet.
          // The widget config itself holds the label/maxCount so we use it as the definition.
          const defs = this.document.system.slotDefinitions ?? [];
          if (!defs.find(d => d.id === slotId)) {
            const allWidgets = (this.document.system.customTabs ?? [])
              .flatMap(t => (t.rows ?? []).flatMap(r => r.widgets ?? []));
            const wCfg = allWidgets.find(w => w.type === "slot" && w.slotId === slotId);
            const newDefs = foundry.utils.deepClone(defs);
            newDefs.push({
              id:              slotId,
              label:           wCfg?.label ?? slotId,
              allowedTypes:    [],
              allowedCategories: [],
              attrFilters:     [],
              maxCount:        wCfg?.maxCount ?? 1,
              displayMode:     "compact",
              removable:       true,
              consumeOnRemove: false
            });
            await this.document.update({ "system.slotDefinitions": newDefs });
          }

          await SlotManager.addToSlot(this.document, slotId, item);
        }
        return;
      }

      // Inventory drop -- add item to actor
      if (this.document instanceof Actor) {
        let item = null;
        if (data.uuid)    item = await fromUuid(data.uuid);
        else if (data.id) item = game.items?.get(data.id);
        if (item) {
          await this.document.createEmbeddedDocuments("Item", [item.toObject()]);
          ui.notifications.info(`Added "${item.name}" to ${this.document.name}`);
        }
      }
    });
  }

  // Wire header name/img

  _wireHeaderInputs() {
    const root = this.element;
    if (!root || !this.isEditable) return;
    root.querySelector(".actor-name")?.addEventListener("change", async ev => {
      await this.document.update({ name: ev.target.value });
    });
    root.querySelector(".portrait-img")?.addEventListener("click", () => {
      new FilePicker({ type: "image", current: this.document.img, callback: p => this.document.update({ img: p }) }).browse();
    });
  }

  _showEditModeBadge() {
    const root = this.element;
    if (!root) return;
    // Remove existing badge
    root.querySelector(".sd-edit-badge")?.remove();
    if (!this._editMode) return;

    // Find window header to place badge there instead of root
    const windowHeader = root.querySelector(".window-header") ?? root.querySelector("header");
    const badge = document.createElement("div");
    badge.className = "sd-edit-badge";
    badge.style.cssText = "position:absolute;top:4px;right:48px;background:#7b68ee;color:#fff;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;padding:2px 7px;border-radius:10px;z-index:100;pointer-events:none";
    badge.textContent = "EDIT MODE";

    // Only set position relative on a container that won't affect window layout
    if (windowHeader) {
      windowHeader.style.position = "relative";
      windowHeader.appendChild(badge);
    } else {
      // Fallback: use a wrapper inside window-content
      const content = root.querySelector(".window-content");
      if (content) {
        content.style.position = "relative";
        content.prepend(badge);
      }
    }
  }

  // Static actions

  static async _onEditImage(event, target) {
    new FilePicker({ type: "image", current: this.document.img, callback: p => this.document.update({ img: p }) }).browse();
  }

  static async _onOpenRollDialog(event, target) {
    const { SdRollDialog } = await import("../helpers/roll-dialog.mjs");
    await SdRollDialog.prompt({ actor: this.document, title: "Roll Dice", formula: "1d20" });
  }

  static async _onOpenProgression(event, target) {
    const { ProgressionApp } = await import("../helpers/progression-app.mjs");
    ProgressionApp.open(this.document);
  }

  static async _onOpenBuilder(event, target) {
    const { Toolbox } = await import("../builder/toolbox-app.mjs");
    Toolbox.toggle();
  }

  /**
   * Open the sheet-level trigger graph editor.  Events placed here fire for
   * the actor itself (on_update, on_turn_*, on_damage_taken, …) and are
   * persisted on `system.sdTriggerGraph`.  Widget graphs no longer host
   * event nodes -- they live here instead.
   */
  static async _onOpenSheetTriggers(event, target) {
    const { FormulaGraph } = await import("../builder/formula-graph.mjs");
    const graph = new FormulaGraph(null, this.document, null, null, null,
      { mode: "sheetTrigger" });
    graph.open();
  }

  static async _onToggleEditMode(event, target) {
    this._editMode = !this._editMode;
    // Update DOM in-place -- no re-render, no window position reset
    this._buildTabNav();
    this._buildTabPanels();
    this._showEditModeBadge();
  }
}
