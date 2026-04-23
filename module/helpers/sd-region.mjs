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

// Resolve a damage/heal formula, honouring resistance for damage
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

function _chatEnabled(cfg) {
  if (cfg?.showInChat === false) return false;
  if (cfg?.showInChat === true)  return true;
  return (cfg?.chatMode ?? "auto") === "card";
}

function _shouldAutoApply(cfg) {
  const am = cfg?.applyMode;
  if (am === "auto") return true;
  if (am === "card") return false;
  const cm = cfg?.chatMode;
  if (cm === "card") return false;
  if (cm === "auto") return true;
  return true;
}

async function _postHpCard(actor, cfg, kind, roll, applied) {
  if (!_chatEnabled(cfg)) return;
  const isHeal = kind === "heal";
  const { ButtonExecutor } = await import("./button-executor.mjs");
  const label = cfg.effectName
    ? `${cfg.effectName}${cfg.damageType ? ` (${cfg.damageType})` : ""}`
    : (isHeal ? "Healing" : `Damage${cfg.damageType ? ` (${cfg.damageType})` : ""}`);

  const autoApplied = _shouldAutoApply(cfg);

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

function _saveCoreFormula(cfg, advMode) {
  const strip = (f) => String(f ?? "").trim();
  if (advMode === "adv") return strip(cfg.advFormula) || "2d20kh1";
  if (advMode === "dis") return strip(cfg.disFormula) || "2d20kl1";
  return "1d20";
}

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

  // Fire-and-forget AoEs
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

  // End-of-sweep fire-and-forget delete for AoE damage/heal regions
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

  // Token moved / changed shape → re-check its region membership
  Hooks.on("updateToken", async (tokenDoc, changes) => {
    if (!game.user?.isGM) return;
    const moved = ["x", "y", "width", "height", "hidden", "elevation"].some(k => k in changes);
    if (!moved) return;
    await _resyncTokenRegions(tokenDoc);

    const scene = tokenDoc?.parent;
    if (!scene) return;

    // When the owner token's footprint changes (width/height/shape), the
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

  // Region created/edited → push effects and run enter dispatch
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

  // Region deleted → clear lingering flagged effects from every actor on scene
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
