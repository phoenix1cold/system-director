import { normalizeRollPresets, buildRollPresetFormula } from "./roll-presets.mjs";
import { normalizeRollOptionals } from "../helpers/roll-optionals.mjs";
import { valueStoragePath } from "../helpers/value-database.mjs";
import { uniqueWidgetKey } from "./widget-identity.mjs";
import { compileQuickActions, normalizeQuickActions, openQuickActionsEditor } from "./quick-actions.mjs";

const esc = value => String(value ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const clone = value => {
  try { return foundry.utils.deepClone(value); }
  catch { return JSON.parse(JSON.stringify(value ?? {})); }
};

const positiveInt = (value, fallback, max = 100000) => {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) ? Math.max(1, Math.min(max, number)) : fallback;
};

const operator = value => String(value ?? "+") === "-" ? "-" : "+";

export function normalizeEasyButtonConfig(source = {}) {
  const mode = source.easyMode === "formula" ? "formula" : source.easyMode === "actions" ? "actions" : "constructor";
  const actionSteps = normalizeQuickActions({ steps: source.actionSteps }).steps;
  const diceTerms = (Array.isArray(source.diceTerms) ? source.diceTerms : [])
    .map(term => ({ count: positiveInt(term?.count, 1, 999), sides: Math.max(2, positiveInt(term?.sides, 20)), ...(term?.keep && term.keep !== "all" ? { keep:term.keep, keepCount:term.keepCount ?? 1 } : {}) }));
  const variableTerms = (Array.isArray(source.variableTerms) ? source.variableTerms : [])
    .map(term => ({ operator: operator(term?.operator), variableId: String(term?.variableId ?? "").trim() }))
    .filter(term => term.variableId);
  const widgetTerms = (Array.isArray(source.widgetTerms) ? source.widgetTerms : [])
    .map(term => ({ operator: operator(term?.operator), widgetKey: String(term?.widgetKey ?? "").trim() }))
    .filter(term => term.widgetKey);
  return {
    ...source,
    type: source.type === "button" ? "button" : "easyButton",
    easyMode: mode,
    customFormula: String(source.customFormula ?? source.formula ?? "1d20").trim() || "1d20",
    diceTerms: diceTerms.length ? diceTerms : [{ count: 1, sides: 20 }],
    variableTerms,
    widgetTerms,
    actionSteps,
    rollPresets:source.rollPresets?.normal && !Array.isArray(source.rollPresets) ? normalizeRollPresets(source.rollPresets) : null,
    advFormula:String(source.advFormula ?? ""), disFormula:String(source.disFormula ?? ""),
    rollOptionals:normalizeRollOptionals(source.rollOptionals),
    rollDialogue:source.rollDialogue === true || source.rollDialogue === "yes",
    rollMode:String(source.rollMode ?? "default"),
    rollComposer:source.rollComposer === true,
    composerTitle:String(source.composerTitle ?? source.label ?? "Roll"), composerMessage:String(source.composerMessage ?? "")
  };
}

/** Compile the visual constructor into a normal Foundry roll formula. */
export function buildEasyButtonFormula(source = {}) {
  const state = normalizeEasyButtonConfig(source);
  // Actions mode: the button runs a compiled executor action list instead of a roll.
  if (state.easyMode === "actions") return JSON.stringify(compileQuickActions(state.actionSteps, { label: String(state.label ?? "") }));
  if (state.rollPresets) return buildRollPresetFormula(state.rollPresets.normal);
  if (state.easyMode === "formula") return state.customFormula || "1d20";
  const parts = state.diceTerms.map((term, index) => `${index ? "+ " : ""}${term.count}d${term.sides}${term.keep && term.keep !== "all" ? `${term.keep === "highest" ? "kh" : "kl"}${term.keepCount || 1}` : ""}`);
  for (const term of state.variableTerms) {
    parts.push(`${term.operator} {${term.variableId.startsWith("sdvar:") ? `dbvalue:self|${term.variableId}|` : valueStoragePath(term.variableId)}}`);
  }
  for (const term of state.widgetTerms) parts.push(`${term.operator} {widget:${term.widgetKey}}`);
  return parts.join(" ") || "1d20";
}

/** Preserve legacy data until the user saves the Quick Actions editor. */
export function buttonQuickActions(widget = {}) {
  if (Array.isArray(widget.quickActions?.steps)) return normalizeQuickActions(widget.quickActions);
  if (widget.easyMode === "actions") return normalizeQuickActions({steps:widget.actionSteps});
  const formula = widget.easyMode && widget.easyMode !== "formula" ? buildEasyButtonFormula(widget) : String(widget.formula ?? widget.customFormula ?? "");
  if (!formula.trim()) return normalizeQuickActions({steps:[]});
  try {
    if (Array.isArray(JSON.parse(formula))) return normalizeQuickActions({steps:[{kind:"legacyActions",actions:formula}]});
  } catch { /* Ordinary formulas are not JSON. */ }
  const steps = [{kind:"roll",formula,label:widget.flavor || widget.label,advFormula:widget.advFormula,
    disFormula:widget.disFormula,dialog:widget.rollDialogue,rollOptionals:widget.rollOptionals,
    rollMode:widget.rollMode,rollPresets:widget.rollPresets}];
  if (widget.rollComposer) steps.push({kind:"composer",title:widget.composerTitle || widget.label,
    message:widget.composerMessage,includeRoll:true,
    visibility:widget.rollMode === "selfroll" ? "self" : ["gmroll","blindroll"].includes(widget.rollMode) ? "gm" : "public"});
  return normalizeQuickActions({steps});
}

export function applyButtonQuickActions(widget, config) {
  const quickActions=normalizeQuickActions(config);
  // A persisted event owns execution; do not also execute the old formula.
  return {...clone(widget),type:"button",quickActions,formula:"",customFormula:"",
    easyMode:"actions",actionSteps:quickActions.steps};
}

/** Compatibility entry point used by existing creation paths. */
export async function openEasyButtonWizard(widget = {}, doc = null, options = {}) {
  const seed=clone(widget);
  seed.label=String(seed.label || "Button");
  seed.widgetKey ||= uniqueWidgetKey(seed.label,options.tabs ?? doc?.system?.customTabs ?? [],seed.id);
  const edited=await openQuickActionsEditor(buttonQuickActions(seed),doc,{
    title:`${seed.label} — Quick Actions`,label:seed.label,id:seed.id,showEvent:false
  });
  return edited ? applyButtonQuickActions(seed,edited) : null;
}
