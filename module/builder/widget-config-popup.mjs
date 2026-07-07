import { FormulaEngine }   from "../helpers/formula-engine.mjs";
import { FormulaGraph }    from "./formula-graph.mjs";
import { WIDGET_VARIANTS, WIDGET_TYPES, CLICKABLE_WIDGET_TYPES } from "./widget-registry.mjs";
import { getConfiguredDataPathEntries, getSystemPathEntries, isConfiguredSettingsPath } from "../helpers/system-config.mjs";
import { SDOnboarding } from "../helpers/onboarding.mjs";

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
  text:      [["Label","label"],["Widget Key","widgetKey","text"],["Data Path","path","path"],["Value Formula","valueFormula","formula"],["Read Only","readOnly","boolean"]],
  number:    [["Label","label"],["Widget Key","widgetKey","text"],["Data Path","path","path"],["Min (number or path)","min","text"],["Max (number or path)","max","text"],["Step","step","number"]],
  resource:  [["Label","label"],["Widget Key","widgetKey","text"],["Value Path","pathValue","path"],["Max Path","pathMax","path"]],
  dice:      [["Label","label"],["Widget Key","widgetKey","text"],["Roll Formula","formula","formula"],["Chat Flavor","flavor","text"]],
  button:    [["Label","label"],["Widget Key","widgetKey","text"],["FA Icon (e.g. fa-bolt)","icon","text"],["Roll Formula (optional)","formula","formula"],["Chat Flavor / Message","flavor","text"]],
  toggle:    [["Label","label"],["Widget Key","widgetKey","text"],["Data Path","path","path"],["On Label","onLabel","text"],["Off Label","offLabel","text"]],
  section:   [["Section Title","label"],["Widget Key","widgetKey","text"]],
  vsection:  [["Title","label"],["Widget Key","widgetKey","text"]],
  richtext:  [["Label","label"],["Widget Key","widgetKey","text"],["Data Path","path","path"]],
  attribute: [["Label","label"],["Widget Key","widgetKey","text"],["Score Path","path","path"],["Chat Flavor","flavor","text"]],
  skill:     [["Label","label"],["Widget Key","widgetKey","text"],["Rank Path","path","path"],["Attr Modifier","attrMod","number"],["Roll Formula Override","formula","formula"],["Chat Flavor","flavor","text"],["Pips count (Pips variant only)","pipMax","number"]],
  slot:      [["Label","label"],["Widget Key","widgetKey","text"],["Slot ID","slotId","text"],["Max Items","maxCount","number"]],
  inventory: [["Label","label"],["Widget Key","widgetKey","text"],["Filter Categories","categories","array"],["Extra Columns (hidden field names)","columns","array"],["Show Currency Section","showCurrency","boolean"],["Currency Path (optional)","currencyPath","path"],["Compact (button + popover)","compact","boolean"],["FA icon (compact only)","icon","text"]],
  effects:   [["Label","label"],["Widget Key","widgetKey","text"],["Show Disabled","showDisabled","boolean"],["Show Passive","showPassive","boolean"],["Compact (button + popover)","compact","boolean"],["FA icon (compact only)","icon","text"]],
  spellbook: [["Label","label"],["Widget Key","widgetKey","text"],["Ability type filter (empty = all)","abilityType","text"],["Compact (button + popover)","compact","boolean"],["FA icon (compact only)","icon","text"]],
  attributeGroup: [["Button Label","label"],["Widget Key","widgetKey","text"],["Attribute keys or paths (comma, blank = all enabled)","attributeKeys","text"],["FA icon","icon","text"]],

  counter:   [["Label","label"],["Widget Key","widgetKey","text"],["Data Path","path","path"],["Step","step","number"],["Min","min","number"],["Max","max","number"]],

  rollButton:[["Label","label"],["Widget Key","widgetKey","text"],["FA Icon (e.g. fa-dice-d20)","icon","text"],["Roll Formula","formula","formula"],["Chat Flavor","flavor","text"]],

  tokenPool: [["Label","label"],["Widget Key","widgetKey","text"],["Value path","path","path"],["Max path (blank=use Max)","maxPath","path"],["Max","maxCount","number"],["FA icon (filled)","icon","text"],["FA icon (empty, blank = same)","emptyIcon","text"],["Glow on filled","glow","boolean"]],

  diceTray:  [["Label","label"],["Widget Key","widgetKey","text"],["Flag Path (default flags.sd.lastRoll)","flagPath","text"]],

  progress: [["Label","label"],["Widget Key","widgetKey","text"],["Value Path","pathValue","path"],["Max Path","pathMax","path"],["Show label","showLabel","boolean"],["Show percentage","showPct","boolean"]],
  select:   [["Label","label"],["Widget Key","widgetKey","text"],["Data Path","path","path"],["Choices (comma-separated)","choices","text"]],
  clock:    [["Label","label"],["Widget Key","widgetKey","text"],["Filled count path","path","path"],["Segments (2–12)","segments","number"]],
  tracker:  [["Label","label"],["Widget Key","widgetKey","text"],["Value path","path","path"],["Max path (blank=use Max)","maxPath","path"],["Max","maxCount","number"],["FA icon (filled)","icon","text"],["FA icon (empty, blank = same)","emptyIcon","text"],["Glow on filled","glow","boolean"]],
  tags:     [["Label","label"],["Widget Key","widgetKey","text"],["Data path","path","path"]],
  image:    [["Label (optional)","label"],["Widget Key","widgetKey","text"],["Image","staticSrc","image-pick"]],
  derived:  [["Label","label"],["Widget Key","widgetKey","text"],["Formula","formula","formula"],["Decimal places","decimalPlaces","number"]],

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
  rollButton:[["Width (px)","boxW","style-px"],["Height (px)","boxH","style-px"],["Button background","btnBg","style-color"],["Text color","btnFg","style-color"],["Border","boxBorder","style-color"],["Border radius (px)","boxRadius","style-px"]],
  toggle:    [["Width (px)","boxW","style-px"],["On color","onColor","style-color"],["Off color","offColor","style-color"],["Border radius (px)","boxRadius","style-px"]],
  section:   [["Line color","lineColor","style-color"],["Title color","titleColor","style-color"],["Thickness (px)","lineThickness","style-px"]],
  vsection:  [["Border color","boxBorder","style-color"],["Background","boxBg","style-color"],["Title color","titleColor","style-color"],["Border radius (px)","boxRadius","style-px"]],
  richtext:  [["Min height (px)","boxH","style-px"],["Background","boxBg","style-color"],["Text color","boxFg","style-color"],["Border","boxBorder","style-color"],["Border radius (px)","boxRadius","style-px"],["Padding (px)","boxPad","style-px"]],
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
  cardHand:  [["Min height (px)","boxH","style-px"],["Background","boxBg","style-color"],["Text color","boxFg","style-color"],["Border","boxBorder","style-color"],["Border radius (px)","boxRadius","style-px"],["Padding (px)","boxPad","style-px"]],
  cardDrawButton:[["Width (px)","boxW","style-px"],["Height (px)","boxH","style-px"],["Button background","btnBg","style-color"],["Text color","btnFg","style-color"],["Border","boxBorder","style-color"],["Border radius (px)","boxRadius","style-px"]]
};

const FIELD_HINTS = {
  path:         "Path on actor/item — directly reads/writes the field (two-way bind)",
  valueFormula: "Formula — computed at display time. Use {system.path}, {item:Name.field}, {widget:key}, 1d20+{@attr1}",
  formula:      "Roll formula — supports {path} refs. E.g: 1d20 + {system.attributes.attr1.mod}",
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

export async function openWidgetConfigPopup(w, tab, row, doc) {

  const existingForSameWidget = [...document.querySelectorAll(".sd-wcfg-popup")]
    .find(el => el.dataset.wcfgWidgetId && w?.id && el.dataset.wcfgWidgetId === w.id);
  if (existingForSameWidget) {
    existingForSameWidget.style.zIndex = String(++_wcfgZTop);
    existingForSameWidget.querySelector("input,select,textarea")?.focus?.();
    return;
  }

  const _numberMode = w.type === "number" && w.numberMode === "node" ? "node" : "classic";
  const _typeFields = w.type === "number" && _numberMode === "node"
    ? [["Label","label"],["Widget Key","widgetKey","text"],["Data Path","path","path"]]
    : (FIELD_DEFS[w.type] ?? [["Label","label"]]);
  const _commonFields = [
  ];
  const fields = [..._typeFields, ..._commonFields];
  const esc      = s => String(s ?? "").replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;");

  const IS = "width:100%;background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:4px;color:var(--sd-text);font-size:12px;padding:5px 8px;box-sizing:border-box;outline:none;transition:border-color .15s";
  const MONO = ";font-family:'Courier New',monospace;font-size:11px";

  const attrGraphRow = (w.type === "attribute" || w.type === "skill") ? `
    <div class="wcfg-f" style="margin-bottom:10px">
      <label class="wcfg-lbl">Node Graph</label>
      <div style="font-size:10px;color:var(--sd-text-3);margin-bottom:5px;line-height:1.4">${w.type === "skill" ? "Wire Roll Formula output and On Click exec chain for this skill." : "Wire Attr Score → modValue output, and On Click exec chain."}</div>
      <button type="button" id="wcfg-attr-graph-btn"
        style="width:100%;background:var(--sd-bg-4);border:1px solid var(--sd-accent);border-radius:5px;color:var(--sd-accent);cursor:pointer;font-size:11px;padding:7px 12px;display:flex;align-items:center;justify-content:center;gap:7px;transition:background .15s"
        onmouseover="this.style.background='var(--sd-accent-glow)'" onmouseout="this.style.background='var(--sd-bg-4)'">
        <i class="fas fa-diagram-project"></i> Open Graph Editor
      </button>
    </div>` : "";

  const numberGraphRow = (w.type === "number" && _numberMode === "node") ? (() => {
    const gd = w.numberGraph;
    const hasGraph = !!(gd && Array.isArray(gd.nodes) && gd.nodes.length);
    const status = hasGraph
      ? `<span style="color:var(--sd-success);font-size:10px">${gd.nodes.length} node${gd.nodes.length===1?"":"s"}</span>`
      : `<span style="color:var(--sd-text-3);font-size:10px;font-style:italic">no graph yet</span>`;
    return `
    <div class="wcfg-f" style="margin-bottom:10px">
      <label class="wcfg-lbl">Node Graph</label>
      <div style="font-size:10px;color:var(--sd-text-3);margin-bottom:5px;line-height:1.4">Wire Min, Max, and Step. This graph has no exec output.</div>
      <div style="display:flex;gap:8px;align-items:center">
        <button type="button" id="wcfg-number-graph-btn"
          style="flex:1;background:var(--sd-bg-4);border:1px solid var(--sd-accent);border-radius:5px;color:var(--sd-accent);cursor:pointer;font-size:11px;padding:7px 12px;display:flex;align-items:center;justify-content:center;gap:7px;transition:background .15s"
          onmouseover="this.style.background='var(--sd-accent-glow)'" onmouseout="this.style.background='var(--sd-bg-4)'">
          <i class="fas fa-diagram-project"></i> Open Graph Editor
        </button>
        ${status}
      </div>
    </div>`;
  })() : "";

  const attrGroupGraphsRow = (w.type === "attributeGroup") ? (() => {
    const cfgLabels  = CONFIG?.SD?.attributes ?? {};
    const cfgEnabled = CONFIG?.SD?.attributesEnabled ?? {};
    const explicit   = String(w.attributeKeys ?? "").trim();
    const _parseKey = (raw) => {
      const s = String(raw).trim();
      if (!s) return null;
      if (s.includes(".")) {
        const m = s.match(/^system\.attributes\.([^.]+)/);
        if (m) return m[1];
        const segs = s.split(".");
        return segs[segs.length - 1];
      }
      return s;
    };
    let keys;
    if (explicit) {
      keys = explicit.split(",").map(_parseKey).filter(Boolean);
    } else {
      const cfgKeys = Object.keys(cfgLabels);
      keys = cfgKeys.length
        ? cfgKeys.filter(k => cfgEnabled[k] !== false)
        : Object.keys(doc.system?.attributes ?? {});
    }
    if (!keys.length) return "";
    const attrGraphs = (w.attrGraphs && typeof w.attrGraphs === "object") ? w.attrGraphs : {};
    const rows = keys.map(k => {
      const ag = attrGraphs[k] ?? null;
      const has = !!(ag?.graphData && Array.isArray(ag.graphData.nodes) && ag.graphData.nodes.length);
      const status = has
        ? `<span style="color:var(--sd-success);font-size:10px">${ag.graphData.nodes.length} node${ag.graphData.nodes.length===1?"":"s"}</span>`
        : `<span style="color:var(--sd-text-3);font-size:10px;font-style:italic">no graph</span>`;
      const display = cfgLabels[k] || (k.charAt(0).toUpperCase() + k.slice(1));
      return `
      <div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px dashed var(--sd-bg-3)">
        <span style="flex:1;font-size:11px;color:var(--sd-text)">${esc(display)} <span style="color:var(--sd-text-3);font-size:10px">(${esc(k)})</span></span>
        ${status}
        <button type="button" data-attr-group-graph="${esc(k)}"
          style="background:var(--sd-bg-4);border:1px solid var(--sd-accent);border-radius:4px;color:var(--sd-accent);cursor:pointer;font-size:10px;padding:4px 9px;display:inline-flex;align-items:center;gap:5px;transition:background .15s"
          onmouseover="this.style.background='var(--sd-accent-glow)'" onmouseout="this.style.background='var(--sd-bg-4)'">
          <i class="fas fa-diagram-project"></i> Edit
        </button>
      </div>`;
    }).join("");
    return `
    <div class="wcfg-f" style="margin-bottom:10px">
      <label class="wcfg-lbl">Per-Attribute Graphs</label>
      <div style="font-size:10px;color:var(--sd-text-3);margin-bottom:5px;line-height:1.4">Each attribute below can have its own modifier formula (Attr Score → modValue) and On Click exec chain. Untouched attributes keep the legacy 1d20+(mod) behaviour.</div>
      <div style="background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:4px;padding:4px 8px">${rows}</div>
    </div>`;
  })() : "";

  const _showIfSources = (() => {
    const list = [];

    for (const t of (doc.system?.customTabs ?? [])) {
      for (const r of (t.rows ?? [])) {
        for (const ww of (r.widgets ?? [])) {
          if (ww.widgetKey && ww.widgetKey !== w.widgetKey) {
            list.push({ value: `widget:${ww.widgetKey}`, label: `Widget: ${ww.widgetKey}` });
          }
        }
      }
    }

    for (const [k] of Object.entries(doc.system?.hiddenFields ?? {})) {
      list.push({ value: `hidden:${k}`, label: `Hidden Field: ${k}` });
    }

    const sys = doc?.system;
    if (sys && typeof sys === "object") {

      const _attrName = (key) => {

        const lbl = CONFIG?.SD?.attributes?.[key];
        if (typeof lbl !== "string" || !lbl.trim()) return key;
        if (lbl.startsWith("SD.")) {
          const t = game?.i18n?.localize?.(lbl);
          return (t && t !== lbl) ? t : key;
        }
        return lbl;
      };
      const _resName = (key) => {

        const k = `SD.Resources.${String(key).toUpperCase()}`;
        const t = game?.i18n?.localize?.(k);
        return (t && t !== k && t.trim()) ? t : key;
      };
      for (const [key, attr] of Object.entries(sys.attributes ?? {})) {
        if (attr && typeof attr === "object" && "value" in attr) {
          const n = _attrName(key);
          list.push({ value: `system.attributes.${key}.value`, label: `Attr: ${n} score` });
          if ("mod" in attr) list.push({ value: `system.attributes.${key}.mod`, label: `Attr: ${n} mod` });
          if ("proficient" in attr) list.push({ value: `system.attributes.${key}.proficient`, label: `Attr: ${n} proficient` });
        }
      }

      for (const [key, res] of Object.entries(sys.resources ?? {})) {
        if (res && typeof res === "object") {
          const n = _resName(key);
          if ("value" in res) list.push({ value: `system.resources.${key}.value`, label: `Resource: ${n} value` });
          if ("max"   in res) list.push({ value: `system.resources.${key}.max`,   label: `Resource: ${n} max`   });
          if ("min"   in res) list.push({ value: `system.resources.${key}.min`,   label: `Resource: ${n} min`   });
        }
      }

      for (const [key, skl] of Object.entries(sys.skills ?? {})) {
        if (skl && typeof skl === "object" && "rank" in skl) {
          list.push({ value: `system.skills.${key}.rank`,  label: `Skill: ${key} rank`  });
          if ("bonus" in skl) list.push({ value: `system.skills.${key}.bonus`, label: `Skill: ${key} bonus` });
        }
      }

      try {
        for (const p of getConfiguredDataPathEntries()) {
          list.push({ value: p.path, label: `${p.group}: ${p.label}` });
        }
        for (const p of getSystemPathEntries()) {
          list.push({ value: p.path, label: `System Path: ${p.sectionLabel} \u203a ${p.label}` });
        }
      } catch {  }

      const flatGroups = {
        "system.advancement": ["level", "proficiencyBonus"],
        "system.advancement.xp": ["value", "max"],
        "system.skillPoints":   ["value", "max"],
        "system.defense":       ["armor", "bonus", "total"],
        "system.movement":      ["walk", "swim", "fly", "climb"]
      };
      for (const [base, keys] of Object.entries(flatGroups)) {
        const obj = foundry.utils.getProperty(doc, base);
        if (!obj || typeof obj !== "object") continue;
        for (const k of keys) {
          if (!(k in obj)) continue;
          list.push({ value: `${base}.${k}`, label: `${base.replace(/^system\./, "").replace(/\./g, " › ")} › ${k}` });
        }
      }
    }

    const seen = new Set();
    const out  = [];
    for (const entry of list) {
      if (!entry?.value || seen.has(entry.value)) continue;
      seen.add(entry.value);
      out.push(entry);
    }
    return out;
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
        Select a widget key, hidden field, or document data path, then set the
        value it must equal to show this widget. Leave the value empty to show
        only when the source is truthy (non-zero / non-empty).
      </div>
    </div>`;

  const fieldRows = fields.map(([lbl, key, type="text", opts=[]]) => {
    let cur = w[key] ?? ""; if (Array.isArray(cur) && type !== "select") cur = cur.join(", ");
    const isPF = type === "path" || type === "formula";
    const hint = FIELD_HINTS[key] ?? FIELD_HINTS[type] ?? "";
    const noteColor = type === "formula" ? "var(--sd-accent-2)" : type === "path" ? "var(--sd-mp)" : "";

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
      <div class="wcfg-f" style="margin-bottom:10px;display:flex;align-items:center;gap:8px">
        <input type="checkbox" data-field="${esc(key)}" data-ftype="boolean"
          id="wcfg-bool-${esc(key)}" ${cur === true || cur === "true" ? "checked" : ""}
          style="width:15px;height:15px;accent-color:var(--sd-accent);cursor:pointer;flex-shrink:0">
        <label for="wcfg-bool-${esc(key)}" class="wcfg-lbl" style="margin:0;cursor:pointer">${esc(lbl)}</label>
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
          <input type="text" class="wcfg-slot-maxpath" value="${maxP}"
            style="background:var(--sd-bg);border:1px solid var(--sd-mp);border-radius:3px;color:var(--sd-mp);font-size:10px;padding:2px 5px;width:100%;font-family:'Courier New',monospace"
            placeholder="system.hiddenFields.l1max">
          <input type="text" class="wcfg-slot-valpath" value="${valP}"
            style="background:var(--sd-bg);border:1px solid var(--sd-success);border-radius:3px;color:var(--sd-success);font-size:10px;padding:2px 5px;width:100%;font-family:'Courier New',monospace"
            placeholder="system.spellSlots.1.value">
          <button type="button" class="wcfg-slot-del" style="background:none;border:none;color:var(--sd-danger-dim);cursor:pointer;font-size:13px;padding:0;line-height:1" title="Remove level">✕</button>
        </div>`;
      }).join("");

      return `
      <div class="wcfg-f" style="margin-bottom:10px">
        <label class="wcfg-lbl">${esc(lbl)}</label>
        <div style="font-size:10px;color:var(--sd-text-3);margin-bottom:6px;line-height:1.4">
          Lv · <span style="color:var(--sd-mp)">Max path (hiddenField or spellSlots.N.max)</span> · <span style="color:var(--sd-success)">Value path (hiddenField or spellSlots.N.value)</span>
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
        <div style="display:flex;gap:5px;align-items:center">
          <input type="${type==="number"?"number":"text"}" data-field="${esc(key)}" data-ftype="${type}"
            value="${esc(cur)}"
            style="${IS}${isPF?MONO:""};flex:1"
            placeholder="${type==="path"?"system.resources.hp.value":type==="formula"?"1d20 + {system.attributes.attr1.mod}":type==="array"?"ammo, magazine":""}">
          ${type === "formula" ? `<button type="button" data-open-graph="${esc(key)}" style="flex-shrink:0;background:var(--sd-bg-4);border:1px solid var(--sd-accent);border-radius:4px;color:var(--sd-accent);cursor:pointer;font-size:10px;padding:4px 8px;white-space:nowrap;line-height:1;transition:background .15s" title="Open Blueprint Graph">🔷 Graph</button>` : ""}
          ${isPF ? `<button type="button" data-clear-field="${esc(key)}" class="wcfg-clear-btn" title="Clear">✕</button>` : ""}
        </div>
      </div>`;
  }).join("");

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
    position:fixed;left:${popLeft}px;top:${popTop}px;
    width:430px;height:min(620px,90vh);max-height:96vh;
    min-width:380px;min-height:280px;
    overflow:hidden;resize:both;
    background:var(--sd-popover-bg,var(--sd-bg));border:1px solid var(--sd-popover-border,var(--sd-accent-2));border-radius:8px;
    box-shadow:var(--sd-popover-shadow,0 8px 40px rgba(0,0,0,.85));z-index:${_wcfgZ};
    font-family:'Signika','Palatino Linotype',serif;color:var(--sd-text);
    display:flex;flex-direction:column;`;

  popup.addEventListener("mousedown", () => {
    popup.style.zIndex = String(++_wcfgZTop);
  }, true);

  const ICON_MAP = { text:"fa-font", number:"fa-hashtag", resource:"fa-heart-pulse", dice:"fa-dice-d20", button:"fa-square-bolt", toggle:"fa-toggle-on", section:"fa-minus", richtext:"fa-align-left", attribute:"fa-chart-bar", skill:"fa-list-check", slot:"fa-layer-group", inventory:"fa-backpack", effects:"fa-sparkles", spellbook:"fa-book-sparkles" };

  popup.innerHTML = `
    <!-- Header -->
    <div id="wcfg-hdr" style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--sd-popover-bg,var(--sd-bg));border-bottom:1px solid var(--sd-border);flex-shrink:0;cursor:move">
      <span style="font-size:12px;font-weight:700;text-transform:uppercase;color:var(--sd-accent)">
        <i class="fas ${ICON_MAP[w.type]??'fa-gear'}" style="margin-right:7px;opacity:.8"></i>Configure: ${esc(w.label || w.type)}
      </span>
      <button type="button" id="wcfg-x" style="background:none;border:none;color:var(--sd-text-3);cursor:pointer;font-size:16px;padding:0" aria-label="Close"><i class="fas fa-xmark"></i></button>
    </div>

    <!-- Fields panel -->
    <div id="wcfg-panel-fields" style="flex:1;overflow-y:auto;padding:14px 16px;display:flex;flex-direction:column;gap:0">
      ${attrGraphRow}
      ${numberGraphRow}
      ${attrGroupGraphsRow}
      ${fieldRows}
      ${slotTileRow}
      ${styleRow}
      ${showIfRow}
    </div>

    <!-- Footer -->
    <div style="display:flex;justify-content:flex-end;gap:8px;padding:10px 16px;border-top:1px solid var(--sd-border);flex-shrink:0;background:var(--sd-popover-bg,var(--sd-bg))">
      <button type="button" id="wcfg-cancel" class="wcfg-footer-btn" style="padding:7px 16px;font-size:12px;font-weight:600;border-radius:5px;cursor:pointer;border:1px solid var(--sd-border);background:var(--sd-bg-3);color:var(--sd-text-2)">Cancel</button>
      <button type="button" id="wcfg-save"   class="wcfg-footer-btn" style="padding:7px 18px;font-size:12px;font-weight:700;border-radius:5px;cursor:pointer;border:1px solid var(--sd-accent);background:var(--sd-accent);color:var(--sd-accent-text,#fff)">
        <i class="fas fa-check" style="margin-right:5px"></i>Save
      </button>
    </div>`;

  document.body.appendChild(popup);

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
      <input type="text" class="wcfg-slot-maxpath" value="system.hiddenFields.l${next}max"
        style="background:var(--sd-bg);border:1px solid var(--sd-mp);border-radius:3px;color:var(--sd-mp);font-size:10px;padding:2px 5px;width:100%;font-family:'Courier New',monospace"
        placeholder="system.hiddenFields.l${next}max">
      <input type="text" class="wcfg-slot-valpath" value="system.spellSlots.${next}.value"
        style="background:var(--sd-bg);border:1px solid var(--sd-success);border-radius:3px;color:var(--sd-success);font-size:10px;padding:2px 5px;width:100%;font-family:'Courier New',monospace"
        placeholder="system.spellSlots.${next}.value">
      <button type="button" class="wcfg-slot-del" style="background:none;border:none;color:var(--sd-danger-dim);cursor:pointer;font-size:13px;padding:0;line-height:1" title="Remove level">✕</button>`;
    slotRowsContainer.appendChild(div);
  });
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

  popup.querySelector("#wcfg-attr-graph-btn")?.addEventListener("click", () => {
    const graph = new FormulaGraph(null, doc, w, { tab, row, w, doc });
    graph.open();
  });

  popup.querySelector("#wcfg-number-graph-btn")?.addEventListener("click", () => {
    const graph = new FormulaGraph(null, doc, w, { tab, row, w, doc }, null, { mode: "numberWidget" });
    graph.open();
  });

  popup.querySelectorAll("[data-attr-group-graph]").forEach(btn => {
    btn.addEventListener("click", () => {
      const attrKey = btn.dataset.attrGroupGraph;
      if (!attrKey) return;

      const graph = new FormulaGraph(null, doc, w, { tab, row, w, doc, attrKey });
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
    popup.querySelectorAll("input[data-field]").forEach(el => {
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
      if (type === "json")    { try { val = JSON.parse(el.value || "[]"); } catch { val = []; } }
      changes[key] = val;
    });
    popup.querySelectorAll("select[data-field]").forEach(el => {
      changes[el.dataset.field] = el.value;
    });

    const _unknownPaths = [];
    popup.querySelectorAll("input[data-field][data-ftype='path']").forEach(el => {
      const raw = String(el.value ?? "").trim();
      if (!raw) return;
      if (_isPathWritable(doc, raw)) return;
      _unknownPaths.push({ key: el.dataset.field, value: raw, input: el });
    });

    const _hfUpdates = {};
    if (_unknownPaths.length) {
      const listHtml = _unknownPaths.map(p => {
        const newKey = _hiddenFieldKeyFor(p.value);
        return `<li style="margin-bottom:4px"><code>${esc(p.value)}</code> &rarr; <code>system.hiddenFields.${esc(newKey)}</code></li>`;
      }).join("");
      const confirmed = await foundry.applications.api.DialogV2.confirm({
        window: { title: "Create new data path?" },
        content: `
          <div style="padding:8px;font-size:12px;line-height:1.5">
            <p style="margin:0 0 8px 0">The following path${_unknownPaths.length>1?"s do":" does"} not exist in this document's schema and would be silently dropped on save:</p>
            <ul style="margin:0 0 8px 18px;padding:0">${listHtml}</ul>
            <p style="margin:0;color:var(--sd-text-2,#aaa)">Create ${_unknownPaths.length>1?"them":"it"} automatically as <code>system.hiddenFields.&lt;name&gt;</code>? You can store and read freely from hidden fields.</p>
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

    const tabs   = foundry.utils.deepClone(doc.system.customTabs ?? []);
    const _findWidgetDeep = (list, id) => {
      if (!Array.isArray(list)) return null;
      for (const ww of list) {
        if (ww.id === id) return ww;
        if (ww.type === "vsection") {
          const nested = _findWidgetDeep(ww.widgets, id);
          if (nested) return nested;
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

      if (widget.type === "slot" && widget.slotId != null && String(widget.slotId).trim() !== "") {
        const sid    = String(widget.slotId).trim();
        const defs   = foundry.utils.deepClone(doc.system.slotDefinitions ?? []);
        const defIdx = defs.findIndex(d => String(d.id) === sid);
        if (defIdx !== -1) {
          if (changes.maxCount !== undefined) defs[defIdx].maxCount = Math.max(1, parseInt(changes.maxCount) || 1);
          if (changes.label    !== undefined) defs[defIdx].label    = changes.label || defs[defIdx].label;
          await doc.update({ "system.customTabs": tabs, "system.slotDefinitions": defs, ..._hfUpdates });
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
          await doc.update({ "system.customTabs": tabs, "system.slotDefinitions": defs, ..._hfUpdates });
          ui.notifications?.info?.(`Slot definition "${sid}" created for this widget.`);
        }
      } else {
        await doc.update({ "system.customTabs": tabs, ..._hfUpdates });
      }

      ui.notifications?.info?.(`Widget "${widget.label || widget.type}" saved.`);
    } else {
      ui.notifications?.warn?.(`Widget "${w.label || w.type}" not found in document data — save aborted.`);
      console.warn("[sd] widget-config-popup: failed to locate widget", { tabId: tab?.id, rowId: row?.id, widgetId: w?.id });
    }
    popup.remove();
  };

  popup.querySelector("#wcfg-save").addEventListener("click", doSave);
  popup.querySelector("#wcfg-cancel").addEventListener("click", () => popup.remove());
  popup.querySelector("#wcfg-x").addEventListener("click",     () => popup.remove());

  const saveBtn = popup.querySelector("#wcfg-save");
  saveBtn.addEventListener("mouseenter", () => saveBtn.style.background = "var(--sd-accent)");
  saveBtn.addEventListener("mouseleave", () => saveBtn.style.background = "var(--sd-accent)");

  let ds = null;
  popup.querySelector("#wcfg-hdr").addEventListener("mousedown", ev => {
    if (ev.target.id === "wcfg-x") return;
    ds = { x: ev.clientX - popup.offsetLeft, y: ev.clientY - popup.offsetTop };
  });
  document.addEventListener("mousemove", ev => {
    if (!ds) return;
    popup.style.left = `${Math.max(0, ev.clientX - ds.x)}px`;
    popup.style.top  = `${Math.max(0, ev.clientY - ds.y)}px`;
  });
  document.addEventListener("mouseup", () => ds = null);

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
