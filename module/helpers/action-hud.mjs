import { WidgetRenderer }  from "../builder/widget-renderer.mjs";
import { FormulaEngine }   from "./formula-engine.mjs";
import { ButtonExecutor }  from "./button-executor.mjs";
import { openInlineWidgetEditor } from "./action-hud-inline-editor.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export function registerActionHudSettings() {

  game.settings.register("sd", "actionHud", {
    name:    "SD Action HUD layout",
    scope:   "world",
    config:  false,
    type:    Object,
    default: { character: { entries: [] }, npc: { entries: [] } },
    onChange: () => SDActionHUD.refresh()
  });

  game.settings.register("sd", "actionHudEnabled", {
    name:    "SD.ActionHud.Settings.Enabled",
    hint:    "SD.ActionHud.Settings.EnabledHint",
    scope:   "client",
    config:  true,
    type:    Boolean,
    default: true,
    onChange: () => SDActionHUD.refresh()
  });

  game.settings.register("sd", "actionHudScale", {
    name:    "SD.ActionHud.Settings.Scale",
    hint:    "SD.ActionHud.Settings.ScaleHint",
    scope:   "client",
    config:  true,
    type:    Number,
    default: 100,
    range:   { min: 50, max: 200, step: 5 },
    onChange: () => SDActionHUD.refresh()
  });

  game.settings.register("sd", "actionHudPos", {
    name:    "SD Action HUD position",
    scope:   "client",
    config:  false,
    type:    Object,
    default: { x: null, y: null }
  });

  game.settings.register("sd", "actionHudBgOpacity", {
    name:    "SD.ActionHud.Settings.BgOpacity",
    hint:    "SD.ActionHud.Settings.BgOpacityHint",
    scope:   "client",
    config:  true,
    type:    Number,
    default: 92,
    range:   { min: 0, max: 100, step: 1 },
    onChange: () => SDActionHUD.refresh()
  });

  game.settings.register("sd", "actionHudDefaultTransparent", {
    name:    "SD.ActionHud.Settings.DefaultTransparent",
    hint:    "SD.ActionHud.Settings.DefaultTransparentHint",
    scope:   "client",
    config:  true,
    type:    Boolean,
    default: false,
    onChange: () => SDActionHUD.refresh()
  });

  game.settings.register("sd", "actionHudShowFrames", {
    name:    "SD.ActionHud.Settings.ShowFrames",
    hint:    "SD.ActionHud.Settings.ShowFramesHint",
    scope:   "client",
    config:  true,
    type:    Boolean,
    default: false,
    onChange: () => SDActionHUD.refresh()
  });

  game.settings.register("sd", "actionHudWidgetShadow", {
    name:    "SD.ActionHud.Settings.WidgetShadow",
    hint:    "SD.ActionHud.Settings.WidgetShadowHint",
    scope:   "client",
    config:  true,
    type:    Boolean,
    default: true,
    onChange: () => SDActionHUD.refresh()
  });

  game.keybindings.register("sd", "toggleActionHud", {
    name:    "SD.ActionHud.Settings.ToggleKey",
    hint:    "SD.ActionHud.Settings.ToggleKeyHint",
    editable: [{ key: "KeyH", modifiers: ["Control"] }],
    onDown:  () => { SDActionHUD.toggleVisible(); return true; },
    restricted: false,
    precedence: foundry.CONST?.KEYBINDING_PRECEDENCE?.NORMAL ?? 0
  });

  game.settings.registerMenu("sd", "actionHudConfigMenu", {
    name:   "SD.ActionHud.Settings.ConfigMenu",
    label:  "SD.ActionHud.Settings.ConfigMenuLabel",
    hint:   "SD.ActionHud.Settings.ConfigMenuHint",
    icon:   "fa-solid fa-bullseye",
    type:   SDActionHUDConfig,
    restricted: true
  });
}

export function mountActionHudHooks() {
  Hooks.on("controlToken", (token, controlled) => {
    try {
      if (controlled) SDActionHUD.showFor(token);
      else SDActionHUD.hideForToken(token);
    } catch(e) { console.warn("SD | actionHud controlToken error:", e); }
  });

  Hooks.on("updateActor", (actor) => {
    try { SDActionHUD.onActorUpdate(actor); } catch(e) {}
  });
  Hooks.on("updateItem", (item) => {
    try { SDActionHUD.onActorUpdate(item.actor); } catch(e) {}
  });
  Hooks.on("createItem", (item) => {
    try { SDActionHUD.onActorUpdate(item.actor); } catch(e) {}
  });
  Hooks.on("deleteItem", (item) => {
    try { SDActionHUD.onActorUpdate(item.actor); } catch(e) {}
  });

  for (const ev of ["createActiveEffect", "updateActiveEffect", "deleteActiveEffect"]) {
    Hooks.on(ev, (effect) => {
      try {
        const a = effect.parent instanceof Actor ? effect.parent : effect.parent?.actor;
        SDActionHUD.onActorUpdate(a);
      } catch(e) {}
    });
  }
}

function collectActorWidgets(actor) {
  const out = [];
  const tabs = actor?.system?.customTabs ?? [];
  const walk = (widgets) => {
    if (!Array.isArray(widgets)) return;
    for (const w of widgets) {
      if (!w) continue;
      out.push(w);
      if (w.type === "vsection" && Array.isArray(w.widgets)) walk(w.widgets);
    }
  };
  for (const t of tabs) {
    for (const r of (t.rows ?? [])) walk(r.widgets);
  }
  return out;
}

function findActorWidgetByKey(actor, key) {
  if (!key) return null;
  const all = collectActorWidgets(actor);
  return all.find(w => (w.widgetKey ?? "").trim() === key.trim()) ?? null;
}

function wireHudWidget(cell, widgetDef, actor) {
  const _readPath = (path) => {
    if (!path) return undefined;
    const HF = "system.hiddenFields.";
    if (path.startsWith(HF)) return actor?.system?.hiddenFields?.[path.slice(HF.length)];
    return foundry.utils.getProperty(actor, path);
  };

  cell.querySelectorAll("input[data-path], input[name]").forEach(inp => {
    inp.addEventListener("change", async () => {
      const path = inp.dataset.path || inp.getAttribute("name");
      if (!path || path.startsWith("__")) return;
      let v;
      if (inp.type === "checkbox") v = inp.checked;
      else if (inp.type === "number") v = Number(inp.value);
      else v = inp.value;
      try { await actor.update({ [path]: v }); } catch(e) {}
    });
  });

  cell.querySelectorAll("select[data-path], select[name]").forEach(sel => {
    sel.addEventListener("change", async () => {
      const path = sel.dataset.path || sel.getAttribute("name");
      if (!path) return;
      try { await actor.update({ [path]: sel.value }); } catch(e) {}
    });
  });

  cell.querySelectorAll("textarea[data-path], textarea[name]").forEach(ta => {
    ta.addEventListener("change", async () => {
      const path = ta.dataset.path || ta.getAttribute("name");
      if (!path) return;
      try { await actor.update({ [path]: ta.value }); } catch(e) {}
    });
  });

  cell.querySelectorAll("[data-action='widgetSelectPill']").forEach(btn => {
    btn.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      const path = btn.dataset.path;
      const value = btn.dataset.value ?? "";
      if (!path) return;
      try { await actor.update({ [path]: value }); } catch(e) {}
    });
  });

  cell.querySelectorAll("[data-step]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const step = parseFloat(btn.dataset.step);
      const path = btn.dataset.path;
      if (!path || !Number.isFinite(step)) return;
      const cur = Number(_readPath(path) ?? 0);
      const dsMin = btn.dataset.min;
      const dsMax = btn.dataset.max;
      const min = dsMin !== undefined && dsMin !== "" ? parseFloat(dsMin) : -Infinity;
      const max = dsMax !== undefined && dsMax !== "" ? parseFloat(dsMax) :  Infinity;
      try { await actor.update({ [path]: Math.clamp(cur + step, min, max) }); } catch(e) {}
    });
  });

  cell.querySelectorAll("[data-action='widgetNumStep']").forEach(btn => {
    btn.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      const step = parseFloat(btn.dataset.step);
      const path = btn.dataset.path;
      if (!path || !Number.isFinite(step)) return;
      const cur = Number(_readPath(path) ?? 0);
      const dsMin = btn.dataset.min;
      const dsMax = btn.dataset.max;
      const min = dsMin !== undefined && dsMin !== "" ? parseFloat(dsMin) : -Infinity;
      const max = dsMax !== undefined && dsMax !== "" ? parseFloat(dsMax) :  Infinity;
      try { await actor.update({ [path]: Math.clamp(cur + step, min, max) }); } catch(e) {}
    });
  });

  cell.querySelectorAll(".sd-tracker-pip[data-path]").forEach(pip => {
    pip.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      const path  = pip.dataset.path;
      const index = Number(pip.dataset.index);
      const max   = Number(pip.dataset.max ?? 0) || 0;
      if (!path || !Number.isFinite(index)) return;
      const cur = Number(_readPath(path)) || 0;
      const next = cur > index ? index : index + 1;
      try { await actor.update({ [path]: Math.min(max, Math.max(0, next)) }); } catch(e) {}
    });
  });

  cell.querySelectorAll(".sd-tracker-reset[data-path]").forEach(btn => {
    btn.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      try { await actor.update({ [btn.dataset.path]: 0 }); } catch(e) {}
    });
  });

  cell.querySelectorAll(".sd-clock-segment[data-path]").forEach(seg => {
    seg.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      const path  = seg.dataset.path;
      const index = Number(seg.dataset.index);
      const segs  = Number(seg.dataset.segs ?? 0) || 0;
      if (!path || !Number.isFinite(index)) return;
      const cur = Number(_readPath(path)) || 0;
      const next = cur > index ? index : index + 1;
      try { await actor.update({ [path]: Math.min(segs, Math.max(0, next)) }); } catch(e) {}
    });
  });

  cell.querySelectorAll(".sd-clock-reset[data-path]").forEach(btn => {
    btn.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      try { await actor.update({ [btn.dataset.path]: 0 }); } catch(e) {}
    });
  });

  cell.querySelectorAll("[data-action='itemUse']").forEach(btn => {
    btn.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      const item = actor.items?.get(btn.dataset.itemId);
      if (item) await item.use({});
    });
  });
  cell.querySelectorAll("[data-action='itemEquip']").forEach(btn => {
    btn.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      const item = actor.items?.get(btn.dataset.itemId);
      if (!item || item.type !== "inventory") return;
      if (!item.system?.equippable) {
        ui.notifications?.warn(`"${item.name}" is not marked Equippable.`);
        return;
      }
      const next = !item.system.equipped;
      if (next && typeof item.canEquip === "function") {
        const { ok, reason } = await item.canEquip();
        if (!ok) { ui.notifications?.warn(reason ?? "Cannot equip."); return; }
      }
      try { await item.update({ "system.equipped": next }); } catch(e) {}
    });
  });
  cell.querySelectorAll("[data-action='itemEdit']").forEach(btn => {
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const item = actor.items?.get(btn.dataset.itemId);
      if (item) item.sheet.render(true);
    });
  });
  cell.querySelectorAll("[data-action='itemDelete']").forEach(btn => {
    btn.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      const item = actor.items?.get(btn.dataset.itemId);
      if (!item) return;
      const ok = await foundry.applications.api.DialogV2.confirm({
        window: { title: "Delete Item" },
        content: `<p>Delete <strong>${item.name}</strong>?</p>`
      });
      if (ok) await item.delete();
    });
  });

  cell.querySelectorAll("[data-action='slotItemUse']").forEach(btn => {
    btn.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      const slotId = btn.dataset.slotId;
      const idx    = parseInt(btn.dataset.slotIndex ?? "0");
      const { SlotManager } = await import("../data/item-slots.mjs");
      const contents = SlotManager.getContents(actor, slotId);
      const itemData = contents[idx];
      if (!itemData) return;
      let item = actor?.items?.get(itemData._id) ?? null;
      if (!item) item = actor?.items?.find(i => i.name === itemData.name) ?? null;
      if (!item && itemData._sourceUuid) {
        try { item = await fromUuid(itemData._sourceUuid); } catch {}
      }
      let isSnapshot = false;
      if (!item) {
        try {
          const ItemCls = foundry.utils.getDocumentClass("Item");
          item = new ItemCls(itemData, { parent: null });
          isSnapshot = true;
        } catch(e) { console.warn("SD HUD | slotItemUse: could not build temp item:", e); }
      }
      if (item && (isSnapshot || itemData._sourceUuid)) {
        const _snapSlotId = slotId;
        const _snapIdx    = idx;
        item.update = async function(changes) {
          const expanded = foundry.utils.expandObject(changes);
          if (this.system && expanded.system) {
            foundry.utils.mergeObject(this.system, expanded.system,
              { insertKeys: true, insertValues: true, overwrite: true });
          }
          const currentSnap = foundry.utils.deepClone(
            SlotManager.getContents(actor, _snapSlotId)[_snapIdx] ?? {}
          );
          foundry.utils.mergeObject(currentSnap, expanded,
            { insertKeys: true, insertValues: true, overwrite: true });
          const fresh = [...SlotManager.getContents(actor, _snapSlotId)];
          fresh[_snapIdx] = currentSnap;
          await actor.update({
            [`system.slotContents.${_snapSlotId}.contents`]: fresh,
            [`system.slotContents.${_snapSlotId}.count`]:    fresh.length,
          });
          return this;
        };
      }
      if (item) await item.use({});
    });
  });

  cell.querySelectorAll("[data-action='slotItemEdit']").forEach(btn => {
    btn.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      const itemId   = btn.dataset.itemId;
      const itemUuid = btn.dataset.itemUuid;
      let item = itemId ? actor?.items?.get(itemId) : null;
      if (!item && itemUuid) {
        try { item = await fromUuid(itemUuid); } catch {}
      }
      if (item) item.sheet.render(true);
    });
  });

  cell.querySelectorAll("[data-sd-slot-remove]").forEach(btn => {
    btn.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
      const { SlotManager } = await import("../data/item-slots.mjs");
      const slotId = btn.dataset.sdSlotRemove;
      const idx    = parseInt(btn.dataset.sdSlotIdx ?? "0");
      try { await SlotManager.removeFromSlot(actor, slotId, idx); }
      catch(e) { console.warn("SD HUD | slot remove failed:", e); }
    });
  });

  cell.querySelectorAll("[data-action='effectToggle']").forEach(btn => {
    btn.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      const ef = actor.effects?.get(btn.dataset.effectId);
      if (ef) await ef.update({ disabled: !ef.disabled });
    });
  });
  cell.querySelectorAll("[data-action='effectEdit']").forEach(btn => {
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const ef = actor.effects?.get(btn.dataset.effectId);
      if (ef) ef.sheet.render(true);
    });
  });
  cell.querySelectorAll("[data-action='effectDelete']").forEach(btn => {
    btn.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      const ef = actor.effects?.get(btn.dataset.effectId);
      if (!ef) return;
      const ok = await foundry.applications.api.DialogV2.confirm({
        window: { title: "Delete Effect" },
        content: `<p>Delete <strong>${ef.name}</strong>?</p>`
      });
      if (ok) await ef.delete();
    });
  });

  cell.querySelectorAll("details.sd-hud-popover").forEach(det => {
    const body = det.querySelector(".sd-hud-pop-body");
    if (!body) return;
    const placeholder = document.createComment("sd-hud-pop-slot");
    const positionPortal = () => {
      const summary = det.querySelector("summary");
      const sRect = summary?.getBoundingClientRect();
      if (!sRect) return;
      const bodyHeight = Math.min(body.scrollHeight + 8, window.innerHeight * 0.6);
      const spaceBelow = window.innerHeight - sRect.bottom;
      const spaceAbove = sRect.top;
      body.style.left = Math.max(4, Math.min(window.innerWidth - 364, sRect.left)) + "px";
      body.style.minWidth = Math.max(sRect.width, 220) + "px";
      if (spaceBelow >= bodyHeight || spaceBelow >= spaceAbove) {
        body.style.top = (sRect.bottom + 4) + "px";
        body.style.bottom = "";
      } else {
        body.style.top = "";
        body.style.bottom = (window.innerHeight - sRect.top + 4) + "px";
      }
    };
    const openPortal = () => {
      if (body.classList.contains("sd-hud-pop-portal")) return;

      if (body.parentNode) {
        body.parentNode.insertBefore(placeholder, body);
      }
      document.body.appendChild(body);
      body.classList.add("sd-hud-pop-portal");
      positionPortal();
    };
    const closePortal = () => {
      body.classList.remove("sd-hud-pop-portal");
      body.style.cssText = "";
      if (placeholder.parentNode) {
        placeholder.parentNode.insertBefore(body, placeholder);
        placeholder.remove();
      } else {
        det.appendChild(body);
      }
    };
    det.addEventListener("toggle", () => {
      if (!det.open) {
        closePortal();
        return;
      }

      document.querySelectorAll("#sd-action-hud details.sd-hud-popover[open]").forEach(other => {
        if (other !== det) other.open = false;
      });
      openPortal();
    });

    window.addEventListener("resize", () => { if (det.open) positionPortal(); });

    document.addEventListener("mousedown", (e) => {
      if (!det.open) return;
      if (det.contains(e.target) || body.contains(e.target)) return;
      det.open = false;
    });
  });

  cell.querySelectorAll("[data-action='abilityCast']").forEach(btn => {
    btn.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      const item = actor.items?.get(btn.dataset.itemId);
      if (!item) return;
      const hf       = item.system?.hiddenFields ?? {};
      const cost     = Number(hf.cost ?? 0) || 0;
      const pathUses = String(hf.pathUses ?? "").trim();
      if (cost > 0 && pathUses) {
        let valuePath = pathUses;
        const atPath = foundry.utils.getProperty(actor, pathUses);
        if (atPath && typeof atPath === "object" && "value" in atPath) {
          valuePath = pathUses + ".value";
        }
        const cur = Number(foundry.utils.getProperty(actor, valuePath) ?? 0);
        if (cur < cost) {
          ui.notifications.warn(`Not enough resource to use ${item.name} (needs ${cost}, have ${cur} at ${pathUses}).`);
          return;
        }
        try { await actor.update({ [valuePath]: cur - cost }); } catch(e) {}
      }
      await item.use({});
    });
  });
  cell.querySelectorAll("[data-action='abilityEdit']").forEach(btn => {
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const item = actor.items?.get(btn.dataset.itemId);
      if (item) item.sheet.render(true);
    });
  });
  cell.querySelectorAll("[data-action='abilityDelete']").forEach(btn => {
    btn.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      const item = actor.items?.get(btn.dataset.itemId);
      if (item) await item.delete();
    });
  });

  cell.querySelectorAll("[data-toggle]").forEach(tog => {
    tog.addEventListener("click", async () => {
      try { await actor.update({ [tog.dataset.toggle]: tog.dataset.on !== "true" }); } catch(e) {}
    });
  });

  cell.querySelectorAll("[data-roll]").forEach(el => {
    el.addEventListener("click", async () => {
      let formula = el.dataset.roll;
      if (!formula || formula.trim().startsWith("[")) return;
      try { formula = FormulaEngine.resolveForRoll(formula, actor); } catch(e) {}
      try {
        const roll = new Roll(formula, actor.getRollData?.() ?? {});
        await roll.evaluate();
        await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: el.dataset.flavor });
      } catch(e) { console.error("SD HUD | data-roll error:", e); }
    });
  });

  const _runActionGraph = async (raw, label) => {
    try {
      const actions = JSON.parse(raw.trim());
      const fakeBtnDef = { label: label ?? "" };
      const runtime = {};
      for (const a of actions) {
        await ButtonExecutor._runAction(a, { system: {}, actor }, actor, fakeBtnDef, runtime);
      }
    } catch(e) { console.error("SD HUD | action graph error:", e); }
  };

  cell.querySelectorAll("[data-action='widgetButton']").forEach(btn => {
    btn.addEventListener("click", async () => {
      const raw = btn.dataset.formulaRaw || btn.dataset.formula;
      if (!raw) {
        if (btn.dataset.flavor) {
          ChatMessage.create({ content: btn.dataset.flavor, speaker: ChatMessage.getSpeaker({ actor }) });
        }
        return;
      }
      const trimmed = raw.trim();
      if (trimmed.startsWith("[")) return _runActionGraph(raw, btn.dataset.flavor);
      try {
        const formula = FormulaEngine.resolveForRoll(raw, actor);
        const roll = new Roll(formula, actor.getRollData?.() ?? {});
        await roll.evaluate();
        await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: btn.dataset.flavor });
      } catch(e) { console.error("SD HUD | widgetButton error:", e); }
    });
  });

  cell.querySelectorAll("[data-action='widgetRoll']").forEach(btn => {
    btn.addEventListener("click", async () => {
      let formula = btn.dataset.formulaRaw || btn.dataset.formula || "1d20";
      if (formula.trim().startsWith("[")) return _runActionGraph(formula, btn.dataset.flavor);
      try { formula = FormulaEngine.resolveForRoll(formula, actor); } catch(e) {}
      try {
        const roll = new Roll(formula, actor.getRollData?.() ?? {});
        await roll.evaluate();
        await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: btn.dataset.flavor });
      } catch(e) { console.error("SD HUD | widgetRoll error:", e); }
    });
  });

  cell.querySelectorAll("[data-action='widgetToggle']").forEach(btn => {
    btn.addEventListener("click", async () => {
      try { await actor.update({ [btn.dataset.path]: !_readPath(btn.dataset.path) }); } catch(e) {}
    });
  });

  cell.querySelectorAll("[data-action='attrModClick']").forEach(btn => {
    btn.addEventListener("click", async () => {
      const onClickFml = btn.dataset.attrOnclick;
      if (onClickFml && onClickFml.trim().startsWith("[")) {
        return _runActionGraph(onClickFml, btn.dataset.flavor);
      }
      let formula = btn.dataset.attrRoll || "1d20";
      try { formula = FormulaEngine.resolveForRoll(formula, actor); } catch(e) {}
      try {
        const roll = new Roll(formula, actor.getRollData?.() ?? {});
        await roll.evaluate();
        await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: btn.dataset.flavor });
      } catch(e) { console.error("SD HUD | attrModClick error:", e); }
    });
  });
}

export class SDActionHUD {

  static _instance = null;

  static _actor = null;

  static _builderMode = false;

  static _userHidden = false;

  static _ensureRoot() {
    let root = document.getElementById("sd-action-hud");
    if (root) return root;
    root = document.createElement("div");
    root.id = "sd-action-hud";
    root.classList.add("sd-action-hud", "sd", "sheet", "character");
    root.style.display = "none";
    root.innerHTML = `
      <div class="sd-action-hud-bar">
        <span class="sd-action-hud-title"><i class="fas fa-bullseye"></i> <span class="sd-actor-name"></span></span>
        <span class="sd-action-hud-spacer"></span>
        <button type="button" class="sd-action-hud-edit" title="Toggle edit mode (GM)" data-action="editToggle"><i class="fas fa-pencil"></i></button>
        <button type="button" class="sd-action-hud-list" title="Open layout list (GM)" data-action="editList"><i class="fas fa-list"></i></button>
        <button type="button" class="sd-action-hud-close" title="Hide HUD" data-action="close"><i class="fas fa-xmark"></i></button>
      </div>
      <div class="sd-action-hud-canvas"></div>
      <button type="button" class="sd-action-hud-add" title="Add widget to HUD" data-action="addWidget"><i class="fas fa-plus"></i></button>`;
    document.body.appendChild(root);

    const bar = root.querySelector(".sd-action-hud-bar");
    let drag = null;
    bar.addEventListener("pointerdown", (ev) => {
      if (ev.target.closest("button")) return;
      const r = root.getBoundingClientRect();
      drag = { dx: ev.clientX - r.left, dy: ev.clientY - r.top };
      bar.setPointerCapture(ev.pointerId);
    });
    bar.addEventListener("pointermove", (ev) => {
      if (!drag) return;
      const x = ev.clientX - drag.dx;
      const y = ev.clientY - drag.dy;
      root.style.left = `${x}px`;
      root.style.top  = `${y}px`;
      root.style.right = "auto";
      root.style.bottom = "auto";
    });
    const endDrag = async () => {
      if (!drag) return;
      drag = null;
      const r = root.getBoundingClientRect();
      try { await game.settings.set("sd", "actionHudPos", { x: r.left, y: r.top }); } catch(e) {}
    };
    bar.addEventListener("pointerup",   endDrag);
    bar.addEventListener("pointercancel", endDrag);

    root.querySelector("[data-action='close']")?.addEventListener("click", () => {

      SDActionHUD._userHidden = true;
      root.style.display = "none";
    });

    const editBtn = root.querySelector("[data-action='editToggle']");
    if (editBtn) {
      if (!game.user.isGM) editBtn.style.display = "none";
      editBtn.addEventListener("click", () => {
        SDActionHUD._builderMode = !SDActionHUD._builderMode;
        SDActionHUD._render();
      });
    }

    const listBtn = root.querySelector("[data-action='editList']");
    if (listBtn) {
      if (!game.user.isGM) listBtn.style.display = "none";
      listBtn.addEventListener("click", () => new SDActionHUDConfig().render(true));
    }

    const addBtn = root.querySelector("[data-action='addWidget']");
    if (addBtn) {
      if (!game.user.isGM) addBtn.style.display = "none";
      addBtn.addEventListener("click", () => SDActionHUD._onAddWidgetClicked());
    }

    return root;
  }

  static _userMaySeeHud(actor) {
    if (!actor) return false;
    if (game.user.isGM) return true;
    return actor.testUserPermission(game.user, "OWNER");
  }

  static showFor(token) {
    if (!token?.actor) return;
    if (!game.settings.get("sd", "actionHudEnabled")) return;
    if (!this._userMaySeeHud(token.actor)) return;

    this._actor = token.actor;

    this._userHidden = false;
    this._render();
  }

  static toggleVisible() {
    if (!game.settings.get("sd", "actionHudEnabled")) {

      try { game.settings.set("sd", "actionHudEnabled", true); } catch(e) {}
      this._userHidden = false;
    } else {
      this._userHidden = !this._userHidden;
    }
    if (this._userHidden) {
      const root = document.getElementById("sd-action-hud");
      if (root) root.style.display = "none";
      return;
    }

    const ctrl = canvas?.tokens?.controlled ?? [];
    if (ctrl.length && this._userMaySeeHud(ctrl[0].actor)) {
      this._actor = ctrl[0].actor;
      this._render();
      return;
    }
    if (this._actor && this._userMaySeeHud(this._actor)) {
      this._render();
    } else {
      ui.notifications.info("Select a token you own to show the HUD.");
    }
  }

  static hideForToken(token) {
    if (this._actor && token?.actor === this._actor) {
      const others = canvas?.tokens?.controlled ?? [];

      const next = others.find(t => t.actor !== this._actor);
      if (next) {
        this.showFor(next);
      } else {
        this._actor = null;
        const root = document.getElementById("sd-action-hud");
        if (root) root.style.display = "none";
      }
    }
  }

  static onActorUpdate(actor) {
    if (!actor) return;
    if (this._actor && this._actor === actor) this._render();
  }

  static refresh() {
    if (!this._actor) {
      const root = document.getElementById("sd-action-hud");
      if (root) root.style.display = "none";
      return;
    }
    if (!game.settings.get("sd", "actionHudEnabled") || this._userHidden) {
      const root = document.getElementById("sd-action-hud");
      if (root) root.style.display = "none";
      return;
    }
    this._render();
  }

  static _render() {
    const actor = this._actor;
    if (!actor) return;
    if (this._userHidden) return;

    document.querySelectorAll("body > .sd-hud-pop-portal").forEach(el => el.remove());

    const root = this._ensureRoot();
    root.style.display = "flex";

    const bgOp = Math.min(Math.max(Number(game.settings.get("sd", "actionHudBgOpacity") ?? 92), 0), 100) / 100;
    root.style.setProperty("--sd-hud-bar-bg-alpha", bgOp);
    const defaultTransparent = !!game.settings.get("sd", "actionHudDefaultTransparent");
    root.classList.toggle("sd-hud-default-transparent", defaultTransparent);
    const showFrames = !!game.settings.get("sd", "actionHudShowFrames");
    root.classList.toggle("sd-hud-no-frames", !showFrames);
    const widgetShadow = !!game.settings.get("sd", "actionHudWidgetShadow");
    root.classList.toggle("sd-hud-shadow", widgetShadow);

    const scale = Math.min(Math.max(Number(game.settings.get("sd", "actionHudScale") ?? 100), 50), 200) / 100;
    root.style.setProperty("--sd-hud-scale", scale);

    const pos = game.settings.get("sd", "actionHudPos") ?? {};
    if (Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
      root.style.left = `${pos.x}px`;
      root.style.top  = `${pos.y}px`;
      root.style.right = "auto";
      root.style.bottom = "auto";
    } else {

      root.style.left = "50%";
      root.style.bottom = "120px";
      root.style.top = "auto";
      root.style.transform = "translateX(-50%)";
    }

    const nameEl = root.querySelector(".sd-actor-name");
    if (nameEl) nameEl.textContent = actor.name ?? "";

    const canvasEl = root.querySelector(".sd-action-hud-canvas");
    if (!canvasEl) return;
    canvasEl.innerHTML = "";

    const innerEl = document.createElement("div");
    innerEl.className = "sd-action-hud-canvas-inner";
    canvasEl.appendChild(innerEl);

    const layout = game.settings.get("sd", "actionHud") ?? {};
    const typeKey = actor.type === "npc" ? "npc" : "character";
    const entries = Array.isArray(layout?.[typeKey]?.entries) ? layout[typeKey].entries : [];

    let maxX = 0, maxY = 0;

    for (const entry of entries) {
      try {
        const widgetDef = this._resolveWidget(entry, actor);
        if (!widgetDef) continue;

        const cell = document.createElement("div");
        cell.classList.add("sd-action-hud-widget");
        const x = Number.isFinite(entry.x) ? entry.x : 0;
        const y = Number.isFinite(entry.y) ? entry.y : 0;
        cell.style.position = "absolute";
        cell.style.left = `${x}px`;
        cell.style.top  = `${y}px`;
        if (Number.isFinite(entry.w) && entry.w > 0) cell.style.width  = `${entry.w}px`;
        if (Number.isFinite(entry.h) && entry.h > 0) cell.style.minHeight = `${entry.h}px`;

        const explicitTransparent = entry.transparent === true;
        const explicitOpaque      = entry.transparent === false;
        const isTransparent = explicitTransparent || (defaultTransparent && !explicitOpaque);
        if (isTransparent) cell.dataset.transparent = "true";

        const COMPACTABLE = ["inventory", "effects", "spellbook", "slot"];
        let renderDef = widgetDef;
        if (COMPACTABLE.includes(widgetDef.type)) {
          if (entry.compact !== false) {
            renderDef = { ...widgetDef, compact: true };
          }
        }

        cell.innerHTML = WidgetRenderer.render(renderDef, actor, false) ?? "";

        wireHudWidget(cell, renderDef, actor);

        innerEl.appendChild(cell);

        const cellW = (Number.isFinite(entry.w) && entry.w > 0) ? entry.w : (cell.offsetWidth || 100);
        const cellH = (Number.isFinite(entry.h) && entry.h > 0) ? entry.h : (cell.offsetHeight || 60);
        if (x + cellW > maxX) maxX = x + cellW;
        if (y + cellH > maxY) maxY = y + cellH;
      } catch(e) {
        console.warn("SD HUD | render entry failed:", entry, e);
      }
    }

    const _maxX = Math.max(maxX, 200);
    const _maxY = Math.max(maxY,  80);
    innerEl.style.width   = `${_maxX}px`;
    innerEl.style.height  = `${_maxY}px`;
    canvasEl.style.width  = `${Math.ceil(_maxX * scale)}px`;
    canvasEl.style.height = `${Math.ceil(_maxY * scale)}px`;

    root.classList.toggle("sd-hud-builder", !!(this._builderMode && game.user.isGM));
    if (this._builderMode && game.user.isGM) {
      this._wireBuilderMode(root, canvasEl, entries);
    }
  }

  static _resolveWidget(entry, actor) {
    if (entry.inlineWidget) return entry.inlineWidget;
    if (entry.widgetKey) return findActorWidgetByKey(actor, entry.widgetKey);
    return null;
  }

  static async _mutateEntries(mutator) {
    if (!this._actor) return;
    const layout = foundry.utils.deepClone(game.settings.get("sd", "actionHud") ?? {});
    const typeKey = this._actor.type === "npc" ? "npc" : "character";
    if (!layout[typeKey]) layout[typeKey] = { entries: [] };
    if (!Array.isArray(layout[typeKey].entries)) layout[typeKey].entries = [];
    const entries = layout[typeKey].entries;
    await mutator(entries);
    await game.settings.set("sd", "actionHud", layout);
    this._render();
  }

  static _snap(v, noSnap = false) {
    if (noSnap) return Math.round(v);
    return Math.round(v / 8) * 8;
  }

  static _wireBuilderMode(root, canvasEl, entries) {
    const cells = canvasEl.querySelectorAll(".sd-action-hud-widget");
    cells.forEach((cell, i) => {
      const entry = entries[i];
      if (!entry) return;

      let overlay = cell.querySelector(".sd-hud-cell-overlay");
      if (!overlay) {
        overlay = document.createElement("div");
        overlay.className = "sd-hud-cell-overlay";
        overlay.innerHTML = `
          <div class="sd-hud-cell-bar">
            <span class="sd-hud-cell-grab" title="Drag"><i class="fas fa-up-down-left-right"></i></span>
            <span class="sd-hud-cell-label"></span>
            <button type="button" data-act="transparent" title="Toggle transparent background"><i class="fas fa-droplet-slash"></i></button>
            <button type="button" data-act="edit" title="Edit"><i class="fas fa-gear"></i></button>
            <button type="button" data-act="delete" title="Remove"><i class="fas fa-trash"></i></button>
          </div>
          <div class="sd-hud-cell-resize" title="Resize"></div>`;
        cell.appendChild(overlay);
      }

      const lbl = overlay.querySelector(".sd-hud-cell-label");
      if (lbl) {
        lbl.textContent = entry.widgetKey
          ? `→ ${entry.widgetKey}`
          : (entry.inlineWidget?.label ?? entry.inlineWidget?.type ?? "inline");
      }

      const grab = overlay.querySelector(".sd-hud-cell-grab");
      let drag = null;
      const _readScale = () => {
        const v = parseFloat(getComputedStyle(canvasEl.closest("#sd-action-hud") ?? canvasEl).getPropertyValue("--sd-hud-scale"));
        return (Number.isFinite(v) && v > 0) ? v : 1;
      };
      const startDrag = (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const r = cell.getBoundingClientRect();
        const cr = canvasEl.getBoundingClientRect();
        const s  = _readScale();
        drag = {
          dx: ev.clientX - r.left,
          dy: ev.clientY - r.top,
          baseX: cr.left,
          baseY: cr.top,
          scale: s,
          shift: ev.shiftKey
        };
        grab.setPointerCapture(ev.pointerId);
      };
      const moveDrag = (ev) => {
        if (!drag) return;
        ev.preventDefault();

        const s = drag.scale || 1;
        const x = SDActionHUD._snap((ev.clientX - drag.dx - drag.baseX) / s, ev.shiftKey);
        const y = SDActionHUD._snap((ev.clientY - drag.dy - drag.baseY) / s, ev.shiftKey);
        cell.style.left = `${Math.max(0, x)}px`;
        cell.style.top  = `${Math.max(0, y)}px`;
      };
      const endDrag = async (ev) => {
        if (!drag) return;
        drag = null;
        try {
          const x = parseInt(cell.style.left || "0", 10);
          const y = parseInt(cell.style.top  || "0", 10);
          const idx = i;
          await SDActionHUD._mutateEntries((arr) => {
            if (arr[idx]) { arr[idx].x = Math.max(0, x); arr[idx].y = Math.max(0, y); }
          });
        } catch(e) { console.warn("SD HUD | drag persist failed:", e); }
      };
      grab.addEventListener("pointerdown", startDrag);
      grab.addEventListener("pointermove", moveDrag);
      grab.addEventListener("pointerup", endDrag);
      grab.addEventListener("pointercancel", endDrag);

      const handle = overlay.querySelector(".sd-hud-cell-resize");
      let rsz = null;
      handle.addEventListener("pointerdown", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const r = cell.getBoundingClientRect();
        const s = _readScale();
        rsz = {
          startX: ev.clientX,
          startY: ev.clientY,

          startW: r.width  / s,
          startH: r.height / s,
          scale: s
        };
        handle.setPointerCapture(ev.pointerId);
      });
      handle.addEventListener("pointermove", (ev) => {
        if (!rsz) return;
        ev.preventDefault();
        const s = rsz.scale || 1;
        const w = SDActionHUD._snap(rsz.startW + (ev.clientX - rsz.startX) / s, ev.shiftKey);
        const h = SDActionHUD._snap(rsz.startH + (ev.clientY - rsz.startY) / s, ev.shiftKey);
        cell.style.width = `${Math.max(40, w)}px`;
        cell.style.minHeight = `${Math.max(24, h)}px`;
      });
      const endResize = async () => {
        if (!rsz) return;
        rsz = null;
        try {
          const w = Math.max(40, parseInt(cell.style.width || "0", 10));
          const h = Math.max(24, parseInt(cell.style.minHeight || "0", 10));
          const idx = i;
          await SDActionHUD._mutateEntries((arr) => {
            if (arr[idx]) { arr[idx].w = w; arr[idx].h = h; }
          });
        } catch(e) { console.warn("SD HUD | resize persist failed:", e); }
      };
      handle.addEventListener("pointerup", endResize);
      handle.addEventListener("pointercancel", endResize);

      const transBtn = overlay.querySelector("button[data-act='transparent']");
      if (transBtn) {
        transBtn.classList.toggle("is-on", !!cell.dataset.transparent);
        transBtn.addEventListener("click", async (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          const idx = i;
          await SDActionHUD._mutateEntries((arr) => {
            if (!arr[idx]) return;
            const cur = arr[idx].transparent;

            if (cur === undefined) arr[idx].transparent = true;
            else if (cur === true) arr[idx].transparent = false;
            else delete arr[idx].transparent;
          });
        });
      }

      const editBtn = overlay.querySelector("button[data-act='edit']");
      editBtn?.addEventListener("click", async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        await SDActionHUD._editEntry(i);
      });

      const delBtn = overlay.querySelector("button[data-act='delete']");
      delBtn?.addEventListener("click", async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const ok = await foundry.applications.api.DialogV2.confirm({
          window: { title: "Remove HUD widget?" },
          content: "<p>Remove this widget from the HUD layout?</p>",
          yes: { default: true }
        });
        if (!ok) return;
        const idx = i;
        await SDActionHUD._mutateEntries((arr) => { arr.splice(idx, 1); });
      });
    });
  }

  static async _onAddWidgetClicked() {
    if (!this._actor) return;
    if (!game.user.isGM) return;

    const keysSet = new Set();
    for (const a of (game.actors ?? [])) {
      if (a.type !== this._actor.type) continue;
      for (const w of collectActorWidgets(a)) {
        if (w.widgetKey && String(w.widgetKey).trim()) keysSet.add(String(w.widgetKey).trim());
      }
    }
    const keys = [...keysSet].sort();

    const choice = await new Promise((resolve) => {
      const opts = keys.map(k => `<option value="${k}">${k}</option>`).join("");
      const html = `
        <div style="display:flex;flex-direction:column;gap:8px">
          <p style="font-size:11px;opacity:0.85">Add a widget to the HUD layout. Either reference an existing actor widget by its <strong>Widget Key</strong>, or create an inline widget that lives only on the HUD.</p>
          <fieldset style="display:flex;flex-direction:column;gap:6px;border:1px solid #555;padding:8px">
            <legend>Reference actor widget</legend>
            <label>Widget Key:
              <input type="text" name="refKey" list="hud-add-keys" style="width:100%"/>
            </label>
            <datalist id="hud-add-keys">${opts}</datalist>
            <button type="button" data-pick="ref" class="sd-hud-add-btn">Add as reference</button>
          </fieldset>
          <fieldset style="display:flex;flex-direction:column;gap:6px;border:1px solid #555;padding:8px">
            <legend>Inline widget</legend>
            <p style="font-size:10px;opacity:0.7;margin:0">Picks a type and opens the inline editor for label/path/formula etc.</p>
            <button type="button" data-pick="inline" class="sd-hud-add-btn">Create inline...</button>
          </fieldset>
        </div>`;
      const dlg = new foundry.applications.api.DialogV2({
        window: { title: "Add HUD widget" },
        content: html,
        buttons: [{ action: "cancel", label: "Cancel", default: true }],
        position: { width: 360 }
      });
      dlg.render(true).then(() => {
        const root = dlg.element;
        if (!root) return resolve(null);
        root.querySelectorAll(".sd-hud-add-btn").forEach((btn) => {
          btn.addEventListener("click", (ev) => {
            ev.preventDefault();
            const pick = btn.dataset.pick;
            if (pick === "ref") {
              const inp = root.querySelector("input[name='refKey']");
              const v = String(inp?.value ?? "").trim();
              if (!v) return ui.notifications.warn("Widget Key required.");
              dlg.close();
              resolve({ kind: "ref", widgetKey: v });
            } else if (pick === "inline") {
              dlg.close();
              resolve({ kind: "inline" });
            }
          });
        });
      });
    });

    if (!choice) return;

    if (choice.kind === "ref") {
      await this._mutateEntries((arr) => {
        arr.push({ x: 16, y: 16, widgetKey: choice.widgetKey });
      });
      return;
    }

    if (choice.kind === "inline") {
      const widgetDef = await openInlineWidgetEditor(null);
      if (!widgetDef) return;
      await this._mutateEntries((arr) => {
        arr.push({ x: 16, y: 16, inlineWidget: widgetDef });
      });
    }
  }

  static async _editEntry(idx) {
    if (!this._actor) return;
    const layout = foundry.utils.deepClone(game.settings.get("sd", "actionHud") ?? {});
    const typeKey = this._actor.type === "npc" ? "npc" : "character";
    const arr = layout?.[typeKey]?.entries;
    const entry = Array.isArray(arr) ? arr[idx] : null;
    if (!entry) return;

    if (entry.inlineWidget) {
      const updated = await openInlineWidgetEditor(entry.inlineWidget);
      if (!updated) return;
      await this._mutateEntries((arrCur) => {
        if (arrCur[idx]) arrCur[idx].inlineWidget = updated;
      });
      return;
    }

    const keysSet = new Set();
    for (const a of (game.actors ?? [])) {
      if (a.type !== this._actor.type) continue;
      for (const w of collectActorWidgets(a)) {
        if (w.widgetKey && String(w.widgetKey).trim()) keysSet.add(String(w.widgetKey).trim());
      }
    }
    const keys = [...keysSet].sort();
    const opts = keys.map(k => `<option value="${k}">${k}</option>`).join("");
    const html = `
      <div style="display:flex;flex-direction:column;gap:8px">
        <label>Widget Key:
          <input type="text" name="refKey" list="hud-edit-keys" value="${entry.widgetKey ?? ""}" style="width:100%"/>
        </label>
        <datalist id="hud-edit-keys">${opts}</datalist>
      </div>`;
    const result = await foundry.applications.api.DialogV2.prompt({
      window: { title: "Edit widget reference" },
      content: html,
      ok: {
        label: "Save",
        callback: (event, button, dialog) => {
          const inp = dialog.element.querySelector("input[name='refKey']");
          return String(inp?.value ?? "").trim();
        }
      }
    });
    if (!result) return;
    await this._mutateEntries((arrCur) => { if (arrCur[idx]) arrCur[idx].widgetKey = result; });
  }
}

export class SDActionHUDConfig extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id:      "sd-action-hud-config",
    classes: ["sd", "sd-action-hud-config"],
    window:  {
      title:     "SD.ActionHud.Config.Title",
      icon:      "fa-solid fa-bullseye",
      resizable: true
    },
    position: { width: 720, height: 600 },
    actions:  {
      addEntry:    SDActionHUDConfig._onAddEntry,
      removeEntry: SDActionHUDConfig._onRemoveEntry,
      moveUp:      SDActionHUDConfig._onMoveUp,
      moveDown:    SDActionHUDConfig._onMoveDown,
      switchType:  SDActionHUDConfig._onSwitchType,
      save:        SDActionHUDConfig._onSave
    }
  };

  static PARTS = {
    content: { template: "systems/sd/templates/action-hud/hud-config.hbs", scrollable: [".hud-entries"] }
  };

  _activeType = "character";

  async _prepareContext(options) {
    const base   = await super._prepareContext(options);
    const layout = foundry.utils.deepClone(game.settings.get("sd", "actionHud") ?? {});
    if (!layout.character) layout.character = { entries: [] };
    if (!layout.npc)       layout.npc       = { entries: [] };

    const entries = Array.isArray(layout[this._activeType]?.entries) ? layout[this._activeType].entries : [];

    const keysSet = new Set();
    for (const a of (game.actors ?? [])) {
      if (a.type !== this._activeType) continue;
      for (const w of collectActorWidgets(a)) {
        if (w.widgetKey && String(w.widgetKey).trim()) keysSet.add(String(w.widgetKey).trim());
      }
    }
    const keys = [...keysSet].sort();

    return {
      ...base,
      activeType: this._activeType,
      isCharacter: this._activeType === "character",
      isNpc:       this._activeType === "npc",
      entries: entries.map((e, idx) => ({
        idx,
        x: Number.isFinite(e.x) ? e.x : 0,
        y: Number.isFinite(e.y) ? e.y : 0,
        w: Number.isFinite(e.w) ? e.w : "",
        h: Number.isFinite(e.h) ? e.h : "",
        widgetKey: e.widgetKey ?? "",
        label: e.label ?? "",
        inlineLabel: e.inlineWidget ? `[inline: ${e.inlineWidget.type ?? "?"}]` : ""
      })),
      keys
    };
  }

  _readForm() {
    const form = this.element?.querySelector("form");
    if (!form) return null;
    const FDE = foundry.applications?.ux?.FormDataExtended ?? FormDataExtended;
    return new FDE(form).object;
  }

  _collect() {
    const layout = foundry.utils.deepClone(game.settings.get("sd", "actionHud") ?? {});
    if (!layout.character) layout.character = { entries: [] };
    if (!layout.npc)       layout.npc       = { entries: [] };

    const raw = this._readForm() ?? {};
    const entries = Array.isArray(layout[this._activeType]?.entries) ? layout[this._activeType].entries : [];

    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const xKey = `entry_${i}_x`;
      const yKey = `entry_${i}_y`;
      const wKey = `entry_${i}_w`;
      const hKey = `entry_${i}_h`;
      const kKey = `entry_${i}_widgetKey`;
      const lKey = `entry_${i}_label`;
      if (raw[xKey] !== undefined) e.x = Number(raw[xKey]) || 0;
      if (raw[yKey] !== undefined) e.y = Number(raw[yKey]) || 0;
      if (raw[wKey] !== undefined) {
        const v = String(raw[wKey] ?? "").trim();
        if (v === "") delete e.w; else e.w = Number(v) || undefined;
      }
      if (raw[hKey] !== undefined) {
        const v = String(raw[hKey] ?? "").trim();
        if (v === "") delete e.h; else e.h = Number(v) || undefined;
      }
      if (raw[kKey] !== undefined) e.widgetKey = String(raw[kKey] ?? "").trim();
      if (raw[lKey] !== undefined) e.label = String(raw[lKey] ?? "").trim();
    }

    layout[this._activeType].entries = entries;
    return layout;
  }

  static async _onAddEntry(event, target) {
    const layout = this._collect();
    layout[this._activeType].entries.push({ x: 10, y: 10, widgetKey: "" });
    await game.settings.set("sd", "actionHud", layout);
    this.render();
  }

  static async _onRemoveEntry(event, target) {
    const idx = Number(target.dataset.idx);
    if (!Number.isFinite(idx)) return;
    const layout = this._collect();
    const arr = layout[this._activeType].entries;
    if (idx >= 0 && idx < arr.length) arr.splice(idx, 1);
    await game.settings.set("sd", "actionHud", layout);
    this.render();
  }

  static async _onMoveUp(event, target) {
    const idx = Number(target.dataset.idx);
    if (!Number.isFinite(idx) || idx <= 0) return;
    const layout = this._collect();
    const arr = layout[this._activeType].entries;
    [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
    await game.settings.set("sd", "actionHud", layout);
    this.render();
  }

  static async _onMoveDown(event, target) {
    const idx = Number(target.dataset.idx);
    if (!Number.isFinite(idx)) return;
    const layout = this._collect();
    const arr = layout[this._activeType].entries;
    if (idx < 0 || idx >= arr.length - 1) return;
    [arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]];
    await game.settings.set("sd", "actionHud", layout);
    this.render();
  }

  static async _onSwitchType(event, target) {
    const t = target.dataset.type;
    if (t !== "character" && t !== "npc") return;

    const layout = this._collect();
    await game.settings.set("sd", "actionHud", layout);
    this._activeType = t;
    this.render();
  }

  static async _onSave(event, target) {
    const layout = this._collect();
    await game.settings.set("sd", "actionHud", layout);
    ui.notifications.info(game.i18n.localize("SD.ActionHud.Config.Saved"));
    this.close();
  }
}
