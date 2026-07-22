const { ApplicationV2 } = foundry.applications.api;

function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
}
function loc(key) { return game.i18n.localize(key); }
function fmt(key, data = {}, fallback = null) {
  let s = loc(key);
  if (!s || s === key) s = fallback ?? key;
  for (const [k, v] of Object.entries(data)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

/**
 * Step-by-step level-up wizard.
 *
 * Steps:
 *  - overview: fixed rewards of the level (+ note about upcoming choices)
 *  - one step per choice group (pick N of M cards)
 *  - summary: everything that will be applied, incl. stat diffs (only when there are choices)
 *
 * Usage:
 *   const res = await LevelUpWizard.show(actor, lv, choiceGroups);
 *   // res === null                -> cancelled
 *   // res === { picks: {gi: [optIdx, ...]} } -> confirmed
 */
export class LevelUpWizard extends ApplicationV2 {

  static DEFAULT_OPTIONS = {
    classes: ["sd", "sd-levelup-wizard"],
    window: {
      title:       "SD.Progression.WizardTitle",
      icon:        "fas fa-angles-up",
      resizable:   true,
      minimizable: false
    },
    position: { width: 720, height: 620 }
  };

  constructor(options = {}) {
    super({ ...options, id: `sd-luw-${options.actor?.id ?? "x"}-${foundry.utils.randomID(4)}` });
    this._actor    = options.actor;
    this._lv       = options.level ?? {};
    this._groups   = options.choiceGroups ?? [];
    this._resolve  = options.resolve;
    this._resolved = false;
    this._step     = 0;
    this._picked   = this._groups.map(() => []);
  }

  static show(actor, level, choiceGroups = []) {
    return new Promise(resolve => {
      new LevelUpWizard({ actor, level, choiceGroups, resolve }).render(true);
    });
  }

  get title() {
    return `${loc("SD.Progression.WizardTitle")} — ${this._actor?.name ?? ""} · ${loc("SD.Progression.Level")} ${this._lv?.level ?? ""}`;
  }

  get _steps() {
    const steps = [{ type: "overview" }];
    this._groups.forEach((g, gi) => steps.push({ type: "choice", gi }));
    if (this._groups.length) steps.push({ type: "summary" });
    return steps;
  }

  _stepLabel(step, idx) {
    if (step.type === "overview") return loc("SD.Progression.WizardStepOverview") || "Overview";
    if (step.type === "summary")  return loc("SD.Progression.WizardStepSummary")  || "Summary";
    const g = this._groups[step.gi];
    return g?.label || fmt("SD.Progression.WizardStepChoiceN", { n: step.gi + 1 }, "Choice {n}");
  }

  /* ------------------------------------------------------------------ */
  /* Reward helpers                                                      */
  /* ------------------------------------------------------------------ */

  _fcDiff(fc) {
    let cur = Number(foundry.utils.getProperty(this._actor, fc.path));
    if (isNaN(cur)) cur = 0;
    const val  = Number(fc.value);
    const safe = isNaN(val) ? 0 : val;
    let to;
    switch (fc.mode) {
      case "set":      to = safe; break;
      case "multiply": to = cur * safe; break;
      default:         to = cur + safe; break;
    }
    const sym = fc.mode === "set" ? "=" : fc.mode === "multiply" ? "×" : "+";
    return { from: cur, to, sym };
  }

  _chosenOptions() {
    const items = [], effects = [], fcs = [];
    this._groups.forEach((ch, gi) => {
      for (const oi of (this._picked[gi] ?? [])) {
        const opt = ch.options?.[oi];
        if (!opt) continue;
        const kind = ch.kind ?? "items";
        if (kind === "items")        items.push(opt);
        else if (kind === "effects") effects.push(opt);
        else                         fcs.push(opt);
      }
    });
    return { items, effects, fcs };
  }

  /* ------------------------------------------------------------------ */
  /* Rendering                                                           */
  /* ------------------------------------------------------------------ */

  async _renderHTML() { return this._buildHTML(); }

  _replaceHTML(result, content) { content.innerHTML = result; }

  async _prepareContext() { return {}; }

  _buildHTML() {
    const steps = this._steps;
    const cur   = Math.min(this._step, steps.length - 1);
    const step  = steps[cur];

    let html = `<div class="sd-luw">`;

    /* --- progress indicator ------------------------------------------ */
    html += `<div class="sd-luw-steps">`;
    steps.forEach((s, i) => {
      const cls = i === cur ? "active" : i < cur ? "done" : "";
      html += `<div class="sd-luw-step ${cls}">
        <span class="sd-luw-step-dot">${i < cur ? `<i class="fas fa-check"></i>` : i + 1}</span>
        <span class="sd-luw-step-lbl">${esc(this._stepLabel(s, i))}</span>
      </div>`;
      if (i < steps.length - 1) html += `<div class="sd-luw-step-sep"></div>`;
    });
    html += `</div>`;

    /* --- body --------------------------------------------------------- */
    html += `<div class="sd-luw-body">`;
    if (step.type === "overview")     html += this._buildOverview();
    else if (step.type === "choice")  html += this._buildChoiceStep(step.gi);
    else                              html += this._buildSummary();
    html += `</div>`;

    /* --- footer -------------------------------------------------------- */
    const isLast  = cur === steps.length - 1;
    const canNext = step.type !== "choice" || this._groupComplete(step.gi);
    html += `<div class="sd-luw-footer">
      <button type="button" class="sd-luw-btn" data-action="cancel">
        ${loc("SD.Progression.WizardCancel") || "Cancel"}
      </button>
      <div class="sd-luw-footer-right">
        <button type="button" class="sd-luw-btn" data-action="back" ${cur === 0 ? "disabled" : ""}>
          <i class="fas fa-arrow-left"></i> ${loc("SD.Progression.WizardBack") || "Back"}
        </button>
        <button type="button" class="sd-luw-btn primary" data-action="${isLast ? "apply" : "next"}" ${canNext ? "" : "disabled"}>
          ${isLast
            ? `<i class="fas fa-check"></i> ${loc("SD.Progression.WizardApply") || "Apply level"}`
            : `${loc("SD.Progression.WizardNext") || "Next"} <i class="fas fa-arrow-right"></i>`}
        </button>
      </div>
    </div>`;

    html += `</div>`;
    return html;
  }

  _buildRewardSections({ items, effects, fcs, markChoice = false }) {
    let html = "";

    if (items.length) {
      html += `<div class="sd-luw-panel"><div class="sd-luw-sec"><i class="fas fa-backpack"></i> ${loc("SD.Progression.WizardItems") || "Items"}</div><div class="sd-luw-chips">`;
      for (const it of items) {
        html += `<span class="sd-luw-chip${it.__chosen ? " chosen" : ""}">
          <img src="${esc(it.img ?? "icons/svg/item-bag.svg")}"><span>${esc(it.name ?? "Item")}</span>
          ${it.__chosen && markChoice ? `<i class="fas fa-hand-pointer" title="${loc("SD.Progression.WizardYourChoice") || "Your choice"}"></i>` : ""}
        </span>`;
      }
      html += `</div></div>`;
    }

    if (effects.length) {
      html += `<div class="sd-luw-panel"><div class="sd-luw-sec"><i class="fas fa-magic"></i> ${loc("SD.Progression.WizardEffects") || "Effects"}</div><div class="sd-luw-chips">`;
      for (const ef of effects) {
        html += `<span class="sd-luw-chip${ef.__chosen ? " chosen" : ""}">
          <img src="${esc(ef.img ?? ef.icon ?? "icons/svg/aura.svg")}"><span>${esc(ef.name ?? "Effect")}</span>
          ${ef.__chosen && markChoice ? `<i class="fas fa-hand-pointer" title="${loc("SD.Progression.WizardYourChoice") || "Your choice"}"></i>` : ""}
        </span>`;
      }
      html += `</div></div>`;
    }

    if (fcs.length) {
      html += `<div class="sd-luw-panel"><div class="sd-luw-sec"><i class="fas fa-sliders-h"></i> ${loc("SD.Progression.WizardStats") || "Stat changes"}</div><ul class="sd-luw-fcs">`;
      for (const fc of fcs) {
        if (!fc?.path) continue;
        const d = this._fcDiff(fc);
        html += `<li class="${fc.__chosen ? "chosen" : ""}">
          <code>${esc(fc.path)}</code>
          <span class="sd-luw-fc-op">${d.sym} ${esc(String(fc.value ?? ""))}</span>
          <span class="sd-luw-fc-diff">${d.from} <i class="fas fa-arrow-right"></i> <strong>${d.to}</strong></span>
          ${fc.__chosen && markChoice ? `<i class="fas fa-hand-pointer" title="${loc("SD.Progression.WizardYourChoice") || "Your choice"}"></i>` : ""}
        </li>`;
      }
      html += `</ul></div>`;
    }

    return html;
  }

  _buildOverview() {
    const lv = this._lv;
    let html = `<div class="sd-luw-intro">${fmt("SD.Progression.WizardGrants", { level: lv.level }, "Reaching level {level} grants:")}</div>`;
    if (lv.label) html += `<div class="sd-luw-lv-label">${esc(lv.label)}</div>`;

    const items   = lv.items        ?? [];
    const effects = lv.effects      ?? [];
    const fcs     = lv.fieldChanges ?? [];

    if (!items.length && !effects.length && !fcs.length) {
      html += `<div class="sd-luw-empty">${loc("SD.Progression.WizardNoRewards") || "This level has no fixed rewards."}</div>`;
    } else {
      html += this._buildRewardSections({ items, effects, fcs });
    }

    if (this._groups.length) {
      html += `<div class="sd-luw-callout"><i class="fas fa-code-branch"></i>
        ${fmt("SD.Progression.WizardChoicesAhead", { n: this._groups.length }, "Next you will make {n} choice(s) of rewards.")}
      </div>`;
    }
    return html;
  }

  _buildChoiceStep(gi) {
    const ch    = this._groups[gi];
    const picks = Math.max(1, Number(ch.picks) || 1);
    const opts  = Array.isArray(ch.options) ? ch.options : [];
    const sel   = this._picked[gi] ?? [];
    const kind  = ch.kind ?? "items";

    const kindLabel = kind === "items"   ? loc("SD.Progression.Items")
                    : kind === "effects" ? loc("SD.Progression.Effects")
                    : loc("SD.Progression.FieldChanges");

    let html = `<div class="sd-luw-choice-hdr">
      <div class="sd-luw-choice-title">
        <i class="fas fa-code-branch"></i>
        <span>${esc(ch.label || loc("SD.Progression.PlayerChoice") || "Player choice")}</span>
        <span class="sd-luw-choice-kind">${esc(kindLabel)}</span>
      </div>
      <div class="sd-luw-choice-counter ${sel.length === picks ? "ok" : ""}">
        ${fmt("SD.Progression.WizardSelected", { c: sel.length, n: picks }, "Selected {c} of {n}")}
      </div>
    </div>
    <div class="sd-luw-intro">${fmt("SD.Progression.WizardPickHint", { n: picks, total: opts.length }, "Choose {n} of {total}")}</div>`;

    html += `<div class="sd-luw-grid">`;
    opts.forEach((opt, oi) => {
      let title = "", icon = "icons/svg/mystery-man.svg", body = "";
      if (kind === "items") {
        title = opt.name ?? "Item";
        icon  = opt.img ?? "icons/svg/item-bag.svg";
        if (opt.type) body = `<div class="sd-luw-card-sub">${esc(opt.type)}</div>`;
      } else if (kind === "effects") {
        title = opt.name ?? "Effect";
        icon  = opt.img ?? opt.icon ?? "icons/svg/aura.svg";
        const cnt = Array.isArray(opt.changes) ? opt.changes.length : 0;
        if (cnt) body = `<div class="sd-luw-card-sub">${cnt} ${loc("SD.Progression.EffectChanges")}</div>`;
      } else {
        title = opt.path ?? "(field)";
        icon  = "icons/svg/upgrade.svg";
        const d = opt.path ? this._fcDiff(opt) : null;
        body = `<div class="sd-luw-card-sub">
          <code>${esc(opt.path ?? "")}</code>
          ${d ? `<strong>${d.from} → ${d.to}</strong>` : `<strong>${esc(String(opt.value ?? ""))}</strong>`}
        </div>`;
      }
      html += `<button type="button" class="sd-luw-card ${sel.includes(oi) ? "is-selected" : ""}" data-action="pick" data-opt="${oi}">
        <span class="sd-luw-card-check"><i class="fas fa-check"></i></span>
        <img src="${esc(icon)}" alt="">
        <div class="sd-luw-card-name">${esc(title)}</div>
        ${body}
      </button>`;
    });
    html += `</div>`;
    return html;
  }

  _buildSummary() {
    const lv     = this._lv;
    const chosen = this._chosenOptions();

    const mark = arr => arr.map(o => ({ ...o, __chosen: true }));

    const items   = [...(lv.items        ?? []), ...mark(chosen.items)];
    const effects = [...(lv.effects      ?? []), ...mark(chosen.effects)];
    const fcs     = [...(lv.fieldChanges ?? []), ...mark(chosen.fcs)];

    let html = `<div class="sd-luw-intro">${loc("SD.Progression.WizardSummaryIntro") || "Review everything before applying:"}</div>`;
    if (!items.length && !effects.length && !fcs.length) {
      html += `<div class="sd-luw-empty">${loc("SD.Progression.WizardNoRewards") || "This level has no fixed rewards."}</div>`;
    } else {
      html += this._buildRewardSections({ items, effects, fcs, markChoice: true });
    }
    return html;
  }

  _groupComplete(gi) {
    const ch    = this._groups[gi];
    const picks = Math.max(1, Number(ch?.picks) || 1);
    return (this._picked[gi] ?? []).length === picks;
  }

  /* ------------------------------------------------------------------ */
  /* Events                                                              */
  /* ------------------------------------------------------------------ */

  _onRender(context, options) {
    super._onRender?.(context, options);
    const root = this.element;

    root.querySelectorAll("[data-action]").forEach(el => {
      el.addEventListener("click", ev => {
        ev.preventDefault();
        this._handleAction(el.dataset.action, el);
      });
    });
  }

  _handleAction(action, el) {
    const steps = this._steps;
    switch (action) {
      case "cancel":
        this.close();
        break;

      case "back":
        if (this._step > 0) { this._step--; this.render(); }
        break;

      case "next": {
        const step = steps[this._step];
        if (step?.type === "choice" && !this._groupComplete(step.gi)) return;
        if (this._step < steps.length - 1) { this._step++; this.render(); }
        break;
      }

      case "apply": {
        for (let gi = 0; gi < this._groups.length; gi++) {
          if (!this._groupComplete(gi)) return;
        }
        this._resolved = true;
        const picks = Object.fromEntries(this._picked.map((arr, gi) => [gi, [...arr]]));
        this._resolve?.({ picks });
        this.close();
        break;
      }

      case "pick": {
        const step = steps[this._step];
        if (step?.type !== "choice") return;
        const gi    = step.gi;
        const oi    = Number(el.dataset.opt);
        const ch    = this._groups[gi];
        const picks = Math.max(1, Number(ch.picks) || 1);
        const cur   = this._picked[gi] ?? [];

        if (cur.includes(oi)) {
          this._picked[gi] = cur.filter(x => x !== oi);
        } else if (picks === 1) {
          this._picked[gi] = [oi];
        } else if (cur.length < picks) {
          this._picked[gi] = [...cur, oi];
        }
        this.render();
        break;
      }
    }
  }

  _onClose(options) {
    super._onClose?.(options);
    if (!this._resolved) {
      this._resolved = true;
      this._resolve?.(null);
    }
  }
}
