import { ButtonDefinitionField } from "../helpers/button-executor.mjs";
import { SlotDefinitionField }   from "./item-slots.mjs";
import { FieldChangeField }      from "./item-class.mjs";

const {
  StringField, NumberField, BooleanField,
  SchemaField, ArrayField, HTMLField, ObjectField
} = foundry.data.fields;

export class SkillTreeData extends foundry.abstract.TypeDataModel {

  static defineSchema() {
    return {

      description: new HTMLField({ required: false, blank: true, initial: "" }),

      cols: new NumberField({ required: true, integer: true, initial: 8, min: 2, max: 20, nullable: false }),
      rows: new NumberField({ required: true, integer: true, initial: 5, min: 2, max: 20, nullable: false }),

      nodes: new ArrayField(
        new SchemaField({

          id:   new StringField({ required: true, blank: false }),

          col:  new NumberField({ required: true, integer: true, initial: 0, min: 0, nullable: false }),
          row:  new NumberField({ required: true, integer: true, initial: 0, min: 0, nullable: false }),

          label: new StringField({ initial: "", blank: true }),

          item:  new ObjectField(),

          effects: new ArrayField(new ObjectField(), { initial: [] }),

          fieldChanges: new ArrayField(FieldChangeField(), { initial: [] }),
        maxAcquire: new NumberField({ required: true, integer: true, initial: 1, min: 1, nullable: false }),

        cost: new NumberField({ required: true, integer: true, initial: 1, min: 0, nullable: false }),

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

      customTabs:   new ArrayField(new ObjectField(), { initial: [] }),
      slotDefs:     new ArrayField(SlotDefinitionField(),   { initial: [] }),
      slotContents: new ObjectField({ initial: {} }),
      buttons:      new ArrayField(ButtonDefinitionField(), { initial: [] }),

      sdTriggerGraph: new ObjectField({ initial: {} })
    };
  }
}
