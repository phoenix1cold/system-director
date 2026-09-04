/**
 * Runtime tree builder shared by the live window and the editor canvas.
 *
 * One renderer for both contexts means the editor shows exactly what players
 * will see; `editMode` only disables interactions and timers.
 *
 * Element records are a flat list with `parent` links, so hierarchy edits are
 * cheap and legacy (flat, parent-less) layouts keep working untouched.
 */

import { MODULE_ID } from "./ui-widget-const.mjs";
import { UI_ELEMENT_TYPES, elementDef, createElement, h } from "./ui-widget-elements.mjs";
import { safeId } from "./ui-widget-blueprint.mjs";
import { fireElementEvent, parseActionPayload, runActions, runRollFormula } from "./ui-widget-events.mjs";

/** System widget types that hard-require a real Actor document. */
export const ACTOR_ONLY_WIDGETS = new Set([
  "inventory", "spellbook", "attributeGroup", "effects", "slot",
  "cardHand", "cardDrawButton", "questMarker"
]);

let _rendererPromise = null;

/** Lazily resolve the system's WidgetRenderer class. */
export async function loadWidgetRenderer() {
  if (globalThis.SD_WIDGET_RENDERER) return globalThis.SD_WIDGET_RENDERER;
  if (!_rendererPromise) {
    _rendererPromise = import("/systems/sd/module/builder/widget-renderer.mjs")
      .then(mod => {
        const cls = mod.WidgetRenderer ?? mod.default ?? null;
        if (cls) globalThis.SD_WIDGET_RENDERER = cls;
        return cls;
      })
      .catch(err => {
        console.warn(`${MODULE_ID} | WidgetRenderer unavailable:`, err);
        return null;
      });
  }
  return _rendererPromise;
}

// ---------------------------------------------------------------------------
// Migration / normalisation
// ---------------------------------------------------------------------------

/**
 * Convert whatever is stored on the Item into current-shape elements.
 * Legacy records (v0.4 and earlier) were raw system widget definitions with
 * top-level x/y/w/h — those become `sdwidget` bridges so nothing is lost.
 */
export function normalizeElements(rawElements) {
  const list = Array.isArray(rawElements) ? rawElements : [];
  const out = [];
  for (const [index, raw] of list.entries()) {
    if (!raw || typeof raw !== "object") continue;
    const type = String(raw.type ?? "");
    if (UI_ELEMENT_TYPES[type]) {
      out.push({
        id: safeId(raw.id || raw.widgetId || raw.name, `widget_${index + 1}`),
        widgetId: safeId(raw.id || raw.widgetId || raw.name, `widget_${index + 1}`),
        type,
        name: raw.name || `${type}_${index + 1}`,
        parent: raw.parent ?? "",
        x: Number(raw.x ?? 0), y: Number(raw.y ?? 0),
        w: Number(raw.w ?? 160), h: Number(raw.h ?? 32), z: Number(raw.z ?? 0),
        anchor: raw.anchor || "top-left",
        grow: Number(raw.grow ?? 0),
        props: { ...(raw.props ?? {}) },
        style: { ...(raw.style ?? {}) },
        bind: { ...(raw.bind ?? {}) },
        events: { ...(raw.events ?? {}) },
        locked: !!raw.locked,
        hidden: !!raw.hidden
      });
      continue;
    }
    // Legacy: a bare system widget definition.
    const widget = foundry.utils.deepClone(raw);
    delete widget.x; delete widget.y; delete widget.w; delete widget.h; delete widget.z;
    delete widget.parent; delete widget.clickable;
    out.push(createElement("sdwidget", {
      id: raw.id || foundry.utils.randomID(10),
      name: raw.name || `${type || "widget"}_${index + 1}`,
      x: Number(raw.x ?? 0), y: Number(raw.y ?? 0),
      w: Number(raw.w ?? 220), h: Number(raw.h ?? 60), z: Number(raw.z ?? 0),
      props: { widgetType: type, widget },
      events: raw.formula ? { onClick: { formula: String(raw.formula), graphData: raw.graphData ?? null } } : {}
    }));
  }
  return out;
}

/** True when the stored list still contains legacy records. */
export function needsMigration(rawElements) {
  return (Array.isArray(rawElements) ? rawElements : [])
    .some(raw => raw && typeof raw === "object" && !UI_ELEMENT_TYPES[String(raw.type ?? "")]);
}

export function childrenOf(elements, parentId) {
  return elements.filter(el => (el.parent ?? "") === (parentId ?? ""));
}

// ---------------------------------------------------------------------------
// Tree
// ---------------------------------------------------------------------------

export class UIWidgetTree {

  /**
   * @param {object} options
   * @param {Item}   options.item
   * @param {UIWidgetState} options.state
   * @param {boolean} options.editMode   editor preview: no writes, no timers
   * @param {object}  options.instance   { id, widgetKey } for event routing
   */
  constructor({ item, state, editMode = false, instance = null }) {
    this.item = item;
    this.state = state;
    this.editMode = !!editMode;
    this.instance = instance;
    this.elements = normalizeElements(item?.system?.elements);
    this.ctx = state?.buildContext?.() ?? {};
    this._teardown = [];
    this._nodes = new Map();       // element id → wrapper node
    this._childHosts = new Map();  // parent id ("" = root) → node children live in
    this._host = null;
    this._Renderer = globalThis.SD_WIDGET_RENDERER ?? null;
    this._api = this._buildApi();
  }

  get root() { return this._host; }

  nodeFor(elementId) { return this._nodes.get(String(elementId)) ?? null; }

  /**
   * The node a container's children are actually appended to — a Border puts
   * them in its body, a Canvas Panel in its own box. The editor needs this to
   * hit-test drops and to convert coordinates when reparenting.
   */
  childHostFor(parentId) { return this._childHosts.get(String(parentId ?? "")) ?? null; }

  elementById(id) { return this.elements.find(el => el.id === id) ?? null; }

  hasMainGraphEvent(elementId, eventName) {
    const expected = String(eventName ?? "").replace(/^on/, "").toLowerCase();
    return (this.item?.system?.eventGraph?.nodes ?? []).some(node =>
      node?.type === "ui_widget_event"
      && String(node.data?.widgetId ?? "") === String(elementId ?? "")
      && String(node.data?.event ?? "click").replace(/^on/, "").toLowerCase() === expected
    );
  }

  onTeardown(fn) { this._teardown.push(fn); }

  teardown() {
    for (const fn of this._teardown.splice(0)) {
      try { fn(); } catch { /* ignore */ }
    }
  }

  /** Ensure the system renderer is available before rendering SD bridges. */
  async prepare() {
    if (!this._Renderer) this._Renderer = await loadWidgetRenderer();
    return this;
  }

  /** Rebuild the whole tree into `host`. */
  render(host) {
    this.teardown();
    this._nodes.clear();
    this._childHosts.clear();
    this._host = host;
    host.innerHTML = "";
    this.ctx = this.state?.buildContext?.() ?? {};
    const rootGrid = (this.item?.system?.wbLayout ?? "free") === "grid";
    this._renderInto(host, "", { free: !rootGrid, grid: rootGrid });
    return host;
  }

  /**
   * Re-render in place, keeping the focused input's value and caret so live
   * typing is never interrupted by a state change.
   */
  refresh() {
    if (!this._host) return;
    const active = document.activeElement;
    let restore = null;
    if (active && this._host.contains(active) && ("value" in active)) {
      const wrap = active.closest("[data-uiw-el]");
      restore = {
        elementId: wrap?.dataset.uiwEl ?? "",
        value: active.value,
        start: active.selectionStart ?? null,
        end: active.selectionEnd ?? null
      };
    }
    const scrolls = [...this._host.querySelectorAll("[data-uiw-el]")].map(node => ({
      id: node.dataset.uiwEl, top: node.scrollTop, left: node.scrollLeft
    }));
    this.render(this._host);
    for (const s of scrolls) {
      const node = this._nodes.get(s.id);
      if (!node) continue;
      node.scrollTop = s.top;
      node.scrollLeft = s.left;
    }
    if (restore?.elementId) {
      const node = this._nodes.get(restore.elementId);
      const input = node?.querySelector("input, select, textarea");
      if (input) {
        input.value = restore.value;
        input.focus();
        try { if (restore.start !== null) input.setSelectionRange(restore.start, restore.end); }
        catch { /* not a text input */ }
      }
    }
  }

  // ------------------------------------------------------------------
  // Layout
  // ------------------------------------------------------------------

  _renderInto(host, parentId, { free = true, stretch = false, grid = false } = {}) {
    this._childHosts.set(String(parentId ?? ""), host);
    for (const el of childrenOf(this.elements, parentId)) {
      const wrapper = this._renderElement(el, { free, stretch, grid });
      if (wrapper) host.appendChild(wrapper);
    }
  }

  _slotStyle(el, { free, stretch, grid = false }) {
    const out = [];
    const x = Number(el.x ?? 0), y = Number(el.y ?? 0);
    const w = Number(el.w ?? 160), hh = Number(el.h ?? 32);
    if (!free) {
      // Flow child: the wrapper must be positioned so that overlays, tooltips
      // and absolutely placed inner parts anchor to the element, not the canvas.
      out.push("position:relative");
      if (grid) {
        // Grid cells own the horizontal size; `grow` acts as a column span.
        const span = Math.max(1, Math.round(Number(el.grow ?? 0) || 1));
        if (span > 1) out.push(`grid-column:span ${span}`);
        out.push("width:auto");
        out.push(el.anchor === "fill" || el.anchor === "stretch-v" ? "height:100%" : `height:${hh}px`);
      } else {
        if (Number(el.grow ?? 0) > 0) out.push(`flex:${Number(el.grow)} 1 auto`);
        else out.push("flex:0 0 auto");
        out.push(`width:${el.anchor === "stretch-h" || el.anchor === "fill" ? "100%" : `${w}px`}`);
        out.push(`height:${el.anchor === "stretch-v" || el.anchor === "fill" ? "100%" : `${hh}px`}`);
      }
      if (el.z) out.push(`z-index:${Number(el.z)}`);
      return out.join(";");
    }
    out.push("position:absolute");
    if (el.z) out.push(`z-index:${Number(el.z)}`);
    if (stretch && el.anchor === "fill") {
      out.push(`inset:${y}px ${x}px`);
      return out.join(";");
    }
    switch (el.anchor) {
      case "top-center":
        out.push(`left:calc(50% + ${x}px);top:${y}px;transform:translateX(-50%)`);
        out.push(`width:${w}px;height:${hh}px`);
        break;
      case "top-right":
        out.push(`right:${x}px;top:${y}px;width:${w}px;height:${hh}px`);
        break;
      case "middle-left":
        out.push(`left:${x}px;top:calc(50% + ${y}px);transform:translateY(-50%);width:${w}px;height:${hh}px`);
        break;
      case "center":
        out.push(`left:calc(50% + ${x}px);top:calc(50% + ${y}px);transform:translate(-50%,-50%);width:${w}px;height:${hh}px`);
        break;
      case "middle-right":
        out.push(`right:${x}px;top:calc(50% + ${y}px);transform:translateY(-50%);width:${w}px;height:${hh}px`);
        break;
      case "bottom-left":
        out.push(`left:${x}px;bottom:${y}px;width:${w}px;height:${hh}px`);
        break;
      case "bottom-center":
        out.push(`left:calc(50% + ${x}px);bottom:${y}px;transform:translateX(-50%);width:${w}px;height:${hh}px`);
        break;
      case "bottom-right":
        out.push(`right:${x}px;bottom:${y}px;width:${w}px;height:${hh}px`);
        break;
      case "stretch-h":
        out.push(`left:${x}px;right:${x}px;top:${y}px;height:${hh}px`);
        break;
      case "stretch-v":
        out.push(`left:${x}px;top:${y}px;bottom:${y}px;width:${w}px`);
        break;
      case "fill":
        out.push(`inset:${y}px ${x}px`);
        break;
      case "top-left":
      default:
        out.push(`left:${x}px;top:${y}px;width:${w}px;height:${hh}px`);
        break;
    }
    return out.join(";");
  }

  _renderElement(el, slotOptions) {
    const def = elementDef(el.type);
    const api = this._api;
    const visible = api.visible(el);

    const wrapper = h("div", {
      cls: `uiw-el uiw-type-${el.type} ${el.props?.cssClass ?? ""}`.trim(),
      style: this._slotStyle(el, slotOptions),
      attrs: {
        "data-uiw-el": el.id,
        "data-uiw-name": el.name ?? "",
        "data-uiw-type": el.type,
        "data-tooltip": api.value(el, "tooltip") || null
      }
    });
    this._nodes.set(el.id, wrapper);

    if (!visible) {
      if (!this.editMode) { wrapper.style.display = "none"; return wrapper; }
      wrapper.classList.add("uiw-hidden-preview");
    }
    if (this.editMode && el.hidden) wrapper.classList.add("uiw-hidden-preview");
    if (!api.enabled(el)) wrapper.classList.add("uiw-disabled");

    let inner;
    try {
      inner = def?.render ? def.render(el, api) : h("div", { cls: "uiw-unknown", text: `Unknown element: ${el.type}` });
    } catch (err) {
      console.warn(`${MODULE_ID} | element render failed (${el.type}/${el.name}):`, err);
      inner = h("div", { cls: "uiw-error", text: `⚠ ${err?.message ?? "render error"}` });
    }
    wrapper.appendChild(inner);
    return wrapper;
  }

  // ------------------------------------------------------------------
  // Render API handed to element definitions
  // ------------------------------------------------------------------

  _valueBinding(el) {
    return el?.valueVariableId ? { kind: "variable", variableId: el.valueVariableId }
      : { kind: "widget", widgetId: el?.id ?? "", property: "value" };
  }

  _evalFormula(raw) {
    const str = String(raw ?? "");
    if (!str.includes("{")) return str;
    const Engine = globalThis.SD_FORMULA_ENGINE;
    if (!Engine) return str;
    try { return Engine.evaluate(str, this.ctx); }
    catch { return str; }
  }

  _buildApi() {
    const tree = this;

    const readProp = (el, key) => {
      // A per-instance override written by a "Set <Element>" node wins: it is the
      // imperative current value for this window only, and never touches the
      // blueprint document.
      const elId = el?.id ?? "";
      if (elId && tree.state?.hasWidgetProperty?.(elId, key)) return tree.state.getWidgetProperty(elId, key);
      const binding = el?.bind?.[key];
      if (binding !== undefined && binding !== null && String(binding).trim() !== "") {
        if (typeof binding === "object" && binding.kind === "variable") return tree.state?.getVariable?.(binding.variableId);
        if (typeof binding === "object" && binding.kind === "widget") return tree.state?.getWidgetProperty?.(binding.widgetId, binding.property ?? key);
        return tree._evalFormula(binding);
      }
      const schema = (elementDef(el?.type)?.props ?? []).find(p => p.key === key);
      const source = schema?.style ? (el?.style ?? {}) : (el?.props ?? {});
      const value = source[key];
      if (typeof value === "string" && (schema?.type === "formula" || value.includes("{"))) {
        return tree._evalFormula(value);
      }
      return value;
    };

    return {
      editMode: tree.editMode,
      state: tree.state,
      get ctx() { return tree.ctx; },
      actor: tree.state?.actor ?? null,
      item: tree.state?.contextItem ?? null,

      value: (el, key) => readProp(el, key),

      number: (el, key, fallback = 0) => {
        const raw = readProp(el, key);
        const n = Number(raw);
        return Number.isFinite(n) ? n : fallback;
      },

      visible: (el) => {
        const binding = el?.bind?.visible;
        if (binding) {
          const v = tree._evalFormula(binding);
          const n = Number(v);
          if (Number.isFinite(n)) return n !== 0;
          return !["", "false", "no", "off", "null", "undefined"].includes(String(v).trim().toLowerCase());
        }
        if (el?.hidden) return false;
        return el?.props?.visible !== false;
      },

      enabled: (el) => {
        const binding = el?.bind?.enabled;
        if (binding) {
          const v = tree._evalFormula(binding);
          const n = Number(v);
          if (Number.isFinite(n)) return n !== 0;
          return !["", "false", "no", "off"].includes(String(v).trim().toLowerCase());
        }
        return el?.props?.enabled !== false;
      },

      hasEvent: (el, name) => {
        const raw = el?.events?.[name]?.formula ?? "";
        return (typeof raw === "string" && raw.trim().length > 0) || tree.hasMainGraphEvent(el?.id, name);
      },

      boundValue: (el, fallback = "") => {
        const binding = tree._valueBinding(el);
        const value = binding.kind === "variable" ? tree.state?.getVariable?.(binding.variableId)
          : tree.state?.getWidgetProperty?.(binding.widgetId, binding.property, undefined);
        // An explicit empty value must survive a re-render, so only an absent
        // value falls back to the element's default.
        if (value !== undefined) return value;
        const dflt = el?.props?.default;
        return (dflt !== undefined && dflt !== "") ? dflt : fallback;
      },

      commitValue: async (el, value, { silentEvent = false } = {}) => {
        if (tree.editMode) return;
        const binding = tree._valueBinding(el);
        if (binding.kind === "variable") await tree.state?.setVariable?.(binding.variableId, value);
        else await tree.state?.setWidgetProperty?.(binding.widgetId, binding.property, value);
        if (!silentEvent) await tree._api.emit(el, "change", value);
        tree.refresh();
      },

      bindValueInput: (input, el, { event = "change", numeric = false, boolean = false, min = -Infinity, max = Infinity } = {}) => {
        if (tree.editMode) {
          input.addEventListener("mousedown", ev => ev.preventDefault());
          return;
        }
        input.addEventListener(event, async () => {
          let value;
          if (boolean) value = input.checked;
          else if (numeric) {
            const n = Number(input.value);
            value = Math.max(min, Math.min(max, Number.isFinite(n) ? n : 0));
            input.value = String(value);
          } else value = input.value;
          await tree._api.commitValue(el, value);
        });
      },

      bindClick: (node, el, { value = "", confirm = false } = {}) => {
        if (tree.editMode) {
          node.addEventListener("click", ev => { ev.preventDefault(); ev.stopPropagation(); });
          return;
        }
        node.addEventListener("click", async (ev) => {
          ev.preventDefault();
          if (confirm) {
            const ok = await foundry.applications.api.DialogV2.confirm({
              window: { title: el?.props?.text || el?.name || "Confirm" },
              content: `<p>${game.i18n.localize("SDUI.Runtime.ConfirmAction")}</p>`
            }).catch(() => false);
            if (!ok) return;
          }
          await tree._api.emit(el, "click", value);
        });
      },

      emit: async (el, event, value, extra = {}) => {
        if (tree.editMode) return;
        await fireElementEvent({
          element: el,
          event,
          value,
          index: extra.index ?? 0,
          instance: {
            id: tree.instance?.id ?? "",
            widgetKey: tree.state?.widgetKey ?? "",
            item: tree.item,
            state: tree.state,
            actor: tree.state?.actor ?? null, contextItem: tree.state?.contextItem ?? null,
            app: tree.instance?.app ?? null
          }
        });
      },

      onTeardown: (fn) => tree.onTeardown(fn),

      renderChildren: (el, host, options = {}) => tree._renderInto(host, el.id, options),

      renderSystemWidget: (el) => tree._renderSystemWidget(el)
    };
  }

  // ------------------------------------------------------------------
  // SD bridge
  // ------------------------------------------------------------------

  _renderSystemWidget(el) {
    const host = h("div", { cls: "uiw-sdwidget", style: "width:100%;height:100%;overflow:hidden" });
    const widgetDef = el?.props?.widget;
    const type = String(widgetDef?.type ?? el?.props?.widgetType ?? "");
    if (!type) {
      host.appendChild(h("div", { cls: "uiw-placeholder", text: game.i18n.localize("SDUI.Runtime.PickWidgetType") }));
      return host;
    }
    const Renderer = this._Renderer ?? globalThis.SD_WIDGET_RENDERER;
    if (!Renderer?.render) {
      host.appendChild(h("div", { cls: "uiw-error", text: "WidgetRenderer unavailable" }));
      loadWidgetRenderer().then(cls => {
        if (!cls || !host.isConnected) return;
        this._Renderer = cls;
        host.innerHTML = "";
        host.appendChild(this._renderSystemWidget(el));
      });
      return host;
    }
    const actor = this.state?.actor ?? null;
    if (ACTOR_ONLY_WIDGETS.has(type) && !actor) {
      host.appendChild(h("div", {
        cls: "uiw-placeholder",
        text: game.i18n.format("SDUI.Runtime.NeedsActor", { type })
      }));
      return host;
    }
    const doc = ACTOR_ONLY_WIDGETS.has(type) ? actor : this.ctx;
    const def = { id: `uiw-${el.id}`, span: 1, ...widgetDef, type };
    try {
      host.innerHTML = Renderer.render(def, doc, false, { readOnly: this.editMode }) ?? "";
    } catch (err) {
      console.warn(`${MODULE_ID} | system widget render failed (${type}):`, err);
      host.innerHTML = "";
      host.appendChild(h("div", { cls: "uiw-error", text: `⚠ ${err?.message ?? "render error"}` }));
      return host;
    }
    if (!this.editMode) this._wireSystemWidget(host, def, el);
    else host.querySelectorAll("input, select, textarea, button").forEach(node => { node.disabled = true; });
    return host;
  }

  /**
   * Attach behaviour to markup produced by the system's WidgetRenderer.
   *
   * Mirrors the sheet/HUD wiring contract (`action-hud.mjs → wireHudWidget`)
   * but routes every write through the instance state, so a UI Widget can host
   * path-based widgets (text, number, resource, tracker, clock, toggle, select…)
   * without a backing document — which is exactly what used to break.
   */
  _wireSystemWidget(host, widgetDef, el) {
    const state = this.state;
    const actor = state?.actor ?? null;
    const readNum = (path) => {
      const field = [...host.querySelectorAll("input, select, textarea")]
        .find(node => (node.dataset.path || node.getAttribute("name")) === path);
      const fromField = field ? Number(field.value) : NaN;
      if (Number.isFinite(fromField)) return fromField;
      const n = Number(state?.getPath?.(path, 0));
      return Number.isFinite(n) ? n : 0;
    };
    const write = async (path, value) => {
      if (!path || path.startsWith("__")) return;
      await state?.setPath?.(path, value);
      await this._api.emit(el, "change", value);
      this.refresh();
    };

    host.querySelectorAll("input[data-path], input[name], select[data-path], select[name], textarea[data-path], textarea[name]")
      .forEach(input => {
        input.addEventListener("change", async () => {
          const path = input.dataset.path || input.getAttribute("name");
          let value;
          if (input.type === "checkbox") value = input.checked;
          else if (input.type === "number") {
            const n = Number(input.value);
            value = Number.isFinite(n) ? n : 0;
          } else value = input.value;
          await write(path, value);
        });
      });

    host.querySelectorAll("[data-step], [data-action='widgetNumStep']").forEach(btn => {
      btn.addEventListener("click", async (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        const step = parseFloat(btn.dataset.step);
        const path = btn.dataset.path;
        if (!path || !Number.isFinite(step)) return;
        const rawMin = btn.dataset.min !== undefined && btn.dataset.min !== "" ? parseFloat(btn.dataset.min) : -Infinity;
        const rawMax = btn.dataset.max !== undefined && btn.dataset.max !== "" ? parseFloat(btn.dataset.max) : Infinity;
        const next = Math.max(Number.isFinite(rawMin) ? rawMin : -Infinity,
          Math.min(Number.isFinite(rawMax) ? rawMax : Infinity, readNum(path) + step));
        await write(path, next);
      });
    });

    host.querySelectorAll("[data-action='widgetToggle'], [data-toggle]").forEach(node => {
      node.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        const path = node.dataset.path || node.dataset.toggle;
        if (!path) return;
        const current = state?.getPath?.(path, false);
        await write(path, !(current === true || current === "true" || current === 1));
      });
    });

    host.querySelectorAll("[data-action='widgetSelectPill']").forEach(btn => {
      btn.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        await write(btn.dataset.path, btn.dataset.value ?? "");
      });
    });

    const pipHandler = (selector, maxAttr) => {
      host.querySelectorAll(selector).forEach(pip => {
        pip.addEventListener("click", async (ev) => {
          ev.stopPropagation();
          const path = pip.dataset.path;
          const index = Number(pip.dataset.index);
          const max = Number(pip.dataset[maxAttr] ?? 0) || 0;
          if (!path || !Number.isFinite(index)) return;
          const cur = Number(state?.getPath?.(path, 0)) || 0;
          const next = cur > index ? index : index + 1;
          await write(path, Math.min(max || Infinity, Math.max(0, next)));
        });
      });
    };
    pipHandler(".sd-tracker-pip[data-path]", "max");
    pipHandler(".sd-clock-segment[data-path]", "segs");

    host.querySelectorAll(".sd-tracker-reset[data-path], .sd-clock-reset[data-path]").forEach(btn => {
      btn.addEventListener("click", async (ev) => { ev.stopPropagation(); await write(btn.dataset.path, 0); });
    });

    host.querySelectorAll(".sd-tag-add").forEach(btn => {
      btn.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        const path = btn.dataset.path;
        if (!path) return;
        const value = await foundry.applications.api.DialogV2.prompt({
          window: { title: game.i18n.localize("SDUI.Runtime.AddTag") },
          content: `<input type="text" name="tag" autofocus>`,
          ok: { callback: (_ev, button) => button.form.elements.tag.value }
        }).catch(() => null);
        if (!value) return;
        const current = String(state?.getPath?.(path, "") ?? "");
        await write(path, current ? `${current},${value}` : value);
      });
    });
    host.querySelectorAll(".sd-tag-remove").forEach(btn => {
      btn.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        const path = btn.dataset.path;
        const tag = btn.dataset.tag ?? "";
        if (!path) return;
        const current = String(state?.getPath?.(path, "") ?? "")
          .split(",").map(s => s.trim()).filter(t => t && t !== tag);
        await write(path, current.join(","));
      });
    });

    // Rolls and action graphs.
    const runPayload = async (raw, flavor) => {
      const { actions, macros, formula } = parseActionPayload(raw);
      if (actions.length) {
        return runActions(actions, {
          actor, item: null, label: flavor, macros,
          runtime: { __vars: { __uiInstance: this.instance?.id ?? "", __uiElement: el?.name ?? "" } }
        });
      }
      if (formula) return runRollFormula(formula, { actor, doc: this.ctx, flavor });
      if (flavor) ChatMessage.create({ content: flavor, speaker: ChatMessage.getSpeaker({ actor }) });
    };

    host.querySelectorAll("[data-action='widgetButton'], [data-action='widgetRoll'], [data-roll]").forEach(btn => {
      btn.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        const raw = btn.dataset.formulaRaw || btn.dataset.formula || btn.dataset.roll || "";
        await runPayload(raw, btn.dataset.flavor ?? "");
        await this._api.emit(el, "click", btn.dataset.value ?? "");
      });
    });

    host.querySelectorAll("[data-action='attrModClick']").forEach(btn => {
      btn.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        const raw = btn.dataset.attrOnclick || btn.dataset.attrRoll || "";
        await runPayload(raw, btn.dataset.flavor ?? "");
      });
    });

    // Actor-document affordances only make sense with a real actor.
    if (!actor) return;
    host.querySelectorAll("[data-action='itemUse']").forEach(btn => {
      btn.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        const item = actor.items?.get(btn.dataset.itemId);
        if (item) await item.use({});
      });
    });
    host.querySelectorAll("[data-action='itemEdit'], [data-action='slotItemEdit'], [data-action='abilityEdit']").forEach(btn => {
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const item = actor.items?.get(btn.dataset.itemId);
        item?.sheet?.render(true);
      });
    });
    host.querySelectorAll("[data-action='effectToggle']").forEach(btn => {
      btn.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        const effect = actor.effects?.get(btn.dataset.effectId);
        if (effect) await effect.update({ disabled: !effect.disabled });
      });
    });
  }
}
