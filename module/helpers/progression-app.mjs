import { editEffectViaStandardConfig as _sharedEditEffect, openItemSheetFromSnapshot as _sharedOpenItem } from "./effect-editor.mjs";
import { WidgetRenderer } from "../builder/widget-renderer.mjs";
import { LevelUpWizard } from "./levelup-wizard.mjs";
import { fieldChangeStoragePath, getValueDefinition, getValueDefinitions, readDatabaseValue, valueStoragePath, variableIdForLegacyPath } from "./value-database.mjs";

const { ApplicationV2 } = foundry.applications.api;

function rndId()      { return foundry.utils.randomID(8); }
function dc(obj)      { return foundry.utils.deepClone(obj); }
function e(str)       { return String(str ?? "").replace(/"/g, "&quot;").replace(/</g, "&lt;"); }
function loc(key)     { return game.i18n.localize(key); }

function dbVariableId(value) {
  const raw=String(value??"").trim();
  return getValueDefinition(raw)?.id ?? variableIdForLegacyPath(raw) ?? "";
}
function dbVariableLabel(change) {
  const id=String(change?.variableId||dbVariableId(change?.path)||"");
  return getValueDefinition(id)?.name ?? (id||"Database value");
}
function dbVariableOptions(selected="", scope="both") {
  const id=dbVariableId(selected)||String(selected??"");
  return `<option value="">Select Database variable…</option>`+getValueDefinitions(scope).map(v=>`<option value="${e(v.id)}" ${id===v.id?"selected":""}>${e(v.name)} · ${e(v.type)} [${e(v.id)}]</option>`).join("");
}
function preferredVariableId(id="level") {
  return getValueDefinition(id)?.id ?? getValueDefinitions("actor").find(v=>String(v.name).trim().toLowerCase()===id)?.id ?? "";
}

const DEFAULT_SP_VALUE_ID = "";
const DEFAULT_SP_MAX_ID   = "";

function normalizeActorPath(actor, path) {
  let raw = String(path ?? "").trim().replace(/^\{(.+)\}$/, "$1");
  if (!raw) return "";
  if (getValueDefinition(raw)) return valueStoragePath(raw);
  if (/^(?:system|flags|name|img|prototypeToken|ownership)\./.test(raw)) return raw;
  try {
    if (foundry.utils.getProperty(actor, raw) !== undefined) return raw;
    if (foundry.utils.getProperty(actor?.system, raw) !== undefined) return `system.${raw}`;
  } catch {}
  // Common shorthand used in progression configs and imported class items.
  if (/^(?:skillPoints|advancement|resources|attributes|skills|hiddenFields)\./.test(raw)) {
    return `system.${raw}`;
  }
  return raw;
}

function getNestedValue(obj, path) {
  const normalized = normalizeActorPath(obj, path);
  if (!normalized) return undefined;
  try { return foundry.utils.getProperty(obj, normalized); }
  catch { return normalized.split(".").reduce((cur, k) => cur?.[k], obj); }
}

function buildFieldUpdate(actor, change, pending = {}) {
  let { mode, value }=change??{};
  let path = fieldChangeStoragePath(change);
  path = normalizeActorPath(actor, path);
  if (!path) return {};
  const numVal = Number(value);
  const safe   = isNaN(numVal) ? 0 : numVal;
  const current = Object.hasOwn(pending, path)
    ? Number(pending[path] ?? 0)
    : Number(getNestedValue(actor, path) ?? 0);
  let newVal;
  switch (mode) {
    case "set":      newVal = safe; break;
    case "multiply": newVal = current * safe; break;
    default:         newVal = current + safe; break;
  }
  return { [path]: newVal };
}

function _readActorPath(actor, path, fallback = 0) {
  path = normalizeActorPath(actor, path);
  if (!path) return fallback;
  try {
    const v = foundry.utils.getProperty(actor, path);
    return (v === undefined || v === null) ? fallback : v;
  } catch { return fallback; }
}

const _openItemSheetFromSnapshot   = _sharedOpenItem;
const _editEffectViaStandardConfig = _sharedEditEffect;

export class ProgressionApp extends ApplicationV2 {

  static DEFAULT_OPTIONS = {
    id:      "sd-progression",
    classes: ["sd", "sd-progression-app"],
    window: {
      title:       "SD.Progression.Title",
      icon:        "fas fa-star-half-alt",
      resizable:   true,
      minimizable: true
    },
    position: { width: 1080, height: 620 }
  };

  static _instances = new Map();

  static open(actor) {
    let inst = ProgressionApp._instances.get(actor.id);
    if (!inst) {
      inst = new ProgressionApp({ actor });
      ProgressionApp._instances.set(actor.id, inst);
    }
    if (inst.rendered) inst.bringToFront();
    else               inst.render(true);
    return inst;
  }

  constructor(options = {}) {
    super({ ...options, id: `sd-progression-${options.actor?.id ?? "unknown"}` });
    this._actor        = options.actor;
    this._tab          = "levelup";
    this._editMode     = false;
    this._connectFrom  = null;
    this._activeTabId  = null;
    this._pinnedPreview = null;
    this._variantSel    = new Map();
    this._previewTabId  = null;
  }

  _variantKey(levelIdx, choiceIdx) {
    return `${levelIdx}:${choiceIdx}`;
  }
  _getVariantSel(levelIdx, choiceIdx) {
    return this._variantSel.get(this._variantKey(levelIdx, choiceIdx)) ?? 0;
  }
  _setVariantSel(levelIdx, choiceIdx, optIdx) {
    this._variantSel.set(this._variantKey(levelIdx, choiceIdx), optIdx);
  }

  get title() {
    return `${loc("SD.Progression.Title")} — ${this._actor?.name ?? ""}`;
  }

  get _config() {
    return this._actor.getFlag("sd", "progression.config") ?? {};
  }

  get _state() {
    return this._actor.getFlag("sd", "progression.state") ?? { appliedLevel: 0, acquiredNodes: {} };
  }

  _normalizeTabs(cfg) {
    if (Array.isArray(cfg?.tabs) && cfg.tabs.length) {
      return cfg.tabs.map((t, i) => ({
        id:                   t?.id ?? `tab_${i}`,
        name:                 t?.name ?? `${loc("SD.Progression.TabDefaultName") || "Track"} ${i + 1}`,
        classItemId:          t?.classItemId ?? null,
        skilltreeItemId:      t?.skilltreeItemId ?? null,
        inlineLevels:         t?.inlineLevels ?? [],
        inlineSkilltree:      t?.inlineSkilltree ?? null,
        levelVariableId:      t?.levelVariableId ?? dbVariableId(t?.levelPath) ?? preferredVariableId("level"),
        skillPointsValueId: t?.skillPointsValueId ?? dbVariableId(t?.skillPointsPathValue),
        skillPointsMaxId:   t?.skillPointsMaxId ?? dbVariableId(t?.skillPointsPathMax)
      }));
    }
    return [{
      id:                   "default",
      name:                 loc("SD.Progression.TabDefaultName") || "Main",
      classItemId:          cfg?.classItemId ?? null,
      skilltreeItemId:      cfg?.skilltreeItemId ?? null,
      inlineLevels:         cfg?.inlineLevels ?? [],
      inlineSkilltree:      cfg?.inlineSkilltree ?? null,
      levelVariableId:      cfg?.levelVariableId ?? dbVariableId(cfg?.levelPath) ?? preferredVariableId("level"),
      skillPointsValueId: cfg?.skillPointsValueId ?? dbVariableId(cfg?.skillPointsPathValue),
      skillPointsMaxId:   cfg?.skillPointsMaxId ?? dbVariableId(cfg?.skillPointsPathMax)
    }];
  }

  get _tabs() {
    return this._normalizeTabs(this._config);
  }

  _getActiveTab() {
    const tabs = this._tabs;
    if (!tabs.length) return null;
    const t = tabs.find(t => t.id === this._activeTabId);
    return t ?? tabs[0];
  }

  get _levels() {
    const tab = this._getActiveTab();
    if (!tab) return [];
    if (tab.classItemId) {
      const item = this._actor.items.get(tab.classItemId);
      if (item?.type === "class") return item.system.levels ?? [];
    }
    return tab.inlineLevels ?? [];
  }

  get _skilltree() {
    const tab = this._getActiveTab();
    if (!tab) return null;
    if (tab.skilltreeItemId) {
      const item = this._actor.items.get(tab.skilltreeItemId);
      if (item?.type === "skilltree") return item.system;
    }
    return tab.inlineSkilltree ?? null;
  }

  get _spValueId() {
    const tab=this._getActiveTab();
    return tab?.skillPointsValueId ?? dbVariableId(tab?.skillPointsPathValue) ?? DEFAULT_SP_VALUE_ID;
  }

  get _levelVariableId() {
    return this._getActiveTab()?.levelVariableId ?? preferredVariableId("level");
  }

  get _levelValue() {
    const value=this._levelVariableId ? readDatabaseValue(this._actor,this._levelVariableId) : null;
    return Number.isFinite(Number(value)) ? Number(value) : 1;
  }

  get _levelPath() { return this._levelVariableId ? valueStoragePath(this._levelVariableId) : ""; }

  get _spMaxId() {
    const tab=this._getActiveTab();
    return tab?.skillPointsMaxId ?? dbVariableId(tab?.skillPointsPathMax) ?? DEFAULT_SP_MAX_ID;
  }

  get _spValuePath() { return this._spValueId ? valueStoragePath(this._spValueId) : ""; }
  get _spMaxPath() { return this._spMaxId ? valueStoragePath(this._spMaxId) : ""; }

  async _renderHTML(context, options) {
    return this._buildHTML();
  }

  _replaceHTML(result, content, options) {
    content.innerHTML = result;
  }

  async _prepareContext(options) { return {}; }

  _buildHTML() {
    const tabs      = this._tabs;
    const activeTab = this._getActiveTab();
    const levels    = this._levels;
    const st        = this._skilltree;
    const state     = this._state;
    const cfg       = this._config;
    const isGM      = game.user.isGM;
    const em        = this._editMode;

    const hasLevels = levels.length > 0 || em;
    const hasST     = st !== null || em;
    const bothSubTabs = hasLevels && hasST;

    let html = `<div class="sd-prog-app" data-actor-id="${this._actor.id}">`;

    if (tabs.length > 1 || em) {
      html += `<div class="sd-prog-tabnav" style="display:flex;align-items:center;gap:4px;padding:4px 6px;border-bottom:1px solid var(--sd-border);background:var(--sd-bg-2);flex-wrap:wrap;">`;
      for (const t of tabs) {
        const isActive = (t.id === activeTab?.id);
        html += `<a class="sd-prog-track ${isActive ? "active" : ""}" data-action="selectTrack" data-track-id="${e(t.id)}"
                   style="padding:3px 10px;border-radius:6px;cursor:pointer;font-size:12px;background:${isActive ? "var(--sd-accent-bg, var(--sd-bg-3))" : "transparent"};border:1px solid ${isActive ? "var(--sd-accent)" : "var(--sd-border)"};color:${isActive ? "var(--sd-accent)" : "var(--sd-text-2)"};display:inline-flex;align-items:center;gap:4px;">`;
        if (em && isGM) {
          html += `<input type="text" class="sd-prog-track-name" data-action="renameTrack" data-track-id="${e(t.id)}"
                     value="${e(t.name)}" style="background:transparent;border:none;color:inherit;font-size:12px;width:${Math.max(80, (t.name?.length ?? 4) * 7)}px;text-align:center;">`;
        } else {
          html += `<span>${e(t.name)}</span>`;
        }
        if (em && isGM && tabs.length > 1) {
          html += `<button type="button" class="sd-prog-track-del" data-action="deleteTrack" data-track-id="${e(t.id)}" title="${loc("SD.Progression.DeleteTrack")}"
                     style="background:none;border:none;color:var(--sd-text-3);cursor:pointer;font-size:11px;padding:0 2px;"><i class="fas fa-times"></i></button>`;
        }
        html += `</a>`;
      }
      if (em && isGM) {
        html += `<button type="button" class="sd-prog-track-add" data-action="addTrack" title="${loc("SD.Progression.AddTrack")}"
                   style="padding:3px 8px;border-radius:6px;cursor:pointer;font-size:12px;background:var(--sd-bg-3);border:1px solid var(--sd-border);color:var(--sd-text-2);">
                   <i class="fas fa-plus"></i> ${loc("SD.Progression.AddTrack")}</button>`;
      }
      html += `</div>`;
    }

    html += `<div class="sd-prog-topbar">`;

    if (bothSubTabs) {
      html += `
        <a class="sd-prog-tab ${this._tab === "levelup"   ? "active" : ""}" data-tab="levelup">
          <i class="fas fa-arrow-circle-up"></i> ${loc("SD.Progression.LevelUp")}</a>
        <a class="sd-prog-tab ${this._tab === "skilltree" ? "active" : ""}" data-tab="skilltree">
          <i class="fas fa-project-diagram"></i> ${loc("SD.Progression.SkillTree")}</a>`;
    } else if (!hasLevels && !hasST) {
      if (isGM) {
        html += `<span class="sd-prog-hint">${loc("SD.Progression.HintSetup")}</span>`;
      } else {
        html += `<span class="sd-prog-hint">${loc("SD.Progression.HintNotConfigured")}</span>`;
      }
    }

    if (isGM) {
      html += `<a class="sd-prog-edit-toggle ${em ? "active" : ""}" data-action="toggleEdit" title="${loc("SD.Progression.EditMode")}">
        <i class="fas fa-pen-ruler"></i></a>`;
    }

    html += `</div>`;

    if (em && isGM) {
      const valId = this._spValueId;
      const maxId = this._spMaxId;
      html += `<div class="sd-prog-sp-values" style="display:flex;align-items:center;gap:6px;padding:4px 8px;border-bottom:1px solid var(--sd-border);background:var(--sd-bg-2);font-size:11px;flex-wrap:wrap;">
        <span style="color:var(--sd-label);font-weight:600;text-transform:uppercase;letter-spacing:.04em;"><i class="fas fa-database"></i> Skill Point Variables</span>
        <label style="display:inline-flex;align-items:center;gap:4px;color:var(--sd-text-3);">Value
          <select data-action="spSetValueVariable" style="width:230px;font-size:11px;padding:2px 4px;background:var(--sd-bg-3);border:1px solid var(--sd-border);border-radius:4px;color:var(--sd-text);">${dbVariableOptions(valId,"actor")}</select>
        </label>
        <label style="display:inline-flex;align-items:center;gap:4px;color:var(--sd-text-3);">Max
          <select data-action="spSetMaxVariable" style="width:230px;font-size:11px;padding:2px 4px;background:var(--sd-bg-3);border:1px solid var(--sd-border);border-radius:4px;color:var(--sd-text);">${dbVariableOptions(maxId,"actor")}</select>
        </label>
      </div>`;
    }

    html += `<div class="sd-prog-main">`;
    html += `<div class="sd-prog-body sd-prog-left">`;

    if (!bothSubTabs || this._tab === "levelup") {
      html += this._buildLevelUpHTML(levels, state, cfg, em, isGM);
    }
    if (!bothSubTabs || this._tab === "skilltree") {
      html += this._buildSkillTreeHTML(st, state, cfg, em, isGM);
    }

    html += `</div>`;
    html += this._buildPreviewHTML();
    html += `</div>`;

    html += `</div>`;
    return html;
  }

  _buildPreviewHTML() {
    const pin   = this._pinnedPreview;
    const inner = this._renderPreviewInner(pin);
    return `<aside class="sd-prog-right sd-prog-preview" data-pinned="${pin ? "1" : "0"}">
      ${inner}
    </aside>`;
  }

  _renderPreviewInner(payload) {
    if (!payload) {
      return `<div class="sd-prog-preview-empty">
        <i class="fas fa-magnifying-glass"></i>
        <p>${loc("SD.Progression.PreviewHint") || "Hover an item or effect to preview it. Click to pin."}</p>
      </div>`;
    }
    const kind = payload.kind;
    if (kind === "item")    return this._renderItemPreview(payload.data, payload.label, payload.subtitle);
    if (kind === "effect")  return this._renderEffectPreview(payload.data, payload.label);
    if (kind === "fc")      return this._renderFcPreview(payload.data, payload.label);
    if (kind === "node")    return this._renderNodePreview(payload.data);
    return "";
  }

  _previewHeader(title, subtitle, img, isPinned) {
    const sub = subtitle ? `<div class="sd-prog-preview-sub">${e(subtitle)}</div>` : "";
    return `<header class="sd-prog-preview-hdr">
      <div class="sd-prog-preview-img">${img ? `<img src="${e(img)}" alt="">` : `<i class="fas fa-image"></i>`}</div>
      <div class="sd-prog-preview-title-wrap">
        <div class="sd-prog-preview-title">${e(title)}</div>
        ${sub}
      </div>
      <div class="sd-prog-preview-actions">
        ${isPinned ? `<button type="button" class="sd-prog-preview-unpin" data-action="unpinPreview" title="${loc("SD.Progression.Unpin") || "Unpin"}"><i class="fas fa-thumbtack"></i></button>` : ""}
      </div>
    </header>`;
  }

  _renderItemPreview(item, label, subtitle) {
    if (!item) return "";
    const name = label || item.name || "Item";
    const img  = item.img || "icons/svg/item-bag.svg";
    const type = item.type || subtitle || "";

    const tabs = this._collectPreviewTabs(item);
    if (!tabs.length) {
      const body = `<div class="sd-prog-preview-body">
        <div class="sd-prog-preview-empty-mini">${loc("SD.Progression.NoDescription") || "No information."}</div>
      </div>`;
      return this._previewHeader(name, type, img, !!this._pinnedPreview) + body;
    }

    let activeId = this._previewTabId;
    if (!activeId || !tabs.some(t => t.id === activeId)) activeId = tabs[0].id;
    const activeTab = tabs.find(t => t.id === activeId) ?? tabs[0];

    let body = `<div class="sd-prog-preview-body">`;

    if (tabs.length > 1) {
      body += `<nav class="sd-prog-preview-tabs">`;
      for (const t of tabs) {
        body += `<button type="button" class="sd-prog-preview-tab${t.id === activeTab.id ? " active" : ""}" data-preview-tab-id="${e(t.id)}">${t.iconHtml ?? ""}${e(t.label)}</button>`;
      }
      body += `</nav>`;
    }

    body += `<div class="sd-prog-preview-tab-panel" data-tab-id="${e(activeTab.id)}">`;
    body += activeTab.render();
    body += `</div>`;

    body += `</div>`;

    return this._previewHeader(name, type, img, !!this._pinnedPreview) + body;
  }

  _collectPreviewTabs(item) {
    const sys = item.system ?? {};
    const customTabs = Array.isArray(sys.customTabs) ? sys.customTabs : [];
    const out = [];

    for (const tab of customTabs) {
      const rows = Array.isArray(tab.rows) ? tab.rows : [];
      const hasContent = rows.some(r => Array.isArray(r.widgets) && r.widgets.length > 0);
      if (!hasContent && !tab.label) continue;
      out.push({
        id: tab.id ?? `custom-${out.length}`,
        label: tab.label || (loc("SD.Progression.Tab") || "Tab"),
        iconHtml: `<i class="fas fa-folder"></i>`,
        render: () => this._renderPreviewTabRows(item, rows)
      });
    }

    const effects = Array.isArray(item.effects) ? item.effects : [];
    if (effects.length) {
      out.push({
        id: "_sys_effects",
        label: loc("SD.Progression.Effects") || "Effects",
        iconHtml: `<i class="fas fa-sparkles"></i>`,
        render: () => this._renderPreviewEffectsList(effects)
      });
    }

    const tags = Array.isArray(sys.tags) ? sys.tags.filter(Boolean) : [];
    if (tags.length) {
      out.push({
        id: "_sys_tags",
        label: loc("SD.Progression.Tags") || "Tags",
        iconHtml: `<i class="fas fa-tags"></i>`,
        render: () => {
          let h = `<div class="sd-prog-preview-tags">`;
          for (const t of tags) h += `<span class="sd-prog-preview-tag">${e(t)}</span>`;
          h += `</div>`;
          return h;
        }
      });
    }

    if (out.length === 0) {
      const desc = String(sys.description ?? "").trim();
      if (desc) {
        out.push({
          id: "_sys_desc",
          label: loc("SD.Progression.Description") || "Description",
          iconHtml: `<i class="fas fa-scroll"></i>`,
          render: () => `<div class="sd-prog-preview-html">${desc}</div>`
        });
      }
    }

    return out;
  }

  _renderPreviewTabRows(item, rows) {
    if (!rows.length) {
      return `<div class="sd-prog-preview-empty-mini">${loc("SD.Progression.EmptyTab") || "Empty tab."}</div>`;
    }
    let html = `<div class="sd-prog-preview-rows">`;
    for (const row of rows) {
      const cols = Math.max(1, Math.min(9, Number(row.cols) || 3));
      html += `<div class="sd-prog-preview-row" style="display:grid;grid-template-columns:repeat(${cols},1fr);gap:6px;align-items:start;min-width:0;">`;
      for (const w of (row.widgets ?? [])) {
        if (w?.type === "vsection") {
          html += this._renderPreviewVSection(item, w);
        } else {
          html += this._renderPreviewCell(item, row, w);
        }
      }
      html += `</div>`;
    }
    html += `</div>`;
    return html;
  }

  _renderPreviewVSection(item, vs) {
    const span = Math.max(1, Math.min(9, Number(vs.span) || 1));
    let html = `<div class="sd-prog-preview-vsection" style="grid-column:span ${span};display:flex;flex-direction:column;gap:5px;padding:6px;border:1px dashed var(--prog-border, rgba(255,255,255,.1));border-radius:5px;min-width:0;">`;
    if (vs.label) html += `<div class="sd-prog-preview-vsection-title">${e(vs.label)}</div>`;
    for (const cw of (vs.widgets ?? [])) {
      if (cw?.type === "vsection") {
        html += this._renderPreviewVSection(item, cw);
      } else {
        html += this._renderPreviewCell(item, { cols: 1 }, cw, true);
      }
    }
    html += `</div>`;
    return html;
  }

  _renderPreviewCell(item, row, w, insideVS = false) {
    if (!w) return "";
    const rowCols = Math.max(1, Math.min(9, Number(row.cols) || 3));
    const span = insideVS ? 1 : Math.max(1, Math.min(rowCols, Number(w.span) || 1));
    let inner = "";
    try {
      inner = WidgetRenderer.render(w, item, false) ?? "";
    } catch (err) {
      inner = `<div class="sd-prog-preview-widget-err">${e(String(err?.message ?? err))}</div>`;
    }
    if (!inner?.trim()) return "";
    return `<div class="sd-prog-preview-cell" style="grid-column:span ${span};min-width:0;">${inner}</div>`;
  }

  _renderPreviewEffectsList(effects) {
    let html = `<div class="sd-prog-preview-effects-list">`;
    for (const ef of effects) {
      const changes = Array.isArray(ef.changes) ? ef.changes : [];
      const disabled = !!ef.disabled;
      html += `<div class="sd-prog-preview-effect-card${disabled ? " is-disabled" : ""}">
        <div class="sd-prog-preview-effect-hdr">
          <img src="${e(ef.icon ?? ef.img ?? "icons/svg/aura.svg")}" alt="">
          <span class="sd-prog-preview-effect-name">${e(ef.name ?? "Effect")}</span>
          ${disabled ? `<span class="sd-prog-preview-pill is-off">${loc("SD.Progression.EffectDisabled") || "Disabled"}</span>` : `<span class="sd-prog-preview-pill is-on">${loc("SD.Progression.Enabled") || "Enabled"}</span>`}
        </div>`;
      if (changes.length) {
        html += `<div class="sd-prog-preview-changes">`;
        for (const ch of changes) {
          const modeNum = Number(ch.mode);
          const sym = modeNum === 5 ? "↑" : modeNum === 4 ? "↓" : modeNum === 3 ? "×" : modeNum === 6 ? "=" : modeNum === 1 ? "+" : modeNum === 0 ? "⊕" : "?";
          html += `<div class="sd-prog-preview-change-row">
            <code>${e(ch.key ?? "")}</code>
            <span class="sd-prog-preview-change-sym">${sym}</span>
            <strong>${e(String(ch.value ?? ""))}</strong>
          </div>`;
        }
        html += `</div>`;
      }
      html += `</div>`;
    }
    html += `</div>`;
    return html;
  }

  _renderEffectPreview(ef, label) {
    if (!ef) return "";
    const name = label || ef.name || "Effect";
    const img  = ef.icon || ef.img || "icons/svg/aura.svg";
    const changes = Array.isArray(ef.changes) ? ef.changes : [];
    const disabled = !!ef.disabled;

    let body = `<div class="sd-prog-preview-body">`;

    body += `<div class="sd-prog-preview-section">
      <div class="sd-prog-preview-section-title"><i class="fas fa-magic"></i> ${loc("SD.Progression.Effects") || "Effect"}</div>
      <div class="sd-prog-preview-meta">
        <span class="sd-prog-preview-pill ${disabled ? "is-off" : "is-on"}">${disabled ? (loc("SD.Progression.EffectDisabled") || "Disabled") : (loc("SD.Progression.EffectEnabled") || "Enabled")}</span>
        <span class="sd-prog-preview-pill">${changes.length} ${loc("SD.Progression.EffectChanges") || "changes"}</span>
      </div>
    </div>`;

    if (changes.length) {
      body += `<div class="sd-prog-preview-section">
        <div class="sd-prog-preview-section-title"><i class="fas fa-sliders-h"></i> ${loc("SD.Progression.Changes") || "Changes"}</div>
        <div class="sd-prog-preview-changes">`;
      for (const ch of changes) {
        const modeNum = Number(ch.mode);
        const sym = modeNum === 5 ? "↑" : modeNum === 4 ? "↓" : modeNum === 3 ? "×" : modeNum === 6 ? "=" : modeNum === 1 ? "+" : modeNum === 0 ? "⊕" : "?";
        body += `<div class="sd-prog-preview-change-row">
          <code>${e(ch.key ?? "")}</code>
          <span class="sd-prog-preview-change-sym">${sym}</span>
          <strong>${e(String(ch.value ?? ""))}</strong>
        </div>`;
      }
      body += `</div></div>`;
    } else {
      body += `<div class="sd-prog-preview-empty-mini">${loc("SD.Progression.NoChanges") || "This effect has no changes."}</div>`;
    }

    body += `</div>`;

    return this._previewHeader(name, loc("SD.Progression.Effects") || "Effect", img, !!this._pinnedPreview) + body;
  }

  _renderFcPreview(fc, label) {
    if (!fc) return "";
    const name = label || dbVariableLabel(fc);
    const sym = fc.mode === "set" ? "=" : fc.mode === "multiply" ? "×" : "+";
    const body = `<div class="sd-prog-preview-body">
      <div class="sd-prog-preview-section">
        <div class="sd-prog-preview-section-title"><i class="fas fa-sliders-h"></i> ${loc("SD.Progression.FieldChange") || "Field Change"}</div>
        <div class="sd-prog-preview-fc">
          <code>${e(dbVariableLabel(fc))}</code>
          <span class="sd-prog-preview-fc-sym">${sym}</span>
          <strong>${e(String(fc.value ?? ""))}</strong>
        </div>
      </div>
    </div>`;
    return this._previewHeader(name, loc("SD.Progression.FieldChange") || "Field Change", "icons/svg/upgrade.svg", !!this._pinnedPreview) + body;
  }

  _renderNodePreview(node) {
    if (!node) return "";
    if (node.item) {
      let inner = this._renderItemPreview(node.item, node.label || node.item.name, node.item.type);
      const extras = [];
      if (typeof node.cost === "number")       extras.push(`<span class="sd-prog-preview-pill"><i class="fas fa-star"></i> ${node.cost} ${loc("SD.Progression.SkillPoints") || "SP"}</span>`);
      if ((node.maxAcquire ?? 1) > 1)          extras.push(`<span class="sd-prog-preview-pill"><i class="fas fa-redo"></i> ×${node.maxAcquire}</span>`);
      if (node.fieldChanges?.length)           extras.push(`<span class="sd-prog-preview-pill"><i class="fas fa-sliders-h"></i> ${node.fieldChanges.length} ${loc("SD.Progression.FieldChanges") || "field changes"}</span>`);
      if (node.effects?.length)                extras.push(`<span class="sd-prog-preview-pill"><i class="fas fa-magic"></i> ${node.effects.length} ${loc("SD.Progression.Effects") || "effects"}</span>`);
      if (extras.length) {
        inner = inner.replace('<div class="sd-prog-preview-body">', `<div class="sd-prog-preview-body"><div class="sd-prog-preview-meta">${extras.join("")}</div>`);
      }
      return inner;
    }
    const name = node.label || "Skill Node";
    let body = `<div class="sd-prog-preview-body">
      <div class="sd-prog-preview-meta">
        ${typeof node.cost === "number" ? `<span class="sd-prog-preview-pill"><i class="fas fa-star"></i> ${node.cost} ${loc("SD.Progression.SkillPoints") || "SP"}</span>` : ""}
        ${(node.maxAcquire ?? 1) > 1   ? `<span class="sd-prog-preview-pill"><i class="fas fa-redo"></i> ×${node.maxAcquire}</span>` : ""}
      </div>`;
    if (node.fieldChanges?.length) {
      body += `<div class="sd-prog-preview-section">
        <div class="sd-prog-preview-section-title"><i class="fas fa-sliders-h"></i> ${loc("SD.Progression.FieldChanges") || "Field Changes"}</div>
        <div class="sd-prog-preview-changes">`;
      for (const fc of node.fieldChanges) {
        const sym = fc.mode === "set" ? "=" : fc.mode === "multiply" ? "×" : "+";
        body += `<div class="sd-prog-preview-change-row"><code>${e(dbVariableLabel(fc))}</code><span class="sd-prog-preview-change-sym">${sym}</span><strong>${e(String(fc.value ?? ""))}</strong></div>`;
      }
      body += `</div></div>`;
    }
    if (node.effects?.length) {
      body += `<div class="sd-prog-preview-section">
        <div class="sd-prog-preview-section-title"><i class="fas fa-magic"></i> ${loc("SD.Progression.Effects") || "Effects"}</div>
        <div class="sd-prog-preview-changes">`;
      for (const ef of node.effects) {
        body += `<div class="sd-prog-preview-change-row"><img src="${e(ef.icon ?? ef.img ?? "icons/svg/aura.svg")}" style="width:14px;height:14px;border-radius:2px;"><span>${e(ef.name ?? "Effect")}</span><strong>${(ef.changes ?? []).length}</strong></div>`;
      }
      body += `</div></div>`;
    }
    body += `</div>`;
    return this._previewHeader(name, loc("SD.Progression.SkillNode") || "Skill Node", "icons/svg/upgrade.svg", !!this._pinnedPreview) + body;
  }

  _buildLevelUpHTML(levels, state, cfg, em, isGM) {
    const appliedLevel = state.appliedLevel ?? 0;
    const curLevel     = this._levelValue;

    let html = `<div class="sd-prog-levelup">`;

    if (em && isGM) {

    }

    html += `<div class="sd-prog-lu-hdr">
      <div class="sd-prog-cur-level">
        <span class="sd-prog-cur-num">${curLevel}</span>
        <span class="sd-prog-cur-lbl">${loc("SD.Progression.CurrentLevel")}</span>
      </div>`;

    if (em && isGM) {
      html += `<label class="sd-prog-level-variable"><i class="fas fa-cube"></i><span>Level Variable</span><select data-action="changeLevelVariable">${dbVariableOptions(this._levelVariableId,"actor")}</select></label>`;
    }

    if (em && isGM) {
      const tab = this._getActiveTab();
      const ci  = tab?.classItemId ? this._actor.items.get(tab.classItemId) : null;
      html += `<div class="sd-prog-source-drop" data-action="dropClassItem" title="${loc("SD.Progression.DropClassHere")}">`;
      if (ci) {
        html += `<img src="${ci.img ?? "icons/svg/item-bag.svg"}" style="width:18px;height:18px;border-radius:3px;margin-right:4px;">
                 ${e(ci.name)}
                 <button type="button" class="sd-prog-unlink" data-action="unlinkClass"><i class="fas fa-times"></i></button>`;
      } else {
        html += `<i class="fas fa-graduation-cap" style="margin-right:5px;opacity:.5;"></i>
                 <span style="opacity:.6;">${loc("SD.Progression.DropClassHere")}</span>`;
      }
      html += `</div>
        <button type="button" class="sd-prog-add-btn" data-action="addLevel">
          <i class="fas fa-plus"></i> ${loc("SD.Progression.AddLevel")}
        </button>`;
    }

    html += `</div>`;

    if (em && isGM) {
      html += `<div class="sd-prog-editor-hint"><i class="fas fa-circle-info"></i> ${loc("SD.Progression.EditorHint")}</div>`;
    }

    if (levels.length === 0) {
      html += `<p class="sd-prog-empty">${em ? loc("SD.Progression.EmptyClickAdd") : loc("SD.Progression.NoLevels")}</p>`;
    }

    html += `<div class="sd-prog-levels-list">`;

    for (let i = 0; i < levels.length; i++) {
      const lv        = levels[i];
      const applied   = appliedLevel >= lv.level;
      const isNext    = !applied && (i === 0 || appliedLevel >= (levels[i - 1]?.level ?? 0));
      const classes   = ["sd-prog-level-entry", applied ? "applied" : "", isNext ? "next" : ""].filter(Boolean).join(" ");

      html += `<div class="${classes}" data-level-idx="${i}">`;

      html += `<div class="sd-prog-le-hdr">
        <span class="sd-prog-le-badge"><i class="fas fa-chevron-up"></i> ${loc("SD.Progression.Level")} ${lv.level}</span>`;

      if (em && isGM) {
        html += `<input class="sd-prog-le-label-inp" type="text" value="${e(lv.label ?? "")}"
                   placeholder="${loc("SD.Progression.LabelPlaceholder")}"
                   data-action="changeLevelLabel" data-idx="${i}">`;
      } else if (lv.label) {
        html += `<span class="sd-prog-le-label">${e(lv.label)}</span>`;
      }

      html += `<div class="sd-prog-le-hdr-right">`;

      if (!em && isNext) {
        const hasChoices = Array.isArray(lv.choices) && lv.choices.some(c => Array.isArray(c.options) && c.options.length > 0);
        html += `<button type="button" class="sd-prog-apply-btn" data-action="applyLevel" data-idx="${i}"
          title="${hasChoices ? loc("SD.Progression.ApplyChooseHint") : ""}">
          <i class="fas ${hasChoices ? "fa-list-check" : "fa-check"}"></i> ${hasChoices ? loc("SD.Progression.ApplyChoose") : loc("SD.Progression.Apply")}
        </button>`;
      } else if (!em && applied) {
        html += `<span class="sd-prog-applied-badge"><i class="fas fa-check-circle"></i> ${loc("SD.Progression.Applied")}</span>`;

        if (lv.level === appliedLevel) {
          html += `<button type="button" class="sd-prog-rollback-btn" data-action="rollbackLevel" data-idx="${i}" title="${loc("SD.Progression.Rollback") || "Rollback"}">
            <i class="fas fa-rotate-left"></i> ${loc("SD.Progression.Rollback") || "Rollback"}
          </button>`;
        }
      }

      if (em && isGM) {
        html += `<button type="button" class="sd-prog-del-btn" data-action="deleteLevel" data-idx="${i}">
          <i class="fas fa-trash"></i></button>`;
      }

      html += `</div></div>`;

      html += `<div class="sd-prog-le-rewards">`;
      html += this._renderColumnItems(lv, i, em, isGM);
      html += this._renderColumnFieldChanges(lv, i, em, isGM);
      html += this._renderColumnEffects(lv, i, em, isGM);
      html += `</div>`;

      html += `</div>`;
    }

    html += `</div></div>`;
    return html;
  }

  _renderColumnItems(lv, i, em, isGM) {
    const items   = lv.items ?? [];
    const choices = (lv.choices ?? []).map((c, gi) => ({ ch: c, gi })).filter(o => (o.ch.kind ?? "items") === "items");

    let html = `<div class="sd-prog-le-col" data-col="items">
      <div class="sd-prog-le-sec-title">
        <i class="fas fa-backpack"></i> ${loc("SD.Progression.Items")}
        ${em && isGM ? `<button type="button" class="sd-prog-mini-add labeled" data-action="addChoice" data-level-idx="${i}" data-kind="items" title="${loc("SD.Progression.AddItemsChoice") || "Add items choice group"}"><i class="fas fa-code-branch"></i> ${loc("SD.Progression.PlayerChoice")}</button>` : ""}
      </div>
      <div class="sd-prog-items-zone ${em ? "droppable" : ""}" data-drop-target="levelItem" data-level-idx="${i}">`;

    if (items.length === 0 && em) {
      html += `<span class="sd-prog-drop-hint"><i class="fas fa-arrow-alt-circle-down"></i> ${loc("SD.Progression.DropItemsHere")}</span>`;
    }
    for (let j = 0; j < items.length; j++) {
      const it = items[j];
      html += `<div class="sd-prog-item-chip" draggable="false"
        data-preview-kind="item"
        data-preview-ref="level:${i}:items:${j}"
        data-snapshot-ref="level:${i}:${j}"
        title="${loc("SD.Progression.RightClickOpen") || "Right-click to open item"}">
        <img src="${e(it.img ?? "icons/svg/item-bag.svg")}">
        <span>${e(it.name ?? "Item")}</span>
        ${em ? `<button type="button" data-action="removeLevelItem" data-level-idx="${i}" data-item-idx="${j}" data-stop-preview="1"><i class="fas fa-times"></i></button>` : ""}
      </div>`;
    }
    html += `</div>`;

    for (const { ch, gi } of choices) html += this._renderChoiceGroup(lv, i, gi, ch, "items", em, isGM);

    html += `</div>`;
    return html;
  }

  _renderColumnFieldChanges(lv, i, em, isGM) {
    const fcs     = lv.fieldChanges ?? [];
    const choices = (lv.choices ?? []).map((c, gi) => ({ ch: c, gi })).filter(o => (o.ch.kind ?? "items") === "fieldChanges");

    let html = `<div class="sd-prog-le-col" data-col="fieldChanges">
      <div class="sd-prog-le-sec-title">
        <i class="fas fa-sliders-h"></i> ${loc("SD.Progression.FieldChanges")}
        ${em ? `<button type="button" class="sd-prog-mini-add labeled" data-action="addFieldChange" data-level-idx="${i}" title="${loc("SD.Progression.AddFieldChange")}"><i class="fas fa-plus"></i> ${loc("SD.Progression.BtnAdd")}</button>` : ""}
        ${em && isGM ? `<button type="button" class="sd-prog-mini-add labeled" data-action="addChoice" data-level-idx="${i}" data-kind="fieldChanges" title="${loc("SD.Progression.AddFcChoice") || "Add field-change choice group"}"><i class="fas fa-code-branch"></i> ${loc("SD.Progression.PlayerChoice")}</button>` : ""}
      </div>`;

    if (fcs.length === 0 && !em) {
      html += `<span class="sd-prog-empty-small">—</span>`;
    }
    for (let j = 0; j < fcs.length; j++) {
      const fc = fcs[j];
      if (em) {
        const mAdd  = fc.mode === "add"      ? "selected" : "";
        const mSet  = fc.mode === "set"      ? "selected" : "";
        const mMul  = fc.mode === "multiply" ? "selected" : "";
        html += `<div class="sd-prog-fc-row"
          data-preview-kind="fc"
          data-preview-ref="level:${i}:fc:${j}">
          <select class="sd-prog-fc-variable" data-action="fcChangeVariable" data-level-idx="${i}" data-fc-idx="${j}">${dbVariableOptions(fc.variableId||fc.path,"actor")}</select>
          <select class="sd-prog-fc-mode" data-action="fcChangeMode" data-level-idx="${i}" data-fc-idx="${j}">
            <option value="add"      ${mAdd}>+</option>
            <option value="set"      ${mSet}>=</option>
            <option value="multiply" ${mMul}>×</option>
          </select>
          <input type="text" class="sd-prog-fc-value" value="${e(fc.value)}"
                 placeholder="0"
                 data-action="fcChangeValue" data-level-idx="${i}" data-fc-idx="${j}">
          <button type="button" class="sd-prog-fc-del" data-action="removeFc" data-level-idx="${i}" data-fc-idx="${j}" data-stop-preview="1">
            <i class="fas fa-times"></i></button>
        </div>`;
      } else {
        const sym = fc.mode === "set" ? "=" : fc.mode === "multiply" ? "×" : "+";
        html += `<div class="sd-prog-fc-view"
          data-preview-kind="fc"
          data-preview-ref="level:${i}:fc:${j}">
          <code>${e(dbVariableLabel(fc))}</code>
          <span class="sd-prog-fc-sym">${sym}</span>
          <strong>${e(fc.value)}</strong>
        </div>`;
      }
    }

    for (const { ch, gi } of choices) html += this._renderChoiceGroup(lv, i, gi, ch, "fieldChanges", em, isGM);

    html += `</div>`;
    return html;
  }

  _renderColumnEffects(lv, i, em, isGM) {
    const effects = lv.effects ?? [];
    const choices = (lv.choices ?? []).map((c, gi) => ({ ch: c, gi })).filter(o => (o.ch.kind ?? "items") === "effects");

    let html = `<div class="sd-prog-le-col" data-col="effects">
      <div class="sd-prog-le-sec-title">
        <i class="fas fa-magic"></i> ${loc("SD.Progression.Effects")}
        ${em ? `<button type="button" class="sd-prog-mini-add labeled" data-action="addEffect" data-level-idx="${i}" title="${loc("SD.Progression.AddEffect") || "Add effect"}"><i class="fas fa-plus"></i> ${loc("SD.Progression.BtnAdd")}</button>` : ""}
        ${em && isGM ? `<button type="button" class="sd-prog-mini-add labeled" data-action="addChoice" data-level-idx="${i}" data-kind="effects" title="${loc("SD.Progression.AddEffectsChoice") || "Add effects choice group"}"><i class="fas fa-code-branch"></i> ${loc("SD.Progression.PlayerChoice")}</button>` : ""}
      </div>`;

    if (effects.length === 0 && !em) {
      html += `<span class="sd-prog-empty-small">—</span>`;
    }
    for (let j = 0; j < effects.length; j++) {
      const ef = effects[j];
      const efTitle = ef.disabled ? `${e(ef.name ?? "Effect")} (${loc("SD.Progression.EffectDisabled")})` : e(ef.name ?? "Effect");
      html += `<div class="sd-prog-effect-chip${ef.disabled ? " disabled" : ""}"
        data-preview-kind="effect"
        data-preview-ref="level:${i}:effects:${j}"
        title="${efTitle}">
        <img src="${e(ef.img ?? ef.icon ?? "icons/svg/aura.svg")}" style="width:16px;height:16px;border-radius:2px;margin-right:4px;">
        <span class="sd-prog-effect-name">${e(ef.name ?? "Effect")}</span>
        ${ef.changes?.length ? `<span class="sd-prog-effect-count" title="${loc("SD.Progression.EffectChangesCount")}">${ef.changes.length}</span>` : ""}
        ${em ? `<button type="button" data-action="editEffect" data-level-idx="${i}" data-effect-idx="${j}" title="${loc("SD.Progression.EditEffect")}" data-stop-preview="1"><i class="fas fa-pen"></i></button>` : ""}
        ${em ? `<button type="button" data-action="removeEffect" data-level-idx="${i}" data-effect-idx="${j}" title="${loc("SD.Progression.RemoveEffect")}" data-stop-preview="1"><i class="fas fa-times"></i></button>` : ""}
      </div>`;
    }

    for (const { ch, gi } of choices) html += this._renderChoiceGroup(lv, i, gi, ch, "effects", em, isGM);

    html += `</div>`;
    return html;
  }

  _renderChoiceGroup(lv, i, gi, ch, kind, em, isGM) {
    const opts  = Array.isArray(ch.options) ? ch.options : [];
    const picks = Math.max(1, Number(ch.picks) || 1);
    const sel   = Math.min(this._getVariantSel(i, gi), Math.max(0, opts.length - 1));

    let html = `<div class="sd-prog-choice-grp sd-prog-choice-inline" data-choice-idx="${gi}" data-level-idx="${i}" data-kind="${e(kind)}">`;

    html += `<div class="sd-prog-choice-inline-hdr">
      <span class="sd-prog-choice-inline-icon"><i class="fas fa-code-branch"></i></span>
      ${em && isGM
        ? `<input type="text" class="sd-prog-choice-label" value="${e(ch.label ?? "")}"
                 placeholder="${loc("SD.Progression.ChoiceLabelPlaceholder") || "Variant label"}"
                 data-action="choiceChangeLabel" data-level-idx="${i}" data-choice-idx="${gi}">`
        : `<span class="sd-prog-choice-inline-label">${e(ch.label || loc("SD.Progression.PlayerChoice") || "Player choice")}</span>`}
    </div>
    <div class="sd-prog-choice-inline-sub">
      <span class="sd-prog-choice-inline-meta">${(loc("SD.Progression.PlayerChoicePicks") || "Player picks {n} of {total}").replace("{n}", picks).replace("{total}", opts.length)}</span>
      ${em && isGM ? `<label class="sd-prog-choice-picks-mini" title="${loc("SD.Progression.Picks") || "Picks"}">
        <i class="fas fa-hand-pointer"></i> <span>${loc("SD.Progression.Picks") || "Picks"}</span>
        <input type="number" min="1" step="1" value="${picks}"
               data-action="choiceChangePicks" data-level-idx="${i}" data-choice-idx="${gi}">
      </label>` : ""}
      ${em && isGM ? `<button type="button" class="sd-prog-choice-del" data-action="removeChoice" data-level-idx="${i}" data-choice-idx="${gi}" title="${loc("SD.Progression.RemoveChoice") || "Remove variants"}"><i class="fas fa-times"></i></button>` : ""}
    </div>`;

    if (opts.length === 0) {
      html += `<div class="sd-prog-choice-inline-body is-empty">`;
      if (em && isGM) {
        if (kind === "items") {
          html += `<div class="sd-prog-items-zone sd-prog-choice-zone droppable" data-drop-target="choiceItem" data-level-idx="${i}" data-choice-idx="${gi}">
            <span class="sd-prog-drop-hint"><i class="fas fa-arrow-alt-circle-down"></i> ${loc("SD.Progression.DropItemsHere")}</span>
          </div>`;
        } else if (kind === "effects") {
          html += `<button type="button" class="sd-prog-mini-add wide" data-action="addChoiceEffect" data-level-idx="${i}" data-choice-idx="${gi}"><i class="fas fa-plus"></i> ${loc("SD.Progression.AddEffectOption") || "Add effect option"}</button>`;
        } else if (kind === "fieldChanges") {
          html += `<button type="button" class="sd-prog-mini-add wide" data-action="addChoiceFc" data-level-idx="${i}" data-choice-idx="${gi}"><i class="fas fa-plus"></i> ${loc("SD.Progression.AddFcOption") || "Add field-change option"}</button>`;
        }
      } else {
        html += `<span class="sd-prog-empty-small">${loc("SD.Progression.NoOptions") || "No options."}</span>`;
      }
      html += `</div></div>`;
      return html;
    }

    html += `<div class="sd-prog-choice-inline-row">`;
    html += `<div class="sd-prog-choice-inline-current">`;

    if (em && isGM) {
      if (kind === "items") {
        html += `<div class="sd-prog-items-zone sd-prog-choice-zone droppable" data-drop-target="choiceItem" data-level-idx="${i}" data-choice-idx="${gi}">`;
        for (let j = 0; j < opts.length; j++) {
          const it = opts[j];
          const active = j === sel ? " active-variant" : "";
          html += `<div class="sd-prog-item-chip${active}"
            data-preview-kind="item"
            data-preview-ref="choice:${i}:${gi}:${j}">
            <img src="${e(it.img ?? "icons/svg/item-bag.svg")}">
            <span>${e(it.name ?? "Item")}</span>
            <button type="button" data-action="removeChoiceOption" data-level-idx="${i}" data-choice-idx="${gi}" data-opt-idx="${j}" data-stop-preview="1"><i class="fas fa-times"></i></button>
          </div>`;
        }
        html += `</div>`;
      } else if (kind === "effects") {
        html += `<div class="sd-prog-choice-list">`;
        for (let j = 0; j < opts.length; j++) {
          const ef = opts[j];
          const active = j === sel ? " active-variant" : "";
          html += `<div class="sd-prog-effect-chip${ef.disabled ? " disabled" : ""}${active}"
            data-preview-kind="effect"
            data-preview-ref="choice:${i}:${gi}:${j}">
            <img src="${e(ef.img ?? ef.icon ?? "icons/svg/aura.svg")}" style="width:16px;height:16px;border-radius:2px;margin-right:4px;">
            <span class="sd-prog-effect-name">${e(ef.name ?? "Effect")}</span>
            ${ef.changes?.length ? `<span class="sd-prog-effect-count">${ef.changes.length}</span>` : ""}
            <button type="button" data-action="editChoiceEffect" data-level-idx="${i}" data-choice-idx="${gi}" data-opt-idx="${j}" title="${loc("SD.Progression.EditEffect")}" data-stop-preview="1"><i class="fas fa-pen"></i></button>
            <button type="button" data-action="removeChoiceOption" data-level-idx="${i}" data-choice-idx="${gi}" data-opt-idx="${j}" data-stop-preview="1"><i class="fas fa-times"></i></button>
          </div>`;
        }
        html += `<button type="button" class="sd-prog-mini-add wide" data-action="addChoiceEffect" data-level-idx="${i}" data-choice-idx="${gi}"><i class="fas fa-plus"></i> ${loc("SD.Progression.AddEffectOption") || "Add effect"}</button>`;
        html += `</div>`;
      } else if (kind === "fieldChanges") {
        html += `<div class="sd-prog-choice-list">`;
        for (let j = 0; j < opts.length; j++) {
          const fc = opts[j];
          const mAdd = fc.mode === "add" ? "selected" : "";
          const mSet = fc.mode === "set" ? "selected" : "";
          const mMul = fc.mode === "multiply" ? "selected" : "";
          const active = j === sel ? " active-variant" : "";
          html += `<div class="sd-prog-fc-row${active}"
            data-preview-kind="fc"
            data-preview-ref="choice:${i}:${gi}:${j}">
            <select class="sd-prog-fc-variable" data-action="choiceFcChangeVariable" data-level-idx="${i}" data-choice-idx="${gi}" data-opt-idx="${j}">${dbVariableOptions(fc.variableId||fc.path,"actor")}</select>
            <select class="sd-prog-fc-mode" data-action="choiceFcChangeMode" data-level-idx="${i}" data-choice-idx="${gi}" data-opt-idx="${j}">
              <option value="add"      ${mAdd}>+</option>
              <option value="set"      ${mSet}>=</option>
              <option value="multiply" ${mMul}>×</option>
            </select>
            <input type="text" class="sd-prog-fc-value" value="${e(fc.value ?? "")}"
                   placeholder="0"
                   data-action="choiceFcChangeValue" data-level-idx="${i}" data-choice-idx="${gi}" data-opt-idx="${j}">
            <button type="button" class="sd-prog-fc-del" data-action="removeChoiceOption" data-level-idx="${i}" data-choice-idx="${gi}" data-opt-idx="${j}" data-stop-preview="1">
              <i class="fas fa-times"></i></button>
          </div>`;
        }
        html += `<button type="button" class="sd-prog-mini-add wide" data-action="addChoiceFc" data-level-idx="${i}" data-choice-idx="${gi}"><i class="fas fa-plus"></i> ${loc("SD.Progression.AddFcOption") || "Add field change"}</button>`;
        html += `</div>`;
      }
    } else {
      const opt = opts[sel];
      if (!opt) {
        html += `<span class="sd-prog-empty-small">—</span>`;
      } else if (kind === "items") {
        html += `<div class="sd-prog-item-chip variant-display"
          data-preview-kind="item"
          data-preview-ref="choice:${i}:${gi}:${sel}">
          <img src="${e(opt.img ?? "icons/svg/item-bag.svg")}">
          <span>${e(opt.name ?? "Item")}</span>
        </div>`;
      } else if (kind === "effects") {
        html += `<div class="sd-prog-effect-chip variant-display"
          data-preview-kind="effect"
          data-preview-ref="choice:${i}:${gi}:${sel}">
          <img src="${e(opt.img ?? opt.icon ?? "icons/svg/aura.svg")}" style="width:16px;height:16px;border-radius:2px;margin-right:4px;">
          <span class="sd-prog-effect-name">${e(opt.name ?? "Effect")}</span>
          ${opt.changes?.length ? `<span class="sd-prog-effect-count">${opt.changes.length}</span>` : ""}
        </div>`;
      } else if (kind === "fieldChanges") {
        const sym = opt.mode === "set" ? "=" : opt.mode === "multiply" ? "×" : "+";
        html += `<div class="sd-prog-fc-view variant-display"
          data-preview-kind="fc"
          data-preview-ref="choice:${i}:${gi}:${sel}">
          <code>${e(opt.path ?? "")}</code>
          <span class="sd-prog-fc-sym">${sym}</span>
          <strong>${e(String(opt.value ?? ""))}</strong>
        </div>`;
      }
    }

    html += `</div>`;

    if (opts.length > 1) {
      html += `<div class="sd-prog-variant-switcher" data-level-idx="${i}" data-choice-idx="${gi}">
        <span class="sd-prog-variant-note" title="${loc("SD.Progression.PreviewOnlyHint")}"><i class="fas fa-eye"></i> ${loc("SD.Progression.PreviewOnly")}</span>`;
      for (let j = 0; j < opts.length; j++) {
        html += `<button type="button" class="sd-prog-variant-btn${j === sel ? " active" : ""}" data-action="pickVariant" data-level-idx="${i}" data-choice-idx="${gi}" data-opt-idx="${j}">${j + 1}</button>`;
      }
      html += `</div>`;
    }

    html += `</div></div>`;
    return html;
  }

  _buildSkillTreeHTML(st, state, cfg, em, isGM) {
    const acquiredNodes = state.acquiredNodes ?? {};
    const CELL = 74;
    const GAP  = 5;
    const tab  = this._getActiveTab();

    let html = `<div class="sd-prog-skilltree">`;

  html += `<div class="sd-prog-st-toolbar">`;

  const valPath = this._spValuePath;
  const maxPath = this._spMaxPath;
  const spValue = Number(_readActorPath(this._actor, valPath, 0)) || 0;
  const spMax   = Number(_readActorPath(this._actor, maxPath, 0)) || 0;

  html += `<div class="sd-prog-sp-block" style="display:flex;align-items:center;gap:6px;padding:2px 8px;background:var(--sd-bg-3);border:1px solid var(--sd-border);border-radius:6px;margin-right:auto;">
    <i class="fas fa-star" style="color:var(--sd-accent);font-size:12px;"></i>
    <span style="font-size:11px;color:var(--sd-label);font-weight:600;text-transform:uppercase;letter-spacing:.04em;">${loc("SD.Progression.SkillPoints")}</span>
    <button type="button" data-action="spStep" data-step="-1" style="width:22px;height:22px;background:var(--sd-bg-2);border:1px solid var(--sd-border);border-radius:4px;color:var(--sd-text-2);cursor:pointer;font-size:14px;line-height:1;flex-shrink:0;">−</button>
    <input type="number" data-action="spSetValue" value="${spValue}" min="0" style="width:40px;text-align:center;font-weight:700;font-size:14px;background:var(--sd-bg-2);border:1px solid var(--sd-border);border-radius:4px;color:var(--sd-text);padding:2px;box-sizing:border-box;">
    <span style="color:var(--sd-text-3);flex-shrink:0;">/</span>
    <input type="number" data-action="spSetMax" value="${spMax}" min="0" style="width:40px;text-align:center;font-size:13px;background:var(--sd-bg-2);border:1px solid var(--sd-border);border-radius:4px;color:var(--sd-text-2);padding:2px;box-sizing:border-box;">
    <button type="button" data-action="spStep" data-step="1" style="width:22px;height:22px;background:var(--sd-bg-2);border:1px solid var(--sd-border);border-radius:4px;color:var(--sd-text-2);cursor:pointer;font-size:14px;line-height:1;flex-shrink:0;">+</button>
    <button type="button" data-action="spCopyPath" title="${e(valPath)}" style="background:none;border:none;color:var(--sd-text-3);cursor:pointer;font-size:11px;padding:0 4px;flex-shrink:0;"><i class="fas fa-copy"></i></button>
  </div>`;

  if (em && isGM) {
    const sti = tab?.skilltreeItemId ? this._actor.items.get(tab.skilltreeItemId) : null;
    html += `<div class="sd-prog-source-drop" data-action="dropSkilltreeItem">`;
    if (sti) {
      html += `<img src="${sti.img ?? "icons/svg/item-bag.svg"}" style="width:18px;height:18px;border-radius:3px;margin-right:4px;">
      ${e(sti.name)}
      <button type="button" class="sd-prog-unlink" data-action="unlinkSkilltree"><i class="fas fa-times"></i></button>`;
    } else {
      html += `<i class="fas fa-project-diagram" style="margin-right:5px;opacity:.5;"></i>
      <span style="opacity:.6;">${loc("SD.Progression.DropSkilltreeHere")}</span>`;
    }
    html += `</div>`;

    if (!tab?.skilltreeItemId) {
      const cols = st?.cols ?? 8;
      const rows = st?.rows ?? 5;
      html += `
      <label class="sd-prog-dim-lbl">${loc("SD.Progression.Cols")}
        <input type="number" value="${cols}" min="2" max="20" data-action="stSetCols" style="width:46px"></label>
      <label class="sd-prog-dim-lbl">${loc("SD.Progression.Rows")}
        <input type="number" value="${rows}" min="2" max="20" data-action="stSetRows" style="width:46px"></label>`;
    }

    if (this._connectFrom) {
      html += `<button type="button" class="sd-prog-conn-cancel" data-action="cancelConnect">
        <i class="fas fa-unlink"></i> ${loc("SD.Progression.CancelConnect")}</button>`;
    } else {
      html += `<button type="button" class="sd-prog-conn-btn" data-action="startConnect">
        <i class="fas fa-link"></i> ${loc("SD.Progression.Connect")}</button>`;
    }
  }

  html += `</div>`;

    if (!st && !em) {
      html += `<p class="sd-prog-empty">${loc("SD.Progression.NoSkilltree")}</p></div>`;
      return html;
    }

    const cols  = st?.cols ?? 8;
    const rows  = st?.rows ?? 5;
    const nodes = st?.nodes ?? [];
    const conns = st?.connections ?? [];

    const W = cols * (CELL + GAP);
    const H = rows * (CELL + GAP);

    html += `<div class="sd-prog-st-scroll">
      <div class="sd-prog-st-canvas" style="width:${W}px; height:${H}px; position:relative;">`;

    html += `<svg class="sd-prog-st-svg"
                  width="${W}" height="${H}"
                  viewBox="0 0 ${W} ${H}"
                  style="position:absolute;top:0;left:0;pointer-events:none;z-index:1;overflow:visible;">
      <defs>
        <marker id="sd-arrow" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto">
          <path d="M0,0 L7,3.5 L0,7 Z" fill="var(--sd-accent)" opacity=".7"/>
        </marker>
        <marker id="sd-arrow-dim" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto">
          <path d="M0,0 L7,3.5 L0,7 Z" fill="var(--sd-border-2,var(--sd-border))" opacity=".7"/>
        </marker>
      </defs>`;

    for (const conn of conns) {
      const fn = nodes.find(n => n.id === conn.from);
      const tn = nodes.find(n => n.id === conn.to);
      if (!fn || !tn) continue;

      const x1 = fn.col * (CELL + GAP) + CELL / 2;
      const y1 = fn.row * (CELL + GAP) + CELL / 2;
      const x2 = tn.col * (CELL + GAP) + CELL / 2;
      const y2 = tn.row * (CELL + GAP) + CELL / 2;

      const active = (acquiredNodes[conn.from] ?? 0) > 0 && (acquiredNodes[conn.to] ?? 0) > 0;
      const marker = active ? "sd-arrow" : "sd-arrow-dim";

      const dx    = x2 - x1;
      const dy    = y2 - y1;
      const dist  = Math.sqrt(dx * dx + dy * dy) || 1;
      const pad   = 20;
      const sx    = x1 + (dx / dist) * pad;
      const sy    = y1 + (dy / dist) * pad;
      const ex    = x2 - (dx / dist) * pad;
      const ey    = y2 - (dy / dist) * pad;

      html += `<line class="sd-prog-conn ${active ? "active" : ""}"
               x1="${sx}" y1="${sy}" x2="${ex}" y2="${ey}"
               stroke="${active ? "var(--sd-accent)" : "var(--sd-border-2,var(--sd-border))"}"
               stroke-width="${active ? 2 : 1.5}"
               stroke-dasharray="${active ? "none" : "5,4"}"
               marker-end="url(#${marker})"
               data-from="${e(conn.from)}" data-to="${e(conn.to)}"
               ${em ? 'style="pointer-events:stroke;cursor:pointer;" data-action="deleteConnection"' : ''}/>`;
    }

    html += `</svg>`;

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const node  = nodes.find(n => n.col === col && n.row === row);
        const left  = col * (CELL + GAP);
        const top   = row * (CELL + GAP);
        const style = `left:${left}px;top:${top}px;width:${CELL}px;height:${CELL}px;`;

        if (node) {
        const count = acquiredNodes[node.id] ?? 0;
        const maxAcq = node.maxAcquire ?? 1;
        const nodeCost = node.cost ?? 1;
        const acquired = count >= maxAcq;
        const spValueForNode = Number(_readActorPath(this._actor, this._spValuePath, 0)) || 0;
        const canAfford = spValueForNode >= nodeCost;
        const canAcquire = !acquired && canAfford && this._canAcquireNode(node, conns, acquiredNodes, nodes);
          const connecting = this._connectFrom === node.id;

          const cls = [
            "sd-prog-st-node",
            acquired   ? "acquired"   : "",
            canAcquire ? "available"  : "",
            connecting ? "connecting" : "",
            (em && isGM) ? "editable" : ""
          ].filter(Boolean).join(" ");

          const bgStyle = node.color ? `background:${node.color};` : "";

          const nodeTitle = node.item ? (loc("SD.Progression.RightClickOpen") || "Right-click to open item") : "";
          html += `<div class="${cls}" style="${style}${bgStyle}"
                   data-node-id="${e(node.id)}"
                   data-preview-kind="node"
                   data-preview-ref="node:${e(node.id)}"
                   ${nodeTitle ? `title="${nodeTitle}"` : ""}
                   data-action="${em ? "stNodeClick" : canAcquire ? "acquireNode" : ""}">`;

          if (node.item?.img) {
            html += `<img class="sd-prog-node-img" src="${e(node.item.img)}" draggable="false">`;
          } else {
            html += `<i class="fas fa-star sd-prog-node-fa"></i>`;
          }

        const label = node.label || node.item?.name || "";
        if (label) html += `<div class="sd-prog-node-label">${e(label)}</div>`;

        if (nodeCost > 0) {
          html += `<div class="sd-prog-node-cost" style="font-size:9px;color:${canAfford ? 'var(--sd-accent)' : 'var(--sd-hp)'};font-weight:700;"><i class="fas fa-star" style="font-size:7px;"></i> ${nodeCost}</div>`;
        }

        if (maxAcq > 1) {
            html += `<div class="sd-prog-node-count">${count}/${maxAcq}</div>`;
          }

          if (node.fieldChanges?.length || node.effects?.length) {
            html += `<div class="sd-prog-node-badges">
              ${node.fieldChanges?.length ? `<span><i class="fas fa-sliders-h"></i>${node.fieldChanges.length}</span>` : ""}
              ${node.effects?.length      ? `<span><i class="fas fa-magic"></i>${node.effects.length}</span>`          : ""}
            </div>`;
          }

          if (em && isGM) {
            html += `<div class="sd-prog-node-tools">
              <button type="button" class="sd-prog-node-tool" data-action="configNode"    data-node-id="${e(node.id)}" title="${loc("SD.Progression.ConfigNode")}"><i class="fas fa-cog"></i></button>
              <button type="button" class="sd-prog-node-tool danger" data-action="deleteNode" data-node-id="${e(node.id)}" title="${loc("SD.Progression.DeleteNode")}"><i class="fas fa-trash"></i></button>
            </div>`;
          }

          html += `</div>`;

        } else if (em && isGM) {

          html += `<div class="sd-prog-st-cell" style="${style}"
                   data-col="${col}" data-row="${row}"
                   data-drop-target="stNode"
                   data-action="${this._connectFrom ? "" : "stEmptyCellClick"}">
            <i class="fas fa-plus sd-prog-cell-icon"></i>
          </div>`;
        }
      }
    }

    html += `</div></div></div>`;
    return html;
  }

  _canAcquireNode(node, connections, acquiredNodes, allNodes) {
    const prereqs = connections.filter(c => c.to === node.id).map(c => c.from);
    if (!prereqs.length) return true;
    return prereqs.every(pid => (acquiredNodes[pid] ?? 0) > 0);
  }

  _resolvePreview(ref) {
    if (!ref) return null;
    const parts = String(ref).split(":");
    const scope = parts[0];
    if (scope === "level") {
      const li   = parseInt(parts[1]);
      const sub  = parts[2];
      const j    = parseInt(parts[3]);
      const lv   = this._levels?.[li];
      if (!lv) return null;
      if (sub === "items") {
        const it = lv.items?.[j];
        return it ? { kind: "item", data: it, label: it.name, subtitle: it.type } : null;
      }
      if (sub === "fc") {
        const fc = lv.fieldChanges?.[j];
        return fc ? { kind: "fc", data: fc, label: dbVariableLabel(fc) } : null;
      }
      if (sub === "effects") {
        const ef = lv.effects?.[j];
        return ef ? { kind: "effect", data: ef, label: ef.name } : null;
      }
    } else if (scope === "choice") {
      const li = parseInt(parts[1]);
      const gi = parseInt(parts[2]);
      const oi = parseInt(parts[3]);
      const ch = this._levels?.[li]?.choices?.[gi];
      if (!ch) return null;
      const opt = ch.options?.[oi];
      if (!opt) return null;
      const kind = ch.kind ?? "items";
      if (kind === "items")        return { kind: "item",   data: opt, label: opt.name, subtitle: opt.type };
      if (kind === "effects")      return { kind: "effect", data: opt, label: opt.name };
      if (kind === "fieldChanges") return { kind: "fc",     data: opt, label: opt.path };
    } else if (scope === "node") {
      const id   = parts[1];
      const node = this._skilltree?.nodes?.find(n => n.id === id);
      return node ? { kind: "node", data: node } : null;
    }
    return null;
  }

  _refreshPreviewPane() {
    const root = this.element?.querySelector(".sd-prog-preview");
    if (!root) return;
    const payload = this._pinnedPreview ?? this._hoverPreview;
    root.dataset.pinned = this._pinnedPreview ? "1" : "0";
    root.innerHTML = this._renderPreviewInner(payload);
    this._wirePreviewPaneEvents(root);
  }

  _wirePreviewPaneEvents(root) {
    const unpin = root.querySelector("[data-action='unpinPreview']");
    if (unpin) unpin.addEventListener("click", ev => { ev.stopPropagation(); this._pinnedPreview = null; this._refreshPreviewPane(); });

    root.querySelectorAll("[data-preview-tab-id]").forEach(btn => {
      btn.addEventListener("click", ev => {
        ev.stopPropagation();
        this._previewTabId = btn.dataset.previewTabId;
        this._refreshPreviewPane();
      });
    });
  }

  _wirePreviewHandlers(el) {
    const refresh = () => this._refreshPreviewPane();
    const samePayload = (a, b) => {
      if (!a || !b) return false;
      if (a.kind !== b.kind) return false;
      const aRef = a.data?._id ?? a.data?.id ?? a.data?.path ?? a.data?.name;
      const bRef = b.data?._id ?? b.data?.id ?? b.data?.path ?? b.data?.name;
      return aRef === bRef;
    };

    el.querySelectorAll("[data-preview-ref]").forEach(node => {
      node.addEventListener("mouseenter", () => {
        if (this._pinnedPreview) return;
        const payload = this._resolvePreview(node.dataset.previewRef);
        if (!samePayload(this._hoverPreview, payload)) this._previewTabId = null;
        this._hoverPreview = payload;
        refresh();
      });
      node.addEventListener("mouseleave", () => {
        if (this._pinnedPreview) return;
        this._hoverPreview = null;
        refresh();
      });
      node.addEventListener("click", ev => {
        if (ev.target.closest("[data-stop-preview]")) return;
        if (ev.target.closest("input,select,textarea")) return;
        const btnAction = ev.target.closest("button[data-action]");
        if (btnAction && btnAction !== node) return;
        const payload = this._resolvePreview(node.dataset.previewRef);
        if (!payload) return;
        if (samePayload(this._pinnedPreview, payload)) {
          this._pinnedPreview = null;
        } else {
          if (!samePayload(this._pinnedPreview, payload)) this._previewTabId = null;
          this._pinnedPreview = payload;
        }
        this._hoverPreview = null;
        refresh();
      });
    });

    const previewRoot = el.querySelector(".sd-prog-preview");
    if (previewRoot) this._wirePreviewPaneEvents(previewRoot);
  }

  _onRender(context, options) {
    const el = this.element;

    el.querySelectorAll(".sd-prog-tab[data-tab]").forEach(btn =>
      btn.addEventListener("click", () => { this._tab = btn.dataset.tab; this.render(); })
    );

    el.querySelectorAll(".sd-progression-app [data-action], .window-content [data-action]").forEach(btn =>
      btn.addEventListener("click", ev => { ev.stopPropagation(); this._handleAction(btn); })
    );

    this._wirePreviewHandlers(el);

    el.querySelectorAll("[data-action='changeLevelLabel']").forEach(inp =>
      inp.addEventListener("change", ev =>
        this._updateLevelField(+ev.target.dataset.idx, "label", ev.target.value))
    );
    el.querySelectorAll("[data-action='changeLevelVariable']").forEach(select=>
      select.addEventListener("change",async ev=>{await this._setActiveTabField("levelVariableId",ev.target.value);this.render();})
    );
    el.querySelectorAll("[data-action='fcChangeVariable']").forEach(inp =>
      inp.addEventListener("change", ev =>
        this._updateFc(+ev.target.dataset.levelIdx, +ev.target.dataset.fcIdx, "variableId", ev.target.value))
    );
    el.querySelectorAll("[data-action='fcChangeMode']").forEach(sel =>
      sel.addEventListener("change", ev =>
        this._updateFc(+ev.target.dataset.levelIdx, +ev.target.dataset.fcIdx, "mode", ev.target.value))
    );
    el.querySelectorAll("[data-action='fcChangeValue']").forEach(inp =>
      inp.addEventListener("change", ev =>
        this._updateFc(+ev.target.dataset.levelIdx, +ev.target.dataset.fcIdx, "value", ev.target.value))
    );

    el.querySelectorAll("[data-action='choiceChangeLabel']").forEach(inp =>
      inp.addEventListener("change", ev =>
        this._updateChoiceField(+ev.target.dataset.levelIdx, +ev.target.dataset.choiceIdx, "label", ev.target.value))
    );
    el.querySelectorAll("[data-action='choiceChangeKind']").forEach(sel =>
      sel.addEventListener("change", ev =>
        this._updateChoiceField(+ev.target.dataset.levelIdx, +ev.target.dataset.choiceIdx, "kind", ev.target.value, true))
    );
    el.querySelectorAll("[data-action='choiceChangePicks']").forEach(inp =>
      inp.addEventListener("change", ev =>
        this._updateChoiceField(+ev.target.dataset.levelIdx, +ev.target.dataset.choiceIdx, "picks", Math.max(1, Number(ev.target.value) || 1)))
    );
    el.querySelectorAll("[data-action='choiceFcChangeVariable']").forEach(inp =>
      inp.addEventListener("change", ev =>
        this._updateChoiceFc(+ev.target.dataset.levelIdx, +ev.target.dataset.choiceIdx, +ev.target.dataset.optIdx, "variableId", ev.target.value))
    );
    el.querySelectorAll("[data-action='choiceFcChangeMode']").forEach(sel =>
      sel.addEventListener("change", ev =>
        this._updateChoiceFc(+ev.target.dataset.levelIdx, +ev.target.dataset.choiceIdx, +ev.target.dataset.optIdx, "mode", ev.target.value))
    );
    el.querySelectorAll("[data-action='choiceFcChangeValue']").forEach(inp =>
      inp.addEventListener("change", ev =>
        this._updateChoiceFc(+ev.target.dataset.levelIdx, +ev.target.dataset.choiceIdx, +ev.target.dataset.optIdx, "value", ev.target.value))
    );

    el.querySelectorAll("[data-action='stSetCols']").forEach(inp =>
      inp.addEventListener("change", ev => this._stSetDim("cols", +ev.target.value))
    );
    el.querySelectorAll("[data-action='stSetRows']").forEach(inp =>
      inp.addEventListener("change", ev => this._stSetDim("rows", +ev.target.value))
    );

    el.querySelectorAll(".sd-prog-conn[data-action='deleteConnection']").forEach(line => {
      line.addEventListener("click", ev => {
        ev.stopPropagation();
        this._deleteConnection(line.dataset.from, line.dataset.to);
      })
    });

    el.querySelectorAll("[data-action='spStep']").forEach(btn => {
      btn.addEventListener("click", async () => {
        const step   = parseInt(btn.dataset.step) || 1;
        const path   = this._spValuePath;
        const cur    = Number(_readActorPath(this._actor, path, 0)) || 0;
        const newVal = Math.max(0, cur + step);
        await this._actor.update({ [path]: newVal });
        this.render();
      });
    });

    el.querySelectorAll("[data-action='spSetValue']").forEach(inp => {
      inp.addEventListener("change", async () => {
        const v    = Math.max(0, parseInt(inp.value) || 0);
        const path = this._spValuePath;
        await this._actor.update({ [path]: v });
        this.render();
      });
    });

    el.querySelectorAll("[data-action='spSetMax']").forEach(inp => {
      inp.addEventListener("change", async () => {
        const v    = Math.max(0, parseInt(inp.value) || 0);
        const path = this._spMaxPath;
        await this._actor.update({ [path]: v });
        this.render();
      });
    });

    el.querySelectorAll("[data-action='spCopyPath']").forEach(btn => {
      btn.addEventListener("click", async () => {
        const path = this._spValuePath;
        try { await navigator.clipboard.writeText(path); ui.notifications.info(`Copied: ${path}`); }
        catch { ui.notifications.warn("Could not copy to clipboard"); }
      });
    });

    el.querySelectorAll("[data-action='spSetValueVariable']").forEach(inp => {
      inp.addEventListener("change", async () => {
        const v = String(inp.value ?? "").trim();
        await this._setActiveTabField("skillPointsValueId", v);
        this.render();
      });
    });

    el.querySelectorAll("[data-action='spSetMaxVariable']").forEach(inp => {
      inp.addEventListener("change", async () => {
        const v = String(inp.value ?? "").trim();
        await this._setActiveTabField("skillPointsMaxId", v);
        this.render();
      });
    });

    el.querySelectorAll("[data-action='renameTrack']").forEach(inp => {
      inp.addEventListener("click",  ev => ev.stopPropagation());
      inp.addEventListener("change", async ev => {
        ev.stopPropagation();
        const id = inp.dataset.trackId;
        await this._renameTab(id, inp.value);
      });
    });

    el.querySelectorAll(".sd-prog-item-chip[data-snapshot-ref]").forEach(chip => {
      chip.addEventListener("contextmenu", ev => {
        ev.preventDefault();
        const ref = chip.dataset.snapshotRef ?? "";
        const [scope, ...idxs] = ref.split(":");
        if (scope === "level") {
          const li = parseInt(idxs[0]); const ii = parseInt(idxs[1]);
          const it = this._levels?.[li]?.items?.[ii];
          if (it) _openItemSheetFromSnapshot(it, this._actor);
        } else if (scope === "node") {
          const id = idxs[0];
          const node = (this._skilltree?.nodes ?? []).find(n => n.id === id);
          if (node?.item) _openItemSheetFromSnapshot(node.item, this._actor);
        }
      });
    });

    el.querySelectorAll(".sd-prog-st-node[data-node-id]").forEach(nodeEl => {
      nodeEl.addEventListener("contextmenu", ev => {
        const id = nodeEl.dataset.nodeId;
        const node = (this._skilltree?.nodes ?? []).find(n => n.id === id);
        if (node?.item) {
          ev.preventDefault();
          ev.stopPropagation();
          _openItemSheetFromSnapshot(node.item, this._actor);
        }
      });
    });

    el.querySelectorAll(".sd-prog-st-cell").forEach(cell => {
      cell.addEventListener("dragover",  ev => { ev.preventDefault(); cell.classList.add("drag-over"); });
      cell.addEventListener("dragleave", ()  => cell.classList.remove("drag-over"));
      cell.addEventListener("drop",      ev  => {
        cell.classList.remove("drag-over");
        this._handleStCellDrop(ev, +cell.dataset.col, +cell.dataset.row);
      });
    });

    el.querySelectorAll(".sd-prog-st-node.editable").forEach(node => {
      node.addEventListener("dragover",  ev => { ev.preventDefault(); node.classList.add("drag-over"); });
      node.addEventListener("dragleave", ()  => node.classList.remove("drag-over"));
      node.addEventListener("drop",      ev  => {
        node.classList.remove("drag-over");
        this._handleNodeItemDrop(ev, node.dataset.nodeId);
      });
    });

    el.querySelectorAll(".sd-prog-source-drop").forEach(zone => {
      zone.addEventListener("dragover",  ev => { ev.preventDefault(); zone.classList.add("drag-over"); });
      zone.addEventListener("dragleave", ()  => zone.classList.remove("drag-over"));
      zone.addEventListener("drop",      ev  => {
        zone.classList.remove("drag-over");
        const action = zone.dataset.action;
        if (action === "dropClassItem")     this._handleClassItemDrop(ev);
        if (action === "dropSkilltreeItem") this._handleSkilltreeItemDrop(ev);
      });
    });

    el.querySelectorAll(".sd-prog-items-zone.droppable").forEach(zone => {
      zone.addEventListener("dragover",  ev => { ev.preventDefault(); zone.classList.add("drag-over"); });
      zone.addEventListener("dragleave", ()  => zone.classList.remove("drag-over"));
      zone.addEventListener("drop",      ev  => {
        zone.classList.remove("drag-over");
        const target = zone.dataset.dropTarget;
        if (target === "levelItem") {
          this._handleItemDrop(ev, +zone.dataset.levelIdx);
        } else if (target === "choiceItem") {
          this._handleChoiceItemDrop(ev, +zone.dataset.levelIdx, +zone.dataset.choiceIdx);
        }
      });
    });
  }

  async _handleAction(target) {
    const action = target.dataset.action;
    const isGM   = game.user.isGM;

    switch (action) {

      case "toggleEdit":
        if (!isGM) return;
        this._editMode = !this._editMode;
        this.render();
        break;

      case "addLevel":
        if (!isGM) return;
        await this._addLevel();
        break;

      case "deleteLevel":
        if (!isGM) return;
        await this._deleteLevel(+target.dataset.idx);
        break;

      case "applyLevel":
        await this._applyLevel(+target.dataset.idx);
        break;

      case "rollbackLevel":
        await this._rollbackLevel(+target.dataset.idx);
        break;

      case "addFieldChange":
        if (!isGM) return;
        await this._addFieldChange(+target.dataset.levelIdx);
        break;

      case "removeFc":
        if (!isGM) return;
        await this._removeFc(+target.dataset.levelIdx, +target.dataset.fcIdx);
        break;

      case "removeLevelItem":
        if (!isGM) return;
        await this._removeLevelItem(+target.dataset.levelIdx, +target.dataset.itemIdx);
        break;

      case "addEffect":
        if (!isGM) return;
        await this._addEffect(+target.dataset.levelIdx);
        break;

      case "removeEffect":
        if (!isGM) return;
        await this._removeEffect(+target.dataset.levelIdx, +target.dataset.effectIdx);
        break;

      case "editEffect":
        if (!isGM) return;
        await this._editEffect(+target.dataset.levelIdx, +target.dataset.effectIdx);
        break;

      case "addChoice":
        if (!isGM) return;
        await this._addChoice(+target.dataset.levelIdx, target.dataset.kind ?? "items");
        break;

      case "pickVariant": {
        const li = +target.dataset.levelIdx;
        const ci = +target.dataset.choiceIdx;
        const oi = +target.dataset.optIdx;
        this._setVariantSel(li, ci, oi);
        this.render();
        break;
      }

      case "unpinPreview":
        this._pinnedPreview = null;
        this._refreshPreviewPane();
        break;

      case "removeChoice":
        if (!isGM) return;
        await this._removeChoice(+target.dataset.levelIdx, +target.dataset.choiceIdx);
        break;

      case "removeChoiceOption":
        if (!isGM) return;
        await this._removeChoiceOption(+target.dataset.levelIdx, +target.dataset.choiceIdx, +target.dataset.optIdx);
        break;

      case "addChoiceEffect":
        if (!isGM) return;
        await this._addChoiceEffect(+target.dataset.levelIdx, +target.dataset.choiceIdx);
        break;

      case "editChoiceEffect":
        if (!isGM) return;
        await this._editChoiceEffect(+target.dataset.levelIdx, +target.dataset.choiceIdx, +target.dataset.optIdx);
        break;

      case "addChoiceFc":
        if (!isGM) return;
        await this._addChoiceFc(+target.dataset.levelIdx, +target.dataset.choiceIdx);
        break;

      case "acquireNode": {
        const nodeId = target.closest("[data-node-id]")?.dataset?.nodeId ?? target.dataset.nodeId;
        if (nodeId) await this._acquireNode(nodeId);
        break;
      }

      case "stNodeClick": {
        if (!isGM || !this._editMode) return;
        const nodeId = target.closest("[data-node-id]")?.dataset?.nodeId;
        if (!nodeId) return;
        if (this._connectFrom) {
          if (this._connectFrom !== nodeId) await this._addConnection(this._connectFrom, nodeId);
          this._connectFrom = null;
        } else {
          this._connectFrom = nodeId;
        }
        this.render();
        break;
      }

      case "startConnect":
        ui.notifications.info(loc("SD.Progression.ClickFirstNode"));
        break;

      case "cancelConnect":
        this._connectFrom = null;
        this.render();
        break;

      case "deleteNode":
        if (!isGM) return;
        await this._deleteNode(target.dataset.nodeId ?? target.closest("[data-node-id]")?.dataset?.nodeId);
        break;

      case "configNode":
        if (!isGM) return;
        await this._openNodeConfig(target.dataset.nodeId ?? target.closest("[data-node-id]")?.dataset?.nodeId);
        break;

      case "unlinkClass":
        if (!isGM) return;
        await this._setActiveTabField("classItemId", null);
        this.render();
        break;

      case "unlinkSkilltree":
        if (!isGM) return;
        await this._setActiveTabField("skilltreeItemId", null);
        this.render();
        break;

      case "selectTrack": {
        const id = target.dataset.trackId;
        if (id) {
          this._activeTabId = id;
          this.render();
        }
        break;
      }

      case "addTrack":
        if (!isGM) return;
        await this._addTab();
        break;

      case "deleteTrack":
        if (!isGM) return;
        await this._deleteTab(target.dataset.trackId ?? target.closest("[data-track-id]")?.dataset?.trackId);
        break;

      case "close":    this.close();    break;
      case "minimize": this.minimize(); break;
    }
  }

  async _addLevel() {
    const levels    = dc(this._levels);
    const nextLevel = (levels[levels.length - 1]?.level ?? 0) + 1;
    levels.push({ id: rndId(), level: nextLevel, label: "", items: [], effects: [], fieldChanges: [] });
    await this._saveLevels(levels);
    this.render();
  }

  async _deleteLevel(idx) {
    const levels = dc(this._levels);
    levels.splice(idx, 1);
    await this._saveLevels(levels);
    this.render();
  }

  async _updateLevelField(idx, field, value) {
    const levels = dc(this._levels);
    if (!levels[idx]) return;
    levels[idx][field] = value;
    await this._saveLevels(levels);
  }

  async _addFieldChange(levelIdx) {
    const levels = dc(this._levels);
    if (!levels[levelIdx]) return;
    levels[levelIdx].fieldChanges ??= [];
    const variableId=this._spMaxId||this._spValueId||getValueDefinitions("actor")[0]?.id||"";
    levels[levelIdx].fieldChanges.push({ variableId, mode: "add", value: "1" });
    await this._saveLevels(levels);
    this.render();
  }

  async _removeFc(levelIdx, fcIdx) {
    const levels = dc(this._levels);
    levels[levelIdx]?.fieldChanges?.splice(fcIdx, 1);
    await this._saveLevels(levels);
    this.render();
  }

  async _updateFc(levelIdx, fcIdx, field, value) {
    const levels = dc(this._levels);
    if (!levels[levelIdx]?.fieldChanges?.[fcIdx]) return;
    levels[levelIdx].fieldChanges[fcIdx][field] = value;
    await this._saveLevels(levels);
  }

  async _removeLevelItem(levelIdx, itemIdx) {
    const levels = dc(this._levels);
    levels[levelIdx]?.items?.splice(itemIdx, 1);
    await this._saveLevels(levels);
    this.render();
  }

  async _addEffect(levelIdx) {
    const name = await this._promptString(loc("SD.Progression.EffectName"), loc("SD.Progression.NewEffect"));
    if (!name) return;
    const levels = dc(this._levels);
    if (!levels[levelIdx]) return;
    levels[levelIdx].effects ??= [];
    levels[levelIdx].effects.push({
      _id: rndId(), name, img: "icons/svg/aura.svg",
      origin: this._actor.uuid, changes: [], disabled: false, duration: {}, flags: {}
    });
    await this._saveLevels(levels);
    this.render();
  }

  async _removeEffect(levelIdx, effectIdx) {
    const levels = dc(this._levels);
    levels[levelIdx]?.effects?.splice(effectIdx, 1);
    await this._saveLevels(levels);
    this.render();
  }

  async _editEffect(levelIdx, effectIdx) {
    const levels = dc(this._levels);
    const ef = levels?.[levelIdx]?.effects?.[effectIdx];
    if (!ef) return;

    const updated = await _editEffectViaStandardConfig(ef, {
      parent: this._actor,
      title:  `${loc("SD.Progression.EditEffect")}: ${ef.name ?? ""}`
    });
    if (!updated) return;

    const lvls = dc(this._levels);
    const target = lvls?.[levelIdx]?.effects?.[effectIdx];
    if (!target) return;
    Object.assign(target, updated);
    target.img = updated.img ?? updated.icon ?? target.img;
    await this._saveLevels(lvls);
    this.render();
  }

  async _addChoice(levelIdx, kind = "items") {
    const safeKind = ["items", "effects", "fieldChanges"].includes(kind) ? kind : "items";
    const levels = dc(this._levels);
    if (!levels[levelIdx]) return;
    levels[levelIdx].choices ??= [];
    levels[levelIdx].choices.push({
      id: rndId(),
      label: "",
      kind: safeKind,
      picks: 1,
      options: []
    });
    await this._saveLevels(levels);
    this.render();
  }

  async _removeChoice(levelIdx, choiceIdx) {
    const levels = dc(this._levels);
    levels[levelIdx]?.choices?.splice(choiceIdx, 1);
    await this._saveLevels(levels);
    this.render();
  }

  async _updateChoiceField(levelIdx, choiceIdx, field, value, clearOptionsOnKindChange = false) {
    const levels = dc(this._levels);
    const ch = levels?.[levelIdx]?.choices?.[choiceIdx];
    if (!ch) return;
    ch[field] = value;
    if (clearOptionsOnKindChange && field === "kind") ch.options = [];
    await this._saveLevels(levels);
    if (clearOptionsOnKindChange) this.render();
  }

  async _removeChoiceOption(levelIdx, choiceIdx, optIdx) {
    const levels = dc(this._levels);
    levels?.[levelIdx]?.choices?.[choiceIdx]?.options?.splice(optIdx, 1);
    await this._saveLevels(levels);
    this.render();
  }

  async _handleChoiceItemDrop(event, levelIdx, choiceIdx) {
    event.preventDefault();
    const data = (foundry.applications.ux?.TextEditor?.implementation ?? TextEditor).getDragEventData(event);
    if (data?.type !== "Item") return;
    const item = await this._resolveDropItem(data);
    if (!item) return;

    const snap          = item.toObject();
    snap._sourceUuid    = data.uuid;
    const levels        = dc(this._levels);
    const ch = levels?.[levelIdx]?.choices?.[choiceIdx];
    if (!ch) return;
    ch.options ??= [];
    ch.options.push(snap);
    await this._saveLevels(levels);
    this.render();
  }

  async _addChoiceEffect(levelIdx, choiceIdx) {
    const name = await this._promptString(loc("SD.Progression.EffectName"), loc("SD.Progression.NewEffect"));
    if (!name) return;
    const levels = dc(this._levels);
    const ch = levels?.[levelIdx]?.choices?.[choiceIdx];
    if (!ch) return;
    ch.options ??= [];
    ch.options.push({
      _id: rndId(), name, icon: "icons/svg/aura.svg",
      origin: this._actor.uuid, changes: [], disabled: false, duration: {}, flags: {}
    });
    await this._saveLevels(levels);
    this.render();
  }

  async _editChoiceEffect(levelIdx, choiceIdx, optIdx) {
    const levels = dc(this._levels);
    const ef = levels?.[levelIdx]?.choices?.[choiceIdx]?.options?.[optIdx];
    if (!ef) return;
    const updated = await _editEffectViaStandardConfig(ef, {
      parent: this._actor,
      title:  `${loc("SD.Progression.EditEffect")}: ${ef.name ?? ""}`
    });
    if (!updated) return;
    const lvls = dc(this._levels);
    const target = lvls?.[levelIdx]?.choices?.[choiceIdx]?.options?.[optIdx];
    if (!target) return;
    Object.assign(target, updated);
    target.img = updated.img ?? updated.icon ?? target.img;
    await this._saveLevels(lvls);
    this.render();
  }

  async _addChoiceFc(levelIdx, choiceIdx) {
    const levels = dc(this._levels);
    const ch = levels?.[levelIdx]?.choices?.[choiceIdx];
    if (!ch) return;
    ch.options ??= [];
    ch.options.push({ variableId:this._spMaxId||getValueDefinitions("actor")[0]?.id||"", mode: "add", value: "1" });
    await this._saveLevels(levels);
    this.render();
  }

  async _updateChoiceFc(levelIdx, choiceIdx, optIdx, field, value) {
    const levels = dc(this._levels);
    const fc = levels?.[levelIdx]?.choices?.[choiceIdx]?.options?.[optIdx];
    if (!fc) return;
    fc[field] = value;
    await this._saveLevels(levels);
  }

  async _applyLevel(levelIdx) {
    const levels = this._levels;
    const lv     = levels[levelIdx];
    if (!lv) return;

    const choiceGroups = Array.isArray(lv.choices) ? lv.choices.filter(c => Array.isArray(c.options) && c.options.length > 0) : [];
    const wizardResult = await LevelUpWizard.show(this._actor, lv, choiceGroups);
    if (!wizardResult) return;
    const pickedByGroup = choiceGroups.length ? wizardResult.picks : null;

    const actor = this._actor;

    const snapshot = {
      level:            lv.level,
      prevAppliedLevel: this._state.appliedLevel ?? 0,
      prevValues:       {},
      grantedItemIds:   [],
      grantedEffectIds: []
    };

    const updates = {};
    const collectFieldChange = (fc) => {
      if (!fc || (!fc.variableId && !fc.path)) return;
      const path = normalizeActorPath(actor, fieldChangeStoragePath(fc));
      if (!path) return;
      if (!(path in snapshot.prevValues)) {
        snapshot.prevValues[path] = getNestedValue(actor, path);
      }
      Object.assign(updates, buildFieldUpdate(actor, { ...fc, path }, updates));
    };
    for (const fc of (lv.fieldChanges ?? [])) collectFieldChange(fc);

    // Also support explicit skill-point grants in imported Class definitions.
    // Both the spendable value and its maximum are additive rewards.
    const explicitSp = Number(lv.skillPoints ?? lv.skillPointGain ?? lv.skillPointsGranted);
    const explicitMax = Number(lv.skillPointsMax ?? lv.skillPointMaxGain);
    if (Number.isFinite(explicitSp) && explicitSp !== 0) {
      collectFieldChange({ variableId: this._spValueId, mode: "add", value: explicitSp });
    }
    if (Number.isFinite(explicitMax) && explicitMax !== 0) {
      collectFieldChange({ variableId: this._spMaxId, mode: "add", value: explicitMax });
    }

    const extraItems   = [];
    const extraEffects = [];
    if (pickedByGroup) {
      for (let gi = 0; gi < choiceGroups.length; gi++) {
        const ch = choiceGroups[gi];
        const picks = pickedByGroup[gi] ?? [];
        for (const optIdx of picks) {
          const opt = ch.options[optIdx];
          if (!opt) continue;
          if (ch.kind === "items")        extraItems.push(opt);
          else if (ch.kind === "effects") extraEffects.push(opt);
          else if (ch.kind === "fieldChanges") collectFieldChange(opt);
        }
      }
    }

    const levelPath=this._levelPath;
    if (levelPath) {
      if (!(levelPath in snapshot.prevValues)) snapshot.prevValues[levelPath]=getNestedValue(actor,levelPath);
      updates[levelPath]=lv.level;
    }

    if (Object.keys(updates).length) await actor.update(updates);

    const itemDatas = [...(lv.items ?? []), ...extraItems].map(snap => { const d = dc(snap); delete d._id; return d; });
    if (itemDatas.length) {
      const created = await actor.createEmbeddedDocuments("Item", itemDatas);
      snapshot.grantedItemIds = (created ?? []).map(d => d.id);
    }

    const effectDatas = [...(lv.effects ?? []), ...extraEffects].map(ef => { const d = dc(ef); delete d._id; if (d.icon && !d.img) d.img = d.icon; delete d.icon; return d; });
    if (effectDatas.length) {
      const created = await actor.createEmbeddedDocuments("ActiveEffect", effectDatas);
      snapshot.grantedEffectIds = (created ?? []).map(d => d.id);
    }

    const state = dc(this._state);
    state.appliedLevel = lv.level;
    state.history ??= {};
    state.history[String(lv.level)] = snapshot;
    await actor.setFlag("sd", "progression.state", state);

    ui.notifications.info(loc("SD.Progression.LevelApplied").replace("{level}", lv.level));
    await this._postLevelUpChat(lv, {
      items: itemDatas,
      effects: effectDatas,
      fieldChanges: Object.entries(updates).filter(([p]) => p !== levelPath).map(([path, to]) => ({ path, from: snapshot.prevValues[path], to })),
      choiceGroups,
      pickedByGroup
    });
    this.render();
  }

  async _postLevelUpChat(lv, { items = [], effects = [], fieldChanges = [], choiceGroups = [], pickedByGroup = null } = {}) {
    try {
      const actor = this._actor;
      const chip = (img, name) => `<span class="sd-luw-chat-chip"><img src="${e(img)}"><span>${e(name)}</span></span>`;
      let html = `<div class="sd-luw-chat">`;
      html += `<div class="sd-luw-chat-hdr"><i class="fas fa-angles-up"></i> ${e((loc("SD.Progression.ChatAnnounce") || "{name} has reached level {level}!").replace("{name}", actor.name).replace("{level}", lv.level))}</div>`;
      if (items.length || effects.length) {
        html += `<div class="sd-luw-chat-sec">${loc("SD.Progression.ChatReceived") || "Received"}</div><div class="sd-luw-chat-chips">`;
        for (const it of items) html += chip(it.img ?? "icons/svg/item-bag.svg", it.name ?? "Item");
        for (const ef of effects) html += chip(ef.img ?? ef.icon ?? "icons/svg/aura.svg", ef.name ?? "Effect");
        html += `</div>`;
      }
      if (fieldChanges.length) {
        html += `<div class="sd-luw-chat-sec">${loc("SD.Progression.ChatStatChanges") || "Stat changes"}</div><ul class="sd-luw-chat-fcs">`;
        for (const fc of fieldChanges) {
          html += `<li><code>${e(dbVariableLabel(fc))}</code> ${e(String(fc.from ?? "\u2014"))} <i class="fas fa-arrow-right"></i> <strong>${e(String(fc.to ?? "\u2014"))}</strong></li>`;
        }
        html += `</ul>`;
      }
      if (choiceGroups.length && pickedByGroup) {
        html += `<div class="sd-luw-chat-sec">${loc("SD.Progression.ChatChosen") || "Choices made"}</div><ul class="sd-luw-chat-picks">`;
        for (let gi = 0; gi < choiceGroups.length; gi++) {
          const ch = choiceGroups[gi];
          for (const oi of (pickedByGroup[gi] ?? [])) {
            const opt = ch.options?.[oi];
            if (!opt) continue;
            const label = ch.kind === "fieldChanges"
              ? `<code>${e(opt.path ?? "")}</code> <strong>${e(String(opt.value ?? ""))}</strong>`
              : e(opt.name ?? "");
            html += `<li><i class="fas fa-hand-pointer"></i> ${ch.label ? `<strong>${e(ch.label)}:</strong> ` : ""}${label}</li>`;
          }
        }
        html += `</ul>`;
      }
      html += `</div>`;
      const MessageCls = getDocumentClass("ChatMessage") ?? ChatMessage;
      await MessageCls.create({ content: html, speaker: MessageCls.getSpeaker({ actor }) });
    } catch (err) {
      console.error("SD | Failed to post level-up chat message", err);
    }
  }

  _numericPathOptions() {
    return getValueDefinitions("actor").filter(v=>["number","integer"].includes(v.type)).map(v=>`<option value="${e(v.id)}">${e(v.name)}</option>`).join("");
  }

  async _rollbackLevel(levelIdx) {
    const levels = this._levels;
    const lv     = levels[levelIdx];
    if (!lv) return;

    const state    = dc(this._state);
    const snapshot = state.history?.[String(lv.level)] ?? null;

    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window:  { title: loc("SD.Progression.ConfirmRollbackTitle") || "Rollback level" },
      content: `<p>${(loc("SD.Progression.ConfirmRollbackMsg") || "Rollback level {level}? Granted items and effects will be removed and field changes reverted.").replace("{level}", lv.level)}</p>`,
      yes:     { label: loc("SD.Progression.Rollback") || "Rollback", icon: "fas fa-rotate-left" }
    });
    if (!confirmed) return;

    const actor = this._actor;

    if (snapshot) {

      const restore = {};
      for (const [path, value] of Object.entries(snapshot.prevValues ?? {})) {
        restore[path] = value;
      }
      if (Object.keys(restore).length) await actor.update(restore);

      const itemIds = (snapshot.grantedItemIds ?? []).filter(id => actor.items.has(id));
      if (itemIds.length) await actor.deleteEmbeddedDocuments("Item", itemIds);

      const effectIds = (snapshot.grantedEffectIds ?? []).filter(id => actor.effects.has(id));
      if (effectIds.length) await actor.deleteEmbeddedDocuments("ActiveEffect", effectIds);

      state.appliedLevel = snapshot.prevAppliedLevel ?? 0;
      delete state.history[String(lv.level)];
    } else {

      state.appliedLevel = Math.max(0, lv.level - 1);
    }

    await actor.setFlag("sd", "progression.state", state);

    ui.notifications.info((loc("SD.Progression.LevelRolledBack") || "Level {level} rolled back").replace("{level}", lv.level));
    this.render();
  }

  async _stSetDim(dim, value) {
    const st = dc(this._skilltree ?? { cols: 8, rows: 5, nodes: [], connections: [] });
    st[dim] = Math.max(2, Math.min(20, value || 8));
    await this._saveSkilltree(st);
    this.render();
  }

  async _deleteNode(nodeId) {
    if (!nodeId) return;
    const st = dc(this._skilltree ?? { cols: 8, rows: 5, nodes: [], connections: [] });
    st.nodes       = (st.nodes       ?? []).filter(n => n.id !== nodeId);
    st.connections = (st.connections ?? []).filter(c => c.from !== nodeId && c.to !== nodeId);
    await this._saveSkilltree(st);
    this.render();
  }

  async _addConnection(from, to) {
    const st = dc(this._skilltree ?? { cols: 8, rows: 5, nodes: [], connections: [] });
    st.connections ??= [];
    if (!st.connections.some(c => c.from === from && c.to === to)) {
      st.connections.push({ from, to });
      await this._saveSkilltree(st);
    }
    this.render();
  }

  async _deleteConnection(from, to) {
    const st = dc(this._skilltree ?? { cols: 8, rows: 5, nodes: [], connections: [] });
    st.connections = (st.connections ?? []).filter(c => !(c.from === from && c.to === to));
    await this._saveSkilltree(st);
    this.render();
  }

  async _acquireNode(nodeId) {
    const st = this._skilltree;
    if (!st) return;
    const node = (st.nodes ?? []).find(n => n.id === nodeId);
    if (!node) return;

    const state = dc(this._state);
    state.acquiredNodes ??= {};
    const count = state.acquiredNodes[nodeId] ?? 0;
    const maxAcq = node.maxAcquire ?? 1;
    const nodeCost = node.cost ?? 1;

    if (count >= maxAcq) {
      ui.notifications.warn(loc("SD.Progression.AlreadyAcquired")); return;
    }
    if (!this._canAcquireNode(node, st.connections ?? [], state.acquiredNodes, st.nodes ?? [])) {
      ui.notifications.warn(loc("SD.Progression.PrereqsNotMet")); return;
    }

    const valPath = this._spValuePath;
    const curSP   = Number(_readActorPath(this._actor, valPath, 0)) || 0;
    if (curSP < nodeCost) {
      ui.notifications.warn(loc("SD.Progression.NotEnoughPoints")); return;
    }

    const costLabel = nodeCost > 0 ? ` (${nodeCost} ${loc("SD.Progression.SkillPoints")})` : "";
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: loc("SD.Progression.AcquireNode") },
      content: `<p>${loc("SD.Progression.AcquireNodeMsg").replace("{node}", e(node.label || node.item?.name || nodeId))}${costLabel}</p>`,
      yes: { label: loc("SD.Progression.Acquire"), icon: "fas fa-star" }
    });
    if (!confirmed) return;

    const actor = this._actor;

    if (nodeCost > 0) {
      await actor.update({ [valPath]: curSP - nodeCost });
    }

    const updates = {};
    for (const fc of (node.fieldChanges ?? [])) Object.assign(updates, buildFieldUpdate(actor, fc));
    if (Object.keys(updates).length) await actor.update(updates);

    if (node.item) {
      const d = dc(node.item); delete d._id;
      await actor.createEmbeddedDocuments("Item", [d]);
    }

    const effectDatas = (node.effects ?? []).map(ef => { const d = dc(ef); delete d._id; if (d.icon && !d.img) d.img = d.icon; delete d.icon; return d; });
    if (effectDatas.length) await actor.createEmbeddedDocuments("ActiveEffect", effectDatas);

    state.acquiredNodes[nodeId] = count + 1;
    await actor.setFlag("sd", "progression.state", state);

    ui.notifications.info(loc("SD.Progression.NodeAcquired"));
    this.render();
  }

  async _openNodeConfig(nodeId) {
    if (!nodeId) return;
    const st   = dc(this._skilltree ?? { cols: 8, rows: 5, nodes: [], connections: [] });
    const node = (st.nodes ?? []).find(n => n.id === nodeId);
    if (!node) return;

    const fcRows = (node.fieldChanges ?? []).map((fc, j) => { const selected=fc.variableId||variableIdForLegacyPath(fc.path); return `
      <div class="sd-prog-fc-row" data-idx="${j}">
        <select class="nc-variable" style="flex:1 1 100%;min-width:0;width:100%;box-sizing:border-box;"><option value="">Select Database variable…</option>${getValueDefinitions().map(v=>`<option value="${e(v.id)}" ${selected===v.id?"selected":""}>${e(v.name)} · ${e(v.type)} [${e(v.id)}]</option>`).join("")}</select>
        <select class="nc-mode">
          <option value="add"      ${fc.mode === "add"      ? "selected" : ""}>+</option>
          <option value="set"      ${fc.mode === "set"      ? "selected" : ""}>=</option>
          <option value="multiply" ${fc.mode === "multiply" ? "selected" : ""}>×</option>
        </select>
        <input type="text" class="nc-value" value="${e(fc.value)}" style="width:56px;">
        <button type="button" class="nc-del-fc"><i class="fas fa-times"></i></button>
      </div>`; }).join("");

    const _renderEffectRows = (effects) => (effects ?? []).map((ef, j) => `
      <div class="sd-prog-eff-row" data-idx="${j}" style="display:flex;align-items:center;gap:6px;padding:4px 6px;border:1px solid var(--sd-border);border-radius:6px;background:var(--sd-bg-2);">
        <img src="${e(ef.icon ?? ef.img ?? "icons/svg/aura.svg")}" style="width:20px;height:20px;border-radius:3px;">
        <span style="flex:1;font-size:12px;${ef.disabled ? "opacity:.5;text-decoration:line-through;" : ""}">${e(ef.name ?? "Effect")}</span>
        <span style="font-size:11px;color:var(--sd-text-3);">${(ef.changes ?? []).length} ${loc("SD.Progression.Changes") || "changes"}</span>
        <button type="button" class="nc-edit-eff" data-idx="${j}" title="${loc("SD.Progression.EditEffect") || "Edit effect"}" style="font-size:11px;padding:2px 6px;"><i class="fas fa-pen"></i></button>
        <button type="button" class="nc-del-eff" data-idx="${j}" title="${loc("SD.Delete") || "Delete"}" style="font-size:11px;padding:2px 6px;"><i class="fas fa-times"></i></button>
      </div>`).join("");

    const effectRows = _renderEffectRows(node.effects ?? []);

    const defaultMaxId = this._spMaxId || getValueDefinitions("actor")[0]?.id || "";

    const content = `<div style="display:flex;flex-direction:column;gap:10px;padding:8px;">
      <div style="display:flex;gap:8px;align-items:center;">
        <label style="min-width:80px;">${loc("SD.Progression.NodeLabel")}</label>
        <input id="nc-label" type="text" value="${e(node.label ?? "")}" style="flex:1;">
      </div>
  <div style="display:flex;gap:8px;align-items:center;">
    <label style="min-width:80px;">${loc("SD.Progression.MaxAcquire")}</label>
    <input id="nc-max" type="number" value="${node.maxAcquire ?? 1}" min="1" style="width:80px;">
  </div>
  <div style="display:flex;gap:8px;align-items:center;">
    <label style="min-width:80px;">${loc("SD.Progression.NodeCost")}</label>
    <input id="nc-cost" type="number" value="${node.cost ?? 1}" min="0" style="width:80px;">
  </div>
  <div style="display:flex;gap:8px;align-items:center;">
        <label style="min-width:80px;">${loc("SD.Progression.NodeColor")}</label>
        <input id="nc-color" type="color" value="${node.color || "#1e1e2e"}" style="width:56px;height:28px;">
      </div>
      <div>
        <div style="font-size:12px;font-weight:600;margin-bottom:6px;color:var(--sd-text-3);">
          <i class="fas fa-sliders-h"></i> ${loc("SD.Progression.FieldChanges")}
        </div>
        <div id="nc-fcs" style="display:flex;flex-direction:column;gap:4px;">${fcRows}</div>
        <button type="button" id="nc-add-fc" style="margin-top:6px;font-size:11px;padding:3px 8px;">
          <i class="fas fa-plus"></i> ${loc("SD.Progression.AddFieldChange")}</button>
      </div>
      <div>
        <div style="font-size:12px;font-weight:600;margin-bottom:6px;color:var(--sd-text-3);display:flex;align-items:center;justify-content:space-between;">
          <span><i class="fas fa-magic"></i> ${loc("SD.Progression.NodeEffects") || "Active Effects"}</span>
          <button type="button" id="nc-add-eff" style="font-size:11px;padding:3px 8px;">
            <i class="fas fa-plus"></i> ${loc("SD.Progression.AddEffect") || "Add Effect"}</button>
        </div>
        <div id="nc-effs" style="display:flex;flex-direction:column;gap:4px;">${effectRows}</div>
      </div>
    </div>`;

    const confirmed = await foundry.applications.api.DialogV2.prompt({
      window:  { title: `${loc("SD.Progression.ConfigNode")}: ${node.label || node.item?.name || nodeId}` },
      content,
      ok: {
        label:    loc("SD.Save"),
        icon:     "fas fa-save",
        callback: (event, btn, dialog) => {
              const el = dialog.element;
              node.label = el.querySelector("#nc-label")?.value ?? node.label;
              node.maxAcquire = parseInt(el.querySelector("#nc-max")?.value) || 1;
              node.cost = parseInt(el.querySelector("#nc-cost")?.value) ?? 1;
              node.color = el.querySelector("#nc-color")?.value ?? "";

          const fcs = [];
          el.querySelectorAll("#nc-fcs .sd-prog-fc-row").forEach(row => {
            const path  = row.querySelector(".nc-variable")?.value?.trim();
            const mode  = row.querySelector(".nc-mode")?.value ?? "add";
            const value = row.querySelector(".nc-value")?.value ?? "0";
            if (path) fcs.push({ variableId:path, mode, value });
          });
          node.fieldChanges = fcs;
          return true;
        }
      },
      render: (event, dialog) => {
        const el = dialog.element;
        const safeNodeMaxId = defaultMaxId;

        el.addEventListener("click", async ev => {
          if (ev.target.closest(".nc-del-fc")) {
            ev.target.closest(".sd-prog-fc-row")?.remove();
            return;
          }
          const editBtn = ev.target.closest(".nc-edit-eff");
          if (editBtn) {
            ev.preventDefault();
            const idx = parseInt(editBtn.dataset.idx);
            const ef  = (node.effects ?? [])[idx];
            if (!ef) return;
            const updated = await _editEffectViaStandardConfig(ef, {
              parent: this._actor,
              title:  `${loc("SD.Progression.EditEffect") || "Edit effect"}: ${ef.name ?? ""}`
            });
            if (!updated) return;
            node.effects[idx] = { ...ef, ...updated };
            const cont = el.querySelector("#nc-effs");
            if (cont) cont.innerHTML = _renderEffectRows(node.effects);
            return;
          }
          const delBtn = ev.target.closest(".nc-del-eff");
          if (delBtn) {
            ev.preventDefault();
            const idx = parseInt(delBtn.dataset.idx);
            if (Number.isFinite(idx)) {
              node.effects ??= [];
              node.effects.splice(idx, 1);
              const cont = el.querySelector("#nc-effs");
              if (cont) cont.innerHTML = _renderEffectRows(node.effects);
            }
            return;
          }
        });

        el.querySelector("#nc-add-fc")?.addEventListener("click", () => {
          const container = el.querySelector("#nc-fcs");
          const idx = container.querySelectorAll(".sd-prog-fc-row").length;
          const div = document.createElement("div");
          div.className = "sd-prog-fc-row";
          div.dataset.idx = idx;
        div.innerHTML = `
        <select class="nc-variable" style="flex:1 1 100%;min-width:0;width:100%;box-sizing:border-box;">${dbVariableOptions(safeNodeMaxId,"actor")}</select>
        <select class="nc-mode"><option value="add">+</option><option value="set">=</option><option value="multiply">×</option></select>
        <input type="text" class="nc-value" value="1" style="width:56px;">
        <button type="button" class="nc-del-fc"><i class="fas fa-times"></i></button>`;
          container.appendChild(div);
        });

        el.querySelector("#nc-add-eff")?.addEventListener("click", async () => {
          const newEf = {
            name:     loc("SD.Progression.NewEffect") || "New Effect",
            icon:     "icons/svg/aura.svg",
            img:      "icons/svg/aura.svg",
            disabled: false,
            transfer: true,
            changes:  []
          };
          const updated = await _editEffectViaStandardConfig(newEf, {
            parent: this._actor,
            title:  `${loc("SD.Progression.EditEffect") || "Edit effect"}: ${newEf.name}`
          });
          if (!updated) return;
          node.effects ??= [];
          node.effects.push({ ...newEf, ...updated });
          const cont = el.querySelector("#nc-effs");
          if (cont) cont.innerHTML = _renderEffectRows(node.effects);
        });
      },
      rejectClose: false
    });

    if (confirmed) {
      const nIdx = st.nodes.findIndex(n => n.id === nodeId);
      if (nIdx >= 0) { st.nodes[nIdx] = node; await this._saveSkilltree(st); this.render(); }
    }
  }

  async _handleItemDrop(event, levelIdx) {
    event.preventDefault();
    const data = (foundry.applications.ux?.TextEditor?.implementation ?? TextEditor).getDragEventData(event);
    if (data?.type !== "Item") return;
    const item = await this._resolveDropItem(data);
    if (!item) return;

    const snap          = item.toObject();
    snap._sourceUuid    = data.uuid;
    const levels        = dc(this._levels);
    if (!levels[levelIdx]) return;
    levels[levelIdx].items ??= [];
    levels[levelIdx].items.push(snap);
    await this._saveLevels(levels);
    this.render();
  }

  async _handleStCellDrop(event, col, row) {
    event.preventDefault();
    const data = (foundry.applications.ux?.TextEditor?.implementation ?? TextEditor).getDragEventData(event);
    if (data?.type !== "Item") return;
    const item = await this._resolveDropItem(data);
    if (!item) return;

    const snap       = item.toObject();
    snap._sourceUuid = data.uuid;
    const st         = dc(this._skilltree ?? { cols: 8, rows: 5, nodes: [], connections: [] });
    st.nodes ??= [];
    st.nodes.push({
      id: rndId(), col, row,
      label: item.name,
      item: snap,
      effects: [], fieldChanges: [],
      maxAcquire: 1, cost: 1,
      color: ""
    });
    await this._saveSkilltree(st);
    this.render();
  }

  async _handleNodeItemDrop(event, nodeId) {
    event.preventDefault();
    const data = (foundry.applications.ux?.TextEditor?.implementation ?? TextEditor).getDragEventData(event);
    if (data?.type !== "Item") return;
    const item = await this._resolveDropItem(data);
    if (!item) return;

    const snap       = item.toObject();
    snap._sourceUuid = data.uuid;
    const st         = dc(this._skilltree ?? { cols: 8, rows: 5, nodes: [], connections: [] });
    const node       = st.nodes?.find(n => n.id === nodeId);
    if (node) { node.item = snap; node.label ||= item.name; }
    await this._saveSkilltree(st);
    this.render();
  }

  async _handleClassItemDrop(event) {
    event.preventDefault();
    const data = (foundry.applications.ux?.TextEditor?.implementation ?? TextEditor).getDragEventData(event);
    if (data?.type !== "Item") return;
    const item = await this._resolveDropItem(data);
    if (item?.type !== "class") {
      ui.notifications.warn(loc("SD.Progression.NeedClassItem")); return;
    }
    let actorItem = this._actor.items.get(item.id);
    if (!actorItem) {
      const d = item.toObject(); delete d._id;
      [actorItem] = await this._actor.createEmbeddedDocuments("Item", [d]);
    }
    await this._setActiveTabField("classItemId", actorItem.id);
    this.render();
  }

  async _handleSkilltreeItemDrop(event) {
    event.preventDefault();
    const data = (foundry.applications.ux?.TextEditor?.implementation ?? TextEditor).getDragEventData(event);
    if (data?.type !== "Item") return;
    const item = await this._resolveDropItem(data);
    if (item?.type !== "skilltree") {
      ui.notifications.warn(loc("SD.Progression.NeedSkilltreeItem")); return;
    }
    let actorItem = this._actor.items.get(item.id);
    if (!actorItem) {
      const d = item.toObject(); delete d._id;
      [actorItem] = await this._actor.createEmbeddedDocuments("Item", [d]);
    }
    await this._setActiveTabField("skilltreeItemId", actorItem.id);
    this.render();
  }

  async _resolveDropItem(data) {
    try { return data.uuid ? await fromUuid(data.uuid) : null; } catch { return null; }
  }

  async _saveLevels(levels) {
    const tab = this._getActiveTab();
    if (!tab) return;
    if (tab.classItemId) {
      const item = this._actor.items.get(tab.classItemId);
      if (item) { await item.update({ "system.levels": levels }); return; }
    }
    await this._setActiveTabField("inlineLevels", levels);
  }

  async _saveSkilltree(st) {
    const tab = this._getActiveTab();
    if (!tab) return;
    if (tab.skilltreeItemId) {
      const item = this._actor.items.get(tab.skilltreeItemId);
      if (item) {
        await item.update({
          "system.cols": st.cols, "system.rows": st.rows,
          "system.nodes": st.nodes, "system.connections": st.connections
        });
        return;
      }
    }
    await this._setActiveTabField("inlineSkilltree", st);
  }

  async _writeNormalizedConfig(cfg) {
    const out = dc(cfg ?? {});
    const tabs = this._normalizeTabs(out);
    out.tabs = tabs;
    delete out.classItemId;
    delete out.skilltreeItemId;
    delete out.inlineLevels;
    delete out.inlineSkilltree;
    delete out.skillPointsPathValue;
    delete out.skillPointsPathMax;
    if (!out.activeTabId || !tabs.find(t => t.id === out.activeTabId)) {
      out.activeTabId = tabs[0]?.id ?? null;
    }
    await this._actor.unsetFlag("sd", "progression.config").catch(() => {});
    await this._actor.setFlag("sd", "progression.config", out);
    return out;
  }

  async _setActiveTabField(field, value) {
    const cfg = dc(this._config);
    const tabs = this._normalizeTabs(cfg);
    const activeId = this._activeTabId ?? tabs[0]?.id;
    const idx = tabs.findIndex(t => t.id === activeId);
    if (idx < 0) return;
    tabs[idx] = { ...tabs[idx], [field]: value };
    cfg.tabs = tabs;
    cfg.activeTabId = tabs[idx].id;
    delete cfg.classItemId;
    delete cfg.skilltreeItemId;
    delete cfg.inlineLevels;
    delete cfg.inlineSkilltree;
    delete cfg.skillPointsPathValue;
    delete cfg.skillPointsPathMax;
    await this._actor.unsetFlag("sd", "progression.config").catch(() => {});
    await this._actor.setFlag("sd", "progression.config", cfg);
    this._activeTabId = tabs[idx].id;
  }

  async _addTab() {
    const cfg = dc(this._config);
    const tabs = this._normalizeTabs(cfg);
    const id = `tab_${rndId()}`;
    tabs.push({
      id,
      name: `${loc("SD.Progression.TabDefaultName") || "Track"} ${tabs.length + 1}`,
      classItemId: null,
      skilltreeItemId: null,
      inlineLevels: [],
      inlineSkilltree: null,
      levelVariableId: preferredVariableId("level"),
      skillPointsValueId: DEFAULT_SP_VALUE_ID,
      skillPointsMaxId: DEFAULT_SP_MAX_ID
    });
    cfg.tabs = tabs;
    cfg.activeTabId = id;
    delete cfg.classItemId;
    delete cfg.skilltreeItemId;
    delete cfg.inlineLevels;
    delete cfg.inlineSkilltree;
    delete cfg.skillPointsPathValue;
    delete cfg.skillPointsPathMax;
    await this._actor.unsetFlag("sd", "progression.config").catch(() => {});
    await this._actor.setFlag("sd", "progression.config", cfg);
    this._activeTabId = id;
    this.render();
  }

  async _deleteTab(id) {
    if (!id) return;
    const cfg = dc(this._config);
    const tabs = this._normalizeTabs(cfg);
    if (tabs.length <= 1) return;
    const idx = tabs.findIndex(t => t.id === id);
    if (idx < 0) return;
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window:  { title: loc("SD.Progression.DeleteTrack") || "Delete Track" },
      content: `<p>${(loc("SD.Progression.DeleteTrackConfirm") || "Delete track \"{name}\"?").replace("{name}", e(tabs[idx].name))}</p>`,
      yes: { label: loc("SD.Delete") || "Delete", icon: "fas fa-trash" }
    });
    if (!confirmed) return;
    tabs.splice(idx, 1);
    cfg.tabs = tabs;
    if (cfg.activeTabId === id || this._activeTabId === id) {
      cfg.activeTabId = tabs[0]?.id ?? null;
      this._activeTabId = cfg.activeTabId;
    }
    delete cfg.classItemId;
    delete cfg.skilltreeItemId;
    delete cfg.inlineLevels;
    delete cfg.inlineSkilltree;
    delete cfg.skillPointsPathValue;
    delete cfg.skillPointsPathMax;
    await this._actor.unsetFlag("sd", "progression.config").catch(() => {});
    await this._actor.setFlag("sd", "progression.config", cfg);
    this.render();
  }

  async _renameTab(id, name) {
    if (!id) return;
    const cfg = dc(this._config);
    const tabs = this._normalizeTabs(cfg);
    const idx = tabs.findIndex(t => t.id === id);
    if (idx < 0) return;
    tabs[idx].name = String(name ?? "").trim() || tabs[idx].name;
    cfg.tabs = tabs;
    delete cfg.classItemId;
    delete cfg.skilltreeItemId;
    delete cfg.inlineLevels;
    delete cfg.inlineSkilltree;
    delete cfg.skillPointsPathValue;
    delete cfg.skillPointsPathMax;
    await this._actor.unsetFlag("sd", "progression.config").catch(() => {});
    await this._actor.setFlag("sd", "progression.config", cfg);
  }

  async _promptString(title, initial = "") {
    return foundry.applications.api.DialogV2.prompt({
      window:  { title },
      content: `<div style="padding:8px;"><input id="psi" type="text" value="${e(initial)}" style="width:100%;"></div>`,
      ok: { callback: (_ev, _btn, dlg) => dlg.element.querySelector("#psi")?.value ?? "" },
      rejectClose: false
    });
  }

  async close(options) {
    ProgressionApp._instances.delete(this._actor?.id);
    return super.close(options);
  }
}
