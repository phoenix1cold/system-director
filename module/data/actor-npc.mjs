import {
  ResourceField, AttributeField,
  RollConfigField, BiographyField
} from "./common.mjs";
import { SlotDefinitionField } from "./item-slots.mjs";
import { applyCalculationsToActor } from "../helpers/system-config.mjs";

const {
  StringField, NumberField, BooleanField,
  SchemaField, ArrayField, ObjectField, TypedObjectField
} = foundry.data.fields;

const DEFAULT_ATTRIBUTES = () => ({
  attr1: { value: 10, mod: 0, proficient: false },
  attr2: { value: 10, mod: 0, proficient: false },
  attr3: { value: 10, mod: 0, proficient: false },
  attr4: { value: 10, mod: 0, proficient: false },
  attr5: { value: 10, mod: 0, proficient: false },
  attr6: { value: 10, mod: 0, proficient: false }
});

export class NPCData extends foundry.abstract.TypeDataModel {

  static defineSchema() {
    return {

      attributes: new TypedObjectField(AttributeField({ initial: 10 }), {
        initial: DEFAULT_ATTRIBUTES
      }),

      resources: new TypedObjectField(ResourceField({ initial: 10 }), {
        initial: () => ({
          hp: { value: 10, max: 10, min: 0 },
          mp: { value: 0,  max: 0,  min: 0 }
        })
      }),

      defense: new ObjectField({
        initial: () => ({ armor: 10, bonus: 0, total: 10 })
      }),

      movement: new ObjectField({
        initial: () => ({ walk: 30, fly: 0, swim: 0 })
      }),

      other: new ObjectField({
        initial: () => ({})
      }),

      initiative: new ObjectField({
        initial: () => ({ bonus: 0, total: 0 })
      }),

      classification: new SchemaField({
        cr:        new NumberField({ required: true, integer: false, initial: 0, min: 0, nullable: false }),
        xpReward:  new NumberField({ required: true, integer: true,  initial: 0, min: 0, nullable: false }),
        size:      new StringField({ initial: "medium", choices: ["tiny","small","medium","large","huge","gargantuan"], blank: false }),
        type:      new StringField({ initial: "humanoid", blank: true }),
        alignment: new StringField({ initial: "neutral",  blank: true }),
        role:      new StringField({ initial: "minion",   choices: ["minion","elite","boss","legendary"], blank: false }),
        legendary: new BooleanField({ initial: false }),
        isSwarm:   new BooleanField({ initial: false })
      }),

      attacks: new ArrayField(
        new SchemaField({
          name:     new StringField({ initial: "Attack", blank: false }),
          formula:  new StringField({ initial: "1d6",   blank: false }),
          bonus:    new NumberField({ required: true, integer: true, initial: 0, nullable: false }),
          damageType: new StringField({ initial: "physical", blank: true }),
          reach:    new StringField({ initial: "5 ft",  blank: true })
        })
      ),

      traits: new SchemaField({
        resistances:  new ArrayField(new StringField({ blank: false })),
        immunities:   new ArrayField(new StringField({ blank: false })),
        vulnerabilities: new ArrayField(new StringField({ blank: false })),
        conditionImmunities: new ArrayField(new StringField({ blank: false })),
        languages:    new ArrayField(new StringField({ blank: false })),
        senses:       new StringField({ initial: "", blank: true })
      }),

      rollConfig: RollConfigField({ label: "Default Roll" }),

      declaredAttrs: new ArrayField(new ObjectField()),

      customTabs: new ArrayField(new ObjectField()),

      widgetFields: new ObjectField({ initial: {} }),

      sdTriggerGraph: new ObjectField({ initial: {} }),

      resistances: new ObjectField({ initial: {} }),

      flags: new ObjectField({ initial: {} }),

      slotDefinitions: new ArrayField(SlotDefinitionField()),
      slotContents:    new ObjectField({ initial: {} }),

      hiddenFields: new ObjectField({ initial: {} }),

      biography: BiographyField()
    };
  }

  static migrateData(source) {
    return super.migrateData(source);
  }

  prepareDerivedData() {
    super.prepareDerivedData();
    this._prepareAttributes();
    this._prepareResources();
    this._prepareDefense();
    this._prepareInitiative();
    applyCalculationsToActor(this.parent);
    this._prepareXPFromCR();
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

  _prepareXPFromCR() {
    const cr = this.classification.cr;
    if (this.classification.xpReward === 0) {
      this.classification.xpReward = CONFIG.SD?._crToXP?.[cr] ?? 0;
    }
  }

  get isDead() {
    const hp = this.resources?.hp;
    if (!hp) return false;
    return hp.value <= hp.min;
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
