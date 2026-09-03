/**
 * Event plumbing between UI Widget windows and System Director node graphs.
 *
 * Three things happen when an element fires:
 *
 *   1. the element's own graph (compiled action JSON stored in
 *      `element.events.<name>.formula`) runs through `ButtonExecutor._runAction`,
 *      exactly like a sheet widget button does;
 *   2. a `sdUiWidgetEvent` Foundry hook is emitted, so `On UI Widget Event`
 *      nodes living in *other* graphs (actor sheets, items, world items) can
 *      react through the system's own event bus;
 *   3. `sdCustomEvent` is emitted as well, for backwards compatibility with
 *      graphs built against the previous module version.
 *
 * Graph pins read event data through the `{sdUiWidget:ctx:<pin>}` token, which
 * resolves against the context of the event currently being executed.
 */

import { MODULE_ID } from "./ui-widget-const.mjs";

const _ctxStack = [];

export function currentEventContext() {
  return _ctxStack[_ctxStack.length - 1] ?? null;
}

/** Resolve one `ctx:<pin>` token for the running event. */
export function resolveEventPin(pin) {
  const ctx = currentEventContext();
  if (!ctx) return "";
  switch (pin) {
    case "instance": return ctx.instanceId ?? "";
    case "widgetKey": return ctx.widgetKey ?? "";
    case "element": return ctx.element ?? "";
    case "event": return ctx.event ?? "";
    case "value": return ctx.value ?? "";
    case "number": {
      const n = Number(ctx.value);
      return Number.isFinite(n) ? n : 0;
    }
    case "bool": {
      const v = ctx.value;
      if (typeof v === "boolean") return v ? 1 : 0;
      const n = Number(v);
      if (Number.isFinite(n)) return n !== 0 ? 1 : 0;
      return ["1", "true", "yes", "on"].includes(String(v ?? "").toLowerCase()) ? 1 : 0;
    }
    case "index": return ctx.index ?? 0;
    case "actor": return ctx.actor?.uuid ?? "";
    case "item": return ctx.item?.uuid ?? "";
    case "user": return ctx.userId ?? game.user?.id ?? "";
    default: {
      if (String(pin ?? "").startsWith("param:")) {
        const key = String(pin).slice(6);
        const payload = ctx.payload ?? ctx.value;
        return payload && typeof payload === "object" ? (payload[key] ?? "") : "";
      }
      return "";
    }
  }
}

/**
 * Parse a compiled graph payload into a runnable action array.
 * Accepts the three shapes the system produces: a bare action array, a
 * `{_trigger:"onClick"}` object and a `{_trigger:"multi"}` object.
 */
export function parseActionPayload(raw, eventKey = "onClick", eventContext = null) {
  if (typeof raw !== "string") return { actions: [], macros: null, formula: "" };
  const trimmed = raw.trim();
  if (!trimmed) return { actions: [], macros: null, formula: "" };
  if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) return { actions: [], macros: null, formula: trimmed };
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return { actions: parsed, macros: null, formula: "" };
    const macros = parsed?._macros ?? null;
    if (parsed?._trigger === "onClick") return { actions: parsed.actions ?? [], macros, formula: "" };
    if (parsed?._trigger === "multi") {
      const direct = parsed._events?.[eventKey] ?? parsed[eventKey] ?? [];
      const actions = Array.isArray(direct) ? [...direct] : (Array.isArray(direct?.actions) ? [...direct.actions] : []);
      const normalizedEvent = String(eventKey ?? "").replace(/^on/, "").toLowerCase();
      for (const [entryKey, slot] of Object.entries(parsed._events ?? {})) {
        if (!slot || Array.isArray(slot) || !Array.isArray(slot.actions)) continue;
        const type = entryKey.split("::")[0];
        const data = slot.data ?? {};
        const blueprintId = String(eventContext?.blueprintId ?? "");
        if (data.blueprintId && blueprintId && String(data.blueprintId) !== blueprintId) continue;
        let match = false;
        if (type === "ui_blueprint_event") {
          match = String(data.event ?? "open").toLowerCase() === normalizedEvent;
        } else if (type === "ui_widget_event") {
          const widgetId = String(eventContext?.widgetId ?? "");
          match = !!widgetId
            && String(data.widgetId ?? "") === widgetId
            && String(data.event ?? "click").replace(/^on/, "").toLowerCase() === normalizedEvent;
        } else if (type === "ui_custom_event_entry") {
          const id = String(eventContext?.eventId ?? eventKey ?? "");
          match = String(data.eventId ?? data.name ?? "") === id;
        }
        if (match) actions.push(...slot.actions);
      }
      return { actions, macros, formula: "" };
    }
  } catch { /* not JSON — treat as a roll formula */ }
  return { actions: [], macros: null, formula: trimmed };
}

/** Run a compiled action array with the SD executor. */
export async function runActions(actions, { actor = null, item = null, label = "", macros = null, runtime = {} } = {}) {
  if (!Array.isArray(actions) || !actions.length) return;
  const { ButtonExecutor } = await import("/systems/sd/module/helpers/button-executor.mjs");
  const buttonDef = { label, __macros: macros };
  const itemCtx = item ?? { system: {}, actor };
  let result;
  for (const action of actions) {
    try { result = await ButtonExecutor._runAction(action, itemCtx, actor, buttonDef, runtime); }
    catch (err) {
      console.error(`${MODULE_ID} | action failed:`, action, err);
      if (action?.stopOnError !== false) throw err;
    }
  }
  return runtime.__returnValue ?? runtime.__lastUiFunction ?? result;
}

/** Roll a plain formula (non-graph payload). */
export async function runRollFormula(formula, { actor = null, doc = null, flavor = "" } = {}) {
  try {
    const { FormulaEngine } = await import("/systems/sd/module/helpers/formula-engine.mjs");
    const resolved = FormulaEngine.resolveForRoll(formula, doc ?? actor ?? {});
    const roll = new Roll(resolved, actor?.getRollData?.() ?? {});
    await roll.evaluate();
    await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor });
  } catch (err) {
    console.error(`${MODULE_ID} | roll failed for "${formula}":`, err);
    ui.notifications?.error?.(`Roll failed: ${formula}`);
  }
}

/**
 * Fire one element event.
 *
 * @param {object} options
 * @param {object} options.element     element record
 * @param {string} options.event       "click" | "change" | "submit" | "open" | "close" | "tick" | "finished" | "hover"
 * @param {*}      options.value       current element value
 * @param {object} options.instance    { id, widgetKey, item, state, actor }
 */
export async function fireElementEvent({ element, event, value, index = 0, instance }) {
  const eventKey = `on${event.charAt(0).toUpperCase()}${event.slice(1)}`;
  const ctx = {
    instanceId: instance?.id ?? "",
    widgetKey: instance?.widgetKey ?? "",
    element: element?.name ?? "",
    elementId: element?.id ?? "",
    event,
    value,
    payload: value,
    index,
    actor: instance?.actor ?? null,
    item: instance?.contextItem ?? null,
    userId: game.user?.id ?? ""
  };

  // (2)+(3) — let graphs elsewhere react. Hooks are synchronous, so do them first.
  try { Hooks.callAll("sdUiWidgetEvent", { ...ctx, item: instance?.item ?? null }); }
  catch (err) { console.warn(`${MODULE_ID} | sdUiWidgetEvent hook failed:`, err); }
  try {
    Hooks.callAll("sdCustomEvent", {
      name: `${element?.id ?? ""}:${event}`,
      scope: "actor",
      actorId: instance?.actor?.id ?? "",
      sourceUuid: instance?.contextItem?.uuid ?? instance?.item?.uuid ?? "",
      payload: value ?? "",
      blueprintId: instance?.widgetKey ?? "",
      instanceId: instance?.id ?? "",
      widgetId: element?.id ?? "",
      widgetEvent: event
    });
  } catch { /* ignore */ }

  // (1) — the unified Blueprint graph and legacy per-element graph.
  const raw = element?.events?.[eventKey]?.formula ?? "";
  const { actions, macros, formula } = parseActionPayload(raw, eventKey);

  _ctxStack.push(ctx);
  try {
    await instance?.app?._runBlueprintGraph?.(event, value, {
      widgetId: element?.id ?? "",
      widgetEvent: event
    });
    if (!actions.length && !formula) return;
    const runtime = {
      __vars: {
        __uiInstance: ctx.instanceId,
        __uiElement: ctx.element,
        __uiValue: value ?? "",
        __uiEvent: event,
        __uiIndex: index
      }
    };
    if (actions.length) {
      await runActions(actions, {
        actor: instance?.actor ?? null,
        item: instance?.contextItem ?? null,
        label: element?.props?.text ?? element?.name ?? "",
        macros,
        runtime
      });
    } else if (formula) {
      await runRollFormula(formula, { actor: instance?.actor ?? null, doc: instance?.state?.buildContext?.() ?? null });
    }
  } finally {
    _ctxStack.pop();
  }
}
