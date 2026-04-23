const {
  StringField, NumberField, BooleanField, SchemaField,
  HTMLField, ArrayField, ObjectField, FilePathField, ColorField
} = foundry.data.fields;

// Resource (value / max / min)

export function ResourceField({ initial = 0, label = "" } = {}) {
  return new SchemaField({
    value: new NumberField({ required: true, integer: true, initial, nullable: false, label: `${label} Value` }),
    max:   new NumberField({ required: true, integer: true, initial, nullable: false, min: 0, label: `${label} Max` }),
    min:   new NumberField({ required: true, integer: true, initial: 0, nullable: false, label: `${label} Min` })
  }, { label });
}

// Attribute (score / modifier / bonus)

export function AttributeField({ initial = 10, label = "" } = {}) {
  return new SchemaField({
    value:   new NumberField({ required: true, integer: true, initial, nullable: false, min: 1, label: `${label} Score` }),
    mod:     new NumberField({ required: true, integer: true, initial: 0, nullable: false, label: `${label} Modifier` }),
    proficient: new BooleanField({ initial: false, label: `${label} Proficient` })
  }, { label });
}

// Skill

export function SkillField({ label = "" } = {}) {
  return new SchemaField({
    rank:      new NumberField({ required: true, integer: true, initial: 0, min: 0, nullable: false }),
    attribute: new StringField({ initial: "", blank: true }),
    bonus:     new NumberField({ required: true, integer: true, initial: 0, nullable: false }),
    label:     new StringField({ initial: label, blank: true })
  }, { label });
}

// Roll Config

export function RollConfigField({ label = "Roll" } = {}) {
  return new SchemaField({
    quantity: new NumberField({ required: true, integer: true, initial: 1, min: 1, nullable: false }),
    die:      new StringField({ initial: "d20", choices: ["d4","d6","d8","d10","d12","d20","d100"], blank: false }),
    bonus:    new NumberField({ required: true, integer: true, initial: 0, nullable: false }),
    formula:  new StringField({ initial: "", blank: true })   // override raw formula
  }, { label });
}

// Biography

export function BiographyField() {
  return new SchemaField({
    value:    new HTMLField({ initial: "", blank: true }),
    notes:    new HTMLField({ initial: "", blank: true }),
    age:      new StringField({ initial: "", blank: true }),
    gender:   new StringField({ initial: "", blank: true }),
    height:   new StringField({ initial: "", blank: true }),
    weight:   new StringField({ initial: "", blank: true }),
    eyes:     new StringField({ initial: "", blank: true }),
    hair:     new StringField({ initial: "", blank: true }),
    skin:     new StringField({ initial: "", blank: true }),
    faith:    new StringField({ initial: "", blank: true }),
    backstory:new StringField({ initial: "", blank: true })
  });
}

// Currency

export function CurrencyField() {
  return new SchemaField({
    primary:   new NumberField({ required: true, integer: false, initial: 0, min: 0, nullable: false }),
    secondary: new NumberField({ required: true, integer: false, initial: 0, min: 0, nullable: false }),
    tertiary:  new NumberField({ required: true, integer: false, initial: 0, min: 0, nullable: false }),
    label1:    new StringField({ initial: "Gold",   blank: false }),
    label2:    new StringField({ initial: "Silver", blank: false }),
    label3:    new StringField({ initial: "Copper", blank: false })
  });
}
