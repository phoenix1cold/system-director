import { WidgetRenderer }  from "../builder/widget-renderer.mjs";
import { WIDGET_VARIANTS } from "../builder/widget-registry.mjs";
import { FormulaEngine }   from "./formula-engine.mjs";
import { ButtonExecutor }  from "./button-executor.mjs";
import { openInlineWidgetEditor } from "./action-hud-inline-editor.mjs";
import { AutoanimationsIntegration } from "../integrations/autoanimations.mjs";

function _sanitizeHudVariant(raw, widgetType) {
  const v = String(raw ?? "").trim().toLowerCase();
  if (!v || v === "default" || v === "__inherit__") return "";
  const list = WIDGET_VARIANTS?.[widgetType];
  if (!Array.isArray(list) || !list.includes(v)) return "";
  return v;
}

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
    default: { x: null, y: null, refW: null, refH: null }
  });

  game.settings.register("sd", "actionHudLocked", {
    name:    "SD Action HUD lock",
    scope:   "client",
    config:  false,
    type:    Boolean,
    default: false,
    onChange: () => SDActionHUD._refreshLockUI()
  });

  game.settings.register("sd", "actionHudSeparateWidgets", {
    name:    "SD.ActionHud.Settings.SeparateWidgets",
    hint:    "SD.ActionHud.Settings.SeparateWidgetsHint",
    scope:   "client",
    config:  true,
    type:    Boolean,
    default: false,
    onChange: () => SDActionHUD.refresh()
  });

  game.settings.register("sd", "actionHudResponsivePosition", {
    name:    "SD.ActionHud.Settings.ResponsivePos",
    hint:    "SD.ActionHud.Settings.ResponsivePosHint",
    scope:   "client",
    config:  true,
    type:    Boolean,
    default: false,
    onChange: () => SDActionHUD.refresh()
  });

  game.settings.register("sd", "actionHudBgOpacity", {
    name:    "SD.ActionHud.Settings.BgOpacity",
    hint:    "SD.ActionHud.Settings.BgOpacityHint",
    scope:   "client",
    config:  true,
    type:    Number,
    default: 0,
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

  game.keybindings.register("sd", "resetActionHud", {
    name:    "SD.ActionHud.Settings.ResetKey",
    hint:    "SD.ActionHud.Settings.ResetKeyHint",
    editable: [{ key: "KeyH", modifiers: ["Control", "Shift"] }],
    onDown:  () => { SDActionHUD.resetPosition(); return true; },
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

  let _sdResizeT = null;
  window.addEventListener("resize", () => {
    clearTimeout(_sdResizeT);
    _sdResizeT = setTimeout(() => {
      try { SDActionHUD.refresh(); } catch(_) {}
    }, 80);
  });
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

  const _fieldForPath = (path) => {
    if (!path) return null;
    return [...cell.querySelectorAll("input, select, textarea")]
      .find(el => (el.dataset.path || el.getAttribute("name")) === path) ?? null;
  };

  const _numberForPath = (path) => {
    const field = _fieldForPath(path);
    const fromField = field ? Number(field.value) : NaN;
    if (Number.isFinite(fromField)) return fromField;
    const fromDoc = Number(_readPath(path));
    return Number.isFinite(fromDoc) ? fromDoc : 0;
  };

  if (cell.dataset.sdAaDelegated !== "1") {
    cell.dataset.sdAaDelegated = "1";
    const _aaSkipActions = new Set([
      "wcfg", "wdup", "wspan", "wdel",
      "itemEdit", "itemDelete", "slotItemEdit",
      "effectEdit", "effectDelete",
      "abilityEdit"
    ]);
    cell.addEventListener("click", (ev) => {
      const widgetEl = ev.target.closest(".widget[data-aa-tag]");
      if (!widgetEl || !cell.contains(widgetEl)) return;
      const actionEl = ev.target.closest(
        "[data-action], [data-roll], [data-step], [data-toggle], [data-attr-roll], [data-attr-onclick]"
      );
      if (!actionEl || !widgetEl.contains(actionEl)) return;
      if (_aaSkipActions.has(actionEl.dataset?.action ?? "")) return;
      const tag = widgetEl.dataset.aaTag;
      if (!tag) return;
      try { AutoanimationsIntegration.playForTag(tag, actor); }
      catch (e) { console.warn("SD HUD | AutoAnimations widget tag trigger failed:", e); }
    }, true);
  }

  cell.querySelectorAll("input[data-path], input[name]").forEach(inp => {
    inp.addEventListener("change", async () => {
      const path = inp.dataset.path || inp.getAttribute("name");
      if (!path || path.startsWith("__")) return;
      let v;
      if (inp.type === "checkbox") v = inp.checked;
      else if (inp.type === "number") {
        const n = Number(inp.value);
        v = Number.isFinite(n) ? n : 0;
      }
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

  cell.querySelectorAll("[data-step], [data-action='widgetNumStep']").forEach(btn => {
    btn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const step = parseFloat(btn.dataset.step);
      const path = btn.dataset.path;
      if (!path || !Number.isFinite(step)) return;
      const cur = _numberForPath(path);
      const dsMin = btn.dataset.min;
      const dsMax = btn.dataset.max;
      const rawMin = dsMin !== undefined && dsMin !== "" ? parseFloat(dsMin) : -Infinity;
      const rawMax = dsMax !== undefined && dsMax !== "" ? parseFloat(dsMax) :  Infinity;
      const min = Number.isFinite(rawMin) ? rawMin : -Infinity;
      const max = Number.isFinite(rawMax) ? rawMax :  Infinity;
      const next = Math.clamp(cur + step, min, max);
      const field = _fieldForPath(path);
      if (field && "value" in field) field.value = String(next);
      try { await actor.update({ [path]: next }); } catch(e) {}
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
      // Slotted item: lives as a snapshot inside a slot, not as a live embedded document.
      const _slotId = btn.dataset.slotId;
      if (_slotId) {
        const { SlotManager } = await import("../data/item-slots.mjs");
        await SlotManager.toggleSlotEquip(actor, _slotId, parseInt(btn.dataset.slotIndex ?? "0"));
        return;
      }
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

  const _resolveEffectForButton = async (btn) => {
    const uuid = btn.dataset.effectUuid;
    if (uuid) {
      const effect = await fromUuid(uuid).catch(() => null);
      if (effect) return effect;
    }
    return actor.effects?.get(btn.dataset.effectId) ?? null;
  };

  cell.querySelectorAll("[data-action='effectToggle']").forEach(btn => {
    btn.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      const ef = await _resolveEffectForButton(btn);
      if (ef) await ef.update({ disabled: !ef.disabled });
    });
  });
  cell.querySelectorAll("[data-action='effectEdit']").forEach(btn => {
    btn.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      const ef = await _resolveEffectForButton(btn);
      if (ef) ef.sheet.render(true);
    });
  });
  cell.querySelectorAll("[data-action='effectDelete']").forEach(btn => {
    btn.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      const ef = await _resolveEffectForButton(btn);
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

      document.querySelectorAll(
        "#sd-action-hud details.sd-hud-popover[open], #sd-action-hud-floating details.sd-hud-popover[open]"
      ).forEach(other => {
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

  const _parseHudPayload = (raw) => {
    if (typeof raw !== "string" || !raw.trim()) return { kind: "noop" };
    const trimmed = raw.trim();
    const looksLikeJson = trimmed.startsWith("[") || trimmed.startsWith("{");
    if (!looksLikeJson) return { kind: "formula", formula: trimmed };
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return { kind: "actions", actions: parsed, macros: null };
      }
      if (parsed && typeof parsed === "object") {
        const macros = parsed._macros ?? null;
        if (parsed._trigger === "onClick") {
          const a = parsed.actions ?? [];
          return { kind: "actions", actions: Array.isArray(a) ? a : [], macros };
        }
        if (parsed._trigger === "multi") {

          const slot = parsed._events?.onClick ?? parsed.onClick ?? [];
          let a = [];
          if (Array.isArray(slot)) a = slot;
          else if (Array.isArray(slot?.actions)) a = slot.actions;
          return { kind: "actions", actions: a, macros };
        }
      }
    } catch(e) {

    }
    return { kind: "formula", formula: trimmed };
  };

  const _runActionGraph = async (actions, label, macros) => {
    if (!Array.isArray(actions) || actions.length === 0) return;
    try {
      const fakeBtnDef = { label: label ?? "", __macros: macros ?? null };
      const runtime = {};
      for (const a of actions) {
        await ButtonExecutor._runAction(a, { system: {}, actor }, actor, fakeBtnDef, runtime);
      }
    } catch(e) { console.error("SD HUD | action graph error:", e); }
  };

  const _runRollFormula = async (formula, flavor) => {
    try {
      const f = FormulaEngine.resolveForRoll(formula, actor);
      const roll = new Roll(f, actor.getRollData?.() ?? {});
      await roll.evaluate();
      await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor });
    } catch(e) { console.error("SD HUD | roll error:", e, "formula:", formula); }
  };

  cell.querySelectorAll("[data-action='widgetButton']").forEach(btn => {
    btn.addEventListener("click", async () => {
      const raw = btn.dataset.formulaRaw || btn.dataset.formula;
      const flavor = btn.dataset.flavor ?? "";
      if (!raw) {
        if (flavor) {
          ChatMessage.create({ content: flavor, speaker: ChatMessage.getSpeaker({ actor }) });
        }
        return;
      }
      const parsed = _parseHudPayload(raw);
      if (parsed.kind === "actions") {
        if (parsed.actions.length === 0 && flavor) {

          ChatMessage.create({ content: flavor, speaker: ChatMessage.getSpeaker({ actor }) });
          return;
        }
        return _runActionGraph(parsed.actions, flavor, parsed.macros);
      }
      if (parsed.kind === "formula") return _runRollFormula(parsed.formula, flavor);
    });
  });

  cell.querySelectorAll("[data-action='widgetRoll']").forEach(btn => {
    btn.addEventListener("click", async () => {
      const raw = btn.dataset.formulaRaw || btn.dataset.formula || "1d20";
      const flavor = btn.dataset.flavor ?? "";
      const parsed = _parseHudPayload(raw);
      if (parsed.kind === "actions") return _runActionGraph(parsed.actions, flavor, parsed.macros);
      if (parsed.kind === "formula") return _runRollFormula(parsed.formula, flavor);
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

  static _inFlightPos = null;

  static _refreshLockUI() {
    let locked = false;
    try { locked = !!game.settings.get("sd", "actionHudLocked"); } catch(_) {}
    const root = document.getElementById("sd-action-hud");
    if (root) {
      root.classList.toggle("sd-action-hud-locked", locked);
      const btn = root.querySelector("[data-action='lockToggle']");
      if (btn) {
        const icon = btn.querySelector("i");
        if (icon) icon.className = locked ? "fas fa-lock" : "fas fa-lock-open";
        btn.title = locked ? "Unlock position (drag to move)" : "Lock position";
        btn.classList.toggle("active", locked);
      }
    }

    const layer = document.getElementById("sd-action-hud-floating");
    if (layer) {
      layer.classList.toggle("sd-action-hud-locked", locked);
      layer.querySelectorAll(".sd-hud-float-bar button[data-act='lockToggle']").forEach(b => {
        const icon = b.querySelector("i");
        if (icon) icon.className = locked ? "fas fa-lock" : "fas fa-lock-open";
        b.classList.toggle("is-on", locked);
        b.title = locked ? "Unlock position (drag to move)" : "Lock position";
      });
    }
  }

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
        <button type="button" class="sd-action-hud-lock" title="Lock position" data-action="lockToggle"><i class="fas fa-lock-open"></i></button>
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
      let locked = false;
      try { locked = !!game.settings.get("sd", "actionHudLocked"); } catch(_) {}
      if (locked) return;
      const r = root.getBoundingClientRect();
      drag = { dx: ev.clientX - r.left, dy: ev.clientY - r.top };
      root.style.transform = "";
      try { bar.setPointerCapture(ev.pointerId); } catch(_) {}
    });
    bar.addEventListener("pointermove", (ev) => {
      if (!drag) return;
      const x = ev.clientX - drag.dx;
      const y = ev.clientY - drag.dy;
      root.style.left = `${x}px`;
      root.style.top  = `${y}px`;
      root.style.right = "auto";
      root.style.bottom = "auto";
      root.style.transform = "";
    });
    const endDrag = async (ev) => {
      if (!drag) return;
      drag = null;
      try { bar.releasePointerCapture(ev.pointerId); } catch(_) {}
      const r = root.getBoundingClientRect();
      const W = window.innerWidth;
      const H = window.innerHeight;
      const newPos = {
        x: r.left,
        y: r.top,
        refW: W,
        refH: H,

        leftFrac:   W > 0 ? (r.left / W) : null,
        bottomFrac: H > 0 ? ((H - r.top) / H) : null
      };
      SDActionHUD._inFlightPos = newPos;
      try { await game.settings.set("sd", "actionHudPos", newPos); } catch(e) {}
      if (SDActionHUD._inFlightPos === newPos) SDActionHUD._inFlightPos = null;
    };
    bar.addEventListener("pointerup",   endDrag);
    bar.addEventListener("pointercancel", endDrag);

    root.querySelector("[data-action='close']")?.addEventListener("click", () => {
      SDActionHUD._userHidden = true;
      SDActionHUD._hideAll();
    });

    const lockBtn = root.querySelector("[data-action='lockToggle']");
    if (lockBtn) {
      lockBtn.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        let locked = false;
        try { locked = !!game.settings.get("sd", "actionHudLocked"); } catch(_) {}
        try { await game.settings.set("sd", "actionHudLocked", !locked); } catch(_) {}
        SDActionHUD._refreshLockUI();
      });
    }

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
      SDActionHUD._hideAll();
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
        SDActionHUD._hideAll();
      }
    }
  }

  static onActorUpdate(actor) {
    if (!actor) return;
    if (this._actor && this._actor === actor) this._render();
  }

  static refresh() {
    if (!this._actor) {
      SDActionHUD._hideAll();
      return;
    }
    if (!game.settings.get("sd", "actionHudEnabled") || this._userHidden) {
      SDActionHUD._hideAll();
      return;
    }
    this._render();
  }

  static _hideAll() {
    const root = document.getElementById("sd-action-hud");
    if (root) root.style.display = "none";
    const layer = document.getElementById("sd-action-hud-floating");
    if (layer) {
      layer.innerHTML = "";
      layer.style.display = "none";
    }
  }

  static _ensureFloatLayer() {
    let layer = document.getElementById("sd-action-hud-floating");
    if (!layer) {
      layer = document.createElement("div");
      layer.id = "sd-action-hud-floating";

      layer.classList.add("sd-action-hud-floating-layer", "sd");
      layer.style.position = "fixed";
      layer.style.inset = "0";
      layer.style.pointerEvents = "none";
      layer.style.zIndex = "70";
      document.body.appendChild(layer);
    }
    return layer;
  }

  static _scaledRootPos(pos) {
    let x = Number.isFinite(pos?.x) ? pos.x : null;
    let y = Number.isFinite(pos?.y) ? pos.y : null;
    if (x === null || y === null) return { x, y };
    let responsive = false;
    try { responsive = !!game.settings.get("sd", "actionHudResponsivePosition"); } catch(_) {}
    if (responsive) {
      const W = window.innerWidth;
      const H = window.innerHeight;
      if (Number.isFinite(pos.leftFrac) && Number.isFinite(pos.bottomFrac)) {
        x = pos.leftFrac * W;
        y = H - pos.bottomFrac * H;
      } else if (Number.isFinite(pos.refW) && pos.refW > 0
              && Number.isFinite(pos.refH) && pos.refH > 0) {
        const bottomPx = pos.refH - pos.y;
        x = x * (W / pos.refW);
        y = H - bottomPx * (H / pos.refH);
      }
    }
    x = Math.min(Math.max(x, 0), Math.max(window.innerWidth  - 80, 0));
    y = Math.min(Math.max(y, 0), Math.max(window.innerHeight - 40, 0));
    return { x, y };
  }

  static _scaledScreenEntry(entry) {
    let x = Number.isFinite(entry?.screenX) ? entry.screenX : null;
    let y = Number.isFinite(entry?.screenY) ? entry.screenY : null;
    if (x === null || y === null) return { x: null, y: null };
    let responsive = false;
    try { responsive = !!game.settings.get("sd", "actionHudResponsivePosition"); } catch(_) {}
    if (responsive) {
      const W = window.innerWidth;
      const H = window.innerHeight;
      if (Number.isFinite(entry.screenLeftFrac) && Number.isFinite(entry.screenBottomFrac)) {
        x = entry.screenLeftFrac * W;
        y = H - entry.screenBottomFrac * H;
      } else if (Number.isFinite(entry.screenRefW) && entry.screenRefW > 0
              && Number.isFinite(entry.screenRefH) && entry.screenRefH > 0) {
        const bottomPx = entry.screenRefH - entry.screenY;
        x = x * (W / entry.screenRefW);
        y = H - bottomPx * (H / entry.screenRefH);
      }
    }
    x = Math.min(Math.max(x, 0), Math.max(window.innerWidth  - 40, 0));
    y = Math.min(Math.max(y, 0), Math.max(window.innerHeight - 24, 0));
    return { x, y };
  }

  static async resetPosition() {
    try {
      if (game.settings.get("sd", "actionHudLocked")) {
        await game.settings.set("sd", "actionHudLocked", false);
      }
      await game.settings.set("sd", "actionHudPos", {
        x: null, y: null, refW: null, refH: null,
        leftFrac: null, bottomFrac: null
      });
      SDActionHUD._inFlightPos = null;

      const layout = foundry.utils.deepClone(game.settings.get("sd", "actionHud") ?? {});
      let changed = false;
      const SCREEN_KEYS = ["screenX", "screenY", "screenRefW", "screenRefH",
                           "screenLeftFrac", "screenBottomFrac"];
      for (const k of ["character", "npc"]) {
        const entries = Array.isArray(layout?.[k]?.entries) ? layout[k].entries : null;
        if (!entries) continue;
        for (const e of entries) {
          if (e == null) continue;
          for (const sk of SCREEN_KEYS) {
            if (e[sk] !== undefined) { delete e[sk]; changed = true; }
          }
        }
      }
      if (changed) {
        try { await game.settings.set("sd", "actionHud", layout); } catch(e) {}
      }

      SDActionHUD._userHidden = false;
      try { ui.notifications.info(game.i18n.localize("SD.ActionHud.Notify.PositionReset")); } catch(_) {}
      SDActionHUD.refresh();
    } catch(e) {
      console.warn("SD HUD | resetPosition failed:", e);
    }
  }

  static _render() {
    const actor = this._actor;
    if (!actor) return;
    if (this._userHidden) return;

    document.querySelectorAll("body > .sd-hud-pop-portal").forEach(el => el.remove());

    const root = this._ensureRoot();

    const separateModeForRoot = !!game.settings.get("sd", "actionHudSeparateWidgets");
    root.style.display = separateModeForRoot ? "none" : "flex";

    const bgOp = Math.min(Math.max(Number(game.settings.get("sd", "actionHudBgOpacity") ?? 92), 0), 100) / 100;
    root.style.setProperty("--sd-hud-bar-bg-alpha", bgOp);
    const defaultTransparent = !!game.settings.get("sd", "actionHudDefaultTransparent");
    root.classList.toggle("sd-hud-default-transparent", defaultTransparent);
    const showFrames = !!game.settings.get("sd", "actionHudShowFrames");
    root.classList.toggle("sd-hud-no-frames", !showFrames);
    const widgetShadow = !!game.settings.get("sd", "actionHudWidgetShadow");
    root.classList.toggle("sd-hud-shadow", widgetShadow);

    const separateMode = !!game.settings.get("sd", "actionHudSeparateWidgets");
    root.classList.toggle("sd-hud-separate", separateMode);

    const scale = Math.min(Math.max(Number(game.settings.get("sd", "actionHudScale") ?? 100), 50), 200) / 100;
    root.style.setProperty("--sd-hud-scale", scale);

    const savedPos = game.settings.get("sd", "actionHudPos") ?? {};
    const rawPos = (SDActionHUD._inFlightPos
                    && Number.isFinite(SDActionHUD._inFlightPos.x)
                    && Number.isFinite(SDActionHUD._inFlightPos.y))
      ? SDActionHUD._inFlightPos
      : savedPos;
    const pos = SDActionHUD._scaledRootPos(rawPos);
    if (Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
      root.style.left = `${pos.x}px`;
      root.style.top  = `${pos.y}px`;
      root.style.right = "auto";
      root.style.bottom = "auto";
      root.style.transform = "";
    } else {

      root.style.left = "50%";
      root.style.bottom = "120px";
      root.style.top = "auto";
      root.style.right = "auto";
      root.style.transform = "translateX(-50%)";
    }

    SDActionHUD._refreshLockUI();

    const nameEl = root.querySelector(".sd-actor-name");
    if (nameEl) nameEl.textContent = actor.name ?? "";

    const canvasEl = root.querySelector(".sd-action-hud-canvas");
    if (!canvasEl) return;
    canvasEl.innerHTML = "";

    const innerEl = document.createElement("div");
    innerEl.className = "sd-action-hud-canvas-inner";
    canvasEl.appendChild(innerEl);

    const floatLayer = SDActionHUD._ensureFloatLayer();
    floatLayer.innerHTML = "";
    floatLayer.classList.toggle("sd-hud-builder", !!(this._builderMode && game.user.isGM));
    floatLayer.classList.toggle("sd-hud-default-transparent", defaultTransparent);
    floatLayer.classList.toggle("sd-hud-no-frames", !showFrames);
    floatLayer.classList.toggle("sd-hud-shadow", widgetShadow);
    floatLayer.classList.toggle("sd-hud-separate", separateMode);
    floatLayer.style.display = separateMode ? "" : "none";

    const layout = game.settings.get("sd", "actionHud") ?? {};
    const typeKey = actor.type === "npc" ? "npc" : "character";
    const entries = Array.isArray(layout?.[typeKey]?.entries) ? layout[typeKey].entries : [];

    const rootRect = root.getBoundingClientRect();
    let baseScreenX = Number.isFinite(pos.x) ? pos.x : null;
    let baseScreenY = Number.isFinite(pos.y) ? pos.y : null;
    if (!Number.isFinite(baseScreenX) || !Number.isFinite(baseScreenY)
        || (separateMode && rootRect.width === 0 && rootRect.height === 0
            && baseScreenX === 0 && baseScreenY === 0)) {
      baseScreenX = Math.max(0, (window.innerWidth  - 200) / 2);
      baseScreenY = Math.max(0,  window.innerHeight - 220);
    }

    let maxX = 0, maxY = 0;

    entries.forEach((entry, i) => {
      try {
        const widgetDef = this._resolveWidget(entry, actor);
        if (!widgetDef) return;

        const cell = document.createElement("div");
        cell.classList.add("sd-action-hud-widget");
        cell.dataset.entryIdx = String(i);
        const x = Number.isFinite(entry.x) ? entry.x : 0;
        const y = Number.isFinite(entry.y) ? entry.y : 0;

        if (separateMode) {
          cell.classList.add("sd-hud-floating");
          cell.style.position = "fixed";
          const scaled = SDActionHUD._scaledScreenEntry(entry);
          const sx = Number.isFinite(scaled.x) ? scaled.x : Math.max(0, baseScreenX + x);
          const sy = Number.isFinite(scaled.y) ? scaled.y : Math.max(0, baseScreenY + y);
          cell.style.left = `${sx}px`;
          cell.style.top  = `${sy}px`;
        } else {
          cell.style.position = "absolute";
          cell.style.left = `${x}px`;
          cell.style.top  = `${y}px`;
        }

        if (Number.isFinite(entry.w) && entry.w > 0) cell.style.minWidth  = `${entry.w}px`;
        if (Number.isFinite(entry.h) && entry.h > 0) cell.style.minHeight = `${entry.h}px`;

        const explicitTransparent = entry.transparent === true;
        const explicitOpaque      = entry.transparent === false;
        const isTransparent = explicitTransparent || (defaultTransparent && !explicitOpaque);
        if (isTransparent) cell.dataset.transparent = "true";

        const DROPDOWN_TYPES = ["inventory", "effects", "spellbook"];
        const supportsHideLabel = !DROPDOWN_TYPES.includes(widgetDef.type);
        if (entry.hideLabel === true && supportsHideLabel) cell.dataset.hideLabel = "true";

        let cellScalePct = 100;
        if (Number.isFinite(entry.scale) && entry.scale > 0) {
          cellScalePct = Math.min(Math.max(entry.scale, 25), 400);
        }
        if (separateMode) {
          const effective = (cellScalePct / 100) * scale;
          if (effective !== 1) {
            cell.style.setProperty("--sd-hud-cell-scale", effective);
            cell.dataset.cellScaled = "true";
            cell.style.transformOrigin = "top left";
          }
        } else if (cellScalePct !== 100) {
          const s = cellScalePct / 100;
          cell.style.setProperty("--sd-hud-cell-scale", s);
          cell.dataset.cellScaled = "true";
        }

        const COMPACTABLE = ["inventory", "effects", "spellbook", "slot"];
        let renderDef = widgetDef;
        if (COMPACTABLE.includes(widgetDef.type)) {
          if (entry.compact !== false) {
            renderDef = { ...widgetDef, compact: true };
          }
        }

        const hudVariant = _sanitizeHudVariant(entry.variant, widgetDef.type);
        if (hudVariant) {
          renderDef = { ...renderDef, variant: hudVariant };
        }

        cell.innerHTML = WidgetRenderer.render(renderDef, actor, false) ?? "";

        wireHudWidget(cell, renderDef, actor);

        if (separateMode) {
          cell.style.pointerEvents = "auto";
          floatLayer.appendChild(cell);

          SDActionHUD._renderFloatingBar(cell, actor, i);
        } else {
          innerEl.appendChild(cell);
        }

        const cellW = (Number.isFinite(entry.w) && entry.w > 0) ? entry.w : (cell.offsetWidth || 100);
        const cellH = (Number.isFinite(entry.h) && entry.h > 0) ? entry.h : (cell.offsetHeight || 60);
        if (x + cellW > maxX) maxX = x + cellW;
        if (y + cellH > maxY) maxY = y + cellH;
      } catch(e) {
        console.warn("SD HUD | render entry failed:", entry, e);
      }
    });

    const _maxX = Math.max(maxX, 200);
    const _maxY = Math.max(maxY,  80);
    innerEl.style.width   = `${_maxX}px`;
    innerEl.style.height  = `${_maxY}px`;
    if (separateMode) {
      canvasEl.style.width  = "0px";
      canvasEl.style.height = "0px";
    } else {
      canvasEl.style.width  = `${Math.ceil(_maxX * scale)}px`;
      canvasEl.style.height = `${Math.ceil(_maxY * scale)}px`;
    }

    root.classList.toggle("sd-hud-builder", !!(this._builderMode && game.user.isGM));
    if (this._builderMode && game.user.isGM) {
      this._wireBuilderMode(root, separateMode ? floatLayer : canvasEl, entries, separateMode);
    }
  }

  static _renderFloatingBar(cell, actor, idx) {

    cell.querySelector(":scope > .sd-hud-float-bar")?.remove();

    const bar = document.createElement("div");
    bar.className = "sd-hud-float-bar";
    const isGM = !!game.user?.isGM;
    const gmHide = (s) => isGM ? "" : ` style="display:none"`;
    bar.innerHTML = `
      <span class="sd-hud-float-grab" title="Drag widget"><i class="fas fa-up-down-left-right"></i></span>
      <span class="sd-hud-float-title">${(actor?.name ?? "").toString().replace(/[<>&"']/g, c => ({"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;","'":"&#39;"}[c]))}</span>
      <button type="button" data-act="lockToggle" title="Lock"><i class="fas fa-lock-open"></i></button>
      <button type="button" data-act="editToggle" title="Toggle edit mode (GM)"${gmHide()}><i class="fas fa-pencil"></i></button>
      <button type="button" data-act="editList"   title="Open layout list (GM)"${gmHide()}><i class="fas fa-list"></i></button>
      <button type="button" data-act="close"      title="Hide HUD"><i class="fas fa-xmark"></i></button>
    `;
    cell.appendChild(bar);

    try {
      const locked = !!game.settings.get("sd", "actionHudLocked");
      const lbtn = bar.querySelector("button[data-act='lockToggle']");
      if (lbtn) {
        lbtn.classList.toggle("is-on", locked);
        const icon = lbtn.querySelector("i");
        if (icon) icon.className = locked ? "fas fa-lock" : "fas fa-lock-open";
      }
    } catch(_) {}

    const grab = bar.querySelector(".sd-hud-float-grab");
    let drag = null;
    const startDrag = (ev) => {
      let locked = false;
      try { locked = !!game.settings.get("sd", "actionHudLocked"); } catch(_) {}
      if (locked) return;
      ev.preventDefault();
      ev.stopPropagation();
      const r = cell.getBoundingClientRect();
      drag = { dx: ev.clientX - r.left, dy: ev.clientY - r.top };
      try { grab.setPointerCapture(ev.pointerId); } catch(_) {}
    };
    const moveDrag = (ev) => {
      if (!drag) return;
      ev.preventDefault();
      const x = Math.max(0, ev.clientX - drag.dx);
      const y = Math.max(0, ev.clientY - drag.dy);
      cell.style.left = `${x}px`;
      cell.style.top  = `${y}px`;
    };
    const endDrag = async (ev) => {
      if (!drag) return;
      drag = null;
      try { grab.releasePointerCapture(ev.pointerId); } catch(_) {}
      try {
        const x = parseInt(cell.style.left || "0", 10);
        const y = parseInt(cell.style.top  || "0", 10);
        const W = window.innerWidth;
        const H = window.innerHeight;
        await SDActionHUD._mutateEntries((arr) => {
          if (!arr[idx]) return;
          arr[idx].screenX = Math.max(0, x);
          arr[idx].screenY = Math.max(0, y);
          arr[idx].screenRefW = W;
          arr[idx].screenRefH = H;

          arr[idx].screenLeftFrac   = W > 0 ? (x / W) : null;
          arr[idx].screenBottomFrac = H > 0 ? ((H - y) / H) : null;
        });
      } catch(e) { console.warn("SD HUD | floating drag persist failed:", e); }
    };
    grab.addEventListener("pointerdown", startDrag);
    grab.addEventListener("pointermove", moveDrag);
    grab.addEventListener("pointerup",   endDrag);
    grab.addEventListener("pointercancel", endDrag);

    bar.querySelector("button[data-act='lockToggle']")?.addEventListener("click", async (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      let locked = false;
      try { locked = !!game.settings.get("sd", "actionHudLocked"); } catch(_) {}
      try { await game.settings.set("sd", "actionHudLocked", !locked); } catch(_) {}
      SDActionHUD._refreshLockUI();
      SDActionHUD._render();
    });
    bar.querySelector("button[data-act='editToggle']")?.addEventListener("click", (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      SDActionHUD._builderMode = !SDActionHUD._builderMode;
      SDActionHUD._render();
    });
    bar.querySelector("button[data-act='editList']")?.addEventListener("click", (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      new SDActionHUDConfig().render(true);
    });
    bar.querySelector("button[data-act='close']")?.addEventListener("click", (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      SDActionHUD._userHidden = true;
      SDActionHUD._hideAll();
    });
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

  static _wireBuilderMode(root, canvasEl, entries, separateMode = false) {
    const cells = canvasEl.querySelectorAll(".sd-action-hud-widget");
    cells.forEach((cell, i) => {
      const entry = entries[i];
      if (!entry) return;

      const widgetDef = SDActionHUD._resolveWidget(entry, SDActionHUD._actor);
      const widgetType = widgetDef?.type ?? "";
      const DROPDOWN_TYPES = ["inventory", "effects", "spellbook"];
      const supportsHideLabel = !DROPDOWN_TYPES.includes(widgetType);

      let overlay = cell.querySelector(".sd-hud-cell-overlay");
      if (!overlay) {
        overlay = document.createElement("div");
        overlay.className = "sd-hud-cell-overlay";
        const hideLabelBtn = supportsHideLabel
          ? `<button type="button" data-act="hideLabel" title="${game.i18n.localize("SD.ActionHud.Cell.HideLabel")}"><i class="fas fa-tag"></i></button>`
          : "";
        overlay.innerHTML = `
          <div class="sd-hud-cell-bar">
            <span class="sd-hud-cell-grab" title="Drag"><i class="fas fa-up-down-left-right"></i></span>
            <span class="sd-hud-cell-label"></span>
            <button type="button" data-act="scale" title="${game.i18n.localize("SD.ActionHud.Cell.Scale")}"><i class="fas fa-expand"></i></button>
            ${hideLabelBtn}
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
        if (separateMode) return 1;
        const hudRoot = document.getElementById("sd-action-hud") ?? canvasEl;
        const v = parseFloat(getComputedStyle(hudRoot).getPropertyValue("--sd-hud-scale"));
        return (Number.isFinite(v) && v > 0) ? v : 1;
      };
      const startDrag = (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const r = cell.getBoundingClientRect();
        const s  = _readScale();
        const cr = separateMode ? { left: 0, top: 0 } : canvasEl.getBoundingClientRect();
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
          if (separateMode) {
            const refW = window.innerWidth;
            const refH = window.innerHeight;
            await SDActionHUD._mutateEntries((arr) => {
              if (arr[idx]) {
                arr[idx].screenX = Math.max(0, x);
                arr[idx].screenY = Math.max(0, y);
                arr[idx].screenRefW = refW;
                arr[idx].screenRefH = refH;

                arr[idx].screenLeftFrac   = refW > 0 ? (Math.max(0, x) / refW) : null;
                arr[idx].screenBottomFrac = refH > 0 ? ((refH - Math.max(0, y)) / refH) : null;
              }
            });
          } else {
            await SDActionHUD._mutateEntries((arr) => {
              if (arr[idx]) { arr[idx].x = Math.max(0, x); arr[idx].y = Math.max(0, y); }
            });
          }
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

        cell.style.minWidth  = `${Math.max(40, w)}px`;
        cell.style.minHeight = `${Math.max(24, h)}px`;
      });
      const endResize = async () => {
        if (!rsz) return;
        rsz = null;
        try {
          const w = Math.max(40, parseInt(cell.style.minWidth || "0", 10));
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

      const hideLblBtn = overlay.querySelector("button[data-act='hideLabel']");
      if (hideLblBtn) {
        hideLblBtn.classList.toggle("is-on", entry.hideLabel === true);
        hideLblBtn.addEventListener("click", async (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          const idx = i;
          await SDActionHUD._mutateEntries((arr) => {
            if (!arr[idx]) return;
            if (arr[idx].hideLabel === true) delete arr[idx].hideLabel;
            else arr[idx].hideLabel = true;
          });
        });
      }

      const scaleBtn = overlay.querySelector("button[data-act='scale']");
      if (scaleBtn) {
        const isScaled = Number.isFinite(entry.scale) && entry.scale > 0 && entry.scale !== 100;
        scaleBtn.classList.toggle("is-on", isScaled);
        scaleBtn.addEventListener("click", async (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          await SDActionHUD._editCellScale(i);
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

  static async _editCellScale(idx) {
    if (!this._actor) return;
    const layout = foundry.utils.deepClone(game.settings.get("sd", "actionHud") ?? {});
    const typeKey = this._actor.type === "npc" ? "npc" : "character";
    const arr = layout?.[typeKey]?.entries;
    const entry = Array.isArray(arr) ? arr[idx] : null;
    if (!entry) return;

    const current = Number.isFinite(entry.scale) && entry.scale > 0 ? entry.scale : 100;
    const html = `
      <div style="display:flex;flex-direction:column;gap:8px;padding:4px 2px">
        <label style="display:flex;align-items:center;gap:8px;font-size:12px">
          <span style="min-width:60px">${game.i18n.localize("SD.ActionHud.Cell.ScalePct")}</span>
          <input type="range" name="scale" min="25" max="400" step="5" value="${current}" style="flex:1" oninput="this.nextElementSibling.value=this.value">
          <output style="min-width:42px;text-align:right;font-variant-numeric:tabular-nums">${current}</output>
        </label>
        <p style="margin:0;font-size:10px;opacity:.7">${game.i18n.localize("SD.ActionHud.Cell.ScaleHint")}</p>
      </div>`;
    const result = await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.localize("SD.ActionHud.Cell.ScaleTitle") },
      content: html,
      ok: {
        label: game.i18n.localize("SD.Save"),
        callback: (event, button, dialog) => {
          const inp = dialog.element.querySelector("input[name='scale']");
          const n = Number(inp?.value ?? 100);
          return Number.isFinite(n) ? Math.min(Math.max(n, 25), 400) : 100;
        }
      }
    });
    if (result === null || result === undefined) return;
    await this._mutateEntries((arrCur) => {
      if (!arrCur[idx]) return;
      if (result === 100) delete arrCur[idx].scale;
      else arrCur[idx].scale = result;
    });
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

    const DROPDOWN_TYPES = ["inventory", "effects", "spellbook"];
    const _resolveType = (e) => {
      if (e.inlineWidget) return e.inlineWidget.type ?? "";
      if (!e.widgetKey) return "";
      for (const a of (game.actors ?? [])) {
        if (a.type !== this._activeType) continue;
        for (const w of collectActorWidgets(a)) {
          if ((w.widgetKey ?? "").trim() === String(e.widgetKey).trim()) return w.type ?? "";
        }
      }
      return "";
    };

    const _variantOptions = (type, currentRaw) => {
      const list = Array.isArray(WIDGET_VARIANTS?.[type]) ? WIDGET_VARIANTS[type] : [];
      const current = String(currentRaw ?? "").trim().toLowerCase();
      const inheritLabel = game.i18n?.localize?.("SD.ActionHud.Cell.VariantInherit") ?? "Use sheet variant";
      const opts = [{ value: "", label: inheritLabel, selected: !current }];
      for (const v of list) {
        const key = `SD.WidgetVariants.${type}.${v}`;
        const loc = game.i18n?.localize?.(key);
        const label = (typeof loc === "string" && loc && loc !== key) ? loc : (v === "default" ? "Default" : v);
        opts.push({ value: v, label, selected: current === v });
      }
      return { has: list.length > 0, opts };
    };

    return {
      ...base,
      activeType: this._activeType,
      isCharacter: this._activeType === "character",
      isNpc:       this._activeType === "npc",
      entries: entries.map((e, idx) => {
        const t = _resolveType(e);
        const variantInfo = _variantOptions(t, e.variant);
        return {
          idx,
          x: Number.isFinite(e.x) ? e.x : 0,
          y: Number.isFinite(e.y) ? e.y : 0,
          w: Number.isFinite(e.w) ? e.w : "",
          h: Number.isFinite(e.h) ? e.h : "",
          scale: Number.isFinite(e.scale) && e.scale > 0 ? e.scale : "",
          hideLabel: e.hideLabel === true,
          supportsHideLabel: !DROPDOWN_TYPES.includes(t),
          widgetKey: e.widgetKey ?? "",
          label: e.label ?? "",
          inlineLabel: e.inlineWidget ? `[inline: ${e.inlineWidget.type ?? "?"}]` : "",
          hasVariants: variantInfo.has,
          variantOptions: variantInfo.opts,
          widgetType: t
        };
      }),
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

      const sKey = `entry_${i}_scale`;
      if (raw[sKey] !== undefined) {
        const v = String(raw[sKey] ?? "").trim();
        if (v === "") delete e.scale;
        else {
          const n = Number(v);
          if (Number.isFinite(n) && n > 0 && n !== 100) e.scale = Math.min(Math.max(n, 25), 400);
          else delete e.scale;
        }
      }
      const hKeyHide = `entry_${i}_hideLabel`;
      if (Object.prototype.hasOwnProperty.call(raw, hKeyHide)) {
        const v = raw[hKeyHide];
        if (v && v !== "0" && v !== false) e.hideLabel = true;
        else delete e.hideLabel;
      }

      const vKey = `entry_${i}_variant`;
      if (Object.prototype.hasOwnProperty.call(raw, vKey)) {
        const v = String(raw[vKey] ?? "").trim().toLowerCase();
        if (!v || v === "__inherit__") delete e.variant;
        else e.variant = v;
      }
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
