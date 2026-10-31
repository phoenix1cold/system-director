import { sdFlags } from "../helpers/document-flags.mjs";
import { normalizeQuickActions, compileQuickActions } from "./quick-actions.mjs";
import { buildEasyButtonFormula } from "./easy-button-wizard.mjs";
import { collectSheetWidgets } from "../helpers/sheet-widget-events.mjs";

const clone = value => {
  try { return foundry.utils.deepClone(value); }
  catch { return JSON.parse(JSON.stringify(value ?? null)); }
};

/** Quick-group markers that keep nodes under Quick Actions management. */
// __quickSource also controls click ownership and change/any event semantics.
// Keep it on detached event nodes; only management markers are removed.
const QUICK_MARKERS = ["__quickGroup", "__quickSignature", "__quickRollMode"];

/** Advanced roll features a bare formula cannot carry into a plain button. */
function easyButtonNeedsActionArray(widget) {
  return !!(widget.rollDialogue || widget.rollComposer || widget.advFormula || widget.disFormula
    || widget.rollOptionals?.length || widget.rollPresets || (String(widget.rollMode ?? "default") !== "default"));
}

/** Does the widget's Quick Actions own its click (the Easy Button roll stays for other events)? */
function quickOwnsClick(widget) {
  const quick = normalizeQuickActions(widget?.quickActions);
  return !!(quick.steps.length && ["click", "any"].includes(quick.event));
}

/** The roll/composer steps the graph builder derives from one Easy Button. */
export function easyButtonSteps(widget) {
  const steps = [{
    kind: "roll",
    formula: buildEasyButtonFormula({ ...widget, easyMode: widget.easyMode === "formula" ? "formula" : "constructor" }),
    label: widget.flavor || widget.label,
    advFormula: widget.advFormula ?? "",
    disFormula: widget.disFormula ?? "",
    dialog: !!widget.rollDialogue,
    rollOptionals: widget.rollOptionals ?? [],
    rollMode: widget.rollMode ?? "default",
    rollPresets: widget.rollPresets ?? null
  }];
  if (widget.rollComposer) {
    steps.push({
      kind: "composer",
      title: widget.composerTitle || widget.label,
      message: widget.composerMessage ?? "",
      includeRoll: true,
      visibility: widget.rollMode === "selfroll" ? "self" : ["gmroll", "blindroll"].includes(widget.rollMode) ? "gm" : "public"
    });
  }
  return steps;
}

/** Regular button widget replacing one Easy Button; null when the widget is not an Easy Button. */
export function easyButtonToRegularButton(widget) {
  if (String(widget?.type) !== "easyButton") return null;
  const button = clone(widget);
  button.type = "button";
  if (quickOwnsClick(widget)) {
    // The detached graph owns the click; a formula would fire a second time.
    button.formula = "";
  } else if (String(widget.easyMode) === "actions" || easyButtonNeedsActionArray(widget)) {
    const steps = String(widget.easyMode) === "actions"
      ? normalizeQuickActions({ steps: widget.actionSteps }).steps
      : easyButtonSteps(widget);
    button.formula = JSON.stringify(compileQuickActions(steps, { label: String(widget.label ?? "") }));
  } else {
    button.formula = buildEasyButtonFormula(widget);
  }
  button.flavor = widget.flavor || widget.label;
  for (const key of ["easyMode", "diceTerms", "variableTerms", "widgetTerms", "actionSteps", "rollPresets",
    "advFormula", "disFormula", "rollDialogue", "rollOptionals", "rollComposer", "composerTitle", "composerMessage", "quickActions"]) {
    delete button[key];
  }
  return button;
}

/** True when the document still carries Easy Buttons or Quick Action configs. */
export function documentHasConvertibleEasyWidgets(doc) {
  return collectSheetWidgets(doc).some(widget =>
    String(widget?.type) === "easyButton"
    || normalizeQuickActions(widget?.quickActions).steps.length > 0);
}

/** Materialise Quick Action groups, then detach them from quick-group management. */
async function materializeAndDetachQuickGroups(doc) {
  const { FormulaGraph } = await import("./formula-graph.mjs");
  // The constructor already materializes groups. A second materialization is
  // normally a no-op, even when the new graph has never been persisted.
  const graph = new FormulaGraph(null, doc, null, null, null, { mode: "sheetTrigger" });
  const groups = new Set();
  for (const widget of collectSheetWidgets(doc)) {
    const owner = String(widget.id || widget.widgetKey || "");
    if (!owner) continue;
    if (normalizeQuickActions(widget.quickActions).steps.length) groups.add(`${owner}:quick`);
    if (widget.type === "easyButton") groups.add(`${owner}:roll`);
  }
  const detached = graph.nodes.filter(node => groups.has(node.data?.__quickGroup));
  if (!detached.length && !graph._quickGraphChanged) return false;
  // Only detach converted widgets. Ordinary dice groups must remain managed.
  for (const node of detached) {
    for (const key of QUICK_MARKERS) delete node.data[key];
  }
  await graph._saveGraph();
  return true;
}

/**
 * Convert one document: Easy Buttons become regular buttons, Quick Actions
 * become ordinary nodes in the Sheet Blueprint. Behaviour is preserved by
 * compiling to the same executor actions; conversion is idempotent.
 */
export async function convertDocumentEasyWidgets(doc) {
  if (!doc?.system?.customTabs?.length) return { buttons: 0, graphs: 0 };
  let graphs = 0;
  if (documentHasConvertibleEasyWidgets(doc)) {
    // Materialise while the quick configs still exist.
    if (await materializeAndDetachQuickGroups(doc)) graphs = 1;
  }
  const tabs = clone(doc.system.customTabs);
  let buttons = 0;
  const convert = widget => {
    const button = easyButtonToRegularButton(widget);
    if (button) {
      // A persisted detached roll graph owns this click as well as Quick Actions.
      // Do not also execute the converted button's formula on the same click.
      const owner = String(widget.id || widget.widgetKey || "");
      if (doc.system.sdTriggerGraph?._graphData?.nodes?.some(node =>
        node.type === "sheet_widget_event" && String(node.data?.widgetId || node.data?.key || "") === owner
        && ["roll", "quick"].includes(node.data?.__quickSource)
        && ["click", "any"].includes(node.data?.event))) button.formula = "";
      buttons++;
      return button;
    }
    if (widget?.quickActions) {
      const copy = clone(widget);
      delete copy.quickActions;
      return copy;
    }
    return widget;
  };
  const apply = list => {
    for (let index = 0; index < (list ?? []).length; index++) {
      const next = convert(list[index]);
      if (next && next !== list[index]) list[index] = next;
      apply(list[index]?.widgets);
      for (const element of list[index]?.elements ?? []) {
        if (!element?.widget) continue;
        const embedded = [element.widget];
        apply(embedded);
        element.widget = embedded[0];
      }
    }
  };
  for (const tab of tabs) for (const row of tab.rows ?? []) apply(row.widgets);
  await doc.update({ "system.customTabs": tabs });
  return { buttons, graphs };
}

/**
 * Compatibility hook retained for sheet callers; form editors are supported
 * in both systems, so migration is now an explicit user operation only.
 */
export async function maybeOfferEasyWidgetMigration(_doc) {
  // Form-based behaviour is now supported in both systems. Explicit conversion
  // remains available, but opening a sheet must not strip editable Quick Actions.
}
