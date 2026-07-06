import {
  ResourceField, AttributeField, SkillField,
  RollConfigField, BiographyField, CurrencyField
} from "./common.mjs";
import { SlotDefinitionField } from "./item-slots.mjs";
import { applyCalculationsToActor } from "../helpers/system-config.mjs";

const {
  StringField, NumberField, BooleanField,
  SchemaField, ArrayField, ObjectField, TypedObjectField
} = foundry.data.fields;

export class CharacterData extends foundry.abstract.TypeDataModel {

  static defineSchema() {
    return {

      attributes: new SchemaField({
        attr1: AttributeField({ initial: 10, label: "Attribute 1" }),
        attr2: AttributeField({ initial: 10, label: "Attribute 2" }),
        attr3: AttributeField({ initial: 10, label: "Attribute 3" }),
        attr4: AttributeField({ initial: 10, label: "Attribute 4" }),
        attr5: AttributeField({ initial: 10, label: "Attribute 5" }),
        attr6: AttributeField({ initial: 10, label: "Attribute 6" })
      }),

      resources: new TypedObjectField(ResourceField({ initial: 10 }), {
        initial: () => ({
          hp:      { value: 10, max: 10, min: 0 },
          mp:      { value: 10, max: 10, min: 0 },
          stamina: { value: 10, max: 10, min: 0 }
        })
      }),

      defense: new ObjectField({
        initial: () => ({ armor: 10, bonus: 0, total: 10 })
      }),

      movement: new ObjectField({
        initial: () => ({ walk: 30, swim: 15, fly: 0, climb: 15, units: "ft" })
      }),

  advancement: new SchemaField({
    level: new NumberField({ required: true, integer: true, initial: 1, min: 1, nullable: false }),
    xp: new SchemaField({
      value: new NumberField({ required: true, integer: true, initial: 0, min: 0, nullable: false }),
      max: new NumberField({ required: true, integer: true, initial: 300, min: 0, nullable: false })
    }),
    proficiencyBonus: new NumberField({ required: true, integer: true, initial: 2, nullable: false })
  }),

  skillPoints: new SchemaField({
    value: new NumberField({ required: true, integer: true, initial: 0, min: 0, nullable: false }),
    max: new NumberField({ required: true, integer: true, initial: 0, min: 0, nullable: false })
  }),

      skills: new SchemaField({
        skill1:  SkillField({ label: "Skill 1" }),
        skill2:  SkillField({ label: "Skill 2" }),
        skill3:  SkillField({ label: "Skill 3" }),
        skill4:  SkillField({ label: "Skill 4" }),
        skill5:  SkillField({ label: "Skill 5" }),
        skill6:  SkillField({ label: "Skill 6" }),
        skill7:  SkillField({ label: "Skill 7" }),
        skill8:  SkillField({ label: "Skill 8" }),
        skill9:  SkillField({ label: "Skill 9" }),
        skill10: SkillField({ label: "Skill 10" })
      }),

      initiative: new ObjectField({
        initial: () => ({ bonus: 0, total: 0 })
      }),

      rollConfig: RollConfigField({ label: "Default Roll" }),

      currency: CurrencyField(),

      encumbrance: new SchemaField({
        current: new NumberField({ required: true, integer: false, initial: 0, min: 0, nullable: false }),
        max:     new NumberField({ required: true, integer: false, initial: 150, min: 0, nullable: false })
      }),

      declaredAttrs: new ArrayField(new ObjectField()),

      customTabs: new ArrayField(new ObjectField()),

      sdTriggerGraph: new ObjectField({ initial: {} }),

      resistances: new ObjectField({ initial: {} }),

      flags: new ObjectField({ initial: {} }),

      slotDefinitions: new ArrayField(SlotDefinitionField()),
      slotContents:    new ObjectField({ initial: {} }),

      spellSlots: new ObjectField({ initial: {} }),

      hiddenFields: new ObjectField({ initial: {} }),

      biography: BiographyField(),

      activeQuest: new ObjectField({ initial: {} })
    };
  }

  static migrateData(source) {
    if (source.stats && !source.attributes) {
      source.attributes = source.stats;
      delete source.stats;
    }
    if (!source.skillPoints) {
      source.skillPoints = { value: 0, max: 0 };
    }
    return super.migrateData(source);
  }

  prepareDerivedData() {
    super.prepareDerivedData();
    this._prepareAttributes();
    this._prepareResources();
    this._prepareDefense();
    this._prepareInitiative();
    applyCalculationsToActor(this.parent);
    this._prepareSkills();
    this._prepareEncumbrance();
  }

  _prepareAttributes() {
    const compute = CONFIG?.SD?.computeModifier
      ?? (s => Math.floor((Number(s) - 10) / 2));
    for (const attr of Object.values(this.attributes)) {
      attr.mod = compute(attr.value);
    }
  }

  _prepareResources() {
    for (const res of Object.values(this.resources ?? {})) {
      if (!res || typeof res !== "object") continue;
      const min = Number.isFinite(res.min) ? res.min : 0;
      const max = Number.isFinite(res.max) ? res.max : Number.MAX_SAFE_INTEGER;
      res.value = Math.clamp(Number(res.value) || 0, min, max);
    }
  }

  _prepareDefense() {
    const armor = Number(this.defense?.armor ?? 0);
    const bonus = Number(this.defense?.bonus ?? 0);
    this.defense.armor = Number.isFinite(armor) ? Math.trunc(armor) : 0;
    this.defense.bonus = Number.isFinite(bonus) ? Math.trunc(bonus) : 0;
    this.defense.total = this.defense.armor + this.defense.bonus;
  }

  _prepareInitiative() {
    const bonus = Number(this.initiative?.bonus ?? 0);
    this.initiative.bonus = Number.isFinite(bonus) ? Math.trunc(bonus) : 0;
    this.initiative.total = (this.attributes?.attr1?.mod ?? 0) + this.initiative.bonus;
  }

  _prepareSkills() {
    for (const skill of Object.values(this.skills)) {
      const attrMod = skill.attribute
        ? (this.attributes[skill.attribute]?.mod ?? 0)
        : 0;
      skill.bonus = skill.rank + attrMod;
    }
  }

  _prepareEncumbrance() {
    this.encumbrance.current = this.encumbrance.current ?? 0;
  }

  get isDead() {
    const hp = this.resources?.hp;
    if (!hp) return false;
    return hp.value <= hp.min;
  }

  get isFullHealth() {
    const hp = this.resources?.hp;
    if (!hp) return true;
    return hp.value >= hp.max;
  }

  get hpPercent() {
    const hp = this.resources?.hp;
    if (!hp) return 0;
    const range = hp.max - hp.min;
    if (range <= 0) return 0;
    return Math.round(((hp.value - hp.min) / range) * 100);
  }

  get rollFormula() {
    const { quantity, die, bonus } = this.rollConfig;
    const b = bonus !== 0 ? (bonus > 0 ? `+${bonus}` : `${bonus}`) : "";
    return `${quantity}${die}${b}`;
  }
}
