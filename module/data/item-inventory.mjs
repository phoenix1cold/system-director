import { RollConfigField }    from "./common.mjs";
import { applyEquippableMigration, asEquipBool } from "../helpers/equip-guard.mjs";
import { SlotDefinitionField, SlotContentField } from "./item-slots.mjs";
import { ButtonDefinitionField } from "../helpers/button-executor.mjs";

const {
  StringField, NumberField, BooleanField,
  SchemaField, ArrayField, HTMLField, ObjectField
} = foundry.data.fields;

export class InventoryData extends foundry.abstract.TypeDataModel {

  static defineSchema() {
    return {
      values: new ObjectField({ initial: {} }),
      category: new StringField({ initial: "", blank: true }),
      rarity:   new StringField({ initial: "", blank: true }),
      weight:   new NumberField({ required: true, integer: false, initial: 0, min: 0, nullable: false }),
      quantity: new NumberField({ required: true, integer: true,  initial: 1, min: 0, nullable: false }),
      price:    new NumberField({ required: true, integer: false, initial: 0, min: 0, nullable: false }),
      currency: new StringField({ initial: "primary", blank: false }),
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

      slotDefinitions: new ArrayField(SlotDefinitionField()),
      slotContents:    new ObjectField({ initial: {} }),

      buttons: new ArrayField(ButtonDefinitionField()),

      hiddenFields: new ObjectField({ initial: {} }),

      onClickGraph:   new ObjectField({ initial: {} }),
      onClickFormula: new StringField({ initial: "", blank: true }),
      properties:  new ArrayField(new StringField({ blank: false })),
      tags:        new ArrayField(new StringField({ blank: false })),
      description: new HTMLField({ initial: "", blank: true }),
      unidentifiedName: new StringField({ initial: "", blank: true }),
      source:      new StringField({ initial: "", blank: true }),
      declaredAttrs: new ArrayField(new ObjectField()),

      customTabs:  new ArrayField(new ObjectField()),
      widgetFields: new ObjectField({ initial: {} }),
      widgetVars: new ObjectField({ initial: {} }),

      // Internal typed Blueprint persistence; never exposed as a user-authored path.
      blueprintState: new ObjectField({ initial: {} }),
      sdTriggerGraph: new ObjectField({ initial: {} }),
      flags:       new ObjectField({ initial: {} })
    };
  }

  /** Coerce the loose values legacy worlds stored in `hiddenFields`. */
  static _asBool(value) {
    return asEquipBool(value);
  }

  /**
   * `system.equippable` is a real schema field and the single source of truth.
   * Older builds mirrored it into `system.hiddenFields.equippable`, which then
   * overwrote the checkbox on every data prep.
   *
   * Foundry runs `migrateData` on complete document sources *and* on partial
   * update payloads, so a default may only ever be derived for a complete
   * source. Deriving it for a payload such as `{ equipped: true }` writes that
   * default straight back to the database, which is how equipping an item used
   * to clear its Equippable checkbox.
   */
  static migrateData(source) {
    applyEquippableMigration(source);
    return super.migrateData(source);
  }

  prepareDerivedData() {
    super.prepareDerivedData();
    this.totalWeight = this.weight * this.quantity;
    this.totalValue  = this.price  * this.quantity;
    for (const def of (this.slotDefinitions ?? [])) {
      const ex = this.slotContents?.[def.id];
      if (ex) ex.count = (ex.contents ?? []).length;
    }
  }

  /** Equipped state is only meaningful while the item is marked Equippable. */
  get isEquipped()  { return !!this.equippable && !!this.equipped; }

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
