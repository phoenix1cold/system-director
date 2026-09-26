// Visual editor for AOE Region presets (Database type `aoe_template` / `aoe_templates`).
// Draws shapes on a grid preview instead of the scene: shapes are stored in scene
// pixels around the origin (0,0), exactly like the presets produced by the
// "AOE Template Saver" node, so `Place AOE Template` places them unchanged.
import { openFoundryWindow } from "./foundry-window-host.mjs";
import { buildShape } from "./sd-region.mjs";

const esc = value => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const clone = value => { try { return foundry.utils.deepClone(value); } catch { return JSON.parse(JSON.stringify(value ?? null)); } };
const randomId = () => (globalThis.foundry?.utils?.randomID?.(12) ?? Math.random().toString(36).slice(2, 14));

const TOOLS = [
  { id:"select",    label:"Select / move", icon:"fa-arrow-pointer" },
  { id:"circle",    label:"Circle",        icon:"fa-circle" },
  { id:"rectangle", label:"Square",        icon:"fa-square" },
  { id:"ellipse",   label:"Ellipse",       icon:"fa-egg" },
  { id:"cone",      label:"Cone",          icon:"fa-play" },
  { id:"line",      label:"Line",          icon:"fa-minus" },
  { id:"polygon",   label:"Polygon",       icon:"fa-draw-polygon" }
];

function gridInfo() {
  const size = Number(globalThis.canvas?.grid?.size) || 100;
  const distance = Number(globalThis.canvas?.dimensions?.distance ?? globalThis.canvas?.scene?.grid?.distance) || 5;
  const units = String(globalThis.canvas?.scene?.grid?.units ?? "ft");
  return { size, distance, units, pxPerUnit: size / distance };
}

/** Normalise any stored preset (region-v14 or legacy measured template) to the editor model. */
export function normalizeAoePreset(source = {}) {
  const preset = source && typeof source === "object" ? clone(source) : {};
  if (preset.kind !== "region-v14" && !Array.isArray(preset.shapes)) {
    // Legacy MeasuredTemplate preset → single region shape.
    const { pxPerUnit } = gridInfo();
    const distance = Number(preset.distance) || 5;
    const t = String(preset.t ?? "circle");
    let shape = null;
    if (t === "rect") shape = { type:"rectangle", x:0, y:0, width:distance * pxPerUnit, height:distance * pxPerUnit, rotation:0 };
    else if (t === "cone") shape = buildShapeSafe("cone", distance, Number(preset.angle) || 53.13);
    else if (t === "ray") shape = buildShapeSafe("line", distance);
    else shape = { type:"circle", x:0, y:0, radius:distance * pxPerUnit };
    return { id:String(preset.id ?? "") || randomId(), kind:"region-v14", version:14, name:String(preset.name ?? "Template"), t, shapes:shape ? [shape] : [], shapeCount:shape ? 1 : 0,
      appearance:{ color:String(preset.fillColor ?? "#ff0000"), displayMeasurements:true } };
  }
  const shapes = (Array.isArray(preset.shapes) ? preset.shapes : []).filter(s => s && typeof s === "object");
  return {
    id:String(preset.id ?? "") || randomId(), kind:"region-v14", version:14,
    name:String(preset.name ?? "Region"),
    t: shapes.length === 1 ? String(shapes[0].type ?? "region") : "region",
    shapes, shapeCount:shapes.length,
    appearance:{ color:String(preset.appearance?.color ?? "#ff0000"), displayMeasurements:preset.appearance?.displayMeasurements !== false,
      ...(preset.appearance?.highlightMode !== undefined ? { highlightMode:preset.appearance.highlightMode } : {}),
      ...(preset.appearance?.elevation !== undefined ? { elevation:preset.appearance.elevation } : {}) }
  };
}

function buildShapeSafe(kind, sizeUnits, angle) {
  try { if (globalThis.canvas?.dimensions) return buildShape(kind, sizeUnits, angle); } catch {}
  const { pxPerUnit, size } = gridInfo();
  const s = Number(sizeUnits) * pxPerUnit;
  if (kind === "cone") {
    const half = (Number(angle) * Math.PI / 180) / 2;
    return { type:"polygon", points:[0, 0, s * Math.cos(-half), s * Math.sin(-half), s, 0, s * Math.cos(half), s * Math.sin(half)].map(Math.round) };
  }
  if (kind === "line") return { type:"rectangle", x:0, y:-size / 2, width:s, height:size, rotation:0 };
  if (kind === "rectangle") return { type:"rectangle", x:-s / 2, y:-s / 2, width:s, height:s, rotation:0 };
  if (kind === "ellipse") return { type:"ellipse", x:0, y:0, radiusX:s / 2, radiusY:s / 2, rotation:0 };
  return { type:"circle", x:0, y:0, radius:s };
}

/** Translate a shape by (dx, dy) scene pixels. */
function moveShape(shape, dx, dy) {
  if (shape.type === "polygon") {
    shape.points = (shape.points ?? []).map((v, i) => Math.round(v + (i % 2 ? dy : dx)));
  } else {
    shape.x = Math.round((shape.x ?? 0) + dx);
    shape.y = Math.round((shape.y ?? 0) + dy);
  }
}

function shapeCenter(shape) {
  if (shape.type === "polygon") {
    const pts = shape.points ?? [];
    let sx = 0, sy = 0, n = 0;
    for (let i = 0; i + 1 < pts.length; i += 2) { sx += pts[i]; sy += pts[i + 1]; n++; }
    return n ? { x:sx / n, y:sy / n } : { x:0, y:0 };
  }
  if (shape.type === "rectangle") return { x:(shape.x ?? 0) + (shape.width ?? 0) / 2, y:(shape.y ?? 0) + (shape.height ?? 0) / 2 };
  return { x:shape.x ?? 0, y:shape.y ?? 0 };
}

function shapeHit(shape, px, py) {
  if (shape.type === "circle") return Math.hypot(px - shape.x, py - shape.y) <= (shape.radius ?? 0);
  if (shape.type === "ellipse") {
    const dx = px - shape.x, dy = py - shape.y;
    const rot = -((shape.rotation ?? 0) * Math.PI / 180);
    const lx = dx * Math.cos(rot) - dy * Math.sin(rot), ly = dx * Math.sin(rot) + dy * Math.cos(rot);
    return ((lx * lx) / ((shape.radiusX || 1) ** 2) + (ly * ly) / ((shape.radiusY || 1) ** 2)) <= 1;
  }
  if (shape.type === "rectangle") {
    const c = shapeCenter(shape);
    const rot = -((shape.rotation ?? 0) * Math.PI / 180);
    const dx = px - c.x, dy = py - c.y;
    const lx = dx * Math.cos(rot) - dy * Math.sin(rot), ly = dx * Math.sin(rot) + dy * Math.cos(rot);
    return Math.abs(lx) <= (shape.width ?? 0) / 2 && Math.abs(ly) <= (shape.height ?? 0) / 2;
  }
  if (shape.type === "polygon") {
    const pts = shape.points ?? [];
    let inside = false;
    for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
      const xi = pts[i], yi = pts[i + 1], xj = pts[j], yj = pts[j + 1];
      if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / ((yj - yi) || 1e-9) + xi)) inside = !inside;
    }
    return inside;
  }
  return false;
}

function describeShape(shape, grid) {
  const u = v => `${(Math.round((Number(v) || 0) / grid.pxPerUnit * 10) / 10)} ${grid.units}`;
  switch (shape.type) {
    case "circle": return `Circle · r ${u(shape.radius)}`;
    case "ellipse": return `Ellipse · ${u((shape.radiusX ?? 0) * 2)} × ${u((shape.radiusY ?? 0) * 2)}`;
    case "rectangle": return `Rectangle · ${u(shape.width)} × ${u(shape.height)}`;
    case "polygon": return `Polygon · ${Math.floor((shape.points ?? []).length / 2)} pts`;
    default: return String(shape.type ?? "shape");
  }
}

/** Snapshot of the Region currently selected on the canvas (same data as the AOE Template Saver node). */
export function snapshotSelectedRegion() {
  const layer = globalThis.canvas?.regions;
  const placeable = layer?.controlled?.[0] ?? null;
  const doc = placeable?.document ?? null;
  if (!doc) return null;
  let raw = null;
  try { raw = doc.toObject?.(true) ?? doc.toObject?.() ?? null; } catch {}
  const shapes = Array.from(raw?.shapes ?? doc.shapes ?? []).map(shape => clone(shape?.toObject?.(true) ?? shape?.toObject?.() ?? shape));
  if (!shapes.length) return null;
  // Re-centre around the origin so the preset places relative to the cursor.
  let sx = 0, sy = 0, n = 0;
  for (const shape of shapes) { const c = shapeCenter(shape); sx += c.x; sy += c.y; n++; }
  const cx = n ? sx / n : 0, cy = n ? sy / n : 0;
  for (const shape of shapes) moveShape(shape, -cx, -cy);
  return normalizeAoePreset({ kind:"region-v14", name:doc.name || "Region", shapes,
    appearance:{ color:String(doc.color ?? "#ff0000"), displayMeasurements:doc.displayMeasurements !== false } });
}

/**
 * Open the AOE preset editor.
 * @param {object|object[]|null} value  Existing preset or preset list.
 * @param {object} options `{ multiple, title }`
 * @returns {Promise<object|object[]|null>} preset (or array when `multiple`) or null on cancel.
 */
export function openAoePresetEditor(value = null, options = {}) {
  const multiple = !!options.multiple;
  const initial = Array.isArray(value) ? value : (value && typeof value === "object" && Object.keys(value).length ? [value] : []);
  const presets = initial.map(normalizeAoePreset);
  if (!presets.length) presets.push(normalizeAoePreset({ name: multiple ? "Template 1" : "Template", shapes: [] }));
  const grid = gridInfo();

  const state = { presets, index: 0, tool: "circle", size: grid.distance * 4, angle: 53.13, selected: -1, polygon: [], zoom: 1, pan: { x: 0, y: 0 } };
  const root = document.createElement("div");
  root.className = "sd-aoe-editor";
  let app = null, settled = false;

  return new Promise(resolve => {
    const finish = async result => {
      if (settled) return;
      settled = true;
      resolve(result);
      await app?.close?.({ sdSkipCallback: true });
    };
    const current = () => state.presets[state.index];

    const render = () => {
      const preset = current();
      root.innerHTML = `<style>
        .sd-aoe-editor{height:100%;min-height:0;display:flex;flex-direction:column;background:var(--sd-popover-bg,var(--sd-bg,#171b2b));color:var(--sd-text,#eee);font:12px Signika,sans-serif}
        .sdae-top{display:flex;gap:8px;align-items:center;padding:8px 12px;border-bottom:1px solid var(--sd-border,#3a4260);flex-wrap:wrap}
        .sdae-top input,.sdae-top select,.sdae-side input,.sdae-side select{background:var(--sd-bg,#171b2b);border:1px solid var(--sd-border,#3a4260);border-radius:6px;color:var(--sd-text,#eee);padding:5px 7px;font:inherit;min-width:0}
        .sdae-main{flex:1;min-height:0;display:grid;grid-template-columns:1fr 240px}
        .sdae-canvas-wrap{position:relative;background:#0f1220;overflow:hidden}
        .sdae-canvas-wrap canvas{display:block;width:100%;height:100%;cursor:crosshair}
        .sdae-tools{position:absolute;left:8px;top:8px;display:flex;flex-direction:column;gap:4px}
        .sdae-tool{width:34px;height:34px;border:1px solid var(--sd-border,#3a4260);border-radius:7px;background:var(--sd-bg-2,#1d2235);color:var(--sd-text,#eee);cursor:pointer;display:grid;place-items:center;font-size:14px}
        .sdae-tool.is-active{border-color:var(--sd-accent,#7775ff);background:color-mix(in srgb,var(--sd-accent,#7775ff) 22%,var(--sd-bg-2))}
        .sdae-status{position:absolute;left:52px;bottom:8px;font-size:11px;color:var(--sd-text-3,#8f96aa);background:rgba(0,0,0,.45);padding:3px 8px;border-radius:6px;pointer-events:none}
        .sdae-side{border-left:1px solid var(--sd-border,#3a4260);padding:10px;display:flex;flex-direction:column;gap:8px;overflow:auto}
        .sdae-side label{display:flex;flex-direction:column;gap:3px;font-size:11px;color:var(--sd-text-3,#8f96aa)}
        .sdae-side label.row{flex-direction:row;align-items:center;justify-content:space-between;color:var(--sd-text)}
        .sdae-list{display:flex;flex-direction:column;gap:4px}
        .sdae-shape{display:flex;align-items:center;gap:6px;padding:5px 7px;border:1px solid var(--sd-border,#3a4260);border-radius:6px;background:var(--sd-bg-2,#1d2235);cursor:pointer}
        .sdae-shape.is-selected{border-color:var(--sd-accent,#7775ff)}
        .sdae-shape span{flex:1}.sdae-shape button{border:none;background:transparent;color:var(--sd-text-3);cursor:pointer}
        .sdae-btn{border:1px solid var(--sd-border,#3a4260);border-radius:7px;background:var(--sd-bg-2,#1d2235);color:var(--sd-text,#eee);padding:6px 10px;cursor:pointer;font:inherit;display:flex;align-items:center;gap:6px;justify-content:center}
        .sdae-btn.primary{background:var(--sd-accent,#7775ff);border-color:var(--sd-accent,#7775ff);color:#fff;font-weight:600}
        .sdae-btn:disabled{opacity:.4;cursor:default}
        .sdae-foot{display:flex;gap:8px;padding:8px 12px;border-top:1px solid var(--sd-border,#3a4260)}.sdae-foot .spacer{flex:1}
        .sdae-tabs{display:flex;gap:4px;flex-wrap:wrap}.sdae-tab{padding:4px 9px;border-radius:6px;border:1px solid var(--sd-border,#3a4260);background:var(--sd-bg-2,#1d2235);cursor:pointer;color:var(--sd-text)}.sdae-tab.is-active{border-color:var(--sd-accent,#7775ff);color:var(--sd-accent,#9290ff)}
        .sdae-hint{font-size:10px;color:var(--sd-text-3,#8f96aa);line-height:1.4}
      </style>
      <div class="sdae-top">
        ${multiple ? `<div class="sdae-tabs">${state.presets.map((p, i) => `<button type="button" class="sdae-tab ${i === state.index ? "is-active" : ""}" data-preset="${i}">${esc(p.name || `Template ${i + 1}`)}</button>`).join("")}<button type="button" class="sdae-tab" data-add-preset title="Add template"><i class="fas fa-plus"></i></button></div>` : ""}
        <label style="display:flex;align-items:center;gap:6px">Name <input data-name value="${esc(preset.name)}" style="width:150px"></label>
        <label style="display:flex;align-items:center;gap:6px">Color <input type="color" data-color value="${esc(/^#[0-9a-f]{6}$/i.test(preset.appearance.color) ? preset.appearance.color : "#ff0000")}"></label>
        <label style="display:flex;align-items:center;gap:6px">Size <input type="number" data-size value="${esc(state.size)}" min="0.5" step="0.5" style="width:70px"> ${esc(grid.units)}</label>
        <label style="display:flex;align-items:center;gap:6px" ${state.tool === "cone" ? "" : 'style="opacity:.5"'}>Angle <input type="number" data-angle value="${esc(state.angle)}" min="1" max="360" step="1" style="width:64px">°</label>
        <button type="button" class="sdae-btn" data-from-canvas title="Copy the Region selected on the scene"><i class="fas fa-map"></i> From selected Region</button>
        ${multiple && state.presets.length > 1 ? `<button type="button" class="sdae-btn" data-remove-preset title="Remove this template"><i class="fas fa-trash"></i></button>` : ""}
      </div>
      <div class="sdae-main">
        <div class="sdae-canvas-wrap">
          <canvas data-canvas></canvas>
          <div class="sdae-tools">${TOOLS.map(t => `<button type="button" class="sdae-tool ${t.id === state.tool ? "is-active" : ""}" data-tool="${t.id}" title="${esc(t.label)}"><i class="fas ${t.icon}"></i></button>`).join("")}</div>
          <div class="sdae-status" data-status></div>
        </div>
        <div class="sdae-side">
          <b>Shapes (${preset.shapes.length})</b>
          <div class="sdae-list">${preset.shapes.length ? preset.shapes.map((shape, i) => `<div class="sdae-shape ${i === state.selected ? "is-selected" : ""}" data-shape="${i}"><i class="fas ${TOOLS.find(t => t.id === shape.type)?.icon ?? "fa-draw-polygon"}"></i><span>${esc(describeShape(shape, grid))}</span><button type="button" data-shape-remove="${i}" title="Remove"><i class="fas fa-xmark"></i></button></div>`).join("") : `<div class="sdae-hint">Pick a tool and click on the grid. Grid cell = ${esc(grid.distance)} ${esc(grid.units)}. Cone and line point to the right; rotate with the field below.</div>`}</div>
          ${state.selected >= 0 && preset.shapes[state.selected] ? `
            <label>Rotation (°)<input type="number" data-rotation value="${esc(preset.shapes[state.selected].rotation ?? 0)}" step="5"></label>
            <label class="row"><span>Hole (cut out)</span><input type="checkbox" data-hole ${preset.shapes[state.selected].hole ? "checked" : ""}></label>
            <button type="button" class="sdae-btn" data-center><i class="fas fa-crosshairs"></i> Centre on origin</button>` : ""}
          <label class="row"><span>Show measurements</span><input type="checkbox" data-measure ${preset.appearance.displayMeasurements ? "checked" : ""}></label>
          <div class="sdae-hint">The preset is placed with its origin (the cross) under the cursor when a graph runs <b>Place AOE Template</b>. Scroll to zoom, right-drag to pan.</div>
        </div>
      </div>
      <div class="sdae-foot">
        <button type="button" class="sdae-btn" data-cancel>Cancel</button>
        <button type="button" class="sdae-btn" data-clear><i class="fas fa-eraser"></i> Clear shapes</button>
        <span class="spacer"></span>
        <button type="button" class="sdae-btn primary" data-save><i class="fas fa-check"></i> Save preset${multiple ? "s" : ""}</button>
      </div>`;
      bind();
      requestAnimationFrame(draw);
    };

    const canvasEl = () => root.querySelector("[data-canvas]");
    const toScene = (clientX, clientY) => {
      const el = canvasEl(); const rect = el.getBoundingClientRect();
      const cx = rect.width / 2 + state.pan.x, cy = rect.height / 2 + state.pan.y;
      return { x: (clientX - rect.left - cx) / state.zoom, y: (clientY - rect.top - cy) / state.zoom };
    };
    const snap = v => Math.round(v / (grid.size / 2)) * (grid.size / 2);

    const draw = () => {
      const el = canvasEl(); if (!el) return;
      const rect = el.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      if (el.width !== Math.round(rect.width * dpr) || el.height !== Math.round(rect.height * dpr)) { el.width = Math.round(rect.width * dpr); el.height = Math.round(rect.height * dpr); }
      const ctx = el.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);
      const cx = rect.width / 2 + state.pan.x, cy = rect.height / 2 + state.pan.y;
      const z = state.zoom, cell = grid.size * z;
      // grid
      ctx.strokeStyle = "rgba(255,255,255,.07)"; ctx.lineWidth = 1;
      for (let x = cx % cell; x < rect.width; x += cell) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, rect.height); ctx.stroke(); }
      for (let y = cy % cell; y < rect.height; y += cell) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(rect.width, y); ctx.stroke(); }
      // origin cross
      ctx.strokeStyle = "rgba(255,255,255,.35)"; ctx.beginPath(); ctx.moveTo(cx - 10, cy); ctx.lineTo(cx + 10, cy); ctx.moveTo(cx, cy - 10); ctx.lineTo(cx, cy + 10); ctx.stroke();
      // token silhouette for scale
      ctx.fillStyle = "rgba(255,255,255,.08)"; ctx.beginPath(); ctx.arc(cx, cy, cell * 0.45, 0, Math.PI * 2); ctx.fill();
      const preset = current();
      const color = preset.appearance.color || "#ff0000";
      preset.shapes.forEach((shape, i) => {
        ctx.save(); ctx.translate(cx, cy); ctx.scale(z, z);
        ctx.lineWidth = (i === state.selected ? 3 : 1.5) / z;
        ctx.strokeStyle = i === state.selected ? "#ffffff" : color;
        ctx.fillStyle = shape.hole ? "rgba(0,0,0,.45)" : color + "55";
        ctx.beginPath();
        if (shape.type === "circle") ctx.arc(shape.x, shape.y, shape.radius, 0, Math.PI * 2);
        else if (shape.type === "ellipse") ctx.ellipse(shape.x, shape.y, shape.radiusX, shape.radiusY, (shape.rotation ?? 0) * Math.PI / 180, 0, Math.PI * 2);
        else if (shape.type === "rectangle") {
          const c = shapeCenter(shape); ctx.translate(c.x, c.y); ctx.rotate((shape.rotation ?? 0) * Math.PI / 180);
          ctx.rect(-shape.width / 2, -shape.height / 2, shape.width, shape.height);
        } else if (shape.type === "polygon") {
          const pts = shape.points ?? [];
          for (let k = 0; k + 1 < pts.length; k += 2) k ? ctx.lineTo(pts[k], pts[k + 1]) : ctx.moveTo(pts[k], pts[k + 1]);
          ctx.closePath();
        }
        ctx.fill(); ctx.stroke(); ctx.restore();
      });
      if (state.polygon.length) {
        ctx.save(); ctx.translate(cx, cy); ctx.scale(z, z);
        ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1.5 / z; ctx.setLineDash([6 / z, 4 / z]);
        ctx.beginPath();
        state.polygon.forEach((p, k) => k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
        ctx.stroke();
        for (const p of state.polygon) { ctx.beginPath(); ctx.arc(p.x, p.y, 4 / z, 0, Math.PI * 2); ctx.fillStyle = "#fff"; ctx.fill(); }
        ctx.restore();
      }
      const status = root.querySelector("[data-status]");
      if (status) status.textContent = state.tool === "polygon"
        ? `Polygon: ${state.polygon.length} point(s) — double-click or Enter to finish, Esc to cancel`
        : state.tool === "select" ? "Click a shape to select, drag to move, Delete to remove" : `Click to place a ${state.tool} of ${state.size} ${grid.units}`;
    };

    const addShape = (kind, at) => {
      const preset = current();
      let shape = buildShapeSafe(kind === "line" ? "line" : kind, state.size, state.angle);
      if (!shape) return;
      moveShape(shape, snap(at.x), snap(at.y));
      preset.shapes.push(shape);
      state.selected = preset.shapes.length - 1;
      preset.shapeCount = preset.shapes.length;
      render();
    };

    const finishPolygon = () => {
      if (state.polygon.length >= 3) {
        const preset = current();
        preset.shapes.push({ type:"polygon", points: state.polygon.flatMap(p => [Math.round(p.x), Math.round(p.y)]) });
        preset.shapeCount = preset.shapes.length;
        state.selected = preset.shapes.length - 1;
      }
      state.polygon = [];
      render();
    };

    const bind = () => {
      const el = canvasEl();
      let drag = null;
      el.addEventListener("contextmenu", event => event.preventDefault());
      el.addEventListener("wheel", event => { event.preventDefault(); state.zoom = Math.max(0.2, Math.min(4, state.zoom * (event.deltaY < 0 ? 1.1 : 0.9))); draw(); }, { passive: false });
      el.addEventListener("pointerdown", event => {
        el.setPointerCapture(event.pointerId);
        if (event.button === 2 || event.button === 1) { drag = { kind:"pan", x:event.clientX, y:event.clientY }; return; }
        const at = toScene(event.clientX, event.clientY);
        if (state.tool === "polygon") { state.polygon.push({ x: snap(at.x), y: snap(at.y) }); draw(); return; }
        if (state.tool === "select") {
          const preset = current();
          const hit = [...preset.shapes.keys()].reverse().find(i => shapeHit(preset.shapes[i], at.x, at.y));
          state.selected = hit ?? -1;
          if (hit !== undefined) drag = { kind:"move", x:at.x, y:at.y, index:hit };
          render();
          return;
        }
        addShape(state.tool, at);
      });
      el.addEventListener("pointermove", event => {
        if (!drag) return;
        if (drag.kind === "pan") { state.pan.x += event.clientX - drag.x; state.pan.y += event.clientY - drag.y; drag.x = event.clientX; drag.y = event.clientY; draw(); return; }
        const at = toScene(event.clientX, event.clientY);
        const shape = current().shapes[drag.index]; if (!shape) return;
        moveShape(shape, at.x - drag.x, at.y - drag.y); drag.x = at.x; drag.y = at.y; draw();
      });
      el.addEventListener("pointerup", () => {
        if (drag?.kind === "move") { const shape = current().shapes[drag.index]; if (shape) { const c = shapeCenter(shape); moveShape(shape, snap(c.x) - c.x, snap(c.y) - c.y); } render(); }
        drag = null;
      });
      el.addEventListener("dblclick", () => { if (state.tool === "polygon") finishPolygon(); });
      root.tabIndex = -1;
      root.addEventListener("keydown", event => {
        if (event.key === "Enter" && state.tool === "polygon") { event.preventDefault(); finishPolygon(); }
        if (event.key === "Escape" && state.polygon.length) { state.polygon = []; draw(); }
        if ((event.key === "Delete" || event.key === "Backspace") && state.selected >= 0 && event.target === root) { current().shapes.splice(state.selected, 1); current().shapeCount = current().shapes.length; state.selected = -1; render(); }
      });

      root.querySelectorAll("[data-tool]").forEach(button => button.addEventListener("click", () => { state.tool = button.dataset.tool; state.polygon = []; render(); }));
      root.querySelector("[data-name]")?.addEventListener("input", event => { current().name = event.target.value; });
      root.querySelector("[data-color]")?.addEventListener("input", event => { current().appearance.color = event.target.value; draw(); });
      root.querySelector("[data-size]")?.addEventListener("input", event => { state.size = Math.max(0.5, Number(event.target.value) || grid.distance); draw(); });
      root.querySelector("[data-angle]")?.addEventListener("input", event => { state.angle = Math.max(1, Math.min(360, Number(event.target.value) || 53.13)); });
      root.querySelector("[data-measure]")?.addEventListener("change", event => { current().appearance.displayMeasurements = event.target.checked; });
      root.querySelector("[data-rotation]")?.addEventListener("input", event => { const shape = current().shapes[state.selected]; if (shape && shape.type !== "circle" && shape.type !== "polygon") { shape.rotation = Number(event.target.value) || 0; draw(); } });
      root.querySelector("[data-hole]")?.addEventListener("change", event => { const shape = current().shapes[state.selected]; if (shape) { if (event.target.checked) shape.hole = true; else delete shape.hole; draw(); } });
      root.querySelector("[data-center]")?.addEventListener("click", () => { const shape = current().shapes[state.selected]; if (shape) { const c = shapeCenter(shape); moveShape(shape, -c.x, -c.y); render(); } });
      root.querySelectorAll("[data-shape]").forEach(row => row.addEventListener("click", event => { if (event.target.closest("[data-shape-remove]")) return; state.selected = Number(row.dataset.shape); state.tool = "select"; render(); }));
      root.querySelectorAll("[data-shape-remove]").forEach(button => button.addEventListener("click", () => { current().shapes.splice(Number(button.dataset.shapeRemove), 1); current().shapeCount = current().shapes.length; state.selected = -1; render(); }));
      root.querySelector("[data-clear]")?.addEventListener("click", () => { current().shapes = []; current().shapeCount = 0; state.selected = -1; state.polygon = []; render(); });
      root.querySelector("[data-from-canvas]")?.addEventListener("click", () => {
        const snapshot = snapshotSelectedRegion();
        if (!snapshot) { ui.notifications?.warn?.("Select a Region on the scene first (Regions layer)."); return; }
        const preset = current();
        preset.shapes = snapshot.shapes; preset.shapeCount = snapshot.shapes.length;
        if (!preset.name || /^Template \d*$/.test(preset.name)) preset.name = snapshot.name;
        preset.appearance.color = snapshot.appearance.color;
        state.selected = -1; render();
      });
      root.querySelectorAll("[data-preset]").forEach(button => button.addEventListener("click", () => { state.index = Number(button.dataset.preset); state.selected = -1; state.polygon = []; render(); }));
      root.querySelector("[data-add-preset]")?.addEventListener("click", () => { state.presets.push(normalizeAoePreset({ name:`Template ${state.presets.length + 1}`, shapes:[] })); state.index = state.presets.length - 1; state.selected = -1; render(); });
      root.querySelector("[data-remove-preset]")?.addEventListener("click", () => { state.presets.splice(state.index, 1); state.index = Math.max(0, state.index - 1); state.selected = -1; render(); });
      root.querySelector("[data-cancel]")?.addEventListener("click", () => finish(null));
      root.querySelector("[data-save]")?.addEventListener("click", () => {
        const out = state.presets.map(p => { const n = normalizeAoePreset(p); n.t = n.shapes.length === 1 ? String(n.shapes[0].type) : "region"; return n; }).filter(p => p.shapes.length);
        if (!out.length) { ui.notifications?.warn?.("Draw at least one shape."); return; }
        finish(multiple ? out : out[0]);
      });
    };

    render();
    app = openFoundryWindow({
      id: `sd-aoe-editor-${randomId()}`,
      title: options.title ?? (multiple ? "AOE Region presets" : "AOE Region preset"),
      icon: "fa-solid fa-bullseye",
      width: 820, height: 620, minWidth: 560, minHeight: 420,
      classes: ["sd-aoe-editor-window"],
      content: root,
      onClose: () => finish(null)
    });
    requestAnimationFrame(() => { draw(); root.focus?.(); });
  });
}
