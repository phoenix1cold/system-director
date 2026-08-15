import { FormulaEngine } from "../helpers/formula-engine.mjs";
import { injectWidgetFieldsSnapshot, refreshWidgetFieldsRuntime } from "../helpers/widget-fields.mjs";

function _sdMsgMode() {
  try {
    const v = game.settings.get("core", "messageMode");
    if (v) return v;
  } catch {}
  try { return game.settings.get("core", "rollMode"); } catch {}
  return "publicroll";
}

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

function _sdApplyChangesToValue(start, changes, doc = null) {
  const sorted = changes.map((c, i) => {
    const type = _sdResolveChangeType(c);
    return { c, type, p: _sdChangePriority(c, type), i };
  }).sort((a, b) => (a.p - b.p) || (a.i - b.i));

  let value = start;
  let numeric = Number(value);
  let isNumeric = !Number.isNaN(numeric) && value !== "" && value !== null && value !== undefined;
  if (!isNumeric) numeric = 0;

  for (const { c, type } of sorted) {
    let raw = c.value;
    if (typeof raw === "string" && raw.includes("{") && doc) {
      try {
        const ev = FormulaEngine.evaluate(raw, doc);
        if (ev !== undefined && ev !== null && !String(ev).startsWith("!err")) raw = ev;
      } catch { /* keep raw */ }
    }
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

    this._sdAeContext = null;
    super.prepareData();
    this._sdReapplyOverwrittenEffects();
    refreshWidgetFieldsRuntime(this);
  }

  async _preUpdate(changed, options, userId) {
    injectWidgetFieldsSnapshot(this, changed);
    return super._preUpdate(changed, options, userId);
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

  /** Skip equip-gated effects (flags.sd.activateOnEquip) while the source item is unequipped. */
  *allApplicableEffects() {
    for (const effect of super.allApplicableEffects()) {
      if (effect?.flags?.sd?.activateOnEquip) {
        let src = effect.parent;
        if (!(src instanceof Item) && typeof effect.origin === "string" && effect.origin.includes("Item.")) {
          try { src = fromUuidSync(effect.origin); } catch { src = null; }
        }
        if (src instanceof Item && src !== this && src.system?.equippable && !src.system?.equipped) continue;
      }
      yield effect;
    }
  }

  applyActiveEffects(phase) {
    const isInitial = (phase === "initial" || phase === undefined || phase === null);

    if (!this._sdAeContext) {
      const changesByKey = new Map();
      for (const effect of this.allApplicableEffects()) {
        if (effect.disabled) continue;
        if (effect.isSuppressed) continue;
        for (const change of (effect.system?.changes ?? effect.changes ?? [])) {
          const k = String(change?.key ?? "");
          if (!k.startsWith("system.")) continue;
          if (!changesByKey.has(k)) changesByKey.set(k, []);
          changesByKey.get(k).push(change);
        }
      }
      this._sdAeContext = { changesByKey, snapshotAfterInitial: null };
    }

    if (isInitial) {

      for (const key of this._sdAeContext.changesByKey.keys()) {
        if (!_sdIsHiddenLikePath(key)) continue;
        const cur = foundry.utils.getProperty(this, key);
        if (cur === undefined || cur === null) {
          foundry.utils.setProperty(this, key, 0);
        }
      }
    }

    // SD fix: schemaless fields (hiddenFields, custom/widget-bound values) often
    // store numbers as strings ("14"). Foundry's ADD mode is type-driven, so a
    // string current value makes +2 CONCATENATE ("14" + "+2" = "14+2") instead of
    // doing math (14 + 2 = 16). Coerce numeric-looking string targets of numeric
    // AE changes to real numbers before core applies the changes.
    {
      // Foundry v14: numeric change.mode and CONST.ACTIVE_EFFECT_MODES are
      // deprecated; changes carry a string #type. _sdResolveChangeType handles
      // both v14 string types and v13 numeric modes without deprecation hits.
      const numericTypes = ["add", "multiply", "upgrade", "downgrade"];
      for (const [key, changes] of this._sdAeContext.changesByKey) {
        const cur = foundry.utils.getProperty(this, key);
        if (typeof cur !== "string") continue;
        const trimmed = cur.trim();
        const curNum = Number(trimmed);
        const curIsNumeric = trimmed !== "" && Number.isFinite(curNum);
        if (!curIsNumeric && trimmed !== "") continue;
        const relevant = changes.filter(c => numericTypes.includes(_sdResolveChangeType(c)));
        if (!relevant.length) continue;
        const allNumeric = relevant.every(c => {
          let v = String(c?.value ?? "").trim();
          if (v.includes("{")) {
            try { v = String(FormulaEngine.evaluate(v, this)).trim(); } catch { /* keep raw */ }
          }
          return v !== "" && Number.isFinite(Number(v));
        });
        if (!allNumeric) continue;
        foundry.utils.setProperty(this, key, curIsNumeric ? curNum : 0);
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

      const next = _sdApplyChangesToValue(current, initialChanges, this);
      foundry.utils.setProperty(this, key, next);
    }
  }

}
