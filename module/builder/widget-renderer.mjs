import { FormulaEngine } from "../helpers/formula-engine.mjs";

export class WidgetRenderer {

  static render(widgetDef, doc, editMode = false) {
    try {

      if (editMode) {

      } else if (widgetDef.showIfKey && String(widgetDef.showIfKey).trim()) {
        let actualVal;
        const src = widgetDef.showIfKey.trim();
        try {
          if (src.startsWith("widget:")) {
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
        const visible = expected === ""
          ? (!!actualVal && actualVal !== "0" && actualVal !== "false")
          : actualVal === expected || String(Number(actualVal)) === expected;

        if (!visible) return "";
      } else if (widgetDef.showIf && String(widgetDef.showIf).trim()) {
        let visible = true;
        try {
          const result = FormulaEngine.evaluate(widgetDef.showIf, doc);
          visible = !!result && result !== "0" && result !== 0 && result !== false;
        } catch { visible = true; }
        if (!visible) return "";
      }

      let html = this[`_render_${widgetDef.type}`]?.(widgetDef, doc) ?? this._renderUnknown(widgetDef);

      const stableType = String(widgetDef.type || "").replace(/[^A-Za-z0-9-]/g, "").toLowerCase();
      if (stableType) {
        html = html.replace(/^(<[^>]+class=")/, `$1sd-w-${stableType} `);
      }
      const variantId = this._sanitizeVariant(widgetDef.variant);
      if (variantId) {
        html = html.replace(/^(<[^>]+class=")/, `$1sd-v-${variantId} `);
      }

      if (widgetDef.cssClass) {
        html = html.replace(/^(<[^>]+class=")/, `$1${this._esc(widgetDef.cssClass)} `);
      }

      const styleStr = this._buildStyle(widgetDef);
      if (styleStr) {
        if (/^<[^>]+style="/.test(html)) {
          html = html.replace(/^(<[^>]+style=")/, `$1${styleStr};`);
        } else {
          html = html.replace(/^(<[^>]+)(>)/, `$1 style="${styleStr}"$2`);
        }
      }
      return html;
    } catch(e) {
      console.warn("SD | Widget render error:", e, widgetDef);
      return `<div class="widget widget-error"><i class="fas fa-exclamation-triangle"></i> ${widgetDef.type} error</div>`;
    }
  }

  static _get(doc, path, fallback = "") {
    if (!path) return fallback;
    const HF_PREFIX = "system.hiddenFields.";
    if (path.startsWith(HF_PREFIX)) {
      const key = path.slice(HF_PREFIX.length);
      const val = doc?.system?.hiddenFields?.[key];
      return val !== undefined ? val : fallback;
    }
    const val = foundry.utils.getProperty(doc, path);
    return val ?? fallback;
  }

  static _getValue(w, doc, fallback = "") {
    if (w.valueFormula && FormulaEngine.isFormula(w.valueFormula)) {
      return FormulaEngine.evaluate(w.valueFormula, doc);
    }
    if (w.path) return this._get(doc, w.path, fallback);
    if (w.staticValue !== undefined && w.staticValue !== "") return w.staticValue;
    return fallback;
  }

  static _getRollFormula(w, doc) {
    const raw = w.formula ?? "1d20";
    return FormulaEngine.resolveForRoll(raw, doc);
  }

  static _buildStyle(w) {
    const parts = [];
    const px = (v) => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? `${n}px` : null;
    };
    const colour = (v) => {
      if (typeof v !== "string") return null;
      const t = v.trim();
      return /^#[0-9a-f]{3,8}$/i.test(t) || /^rgb/i.test(t) || /^[a-z]+$/i.test(t) ? t : null;
    };

    const wPx = px(w.boxW);    if (wPx) parts.push(`width:${wPx}`);
    const hPx = px(w.boxH);    if (hPx) parts.push(`min-height:${hPx}`);
    const bg  = colour(w.boxBg);      if (bg) { parts.push(`background:${bg}`); parts.push(`--sd-w-bg:${bg}`); }
    const fg  = colour(w.boxFg);      if (fg) { parts.push(`color:${fg}`);      parts.push(`--sd-w-fg:${fg}`); parts.push(`--sd-w-label:${fg}`); }
    const bd  = colour(w.boxBorder);  if (bd && w.type !== "image") { parts.push(`border:1px solid ${bd}`); parts.push(`--sd-w-bd:${bd}`); }
    const br  = px(w.boxRadius);      if (br) parts.push(`border-radius:${br}`);
    const pd  = px(w.boxPad);         if (pd) parts.push(`padding:${pd}`);

    const cvar = (name, val) => { if (val) parts.push(`${name}:${val}`); };
    cvar("--sd-w-bar-h",     px(w.barH));
    cvar("--sd-w-bar-track", colour(w.barTrack));
    cvar("--sd-w-btn-bg",    colour(w.btnBg));
    cvar("--sd-w-btn-fg",    colour(w.btnFg));
    cvar("--sd-w-btn-bd",    colour(w.btnBorder));
    cvar("--sd-w-icon",      colour(w.iconColor));
    cvar("--sd-w-num-btn",   colour(w.btnColor));
    cvar("--sd-w-on",        colour(w.onColor));
    cvar("--sd-w-off",       colour(w.offColor));
    cvar("--sd-w-line",      colour(w.lineColor));
    cvar("--sd-w-title",     colour(w.titleColor));
    cvar("--sd-w-line-th",   px(w.lineThickness));
    cvar("--sd-w-pip-size",  px(w.pipSize));
    cvar("--sd-w-pip-bd",    px(w.pipBorder));
    cvar("--sd-w-empty",     colour(w.emptyColor));
    cvar("--sd-w-header",    colour(w.headerColor));
    cvar("--sd-w-tag-fg",    colour(w.tagFg));
    cvar("--sd-w-bw",        px(w.borderWidth));

    return parts.join(";");
  }

  static _esc(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;").replace(/"/g, "&quot;")
      .replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  static _sanitizeVariant(v) {
    const raw = String(v ?? "").trim().toLowerCase();
    if (!raw || raw === "default") return "";
    const safe = raw.replace(/[^a-z0-9-]/g, "");
    return safe.length > 0 ? safe : "";
  }

  static _faClass(icon, defaultStyle = "fas") {
    const raw = String(icon ?? "").trim();
    if (!raw) return `${defaultStyle} fa-circle`;

    const safe = raw.replace(/[^a-zA-Z0-9\-\s:]/g, "").trim();
    if (!safe) return `${defaultStyle} fa-circle`;
    const tokens = safe.split(/\s+/).filter(Boolean);
    const hasStyle = tokens.some(t =>
      /^(fa|fas|far|fab|fad|fal|fat)$/i.test(t) ||
      /^fa-(solid|regular|brands|duotone|light|thin|sharp)$/i.test(t)
    );
    if (!hasStyle) tokens.unshift(defaultStyle);

    const hasIcon = tokens.some(t => /^fa-/.test(t) && !/^fa-(solid|regular|brands|duotone|light|thin|sharp)$/i.test(t));
    if (!hasIcon) {
      const plain = tokens.find(t => !/^fa[-s]?/i.test(t));
      if (plain) tokens.push("fa-" + plain);
    }
    return tokens.join(" ");
  }

  static _copyBtn(path, tip = "") {
    const e = this._esc;
    const title = e(path + (tip ? "  —  " + tip : ""));
    return `<button type="button" class="widget-copy-path" data-copy-path="${e(path)}" title="Copy path: ${title}" tabindex="-1" style="background:none;border:none;padding:0 0 0 4px;cursor:pointer;color:var(--sd-border);font-size:9px;line-height:1;flex-shrink:0;transition:color .15s" onmouseenter="this.style.color='var(--sd-accent)'" onmouseleave="this.style.color='var(--sd-border)'"><i class="fas fa-copy"></i></button>`;
  }

  static _render_text(w, doc) {
    const val  = this._getValue(w, doc, "");
    const esc  = this._esc;
    const hasFormula = w.valueFormula && FormulaEngine.isFormula(w.valueFormula);
    const isReadOnly = w.readOnly === true || w.readOnly === "true";
    if (hasFormula) {
      return `<div class="widget widget-text">
  <div class="widget-label">${esc(w.label)} <span style="color:var(--sd-accent-2);font-size:9px" title="Formula: ${esc(w.valueFormula)}">ƒ</span></div>
  <div class="widget-formula-val">${esc(String(val))}</div>
</div>`;
    }
    if (isReadOnly) {
      return `<div class="widget widget-text widget-text--readonly">
  <div class="widget-label">${esc(w.label)} <span style="color:var(--sd-text-3);font-size:9px;margin-left:2px" title="Read only">🔒</span></div>
  <div class="widget-text-readonly-val" style="background:var(--sd-w-bg,var(--sd-bg-2));border:1px solid var(--sd-w-bd,var(--sd-bg-3));border-radius:4px;padding:3px 7px;font-size:12px;color:var(--sd-w-fg,var(--sd-text-3));min-height:22px;word-break:break-word">${esc(String(val))}</div>
</div>`;
    }
    return `<div class="widget widget-text">
  <div class="widget-label" style="display:flex;align-items:center">${esc(w.label)}${w.path ? this._copyBtn(w.path, "text value") : ""}</div>
  <input type="text" name="${esc(w.path)}" value="${esc(val)}">
</div>`;
  }

  static _render_number(w, doc) {
    const val = this._getValue(w, doc, 0);
    const e   = this._esc;
    const hasFormula = w.valueFormula && FormulaEngine.isFormula(w.valueFormula);
    if (hasFormula) {
      return `<div class="widget widget-number">
  <div class="widget-label">${e(w.label)} <span style="color:var(--sd-accent-2);font-size:9px" title="Formula: ${e(w.valueFormula)}">ƒ</span></div>
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

  static _render_resource(w, doc) {
    const val    = Number(this._get(doc, w.pathValue, 0));
    const max    = Number(this._get(doc, w.pathMax,   0));
    const pct    = max > 0 ? Math.round(Math.clamp(val / max, 0, 1) * 100) : 0;
    const color  = w.color ?? "var(--sd-accent)";
    const e      = this._esc;
    const barH   = Number(w.barH) > 0 ? `${Number(w.barH)}px` : "";
    const barTrk = (typeof w.barTrack === "string" && w.barTrack.trim()) ? w.barTrack.trim() : "";
    const barStyle = [barH ? `height:${barH}` : "", barTrk ? `background:${e(barTrk)}` : ""].filter(Boolean).join(";");
    return `<div class="widget widget-resource">
  <div class="widget-label" style="display:flex;align-items:center">${e(w.label)}${w.pathValue ? this._copyBtn(w.pathValue, "value") : ""}${w.pathMax ? this._copyBtn(w.pathMax, "max") : ""}</div>
  <div class="res-row">
    <input type="number" name="${e(w.pathValue)}" value="${e(val)}" class="res-val">
    <span class="res-sep">/</span>
    <input type="number" name="${e(w.pathMax)}" value="${e(max)}" class="res-max">
  </div>
  <div class="res-bar"${barStyle ? ` style="${barStyle}"` : ""}><div class="res-bar-fill" style="width:${pct}%;background:${e(color)}"></div></div>
</div>`;
  }

  static _render_dice(w, doc) {
    const e          = this._esc;
    const rawFormula = w.formula ?? "1d20";
    const hasRefs    = FormulaEngine.isFormula(rawFormula);
    const displayFml = hasRefs ? FormulaEngine.resolveForRoll(rawFormula, doc) : rawFormula;
    const btnParts = [];
    if (typeof w.btnBg === "string"     && w.btnBg.trim())     btnParts.push(`background:${e(w.btnBg)}`);
    if (typeof w.btnFg === "string"     && w.btnFg.trim())     btnParts.push(`color:${e(w.btnFg)}`);
    if (typeof w.btnBorder === "string" && w.btnBorder.trim()) btnParts.push(`border-color:${e(w.btnBorder)}`);
    const btnStyle = btnParts.join(";");
    const iconStyle = (typeof w.iconColor === "string" && w.iconColor.trim()) ? ` style="color:${e(w.iconColor)}"` : "";
    const macroBtn  = this._copyMacroBtn_dice(w);
    return `<div class="widget widget-dice">
  <div class="widget-label">${e(w.label)}${hasRefs ? ` <span style="color:var(--sd-accent-2);font-size:9px" title="Formula with refs">ƒ</span>` : ""}</div>
  <div class="dice-row" style="display:flex;align-items:center;gap:4px">
    <button type="button" class="dice-btn" data-action="widgetRoll"
            data-formula="${e(displayFml)}"
            data-formula-raw="${e(rawFormula)}"
            data-flavor="${e(w.flavor ?? w.label ?? "")}"
            style="flex:1;${btnStyle}">
      <i class="${e(this._faClass(w.icon ?? "fa-dice-d20"))}"${iconStyle}></i>
      ${e(w.label)}
      <span style="opacity:.6;font-size:10px">(${e(displayFml)})</span>
    </button>
    ${macroBtn}
  </div>
</div>`;
  }

  static _copyMacroBtn_dice(w) {
    const e = this._esc;
    const formula = w.formula ?? "1d20";
    const flavor  = w.flavor ?? w.label ?? "Roll";

    const script  =
      `// ${flavor}\\n` +
      `const actor = token?.actor ?? game.user.character;\\n` +
      `const roll  = new Roll("${formula}", actor?.getRollData() ?? {});\\n` +
      `await roll.evaluate();\\n` +
      `await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: "${flavor}" });`;
    return `<button type="button" class="widget-copy-macro" data-copy-macro="${e(script)}" title="Copy as Macro" tabindex="-1"
      style="background:none;border:1px solid var(--sd-w-bd,var(--sd-border));border-radius:4px;color:var(--sd-text-3);cursor:pointer;font-size:10px;padding:4px 6px;flex-shrink:0;transition:color .15s,border-color .15s"
      onmouseover="this.style.color='var(--sd-accent)';this.style.borderColor='var(--sd-accent)'"
      onmouseout="this.style.color='';this.style.borderColor=''">
      <i class="fas fa-scroll"></i>
    </button>`;
  }

  static _render_button(w, doc) {
    const e       = this._esc;
    const accent  = w.btnBg || "var(--sd-accent)";
    const fgColor = w.btnFg || accent;
    const bdColor = w.boxBorder || accent;
    const iconCol = w.iconColor || fgColor;
    const iconCls = this._faClass(w.icon ?? "fa-bolt");
    const bg      = w.btnBg ? e(w.btnBg) : `${e(accent)}22`;
    const formula = w.formula ? (FormulaEngine.isFormula(w.formula) ? FormulaEngine.resolveForRoll(w.formula, doc) : w.formula) : "";
    return `<div class="widget widget-button">
  <button type="button" class="sd-action-btn" data-action="widgetButton"
          data-formula-raw="${e(w.formula ?? "")}"
          data-formula="${e(formula)}"
          data-flavor="${e(w.flavor ?? w.label ?? "")}"
          style="width:100%;display:flex;align-items:center;justify-content:center;gap:6px;padding:6px 10px;background:${bg};border:1px solid ${e(bdColor)};border-radius:5px;color:${e(fgColor)};cursor:pointer;font-size:12px;font-weight:600;transition:background .15s">
    <i class="${e(iconCls)}" style="color:${e(iconCol)}"></i>
    <span>${e(w.label)}</span>
  </button>
</div>`;
  }

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

  static _render_slot(w, doc) {
    const { SlotManager } = globalThis._SD_SLOTS ?? {};
    const contents = SlotManager ? SlotManager.getContents(doc, w.slotId) : [];
    const def      = SlotManager ? SlotManager.getDefinition(doc, w.slotId) : null;
    const max      = def?.maxCount ?? w.maxCount ?? 1;

    if (w.compact) {
      return this._render_slot_compact(w, doc, contents, max);
    }

    const e = this._esc;
    const items = contents.map((c, i) => `
      <li class="slot-mini-item" draggable="true" data-slot-item-drag data-slot-id="${e(w.slotId)}" data-slot-index="${i}" data-item-id="${e(c._id ?? "")}" data-item-uuid="${e(c._sourceUuid ?? c.uuid ?? "")}">
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

  static _render_slot_compact(w, doc, contents, max) {
    const e        = this._esc;
    const slotId   = e(w.slotId);
    const lbl      = e(w.label || "Slot");
    const countTxt = `${contents.length}/${max}`;

    if (contents.length > 3) {
      let rows = "";
      for (let i = 0; i < contents.length; i++) {
        const c   = contents[i];
        const img = e(c.img ?? "icons/svg/item-bag.svg");
        const nm  = e(c.name ?? "");
        const itemId   = e(c._id ?? "");
        const itemUuid = e(c._sourceUuid ?? c.uuid ?? "");
        rows += `<li class="sd-hud-pop-row" draggable="true" data-slot-item-drag data-slot-id="${slotId}" data-slot-index="${i}" data-item-id="${itemId}" data-item-uuid="${itemUuid}">
          <img src="${img}" alt="${nm}">
          <span class="sd-hud-pop-name" title="${nm}">${nm}</span>
          <button type="button" data-action="slotItemUse" data-slot-id="${slotId}" data-slot-index="${i}" title="Use"><i class="fas fa-play"></i></button>
          <button type="button" data-action="slotItemEdit" data-slot-id="${slotId}" data-slot-index="${i}" data-item-id="${itemId}" data-item-uuid="${itemUuid}" title="Edit"><i class="fas fa-pen"></i></button>
          <button type="button" data-sd-slot-remove="${slotId}" data-sd-slot-idx="${i}" title="Remove"><i class="fas fa-times"></i></button>
        </li>`;
      }
      return `<div class="widget widget-slot widget-compact widget-slot-compact"><details class="sd-hud-popover">
  <summary class="sd-hud-pop-btn"><i class="fas fa-layer-group"></i><span>${lbl}</span><span class="sd-hud-pop-count">${countTxt}</span></summary>
  <ul class="sd-hud-pop-body sd-hud-pop-list">${rows}</ul>
</details></div>`;
    }

    let icons = "";
    for (let i = 0; i < contents.length; i++) {
      const c   = contents[i];
      const img = e(c.img ?? "icons/svg/item-bag.svg");
      const nm  = e(c.name ?? "");
      const itemId   = e(c._id ?? "");
      const itemUuid = e(c._sourceUuid ?? c.uuid ?? "");
      icons += `<button type="button" class="slot-hud-icon" draggable="true" data-slot-item-drag data-action="slotItemUse" data-slot-id="${slotId}" data-slot-index="${i}" data-item-id="${itemId}" data-item-uuid="${itemUuid}" title="${nm}">
        <img src="${img}" alt="${nm}">
        <span class="slot-hud-icon-remove" data-sd-slot-remove="${slotId}" data-sd-slot-idx="${i}" title="Remove">×</span>
      </button>`;
    }
    if (contents.length === 0) {
      icons = `<div class="slot-hud-icon slot-hud-icon-empty" data-sd-slot-drop="${slotId}" title="Drop item here"><i class="fas fa-arrow-down-to-line"></i></div>`;
    }
    return `<div class="widget widget-slot widget-compact widget-slot-row" data-sd-slot-drop="${slotId}">
  <div class="widget-label slot-hud-label"><i class="fas fa-layer-group"></i> ${lbl} <span class="slot-hud-count">${countTxt}</span></div>
  <div class="slot-hud-icons">${icons}</div>
</div>`;
  }

  static _render_inventory(w, doc) {
    const e = this._esc;
    const isActor = doc instanceof Actor;
    if (!isActor) return `<div class="widget widget-inventory"><p style="color:var(--sd-text-3)">Inventory widget only works on Actor sheets</p></div>`;

    let items = [...(doc.items ?? [])];
    const categories = w.categories ?? [];
    const columns = w.columns ?? [];

    if (categories.length > 0) {
      items = items.filter(item => categories.includes(item.system?.category));
    }

    if (w.compact) {
      return this._render_inventory_compact(w, doc, items);
    }

    const grouped = {};
    items.forEach(item => {
      const cat = item.system?.category ?? "other";
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(item);
    });

    let colHeaders = "";
    let colCells = "";
    if (columns.length > 0) {
      colHeaders = columns.map(col => `<span class="item-col-header">${e(col)}</span>`).join("");
    }

    let html = `<div class="widget widget-inventory">
  <div class="widget-label">${e(w.label)}</div>`;

    if (w.showCurrency) {
      const c = doc.system?.currency ?? {};
      if (w.currencyPath) {
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
      style="background:none;border:none;color:var(--sd-text-3);cursor:pointer;font-size:11px;padding:0 4px;flex-shrink:0">
      <i class="fas fa-copy"></i>
    </button>
  </div>`;
      } else {

        const _curList = (Array.isArray(CONFIG?.SD?.currencies) && CONFIG.SD.currencies.length)
          ? CONFIG.SD.currencies
          : [
              { key: "primary",   label: "Gold"   },
              { key: "secondary", label: "Silver" },
              { key: "tertiary",  label: "Copper" }
            ];
        let row = `<div class="currency-row currency-row--multi">`;
        for (const cur of _curList) {
          const val = Number(c?.[cur.key] ?? 0);
          row += `
    <label>${e(cur.label ?? cur.key)}</label>
    <input type="number" name="system.currency.${e(cur.key)}" value="${val}" placeholder="0">`;
        }
        row += `</div>`;
        html += row;
      }
    }

    html += `
  <div class="inventory-drop-zone" data-drop-zone="item">
    <i class="fas fa-arrow-down-to-line"></i> Drop items here
  </div>`;

    const _legacyOrder = ["weapon", "armor", "shield", "consumable", "ammo", "magazine", "tool", "gear", "container", "treasure", "other"];
    const _customCats  = Object.keys(grouped).filter(c => !_legacyOrder.includes(c) && c !== "").sort();
    const categoryOrder = [..._legacyOrder, ..._customCats, ""];

    for (const cat of categoryOrder) {
      const catItems = grouped[cat];
      if (!catItems || catItems.length === 0) continue;

      const _catLbl = cat ? cat.toUpperCase() : "—";
      html += `
  <div class="item-category">
    <div class="category-header">${e(_catLbl)}</div>
    <ul class="item-list">`;

      for (const item of catItems) {
        const qty = item.system?.quantity ?? 1;
        const weight = w.showWeight ? (item.system?.weight ?? 0) : null;
        const equipped = item.system?.equipped ? "equipped" : "";
        const isInv    = item.type === "inventory";

        let extraCols = "";
        if (columns.length > 0) {
          for (const col of columns) {
            const val = item.system?.hiddenFields?.[col] ?? item.system?.[col] ?? "";
            extraCols += `<span class="item-col">${e(String(val))}</span>`;
          }
        }

        const equipBtn = isInv
          ? `<button type="button" class="item-btn item-equip-btn ${item.system?.equipped ? "on" : ""}" data-action="itemEquip" data-item-id="${item.id}" title="${item.system?.equipped ? "Unequip" : "Equip"}"${item.system?.equippable ? "" : ' style="opacity:.45"'}><i class="fas ${item.system?.equipped ? "fa-shield-halved" : "fa-shield"}"></i></button>`
          : "";

        html += `
      <li class="item-row ${equipped}" data-item-id="${item.id}" data-item-drag>
        <img class="item-img" src="${e(item.img)}" alt="${e(item.name)}">
        <span class="item-name">${e(item.name)}</span>
        ${qty > 1 ? `<span class="item-qty">×${qty}</span>` : ""}
        ${weight !== null ? `<span class="item-weight">${weight} lb</span>` : ""}
        ${extraCols}
        <div class="item-controls">
          <button type="button" class="item-btn item-use-btn" data-action="itemUse" data-item-id="${item.id}" title="Use"><i class="fas fa-play"></i></button>
          ${equipBtn}
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

  static _render_attribute(w, doc) {
    const score = Number(this._get(doc, w.path, 10));
    const e     = this._esc;

    const compute = CONFIG?.SD?.computeModifier
      ?? (s => Math.floor((Number(s) - 10) / 2));
    let mod;
    if (w.modValueFormula) {
      const resolved = Number(FormulaEngine.evaluate(w.modValueFormula, doc));
      mod = isNaN(resolved) ? compute(score) : resolved;
    } else {
      mod = compute(score);
    }
    const ms = mod >= 0 ? `+${mod}` : `${mod}`;

    const onClickFml = w.onClickFormula ?? null;

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

  static _render_skill(w, doc) {
    const rank    = Number(this._get(doc, w.path, 0));
    const attrMod = Number(w.attrMod ?? 0);
    let bonus;
    if (w.modValueFormula) {
      const resolved = Number(FormulaEngine.evaluate(w.modValueFormula, doc));
      bonus = isNaN(resolved) ? (rank + attrMod) : resolved;
    } else {
      bonus = rank + attrMod;
    }
    const bs     = bonus >= 0 ? `+${bonus}` : `${bonus}`;
    const e      = this._esc;

    const onClickFml = w.onClickFormula ?? null;

    const rawFml     = (w.rollFormula && String(w.rollFormula).trim())
      ? String(w.rollFormula).trim()
      : (w.formula && String(w.formula).trim())
        ? String(w.formula).trim()
        : `1d20+${bonus}`;
    const dispFml    = FormulaEngine.isFormula(rawFml)
      ? FormulaEngine.resolveForRoll(rawFml, doc)
      : rawFml;
    const flavor = w.flavor || w.label;

    const dataOnClick = onClickFml
      ? `data-attr-onclick="${e(onClickFml)}"`
      : `data-formula="${e(dispFml)}" data-formula-raw="${e(rawFml)}" data-flavor="${e(flavor)}"`;

    const action = onClickFml ? "attrModClick" : "widgetRoll";
    const macroBtn = this._copyMacroBtn_skill(w);

    const variant = w.variant || "default";

    const bonusBtn = `<button type="button" class="skill-bonus" data-action="${action}"
            ${dataOnClick}
            title="Roll ${e(w.label)}">${bs}</button>`;

    const nameBlock = `<div class="skill-name">${e(w.label)}${w.path ? this._copyBtn(w.path, "rank") : ""}</div>`;

    if (variant === "row-rank") {
      const rankInput = `<input type="number" name="${e(w.path)}" value="${e(rank)}" class="skill-rank-input" min="0" step="1">`;
      return `<div class="widget widget-skill skill-row-rank">
  ${nameBlock}
  ${rankInput}
  ${bonusBtn}
  ${macroBtn}
</div>`;
    }

    if (variant === "pips") {
      const pipMax = Math.max(5, Math.min(20, Number(w.pipMax ?? 5)));
      const pipsHtml = Array.from({ length: pipMax }, (_, i) => {
        const filled = i < rank;
        return `<span class="skill-pip ${filled ? "filled" : ""}" data-rank="${i + 1}" data-path="${e(w.path)}" data-action="skillPipClick" title="Set rank to ${i + 1}"></span>`;
      }).join("");
      return `<div class="widget widget-skill skill-pips">
  ${nameBlock}
  <div class="skill-pip-row" data-path="${e(w.path)}" data-action="skillPipReset" title="Right-click to reset">${pipsHtml}</div>
  ${bonusBtn}
  ${macroBtn}
</div>`;
    }

    if (variant === "pill") {
      return `<div class="widget widget-skill skill-pill">
  ${nameBlock}
  ${bonusBtn}
  ${macroBtn}
</div>`;
    }

    return `<div class="widget widget-skill">
  ${nameBlock}
  ${bonusBtn}
  ${macroBtn}
</div>`;
  }

  static _copyMacroBtn_skill(w) {
    const e = this._esc;
    const path    = w.path ?? "";
    const attrMod = Number(w.attrMod ?? 0);
    const flavor  = w.flavor || w.label || "Skill";
    const rawFml  = (w.rollFormula && String(w.rollFormula).trim())
      ? String(w.rollFormula).trim()
      : (w.formula && String(w.formula).trim())
        ? String(w.formula).trim()
        : "";
    const formulaLine = rawFml
      ? `const formula = "${rawFml}";`
      : "const formula = `1d20+${bonus}`;";
    const script  =
      `// ${flavor} skill roll\\n` +
      `const actor = token?.actor ?? game.user.character;\\n` +
      `if (!actor) return ui.notifications.warn("No actor selected");\\n` +
      `const rank   = foundry.utils.getProperty(actor, "${path}") ?? 0;\\n` +
      `const bonus  = rank + ${attrMod};\\n` +
      `${formulaLine}\\n` +
      `const roll   = new Roll(formula, actor.getRollData());\\n` +
      `await roll.evaluate();\\n` +
      `await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: "${flavor}" });`;
    return `<button type="button" class="widget-copy-macro skill-copy-macro" data-copy-macro="${e(script)}" title="Copy as Macro" tabindex="-1"
      style="background:none;border:none;color:var(--sd-text-3);cursor:pointer;font-size:9px;padding:1px 3px;flex-shrink:0;border-radius:3px;transition:color .15s"
      onmouseover="this.style.color='var(--sd-accent)'"
      onmouseout="this.style.color=''">
      <i class="fas fa-scroll"></i>
    </button>`;
  }

  static _render_section(w, doc) {
    const e = this._esc;
    const titleStyle = w.titleColor ? `color:${e(w.titleColor)}` : "";
    const lineCol = w.lineColor ? e(w.lineColor) : "";
    const lineTh  = Number(w.lineThickness) > 0 ? Number(w.lineThickness) : 0;
    const hrStyle = (lineCol || lineTh) ? `style="${lineCol ? `border-top-color:${lineCol};` : ""}${lineTh ? `border-top-width:${lineTh}px;` : ""}"` : "";
    return `<div class="widget widget-section">
  <div class="sec-title"${titleStyle ? ` style="${titleStyle}"` : ""}>${e(w.label)}</div>
  <hr class="sec-divider" ${hrStyle}>
</div>`;
  }

  static _render_vsection(w, doc) {
    const e = this._esc;
    const titleCol = w.titleColor || "var(--sd-accent)";
    const bdCol    = w.boxBorder  || "var(--sd-accent-glow)";
    const bdStyle  = w.boxBorder  ? "solid" : "dashed";
    const bg       = w.boxBg      || "rgba(123,104,238,.03)";
    const radius   = Number(w.boxRadius) > 0 ? `${Number(w.boxRadius)}px` : "5px";
    const header = w.label
      ? `<div class="vsection-title" style="font-size:10px;font-weight:700;color:${e(titleCol)};text-transform:uppercase;letter-spacing:.05em;padding:2px 0 4px">${e(w.label)}</div>`
      : "";
    const children = (w.widgets ?? []).map(cw => {
      try { return this.render(cw, doc) ?? ""; }
      catch { return ""; }
    }).join("");
    return `<div class="widget widget-vsection" style="display:flex;flex-direction:column;gap:6px;padding:6px;border:1px ${bdStyle} ${e(bdCol)};border-radius:${radius};background:${e(bg)}">${header}${children}</div>`;
  }

  static _render_richtext(w, doc) {
    const val = w.path ? this._get(doc, w.path, "") : (w.staticHtml ?? "");
    const e   = this._esc;

    if (!w.path && w.staticHtml) {
      return `<div class="widget widget-richtext widget-richtext--static">
  ${w.label ? `<div class="widget-label">${e(w.label)}</div>` : ""}
  <div class="richtext-display" style="padding:6px 8px;font-size:12px;line-height:1.6;word-break:break-word">${val}</div>
</div>`;
    }
    return `<div class="widget widget-richtext">
  <div class="widget-label">${e(w.label)}</div>
  <div class="richtext-display" data-path="${e(w.path)}"
       style="min-height:60px;cursor:text;padding:6px 8px;background:var(--sd-bg);border:1px solid var(--sd-w-bd,var(--sd-border));border-radius:4px;font-size:12px;color:var(--sd-w-fg,var(--sd-text-2));line-height:1.6;word-break:break-word">
    ${val || "<span style='opacity:.35;font-style:italic'>Click to edit…</span>"}
  </div>
  <div class="richtext-edit-wrap" style="display:none;position:relative">
    <textarea class="richtext-editor" data-path="${e(w.path)}"
      style="width:100%;min-height:80px;resize:vertical;background:var(--sd-bg);border:1px solid var(--sd-accent);border-radius:4px 4px 0 0;color:var(--sd-w-fg,var(--sd-text));font-size:12px;padding:6px 8px;box-sizing:border-box;font-family:inherit;line-height:1.6;display:block"
      placeholder="Enter text…">${e(val)}</textarea>
    <div style="display:flex;gap:6px;padding:4px 0 2px">
      <button type="button" class="richtext-save" style="flex:1;background:rgba(76,175,80,.18);border:1px solid var(--sd-success);border-radius:4px;color:var(--sd-success);cursor:pointer;font-size:11px;padding:4px 8px">✓ Save</button>
      <button type="button" class="richtext-cancel" style="background:var(--sd-danger-dim);border:1px solid var(--sd-danger);border-radius:4px;color:var(--sd-danger);cursor:pointer;font-size:11px;padding:4px 10px">✕</button>
    </div>
  </div>
</div>`;
  }

  static _render_effects(w, doc) {
    const e = this._esc;
    const effects = [...(doc.effects ?? [])];

    const showPassive  = w.showPassive  !== false;
    const showDisabled = w.showDisabled !== false;
    const filtered = effects.filter(ef => {
      if (!showPassive  && ef.transfer)  return false;
      if (!showDisabled && ef.disabled)  return false;
      return true;
    });

    const canEdit = doc.isOwner ?? true;

    if (w.compact) {
      return this._render_effects_compact(w, doc, filtered, canEdit);
    }

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

    let abilities = [...(doc.items ?? [])].filter(i => i.type === "ability");
    if (wantType) {
      abilities = abilities.filter(i => {
        const t = String(i.system?.hiddenFields?.type ?? "").trim();
        return t === wantType;
      });
    }

    if (w.compact) {
      return this._render_spellbook_compact(w, doc, abilities, wantType);
    }

    const typeBadge = wantType
      ? `<span class="sb-type-badge" style="margin-left:8px;padding:1px 7px;border-radius:3px;background:var(--sd-accent-glow);color:var(--sd-accent);font-size:10px;font-weight:600;letter-spacing:.04em;text-transform:uppercase">${e(wantType)}</span>`
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
    style="margin-top:8px;border:1px dashed var(--sd-accent-dim);border-radius:4px;padding:6px 10px;text-align:center;font-size:11px;color:var(--sd-text-3);cursor:pointer">
    <i class="fas fa-arrow-down-to-line" style="margin-right:4px;opacity:.5"></i>Drop ability items here
  </div>
</div>`;
    return html;
  }

  static _render_progress(w, doc) {
    const esc  = this._esc.bind(this);
    const val  = Number(this._get(doc, w.pathValue, 0)) || 0;
    const max  = Number(this._get(doc, w.pathMax,   1)) || 1;
    const pct  = Math.round(Math.min(100, Math.max(0, (val / max) * 100)));
    const col  = esc(w.color   ?? "#5a8aff");
    const trk  = esc(w.barTrack ?? "var(--sd-bg)");
    const barH = Number(w.barH) > 0 ? `${Number(w.barH)}px` : "10px";
    const lbl  = esc(w.label   ?? "Progress");
    const showLabel = w.showLabel !== false && w.showLabel !== "false";
    const showPct   = w.showPct   !== false && w.showPct   !== "false";
    return `<div class="widget widget-progress">
  <div class="widget-label-row" style="display:flex;align-items:baseline;gap:4px;margin-bottom:3px">
    ${showLabel ? `<span class="widget-label">${lbl}</span>` : ""}
    <span title="Read-only — edit via the source field" style="font-size:9px;color:var(--sd-text-3);margin-left:3px;cursor:default">🔒</span>
    ${showPct   ? `<span style="margin-left:auto;font-size:10px;color:var(--sd-w-label, var(--sd-text-3))">${val}/${max} (${pct}%)</span>` : ""}
  </div>
  <div style="background:${trk};border-radius:3px;height:${barH};overflow:hidden;border:1px solid var(--sd-w-bd,var(--sd-bg-3));opacity:.85">
    <div style="height:100%;width:${pct}%;background:${col};border-radius:3px;transition:width .3s"></div>
  </div>
</div>`;
  }

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

    const pillsHtml = opts.map(o => `<button type="button" class="widget-select-pill${cur === o ? " is-active" : ""}" data-action="widgetSelectPill" data-path="${path}" data-value="${esc(o)}">${esc(o)}</button>`).join("");
    const radiosHtml = opts.map(o => `<label class="widget-select-radio${cur === o ? " is-active" : ""}"><input type="radio" name="__sel_${path}" value="${esc(o)}"${cur === o ? " checked" : ""} data-action="widgetSelectPill" data-path="${path}" data-value="${esc(o)}"><span>${esc(o)}</span></label>`).join("");
    return `<div class="widget widget-select">
  <label class="widget-label">${lbl}</label>
  <select class="widget-select-input" name="${path}" data-path="${path}" style="width:100%;background:var(--sd-bg-3);border:1px solid var(--sd-border);border-radius:4px;color:var(--sd-text-2);padding:3px 6px;font-size:12px">
    ${optsHtml}
  </select>
  <div class="widget-select-pills" style="display:none">${pillsHtml}</div>
  <div class="widget-select-radios" style="display:none">${radiosHtml}</div>
</div>`;
  }

  static _render_clock(w, doc) {
    const esc   = this._esc.bind(this);
    const lbl   = esc(w.label ?? "Clock");
    const path  = esc(w.path  ?? "");
    const segs  = Math.min(12, Math.max(2, Number(w.segments ?? 4)));
    const filled = Number(this._get(doc, w.path, 0)) || 0;
    const col   = esc(w.color   ?? "var(--sd-warn)");
    const bg    = esc(w.bgColor ?? "var(--sd-bg)");
    const pipSz = Number(w.pipSize) > 0 ? Number(w.pipSize) : 0;
    const size  = pipSz > 0 ? Math.max(20, pipSz * Math.min(segs, 6)) : 64;
    const sw    = Number(w.pipBorder) > 0 ? Number(w.pipBorder) : 1.5;
    const cx = size / 2, cy = size / 2, r = size / 2 - 3;

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
          fill="${fill}" stroke="var(--sd-bg-3)" stroke-width="${sw}"
          class="sd-clock-segment" data-path="${path}" data-index="${i}" data-segs="${segs}"
          style="cursor:pointer;transition:opacity .1s" />`
      );
    }
    return `<div class="widget widget-clock" style="display:flex;flex-direction:column;align-items:center;gap:3px">
  <div style="display:flex;align-items:center;gap:5px">
    <span class="widget-label">${lbl}</span>
    <button type="button" class="sd-clock-reset" data-path="${path}" data-segs="${segs}"
      title="Reset clock to 0"
      style="background:none;border:1px solid var(--sd-w-bd,var(--sd-border));border-radius:3px;color:var(--sd-text-3);
             cursor:pointer;font-size:9px;padding:0 5px;line-height:1.6;
             transition:color .15s,border-color .15s"
      onmouseover="this.style.color='var(--sd-danger)';this.style.borderColor='var(--sd-danger)'"
      onmouseout="this.style.color='#555';this.style.borderColor='var(--sd-border)'">↺</button>
  </div>
  <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" style="overflow:visible">
    ${slices.join("\n    ")}
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--sd-border)" stroke-width="1.5"/>
    <text x="${cx}" y="${cy+4}" text-anchor="middle" font-size="11" fill="#ccc" pointer-events="none">${filled}/${segs}</text>
  </svg>
</div>`;
  }

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

    const col       = esc(w.color      ?? "#e04040");
    const bg        = esc(w.emptyColor ?? w.bgColor ?? "var(--sd-bg-3)");
    const iconFull  = esc(this._faClass(w.icon ?? "fa-circle"));

    const iconEmptyFull = w.emptyIcon
      ? esc(this._faClass(w.emptyIcon))
      : iconFull;

    const iconImg      = w.iconImg      ? esc(String(w.iconImg))      : "";
    const emptyIconImg = w.emptyIconImg ? esc(String(w.emptyIconImg)) : "";
    const glow      = w.glow === false ? 0 : 1;
    const size      = Math.min(48, Math.max(8, Number(w.pipSize) > 0 ? Number(w.pipSize) : 14));

    const pips = [];
    for (let i = 0; i < maxVal; i++) {
      const active = i < filled;
      const useImg = active ? iconImg : (emptyIconImg || iconImg);
      const shadow = (active && glow)
        ? `0 0 ${Math.round(size*0.45)}px ${col}`
        : "none";
      if (useImg) {
        pips.push(
          `<img src="${useImg}" class="sd-tracker-pip" draggable="false"
              data-path="${path}" data-index="${i}" data-max="${maxVal}"
              title="${i+1}/${maxVal} — click to fill, click filled to unfill"
              style="width:${size}px;height:${size}px;cursor:pointer;border-radius:3px;
                     opacity:${active ? 1 : .35};
                     filter:${active ? "none" : "grayscale(.85)"};
                     box-shadow:${shadow};
                     transition:opacity .12s ease, filter .12s ease, box-shadow .12s ease, transform .08s ease;
                     object-fit:cover;-webkit-user-drag:none;user-select:none">`
        );
      } else {
        const iconCls = active ? iconFull : iconEmptyFull;
        pips.push(
          `<i class="${iconCls} sd-tracker-pip"
              data-path="${path}" data-index="${i}" data-max="${maxVal}"
              title="${i+1}/${maxVal} — click to fill, click filled to unfill"
              style="font-size:${size}px;cursor:pointer;
                     color:${active ? col : bg};
                     text-shadow:${shadow};
                     transition:color .12s ease, text-shadow .12s ease, transform .08s ease"></i>`
        );
      }
    }

    return `<div class="widget widget-tracker" style="display:flex;flex-direction:column;gap:2px">
  <div style="display:flex;align-items:center;gap:6px">
    <span class="widget-label">${lbl}</span>
    <span style="font-size:9px;color:var(--sd-text-3)">${filled}/${maxVal}</span>
    <button type="button" class="sd-tracker-reset" data-path="${path}"
      title="Reset tracker to 0"
      style="background:none;border:1px solid var(--sd-w-bd,var(--sd-border));border-radius:3px;color:var(--sd-text-3);
             cursor:pointer;font-size:9px;padding:0 5px;line-height:1.6;margin-left:auto;
             transition:color .15s,border-color .15s"
      onmouseover="this.style.color='var(--sd-danger)';this.style.borderColor='var(--sd-danger)'"
      onmouseout="this.style.color='#555';this.style.borderColor='var(--sd-border)'">↺</button>
  </div>
  <div class="sd-tracker-row" style="display:flex;flex-wrap:wrap;gap:4px;align-items:center;padding:2px 0">
    ${pips.join("\n    ")}
  </div>
</div>`;
  }

  static _render_counter(w, doc) {
    const e    = this._esc;
    const val  = Number(this._get(doc, w.path, 0)) || 0;
    const col  = e(w.color ?? "var(--sd-warn)");
    const step = Number(w.step ?? 1) || 1;

    const minN = (w.min === "" || w.min == null) ? null : Number(w.min);
    const maxN = (w.max === "" || w.max == null) ? null : Number(w.max);
    const hasRange = Number.isFinite(minN) && Number.isFinite(maxN) && maxN > minN;
    const pct = hasRange
      ? Math.round(Math.clamp((val - minN) / (maxN - minN), 0, 1) * 100)
      : 0;
    return `<div class="widget widget-counter" style="display:flex;flex-direction:column;align-items:center;gap:2px;padding:4px 0;--sd-progress:${pct}%">
  <div class="widget-label cnt-lbl" style="font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--sd-text-2)">${e(w.label ?? "Counter")}</div>
  <div class="cnt-row" style="display:flex;align-items:center;gap:8px">
    <button type="button" class="num-btn cnt-btn cnt-btn-dec" data-action="widgetNumStep"
            data-path="${e(w.path)}" data-step="-${step}"
            data-min="${w.min ?? ""}" data-max="${w.max ?? ""}"
            style="font-size:16px;width:28px;height:28px;border-radius:6px;
                   background:var(--sd-bg);border:1px solid ${col}66;color:${col};
                   cursor:pointer;transition:all .12s"
            onmouseover="this.style.background='${col}22'"
            onmouseout="this.style.background='var(--sd-bg)'">−</button>
    <div class="cnt-val" data-progress="${pct}" style="font-size:22px;font-weight:700;min-width:38px;text-align:center;color:${col};
                text-shadow:0 0 8px ${col}55;--sd-progress:${pct}%">${val}</div>
    <button type="button" class="num-btn cnt-btn cnt-btn-inc" data-action="widgetNumStep"
            data-path="${e(w.path)}" data-step="${step}"
            data-min="${w.min ?? ""}" data-max="${w.max ?? ""}"
            style="font-size:16px;width:28px;height:28px;border-radius:6px;
                   background:var(--sd-bg);border:1px solid ${col}66;color:${col};
                   cursor:pointer;transition:all .12s"
            onmouseover="this.style.background='${col}22'"
            onmouseout="this.style.background='var(--sd-bg)'">+</button>
  </div>
</div>`;
  }

  static _render_rollButton(w, doc) {
    const e    = this._esc;
    const raw  = w.formula ?? "1d20";
    const col  = e(w.color ?? "#5a9ae0");
    const icon = e(this._faClass(w.icon ?? "fa-dice-d20"));
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
    <i class="${icon}" style="color:${col};font-size:16px"></i>
    <span style="flex:1">${e(w.label ?? "Roll")}</span>
    <span style="opacity:.7;font-size:10px;font-weight:400">${e(display)}</span>
  </button>
</div>`;
  }

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

    const col       = e(w.color      ?? "#f0c040");
    const bg        = e(w.emptyColor ?? w.bgColor ?? "var(--sd-bg-3)");
    const iconFull  = e(this._faClass(w.icon ?? "fa-coins"));
    const iconEmptyFull = w.emptyIcon
      ? e(this._faClass(w.emptyIcon))
      : iconFull;

    const iconImg      = w.iconImg      ? e(String(w.iconImg))      : "";
    const emptyIconImg = w.emptyIconImg ? e(String(w.emptyIconImg)) : "";
    const glow      = w.glow === false ? 0 : 1;
    const size      = Math.min(48, Math.max(8, Number(w.pipSize) > 0 ? Number(w.pipSize) : 16));

    const pips = [];
    for (let i = 0; i < maxVal; i++) {
      const active = i < filled;
      const useImg = active ? iconImg : (emptyIconImg || iconImg);
      const shadow = (active && glow)
        ? `0 0 ${Math.round(size*0.45)}px ${col}`
        : "none";
      if (useImg) {
        pips.push(
          `<img src="${useImg}" class="sd-tracker-pip" draggable="false"
              data-path="${path}" data-index="${i}" data-max="${maxVal}"
              title="${i+1}/${maxVal}"
              style="width:${size}px;height:${size}px;cursor:pointer;border-radius:3px;
                     opacity:${active ? 1 : .35};
                     filter:${active ? "none" : "grayscale(.85)"};
                     box-shadow:${shadow};
                     transition:opacity .12s ease, filter .12s ease, box-shadow .12s ease;
                     object-fit:cover;-webkit-user-drag:none;user-select:none">`
        );
      } else {
        const iconCls = active ? iconFull : iconEmptyFull;
        pips.push(
          `<i class="${iconCls} sd-tracker-pip"
              data-path="${path}" data-index="${i}" data-max="${maxVal}"
              title="${i+1}/${maxVal}"
              style="font-size:${size}px;cursor:pointer;
                     color:${active ? col : bg};
                     text-shadow:${shadow};
                     transition:color .12s ease, text-shadow .12s ease"></i>`
        );
      }
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
                     background:var(--sd-bg);border:1px solid ${col}66;color:${col};cursor:pointer">−</button>
      <button type="button" class="num-btn" data-action="widgetNumStep"
              data-path="${path}" data-step="1" data-min="0" data-max="${maxVal}"
              title="Gain one"
              style="width:22px;height:22px;font-size:12px;border-radius:4px;
                     background:var(--sd-bg);border:1px solid ${col}66;color:${col};cursor:pointer">+</button>
    </div>
  </div>
  <div class="sd-token-row" style="display:flex;flex-wrap:wrap;gap:3px;align-items:center;padding:2px 0">
    ${pips.join("\n    ")}
  </div>
</div>`;
  }

  static _render_diceTray(w, doc) {
    const e       = this._esc;
    const flagPath = w.flagPath ?? "flags.sd.lastRoll";
    const data   = this._get(doc, flagPath, null) ?? this._get(doc, `system.${flagPath}`, null);
    const col    = e(w.color ?? "#7ef0c3");
    const compact = w.compact === true;

    if (!data || typeof data !== "object") {
      return `<div class="widget widget-dice-tray" style="display:flex;align-items:center;gap:6px;padding:4px 8px;background:var(--sd-bg);border:1px dashed ${col}44;border-radius:6px;color:var(--sd-text-3);font-size:11px">
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
  <span style="font-size:10px;color:var(--sd-text-3);margin-left:auto">${formula}${flavor ? ` · ${flavor}` : ""}</span>
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
  <div style="font-size:9px;color:var(--sd-text-3);font-family:monospace">${formula}${flavor ? ` · ${flavor}` : ""}</div>
</div>`;
  }

  static _render_tags(w, doc) {
    const esc   = this._esc.bind(this);
    const lbl   = esc(w.label ?? "Tags");
    const path  = esc(w.path  ?? "");
    const raw   = String(this._get(doc, w.path, ""));
    const col   = esc(w.color ?? "#5a6a9a");
    const fg    = esc(w.tagFg ?? "var(--sd-text-2)");
    const tags  = raw.split(",").map(t => t.trim()).filter(Boolean);
    const pills = tags.map(t =>
      `<span class="sd-tag-pill" style="background:${col}22;border:1px solid ${col}55;
        border-radius:10px;padding:1px 8px;font-size:10px;color:${fg};white-space:nowrap">${esc(t)}
        <span class="sd-tag-remove" data-path="${path}" data-tag="${esc(t)}"
          style="cursor:pointer;margin-left:3px;color:var(--sd-w-label, var(--sd-text-3));font-size:9px" title="Remove">✕</span>
      </span>`
    ).join("\n    ");
    return `<div class="widget widget-tags">
  <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px">
    <span class="widget-label">${lbl}</span>
    <button type="button" class="sd-tag-add" data-path="${path}"
      style="background:none;border:1px solid var(--sd-w-bd,var(--sd-border));border-radius:3px;color:var(--sd-w-label, var(--sd-text-3));
             font-size:9px;padding:0 5px;cursor:pointer;line-height:1.6" title="Add tag">+</button>
  </div>
  <div class="sd-tag-container" data-path="${path}"
       style="display:flex;flex-wrap:wrap;gap:4px;min-height:20px">
    ${pills}
  </div>
</div>`;
  }

  static _render_image(w, doc) {
    const esc = this._esc.bind(this);
    const fromPath = w.path ? String(this._get(doc, w.path, "")) : "";
    const src = esc(w.staticSrc || fromPath || "");
    const lbl = esc(w.label ?? "");
    const ww  = Number(w.width)        || 64;
    const hh  = Number(w.height)       || 64;
    const br  = Number(w.borderRadius);
    const brCSS = Number.isFinite(br) && br >= 0 ? `border-radius:${br}px;` : "";
    const bd  = (typeof w.boxBorder === "string" && w.boxBorder.trim()) ? w.boxBorder.trim() : null;
    const bw  = Number(w.borderWidth) > 0 ? Number(w.borderWidth) : (bd ? 1 : 0);
    const borderCSS = bd ? `border:${bw}px solid ${esc(bd)};` : "";
    const imgStyle  = `width:${ww}px;height:${hh}px;object-fit:cover;${brCSS}display:block;${borderCSS}box-sizing:border-box`;
    const imgEl     = src
      ? `<img src="${src}" style="${imgStyle}" alt="${lbl || "image"}">`
      : `<div style="${imgStyle};background:var(--sd-bg);${bd ? "" : "border:1px dashed var(--sd-border);"}display:flex;align-items:center;justify-content:center;color:var(--sd-border);font-size:20px"><i class="fas fa-image"></i></div>`;

    const pencilBtn = `<button type="button" class="sd-img-pick sd-img-pencil"
         data-static="1" data-current="${src}"
         title="Выбрать изображение"
         style="position:absolute;top:2px;right:2px;background:rgba(0,0,0,0.55);
                border:none;border-radius:3px;color:var(--sd-text-2);cursor:pointer;
                padding:1px 5px;font-size:11px;line-height:16px;opacity:0;
                transition:opacity .15s"><i class="fas fa-folder-open"></i></button>`;

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
  <div class="widget-derived-value" style="font-size:18px;font-weight:700;text-align:center;color:var(--sd-text);letter-spacing:.02em">${esc(String(disp))}</div>
</div>`;
  }

  static _resolveCardsStackSync(w) {
    if (w.sourceUuid) {
      try { const d = fromUuidSync?.(w.sourceUuid); if (d) return d; } catch {}
    }
    if (w.sourceName) {
      const byName = game.cards?.getName?.(w.sourceName);
      if (byName) return byName;
    }
    return null;
  }

  static _cardFaceImg(card) {
    if (!card) return "";
    if (typeof card.face === "number" && card.faces?.[card.face]?.img) return card.faces[card.face].img;
    if (card.face === null) return card.back?.img ?? card.faces?.[0]?.img ?? "";
    return card.faces?.[0]?.img ?? card.back?.img ?? "";
  }

  static _render_cardHand(w, doc) {
    const e = this._esc;
    const stack = this._resolveCardsStackSync(w);
    const lbl = e(w.label ?? "Hand");
    if (!stack) {
      return `<div class="widget widget-cardhand">
        <div class="widget-label">${lbl}</div>
        <div style="opacity:.6;font-size:11px;padding:6px 0">Stack not found — set <code>sourceName</code> or <code>sourceUuid</code> in widget config.</div>
      </div>`;
    }
    const cards = Array.from(stack.cards ?? []);
    const visibleLimit = Number(w.maxVisible ?? 0);
    const shown = visibleLimit > 0 ? cards.slice(0, visibleLimit) : cards;
    const cardW = Math.max(40, Number(w.cardWidth ?? 96));
    const layout = ["fan","strip","grid"].includes(w.layout) ? w.layout : "strip";
    const click = w.clickAction ?? "inspect";
    const stackUuid = stack.uuid;
    const stackName = stack.name ?? "";
    const runOn     = (click === "runGraph")
      ? (["click","dblclick","rightclick"].includes(w.runGraphOn) ? w.runGraphOn : "click")
      : "click";
    const actionGraphRaw = (click === "runGraph") ? (w.actionGraph ?? "") : "";

    const cardEl = (c, i) => {
      const img = this._cardFaceImg(c);
      const isBack = c.face === null;
      const flippedIco = isBack ? "fa-eye" : "fa-eye-slash";
      const flippedTitle = isBack ? "Flip to face" : "Flip to back";
      return `
      <div class="sd-card" data-card-id="${e(c.id)}" data-card-index="${i}"
           data-stack-uuid="${e(stackUuid)}" data-stack-name="${e(stackName)}"
           data-card-name="${e(c.name ?? "")}" data-card-face="${e(c.face === null || c.face === undefined ? -1 : c.face)}"
           data-card-img="${e(img)}"
           data-action="cardClick"
           data-click-mode="${e(click)}" data-run-on="${e(runOn)}"
           data-action-graph="${e(actionGraphRaw)}"
           style="position:relative;display:inline-block;flex:0 0 ${cardW}px;width:${cardW}px;height:${Math.round(cardW*1.4)}px;border-radius:6px;overflow:hidden;background:#0c0c14;border:1px solid var(--sd-bg-3);box-shadow:0 1px 4px rgba(0,0,0,.4);cursor:${click==='none'?'default':'pointer'};transition:transform .1s">
        <img src="${e(img)}" alt="${e(c.name ?? "Card")}" loading="lazy"
             style="width:100%;height:100%;object-fit:cover;display:block;${isBack?'filter:brightness(.85)':''}">
        <button type="button" class="sd-card-flip" data-action="cardFlip"
                data-stack-uuid="${e(stackUuid)}" data-card-id="${e(c.id)}"
                title="${e(flippedTitle)}"
                style="position:absolute;top:3px;right:3px;width:22px;height:22px;border-radius:50%;border:1px solid #555;background:rgba(0,0,0,.55);color:#fff;font-size:11px;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0">
          <i class="fas ${flippedIco}"></i>
        </button>
        <div class="sd-card-name" title="${e(c.name ?? "")}"
             style="position:absolute;left:0;right:0;bottom:0;padding:2px 4px;background:linear-gradient(transparent,rgba(0,0,0,.85));color:#fff;font-size:10px;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${e(c.name ?? "")}</div>
      </div>`;
    };

    let body = "";
    if (layout === "fan") {
      const N = shown.length;
      body = `<div class="sd-cardhand-fan" style="position:relative;height:${Math.round(cardW*1.6)}px;display:flex;justify-content:center">
        ${shown.map((c, i) => {
          const t = N <= 1 ? 0 : (i - (N - 1) / 2);
          const rot = t * 8;
          const tx  = t * (cardW * 0.4);
          const ty  = Math.abs(t) * 4;
          return `<div style="position:absolute;left:50%;top:0;transform:translateX(calc(-50% + ${tx}px)) translateY(${ty}px) rotate(${rot}deg);transform-origin:bottom center;z-index:${100 + i}">${cardEl(c, i)}</div>`;
        }).join("")}
      </div>`;
    } else if (layout === "grid") {
      body = `<div class="sd-cardhand-grid" style="display:flex;flex-wrap:wrap;gap:6px;padding:4px 0">${shown.map(cardEl).join("")}</div>`;
    } else {

      body = `<div class="sd-cardhand-strip-wrap" style="position:relative;display:flex;align-items:center;gap:6px">
        <button type="button" class="sd-card-strip-prev" data-action="cardStripScroll" data-dir="-1"
                style="flex-shrink:0;width:24px;height:36px;background:rgba(20,20,30,.85);border:1px solid var(--sd-bg-3);border-radius:4px;color:var(--sd-text-2);cursor:pointer;font-size:11px;padding:0">
          <i class="fas fa-chevron-left"></i>
        </button>
        <div class="sd-cardhand-strip" style="flex:1;display:flex;gap:6px;overflow-x:auto;scroll-behavior:smooth;padding:4px 2px;scrollbar-width:thin">
          ${shown.map(cardEl).join("")}
        </div>
        <button type="button" class="sd-card-strip-next" data-action="cardStripScroll" data-dir="1"
                style="flex-shrink:0;width:24px;height:36px;background:rgba(20,20,30,.85);border:1px solid var(--sd-bg-3);border-radius:4px;color:var(--sd-text-2);cursor:pointer;font-size:11px;padding:0">
          <i class="fas fa-chevron-right"></i>
        </button>
      </div>`;
    }

    const totalCount = stack.cards?.size ?? cards.length;
    const showCount = w.showCount !== "no";
    const showActions = w.showActions !== "no";

    const actionBar = !showActions ? "" : `
      <div class="sd-cardhand-actions" style="display:flex;gap:4px;margin-top:4px">
        <button type="button" data-action="cardStackShuffle" data-stack-uuid="${e(stackUuid)}" title="Shuffle"
                style="background:var(--sd-bg);border:1px solid var(--sd-bg-3);border-radius:3px;color:var(--sd-text-2);cursor:pointer;font-size:11px;padding:3px 8px">
          <i class="fas fa-shuffle"></i> Shuffle
        </button>
        <button type="button" data-action="cardStackRecall" data-stack-uuid="${e(stackUuid)}" title="Recall"
                style="background:var(--sd-bg);border:1px solid var(--sd-bg-3);border-radius:3px;color:var(--sd-text-2);cursor:pointer;font-size:11px;padding:3px 8px">
          <i class="fas fa-arrow-rotate-left"></i> Recall
        </button>
        <button type="button" data-action="cardStackFlipAll" data-stack-uuid="${e(stackUuid)}" title="Flip all"
                style="background:var(--sd-bg);border:1px solid var(--sd-bg-3);border-radius:3px;color:var(--sd-text-2);cursor:pointer;font-size:11px;padding:3px 8px">
          <i class="fas fa-arrows-rotate"></i> Flip All
        </button>
      </div>`;

    return `<div class="widget widget-cardhand">
      <div class="widget-label" style="display:flex;align-items:center;gap:6px">
        <span>${lbl}</span>
        ${showCount ? `<span style="opacity:.55;font-size:11px">${shown.length}${visibleLimit>0&&totalCount>visibleLimit?`/${totalCount}`:""}</span>` : ""}
      </div>
      ${body}
      ${actionBar}
    </div>`;
  }

  static _render_cardDrawButton(w, doc) {
    const e = this._esc;
    const deck = this._resolveCardsStackSync({ sourceName: w.fromName, sourceUuid: w.fromUuid });
    const lbl  = e(w.label ?? "Draw");
    if (!deck) {
      return `<div class="widget widget-card-draw">
        <div class="widget-label">${lbl}</div>
        <div style="opacity:.6;font-size:11px">Deck not found.</div>
      </div>`;
    }
    const remain = deck.availableCards?.length ?? deck.cards?.size ?? 0;
    const thumb  = deck.img || deck.cards?.contents?.[0]?.back?.img || "icons/svg/card-cards.svg";
    const showCount = w.showCount !== "no";
    return `<div class="widget widget-card-draw">
      <div class="widget-label">${lbl}</div>
      <button type="button" data-action="cardWidgetDraw"
              data-from-uuid="${e(deck.uuid)}" data-from-name="${e(w.fromName ?? "")}"
              data-to-uuid="${e(w.toUuid ?? "")}" data-to-name="${e(w.toName ?? "")}"
              data-count="${Number(w.count ?? 1)}" data-how="${e(w.how ?? "top")}"
              style="position:relative;display:flex;align-items:center;gap:8px;width:100%;padding:6px 8px;background:var(--sd-bg);border:1px solid #4a3a6a;border-radius:5px;color:#bcb1d4;cursor:pointer">
        <img src="${e(thumb)}" alt="" style="width:38px;height:54px;object-fit:cover;border-radius:3px;flex-shrink:0">
        <span style="flex:1;text-align:left;font-size:12px;font-weight:600">${lbl}</span>
        ${showCount ? `<span style="font-size:10px;opacity:.7;padding:2px 6px;background:rgba(0,0,0,.35);border-radius:8px">${remain}</span>` : ""}
      </button>
    </div>`;
  }

  static _sbAbilityRow(ab, esc) {
    const hf       = ab.system?.hiddenFields ?? {};
    const cost     = Number(hf.cost ?? 0) || 0;
    const pathUses = String(hf.pathUses ?? "").trim();
    const equipped = ab.system?.equipped ? "equipped" : "";

    const costBadge = (cost > 0)
      ? `<span class="sb-ability-cost" style="font-size:10px;color:var(--sd-accent);white-space:nowrap" title="${esc(pathUses || "no resource path")}">${cost}</span>`
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
                         color:var(--sd-stamina);cursor:pointer;font-size:10px;padding:1px 6px;line-height:16px">
            <i class="fas fa-play"></i>
          </button>
          <button type="button" data-action="abilityEdit"
                  data-item-id="${esc(ab.id)}"
                  title="Edit"
                  style="background:var(--sd-bg);border:1px solid var(--sd-bg-3);border-radius:3px;
                         color:var(--sd-w-label, var(--sd-text-3));cursor:pointer;font-size:10px;padding:1px 6px;line-height:16px">
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

  static _render_questMarker(w, doc) {
    const e = this._esc;
    const label = w.label ? e(w.label) : "";
    const compact = (w.compact === "yes" || w.compact === true);
    const tooltipLen = Math.max(40, Number(w.tooltipLength) || 240);
    const lockedUuid = String(w.questLogUuid || "").trim();
    const placeholder = e(w.placeholder ?? "No active quest");
    const iconActive = e(this._faClass(w.iconActive || "fa-flag"));
    const iconNone   = e(this._faClass(w.iconNone   || "fa-flag-checkered"));

    const isActor = doc?.documentName === "Actor";
    const aRaw = isActor ? (doc.system?.activeQuest ?? null) : null;
    const active = (aRaw && typeof aRaw === "object" && (aRaw.questLogUuid || aRaw.questId)) ? aRaw : null;
    const activeUuid = active?.questLogUuid ? String(active.questLogUuid) : "";
    const activeQid  = active?.questId      ? String(active.questId)      : "";

    let log = null, quest = null, mismatch = false;
    const tryResolve = (uuid) => {
      if (!uuid) return null;
      try { return fromUuidSync?.(uuid) ?? null; } catch { return null; }
    };

    if (activeUuid && activeQid) {
      log = tryResolve(activeUuid);
      if (log?.documentName === "Item" && log.type === "questlog") {
        quest = (log.system?.quests ?? []).find(q => q.id === activeQid) ?? null;
      }
      if (lockedUuid && lockedUuid !== activeUuid) {
        mismatch = true;
        log = null; quest = null;
      }
    }

    const lockedLog = (!log && lockedUuid) ? tryResolve(lockedUuid) : null;

    const openLogUuid = activeUuid || lockedUuid;
    const openLogName = (log?.name) || (lockedLog?.name) || "";
    const headerHtml = label ? `<div class="widget-label">${label}</div>` : "";

    if (!quest) {
      const note = mismatch ? "Active quest not in this QuestLog."
                : (lockedLog ? `Open ${lockedLog.name}` : placeholder);
      const openAttrs = openLogUuid
        ? `data-action="questMarkerOpen" data-qm-log="${e(openLogUuid)}" data-qm-qid=""`
        : `disabled`;
      const cursor = openLogUuid ? "pointer" : "default";
      const opacity = openLogUuid ? "" : "opacity:.6;";
      return `<div class="widget widget-quest-marker widget-empty">
  ${headerHtml}
  <button type="button" class="qm-row qm-open" ${openAttrs}
    title="${e(note)}"
    style="display:flex;align-items:center;gap:6px;padding:4px 6px;border:1px solid var(--sd-border);border-radius:5px;background:var(--sd-bg);min-height:28px;width:100%;cursor:${cursor};${opacity}color:var(--sd-text-2)">
    <i class="fas ${iconNone}" style="color:var(--sd-text-3);flex-shrink:0"></i>
    ${compact ? "" : `<span style="flex:1;font-size:12px;color:var(--sd-text-3);font-style:italic;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left">${e(note)}</span>`}
    ${openLogUuid ? `<i class="fas fa-up-right-from-square" style="font-size:10px;opacity:.6;flex-shrink:0"></i>` : ""}
  </button>
</div>`;
    }

    const qName = e(quest.name || "Quest");
    const qIcon = e(this._faClass(quest.icon || "fa-flag"));
    const desc  = String(quest.description || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const ttip  = e(desc.length > tooltipLen ? desc.slice(0, tooltipLen - 1) + "…" : desc);
    const status = e(quest.status || "available");

    if (compact) {
      return `<div class="widget widget-quest-marker widget-compact" data-qm-log="${e(activeUuid)}" data-qm-qid="${e(activeQid)}" title="${qName}${ttip ? " — " + ttip : ""}">
  ${headerHtml}
  <button type="button" class="qm-open" data-action="questMarkerOpen" data-qm-log="${e(activeUuid)}" data-qm-qid="${e(activeQid)}"
    style="display:flex;align-items:center;gap:6px;padding:4px 6px;border:1px solid var(--sd-accent-dim,var(--sd-border));border-radius:5px;background:var(--sd-bg);color:var(--sd-accent);cursor:pointer;min-height:28px;width:100%">
    <i class="fas ${iconActive}" style="color:var(--sd-accent);flex-shrink:0"></i>
    <i class="fas ${qIcon}" style="opacity:.85;flex-shrink:0"></i>
    <span style="font-size:10px;opacity:.7;text-transform:uppercase;letter-spacing:.5px">${status}</span>
  </button>
</div>`;
    }

    return `<div class="widget widget-quest-marker" data-qm-log="${e(activeUuid)}" data-qm-qid="${e(activeQid)}">
  ${headerHtml}
  <button type="button" class="qm-row qm-open" data-action="questMarkerOpen" data-qm-log="${e(activeUuid)}" data-qm-qid="${e(activeQid)}"
    title="${ttip || qName}"
    style="display:flex;align-items:center;gap:6px;padding:4px 6px;border:1px solid var(--sd-accent-dim,var(--sd-border));border-radius:5px;background:var(--sd-bg);color:var(--sd-text-1);cursor:pointer;min-height:28px;width:100%;text-align:left">
    <i class="fas ${iconActive}" style="color:var(--sd-accent);flex-shrink:0"></i>
    <i class="fas ${qIcon}" style="opacity:.85;flex-shrink:0"></i>
    <span class="qm-name" style="flex:1;font-size:12px;font-weight:600;color:var(--sd-text-1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${qName}</span>
    <span class="qm-status" style="font-size:9px;opacity:.6;text-transform:uppercase;letter-spacing:.5px;flex-shrink:0">${status}</span>
    <i class="fas fa-up-right-from-square" style="font-size:10px;color:var(--sd-accent);opacity:.7;flex-shrink:0"></i>
  </button>
</div>`;
  }

  static _render_inventory_compact(w, doc, items) {
    const e   = this._esc;
    const lbl = e(w.label || "Inventory");
    const ic  = e(this._faClass(w.icon || "fa-backpack"));
    if (!items || items.length === 0) {
      return `<div class="widget widget-inventory widget-compact"><details class="sd-hud-popover">
  <summary class="sd-hud-pop-btn"><i class="${ic}"></i><span>${lbl}</span><span class="sd-hud-pop-count">0</span></summary>
  <div class="sd-hud-pop-body sd-hud-pop-empty"><i class="fas fa-backpack"></i> No items</div>
</details></div>`;
    }
    let rows = "";
    for (const item of items) {
      const isInv     = item.type === "inventory";
      const equipped  = item.system?.equipped;
      const equippable = item.system?.equippable;
      const qty       = item.system?.quantity ?? 1;
      const equipBtn  = isInv
        ? `<button type="button" class="sd-hud-pop-btn-equip ${equipped ? "is-on" : ""}" data-action="itemEquip" data-item-id="${e(item.id)}" title="${equipped ? "Unequip" : "Equip"}"${equippable ? "" : ' style="opacity:.45"'}><i class="fas ${equipped ? "fa-shield-halved" : "fa-shield"}"></i></button>`
        : "";
      rows += `<li class="sd-hud-pop-row" data-item-id="${e(item.id)}">
        <img src="${e(item.img)}" alt="${e(item.name)}">
        <span class="sd-hud-pop-name" title="${e(item.name)}">${e(item.name)}</span>
        ${qty > 1 ? `<span class="sd-hud-pop-qty">×${qty}</span>` : ""}
        <button type="button" data-action="itemUse" data-item-id="${e(item.id)}" title="Use"><i class="fas fa-play"></i></button>
        ${equipBtn}
      </li>`;
    }
    return `<div class="widget widget-inventory widget-compact"><details class="sd-hud-popover">
  <summary class="sd-hud-pop-btn"><i class="${ic}"></i><span>${lbl}</span><span class="sd-hud-pop-count">${items.length}</span></summary>
  <ul class="sd-hud-pop-body sd-hud-pop-list">${rows}</ul>
</details></div>`;
  }

  static _render_effects_compact(w, doc, effects, canEdit) {
    const e   = this._esc;
    const lbl = e(w.label || "Effects");
    const ic  = e(this._faClass(w.icon || "fa-sparkles"));
    if (!effects || effects.length === 0) {
      return `<div class="widget widget-effects widget-compact"><details class="sd-hud-popover">
  <summary class="sd-hud-pop-btn"><i class="${ic}"></i><span>${lbl}</span><span class="sd-hud-pop-count">0</span></summary>
  <div class="sd-hud-pop-body sd-hud-pop-empty"><i class="fas fa-sparkles"></i> No effects</div>
</details></div>`;
    }
    let rows = "";
    for (const ef of effects) {
      const eyeIcon  = ef.disabled ? "fa-eye-slash" : "fa-eye";
      const offCls   = ef.disabled ? "sd-hud-pop-row--off" : "";
      rows += `<li class="sd-hud-pop-row ${offCls}" data-effect-id="${e(ef.id)}">
        <img src="${e(ef.img ?? ef.icon ?? 'icons/svg/aura.svg')}" alt="${e(ef.name)}">
        <span class="sd-hud-pop-name" title="${e(ef.name)}">${e(ef.name)}</span>
        ${canEdit ? `<button type="button" data-action="effectToggle" data-effect-id="${e(ef.id)}" title="${ef.disabled ? 'Enable' : 'Disable'}"><i class="fas ${eyeIcon}"></i></button>` : ""}
      </li>`;
    }
    return `<div class="widget widget-effects widget-compact"><details class="sd-hud-popover">
  <summary class="sd-hud-pop-btn"><i class="${ic}"></i><span>${lbl}</span><span class="sd-hud-pop-count">${effects.length}</span></summary>
  <ul class="sd-hud-pop-body sd-hud-pop-list">${rows}</ul>
</details></div>`;
  }

  static _render_spellbook_compact(w, doc, abilities, wantType) {
    const e   = this._esc;
    const lbl = e(w.label || (wantType ? wantType : "Spellbook"));
    const ic  = e(this._faClass(w.icon || "fa-book-sparkles"));
    if (!abilities || abilities.length === 0) {
      return `<div class="widget widget-spellbook widget-compact"><details class="sd-hud-popover">
  <summary class="sd-hud-pop-btn"><i class="${ic}"></i><span>${lbl}</span><span class="sd-hud-pop-count">0</span></summary>
  <div class="sd-hud-pop-body sd-hud-pop-empty"><i class="fas fa-book-sparkles"></i> No abilities</div>
</details></div>`;
    }
    let rows = "";
    for (const ab of abilities) {
      const hf   = ab.system?.hiddenFields ?? {};
      const cost = Number(hf.cost ?? 0) || 0;
      rows += `<li class="sd-hud-pop-row" data-item-id="${e(ab.id)}">
        <img src="${e(ab.img ?? "icons/svg/book.svg")}" alt="${e(ab.name)}">
        <span class="sd-hud-pop-name" title="${e(ab.name)}">${e(ab.name)}</span>
        ${cost > 0 ? `<span class="sd-hud-pop-qty" title="cost">${cost}</span>` : ""}
        <button type="button" data-action="abilityCast" data-item-id="${e(ab.id)}" title="Use"><i class="fas fa-play"></i></button>
      </li>`;
    }
    return `<div class="widget widget-spellbook widget-compact"><details class="sd-hud-popover">
  <summary class="sd-hud-pop-btn"><i class="${ic}"></i><span>${lbl}</span><span class="sd-hud-pop-count">${abilities.length}</span></summary>
  <ul class="sd-hud-pop-body sd-hud-pop-list">${rows}</ul>
</details></div>`;
  }

  static _render_attributeGroup(w, doc) {
    const e   = this._esc;
    const lbl = e(w.label || "Attributes");
    const ic  = e(this._faClass(w.icon || "fa-dice-d20"));
    if (!(doc instanceof Actor)) {
      return `<div class="widget widget-attribute-group widget-compact"><details class="sd-hud-popover">
  <summary class="sd-hud-pop-btn"><i class="${ic}"></i><span>${lbl}</span></summary>
  <div class="sd-hud-pop-body sd-hud-pop-empty">Actor required</div>
</details></div>`;
    }

    const cfgLabels  = CONFIG?.SD?.attributes ?? {};
    const cfgEnabled = CONFIG?.SD?.attributesEnabled ?? {};
    const explicit   = String(w.attributeKeys ?? "").trim();

    const parseToken = (raw) => {
      const s = String(raw).trim();
      if (!s) return null;

      if (s.includes(".")) {
        let p = s.replace(/^\.+|\.+$/g, "");

        let key = "";
        const m = p.match(/^system\.attributes\.([^.]+)(?:\.(?:value|score|mod))?$/);
        if (m) {
          key = m[1];

          return { key, scorePath: `system.attributes.${key}.value` };
        }

        const segs = p.split(".");
        key = segs[segs.length - 1];
        return { key, scorePath: p };
      }

      return { key: s, scorePath: `system.attributes.${s}.value` };
    };

    let tokens;
    if (explicit) {
      tokens = explicit.split(",").map(parseToken).filter(Boolean);
    } else {

      const cfgKeys = Object.keys(cfgLabels);
      const sourceKeys = cfgKeys.length
        ? cfgKeys.filter(k => cfgEnabled[k] !== false)
        : Object.keys(doc.system?.attributes ?? {});
      tokens = sourceKeys.map(k => ({ key: k, scorePath: `system.attributes.${k}.value` }));
    }

    const compute = CONFIG?.SD?.computeModifier ?? (s => Math.floor((Number(s) - 10) / 2));

    const attrGraphs = (w.attrGraphs && typeof w.attrGraphs === "object") ? w.attrGraphs : {};

    const items = tokens.map(({ key, scorePath }) => {

      let score = foundry.utils.getProperty(doc, scorePath);
      if (score && typeof score === "object") {
        if ("value" in score) { scorePath = `${scorePath}.value`; score = score.value; }
        else if ("score" in score) { scorePath = `${scorePath}.score`; score = score.score; }
      }
      score = Number(score);
      if (!Number.isFinite(score)) score = 10;
      const ag = attrGraphs[key] ?? null;
      let mod;
      if (ag?.modValueFormula) {
        const resolved = Number(FormulaEngine.evaluate(ag.modValueFormula, doc));
        mod = Number.isFinite(resolved) ? resolved : compute(score);
      } else {
        mod = compute(score);
      }

      const name   = cfgLabels[key]
        || (key.charAt(0).toUpperCase() + key.slice(1));
      return {
        key,
        path:    scorePath,
        score,
        mod,
        modStr:  mod >= 0 ? `+${mod}` : `${mod}`,
        name,
        onClickFormula: ag?.onClickFormula ?? null
      };
    });

    const _btnDataAttrs = (it) => it.onClickFormula
      ? { action: "attrModClick", attrs: `data-attr-onclick="${e(it.onClickFormula)}"` }
      : { action: "widgetRoll",   attrs: `data-formula="1d20+(${it.mod})" data-formula-raw="1d20+(${it.mod})" data-flavor="${e(it.name)}"` };

    if (w.compact) {
      const rows = items.map(it => {
        const b = _btnDataAttrs(it);
        return `<li class="sd-hud-pop-row" data-attr-key="${e(it.key)}">
        <span class="sd-hud-pop-name">${e(it.name)}</span>
        <span class="sd-hud-pop-qty">${e(String(it.score))}</span>
        <button type="button" data-action="${b.action}"
                ${b.attrs}
                title="Roll ${e(it.name)} (${it.modStr})">${it.modStr}</button>
      </li>`;
      }).join("");
      return `<div class="widget widget-attribute-group widget-compact"><details class="sd-hud-popover">
  <summary class="sd-hud-pop-btn"><i class="${ic}"></i><span>${lbl}</span><span class="sd-hud-pop-count">${items.length}</span></summary>
  <ul class="sd-hud-pop-body sd-hud-pop-list">${rows}</ul>
</details></div>`;
    }

    const cards = items.map(it => {
      const b = _btnDataAttrs(it);
      return `<div class="attr-item" data-attr-key="${e(it.key)}">
    <span class="attr-item-name">${e(it.name)}</span>
    <input type="number" class="attr-item-score" name="${e(it.path)}" value="${e(it.score)}">
    <button type="button" class="attr-item-mod" data-action="${b.action}"
            ${b.attrs}
            title="Roll ${e(it.name)} (${it.modStr})">${it.modStr}</button>
  </div>`;
    }).join("");
    const header = w.label
      ? `<div class="widget-label" style="display:flex;align-items:center;gap:6px"><i class="${ic}"></i>${lbl}</div>`
      : "";
    return `<div class="widget widget-attribute-group">
  ${header}
  <div class="attr-group-body">${cards}</div>
</div>`;
  }
}

Hooks.once("ready", () => {
  import("../data/item-slots.mjs").then(m => {
    globalThis._SD_SLOTS = { SlotManager: m.SlotManager };
  });
});
