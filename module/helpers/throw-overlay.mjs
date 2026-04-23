/**
 * module/helpers/throw-overlay.mjs -- System Director dice-throw overlays
 *
 * Lightweight PIXI / DOM visualisations used by `act_throw_on_canvas` and
 * `act_throw_on_sheet`.  No persistent documents are created -- the overlays
 * live for `duration` seconds, fade, and are removed.
 */

export const ThrowOverlay = {

  /** Scatter a set of dice faces as PIXI sprites on the active scene. */
  scatterOnCanvas(faces, die, { area = 300, duration = 6, actor = null } = {}) {
    if (!canvas?.ready || !canvas.stage) return;

    const origin = _originFromActor(actor) ?? {
      x: canvas.stage.pivot.x,
      y: canvas.stage.pivot.y
    };

    const layer = canvas.controls ?? canvas.stage;
    const container = new PIXI.Container();
    container.zIndex = 9999;
    container.sortableChildren = true;
    layer.addChild(container);

    const half = Math.max(40, area / 2);
    for (const face of faces) {
      const sprite = _makeDiceSprite(face, die);
      sprite.x = origin.x + (Math.random() * area - half);
      sprite.y = origin.y + (Math.random() * area - half);
      sprite.alpha = 0;
      container.addChild(sprite);
      _fadeIn(sprite);
    }

    setTimeout(() => _fadeOutAndRemove(container), Math.max(1000, duration * 1000));
  },

  /** Scatter a set of dice faces as DOM nodes over the actor's open sheet. */
  scatterOnSheet(faces, die, { duration = 6, actor = null } = {}) {
    const sheetEl = _findSheetElement(actor);
    if (!sheetEl) return;

    const overlay = document.createElement("div");
    overlay.className = "sd-throw-overlay";
    Object.assign(overlay.style, {
      position: "absolute", inset: "0", pointerEvents: "none", zIndex: "9999"
    });
    // Ensure host is positioned so absolute children anchor correctly.
    const prevPos = getComputedStyle(sheetEl).position;
    if (prevPos === "static") sheetEl.style.position = "relative";
    sheetEl.appendChild(overlay);

    const rect = sheetEl.getBoundingClientRect();
    for (const face of faces) {
      const el = _makeDieElement(face, die);
      const left = Math.random() * (rect.width  - 48);
      const top  = Math.random() * (rect.height - 48);
      Object.assign(el.style, {
        left: `${left}px`, top: `${top}px`,
        opacity: "0", transition: "opacity 300ms ease-in"
      });
      overlay.appendChild(el);
      requestAnimationFrame(() => { el.style.opacity = "1"; });
    }

    setTimeout(() => {
      overlay.style.transition = "opacity 400ms ease-out";
      overlay.style.opacity = "0";
      setTimeout(() => overlay.remove(), 450);
    }, Math.max(1000, duration * 1000));
  }
};

/* ─── helpers ─────────────────────────────────────────────────────────── */

function _originFromActor(actor) {
  if (!actor) return null;
  const token = actor.getActiveTokens?.()?.[0];
  if (token?.center) return { x: token.center.x, y: token.center.y };
  return null;
}

function _makeDiceSprite(face, die) {
  const g = new PIXI.Graphics();
  g.lineStyle(2, 0x000000, 1);
  g.beginFill(_colorForDie(die));
  g.drawRoundedRect(-24, -24, 48, 48, 6);
  g.endFill();

  const text = new PIXI.Text(String(face), {
    fontFamily: "sans-serif",
    fontSize: 22,
    fontWeight: "bold",
    fill: 0xffffff,
    stroke: 0x000000,
    strokeThickness: 3
  });
  text.anchor.set(0.5);
  g.addChild(text);
  return g;
}

function _makeDieElement(face, die) {
  const el = document.createElement("div");
  el.className = "sd-throw-die";
  el.textContent = String(face);
  Object.assign(el.style, {
    position:        "absolute",
    width:           "48px",
    height:          "48px",
    lineHeight:      "48px",
    textAlign:       "center",
    background:      _cssColorForDie(die),
    color:           "#fff",
    border:          "2px solid #000",
    borderRadius:    "6px",
    fontWeight:      "bold",
    fontSize:        "22px",
    textShadow:      "0 0 3px #000",
    boxShadow:       "0 2px 6px rgba(0,0,0,0.4)",
    transform:       `rotate(${(Math.random() * 40 - 20).toFixed(1)}deg)`
  });
  return el;
}

function _colorForDie(die) {
  switch (die) {
    case 4:  return 0xb23a48;
    case 6:  return 0x3a78b2;
    case 8:  return 0x3ab25e;
    case 10: return 0xb2893a;
    case 12: return 0x8a3ab2;
    case 20: return 0xb2b23a;
    default: return 0x555555;
  }
}

function _cssColorForDie(die) {
  const c = _colorForDie(die);
  return "#" + c.toString(16).padStart(6, "0");
}

function _fadeIn(sprite) {
  const step = () => {
    sprite.alpha = Math.min(1, sprite.alpha + 0.08);
    if (sprite.alpha < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function _fadeOutAndRemove(container) {
  const step = () => {
    container.alpha = Math.max(0, (container.alpha ?? 1) - 0.04);
    if (container.alpha > 0) requestAnimationFrame(step);
    else {
      try { container.parent?.removeChild(container); container.destroy({ children: true }); } catch {}
    }
  };
  requestAnimationFrame(step);
}

function _findSheetElement(actor) {
  if (!actor?.sheet?.rendered) return null;
  const raw = actor.sheet.element;
  if (!raw) return null;
  const el = raw.jquery ? raw[0] : raw;
  return el?.querySelector?.(".window-content") ?? el;
}
