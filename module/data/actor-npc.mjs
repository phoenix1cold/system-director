import {
  ResourceField, AttributeField,
  RollConfigField, BiographyField
} from "./common.mjs";
import { SlotDefinitionField } from "./item-slots.mjs";

const {
  StringField, NumberField, BooleanField,
  SchemaField, ArrayField, ObjectField, TypedObjectField
} = foundry.data.fields;

export class NPCData extends foundry.abstract.TypeDataModel {

  static defineSchema() {
    return {

      // Core Attributes
      attributes: new SchemaField({
        attr1: AttributeField({ initial: 10, label: "Attribute 1" }),
        attr2: AttributeField({ initial: 10, label: "Attribute 2" }),
        attr3: AttributeField({ initial: 10, label: "Attribute 3" }),
        attr4: AttributeField({ initial: 10, label: "Attribute 4" }),
        attr5: AttributeField({ initial: 10, label: "Attribute 5" }),
        attr6: AttributeField({ initial: 10, label: "Attribute 6" })
      }),

      // Resources — typed map of arbitrary keys to a value/max/min triple.
      // Accepts any key declared in System Config (matches CharacterData).
      resources: new TypedObjectField(ResourceField({ initial: 10 }), {
        initial: () => ({
          hp: { value: 10, max: 10, min: 0 },
          mp: { value: 0,  max: 0,  min: 0 }
        })
      }),

      // Combat
      defense: new SchemaField({
        armor: new NumberField({ required: true, integer: true, initial: 10, nullable: false }),
        bonus: new NumberField({ required: true, integer: true, initial: 0,  nullable: false }),
        total: new NumberField({ required: true, integer: true, initial: 10, nullable: false })
      }),

      movement: new SchemaField({
        walk: new NumberField({ required: true, integer: true, initial: 30, nullable: false }),
        fly:  new NumberField({ required: true, integer: true, initial: 0,  nullable: false }),
        swim: new NumberField({ required: true, integer: true, initial: 0,  nullable: false })
      }),

      initiative: new SchemaField({
        bonus: new NumberField({ required: true, integer: true, initial: 0, nullable: false }),
        total: new NumberField({ required: true, integer: true, initial: 0, nullable: false })
      }),

      // NPC Classification
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

      // Resistances / Immunities
      traits: new SchemaField({
        resistances:  new ArrayField(new StringField({ blank: false })),
        immunities:   new ArrayField(new StringField({ blank: false })),
        vulnerabilities: new ArrayField(new StringField({ blank: false })),
        conditionImmunities: new ArrayField(new StringField({ blank: false })),
        languages:    new ArrayField(new StringField({ blank: false })),
        senses:       new StringField({ initial: "", blank: true })
      }),

      // Default Roll Config
      rollConfig: RollConfigField({ label: "Default Roll" }),

      declaredAttrs: new ArrayField(new ObjectField()),

      // Custom Tabs
      customTabs: new ArrayField(new ObjectField()),

      sdTriggerGraph: new ObjectField({ initial: {} }),

      resistances: new ObjectField({ initial: {} }),

      // Flags / Custom Fields
      flags: new ObjectField({ initial: {} }),

      slotDefinitions: new ArrayField(SlotDefinitionField()),
      slotContents:    new ObjectField({ initial: {} }),

      hiddenFields: new ObjectField({ initial: {} }),

      // Biography / Notes
      biography: BiographyField()
    };
  }

  // Migrations

  static migrateData(source) {
    return super.migrateData(source);
  }

  // Derived Data

  prepareDerivedData() {
    super.prepareDerivedData();
    this._prepareAttributes();
    this._prepareResources();
    this._prepareDefense();
    this._prepareInitiative();
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
    this.defense.total = this.defense.armor + this.defense.bonus;
  }

  _prepareInitiative() {
    this.initiative.total = this.attributes.attr1.mod + this.initiative.bonus;
  }

  /** Auto-calculate XP reward from CR if not set manually. */
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
