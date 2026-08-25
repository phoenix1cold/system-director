export const COLOR_SCHEMES = [
  {
    id: "default",
    label: "SD.Theme.Default",
    fallback: "Director Pro",
    preview: { bg: "#10131d", accent: "#8b7cff", text: "#f2f4ff" }
  },
  {
    id: "midnight",
    label: "SD.Theme.Midnight",
    fallback: "Abyssal Ocean",
    preview: { bg: "#07101b", accent: "#48d7e8", text: "#e8f4ff" }
  },
  {
    id: "forest",
    label: "SD.Theme.Forest",
    fallback: "Wildwood",
    preview: { bg: "#101813", accent: "#8bd06e", text: "#edf3e7" }
  },
  {
    id: "crimson",
    label: "SD.Theme.Crimson",
    fallback: "Blood Moon",
    preview: { bg: "#160b0f", accent: "#f0525f", text: "#faecee" }
  },
  {
    id: "arcane",
    label: "SD.Theme.Arcane",
    fallback: "Runebound",
    preview: { bg: "#120c1d", accent: "#c985ff", text: "#f4eaff" }
  },
  {
    id: "sepia",
    label: "SD.Theme.Sepia",
    fallback: "Ancient Parchment",
    preview: { bg: "#f1e6cf", accent: "#95501f", text: "#332514" }
  },
  {
    id: "solar",
    label: "SD.Theme.Solar",
    fallback: "Desert Sun",
    preview: { bg: "#092b32", accent: "#e1a82f", text: "#fff3d8" }
  },
  {
    id: "nord",
    label: "SD.Theme.Nord",
    fallback: "Frostbound",
    preview: { bg: "#252b36", accent: "#8fd3e2", text: "#f3f7fb" }
  },
  {
    id: "highContrast",
    label: "SD.Theme.HighContrast",
    fallback: "High Contrast",
    preview: { bg: "#000000", accent: "#ffe14a", text: "#ffffff" }
  },
  {
    id: "mono",
    label: "SD.Theme.Mono",
    fallback: "Noir Interface",
    preview: { bg: "#0b0b0c", accent: "#f2f2f2", text: "#fafafa" }
  },
  {
    id: "sciFi",
    label: "SD.Theme.SciFi",
    fallback: "Neon Grid",
    preview: { bg: "#030d17", accent: "#43ecff", text: "#e7fbff" }
  },
  {
    id: "tactical",
    label: "SD.Theme.Tactical",
    fallback: "Tactical Command",
    preview: { bg: "#11150f", accent: "#d1df66", text: "#f0f2df" }
  },
  {
    id: "darkFantasy",
    label: "SD.Theme.DarkFantasy",
    fallback: "Ashen Kingdom",
    preview: { bg: "#100d0c", accent: "#d1a35b", text: "#eee4d3" }
  },
  {
    id: "wasteland",
    label: "SD.Theme.Wasteland",
    fallback: "Wasteland Terminal",
    preview: { bg: "#15170f", accent: "#dfa447", text: "#f2dfb6" }
  },
  {
    id: "royal",
    label: "SD.Theme.Royal",
    fallback: "Royal Adventure",
    preview: { bg: "#0b1224", accent: "#e1c36a", text: "#f7f3e9" }
  },
  {
    id: "cyber",
    label: "SD.Theme.Cyber",
    fallback: "Cyber Pulse",
    preview: { bg: "#080812", accent: "#ff55d8", text: "#fff0ff" }
  },
  {
    id: "horror",
    label: "SD.Theme.Horror",
    fallback: "Dread Signal",
    preview: { bg: "#0e1210", accent: "#dc5353", text: "#edf0e9" }
  },
];

export const COLOR_SCHEMES_V2 = [
  { id: "off", label: "SD.ThemeFx.Off", fallback: "Off (no effects)" },
  { id: "default", label: "SD.ThemeFx.Default", fallback: "Director Pro \u2014 prism sweep" },
  { id: "midnight", label: "SD.ThemeFx.Midnight", fallback: "Abyssal Ocean \u2014 sonar ripple" },
  { id: "forest", label: "SD.ThemeFx.Forest", fallback: "Wildwood \u2014 drifting leaves" },
  { id: "crimson", label: "SD.ThemeFx.Crimson", fallback: "Blood Moon \u2014 heartbeat" },
  { id: "arcane", label: "SD.ThemeFx.Arcane", fallback: "Runebound \u2014 glyphs" },
  { id: "sepia", label: "SD.ThemeFx.Sepia", fallback: "Ancient Parchment \u2014 ink and grain" },
  { id: "solar", label: "SD.ThemeFx.Solar", fallback: "Desert Sun \u2014 flare" },
  { id: "nord", label: "SD.ThemeFx.Nord", fallback: "Frostbound \u2014 ice fracture" },
  { id: "highContrast", label: "SD.ThemeFx.HighContrast", fallback: "High Contrast \u2014 focus pulse" },
  { id: "mono", label: "SD.ThemeFx.Mono", fallback: "Noir Interface \u2014 ink press" },
  { id: "sciFi", label: "SD.ThemeFx.SciFi", fallback: "Neon Grid \u2014 scanlines" },
  { id: "tactical", label: "SD.ThemeFx.Tactical", fallback: "Tactical Command \u2014 target grid" },
  { id: "darkFantasy", label: "SD.ThemeFx.DarkFantasy", fallback: "Ashen Kingdom \u2014 embers" },
  { id: "wasteland", label: "SD.ThemeFx.Wasteland", fallback: "Wasteland Terminal \u2014 phosphor noise" },
  { id: "royal", label: "SD.ThemeFx.Royal", fallback: "Royal Adventure \u2014 gilded sweep" },
  { id: "cyber", label: "SD.ThemeFx.Cyber", fallback: "Cyber Pulse \u2014 chromatic glitch" },
  { id: "horror", label: "SD.ThemeFx.Horror", fallback: "Dread Signal \u2014 warning pulse" },
];

export const THEME_FX_IDS = new Set(COLOR_SCHEMES_V2.map(s => s.id));

export function getColorSchemeV2(id) {
  return COLOR_SCHEMES_V2.find(s => s.id === id) ?? COLOR_SCHEMES_V2[0];
}

export function localiseSchemeV2Label(scheme) {
  if (!scheme) return "";
  try {
    const i18n = globalThis.game?.i18n;
    if (i18n?.has?.(scheme.label)) return i18n.localize(scheme.label);
    if (i18n?.localize) {
      const s = i18n.localize(scheme.label);
      if (s && s !== scheme.label) return s;
    }
  } catch {  }
  return scheme.fallback ?? scheme.id;
}

export const THEME_IDS = new Set(COLOR_SCHEMES.map(s => s.id));

export function getColorScheme(id) {
  return COLOR_SCHEMES.find(s => s.id === id) ?? COLOR_SCHEMES[0];
}

export function localiseSchemeLabel(scheme) {
  if (!scheme) return "";
  try {
    const i18n = globalThis.game?.i18n;
    if (i18n?.has?.(scheme.label)) return i18n.localize(scheme.label);
    if (i18n?.localize) {
      const s = i18n.localize(scheme.label);
      if (s && s !== scheme.label) return s;
    }
  } catch {  }
  return scheme.fallback ?? scheme.id;
}

export const SD_THEME_SELECTOR = [

  '.application.sd',
  '.window-app.sd',
  '[data-appid].sd',

  '.application.sd-toolbox',
  '.application.sd-progression-app',
  '.application.sd-action-hud-config',
  '.application.sd-hud-inline-editor',
  '.application.system-config',

  '.sd-sheet',
  '.sd-toolbox',
  '.sd-formula-graph',
  '.sd-formula-graph-host',
  '.sd-chat-card',
  '.sd-wcfg-popup',
  '.sd-action-hud-config',
  '.sd-hud-inline-editor',
  '#sd-formula-graph-win',
  '#sd-action-hud',
  '#sd-action-hud-floating',

  '.application[class*="sd-"]'
].join(", ");

export function applyColorScheme(id) {
  const scheme = THEME_IDS.has(id) ? id : "default";
  try {
    document.documentElement.setAttribute("data-sd-theme", scheme);
    document.body?.setAttribute?.("data-sd-theme", scheme);
  } catch (e) {
    console.warn("SD | applyColorScheme: could not tag document root:", e);
  }

  try {
    document.querySelectorAll(SD_THEME_SELECTOR)
      .forEach(el => el.setAttribute("data-sd-theme", scheme));
  } catch (e) {  }

  try {
    document.querySelectorAll("#sd-formula-graph-win, .sd-formula-graph-host")
      .forEach(el => el.setAttribute("data-sd-theme", scheme));
  } catch (e) {  }
}

export function applyColorSchemeV2(id) {
  const fx = THEME_FX_IDS.has(id) ? id : "off";
  try {
    if (fx === "off") {
      document.documentElement.removeAttribute("data-sd-theme-fx");
      document.body?.removeAttribute?.("data-sd-theme-fx");
    } else {
      document.documentElement.setAttribute("data-sd-theme-fx", fx);
      document.body?.setAttribute?.("data-sd-theme-fx", fx);
    }
  } catch (e) {
    console.warn("SD | applyColorSchemeV2: could not tag document root:", e);
  }

  try {
    const ALL = [SD_THEME_SELECTOR, "#sd-formula-graph-win", ".sd-formula-graph-host"].join(", ");
    document.querySelectorAll(ALL).forEach(el => {
      if (fx === "off") el.removeAttribute("data-sd-theme-fx");
      else el.setAttribute("data-sd-theme-fx", fx);
    });
  } catch (e) {  }
}

let _observer = null;
export function installColorSchemeObserver() {
  if (_observer || typeof MutationObserver === "undefined") return;

  const getCurrentTheme = () =>
    document.documentElement.getAttribute("data-sd-theme") || "default";
  const getCurrentFx = () =>
    document.documentElement.getAttribute("data-sd-theme-fx") || "";

  const tagEl = (el) => {
    if (!el || !el.setAttribute) return;
    el.setAttribute("data-sd-theme", getCurrentTheme());
    const fx = getCurrentFx();
    if (fx) el.setAttribute("data-sd-theme-fx", fx);
    else el.removeAttribute?.("data-sd-theme-fx");
  };

  const EXTRA_MATCH = '[class*="sd-"], [class*="sd "], [class$=" sd"]';

  _observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const n of m.addedNodes ?? []) {
        if (!(n instanceof Element)) continue;

        try {
          if (n.matches?.(SD_THEME_SELECTOR) ||
              n.matches?.(EXTRA_MATCH) ||
              n.classList?.contains("sd") ||
              n.id === "sd-formula-graph-win" ||
              n.matches?.(".sd-formula-graph-host")) {
            tagEl(n);
          }
        } catch {  }

        try {
          n.querySelectorAll?.(SD_THEME_SELECTOR).forEach(tagEl);
          n.querySelectorAll?.("#sd-formula-graph-win, .sd-formula-graph-host").forEach(tagEl);
        } catch {  }
      }
    }
  });

  _observer.observe(document.documentElement, { childList: true, subtree: true });

  if (globalThis.Hooks?.on) {
    try {
      globalThis.Hooks.on("renderApplicationV2", (_app, html) => {
        try {
          const el = html?.[0] ?? html ?? null;
          if (!el) return;
          if (el.matches?.(SD_THEME_SELECTOR) ||
              el.classList?.contains("sd") ||
              /(^|\s)sd[- ]/.test(el.className ?? "")) {
            tagEl(el);
          }
          el.querySelectorAll?.(SD_THEME_SELECTOR).forEach(tagEl);
        } catch {  }
      });
    } catch {  }
  }

  installThemeFxClickTrigger();
}

let _fxClickInstalled = false;
const FX_CLICK_SELECTOR = [
  "[data-action]",
  "[data-roll]",
  "[data-step]",
  "[data-toggle]",
  "[data-attr-roll]",
  "[data-attr-onclick]",
  ".num-btn",
  ".sd-action-btn",
  "button"
].join(",");
const FX_CLICK_DURATION_MS = 700;
const FX_CLICK_ATTR = "data-sd-fx-clicked";

export function installThemeFxClickTrigger() {
  if (_fxClickInstalled || typeof document === "undefined") return;
  _fxClickInstalled = true;

  const handler = (ev) => {
    try {
      const root = document.documentElement;
      const fx = root?.getAttribute?.("data-sd-theme-fx");
      if (!fx || fx === "off") return;

      const target = ev.target;
      if (!(target instanceof Element)) return;

      const action = target.closest(FX_CLICK_SELECTOR);
      if (!action) return;

      const widget = action.closest(".widget, .sd-action-hud-widget .widget, .sd .widget");
      if (!widget) return;

      action.setAttribute(FX_CLICK_ATTR, "1");
      const existing = action._sdFxClickTimer;
      if (existing) clearTimeout(existing);
      action._sdFxClickTimer = setTimeout(() => {
        try { action.removeAttribute(FX_CLICK_ATTR); } catch {  }
        action._sdFxClickTimer = null;
      }, FX_CLICK_DURATION_MS);
    } catch {  }
  };

  document.addEventListener("pointerdown", handler, true);
  document.addEventListener("click", handler, true);
}
