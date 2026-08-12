function _sceneGridFeet() {
  return Number(canvas?.scene?.grid?.distance ?? 5) || 5;
}

function _sceneGridPx() {
  return Number(canvas?.scene?.grid?.size ?? 100) || 100;
}

function _scenePxPerFoot() {
  return _sceneGridPx() / _sceneGridFeet();
}

function _gridIsHex() {
  const t = canvas?.scene?.grid?.type ?? 0;
  return t >= 2;
}

function _hexIsColumnar() {
  const t = canvas?.scene?.grid?.type ?? 0;
  return t === 2 || t === 3;
}

function _findSourceToken(actorOrToken) {
  if (!actorOrToken) {
    const ctrl = canvas?.tokens?.controlled?.[0];
    if (ctrl) return ctrl;
    return null;
  }
  if (typeof actorOrToken === "string") {
    const tid = actorOrToken.trim();
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

function _moveCollision(p1, p2) {
  try {
    const cfgBackends = globalThis?.CONFIG?.Canvas?.polygonBackends;
    if (cfgBackends?.move?.testCollision) {
      return cfgBackends.move.testCollision(p1, p2, { mode: "any", type: "move" });
    }
    const RayCls = globalThis?.foundry?.canvas?.geometry?.Ray ?? globalThis?.Ray;
    if (canvas?.walls?.checkCollision && RayCls) {
      const ray = new RayCls(p1, p2);
      return !!canvas.walls.checkCollision(ray, { type: "move", mode: "any" });
    }
  } catch (e) {
    console.warn("SD | move collision check failed:", e);
  }
  return false;
}

function _hexDirVector(idx) {
  const i = ((Math.floor(Number(idx)) % 6) + 6) % 6;
  const angles = _hexIsColumnar()
    ? [-30, 30, 90, 150, 210, 270]
    : [-90, -30, 30, 90, 150, 210];
  const rad = angles[i] * Math.PI / 180;
  return { dx: Math.cos(rad), dy: Math.sin(rad) };
}

function _squareDirVector(idx) {
  const dirs = [
    { dx: 0,  dy: -1 },
    { dx: 1,  dy: -1 },
    { dx: 1,  dy: 0  },
    { dx: 1,  dy: 1  },
    { dx: 0,  dy: 1  },
    { dx: -1, dy: 1  },
    { dx: -1, dy: 0  },
    { dx: -1, dy: -1 }
  ];
  const i = ((Math.floor(Number(idx)) % 8) + 8) % 8;
  return dirs[i];
}


export async function sdMoveToken({ source, distanceFt, mode = "degrees", direction = 0, passWalls = false, animate = true }) {
  try {
    const src = _findSourceToken(source);
    if (!src || !canvas?.scene) return { ok: false, reason: "no-token" };

    const pxPerFt = _scenePxPerFoot();
    const gridFt  = _sceneGridFeet();
    const gridPx  = _sceneGridPx();
    const dist    = Math.max(0, Number(distanceFt) || 0);
    if (dist <= 0) return { ok: false, reason: "zero-distance" };

    let dxPx = 0, dyPx = 0;

    if (mode === "hex" && _gridIsHex()) {
      const steps = Math.max(1, Math.round(dist / gridFt));
      const v = _hexDirVector(direction);
      dxPx = v.dx * gridPx * steps;
      dyPx = v.dy * gridPx * steps;
    } else if (mode === "square") {
      const steps = Math.max(1, Math.round(dist / gridFt));
      const v = _squareDirVector(direction);
      dxPx = v.dx * gridPx * steps;
      dyPx = v.dy * gridPx * steps;
    } else {
      const deg = Number(direction) || 0;
      const rad = (deg - 90) * Math.PI / 180;
      dxPx = Math.cos(rad) * dist * pxPerFt;
      dyPx = Math.sin(rad) * dist * pxPerFt;
    }

    const cx = src.center?.x ?? src.x ?? 0;
    const cy = src.center?.y ?? src.y ?? 0;

    if (!passWalls && _moveCollision({ x: cx, y: cy }, { x: cx + dxPx, y: cy + dyPx })) {
      ui?.notifications?.warn?.(`Move Token: path blocked by walls.`);
      return { ok: false, reason: "wall-blocked" };
    }

    const newX = (src.document?.x ?? src.x ?? 0) + dxPx;
    const newY = (src.document?.y ?? src.y ?? 0) + dyPx;

    await src.document.update({ x: newX, y: newY }, { animate });
    return { ok: true, dx: dxPx, dy: dyPx };
  } catch (e) {
    console.warn("SD | sdMoveToken error:", e);
    return { ok: false, reason: String(e?.message ?? e) };
  }
}
