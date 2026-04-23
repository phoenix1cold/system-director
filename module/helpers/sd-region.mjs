/**
 * sd-region.mjs -- v14-native Regions support for SD.
 *
 *   1. Provides helpers to place Aura / AoE regions via
 *      canvas.regions.placeRegions(...) when available, with a programmatic
 *      fallback for older builds.
 *
 *   2. Instead of a custom RegionBehaviorType (which requires declaring the
 *      type in system.json → documentTypes.RegionBehavior and survives a
 *      DataModel validation pipeline that rejects on-the-fly registration),
 *      we drive enter/exit effect application ourselves through a simple
 *      updateToken hook + region.testPoint() geometry check.  The config
 *      for every aura/AoE region is stored on the region itself under
 *      `flags.sd.applyEffect`, so it survives scene reload with zero
 *      additional schema work.
 *
 *   3. Hooks deleteRegion to clear lingering flagged effects.
 *
 * Shape types supported (all are native Foundry region shapes):
 *   • circle     -- radius-based disc (AoE default)
 *   • rectangle  -- axis-aligned box
 *   • ellipse    -- axisX/axisY ellipse
 *   • polygon    -- freeform poly (cone approximated)
 *   • emanation  -- token-based ring (aura default)
 */

// v14: `core.rollMode` was renamed to `core.messageMode` (old key is a
// deprecated shim until v16).  Read the new key when available, fall back
// to the old one so v13 and older cores keep working without throwing.
function _sdMsgMode() {
  try {
    const v = game.settings.get("core", "messageMode");
    if (v) return v;
  } catch {}
  try { return game.settings.get("core", "rollMode"); } catch {}
  return "publicroll";
}

/** Build an emanation shape anchored to a token (used by Auras). */
export function buildEmanationShape(tokenDoc, radiusFt) {
  const dist = canvas.dimensions?.distancePixels ?? canvas.grid?.size ?? 100;
  const T = globalThis.CONST?.TOKEN_SHAPES ?? {};
  return {
    type: "emanation",
    base: {
      type:   "token",
      x:      0,
      y:      0,
      width:  tokenDoc.width  ?? 1,
      height: tokenDoc.height ?? 1,
      shape:  tokenDoc.shape  ?? T.ELLIPSE_1 ?? 0
    },
    radius:    Number(radiusFt) * dist,
    gridBased: true
  };
}

/** Build a free-placed shape for an AoE region. `kind` is the node's dropdown value. */
export function buildShape(kind, sizeFt, angleDeg = 53.13) {
  const dist = canvas.dimensions?.distancePixels ?? 100;
  const s = Number(sizeFt) * dist;
  if (!s || !isFinite(s)) return { type: "circle", x: 0, y: 0, radius: dist * 5 };

  switch (kind) {
    case "rectangle":
    case "rect":
    case "square":
      return { type: "rectangle", x: -s / 2, y: -s / 2, width: s, height: s, rotation: 0 };

    case "ellipse":
      return { type: "ellipse", x: 0, y: 0, radiusX: s / 2, radiusY: s / 2, rotation: 0 };

    case "cone": {
      const half = (Number(angleDeg) * Math.PI / 180) / 2;
      const tip  = [0, 0];
      const a    = [s * Math.cos(-half), s * Math.sin(-half)];
      const b    = [s, 0];
      const c    = [s * Math.cos(half),  s * Math.sin(half)];
      return { type: "polygon", points: [...tip, ...a, ...b, ...c].map(n => Math.round(n)) };
    }

    case "ray":
    case "line": {
      const w = canvas.grid?.size ?? 100;
      return { type: "rectangle", x: 0, y: -w / 2, width: s, height: w, rotation: 0 };
    }

    case "circle":
    default:
      return { type: "circle", x: 0, y: 0, radius: s };
  }
}

/** Build the base Region creation payload (sans any custom behaviors). */
function _regionData({ name, shape, flags = {}, hidden = false }) {
  const V = CONST?.REGION_VISIBILITY ?? {};
  const visibility = hidden
    ? (V.GAMEMASTER ?? 0)
    : (V.OBSERVER   ?? 2);
  return {
    name:       name ?? "SD Region",
    shapes:     [shape],
    behaviors:  [],
    visibility,
    ownership:  { [game.user.id]: CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3 },
    flags
  };
}

/**
 * Place a Region interactively at the cursor.
 * Returns the created RegionDocument, or null on cancel.
 */
export async function placeRegionInteractive({ name, shape, flags = {}, hidden = false }) {
  if (!canvas?.scene) return null;
  const data = _regionData({ name, shape, flags, hidden });

  const layer = canvas.regions;
  if (layer && typeof layer.placeRegions === "function") {
    try {
      const docs = await layer.placeRegions([data], { create: true, allowRotation: true });
      return Array.isArray(docs) ? docs[0] ?? null : null;
    } catch (e) {
      console.warn("SD | placeRegionInteractive(placeRegions) failed:", e);
    }
  }

  try {
    const docs = await canvas.scene.createEmbeddedDocuments("Region", [data]);
    return Array.isArray(docs) ? docs[0] ?? null : null;
  } catch (e) {
    console.error("SD | placeRegionInteractive fallback create failed:", e);
    return null;
  }
}

/**
 * Place an aura Region attached to a token.
 * Returns the created RegionDocument, or null on failure.
 */
export async function placeAuraRegion({ ownerToken, shape, flags = {}, name }) {
  if (!canvas?.scene || !ownerToken) return null;
  const data = _regionData({ name: name ?? "SD Aura", shape, flags });

  const layer = canvas.regions;
  let doc = null;

  if (layer && typeof layer.placeRegions === "function") {
    const prevControlled = [...(canvas.tokens?.controlled ?? [])];
    try {
      if (!ownerToken.controlled) ownerToken.control({ releaseOthers: true });
      const docs = await layer.placeRegions([data], { create: true, attachToToken: true });
      doc = Array.isArray(docs) ? docs[0] ?? null : null;
    } catch (e) {
      console.warn("SD | placeAuraRegion(placeRegions+attachToToken) failed:", e);
    } finally {
      try {
        for (const t of prevControlled) t.control({ releaseOthers: false });
      } catch {}
    }
  }

  if (!doc) {
    try {
      const docs = await canvas.scene.createEmbeddedDocuments("Region", [data]);
      doc = Array.isArray(docs) ? docs[0] ?? null : null;
    } catch (e) {
      console.error("SD | placeAuraRegion fallback create failed:", e);
      return null;
    }
  }

  // Attach the region to the owner token -- best-effort, different v14 builds
  // expose the attachment field under different paths.
  if (doc) {
    try {
      if (typeof doc.attachToken === "function") {
        await doc.attachToken(ownerToken.id);
      } else if (doc.schema?.has?.("attachment")) {
        await doc.update({ "attachment.token": ownerToken.id });
      } else if ("attachedToken" in doc) {
        await doc.update({ attachedToken: ownerToken.id });
      }
    } catch (e) {
      console.warn("SD | attach fallback failed (non-fatal):", e);
    }
  }

  return doc;
}

/** Collect tokens currently inside a placed Region. */
export function getRegionTokens(regionDoc) {
  if (!regionDoc) return [];
  const out = [];

  if (regionDoc.tokens && typeof regionDoc.tokens.forEach === "function") {
    for (const tok of regionDoc.tokens) out.push(tok);
    if (out.length) return out;
  }

  const object = regionDoc.object ?? canvas.regions?.placeables?.find(r => r.document === regionDoc);
  for (const ptok of canvas.tokens?.placeables ?? []) {
    const c = ptok.center;
    if (!c) continue;
    try {
      if (object?.testPoint?.(c)) out.push(ptok.document);
      else if (regionDoc.testPoint?.(c)) out.push(ptok.document);
    } catch {}
  }
  return out;
}

// Hook-based enter/exit effect application
//
// We watch updateToken for movement and recompute which SD-flagged regions
// each token is inside.  A token that newly enters a region gains the
// region's named effect; a token that exits has it removed.  All bookkeeping
// lives in region.flags.sd.applyEffect (per-region) so the scene survives
// reload without any custom schema.

/** Axis-aligned point-in-polygon test (ray casting). */
function _pointInPolygon(pt, flat) {
  if (!flat || flat.length < 6) return false;
  let inside = false;
  for (let i = 0, j = flat.length - 2; i < flat.length; j = i, i += 2) {
    const xi = flat[i],     yi = flat[i + 1];
    const xj = flat[j],     yj = flat[j + 1];
    const denom = (yj - yi) || 1e-9;
    const hit = ((yi > pt.y) !== (yj > pt.y)) &&
                (pt.x < ((xj - xi) * (pt.y - yi) / denom) + xi);
    if (hit) inside = !inside;
  }
  return inside;
}

/** Pure-JS test against a region shape (works before the PIXI object exists). */
function _pointInShape(shape, pt) {
  if (!shape || !pt) return false;
  switch (shape.type) {
    case "circle": {
      const dx = pt.x - (shape.x ?? 0);
      const dy = pt.y - (shape.y ?? 0);
      const r  = Number(shape.radius) || 0;
      return (dx * dx + dy * dy) <= r * r;
    }
    case "rectangle": {
      const x = shape.x ?? 0, y = shape.y ?? 0;
      const w = Number(shape.width)  || 0;
      const h = Number(shape.height) || 0;
      return pt.x >= x && pt.x <= x + w && pt.y >= y && pt.y <= y + h;
    }
    case "ellipse": {
      const dx = pt.x - (shape.x ?? 0);
      const dy = pt.y - (shape.y ?? 0);
      const rx = Number(shape.radiusX) || 1;
      const ry = Number(shape.radiusY) || 1;
      return (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1;
    }
    case "polygon":
      return _pointInPolygon(pt, shape.points ?? []);
    default:
      return false;
  }
}

/** Test a token against a region (geometric fallback when region.tokens is empty). */
function _tokenInside(regionDoc, tokenDoc) {
  if (!regionDoc || !tokenDoc) return false;
  try {
    if (regionDoc.tokens?.has?.(tokenDoc)) return true;
  } catch {}
  const object = regionDoc.object
             ?? canvas.regions?.placeables?.find(r => r.document === regionDoc);
  const tokenObj = tokenDoc.object ?? canvas.tokens?.placeables?.find(t => t.document === tokenDoc);

  // Fallback center: top-left + half the token's pixel footprint so tests
  // against the token's centre, not its upper-left corner.
  const gridSize = canvas.dimensions?.size ?? canvas.grid?.size ?? 100;
  const halfW = ((Number(tokenDoc.width)  || 1) * gridSize) / 2;
  const halfH = ((Number(tokenDoc.height) || 1) * gridSize) / 2;
  const center = tokenObj?.center ?? {
    x: (tokenDoc.x ?? 0) + halfW,
    y: (tokenDoc.y ?? 0) + halfH
  };
  try {
    const viaPlaceable = object?.testPoint?.(center);
    if (viaPlaceable !== undefined) return !!viaPlaceable;
    const viaDoc = regionDoc.testPoint?.(center);
    if (viaDoc !== undefined) return !!viaDoc;
  } catch {}

  // Last-resort geometric test: the PIXI placeable may not exist yet
  // (happens on freshly-created AoE regions, before canvas settles).
  const shapes = regionDoc.shapes ?? [];
  for (const shape of shapes) {
    if (_pointInShape(shape, center)) return true;
  }
  return false;
}

/** True if the region's owner currently carries the disabling condition. */
function _regionSuppressed(regionDoc) {
  const cfg = regionDoc?.flags?.sd?.applyEffect;
  const cond = cfg?.conditionEffect?.trim();
  if (!cond) return false;
  const ownerId = cfg.ownerTokenId ?? regionDoc?.flags?.sd?.aura?.ownerTokenId;
  if (!ownerId) return false;
  const scene = regionDoc?.parent;
  const ownerTok = scene?.tokens?.get?.(ownerId);
  const ownerActor = ownerTok?.actor;
  if (!ownerActor) return false;
  return ownerActor.effects.some(e => e.name === cond && !e.disabled);
}

/** Format chat-card visibility onto a ChatMessage.create payload. */
function _chatVisibility(cfg, speaker) {
  const out = { speaker };
  if ((cfg?.visibility ?? "everyone") === "gm") {
    out.whisper = ChatMessage.getWhisperRecipients("GM").map(u => u.id);
  }
  return out;
}

/** Ensure the region's ActiveEffect exists on an actor (effect-only mode). */
async function _applyNamedEffect(regionDoc, tokenDoc) {
  const cfg = regionDoc?.flags?.sd?.applyEffect;
  if (!cfg?.effectName) return;
  const actor = tokenDoc?.actor;
  if (!actor) return;
  const already = actor.effects.find(
    e => e.name === cfg.effectName && e.flags?.sd?.fromRegion === regionDoc.id
  );
  if (already) return;
  try {
    await actor.createEmbeddedDocuments("ActiveEffect", [{
      name:    cfg.effectName,
      img:     cfg.effectImg || "icons/svg/aura.svg",
      changes: Array.isArray(cfg.changes) ? cfg.changes : [],
      origin:  actor.uuid,
      flags:   { sd: { fromRegion: regionDoc.id, auraKey: cfg.auraKey || "aura" } }
    }]);
  } catch (e) {
    console.warn("SD | _applyNamedEffect failed:", e);
  }
}

/** Remove the region's ActiveEffect from an actor (if it was applied by us). */
async function _removeNamedEffect(regionDoc, tokenDoc) {
  const cfg = regionDoc?.flags?.sd?.applyEffect;
  if (!cfg?.effectName) return;
  const actor = tokenDoc?.actor;
  if (!actor) return;
  const ids = actor.effects
    .filter(e => e.name === cfg.effectName && e.flags?.sd?.fromRegion === regionDoc.id)
    .map(e => e.id);
  if (!ids.length) return;
  try { await actor.deleteEmbeddedDocuments("ActiveEffect", ids); } catch {}
}

/** Apply damage or heal to an actor — respects hpMode (add/set). */
async function _applyHpChange(actor, amount, cfg, kind /* "damage" | "heal" */) {
  const path = cfg.hpPath || "system.resources.hp.value";
  // Mirror the cap logic used by every other HP path in the codebase
  // (button-executor chatDamage / applyHp / sd.mjs damage handler): derive
  // max from <hpPath>.max so heal auras/AoEs don't push HP above max.
  const maxPath = path.replace(/\.value$/, ".max");
  const cur = Number(foundry.utils.getProperty(actor, path)    ?? 0);
  const maxHp = Number(foundry.utils.getProperty(actor, maxPath) ?? 0);
  let next = cur;
  if (cfg.hpMode === "set") {
    next = Math.max(0, Math.round(amount));
  } else {
    next = kind === "heal" ? cur + Math.round(amount) : cur - Math.round(amount);
    next = Math.max(0, next);
  }
  if (maxHp && next > maxHp) next = maxHp;
  try { await actor.update({ [path]: next }); } catch (e) {
    console.warn("SD | _applyHpChange update failed:", e);
  }
  return { cur, next, delta: Math.abs(next - cur) };
}

// Resolve a damage/heal formula, honouring resistance for damage.
// When `preRaw` is provided, skip the roll and treat it as the raw pre-roll
// (resistance is still applied per-actor).  Used by the "once" rollApplyMode
// so a single roll can be shared across every token the sweep hits.
async function _rollAmount(formula, actor, cfg, kind, preRaw = null) {
  let amount = 0;
  if (preRaw !== null && preRaw !== undefined) {
    amount = Number(preRaw) || 0;
  } else {
    const rollData = actor?.getRollData?.() ?? {};
    const bonus = String(cfg?.bonusFormula ?? "").trim();
    const full = bonus ? `(${formula || "0"}) + (${bonus})` : String(formula || "0");
    try {
      const r = new Roll(full, rollData);
      await r.evaluate();
      amount = r.total;
    } catch (e) {
      console.warn("SD | region roll failed:", full, e);
      return { amount: 0, roll: null, resisted: false };
    }
  }
  let resisted = false;
  if (kind === "damage" && cfg.damageType && actor) {
    const resPath = `system.resistances.${cfg.damageType}`;
    const res = foundry.utils.getProperty(actor, resPath);
    if (res === "immune") { amount = 0; resisted = true; }
    else if (res === "resistant") { amount = Math.floor(amount / 2); resisted = true; }
    else if (res === "vulnerable") { amount = amount * 2; resisted = true; }
  }
  return { amount, roll: null, resisted };
}

// Roll the bare damage/heal formula once with no actor-specific bonus so the
// result can be shared across a sweep (rollApplyMode = "once").  Resistances
// are NOT applied here -- they're still evaluated per-actor downstream.
async function _rollSharedAmount(cfg) {
  const bonus   = String(cfg?.bonusFormula ?? "").trim();
  const formula = String(cfg?.formula ?? "0");
  const full    = bonus ? `(${formula}) + (${bonus})` : formula;
  try {
    const r = new Roll(full, {});
    await r.evaluate();
    return Number(r.total) || 0;
  } catch (e) {
    console.warn("SD | region shared roll failed:", full, e);
    return 0;
  }
}

/**
 * Region-level chat toggle.
 *
 * `cfg.showInChat` (new) -- explicit yes/no, wins over the legacy `chatMode`.
 * `cfg.chatMode`   (legacy) -- "card" posts, anything else (incl. "auto") is silent.
 */
function _chatEnabled(cfg) {
  if (cfg?.showInChat === false) return false;
  if (cfg?.showInChat === true)  return true;
  return (cfg?.chatMode ?? "auto") === "card";
}

/**
 * Should the region auto-apply HP deltas / named effects on enter / tick?
 *
 *   cfg.applyMode === "auto"  → true  (auto-apply + chat card with "Applied automatically" badge)
 *   cfg.applyMode === "card"  → false (no auto-apply; chat card gets a live Apply button)
 *   cfg.applyMode unset       → legacy path: honour `chatMode` -- "card" = manual, "auto" = auto.
 *   nothing set at all        → true  (backward compat -- old regions keep auto-applying).
 */
function _shouldAutoApply(cfg) {
  const am = cfg?.applyMode;
  if (am === "auto") return true;
  if (am === "card") return false;
  const cm = cfg?.chatMode;
  if (cm === "card") return false;
  if (cm === "auto") return true;
  return true;
}

/**
 * Post a damage/heal chat card using the same interactive renderer as
 * `chatDamage` / `chatHeal` (Apply / → Selected / mult-buttons / reroll).
 *
 * The aura/AoE already auto-applied the HP change before calling us --
 * we pass `autoApplied:true` so the card shows an "Applied automatically"
 * banner instead of a live Apply button (otherwise clicking Apply would
 * double-apply the delta).  The "→ Selected" button still works for
 * splashing the same amount to other tokens the GM selects.
 */
async function _postHpCard(actor, cfg, kind, roll, applied) {
  if (!_chatEnabled(cfg)) return;
  const isHeal = kind === "heal";
  const { ButtonExecutor } = await import("./button-executor.mjs");
  const label = cfg.effectName
    ? `${cfg.effectName}${cfg.damageType ? ` (${cfg.damageType})` : ""}`
    : (isHeal ? "Healing" : `Damage${cfg.damageType ? ` (${cfg.damageType})` : ""}`);

  const autoApplied = _shouldAutoApply(cfg);

  // In "card" mode nothing was auto-applied -- the rendered card needs a live
  // Apply button and the actual rolled amount (the caller passes a synthetic
  // applied:{delta:amount, preview:true} so we can read `amount` off of it).
  const amount = Math.abs(applied?.delta ?? applied?.amount ?? 0);

  const content = ButtonExecutor._buildChatCard({
    type:        isHeal ? "heal" : "damage",
    label,
    amount,
    srcName:     actor?.name ?? "?",
    srcImg:      actor?.img  ?? "icons/svg/aura.svg",
    tActor:      actor,
    hpPath:      cfg.hpPath ?? "system.resources.hp.value",
    showApply:   !autoApplied,
    rollFormula: cfg.formula || null,
    srcActorId:  null,
    autoApplied
  });

  const payload = { content, ..._chatVisibility(cfg, ChatMessage.getSpeaker({ actor })) };
  try { await ChatMessage.create(payload); } catch {}
}

/**
 * Post a small interactive card with an "Apply Effect" button.  Used for
 * save-effect regions in applyMode:"card" -- the save roll already fired via
 * `_postSaveCard`, but instead of auto-applying the region's named effect on
 * failure we leave it to the GM to click a button.
 *
 * The button carries the target actor id + region id so the click handler
 * (in `sd.mjs`, next to `chat-*` click wiring) can re-derive the region
 * config and call `_applyNamedEffect` cleanly.
 */
async function _postApplyEffectButton(actor, regionDoc, cfg) {
  if (!_chatEnabled(cfg)) return;
  const label     = cfg.effectName || cfg.flavor || "Apply Effect";
  const actorId   = actor?.id ?? "";
  const sceneId   = regionDoc?.parent?.id ?? canvas.scene?.id ?? "";
  const regionId  = regionDoc?.id ?? "";
  const color     = cfg.mode === "save-effect" ? "#7a3545" : "#4a3a7a";

  const html = `
<div class="sd-chat-card sd-region-apply-effect-card" style="
  background:linear-gradient(135deg,#14141e 0%,#1a1a2e 100%);
  border:1px solid ${color};border-radius:8px;padding:10px 12px;
  color:#e0e0ff;font-family:inherit;">
  <div style="font-size:12px;opacity:.8;margin-bottom:6px;">Save failed — apply region effect?</div>
  <div style="display:flex;gap:8px;align-items:center;">
    <button type="button"
      class="sd-apply-region-effect"
      data-actor-id="${actorId}"
      data-scene-id="${sceneId}"
      data-region-id="${regionId}"
      style="flex:1;background:${color};border:1px solid #fff2;color:#fff;
             padding:6px 10px;border-radius:5px;cursor:pointer;font-weight:600;">
      <i class="fas fa-wand-sparkles"></i> ${foundry.utils.escapeHTML(label)}
    </button>
  </div>
</div>`;

  const payload = { content: html, ..._chatVisibility(cfg, ChatMessage.getSpeaker({ actor })) };
  try { await ChatMessage.create(payload); } catch {}
}

/**
 * Build the d20 core expression for a save, honouring advMode.
 *
 *   advMode = "none" → "1d20"
 *   advMode = "adv"  → cfg.advFormula (if present) else "2d20kh1"
 *   advMode = "dis"  → cfg.disFormula (if present) else "2d20kl1"
 *
 * A leading `@mod` in adv/dis formulas is stripped -- the caller appends the
 * modifier itself so the mod path stays centralised.
 */
function _saveCoreFormula(cfg, advMode) {
  const strip = (f) => String(f ?? "").trim();
  if (advMode === "adv") return strip(cfg.advFormula) || "2d20kh1";
  if (advMode === "dis") return strip(cfg.disFormula) || "2d20kl1";
  return "1d20";
}

/**
 * Show the Adv/Normal/Dis dialog via the shared ButtonExecutor helper.
 * Returns either a chosen advMode ("none"|"adv"|"dis") or `null` if cancelled.
 */
async function _askAdvMode(cfg, actor) {
  try {
    const mod = Number(foundry.utils.getProperty(actor, cfg.saveAttr || "system.attributes.dex.value") ?? 0);
    const { ButtonExecutor } = await import("./button-executor.mjs");
    if (typeof ButtonExecutor?._showRollDialogue !== "function") return "none";
    const res = await ButtonExecutor._showRollDialogue({
      flavor:      cfg.flavor || "Saving Throw",
      baseFormula: `1d20 + ${mod}`,
      advFormula:  cfg.advFormula ? `${cfg.advFormula} + ${mod}` : `2d20kh1 + ${mod}`,
      disFormula:  cfg.disFormula ? `${cfg.disFormula} + ${mod}` : `2d20kl1 + ${mod}`,
      actor
    });
    if (!res || res.cancelled) return null;
    if (res.mode === "advantage")    return "adv";
    if (res.mode === "disadvantage") return "dis";
    return "none";
  } catch (e) {
    console.warn("SD | _askAdvMode failed, defaulting to normal roll:", e);
    return "none";
  }
}

/**
 * Roll a save for a target; returns {passed, total, dc, advMode, rollFormula}.
 *
 * Respects:
 *   cfg.advMode      -- "none" | "adv" | "dis" | "ask"
 *   cfg.advFormula   -- override for the adv d20 core (default 2d20kh1)
 *   cfg.disFormula   -- override for the dis d20 core (default 2d20kl1)
 *   cfg.bonusFormula -- extra term appended to "+ @mod" (e.g. a circumstance bonus)
 */
async function _rollSave(actor, cfg) {
  const dc = Number(cfg.dc ?? 10);
  const attrPath = cfg.saveAttr || "system.attributes.dex.value";
  const mod = Number(foundry.utils.getProperty(actor, attrPath) ?? 0);

  let advMode = String(cfg.advMode ?? "none");
  if (advMode === "ask") {
    const picked = await _askAdvMode(cfg, actor);
    if (picked == null) {
      // player cancelled -- treat as failed save so the mechanic fires noticeably
      return { passed: false, total: 0, dc, advMode: "cancel", rollFormula: "" };
    }
    advMode = picked;
  }

  const core  = _saveCoreFormula(cfg, advMode);
  const bonus = String(cfg.bonusFormula ?? "").trim();
  const rollFormula = `${core} + ${mod}${bonus ? ` + (${bonus})` : ""}`;

  let total = 0;
  let roll = null;
  try {
    roll = new Roll(rollFormula, actor.getRollData?.() ?? {});
    await roll.evaluate();
    total = roll.total;
  } catch (e) {
    console.warn("SD | _rollSave roll evaluation failed, defaulting to fail:", rollFormula, e);
  }
  return { passed: total >= dc, total, dc, advMode, rollFormula, roll };
}

/**
 * Post a save chat card with the actual dice breakdown -- uses
 * `roll.toMessage` so the chat entry looks like a native d20 save roll
 * (with expandable dice tooltip, adv/dis tag, and pass/fail flavor).
 * Falls back to a styled HTML card if the Roll is missing.
 */
async function _postSaveCard(actor, cfg, result) {
  if (!_chatEnabled(cfg)) return;
  const advTag = result?.advMode === "adv" ? " (Adv)"
              : result?.advMode === "dis" ? " (Dis)"
              : "";
  const outcome = result.passed ? "✅ Saved" : "❌ Failed";
  const title   = cfg.effectName || cfg.flavor || "Saving Throw";
  const flavor  = `<strong>${title}</strong>${advTag} — DC ${result.dc} — ${outcome}`;
  const speaker = ChatMessage.getSpeaker({ actor });
  const rollMode = cfg.rollMode || _sdMsgMode();

  if (result.roll) {
    try {
      await result.roll.toMessage({ speaker, flavor, rollMode });
      return;
    } catch (e) {
      console.warn("SD | _postSaveCard toMessage failed, falling back to HTML:", e);
    }
  }

  const html = `
<div class="sd-chat-card sd-save-card" style="background:#f0ebe4;color:#191813;border:1px solid #b5b3a4;border-radius:4px;padding:8px 10px;font-family:'Signika',sans-serif;">
  <header style="background:transparent;color:#191813;font-size:14px;font-weight:600;padding:0 0 6px 0;margin:0 0 8px 0;border-bottom:1px solid #b5b3a4;">
    <strong style="color:#191813;">${title}</strong><span style="color:#555;font-weight:400;margin-left:6px;">${advTag}</span>
  </header>
  <div style="color:#191813;display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;font-size:12px;">
    <span><i class="fas fa-user" style="opacity:.6;margin-right:4px;"></i>${actor.name}</span>
    <span><i class="fas fa-dice-d20" style="opacity:.6;margin-right:4px;"></i>${result.total} vs DC ${result.dc}</span>
    <span style="grid-column:span 2;color:${result.passed ? "#2a7a1a" : "#7a1a1a"};font-weight:600;">${outcome}</span>
  </div>
</div>`;
  const payload = { content: html, ..._chatVisibility(cfg, speaker) };
  try { await ChatMessage.create(payload); } catch {}
}

/**
 * Dispatch "enter" for a region/token pair. Called from updateToken + tick.
 * Returns `true` when the region actually applied something to the token
 * (used by bulk sync to decide whether a fire-and-forget AoE should be
 * deleted once, after the whole membership sweep).
 *
 * `opts.suppressAutoDelete`: when true, skip the per-token region self-delete
 * for persist:false damage/heal AoEs.  Callers that iterate the whole token
 * set (see `_resyncRegionTokens`) must pass this so every token inside the
 * AoE gets hit before the region is torn down -- otherwise the first applied
 * token used to delete the region mid-loop and the rest were skipped.
 */
async function _enterRegion(regionDoc, tokenDoc, opts = {}) {
  const cfg = regionDoc?.flags?.sd?.applyEffect;
  if (!cfg) return false;
  if (cfg.skipOwner) {
    const owner = cfg.ownerTokenId ?? regionDoc.flags?.sd?.aura?.ownerTokenId;
    if (owner && owner === tokenDoc.id) return false;
  }
  if (_regionSuppressed(regionDoc)) return false;
  const actor = tokenDoc?.actor;
  if (!actor) return false;

  const mode = cfg.mode ?? "effect";
  const when = cfg.tickMode ?? "onEnter";
  let didApply = false;

  const autoApply = _shouldAutoApply(cfg);

  switch (mode) {
    case "effect":
      // "effect" mode has no chat card on its own -- when the user wants a
      // manual-apply workflow they'll wrap it in a save-effect instead.
      // So "effect" always applies (otherwise the aura has no observable side effect).
      await _applyNamedEffect(regionDoc, tokenDoc);
      didApply = true;
      break;

    case "damage":
    case "heal": {
      if (when === "eachTurn") return false; // no immediate tick
      const { amount } = await _rollAmount(cfg.formula || "0", actor, cfg, mode, opts.sharedAmount ?? null);
      if (amount) {
        const applied = autoApply
          ? await _applyHpChange(actor, amount, cfg, mode)
          : { delta: amount, preview: true };
        await _postHpCard(actor, cfg, mode, null, applied);
        didApply = true;
      }
      break;
    }

    case "save-effect": {
      if (when === "eachTurn") return false;
      const result = await _rollSave(actor, cfg);
      await _postSaveCard(actor, cfg, result);
      // Only mark "applied" when the effect was actually applied (save failed),
      // otherwise the persist=false auto-delete below would nuke the region
      // and -- via the deleteRegion hook -- strip the effect we just created.
      if (!result.passed) {
        if (autoApply) {
          await _applyNamedEffect(regionDoc, tokenDoc);
        } else {
          await _postApplyEffectButton(actor, regionDoc, cfg);
        }
        didApply = true;
      }
      break;
    }
  }

  // Fire-and-forget AoEs: persist=false + damage/heal delete the region after
  // the first successful application so it doesn't keep ticking.  save-effect
  // is excluded on purpose -- its effect is tagged with `flags.sd.fromRegion`
  // and the deleteRegion hook strips every effect with that tag, which would
  // wipe the effect we just applied.  Save-effect AoEs rely on the `rounds`
  // lifetime or manual removal instead.
  //
  // When the caller is doing a bulk membership sweep (e.g. just after
  // `createRegion` -- every token inside the freshly placed AoE is about to
  // get _enterRegion called) the deletion is deferred to the end of the
  // sweep so every token inside receives the effect.  Walk-in through an
  // existing AoE still self-deletes on first contact.
  if (
    !opts.suppressAutoDelete &&
    didApply &&
    cfg.persist === false &&
    !regionDoc?.flags?.sd?.aura &&
    (mode === "damage" || mode === "heal") &&
    game.user?.isGM
  ) {
    try { await regionDoc.delete(); } catch {}
  }

  return didApply;
}

/** Dispatch "exit" for a region/token pair. */
async function _exitRegion(regionDoc, tokenDoc) {
  const cfg = regionDoc?.flags?.sd?.applyEffect;
  if (!cfg) return;
  const mode = cfg.mode ?? "effect";
  if ((mode === "effect" || mode === "save-effect") && cfg.deactivateOnLeave !== false) {
    await _removeNamedEffect(regionDoc, tokenDoc);
  }
}

/** Tick a single token against a region. Shared by combat-turn tick. */
async function _tickTokenInRegion(regionDoc, tokenDoc) {
  const cfg = regionDoc?.flags?.sd?.applyEffect;
  if (!cfg) return;
  if (_regionSuppressed(regionDoc)) return;
  const when = cfg.tickMode ?? "onEnter";
  if (when === "onEnter") return;
  if (!_tokenInside(regionDoc, tokenDoc)) return;
  if (cfg.skipOwner) {
    const owner = cfg.ownerTokenId ?? regionDoc.flags?.sd?.aura?.ownerTokenId;
    if (owner && owner === tokenDoc.id) return;
  }
  const actor = tokenDoc.actor;
  if (!actor) return;
  const mode = cfg.mode ?? "effect";
  const autoApply = _shouldAutoApply(cfg);
  if (mode === "effect") {
    await _applyNamedEffect(regionDoc, tokenDoc);
  } else if (mode === "damage" || mode === "heal") {
    // Per-turn ticks only ever touch one token, so rollApplyMode="once"
    // collapses to the same behaviour as per-target here.  The shared-roll
    // semantic applies to the initial placement sweep (_resyncRegionTokens).
    const { amount } = await _rollAmount(cfg.formula || "0", actor, cfg, mode);
    if (!amount) return;
    const applied = autoApply
      ? await _applyHpChange(actor, amount, cfg, mode)
      : { delta: amount, preview: true };
    await _postHpCard(actor, cfg, mode, null, applied);
  } else if (mode === "save-effect") {
    const result = await _rollSave(actor, cfg);
    await _postSaveCard(actor, cfg, result);
    if (!result.passed) {
      if (autoApply) await _applyNamedEffect(regionDoc, tokenDoc);
      else           await _postApplyEffectButton(actor, regionDoc, cfg);
    }
  }
}

/** Decrement region lifetime (rounds) and delete when it expires. */
async function _ageRegionsForCombatant(combat) {
  const scene = combat.scene ?? canvas.scene;
  if (!scene) return;
  const toDelete = [];
  for (const region of (scene.regions ?? [])) {
    const cfg = region?.flags?.sd?.applyEffect;
    if (!cfg) continue;
    const remaining = Number(cfg.roundsRemaining ?? 0);
    if (!remaining) continue;
    const nextRem = remaining - 1;
    if (nextRem <= 0) toDelete.push(region.id);
    else {
      try {
        await region.update({ "flags.sd.applyEffect.roundsRemaining": nextRem });
      } catch {}
    }
  }
  if (toDelete.length) {
    try { await scene.deleteEmbeddedDocuments("Region", toDelete); } catch {}
  }
}

/** Recompute membership for a token's regions; fire enter/exit transitions. */
async function _resyncTokenRegions(tokenDoc) {
  if (!game.user?.isGM) return;
  const scene = tokenDoc?.parent;
  if (!scene) return;
  for (const region of (scene.regions ?? [])) {
    if (!region?.flags?.sd?.applyEffect) continue;
    const inside = _tokenInside(region, tokenDoc);
    const cacheKey = `${region.id}:${tokenDoc.id}`;
    const was = _membershipCache.has(cacheKey);
    if (inside && !was) {
      _membershipCache.add(cacheKey);
      await _enterRegion(region, tokenDoc);
    } else if (!inside && was) {
      _membershipCache.delete(cacheKey);
      await _exitRegion(region, tokenDoc);
    } else if (!inside) {
      // Make sure any legacy effect from this region is cleared.
      await _exitRegion(region, tokenDoc);
    }
  }
}

/** Recompute membership for every token vs this region (after create/update). */
async function _resyncRegionTokens(regionDoc) {
  if (!game.user?.isGM) return;
  const cfg = regionDoc?.flags?.sd?.applyEffect;
  if (!cfg) return;
  const scene = regionDoc?.parent;
  if (!scene) return;

  // Shared-roll mode: roll the formula once for the whole sweep so every
  // token inside takes the same base amount (resistances still apply per
  // actor inside _rollAmount).
  let sharedAmount = null;
  if (
    (cfg.rollApplyMode === "once") &&
    (cfg.mode === "damage" || cfg.mode === "heal") &&
    cfg.formula
  ) {
    sharedAmount = await _rollSharedAmount(cfg);
  }

  let anyApplied = false;
  for (const token of (scene.tokens ?? [])) {
    const inside = _tokenInside(regionDoc, token);
    const cacheKey = `${regionDoc.id}:${token.id}`;
    const was = _membershipCache.has(cacheKey);
    if (inside && !was) {
      _membershipCache.add(cacheKey);
      // Suppress per-token self-delete so every token inside the region
      // receives the effect before the region tears itself down (see
      // `_enterRegion` + Bug #2 in the patch notes).
      const applied = await _enterRegion(regionDoc, token, {
        suppressAutoDelete: true,
        sharedAmount
      });
      if (applied) anyApplied = true;
    } else if (!inside && was) {
      _membershipCache.delete(cacheKey);
      await _exitRegion(regionDoc, token);
    }
  }

  // End-of-sweep fire-and-forget delete for AoE damage/heal regions.
  // Auras (flags.sd.aura) are persistent by design and never auto-delete
  // from bulk sync; save-effect regions are excluded for the same reason
  // as in `_enterRegion` (deleteRegion would strip the just-applied effect).
  if (
    anyApplied &&
    cfg.persist === false &&
    !regionDoc?.flags?.sd?.aura &&
    (cfg.mode === "damage" || cfg.mode === "heal") &&
    game.user?.isGM
  ) {
    try { await regionDoc.delete(); } catch {}
  }
}

/** In-memory membership cache so we fire enter/exit exactly once per boundary. */
const _membershipCache = new Set();

let _hooksInstalled = false;

function _installHooks() {
  if (_hooksInstalled) return;
  _hooksInstalled = true;

  // Token moved / changed shape → re-check its region membership.
  // Additionally: if the moving token owns an aura-region, the region moved
  // with it (attached regions follow their token), so we must resync that
  // region against every other token on the scene -- otherwise stationary
  // tokens the aura just swept over never fire _enterRegion and the aura's
  // effect / damage / heal / save never triggers.
  Hooks.on("updateToken", async (tokenDoc, changes) => {
    if (!game.user?.isGM) return;
    const moved = ["x", "y", "width", "height", "hidden", "elevation"].some(k => k in changes);
    if (!moved) return;
    await _resyncTokenRegions(tokenDoc);

    const scene = tokenDoc?.parent;
    if (!scene) return;

    // When the owner token's footprint changes (width/height/shape), the
    // stored emanation `base` is stale -- rebuild it before resync so the
    // aura's tested radius reflects the new token size.  Pure x/y/elevation
    // moves don't need a rebuild, they're reflected in region.tokens via
    // the token reference already.
    const footprintChanged = ["width", "height", "shape"].some(k => k in changes);

    for (const region of (scene.regions ?? [])) {
      const aura = region?.flags?.sd?.aura;
      if (!aura) continue;
      if (aura.ownerTokenId !== tokenDoc.id) continue;

      if (footprintChanged) {
        try {
          const radiusFt = Number(aura.radiusFt ?? region?.flags?.sd?.applyEffect?.auraRadiusFt ?? 0);
          if (radiusFt > 0 && Array.isArray(region.shapes) && region.shapes[0]?.type === "emanation") {
            const fresh = buildEmanationShape(tokenDoc, radiusFt);
            const shapes = [fresh, ...region.shapes.slice(1)];
            await region.update({ shapes });
          }
        } catch (e) {
          console.warn("SD | aura emanation rebuild failed:", e);
        }
      }

      await _resyncRegionTokens(region);
    }
  });

  // Region created/edited → push effects and run enter dispatch.
  // NOTE: non-persist AoEs (persist=false) are NOT auto-deleted on create --
  // they would vanish before any token had a chance to enter.  Instead we
  // delete inside `_enterRegion` once the first application has fired.
  //
  // On the very first createRegion, the PIXI placeable isn't yet rendered, so
  // `regionDoc.object.testPoint` / `regionDoc.tokens` are empty.  Re-run the
  // sync a few times while the canvas settles so stationary tokens caught by
  // the freshly-placed shape get the enter-dispatch immediately.
  Hooks.on("createRegion", async (regionDoc) => {
    await _resyncRegionTokens(regionDoc);
    for (const delay of [50, 200, 500]) {
      setTimeout(() => { _resyncRegionTokens(regionDoc).catch(() => {}); }, delay);
    }
  });
  Hooks.on("updateRegion", async (regionDoc) => { await _resyncRegionTokens(regionDoc); });

  // canvasReady / ready → populate _membershipCache from ground truth so the
  // first post-reload token move doesn't spuriously trigger enter-handlers.
  const rehydrate = () => {
    if (!game.user?.isGM) return;
    // Clear stale entries before repopulating -- otherwise scene changes leave
    // stray region:token keys that trigger spurious exit handlers on return.
    _membershipCache.clear();
    const scene = canvas.scene;
    if (!scene) return;
    for (const region of (scene.regions ?? [])) {
      if (!region?.flags?.sd?.applyEffect) continue;
      for (const token of (scene.tokens ?? [])) {
        if (_tokenInside(region, token)) {
          _membershipCache.add(`${region.id}:${token.id}`);
        }
      }
    }
  };
  Hooks.once("canvasReady", rehydrate);
  Hooks.on("canvasReady", rehydrate);

  // Region deleted → clear lingering flagged effects from every actor on scene.
  // Honours `deactivateOnLeave` -- when the author wants effects to persist
  // after the region is gone (e.g. a one-shot save-effect AoE that should
  // leave lasting conditions on failing tokens), effects are kept intact.
  Hooks.on("deleteRegion", async (regionDoc) => {
    if (!game.user?.isGM) return;
    const scene = regionDoc?.parent;
    if (!scene) return;
    const rid = regionDoc.id;
    for (const cacheKey of [..._membershipCache]) {
      if (cacheKey.startsWith(`${rid}:`)) _membershipCache.delete(cacheKey);
    }
    const cfg = regionDoc?.flags?.sd?.applyEffect;
    const keepEffects = cfg && cfg.deactivateOnLeave === false;
    if (keepEffects) return;
    for (const tok of (scene.tokens ?? [])) {
      const a = tok.actor;
      if (!a) continue;
      const ids = a.effects.filter(e => e.flags?.sd?.fromRegion === rid).map(e => e.id);
      if (ids.length) {
        try { await a.deleteEmbeddedDocuments("ActiveEffect", ids); } catch {}
      }
    }
  });

  // Combat turn → tick eachTurn-mode regions that the current token is inside,
  //               age region lifetimes once per full round boundary.
  Hooks.on("updateCombat", async (combat, changes /* userId arg in some builds */) => {
    if (!game.user?.isGM) return;
    const turnChanged  = ("turn"  in changes);
    const roundChanged = ("round" in changes);
    if (!turnChanged && !roundChanged) return;

    const scene = combat.scene ?? canvas.scene;
    if (!scene) return;
    const currentToken = combat.combatant?.token;
    if (currentToken) {
      for (const region of (scene.regions ?? [])) {
        if (!region?.flags?.sd?.applyEffect) continue;
        await _tickTokenInRegion(region, currentToken);
      }
    }
    if (roundChanged) await _ageRegionsForCombatant(combat);
  });
}

let _registered = false;

export const SDRegion = {
  /** Kept as a public constant for legacy callers (button-executor etc.). */
  TYPE: "sd.applyEffect",

  register() {
    if (_registered) return;
    _registered = true;
    _installHooks();
  },

  /**
   * Public: apply the region's named effect to a specific actor.
   * Used by the "Apply Effect" chat-card button for save-effect regions
   * running in applyMode:"card".  Resolves the region from scene+region
   * id so stale chat messages still work after scene switches.
   */
  async applyRegionEffect({ sceneId, regionId, actorId }) {
    const scene = game.scenes?.get(sceneId) ?? canvas.scene;
    const regionDoc = scene?.regions?.get(regionId);
    if (!regionDoc) {
      ui.notifications?.warn("SD | Region not found (deleted?).");
      return false;
    }
    const tokenDoc = scene?.tokens?.find(t => t.actor?.id === actorId);
    if (!tokenDoc) {
      ui.notifications?.warn("SD | Target token not found on scene.");
      return false;
    }
    try {
      await _applyNamedEffect(regionDoc, tokenDoc);
      return true;
    } catch (e) {
      console.warn("SD | applyRegionEffect failed:", e);
      return false;
    }
  }
};
