const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const INLINE_TYPES = [
  { value: "section", label: "Section / Header" },
  { value: "text",    label: "Text"             },
  { value: "image",   label: "Image"            },
  { value: "button",  label: "Button"           },
  { value: "richtext",label: "Rich Text"        }
];

const FIELDS = {
  section: [
    ["Title", "label", "text"]
  ],
  text: [
    ["Label",      "label",        "text"],
    ["Widget Key", "widgetKey",    "text"],
    ["Static Value", "staticValue","text"],
    ["Read Only",  "readOnly",     "boolean"]
  ],
  image: [
    ["Label",       "label",      "text"],
    ["Widget Key",  "widgetKey",  "text"],
    ["Image URL",   "staticSrc",  "text"],
    ["Width (px)",  "boxW",       "number"],
    ["Height (px)", "boxH",       "number"]
  ],
  button: [
    ["Label",                  "label",      "text"],
    ["Widget Key",             "widgetKey",  "text"],
    ["FA Icon (e.g. fa-bolt)", "icon",       "text"],
    ["Roll Formula (optional)","formula",    "text"],
    ["Chat Flavor / Message",  "flavor",     "text"],
    ["Animation Tag (Automated Animations)", "animationTag", "text"]
  ],
  richtext: [
    ["Label",      "label",     "text"],
    ["Widget Key", "widgetKey", "text"],
    ["Static HTML","staticHtml","textarea"]
  ]
};

const COMMON_STYLE_FIELDS = [
  ["Background",     "boxBg",     "color"],
  ["Text Color",     "boxFg",     "color"],
  ["Border",         "boxBorder", "color"],
  ["Border Radius",  "boxRadius", "number"],
  ["Padding",        "boxPad",    "number"]
];

class InlineWidgetEditor extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: "sd-hud-inline-editor",
    classes: ["sd", "sd-hud-inline-editor"],
    window: { title: "Edit inline HUD widget", icon: "fa-solid fa-pen-to-square", resizable: true },
    position: { width: 460, height: 520 },
    actions: {
      save:   InlineWidgetEditor._onSave,
      cancel: InlineWidgetEditor._onCancel
    }
  };

  static PARTS = {
    content: { template: "systems/sd/templates/action-hud/inline-editor.hbs", scrollable: [".inline-form"] }
  };

  _def = null;
  _resolve = null;

  constructor(def, resolve, options = {}) {
    super(options);
    this._def = def ?? { id: foundry.utils.randomID(), type: "section", label: "Section" };
    this._resolve = resolve;
  }

  async _prepareContext(options) {
    const base = await super._prepareContext(options);
    const def  = this._def;
    const fields = FIELDS[def.type] ?? FIELDS.section;
    return {
      ...base,
      def,
      types: INLINE_TYPES,
      fields: fields.map(([label, key, kind]) => ({
        label, key, kind,
        value: def[key] ?? ""
      })),
      styleFields: COMMON_STYLE_FIELDS.map(([label, key, kind]) => ({
        label, key, kind,
        value: def[key] ?? ""
      }))
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const sel = this.element.querySelector("select[name='__type']");
    sel?.addEventListener("change", () => {
      this._readForm();
      this._def.type = sel.value;
      this.render();
    });
  }

  _readForm() {
    const form = this.element?.querySelector("form");
    if (!form) return;
    const FDE = foundry.applications?.ux?.FormDataExtended ?? FormDataExtended;
    const raw = new FDE(form).object;
    const fields = FIELDS[this._def.type] ?? FIELDS.section;
    for (const [, key, kind] of fields) {
      if (!(key in raw)) continue;
      const v = raw[key];
      if (kind === "boolean") this._def[key] = !!v;
      else if (kind === "number") {
        const n = Number(v);
        this._def[key] = Number.isFinite(n) ? n : undefined;
      } else this._def[key] = v;
    }
    for (const [, key, kind] of COMMON_STYLE_FIELDS) {
      if (!(key in raw)) continue;
      const v = raw[key];
      if (kind === "number") {
        const n = Number(v);
        if (Number.isFinite(n)) this._def[key] = n; else delete this._def[key];
      } else if (typeof v === "string" && v.trim() === "") {
        delete this._def[key];
      } else this._def[key] = v;
    }
  }

  static async _onSave(event, target) {
    this._readForm();
    if (!this._def.id) this._def.id = foundry.utils.randomID();
    if (this._resolve) this._resolve(this._def);
    this._resolve = null;
    this.close();
  }

  static async _onCancel(event, target) {
    if (this._resolve) this._resolve(null);
    this._resolve = null;
    this.close();
  }

  async close(options) {
    if (this._resolve) {
      this._resolve(null);
      this._resolve = null;
    }
    return super.close(options);
  }
}

export async function openInlineWidgetEditor(existingDef = null) {
  const def = existingDef
    ? foundry.utils.deepClone(existingDef)
    : { id: foundry.utils.randomID(), type: "section", label: "Section" };

  return new Promise((resolve) => {
    const ed = new InlineWidgetEditor(def, resolve);
    ed.render(true);
  });
}
