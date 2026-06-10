function _scenePxPerFoot() {
  const scene = canvas?.scene;
  if (!scene) return 1;
  const gridDist = Number(scene.grid?.distance ?? 5) || 5;
  const gridSize = Number(scene.grid?.size ?? 100)   || 100;
  return gridSize / gridDist;
}

function _normaliseDeg(a) {
  return ((Number(a) % 360) + 360) % 360;
}

function _signedAngularDiff(a, b) {
  const d = _normaliseDeg(a - b);
  return d > 180 ? d - 360 : d;
}

function _looksLikeUuid(s) {
  if (typeof s !== "string") return false;
  return /^(Actor|Scene|Item|Token|Compendium)[.][A-Za-z0-9._-]+/.test(s);
}

function _resolveDocByUuid(uuid) {
  try {
    if (typeof fromUuidSync === "function") return fromUuidSync(uuid) ?? null;
  } catch {}
  return null;
}

function _findSourceToken(actorOrToken) {
  if (!actorOrToken) {
    const ctrl = canvas?.tokens?.controlled?.[0];
    if (ctrl) return ctrl;
    const target = [...(game?.user?.targets ?? [])][0];
    if (target) return target;
    return null;
  }
  if (typeof actorOrToken === "string") {
    let tid = actorOrToken.trim();
    if (tid.length >= 2 && tid.startsWith('"') && tid.endsWith('"')) tid = tid.slice(1, -1);
    if (!tid) return null;

    if (_looksLikeUuid(tid)) {
      const doc = _resolveDocByUuid(tid);
      if (doc?.documentName === "Token") {
        return doc.object ?? canvas?.tokens?.get?.(doc.id) ?? null;
      }
      if (doc?.documentName === "Actor") {
        return doc.getActiveTokens?.()?.[0] ?? null;
      }
      if (doc?.actor && typeof doc.actor.getActiveTokens === "function") {
        return doc.actor.getActiveTokens()?.[0] ?? null;
      }
      return null;
    }

    const tk = canvas?.tokens?.get?.(tid);
    if (tk) return tk;
    const a = game?.actors?.get?.(tid);
    if (a) return a.getActiveTokens?.()?.[0] ?? null;
    return null;
  }
  if (actorOrToken?.documentName === "Token") return actorOrToken.object ?? actorOrToken;
  if (actorOrToken?.actor && actorOrToken?.center) return actorOrToken;
  if (typeof actorOrToken?.getActiveTokens === "function") {
    return actorOrToken.getActiveTokens()?.[0] ?? null;
  }
  return null;
}

function _sightCollision(p1, p2) {
  try {
    const cfgBackends = globalThis?.CONFIG?.Canvas?.polygonBackends;
    if (cfgBackends?.sight?.testCollision) {
      return cfgBackends.sight.testCollision(p1, p2, { mode: "any", type: "sight" });
    }
    const RayCls = globalThis?.foundry?.canvas?.geometry?.Ray ?? globalThis?.Ray;
    if (canvas?.walls?.checkCollision && RayCls) {
      const ray = new RayCls(p1, p2);
      return !!canvas.walls.checkCollision(ray, { type: "sight", mode: "any" });
    }
  } catch (e) {
    console.warn("SD | sight collision check failed:", e);
  }
  return false;
}


export function sdComputeVisibleTokens({ source, distanceFt, angleDeg, requireLOS = true, includeHidden = false }) {
  return sdComputeVisible({ source, distanceFt, angleDeg, requireLOS, includeHidden }).tokenIds;
}

export function sdComputeVisibleActorUuids({ source, distanceFt, angleDeg, requireLOS = true, includeHidden = false }) {
  return sdComputeVisible({ source, distanceFt, angleDeg, requireLOS, includeHidden }).actorUuids;
}

export function sdComputeVisible({ source, distanceFt, angleDeg, requireLOS = true, includeHidden = false }) {
  const empty = { tokenIds: [], actorUuids: [], sourceTokenId: "", sourceActorUuid: "" };
  try {
    const src = _findSourceToken(source);
    if (!src || !canvas?.tokens) return empty;

    const sx = src.center?.x ?? src.x ?? 0;
    const sy = src.center?.y ?? src.y ?? 0;
    const pxPerFt = _scenePxPerFoot();
    const radiusPx = Math.max(0, Number(distanceFt) || 0) * pxPerFt;
    if (radiusPx <= 0) return {
      ...empty,
      sourceTokenId: src.id ?? "",
      sourceActorUuid: src.actor?.uuid ?? ""
    };

    const facing = Number(src.document?.rotation ?? src.rotation ?? 0) || 0;
    const ang = Math.max(0, Math.min(360, Number(angleDeg) || 360));
    const halfAng = ang / 2;

    const tokenIds = [];
    const actorUuids = [];
    for (const t of canvas.tokens.placeables ?? []) {
      if (!t || t === src) continue;
      if (!t.actor) continue;
      if (!includeHidden && t.document?.hidden && !game.user?.isGM) continue;

      const tx = t.center?.x ?? t.x ?? 0;
      const ty = t.center?.y ?? t.y ?? 0;
      const dx = tx - sx;
      const dy = ty - sy;
      if (Math.hypot(dx, dy) > radiusPx) continue;

      if (ang < 360) {
        const tokenDirDeg = _normaliseDeg(Math.atan2(dy, dx) * 180 / Math.PI + 90);
        const diff = Math.abs(_signedAngularDiff(tokenDirDeg, facing));
        if (diff > halfAng) continue;
      }

      if (requireLOS && _sightCollision({ x: sx, y: sy }, { x: tx, y: ty })) continue;

      tokenIds.push(t.id);
      const auuid = t.actor?.uuid ?? "";
      if (auuid) actorUuids.push(auuid);
    }
    return {
      tokenIds,
      actorUuids,
      sourceTokenId: src.id ?? "",
      sourceActorUuid: src.actor?.uuid ?? ""
    };
  } catch (e) {
    console.warn("SD | sdComputeVisible error:", e);
    return empty;
  }
}


export function sdShowVisionRay({ source, distanceFt, angleDeg = 360, color = "#74a7ff", durationMs = 2000 } = {}) {
  try {
    const src = _findSourceToken(source);
    if (!src || !canvas?.ready) return;

    const ox = src.center?.x ?? src.x ?? 0;
    const oy = src.center?.y ?? src.y ?? 0;
    const pxPerFt = _scenePxPerFoot();
    const radiusPx = Math.max(0, Number(distanceFt) || 0) * pxPerFt;
    if (radiusPx <= 0) return;

    const facing = Number(src.document?.rotation ?? src.rotation ?? 0) || 0;
    const ang = Math.max(0, Math.min(360, Number(angleDeg) || 360));

    const layer = canvas.controls ?? canvas.effects ?? canvas.tokens ?? canvas.stage;
    if (!layer) return;

    const fillCol = parseInt(String(color).replace(/^#/, ""), 16) || 0x74a7ff;

    const g = new PIXI.Graphics();
    g.lineStyle({ width: 2, color: fillCol, alpha: 0.7 });
    g.beginFill(fillCol, 0.18);

    if (ang >= 360) {
      g.drawCircle(0, 0, radiusPx);
    } else {
      const halfRad = (ang / 2) * Math.PI / 180;
      const centerRad = (facing - 90) * Math.PI / 180;
      const start = centerRad - halfRad;
      const end   = centerRad + halfRad;
      g.moveTo(0, 0);
      g.lineTo(Math.cos(start) * radiusPx, Math.sin(start) * radiusPx);
      g.arc(0, 0, radiusPx, start, end, false);
      g.lineTo(0, 0);
      g.closePath();
    }
    g.endFill();
    g.position.set(ox, oy);
    layer.addChild(g);

    const dur = Math.max(100, Number(durationMs) || 2000);
    let elapsed = 0;
    const tickMs = 50;
    const fadeStart = dur - 400;
    const timer = setInterval(() => {
      elapsed += tickMs;
      if (elapsed >= fadeStart) {
        const left = Math.max(0, dur - elapsed);
        g.alpha = Math.max(0, left / 400);
      }
      if (elapsed >= dur) {
        clearInterval(timer);
        try { g.parent?.removeChild(g); g.destroy(); } catch {}
      }
    }, tickMs);
  } catch (e) {
    console.warn("SD | sdShowVisionRay error:", e);
  }
}
