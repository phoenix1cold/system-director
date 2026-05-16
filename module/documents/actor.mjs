function _sdMsgMode() {
  try {
    const v = game.settings.get("core", "messageMode");
    if (v) return v;
  } catch {}
  try { return game.settings.get("core", "rollMode"); } catch {}
  return "publicroll";
}

// Foundry v14 ActiveEffects V2 use a string `change.type` (e.g. "add",
// "override"). Pre-V14 effects used a numeric `change.mode`. We accept both so
// old worlds keep working after the upgrade.
const SD_LEGACY_MODE_TO_TYPE = Object.freeze({
  0: "custom",
  1: "multiply",
  2: "add",
  3: "downgrade",
  4: "upgrade",
  5: "override"
});

const SD_DEFAULT_PRIORITY_BY_TYPE = Object.freeze({
  multiply:  10,
  add:       20,
  subtract:  20,
  downgrade: 40,
  upgrade:   40,
  override:  50,
  custom:    0
});

function _sdResolveChangeType(change) {
  const t = change?.type;
  if (typeof t === "string" && t) return t.toLowerCase();
  const m = Number(change?.mode);
  if (Number.isFinite(m) && SD_LEGACY_MODE_TO_TYPE[m]) return SD_LEGACY_MODE_TO_TYPE[m];
  return "add";
}

function _sdChangePriority(change, type) {
  const p = change?.priority;
  if (p === null || p === undefined) return SD_DEFAULT_PRIORITY_BY_TYPE[type] ?? 0;
  const n = Number(p);
  if (!Number.isFinite(n)) return SD_DEFAULT_PRIORITY_BY_TYPE[type] ?? 0;
  return n;
}

function _sdValuesEqual(a, b) {
  if (a === b) return true;
  if (typeof a === "number" && typeof b === "number") {
    if (Number.isNaN(a) && Number.isNaN(b)) return true;
  }
  return false;
}

/**
 * Sequentially apply an array of ActiveEffect `change` objects on top of
 * `start`, mirroring Foundry's standard numeric apply semantics
 * (add / multiply / override / upgrade / downgrade). Supports both the v14
 * `change.type` (string) and the legacy `change.mode` (number) for backwards
 * compatibility.
 */
function _sdApplyChangesToValue(start, changes) {
  const sorted = changes.map((c, i) => {
    const type = _sdResolveChangeType(c);
    return { c, type, p: _sdChangePriority(c, type), i };
  }).sort((a, b) => (a.p - b.p) || (a.i - b.i));

  let value = start;
  let numeric = Number(value);
  let isNumeric = !Number.isNaN(numeric) && value !== "" && value !== null && value !== undefined;
  if (!isNumeric) numeric = 0;

  for (const { c, type } of sorted) {
    const raw = c.value;
    const num = Number(raw);
    const okNum = Number.isFinite(num) && raw !== "" && raw !== null && raw !== undefined;

    switch (type) {
      case "add":
        if (okNum) { numeric += num; value = numeric; isNumeric = true; }
        break;
      case "subtract":
        if (okNum) { numeric -= num; value = numeric; isNumeric = true; }
        break;
      case "multiply":
        if (okNum) { numeric *= num; value = numeric; isNumeric = true; }
        break;
      case "override":
        if (okNum) { value = num; numeric = num; isNumeric = true; }
        else       { value = raw; isNumeric = false; }
        break;
      case "upgrade":
        if (okNum) {
          numeric = Math.max(numeric, num);
          value = numeric;
          isNumeric = true;
        }
        break;
      case "downgrade":
        if (okNum) {
          numeric = Math.min(numeric, num);
          value = numeric;
          isNumeric = true;
        }
        break;
      case "custom":
      default:
        // Custom handlers run inside Foundry's standard pipeline; we do not
        // attempt to re-invoke them here.
        break;
    }
  }

  return isNumeric ? numeric : value;
}

function _sdIsHiddenLikePath(key) {
  return key.startsWith("system.hiddenFields.") || key.startsWith("system.flags.");
}

function _sdChangePhase(change) {
  const ph = change?.phase;
  if (typeof ph === "string" && ph.length) return ph.toLowerCase();
  return "initial";
}

export class SDActor extends Actor {

  prepareData() {
    // Fresh tracking on every prepare cycle so stale state from a previous
    // (possibly interrupted) prepare cannot leak into the next pass.
    this._sdAeContext = null;
    super.prepareData();
    this._sdReapplyOverwrittenEffects();
  }

  prepareDerivedData() {
    super.prepareDerivedData();

    const systemData = this.system;
    const flags      = this.flags.sd || {};

    switch (this.type) {
      case "character": this._prepareCharacterData(systemData); break;
      case "npc":       this._prepareNPCData(systemData);       break;
    }
  }

  _prepareCharacterData(data) {
    let totalWeight = 0;
    for (const item of this.items) {
      if (item.type === "inventory") {
        totalWeight += (item.system.totalWeight ?? 0);
      }
      if (item.type === "inventory" && item.system.armor?.enabled && item.system.equipped) {
        data.defense.armor = item.system.armor.baseAC;
      }
    }
    data.encumbrance.current = totalWeight;
  }

  _prepareNPCData(data) {

  }

  async rollGeneric(formula, { flavor = "", rollMode, dialogTitle } = {}) {
    const roll = new Roll(formula, this.getRollData());
    const getSpeaker = ChatMessage.implementation?.getSpeaker ?? ChatMessage.getSpeaker;
    await roll.toMessage({
      speaker: getSpeaker({ actor: this }),
      flavor:  flavor || game.i18n.format("SD.RollFlavor", { actor: this.name }),
      rollMode: rollMode ?? _sdMsgMode()
    });
    return roll;
  }

  async rollDialog({ title, formula, label } = {}) {
    const { SdRollDialog } = await import("../helpers/roll-dialog.mjs");
    const rawFormula = formula ?? this.system.rollFormula ?? "1d20";
    const safeFormula = (rawFormula && rawFormula.match(/\d+d\d+/i)) ? rawFormula : "1d20";
    return SdRollDialog.prompt({
      actor:   this,
      title:   title ?? game.i18n.localize("SD.Roll.label"),
      formula: safeFormula,
      label
    });
  }

  async rollAttribute(attrKey) {
    const attr = this.system.attributes?.[attrKey];
    if (!attr) return;

    const label   = game.i18n.localize(`SD.Attributes.${attrKey}`);
    const mod     = attr.mod;
    const formula = `1d20${mod >= 0 ? "+" : ""}${mod}`;

    return this.rollGeneric(formula, {
      flavor: game.i18n.format("SD.AttributeCheck", { attribute: label })
    });
  }

  async rollSkill(skillKey) {
    const skill = this.system.skills?.[skillKey];
    if (!skill) return;

    const label   = game.i18n.localize(`SD.Skills.${skillKey}`);
    const formula = `1d20+${skill.bonus}`;

    return this.rollGeneric(formula, {
      flavor: game.i18n.format("SD.SkillCheck", { skill: label })
    });
  }

  getRollData() {
    const data = { ...this.system };

    if (data.attributes) {
      for (const [key, attr] of Object.entries(data.attributes)) {
        data[key] = attr.mod;
      }
    }

    if (data.advancement) {
      data.level = data.advancement.level;
      data.prof  = data.advancement.proficiencyBonus;
    }

    return data;
  }

  get appliedEffects() {
    return super.appliedEffects.sort((a, b) => {
      if (a.disabled && !b.disabled) return 1;
      if (!a.disabled && b.disabled) return -1;
      return 0;
    });
  }

  /**
   * Hook into Foundry's effect-application phases.
   *
   * Foundry v14 splits ActiveEffect application into two phases ("initial" and
   * "final") and calls this method once per phase: "initial" before
   * `prepareDerivedData()`, "final" after it. We delegate to the standard
   * implementation so all changes are applied through the canonical pipeline,
   * but we additionally:
   *
   *   1. Pre-create paths under `system.hiddenFields.*` / `system.flags.*`
   *      that do not yet exist on the document, so that the standard pipeline
   *      can write numeric changes against a defined starting value.
   *      ObjectField sub-paths are not guaranteed to exist on the live
   *      document until something references them.
   *
   *   2. After the "initial" phase has run, snapshot every targeted system
   *      path. `prepareData()` compares these snapshots against the post-
   *      pipeline values and, for any path whose value was clobbered during
   *      `prepareDerivedData()` (e.g. `system.defense.total` gets recomputed
   *      from `armor + bonus`), re-applies the initial-phase changes on top
   *      so the effect is visible.
   *
   * IMPORTANT: we do NOT run any custom apply logic alongside the standard
   * pipeline here — doing so would double-apply effects in v14 (since this
   * method is called once per phase).
   */
  applyActiveEffects(phase) {
    const isInitial = (phase === "initial" || phase === undefined || phase === null);

    if (!this._sdAeContext) {
      const changesByKey = new Map();
      for (const effect of this.allApplicableEffects()) {
        if (effect.disabled) continue;
        if (effect.isSuppressed) continue;
        for (const change of (effect.changes ?? [])) {
          const k = String(change?.key ?? "");
          if (!k.startsWith("system.")) continue;
          if (!changesByKey.has(k)) changesByKey.set(k, []);
          changesByKey.get(k).push(change);
        }
      }
      this._sdAeContext = { changesByKey, snapshotAfterInitial: null };
    }

    if (isInitial) {
      // ObjectField sub-paths (system.hiddenFields.*, system.flags.*) might
      // not exist on `this` if the actor's stored source data has never had
      // this key. Seed them with 0 so the standard pipeline can apply numeric
      // changes against a defined value.
      for (const key of this._sdAeContext.changesByKey.keys()) {
        if (!_sdIsHiddenLikePath(key)) continue;
        const cur = foundry.utils.getProperty(this, key);
        if (cur === undefined || cur === null) {
          foundry.utils.setProperty(this, key, 0);
        }
      }
    }

    super.applyActiveEffects(phase);

    if (isInitial) {
      const snap = new Map();
      for (const key of this._sdAeContext.changesByKey.keys()) {
        snap.set(key, foundry.utils.getProperty(this, key));
      }
      this._sdAeContext.snapshotAfterInitial = snap;
    }
  }

  /**
   * Detect paths that were modified by an ActiveEffect in the "initial" phase
   * but later overwritten during `prepareDerivedData()` (e.g. by
   * `_prepareDefense()` setting `system.defense.total = armor + bonus`, or by
   * `applyCalculationsToActor()` overwriting configured calculation outputs).
   * For each such path, re-apply the initial-phase change(s) on top of the new
   * derived value so the effect is preserved.
   *
   * We deliberately do NOT re-apply "final"-phase changes here — Foundry has
   * already applied those after `prepareDerivedData()` and they are correctly
   * stacked on top of derived data.
   */
  _sdReapplyOverwrittenEffects() {
    const ctx = this._sdAeContext;
    this._sdAeContext = null;
    if (!ctx?.changesByKey?.size || !ctx.snapshotAfterInitial) return;

    for (const [key, changes] of ctx.changesByKey) {
      const post    = ctx.snapshotAfterInitial.get(key);
      const current = foundry.utils.getProperty(this, key);
      if (_sdValuesEqual(post, current)) continue;

      const initialChanges = changes.filter(c => _sdChangePhase(c) === "initial");
      if (!initialChanges.length) continue;

      const next = _sdApplyChangesToValue(current, initialChanges);
      foundry.utils.setProperty(this, key, next);
    }
  }

  async _onCreateDescendantDocuments(parent, collection, documents, data, options, userId) {
    await super._onCreateDescendantDocuments(parent, collection, documents, data, options, userId);
    if (collection !== "items") return;
    if (game.user.id !== userId) return;
    for (const item of documents) {
      if (typeof item._applyTransferredEffects === "function") {
        await item._applyTransferredEffects(this);
      }
    }
  }

  async _onDeleteDescendantDocuments(parent, collection, documents, ids, options, userId) {
    await super._onDeleteDescendantDocuments(parent, collection, documents, ids, options, userId);
    if (collection !== "items") return;
    if (game.user.id !== userId) return;
    for (const item of documents) {
      if (typeof item._removeTransferredEffects === "function") {
        await item._removeTransferredEffects(this);
      }
    }
  }

}
