/**
 * SDUIWidgetApp — the runtime window for a UI Widget asset.
 *
 * Layout modes:
 *   window                      a normal ApplicationV2 window
 *   fullscreen                  full-viewport overlay
 *   dock-left/right/top/bottom  panel pinned to a screen edge
 *
 * The window owns a `UIWidgetState` (runtime values) and a `UIWidgetTree`
 * (DOM). It never writes runtime values back into the widget Item, except for
 * variables explicitly declared as `shared`.
 */

import { MODULE_ID } from "./ui-widget-const.mjs";
import { UIWidgetState } from "./ui-widget-state.mjs";
import { UIWidgetTree } from "./ui-widget-runtime.mjs";
import { registerInstance, unregisterInstance, emitEvent } from "./ui-widget-registry.mjs";
import { fireElementEvent, parseActionPayload, runActions } from "./ui-widget-events.mjs";
import { subscribeDocument, subscribeEffects, subscribeViewport } from "./ui-widget-subscriptions.mjs";

const { ApplicationV2 } = foundry.applications.api;

const OVERLAY_LAYOUTS = new Set(["fullscreen", "dock-left", "dock-right", "dock-top", "dock-bottom"]);

export class SDUIWidgetApp extends ApplicationV2 {

  static DEFAULT_OPTIONS = {
    classes: ["sd", "sd-ui-widget-app"],
    window: { title: "UI Widget", icon: "fa-solid fa-window-restore", resizable: true, minimizable: true },
    position: { width: 720, height: 520 }
  };

  constructor({ widgetItem, actor = null, item = null, layoutOverride = "", vars = {}, title = "" } = {}) {
    const layout = layoutOverride || widgetItem.system.layout || "window";
    const windowed = layout === "window";
    super({
      id: `sd-ui-widget-${widgetItem.id}-${foundry.utils.randomID(6)}`,
      classes: ["sd", "sd-ui-widget-app", `sd-ui-widget-layout-${layout}`],
      window: {
        title: title || widgetItem.system.title || widgetItem.name || "UI Widget",
        icon: "fa-solid fa-window-restore",
        resizable: windowed,
        minimizable: windowed,
        frame: layout !== "fullscreen"
      },
      position: { width: widgetItem.system.size?.w ?? 720, height: widgetItem.system.size?.h ?? 520 }
    });

    this.widgetItem = widgetItem;
    this.actor = actor;
    this.contextItem = item;
    this.layoutMode = layout;
    this.instanceId = `inst-${foundry.utils.randomID(10)}`;
    // NB: not `this.state` — ApplicationV2 exposes `state` as a read-only
    // getter for its render lifecycle, so assigning it throws.
    this.widgetState = new UIWidgetState(widgetItem, { actor, item, initial: vars });
    this.tree = new UIWidgetTree({
      item: widgetItem,
      state: this.widgetState,
      editMode: false,
      instance: { id: this.instanceId, widgetKey: this.widgetState.widgetKey, app: this }
    });

    this._subscriptions = [];
    this._unsubscribeState = this.widgetState.onChange(() => this.refresh());

    registerInstance({
      id: this.instanceId,
      widgetKey: this.widgetState.widgetKey,
      actor,
      item,
      app: this,
      state: this.widgetState
    });
  }

  get widgetKey() { return this.widgetState.widgetKey; }

  // ------------------------------------------------------------------
  // Rendering
  // ------------------------------------------------------------------

  async _prepareContext(options) {
    await this.tree.prepare();
    return super._prepareContext?.(options) ?? {};
  }

  async _renderHTML() {
    const shell = document.createElement("div");
    shell.className = "sd-ui-widget-shell";
    shell.dataset.sdUiWidgetInstance = this.instanceId;
    const s = this.widgetItem.system;
    const canvasW = Number(s.canvas?.w ?? 0);
    const canvasH = Number(s.canvas?.h ?? 0);
    const canvas = document.createElement("div");
    canvas.className = "sd-ui-widget-canvas";
    canvas.style.position = "relative";
    canvas.style.width = canvasW > 0 ? `${canvasW}px` : "100%";
    canvas.style.height = canvasH > 0 ? `${canvasH}px` : "100%";
    if ((s.wbLayout ?? "free") === "grid") {
      canvas.style.display = "grid";
      canvas.style.gridTemplateColumns = `repeat(${Math.max(1, Number(s.columns ?? 3))},minmax(0,1fr))`;
      canvas.style.gridAutoRows = "min-content";
      canvas.style.gap = `${Number(s.gap ?? 8)}px`;
      canvas.style.alignContent = "start";
      canvas.style.padding = `${Number(s.gap ?? 8)}px`;
    }
    shell.appendChild(canvas);
    this._canvas = canvas;
    return shell;
  }

  _replaceHTML(shell, content) {
    content.innerHTML = "";
    content.appendChild(shell);
    this.tree.render(this._canvas);
    this._applyCustomCss(content);
  }

  /** Scoped custom CSS from the asset, sanitised by the system helper. */
  async _applyCustomCss(content) {
    const raw = String(this.widgetItem.system.customCss ?? "").trim();
    if (!raw) return;
    try {
      const { sanitizeWidgetCss } = await import("/systems/sd/module/builder/widget-css.mjs");
      const scope = `[data-sd-ui-widget-instance="${this.instanceId}"]`;
      const css = sanitizeWidgetCss(raw, scope);
      const style = document.createElement("style");
      style.textContent = css;
      content.appendChild(style);
    } catch (err) {
      console.warn(`${MODULE_ID} | custom CSS skipped:`, err);
    }
  }

  /** Re-render the element tree only — never the whole frame. */
  refresh() {
    if (!this.rendered || !this._canvas?.isConnected) return;
    this.tree.refresh();
  }

  async callBlueprintFunction(functionId, inputs = {}) {
    const fn=(this.widgetItem.system.functions??[]).find(entry=>entry.id===functionId||entry.name===functionId);
    if(!fn) throw new Error(`Blueprint function not found: ${functionId}`);
    const {actions,macros}=parseActionPayload(fn.compiled??fn.formula??"");
    const runtime = { __vars: { ...inputs, __uiInstance: this.instanceId }, __uiState: this.widgetState };
    return runActions(actions, { actor: this.actor, item: this.contextItem, label: fn.name ?? fn.id, macros, runtime });
  }

  async _runBlueprintGraph(eventKey, payload = {}, eventContext = {}) {
    const raw = this.widgetItem.system.eventGraph?.compiled ?? "";
    const { actions, macros } = parseActionPayload(raw, eventKey, {
      blueprintId: this.widgetKey,
      instanceId: this.instanceId,
      ...eventContext
    });
    if (!actions.length) return undefined;
    const runtime = {
      __vars: {
        __uiInstance: this.instanceId,
        __uiEvent: eventKey,
        __uiValue: payload
      },
      __uiState: this.widgetState
    };
    return runActions(actions, {
      actor: this.actor,
      item: this.contextItem,
      label: `${this.widgetItem.system.title ?? this.widgetItem.name}: ${eventKey}`,
      macros,
      runtime
    });
  }

  /** Pick up design changes (editor saved) without losing runtime values. */
  reloadDesign() {
    if (!this.rendered) return;
    this.tree = new UIWidgetTree({
      item: this.widgetItem,
      state: this.widgetState,
      editMode: false,
      instance: { id: this.instanceId, widgetKey: this.widgetState.widgetKey, app: this }
    });
    this.tree.prepare().then(() => {
      if (this._canvas?.isConnected) this.tree.render(this._canvas);
    });
  }

  // ------------------------------------------------------------------
  // Lifecycle
  // ------------------------------------------------------------------

  _onRender(context, options) {
    super._onRender?.(context, options);
    if (!this.element) return;
    this.element.classList.add(`sd-ui-widget-layout-${this.layoutMode}`);
    this._applyLayout();

    if (!this._subscriptions.length) {
      const onUpdateItem = (doc, changed = {}) => {
        if (doc.uuid !== this.widgetItem.uuid) return;
        const changedKeys = Object.keys(changed.system ?? {});
        // Shared variables only change values; anything else may change layout.
        const valuesOnly = changedKeys.length > 0 && changedKeys.every(key => key === "worldState");
        if (valuesOnly) this.refresh();
        else this.reloadDesign();
      };
      this._subscriptions.push(subscribeDocument(this.widgetItem, onUpdateItem));
      if (this.actor) {
        const onUpdateActor = (doc) => { if (doc.uuid === this.actor?.uuid) this.refresh(); };
        this._subscriptions.push(subscribeDocument(this.actor, onUpdateActor));
      }
      if (this.contextItem) {
        const onUpdateContextItem = doc => { if (doc.uuid === this.contextItem?.uuid) this.refresh(); };
        this._subscriptions.push(subscribeDocument(this.contextItem, onUpdateContextItem));
      }
      const onEffectChange = effect => {
        const parentUuid = effect?.parent?.uuid;
        if (parentUuid && [this.actor?.uuid, this.contextItem?.uuid].includes(parentUuid)) this.refresh();
      };
      if (this.actor) this._subscriptions.push(subscribeEffects(this.actor, onEffectChange));
      if (this.contextItem) this._subscriptions.push(subscribeEffects(this.contextItem, onEffectChange));
      this._onResize = () => this._applyLayout();
      this._subscriptions.push(subscribeViewport(this._onResize));
    }

    if (!this._openFired) {
      this._openFired = true;
      void this._runBlueprintGraph("open");
      emitEvent({ instanceId: this.instanceId, element: "", type: "open", actor: this.actor });
      for (const el of this.tree.elements) {
        if (el.events?.onOpen?.formula || this.tree.hasMainGraphEvent(el.id, "open")) {
          fireElementEvent({
            element: el, event: "open", value: "", instance: {
              id: this.instanceId, widgetKey: this.widgetKey, item: this.widgetItem,
              state: this.widgetState, actor: this.actor
            }
          });
        }
      }
    }
  }

  _applyLayout() {
    const el = this.element;
    if (!el) return;
    if (!OVERLAY_LAYOUTS.has(this.layoutMode)) return;
    const s = this.widgetItem.system;
    const dockSize = Math.max(120, Number(s.size?.w ?? 320));
    const dockHeight = Math.max(80, Number(s.size?.h ?? 240));
    el.style.position = "fixed";
    el.style.maxWidth = "none";
    el.style.maxHeight = "none";
    switch (this.layoutMode) {
      case "fullscreen":
        Object.assign(el.style, { left: "0", top: "0", right: "0", bottom: "0", width: "100vw", height: "100vh", borderRadius: "0" });
        break;
      case "dock-left":
        Object.assign(el.style, { left: "0", top: "0", bottom: "0", height: "100vh", width: `${dockSize}px` });
        break;
      case "dock-right":
        Object.assign(el.style, { right: "0", left: "auto", top: "0", bottom: "0", height: "100vh", width: `${dockSize}px` });
        break;
      case "dock-top":
        Object.assign(el.style, { left: "0", right: "0", top: "0", width: "100vw", height: `${dockHeight}px` });
        break;
      case "dock-bottom":
        Object.assign(el.style, { left: "0", right: "0", bottom: "0", top: "auto", width: "100vw", height: `${dockHeight}px` });
        break;
      default:
        break;
    }
  }

  onBroadcast(event, payload) {
    try {
      Hooks.callAll("sdCustomEvent", {
        name: event,
        scope: "uiBlueprint",
        actorId: this.actor?.id ?? "",
        sourceUuid: this.contextItem?.uuid ?? this.widgetItem?.uuid ?? "",
        payload,
        blueprintId: this.widgetKey,
        instanceId: this.instanceId
      });
    } catch (error) {
      console.warn(`${MODULE_ID} | custom event hook failed`, error);
    }
    void this._runBlueprintGraph(event, payload, { eventId:event });
    for (const el of this.tree.elements) {
      const key = `onBroadcast:${event}`;
      if (el.events?.[key]?.formula || el.events?.onBroadcast?.formula) {
        fireElementEvent({
          element: el, event: "broadcast", value: payload, instance: {
            id: this.instanceId, widgetKey: this.widgetKey, item: this.widgetItem,
            state: this.widgetState, actor: this.actor
          }
        });
      }
    }
    this.refresh();
  }

  async close(options = {}) {
    await this._runBlueprintGraph("close");
    for (const el of this.tree.elements) {
      if (!el.events?.onClose?.formula && !this.tree.hasMainGraphEvent(el.id, "close")) continue;
      try {
        await fireElementEvent({
          element: el, event: "close", value: "", instance: {
            id: this.instanceId, widgetKey: this.widgetKey, item: this.widgetItem,
            state: this.widgetState, actor: this.actor
          }
        });
      } catch { /* keep closing */ }
    }
    emitEvent({ instanceId: this.instanceId, element: "", type: "close", actor: this.actor });
    unregisterInstance(this.instanceId);
    for (const unsubscribe of this._subscriptions) unsubscribe?.();
    this._subscriptions = [];
    this._unsubscribeState?.();
    this.tree.teardown();
    return super.close(options);
  }

  // Compatibility with the previous module API.
  _sdRefreshField() { this.refresh(); }
}
