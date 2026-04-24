import { FormulaEngine } from "../helpers/formula-engine.mjs";

export class WidgetRenderer {

  /**
   * Render a single widget.
   * @param {object} widgetDef   - from system.customTabs[].rows[].widgets[]
   * @param {Actor|Item} doc     - the owning document
   * @param {boolean} editMode   - whether edit overlay should be enabled
   * @returns {string} HTML
   */
  static render(widgetDef, doc, editMode = false) {
    try {
      if (widgetDef.showIfKey && String(widgetDef.showIfKey).trim()) {
        let actualVal;
        const src = widgetDef.showIfKey.trim();
        try {
          if (src.startsWith("widget:")) {
            // resolve via formula engine widget:key mechanism
            actualVal = String(FormulaEngine.evaluate(`{${src}}`, doc) ?? "");
          } else if (src.startsWith("hidden:")) {
            const fieldName = src.slice("hidden:".length);
            const direct = doc?.system?.hiddenFields?.[fieldName];
            actualVal = String(direct !== undefined ? direct : "");
          } else {
            actualVal = String(foundry.utils.getProperty(doc, src) ?? "");
          }
        } catch { actualVal = ""; }
        const expected = String(widgetDef.showIfValue ?? "").trim();
        // Loose equality: "true"==true, "1"==1, etc.
        const visible = expected === ""
          ? (!!actualVal && actualVal !== "0" && actualVal !== "false")
          : actualVal === expected || String(Number(actualVal)) === expected;
        if (!visible) return `<!-- widget hidden by showIf: ${this._esc(src)}=${this._esc(expected)} -->`;
      } else if (widgetDef.showIf && String(widgetDef.showIf).trim()) {
        let visible = true;
        try {
          const result = FormulaEngine.evaluate(widgetDef.showIf, doc);
          visible = !!result && result !== "0" && result !== 0 && result !== false;
        } catch { visible = true; }
        if (!visible) return `<!-- widget hidden by showIf(legacy): ${this._esc(widgetDef.showIf)} -->`;
      }
      // render
      let html = this[`_render_${widgetDef.type}`]?.(widgetDef, doc) ?? this._renderUnknown(widgetDef);
      // extra CSS classes
      if (widgetDef.cssClass) {
        // Inject extra classes onto the outermost element
        html = html.replace(/^(<[^>]+class=")/, `$1${this._esc(widgetDef.cssClass)} `);
      }
      return html;
    } catch(e) {
      console.warn("SD | Widget render error:", e, widgetDef);
      return `<div class="widget widget-error"><i class="fas fa-exclamation-triangle"></i> ${widgetDef.type} error</div>`;
    }
  }

  static _get(doc, path, fallback = "") {
    if (!path) return fallback;
    // Fast-path: for hiddenFields, bypass getProperty's DataModel Proxy traversal
    // and read directly from the plain object stored in system.hiddenFields
    const HF_PREFIX = "system.hiddenFields.";
    if (path.startsWith(HF_PREFIX)) {
      const key = path.slice(HF_PREFIX.length);
      const val = doc?.system?.hiddenFields?.[key];
      return val !== undefined ? val : fallback;
    }
    const val = foundry.utils.getProperty(doc, path);
    return val ?? fallback;
  }

  /** Resolve a widget's displayed value — uses valueFormula if set, else path */
  static _getValue(w, doc, fallback = "") {
    if (w.valueFormula && FormulaEngine.isFormula(w.valueFormula)) {
      return FormulaEngine.evaluate(w.valueFormula, doc);
    }
    return this._get(doc, w.path, fallback);
  }

  /** Resolve a roll formula — replaces {refs} with live numbers */
  static _getRollFormula(w, doc) {
    const raw = w.formula ?? "1d20";
    return FormulaEngine.resolveForRoll(raw, doc);
  }

  static _esc(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;").replace(/"/g, "&quot;")
      .replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  /**
   * Returns HTML for a small "copy path" button.
   * data-copy-path is picked up by the sheet's delegated click handler.
   * @param {string} path   -- the dot-path to copy (e.g. "system.resources.hp.value")
   * @param {string} [tip]  -- tooltip suffix shown after the path
   */
  static _copyBtn(path, tip = "") {
    const e = this._esc;
    const title = e(path + (tip ? "  —  " + tip : ""));
    return `<button type="button" class="widget-copy-path" data-copy-path="${e(path)}" title="Copy path: ${title}" tabindex="-1" style="background:none;border:none;padding:0 0 0 4px;cursor:pointer;color:#3a3a52;font-size:9px;line-height:1;flex-shrink:0;transition:color .15s" onmouseenter="this.style.color='#7b68ee'" onmouseleave="this.style.color='#3a3a52'"><i class="fas fa-copy"></i></button>`;
  }

  // text

  static _render_text(w, doc) {
    const val  = this._getValue(w, doc, "");
    const esc  = this._esc;
    const hasFormula = w.valueFormula && FormulaEngine.isFormula(w.valueFormula);
    // Normalise readOnly -- Foundry may serialise boolean as string
    const isReadOnly = w.readOnly === true || w.readOnly === "true";
    // If formula-driven: show as read-only display, not editable input
    if (hasFormula) {
      return `<div class="widget widget-text">
  <div class="widget-label">${esc(w.label)} <span style="color:#5a4ec0;font-size:9px" title="Formula: ${esc(w.valueFormula)}">ƒ</span></div>
  <div class="widget-formula-val">${esc(String(val))}</div>
</div>`;
    }
    // If readOnly: display as non-editable label + value, no <input>
    if (isReadOnly) {
      return `<div class="widget widget-text widget-text--readonly">
  <div class="widget-label">${esc(w.label)} <span style="color:#555;font-size:9px;margin-left:2px" title="Read only">🔒</span></div>
  <div class="widget-text-readonly-val" style="background:#111120;border:1px solid #2a2a38;border-radius:4px;padding:3px 7px;font-size:12px;color:#8888aa;min-height:22px;word-break:break-word">${esc(String(val))}</div>
</div>`;
    }
    return `<div class="widget widget-text">
  <div class="widget-label" style="display:flex;align-items:center">${esc(w.label)}${w.path ? this._copyBtn(w.path, "text value") : ""}</div>
  <input type="text" name="${esc(w.path)}" value="${esc(val)}" placeholder="${esc(w.placeholder ?? "")}">
</div>`;
  }

  // number

  static _render_number(w, doc) {
    const val = this._getValue(w, doc, 0);
    const e   = this._esc;
    const hasFormula = w.valueFormula && FormulaEngine.isFormula(w.valueFormula);
    if (hasFormula) {
      return `<div class="widget widget-number">
  <div class="widget-label">${e(w.label)} <span style="color:#5a4ec0;font-size:9px" title="Formula: ${e(w.valueFormula)}">ƒ</span></div>
  <div class="widget-formula-val" style="font-size:18px;font-weight:700;text-align:center">${e(String(val))}</div>
</div>`;
    }
    return `<div class="widget widget-number">
  <div class="widget-label" style="display:flex;align-items:center">${e(w.label)}${w.path ? this._copyBtn(w.path, "number value") : ""}</div>
  <div class="num-row">
    <button type="button" class="num-btn" data-action="widgetNumStep"
            data-path="${e(w.path)}" data-step="-${w.step ?? 1}"
            data-min="${w.min ?? ""}" data-max="${w.max ?? ""}">−</button>
    <input type="number" name="${e(w.path)}" value="${e(val)}"
           min="${w.min ?? ""}" max="${w.max ?? ""}" step="${w.step ?? 1}">
    <button type="button" class="num-btn" data-action="widgetNumStep"
            data-path="${e(w.path)}" data-step="${w.step ?? 1}"
            data-min="${w.min ?? ""}" data-max="${w.max ?? ""}">+</button>
  </div>
</div>`;
  }

  // resource

  static _render_resource(w, doc) {
    const val   = Number(this._get(doc, w.pathValue, 0));
    const max   = Number(this._get(doc, w.pathMax,   0));
    const pct   = max > 0 ? Math.round(Math.clamp(val / max, 0, 1) * 100) : 0;
    const color = w.color ?? "#7b68ee";
    const e     = this._esc;
    return `<div class="widget widget-resource">
  <div class="widget-label" style="display:flex;align-items:center">${e(w.label)}${w.pathValue ? this._copyBtn(w.pathValue, "value") : ""}${w.pathMax ? this._copyBtn(w.pathMax, "max") : ""}</div>
  <div class="res-row">
    <input type="number" name="${e(w.pathValue)}" value="${e(val)}" class="res-val">
    <span class="res-sep">/</span>
    <input type="number" name="${e(w.pathMax)}" value="${e(max)}" class="res-max">
  </div>
  <div class="res-bar"><div class="res-bar-fill" style="width:${pct}%;background:${e(color)}"></div></div>
</div>`;
  }

  // dice

  static _render_dice(w, doc) {
    const e          = this._esc;
    const rawFormula = w.formula ?? "1d20";
    const hasRefs    = FormulaEngine.isFormula(rawFormula);
    const displayFml = hasRefs ? FormulaEngine.resolveForRoll(rawFormula, doc) : rawFormula;
    return `<div class="widget widget-dice">
  <div class="widget-label">${e(w.label)}${hasRefs ? ` <span style="color:#5a4ec0;font-size:9px" title="Formula with refs">ƒ</span>` : ""}</div>
  <button type="button" class="dice-btn" data-action="widgetRoll"
          data-formula="${e(displayFml)}"
          data-formula-raw="${e(rawFormula)}"
          data-flavor="${e(w.flavor ?? "")}">
    <i class="fas ${e(w.icon ?? "fa-dice-d20")}"></i>
    ${e(w.label)}
    <span style="opacity:.6;font-size:10px">(${e(displayFml)})</span>
  </button>
</div>`;
  }

  // button

  static _render_button(w, doc) {
    const e       = this._esc;
    const color   = w.color ?? "#7b68ee";
    const icon    = w.icon  ?? "fa-bolt";
    const formula = w.formula ? (FormulaEngine.isFormula(w.formula) ? FormulaEngine.resolveForRoll(w.formula, doc) : w.formula) : "";
    return `<div class="widget widget-button">
  <button type="button" class="sd-action-btn" data-action="widgetButton"
          data-formula-raw="${e(w.formula ?? "")}"
          data-formula="${e(formula)}"
          data-flavor="${e(w.flavor ?? w.label ?? "")}"
          style="width:100%;display:flex;align-items:center;justify-content:center;gap:6px;padding:6px 10px;background:${e(color)}22;border:1px solid ${e(color)};border-radius:5px;color:${e(color)};cursor:pointer;font-size:12px;font-weight:600;transition:background .15s">
    <i class="fas ${e(icon)}"></i>
    <span>${e(w.label)}</span>
  </button>
</div>`;
  }

  // toggle

  static _render_toggle(w, doc) {
    const val    = !!this._get(doc, w.path, false);
    const dispLbl = val ? (w.onLabel ?? "On") : (w.offLabel ?? "Off");
    const e = this._esc;
    return `<div class="widget widget-toggle">
  <div class="widget-label" style="display:flex;align-items:center">${e(w.label)}${ w.path ? this._copyBtn(w.path, 'toggle state') : ''}</div>
  <div class="tog-row" data-action="widgetToggle"
       data-path="${e(w.path)}" data-value="${val}" style="cursor:pointer">
    <div class="tog-track ${val ? "on" : ""}">
      <div class="tog-knob"></div>
    </div>
    <span class="tog-val">${e(dispLbl)}</span>
  </div>
</div>`;
  }

  // slot

  static _render_slot(w, doc) {
    const { SlotManager } = globalThis._SD_SLOTS ?? {};
    const contents = SlotManager ? SlotManager.getContents(doc, w.slotId) : [];
    const def      = SlotManager ? SlotManager.getDefinition(doc, w.slotId) : null;
    const max      = def?.maxCount ?? w.maxCount ?? 1;
    const e = this._esc;
    const items = contents.map((c, i) => `
      <li class="slot-mini-item" data-slot-id="${e(w.slotId)}" data-slot-index="${i}">
        <img class="slot-mini-img" src="${e(c.img ?? "icons/svg/item-bag.svg")}" alt="${e(c.name ?? "")}">
        <span>${e(c.name ?? "")}</span>
        <button type="button" class="slot-item-use item-use-btn" data-action="slotItemUse" data-slot-id="${e(w.slotId)}" data-slot-index="${i}" title="Use">
          <i class="fas fa-play"></i>
        </button>
        <button type="button" class="slot-item-edit" data-action="slotItemEdit" data-slot-id="${e(w.slotId)}" data-slot-index="${i}" data-item-id="${e(c._id ?? "")}" data-item-uuid="${e(c._sourceUuid ?? c.uuid ?? "")}" title="Edit">
          <i class="fas fa-pen"></i>
        </button>
        <button type="button" class="slot-item-remove" data-sd-slot-remove="${e(w.slotId)}" data-sd-slot-idx="${i}" title="Remove">
          <i class="fas fa-times"></i>
        </button>
      </li>`).join("");
    const slotCountPath    = `system.slotContents.${w.slotId}.count`;
    const slotContentsPath = `system.slotContents.${w.slotId}.contents`;
    return `<div class="widget widget-slot">
  <div class="widget-label" style="display:flex;align-items:center">${e(w.label)} <span style="opacity:.5;margin-left:3px">${contents.length}/${max}</span>${this._copyBtn(slotCountPath, "count")}${this._copyBtn(slotContentsPath, "contents array")}</div>
  <ul class="slot-mini-list">${items}</ul>
  <div class="slot-drop-mini" data-sd-slot-drop="${e(w.slotId)}">
    <i class="fas fa-arrow-down-to-line"></i> Drop item here
  </div>
</div>`;
  }

  // inventory

  static _render_inventory(w, doc) {
    const e = this._esc;
    const isActor = doc instanceof Actor;
    if (!isActor) return `<div class="widget widget-inventory"><p style="color:var(--sd-text-3)">Inventory widget only works on Actor sheets</p></div>`;

    // Get items from actor
    let items = [...(doc.items ?? [])];
    const categories = w.categories ?? [];
    const columns = w.columns ?? [];

    // Filter by categories if specified
    if (categories.length > 0) {
      items = items.filter(item => categories.includes(item.system?.category));
    }

    // Group by category
    const grouped = {};
    items.forEach(item => {
      const cat = item.system?.category ?? "other";
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(item);
    });

    // Build column headers
    let colHeaders = "";
    let colCells = "";
    if (columns.length > 0) {
      colHeaders = columns.map(col => `<span class="item-col-header">${e(col)}</span>`).join("");
    }

    // Build HTML
    let html = `<div class="widget widget-inventory">
  <div class="widget-label">${e(w.label)}</div>`;

    // Currency row if enabled
    if (w.showCurrency) {
      const c = doc.system?.currency ?? {};
      if (w.currencyPath) {
        // Single custom money field
        // Derive a display label from the last segment of the path
        const pathLabel = w.currencyPath.split(".").pop()
          .replace(/([A-Z])/g, " $1")
          .replace(/^./, s => s.toUpperCase());
        const curVal = this._get(doc, w.currencyPath, 0);
        html += `
  <div class="currency-row currency-row--single">
    <label style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
      title="${e(w.currencyPath)}">${e(pathLabel)}</label>
    <input type="number" name="${e(w.currencyPath)}" value="${curVal}" placeholder="0"
      style="width:80px;flex-shrink:0">
    <button type="button"
      class="widget-copy-path currency-path-copy"
      data-copy-path="${e(w.currencyPath)}"
      title="Copy path: ${e(w.currencyPath)}"
      style="background:none;border:none;color:#555;cursor:pointer;font-size:11px;padding:0 4px;flex-shrink:0">
      <i class="fas fa-copy"></i>
    </button>
  </div>`;
      } else {
        // Default three-column currency
        html += `
  <div class="currency-row">
    <label>${e(c.label1 ?? "Gold")}</label>
    <input type="number" name="system.currency.primary" value="${c.primary ?? 0}" placeholder="0">
    <label>${e(c.label2 ?? "Silver")}</label>
    <input type="number" name="system.currency.secondary" value="${c.secondary ?? 0}" placeholder="0">
    <label>${e(c.label3 ?? "Copper")}</label>
    <input type="number" name="system.currency.tertiary" value="${c.tertiary ?? 0}" placeholder="0">
  </div>`;
      }
    }

    // Drop zone for items
    html += `
  <div class="inventory-drop-zone" data-drop-zone="item">
    <i class="fas fa-arrow-down-to-line"></i> Drop items here
  </div>`;

    // Item categories
    const categoryOrder = ["weapon", "armor", "shield", "consumable", "ammo", "magazine", "tool", "gear", "container", "treasure", "other"];

    for (const cat of categoryOrder) {
      const catItems = grouped[cat];
      if (!catItems || catItems.length === 0) continue;

      html += `
  <div class="item-category">
    <div class="category-header">${cat.toUpperCase()}</div>
    <ul class="item-list">`;

      for (const item of catItems) {
        const qty = item.system?.quantity ?? 1;
        const weight = w.showWeight ? (item.system?.weight ?? 0) : null;
        const equipped = item.system?.equipped ? "equipped" : "";

        // Build extra columns
        let extraCols = "";
        if (columns.length > 0) {
          for (const col of columns) {
            // hiddenFields stores plain values (string/number), not {value:...} objects
            const val = item.system?.hiddenFields?.[col] ?? item.system?.[col] ?? "";
            extraCols += `<span class="item-col">${e(String(val))}</span>`;
          }
        }

        html += `
      <li class="item-row ${equipped}" data-item-id="${item.id}" data-item-drag>
        <img class="item-img" src="${e(item.img)}" alt="${e(item.name)}">
        <span class="item-name">${e(item.name)}</span>
        ${qty > 1 ? `<span class="item-qty">×${qty}</span>` : ""}
        ${weight !== null ? `<span class="item-weight">${weight} lb</span>` : ""}
        ${extraCols}
        <div class="item-controls">
          <button type="button" class="item-btn item-use-btn" data-action="itemUse" data-item-id="${item.id}" title="Use"><i class="fas fa-play"></i></button>
          <button type="button" class="item-btn" data-action="itemEdit" data-item-id="${item.id}"><i class="fas fa-edit"></i></button>
          <button type="button" class="item-btn" data-action="itemDelete" data-item-id="${item.id}"><i class="fas fa-trash"></i></button>
        </div>
      </li>`;
      }

      html += `
    </ul>
  </div>`;
    }

    if (items.length === 0) {
      html += `
  <div class="empty-list"><i class="fas fa-backpack"></i><span>No items - drag to add</span></div>`;
    }

    html += `
</div>`;
    return html;
  }

  // attribute

  static _render_attribute(w, doc) {
    const score = Number(this._get(doc, w.path, 10));
    const e     = this._esc;

    let mod;
    if (w.modValueFormula) {
      const resolved = Number(FormulaEngine.evaluate(w.modValueFormula, doc));
      mod = isNaN(resolved) ? Math.floor((score - 10) / 2) : resolved;
    } else {
      mod = Math.floor((score - 10) / 2);
    }
    const ms = mod >= 0 ? `+${mod}` : `${mod}`;

    // onClickFormula: compiled exec action graph from on_click → attr_output exec chain
    // If present, clicking the modifier runs ButtonExecutor; otherwise falls back to 1d20+mod roll
    const onClickFml = w.onClickFormula ?? null;

    // data attributes for the click handler in character-sheet
    const dataOnClick = onClickFml
      ? `data-attr-onclick="${e(onClickFml)}"`
      : `data-attr-roll="1d20+(${mod})" data-flavor="${e(w.flavor || w.label)}"`;

    return `<div class="widget widget-attribute">
  <div class="widget-label" style="display:flex;align-items:center">${e(w.label)}${w.path ? this._copyBtn(w.path, "score") : ""}</div>
  <div class="attr-box">
    <input type="number" name="${e(w.path)}" value="${e(score)}" class="attr-score">
    <button type="button" class="attr-mod" data-action="attrModClick"
            ${dataOnClick}
            title="Click to roll ${e(w.label)}">${ms}</button>
  </div>
</div>`;
  }

  // skill
  static _render_skill(w, doc) {
    const rank   = Number(this._get(doc, w.path, 0));
    const attrMod = Number(w.attrMod ?? 0);
    const bonus  = rank + attrMod;
    const bs     = bonus >= 0 ? `+${bonus}` : `${bonus}`;
    const e      = this._esc;

    // onClickFormula works exactly like attribute widget -- wired from graph editor
    const onClickFml = w.onClickFormula ?? null;
    const rawFml     = w.formula || `1d20+${bonus}`;
    const dispFml    = FormulaEngine.isFormula(rawFml)
      ? FormulaEngine.resolveForRoll(rawFml, doc)
      : rawFml;
    const flavor = w.flavor || w.label;

    const dataOnClick = onClickFml
      ? `data-attr-onclick="${e(onClickFml)}"`
      : `data-formula="${e(dispFml)}" data-formula-raw="${e(rawFml)}" data-flavor="${e(flavor)}"`;

    // Use attrModClick (same handler as attribute) when graph is wired,
    // otherwise widgetRoll for the plain formula path.
    const action = onClickFml ? "attrModClick" : "widgetRoll";

    return `<div class="widget widget-skill">
  <div class="widget-label" style="display:flex;align-items:center">${e(w.label)}${w.path ? this._copyBtn(w.path, "rank") : ""}</div>
  <div class="attr-box">
    <input type="number" name="${e(w.path)}" value="${e(rank)}" class="attr-score">
    <button type="button" class="skill-roll attr-mod" data-action="${action}"
            ${dataOnClick}
            title="Roll ${e(w.label)}">${bs}</button>
  </div>
</div>`;
  }

  // section

  static _render_section(w, doc) {
    const e = this._esc;
    return `<div class="widget widget-section">
  <div class="sec-title">${e(w.label)}</div>
  <hr class="sec-divider">
</div>`;
  }

  static _render_vsection(w, doc) {
    const e = this._esc;
    const header = w.label
      ? `<div class="vsection-title" style="font-size:10px;font-weight:700;color:#7b68ee;text-transform:uppercase;letter-spacing:.05em;padding:2px 0 4px">${e(w.label)}</div>`
      : "";
    const children = (w.widgets ?? []).map(cw => {
      try { return this.render(cw, doc) ?? ""; }
      catch { return ""; }
    }).join("");
    return `<div class="widget widget-vsection" style="display:flex;flex-direction:column;gap:6px;padding:6px;border:1px dashed rgba(123,104,238,.18);border-radius:5px;background:rgba(123,104,238,.03)">${header}${children}</div>`;
  }

  // richtext

  static _render_richtext(w, doc) {
    const val = this._get(doc, w.path, "");
    const e   = this._esc;
    return `<div class="widget widget-richtext">
  <div class="widget-label">${e(w.label)}</div>
  <div class="richtext-display" data-path="${e(w.path)}"
       style="min-height:60px;cursor:text;padding:6px 8px;background:#1e1e2a;border:1px solid #3a3a52;border-radius:4px;font-size:12px;color:#a0a0c0;line-height:1.6;word-break:break-word">
    ${val || "<span style='opacity:.35;font-style:italic'>Click to edit…</span>"}
  </div>
  <div class="richtext-edit-wrap" style="display:none;position:relative">
    <textarea class="richtext-editor" data-path="${e(w.path)}"
      style="width:100%;min-height:80px;resize:vertical;background:#1e1e2a;border:1px solid #7b68ee;border-radius:4px 4px 0 0;color:#e0e0ee;font-size:12px;padding:6px 8px;box-sizing:border-box;font-family:inherit;line-height:1.6;display:block"
      placeholder="Enter text…">${e(val)}</textarea>
    <div style="display:flex;gap:6px;padding:4px 0 2px">
      <button type="button" class="richtext-save" style="flex:1;background:#2a4a2a;border:1px solid #3a7a3a;border-radius:4px;color:#5ae07a;cursor:pointer;font-size:11px;padding:4px 8px">✓ Save</button>
      <button type="button" class="richtext-cancel" style="background:#2a1a1a;border:1px solid #5a2a2a;border-radius:4px;color:#c07070;cursor:pointer;font-size:11px;padding:4px 10px">✕</button>
    </div>
  </div>
</div>`;
  }

  // effects

  static _render_effects(w, doc) {
    const e = this._esc;
    // Works on both Actor and Item -- Item.effects stores its own AEs
    const effects = [...(doc.effects ?? [])];

    // Filter by transfer flag if widget is on an actor and user only wants non-passive
    const showPassive  = w.showPassive  !== false;
    const showDisabled = w.showDisabled !== false;
    const filtered = effects.filter(ef => {
      if (!showPassive  && ef.transfer)  return false;
      if (!showDisabled && ef.disabled)  return false;
      return true;
    });

    const canEdit = doc.isOwner ?? true;

    // Duration helper
    const _durLabel = (ef) => {
      const d = ef.duration;
      if (!d) return "";
      if (d.rounds && d.rounds > 0) return `${d.rounds}r`;
      if (d.seconds && d.seconds > 0) return `${d.seconds}s`;
      return "";
    };

    let rows = "";
    for (const ef of filtered) {
      const disabled = ef.disabled ? "effect-disabled" : "";
      const dur      = _durLabel(ef);
      const eyeIcon  = ef.disabled ? "fa-eye-slash" : "fa-eye";
      rows += `
      <li class="effect-row ${disabled}" data-effect-id="${e(ef.id)}">
        <img class="effect-img" src="${e(ef.img ?? ef.icon ?? 'icons/svg/aura.svg')}" alt="${e(ef.name)}">
        <span class="effect-name">${e(ef.name)}</span>
        ${dur ? `<span class="effect-dur">${e(dur)}</span>` : ""}
        <div class="effect-controls">
          ${canEdit ? `<button type="button" class="effect-btn" data-action="effectToggle" data-effect-id="${e(ef.id)}" title="${ef.disabled ? 'Enable' : 'Disable'}"><i class="fas ${eyeIcon}"></i></button>` : ""}
          <button type="button" class="effect-btn" data-action="effectEdit" data-effect-id="${e(ef.id)}" title="Edit"><i class="fas fa-pen"></i></button>
          ${canEdit ? `<button type="button" class="effect-btn effect-btn-del" data-action="effectDelete" data-effect-id="${e(ef.id)}" title="Delete"><i class="fas fa-trash"></i></button>` : ""}
        </div>
      </li>`;
    }

    return `<div class="widget widget-effects">
  <div class="widget-label">
    ${e(w.label)}
    ${canEdit ? `<button type="button" class="effect-create-btn" data-action="effectCreate" title="Add Effect"><i class="fas fa-plus"></i></button>` : ""}
  </div>
  ${filtered.length
    ? `<ul class="effects-list">${rows}</ul>`
    : `<div class="empty-list"><i class="fas fa-sparkles"></i><span>No effects</span></div>`
  }
</div>`;
  }

  static _render_spellbook(w, doc) {
    const e = this._esc;
    if (!(doc instanceof Actor)) {
      return `<div class="widget widget-spellbook"><p class="sb-only-actor">Spellbook works on Actor sheets only</p></div>`;
    }

    const wantType = String(w.abilityType ?? (w.type && w.type !== "spellbook" ? w.type : "") ?? "").trim();

    // Filter actor items down to abilities of the widget's configured type.
    let abilities = [...(doc.items ?? [])].filter(i => i.type === "ability");
    if (wantType) {
      abilities = abilities.filter(i => {
        const t = String(i.system?.hiddenFields?.type ?? "").trim();
        return t === wantType;
      });
    }

    const typeBadge = wantType
      ? `<span class="sb-type-badge" style="margin-left:8px;padding:1px 7px;border-radius:3px;background:rgba(123,104,238,.18);color:#9d8fff;font-size:10px;font-weight:600;letter-spacing:.04em;text-transform:uppercase">${e(wantType)}</span>`
      : "";

    let html = `<div class="widget widget-spellbook">
  <div class="widget-label">${e(w.label ?? "Spellbook")}${typeBadge}</div>`;

    if (abilities.length === 0) {
      html += `<div class="empty-list"><i class="fas fa-book-sparkles"></i><span>No abilities${wantType ? ` of type "${e(wantType)}"` : ""} — drag ability items here</span></div>`;
    } else {
      html += `
  <ul class="sb-ability-list">`;
      for (const ab of abilities) {
        html += this._sbAbilityRow(ab, e);
      }
      html += `
  </ul>`;
    }

    html += `
  <div class="sb-drop-zone" data-action="spellbookDrop" data-want-type="${e(wantType)}"
    style="margin-top:8px;border:1px dashed rgba(123,104,238,.25);border-radius:4px;padding:6px 10px;text-align:center;font-size:11px;color:#555;cursor:pointer">
    <i class="fas fa-arrow-down-to-line" style="margin-right:4px;opacity:.5"></i>Drop ability items here
  </div>
</div>`;
    return html;
  }
  // showIf guard -- injected at top of render()
  // (handled by patching the render() method itself below)

  // progress
  static _render_progress(w, doc) {
    const esc  = this._esc.bind(this);
    const val  = Number(this._get(doc, w.pathValue, 0)) || 0;
    const max  = Number(this._get(doc, w.pathMax,   1)) || 1;
    const pct  = Math.round(Math.min(100, Math.max(0, (val / max) * 100)));
    const col  = esc(w.color   ?? "#5a8aff");
    const lbl  = esc(w.label   ?? "Progress");
    const showLabel = w.showLabel !== false && w.showLabel !== "false";
    const showPct   = w.showPct   !== false && w.showPct   !== "false";
    // progress is always read-only (values driven by data paths / formulas).
    // Show a small lock badge so users understand they cannot click to edit.
    return `<div class="widget widget-progress">
  <div class="widget-label-row" style="display:flex;align-items:baseline;gap:4px;margin-bottom:3px">
    ${showLabel ? `<span class="widget-label">${lbl}</span>` : ""}
    <span title="Read-only — edit via the source field" style="font-size:9px;color:#555;margin-left:3px;cursor:default">🔒</span>
    ${showPct   ? `<span style="margin-left:auto;font-size:10px;color:#888">${val}/${max} (${pct}%)</span>` : ""}
  </div>
  <div style="background:#1a1a28;border-radius:3px;height:10px;overflow:hidden;border:1px solid #2a2a38;opacity:.85">
    <div style="height:100%;width:${pct}%;background:${col};border-radius:3px;transition:width .3s"></div>
  </div>
</div>`;
  }

  // select
  static _render_select(w, doc) {
    const esc   = this._esc.bind(this);
    const cur   = String(this._get(doc, w.path, ""));
    const lbl   = esc(w.label ?? "Select");
    const path  = esc(w.path  ?? "");
    const raw   = String(w.choices ?? "");
    const opts  = raw.split(",").map(s => s.trim()).filter(Boolean);
    const optsHtml = opts.map(o =>
      `<option value="${esc(o)}"${cur === o ? " selected" : ""}>${esc(o)}</option>`
    ).join("");
    return `<div class="widget widget-select">
  <label class="widget-label">${lbl}</label>
  <select class="widget-select-input" name="${path}" data-path="${path}" style="width:100%;background:#0c0c18;border:1px solid #2a2a40;border-radius:4px;color:#c0c0d8;padding:3px 6px;font-size:12px">
    ${optsHtml}
  </select>
</div>`;
  }

  // clock
  static _render_clock(w, doc) {
    const esc   = this._esc.bind(this);
    const lbl   = esc(w.label ?? "Clock");
    const path  = esc(w.path  ?? "");
    const segs  = Math.min(12, Math.max(2, Number(w.segments ?? 4)));
    const filled = Number(this._get(doc, w.path, 0)) || 0;
    const col   = esc(w.color   ?? "#e0a020");
    const bg    = esc(w.bgColor ?? "#1a1a2a");
    const size  = 64;
    const cx = size / 2, cy = size / 2, r = size / 2 - 3;

    // Build SVG pie segments
    const slices = [];
    for (let i = 0; i < segs; i++) {
      const startAngle = (i / segs) * 2 * Math.PI - Math.PI / 2;
      const endAngle   = ((i + 1) / segs) * 2 * Math.PI - Math.PI / 2;
      const x1 = cx + r * Math.cos(startAngle);
      const y1 = cy + r * Math.sin(startAngle);
      const x2 = cx + r * Math.cos(endAngle);
      const y2 = cy + r * Math.sin(endAngle);
      const largeArc = segs === 1 ? 1 : 0;
      const fill = i < filled ? col : bg;
      slices.push(
        `<path d="M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${largeArc},1 ${x2},${y2} Z"
          fill="${fill}" stroke="#2a2a3a" stroke-width="1.5"
          class="sd-clock-segment" data-path="${path}" data-index="${i}" data-segs="${segs}"
          style="cursor:pointer;transition:opacity .1s" />`
      );
    }
    return `<div class="widget widget-clock" style="display:flex;flex-direction:column;align-items:center;gap:3px">
  <div style="display:flex;align-items:center;gap:5px">
    <span class="widget-label">${lbl}</span>
    <button type="button" class="sd-clock-reset" data-path="${path}" data-segs="${segs}"
      title="Reset clock to 0"
      style="background:none;border:1px solid #3a3a52;border-radius:3px;color:#555;
             cursor:pointer;font-size:9px;padding:0 5px;line-height:1.6;
             transition:color .15s,border-color .15s"
      onmouseover="this.style.color='#e05050';this.style.borderColor='#e05050'"
      onmouseout="this.style.color='#555';this.style.borderColor='#3a3a52'">↺</button>
  </div>
  <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" style="overflow:visible">
    ${slices.join("\n    ")}
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#3a3a52" stroke-width="1.5"/>
    <text x="${cx}" y="${cy+4}" text-anchor="middle" font-size="11" fill="#ccc" pointer-events="none">${filled}/${segs}</text>
  </svg>
</div>`;
  }

  // tracker
  static _render_tracker(w, doc) {
    const esc     = this._esc.bind(this);
    const lbl     = esc(w.label ?? "Tracker");
    const rawPath = w.path ?? "";
    const path    = esc(rawPath);

    const filled = Math.max(0, Number(this._get(doc, rawPath, 0)) || 0);

    const defaultMax = Number(w.maxCount ?? 6) || 6;
    let maxVal = defaultMax;
    if (w.maxPath) {
      const rawMax = this._get(doc, w.maxPath, null);
      const parsed = Number(rawMax);
      if (rawMax !== null && rawMax !== "" && !isNaN(parsed) && parsed > 0) maxVal = parsed;
    }
    maxVal = Math.min(Math.max(1, Math.round(maxVal)), 50);

    const col   = esc(w.color   ?? "#e04040");
    const bg    = esc(w.bgColor ?? "#2a2a3a");
    const icon  = esc(w.icon    ?? "fa-circle");
    const size  = Math.min(24, Math.max(10, Number(w.pipSize ?? 14)));

    const pips = [];
    for (let i = 0; i < maxVal; i++) {
      const active = i < filled;
      pips.push(
        `<i class="fas ${icon} sd-tracker-pip"
            data-path="${path}" data-index="${i}" data-max="${maxVal}"
            title="${i+1}/${maxVal} — click to fill, click filled to unfill"
            style="font-size:${size}px;cursor:pointer;
                   color:${active ? col : bg};
                   text-shadow:${active ? `0 0 ${Math.round(size*0.45)}px ${col}` : "none"};
                   transition:color .12s ease, text-shadow .12s ease, transform .08s ease"></i>`
      );
    }

    return `<div class="widget widget-tracker" style="display:flex;flex-direction:column;gap:2px">
  <div style="display:flex;align-items:center;gap:6px">
    <span class="widget-label">${lbl}</span>
    <span style="font-size:9px;color:#777">${filled}/${maxVal}</span>
    <button type="button" class="sd-tracker-reset" data-path="${path}"
      title="Reset tracker to 0"
      style="background:none;border:1px solid #3a3a52;border-radius:3px;color:#555;
             cursor:pointer;font-size:9px;padding:0 5px;line-height:1.6;margin-left:auto;
             transition:color .15s,border-color .15s"
      onmouseover="this.style.color='#e05050';this.style.borderColor='#e05050'"
      onmouseout="this.style.color='#555';this.style.borderColor='#3a3a52'">↺</button>
  </div>
  <div class="sd-tracker-row" style="display:flex;flex-wrap:wrap;gap:4px;align-items:center;padding:2px 0">
    ${pips.join("\n    ")}
  </div>
</div>`;
  }

  // counter
  static _render_counter(w, doc) {
    const e    = this._esc;
    const val  = Number(this._get(doc, w.path, 0)) || 0;
    const col  = e(w.color ?? "#e0a020");
    const step = Number(w.step ?? 1) || 1;
    return `<div class="widget widget-counter" style="display:flex;flex-direction:column;align-items:center;gap:2px;padding:4px 0">
  <div class="widget-label" style="font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:#98a6c6">${e(w.label ?? "Counter")}</div>
  <div style="display:flex;align-items:center;gap:8px">
    <button type="button" class="num-btn" data-action="widgetNumStep"
            data-path="${e(w.path)}" data-step="-${step}"
            data-min="${w.min ?? ""}" data-max="${w.max ?? ""}"
            style="font-size:16px;width:28px;height:28px;border-radius:6px;
                   background:#1a1a24;border:1px solid ${col}66;color:${col};
                   cursor:pointer;transition:all .12s"
            onmouseover="this.style.background='${col}22'"
            onmouseout="this.style.background='#1a1a24'">−</button>
    <div style="font-size:22px;font-weight:700;min-width:38px;text-align:center;color:${col};
                text-shadow:0 0 8px ${col}55">${val}</div>
    <button type="button" class="num-btn" data-action="widgetNumStep"
            data-path="${e(w.path)}" data-step="${step}"
            data-min="${w.min ?? ""}" data-max="${w.max ?? ""}"
            style="font-size:16px;width:28px;height:28px;border-radius:6px;
                   background:#1a1a24;border:1px solid ${col}66;color:${col};
                   cursor:pointer;transition:all .12s"
            onmouseover="this.style.background='${col}22'"
            onmouseout="this.style.background='#1a1a24'">+</button>
  </div>
</div>`;
  }

  // rollButton
  static _render_rollButton(w, doc) {
    const e    = this._esc;
    const raw  = w.formula ?? "1d20";
    const col  = e(w.color ?? "#5a9ae0");
    const icon = e(w.icon ?? "fa-dice-d20");
    const hasRefs = FormulaEngine.isFormula(raw);
    const display = hasRefs ? FormulaEngine.resolveForRoll(raw, doc) : raw;
    return `<div class="widget widget-roll-button" style="display:flex;flex-direction:column;align-items:stretch;padding:2px 0">
  <button type="button" class="dice-btn widget-roll-button-btn"
          data-action="widgetRoll"
          data-formula="${e(display)}"
          data-formula-raw="${e(raw)}"
          data-flavor="${e(w.flavor ?? w.label ?? "")}"
          title="Roll ${e(display)}"
          style="display:flex;align-items:center;gap:8px;padding:8px 12px;
                 background:linear-gradient(135deg, ${col}33, ${col}11);
                 border:1px solid ${col}88; border-radius:6px; color:#e0e0f0;
                 cursor:pointer; font-size:12px; font-weight:600; text-align:left;
                 transition:all .15s; box-shadow:0 1px 2px #0006"
          onmouseover="this.style.background='linear-gradient(135deg, ${col}55, ${col}22)';this.style.borderColor='${col}';this.style.transform='translateY(-1px)'"
          onmouseout="this.style.background='linear-gradient(135deg, ${col}33, ${col}11)';this.style.borderColor='${col}88';this.style.transform='none'">
    <i class="fas ${icon}" style="color:${col};font-size:16px"></i>
    <span style="flex:1">${e(w.label ?? "Roll")}</span>
    <span style="opacity:.7;font-size:10px;font-weight:400">${e(display)}</span>
  </button>
</div>`;
  }

  // tokenPool
  static _render_tokenPool(w, doc) {
    const e       = this._esc;
    const rawPath = w.path ?? "";
    const path    = e(rawPath);
    const filled  = Math.max(0, Number(this._get(doc, rawPath, 0)) || 0);

    const defaultMax = Number(w.maxCount ?? 10) || 10;
    let maxVal = defaultMax;
    if (w.maxPath) {
      const rawMax = this._get(doc, w.maxPath, null);
      const parsed = Number(rawMax);
      if (rawMax !== null && rawMax !== "" && !isNaN(parsed) && parsed > 0) maxVal = parsed;
    }
    maxVal = Math.min(Math.max(1, Math.round(maxVal)), 50);

    const col   = e(w.color   ?? "#f0c040");
    const bg    = e(w.bgColor ?? "#2a2a3a");
    const icon  = e(w.icon    ?? "fa-coins");
    const size  = Math.min(24, Math.max(10, Number(w.pipSize ?? 16)));

    const pips = [];
    for (let i = 0; i < maxVal; i++) {
      const active = i < filled;
      pips.push(
        `<i class="fas ${icon} sd-tracker-pip"
            data-path="${path}" data-index="${i}" data-max="${maxVal}"
            title="${i+1}/${maxVal}"
            style="font-size:${size}px;cursor:pointer;
                   color:${active ? col : bg};
                   text-shadow:${active ? `0 0 ${Math.round(size*0.45)}px ${col}` : "none"};
                   transition:color .12s ease, text-shadow .12s ease"></i>`
      );
    }

    return `<div class="widget widget-token-pool" style="display:flex;flex-direction:column;gap:3px">
  <div style="display:flex;align-items:center;gap:6px">
    <span class="widget-label">${e(w.label ?? "Tokens")}</span>
    <span style="font-size:10px;color:${col};font-weight:700">${filled}/${maxVal}</span>
    <div style="margin-left:auto;display:flex;gap:3px">
      <button type="button" class="num-btn" data-action="widgetNumStep"
              data-path="${path}" data-step="-1" data-min="0" data-max="${maxVal}"
              title="Spend one"
              style="width:22px;height:22px;font-size:12px;border-radius:4px;
                     background:#1a1a24;border:1px solid ${col}66;color:${col};cursor:pointer">−</button>
      <button type="button" class="num-btn" data-action="widgetNumStep"
              data-path="${path}" data-step="1" data-min="0" data-max="${maxVal}"
              title="Gain one"
              style="width:22px;height:22px;font-size:12px;border-radius:4px;
                     background:#1a1a24;border:1px solid ${col}66;color:${col};cursor:pointer">+</button>
    </div>
  </div>
  <div class="sd-token-row" style="display:flex;flex-wrap:wrap;gap:3px;align-items:center;padding:2px 0">
    ${pips.join("\n    ")}
  </div>
</div>`;
  }

  // diceTray
  static _render_diceTray(w, doc) {
    const e       = this._esc;
    const flagPath = w.flagPath ?? "flags.sd.lastRoll";
    // support both "flags.sd.lastRoll" and "system.flags.sd.lastRoll"
    const data   = this._get(doc, flagPath, null) ?? this._get(doc, `system.${flagPath}`, null);
    const col    = e(w.color ?? "#7ef0c3");
    const compact = w.compact === true;

    if (!data || typeof data !== "object") {
      return `<div class="widget widget-dice-tray" style="display:flex;align-items:center;gap:6px;padding:4px 8px;background:#1a1a24;border:1px dashed ${col}44;border-radius:6px;color:#777;font-size:11px">
  <i class="fas fa-dice" style="color:${col}"></i>
  <span>${e(w.label ?? "Last Roll")}: <em>no rolls yet</em></span>
</div>`;
    }

    const total   = e(data.total ?? "?");
    const formula = e(data.formula ?? "");
    const flavor  = e(data.flavor  ?? "");
    const dice    = Array.isArray(data.dice) ? data.dice.slice(0, 8) : [];

    if (compact) {
      return `<div class="widget widget-dice-tray" style="display:flex;align-items:center;gap:8px;padding:4px 10px;background:linear-gradient(90deg, ${col}22, transparent);border:1px solid ${col}66;border-radius:6px">
  <i class="fas fa-dice" style="color:${col}"></i>
  <span style="font-size:10px;color:#98a6c6">${e(w.label ?? "Last Roll")}</span>
  <span style="font-size:16px;font-weight:700;color:${col}">${total}</span>
  <span style="font-size:10px;color:#777;margin-left:auto">${formula}${flavor ? ` · ${flavor}` : ""}</span>
</div>`;
    }

    const diceHtml = dice.length
      ? dice.map(d => `<span title="d${e(d.faces)}" style="display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:4px;background:#0e121a;border:1px solid ${col}66;color:${col};font-size:12px;font-weight:700">${e(d.result)}</span>`).join("")
      : "";

    return `<div class="widget widget-dice-tray" style="display:flex;flex-direction:column;gap:3px;padding:6px 8px;background:linear-gradient(135deg, ${col}1a, transparent);border:1px solid ${col}55;border-radius:6px">
  <div style="display:flex;align-items:center;gap:6px">
    <i class="fas fa-dice" style="color:${col}"></i>
    <span style="font-size:10px;color:#98a6c6;text-transform:uppercase;letter-spacing:.06em">${e(w.label ?? "Last Roll")}</span>
    <span style="font-size:22px;font-weight:700;color:${col};margin-left:auto;text-shadow:0 0 8px ${col}88">${total}</span>
  </div>
  ${diceHtml ? `<div style="display:flex;flex-wrap:wrap;gap:3px">${diceHtml}</div>` : ""}
  <div style="font-size:9px;color:#777;font-family:monospace">${formula}${flavor ? ` · ${flavor}` : ""}</div>
</div>`;
  }

  // tags
  static _render_tags(w, doc) {
    const esc   = this._esc.bind(this);
    const lbl   = esc(w.label ?? "Tags");
    const path  = esc(w.path  ?? "");
    const raw   = String(this._get(doc, w.path, ""));
    const col   = esc(w.color ?? "#5a6a9a");
    const tags  = raw.split(",").map(t => t.trim()).filter(Boolean);
    const pills = tags.map(t =>
      `<span class="sd-tag-pill" style="background:${col}22;border:1px solid ${col}55;
        border-radius:10px;padding:1px 8px;font-size:10px;color:#c0c0d8;white-space:nowrap">${esc(t)}
        <span class="sd-tag-remove" data-path="${path}" data-tag="${esc(t)}"
          style="cursor:pointer;margin-left:3px;color:#888;font-size:9px" title="Remove">✕</span>
      </span>`
    ).join("\n    ");
    return `<div class="widget widget-tags">
  <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px">
    <span class="widget-label">${lbl}</span>
    <button type="button" class="sd-tag-add" data-path="${path}"
      style="background:none;border:1px solid #3a3a52;border-radius:3px;color:#888;
             font-size:9px;padding:0 5px;cursor:pointer;line-height:1.6" title="Add tag">+</button>
  </div>
  <div class="sd-tag-container" data-path="${path}"
       style="display:flex;flex-wrap:wrap;gap:4px;min-height:20px">
    ${pills}
  </div>
</div>`;
  }

  // image
  static _render_image(w, doc) {
    const esc = this._esc.bind(this);
    const src = esc(w.staticSrc || (w.path ? String(this._get(doc, w.path, "")) : ""));
    const lbl = esc(w.label ?? "");
    const ww  = Number(w.width  ?? 64);
    const hh  = Number(w.height ?? 64);
    const br  = Number(w.borderRadius ?? 4);
    const imgStyle  = `width:${ww}px;height:${hh}px;object-fit:cover;border-radius:${br}px;display:block`;
    const imgEl     = src
      ? `<img src="${src}" style="${imgStyle}" alt="${lbl || "image"}">`
      : `<div style="${imgStyle};background:#1a1a28;border:1px dashed #3a3a52;display:flex;align-items:center;justify-content:center;color:#3a3a52;font-size:20px"><i class="fas fa-image"></i></div>`;

    // Always show a pencil overlay when a path is set, so users can change the
    // image without needing to know about the hidden `clickable` config flag.
    const pencilBtn = w.path
      ? `<button type="button" class="sd-img-pick sd-img-pencil"
           data-path="${esc(w.path ?? "")}"
           title="Change image"
           style="position:absolute;top:2px;right:2px;background:rgba(0,0,0,0.55);
                  border:none;border-radius:3px;color:#c0c0d8;cursor:pointer;
                  padding:1px 5px;font-size:10px;line-height:14px;opacity:0;
                  transition:opacity .15s">✎</button>`
      : "";

    const wrapper = `<div style="position:relative;display:inline-block;line-height:0"
        onmouseenter="this.querySelector('.sd-img-pencil')&&(this.querySelector('.sd-img-pencil').style.opacity='1')"
        onmouseleave="this.querySelector('.sd-img-pencil')&&(this.querySelector('.sd-img-pencil').style.opacity='0')">
  ${imgEl}${pencilBtn}
</div>`;

    return `<div class="widget widget-image" style="display:flex;flex-direction:column;align-items:center;gap:3px">
  ${lbl ? `<span class="widget-label">${lbl}</span>` : ""}
  ${wrapper}
</div>`;
  }

  // derived
  static _render_derived(w, doc) {
    const esc  = this._esc.bind(this);
    const lbl  = esc(w.label ?? "Derived");
    const raw  = w.formula ?? "0";
    let   val  = 0;
    try { val = FormulaEngine.evaluate(raw, doc); } catch { val = "!err"; }
    const dp   = Number(w.decimalPlaces ?? 0);
    const disp = (typeof val === "number" && isFinite(val))
      ? (dp > 0 ? val.toFixed(dp) : Math.round(val))
      : String(val);
    return `<div class="widget widget-derived">
  <div class="widget-label">${lbl}</div>
  <div class="widget-derived-value" style="font-size:18px;font-weight:700;text-align:center;color:#c0c0e8;letter-spacing:.02em">${esc(String(disp))}</div>
</div>`;
  }

  static _sbAbilityRow(ab, esc) {
    const hf       = ab.system?.hiddenFields ?? {};
    const cost     = Number(hf.cost ?? 0) || 0;
    const pathUses = String(hf.pathUses ?? "").trim();
    const equipped = ab.system?.equipped ? "equipped" : "";

    const costBadge = (cost > 0)
      ? `<span class="sb-ability-cost" style="font-size:10px;color:#9d8fff;white-space:nowrap" title="${esc(pathUses || "no resource path")}">${cost}</span>`
      : "";

    return `
      <li class="sb-ability-row ${equipped}" data-item-id="${esc(ab.id)}" draggable="true"
          style="display:flex;align-items:center;gap:5px;padding:3px 4px;border-radius:4px;
                 list-style:none;cursor:default;transition:background .1s"
          onmouseenter="this.style.background='rgba(123,104,238,.07)'"
          onmouseleave="this.style.background=''">
        <img src="${esc(ab.img ?? "icons/svg/book.svg")}" alt="${esc(ab.name)}"
             style="width:20px;height:20px;object-fit:cover;border-radius:3px;flex-shrink:0">
        <span class="sb-ability-name" style="flex:1;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
              title="${esc(ab.name)}">${esc(ab.name)}</span>
        ${costBadge}
        <div class="sb-ability-controls" style="display:flex;gap:2px;flex-shrink:0">
          <button type="button" data-action="abilityCast"
                  data-item-id="${esc(ab.id)}"
                  title="Use ${esc(ab.name)}"
                  style="background:#1a3a1a;border:1px solid #2a5a2a;border-radius:3px;
                         color:#5ae07a;cursor:pointer;font-size:10px;padding:1px 6px;line-height:16px">
            <i class="fas fa-play"></i>
          </button>
          <button type="button" data-action="abilityEdit"
                  data-item-id="${esc(ab.id)}"
                  title="Edit"
                  style="background:#1a1a2a;border:1px solid #2a2a3a;border-radius:3px;
                         color:#888;cursor:pointer;font-size:10px;padding:1px 6px;line-height:16px">
            <i class="fas fa-pen"></i>
          </button>
          <button type="button" data-action="abilityDelete"
                  data-item-id="${esc(ab.id)}"
                  title="Remove from actor"
                  style="background:none;border:1px solid #2a1a1a;border-radius:3px;
                         color:#5a2a2a;cursor:pointer;font-size:10px;padding:1px 5px;line-height:16px">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </li>`;
  }

  static _renderUnknown(w) {
    return `<div class="widget"><div class="widget-label">[${this._esc(w.type)}]</div></div>`;
  }
}

// Make SlotManager available lazily at render time
Hooks.once("ready", () => {
  import("../data/item-slots.mjs").then(m => {
    globalThis._SD_SLOTS = { SlotManager: m.SlotManager };
  });
});
