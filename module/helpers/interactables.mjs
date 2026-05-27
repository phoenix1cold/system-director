const FLAG_SCOPE = "sd";
const FLAG_KEY   = "interactables";
const HEX_RE     = /^#[0-9a-fA-F]{6}$/;

const SUPPORTED_TYPES = ["Tile", "Token", "Note", "Wall", "AmbientLight", "AmbientSound", "Drawing", "Region"];

const ICON_PRESET_PATHS = [
  "icons/svg/circle.svg",
  "icons/svg/hand.svg",
  "icons/svg/door-steel.svg",
  "icons/svg/key.svg",
  "icons/svg/eye.svg",
  "icons/svg/chest.svg",
  "icons/svg/book.svg",
  "icons/svg/sword.svg",
  "icons/svg/shield.svg",
  "icons/svg/dice-target.svg",
  "icons/svg/wing.svg",
  "icons/svg/wind.svg",
  "icons/svg/fire.svg",
  "icons/svg/water.svg",
  "icons/svg/sun.svg",
  "icons/svg/light.svg",
  "icons/svg/clockwork.svg",
  "icons/svg/explosion.svg",
  "icons/svg/cancel.svg",
  "icons/svg/coins.svg",
  "icons/svg/sound.svg",
  "icons/svg/regen.svg",
  "icons/svg/heal.svg",
  "icons/svg/skull.svg"
];

function _newId() {
  return `ib_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function _esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/"/g, "&quot;")
    .replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function _normalizeButton(b) {
  const visibility = ["all", "gm", "players"].includes(b?.visibility) ? b.visibility : "all";
  return {
    id:              String(b?.id || _newId()),
    enabled:         b?.enabled !== false,
    label:           String(b?.label ?? "Button"),
    description:     String(b?.description ?? ""),
    icon:            String(b?.icon ?? ICON_PRESET_PATHS[0]),
    distance:        Number.isFinite(Number(b?.distance)) ? Math.max(0, Number(b.distance)) : 5,
    visibility,
    color:           HEX_RE.test(String(b?.color || "")) ? b.color : "#d4b15a",
    graphData:       (b?.graphData && typeof b.graphData === "object") ? b.graphData : null,
    compiledFormula: String(b?.compiledFormula ?? "")
  };
}

export function getInteractables(doc) {
  const raw = doc?.getFlag?.(FLAG_SCOPE, FLAG_KEY) ?? {};
  return {
    enabled: raw?.enabled !== false,
    buttons: Array.isArray(raw?.buttons) ? raw.buttons.map(_normalizeButton) : []
  };
}

export async function setInteractables(doc, data) {
  if (!doc) return null;
  const norm = {
    enabled: data?.enabled !== false,
    buttons: Array.isArray(data?.buttons) ? data.buttons.map(_normalizeButton) : []
  };
  try {
    await doc.setFlag(FLAG_SCOPE, FLAG_KEY, norm);
  } catch (e) {
    console.warn("SD | setInteractables failed:", e);
  }
  return norm;
}

export function hasInteractables(doc) {
  const d = getInteractables(doc);
  return d.enabled && d.buttons.some(b => b.enabled);
}

function _measureDistance(p1, p2) {
  if (!canvas?.grid || !p1 || !p2) return Infinity;
  try {
    if (typeof canvas.grid.measurePath === "function") {
      const r = canvas.grid.measurePath([p1, p2]);
      const d = (r && typeof r === "object") ? r.distance : r;
      const n = Number(d);
      if (Number.isFinite(n)) return n;
    }
  } catch {}
  try {
    if (typeof canvas.grid.measureDistance === "function") {
      const n = Number(canvas.grid.measureDistance(p1, p2));
      if (Number.isFinite(n)) return n;
    }
  } catch {}
  const px  = Math.hypot((p2.x ?? 0) - (p1.x ?? 0), (p2.y ?? 0) - (p1.y ?? 0));
  const gpx = canvas.grid?.size || canvas.scene?.grid?.size || 100;
  const gd  = canvas.scene?.grid?.distance || canvas.grid?.distance || 5;
  return (px / gpx) * gd;
}

function _docPlaceableObject(doc) {
  if (!doc) return null;
  if (doc.object) return doc.object;
  const dn = doc.documentName;
  try {
    if (dn === "Token")        return canvas.tokens?.placeables?.find(p => p.document === doc) ?? null;
    if (dn === "Tile")         return canvas.tiles?.placeables?.find(p => p.document === doc) ?? null;
    if (dn === "Note")         return canvas.notes?.placeables?.find(p => p.document === doc) ?? null;
    if (dn === "Wall")         return canvas.walls?.placeables?.find(p => p.document === doc) ?? null;
    if (dn === "AmbientLight") return canvas.lighting?.placeables?.find(p => p.document === doc) ?? null;
    if (dn === "AmbientSound") return canvas.sounds?.placeables?.find(p => p.document === doc) ?? null;
    if (dn === "Drawing")      return canvas.drawings?.placeables?.find(p => p.document === doc) ?? null;
    if (dn === "Region")       return canvas.regions?.placeables?.find(p => p.document === doc) ?? null;
  } catch {}
  return null;
}

function _gridSize() {
  return Number(canvas?.grid?.size) || Number(canvas?.grid?.sizeX) || Number(canvas?.scene?.grid?.size) || 100;
}

function _docPixelDims(doc) {
  if (!doc) return { w: 0, h: 0 };
  if (doc.documentName === "Token") {
    const gs = _gridSize();
    return {
      w: (Number(doc.width)  || 1) * gs,
      h: (Number(doc.height) || 1) * gs
    };
  }
  return {
    w: Number(doc.width)  || 0,
    h: Number(doc.height) || 0
  };
}

function _placeableCenter(doc) {
  if (!doc) return null;
  const obj = _docPlaceableObject(doc);
  try {
    if (obj?.center && Number.isFinite(obj.center.x) && Number.isFinite(obj.center.y)) {
      return { x: obj.center.x, y: obj.center.y };
    }
  } catch {}
  if (doc.documentName === "Wall") {
    const c = doc.c ?? [];
    if (c.length === 4) return { x: (c[0] + c[2]) / 2, y: (c[1] + c[3]) / 2 };
  }
  if (Number.isFinite(doc.x) && Number.isFinite(doc.y)) {
    const { w, h } = _docPixelDims(doc);
    return { x: doc.x + w / 2, y: doc.y + h / 2 };
  }
  return null;
}

function _placeableRect(doc) {
  if (!doc) return null;
  if (doc.documentName === "Wall") return null;
  const obj = _docPlaceableObject(doc);
  try {
    const b = obj?.bounds;
    if (b && Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.width) && Number.isFinite(b.height) && b.width > 0 && b.height > 0) {
      return { x: b.x, y: b.y, width: b.width, height: b.height };
    }
  } catch {}
  if (Number.isFinite(doc.x) && Number.isFinite(doc.y)) {
    const { w, h } = _docPixelDims(doc);
    if (w > 0 && h > 0) return { x: doc.x, y: doc.y, width: w, height: h };
  }
  return null;
}

function _closestPointOnSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return { x: a.x, y: a.y };
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

function _closestPointOnDoc(doc, point) {
  if (!doc || !point) return null;
  if (doc.documentName === "Wall") {
    const c = doc.c ?? [];
    if (c.length === 4) {
      return _closestPointOnSegment(point, { x: c[0], y: c[1] }, { x: c[2], y: c[3] });
    }
  }
  const rect = _placeableRect(doc);
  if (rect && rect.width > 0 && rect.height > 0) {
    return {
      x: Math.max(rect.x, Math.min(point.x, rect.x + rect.width)),
      y: Math.max(rect.y, Math.min(point.y, rect.y + rect.height))
    };
  }
  return _placeableCenter(doc);
}

function _docDistanceFromToken(doc, tokenDoc) {
  const tc = _placeableCenter(tokenDoc);
  if (!tc) return Infinity;
  const target = _closestPointOnDoc(doc, tc) ?? _placeableCenter(doc);
  if (!target) return Infinity;
  return _measureDistance(tc, target);
}

function _placeableBoundsTop(doc) {
  const rect = _placeableRect(doc);
  if (rect) return { x: rect.x + rect.width / 2, y: rect.y };
  const c = _placeableCenter(doc);
  if (!c) return null;
  const { h } = _docPixelDims(doc);
  return { x: c.x, y: c.y - h / 2 };
}

function _worldToScreen(pt) {
  if (!canvas?.stage || !pt) return null;
  try {
    const t = canvas.stage.worldTransform;
    return { x: t.a * pt.x + t.c * pt.y + t.tx, y: t.b * pt.x + t.d * pt.y + t.ty };
  } catch {}
  return null;
}

function _allPlaceableDocsWithInteractables() {
  const out = [];
  if (!canvas?.scene) return out;
  const collections = [
    canvas.tokens?.placeables,
    canvas.tiles?.placeables,
    canvas.notes?.placeables,
    canvas.walls?.placeables,
    canvas.lighting?.placeables,
    canvas.sounds?.placeables,
    canvas.drawings?.placeables,
    canvas.regions?.placeables
  ];
  for (const list of collections) {
    if (!Array.isArray(list)) continue;
    for (const p of list) {
      const doc = p?.document;
      if (!doc) continue;
      if (hasInteractables(doc)) out.push(doc);
    }
  }
  return out;
}

function _userOwnedTokens() {
  if (!canvas?.tokens?.placeables) return [];
  const user = game.user;
  if (!user) return [];
  return canvas.tokens.placeables.filter(t => {
    try {
      if (t.document.hidden && !user.isGM) return false;
      return t.document.isOwner;
    } catch { return false; }
  });
}

function _activeActorForExec() {
  const controlled = canvas?.tokens?.controlled ?? [];
  if (controlled.length) {
    const t = controlled[0];
    if (t?.actor) return { actor: t.actor, token: t };
  }
  const owned = _userOwnedTokens();
  if (owned.length) {
    const t = owned[0];
    if (t?.actor) return { actor: t.actor, token: t };
  }
  const ch = game.user?.character;
  if (ch) return { actor: ch, token: null };
  return { actor: null, token: null };
}

export async function executeInteractableButton(button, placeableDoc) {
  if (!button || !button.enabled) return;
  const { actor, token } = _activeActorForExec();

  const formula = String(button.compiledFormula ?? "").trim();
  if (!formula || formula === "0") {
    ui.notifications?.info(`Interactable "${button.label}" has no actions.`);
    return;
  }

  let actions = [];
  let macros  = null;
  try {
    const parsed = JSON.parse(formula);
    if (Array.isArray(parsed)) actions = parsed;
    else if (parsed?._trigger === "onClick") actions = parsed.actions ?? [];
    else if (parsed?._trigger === "multi") {
      actions = parsed._events?.onClick?.actions ?? parsed._events?.onClick ?? [];
      macros  = parsed._macros ?? null;
    } else if (parsed?._trigger === "macrosOnly") {
      macros = parsed._macros ?? null;
    } else if (parsed?.actions) {
      actions = parsed.actions;
    }
  } catch (e) {
    console.warn("SD | Interactable compiledFormula parse failed:", e, formula);
    return;
  }
  if (!Array.isArray(actions)) actions = [];

  const buttonDef = {
    label:           button.label,
    __macros:        macros,
    __sdInteractable: true,
    __placeableDoc:  placeableDoc,
    __placeableUuid: placeableDoc?.uuid ?? null,
    __token:         token
  };
  const runtime = {};

  try {
    const { ButtonExecutor } = await import("./button-executor.mjs");
    for (const action of actions) {
      try {
        if (action?.delay > 0) await new Promise(r => setTimeout(r, action.delay));
        await ButtonExecutor._runAction(action, null, actor, buttonDef, runtime);
      } catch (err) {
        console.error("SD | Interactable action failed:", err, action);
      }
    }
  } catch (e) {
    console.error("SD | Interactable: failed to load ButtonExecutor:", e);
  }
}

class _Overlay {
  static _root = null;
  static _installed = false;
  static _refreshScheduled = false;
  static _activeChips = new Map();

  static install() {
    if (this._installed) return;
    this._installed = true;

    Hooks.on("canvasReady", () => this.scheduleRefresh());
    Hooks.on("canvasPan",   () => this.scheduleRefresh());

    Hooks.on("refreshToken", () => this.scheduleRefresh());
    Hooks.on("refreshTile",  () => this.scheduleRefresh());
    Hooks.on("refreshNote",  () => this.scheduleRefresh());
    Hooks.on("refreshWall",  () => this.scheduleRefresh());
    Hooks.on("refreshAmbientLight", () => this.scheduleRefresh());
    Hooks.on("refreshAmbientSound", () => this.scheduleRefresh());
    Hooks.on("refreshDrawing",      () => this.scheduleRefresh());
    Hooks.on("refreshRegion",       () => this.scheduleRefresh());

    Hooks.on("controlToken", () => this.scheduleRefresh());

    for (const t of SUPPORTED_TYPES) {
      Hooks.on(`create${t}`, () => this.scheduleRefresh());
      Hooks.on(`update${t}`, () => this.scheduleRefresh());
      Hooks.on(`delete${t}`, () => this.scheduleRefresh());
    }

    window.addEventListener("resize", () => this.scheduleRefresh());
  }

  static _ensureRoot() {
    if (this._root && document.body.contains(this._root)) return this._root;
    const r = document.createElement("div");
    r.id = "sd-interactables-overlay";
    r.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;pointer-events:none;z-index:60";
    document.body.appendChild(r);
    this._root = r;
    return r;
  }

  static scheduleRefresh() {
    if (this._refreshScheduled) return;
    this._refreshScheduled = true;
    requestAnimationFrame(() => {
      this._refreshScheduled = false;
      try { this.refresh(); } catch (e) { console.warn("SD | Interactables overlay refresh failed:", e); }
    });
  }

  static refresh() {
    const root = this._ensureRoot();
    if (!canvas?.ready || !canvas.scene) {
      root.innerHTML = "";
      this._activeChips.clear();
      return;
    }

    const docs = _allPlaceableDocsWithInteractables();
    const ownedTokens = _userOwnedTokens();
    const isGM = !!game.user?.isGM;

    const visibleNow = new Set();

    for (const doc of docs) {
      const data = getInteractables(doc);
      if (!data.enabled) continue;
      const center = _placeableCenter(doc);
      const anchor = _placeableBoundsTop(doc) ?? center;
      if (!center || !anchor) continue;

      const buttons = data.buttons.filter(b => b.enabled).filter(b => {
        if (b.visibility === "gm"      && !isGM) return false;
        if (b.visibility === "players" &&  isGM) return false;
        return true;
      });
      if (!buttons.length) continue;

      const inRangeMap = new Map();
      for (const b of buttons) {
        if (isGM) {
          inRangeMap.set(b.id, true);
          continue;
        }
        if (!ownedTokens.length) {
          inRangeMap.set(b.id, false);
          continue;
        }
        let near = false;
        for (const t of ownedTokens) {
          if (t.document === doc) continue;
          const d = _docDistanceFromToken(doc, t.document);
          if (d <= b.distance) { near = true; break; }
        }
        inRangeMap.set(b.id, near);
      }

      const showButtons = buttons.filter(b => inRangeMap.get(b.id));
      if (!showButtons.length) continue;

      const key = doc.uuid;
      visibleNow.add(key);

      let chip = this._activeChips.get(key);
      if (!chip) {
        chip = this._buildChip(doc);
        this._activeChips.set(key, chip);
        root.appendChild(chip);
      }
      this._updateChip(chip, doc, showButtons, anchor);
    }

    for (const [key, chip] of [...this._activeChips.entries()]) {
      if (!visibleNow.has(key)) {
        chip.remove();
        this._activeChips.delete(key);
      }
    }
  }

  static _buildChip(doc) {
    const chip = document.createElement("div");
    chip.className = "sd-ibchip";
    chip.dataset.uuid = doc.uuid;
    chip.style.cssText = "position:absolute;transform:translate(-50%,-100%);pointer-events:auto;display:flex;flex-direction:row;align-items:flex-end;gap:6px;padding:0;background:none;border:none";
    return chip;
  }

  static _updateChip(chip, doc, buttons, anchor) {
    const scr = _worldToScreen(anchor);
    if (!scr) { chip.style.display = "none"; return; }
    chip.style.display = "flex";
    chip.style.left = `${Math.round(scr.x)}px`;
    chip.style.top  = `${Math.round(scr.y - 10)}px`;

    const wantHtml = buttons.map(b => this._buttonHtml(doc, b)).join("");
    if (chip.dataset.cached !== wantHtml) {
      chip.dataset.cached = wantHtml;
      chip.innerHTML = wantHtml;
      chip.querySelectorAll("[data-ibtn-id]").forEach(btn => {
        btn.addEventListener("click", async (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          const id = btn.dataset.ibtnId;
          const data = getInteractables(doc);
          const def  = data.buttons.find(x => x.id === id);
          if (def) {
            btn.classList.add("sd-ibtn--pulse");
            setTimeout(() => btn.classList.remove("sd-ibtn--pulse"), 220);
            await executeInteractableButton(def, doc);
          }
        });
      });
    }
  }

  static _buttonHtml(doc, b) {
    const color = HEX_RE.test(b.color) ? b.color : "#d4b15a";
    const desc  = b.description ? `<div class="sd-ibtn-desc">${_esc(b.description)}</div>` : "";
    return `<div class="sd-ibtn-wrap">
      <button type="button" class="sd-ibtn" data-ibtn-id="${_esc(b.id)}" title="${_esc(b.label)}"
        style="--sd-ibtn-color:${color}">
        <img src="${_esc(b.icon)}" alt="" draggable="false">
      </button>
      <div class="sd-ibtn-label" style="--sd-ibtn-color:${color}">${_esc(b.label)}</div>
      ${desc}
    </div>`;
  }
}

const SD_ICON_PRESETS_HTML = (current) => ICON_PRESET_PATHS.map(p => {
  const sel = current === p;
  return `<button type="button" class="sd-iep-preset" data-icon="${_esc(p)}"
    title="${_esc(p.split("/").pop())}"
    style="aspect-ratio:1/1;background:${sel?'color-mix(in srgb,var(--sd-accent) 22%,var(--sd-bg-2))':'var(--sd-bg-2)'};border:1px solid ${sel?'var(--sd-accent)':'var(--sd-border)'};border-radius:4px;cursor:pointer;padding:4px;display:flex;align-items:center;justify-content:center;transition:border-color .12s,background .12s">
    <img src="${_esc(p)}" alt="" style="max-width:100%;max-height:100%;opacity:.85;pointer-events:none" draggable="false">
  </button>`;
}).join("");

function _renderEditorHTML(state) {
  const head = `
    <div class="sd-iep-head">
      <i class="fas fa-bolt"></i>
      <div class="sd-iep-title">SD Interactables — ${_esc(state.docLabel)}</div>
      <label class="sd-iep-tog">
        <input type="checkbox" class="sd-iep-enabled" ${state.enabled ? "checked" : ""}> Enabled
      </label>
      <button type="button" class="sd-iep-close" title="Close">✕</button>
    </div>`;

  const left = state.buttons.length
    ? state.buttons.map((b, i) => `
      <li class="sd-iep-listitem ${i === state.selIdx ? "sd-iep-listitem--sel" : ""}" data-idx="${i}">
        <span class="sd-iep-li-color" style="background:${HEX_RE.test(b.color) ? b.color : '#d4b15a'}"></span>
        <img class="sd-iep-li-icon" src="${_esc(b.icon)}" alt="" draggable="false">
        <span class="sd-iep-li-lbl ${b.enabled ? "" : "sd-iep-li-lbl--off"}">${_esc(b.label || "(unnamed)")}</span>
        <button type="button" class="sd-iep-li-del" data-idx="${i}" title="Delete">✕</button>
      </li>`).join("")
    : `<li class="sd-iep-empty">No buttons. Click "Add" to create one.</li>`;

  const sel = state.buttons[state.selIdx];
  const right = sel ? `
    <div class="sd-iep-form">
      <div class="sd-iep-row">
        <label class="sd-iep-lbl"><input type="checkbox" class="sd-iep-f-enabled" ${sel.enabled ? "checked" : ""}> Enabled</label>
        <label class="sd-iep-lbl sd-iep-lbl-visibility">Visibility
          <select class="sd-iep-f-visibility">
            <option value="all"     ${sel.visibility==="all"     ? "selected":""}>All</option>
            <option value="gm"      ${sel.visibility==="gm"      ? "selected":""}>GM only</option>
            <option value="players" ${sel.visibility==="players" ? "selected":""}>Players only</option>
          </select>
        </label>
      </div>
      <div class="sd-iep-row">
        <label class="sd-iep-lbl">Label
          <input type="text" class="sd-iep-f-label" value="${_esc(sel.label)}">
        </label>
        <label class="sd-iep-lbl">Distance (${_esc(canvas?.scene?.grid?.units || "ft")})
          <input type="number" min="0" step="1" class="sd-iep-f-distance" value="${_esc(sel.distance)}">
        </label>
      </div>
      <div class="sd-iep-row">
        <label class="sd-iep-lbl sd-iep-lbl-full">Description (shown under button)
          <textarea class="sd-iep-f-description" rows="2">${_esc(sel.description)}</textarea>
        </label>
      </div>
      <div class="sd-iep-row">
        <label class="sd-iep-lbl sd-iep-lbl-full">Icon
          <div class="sd-iep-icon-line">
            <div class="sd-iep-icon-preview">
              ${sel.icon ? `<img src="${_esc(sel.icon)}" alt="" draggable="false">` : `<i class="fas fa-image"></i>`}
            </div>
            <input type="text" class="sd-iep-f-icon" value="${_esc(sel.icon)}">
            <button type="button" class="sd-iep-fp" title="Browse"><i class="fas fa-folder-open"></i></button>
          </div>
        </label>
      </div>
      <div class="sd-iep-presets">${SD_ICON_PRESETS_HTML(sel.icon)}</div>
      <div class="sd-iep-row">
        <label class="sd-iep-lbl">Accent color
          <div class="sd-iep-color-line">
            <input type="color" class="sd-iep-f-color" value="${HEX_RE.test(sel.color) ? sel.color : "#d4b15a"}">
            <input type="text"  class="sd-iep-f-color-hex" value="${_esc(HEX_RE.test(sel.color) ? sel.color : "#d4b15a")}" pattern="#[0-9a-fA-F]{6}">
            <button type="button" class="sd-iep-color-reset" title="Reset">✕</button>
          </div>
        </label>
      </div>
      <div class="sd-iep-row sd-iep-row-graph">
        <button type="button" class="sd-iep-graph-btn">
          <i class="fas fa-project-diagram"></i> Edit Action Graph
        </button>
        <span class="sd-iep-graph-status">${(sel.graphData?.nodes?.length ?? 0) > 0 ? `graph: ${sel.graphData.nodes.length} nodes` : "no graph yet"}</span>
      </div>
    </div>` : `<div class="sd-iep-empty-right">Select a button on the left, or add one.</div>`;

  return `
    ${head}
    <div class="sd-iep-body">
      <div class="sd-iep-left">
        <ul class="sd-iep-list">${left}</ul>
        <button type="button" class="sd-iep-add"><i class="fas fa-plus"></i> Add Button</button>
      </div>
      <div class="sd-iep-right">${right}</div>
    </div>
    <div class="sd-iep-foot">
      <span class="sd-iep-foot-info">Buttons appear next to the placeable on the scene when a player-owned token is within range.</span>
      <button type="button" class="sd-iep-save">Save & Close</button>
    </div>`;
}

export function openInteractablesEditor(doc) {
  if (!doc) return;
  const existing = document.getElementById("sd-iep-popup");
  if (existing) existing.remove();

  const data = getInteractables(doc);
  const state = {
    docLabel: `${doc.documentName}${doc.name ? ` — ${doc.name}` : (doc.id ? ` — ${doc.id.slice(0,6)}` : "")}`,
    enabled:  data.enabled,
    buttons:  data.buttons,
    selIdx:   data.buttons.length ? 0 : -1
  };

  const popup = document.createElement("div");
  popup.id = "sd-iep-popup";
  popup.className = "sd sd-iep-popup";
  popup.innerHTML = _renderEditorHTML(state);
  document.body.appendChild(popup);

  const _rerender = () => {
    popup.innerHTML = _renderEditorHTML(state);
    _wireAll();
  };

  const _commitField = (field, value) => {
    const b = state.buttons[state.selIdx];
    if (!b) return;
    b[field] = value;
    const li = popup.querySelector(`.sd-iep-listitem[data-idx="${state.selIdx}"]`);
    if (li) {
      if (field === "label") {
        const lbl = li.querySelector(".sd-iep-li-lbl");
        if (lbl) lbl.textContent = value || "(unnamed)";
      }
      if (field === "icon") {
        const img = li.querySelector(".sd-iep-li-icon");
        if (img) img.src = value;
        const prev = popup.querySelector(".sd-iep-icon-preview");
        if (prev) prev.innerHTML = value ? `<img src="${_esc(value)}" alt="" draggable="false">` : `<i class="fas fa-image"></i>`;
        popup.querySelectorAll(".sd-iep-preset").forEach(btn => {
          const sel = btn.dataset.icon === value;
          btn.style.background = sel ? "color-mix(in srgb,var(--sd-accent) 22%,var(--sd-bg-2))" : "var(--sd-bg-2)";
          btn.style.borderColor = sel ? "var(--sd-accent)" : "var(--sd-border)";
        });
      }
      if (field === "color") {
        const dot = li.querySelector(".sd-iep-li-color");
        if (dot) dot.style.background = HEX_RE.test(value) ? value : "#d4b15a";
      }
      if (field === "enabled") {
        const lbl = li.querySelector(".sd-iep-li-lbl");
        if (lbl) lbl.classList.toggle("sd-iep-li-lbl--off", !value);
      }
    }
  };

  const _wireAll = () => {
    popup.querySelector(".sd-iep-close")?.addEventListener("click", () => popup.remove());
    popup.querySelector(".sd-iep-save")?.addEventListener("click", async () => {
      await setInteractables(doc, { enabled: state.enabled, buttons: state.buttons });
      _Overlay.scheduleRefresh();
      popup.remove();
    });

    popup.querySelector(".sd-iep-enabled")?.addEventListener("change", (e) => {
      state.enabled = e.target.checked;
    });

    popup.querySelectorAll(".sd-iep-listitem").forEach(li => {
      li.addEventListener("click", (e) => {
        if (e.target.classList.contains("sd-iep-li-del")) return;
        state.selIdx = Number(li.dataset.idx);
        _rerender();
      });
    });
    popup.querySelectorAll(".sd-iep-li-del").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const idx = Number(btn.dataset.idx);
        const ok = await foundry.applications.api.DialogV2.confirm({
          window: { title: "Delete Interactable Button" },
          content: `<p>Delete button "<strong>${_esc(state.buttons[idx]?.label ?? "")}</strong>"?</p>`
        }).catch(() => false);
        if (!ok) return;
        state.buttons.splice(idx, 1);
        if (state.selIdx >= state.buttons.length) state.selIdx = state.buttons.length - 1;
        _rerender();
      });
    });

    popup.querySelector(".sd-iep-add")?.addEventListener("click", () => {
      const b = _normalizeButton({ label: `Button ${state.buttons.length + 1}` });
      state.buttons.push(b);
      state.selIdx = state.buttons.length - 1;
      _rerender();
    });

    popup.querySelector(".sd-iep-f-enabled")?.addEventListener("change", (e) => _commitField("enabled", !!e.target.checked));
    popup.querySelector(".sd-iep-f-visibility")?.addEventListener("change", (e) => _commitField("visibility", e.target.value));
    popup.querySelector(".sd-iep-f-label")?.addEventListener("input", (e) => _commitField("label", e.target.value));
    popup.querySelector(".sd-iep-f-distance")?.addEventListener("input", (e) => {
      const n = Number(e.target.value);
      _commitField("distance", Number.isFinite(n) ? Math.max(0, n) : 5);
    });
    popup.querySelector(".sd-iep-f-description")?.addEventListener("input", (e) => _commitField("description", e.target.value));
    popup.querySelector(".sd-iep-f-icon")?.addEventListener("input", (e) => _commitField("icon", e.target.value));

    popup.querySelectorAll(".sd-iep-preset").forEach(btn => {
      btn.addEventListener("click", () => {
        const path = btn.dataset.icon;
        _commitField("icon", path);
        const iconInp = popup.querySelector(".sd-iep-f-icon");
        if (iconInp) iconInp.value = path;
      });
    });

    popup.querySelector(".sd-iep-fp")?.addEventListener("click", () => {
      try {
        const cur = popup.querySelector(".sd-iep-f-icon")?.value ?? "";
        const FP = foundry.applications.apps.FilePicker?.implementation ?? FilePicker;
        const fp = new FP({
          type:    "image",
          current: cur || "icons/svg/circle.svg",
          callback: (path) => {
            _commitField("icon", path);
            const inp = popup.querySelector(".sd-iep-f-icon");
            if (inp) inp.value = path;
          }
        });
        fp.render(true);
      } catch (e) { console.warn("SD | Interactables FilePicker failed:", e); }
    });

    const colorInp = popup.querySelector(".sd-iep-f-color");
    const colorHex = popup.querySelector(".sd-iep-f-color-hex");
    colorInp?.addEventListener("input", (e) => {
      _commitField("color", e.target.value);
      if (colorHex) colorHex.value = e.target.value;
    });
    colorHex?.addEventListener("input", (e) => {
      const v = e.target.value.trim();
      if (HEX_RE.test(v)) {
        _commitField("color", v);
        if (colorInp) colorInp.value = v;
      }
    });
    popup.querySelector(".sd-iep-color-reset")?.addEventListener("click", () => {
      _commitField("color", "#d4b15a");
      if (colorInp) colorInp.value = "#d4b15a";
      if (colorHex) colorHex.value = "#d4b15a";
    });

    popup.querySelector(".sd-iep-graph-btn")?.addEventListener("click", async () => {
      const sel = state.buttons[state.selIdx];
      if (!sel) return;
      try {
        const { FormulaGraph } = await import("../builder/formula-graph.mjs");
        const graph = new FormulaGraph(null, doc, null, null, null, {
          mode: "actionGraph",
          customLoad: () => sel.graphData ?? null,
          customSave: async (data, compiled) => {
            sel.graphData       = data;
            sel.compiledFormula = compiled;
            const statusEl = popup.querySelector(".sd-iep-graph-status");
            if (statusEl) {
              const n = sel.graphData?.nodes?.length ?? 0;
              statusEl.textContent = n > 0 ? `graph: ${n} nodes` : "no graph yet";
            }
            try {
              await setInteractables(doc, { enabled: state.enabled, buttons: state.buttons });
              _Overlay.scheduleRefresh();
            } catch (e) {
              console.warn("SD | Interactables: auto-persist after graph save failed:", e);
            }
          }
        });
        graph.open();
      } catch (e) {
        console.error("SD | Interactables: open Action Graph failed:", e);
        ui.notifications?.error("Action Graph editor failed to open. See console.");
      }
    });
  };

  _wireAll();

  const _onKey = (ev) => {
    if (ev.key === "Escape") {
      popup.remove();
      window.removeEventListener("keydown", _onKey);
    }
  };
  window.addEventListener("keydown", _onKey);

  _makeDraggable(popup);
}

function _makeDraggable(popup) {
  const head = popup.querySelector(".sd-iep-head");
  if (!head) return;
  let ds = null;
  head.addEventListener("mousedown", (e) => {
    if (e.target.closest("button,input,select,textarea,label")) return;
    const rect = popup.getBoundingClientRect();
    ds = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    popup.style.left = `${rect.left}px`;
    popup.style.top  = `${rect.top}px`;
    popup.style.transform = "none";
    e.preventDefault();
  });
  document.addEventListener("mousemove", (e) => {
    if (!ds) return;
    popup.style.left = `${e.clientX - ds.dx}px`;
    popup.style.top  = `${e.clientY - ds.dy}px`;
  });
  document.addEventListener("mouseup", () => ds = null);
}

function _addConfigHook(hookName, app, html, doc) {
  if (!doc || !SUPPORTED_TYPES.includes(doc.documentName)) return;
  const root = (html instanceof HTMLElement) ? html : (html?.[0] ?? html);
  if (!root || typeof root.querySelector !== "function") return;
  if (root.querySelector(".sd-iep-open-btn")) return;

  const data = getInteractables(doc);
  const count = data.buttons.filter(b => b.enabled).length;

  const wrap = document.createElement("div");
  wrap.className = "form-group sd-iep-host";
  wrap.style.cssText = "margin:8px 0;padding:8px;border:1px solid var(--color-border-light-2, #999);border-radius:4px;background:rgba(123,104,238,0.08)";
  wrap.innerHTML = `
    <label style="display:flex;align-items:center;gap:8px;font-weight:600;cursor:default">
      <i class="fas fa-bolt" style="color:#7b68ee"></i>
      <span>SD Interactables</span>
      <span class="sd-iep-host-count" style="margin-left:auto;font-size:11px;opacity:.7">${count} active button${count===1?"":"s"}</span>
    </label>
    <button type="button" class="sd-iep-open-btn" style="margin-top:6px;padding:6px 12px;background:#7b68ee;color:#fff;border:1px solid #5d4ad1;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;display:flex;align-items:center;gap:6px;width:100%;justify-content:center">
      <i class="fas fa-edit"></i> Edit SD Interactables…
    </button>
    <div style="font-size:10px;opacity:.65;margin-top:4px;line-height:1.4">
      Attach interactive buttons that appear near this ${doc.documentName.toLowerCase()} when a player's token is within range. Each button has its own action graph.
    </div>`;

  const targets = [
    root.querySelector(".form-footer"),
    root.querySelector("footer"),
    root.querySelector('button[type="submit"]')?.parentElement,
    root.querySelector(".window-content"),
    root
  ];
  let inserted = false;
  for (const tgt of targets) {
    if (!tgt) continue;
    try {
      if (tgt.tagName === "FOOTER" || tgt.classList?.contains("form-footer")) {
        tgt.parentElement?.insertBefore(wrap, tgt);
      } else {
        tgt.appendChild(wrap);
      }
      inserted = true;
      break;
    } catch {}
  }
  if (!inserted) return;

  wrap.querySelector(".sd-iep-open-btn")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    openInteractablesEditor(doc);
  });
}

function _resolveDocFromConfigApp(app) {
  if (!app) return null;
  const cand = app.document ?? app.object ?? app.options?.document;
  if (cand?.documentName && SUPPORTED_TYPES.includes(cand.documentName)) return cand;
  return null;
}

export function registerInteractables() {
  _Overlay.install();

  const _h = (hookName) => Hooks.on(hookName, (app, html, data) => {
    try {
      const doc = _resolveDocFromConfigApp(app);
      if (!doc) return;
      _addConfigHook(hookName, app, html, doc);
    } catch (e) {
      console.warn(`SD | Interactables: ${hookName} hook failed:`, e);
    }
  });

  _h("renderTileConfig");
  _h("renderTokenConfig");
  _h("renderTokenConfigPF");
  _h("renderPrototypeTokenConfig");
  _h("renderNoteConfig");
  _h("renderWallConfig");
  _h("renderAmbientLightConfig");
  _h("renderAmbientSoundConfig");
  _h("renderDrawingConfig");
  _h("renderRegionConfig");

  globalThis.SDInteractables = {
    open: openInteractablesEditor,
    get:  getInteractables,
    set:  setInteractables,
    refresh: () => _Overlay.scheduleRefresh()
  };
}
