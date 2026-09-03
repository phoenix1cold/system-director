/**
 * SDUIWidgetEditor — the UMG-style designer for `uiwidget` items.
 *
 *   ┌───────────────────────────── toolbar ─────────────────────────────┐
 *   ├───────────┬──────────────────────────────────┬───────────────────┤
 *   │ palette   │            canvas                │ details           │
 *   │ hierarchy │  (live preview + manipulators)   │ variables         │
 *   └───────────┴──────────────────────────────────┴───────────────────┘
 *
 * Design notes
 * ------------
 * The canvas is rendered by the *runtime* tree (`UIWidgetTree` in edit mode),
 * so what you drag is what players get.
 *
 * Nothing in this sheet calls `this.render()` while the user interacts. Element
 * mutations are written with `{ render: false }` and the affected panel is
 * rebuilt by hand. That is what makes dragging follow the cursor: the previous
 * implementation re-rendered the whole sheet on `mousedown`, which detached the
 * node being dragged, so the element only appeared to move on mouse-up.
 */

import { MODULE_ID } from "./ui-widget-const.mjs";
import {
  UI_ELEMENT_TYPES, PALETTE_ORDER, ELEMENT_CATEGORIES, ANCHOR_PRESETS,
  elementDef, propSchema, createElement, isContainer
} from "./ui-widget-elements.mjs";
import { UIWidgetTree, normalizeElements, needsMigration, childrenOf } from "./ui-widget-runtime.mjs";
import { UIWidgetState, VAR_SCOPES, VAR_TYPES } from "./ui-widget-state.mjs";
import { SDUIWidgetApp } from "./ui-widget-app.mjs";
import { BLUEPRINT_SCHEMA_VERSION, migrateBlueprintData, normalizeVariables, safeId, uniqueId } from "./ui-widget-blueprint.mjs";
import { openBlueprintAssetManager } from "./ui-widget-assets.mjs";

const { ItemSheetV2 } = foundry.applications.sheets;
const { HandlebarsApplicationMixin } = foundry.applications.api;

const FREE_CONTAINERS = new Set(["canvas", "border", "overlay"]);
const UNIVERSAL_EVENTS = ["onOpen", "onClose"];
const NO_RENDER = { render: false };

/** Human label for an element event key, used in the panel and the graph entry node. */
function eventLabel(eventKey) {
  const key = String(eventKey ?? "");
  const localized = game.i18n?.localize?.(`SDUI.Event.${key}`);
  if (localized && localized !== `SDUI.Event.${key}`) return localized;
  return key.replace(/^on/, "On ");
}

const _snap = (value, step) => {
  const s = Number(step) || 0;
  const v = Number(value) || 0;
  return s > 0 ? Math.round(v / s) * s : Math.round(v);
};
const _clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const _esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));

/** Route FormulaGraph saves that originate from a widget-config popup on a uiwidget item. */
let _graphHookInstalled = false;
async function installGraphSaveBridge() {
  if (_graphHookInstalled) return;
  _graphHookInstalled = true;
  const { FormulaGraph } = await import("/systems/sd/module/builder/formula-graph.mjs");
  const original = FormulaGraph.prototype._saveGraph;
  FormulaGraph.prototype._saveGraph = async function (...args) {
    const ctx = this.saveCtx;
    const doc = ctx?.doc;
    if (!this.customSave && doc?.documentName === "Item" && doc?.type === "uiwidget" && ctx?.w) {
      const graphData = {
        nodes: this.nodes.map(n => ({ id: n.id, type: n.type, x: n.x, y: n.y, data: { ...n.data } })),
        edges: this.edges.map(e => ({ id: e.id, fromNode: e.fromNode, fromPin: e.fromPin, toNode: e.toNode, toPin: e.toPin })),
        comments: (this.comments ?? []).map(c => (this._serialiseComment ? this._serialiseComment(c) : c))
      };
      let compiled = "";
      try { compiled = String(this.compile()); } catch (err) { console.warn(`${MODULE_ID} | graph compile failed:`, err); }
      const elements = normalizeElements(doc.system.elements);
      const index = elements.findIndex(el => el.type === "sdwidget" && el.props?.widget?.id === ctx.w.id);
      if (index >= 0) {
        const el = foundry.utils.deepClone(elements[index]);
        el.props.widget = { ...(el.props.widget ?? {}), graphData };
        if (this.actionGraph) {
          el.props.widget.formula = compiled;
          if (this.targetInput) this.targetInput.value = compiled;
        } else if (this.configMode) {
          el.props.widget.configGraph = graphData;
        }
        elements[index] = el;
        await doc.update({ "system.elements": elements });
        return;
      }
    }
    return original.apply(this, args);
  };
}

export class SDUIWidgetEditor extends HandlebarsApplicationMixin(ItemSheetV2) {

  static DEFAULT_OPTIONS = {
    classes: ["sd", "sd-ui-widget-editor-window"],
    tag: "form",
    position: { width: 1320, height: 820 },
    window: {
      title: "SDUI.Editor.Title",
      icon: "fa-solid fa-window-restore",
      resizable: true,
      contentClasses: ["sd-ui-widget-editor-content"]
    },
    form: { closeOnSubmit: false, submitOnChange: false },
    actions: {
      preview: SDUIWidgetEditor._onPreview,
      copyMacro: SDUIWidgetEditor._onCopyMacro,
      fit: SDUIWidgetEditor._onFit,
      zoomIn: SDUIWidgetEditor._onZoomIn,
      zoomOut: SDUIWidgetEditor._onZoomOut,
      zoomReset: SDUIWidgetEditor._onZoomReset,
      undo: SDUIWidgetEditor._onUndo,
      migrate: SDUIWidgetEditor._onMigrate,
      openGraph: SDUIWidgetEditor._onOpenGraph,
      openAssets: SDUIWidgetEditor._onOpenAssets,
      saveTemplate: SDUIWidgetEditor._onSaveTemplate,
      insertTemplate: SDUIWidgetEditor._onInsertTemplate
    }
  };

  static PARTS = {
    body: { template: `systems/${MODULE_ID}/templates/ui-blueprint/editor.hbs` }
  };

  constructor(options = {}) {
    super(options);
    this._selection = new Set();
    this._zoom = 1;
    this._undoStack = [];
    this._elements = [];
    this._regions = {};
  }

  get title() {
    return `${game.i18n.localize("SDUI.Editor.Title")}: ${this.document?.name ?? ""}`;
  }

  get elements() { return this._elements; }

  get selected() {
    return [...this._selection].map(id => this._elements.find(el => el.id === id)).filter(Boolean);
  }

  get primary() { return this.selected[0] ?? null; }

  // ------------------------------------------------------------------
  // Context
  // ------------------------------------------------------------------

  async _prepareContext(options) {
    const base = await super._prepareContext(options);
    const s = this.document.system;
    return {
      ...base,
      document: this.document,
      system: s,
      isFree: (s.wbLayout ?? "free") !== "grid",
      needsMigration: Number(s.schemaVersion ?? 1) < BLUEPRINT_SCHEMA_VERSION || needsMigration(s.elements),
      layoutModes: ["window", "fullscreen", "dock-left", "dock-right", "dock-top", "dock-bottom"].map(value => ({
        value,
        selected: s.layout === value,
        label: game.i18n.localize(`SDUI.Layout.${value}`)
      }))
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const root = this.element;
    if (!root) return;
    installGraphSaveBridge();

    this._regions = {
      palette: root.querySelector('[data-region="palette"]'),
      hierarchy: root.querySelector('[data-region="hierarchy"]'),
      canvasWrap: root.querySelector('[data-region="canvas-wrap"]'),
      scaler: root.querySelector('[data-region="scaler"]'),
      canvas: root.querySelector('[data-region="canvas"]'),
      guides: root.querySelector('[data-region="guides"]'),
      details: root.querySelector('[data-region="details"]'),
      variables: root.querySelector('[data-region="variables"]'),
      status: root.querySelector('[data-region="status"]'),
      zoomLabel: root.querySelector(".sduw-zoom-label")
    };

    this._elements = normalizeElements(this.document.system.elements);
    this._state = new UIWidgetState(this.document, { actor: null });

    this._wireToolbar(root);
    this._buildPalette();
    this._rebuildCanvas();
    this._rebuildHierarchy();
    this._rebuildDetails();
    this._rebuildVariables();
    this._wireCanvasSurface();
    this._wireKeyboard(root);
    this._observeCanvasResize();
    this._applyZoom();
  }

  // ------------------------------------------------------------------
  // Persistence
  // ------------------------------------------------------------------

  _pushUndo() {
    this._undoStack.push(foundry.utils.deepClone(this._elements));
    if (this._undoStack.length > 40) this._undoStack.shift();
  }

  /**
   * Persist the element list without letting Foundry re-render the sheet, then
   * refresh only the panels that need it.
   */
  async _commit(elements, { canvas = true, hierarchy = true, details = false, undo = true } = {}) {
    if (undo) this._pushUndo();
    this._elements = elements;
    try {
      await this.document.update({ "system.elements": elements }, NO_RENDER);
    } catch (err) {
      console.error(`${MODULE_ID} | element save failed:`, err);
      ui.notifications?.error?.(err?.message ?? "Save failed");
      return;
    }
    if (canvas) this._rebuildCanvas();
    else if (this._tree) this._tree.elements = foundry.utils.deepClone(elements);
    if (hierarchy) this._rebuildHierarchy();
    if (details) this._rebuildDetails();
    this._updateStatus();
  }

  async _patchElement(id, patch, options = {}) {
    const elements = foundry.utils.deepClone(this._elements);
    const index = elements.findIndex(el => el.id === id);
    if (index < 0) return;
    elements[index] = foundry.utils.mergeObject(elements[index], patch, { inplace: false, insertKeys: true });
    await this._commit(elements, options);
  }

  /** Replace an element wholesale — use when keys must be removed, not merged. */
  async _setElement(id, mutator, options = {}) {
    const elements = foundry.utils.deepClone(this._elements);
    const index = elements.findIndex(el => el.id === id);
    if (index < 0) return;
    mutator(elements[index]);
    await this._commit(elements, options);
  }

  // ------------------------------------------------------------------
  // Toolbar
  // ------------------------------------------------------------------

  _wireToolbar(root) {
    for (const input of root.querySelectorAll(".sduw-toolbar [name]")) {
      input.addEventListener("change", async () => {
        const path = input.getAttribute("name");
        let value = input.value;
        if (input.type === "number") value = Number(value);
        try {
          if (path === "system.blueprintId") {
            value = safeId(value, "ui-blueprint");
            const duplicate = (game.items ?? []).some(item => item.type === "uiwidget" && item.id !== this.document.id && String(item.system?.blueprintId ?? item.system?.widgetKey).toLowerCase() === value.toLowerCase());
            if (duplicate) { ui.notifications?.error?.(`Blueprint ID '${value}' is already used.`); return; }
          }
          const update = { [path]: value };
          if (path === "system.blueprintId") update["system.widgetKey"] = value;
          await this.document.update(update, NO_RENDER);
        } catch (err) {
          ui.notifications?.warn?.(err?.message ?? "Save failed");
          return;
        }
        // Canvas geometry / layout changes need a visual rebuild.
        if (["system.wbLayout", "system.canvas.w", "system.canvas.h", "system.columns", "system.gap", "system.gridSize"].includes(path)) {
          this._rebuildCanvas();
        }
      });
    }
    const wrap = this._regions.canvasWrap;
    wrap?.addEventListener("wheel", (ev) => {
      if (!ev.ctrlKey) return;
      ev.preventDefault();
      this._zoom = _clamp(this._zoom + (ev.deltaY < 0 ? 0.1 : -0.1), 0.25, 2);
      this._applyZoom();
    }, { passive: false });
  }

  _applyZoom() {
    const { scaler, zoomLabel } = this._regions;
    if (scaler) {
      scaler.style.transform = `scale(${this._zoom})`;
      scaler.style.transformOrigin = "top left";
    }
    if (zoomLabel) zoomLabel.textContent = `${Math.round(this._zoom * 100)}%`;
    // Auto-sized canvases are expressed in unscaled pixels.
    this._applyCanvasSize();
  }

  /** Keep an auto-sized canvas in step with the editor window. */
  _observeCanvasResize() {
    const wrap = this._regions.canvasWrap;
    if (!wrap || this._resizeObserver || typeof ResizeObserver === "undefined") return;
    let frame = 0;
    this._resizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const s = this.document.system;
        if (Number(s.canvas?.w ?? 0) > 0 && Number(s.canvas?.h ?? 0) > 0) return;
        this._applyCanvasSize();
      });
    });
    this._resizeObserver.observe(wrap);
  }

  async close(options = {}) {
    this._resizeObserver?.disconnect();
    this._resizeObserver = null;
    return super.close(options);
  }

  _updateStatus() {
    const status = this._regions.status;
    if (!status) return;
    const sel = this.selected;
    const parts = [
      game.i18n.format("SDUI.Editor.StatusElements", { count: this._elements.length })
    ];
    if (sel.length === 1) {
      const el = sel[0];
      parts.push(`${el.name} · ${el.type} · x${el.x} y${el.y} ${el.w}×${el.h}`);
    } else if (sel.length > 1) {
      parts.push(game.i18n.format("SDUI.Editor.StatusSelected", { count: sel.length }));
    }
    status.textContent = parts.join("   |   ");
  }

  // ------------------------------------------------------------------
  // Palette
  // ------------------------------------------------------------------

  _buildPalette() {
    const host = this._regions.palette;
    if (!host) return;
    host.innerHTML = "";
    for (const cat of ELEMENT_CATEGORIES) {
      const types = PALETTE_ORDER.filter(type => UI_ELEMENT_TYPES[type]?.cat === cat.id);
      if (!types.length) continue;
      const group = document.createElement("details");
      group.className = "sduw-palette-group";
      group.open = cat.id !== "sd";
      const summary = document.createElement("summary");
      summary.innerHTML = `<i class="fa-solid ${cat.icon}"></i> ${game.i18n.localize(cat.label)}`;
      group.appendChild(summary);
      for (const type of types) {
        const def = UI_ELEMENT_TYPES[type];
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "sduw-palette-item";
        btn.dataset.type = type;
        btn.title = game.i18n.localize(def.desc ?? "");
        btn.innerHTML = `<i class="fa-solid ${def.icon}"></i><span>${game.i18n.localize(def.label)}</span>`;
        btn.draggable = true;
        btn.addEventListener("dragstart", (ev) => {
          ev.dataTransfer.effectAllowed = "copy";
          ev.dataTransfer.setData("application/x-sduw-element", type);
          ev.dataTransfer.setData("text/plain", `sduw:${type}`);
          btn.classList.add("is-dragging");
        });
        btn.addEventListener("dragend", () => btn.classList.remove("is-dragging"));
        btn.addEventListener("click", () => this._addElement(type, {}));
        group.appendChild(btn);
      }
      host.appendChild(group);
    }
    const search = this.element?.querySelector?.("[data-palette-search]");
    if (search && !search.dataset.wired) {
      search.dataset.wired = "1";
      search.addEventListener("input", () => {
        const query = search.value.trim().toLowerCase();
        for (const group of host.querySelectorAll(".sduw-palette-group")) {
          let visible = 0;
          for (const button of group.querySelectorAll(".sduw-palette-item")) {
            const match = !query || button.textContent.toLowerCase().includes(query) || button.dataset.type?.includes(query);
            button.hidden = !match;
            if (match) visible += 1;
          }
          group.hidden = visible === 0;
          if (query && visible) group.open = true;
        }
      });
    }
  }

  // ------------------------------------------------------------------
  // Canvas
  // ------------------------------------------------------------------

  _isFreeParent(parentId) {
    if (!parentId) return (this.document.system.wbLayout ?? "free") !== "grid";
    const parent = this._elements.find(el => el.id === parentId);
    if (!parent) return true;
    // A Canvas Panel switched to grid child layout flows its children.
    if (parent.type === "canvas") return (parent.props?.childLayout ?? "free") !== "grid";
    return FREE_CONTAINERS.has(parent.type);
  }

  /**
   * Give the canvas a definite pixel size.
   *
   * "0" in the canvas size fields means "fit the editor", but a percentage width
   * inside the zoom scaler (which is sized by its content) collapses — that is
   * what made grid mode and stretch anchors look broken.
   */
  _applyCanvasSize() {
    const canvas = this._regions.canvas;
    const wrap = this._regions.canvasWrap;
    if (!canvas) return;
    const s = this.document.system;
    const w = Number(s.canvas?.w ?? 0);
    const hh = Number(s.canvas?.h ?? 0);
    const padding = 32;
    const availableW = Math.max(240, ((wrap?.clientWidth ?? 900) - padding) / this._zoom);
    const availableH = Math.max(200, ((wrap?.clientHeight ?? 600) - padding) / this._zoom);
    canvas.style.width = `${Math.round(w > 0 ? w : availableW)}px`;
    canvas.style.height = `${Math.round(hh > 0 ? hh : availableH)}px`;

    // A CSS transform does not grow the scroll area, so reserve the scaled size
    // for canvases with an explicit size; auto-sized ones always fit.
    const scaler = this._regions.scaler;
    if (scaler) {
      const explicit = w > 0 && hh > 0;
      scaler.style.width = explicit ? `${Math.round(w * this._zoom)}px` : "";
      scaler.style.height = explicit ? `${Math.round(hh * this._zoom)}px` : "";
    }
  }

  _rebuildCanvas() {
    const canvas = this._regions.canvas;
    if (!canvas) return;
    const s = this.document.system;
    this._applyCanvasSize();
    canvas.style.setProperty("--sduw-grid", `${Number(s.gridSize ?? 16)}px`);
    if ((s.wbLayout ?? "free") === "grid") {
      canvas.classList.add("is-grid-mode");
      canvas.style.display = "grid";
      canvas.style.gridTemplateColumns = `repeat(${Math.max(1, Number(s.columns ?? 3))},minmax(0,1fr))`;
      canvas.style.gridAutoRows = "min-content";
      canvas.style.gap = `${Number(s.gap ?? 8)}px`;
      canvas.style.alignContent = "start";
      canvas.style.padding = `${Number(s.gap ?? 8)}px`;
    } else {
      canvas.classList.remove("is-grid-mode");
      canvas.style.display = "block";
      canvas.style.gridTemplateColumns = "";
      canvas.style.gridAutoRows = "";
      canvas.style.gap = "";
      canvas.style.padding = "";
    }

    // Rebuild the design-time item view from our in-memory element list, so the
    // preview reflects unsaved-yet-committed edits immediately.
    const previewItem = {
      id: this.document.id,
      uuid: this.document.uuid,
      name: this.document.name,
      system: { ...this.document.system.toObject?.() ?? this.document.system, elements: this._elements }
    };
    this._tree = new UIWidgetTree({ item: previewItem, state: this._state, editMode: true });
    this._tree.prepare().then(() => {
      if (!canvas.isConnected) return;
      this._tree.render(canvas);
      this._decorateCanvas();
      this._syncSelectionClasses();
      this._updateStatus();
    });
  }

  /** Add selection/drag/resize manipulators on top of each rendered element. */
  _decorateCanvas() {
    const canvas = this._regions.canvas;
    if (!canvas) return;
    // Keyboard shortcuts (nudge / delete / duplicate) need a focus target.
    canvas.tabIndex = 0;
    for (const wrapper of canvas.querySelectorAll("[data-uiw-el]")) {
      const id = wrapper.dataset.uiwEl;
      const el = this._elements.find(e => e.id === id);
      if (!el) continue;
      wrapper.classList.add("sduw-node");

      const overlay = document.createElement("div");
      overlay.className = "sduw-ov";
      overlay.innerHTML = `
        <div class="sduw-ov-tag">
          <i class="fa-solid ${elementDef(el.type)?.icon ?? "fa-cube"}"></i>
          <span>${_esc(el.name)}</span>
        </div>`;
      wrapper.appendChild(overlay);

      if (el.locked) {
        overlay.classList.add("is-locked");
        wrapper.classList.add("is-locked");
        continue;
      }

      // Manipulation listens on the wrapper, not the overlay: the overlay is
      // pointer-transparent so nested elements stay selectable, and a child's
      // handler stops propagation before the parent container sees it.
      wrapper.addEventListener("pointerdown", (ev) => this._onNodePointerDown(ev, el, wrapper));
      wrapper.addEventListener("dblclick", (ev) => {
        ev.stopPropagation();
        if (el.type === "sdwidget") this._openSystemWidgetConfig(el);
      });

      const free = this._isFreeParent(el.parent);
      if (free) {
        const handles = el.anchor === "top-left"
          ? ["nw", "n", "ne", "e", "se", "s", "sw", "w"]
          : ["e", "se", "s"];
        for (const dir of handles) {
          const handle = document.createElement("div");
          handle.className = `sduw-handle sduw-handle-${dir}`;
          handle.dataset.dir = dir;
          handle.addEventListener("pointerdown", (pev) => {
            pev.stopPropagation();
            this._onResizePointerDown(pev, el, wrapper, dir);
          });
          overlay.appendChild(handle);
        }
      }
    }
  }

  _syncSelectionClasses() {
    const canvas = this._regions.canvas;
    if (!canvas) return;
    for (const wrapper of canvas.querySelectorAll("[data-uiw-el]")) {
      wrapper.classList.toggle("is-selected", this._selection.has(wrapper.dataset.uiwEl));
    }
    for (const row of (this._regions.hierarchy?.querySelectorAll("[data-el-id]") ?? [])) {
      row.classList.toggle("is-selected", this._selection.has(row.dataset.elId));
    }
  }

  _select(ids, { additive = false } = {}) {
    const list = Array.isArray(ids) ? ids : [ids].filter(Boolean);
    if (!additive) this._selection.clear();
    for (const id of list) {
      if (additive && this._selection.has(id)) this._selection.delete(id);
      else this._selection.add(id);
    }
    this._syncSelectionClasses();
    this._rebuildDetails();
    this._updateStatus();
  }

  _wireCanvasSurface() {
    const canvas = this._regions.canvas;
    const wrap = this._regions.canvasWrap;
    if (!canvas || !wrap) return;

    // Drop from the palette, into whichever container is under the cursor.
    const isElementDrag = (ev) => [...(ev.dataTransfer?.types ?? [])].includes("application/x-sduw-element");
    wrap.addEventListener("dragover", (ev) => {
      if (!isElementDrag(ev)) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = "copy";
      const host = this._containerAt(ev.clientX, ev.clientY);
      wrap.querySelectorAll(".is-drop-target").forEach(node => node.classList.remove("is-drop-target"));
      (host.node ?? canvas).classList.add("is-drop-target");
    });
    wrap.addEventListener("dragleave", () => {
      wrap.querySelectorAll(".is-drop-target").forEach(node => node.classList.remove("is-drop-target"));
    });
    wrap.addEventListener("drop", async (ev) => {
      if (!isElementDrag(ev)) return;
      ev.preventDefault();
      wrap.querySelectorAll(".is-drop-target").forEach(node => node.classList.remove("is-drop-target"));
      const type = ev.dataTransfer.getData("application/x-sduw-element");
      if (!type) return;
      const host = this._containerAt(ev.clientX, ev.clientY);
      const rect = (host.node ?? canvas).getBoundingClientRect();
      const snap = Number(this.document.system.snap ?? 0);
      const x = _snap((ev.clientX - rect.left) / this._zoom, snap);
      const y = _snap((ev.clientY - rect.top) / this._zoom, snap);
      await this._addElement(type, { parent: host.id, x: Math.max(0, x), y: Math.max(0, y) });
    });
    // Marquee selection / deselect on empty space.
    canvas.addEventListener("pointerdown", (ev) => {
      if (ev.target !== canvas) return;
      this._select([]);
      this._beginMarquee(ev);
    });
  }

  /**
   * Innermost container whose *content area* is under a screen point.
   *
   * Hit-testing uses the node children are really appended to (a Border's body,
   * a Canvas Panel's box), so a drop lands where the element will be rendered
   * instead of being offset by the container's padding or title.
   */
  _containerAt(clientX, clientY, { ignore = new Set() } = {}) {
    const canvas = this._regions.canvas;
    const candidates = this._elements
      .filter(el => isContainer(el.type) && !ignore.has(el.id))
      .map(el => ({ el, depth: this._depthOf(el.id), node: this._childHostFor(el.id) }))
      .filter(entry => entry.node)
      .sort((a, b) => b.depth - a.depth);

    for (const entry of candidates) {
      const rect = entry.node.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
        return { id: entry.el.id, node: entry.node, element: entry.el };
      }
    }
    return { id: "", node: this._childHostFor("") ?? canvas, element: null };
  }

  _childHostFor(parentId) {
    return this._tree?.childHostFor?.(parentId)
      ?? (parentId ? this._tree?.nodeFor?.(parentId) : this._regions.canvas)
      ?? this._regions.canvas;
  }

  _depthOf(id) {
    let depth = 0;
    let cursor = this._elements.find(el => el.id === id)?.parent ?? "";
    while (cursor && depth < 32) {
      depth += 1;
      cursor = this._elements.find(el => el.id === cursor)?.parent ?? "";
    }
    return depth;
  }

  /** Ids of an element and everything nested inside it. */
  _subtreeIds(id) {
    const ids = new Set([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const el of this._elements) {
        if (ids.has(el.parent) && !ids.has(el.id)) { ids.add(el.id); grew = true; }
      }
    }
    return ids;
  }

  _wouldCycle(sourceId, parentId) {
    let cursor = parentId;
    while (cursor) {
      if (cursor === sourceId) return true;
      cursor = this._elements.find(el => el.id === cursor)?.parent ?? "";
    }
    return false;
  }

  _beginMarquee(ev) {
    const canvas = this._regions.canvas;
    const rect = canvas.getBoundingClientRect();
    const box = document.createElement("div");
    box.className = "sduw-marquee";
    canvas.appendChild(box);
    const x0 = (ev.clientX - rect.left) / this._zoom;
    const y0 = (ev.clientY - rect.top) / this._zoom;
    const move = (mv) => {
      const x1 = (mv.clientX - rect.left) / this._zoom;
      const y1 = (mv.clientY - rect.top) / this._zoom;
      Object.assign(box.style, {
        left: `${Math.min(x0, x1)}px`, top: `${Math.min(y0, y1)}px`,
        width: `${Math.abs(x1 - x0)}px`, height: `${Math.abs(y1 - y0)}px`
      });
    };
    const pointerWindow = canvas.ownerDocument?.defaultView ?? window;
    const up = (uev) => {
      pointerWindow.removeEventListener("pointermove", move, true);
      pointerWindow.removeEventListener("pointerup", up, true);
      const x1 = (uev.clientX - rect.left) / this._zoom;
      const y1 = (uev.clientY - rect.top) / this._zoom;
      box.remove();
      const minX = Math.min(x0, x1), maxX = Math.max(x0, x1);
      const minY = Math.min(y0, y1), maxY = Math.max(y0, y1);
      if (maxX - minX < 4 && maxY - minY < 4) return;
      const hits = [];
      for (const node of canvas.querySelectorAll("[data-uiw-el]")) {
        const r = node.getBoundingClientRect();
        const nx = (r.left - rect.left) / this._zoom;
        const ny = (r.top - rect.top) / this._zoom;
        const nw = r.width / this._zoom;
        const nh = r.height / this._zoom;
        if (nx + nw >= minX && nx <= maxX && ny + nh >= minY && ny <= maxY) hits.push(node.dataset.uiwEl);
      }
      this._select(hits);
    };
    pointerWindow.addEventListener("pointermove", move, true);
    pointerWindow.addEventListener("pointerup", up, true);
  }

  // ------------------------------------------------------------------
  // Drag / resize (pointer capture, live, no re-render)
  // ------------------------------------------------------------------

  _onNodePointerDown(ev, el, wrapper) {
    if (ev.button !== 0) return;
    ev.stopPropagation();
    ev.preventDefault();
    this._regions.canvas?.focus?.({ preventScroll: true });

    const additive = ev.shiftKey || ev.ctrlKey || ev.metaKey;
    if (!this._selection.has(el.id) || additive) this._select(el.id, { additive });

    const free = this._isFreeParent(el.parent);
    if (!free) return this._beginReorderDrag(ev, el, wrapper);

    const snap = Number(this.document.system.snap ?? 0);
    const moving = (this._selection.size > 1 ? this.selected : [el])
      .filter(item => this._isFreeParent(item.parent) && !item.locked)
      .map(item => ({
        el: item,
        node: this._tree.nodeFor(item.id),
        startX: Number(item.x ?? 0),
        startY: Number(item.y ?? 0)
      }))
      .filter(entry => entry.node);
    if (!moving.length) return;

    const originX = ev.clientX;
    const originY = ev.clientY;
    const guides = this._regions.guides;
    wrapper.classList.add("is-moving");
    const pointerWindow = wrapper.ownerDocument?.defaultView ?? window;
    const captureTarget = wrapper;
    try { captureTarget.setPointerCapture?.(ev.pointerId); } catch {}

    const move = (mv) => {
      const dx = (mv.clientX - originX) / this._zoom;
      const dy = (mv.clientY - originY) / this._zoom;
      for (const entry of moving) {
        let nx = entry.startX + dx;
        let ny = entry.startY + dy;
        if (!mv.altKey) { nx = _snap(nx, snap); ny = _snap(ny, snap); }
        if (entry.el.parent) {
          const hostRect = this._childHostFor(entry.el.parent)?.getBoundingClientRect?.();
          const nodeRect = entry.node.getBoundingClientRect();
          if (hostRect) {
            nx = _clamp(nx, 0, Math.max(0, (hostRect.width - nodeRect.width) / this._zoom));
            ny = _clamp(ny, 0, Math.max(0, (hostRect.height - nodeRect.height) / this._zoom));
          }
        }
        entry.pendingX = Math.round(nx);
        entry.pendingY = Math.round(ny);
        this._applyLivePosition(entry.el, entry.node, entry.pendingX, entry.pendingY);
      }
      if (moving.length === 1) this._showGuides(moving[0], guides);
      this._highlightDropContainer(mv, moving);
    };

    const up = async (uev) => {
      try { captureTarget.releasePointerCapture?.(ev.pointerId); } catch {}
      pointerWindow.removeEventListener("pointermove", move, true);
      pointerWindow.removeEventListener("pointerup", up, true);
      pointerWindow.removeEventListener("pointercancel", up, true);
      wrapper.classList.remove("is-moving");
      if (guides) guides.innerHTML = "";
      this._clearDropHighlight();
      const changed = moving.filter(entry => entry.pendingX !== undefined);
      if (!changed.length) return;

      // Dropped over another container? Move the element into it.
      const target = uev ? this._dropContainerFor(uev, moving) : null;
      if (target) {
        await this._reparentDragged(changed, target);
        return;
      }

      const elements = foundry.utils.deepClone(this._elements);
      for (const entry of changed) {
        const index = elements.findIndex(item => item.id === entry.el.id);
        if (index < 0) continue;
        elements[index].x = entry.pendingX;
        elements[index].y = entry.pendingY;
      }
      // Canvas stays as-is: the nodes already sit where the user dropped them.
      await this._commit(elements, { canvas: false, hierarchy: false });
      this._syncDetailsGeometry();
    };

    pointerWindow.addEventListener("pointermove", move, true);
    pointerWindow.addEventListener("pointerup", up, true);
    pointerWindow.addEventListener("pointercancel", up, true);
  }

  /**
   * Container under the pointer that the dragged elements could be moved into,
   * or null when they should stay where they are.
   */
  _dropContainerFor(ev, moving) {
    const ignore = new Set();
    for (const entry of moving) for (const id of this._subtreeIds(entry.el.id)) ignore.add(id);
    const target = this._containerAt(ev.clientX, ev.clientY, { ignore });
    const currentParents = new Set(moving.map(entry => entry.el.parent ?? ""));
    if (currentParents.size === 1 && currentParents.has(target.id)) return null;
    // Never silently eject a child to the root canvas. Moving to another
    // container is direct-manipulation; moving to root is an explicit action in
    // Hierarchy. This prevents a one-pixel miss at a panel edge from destroying
    // the intended widget hierarchy.
    if (!target.id && [...currentParents].some(Boolean)) return null;
    if (moving.some(entry => this._wouldCycle(entry.el.id, target.id))) return null;
    return target;
  }

  _highlightDropContainer(ev, moving) {
    const target = this._dropContainerFor(ev, moving);
    if (this._dropHighlight === target?.node) return;
    this._clearDropHighlight();
    if (!target?.node) return;
    target.node.classList.add("is-drop-target");
    this._dropHighlight = target.node;
  }

  _clearDropHighlight() {
    this._dropHighlight?.classList.remove("is-drop-target");
    this._dropHighlight = null;
  }

  /**
   * Move dragged elements into `target`, keeping their on-screen position: the
   * live node rectangle is converted into the new container's coordinate space.
   */
  async _reparentDragged(moving, target) {
    const hostRect = target.node.getBoundingClientRect();
    const freeTarget = this._isFreeParent(target.id);
    const snap = Number(this.document.system.snap ?? 0);
    const elements = foundry.utils.deepClone(this._elements);

    for (const entry of moving) {
      const index = elements.findIndex(item => item.id === entry.el.id);
      if (index < 0) continue;
      const moved = elements[index];
      moved.parent = target.id;
      if (!freeTarget) continue;
      const rect = entry.node.getBoundingClientRect();
      const anchor = moved.anchor ?? "top-left";
      const localLeft = (rect.left - hostRect.left) / this._zoom;
      const localTop = (rect.top - hostRect.top) / this._zoom;
      const localRight = (hostRect.right - rect.right) / this._zoom;
      const localBottom = (hostRect.bottom - rect.bottom) / this._zoom;
      const x = anchor.endsWith("-right") ? localRight : localLeft;
      const y = anchor.startsWith("bottom") ? localBottom : localTop;
      moved.x = Math.round(_snap(Math.max(0, x), snap));
      moved.y = Math.round(_snap(Math.max(0, y), snap));
    }
    await this._commit(elements, { details: true });
  }

  /** Write x/y onto a live node honouring its anchor, without a rebuild. */
  _applyLivePosition(el, node, x, y) {
    const anchor = el.anchor ?? "top-left";
    const usesRight = anchor.endsWith("-right");
    const usesBottom = anchor.startsWith("bottom");
    if (anchor === "center" || anchor === "top-center" || anchor === "bottom-center") {
      node.style.left = `calc(50% + ${x}px)`;
    } else if (usesRight) {
      node.style.right = `${x}px`;
    } else {
      node.style.left = `${x}px`;
    }
    if (anchor === "center" || anchor === "middle-left" || anchor === "middle-right") {
      node.style.top = `calc(50% + ${y}px)`;
    } else if (usesBottom) {
      node.style.bottom = `${y}px`;
    } else {
      node.style.top = `${y}px`;
    }
  }

  _showGuides(entry, guides) {
    if (!guides) return;
    guides.innerHTML = "";
    const el = entry.el;
    const x = entry.pendingX ?? el.x;
    const y = entry.pendingY ?? el.y;
    const w = Number(el.w ?? 0), hh = Number(el.h ?? 0);
    const siblings = childrenOf(this._elements, el.parent).filter(other => other.id !== el.id);
    const mkGuide = (vertical, at) => {
      const line = document.createElement("div");
      line.className = `sduw-guide ${vertical ? "is-v" : "is-h"}`;
      line.style[vertical ? "left" : "top"] = `${at}px`;
      guides.appendChild(line);
    };
    for (const other of siblings) {
      const ox = Number(other.x ?? 0), oy = Number(other.y ?? 0);
      const ow = Number(other.w ?? 0), oh = Number(other.h ?? 0);
      for (const [a, b] of [[x, ox], [x + w, ox + ow], [x + w / 2, ox + ow / 2]]) {
        if (Math.abs(a - b) <= 2) mkGuide(true, b);
      }
      for (const [a, b] of [[y, oy], [y + hh, oy + oh], [y + hh / 2, oy + oh / 2]]) {
        if (Math.abs(a - b) <= 2) mkGuide(false, b);
      }
    }
  }

  _onResizePointerDown(ev, el, wrapper, dir) {
    ev.preventDefault();
    const snap = Number(this.document.system.snap ?? 0);
    const startX = ev.clientX, startY = ev.clientY;
    const start = { x: Number(el.x ?? 0), y: Number(el.y ?? 0), w: Number(el.w ?? 40), h: Number(el.h ?? 20) };
    let pending = { ...start };
    wrapper.classList.add("is-resizing");
    const pointerWindow = wrapper.ownerDocument?.defaultView ?? window;
    const captureTarget = wrapper;
    try { captureTarget.setPointerCapture?.(ev.pointerId); } catch {}

    const move = (mv) => {
      const dx = (mv.clientX - startX) / this._zoom;
      const dy = (mv.clientY - startY) / this._zoom;
      const next = { ...start };
      if (dir.includes("e")) next.w = Math.max(16, start.w + dx);
      if (dir.includes("s")) next.h = Math.max(12, start.h + dy);
      if (dir.includes("w")) { next.w = Math.max(16, start.w - dx); next.x = start.x + (start.w - next.w); }
      if (dir.includes("n")) { next.h = Math.max(12, start.h - dy); next.y = start.y + (start.h - next.h); }
      if (!mv.altKey) {
        next.w = Math.max(16, _snap(next.w, snap));
        next.h = Math.max(12, _snap(next.h, snap));
        next.x = _snap(next.x, snap);
        next.y = _snap(next.y, snap);
      }
      pending = {
        x: Math.round(next.x), y: Math.round(next.y),
        w: Math.round(next.w), h: Math.round(next.h)
      };
      wrapper.style.width = `${pending.w}px`;
      wrapper.style.height = `${pending.h}px`;
      this._applyLivePosition(el, wrapper, pending.x, pending.y);
    };

    const up = async () => {
      try { captureTarget.releasePointerCapture?.(ev.pointerId); } catch {}
      pointerWindow.removeEventListener("pointermove", move, true);
      pointerWindow.removeEventListener("pointerup", up, true);
      pointerWindow.removeEventListener("pointercancel", up, true);
      wrapper.classList.remove("is-resizing");
      await this._patchElement(el.id, pending, { canvas: false, hierarchy: false });
      this._syncDetailsGeometry();
      // Children of a resized container may need to reflow.
      if (isContainer(el.type)) this._rebuildCanvas();
    };

    pointerWindow.addEventListener("pointermove", move, true);
    pointerWindow.addEventListener("pointerup", up, true);
    pointerWindow.addEventListener("pointercancel", up, true);
  }

  /** Drag inside a flow container: reorder among siblings, or move to another container. */
  _beginReorderDrag(ev, el, wrapper) {
    wrapper.classList.add("is-reordering");
    const siblings = childrenOf(this._elements, el.parent);
    const moving = [{ el, node: wrapper }];
    const pointerWindow = wrapper.ownerDocument?.defaultView ?? window;
    const move = (mv) => this._highlightDropContainer(mv, moving);
    const up = async (uev) => {
      pointerWindow.removeEventListener("pointermove", move, true);
      pointerWindow.removeEventListener("pointerup", up, true);
      wrapper.classList.remove("is-reordering");
      this._clearDropHighlight();

      const target = this._dropContainerFor(uev, moving);
      if (target) return void await this._reparentDragged(moving, target);

      let targetId = null;
      let before = false;
      for (const sibling of siblings) {
        if (sibling.id === el.id) continue;
        const node = this._tree.nodeFor(sibling.id);
        if (!node) continue;
        const rect = node.getBoundingClientRect();
        if (uev.clientY >= rect.top && uev.clientY <= rect.bottom && uev.clientX >= rect.left && uev.clientX <= rect.right) {
          targetId = sibling.id;
          before = (uev.clientY - rect.top) < rect.height / 2;
          break;
        }
      }
      if (!targetId) return;
      await this._moveBefore(el.id, targetId, before);
    };
    pointerWindow.addEventListener("pointermove", move, true);
    pointerWindow.addEventListener("pointerup", up, true);
  }

  async _moveBefore(sourceId, targetId, before = true) {
    const elements = foundry.utils.deepClone(this._elements);
    const from = elements.findIndex(el => el.id === sourceId);
    if (from < 0) return;
    const [moved] = elements.splice(from, 1);
    const to = elements.findIndex(el => el.id === targetId);
    elements.splice(before ? Math.max(0, to) : to + 1, 0, moved);
    await this._commit(elements);
  }

  // ------------------------------------------------------------------
  // Keyboard
  // ------------------------------------------------------------------

  _wireKeyboard(root) {
    root.addEventListener("keydown", async (ev) => {
      const tag = ev.target?.tagName;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(tag)) return;
      if (!this._selection.size) return;
      const step = ev.shiftKey ? 10 : (Number(this.document.system.snap) || 1);
      const nudge = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[ev.key];
      if (nudge) {
        ev.preventDefault();
        const elements = foundry.utils.deepClone(this._elements);
        for (const id of this._selection) {
          const index = elements.findIndex(el => el.id === id);
          if (index < 0 || !this._isFreeParent(elements[index].parent)) continue;
          elements[index].x = Number(elements[index].x ?? 0) + nudge[0];
          elements[index].y = Number(elements[index].y ?? 0) + nudge[1];
        }
        await this._commit(elements, { hierarchy: false, details: true });
        return;
      }
      if (ev.key === "Delete") {
        ev.preventDefault();
        await this._deleteSelection();
        return;
      }
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "d") {
        ev.preventDefault();
        await this._duplicateSelection();
        return;
      }
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "z") {
        ev.preventDefault();
        await this._undo();
      }
    });
  }

  // ------------------------------------------------------------------
  // Element operations
  // ------------------------------------------------------------------

  /**
   * Where a palette click puts a new element: inside the selected container, or
   * next to the selected element. Dropping with the mouse overrides this.
   */
  _defaultParentForNew() {
    const primary = this.primary;
    if (!primary) return "";
    if (isContainer(primary.type)) return primary.id;
    return primary.parent ?? "";
  }

  async _addElement(type, overrides = {}) {
    const parent = overrides.parent === undefined ? this._defaultParentForNew() : overrides.parent;
    const count = this._elements.filter(item => item.type === type).length;
    const defaults = { name: `${type}_${count + 1}`, id: uniqueId(this._elements, `${type}_${count + 1}`, { fallback: type }) };
    const identity = await foundry.applications.api.DialogV2.prompt({
      window:{title:`Add ${game.i18n.localize(elementDef(type)?.label ?? type)}`},
      content:`<form class="sduw-identity-dialog"><label>Display Name<input name="displayName" value="${_esc(defaults.name)}" autofocus></label><label>Widget ID<input name="widgetId" value="${_esc(defaults.id)}"></label><p>Names may repeat. Widget ID must be unique.</p></form>`,
      ok:{callback:(_e,b)=>({name:String(b.form.elements.displayName.value).trim()||type,id:safeId(b.form.elements.widgetId.value,type)})}
    }).catch(()=>null);
    if (!identity) return;
    if (this._elements.some(item => item.id === identity.id)) { ui.notifications?.error?.(`Widget ID '${identity.id}' is already used.`); return; }
    const el = createElement(type, { ...overrides, parent, id: identity.id, widgetId: identity.id, name: identity.name });
    const elements = [...foundry.utils.deepClone(this._elements), el];
    this._selection = new Set([el.id]);
    await this._commit(elements, { details: true });
  }

  async _duplicateSelection() {
    const elements = foundry.utils.deepClone(this._elements);
    const newIds = [];
    for (const el of this.selected) {
      const clone = foundry.utils.deepClone(el);
      clone.id = uniqueId(elements, `${el.id}_copy`, { fallback: `${el.type}_copy` }); clone.widgetId = clone.id;
      clone.name = `${el.name}_copy`;
      clone.x = Number(el.x ?? 0) + 12;
      clone.y = Number(el.y ?? 0) + 12;
      elements.push(clone);
      newIds.push(clone.id);
      // Deep-copy children of containers.
      if (isContainer(el.type)) {
        const stack = [[el.id, clone.id]];
        while (stack.length) {
          const [oldParent, newParent] = stack.pop();
          for (const child of childrenOf(this._elements, oldParent)) {
            const childClone = foundry.utils.deepClone(child);
            childClone.id = uniqueId(elements, `${child.id}_copy`, { fallback: `${child.type}_copy` }); childClone.widgetId = childClone.id;
            childClone.parent = newParent;
            elements.push(childClone);
            if (isContainer(child.type)) stack.push([child.id, childClone.id]);
          }
        }
      }
    }
    this._selection = new Set(newIds);
    await this._commit(elements, { details: true });
  }

  async _deleteSelection() {
    const doomed = new Set(this._selection);
    // Cascade to descendants.
    let grew = true;
    while (grew) {
      grew = false;
      for (const el of this._elements) {
        if (doomed.has(el.parent) && !doomed.has(el.id)) { doomed.add(el.id); grew = true; }
      }
    }
    const elements = foundry.utils.deepClone(this._elements).filter(el => !doomed.has(el.id));
    this._selection.clear();
    await this._commit(elements, { details: true });
  }

  async _undo() {
    const previous = this._undoStack.pop();
    if (!previous) return;
    this._elements = previous;
    await this.document.update({ "system.elements": previous }, NO_RENDER);
    this._rebuildCanvas();
    this._rebuildHierarchy();
    this._rebuildDetails();
  }

  async _reparent(sourceId, parentId) {
    if (sourceId === parentId) return;
    if (this._wouldCycle(sourceId, parentId)) return;
    await this._patchElement(sourceId, { parent: parentId ?? "", x: 8, y: 8 }, { details: true });
  }

  async _fitCanvas() {
    let maxW = 200, maxH = 120;
    for (const el of childrenOf(this._elements, "")) {
      maxW = Math.max(maxW, Number(el.x ?? 0) + Number(el.w ?? 0));
      maxH = Math.max(maxH, Number(el.y ?? 0) + Number(el.h ?? 0));
    }
    await this.document.update({
      "system.canvas.w": Math.ceil(maxW + 16),
      "system.canvas.h": Math.ceil(maxH + 16)
    }, NO_RENDER);
    const root = this.element;
    if (root) {
      const wInput = root.querySelector('[name="system.canvas.w"]');
      const hInput = root.querySelector('[name="system.canvas.h"]');
      if (wInput) wInput.value = String(Math.ceil(maxW + 16));
      if (hInput) hInput.value = String(Math.ceil(maxH + 16));
    }
    this._rebuildCanvas();
  }

  // ------------------------------------------------------------------
  // Hierarchy
  // ------------------------------------------------------------------

  _rebuildHierarchy() {
    const host = this._regions.hierarchy;
    if (!host) return;
    host.innerHTML = "";
    const rootDrop = document.createElement("div");
    rootDrop.className = "sduw-tree-root";
    rootDrop.textContent = game.i18n.localize("SDUI.Editor.RootCanvas");
    rootDrop.addEventListener("dragover", (ev) => { ev.preventDefault(); rootDrop.classList.add("is-drop-target"); });
    rootDrop.addEventListener("dragleave", () => rootDrop.classList.remove("is-drop-target"));
    rootDrop.addEventListener("drop", async (ev) => {
      ev.preventDefault();
      rootDrop.classList.remove("is-drop-target");
      const id = ev.dataTransfer.getData("application/x-sduw-move");
      if (id) await this._reparent(id, "");
    });
    host.appendChild(rootDrop);

    const build = (parentId, depth) => {
      for (const el of childrenOf(this._elements, parentId)) {
        const row = document.createElement("div");
        row.className = "sduw-tree-row";
        row.dataset.elId = el.id;
        row.style.paddingLeft = `${6 + depth * 12}px`;
        row.draggable = true;
        row.innerHTML = `
          <i class="fa-solid ${elementDef(el.type)?.icon ?? "fa-cube"}"></i>
          <span class="sduw-tree-name">${_esc(el.name)}</span>
          <span class="sduw-tree-type">${_esc(el.type)}</span>
          <button type="button" class="sduw-tree-btn" data-op="hide" title="${game.i18n.localize("SDUI.Editor.ToggleHidden")}">
            <i class="fa-solid ${el.hidden ? "fa-eye-slash" : "fa-eye"}"></i>
          </button>
          <button type="button" class="sduw-tree-btn" data-op="lock" title="${game.i18n.localize("SDUI.Editor.ToggleLocked")}">
            <i class="fa-solid ${el.locked ? "fa-lock" : "fa-lock-open"}"></i>
          </button>`;
        row.addEventListener("click", (ev) => {
          const op = ev.target.closest("[data-op]")?.dataset.op;
          if (op === "hide") return void this._patchElement(el.id, { hidden: !el.hidden }, { details: true });
          if (op === "lock") return void this._patchElement(el.id, { locked: !el.locked }, { details: true });
          this._select(el.id, { additive: ev.shiftKey || ev.ctrlKey });
        });
        row.addEventListener("dragstart", (ev) => {
          ev.dataTransfer.setData("application/x-sduw-move", el.id);
          ev.dataTransfer.effectAllowed = "move";
        });
        row.addEventListener("dragover", (ev) => {
          ev.preventDefault();
          row.classList.add(isContainer(el.type) ? "is-drop-into" : "is-drop-before");
        });
        row.addEventListener("dragleave", () => row.classList.remove("is-drop-into", "is-drop-before"));
        row.addEventListener("drop", async (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          row.classList.remove("is-drop-into", "is-drop-before");
          const id = ev.dataTransfer.getData("application/x-sduw-move");
          if (!id || id === el.id) return;
          if (isContainer(el.type)) await this._reparent(id, el.id);
          else await this._moveBefore(id, el.id, true);
        });
        host.appendChild(row);
        if (isContainer(el.type)) build(el.id, depth + 1);
      }
    };
    build("", 0);
    this._syncSelectionClasses();
  }

  // ------------------------------------------------------------------
  // Details panel
  // ------------------------------------------------------------------

  _rebuildDetails() {
    const host = this._regions.details;
    if (!host) return;
    host.innerHTML = "";
    const sel = this.selected;
    if (!sel.length) {
      host.appendChild(this._hint(game.i18n.localize("SDUI.Editor.NoSelection")));
      return;
    }
    if (sel.length > 1) {
      host.appendChild(this._hint(game.i18n.format("SDUI.Editor.MultiSelection", { count: sel.length })));
      host.appendChild(this._alignTools(sel));
      return;
    }
    const el = sel[0];
    const def = elementDef(el.type);

    // Identity
    const identity = this._group("SDUI.Editor.GroupIdentity");
    identity.appendChild(this._row("SDUI.Prop.Name", this._textInput(el.name, async (value) => {
      await this._patchElement(el.id, { name: value }, { details: false });
    })));
    identity.appendChild(this._row("Widget ID", this._static(el.id)));
    identity.appendChild(this._row("SDUI.Prop.Type", this._static(game.i18n.localize(def?.label ?? el.type))));
    host.appendChild(identity);

    // Layout
    const layout = this._group("SDUI.Editor.GroupLayout");
    const geometry = document.createElement("div");
    geometry.className = "sduw-geometry";
    for (const key of ["x", "y", "w", "h", "z"]) {
      const input = this._numberInput(Number(el[key] ?? 0), async (value) => {
        await this._patchElement(el.id, { [key]: value }, { hierarchy: false });
      });
      input.dataset.geometry = key;
      geometry.appendChild(this._row(`SDUI.Prop.${key.toUpperCase()}`, input, { compact: true }));
    }
    layout.appendChild(geometry);
    layout.appendChild(this._row("SDUI.Prop.Anchor", this._selectInput(ANCHOR_PRESETS, el.anchor ?? "top-left",
      async (value) => { await this._patchElement(el.id, { anchor: value }); },
      (value) => game.i18n.localize(`SDUI.Anchor.${value}`))));
    layout.appendChild(this._row("SDUI.Prop.Grow", this._numberInput(Number(el.grow ?? 0), async (value) => {
      await this._patchElement(el.id, { grow: value });
    })));
    layout.appendChild(this._row("SDUI.Prop.Parent", this._selectInput(
      ["", ...this._elements.filter(item => isContainer(item.type) && item.id !== el.id).map(item => item.id)],
      el.parent ?? "",
      async (value) => { await this._reparent(el.id, value); },
      (value) => value ? (this._elements.find(item => item.id === value)?.name ?? value) : game.i18n.localize("SDUI.Editor.RootCanvas")
    )));
    host.appendChild(layout);

    // Type-specific properties, grouped.
    const schema = propSchema(el.type);
    for (const groupId of ["content", "data", "appearance", "behaviour"]) {
      const props = schema.filter(p => (p.group ?? "content") === groupId);
      if (!props.length) continue;
      const group = this._group(`SDUI.Editor.Group${groupId.charAt(0).toUpperCase()}${groupId.slice(1)}`);
      for (const prop of props) group.appendChild(this._propRow(el, prop));
      host.appendChild(group);
    }

    // Events
    const events = [...(def?.events ?? []), ...UNIVERSAL_EVENTS];
    if (events.length) {
      const group = this._group("SDUI.Editor.GroupEvents");
      for (const eventKey of events) group.appendChild(this._eventRow(el, eventKey));
      host.appendChild(group);
    }

    // Tools
    const tools = document.createElement("div");
    tools.className = "sduw-details-tools";
    tools.appendChild(this._button("SDUI.Editor.Duplicate", "fa-clone", () => this._duplicateSelection()));
    tools.appendChild(this._button("SDUI.Editor.Delete", "fa-trash", () => this._deleteSelection(), "is-danger"));
    if (el.type === "sdwidget") {
      tools.appendChild(this._button("SDUI.Editor.FullConfig", "fa-sliders", () => this._openSystemWidgetConfig(el)));
    }
    host.appendChild(tools);
  }

  /** Keep the geometry inputs in sync after a drag, without a panel rebuild. */
  _syncDetailsGeometry() {
    const el = this.primary;
    const host = this._regions.details;
    if (!el || !host) return;
    for (const key of ["x", "y", "w", "h", "z"]) {
      const input = host.querySelector(`[data-geometry="${key}"]`);
      const fresh = this._elements.find(item => item.id === el.id);
      if (input && fresh) input.value = String(Number(fresh[key] ?? 0));
    }
    this._updateStatus();
  }

  _propRow(el, prop) {
    const isStyle = !!prop.style;
    const bag = isStyle ? (el.style ?? {}) : (el.props ?? {});
    const current = bag[prop.key];
    const commit = async (value) => {
      const patch = isStyle ? { style: { [prop.key]: value } } : { props: { [prop.key]: value } };
      await this._patchElement(el.id, patch, { hierarchy: false });
    };

    let input;
    switch (prop.type) {
      case "number":
        input = this._numberInput(current === undefined ? (prop.default ?? 0) : Number(current), commit);
        break;
      case "checkbox":
        input = this._checkboxInput(current === undefined ? !!prop.default : !!current, commit);
        break;
      case "select":
        input = this._selectInput(prop.options ?? [], String(current ?? prop.default ?? ""), commit);
        break;
      case "color":
        input = this._colorInput(String(current ?? prop.default ?? ""), commit);
        break;
      case "textarea":
        input = this._textareaInput(String(current ?? prop.default ?? ""), commit);
        break;
      case "image":
        input = this._imageInput(String(current ?? prop.default ?? ""), commit);
        break;
      case "path":
        input = this._pathInput(String(current ?? prop.default ?? ""), commit);
        break;
      case "sdWidgetType":
        input = this._sdWidgetTypeInput(el);
        break;
      case "sdWidgetConfig":
        input = this._button("SDUI.Editor.FullConfig", "fa-sliders", () => this._openSystemWidgetConfig(el));
        break;
      case "formula":
      case "text":
      default:
        input = this._textInput(String(current ?? prop.default ?? ""), commit);
        break;
    }

    const row = this._row(prop.label, input, { hint: prop.hint });
    if (prop.bindable) row.appendChild(this._bindingControl(el, prop));
    return row;
  }

  /** UMG-style property binding: a formula that overrides the static value. */
  _bindingControl(el, prop) {
    const wrap = document.createElement("div");
    wrap.className = "sduw-binding";
    const current = el.bind?.[prop.key];
    const select = document.createElement("select"); select.className="sduw-bind-input";
    select.appendChild(new Option("Not bound", ""));
    for (const variable of normalizeVariables(this.document.system.variables)) {
      const option=new Option(`${variable.name} · ${variable.type}`,variable.id);
      if(current?.kind==="variable"&&current.variableId===variable.id)option.selected=true;
      select.appendChild(option);
    }
    select.addEventListener("change",async()=>this._setElement(el.id,target=>{target.bind??={};if(select.value)target.bind[prop.key]={kind:"variable",variableId:select.value};else delete target.bind[prop.key];},{hierarchy:false}));
    const icon=document.createElement("i");icon.className="fa-solid fa-link";wrap.append(icon,select);
    return wrap;
  }

  _eventRow(el, eventKey) {
    const row = document.createElement("div");
    row.className = "sduw-event-row";
    const normalized = String(eventKey).replace(/^on/, "").toLowerCase();
    const has = !!this._mainEventNode(el.id, normalized) || !!el.events?.[eventKey]?.formula;
    row.innerHTML = `<span class="sduw-event-name ${has ? "is-set" : ""}" title="${_esc(eventKey)}">
      <i class="fa-solid ${has ? "fa-bolt" : "fa-bolt-lightning"}"></i>${_esc(eventLabel(eventKey))}</span>`;
    const edit = this._button(has ? "SDUI.Editor.EditGraph" : "SDUI.Editor.AddGraph", "fa-diagram-project",
      () => this._openEventGraph(el, eventKey));
    row.appendChild(edit);
    return row;
  }

  _mainEventNode(widgetId, event) {
    return (this.document.system.eventGraph?.nodes ?? []).find(node =>
      node.type === "ui_widget_event"
      && String(node.data?.widgetId ?? "") === String(widgetId ?? "")
      && String(node.data?.event ?? "click").replace(/^on/, "").toLowerCase() === String(event ?? "").replace(/^on/, "").toLowerCase()
    ) ?? null;
  }

  /** Open the one shared Blueprint graph and create/focus this widget trigger. */
  async _openEventGraph(el, eventKey) {
    return this._openMainGraph({ widgetId: el.id, event: String(eventKey).replace(/^on/, "").toLowerCase() });
  }

  async _openMainGraph({ widgetId = "", event = "" } = {}) {
    const { FormulaGraph } = await import("/systems/sd/module/builder/formula-graph.mjs");
    const current = foundry.utils.deepClone(this.document.system.eventGraph ?? { nodes: [], edges: [], comments: [] });
    current.nodes ??= []; current.edges ??= []; current.comments ??= [];
    const blueprintId = this.document.system.blueprintId ?? this.document.system.widgetKey;
    let focusId = "";
    if (widgetId && event) {
      let node = current.nodes.find(entry => entry.type === "ui_widget_event" && entry.data?.widgetId === widgetId && entry.data?.event === event);
      if (!node) {
        node = { id:foundry.utils.randomID(12), type:"ui_widget_event", x:80, y:100 + current.nodes.length * 90,
          data:{ blueprintId, widgetId, event, name:`${widgetId}:${event}` } };
        current.nodes.push(node);
      }
      focusId = node.id;
    } else if (!current.nodes.some(node => node.type === "ui_blueprint_event")) {
      const node = { id:foundry.utils.randomID(12), type:"ui_blueprint_event", x:80, y:120,
        data:{ blueprintId, event:"open", name:"open" } };
      current.nodes.push(node);
      focusId = node.id;
    }
    const graph = new FormulaGraph(null, this.document, null, null, null, {
      mode: "actionGraph",
      actionGraphContext: `ui-blueprint:${blueprintId}`,
      entryTitle: `Main Blueprint Graph — ${this.document.system.title ?? this.document.name}`,
      customLoad: () => current,
      customSave: async (graphData, compiled) => {
        await this.document.update({ "system.eventGraph": { ...graphData, compiled:String(compiled ?? "") } }, { render:false });
        this._rebuildDetails();
      }
    });
    graph.open();
    if (focusId) setTimeout(() => {
      graph._selectNode?.(focusId);
      graph._debugFocus?.(focusId);
    }, 80);
    return graph;
  }

  /** Configure the hosted system widget through the system's own popup. */
  async _openSystemWidgetConfig(el) {
    const { openWidgetConfigPopup } = await import("/systems/sd/module/builder/widget-config-popup.mjs");
    const { createWidget } = await import("/systems/sd/module/builder/widget-registry.mjs");
    let widget = el.props?.widget;
    if (!widget?.type) {
      const type = el.props?.widgetType;
      if (!type) {
        ui.notifications?.warn?.(game.i18n.localize("SDUI.Runtime.PickWidgetType"));
        return;
      }
      widget = createWidget(type);
    }
    if (!widget.id) widget.id = foundry.utils.randomID(8);
    const tab = { id: "sduw", label: "UI Widget", rows: [{ id: "sduw-row", widgets: [widget] }] };
    const row = tab.rows[0];
    await openWidgetConfigPopup(widget, tab, row, this.document, {
      embedded: true,
      onSave: async (updated) => {
        await this._patchElement(el.id, { props: { widget: { ...widget, ...updated } } }, { details: true });
      }
    });
  }

  _sdWidgetTypeInput(el) {
    const wrap = document.createElement("div");
    wrap.className = "sduw-sdwidget-type";
    const select = document.createElement("select");
    const current = String(el.props?.widgetType ?? el.props?.widget?.type ?? "");
    select.appendChild(new Option(game.i18n.localize("SDUI.Editor.PickType"), ""));
    const registry = globalThis.SD_WIDGET_TYPES ?? {};
    for (const [type, def] of Object.entries(registry)) {
      if (type === "widgetBuilder") continue;
      const option = new Option(`${def.label ?? type}`, type);
      if (type === current) option.selected = true;
      select.appendChild(option);
    }
    select.addEventListener("change", async () => {
      const type = select.value;
      if (!type) {
        await this._patchElement(el.id, { props: { widgetType: "", widget: null } }, { details: true });
        return;
      }
      const { createWidget } = await import("/systems/sd/module/builder/widget-registry.mjs");
      const widget = createWidget(type);
      await this._patchElement(el.id, { props: { widgetType: type, widget } }, { details: true });
    });
    wrap.appendChild(select);
    return wrap;
  }

  // ------------------------------------------------------------------
  // Variables panel
  // ------------------------------------------------------------------

  _rebuildVariables() {
    const host = this._regions.variables;
    if (!host) return;
    host.innerHTML = "";
    const variables = normalizeVariables(this.document.system.variables);

    const graphHead=document.createElement("div");graphHead.className="sduw-myblueprint-title";graphHead.innerHTML=`<i class="fa-solid fa-diagram-project"></i><span>Main Blueprint Graph</span>`;host.appendChild(graphHead);
    const triggerCount=(this.document.system.eventGraph?.nodes??[]).filter(node=>node.type==="ui_widget_event"||node.type==="ui_blueprint_event"||node.type==="ui_custom_event_entry").length;
    const graphButton=this._button(`Open shared graph · ${triggerCount} trigger${triggerCount===1?"":"s"}`,"fa-diagram-project",()=>this._openMainGraph());
    graphButton.classList.add("is-primary");host.appendChild(graphButton);

    const widgetHead=document.createElement("div");widgetHead.className="sduw-myblueprint-title";widgetHead.innerHTML=`<i class="fa-solid fa-cubes"></i><span>Widgets</span><b>${this._elements.length}</b>`;host.appendChild(widgetHead);
    for (const widget of this._elements) {
      const row = document.createElement("div");
      row.className = "sduw-blueprint-row";
      row.draggable = true;
      row.innerHTML = `<i class="fa-solid ${elementDef(widget.type)?.icon ?? "fa-cube"}"></i><span>${_esc(widget.name)}</span><code>${_esc(widget.id)}</code>`;
      row.addEventListener("dragstart", event => event.dataTransfer.setData("text/plain", JSON.stringify({
        _sgMenu: [
          { type: "ui_widget_ref", label: `Get ${widget.name}` },
          { type: "ui_get_widget_property", label: `Get ${widget.name} Property` },
          { type: "ui_set_widget_property", label: `Set ${widget.name} Property` },
          { type: "ui_widget_event", label: `Bind ${widget.name} Event` }
        ],
        blueprintId: this.document.system.blueprintId ?? this.document.system.widgetKey,
        widgetId: widget.id
      })));
      row.addEventListener("dblclick", () => this._select(widget.id));
      host.appendChild(row);
    }
    const varHead=document.createElement("div");varHead.className="sduw-myblueprint-title";varHead.innerHTML=`<i class="fa-solid fa-cube"></i><span>Variables</span><b>${variables.length}</b>`;host.appendChild(varHead);

    const save = async (list) => {
      await this.document.update({ "system.variables": list }, NO_RENDER);
      this._state = new UIWidgetState(this.document, { actor: null });
      this._rebuildVariables();
      this._rebuildCanvas();
    };

    for (const [index, variable] of variables.entries()) {
      const row = document.createElement("div");
      row.className = "sduw-var-row";
      row.draggable = true;
      row.addEventListener("dragstart", event => event.dataTransfer.setData("text/plain", JSON.stringify({
        _sgMenu: [
          { type: "ui_get_variable", label: `Get ${variable.name}` },
          { type: "ui_set_variable_v3", label: `Set ${variable.name}` }
        ],
        blueprintId: this.document.system.blueprintId ?? this.document.system.widgetKey,
        widgetKey: this.document.system.blueprintId ?? this.document.system.widgetKey,
        variableId: variable.id
      })));

      const name = document.createElement("input");
      name.type = "text";
      name.value = String(variable.name ?? "");
      name.placeholder = "hp";
      name.addEventListener("change", async () => {
        const list = foundry.utils.deepClone(variables);
        list[index].name = name.value.trim();
        await save(list);
      });

      const type = document.createElement("select");
      for (const value of VAR_TYPES) {
        const option = new Option(game.i18n.localize(`SDUI.VarType.${value}`), value);
        if (value === (variable.type ?? "any")) option.selected = true;
        type.appendChild(option);
      }
      type.addEventListener("change", async () => {
        const list = foundry.utils.deepClone(variables);
        list[index].type = type.value;
        await save(list);
      });

      const scope = document.createElement("select");
      for (const value of VAR_SCOPES) {
        const option = new Option(game.i18n.localize(`SDUI.VarScope.${value}`), value);
        if (value === (variable.scope ?? "local")) option.selected = true;
        scope.appendChild(option);
      }
      scope.title = game.i18n.localize("SDUI.Editor.ScopeHint");
      scope.addEventListener("change", async () => {
        const list = foundry.utils.deepClone(variables);
        list[index].scope = scope.value;
        await save(list);
      });

      const dflt = document.createElement("input");
      dflt.type = "text";
      dflt.value = variable.default === undefined ? "" : String(variable.default);
      dflt.placeholder = game.i18n.localize("SDUI.Prop.Default");
      dflt.addEventListener("change", async () => {
        const list = foundry.utils.deepClone(variables);
        list[index].default = dflt.value;
        await save(list);
      });

      const remove = this._button("", "fa-trash", async () => {
        const list = foundry.utils.deepClone(variables);
        list.splice(index, 1);
        await save(list);
      }, "is-danger");

      const expose=document.createElement("label"),check=document.createElement("input");check.type="checkbox";check.checked=!!variable.exposeOnSpawn;check.addEventListener("change",async()=>{const list=foundry.utils.deepClone(variables);list[index].exposeOnSpawn=check.checked;await save(list)});expose.append(check,document.createTextNode("Spawn"));
      row.append(name, type, scope, dflt, expose, remove);
      host.appendChild(row);
    }

    const add = this._button("SDUI.Editor.AddVariable", "fa-plus", async () => {
      const list = [...foundry.utils.deepClone(variables), { id:uniqueId(variables,`variable_${variables.length+1}`,{fallback:"variable"}),name:`Variable ${variables.length+1}`,type:"any",scope:"instance",default:null,exposeOnSpawn:false }];
      await save(list);
    });
    host.appendChild(add);
    host.appendChild(this._hint(game.i18n.localize("SDUI.Editor.VariablesHint")));
    const assetsHead = document.createElement("div");
    assetsHead.className = "sduw-myblueprint-title";
    assetsHead.innerHTML = `<i class="fa-solid fa-code"></i><span>Functions · Events · Data</span>`;
    host.appendChild(assetsHead);
    const blueprintId = this.document.system.blueprintId ?? this.document.system.widgetKey;
    const addAssetRows = (key, icon, menuFor) => {
      for (const asset of this.document.system[key] ?? []) {
        const row = document.createElement("div");
        row.className = "sduw-blueprint-row";
        row.draggable = true;
        row.innerHTML = `<i class="fa-solid ${icon}"></i><span>${_esc(asset.name ?? asset.id)}</span><code>${_esc(key)}</code>`;
        row.addEventListener("dragstart", event => event.dataTransfer.setData("text/plain", JSON.stringify({
          _sgMenu: menuFor(asset), blueprintId, [`${key.replace(/s$/, "")}Id`]: asset.id,
          functionId: key === "functions" ? asset.id : undefined,
          eventId: key === "customEvents" ? asset.id : undefined,
          enumId: key === "enums" ? asset.id : undefined,
          tableId: key === "dataTables" ? asset.id : undefined
        })));
        host.appendChild(row);
      }
    };
    addAssetRows("functions", "fa-code", asset => [{ type: "ui_call_function", label: `Call ${asset.name}` }]);
    addAssetRows("customEvents", "fa-bolt", asset => [
      { type: "ui_dispatch_custom_event", label: `Call ${asset.name}` },
      { type: "ui_custom_event_entry", label: `Event ${asset.name}` }
    ]);
    addAssetRows("enums", "fa-list", asset => [{ type: "ui_enum_literal", label: `Get ${asset.name} Value` }]);
    addAssetRows("dataTables", "fa-table", asset => [{ type: "ui_data_table_row", label: `Get ${asset.name} Row` }]);
    host.appendChild(this._button("Edit Blueprint Assets", "fa-pen-to-square", () => this._editBlueprintAssets()));
  }

  async _editBlueprintAssets() {
    openBlueprintAssetManager(this.document);
  }

  // ------------------------------------------------------------------
  // Tiny UI helpers
  // ------------------------------------------------------------------

  _group(labelKey) {
    const group = document.createElement("details");
    group.className = "sduw-group";
    group.open = true;
    const summary = document.createElement("summary");
    summary.textContent = game.i18n.localize(labelKey);
    group.appendChild(summary);
    return group;
  }

  _row(labelKey, input, { hint = "", compact = false } = {}) {
    const row = document.createElement("div");
    row.className = `sduw-row ${compact ? "is-compact" : ""}`;
    const label = document.createElement("label");
    label.textContent = game.i18n.localize(labelKey);
    if (hint) label.title = game.i18n.localize(hint);
    row.appendChild(label);
    row.appendChild(input);
    return row;
  }

  _hint(text) {
    const p = document.createElement("p");
    p.className = "sduw-hint";
    p.textContent = text;
    return p;
  }

  _static(text) {
    const span = document.createElement("span");
    span.className = "sduw-static";
    span.textContent = text;
    return span;
  }

  _textInput(value, commit) {
    const input = document.createElement("input");
    input.type = "text";
    input.value = value ?? "";
    input.addEventListener("change", () => commit(input.value));
    return input;
  }

  _textareaInput(value, commit) {
    const input = document.createElement("textarea");
    input.rows = 3;
    input.value = value ?? "";
    input.addEventListener("change", () => commit(input.value));
    return input;
  }

  _numberInput(value, commit) {
    const input = document.createElement("input");
    input.type = "number";
    input.value = String(value ?? 0);
    input.addEventListener("change", () => commit(Number(input.value) || 0));
    return input;
  }

  _checkboxInput(value, commit) {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = !!value;
    input.addEventListener("change", () => commit(input.checked));
    return input;
  }

  _selectInput(options, value, commit, labelFor = null) {
    const select = document.createElement("select");
    for (const option of options) {
      const node = new Option(labelFor ? labelFor(option) : (option === "" ? "—" : option), option);
      if (String(option) === String(value)) node.selected = true;
      select.appendChild(node);
    }
    select.addEventListener("change", () => commit(select.value));
    return select;
  }

  _colorInput(value, commit) {
    const wrap = document.createElement("div");
    wrap.className = "sduw-color";
    const picker = document.createElement("input");
    picker.type = "color";
    picker.value = /^#[0-9a-f]{6}$/i.test(value) ? value : "#000000";
    const text = document.createElement("input");
    text.type = "text";
    text.value = value ?? "";
    text.placeholder = "#rrggbb / rgba()";
    picker.addEventListener("change", () => { text.value = picker.value; commit(picker.value); });
    text.addEventListener("change", () => commit(text.value));
    wrap.append(picker, text);
    return wrap;
  }

  _imageInput(value, commit) {
    const wrap = document.createElement("div");
    wrap.className = "sduw-image-pick";
    const text = document.createElement("input");
    text.type = "text";
    text.value = value ?? "";
    text.addEventListener("change", () => commit(text.value));
    const pick = this._button("", "fa-file-image", async () => {
      const FP = foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
      const picker = new FP({
        type: "image",
        current: text.value,
        callback: (path) => { text.value = path; commit(path); }
      });
      picker.render(true);
    });
    wrap.append(text, pick);
    return wrap;
  }

  _button(labelKey, icon, onClick, extraClass = "") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `sduw-btn ${extraClass}`.trim();
    button.innerHTML = `<i class="fa-solid ${icon}"></i>${labelKey ? `<span>${game.i18n.localize(labelKey)}</span>` : ""}`;
    button.addEventListener("click", (ev) => { ev.preventDefault(); onClick(ev); });
    return button;
  }

  _alignTools(selection) {
    const wrap = document.createElement("div");
    wrap.className = "sduw-align-tools";
    const apply = async (fn) => {
      const elements = foundry.utils.deepClone(this._elements);
      fn(elements.filter(el => this._selection.has(el.id)));
      await this._commit(elements);
    };
    const defs = [
      ["SDUI.Editor.AlignLeft", "fa-align-left", (list) => { const min = Math.min(...list.map(el => el.x)); list.forEach(el => el.x = min); }],
      ["SDUI.Editor.AlignRight", "fa-align-right", (list) => { const max = Math.max(...list.map(el => el.x + el.w)); list.forEach(el => el.x = max - el.w); }],
      ["SDUI.Editor.AlignTop", "fa-align-center", (list) => { const min = Math.min(...list.map(el => el.y)); list.forEach(el => el.y = min); }],
      ["SDUI.Editor.AlignBottom", "fa-align-justify", (list) => { const max = Math.max(...list.map(el => el.y + el.h)); list.forEach(el => el.y = max - el.h); }],
      ["SDUI.Editor.SameWidth", "fa-arrows-left-right", (list) => { const w = Math.max(...list.map(el => el.w)); list.forEach(el => el.w = w); }],
      ["SDUI.Editor.SameHeight", "fa-arrows-up-down", (list) => { const h = Math.max(...list.map(el => el.h)); list.forEach(el => el.h = h); }]
    ];
    for (const [labelKey, icon, fn] of defs) wrap.appendChild(this._button(labelKey, icon, () => apply(fn)));
    wrap.appendChild(this._button("SDUI.Editor.Duplicate", "fa-clone", () => this._duplicateSelection()));
    wrap.appendChild(this._button("SDUI.Editor.Delete", "fa-trash", () => this._deleteSelection(), "is-danger"));
    return wrap;
  }

  async _saveSelectionAsTemplate() {
    const roots = this.selected.length ? this.selected : childrenOf(this._elements, "");
    if (!roots.length) {
      ui.notifications?.warn?.("Add or select widgets before saving a template.");
      return;
    }
    const ids = new Set();
    for (const root of roots) for (const id of this._subtreeIds(root.id)) ids.add(id);
    const elements = foundry.utils.deepClone(this._elements.filter(element => ids.has(element.id)));
    const name = await foundry.applications.api.DialogV2.prompt({
      window: { title: "Save UI Template" },
      content: `<form class="sduw-identity-dialog"><label>Template Name<input name="name" value="UI Component" autofocus></label><label>Category<input name="category" value="General"></label></form>`,
      ok: { callback: (_event, button) => ({ name: button.form.elements.name.value.trim(), category: button.form.elements.category.value.trim() }) }
    }).catch(() => null);
    if (!name?.name) return;
    const templates = foundry.utils.deepClone(this.document.system.templates ?? []);
    templates.push({
      id: uniqueId(templates, name.name, { fallback: "template" }),
      name: name.name,
      category: name.category || "General",
      elements,
      rootIds: roots.map(root => root.id)
    });
    await this.document.update({ "system.templates": templates }, NO_RENDER);
    ui.notifications?.info?.(`Template '${name.name}' saved.`);
  }

  async _insertSavedTemplate() {
    const templates = this.document.system.templates ?? [];
    if (!templates.length) {
      ui.notifications?.warn?.("This Blueprint has no templates yet.");
      return;
    }
    const picked = await foundry.applications.api.DialogV2.prompt({
      window: { title: "Insert UI Template" },
      content: `<form class="sduw-identity-dialog"><label>Template<select name="template">${templates.map(template => `<option value="${_esc(template.id)}">${_esc(template.category ?? "General")} · ${_esc(template.name)}</option>`).join("")}</select></label></form>`,
      ok: { callback: (_event, button) => button.form.elements.template.value }
    }).catch(() => null);
    const template = templates.find(entry => entry.id === picked);
    if (!template) return;
    const parent = this.primary && isContainer(this.primary.type) ? this.primary.id : (this.primary?.parent ?? "");
    const source = foundry.utils.deepClone(template.elements ?? []);
    const elements = foundry.utils.deepClone(this._elements);
    const idMap = new Map();
    for (const sourceElement of source) {
      const id = uniqueId([...elements, ...[...idMap.values()].map(value => ({ id: value }))], sourceElement.id, { fallback: sourceElement.type ?? "widget" });
      idMap.set(sourceElement.id, id);
    }
    const newIds = [];
    for (const sourceElement of source) {
      const copy = foundry.utils.deepClone(sourceElement);
      copy.id = idMap.get(sourceElement.id);
      copy.widgetId = copy.id;
      copy.parent = idMap.get(sourceElement.parent) ?? parent;
      if (!idMap.has(sourceElement.parent)) {
        copy.x = Number(copy.x ?? 0) + 16;
        copy.y = Number(copy.y ?? 0) + 16;
      }
      elements.push(copy);
      newIds.push(copy.id);
    }
    this._selection = new Set(newIds);
    await this._commit(elements, { details: true });
  }

  // ------------------------------------------------------------------
  // Actions
  // ------------------------------------------------------------------

  static async _onPreview() {
    const app = new SDUIWidgetApp({ widgetItem: this.document, actor: game.user?.character ?? null });
    await app.render(true);
  }

  static async _onCopyMacro() {
    const key = this.document.system.blueprintId ?? this.document.system.widgetKey;
    const snippet = `const instance = await game.system.api.uiBlueprint.spawn("${key}", {\n`
      + `  actor: game.user.character,   // optional context actor\n`
      + `  audience: "self",             // self | gm | owners | players | everyone | users\n`
      + `  vars: {}                      // initial variable values\n});`;
    try {
      await game.clipboard.copyPlainText(snippet);
      ui.notifications?.info?.(game.i18n.localize("SDUI.Editor.MacroCopied"));
    } catch {
      console.log(snippet);
      ui.notifications?.warn?.(game.i18n.localize("SDUI.Editor.MacroCopyFailed"));
    }
  }

  static async _onFit() { return this._fitCanvas(); }
  static async _onZoomIn() { this._zoom = _clamp(this._zoom + 0.1, 0.25, 2); this._applyZoom(); }
  static async _onZoomOut() { this._zoom = _clamp(this._zoom - 0.1, 0.25, 2); this._applyZoom(); }
  static async _onZoomReset() { this._zoom = 1; this._applyZoom(); }
  static async _onUndo() { return this._undo(); }
  static async _onOpenAssets() { return this._editBlueprintAssets(); }
  static async _onSaveTemplate() { return this._saveSelectionAsTemplate(); }
  static async _onInsertTemplate() { return this._insertSavedTemplate(); }

  static async _onMigrate() {
    const source=this.document.system.toObject?.()??this.document.system;
    const migrated=migrateBlueprintData({...source,elements:normalizeElements(source.elements)});
    await this.document.update(Object.fromEntries(Object.entries(migrated).map(([k,v])=>[`system.${k}`,v])));
    ui.notifications?.info?.(game.i18n.localize("SDUI.Editor.MigrateDone"));
  }
  static async _onOpenGraph(){ return this._openMainGraph(); }
}
