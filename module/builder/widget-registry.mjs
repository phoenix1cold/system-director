export const WIDGET_TYPES = {

  text: {
    id:    "text",
    label: "Text Field",
    icon:  "fa-font",
    desc:  "Single-line text",
    defaultSpan: 1,
    defaults: {
      label:       "Label",
      path:        "system.flags.myField",
      placeholder: ""
    },
    configFields: [
      { key: "label",       type: "text",   label: "Label" },
      { key: "path",        type: "path",   label: "Data Path" },
      { key: "placeholder", type: "text",   label: "Placeholder" }
    ]
  },

  number: {
    id:    "number",
    label: "Number ±",
    icon:  "fa-hashtag",
    desc:  "Number + ± buttons",
    defaultSpan: 1,
    defaults: {
      label: "Value",
      path:  "system.flags.myNumber",
      min:   null,
      max:   null,
      step:  1
    },
    configFields: [
      { key: "label", type: "text",   label: "Label" },
      { key: "path",  type: "path",   label: "Data Path" },
      { key: "min",   type: "number", label: "Min" },
      { key: "max",   type: "number", label: "Max" },
      { key: "step",  type: "number", label: "Step" }
    ]
  },

  resource: {
    id:    "resource",
    label: "Resource Bar",
    icon:  "fa-heart-pulse",
    desc:  "Value / Max + bar",
    defaultSpan: 2,
    defaults: {
      label:     "Resource",
      pathValue: "system.resources.hp.value",
      pathMax:   "system.resources.hp.max",
      color:     "#e05a5a"
    },
    configFields: [
      { key: "label",     type: "text",  label: "Label" },
      { key: "pathValue", type: "path",  label: "Value Path" },
      { key: "pathMax",   type: "path",  label: "Max Path" },
      { key: "color",     type: "color", label: "Bar Color" }
    ]
  },

  dice: {
    id:    "dice",
    label: "Dice Button",
    icon:  "fa-dice-d20",
    desc:  "Clickable roll",
    defaultSpan: 1,
    defaults: {
      label:   "Roll",
      formula: "1d20",
      icon:    "fa-dice-d20",
      flavor:  ""
    },
    configFields: [
      { key: "label",   type: "text", label: "Label" },
      { key: "formula", type: "text", label: "Formula", mono: true },
      { key: "icon",    type: "text", label: "FA Icon" },
      { key: "flavor",  type: "text", label: "Flavor text" }
    ]
  },

  toggle: {
    id:    "toggle",
    label: "Toggle",
    icon:  "fa-toggle-on",
    desc:  "Checkbox / switch",
    defaultSpan: 1,
    defaults: {
      label:    "Toggle",
      path:     "system.flags.myToggle",
      onLabel:  "On",
      offLabel: "Off"
    },
    configFields: [
      { key: "label",    type: "text", label: "Label" },
      { key: "path",     type: "path", label: "Data Path" },
      { key: "onLabel",  type: "text", label: "On Label" },
      { key: "offLabel", type: "text", label: "Off Label" }
    ]
  },

  slot: {
    id:    "slot",
    label: "Item Slot",
    icon:  "fa-layer-group",
    desc:  "Slot contents list",
    defaultSpan: 2,
    defaults: {
      label:           "Slot",
      slotId:          "",
      allowedTypes:    [],
      allowedCategories: [],
      maxCount:        1
    },
    configFields: [
      { key: "label",             type: "text",   label: "Label" },
      { key: "slotId",            type: "text",   label: "Slot ID" },
      { key: "maxCount",          type: "number", label: "Max Items" },
      { key: "allowedTypes",      type: "tags",   label: "Allowed Types (inventory, ability, feature)" },
      { key: "allowedCategories", type: "tags",   label: "Allowed Categories (weapon, armor, etc)" }
    ]
  },

  inventory: {
    id:    "inventory",
    label: "Inventory",
    icon:  "fa-backpack",
    desc:  "Items table with filters",
    defaultSpan: 3,
    defaults: {
      label:        "Inventory",
      showCurrency: true,
      showWeight:   true,
      categories:   [],
      columns:      []
    },
    configFields: [
      { key: "label",        type: "text",     label: "Title" },
      { key: "showCurrency", type: "checkbox", label: "Show Currency" },
      { key: "showWeight",   type: "checkbox", label: "Show Weight" },
      { key: "categories",   type: "tags",     label: "Filter Categories (empty = all)" },
      { key: "columns",      type: "tags",     label: "Extra Columns (hidden attr names: weight, damage, etc)" }
    ]
  },

  effects: {
    id:    "effects",
    label: "Effects",
    icon:  "fa-sparkles",
    desc:  "Active Effects list with toggle/edit/delete",
    defaultSpan: 3,
    defaults: {
      label:        "Effects",
      showDisabled: true,
      showPassive:  true
    },
    configFields: [
      { key: "label",        type: "text",     label: "Title" },
      { key: "showDisabled", type: "checkbox", label: "Show Disabled Effects" },
      { key: "showPassive",  type: "checkbox", label: "Show Passive (transfer) Effects" }
    ]
  },

  spellbook: {
    id:    "spellbook",
    label: "Spellbook",
    icon:  "fa-book-sparkles",
    desc:  "List of ability items filtered by type",
    defaultSpan: 3,
    defaults: {
      label: "Spellbook",
      abilityType: ""
    },
    configFields: [
      { key: "label",       type: "text", label: "Title" },
      { key: "abilityType", type: "text", label: "Ability type filter",
        placeholder: "spell / technique / power (empty = all)" }
    ]
  },

  attribute: {
    id:    "attribute",
    label: "Attribute",
    icon:  "fa-chart-bar",
    desc:  "Score + modifier + click graph",
    defaultSpan: 1,
    defaults: {
      label: "Attribute",
      path:  "system.attributes.attr1.value"
    },
    configFields: [
      { key: "label", type: "text", label: "Label" },
      { key: "path",  type: "path", label: "Score Path" }
    ]
  },

  skill: {
    id:    "skill",
    label: "Skill",
    icon:  "fa-list-check",
    desc:  "Rank + bonus + roll",
    defaultSpan: 1,
    defaults: {
      label:       "Skill",
      path:        "system.skills.skill1.rank",
      attrMod:     0,
      rollFormula: ""
    },
    configFields: [
      { key: "label",       type: "text",   label: "Label" },
      { key: "path",        type: "path",   label: "Rank Path" },
      { key: "attrMod",     type: "number", label: "Attr Modifier" },
      { key: "rollFormula", type: "text",   label: "Roll Formula (blank = 1d20+bonus)", mono: true, placeholder: "e.g. 2d6+@skill1" }
    ]
  },

  section: {
    id:    "section",
    label: "Section Header",
    icon:  "fa-minus",
    desc:  "Divider / heading",
    defaultSpan: 3,
    defaults: {
      label:       "Section",
      collapsible: false
    },
    configFields: [
      { key: "label",       type: "text",     label: "Title" },
      { key: "collapsible", type: "checkbox", label: "Collapsible" }
    ]
  },

  button: {
    id:    "button",
    label: "Button",
    icon:  "fa-square-bolt",
    desc:  "Action button (roll, modify field, etc.)",
    defaultSpan: 1,
    defaults: {
      label:   "Action",
      icon:    "fa-bolt",
      color:   "#7b68ee",
      btnId:   "",
      formula: "",
      flavor:  ""
    },
    configFields: [
      { key: "label",   type: "text",  label: "Label" },
      { key: "icon",    type: "text",  label: "FA Icon (e.g. fa-bolt)" },
      { key: "color",   type: "color", label: "Color" },
      { key: "formula", type: "text",  label: "Roll Formula (optional)", mono: true },
      { key: "flavor",  type: "text",  label: "Flavor text" }
    ]
  },

  richtext: {
    id:    "richtext",
    label: "Rich Text",
    icon:  "fa-align-left",
    desc:  "HTML notes field",
    defaultSpan: 3,
    defaults: {
      label: "Notes",
      path:  "system.biography.notes"
    },
    configFields: [
      { key: "label", type: "text", label: "Label" },
      { key: "path",  type: "path", label: "Data Path" }
    ]
  },

  /** Progress bar — read-only bar bound to value/max, configurable colour */
  progress: {
    id:    "progress",
    label: "Progress Bar",
    icon:  "fa-chart-bar",
    desc:  "Read-only horizontal bar (XP, reputation, charge level)",
    defaultSpan: 2,
    defaults: {
      label:     "Progress",
      pathValue: "system.advancement.xp.value",
      pathMax:   "system.advancement.xp.max",
      color:     "#5a8aff",
      showLabel: true,
      showPct:   true
    },
    configFields: [
      { key: "label",     type: "text",     label: "Label" },
      { key: "pathValue", type: "path",     label: "Value Path" },
      { key: "pathMax",   type: "path",     label: "Max Path" },
      { key: "color",     type: "color",    label: "Bar Colour" },
      { key: "showLabel", type: "checkbox", label: "Show label text" },
      { key: "showPct",   type: "checkbox", label: "Show percentage" }
    ]
  },

  /** Select — a <select> dropdown bound to a StringField with choices */
  select: {
    id:    "select",
    label: "Select",
    icon:  "fa-list",
    desc:  "Dropdown bound to a string field. Choices defined as comma-separated values.",
    defaultSpan: 1,
    defaults: {
      label:   "Pick",
      path:    "system.flags.mySelect",
      choices: "option1,option2,option3"
    },
    configFields: [
      { key: "label",   type: "text", label: "Label" },
      { key: "path",    type: "path", label: "Data Path" },
      { key: "choices", type: "text", label: "Choices (comma-separated)", mono: true, placeholder: "low,medium,high" }
    ]
  },

  /** Clock — Blades-in-the-Dark / PbtA style progress clock with N segments */
  clock: {
    id:    "clock",
    label: "Progress Clock",
    icon:  "fa-clock",
    desc:  "Pie-chart clock widget. Click segments to fill/unfill (Blades in the Dark, PbtA style).",
    defaultSpan: 1,
    defaults: {
      label:     "Clock",
      path:      "system.flags.myClock",
      segments:  4,
      color:     "#e0a020",
      bgColor:   "#1a1a2a"
    },
    configFields: [
      { key: "label",    type: "text",   label: "Label" },
      { key: "path",     type: "path",   label: "Filled count path" },
      { key: "segments", type: "number", label: "Total segments (2–12)" },
      { key: "color",    type: "color",  label: "Filled colour" },
      { key: "bgColor",  type: "color",  label: "Empty colour" }
    ]
  },

  tracker: {
    id:    "tracker",
    label: "Token Tracker",
    icon:  "fa-circle-dot",
    desc:  "Row of N clickable pip icons — click to fill, click filled to unfill (same model as the Clock widget).",
    defaultSpan: 2,
    defaults: {
      label:    "Stress",
      path:     "system.hiddenFields.myTracker",
      maxPath:  "",
      maxCount: 6,
      icon:     "fa-circle",
      color:    "#e04040",
      bgColor:  "#2a2a3a",
      pipSize:  14
    },
    configFields: [
      { key: "label",    type: "text",   label: "Label" },
      { key: "path",     type: "path",   label: "Value Path (integer)" },
      { key: "maxPath",  type: "path",   label: "Max Path (blank = use Max below)" },
      { key: "maxCount", type: "number", label: "Max (when no Max Path)" },
      { key: "icon",     type: "text",   label: "FA icon (e.g. fa-circle, fa-heart)" },
      { key: "color",    type: "color",  label: "Filled colour" },
      { key: "bgColor",  type: "color",  label: "Empty colour" },
      { key: "pipSize",  type: "number", label: "Pip size (px, 10\u201324)" }
    ]
  },

  counter: {
    id:    "counter",
    label: "Counter",
    icon:  "fa-plus-minus",
    desc:  "Big ± stepper for metacurrencies (Fate, Momentum, Hold). Clamps to min/max.",
    defaultSpan: 1,
    defaults: {
      label: "Counter",
      path:  "system.flags.myCounter",
      min:   0,
      max:   99,
      step:  1,
      color: "#e0a020"
    },
    configFields: [
      { key: "label", type: "text",   label: "Label" },
      { key: "path",  type: "path",   label: "Data Path" },
      { key: "min",   type: "number", label: "Min" },
      { key: "max",   type: "number", label: "Max" },
      { key: "step",  type: "number", label: "Step" },
      { key: "color", type: "color",  label: "Accent colour" }
    ]
  },

  rollButton: {
    id:    "rollButton",
    label: "Roll Button",
    icon:  "fa-dice-d20",
    desc:  "One-click dice roll button. Formula → chat message. No graph needed.",
    defaultSpan: 1,
    defaults: {
      label:   "Roll",
      formula: "1d20",
      flavor:  "",
      icon:    "fa-dice-d20",
      color:   "#5a9ae0"
    },
    configFields: [
      { key: "label",   type: "text",  label: "Label" },
      { key: "formula", type: "text",  label: "Formula", mono: true, placeholder: "1d20 + @attrs.str.mod" },
      { key: "flavor",  type: "text",  label: "Flavor text (chat)" },
      { key: "icon",    type: "text",  label: "FA icon" },
      { key: "color",   type: "color", label: "Accent colour" }
    ]
  },

  tokenPool: {
    id:    "tokenPool",
    label: "Token Pool",
    icon:  "fa-coins",
    desc:  "Visual token pool with spend / gain buttons. Best for Fate, Momentum, Hold, metacurrencies.",
    defaultSpan: 2,
    defaults: {
      label:    "Tokens",
      path:     "system.flags.myTokens",
      maxPath:  "",
      maxCount: 10,
      icon:     "fa-coins",
      color:    "#f0c040",
      bgColor:  "#2a2a3a",
      pipSize:  16
    },
    configFields: [
      { key: "label",    type: "text",   label: "Label" },
      { key: "path",     type: "path",   label: "Value Path (integer)" },
      { key: "maxPath",  type: "path",   label: "Max Path (blank = use Max below)" },
      { key: "maxCount", type: "number", label: "Max (when no Max Path)" },
      { key: "icon",     type: "text",   label: "FA icon (e.g. fa-coins, fa-star)" },
      { key: "color",    type: "color",  label: "Filled colour" },
      { key: "bgColor",  type: "color",  label: "Empty colour" },
      { key: "pipSize",  type: "number", label: "Token size (px, 10\u201324)" }
    ]
  },

  diceTray: {
    id:    "diceTray",
    label: "Dice Tray",
    icon:  "fa-dice",
    desc:  "Passive display of the last dice roll (total, formula, flavor) made by any SD action.",
    defaultSpan: 2,
    defaults: {
      label:     "Last Roll",
      flagPath:  "flags.sd.lastRoll",
      color:     "#7ef0c3",
      compact:   false
    },
    configFields: [
      { key: "label",    type: "text",   label: "Label" },
      { key: "flagPath", type: "path",   label: "Flag Path (read-only)" },
      { key: "color",    type: "color",  label: "Accent colour" },
      { key: "compact",  type: "toggle", label: "Compact (single line)" }
    ]
  },

  /** Tags — editable list of string tags/traits shown as pill badges */
  tags: {
    id:    "tags",
    label: "Tags / Traits",
    icon:  "fa-tags",
    desc:  "Editable comma-separated list of traits, languages, or keywords displayed as pills.",
    defaultSpan: 3,
    defaults: {
      label: "Tags",
      path:  "system.flags.myTags",
      color: "#5a6a9a"
    },
    configFields: [
      { key: "label", type: "text",  label: "Label" },
      { key: "path",  type: "path",  label: "Data path (string, comma-separated)" },
      { key: "color", type: "color", label: "Pill colour" }
    ]
  },

  /** Image Display — shows a static image or one from an actor/item path */
  image: {
    id:    "image",
    label: "Image",
    icon:  "fa-image",
    desc:  "Displays a static image URL or resolves an image path from the document (e.g. actor portrait, item icon).",
    defaultSpan: 1,
    defaults: {
      label:       "",
      staticSrc:   "",
      path:        "",
      width:       64,
      height:      64,
      borderRadius: 4,
      clickable:   false
    },
    configFields: [
      { key: "staticSrc",    type: "text",     label: "Static URL (blank = use path)" },
      { key: "path",         type: "path",     label: "Document path to image URL" },
      { key: "width",        type: "number",   label: "Width (px)" },
      { key: "height",       type: "number",   label: "Height (px)" },
      { key: "borderRadius", type: "number",   label: "Border radius (px)" },
      { key: "clickable",    type: "checkbox", label: "Click to change (filepicker)" }
    ]
  },

  /** Vertical Section — takes one grid cell, stacks child widgets vertically */
  vsection: {
    id:    "vsection",
    label: "Vertical Section",
    icon:  "fa-bars",
    desc:  "Replaces one grid cell with a vertical stack of widgets",
    defaultSpan: 1,
    defaults: {
      label:   "",
      widgets: []
    },
    configFields: [
      { key: "label", type: "text", label: "Heading (optional)" }
    ]
  },

  /** Derived / Computed — read-only display of a formula value with optional graph */
  derived: {
    id:    "derived",
    label: "Derived Value",
    icon:  "fa-function",
    desc:  "Shows a computed read-only number from a formula. Value is not stored — computed at render time only.",
    defaultSpan: 1,
    defaults: {
      label:         "Derived",
      formula:       "0",
      decimalPlaces: 0
    },
    configFields: [
      { key: "label",         type: "text",   label: "Label" },
      { key: "formula",       type: "text",   label: "Formula", mono: true, placeholder: "{system.attributes.attr1.value} * 2" },
      { key: "decimalPlaces", type: "number", label: "Decimal places (0 = integer)" }
    ]
  }
};

/** Ordered list for palette display */
export const WIDGET_PALETTE_ORDER = [
  "text", "number", "counter", "resource", "derived", "dice", "button",
  "toggle", "attribute", "skill", "progress", "tracker", "tokenPool", "clock",
  "slot", "inventory", "effects", "spellbook",
  "select", "tags", "image", "section", "vsection", "richtext"
];

export const WIDGET_COMMON_FIELDS = [
  { key: "showIf",    type: "text",     label: "Show if (formula, blank=always)", mono: true, placeholder: "{system.advancement.level} >= 5" },
  { key: "widgetKey", type: "text",     label: "Widget Key (for Get Widget node)", placeholder: "myUniqueKey" },
  { key: "cssClass",  type: "text",     label: "Extra CSS class(es)", placeholder: "my-class another-class" }
];

/** Create a fresh widget definition with a random id */
export function createWidget(type, overrides = {}) {
  const def = WIDGET_TYPES[type];
  if (!def) throw new Error(`Unknown widget type: ${type}`);
  return {
    id:   foundry.utils.randomID(8),
    type,
    span: def.defaultSpan ?? 1,
    ...foundry.utils.deepClone(def.defaults),
    ...overrides
  };
}

/** Known data paths on characters/npcs — shown in path autocomplete */
export const KNOWN_PATHS = {
  // Attributes
  "system.attributes.attr1.value": "Attribute 1 — Score",
  "system.attributes.attr1.mod":   "Attribute 1 — Modifier",
  "system.attributes.attr2.value": "Attribute 2 — Score",
  "system.attributes.attr2.mod":   "Attribute 2 — Modifier",
  "system.attributes.attr3.value": "Attribute 3 — Score",
  "system.attributes.attr3.mod":   "Attribute 3 — Modifier",
  "system.attributes.attr4.value": "Attribute 4 — Score",
  "system.attributes.attr4.mod":   "Attribute 4 — Modifier",
  "system.attributes.attr5.value": "Attribute 5 — Score",
  "system.attributes.attr5.mod":   "Attribute 5 — Modifier",
  "system.attributes.attr6.value": "Attribute 6 — Score",
  "system.attributes.attr6.mod":   "Attribute 6 — Modifier",
  // Resources
  "system.resources.hp.value":     "HP — Current",
  "system.resources.hp.max":       "HP — Max",
  "system.resources.mp.value":     "MP — Current",
  "system.resources.mp.max":       "MP — Max",
  "system.resources.stamina.value":"Stamina — Current",
  "system.resources.stamina.max":  "Stamina — Max",
  // Combat
  "system.defense.armor":          "Defense — Armor",
  "system.defense.total":          "Defense — Total",
  "system.initiative.bonus":       "Initiative — Bonus",
  "system.initiative.total":       "Initiative — Total",
  "system.movement.walk":          "Movement — Walk",
  "system.movement.fly":           "Movement — Fly",
  // Advancement
  "system.advancement.level":      "Level",
  "system.advancement.xp.value":   "XP — Current",
  "system.advancement.xp.max":     "XP — Max",
  "system.advancement.proficiencyBonus": "Proficiency Bonus"
};
