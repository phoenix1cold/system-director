import {
  getValueDefinitions, readDatabaseValue, valueStoragePath, coerceDatabaseValue,
  createDatabaseVariables, removeDatabaseVariable, VALUE_DATABASE_TYPES, VALUE_DATABASE_SCOPES,
  valueTypeFormat, valueTypePlaceholder, valueTypeFormatHint
} from "./value-database.mjs";

const { ApplicationV2 } = foundry.applications.api;
const esc = value => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Default initial value per type. A draft still holding one of these is auto-managed. */
const AUTO_INITIALS = { number: "0", integer: "0", text: "", boolean: "false", color: "#7aa2ff", array: "[]", object: "{}" };
const autoInitial = type => AUTO_INITIALS[String(type ?? "")] ?? "";
const isAutoInitial = value => Object.values(AUTO_INITIALS).includes(String(value ?? "").trim());

/** Compact "how do I type this" chip shown next to every existing variable. */
const formatChip = type => {
  const format = valueTypeFormat(type);
  return `<span class="sd-db-fmt-chip" title="${esc(valueTypeFormatHint(type))}"><i class="fas fa-keyboard"></i><code>${esc(format.example)}</code></span>`;
};

/** Full format line shown under a draft row, follows the selected type live. */
const formatLine = type => {
  const format = valueTypeFormat(type);
  return `<p class="sd-db-draft-format" data-draft-format><i class="fas fa-keyboard"></i> <b>${esc(type)}</b> <code>${esc(format.example)}</code> <small>${esc(format.hint)}</small></p>`;
};

/**
 * The Database window.
 *
 * Any number of variables can be added with "Add Variable" before a single
 * "Save Changes" writes them all at once.
 */
export class ValueDatabaseApp extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "sd-value-database",
    classes: ["sd", "sd-value-database-app"],
    position: { width: 760, height: 680 },
    window: { title: "Database", icon: "fa-solid fa-database", resizable: true, minimizable: true }
  };

  constructor({ doc = null } = {}) {
    super();
    this.doc = doc;
    this.drafts = [];
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

  _valueControl(def) {
    const value = this.doc ? readDatabaseValue(this.doc, def.id) : def.initial;
    const hint = esc(valueTypeFormatHint(def.type));
    const ph = esc(valueTypePlaceholder(def.type));
    if (def.type === "boolean") return `<input type="checkbox" data-value-id="${esc(def.id)}" title="${hint}" ${value ? "checked" : ""}>`;
    if (def.type === "color") return `<input type="color" data-value-id="${esc(def.id)}" title="${hint}" value="${esc(value || "#7aa2ff")}">`;
    if (["array", "object"].includes(def.type)) {
      const text = typeof value === "string" ? value : JSON.stringify(value ?? (def.type === "array" ? [] : {}));
      return `<textarea data-value-id="${esc(def.id)}" rows="2" placeholder="${ph}" title="${hint}">${esc(text)}</textarea>`;
    }
    const numeric = ["number", "integer"].includes(def.type);
    return `<input type="${numeric ? "number" : "text"}" ${numeric ? 'step="any"' : ""} data-value-id="${esc(def.id)}" value="${esc(value)}" placeholder="${ph}" title="${hint}"
      ${def.min != null ? `min="${esc(def.min)}"` : ""} ${def.max != null ? `max="${esc(def.max)}"` : ""}>`;
  }

  _draftRow(draft, index) {
    return `<div class="sd-db-draft" data-draft-index="${index}">
      <span class="sd-db-draft-badge"><i class="fas fa-plus"></i> New</span>
      <input data-draft="name" value="${esc(draft.name)}" placeholder="Variable name" autocomplete="off">
      <select data-draft="type">${VALUE_DATABASE_TYPES.map(type => `<option value="${type}" ${draft.type === type ? "selected" : ""}>${type}</option>`).join("")}</select>
      <select data-draft="scope">${VALUE_DATABASE_SCOPES.map(scope => `<option value="${scope}" ${draft.scope === scope ? "selected" : ""}>${scope}</option>`).join("")}</select>
      <input data-draft="initial" value="${esc(draft.initial)}" placeholder="${esc(valueTypePlaceholder(draft.type))}" title="${esc(valueTypeFormatHint(draft.type))}" autocomplete="off">
      <button type="button" class="sd-db-draft-remove" data-action="removeDraft" title="Discard this row"><i class="fas fa-xmark"></i></button>
      ${formatLine(draft.type)}
    </div>`;
  }

  async _renderHTML() {
    const defs = this.definitions;
    const isGM = !!game.user?.isGM;
    const rows = defs.map(def => `<div class="sd-db-row" data-variable-id="${esc(def.id)}">
      <span class="sd-db-row-name"><i class="fas fa-cube"></i><b>${esc(def.name)}</b><small>${esc(def.id)} · ${esc(def.type)} · ${esc(def.scope)}</small>${formatChip(def.type)}</span>
      <span class="sd-db-row-control">${this._valueControl(def)}</span>
      ${isGM ? `<button type="button" class="sd-db-row-remove" data-action="removeVariable" title="Delete this variable from the Database"><i class="fas fa-trash"></i></button>` : ""}
    </div>`).join("");

    return `<div class="sd-db-app">
      <header class="sd-db-head">
        <i class="fas fa-database"></i>
        <div><b>${esc(this.doc ? this.doc.name : "World Database")}</b>
          <small>${this.doc ? "Values of this sheet. Typed variables are available to Blueprint graphs and effects." : "Default values of every typed variable."}</small></div>
        <button type="button" class="sd-db-add" data-action="addVariable"><i class="fas fa-plus"></i> Add Variable</button>
      </header>
      <section class="sd-db-body">
        <div class="sd-db-drafts" data-region="drafts">${this.drafts.map((draft, index) => this._draftRow(draft, index)).join("")}</div>
        ${this.drafts.length ? `<p class="sd-db-hint"><i class="fas fa-circle-info"></i> ${this.drafts.length} new variable(s) will be created when you save. Press <b>Add Variable</b> again for more.</p>` : ""}
        <div class="sd-db-list">${rows || `<div class="sd-db-empty">Database is empty. Press <b>Add Variable</b> to create one.</div>`}</div>
      </section>
      <footer class="sd-db-foot">
        <span class="sd-db-foot-note"><i class="fas fa-circle-info"></i> Use <b>Add Variable</b> in the header to add more rows.</span>
        <span class="sd-db-spacer"></span>
        <button type="button" class="sd-db-primary" data-action="save"><i class="fas fa-floppy-disk"></i> Save Changes</button>
      </footer>
    </div>`;
  }

  _replaceHTML(html, content) { content.innerHTML = html; content.style.padding = "0"; }

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
      if (["array", "object"].includes(def.type)) {
        try { raw = JSON.parse(raw); } catch { raw = def.type === "array" ? [] : {}; }
      }
      out[def.id] = coerceDatabaseValue(raw, def);
    }
    return out;
  }

  _onRender() {
    super._onRender?.();
    const root = this.element;
    root.querySelectorAll('[data-action="addVariable"]').forEach(button => button.addEventListener("click", () => {
      this._syncDrafts();
      this.drafts.push({ name: "", type: "number", scope: this.doc ? this.scope : "both", initial: "0" });
      this.render();
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
      const line = row?.querySelector("[data-draft-format]");
      if (line) line.outerHTML = formatLine(select.value);
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
    root.querySelector('[data-action="save"]')?.addEventListener("click", () => this._save());
    root.querySelector('[data-draft="name"]')?.focus?.();
  }

  async _save() {
    this._syncDrafts();
    const values = this._collectValues();
    const drafts = this.drafts.filter(draft => String(draft.name ?? "").trim());
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
    this.render();
  }
}

export function openValueDatabaseApp(options = {}) { return ValueDatabaseApp.open(options); }
