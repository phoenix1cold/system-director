import {
  getValueDefinitions, readDatabaseValue, valueStoragePath, coerceDatabaseValue,
  createDatabaseVariables, removeDatabaseVariable, VALUE_DATABASE_TYPES, VALUE_DATABASE_SCOPES,
  valueTypeFormat, valueTypePlaceholder, valueTypeFormatHint, isAoeValueType
} from "./value-database.mjs";

const { ApplicationV2 } = foundry.applications.api;
const esc = value => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Display metadata per variable type. */
const TYPE_META = {
  number:        { label: "Number",          icon: "fa-hashtag" },
  integer:       { label: "Integer",         icon: "fa-arrow-down-1-9" },
  text:          { label: "Text",            icon: "fa-font" },
  boolean:       { label: "Boolean",         icon: "fa-toggle-on" },
  color:         { label: "Color",           icon: "fa-palette" },
  array:         { label: "Array",           icon: "fa-list-ol" },
  object:        { label: "Object",          icon: "fa-brackets-curly" },
  aoe_template:  { label: "AOE Template",    icon: "fa-bullseye" },
  aoe_templates: { label: "AOE Templates[]", icon: "fa-bullseye" }
};
const typeMeta = type => TYPE_META[String(type ?? "")] ?? { label: String(type ?? ""), icon: "fa-cube" };
const SCOPE_LABELS = { both: "Actor & Item", actor: "Actor", item: "Item" };
const scopeLabel = scope => SCOPE_LABELS[String(scope ?? "")] ?? String(scope ?? "");

/** Default initial value per type. A draft still holding one of these is auto-managed. */
const AUTO_INITIALS = { number: "0", integer: "0", text: "", boolean: "false", color: "#7aa2ff", array: "[]", object: "{}", aoe_template: "{}", aoe_templates: "[]" };
const autoInitial = type => AUTO_INITIALS[String(type ?? "")] ?? "";
const isAutoInitial = value => Object.values(AUTO_INITIALS).includes(String(value ?? "").trim());

/** Full format line shown under a draft row, follows the selected type live. */
const formatLine = type => {
  const format = valueTypeFormat(type);
  return `<p class="sd-db-draft-format" data-draft-format><i class="fas fa-keyboard"></i><b>${esc(typeMeta(type).label)}</b><code>${esc(format.example)}</code><small>${esc(format.hint)}</small></p>`;
};

const aoeSummary = value => {
  const list = Array.isArray(value) ? value : (value && typeof value === "object" && Object.keys(value).length ? [value] : []);
  if (!list.length) return { count: 0, text: "No template drawn yet" };
  return { count: list.length, text: `${list.length} template${list.length === 1 ? "" : "s"} · ${list.map(p => p?.name || "Region").join(", ")}` };
};

/**
 * The Database window.
 *
 * Any number of variables can be added with "Add Variable" before a single
 * "Save Changes" writes them all at once. Values are edited inline; complex
 * values (lists, AOE templates) open their dedicated editors from "Set…".
 */
export class ValueDatabaseApp extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "sd-value-database",
    classes: ["sd", "sd-value-database-app"],
    position: { width: 820, height: 700 },
    window: { title: "Database", icon: "fa-solid fa-database", resizable: true, minimizable: true }
  };

  constructor({ doc = null } = {}) {
    super();
    this.doc = doc;
    this.drafts = [];
    this._filter = "";
    this._focusDraft = null;
  }

  static open(options = {}) {
    const app = new ValueDatabaseApp(options);
    app.render(true);
    return app;
  }

  get title() { return this.doc ? `Database — ${this.doc.name}` : "Database"; }
  get scope() { return this.doc?.documentName === "Item" ? "item" : "actor"; }
  get definitions() {
    return getValueDefinitions().filter(def => !this.doc || def.scope === "both" || def.scope === this.scope);
  }

  /* ------------------------------------------------------------------ */
  /*  Rendering                                                          */
  /* ------------------------------------------------------------------ */

  _valueControl(def) {
    const value = this.doc ? readDatabaseValue(this.doc, def.id) : def.initial;
    const hint = esc(valueTypeFormatHint(def.type));
    const ph = esc(valueTypePlaceholder(def.type));
    if (def.type === "boolean") {
      return `<label class="sd-db-switch" title="${hint}"><input type="checkbox" data-value-id="${esc(def.id)}" ${value ? "checked" : ""}><span class="sd-db-switch-track"></span><span class="sd-db-switch-text" data-switch-text>${value ? "true" : "false"}</span></label>`;
    }
    if (def.type === "color") {
      const color = /^#[0-9a-f]{6}$/i.test(String(value ?? "")) ? String(value) : "#7aa2ff";
      return `<span class="sd-db-color" title="${hint}"><input type="color" data-value-id="${esc(def.id)}" value="${esc(color)}"><code data-color-text>${esc(color)}</code></span>`;
    }
    if (isAoeValueType(def.type)) {
      const multiple = def.type === "aoe_templates";
      const text = typeof value === "string" ? value : JSON.stringify(value ?? (multiple ? [] : {}));
      const summary = aoeSummary(value);
      return `<div class="sd-db-complex sd-db-aoe" title="${hint}">
        <button type="button" class="sd-db-set-btn" data-action="editAoe" data-value-target="${esc(def.id)}" title="Draw the AOE area${multiple ? "s" : ""} with the Region tools on the scene"><i class="fas fa-bullseye"></i> Set…</button>
        <span class="sd-db-complex-summary ${summary.count ? "" : "is-empty"}" data-aoe-summary="${esc(def.id)}">${esc(summary.text)}</span>
        <textarea data-value-id="${esc(def.id)}" rows="2" placeholder="${ph}" hidden>${esc(text)}</textarea></div>`;
    }
    if (["array", "object"].includes(def.type)) {
      const text = typeof value === "string" ? value : JSON.stringify(value ?? (def.type === "array" ? [] : {}));
      const editButton = def.type === "array"
        ? `<button type="button" class="sd-db-set-btn" data-action="editArray" data-value-target="${esc(def.id)}" title="Edit the list visually: drop items, pick variables"><i class="fas fa-list-ol"></i> Set…</button>`
        : "";
      return `<div class="sd-db-complex">${editButton}<textarea data-value-id="${esc(def.id)}" rows="1" placeholder="${ph}" title="${hint}" spellcheck="false">${esc(text)}</textarea></div>`;
    }
    const numeric = ["number", "integer"].includes(def.type);
    return `<input class="sd-db-input" type="${numeric ? "number" : "text"}" ${numeric ? 'step="any"' : ""} data-value-id="${esc(def.id)}" value="${esc(value)}" placeholder="${ph}" title="${hint}"
      ${def.min != null ? `min="${esc(def.min)}"` : ""} ${def.max != null ? `max="${esc(def.max)}"` : ""}>`;
  }

  _draftRow(draft, index) {
    const aoe = isAoeValueType(draft.type);
    const summary = aoe ? (() => { try { return aoeSummary(JSON.parse(draft.initial || "null")); } catch { return aoeSummary(null); } })() : null;
    return `<div class="sd-db-draft" data-draft-index="${index}">
      <div class="sd-db-draft-head">
        <span class="sd-db-badge sd-db-badge-new"><i class="fas fa-plus"></i> New variable</span>
        <button type="button" class="sd-db-icon-btn danger" data-action="removeDraft" title="Discard this row"><i class="fas fa-xmark"></i></button>
      </div>
      <div class="sd-db-draft-grid">
        <label><span>Name</span><input class="sd-db-input" data-draft="name" value="${esc(draft.name)}" placeholder="e.g. Health" autocomplete="off"></label>
        <label><span>Type</span><select class="sd-db-input" data-draft="type">${VALUE_DATABASE_TYPES.map(type => `<option value="${type}" ${draft.type === type ? "selected" : ""}>${esc(typeMeta(type).label)}</option>`).join("")}</select></label>
        <label><span>Scope</span><select class="sd-db-input" data-draft="scope">${VALUE_DATABASE_SCOPES.map(scope => `<option value="${scope}" ${draft.scope === scope ? "selected" : ""}>${esc(scopeLabel(scope))}</option>`).join("")}</select></label>
        <label><span>Initial value</span>
          ${aoe
            ? `<span class="sd-db-complex sd-db-aoe"><button type="button" class="sd-db-set-btn" data-action="draftAoe" title="Draw the initial AOE area${draft.type === "aoe_templates" ? "s" : ""} on the scene"><i class="fas fa-bullseye"></i> Draw…</button><span class="sd-db-complex-summary ${summary.count ? "" : "is-empty"}" data-draft-aoe-summary>${esc(summary.text)}</span></span>`
            : ""}
          <input class="sd-db-input" data-draft="initial" value="${esc(draft.initial)}" placeholder="${esc(valueTypePlaceholder(draft.type))}" title="${esc(valueTypeFormatHint(draft.type))}" autocomplete="off" ${aoe ? "hidden" : ""}>
        </label>
      </div>
      ${formatLine(draft.type)}
    </div>`;
  }

  _row(def, isGM) {
    const meta = typeMeta(def.type);
    const search = `${def.name} ${def.id} ${meta.label} ${scopeLabel(def.scope)}`.toLowerCase();
    return `<div class="sd-db-row" data-variable-id="${esc(def.id)}" data-search="${esc(search)}">
      <span class="sd-db-type" data-type="${esc(def.type)}" title="${esc(meta.label)}"><i class="fas ${meta.icon}"></i></span>
      <div class="sd-db-row-name">
        <b>${esc(def.name)}</b>
        <span class="sd-db-meta"><code title="Variable ID">${esc(def.id)}</code><em>${esc(meta.label)}</em><em title="Scope">${esc(scopeLabel(def.scope))}</em></span>
      </div>
      <div class="sd-db-row-control">${this._valueControl(def)}</div>
      ${isGM ? `<button type="button" class="sd-db-icon-btn danger sd-db-row-remove" data-action="removeVariable" title="Delete this variable from the Database"><i class="fas fa-trash"></i></button>` : `<span></span>`}
    </div>`;
  }

  async _renderHTML() {
    const defs = this.definitions;
    const isGM = !!game.user?.isGM;
    const counts = { actor: 0, item: 0, both: 0 };
    for (const def of defs) counts[def.scope] = (counts[def.scope] ?? 0) + 1;
    const rows = defs.map(def => this._row(def, isGM)).join("");
    const contextLabel = this.doc ? `${this.doc.documentName}: ${this.doc.name}` : "World defaults";
    const subtitle = this.doc
      ? "Values stored on this sheet. Typed variables are available to Blueprint graphs, widgets and effects."
      : "Declared default values of every typed variable. New Actors and Items start from these.";

    return `<div class="sd-db-app">
      <header class="sd-db-head">
        <span class="sd-db-head-icon"><i class="fas fa-database"></i></span>
        <div class="sd-db-head-text">
          <h2>${esc(this.doc ? this.doc.name : "Database")}</h2>
          <small>${subtitle}</small>
        </div>
        <label class="sd-db-search" title="Filter by name, ID, type or scope">
          <i class="fas fa-magnifying-glass"></i>
          <input type="search" data-filter placeholder="Search variables…" value="${esc(this._filter)}" autocomplete="off">
        </label>
        <button type="button" class="sd-db-btn primary" data-action="addVariable"><i class="fas fa-plus"></i> Add Variable</button>
      </header>
      <div class="sd-db-stats">
        <span class="sd-db-chip accent"><i class="fas fa-location-dot"></i> ${esc(contextLabel)}</span>
        <span class="sd-db-chip"><b>${defs.length}</b> variable${defs.length === 1 ? "" : "s"}</span>
        ${counts.both ? `<span class="sd-db-chip"><b>${counts.both}</b> shared</span>` : ""}
        ${counts.actor ? `<span class="sd-db-chip"><b>${counts.actor}</b> actor</span>` : ""}
        ${counts.item ? `<span class="sd-db-chip"><b>${counts.item}</b> item</span>` : ""}
        ${this.drafts.length ? `<span class="sd-db-chip new"><b>${this.drafts.length}</b> unsaved</span>` : ""}
      </div>
      <section class="sd-db-body">
        ${this.drafts.length ? `<div class="sd-db-section">
          <div class="sd-db-section-title"><i class="fas fa-wand-magic-sparkles"></i> New variables <small>created on Save</small></div>
          <div class="sd-db-drafts" data-region="drafts">${this.drafts.map((draft, index) => this._draftRow(draft, index)).join("")}</div>
        </div>` : ""}
        <div class="sd-db-section">
          <div class="sd-db-section-title"><i class="fas fa-cubes"></i> Variables <small data-visible-count>${defs.length}</small></div>
          <div class="sd-db-list">${rows || `<div class="sd-db-empty"><i class="fas fa-database"></i><b>The Database is empty</b><span>Create typed variables here; Blueprint graphs read and write them without storage paths.</span><button type="button" class="sd-db-btn primary" data-action="addVariable"><i class="fas fa-plus"></i> Add the first variable</button></div>`}</div>
          <div class="sd-db-empty sd-db-no-match" hidden><i class="fas fa-filter"></i><b>No variable matches the filter</b></div>
        </div>
      </section>
      <footer class="sd-db-foot">
        <span class="sd-db-foot-note"><i class="fas fa-circle-info"></i> Changes are written when you press <b>Save Changes</b>.</span>
        <span class="sd-db-spacer"></span>
        <button type="button" class="sd-db-btn primary" data-action="save"><i class="fas fa-floppy-disk"></i> Save Changes</button>
      </footer>
    </div>`;
  }

  _replaceHTML(html, content) {
    content.innerHTML = html;
    content.style.padding = "0";
    content.style.overflow = "hidden";
    const app = content.querySelector(".sd-db-app");
    const theme = document.documentElement?.getAttribute?.("data-sd-theme") || document.body?.getAttribute?.("data-sd-theme");
    const fx = document.documentElement?.getAttribute?.("data-sd-theme-fx") || document.body?.getAttribute?.("data-sd-theme-fx");
    if (app && theme) app.setAttribute("data-sd-theme", theme);
    if (app && fx) app.setAttribute("data-sd-theme-fx", fx);
  }

  /* ------------------------------------------------------------------ */
  /*  State                                                              */
  /* ------------------------------------------------------------------ */

  _syncDrafts() {
    for (const row of this.element?.querySelectorAll?.("[data-draft-index]") ?? []) {
      const draft = this.drafts[Number(row.dataset.draftIndex)];
      if (!draft) continue;
      for (const field of ["name", "type", "scope", "initial"]) {
        const input = row.querySelector(`[data-draft="${field}"]`);
        if (input) draft[field] = input.value;
      }
    }
  }

  _collectValues() {
    const out = {};
    for (const def of this.definitions) {
      const input = this.element?.querySelector?.(`[data-value-id="${CSS.escape(def.id)}"]`);
      if (!input) continue;
      let raw = def.type === "boolean" ? !!input.checked : input.value;
      if (["array", "object"].includes(def.type) || isAoeValueType(def.type)) {
        const listLike = def.type === "array" || def.type === "aoe_templates";
        try { raw = JSON.parse(raw); } catch { raw = listLike ? [] : {}; }
      }
      out[def.id] = coerceDatabaseValue(raw, def);
    }
    return out;
  }

  _applyFilter() {
    const root = this.element;
    const query = String(this._filter ?? "").trim().toLowerCase();
    let visible = 0;
    for (const row of root?.querySelectorAll?.(".sd-db-row") ?? []) {
      const match = !query || String(row.dataset.search ?? "").includes(query);
      row.hidden = !match;
      if (match) visible++;
    }
    const counter = root?.querySelector?.("[data-visible-count]");
    if (counter) counter.textContent = query ? `${visible} / ${this.definitions.length}` : String(this.definitions.length);
    const noMatch = root?.querySelector?.(".sd-db-no-match");
    if (noMatch) noMatch.hidden = !(query && !visible && this.definitions.length);
  }

  /** Open the AOE capture (Region tools on the scene) for a JSON field and write the result back. */
  async _editAoeField(field, { multiple, title }) {
    if (!field) return null;
    let current = null;
    try { current = field.value.trim() ? JSON.parse(field.value) : null; } catch { current = null; }
    const { captureAoeFromScene } = await import("./aoe-scene-capture.mjs");
    const result = await captureAoeFromScene(current, { multiple, title });
    if (result === null || result === undefined) return null;
    field.value = JSON.stringify(result);
    field.dispatchEvent(new Event("change", { bubbles: true }));
    return result;
  }

  /* ------------------------------------------------------------------ */
  /*  Events                                                             */
  /* ------------------------------------------------------------------ */

  _onRender() {
    super._onRender?.();
    const root = this.element;

    root.querySelectorAll('[data-action="addVariable"]').forEach(button => button.addEventListener("click", () => {
      this._syncDrafts();
      this.drafts.push({ name: "", type: "number", scope: this.doc ? this.scope : "both", initial: "0" });
      this._focusDraft = this.drafts.length - 1;
      this.render();
    }));

    const filter = root.querySelector("[data-filter]");
    filter?.addEventListener("input", () => { this._filter = filter.value; this._applyFilter(); });
    this._applyFilter();

    root.querySelectorAll(".sd-db-switch input").forEach(input => input.addEventListener("change", () => {
      const text = input.closest(".sd-db-switch")?.querySelector("[data-switch-text]");
      if (text) text.textContent = input.checked ? "true" : "false";
    }));
    root.querySelectorAll(".sd-db-color input").forEach(input => input.addEventListener("input", () => {
      const text = input.closest(".sd-db-color")?.querySelector("[data-color-text]");
      if (text) text.textContent = input.value;
    }));

    root.querySelectorAll('[data-draft="type"]').forEach(select => select.addEventListener("change", () => {
      const row = select.closest("[data-draft-index]");
      const initial = row?.querySelector('[data-draft="initial"]');
      if (initial) {
        initial.placeholder = valueTypePlaceholder(select.value);
        initial.title = valueTypeFormatHint(select.value);
        // Only overwrite a value the user never customised.
        if (isAutoInitial(initial.value)) initial.value = autoInitial(select.value);
      }
      this._syncDrafts();
      // Switching to or from an AOE type swaps the text input for the Draw… button.
      const hadAoeButton = !!row?.querySelector('[data-action="draftAoe"]');
      if (hadAoeButton !== isAoeValueType(select.value)) { this._focusDraft = Number(row?.dataset.draftIndex); this.render(); return; }
      const line = row?.querySelector("[data-draft-format]");
      if (line) line.outerHTML = formatLine(select.value);
    }));

    root.querySelectorAll('[data-action="draftAoe"]').forEach(button => button.addEventListener("click", async () => {
      this._syncDrafts();
      const row = button.closest("[data-draft-index]");
      const draft = this.drafts[Number(row?.dataset.draftIndex)];
      const field = row?.querySelector('[data-draft="initial"]');
      if (!draft || !field) return;
      const multiple = draft.type === "aoe_templates";
      const result = await this._editAoeField(field, { multiple, title: `${draft.name || "New variable"} — initial AOE template${multiple ? "s" : ""}` });
      if (result === null) return;
      this._syncDrafts();
      const summary = row.querySelector("[data-draft-aoe-summary]");
      if (summary) { const info = aoeSummary(result); summary.textContent = info.text; summary.classList.toggle("is-empty", !info.count); }
    }));

    root.querySelectorAll('[data-action="editAoe"]').forEach(button => button.addEventListener("click", async () => {
      const id = button.dataset.valueTarget;
      const field = root.querySelector(`textarea[data-value-id="${CSS.escape(id)}"]`);
      const def = this.definitions.find(entry => entry.id === id);
      if (!field || !def) return;
      const multiple = def.type === "aoe_templates";
      const result = await this._editAoeField(field, { multiple, title: `${def.name} — AOE template${multiple ? "s" : ""}` });
      if (result === null) return;
      const summary = root.querySelector(`[data-aoe-summary="${CSS.escape(id)}"]`);
      if (summary) { const info = aoeSummary(result); summary.textContent = `${info.text} · unsaved`; summary.classList.remove("is-empty"); }
    }));

    root.querySelectorAll('[data-action="removeDraft"]').forEach(button => button.addEventListener("click", event => {
      this._syncDrafts();
      const index = Number(event.target.closest("[data-draft-index]")?.dataset.draftIndex);
      if (Number.isInteger(index)) this.drafts.splice(index, 1);
      this.render();
    }));

    root.querySelectorAll('[data-action="removeVariable"]').forEach(button => button.addEventListener("click", async event => {
      const id = event.target.closest("[data-variable-id]")?.dataset.variableId;
      if (!id) return;
      const confirmed = await foundry.applications.api.DialogV2.confirm({
        window: { title: "Delete Database Variable" },
        content: `<p>Delete <b>${esc(id)}</b> from the Database? Widgets and graphs referencing it will stop resolving.</p>`
      }).catch(() => false);
      if (!confirmed) return;
      await removeDatabaseVariable(id);
      this.render();
    }));

    root.querySelectorAll('[data-action="editArray"]').forEach(button => button.addEventListener("click", async () => {
      const id = button.dataset.valueTarget;
      const field = root.querySelector(`textarea[data-value-id="${CSS.escape(id)}"]`);
      if (!field) return;
      const { openArrayValueEditor } = await import("./array-value-editor.mjs");
      const def = this.definitions.find(entry => entry.id === id);
      const result = await openArrayValueEditor(field.value, { doc: this.doc, title: def?.name ?? id });
      if (result === null || result === undefined) return;
      field.value = JSON.stringify(result);
    }));

    root.querySelector('[data-action="save"]')?.addEventListener("click", () => this._save());

    // Focus only the row that was just added, never steal focus on every re-render.
    if (Number.isInteger(this._focusDraft)) {
      root.querySelector(`[data-draft-index="${this._focusDraft}"] [data-draft="name"]`)?.focus?.();
      this._focusDraft = null;
    }
  }

  async _save() {
    this._syncDrafts();
    const values = this._collectValues();
    const drafts = this.drafts.filter(draft => String(draft.name ?? "").trim());
    try {
      if (this.doc && Object.keys(values).length) {
        await this.doc.update(Object.fromEntries(Object.entries(values).map(([id, value]) => [valueStoragePath(id), value])));
      }
      let created = [];
      if (drafts.length) created = await createDatabaseVariables(drafts, { seedValues: !this.doc });
      if (!this.doc && Object.keys(values).length) {
        // World mode edits the declared initial value of each variable.
        const { updateDatabaseInitialValues } = await import("./value-database.mjs");
        await updateDatabaseInitialValues(values);
      }
      this.drafts = [];
      ui.notifications?.info?.(created.length
        ? `Database saved. Created ${created.length} variable(s).`
        : "Database saved.");
    } catch (error) {
      console.error("SD | Database save failed", error);
      ui.notifications?.error?.(`Database: ${error.message}`);
    }
    this.render();
  }
}

export function openValueDatabaseApp(options = {}) { return ValueDatabaseApp.open(options); }
