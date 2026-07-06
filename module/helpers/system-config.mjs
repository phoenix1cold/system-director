import { TabManager } from "./tabs.mjs";
import { FormulaEngine } from "./formula-engine.mjs";
import {
  COLOR_SCHEMES,
  THEME_IDS,
  applyColorScheme,
  applyColorSchemeV2,
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

    calculations: {
      defense: [
        { key: "total", label: "Defense Total", default: 10, parts: [], useGraph: true, graphData: defaultCalcGraph(), compiledFormula: DEFAULT_CALC_COMPILED }
      ],
      initiative: [
        { key: "total", label: "Initiative Total", default: 0, parts: [], useGraph: true, graphData: defaultCalcGraph(), compiledFormula: DEFAULT_CALC_COMPILED }
      ],
      movement: [
        { key: "walk",  label: "Walk",  default: 30, parts: [], useGraph: true, graphData: defaultCalcGraph(), compiledFormula: DEFAULT_CALC_COMPILED },
        { key: "swim",  label: "Swim",  default: 15, parts: [], useGraph: true, graphData: defaultCalcGraph(), compiledFormula: DEFAULT_CALC_COMPILED },
        { key: "fly",   label: "Fly",   default: 0,  parts: [], useGraph: true, graphData: defaultCalcGraph(), compiledFormula: DEFAULT_CALC_COMPILED },
        { key: "climb", label: "Climb", default: 15, parts: [], useGraph: true, graphData: defaultCalcGraph(), compiledFormula: DEFAULT_CALC_COMPILED }
      ]
    },

    modifierFormula: "halved",

    uiScale: 100,

    colorScheme: "default"
  };
}

export function defaultCalcGraph() {
  return {
    nodes: [
      { id: "num_default", type: "literal", x: 320, y: 230, data: { value: 0 } },
      { id: "output",      type: "output",  x: 660, y: 230, data: {} }
    ],
    edges: [
      { id: "e_num_out", fromNode: "num_default", fromPin: "v", toNode: "output", toPin: "value" }
    ],
    comments: []
  };
}

export const DEFAULT_CALC_COMPILED = "0";

const CALC_SECTIONS = ["defense", "initiative", "movement"];
const SYSTEM_PATH_SECTION_META = {
  defense:    { label: "Defense",    icon: "fa-shield-halved" },
  initiative: { label: "Initiative", icon: "fa-bolt" },
  movement:   { label: "Movement",   icon: "fa-person-running" }
};
const VALID_OPS = new Set(["+", "-", "*", "/"]);

function _normalizeFormulaPart(p) {
  const op   = VALID_OPS.has(p?.op) ? p.op : "+";
  const path = String(p?.path ?? "").trim();
  return { op, path };
}

function _normalizeCalcEntry(e, fallbackKey) {
  const key      = String(e?.key ?? fallbackKey ?? "").trim();
  const label    = String(e?.label ?? key);
  const parts    = Array.isArray(e?.parts) ? e.parts.map(_normalizeFormulaPart) : [];
  const dn       = Number(e?.default);
  const def      = Number.isFinite(dn) ? Math.trunc(dn) : 0;
  const useGraph = !!e?.useGraph;
  const gd       = e?.graphData;
  const graph    = (gd && typeof gd === "object" && Array.isArray(gd.nodes))
    ? { nodes: gd.nodes, edges: gd.edges ?? [], comments: gd.comments ?? [] }
    : null;
  const compiled = (typeof e?.compiledFormula === "string") ? e.compiledFormula : "";
  return { key, label, default: def, parts, useGraph, graphData: graph, compiledFormula: compiled };
}

export function normalizeCalculations(calc) {
  const out = { defense: [], initiative: [], movement: [] };
  if (!calc || typeof calc !== "object") return out;
  for (const sec of CALC_SECTIONS) {
    const list = calc[sec];
    if (!Array.isArray(list)) continue;
    out[sec] = list.map((e, i) => _normalizeCalcEntry(e, `entry${i+1}`)).filter(e => e.key);
  }
  return out;
}

export function getSystemPathEntries(cfg = null) {
  let src = cfg;
  if (!src) {
    try { src = loadSettings(); } catch { src = null; }
  }
  const rawCalc = src?.calculations ?? CONFIG?.SD?.calculations ?? {};
  const calc = normalizeCalculations(rawCalc);
  const out = [];
  for (const sec of CALC_SECTIONS) {
    const meta = SYSTEM_PATH_SECTION_META[sec] ?? { label: sec, icon: "fa-route" };
    for (const [index, entry] of (calc[sec] ?? []).entries()) {
      const key = String(entry?.key ?? "").trim();
      if (!key) continue;
      out.push({
        section: sec,
        sectionLabel: meta.label,
        sectionIcon: meta.icon,
        key,
        label: String(entry?.label ?? key),
        default: Number.isFinite(Number(entry?.default)) ? Math.trunc(Number(entry.default)) : 0,
        useGraph: !!entry?.useGraph,
        hasGraph: !!(entry?.graphData && Array.isArray(entry.graphData.nodes) && entry.graphData.nodes.length),
        graphNodeCount: entry?.graphData?.nodes?.length ?? 0,
        index,
        path: `system.${sec}.${key}`,
        parts: Array.isArray(entry?.parts) ? entry.parts : []
      });
    }
  }
  return out;
}

export function getSystemPathSections() {
  return CALC_SECTIONS.map(section => ({
    section,
    label: SYSTEM_PATH_SECTION_META[section]?.label ?? section,
    icon:  SYSTEM_PATH_SECTION_META[section]?.icon  ?? "fa-route"
  }));
}

export function isConfiguredSystemPath(path, cfg = null) {
  const p = String(path ?? "").trim();
  if (!p) return false;
  return getSystemPathEntries(cfg).some(entry => p === entry.path || p.startsWith(entry.path + "."));
}

export function evalCalcFormula(parts, ctx) {
  if (!Array.isArray(parts) || !parts.length) return 0;
  let result = 0;
  let started = false;
  for (const p of parts) {
    const path = String(p?.path ?? "").trim();
    if (!path) continue;
    const raw = foundry.utils.getProperty(ctx, path);
    const v = Number(raw);
    const num = Number.isFinite(v) ? v : 0;
    const op = VALID_OPS.has(p?.op) ? p.op : "+";
    if (!started) {
      result = (op === "-") ? -num : num;
      started = true;
      continue;
    }
    switch (op) {
      case "+": result += num; break;
      case "-": result -= num; break;
      case "*": result *= num; break;
      case "/": result = (num !== 0) ? result / num : result; break;
    }
  }
  return result;
}

export function applyCalculationsToActor(actor) {
  const calc = CONFIG?.SD?.calculations;
  if (!calc || !actor) return;
  const sys = actor.system;
  if (!sys) return;
  for (const sec of CALC_SECTIONS) {
    const list = calc[sec];
    if (!Array.isArray(list) || !list.length) continue;
    if (!sys[sec] || typeof sys[sec] !== "object") sys[sec] = {};
    for (const entry of list) {
      const key = entry?.key;
      if (!key) continue;

      if (entry?.useGraph && typeof entry.compiledFormula === "string" && entry.compiledFormula.trim()) {
        try {
          const resolved = FormulaEngine.evaluate(entry.compiledFormula, actor);
          const num = Number(resolved);
          if (Number.isFinite(num)) {
            sys[sec][key] = Math.trunc(num);
            continue;
          }
        } catch(e) {
          console.warn("SD | calc graph evaluation failed", sec, key, e);
        }
      }

      const parts = Array.isArray(entry.parts) ? entry.parts : [];
      if (!parts.length) continue;
      const v = evalCalcFormula(parts, actor);
      sys[sec][key] = Math.trunc(v);
    }
  }
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

  result.calculations = normalizeCalculations(result.calculations ?? defaults.calculations);
  for (const sec of CALC_SECTIONS) {
    if (!result.calculations[sec].length) {
      result.calculations[sec] = foundry.utils.deepClone(defaults.calculations[sec] ?? []);
    }
  }

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

  for (const sec of CALC_SECTIONS) {
    const list = cfg.calculations?.[sec];
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      const k = entry?.key;
      if (!k) continue;
      const dn = Number(entry.default);
      if (!Number.isFinite(dn)) continue;
      updates[`system.${sec}.${k}`] = Math.trunc(dn);
    }
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

export function applyInitiativeFormulaFromSettings() {
  if (!game?.settings) return;
  let formula = "1d20";
  let useGraph = false;
  let compiled = "";
  try { formula  = String(game.settings.get("sd", "initiativeFormula") ?? "1d20"); } catch {}
  try { useGraph = !!game.settings.get("sd", "initiativeUseGraph"); } catch {}
  try { compiled = String(game.settings.get("sd", "initiativeGraphCompiled") ?? ""); } catch {}
  const effective = (useGraph && compiled.trim()) ? compiled.trim() : formula;
  if (!effective) return;
  try {
    if (game.system) game.system.initiative = effective;
    if (CONFIG?.Combat?.initiative) CONFIG.Combat.initiative.formula = effective;
  } catch(e) { console.warn("SD | Could not apply initiative formula:", e); }
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

  CONFIG.SD.calculations = normalizeCalculations(cfg.calculations);

  CONFIG.SD.computeModifier = computeModifier;
  CONFIG.SD.compileModifierExpr = compileModifierExpr;

  applyInitiativeFormulaFromSettings();

  const scale = Math.min(Math.max(Number(cfg.uiScale ?? 100), 50), 200) / 100;
  document.documentElement.style.setProperty("--sd-ui-scale", scale);

  const scheme = typeof cfg.colorScheme === "string" && THEME_IDS.has(cfg.colorScheme)
    ? cfg.colorScheme
    : "default";
  applyColorScheme(scheme);

  applyColorSchemeV2("off");

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
      addCalcEntry:     SystemConfig._onAddCalcEntry,
      removeCalcEntry:  SystemConfig._onRemoveCalcEntry,
      addCalcPart:      SystemConfig._onAddCalcPart,
      removeCalcPart:   SystemConfig._onRemoveCalcPart,
      editCalcGraph:    SystemConfig._onEditCalcGraph,
      editInitiativeGraph: SystemConfig._onEditInitiativeGraph,
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

    this.element.querySelectorAll('input[type="checkbox"][name^="calc_"][name$="_useGraph"]').forEach(cb => {
      cb.addEventListener("change", async () => {
        try {
          const cfg = this._collectFormCfg();
          await saveSettings(cfg);
          this.render();
        } catch(e) {
          console.warn("SD | useGraph toggle failed", e);
        }
      });
    });
  }

  async _prepareContext(options) {
    const base = await super._prepareContext(options);
    const cfg  = loadSettings();

    let initFormula = "1d20";
    let initUseGraph = false;
    let initCompiled = "";
    let initGraph = null;
    try { initFormula  = String(game.settings.get("sd", "initiativeFormula") ?? "1d20"); } catch {}
    try { initUseGraph = !!game.settings.get("sd", "initiativeUseGraph"); } catch {}
    try { initCompiled = String(game.settings.get("sd", "initiativeGraphCompiled") ?? ""); } catch {}
    try { initGraph    = game.settings.get("sd", "initiativeGraph") ?? null; } catch {}
    const initNodeCount = (initGraph && Array.isArray(initGraph.nodes)) ? initGraph.nodes.length : 0;

    return {
      ...base,
      cfg,
      initiative: {
        formula:        initFormula,
        useGraph:       initUseGraph,
        compiled:       initCompiled,
        hasGraph:       initNodeCount > 0,
        graphNodeCount: initNodeCount
      },
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
      systemPathSections: getSystemPathSections().map((s, i) => ({ ...s, selected: i === 0 })),
      systemPathEntries: getSystemPathEntries(cfg).map(e => ({
        ...e,
        isDefense:    e.section === "defense",
        isInitiative: e.section === "initiative",
        isMovement:   e.section === "movement"
      })),
      calcSections: CALC_SECTIONS.map(sec => ({
        section: sec,
        title: SYSTEM_PATH_SECTION_META[sec]?.label ?? sec,
        icon:  SYSTEM_PATH_SECTION_META[sec]?.icon  ?? "fa-route",
        entries: (cfg.calculations?.[sec] ?? []).map((e, ei) => ({
          key:      e.key,
          label:    e.label,
          default:  Number.isFinite(Number(e.default)) ? Math.trunc(Number(e.default)) : 0,
          useGraph: !!e.useGraph,
          hasGraph: !!(e.graphData && Array.isArray(e.graphData.nodes) && e.graphData.nodes.length),
          graphNodeCount: (e.graphData?.nodes?.length ?? 0),
          index:    ei,
          parts:    (e.parts ?? []).map((p, pi) => ({
            op: p.op, path: p.path, index: pi,
            isPlus:  p.op === "+",
            isMinus: p.op === "-",
            isMul:   p.op === "*",
            isDiv:   p.op === "/"
          }))
        }))
      })),
      currentScheme:   cfg.colorScheme ?? "default",
      schemeEntries:   COLOR_SCHEMES.map(s => ({
        id:       s.id,
        label:    localiseSchemeLabel(s),
        bg:       s.preview?.bg     ?? "#1a1a24",
        accent:   s.preview?.accent ?? "#7b68ee",
        text:     s.preview?.text   ?? "#e0e0ee",
        selected: (cfg.colorScheme ?? "default") === s.id
      })),
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

    cfg.__initiativeFormula  = raw.initiativeFormula  !== undefined ? String(raw.initiativeFormula) : null;
    cfg.__initiativeUseGraph = !!raw.initiativeUseGraph;

    if (raw.uiScale !== undefined) {
      cfg.uiScale = Math.min(Math.max(Number(raw.uiScale) || 100, 50), 200);
    }

    if (raw.colorScheme !== undefined) {
      const id = String(raw.colorScheme);
      cfg.colorScheme = THEME_IDS.has(id) ? id : "default";
    }

    if (!cfg.calculations) cfg.calculations = { defense: [], initiative: [], movement: [] };
    const nextCalculations = { defense: [], initiative: [], movement: [] };
    for (const sec of CALC_SECTIONS) {
      const list = Array.isArray(cfg.calculations[sec]) ? cfg.calculations[sec] : [];
      for (let ei = 0; ei < list.length; ei++) {
        const e   = list[ei];
        const sK  = `calc_${sec}_${ei}_section`;
        const kK  = `calc_${sec}_${ei}_key`;
        const lK  = `calc_${sec}_${ei}_label`;
        const dK  = `calc_${sec}_${ei}_default`;
        const nextSec = CALC_SECTIONS.includes(String(raw[sK] ?? "")) ? String(raw[sK]) : sec;
        if (raw[kK] !== undefined) e.key   = String(raw[kK]).trim().replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_]/g, "") || e.key;
        if (raw[lK] !== undefined) e.label = String(raw[lK]);
        if (raw[dK] !== undefined) {
          const dn = Number(raw[dK]);
          e.default = Number.isFinite(dn) ? Math.trunc(dn) : 0;
        }
        // Calculations are node-graph only; the operator/path UI and graph toggle were removed.
        e.useGraph = true;
        if (!Array.isArray(e.parts)) e.parts = [];
        const hasGraph = e.graphData && typeof e.graphData === "object" && Array.isArray(e.graphData.nodes) && e.graphData.nodes.length;
        if (!hasGraph) {
          e.graphData = defaultCalcGraph();
          if (typeof e.compiledFormula !== "string" || !e.compiledFormula.trim()) e.compiledFormula = DEFAULT_CALC_COMPILED;
        }
        nextCalculations[nextSec].push(e);
      }
    }
    cfg.calculations = nextCalculations;

    return cfg;
  }

  static async _onAddCalcEntry(event, target) {
    const sec = target.dataset.section || this.element?.querySelector?.("[name='systemPathAddSection']")?.value || "defense";
    if (!CALC_SECTIONS.includes(sec)) return;
    const cfg = this._collectFormCfg();
    if (!cfg.calculations) cfg.calculations = { defense: [], initiative: [], movement: [] };
    if (!Array.isArray(cfg.calculations[sec])) cfg.calculations[sec] = [];
    const used = new Set(cfg.calculations[sec].map(e => e.key));
    let n = cfg.calculations[sec].length + 1;
    let key = `entry${n}`;
    while (used.has(key)) { n++; key = `entry${n}`; }
    cfg.calculations[sec].push({ key, label: `Entry ${n}`, default: 0, parts: [], useGraph: true, graphData: defaultCalcGraph(), compiledFormula: DEFAULT_CALC_COMPILED });
    await saveSettings(cfg);
    this.render();
  }

  static async _onRemoveCalcEntry(event, target) {
    const sec = target.dataset.section;
    const idx = Number(target.dataset.index);
    if (!CALC_SECTIONS.includes(sec) || !Number.isFinite(idx)) return;
    const cfg = this._collectFormCfg();
    if (!Array.isArray(cfg.calculations?.[sec])) return;
    cfg.calculations[sec].splice(idx, 1);
    await saveSettings(cfg);
    this.render();
  }

  static async _onAddCalcPart(event, target) {
    const sec = target.dataset.section;
    const idx = Number(target.dataset.index);
    if (!CALC_SECTIONS.includes(sec) || !Number.isFinite(idx)) return;
    const cfg = this._collectFormCfg();
    const entry = cfg.calculations?.[sec]?.[idx];
    if (!entry) return;
    if (!Array.isArray(entry.parts)) entry.parts = [];
    entry.parts.push({ op: "+", path: "" });
    await saveSettings(cfg);
    this.render();
  }

  static async _onRemoveCalcPart(event, target) {
    const sec = target.dataset.section;
    const idx = Number(target.dataset.index);
    const pIdx = Number(target.dataset.partIndex);
    if (!CALC_SECTIONS.includes(sec) || !Number.isFinite(idx) || !Number.isFinite(pIdx)) return;
    const cfg = this._collectFormCfg();
    const entry = cfg.calculations?.[sec]?.[idx];
    if (!entry || !Array.isArray(entry.parts)) return;
    entry.parts.splice(pIdx, 1);
    await saveSettings(cfg);
    this.render();
  }

  static async _onEditCalcGraph(event, target) {
    const sec = target.dataset.section;
    const idx = Number(target.dataset.index);
    if (!CALC_SECTIONS.includes(sec) || !Number.isFinite(idx)) return;
    const cfg   = this._collectFormCfg();
    const entry = cfg.calculations?.[sec]?.[idx];
    if (!entry) return;
    let FormulaGraph;
    try {
      ({ FormulaGraph } = await import("../builder/formula-graph.mjs"));
    } catch(e) {
      console.warn("SD | Failed to load FormulaGraph", e);
      ui.notifications?.error?.("Could not open graph editor (see console).");
      return;
    }
    const app = this;
    const graph = new FormulaGraph(null, null, null, null, null, {
      customLoad: () => entry.graphData ?? null,
      customSave: async (data, compiled) => {
        const fresh   = app._collectFormCfg();
        const target2 = fresh.calculations?.[sec]?.[idx];
        if (target2) {
          target2.graphData       = data;
          target2.compiledFormula = compiled;
          target2.useGraph        = true;
          await saveSettings(fresh);
          applySettings(fresh);
          app.render();
          ui.notifications?.info?.(`Graph saved for ${sec}.${target2.key}`);
        }
      }
    });
    graph.open();
  }

  static async _onSaveAndClose(event, target) {
    const cfg = this._collectFormCfg();

    const initFormula  = cfg.__initiativeFormula;
    const initUseGraph = cfg.__initiativeUseGraph;
    delete cfg.__initiativeFormula;
    delete cfg.__initiativeUseGraph;

    await saveSettings(cfg);

    try {
      if (typeof initFormula === "string") {
        await game.settings.set("sd", "initiativeFormula", initFormula || "1d20");
      }
      await game.settings.set("sd", "initiativeUseGraph", !!initUseGraph);
    } catch(e) {
      console.warn("SD | Could not save initiative settings:", e);
    }

    applySettings(cfg);

    ui.notifications.info(game.i18n.localize("SD.Settings.Saved"));
    this.close();
  }

  static async _onEditInitiativeGraph(event, target) {
    let FormulaGraph;
    try {
      ({ FormulaGraph } = await import("../builder/formula-graph.mjs"));
    } catch(e) {
      console.warn("SD | Failed to load FormulaGraph", e);
      ui.notifications?.error?.("Could not open graph editor (see console).");
      return;
    }

    try {
      const cfg = this._collectFormCfg();
      const before = await game.settings.get("sd", "initiativeUseGraph").catch(() => false);
      delete cfg.__initiativeFormula;
      delete cfg.__initiativeUseGraph;
      await saveSettings(cfg);
      void before;
    } catch(e) {
      console.warn("SD | Could not persist form before opening initiative graph", e);
    }

    const app = this;
    const graph = new FormulaGraph(null, null, null, null, null, {
      mode: "initiative",
      customLoad: () => {
        try {
          const g = game.settings.get("sd", "initiativeGraph");
          return g ?? null;
        } catch { return null; }
      },
      customSave: async (data, compiled) => {
        try {
          await game.settings.set("sd", "initiativeGraph", data);
          await game.settings.set("sd", "initiativeGraphCompiled", String(compiled ?? ""));
          await game.settings.set("sd", "initiativeUseGraph", true);
          if (CONFIG?.Combat?.initiative) CONFIG.Combat.initiative.formula = String(compiled ?? "1d20") || "1d20";
          if (game.system) game.system.initiative = String(compiled ?? "1d20") || "1d20";
          ui.notifications?.info?.(game.i18n.localize("SD.Settings.InitiativeGraphSaved"));
          app.render();
        } catch(e) {
          console.warn("SD | Could not save initiative graph", e);
          ui.notifications?.error?.("Could not save initiative graph (see console).");
        }
      }
    });
    graph.open();
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
