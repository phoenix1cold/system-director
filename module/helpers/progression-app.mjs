/**
 * module/helpers/progression-app.mjs
 *
 * ProgressionApp -- Character Progression Manager for System Director.
 *
 * Replaces the roll-dice button on the character sheet header.
 * Opens a window with two tabs:
 *
 *   Level Up   -- list of level definitions; click "Apply" to grant rewards.
 *   Skill Tree -- interactive node grid; click a node to acquire it.
 *
 * In edit mode (GM only) both tabs become fully editable:
 *   Level Up  : add/remove levels, drag items onto a level, add field-change
 *               instructions, add effects.  Drag a "class" item to use it as
 *               the progression template (changes are saved back to the item).
 *   Skill Tree: resize the grid, drag items onto empty cells to create nodes,
 *               configure each node (label, field changes, maxAcquire),
 *               draw/delete connections by clicking two nodes in sequence.
 *               Drag a "skilltree" item to use it as the tree source.
 *
 * Storage
 * -------
 * Config (template definition):
 *   actor.flags.sd.progression.config = {
 *     classItemId:      null | string,   // linked class item on this actor
 *     skilltreeItemId:  null | string,   // linked skilltree item
 *     inlineLevels:     [...],           // used when no classItem is linked
 *     inlineSkilltree:  {...}            // used when no skilltree item linked
 *   }
 *
 * State (per-actor progress):
 *   actor.flags.sd.progression.state = {
 *     appliedLevel:  0,       // highest level number that has been applied
 *     acquiredNodes: {}       // { [nodeId]: count }
 *   }
 */

const { ApplicationV2 } = foundry.applications.api;

// Helpers

function rndId()      { return foundry.utils.randomID(8); }
function dc(obj)      { return foundry.utils.deepClone(obj); }
function e(str)       { return String(str ?? "").replace(/"/g, "&quot;").replace(/</g, "&lt;"); }
function loc(key)     { return game.i18n.localize(key); }

/** Walk a dot-path on an object and return the leaf value. */
function getNestedValue(obj, path) {
  return path.split(".").reduce((cur, k) => cur?.[k], obj);
}

/**
 * Build a Foundry update-object for a single FieldChange instruction,
 * resolved against the current actor data.
 */
function buildFieldUpdate(actor, { path, mode, value }) {
  const numVal = Number(value);
  const safe   = isNaN(numVal) ? 0 : numVal;
  const current = getNestedValue(actor, path) ?? 0;
  let newVal;
  switch (mode) {
    case "set":      newVal = safe; break;
    case "multiply": newVal = current * safe; break;
    default:         newVal = current + safe; break; // "add"
  }
  return { [path]: newVal };
}

// ProgressionApp

export class ProgressionApp extends ApplicationV2 {

  static DEFAULT_OPTIONS = {
    id:      "sd-progression",
    classes: ["sd", "sd-progression-app"],
    window: {
      title:       "SD.Progression.Title",
      icon:        "fas fa-star-half-alt",
      resizable:   true,
      minimizable: true
    },
    position: { width: 720, height: 560 }
  };

  /** One instance per actor id. */
  static _instances = new Map();

  /**
   * Open (or bring to front) the progression window for the given actor.
   */
  static open(actor) {
    let inst = ProgressionApp._instances.get(actor.id);
    if (!inst) {
      inst = new ProgressionApp({ actor });
      ProgressionApp._instances.set(actor.id, inst);
    }
    if (inst.rendered) inst.bringToFront();
    else               inst.render(true);
    return inst;
  }

  // Constructor

  constructor(options = {}) {
    super({ ...options, id: `sd-progression-${options.actor?.id ?? "unknown"}` });
    this._actor        = options.actor;
    this._tab          = "levelup";
    this._editMode     = false;
    this._connectFrom  = null;   // nodeId being connected in skill-tree edit mode
  }

  // Getters

  get title() {
    return `${loc("SD.Progression.Title")} — ${this._actor?.name ?? ""}`;
  }

  get _config() {
    return this._actor.getFlag("sd", "progression.config") ?? {};
  }

  get _state() {
    return this._actor.getFlag("sd", "progression.state") ?? { appliedLevel: 0, acquiredNodes: {} };
  }

  /** Levels array from the linked class item, or from inline config. */
  get _levels() {
    const cfg = this._config;
    if (cfg.classItemId) {
      const item = this._actor.items.get(cfg.classItemId);
      if (item?.type === "class") return item.system.levels ?? [];
    }
    return cfg.inlineLevels ?? [];
  }

  /** Skill-tree data object from the linked skilltree item, or from inline config. */
  get _skilltree() {
    const cfg = this._config;
    if (cfg.skilltreeItemId) {
      const item = this._actor.items.get(cfg.skilltreeItemId);
      if (item?.type === "skilltree") return item.system;
    }
    return cfg.inlineSkilltree ?? null;
  }

  // Rendering

  /**
   * ApplicationV2 low-level render hook -- build the inner HTML string.
   */
  async _renderHTML(context, options) {
    return this._buildHTML();
  }

  /** Replace content with fresh HTML. */
  _replaceHTML(result, content, options) {
    content.innerHTML = result;
  }

  async _prepareContext(options) { return {}; }

  // HTML builders

  _buildHTML() {
    const levels    = this._levels;
    const st        = this._skilltree;
    const state     = this._state;
    const cfg       = this._config;
    const isGM      = game.user.isGM;
    const em        = this._editMode;

    const hasLevels = levels.length > 0 || em;
    const hasST     = st !== null || em;
    const bothTabs  = hasLevels && hasST;

    let html = `<div class="sd-prog-app" data-actor-id="${this._actor.id}">`;

    /* ── Top bar ─────────────────────────────────────────────────────── */
    html += `<div class="sd-prog-topbar">`;

    if (bothTabs) {
      html += `
        <a class="sd-prog-tab ${this._tab === "levelup"   ? "active" : ""}" data-tab="levelup">
          <i class="fas fa-arrow-circle-up"></i> ${loc("SD.Progression.LevelUp")}</a>
        <a class="sd-prog-tab ${this._tab === "skilltree" ? "active" : ""}" data-tab="skilltree">
          <i class="fas fa-project-diagram"></i> ${loc("SD.Progression.SkillTree")}</a>`;
    } else if (!hasLevels && !hasST) {
      if (isGM) {
        html += `<span class="sd-prog-hint">${loc("SD.Progression.HintSetup")}</span>`;
      } else {
        html += `<span class="sd-prog-hint">${loc("SD.Progression.HintNotConfigured")}</span>`;
      }
    }

    if (isGM) {
      html += `<a class="sd-prog-edit-toggle ${em ? "active" : ""}" data-action="toggleEdit" title="${loc("SD.Progression.EditMode")}">
        <i class="fas fa-pen-ruler"></i></a>`;
    }

    html += `</div>`;

    /* ── Body ────────────────────────────────────────────────────────── */
    html += `<div class="sd-prog-body">`;

    if (!bothTabs || this._tab === "levelup") {
      html += this._buildLevelUpHTML(levels, state, cfg, em, isGM);
    }
    if (!bothTabs || this._tab === "skilltree") {
      html += this._buildSkillTreeHTML(st, state, cfg, em, isGM);
    }

    html += `</div></div>`;
    return html;
  }

  /* ── Level-Up section ────────────────────────────────────────────────── */

  _buildLevelUpHTML(levels, state, cfg, em, isGM) {
    const appliedLevel = state.appliedLevel ?? 0;
    const curLevel     = this._actor.system?.advancement?.level ?? 1;

    let html = `<div class="sd-prog-levelup">`;

    /* header row */
    html += `<div class="sd-prog-lu-hdr">
      <div class="sd-prog-cur-level">
        <span class="sd-prog-cur-num">${curLevel}</span>
        <span class="sd-prog-cur-lbl">${loc("SD.Progression.CurrentLevel")}</span>
      </div>`;

    if (em && isGM) {
      const ci = cfg.classItemId ? this._actor.items.get(cfg.classItemId) : null;
      html += `<div class="sd-prog-source-drop" data-action="dropClassItem" title="${loc("SD.Progression.DropClassHere")}">`;
      if (ci) {
        html += `<img src="${ci.img ?? "icons/svg/item-bag.svg"}" style="width:18px;height:18px;border-radius:3px;margin-right:4px;">
                 ${e(ci.name)}
                 <button type="button" class="sd-prog-unlink" data-action="unlinkClass"><i class="fas fa-times"></i></button>`;
      } else {
        html += `<i class="fas fa-graduation-cap" style="margin-right:5px;opacity:.5;"></i>
                 <span style="opacity:.6;">${loc("SD.Progression.DropClassHere")}</span>`;
      }
      html += `</div>
        <button type="button" class="sd-prog-add-btn" data-action="addLevel">
          <i class="fas fa-plus"></i> ${loc("SD.Progression.AddLevel")}
        </button>`;
    }

    html += `</div>`; // lu-hdr

    /* levels list */
    if (levels.length === 0) {
      html += `<p class="sd-prog-empty">${em ? loc("SD.Progression.EmptyClickAdd") : loc("SD.Progression.NoLevels")}</p>`;
    }

    html += `<div class="sd-prog-levels-list">`;

    for (let i = 0; i < levels.length; i++) {
      const lv        = levels[i];
      const applied   = appliedLevel >= lv.level;
      const isNext    = !applied && (i === 0 || appliedLevel >= (levels[i - 1]?.level ?? 0));
      const classes   = ["sd-prog-level-entry", applied ? "applied" : "", isNext ? "next" : ""].filter(Boolean).join(" ");

      html += `<div class="${classes}" data-level-idx="${i}">`;

      /* entry header */
      html += `<div class="sd-prog-le-hdr">
        <span class="sd-prog-le-badge"><i class="fas fa-chevron-up"></i> ${loc("SD.Progression.Level")} ${lv.level}</span>`;

      if (em && isGM) {
        html += `<input class="sd-prog-le-label-inp" type="text" value="${e(lv.label ?? "")}"
                   placeholder="${loc("SD.Progression.LabelPlaceholder")}"
                   data-action="changeLevelLabel" data-idx="${i}">`;
      } else if (lv.label) {
        html += `<span class="sd-prog-le-label">${e(lv.label)}</span>`;
      }

      html += `<div class="sd-prog-le-hdr-right">`;

      if (!em && isNext) {
        html += `<button type="button" class="sd-prog-apply-btn" data-action="applyLevel" data-idx="${i}">
          <i class="fas fa-check"></i> ${loc("SD.Progression.Apply")}
        </button>`;
      } else if (!em && applied) {
        html += `<span class="sd-prog-applied-badge"><i class="fas fa-check-circle"></i> ${loc("SD.Progression.Applied")}</span>`;
      }

      if (em && isGM) {
        html += `<button type="button" class="sd-prog-del-btn" data-action="deleteLevel" data-idx="${i}">
          <i class="fas fa-trash"></i></button>`;
      }

      html += `</div></div>`; // le-hdr-right, le-hdr

      /* rewards grid */
      html += `<div class="sd-prog-le-rewards">`;

      /* items */
      html += `<div class="sd-prog-le-col">
        <div class="sd-prog-le-sec-title"><i class="fas fa-backpack"></i> ${loc("SD.Progression.Items")}</div>
        <div class="sd-prog-items-zone ${em ? "droppable" : ""}" data-drop-target="levelItem" data-level-idx="${i}">`;

      const items = lv.items ?? [];
      if (items.length === 0 && em) {
        html += `<span class="sd-prog-drop-hint"><i class="fas fa-arrow-alt-circle-down"></i> ${loc("SD.Progression.DropItemsHere")}</span>`;
      }
      for (let j = 0; j < items.length; j++) {
        const it = items[j];
        html += `<div class="sd-prog-item-chip" draggable="false">
          <img src="${e(it.img ?? "icons/svg/item-bag.svg")}">
          <span>${e(it.name ?? "Item")}</span>
          ${em ? `<button type="button" data-action="removeLevelItem" data-level-idx="${i}" data-item-idx="${j}"><i class="fas fa-times"></i></button>` : ""}
        </div>`;
      }

      html += `</div></div>`; // items-zone, le-col

      /* field changes */
      html += `<div class="sd-prog-le-col">
        <div class="sd-prog-le-sec-title">
          <i class="fas fa-sliders-h"></i> ${loc("SD.Progression.FieldChanges")}
          ${em ? `<button type="button" class="sd-prog-mini-add" data-action="addFieldChange" data-level-idx="${i}"><i class="fas fa-plus"></i></button>` : ""}
        </div>`;

      const fcs = lv.fieldChanges ?? [];
      if (fcs.length === 0 && !em) {
        html += `<span class="sd-prog-empty-small">—</span>`;
      }
      for (let j = 0; j < fcs.length; j++) {
        const fc = fcs[j];
        if (em) {
          const mAdd  = fc.mode === "add"      ? "selected" : "";
          const mSet  = fc.mode === "set"      ? "selected" : "";
          const mMul  = fc.mode === "multiply" ? "selected" : "";
          html += `<div class="sd-prog-fc-row">
            <input type="text" class="sd-prog-fc-path" value="${e(fc.path)}"
                   placeholder="system.resources.hp.max"
                   data-action="fcChangePath" data-level-idx="${i}" data-fc-idx="${j}">
            <select class="sd-prog-fc-mode" data-action="fcChangeMode" data-level-idx="${i}" data-fc-idx="${j}">
              <option value="add"      ${mAdd}>+</option>
              <option value="set"      ${mSet}>=</option>
              <option value="multiply" ${mMul}>×</option>
            </select>
            <input type="text" class="sd-prog-fc-value" value="${e(fc.value)}"
                   placeholder="0"
                   data-action="fcChangeValue" data-level-idx="${i}" data-fc-idx="${j}">
            <button type="button" class="sd-prog-fc-del" data-action="removeFc" data-level-idx="${i}" data-fc-idx="${j}">
              <i class="fas fa-times"></i></button>
          </div>`;
        } else {
          const sym = fc.mode === "set" ? "=" : fc.mode === "multiply" ? "×" : "+";
          html += `<div class="sd-prog-fc-view">
            <code>${e(fc.path)}</code>
            <span class="sd-prog-fc-sym">${sym}</span>
            <strong>${e(fc.value)}</strong>
          </div>`;
        }
      }

      html += `</div>`; // le-col

      /* effects */
      html += `<div class="sd-prog-le-col">
        <div class="sd-prog-le-sec-title">
          <i class="fas fa-magic"></i> ${loc("SD.Progression.Effects")}
          ${em ? `<button type="button" class="sd-prog-mini-add" data-action="addEffect" data-level-idx="${i}"><i class="fas fa-plus"></i></button>` : ""}
        </div>`;

      const effects = lv.effects ?? [];
      if (effects.length === 0) {
        html += `<span class="sd-prog-empty-small">—</span>`;
      }
      for (let j = 0; j < effects.length; j++) {
        const ef = effects[j];
        html += `<div class="sd-prog-effect-chip">
          <img src="${e(ef.icon ?? "icons/svg/aura.svg")}" style="width:16px;height:16px;border-radius:2px;margin-right:4px;">
          ${e(ef.name ?? "Effect")}
          ${em ? `<button type="button" data-action="removeEffect" data-level-idx="${i}" data-effect-idx="${j}"><i class="fas fa-times"></i></button>` : ""}
        </div>`;
      }

      html += `</div>`; // le-col (effects)

      html += `</div>`; // le-rewards
      html += `</div>`; // level-entry
    }

    html += `</div></div>`; // levels-list, levelup
    return html;
  }

  /* ── Skill-Tree section ──────────────────────────────────────────────── */

  _buildSkillTreeHTML(st, state, cfg, em, isGM) {
    const acquiredNodes = state.acquiredNodes ?? {};
    const CELL = 74;
    const GAP  = 5;

    let html = `<div class="sd-prog-skilltree">`;

  /* source drop / toolbar */
  html += `<div class="sd-prog-st-toolbar">`;

  // Skill Points display
  const sp = this._actor.system?.skillPoints ?? { value: 0, max: 0 };
  const spValue = sp.value ?? 0;
  const spMax = sp.max ?? 0;
  html += `<div class="sd-prog-sp-block" style="display:flex;align-items:center;gap:6px;padding:2px 8px;background:#1a1a28;border:1px solid #3a3a52;border-radius:6px;margin-right:auto;">
    <i class="fas fa-star" style="color:#7b68ee;font-size:12px;"></i>
    <span style="font-size:11px;color:#888;font-weight:600;text-transform:uppercase;letter-spacing:.04em;">${loc("SD.Progression.SkillPoints")}</span>
    <button type="button" data-action="spStep" data-step="-1" style="width:22px;height:22px;background:#22222e;border:1px solid #3a3a52;border-radius:4px;color:#a0a0c0;cursor:pointer;font-size:14px;line-height:1;flex-shrink:0;">−</button>
    <input type="number" data-action="spSetValue" value="${spValue}" min="0" style="width:40px;text-align:center;font-weight:700;font-size:14px;background:#22222e;border:1px solid #3a3a52;border-radius:4px;color:#e0e0ee;padding:2px;box-sizing:border-box;">
    <span style="color:#555;flex-shrink:0;">/</span>
    <input type="number" data-action="spSetMax" value="${spMax}" min="0" style="width:40px;text-align:center;font-size:13px;background:#22222e;border:1px solid #3a3a52;border-radius:4px;color:#a0a0c0;padding:2px;box-sizing:border-box;">
    <button type="button" data-action="spStep" data-step="1" style="width:22px;height:22px;background:#22222e;border:1px solid #3a3a52;border-radius:4px;color:#a0a0c0;cursor:pointer;font-size:14px;line-height:1;flex-shrink:0;">+</button>
    <button type="button" data-action="spCopyPath" title="system.skillPoints.value" style="background:none;border:none;color:#555;cursor:pointer;font-size:11px;padding:0 4px;flex-shrink:0;"><i class="fas fa-copy"></i></button>
  </div>`;

  if (em && isGM) {
    const sti = cfg.skilltreeItemId ? this._actor.items.get(cfg.skilltreeItemId) : null;
    html += `<div class="sd-prog-source-drop" data-action="dropSkilltreeItem">`;
    if (sti) {
      html += `<img src="${sti.img ?? "icons/svg/item-bag.svg"}" style="width:18px;height:18px;border-radius:3px;margin-right:4px;">
      ${e(sti.name)}
      <button type="button" class="sd-prog-unlink" data-action="unlinkSkilltree"><i class="fas fa-times"></i></button>`;
    } else {
      html += `<i class="fas fa-project-diagram" style="margin-right:5px;opacity:.5;"></i>
      <span style="opacity:.6;">${loc("SD.Progression.DropSkilltreeHere")}</span>`;
    }
    html += `</div>`;

    if (!cfg.skilltreeItemId) {
      const cols = st?.cols ?? 8;
      const rows = st?.rows ?? 5;
      html += `
      <label class="sd-prog-dim-lbl">${loc("SD.Progression.Cols")}
        <input type="number" value="${cols}" min="2" max="20" data-action="stSetCols" style="width:46px"></label>
      <label class="sd-prog-dim-lbl">${loc("SD.Progression.Rows")}
        <input type="number" value="${rows}" min="2" max="20" data-action="stSetRows" style="width:46px"></label>`;
    }

    if (this._connectFrom) {
      html += `<button type="button" class="sd-prog-conn-cancel" data-action="cancelConnect">
        <i class="fas fa-unlink"></i> ${loc("SD.Progression.CancelConnect")}</button>`;
    } else {
      html += `<button type="button" class="sd-prog-conn-btn" data-action="startConnect">
        <i class="fas fa-link"></i> ${loc("SD.Progression.Connect")}</button>`;
    }
  }

  html += `</div>`; // st-toolbar

    if (!st && !em) {
      html += `<p class="sd-prog-empty">${loc("SD.Progression.NoSkilltree")}</p></div>`;
      return html;
    }

    const cols  = st?.cols ?? 8;
    const rows  = st?.rows ?? 5;
    const nodes = st?.nodes ?? [];
    const conns = st?.connections ?? [];

    const W = cols * (CELL + GAP);
    const H = rows * (CELL + GAP);

    html += `<div class="sd-prog-st-scroll">
      <div class="sd-prog-st-canvas" style="width:${W}px; height:${H}px; position:relative;">`;

    /* SVG layer for connections */
    html += `<svg class="sd-prog-st-svg"
                  width="${W}" height="${H}"
                  viewBox="0 0 ${W} ${H}"
                  style="position:absolute;top:0;left:0;pointer-events:none;z-index:1;overflow:visible;">
      <defs>
        <marker id="sd-arrow" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto">
          <path d="M0,0 L7,3.5 L0,7 Z" fill="var(--sd-accent)" opacity=".7"/>
        </marker>
        <marker id="sd-arrow-dim" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto">
          <path d="M0,0 L7,3.5 L0,7 Z" fill="#3a3a52"/>
        </marker>
      </defs>`;

    for (const conn of conns) {
      const fn = nodes.find(n => n.id === conn.from);
      const tn = nodes.find(n => n.id === conn.to);
      if (!fn || !tn) continue;

      const x1 = fn.col * (CELL + GAP) + CELL / 2;
      const y1 = fn.row * (CELL + GAP) + CELL / 2;
      const x2 = tn.col * (CELL + GAP) + CELL / 2;
      const y2 = tn.row * (CELL + GAP) + CELL / 2;

      const active = (acquiredNodes[conn.from] ?? 0) > 0 && (acquiredNodes[conn.to] ?? 0) > 0;
      const marker = active ? "sd-arrow" : "sd-arrow-dim";

      // Shorten line so it doesn't overlap the node squares
      const dx    = x2 - x1;
      const dy    = y2 - y1;
      const dist  = Math.sqrt(dx * dx + dy * dy) || 1;
      const pad   = 20;
      const sx    = x1 + (dx / dist) * pad;
      const sy    = y1 + (dy / dist) * pad;
      const ex    = x2 - (dx / dist) * pad;
      const ey    = y2 - (dy / dist) * pad;

      html += `<line class="sd-prog-conn ${active ? "active" : ""}"
               x1="${sx}" y1="${sy}" x2="${ex}" y2="${ey}"
               stroke="${active ? "var(--sd-accent)" : "#3a3a52"}"
               stroke-width="${active ? 2 : 1.5}"
               stroke-dasharray="${active ? "none" : "5,4"}"
               marker-end="url(#${marker})"
               data-from="${e(conn.from)}" data-to="${e(conn.to)}"
               ${em ? 'style="pointer-events:stroke;cursor:pointer;" data-action="deleteConnection"' : ''}/>`;
    }

    html += `</svg>`;

    /* Cell grid */
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const node  = nodes.find(n => n.col === col && n.row === row);
        const left  = col * (CELL + GAP);
        const top   = row * (CELL + GAP);
        const style = `left:${left}px;top:${top}px;width:${CELL}px;height:${CELL}px;`;

        if (node) {
        const count = acquiredNodes[node.id] ?? 0;
        const maxAcq = node.maxAcquire ?? 1;
        const nodeCost = node.cost ?? 1;
        const acquired = count >= maxAcq;
        const sp = this._actor.system?.skillPoints ?? { value: 0, max: 0 };
        const canAfford = (sp.value ?? 0) >= nodeCost;
        const canAcquire = !acquired && canAfford && this._canAcquireNode(node, conns, acquiredNodes, nodes);
          const connecting = this._connectFrom === node.id;

          const cls = [
            "sd-prog-st-node",
            acquired   ? "acquired"   : "",
            canAcquire ? "available"  : "",
            connecting ? "connecting" : "",
            (em && isGM) ? "editable" : ""
          ].filter(Boolean).join(" ");

          const bgStyle = node.color ? `background:${node.color};` : "";

          html += `<div class="${cls}" style="${style}${bgStyle}"
                   data-node-id="${e(node.id)}"
                   data-action="${em ? "stNodeClick" : canAcquire ? "acquireNode" : ""}">`;

          if (node.item?.img) {
            html += `<img class="sd-prog-node-img" src="${e(node.item.img)}" draggable="false">`;
          } else {
            html += `<i class="fas fa-star sd-prog-node-fa"></i>`;
          }

        const label = node.label || node.item?.name || "";
        if (label) html += `<div class="sd-prog-node-label">${e(label)}</div>`;

        if (nodeCost > 0) {
          html += `<div class="sd-prog-node-cost" style="font-size:9px;color:${canAfford ? '#7b68ee' : '#e05a5a'};font-weight:700;"><i class="fas fa-star" style="font-size:7px;"></i> ${nodeCost}</div>`;
        }

        if (maxAcq > 1) {
            html += `<div class="sd-prog-node-count">${count}/${maxAcq}</div>`;
          }

          if (node.fieldChanges?.length || node.effects?.length) {
            html += `<div class="sd-prog-node-badges">
              ${node.fieldChanges?.length ? `<span><i class="fas fa-sliders-h"></i>${node.fieldChanges.length}</span>` : ""}
              ${node.effects?.length      ? `<span><i class="fas fa-magic"></i>${node.effects.length}</span>`          : ""}
            </div>`;
          }

          if (em && isGM) {
            html += `<div class="sd-prog-node-tools">
              <button type="button" class="sd-prog-node-tool" data-action="configNode"    data-node-id="${e(node.id)}" title="${loc("SD.Progression.ConfigNode")}"><i class="fas fa-cog"></i></button>
              <button type="button" class="sd-prog-node-tool danger" data-action="deleteNode" data-node-id="${e(node.id)}" title="${loc("SD.Progression.DeleteNode")}"><i class="fas fa-trash"></i></button>
            </div>`;
          }

          html += `</div>`; // node

        } else if (em && isGM) {
          // Empty droppable cell
          html += `<div class="sd-prog-st-cell" style="${style}"
                   data-col="${col}" data-row="${row}"
                   data-drop-target="stNode"
                   data-action="${this._connectFrom ? "" : "stEmptyCellClick"}">
            <i class="fas fa-plus sd-prog-cell-icon"></i>
          </div>`;
        }
      }
    }

    html += `</div></div></div>`; // canvas, scroll, skilltree
    return html;
  }

  /* ── Prerequisite check ──────────────────────────────────────────────── */

  _canAcquireNode(node, connections, acquiredNodes, allNodes) {
    const prereqs = connections.filter(c => c.to === node.id).map(c => c.from);
    if (!prereqs.length) return true;
    return prereqs.every(pid => (acquiredNodes[pid] ?? 0) > 0);
  }

  // Event wiring

  _onRender(context, options) {
    const el = this.element;

    /* Tab buttons */
    el.querySelectorAll(".sd-prog-tab[data-tab]").forEach(btn =>
      btn.addEventListener("click", () => { this._tab = btn.dataset.tab; this.render(); })
    );

    /* All data-action buttons — scoped to app content to avoid hijacking
       the window-chrome controls (close, minimise) that ApplicationV2 owns */
    el.querySelectorAll(".sd-progression-app [data-action], .window-content [data-action]").forEach(btn =>
      btn.addEventListener("click", ev => { ev.stopPropagation(); this._handleAction(btn); })
    );

    /* Inline input live-saves */
    el.querySelectorAll("[data-action='changeLevelLabel']").forEach(inp =>
      inp.addEventListener("change", ev =>
        this._updateLevelField(+ev.target.dataset.idx, "label", ev.target.value))
    );
    el.querySelectorAll("[data-action='fcChangePath']").forEach(inp =>
      inp.addEventListener("change", ev =>
        this._updateFc(+ev.target.dataset.levelIdx, +ev.target.dataset.fcIdx, "path", ev.target.value))
    );
    el.querySelectorAll("[data-action='fcChangeMode']").forEach(sel =>
      sel.addEventListener("change", ev =>
        this._updateFc(+ev.target.dataset.levelIdx, +ev.target.dataset.fcIdx, "mode", ev.target.value))
    );
    el.querySelectorAll("[data-action='fcChangeValue']").forEach(inp =>
      inp.addEventListener("change", ev =>
        this._updateFc(+ev.target.dataset.levelIdx, +ev.target.dataset.fcIdx, "value", ev.target.value))
    );

    /* Skill-tree dimension inputs */
    el.querySelectorAll("[data-action='stSetCols']").forEach(inp =>
      inp.addEventListener("change", ev => this._stSetDim("cols", +ev.target.value))
    );
    el.querySelectorAll("[data-action='stSetRows']").forEach(inp =>
      inp.addEventListener("change", ev => this._stSetDim("rows", +ev.target.value))
    );

    /* SVG connection click-to-delete */
    el.querySelectorAll(".sd-prog-conn[data-action='deleteConnection']").forEach(line => {
      line.addEventListener("click", ev => {
        ev.stopPropagation();
        this._deleteConnection(line.dataset.from, line.dataset.to);
      })
    });

    /* Skill Points ± step buttons */
    el.querySelectorAll("[data-action='spStep']").forEach(btn => {
      btn.addEventListener("click", async () => {
        const step = parseInt(btn.dataset.step) || 1;
        const sp = this._actor.system?.skillPoints ?? { value: 0, max: 0 };
        const newVal = Math.max(0, (sp.value ?? 0) + step);
        await this._actor.update({ "system.skillPoints.value": newVal });
        this.render();
      });
    });

    /* Skill Points value input */
    el.querySelectorAll("[data-action='spSetValue']").forEach(inp => {
      inp.addEventListener("change", async () => {
        const v = Math.max(0, parseInt(inp.value) || 0);
        await this._actor.update({ "system.skillPoints.value": v });
        this.render();
      });
    });

    /* Skill Points max input */
    el.querySelectorAll("[data-action='spSetMax']").forEach(inp => {
      inp.addEventListener("change", async () => {
        const v = Math.max(0, parseInt(inp.value) || 0);
        await this._actor.update({ "system.skillPoints.max": v });
        this.render();
      });
    });

    /* Skill Points copy-path button */
    el.querySelectorAll("[data-action='spCopyPath']").forEach(btn => {
      btn.addEventListener("click", async () => {
        const path = "system.skillPoints.value";
        try { await navigator.clipboard.writeText(path); ui.notifications.info(`Copied: ${path}`); }
        catch { ui.notifications.warn("Could not copy to clipboard"); }
      });
    });

    /* Drag-drop — skill-tree empty cells */
    el.querySelectorAll(".sd-prog-st-cell").forEach(cell => {
      cell.addEventListener("dragover",  ev => { ev.preventDefault(); cell.classList.add("drag-over"); });
      cell.addEventListener("dragleave", ()  => cell.classList.remove("drag-over"));
      cell.addEventListener("drop",      ev  => {
        cell.classList.remove("drag-over");
        this._handleStCellDrop(ev, +cell.dataset.col, +cell.dataset.row);
      });
    });

    /* Drag-drop — skill-tree existing nodes (replace item) */
    el.querySelectorAll(".sd-prog-st-node.editable").forEach(node => {
      node.addEventListener("dragover",  ev => { ev.preventDefault(); node.classList.add("drag-over"); });
      node.addEventListener("dragleave", ()  => node.classList.remove("drag-over"));
      node.addEventListener("drop",      ev  => {
        node.classList.remove("drag-over");
        this._handleNodeItemDrop(ev, node.dataset.nodeId);
      });
    });

    /* Drag-drop — source-drop zones (class / skilltree items) */
    el.querySelectorAll(".sd-prog-source-drop").forEach(zone => {
      zone.addEventListener("dragover",  ev => { ev.preventDefault(); zone.classList.add("drag-over"); });
      zone.addEventListener("dragleave", ()  => zone.classList.remove("drag-over"));
      zone.addEventListener("drop",      ev  => {
        zone.classList.remove("drag-over");
        const action = zone.dataset.action;
        if (action === "dropClassItem")     this._handleClassItemDrop(ev);
        if (action === "dropSkilltreeItem") this._handleSkilltreeItemDrop(ev);
      });
    });
  }

  // Action dispatch

  async _handleAction(target) {
    const action = target.dataset.action;
    const isGM   = game.user.isGM;

    switch (action) {

      /* ── generic ─────────────────────────────────────────────────── */
      case "toggleEdit":
        if (!isGM) return;
        this._editMode = !this._editMode;
        this.render();
        break;

      /* ── level up ────────────────────────────────────────────────── */
      case "addLevel":
        if (!isGM) return;
        await this._addLevel();
        break;

      case "deleteLevel":
        if (!isGM) return;
        await this._deleteLevel(+target.dataset.idx);
        break;

      case "applyLevel":
        await this._applyLevel(+target.dataset.idx);
        break;

      case "addFieldChange":
        if (!isGM) return;
        await this._addFieldChange(+target.dataset.levelIdx);
        break;

      case "removeFc":
        if (!isGM) return;
        await this._removeFc(+target.dataset.levelIdx, +target.dataset.fcIdx);
        break;

      case "removeLevelItem":
        if (!isGM) return;
        await this._removeLevelItem(+target.dataset.levelIdx, +target.dataset.itemIdx);
        break;

      case "addEffect":
        if (!isGM) return;
        await this._addEffect(+target.dataset.levelIdx);
        break;

      case "removeEffect":
        if (!isGM) return;
        await this._removeEffect(+target.dataset.levelIdx, +target.dataset.effectIdx);
        break;

      /* ── skill tree ──────────────────────────────────────────────── */
      case "acquireNode": {
        const nodeId = target.closest("[data-node-id]")?.dataset?.nodeId ?? target.dataset.nodeId;
        if (nodeId) await this._acquireNode(nodeId);
        break;
      }

      case "stNodeClick": {
        if (!isGM || !this._editMode) return;
        const nodeId = target.closest("[data-node-id]")?.dataset?.nodeId;
        if (!nodeId) return;
        if (this._connectFrom) {
          if (this._connectFrom !== nodeId) await this._addConnection(this._connectFrom, nodeId);
          this._connectFrom = null;
        } else {
          this._connectFrom = nodeId;
        }
        this.render();
        break;
      }

      case "startConnect":
        ui.notifications.info(loc("SD.Progression.ClickFirstNode"));
        break;

      case "cancelConnect":
        this._connectFrom = null;
        this.render();
        break;

      case "deleteNode":
        if (!isGM) return;
        await this._deleteNode(target.dataset.nodeId ?? target.closest("[data-node-id]")?.dataset?.nodeId);
        break;

      case "configNode":
        if (!isGM) return;
        await this._openNodeConfig(target.dataset.nodeId ?? target.closest("[data-node-id]")?.dataset?.nodeId);
        break;

      case "unlinkClass":
        if (!isGM) return;
        await this._setConfigField("classItemId", null);
        this.render();
        break;

      case "unlinkSkilltree":
        if (!isGM) return;
        await this._setConfigField("skilltreeItemId", null);
        this.render();
        break;

      /* Window-chrome actions — delegate to ApplicationV2 */
      case "close":    this.close();    break;
      case "minimize": this.minimize(); break;
    }
  }

  // Level-Up operations

  async _addLevel() {
    const levels    = dc(this._levels);
    const nextLevel = (levels[levels.length - 1]?.level ?? 0) + 1;
    levels.push({ id: rndId(), level: nextLevel, label: "", items: [], effects: [], fieldChanges: [] });
    await this._saveLevels(levels);
    this.render();
  }

  async _deleteLevel(idx) {
    const levels = dc(this._levels);
    levels.splice(idx, 1);
    await this._saveLevels(levels);
    this.render();
  }

  async _updateLevelField(idx, field, value) {
    const levels = dc(this._levels);
    if (!levels[idx]) return;
    levels[idx][field] = value;
    await this._saveLevels(levels);
  }

  async _addFieldChange(levelIdx) {
    const levels = dc(this._levels);
    if (!levels[levelIdx]) return;
    levels[levelIdx].fieldChanges ??= [];
    levels[levelIdx].fieldChanges.push({ path: "system.skillPoints.max", mode: "add", value: "1" });
    levels[levelIdx].fieldChanges.push({ path: "system.skillPoints.value", mode: "add", value: "1" });
    await this._saveLevels(levels);
    this.render();
  }

  async _removeFc(levelIdx, fcIdx) {
    const levels = dc(this._levels);
    levels[levelIdx]?.fieldChanges?.splice(fcIdx, 1);
    await this._saveLevels(levels);
    this.render();
  }

  async _updateFc(levelIdx, fcIdx, field, value) {
    const levels = dc(this._levels);
    if (!levels[levelIdx]?.fieldChanges?.[fcIdx]) return;
    levels[levelIdx].fieldChanges[fcIdx][field] = value;
    await this._saveLevels(levels);
  }

  async _removeLevelItem(levelIdx, itemIdx) {
    const levels = dc(this._levels);
    levels[levelIdx]?.items?.splice(itemIdx, 1);
    await this._saveLevels(levels);
    this.render();
  }

  async _addEffect(levelIdx) {
    const name = await this._promptString(loc("SD.Progression.EffectName"), loc("SD.Progression.NewEffect"));
    if (!name) return;
    const levels = dc(this._levels);
    if (!levels[levelIdx]) return;
    levels[levelIdx].effects ??= [];
    levels[levelIdx].effects.push({
      _id: rndId(), name, icon: "icons/svg/aura.svg",
      origin: this._actor.uuid, changes: [], disabled: false, duration: {}, flags: {}
    });
    await this._saveLevels(levels);
    this.render();
  }

  async _removeEffect(levelIdx, effectIdx) {
    const levels = dc(this._levels);
    levels[levelIdx]?.effects?.splice(effectIdx, 1);
    await this._saveLevels(levels);
    this.render();
  }

  async _applyLevel(levelIdx) {
    const levels = this._levels;
    const lv     = levels[levelIdx];
    if (!lv) return;

    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window:  { title: loc("SD.Progression.ConfirmApplyTitle") },
      content: `<p>${loc("SD.Progression.ConfirmApplyMsg").replace("{level}", lv.level)}</p>`,
      yes:     { label: loc("SD.Progression.Apply"), icon: "fas fa-check" }
    });
    if (!confirmed) return;

    const actor = this._actor;

    /* Field changes */
    const updates = {};
    for (const fc of (lv.fieldChanges ?? [])) Object.assign(updates, buildFieldUpdate(actor, fc));
    if (Object.keys(updates).length) await actor.update(updates);

    /* Grant items */
    const itemDatas = (lv.items ?? []).map(snap => { const d = dc(snap); delete d._id; return d; });
    if (itemDatas.length) await actor.createEmbeddedDocuments("Item", itemDatas);

    /* Apply effects */
    const effectDatas = (lv.effects ?? []).map(ef => { const d = dc(ef); delete d._id; return d; });
    if (effectDatas.length) await actor.createEmbeddedDocuments("ActiveEffect", effectDatas);

    /* Update state */
    const state = dc(this._state);
    state.appliedLevel = lv.level;
    await actor.setFlag("sd", "progression.state", state);

    ui.notifications.info(loc("SD.Progression.LevelApplied").replace("{level}", lv.level));
    this.render();
  }

  // Skill-tree operations

  async _stSetDim(dim, value) {
    const st = dc(this._skilltree ?? { cols: 8, rows: 5, nodes: [], connections: [] });
    st[dim] = Math.max(2, Math.min(20, value || 8));
    await this._saveSkilltree(st);
    this.render();
  }

  async _deleteNode(nodeId) {
    if (!nodeId) return;
    const st = dc(this._skilltree ?? { cols: 8, rows: 5, nodes: [], connections: [] });
    st.nodes       = (st.nodes       ?? []).filter(n => n.id !== nodeId);
    st.connections = (st.connections ?? []).filter(c => c.from !== nodeId && c.to !== nodeId);
    await this._saveSkilltree(st);
    this.render();
  }

  async _addConnection(from, to) {
    const st = dc(this._skilltree ?? { cols: 8, rows: 5, nodes: [], connections: [] });
    st.connections ??= [];
    if (!st.connections.some(c => c.from === from && c.to === to)) {
      st.connections.push({ from, to });
      await this._saveSkilltree(st);
    }
    this.render();
  }

  async _deleteConnection(from, to) {
    const st = dc(this._skilltree ?? { cols: 8, rows: 5, nodes: [], connections: [] });
    st.connections = (st.connections ?? []).filter(c => !(c.from === from && c.to === to));
    await this._saveSkilltree(st);
    this.render();
  }

  async _acquireNode(nodeId) {
    const st = this._skilltree;
    if (!st) return;
    const node = (st.nodes ?? []).find(n => n.id === nodeId);
    if (!node) return;

    const state = dc(this._state);
    state.acquiredNodes ??= {};
    const count = state.acquiredNodes[nodeId] ?? 0;
    const maxAcq = node.maxAcquire ?? 1;
    const nodeCost = node.cost ?? 1;

    if (count >= maxAcq) {
      ui.notifications.warn(loc("SD.Progression.AlreadyAcquired")); return;
    }
    if (!this._canAcquireNode(node, st.connections ?? [], state.acquiredNodes, st.nodes ?? [])) {
      ui.notifications.warn(loc("SD.Progression.PrereqsNotMet")); return;
    }

    const sp = this._actor.system?.skillPoints ?? { value: 0, max: 0 };
    if ((sp.value ?? 0) < nodeCost) {
      ui.notifications.warn(loc("SD.Progression.NotEnoughPoints")); return;
    }

    const costLabel = nodeCost > 0 ? ` (${nodeCost} ${loc("SD.Progression.SkillPoints")})` : "";
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: loc("SD.Progression.AcquireNode") },
      content: `<p>${loc("SD.Progression.AcquireNodeMsg").replace("{node}", e(node.label || node.item?.name || nodeId))}${costLabel}</p>`,
      yes: { label: loc("SD.Progression.Acquire"), icon: "fas fa-star" }
    });
    if (!confirmed) return;

    const actor = this._actor;

    /* Deduct skill points */
    if (nodeCost > 0) {
      await actor.update({
        "system.skillPoints.value": (sp.value ?? 0) - nodeCost
      });
    }

    /* Field changes */
    const updates = {};
    for (const fc of (node.fieldChanges ?? [])) Object.assign(updates, buildFieldUpdate(actor, fc));
    if (Object.keys(updates).length) await actor.update(updates);

    /* Grant item */
    if (node.item) {
      const d = dc(node.item); delete d._id;
      await actor.createEmbeddedDocuments("Item", [d]);
    }

    /* Apply effects */
    const effectDatas = (node.effects ?? []).map(ef => { const d = dc(ef); delete d._id; return d; });
    if (effectDatas.length) await actor.createEmbeddedDocuments("ActiveEffect", effectDatas);

    state.acquiredNodes[nodeId] = count + 1;
    await actor.setFlag("sd", "progression.state", state);

    ui.notifications.info(loc("SD.Progression.NodeAcquired"));
    this.render();
  }

  async _openNodeConfig(nodeId) {
    if (!nodeId) return;
    const st   = dc(this._skilltree ?? { cols: 8, rows: 5, nodes: [], connections: [] });
    const node = (st.nodes ?? []).find(n => n.id === nodeId);
    if (!node) return;

    const fcRows = (node.fieldChanges ?? []).map((fc, j) => `
      <div class="sd-prog-fc-row" data-idx="${j}">
        <input type="text" class="nc-path" value="${e(fc.path)}" placeholder="system.advancement.level" style="flex:1;min-width:0;">
        <select class="nc-mode">
          <option value="add"      ${fc.mode === "add"      ? "selected" : ""}>+</option>
          <option value="set"      ${fc.mode === "set"      ? "selected" : ""}>=</option>
          <option value="multiply" ${fc.mode === "multiply" ? "selected" : ""}>×</option>
        </select>
        <input type="text" class="nc-value" value="${e(fc.value)}" style="width:56px;">
        <button type="button" class="nc-del-fc"><i class="fas fa-times"></i></button>
      </div>`).join("");

    const content = `<div style="display:flex;flex-direction:column;gap:10px;padding:8px;">
      <div style="display:flex;gap:8px;align-items:center;">
        <label style="min-width:80px;">${loc("SD.Progression.NodeLabel")}</label>
        <input id="nc-label" type="text" value="${e(node.label ?? "")}" style="flex:1;">
      </div>
  <div style="display:flex;gap:8px;align-items:center;">
    <label style="min-width:80px;">${loc("SD.Progression.MaxAcquire")}</label>
    <input id="nc-max" type="number" value="${node.maxAcquire ?? 1}" min="1" style="width:80px;">
  </div>
  <div style="display:flex;gap:8px;align-items:center;">
    <label style="min-width:80px;">${loc("SD.Progression.NodeCost")}</label>
    <input id="nc-cost" type="number" value="${node.cost ?? 1}" min="0" style="width:80px;">
  </div>
  <div style="display:flex;gap:8px;align-items:center;">
        <label style="min-width:80px;">${loc("SD.Progression.NodeColor")}</label>
        <input id="nc-color" type="color" value="${node.color || "#1e1e2e"}" style="width:56px;height:28px;">
      </div>
      <div>
        <div style="font-size:12px;font-weight:600;margin-bottom:6px;color:var(--sd-text-3);">
          <i class="fas fa-sliders-h"></i> ${loc("SD.Progression.FieldChanges")}
        </div>
        <div id="nc-fcs" style="display:flex;flex-direction:column;gap:4px;">${fcRows}</div>
        <button type="button" id="nc-add-fc" style="margin-top:6px;font-size:11px;padding:3px 8px;">
          <i class="fas fa-plus"></i> ${loc("SD.Progression.AddFieldChange")}</button>
      </div>
    </div>`;

    const confirmed = await foundry.applications.api.DialogV2.prompt({
      window:  { title: `${loc("SD.Progression.ConfigNode")}: ${node.label || node.item?.name || nodeId}` },
      content,
      ok: {
        label:    loc("SD.Save"),
        icon:     "fas fa-save",
        callback: (event, btn, dialog) => {
              const el = dialog.element;
              node.label = el.querySelector("#nc-label")?.value ?? node.label;
              node.maxAcquire = parseInt(el.querySelector("#nc-max")?.value) || 1;
              node.cost = parseInt(el.querySelector("#nc-cost")?.value) ?? 1;
              node.color = el.querySelector("#nc-color")?.value ?? "";

          const fcs = [];
          el.querySelectorAll("#nc-fcs .sd-prog-fc-row").forEach(row => {
            const path  = row.querySelector(".nc-path")?.value?.trim();
            const mode  = row.querySelector(".nc-mode")?.value ?? "add";
            const value = row.querySelector(".nc-value")?.value ?? "0";
            if (path) fcs.push({ path, mode, value });
          });
          node.fieldChanges = fcs;
          return true;
        }
      },
      render: (event, dialog) => {
        const el = dialog.element;
        /* Delete FC row */
        el.addEventListener("click", ev => {
          if (ev.target.closest(".nc-del-fc")) {
            ev.target.closest(".sd-prog-fc-row")?.remove();
          }
        });
        /* Add FC row */
        el.querySelector("#nc-add-fc")?.addEventListener("click", () => {
          const container = el.querySelector("#nc-fcs");
          const idx = container.querySelectorAll(".sd-prog-fc-row").length;
          const div = document.createElement("div");
          div.className = "sd-prog-fc-row";
          div.dataset.idx = idx;
        div.innerHTML = `
        <input type="text" class="nc-path" value="system.skillPoints.max" placeholder="system...." style="flex:1;min-width:0;">
        <select class="nc-mode"><option value="add">+</option><option value="set">=</option><option value="multiply">×</option></select>
        <input type="text" class="nc-value" value="1" style="width:56px;">
        <button type="button" class="nc-del-fc"><i class="fas fa-times"></i></button>`;
          container.appendChild(div);
        });
      },
      rejectClose: false
    });

    if (confirmed) {
      const nIdx = st.nodes.findIndex(n => n.id === nodeId);
      if (nIdx >= 0) { st.nodes[nIdx] = node; await this._saveSkilltree(st); this.render(); }
    }
  }

  // Drag-drop handlers

  async _handleItemDrop(event, levelIdx) {
    event.preventDefault();
    const data = (foundry.applications.ux?.TextEditor?.implementation ?? TextEditor).getDragEventData(event);
    if (data?.type !== "Item") return;
    const item = await this._resolveDropItem(data);
    if (!item) return;

    const snap          = item.toObject();
    snap._sourceUuid    = data.uuid;
    const levels        = dc(this._levels);
    if (!levels[levelIdx]) return;
    levels[levelIdx].items ??= [];
    levels[levelIdx].items.push(snap);
    await this._saveLevels(levels);
    this.render();
  }

  async _handleStCellDrop(event, col, row) {
    event.preventDefault();
    const data = (foundry.applications.ux?.TextEditor?.implementation ?? TextEditor).getDragEventData(event);
    if (data?.type !== "Item") return;
    const item = await this._resolveDropItem(data);
    if (!item) return;

    const snap       = item.toObject();
    snap._sourceUuid = data.uuid;
    const st         = dc(this._skilltree ?? { cols: 8, rows: 5, nodes: [], connections: [] });
    st.nodes ??= [];
    st.nodes.push({
      id: rndId(), col, row,
      label: item.name,
      item: snap,
      effects: [], fieldChanges: [],
      maxAcquire: 1, cost: 1,
      color: ""
    });
    await this._saveSkilltree(st);
    this.render();
  }

  async _handleNodeItemDrop(event, nodeId) {
    event.preventDefault();
    const data = (foundry.applications.ux?.TextEditor?.implementation ?? TextEditor).getDragEventData(event);
    if (data?.type !== "Item") return;
    const item = await this._resolveDropItem(data);
    if (!item) return;

    const snap       = item.toObject();
    snap._sourceUuid = data.uuid;
    const st         = dc(this._skilltree ?? { cols: 8, rows: 5, nodes: [], connections: [] });
    const node       = st.nodes?.find(n => n.id === nodeId);
    if (node) { node.item = snap; node.label ||= item.name; }
    await this._saveSkilltree(st);
    this.render();
  }

  async _handleClassItemDrop(event) {
    event.preventDefault();
    const data = (foundry.applications.ux?.TextEditor?.implementation ?? TextEditor).getDragEventData(event);
    if (data?.type !== "Item") return;
    const item = await this._resolveDropItem(data);
    if (item?.type !== "class") {
      ui.notifications.warn(loc("SD.Progression.NeedClassItem")); return;
    }
    let actorItem = this._actor.items.get(item.id);
    if (!actorItem) {
      const d = item.toObject(); delete d._id;
      [actorItem] = await this._actor.createEmbeddedDocuments("Item", [d]);
    }
    await this._setConfigField("classItemId", actorItem.id);
    this.render();
  }

  async _handleSkilltreeItemDrop(event) {
    event.preventDefault();
    const data = (foundry.applications.ux?.TextEditor?.implementation ?? TextEditor).getDragEventData(event);
    if (data?.type !== "Item") return;
    const item = await this._resolveDropItem(data);
    if (item?.type !== "skilltree") {
      ui.notifications.warn(loc("SD.Progression.NeedSkilltreeItem")); return;
    }
    let actorItem = this._actor.items.get(item.id);
    if (!actorItem) {
      const d = item.toObject(); delete d._id;
      [actorItem] = await this._actor.createEmbeddedDocuments("Item", [d]);
    }
    await this._setConfigField("skilltreeItemId", actorItem.id);
    this.render();
  }

  async _resolveDropItem(data) {
    try { return data.uuid ? await fromUuid(data.uuid) : null; } catch { return null; }
  }

  // Persistence helpers

  async _saveLevels(levels) {
    const cfg = this._config;
    if (cfg.classItemId) {
      const item = this._actor.items.get(cfg.classItemId);
      if (item) { await item.update({ "system.levels": levels }); return; }
    }
    await this._actor.setFlag("sd", "progression.config.inlineLevels", levels);
  }

  async _saveSkilltree(st) {
    const cfg = this._config;
    if (cfg.skilltreeItemId) {
      const item = this._actor.items.get(cfg.skilltreeItemId);
      if (item) {
        await item.update({
          "system.cols": st.cols, "system.rows": st.rows,
          "system.nodes": st.nodes, "system.connections": st.connections
        });
        return;
      }
    }
    await this._actor.setFlag("sd", "progression.config.inlineSkilltree", st);
  }

  async _setConfigField(field, value) {
    const cfg   = dc(this._config);
    cfg[field]  = value;
    await this._actor.setFlag("sd", "progression.config", cfg);
  }

  // Utility

  async _promptString(title, initial = "") {
    return foundry.applications.api.DialogV2.prompt({
      window:  { title },
      content: `<div style="padding:8px;"><input id="psi" type="text" value="${e(initial)}" style="width:100%;"></div>`,
      ok: { callback: (_ev, _btn, dlg) => dlg.element.querySelector("#psi")?.value ?? "" },
      rejectClose: false
    });
  }

  async close(options) {
    ProgressionApp._instances.delete(this._actor?.id);
    return super.close(options);
  }
}
