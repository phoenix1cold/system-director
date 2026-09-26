/**
 * Ordinary sheet widget events.
 *
 * Widgets placed with Sheet Builder (buttons, fields, meters, toggles...) emit
 * an event whenever the player interacts with them. The document's own common
 * Sheet Blueprint must react immediately and locally, without depending on the
 * global event bus registry being fresh, because graph saves are performed with
 * `sdSkipEventBus: true`.
 *
 * `emitSheetWidgetEvent()`:
 *   1. tags the payload with the owning document uuid,
 *   2. broadcasts `sdSheetWidgetEvent` so other documents / modules can react,
 *   3. runs the owning document's Sheet Blueprint directly.
 *
 * The event bus skips entries whose `docUuid` equals the tag, so nothing runs
 * twice.
 */

export const SHEET_WIDGET_GRAPH_OWNER_KEY = "__sdSheetGraphOwner";

const HOOK = "sdSheetWidgetEvent";

function parseGraph(graph) {
  if (!graph) return null;
  if (typeof graph === "string") {
    try {
      return JSON.parse(graph);
    } catch {
      return null;
    }
  }
  return typeof graph === "object" ? graph : null;
}

/** All compiled `On Sheet Widget Event` entries stored on a document. */
export function sheetWidgetGraphEvents(doc) {
  const graph = parseGraph(doc?.system?.sdTriggerGraph);
  const events = graph?._events;
  if (!events || typeof events !== "object") return [];
  const out = [];
  for (const [key, entry] of Object.entries(events)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    if (String(entry.hook ?? "") !== HOOK) continue;
    const actions = Array.isArray(entry.actions) ? entry.actions : [];
    if (!actions.length) continue;
    out.push({ key, data: entry.data ?? {}, actions, macros: graph?._macros ?? null });
  }
  return out;
}

/**
 * Normalise a widget identifier so that a key, an id and a human label all
 * compare equal ("Number Value" === "number_value").
 */
function normId(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s\-.]+/g, "_");
}

/** Does a compiled event definition accept this payload? */
export function matchesSheetWidgetEvent(data, payload) {
  const wantedWidget = normId(data?.key ?? data?.widgetKey ?? data?.widgetId ?? "");
  if (wantedWidget) {
    // The picker stores a widget key, but graphs saved by hand (or older
    // graphs) may hold the widget id or its visible label instead.
    const candidates = [payload?.widgetKey, payload?.widgetId, payload?.widgetLabel]
      .map(normId)
      .filter(Boolean);
    if (!candidates.includes(wantedWidget)) return false;
  }
  const wantedElement = normId(data?.elementKey ?? "");
  if (wantedElement && wantedElement !== normId(payload?.elementKey)) return false;
  const wantedEvent = normId(data?.event ?? "click") || "click";
  // "any" subscribes to every interaction of the widget.
  if (wantedEvent === "any" || wantedEvent === "*") return true;
  const actualEvent = normId(payload?.event ?? "click") || "click";
  if(wantedEvent==="update"&&actualEvent==="change")return true;
  return wantedEvent === actualEvent;
}

function buildRuntime(doc, payload) {
  return {
    ...Object.fromEntries(Object.entries(payload?.cardRuntime ?? {}).filter(([key, value]) => key.startsWith("__cardClicked") && ["string", "number", "boolean"].includes(typeof value))),
    __sheetWidgetValue: payload?.value ?? "",
    __sheetWidgetKey: String(payload?.widgetKey ?? ""),
    __sheetWidgetId: String(payload?.widgetId ?? ""),
    __sheetWidgetElementKey: String(payload?.elementKey ?? ""),
    __sheetWidgetEvent: String(payload?.event ?? "click").toLowerCase(),
    __sheetWidgetDocumentUuid: String(payload?.documentUuid ?? doc?.uuid ?? "")
  };
}

/**
 * Run the document's own Sheet Blueprint for a widget event.
 * @returns {Promise<number>} how many graph events fired.
 */
export async function runSheetWidgetGraph(doc, payload = {}) {
  if (!doc) return 0;
  const entries = sheetWidgetGraphEvents(doc).filter(entry => matchesSheetWidgetEvent(entry.data, payload));
  if (!entries.length) return 0;

  let ButtonExecutor = null;
  try {
    const module = await import("./button-executor.mjs");
    ButtonExecutor = module.ButtonExecutor ?? module.default ?? null;
  } catch (error) {
    console.error("SD | unable to load the button executor", error);
    return 0;
  }
  if (!ButtonExecutor?._runAction) return 0;

  const isItem = String(doc.documentName ?? "") === "Item";
  const itemCtx = isItem ? doc : null;
  const actor = isItem ? doc.actor ?? null : doc;
  const runtime = buildRuntime(doc, payload);

  let fired = 0;
  for (const entry of entries) {
    const btnDef = {
      label: `Sheet Widget · ${runtime.__sheetWidgetKey || runtime.__sheetWidgetId || "widget"}`,
      __eventRuntime: runtime,
      __macros: entry.macros
    };
    try {
      const executionRuntime = { ...runtime };
      for (const action of entry.actions) {
        await ButtonExecutor._runAction(action, itemCtx, actor, btnDef, executionRuntime);
      }
      fired += 1;
    } catch (error) {
      console.error(`SD | Sheet Blueprint event "${entry.key}" failed`, error);
      ui.notifications?.error?.(`Sheet Blueprint: ${error?.message ?? error}`);
    }
  }
  return fired;
}

/** Broadcast a widget event and run the owning document's Sheet Blueprint. */
export async function emitSheetWidgetEvent(doc, payload = {}) {
  const full = { ...payload, [SHEET_WIDGET_GRAPH_OWNER_KEY]: String(doc?.uuid ?? "") };
  if(payload.event === "hover") {
    const {runHoverGraph}=await import("./hover-events.mjs");
    await runHoverGraph(doc,{...payload,objectUuid:doc?.uuid});
  }
  try {
    Hooks.callAll(HOOK, full);
  } catch (error) {
    console.warn(`SD | ${HOOK} listeners failed`, error);
  }
  const fired = await runSheetWidgetGraph(doc, full);
  const quick = await runWidgetQuickActions(doc, full);
  return fired + quick;
}

/** Find every Sheet Builder widget of a document (tabs, nested vsections, Widget Builder elements). */
export function collectSheetWidgets(doc) {
  const result = [];
  const seen = new Set();
  const walk = widgets => {
    for (const widget of widgets ?? []) {
      if (!widget || typeof widget !== "object" || seen.has(widget)) continue;
      seen.add(widget);
      result.push(widget);
      walk(widget.widgets);
      walk((widget.elements ?? []).map(element => element?.widget).filter(Boolean));
    }
  };
  for (const tab of doc?.system?.customTabs ?? []) for (const row of tab.rows ?? []) walk(row.widgets);
  return result;
}

function quickActionsMatch(config, payload) {
  const wanted = normId(config?.event ?? "click") || "click";
  const actual = normId(payload?.event ?? "click") || "click";
  if (wanted === "any") return actual !== "hover" && actual !== "leave" && actual !== "input";
  if (wanted === "change" && actual === "update") return true;
  return wanted === actual;
}

/**
 * Run the widget's own Quick Actions (configured in the widget popup, no graph).
 * Easy Button / Button widgets whose click is already handled by their own
 * button handler are skipped for the "click" event so nothing runs twice.
 * @returns {Promise<number>} 1 when a step list ran, otherwise 0.
 */
export async function runWidgetQuickActions(doc, payload = {}) {
  if (!doc) return 0;
  const key = normId(payload?.widgetKey), id = normId(payload?.widgetId);
  const widget = collectSheetWidgets(doc).find(w => {
    const steps = w?.quickActions?.steps;
    if (!Array.isArray(steps) || !steps.length) return false;
    return (key && normId(w.widgetKey) === key) || (id && normId(w.id) === id);
  });
  if (!widget || !quickActionsMatch(widget.quickActions, payload)) return 0;
  const eventName = normId(payload?.event ?? "click") || "click";
  if (eventName === "click" && ["button", "easyButton", "dice"].includes(String(widget.type)) && String(widget.formula ?? "").trim()) return 0;

  let ButtonExecutor = null, compileQuickActions = null;
  try {
    ({ ButtonExecutor } = await import("./button-executor.mjs"));
    ({ compileQuickActions } = await import("../builder/quick-actions.mjs"));
  } catch (error) {
    console.error("SD | unable to load quick actions runtime", error);
    return 0;
  }
  const actions = compileQuickActions(widget.quickActions.steps, { label: String(widget.label ?? "") });
  if (!actions.length) return 0;
  const isItem = String(doc.documentName ?? "") === "Item";
  const itemCtx = isItem ? doc : null;
  const actor = isItem ? doc.actor ?? null : doc;
  const runtime = buildRuntime(doc, payload);
  const btnDef = { label: String(widget.label ?? widget.widgetKey ?? "Widget"), __eventRuntime: runtime };
  try {
    for (const action of actions) await ButtonExecutor._runAction(action, itemCtx, actor, btnDef, runtime);
  } catch (error) {
    console.error(`SD | Quick actions of widget "${widget.widgetKey ?? widget.id}" failed`, error);
    ui.notifications?.error?.(`Quick actions: ${error?.message ?? error}`);
  }
  return 1;
}
