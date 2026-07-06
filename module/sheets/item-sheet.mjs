import { SlotManager }    from "../data/item-slots.mjs";
import { ButtonExecutor } from "../helpers/button-executor.mjs";
import { WidgetRenderer } from "../builder/widget-renderer.mjs";
import { editEffectViaStandardConfig, openItemSheetFromSnapshot } from "../helpers/effect-editor.mjs";
import { effectDurationLabel } from "../helpers/effect-duration.mjs";
import { RichTextEditor } from "../helpers/richtext-editor.mjs";
import { AutoanimationsIntegration } from "../integrations/autoanimations.mjs";

const { ItemSheetV2 } = foundry.applications.sheets;
const { HandlebarsApplicationMixin } = foundry.applications.api;

const SD_SLOT_ICON_PRESETS = [
  { name: "helmet",   label: "Helmet" },
  { name: "armor",    label: "Armor" },
  { name: "cape",     label: "Cape" },
  { name: "necklace", label: "Necklace" },
  { name: "belt",     label: "Belt" },
  { name: "glove",    label: "Glove" },
  { name: "pants",    label: "Pants" },
  { name: "boots",    label: "Boots" },
  { name: "ring",     label: "Ring" },
  { name: "bow",      label: "Bow" },
  { name: "shield",   label: "Shield" },
  { name: "quiver",   label: "Quiver" }
];
const SD_SLOT_ICON_PATH = name => `systems/sd/assets/slot-icons/${name}.svg`;

Hooks.once("ready", () => {
  globalThis._SD_SLOTS = { SlotManager };
});

const LOCKED_HIDDEN_FIELDS = {
  ability: [
    { key: "type",     default: "", placeholder: "spell / technique / power" },
    { key: "cost",     default: "", placeholder: "0" },
    { key: "pathUses", default: "", placeholder: "system.resources.mp" }
  ]
};

function _lockedKeysForType(t) {
  return (LOCKED_HIDDEN_FIELDS[t] ?? []).map(f => f.key);
}

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
      content: `<div style="padding:6px 0"><input type="text" name="tabName" value="${esc(current)}" style="width:100%;background:var(--sd-bg-3);border:1px solid var(--sd-border);color:var(--sd-text);border-radius:4px;padding:4px 8px;font-size:13px" autofocus></div>`,
      buttons: [
        { action:"save", label:"Save", icon:"fas fa-floppy-disk", default:true,
          callback:(ev,btn)=>{ resolve(readInput(btn)); } },
        { action:"cancel", label:"Cancel", icon:"fas fa-xmark",
          callback:()=>resolve(null) }
      ],
      submit: () => {}
    }).render(true);
  });
}

async function _chooseNumberWidgetMode() {
  const mode = await foundry.applications.api.DialogV2.wait({
    modal: true,
    window: { title: "Number Widget" },
    content: `<div style="padding:8px 0;font-size:12px;color:var(--sd-text-2);line-height:1.4">Choose Number widget version.</div>`,
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

export class SDItemSheet extends HandlebarsApplicationMixin(ItemSheetV2) {

  static DEFAULT_OPTIONS = {
    classes: ["sd", "sheet", "item"],
    position: { width: 620, height: 560 },
    window: {
      resizable: true,
      controls: [
        { icon: "fas fa-toolbox",   label: "Sheet Builder",    action: "openBuilder"       },
        { icon: "fas fa-bolt",      label: "Sheet Triggers",   action: "openSheetTriggers" },
        { icon: "fas fa-pen-ruler", label: "Toggle Edit Mode", action: "toggleEditMode"    }
      ]
    },
    actions: {
      openBuilder:       SDItemSheet._onOpenBuilder,
      openSheetTriggers: SDItemSheet._onOpenSheetTriggers,
      toggleEditMode:    SDItemSheet._onToggleEditMode,
      editImage:         SDItemSheet._onEditImage,
      useItem:           SDItemSheet._onUseItem,
      fireButton:        SDItemSheet._onFireButton,
      toggleEquipped:    SDItemSheet._onToggleEquipped,
    },
    form: { submitOnChange: true }
  };

  static PARTS = {
    header: { template: "systems/sd/templates/item/parts/header.hbs" },
    canvas: { template: "systems/sd/templates/actor/sheet-canvas.hbs" }
  };

  tabGroups = { sheet: "" };
  _editMode = false;

  get title() { return this.document.name; }

  async _prepareContext(options) {
    const base = await super._prepareContext(options);
    return { ...base, item: this.document, system: this.document.system, isEditable: this.isEditable, editMode: this._editMode, isInventory: this.document.type === "inventory", isAbility: this.document.type === "ability" };
  }

  _onRender(context, options) {
    this._buildTabNav();
    this._buildTabPanels();
    this._wireHeaderInputs();
    this._showEditModeBadge();
    this._wireAllDropZones();
    this._wireAllInteractions();
  }

  _onChangeForm(formConfig, event) {
    const t = event?.target;

    if (t?.closest?.(".richtext-editor, .richtext-edit-wrap, .sd-wcfg-popup, prose-mirror, .sd-richtext-pm-target, .sd-richtext-editor, .editor.prosemirror, .ProseMirror, .prosemirror-menu")) return;
    if (t?.tagName?.toLowerCase?.() === "prose-mirror") return;
    return super._onChangeForm(formConfig, event);
  }

  _buildTabNav() {
    const root = this.element;
    if (!root) return;
    let nav = root.querySelector(".sd-tab-nav");
    if (!nav) {
      nav = document.createElement("nav");
      nav.className = "sd-tab-nav";
      nav.style.cssText = "display:flex;flex-wrap:wrap;gap:2px;padding:5px 12px 0;background:var(--sd-bg-2);border-bottom:1px solid var(--sd-border);flex-shrink:0;align-items:flex-end;";
      root.querySelector(".window-content")?.appendChild(nav);
    }
    nav.innerHTML = "";

    const customTabs = this.document.system.customTabs ?? [];
    const itemType   = this.document.type;
    const sysTabs    = itemType === "ability"
      ? ["_sys_attrs","_sys_graph","_sys_effects"]
      : itemType === "class"
        ? ["_sys_class"]
        : itemType === "skilltree"
          ? ["_sys_skilltree"]
          : itemType === "inventory"
            ? ["_sys_attrs","_sys_graph","_sys_effects"]
            : ["_sys_attrs","_sys_graph"];
    const allIds     = [...customTabs.map(t=>t.id), ...sysTabs];
    if (!this.tabGroups.sheet || !allIds.includes(this.tabGroups.sheet)) {
      this.tabGroups.sheet = customTabs[0]?.id ?? sysTabs[0];
    }
    const active = this.tabGroups.sheet;

    customTabs.forEach(tab => nav.appendChild(this._mkTabBtn(tab.id, tab.label, active===tab.id, false)));

    if (this._editMode) {
      const plus = document.createElement("a");
      plus.style.cssText = "padding:4px 10px;font-size:11px;cursor:pointer;border-radius:4px 4px 0 0;border:1px dashed var(--sd-accent);border-bottom:none;color:var(--sd-accent);opacity:.6;display:inline-flex;align-items:center;transition:opacity .15s;";
      plus.innerHTML = '<i class="fas fa-plus"></i>';
      plus.title = "Add tab";
      plus.addEventListener("click",     () => this._addTab());
      plus.addEventListener("dragover",  ev => { ev.preventDefault(); plus.style.opacity="1"; plus.style.background="var(--sd-accent-glow)"; });
      plus.addEventListener("dragleave", () => { plus.style.opacity=".6"; plus.style.background=""; });
      plus.addEventListener("drop",      ev => { ev.preventDefault(); plus.style.opacity=".6"; plus.style.background=""; try { const d=JSON.parse(ev.dataTransfer.getData("text/plain")); if(d.sdType==="newTab") this._addTab(); } catch { this._addTab(); }});
      nav.appendChild(plus);
    }

    const spacer = document.createElement("div"); spacer.style.flex="1"; nav.appendChild(spacer);

    const tplBtn = document.createElement("a");
    tplBtn.style.cssText = "padding:4px 9px;font-size:10px;cursor:pointer;border-radius:4px 4px 0 0;border:1px solid var(--sd-border);border-bottom:none;color:var(--sd-text-2);background:transparent;display:inline-flex;align-items:center;gap:4px;white-space:nowrap;margin-right:4px;";
    tplBtn.innerHTML = `<i class="fas fa-floppy-disk"></i> Template`;
    tplBtn.title = "Save sheet layout as template (use Sheet Builder → Templates → Create)";
    tplBtn.addEventListener("click", () => this._saveAsTemplate());
    nav.appendChild(tplBtn);

    const hidesExtras = this.document.type === "class" || this.document.type === "skilltree";

    if (!hidesExtras) {
      const macroBtn = document.createElement("a");
      macroBtn.style.cssText = "padding:4px 9px;font-size:10px;cursor:pointer;border-radius:4px 4px 0 0;border:1px solid var(--sd-border);border-bottom:none;color:var(--sd-text-2);background:transparent;display:inline-flex;align-items:center;gap:4px;white-space:nowrap;margin-right:4px;";
      macroBtn.innerHTML = `<i class="fas fa-wand-magic-sparkles"></i> Macro`;
      macroBtn.title = "Create a hotbar macro to quickly use this item";
      macroBtn.addEventListener("click", () => this._createMacro());
      nav.appendChild(macroBtn);
    }

    const sysNavItems = [
      ...(this.document.type === "class"     ? [{id:"_sys_class",    label:"<i class='fas fa-arrow-circle-up' style='margin-right:4px'></i>Levels"}]    : []),
      ...(this.document.type === "skilltree" ? [{id:"_sys_skilltree",label:"<i class='fas fa-project-diagram' style='margin-right:4px'></i>Skill Tree"}] : []),
      ...(hidesExtras ? [] : [
        {id:"_sys_attrs", label:"<i class='fas fa-eye-slash' style='margin-right:4px'></i>Hidden Fields"},
        {id:"_sys_graph", label:"<i class='fas fa-project-diagram' style='margin-right:4px'></i>On Click"},
      ]),
    ];
    if (this.document.type === "ability" || this.document.type === "inventory") {
      sysNavItems.push({id:"_sys_effects", label:"<i class='fas fa-sparkles' style='margin-right:4px'></i>Effects"});
    }
    sysNavItems.forEach(t => nav.appendChild(this._mkTabBtn(t.id, t.label, active===t.id, true)));
  }

  _mkTabBtn(tabId, labelHTML, isActive, isSys) {
    const a = document.createElement("a");
    a.className     = "sd-tab-btn" + (isSys?" sd-tab-sys":"");
    a.dataset.tabId = tabId;
    a.innerHTML     = labelHTML;
    a.style.cssText = `padding:4px ${isSys?"9":"10"}px;font-size:${isSys?"10":"11"}px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;cursor:pointer;border-radius:4px 4px 0 0;border:1px solid ${isActive?"var(--sd-border)":"transparent"};border-bottom:none;color:${isActive?(isSys?"var(--sd-stamina)":"var(--sd-accent)"):(isSys?"#444":"#666")};background:${isActive?"var(--sd-bg)":"transparent"};display:inline-flex;align-items:center;gap:2px;white-space:nowrap;user-select:none;`;
    if (this._editMode && !isSys) {
      a.innerHTML += ` <span data-rename="${tabId}" style="opacity:.3;font-size:9px;cursor:pointer" title="Rename">✎</span><span data-deltab="${tabId}" style="opacity:.3;font-size:9px;cursor:pointer" title="Delete">✕</span>`;
    }
    a.addEventListener("click", ev => {
      if (ev.target.dataset.rename) { ev.stopPropagation(); this._renameTab(tabId); return; }
      if (ev.target.dataset.deltab) { ev.stopPropagation(); this._deleteTab(tabId); return; }
      this._switchTab(tabId);
    });
    return a;
  }

  _switchTab(tabId) {
    this.tabGroups.sheet = tabId;
    const root = this.element;
    root.querySelectorAll(".sd-tab-btn").forEach(a => {
      const on   = a.dataset.tabId === tabId;
      const isSys = a.classList.contains("sd-tab-sys");
      a.style.color       = on ? (isSys?"var(--sd-stamina)":"var(--sd-accent)") : (isSys?"#444":"#666");
      a.style.background  = on ? "var(--sd-bg)" : "transparent";
      a.style.borderColor = on ? "var(--sd-border)" : "transparent";
    });
    root.querySelectorAll(".sd-tab-panel").forEach(p => {
      p.style.display = p.dataset.tabId===tabId ? "flex" : "none";
    });
  }

  _buildTabPanels() {
    const root = this.element;
    if (!root) return;
    let con = root.querySelector(".sd-panels-container");
    if (!con) {
      con = document.createElement("div");
      con.className = "sd-panels-container";
      con.style.cssText = "flex:1;display:flex;flex-direction:column;min-height:0;overflow:hidden;position:relative;";
      root.querySelector(".window-content")?.appendChild(con);
    }
    con.innerHTML = "";

    const customTabs = this.document.system.customTabs ?? [];
    const active     = this.tabGroups.sheet;

    if (customTabs.length===0 && active==="" ) {
      const emp = document.createElement("div");
      emp.style.cssText = "flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;color:var(--sd-text-3);";
      emp.innerHTML = `<i class="fas fa-toolbox" style="font-size:36px;opacity:.3"></i><p style="font-size:13px;text-align:center;max-width:240px;line-height:1.6;margin:0">Click <strong style="color:var(--sd-accent)">Builder</strong> → drag <strong>New Tab</strong> onto <strong style="color:var(--sd-accent)">+</strong></p>`;
      con.appendChild(emp);
    }

    customTabs.forEach(tab => {
      const panel = document.createElement("div");
      panel.className="sd-tab-panel"; panel.dataset.tabId=tab.id;
      panel.style.cssText=`display:${active===tab.id?"flex":"none"};flex:1;overflow-y:auto;padding:12px 14px;flex-direction:column;gap:8px;min-height:0;`;
      (tab.rows??[]).forEach(row => panel.appendChild(this._buildRow(tab,row)));
      if (this._editMode) panel.appendChild(this._mkWidgetDZ(tab,null,"Drop a widget here to add row"));
      con.appendChild(panel);
    });

    if (this.document.type === "class")     con.appendChild(this._buildClassPanel(active==="_sys_class"));
    if (this.document.type === "skilltree") con.appendChild(this._buildSkilltreePanel(active==="_sys_skilltree"));
    if (this.document.type !== "class" && this.document.type !== "skilltree") {
      con.appendChild(this._buildSysAttrsPanel(active==="_sys_attrs"));
      con.appendChild(this._buildSysGraphPanel(active==="_sys_graph"));
    }
    con.appendChild(this._buildSysEffectsPanel(active==="_sys_effects"));
  }

  _buildRow(tab, row) {
    const cols = Math.max(1, Math.min(9, Number(row.cols) || 3));
    const el = document.createElement("div");
    el.dataset.rowId=row.id; el.dataset.tabId=tab.id; el.dataset.cols=cols;
    el.style.cssText=`display:grid;grid-template-columns:repeat(${cols},1fr);gap:8px;align-items:start;position:relative;padding:8px;border:1px dashed var(--sd-accent-glow);border-radius:6px;`;
    if (this._editMode) {
      const cfg=document.createElement("button"); cfg.type="button"; cfg.innerHTML=`<i class="fas fa-cog"></i> ${cols}`; cfg.title="Row columns (1-9)";
      cfg.style.cssText="position:absolute;top:-9px;right:32px;z-index:10;background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:3px;color:var(--sd-accent);cursor:pointer;font-size:10px;padding:0 6px;line-height:17px;";
      cfg.addEventListener("click",()=>this._configRow(tab.id,row.id)); el.appendChild(cfg);
      const del=document.createElement("button"); del.type="button"; del.textContent="✕"; del.title="Delete row";
      del.style.cssText="position:absolute;top:-9px;right:4px;z-index:10;background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:3px;color:var(--sd-text-3);cursor:pointer;font-size:10px;padding:0 5px;line-height:17px;";
      del.addEventListener("click",()=>this._deleteRow(tab.id,row.id)); el.appendChild(del);
    }
    (row.widgets??[]).forEach((w, idx)=>el.appendChild(this._buildCell(tab,row,w,idx)));
    if (this._editMode) el.appendChild(this._mkWidgetDZ(tab,row,"Drop widget here"));
    return el;
  }

  _buildCell(tab, row, w, idx = 0, parentVS = null) {
    const rowCols = Math.max(1, Math.min(9, Number(row.cols) || 3));
    const span = Math.max(1, Math.min(parentVS ? 1 : rowCols, Number(w.span) || 1));
    const cell=document.createElement("div");
    cell.dataset.widgetId=w.id; cell.dataset.rowId=row.id; cell.dataset.tabId=tab.id;
    if (parentVS) cell.dataset.parentVsId = parentVS.id;
    cell.dataset.widgetIdx = idx;
    cell.style.cssText=`grid-column:${parentVS ? "auto" : `span ${span}`};position:relative;min-width:0;`;

    if (w.type === "vsection") {
      cell.innerHTML = "";
      cell.appendChild(this._buildVSection(tab, row, w));
      if (this._editMode) {
        this._makeCellDraggable(cell, tab, row, w, parentVS);
        this._attachCellOverlay(cell, tab, row, w, span, parentVS);
      }
      return cell;
    }

    let renderedHtml = "";
    try { renderedHtml = WidgetRenderer.render(w,this.document,this._editMode) ?? ""; }
    catch(e) { renderedHtml = `<div style="color:var(--sd-hp);font-size:11px">Error: ${e.message}</div>`; }
    if (!renderedHtml?.trim() && !this._editMode) {
      cell.style.display = "none";
      return cell;
    }
    cell.innerHTML = renderedHtml;

    if (this._editMode) {
      this._makeCellDraggable(cell, tab, row, w, parentVS);
      this._attachCellOverlay(cell, tab, row, w, span, parentVS);
    }
    return cell;
  }

  _buildVSection(tab, row, vs) {
    const box = document.createElement("div");
    box.dataset.vsId = vs.id;
    box.style.cssText = "display:flex;flex-direction:column;gap:6px;padding:6px;border:1px dashed var(--sd-accent-glow);border-radius:5px;background:rgba(123,104,238,.03);min-height:40px;";
    if (vs.label) {
      const h=document.createElement("div"); h.textContent = vs.label;
      h.style.cssText="font-size:10px;font-weight:700;color:var(--sd-accent);text-transform:uppercase;letter-spacing:.05em;padding:2px 0 4px";
      box.appendChild(h);
    }
    (vs.widgets ?? []).forEach((cw, idx) => { box.appendChild(this._buildCell(tab, row, cw, idx, vs)); });
    if (this._editMode) box.appendChild(this._mkWidgetDZ(tab, row, "Drop widget into section", vs));
    return box;
  }

  _makeCellDraggable(cell, tab, row, w, parentVS) {
    cell.draggable = true;
    cell.addEventListener("dragstart", ev => {
      ev.stopPropagation();
      try {
        ev.dataTransfer.setData("text/plain", JSON.stringify({
          sdType: "widget-move",
          tabId: tab.id, rowId: row.id, widgetId: w.id,
          parentVsId: parentVS?.id ?? null
        }));
        ev.dataTransfer.effectAllowed = "move";
      } catch {}
      cell.style.opacity = "0.4";
    });
    cell.addEventListener("dragend", () => { cell.style.opacity = ""; });
  }

  _attachCellOverlay(cell, tab, row, w, span, parentVS) {
    const ov=document.createElement("div");
    ov.style.cssText="display:none;position:absolute;top:2px;left:2px;right:2px;z-index:20;flex-direction:row;align-items:center;justify-content:space-between;gap:6px;pointer-events:none;";
    const spanBtn = parentVS ? ""
      : `<button type="button" data-wspan="1" style="pointer-events:auto;background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:3px;color:var(--sd-text-2);cursor:pointer;font-size:10px;padding:0 5px;line-height:18px" title="Cycle width">↔${span}</button>`;
    ov.innerHTML=`<div style="display:flex;flex-direction:row;gap:2px;align-items:center"><span title="Drag to move" style="pointer-events:auto;cursor:grab;background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:3px;color:var(--sd-text-2);font-size:10px;padding:0 5px;line-height:18px">⋮⋮</span><button type="button" data-wcfg="1" style="pointer-events:auto;background:var(--sd-bg);border:1px solid var(--sd-accent);border-radius:3px;color:var(--sd-accent);cursor:pointer;font-size:10px;padding:0 5px;line-height:18px" title="Configure">⚙</button>${spanBtn}</div><div style="display:flex;flex-direction:row;gap:2px;align-items:center"><button type="button" data-wdel="1" style="pointer-events:auto;background:var(--sd-bg);border:1px solid var(--sd-hp);border-radius:3px;color:var(--sd-hp);cursor:pointer;font-size:10px;padding:0 5px;line-height:18px" title="Remove">✕</button></div>`;
    ov.querySelector("[data-wcfg]").addEventListener("click",ev=>{ev.stopPropagation();this._configWidget(tab,row,w);});
    ov.querySelector("[data-wspan]")?.addEventListener("click",ev=>{ev.stopPropagation();this._cycleSpan(tab,row,w);});
    ov.querySelector("[data-wdel]").addEventListener("click", ev=>{ev.stopPropagation();this._deleteWidget(tab,row,w);});
    cell.addEventListener("mouseenter",()=>ov.style.display="flex");
    cell.addEventListener("mouseleave",()=>ov.style.display="none");
    cell.appendChild(ov);
  }

  _e(s) { return String(s??"").replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;"); }

  _buildClassPanel(isActive) {
    const p   = this._mkSysPanel("_sys_class", isActive);
    const ed  = this.isEditable;
    const sys = this.document.system;
    const e   = this._e.bind(this);
    const levels = sys.levels ?? [];

    const toolbar = document.createElement("div");
    toolbar.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap;";
    toolbar.innerHTML = `
      <span style="font-size:12px;font-weight:700;color:var(--sd-text-2);flex:1">
        <i class="fas fa-arrow-circle-up" style="color:var(--sd-accent);margin-right:5px"></i>Level Progression</span>
      ${ed ? `<button type="button" id="cls-add-level"
        style="padding:4px 10px;background:var(--sd-accent-glow);border:1px solid var(--sd-accent);border-radius:4px;
               color:var(--sd-accent);cursor:pointer;font-size:11px;font-weight:600">
        <i class="fas fa-plus"></i> Add Level</button>` : ""}`;
    p.appendChild(toolbar);

    const list = document.createElement("div");
    list.id = "cls-level-list";
    list.style.cssText = "display:flex;flex-direction:column;gap:8px;";

    if (!levels.length) {
      list.innerHTML = `<p style="color:var(--sd-text-3);font-size:12px;font-style:italic;text-align:center;padding:20px 0">
        ${ed ? "Click \"Add Level\" to create the first level." : "No levels defined yet."}</p>`;
    }

    levels.forEach((lv, idx) => this._renderClassLevel(list, lv, idx, ed));
    p.appendChild(list);

    p.querySelector("#cls-add-level")?.addEventListener("click", async () => {
      const lvls  = foundry.utils.deepClone(this.document.system.levels ?? []);
      const next  = (lvls[lvls.length-1]?.level ?? 0) + 1;
      lvls.push({ id: foundry.utils.randomID(8), level: next, label: "", items: [], effects: [], fieldChanges: [] });
      await this.document.update({ "system.levels": lvls });
    });

    this._wireClassDropZones(p);
    return p;
  }

  _renderClassLevel(container, lv, idx, ed) {
    const e    = this._e.bind(this);
    const wrap = document.createElement("div");
    wrap.dataset.levelIdx = idx;
    wrap.style.cssText = "background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:6px;overflow:hidden;";

    const hdr = document.createElement("div");
    hdr.style.cssText = "display:flex;align-items:center;gap:8px;padding:7px 10px;background:var(--sd-accent-glow);border-bottom:1px solid var(--sd-bg-3);";
    hdr.innerHTML = `
      <span style="font-size:11px;font-weight:700;color:var(--sd-accent);white-space:nowrap">
        <i class="fas fa-chevron-up"></i> Level ${lv.level}</span>
      ${ed ? `<input type="number" class="cls-lv-num" data-idx="${idx}" value="${lv.level}" min="1"
                style="width:52px;background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:3px;
                       color:var(--sd-text);font-size:11px;padding:2px 5px;text-align:center">
               <input type="text" class="cls-lv-label" data-idx="${idx}" value="${e(lv.label ?? "")}"
                placeholder="Label…"
                style="flex:1;background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:3px;
                       color:var(--sd-text);font-size:11px;padding:2px 6px">
               <button type="button" class="cls-del-level" data-idx="${idx}"
                 style="background:none;border:none;color:var(--sd-text-3);cursor:pointer;font-size:12px;padding:0 4px">
                 <i class="fas fa-trash"></i></button>`
             : `<span style="flex:1;font-size:11px;color:var(--sd-text-3);font-style:italic">${e(lv.label ?? "")}</span>`}`;
    wrap.appendChild(hdr);

    const grid = document.createElement("div");
    grid.style.cssText = "display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;padding:10px;";

    const itemsCol = document.createElement("div");
    itemsCol.innerHTML = `<div style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--sd-text-3);letter-spacing:.06em;margin-bottom:5px">
      <i class="fas fa-backpack"></i> Items</div>`;
    const itemsZone = document.createElement("div");
    itemsZone.className = "cls-items-zone";
    itemsZone.dataset.levelIdx = idx;
    itemsZone.style.cssText = `min-height:36px;border:1px dashed ${ed ? "var(--sd-border)" : "transparent"};border-radius:4px;padding:4px;display:flex;flex-direction:column;gap:3px;`;
    if (ed) itemsZone.innerHTML = `<span style="font-size:10px;color:var(--sd-text-3);text-align:center;padding:4px">Drop items here</span>`;
    (lv.items ?? []).forEach((it, j) => {
      const chip = document.createElement("div");
      chip.style.cssText = "display:flex;align-items:center;gap:4px;background:var(--sd-bg);border:1px solid var(--sd-bg-3);border-radius:3px;padding:2px 5px;font-size:10px;color:var(--sd-text-2);cursor:context-menu;";
      chip.title = "Right-click to open item";
      chip.dataset.snapshotRef = `cls:${idx}:${j}`;
      chip.innerHTML = `<img src="${e(it.img ?? "icons/svg/item-bag.svg")}" style="width:14px;height:14px;border-radius:2px;object-fit:cover">
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${e(it.name ?? "Item")}</span>
        ${ed ? `<button type="button" class="cls-del-item" data-level-idx="${idx}" data-item-idx="${j}"
          style="background:none;border:none;color:var(--sd-text-3);cursor:pointer;font-size:10px;padding:0 1px">✕</button>` : ""}`;
      chip.addEventListener("contextmenu", async ev => {
        ev.preventDefault();
        ev.stopPropagation();
        const snap = (this.document.system.levels?.[idx]?.items ?? [])[j];
        if (snap) await openItemSheetFromSnapshot(snap, this.document.parent ?? null);
      });
      itemsZone.appendChild(chip);
      if (ed) { const hint = itemsZone.querySelector("span"); if (hint) hint.remove(); }
    });
    itemsCol.appendChild(itemsZone);

    const fcCol = document.createElement("div");
    fcCol.innerHTML = `<div style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--sd-text-3);letter-spacing:.06em;margin-bottom:5px;display:flex;align-items:center;gap:4px">
      <i class="fas fa-sliders-h"></i> Field Changes
      ${ed ? `<button type="button" class="cls-add-fc" data-level-idx="${idx}"
        style="margin-left:auto;background:none;border:none;color:var(--sd-accent);cursor:pointer;font-size:11px">+</button>` : ""}</div>`;
    const fcList = document.createElement("div");
    fcList.style.cssText = "display:flex;flex-direction:column;gap:3px;";
    (lv.fieldChanges ?? []).forEach((fc, j) => {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;align-items:center;gap:2px;";
      if (ed) {
        row.innerHTML = `
          <input type="text" class="cls-fc-path" data-level-idx="${idx}" data-fc-idx="${j}" value="${e(fc.path)}"
            placeholder="system.resources.hp.max"
            style="flex:1;min-width:0;background:var(--sd-bg);border:1px solid var(--sd-bg-3);border-radius:3px;color:var(--sd-accent);font-size:9px;font-family:monospace;padding:2px 4px">
          <select class="cls-fc-mode" data-level-idx="${idx}" data-fc-idx="${j}"
            style="background:var(--sd-bg);border:1px solid var(--sd-bg-3);border-radius:3px;color:var(--sd-accent);font-size:11px;font-weight:700;padding:2px 2px">
            <option value="add" ${fc.mode==="add"?"selected":""}>+</option>
            <option value="set" ${fc.mode==="set"?"selected":""}>=</option>
            <option value="multiply" ${fc.mode==="multiply"?"selected":""}>×</option>
          </select>
          <input type="text" class="cls-fc-val" data-level-idx="${idx}" data-fc-idx="${j}" value="${e(fc.value)}"
            style="width:36px;background:var(--sd-bg);border:1px solid var(--sd-bg-3);border-radius:3px;color:var(--sd-text);font-size:10px;padding:2px 3px;text-align:center">
          <button type="button" class="cls-del-fc" data-level-idx="${idx}" data-fc-idx="${j}"
            style="background:none;border:none;color:var(--sd-text-3);cursor:pointer;font-size:10px;padding:0 1px">✕</button>`;
        row.innerHTML = row.innerHTML.replace('%', '');
      } else {
        const sym = fc.mode === "set" ? "=" : fc.mode === "multiply" ? "×" : "+";
        row.innerHTML = `<code style="font-size:9px;color:var(--sd-accent);flex:1">${e(fc.path)}</code>
          <span style="color:var(--sd-accent);font-weight:700;padding:0 3px">${sym}</span>
          <strong style="font-size:11px">${e(fc.value)}</strong>`;
      }
      fcList.appendChild(row);
    });
    if (!(lv.fieldChanges ?? []).length) fcList.innerHTML = `<span style="font-size:10px;color:var(--sd-text-3);font-style:italic">—</span>`;
    fcCol.appendChild(fcList);

    const efCol = document.createElement("div");
    efCol.innerHTML = `<div style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--sd-text-3);letter-spacing:.06em;margin-bottom:5px;display:flex;align-items:center;gap:4px">
      <i class="fas fa-magic"></i> Effects
      ${ed ? `<button type="button" class="cls-add-ef" data-level-idx="${idx}"
        style="margin-left:auto;background:none;border:none;color:var(--sd-accent);cursor:pointer;font-size:11px">+</button>` : ""}</div>`;
    const efList = document.createElement("div");
    efList.style.cssText = "display:flex;flex-direction:column;gap:3px;";
    (lv.effects ?? []).forEach((ef, j) => {
      const chip = document.createElement("div");
      chip.style.cssText = "display:flex;align-items:center;gap:4px;background:var(--sd-bg);border:1px solid var(--sd-bg-3);border-radius:3px;padding:2px 5px;font-size:10px;color:var(--sd-text-2);";
      chip.innerHTML = `<img src="${e(ef.icon ?? ef.img ?? "icons/svg/aura.svg")}" style="width:14px;height:14px;border-radius:2px">
        <span style="flex:1${ef.disabled ? ";opacity:.5;text-decoration:line-through" : ""}">${e(ef.name ?? "Effect")}</span>
        ${(ef.changes ?? []).length ? `<span style="font-size:9px;color:var(--sd-text-3)" title="Changes">${(ef.changes ?? []).length}</span>` : ""}
        ${ed ? `<button type="button" class="cls-edit-ef" data-level-idx="${idx}" data-ef-idx="${j}" title="Edit effect"
          style="background:none;border:none;color:var(--sd-text-3);cursor:pointer;font-size:10px"><i class="fas fa-pen"></i></button>` : ""}
        ${ed ? `<button type="button" class="cls-del-ef" data-level-idx="${idx}" data-ef-idx="${j}"
          style="background:none;border:none;color:var(--sd-text-3);cursor:pointer;font-size:10px">✕</button>` : ""}`;
      efList.appendChild(chip);
    });
    if (!(lv.effects ?? []).length) efList.innerHTML = `<span style="font-size:10px;color:var(--sd-text-3);font-style:italic">—</span>`;
    efCol.appendChild(efList);

    grid.appendChild(itemsCol); grid.appendChild(fcCol); grid.appendChild(efCol);
    wrap.appendChild(grid);

    this._renderClassLevelChoices(wrap, lv, idx, ed);

    container.appendChild(wrap);
  }

  _renderClassLevelChoices(wrap, lv, idx, ed) {
    const e = this._e.bind(this);
    const choices = Array.isArray(lv.choices) ? lv.choices : [];

    const section = document.createElement("div");
    section.className = "cls-choices";
    section.dataset.levelIdx = idx;
    section.style.cssText = "border-top:1px solid var(--sd-bg-3);padding:8px 10px;display:flex;flex-direction:column;gap:6px;";

    const hdr = document.createElement("div");
    hdr.style.cssText = "display:flex;align-items:center;gap:6px;font-size:10px;font-weight:700;text-transform:uppercase;color:var(--sd-text-3);letter-spacing:.06em;";
    hdr.innerHTML = `<i class="fas fa-code-branch" style="color:var(--sd-accent)"></i><span>Choices</span>
      ${ed ? `<button type="button" class="cls-add-choice" data-level-idx="${idx}" title="Add choice group"
        style="margin-left:auto;background:none;border:none;color:var(--sd-accent);cursor:pointer;font-size:12px">+</button>` : ""}`;
    section.appendChild(hdr);

    if (!choices.length && !ed) return;

    if (!choices.length && ed) {
      const empty = document.createElement("div");
      empty.style.cssText = "font-size:10px;color:var(--sd-text-3);font-style:italic;padding:4px 0;";
      empty.textContent = "No choice groups. Click + to add a fork.";
      section.appendChild(empty);
    }

    for (let g = 0; g < choices.length; g++) {
      const ch    = choices[g];
      const kind  = ch.kind ?? "items";
      const picks = Math.max(1, Number(ch.picks) || 1);
      const opts  = Array.isArray(ch.options) ? ch.options : [];

      const grp = document.createElement("div");
      grp.dataset.choiceIdx = g;
      grp.style.cssText = "background:var(--sd-bg);border:1px solid var(--sd-bg-3);border-radius:4px;padding:6px;display:flex;flex-direction:column;gap:4px;";

      const gh = document.createElement("div");
      gh.style.cssText = "display:flex;align-items:center;gap:4px;";
      if (ed) {
        gh.innerHTML = `
          <select class="cls-choice-kind" data-level-idx="${idx}" data-choice-idx="${g}"
            style="background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:3px;color:var(--sd-text);font-size:10px;padding:2px 4px">
            <option value="items"        ${kind === "items"        ? "selected" : ""}>Items</option>
            <option value="effects"      ${kind === "effects"      ? "selected" : ""}>Effects</option>
            <option value="fieldChanges" ${kind === "fieldChanges" ? "selected" : ""}>Field Changes</option>
          </select>
          <input type="text" class="cls-choice-label" data-level-idx="${idx}" data-choice-idx="${g}" value="${e(ch.label ?? "")}"
            placeholder="Label (optional)"
            style="flex:1;background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:3px;color:var(--sd-text);font-size:10px;padding:2px 5px">
          <label style="font-size:10px;color:var(--sd-text-3);display:flex;align-items:center;gap:3px">Picks
            <input type="number" class="cls-choice-picks" data-level-idx="${idx}" data-choice-idx="${g}" value="${picks}" min="1" step="1"
              style="width:44px;background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:3px;color:var(--sd-text);font-size:10px;padding:2px 4px;text-align:center"></label>
          <button type="button" class="cls-del-choice" data-level-idx="${idx}" data-choice-idx="${g}"
            style="background:none;border:none;color:var(--sd-text-3);cursor:pointer;font-size:11px"><i class="fas fa-times"></i></button>`;
      } else {
        const kindLabel = kind === "items" ? "Items" : kind === "effects" ? "Effects" : "Field Changes";
        gh.innerHTML = `
          <span style="font-size:10px;color:var(--sd-accent);font-weight:700;text-transform:uppercase">${kindLabel}</span>
          ${ch.label ? `<span style="font-size:10px;color:var(--sd-text-2)">${e(ch.label)}</span>` : ""}
          <span style="margin-left:auto;font-size:10px;color:var(--sd-text-3)">Pick ${picks} / ${opts.length}</span>`;
      }
      grp.appendChild(gh);

      const body = document.createElement("div");
      body.style.cssText = "display:flex;flex-direction:column;gap:3px;";

      if (kind === "items") {
        const zone = document.createElement("div");
        zone.className = "cls-choice-items-zone";
        zone.dataset.levelIdx = idx;
        zone.dataset.choiceIdx = g;
        zone.style.cssText = `min-height:28px;border:1px dashed ${ed ? "var(--sd-border)" : "transparent"};border-radius:4px;padding:4px;display:flex;flex-direction:column;gap:3px;`;
        if (ed && opts.length === 0) zone.innerHTML = `<span style="font-size:10px;color:var(--sd-text-3);text-align:center;padding:4px">Drop items here</span>`;
        opts.forEach((it, j) => {
          const chip = document.createElement("div");
          chip.style.cssText = "display:flex;align-items:center;gap:4px;background:var(--sd-bg-2);border:1px solid var(--sd-bg-3);border-radius:3px;padding:2px 5px;font-size:10px;color:var(--sd-text-2);";
          chip.innerHTML = `<img src="${e(it.img ?? "icons/svg/item-bag.svg")}" style="width:14px;height:14px;border-radius:2px;object-fit:cover">
            <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${e(it.name ?? "Item")}</span>
            ${ed ? `<button type="button" class="cls-del-choice-opt" data-level-idx="${idx}" data-choice-idx="${g}" data-opt-idx="${j}"
              style="background:none;border:none;color:var(--sd-text-3);cursor:pointer;font-size:10px;padding:0 1px">✕</button>` : ""}`;
          zone.appendChild(chip);
        });
        body.appendChild(zone);
      } else if (kind === "effects") {
        if (ed) {
          const addBtn = document.createElement("button");
          addBtn.type = "button";
          addBtn.className = "cls-add-choice-effect";
          addBtn.dataset.levelIdx = idx;
          addBtn.dataset.choiceIdx = g;
          addBtn.style.cssText = "align-self:flex-start;background:var(--sd-bg-2);border:1px solid var(--sd-border);border-radius:3px;color:var(--sd-text-2);cursor:pointer;font-size:10px;padding:2px 6px";
          addBtn.innerHTML = `<i class="fas fa-plus"></i> New Effect`;
          body.appendChild(addBtn);
        }
        opts.forEach((ef, j) => {
          const chip = document.createElement("div");
          chip.style.cssText = "display:flex;align-items:center;gap:4px;background:var(--sd-bg-2);border:1px solid var(--sd-bg-3);border-radius:3px;padding:2px 5px;font-size:10px;color:var(--sd-text-2);";
          chip.innerHTML = `<img src="${e(ef.icon ?? ef.img ?? "icons/svg/aura.svg")}" style="width:14px;height:14px;border-radius:2px">
            <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${e(ef.name ?? "Effect")}</span>
            ${ef.changes?.length ? `<span style="font-size:9px;color:var(--sd-text-3)">${ef.changes.length}</span>` : ""}
            ${ed ? `<button type="button" class="cls-edit-choice-ef" data-level-idx="${idx}" data-choice-idx="${g}" data-opt-idx="${j}"
              style="background:none;border:none;color:var(--sd-text-3);cursor:pointer;font-size:10px;padding:0 1px"><i class="fas fa-pen"></i></button>
              <button type="button" class="cls-del-choice-opt" data-level-idx="${idx}" data-choice-idx="${g}" data-opt-idx="${j}"
              style="background:none;border:none;color:var(--sd-text-3);cursor:pointer;font-size:10px;padding:0 1px">✕</button>` : ""}`;
          body.appendChild(chip);
        });
      } else {
        if (ed) {
          const addBtn = document.createElement("button");
          addBtn.type = "button";
          addBtn.className = "cls-add-choice-fc";
          addBtn.dataset.levelIdx = idx;
          addBtn.dataset.choiceIdx = g;
          addBtn.style.cssText = "align-self:flex-start;background:var(--sd-bg-2);border:1px solid var(--sd-border);border-radius:3px;color:var(--sd-text-2);cursor:pointer;font-size:10px;padding:2px 6px";
          addBtn.innerHTML = `<i class="fas fa-plus"></i> Add Field Change`;
          body.appendChild(addBtn);
        }
        opts.forEach((fc, j) => {
          const row = document.createElement("div");
          row.style.cssText = "display:flex;align-items:center;gap:2px;";
          if (ed) {
            row.innerHTML = `
              <input type="text" class="cls-choice-fc-path" data-level-idx="${idx}" data-choice-idx="${g}" data-opt-idx="${j}" value="${e(fc.path ?? "")}"
                placeholder="system.resources.hp.max"
                style="flex:1;background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:3px;color:var(--sd-text);font-size:10px;padding:2px 4px">
              <select class="cls-choice-fc-mode" data-level-idx="${idx}" data-choice-idx="${g}" data-opt-idx="${j}"
                style="background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:3px;color:var(--sd-text);font-size:10px;padding:2px 4px">
                <option value="add"      ${fc.mode === "add"      ? "selected" : ""}>+</option>
                <option value="set"      ${fc.mode === "set"      ? "selected" : ""}>=</option>
                <option value="multiply" ${fc.mode === "multiply" ? "selected" : ""}>×</option>
              </select>
              <input type="text" class="cls-choice-fc-val" data-level-idx="${idx}" data-choice-idx="${g}" data-opt-idx="${j}" value="${e(fc.value ?? "")}"
                placeholder="0"
                style="width:54px;background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:3px;color:var(--sd-text);font-size:10px;padding:2px 4px">
              <button type="button" class="cls-del-choice-opt" data-level-idx="${idx}" data-choice-idx="${g}" data-opt-idx="${j}"
                style="background:none;border:none;color:var(--sd-text-3);cursor:pointer;font-size:10px;padding:0 1px">✕</button>`;
          } else {
            const sym = fc.mode === "set" ? "=" : fc.mode === "multiply" ? "×" : "+";
            row.innerHTML = `<code style="font-size:10px;color:var(--sd-text-2)">${e(fc.path ?? "")}</code>
              <span style="font-size:10px;color:var(--sd-accent)">${sym}</span>
              <strong style="font-size:10px;color:var(--sd-text)">${e(fc.value ?? "")}</strong>`;
          }
          body.appendChild(row);
        });
      }

      grp.appendChild(body);
      section.appendChild(grp);
    }

    wrap.appendChild(section);
  }

  _wireClassDropZones(panel) {
    if (!this.isEditable) return;
    panel.querySelectorAll(".cls-items-zone").forEach(zone => {
      zone.addEventListener("dragover",  ev => { ev.preventDefault(); zone.style.borderColor = "var(--sd-accent)"; });
      zone.addEventListener("dragleave", ()  => zone.style.borderColor = "var(--sd-border)");
      zone.addEventListener("drop",      async ev => {
        zone.style.borderColor = "var(--sd-border)";
        ev.preventDefault();
        const data = TextEditor.getDragEventData(ev);
        if (data?.type !== "Item") return;
        let item;
        try { item = await fromUuid(data.uuid); } catch { return; }
        if (!item) return;
        const levelIdx = parseInt(zone.dataset.levelIdx);
        const lvls     = foundry.utils.deepClone(this.document.system.levels ?? []);
        if (!lvls[levelIdx]) return;
        lvls[levelIdx].items ??= [];
        const snap = item.toObject(); snap._sourceUuid = data.uuid;
        lvls[levelIdx].items.push(snap);
        await this.document.update({ "system.levels": lvls });
      });
    });

    panel.querySelectorAll(".cls-lv-num").forEach(inp =>
      inp.addEventListener("change", async ev => {
        const lvls = foundry.utils.deepClone(this.document.system.levels ?? []);
        const idx  = parseInt(ev.target.dataset.idx);
        if (lvls[idx]) { lvls[idx].level = parseInt(ev.target.value) || 1; }
        await this.document.update({ "system.levels": lvls });
      })
    );
    panel.querySelectorAll(".cls-lv-label").forEach(inp =>
      inp.addEventListener("change", async ev => {
        const lvls = foundry.utils.deepClone(this.document.system.levels ?? []);
        const idx  = parseInt(ev.target.dataset.idx);
        if (lvls[idx]) lvls[idx].label = ev.target.value;
        await this.document.update({ "system.levels": lvls });
      })
    );

    panel.querySelectorAll(".cls-del-level").forEach(btn =>
      btn.addEventListener("click", async ev => {
        const lvls = foundry.utils.deepClone(this.document.system.levels ?? []);
        lvls.splice(parseInt(ev.currentTarget.dataset.idx), 1);
        await this.document.update({ "system.levels": lvls });
      })
    );

    panel.querySelectorAll(".cls-del-item").forEach(btn =>
      btn.addEventListener("click", async ev => {
        const lvls = foundry.utils.deepClone(this.document.system.levels ?? []);
        const li   = parseInt(ev.currentTarget.dataset.levelIdx);
        const ii   = parseInt(ev.currentTarget.dataset.itemIdx);
        lvls[li]?.items?.splice(ii, 1);
        await this.document.update({ "system.levels": lvls });
      })
    );

    panel.querySelectorAll(".cls-add-fc").forEach(btn =>
      btn.addEventListener("click", async ev => {
        const lvls = foundry.utils.deepClone(this.document.system.levels ?? []);
        const li   = parseInt(ev.currentTarget.dataset.levelIdx);
        lvls[li].fieldChanges ??= [];
        lvls[li].fieldChanges.push({ path: "system.advancement.level", mode: "add", value: "1" });
        await this.document.update({ "system.levels": lvls });
      })
    );

    const _fcSave = async (el, field) => {
      const lvls = foundry.utils.deepClone(this.document.system.levels ?? []);
      const li   = parseInt(el.dataset.levelIdx);
      const fi   = parseInt(el.dataset.fcIdx);
      if (lvls[li]?.fieldChanges?.[fi]) { lvls[li].fieldChanges[fi][field] = el.value; }
      await this.document.update({ "system.levels": lvls });
    };
    panel.querySelectorAll(".cls-fc-path").forEach(el => el.addEventListener("change", () => _fcSave(el, "path")));
    panel.querySelectorAll(".cls-fc-mode").forEach(el => el.addEventListener("change", () => _fcSave(el, "mode")));
    panel.querySelectorAll(".cls-fc-val" ).forEach(el => el.addEventListener("change", () => _fcSave(el, "value")));

    panel.querySelectorAll(".cls-del-fc").forEach(btn =>
      btn.addEventListener("click", async ev => {
        const lvls = foundry.utils.deepClone(this.document.system.levels ?? []);
        const li   = parseInt(ev.currentTarget.dataset.levelIdx);
        const fi   = parseInt(ev.currentTarget.dataset.fcIdx);
        lvls[li]?.fieldChanges?.splice(fi, 1);
        await this.document.update({ "system.levels": lvls });
      })
    );

    panel.querySelectorAll(".cls-add-ef").forEach(btn =>
      btn.addEventListener("click", async ev => {
        const li   = parseInt(ev.currentTarget.dataset.levelIdx);
        const seed = {
          name: "New Effect",
          icon: "icons/svg/aura.svg",
          img:  "icons/svg/aura.svg",
          changes: [],
          disabled: false,
          duration: {},
          flags: {}
        };
        const updated = await editEffectViaStandardConfig(seed, {
          parent: this.document,
          title:  `Add Effect`
        });
        if (!updated) return;
        const lvls = foundry.utils.deepClone(this.document.system.levels ?? []);
        lvls[li].effects ??= [];
        const eff = { ...updated };
        delete eff._id;
        lvls[li].effects.push(eff);
        await this.document.update({ "system.levels": lvls });
      })
    );

    panel.querySelectorAll(".cls-edit-ef").forEach(btn =>
      btn.addEventListener("click", async ev => {
        const li = parseInt(ev.currentTarget.dataset.levelIdx);
        const ei = parseInt(ev.currentTarget.dataset.efIdx);
        const lvls = foundry.utils.deepClone(this.document.system.levels ?? []);
        const ef   = lvls[li]?.effects?.[ei];
        if (!ef) return;
        const updated = await editEffectViaStandardConfig(ef, {
          parent: this.document,
          title:  `Edit Effect: ${ef.name ?? ""}`
        });
        if (!updated) return;
        const merged = { ...ef, ...updated };
        delete merged._id;
        lvls[li].effects[ei] = merged;
        await this.document.update({ "system.levels": lvls });
      })
    );

    panel.querySelectorAll(".cls-del-ef").forEach(btn =>
      btn.addEventListener("click", async ev => {
        const lvls = foundry.utils.deepClone(this.document.system.levels ?? []);
        const li   = parseInt(ev.currentTarget.dataset.levelIdx);
        const ei   = parseInt(ev.currentTarget.dataset.efIdx);
        lvls[li]?.effects?.splice(ei, 1);
        await this.document.update({ "system.levels": lvls });
      })
    );

    this._wireClassChoiceZones(panel);
  }

  _wireClassChoiceZones(panel) {
    if (!this.isEditable) return;

    panel.querySelectorAll(".cls-add-choice").forEach(btn =>
      btn.addEventListener("click", async ev => {
        const li   = parseInt(ev.currentTarget.dataset.levelIdx);
        const lvls = foundry.utils.deepClone(this.document.system.levels ?? []);
        if (!lvls[li]) return;
        lvls[li].choices ??= [];
        lvls[li].choices.push({ id: foundry.utils.randomID(), label: "", kind: "items", picks: 1, options: [] });
        await this.document.update({ "system.levels": lvls });
      })
    );

    panel.querySelectorAll(".cls-del-choice").forEach(btn =>
      btn.addEventListener("click", async ev => {
        const li = parseInt(ev.currentTarget.dataset.levelIdx);
        const gi = parseInt(ev.currentTarget.dataset.choiceIdx);
        const lvls = foundry.utils.deepClone(this.document.system.levels ?? []);
        lvls[li]?.choices?.splice(gi, 1);
        await this.document.update({ "system.levels": lvls });
      })
    );

    const _saveChoiceField = async (el, field, transform = (v) => v) => {
      const lvls = foundry.utils.deepClone(this.document.system.levels ?? []);
      const li = parseInt(el.dataset.levelIdx);
      const gi = parseInt(el.dataset.choiceIdx);
      const ch = lvls?.[li]?.choices?.[gi];
      if (!ch) return;
      ch[field] = transform(el.value);
      if (field === "kind") ch.options = [];
      await this.document.update({ "system.levels": lvls });
    };
    panel.querySelectorAll(".cls-choice-kind").forEach(el =>
      el.addEventListener("change", () => _saveChoiceField(el, "kind"))
    );
    panel.querySelectorAll(".cls-choice-label").forEach(el =>
      el.addEventListener("change", () => _saveChoiceField(el, "label"))
    );
    panel.querySelectorAll(".cls-choice-picks").forEach(el =>
      el.addEventListener("change", () => _saveChoiceField(el, "picks", v => Math.max(1, Number(v) || 1)))
    );

    panel.querySelectorAll(".cls-del-choice-opt").forEach(btn =>
      btn.addEventListener("click", async ev => {
        const li = parseInt(ev.currentTarget.dataset.levelIdx);
        const gi = parseInt(ev.currentTarget.dataset.choiceIdx);
        const oi = parseInt(ev.currentTarget.dataset.optIdx);
        const lvls = foundry.utils.deepClone(this.document.system.levels ?? []);
        lvls?.[li]?.choices?.[gi]?.options?.splice(oi, 1);
        await this.document.update({ "system.levels": lvls });
      })
    );

    panel.querySelectorAll(".cls-choice-items-zone").forEach(zone => {
      zone.addEventListener("dragover",  ev => { ev.preventDefault(); zone.style.borderColor = "var(--sd-accent)"; });
      zone.addEventListener("dragleave", ()  => zone.style.borderColor = "var(--sd-border)");
      zone.addEventListener("drop",      async ev => {
        zone.style.borderColor = "var(--sd-border)";
        ev.preventDefault();
        const data = TextEditor.getDragEventData(ev);
        if (data?.type !== "Item") return;
        let item;
        try { item = await fromUuid(data.uuid); } catch { return; }
        if (!item) return;
        const li = parseInt(zone.dataset.levelIdx);
        const gi = parseInt(zone.dataset.choiceIdx);
        const lvls = foundry.utils.deepClone(this.document.system.levels ?? []);
        const ch = lvls?.[li]?.choices?.[gi];
        if (!ch) return;
        ch.options ??= [];
        const snap = item.toObject(); snap._sourceUuid = data.uuid;
        ch.options.push(snap);
        await this.document.update({ "system.levels": lvls });
      });
    });

    panel.querySelectorAll(".cls-add-choice-effect").forEach(btn =>
      btn.addEventListener("click", async ev => {
        const li = parseInt(ev.currentTarget.dataset.levelIdx);
        const gi = parseInt(ev.currentTarget.dataset.choiceIdx);
        const seed = {
          name: "New Effect", icon: "icons/svg/aura.svg", img: "icons/svg/aura.svg",
          changes: [], disabled: false, duration: {}, flags: {}
        };
        const updated = await editEffectViaStandardConfig(seed, {
          parent: this.document, title: "Add Effect"
        });
        if (!updated) return;
        const lvls = foundry.utils.deepClone(this.document.system.levels ?? []);
        const ch = lvls?.[li]?.choices?.[gi];
        if (!ch) return;
        ch.options ??= [];
        const eff = { ...updated }; delete eff._id;
        ch.options.push(eff);
        await this.document.update({ "system.levels": lvls });
      })
    );

    panel.querySelectorAll(".cls-edit-choice-ef").forEach(btn =>
      btn.addEventListener("click", async ev => {
        const li = parseInt(ev.currentTarget.dataset.levelIdx);
        const gi = parseInt(ev.currentTarget.dataset.choiceIdx);
        const oi = parseInt(ev.currentTarget.dataset.optIdx);
        const lvls = foundry.utils.deepClone(this.document.system.levels ?? []);
        const ef = lvls?.[li]?.choices?.[gi]?.options?.[oi];
        if (!ef) return;
        const updated = await editEffectViaStandardConfig(ef, {
          parent: this.document, title: `Edit Effect: ${ef.name ?? ""}`
        });
        if (!updated) return;
        const merged = { ...ef, ...updated }; delete merged._id;
        lvls[li].choices[gi].options[oi] = merged;
        await this.document.update({ "system.levels": lvls });
      })
    );

    panel.querySelectorAll(".cls-add-choice-fc").forEach(btn =>
      btn.addEventListener("click", async ev => {
        const li = parseInt(ev.currentTarget.dataset.levelIdx);
        const gi = parseInt(ev.currentTarget.dataset.choiceIdx);
        const lvls = foundry.utils.deepClone(this.document.system.levels ?? []);
        const ch = lvls?.[li]?.choices?.[gi];
        if (!ch) return;
        ch.options ??= [];
        ch.options.push({ path: "system.resources.hp.max", mode: "add", value: "1" });
        await this.document.update({ "system.levels": lvls });
      })
    );

    const _saveChoiceFcField = async (el, field) => {
      const lvls = foundry.utils.deepClone(this.document.system.levels ?? []);
      const li = parseInt(el.dataset.levelIdx);
      const gi = parseInt(el.dataset.choiceIdx);
      const oi = parseInt(el.dataset.optIdx);
      const opt = lvls?.[li]?.choices?.[gi]?.options?.[oi];
      if (!opt) return;
      opt[field] = el.value;
      await this.document.update({ "system.levels": lvls });
    };
    panel.querySelectorAll(".cls-choice-fc-path").forEach(el => el.addEventListener("change", () => _saveChoiceFcField(el, "path")));
    panel.querySelectorAll(".cls-choice-fc-mode").forEach(el => el.addEventListener("change", () => _saveChoiceFcField(el, "mode")));
    panel.querySelectorAll(".cls-choice-fc-val" ).forEach(el => el.addEventListener("change", () => _saveChoiceFcField(el, "value")));
  }

  _buildSkilltreePanel(isActive) {
    const p   = this._mkSysPanel("_sys_skilltree", isActive);
    const ed  = this.isEditable;
    const sys = this.document.system;
    const e   = this._e.bind(this);

    const cols  = sys.cols ?? 8;
    const rows  = sys.rows ?? 5;
    const nodes = sys.nodes ?? [];
    const conns = sys.connections ?? [];
    const CELL  = 78, GAP = 6;
    const W = cols * (CELL + GAP);
    const H = rows * (CELL + GAP);

    const toolbar = document.createElement("div");
    toolbar.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap;";
    toolbar.innerHTML = `
      <span style="font-size:12px;font-weight:700;color:var(--sd-text-2);flex:1">
        <i class="fas fa-project-diagram" style="color:var(--sd-accent);margin-right:5px"></i>Skill Tree</span>
      ${ed ? `
        <label style="font-size:11px;color:var(--sd-text-3);display:flex;align-items:center;gap:4px">Cols
          <input id="st-cols" type="number" value="${cols}" min="2" max="20"
            style="width:44px;background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:3px;color:var(--sd-text);font-size:11px;padding:2px 4px;text-align:center"></label>
        <label style="font-size:11px;color:var(--sd-text-3);display:flex;align-items:center;gap:4px">Rows
          <input id="st-rows" type="number" value="${rows}" min="2" max="20"
            style="width:44px;background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:3px;color:var(--sd-text);font-size:11px;padding:2px 4px;text-align:center"></label>
        <button type="button" id="st-connect-btn"
          style="padding:4px 10px;background:var(--sd-accent-glow);border:1px solid var(--sd-accent);border-radius:4px;color:var(--sd-accent);cursor:pointer;font-size:11px;font-weight:600">
          <i class="fas fa-link"></i> Connect</button>` : ""}`;
    p.appendChild(toolbar);

    const scroll = document.createElement("div");
    scroll.style.cssText = "overflow:auto;border:1px solid var(--sd-bg-3);border-radius:5px;background:var(--sd-bg);padding:8px;";

    const canvas = document.createElement("div");
    canvas.style.cssText = `position:relative;width:${W}px;height:${H}px;`;

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", W); svg.setAttribute("height", H);
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.style.cssText = "position:absolute;top:0;left:0;pointer-events:none;z-index:1;overflow:visible;";
    svg.innerHTML = `<defs>
      <marker id="sti-arrow" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto">
        <path d="M0,0 L7,3.5 L0,7 Z" fill="var(--sd-accent)" opacity=".8"/>
      </marker></defs>`;
    for (const conn of conns) {
      const fn = nodes.find(n => n.id === conn.from), tn = nodes.find(n => n.id === conn.to);
      if (!fn || !tn) continue;
      const x1 = fn.col*(CELL+GAP)+CELL/2, y1 = fn.row*(CELL+GAP)+CELL/2;
      const x2 = tn.col*(CELL+GAP)+CELL/2, y2 = tn.row*(CELL+GAP)+CELL/2;
      const dx = x2-x1, dy = y2-y1, dist = Math.sqrt(dx*dx+dy*dy)||1, pad = 22;
      const line = document.createElementNS("http://www.w3.org/2000/svg","line");
      line.setAttribute("x1", x1+(dx/dist)*pad); line.setAttribute("y1", y1+(dy/dist)*pad);
      line.setAttribute("x2", x2-(dx/dist)*pad); line.setAttribute("y2", y2-(dy/dist)*pad);
      line.setAttribute("stroke","var(--sd-accent)"); line.setAttribute("stroke-width","2");
      line.setAttribute("marker-end","url(#sti-arrow)");
      line.setAttribute("opacity",".6");
      if (ed) {
        line.style.pointerEvents = "stroke"; line.style.cursor = "pointer";
        line.dataset.from = conn.from; line.dataset.to = conn.to;
        line.classList.add("sti-del-conn");
        line.title = "Click to delete connection";
      }
      svg.appendChild(line);
    }
    canvas.appendChild(svg);

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const node = nodes.find(n => n.col === col && n.row === row);
        const left = col*(CELL+GAP), top = row*(CELL+GAP);
        const st   = `position:absolute;left:${left}px;top:${top}px;width:${CELL}px;height:${CELL}px;`;

        if (node) {
          const el = document.createElement("div");
          el.style.cssText = st + `background:${node.color||"var(--sd-bg)"};border:2px solid var(--sd-accent);border-radius:8px;
            display:flex;flex-direction:column;align-items:center;justify-content:center;
            gap:3px;overflow:hidden;z-index:2;box-sizing:border-box;padding:4px;`;
          el.dataset.nodeId = node.id;
          if (node.item) el.title = "Right-click to open item";
          el.addEventListener("contextmenu", async ev => {
            ev.preventDefault();
            ev.stopPropagation();
            const liveNode = (this.document.system.nodes ?? []).find(n => n.id === node.id);
            const snap     = liveNode?.item;
            if (snap) await openItemSheetFromSnapshot(snap, this.document.parent ?? null);
          });
          if (node.item?.img) {
            el.innerHTML += `<img src="${e(node.item.img)}" style="width:34px;height:34px;object-fit:cover;border-radius:4px;pointer-events:none">`;
          } else {
            el.innerHTML += `<i class="fas fa-star" style="font-size:20px;color:var(--sd-accent);opacity:.5"></i>`;
          }
          const lbl = node.label || node.item?.name || "";
          if (lbl) el.innerHTML += `<div style="font-size:9px;color:var(--sd-text-3);text-align:center;line-height:1.2;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:0 2px">${e(lbl)}</div>`;
          if ((node.fieldChanges?.length || node.effects?.length) && !ed) {
            el.innerHTML += `<div style="display:flex;gap:2px;position:absolute;bottom:2px;left:2px">
              ${node.fieldChanges?.length ? `<span style="font-size:8px;background:rgba(0,0,0,.4);padding:1px 3px;border-radius:2px;color:var(--sd-text-3)"><i class="fas fa-sliders-h"></i>${node.fieldChanges.length}</span>` : ""}
              ${node.effects?.length      ? `<span style="font-size:8px;background:rgba(0,0,0,.4);padding:1px 3px;border-radius:2px;color:var(--sd-text-3)"><i class="fas fa-magic"></i>${node.effects.length}</span>` : ""}
            </div>`;
          }
          if (ed) {
            el.style.cursor = "pointer";
            const tools = document.createElement("div");
            tools.style.cssText = "position:absolute;top:2px;right:2px;display:none;flex-direction:column;gap:2px;";
            tools.innerHTML = `
              <button type="button" class="sti-cfg-node" data-node-id="${e(node.id)}"
                style="width:16px;height:16px;background:rgba(0,0,0,.6);border:none;border-radius:2px;color:var(--sd-text-2);cursor:pointer;font-size:8px;display:flex;align-items:center;justify-content:center">
                <i class="fas fa-cog"></i></button>
              <button type="button" class="sti-del-node" data-node-id="${e(node.id)}"
                style="width:16px;height:16px;background:rgba(0,0,0,.6);border:none;border-radius:2px;color:#c04040;cursor:pointer;font-size:8px;display:flex;align-items:center;justify-content:center">
                <i class="fas fa-trash"></i></button>`;
            el.appendChild(tools);
            el.addEventListener("mouseenter", () => tools.style.display = "flex");
            el.addEventListener("mouseleave", () => tools.style.display = "none");

            el.addEventListener("dragover",  ev => { ev.preventDefault(); el.style.borderColor="#c0b0ff"; });
            el.addEventListener("dragleave", ()  => el.style.borderColor="var(--sd-accent)");
            el.addEventListener("drop",      async ev => {
              ev.preventDefault(); el.style.borderColor="var(--sd-accent)";
              const data = TextEditor.getDragEventData(ev);
              if (data?.type !== "Item") return;
              let item; try { item = await fromUuid(data.uuid); } catch { return; }
              if (!item) return;
              const snap = item.toObject(); snap._sourceUuid = data.uuid;
              const ns = foundry.utils.deepClone(this.document.system.nodes ?? []);
              const ni = ns.findIndex(n => n.id === node.id);
              if (ni >= 0) { ns[ni].item = snap; ns[ni].label ||= item.name; }
              await this.document.update({ "system.nodes": ns });
            });
          }
          canvas.appendChild(el);

        } else if (ed) {
          const cell = document.createElement("div");
          cell.style.cssText = st + "border:1px dashed var(--sd-accent-dim);border-radius:6px;z-index:2;box-sizing:border-box;display:flex;align-items:center;justify-content:center;cursor:default;transition:border-color .15s,background .15s;";
          cell.dataset.col = col; cell.dataset.row = row;
          cell.classList.add("sti-empty-cell");
          cell.innerHTML = `<i class="fas fa-plus" style="color:var(--sd-accent-dim);font-size:13px;transition:color .15s"></i>`;
          cell.addEventListener("dragover",  ev => { ev.preventDefault(); cell.style.borderColor="var(--sd-accent)"; cell.style.background="var(--sd-accent-glow)"; });
          cell.addEventListener("dragleave", ()  => { cell.style.borderColor=""; cell.style.background=""; });
          cell.addEventListener("drop",      async ev => {
            ev.preventDefault(); cell.style.borderColor=""; cell.style.background="";
            const data = TextEditor.getDragEventData(ev);
            if (data?.type !== "Item") return;
            let item; try { item = await fromUuid(data.uuid); } catch { return; }
            if (!item) return;
            const snap = item.toObject(); snap._sourceUuid = data.uuid;
            const ns = foundry.utils.deepClone(this.document.system.nodes ?? []);
            ns.push({ id: foundry.utils.randomID(8), col, row, label: item.name, item: snap, effects: [], fieldChanges: [], maxAcquire: 1, color: "" });
            await this.document.update({ "system.nodes": ns });
          });
          canvas.appendChild(cell);
        }
      }
    }

    scroll.appendChild(canvas);
    p.appendChild(scroll);

    if (ed) {
      let connectFrom = null;

      const updateConnectBtn = () => {
        const btn = p.querySelector("#st-connect-btn");
        if (!btn) return;
        if (connectFrom) {
          btn.textContent = "✕ Cancel";
          btn.style.borderColor = "var(--sd-danger)"; btn.style.color = "var(--sd-danger)"; btn.style.background = "rgba(239,68,68,.1)";
        } else {
          btn.innerHTML = '<i class="fas fa-link"></i> Connect';
          btn.style.borderColor = "var(--sd-accent)"; btn.style.color = "var(--sd-accent)"; btn.style.background = "var(--sd-accent-glow)";
        }
      };

      p.querySelector("#st-connect-btn")?.addEventListener("click", () => {
        connectFrom = null; updateConnectBtn();
      });
      p.querySelector("#st-cols")?.addEventListener("change", async ev => {
        await this.document.update({ "system.cols": Math.max(2, Math.min(20, parseInt(ev.target.value)||8)) });
      });
      p.querySelector("#st-rows")?.addEventListener("change", async ev => {
        await this.document.update({ "system.rows": Math.max(2, Math.min(20, parseInt(ev.target.value)||5)) });
      });

      canvas.querySelectorAll("[data-node-id]").forEach(el => {
        el.addEventListener("click", async ev => {
          if (ev.target.closest(".sti-cfg-node,.sti-del-node")) return;
          const nodeId = el.dataset.nodeId;
          if (connectFrom) {
            if (connectFrom !== nodeId) {
              const cs = foundry.utils.deepClone(this.document.system.connections ?? []);
              if (!cs.some(c => c.from===connectFrom && c.to===nodeId)) {
                cs.push({ from: connectFrom, to: nodeId });
                await this.document.update({ "system.connections": cs });
              }
            }
            connectFrom = null; updateConnectBtn();
          } else {
            connectFrom = nodeId;
            el.style.borderColor = "#ffb347";
            el.style.boxShadow   = "0 0 10px rgba(255,179,71,.4)";
            updateConnectBtn();
            ui.notifications.info("Now click the destination node to connect.");
          }
        });
      });

      svg.querySelectorAll(".sti-del-conn").forEach(line => {
        line.addEventListener("click", async ev => {
          ev.stopPropagation();
          const ok = await foundry.applications.api.DialogV2.confirm({
            window: { title: "Delete connection?" },
            content: "<p>Remove this connection?</p>"
          }).catch(() => false);
          if (!ok) return;
          const cs = foundry.utils.deepClone(this.document.system.connections ?? []);
          const filtered = cs.filter(c => !(c.from===line.dataset.from && c.to===line.dataset.to));
          await this.document.update({ "system.connections": filtered });
        });
      });

      canvas.querySelectorAll(".sti-del-node").forEach(btn => {
        btn.addEventListener("click", async ev => {
          ev.stopPropagation();
          const nodeId = ev.currentTarget.dataset.nodeId;
          const ns = foundry.utils.deepClone(this.document.system.nodes ?? []).filter(n => n.id !== nodeId);
          const cs = foundry.utils.deepClone(this.document.system.connections ?? []).filter(c => c.from!==nodeId && c.to!==nodeId);
          await this.document.update({ "system.nodes": ns, "system.connections": cs });
        });
      });

      canvas.querySelectorAll(".sti-cfg-node").forEach(btn => {
        btn.addEventListener("click", async ev => {
          ev.stopPropagation();
          const nodeId = ev.currentTarget.dataset.nodeId;
          const ns     = foundry.utils.deepClone(this.document.system.nodes ?? []);
          const node   = ns.find(n => n.id === nodeId);
          if (!node) return;

          const escAttr = (s) => this._e(s);
          const workingEffects = foundry.utils.deepClone(node.effects ?? []);
          const _renderEffectRow = (ef, j) => `
            <div class="stn-eff-row" data-idx="${j}" style="display:flex;align-items:center;gap:6px;padding:3px 6px;border:1px solid var(--sd-border);border-radius:4px;background:var(--sd-bg);">
              <img src="${escAttr(ef.icon ?? ef.img ?? "icons/svg/aura.svg")}" style="width:18px;height:18px;border-radius:2px;">
              <span style="flex:1;font-size:11px;${ef.disabled ? "opacity:.5;text-decoration:line-through;" : ""}">${escAttr(ef.name ?? "Effect")}</span>
              <span style="font-size:10px;color:var(--sd-text-3);">${(ef.changes ?? []).length} ch.</span>
              <button type="button" class="stn-edit-eff" data-idx="${j}" title="Edit effect" style="background:none;border:none;color:var(--sd-accent);cursor:pointer;font-size:11px;padding:0 4px;"><i class="fas fa-pen"></i></button>
              <button type="button" class="stn-del-eff" data-idx="${j}" title="Delete" style="background:none;border:none;color:var(--sd-text-3);cursor:pointer;font-size:11px;padding:0 4px;">✕</button>
            </div>`;
          const _renderEffectsHTML = () => (workingEffects.length
            ? workingEffects.map((ef, j) => _renderEffectRow(ef, j)).join("")
            : `<span style="font-size:10px;color:var(--sd-text-3);font-style:italic">No effects yet.</span>`);

          const fcRows = (node.fieldChanges ?? []).map((fc, j) => `
            <div class="stn-fc-row" style="display:flex;align-items:center;gap:3px;margin-bottom:3px">
              <input type="text" class="stn-fc-path" value="${escAttr(fc.path)}" placeholder="system.advancement.level"
                style="flex:1;min-width:0;background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:3px;color:var(--sd-accent);font-size:10px;font-family:monospace;padding:2px 4px">
              <select class="stn-fc-mode" style="background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:3px;color:var(--sd-accent);font-size:11px;font-weight:700;padding:2px">
                <option value="add" ${fc.mode==="add"?"selected":""}>+</option>
                <option value="set" ${fc.mode==="set"?"selected":""}>=</option>
                <option value="multiply" ${fc.mode==="multiply"?"selected":""}>×</option>
              </select>
              <input type="text" class="stn-fc-val" value="${escAttr(fc.value)}" style="width:40px;background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:3px;color:var(--sd-text);font-size:10px;padding:2px 3px;text-align:center">
              <button type="button" class="stn-del-fc" style="background:none;border:none;color:var(--sd-text-3);cursor:pointer;font-size:11px">✕</button>
            </div>`).join("");
          const content = `<div style="display:flex;flex-direction:column;gap:10px;padding:8px">
            <label style="display:flex;flex-direction:column;gap:3px;font-size:11px;color:var(--sd-text-3)">Label
              <input id="stn-label" type="text" value="${escAttr(node.label??'')}" style="background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:3px;color:var(--sd-text);font-size:12px;padding:4px 6px"></label>
            <label style="display:flex;flex-direction:column;gap:3px;font-size:11px;color:var(--sd-text-3)">Max Acquires
              <input id="stn-max" type="text" inputmode="numeric" value="${node.maxAcquire??1}" style="width:80px;background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:3px;color:var(--sd-text);font-size:12px;padding:4px 6px"></label>
            <label style="display:flex;flex-direction:column;gap:3px;font-size:11px;color:var(--sd-text-3)">Cost
              <input id="stn-cost" type="text" inputmode="numeric" value="${node.cost??1}" style="width:80px;background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:3px;color:var(--sd-text);font-size:12px;padding:4px 6px"></label>
            <label style="display:flex;flex-direction:column;gap:3px;font-size:11px;color:var(--sd-text-3)">Cell Color
              <input id="stn-color" type="color" value="${/^#[0-9a-f]{6}$/i.test(String(node.color ?? "")) ? node.color : '#1a1a2e'}" style="width:56px;height:28px"></label>
            <div>
              <div style="font-size:11px;font-weight:600;color:var(--sd-text-3);margin-bottom:5px"><i class="fas fa-sliders-h"></i> Field Changes
                <button type="button" id="stn-add-fc" style="margin-left:8px;background:none;border:none;color:var(--sd-accent);cursor:pointer;font-size:11px">+ Add</button></div>
              <div id="stn-fcs">${fcRows}</div>
            </div>
            <div>
              <div style="font-size:11px;font-weight:600;color:var(--sd-text-3);margin-bottom:5px;display:flex;align-items:center;gap:6px;">
                <span><i class="fas fa-magic"></i> Active Effects</span>
                <button type="button" id="stn-add-eff" style="margin-left:auto;background:none;border:none;color:var(--sd-accent);cursor:pointer;font-size:11px">+ Add Effect</button>
              </div>
              <div id="stn-effs" style="display:flex;flex-direction:column;gap:3px;">${_renderEffectsHTML()}</div>
            </div>
          </div>`;
          const ok = await foundry.applications.api.DialogV2.prompt({
            window:  { title: `Configure: ${node.label || node.item?.name || nodeId}` },
            content,
            ok: {
              label: "Save", icon: "fas fa-save",
              callback: (_ev, _btn, dlg) => {

                const root = dlg?.element ?? dlg;
                node.label      = root.querySelector("#stn-label")?.value ?? node.label;
                const maxRaw    = parseInt(root.querySelector("#stn-max")?.value);
                node.maxAcquire = Number.isFinite(maxRaw) && maxRaw >= 1 ? maxRaw : (node.maxAcquire ?? 1);
                const costRaw   = parseInt(root.querySelector("#stn-cost")?.value);
                node.cost       = Number.isFinite(costRaw) && costRaw >= 0 ? costRaw : (Number.isFinite(node.cost) ? node.cost : 1);
                node.color      = root.querySelector("#stn-color")?.value ?? "";
                const fcs = [];
                root.querySelectorAll("#stn-fcs .stn-fc-row").forEach(row => {
                  const path  = row.querySelector(".stn-fc-path")?.value?.trim();
                  const mode  = row.querySelector(".stn-fc-mode")?.value ?? "add";
                  const value = row.querySelector(".stn-fc-val")?.value ?? "0";
                  if (path) fcs.push({ path, mode, value });
                });
                node.fieldChanges = fcs;
                node.effects      = workingEffects.map(ef => { const c = { ...ef }; delete c._id; return c; });
                return true;
              }
            },
            render: (_ev, dlg) => {

              const root = dlg?.element ?? dlg;
              root.addEventListener("click", ev => { if (ev.target.closest(".stn-del-fc")) ev.target.closest(".stn-fc-row")?.remove(); });
              root.querySelector("#stn-add-fc")?.addEventListener("click", () => {
                const div = document.createElement("div");
                div.className = "stn-fc-row";
                div.style.cssText = "display:flex;align-items:center;gap:3px;margin-bottom:3px";
                div.innerHTML = `
                  <input type="text" class="stn-fc-path" value="system.advancement.level" placeholder="system...."
                    style="flex:1;min-width:0;background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:3px;color:var(--sd-accent);font-size:10px;font-family:monospace;padding:2px 4px">
                  <select class="stn-fc-mode" style="background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:3px;color:var(--sd-accent);font-size:11px;font-weight:700;padding:2px">
                    <option value="add">+</option><option value="set">=</option><option value="multiply">×</option>
                  </select>
                  <input type="text" class="stn-fc-val" value="1" style="width:40px;background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:3px;color:var(--sd-text);font-size:10px;padding:2px 3px;text-align:center">
                  <button type="button" class="stn-del-fc" style="background:none;border:none;color:var(--sd-text-3);cursor:pointer;font-size:11px">✕</button>`;
                root.querySelector("#stn-fcs")?.appendChild(div);
              });

              const refreshEffects = () => {
                const cont = root.querySelector("#stn-effs");
                if (cont) cont.innerHTML = _renderEffectsHTML();
              };

              root.querySelector("#stn-add-eff")?.addEventListener("click", async (evt) => {
                evt.preventDefault();
                evt.stopPropagation();
                const seed = {
                  name: "New Effect",
                  icon: "icons/svg/aura.svg",
                  img:  "icons/svg/aura.svg",
                  changes: [],
                  disabled: false,
                  duration: {},
                  flags: {}
                };
                const updated = await editEffectViaStandardConfig(seed, {
                  parent: this.document,
                  title:  `Add Effect`
                });
                if (!updated) return;
                const eff = { ...updated };
                delete eff._id;
                workingEffects.push(eff);
                refreshEffects();
              });

              root.addEventListener("click", async (evt) => {
                const editBtn = evt.target.closest(".stn-edit-eff");
                if (editBtn) {
                  evt.preventDefault();
                  evt.stopPropagation();
                  const idx = parseInt(editBtn.dataset.idx);
                  const cur = workingEffects[idx];
                  if (!cur) return;
                  const updated = await editEffectViaStandardConfig(cur, {
                    parent: this.document,
                    title:  `Edit Effect: ${cur.name ?? ""}`
                  });
                  if (!updated) return;
                  const merged = { ...cur, ...updated };
                  delete merged._id;
                  workingEffects[idx] = merged;
                  refreshEffects();
                  return;
                }
                const delBtn = evt.target.closest(".stn-del-eff");
                if (delBtn) {
                  evt.preventDefault();
                  evt.stopPropagation();
                  const idx = parseInt(delBtn.dataset.idx);
                  if (Number.isFinite(idx)) {
                    workingEffects.splice(idx, 1);
                    refreshEffects();
                  }
                }
              });
            },
            rejectClose: false
          }).catch(() => false);
          if (ok) {
            const ni = ns.findIndex(n => n.id === nodeId);
            if (ni >= 0) {
              ns[ni] = node;
              try {
                await this.document.update({ "system.nodes": ns });
              } catch (err) {
                console.error("SD | Failed to save skill tree node config:", err);
                ui.notifications?.error?.(`Failed to save node: ${err?.message ?? err}`);
              }
            }
          }
        });
      });
    }

    return p;
  }

    _buildSysAttrsPanel(isActive) {
    const p=this._mkSysPanel("_sys_attrs",isActive);
    const e=this._e.bind(this); const sys=this.document.system; const ed=this.isEditable;
    const locked  = LOCKED_HIDDEN_FIELDS[this.document.type] ?? [];
    const lockedKeys = new Set(locked.map(f=>f.key));
    const stored  = sys.hiddenFields ?? {};
    const _structuredKeys = (this.document.type === "inventory")
      ? new Set(["saleable","salePrice","salePricePath","saleCurrency","equippable"])
      : new Set();
    const userRows = Object.entries(stored).filter(([k])=>!lockedKeys.has(k) && !_structuredKeys.has(k));
    const hfEmpty  = locked.length === 0 && userRows.length === 0;

    const renderLockedRow = ({key,placeholder}) => {
      const v = stored[key] ?? "";
      return `<div class="hf-row" data-locked="1"><div style="flex:0 0 130px;position:relative">
      <input type="text" value="${e(key)}" disabled title="Required field — cannot be renamed or removed" style="font-family:monospace;font-size:11px;width:100%;background:#141420;border:1px solid var(--sd-bg-3);border-radius:4px;color:var(--sd-accent);padding:3px 6px;box-sizing:border-box;cursor:not-allowed">
      <i class="fas fa-lock" style="position:absolute;right:6px;top:50%;transform:translateY(-50%);font-size:9px;color:var(--sd-border)" title="Locked"></i>
    </div>
    <input type="text" data-sys-hf-val="${e(key)}" value="${e(v)}" placeholder="${e(placeholder??"")}" style="flex:1;background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:4px;color:var(--sd-text);font-size:12px;padding:3px 7px;min-width:0" ${!ed?"disabled":""}>
    <button type="button" data-sys-action="copyHiddenFieldPath" data-key="${e(key)}" title="Copy path: system.hiddenFields.${e(key)}" style="background:none;border:none;color:var(--sd-text-3);cursor:pointer;font-size:11px;padding:0 4px" tabindex="-1"><i class="fas fa-copy"></i></button>
  </div>`;
    };
    const renderUserRow = ([k,v]) =>
      `<div class="hf-row"><div style="flex:0 0 130px;position:relative">
      <input type="text" data-sys-hf-key="${e(k)}" value="${e(k)}" style="font-family:monospace;font-size:11px;width:100%;background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:4px;color:var(--sd-accent);padding:3px 6px;box-sizing:border-box" ${!ed?"disabled":""}>
    </div>
    <input type="text" data-sys-hf-val="${e(k)}" value="${e(v)}" style="flex:1;background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:4px;color:var(--sd-text);font-size:12px;padding:3px 7px;min-width:0" ${!ed?"disabled":""}>
    <button type="button" data-sys-action="copyHiddenFieldPath" data-key="${e(k)}" title="Copy path: system.hiddenFields.${e(k)}" style="background:none;border:none;color:var(--sd-text-3);cursor:pointer;font-size:11px;padding:0 4px" tabindex="-1"><i class="fas fa-copy"></i></button>
    ${ed?`<button data-sys-action="removeHiddenField" data-key="${e(k)}" style="background:none;border:none;color:var(--sd-text-3);cursor:pointer;font-size:13px;padding:0 5px">✕</button>`:""}
  </div>`;

    const isInv = this.document.type === "inventory";
    const da=sys.declaredAttrs??[];

    const _curList = (Array.isArray(CONFIG?.SD?.currencies) && CONFIG.SD.currencies.length)
      ? CONFIG.SD.currencies
      : [{ key: "primary", label: "Gold" }, { key: "secondary", label: "Silver" }, { key: "tertiary", label: "Copper" }];
    const _catSeen = new Set();
    try {
      for (const it of (game.items ?? [])) {
        if (it.type === "inventory" && it.system?.category) _catSeen.add(String(it.system.category));
      }
      for (const a of (game.actors ?? [])) {
        for (const it of (a.items ?? [])) {
          if (it.type === "inventory" && it.system?.category) _catSeen.add(String(it.system.category));
        }
      }
    } catch (_) {  }
    const _catSuggestions = [..._catSeen].filter(Boolean).sort();
    const _datalistId = "sd-inv-cat-suggest";
    const curCat   = String(sys.category ?? "");
    const curPrice = Number(sys.price ?? 0);
    const curItemCurrency = String(sys.currency ?? _curList[0]?.key ?? "primary");

    p.innerHTML=`
${isInv ? `<datalist id="${_datalistId}">${_catSuggestions.map(c => `<option value="${e(c)}">`).join("")}</datalist>
<div class="sys-section" style="margin-bottom:12px">
  <div class="sys-section-header"><i class="fas fa-shield-halved"></i> ${e(game.i18n?.localize?.("SD.InventoryFlags") ?? "Inventory")}</div>
  <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px 12px;padding:4px 0;align-items:end">
    <label style="display:flex;flex-direction:column;gap:3px;font-size:11px;color:var(--sd-text-2)">
      <span style="text-transform:uppercase;letter-spacing:.04em;color:var(--sd-text-3);font-size:10px">${e(game.i18n?.localize?.("SD.Category") ?? "Category")}</span>
      <input type="text" data-sys-field="category" list="${_datalistId}" value="${e(curCat)}" placeholder="${e(game.i18n?.localize?.("SD.NoCategory") ?? "no category")}" ${!ed?"disabled":""} style="background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:4px;color:var(--sd-text);font-size:12px;padding:3px 7px">
    </label>
    <label style="display:flex;flex-direction:column;gap:3px;font-size:11px;color:var(--sd-text-2)">
      <span style="text-transform:uppercase;letter-spacing:.04em;color:var(--sd-text-3);font-size:10px">${e(game.i18n?.localize?.("SD.Price") ?? "Price")}</span>
      <input type="number" min="0" step="any" data-sys-field="price" value="${curPrice}" ${!ed?"disabled":""} style="background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:4px;color:var(--sd-text);font-size:12px;padding:3px 7px">
    </label>
    <label style="display:flex;flex-direction:column;gap:3px;font-size:11px;color:var(--sd-text-2)">
      <span style="text-transform:uppercase;letter-spacing:.04em;color:var(--sd-text-3);font-size:10px">${e(game.i18n?.localize?.("SD.Currency") ?? "Currency")}</span>
      <select data-sys-field="currency" ${!ed?"disabled":""} style="background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:4px;color:var(--sd-text);font-size:12px;padding:3px 6px">
        ${_curList.map(c => `<option value="${e(c.key)}" ${c.key===curItemCurrency?"selected":""}>${e(c.label ?? c.key)}</option>`).join("")}
      </select>
    </label>
  </div>
  <div style="display:flex;flex-wrap:wrap;gap:10px 20px;padding:6px 0 0;border-top:1px solid var(--sd-border);margin-top:8px">
    <label style="display:flex;align-items:center;gap:6px;cursor:${ed?"pointer":"not-allowed"};font-size:12px;color:var(--sd-text)">
      <input type="checkbox" data-sys-hf-val="equippable" ${(sys.hiddenFields?.equippable ?? sys.equippable)?"checked":""} ${!ed?"disabled":""} style="accent-color:var(--sd-accent);width:15px;height:15px;cursor:inherit">
      ${e(game.i18n?.localize?.("SD.Equippable") ?? "Equippable")}
    </label>
  </div>
</div>
` : ""}
<div class="sys-section">
  <div class="sys-section-header"><i class="fas fa-eye-slash"></i> Hidden Fields
    ${ed?`<button data-sys-action="addHiddenField" style="margin-left:auto" class="sys-add-btn"><i class="fas fa-plus"></i> Add</button>`:""}
  </div>
  <p style="font-size:11px;color:var(--sd-text-3);margin:0 0 8px;line-height:1.6">GM-only key/value pairs. Path: <code style="background:var(--sd-bg);padding:1px 5px;border-radius:3px;font-size:10px;color:var(--sd-accent)">system.hiddenFields.name</code>${locked.length?` — <span style="color:var(--sd-accent)">locked fields (<i class="fas fa-lock" style="font-size:9px"></i>) are required for this item type</span>`:""}</p>
  ${hfEmpty?`<div style="color:var(--sd-text-3);font-size:11px;padding:8px 0;font-style:italic">No hidden fields yet.</div>`:`<div style="display:flex;flex-direction:column;gap:4px">
    ${locked.map(renderLockedRow).join("")}
    ${userRows.map(renderUserRow).join("")}
  </div>`}
</div>
<div class="sys-section" style="margin-top:12px">
  <div class="sys-section-header"><i class="fas fa-tag"></i> Declared Attributes
    ${ed?`<button data-sys-action="addDeclaredAttr" style="margin-left:auto" class="sys-add-btn"><i class="fas fa-plus"></i> Add</button>`:""}
  </div>
  <p style="font-size:11px;color:var(--sd-text-3);margin:0 0 8px;line-height:1.6">Named path references — used in slot filters and button conditions.</p>
  ${da.length?`<div style="display:flex;flex-direction:column;gap:4px">
    ${da.map(a=>`<div style="display:flex;gap:5px;align-items:center">
      <input type="text" data-sys-da-name="${e(a.id)}" value="${e(a.name??a.id)}" placeholder="attr_name" style="flex:0 0 100px;background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:4px;color:var(--sd-accent);font-size:11px;font-family:monospace;padding:3px 6px;box-sizing:border-box" ${!ed?"disabled":""}>
      <input type="text" data-sys-da-path="${e(a.id)}" value="${e(a.path??"")}" placeholder="system.hiddenFields.key" style="flex:1;background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:4px;color:var(--sd-text);font-size:11px;font-family:monospace;padding:3px 6px;min-width:0" ${!ed?"disabled":""}>
      ${ed?`<button data-sys-action="removeDeclaredAttr" data-attr-id="${e(a.id)}" style="background:none;border:none;color:var(--sd-text-3);cursor:pointer;font-size:13px;padding:0 5px">✕</button>`:""}
    </div>`).join("")}
  </div>`:`<div style="color:var(--sd-text-3);font-size:11px;padding:8px 0;font-style:italic">No declared attributes yet.</div>`}
</div>`;
    return p;
  }

  _buildSysGraphPanel(isActive) {
    const p = this._mkSysPanel("_sys_graph", isActive);
    const sys = this.document.system;
    const hasGraph = !!(sys.onClickGraph?.nodes?.length);
    const hasFormula = !!(sys.onClickFormula && sys.onClickFormula !== "0");

    p.innerHTML = `
      <div class="sys-section">
        <div class="sys-section-header">
          <i class="fas fa-project-diagram"></i> On Click Graph
        </div>
        <p style="font-size:11px;color:var(--sd-text-3);margin:0 0 10px;line-height:1.6">
          Define what happens when this item is <strong>Used</strong> — from inventory, item slots, or the Use button.
          Build a node graph with an <strong>On Click</strong> trigger node.
        </p>
        <div style="display:flex;flex-direction:column;align-items:center;gap:10px;padding:10px 0">
          <div style="font-size:11px;color:${hasGraph ? 'var(--sd-stamina)' : '#555'};display:flex;align-items:center;gap:6px">
            <i class="fas fa-${hasGraph ? 'check-circle' : 'circle'}" style="font-size:14px"></i>
            ${hasGraph ? `Graph configured (${sys.onClickGraph.nodes.length} nodes)` : 'No graph configured — uses default roll behaviour'}
          </div>
          <button type="button" data-sys-action="openOnClickGraph"
            style="padding:8px 20px;background:var(--sd-accent-2);border:1px solid var(--sd-accent);border-radius:5px;color:#fff;cursor:pointer;font-size:12px;font-weight:700;display:flex;align-items:center;gap:8px">
            <i class="fas fa-project-diagram"></i>
            ${hasGraph ? 'Edit On Click Graph' : 'Create On Click Graph'}
          </button>
          ${hasGraph ? `<button type="button" data-sys-action="clearOnClickGraph"
            style="padding:5px 14px;background:transparent;border:1px solid #6a2a2a;border-radius:4px;color:#c04040;cursor:pointer;font-size:11px">
            <i class="fas fa-trash" style="margin-right:4px"></i>Clear Graph
          </button>` : ''}
        </div>
      </div>`;

    p.querySelector("[data-sys-action='openOnClickGraph']")?.addEventListener("click", async () => {
      const { FormulaGraph } = await import("../builder/formula-graph.mjs");
      const graph = new FormulaGraph(null, this.document, null, null, { doc: this.document });
      graph.open();
    });
    p.querySelector("[data-sys-action='clearOnClickGraph']")?.addEventListener("click", async () => {
      const ok = await foundry.applications.api.DialogV2.confirm({
        window: { title: "Clear Graph" },
        content: "<p>Clear the On Click graph?</p>"
      }).catch(() => false);
      if (ok) {
        await this.document.update({ "system.onClickGraph": {}, "system.onClickFormula": "0" });
      }
    });

    return p;
  }

  _buildSysSlotsPanel(isActive) {
    const p=this._mkSysPanel("_sys_slots",isActive);
    const e=this._e.bind(this); const sys=this.document.system; const ed=this.isEditable;
    const defs=sys.slotDefinitions??[];
    let html=`<div class="sys-section"><div class="sys-section-header"><i class="fas fa-layer-group"></i> Slots
      ${ed?`<button data-sys-action="addSlot" style="margin-left:auto" class="sys-add-btn"><i class="fas fa-plus"></i> Add Slot</button>`:""}
    </div>`;
    if (!defs.length) html+=`<div style="color:var(--sd-text-3);font-size:11px;padding:16px 0;font-style:italic;text-align:center"><i class="fas fa-layer-group" style="opacity:.3;font-size:28px;display:block;margin-bottom:8px"></i>No slots. Add one to nest items inside this item.</div>`;
    defs.forEach((def,idx)=>{
      const contents=SlotManager.getContents(this.document,def.id);
      html+=`<div class="slot-def-block" style="margin-bottom:10px;background:var(--sd-bg);border:1px solid var(--sd-bg-3);border-radius:6px;padding:10px">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
          <span style="font-size:10px;font-family:monospace;background:var(--sd-bg-3);border:1px solid var(--sd-border);border-radius:3px;padding:2px 6px;color:var(--sd-accent);flex-shrink:0">${e(def.id)}</span>
          <input type="text" data-sys-slot="label" data-slot-idx="${idx}" value="${e(def.label)}" style="flex:1;background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:4px;color:var(--sd-text);font-size:13px;font-weight:600;padding:3px 7px" ${!ed?"disabled":""}>
          <input type="number" data-sys-slot="maxCount" data-slot-idx="${idx}" value="${def.maxCount??1}" min="1" style="width:50px;text-align:center;background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:4px;color:var(--sd-text);font-size:12px;padding:3px" title="Max items" ${!ed?"disabled":""}>
          <label style="font-size:11px;color:var(--sd-text-2);text-transform:none;display:flex;align-items:center;gap:4px;cursor:pointer;flex-shrink:0"><input type="checkbox" data-sys-slot="removable" data-slot-idx="${idx}" ${def.removable?"checked":""} ${!ed?"disabled":""}> Removable</label>
          ${ed?`<button data-sys-action="removeSlot" data-slot-idx="${idx}" style="background:none;border:none;color:var(--sd-text-3);cursor:pointer;font-size:14px;padding:0 4px" title="Remove">✕</button>`:""}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px">
          <div><div style="font-size:10px;color:var(--sd-text-3);margin-bottom:3px;text-transform:uppercase;letter-spacing:.05em">Allowed Types</div>
          <input type="text" data-sys-slot="allowedTypes" data-slot-idx="${idx}" value="${e((def.allowedTypes??[]).join(', '))}" placeholder="inventory (empty=any)" style="width:100%;background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:4px;color:var(--sd-text);font-size:11px;font-family:monospace;padding:3px 7px;box-sizing:border-box" ${!ed?"disabled":""}></div>
          <div><div style="font-size:10px;color:var(--sd-text-3);margin-bottom:3px;text-transform:uppercase;letter-spacing:.05em">Allowed Categories</div>
          <input type="text" data-sys-slot="allowedCategories" data-slot-idx="${idx}" value="${e((def.allowedCategories??[]).join(', '))}" placeholder="ammo, magazine (empty=any)" style="width:100%;background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:4px;color:var(--sd-text);font-size:11px;font-family:monospace;padding:3px 7px;box-sizing:border-box" ${!ed?"disabled":""}></div>
        </div>
        <div class="sd-slot-tile-config" style="margin-bottom:8px;background:var(--sd-bg);border:1px solid var(--sd-bg-3);border-radius:4px;padding:5px 8px" title="Used by the 'Equipment Tile' slot widget variant: placeholder icon shown when slot is empty + corner-bracket accent color.">
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:10px;color:var(--sd-text-3);text-transform:uppercase;letter-spacing:.05em;flex-shrink:0"><i class="fas fa-image"></i> Tile</span>
            <div style="position:relative;width:32px;height:32px;flex-shrink:0;border:1px solid var(--sd-border);border-radius:4px;background:var(--sd-bg-2);display:flex;align-items:center;justify-content:center;overflow:hidden">
              ${def.placeholderIcon ? `<img src="${e(def.placeholderIcon)}" alt="" style="max-width:100%;max-height:100%;opacity:.85" draggable="false">` : `<i class="fas fa-image" style="opacity:.3;font-size:14px"></i>`}
            </div>
            ${ed?`<button type="button" data-sys-action="toggleSlotPresets" data-slot-idx="${idx}" style="background:var(--sd-bg-3);border:1px solid var(--sd-border);border-radius:3px;color:var(--sd-text-2);cursor:pointer;font-size:10px;padding:2px 7px" title="Choose from built-in equipment icons"><i class="fas fa-th"></i> Presets</button>`:""}
            ${ed?`<button type="button" data-sys-action="pickSlotIcon" data-slot-idx="${idx}" style="background:var(--sd-bg-3);border:1px solid var(--sd-border);border-radius:3px;color:var(--sd-text-2);cursor:pointer;font-size:10px;padding:2px 7px" title="Pick custom image"><i class="fas fa-folder-open"></i> Custom</button>`:""}
            ${ed&&def.placeholderIcon?`<button type="button" data-sys-action="clearSlotIcon" data-slot-idx="${idx}" style="background:none;border:none;color:var(--sd-text-3);cursor:pointer;font-size:11px;padding:0 4px" title="Clear placeholder">✕</button>`:""}
            <span style="font-size:10px;color:var(--sd-text-3);margin-left:6px">Accent</span>
            <input type="color" data-sys-slot="accentColor" data-slot-idx="${idx}" value="${e(def.accentColor || '#d4b15a')}" style="width:30px;height:24px;background:transparent;border:1px solid var(--sd-border);border-radius:3px;cursor:pointer;padding:0" title="Accent color (corner brackets)" ${!ed?"disabled":""}>
            <input type="text" data-sys-slot="accentColor" data-slot-idx="${idx}" value="${e(def.accentColor || '')}" placeholder="#d4b15a (empty=theme)" style="flex:1;min-width:0;background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:3px;color:var(--sd-text);font-size:11px;font-family:monospace;padding:2px 5px" ${!ed?"disabled":""}>
          </div>
          <div class="sd-slot-preset-grid" data-slot-idx="${idx}" style="display:none;margin-top:8px;padding-top:8px;border-top:1px dashed var(--sd-bg-3);grid-template-columns:repeat(auto-fill,minmax(48px,1fr));gap:4px">
            ${SD_SLOT_ICON_PRESETS.map(p=>{
              const sel = def.placeholderIcon === SD_SLOT_ICON_PATH(p.name);
              return `<button type="button" data-sys-action="setSlotPreset" data-slot-idx="${idx}" data-icon-name="${e(p.name)}" title="${e(p.label)}" style="aspect-ratio:1/1;background:${sel?'color-mix(in srgb, var(--sd-accent) 22%, var(--sd-bg-2))':'var(--sd-bg-2)'};border:1px solid ${sel?'var(--sd-accent)':'var(--sd-border)'};border-radius:4px;cursor:pointer;padding:5px;display:flex;align-items:center;justify-content:center;transition:border-color .12s,background .12s" onmouseover="this.style.borderColor='var(--sd-accent)'" onmouseout="this.style.borderColor='${sel?'var(--sd-accent)':'var(--sd-border)'}'">
                <img src="${e(SD_SLOT_ICON_PATH(p.name))}" alt="${e(p.label)}" style="max-width:100%;max-height:100%;opacity:.85;pointer-events:none" draggable="false">
              </button>`;
            }).join("")}
          </div>
        </div>
        <div style="margin-bottom:8px">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
            <span style="font-size:10px;color:var(--sd-text-3);text-transform:uppercase;letter-spacing:.05em"><i class="fas fa-filter"></i> Attr Filters</span>
            ${ed?`<button data-sys-action="addAttrFilter" data-slot-idx="${idx}" style="background:var(--sd-bg-3);border:1px solid var(--sd-border);border-radius:3px;color:var(--sd-text-2);cursor:pointer;font-size:10px;padding:1px 7px">+ Add</button>`:""}
            <div class="slot-drop-filter-zone" data-slot-idx="${idx}" style="flex:1;border:1px dashed var(--sd-bg-3);border-radius:4px;padding:3px 8px;font-size:10px;color:var(--sd-text-3);text-align:center;cursor:pointer;transition:background .15s"><i class="fas fa-arrow-down-to-line" style="opacity:.4;margin-right:3px"></i>Drop item to add filter</div>
          </div>
          ${(def.attrFilters??[]).map((f,fIdx)=>`<div style="display:flex;align-items:center;gap:4px;margin-bottom:3px;background:var(--sd-bg);border:1px solid var(--sd-bg-3);border-radius:4px;padding:3px 6px">
            <span style="flex:1;font-size:10px;color:var(--sd-accent);font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${e(f.fieldLabel||f.fieldPath)}</span>
            <select data-sys-af="operator" data-slot-idx="${idx}" data-filter-idx="${fIdx}" style="font-size:11px;background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:3px;color:var(--sd-text);padding:2px" ${!ed?"disabled":""}>
              ${[["==","= eq"],["!=","≠"],[">" ,">"],["<","<"],[">=","≥"],["<=","≤"]].map(([v,l])=>`<option value="${v}" ${f.operator===v?"selected":""}>${l}</option>`).join("")}
            </select>
            <input type="text" data-sys-af="expectedValue" data-slot-idx="${idx}" data-filter-idx="${fIdx}" value="${e(f.expectedValue??'')}" style="width:65px;background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:3px;color:var(--sd-text);font-size:11px;padding:2px 5px" ${!ed?"disabled":""}>
            ${ed?`<button data-sys-action="removeAttrFilter" data-slot-idx="${idx}" data-filter-idx="${fIdx}" style="background:none;border:none;color:var(--sd-text-3);cursor:pointer;font-size:12px;padding:0 3px">✕</button>`:""}
          </div>`).join("")}
        </div>
        <div style="margin-bottom:8px">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
            <span style="font-size:10px;color:var(--sd-text-3);text-transform:uppercase;letter-spacing:.05em" title="When an item is dropped into this slot, ActiveEffect(s) are created on the parent actor. Each row reads a value from the slotted item's field and writes it to an actor field via Foundry ActiveEffect.modes."><i class="fas fa-bolt"></i> Changes if Equipped</span>
            ${ed?`<button data-sys-action="addSlotChange" data-slot-idx="${idx}" style="background:var(--sd-bg-3);border:1px solid var(--sd-border);border-radius:3px;color:var(--sd-text-2);cursor:pointer;font-size:10px;padding:1px 7px">+ Add</button>`:""}
          </div>
          ${(def.changes??[]).length===0?`<div style="font-size:10px;color:var(--sd-text-3);opacity:.6;padding:2px 4px;font-style:italic">No changes yet. Add pairs of "item field → actor field" to synthesize ActiveEffects while equipped.</div>`:""}
          ${(def.changes??[]).map((ch,cIdx)=>`<div style="display:grid;grid-template-columns:1fr 8px 1fr 86px 52px auto;gap:4px;align-items:center;margin-bottom:3px;background:var(--sd-bg);border:1px solid var(--sd-bg-3);border-radius:4px;padding:3px 6px">
            <input type="text" data-sys-slot-change="itemFieldPath" data-slot-idx="${idx}" data-change-idx="${cIdx}" value="${e(ch.itemFieldPath??'')}" placeholder="system.hiddenFields.bonus" title="Item field path (what to read)" style="font-size:11px;background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:3px;color:var(--sd-text);font-family:monospace;padding:2px 5px;min-width:0" ${!ed?"disabled":""}>
            <span style="color:var(--sd-text-3);font-size:10px;text-align:center">→</span>
            <input type="text" data-sys-slot-change="actorFieldPath" data-slot-idx="${idx}" data-change-idx="${cIdx}" value="${e(ch.actorFieldPath??'')}" placeholder="system.attack.bonus" title="Actor field path (what to modify)" style="font-size:11px;background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:3px;color:var(--sd-text);font-family:monospace;padding:2px 5px;min-width:0" ${!ed?"disabled":""}>
            <select data-sys-slot-change="mode" data-slot-idx="${idx}" data-change-idx="${cIdx}" title="Effect mode" style="font-size:11px;background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:3px;color:var(--sd-text);padding:2px" ${!ed?"disabled":""}>
              ${[[2,"Add"],[1,"Multiply"],[5,"Override"],[4,"Upgrade"],[3,"Downgrade"],[0,"Custom"]].map(([v,l])=>`<option value="${v}" ${Number(ch.mode)===v?"selected":""}>${l}</option>`).join("")}
            </select>
            <input type="number" data-sys-slot-change="priority" data-slot-idx="${idx}" data-change-idx="${cIdx}" value="${ch.priority??20}" title="Priority" style="font-size:11px;background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:3px;color:var(--sd-text);font-family:monospace;padding:2px 4px;text-align:center" ${!ed?"disabled":""}>
            ${ed?`<button data-sys-action="removeSlotChange" data-slot-idx="${idx}" data-change-idx="${cIdx}" style="background:none;border:none;color:var(--sd-text-3);cursor:pointer;font-size:12px;padding:0 3px" title="Remove">✕</button>`:""}
          </div>`).join("")}
        </div>
        <div class="slot-contents-area" data-drop-slot="${e(def.id)}" style="border:1px dashed ${contents.length?'#4b3e9e':'var(--sd-bg-3)'};border-radius:5px;padding:6px;min-height:32px">
          <div style="font-size:10px;color:var(--sd-text-3);margin-bottom:${contents.length?'5':'0'}px;display:flex;align-items:center;gap:5px"><i class="fas fa-layer-group" style="opacity:.4"></i>
            Contents <strong style="color:${contents.length>=def.maxCount?'var(--sd-hp)':'var(--sd-stamina)'}">${contents.length}/${def.maxCount}</strong>
            ${contents.length<def.maxCount?`<span style="color:var(--sd-text-3);font-size:10px">— drop item here</span>`:""}
          </div>
          ${contents.map((c,ci)=>`<div style="display:flex;align-items:center;gap:6px;padding:3px 2px;border-bottom:1px solid var(--sd-bg)">
            <img src="${e(c.img??'icons/svg/item-bag.svg')}" style="width:20px;height:20px;object-fit:cover;border-radius:3px;flex-shrink:0">
            <span style="flex:1;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${e(c.name??'?')}</span>
            ${Object.entries(c.system?.hiddenFields??{}).map(([k,v])=>`<span style="font-size:10px;color:var(--sd-text-3);font-family:monospace;flex-shrink:0">${e(k)}=${e(String(v))}</span>`).join('')}
            ${ed&&def.removable?`<button data-sys-action="removeFromSlot" data-slot-id="${e(def.id)}" data-slot-idx="${ci}" style="background:none;border:none;color:var(--sd-text-3);cursor:pointer;font-size:12px;padding:0 4px" title="Remove">⏏</button>`:""}
          </div>`).join("")}
        </div>
      </div>`;
    });
    html+="</div>"; p.innerHTML=html; return p;
  }

  _buildSysButtonsPanel(isActive) {
    const p=this._mkSysPanel("_sys_buttons",isActive);
    const e=this._e.bind(this); const sys=this.document.system; const ed=this.isEditable;
    const btns=sys.buttons??[];
    let html=`<div class="sys-section"><div class="sys-section-header"><i class="fas fa-bolt"></i> Custom Buttons
      ${ed?`<button data-sys-action="addButton" style="margin-left:auto" class="sys-add-btn"><i class="fas fa-plus"></i> Add Button</button>`:""}
    </div>
    <p style="font-size:11px;color:var(--sd-text-3);margin:0 0 10px;line-height:1.6">Buttons appear on item rows in inventory. Chain conditions + actions.</p>`;
    if (!btns.length) html+=`<div style="color:var(--sd-text-3);font-size:11px;padding:16px 0;font-style:italic;text-align:center"><i class="fas fa-bolt" style="opacity:.3;font-size:28px;display:block;margin-bottom:8px"></i>No buttons yet.</div>`;
    btns.forEach((btn,bIdx)=>{
      html+=`<div style="background:var(--sd-bg);border:1px solid var(--sd-bg-3);border-radius:6px;padding:10px;margin-bottom:10px">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
          <i class="fas ${e(btn.icon??'fa-bolt')}" style="color:${e(btn.color??'var(--sd-accent)')};font-size:16px;flex-shrink:0"></i>
          <input type="text" data-sys-btn="label" data-btn-idx="${bIdx}" value="${e(btn.label)}" placeholder="Button label" style="flex:1;background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:4px;color:var(--sd-text);font-size:13px;font-weight:600;padding:3px 7px" ${!ed?"disabled":""}>
          <input type="text" data-sys-btn="icon" data-btn-idx="${bIdx}" value="${e(btn.icon??'fa-bolt')}" placeholder="fa-bolt" style="width:88px;background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:4px;color:var(--sd-text);font-size:11px;font-family:monospace;padding:3px 6px" ${!ed?"disabled":""}>
          <input type="color" data-sys-btn="color" data-btn-idx="${bIdx}" value="${e(btn.color??'var(--sd-accent)')}" style="width:34px;height:28px;padding:2px;border:1px solid var(--sd-border);border-radius:4px;background:var(--sd-bg);cursor:pointer" ${!ed?"disabled":""}>
          <select data-sys-btn="showIn" data-btn-idx="${bIdx}" style="background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:4px;color:var(--sd-text);font-size:11px;padding:3px;height:28px" ${!ed?"disabled":""}>
            <option value="inline" ${btn.showIn==="inline"?"selected":""}>Item row</option>
            <option value="sheet"  ${btn.showIn==="sheet"?"selected":""}>Sheet</option>
            <option value="both"   ${btn.showIn==="both"?"selected":""}>Both</option>
          </select>
          ${ed?`<button data-sys-action="removeButton" data-btn-idx="${bIdx}" style="background:none;border:none;color:var(--sd-text-3);cursor:pointer;font-size:14px;padding:0 4px">✕</button>`:""}
        </div>
        <div style="background:var(--sd-bg);border:1px solid var(--sd-bg-3);border-radius:5px;padding:6px 8px;margin-bottom:6px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px">
            <span style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--sd-text-3)"><i class="fas fa-list"></i> Actions</span>
            ${ed?`<button data-sys-action="addAction" data-btn-idx="${bIdx}" style="background:var(--sd-bg-3);border:1px solid var(--sd-border);border-radius:3px;color:var(--sd-text-2);cursor:pointer;font-size:10px;padding:1px 8px">+ Action</button>`:""}
          </div>
          ${!(btn.actions??[]).length?`<div style="color:#333;font-size:11px;font-style:italic">No actions yet.</div>`:""}
          ${(btn.actions??[]).map((act,aIdx)=>`<div style="display:flex;align-items:center;gap:4px;margin-bottom:4px;background:var(--sd-bg);border:1px solid var(--sd-bg-3);border-radius:4px;padding:4px 6px">
            <select data-sys-act="type" data-btn-idx="${bIdx}" data-act-idx="${aIdx}" style="flex:0 0 110px;background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:3px;color:var(--sd-text);font-size:11px;padding:2px" ${!ed?"disabled":""}>
              <option value="roll"        ${act.type==="roll"?"selected":""}>🎲 Roll</option>
              <option value="modifyField" ${act.type==="modifyField"?"selected":""}>📝 Modify Field</option>
              <option value="message"     ${act.type==="message"?"selected":""}>💬 Message</option>
              <option value="createItem"  ${act.type==="createItem"?"selected":""}>➕ Create Item</option>
              <option value="removeItem"  ${act.type==="removeItem"?"selected":""}>➖ Remove Item</option>
              <option value="playSound"   ${act.type==="playSound"?"selected":""}>🔊 Sound</option>
            </select>
            ${act.type==="roll"?`<input type="text" data-sys-act="formula" data-btn-idx="${bIdx}" data-act-idx="${aIdx}" value="${e(act.formula??'1d6')}" placeholder="1d6+@attr1" style="flex:1;background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:3px;color:var(--sd-text);font-size:11px;font-family:monospace;padding:2px 6px;min-width:0" ${!ed?"disabled":""}>`:""}
            ${act.type==="modifyField"?`<input type="text" data-sys-act="target" data-btn-idx="${bIdx}" data-act-idx="${aIdx}" value="${e(act.target??'self.system.uses.value')}" placeholder="self.system.field" style="flex:1;background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:3px;color:var(--sd-text);font-size:11px;font-family:monospace;padding:2px 6px;min-width:0" ${!ed?"disabled":""}><input type="number" data-sys-act="delta" data-btn-idx="${bIdx}" data-act-idx="${aIdx}" value="${act.delta??-1}" style="width:55px;background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:3px;color:var(--sd-text);font-size:11px;padding:2px;text-align:center;flex-shrink:0" ${!ed?"disabled":""}>`:""}
            ${act.type==="message"?`<input type="text" data-sys-act="messageText" data-btn-idx="${bIdx}" data-act-idx="${aIdx}" value="${e(act.messageText??'')}" placeholder="Message text…" style="flex:1;background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:3px;color:var(--sd-text);font-size:12px;padding:2px 6px;min-width:0" ${!ed?"disabled":""}>`:""}
            ${!["roll","modifyField","message"].includes(act.type)?`<span style="flex:1;font-size:11px;color:var(--sd-text-3);font-style:italic">name/data fields in JSON</span>`:""}
            ${ed?`<button data-sys-action="removeAction" data-btn-idx="${bIdx}" data-act-idx="${aIdx}" style="background:none;border:none;color:var(--sd-text-3);cursor:pointer;font-size:12px;padding:0 4px;flex-shrink:0">✕</button>`:""}
          </div>`).join("")}
        </div>
        <button type="button" data-sys-action="fireButton" data-btn-idx="${bIdx}" style="width:100%;padding:5px;background:var(--sd-bg-3);border:1px solid var(--sd-border);border-radius:4px;color:var(--sd-text-2);cursor:pointer;font-size:11px;transition:background .15s"><i class="fas fa-play" style="color:var(--sd-accent);margin-right:5px"></i>Test: ${e(btn.label)}</button>
      </div>`;
    });
    html+="</div>"; p.innerHTML=html; return p;
  }

  _mkSysPanel(tabId, isActive) {
    const p=document.createElement("div");
    p.className="sd-tab-panel sd-sys-panel"; p.dataset.tabId=tabId;
    p.style.cssText=`display:${isActive?"flex":"none"};flex:1;overflow-y:auto;padding:12px 14px;flex-direction:column;gap:0;min-height:0;`;
    return p;
  }

  _buildSysEffectsPanel(isActive) {
    const p   = this._mkSysPanel("_sys_effects", isActive);
    const doc = this.document;
    const e   = s => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
    const effects = [...(doc.effects ?? [])];

    const isEquippable = doc?.type === "inventory" && doc.system?.equippable === true;

    let rows = "";
    for (const ef of effects) {
      const disabled  = ef.disabled ? "effect-disabled" : "";
      const dur       = effectDurationLabel(ef);
      const eyeIcon   = ef.disabled ? "fa-eye-slash" : "fa-eye";
      const transfers = ef.transfer !== false;
      const tColor    = transfers ? "var(--sd-success)" : "var(--sd-warn)";
      const tIcon     = transfers ? "fa-arrow-right-to-bracket" : "fa-lock";
      const tTitle    = transfers ? "Transfers to actor when item is owned" : "Does NOT transfer to actor";
      const aoe       = !!(ef.flags?.sd?.activateOnEquip);
      const aoeColor  = aoe ? "var(--sd-warn,#b58a2a)" : "var(--sd-text-3)";
      const aoeTitle  = aoe ? "Active only while equipped" : "Toggle: Activate on Equip";
      rows += `
      <li class="effect-row ${disabled}" data-effect-id="${e(ef.id)}" style="display:flex;align-items:center;gap:6px;padding:6px 8px;border-radius:5px;background:var(--sd-bg-2);margin-bottom:5px;border-left:3px solid ${transfers ? "var(--sd-success)" : "var(--sd-border)"}">
        <img src="${e(ef.img ?? ef.icon ?? "icons/svg/aura.svg")}" alt="${e(ef.name)}"
             style="width:28px;height:28px;object-fit:cover;border-radius:4px;flex-shrink:0;opacity:${ef.disabled ? ".35" : "1"}">
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;color:${ef.disabled ? "var(--sd-text-3)" : "var(--sd-text)"};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600">${e(ef.name)}</div>
          <div style="display:flex;gap:6px;margin-top:2px;align-items:center">
            <span title="${tTitle}" style="font-size:9px;color:${tColor};display:flex;align-items:center;gap:3px;cursor:default">
              <i class="fas ${tIcon}"></i>${transfers ? "transfers to actor" : "item only"}
            </span>
            ${dur ? `<span style="font-size:9px;color:var(--sd-text-3)">⏱ ${e(dur)}</span>` : ""}
            ${ef.changes?.length ? `<span style="font-size:9px;color:var(--sd-accent-2,var(--sd-accent))">${ef.changes.length} change${ef.changes.length!==1?"s":""}</span>` : ""}
          </div>
        </div>
        <div style="display:flex;gap:2px;flex-shrink:0">
          <button type="button" data-action="sysEffectTransfer" data-effect-id="${e(ef.id)}"
            title="${tTitle}"
            style="background:none;border:none;color:${tColor};cursor:pointer;font-size:12px;padding:2px 5px">
            <i class="fas ${tIcon}"></i>
          </button>
          ${isEquippable ? `<button type="button" data-action="sysEffectActivateOnEquip" data-effect-id="${e(ef.id)}"
            title="${aoeTitle}"
            style="background:none;border:none;color:${aoeColor};cursor:pointer;font-size:12px;padding:2px 5px">
            <i class="fas fa-shield"></i>
          </button>` : ""}
          <button type="button" data-action="sysEffectToggle" data-effect-id="${e(ef.id)}"
            title="${ef.disabled ? "Enable" : "Disable"}"
            style="background:none;border:none;color:${ef.disabled ? "var(--sd-text-3)" : "var(--sd-accent)"};cursor:pointer;font-size:12px;padding:2px 5px">
            <i class="fas ${eyeIcon}"></i>
          </button>
          <button type="button" data-action="sysEffectEdit" data-effect-id="${e(ef.id)}"
            title="Edit" style="background:none;border:none;color:var(--sd-text-2);cursor:pointer;font-size:12px;padding:2px 5px">
            <i class="fas fa-pen"></i>
          </button>
          <button type="button" data-action="sysEffectDelete" data-effect-id="${e(ef.id)}"
            title="Delete" style="background:none;border:none;color:var(--sd-danger);cursor:pointer;font-size:12px;padding:2px 5px;opacity:.65">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </li>`;
    }

    p.innerHTML = `
      <div style="background:var(--sd-bg-2);border:1px solid var(--sd-border);border-radius:5px;padding:8px 10px;margin-bottom:10px;font-size:10px;color:var(--sd-text-3);line-height:1.6">
        <i class="fas fa-circle-info" style="color:var(--sd-accent);margin-right:4px"></i>
        Effects marked <strong style="color:var(--sd-success)">transfers to actor</strong> are automatically applied to the owning actor when this item is in their inventory, and removed when the item is deleted.
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <span style="font-size:11px;color:var(--sd-text-3)">${effects.length} effect${effects.length !== 1 ? "s" : ""}</span>
        <button type="button" data-action="sysEffectCreate"
          style="background:var(--sd-accent-glow);border:1px solid var(--sd-accent);border-radius:4px;color:var(--sd-accent);cursor:pointer;font-size:11px;font-weight:600;padding:4px 12px;display:flex;align-items:center;gap:5px">
          <i class="fas fa-plus"></i> Add Effect
        </button>
      </div>
      ${effects.length
        ? `<ul style="list-style:none;margin:0;padding:0">${rows}</ul>`
        : `<div style="text-align:center;padding:24px 0;color:var(--sd-border);font-size:12px"><i class="fas fa-sparkles" style="font-size:24px;display:block;margin-bottom:8px;opacity:.3"></i>No active effects</div>`
      }`;

    this._wireSysEffectsPanel(p);
    return p;
  }

  _wireSysEffectsPanel(panel) {
    const doc = this.document;

    panel.addEventListener("click", async ev => {
      const btn = ev.target.closest("[data-action^='sysEffect']");
      if (!btn) return;
      ev.stopPropagation();
      const efId = btn.dataset.effectId;

      switch (btn.dataset.action) {
        case "sysEffectCreate": {
          const cls = foundry.utils.getDocumentClass("ActiveEffect");
          await cls.createDialog({}, { parent: doc });
          break;
        }
        case "sysEffectToggle": {
          const ef = doc.effects?.get(efId);
          if (ef) await ef.update({ disabled: !ef.disabled });
          break;
        }
        case "sysEffectEdit": {
          const ef = doc.effects?.get(efId);
          if (ef) ef.sheet.render(true);
          break;
        }
        case "sysEffectTransfer": {
          const ef = doc.effects?.get(efId);
          if (ef) await ef.update({ transfer: ef.transfer === false ? true : false });
          break;
        }
        case "sysEffectActivateOnEquip": {
          const ef = doc.effects?.get(efId);
          if (!ef) break;
          const next = !(ef.flags?.sd?.activateOnEquip);
          const wantDisabled = next ? !doc.system?.equipped : ef.disabled;
          await ef.update({
            "flags.sd.activateOnEquip": next,
            disabled: wantDisabled
          });
          break;
        }
        case "sysEffectDelete": {
          const ef = doc.effects?.get(efId);
          if (!ef) break;
          const ok = await foundry.applications.api.DialogV2.confirm({
            window: { title: "Delete Effect" },
            content: `<p>Delete <strong>${ef.name}</strong>?</p>`
          });
          if (ok) await ef.delete();
          break;
        }
      }
    });
  }

  _wireAllInteractions() {
    const root=this.element; if (!root) return;
    const con=root.querySelector(".sd-panels-container"); if (!con) return;
    if (con._sdWired) { this._wirePerElementInteractions(con); return; }
    con._sdWired = true;
    con.addEventListener("click", this._onPanelClick.bind(this));
    con.addEventListener("change", this._onPanelChange.bind(this));

    con.addEventListener("click", async ev => {
      const skillPip = ev.target.closest(".skill-pip[data-path][data-rank]");
      if (!skillPip) return;
      ev.stopPropagation();
      const path = skillPip.dataset.path;
      const r    = Number(skillPip.dataset.rank) || 0;
      const cur  = Number(foundry.utils.getProperty(this.document, path)) || 0;
      const next = cur === r ? r - 1 : r;
      await this.document.update({ [path]: Math.max(0, next) });
    });

    con.addEventListener("contextmenu", async ev => {
      const pipRow = ev.target.closest(".skill-pip-row[data-path]");
      if (!pipRow) return;
      ev.preventDefault();
      ev.stopPropagation();
      await this.document.update({ [pipRow.dataset.path]: 0 });
    });

    con.addEventListener("click", async ev => {
      const btn = ev.target.closest("[data-action='removeFromSlot']");
      if (!btn) return;
      ev.stopPropagation();
      const slotId = btn.dataset.slotId;
      const idx    = parseInt(btn.dataset.slotIndex ?? btn.dataset.slotIdx ?? "0");
      await SlotManager.removeFromSlot(this.document, slotId, idx);
    });

    con.addEventListener("click", async ev => {
      const btn = ev.target.closest("[data-action='slotItemUse']");
      if (!btn) return;
      ev.stopPropagation();
      const slotId   = btn.dataset.slotId;
      const idx      = parseInt(btn.dataset.slotIndex ?? "0");
      const contents = SlotManager.getContents(this.document, slotId);
      const itemData = contents[idx];
      if (!itemData) return;
      const actor = this.document.actor;
      let item = actor?.items?.get(itemData._id) ?? null;

      if (!item) item = actor?.items?.find(i => i.name === itemData.name) ?? null;
      if (!item && itemData.uuid) { try { item = await fromUuid(itemData.uuid); } catch {} }
      if (!item) {
        try {
          const ItemCls = foundry.utils.getDocumentClass("Item");
          item = new ItemCls(itemData, { parent: null })
        } catch(e) { console.warn("SD | slotItemUse (item-sheet): could not build temp item:", e); }
      }
      if (item) await item.use({});
    });

    const _resolveSlottedItem = async (itemId, itemUuid, snapshot, parentDoc) => {
      const actor = parentDoc instanceof Actor ? parentDoc : (parentDoc?.actor ?? null);
      let item = itemId ? (actor?.items?.get(itemId) ?? null) : null;
      if (!item && itemUuid) { try { item = await fromUuid(itemUuid); } catch {} }
      if (!item && snapshot?._sourceUuid) { try { item = await fromUuid(snapshot._sourceUuid); } catch {} }

      if (!item && itemId) { try { item = await fromUuid("Item." + itemId); } catch {} }
      if (!item && snapshot?.name) {
        item = actor?.items?.find(i => i.name === snapshot.name) ?? null;
      }
      return item ?? null;
    };

    con.addEventListener("click", async ev => {
      const btn = ev.target.closest("[data-action='slotItemEdit']");
      if (!btn) return;
      ev.stopPropagation();
      const slotId   = btn.dataset.slotId;
      const idx      = parseInt(btn.dataset.slotIndex ?? "0");
      const snapshot = SlotManager.getContents(this.document, slotId)[idx] ?? null;
      if (!snapshot) { ui.notifications.warn("Slot item not found."); return; }
      const { SnapshotItem } = await import("../documents/snapshot-item.mjs");
      await SnapshotItem.openForSnapshot(snapshot, this.document, slotId, idx);
    });

    con.addEventListener("click", async ev => {
      const btn = ev.target.closest("[data-action^='effect']");
      if (!btn) return;
      ev.stopPropagation();
      const doc = this.document;
      const efId = btn.dataset.effectId;
      const _resolveEffect = async () => {
        const uuid = btn.dataset.effectUuid;
        if (uuid) {
          const effect = await fromUuid(uuid).catch(() => null);
          if (effect) return effect;
        }
        return doc.effects?.get(efId) ?? null;
      };
      switch (btn.dataset.action) {
        case "effectCreate": {
          const cls = foundry.utils.getDocumentClass("ActiveEffect");
          cls.createDialog({}, { parent: doc });
          break;
        }
        case "effectToggle": {
          const ef = await _resolveEffect();
          if (ef) await ef.update({ disabled: !ef.disabled });
          break;
        }
        case "effectEdit": {
          const ef = await _resolveEffect();
          if (ef) ef.sheet.render(true);
          break;
        }
        case "effectDelete": {
          const ef = await _resolveEffect();
          if (!ef) break;
          const ok = await foundry.applications.api.DialogV2.confirm({
            window: { title: "Delete Effect" },
            content: `<p>Delete <strong>${ef.name}</strong>?</p>`
          });
          if (ok) await ef.delete();
          break;
        }
      }
    });

    this._wirePerElementInteractions(con);

    con.addEventListener("click", async ev => {
      const btn = ev.target.closest("[data-action='abilityDelete']");
      if (!btn) return;
      ev.stopPropagation();
      const actor = this.document.actor ?? (this.document instanceof Actor ? this.document : null);
      if (!actor) return;
      const item = actor.items?.get(btn.dataset.itemId);
      if (!item) return;
      const ok = await foundry.applications.api.DialogV2.confirm({
        window: { title: "Remove Ability" },
        content: `<p>Remove <strong>${item.name}</strong> from this actor?</p>`
      }).catch(() => false);
      if (ok) await item.delete();
    });

    con.addEventListener("click", ev => {
      const btn = ev.target.closest("[data-action='abilityEdit']");
      if (!btn) return;
      ev.stopPropagation();
      const actor = this.document.actor ?? (this.document instanceof Actor ? this.document : null);
      const item = actor?.items?.get(btn.dataset.itemId);
      if (item) item.sheet.render(true);
    });

    con.addEventListener("click", async ev => {
      const btn = ev.target.closest("[data-action='abilityCast']");
      if (!btn) return;
      ev.stopPropagation();
      const actor = this.document.actor ?? (this.document instanceof Actor ? this.document : null);
      const item  = actor?.items?.get(btn.dataset.itemId);
      if (item) await item.use({});
    });

    con.addEventListener("click", async ev => {
      const btn = ev.target.closest("[data-action='slotRestore']");
      if (!btn) return;
      ev.stopPropagation();
      const actor = this.document.actor ?? (this.document instanceof Actor ? this.document : null);
      if (!actor) return;
      const lvl      = btn.dataset.level;
      const idx      = Number(btn.dataset.slotIdx ?? 0);
      const slotPath = `system.spellSlots.${lvl}`;
      const slot     = foundry.utils.getProperty(actor, slotPath) ?? {};
      const sv       = Number(slot.value ?? 0);
      const sm       = Number(slot.max   ?? 0);
      const isFilled = idx < sv;
      const newVal   = isFilled ? Math.max(0, sv - 1) : Math.min(sm, sv + 1);
      await actor.update({ [`${slotPath}.value`]: newVal });
    });

    con.addEventListener("change", async ev => {
      const inp = ev.target.closest("[data-action='slotSetMax']");
      if (!inp) return;
      ev.stopPropagation();
      const actor = this.document.actor ?? (this.document instanceof Actor ? this.document : null);
      if (!actor) return;
      const lvl      = inp.dataset.level;
      const newMax   = Math.max(0, Math.min(20, parseInt(inp.value) || 0));
      const slotPath = `system.spellSlots.${lvl}`;
      const slot     = foundry.utils.getProperty(actor, slotPath) ?? {};
      const sv       = Math.min(Number(slot.value ?? 0), newMax);
      await actor.update({ [`${slotPath}.max`]: newMax, [`${slotPath}.value`]: sv });
    });

    con.addEventListener("change", async ev => {
      const inp = ev.target.closest(".sb-mana-input");
      if (!inp || !inp.name) return;
      ev.stopPropagation();
      const actor = this.document.actor ?? (this.document instanceof Actor ? this.document : null);
      const target = actor ?? this.document;
      await target.update({ [inp.name]: Math.max(0, parseInt(inp.value) || 0) });
    });

    con.addEventListener("dragover", ev => {
      const dz = ev.target.closest(".sb-drop-zone");
      if (!dz) return;
      ev.preventDefault();
      dz.style.background  = "var(--sd-accent-glow)";
      dz.style.color       = "var(--sd-accent)";
      dz.style.borderColor = "var(--sd-accent)";
    });
    con.addEventListener("dragleave", ev => {
      const dz = ev.target.closest(".sb-drop-zone");
      if (!dz) return;
      dz.style.background  = "";
      dz.style.color       = "#555";
      dz.style.borderColor = "var(--sd-accent-dim)";
    });
    con.addEventListener("drop", async ev => {
      const dz = ev.target.closest(".sb-drop-zone");
      if (!dz) return;
      ev.preventDefault();
      dz.style.background  = "";
      dz.style.color       = "#555";
      dz.style.borderColor = "var(--sd-accent-dim)";
      try {
        const data = JSON.parse(ev.dataTransfer.getData("text/plain"));
        const item = data.uuid ? await fromUuid(data.uuid) : null;
        if (!item) return;
        if (item.type !== "ability") { ui.notifications.warn(`"${item.name}" is not an ability item.`); return; }
        const actor = this.document.actor ?? (this.document instanceof Actor ? this.document : null);
        if (actor) {
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
          await actor.createEmbeddedDocuments("Item", [obj]);
          ui.notifications.info(`Added "${item.name}" to ${actor.name}`);
        }
      } catch(err) { console.warn("SD | spellbook drop (item-sheet):", err); }
    });
  }

  _wirePerElementInteractions(con) {
    if (con && con.dataset?.sdAaDelegated !== "1") {
      con.dataset.sdAaDelegated = "1";
      con.addEventListener("click", (ev) => {
        const widgetEl = ev.target.closest(".widget[data-aa-tag]");
        if (!widgetEl || !con.contains(widgetEl)) return;
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

    con.querySelectorAll(".widget-copy-path").forEach(btn => {
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

    con.querySelectorAll("[data-action='widgetRoll']").forEach(btn=>{
      btn.addEventListener("click", async ()=>{
        let formula = btn.dataset.formulaRaw || btn.dataset.formula || "1d20";
        if (formula.trim().startsWith("[")) {
          try {
            const { ButtonExecutor } = await import("../helpers/button-executor.mjs");
            const actions   = JSON.parse(formula.trim());
            const actorCtx  = this.document.actor ?? null;
            const itemCtx   = this.document;
            const fakeBtnDef = { label: btn.dataset.flavor ?? "" };
              const runtime = {};
              for (const action of actions) {
                await ButtonExecutor._runAction(action, itemCtx, actorCtx, fakeBtnDef, runtime);
              }
          } catch(e) { console.error("SD | widgetRoll action error:", e); }
          return;
        }
        try {
          const { FormulaEngine } = await import("../helpers/formula-engine.mjs");
          formula = FormulaEngine.resolveForRoll(formula, this.document);
        } catch(e) { console.warn("SD | formula resolve:", e); }
        const roll=new Roll(formula, this.document.getRollData?.()?? {});
        await roll.evaluate();
        await roll.toMessage({ speaker:ChatMessage.getSpeaker({ actor:this.document.actor }), flavor:btn.dataset.flavor });
      });
    });
    con.querySelectorAll("[data-action='widgetToggle']").forEach(btn=>{
      btn.addEventListener("click", async ()=>{
        await this.document.update({ [btn.dataset.path]: !foundry.utils.getProperty(this.document,btn.dataset.path) });
      });
    });

    con.querySelectorAll("[data-action='widgetSelectPill']").forEach(el => {
      const handler = async ev => {
        ev.stopPropagation();
        const path = el.dataset.path;
        const val  = el.dataset.value ?? el.value ?? "";
        if (!path) return;
        await this.document.update({ [path]: val });
      };
      el.addEventListener(el.tagName === "INPUT" ? "change" : "click", handler);
    });

    con.querySelectorAll("[data-action='widgetButton']").forEach(btn=>{
      btn.addEventListener("click", async ()=>{
        const rawFormula = btn.dataset.formulaRaw || btn.dataset.formula;
        if (!rawFormula) {
          if (btn.dataset.flavor) {
            ChatMessage.create({ content: btn.dataset.flavor, speaker: ChatMessage.getSpeaker({ actor: this.document.actor }) });
          }
          return;
        }
        const trimmed = rawFormula.trim();
        if (trimmed.startsWith("[") || trimmed.startsWith("{\"_trigger\"")) {
          try {
            const { ButtonExecutor } = await import("../helpers/button-executor.mjs");
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
            const fakeBtnDef = { label: btn.dataset.flavor ?? "", __macros: macros };
            const actorCtx = this.document.actor ?? null;
            const itemCtx = this.document;
            const runtime = {};
            for (const action of actions) {
              await ButtonExecutor._runAction(action, itemCtx, actorCtx, fakeBtnDef, runtime);
            }
          } catch(e) {
            console.error("SD | widgetButton action graph error:", e);
            ui.notifications.error("Button action failed: " + e.message);
          }
          return;
        }

        let formula = trimmed;
        try { const { FormulaEngine } = await import("../helpers/formula-engine.mjs"); formula = FormulaEngine.resolveForRoll(rawFormula, this.document); } catch(e) {}
        const roll = new Roll(formula, this.document.getRollData?.() ?? {});
        await roll.evaluate();
        await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor: this.document.actor }), flavor: btn.dataset.flavor });
      });
    });
    con.querySelectorAll("input[data-path], select[data-path], textarea[data-path], .widget input[name], .widget select[name], .widget textarea[name]").forEach(inp=>{
      inp.addEventListener("change", async ()=>{
        const path = inp.dataset.path || inp.getAttribute("name");
        if (!path || path.startsWith("__")) return;
        let val;
        if (inp.type === "checkbox") val = inp.checked;
        else if (inp.type === "number") {
          const n = Number(inp.value);
          val = Number.isFinite(n) ? n : 0;
        } else val = inp.value;
        await this.document.update({ [path]: val });
      });
    });

    con.querySelectorAll(".sd-clock-segment").forEach(seg => {
      seg.addEventListener("click", async ev => {
        ev.stopPropagation();
        const path  = seg.dataset.path;
        const index = Number(seg.dataset.index);
        const segs  = Number(seg.dataset.segs ?? 4);
        if (!path) return;
        const cur   = Number(foundry.utils.getProperty(this.document, path)) || 0;
        const next  = cur > index ? index : index + 1;
        await this.document.update({ [path]: Math.min(segs, Math.max(0, next)) });
      });
    });

    con.querySelectorAll(".sd-tracker-pip").forEach(pip => {
      const _apply = async (mode) => {
        const path  = pip.dataset.path;
        const index = Number(pip.dataset.index);
        const max   = Number(pip.dataset.max ?? 6);
        if (!path) return;
        const cur   = Number(foundry.utils.getProperty(this.document, path)) || 0;
        let next;
        if (mode === "jump")     next = cur > index ? index : index + 1;
        else if (mode === "dec") next = Math.max(0, cur - 1);
        else                     next = cur > index ? cur - 1 : cur + 1;
        await this.document.update({ [path]: Math.min(max, Math.max(0, next)) });
      };
      pip.addEventListener("click", async ev => {
        ev.stopPropagation();
        await _apply(ev.shiftKey ? "jump" : "step");
      });
      pip.addEventListener("contextmenu", async ev => {
        ev.preventDefault();
        ev.stopPropagation();
        await _apply("dec");
      });
    });

    con.querySelectorAll(".sd-clock-reset[data-path]").forEach(btn => {
      btn.addEventListener("click", async ev => {
        ev.stopPropagation();
        const path = btn.dataset.path;
        if (!path) return;
        await this.document.update({ [path]: 0 });
      });
    });

    con.querySelectorAll(".sd-tracker-reset[data-path]").forEach(btn => {
      btn.addEventListener("click", async ev => {
        ev.stopPropagation();
        const path = btn.dataset.path;
        if (!path) return;
        await this.document.update({ [path]: 0 });
      });
    });

    con.querySelectorAll(".sd-tag-add[data-path]").forEach(btn => {
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
        const cur  = String(foundry.utils.getProperty(this.document, path) ?? "");
        const tags = cur.split(",").map(t => t.trim()).filter(Boolean);
        if (!tags.includes(tag)) { tags.push(tag); await this.document.update({ [path]: tags.join(", ") }); }
      });
    });

    con.querySelectorAll(".sd-tag-remove[data-path]").forEach(btn => {
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

    con.querySelectorAll(".sd-img-pick").forEach(btn => {
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
        new FP({ type: "image", current: cur,
          callback: src => this.document.update({ [path]: src }) }).render(true);
      });
    });

    RichTextEditor.wire(con, this.document);

    const _readPath = (path) => {
      if (!path) return 0;
      if (path.startsWith("system.hiddenFields.")) {
        const key = path.slice("system.hiddenFields.".length);
        return this.document?.system?.hiddenFields?.[key] ?? 0;
      }
      return foundry.utils.getProperty(this.document, path) ?? 0;
    };

    const _fieldForPath = (path, root = con) => {
      if (!path) return null;
      return [...root.querySelectorAll("input, select, textarea")]
        .find(el => (el.dataset.path || el.getAttribute("name")) === path) ?? null;
    };

    const _numberForPath = (path, root = con) => {
      const field = _fieldForPath(path, root);
      const fromField = field ? Number(field.value) : NaN;
      if (Number.isFinite(fromField)) return fromField;
      const fromDoc = Number(_readPath(path));
      return Number.isFinite(fromDoc) ? fromDoc : 0;
    };

    con.querySelectorAll("[data-step], [data-action='widgetNumStep']").forEach(btn => {
      btn.addEventListener("click", async ev => {
        ev.preventDefault();
        ev.stopPropagation();
        const step  = parseFloat(btn.dataset.step);
        const path  = btn.dataset.path;
        if (!path || !Number.isFinite(step)) return;
        const root  = btn.closest(".widget") ?? con;
        const cur   = _numberForPath(path, root);
        const dsMin = btn.dataset.min;
        const dsMax = btn.dataset.max;
        const rawMin = (dsMin !== undefined && dsMin !== "") ? parseFloat(dsMin) : -Infinity;
        const rawMax = (dsMax !== undefined && dsMax !== "") ? parseFloat(dsMax) :  Infinity;
        const min   = Number.isFinite(rawMin) ? rawMin : -Infinity;
        const max   = Number.isFinite(rawMax) ? rawMax :  Infinity;
        const next  = Math.clamp(cur + step, min, max);
        const field = _fieldForPath(path, root);
        if (field && "value" in field) field.value = String(next);
        await this.document.update({ [path]: next });
      });
    });

    con.querySelectorAll("[data-roll]").forEach(el => {
      el.addEventListener("click", async () => {
        let formula = el.dataset.roll;
        if (!formula || formula.trim().startsWith("[")) return;
        try {
          const { FormulaEngine } = await import("../helpers/formula-engine.mjs");
          formula = FormulaEngine.resolveForRoll(formula, this.document);
        } catch(e) {}
        try {
          const roll = new Roll(formula, this.document.getRollData?.() ?? {});
          await roll.evaluate();
          await roll.toMessage({
            speaker: ChatMessage.getSpeaker({ actor: this.document.actor ?? this.document }),
            flavor:  el.dataset.flavor
          });
        } catch(e) {
          console.error("SD | data-roll error:", e, "formula:", formula);
        }
      });
    });

    con.querySelectorAll("[data-toggle]").forEach(tog => {
      tog.addEventListener("click", async () => {
        await this.document.update({ [tog.dataset.toggle]: tog.dataset.on !== "true" });
      });
    });

    con.querySelectorAll("[data-action='attrModClick']").forEach(btn => {
      btn.addEventListener("click", async () => {
        const doc = this.document;
        const onClickFml = btn.dataset.attrOnclick;
        if (onClickFml) {
          const trimmed = onClickFml.trim();
          if (trimmed.startsWith("[")) {
            try {
              const actions = JSON.parse(trimmed);
              const actorCtx = doc instanceof Actor ? doc : doc.actor ?? null;
              const itemCtx  = doc instanceof Actor ? null : doc;
              const fakeBtnDef = { label: btn.dataset.flavor ?? "" };
              const runtime = {};
              for (const action of actions) {
                await ButtonExecutor._runAction(action, itemCtx ?? { system: {}, actor: actorCtx }, actorCtx, fakeBtnDef, runtime);
              }
            } catch(err) { console.error("SD | attrModClick exec error:", err); }
            return;
          }
        }
        let formula = btn.dataset.attrRoll || "1d20";
        try {
          const { FormulaEngine } = await import("../helpers/formula-engine.mjs");
          formula = FormulaEngine.resolveForRoll(formula, doc);
        } catch(e) {}
        try {
          const roll = new Roll(formula, doc.getRollData?.() ?? {});
          await roll.evaluate();
          await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor: doc.actor ?? doc }), flavor: btn.dataset.flavor });
        } catch(e) { console.error("SD | attrModClick roll error:", e, "formula:", formula); }
      });
    });

    con.querySelectorAll("[data-copy-macro]").forEach(btn => {
      btn.addEventListener("click", async ev => {
        ev.stopPropagation();
        const script = btn.dataset.copyMacro;
        if (!script) return;
        try {
          await navigator.clipboard.writeText(script);
          const icon = btn.querySelector("i");
          if (icon) {
            icon.className = "fas fa-check";
            icon.style.color = "#5a9e5a";
            setTimeout(() => { icon.className = "fas fa-scroll"; icon.style.color = ""; }, 1200);
          }
          ui.notifications.info("Macro script copied to clipboard!");
        } catch {
          await foundry.applications.api.DialogV2.prompt({
            window:  { title: "Macro Script" },
            content: `<p style="font-size:11px;color:var(--sd-w-label, var(--sd-text-3));margin-bottom:6px">Copy the script below into a new Macro (type: Script):</p>
              <textarea style="width:100%;height:160px;font-family:monospace;font-size:11px;background:var(--sd-bg);color:#c0c0e0;border:1px solid var(--sd-w-bd,var(--sd-border));border-radius:4px;padding:6px;box-sizing:border-box;resize:vertical"
                readonly onclick="this.select()">${script}</textarea>`,
            ok: { label: "Close" }
          });
        }
      });
    });

    con.querySelectorAll("[data-action='questMarkerOpen']").forEach(btn => {
      btn.addEventListener("click", async ev => {
        ev.preventDefault();
        ev.stopPropagation();
        const logUuid = btn.dataset.qmLog || "";
        if (!logUuid) return;
        try {
          const log = await fromUuid(logUuid);
          if (!log) return;
          await log.sheet?.render?.(true);
        } catch(e) { console.error("SD | questMarkerOpen:", e); }
      });
    });

    con.querySelectorAll("[data-action='cardFlip']").forEach(btn => {
      btn.addEventListener("click", async ev => {
        ev.stopPropagation();
        if (btn.dataset.sdBusy === "1") return;
        btn.dataset.sdBusy = "1";
        const wasDisabled = btn.disabled;
        btn.disabled = true;
        try {
          const stack = await fromUuid(btn.dataset.stackUuid);
          const card  = stack?.cards?.get?.(btn.dataset.cardId);
          if (card) await card.update({ face: card.face === null ? 0 : null });
        } catch(e) { console.error("SD | cardFlip:", e); }
        finally { delete btn.dataset.sdBusy; btn.disabled = wasDisabled; }
      });
    });

    con.querySelectorAll("[data-action='cardStripScroll']").forEach(btn => {
      btn.addEventListener("click", () => {
        const dir = Number(btn.dataset.dir) || 1;
        const strip = btn.parentElement?.querySelector(".sd-cardhand-strip");
        if (strip) strip.scrollBy({ left: dir * 200, behavior: "smooth" });
      });
    });

    con.querySelectorAll("[data-action='cardStackShuffle']").forEach(btn => {
      btn.addEventListener("click", async () => {
        try {
          const stack = await fromUuid(btn.dataset.stackUuid);
          if (stack) await stack.shuffle({ chatNotification: true });
        } catch(e) { console.error("SD | cardStackShuffle:", e); }
      });
    });

    con.querySelectorAll("[data-action='cardStackRecall']").forEach(btn => {
      btn.addEventListener("click", async () => {
        try {
          const stack = await fromUuid(btn.dataset.stackUuid);
          if (stack) await stack.recall({ chatNotification: true });
        } catch(e) { console.error("SD | cardStackRecall:", e); }
      });
    });

    con.querySelectorAll("[data-action='cardStackFlipAll']").forEach(btn => {
      btn.addEventListener("click", async () => {
        try {
          const stack = await fromUuid(btn.dataset.stackUuid);
          if (!stack) return;
          const updates = stack.cards.map(c => ({ _id: c.id, face: c.face === null ? 0 : null }));
          await stack.updateEmbeddedDocuments("Card", updates);
        } catch(e) { console.error("SD | cardStackFlipAll:", e); }
      });
    });
  }

  async _onPanelClick(ev) {
    const btn=ev.target.closest("[data-sys-action]"); if (!btn) return;
    const a=btn.dataset.sysAction;
    const lockedKeys = new Set(_lockedKeysForType(this.document.type));
    switch(a) {
      case "addHiddenField":   { const hf=this.document.system.hiddenFields??{}; let n=Object.keys(hf).length+1; let k=`field${n}`; while(hf[k]!==undefined || lockedKeys.has(k)){n++;k=`field${n}`;} await this.document.update({[`system.hiddenFields.${k}`]:""}); break; }
      case "copyHiddenFieldPath": {
        const path = `system.hiddenFields.${btn.dataset.key}`;
        try { await navigator.clipboard.writeText(path); ui.notifications.info(`Copied: ${path}`); } catch { ui.notifications.warn("Could not copy to clipboard"); }
        break;
      }
      case "removeHiddenField":{
        if (lockedKeys.has(btn.dataset.key)) {
          ui.notifications.warn(`"${btn.dataset.key}" is a required field for ${this.document.type} items and cannot be removed.`);
          break;
        }
        await this.document.update({[`system.hiddenFields.-=${btn.dataset.key}`]:null}); break;
      }
      case "addDeclaredAttr":  { const attrs=foundry.utils.deepClone(this.document.system.declaredAttrs??[]); attrs.push({id:foundry.utils.randomID(8),name:`attr${attrs.length+1}`,path:""}); await this.document.update({"system.declaredAttrs":attrs}); break; }
      case "removeDeclaredAttr":{ const attrs=(this.document.system.declaredAttrs??[]).filter(a=>a.id!==btn.dataset.attrId); await this.document.update({"system.declaredAttrs":attrs}); break; }
      case "addSlot":          { const d=foundry.utils.deepClone(this.document.system.slotDefinitions??[]); d.push({id:`slot${d.length+1}`,label:`Slot ${d.length+1}`,allowedTypes:[],allowedCategories:[],attrFilters:[],maxCount:1,displayMode:"compact",removable:true,consumeOnRemove:false,placeholderIcon:"",accentColor:"",changes:[]}); await this.document.update({"system.slotDefinitions":d}); break; }
      case "pickSlotIcon": {
        const si = parseInt(btn.dataset.slotIdx);
        const FP = foundry.applications?.apps?.FilePicker ?? globalThis.FilePicker;
        if (!FP || Number.isNaN(si)) break;
        const d = foundry.utils.deepClone(this.document.system.slotDefinitions ?? []);
        if (!d[si]) break;
        const cur = d[si].placeholderIcon || "";
        new FP({
          type: "image",
          current: cur,
          callback: async (p) => {
            const d2 = foundry.utils.deepClone(this.document.system.slotDefinitions ?? []);
            if (!d2[si]) return;
            d2[si].placeholderIcon = p || "";
            await this.document.update({ "system.slotDefinitions": d2 });
          }
        }).render(true);
        break;
      }
      case "clearSlotIcon": {
        const si = parseInt(btn.dataset.slotIdx);
        if (Number.isNaN(si)) break;
        const d = foundry.utils.deepClone(this.document.system.slotDefinitions ?? []);
        if (!d[si]) break;
        d[si].placeholderIcon = "";
        await this.document.update({ "system.slotDefinitions": d });
        break;
      }
      case "toggleSlotPresets": {
        const si = btn.dataset.slotIdx;
        if (si === undefined) break;
        const grid = this.element?.querySelector(`.sd-slot-preset-grid[data-slot-idx="${si}"]`);
        if (!grid) break;
        const isOpen = grid.style.display !== "none";
        grid.style.display = isOpen ? "none" : "grid";
        break;
      }
      case "setSlotPreset": {
        const si = parseInt(btn.dataset.slotIdx);
        const name = String(btn.dataset.iconName ?? "");
        if (Number.isNaN(si) || !name) break;
        const d = foundry.utils.deepClone(this.document.system.slotDefinitions ?? []);
        if (!d[si]) break;
        d[si].placeholderIcon = `systems/sd/assets/slot-icons/${name}.svg`;
        await this.document.update({ "system.slotDefinitions": d });
        break;
      }
      case "removeSlot":       {
        const d=foundry.utils.deepClone(this.document.system.slotDefinitions??[]);
        const _ri = parseInt(btn.dataset.slotIdx);
        const _removed = d[_ri];
        d.splice(_ri,1);
        const _upd = { "system.slotDefinitions": d };
        if (_removed?.id) {
          const _purge = SlotManager.buildSlotPurgeUpdates(this.document, _removed.id);
          if (_purge) Object.assign(_upd, _purge);
        }
        await this.document.update(_upd);
        break;
      }
      case "addAttrFilter":    { const si=parseInt(btn.dataset.slotIdx); const d=foundry.utils.deepClone(this.document.system.slotDefinitions??[]); d[si].attrFilters??=[]; d[si].attrFilters.push({id:foundry.utils.randomID(8),fieldPath:"",fieldLabel:"",operator:"==",expectedValue:""}); await this.document.update({"system.slotDefinitions":d}); break; }
      case "removeAttrFilter": { const si=parseInt(btn.dataset.slotIdx),fi=parseInt(btn.dataset.filterIdx); const d=foundry.utils.deepClone(this.document.system.slotDefinitions??[]); d[si].attrFilters.splice(fi,1); await this.document.update({"system.slotDefinitions":d}); break; }
      case "addSlotChange":    { const si=parseInt(btn.dataset.slotIdx); const d=foundry.utils.deepClone(this.document.system.slotDefinitions??[]); if(!d[si]) break; d[si].changes??=[]; d[si].changes.push({id:foundry.utils.randomID(8),itemFieldPath:"",actorFieldPath:"",mode:2,priority:20}); await this.document.update({"system.slotDefinitions":d}); break; }
      case "removeSlotChange": { const si=parseInt(btn.dataset.slotIdx),ci=parseInt(btn.dataset.changeIdx); const d=foundry.utils.deepClone(this.document.system.slotDefinitions??[]); if(!d[si]?.changes?.[ci]) break; d[si].changes.splice(ci,1); await this.document.update({"system.slotDefinitions":d}); break; }
      case "removeFromSlot":   { await SlotManager.removeFromSlot(this.document,btn.dataset.slotId,parseInt(btn.dataset.slotIdx)); break; }
      case "addButton":        { const b=foundry.utils.deepClone(this.document.system.buttons??[]); b.push({id:foundry.utils.randomID(8),label:"New Button",icon:"fa-bolt",color:"var(--sd-accent)",showIn:"inline",conditions:[],actions:[]}); await this.document.update({"system.buttons":b}); break; }
      case "removeButton":     { const b=foundry.utils.deepClone(this.document.system.buttons??[]); b.splice(parseInt(btn.dataset.btnIdx),1); await this.document.update({"system.buttons":b}); break; }
      case "addAction":        { const b=foundry.utils.deepClone(this.document.system.buttons??[]); const i=parseInt(btn.dataset.btnIdx); b[i].actions??=[]; b[i].actions.push({type:"roll",formula:"1d6",flavor:"",target:"self.system.uses.value",delta:-1,messageText:""}); await this.document.update({"system.buttons":b}); break; }
      case "removeAction":     { const b=foundry.utils.deepClone(this.document.system.buttons??[]); const bi=parseInt(btn.dataset.btnIdx),ai=parseInt(btn.dataset.actIdx); b[bi].actions.splice(ai,1); await this.document.update({"system.buttons":b}); break; }
      case "fireButton":       { const i=parseInt(btn.dataset.btnIdx); const bb=this.document.system.buttons?.[i]; if(bb) await ButtonExecutor.execute(bb,this.document,this.document.actor); break; }
    }
  }

  async _onPanelChange(ev) {
    const el=ev.target;
    if (el.dataset.sysHfKey!==undefined) {
      const ok=el.dataset.sysHfKey, nk=el.value.trim(); if(!nk||nk===ok) return;
      const lockedKeys = new Set(_lockedKeysForType(this.document.type));
      if (lockedKeys.has(ok)) {
        ui.notifications.warn(`"${ok}" is a required field for ${this.document.type} items and cannot be renamed.`);
        el.value = ok; return;
      }
      if (lockedKeys.has(nk)) {
        ui.notifications.warn(`"${nk}" is a reserved key for ${this.document.type} items.`);
        el.value = ok; return;
      }
      const hf=this.document.system.hiddenFields??{};
      const val=hf[ok]??"";
      await this.document.update({
        [`system.hiddenFields.-=${ok}`]: null,
        [`system.hiddenFields.${nk}`]: val
      }); return;
    }
    if (el.dataset.sysHfVal!==undefined) { const val=el.type==="checkbox"?el.checked:el.value; await this.document.update({[`system.hiddenFields.${el.dataset.sysHfVal}`]:val}); return; }
    if (el.dataset.sysField!==undefined) {
      const path = el.dataset.sysField;
      let val;
      if (el.type === "checkbox") val = el.checked;
      else if (el.type === "number") val = (el.value === "" ? 0 : Number(el.value));
      else val = el.value;
      await this.document.update({ [`system.${path}`]: val });
      return;
    }
    if (el.dataset.sysDaName!==undefined) { const attrs=foundry.utils.deepClone(this.document.system.declaredAttrs??[]); const a=attrs.find(x=>x.id===el.dataset.sysDaName); if(a){a.name=el.value; await this.document.update({"system.declaredAttrs":attrs});} return; }
    if (el.dataset.sysDaPath!==undefined) { const attrs=foundry.utils.deepClone(this.document.system.declaredAttrs??[]); const a=attrs.find(x=>x.id===el.dataset.sysDaPath); if(a){a.path=el.value; await this.document.update({"system.declaredAttrs":attrs});} return; }
    if (el.dataset.sysSlot!==undefined) {
      const idx=parseInt(el.dataset.slotIdx), field=el.dataset.sysSlot;
      const d=foundry.utils.deepClone(this.document.system.slotDefinitions??[]); if(!d[idx]) return;
      let val=el.type==="checkbox"?el.checked:el.type==="number"?parseInt(el.value)||1:el.value;
      if(field==="allowedTypes"||field==="allowedCategories") val=String(val).split(",").map(s=>s.trim()).filter(Boolean);
      d[idx][field]=val; await this.document.update({"system.slotDefinitions":d}); return;
    }
    if (el.dataset.sysAf!==undefined) {
      const si=parseInt(el.dataset.slotIdx),fi=parseInt(el.dataset.filterIdx),field=el.dataset.sysAf;
      const d=foundry.utils.deepClone(this.document.system.slotDefinitions??[]); if(!d[si]?.attrFilters?.[fi]) return;
      d[si].attrFilters[fi][field]=el.value; await this.document.update({"system.slotDefinitions":d}); return;
    }
    if (el.dataset.sysSlotChange!==undefined) {
      const si=parseInt(el.dataset.slotIdx),ci=parseInt(el.dataset.changeIdx),field=el.dataset.sysSlotChange;
      const d=foundry.utils.deepClone(this.document.system.slotDefinitions??[]);
      if (!d[si]) return;
      d[si].changes ??= [];
      if (!d[si].changes[ci]) return;
      let val;
      if (field==="mode" || field==="priority") val = (el.value === "" ? (field==="mode"?2:20) : Number(el.value));
      else val = el.value;
      d[si].changes[ci][field] = val;
      await this.document.update({"system.slotDefinitions":d});
      return;
    }
    if (el.dataset.sysBtn!==undefined) {
      const idx=parseInt(el.dataset.btnIdx),field=el.dataset.sysBtn;
      const b=foundry.utils.deepClone(this.document.system.buttons??[]); if(!b[idx]) return;
      b[idx][field]=el.value; await this.document.update({"system.buttons":b}); return;
    }
    if (el.dataset.sysAct!==undefined) {
      const bi=parseInt(el.dataset.btnIdx),ai=parseInt(el.dataset.actIdx),field=el.dataset.sysAct;
      const b=foundry.utils.deepClone(this.document.system.buttons??[]); if(!b[bi]?.actions?.[ai]) return;
      let val=field==="delta"?(parseFloat(el.value)||0):el.value; b[bi].actions[ai][field]=val;
      await this.document.update({"system.buttons":b}); return;
    }
  }

  _wireAllDropZones() {
    const root=this.element; if (!root) return;
    const con=root.querySelector(".sd-panels-container");

    if (con && !con._sdItemDropWired) {
      con._sdItemDropWired = true;

      con.addEventListener("dragover", ev => {
        const zone = ev.target.closest("[data-drop-slot], .sd-widget-dropzone, .slot-drop-filter-zone");
        if (!zone) return;
        ev.preventDefault();
        zone.style.background  = "var(--sd-accent-glow)";
        zone.style.borderColor = "var(--sd-accent)";
        zone.style.color       = "var(--sd-accent)";
      });
      con.addEventListener("dragleave", ev => {
        const zone = ev.target.closest("[data-drop-slot], .sd-widget-dropzone, .slot-drop-filter-zone");
        if (!zone) return;
        zone.style.background=""; zone.style.borderColor=""; zone.style.color="";
      });
      con.addEventListener("drop", async ev => {
        const zone = ev.target.closest("[data-drop-slot], .sd-widget-dropzone, .slot-drop-filter-zone");
        if (!zone) return;
        ev.preventDefault();
        zone.style.background=""; zone.style.borderColor=""; zone.style.color="";
        let data;
        try { data = JSON.parse(ev.dataTransfer.getData("text/plain")); } catch { return; }

        if (zone.dataset.dropSlot !== undefined) {
          const item = data.uuid ? await fromUuid(data.uuid) : null;
          if (item) {
            const slotId = zone.dataset.dropSlot;
            const defs = this.document.system.slotDefinitions ?? [];
            if (!defs.find(d => String(d.id) === String(slotId))) {
              const allWidgets = (this.document.system.customTabs ?? [])
                .flatMap(t => (t.rows ?? []).flatMap(r => r.widgets ?? []));
              const wCfg = allWidgets.find(ww => ww.type === "slot" && String(ww.slotId) === String(slotId));
              const newDefs = foundry.utils.deepClone(defs);
              newDefs.push({
                id:               slotId,
                label:            wCfg?.label ?? slotId,
                allowedTypes:     [],
                allowedCategories:[],
                attrFilters:      [],
                maxCount:         wCfg?.maxCount ?? 1,
                displayMode:      "compact",
                removable:        true,
                consumeOnRemove:  false
              });
              await this.document.update({ "system.slotDefinitions": newDefs });
            }
            await SlotManager.addToSlot(this.document, slotId, item);
          }
          return;
        }

        if (zone.classList.contains("sd-widget-dropzone")) {
          if (data.sdType==="widget") await this._addWidget(zone.dataset.tabId, zone.dataset.rowId??null, data.widgetType);
          return;
        }

        if (zone.classList.contains("slot-drop-filter-zone")) {
          const item = data.uuid ? await fromUuid(data.uuid) : null; if (!item) return;
          const {AttrFilter} = await import("../builder/attr-ref.mjs");
          const si = parseInt(zone.dataset.slotIdx);
          const d  = foundry.utils.deepClone(this.document.system.slotDefinitions??[]); if (!d[si]) return;
          const result = await AttrFilter.buildFromDrop(item, d[si]); if (!result) return;
          d[si].attrFilters??=[]; d[si].attrFilters.push(result);
          await this.document.update({"system.slotDefinitions":d});
          return;
        }
      });
    }
  }

  _attachDrop(el, handler) {
    el.addEventListener("dragover", ev=>{ ev.preventDefault(); el.style.background="var(--sd-accent-glow)"; el.style.borderColor="var(--sd-accent)"; el.style.color="var(--sd-accent)"; });
    el.addEventListener("dragleave",()=>{ el.style.background=""; el.style.borderColor=""; el.style.color=""; });
    el.addEventListener("drop", async ev=>{
      ev.preventDefault(); el.style.background=""; el.style.borderColor=""; el.style.color="";
      try { await handler(JSON.parse(ev.dataTransfer.getData("text/plain"))); }
      catch(e) { console.warn("SD|drop:",e); }
    });
  }

  _mkWidgetDZ(tab, row, label, parentVS = null) {
    const rowCols = Math.max(1, Math.min(9, Number(row?.cols) || 3));
    const dz=document.createElement("div");
    dz.className="sd-widget-dropzone"; dz.dataset.tabId=tab.id; if (row) dz.dataset.rowId=row.id;
    dz.style.cssText=`${(row && !parentVS) ? "" : (parentVS ? "" : `grid-column:span ${rowCols};`)}border:1px dashed var(--sd-accent-dim);border-radius:5px;padding:8px;text-align:center;font-size:11px;color:var(--sd-text-3);cursor:pointer;transition:background .15s,color .15s,border-color .15s;user-select:none;`;
    dz.innerHTML=`<i class="fas fa-arrow-circle-down" style="margin-right:5px;opacity:.5"></i>${label}`;
    this._attachDrop(dz, async data=>{
      if (data.sdType==="widget") await this._addWidget(tab.id, row?.id??null, data.widgetType, parentVS?.id ?? null);
      else if (data.sdType==="widget-move") await this._moveWidget(data, { tabId: tab.id, rowId: row?.id ?? null, parentVsId: parentVS?.id ?? null, toEnd: true });
    });
    return dz;
  }

  async _addTab() {
    const tabs = foundry.utils.deepClone(this.document.system.customTabs ?? []);
    const id   = foundry.utils.randomID(8);
    tabs.push({ id, label: "New Tab", rows: [] });
    await this.document.update({ "system.customTabs": tabs });
    this._renameTab(id);
  }
  async _renameTab(tabId) {
    const tab  = (this.document.system.customTabs ?? []).find(t => t.id === tabId);
    const name = await _promptTabName(tab?.label ?? "");
    if (name == null) return;
    const tabs = foundry.utils.deepClone(this.document.system.customTabs ?? []);
    const t    = tabs.find(t => t.id === tabId);
    if (t) { t.label = name; await this.document.update({ "system.customTabs": tabs }); }
  }
  async _deleteTab(tabId) {
    const ok = await foundry.applications.api.DialogV2.confirm({window:{title:"Delete Tab"},content:"<p>Delete tab and all its widgets?</p>"}).catch(()=>false);
    if(!ok) return;
    const tabs=(this.document.system.customTabs??[]).filter(t=>t.id!==tabId);
    await this.document.update({"system.customTabs":tabs});
  }
  async _deleteRow(tabId,rowId){ const tabs=foundry.utils.deepClone(this.document.system.customTabs??[]); const tab=tabs.find(t=>t.id===tabId); if(tab) tab.rows=(tab.rows??[]).filter(r=>r.id!==rowId); await this.document.update({"system.customTabs":tabs}); }

  _findVs(widgets, vsId) {
    if (!Array.isArray(widgets)) return null;
    for (const w of widgets) {
      if (w.id === vsId && w.type === "vsection") return w;
      if (w.type === "vsection") { const n = this._findVs(w.widgets, vsId); if (n) return n; }
    }
    return null;
  }
  _findWidgetDeep(widgets, id) {
    if (!Array.isArray(widgets)) return null;
    for (const w of widgets) {
      if (w.id === id) return w;
      if (w.type === "vsection") { const n = this._findWidgetDeep(w.widgets, id); if (n) return n; }
    }
    return null;
  }
  _removeWidgetDeep(widgets, id) {
    if (!Array.isArray(widgets)) return null;
    const i = widgets.findIndex(w => w.id === id);
    if (i >= 0) return widgets.splice(i, 1)[0];
    for (const w of widgets) {
      if (w.type === "vsection") { const r = this._removeWidgetDeep(w.widgets, id); if (r) return r; }
    }
    return null;
  }

  async _addWidget(tabId, rowId, widgetType, parentVsId = null) {
    const defaults={ text:{label:"Label",path:"system.hiddenFields.myField"}, number:{label:"Number",path:"system.hiddenFields.myNum"}, resource:{label:"Resource",pathValue:"system.uses.value",pathMax:"system.uses.max",color:"var(--sd-hp)"}, dice:{label:"Roll",formula:"1d6"}, button:{label:"Action",icon:"fa-bolt",color:"var(--sd-accent)",formula:"",flavor:""}, toggle:{label:"Toggle",path:"system.hiddenFields.myToggle",onLabel:"On",offLabel:"Off"}, section:{label:"Section",span:3}, vsection:{label:"",widgets:[],span:1}, richtext:{label:"Notes",path:"system.description",span:3}, attribute:{label:"Attr",path:"system.hiddenFields.myAttr"}, skill:{label:"Skill",path:"system.hiddenFields.mySkill"}, slot:{label:"Slot",slotId:"",maxCount:1,span:2}, inventory:{label:"Inventory",categories:[],columns:[],span:3}, effects:{label:"Effects",showDisabled:true,showPassive:true,span:3}, spellbook:{label:"Spellbook",abilityType:"",span:3} };
    const numberMode = widgetType === "number" ? await _chooseNumberWidgetMode() : null;
    const widget={id:foundry.utils.randomID(8),span:1,...(defaults[widgetType]??{label:widgetType}),type:widgetType};
    if (widgetType === "number") _applyNumberWidgetMode(widget, numberMode);
    const tabs=foundry.utils.deepClone(this.document.system.customTabs??[]); const tab=tabs.find(t=>t.id===tabId); if(!tab) return;
    if (rowId) {
      const row=tab.rows?.find(r=>r.id===rowId); if(!row) return;
      row.widgets??=[];
      if (parentVsId) { const vs=this._findVs(row.widgets, parentVsId); if (vs){ vs.widgets??=[]; vs.widgets.push(widget); } }
      else row.widgets.push(widget);
    } else { tab.rows??=[]; tab.rows.push({id:foundry.utils.randomID(8),cols:3,widgets:[widget]}); }
    await this.document.update({"system.customTabs":tabs});
  }
  async _cycleSpan(tab,row,w){
    const cols = Math.max(1, Math.min(9, Number(row.cols) || 3));
    const cur = Math.max(1, Number(w.span) || 1);
    const s = cur >= cols ? 1 : cur + 1;
    const tabs=foundry.utils.deepClone(this.document.system.customTabs??[]);
    const r = tabs.find(t=>t.id===tab.id)?.rows?.find(r=>r.id===row.id);
    if (!r) return;
    const ww = this._findWidgetDeep(r.widgets, w.id);
    if(ww){ww.span=s; await this.document.update({"system.customTabs":tabs});}
  }
  async _deleteWidget(tab,row,w){
    const tabs=foundry.utils.deepClone(this.document.system.customTabs??[]);
    const r=tabs.find(t=>t.id===tab.id)?.rows?.find(r=>r.id===row.id);
    if(!r) return;
    const removed=this._removeWidgetDeep(r.widgets, w.id);
    if (removed) await this.document.update({"system.customTabs":tabs});
  }
  async _configRow(tabId, rowId) {
    const row = this.document.system.customTabs?.find(t => t.id === tabId)?.rows?.find(r => r.id === rowId);
    const cur = Math.max(1, Math.min(9, Number(row?.cols) || 3));
    const n = await foundry.applications.api.DialogV2.prompt({
      window: { title: "Row Columns" },
      content: `<div style="padding:8px 0"><label style="font-size:12px;color:var(--sd-text-2)">Columns (1-9):</label><input type="number" min="1" max="9" name="cols" value="${cur}" style="width:100%;margin-top:4px;background:var(--sd-bg-3);border:1px solid var(--sd-border);color:var(--sd-text);border-radius:4px;padding:4px 8px;font-size:13px;box-sizing:border-box"></div>`,
      ok: { label: "Apply", callback: (event, button, dialog) => Number(dialog.element.querySelector("input[name='cols']")?.value) },
      rejectClose: false
    }).catch(() => null);
    if (!n || !Number.isFinite(n)) return;
    const cols = Math.max(1, Math.min(9, Math.round(n)));
    const tabs = foundry.utils.deepClone(this.document.system.customTabs ?? []);
    const r = tabs.find(t => t.id === tabId)?.rows?.find(r => r.id === rowId);
    if (!r) return;
    r.cols = cols;
    (r.widgets ?? []).forEach(w => { if (w.type !== "vsection" && Number(w.span) > cols) w.span = cols; });
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
    const srcContainer = src.parentVsId ? (this._findVs(srcRow.widgets, src.parentVsId)?.widgets ?? []) : srcRow.widgets;
    const wIdx = srcContainer.findIndex(w => w.id === src.widgetId);
    if (wIdx < 0) return;
    const [moved] = srcContainer.splice(wIdx, 1);
    if (!moved) return;
    if (moved.type === "vsection" && dst.parentVsId) dst = { ...dst, parentVsId: null };
    let dstContainer;
    if (dst.rowId) {
      const dstRow = dstTab.rows?.find(r => r.id === dst.rowId);
      if (!dstRow) { srcContainer.splice(wIdx, 0, moved); return; }
      dstContainer = dst.parentVsId ? (this._findVs(dstRow.widgets, dst.parentVsId)?.widgets ?? null) : dstRow.widgets;
      if (!dstContainer) { srcContainer.splice(wIdx, 0, moved); return; }
    } else {
      const newRow = { id: foundry.utils.randomID(8), cols: 3, widgets: [] };
      dstTab.rows ??= []; dstTab.rows.push(newRow);
      dstContainer = newRow.widgets;
    }
    const insertIdx = dst.toEnd ? dstContainer.length : Math.max(0, Math.min(dstContainer.length, dst.index ?? dstContainer.length));
    dstContainer.splice(insertIdx, 0, moved);
    await this.document.update({ "system.customTabs": tabs });
  }

  async _configWidget(tab, row, w) {
    const { openWidgetConfigPopup } = await import("../builder/widget-config-popup.mjs");
    const freshTabs   = this.document.system.customTabs ?? [];
    const freshTab    = freshTabs.find(t => t.id === tab.id) ?? tab;
    const freshRow    = freshTab.rows?.find(r => r.id === row.id) ?? row;
    const freshWidget = this._findWidgetDeep(freshRow.widgets, w.id) ?? w;
    await openWidgetConfigPopup(freshWidget, freshTab, freshRow, this.document);
  }

  _wireHeaderInputs() {
    const root=this.element; if(!root||!this.isEditable) return;
    root.querySelector(".item-name-input")?.addEventListener("change",async ev=>await this.document.update({name:ev.target.value}));
    root.querySelector(".item-img")?.addEventListener("click",()=>{
      const FP = foundry.applications?.apps?.FilePicker ?? globalThis.FilePicker;
      new FP({type:"image",current:this.document.img,callback:p=>this.document.update({img:p})}).render(true);
    });
  }

  _showEditModeBadge() {
    const root=this.element; if(!root) return;
    root.querySelector(".sd-edit-badge")?.remove(); if(!this._editMode) return;
    const header=root.querySelector(".window-header")??root.querySelector("header");
    const badge=document.createElement("div"); badge.className="sd-edit-badge";
    badge.style.cssText="position:absolute;top:4px;right:48px;background:var(--sd-accent);color:#fff;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;padding:2px 7px;border-radius:10px;z-index:100;pointer-events:none"; badge.textContent="EDIT MODE";
    if(header){header.style.position="relative";header.appendChild(badge);}
  }

  static async _onOpenBuilder() { const{Toolbox}=await import("../builder/toolbox-app.mjs"); Toolbox.toggle(); }

  static async _onOpenSheetTriggers() {
    const { FormulaGraph } = await import("../builder/formula-graph.mjs");
    const graph = new FormulaGraph(null, this.document, null, null, null,
      { mode: "sheetTrigger" });
    graph.open();
  }
  static async _onToggleEditMode() {
    this._editMode=!this._editMode;
    this._buildTabNav(); this._buildTabPanels(); this._wireAllDropZones(); this._wireAllInteractions(); this._showEditModeBadge();
  }
  static async _onEditImage() {
    const FP = foundry.applications?.apps?.FilePicker ?? globalThis.FilePicker;
    new FP({type:"image",current:this.document.img,callback:p=>this.document.update({img:p})}).render(true);
  }
  static async _onUseItem(event) { await this.document.use?.({ event }); }

  static async _onToggleEquipped(event) {
    event?.preventDefault?.();
    const doc = this.document;
    if (doc?.type !== "inventory" || !doc.system?.equippable) return;
    const next = !doc.system.equipped;
    if (next && typeof doc.canEquip === "function") {
      const { ok, reason } = await doc.canEquip();
      if (!ok) {
        ui.notifications?.warn(reason ?? game.i18n.localize("SD.EquipBlocked") ?? "Cannot equip.");
        return;
      }
    }
    await doc.update({ "system.equipped": next });
  }
  static async _onFireButton(event, target) { const i=parseInt(target.dataset.btnIndex); const b=this.document.system.buttons?.[i]; if(b) await ButtonExecutor.execute(b,this.document,this.document.actor); }

  async _saveAsTemplate() {
    const result = await foundry.applications.api.DialogV2.wait({
      window: { title: "Save as Template" },
      content: `<div style="padding:8px 0">
        <label style="font-size:12px;color:var(--sd-text-2)">Template name:</label>
        <input type="text" name="tplName" value="${this.document.name} Template"
          style="width:100%;margin-top:4px;background:var(--sd-bg-3);border:1px solid var(--sd-border);color:var(--sd-text);border-radius:4px;padding:4px 8px;font-size:13px;box-sizing:border-box">
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
      docType:         "Item",
      itemType:        doc.type ?? "ability",

      customTabs:      foundry.utils.deepClone(sys.customTabs      ?? []),
      hiddenFields:    foundry.utils.deepClone(sys.hiddenFields     ?? {}),
      declaredAttrs:   foundry.utils.deepClone(sys.declaredAttrs    ?? []),

      slotDefinitions: foundry.utils.deepClone(sys.slotDefinitions  ?? []),

      buttons:         foundry.utils.deepClone(sys.buttons          ?? []),
      onClickGraph:    foundry.utils.deepClone(sys.onClickGraph      ?? {}),

      effectTemplates: foundry.utils.deepClone(sys.effectTemplates   ?? []),
      sdTriggerGraph:  foundry.utils.deepClone(sys.sdTriggerGraph    ?? {}),
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

  async _createMacro() {
    const item   = this.document;
    const uuid   = item.uuid;
    const name   = item.name;
    const img    = item.img ?? "icons/svg/dice-target.svg";

    const command = [
      `// Quick-use: ${name}`,
      `const item = await fromUuid("${uuid}");`,
      `if (!item) return ui.notifications.warn("Item not found: ${name}");`,
      `await item.use({});`
    ].join("\n");

    let macro = game.macros.find(m => m.flags?.sd?.itemUuid === uuid);

    if (macro) {
      await macro.update({ name, img, command });
      ui.notifications.info(`Macro "${name}" updated.`);
    } else {
      macro = await Macro.create({
        name,
        type:  "script",
        img,
        command,
        flags: { sd: { itemUuid: uuid } }
      });
      ui.notifications.info(`Macro "${name}" created! Drag it to your hotbar from the Macros directory.`);
    }

    try {
      const freeSlot = Array.from({ length: 50 }, (_, i) => i + 1)
        .find(slot => !game.user.hotbar[slot]);
      if (freeSlot) {
        await game.user.assignHotbarMacro(macro, freeSlot);
        ui.notifications.info(`Macro placed in hotbar slot ${freeSlot}.`);
      }
    } catch {  }

    macro.sheet.render(true);
  }
}
