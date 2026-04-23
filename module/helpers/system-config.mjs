/**
 * module/helpers/system-config.mjs
 *
 * SystemConfig -- in-game GM configuration panel.
 * Lets you add/remove/rename: attributes, resources.
 * Skills removed - skill is now an item.
 * Rolls are defined directly in sheets.
 */

import { TabManager } from "./tabs.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

// Default config shape

export function getDefaultSettings() {
  return {
    // Attribute labels (key → display name)
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

    // Resource bars
    resources: {
      hp:      { label: "Hit Points",  enabled: true,  color: "#e05a5a" },
      mp:      { label: "Mana Points", enabled: true,  color: "#5a8ae0" },
      stamina: { label: "Stamina",     enabled: false, color: "#5ae07a" }
    },

    // Currency labels
    currency: {
      primary:   "Gold",
      secondary: "Silver",
      tertiary:  "Copper"
    },

    // Modifier formula: "halved" (floor((v-10)/2)) or "direct" (raw value)
    modifierFormula: "halved",

    // Global UI scale as a percentage (50-200). Applied via CSS zoom to all sheet content.
    uiScale: 100
  };
}

// Helpers

/** Load current settings - use stored directly, only fill missing from defaults */
export function loadSettings() {
  let stored = {};
  try {
    stored = game.settings.get("sd", "systemSettings") ?? {};
  } catch(e) {
    // settings not yet registered during early init
  }

  // If nothing stored, return defaults
  if (Object.keys(stored).length === 0) {
    return foundry.utils.deepClone(getDefaultSettings());
  }

  // Return stored settings, but fill in any missing top-level keys from defaults
  const defaults = getDefaultSettings();
  const result = foundry.utils.deepClone(stored);

  // Only fill missing top-level keys, don't merge arrays/objects
  for (const [key, val] of Object.entries(defaults)) {
    if (result[key] === undefined) {
      result[key] = foundry.utils.deepClone(val);
    }
  }

  // Ensure attributesEnabled exists and has entries for all attributes
  if (result.attributes && !result.attributesEnabled) {
    result.attributesEnabled = {};
  }
  for (const key of Object.keys(result.attributes ?? {})) {
    if (result.attributesEnabled[key] === undefined) {
      result.attributesEnabled[key] = true;
    }
  }

  // Migration: old uiFontSize/uiBtnFontSize → uiScale
  // If saved data has the old fields but no uiScale yet, derive a rough scale
  // from the old font size (13px = 100%, so scale% = fontSize/13 * 100).
  if (result.uiScale === undefined) {
    const oldSize = Number(result.uiFontSize ?? 13);
    result.uiScale = Math.round((oldSize / 13) * 100 / 5) * 5; // snap to step-5
    result.uiScale = Math.min(Math.max(result.uiScale, 50), 200);
  }
  // Clean up obsolete keys so they don't persist
  delete result.uiFontSize;
  delete result.uiBtnFontSize;

  return result;
}

/** Save settings. */
export async function saveSettings(data) {
  await game.settings.set("sd", "systemSettings", data);
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

  // Currency
  CONFIG.SD.currencyConfig = cfg.currency;

  // Modifier formula
  CONFIG.SD.modifierFormula = cfg.modifierFormula ?? "halved";

  // Global UI scale -- set --sd-ui-scale on :root so CSS zoom picks it up on all SD sheets.
  // Stored as an integer percentage (50-200); converted to a decimal for CSS (e.g. 120 → 1.2).
  const scale = Math.min(Math.max(Number(cfg.uiScale ?? 100), 50), 200) / 100;
  document.documentElement.style.setProperty("--sd-ui-scale", scale);

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

  /** Wire up the UI Scale slider for live preview as the user drags. */
  _onRender(context, options) {
    super._onRender?.(context, options);
    const slider = this.element.querySelector("#uiScaleSlider");
    const output = this.element.querySelector("#uiScaleOutput");
    if (!slider || !output) return;
    slider.addEventListener("input", () => {
      output.textContent = slider.value + "%";
      document.documentElement.style.setProperty("--sd-ui-scale", slider.value / 100);
    });
  }

  async _prepareContext(options) {
    const base = await super._prepareContext(options);
    const cfg  = loadSettings();

    return {
      ...base,
      cfg,
      attrEntries: Object.entries(cfg.attributes).map(([key, val]) => ({
        key, label: val, enabled: cfg.attributesEnabled?.[key] ?? true
      })),
      resourceEntries: Object.entries(cfg.resources).map(([key, val]) => ({ key, ...val }))
    };
  }

  // Collect form data and save
  static async _onSaveAndClose(event, target) {
    const form  = this.element.querySelector("form");
    const FDE  = foundry.applications?.ux?.FormDataExtended ?? FormDataExtended;
    const fd   = new FDE(form);
    const raw  = fd.object;

    const cfg   = loadSettings();

    // Attributes
    for (const key of Object.keys(cfg.attributes)) {
      cfg.attributes[key]           = raw[`attr_label_${key}`]   ?? cfg.attributes[key];
      cfg.attributesEnabled[key]    = !!raw[`attr_enabled_${key}`];
    }

    // Resources
    for (const key of Object.keys(cfg.resources)) {
      cfg.resources[key].label   = raw[`res_label_${key}`]   ?? cfg.resources[key].label;
      cfg.resources[key].enabled = !!raw[`res_enabled_${key}`];
      cfg.resources[key].color   = raw[`res_color_${key}`]   ?? cfg.resources[key].color;
    }

    // Currency
    cfg.currency.primary   = raw.currency_primary   ?? cfg.currency.primary;
    cfg.currency.secondary = raw.currency_secondary ?? cfg.currency.secondary;
    cfg.currency.tertiary  = raw.currency_tertiary  ?? cfg.currency.tertiary;

    // Modifier Formula
    cfg.modifierFormula = raw.modifierFormula ?? cfg.modifierFormula;

    // UI Scale
    cfg.uiScale = Math.min(Math.max(Number(raw.uiScale ?? 100) || 100, 50), 200);

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
    const cfg   = loadSettings();
    const count = Object.keys(cfg.attributes).length + 1;
    const key   = `attr${count}`;
    cfg.attributes[key] = `Attribute ${count}`;
    cfg.attributesEnabled[key] = true;
    await saveSettings(cfg);
    this.render();
  }

  static async _onRemoveAttribute(event, target) {
    const key = target.dataset.key;
    if (!key) return;
    const cfg = loadSettings();
    delete cfg.attributes[key];
    delete cfg.attributesEnabled[key];
    await saveSettings(cfg);
    this.render();
  }

  static async _onAddResource(event, target) {
    const cfg   = loadSettings();
    const count = Object.keys(cfg.resources).length + 1;
    const key   = `resource${count}`;
    const colors = ["#e05a5a", "#5a8ae0", "#5ae07a", "#e0c05a", "#c05ae0", "#e07a5a"];
    cfg.resources[key] = {
      label:   `Resource ${count}`,
      enabled: true,
      color:   colors[(count - 1) % colors.length]
    };
    await saveSettings(cfg);
    this.render();
  }

  static async _onRemoveResource(event, target) {
    const key = target.dataset.key;
    if (!key) return;
    const cfg = loadSettings();
    delete cfg.resources[key];
    await saveSettings(cfg);
    this.render();
  }
}
