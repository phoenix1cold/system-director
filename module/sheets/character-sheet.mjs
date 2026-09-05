import { TabManager } from "../helpers/tabs.mjs";
import { WidgetRenderer } from "../builder/widget-renderer.mjs";
import { GridManager }    from "../builder/grid-manager.mjs";
import { SheetTabReorder } from "../builder/sheet-tab-reorder.mjs";
import { ButtonExecutor } from "../helpers/button-executor.mjs";
import { decodeMacroScript } from "../helpers/widget-macro.mjs";
import { ItemPreviewPopup } from "../helpers/item-preview-popup.mjs";
import { RichTextEditor } from "../helpers/richtext-editor.mjs";
import { emitSheetWidgetEvent as dispatchSheetWidgetEvent } from "../helpers/sheet-widget-events.mjs";
import { deletionUpdate } from "../helpers/foundry-compat.mjs";
import { AutoanimationsIntegration } from "../integrations/autoanimations.mjs";
import { SDOnboarding } from "../helpers/onboarding.mjs";
import { persistWidgetValue } from "../helpers/widget-fields.mjs";
import { assignUniqueWidgetDataPaths, buildWidgetPathRegistryUpdate } from "../builder/widget-paths.mjs";
import { promptWidgetIdentity } from "../builder/widget-identity.mjs";
import { getValueDefinition, getValueDefinitions, readDatabaseValue } from "../helpers/value-database.mjs";
import {
  applySheetStyle, normalizeSheetStyle, sheetStyleFromPreset,
  SHEET_LAYOUTS, SHEET_HEADER_STYLES, SHEET_DENSITIES, SHEET_STYLE_PRESETS
} from "../helpers/sheet-style.mjs";

const { ActorSheetV2 } = foundry.applications.sheets;
const { HandlebarsApplicationMixin } = foundry.applications.api;

function _sdLoc(key, fallback, data = null) {
  try {
    const value = data ? game.i18n?.format?.(key, data) : game.i18n?.localize?.(key);
    if (value && value !== key) return value;
  } catch {}
  return fallback;
}

function _stripInvalidNumbers(obj, schemaField) {
  if (!obj || typeof obj !== "object" || !schemaField?.fields) return;
  for (const [key, sub] of Object.entries(schemaField.fields)) {
    if (!(key in obj)) continue;
    const val = obj[key];
    const cls = sub?.constructor?.name;
    if (cls === "NumberField") {
      const n = Number(val);
      const allowNull = sub.nullable === true;
      const empty = val === "" || val === null || val === undefined;
      if (empty || !Number.isFinite(n)) {
        if (allowNull && val === null) continue;
        delete obj[key];
      }
    } else if (cls === "SchemaField" && val && typeof val === "object") {
      _stripInvalidNumbers(val, sub);
    }
  }
}

const _sheetEsc = value => String(value ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const _safeTabIcon = value => {
  let source = String(value ?? "").trim().replace(/[^a-z0-9 _-]/gi, "");
  if (!source) return "";
  if (!/\bfa(?:s|r|b|l|d)?\b/.test(source)) source = `fas ${source.startsWith("fa-") ? source : `fa-${source}`}`;
  return source;
};
const _safeTabColour = value => {
  const source = String(value ?? "").trim();
  return /^(?:#[0-9a-f]{3,8}|var\(--[a-z0-9_-]+\)|[a-z]+)$/i.test(source) ? source : "";
};

function _promptTabSettings(current = {}) {
  return new Promise(resolve => {
    const tab = current && typeof current === "object" ? current : {label:String(current ?? "")};
    const read = button => {
      const root = button?.closest?.("[data-application]") ?? button?.closest?.("dialog") ?? document;
      const value = name => root.querySelector(`[name="${name}"]`)?.value?.trim() ?? "";
      return {
        label:value("tabName") || "Tab",
        icon:_safeTabIcon(value("tabIcon")),
        emoji:value("tabEmoji").slice(0, 16),
        tooltip:value("tabTooltip"),
        color:_safeTabColour(value("tabColor")),
        showLabel:!!root.querySelector('[name="tabShowLabel"]')?.checked
      };
    };
    new foundry.applications.api.DialogV2({
      modal:true,
      window:{title:"Tab Settings"},
      content:`<div class="sd-tab-settings-grid" style="display:grid;grid-template-columns:130px minmax(0,1fr);gap:8px 10px;align-items:center;padding:8px">
        <label>Name</label><input type="text" name="tabName" value="${_sheetEsc(tab.label ?? "")}" autofocus>
        <label>FA icon</label><input type="text" name="tabIcon" value="${_sheetEsc(tab.icon ?? "")}" placeholder="fas fa-shield-halved">
        <label>Emoji</label><input type="text" name="tabEmoji" value="${_sheetEsc(tab.emoji ?? "")}" placeholder="⚔️">
        <label>Tooltip</label><input type="text" name="tabTooltip" value="${_sheetEsc(tab.tooltip ?? "")}" placeholder="Displayed on hover">
        <label>Accent colour</label><input type="text" name="tabColor" value="${_sheetEsc(tab.color ?? "")}" placeholder="#8a6cff">
        <label>Show name</label><input type="checkbox" name="tabShowLabel" ${tab.showLabel === false ? "" : "checked"}>
      </div>`,
      buttons:[
        {action:"save",label:"Save",icon:"fas fa-floppy-disk",default:true,callback:(ev,button)=>resolve(read(button))},
        {action:"cancel",label:"Cancel",icon:"fas fa-xmark",callback:()=>resolve(null)}
      ],
      submit:()=>{}
    }).render(true);
  });
}

async function _chooseNumberWidgetMode() {
  const mode = await foundry.applications.api.DialogV2.wait({
    modal: true,
    window: { title: "Number Widget" },
    content: `<div style="padding:8px 0;font-size:12px;color:var(--sd-w-label, var(--sd-text-3));line-height:1.4">Choose Number widget version.</div>`,
    buttons: [
      { action: "classic", label: "Classic", icon: "fas fa-keyboard", default: true },
      { action: "node",    label: "Node",    icon: "fas fa-diagram-project" }
    ],
    rejectClose: false
  }).catch(() => "classic");
  return mode === "node" ? "node" : "classic";
}

function _applyNumberWidgetMode(widget, mode) {
  if (!widget || widget.type !== "number") return;
  if (mode === "node") {
    widget.numberMode  = "node";
    widget.minFormula  = "";
    widget.maxFormula  = "";
    widget.stepFormula = "1";
    delete widget.min;
    delete widget.max;
    delete widget.step;
  } else {
    widget.numberMode = "classic";
    widget.min = "";
    widget.max = "";
    widget.step = 1;
    delete widget.minFormula;
    delete widget.maxFormula;
    delete widget.stepFormula;
    delete widget.numberGraph;
  }
}

export class CharacterSheet extends HandlebarsApplicationMixin(ActorSheetV2) {

  static DEFAULT_OPTIONS = {
    classes:  ["sd", "sheet", "actor", "character"],
    position: { width: 780, height: 620 },
    window: {
      resizable: true,
      controls: [
        { icon: "fas fa-toolbox",     label: "Sheet Builder",    action: "openBuilder"      },
        { icon: "fas fa-palette",     label: "Sheet Appearance", action: "openSheetAppearance" },
        { icon: "fas fa-database",    label: "Database",         action: "openDatabase"     },
        { icon: "fas fa-hand-sparkles", label: "Interactions",   action: "openInteractions" },
        { icon: "fas fa-pen-ruler",   label: "Toggle Edit Mode", action: "toggleEditMode"   }
      ]
    },
    actions: {
      editImage:         CharacterSheet._onEditImage,
      openRollDialog:    CharacterSheet._onOpenRollDialog,
      openProgression:   CharacterSheet._onOpenProgression,
      openBuilder:       CharacterSheet._onOpenBuilder,
      openSheetAppearance: CharacterSheet._onOpenSheetAppearance,
      openSheetTriggers: CharacterSheet._onOpenSheetTriggers,
      openDatabase:      CharacterSheet._onOpenDatabase,
      openInteractions:  CharacterSheet._onOpenInteractions,
      openAIBio:         CharacterSheet._onOpenAIBio,
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

  _processFormData(event, form, formData) {
    try {
      const raw = formData?.object ? JSON.parse(JSON.stringify(formData.object)) : null;
      console.debug("SD | _processFormData raw object →", raw);
    } catch {}
    const data = super._processFormData(event, form, formData);
    const schema = this.document.system?.schema ?? this.document.system?.constructor?.schema;
    if (schema && data && typeof data === "object" && data.system) {
      _stripInvalidNumbers(data.system, schema);
    }
    try { console.debug("SD | _processFormData expanded+cleaned →", JSON.parse(JSON.stringify(data))); } catch {}
    return data;
  }

  async _prepareContext(options) {
    const base   = await super._prepareContext(options);
    const actor  = this.document;
    const system = actor.system;
    const progCfg=actor.getFlag?.("sd","progression.config")??{};
    const progTabs=Array.isArray(progCfg.tabs)?progCfg.tabs:[];
    const progTab=progTabs.find(t=>t.id===progCfg.activeTabId)??progTabs[0]??progCfg;
    const levelId=getValueDefinition(progTab?.levelVariableId)?.id??getValueDefinition("level")?.id??getValueDefinitions("actor").find(v=>String(v.name).toLowerCase()==="level")?.id??"";
    const progressionLevel=levelId?readDatabaseValue(actor,levelId):"";

    return {
      ...base,
      actor,
      system,
      isEditable: this.isEditable,
      editMode:   this._editMode,
      customTabs: system.customTabs ?? [],
      sheetStyle: normalizeSheetStyle(system.sheetStyle ?? {}),
      values: system.values ?? {},
      progressionLevel
    };
  }

  _onRender(context, options) {
    this._captureScrollMemory();
    this._applySheetAppearance();
    this._buildTabNav();
    this._buildTabPanels();
    this._wireHeaderInputs();
    this._showEditModeBadge();
    this._wireInventoryDropZones();
    this._wireTrackerDelegation();
    this._wireAnimationTagDelegation();
    ItemPreviewPopup.attach(this.element, this.document);
    TabManager.activate(this);
    SDOnboarding.bindCharacterSheet(this.element);
    this._wireScrollMemory();
    this._restoreScrollMemory();
    queueMicrotask(() => this._maybeChooseInitialLayout());
  }

  _applySheetAppearance() {
    return applySheetStyle(this.element, this.document.system?.sheetStyle ?? {});
  }

  _wireAnimationTagDelegation() {
    const root = this.element;
    if (!root || root.dataset.sdAaDelegated === "1") return;
    root.dataset.sdAaDelegated = "1";
    root.addEventListener("click", (ev) => {
      if (this._editMode) return;
      const widgetEl = ev.target.closest(".widget[data-aa-tag]");
      if (!widgetEl || !root.contains(widgetEl)) return;
      const actionEl = ev.target.closest(
        "[data-action], [data-roll], [data-step], [data-toggle], [data-attr-roll], [data-attr-onclick]"
      );
      if (!actionEl || !widgetEl.contains(actionEl)) return;
      const da = actionEl.dataset?.action ?? "";
      if (da === "wcfg" || da === "wdup" || da === "wspan" || da === "wdel") return;
      const tag = widgetEl.dataset.aaTag;
      if (!tag) return;
      try { AutoanimationsIntegration.playForTag(tag, this.document); } catch (e) {
        console.warn("SD | AutoAnimations widget tag trigger failed:", e);
      }
    }, true);
  }

  _onChangeForm(formConfig, event) {
    const t = event?.target;

    if (t?.closest?.(".richtext-editor, .richtext-edit-wrap, .sd-wcfg-popup, prose-mirror, .sd-richtext-pm-target, .sd-richtext-editor, .editor.prosemirror, .ProseMirror, .prosemirror-menu")) return;
    if (t?.tagName?.toLowerCase?.() === "prose-mirror") return;
    return super._onChangeForm(formConfig, event);
  }

  _scrollKey(panel) {
    return panel?.dataset?.tab ?? panel?.dataset?.tabId ?? this.tabGroups.sheet ?? "__default";
  }

  _captureScrollMemory() {
    const root = this.element;
    if (!root) return;
    this._sdScrollMemory ??= {};
    root.querySelectorAll(".sd-tab-panel").forEach(panel => {
      const key = this._scrollKey(panel);
      if (key) this._sdScrollMemory[key] = panel.scrollTop || 0;
    });
  }

  _wireScrollMemory() {
    const root = this.element;
    if (!root) return;
    this._sdScrollMemory ??= {};
    root.querySelectorAll(".sd-tab-panel").forEach(panel => {
      if (panel.dataset.sdScrollMemory === "1") return;
      panel.dataset.sdScrollMemory = "1";
      panel.addEventListener("scroll", () => {
        const key = this._scrollKey(panel);
        if (key) this._sdScrollMemory[key] = panel.scrollTop || 0;
      }, { passive: true });
    });
  }

  _restoreScrollMemory() {
    const root = this.element;
    const memory = this._sdScrollMemory;
    if (!root || !memory) return;
    const apply = () => {
      root.querySelectorAll(".sd-tab-panel").forEach(panel => {
        const key = this._scrollKey(panel);
        const y = Number(memory[key] ?? 0);
        if (!Number.isFinite(y) || y <= 0) return;
        panel.scrollTop = Math.min(y, Math.max(0, panel.scrollHeight - panel.clientHeight));
      });
    };
    requestAnimationFrame(apply);
    window.setTimeout(apply, 50);
  }

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
        return;
      }
      const skillPip = ev.target.closest(".skill-pip[data-path][data-rank]");
      if (skillPip) {
        ev.stopPropagation();
        const path = skillPip.dataset.path;
        const r    = Number(skillPip.dataset.rank) || 0;
        const cur  = Number(_readPath(path)) || 0;
        const next = cur === r ? r - 1 : r;
        await this.document.update({ [path]: Math.max(0, next) });
      }
    });

    root.addEventListener("contextmenu", async ev => {
      const pipRow = ev.target.closest(".skill-pip-row[data-path]");
      if (pipRow) {
        ev.preventDefault();
        ev.stopPropagation();
        await this.document.update({ [pipRow.dataset.path]: 0 });
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
      nav.style.cssText = "display:flex;flex-wrap:wrap;gap:2px;padding:5px 12px 0;background:var(--sd-w-bg,var(--sd-bg-2));border-bottom:1px solid var(--sd-w-bd,var(--sd-border));flex-shrink:0;";
      root.querySelector(".window-content")?.appendChild(nav);
    }

    nav.innerHTML = "";

    const tabs      = this.document.system.customTabs ?? [];
    const activeTab = this.tabGroups.sheet || tabs[0]?.id || "";

    tabs.forEach(tab => {
      const isActive = tab.id === activeTab;
      const a = document.createElement("a");
      a.className       = `sd-tab-btn${isActive ? " is-active active" : ""}`;
      a.dataset.tabId   = tab.id;
      a.dataset.showLabel = tab.showLabel === false ? "0" : "";
      a.title = String(tab.tooltip || tab.label || "Tab");
      const tabColour = _safeTabColour(tab.color);
      if (tabColour) a.style.setProperty("--sd-tab-color", tabColour);
      a.style.cssText += `
        padding:5px 11px; font-size:11px; font-weight:700; text-transform:uppercase;
        letter-spacing:.04em; cursor:pointer; border-radius:4px 4px 0 0;
        border:1px solid transparent; border-bottom:none;
        color:var(--sd-text-3); background:transparent;
        display:inline-flex; align-items:center; gap:4px; white-space:nowrap; user-select:none;
      `;
      const tabIcon = _safeTabIcon(tab.icon);
      const iconHtml = tabIcon ? `<i class="sd-tab-icon ${_sheetEsc(tabIcon)}"></i>` : "";
      const emojiHtml = tab.emoji ? `<span class="sd-tab-emoji">${_sheetEsc(tab.emoji)}</span>` : "";
      a.innerHTML = `${iconHtml}${emojiHtml}<span class="sd-tab-label">${_sheetEsc(tab.label || "Tab")}</span>
        ${this._editMode
          ? `<span data-rename="${_sheetEsc(tab.id)}" style="opacity:.5;font-size:9px;cursor:pointer" title="Tab settings"><i class="fas fa-gear"></i></span>
             <span data-deltab="${_sheetEsc(tab.id)}" style="opacity:.5;font-size:9px;cursor:pointer" title="Delete">✕</span>`
          : ""}`;

      a.addEventListener("click", ev => {
        if (ev.target.dataset.rename) { ev.stopPropagation(); this._renameTab(tab.id); return; }
        if (ev.target.dataset.deltab) { ev.stopPropagation(); this._deleteTab(tab.id); return; }
        this._switchTab(tab.id);
      });

      a.addEventListener("dragover", ev => {
        ev.preventDefault();
        if (this.tabGroups.sheet === tab.id) return;
        if (a._sdDragHoverT) return;
        a._sdDragHoverT = setTimeout(() => { a._sdDragHoverT = null; this._switchTab(tab.id); }, 200);
      });
      a.addEventListener("dragleave", () => {
        if (a._sdDragHoverT) { clearTimeout(a._sdDragHoverT); a._sdDragHoverT = null; }
      });
      a.addEventListener("drop", async ev => {
        if (a._sdDragHoverT) { clearTimeout(a._sdDragHoverT); a._sdDragHoverT = null; }
        let data = null;
        try { data = JSON.parse(ev.dataTransfer.getData("text/plain")); } catch {}
        if (data && (data.sdType === "widget-move" || data.sdType === "moveWidget")) {
          ev.preventDefault();
          ev.stopPropagation();
          this._switchTab(tab.id);
          if (!data.srcDocUuid || data.srcDocUuid === this.document?.uuid) {
            await this._moveWidget(data, { tabId: tab.id, rowId: null, parentVsId: null, toEnd: true });
          }
        }
      });

      SheetTabReorder.attach(this, a, tab.id);

      nav.appendChild(a);
    });

    if (this._editMode) {
      const plus = document.createElement("a");
      plus.className    = "sd-tab-btn sd-add-tab";
      plus.title        = "Click to add tab, or drop 'New Tab' here";
      plus.innerHTML    = '<i class="fas fa-plus"></i>';
      plus.style.cssText = "padding:5px 10px;font-size:11px;cursor:pointer;border-radius:4px 4px 0 0;border:1px dashed var(--sd-accent);border-bottom:none;color:var(--sd-accent);opacity:.6;display:inline-flex;align-items:center;transition:opacity .15s,background .15s;";
      plus.addEventListener("click",     () => this._addTab());
      plus.addEventListener("dragover",  ev => { ev.preventDefault(); plus.style.opacity="1"; plus.style.background="var(--sd-accent-glow)"; });
      plus.addEventListener("dragleave", () => { plus.style.opacity=".6"; plus.style.background=""; });
      plus.addEventListener("drop",      ev => {
        ev.preventDefault(); plus.style.opacity=".6"; plus.style.background="";
        try { const d=JSON.parse(ev.dataTransfer.getData("text/plain")); if(d.sdType==="newTab") this._addTab(); } catch { this._addTab(); }
      });
      nav.appendChild(plus);
    }

    const spacer = document.createElement("div");
    spacer.style.cssText = "flex:1";
    nav.appendChild(spacer);

    const tplBtn = document.createElement("a");
    tplBtn.style.cssText = "padding:4px 9px;font-size:10px;cursor:pointer;border-radius:4px 4px 0 0;border:1px solid var(--sd-w-bd,var(--sd-border));border-bottom:none;color:var(--sd-w-label, var(--sd-text-3));background:transparent;display:inline-flex;align-items:center;gap:4px;white-space:nowrap;";
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

    let container = root.querySelector(".sd-panels-container");
    if (!container) {
      container = document.createElement("div");
      container.className = "sd-panels-container";
      container.style.cssText = "flex:1;display:flex;flex-direction:column;min-height:0;overflow:hidden;position:relative;";
      root.querySelector(".window-content")?.appendChild(container);
    }

    this._captureScrollMemory();
    container.innerHTML = "";

    const tabs = this.document.system.customTabs ?? [];

    const validIds = tabs.map(t => t.id);
    if (!this.tabGroups.sheet || !validIds.includes(this.tabGroups.sheet)) {
      this.tabGroups.sheet = tabs[0]?.id ?? "";
    }

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

    if (tabs.length === 0) {
      const empty = document.createElement("div");
      empty.style.cssText = "flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;color:var(--sd-text-3);";
      empty.innerHTML = `
        <i class="fas fa-toolbox" style="font-size:40px;opacity:.3"></i>
        <p style="font-size:13px;text-align:center;max-width:260px;line-height:1.6;margin:0">
          Click <strong style="color:var(--sd-accent)">Builder</strong> in the title bar,<br>
          then drag <strong>New Tab</strong> onto the <strong style="color:var(--sd-accent)">+</strong>
        </p>
      `;
      container.appendChild(empty);
    }
  }

  async _saveAsTemplate() {
    const result = await foundry.applications.api.DialogV2.wait({
      window: { title: "Save as Template" },
      content: `<div style="padding:8px 0">
        <label style="font-size:12px;color:var(--sd-w-label, var(--sd-text-3))">Template name:</label>
        <input type="text" name="tplName" value="${this.document.name} Template"
          style="width:100%;margin-top:4px;background:var(--sd-w-bg,var(--sd-bg-3));border:1px solid var(--sd-w-bd,var(--sd-border));color:var(--sd-w-fg,var(--sd-text));border-radius:4px;padding:4px 8px;font-size:13px;box-sizing:border-box">
      </div>`,
      buttons: [
        {
          action: "save",
          label: "Save",
          icon: "fas fa-floppy-disk",
          default: true,
          callback: (event, button, dialog) => {
            const v = dialog.element.querySelector("input[name='tplName']")?.value?.trim();
            return { __sdOk: true, __sdValue: v && v.length ? v : null };
          }
        },
        {
          action: "cancel", label: "Cancel",
          callback: () => ({ __sdOk: false, __sdValue: null })
        }
      ],
      rejectClose: false
    }).catch(() => ({ __sdOk: false, __sdValue: null }));
    if (!result || typeof result !== "object" || !result.__sdOk) return;
    const name = (typeof result.__sdValue === "string" && result.__sdValue.length) ? result.__sdValue : null;
    if (!name) return;

    const doc = this.document;
    const sys = doc.system ?? {};

    const stored = foundry.utils.deepClone(game.settings.get("sd", "sheetTemplates") ?? {});
    stored[name] = {
      name,
      docType:         "Actor",
      itemType:        doc.type ?? "character",
      customTabs:      foundry.utils.deepClone(sys.customTabs      ?? []),
      sheetStyle:      foundry.utils.deepClone(sys.sheetStyle      ?? {}),
      hiddenFields:    foundry.utils.deepClone(sys.hiddenFields     ?? {}),
      declaredAttrs:   foundry.utils.deepClone(sys.declaredAttrs    ?? []),
      slotDefinitions: foundry.utils.deepClone(sys.slotDefinitions  ?? []),
      sdTriggerGraph:  foundry.utils.deepClone(sys.sdTriggerGraph   ?? {}),
      created: Date.now()
    };
    await game.settings.set("sd", "sheetTemplates", stored);

    try {
      const tb = Object.values(foundry.applications.instances ?? {})
        .find(a => a.constructor?.name === "Toolbox");
      tb?.render?.();
    } catch {}

    ui.notifications.info(`Template "${name}" saved — use "Create" in Sheet Builder → Templates.`);
  }

  _buildRow(tab, row) {
    const cols = Math.max(1, Math.min(9, Number(row.cols) || 3));
    const rowEl = document.createElement("div");
    rowEl.dataset.rowId  = row.id;
    rowEl.dataset.tabId  = tab.id;
    rowEl.dataset.cols   = cols;
    rowEl.style.cssText  = `
      display:grid; grid-template-columns:repeat(${cols},1fr); gap:8px;
      align-items:start; position:relative;
      padding:8px 8px 8px 8px;
      border:1px dashed var(--sd-accent-glow); border-radius:6px;
    `;

    if (this._editMode) {
      const cfg = document.createElement("button");
      cfg.type = "button";
      cfg.innerHTML = `<i class="fas fa-cog"></i> ${cols}`;
      cfg.title = "Row columns (1-9)";
      cfg.style.cssText = `
        position:absolute; top:-9px; right:32px; z-index:10;
        background:var(--sd-bg); border:1px solid var(--sd-w-bd,var(--sd-border)); border-radius:3px;
        color:var(--sd-accent); cursor:pointer; font-size:10px; padding:0 6px; line-height:17px;
      `;
      cfg.addEventListener("click", () => this._configRow(tab.id, row.id));
      rowEl.appendChild(cfg);

      const del = document.createElement("button");
      del.type = "button";
      del.innerHTML = "✕";
      del.title = "Delete row";
      del.style.cssText = `
        position:absolute; top:-9px; right:4px; z-index:10;
        background:var(--sd-bg); border:1px solid var(--sd-w-bd,var(--sd-border)); border-radius:3px;
        color:var(--sd-text-3); cursor:pointer; font-size:10px; padding:0 5px; line-height:17px;
      `;
      del.addEventListener("click", () => this._deleteRow(tab.id, row.id));
      rowEl.appendChild(del);
    }

    (row.widgets ?? []).forEach((w, idx) => {
      rowEl.appendChild(this._buildWidget(tab, row, w, idx));
    });

    if (this._editMode) {
      rowEl.appendChild(this._makeDropZone(tab, row, "Drop widget here"));
    }

    return rowEl;
  }

  _buildWidget(tab, row, w, idx = 0, parentVS = null) {
    const rowCols = Math.max(1, Math.min(9, Number(row.cols) || 3));
    const rawSpan = Math.max(1, Math.min(parentVS ? 1 : rowCols, Number(w.span) || 1));
    const span = rawSpan;
    const cell = document.createElement("div");
    cell.dataset.widgetId = w.id;
    cell.dataset.rowId    = row.id;
    cell.dataset.tabId    = tab.id;
    if (parentVS) {
      cell.dataset.parentVsId = parentVS.id;
      cell.classList.add("sd-vsection-child");
    }
    cell.dataset.widgetIdx = idx;
    cell.style.cssText = `grid-column:${parentVS ? "1 / -1" : `span ${span}`}; position:relative; min-width:0;${parentVS ? "width:100%;max-width:100%;box-sizing:border-box;" : ""}`;

    if (w.type === "vsection") {
      cell.innerHTML = "";
      cell.appendChild(this._buildVSection(tab, row, w));
      if (this._editMode) {
        this._makeWidgetDraggable(cell, tab, row, w, parentVS);
        this._attachWidgetOverlay(cell, tab, row, w, span, parentVS);
      }
      return cell;
    }

    const html = this._widgetHTML(w);
    if (!html?.trim() && !this._editMode) {
      cell.style.display = "none";
      return cell;
    }
    cell.innerHTML = html || "";
    this._wireWidget(cell, w);

    if (this._editMode) {
      this._makeWidgetDraggable(cell, tab, row, w, parentVS);
      this._attachWidgetOverlay(cell, tab, row, w, span, parentVS);
    }

    return cell;
  }

  _buildVSection(tab, row, vs) {
    const box = document.createElement("div");
    box.className = "sd-vsection-runtime";
    box.dataset.vsId = vs.id;
    box.style.cssText = `
      display:flex; flex-direction:column; align-items:stretch; gap:6px;
      width:100%; max-width:100%; min-width:0; box-sizing:border-box;
      padding:6px; border:1px dashed var(--sd-accent-glow); border-radius:5px;
      background:rgba(123,104,238,.03); min-height:40px;
    `;
    if (vs.label) {
      const h = document.createElement("div");
      h.textContent = vs.label;
      h.style.cssText = "font-size:10px;font-weight:700;color:var(--sd-accent);text-transform:uppercase;letter-spacing:.05em;padding:2px 0 4px";
      box.appendChild(h);
    }
    (vs.widgets ?? []).forEach((cw, idx) => {
      box.appendChild(this._buildWidget(tab, row, cw, idx, vs));
    });
    if (this._editMode) {
      box.appendChild(this._makeDropZone(tab, row, "Drop widget into section", vs));
    }
    return box;
  }

  _makeWidgetDraggable(cell, tab, row, w, parentVS) {
    cell.draggable = true;
    cell.addEventListener("dragstart", ev => {
      ev.stopPropagation();
      try {

        const snapshot = foundry.utils.deepClone(w);
        ev.dataTransfer.setData("text/plain", JSON.stringify({
          sdType:         "widget-move",
          sdTypeAlt:      "moveWidget",
          tabId:          tab.id,
          rowId:          row.id,
          fromRowId:      row.id,
          widgetId:       w.id,
          parentVsId:     parentVS?.id ?? null,
          srcDocUuid:     this.document?.uuid ?? null,
          widget:         snapshot,
          widgetSnapshot: snapshot
        }));
        ev.dataTransfer.effectAllowed = "copyMove";
      } catch {}
      cell.style.opacity = "0.4";
    });
    cell.addEventListener("dragend", () => { cell.style.opacity = ""; });
  }

  _attachWidgetOverlay(cell, tab, row, w, span, parentVS) {
    const ov = document.createElement("div");
    const richTextControls = w?.type === "richtext";
    ov.className = `sd-widget-ov${richTextControls ? " sd-widget-ov--richtext" : ""}`;
    if (richTextControls) cell.classList.add("sd-richtext-edit-cell");
    ov.style.cssText = richTextControls ? `
      display:flex; position:relative; inset:auto; z-index:20; width:100%;
      flex-direction:row; align-items:center; justify-content:space-between; gap:6px;
      margin:0 0 4px 0; pointer-events:none; box-sizing:border-box;
    ` : `
      display:none; position:absolute; top:2px; left:2px; right:2px; z-index:20;
      flex-direction:row; align-items:center; justify-content:space-between; gap:6px;
      pointer-events:none;
    `;
    const spanBtn = parentVS
      ? ""
      : `<button type="button" title="Width (${span})" data-action="wspan"
          style="pointer-events:auto;background:var(--sd-bg);border:1px solid var(--sd-w-bd,var(--sd-border));border-radius:3px;color:var(--sd-w-label, var(--sd-text-3));cursor:pointer;font-size:10px;padding:0 5px;line-height:18px">↔${span}</button>`;
    ov.innerHTML = `
      <div style="display:flex;flex-direction:row;gap:2px;align-items:center">
        <span title="Drag to move" style="pointer-events:auto;cursor:grab;background:var(--sd-bg);border:1px solid var(--sd-w-bd,var(--sd-border));border-radius:3px;color:var(--sd-w-label, var(--sd-text-3));font-size:10px;padding:0 5px;line-height:18px">⋮⋮</span>
        <button type="button" title="Configure" data-action="wcfg"
          style="pointer-events:auto;background:var(--sd-bg);border:1px solid var(--sd-accent);border-radius:3px;color:var(--sd-accent);cursor:pointer;font-size:10px;padding:0 5px;line-height:18px">⚙</button>
        <button type="button" title="Duplicate" data-action="wdup"
          style="pointer-events:auto;background:var(--sd-bg);border:1px solid #6a9a55;border-radius:3px;color:#9bd07f;cursor:pointer;font-size:10px;padding:0 5px;line-height:18px"><i class="fas fa-clone"></i></button>
        ${spanBtn}
      </div>
      <div style="display:flex;flex-direction:row;gap:2px;align-items:center">
        <button type="button" title="Remove" data-action="wdel"
          style="pointer-events:auto;background:var(--sd-bg);border:1px solid var(--sd-hp);border-radius:3px;color:var(--sd-hp);cursor:pointer;font-size:10px;padding:0 5px;line-height:18px">✕</button>
      </div>
    `;
    ov.querySelector('[data-action="wcfg"]').addEventListener("click",  ev => { ev.stopPropagation(); this._configWidget(tab, row, w, parentVS); });
    ov.querySelector('[data-action="wdup"]').addEventListener("click",  ev => { ev.stopPropagation(); this._duplicateWidget(tab, row, w, parentVS); });
    ov.querySelector('[data-action="wspan"]')?.addEventListener("click", ev => { ev.stopPropagation(); this._cycleSpan(tab, row, w); });
    ov.querySelector('[data-action="wdel"]').addEventListener("click",  ev => { ev.stopPropagation(); this._deleteWidget(tab, row, w, parentVS); });

    if (richTextControls) {
      // Keep edit controls in normal flow above the editor. They remain
      // available without covering Foundry's toolbar or document text.
      cell.insertBefore(ov, cell.firstChild);
    } else {
      cell.addEventListener("mouseenter", () => ov.style.display = "flex");
      cell.addEventListener("mouseleave", () => ov.style.display = "none");
      cell.appendChild(ov);
    }
  }

  _widgetHTML(w) {

    return WidgetRenderer.render(w, this.document, this._editMode) ?? "";
  }

  _wireWidget(cell, w) {
    const doc = this.document;

    const _readPath = (path) => {
      if (!path) return 0;
      if (path.startsWith("system.hiddenFields.")) {
        const key = path.slice("system.hiddenFields.".length);
        return this.document?.system?.hiddenFields?.[key] ?? 0;
      }
      return foundry.utils.getProperty(this.document, path) ?? 0;
    };

    const _fieldForPath = (path) => {
      if (!path) return null;
      return [...cell.querySelectorAll("input, select, textarea")]
        .find(el => (el.dataset.path || el.getAttribute("name")) === path) ?? null;
    };

    const _numberForPath = (path) => {
      const field = _fieldForPath(path);
      const fromField = field ? Number(field.value) : NaN;
      if (Number.isFinite(fromField)) return fromField;
      const fromDoc = Number(_readPath(path));
      return Number.isFinite(fromDoc) ? fromDoc : 0;
    };

    // Ordinary Actor/Item sheet events use the single common Sheet Blueprint.
    // They are intentionally separate from UI Blueprint events.
    const emitSheetWidgetEvent=(eventName,sourceEvent=null,detail={})=>{
      if(this._editMode)return;
      const target=sourceEvent?.target??null;
      let value;
      if(Object.prototype.hasOwnProperty.call(detail,"value"))value=detail.value;
      else if(target?.type==="checkbox")value=!!target.checked;
      else if(target&&"value" in target)value=target.value;
      else {
        const variableId=String(w.variableId??w.path??w.pathValue??"").trim();
        try{value=variableId?foundry.utils.getProperty(doc,variableId.startsWith("system.")?variableId:`system.values.${variableId}`):w.value??"";}
        catch{value=w.value??"";}
      }
      const actor=doc instanceof Actor?doc:doc?.actor??null;
      // Runs this document's own Sheet Blueprint immediately and notifies every
      // other listener through the sdSheetWidgetEvent hook.
      return dispatchSheetWidgetEvent(doc,{
        event:String(eventName||"click").toLowerCase(),
        value,
        widgetKey:String(w.widgetKey||w.id||""),
        widgetId:String(w.id||""),
        widgetLabel:String(w.label||""),
        widgetType:String(w.type||""),
        elementKey:String(detail.elementKey??target?.closest?.("[data-element-key]")?.dataset?.elementKey??""),
        actorId:String(actor?.id||""),
        documentUuid:String(doc?.uuid||""),
        sourceUuid:String(doc?.uuid||"")
      });
    };
    cell._sdEmitWidgetEvent=emitSheetWidgetEvent;
    // Capture phase: inner controls (steppers, select pills, rich text, widget
    // builder elements) call stopPropagation, which used to swallow ordinary
    // widget events before the Sheet Blueprint ever saw them.
    cell.addEventListener("click",event=>{
      if(event.target?.closest?.("[data-action='wbElement']"))return;
      emitSheetWidgetEvent("click",event);
      if(String(w.type)==="toggle")emitSheetWidgetEvent("toggle",event);
    },true);
    cell.addEventListener("input",event=>emitSheetWidgetEvent("input",event),true);
    cell.addEventListener("change",event=>emitSheetWidgetEvent("change",event),true);

    cell.querySelectorAll("input[data-path], input[name], select[data-path], select[name], textarea[data-path], textarea[name]").forEach(inp => {
      inp.addEventListener("change", async () => {
        const path = inp.dataset.path || inp.getAttribute("name");
        if (!path || path.startsWith("__")) return;
        let v;
        if (inp.type === "checkbox") v = inp.checked;
        else if (inp.type === "number") {
          const n = Number(inp.value);
          v = Number.isFinite(n) ? n : 0;
        } else v = inp.value;
        if (String(w.type ?? "") === "select") await persistWidgetValue(doc, w, v);
        else await doc.update({ [path]: v });
      });
    });

    cell.querySelectorAll("[data-step], [data-action='widgetNumStep']").forEach(btn => {
      btn.addEventListener("click", async ev => {
        ev.preventDefault();
        ev.stopPropagation();
        const step   = parseFloat(btn.dataset.step);
        const path   = btn.dataset.path;
        if (!path || !Number.isFinite(step)) return;
        const cur    = _numberForPath(path);
        const dsMin  = btn.dataset.min;
        const dsMax  = btn.dataset.max;
        const rawMin = (dsMin  !== undefined && dsMin  !== "") ? parseFloat(dsMin)
                     : (w.min != null ? Number(w.min) : -Infinity);
        const rawMax = (dsMax  !== undefined && dsMax  !== "") ? parseFloat(dsMax)
                     : (w.max != null ? Number(w.max) :  Infinity);
        const min    = Number.isFinite(rawMin) ? rawMin : -Infinity;
        const max    = Number.isFinite(rawMax) ? rawMax :  Infinity;
        const next   = Math.clamp(cur + step, min, max);
        const field  = _fieldForPath(path);
        if (field && "value" in field) field.value = String(next);
        await doc.update({ [path]: next });
      });
    });

    cell.querySelectorAll("[data-roll]").forEach(el => {
      el.addEventListener("click", async () => {
        let formula = el.dataset.roll;
        if (!formula || formula.trim().startsWith("[")) return;
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

    cell.querySelectorAll("[data-toggle]").forEach(tog => {
      tog.addEventListener("click", async () => {
        await doc.update({ [tog.dataset.toggle]: tog.dataset.on !== "true" });
      });
    });

    cell.querySelectorAll("[data-action='attrModClick']").forEach(btn => {
      btn.addEventListener("click", async () => {
        const onClickFml = btn.dataset.attrOnclick;
        if (onClickFml) {

          const trimmed = onClickFml.trim();
          if (trimmed.startsWith("[")) {
            try {
              const actions = JSON.parse(trimmed);
              const actorCtx = doc instanceof Actor ? doc : doc.actor ?? null;
              const itemCtx = doc instanceof Actor ? null : doc;
              const fakeBtnDef = { label: btn.dataset.flavor ?? "" };
              const runtime = {};
              for (const action of actions) {
                await ButtonExecutor._runAction(action, itemCtx ?? { system: {}, actor: actorCtx }, actorCtx, fakeBtnDef, runtime);
              }
            } catch(err) { console.error("SD | attrModClick exec error:", err); }
            return;
          }
        }
        // Event-only widget: nothing configured, so the Sheet Blueprint owns it.
        let formula = onClickFml || btn.dataset.attrRoll || "";
        if (!String(formula).trim()) return;
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

    cell.querySelectorAll("[data-action='widgetRoll']").forEach(btn => {
      btn.addEventListener("click", async () => {
        let formula = btn.dataset.formulaRaw || btn.dataset.formula || "";
        if (!String(formula).trim()) return;
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
    cell.querySelectorAll("[data-action='widgetToggle']").forEach(btn => {
      btn.addEventListener("click", async () => {
        await doc.update({ [btn.dataset.path]: !_readPath(btn.dataset.path) });
      });
    });

    cell.querySelectorAll("[data-action='widgetSelectPill']").forEach(el => {
      const handler = async ev => {
        ev.stopPropagation();
        const path = el.dataset.path;
        const val  = el.dataset.value ?? el.value ?? "";
        if (!path && !w.widgetKey) return;
        await persistWidgetValue(doc, w, val);
      };

      el.addEventListener(el.tagName === "INPUT" ? "change" : "click", handler);
    });

    cell.querySelectorAll("[data-action='widgetButton']").forEach(btn => {
      btn.addEventListener("click", async () => {
        const rawFormula = btn.dataset.formulaRaw || btn.dataset.formula;
        // No configured action: the capture-phase emitter already delivered the
        // "click" event to the Sheet Blueprint, so do nothing else here.
        if (!rawFormula) return;

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

    cell.querySelectorAll("[data-action='wbElement']").forEach(el => {
      el.addEventListener("click", ev => {
        ev.preventDefault();
        ev.stopPropagation();
        const name=String(el.dataset.eventName??"").trim();
        const elementKey=String(el.dataset.elementKey??name.replace(/^On Click\s+/,"")).trim();
        if(!name&&!elementKey)return;
        emitSheetWidgetEvent("click",ev,{value:elementKey,elementKey});
        try {
          const actor=doc instanceof Actor?doc:doc?.actor??null;
          Hooks.callAll("sdCustomEvent", {
            name:name||`On Click ${elementKey}`,
            scope: actor?"actor":"item",
            actorId: actor?.id??"",
            sourceUuid: doc?.uuid??"",
            payload: elementKey
          });
        } catch (e) { console.error("SD | wbElement event failed:", e); }
      });
    });

    const _sdCardBusy = async (el, fn) => {
      if (!el) return;
      if (el.dataset.sdBusy === "1") return;
      el.dataset.sdBusy = "1";
      const wasDisabled = el.disabled;
      if ("disabled" in el) el.disabled = true;
      try { await fn(); }
      finally {
        delete el.dataset.sdBusy;
        if ("disabled" in el) el.disabled = wasDisabled;
      }
    };

    const _sdRunCardGraph = async (el, stack, card) => {
      const raw = el.dataset.actionGraph ?? "";
      if (!raw) {
        ui.notifications.warn("SD | runGraph clicked but no action graph is configured on this Card Hand widget.");
        return;
      }
      let actions = null;
      let macros  = null;
      try {
        const trimmed = raw.trim();
        if (trimmed.startsWith("[")) {
          actions = JSON.parse(trimmed);
        } else if (trimmed.startsWith("{")) {
          const payload = JSON.parse(trimmed);
          if (payload?._trigger === "onClick")     actions = payload.actions ?? [];
          else if (payload?._trigger === "multi")  actions = payload._events?.onClick ?? payload.onClick ?? [];
          macros = payload?._macros ?? null;
        }
      } catch (e) {
        console.error("SD | cardRunGraph parse:", e);
        ui.notifications.error("Card action graph parse failed: " + (e?.message ?? e));
        return;
      }
      if (!Array.isArray(actions) || !actions.length) return;

      let _cardValue = (typeof card?.value === "number") ? card.value : null;
      if (_cardValue === null && typeof card?.face === "number" && card?.faces?.[card.face]?.value !== undefined) {
        _cardValue = Number(card.faces[card.face].value);
      }
      if (_cardValue === null || isNaN(_cardValue)) _cardValue = 0;
      const _faceIdx = (card?.face === null || card?.face === undefined) ? -1 : Number(card.face);
      const _faceImg = (typeof card?.face === "number" && card?.faces?.[card.face]?.img)
        ? card.faces[card.face].img
        : (card?.faces?.[0]?.img ?? card?.back?.img ?? "");

      const fakeBtnDef = {
        label:    "cardClick:runGraph",
        formula:  raw,
        __macros: macros,
        __eventRuntime: {
          __cardClickedId:        card?.id ?? "",
          __cardClickedName:      card?.name ?? "",
          __cardClickedFace:      isNaN(_faceIdx) ? -1 : _faceIdx,
          __cardClickedFaceImg:   _faceImg,
          __cardClickedValue:     _cardValue,
          __cardClickedStackId:   stack?.id   ?? "",
          __cardClickedStackUuid: stack?.uuid ?? "",
          __cardClickedStackName: stack?.name ?? ""
        }
      };
      const actorCtx = doc instanceof Actor ? doc : doc.actor ?? null;
      const itemCtx  = doc instanceof Actor ? null : doc;
      const runtime  = {};
      try {
        for (const action of actions) {
          await ButtonExecutor._runAction(action, itemCtx ?? { system: {}, actor: actorCtx }, actorCtx, fakeBtnDef, runtime);
        }
      } catch (e) {
        console.error("SD | cardRunGraph exec:", e);
        ui.notifications.error("Card action graph failed: " + (e?.message ?? e));
      }
    };

    cell.querySelectorAll("[data-action='cardClick']").forEach(el => {
      const mode  = el.dataset.clickMode || "inspect";
      const runOn = el.dataset.runOn      || "click";

      if (mode === "runGraph") {
        const evName = runOn === "dblclick" ? "dblclick" : runOn === "rightclick" ? "contextmenu" : "click";
        el.addEventListener(evName, async (ev) => {
          if (ev.target?.closest?.("[data-action='cardFlip']")) return;
          if (evName === "contextmenu") ev.preventDefault();
          const stackUuid = el.dataset.stackUuid;
          const cardId    = el.dataset.cardId;
          await _sdCardBusy(el, async () => {
            try {
              const stack = await fromUuid(stackUuid);
              const card  = stack?.cards?.get?.(cardId);
              if (!stack || !card) return;
              await _sdRunCardGraph(el, stack, card);
            } catch (e) {
              console.error("SD | cardClick:runGraph:", e);
              ui.notifications.error("Card action failed: " + (e?.message ?? e));
            }
          });
        });
        return;
      }

      el.addEventListener("click", async (ev) => {
        if (ev.target?.closest?.("[data-action='cardFlip']")) return;
        if (mode === "none") return;
        const stackUuid = el.dataset.stackUuid;
        const cardId    = el.dataset.cardId;
        await _sdCardBusy(el, async () => {
          try {
            const stack = await fromUuid(stackUuid);
            const card  = stack?.cards?.get?.(cardId);
            if (!stack || !card) return;
            if (mode === "inspect") {
              card.sheet?.render(true);
            } else if (mode === "play") {
              if (typeof stack.playDialog === "function") {
                await stack.playDialog(card);
              } else if (typeof stack.passDialog === "function") {
                await stack.passDialog(card);
              } else {
                ui.notifications.warn("SD | Cards#playDialog is not available on this stack — pick a destination via the right-click menu.");
              }
            } else if (mode === "discard") {
              if (typeof stack.passDialog === "function") {
                await stack.passDialog(card);
              } else {
                ui.notifications.warn("SD | Cards#passDialog is not available on this stack.");
              }
            } else if (mode === "flip") {
              await card.update({ face: card.face === null ? 0 : null });
            }
          } catch(e) {
            console.error("SD | cardClick:", e);
            ui.notifications.error("Card action failed: " + (e?.message ?? e));
          }
        });
      });
    });

    cell.querySelectorAll("[data-action='cardFlip']").forEach(btn => {
      btn.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        const stackUuid = btn.dataset.stackUuid;
        const cardId    = btn.dataset.cardId;
        await _sdCardBusy(btn, async () => {
          try {
            const stack = await fromUuid(stackUuid);
            const card  = stack?.cards?.get?.(cardId);
            if (!card) return;
            await card.update({ face: card.face === null ? 0 : null });
          } catch(e) {
            console.error("SD | cardFlip:", e);
            ui.notifications.error("Card flip failed: " + (e?.message ?? e));
          }
        });
      });
    });

    cell.querySelectorAll("[data-action='cardStripScroll']").forEach(btn => {
      btn.addEventListener("click", () => {
        const dir = Number(btn.dataset.dir) || 1;
        const strip = btn.parentElement?.querySelector(".sd-cardhand-strip");
        if (strip) strip.scrollBy({ left: dir * 200, behavior: "smooth" });
      });
    });

    cell.querySelectorAll("[data-action='cardSliderPrev'], [data-action='cardSliderNext']").forEach(btn => {
      btn.addEventListener("click", () => {
        const container = btn.closest(".sd-cards-container");
        const track = container?.querySelector(".sd-cards-track");
        if (!track) return;
        const dir = btn.dataset.action === "cardSliderNext" ? 1 : -1;
        const step = Math.max(120, Math.round(track.clientWidth / 3));
        track.scrollBy({ left: dir * step, behavior: "smooth" });
      });
    });

    cell.querySelectorAll("[data-action='cardStackShuffle']").forEach(btn => {
      btn.addEventListener("click", async () => {
        try {
          const stack = await fromUuid(btn.dataset.stackUuid);
          if (stack) await stack.shuffle({ chatNotification: true });
        } catch(e) { console.error("SD | cardStackShuffle:", e); }
      });
    });

    cell.querySelectorAll("[data-action='cardStackRecall']").forEach(btn => {
      btn.addEventListener("click", async () => {
        try {
          const stack = await fromUuid(btn.dataset.stackUuid);
          if (stack) await stack.recall({ chatNotification: true });
        } catch(e) { console.error("SD | cardStackRecall:", e); }
      });
    });

    cell.querySelectorAll("[data-action='cardStackFlipAll']").forEach(btn => {
      btn.addEventListener("click", async () => {
        try {
          const stack = await fromUuid(btn.dataset.stackUuid);
          if (!stack) return;
          const updates = stack.cards.map(c => ({ _id: c.id, face: c.face === null ? 0 : null }));
          await stack.updateEmbeddedDocuments("Card", updates);
        } catch(e) { console.error("SD | cardStackFlipAll:", e); }
      });
    });

    cell.querySelectorAll("[data-action='cardWidgetDraw']").forEach(btn => {
      btn.addEventListener("click", async () => {
        if (btn.dataset.sdBusy === "1") return;
        btn.dataset.sdBusy = "1";
        const wasDisabled = btn.disabled;
        btn.disabled = true;
        const fromUuidVal = btn.dataset.fromUuid || "";
        const fromName    = btn.dataset.fromName || "";
        const toUuidVal   = btn.dataset.toUuid   || "";
        const toName      = btn.dataset.toName   || "";
        const count       = Math.max(1, Number(btn.dataset.count) || 1);
        const how         = btn.dataset.how || "top";
        try {
          const from = (fromUuidVal && await fromUuid(fromUuidVal)) || (fromName && game.cards?.getName?.(fromName));
          const to   = (toUuidVal   && await fromUuid(toUuidVal))   || (toName   && game.cards?.getName?.(toName));
          if (!from || !to) { ui.notifications.warn("SD | Card Draw widget: stack not found"); return; }
          if (from === to || from.uuid === to.uuid) {
            ui.notifications.warn("SD | Card Draw widget: source and destination must differ");
            return;
          }
          const mode = how === "bottom" ? CONST.CARD_DRAW_MODES.BOTTOM
                     : how === "random" ? CONST.CARD_DRAW_MODES.RANDOM
                     : CONST.CARD_DRAW_MODES.TOP;
          const available = from.availableCards?.length ?? from.cards?.size ?? 0;
          if (available <= 0) { ui.notifications.info(`SD | Deck "${from.name}" is empty.`); return; }
          const n = Math.min(count, available);

          let attempts = 0;
          while (true) {
            try {
              await to.draw(from, n, { how: mode, chatNotification: true });
              break;
            } catch (err) {
              const msg = String(err?.message ?? err ?? "");
              const m = /_id \[([A-Za-z0-9]+)\] already exists/.exec(msg);
              if (m && to.cards?.has?.(m[1]) && attempts < 8) {
                attempts++;
                console.warn(`SD | cardWidgetDraw: removing stale duplicate card ${m[1]} from "${to.name}" and retrying (attempt ${attempts})`);
                try { await to.deleteEmbeddedDocuments("Card", [m[1]]); } catch (e2) { console.error("SD | cardWidgetDraw cleanup:", e2); throw err; }
                continue;
              }
              throw err;
            }
          }
        } catch(e) {
          console.error("SD | cardWidgetDraw:", e);
          ui.notifications.error("Card draw failed: " + e.message);
        } finally {
          delete btn.dataset.sdBusy;
          btn.disabled = wasDisabled;
        }
      });
    });

    cell.querySelectorAll("[data-action='questMarkerOpen']").forEach(btn => {
      btn.addEventListener("click", async ev => {
        ev.preventDefault();
        ev.stopPropagation();
        const logUuid = btn.dataset.qmLog || "";
        const qid     = btn.dataset.qmQid || "";
        if (!logUuid) return;
        try {
          const log = await fromUuid(logUuid);
          if (!log) return;
          await log.sheet?.render?.(true);
          if (qid) {
            setTimeout(() => {
              try {
                const sheet = log.sheet;
                const root = sheet?.element?.[0] ?? sheet?.element ?? null;
                const li = root?.querySelector?.(`.sd-quest-row[data-quest-id="${qid}"]`);
                if (li) {
                  li.click();
                  li.scrollIntoView({ block: "center", behavior: "smooth" });
                }
              } catch {}
            }, 250);
          }
        } catch(e) {
          console.error("SD | questMarkerOpen:", e);
        }
      });
    });

    cell.querySelectorAll("[data-action='slotItemUse']").forEach(btn => {
      btn.addEventListener("click", async () => {
        const slotId = btn.dataset.slotId;
        const idx    = parseInt(btn.dataset.slotIndex ?? "0");
        const { SlotManager } = await import("../data/item-slots.mjs");
        const contents = SlotManager.getContents(doc, slotId);
        const itemData = contents[idx];
        if (!itemData) return;
        const actor = doc instanceof Actor ? doc : doc.actor;
        let item = actor?.items?.get(itemData._id) ?? null;

        if (!item) item = actor?.items?.find(i => i.name === itemData.name) ?? null;

        if (!item && itemData._sourceUuid) {
          try { item = await fromUuid(itemData._sourceUuid); } catch {}
        }
        let isSnapshot = false;
        if (!item) {
          try {
            const ItemCls = foundry.utils.getDocumentClass("Item");
            item = new ItemCls(itemData, { parent: null });
            isSnapshot = true;
          } catch(e) { console.warn("SD | slotItemUse: could not build temp item:", e); }
        }
        if (item && (isSnapshot || itemData._sourceUuid)) {
          const _snapSlotId = slotId;
          const _snapIdx    = idx;
          const _origUpdate = item.update.bind(item);
          item.update = async function(changes, _opts = {}) {
            const expanded = foundry.utils.expandObject(changes);
            if (this.system && expanded.system) {
              foundry.utils.mergeObject(this.system, expanded.system,
                { insertKeys: true, insertValues: true, overwrite: true });
            }
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

    cell.querySelectorAll("[data-sd-slot-use]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const slotId = btn.dataset.sdSlotUse;
        const idx    = parseInt(btn.dataset.sdSlotIdx ?? "0");
        const { SlotManager } = await import("../data/item-slots.mjs");
        const contents = SlotManager.getContents(doc, slotId);
        const itemData = contents[idx];
        if (!itemData) return;
        const actor = doc instanceof Actor ? doc : doc.actor;
        let liveItem = actor?.items?.get(itemData._id) ?? null;

        if (!liveItem) liveItem = actor?.items?.find(i => i.name === itemData.name) ?? null;
        if (!liveItem && itemData._sourceUuid) {
          try { liveItem = await fromUuid(itemData._sourceUuid); } catch {}
        }
        let isSnapshot = false;
        if (!liveItem) {
          try {
            const ItemCls = foundry.utils.getDocumentClass("Item");
            liveItem = new ItemCls(itemData, { parent: null });
            isSnapshot = true;
          } catch(e) { console.warn("SD | slot use: could not build temp item:", e); }
        }
        if (liveItem && (isSnapshot || itemData._sourceUuid)) {
          const _snapSlotId = slotId;
          const _snapIdx    = idx;
          liveItem.update = async function(changes, _opts = {}) {
            const expanded = foundry.utils.expandObject(changes);
            if (this.system && expanded.system) {
              foundry.utils.mergeObject(this.system, expanded.system,
                { insertKeys: true, insertValues: true, overwrite: true });
            }
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

    cell.querySelectorAll("[data-sd-slot-remove]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const { SlotManager } = await import("../data/item-slots.mjs");
        CONFIG.debug?.sd && console.log("[SD] sd-slot-remove clicked | doc:", doc?.name??doc?.id, "slotId:", btn.dataset.sdSlotRemove, "idx:", btn.dataset.sdSlotIdx);
        await SlotManager.removeFromSlot(doc, btn.dataset.sdSlotRemove, parseInt(btn.dataset.sdSlotIdx));
      });
    });

    const _resolveSlottedItem = async (itemId, itemUuid, snapshot, parentDoc) => {
      const actor = parentDoc instanceof Actor ? parentDoc : parentDoc?.actor ?? null;
      CONFIG.debug?.sd && console.log("[SD] _resolveSlottedItem | itemId:", itemId, "itemUuid:", itemUuid, "snapshot:", snapshot?.name, "_sourceUuid:", snapshot?._sourceUuid, "actor:", actor?.id);
      let item = itemId ? (actor?.items?.get(itemId) ?? null) : null;
      CONFIG.debug?.sd && console.log("[SD]   step1 by _id:", item?.name ?? "null");
      if (!item && itemUuid) {
        try { item = await fromUuid(itemUuid); } catch(e) { console.warn("[SD]   step2 fromUuid error:", e.message); }
        CONFIG.debug?.sd && console.log("[SD]   step2 by itemUuid:", item?.name ?? "null");
      }
      if (!item && snapshot?._sourceUuid) {
        try { item = await fromUuid(snapshot._sourceUuid); } catch(e) { console.warn("[SD]   step3 fromUuid error:", e.message); }
        CONFIG.debug?.sd && console.log("[SD]   step3 by snapshot._sourceUuid:", item?.name ?? "null");
      }

      if (!item && itemId) {
        try { item = await fromUuid("Item." + itemId); } catch(e) { console.warn("[SD]   step4 fromUuid error:", e.message); }
        CONFIG.debug?.sd && console.log("[SD]   step4 by world Item._id:", item?.name ?? "null");
      }
      if (!item && snapshot?.name) {
        item = actor?.items?.find(i => i.name === snapshot.name) ?? null;
        CONFIG.debug?.sd && console.log("[SD]   step5 by name:", item?.name ?? "null");
      }
      CONFIG.debug?.sd && console.log("[SD] _resolveSlottedItem RESULT:", item?.name ?? "NOT FOUND");
      return item ?? null;
    };

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

    cell.querySelectorAll("[data-item-drag]").forEach(el => {
      el.setAttribute("draggable", "true");
      el.addEventListener("dragstart", ev => {
        const actor = doc instanceof Actor ? doc : doc.actor;
        const itemId = el.dataset.itemId;
        const item = actor?.items?.get(itemId) ?? doc.items?.get(itemId);
        const uuid = item?.uuid ?? el.dataset.itemUuid ?? null;
        if (!uuid && !itemId) return;
        const dragData = {
          type: "Item",
          uuid,
          _id: itemId,
          sdSrc: actor ? { kind: "inventory", actorUuid: actor.uuid, itemId } : null
        };
        ev.dataTransfer.setData("text/plain", JSON.stringify(dragData));
        ev.dataTransfer.effectAllowed = "all";
        ev.stopPropagation();
      });
    });

    cell.querySelectorAll("[data-slot-item-drag]").forEach(el => {
      el.setAttribute("draggable", "true");
      el.addEventListener("dragstart", ev => {
        const actor = doc instanceof Actor ? doc : doc.actor;
        const slotId = el.dataset.slotId || "";
        const idx = parseInt(el.dataset.slotIndex ?? "-1");
        if (!actor || !slotId || isNaN(idx) || idx < 0) return;
        const dragData = {
          type: "Item",
          uuid: el.dataset.itemUuid || "",
          _id:  el.dataset.itemId   || "",
          sdSrc: {
            kind: "slot",
            actorUuid: actor.uuid,
            hostUuid: doc?.uuid ?? actor.uuid,
            slotId,
            index: idx,
            itemName: el.getAttribute("title") || ""
          }
        };
        ev.dataTransfer.setData("text/plain", JSON.stringify(dragData));
        ev.dataTransfer.effectAllowed = "all";
        ev.stopPropagation();
      });
    });

    cell.querySelectorAll(".sb-ability-row[draggable]").forEach(row => {
      row.addEventListener("dragstart", ev => {
        const actor  = doc instanceof Actor ? doc : doc.actor;
        const itemId = row.dataset.itemId;
        const item   = actor?.items?.get(itemId) ?? doc.items?.get(itemId);
        if (!item) return;
        ev.dataTransfer.setData("text/plain", JSON.stringify({
          type: "Item", uuid: item.uuid, _id: item.id,
          sdSrc: actor ? { kind: "inventory", actorUuid: actor.uuid, itemId: item.id } : null
        }));
        ev.dataTransfer.effectAllowed = "all";
        ev.stopPropagation();
      });
    });

    cell.querySelectorAll("[data-sd-slot-drop]").forEach(dz => {
      dz.addEventListener("dragover", ev => {
        ev.preventDefault();
        dz.style.background = "var(--sd-accent-glow)";
        dz.style.color = "var(--sd-accent)";
        dz.style.borderColor = "var(--sd-accent)";
      });
      dz.addEventListener("dragleave", () => {
        dz.style.background = "";
        dz.style.color = "#555";
        dz.style.borderColor = "var(--sd-accent-dim)";
      });
      dz.addEventListener("drop", async ev => {
        ev.preventDefault();
        ev.stopPropagation();
        dz.style.background = "";
        dz.style.color = "#555";
        dz.style.borderColor = "var(--sd-accent-dim)";
        try {
          const data = CharacterSheet._readSdDragData(ev);
          if (!data) return;
          const slotId = dz.dataset.sdSlotDrop;
          const target = doc instanceof Actor ? doc : (doc?.actor ?? null);
          await CharacterSheet._handleSlotDrop(ev, target, slotId, data);
        } catch(err) { console.warn("SD | slot drop:", err); }
      });
    });

    cell.querySelectorAll("[data-action='itemUse']").forEach(btn => {
      btn.addEventListener("click", async () => {
        const item = doc.items?.get(btn.dataset.itemId);
        if (item) await item.use({});
      });
    });
    cell.querySelectorAll("[data-action='itemEquip']").forEach(btn => {
      btn.addEventListener("click", async () => {
        // Slotted item: lives as a snapshot inside a slot, not as a live embedded document.
        const _slotId = btn.dataset.slotId;
        if (_slotId) {
          const { SlotManager } = await import("../data/item-slots.mjs");
          await SlotManager.toggleSlotEquip(doc, _slotId, parseInt(btn.dataset.slotIndex ?? "0"));
          return;
        }
        const item = doc.items?.get(btn.dataset.itemId);
        if (!item || item.type !== "inventory") return;
        if (!item.system?.equippable) {
          const msg = game.i18n?.format?.("SD.NotEquippableHint", { name: item.name });
          ui.notifications?.warn((!msg || msg === "SD.NotEquippableHint")
            ? `"${item.name}" is not marked Equippable. Open the item → Effects tab → Equipment and tick Equippable.`
            : msg);
          return;
        }
        const next = !item.system.equipped;
        if (next && typeof item.canEquip === "function") {
          const { ok, reason } = await item.canEquip();
          if (!ok) {
            ui.notifications?.warn(reason ?? game.i18n.localize("SD.EquipBlocked") ?? "Cannot equip.");
            return;
          }
        }
        await item.update({ "system.equipped": next }, { sdEquipToggle: true });
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

    cell.querySelectorAll("[data-action='effectCreate']").forEach(btn => {
      btn.addEventListener("click", async () => {
        const cls = foundry.utils.getDocumentClass("ActiveEffect");
        cls.createDialog({}, { parent: doc });
      });
    });
    const _resolveEffectForButton = async (btn) => {
      const uuid = btn.dataset.effectUuid;
      if (uuid) {
        const effect = await fromUuid(uuid).catch(() => null);
        if (effect) return effect;
      }
      return doc.effects?.get(btn.dataset.effectId) ?? null;
    };
    cell.querySelectorAll("[data-action='effectToggle']").forEach(btn => {
      btn.addEventListener("click", async () => {
        const ef = await _resolveEffectForButton(btn);
        if (ef) await ef.update({ disabled: !ef.disabled });
      });
    });
    cell.querySelectorAll("[data-action='effectMode']").forEach(btn => {
      btn.addEventListener("click", async () => {
        const ef = await _resolveEffectForButton(btn);
        if (ef) await _sdCycleEffectMode(ef);
      });
    });

    cell.querySelectorAll("[data-action='effectEdit']").forEach(btn => {
      btn.addEventListener("click", async () => {
        const ef = await _resolveEffectForButton(btn);
        if (ef) ef.sheet.render(true);
      });
    });
    cell.querySelectorAll("[data-action='effectDelete']").forEach(btn => {
      btn.addEventListener("click", async () => {
        const ef = await _resolveEffectForButton(btn);
        if (!ef) return;
        const ok = await foundry.applications.api.DialogV2.confirm({
          window: { title: "Delete Effect" },
          content: `<p>Delete <strong>${ef.name}</strong>?</p>`
        });
        if (ok) await ef.delete();
      });
    });

    cell.querySelectorAll(".sd-effect-drop-zone").forEach(dz => {
      dz.addEventListener("dragover", ev => {
        ev.preventDefault();
        dz.classList.add("sd-cards-drop-zone-over");
      });
      dz.addEventListener("dragleave", () => {
        dz.classList.remove("sd-cards-drop-zone-over");
      });
      dz.addEventListener("drop", async ev => {
        ev.preventDefault();
        dz.classList.remove("sd-cards-drop-zone-over");
        try {
          const data = JSON.parse(ev.dataTransfer.getData("text/plain") || "null");
          if (!data) return;
          if (!(doc instanceof Actor)) return;

          if (data.type === "ActiveEffect" && data.uuid) {
            const src = await fromUuid(data.uuid);
            if (!src) return;
            const obj = src.toObject();
            delete obj._id;
            await doc.createEmbeddedDocuments("ActiveEffect", [obj]);
            ui.notifications?.info?.(`Added effect "${obj.name}" to ${doc.name}`);
          } else if (data.type === "Item" && data.uuid) {
            const src = await fromUuid(data.uuid);
            const effects = src?.effects?.contents ?? [];
            if (!effects.length) {
              ui.notifications?.warn?.(`"${src?.name ?? "Item"}" has no effects to transfer.`);
              return;
            }
            const objs = effects.map(ef => {
              const o = ef.toObject();
              delete o._id;
              return o;
            });
            await doc.createEmbeddedDocuments("ActiveEffect", objs);
            ui.notifications?.info?.(`Copied ${objs.length} effect(s) from "${src.name}".`);
          }
        } catch (err) {
          console.warn("SD | effect drop:", err);
        }
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

        await item.use({});
      });
    });

    cell.querySelectorAll("[data-action='abilityEdit']").forEach(btn => {
      btn.addEventListener("click", () => {
        const item = doc.items?.get(btn.dataset.itemId);
        if (item) item.sheet.render(true);
      });
    });

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

    cell.querySelectorAll("[data-action='slotAddLevel']").forEach(btn => {
      btn.addEventListener("click", async () => {
        const existing = Object.keys(doc.system?.spellSlots ?? {})
          .map(Number).filter(n => !isNaN(n)).sort((a, b) => a - b);

        let next = 1;
        while (existing.includes(next)) next++;
        if (next > 20) { ui.notifications.warn("Maximum 20 spell slot levels."); return; }
        await doc.update({ [`system.spellSlots.${next}.value`]: 0, [`system.spellSlots.${next}.max`]: 1 });
      });
    });

    cell.querySelectorAll("[data-action='slotRemoveLevel']").forEach(btn => {
      btn.addEventListener("click", async () => {
        const lvl = btn.dataset.level;
        await doc.update(deletionUpdate("system.spellSlots", lvl));
      });
    });

    cell.querySelectorAll(".sb-mana-input").forEach(inp => {
      inp.addEventListener("change", async () => {
        const v = Math.max(0, parseInt(inp.value) || 0);
        await doc.update({ [inp.name]: v });
      });
    });

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

    cell.querySelectorAll(".sb-drop-zone").forEach(dz => {
      dz.addEventListener("dragover", ev => {
        ev.preventDefault();
        dz.style.background  = "var(--sd-accent-glow)";
        dz.style.color       = "var(--sd-accent)";
        dz.style.borderColor = "var(--sd-accent)";
      });
      dz.addEventListener("dragleave", () => {
        dz.style.background  = "";
        dz.style.color       = "#555";
        dz.style.borderColor = "var(--sd-accent-dim)";
      });
      dz.addEventListener("drop", async ev => {
        ev.preventDefault();
        dz.style.background  = "";
        dz.style.color       = "#555";
        dz.style.borderColor = "var(--sd-accent-dim)";
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
            if (wantType && !String(obj.system.hiddenFields.type ?? "").trim()) {
              obj.system.hiddenFields.type = wantType;
            }
            await doc.createEmbeddedDocuments("Item", [obj]);
            ui.notifications.info(`Added "${item.name}" to ${doc.name}`);
          }
        } catch(err) { console.warn("SD | spellbook drop:", err); }
      });
    });

    cell.querySelectorAll("[data-copy-macro], [data-copy-macro-b64]").forEach(btn => {
      btn.addEventListener("click", async ev => {
        ev.stopPropagation();
        const script = decodeMacroScript(btn);
        if (!script) return;
        try {
          await navigator.clipboard.writeText(script);

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
          const safeScript = script.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
          await foundry.applications.api.DialogV2.prompt({
            window: { title: "Macro Script" },
            content: `<p style="font-size:11px;color:var(--sd-w-label, var(--sd-text-3));margin-bottom:6px">Copy the script below into a new Macro (type: Script):</p>
              <textarea style="width:100%;height:160px;font-family:monospace;font-size:11px;background:var(--sd-bg);color:#c0c0e0;border:1px solid var(--sd-w-bd,var(--sd-border));border-radius:4px;padding:6px;box-sizing:border-box;resize:vertical"
                readonly onclick="this.select()">${safeScript}</textarea>`,
            ok: { label: "Close" }
          });
        }
      });
    });

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
            btn.style.color = "var(--sd-stamina)";
            setTimeout(() => { icon.className = prev; btn.style.color = ""; }, 1200);
          }
        } catch {
          ui.notifications?.info?.(`Path: ${path}`);
        }
      });
    });

    cell.querySelectorAll(".sd-clock-segment").forEach(seg => {
      seg.addEventListener("click", async ev => {
        ev.stopPropagation();
        const path  = seg.dataset.path;
        const index = Number(seg.dataset.index);
        const segs  = Number(seg.dataset.segs ?? 4);
        if (!path) return;
        const cur   = Number(_readPath(path)) || 0;
        const next  = cur > index ? index : index + 1;
        await this.document.update({ [path]: Math.min(segs, Math.max(0, next)) });
      });
    });

    cell.querySelectorAll(".sd-clock-reset[data-path]").forEach(btn => {
      btn.addEventListener("click", async ev => {
        ev.stopPropagation();
        const path = btn.dataset.path;
        if (!path) return;
        await this.document.update({ [path]: 0 });
      });
    });

    cell.querySelectorAll(".sd-tracker-reset[data-path]").forEach(btn => {
      btn.addEventListener("click", async ev => {
        ev.stopPropagation();
        const path = btn.dataset.path;
        if (!path) return;
        await this.document.update({ [path]: 0 });
      });
    });

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

    cell.querySelectorAll(".sd-img-pick").forEach(btn => {
      btn.addEventListener("click", async ev => {
        ev.stopPropagation();
        const FP = foundry.applications?.apps?.FilePicker ?? globalThis.FilePicker;
        if (!FP) return ui.notifications?.error?.("FilePicker недоступен");

        if (btn.dataset.static === "1") {
          const widgetCell = btn.closest("[data-widget-id]");
          const tabId = widgetCell?.dataset.tabId;
          const rowId = widgetCell?.dataset.rowId;
          const widgetId = widgetCell?.dataset.widgetId;
          if (!tabId || !rowId || !widgetId) return;
          const cur = btn.dataset.current ?? "";
          new FP({
            type: "image",
            current: cur,
            callback: src => {
              const tabs = foundry.utils.deepClone(this.document.system.customTabs ?? []);
              const tab = tabs.find(t => t.id === tabId);
              const row = tab?.rows?.find(r => r.id === rowId);
              if (!row) return;
              const findIn = (arr) => {
                for (const w of arr) {
                  if (w.id === widgetId) return w;
                  if (w.type === "vsection" && Array.isArray(w.widgets)) {
                    const f = findIn(w.widgets); if (f) return f;
                  }
                }
                return null;
              };
              const widget = findIn(row.widgets ?? []);
              if (!widget) return;
              widget.staticSrc = src;
              this.document.update({ "system.customTabs": tabs });
            }
          }).render(true);
          return;
        }

        const path = btn.dataset.path;
        if (!path) return;
        const cur  = String(foundry.utils.getProperty(this.document, path) ?? "");
        new FP({
          type:     "image",
          current:  cur,
          callback: src => this.document.update({ [path]: src })
        }).render(true);
      });
    });

    RichTextEditor.wire(cell, doc);
  }

  _makeDropZone(tab, row, label = "Drop here", parentVS = null) {
    const rowCols = Math.max(1, Math.min(9, Number(row?.cols) || 3));
    const dz = document.createElement("div");
    dz.dataset.sdTour = "sheet-drop-zone";
    dz.dataset.sdTip = parentVS ? "Drop a widget into this vertical section." : "Drop a widget here while edit mode is enabled.";
    dz.style.cssText = `
      ${(row && !parentVS) ? "" : (parentVS ? "" : `grid-column:span ${rowCols};`)}
      border:1px dashed var(--sd-accent-dim); border-radius:5px;
      padding:8px; text-align:center; font-size:11px; color:var(--sd-text-3); cursor:pointer;
      transition:background .15s,color .15s,border-color .15s;
      user-select:none;
    `;
    dz.innerHTML = `<i class="fas fa-arrow-circle-down" style="margin-right:5px;opacity:.5"></i>${label}`;

    dz.addEventListener("dragover", ev => {
      ev.preventDefault();
      dz.style.background   = "var(--sd-accent-glow)";
      dz.style.color        = "var(--sd-accent)";
      dz.style.borderColor  = "var(--sd-accent)";
    });
    dz.addEventListener("dragleave", () => {
      dz.style.background  = "";
      dz.style.color       = "#444";
      dz.style.borderColor = "var(--sd-accent-dim)";
    });
    dz.addEventListener("drop", async ev => {
      ev.preventDefault();
      ev.stopPropagation();
      dz.style.background  = "";
      dz.style.color       = "#444";
      dz.style.borderColor = "var(--sd-accent-dim)";
      try {
        const data = JSON.parse(ev.dataTransfer.getData("text/plain"));
        if (data.sdType === "widget") {
          await this._addWidget(tab.id, row?.id ?? null, data.widgetType, parentVS?.id ?? null);
        } else if (data.sdType === "widget-move" || data.sdType === "moveWidget") {

          const myUuid = this.document?.uuid ?? null;
          const isCrossDoc = data.srcDocUuid && myUuid && data.srcDocUuid !== myUuid;
          const snapshot = data.widgetSnapshot ?? data.widget ?? null;
          if ((isCrossDoc || data.sdType === "moveWidget") && snapshot) {
            await this._insertWidgetSnapshot(snapshot, {
              tabId:      tab.id,
              rowId:      row?.id ?? null,
              parentVsId: parentVS?.id ?? null,
              toEnd:      true
            });
          } else if (data.tabId && data.rowId && data.widgetId) {
            await this._moveWidget(data, { tabId: tab.id, rowId: row?.id ?? null, parentVsId: parentVS?.id ?? null, toEnd: true });
          } else if (snapshot) {

            await this._insertWidgetSnapshot(snapshot, {
              tabId:      tab.id,
              rowId:      row?.id ?? null,
              parentVsId: parentVS?.id ?? null,
              toEnd:      true
            });
          }
        }
      } catch(e) { console.warn("SD | drop:", e); }
    });
    return dz;
  }


  async _maybeChooseInitialLayout() {
    if (this._layoutChoiceOpen || !this.document?.isOwner) return;
    if (this.document.getFlag?.("sd", "chooseSheetLayout") !== true) return;
    this._layoutChoiceOpen = true;
    try {
      const presets = Object.values(SHEET_STYLE_PRESETS);
      const choice = await foundry.applications.api.DialogV2.wait({
        modal:true,
        window:{title:"Choose Character Sheet"},
        content:`<div style="padding:8px 4px 12px;line-height:1.5">Choose the initial layout. You can change every option later with <i class="fas fa-palette"></i> <b>Sheet Appearance</b>.</div>`,
        buttons:presets.map((preset, index) => ({action:preset.id,label:preset.label,icon:preset.icon,default:index === 0})),
        rejectClose:false
      }).catch(() => "classic");
      const presetId = SHEET_STYLE_PRESETS[String(choice ?? "")] ? String(choice) : "classic";
      await this.document.update({
        "system.sheetStyle":sheetStyleFromPreset(presetId),
        "flags.sd.chooseSheetLayout":false
      });
    } finally {
      this._layoutChoiceOpen = false;
    }
  }

  async _openSheetAppearanceDialog() {
    const current = normalizeSheetStyle(this.document.system?.sheetStyle ?? {});
    const opts = (items, selected) => items.map(item => `<option value="${_sheetEsc(item.value)}" ${item.value === selected ? "selected" : ""}>${_sheetEsc(item.label)}</option>`).join("");
    const presetOptions = Object.values(SHEET_STYLE_PRESETS).map(preset => `<option value="${preset.id}" ${preset.id === current.preset ? "selected" : ""}>${_sheetEsc(preset.label)}</option>`).join("");
    const result = await foundry.applications.api.DialogV2.wait({
      modal:true,
      window:{title:"Sheet Appearance"},
      content:`<div class="sd-sheet-style-dialog" style="display:grid;grid-template-columns:150px minmax(0,1fr);gap:8px 10px;align-items:center;padding:8px;max-height:62vh;overflow:auto">
        <label>Preset</label><select name="preset"><option value="custom" ${current.preset === "custom" ? "selected" : ""}>Custom / keep values below</option>${presetOptions}</select>
        <label>Layout</label><select name="layout">${opts(SHEET_LAYOUTS, current.layout)}</select>
        <label>Header</label><select name="headerStyle">${opts(SHEET_HEADER_STYLES, current.headerStyle)}</select>
        <label>Density</label><select name="density">${opts(SHEET_DENSITIES, current.density)}</select>
        <label>Show tab labels</label><input type="checkbox" name="tabLabels" ${current.tabLabels ? "checked" : ""}>
        <label>Tab size</label><input type="number" name="tabSize" min="30" max="84" value="${current.tabSize}">
        <label>Rail width</label><input type="number" name="railWidth" min="48" max="220" value="${current.railWidth}">
        <label>Panel padding</label><input type="number" name="panelPadding" min="0" max="48" value="${current.panelPadding}">
        <label>Widget gap</label><input type="number" name="widgetGap" min="0" max="32" value="${current.widgetGap}">
        <label>Corner radius</label><input type="number" name="cornerRadius" min="0" max="32" value="${current.cornerRadius}">
        <label>Font scale</label><input type="number" name="fontScale" min="0.7" max="1.6" step="0.05" value="${current.fontScale}">
        <label>Accent colour</label><input type="text" name="accent" value="${_sheetEsc(current.accent)}" placeholder="#8a6cff">
        <label>Sheet background</label><input type="text" name="background" value="${_sheetEsc(current.background)}" placeholder="#14151d">
        <label>Panel background</label><input type="text" name="panelBackground" value="${_sheetEsc(current.panelBackground)}" placeholder="transparent">
        <label>Header background</label><input type="text" name="headerBackground" value="${_sheetEsc(current.headerBackground)}" placeholder="#20212d">
        <label>Background image</label><input type="text" name="backgroundImage" value="${_sheetEsc(current.backgroundImage)}" placeholder="systems/sd/assets/…">
        <div style="grid-column:1/-1;color:var(--sd-text-3);font-size:10px">Choosing a preset applies all of its values. Choose Custom to save the fields shown above.</div>
      </div>`,
      buttons:[
        {action:"save",label:"Apply",icon:"fas fa-check",default:true,callback:(event,button,dialog) => {
          const root = dialog.element;
          const val = name => root.querySelector(`[name="${name}"]`)?.value ?? "";
          return {
            preset:val("preset"), layout:val("layout"), headerStyle:val("headerStyle"), density:val("density"),
            tabLabels:!!root.querySelector('[name="tabLabels"]')?.checked,
            tabSize:Number(val("tabSize")), railWidth:Number(val("railWidth")), panelPadding:Number(val("panelPadding")),
            widgetGap:Number(val("widgetGap")), cornerRadius:Number(val("cornerRadius")), fontScale:Number(val("fontScale")),
            accent:val("accent"), background:val("background"), panelBackground:val("panelBackground"),
            headerBackground:val("headerBackground"), backgroundImage:val("backgroundImage")
          };
        }},
        {action:"cancel",label:"Cancel",icon:"fas fa-xmark",callback:()=>null}
      ],
      rejectClose:false
    }).catch(() => null);
    if (!result) return;
    const style = result.preset !== "custom" && SHEET_STYLE_PRESETS[result.preset]
      ? sheetStyleFromPreset(result.preset)
      : normalizeSheetStyle({...result, preset:"custom"});
    await this.document.update({"system.sheetStyle":style, "flags.sd.chooseSheetLayout":false});
  }

  _switchTab(tabId) {
    this._captureScrollMemory();
    this.tabGroups.sheet = tabId;
    const root = this.element;

    root.querySelectorAll(".sd-tab-btn[data-tab-id]").forEach(a => {
      const active = a.dataset.tabId === tabId;
      a.classList.toggle("is-active", active);
      a.classList.toggle("active", active);
    });

    root.querySelectorAll(".sd-tab-panel").forEach(p => {
      p.style.display = p.dataset.tab === tabId ? "flex" : "none";
    });
    this._restoreScrollMemory();
  }

  async _addTab(label = "New Tab") {
    const tabs = foundry.utils.deepClone(this.document.system.customTabs ?? []);
    const id   = foundry.utils.randomID(8);
    tabs.push({ id, label, icon:"", emoji:"", tooltip:"", color:"", showLabel:true, order:tabs.length + 1, rows:[] });
    await this.document.update({ "system.customTabs": tabs });
    await this._renameTab(id);
  }

  async _renameTab(tabId) {
    const tab = this.document.system.customTabs?.find(entry => entry.id === tabId);
    const settings = await _promptTabSettings(tab ?? {});
    if (!settings) return;
    const tabs = foundry.utils.deepClone(this.document.system.customTabs ?? []);
    const target = tabs.find(entry => entry.id === tabId);
    if (target) {
      Object.assign(target, settings);
      await this.document.update({"system.customTabs":tabs});
    }
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

  async _addWidget(tabId, rowId, widgetType, parentVsId = null) {
    const defaults = {
      text:      { label: "Label",    path: "system.flags.myField" },
      number:    { label: "Number",   path: "system.flags.myNumber" },
      resource:  { label: "Value Meter", pathValue: "", pathMax: "", color: "var(--sd-accent)" },
      dice:      { label: "Roll",     formula: "1d20" },
      button:    { label: "Action",   icon: "fa-bolt", color: "var(--sd-accent)", formula: "", flavor: "" },
      toggle:    { label: "Toggle",   path: "system.flags.myToggle", onLabel: "On", offLabel: "Off" },
      section:   { label: "Section",  span: 3 },
      vsection:  { label: "",         widgets: [], span: 1 },
      richtext:  { label: "Notes",    path: "system.biography.notes", span: 3 },
      attribute: { label: "Number Value", path: "" },
      skill:     { label: "Skill",    path: "system.skills.skill1.rank" },
      slot:      { label: "Slot",     slotId: "", maxCount: 1, span: 2 },
      inventory: { label: "Inventory", categories: [], columns: [], showCurrency: true, showWeight: true, span: 3 },
      effects:   { label: "Effects", showDisabled: true, showPassive: true, span: 3 },
      spellbook: { label: "Spellbook", abilityType: "", span: 3 }
    };

    const tabs = foundry.utils.deepClone(this.document.system.customTabs ?? []);
    const baseDefaults=defaults[widgetType] ?? { label: widgetType };
    const identity=await promptWidgetIdentity({widgetType,defaultLabel:baseDefaults.label||widgetType,tabs});
    if(!identity)return;
    const numberMode = widgetType === "number" ? await _chooseNumberWidgetMode() : null;
    const widget = {
      id:   foundry.utils.randomID(8),
      span: 1,
      ...baseDefaults,
      type: widgetType,
      label: identity.label,
      widgetKey: identity.widgetKey
    };
    if (widgetType === "number") _applyNumberWidgetMode(widget, numberMode);

    assignUniqueWidgetDataPaths(widget, this.document, { tabs });
    const tab  = tabs.find(t => t.id === tabId);
    if (!tab) return;

    if (rowId) {
      const row = tab.rows?.find(r => r.id === rowId);
      if (!row) return;
      row.widgets ??= [];
      if (parentVsId) {
        const vs = this._findVs(row.widgets, parentVsId);
        if (vs) { vs.widgets ??= []; vs.widgets.push(widget); }
      } else {
        row.widgets.push(widget);
      }
    } else {
      tab.rows ??= [];
      tab.rows.push({ id: foundry.utils.randomID(8), cols: 3, widgets: [widget] });
    }

    await this.document.update({ "system.customTabs": tabs, ...buildWidgetPathRegistryUpdate(this.document, tabs) });
  }

  _findVs(widgets, vsId) {
    if (!Array.isArray(widgets)) return null;
    for (const w of widgets) {
      if (w.id === vsId && w.type === "vsection") return w;
      if (w.type === "vsection") {
        const nested = this._findVs(w.widgets, vsId);
        if (nested) return nested;
      }
    }
    return null;
  }

  async _cycleSpan(tab, row, w) {
    const cols = Math.max(1, Math.min(9, Number(row.cols) || 3));
    const cur  = Math.max(1, Number(w.span) || 1);
    const newSpan = cur >= cols ? 1 : cur + 1;
    const tabs = foundry.utils.deepClone(this.document.system.customTabs ?? []);
    const fresh = tabs.find(t=>t.id===tab.id)?.rows?.find(r=>r.id===row.id);
    if (!fresh) return;
    const widget = this._findWidgetDeep(fresh.widgets, w.id);
    if (widget) { widget.span = newSpan; await this.document.update({ "system.customTabs": tabs }); }
  }

  _findWidgetDeep(widgets, id) {
    if (!Array.isArray(widgets)) return null;
    for (const w of widgets) {
      if (w.id === id) return w;
      if (w.type === "vsection") {
        const nested = this._findWidgetDeep(w.widgets, id);
        if (nested) return nested;
      }
      if (w.type === "widgetBuilder") {
        const embedded = this._findWidgetDeep((w.elements ?? []).map(el => el?.widget).filter(Boolean), id);
        if (embedded) return embedded;
      }
    }
    return null;
  }

  _removeWidgetDeep(widgets, id) {
    if (!Array.isArray(widgets)) return null;
    const i = widgets.findIndex(w => w.id === id);
    if (i >= 0) return widgets.splice(i, 1)[0];
    for (const w of widgets) {
      if (w.type === "vsection") {
        const r = this._removeWidgetDeep(w.widgets, id);
        if (r) return r;
      }
    }
    return null;
  }

  async _deleteWidget(tab, row, w, parentVS = null) {
    const _ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("SD.Widget.RemoveTitle") },
      content: `<p>${game.i18n.localize("SD.Widget.RemoveBody")}</p>`,
      modal: true,
      rejectClose: false
    }).catch(() => false);
    if (!_ok) return;
    const tabs = foundry.utils.deepClone(this.document.system.customTabs ?? []);
    const r    = tabs.find(t=>t.id===tab.id)?.rows?.find(r=>r.id===row.id);
    if (!r) return;
    const removed = this._removeWidgetDeep(r.widgets, w.id);
    if (!removed) return;
    const _upd = { "system.customTabs": tabs };
    if (removed?.type === "slot" && removed?.slotId) {
      const sid = String(removed.slotId);
      const stillUsed = (tabs ?? []).some(t => (t.rows ?? []).some(rw => (function _has(ws){
        return (ws ?? []).some(ww => (ww?.type === "slot" && String(ww?.slotId ?? "") === sid) || (Array.isArray(ww?.widgets) && _has(ww.widgets)));
      })(rw.widgets)));
      if (!stillUsed) {
        const { SlotManager } = await import("../data/item-slots.mjs");
        const _purge = SlotManager.buildSlotPurgeUpdates(this.document, sid);
        if (_purge) Object.assign(_upd, _purge);
        const defs = (this.document.system.slotDefinitions ?? []).filter(d => String(d.id) !== sid);
        if (defs.length !== (this.document.system.slotDefinitions ?? []).length) {
          _upd["system.slotDefinitions"] = defs;
        }
      }
    }
    await this.document.update(_upd);
  }

  _refreshWidgetIdsDeep(widget) {
    if (!widget) return;
    widget.id = foundry.utils.randomID(8);
    if (widget.type === "vsection" && Array.isArray(widget.widgets)) {
      for (const child of widget.widgets) this._refreshWidgetIdsDeep(child);
    }
    if (widget.type === "widgetBuilder" && Array.isArray(widget.elements)) {
      for (const element of widget.elements) {
        element.id = foundry.utils.randomID(6);
        if (element?.widget) this._refreshWidgetIdsDeep(element.widget);
      }
    }
  }

  async _duplicateWidget(tab, row, w, parentVS = null) {
    const tabs    = foundry.utils.deepClone(this.document.system.customTabs ?? []);
    const freshTab = tabs.find(t => t.id === tab.id);
    const freshRow = freshTab?.rows?.find(r => r.id === row.id);
    if (!freshRow) return;

    const container = parentVS
      ? (this._findVs(freshRow.widgets, parentVS.id)?.widgets ?? null)
      : freshRow.widgets;
    if (!container) return;

    const idx = container.findIndex(x => x.id === w.id);
    if (idx < 0) return;

    const clone = foundry.utils.deepClone(container[idx]);
    this._refreshWidgetIdsDeep(clone);
    assignUniqueWidgetDataPaths(clone, this.document, { tabs });
    container.splice(idx + 1, 0, clone);

    await this.document.update({ "system.customTabs": tabs, ...buildWidgetPathRegistryUpdate(this.document, tabs) });
  }

  async _insertWidgetSnapshot(snapshot, dst) {
    if (!snapshot || !dst?.tabId) return;
    const tabs = foundry.utils.deepClone(this.document.system.customTabs ?? []);
    const dstTab = tabs.find(t => t.id === dst.tabId);
    if (!dstTab) return;

    const clone = foundry.utils.deepClone(snapshot);
    this._refreshWidgetIdsDeep(clone);
    assignUniqueWidgetDataPaths(clone, this.document, { tabs });

    let dstContainer;
    if (dst.rowId) {
      const dstRow = dstTab.rows?.find(r => r.id === dst.rowId);
      if (!dstRow) return;
      dstContainer = dst.parentVsId
        ? (this._findVs(dstRow.widgets, dst.parentVsId)?.widgets ?? null)
        : dstRow.widgets;
      if (!dstContainer) return;
    } else {
      const newRow = { id: foundry.utils.randomID(8), cols: 3, widgets: [] };
      dstTab.rows ??= [];
      dstTab.rows.push(newRow);
      dstContainer = newRow.widgets;
    }

    if (clone.type === "vsection" && dst.parentVsId) {
      dst = { ...dst, parentVsId: null };
    }

    const insertIdx = dst.toEnd ? dstContainer.length : Math.max(0, Math.min(dstContainer.length, dst.index ?? dstContainer.length));
    dstContainer.splice(insertIdx, 0, clone);
    await this.document.update({ "system.customTabs": tabs, ...buildWidgetPathRegistryUpdate(this.document, tabs) });
  }

  async _configWidget(tab, row, w, parentVS = null) {
    const { openWidgetConfigPopup } = await import("../builder/widget-config-popup.mjs");
    const freshTabs   = this.document.system.customTabs ?? [];
    const freshTab    = freshTabs.find(t => t.id === tab.id) ?? tab;
    const freshRow    = freshTab.rows?.find(r => r.id === row.id) ?? row;
    const freshWidget = this._findWidgetDeep(freshRow.widgets, w.id) ?? w;
    await openWidgetConfigPopup(freshWidget, freshTab, freshRow, this.document);
  }

  async _configRow(tabId, rowId) {
    const row = this.document.system.customTabs?.find(t => t.id === tabId)?.rows?.find(r => r.id === rowId);
    const cur = Math.max(1, Math.min(9, Number(row?.cols) || 3));
    const n = await foundry.applications.api.DialogV2.prompt({
      window: { title: "Row Columns" },
      content: `<div style="padding:8px 0">
        <label style="font-size:12px;color:var(--sd-w-label, var(--sd-text-3))">Columns (1-9):</label>
        <input type="number" min="1" max="9" name="cols" value="${cur}"
          style="width:100%;margin-top:4px;background:var(--sd-w-bg,var(--sd-bg-3));border:1px solid var(--sd-w-bd,var(--sd-border));color:var(--sd-w-fg,var(--sd-text));border-radius:4px;padding:4px 8px;font-size:13px;box-sizing:border-box">
      </div>`,
      ok: {
        label: "Apply",
        callback: (event, button, dialog) =>
          Number(dialog.element.querySelector("input[name='cols']")?.value)
      },
      rejectClose: false
    }).catch(() => null);
    if (!n || !Number.isFinite(n)) return;
    const cols = Math.max(1, Math.min(9, Math.round(n)));
    const tabs = foundry.utils.deepClone(this.document.system.customTabs ?? []);
    const r = tabs.find(t => t.id === tabId)?.rows?.find(r => r.id === rowId);
    if (!r) return;
    r.cols = cols;
    (r.widgets ?? []).forEach(w => {
      if (w.type !== "vsection" && Number(w.span) > cols) w.span = cols;
    });
    await this.document.update({ "system.customTabs": tabs });
  }

  async _moveWidget(src, dst) {
    if (!src || !dst) return;
    const tabs = foundry.utils.deepClone(this.document.system.customTabs ?? []);
    const srcTab = tabs.find(t => t.id === src.tabId);
    const dstTab = tabs.find(t => t.id === dst.tabId);
    if (!srcTab || !dstTab) return;
    const srcRow = srcTab.rows?.find(r => r.id === src.rowId);
    if (!srcRow) return;
    const srcContainer = src.parentVsId
      ? (this._findVs(srcRow.widgets, src.parentVsId)?.widgets ?? [])
      : srcRow.widgets;
    const wIdx = srcContainer.findIndex(w => w.id === src.widgetId);
    if (wIdx < 0) return;
    const [moved] = srcContainer.splice(wIdx, 1);
    if (!moved) return;

    if (moved.type === "vsection" && dst.parentVsId) {
      dst = { ...dst, parentVsId: null };
    }

    let dstContainer;
    if (dst.rowId) {
      const dstRow = dstTab.rows?.find(r => r.id === dst.rowId);
      if (!dstRow) { srcContainer.splice(wIdx, 0, moved); return; }
      dstContainer = dst.parentVsId
        ? (this._findVs(dstRow.widgets, dst.parentVsId)?.widgets ?? null)
        : dstRow.widgets;
      if (!dstContainer) { srcContainer.splice(wIdx, 0, moved); return; }
    } else {
      const newRow = { id: foundry.utils.randomID(8), cols: 3, widgets: [] };
      dstTab.rows ??= [];
      dstTab.rows.push(newRow);
      dstContainer = newRow.widgets;
    }

    const insertIdx = dst.toEnd ? dstContainer.length : Math.max(0, Math.min(dstContainer.length, dst.index ?? dstContainer.length));
    dstContainer.splice(insertIdx, 0, moved);
    await this.document.update({ "system.customTabs": tabs });
  }

  _wireInventoryDropZones() {
    const root = this.element;
    if (!root) return;

    const con = root.querySelector(".sd-panels-container") ?? root.querySelector(".window-content");
    if (!con || con._sdDropWired) return;
    con._sdDropWired = true;

    con.addEventListener("dragover", ev => {
      const zone = ev.target.closest("[data-drop-zone='inventory'], [data-sd-slot-drop], .inventory-drop-zone");
      if (!zone) return;
      ev.preventDefault();
      zone.style.background   = "var(--sd-accent-glow)";
      zone.style.borderColor  = "var(--sd-accent)";
      zone.style.color        = "var(--sd-accent)";
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

      const data = CharacterSheet._readSdDragData(ev);
      if (!data) return;

      const target = this.document;

      if (zone.dataset.sdSlotDrop !== undefined) {
        const slotId = zone.dataset.sdSlotDrop;
        if (target instanceof Actor) {
          await CharacterSheet._handleSlotDrop(ev, target, slotId, data);
        }
        return;
      }

      if (target instanceof Actor) {
        await CharacterSheet._handleInventoryDrop(ev, target, data);
      }
    });
  }

  _wireHeaderInputs() {
    const root = this.element;
    if (!root || !this.isEditable) return;
    root.querySelector(".actor-name")?.addEventListener("change", async ev => {
      await this.document.update({ name: ev.target.value });
    });
    root.querySelector(".portrait-img")?.addEventListener("click", () => {
      const FP = foundry.applications?.apps?.FilePicker ?? globalThis.FilePicker;
      new FP({ type: "image", current: this.document.img, callback: p => this.document.update({ img: p }) }).render(true);
    });
  }

  _showEditModeBadge() {
    const root = this.element;
    if (!root) return;

    root.querySelector(".sd-edit-badge")?.remove();
    if (!this._editMode) return;

    const windowHeader = root.querySelector(".window-header") ?? root.querySelector("header");
    const badge = document.createElement("div");
    badge.className = "sd-edit-badge";
    badge.style.cssText = "position:absolute;top:4px;right:48px;background:var(--sd-accent);color:var(--sd-accent-text,#fff);font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;padding:2px 7px;border-radius:10px;z-index:100;pointer-events:none";
    badge.textContent = "EDIT MODE";

    if (windowHeader) {
      windowHeader.style.position = "relative";
      windowHeader.appendChild(badge);
    } else {
      const content = root.querySelector(".window-content");
      if (content) {
        content.style.position = "relative";
        content.prepend(badge);
      }
    }
  }

  static async _onEditImage(event, target) {
    const FP = foundry.applications?.apps?.FilePicker ?? globalThis.FilePicker;
    new FP({ type: "image", current: this.document.img, callback: p => this.document.update({ img: p }) }).render(true);
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


  static async _onOpenDatabase() {
    const { openDocumentValueDatabase } = await import("../helpers/value-database.mjs");
    await openDocumentValueDatabase(this.document);
  }

  static async _onOpenSheetAppearance() {
    await this._openSheetAppearanceDialog();
  }

  static async _onOpenSheetTriggers(event, target) {
    const { FormulaGraph } = await import("../builder/formula-graph.mjs");
    const graph = new FormulaGraph(null, this.document, null, null, null,
      { mode: "sheetTrigger" });
    graph.open();
  }

  static async _onOpenInteractions(event, target) {
    const { openInteractablesEditor } = await import("../helpers/interactables.mjs");
    openInteractablesEditor(this.document);
  }

  static async _onOpenAIBio(event, target) {
    const { openActorAIBioDialog } = await import("../helpers/ai-context.mjs");
    await openActorAIBioDialog(this.document);
  }

  static async _onToggleEditMode(event, target) {
    this._editMode = !this._editMode;
    this._buildTabNav();
    this._buildTabPanels();
    this._showEditModeBadge();
  }

  static _readSdDragData(ev) {
    let data;
    try { data = JSON.parse(ev.dataTransfer?.getData("text/plain") || "null"); }
    catch { return null; }
    if (!data || data.type !== "Item") return null;
    return data;
  }

  static async _resolveSlotHost(src) {
    if (!src) return null;
    const preferred = src.hostUuid || src.actorUuid;
    if (preferred) {
      try {
        const host = await fromUuid(preferred);
        if (host) return host;
      } catch {}
    }
    if (src.actorUuid) {
      try { return await fromUuid(src.actorUuid); } catch {}
    }
    return null;
  }

  static async _resolveSlotSnapshot(srcHost, slotId, index, hint = {}) {
    if (!srcHost) return null;
    const idx = Number.isFinite(Number(index)) ? Number(index) : 0;
    const direct = srcHost.system?.slotContents?.[slotId]?.contents?.[idx];
    if (direct) return direct;

    const actor = srcHost instanceof Actor ? srcHost : (srcHost?.actor ?? null);
    if (!actor) return null;
    const seen = new Set();
    const matchesHint = (entry) => {
      const refs = [entry?._sourceUuid, entry?.uuid, entry?._id, entry?.id, entry?.name]
        .filter(v => v != null).map(String);
      const wanted = [hint?.uuid, hint?._id, hint?.itemName]
        .filter(v => v != null && v !== "").map(String);
      return !wanted.length || wanted.some(v => refs.includes(v));
    };
    const walk = (host) => {
      if (!host || seen.has(host)) return null;
      seen.add(host);
      const arr = host.system?.slotContents?.[slotId]?.contents ?? [];
      if (arr[idx] && matchesHint(arr[idx])) return arr[idx];
      const hinted = arr.find(matchesHint);
      if (hinted) return hinted;
      for (const group of Object.values(host.system?.slotContents ?? {})) {
        for (const entry of (group?.contents ?? [])) {
          const nested = walk(entry);
          if (nested) return nested;
        }
      }
      return null;
    };
    const actorDirect = walk(actor);
    if (actorDirect) return actorDirect;
    for (const item of (actor.items ?? [])) {
      const nested = walk(item);
      if (nested) return nested;
    }
    return null;
  }

  static async _ensureSlotDef(actor, slotId) {
    const defs = actor.system.slotDefinitions ?? [];
    if (defs.find(d => d.id === slotId)) return;
    const allWidgets = (actor.system.customTabs ?? [])
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
    await actor.update({ "system.slotDefinitions": newDefs });
  }

  static async _handleSlotDrop(ev, targetActor, slotId, dragData) {
    if (!targetActor || !slotId || !dragData) return;
    const isShift = !!ev.shiftKey;
    const src = dragData.sdSrc ?? null;

    const { SlotManager } = await import("../data/item-slots.mjs");
    await CharacterSheet._ensureSlotDef(targetActor, slotId);

    if (src?.kind === "slot"
        && (src.hostUuid || src.actorUuid) === targetActor.uuid
        && src.slotId === slotId) return;

    let payload = null;
    if (src?.kind === "slot") {
      const srcHost = await CharacterSheet._resolveSlotHost(src);
      payload = await CharacterSheet._resolveSlotSnapshot(srcHost, src.slotId, src.index, {
        uuid: dragData.uuid,
        _id: dragData._id,
        itemName: src.itemName
      });
    } else if (dragData.uuid) {
      try { payload = await fromUuid(dragData.uuid); } catch { payload = null; }
    }
    if (!payload) return;

    const result = await SlotManager.addToSlot(targetActor, slotId, payload);
    if (!result) return;

    if (isShift) return;
    if (!src) return;

    if (src.kind === "inventory") {
      const srcActor = await fromUuid(src.actorUuid);
      const srcItem = srcActor?.items?.get(src.itemId);
      if (srcItem) await srcItem.delete();
    } else if (src.kind === "slot") {
      const srcHost = await CharacterSheet._resolveSlotHost(src);
      if (srcHost) await SlotManager.removeFromSlot(srcHost, src.slotId, src.index);
    }
  }

  static async _handleInventoryDrop(ev, targetActor, dragData) {
    if (!targetActor || !dragData) return;
    const isShift = !!ev.shiftKey;
    const src = dragData.sdSrc ?? null;

    if (src?.kind === "inventory" && src.actorUuid === targetActor.uuid) return;

    let payloadData = null;
    let liveItem = null;

    if (src?.kind === "slot") {
      const srcHost = await CharacterSheet._resolveSlotHost(src);
      payloadData = await CharacterSheet._resolveSlotSnapshot(srcHost, src.slotId, src.index, {
        uuid: dragData.uuid,
        _id: dragData._id,
        itemName: src.itemName
      });
    } else if (dragData.uuid) {
      try { liveItem = await fromUuid(dragData.uuid); } catch { liveItem = null; }
      if (liveItem) payloadData = liveItem.toObject();
    } else if (dragData._id) {
      liveItem = game.items?.get(dragData._id) ?? null;
      if (liveItem) payloadData = liveItem.toObject();
    }
    if (!payloadData) return;

    if (payloadData.type === "ability") {
      ui.notifications?.warn?.("Ability items belong in a Spellbook widget, not Inventory.");
      return;
    }
    if (payloadData.type && payloadData.type !== "inventory") {
      ui.notifications?.warn?.(`Items of type "${payloadData.type}" cannot be placed in Inventory.`);
      return;
    }

    const cleaned = foundry.utils.deepClone(payloadData);
    delete cleaned._id;
    delete cleaned._sourceUuid;
    delete cleaned._slotId;
    delete cleaned._slotIndex;

    const created = await targetActor.createEmbeddedDocuments("Item", [cleaned]);
    if (!created?.length) return;

    ui.notifications?.info?.(`${isShift ? "Copied" : "Added"} "${cleaned.name}" to ${targetActor.name}`);

    if (isShift) return;
    if (!src) return;

    if (src.kind === "inventory") {
      const srcActor = await fromUuid(src.actorUuid);
      const srcItem = srcActor?.items?.get(src.itemId);
      if (srcItem) await srcItem.delete();
    } else if (src.kind === "slot") {
      const srcHost = await CharacterSheet._resolveSlotHost(src);
      if (srcHost) {
        const { SlotManager } = await import("../data/item-slots.mjs");
        await SlotManager.removeFromSlot(srcHost, src.slotId, src.index);
      }
    }
  }
}


/**
 * Cycle an item-owned Active Effect between three modes:
 *  1) transfers to actor (always active),
 *  2) on actor only while the item is equipped (equippable inventory items),
 *  3) item only (no transfer).
 */
async function _sdCycleEffectMode(ef) {
  const item = ef?.parent;
  if (!item || item.documentName !== "Item") {
    ui.notifications?.warn?.(_sdLoc(
      "SD.Effects.OnlyOnItems",
      "Effect modes can only be changed on effects owned by an item."
    ));
    return;
  }

  const explicit = ef.flags?.sd?.effectTransferMode;
  const current = ["always", "equipped", "item"].includes(explicit)
    ? explicit
    : (ef.transfer === false ? "item" : (ef.flags?.sd?.activateOnEquip ? "equipped" : "always"));
  const canEquipGate = item.type === "inventory";

  if (current === "item") {
    await ef.update({
      transfer: true,
      disabled: false,
      "flags.sd.activateOnEquip": false,
      "flags.sd.effectTransferMode": "always"
    });
    ui.notifications?.info?.(_sdLoc(
      "SD.Effects.ModeChangedAlways",
      `“${ef.name}”: always transfers to the actor.`,
      { name: ef.name }
    ));
    return;
  }

  if (current === "always" && canEquipGate) {
    if (item.system?.equippable !== true) {
      try {
        await item.update({ "system.equippable": true });
        ui.notifications?.info?.(_sdLoc(
          "SD.Effects.AutoEquippable",
          `“${item.name}” is now marked Equippable.`,
          { name: item.name }
        ));
      } catch (err) {
        console.warn("SD | could not mark the item equippable:", err);
      }
    }
    await ef.update({
      transfer: true,
      disabled: item.system?.equipped !== true,
      "flags.sd.activateOnEquip": true,
      "flags.sd.effectTransferMode": "equipped"
    });
    ui.notifications?.info?.(_sdLoc(
      "SD.Effects.ModeChangedEquipped",
      `“${ef.name}”: transfers only while “${item.name}” is equipped.`,
      { name: ef.name, item: item.name }
    ));
    return;
  }

  await ef.update({
    transfer: false,
    disabled: false,
    "flags.sd.activateOnEquip": false,
    "flags.sd.effectTransferMode": "item"
  });
  ui.notifications?.info?.(_sdLoc(
    "SD.Effects.ModeChangedItemOnly",
    `“${ef.name}”: remains on the item and does not transfer.`,
    { name: ef.name }
  ));
  if (current === "always" && !canEquipGate) {
    ui.notifications?.warn?.(_sdLoc(
      "SD.Effects.EquippedOnlyInventory",
      "Only inventory items can use the equipped-only mode."
    ));
  }
}
