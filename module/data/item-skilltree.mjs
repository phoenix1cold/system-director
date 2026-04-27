import { ButtonDefinitionField } from "../helpers/button-executor.mjs";
import { SlotDefinitionField }   from "./item-slots.mjs";
import { FieldChangeField }      from "./item-class.mjs";

const {
  StringField, NumberField, BooleanField,
  SchemaField, ArrayField, HTMLField, ObjectField
} = foundry.data.fields;

// SkillTreeData

export class SkillTreeData extends foundry.abstract.TypeDataModel {

  static defineSchema() {
    return {

      // Description
      description: new HTMLField({ required: false, blank: true, initial: "" }),

      // Grid dimensions
      cols: new NumberField({ required: true, integer: true, initial: 8, min: 2, max: 20, nullable: false }),
      rows: new NumberField({ required: true, integer: true, initial: 5, min: 2, max: 20, nullable: false }),

      // Nodes
      nodes: new ArrayField(
        new SchemaField({
          /** Stable id used in connections and acquiredNodes state. */
          id:   new StringField({ required: true, blank: false }),
          /** Grid position (0-based). */
          col:  new NumberField({ required: true, integer: true, initial: 0, min: 0, nullable: false }),
          row:  new NumberField({ required: true, integer: true, initial: 0, min: 0, nullable: false }),
          /** Display label (falls back to item name). */
          label: new StringField({ initial: "", blank: true }),
          /** Item snapshot shown/granted when the node is acquired. */
          item:  new ObjectField(),
          /** ActiveEffect-data objects applied on acquire. */
          effects: new ArrayField(new ObjectField(), { initial: [] }),
          /** Field-change instructions applied on acquire. */
          fieldChanges: new ArrayField(FieldChangeField(), { initial: [] }),
        maxAcquire: new NumberField({ required: true, integer: true, initial: 1, min: 1, nullable: false }),
        /** Skill-point cost to acquire this node once. Defaults to 1. */
        cost: new NumberField({ required: true, integer: true, initial: 1, min: 0, nullable: false }),
        /** Optional background colour override for the cell. */
        color: new StringField({ initial: "", blank: true })
        }),
        { initial: [] }
      ),

      connections: new ArrayField(
        new SchemaField({
          from: new StringField({ required: true, blank: false }),
          to:   new StringField({ required: true, blank: false })
        }),
        { initial: [] }
      ),

      // Optional slot / button support
      customTabs:   new ArrayField(new ObjectField(), { initial: [] }),
      slotDefs:     new ArrayField(SlotDefinitionField(),   { initial: [] }),
      slotContents: new ObjectField({ initial: {} }),
      buttons:      new ArrayField(ButtonDefinitionField(), { initial: [] }),

      // Sheet-level Trigger Graph
      sdTriggerGraph: new ObjectField({ initial: {} })
    };
  }
}
