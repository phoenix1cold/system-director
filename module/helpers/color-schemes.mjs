export const COLOR_SCHEMES = [
  {
    id:    "default",
    label: "SD.Theme.Default",
    fallback: "Indigo Night (default)",
    preview: { bg: "#1a1a24", accent: "#7b68ee", text: "#e0e0ee" }
  },
  {
    id:    "midnight",
    label: "SD.Theme.Midnight",
    fallback: "Midnight Ocean",
    preview: { bg: "#0a0f1c", accent: "#3cc8e0", text: "#d8e4f0" }
  },
  {
    id:    "forest",
    label: "SD.Theme.Forest",
    fallback: "Deep Forest",
    preview: { bg: "#141c17", accent: "#7cc060", text: "#e4ead8" }
  },
  {
    id:    "crimson",
    label: "SD.Theme.Crimson",
    fallback: "Crimson Gothic",
    preview: { bg: "#1a0d10", accent: "#e04848", text: "#f0dcdc" }
  },
  {
    id:    "arcane",
    label: "SD.Theme.Arcane",
    fallback: "Arcane Purple",
    preview: { bg: "#160d1f", accent: "#c878ff", text: "#eadcf8" }
  },
  {
    id:    "sepia",
    label: "SD.Theme.Sepia",
    fallback: "Sepia Parchment (light)",
    preview: { bg: "#f3ead8", accent: "#8a4820", text: "#3a2a14" }
  },
  {
    id:    "solar",
    label: "SD.Theme.Solar",
    fallback: "Solar (balanced)",
    preview: { bg: "#002b36", accent: "#b58900", text: "#eee8d5" }
  },
  {
    id:    "nord",
    label: "SD.Theme.Nord",
    fallback: "Nord Frost",
    preview: { bg: "#2e3440", accent: "#88c0d0", text: "#eceff4" }
  },
  {
    id:    "highContrast",
    label: "SD.Theme.HighContrast",
    fallback: "High Contrast (A11y)",
    preview: { bg: "#000000", accent: "#ffd400", text: "#ffffff" }
  },
  {
    id:    "mono",
    label: "SD.Theme.Mono",
    fallback: "Mono (strict B/W)",
    preview: { bg: "#0d0d0d", accent: "#f5f5f5", text: "#f5f5f5" }
  },
  {
    id:    "sciFi",
    label: "SD.Theme.SciFi",
    fallback: "Sci-Fi (Neon)",
    preview: { bg: "#03101c", accent: "#3df0ff", text: "#dff5ff" }
  }
];

export const COLOR_SCHEMES_V2 = [
  { id: "off",          label: "SD.ThemeFx.Off",          fallback: "Off (no effects)" },
  { id: "default",      label: "SD.ThemeFx.Default",      fallback: "Indigo Night — sparkle" },
  { id: "midnight",     label: "SD.ThemeFx.Midnight",     fallback: "Midnight Ocean — ripple" },
  { id: "forest",       label: "SD.ThemeFx.Forest",       fallback: "Deep Forest — leaves" },
  { id: "crimson",      label: "SD.ThemeFx.Crimson",      fallback: "Crimson Gothic — pulse" },
  { id: "arcane",       label: "SD.ThemeFx.Arcane",       fallback: "Arcane — runes" },
  { id: "sepia",        label: "SD.ThemeFx.Sepia",        fallback: "Sepia — parchment" },
  { id: "solar",        label: "SD.ThemeFx.Solar",        fallback: "Solar — sun-flare" },
  { id: "nord",         label: "SD.ThemeFx.Nord",         fallback: "Nord Frost — ice crack" },
  { id: "highContrast", label: "SD.ThemeFx.HighContrast", fallback: "High Contrast — neon flicker" },
  { id: "mono",         label: "SD.ThemeFx.Mono",         fallback: "Mono — ink press" },
  { id: "sciFi",        label: "SD.ThemeFx.SciFi",        fallback: "Sci-Fi — scanlines / glitch" }
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
