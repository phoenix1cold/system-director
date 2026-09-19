import { openFoundryWindow } from "../helpers/foundry-window-host.mjs";
import { getValueDefinitions, valueStoragePath } from "../helpers/value-database.mjs";
import { collectWidgetKeys, normalizeWidgetKey, uniqueWidgetKey } from "./widget-identity.mjs";

const esc = value => String(value ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const clone = value => {
  try { return foundry.utils.deepClone(value); }
  catch { return JSON.parse(JSON.stringify(value ?? {})); }
};

const positiveInt = (value, fallback, max = 100000) => {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) ? Math.max(1, Math.min(max, number)) : fallback;
};

const operator = value => String(value ?? "+") === "-" ? "-" : "+";

export function normalizeEasyButtonConfig(source = {}) {
  const mode = source.easyMode === "formula" ? "formula" : "constructor";
  const diceTerms = (Array.isArray(source.diceTerms) ? source.diceTerms : [])
    .map(term => ({ count: positiveInt(term?.count, 1, 999), sides: Math.max(2, positiveInt(term?.sides, 20)) }));
  const variableTerms = (Array.isArray(source.variableTerms) ? source.variableTerms : [])
    .map(term => ({ operator: operator(term?.operator), variableId: String(term?.variableId ?? "").trim() }))
    .filter(term => term.variableId);
  const widgetTerms = (Array.isArray(source.widgetTerms) ? source.widgetTerms : [])
    .map(term => ({ operator: operator(term?.operator), widgetKey: String(term?.widgetKey ?? "").trim() }))
    .filter(term => term.widgetKey);
  return {
    ...source,
    type: "easyButton",
    easyMode: mode,
    customFormula: String(source.customFormula ?? source.formula ?? "1d20").trim() || "1d20",
    diceTerms: diceTerms.length ? diceTerms : [{ count: 1, sides: 20 }],
    variableTerms,
    widgetTerms
  };
}

/** Compile the visual constructor into a normal Foundry roll formula. */
export function buildEasyButtonFormula(source = {}) {
  const state = normalizeEasyButtonConfig(source);
  if (state.easyMode === "formula") return state.customFormula || "1d20";
  const parts = state.diceTerms.map((term, index) => `${index ? "+ " : ""}${term.count}d${term.sides}`);
  for (const term of state.variableTerms) {
    parts.push(`${term.operator} {${valueStoragePath(term.variableId)}}`);
  }
  for (const term of state.widgetTerms) parts.push(`${term.operator} {widget:${term.widgetKey}}`);
  return parts.join(" ") || "1d20";
}

function collectWidgets(tabs = [], additionalWidgets = []) {
  const result = [];
  const seen = new Set();
  const walk = widgets => {
    for (const widget of widgets ?? []) {
      if (!widget || typeof widget !== "object" || seen.has(widget)) continue;
      seen.add(widget);
      result.push(widget);
      walk(widget.widgets);
      walk((widget.elements ?? []).map(element => element?.widget).filter(Boolean));
    }
  };
  for (const tab of tabs ?? []) for (const row of tab.rows ?? []) walk(row.widgets);
  walk(additionalWidgets);
  return result;
}

function selectOptions(list, selected, emptyLabel) {
  return `<option value="">${esc(emptyLabel)}</option>` + list.map(entry =>
    `<option value="${esc(entry.value)}" ${String(entry.value) === String(selected ?? "") ? "selected" : ""}>${esc(entry.label)}</option>`
  ).join("");
}

/**
 * Open the creation/edit wizard. Resolves with a complete Easy Button widget,
 * or null when the window is closed/cancelled.
 */
export function openEasyButtonWizard(widget = {}, doc = null, options = {}) {
  const tabs = options.tabs ?? doc?.system?.customTabs ?? [];
  const state = normalizeEasyButtonConfig(clone(widget));
  state.label = String(state.label ?? "Easy Button") || "Easy Button";
  state.widgetKey = String(state.widgetKey ?? "").trim()
    || uniqueWidgetKey(state.label || "easy_button", tabs, state.id);
  state.icon = String(state.icon ?? "fa-dice-d20");
  state.flavor = String(state.flavor ?? "");

  const scope = doc?.documentName === "Item" ? "item" : "actor";
  const variables = getValueDefinitions(scope).map(variable => ({
    value: variable.id,
    label: `${variable.name ?? variable.id} · ${variable.type ?? "value"} [${variable.id}]`
  }));
  const noValueTypes = new Set(["button", "easyButton", "cardDrawButton", "section", "vsection", "widgetBuilder"]);
  const widgets = collectWidgets(tabs, options.additionalWidgets)
    .filter(entry => entry.id !== state.id && String(entry.widgetKey ?? "").trim() && !noValueTypes.has(String(entry.type ?? "")))
    .map(entry => ({ value: String(entry.widgetKey), label: `${entry.label ?? entry.widgetKey} [${entry.widgetKey}]` }));

  const pages = () => state.easyMode === "formula" ? ["mode", "formula"] : ["mode", "dice", "modifiers"];
  let page = String(options.startPage ?? "mode");
  if (!pages().includes(page)) page = "mode";
  const root = document.createElement("div");
  root.className = "sd-easy-button-wizard";
  let app = null;
  let settled = false;

  return new Promise(resolve => {
    const finish = async value => {
      if (settled) return;
      settled = true;
      resolve(value);
      await app?.close?.({ sdSkipCallback: true });
    };

    const syncInputs = () => {
      root.querySelectorAll("[data-state]").forEach(input => {
        const key = input.dataset.state;
        state[key] = input.type === "checkbox" ? input.checked : input.value;
      });
      root.querySelectorAll("[data-die-row]").forEach((row, index) => {
        const term = state.diceTerms[index];
        if (!term) return;
        term.count = positiveInt(row.querySelector('[data-die="count"]')?.value, 1, 999);
        term.sides = positiveInt(row.querySelector('[data-die="sides"]')?.value, 20);
      });
      root.querySelectorAll("[data-variable-row]").forEach((row, index) => {
        const term = state.variableTerms[index];
        if (!term) return;
        term.operator = operator(row.querySelector('[data-term="operator"]')?.value);
        term.variableId = String(row.querySelector('[data-term="variableId"]')?.value ?? "");
      });
      root.querySelectorAll("[data-widget-row]").forEach((row, index) => {
        const term = state.widgetTerms[index];
        if (!term) return;
        term.operator = operator(row.querySelector('[data-term="operator"]')?.value);
        term.widgetKey = String(row.querySelector('[data-term="widgetKey"]')?.value ?? "");
      });
    };

    const modePage = () => `
      <div class="sdew-identity">
        <label><span>Display name</span><input data-state="label" value="${esc(state.label)}" autofocus></label>
        <label><span>Widget Key</span><input data-state="widgetKey" value="${esc(state.widgetKey)}" spellcheck="false"><small>Used by Sheet Blueprint and other widgets.</small></label>
      </div>
      <div class="sdew-mode-grid">
        <button type="button" class="sdew-mode ${state.easyMode === "formula" ? "is-active" : ""}" data-mode="formula">
          <i class="fas fa-code"></i><b>Custom Formula</b><small>Enter a normal Foundry roll formula, for example 2d6 + 3.</small>
        </button>
        <button type="button" class="sdew-mode ${state.easyMode === "constructor" ? "is-active" : ""}" data-mode="constructor">
          <i class="fas fa-cubes"></i><b>Constructor</b><small>Build the roll from dice, Database variables and widget values.</small>
        </button>
      </div>`;

    const formulaPage = () => `
      <div class="sdew-section">
        <div class="sdew-section-title"><i class="fas fa-code"></i><div><b>Custom formula</b><small>All standard Foundry dice syntax and System Director tokens are supported.</small></div></div>
        <textarea data-state="customFormula" class="sdew-formula-input" spellcheck="false" placeholder="1d20 + {system.values.strength}">${esc(state.customFormula)}</textarea>
      </div>`;

    const dicePage = () => `
      <div class="sdew-section">
        <div class="sdew-section-title"><i class="fas fa-dice-d20"></i><div><b>Dice</b><small>Set the number and sides for every dice group.</small></div></div>
        <div class="sdew-list">${state.diceTerms.map((term, index) => `
          <div class="sdew-row" data-die-row="${index}">
            <label><span>Dice count</span><input type="number" min="1" max="999" step="1" data-die="count" value="${term.count}"></label>
            <span class="sdew-d">d</span>
            <label><span>Sides</span><input type="number" min="2" max="100000" step="1" data-die="sides" value="${term.sides}"></label>
            <button type="button" class="sdew-remove" data-remove-die="${index}" ${state.diceTerms.length === 1 ? "disabled" : ""} title="Remove dice"><i class="fas fa-trash"></i></button>
          </div>`).join("")}</div>
        <button type="button" class="sdew-add" data-add-die><i class="fas fa-plus"></i> Add dice</button>
      </div>`;

    const modifierRow = (kind, term, index) => {
      const key = kind === "variable" ? "variableId" : "widgetKey";
      const list = kind === "variable" ? variables : widgets;
      const label = kind === "variable" ? "Select Database variable…" : "Select widget value…";
      return `<div class="sdew-row sdew-modifier" data-${kind}-row="${index}">
        <select data-term="operator" aria-label="Operator"><option value="+" ${term.operator !== "-" ? "selected" : ""}>+</option><option value="-" ${term.operator === "-" ? "selected" : ""}>−</option></select>
        <select data-term="${key}">${selectOptions(list, term[key], label)}</select>
        <button type="button" class="sdew-remove" data-remove-${kind}="${index}" title="Remove modifier"><i class="fas fa-trash"></i></button>
      </div>`;
    };

    const modifiersPage = () => `
      <div class="sdew-section">
        <div class="sdew-section-title"><i class="fas fa-database"></i><div><b>Database variables</b><small>Add as many variable modifiers as you need.</small></div></div>
        <div class="sdew-list">${state.variableTerms.map((term, index) => modifierRow("variable", term, index)).join("") || '<div class="sdew-empty">No Database variable modifiers.</div>'}</div>
        <button type="button" class="sdew-add" data-add-variable ${variables.length ? "" : "disabled"}><i class="fas fa-plus"></i> Add variable</button>
      </div>
      <div class="sdew-section">
        <div class="sdew-section-title"><i class="fas fa-puzzle-piece"></i><div><b>Widget values</b><small>The selected widget's current value becomes a roll modifier.</small></div></div>
        <div class="sdew-list">${state.widgetTerms.map((term, index) => modifierRow("widget", term, index)).join("") || '<div class="sdew-empty">No widget modifiers.</div>'}</div>
        <button type="button" class="sdew-add" data-add-widget ${widgets.length ? "" : "disabled"}><i class="fas fa-plus"></i> Add widget value</button>
      </div>`;

    const render = () => {
      const sequence = pages();
      const index = Math.max(0, sequence.indexOf(page));
      const body = page === "mode" ? modePage() : page === "formula" ? formulaPage() : page === "dice" ? dicePage() : modifiersPage();
      root.innerHTML = `<style>
        .sd-easy-button-wizard{height:100%;min-height:0;display:flex;flex-direction:column;background:var(--sd-popover-bg,var(--sd-bg,#171b2b));color:var(--sd-text,#eee);font:13px Signika,sans-serif}
        .sdew-head{padding:15px 18px 12px;border-bottom:1px solid var(--sd-border,#3a4260);background:linear-gradient(120deg,color-mix(in srgb,var(--sd-accent,#7775ff) 18%,transparent),transparent)}
        .sdew-head b{display:block;font-size:17px;color:var(--sd-accent,#9290ff)}.sdew-head small,.sdew-section-title small,.sdew-identity small{display:block;color:var(--sd-text-3,#8f96aa);font-size:11px;margin-top:2px}
        .sdew-steps{display:flex;gap:5px;margin-top:11px}.sdew-step{height:4px;flex:1;border-radius:9px;background:var(--sd-bg-3,#30364b)}.sdew-step.is-done{background:var(--sd-accent,#7775ff)}
        .sdew-body{padding:16px 18px;overflow:auto;flex:1;min-height:0}.sdew-identity{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px}
        .sdew-identity label,.sdew-row label{display:flex;flex-direction:column;gap:4px}.sdew-identity span,.sdew-row label span{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--sd-text-3,#8f96aa)}
        .sd-easy-button-wizard input,.sd-easy-button-wizard select,.sd-easy-button-wizard textarea{box-sizing:border-box;background:var(--sd-bg,#171b2b);border:1px solid var(--sd-border,#3a4260);border-radius:5px;color:var(--sd-text,#eee);padding:7px 9px;min-width:0}
        .sdew-mode-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.sdew-mode{min-height:155px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:18px;border:1px solid var(--sd-border,#3a4260);border-radius:10px;background:var(--sd-bg-2,#22283a);color:var(--sd-text,#eee);cursor:pointer;text-align:center}.sdew-mode i{font-size:27px;color:var(--sd-accent,#9290ff)}.sdew-mode b{font-size:15px}.sdew-mode small{color:var(--sd-text-3,#8f96aa);line-height:1.35}.sdew-mode.is-active{border-color:var(--sd-accent,#9290ff);box-shadow:0 0 0 2px color-mix(in srgb,var(--sd-accent,#9290ff) 20%,transparent)}
        .sdew-section{padding:12px;border:1px solid var(--sd-border,#3a4260);border-radius:8px;background:var(--sd-bg-2,#22283a);margin-bottom:12px}.sdew-section-title{display:flex;gap:9px;align-items:center;margin-bottom:10px}.sdew-section-title>i{width:27px;height:27px;display:grid;place-items:center;border-radius:6px;background:color-mix(in srgb,var(--sd-accent,#9290ff) 18%,transparent);color:var(--sd-accent,#9290ff)}
        .sdew-list{display:flex;flex-direction:column;gap:7px}.sdew-row{display:grid;grid-template-columns:minmax(90px,1fr) 22px minmax(90px,1fr) 34px;gap:7px;align-items:end}.sdew-row.sdew-modifier{grid-template-columns:58px minmax(0,1fr) 34px;align-items:center}.sdew-d{align-self:end;text-align:center;padding-bottom:8px;color:var(--sd-text-3,#8f96aa);font-weight:700}
        .sdew-add,.sdew-remove{border:1px solid var(--sd-border,#3a4260);border-radius:5px;background:var(--sd-bg-3,#30364b);color:var(--sd-text,#eee);cursor:pointer}.sdew-add{margin-top:9px;padding:7px 11px;color:var(--sd-accent,#9290ff)}.sdew-remove{height:33px;color:#e4737a}.sdew-add:disabled,.sdew-remove:disabled{opacity:.35;cursor:default}.sdew-empty{font-size:11px;color:var(--sd-text-3,#8f96aa);font-style:italic;padding:5px 1px}
        .sdew-formula-input{width:100%;min-height:150px;resize:vertical;font:13px 'Courier New',monospace;line-height:1.5}.sdew-preview{padding:10px 18px;border-top:1px solid var(--sd-border,#3a4260);background:var(--sd-bg-2,#22283a)}.sdew-preview span{display:block;font-size:9px;text-transform:uppercase;color:var(--sd-text-3,#8f96aa);margin-bottom:4px}.sdew-preview code{display:block;white-space:nowrap;overflow:auto;color:var(--sd-accent-2,#67d6ff);font-size:12px}
        .sdew-footer{display:flex;justify-content:flex-end;gap:8px;padding:11px 18px;border-top:1px solid var(--sd-border,#3a4260)}.sdew-footer button{padding:8px 16px;border-radius:5px;border:1px solid var(--sd-border,#3a4260);background:var(--sd-bg-3,#30364b);color:var(--sd-text,#eee);cursor:pointer}.sdew-footer .is-primary{background:var(--sd-accent,#7775ff);border-color:var(--sd-accent,#7775ff);color:#fff;font-weight:700}
        @media(max-width:560px){.sdew-identity,.sdew-mode-grid{grid-template-columns:1fr}.sdew-row{grid-template-columns:1fr 18px 1fr 32px}}
      </style>
      <header class="sdew-head"><b><i class="fas fa-dice-d20"></i> Easy Button</b><small>${page === "mode" ? "Choose how this roll is built." : page === "formula" ? "Enter the roll formula." : page === "dice" ? "Add one or more dice groups." : "Add variables and widget values."}</small><div class="sdew-steps">${sequence.map((_, step) => `<i class="sdew-step ${step <= index ? "is-done" : ""}"></i>`).join("")}</div></header>
      <main class="sdew-body">${body}</main>
      <div class="sdew-preview"><span>Formula preview</span><code>${esc(buildEasyButtonFormula(state))}</code></div>
      <footer class="sdew-footer"><button type="button" data-cancel>Cancel</button>${index > 0 ? '<button type="button" data-back>Back</button>' : ""}<button type="button" class="is-primary" data-next>${index === sequence.length - 1 ? '<i class="fas fa-check"></i> Save Easy Button' : 'Next <i class="fas fa-arrow-right"></i>'}</button></footer>`;

      root.querySelectorAll("[data-mode]").forEach(button => button.addEventListener("click", () => { state.easyMode = button.dataset.mode; render(); }));
      root.querySelector("[data-add-die]")?.addEventListener("click", () => { syncInputs(); state.diceTerms.push({ count: 1, sides: 6 }); render(); });
      root.querySelectorAll("[data-remove-die]").forEach(button => button.addEventListener("click", () => { syncInputs(); if (state.diceTerms.length > 1) state.diceTerms.splice(Number(button.dataset.removeDie), 1); render(); }));
      root.querySelector("[data-add-variable]")?.addEventListener("click", () => { syncInputs(); state.variableTerms.push({ operator: "+", variableId: variables[0]?.value ?? "" }); render(); });
      root.querySelectorAll("[data-remove-variable]").forEach(button => button.addEventListener("click", () => { syncInputs(); state.variableTerms.splice(Number(button.dataset.removeVariable), 1); render(); }));
      root.querySelector("[data-add-widget]")?.addEventListener("click", () => { syncInputs(); state.widgetTerms.push({ operator: "+", widgetKey: widgets[0]?.value ?? "" }); render(); });
      root.querySelectorAll("[data-remove-widget]").forEach(button => button.addEventListener("click", () => { syncInputs(); state.widgetTerms.splice(Number(button.dataset.removeWidget), 1); render(); }));
      root.querySelectorAll("input,select,textarea").forEach(input => input.addEventListener("input", () => {
        syncInputs(); const preview = root.querySelector(".sdew-preview code"); if (preview) preview.textContent = buildEasyButtonFormula(state);
      }));
      root.querySelector("[data-cancel]")?.addEventListener("click", () => finish(null));
      root.querySelector("[data-back]")?.addEventListener("click", () => { syncInputs(); const list = pages(); page = list[Math.max(0, list.indexOf(page) - 1)]; render(); });
      root.querySelector("[data-next]")?.addEventListener("click", () => {
        syncInputs();
        const sequenceNow = pages();
        const current = sequenceNow.indexOf(page);
        if (page === "mode") {
          const key = normalizeWidgetKey(state.widgetKey, "");
          const used = collectWidgetKeys(tabs, state.id);
          for (const entry of options.additionalWidgets ?? []) if (entry?.id !== state.id && entry?.widgetKey) used.add(String(entry.widgetKey));
          if (!String(state.label ?? "").trim()) { ui.notifications?.warn?.("Display name is required."); return; }
          if (!key) { ui.notifications?.warn?.("Widget Key is required."); return; }
          if (used.has(key)) { ui.notifications?.warn?.(`Widget Key “${key}” already exists on this sheet.`); return; }
          state.widgetKey = key;
        }
        if (current < sequenceNow.length - 1) { page = sequenceNow[current + 1]; render(); return; }
        const result = normalizeEasyButtonConfig(state);
        result.formula = buildEasyButtonFormula(result);
        finish(result);
      });
    };

    render();
    app = openFoundryWindow({
      id: `sd-easy-button-${state.id || Math.random().toString(36).slice(2, 9)}`,
      title: options.title ?? (options.edit ? "Edit Easy Button" : "Create Easy Button"),
      icon: "fa-solid fa-dice-d20",
      width: 640,
      height: 650,
      minWidth: 430,
      minHeight: 430,
      classes: ["sd-easy-button-window"],
      content: root,
      onClose: () => finish(null)
    });
  });
}
