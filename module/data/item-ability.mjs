/**
 * module/data/item-ability.mjs
 *
 * TypeDataModel for Item subtype: "ability"
 * Covers spells, powers, techniques -- anything that is activated and rolled.
 */

import { RollConfigField }    from "./common.mjs";
import { SlotDefinitionField } from "./item-slots.mjs";
import { ButtonDefinitionField } from "../helpers/button-executor.mjs";

const {
  StringField, NumberField, BooleanField,
  SchemaField, ArrayField, HTMLField, ObjectField
} = foundry.data.fields;

export class AbilityData extends foundry.abstract.TypeDataModel {

  static defineSchema() {
    return {

      // Classification
      category: new StringField({
        initial: "active",
        choices: ["active","passive","reaction","free","special"],
        blank: false
      }),

      school: new StringField({ initial: "", blank: true }),

      level: new SchemaField({
        value: new NumberField({ required: true, integer: true, initial: 1, min: 0, nullable: false }),
        max:   new NumberField({ required: true, integer: true, initial: 9, min: 0, nullable: false })
      }),

      // Activation
      activation: new SchemaField({
        type:     new StringField({ initial: "action", choices: ["action","bonus","reaction","minute","hour","special","none"], blank: false }),
        cost:     new NumberField({ required: true, integer: true, initial: 1, nullable: false }),
        condition: new StringField({ initial: "", blank: true })
      }),

      // Range / Area
      range: new SchemaField({
        value: new NumberField({ required: false, integer: false, initial: null, nullable: true }),
        units: new StringField({ initial: "ft", blank: false }),
        type:  new StringField({ initial: "self", choices: ["self","touch","ranged","sight","unlimited","special",""], blank: true })
      }),

      area: new SchemaField({
        value: new NumberField({ required: false, integer: false, initial: null, nullable: true }),
        units: new StringField({ initial: "ft", blank: false }),
        type:  new StringField({ initial: "", choices: ["cube","cone","cylinder","line","sphere","square","radius",""], blank: true })
      }),

      // Duration
      duration: new SchemaField({
        value: new NumberField({ required: false, integer: true, initial: null, nullable: true }),
        units: new StringField({ initial: "instant", choices: ["instant","turn","round","minute","hour","day","permanent","special"], blank: false }),
        concentration: new BooleanField({ initial: false })
      }),

      // Roll
      roll: new SchemaField({
        enabled:     new BooleanField({ initial: true }),
        config:      RollConfigField({ label: "Action Roll" }),
        critRange:   new NumberField({ required: true, integer: true, initial: 20, nullable: false }),
        critMultiple: new NumberField({ required: true, integer: true, initial: 2, nullable: false }),
        saveAttribute: new StringField({ initial: "", blank: true }),
        saveDC:        new NumberField({ required: false, integer: true, initial: null, nullable: true })
      }),

      // Damage / Healing
      damage: new SchemaField({
        enabled:    new BooleanField({ initial: false }),
        formula:    new StringField({ initial: "1d6", blank: false }),
        type:       new StringField({ initial: "physical", blank: true }),
        healing:    new BooleanField({ initial: false }),
        versatile:  new StringField({ initial: "", blank: true })
      }),

      // Resource Cost
      cost: new SchemaField({
        resource:  new StringField({ initial: "", blank: true }),  // e.g. "resources.mp"
        value:     new NumberField({ required: true, integer: true, initial: 0, min: 0, nullable: false }),
        slotLevel: new NumberField({ required: true, integer: true, initial: 0, min: 0, nullable: false })
      }),

      // Uses
      uses: new SchemaField({
        enabled: new BooleanField({ initial: false }),
        value:   new NumberField({ required: true, integer: true, initial: 0, min: 0, nullable: false }),
        max:     new NumberField({ required: true, integer: true, initial: 0, min: 0, nullable: false }),
        per:     new StringField({ initial: "day", choices: ["turn","round","short","long","day",""], blank: true })
      }),

      // Requirements
      requirements: new SchemaField({
        level:        new NumberField({ required: true, integer: true, initial: 0, min: 0, nullable: false }),
        attribute:    new StringField({ initial: "", blank: true }),
        attributeMin: new NumberField({ required: true, integer: true, initial: 0, nullable: false })
      }),

      // Tags / Components
      components: new ArrayField(new StringField({ blank: false })),
      tags:       new ArrayField(new StringField({ blank: false })),

      // Declared Attributes (for attribute reference system)
      declaredAttrs: new ArrayField(new ObjectField()),

      // Custom Tabs (Visual Builder)
      customTabs: new ArrayField(new ObjectField()),

      // Sheet-level Trigger Graph
      // Event-node-only graph scanned by event-bus alongside widget graphs.
      sdTriggerGraph: new ObjectField({ initial: {} }),

      // SLOTS
      slotDefinitions: new ArrayField(SlotDefinitionField()),
      slotContents:    new ObjectField({ initial: {} }),
      // CUSTOM BUTTONS
      buttons: new ArrayField(ButtonDefinitionField()),
      hiddenFields: new ObjectField({ initial: { cost: "", pathUses: "", type: "" } }),

      // On-Click Graph
      onClickGraph:   new ObjectField({ initial: {} }),
      onClickFormula: new StringField({ initial: "", blank: true }),

      // Effect Templates
      // AE templates applied automatically (or via node) when ability is used.
      // Each entry: { id, name, icon, target, durationRounds, changes, autoApply }
      effectTemplates: new ArrayField(new ObjectField()),

      // Description
      description: new HTMLField({ initial: "", blank: true }),
      effect:      new HTMLField({ initial: "", blank: true }),
      source:      new StringField({ initial: "", blank: true }),

      // Custom Flags
      flags: new ObjectField({ initial: {} })
    };
  }

  static migrateData(source) {
    return super.migrateData(source);
  }

  prepareDerivedData() {
    super.prepareDerivedData();
    this._buildRollFormula();
  }

  _buildRollFormula() {
    if (!this.roll.enabled) return;
    const { quantity, die, bonus, formula } = this.roll.config;
    if (formula) {
      this.roll.finalFormula = formula;
    } else {
      const b = bonus !== 0 ? (bonus > 0 ? `+${bonus}` : `${bonus}`) : "";
      this.roll.finalFormula = `${quantity}${die}${b}`;
    }
  }

  get isActive()    { return this.category === "active"; }
  get isPassive()   { return this.category === "passive"; }
  get isConcentration() { return this.duration.concentration; }

  get usesPercent() {
    if (!this.uses.enabled || this.uses.max <= 0) return 100;
    return Math.round((this.uses.value / this.uses.max) * 100);
  }
}


/**
 * module/data/item-feature.mjs (inlined here for convenience)
 *
 * TypeDataModel for Item subtype: "feature"
 * Passive traits, racial features, class features, talents, perks.
 */
export class FeatureData extends foundry.abstract.TypeDataModel {

  static defineSchema() {
    const {
      StringField, NumberField, BooleanField,
      SchemaField, ArrayField, HTMLField, ObjectField
    } = foundry.data.fields;

    return {
      category: new StringField({
        initial: "general",
        choices: ["general","racial","class","background","feat","talent","perk","flaw","other"],
        blank: false
      }),

      level: new NumberField({ required: true, integer: true, initial: 0, min: 0, nullable: false }),

      activation: new SchemaField({
        type:  new StringField({ initial: "passive", choices: ["passive","action","bonus","reaction","special"], blank: false }),
        cost:  new NumberField({ required: true, integer: true, initial: 0, nullable: false })
      }),

      uses: new SchemaField({
        enabled: new BooleanField({ initial: false }),
        value:   new NumberField({ required: true, integer: true, initial: 0, min: 0, nullable: false }),
        max:     new NumberField({ required: true, integer: true, initial: 0, min: 0, nullable: false }),
        per:     new StringField({ initial: "day", blank: true })
      }),

      tags:        new ArrayField(new StringField({ blank: false })),
      description: new HTMLField({ initial: "", blank: true }),
      source:      new StringField({ initial: "", blank: true }),
      flags:       new ObjectField({ initial: {} }),
      // On-Click Graph
      onClickGraph:   new ObjectField({ initial: {} }),
      onClickFormula: new StringField({ initial: "", blank: true }),
    };
  }

  static migrateData(source) { return super.migrateData(source); }

  prepareDerivedData() {
    super.prepareDerivedData();
  }

  get isPassive() { return this.activation.type === "passive"; }
}
