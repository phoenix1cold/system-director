import { TabManager } from "./tabs.mjs";
import {
  COLOR_SCHEMES,
  THEME_IDS,
  applyColorScheme,
  localiseSchemeLabel
} from "./color-schemes.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

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

    attributesEnabled: {
      attr1: true, attr2: true, attr3: true,
      attr4: true, attr5: true, attr6: true
    },

    attributesInitial: {
      attr1: 10, attr2: 10, attr3: 10,
      attr4: 10, attr5: 10, attr6: 10
    },

    resources: {
      hp:      { label: "Hit Points",  enabled: true,  color: "#e05a5a", initialValue: 10, initialMax: 10, initialMin: 0 },
      mp:      { label: "Mana Points", enabled: true,  color: "#5a8ae0", initialValue: 10, initialMax: 10, initialMin: 0 },
      stamina: { label: "Stamina",     enabled: false, color: "#5ae07a", initialValue: 10, initialMax: 10, initialMin: 0 }
    },

    currencies: [
      { key: "primary",   label: "Gold"   },
      { key: "secondary", label: "Silver" },
      { key: "tertiary",  label: "Copper" }
    ],

    modifierFormula: "halved",

    uiScale: 100,

    colorScheme: "default"
  };
}

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

  for (const [, res] of Object.entries(result.resources ?? {})) {
    if (!res || typeof res !== "object") continue;
    if (res.initialValue === undefined) res.initialValue = 10;
    if (res.initialMax   === undefined) res.initialMax   = res.initialValue ?? 10;
    if (res.initialMin   === undefined) res.initialMin   = 0;
  }

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
    result.uiScale = Math.round((oldSize / 13) * 100 / 5) * 5;
    result.uiScale = Math.min(Math.max(result.uiScale, 50), 200);
  }
  delete result.uiFontSize;
  delete result.uiBtnFontSize;

  return result;
}

export async function saveSettings(data) {
  await game.settings.set("sd", "systemSettings", data);
}

export function buildActorBaseDefaults(actorType) {
  let cfg;
  try {
    cfg = loadSettings();
  } catch {
    return null;
  }
  if (!cfg) return null;

  const updates = {};

  for (const [key, score] of Object.entries(cfg.attributesInitial ?? {})) {
    const enabled = cfg.attributesEnabled?.[key] ?? true;
    if (!enabled) continue;
    const n = Number(score);
    if (!Number.isFinite(n)) continue;
    updates[`system.attributes.${key}.value`] = Math.trunc(n);
  }

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

export function applySettings(cfg) {
  if (!CONFIG.SD) return;

  for (const [key, label] of Object.entries(cfg.attributes ?? {})) {
    CONFIG.SD.attributes[key] = label;
    game.i18n.translations[`SD.Attributes.${key}`] = label;
  }

  for (const [key, res] of Object.entries(cfg.resources ?? {})) {
    game.i18n.translations[`SD.Resources.${key.toUpperCase()}`] = res.label ?? key;
  }

  CONFIG.SD.currencies = Array.isArray(cfg.currencies) ? cfg.currencies : [];

  const _ccLegacy = {};
  for (const c of (cfg.currencies ?? [])) _ccLegacy[c.key] = c.label;
  CONFIG.SD.currencyConfig = _ccLegacy;

  CONFIG.SD.modifierFormula = cfg.modifierFormula ?? "halved";

  CONFIG.SD.computeModifier = computeModifier;
  CONFIG.SD.compileModifierExpr = compileModifierExpr;

  const scale = Math.min(Math.max(Number(cfg.uiScale ?? 100), 50), 200) / 100;
  document.documentElement.style.setProperty("--sd-ui-scale", scale);

  const scheme = typeof cfg.colorScheme === "string" && THEME_IDS.has(cfg.colorScheme)
    ? cfg.colorScheme
    : "default";
  applyColorScheme(scheme);

  for (const app of Object.values(ui.windows ?? foundry.applications?.instances ?? {})) {
    if (app?.document) app.render();
  }
}

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

  static applyStoredSettings() {
    try {
      const cfg = loadSettings();
      applySettings(cfg);
    } catch(e) {
      console.warn("SD | Could not apply stored settings on init:", e);
    }
  }

  _onRender(context, options) {
    super._onRender?.(context, options);

    const slider = this.element.querySelector("#uiScaleSlider");
    const output = this.element.querySelector("#uiScaleOutput");
    if (slider && output) {
      slider.addEventListener("input", () => {
        output.textContent = slider.value + "%";
        document.documentElement.style.setProperty("--sd-ui-scale", slider.value / 100);
      });
    }

    const input = this.element.querySelector("input[name='colorScheme']");
    this.element.querySelectorAll("[data-scheme-id]").forEach(swatch => {
      swatch.addEventListener("click", (ev) => {
        ev.preventDefault();
        const id = swatch.dataset.schemeId;
        if (!id) return;

        if (input) input.value = id;

        this.element.querySelectorAll("[data-scheme-id]").forEach(s =>
          s.classList.toggle("is-active", s === swatch));

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

  _collectFormCfg() {
    const cfg  = loadSettings();
    const form = this.element?.querySelector?.("form");
    if (!form) return cfg;

    const FDE = foundry.applications?.ux?.FormDataExtended ?? FormDataExtended;
    const raw = new FDE(form).object;

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

    for (const c of (cfg.currencies ?? [])) {
      const lblKey = `currency_label_${c.key}`;
      if (raw[lblKey] !== undefined) c.label = raw[lblKey];
    }

    if (raw.modifierFormula !== undefined) cfg.modifierFormula = raw.modifierFormula;

    if (raw.uiScale !== undefined) {
      cfg.uiScale = Math.min(Math.max(Number(raw.uiScale) || 100, 50), 200);
    }

    if (raw.colorScheme !== undefined) {
      const id = String(raw.colorScheme);
      cfg.colorScheme = THEME_IDS.has(id) ? id : "default";
    }

    return cfg;
  }

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
