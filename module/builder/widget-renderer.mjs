import { FormulaEngine } from "../helpers/formula-engine.mjs";
import { buildWidgetMacroScript, encodeMacroScript } from "../helpers/widget-macro.mjs";
import { ItemPreviewPopup } from "../helpers/item-preview-popup.mjs";
import { effectDurationLabel } from "../helpers/effect-duration.mjs";
import { effectChangeLabel } from "../helpers/effects.mjs";
import { sanitizeWidgetCss, widgetBuilderScopeId } from "./widget-css.mjs";
import { localizeTree } from "../helpers/localization.mjs";
import {
  getValueDefinition, readDatabaseValue, valueStoragePath, variableIdForLegacyPath,
  databaseValueList, databaseValueToText, readDatabaseValueList
} from "../helpers/value-database.mjs";

export class WidgetRenderer {

  static _sdLoc(key, fallback, data = null) {
    try {
      const value = data ? game.i18n?.format?.(key, data) : game.i18n?.localize?.(key);
      if (value && value !== key) return value;
    } catch {}
    return fallback;
  }

  static render(widgetDef, doc, editMode = false, options = {}) {

    widgetDef = localizeTree(widgetDef);
    widgetDef = this._resolveDynamicColours(widgetDef, doc);

    if (editMode && typeof editMode === "object" && !Array.isArray(editMode)) {
      options = editMode;
      editMode = !!options.editMode;
    }
    const readOnly = !!options.readOnly;
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

      let html = this[`_render_${widgetDef.type}`]?.(widgetDef, doc, { readOnly }) ?? this._renderUnknown(widgetDef);

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

      const aaTagRaw = typeof widgetDef.animationTag === "string" ? widgetDef.animationTag.trim() : "";
      if (aaTagRaw && !/^<[^>]+\bdata-aa-tag="/.test(html)) {
        html = html.replace(/^(<[A-Za-z][A-Za-z0-9-]*)/, `$1 data-aa-tag="${this._esc(aaTagRaw)}"`);
      }

      const styleStr = this._buildStyle(widgetDef);
      if (styleStr) {
        if (/^<[^>]+style="/.test(html)) {
          html = html.replace(/^(<[^>]+style=")/, `$1${styleStr};`);
        } else {
          html = html.replace(/^(<[^>]+)(>)/, `$1 style="${styleStr}"$2`);
        }
      }
      html = this._decorateWidgetLabel(html, widgetDef);
      return html;
    } catch(e) {
      console.warn("SD | Widget render error:", e, widgetDef);
      return `<div class="widget widget-error"><i class="fas fa-exclamation-triangle"></i> ${widgetDef.type} error</div>`;
    }
  }

  static _bindingPath(variableId) {
    const raw=String(variableId??"");
    const id=getValueDefinition(raw)?.id ?? variableIdForLegacyPath(raw);
    return id ? valueStoragePath(id) : raw;
  }

  static _get(doc, variableId, fallback = "") {
    if (!variableId) return fallback;
    const raw=String(variableId);
    const id=getValueDefinition(raw)?.id ?? variableIdForLegacyPath(raw);
    if(id){const value=readDatabaseValue(doc,id);return value??fallback;}
    // Private compatibility fallback for unresolved pre-1.8 worlds.
    const val=foundry.utils.getProperty(doc,raw);
    return val??fallback;
  }

  static _isCssColour(value) {
    const s = String(value ?? "").trim();
    if (!s) return false;
    return /^(?:#[0-9a-f]{3,8}|(?:rgb|hsl|hwb|lab|lch|oklab|oklch|color)\([^;{}<>]*\)|color-mix\([^;{}<>]*\)|var\(--[a-z0-9_-]+(?:\s*,\s*[^;{}<>]+)?\)|transparent|currentcolor|[a-z]+)$/i.test(s);
  }

  static _resolveColourSpec(spec, doc) {
    if (typeof spec !== "string") return spec;
    const raw = spec.trim();
    if (!raw || this._isCssColour(raw)) return raw;

    let resolved;
    try {
      if (raw.includes("{") && raw.includes("}")) {
        resolved = FormulaEngine.evaluate(raw, doc);
      } else {
        resolved = this._get(doc, raw, undefined);
      }
    } catch { resolved = undefined; }

    if (resolved && typeof resolved === "object" && "value" in resolved) {
      resolved = resolved.value;
    }
    return this._isCssColour(resolved) ? String(resolved).trim() : "";
  }

  static _resolveDynamicColours(widgetDef, doc) {
    if (!widgetDef || typeof widgetDef !== "object") return widgetDef;
    const out = { ...widgetDef };
    const keys = [
      "boxBg", "boxFg", "boxBorder", "barTrack", "btnBg", "btnFg",
      "btnBorder", "iconColor", "btnColor", "onColor", "offColor",
      "lineColor", "titleColor", "emptyColor", "headerColor", "tagFg",
      "color", "bgColor", "fillColor", "accentColor"
    ];
    for (const key of keys) {
      if (typeof out[key] !== "string" || !out[key].trim()) continue;
      out[key] = this._resolveColourSpec(out[key], doc);
    }
    return out;
  }

  static _getValue(w, doc, fallback = "") {
    if (w.valueFormula !== undefined && w.valueFormula !== null && String(w.valueFormula).trim() !== "") {
      return FormulaEngine.evaluate(String(w.valueFormula), doc);
    }
    if (w.path) return this._get(doc, w.path, fallback);
    if (w.staticValue !== undefined && w.staticValue !== "") return w.staticValue;
    return fallback;
  }

  static _numberSpec(spec, doc, fallback = "", { allowBlank = false } = {}) {
    if (spec === undefined || spec === null || String(spec).trim() === "") {
      return allowBlank ? "" : fallback;
    }
    const raw = String(spec).trim();
    const direct = Number(raw);
    if (Number.isFinite(direct)) return direct;

    let value;
    try {
      value = FormulaEngine.isFormula(raw)
        ? FormulaEngine.evaluate(raw, doc)
        : this._get(doc, raw, undefined);
    } catch {
      value = undefined;
    }
    if (value && typeof value === "object" && "value" in value && typeof value.value !== "object") {
      value = value.value;
    }
    const n = Number(value);
    return Number.isFinite(n) ? n : (allowBlank ? "" : fallback);
  }

  // No preset dice. A widget rolls only when the sheet author configured a
  // formula; otherwise the interaction is delivered to the Sheet Blueprint as
  // an event and the graph decides what to do.
  static _getRollFormula(w, doc) {
    const raw = String(w.formula ?? "").trim();
    if (!raw) return "";
    return FormulaEngine.resolveForRoll(raw, doc);
  }

  static _buildStyle(w) {
    const parts = [];
    const px = value => {
      const number = Number(value);
      return Number.isFinite(number) && number > 0 ? `${number}px` : null;
    };
    const colour = value => {
      if (typeof value !== "string") return null;
      const source = value.trim();
      return this._isCssColour(source) ? source : null;
    };
    const choose = (value, allowed) => allowed.includes(String(value ?? "")) ? String(value) : "";
    const number = value => { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; };
    const cssVar = (name, value) => { if (value !== null && value !== "") parts.push(`${name}:${value}`); };

    const width = px(w.boxW);
    if (width) parts.push(`width:${width}`);
    const height = px(w.boxH);
    if (height) {
      // Inline !important plus the shared variable wins over old fixed 60/104px rules.
      parts.push(`--sd-widget-height:${height}`);
      parts.push(`height:var(--sd-widget-height)!important`);
      parts.push(`min-height:var(--sd-widget-height)!important`);
    }
    const minHeight = px(w.boxMinH); if (minHeight) parts.push(`min-height:${minHeight}!important`);
    const maxHeight = px(w.boxMaxH); if (maxHeight) parts.push(`max-height:${maxHeight}!important`);

    const background = colour(w.boxBg);
    if (background) { parts.push(`background:${background}`); cssVar("--sd-w-bg", background); }
    const foreground = colour(w.boxFg);
    if (foreground) { parts.push(`color:${foreground}`); cssVar("--sd-w-fg", foreground); }
    const label = colour(w.labelColor) ?? foreground;
    if (label) cssVar("--sd-w-label", label);

    const borderColour = colour(w.boxBorder);
    const borderWidth = px(w.boxBorderWidth) ?? "1px";
    const borderStyle = choose(w.boxBorderStyle, ["solid","dashed","dotted","double","none"]) || "solid";
    if (borderColour && w.type !== "image") {
      parts.push(`border:${borderWidth} ${borderStyle} ${borderColour}`);
      cssVar("--sd-w-bd", borderColour);
    } else if (w.boxBorderStyle === "none") parts.push("border:none");
    const radius = px(w.boxRadius); if (radius) parts.push(`border-radius:${radius}`);
    const padding = px(w.boxPad); if (padding) parts.push(`padding:${padding}`);
    const margin = px(w.boxMargin); if (margin) parts.push(`margin:${margin}`);
    const gap = px(w.boxGap); if (gap) parts.push(`gap:${gap}`);

    const fontSize = px(w.fontSize); if (fontSize) parts.push(`font-size:${fontSize}`);
    const labelFontSize = px(w.labelFontSize); if (labelFontSize) cssVar("--sd-widget-label-size", labelFontSize);
    const fontWeight = number(w.fontWeight); if (fontWeight !== null) parts.push(`font-weight:${Math.max(100, Math.min(900, fontWeight))}`);
    const textAlign = choose(w.textAlign, ["left","center","right"]); if (textAlign) parts.push(`text-align:${textAlign}`);
    const contentAlign = choose(w.contentAlign, ["start","center","end","stretch"]);
    if (contentAlign) parts.push(`align-items:${contentAlign === "start" ? "flex-start" : contentAlign === "end" ? "flex-end" : contentAlign}`);
    const opacity = number(w.opacity); if (opacity !== null) parts.push(`opacity:${Math.max(0, Math.min(1, opacity))}`);
    let overflow = choose(w.overflow, ["visible","hidden","auto","scroll"]);
    if (!overflow && height && ["inventory","effects","spellbook","richtext","cardHand","widgetBuilder","vsection"].includes(w.type)) overflow = "auto";
    if (overflow) parts.push(`overflow:${overflow}`);

    cssVar("--sd-w-bar-h",     px(w.barH));
    cssVar("--sd-w-bar-track", colour(w.barTrack));
    cssVar("--sd-w-btn-bg",    colour(w.btnBg));
    cssVar("--sd-w-btn-fg",    colour(w.btnFg));
    cssVar("--sd-w-btn-bd",    colour(w.btnBorder));
    cssVar("--sd-w-icon",      colour(w.iconColor));
    cssVar("--sd-widget-icon-color", colour(w.iconColor));
    cssVar("--sd-widget-icon-size", px(w.iconSize));
    cssVar("--sd-w-num-btn",   colour(w.btnColor));
    cssVar("--sd-w-on",        colour(w.onColor));
    cssVar("--sd-w-off",       colour(w.offColor));
    cssVar("--sd-w-line",      colour(w.lineColor));
    cssVar("--sd-w-title",     colour(w.titleColor));
    cssVar("--sd-w-line-th",   px(w.lineThickness));
    cssVar("--sd-w-pip-size",  px(w.pipSize));
    cssVar("--sd-w-pip-bd",    px(w.pipBorder));
    cssVar("--sd-w-empty",     colour(w.emptyColor));
    cssVar("--sd-w-header",    colour(w.headerColor));
    cssVar("--sd-w-tag-fg",    colour(w.tagFg));
    cssVar("--sd-w-bw",        px(w.borderWidth));
    cssVar("--sd-tile-size",   px(w.tileSize));
    return parts.join(";");
  }

  static _decorateWidgetLabel(html, widget) {
    const emoji = String(widget?.labelEmoji ?? "").slice(0, 16);
    const iconRaw = String(widget?.labelIcon ?? "").trim();
    if (!emoji && !iconRaw) return html;
    const icon = iconRaw ? `<i class="${this._esc(this._faClass(iconRaw, "fas"))}"></i>` : "";
    const decoration = `<span class="sd-widget-label-deco">${emoji ? `<span aria-hidden="true">${this._esc(emoji)}</span>` : ""}${icon}</span>`;
    const labelClasses = new Set(["widget-label","skill-name","sec-title","vsection-title","sd-wb-title"]);
    const candidates = [...String(html).matchAll(/<(div|span|label|h[1-6])\b[^>]*class="([^"]*)"[^>]*>/gi)];
    const target = candidates.find(match => match[2].split(/\s+/).some(name => labelClasses.has(name)));
    if (target) {
      const openEnd = target.index + target[0].length;
      if (String(widget.labelIconPosition ?? "before") === "after") {
        const close = `</${target[1].toLowerCase()}>`;
        const closeAt = html.toLowerCase().indexOf(close, openEnd);
        if (closeAt >= 0) return html.slice(0, closeAt) + decoration + html.slice(closeAt);
      }
      return html.slice(0, openEnd) + decoration + html.slice(openEnd);
    }
    const button = String(html).match(/<button\b[^>]*class="[^"]*(?:sd-action-btn|dice-btn)[^"]*"[^>]*>/i);
    if (button) {
      const at = button.index + button[0].length;
      return html.slice(0, at) + decoration + html.slice(at);
    }
    const root = String(html).match(/^<[^>]+>/);
    if (!root) return html;
    return root[0] + decoration + html.slice(root[0].length);
  }

  static _esc(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;").replace(/"/g, "&quot;")
      .replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  static _escAllowFaIcon(val) {
    const s = String(val ?? "");
    if (!s) return "";
    const reIcon = /^\s*<i\s+class\s*=\s*"((?:fa|fas|far|fab|fad|fal|fat)\s+fa-[a-z0-9-]+)"(?:\s+style\s*=\s*"([^"<>]{0,120})")?\s*>\s*<\/i>\s*$/i;
    const m = reIcon.exec(s);
    if (m) {
      const cls = m[1];
      let safeStyle = "";
      if (m[2]) {
        const parts = m[2].split(";").map(p => p.trim()).filter(Boolean);
        const kept = [];
        for (const p of parts) {
          if (/^color\s*:\s*(?:#[0-9a-f]{3,8}|rgb[a]?\([\d.\s,%]+\)|[a-z]+)$/i.test(p)) kept.push(p);
          else if (/^font-size\s*:\s*\d{1,3}px$/i.test(p)) kept.push(p);
        }
        if (kept.length) safeStyle = ` style="${kept.join(";")}"`;
      }
      return `<i class="${cls}"${safeStyle}></i>`;
    }
    return this._esc(s);
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

  static _copyBtn() { return ""; }

  static _render_text(w, doc) {
    const val  = this._getValue(w, doc, "");
    const esc  = this._esc;
    const hasFormula = w.valueFormula && FormulaEngine.isFormula(w.valueFormula);
    const isReadOnly = w.readOnly === true || w.readOnly === "true";
    if (hasFormula) {
      return `<div class="widget widget-text">
  <div class="widget-label">${esc(w.label)} <span style="color:var(--sd-accent-2);font-size:9px" title="Formula: ${esc(w.valueFormula)}">ƒ</span></div>
  <div class="widget-formula-val">${this._escAllowFaIcon(val)}</div>
</div>`;
    }
    if (isReadOnly) {
      return `<div class="widget widget-text widget-text--readonly">
  <div class="widget-label">${esc(w.label)} <span style="color:var(--sd-text-3);font-size:9px;margin-left:2px" title="Read only">🔒</span></div>
  <div class="widget-text-readonly-val" style="background:var(--sd-w-bg,var(--sd-bg-2));border:1px solid var(--sd-w-bd,var(--sd-bg-3));border-radius:4px;padding:3px 7px;font-size:12px;color:var(--sd-w-fg,var(--sd-text-3));min-height:22px;word-break:break-word">${this._escAllowFaIcon(val)}</div>
</div>`;
    }
    return `<div class="widget widget-text">
  <div class="widget-label" style="display:flex;align-items:center">${esc(w.label)}${w.path ? this._copyBtn(w.path, "text value") : ""}</div>
  <input type="text" name="${esc(this._bindingPath(w.path))}" value="${esc(val)}">
</div>`;
  }

  static _render_number(w, doc) {
    const e   = this._esc;
    const nodeMode = w.numberMode === "node";
    const val = nodeMode && w.path ? this._get(doc, w.path, 0) : this._getValue(w, doc, 0);
    const hasFormula = !nodeMode && w.valueFormula && FormulaEngine.isFormula(w.valueFormula);
    if (hasFormula) {
      return `<div class="widget widget-number">
  <div class="widget-label">${e(w.label)} <span style="color:var(--sd-accent-2);font-size:9px" title="Formula: ${e(w.valueFormula)}">ƒ</span></div>
  <div class="widget-formula-val" style="font-size:18px;font-weight:700;text-align:center">${e(String(val))}</div>
</div>`;
    }
    const minVal  = this._numberSpec(nodeMode ? w.minFormula  : w.min,  doc, "", { allowBlank: true });
    const maxVal  = this._numberSpec(nodeMode ? w.maxFormula  : w.max,  doc, "", { allowBlank: true });
    let stepVal   = this._numberSpec(nodeMode ? w.stepFormula : w.step, doc, 1);
    stepVal = Math.abs(Number(stepVal));
    if (!Number.isFinite(stepVal) || stepVal <= 0) stepVal = 1;
    const minAttr  = Number.isFinite(Number(minVal)) ? String(Number(minVal)) : "";
    const maxAttr  = Number.isFinite(Number(maxVal)) ? String(Number(maxVal)) : "";
    const stepAttr = String(stepVal);
    return `<div class="widget widget-number">
  <div class="widget-label" style="display:flex;align-items:center">${e(w.label)}${w.path ? this._copyBtn(w.path, "number value") : ""}</div>
  <div class="num-row">
    <button type="button" class="num-btn" data-action="widgetNumStep"
            data-path="${e(this._bindingPath(w.path))}" data-step="-${e(stepAttr)}"
            data-min="${e(minAttr)}" data-max="${e(maxAttr)}">−</button>
    <input type="number" name="${e(this._bindingPath(w.path))}" data-path="${e(this._bindingPath(w.path))}" value="${Number.isFinite(Number(val)) ? Number(val) : ""}"
           min="${e(minAttr)}" max="${e(maxAttr)}" step="${e(stepAttr)}">
    <button type="button" class="num-btn" data-action="widgetNumStep"
            data-path="${e(this._bindingPath(w.path))}" data-step="${e(stepAttr)}"
            data-min="${e(minAttr)}" data-max="${e(maxAttr)}">+</button>
  </div>
</div>`;
  }

  static _render_resource(w, doc) {
    const nodeMode = w.resourceMode === "node";
    const val      = (n => Number.isFinite(n) ? n : 0)(Number(this._get(doc, w.pathValue, 0)));
    const max      = (n => Number.isFinite(n) ? n : 0)(Number(nodeMode ? this._numberSpec(w.maxFormula, doc, 0) : this._get(doc, w.pathMax, 0)));
    const minB     = nodeMode ? (n => Number.isFinite(n) ? n : 0)(Number(this._numberSpec(w.minFormula, doc, 0))) : 0;
    const ratioRaw = (max - minB) > 0 ? (val - minB) / (max - minB) : 0;
    const pct      = max > 0 ? Math.round(Math.clamp(ratioRaw, 0, 1) * 100) : 0;
    const pctReal  = max > 0 ? Math.round(ratioRaw * 100) : 0;
    const color    = w.color ?? "var(--sd-accent)";
    const e        = this._esc;
    const barH     = Number(w.barH) > 0 ? `${Number(w.barH)}px` : "";
    const barTrk   = (typeof w.barTrack === "string" && w.barTrack.trim()) ? w.barTrack.trim() : "";
    const barStyle = [barH ? `height:${barH}` : "", barTrk ? `background:${e(barTrk)}` : ""].filter(Boolean).join(";");

    const variant   = String(w.variant || "default");
    const isPulse   = variant === "pulse";
    const isOrb     = variant === "orb";
    const display   = isPulse
      ? this._renderResourcePulseBody(pctReal, barH)
      : isOrb
        ? this._renderResourceOrbBody(val, max, pctReal, color)
        : `<div class="res-bar"${barStyle ? ` style="${barStyle}"` : ""}><div class="res-bar-fill" style="width:${pct}%;background:${e(color)}"></div></div>`;

    const pulseH    = barH || "56px";
    let outerStyle = "";
    if (isPulse) {
      outerStyle = ` style="--sd-pulse-color:${this._pulseColor(pctReal)};--sd-pulse-dur:${this._pulseDuration(pctReal)}ms;--sd-pulse-tremor:${this._pulseTremor(pctReal)}px;--sd-pulse-h:${pulseH}"`;
    } else if (isOrb) {
      const theme = this._orbTheme(color);

      const numOrNull = (v) => {
        const n = Number(v);
        return Number.isFinite(n) && n > 0 ? n : null;
      };
      const sizeFromBar = numOrNull(w.barH);
      const sizeFromBox = numOrNull(w.boxW);
      let orbSize;
      if (sizeFromBar !== null && sizeFromBox !== null) {

        orbSize = Math.min(sizeFromBar, sizeFromBox);
      } else {
        orbSize = sizeFromBar ?? sizeFromBox ?? 200;
      }

      orbSize = Math.max(40, Math.min(800, Math.round(orbSize)));
      outerStyle = ` style="--sd-orb-fill:${theme.fill};--sd-orb-fill2:${theme.fill2};--sd-orb-base:${theme.base};--sd-orb-glow:${theme.glow};--sd-orb-glow2:${theme.glow2};--sd-orb-shimmer:${theme.shimmer};--sd-orb-size:${orbSize}px"`;
    }

    return `<div class="widget widget-resource"${outerStyle}>
  <div class="widget-label" style="display:flex;align-items:center">${e(w.label)}${w.pathValue ? this._copyBtn(w.pathValue, "value") : ""}${w.pathMax ? this._copyBtn(w.pathMax, "max") : ""}</div>
  <div class="res-row">
    <input type="number" name="${e(this._bindingPath(w.pathValue))}" data-path="${e(this._bindingPath(w.pathValue))}" value="${e(val)}" class="res-val">
    <span class="res-sep">/</span>
    <input type="number" name="${e(this._bindingPath(w.pathMax))}" data-path="${e(this._bindingPath(w.pathMax))}" value="${e(max)}" class="res-max">
  </div>
  ${display}
</div>`;
  }

  static _renderResourceOrbBody(val, max, pctReal, color) {
    const e        = this._esc;
    const safeColor = e(color);
    const clamped = Math.max(0, Math.min(100, pctReal));
    const ratio   = clamped / 100;
    const r       = 76;
    const topY    = 100 - r;
    const botY    = 100 + r;
    const surfaceY = botY - ratio * (botY - topY);
    const fillY    = Math.max(24, surfaceY - 2);
    const fillH    = Math.max(0, 176 - (fillY - 24));
    const coreY    = Math.max(40, Math.min(145, surfaceY - 15));
    const coreRx   = (18 + 20 * ratio).toFixed(1);
    const coreRy   = (10 + 18 * ratio).toFixed(1);
    const coreOp   = (0.12 + 0.25 * ratio).toFixed(3);
    const shimY    = (surfaceY - 12).toFixed(1);
    const shimOp   = (0.08 + 0.12 * ratio).toFixed(3);

    const uid = `o${Math.floor(Math.random() * 1e9).toString(36)}`;

    let orn = "";
    for (let i = 0; i < 12; i++) {
      const a  = (i / 12) * Math.PI * 2 - Math.PI / 2;
      const ox = (100 + Math.cos(a) * 92).toFixed(2);
      const oy = (100 + Math.sin(a) * 92).toFixed(2);
      const rr = i % 3 === 0 ? 3 : 1.8;
      const cf = i % 3 === 0 ? "#8a6840" : "#4a3820";
      orn += `<circle cx="${ox}" cy="${oy}" r="${rr}" fill="${cf}"/>`;
    }

    const showVal = Number.isFinite(val) ? Math.round(val) : 0;
    const showMax = Number.isFinite(max) ? Math.round(max) : 0;
    const flatLine = clamped <= 0 ? 1 : 0;

    return `<div class="res-orb" data-orb-empty="${flatLine}">
  <svg class="res-orb-svg" viewBox="0 0 200 200" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
    <defs>
      <clipPath id="${uid}-clip"><circle cx="100" cy="100" r="76"/></clipPath>
      <radialGradient id="${uid}-rim" cx="40%" cy="35%" r="60%">
        <stop offset="0%" stop-color="#555555" stop-opacity="0.6"/>
        <stop offset="100%" stop-color="#111111" stop-opacity="1"/>
      </radialGradient>
      <radialGradient id="${uid}-shine" cx="35%" cy="28%" r="45%">
        <stop offset="0%" stop-color="#ffffff" stop-opacity="0.35"/>
        <stop offset="60%" stop-color="#ffffff" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="${uid}-depth" cx="60%" cy="70%" r="55%">
        <stop offset="0%" stop-color="#000000" stop-opacity="0.5"/>
        <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <circle cx="100" cy="100" r="95" fill="#1a1a1a" stroke="#3a3028" stroke-width="1"/>
    <circle cx="100" cy="100" r="91" fill="none" stroke="#5a4a38" stroke-width="2.5"/>
    <circle cx="100" cy="100" r="88" fill="none" stroke="#2a1e18" stroke-width="2"/>
    <circle cx="100" cy="100" r="85" fill="none" stroke="#6a5040" stroke-width="1"/>
    <g class="res-orb-ornaments">${orn}</g>
    <circle cx="100" cy="100" r="77" fill="#0d0608"/>
    <g clip-path="url(#${uid}-clip)">
      <rect class="res-orb-base" x="24" y="24" width="152" height="152" fill="var(--sd-orb-base, #1a0000)"/>
      <rect class="res-orb-fill" x="22" y="${fillY.toFixed(2)}" width="156" height="${fillH.toFixed(2)}" fill="var(--sd-orb-fill, ${safeColor})"/>
      <g class="res-orb-wave" transform="translate(0 ${surfaceY.toFixed(2)})">
        <path class="res-orb-wave-path" d="${this._buildOrbWavePath(0)}" fill="var(--sd-orb-fill2, ${safeColor})" opacity="0.7"/>
        <path class="res-orb-wave-path res-orb-wave-path-2" d="${this._buildOrbWavePath(Math.PI / 2)}" fill="var(--sd-orb-fill2, ${safeColor})" opacity="0.45"/>
      </g>
      <ellipse class="res-orb-core" cx="100" cy="${coreY.toFixed(1)}" rx="${coreRx}" ry="${coreRy}" fill="var(--sd-orb-shimmer, #ff6655)" opacity="${coreOp}"/>
      <rect x="22" y="22" width="156" height="156" fill="url(#${uid}-depth)"/>
      <ellipse class="res-orb-shimmer" cx="100" cy="${shimY}" rx="30" ry="3" fill="#ffffff" opacity="${shimOp}"/>
    </g>
    <circle cx="100" cy="100" r="77" fill="url(#${uid}-rim)"/>
    <circle cx="100" cy="100" r="77" fill="url(#${uid}-shine)"/>
    <circle cx="100" cy="100" r="77" fill="none" stroke="#aa8855" stroke-width="1.5"/>
    <circle cx="100" cy="100" r="74" fill="none" stroke="#442200" stroke-width="1"/>
  </svg>
  <div class="res-orb-text">${showVal} / ${showMax}</div>
</div>`;
  }

  static _buildOrbWavePath(phase) {
    const steps = 40, x0 = -12, x1 = 212, amp = 4.8;
    let d = `M ${x0} 0`;
    for (let i = 0; i <= steps; i++) {
      const x = x0 + (x1 - x0) * (i / steps);
      const a = (i / steps) * Math.PI * 5 + phase;
      const y = (Math.sin(a) * amp).toFixed(2);
      d += ` L ${x.toFixed(2)} ${y}`;
    }
    d += ` L ${x1} 200 L ${x0} 200 Z`;
    return d;
  }

  static _orbTheme(color) {
    const c = String(color ?? "").toLowerCase().trim();
    const PRESETS = {
      blood:  { fill: "#cc2222", fill2: "#dd3333", base: "#1a0000", glow: "#aa2222", glow2: "#660000", shimmer: "#ff6655" },
      mana:   { fill: "#2244cc", fill2: "#3355dd", base: "#00001a", glow: "#2244bb", glow2: "#001166", shimmer: "#66aaff" },
      poison: { fill: "#33aa22", fill2: "#44bb33", base: "#001a00", glow: "#33aa22", glow2: "#115500", shimmer: "#88ff66" },
      golden: { fill: "#cc8811", fill2: "#ddaa22", base: "#1a1000", glow: "#ccaa22", glow2: "#664400", shimmer: "#ffe080" },
      soul:   { fill: "#9922cc", fill2: "#aa33dd", base: "#0f0018", glow: "#9922cc", glow2: "#330055", shimmer: "#dd88ff" },
      ice:    { fill: "#2288aa", fill2: "#33aacc", base: "#00101a", glow: "#2299bb", glow2: "#003355", shimmer: "#aaeeff" }
    };
    if (PRESETS[c]) return PRESETS[c];

    const rgb = this._parseColor(c);
    if (!rgb) return PRESETS.blood;

    const [r, g, b] = rgb;
    const hex2 = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
    const mk   = (rr, gg, bb) => `#${hex2(rr)}${hex2(gg)}${hex2(bb)}`;

    return {
      fill:    mk(r,            g,            b),
      fill2:   mk(r * 0.55 + 100, g * 0.55 + 100, b * 0.55 + 100),
      base:    mk(r * 0.12,     g * 0.12,     b * 0.12),
      glow:    mk(r * 0.82,     g * 0.82,     b * 0.82),
      glow2:   mk(r * 0.35,     g * 0.35,     b * 0.35),
      shimmer: mk(r * 0.5 + 140, g * 0.5 + 140, b * 0.5 + 140)
    };
  }

  static _parseColor(c) {
    const s = String(c ?? "").trim().toLowerCase();
    if (!s) return null;
    let m = s.match(/^#([0-9a-f]{6})$/);
    if (m) return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)];
    m = s.match(/^#([0-9a-f]{3})$/);
    if (m) return [parseInt(m[1][0] + m[1][0], 16), parseInt(m[1][1] + m[1][1], 16), parseInt(m[1][2] + m[1][2], 16)];
    m = s.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
    if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
    return null;
  }

  static _renderResourcePulseBody(pctReal, barH) {
    const dead     = pctReal <= 0          ? 1 : 0;
    const critical = pctReal > 0 && pctReal <= 30 ? 1 : 0;
    const heightPx = barH || "56px";
    const path     = this._buildPulsePath(pctReal);

    return `<div class="res-pulse" data-pulse-dead="${dead}" data-pulse-critical="${critical}" data-pulse-pct="${pctReal}" style="height:${heightPx}">
      <div class="res-pulse-tremor">
        <svg class="res-pulse-svg" viewBox="0 0 120 60" preserveAspectRatio="none" aria-hidden="true">
          <g class="res-pulse-scroll">
            <path class="res-pulse-line" d="${path}"></path>
            <path class="res-pulse-line" d="${path}" transform="translate(60,0)"></path>
            <path class="res-pulse-line" d="${path}" transform="translate(120,0)"></path>
          </g>
        </svg>
      </div>
    </div>`;
  }

  static _buildPulsePath(pct) {
    const W = 60, BASE = 30;
    const clamped = Math.max(0, Math.min(120, pct));
    if (clamped <= 0) return `M0,${BASE} L${W},${BASE}`;

    let seed = (Math.floor(clamped * 137.59) || 1) >>> 0;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

    const low      = Math.max(0, Math.min(1, (100 - clamped) / 100));      
    const beats    = clamped >= 70 ? 1 : clamped >= 30 ? 2 : 3;            
    const noiseAmp = 0.3 + low * 3.2;                                       
    const peakAmp  = 14 + low * 13;                                         
    const sNoise   = 0.4 + low * 1.3;                                       

    const segW = W / beats;
    const out  = [`M0,${BASE.toFixed(2)}`];
    let   x    = 0;

    const pushLine = (nx, ny) => out.push(`L${nx.toFixed(2)},${ny.toFixed(2)}`);
    const pushQ    = (cx, cy, nx, ny) => out.push(`Q${cx.toFixed(2)},${cy.toFixed(2)} ${nx.toFixed(2)},${ny.toFixed(2)}`);

    for (let b = 0; b < beats; b++) {
      const beatEnd  = (b + 1) * segW;

      const spikeAt  = b * segW + segW * (0.40 + rnd() * 0.20);
      const ampVar   = peakAmp * (0.75 + rnd() * 0.55);

      const stutter  = low > 0.55 && rnd() < 0.4;

      while (x < spikeAt - 6) {
        const step = 1.2 + rnd() * 1.6;
        const nx   = Math.min(spikeAt - 6, x + step);
        const ny   = BASE + (rnd() - 0.5) * noiseAmp;
        pushLine(nx, ny);
        x = nx;
      }
      pushLine(spikeAt - 5, BASE);
      x = spikeAt - 5;

      const px = x + 1.6;
      pushQ(x + 0.8, BASE - 1.6 - rnd() * 1.2, px, BASE);
      x = px;

      if (stutter) {
        x += 0.6; pushLine(x, BASE + 0.4);
        x += 0.5; pushLine(x, BASE - ampVar * 0.45);
        x += 0.6; pushLine(x, BASE + ampVar * 0.30);
        x += 0.8; pushLine(x, BASE);
      }

      x += 0.7; pushLine(x, BASE + 0.6 + rnd() * 0.8);            
      x += 0.5; pushLine(x, BASE - ampVar);                       
      x += 0.6; pushLine(x, BASE + ampVar * (0.45 + sNoise * 0.15)); 
      x += 1.0; pushLine(x, BASE);                                

      const tx = x + 2.2;
      pushQ(x + 1.1, BASE - 1.8 - rnd() * 1.8, tx, BASE);
      x = tx;

      while (x < beatEnd - 1) {
        const step = 1.1 + rnd() * 1.5;
        const nx   = Math.min(beatEnd - 1, x + step);
        const ny   = BASE + (rnd() - 0.5) * noiseAmp;
        pushLine(nx, ny);
        x = nx;
      }

      pushLine(beatEnd, BASE);
      x = beatEnd;
    }

    if (x < W) pushLine(W, BASE);
    return out.join(" ");
  }

  static _pulseColor(pct) {
    const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * Math.max(0, Math.min(1, t))));
    const rgb = (arr) => `rgb(${arr[0]},${arr[1]},${arr[2]})`;
    const GREEN  = [ 54, 255, 122];
    const YELLOW = [255, 216,  77];
    const RED    = [255,  68,  68];
    const DEAD   = [120,  18,  18];
    if (pct >= 100) return rgb(GREEN);
    if (pct >= 50)  return rgb(mix(GREEN,  YELLOW, (100 - pct) / 50));
    if (pct >= 30)  return rgb(mix(YELLOW, RED,    (50  - pct) / 20));
    if (pct > 0)    return rgb(mix(RED,    DEAD,   (30  - pct) / 30));
    return rgb(DEAD);
  }

  static _pulseDuration(pct) {
    if (pct <= 0)   return 4000;
    if (pct >= 100) return 1200;
    if (pct >= 50)  return Math.round(1200 - (100 - pct) * 6);
    if (pct >= 30)  return Math.round(900  - (50  - pct) * 14);
    return Math.max(280, Math.round(620 - (30 - pct) * 8));
  }

  static _pulseTremor(pct) {
    if (pct >= 60) return 0;
    if (pct >= 30) return +((60 - pct) / 30 * 1.4).toFixed(2);
    if (pct > 0)   return +(1.4 + (30 - pct) / 30 * 3.2).toFixed(2);
    return 0;
  }

  /** Removed widget. Legacy sheets fall back to a plain button until migration runs. */
  static _render_dice(w, doc) {
    return this._render_button({ ...w, type: "button", icon: w.icon ?? "fa-dice-d20" }, doc);
  }

  static _render_button(w, doc) {
    const e       = this._esc;
    const accent  = w.btnBg || "var(--sd-accent)";
    const fgColor = w.btnFg || accent;
    const bdColor = w.boxBorder || accent;
    const iconCol = w.iconColor || fgColor;
    const iconCls = this._faClass(w.icon ?? "fa-bolt");
    const bg      = w.btnBg ? e(w.btnBg) : `${e(accent)}22`;
    return `<div class="widget widget-button">
  <button type="button" class="sd-action-btn" data-action="widgetButton"
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
       data-path="${e(this._bindingPath(w.path))}" data-value="${val}" style="cursor:pointer">
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

    const variantId = this._sanitizeVariant(w.variant);
    if (variantId === "tile") {
      return this._render_slot_tile(w, doc, contents, max, def);
    }

    const e = this._esc;
    const items = contents.map((c, i) => `
      <li class="slot-mini-item" draggable="true" data-slot-item-drag data-sd-preview-ref="slot" data-slot-id="${e(w.slotId)}" data-slot-index="${i}" data-item-id="${e(c._id ?? "")}" data-item-uuid="${e(c._sourceUuid ?? c.uuid ?? "")}">
        <img class="slot-mini-img" src="${e(c.img ?? "icons/svg/item-bag.svg")}" alt="${e(c.name ?? "")}">
        <span>${e(c.name ?? "")}</span>
        <button type="button" class="slot-item-use item-use-btn" data-action="slotItemUse" data-slot-id="${e(w.slotId)}" data-slot-index="${i}" title="Use">
          <i class="fas fa-play"></i>
        </button>
        <button type="button" class="slot-item-edit" data-action="slotItemEdit" data-slot-id="${e(w.slotId)}" data-slot-index="${i}" data-item-id="${e(c._id ?? "")}" data-item-uuid="${e(c._sourceUuid ?? c.uuid ?? "")}" title="Edit">
          <i class="fas fa-pen"></i>
        </button>
        ${(c.type === "inventory" && c.system?.equippable) ? `<button type="button" class="slot-item-equip${c.system?.equipped ? " on" : ""}" data-action="itemEquip" data-slot-id="${e(w.slotId)}" data-slot-index="${i}" data-item-id="${e(c._id ?? "")}" title="${c.system?.equipped ? "Unequip" : "Equip"}"><i class="fas ${c.system?.equipped ? "fa-shield-halved" : "fa-shield"}"></i></button>` : ""}
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
        rows += `<li class="sd-hud-pop-row" draggable="true" data-slot-item-drag data-sd-preview-ref="slot" data-slot-id="${slotId}" data-slot-index="${i}" data-item-id="${itemId}" data-item-uuid="${itemUuid}">
          <img src="${img}" alt="${nm}">
          <span class="sd-hud-pop-name" title="${nm}">${nm}</span>
          <button type="button" data-action="slotItemUse" data-slot-id="${slotId}" data-slot-index="${i}" title="Use"><i class="fas fa-play"></i></button>
          <button type="button" data-action="slotItemEdit" data-slot-id="${slotId}" data-slot-index="${i}" data-item-id="${itemId}" data-item-uuid="${itemUuid}" title="Edit"><i class="fas fa-pen"></i></button>
          ${(c.type === "inventory" && c.system?.equippable) ? `<button type="button" class="sd-hud-pop-btn-equip${c.system?.equipped ? " is-on" : ""}" data-action="itemEquip" data-slot-id="${slotId}" data-slot-index="${i}" data-item-id="${itemId}" title="${c.system?.equipped ? "Unequip" : "Equip"}"><i class="fas ${c.system?.equipped ? "fa-shield-halved" : "fa-shield"}"></i></button>` : ""}
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
      icons += `<button type="button" class="slot-hud-icon" draggable="true" data-slot-item-drag data-sd-preview-ref="slot" data-action="slotItemUse" data-slot-id="${slotId}" data-slot-index="${i}" data-item-id="${itemId}" data-item-uuid="${itemUuid}" title="${nm}">
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

  static _render_slot_tile(w, doc, contents, max, def) {
    const e          = this._esc;
    const slotId     = e(w.slotId);
    const lbl        = e(w.label || def?.label || "Slot");
    const wAccentRaw = String(w.accentColor ?? "").trim();
    const accentRaw  = wAccentRaw || String(def?.accentColor ?? "").trim();
    const accent     = accentRaw || "";
    const accentVar  = accent ? e(accent) : "var(--sd-accent)";
    const wPhRaw     = String(w.placeholderIcon ?? "").trim();
    const phRaw      = wPhRaw || String(def?.placeholderIcon ?? "").trim();
    const placeholder= e(phRaw || "icons/svg/item-bag.svg");
    const hasPh      = !!phRaw;
    const countTxt   = `${contents.length}/${max}`;

    let tiles = "";
    for (let i = 0; i < max; i++) {
      const c       = contents[i];
      const filled  = !!c;
      const img     = filled ? e(c.img ?? "icons/svg/item-bag.svg") : placeholder;
      const nm      = filled ? e(c.name ?? "") : "Empty";
      const itemId  = filled ? e(c._id ?? "") : "";
      const itemUid = filled ? e(c._sourceUuid ?? c.uuid ?? "") : "";

      const previewAttrs = filled
        ? `draggable="true" data-slot-item-drag data-sd-preview-ref="slot" data-slot-id="${slotId}" data-slot-index="${i}" data-item-id="${itemId}" data-item-uuid="${itemUid}"`
        : "";
      const tileStyle = `style="--sd-tile-accent:${accentVar}"`;
      const innerImgCls = filled ? "sd-slot-tile-img sd-slot-tile-img-filled" : `sd-slot-tile-img sd-slot-tile-img-ph${hasPh ? "" : " sd-slot-tile-img-ph-fallback"}`;

      const dropAttr = filled ? "" : `data-sd-slot-drop="${slotId}"`;
      tiles += `<div class="sd-slot-tile-wrap" data-slot-idx="${i}">
        <div class="sd-slot-tile${filled ? ' sd-slot-tile-filled' : ' sd-slot-tile-empty'}" ${dropAttr} ${previewAttrs} ${tileStyle} title="${nm}">
          <span class="sd-slot-tile-corner sd-slot-tile-corner-tl"></span>
          <span class="sd-slot-tile-corner sd-slot-tile-corner-tr"></span>
          <span class="sd-slot-tile-corner sd-slot-tile-corner-bl"></span>
          <span class="sd-slot-tile-corner sd-slot-tile-corner-br"></span>
          <img class="${innerImgCls}" src="${img}" alt="${nm}" draggable="false">
          ${filled ? "" : `<span class="sd-slot-tile-drop-hint"><i class="fas fa-arrow-down-to-line"></i></span>`}
        </div>
        <div class="sd-slot-tile-btns">
          ${filled
            ? `<button type="button" class="sd-slot-tile-btn" data-action="slotItemUse" data-slot-id="${slotId}" data-slot-index="${i}" title="Use"><i class="fas fa-play"></i></button>
               <button type="button" class="sd-slot-tile-btn" data-action="slotItemEdit" data-slot-id="${slotId}" data-slot-index="${i}" data-item-id="${itemId}" data-item-uuid="${itemUid}" title="Edit"><i class="fas fa-pen"></i></button>
               ${(c.type === "inventory" && c.system?.equippable) ? `<button type="button" class="sd-slot-tile-btn${c.system?.equipped ? " sd-slot-tile-btn-on" : ""}" data-action="itemEquip" data-slot-id="${slotId}" data-slot-index="${i}" data-item-id="${itemId}" title="${c.system?.equipped ? "Unequip" : "Equip"}"><i class="fas ${c.system?.equipped ? "fa-shield-halved" : "fa-shield"}"></i></button>` : ""}
               <button type="button" class="sd-slot-tile-btn sd-slot-tile-btn-danger" data-sd-slot-remove="${slotId}" data-sd-slot-idx="${i}" title="Remove"><i class="fas fa-times"></i></button>`
            : `<span class="sd-slot-tile-empty-label">${lbl}</span>`}
        </div>
      </div>`;
    }

    const slotContentsPath = `system.slotContents.${w.slotId}.contents`;
    return `<div class="widget widget-slot widget-slot-tile">
  <div class="widget-label sd-slot-tile-header">
    <span class="sd-slot-tile-title">${lbl}</span>
    <span class="sd-slot-tile-count">${countTxt}</span>
    ${this._copyBtn(slotContentsPath, "contents array")}
  </div>
  <div class="sd-slot-tile-grid">${tiles}</div>
</div>`;
  }

  /** Accepted values of a widget filter (list or comma separated text). */
  static _sdAcceptedList(value) {
    return databaseValueList(value ?? []);
  }

  /**
   * Values of the filter variable on one item.
   * Uses the selected Database variable, falling back to the legacy field.
   */
  static _sdFilterValues(item, variableId, legacyValue) {
    const id = String(variableId ?? "").trim();
    if (id) {
      const resolved = getValueDefinition(id)?.id || variableIdForLegacyPath(id) || id;
      const list = readDatabaseValueList(item, resolved);
      if (list.length) return list;
    }
    return databaseValueList(legacyValue);
  }

  /** True when at least one accepted value matches the item's variable value. */
  static _sdFilterMatches(item, variableId, legacyValue, accepted) {
    const wanted = this._sdAcceptedList(accepted).map(entry => entry.toLowerCase());
    if (!wanted.length) return true;
    const own = this._sdFilterValues(item, variableId, legacyValue).map(entry => entry.toLowerCase());
    if (!own.length) return false;
    return own.some(entry => wanted.includes(entry));
  }

  /**
   * Extra columns of a widget as [{id,label,variable}].
   * Database variables are preferred; legacy hidden field names still work.
   */
  static _sdExtraColumns(w) {
    const pick = value => (Array.isArray(value) ? value : String(value ?? "").split(","))
      .map(entry => String(entry ?? "").trim()).filter(Boolean);
    const cols = [];
    for (const entry of pick(w?.columnVariables)) {
      const def = getValueDefinition(entry) ?? getValueDefinition(variableIdForLegacyPath(entry));
      cols.push(def ? { id: def.id, label: def.name, type: def.type, variable: true } : { id: entry, label: entry, variable: false });
    }
    if (cols.length) return cols;
    return pick(w?.columns).map(entry => ({ id: entry, label: entry, variable: false }));
  }

  /** Text of one extra column for a document. */
  static _sdColumnValue(col, item) {
    if (col?.variable) return databaseValueToText(readDatabaseValue(item, col.id));
    const legacy = item?.system?.hiddenFields?.[col?.id] ?? item?.system?.[col?.id] ?? "";
    return databaseValueToText(legacy);
  }

  static _render_inventory(w, doc) {
    const e = this._esc;
    const isActor = doc instanceof Actor;
    if (!isActor) return `<div class="widget widget-inventory"><p style="color:var(--sd-text-3)">Inventory widget only works on Actor sheets</p></div>`;

    let items = [...(doc.items ?? [])].filter(item => item.type === "inventory");
    const categories = this._sdAcceptedList(w.categories);
    const columns = this._sdExtraColumns(w);

    if (categories.length > 0) {
      items = items.filter(item => this._sdFilterMatches(item, w.categoryVariable, item.system?.category, categories));
    }

    if (w.compact) {
      return this._render_inventory_compact(w, doc, items);
    }

    const variantId = this._sanitizeVariant(w.variant);
    if (variantId === "card-slider" || variantId === "card-grid") {
      return this._render_inventory_cards(w, doc, items, variantId, columns);
    }

    const grouped = {};
    items.forEach(item => {
      const cat = this._sdFilterValues(item, w.categoryVariable, item.system?.category)[0] ?? "other";
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(item);
    });

    let colHeaders = "";
    let colCells = "";
    if (columns.length > 0) {
      colHeaders = columns.map(col => `<span class="item-col-header">${e(col.label)}</span>`).join("");
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
      title="${e(this._bindingPath(w.currencyPath))}">${e(pathLabel)}</label>
    <input type="number" name="${e(this._bindingPath(w.currencyPath))}" value="${curVal}" placeholder="0"
      style="width:80px;flex-shrink:0">
    <button type="button"
      class="widget-copy-path currency-path-copy"
      data-copy-path="${e(this._bindingPath(w.currencyPath))}"
      title="Copy path: ${e(this._bindingPath(w.currencyPath))}"
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
          const val = (n => Number.isFinite(n) ? n : 0)(Number(c?.[cur.key] ?? 0));
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
            const val = this._sdColumnValue(col, item);
            extraCols += `<span class="item-col" title="${e(col.label)}">${e(val)}</span>`;
          }
        }

        const equipBtn = isInv
          ? `<button type="button" class="item-btn item-equip-btn ${item.system?.equipped ? "on" : ""}" data-action="itemEquip" data-item-id="${item.id}" title="${item.system?.equipped ? "Unequip" : "Equip"}"${item.system?.equippable ? "" : ' style="opacity:.45"'}><i class="fas ${item.system?.equipped ? "fa-shield-halved" : "fa-shield"}"></i></button>`
          : "";

        html += `
      <li class="item-row ${equipped}" data-item-id="${item.id}" data-sd-preview-ref="item:${e(item.id)}" data-item-drag>
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
    const score = (n => Number.isFinite(n) ? n : 10)(Number(this._get(doc, w.path, 10)));
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

    // Only an explicitly configured formula produces a roll. With nothing
    // configured the button carries no dice at all - the click is emitted as a
    // sheet widget event ("click") and the Sheet Blueprint handles it.
    const rollFml = String(w.rollFormula ?? w.formula ?? "").trim();
    const dataOnClick = onClickFml
      ? `data-attr-onclick="${e(onClickFml)}"`
      : rollFml
        ? `data-attr-roll="${e(rollFml)}" data-flavor="${e(w.flavor || w.label)}"`
        : `data-flavor="${e(w.flavor || w.label)}"`;
    const attrAction = (onClickFml || rollFml) ? "attrModClick" : "widgetEvent";

    const variant = this._sanitizeVariant(w.variant);

    if (variant === "roll-button") {
      const rollLabel = e(w.actionLabel || "ROLL");
      return `<div class="widget widget-attribute widget-attribute--roll">
  <div class="widget-label" style="display:flex;align-items:center">${e(w.label)}${w.path ? this._copyBtn(w.path, "score") : ""}</div>
  <div class="attr-box">
    <input type="number" name="${e(this._bindingPath(w.path))}" value="${e(score)}" class="attr-score">
    <button type="button" class="attr-roll-btn" data-action="${attrAction}"
            ${dataOnClick}
            title="${e(w.label)} — click to roll"><i class="fas fa-dice-d20"></i><span>${rollLabel}</span></button>
  </div>
</div>`;
    }

    return `<div class="widget widget-attribute">
  <div class="widget-label" style="display:flex;align-items:center">${e(w.label)}${w.path ? this._copyBtn(w.path, "score") : ""}</div>
  <div class="attr-box">
    <input type="number" name="${e(this._bindingPath(w.path))}" value="${e(score)}" class="attr-score">
    <button type="button" class="attr-mod" data-action="${attrAction}"
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

    // Skills follow the same rule: no configured formula means no preset roll.
    const rawFml     = (w.rollFormula && String(w.rollFormula).trim())
      ? String(w.rollFormula).trim()
      : (w.formula && String(w.formula).trim())
        ? String(w.formula).trim()
        : "";
    const dispFml    = rawFml && FormulaEngine.isFormula(rawFml)
      ? FormulaEngine.resolveForRoll(rawFml, doc)
      : rawFml;
    const flavor = w.flavor || w.label;

    const dataOnClick = onClickFml
      ? `data-attr-onclick="${e(onClickFml)}"`
      : rawFml
        ? `data-formula="${e(dispFml)}" data-formula-raw="${e(rawFml)}" data-flavor="${e(flavor)}"`
        : `data-flavor="${e(flavor)}"`;

    const action = onClickFml ? "attrModClick" : (rawFml ? "widgetRoll" : "widgetEvent");
    const macroBtn = this._copyMacroBtn_skill(w, doc);

    const variant = w.variant || "default";

    const bonusBtn = `<button type="button" class="skill-bonus" data-action="${action}"
            ${dataOnClick}
            title="Roll ${e(w.label)}">${bs}</button>`;

    const nameBlock = `<div class="skill-name">${e(w.label)}${w.path ? this._copyBtn(w.path, "rank") : ""}</div>`;

    if (variant === "row-rank") {
      const rankInput = `<input type="number" name="${e(this._bindingPath(w.path))}" value="${e(rank)}" class="skill-rank-input" min="0" step="1">`;
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
        return `<span class="skill-pip ${filled ? "filled" : ""}" data-rank="${i + 1}" data-path="${e(this._bindingPath(w.path))}" data-action="skillPipClick" title="Set rank to ${i + 1}"></span>`;
      }).join("");
      return `<div class="widget widget-skill skill-pips">
  ${nameBlock}
  <div class="skill-pip-row" data-path="${e(this._bindingPath(w.path))}" data-action="skillPipReset" title="Right-click to reset">${pipsHtml}</div>
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

  static _copyMacroBtn_skill(w, doc = null) {
    const e = this._esc;
    const rawFormula = (w.rollFormula && String(w.rollFormula).trim())
      ? String(w.rollFormula).trim()
      : (w.formula && String(w.formula).trim())
        ? String(w.formula).trim()
        : "";
    const script = buildWidgetMacroScript({
      kind: "skill",
      path: String(w.path ?? ""),
      attrMod: Number(w.attrMod ?? 0),
      modValueFormula: String(w.modValueFormula ?? ""),
      formula: rawFormula,
      onClickFormula: String(w.onClickFormula ?? ""),
      flavor: String(w.flavor || w.label || "Skill"),
      sourceUuid: doc?.uuid ?? null
    });
    const payload = encodeMacroScript(script);
    return `<button type="button" class="widget-copy-macro skill-copy-macro" data-copy-macro-b64="${e(payload)}" title="Copy as Macro" tabindex="-1"
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

  static _render_vsection(w, doc, options = {}) {
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
      try { return this.render(cw, doc, false, options) ?? ""; }
      catch { return ""; }
    }).join("");
    return `<div class="widget widget-vsection" style="display:flex;flex-direction:column;gap:6px;padding:6px;border:1px ${bdStyle} ${e(bdCol)};border-radius:${radius};background:${e(bg)}">${header}${children}</div>`;
  }

  static _render_richtext(w, doc, options = {}) {
    const e        = this._esc;
    const readOnly = !!options.readOnly;
    const rawVal   = w.path ? this._get(doc, w.path, "") : (w.staticHtml ?? "");
    // A Rich Text widget remains rich text regardless of where it is stored.
    // hiddenFields is a valid storage path, not a request for a raw textarea.
    const display  = this._richtextToDisplayHTML(rawVal, false);

    const isStatic = !w.path;
    if (isStatic || readOnly) {
      const empty = !display
        ? `<span style="opacity:.35;font-style:italic">${e(w.label || "")}</span>`
        : "";
      const label = w.label ? `<div class="widget-label">${e(w.label)}</div>` : "";
      return `<div class="widget widget-richtext widget-richtext--readonly${isStatic ? " widget-richtext--static" : ""}">
  ${label}
  <div class="richtext-display richtext-display--readonly" style="padding:6px 8px;font-size:12px;line-height:1.6;word-break:break-word;cursor:default">${display || empty}</div>
</div>`;
    }

    const path = e(w.path);
    const wid  = e(w.id ?? "");

    const NativeProseMirror = globalThis.customElements?.get?.("prose-mirror");
    if (NativeProseMirror) {
      const safeVal = e(String(rawVal ?? ""));
      const empty = `<span class="sd-richtext-empty" style="opacity:.35;font-style:italic">${e(w.label || "Click to edit…")}</span>`;
      return `<div class="widget widget-richtext widget-richtext--native" data-richtext-widget="1" data-richtext-mode="native">
  <div class="widget-label">${e(w.label)}</div>
  <prose-mirror class="sd-richtext-native" name="${path}" data-path="${path}" data-widget-id="${wid}"
      button="true" editable="true" toggled="true" value="${safeVal}">${display || empty}</prose-mirror>
</div>`;
    }


    return `<div class="widget widget-richtext" data-richtext-widget="1" data-richtext-mode="html">
  <div class="widget-label">${e(w.label)}</div>
  <div class="editor flexcol sd-richtext-editor prosemirror" data-engine="prosemirror" data-path="${path}" data-widget-id="${wid}">
    <div class="editor-content">${display || ""}</div>
    <a class="sd-richtext-edit-btn" title="Edit"><i class="fa-solid fa-edit"></i></a>
  </div>
</div>`;
  }

  static _isHiddenFieldPath(path) {
    if (!path || typeof path !== "string") return false;
    return path.startsWith("system.hiddenFields.")
        || path.startsWith("hiddenFields.");
  }

  static _richtextToDisplayHTML(val, isHidden = false) {
    const s = String(val ?? "");
    if (!s) return "";
    if (!isHidden && /<[a-z][\s\S]*>/i.test(s)) {
      return this._stripStoredEditorChrome(s);
    }
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\r\n?|\n/g, "<br>");
  }

  static _stripStoredEditorChrome(html) {
    try {
      if (typeof DOMParser === "undefined") return html;
      const doc = new DOMParser().parseFromString(
        `<!doctype html><body>${html}</body>`, "text/html");
      const body = doc?.body;
      if (!body) return html;

      const kill = [
        "menu.prosemirror-menu",
        ".prosemirror-menu",
        ".prosemirror-dropdown",
        ".editor-menu",
        ".sd-richtext-chrome",
        ".sd-richtext-edit-btn",
        ".sd-richtext-cancel-btn",
        ".editor-edit",
        ".ProseMirror-menubar",
        ".ProseMirror-menuitem",
        ".ProseMirror-icon",
        ".ProseMirror-gapcursor",
        ".ProseMirror-widget"
      ].join(",");
      body.querySelectorAll(kill).forEach(n => n.remove());

      for (const sel of [".editor", ".ProseMirror", ".editor-content"]) {
        body.querySelectorAll(sel).forEach(node => {
          while (node.firstChild) node.parentNode.insertBefore(node.firstChild, node);
          node.remove();
        });
      }

      body.querySelectorAll("[contenteditable], [data-pm-slice]").forEach(n => {
        n.removeAttribute("contenteditable");
        n.removeAttribute("data-pm-slice");
      });

      return body.innerHTML;
    } catch { return html; }
  }

  /** Chips describing which Database variables an effect changes. */
  static _sdEffectVarChips(effect, { compact = false } = {}) {
    const e = this._esc;
    const changes = [...(effect?.changes ?? [])];
    if (!changes.length) return "";
    const chips = changes.slice(0, compact ? 2 : 6).map(change => {
      const info = effectChangeLabel(change);
      return `<span class="sd-effect-var" title="${e(`${info.label} ${info.symbol} ${info.value}`)}"><b>${e(info.label)}</b><i>${e(info.symbol)}</i><span>${e(info.value)}</span></span>`;
    });
    const rest = changes.length - chips.length;
    if (rest > 0) chips.push(`<span class="sd-effect-var sd-effect-var-more">+${rest}</span>`);
    return `<div class="sd-effect-vars">${chips.join("")}</div>`;
  }

  static _render_effects(w, doc) {
    const e = this._esc;
    const effects = [...(doc.allApplicableEffects?.() ?? doc.effects ?? [])];

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

    const variantId = this._sanitizeVariant(w.variant);
    if (variantId === "card-slider" || variantId === "card-grid") {
      return this._render_effects_cards(w, doc, filtered, canEdit, variantId);
    }

    let rows = "";
    for (const ef of filtered) {
      const disabled = ef.disabled ? "effect-disabled" : "";
      const dur      = effectDurationLabel(ef);
      const eyeIcon  = ef.disabled ? "fa-eye-slash" : "fa-eye";
      const uuid     = e(ef.uuid ?? "");
      rows += `
      <li class="effect-row ${disabled}" data-effect-id="${e(ef.id)}" data-effect-uuid="${uuid}" data-sd-preview-ref="effect:${e(ef.id)}">
        <img class="effect-img" src="${e(ef.img ?? ef.icon ?? 'icons/svg/aura.svg')}" alt="${e(ef.name)}">
        <span class="effect-name">${e(ef.name)}${w.showVariables === false ? "" : this._sdEffectVarChips(ef)}</span>
        ${dur ? `<span class="effect-dur">${e(dur)}</span>` : ""}
        <div class="effect-controls">
          ${canEdit ? this._sdEffectModeBtn(ef, uuid, "effect-btn") : ""}
          ${canEdit ? `<button type="button" class="effect-btn" data-action="effectToggle" data-effect-id="${e(ef.id)}" data-effect-uuid="${uuid}" title="${ef.disabled ? 'Enable' : 'Disable'}"><i class="fas ${eyeIcon}"></i></button>` : ""}
          <button type="button" class="effect-btn" data-action="effectEdit" data-effect-id="${e(ef.id)}" data-effect-uuid="${uuid}" title="Edit"><i class="fas fa-pen"></i></button>
          ${canEdit ? `<button type="button" class="effect-btn effect-btn-del" data-action="effectDelete" data-effect-id="${e(ef.id)}" data-effect-uuid="${uuid}" title="Delete"><i class="fas fa-trash"></i></button>` : ""}
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

  /**
   * Build the transfer-mode cycle button for an item-owned Active Effect.
   * Modes: transfers to actor -> on actor while equipped -> item only.
   */
  static _sdEffectModeBtn(ef, uuid, cls) {
    if (ef?.parent?.documentName !== "Item") return "";
    const explicit = ef.flags?.sd?.effectTransferMode;
    const mode = ["always", "equipped", "item"].includes(explicit)
      ? explicit
      : (ef.transfer === false ? "item" : (ef.flags?.sd?.activateOnEquip ? "equipped" : "always"));
    const m = mode === "equipped"
      ? { icon: "fa-shield-halved", color: "#d4a017", title: this._sdLoc("SD.Effects.ModeEquippedHint", "Applied only while the item is equipped.") }
      : mode === "always"
        ? { icon: "fa-arrow-right-to-bracket", color: "#3ec46e", title: this._sdLoc("SD.Effects.ModeAlwaysHint", "Applied whenever the item is owned.") }
        : { icon: "fa-lock", color: "", title: this._sdLoc("SD.Effects.ModeItemOnlyHint", "Never transferred to the actor.") };
    const escFn = this._esc;
    return `<button type="button" ${cls ? `class="${cls}" ` : ""}data-action="effectMode" data-effect-id="${escFn(ef.id)}" data-effect-uuid="${uuid ?? ""}" title="${m.title}"${m.color ? ` style="color:${m.color}"` : ""}><i class="fas ${m.icon}"></i></button>`;
  }

  static _render_spellbook(w, doc) {
    const e = this._esc;
    if (!(doc instanceof Actor)) {
      return `<div class="widget widget-spellbook"><p class="sb-only-actor">Spellbook works on Actor sheets only</p></div>`;
    }

    // Accepted ability types come from a Database variable; the legacy single
    // hidden field type is still used as a fallback.
    const acceptedTypes = this._sdAcceptedList(w.abilityTypes);
    const legacyType = String(w.abilityType ?? (w.type && w.type !== "spellbook" ? w.type : "") ?? "").trim();
    const wantTypes = acceptedTypes.length ? acceptedTypes : (legacyType ? [legacyType] : []);
    const wantType = wantTypes.join(", ");

    const sbColumns = this._sdExtraColumns(w);

    let abilities = [...(doc.items ?? [])].filter(i => i.type === "ability");
    if (wantTypes.length) {
      abilities = abilities.filter(i => this._sdFilterMatches(i, w.typeVariable, i.system?.hiddenFields?.type, wantTypes));
    }

    if (w.compact) {
      return this._render_spellbook_compact(w, doc, abilities, wantType);
    }

    const variantId = this._sanitizeVariant(w.variant);
    if (variantId === "card-slider" || variantId === "card-grid") {
      return this._render_spellbook_cards(w, doc, abilities, wantType, variantId);
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
        html += this._sbAbilityRow(ab, e, sbColumns);
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

  static _cardsShell(innerHtml, mode, e, label, extraHeader = "", dropZoneHtml = "") {
    const isSlider = mode === "card-slider";
    const prevNext = isSlider
      ? `<button type="button" class="sd-cards-nav sd-cards-nav-prev" data-action="cardSliderPrev" title="Previous"><i class="fas fa-chevron-left"></i></button>
         <button type="button" class="sd-cards-nav sd-cards-nav-next" data-action="cardSliderNext" title="Next"><i class="fas fa-chevron-right"></i></button>`
      : "";
    return `<div class="widget widget-cards-wrap">
  <div class="widget-label">${e(label)}${extraHeader}</div>
  <div class="sd-cards-container" data-card-mode="${e(mode)}">
    ${prevNext}
    <div class="sd-cards-track">${innerHtml}</div>
  </div>
  ${dropZoneHtml}
</div>`;
  }

  static _renderItemCardSafe(item) {
    try { return ItemPreviewPopup.renderItemCardHTML(item) ?? ""; }
    catch (err) {
      console.warn("SD | renderItemCardHTML error:", err);
      return `<div class="sd-item-card-empty">${this._esc(item?.name ?? "Item")}</div>`;
    }
  }

  static _renderEffectCardSafe(ef) {
    try { return ItemPreviewPopup.renderEffectCardHTML(ef) ?? ""; }
    catch (err) {
      console.warn("SD | renderEffectCardHTML error:", err);
      return `<div class="sd-item-card-empty">${this._esc(ef?.name ?? "Effect")}</div>`;
    }
  }

  static _render_inventory_cards(w, doc, items, mode, columns) {
    const e = this._esc;
    const dropZone = `<div class="inventory-drop-zone sd-cards-drop-zone" data-drop-zone="item">
      <i class="fas fa-arrow-down-to-line"></i><span>Drop items here</span>
    </div>`;
    if (!items.length) {
      return this._cardsShell(
        `<div class="empty-list" style="grid-column:1/-1"><i class="fas fa-backpack"></i><span>No items - drag to add</span></div>`,
        mode, e, w.label ?? "Inventory", "", dropZone
      );
    }

    let inner = "";
    for (const item of items) {
      const sys      = item.system ?? {};
      const isInv    = item.type === "inventory";
      const equipped = sys.equipped ? " is-equipped" : "";
      const equippable = !!sys.equippable;
      const cardBody = this._renderItemCardSafe(item);

      const equipBtn = isInv
        ? `<button type="button" class="sd-card-btn sd-card-btn-equip${sys.equipped ? " on" : ""}" data-action="itemEquip" data-item-id="${e(item.id)}" title="${sys.equipped ? "Unequip" : "Equip"}"${equippable ? "" : ' style="opacity:.45"'}>
             <i class="fas ${sys.equipped ? "fa-shield-halved" : "fa-shield"}"></i>
           </button>`
        : "";

      let extraColsHtml = "";
      if (Array.isArray(columns) && columns.length > 0) {
        let cells = "";
        for (const col of columns) {
          const spec = (col && typeof col === "object") ? col : { id: col, label: col, variable: false };
          const val = this._sdColumnValue(spec, item);
          cells += `<div class="sd-item-card-col"><span class="sd-item-card-col-label">${e(spec.label)}</span><span class="sd-item-card-col-value">${e(val)}</span></div>`;
        }
        extraColsHtml = `<div class="sd-item-card-extra-cols">${cells}</div>`;
      }

      const qty    = Number(sys.quantity ?? 1);
      const weight = w.showWeight ? Number(sys.weight ?? 0) : null;
      const metaPills = `<div class="sd-item-card-meta">
        ${qty > 1 ? `<span class="sd-item-card-pill">×${qty}</span>` : ""}
        ${weight !== null ? `<span class="sd-item-card-pill">${weight} lb</span>` : ""}
        ${sys.category ? `<span class="sd-item-card-pill">${e(sys.category)}</span>` : ""}
      </div>`;

      inner += `<article class="sd-item-card${equipped}" data-item-id="${e(item.id)}" data-item-drag draggable="true">
        ${cardBody}
        ${metaPills}
        <div class="sd-item-card-actions">
          <button type="button" class="sd-card-btn sd-card-btn-use" data-action="itemUse" data-item-id="${e(item.id)}" title="Use / Roll"><i class="fas fa-play"></i><span>Use</span></button>
          ${equipBtn}
          <button type="button" class="sd-card-btn" data-action="itemEdit" data-item-id="${e(item.id)}" title="Edit"><i class="fas fa-edit"></i></button>
          <button type="button" class="sd-card-btn sd-card-btn-del" data-action="itemDelete" data-item-id="${e(item.id)}" title="Delete"><i class="fas fa-trash"></i></button>
        </div>
        ${extraColsHtml}
      </article>`;
    }

    return this._cardsShell(inner, mode, e, w.label ?? "Inventory", "", dropZone);
  }

  static _render_effects_cards(w, doc, effects, canEdit, mode) {
    const e = this._esc;
    const dropZone = canEdit
      ? `<div class="sd-effect-drop-zone sd-cards-drop-zone" data-action="effectDrop">
          <i class="fas fa-arrow-down-to-line"></i><span>Drop active effects here</span>
        </div>`
      : "";
    if (!effects.length) {
      return this._cardsShell(
        `<div class="empty-list" style="grid-column:1/-1"><i class="fas fa-sparkles"></i><span>No effects</span></div>`,
        mode, e, w.label ?? "Effects",
        canEdit ? `<button type="button" class="effect-create-btn" data-action="effectCreate" title="Add Effect"><i class="fas fa-plus"></i></button>` : "",
        dropZone
      );
    }

    let inner = "";
    for (const ef of effects) {
      const cardBody = this._renderEffectCardSafe(ef);
      const disabled = ef.disabled ? " is-disabled" : "";
      const eyeIcon  = ef.disabled ? "fa-eye-slash" : "fa-eye";
      const uuid     = e(ef.uuid ?? "");

      const dur = effectDurationLabel(ef);
      const metaPills = `<div class="sd-item-card-meta">
        ${dur ? `<span class="sd-item-card-pill">${e(dur)}</span>` : ""}
        ${ef.transfer ? `<span class="sd-item-card-pill">passive</span>` : ""}
      </div>`;

      inner += `<article class="sd-item-card${disabled}" data-effect-id="${e(ef.id)}" data-effect-uuid="${uuid}">
        ${cardBody}
        ${metaPills}
        <div class="sd-item-card-actions">
          ${canEdit ? this._sdEffectModeBtn(ef, uuid, "sd-card-btn") : ""}
          ${canEdit ? `<button type="button" class="sd-card-btn" data-action="effectToggle" data-effect-id="${e(ef.id)}" data-effect-uuid="${uuid}" title="${ef.disabled ? "Enable" : "Disable"}"><i class="fas ${eyeIcon}"></i></button>` : ""}
          <button type="button" class="sd-card-btn" data-action="effectEdit" data-effect-id="${e(ef.id)}" data-effect-uuid="${uuid}" title="Edit"><i class="fas fa-pen"></i></button>
          ${canEdit ? `<button type="button" class="sd-card-btn sd-card-btn-del" data-action="effectDelete" data-effect-id="${e(ef.id)}" data-effect-uuid="${uuid}" title="Delete"><i class="fas fa-trash"></i></button>` : ""}
        </div>
      </article>`;
    }

    return this._cardsShell(
      inner, mode, e, w.label ?? "Effects",
      canEdit ? `<button type="button" class="effect-create-btn" data-action="effectCreate" title="Add Effect"><i class="fas fa-plus"></i></button>` : "",
      dropZone
    );
  }

  static _render_spellbook_cards(w, doc, abilities, wantType, mode) {
    const e = this._esc;
    const label = w.label ?? "Spellbook";
    const typeBadge = wantType
      ? `<span class="sb-type-badge" style="margin-left:8px;padding:1px 7px;border-radius:3px;background:var(--sd-accent-glow);color:var(--sd-accent);font-size:10px;font-weight:600;letter-spacing:.04em;text-transform:uppercase">${e(wantType)}</span>`
      : "";
    const dropZone = `<div class="sb-drop-zone sd-cards-drop-zone" data-action="spellbookDrop" data-want-type="${e(wantType)}">
      <i class="fas fa-arrow-down-to-line"></i><span>Drop ability items here</span>
    </div>`;

    if (!abilities.length) {
      const empty = `<div class="empty-list" style="grid-column:1/-1"><i class="fas fa-book-sparkles"></i><span>No abilities${wantType ? ` of type "${e(wantType)}"` : ""} — drag ability items here</span></div>`;
      return this._cardsShell(empty, mode, e, label, typeBadge, dropZone);
    }

    let inner = "";
    for (const ab of abilities) {
      const cardBody = this._renderItemCardSafe(ab);
      const hf       = ab.system?.hiddenFields ?? {};
      const cost     = Number(hf.cost ?? 0) || 0;
      const pathUses = String(hf.pathUses ?? "").trim();
      const equipped = ab.system?.equipped ? " is-equipped" : "";

      const metaPills = `<div class="sd-item-card-meta">
        ${cost > 0 ? `<span class="sd-item-card-pill" title="${e(pathUses || "no resource path")}">${cost}</span>` : ""}
        ${wantType ? `<span class="sd-item-card-pill">${e(wantType)}</span>` : ""}
      </div>`;

      inner += `<article class="sd-item-card${equipped}" data-item-id="${e(ab.id)}" draggable="true">
        ${cardBody}
        ${metaPills}
        <div class="sd-item-card-actions">
          <button type="button" class="sd-card-btn sd-card-btn-use" data-action="abilityCast" data-item-id="${e(ab.id)}" title="Use ${e(ab.name)}"><i class="fas fa-play"></i><span>Cast</span></button>
          <button type="button" class="sd-card-btn" data-action="abilityEdit" data-item-id="${e(ab.id)}" title="Edit"><i class="fas fa-pen"></i></button>
          <button type="button" class="sd-card-btn sd-card-btn-del" data-action="abilityDelete" data-item-id="${e(ab.id)}" title="Remove from actor"><i class="fas fa-trash"></i></button>
        </div>
      </article>`;
    }

    return this._cardsShell(inner, mode, e, label, typeBadge, dropZone);
  }

  static _render_progress(w, doc) {
    const esc = this._esc.bind(this);
    const val = Number(this._get(doc, w.pathValue, 0)) || 0;
    const max = Number(this._get(doc, w.pathMax, 1)) || 1;
    const pct = Math.round(Math.min(100, Math.max(0, (val / max) * 100)));
    const col = esc(w.color ?? "#5a8aff");
    const trk = esc(w.barTrack ?? "var(--sd-bg)");
    const barH = Number(w.barH) > 0 ? `${Number(w.barH)}px` : "10px";
    const lbl = esc(w.label ?? "Meter");
    const mode = ["bar", "segments", "pips", "radial", "number"].includes(w.mode) ? w.mode : "bar";
    const showLabel = w.showLabel !== false && w.showLabel !== "false";
    const showPct = w.showPct !== false && w.showPct !== "false";
    const segmentCount = Math.max(1, Math.min(50, Math.round(Number(w.segments ?? 10) || 10)));
    const filled = Math.round((pct / 100) * segmentCount);
    let display;
    if (mode === "segments" || mode === "pips") {
      display = `<div class="sd-meter-segments sd-meter-${mode}" style="display:flex;gap:${mode === "pips" ? 5 : 3}px;min-height:${barH}">${Array.from({ length: segmentCount }, (_, index) => `<span style="flex:${mode === "segments" ? 1 : 0} 0 ${mode === "pips" ? barH : "auto"};height:${barH};border-radius:${mode === "pips" ? "50%" : "3px"};background:${index < filled ? col : trk};border:1px solid var(--sd-w-bd,var(--sd-bg-3))"></span>`).join("")}</div>`;
    } else if (mode === "radial") {
      display = `<div class="sd-meter-radial" style="width:74px;height:74px;margin:auto;border-radius:50%;display:grid;place-items:center;background:conic-gradient(${col} ${pct}%,${trk} 0);box-shadow:inset 0 0 0 1px var(--sd-w-bd,var(--sd-border))"><span style="width:54px;height:54px;border-radius:50%;display:grid;place-items:center;background:var(--sd-w-bg,var(--sd-bg-2));font-size:11px;font-weight:700">${showPct ? `${pct}%` : `${val}/${max}`}</span></div>`;
    } else if (mode === "number") {
      display = `<div class="sd-meter-number" style="text-align:center;font-size:22px;font-weight:800;color:${col};font-variant-numeric:tabular-nums">${val}<span style="font-size:.55em;opacity:.65"> / ${max}</span></div>`;
    } else {
      display = `<div style="background:${trk};border-radius:3px;height:${barH};overflow:hidden;border:1px solid var(--sd-w-bd,var(--sd-bg-3));opacity:.9"><div style="height:100%;width:${pct}%;background:${col};border-radius:3px;transition:width .3s"></div></div>`;
    }
    return `<div class="widget widget-progress widget-meter widget-meter--${mode}">
  <div class="widget-label-row" style="display:flex;align-items:baseline;gap:4px;margin-bottom:4px">
    ${showLabel ? `<span class="widget-label">${lbl}</span>` : ""}
    ${showPct && mode !== "radial" && mode !== "number" ? `<span style="margin-left:auto;font-size:10px;color:var(--sd-w-label,var(--sd-text-3))">${val}/${max} (${pct}%)</span>` : ""}
  </div>
  ${display}
</div>`;
  }

  static _render_select(w, doc) {
    const esc   = this._esc.bind(this);
    const lbl   = esc(w.label ?? "Select");
    const path  = esc(this._bindingPath(w.path));
    const raw   = String(w.choices ?? "");
    const opts  = raw.split(",").map(s => s.trim()).filter(Boolean);
    const key   = String(w.widgetKey ?? "").trim();
    let stored;
    if (key) {
      try { stored = foundry.utils.getProperty(doc, `system.widgetFields.${key}.value`); } catch {}
    }
    const bound = this._get(doc, w.path, "");
    const candidate = stored !== undefined && stored !== null ? String(stored) : String(bound ?? "");
    const cur = opts.includes(candidate) ? candidate : (opts[0] ?? candidate);
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
    const path  = esc(this._bindingPath(w.path));
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
    const bindingPath=this._bindingPath(rawPath);
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
      ? Math.round(Math.max(0, Math.min(1, (val - minN) / (maxN - minN))) * 100)
      : 0;
    const minAttr = minN == null ? "" : e(minN);
    const maxAttr = maxN == null ? "" : e(maxN);
    const path = e(this._bindingPath(w.path));
    return `<div class="widget widget-counter" style="--sd-progress:${pct}%">
  <div class="widget-label cnt-lbl">${e(w.label ?? "Counter")}</div>
  <div class="cnt-row">
    <button type="button" class="num-btn cnt-btn cnt-btn-dec" data-action="widgetNumStep"
            data-path="${path}" data-step="-${e(step)}"
            data-min="${minAttr}" data-max="${maxAttr}">−</button>
    <div class="cnt-val" data-progress="${pct}" style="--sd-progress:${pct}%;color:${col};">${e(val)}</div>
    <button type="button" class="num-btn cnt-btn cnt-btn-inc" data-action="widgetNumStep"
            data-path="${path}" data-step="${e(step)}"
            data-min="${minAttr}" data-max="${maxAttr}">+</button>
  </div>
</div>`;
  }

  static _render_tokenPool(w, doc) {
    const e       = this._esc;
    const rawPath = w.path ?? "";
    const bindingPath=this._bindingPath(rawPath);
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
    const path  = esc(this._bindingPath(w.path));
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

  static _render_widgetBuilder(w, doc, options = {}) {
    const e = (s) => this._esc(s);
    const els = Array.isArray(w.elements) ? w.elements : [];
    const cols = Math.max(1, Math.min(24, Number(w.columns) || 3));
    const gap = Math.max(0, Math.min(128, Number.isFinite(Number(w.gap)) ? Number(w.gap) : 6));
    const layout = String(w.wbLayout ?? "grid") === "free" ? "free" : "grid";
    const scopeId = widgetBuilderScopeId(w.id);
    const scopeSelector = `[data-sd-wb="${scopeId}"]`;
    const scopedCss = sanitizeWidgetCss(w.customCss, scopeSelector);
    const cssBlock = scopedCss.css ? `<style data-sd-wb-style="${scopeId}">${scopedCss.css}</style>` : "";
    const clip = w.clipOverflow === false || w.clipOverflow === "false" ? "visible" : "hidden";

    const layerNumber = (el2, fallback = 0) => {
      const n = Number(el2?.z);
      return Number.isFinite(n) ? Math.max(-1000, Math.min(1000, Math.round(n))) : fallback;
    };
    const safeElementName = (el2, index) => {
      const raw = String(el2?.name ?? `element-${index + 1}`).trim();
      return raw || `element-${index + 1}`;
    };
    const renderInner = (el2, index) => {
      const name = safeElementName(el2, index);
      const kind = String(el2?.kind ?? "button");
      const lbl = e(String(el2?.label ?? "") || name);
      const color = String(el2?.color ?? "").trim();
      const size = Math.max(0, Math.min(512, Number(el2?.size) || 0));
      const clickable = el2?.clickable === true || el2?.clickable === "true" || el2?.clickable === "yes";
      const evName = "On Click " + name;
      const clickAttrs = (clickable && name) ? ` data-action="wbElement" data-event-name="${e(evName)}" data-element-key="${e(name)}"` : "";
      const clickStyle = clickable ? "cursor:pointer;" : "";
      const iconCls = e(this._faClass(String(el2?.icon ?? "")));
      const img = String(el2?.img ?? "").trim();
      let inner = "";
      if (kind === "widget") {
        const nested = el2?.widget;
        if (!nested || typeof nested !== "object" || !nested.type) {
          inner = `<div class="sd-wb-missing"><i class="fas fa-puzzle-piece"></i> Select a widget</div>`;
        } else if (nested.type === "widgetBuilder") {
          inner = `<div class="sd-wb-missing"><i class="fas fa-triangle-exclamation"></i> Nested Widget Builder is blocked</div>`;
        } else {
          try {
            inner = `<div class="sd-wb-nested-widget" data-wb-widget-id="${e(nested.id ?? "")}">${this.render(nested, doc, false, options) ?? ""}</div>`;
          } catch (err) {
            console.warn("SD | Nested Widget Builder element failed:", err, nested);
            inner = `<div class="sd-wb-missing"><i class="fas fa-triangle-exclamation"></i> Widget error</div>`;
          }
        }
      } else if (kind === "button") {
        const accent = color || "var(--sd-accent)";
        inner = `<button type="button"${clickAttrs} class="sd-wb-button" style="--sd-wb-accent:${e(accent)};font-size:${size > 0 ? size : 12}px">${el2?.icon ? `<i class="${iconCls}"></i>` : ""}${img ? `<img src="${e(img)}" alt="" draggable="false">` : ""}<span>${lbl}</span></button>`;
      } else if (kind === "value") {
        const outMap = (w.wbOutputs && typeof w.wbOutputs === "object") ? w.wbOutputs : null;
        const bound = (outMap && typeof outMap[name] === "string" && outMap[name].trim() !== "") ? outMap[name] : null;
        let raw = bound !== null ? String(bound).trim() : String(el2?.formula ?? "").trim();
        if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
          try { raw = String(JSON.parse(raw)); } catch (err) { raw = raw.slice(1, -1); }
        }
        let val = "";
        if (raw) {
          let out = null;
          try { out = FormulaEngine.evaluate(raw, doc); } catch (err) { out = null; }
          val = (out === undefined || out === null) ? "" : String(out);
          if (val === "" || val.startsWith("!err")) {
            let txt = raw;
            try { txt = String(FormulaEngine._resolveRefs?.(raw, doc) ?? raw); } catch (err) { txt = raw; }
            if (txt.length >= 2 && txt.startsWith('"') && txt.endsWith('"')) txt = txt.slice(1, -1);
            val = txt;
          }
        }
        inner = `<div${clickAttrs} class="sd-wb-value" style="${clickStyle}">${lbl ? `<div class="widget-label">${lbl}</div>` : ""}<div class="sd-wb-value-text" style="font-size:${size > 0 ? size : 18}px;color:${color ? e(color) : "var(--sd-text)"}">${e(val)}</div></div>`;
      } else if (kind === "icon") {
        inner = `<div${clickAttrs} class="sd-wb-icon" style="${clickStyle}" title="${lbl}"><i class="${iconCls}" style="font-size:${size > 0 ? size : 20}px;color:${color ? e(color) : "var(--sd-accent)"}"></i>${el2?.label ? `<span class="widget-label">${lbl}</span>` : ""}</div>`;
      } else if (kind === "image") {
        const iw = Math.max(1, Math.min(4096, Number(el2?.w) || 48));
        const ih = Math.max(1, Math.min(4096, Number(el2?.h) || 48));
        const fit = ["contain", "cover", "fill", "scale-down", "none"].includes(String(el2?.fit)) ? String(el2.fit) : "cover";
        inner = `<div${clickAttrs} class="sd-wb-image" style="${clickStyle}" title="${lbl}">${img ? `<img src="${e(img)}" alt="${lbl}" draggable="false" style="width:${iw}px;height:${ih}px;object-fit:${fit}${color ? `;border-color:${e(color)}` : ""}">` : `<div class="sd-wb-image-placeholder" style="width:${iw}px;height:${ih}px"><i class="fas fa-image"></i></div>`}${el2?.label ? `<span class="widget-label">${lbl}</span>` : ""}</div>`;
      } else {
        inner = `<span${clickAttrs} class="sd-wb-label" style="${clickStyle}font-size:${size > 0 ? size : 12}px;color:${color ? e(color) : "var(--sd-text)"}">${lbl}</span>`;
      }
      return inner;
    };

    const visible = els.map((el2, index) => ({ el2, index })).filter(({ el2 }) => !(el2?.hidden === true || el2?.hidden === "true"));
    const emptyHint = `<div class="sd-wb-empty">No elements yet - open the widget config and add elements</div>`;
    const label = w.label ? `<div class="widget-label sd-wb-title">${e(w.label)}</div>` : "";

    if (layout === "free") {
      const cw = Math.max(0, Math.min(8192, Number(w.canvasW) || 0));
      const chh = Math.max(24, Math.min(8192, Number(w.canvasH) || 140));
      const cells = visible
        .sort((a, b) => layerNumber(a.el2, a.index) - layerNumber(b.el2, b.index) || a.index - b.index)
        .map(({ el2, index }) => {
          const x = Math.max(0, Number(el2?.x) || 0);
          const y = Math.max(0, Number(el2?.y) || 0);
          const ew = Math.max(0, Number(el2?.w) || 0);
          const eh = Math.max(0, Number(el2?.h) || 0);
          const z = layerNumber(el2, index);
          const name = safeElementName(el2, index);
          return `<div class="sd-wb-element sd-wb-kind-${e(String(el2?.kind ?? "button"))}" data-wb-element="${e(name)}" data-wb-layer="${z}" style="left:${x}px;top:${y}px;z-index:${z};${ew > 0 ? `width:${ew}px;` : ""}${eh > 0 ? `height:${eh}px;` : ""}"><div class="sd-wb-content">${renderInner(el2, index)}</div></div>`;
        }).join("");
      return `<div class="widget widget-builder sd-wb-root" data-sd-wb="${scopeId}">${cssBlock}${label}<div class="sd-wb-canvas" style="${cw > 0 ? `width:${cw}px;` : "width:100%;"}height:${chh}px;overflow:${clip}">${visible.length ? cells : emptyHint}</div></div>`;
    }

    const cells = visible.map(({ el2, index }) => {
      const name = safeElementName(el2, index);
      const z = layerNumber(el2, index);
      return `<div class="sd-wb-grid-element sd-wb-kind-${e(String(el2?.kind ?? "button"))}" data-wb-element="${e(name)}" data-wb-layer="${z}"><div class="sd-wb-content">${renderInner(el2, index)}</div></div>`;
    }).join("");
    return `<div class="widget widget-builder sd-wb-root" data-sd-wb="${scopeId}">${cssBlock}${label}${visible.length ? `<div class="sd-wb-grid" style="grid-template-columns:repeat(${cols},minmax(0,1fr));gap:${gap}px">${cells}</div>` : emptyHint}</div>`;
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
    const fsRaw = Number(w.valueFontSize);
    const fs    = Number.isFinite(fsRaw) && fsRaw > 0 ? `${fsRaw}px` : "18px";
    return `<div class="widget widget-derived">
  <div class="widget-label">${lbl}</div>
  <div class="widget-derived-value" style="font-size:${fs};font-weight:700;text-align:center;color:var(--sd-text);letter-spacing:.02em;line-height:1.15">${esc(String(disp))}</div>
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

  static _sbAbilityRow(ab, esc, columns = []) {
    const hf       = ab.system?.hiddenFields ?? {};
    const cost     = Number(hf.cost ?? 0) || 0;
    const pathUses = String(hf.pathUses ?? "").trim();
    const equipped = ab.system?.equipped ? "equipped" : "";

    const costBadge = (cost > 0)
      ? `<span class="sb-ability-cost" style="font-size:10px;color:var(--sd-accent);white-space:nowrap" title="${esc(pathUses || "no resource path")}">${cost}</span>`
      : "";

    // Extra columns configured as Database variables.
    let extraCols = "";
    for (const col of (Array.isArray(columns) ? columns : [])) {
      const spec = (col && typeof col === "object") ? col : { id: col, label: col, variable: false };
      const value = this._sdColumnValue(spec, ab);
      if (value === "") continue;
      extraCols += `<span class="sb-ability-col" title="${esc(spec.label)}" style="font-size:10px;color:var(--sd-text-3);white-space:nowrap">${esc(value)}</span>`;
    }

    return `
      <li class="sb-ability-row ${equipped}" data-item-id="${esc(ab.id)}" data-sd-preview-ref="item:${esc(ab.id)}" draggable="true"
          style="display:flex;align-items:center;gap:5px;padding:3px 4px;border-radius:4px;
                 list-style:none;cursor:default;transition:background .1s"
          onmouseenter="this.style.background='rgba(123,104,238,.07)'"
          onmouseleave="this.style.background=''">
        <img src="${esc(ab.img ?? "icons/svg/book.svg")}" alt="${esc(ab.name)}"
             style="width:20px;height:20px;object-fit:cover;border-radius:3px;flex-shrink:0">
        <span class="sb-ability-name" style="flex:1;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
              title="${esc(ab.name)}">${esc(ab.name)}</span>
        ${extraCols}
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
  <summary class="sd-hud-pop-btn"><i class="${ic}"></i><span>${lbl}</span></summary>
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
      rows += `<li class="sd-hud-pop-row" data-item-id="${e(item.id)}" data-sd-preview-ref="item:${e(item.id)}">
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
      const uuid     = e(ef.uuid ?? "");
      rows += `<li class="sd-hud-pop-row ${offCls}" data-effect-id="${e(ef.id)}" data-effect-uuid="${uuid}" data-sd-preview-ref="effect:${e(ef.id)}">
        <img src="${e(ef.img ?? ef.icon ?? 'icons/svg/aura.svg')}" alt="${e(ef.name)}">
        <span class="sd-hud-pop-name" title="${e(ef.name)}">${e(ef.name)}</span>
        ${canEdit ? this._sdEffectModeBtn(ef, uuid, "") : ""}
        ${canEdit ? `<button type="button" data-action="effectToggle" data-effect-id="${e(ef.id)}" data-effect-uuid="${uuid}" title="${ef.disabled ? 'Enable' : 'Disable'}"><i class="fas ${eyeIcon}"></i></button>` : ""}
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
      rows += `<li class="sd-hud-pop-row" data-item-id="${e(ab.id)}" data-sd-preview-ref="item:${e(ab.id)}">
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

  /**
   * Radar (spider) chart for the Attribute Group widget.
   *
   * Diagram only - no list is rendered. Axis labels and vertices carry
   * `data-action="wbElement"`, the same hit-area contract the Widget Builder
   * elements use, so a click fires the widget's On Click event with
   * `elementKey` set to that attribute's Database variable id.
   */
  static _render_attributeGroup_radar(w, items, lbl, ic) {
    const e = this._esc;
    const n = items.length;
    const CX = 160, CY = 160, R = 104, GAP = 16;
    const RINGS = [0.25, 0.5, 0.75, 1];

    let max = Number(w.radarMax);
    if (!Number.isFinite(max) || max <= 0) max = Math.max(...items.map(it => Number(it.score) || 0), 1);

    const fmt = v => Math.round(Number(v) * 100) / 100;
    const angleFor = i => -Math.PI / 2 + i * ((2 * Math.PI) / n);
    const polar = (angle, radius) => ({ x: CX + radius * Math.sin(angle), y: CY - radius * Math.cos(angle) });
    const ringPoints = f => items.map((_, i) => { const p = polar(angleFor(i), R * f); return `${fmt(p.x)},${fmt(p.y)}`; }).join(" ");

    const grid = RINGS.map(f => `<polygon class="attr-radar-ring" points="${ringPoints(f)}"></polygon>`).join("");
    const axes = items.map((_, i) => {
      const p = polar(angleFor(i), R);
      return `<line class="attr-radar-axis" x1="${CX}" y1="${CY}" x2="${fmt(p.x)}" y2="${fmt(p.y)}"></line>`;
    }).join("");

    const points = items.map((it, i) => polar(angleFor(i), Math.max(0, Math.min(1, (Number(it.score) || 0) / max)) * R));
    const shape = `<polygon class="attr-radar-shape" points="${points.map(p => `${fmt(p.x)},${fmt(p.y)}`).join(" ")}"></polygon>`;

    // Same contract as Widget Builder elements: the sheet already binds these
    // and emits the widget event with the element key attached.
    const hit = it => `data-action="wbElement" data-element-key="${e(it.key)}" data-event-name="On Click ${e(it.key)}" data-attr-key="${e(it.key)}" data-flavor="${e(it.name)}" role="button" tabindex="0"`;

    const dots = items.map((it, i) => `<circle class="attr-radar-dot" cx="${fmt(points[i].x)}" cy="${fmt(points[i].y)}" r="5" ${hit(it)}><title>${e(it.name)}: ${e(String(it.score))} (${e(it.modStr)})</title></circle>`).join("");

    const labels = items.map((it, i) => {
      const angle = angleFor(i);
      const dx = Math.sin(angle), dy = -Math.cos(angle);
      const p = polar(angle, R + GAP);
      const anchor = dx > 0.12 ? "start" : (dx < -0.12 ? "end" : "middle");
      const shift = dy > 0.25 ? -10 : (dy < -0.25 ? 9 : 0);
      return `<g class="attr-radar-label-group" ${hit(it)}>
      <text class="attr-radar-label" x="${fmt(p.x)}" y="${fmt(p.y + shift)}" text-anchor="${anchor}">${e(it.name)}</text>
      <text class="attr-radar-value" x="${fmt(p.x)}" y="${fmt(p.y + shift + 12)}" text-anchor="${anchor}">${e(String(it.score))} · ${e(it.modStr)}</text>
    </g>`;
    }).join("");

    const header = w.label
      ? `<div class="widget-label" style="display:flex;align-items:center;gap:6px"><i class="${ic}"></i>${lbl}</div>`
      : "";
    return `<div class="widget widget-attribute-group attr-radar-widget">
  ${header}
  <div class="attr-radar-wrap">
    <svg class="attr-radar" viewBox="0 0 320 320" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${lbl}">
      ${grid}${axes}${shape}${dots}${labels}
    </svg>
  </div>
</div>`;
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
    // The widget config stores a list of Database variable ids picked from a
    // dropdown. A legacy comma-separated string is still accepted.
    const rawKeys    = Array.isArray(w.attributeKeys)
      ? w.attributeKeys.map(entry => String(entry ?? "").trim()).filter(Boolean)
      : String(w.attributeKeys ?? "").split(",").map(entry => String(entry ?? "").trim()).filter(Boolean);
    const explicit   = rawKeys.length > 0;

    const parseToken = (raw) => {
      const s = String(raw).trim();
      if (!s) return null;

      // Database variables win: read them from their own storage path and reuse
      // their display name instead of guessing a system.attributes.* path.
      const dbDef = getValueDefinition(s) ?? getValueDefinition(variableIdForLegacyPath(s));
      if (dbDef) return { key: dbDef.id, scorePath: valueStoragePath(dbDef.id), name: dbDef.name };

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
      tokens = rawKeys.map(parseToken).filter(Boolean);
    } else {

      const cfgKeys = Object.keys(cfgLabels);
      const sourceKeys = cfgKeys.length
        ? cfgKeys.filter(k => cfgEnabled[k] !== false)
        : Object.keys(doc.system?.attributes ?? {});
      tokens = sourceKeys.map(k => ({ key: k, scorePath: `system.attributes.${k}.value` }));
    }

    const compute = CONFIG?.SD?.computeModifier ?? (s => Math.floor((Number(s) - 10) / 2));

    const attrGraphs = (w.attrGraphs && typeof w.attrGraphs === "object") ? w.attrGraphs : {};

    const items = tokens.map(({ key, scorePath, name: dbName }) => {

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

      const name   = dbName
        || cfgLabels[key]
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
      : { action: "widgetEvent",  attrs: `data-attr-key="${e(it.key)}" data-element-key="${e(it.key)}" data-flavor="${e(it.name)}"` };

    // Radar variant: the diagram replaces the list entirely. Needs at least a
    // triangle, otherwise fall through to the ordinary cards.
    if (this._sanitizeVariant(w.variant) === "radar" && items.length >= 3) {
      return this._render_attributeGroup_radar(w, items, lbl, ic);
    }

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
    <input type="number" class="attr-item-score" name="${e(it.path)}" value="${Number.isFinite(Number(it.score)) ? Number(it.score) : ""}">
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
