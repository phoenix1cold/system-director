function _sdMsgMode() {
  try {
    const v = game.settings.get("core", "messageMode");
    if (v) return v;
  } catch {}
  try { return game.settings.get("core", "rollMode"); } catch {}
  return "publicroll";
}

export class SDActor extends Actor {

  prepareData() {
    super.prepareData();
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

  applyActiveEffects(phase) {
    const DYNAMIC_PREFIXES = [
      "system.hiddenFields.",
      "system.flags."
    ];

    const isDynamic = key => DYNAMIC_PREFIXES.some(p => String(key).startsWith(p));

    const byKey = new Map();

    for (const effect of this.allApplicableEffects()) {
      if (effect.disabled) continue;
      for (const change of (effect.changes ?? [])) {
        if (!isDynamic(change.key)) continue;
        const priority = change.priority ?? (Number(change.mode) * 10);
        if (!byKey.has(change.key)) byKey.set(change.key, []);
        byKey.get(change.key).push({ ...change, priority });
      }
    }

    for (const key of byKey.keys()) {
      const src = foundry.utils.getProperty(this._source, key) ?? 0;
      foundry.utils.setProperty(this, key, src);
    }

    super.applyActiveEffects(phase);

    if (!byKey.size) return;

    const M = CONST.ACTIVE_EFFECT_MODES;

    for (const [key, changes] of byKey) {
      changes.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));

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
          default:           break;
        }
      }

      foundry.utils.setProperty(this, key, current);
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
