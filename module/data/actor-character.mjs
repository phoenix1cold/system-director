import {
  ResourceField, AttributeField, SkillField,
  RollConfigField, BiographyField, CurrencyField
} from "./common.mjs";
import { SlotDefinitionField } from "./item-slots.mjs";
import { applyCalculationsToActor } from "../helpers/system-config.mjs";
import { isFullDocumentSource } from "../helpers/equip-guard.mjs";

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

export class CharacterData extends foundry.abstract.TypeDataModel {

  static defineSchema() {
    return {
      values: new ObjectField({ initial: {} }),

      attributes: new ObjectField({ initial: {} }),

      resources: new ObjectField({ initial: {} }),

      defense: new ObjectField({ initial: {} }),

      movement: new ObjectField({ initial: {} }),

      other: new ObjectField({
        initial: () => ({})
      }),

      advancement: new ObjectField({ initial: {} }),
      skillPoints: new ObjectField({ initial: {} }),

      skills: new ObjectField({ initial: {} }),

      initiative: new ObjectField({ initial: {} }),

      rollConfig: RollConfigField({ label: "Default Roll" }),

      currency: new ObjectField({ initial: {} }),

      encumbrance: new SchemaField({
        current: new NumberField({ required: true, integer: false, initial: 0, min: 0, nullable: false }),
        max:     new NumberField({ required: true, integer: false, initial: 150, min: 0, nullable: false })
      }),

      declaredAttrs: new ArrayField(new ObjectField()),

      customTabs: new ArrayField(new ObjectField()),

      // Character-sheet layout, palette, density and navigation preferences.
      sheetStyle: new ObjectField({ initial: {} }),

      widgetFields: new ObjectField({ initial: {} }),

      widgetVars: new ObjectField({ initial: {} }),

      // Internal typed Blueprint persistence; never exposed as a user-authored path.
      blueprintState: new ObjectField({ initial: {} }),

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
    // `migrateData` also receives partial update payloads, so defaults may only
    // be added to a complete source. Otherwise any small update (an equip
    // toggle, a resource tick) would write the default back and reset the data.
    if (!source.skillPoints && isFullDocumentSource(source,
      ["attributes", "resources", "skills", "currency", "hiddenFields", "biography"], 4)) {
      source.skillPoints = { value: 0, max: 0 };
    }
    return super.migrateData(source);
  }

  prepareDerivedData() {
    super.prepareDerivedData();
    // Database variables are stored verbatim in system.values. Legacy fields
    // are retained only for loading old documents and are not derived.
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
