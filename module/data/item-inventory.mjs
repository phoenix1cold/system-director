import { RollConfigField }    from "./common.mjs";
import { SlotDefinitionField, SlotContentField } from "./item-slots.mjs";
import { ButtonDefinitionField } from "../helpers/button-executor.mjs";

const {
  StringField, NumberField, BooleanField,
  SchemaField, ArrayField, HTMLField, ObjectField
} = foundry.data.fields;

export class InventoryData extends foundry.abstract.TypeDataModel {

  static defineSchema() {
    return {
      category: new StringField({
        initial: "gear",
        choices: ["weapon","armor","shield","consumable","ammo","magazine","tool","gear","container","treasure","other"],
        blank: false
      }),
      rarity: new StringField({
        initial: "common",
        choices: ["common","uncommon","rare","very-rare","legendary","artifact","unique"],
        blank: false
      }),
      weight:   new NumberField({ required: true, integer: false, initial: 0, min: 0, nullable: false }),
      quantity: new NumberField({ required: true, integer: true,  initial: 1, min: 0, nullable: false }),
      price:    new NumberField({ required: true, integer: false, initial: 0, min: 0, nullable: false }),
      currency: new StringField({ initial: "gp", blank: false }),
      equipped:    new BooleanField({ initial: false }),
      equippable:  new BooleanField({ initial: false }),
      equipRequirements: new StringField({ initial: "", blank: true }),
      concentration: new BooleanField({ initial: false }),
      identified:  new BooleanField({ initial: true }),
      attuned:     new BooleanField({ initial: false }),
      broken:      new BooleanField({ initial: false }),
      attack: new SchemaField({
        enabled:    new BooleanField({ initial: false }),
        rollConfig: RollConfigField({ label: "Attack Roll" }),
        bonus:      new NumberField({ required: true, integer: true, initial: 0, nullable: false }),
        reach:      new StringField({ initial: "5 ft", blank: true }),
        range:      new StringField({ initial: "", blank: true }),
        attackType: new StringField({ initial: "melee", choices: ["melee","ranged","thrown"], blank: false })
      }),
      damage: new SchemaField({
        primary:   RollConfigField({ label: "Primary Damage" }),
        secondary: RollConfigField({ label: "Secondary Damage" }),
        type:      new StringField({ initial: "physical", blank: true }),
        type2:     new StringField({ initial: "", blank: true })
      }),
      armor: new SchemaField({
        enabled:     new BooleanField({ initial: false }),
        baseAC:      new NumberField({ required: true, integer: true, initial: 10, nullable: false }),
        maxDexBonus: new NumberField({ required: false, integer: true, initial: null, nullable: true }),
        stealthPenalty: new BooleanField({ initial: false })
      }),
      uses: new SchemaField({
        enabled:     new BooleanField({ initial: false }),
        value:       new NumberField({ required: true, integer: true, initial: 0, min: 0, nullable: false }),
        max:         new NumberField({ required: true, integer: true, initial: 0, min: 0, nullable: false }),
        per:         new StringField({ initial: "day", blank: true }),
        autoDestroy: new BooleanField({ initial: false })
      }),
      // SLOTS
      slotDefinitions: new ArrayField(SlotDefinitionField()),
      slotContents:    new ObjectField({ initial: {} }),
      // CUSTOM BUTTONS
      buttons: new ArrayField(ButtonDefinitionField()),
      // HIDDEN FIELDS
      hiddenFields: new ObjectField({ initial: {} }),
      // On-Click Graph
      onClickGraph:   new ObjectField({ initial: {} }),
      onClickFormula: new StringField({ initial: "", blank: true }),
      properties:  new ArrayField(new StringField({ blank: false })),
      tags:        new ArrayField(new StringField({ blank: false })),
      description: new HTMLField({ initial: "", blank: true }),
      unidentifiedName: new StringField({ initial: "", blank: true }),
      source:      new StringField({ initial: "", blank: true }),
      declaredAttrs: new ArrayField(new ObjectField()),

      customTabs:  new ArrayField(new ObjectField()),
      sdTriggerGraph: new ObjectField({ initial: {} }),
      flags:       new ObjectField({ initial: {} })
    };
  }

  static migrateData(source) {
    if (source && source.equippable === undefined) {
      const cat = source.category ?? "gear";
      source.equippable = ["weapon","armor","shield","tool"].includes(cat);
    }
    if (source?.equippable && !(source.hiddenFields?.equippable)) {
      source.hiddenFields ??= {};
      source.hiddenFields.equippable = true;
    }
    return super.migrateData(source);
  }

  prepareDerivedData() {
    super.prepareDerivedData();
    const hfEq = this.hiddenFields?.equippable;
    if (hfEq !== undefined) this.equippable = !!hfEq;
    this.totalWeight = this.weight * this.quantity;
    this.totalValue  = this.price  * this.quantity;
    for (const def of (this.slotDefinitions ?? [])) {
      const ex = this.slotContents?.[def.id];
      if (ex) ex.count = (ex.contents ?? []).length;
    }
  }

  get isWeapon()    { return this.category === "weapon"; }
  get isArmor()     { return ["armor","shield"].includes(this.category); }
  get isAmmo()      { return this.category === "ammo"; }
  get isMagazine()  { return this.category === "magazine"; }
  get hasSlots()    { return (this.slotDefinitions ?? []).length > 0; }
  get hasButtons()  { return (this.buttons ?? []).length > 0; }

  get attackFormula() {
    const { quantity, die } = this.attack.rollConfig;
    const b = this.attack.bonus;
    const s = `${quantity}${die}${b >= 0 ? "+" : ""}${b !== 0 ? b : ""}`;
    return s.replace(/\+0$/, "");
  }

  get damageFormula() {
    const { quantity, die, bonus } = this.damage.primary;
    const s = `${quantity}${die}${bonus >= 0 ? "+" : ""}${bonus !== 0 ? bonus : ""}`;
    return s.replace(/\+0$/, "");
  }

  get usesPercent() {
    if (!this.uses.enabled || this.uses.max <= 0) return 100;
    return Math.round((this.uses.value / this.uses.max) * 100);
  }
}
