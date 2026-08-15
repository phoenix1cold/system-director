import { SlotDefinitionField } from "./item-slots.mjs";
import { ButtonDefinitionField } from "../helpers/button-executor.mjs";

const {
  StringField, NumberField, BooleanField,
  SchemaField, ArrayField, HTMLField, ObjectField
} = foundry.data.fields;

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

export class ClassData extends foundry.abstract.TypeDataModel {

  static defineSchema() {
    return {

      description: new HTMLField({ required: false, blank: true, initial: "" }),

      levels: new ArrayField(
        new SchemaField({

          id:    new StringField({ initial: "", blank: true }),

          level: new NumberField({ required: true, integer: true, initial: 1, min: 1, nullable: false }),

          label: new StringField({ initial: "", blank: true }),

          items:        new ArrayField(new ObjectField(), { initial: [] }),

          effects:      new ArrayField(new ObjectField(), { initial: [] }),

          fieldChanges: new ArrayField(FieldChangeField(), { initial: [] }),

          choices: new ArrayField(
            new SchemaField({
              id:      new StringField({ initial: "", blank: true }),
              label:   new StringField({ initial: "", blank: true }),
              kind:    new StringField({
                initial: "items",
                choices: { items: "Items", effects: "Effects", fieldChanges: "Field Changes" },
                blank: false
              }),
              picks:   new NumberField({ required: true, integer: true, initial: 1, min: 1, nullable: false }),
              options: new ArrayField(new ObjectField(), { initial: [] })
            }),
            { initial: [] }
          )
        }),
        { initial: [] }
      ),

      customTabs: new ArrayField(new ObjectField(), { initial: [] }),
      widgetFields: new ObjectField({ initial: {} }),
      slotDefs:   new ArrayField(SlotDefinitionField(),  { initial: [] }),
      slotContents: new ObjectField({ initial: {} }),
      buttons:    new ArrayField(ButtonDefinitionField(), { initial: [] }),

      sdTriggerGraph: new ObjectField({ initial: {} })
    };
  }
}
