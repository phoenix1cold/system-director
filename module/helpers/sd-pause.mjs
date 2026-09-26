const SD_PAUSE_SVG = `
<svg class="sd-pause-cube" xmlns="http://www.w3.org/2000/svg" viewBox="-140 -140 280 320" aria-hidden="true">
  <defs>
    <filter id="sdp-spray" x="-40%" y="-40%" width="180%" height="180%">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" result="n"/>
      <feDisplacementMap in="SourceGraphic" in2="n" scale="2.2" xChannelSelector="R" yChannelSelector="G" result="rough"/>
      <feGaussianBlur in="rough" stdDeviation="5" result="halo"/>
      <feGaussianBlur in="rough" stdDeviation="1.4" result="soft"/>
      <feMerge><feMergeNode in="halo"/><feMergeNode in="halo"/><feMergeNode in="soft"/><feMergeNode in="rough"/></feMerge>
    </filter>
    <filter id="sdp-mist" x="-60%" y="-60%" width="220%" height="220%">
      <feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="3" seed="3" result="n"/>
      <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.05  0 0 0 0 0.45  0 0 0 0 1  0 0 0 0.55 -0.15" result="tint"/>
      <feComposite in="tint" in2="SourceGraphic" operator="in" result="cut"/>
      <feGaussianBlur in="cut" stdDeviation="4"/>
    </filter>
  </defs>

  <!-- spray mist behind the die -->
  <circle class="sd-pause-mist" r="128" fill="#1c8dff" filter="url(#sdp-mist)"/>

  <!-- splatter dots -->
  <g class="sd-pause-splats" fill="#3db5ff">
    <circle cx="-118" cy="-62" r="3.4"/><circle cx="-96" cy="-104" r="1.8"/><circle cx="112" cy="-80" r="2.6"/>
    <circle cx="128" cy="-28" r="1.6"/><circle cx="-124" cy="40" r="2.2"/><circle cx="106" cy="66" r="3"/>
    <circle cx="-72" cy="118" r="1.9"/><circle cx="84" cy="112" r="2.3"/><circle cx="-30" cy="-128" r="1.5"/>
    <circle cx="44" cy="-124" r="2.1"/><circle cx="-108" cy="96" r="1.3"/><circle cx="124" cy="18" r="1.4"/>
  </g>

  <!-- wireframe d20, sprayed -->
  <g class="sd-pause-spin" filter="url(#sdp-spray)" stroke="#2fb1ff" stroke-linecap="round" stroke-linejoin="round" fill="none">
    <polygon class="sd-pause-outline" points="0,-100 86.6,-50 86.6,50 0,100 -86.6,50 -86.6,-50" stroke-width="5.2"/>
    <g class="sd-pause-wires" stroke-width="2.4" opacity="0.92">
      <line x1="0" y1="-100" x2="50" y2="-20"/><line x1="0" y1="-100" x2="-50" y2="-20"/>
      <line x1="86.6" y1="-50" x2="50" y2="-20"/><line x1="86.6" y1="-50" x2="50" y2="35"/>
      <line x1="86.6" y1="50" x2="50" y2="35"/><line x1="86.6" y1="50" x2="0" y2="55"/>
      <line x1="0" y1="100" x2="0" y2="55"/><line x1="0" y1="100" x2="-50" y2="35"/>
      <line x1="-86.6" y1="50" x2="-50" y2="35"/><line x1="-86.6" y1="50" x2="-50" y2="-20"/>
      <line x1="-86.6" y1="-50" x2="-50" y2="-20"/><line x1="-86.6" y1="-50" x2="50" y2="-20"/>
      <line x1="86.6" y1="-50" x2="-50" y2="-20"/><line x1="86.6" y1="50" x2="-50" y2="35"/>
      <line x1="-86.6" y1="50" x2="50" y2="35"/><line x1="-86.6" y1="-50" x2="50" y2="35"/>
      <line x1="0" y1="-100" x2="0" y2="55"/><line x1="0" y1="100" x2="50" y2="-20"/><line x1="0" y1="100" x2="-50" y2="-20"/>
    </g>
    <polygon class="sd-pause-tri" points="-50,-20 50,-20 0,55" fill="#1b9bff" fill-opacity="0.82" stroke="#6fd3ff" stroke-width="4"/>
    <g class="sd-pause-nodes" fill="#9fe6ff" stroke="none">
      <circle cx="0" cy="-100" r="6"/><circle cx="86.6" cy="-50" r="5.4"/><circle cx="86.6" cy="50" r="5.4"/>
      <circle cx="0" cy="100" r="6"/><circle cx="-86.6" cy="50" r="5.4"/><circle cx="-86.6" cy="-50" r="5.4"/>
      <circle cx="50" cy="-20" r="4.4"/><circle cx="-50" cy="-20" r="4.4"/><circle cx="50" cy="35" r="4.4"/>
      <circle cx="-50" cy="35" r="4.4"/><circle cx="0" cy="55" r="4.4"/>
    </g>
  </g>

  <!-- paint drips: each slides a short way down and fades, then restarts -->
  <g class="sd-pause-drips" fill="#2fb1ff">
    <path class="sd-pause-drip" style="--dx:-86.6px;--dy:52px;--len:26px;--dur:3.4s;--delay:0s"
      d="M-3.2 0 C-3.6 8 -3.4 15 -2.6 20 C-1.8 24.5 1.8 24.5 2.6 20 C3.4 15 3.6 8 3.2 0 Z"/>
    <path class="sd-pause-drip" style="--dx:0px;--dy:102px;--len:34px;--dur:4.2s;--delay:1.1s"
      d="M-3.6 0 C-4 10 -3.8 19 -2.9 25 C-2 30.5 2 30.5 2.9 25 C3.8 19 4 10 3.6 0 Z"/>
    <path class="sd-pause-drip" style="--dx:86.6px;--dy:52px;--len:22px;--dur:3.9s;--delay:2.2s"
      d="M-2.8 0 C-3.2 7 -3 13 -2.3 17 C-1.6 21 1.6 21 2.3 17 C3 13 3.2 7 2.8 0 Z"/>
    <path class="sd-pause-drip" style="--dx:-50px;--dy:37px;--len:18px;--dur:3.1s;--delay:0.6s"
      d="M-2.4 0 C-2.7 6 -2.5 11 -1.9 14 C-1.3 17.5 1.3 17.5 1.9 14 C2.5 11 2.7 6 2.4 0 Z"/>
    <path class="sd-pause-drip" style="--dx:50px;--dy:37px;--len:20px;--dur:3.7s;--delay:1.7s"
      d="M-2.4 0 C-2.7 6 -2.5 11 -1.9 14 C-1.3 17.5 1.3 17.5 1.9 14 C2.5 11 2.7 6 2.4 0 Z"/>
    <path class="sd-pause-drip" style="--dx:24px;--dy:-20px;--len:16px;--dur:4.6s;--delay:2.9s"
      d="M-2 0 C-2.3 5 -2.1 9 -1.6 12 C-1.1 15 1.1 15 1.6 12 C2.1 9 2.3 5 2 0 Z"/>
  </g>

  <text class="sd-pause-text" x="0" y="20" text-anchor="middle" font-size="40" fill="#031024" stroke="#031024" stroke-width="1.5" paint-order="stroke" transform="rotate(-6)">SD</text>
</svg>
`.trim();

/**
 * A word rendered as SVG text with stroke + fill so CSS can "write" it: the
 * stroke is drawn with stroke-dashoffset, then the fill and the drips appear.
 * The viewBox is sized per word; glyph metrics are handled by the font itself.
 */
function _sdGraffitiWord(word, side) {
  const width = word.length * 62 + 40;
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("class", `sd-pause-word sd-pause-word--${side}`);
  svg.setAttribute("viewBox", `0 0 ${width} 120`);
  svg.setAttribute("aria-hidden", "true");
  svg.style.setProperty("--word-w", `${width}`);
  const text = document.createElementNS(svgNS, "text");
  text.setAttribute("x", String(width / 2));
  text.setAttribute("y", "82");
  text.setAttribute("text-anchor", "middle");
  text.setAttribute("class", "sd-pause-word-text");
  text.setAttribute("transform", `rotate(${side === "left" ? -4 : 3} ${width / 2} 60)`);
  text.textContent = word;
  const drips = document.createElementNS(svgNS, "g");
  drips.setAttribute("class", "sd-pause-word-drips");
  for (let i = 0; i < word.length; i++) {
    if (i % 2 === (side === "left" ? 0 : 1)) continue;
    const drip = document.createElementNS(svgNS, "path");
    drip.setAttribute("class", "sd-pause-drip");
    drip.setAttribute("d", "M-2.6 0 C-3 7 -2.8 13 -2.1 17 C-1.4 21 1.4 21 2.1 17 C2.8 13 3 7 2.6 0 Z");
    drip.style.setProperty("--dx", `${20 + (i + 0.55) * 62}px`);
    drip.style.setProperty("--dy", "86px");
    drip.style.setProperty("--len", `${14 + (i % 3) * 6}px`);
    drip.style.setProperty("--dur", `${3.2 + (i % 4) * 0.45}s`);
    drip.style.setProperty("--delay", `${1.1 + i * 0.37}s`);
    drips.appendChild(drip);
  }
  svg.appendChild(text);
  svg.appendChild(drips);
  return svg;
}

const SD_PAUSE_OVERLAY_ID = "sd-pause-overlay";
const SD_PAUSE_EXIT_MS = 520;

function _sdBuildPauseOverlay() {
  const existing = document.getElementById(SD_PAUSE_OVERLAY_ID);
  if (existing) return existing;

  const host = document.createElement("div");
  host.id = SD_PAUSE_OVERLAY_ID;
  host.className = "sd-pause-host";
  host.setAttribute("aria-hidden", "true");

  const inner = document.createElement("div");
  inner.className = "sd-pause-inner";

  const wrap = document.createElement("div");
  wrap.className = "sd-pause-cube-wrap";
  wrap.innerHTML = SD_PAUSE_SVG;

  inner.appendChild(_sdGraffitiWord("GAME", "left"));
  inner.appendChild(wrap);
  inner.appendChild(_sdGraffitiWord("PAUSED", "right"));
  host.appendChild(inner);

  document.body.appendChild(host);
  return host;
}

let _sdHideTimer = null;

function _sdShowPauseOverlay() {
  const el = _sdBuildPauseOverlay();
  if (_sdHideTimer) { clearTimeout(_sdHideTimer); _sdHideTimer = null; }
  el.classList.remove("sd-pause-hide");
  el.classList.remove("sd-pause-show");
  // Force a reflow so the entrance animation re-runs from the start.
  void el.offsetWidth;
  el.classList.add("sd-pause-show");
}

function _sdHidePauseOverlay() {
  const el = document.getElementById(SD_PAUSE_OVERLAY_ID);
  if (!el) return;
  if (!el.classList.contains("sd-pause-show") && !el.classList.contains("sd-pause-hide")) return;
  el.classList.remove("sd-pause-show");
  void el.offsetWidth;
  el.classList.add("sd-pause-hide");
  if (_sdHideTimer) clearTimeout(_sdHideTimer);
  _sdHideTimer = setTimeout(() => {
    el.classList.remove("sd-pause-hide");
    _sdHideTimer = null;
  }, SD_PAUSE_EXIT_MS + 20);
}

export function installSdPause() {
  Hooks.once("ready", () => {
    _sdBuildPauseOverlay();
    try { if (game?.paused) _sdShowPauseOverlay(); } catch {}
  });

  Hooks.on("pauseGame", (paused) => {
    if (paused) _sdShowPauseOverlay();
    else        _sdHidePauseOverlay();
  });
}
