/**
 * module/documents/actor.mjs
 *
 * Extends the base Actor document with system-specific logic:
 * - Derived data that requires access to embedded Items
 * - Roll methods
 * - Active Effects helpers
 */

// v14: `core.rollMode` was renamed to `core.messageMode` (old key is a
// deprecated shim until v16).  Read the new key when available, fall back
// to the old one so v13 and older cores keep working without throwing.
function _sdMsgMode() {
  try {
    const v = game.settings.get("core", "messageMode");
    if (v) return v;
  } catch {}
  try { return game.settings.get("core", "rollMode"); } catch {}
  return "publicroll";
}

export class SDActor extends Actor {

  /** @override */
  prepareData() {
    super.prepareData();
  }

  /** @override — runs after embedded items are prepared */
  prepareDerivedData() {
    super.prepareDerivedData();

    const systemData = this.system;
    const flags      = this.flags.sd || {};

    switch (this.type) {
      case "character": this._prepareCharacterData(systemData); break;
      case "npc":       this._prepareNPCData(systemData);       break;
    }
  }

  // Character-specific derived data

  _prepareCharacterData(data) {
    // Sum encumbrance from owned inventory items.
    let totalWeight = 0;
    for (const item of this.items) {
      if (item.type === "inventory") {
        totalWeight += (item.system.totalWeight ?? 0);
      }
      // Equipped armor → update defense.
      if (item.type === "inventory" && item.system.armor?.enabled && item.system.equipped) {
        data.defense.armor = item.system.armor.baseAC;
      }
    }
    data.encumbrance.current = totalWeight;
  }

  _prepareNPCData(data) {
    // Nothing extra for NPC for now.
  }

  // Roll Helpers

  /**
   * Roll a generic dice formula for this actor.
   * @param {string} formula   Dice formula, e.g. "1d20+3"
   * @param {object} options   Options passed to Roll#evaluate
   * @returns {Promise<Roll>}
   */
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

  /**
   * Open the roll dialog, then roll.
   * @param {object} opts
   */
  async rollDialog({ title, formula, label } = {}) {
    const { SdRollDialog } = await import("../helpers/roll-dialog.mjs");
    // Fallback to safe "1d20" if system formula is empty or malformed
    const rawFormula = formula ?? this.system.rollFormula ?? "1d20";
    const safeFormula = (rawFormula && rawFormula.match(/\d+d\d+/i)) ? rawFormula : "1d20";
    return SdRollDialog.prompt({
      actor:   this,
      title:   title ?? game.i18n.localize("SD.Roll.label"),
      formula: safeFormula,
      label
    });
  }

  /**
   * Roll an attribute check.
   * @param {string} attrKey  e.g. "attr1"
   */
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

  /**
   * Roll a skill check.
   * @param {string} skillKey  e.g. "skill1"
   */
  async rollSkill(skillKey) {
    const skill = this.system.skills?.[skillKey];
    if (!skill) return;

    const label   = game.i18n.localize(`SD.Skills.${skillKey}`);
    const formula = `1d20+${skill.bonus}`;

    return this.rollGeneric(formula, {
      flavor: game.i18n.format("SD.SkillCheck", { skill: label })
    });
  }

  /**
   * Returns the roll data object passed to Roll formulas.
   * Flatly exposes system data under @attr names.
   */
  getRollData() {
    const data = { ...this.system };

    // Shorthand: @attr1 = this.system.attributes.attr1.mod
    if (data.attributes) {
      for (const [key, attr] of Object.entries(data.attributes)) {
        data[key] = attr.mod;
      }
    }

    // @level = advancement.level
    if (data.advancement) {
      data.level = data.advancement.level;
      data.prof  = data.advancement.proficiencyBonus;
    }

    return data;
  }

  // Active Effects

  /** @override — sort effects: suppressed last */
  get appliedEffects() {
    return super.appliedEffects.sort((a, b) => {
      if (a.disabled && !b.disabled) return 1;
      if (!a.disabled && b.disabled) return -1;
      return 0;
    });
  }

  /**
   * @override
   * Foundry's default applyActiveEffects() handles schema-backed fields fine,
   * but ObjectField-backed dynamic paths (hiddenFields, flags) get string-
   * concatenated instead of numeric-added.  We fix this by:
   *   1. Resetting every dynamic path to its source value before the parent call.
   *   2. Letting the parent run (it will mis-apply dynamic paths, but we will overwrite).
   *   3. Re-computing dynamic paths ourselves with proper numeric coercion.
   */
  applyActiveEffects(phase) {
    // Paths whose parent key is an untyped ObjectField -- need manual numeric handling.
    const DYNAMIC_PREFIXES = [
      "system.hiddenFields.",
      "system.flags."
    ];

    const isDynamic = key => DYNAMIC_PREFIXES.some(p => String(key).startsWith(p));

    // Phase 1: collect all dynamic changes grouped by key
    const byKey = new Map(); // key → [{mode, value, priority}]

    for (const effect of this.allApplicableEffects()) {
      if (effect.disabled) continue;
      for (const change of (effect.changes ?? [])) {
        if (!isDynamic(change.key)) continue;
        const priority = change.priority ?? (Number(change.mode) * 10);
        if (!byKey.has(change.key)) byKey.set(change.key, []);
        byKey.get(change.key).push({ ...change, priority });
      }
    }

    // Phase 2: reset dynamic paths to raw source so parent doesn't corrupt
    for (const key of byKey.keys()) {
      const src = foundry.utils.getProperty(this._source, key) ?? 0;
      foundry.utils.setProperty(this, key, src);
    }

    // Phase 3: let Foundry handle schema-backed fields normally
    super.applyActiveEffects(phase);

    // Phase 4: overwrite dynamic paths with correctly computed values
    if (!byKey.size) return;

    const M = CONST.ACTIVE_EFFECT_MODES;

    for (const [key, changes] of byKey) {
      // Sort by priority ascending (matches Foundry's ordering)
      changes.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));

      // Start from source value, coerced to number
      const rawSrc = foundry.utils.getProperty(this._source, key) ?? 0;
      let current  = Number(rawSrc);
      if (isNaN(current)) current = 0;

      for (const change of changes) {
        const delta = Number(change.value);
        const safe  = isNaN(delta) ? 0 : delta;
        switch (Number(change.mode)) {
          case M.ADD:       current = current + safe; break;
          case M.MULTIPLY:  current = current * (isNaN(delta) ? 1 : delta); break;
          case M.OVERRIDE:  current = isNaN(delta) ? (Number(change.value) || 0) : delta; break;
          case M.UPGRADE:   current = Math.max(current, safe); break;
          case M.DOWNGRADE: current = Math.min(current, safe); break;
          case M.CUSTOM:
          default:          /* custom mode — leave as-is, handled by hook */ break;
        }
      }

      foundry.utils.setProperty(this, key, current);
    }
  }
  // Transfer Effects bookkeeping

  /**
   * When any item is created on this actor (including on first load from DB),
   * ensure its transferrable effects exist on the actor.
   * Foundry calls this after all embedded documents are initialized.
   */
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

  /**
   * When any item is deleted from this actor, remove its transferred effects.
   */
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
