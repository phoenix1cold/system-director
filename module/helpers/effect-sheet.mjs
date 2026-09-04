import { getValueDefinitions, getValueDefinition, valueStoragePath } from "./value-database.mjs";

/**
 * SD Active Effect window.
 *
 * Replaces Foundry's native effect config (with its raw "Attribute Key" text
 * field) by a window that only ever speaks in Database variables. A change is
 * stored as `system.values.<variableId>` so the SD effect handler
 * (module/documents/active-effect.mjs) can resolve and apply it.
 */

const { DocumentSheetV2 } = foundry.applications.api;

const esc = (s) => String(s ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

/** Active Effect change modes, mirrored from CONST.ACTIVE_EFFECT_MODES. */
export const SD_EFFECT_MODES = [
  { value: 0, label: "SD.Effects.ModeCustom",    fallback: "Custom" },
  { value: 1, label: "SD.Effects.ModeMultiply",  fallback: "Multiply" },
  { value: 2, label: "SD.Effects.ModeAdd",       fallback: "Add" },
  { value: 3, label: "SD.Effects.ModeDowngrade", fallback: "Downgrade" },
  { value: 4, label: "SD.Effects.ModeUpgrade",   fallback: "Upgrade" },
  { value: 5, label: "SD.Effects.ModeOverride",  fallback: "Override" }
];

function t(key, fallback) {
  try {
    const out = game.i18n?.localize?.(key);
    if (out && out !== key) return out;
  } catch { /* ignore */ }
  return fallback;
}

/** Numeric mode for a stored change, tolerating v14 string `type` values. */
function changeMode(change) {
  const raw = change?.mode;
  if (raw !== undefined && raw !== null && raw !== "") return Number(raw) || 0;
  const byType = { custom: 0, multiply: 1, add: 2, downgrade: 3, upgrade: 4, override: 5 };
  return byType[String(change?.type ?? "").toLowerCase()] ?? 2;
}

/** Resolve the Database variable id a stored change points at. */
function changeVariableId(change, defs) {
  const direct = String(change?.variableId ?? "").trim();
  if (direct) return direct;
  const key = String(change?.key ?? "").trim();
  if (!key) return "";
  const hit = defs.find(d => valueStoragePath(d.id) === key || d.legacyPath === key || d.id === key);
  return hit?.id ?? "";
}

/** Resolve the SD transfer mode of an effect: "always" | "equipped" | "item". */
export function effectTransferMode(ef) {
  const explicit = ef?.flags?.sd?.effectTransferMode;
  if (["always", "equipped", "item"].includes(explicit)) return explicit;
  if (ef?.transfer === false) return "item";
  return ef?.flags?.sd?.activateOnEquip ? "equipped" : "always";
}

export class SDEffectSheet extends DocumentSheetV2 {
  static DEFAULT_OPTIONS = {
    classes: ["sd", "sd-effect-sheet"],
    tag: "div",
    window: { icon: "fa-solid fa-sparkles", resizable: true, minimizable: true },
    position: { width: 680, height: 720 },
    sheetConfig: false
  };

  get title() {
    const name = this.document?.name ?? t("SD.Effects.SheetTitle", "Effect");
    return `${t("SD.Effects.SheetTitle", "Effect")}: ${name}`;
  }

  /** Working copy so unsaved edits survive re-renders. */
  _draft() {
    if (this._sdDraft) return this._sdDraft;
    const ef = this.document;
    const defs = getValueDefinitions();
    this._sdDraft = {
      name: String(ef?.name ?? ""),
      img: String(ef?.img ?? ef?.icon ?? "icons/svg/aura.svg"),
      description: String(ef?.description ?? ""),
      disabled: !!ef?.disabled,
      transfer: !!ef?.transfer,
      mode: effectTransferMode(ef),
      rounds: Number(ef?.duration?.rounds ?? 0) || 0,
      seconds: Number(ef?.duration?.seconds ?? 0) || 0,
      changes: (ef?.changes ?? []).map(c => ({
        variableId: changeVariableId(c, defs),
        legacyKey: changeVariableId(c, defs) ? "" : String(c?.key ?? ""),
        mode: changeMode(c),
        value: String(c?.value ?? ""),
        priority: Number(c?.priority ?? 20) || 20
      }))
    };
    return this._sdDraft;
  }

  async _renderHTML() {
    const d = this._draft();
    const defs = getValueDefinitions();
    const canEdit = this.document?.isOwner !== false;
    const lock = canEdit ? "" : "disabled";
    const noVars = !defs.length;
    const parentDoc = this.document?.parent ?? null;
    const isItem = parentDoc?.documentName === "Item";
    const isInventory = isItem && parentDoc?.type === "inventory";
    const equippableNow = isInventory && parentDoc?.system?.equippable === true;
    const equippedNow = isInventory && parentDoc?.system?.equipped === true;
    const modeLabel = d.mode === "equipped"
      ? t("SD.Effects.ModeEquipped", "Transfer while equipped")
      : (d.mode === "item" ? t("SD.Effects.ModeItemOnly", "Item only") : t("SD.Effects.ModeAlways", "Always transfer"));
    const modeHint = d.mode === "equipped"
      ? t("SD.Effects.ModeEquippedHint", "Applied only while the item is equipped.")
      : (d.mode === "item"
        ? t("SD.Effects.ModeItemOnlyHint", "Never transferred to the actor.")
        : t("SD.Effects.ModeAlwaysHint", "Applied whenever the item is owned."));
    const modeIcon = d.mode === "equipped"
      ? "fa-shield-halved"
      : (d.mode === "item" ? "fa-lock" : "fa-arrow-right-to-bracket");

    const roundsLabel  = t("SD.Effects.Rounds", "Rounds");
    const secondsLabel = t("SD.Effects.Seconds", "Seconds");
    const duration = d.rounds
      ? `${d.rounds} ${roundsLabel.toLowerCase()}`
      : (d.seconds ? `${d.seconds} ${secondsLabel.toLowerCase()}` : t("SD.Effects.Permanent", "Permanent"));

    const chips = [
      d.disabled
        ? `<span class="sd-es-chip is-off"><i class="fas fa-circle-pause"></i> ${esc(t("SD.Effects.Disabled", "Disabled"))}</span>`
        : `<span class="sd-es-chip is-on"><i class="fas fa-circle-play"></i> ${esc(t("SD.Effects.Active", "Active"))}</span>`,
      `<span class="sd-es-chip"><i class="fas fa-hourglass-half"></i> ${esc(duration)}</span>`,
      `<span class="sd-es-chip is-accent"><i class="fas fa-sliders"></i> ${d.changes.length} ${esc(t("SD.Effects.Changes", "Changes"))}</span>`,
      isItem
        ? `<span class="sd-es-chip ${(d.mode === "equipped" && !equippableNow) ? "is-warn" : ""}"><i class="fas ${modeIcon}"></i> ${esc(modeLabel)}</span>`
        : (d.transfer
          ? `<span class="sd-es-chip"><i class="fas fa-user-shield"></i> ${esc(t("SD.Effects.Transfer", "Transfer to actor"))}</span>`
          : "")
    ].filter(Boolean).join("");

    const rows = d.changes.map((c, i) => {
      const options = [
        `<option value="">${esc(t("SD.Effects.SelectVariable", "Select variable…"))}</option>`,
        ...defs.map(v => `<option value="${esc(v.id)}" ${c.variableId === v.id ? "selected" : ""}>${esc(v.name)} · ${esc(v.type)}</option>`)
      ].join("");
      let meta = "";
      if (c.variableId) {
        const path = valueStoragePath(c.variableId);
        meta = `<span class="sd-es-storage" title="${esc(path)}">${esc(path)}</span>`;
      } else if (c.legacyKey) {
        meta = `<span class="sd-es-legacy" title="${esc(t("SD.Effects.LegacyKeyHint", "This change still points at a raw path. Pick a variable to migrate it."))}"><i class="fas fa-triangle-exclamation"></i> ${esc(c.legacyKey)}</span>`;
      }
      return `<div class="sd-es-change" data-index="${i}">
        <label>
          <span class="sd-es-colname">${esc(t("SD.Effects.Variable", "Database variable"))}</span>
          <select data-change="variableId" ${lock}>${options}</select>${meta}
        </label>
        <label>
          <span class="sd-es-colname">${esc(t("SD.Effects.Mode", "Mode"))}</span>
          <select data-change="mode" ${lock}>${SD_EFFECT_MODES.map(m => `<option value="${m.value}" ${Number(c.mode) === m.value ? "selected" : ""}>${esc(t(m.label, m.fallback))}</option>`).join("")}</select>
        </label>
        <label>
          <span class="sd-es-colname">${esc(t("SD.Effects.Value", "Value"))}</span>
          <input type="text" data-change="value" value="${esc(c.value)}" placeholder="${esc(t("SD.Effects.ValuePlaceholder", "Number or formula"))}" ${lock}>
        </label>
        <label>
          <span class="sd-es-colname">${esc(t("SD.Effects.Priority", "Priority"))}</span>
          <input type="number" data-change="priority" value="${Number(c.priority ?? 20)}" ${lock}>
        </label>
        <button type="button" class="sd-es-icon danger" data-action="removeChange" title="${esc(t("SD.Effects.RemoveChange", "Remove change"))}" ${lock}><i class="fas fa-trash"></i></button>
      </div>`;
    }).join("");

    const empty = noVars
      ? `<div class="sd-es-empty"><i class="fas fa-database"></i>
          <b>${esc(t("SD.Effects.NoVariablesTitle", "No Database variables yet"))}</b>
          <span>${esc(t("SD.Effects.NoVariables", "No Database variables yet. Add one in Settings → Configure System → Database."))}</span>
        </div>`
      : `<div class="sd-es-empty"><i class="fas fa-sliders"></i>
          <b>${esc(t("SD.Effects.NoChangesTitle", "No changes yet"))}</b>
          <span>${esc(t("SD.Effects.NoChangesHint", "Add a change to make this effect modify a Database variable."))}</span>
        </div>`;

    const head = rows
      ? `<div class="sd-es-change-head">
          <span>${esc(t("SD.Effects.Variable", "Database variable"))}</span>
          <span>${esc(t("SD.Effects.Mode", "Mode"))}</span>
          <span>${esc(t("SD.Effects.Value", "Value"))}</span>
          <span>${esc(t("SD.Effects.Priority", "Priority"))}</span>
          <span></span>
        </div>`
      : "";

    return `<div class="sd-es-root">
      <header class="sd-es-hero">
        <button type="button" class="sd-es-avatar" data-action="pickImage" title="${esc(t("SD.Effects.PickIcon", "Change icon"))}" ${lock}>
          <img src="${esc(d.img)}" alt="">
          <span class="sd-es-avatar-edit"><i class="fas fa-camera"></i></span>
        </button>
        <div class="sd-es-hero-main">
          <input class="sd-es-title" type="text" name="name" value="${esc(d.name)}" placeholder="${esc(t("SD.Effects.NamePlaceholder", "Effect name"))}" ${canEdit ? "" : "readonly"}>
          <div class="sd-es-chips">${chips}</div>
        </div>
      </header>

      <div class="sd-es-body">
        <section class="sd-es-card">
          <div class="sd-es-card-head">
            <h3><i class="fas fa-circle-info"></i> ${esc(t("SD.Effects.Overview", "Overview"))}</h3>
          </div>
          <div class="sd-es-card-body">
            <label class="sd-es-field">
              <span>${esc(t("SD.Effects.Description", "Description"))}</span>
              <textarea name="description" rows="3" placeholder="${esc(t("SD.Effects.DescriptionPlaceholder", "What does this effect do?"))}" ${canEdit ? "" : "readonly"}>${esc(d.description)}</textarea>
            </label>
            <div class="sd-es-duration">
              <label class="sd-es-field">
                <span>${esc(roundsLabel)}</span>
                <input type="number" min="0" name="rounds" value="${d.rounds}" ${lock}>
                <em class="sd-es-unit">${esc(t("SD.Effects.UnitRounds", "rd"))}</em>
              </label>
              <label class="sd-es-field">
                <span>${esc(secondsLabel)}</span>
                <input type="number" min="0" name="seconds" value="${d.seconds}" ${lock}>
                <em class="sd-es-unit">${esc(t("SD.Effects.UnitSeconds", "sec"))}</em>
              </label>
            </div>
            <div class="sd-es-switches">
              <label class="sd-es-switch">
                <input type="checkbox" name="disabled" ${d.disabled ? "checked" : ""} ${lock}>
                <span class="sd-es-track"></span>
                <span class="sd-es-switch-text">
                  <b>${esc(t("SD.Effects.Disabled", "Disabled"))}</b>
                  <small>${esc(t("SD.Effects.DisabledHint", "Keeps the effect on the document but stops applying it."))}</small>
                </span>
              </label>
              ${isItem ? "" : `<label class="sd-es-switch">
                <input type="checkbox" name="transfer" ${d.transfer ? "checked" : ""} ${lock}>
                <span class="sd-es-track"></span>
                <span class="sd-es-switch-text">
                  <b>${esc(t("SD.Effects.Transfer", "Transfer to actor"))}</b>
                  <small>${esc(t("SD.Effects.TransferHint", "Copies the effect onto the owning actor instead of staying on the item."))}</small>
                </span>
              </label>`}
            </div>
            ${isItem ? `<div class="sd-es-modecard">
              <div class="sd-es-modecard-head">
                <i class="fas ${modeIcon}"></i>
                <b>${esc(t("SD.Effects.TransferMode", "Transfer mode"))}</b>
              </div>
              <select name="transferMode" ${lock}>
                <option value="always" ${d.mode === "always" ? "selected" : ""}>${esc(t("SD.Effects.ModeAlways", "Always transfer"))}</option>
                ${isInventory ? `<option value="equipped" ${d.mode === "equipped" ? "selected" : ""}>${esc(t("SD.Effects.ModeEquipped", "Transfer while equipped"))}</option>` : ""}
                <option value="item" ${d.mode === "item" ? "selected" : ""}>${esc(t("SD.Effects.ModeItemOnly", "Item only"))}</option>
              </select>
              <p class="sd-es-modehint">${esc(modeHint)}</p>
              ${(d.mode === "equipped" && !equippableNow) ? `<p class="sd-es-modewarn"><i class="fas fa-triangle-exclamation"></i> ${esc(t("SD.Effects.EquipAutoHint", "Saving marks this item Equippable so the equip gate can open."))}</p>` : ""}
              ${(d.mode === "equipped" && equippableNow && !equippedNow) ? `<p class="sd-es-modehint"><i class="fas fa-circle-info"></i> ${esc(t("SD.Effects.EquipInactiveHint", "The item is not equipped right now, so the effect stays inactive."))}</p>` : ""}
            </div>` : ""}
          </div>
        </section>

        <section class="sd-es-card">
          <div class="sd-es-card-head">
            <div>
              <span class="sd-es-eyebrow">${esc(t("SD.Effects.ChangesEyebrow", "Database variables"))}</span>
              <h3>${esc(t("SD.Effects.Changes", "Changes"))} <span class="sd-es-count">${d.changes.length}</span></h3>
            </div>
            <button type="button" class="sd-es-add" data-action="addChange" ${noVars ? "disabled" : lock}><i class="fas fa-plus"></i> ${esc(t("SD.Effects.AddChange", "Add change"))}</button>
          </div>
          <div class="sd-es-changes">${head}${rows || empty}</div>
        </section>
      </div>

      <footer class="sd-es-footer">
        <span class="sd-es-hint"><i class="fas fa-database"></i> ${esc(t("SD.Effects.StorageHintShort", "Changes are written to"))} <code>system.values.&lt;variable&gt;</code></span>
        <div class="sd-es-actions">
          <button type="button" class="sd-es-btn" data-action="cancel">${esc(t("SD.Cancel", "Cancel"))}</button>
          <button type="button" class="sd-es-btn primary" data-action="save" ${lock}><i class="fas fa-floppy-disk"></i> ${esc(t("SD.Effects.Save", "Save changes"))}</button>
        </div>
      </footer>
    </div>`;
  }

  _replaceHTML(html, content) {
    content.innerHTML = html;
    content.style.padding = "0";
  }

  /** Read the form back into the draft. */
  _collect() {
    const root = this.element;
    const d = this._draft();
    if (!root) return d;
    const val = (sel, fb) => root.querySelector(sel)?.value ?? fb;
    d.name = String(val('[name="name"]', d.name));
    d.description = String(val('[name="description"]', d.description));
    d.rounds = Number(val('[name="rounds"]', d.rounds)) || 0;
    d.seconds = Number(val('[name="seconds"]', d.seconds)) || 0;
    d.disabled = !!root.querySelector('[name="disabled"]')?.checked;
    const modeEl = root.querySelector('[name="transferMode"]');
    if (modeEl) {
      d.mode = ["always", "equipped", "item"].includes(modeEl.value) ? modeEl.value : "always";
      d.transfer = d.mode !== "item";
    } else {
      d.transfer = !!root.querySelector('[name="transfer"]')?.checked;
      d.mode = d.transfer ? (d.mode === "equipped" ? "equipped" : "always") : "item";
    }
    d.changes = [...root.querySelectorAll(".sd-es-change")].map((row, i) => {
      const prev = d.changes[i] ?? {};
      const variableId = row.querySelector('[data-change="variableId"]')?.value ?? "";
      return {
        variableId: String(variableId),
        legacyKey: variableId ? "" : String(prev.legacyKey ?? ""),
        mode: Number(row.querySelector('[data-change="mode"]')?.value ?? 2),
        value: String(row.querySelector('[data-change="value"]')?.value ?? ""),
        priority: Number(row.querySelector('[data-change="priority"]')?.value ?? 20) || 20
      };
    });
    return d;
  }

  async _save({ close = false } = {}) {
    const d = this._collect();
    const changes = d.changes
      .map(c => {
        const key = c.variableId ? valueStoragePath(c.variableId) : String(c.legacyKey ?? "");
        if (!key) return null;
        return {
          key,
          mode: Number(c.mode ?? 2),
          value: String(c.value ?? ""),
          priority: Number(c.priority ?? 20) || 20
        };
      })
      .filter(Boolean);

    const payload = {
      name: d.name,
      img: d.img,
      description: d.description,
      disabled: d.disabled,
      transfer: d.transfer,
      changes,
      "duration.rounds": d.rounds || null,
      "duration.seconds": d.seconds || null
    };

    const parentDoc = this.document?.parent ?? null;
    if (parentDoc?.documentName === "Item") {
      const mode = ["always", "equipped", "item"].includes(d.mode) ? d.mode : "always";
      payload.transfer = mode !== "item";
      payload["flags.sd.effectTransferMode"] = mode;
      payload["flags.sd.activateOnEquip"] = mode === "equipped";
      if (mode === "equipped") {
        if (parentDoc.type === "inventory" && parentDoc.system?.equippable !== true) {
          try {
            await parentDoc.update({ "system.equippable": true });
            ui.notifications?.info?.(t("SD.Effects.AutoEquippable", "The item is now marked Equippable."));
          } catch (err) {
            console.warn("SD | could not mark the item equippable:", err);
          }
        }
        payload.disabled = d.disabled || parentDoc.system?.equipped !== true;
      }
    }

    try {
      await this.document.update(payload);
    } catch (err) {
      console.error("SD | failed to save effect:", err);
      ui.notifications?.error?.(t("SD.Effects.SaveFailed", "Could not save the effect."));
      return false;
    }
    this._sdDraft = null;
    if (close) await this.close();
    else await this.render();
    return true;
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const root = this.element;
    if (!root) return;

    root.querySelector('[data-action="save"]')?.addEventListener("click", (ev) => {
      ev.preventDefault();
      this._save({ close: true });
    });

    root.querySelector('[data-action="cancel"]')?.addEventListener("click", (ev) => {
      ev.preventDefault();
      this._sdDraft = null;
      this.close();
    });

    // Keep the header chips (Active / duration / change count) in sync while editing.
    root.querySelectorAll('[name="disabled"], [name="transfer"], [name="transferMode"], [name="rounds"], [name="seconds"]').forEach(el => {
      el.addEventListener("change", async () => {
        this._collect();
        await this.render();
      });
    });

    root.querySelector('[data-action="addChange"]')?.addEventListener("click", async (ev) => {
      ev.preventDefault();
      const d = this._collect();
      const first = getValueDefinitions()[0];
      d.changes.push({ variableId: first?.id ?? "", legacyKey: "", mode: 2, value: "", priority: 20 });
      await this.render();
      this.element?.querySelector('.sd-es-change:last-child [data-change="value"]')?.focus();
    });

    root.querySelectorAll('[data-action="removeChange"]').forEach(btn => {
      btn.addEventListener("click", async (ev) => {
        ev.preventDefault();
        const d = this._collect();
        const idx = Number(btn.closest(".sd-es-change")?.dataset?.index ?? -1);
        if (idx >= 0) d.changes.splice(idx, 1);
        await this.render();
      });
    });

    root.querySelector('[data-action="pickImage"]')?.addEventListener("click", async (ev) => {
      ev.preventDefault();
      const FP = foundry.applications?.apps?.FilePicker?.implementation ?? FilePicker;
      try {
        const picker = new FP({
          type: "image",
          current: this._draft().img,
          callback: async (path) => {
            this._collect();
            this._draft().img = String(path || "");
            await this.render();
          }
        });
        picker.render(true);
      } catch (err) {
        console.warn("SD | file picker unavailable:", err);
      }
    });

    // Selecting a variable clears the legacy-path warning immediately.
    root.querySelectorAll('[data-change="variableId"]').forEach(sel => {
      sel.addEventListener("change", () => {
        const row = sel.closest(".sd-es-change");
        if (sel.value) row?.querySelector(".sd-es-legacy")?.remove();
        const def = getValueDefinition(sel.value);
        const input = row?.querySelector('[data-change="value"]');
        if (def && input && !input.value) input.placeholder = String(def.initial ?? "");
      });
    });
  }
}

/**
 * Register the SD effect window as the default ActiveEffect sheet so every
 * entry point (sheets, action HUD, progression) opens it instead of the
 * native "Attribute Key" dialog.
 */
export function registerEffectSheet() {
  const DSC = foundry.applications?.apps?.DocumentSheetConfig;
  if (!DSC?.registerSheet) {
    console.warn("SD | DocumentSheetConfig unavailable; effect sheet not registered");
    return;
  }
  try {
    const core = foundry.applications?.sheets?.ActiveEffectConfig;
    if (core) DSC.unregisterSheet(ActiveEffect, "core", core);
  } catch (err) {
    console.warn("SD | could not unregister the core effect sheet:", err);
  }
  try {
    DSC.registerSheet(ActiveEffect, "sd", SDEffectSheet, {
      makeDefault: true,
      label: "SD.Sheets.Effect"
    });
  } catch (err) {
    console.error("SD | failed to register the SD effect sheet:", err);
  }
}
