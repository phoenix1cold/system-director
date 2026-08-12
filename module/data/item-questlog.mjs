const {
  StringField, NumberField, BooleanField,
  SchemaField, ArrayField, HTMLField, ObjectField
} = foundry.data.fields;

export function QuestSubtaskField() {
  return new SchemaField({
    id:          new StringField({ required: true, blank: false, initial: "" }),
    name:        new StringField({ initial: "Subtask", blank: true }),
    description: new StringField({ initial: "", blank: true }),
    done:        new BooleanField({ initial: false }),
    hidden:      new BooleanField({ initial: false })
  });
}

export function QuestRewardField() {
  return new SchemaField({
    id:           new StringField({ required: true, blank: false, initial: "" }),
    name:         new StringField({ initial: "Reward", blank: true }),
    icon:         new StringField({ initial: "fa-gift", blank: true }),


    mode:         new StringField({
      initial: "shared",
      choices: ["shared","single"],
      blank: false
    }),


    visibility:   new StringField({
      initial: "visible",
      choices: ["hidden","visible","onCompletion","conditional"],
      blank: false
    }),
    conditionFormula: new StringField({ initial: "", blank: true }),


    grantOn:      new StringField({
      initial: "manual",
      choices: ["manual","questCompleted","subtaskCompleted"],
      blank: false
    }),
    subtaskId:    new StringField({ initial: "", blank: true }),


    items: new ArrayField(new SchemaField({
      uuid: new StringField({ initial: "", blank: true }),
      name: new StringField({ initial: "", blank: true }),
      img:  new StringField({ initial: "", blank: true }),
      qty:  new NumberField({ required: true, integer: true, initial: 1, min: 1, nullable: false })
    }), { initial: [] }),


    currency: new ArrayField(new SchemaField({
      path:   new StringField({ initial: "system.currency.gp", blank: false }),
      amount: new StringField({ initial: "0", blank: true }),
      label:  new StringField({ initial: "", blank: true })
    }), { initial: [] }),


    pathChanges: new ArrayField(new SchemaField({
      id:    new StringField({ required: true, blank: false, initial: "" }),
      path:  new StringField({ initial: "system.xp", blank: true }),
      op:    new StringField({
        initial: "add",
        choices: ["set","add","sub","mul","min","max"],
        blank: false
      }),
      value: new StringField({ initial: "0", blank: true }),

      scope: new StringField({
        initial: "claimer",
        choices: ["claimer","all"],
        blank: false
      }),
      label: new StringField({ initial: "", blank: true })
    }), { initial: [] }),


    customText: new StringField({ initial: "", blank: true }),


    revealed:  new BooleanField({ initial: false }),
    claimable: new BooleanField({ initial: false }),


    claimedBy: new ObjectField({ initial: {} })
  });
}

export function QuestField() {
  return new SchemaField({
    id:          new StringField({ required: true, blank: false, initial: "" }),
    name:        new StringField({ initial: "New Quest", blank: true }),
    description: new HTMLField({ required: false, blank: true, initial: "" }),
    icon:        new StringField({ initial: "fa-flag", blank: true }),


    status: new StringField({
      initial: "available",
      choices: ["locked","available","active","completed","failed"],
      blank: false
    }),


    visibility: new SchemaField({
      mode: new StringField({
        initial: "visible",
        choices: ["visible","hidden","perPlayer"],
        blank: false
      }),
      players: new ArrayField(new StringField(), { initial: [] }),
      gmRevealed: new BooleanField({ initial: false })
    }),


    subtasks: new ArrayField(QuestSubtaskField(), { initial: [] }),


    questGraph: new ObjectField({ initial: {} }),


    rewards: new ArrayField(QuestRewardField(), { initial: [] }),


    chainCol: new NumberField({ required: false, integer: true, initial: null, nullable: true }),
    chainRow: new NumberField({ required: false, integer: true, initial: null, nullable: true })
  });
}

export class QuestLogData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {

      chainName:        new StringField({ initial: "", blank: true }),
      chainIcon:        new StringField({ initial: "fa-scroll", blank: true }),
      chainDescription: new HTMLField({ required: false, blank: true, initial: "" }),


      chainGraph: new ObjectField({ initial: {} }),


      quests: new ArrayField(QuestField(), { initial: [] }),


      defaultActiveQuestId: new StringField({ initial: "", blank: true })
    };
  }
}
