import {
  ResourceField, AttributeField, SkillField,
  RollConfigField, BiographyField, CurrencyField
} from "./common.mjs";
import { SlotDefinitionField } from "./item-slots.mjs";

const {
  StringField, NumberField, BooleanField,
  SchemaField, ArrayField, ObjectField
} = foundry.data.fields;

export class CharacterData extends foundry.abstract.TypeDataModel {

  static defineSchema() {
    return {

      // Core Attributes
      // Six universal attributes -- rename via Active Effects or subclass.
      attributes: new SchemaField({
        attr1: AttributeField({ initial: 10, label: "Attribute 1" }),
        attr2: AttributeField({ initial: 10, label: "Attribute 2" }),
        attr3: AttributeField({ initial: 10, label: "Attribute 3" }),
        attr4: AttributeField({ initial: 10, label: "Attribute 4" }),
        attr5: AttributeField({ initial: 10, label: "Attribute 5" }),
        attr6: AttributeField({ initial: 10, label: "Attribute 6" })
      }),

      // Resources
      resources: new SchemaField({
        hp:      ResourceField({ initial: 10, label: "HP" }),
        mp:      ResourceField({ initial: 10, label: "MP" }),
        stamina: ResourceField({ initial: 10, label: "Stamina" }),
        custom1: ResourceField({ initial: 0,  label: "Custom 1" }),
        custom2: ResourceField({ initial: 0,  label: "Custom 2" })
      }),

      // Derived / Combat stats
      // These are computed in prepareDerivedData but can be overridden by AE.
      defense: new SchemaField({
        armor:   new NumberField({ required: true, integer: true, initial: 10, nullable: false }),
        bonus:   new NumberField({ required: true, integer: true, initial: 0,  nullable: false }),
        total:   new NumberField({ required: true, integer: true, initial: 10, nullable: false })
      }),

      movement: new SchemaField({
        walk:  new NumberField({ required: true, integer: true, initial: 30, nullable: false }),
        swim:  new NumberField({ required: true, integer: true, initial: 15, nullable: false }),
        fly:   new NumberField({ required: true, integer: true, initial: 0,  nullable: false }),
        climb: new NumberField({ required: true, integer: true, initial: 15, nullable: false }),
        units: new StringField({ initial: "ft", blank: false })
      }),

  // Character Advancement
  advancement: new SchemaField({
    level: new NumberField({ required: true, integer: true, initial: 1, min: 1, nullable: false }),
    xp: new SchemaField({
      value: new NumberField({ required: true, integer: true, initial: 0, min: 0, nullable: false }),
      max: new NumberField({ required: true, integer: true, initial: 300, min: 0, nullable: false })
    }),
    proficiencyBonus: new NumberField({ required: true, integer: true, initial: 2, nullable: false })
  }),

  // Skill Points
  // Spent on acquiring nodes in the Skill Tree tab.
  skillPoints: new SchemaField({
    value: new NumberField({ required: true, integer: true, initial: 0, min: 0, nullable: false }),
    max: new NumberField({ required: true, integer: true, initial: 0, min: 0, nullable: false })
  }),

  // Skills
      // 10 generic skill slots -- rename/repurpose per game.
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

      // Initiative
      initiative: new SchemaField({
        bonus: new NumberField({ required: true, integer: true, initial: 0, nullable: false }),
        total: new NumberField({ required: true, integer: true, initial: 0, nullable: false })
      }),

      // Default Roll Config
      rollConfig: RollConfigField({ label: "Default Roll" }),

      // Currency
      currency: CurrencyField(),

      // Carrying Capacity
      encumbrance: new SchemaField({
        current: new NumberField({ required: true, integer: false, initial: 0, min: 0, nullable: false }),
        max:     new NumberField({ required: true, integer: false, initial: 150, min: 0, nullable: false })
      }),

      // Declared Attributes (for attribute reference system)
      declaredAttrs: new ArrayField(new ObjectField()),

      // Custom Tabs (Visual Builder)
      customTabs: new ArrayField(new ObjectField()),

      // Sheet-level Trigger Graph
      sdTriggerGraph: new ObjectField({ initial: {} }),

      resistances: new ObjectField({ initial: {} }),

      // Flags / Custom Fields
      // Free-form object for system-specific or house-rule additions.
      flags: new ObjectField({ initial: {} }),

      // Slot System (Sheet Builder slot widgets)
      slotDefinitions: new ArrayField(SlotDefinitionField()),
      slotContents:    new ObjectField({ initial: {} }),

      // Spell Slots (Spellbook widget -- D&D-style per-level slots)
      // Keys are string level numbers: { "1": {value:4, max:4}, ... }
      spellSlots: new ObjectField({ initial: {} }),

      // Hidden Fields (GM-only key/value pairs)
      hiddenFields: new ObjectField({ initial: {} }),

      // Biography
      biography: BiographyField()
    };
  }

  // Migrations

  static migrateData(source) {
    if (source.stats && !source.attributes) {
      source.attributes = source.stats;
      delete source.stats;
    }
    // v0.x → skillPoints introduced: ensure defaults
    if (!source.skillPoints) {
      source.skillPoints = { value: 0, max: 0 };
    }
    return super.migrateData(source);
  }

  // Derived Data

  prepareDerivedData() {
    super.prepareDerivedData();
    this._prepareAttributes();
    this._prepareResources();
    this._prepareDefense();
    this._prepareInitiative();
    this._prepareSkills();
    this._prepareEncumbrance();
  }

  /** Compute modifier from score (classic floor((score-10)/2)). */
  _prepareAttributes() {
    for (const attr of Object.values(this.attributes)) {
      attr.mod = Math.floor((attr.value - 10) / 2);
    }
  }

  /** Clamp resource values to [min, max]. */
  _prepareResources() {
    for (const res of Object.values(this.resources)) {
      res.value = Math.clamp(res.value, res.min, res.max);
    }
  }

  /** defense.total = armor + bonus. */
  _prepareDefense() {
    this.defense.total = this.defense.armor + this.defense.bonus;
  }

  /** initiative.total = attr1.mod + bonus. */
  _prepareInitiative() {
    this.initiative.total = this.attributes.attr1.mod + this.initiative.bonus;
  }

  /** skill.bonus = rank + governing attribute mod (if set). */
  _prepareSkills() {
    for (const skill of Object.values(this.skills)) {
      const attrMod = skill.attribute
        ? (this.attributes[skill.attribute]?.mod ?? 0)
        : 0;
      skill.bonus = skill.rank + attrMod;
    }
  }

  /** Sum up inventory weight (handled by Item preparation, cached here). */
  _prepareEncumbrance() {
    // Actual weight summation is done in CharacterActor.prepareDerivedData
    // after embedded items are available. This just ensures the field exists.
    this.encumbrance.current = this.encumbrance.current ?? 0;
  }

  // Computed Properties

  /** True if HP is at or below min. */
  get isDead() {
    return this.resources.hp.value <= this.resources.hp.min;
  }

  /** True if HP is at max. */
  get isFullHealth() {
    return this.resources.hp.value >= this.resources.hp.max;
  }

  /** HP as a percentage for UI progress bars. */
  get hpPercent() {
    const range = this.resources.hp.max - this.resources.hp.min;
    if (range <= 0) return 0;
    return Math.round(((this.resources.hp.value - this.resources.hp.min) / range) * 100);
  }

  /** Build the default roll formula string. */
  get rollFormula() {
    const { quantity, die, bonus } = this.rollConfig;
    const b = bonus !== 0 ? (bonus > 0 ? `+${bonus}` : `${bonus}`) : "";
    return `${quantity}${die}${b}`;
  }
}
