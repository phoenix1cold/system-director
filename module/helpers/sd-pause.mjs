const SD_PAUSE_SVG = `
<svg class="sd-pause-cube" xmlns="http://www.w3.org/2000/svg" viewBox="-130 -130 260 260" aria-hidden="true">
  <defs>
    <radialGradient id="sdp-bg" cx="0" cy="0" r="125" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#1ea8ff" stop-opacity="0.65"/>
      <stop offset="55%" stop-color="#0a3a66" stop-opacity="0.30"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="sdp-tri" x1="0" y1="-40" x2="0" y2="45" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#2bb6ff" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="#0a76d4" stop-opacity="0.20"/>
    </linearGradient>
    <filter id="sdp-glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="2.5" result="b1"/>
      <feGaussianBlur stdDeviation="6"   in="SourceGraphic" result="b2"/>
      <feMerge>
        <feMergeNode in="b2"/>
        <feMergeNode in="b1"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
    <filter id="sdp-glow-strong" x="-80%" y="-80%" width="260%" height="260%">
      <feGaussianBlur stdDeviation="4"  result="b1"/>
      <feGaussianBlur stdDeviation="10" in="SourceGraphic" result="b2"/>
      <feMerge>
        <feMergeNode in="b2"/>
        <feMergeNode in="b1"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>

  <circle class="sd-pause-bg" r="120" fill="url(#sdp-bg)"/>

  <g class="sd-pause-spin" filter="url(#sdp-glow)" stroke="#3ec3ff" stroke-linecap="round" stroke-linejoin="round" fill="none">
    <polygon points="0,-100 86.6,-50 86.6,50 0,100 -86.6,50 -86.6,-50" stroke-width="2.6"/>
    <g stroke-width="1.4" opacity="0.95">
      <line x1="0"     y1="-100" x2="50"    y2="-20"/>
      <line x1="0"     y1="-100" x2="-50"   y2="-20"/>
      <line x1="86.6"  y1="-50"  x2="50"    y2="-20"/>
      <line x1="86.6"  y1="-50"  x2="50"    y2="35"/>
      <line x1="86.6"  y1="50"   x2="50"    y2="35"/>
      <line x1="86.6"  y1="50"   x2="0"     y2="55"/>
      <line x1="0"     y1="100"  x2="0"     y2="55"/>
      <line x1="0"     y1="100"  x2="-50"   y2="35"/>
      <line x1="-86.6" y1="50"   x2="-50"   y2="35"/>
      <line x1="-86.6" y1="50"   x2="-50"   y2="-20"/>
      <line x1="-86.6" y1="-50"  x2="-50"   y2="-20"/>
      <line x1="-86.6" y1="-50"  x2="50"    y2="-20"/>
      <line x1="86.6"  y1="-50"  x2="-50"   y2="-20"/>
      <line x1="86.6"  y1="50"   x2="-50"   y2="35"/>
      <line x1="-86.6" y1="50"   x2="50"    y2="35"/>
      <line x1="-86.6" y1="-50"  x2="50"    y2="35"/>
      <line x1="0"     y1="-100" x2="0"     y2="55"/>
      <line x1="0"     y1="100"  x2="50"    y2="-20"/>
      <line x1="0"     y1="100"  x2="-50"   y2="-20"/>
    </g>
    <polygon class="sd-pause-tri" points="-50,-20 50,-20 0,55"
             fill="url(#sdp-tri)" stroke="#5fd5ff" stroke-width="2.2"/>
    <g class="sd-pause-nodes" fill="#7fe2ff" stroke="none" filter="url(#sdp-glow-strong)">
      <circle cx="0"     cy="-100" r="3.2"/>
      <circle cx="86.6"  cy="-50"  r="3.2"/>
      <circle cx="86.6"  cy="50"   r="3.2"/>
      <circle cx="0"     cy="100"  r="3.2"/>
      <circle cx="-86.6" cy="50"   r="3.2"/>
      <circle cx="-86.6" cy="-50"  r="3.2"/>
      <circle cx="50"    cy="-20"  r="2.6"/>
      <circle cx="-50"   cy="-20"  r="2.6"/>
      <circle cx="50"    cy="35"   r="2.6"/>
      <circle cx="-50"   cy="35"   r="2.6"/>
      <circle cx="0"     cy="55"   r="2.6"/>
    </g>
  </g>

  <text class="sd-pause-text" x="0" y="14" text-anchor="middle"
        font-family="'Orbitron','Eurostile','Bank Gothic','Arial Black',sans-serif"
        font-weight="900" font-size="32" letter-spacing="2"
        fill="#031024">SD</text>
</svg>
`.trim();

function _sdPauseDecorate(root) {
  if (!root) return;
  const el = (root instanceof HTMLElement) ? root : (root?.[0] ?? root);
  if (!el || !el.classList) return;

  el.classList.add("sd-pause-host");

  el.querySelectorAll(":scope > img, :scope > figure > img, :scope > figure > .logo").forEach(n => n.remove());

  if (el.querySelector(":scope > .sd-pause-cube-wrap")) return;

  const wrap = document.createElement("div");
  wrap.className = "sd-pause-cube-wrap";
  wrap.innerHTML = SD_PAUSE_SVG;

  el.insertBefore(wrap, el.firstChild);
}

export function installSdPause() {
  Hooks.on("renderPause",      (_app, html) => _sdPauseDecorate(html));
  Hooks.on("renderGamePause",  (_app, html) => _sdPauseDecorate(html));

  Hooks.once("ready", () => {
    const node = document.getElementById("pause");
    if (node) _sdPauseDecorate(node);
  });

  if (typeof MutationObserver !== "undefined") {
    Hooks.once("ready", () => {
      try {
        const mo = new MutationObserver(muts => {
          for (const m of muts) {
            for (const n of m.addedNodes ?? []) {
              if (n?.nodeType !== 1) continue;
              if (n.id === "pause") { _sdPauseDecorate(n); continue; }
              const inner = n.querySelector?.("#pause");
              if (inner) _sdPauseDecorate(inner);
            }
          }
        });
        mo.observe(document.body, { childList: true, subtree: true });
      } catch {}
    });
  }
}
