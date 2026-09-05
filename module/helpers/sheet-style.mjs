const clamp = (value, min, max, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
};
const bool = (value, fallback = true) => {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return !["0", "false", "no", "off"].includes(String(value).trim().toLowerCase());
};
const oneOf = (value, options, fallback) => options.includes(String(value ?? "")) ? String(value) : fallback;
const safeColour = value => {
  const source = String(value ?? "").trim();
  if (!source) return "";
  return /^(?:#[0-9a-f]{3,8}|(?:rgb|hsl|hwb|lab|lch|oklab|oklch|color)\([^;{}<>]*\)|color-mix\([^;{}<>]*\)|var\(--[a-z0-9_-]+(?:\s*,\s*[^;{}<>]+)?\)|transparent|currentcolor|[a-z]+)$/i.test(source)
    ? source
    : "";
};
const safeImage = value => {
  const source = String(value ?? "").trim();
  if (!source || /["'();<>\\]/.test(source) || /^\s*(?:javascript|data):/i.test(source)) return "";
  return source.slice(0, 500);
};

export const SHEET_LAYOUTS = Object.freeze([
  { value:"classic", label:"Classic — top labels" },
  { value:"tabs-right", label:"Icon rail — right" },
  { value:"tabs-left", label:"Icon rail — left" },
  { value:"tabs-top-icons", label:"Top icon bar" },
  { value:"dashboard", label:"Dashboard — wide rail" }
]);
export const SHEET_HEADER_STYLES = Object.freeze([
  { value:"full", label:"Full header" },
  { value:"compact", label:"Compact header" },
  { value:"banner", label:"Banner header" },
  { value:"minimal", label:"Minimal header" }
]);
export const SHEET_DENSITIES = Object.freeze([
  { value:"comfortable", label:"Comfortable" },
  { value:"compact", label:"Compact" },
  { value:"spacious", label:"Spacious" }
]);

export const SHEET_STYLE_DEFAULTS = Object.freeze({
  preset:"classic",
  layout:"classic",
  headerStyle:"full",
  density:"comfortable",
  tabLabels:true,
  tabSize:42,
  railWidth:64,
  panelPadding:14,
  widgetGap:8,
  cornerRadius:8,
  fontScale:1,
  accent:"",
  background:"",
  panelBackground:"",
  headerBackground:"",
  backgroundImage:""
});

export const SHEET_STYLE_PRESETS = Object.freeze({
  classic: Object.freeze({
    id:"classic", label:"Classic", icon:"fas fa-window-maximize",
    description:"Horizontal text tabs and the full character header.",
    style:{...SHEET_STYLE_DEFAULTS, preset:"classic"}
  }),
  rightRail: Object.freeze({
    id:"rightRail", label:"Right icons", icon:"fas fa-table-columns",
    description:"Compact header with an icon rail on the right.",
    style:{...SHEET_STYLE_DEFAULTS, preset:"rightRail", layout:"tabs-right", headerStyle:"compact", tabLabels:false, tabSize:48, railWidth:64, panelPadding:12}
  }),
  leftRail: Object.freeze({
    id:"leftRail", label:"Left icons", icon:"fas fa-table-columns",
    description:"Compact header with an icon rail on the left.",
    style:{...SHEET_STYLE_DEFAULTS, preset:"leftRail", layout:"tabs-left", headerStyle:"compact", tabLabels:false, tabSize:48, railWidth:64, panelPadding:12}
  }),
  topIcons: Object.freeze({
    id:"topIcons", label:"Top icons", icon:"fas fa-grip",
    description:"A compact icon-first navigation bar above the content.",
    style:{...SHEET_STYLE_DEFAULTS, preset:"topIcons", layout:"tabs-top-icons", headerStyle:"compact", density:"compact", tabLabels:false, tabSize:42, panelPadding:10, widgetGap:6}
  }),
  dashboard: Object.freeze({
    id:"dashboard", label:"Dashboard", icon:"fas fa-chart-line",
    description:"Wide right rail, visible labels and a banner-style header.",
    style:{...SHEET_STYLE_DEFAULTS, preset:"dashboard", layout:"dashboard", headerStyle:"banner", density:"spacious", tabLabels:true, tabSize:46, railWidth:156, panelPadding:18, widgetGap:10, cornerRadius:12}
  })
});

export const SHEET_STYLE_PROPERTIES = Object.freeze([
  { key:"layout", label:"Layout", type:"string", pin:"value.string", options:SHEET_LAYOUTS },
  { key:"headerStyle", label:"Header style", type:"string", pin:"value.string", options:SHEET_HEADER_STYLES },
  { key:"density", label:"Density", type:"string", pin:"value.string", options:SHEET_DENSITIES },
  { key:"tabLabels", label:"Show tab labels", type:"boolean", pin:"value.bool" },
  { key:"tabSize", label:"Tab size", type:"number", pin:"value.number" },
  { key:"railWidth", label:"Rail width", type:"number", pin:"value.number" },
  { key:"panelPadding", label:"Panel padding", type:"number", pin:"value.number" },
  { key:"widgetGap", label:"Widget gap", type:"number", pin:"value.number" },
  { key:"cornerRadius", label:"Corner radius", type:"number", pin:"value.number" },
  { key:"fontScale", label:"Font scale", type:"number", pin:"value.number" },
  { key:"accent", label:"Accent colour", type:"string", pin:"value.string" },
  { key:"background", label:"Sheet background", type:"string", pin:"value.string" },
  { key:"panelBackground", label:"Panel background", type:"string", pin:"value.string" },
  { key:"headerBackground", label:"Header background", type:"string", pin:"value.string" },
  { key:"backgroundImage", label:"Background image", type:"string", pin:"value.string" }
]);

export function sheetStyleFromPreset(presetId, current = {}) {
  const preset = SHEET_STYLE_PRESETS[String(presetId ?? "")] ?? SHEET_STYLE_PRESETS.classic;
  return normalizeSheetStyle({ ...current, ...preset.style, preset:preset.id });
}

export function normalizeSheetStyle(raw = {}) {
  const base = { ...SHEET_STYLE_DEFAULTS, ...(raw && typeof raw === "object" ? raw : {}) };
  return {
    preset:String(base.preset || "custom"),
    layout:oneOf(base.layout, SHEET_LAYOUTS.map(entry => entry.value), "classic"),
    headerStyle:oneOf(base.headerStyle, SHEET_HEADER_STYLES.map(entry => entry.value), "full"),
    density:oneOf(base.density, SHEET_DENSITIES.map(entry => entry.value), "comfortable"),
    tabLabels:bool(base.tabLabels, true),
    tabSize:clamp(base.tabSize, 30, 84, 42),
    railWidth:clamp(base.railWidth, 48, 220, 64),
    panelPadding:clamp(base.panelPadding, 0, 48, 14),
    widgetGap:clamp(base.widgetGap, 0, 32, 8),
    cornerRadius:clamp(base.cornerRadius, 0, 32, 8),
    fontScale:clamp(base.fontScale, .7, 1.6, 1),
    accent:safeColour(base.accent),
    background:safeColour(base.background),
    panelBackground:safeColour(base.panelBackground),
    headerBackground:safeColour(base.headerBackground),
    backgroundImage:safeImage(base.backgroundImage)
  };
}

export function coerceSheetStyleValue(property, value) {
  const definition = SHEET_STYLE_PROPERTIES.find(entry => entry.key === property);
  if (!definition) return value;
  if (definition.type === "number") {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }
  if (definition.type === "boolean") return bool(value, false);
  return String(value ?? "");
}

export function applySheetStyle(element, raw = {}) {
  if (!element) return normalizeSheetStyle(raw);
  const style = normalizeSheetStyle(raw);
  element.dataset.sdSheetLayout = style.layout;
  element.dataset.sdSheetHeader = style.headerStyle;
  element.dataset.sdSheetDensity = style.density;
  element.dataset.sdTabLabels = style.tabLabels ? "1" : "0";
  const vars = {
    "--sd-sheet-tab-size":`${style.tabSize}px`,
    "--sd-sheet-rail-width":`${style.railWidth}px`,
    "--sd-sheet-panel-padding":`${style.panelPadding}px`,
    "--sd-sheet-widget-gap":`${style.widgetGap}px`,
    "--sd-sheet-radius":`${style.cornerRadius}px`,
    "--sd-sheet-font-scale":String(style.fontScale),
    "--sd-sheet-accent":style.accent,
    "--sd-sheet-background":style.background,
    "--sd-sheet-panel-background":style.panelBackground,
    "--sd-sheet-header-background":style.headerBackground,
    "--sd-sheet-background-image":style.backgroundImage ? `url("${style.backgroundImage}")` : "none"
  };
  for (const [key, value] of Object.entries(vars)) {
    if (value) element.style.setProperty(key, value);
    else element.style.removeProperty(key);
  }

  // "Accent colour" has to reach every control that reads --sd-accent, not only
  // the tab rail, otherwise the setting looks like it does nothing at all.
  // `style.accent` already passed safeColour(), so it cannot break out of the
  // declaration.
  const ACCENT_VARS = ["--sd-accent", "--sd-accent-2", "--sd-accent-dim", "--sd-accent-glow"];
  if (style.accent) {
    element.style.setProperty("--sd-accent", style.accent);
    element.style.setProperty("--sd-accent-2", `color-mix(in srgb, ${style.accent} 74%, #000)`);
    element.style.setProperty("--sd-accent-dim", `color-mix(in srgb, ${style.accent} 46%, transparent)`);
    element.style.setProperty("--sd-accent-glow", `color-mix(in srgb, ${style.accent} 18%, transparent)`);
  } else {
    for (const name of ACCENT_VARS) element.style.removeProperty(name);
  }

  return style;
}
