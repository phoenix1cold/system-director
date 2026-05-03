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
  }
];

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
}

let _observer = null;
export function installColorSchemeObserver() {
  if (_observer || typeof MutationObserver === "undefined") return;
  const getCurrent = () =>
    document.documentElement.getAttribute("data-sd-theme") || "default";

  _observer = new MutationObserver((mutations) => {
    const cur = getCurrent();
    for (const m of mutations) {
      for (const n of m.addedNodes ?? []) {
        if (!(n instanceof Element)) continue;

        try {
          if (n.matches?.(SD_THEME_SELECTOR) ||
              n.matches?.('[class*="sd-"], [class*="sd "], [class$=" sd"]') ||
              n.classList?.contains("sd")) {
            n.setAttribute("data-sd-theme", cur);
          }
        } catch {  }

        try {
          n.querySelectorAll?.(SD_THEME_SELECTOR)
            .forEach(el => el.setAttribute("data-sd-theme", cur));
        } catch {  }
      }
    }
  });

  _observer.observe(document.documentElement, { childList: true, subtree: true });

  if (globalThis.Hooks?.on) {
    try {
      globalThis.Hooks.on("renderApplicationV2", (_app, html) => {
        try {
          const cur = getCurrent();
          const el = html?.[0] ?? html ?? null;
          if (!el) return;
          if (el.matches?.(SD_THEME_SELECTOR) ||
              el.classList?.contains("sd") ||
              /(^|\s)sd[- ]/.test(el.className ?? "")) {
            el.setAttribute("data-sd-theme", cur);
          }
          el.querySelectorAll?.(SD_THEME_SELECTOR)
            .forEach(e => e.setAttribute("data-sd-theme", cur));
        } catch {  }
      });
    } catch {  }
  }
}
