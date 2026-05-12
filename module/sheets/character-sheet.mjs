import { TabManager } from "../helpers/tabs.mjs";
import { WidgetRenderer } from "../builder/widget-renderer.mjs";
import { GridManager }    from "../builder/grid-manager.mjs";
import { ButtonExecutor } from "../helpers/button-executor.mjs";

const { ActorSheetV2 } = foundry.applications.sheets;
const { HandlebarsApplicationMixin } = foundry.applications.api;

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
      content: `<div style="padding:6px 0"><input type="text" name="tabName" value="${esc(current)}" style="width:100%;background:var(--sd-w-bg,var(--sd-bg-3));border:1px solid var(--sd-w-bd,var(--sd-border));color:var(--sd-w-fg,var(--sd-text));border-radius:4px;padding:4px 8px;font-size:13px" autofocus></div>`,
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
      openTrade:         CharacterSheet._onOpenTrade,
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

  _onRender(context, options) {
    this._buildTabNav();
    this._buildTabPanels();
    this._wireHeaderInputs();
    this._showEditModeBadge();
    this._wireInventoryDropZones();
    this._wireTrackerDelegation();
    TabManager.activate(this);
  }

  // submitOnChange auto-submits the form on any input/change event from a
  // descendant. Our inline editors (richtext textarea, wcfg popup inputs)
  // must NOT trigger a sheet submit — submitting tears down their DOM mid-edit
  // and silently discards user input. The popup lives in document.body so it
  // isn't a descendant of the sheet form, but its synthetic change events can
  // still surface here when the user is editing widget styles. Guard both.
  _onChangeForm(formConfig, event) {
    const t = event?.target;
    if (t?.closest?.(".richtext-editor, .richtext-edit-wrap, .sd-wcfg-popup")) return;
    return super._onChangeForm(formConfig, event);
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
      a.className       = "sd-tab-btn";
      a.dataset.tabId   = tab.id;
      a.style.cssText   = `
        padding:5px 11px; font-size:11px; font-weight:700; text-transform:uppercase;
        letter-spacing:.04em; cursor:pointer; border-radius:4px 4px 0 0;
        border:1px solid ${isActive ? "var(--sd-border)" : "transparent"}; border-bottom:none;
        color:${isActive ? "var(--sd-accent)" : "#666"}; background:${isActive ? "var(--sd-bg)" : "transparent"};
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

    const isHFActive = this.tabGroups.sheet === "_sys_hidden";
    const hfTab = document.createElement("a");
    hfTab.className = "sd-tab-btn";
    hfTab.dataset.tabId = "_sys_hidden";
    hfTab.style.cssText = `padding:5px 9px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;cursor:pointer;border-radius:4px 4px 0 0;border:1px solid ${isHFActive?"var(--sd-border)":"transparent"};border-bottom:none;color:${isHFActive?"var(--sd-stamina)":"#444"};background:${isHFActive?"var(--sd-bg)":"transparent"};display:inline-flex;align-items:center;gap:3px;`;
    hfTab.innerHTML = `<i class='fas fa-eye-slash'></i>`;
    hfTab.title = "Hidden Fields";
    hfTab.addEventListener("click", () => {
      if (this.tabGroups.sheet === "_sys_hidden") {
        const tabs = this.document.system.customTabs ?? [];
        this._switchTab(tabs[0]?.id ?? "");
      } else {
        this._switchTab("_sys_hidden");
      }
    });
    nav.appendChild(hfTab);

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

    container.innerHTML = "";

    const tabs = this.document.system.customTabs ?? [];

    const validIds = [...tabs.map(t => t.id), "_sys_hidden"];
    if (!this.tabGroups.sheet || !validIds.includes(this.tabGroups.sheet)) {
      this.tabGroups.sheet = tabs[0]?.id ?? "";
    }

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

  _buildHiddenFieldsPanel(isActive) {
    const panel = document.createElement("div");
    panel.className = "sd-tab-panel";
    panel.dataset.tab = "_sys_hidden";
    panel.style.cssText = `display:${isActive?"flex":"none"};flex:1;overflow-y:auto;padding:12px 14px;flex-direction:column;gap:8px;min-height:0;`;
    const sys = this.document.system;
    const ed  = this.isEditable;
    const e   = s => String(s??"").replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;");

    const TRADER_KEYS = new Set(["trader","autoTrade","priceDistortion","tradeCategories"]);
    const allHf = sys.hiddenFields ?? {};
    const hf  = Object.entries(allHf).filter(([k]) => !TRADER_KEYS.has(k));
    const _truthy = v => (v === true || v === "true" || v === 1 || v === "1" || v === "yes" || v === "on");
    const isTrader   = _truthy(allHf.trader);
    const autoTrade  = _truthy(allHf.autoTrade);
    const priceDist  = (allHf.priceDistortion === undefined || allHf.priceDistortion === null || allHf.priceDistortion === "") ? 100 : Number(allHf.priceDistortion);
    const tradeCats  = String(allHf.tradeCategories ?? "");

    const _i18n = (k, f) => { const v = game.i18n?.localize?.(k); return (!v || v === k) ? f : v; };

    const _curList = (Array.isArray(CONFIG?.SD?.currencies) && CONFIG.SD.currencies.length)
      ? CONFIG.SD.currencies
      : [{ key: "primary", label: "Gold" }, { key: "secondary", label: "Silver" }, { key: "tertiary", label: "Copper" }];

    let html = `<div class="sys-section" style="margin-bottom:12px;background:var(--sd-bg-2);border:1px solid var(--sd-border);border-radius:6px;padding:10px">
      <div style="display:flex;align-items:center;gap:6px;font-size:11px;font-weight:700;text-transform:uppercase;color:var(--sd-stamina);margin-bottom:6px">
        <i class="fas fa-store"></i> ${e(_i18n("SD.Trade.TraderSettings","Trader settings"))}
      </div>
      <p style="font-size:11px;color:var(--sd-text-3);margin:0 0 8px;line-height:1.5">${e(_i18n("SD.Trade.TraderHint","Mark this actor as a merchant. Traders appear in the partner picker even off-scene. AutoTrade lets players shop directly without GM approval."))}</p>
      <div style="display:flex;flex-wrap:wrap;gap:10px 18px;align-items:flex-end">
        <label style="display:flex;align-items:center;gap:6px;cursor:${ed?"pointer":"not-allowed"};font-size:12px;color:var(--sd-text)">
          <input type="checkbox" data-hf-trader="trader" ${isTrader?"checked":""} ${!ed?"disabled":""} style="accent-color:var(--sd-stamina);width:15px;height:15px;cursor:inherit">
          ${e(_i18n("SD.Trade.IsTrader","Trader"))}
        </label>
        <label style="display:flex;align-items:center;gap:6px;cursor:${ed?"pointer":"not-allowed"};font-size:12px;color:var(--sd-text)">
          <input type="checkbox" data-hf-trader="autoTrade" ${autoTrade?"checked":""} ${!ed?"disabled":""} style="accent-color:var(--sd-stamina);width:15px;height:15px;cursor:inherit">
          ${e(_i18n("SD.Trade.AutoTrade","AutoTrade"))}
        </label>
        <label style="display:flex;flex-direction:column;gap:3px;font-size:11px;color:var(--sd-text-2);flex:0 0 130px">
          <span style="text-transform:uppercase;letter-spacing:.04em;color:var(--sd-text-3);font-size:10px">${e(_i18n("SD.Trade.PriceDistortion","Price distortion %"))}</span>
          <input type="number" min="0" step="1" data-hf-trader="priceDistortion" value="${priceDist}" ${!ed?"disabled":""} style="background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:4px;color:var(--sd-text);font-size:12px;padding:3px 7px">
        </label>
        <label style="display:flex;flex-direction:column;gap:3px;font-size:11px;color:var(--sd-text-2);flex:1;min-width:160px">
          <span style="text-transform:uppercase;letter-spacing:.04em;color:var(--sd-text-3);font-size:10px">${e(_i18n("SD.Trade.TradeCategories","Buys categories (CSV)"))}</span>
          <input type="text" data-hf-trader="tradeCategories" value="${e(tradeCats)}" placeholder="weapon, armor, consumable" ${!ed?"disabled":""} style="background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:4px;color:var(--sd-text);font-size:11px;font-family:monospace;padding:3px 7px">
        </label>
      </div>
    </div>`;

    if (isTrader) {
      const invItems = [...(this.document.items ?? [])].filter(it => it.type === "inventory");
      const _curOptionsHTML = (sel) => {
        const opts = [`<option value="" ${sel?"":"selected"}>— ${e(_i18n("SD.Trade.UseItem","use item's"))} —</option>`]
          .concat(_curList.map(c => `<option value="${e(c.key)}" ${c.key===sel?"selected":""}>${e(c.label ?? c.key)}</option>`));
        return opts.join("");
      };
      let table = `<div class="sys-section" style="margin-bottom:12px;background:var(--sd-bg-2);border:1px solid var(--sd-border);border-radius:6px;padding:10px">
        <div style="display:flex;align-items:center;gap:6px;font-size:11px;font-weight:700;text-transform:uppercase;color:var(--sd-stamina);margin-bottom:6px">
          <i class="fas fa-cart-shopping"></i> ${e(_i18n("SD.Trade.ShopTitle","Shop"))} — ${e(_i18n("SD.InventoryFlags","Inventory"))}
        </div>
        <p style="font-size:11px;color:var(--sd-text-3);margin:0 0 8px;line-height:1.5">${e(_i18n("SD.Trade.ShopTableHint","Toggle Saleable to list items in the autotrade shop. Price/currency override the item's base values for this trader copy."))}</p>`;
      if (!invItems.length) {
        table += `<div style="font-size:11px;color:var(--sd-text-3);font-style:italic;text-align:center;padding:14px">${e(_i18n("SD.Trade.NoInventory","No inventory items on this actor."))}</div>`;
      } else {
        table += `<div style="display:grid;grid-template-columns:24px 1fr 90px 60px 90px 110px;gap:6px 8px;align-items:center;font-size:10px;color:var(--sd-text-3);text-transform:uppercase;letter-spacing:.04em;border-bottom:1px solid var(--sd-border);padding-bottom:4px;margin-bottom:6px">
          <span></span>
          <span>${e(_i18n("SD.Trade.Item","Item"))}</span>
          <span>${e(_i18n("SD.Category","Category"))}</span>
          <span>${e(_i18n("SD.Trade.Stock","Stock"))}</span>
          <span title="${e(_i18n("SD.Trade.PriceOverrideHint","Empty = use item's base price"))}">${e(_i18n("SD.Trade.SalePriceOverride","Price"))}</span>
          <span>${e(_i18n("SD.Trade.SaleCurrency","Currency"))}</span>
        </div>`;
        for (const it of invItems) {
          const ihf = it.system?.hiddenFields ?? {};
          const isSale = _truthy(ihf.saleable);
          const sP = (ihf.salePrice === undefined || ihf.salePrice === null || ihf.salePrice === "") ? "" : Number(ihf.salePrice);
          const sCur = String(ihf.saleCurrency ?? "");
          const stk = Number(it.system?.quantity ?? 0);
          const cat = String(it.system?.category ?? "");
          table += `<div style="display:grid;grid-template-columns:24px 1fr 90px 60px 90px 110px;gap:6px 8px;align-items:center;padding:3px 0;border-bottom:1px dashed rgba(255,255,255,.04)">
            <input type="checkbox" data-shop-item-id="${e(it.id)}" data-shop-field="saleable" ${isSale?"checked":""} ${!ed?"disabled":""} title="${e(_i18n("SD.Trade.Saleable","Saleable"))}" style="accent-color:var(--sd-stamina);width:14px;height:14px;cursor:${ed?"pointer":"not-allowed"};margin:0">
            <div style="display:flex;align-items:center;gap:6px;min-width:0">
              <img src="${e(it.img||"icons/svg/item-bag.svg")}" style="width:22px;height:22px;border-radius:3px;object-fit:cover;flex-shrink:0">
              <span style="font-size:12px;color:var(--sd-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${e(it.name)}">${e(it.name)}</span>
            </div>
            <span style="font-size:11px;color:var(--sd-text-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${e(cat || "—")}</span>
            <span style="font-size:11px;color:var(--sd-text-2);text-align:center">${stk}</span>
            <input type="number" min="0" step="any" data-shop-item-id="${e(it.id)}" data-shop-field="salePrice" value="${sP}" placeholder="${Number(it.system?.price ?? 0)}" ${!ed?"disabled":""} style="background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:4px;color:var(--sd-text);font-size:11px;padding:3px 6px;text-align:right">
            <select data-shop-item-id="${e(it.id)}" data-shop-field="saleCurrency" ${!ed?"disabled":""} style="background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:4px;color:var(--sd-text);font-size:11px;padding:3px 6px">
              ${_curOptionsHTML(sCur)}
            </select>
          </div>`;
        }
      }
      table += `</div>`;
      html += table;
    }

    html += `<div style="font-size:11px;color:var(--sd-text-3);margin-bottom:8px;line-height:1.6">
      GM-only key/value pairs attached to this actor. Path: <code style="background:var(--sd-bg);padding:1px 5px;border-radius:3px;font-size:10px;color:var(--sd-accent)">system.hiddenFields.name</code>
      ${ed ? `<button type="button" data-hf-action="add" style="margin-left:8px;background:var(--sd-w-bg,var(--sd-bg-3));border:1px solid var(--sd-w-bd,var(--sd-border));border-radius:3px;color:var(--sd-accent);cursor:pointer;font-size:10px;padding:2px 8px">+ Add</button>` : ""}
    </div>`;

    if (!hf.length) {
      html += `<div style="color:#333;font-size:11px;font-style:italic;text-align:center;padding:20px 0">No hidden fields yet.</div>`;
    } else {
      for (const [k, v] of hf) {
        html += `<div style="display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid var(--sd-bg)">
          <input type="text" data-hf-key="${e(k)}" data-hf-rename value="${e(k)}" style="width:130px;background:var(--sd-bg);border:1px solid var(--sd-w-bd,var(--sd-bg-3));border-radius:4px;color:var(--sd-accent);font-size:11px;font-family:monospace;padding:3px 6px" ${!ed?"disabled":""}>
          <input type="text" data-hf-key="${e(k)}" data-hf-val value="${e(String(v))}" style="flex:1;background:var(--sd-bg);border:1px solid var(--sd-w-bd,var(--sd-bg-3));border-radius:4px;color:var(--sd-w-fg,var(--sd-text));font-size:11px;padding:3px 6px" ${!ed?"disabled":""}>
          <button type="button" data-hf-action="copy-path" data-hf-key="${e(k)}" title="Copy path: system.hiddenFields.${e(k)}" style="background:none;border:none;color:var(--sd-text-3);cursor:pointer;font-size:11px;padding:0 4px" tabindex="-1"><i class="fas fa-copy"></i></button>
          ${ed?`<button type="button" data-hf-action="remove" data-hf-key="${e(k)}" style="background:none;border:none;color:var(--sd-text-3);cursor:pointer;font-size:12px;padding:0 4px">✕</button>`:""}
        </div>`;
      }
    }

    panel.innerHTML = html;

    panel.querySelectorAll("[data-hf-action='copy-path']").forEach(btn => {
      btn.addEventListener("click", async () => {
        const path = `system.hiddenFields.${btn.dataset.hfKey}`;
        try { await navigator.clipboard.writeText(path); ui.notifications.info(`Copied: ${path}`); }
        catch { ui.notifications.warn("Could not copy to clipboard"); }
      });
    });

    const _hfReplace = async (newFields) => {
      const current = this.document.system.hiddenFields ?? {};
      const patch = {};
      for (const k of Object.keys(current)) {
        if (!(k in newFields)) patch[`system.hiddenFields.-=${k}`] = null;
      }
      for (const [k, v] of Object.entries(newFields)) {
        patch[`system.hiddenFields.${k}`] = v;
      }
      await this.document.update(patch);
    };

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

    panel.querySelectorAll("[data-hf-action='remove']").forEach(btn => {
      btn.addEventListener("click", async () => {
        const fields = foundry.utils.deepClone(this.document.system.hiddenFields ?? {});
        delete fields[btn.dataset.hfKey];
        await _hfReplace(fields);
      });
    });

    panel.querySelectorAll("[data-hf-val]").forEach(inp => {
      inp.addEventListener("change", async () => {
        await this.document.update({ [`system.hiddenFields.${inp.dataset.hfKey}`]: inp.value });
      });
    });

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

    panel.querySelectorAll("[data-hf-trader]").forEach(inp => {
      inp.addEventListener("change", async () => {
        const key = inp.dataset.hfTrader;
        let val;
        if (inp.type === "checkbox") val = inp.checked;
        else if (inp.type === "number") val = (inp.value === "" ? 0 : Number(inp.value));
        else val = inp.value;
        await this.document.update({ [`system.hiddenFields.${key}`]: val });
        if (key === "trader") this.render(false);
      });
    });

    panel.querySelectorAll("[data-shop-field]").forEach(inp => {
      inp.addEventListener("change", async () => {
        const itemId = inp.dataset.shopItemId;
        const field  = inp.dataset.shopField;
        const item   = this.document.items?.get?.(itemId);
        if (!item) return;
        let val;
        if (inp.type === "checkbox")    val = inp.checked;
        else if (inp.type === "number") val = (inp.value === "" ? "" : Number(inp.value));
        else                            val = inp.value;
        await item.update({ [`system.hiddenFields.${field}`]: val });
      });
    });

    return panel;
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
    if (parentVS) cell.dataset.parentVsId = parentVS.id;
    cell.dataset.widgetIdx = idx;
    cell.style.cssText    = `grid-column:${parentVS ? "auto" : `span ${span}`}; position:relative; min-width:0;`;

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
    box.dataset.vsId = vs.id;
    box.style.cssText = `
      display:flex; flex-direction:column; gap:6px;
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
    ov.className = "sd-widget-ov";
    ov.style.cssText = `
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

    cell.addEventListener("mouseenter", () => ov.style.display = "flex");
    cell.addEventListener("mouseleave", () => ov.style.display = "none");
    cell.appendChild(ov);
  }

  _widgetHTML(w) {

    return WidgetRenderer.render(w, this.document, this._editMode) ?? "";
  }

  _wireWidget(cell, w) {
    const doc = this.document;

    cell.querySelectorAll("input[data-path]").forEach(inp => {
      inp.addEventListener("change", async () => {
        const v = inp.type === "number" ? Number(inp.value) : inp.value;
        await doc.update({ [inp.dataset.path]: v });
      });
    });

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

    cell.querySelectorAll("[data-action='widgetRoll']").forEach(btn => {
      btn.addEventListener("click", async () => {
        let formula = btn.dataset.formulaRaw || btn.dataset.formula || "1d20";
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
        if (!path) return;
        await doc.update({ [path]: val });
      };

      el.addEventListener(el.tagName === "INPUT" ? "change" : "click", handler);
    });

    cell.querySelectorAll("[data-action='widgetButton']").forEach(btn => {
      btn.addEventListener("click", async () => {
        const rawFormula = btn.dataset.formulaRaw || btn.dataset.formula;
        if (!rawFormula) {
          if (btn.dataset.flavor) {
            ChatMessage.create({ content: btn.dataset.flavor, speaker: ChatMessage.getSpeaker({ actor: doc }) });
          }
          return;
        }

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
          sdSrc: { kind: "slot", actorUuid: actor.uuid, slotId, index: idx }
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
        const item = doc.items?.get(btn.dataset.itemId);
        if (!item || item.type !== "inventory") return;
        if (!item.system?.equippable) {
          ui.notifications?.warn(`"${item.name}" is not marked Equippable. Open the item → Hidden Fields and enable it.`);
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
        await item.update({ "system.equipped": next });
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
        await doc.update({ [`system.spellSlots.-=${lvl}`]: null });
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

    cell.querySelectorAll("[data-copy-macro]").forEach(btn => {
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
            setTimeout(() => {
              icon.className = "fas fa-scroll";
              icon.style.color = "";
            }, 1200);
          }
          ui.notifications.info("Macro script copied to clipboard!");
        } catch {
          await foundry.applications.api.DialogV2.prompt({
            window: { title: "Macro Script" },
            content: `<p style="font-size:11px;color:var(--sd-w-label, var(--sd-text-3));margin-bottom:6px">Copy the script below into a new Macro (type: Script):</p>
              <textarea style="width:100%;height:160px;font-family:monospace;font-size:11px;background:var(--sd-bg);color:#c0c0e0;border:1px solid var(--sd-w-bd,var(--sd-border));border-radius:4px;padding:6px;box-sizing:border-box;resize:vertical"
                readonly onclick="this.select()">${script}</textarea>`,
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

    const _readPath = (path) => {
      if (!path) return 0;
      if (path.startsWith("system.hiddenFields.")) {
        const key = path.slice("system.hiddenFields.".length);
        return this.document?.system?.hiddenFields?.[key] ?? 0;
      }
      return foundry.utils.getProperty(this.document, path) ?? 0;
    };

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

    cell.querySelectorAll(".widget-select-input[data-path]").forEach(sel => {
      sel.addEventListener("change", async () => {
        const path = sel.dataset.path;
        if (!path) return;
        await this.document.update({ [path]: sel.value });
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

    cell.querySelectorAll(".richtext-display").forEach(display => {
      const widget   = display.closest(".widget-richtext");
      const editWrap = widget?.querySelector(".richtext-edit-wrap");
      const textarea = widget?.querySelector(".richtext-editor");
      const btnSave  = widget?.querySelector(".richtext-save");
      const btnCancel= widget?.querySelector(".richtext-cancel");
      if (!textarea || !editWrap) return;

      // Sheet has `submitOnChange: true`, so any `change` event bubbling out
      // of the textarea triggers a full form submit → doc.update → re-render
      // → editor DOM is destroyed before the Save button's click can fire,
      // losing whatever the user typed. The textarea is intentionally not
      // a form field (no `name` attribute), so its content never needs to go
      // through the form submission path — block the bubbling and we keep
      // the editor alive until Save / Cancel actually run.
      const _stopBubble = ev => ev.stopPropagation();
      textarea.addEventListener("input",  _stopBubble);
      textarea.addEventListener("change", _stopBubble);

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

      let _savedOnMouseDown = false;
      const saveRichtext = async () => {
        if (_savedOnMouseDown) { _savedOnMouseDown = false; return; }
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
      // Capture the value on `mousedown` (fires before the textarea's blur),
      // so even if a stray form submit slips through and re-renders the DOM
      // before our `click` handler can run, the data is already persisted.
      btnSave?.addEventListener("mousedown", () => {
        const val  = textarea.value;
        const path = textarea.dataset.path;
        if (path) {
          _savedOnMouseDown = true;
          doc.update({ [path]: val }).catch(err => console.error("SD | richtext save failed:", err));
        }
      });
      btnSave?.addEventListener("click", saveRichtext);
      btnCancel?.addEventListener("click", cancelRichtext);

      textarea.addEventListener("keydown", ev => {
        if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); saveRichtext(); }
        if (ev.key === "Escape") { ev.preventDefault(); cancelRichtext(); }
      });
    });
  }

  _makeDropZone(tab, row, label = "Drop here", parentVS = null) {
    const rowCols = Math.max(1, Math.min(9, Number(row?.cols) || 3));
    const dz = document.createElement("div");
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

  _switchTab(tabId) {
    this.tabGroups.sheet = tabId;
    const root = this.element;

    root.querySelectorAll(".sd-tab-btn[data-tab-id]").forEach(a => {
      const active = a.dataset.tabId === tabId;
      a.style.color      = active ? "var(--sd-accent)" : "#666";
      a.style.background = active ? "var(--sd-bg)" : "transparent";
      a.style.borderColor = active ? "var(--sd-border) var(--sd-border) var(--sd-bg)" : "transparent";
    });

    root.querySelectorAll(".sd-tab-panel").forEach(p => {
      p.style.display = p.dataset.tab === tabId ? "flex" : "none";
    });
  }

  async _addTab(label = "New Tab") {
    const tabs = foundry.utils.deepClone(this.document.system.customTabs ?? []);
    const id   = foundry.utils.randomID(8);
    tabs.push({ id, label, icon: "", rows: [] });
    await this.document.update({ "system.customTabs": tabs });
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

  async _addWidget(tabId, rowId, widgetType, parentVsId = null) {
    const defaults = {
      text:      { label: "Label",    path: "system.flags.myField" },
      number:    { label: "Number",   path: "system.flags.myNumber" },
      resource:  { label: "Resource", pathValue: "system.resources.hp.value", pathMax: "system.resources.hp.max", color: "var(--sd-hp)" },
      dice:      { label: "Roll",     formula: "1d20" },
      button:    { label: "Action",   icon: "fa-bolt", color: "var(--sd-accent)", formula: "", flavor: "" },
      toggle:    { label: "Toggle",   path: "system.flags.myToggle", onLabel: "On", offLabel: "Off" },
      section:   { label: "Section",  span: 3 },
      vsection:  { label: "",         widgets: [], span: 1 },
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
      type: widgetType
    };

    const tabs = foundry.utils.deepClone(this.document.system.customTabs ?? []);
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

    await this.document.update({ "system.customTabs": tabs });
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
    const tabs = foundry.utils.deepClone(this.document.system.customTabs ?? []);
    const r    = tabs.find(t=>t.id===tab.id)?.rows?.find(r=>r.id===row.id);
    if (!r) return;
    const removed = this._removeWidgetDeep(r.widgets, w.id);
    if (removed) await this.document.update({ "system.customTabs": tabs });
  }

  _refreshWidgetIdsDeep(widget) {
    if (!widget) return;
    widget.id = foundry.utils.randomID(8);
    if (widget.type === "vsection" && Array.isArray(widget.widgets)) {
      for (const child of widget.widgets) this._refreshWidgetIdsDeep(child);
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
    container.splice(idx + 1, 0, clone);

    await this.document.update({ "system.customTabs": tabs });
  }

  async _insertWidgetSnapshot(snapshot, dst) {
    if (!snapshot || !dst?.tabId) return;
    const tabs = foundry.utils.deepClone(this.document.system.customTabs ?? []);
    const dstTab = tabs.find(t => t.id === dst.tabId);
    if (!dstTab) return;

    const clone = foundry.utils.deepClone(snapshot);
    this._refreshWidgetIdsDeep(clone);

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

      return;
    }

    const insertIdx = dst.toEnd ? dstContainer.length : Math.max(0, Math.min(dstContainer.length, dst.index ?? dstContainer.length));
    dstContainer.splice(insertIdx, 0, clone);
    await this.document.update({ "system.customTabs": tabs });
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
      srcContainer.splice(wIdx, 0, moved);
      return;
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
    badge.style.cssText = "position:absolute;top:4px;right:48px;background:var(--sd-accent);color:#fff;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;padding:2px 7px;border-radius:10px;z-index:100;pointer-events:none";
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

  static async _onOpenTrade(event, target) {
    const { SDTrade } = await import("../helpers/trade.mjs");
    await SDTrade.openFor(this.document);
  }

  static async _onOpenBuilder(event, target) {
    const { Toolbox } = await import("../builder/toolbox-app.mjs");
    Toolbox.toggle();
  }

  static async _onOpenSheetTriggers(event, target) {
    const { FormulaGraph } = await import("../builder/formula-graph.mjs");
    const graph = new FormulaGraph(null, this.document, null, null, null,
      { mode: "sheetTrigger" });
    graph.open();
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

  static async _resolveSlotSnapshot(srcActor, slotId, index) {
    if (!srcActor) return null;
    const arr = srcActor.system?.slotContents?.[slotId]?.contents ?? [];
    return arr[index] ?? null;
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

    if (src?.kind === "slot" && src.actorUuid === targetActor.uuid && src.slotId === slotId) return;

    let payload = null;
    if (src?.kind === "slot") {
      const srcActor = await fromUuid(src.actorUuid);
      payload = await CharacterSheet._resolveSlotSnapshot(srcActor, src.slotId, src.index);
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
      const srcActor = await fromUuid(src.actorUuid);
      if (srcActor) await SlotManager.removeFromSlot(srcActor, src.slotId, src.index);
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
      const srcActor = await fromUuid(src.actorUuid);
      payloadData = await CharacterSheet._resolveSlotSnapshot(srcActor, src.slotId, src.index);
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
      const srcActor = await fromUuid(src.actorUuid);
      if (srcActor) {
        const { SlotManager } = await import("../data/item-slots.mjs");
        await SlotManager.removeFromSlot(srcActor, src.slotId, src.index);
      }
    }
  }
}
