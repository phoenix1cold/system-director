/**
 * Color Scheme Registry
 * ---------------------
 * Defines the set of visual themes the user can switch between from the
 * System Config window. Each entry is metadata only — the actual CSS
 * variable overrides live in `styles/sd-themes.css` under the matching
 * `[data-sd-theme="…"]` selector.
 *
 * Adding a new scheme:
 *   1. Add a new entry to `COLOR_SCHEMES` below (id, label, preview swatches).
 *   2. Add the matching selector block to `styles/sd-themes.css`.
 *   3. Localise the `label` string under `SD.Theme.<Id>` in `lang/en.json`
 *      (and `lang/ru.json`). If no translation is present, the bare label
 *      falls through.
 */

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

/** Set of valid scheme IDs (lookup). */
export const THEME_IDS = new Set(COLOR_SCHEMES.map(s => s.id));

/** Return a scheme definition by id, falling back to "default". */
export function getColorScheme(id) {
  return COLOR_SCHEMES.find(s => s.id === id) ?? COLOR_SCHEMES[0];
}

/**
 * Localise a scheme's label (with graceful fallback to the English name).
 * Safe to call before `game.i18n` is fully initialised — returns `fallback`
 * in that case.
 */
export function localiseSchemeLabel(scheme) {
  if (!scheme) return "";
  try {
    const i18n = globalThis.game?.i18n;
    if (i18n?.has?.(scheme.label)) return i18n.localize(scheme.label);
    if (i18n?.localize) {
      const s = i18n.localize(scheme.label);
      if (s && s !== scheme.label) return s;
    }
  } catch { /* no-op */ }
  return scheme.fallback ?? scheme.id;
}

/**
 * Apply a color scheme globally. Sets the `data-sd-theme` attribute on
 * <html>, <body> and every ApplicationV2 root that is currently rendered.
 *
 * Called on init, whenever System Settings change, and by a DOM mutation
 * observer (installed by `installColorSchemeObserver`) so that freshly
 * rendered popouts pick up the theme even though they create their own
 * DOM subtree outside <body>.
 *
 * @param {string} id — scheme id; unknown ids fall back to "default".
 */
export const SD_THEME_SELECTOR = [
  // Any SD ApplicationV2 root (sheets, toolbox, progression, HUD configs…)
  '.application.sd',
  '.window-app.sd',
  '[data-appid].sd',
  // Explicit SD window classes (kept for defence-in-depth even though
  // every SD AppV2 now includes the bare "sd" marker class).
  '.application.sd-toolbox',
  '.application.sd-progression-app',
  '.application.sd-action-hud-config',
  '.application.sd-hud-inline-editor',
  '.application.system-config',
  // Standalone / embedded SD containers that aren't ApplicationV2 but
  // own a visible DOM subtree that uses `--sd-*` variables (formula
  // graph host, sheet builder panels, standalone widgets, …).
  '.sd-sheet',
  '.sd-toolbox',
  '.sd-formula-graph',
  '.sd-formula-graph-host',
  '.sd-chat-card',
  // Generic catch-all: anything the system explicitly prefixes with
  // `sd-` on an application-level element.
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
  // Stamp every currently-rendered SD surface. Running more than once is
  // harmless (idempotent attribute set).
  try {
    document.querySelectorAll(SD_THEME_SELECTOR)
      .forEach(el => el.setAttribute("data-sd-theme", scheme));
  } catch (e) { /* no-op */ }
}

/**
 * Mutation observer that re-applies the active theme whenever Foundry
 * inserts a new Application window. Without this, popouts rendered after
 * the initial theme apply would stay on the legacy palette.
 */
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
        // Tag the node itself if it is (or looks like) an SD surface.
        try {
          if (n.matches?.(SD_THEME_SELECTOR) ||
              n.matches?.('[class*="sd-"], [class*="sd "], [class$=" sd"]') ||
              n.classList?.contains("sd")) {
            n.setAttribute("data-sd-theme", cur);
          }
        } catch { /* no-op */ }
        // Recurse once for Foundry popouts that wrap content.
        try {
          n.querySelectorAll?.(SD_THEME_SELECTOR)
            .forEach(el => el.setAttribute("data-sd-theme", cur));
        } catch { /* no-op */ }
      }
    }
  });
  // Observe the whole document tree — Foundry injects ApplicationV2 roots
  // both directly under <body> and (for some popouts) inside #interface.
  _observer.observe(document.documentElement, { childList: true, subtree: true });

  // Also re-apply the theme whenever any element is mutated so that late-
  // rendered popouts (e.g. the widget-config popup, which toggles its own
  // classes after mount) stay tagged.
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
        } catch { /* no-op */ }
      });
    } catch { /* no-op */ }
  }
}
