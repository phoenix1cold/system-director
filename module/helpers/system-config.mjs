import { TabManager } from "./tabs.mjs";
import {
  COLOR_SCHEMES,
  THEME_IDS,
  applyColorScheme,
  localiseSchemeLabel
} from "./color-schemes.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

// Default config shape

export function getDefaultSettings() {
  return {
    attributes: {
      attr1: "Strength",
      attr2: "Dexterity",
      attr3: "Constitution",
      attr4: "Intelligence",
      attr5: "Wisdom",
      attr6: "Charisma"
    },
    // Which attributes are enabled
    attributesEnabled: {
      attr1: true, attr2: true, attr3: true,
      attr4: true, attr5: true, attr6: true
    },
    // Per-attribute base score used when a NEW actor is created.
    // Existing actors are NOT mutated when these change.
    attributesInitial: {
      attr1: 10, attr2: 10, attr3: 10,
      attr4: 10, attr5: 10, attr6: 10
    },

    // Resource bars. `initialValue/initialMax/initialMin` are applied at
    // actor creation time only — editing them does not retroactively change
    // existing actors.
    resources: {
      hp:      { label: "Hit Points",  enabled: true,  color: "#e05a5a", initialValue: 10, initialMax: 10, initialMin: 0 },
      mp:      { label: "Mana Points", enabled: true,  color: "#5a8ae0", initialValue: 10, initialMax: 10, initialMin: 0 },
      stamina: { label: "Stamina",     enabled: false, color: "#5ae07a", initialValue: 10, initialMax: 10, initialMin: 0 }
    },

    // Currency labels — dynamic list. Each entry has a stable key used as
    // the path on actor (system.currency.<key>) and a display label.
    // Default 3 entries map 1:1 to the legacy primary/secondary/tertiary
    // keys for backward compatibility with existing actors.
    currencies: [
      { key: "primary",   label: "Gold"   },
      { key: "secondary", label: "Silver" },
      { key: "tertiary",  label: "Copper" }
    ],

    modifierFormula: "halved",

    // Global UI scale as a percentage (50-200). Applied via CSS zoom to all sheet content.
    uiScale: 100,

    // Visual color scheme — id must match an entry in
    // `module/helpers/color-schemes.mjs` and a selector block in
    // `styles/sd-themes.css`.
    colorScheme: "default"
  };
}

// Helpers

/** Load current settings - use stored directly, only fill missing from defaults */
export function loadSettings() {
  let stored = {};
  try {
    stored = game.settings.get("sd", "systemSettings") ?? {};
  } catch(e) {
  }

  if (Object.keys(stored).length === 0) {
    return foundry.utils.deepClone(getDefaultSettings());
  }

  const defaults = getDefaultSettings();
  const result = foundry.utils.deepClone(stored);

  for (const [key, val] of Object.entries(defaults)) {
    if (result[key] === undefined) {
      result[key] = foundry.utils.deepClone(val);
    }
  }

  if (result.attributes && !result.attributesEnabled) {
    result.attributesEnabled = {};
  }
  if (!result.attributesInitial || typeof result.attributesInitial !== "object") {
    result.attributesInitial = {};
  }
  for (const key of Object.keys(result.attributes ?? {})) {
    if (result.attributesEnabled[key] === undefined) {
      result.attributesEnabled[key] = true;
    }
    if (result.attributesInitial[key] === undefined) {
      result.attributesInitial[key] = 10;
    }
  }

  // Backfill resource initial fields for entries that pre-date them.
  for (const [, res] of Object.entries(result.resources ?? {})) {
    if (!res || typeof res !== "object") continue;
    if (res.initialValue === undefined) res.initialValue = 10;
    if (res.initialMax   === undefined) res.initialMax   = res.initialValue ?? 10;
    if (res.initialMin   === undefined) res.initialMin   = 0;
  }

  // Migrate legacy currency shape { primary, secondary, tertiary } → array
  if (!Array.isArray(result.currencies)) {
    if (result.currency && typeof result.currency === "object") {
      result.currencies = [
        { key: "primary",   label: result.currency.primary   ?? "Gold"   },
        { key: "secondary", label: result.currency.secondary ?? "Silver" },
        { key: "tertiary",  label: result.currency.tertiary  ?? "Copper" }
      ];
    } else {
      result.currencies = foundry.utils.deepClone(defaults.currencies);
    }
  }
  delete result.currency;

  if (result.uiScale === undefined) {
    const oldSize = Number(result.uiFontSize ?? 13);
    result.uiScale = Math.round((oldSize / 13) * 100 / 5) * 5; // snap to step-5
    result.uiScale = Math.min(Math.max(result.uiScale, 50), 200);
  }
  delete result.uiFontSize;
  delete result.uiBtnFontSize;

  return result;
}

/** Save settings. */
export async function saveSettings(data) {
  await game.settings.set("sd", "systemSettings", data);
}

/**
 * Build the override updates that should be applied at actor-creation time
 * based on the user-configured base values in the System Config window.
 *
 * Returns a flat update object suitable for `Actor#updateSource(...)`.
 * Returns `null` if there's nothing to apply (e.g. settings are unavailable
 * during very early init).
 *
 * Existing actors are intentionally NOT mutated — these defaults only fire
 * during `preCreateActor`. Editing the settings later does not retroactively
 * change already-created characters.
 *
 * @param {string} [actorType] "character" / "npc" / etc. Reserved for future
 *   per-type overrides; currently the same defaults apply to all actor types.
 */
export function buildActorBaseDefaults(actorType) {
  let cfg;
  try {
    cfg = loadSettings();
  } catch {
    return null;
  }
  if (!cfg) return null;

  const updates = {};

  // Attributes — only set scores for keys that are enabled in settings AND
  // exist on the actor's data model (we don't know that here, so write all
  // keys; unknown ones are silently ignored by the schema).
  for (const [key, score] of Object.entries(cfg.attributesInitial ?? {})) {
    const enabled = cfg.attributesEnabled?.[key] ?? true;
    if (!enabled) continue;
    const n = Number(score);
    if (!Number.isFinite(n)) continue;
    updates[`system.attributes.${key}.value`] = Math.trunc(n);
  }

  // Resources — set value/max/min using the configured initials.
  for (const [key, res] of Object.entries(cfg.resources ?? {})) {
    if (!res || res.enabled === false) continue;
    const v = Number(res.initialValue);
    const mx = Number(res.initialMax);
    const mn = Number(res.initialMin);
    if (Number.isFinite(v))  updates[`system.resources.${key}.value`] = Math.trunc(v);
    if (Number.isFinite(mx)) updates[`system.resources.${key}.max`]   = Math.max(0, Math.trunc(mx));
    if (Number.isFinite(mn)) updates[`system.resources.${key}.min`]   = Math.trunc(mn);
  }

  return Object.keys(updates).length ? updates : null;
}

/**
 * Compute an attribute modifier from a numeric score, honouring the
 * world setting `modifierFormula` (`halved` / `direct` / `none`).
 * Defaults to "halved" when CONFIG.SD is uninitialised so it stays safe to
 * call from data-prep paths during early init.
 */
export function computeModifier(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return 0;
  const mode = CONFIG?.SD?.modifierFormula ?? "halved";
  switch (mode) {
    case "direct": return Math.floor(n);
    case "none":   return 0;
    case "halved":
    default:       return Math.floor((n - 10) / 2);
  }
}

/**
 * Same logic as `computeModifier` but returns a compilable expression string
 * for use inside generated formulas (e.g. node graph compilation).
 * `scoreExpr` is interpolated as the score sub-expression.
 */
export function compileModifierExpr(scoreExpr) {
  const expr = String(scoreExpr ?? "0");
  const mode = CONFIG?.SD?.modifierFormula ?? "halved";
  switch (mode) {
    case "direct": return `floor(${expr})`;
    case "none":   return `0`;
    case "halved":
    default:       return `floor((${expr}-10)/2)`;
  }
}

// Apply settings to CONFIG

export function applySettings(cfg) {
  if (!CONFIG.SD) return;

  // Attributes
  for (const [key, label] of Object.entries(cfg.attributes ?? {})) {
    CONFIG.SD.attributes[key] = label;
    game.i18n.translations[`SD.Attributes.${key}`] = label;
  }

  // Resources
  for (const [key, res] of Object.entries(cfg.resources ?? {})) {
    game.i18n.translations[`SD.Resources.${key.toUpperCase()}`] = res.label ?? key;
  }

  // Currency — dynamic list. Renderers should read CONFIG.SD.currencies.
  CONFIG.SD.currencies = Array.isArray(cfg.currencies) ? cfg.currencies : [];
  // Back-compat shim for old reads (CONFIG.SD.currencyConfig.{primary,…})
  const _ccLegacy = {};
  for (const c of (cfg.currencies ?? [])) _ccLegacy[c.key] = c.label;
  CONFIG.SD.currencyConfig = _ccLegacy;

  // Modifier formula
  CONFIG.SD.modifierFormula = cfg.modifierFormula ?? "halved";
  // Expose globally for other modules to consume (compileModifierExpr)
  CONFIG.SD.computeModifier = computeModifier;
  CONFIG.SD.compileModifierExpr = compileModifierExpr;

  // Global UI scale -- set --sd-ui-scale on :root so CSS zoom picks it up on all SD sheets.
  const scale = Math.min(Math.max(Number(cfg.uiScale ?? 100), 50), 200) / 100;
  document.documentElement.style.setProperty("--sd-ui-scale", scale);

  // Color scheme — delegates to CSS variables defined in styles/sd-themes.css.
  const scheme = typeof cfg.colorScheme === "string" && THEME_IDS.has(cfg.colorScheme)
    ? cfg.colorScheme
    : "default";
  applyColorScheme(scheme);

  // Refresh all open sheets
  for (const app of Object.values(ui.windows ?? foundry.applications?.instances ?? {})) {
    if (app?.document) app.render();
  }
}

// Application

export class SystemConfig extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id:      "sd-system-config",
    classes: ["sd", "system-config"],
    window: {
      title:     "SD.Settings.SystemConfig",
      icon:      "fa-solid fa-sliders",
      resizable: true
    },
    position: { width: 600, height: 550 },
    actions: {
      addAttribute:     SystemConfig._onAddAttribute,
      removeAttribute:  SystemConfig._onRemoveAttribute,
      addResource:      SystemConfig._onAddResource,
      removeResource:   SystemConfig._onRemoveResource,
      addCurrency:      SystemConfig._onAddCurrency,
      removeCurrency:   SystemConfig._onRemoveCurrency,
      resetDefaults:    SystemConfig._onResetDefaults,
      saveAndClose:     SystemConfig._onSaveAndClose
    }
  };

  static PARTS = {
    content: { template: "systems/sd/templates/config/system-config.hbs", scrollable: [".config-body"] }
  };

  /** Called on init before ready — reads stored settings and applies them. */
  static applyStoredSettings() {
    try {
      const cfg = loadSettings();
      applySettings(cfg);
    } catch(e) {
      console.warn("SD | Could not apply stored settings on init:", e);
    }
  }

  /** Wire up the UI Scale slider + color-scheme swatches for live preview. */
  _onRender(context, options) {
    super._onRender?.(context, options);

    // UI Scale slider
    const slider = this.element.querySelector("#uiScaleSlider");
    const output = this.element.querySelector("#uiScaleOutput");
    if (slider && output) {
      slider.addEventListener("input", () => {
        output.textContent = slider.value + "%";
        document.documentElement.style.setProperty("--sd-ui-scale", slider.value / 100);
      });
    }

    // Color-scheme picker — click a swatch to activate live preview.
    const input = this.element.querySelector("input[name='colorScheme']");
    this.element.querySelectorAll("[data-scheme-id]").forEach(swatch => {
      swatch.addEventListener("click", (ev) => {
        ev.preventDefault();
        const id = swatch.dataset.schemeId;
        if (!id) return;
        // Update hidden input
        if (input) input.value = id;
        // Update active state visually
        this.element.querySelectorAll("[data-scheme-id]").forEach(s =>
          s.classList.toggle("is-active", s === swatch));
        // Live preview globally
        applyColorScheme(id);
      });
    });
  }

  async _prepareContext(options) {
    const base = await super._prepareContext(options);
    const cfg  = loadSettings();

    return {
      ...base,
      cfg,
      attrEntries: Object.entries(cfg.attributes).map(([key, val]) => ({
        key,
        label:   val,
        enabled: cfg.attributesEnabled?.[key] ?? true,
        initial: Number(cfg.attributesInitial?.[key] ?? 10)
      })),
      resourceEntries: Object.entries(cfg.resources).map(([key, val]) => ({
        key,
        ...val,
        initialValue: Number(val?.initialValue ?? 10),
        initialMax:   Number(val?.initialMax   ?? val?.initialValue ?? 10),
        initialMin:   Number(val?.initialMin   ?? 0)
      })),
      currencyEntries: (cfg.currencies ?? []).map(c => ({ key: c.key, label: c.label })),
      currentScheme:   cfg.colorScheme ?? "default",
      schemeEntries:   COLOR_SCHEMES.map(s => ({
        id:       s.id,
        label:    localiseSchemeLabel(s),
        bg:       s.preview?.bg     ?? "#1a1a24",
        accent:   s.preview?.accent ?? "#7b68ee",
        text:     s.preview?.text   ?? "#e0e0ee",
        selected: (cfg.colorScheme ?? "default") === s.id
      }))
    };
  }

  /**
   * Read the current state of the form (renames, toggles, colors, etc.) and
   * merge it into a fresh cfg snapshot. Used both by Save and by Add/Remove
   * handlers so that pending edits aren't lost on re-render.
   */
  _collectFormCfg() {
    const cfg  = loadSettings();
    const form = this.element?.querySelector?.("form");
    if (!form) return cfg;

    const FDE = foundry.applications?.ux?.FormDataExtended ?? FormDataExtended;
    const raw = new FDE(form).object;

    // Attributes
    if (!cfg.attributesInitial || typeof cfg.attributesInitial !== "object") {
      cfg.attributesInitial = {};
    }
    for (const key of Object.keys(cfg.attributes ?? {})) {
      const labelKey   = `attr_label_${key}`;
      const initialKey = `attr_initial_${key}`;
      if (raw[labelKey] !== undefined) cfg.attributes[key] = raw[labelKey];
      cfg.attributesEnabled[key] = !!raw[`attr_enabled_${key}`];
      if (raw[initialKey] !== undefined) {
        const n = Number(raw[initialKey]);
        cfg.attributesInitial[key] = Number.isFinite(n) ? Math.trunc(n) : 10;
      } else if (cfg.attributesInitial[key] === undefined) {
        cfg.attributesInitial[key] = 10;
      }
    }

    // Resources
    for (const key of Object.keys(cfg.resources ?? {})) {
      const lbl  = `res_label_${key}`;
      const en   = `res_enabled_${key}`;
      const col  = `res_color_${key}`;
      const iVal = `res_initial_value_${key}`;
      const iMax = `res_initial_max_${key}`;
      const iMin = `res_initial_min_${key}`;
      if (raw[lbl] !== undefined) cfg.resources[key].label   = raw[lbl];
      cfg.resources[key].enabled = !!raw[en];
      if (raw[col] !== undefined) cfg.resources[key].color   = raw[col];
      if (raw[iVal] !== undefined) {
        const n = Number(raw[iVal]);
        cfg.resources[key].initialValue = Number.isFinite(n) ? Math.trunc(n) : 0;
      }
      if (raw[iMax] !== undefined) {
        const n = Number(raw[iMax]);
        cfg.resources[key].initialMax = Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
      }
      if (raw[iMin] !== undefined) {
        const n = Number(raw[iMin]);
        cfg.resources[key].initialMin = Number.isFinite(n) ? Math.trunc(n) : 0;
      }
    }

    // Currencies (dynamic list — read label for each entry; keys are stable)
    for (const c of (cfg.currencies ?? [])) {
      const lblKey = `currency_label_${c.key}`;
      if (raw[lblKey] !== undefined) c.label = raw[lblKey];
    }

    // Modifier Formula
    if (raw.modifierFormula !== undefined) cfg.modifierFormula = raw.modifierFormula;

    // UI Scale
    if (raw.uiScale !== undefined) {
      cfg.uiScale = Math.min(Math.max(Number(raw.uiScale) || 100, 50), 200);
    }

    // Color scheme
    if (raw.colorScheme !== undefined) {
      const id = String(raw.colorScheme);
      cfg.colorScheme = THEME_IDS.has(id) ? id : "default";
    }

    return cfg;
  }

  // Collect form data and save
  static async _onSaveAndClose(event, target) {
    const cfg = this._collectFormCfg();
    await saveSettings(cfg);
    applySettings(cfg);

    ui.notifications.info(game.i18n.localize("SD.Settings.Saved"));
    this.close();
  }

  static async _onResetDefaults(event, target) {
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      content: game.i18n.localize("SD.Settings.ResetConfirm"),
      yes: { default: true }
    });
    if (!confirmed) return;
    await saveSettings({});
    applySettings(getDefaultSettings());
    this.render();
  }

  static async _onAddAttribute(event, target) {
    // Capture pending form edits BEFORE re-rendering, otherwise unsaved
    // attribute renames / resource changes would be wiped.
    const cfg   = this._collectFormCfg();
    const count = Object.keys(cfg.attributes).length + 1;
    const key   = `attr${count}`;
    cfg.attributes[key] = `Attribute ${count}`;
    cfg.attributesEnabled[key] = true;
    if (!cfg.attributesInitial) cfg.attributesInitial = {};
    cfg.attributesInitial[key] = 10;
    await saveSettings(cfg);
    this.render();
  }

  static async _onRemoveAttribute(event, target) {
    const key = target.dataset.key;
    if (!key) return;
    const cfg = this._collectFormCfg();
    delete cfg.attributes[key];
    delete cfg.attributesEnabled[key];
    if (cfg.attributesInitial) delete cfg.attributesInitial[key];
    await saveSettings(cfg);
    this.render();
  }

  static async _onAddResource(event, target) {
    const cfg   = this._collectFormCfg();
    const count = Object.keys(cfg.resources).length + 1;
    const key   = `resource${count}`;
    const colors = ["#e05a5a", "#5a8ae0", "#5ae07a", "#e0c05a", "#c05ae0", "#e07a5a"];
    cfg.resources[key] = {
      label:        `Resource ${count}`,
      enabled:      true,
      color:        colors[(count - 1) % colors.length],
      initialValue: 10,
      initialMax:   10,
      initialMin:   0
    };
    await saveSettings(cfg);
    this.render();
  }

  static async _onRemoveResource(event, target) {
    const key = target.dataset.key;
    if (!key) return;
    const cfg = this._collectFormCfg();
    delete cfg.resources[key];
    await saveSettings(cfg);
    this.render();
  }

  static async _onAddCurrency(event, target) {
    const cfg = this._collectFormCfg();
    if (!Array.isArray(cfg.currencies)) cfg.currencies = [];
    // Find a unique key
    const existing = new Set(cfg.currencies.map(c => c.key));
    let n = cfg.currencies.length + 1;
    let key = `currency${n}`;
    while (existing.has(key)) { n++; key = `currency${n}`; }
    cfg.currencies.push({ key, label: `Currency ${n}` });
    await saveSettings(cfg);
    this.render();
  }

  static async _onRemoveCurrency(event, target) {
    const key = target.dataset.key;
    if (!key) return;
    const cfg = this._collectFormCfg();
    if (!Array.isArray(cfg.currencies)) return;
    cfg.currencies = cfg.currencies.filter(c => c.key !== key);
    await saveSettings(cfg);
    this.render();
  }
}
