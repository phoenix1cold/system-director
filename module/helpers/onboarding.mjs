const MODULE_ID = "sd";
const SETTING_ENABLED = "onboardingEnabled";
const SETTING_SEEN = "onboardingSeenTours";
const SETTING_TIPS = "helperTooltips";

const TOURS = {
  systemConfig: [
    {
      selector: "#sd-system-config .attr-config-grid",
      title: "System settings",
      body: "Attributes and resources define the core paths your sheets can use. Add or rename them here before building widgets."
    },
    {
      selector: "#sd-system-config [data-action='addAttribute']",
      title: "Add an attribute",
      body: "Use Add to create another attribute path such as system.attributes.attr7.value."
    },
    {
      selector: "#sd-system-config [name='systemPathAddSection']",
      title: "System Paths",
      body: "Pick Defense, Initiative, Movement, or Other, then add calculated paths for actors."
    },
    {
      selector: "#sd-system-config [data-action='editCalcGraph']",
      title: "Node graph formulas",
      body: "Open a path graph to build the formula visually. The graph writes its result back into the shown system path."
    },
    {
      selector: "#sd-system-config [data-sd-tour='guidance-settings']",
      title: "Guidance controls",
      body: "You can disable this onboarding and helper tooltips from here. Skip does the same for the guide."
    }
  ],
  sheetBuilder: [
    {
      selector: "#sd-toolbox [data-drag-type='newTab']",
      title: "Sheet Builder",
      body: "Drag New Tab onto the sheet navigation if you need a custom tab for your widgets."
    },
    {
      selector: "#sd-toolbox [data-widget-type='button'], #sd-toolbox [data-widget-type='rollButton']",
      title: "Add a button widget",
      body: "Drag Button or Roll Button onto an edit-mode character sheet to create an interactive roll control."
    },
    {
      selector: "#sd-toolbox #tb-tab-paths",
      title: "Paths tab",
      body: "Use Paths to copy or drag valid data paths into widget config fields and graph nodes."
    }
  ],
  characterSheet: [
    {
      selector: "[data-action='toggleEditMode']",
      title: "Edit mode",
      body: "Turn edit mode on before dropping widgets. In edit mode, widgets show configure, duplicate, width, and remove controls."
    },
    {
      selector: ".character.sheet [data-sd-tour='sheet-drop-zone'], .actor.character [data-sd-tour='sheet-drop-zone']",
      title: "Drop zone",
      body: "Drop the button widget onto a sheet drop zone. It becomes a real widget on that tab or section."
    },
    {
      selector: ".character.sheet [data-action='wcfg'], .actor.character [data-action='wcfg']",
      title: "Configure widget",
      body: "Hover a widget in edit mode and click the gear to set its label, formula, style, and graph."
    }
  ],
  widgetConfig: [
    {
      selector: ".sd-wcfg-popup [data-open-graph], .sd-wcfg-popup [data-open-action-graph], .sd-wcfg-popup #wcfg-attr-graph-btn",
      title: "Open graph editor",
      body: "Graph buttons let you build formulas visually. For a button roll, open the formula graph and add Roll -> Value."
    },
    {
      selector: ".sd-wcfg-popup [data-field='formula'], .sd-wcfg-popup [data-field='label']",
      title: "Widget fields",
      body: "Set a clear label and either type a formula directly or use the graph editor for a visual roll setup."
    }
  ],
  graphRollValue: [
    {
      selector: ".sd-graph-win #gpal",
      title: "Node list",
      body: "The left panel contains nodes that are valid for this graph type. Use Search or scroll to the Roll category."
    },
    {
      selector: ".sd-graph-win [data-type='act_roll_value']",
      title: "Roll -> Value",
      body: "Drag Roll -> Value into the graph. It rolls dice and outputs the numeric result for later nodes or the final output."
    },
    {
      selector: ".sd-graph-win #gwrap",
      title: "Connect pins",
      body: "Drag from an output pin to an input pin. If you release on empty space, the quick insert menu only shows compatible nodes."
    },
    {
      selector: ".sd-graph-win #gsave",
      title: "Save graph",
      body: "Save & Apply writes the graph back to the widget or system path."
    }
  ]
};

function _setting(key, fallback) {
  try { return game.settings.get(MODULE_ID, key); } catch { return fallback; }
}

async function _setSetting(key, value) {
  try { await game.settings.set(MODULE_ID, key, value); } catch {  }
}

function _isEnabled() {
  return _setting(SETTING_ENABLED, true) !== false;
}

function _tipsEnabled() {
  return _setting(SETTING_TIPS, true) !== false;
}

function _seenTours() {
  const seen = _setting(SETTING_SEEN, {});
  return (seen && typeof seen === "object") ? seen : {};
}

function _first(selector) {
  if (!selector) return null;
  try { return document.querySelector(selector); } catch { return null; }
}

function _tag(el, tip, tour = "") {
  if (!el) return;
  if (tip && !el.dataset.sdTip) el.dataset.sdTip = tip;
  if (tour && !el.dataset.sdTour) el.dataset.sdTour = tour;
}

export const SDOnboarding = {
  _installed: false,
  _active: null,
  _tip: null,

  install() {
    if (this._installed) return;
    this._installed = true;
    this._injectCss();
    document.addEventListener("mouseover", ev => this._onTipOver(ev), true);
    document.addEventListener("mouseout", ev => this._onTipOut(ev), true);
    document.addEventListener("keydown", ev => {
      if (ev.key === "Escape" && this._active) this._close(false);
    }, true);
    globalThis.SD ??= {};
    globalThis.SD.Onboarding = this;
  },

  bindSystemConfig(root) {
    if (!root) return;
    _tag(root.querySelector(".attr-config-grid"), "Attributes become paths such as system.attributes.attr1.value.", "system-attributes");
    _tag(root.querySelector("[data-action='addAttribute']"), "Add another attribute key and score path.", "system-add-attribute");
    _tag(root.querySelector("[name='systemPathAddSection']"), "Choose which system path group receives the next calculated path.", "system-path-section");
    _tag(root.querySelector("[data-action='addCalcEntry']"), "Add a calculated System Path.", "system-path-add");
    _tag(root.querySelector("[data-action='editCalcGraph']"), "Open the node graph for this System Path.", "system-path-graph");
    _tag(root.querySelector("[data-sd-tour='guidance-settings']"), "Disable onboarding or helper tooltips here.");
    _tag(root.querySelector("[data-action='startOnboarding']"), "Restart the quick guide.");
    this.maybeStart("systemConfig");
  },

  bindToolbox(root) {
    if (!root) return;
    _tag(root.querySelector("[data-drag-type='newTab']"), "Drag this onto sheet navigation to add a custom tab.");
    _tag(root.querySelector("[data-widget-type='button']"), "Drag this onto an edit-mode sheet to create a button.");
    _tag(root.querySelector("[data-widget-type='rollButton']"), "Roll Button is a ready-made dice button widget.");
    _tag(root.querySelector("#tb-tab-paths"), "Switch to data paths you can drag or copy.");
    _tag(root.querySelector("#tb-search-widgets"), "Filter widgets by name or type.");
    this.maybeStart("sheetBuilder");
  },

  bindCharacterSheet(root) {
    if (!root) return;
    _tag(root.querySelector("[data-sd-tour='sheet-drop-zone']"), "Drop widgets here while edit mode is enabled.");
    root.querySelectorAll("[data-action='wcfg']").forEach(el => _tag(el, "Configure this widget."));
    root.querySelectorAll("[data-action='wspan']").forEach(el => _tag(el, "Cycle widget width."));
    root.querySelectorAll("[data-action='wdel']").forEach(el => _tag(el, "Remove this widget."));
    this.maybeStart("characterSheet");
  },

  bindWidgetConfig(root) {
    if (!root) return;
    root.classList?.add?.("sd-wcfg-popup");
    root.querySelectorAll("[data-open-graph], [data-open-action-graph], #wcfg-attr-graph-btn, #wcfg-number-graph-btn")
      .forEach(el => _tag(el, "Open a node graph editor for this field."));
    root.querySelectorAll("[data-field='formula'], [data-field='path'], [data-field='label']")
      .forEach(el => _tag(el, "This value is saved onto the widget."));
    this.maybeStart("widgetConfig");
  },

  bindGraph(root) {
    if (!root) return;
    _tag(root.querySelector("#gpal"), "Available nodes for this graph type.");
    _tag(root.querySelector("[data-type='act_roll_value']"), "Drag Roll -> Value into the graph for a numeric dice result.");
    _tag(root.querySelector("#gwrap"), "Drop nodes and connect output pins to input pins.");
    _tag(root.querySelector("#gsave"), "Save the graph back to the sheet or settings.");
    this.maybeStart("graphRollValue");
  },

  async reset() {
    await _setSetting(SETTING_ENABLED, true);
    await _setSetting(SETTING_SEEN, {});
    this.start("systemConfig", { force: true });
  },

  async skip() {
    await _setSetting(SETTING_ENABLED, false);
    this._close(false);
    ui.notifications?.info?.("SD guide skipped. You can enable it again in settings.");
  },

  maybeStart(tourId) {
    if (!_isEnabled()) return;
    if (this._active) return;
    const seen = _seenTours();
    if (seen?.[tourId]) return;
    window.setTimeout(() => {
      if (!this._active && _isEnabled() && !_seenTours()?.[tourId]) this.start(tourId);
    }, 250);
  },

  start(tourId, { force = false } = {}) {
    const steps = TOURS[tourId];
    if (!steps?.length) return;
    if (!force && !_isEnabled()) return;
    this._active = { tourId, steps, index: 0 };
    this._renderStep();
  },

  _renderStep() {
    const active = this._active;
    if (!active) return;
    this._removeTourDom();

    const step = active.steps[active.index];
    const target = _first(step.selector);
    const overlay = document.createElement("div");
    overlay.className = "sd-tour-overlay";
    overlay.innerHTML = `
      <div class="sd-tour-highlight"></div>
      <div class="sd-tour-card" role="dialog" aria-live="polite">
        <div class="sd-tour-kicker">Quick guide ${active.index + 1}/${active.steps.length}</div>
        <div class="sd-tour-title">${this._esc(step.title)}</div>
        <div class="sd-tour-body">${this._esc(step.body)}</div>
        ${target ? "" : `<div class="sd-tour-missing">Open the related window if this control is not visible yet.</div>`}
        <div class="sd-tour-actions">
          <button type="button" data-sd-tour-action="skip">Skip</button>
          <span class="sd-tour-spacer"></span>
          <button type="button" data-sd-tour-action="back" ${active.index === 0 ? "disabled" : ""}>Back</button>
          <button type="button" data-sd-tour-action="next">${active.index === active.steps.length - 1 ? "Done" : "Next"}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    overlay.querySelector("[data-sd-tour-action='skip']")?.addEventListener("click", () => this.skip());
    overlay.querySelector("[data-sd-tour-action='back']")?.addEventListener("click", () => {
      if (active.index > 0) { active.index--; this._renderStep(); }
    });
    overlay.querySelector("[data-sd-tour-action='next']")?.addEventListener("click", () => this._next());

    if (target) {
      target.scrollIntoView?.({ block: "center", inline: "center", behavior: "smooth" });
      window.setTimeout(() => this._positionTour(target), 120);
    } else {
      this._positionTour(null);
    }
    window.addEventListener("resize", this._boundPosition ??= (() => {
      const cur = this._active?.steps?.[this._active.index];
      this._positionTour(cur ? _first(cur.selector) : null);
    }));
    window.addEventListener("scroll", this._boundPosition, true);
  },

  async _next() {
    const active = this._active;
    if (!active) return;
    if (active.index < active.steps.length - 1) {
      active.index++;
      this._renderStep();
      return;
    }
    const seen = { ..._seenTours(), [active.tourId]: true };
    await _setSetting(SETTING_SEEN, seen);
    this._close(false);
  },

  _positionTour(target) {
    const overlay = document.querySelector(".sd-tour-overlay");
    if (!overlay) return;
    const hi = overlay.querySelector(".sd-tour-highlight");
    const card = overlay.querySelector(".sd-tour-card");
    if (!card || !hi) return;

    if (!target) {
      hi.style.display = "none";
      card.style.left = "50%";
      card.style.top = "50%";
      card.style.transform = "translate(-50%, -50%)";
      return;
    }

    const r = target.getBoundingClientRect();
    const pad = 6;
    hi.style.display = "block";
    hi.style.left = `${Math.max(8, r.left - pad)}px`;
    hi.style.top = `${Math.max(8, r.top - pad)}px`;
    hi.style.width = `${Math.max(24, r.width + pad * 2)}px`;
    hi.style.height = `${Math.max(24, r.height + pad * 2)}px`;

    const cardW = Math.min(360, Math.max(280, card.offsetWidth || 320));
    let left = r.left;
    let top = r.bottom + 14;
    if (left + cardW > window.innerWidth - 12) left = window.innerWidth - cardW - 12;
    if (top + 180 > window.innerHeight - 12) top = Math.max(12, r.top - 190);
    card.style.left = `${Math.max(12, left)}px`;
    card.style.top = `${Math.max(12, top)}px`;
    card.style.transform = "";
  },

  _close() {
    this._removeTourDom();
    this._active = null;
  },

  _removeTourDom() {
    document.querySelector(".sd-tour-overlay")?.remove();
    if (this._boundPosition) {
      window.removeEventListener("resize", this._boundPosition);
      window.removeEventListener("scroll", this._boundPosition, true);
    }
  },

  _onTipOver(ev) {
    if (!_tipsEnabled()) return;
    const el = ev.target?.closest?.("[data-sd-tip]");
    if (!el) return;
    this._showTip(el);
  },

  _onTipOut(ev) {
    const el = ev.target?.closest?.("[data-sd-tip]");
    if (!el) return;
    const next = ev.relatedTarget?.closest?.("[data-sd-tip]");
    if (next === el) return;
    this._hideTip();
  },

  _showTip(el) {
    const text = el.dataset.sdTip;
    if (!text) return;
    this._hideTip();
    const tip = document.createElement("div");
    tip.className = "sd-helper-tip";
    tip.textContent = text;
    document.body.appendChild(tip);
    const r = el.getBoundingClientRect();
    const tr = tip.getBoundingClientRect();
    let left = r.left;
    let top = r.bottom + 8;
    if (left + tr.width > window.innerWidth - 10) left = window.innerWidth - tr.width - 10;
    if (top + tr.height > window.innerHeight - 10) top = r.top - tr.height - 8;
    tip.style.left = `${Math.max(8, left)}px`;
    tip.style.top = `${Math.max(8, top)}px`;
    this._tip = tip;
  },

  _hideTip() {
    this._tip?.remove?.();
    this._tip = null;
  },

  _esc(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  },

  _injectCss() {
    if (document.getElementById("sd-onboarding-css")) return;
    const style = document.createElement("style");
    style.id = "sd-onboarding-css";
    style.textContent = `
      .sd-tour-overlay{position:fixed;inset:0;z-index:40000;pointer-events:none;font-family:Signika,Inter,Arial,sans-serif}
      .sd-tour-highlight{position:fixed;border:2px solid var(--sd-accent,#8f7aff);border-radius:8px;box-shadow:0 0 0 9999px rgba(0,0,0,.45),0 0 18px rgba(143,122,255,.8);pointer-events:none;transition:.18s ease}
      .sd-tour-card{position:fixed;width:min(360px,calc(100vw - 24px));background:var(--sd-bg-2,#191923);border:1px solid var(--sd-accent,#8f7aff);border-radius:8px;box-shadow:0 14px 44px rgba(0,0,0,.75);padding:12px;color:var(--sd-text,#eee);pointer-events:auto}
      .sd-tour-kicker{font-size:10px;text-transform:uppercase;letter-spacing:.12em;color:var(--sd-accent,#8f7aff);font-weight:800;margin-bottom:4px}
      .sd-tour-title{font-size:15px;font-weight:800;margin-bottom:5px}
      .sd-tour-body{font-size:12px;line-height:1.45;color:var(--sd-text-2,#c9c9d8)}
      .sd-tour-missing{margin-top:7px;font-size:11px;color:var(--sd-warning,#d8a44a)}
      .sd-tour-actions{display:flex;align-items:center;gap:6px;margin-top:12px}
      .sd-tour-actions button{background:var(--sd-bg,#111);border:1px solid var(--sd-border,#333);border-radius:5px;color:var(--sd-text,#eee);cursor:pointer;font-size:12px;padding:5px 10px}
      .sd-tour-actions button[data-sd-tour-action='next']{background:var(--sd-accent,#8f7aff);border-color:var(--sd-accent,#8f7aff);color:var(--sd-accent-text,#fff);font-weight:800}
      .sd-tour-actions button:disabled{opacity:.45;cursor:default}
      .sd-tour-spacer{flex:1}
      .sd-helper-tip{position:fixed;z-index:41000;max-width:280px;background:#101018;border:1px solid var(--sd-accent,#8f7aff);border-radius:6px;box-shadow:0 8px 24px rgba(0,0,0,.65);color:var(--sd-text,#eee);font-size:11px;line-height:1.35;padding:7px 9px;pointer-events:none}
    `;
    document.head.appendChild(style);
  }
};

export function installOnboarding() {
  SDOnboarding.install();
}
