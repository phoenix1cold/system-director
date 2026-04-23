/**
 * module/data/item-class.mjs
 *
 * TypeDataModel for Item subtype: "class"
 *
 * A "class" item is a reusable progression template.
 * It stores an ordered list of level definitions -- each level
 * can grant items, active effects, and field-change instructions
 * (e.g. system.resources.hp.max +5).
 *
 * A class item can be dragged onto the Progression App (per-actor)
 * to be used as that actor's level-up source.  Multiple actors can
 * reference the same class item; changes propagate automatically.
 */

import { SlotDefinitionField } from "./item-slots.mjs";
import { ButtonDefinitionField } from "../helpers/button-executor.mjs";

const {
  StringField, NumberField, BooleanField,
  SchemaField, ArrayField, HTMLField, ObjectField
} = foundry.data.fields;

// Shared sub-schema factory

/** A single field-change instruction stored inside a level or a skill-tree node. */
function FieldChangeField(opts = {}) {
  return new SchemaField({
    path:  new StringField({ initial: "system.advancement.level", blank: false }),
    mode:  new StringField({
      initial: "add",
      choices: { add: "Add (+)", set: "Set (=)", multiply: "Multiply (×)" },
      blank: false
    }),
    value: new StringField({ initial: "1", blank: false })
  }, opts);
}

export { FieldChangeField };

// ClassData

export class ClassData extends foundry.abstract.TypeDataModel {

  static defineSchema() {
    return {

      // Description
      description: new HTMLField({ required: false, blank: true, initial: "" }),

      // Levels
      // Ordered array of per-level reward definitions.
      levels: new ArrayField(
        new SchemaField({
          /** Stable unique id so re-ordering doesn't break references. */
          id:    new StringField({ initial: "", blank: true }),
          /** Level number.  Usually 1, 2, 3 … but can be any positive int. */
          level: new NumberField({ required: true, integer: true, initial: 1, min: 1, nullable: false }),
          /** Human-readable label shown in the UI ("Apprentice", "Level 5", …). */
          label: new StringField({ initial: "", blank: true }),
          /** Item snapshots granted when this level is applied. */
          items:        new ArrayField(new ObjectField(), { initial: [] }),
          /** ActiveEffect-data objects granted when this level is applied. */
          effects:      new ArrayField(new ObjectField(), { initial: [] }),
          /** Field-change instructions applied when this level fires. */
          fieldChanges: new ArrayField(FieldChangeField(), { initial: [] })
        }),
        { initial: [] }
      ),

      // Optional slot / button support (same as other item types)
      customTabs: new ArrayField(new ObjectField(), { initial: [] }),
      slotDefs:   new ArrayField(SlotDefinitionField(),  { initial: [] }),
      slotContents: new ObjectField({ initial: {} }),
      buttons:    new ArrayField(ButtonDefinitionField(), { initial: [] }),

      // Sheet-level Trigger Graph
      sdTriggerGraph: new ObjectField({ initial: {} })
    };
  }
}
