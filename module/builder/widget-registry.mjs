export const WIDGET_TYPES = {

  text: {
    id:    "text",
    label: "Text Field",
    icon:  "fa-font",
    desc:  "Single-line text",
    defaultSpan: 1,
    defaults: {
      label: "Label",
      path:  "system.flags.myField"
    },
    configFields: [
      { key: "label", type: "text", label: "Label" },
      { key: "path",  type: "path", label: "Data Path" }
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
      numberMode: "classic",
      min:   null,
      max:   null,
      step:  1
    },
    configFields: [
      { key: "label", type: "text",   label: "Label" },
      { key: "path",  type: "path",   label: "Data Path" },
      { key: "min",   type: "text",   label: "Min (number or path)" },
      { key: "max",   type: "text",   label: "Max (number or path)" },
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
      resourceMode: "classic",
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
      label:             "Slot",
      slotId:            "",
      allowedTypes:      [],
      allowedCategories: [],
      maxCount:          1,
      autoEquip:         false,
      placeholderIcon:   "",
      accentColor:       ""
    },
    configFields: [
      { key: "label",             type: "text",   label: "Label" },
      { key: "slotId",            type: "text",   label: "Slot ID" },
      { key: "maxCount",          type: "number", label: "Max Items" },
      { key: "autoEquip",         type: "checkbox", label: "Auto-equip items added to slot" },
      { key: "allowedTypes",      type: "tags",   label: "Allowed Types (inventory, ability)" },
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
    desc:  "Active Effects list",
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
    desc:  "Abilities filtered by type",
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

  attributeGroup: {
    id:    "attributeGroup",
    label: "Attribute Group",
    icon:  "fa-dice-d20",
    desc:  "Compact button → popover list of attributes",
    defaultSpan: 1,
    defaults: {
      label: "Attributes",
      attributeKeys: ""
    },
    configFields: [
      { key: "label",         type: "text", label: "Button label" },
      { key: "attributeKeys", type: "text", label: "Attribute keys or paths (comma, blank = all enabled)", placeholder: "attr1, attr2 — or system.attributes.attr1.value" },
      { key: "icon",          type: "text", label: "FA icon (e.g. fa-dice-d20)" }
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
    desc:  "Action button (roll/modify/etc.)",
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

  progress: {
    id:    "progress",
    label: "Progress Bar",
    icon:  "fa-chart-bar",
    desc:  "Read-only horizontal bar",
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

  select: {
    id:    "select",
    label: "Select",
    icon:  "fa-list",
    desc:  "Dropdown from comma-separated choices",
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

  clock: {
    id:    "clock",
    label: "Progress Clock",
    icon:  "fa-clock",
    desc:  "Pie-chart clock (PbtA / Blades)",
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
    desc:  "Row of clickable pip icons",
    defaultSpan: 2,
    defaults: {
      label:    "Stress",
      path:     "system.hiddenFields.myTracker",
      maxPath:  "",
      maxCount: 6,
      icon:     "fa-circle",
      emptyIcon:"",
      color:    "#e04040",
      bgColor:  "#2a2a3a",
      pipSize:  14,
      glow:     true
    },
    configFields: [
      { key: "label",        type: "text",       label: "Label" },
      { key: "path",         type: "path",       label: "Value Path (integer)" },
      { key: "maxPath",      type: "path",       label: "Max Path (blank = use Max below)" },
      { key: "maxCount",     type: "number",     label: "Max (when no Max Path)" },
      { key: "icon",         type: "text",       label: "FA icon (e.g. fa-heart, fab fa-github)" },
      { key: "emptyIcon",    type: "text",       label: "Empty pip icon (blank = same glyph)" },

      { key: "iconImg",      type: "image-pick", label: "Filled pip image (overrides FA icon)" },
      { key: "emptyIconImg", type: "image-pick", label: "Empty pip image (blank = use Empty icon)" },
      { key: "color",        type: "color",      label: "Filled colour" },
      { key: "bgColor",      type: "color",      label: "Empty colour" },
      { key: "pipSize",      type: "number",     label: "Pip size (px, 10\u201324)" },
      { key: "glow",         type: "boolean",    label: "Glow effect on filled pips" }
    ]
  },

  counter: {
    id:    "counter",
    label: "Counter",
    icon:  "fa-plus-minus",
    desc:  "Big ± stepper with min/max",
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
    desc:  "One-click dice roll → chat",
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
    desc:  "Token pool with spend / gain",
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
      { key: "label",        type: "text",       label: "Label" },
      { key: "path",         type: "path",       label: "Value Path (integer)" },
      { key: "maxPath",      type: "path",       label: "Max Path (blank = use Max below)" },
      { key: "maxCount",     type: "number",     label: "Max (when no Max Path)" },
      { key: "icon",         type: "text",       label: "FA icon (e.g. fa-coins, fa-star)" },
      { key: "emptyIcon",    type: "text",       label: "Empty token icon (blank = same glyph)" },

      { key: "iconImg",      type: "image-pick", label: "Filled token image (overrides FA icon)" },
      { key: "emptyIconImg", type: "image-pick", label: "Empty token image (blank = use Empty icon)" },
      { key: "color",        type: "color",      label: "Filled colour" },
      { key: "bgColor",      type: "color",      label: "Empty colour" },
      { key: "pipSize",      type: "number",     label: "Token size (px, 10\u201324)" }
    ]
  },

  diceTray: {
    id:    "diceTray",
    label: "Dice Tray",
    icon:  "fa-dice",
    desc:  "Shows the last dice roll",
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

  tags: {
    id:    "tags",
    label: "Tags / Traits",
    icon:  "fa-tags",
    desc:  "Pill list of traits / keywords",
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

  image: {
    id:    "image",
    label: "Image",
    icon:  "fa-image",
    desc:  "Static image",
    defaultSpan: 1,
    defaults: {
      label:       "",
      staticSrc:   "",
      width:       64,
      height:      64,
      borderRadius: 4
    },
    configFields: [
      { key: "staticSrc", type: "text", label: "Image" }
    ]
  },

  vsection: {
    id:    "vsection",
    label: "Vertical Section",
    icon:  "fa-bars",
    desc:  "Vertical stack inside a cell",
    defaultSpan: 1,
    defaults: {
      label:   "",
      widgets: []
    },
    configFields: [
      { key: "label", type: "text", label: "Heading (optional)" }
    ]
  },

  derived: {
    id:    "derived",
    label: "Derived Value",
    icon:  "fa-function",
    desc:  "Read-only computed value",
    defaultSpan: 1,
    defaults: {
      label:         "Derived",
      formula:       "0",
      decimalPlaces: 0,
      valueFontSize: 0
    },
    configFields: [
      { key: "label",         type: "text",   label: "Label" },
      { key: "formula",       type: "text",   label: "Formula", mono: true, placeholder: "{system.attributes.attr1.value} * 2" },
      { key: "decimalPlaces", type: "number", label: "Decimal places (0 = integer)" },
      { key: "valueFontSize", type: "number", label: "Value font size (px, 0 = default)" }
    ]
  },

  cardHand: {
    id:    "cardHand",
    label: "Card Hand",
    icon:  "fa-cards",
    desc:  "Hand / deck visualizer",
    defaultSpan: 4,
    defaults: {
      label:        "Hand",
      sourceName:   "",
      sourceUuid:   "",
      layout:       "strip",
      clickAction:  "inspect",
      runGraphOn:   "click",
      actionGraph:  "",
      showCount:    "yes",
      showActions:  "yes",
      cardWidth:    96,
      maxVisible:   12
    },
    configFields: [
      { key: "label",       type: "text",   label: "Label" },
      { key: "sourceName",  type: "text",   label: "Cards stack name", placeholder: "e.g. Aelyn's Hand" },
      { key: "sourceUuid",  type: "text",   label: "…or Cards UUID",   placeholder: "Cards.xxxx" },
      { key: "layout",      type: "select", label: "Layout",
        options: ["fan","strip","grid"] },
      { key: "clickAction", type: "select", label: "Click on card",
        options: ["inspect","play","discard","flip","runGraph","none"] },
      { key: "runGraphOn",  type: "select", label: "Run graph on (when clickAction=runGraph)",
        options: ["click","dblclick","rightclick"] },
      { key: "actionGraph", type: "actionGraph", label: "Action graph (when clickAction=runGraph)" },
      { key: "showCount",   type: "select", label: "Show count",      options: ["yes","no"] },
      { key: "showActions", type: "select", label: "Show actions bar (Shuffle/Recall/Flip All)", options: ["yes","no"] },
      { key: "cardWidth",   type: "number", label: "Card width (px)" },
      { key: "maxVisible",  type: "number", label: "Max visible (0 = all)" }
    ]
  },

  questMarker: {
    id:    "questMarker",
    label: "Quest Marker",
    icon:  "fa-flag",
    desc:  "Show actor's currently active quest with link to its log",
    defaultSpan: 3,
    defaults: {
      label:         "",
      questLogUuid:  "",
      iconActive:    "fa-flag",
      iconNone:      "fa-flag-checkered",
      compact:       "no",
      placeholder:   "No active quest",
      tooltipLength: 240
    },
    configFields: [
      { key: "label",         type: "text",     label: "Header label (optional)" },
      { key: "questLogUuid",  type: "dropUuid", label: "Locked QuestLog (optional)", options: ["Item.questlog"] },
      { key: "iconActive",    type: "text",     label: "Icon when a quest is active (FA class)" },
      { key: "iconNone",      type: "text",     label: "Icon when no active quest (FA class)" },
      { key: "compact",       type: "select",   label: "Compact (icon-only)", options: ["no","yes"] },
      { key: "placeholder",   type: "text",     label: "Text when no active quest" },
      { key: "tooltipLength", type: "number",   label: "Tooltip preview length (chars)" }
    ]
  },

  cardDrawButton: {
    id:    "cardDrawButton",
    label: "Card Draw Button",
    icon:  "fa-square-caret-up",
    desc:  "Draw cards from a deck",
    defaultSpan: 2,
    defaults: {
      label:       "Draw",
      fromName:    "",
      fromUuid:    "",
      toName:      "",
      toUuid:      "",
      count:       1,
      how:         "top",
      showCount:   "yes"
    },
    configFields: [
      { key: "label",     type: "text",   label: "Label" },
      { key: "fromName",  type: "text",   label: "From deck name" },
      { key: "fromUuid",  type: "text",   label: "…or Deck UUID" },
      { key: "toName",    type: "text",   label: "To hand name" },
      { key: "toUuid",    type: "text",   label: "…or Hand UUID" },
      { key: "count",     type: "number", label: "Cards per click" },
      { key: "how",       type: "select", label: "Take from", options: ["top","bottom","random"] },
      { key: "showCount", type: "select", label: "Show count badge", options: ["yes","no"] }
    ]
  },

  widgetBuilder: {
    id:    "widgetBuilder",
    label: "Widget Builder",
    icon:  "fa-shapes",
    desc:  "Composite widget: named buttons, values, icons and images; elements can be clickable and fire per-element On Click custom events",
    defaultSpan: 3,
    defaults: {
      label:    "",
      columns:  3,
      gap:      6,
      formula:  "",
      elements: [],
      wbLayout: "grid",
      canvasW: 0,
      canvasH: 140,
      gridSize: 16,
      snap: 4,
      clipOverflow: true,
      customCss: ""
    },
    configFields: [
      { key: "label",        type: "text",    label: "Label" },
      { key: "wbLayout",     type: "select",  label: "Layout", options: ["grid", "free"] },
      { key: "columns",      type: "number",  label: "Columns (grid)" },
      { key: "gap",          type: "number",  label: "Gap (px, grid)" },
      { key: "canvasW",      type: "number",  label: "Canvas width (px; 0 = full)" },
      { key: "canvasH",      type: "number",  label: "Canvas height (px)" },
      { key: "gridSize",     type: "number",  label: "Visual grid size (px)" },
      { key: "snap",         type: "number",  label: "Snap step (px; 0 = off)" },
      { key: "clipOverflow", type: "toggle",  label: "Clip outside canvas" },
      { key: "customCss",    type: "textarea", label: "Safe scoped CSS" }
    ]
  }
};

export const WIDGET_VARIANTS = {
  text:           ["default", "boxed", "underline", "ghost", "inline"],
  richtext:       ["default", "boxed", "scroll"],
  number:         ["default", "chip", "stat", "framed"],
  resource:       ["default", "split", "heart", "stripes", "digital", "pulse", "orb"],
  progress:       ["default", "thin", "thick", "striped", "segmented"],
  clock:          ["default", "ring", "bar", "fraction"],
  counter:        ["default", "chunky", "minimal", "wheel"],
  dice:           ["default", "d20-big", "chip", "flat"],
  button:         ["default", "pill", "outline", "ghost", "raised", "danger", "soft"],
  rollButton:     ["default", "d20", "flat", "stamp"],
  toggle:         ["default", "checkbox", "pill", "led"],
  select:         ["default", "pills", "segmented", "radio"],
  attribute:      ["default", "stat-card", "inline", "badge", "roll-button"],
  attributeGroup: ["default", "row", "grid", "dice"],
  tags:           ["default", "outline", "solid", "soft"],
  image:          ["default", "framed", "circle", "polaroid", "token"],
  section:        ["default", "underline", "divider", "tab", "pill"],
  inventory:      ["default", "list", "grid", "iconbar", "cards", "card-slider", "card-grid"],
  slot:           ["default", "framed", "round", "ghost", "tile"],
  cardHand:       ["default", "fan", "stack", "grid"],
  cardDrawButton: ["default", "deck", "pile"],
  questMarker:    ["default", "compact", "framed", "ghost"],
  effects:        ["default", "chips", "icons", "card-slider", "card-grid"],
  spellbook:      ["default", "grimoire", "grid", "minimal", "card-slider", "card-grid"],
  skill:          ["default", "pill", "row-rank", "pips"],
  derived:        ["default", "stat-card", "formula-badge", "inline", "pill"]
};

export function getVariantField(type) {
  const list = WIDGET_VARIANTS[type];
  if (!list || list.length === 0) return null;
  return {
    key:   "variant",
    type:  "variant",
    label: "Variant",
    variantType: type,
    options: list.map(id => ({
      value: id,
      label: `SD.WidgetVariants.${type}.${id}`,
      fallback: id === "default" ? "Default" : id
    }))
  };
}

for (const [type, def] of Object.entries(WIDGET_TYPES)) {
  if (!WIDGET_VARIANTS[type]) continue;
  const field = getVariantField(type);
  if (!field) continue;
  def.defaults = { ...(def.defaults || {}), variant: "default" };
  def.configFields = [...(def.configFields || []), field];
}

export const CLICKABLE_WIDGET_TYPES = new Set([
  "dice",
  "rollButton",
  "button",
  "attribute",
  "attributeGroup",
  "skill",
  "toggle",
  "counter",
  "number",
  "tracker",
  "tokenPool",
  "clock",
  "cardHand",
  "cardDrawButton"
]);

for (const type of CLICKABLE_WIDGET_TYPES) {
  const def = WIDGET_TYPES[type];
  if (!def) continue;
  def.defaults = { ...(def.defaults || {}), animationTag: "" };
  def.configFields = [
    ...(def.configFields || []),
    {
      key: "animationTag",
      type: "text",
      label: "Animation Tag (Automated Animations)",
      placeholder: "name matched by AA Auto Recognition"
    }
  ];
}

export const WIDGET_PALETTE_ORDER = [
  "text", "number", "counter", "resource", "derived", "dice", "button",
  "toggle", "attribute", "attributeGroup", "skill", "progress", "tracker", "tokenPool", "clock",
  "slot", "inventory", "effects", "spellbook",
  "select", "tags", "image", "section", "vsection", "richtext",
  "cardHand", "cardDrawButton",
  "questMarker",
  "widgetBuilder"
];

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

