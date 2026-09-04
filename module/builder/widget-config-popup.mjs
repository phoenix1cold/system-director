import { FormulaEngine }   from "../helpers/formula-engine.mjs";
import { FormulaGraph }    from "./formula-graph.mjs";
import { WIDGET_VARIANTS, WIDGET_TYPES, CLICKABLE_WIDGET_TYPES, createWidget } from "./widget-registry.mjs";
import { assignUniqueWidgetDataPaths, buildWidgetPathRegistryUpdate } from "./widget-paths.mjs";
import { sanitizeWidgetCss, widgetBuilderScopeId } from "./widget-css.mjs";
import { getConfiguredDataPathEntries, getSystemPathEntries, isConfiguredSettingsPath } from "../helpers/system-config.mjs";
import { getValueDefinitions, getValueDefinition, variableIdForLegacyPath } from "../helpers/value-database.mjs";
import { SDOnboarding } from "../helpers/onboarding.mjs";
import { widgetVariables, widgetVarPath, coerceWidgetValue } from "../helpers/widget-variables.mjs";
import { openFoundryWindow } from "../helpers/foundry-window-host.mjs";
import { getLanguages, translationEditLanguage, setTranslationEditLanguage, localizedField, setLocalizedField, TRANSLATABLE_KEYS } from "../helpers/localization.mjs";

const SD_SLOT_TILE_ICON_PRESETS = [
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
const SD_SLOT_TILE_ICON_PATH = name => `systems/sd/assets/slot-icons/${name}.svg`;
const SD_HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

const FIELD_DEFS = {
  text:      [["Display Name","label"],["Widget Key","widgetKey","text"],["Bound Property","path","path"],["Value Formula","valueFormula","formula"],["Read Only","readOnly","boolean"]],
  number:    [["Display Name","label"],["Widget Key","widgetKey","text"],["Bound Property","path","path"],["Min","min","text"],["Max","max","text"],["Step","step","number"]],
  resource:  [["Display Name","label"],["Widget Key","widgetKey","text"],["Value Property","pathValue","path"],["Maximum Property","pathMax","path"]],
  button:    [["Label","label"],["Widget Key","widgetKey","text"],["FA Icon (e.g. fa-bolt)","icon","text"],["Chat Flavor / Message","flavor","text"]],
  toggle:    [["Display Name","label"],["Widget Key","widgetKey","text"],["Bound Property","path","path"],["On Label","onLabel","text"],["Off Label","offLabel","text"]],
  section:   [["Section Title","label"],["Widget Key","widgetKey","text"]],
  vsection:  [["Title","label"],["Widget Key","widgetKey","text"]],
  richtext:  [["Display Name","label"],["Widget Key","widgetKey","text"],["Bound Property","path","path"]],
  attribute: [["Label","label"],["Widget Key","widgetKey","text"],["Variable","path","path"],["Chat Flavor","flavor","text"]],
  skill:     [["Label","label"],["Widget Key","widgetKey","text"],["Variable","path","path"],["Attr Modifier","attrMod","number"],["Chat Flavor","flavor","text"],["Pips count (Pips variant only)","pipMax","number"]],
  slot:      [["Label","label"],["Widget Key","widgetKey","text"],["Slot ID","slotId","text"],["Max Items","maxCount","number"],["SD.Slots.AutoEquip","autoEquip","boolean"]],
  inventory: [["Label","label"],["Widget Key","widgetKey","text"],["Category Variable (Database)","categoryVariable","dbvar"],["Accepted Categories","categories","array"],["Extra Columns (Database variables)","columnVariables","dbvarlist"],["Show Currency Section","showCurrency","boolean"],["Currency Path (optional)","currencyPath","path"],["Compact (button + popover)","compact","boolean"],["FA icon (compact only)","icon","text"]],
  effects:   [["Label","label"],["Widget Key","widgetKey","text"],["Show Disabled","showDisabled","boolean"],["Show Passive","showPassive","boolean"],["Compact (button + popover)","compact","boolean"],["FA icon (compact only)","icon","text"]],
  spellbook: [["Label","label"],["Widget Key","widgetKey","text"],["Type Variable (Database)","typeVariable","dbvar"],["Accepted Types","abilityTypes","array"],["Extra Columns (Database variables)","columnVariables","dbvarlist"],["Compact (button + popover)","compact","boolean"],["FA icon (compact only)","icon","text"]],
  attributeGroup: [["Button Label","label"],["Widget Key","widgetKey","text"],["Database Variable IDs (comma-separated)","attributeKeys","text"],["FA icon","icon","text"]],

  counter:   [["Display Name","label"],["Widget Key","widgetKey","text"],["Bound Property","path","path"],["Step","step","number"],["Min","min","number"],["Max","max","number"]],
  tokenPool: [["Label","label"],["Widget Key","widgetKey","text"],["Value Variable","path","path"],["Max Variable (blank = use Max)","maxPath","path"],["Max","maxCount","number"],["FA icon (filled)","icon","text"],["FA icon (empty, blank = same)","emptyIcon","text"],["Glow on filled","glow","boolean"]],

  diceTray:  [["Label","label"],["Widget Key","widgetKey","text"],["Flag Path (default flags.sd.lastRoll)","flagPath","text"]],

  progress: [["Display Name","label"],["Widget Key","widgetKey","text"],["Value Property","pathValue","path"],["Maximum Property","pathMax","path"],["Show label","showLabel","boolean"],["Show percentage","showPct","boolean"]],
  select:   [["Display Name","label"],["Widget Key","widgetKey","text"],["Bound Property","path","path"],["Choices (comma-separated)","choices","text"]],
  clock:    [["Label","label"],["Widget Key","widgetKey","text"],["Filled count path","path","path"],["Segments (2–12)","segments","number"]],
  tracker:  [["Label","label"],["Widget Key","widgetKey","text"],["Value Variable","path","path"],["Max Variable (blank = use Max)","maxPath","path"],["Max","maxCount","number"],["FA icon (filled)","icon","text"],["FA icon (empty, blank = same)","emptyIcon","text"],["Glow on filled","glow","boolean"]],
  tags:     [["Label","label"],["Widget Key","widgetKey","text"],["Data path","path","path"]],
  image:    [["Label (optional)","label"],["Widget Key","widgetKey","text"],["Image","staticSrc","image-pick"]],
  derived:  [["Label","label"],["Widget Key","widgetKey","text"],["Formula","formula","formula"],["Decimal places","decimalPlaces","number"]],

  widgetBuilder: [["Display Name","label"],["Widget Key","widgetKey","text"],["Layout","wbLayout","select",["grid","free"]],["Columns (grid layout)","columns","number"],["Gap (px, grid layout)","gap","number"],["Canvas width (px, free layout; 0 = full width)","canvasW","number"],["Canvas height (px, free layout)","canvasH","number"],["Visual grid size (px)","gridSize","number"],["Snap step (px; 0 = off)","snap","number"],["Clip elements outside canvas","clipOverflow","boolean"],["Elements","elements","wbElements"],["Scoped CSS","customCss","css"]],

  questMarker: [
    ["Label", "label", "text"],
    ["Widget Key", "widgetKey", "text"],
    ["Locked QuestLog (optional)", "questLogUuid", "dropUuid", ["Item.questlog"]],
    ["Icon when a quest is active (FA class)", "iconActive", "text"],
    ["Icon when no active quest (FA class)", "iconNone", "text"],
    ["Compact (icon-only)", "compact", "select", ["no", "yes"]],
    ["Text when no active quest", "placeholder", "text"],
    ["Tooltip preview length (chars)", "tooltipLength", "number"]
  ],

  cardHand: [
    ["Label","label"],
    ["Widget Key","widgetKey","text"],
    ["Cards stack name","sourceName","text"],
    ["…or Cards UUID","sourceUuid","text"],
    ["Layout","layout","select",["fan","strip","grid"]],
    ["Click on card","clickAction","select",["inspect","play","discard","flip","runGraph","none"]],
    ["Run graph on (when clickAction=runGraph)","runGraphOn","select",["click","dblclick","rightclick"]],
    ["Action graph (when clickAction=runGraph)","actionGraph","actionGraph"],
    ["Show count","showCount","select",["yes","no"]],
    ["Show actions bar (Shuffle/Recall/Flip All)","showActions","select",["yes","no"]],
    ["Card width (px)","cardWidth","number"],
    ["Max visible (0 = all)","maxVisible","number"]
  ],
  cardDrawButton: [
    ["Label","label"],
    ["Widget Key","widgetKey","text"],
    ["From deck name","fromName","text"],
    ["…or Deck UUID","fromUuid","text"],
    ["To hand name","toName","text"],
    ["…or Hand UUID","toUuid","text"],
    ["Cards per click","count","number"],
    ["Take from","how","select",["top","bottom","random"]],
    ["Show count badge","showCount","select",["yes","no"]]
  ]
};

for (const [type, def] of Object.entries(WIDGET_TYPES ?? {})) {
  if (Array.isArray(FIELD_DEFS[type])) continue;
  const cf = Array.isArray(def?.configFields) ? def.configFields : null;
  if (!cf?.length) continue;
  FIELD_DEFS[type] = cf.map(f => {
    const tup = [f.label ?? f.key ?? "", f.key, f.type ?? "text"];
    if (Array.isArray(f.options)) tup.push(f.options);
    return tup;
  });
}

for (const [type, variants] of Object.entries(WIDGET_VARIANTS)) {
  if (!variants?.length) continue;
  if (!Array.isArray(FIELD_DEFS[type])) FIELD_DEFS[type] = [];
  FIELD_DEFS[type].push(["Variant", "variant", "variant", variants]);
}

for (const type of (CLICKABLE_WIDGET_TYPES ?? [])) {
  if (!Array.isArray(FIELD_DEFS[type])) FIELD_DEFS[type] = [];
  if (FIELD_DEFS[type].some(row => Array.isArray(row) && row[1] === "animationTag")) continue;
  FIELD_DEFS[type].push(["Animation Tag (Automated Animations)", "animationTag", "text"]);
}

const STYLE_DEFS = {
  text:      [["Width (px)","boxW","style-px"],["Height (px)","boxH","style-px"],["Background","boxBg","style-color"],["Text color","boxFg","style-color"],["Border","boxBorder","style-color"],["Border radius (px)","boxRadius","style-px"],["Padding (px)","boxPad","style-px"]],
  number:    [["Width (px)","boxW","style-px"],["Height (px)","boxH","style-px"],["Background","boxBg","style-color"],["Text color","boxFg","style-color"],["Border","boxBorder","style-color"],["Border radius (px)","boxRadius","style-px"],["Padding (px)","boxPad","style-px"],["± Buttons color","btnColor","style-color"]],
  counter:   [["Width (px)","boxW","style-px"],["Height (px)","boxH","style-px"],["Background","boxBg","style-color"],["Text color","boxFg","style-color"],["Border","boxBorder","style-color"],["± Buttons color","btnColor","style-color"]],
  resource:  [["Width (px)","boxW","style-px"],["Bar height (px)","barH","style-px"],["Fill color","color","style-color"],["Track color","barTrack","style-color"],["Background","boxBg","style-color"],["Border","boxBorder","style-color"],["Border radius (px)","boxRadius","style-px"]],
  dice:      [["Width (px)","boxW","style-px"],["Height (px)","boxH","style-px"],["Button background","btnBg","style-color"],["Text color","btnFg","style-color"],["Button border","btnBorder","style-color"],["Border radius (px)","boxRadius","style-px"],["Icon color","iconColor","style-color"]],
  button:    [["Width (px)","boxW","style-px"],["Height (px)","boxH","style-px"],["Button background","btnBg","style-color"],["Text color","btnFg","style-color"],["Border","boxBorder","style-color"],["Border radius (px)","boxRadius","style-px"],["Icon color","iconColor","style-color"]],
  toggle:    [["Width (px)","boxW","style-px"],["On color","onColor","style-color"],["Off color","offColor","style-color"],["Border radius (px)","boxRadius","style-px"]],
  section:   [["Line color","lineColor","style-color"],["Title color","titleColor","style-color"],["Thickness (px)","lineThickness","style-px"]],
  vsection:  [["Border color","boxBorder","style-color"],["Background","boxBg","style-color"],["Title color","titleColor","style-color"],["Border radius (px)","boxRadius","style-px"]],
  richtext:  [["Minimum height (optional; blank = auto)","boxH","style-px"],["Background","boxBg","style-color"],["Text color","boxFg","style-color"],["Border","boxBorder","style-color"],["Border radius (px)","boxRadius","style-px"],["Padding (px)","boxPad","style-px"]],
  attribute: [["Width (px)","boxW","style-px"],["Height (px)","boxH","style-px"],["Background","boxBg","style-color"],["Number color","boxFg","style-color"],["Border","boxBorder","style-color"],["Border radius (px)","boxRadius","style-px"]],
  skill:     [["Width (px)","boxW","style-px"],["Background","boxBg","style-color"],["Text color","boxFg","style-color"],["Border","boxBorder","style-color"],["Border radius (px)","boxRadius","style-px"]],
  slot:      [["Width (px)","boxW","style-px"],["Height (px)","boxH","style-px"],["Tile size (px, Equipment Tile only)","tileSize","style-px"],["Background","boxBg","style-color"],["Border","boxBorder","style-color"],["Border radius (px)","boxRadius","style-px"],["Padding (px)","boxPad","style-px"]],
  inventory: [["Height (px)","boxH","style-px"],["Background","boxBg","style-color"],["Header color","headerColor","style-color"],["Border","boxBorder","style-color"]],
  effects:   [["Height (px)","boxH","style-px"],["Background","boxBg","style-color"],["Border","boxBorder","style-color"]],
  spellbook: [["Height (px)","boxH","style-px"],["Background","boxBg","style-color"],["Border","boxBorder","style-color"]],
  progress:  [["Width (px)","boxW","style-px"],["Bar height (px)","barH","style-px"],["Fill color","color","style-color"],["Track color","barTrack","style-color"],["Border radius (px)","boxRadius","style-px"]],
  select:    [["Width (px)","boxW","style-px"],["Height (px)","boxH","style-px"],["Background","boxBg","style-color"],["Text color","boxFg","style-color"],["Border","boxBorder","style-color"]],
  clock:     [["Segment size (px)","pipSize","style-px"],["Stroke width (px)","pipBorder","style-px"],["Filled color","color","style-color"],["Empty color","bgColor","style-color"]],
  tracker:   [["Pip size (px)","pipSize","style-px"],["Filled color","color","style-color"],["Empty color","emptyColor","style-color"]],
  tokenPool: [["Pip size (px)","pipSize","style-px"],["Filled color","color","style-color"],["Empty color","emptyColor","style-color"]],
  diceTray:  [["Background","boxBg","style-color"],["Border","boxBorder","style-color"],["Border radius (px)","boxRadius","style-px"]],
  tags:      [["Width (px)","boxW","style-px"],["Background","boxBg","style-color"],["Pill color","color","style-color"],["Text color","tagFg","style-color"],["Border","boxBorder","style-color"]],
  image:     [["Width (px)","width","style-px"],["Height (px)","height","style-px"],["Border radius (px)","borderRadius","style-px"],["Border","boxBorder","style-color"],["Border width (px)","borderWidth","style-px"]],
  derived:   [["Width (px)","boxW","style-px"],["Height (px)","boxH","style-px"],["Background","boxBg","style-color"],["Text color","boxFg","style-color"],["Border","boxBorder","style-color"],["Border radius (px)","boxRadius","style-px"],["Value font size (px, 0 = default)","valueFontSize","style-px"]],
  widgetBuilder: [["Background","boxBg","style-color"],["Text color","boxFg","style-color"],["Border","boxBorder","style-color"],["Border radius (px)","boxRadius","style-px"],["Padding (px)","boxPad","style-px"]],
  cardHand:  [["Min height (px)","boxH","style-px"],["Background","boxBg","style-color"],["Text color","boxFg","style-color"],["Border","boxBorder","style-color"],["Border radius (px)","boxRadius","style-px"],["Padding (px)","boxPad","style-px"]],
  cardDrawButton:[["Width (px)","boxW","style-px"],["Height (px)","boxH","style-px"],["Button background","btnBg","style-color"],["Text color","btnFg","style-color"],["Border","boxBorder","style-color"],["Border radius (px)","boxRadius","style-px"]]
};

const FIELD_HINTS = {
  path:         "Choose a typed Actor or Item property. The technical path is kept internally and never needs to be typed.",
  categoryVariable: "Database variable that stores the item category. Items are matched by its value - HiddenFields are no longer used.",
  categories:   "Accepted values of the Category Variable, comma separated (weapon, armor, ...). An item is shown when at least one value matches. Empty = show everything.",
  columnVariables: "Database variables shown as extra columns. Ctrl / Cmd + click to select several - each one becomes a column with the value of that item.",
  typeVariable: "Database variable that stores the ability type. Abilities are matched by its value - HiddenFields are no longer used.",
  abilityTypes: "Accepted values of the Type Variable, comma separated (spell, technique, ...). An ability is shown when at least one value matches. Empty = show everything.",
  valueFormula: "Formula — computed at display time. Use {system.path}, {item:Name.field}, {widget:key}, 1d20+{@attr1}",
  formula:      "Roll formula — connect values from the Database graph",
  widgetKey:    "Optional unique name for this widget. Other widgets can read its value via {widget:thisKey}",
  showIf:       "Show this widget only when a field or widget equals a specific value. Leave blank to always show.",
  cssClass:     "Space-separated CSS class names added to the widget's outer element for custom styling",
  choices:      "Comma-separated list of option values. Example: low,medium,high",
  segments:     "Number of clock segments (2–12). The path stores the filled count as an integer.",
  icon:         "FontAwesome icon class. Examples: fa-circle, fa-heart, fa-star",
  bgColor:      "Colour of empty/unfilled segments",
  staticSrc:    "Path to the image. Click the folder to pick via FilePicker.",
  decimalPlaces:"Decimal places to show for derived numeric values (0 = whole number)",
  showCurrency: "Show a currency row at the top of the inventory. " +
                "Leave Currency Path blank to use the world's configured currencies (Settings → System Configuration → Currency). " +
                "Set Currency Path to show a single custom money field instead.",
  currencyPath: "Path to a single money field — e.g. system.currency.primary or system.flags.gold. " +
                "When set, the currency row shows one labelled input bound to this path. " +
                "Leave blank to use the world's configured currency list (Settings → System Configuration → Currency).",
  costField:    "HiddenField key on each ability item that stores its activation cost. " +
                "Create a HiddenField named «cost» on every ability item — its value will be deducted " +
                "from the Mana Path when the ability is activated. Default key: cost",
};

let _wcfgOpenCount = 0;
let _wcfgZTop      = 10000;
const _wcfgApps    = new Map();

export async function openWidgetConfigPopup(w, tab, row, doc, options = {}) {

  const _appKey = `${doc?.uuid ?? doc?.id ?? "document"}:${w?.id ?? w?.widgetKey ?? w?.type ?? "widget"}`;
  const _openApp = _wcfgApps.get(_appKey);
  if (_openApp?.rendered) {
    _openApp.bringToFront?.();
    _openApp.element?.querySelector?.("input,select,textarea")?.focus?.();
    return _openApp;
  }
  if (_openApp) _wcfgApps.delete(_appKey);

  const existingForSameWidget = [...document.querySelectorAll(".sd-wcfg-popup")]
    .find(el => el.dataset.wcfgWidgetId && w?.id && el.dataset.wcfgWidgetId === w.id);
  if (existingForSameWidget) {
    existingForSameWidget.style.zIndex = String(++_wcfgZTop);
    existingForSameWidget.querySelector("input,select,textarea")?.focus?.();
    return;
  }

  const _numberMode = w.type === "number" && w.numberMode === "node" ? "node" : "classic";
  const _resourceMode = w.type === "resource" && w.resourceMode === "node" ? "node" : "classic";
  let _typeFields = FIELD_DEFS[w.type] ?? [["Label","label"]];
  if (w.type === "number" && _numberMode === "node") {
    _typeFields = [["Label","label"],["Widget Key","widgetKey","text"],["Variable","path","path"]];
  }
  if (w.type === "resource" && _resourceMode === "node") {
    _typeFields = _typeFields.filter(f => Array.isArray(f) && f[1] !== "pathMax");
  }
  const _commonFields = [
  ];
  const fields = [..._typeFields, ..._commonFields];
  const esc      = s => String(s ?? "").replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;");
  const editLanguage = translationEditLanguage();
  const languages = getLanguages();
  const _dbOptions = selected => { const resolved=getValueDefinition(selected)?.id||variableIdForLegacyPath(selected); return `<option value="">— Select Database variable —</option>` + getValueDefinitions().map(v=>`<option value="${esc(v.id)}" ${resolved===v.id?"selected":""}>${esc(v.name)} · ${esc(v.type)} [${esc(v.id)}]</option>`).join(""); };

  const IS = "width:100%;background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:4px;color:var(--sd-text);font-size:12px;padding:5px 8px;box-sizing:border-box;outline:none;transition:border-color .15s";
  const MONO = ";font-family:'Courier New',monospace;font-size:11px";

  const _showIfSources = (() => {
    const list=[];
    for(const t of (doc.system?.customTabs??[])) for(const r of (t.rows??[])) for(const ww of (r.widgets??[])) {
      if(ww.widgetKey&&ww.widgetKey!==w.widgetKey) list.push({value:`widget:${ww.widgetKey}`,label:`Widget: ${ww.widgetKey}`});
    }
    for(const variable of getValueDefinitions()) list.push({value:variable.id,label:`Database: ${variable.name} · ${variable.type} [${variable.id}]`});
    return list;
  })();

  const _showIfKey   = w.showIfKey   ?? "";
  const _showIfValue = w.showIfValue ?? "";

  const _styleDefs = STYLE_DEFS[w.type] ?? [];
  const _stylePxCell = (key, label, cur) => `
    <div class="wcfg-style-field">
      <label class="wcfg-style-lbl">${esc(label)}</label>
      <input type="number" min="0" step="1" data-field="${esc(key)}" data-ftype="style-px"
        value="${esc(cur ?? "")}" placeholder="auto" class="wcfg-style-num">
    </div>`;
  const _isHexColor = v => typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v.trim());
  const _styleColorCell = (key, label, cur) => {
    const valid = _isHexColor(cur);
    return `
    <div class="wcfg-style-field">
      <label class="wcfg-style-lbl">${esc(label)}</label>
      <div class="wcfg-style-color-wrap">
        <input type="color" data-field="${esc(key)}" data-ftype="style-color"
          value="${valid ? esc(cur.trim()) : "#000000"}" class="wcfg-style-color"
          ${valid ? "" : 'data-empty="1"'}>
        <button type="button" class="wcfg-style-clear" data-clear-style="${esc(key)}" title="Reset">✕</button>
      </div>
    </div>`;
  };

  const styleRow = _styleDefs.length ? `
    <div class="wcfg-style-section">
      <div class="wcfg-style-title"><i class="fas fa-palette"></i> Style</div>
      <div class="wcfg-style-grid">
        ${_styleDefs.map(([lbl, key, type]) =>
          type === "style-px"
            ? _stylePxCell(key, lbl, w[key])
            : _styleColorCell(key, lbl, w[key])
        ).join("")}
      </div>
      <div class="wcfg-style-hint">All fields are optional. Blank = default.</div>
    </div>` : "";

  const slotTileRow = (w.type === "slot") ? (() => {
    const curIcon    = String(w.placeholderIcon ?? "");
    const curAccent  = String(w.accentColor ?? "");
    const variantNow = String(w.variant ?? "default");
    const visible    = variantNow === "tile";
    const accentValid = SD_HEX_COLOR_RE.test(curAccent.trim());
    const presets = SD_SLOT_TILE_ICON_PRESETS.map(p => {
      const path = SD_SLOT_TILE_ICON_PATH(p.name);
      const sel  = curIcon === path;
      return `<button type="button" class="wcfg-slot-preset" data-slot-tile-icon="${esc(path)}"
        title="${esc(p.label)}"
        style="aspect-ratio:1/1;background:${sel?'color-mix(in srgb,var(--sd-accent) 22%,var(--sd-bg-2))':'var(--sd-bg-2)'};border:1px solid ${sel?'var(--sd-accent)':'var(--sd-border)'};border-radius:4px;cursor:pointer;padding:5px;display:flex;align-items:center;justify-content:center;transition:border-color .12s,background .12s">
        <img src="${esc(path)}" alt="${esc(p.label)}" style="max-width:100%;max-height:100%;opacity:.85;pointer-events:none" draggable="false">
      </button>`;
    }).join("");

    return `
    <div class="wcfg-f wcfg-slot-tile-block" data-show-variant="tile" style="margin-bottom:10px;${visible?'':'display:none;'}border:1px solid var(--sd-bg-3);border-radius:6px;padding:8px 10px;background:var(--sd-bg)">
      <label class="wcfg-lbl" style="display:flex;align-items:center;gap:6px"><i class="fas fa-image"></i> Equipment Tile (per-widget override)</label>
      <div style="font-size:10px;color:var(--sd-text-3);margin-bottom:6px;line-height:1.4">
        Icon &amp; accent shown by the <strong>Equipment Tile</strong> variant. Leave fields empty to inherit from the slot definition.
      </div>

      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <div class="wcfg-slot-preview" style="position:relative;width:36px;height:36px;flex-shrink:0;border:1px solid var(--sd-border);border-radius:4px;background:var(--sd-bg-2);display:flex;align-items:center;justify-content:center;overflow:hidden">
          ${curIcon ? `<img src="${esc(curIcon)}" alt="" style="max-width:100%;max-height:100%;opacity:.85" draggable="false">` : `<i class="fas fa-image" style="opacity:.3;font-size:14px"></i>`}
        </div>
        <button type="button" class="wcfg-slot-custom-pick"
          style="background:var(--sd-bg-3);border:1px solid var(--sd-border);border-radius:3px;color:var(--sd-text-2);cursor:pointer;font-size:11px;padding:3px 9px"><i class="fas fa-folder-open"></i> Custom…</button>
        <button type="button" class="wcfg-slot-icon-clear"
          style="background:none;border:1px solid var(--sd-border);border-radius:3px;color:var(--sd-text-3);cursor:pointer;font-size:11px;padding:3px 9px" title="Use slot definition fallback">✕ Use default</button>
      </div>

      <div class="wcfg-slot-preset-grid"
        style="display:grid;grid-template-columns:repeat(auto-fill,minmax(40px,1fr));gap:4px;margin-bottom:8px">
        ${presets}
      </div>

      <div style="display:flex;align-items:center;gap:6px">
        <span style="font-size:10px;color:var(--sd-text-3);text-transform:uppercase;letter-spacing:.05em;flex-shrink:0">Accent</span>
        <input type="color" class="wcfg-slot-accent-color"
          value="${esc(accentValid ? curAccent.trim() : "#d4b15a")}"
          ${accentValid ? "" : 'data-empty="1"'}
          style="width:34px;height:26px;background:transparent;border:1px solid var(--sd-border);border-radius:3px;cursor:pointer;padding:0">
        <input type="text" class="wcfg-slot-accent-text"
          value="${esc(curAccent)}" placeholder="#d4b15a (empty = inherit)"
          style="flex:1;min-width:0;background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:3px;color:var(--sd-text);font-size:11px;font-family:monospace;padding:3px 6px">
        <button type="button" class="wcfg-slot-accent-clear"
          style="background:none;border:1px solid var(--sd-border);border-radius:3px;color:var(--sd-text-3);cursor:pointer;font-size:11px;padding:3px 8px" title="Use slot definition fallback">✕</button>
      </div>

      <input type="hidden" data-field="placeholderIcon" data-ftype="text" value="${esc(curIcon)}">
      <input type="hidden" data-field="accentColor"     data-ftype="text" value="${esc(curAccent)}">
    </div>`;
  })() : "";

  const showIfRow = `
    <div class="wcfg-f" style="margin-top:10px;border-top:1px solid var(--sd-bg-3);padding-top:10px">
      <label class="wcfg-lbl" style="margin-bottom:4px;display:block">Show if…</label>
      <div style="display:grid;grid-template-columns:1fr auto 1fr;gap:5px;align-items:center">
        <select id="wcfg-showif-key" data-field="showIfKey" style="background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:4px;color:var(--sd-text);font-size:11px;padding:4px 6px">
          <option value="">— Always show —</option>
          ${_showIfSources.map(s => `<option value="${esc(s.value)}" ${_showIfKey===s.value?"selected":""}>${esc(s.label)}</option>`).join("")}
        </select>
        <span style="color:var(--sd-text-3);font-size:11px;flex-shrink:0">=</span>
        <input id="wcfg-showif-value" data-field="showIfValue" data-ftype="text" type="text" placeholder="e.g. true, 1, sword"
          value="${esc(_showIfValue)}"
          style="background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:4px;color:var(--sd-text);font-size:11px;padding:4px 6px;width:100%;box-sizing:border-box">
      </div>
      <div style="font-size:9px;color:var(--sd-text-3);margin-top:4px;line-height:1.4">
        Select a widget or typed document field, then set the value it must equal.
        Leave the value empty to show only when the source is truthy.
      </div>
    </div>`;

  const _renderFieldRow = ([lbl, key, type="text", opts=[]]) => {
    try {
      const translated = game.i18n?.localize?.(lbl);
      if (translated && translated !== lbl) lbl = translated;
    } catch {}
    let cur = w[key] ?? ""; if (Array.isArray(cur) && type !== "select") cur = cur.join(", ");
    const isPF = type === "path" || type === "formula";
    const hint = FIELD_HINTS[key] ?? FIELD_HINTS[type] ?? "";
    const noteColor = type === "formula" ? "var(--sd-accent-2)" : type === "path" ? "var(--sd-mp)" : "";

    if (type === "path") {
      const varLabel = String(lbl).replace(/path/ig, "Value");
      const descriptor = (widgetVariables(w) ?? []).find(entry => entry.field === key) ?? { field: key, label: varLabel, type: "text", initial: "" };
      const selfPath = widgetVarPath(w, key);
      const stored = doc ? foundry.utils.getProperty(doc, selfPath) : undefined;
      const current = stored !== undefined ? stored : (w.varDefaults?.[key] ?? descriptor.initial ?? "");
      const shown = Array.isArray(current) ? current.join(", ") : current;
      const control = descriptor.type === "boolean"
        ? `<label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--sd-text-2)"><input type="checkbox" data-field="__wvar_${esc(key)}" data-ftype="widgetvar" ${current ? "checked" : ""}> Enabled</label>`
        : `<input type="${descriptor.type === "number" ? "number" : "text"}" ${descriptor.type === "number" ? `step="any"` : ""} data-field="__wvar_${esc(key)}" data-ftype="widgetvar" value="${esc(shown)}" placeholder="${esc(descriptor.type === "array" ? "a, b, c" : "value")}" style="${IS}">`;
      return `
      <div class="wcfg-f" style="margin-bottom:10px">
        <label class="wcfg-lbl">${esc(descriptor.label ?? varLabel)} <span style="background:var(--sd-accent-2);color:#10131a;font-size:9px;padding:1px 5px;border-radius:3px;margin-left:4px;font-weight:600;text-transform:none">own value</span></label>
        ${hint ? `<div style="font-size:10px;color:var(--sd-text-3);margin-bottom:3px;line-height:1.4">${esc(hint)}</div>` : ""}
        ${control}
        <input type="hidden" data-field="${esc(key)}" data-ftype="text" value="${esc(selfPath)}">
        <div style="font-size:9px;color:var(--sd-text-3);margin-top:4px;line-height:1.4">This widget stores its own value. Type it here, or drive it from the Blueprint node of this widget.</div>
      </div>`;
    }

    if (type === "dbvar") {
      return `
      <div class="wcfg-f" style="margin-bottom:10px">
        <label class="wcfg-lbl">${esc(lbl)} <span style="background:var(--sd-mp);color:#10131a;font-size:9px;padding:1px 5px;border-radius:3px;margin-left:4px;font-weight:600;text-transform:none">database</span></label>
        ${hint ? `<div style="font-size:10px;color:var(--sd-text-3);margin-bottom:3px;line-height:1.4">${esc(hint)}</div>` : ""}
        <select data-field="${esc(key)}" data-ftype="dbvar" style="${IS}">${_dbOptions(w[key] ?? "")}</select>
      </div>`;
    }

    if (type === "dbvarlist") {
      const rawList = Array.isArray(w[key]) ? w[key] : String(w[key] ?? "").split(",");
      const selected = rawList.map(entry => String(entry ?? "").trim()).filter(Boolean)
        .map(entry => getValueDefinition(entry)?.id || variableIdForLegacyPath(entry) || entry);
      const defs = getValueDefinitions();
      const options = defs.map(v => `<option value="${esc(v.id)}" ${selected.includes(v.id) ? "selected" : ""}>${esc(v.name)} · ${esc(v.type)} [${esc(v.id)}]</option>`).join("");
      return `
      <div class="wcfg-f" style="margin-bottom:10px">
        <label class="wcfg-lbl">${esc(lbl)} <span style="background:var(--sd-mp);color:#10131a;font-size:9px;padding:1px 5px;border-radius:3px;margin-left:4px;font-weight:600;text-transform:none">database</span></label>
        ${hint ? `<div style="font-size:10px;color:var(--sd-text-3);margin-bottom:3px;line-height:1.4">${esc(hint)}</div>` : ""}
        <select multiple data-field="${esc(key)}" data-ftype="dbvarlist" size="${Math.min(6, Math.max(3, defs.length || 3))}" style="${IS};height:auto">${options || `<option value="" disabled>No Database variables yet</option>`}</select>
        <div style="font-size:9px;color:var(--sd-text-3);margin-top:4px;line-height:1.4">Ctrl / Cmd + click to select several. ${defs.length ? "Each selected variable becomes a column." : "Create variables in the Database window first."}</div>
      </div>`;
    }

    if (type === "color") {
      const safeColor = _isHexColor(cur) ? cur.trim() : "var(--sd-accent)";
      return `
      <div class="wcfg-f" style="margin-bottom:10px">
        <label class="wcfg-lbl">${esc(lbl)}</label>
        <input type="color" data-field="${esc(key)}" value="${esc(safeColor)}" style="height:32px;width:56px;padding:2px;border:1px solid var(--sd-border);border-radius:4px;background:var(--sd-bg);cursor:pointer">
      </div>`;
    }

    if (type === "image-pick") return `
      <div class="wcfg-f" style="margin-bottom:10px">
        <label class="wcfg-lbl">${esc(lbl)}</label>
        <div style="display:flex;gap:5px;align-items:center">
          <input type="text" data-field="${esc(key)}" data-ftype="text"
            value="${esc(cur ?? "")}" placeholder="path/to/image.png or icon/svg/..."
            style="${IS}flex:1">
          <button type="button" class="wcfg-fp-btn" data-fp-target="${esc(key)}"
            title="Pick file"
            style="height:28px;padding:0 9px;background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:4px;color:var(--sd-accent);cursor:pointer;font-size:11px;flex-shrink:0">
            <i class="fas fa-folder-open"></i>
          </button>
          ${cur ? `<img src="${esc(cur)}" alt="preview" style="width:28px;height:28px;object-fit:cover;border-radius:3px;border:1px solid var(--sd-border);flex-shrink:0">` : ""}
        </div>
      </div>`;

    if (type === "boolean") return `
      <div class="wcfg-f wcfg-boolean-row" style="margin-bottom:10px">
        <label for="wcfg-bool-${esc(key)}" class="wcfg-checkbox-label">
          <input type="checkbox" class="wcfg-checkbox-control" data-field="${esc(key)}" data-ftype="boolean"
            id="wcfg-bool-${esc(key)}" ${cur === true || cur === "true" ? "checked" : ""}
            style="appearance:auto!important;-webkit-appearance:checkbox!important;display:inline-block!important;position:static!important;opacity:1!important;width:15px!important;min-width:15px!important;max-width:15px!important;height:15px!important;min-height:15px!important;max-height:15px!important;padding:0!important;margin:0!important;accent-color:var(--sd-accent);cursor:pointer;flex:0 0 15px!important">
          <span>${esc(lbl)}</span>
        </label>
      </div>`;

    if (type === "select") return `
      <div class="wcfg-f" style="margin-bottom:10px">
        <label class="wcfg-lbl">${esc(lbl)}</label>
        <select data-field="${esc(key)}" data-ftype="select"
          style="${IS}">
          ${opts.map(o => `<option value="${esc(o)}" ${String(cur)===String(o)?"selected":""}>${esc(o)}</option>`).join("")}
        </select>
      </div>`;

    if (type === "variant") {
      const i18n = globalThis.game?.i18n;
      const selected = String(cur || "default");
      const renderOpt = id => {
        const k = `SD.WidgetVariants.${w.type}.${id}`;
        let label = id === "default" ? "Default" : id;
        try {
          if (i18n?.has?.(k)) label = i18n.localize(k);
          else if (i18n?.localize) {
            const v = i18n.localize(k);
            if (v && v !== k) label = v;
          }
        } catch {  }
        return `<option value="${esc(id)}" ${selected===id?"selected":""}>${esc(label)}</option>`;
      };
      return `
      <div class="wcfg-f" style="margin-bottom:10px">
        <label class="wcfg-lbl">${esc(lbl)}</label>
        <select data-field="${esc(key)}" data-ftype="variant"
          style="${IS}">
          ${opts.map(renderOpt).join("")}
        </select>
        <div style="font-size:9px;color:var(--sd-text-3);margin-top:3px;line-height:1.4">
          Visual skin for this widget. Data and behaviour are unaffected.
        </div>
      </div>`;
    }

    if (type === "dropUuid") {
      const allow = Array.isArray(opts) && opts.length ? opts.join(", ") : "any document";
      return `
      <div class="wcfg-f" style="margin-bottom:10px">
        <label class="wcfg-lbl">${esc(lbl)}</label>
        <div class="wcfg-drop-uuid" data-field-target="${esc(key)}"
             data-allow-types="${esc(opts.join(","))}"
             style="display:flex;gap:5px;align-items:center;border:1px dashed var(--sd-border);border-radius:4px;padding:4px;background:var(--sd-bg)">
          <input type="text" data-field="${esc(key)}" data-ftype="text"
            value="${esc(cur ?? "")}" placeholder="Drop ${esc(allow)} here, or paste UUID"
            style="${IS}flex:1;border:none;background:transparent">
          <button type="button" class="wcfg-clear-uuid" data-target="${esc(key)}"
            title="Clear"
            style="background:none;border:none;color:var(--sd-danger-dim);cursor:pointer;font-size:14px;padding:0 4px;line-height:1;flex-shrink:0">✕</button>
        </div>
        <div style="font-size:9px;color:var(--sd-text-3);margin-top:3px;line-height:1.4">
          Drag a ${esc(allow)} from a sidebar / compendium directly onto this field, or paste its UUID.
        </div>
      </div>`;
    }

    if (type === "actionGraph") {
      const hasGraph = !!(w.graphData && Array.isArray(w.graphData.nodes) && w.graphData.nodes.length);
      const status = hasGraph
        ? `<span style="color:var(--sd-success);font-size:10px">graph: ${w.graphData.nodes.length} node${w.graphData.nodes.length===1?"":"s"}</span>`
        : `<span style="color:var(--sd-text-2);font-size:10px;font-style:italic">no graph yet</span>`;
      return `
      <div class="wcfg-f" style="margin-bottom:10px">
        <label class="wcfg-lbl">
          ${esc(lbl)}
          <span style="background:var(--sd-accent-2);color:var(--sd-accent-text,#fff);font-size:9px;padding:1px 5px;border-radius:3px;margin-left:4px;font-weight:400;text-transform:none;letter-spacing:0">action</span>
        </label>
        <div style="display:flex;gap:8px;align-items:center">
          <button type="button" data-open-action-graph="${esc(key)}"
            style="background:var(--sd-bg-4);border:1px solid var(--sd-accent);border-radius:4px;color:var(--sd-accent);cursor:pointer;font-size:11px;padding:5px 10px;line-height:1;transition:background .15s">
            🔷 Edit Action Graph
          </button>
          ${status}
          <input type="hidden" data-field="${esc(key)}" data-ftype="text" value="${esc(cur ?? "")}">
        </div>
      </div>`;
    }

    if (type === "css") {
      const scopeId = widgetBuilderScopeId(w.id);
      const preview = sanitizeWidgetCss(cur, `[data-sd-wb="${scopeId}"]`);
      return `
      <div class="wcfg-f" style="margin-bottom:10px">
        <label class="wcfg-lbl">${esc(lbl)}</label>
        <div style="font-size:10px;color:var(--sd-text-3);margin-bottom:5px;line-height:1.45">
          CSS is automatically scoped to this Widget Builder. Use <code>:scope</code> for its root,
          <code>[data-wb-element="Name"]</code> for an element, or normal descendants such as
          <code>.sd-wb-button</code>. Global selectors, at-rules, external URLs and unsafe properties are blocked.
        </div>
        <textarea data-field="${esc(key)}" data-ftype="css" spellcheck="false"
          placeholder=":scope { --sd-wb-accent: #7b68ee; }&#10;[data-wb-element=&quot;Attack&quot;] .sd-wb-button { border-radius: 12px; }"
          style="${IS};min-height:170px;resize:vertical;font-family:'Courier New',monospace;font-size:11px;line-height:1.45">${esc(cur)}</textarea>
        <div class="wcfg-css-status" style="font-size:9px;margin-top:4px;color:${preview.warnings.length ? 'var(--sd-warning,#d6a84b)' : 'var(--sd-success,#62c98a)'}">
          ${preview.warnings.length ? esc(preview.warnings.join(" · ")) : "CSS passed the safe scoped parser"}
        </div>
      </div>`;
    }

    if (type === "wbElements") {
      const els = Array.isArray(w[key]) ? w[key] : [];
      return `
      <div class="wcfg-f" style="margin-bottom:10px">
        <label class="wcfg-lbl">Widget Designer</label>
        <div style="font-size:10px;color:var(--sd-text-3);margin-bottom:8px;line-height:1.45">
          Open the full UMG-style designer with Palette, Hierarchy, Canvas, Details, Database variables and live Free-mode dragging. Widget logic belongs to the single Sheet Blueprint.
        </div>
        <button type="button" id="wcfg-open-widget-designer" class="sd-open-widget-designer">
          <i class="fas fa-object-group"></i> OPEN FULL WIDGET DESIGNER
        </button>
        <input type="hidden" id="wcfg-wb-json" data-field="${esc(key)}" data-ftype="json" value="${esc(JSON.stringify(els))}">
      </div>`;
    }

    if (type === "slotconfig") {
      const rows = (Array.isArray(w[key]) ? w[key] : []).map((entry, i) => {
        const lvl  = esc(String(entry.level   ?? i + 1));
        const maxP = esc(String(entry.maxPath  ?? ""));
        const valP = esc(String(entry.valuePath ?? ""));
        return `
        <div class="wcfg-slotrow" style="display:grid;grid-template-columns:32px 1fr 1fr 22px;gap:4px;align-items:center;margin-bottom:5px" data-idx="${i}">
          <input type="number" class="wcfg-slot-level" value="${lvl}" min="0" max="20"
            style="background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:3px;color:var(--sd-accent);font-size:11px;padding:2px 4px;text-align:center;width:100%"
            title="Level number">
          <select class="wcfg-slot-maxpath" style="background:var(--sd-bg);border:1px solid var(--sd-mp);border-radius:3px;color:var(--sd-mp);font-size:10px;padding:2px 5px;width:100%">${_dbOptions(maxP)}</select>
          <select class="wcfg-slot-valpath" style="background:var(--sd-bg);border:1px solid var(--sd-success);border-radius:3px;color:var(--sd-success);font-size:10px;padding:2px 5px;width:100%">${_dbOptions(valP)}</select>
          <button type="button" class="wcfg-slot-del" style="background:none;border:none;color:var(--sd-danger-dim);cursor:pointer;font-size:13px;padding:0;line-height:1" title="Remove level">✕</button>
        </div>`;
      }).join("");

      return `
      <div class="wcfg-f" style="margin-bottom:10px">
        <label class="wcfg-lbl">${esc(lbl)}</label>
        <div style="font-size:10px;color:var(--sd-text-3);margin-bottom:6px;line-height:1.4">
          Lv · <span style="color:var(--sd-mp)">Max Variable</span> · <span style="color:var(--sd-success)">Value Variable</span>
        </div>
        <div id="wcfg-slotrows" style="max-height:220px;overflow-y:auto">
          ${rows || "<div style='font-size:10px;color:var(--sd-text-3);font-style:italic'>No levels — click Add Level below</div>"}
        </div>
        <button type="button" id="wcfg-slot-add"
          style="margin-top:6px;background:var(--sd-bg);border:1px solid var(--sd-accent-2);border-radius:4px;color:var(--sd-accent);cursor:pointer;font-size:10px;padding:3px 10px">
          + Add Level
        </button>
        <input type="hidden" id="wcfg-slotconfig-json" data-field="${esc(key)}" data-ftype="json" value="${esc(JSON.stringify(Array.isArray(w[key]) ? w[key] : []))}">
      </div>`;
    }

    return `
      <div class="wcfg-f" style="margin-bottom:10px;position:relative">
        <label class="wcfg-lbl">
          ${esc(lbl)}
          ${noteColor ? `<span style="background:${noteColor};color:#fff;font-size:9px;padding:1px 5px;border-radius:3px;margin-left:4px;font-weight:400;text-transform:none;letter-spacing:0">${type}</span>` : ""}
        </label>
        ${hint ? `<div style="font-size:10px;color:var(--sd-text-3);margin-bottom:3px;line-height:1.4">${esc(hint)}</div>` : ""}
        <div class="wcfg-input-row" data-wcfg-row="${type === "formula" ? "formula" : "field"}" style="display:flex;gap:5px;align-items:center;min-width:0">
          <input type="${type==="number"?"number":"text"}" data-field="${esc(key)}" data-ftype="${type}"
            value="${esc(cur)}"
            style="${IS}${isPF?MONO:""};flex:1"
            placeholder="${type==="path"?"Select Database variable":type==="formula"?"1d20 + Database value":type==="array"?"ammo, magazine":""}">
          ${isPF ? `<button type="button" data-clear-field="${esc(key)}" class="wcfg-clear-btn" title="Clear">✕</button>` : ""}
        </div>
      </div>`;
  };

  const _tabForField = (f) => {
    const fKey = f?.[1];
    const fType = f?.[2] ?? "text";
    if (w.type === "widgetBuilder") {
      if (fKey === "elements" || fKey === "wbLayout" || fKey === "columns" || fKey === "gap" || fKey === "canvasW" || fKey === "canvasH" || fKey === "gridSize" || fKey === "snap" || fKey === "clipOverflow") return "elements";
      if (fKey === "customCss") return "style";
      if (fType === "formula" || fType === "actionGraph" || fKey === "animationTag") return "main";
      return "main";
    }
    if (fType === "formula" || fType === "actionGraph" || fKey === "animationTag" || fKey === "valueFormula") return "main";
    return "main";
  };
  const _rowsFor = (tabId) => fields.filter(f => _tabForField(f) === tabId).map(_renderFieldRow).join("");
  const sharedGraphRow = `<div class="wcfg-shared-blueprint"><div><b><i class="fas fa-diagram-project"></i> Sheet Blueprint</b><small>One graph for every widget and event on this sheet.</small></div><button type="button" data-open-sheet-blueprint title="Open Sheet Blueprint" aria-label="Open Sheet Blueprint"><i class="fas fa-arrow-up-right-from-square"></i></button></div>`;
  const _mainRows = sharedGraphRow + _rowsFor("main");
  const _paneList = [
    ["main",     w.type === "widgetBuilder" ? "General" : "Main", _mainRows],
    ["elements", "Elements", _rowsFor("elements")],
    ["style",    "Style",    slotTileRow + styleRow],
    ["showif",   "Show If",  showIfRow]
  ].filter(pn => String(pn[2]).trim() !== "");
  const _tabBar = _paneList.length > 1 ? `
    <div id="wcfg-tabs" class="wcfg-tabs" style="display:flex;gap:2px;padding:0 12px;background:var(--sd-popover-bg,var(--sd-bg));border-bottom:1px solid var(--sd-border);flex-shrink:0;overflow-x:auto">
      ${_paneList.map((pn, i) => `<button type="button" class="wcfg-tab-btn" data-cfg-tab="${pn[0]}" style="background:none;border:none;border-bottom:2px solid ${i === 0 ? "var(--sd-accent)" : "transparent"};color:${i === 0 ? "var(--sd-accent)" : "var(--sd-text-3)"};cursor:pointer;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;padding:8px 10px;white-space:nowrap">${pn[1]}</button>`).join("")}
    </div>` : "";
  const _panesHtml = _paneList.map((pn, i) => `<div class="wcfg-tabpane" data-cfg-tab="${pn[0]}" style="${i === 0 ? "" : "display:none"}">${pn[2]}</div>`).join("");

  const popup = document.createElement("div");
  popup.className = "sd sd-wcfg-popup";
  if (w?.id)        popup.dataset.wcfgWidgetId = w.id;
  if (w?.widgetKey) popup.dataset.wcfgWidgetKey = w.widgetKey;
  try {
    const themeAttr = document.documentElement?.getAttribute?.("data-sd-theme")
      || document.body?.getAttribute?.("data-sd-theme")
      || "default";
    popup.setAttribute("data-sd-theme", themeAttr);
    const fxAttr = document.documentElement?.getAttribute?.("data-sd-theme-fx")
      || document.body?.getAttribute?.("data-sd-theme-fx")
      || "";
    if (fxAttr) popup.setAttribute("data-sd-theme-fx", fxAttr);
  } catch {  }

  const sheetRect = document.querySelector(".app.sd.sheet.item, .app.sd.sheet.actor, [id^='sd-']")?.getBoundingClientRect()
    ?? { right: 400, top: 80, width: 0 };

  const _wcfgIndex = _wcfgOpenCount++ % 8;
  const _wcfgOffX = _wcfgIndex * 24;
  const _wcfgOffY = _wcfgIndex * 24;
  const popLeft = Math.min(Math.max(sheetRect.right + 10 + _wcfgOffX, 20), window.innerWidth  - 440);
  const popTop  = Math.min(Math.max(sheetRect.top  + 40 + _wcfgOffY, 10), window.innerHeight - 200);
  const _wcfgZ  = ++_wcfgZTop;

  popup.style.cssText = `
    position:relative;width:100%;height:100%;min-width:0;min-height:0;
    overflow:hidden;
    background:var(--sd-popover-bg,var(--sd-bg));
    font-family:'Signika','Palatino Linotype',serif;color:var(--sd-text);
    display:flex;flex-direction:column;`;

  popup.addEventListener("mousedown", () => {
    popup.style.zIndex = String(++_wcfgZTop);
  }, true);

  const ICON_MAP = { text:"fa-font", number:"fa-hashtag", resource:"fa-heart-pulse", dice:"fa-dice-d20", button:"fa-square-bolt", toggle:"fa-toggle-on", section:"fa-minus", richtext:"fa-align-left", attribute:"fa-chart-bar", skill:"fa-list-check", slot:"fa-layer-group", inventory:"fa-backpack", effects:"fa-sparkles", spellbook:"fa-book-sparkles" };

  popup.innerHTML = `
    <!-- Header -->
    <div id="wcfg-hdr" class="wcfg-hero" style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--sd-popover-bg,var(--sd-bg));border-bottom:1px solid var(--sd-border);flex-shrink:0;cursor:move">
      <span style="font-size:12px;font-weight:700;text-transform:uppercase;color:var(--sd-accent)">
        <i class="fas ${ICON_MAP[w.type]??'fa-gear'}" style="margin-right:7px;opacity:.8"></i>Widget Details
      </span>
      <label style="margin-left:auto;margin-right:10px;display:flex;align-items:center;gap:5px;font-size:10px;color:var(--sd-text-2)"><i class="fas fa-language"></i><select id="wcfg-language" title="Translation editing language" style="background:var(--sd-bg);color:var(--sd-text);border:1px solid var(--sd-border);border-radius:3px">${languages.map(l=>`<option value="${esc(l.id)}" ${l.id===editLanguage?"selected":""}>${esc(l.name)}</option>`).join("")}</select></label>
      <button type="button" id="wcfg-x" style="background:none;border:none;color:var(--sd-text-3);cursor:pointer;font-size:16px;padding:0" aria-label="Close"><i class="fas fa-xmark"></i></button>
    </div>

    <div class="wcfg-identity" style="display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px 12px;padding:9px 14px;background:color-mix(in srgb,var(--sd-accent) 6%,var(--sd-bg));border-bottom:1px solid var(--sd-border)">
      <div><span style="display:block;font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--sd-text-3)">Display Name</span><b style="font-size:13px;color:var(--sd-text)">${esc(w.label || w.type)}</b></div>
      <div style="text-align:right"><span style="display:block;font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--sd-text-3)">Widget ID</span><code style="font-size:11px;color:var(--sd-accent);user-select:all">${esc(w.id || "unassigned")}</code></div>
    </div>
    ${w.type === "widgetBuilder" ? `<div style="padding:8px 14px;border-bottom:1px solid var(--sd-border);background:rgba(94,159,232,.08);color:var(--sd-text-2);font-size:11px"><i class="fas fa-shapes" style="color:var(--sd-accent);margin-right:6px"></i><b>UI Canvas restored:</b> use Elements for nested objects, Free/Grid layout and live positioning.</div>` : ""}
    ${_tabBar}
    <!-- Fields panel -->
    <div id="wcfg-panel-fields" class="wcfg-panel-fields" style="flex:1;overflow-y:auto;padding:14px 16px;display:flex;flex-direction:column;gap:0">
      ${_panesHtml}
    </div>

    <!-- Footer -->
    <div class="wcfg-footer" style="display:flex;justify-content:flex-end;gap:8px;padding:10px 16px;border-top:1px solid var(--sd-border);flex-shrink:0;background:var(--sd-popover-bg,var(--sd-bg))">
      <button type="button" id="wcfg-cancel" class="wcfg-footer-btn" style="padding:7px 16px;font-size:12px;font-weight:600;border-radius:5px;cursor:pointer;border:1px solid var(--sd-border);background:var(--sd-bg-3);color:var(--sd-text-2)">Cancel</button>
      <button type="button" id="wcfg-save"   class="wcfg-footer-btn" style="padding:7px 18px;font-size:12px;font-weight:700;border-radius:5px;cursor:pointer;border:1px solid var(--sd-accent);background:var(--sd-accent);color:var(--sd-accent-text,#fff)">
        <i class="fas fa-check" style="margin-right:5px"></i>Save
      </button>
    </div>`;

  for (const field of fields) {
    const key=Array.isArray(field)?field[1]:null;
    if (!key || !TRANSLATABLE_KEYS.has(key)) continue;
    const input=popup.querySelector(`[data-field="${CSS.escape(key)}"]`);
    if (input) input.value=localizedField(w,key,editLanguage,w[key]??"");
  }

  let windowApp = null;
  const _closePopup = () => windowApp?.close?.() ?? popup.remove();
  windowApp = openFoundryWindow({
    id:`sd-widget-config-${foundry.utils.randomID(8)}`,
    title:`Widget Details — ${w.label || w.type} [${w.id || "new"}]`,
    icon:`fa-solid ${ICON_MAP[w.type]??"fa-gear"}`,
    width:520,
    height:Math.min(720, Math.floor(window.innerHeight * 0.92)),
    minWidth:440,
    minHeight:280,
    classes:["sd-widget-config-window"],
    content:popup,
    onClose:()=>{ _wcfgApps.delete(_appKey); popup.remove(); }
  });
  _wcfgApps.set(_appKey, windowApp);

  const cssEditor = popup.querySelector('textarea[data-field="customCss"]');
  if (cssEditor) {
    const cssStatus = cssEditor.parentElement?.querySelector(".wcfg-css-status");
    const validateCss = () => {
      const scopeId = widgetBuilderScopeId(w.id);
      const result = sanitizeWidgetCss(cssEditor.value, `[data-sd-wb="${scopeId}"]`);
      if (cssStatus) {
        cssStatus.textContent = result.warnings.length ? result.warnings.join(" · ") : "CSS passed the safe scoped parser";
        cssStatus.style.color = result.warnings.length ? "var(--sd-warning,#d6a84b)" : "var(--sd-success,#62c98a)";
      }
    };
    cssEditor.addEventListener("input", validateCss);
  }

  (function _wireCfgTabs(){
    const tabBtns  = [...popup.querySelectorAll(".wcfg-tab-btn")];
    const tabPanes = [...popup.querySelectorAll(".wcfg-tabpane")];
    if (!tabBtns.length) return;
    const showTab = (id) => {
      tabPanes.forEach(p2 => { p2.style.display = (p2.dataset.cfgTab === id) ? "" : "none"; });
      tabBtns.forEach(b2 => {
        const on = b2.dataset.cfgTab === id;
        b2.style.color = on ? "var(--sd-accent)" : "var(--sd-text-3)";
        b2.style.borderBottomColor = on ? "var(--sd-accent)" : "transparent";
      });
    };
    tabBtns.forEach(b2 => b2.addEventListener("click", () => showTab(b2.dataset.cfgTab)));
  })();

  (function _wireDataFieldRefs(){
    const panel = popup.querySelector("#wcfg-panel-fields");
    if (!panel) return;
    const wKey = String(w.widgetKey ?? "").trim() || String(w.label ?? "").trim();
    const refs = [];
    const _noValTypes = ["button", "cardDrawButton", "section", "vsection", "widgetBuilder"];
    const _hasValue = !_noValTypes.includes(String(w.type ?? "")) || (w.valueFormula !== undefined && String(w.valueFormula ?? "").trim() !== "");
    if (wKey && _hasValue) {
      refs.push(["Value token", "{widget:" + wKey + "}"]);
      refs.push(["System field (value)", "system.widgetFields." + wKey + ".value"]);
    }
    if (wKey) {
      refs.push(["System field (label)", "system.widgetFields." + wKey + ".label"]);
    }
    if (wKey && String(w.type ?? "") === "widgetBuilder") {
      for (const wbEl of (Array.isArray(w.elements) ? w.elements : [])) {
        if (String(wbEl?.kind ?? "") !== "value") continue;
        const wbNm = String(wbEl?.name ?? "").trim();
        if (!wbNm) continue;
        refs.push(["Element value: " + wbNm, "system.widgetFields." + wKey + "." + wbNm + ".value"]);
      }
    }
    if (w.path)      refs.push(["Bound path", String(w.path)]);
    if (w.pathValue) refs.push(["Value Variable", String(w.pathValue)]);
    if (w.pathMax)   refs.push(["Max Variable", String(w.pathMax)]);
    if (wKey && ["inventory","spellbook","slot"].includes(String(w.type))) {
      refs.push(["Items array (names)", "{widget:" + wKey + ".names}"]);
      refs.push(["Items array (ids)",   "{widget:" + wKey + ".ids}"]);
      refs.push(["Items array (uuids)", "{widget:" + wKey + ".uuids}"]);
    }
    if (!refs.length) return;
    const esc2 = s => String(s).replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;");
    const wrap = document.createElement("div");
    wrap.style.cssText = "margin-top:12px;padding-top:10px;border-top:1px solid var(--sd-border)";
    wrap.innerHTML = `<div style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--sd-text-3);margin-bottom:6px"><i class="fas fa-copy" style="margin-right:6px"></i>Data fields (copy &amp; use in formulas)</div>` +
      refs.map(([label, val]) => `
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
          <span style="font-size:10px;color:var(--sd-text-3);min-width:118px;flex-shrink:0">${esc2(label)}</span>
          <code style="flex:1;font-size:10px;background:var(--sd-bg-3);border:1px solid var(--sd-border);border-radius:4px;padding:3px 6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc2(val)}</code>
          <button type="button" data-copy-ref="${esc2(val)}" title="Copy" style="background:var(--sd-bg-3);border:1px solid var(--sd-border);border-radius:4px;color:var(--sd-text-2);cursor:pointer;font-size:10px;padding:3px 7px"><i class="fas fa-copy"></i></button>
        </div>`).join("");
    (panel.querySelector('.wcfg-tabpane[data-cfg-tab="main"]') ?? panel).appendChild(wrap);
    wrap.querySelectorAll("[data-copy-ref]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const txt = btn.dataset.copyRef ?? "";
        try { await navigator.clipboard.writeText(txt); ui.notifications?.info?.("Copied: " + txt); }
        catch { ui.notifications?.warn?.("Copy manually: " + txt); }
      });
    });
  })();

  let _lastFocused = null;

  popup.querySelectorAll("button[data-clear-style]").forEach(btn => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.clearStyle;
      const inp = popup.querySelector(`input[data-field="${CSS.escape(key)}"]`);
      if (!inp) return;
      if (inp.type === "color") {
        inp.value = "#000000";
      } else {
        inp.value = "";
      }
      inp.dataset.empty = "1";
    });
  });

  popup.querySelectorAll("input.wcfg-style-color").forEach(inp => {
    inp.addEventListener("input", () => { delete inp.dataset.empty; });
  });

  (function _wireSlotTileBlock(){
    const block = popup.querySelector(".wcfg-slot-tile-block");
    if (!block) return;

    const iconInp   = block.querySelector('input[data-field="placeholderIcon"]');
    const accentInp = block.querySelector('input[data-field="accentColor"]');
    const preview   = block.querySelector(".wcfg-slot-preview");
    const accentTxt = block.querySelector(".wcfg-slot-accent-text");
    const accentClr = block.querySelector(".wcfg-slot-accent-color");

    const _renderPreview = (p) => {
      if (!preview) return;
      preview.innerHTML = p
        ? `<img src="${esc(p)}" alt="" style="max-width:100%;max-height:100%;opacity:.85" draggable="false">`
        : `<i class="fas fa-image" style="opacity:.3;font-size:14px"></i>`;
    };
    const _setIcon = (path) => {
      const p = String(path ?? "");
      if (iconInp) iconInp.value = p;
      _renderPreview(p);
      block.querySelectorAll(".wcfg-slot-preset").forEach(btn => {
        const sel = btn.dataset.slotTileIcon === p;
        btn.style.background  = sel ? "color-mix(in srgb,var(--sd-accent) 22%,var(--sd-bg-2))" : "var(--sd-bg-2)";
        btn.style.borderColor = sel ? "var(--sd-accent)" : "var(--sd-border)";
      });
    };

    block.querySelectorAll(".wcfg-slot-preset").forEach(btn => {
      btn.addEventListener("click", ev => {
        ev.preventDefault();
        _setIcon(btn.dataset.slotTileIcon);
      });
    });

    block.querySelector(".wcfg-slot-icon-clear")?.addEventListener("click", ev => {
      ev.preventDefault();
      _setIcon("");
    });

    block.querySelector(".wcfg-slot-custom-pick")?.addEventListener("click", ev => {
      ev.preventDefault();
      const FP = foundry.applications?.apps?.FilePicker ?? globalThis.FilePicker;
      if (!FP) { ui.notifications?.error?.("FilePicker not available"); return; }
      new FP({
        type: "image",
        current: iconInp?.value || "",
        callback: src => _setIcon(src || "")
      }).render(true);
    });

    const _setAccent = (val) => {
      const v = String(val ?? "").trim();
      if (accentInp) accentInp.value = v;
      if (accentTxt && document.activeElement !== accentTxt) accentTxt.value = v;
      const valid = SD_HEX_COLOR_RE.test(v);
      if (accentClr) {
        if (valid) { accentClr.value = v; delete accentClr.dataset.empty; }
        else { accentClr.value = "#d4b15a"; accentClr.dataset.empty = "1"; }
      }
    };

    accentTxt?.addEventListener("input", () => _setAccent(accentTxt.value));
    accentClr?.addEventListener("input", () => _setAccent(accentClr.value));
    block.querySelector(".wcfg-slot-accent-clear")?.addEventListener("click", ev => {
      ev.preventDefault();
      _setAccent("");
    });

    const variantSel = popup.querySelector('select[data-field="variant"]');
    if (variantSel) {
      variantSel.addEventListener("change", () => {
        block.style.display = variantSel.value === "tile" ? "" : "none";
      });
    }
  })();

  popup.querySelectorAll("button.wcfg-fp-btn[data-fp-target]").forEach(btn => {
    btn.addEventListener("click", ev => {
      ev.preventDefault();
      const key = btn.dataset.fpTarget;
      const inp = popup.querySelector(`input[data-field="${CSS.escape(key)}"]`);
      if (!inp) return;
      const FP = foundry.applications?.apps?.FilePicker ?? globalThis.FilePicker;
      if (!FP) { ui.notifications?.error?.("FilePicker is not available"); return; }
      new FP({
        type: "image",
        current: inp.value || "",
        callback: src => {
          inp.value = src;
          inp.dispatchEvent(new Event("input", { bubbles: true }));
          inp.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }).render(true);
    });
  });

  popup.querySelectorAll("input[data-field]").forEach(inp => {
    inp.addEventListener("focus", () => { _lastFocused = inp; });
  });

  popup.querySelectorAll(".wcfg-drop-uuid").forEach(zone => {
    const key = zone.dataset.fieldTarget;
    const inp = zone.querySelector(`input[data-field="${CSS.escape(key)}"]`);
    if (!inp) return;
    const allow = String(zone.dataset.allowTypes || "").split(",").map(s => s.trim()).filter(Boolean);
    zone.addEventListener("dragover", ev => {
      ev.preventDefault();
      zone.style.background = "var(--sd-bg-2, #2c2538)";
      zone.style.borderColor = "var(--sd-accent)";
    });
    zone.addEventListener("dragleave", () => {
      zone.style.background = "var(--sd-bg)";
      zone.style.borderColor = "var(--sd-border)";
    });
    zone.addEventListener("drop", async ev => {
      ev.preventDefault();
      zone.style.background = "var(--sd-bg)";
      zone.style.borderColor = "var(--sd-border)";
      let raw;
      try { raw = JSON.parse(ev.dataTransfer.getData("text/plain") || "null"); } catch { raw = null; }
      if (!raw) return;
      let uuid = null;
      if (typeof raw === "string") uuid = raw;
      else if (raw.uuid) uuid = raw.uuid;
      else if (raw.type && raw.id) uuid = `${raw.type}.${raw.id}`;
      if (!uuid) return;
      if (allow.length) {
        try {
          const doc = await fromUuid(uuid);
          const docType = doc?.documentName === "Item" ? `Item.${doc.type}` : doc?.documentName;
          const ok = allow.some(a => a === doc?.documentName || a === docType || a === doc?.type);
          if (!ok) {
            ui.notifications?.warn?.(`This widget expects: ${allow.join(", ")}`);
            return;
          }
        } catch {}
      }
      inp.value = uuid;
      inp.dispatchEvent(new Event("input", { bubbles: true }));
      inp.dispatchEvent(new Event("change", { bubbles: true }));
    });
  });

  popup.querySelectorAll(".wcfg-clear-uuid").forEach(btn => {
    btn.addEventListener("click", ev => {
      ev.preventDefault();
      const key = btn.dataset.target;
      const inp = popup.querySelector(`input[data-field="${CSS.escape(key)}"]`);
      if (!inp) return;
      inp.value = "";
      inp.dispatchEvent(new Event("input", { bubbles: true }));
      inp.dispatchEvent(new Event("change", { bubbles: true }));
    });
  });

  popup.querySelectorAll("input[data-ftype='path'], input[data-ftype='formula']").forEach(inp => {
    inp.addEventListener("focus",  () => { _lastFocused = inp; });
  });

  const _showIfInp = popup.querySelector("input[data-field='showIf']");
  if (_showIfInp) {
    const _errEl = document.createElement("div");
    _errEl.style.cssText = "font-size:10px;color:var(--sd-danger);margin-top:2px;display:none;line-height:1.3";
    _showIfInp.parentElement?.after?.(_errEl) ?? _showIfInp.insertAdjacentElement("afterend", _errEl);

    const _validateShowIf = () => {
      const val = _showIfInp.value.trim();
      if (!val) {
        _showIfInp.style.borderColor = "";
        _errEl.style.display = "none";
        return;
      }
      try {
        FormulaEngine.evaluate(val, {});
        _showIfInp.style.borderColor = "var(--sd-border)";
        _errEl.style.display = "none";
      } catch (err) {
        _showIfInp.style.borderColor = "var(--sd-danger)";
        _errEl.textContent = "⚠ " + (err?.message ?? "Formula error");
        _errEl.style.display = "block";
      }
    };
    _showIfInp.addEventListener("input", _validateShowIf);
    _showIfInp.addEventListener("blur",  _validateShowIf);
    _validateShowIf();
  }

  popup.querySelectorAll(".wcfg-clear-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const inp = popup.querySelector(`input[data-field="${btn.dataset.clearField}"]`);
      if (inp) { inp.value = ""; inp.focus(); }
    });
  });

  const slotRowsContainer = popup.querySelector("#wcfg-slotrows");
  const slotAddBtn        = popup.querySelector("#wcfg-slot-add");

  const _rebuildSlotRows = () => {
    if (!slotRowsContainer) return;
    const isEmpty = slotRowsContainer.querySelectorAll(".wcfg-slotrow").length === 0;
    if (isEmpty) {
      const p = slotRowsContainer.querySelector(".wcfg-empty-hint");
      if (!p) {
        slotRowsContainer.innerHTML = "<div class='wcfg-empty-hint' style='font-size:10px;color:var(--sd-text-3);font-style:italic'>No levels — click Add Level below</div>";
      }
    } else {
      slotRowsContainer.querySelector(".wcfg-empty-hint")?.remove();
    }
  };

  if (slotRowsContainer) {
    slotRowsContainer.addEventListener("click", ev => {
      if (ev.target.closest(".wcfg-slot-del")) {
        ev.target.closest(".wcfg-slotrow").remove();
        _rebuildSlotRows();
      }
    });
    _rebuildSlotRows();
  }

  slotAddBtn?.addEventListener("click", () => {
    if (!slotRowsContainer) return;
    slotRowsContainer.querySelector(".wcfg-empty-hint")?.remove();

    const existing = [...slotRowsContainer.querySelectorAll(".wcfg-slot-level")]
      .map(el => parseInt(el.value) || 0);
    let next = 1;
    while (existing.includes(next)) next++;
    const div = document.createElement("div");
    div.className = "wcfg-slotrow";
    div.style.cssText = "display:grid;grid-template-columns:32px 1fr 1fr 22px;gap:4px;align-items:center;margin-bottom:5px";
    div.innerHTML = `
      <input type="number" class="wcfg-slot-level" value="${next}" min="0" max="20"
        style="background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:3px;color:var(--sd-accent);font-size:11px;padding:2px 4px;text-align:center;width:100%" title="Level number">
      <select class="wcfg-slot-maxpath" style="background:var(--sd-bg);border:1px solid var(--sd-mp);border-radius:3px;color:var(--sd-mp);font-size:10px;padding:2px 5px;width:100%">${_dbOptions("")}</select>
      <select class="wcfg-slot-valpath" style="background:var(--sd-bg);border:1px solid var(--sd-success);border-radius:3px;color:var(--sd-success);font-size:10px;padding:2px 5px;width:100%">${_dbOptions("")}</select>
      <button type="button" class="wcfg-slot-del" style="background:none;border:none;color:var(--sd-danger-dim);cursor:pointer;font-size:13px;padding:0;line-height:1" title="Remove level">✕</button>`;
    slotRowsContainer.appendChild(div);
  });
  const wbRowsEl = popup.querySelector("#wcfg-wb-rows");
  const wbLayersEl = popup.querySelector("#wcfg-wb-layers");
  const wbJsonEl = popup.querySelector("#wcfg-wb-json");
  if (wbRowsEl && wbJsonEl) {
    let wbEls = [];
    try { wbEls = JSON.parse(wbJsonEl.value || "[]"); } catch (e) { wbEls = []; }
    if (!Array.isArray(wbEls)) wbEls = [];
    wbEls = wbEls.map((el2, idx2) => ({
      id: el2?.id || foundry.utils.randomID(6),
      z: Number.isFinite(Number(el2?.z)) ? Math.round(Number(el2.z)) : idx2,
      locked: el2?.locked === true || el2?.locked === "true",
      hidden: el2?.hidden === true || el2?.hidden === "true",
      ...el2
    }));

    const wbSync = () => { wbJsonEl.value = JSON.stringify(wbEls); };
    const wbNameDup = (name, idx) =>
      !!name && wbEls.some((e2, i2) => i2 !== idx && String(e2?.name ?? "").trim() === name);
    const wbCanvasWrap = popup.querySelector("#wcfg-wb-canvas-wrap");
    const wbCanvasEl = popup.querySelector("#wcfg-wb-canvas");
    const embeddedTypes = Object.values(WIDGET_TYPES)
      .filter(def => def?.id && !["widgetBuilder", "vsection"].includes(def.id))
      .sort((a, b) => String(a.label ?? a.id).localeCompare(String(b.label ?? b.id)));
    const readNumField = (key, fallback) => {
      const raw = popup.querySelector(`input[data-field="${CSS.escape(key)}"]`)?.value;
      const num = Number(raw);
      return Number.isFinite(num) ? num : fallback;
    };
    const snapValue = value => {
      const snap = Math.max(0, readNumField("snap", Number(w.snap) || 4));
      return snap > 0 ? Math.round(value / snap) * snap : Math.round(value);
    };
    const wbNextZ = () => Math.max(-1, ...wbEls.map((e2, i2) => Number.isFinite(Number(e2.z)) ? Number(e2.z) : i2)) + 1;

    const _wbFillBox = (box, el2, fs) => {
      const nm = String(el2.name ?? "").trim() || "?";
      const col = String(el2.color ?? "").trim();
      const ic = String(el2.icon ?? "").trim();
      const im = String(el2.img ?? "").trim();
      const lb = String(el2.label ?? "").trim();
      const kind = String(el2.kind ?? "button");
      let inner = "";
      if (kind === "widget") {
        const def = WIDGET_TYPES[el2.widget?.type];
        inner = `<i class="fas ${esc(def?.icon ?? "fa-puzzle-piece")}" style="pointer-events:none${col ? ";color:" + esc(col) : ""}"></i>`;
        inner += `<span style="pointer-events:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:94%">${esc(el2.widget?.label || def?.label || "Select widget")}</span>`;
      } else {
        if (im) inner += `<img src="${esc(im)}" alt="" style="max-width:90%;max-height:55%;object-fit:contain;pointer-events:none">`;
        else if (ic) inner += `<i class="fas ${esc(ic)}" style="pointer-events:none${col ? ";color:" + esc(col) : ""}"></i>`;
        inner += `<span style="pointer-events:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:96%${fs > 0 ? ";font-size:" + fs + "px" : ""}">${esc(lb || nm)}</span>`;
      }
      inner += `<span style="pointer-events:none;font-size:8px;opacity:.55;line-height:1">${esc(kind)} · z${esc(String(el2.z ?? 0))}</span>`;
      if (el2.locked) inner += `<i class="fas fa-lock" style="position:absolute;left:3px;top:3px;font-size:8px;opacity:.8;pointer-events:none"></i>`;
      if (el2.hidden) inner += `<i class="fas fa-eye-slash" style="position:absolute;right:3px;top:3px;font-size:8px;opacity:.8;pointer-events:none"></i>`;
      box.innerHTML = inner;
      if (col) box.style.borderColor = col;
    };

    const _wbFocusRow = idx2 => {
      const rowEl2 = wbRowsEl.querySelector(`[data-wb-idx="${idx2}"]`);
      if (!rowEl2) return;
      rowEl2.scrollIntoView({ behavior: "smooth", block: "nearest" });
      rowEl2.style.borderColor = "var(--sd-accent)";
      rowEl2.style.boxShadow = "0 0 0 1px var(--sd-accent)";
      setTimeout(() => { rowEl2.style.borderColor = "var(--sd-border)"; rowEl2.style.boxShadow = "none"; }, 900);
    };

    const wbCanvasRender = () => {
      if (!wbCanvasWrap || !wbCanvasEl) return;
      const isFree = (popup.querySelector('select[data-field="wbLayout"]')?.value ?? String(w.wbLayout ?? "grid")) === "free";
      const snap = Math.max(0, readNumField("snap", Number(w.snap) || 4));
      const gridSize = Math.max(4, readNumField("gridSize", Number(w.gridSize) || 16));
      const hintEl2 = popup.querySelector("#wcfg-wb-canvas-hint");
      if (hintEl2) hintEl2.textContent = isFree
        ? `Free layout: drag to move, pull the lower-right handle to resize. Snap: ${snap || "off"} px. Locked layers cannot be moved.`
        : "Grid preview: drag a box onto another one to reorder. Switch to free layout for pixel placement and layers.";
      wbCanvasEl.innerHTML = "";
      if (!wbEls.length) {
        wbCanvasEl.style.height = "";
        wbCanvasEl.innerHTML = "<div style='padding:16px;text-align:center;font-size:10px;color:var(--sd-text-3);font-style:italic'>No elements yet - click + Add Element below</div>";
        return;
      }
      if (isFree) {
        const cwRaw = readNumField("canvasW", 0);
        const availW = Math.max(120, (wbCanvasEl.clientWidth || 380) - 2);
        const cw = cwRaw > 0 ? Math.max(60, cwRaw) : availW;
        const ch2 = Math.max(60, readNumField("canvasH", Number(w.canvasH) || 140));
        wbCanvasEl.style.height = (ch2 + 2) + "px";
        const inner2 = document.createElement("div");
        inner2.style.cssText = `position:relative;width:${cw}px;height:${ch2}px;background-image:linear-gradient(var(--sd-bg-3) 1px,transparent 1px),linear-gradient(90deg,var(--sd-bg-3) 1px,transparent 1px);background-size:${gridSize}px ${gridSize}px`;
        wbCanvasEl.appendChild(inner2);
        wbEls.forEach((el2, idx2) => {
          const box = document.createElement("div");
          const bw2 = Number(el2.w) > 0 ? Number(el2.w) : (el2.kind === "widget" ? 140 : 64);
          const bh2 = Number(el2.h) > 0 ? Number(el2.h) : (el2.kind === "widget" ? 64 : 28);
          box.style.cssText = `position:absolute;left:${Number(el2.x) || 0}px;top:${Number(el2.y) || 0}px;width:${bw2}px;height:${bh2}px;z-index:${Number(el2.z) || 0};border:1px solid var(--sd-accent-2);border-radius:4px;background:var(--sd-bg-4);color:var(--sd-text-2);font-size:10px;display:flex;flex-direction:column;gap:1px;align-items:center;justify-content:center;cursor:${el2.locked ? "default" : "move"};user-select:none;overflow:hidden;box-sizing:border-box;padding:2px;opacity:${el2.hidden ? ".28" : "1"}`;
          _wbFillBox(box, el2, Number(el2.size) > 0 ? Number(el2.size) : 0);
          const handle = document.createElement("div");
          handle.style.cssText = `position:absolute;right:0;bottom:0;width:13px;height:13px;cursor:nwse-resize;background:var(--sd-accent);opacity:.8;border-radius:7px 0 4px 0;display:${el2.locked ? "none" : "block"}`;
          box.appendChild(handle);
          let dragMode = null, moved = false, sx = 0, sy = 0, ox = 0, oy = 0, ow2 = 0, oh2 = 0;
          const onMove = ev3 => {
            const dx = ev3.clientX - sx, dy = ev3.clientY - sy;
            if (dx || dy) moved = true;
            if (dragMode === "move") {
              el2.x = Math.max(0, Math.min(Math.max(0, cw - bw2), snapValue(ox + dx)));
              el2.y = Math.max(0, Math.min(Math.max(0, ch2 - bh2), snapValue(oy + dy)));
              box.style.left = el2.x + "px";
              box.style.top = el2.y + "px";
            } else if (dragMode === "resize") {
              el2.w = Math.max(24, Math.min(Math.max(24, cw - (Number(el2.x) || 0)), snapValue(ow2 + dx)));
              el2.h = Math.max(20, Math.min(Math.max(20, ch2 - (Number(el2.y) || 0)), snapValue(oh2 + dy)));
              box.style.width = el2.w + "px";
              box.style.height = el2.h + "px";
            }
          };
          const onUp = () => {
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
            if (!dragMode) return;
            dragMode = null;
            wbSync();
            if (moved) wbRender(); else _wbFocusRow(idx2);
          };
          box.addEventListener("mousedown", ev3 => {
            if (ev3.target === handle || el2.locked) return;
            ev3.preventDefault();
            dragMode = "move"; moved = false; sx = ev3.clientX; sy = ev3.clientY;
            ox = Number(el2.x) || 0; oy = Number(el2.y) || 0;
            window.addEventListener("mousemove", onMove);
            window.addEventListener("mouseup", onUp);
          });
          box.addEventListener("click", () => _wbFocusRow(idx2));
          handle.addEventListener("mousedown", ev3 => {
            if (el2.locked) return;
            ev3.preventDefault(); ev3.stopPropagation();
            dragMode = "resize"; moved = false; sx = ev3.clientX; sy = ev3.clientY; ow2 = bw2; oh2 = bh2;
            window.addEventListener("mousemove", onMove);
            window.addEventListener("mouseup", onUp);
          });
          inner2.appendChild(box);
        });
      } else {
        const cols2 = Math.max(1, readNumField("columns", Number(w.columns) || 3));
        const gap2 = Math.max(0, readNumField("gap", Number(w.gap) || 6));
        wbCanvasEl.style.height = "";
        const inner2 = document.createElement("div");
        inner2.style.cssText = `position:relative;display:grid;grid-template-columns:repeat(${cols2},1fr);gap:${gap2}px;padding:8px`;
        wbCanvasEl.appendChild(inner2);
        let dragFrom = -1;
        wbEls.forEach((el2, idx2) => {
          const box = document.createElement("div");
          box.draggable = !el2.locked;
          box.style.cssText = `position:relative;min-height:38px;border:1px solid var(--sd-border);border-radius:4px;background:var(--sd-bg-4);color:var(--sd-text-2);font-size:10px;display:flex;flex-direction:column;gap:1px;align-items:center;justify-content:center;cursor:${el2.locked ? "default" : "grab"};user-select:none;overflow:hidden;box-sizing:border-box;padding:3px;opacity:${el2.hidden ? ".28" : "1"}`;
          _wbFillBox(box, el2, Number(el2.size) > 0 ? Number(el2.size) : 0);
          box.addEventListener("click", () => _wbFocusRow(idx2));
          box.addEventListener("dragstart", ev3 => { dragFrom = idx2; ev3.dataTransfer.effectAllowed = "move"; });
          box.addEventListener("dragover", ev3 => { ev3.preventDefault(); box.style.borderColor = "var(--sd-accent)"; });
          box.addEventListener("dragleave", () => { box.style.borderColor = String(el2.color ?? "").trim() || "var(--sd-border)"; });
          box.addEventListener("drop", ev3 => {
            ev3.preventDefault();
            if (dragFrom < 0 || dragFrom === idx2) { dragFrom = -1; return; }
            const mv2 = wbEls.splice(dragFrom, 1)[0];
            wbEls.splice(idx2, 0, mv2);
            wbEls.forEach((entry, order) => { entry.z = order; });
            dragFrom = -1;
            wbRender();
          });
          inner2.appendChild(box);
        });
      }
    };

    const renderLayers = () => {
      if (!wbLayersEl) return;
      if (!wbEls.length) {
        wbLayersEl.innerHTML = `<div style="font-size:10px;color:var(--sd-text-3);font-style:italic;padding:4px">No layers</div>`;
        return;
      }
      const ordered = wbEls.map((el2, idx2) => ({ el2, idx2 }))
        .sort((a, b) => (Number(b.el2.z) || 0) - (Number(a.el2.z) || 0) || b.idx2 - a.idx2);
      wbLayersEl.innerHTML = ordered.map(({ el2, idx2 }) => {
        const def = el2.kind === "widget" ? WIDGET_TYPES[el2.widget?.type] : null;
        const icon = def?.icon || ({ image:"fa-image", icon:"fa-icons", value:"fa-hashtag", label:"fa-font", button:"fa-square" }[el2.kind] || "fa-shapes");
        return `<div class="wb-layer-row" data-wb-layer-idx="${idx2}" style="display:grid;grid-template-columns:22px 22px 1fr auto;gap:3px;align-items:center;border:1px solid var(--sd-border);border-radius:4px;padding:3px;background:var(--sd-bg-3);opacity:${el2.hidden ? ".55" : "1"}">
          <button type="button" data-layer-action="visibility" title="Show / hide" class="wb-layer-btn"><i class="fas ${el2.hidden ? "fa-eye-slash" : "fa-eye"}"></i></button>
          <button type="button" data-layer-action="lock" title="Lock / unlock" class="wb-layer-btn"><i class="fas ${el2.locked ? "fa-lock" : "fa-lock-open"}"></i></button>
          <button type="button" data-layer-action="focus" title="Open element settings" style="min-width:0;background:none;border:none;color:var(--sd-text-2);text-align:left;cursor:pointer;font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><i class="fas ${esc(icon)}" style="margin-right:5px;color:var(--sd-accent)"></i>${esc(el2.name || el2.label || def?.label || "Element")}</button>
          <span style="display:flex;gap:2px">
            <button type="button" data-layer-action="back" title="Send backward" class="wb-layer-btn"><i class="fas fa-arrow-down"></i></button>
            <button type="button" data-layer-action="front" title="Bring forward" class="wb-layer-btn"><i class="fas fa-arrow-up"></i></button>
          </span>
        </div>`;
      }).join("");
      wbLayersEl.querySelectorAll(".wb-layer-row").forEach(layerRow => {
        const idx2 = Number(layerRow.dataset.wbLayerIdx);
        layerRow.querySelectorAll("[data-layer-action]").forEach(btn => btn.addEventListener("click", () => {
          const el2 = wbEls[idx2]; if (!el2) return;
          const action = btn.dataset.layerAction;
          if (action === "visibility") el2.hidden = !el2.hidden;
          else if (action === "lock") el2.locked = !el2.locked;
          else if (action === "front") el2.z = wbNextZ();
          else if (action === "back") el2.z = Math.min(0, ...wbEls.map((x, i) => Number(x.z) || i)) - 1;
          else if (action === "focus") { _wbFocusRow(idx2); return; }
          wbRender();
        }));
      });
    };

    const openElementGraph = (idx, kind) => {
      const nm = String(wbEls[idx]?.name ?? "").trim();
      if (!nm) { ui.notifications?.warn?.("Give the element a name first"); return; }
      if (!w.graphData || !Array.isArray(w.graphData.nodes)) w.graphData = { nodes: [], edges: [], comments: [] };
      const nodeType = kind === "value" ? "widget_output" : "custom_event";
      const nodeName = kind === "value" ? nm : "On Click " + nm;
      const exists = w.graphData.nodes.some(n2 => n2?.type === nodeType && String(n2?.data?.name ?? "").trim() === nodeName);
      if (!exists) {
        const maxId = Math.max(0, ...w.graphData.nodes.map(n2 => parseInt(String(n2?.id ?? "").replace(/[^0-9]/g, "")) || 0));
        w.graphData.nodes.push({ id: String(maxId + 1), type: nodeType, x: kind === "value" ? 460 : 80, y: 80 + (w.graphData.nodes.length % 6) * 140, data: { name: nodeName } });
      }
      const formulaInp = popup.querySelector('input[data-field="formula"]');
      const graph = new FormulaGraph(formulaInp, doc, w, { tab, row, w, doc });
      graph.open();
    };

    const wbRender = () => {
      wbSync();
      renderLayers();
      wbRowsEl.innerHTML = "";
      if (!wbEls.length) {
        wbRowsEl.innerHTML = "<div style='font-size:10px;color:var(--sd-text-3);font-style:italic'>No elements yet &mdash; click + Add Element</div>";
        wbCanvasRender();
        return;
      }
      wbEls.forEach((el2, idx) => {
        const row2 = document.createElement("div");
        row2.style.cssText = "border:1px solid var(--sd-border);border-radius:6px;padding:7px;margin-bottom:7px;background:var(--sd-bg)";
        row2.dataset.wbIdx = String(idx);
        const name = String(el2.name ?? "");
        const dup = wbNameDup(name.trim(), idx);
        const isWidget = String(el2.kind ?? "button") === "widget";
        const widgetType = String(el2.widget?.type ?? "text");
        row2.innerHTML = `
          <div style="display:grid;grid-template-columns:1fr 104px 24px;gap:5px;align-items:center;margin-bottom:5px">
            <input type="text" class="wb-name" value="${esc(name)}" placeholder="Unique layer name" style="background:var(--sd-bg-4);border:1px solid ${dup ? "var(--sd-danger,#e05555)" : "var(--sd-border)"};border-radius:4px;color:var(--sd-text);font-size:11px;padding:4px 7px;width:100%">
            <select class="wb-kind" style="background:var(--sd-bg-4);border:1px solid var(--sd-border);border-radius:4px;color:var(--sd-text);font-size:10px;padding:4px;width:100%">
              ${["button","value","icon","image","label","widget"].map(k2 => `<option value="${k2}" ${String(el2.kind ?? "button") === k2 ? "selected" : ""}>${k2}</option>`).join("")}
            </select>
            <button type="button" class="wb-del wb-layer-btn" title="Remove element" style="background:none;border:none;color:var(--sd-danger-dim);cursor:pointer;font-size:13px;padding:0">&#10005;</button>
          </div>
          ${dup ? `<div style="font-size:9px;color:var(--sd-danger,#e05555);margin:-2px 0 4px">Duplicate name — layer names must be unique</div>` : ""}
          ${isWidget ? `<div class="wb-embedded-panel" style="display:grid;grid-template-columns:1fr auto;gap:5px;align-items:center;border:1px solid var(--sd-accent-dim,var(--sd-border));border-radius:5px;padding:6px;margin-bottom:5px;background:var(--sd-bg-3)">
            <select class="wb-widget-type" style="background:var(--sd-bg-4);border:1px solid var(--sd-border);border-radius:4px;color:var(--sd-text);font-size:10px;padding:4px;width:100%">${embeddedTypes.map(def => `<option value="${esc(def.id)}" ${widgetType === def.id ? "selected" : ""}>${esc(def.label || def.id)}</option>`).join("")}</select>
            <button type="button" class="wb-widget-config" style="background:var(--sd-bg-4);border:1px solid var(--sd-accent);border-radius:4px;color:var(--sd-accent);cursor:pointer;font-size:10px;padding:4px 8px"><i class="fas fa-gear"></i> Configure</button>
          </div>` : ""}
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-bottom:5px">
            <input type="text" class="wb-label" value="${esc(String(el2.label ?? ""))}" placeholder="Label / text" style="background:var(--sd-bg-4);border:1px solid var(--sd-border);border-radius:4px;color:var(--sd-text);font-size:10px;padding:4px 7px;width:100%">
            <input type="text" class="wb-icon" value="${esc(String(el2.icon ?? ""))}" placeholder="Icon (fa-bolt)" style="background:var(--sd-bg-4);border:1px solid var(--sd-border);border-radius:4px;color:var(--sd-text);font-size:10px;padding:4px 7px;width:100%">
          </div>
          <div style="display:grid;grid-template-columns:1fr auto 1fr;gap:5px;margin-bottom:5px">
            <input type="text" class="wb-img" value="${esc(String(el2.img ?? ""))}" placeholder="Image path" style="background:var(--sd-bg-4);border:1px solid var(--sd-border);border-radius:4px;color:var(--sd-text);font-size:10px;padding:4px 7px;width:100%">
            <button type="button" class="wb-img-pick wb-layer-btn" title="Choose image"><i class="fas fa-folder-open"></i></button>
            <input type="text" class="wb-color" value="${esc(String(el2.color ?? ""))}" placeholder="Color (#7be07a)" style="background:var(--sd-bg-4);border:1px solid var(--sd-border);border-radius:4px;color:var(--sd-text);font-size:10px;padding:4px 7px;width:100%">
          </div>
          <div style="display:flex;gap:5px;align-items:center;margin-bottom:5px">
            <input type="text" class="wb-formula" value="${esc(String(el2.formula ?? ""))}" placeholder="Value formula" style="background:var(--sd-bg-4);border:1px solid var(--sd-border);border-radius:4px;color:var(--sd-text);font-size:10px;padding:4px 7px;flex:1;min-width:0;font-family:'Courier New',monospace">
            ${String(el2.kind) === "value" ? `<button type="button" class="wb-vout wb-layer-btn" title="Create value output"><i class="fas fa-circle-nodes"></i></button>` : ""}
          </div>
          <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:4px;margin-bottom:5px">
            ${[["wb-x","x","X"],["wb-y","y","Y"],["wb-w","w","W"],["wb-h","h","H"],["wb-size","size","Font"],["wb-z","z","Layer"]].map(([cls,key2,ph]) => `<input type="number" class="${cls}" value="${esc(String(el2[key2] ?? ""))}" placeholder="${ph}" title="${ph}" style="background:var(--sd-bg-4);border:1px solid var(--sd-border);border-radius:3px;color:var(--sd-text);font-size:10px;padding:3px 4px;width:100%">`).join("")}
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:9px;align-items:center">
            <label class="wb-mini-check"><input type="checkbox" class="wb-click" ${el2.clickable ? "checked" : ""}> Clickable</label>
            <label class="wb-mini-check"><input type="checkbox" class="wb-locked" ${el2.locked ? "checked" : ""}> Locked</label>
            <label class="wb-mini-check"><input type="checkbox" class="wb-hidden" ${el2.hidden ? "checked" : ""}> Hidden</label>
            <button type="button" class="wb-event" ${el2.clickable && name.trim() ? "" : "disabled"} style="margin-left:auto;background:var(--sd-bg-4);border:1px solid var(--sd-accent);border-radius:4px;color:var(--sd-accent);cursor:pointer;font-size:10px;padding:3px 8px;opacity:${el2.clickable && name.trim() ? "1" : ".4"}"><i class="fas fa-bolt"></i> On Click</button>
          </div>`;

        const upd = (cls, keyName, isCheck = false) => {
          const inpEl = row2.querySelector(cls); if (!inpEl) return;
          inpEl.addEventListener(isCheck ? "change" : "input", () => {
            wbEls[idx][keyName] = isCheck ? inpEl.checked : inpEl.value;
            wbSync();
            if (isCheck) wbRender(); else wbCanvasRender();
          });
        };
        ["name","label","icon","img","color","formula"].forEach(key2 => upd(`.wb-${key2}`, key2));
        ["clickable","locked","hidden"].forEach(key2 => upd(`.wb-${key2 === "clickable" ? "click" : key2}`, key2, true));
        for (const key2 of ["x","y","w","h","size","z"]) {
          const inpEl = row2.querySelector(`.wb-${key2}`);
          inpEl?.addEventListener("input", () => { wbEls[idx][key2] = inpEl.value === "" ? "" : (parseFloat(inpEl.value) || 0); wbSync(); wbCanvasRender(); renderLayers(); });
        }
        row2.querySelector(".wb-name")?.addEventListener("change", wbRender);
        row2.querySelector(".wb-kind")?.addEventListener("change", ev2 => {
          wbEls[idx].kind = ev2.target.value;
          if (ev2.target.value === "widget" && (!wbEls[idx].widget || !WIDGET_TYPES[wbEls[idx].widget.type])) {
            wbEls[idx].widget = assignUniqueWidgetDataPaths(createWidget("text", { label: wbEls[idx].label || "Text" }), doc, { additionalWidgets: wbEls.map(el => el?.widget).filter(Boolean) });
            if (!Number(wbEls[idx].w)) wbEls[idx].w = 160;
            if (!Number(wbEls[idx].h)) wbEls[idx].h = 72;
          }
          wbRender();
        });
        row2.querySelector(".wb-widget-type")?.addEventListener("change", ev2 => {
          const oldLabel = wbEls[idx].widget?.label || wbEls[idx].label || "";
          wbEls[idx].widget = assignUniqueWidgetDataPaths(createWidget(ev2.target.value, oldLabel ? { label: oldLabel } : {}), doc, { additionalWidgets: wbEls.map(el => el?.widget).filter(Boolean) });
          wbRender();
        });
        row2.querySelector(".wb-widget-config")?.addEventListener("click", async () => {
          if (!wbEls[idx].widget) wbEls[idx].widget = assignUniqueWidgetDataPaths(createWidget(widgetType || "text"), doc, { additionalWidgets: wbEls.map(el => el?.widget).filter(Boolean) });
          await openWidgetConfigPopup(wbEls[idx].widget, tab, row, doc, {
            embedded: true,
            onSave: updated => { wbEls[idx].widget = updated; wbSync(); wbRender(); }
          });
        });
        row2.querySelector(".wb-img-pick")?.addEventListener("click", () => {
          const FP = foundry.applications?.apps?.FilePicker ?? globalThis.FilePicker;
          if (!FP) { ui.notifications?.error?.("FilePicker is not available"); return; }
          new FP({ type: "image", current: String(wbEls[idx].img ?? ""), callback: src => { wbEls[idx].img = src || ""; wbRender(); } }).render(true);
        });
        row2.querySelector(".wb-del")?.addEventListener("click", () => { wbEls.splice(idx, 1); wbRender(); });
        row2.querySelector(".wb-vout")?.addEventListener("click", () => openElementGraph(idx, "value"));
        row2.querySelector(".wb-event")?.addEventListener("click", () => openElementGraph(idx, "event"));
        wbRowsEl.appendChild(row2);
      });
      wbCanvasRender();
    };

    popup.querySelector("#wcfg-wb-add")?.addEventListener("click", () => {
      wbEls.push({
        id: foundry.utils.randomID(6), name: "Element" + (wbEls.length + 1), kind: "button",
        label: "", icon: "", img: "", color: "", formula: "",
        x: 8 + (wbEls.length % 4) * 76, y: 8 + Math.floor(wbEls.length / 4) * 40,
        w: 72, h: 32, size: "", z: wbNextZ(), clickable: true, locked: false, hidden: false
      });
      wbRender();
    });

    wbCanvasEl?.addEventListener("dragover", ev => {
      // Browsers often hide dataTransfer payloads until drop. Accept the drag
      // here and validate the System Director payload in the drop handler.
      ev.preventDefault();
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = "copy";
      wbCanvasEl.style.borderColor = "var(--sd-accent)";
    });
    wbCanvasEl?.addEventListener("dragleave", () => { wbCanvasEl.style.borderColor = "var(--sd-border)"; });
    wbCanvasEl?.addEventListener("drop", ev => {
      wbCanvasEl.style.borderColor = "var(--sd-border)";
      let data = null;
      try { data = JSON.parse(ev.dataTransfer?.getData("text/plain") || "null"); } catch (err) { data = null; }
      const type = data?.widgetType;
      if (data?.sdType !== "widget" || !WIDGET_TYPES[type] || ["widgetBuilder", "vsection"].includes(type)) return;
      ev.preventDefault();
      const isFree = (popup.querySelector('select[data-field="wbLayout"]')?.value ?? "grid") === "free";
      const surface = wbCanvasEl.firstElementChild ?? wbCanvasEl;
      const rect = surface.getBoundingClientRect();
      const def = WIDGET_TYPES[type];
      const nested = assignUniqueWidgetDataPaths(createWidget(type), doc, { additionalWidgets: wbEls.map(el => el?.widget).filter(Boolean) });
      const idx = wbEls.length;
      wbEls.push({
        id: foundry.utils.randomID(6),
        name: `${def.label || type} ${idx + 1}`,
        kind: "widget",
        label: "",
        icon: "",
        img: "",
        color: "",
        formula: "",
        x: isFree ? Math.max(0, snapValue(ev.clientX - rect.left)) : 0,
        y: isFree ? Math.max(0, snapValue(ev.clientY - rect.top)) : 0,
        w: 160,
        h: 72,
        size: "",
        z: wbNextZ(),
        clickable: false,
        locked: false,
        hidden: false,
        widget: nested
      });
      wbRender();
    });

    wbRender();
    popup.querySelector('select[data-field="wbLayout"]')?.addEventListener("change", wbCanvasRender);
    for (const key of ["canvasW","canvasH","columns","gap","gridSize","snap"]) {
      popup.querySelector(`input[data-field="${key}"]`)?.addEventListener("input", wbCanvasRender);
    }
    popup.querySelectorAll(".wcfg-tab-btn").forEach(b2 => b2.addEventListener("click", () => setTimeout(wbCanvasRender, 0)));
  }

  popup.querySelectorAll("[data-open-graph]").forEach(btn => {
    btn.addEventListener("mouseenter", () => btn.style.background = "var(--sd-accent-glow)");
    btn.addEventListener("mouseleave", () => btn.style.background = "var(--sd-bg-4)");
    btn.addEventListener("click", () => {
      const key = btn.dataset.openGraph;
      const inp = popup.querySelector(`input[data-field="${key}"]`);
      if (!inp) return;
      const graph = new FormulaGraph(inp, doc, w, { tab, row, w, doc });
      graph.open();
    });
  });

  popup.querySelector("[data-open-sheet-blueprint]")?.addEventListener("click", () => {
    const graph = new FormulaGraph(null, doc, null, null, null, { mode: "sheetTrigger" });
    graph.open();
  });

  popup.querySelector("#wcfg-open-widget-designer")?.addEventListener("click", async () => {
    const { openSheetWidgetDesigner } = await import("./widget-builder-designer.mjs");
    openSheetWidgetDesigner({
      widget: w, doc, tab, row,
      onSave: updated => {
        Object.assign(w, updated);
        const json = popup.querySelector("#wcfg-wb-json");
        if (json) json.value = JSON.stringify(updated.elements ?? []);
      }
    });
  });

  popup.querySelectorAll("[data-open-action-graph]").forEach(btn => {
    btn.addEventListener("mouseenter", () => btn.style.background = "var(--sd-accent-glow)");
    btn.addEventListener("mouseleave", () => btn.style.background = "var(--sd-bg-4)");
    btn.addEventListener("click", () => {
      const key = btn.dataset.openActionGraph;
      const inp = popup.querySelector(`input[data-field="${CSS.escape(key)}"]`);
      if (!inp) return;
      const graph = new FormulaGraph(inp, doc, w, { tab, row, w, doc }, null, { mode: "actionGraph" });
      graph.open();
    });
  });

  const doSave = async () => {
    const slotRowsEl = popup.querySelector("#wcfg-slotrows");
    const slotJsonEl = popup.querySelector("#wcfg-slotconfig-json");
    if (slotRowsEl && slotJsonEl) {
      const entries = [];
      slotRowsEl.querySelectorAll(".wcfg-slotrow").forEach(row => {
        const level    = parseInt(row.querySelector(".wcfg-slot-level")?.value)   || 0;
        const maxPath  = row.querySelector(".wcfg-slot-maxpath")?.value?.trim()   ?? "";
        const valuePath = row.querySelector(".wcfg-slot-valpath")?.value?.trim()  ?? "";
        if (level > 0) entries.push({ level, maxPath, valuePath });
      });
      slotJsonEl.value = JSON.stringify(entries);
    }

    const changes = {};
    popup.querySelectorAll("input[data-field], textarea[data-field]").forEach(el => {
      const key  = el.dataset.field;
      const type = el.dataset.ftype ?? el.type;
      let val;
      if (type === "color" || type === "style-color") {
        val = el.dataset.empty === "1" ? "" : el.value;
      } else if (type === "number" || type === "style-px") {
        const raw = el.value;
        val = raw === "" || raw == null ? "" : (parseFloat(raw) || 0);
      } else {
        val = el.value;
      }
      if (type === "array")   val = String(val).split(",").map(s => s.trim()).filter(Boolean);
      if (type === "boolean") val = el.type === "checkbox" ? el.checked : val === "true";
      if (type === "widgetvar" && el.type === "checkbox") val = el.checked;
      if (type === "json")    { try { val = JSON.parse(el.value || "[]"); } catch { val = []; } }
      changes[key] = val;
    });
    popup.querySelectorAll("select[data-field]").forEach(el => {
      if (el.multiple || el.dataset.ftype === "dbvarlist") {
        changes[el.dataset.field] = Array.from(el.selectedOptions ?? []).map(option => option.value).filter(Boolean);
        return;
      }
      changes[el.dataset.field] = el.value;
    });

    // Widget-owned variables: manual value input writes the widget's own storage.
    const _varDefaults = { ...(w.varDefaults ?? {}) };
    const _varWrites = {};
    for (const changeKey of Object.keys(changes)) {
      if (!changeKey.startsWith("__wvar_")) continue;
      const field = changeKey.slice(7);
      const descriptor = (widgetVariables(w) ?? []).find(entry => entry.field === field);
      const value = coerceWidgetValue(changes[changeKey], descriptor?.type ?? "text");
      _varDefaults[field] = value;
      _varWrites[widgetVarPath(w, field)] = value;
      delete changes[changeKey];
    }
    if (Object.keys(_varWrites).length) changes.varDefaults = _varDefaults;

    if (editLanguage !== "base") {
      const translated = foundry.utils.deepClone(w);
      for (const key of Object.keys(changes)) {
        if (!TRANSLATABLE_KEYS.has(key)) continue;
        setLocalizedField(translated,key,changes[key],editLanguage);
        delete changes[key];
      }
      changes.i18n=translated.i18n ?? {};
    }

    const _unknownPaths = [];
    popup.querySelectorAll("input[data-field][data-ftype='path']").forEach(el => {
      const raw = String(el.value ?? "").trim();
      if (!raw) return;
      if (_isPathWritable(doc, raw)) return;
      _unknownPaths.push({ key: el.dataset.field, value: raw, input: el });
    });

    const _hfUpdates = {};
    if (false && _unknownPaths.length) {
      const listHtml = _unknownPaths.map(p => {
        const newKey = _hiddenFieldKeyFor(p.value);
        return `<li style="margin-bottom:4px"><code>${esc(p.value)}</code> &rarr; <code>system.hiddenFields.${esc(newKey)}</code></li>`;
      }).join("");
      const confirmed = await foundry.applications.api.DialogV2.confirm({
        window: { title: "Create new data path?" },
        content: `
          <div style="padding:8px;font-size:12px;line-height:1.5">
            <p style="margin:0 0 8px 0">The selected Database variable is unavailable:</p>
            <ul style="margin:0 0 8px 18px;padding:0">${listHtml}</ul>
            <p style="margin:0;color:var(--sd-text-2,#aaa)">Create missing Database definitions in System Settings first.</p>
          </div>`,
        rejectClose: false
      });
      if (confirmed) {
        for (const p of _unknownPaths) {
          const newKey  = _hiddenFieldKeyFor(p.value);
          const newPath = `system.hiddenFields.${newKey}`;
          changes[p.key] = newPath;
          if (p.input) p.input.value = newPath;
          const existing = foundry.utils.getProperty(doc, newPath);
          if (existing === undefined) _hfUpdates[newPath] = "";
        }
      }
    }

    if (options?.embedded === true) {
      Object.assign(w, changes);
      const _embeddedUpdates = { ..._hfUpdates, ..._varWrites };
      if (Object.keys(_embeddedUpdates).length) await doc.update(_embeddedUpdates);
      options.onSave?.(foundry.utils.deepClone(w));
      ui.notifications?.info?.(`Embedded widget "${w.label || w.type}" updated.`);
      _closePopup();
      return;
    }

    const tabs   = foundry.utils.deepClone(doc.system.customTabs ?? []);
    const _findWidgetDeep = (list, id) => {
      if (!Array.isArray(list)) return null;
      for (const ww of list) {
        if (ww.id === id) return ww;
        if (ww.type === "vsection") {
          const nested = _findWidgetDeep(ww.widgets, id);
          if (nested) return nested;
        }
        if (ww.type === "widgetBuilder") {
          const embedded = _findWidgetDeep((ww.elements ?? []).map(el => el?.widget).filter(Boolean), id);
          if (embedded) return embedded;
        }
      }
      return null;
    };
    const freshRow = tabs.find(t => t.id === tab.id)?.rows?.find(r => r.id === row.id);
    const widget   = freshRow ? _findWidgetDeep(freshRow.widgets, w.id) : null;
    if (widget) {
      Object.assign(widget, changes);
      if (widget.type === "number" && widget.numberMode === "node") {
        delete widget.min;
        delete widget.max;
        delete widget.step;
      } else if (widget.type === "number") {
        widget.numberMode = "classic";
      }
      if (widget.type === "resource" && widget.resourceMode !== "node") {
        widget.resourceMode = "classic";
      }

      if (widget.type === "slot" && widget.slotId != null && String(widget.slotId).trim() !== "") {
        const sid    = String(widget.slotId).trim();
        const defs   = foundry.utils.deepClone(doc.system.slotDefinitions ?? []);
        const defIdx = defs.findIndex(d => String(d.id) === sid);
        if (defIdx !== -1) {
          if (changes.maxCount !== undefined) defs[defIdx].maxCount = Math.max(1, parseInt(changes.maxCount) || 1);
          if (changes.label    !== undefined) defs[defIdx].label    = changes.label || defs[defIdx].label;
          await doc.update({ "system.customTabs": tabs, "system.slotDefinitions": defs, ..._hfUpdates, ..._varWrites, ...buildWidgetPathRegistryUpdate(doc, tabs) });
        } else {
          defs.push({
            id:                sid,
            label:             widget.label || sid,
            allowedTypes:      [],
            allowedCategories: [],
            attrFilters:       [],
            maxCount:          Math.max(1, parseInt(widget.maxCount) || 1),
            displayMode:       "compact",
            removable:         true,
            consumeOnRemove:   false,
            placeholderIcon:   "",
            accentColor:       "",
            changes:           []
          });
          await doc.update({ "system.customTabs": tabs, "system.slotDefinitions": defs, ..._hfUpdates, ..._varWrites, ...buildWidgetPathRegistryUpdate(doc, tabs) });
          ui.notifications?.info?.(`Slot definition "${sid}" created for this widget.`);
        }
      } else {
        await doc.update({ "system.customTabs": tabs, ..._hfUpdates, ..._varWrites, ...buildWidgetPathRegistryUpdate(doc, tabs) });
      }

      ui.notifications?.info?.(`Widget "${widget.label || widget.type}" saved.`);
    } else {
      ui.notifications?.warn?.(`Widget "${w.label || w.type}" not found in document data — save aborted.`);
      console.warn("[sd] widget-config-popup: failed to locate widget", { tabId: tab?.id, rowId: row?.id, widgetId: w?.id });
    }
    _closePopup();
  };

  popup.querySelector("#wcfg-save").addEventListener("click", doSave);
  popup.querySelector("#wcfg-cancel").addEventListener("click", _closePopup);
  popup.querySelector("#wcfg-x").addEventListener("click",     _closePopup);
  popup.querySelector("#wcfg-language")?.addEventListener("change", async ev => {
    await setTranslationEditLanguage(ev.currentTarget.value);
    ui.notifications?.info?.("Translation language changed. Save edits before switching language.");
    _closePopup();
    openWidgetConfigPopup(w,tab,row,doc,options);
  });

  const saveBtn = popup.querySelector("#wcfg-save");
  saveBtn.addEventListener("mouseenter", () => saveBtn.style.background = "var(--sd-accent)");
  saveBtn.addEventListener("mouseleave", () => saveBtn.style.background = "var(--sd-accent)");

  popup.querySelector("#wcfg-hdr").style.cursor = "default";

  popup.querySelector("input[data-field]")?.focus();
  SDOnboarding.bindWidgetConfig(popup);

  return popup;
}

function _isPathWritable(doc, path) {
  if (!doc || typeof path !== "string") return true;
  if (!path) return true;

  if (path.startsWith("system.hiddenFields.")) return true;
  if (path.startsWith("system.flags."))        return true;
  if (path.startsWith("flags."))               return true;
  if (path.startsWith("system.slotContents.")) return true;
  if (path.startsWith("system.customFields.")) return true;

  try { if (isConfiguredSettingsPath(path)) return true; } catch {  }

  if (foundry.utils.getProperty(doc, path) !== undefined) return true;

  const declared = doc.system?.declaredAttrs ?? [];
  if (declared.some(a => a?.path && (a.path === path || path.startsWith(a.path + ".")))) return true;

  return false;
}

function _hiddenFieldKeyFor(raw) {
  let s = String(raw ?? "").trim();
  if (s.startsWith("system.hiddenFields.")) s = s.slice("system.hiddenFields.".length);
  else {
    const parts = s.split(".").filter(Boolean);
    s = parts[parts.length - 1] || "field";
  }
  s = s.replace(/[^A-Za-z0-9_]/g, "_");
  if (!/^[A-Za-z_]/.test(s)) s = "_" + s;
  return s;
}
