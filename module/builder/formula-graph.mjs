import { migrateGraph, NODE_TYPE_MIGRATIONS } from "./node-migration.mjs";
import { pinSubtype, pinTypeMeta, subtypeColor, arePinsCompatible } from "./pin-types.mjs";
import { lintGraph, lintSummary } from "./graph-linter.mjs";
import {
  formulaBounds, clampFormula, multiplyFormula, addMod, doubleDice,
  resolveAtRefs, coerceBool
} from "./formula-utils.mjs";
import { WIDGET_VARIANTS } from "./widget-registry.mjs";
import { SDOnboarding } from "../helpers/onboarding.mjs";
import { FormulaEngine } from "../helpers/formula-engine.mjs";
import { openFoundryWindow } from "../helpers/foundry-window-host.mjs";
import { databaseSelectOptions, databaseRecordSelectOptions, databaseTypeOptions, databaseTypePin, getDatabaseRecord } from "../helpers/shared-database.mjs";

function uid() { return Math.random().toString(36).slice(2,9); }
function esc(s) { return String(s??"").replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;"); }

function _arrayArg(value) {
  try {
    return `b64:${btoa(unescape(encodeURIComponent(String(value ?? ""))))}`;
  } catch {
    return "b64:";
  }
}

function _messageComposerButtons(data = {}) {
  const stored = Array.isArray(data?.buttons) ? data.buttons : [];
  const defaults = [
    { id:"btn0", enabled:true,  label:"Apply",    icon:"fas fa-check", variant:"primary" },
    { id:"btn1", enabled:false, label:"Details",  icon:"fas fa-circle-info", variant:"secondary" },
    { id:"btn2", enabled:false, label:"Continue", icon:"fas fa-arrow-right", variant:"success" },
    { id:"btn3", enabled:false, label:"Cancel",   icon:"fas fa-xmark", variant:"danger" },
    { id:"btn4", enabled:false, label:"Option 5", icon:"fas fa-circle", variant:"secondary" },
    { id:"btn5", enabled:false, label:"Option 6", icon:"fas fa-circle", variant:"secondary" }
  ];
  const variants = new Set(["primary", "secondary", "success", "danger", "warning"]);
  return defaults.map((fallback, index) => {
    const source = stored.find(button => String(button?.id ?? "") === fallback.id) ?? stored[index] ?? {};
    const variant = variants.has(String(source.variant ?? "")) ? String(source.variant) : fallback.variant;
    return {
      id: fallback.id,
      enabled: source.enabled === undefined ? fallback.enabled : !!source.enabled,
      label: String(source.label ?? fallback.label).trim() || fallback.label,
      icon: String(source.icon ?? fallback.icon).trim() || fallback.icon,
      variant
    };
  });
}

function _cleanGraphText(value) {
  return String(value ?? "")
    .replaceAll("РІвЂ вЂ™", "->")
    .replaceAll("в†’", "->")
    .replaceAll("→", "->")
    .replaceAll("РІвЂ С’", "<-")
    .replaceAll("в†ђ", "<-")
    .replaceAll("←", "<-")
    .replaceAll("РІвЂ вЂ", "^")
    .replaceAll("в†‘", "^")
    .replaceAll("↑", "^")
    .replaceAll("РІвЂ вЂњ", "v")
    .replaceAll("в†“", "v")
    .replaceAll("↓", "v")
    .replaceAll("РІР‚вЂќ", "-")
    .replaceAll("вЂ”", "-")
    .replaceAll("—", "-")
    .replaceAll("РІР‚В¦", "...")
    .replaceAll("вЂ¦", "...")
    .replaceAll("…", "...")
    .replaceAll("РІСљвЂў", "x")
    .replaceAll("вњ•", "x")
    .replaceAll("✕", "x")
    .replaceAll("вњ“", "OK")
    .replaceAll("вњ”", "OK")
    .replaceAll("в¬‡", "Drop")
    .replaceAll("в¬Ў", "[slots]")
    .replaceAll("РІР‚Сћ", "*")
    .replaceAll("вЂў", "*")
    .replaceAll("•", "*")
    .replaceAll("РІв‚¬вЂ™", "-")
    .replaceAll("в€’", "-")
    .replaceAll("−", "-")
    .replaceAll("Р’В·", "-")
    .replaceAll("·", "-")
    .replaceAll("Р“вЂ”", "x")
    .replaceAll("Г—", "x")
    .replaceAll("×", "x")
    .replaceAll("Р“В·", "/")
    .replaceAll("РІвЂ°В ", "!=")
    .replaceAll("в‰ ", "!=")
    .replaceAll("≠", "!=")
    .replaceAll("РІвЂ°Тђ", ">=")
    .replaceAll("в‰Ґ", ">=")
    .replaceAll("≥", ">=")
    .replaceAll("РІвЂ°В¤", "<=")
    .replaceAll("в‰¤", "<=")
    .replaceAll("≤", "<=")
    .replaceAll("В°", " deg")
    .replaceAll("°", " deg");
}

function _slugLabel(s) {
  s = _cleanGraphText(s)
    .replace(/->/g, " Arrow ")
    .replace(/<-/g, " ArrowL ");
  const map = {
    "в†’":"Arrow", "в†ђ":"ArrowL", "в†‘":"ArrowU", "в†“":"ArrowD",
    "в‰ ":"NEq", "в‰Ґ":"GEq", "в‰¤":"LEq", "в€ћ":"Inf",
    "Г—":"Times", "Г·":"Div",
    "вЂў":"Bullet",
    "@":"At", "#":"Hash", "%":"Pct", "+":"Plus", "-":"Minus",
    "&":"Amp", "/":"Slash", "\\":"Bslash",
    "(":"", ")":"", "[":"", "]":"", "{":"", "}":"",
    ",":"", ".":"", ":":"", ";":"", "?":"Q", "!":"Bang", "*":"Star",
    "=":"Eq", "<":"Lt", ">":"Gt", "|":"Pipe"
  };
  let out = "";
  for (const ch of String(s ?? "")) {
    if (/[\p{L}0-9]/u.test(ch)) out += ch;
    else if (map[ch] !== undefined)     out += map[ch];
    else if (/\s/.test(ch))             out += "_";
  }
  return out.replace(/^_+|_+$/g, "").replace(/__+/g, "_") || "_";
}

const _NG_LANG_CACHE = { en: null, ru: null };
const _NG_DEFAULT_LANG = "en";

function _ngLangSetting() {
  try {
    const v = globalThis.game?.settings?.get?.("sd", "nodeGraphLanguage");
    if (typeof v === "string" && v) return v;
  } catch {  }
  return "auto";
}

function _ngLookupCached(lang, key) {
  const dict = _NG_LANG_CACHE[lang];
  if (dict && Object.prototype.hasOwnProperty.call(dict, key)) return dict[key];
  if (dict) {
    const nested = String(key).split(".").reduce((value, part) => value?.[part], dict);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

export async function _loadNodeGraphLangs() {
  const base = (() => {
    try {
      const sys = globalThis.game?.system;
      if (sys?.id) return `systems/${sys.id}/lang`;
    } catch {  }
    return "systems/sd/lang";
  })();
  const langs = ["en", "ru"];
  await Promise.all(langs.map(async (l) => {
    if (_NG_LANG_CACHE[l]) return;
    try {
      const res = await fetch(`${base}/${l}.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      _NG_LANG_CACHE[l] = j && typeof j === "object" ? j : {};
    } catch (e) {
      console.warn(`SD | failed to load node-graph lang '${l}':`, e);
      _NG_LANG_CACHE[l] = {};
    }
  }));
}

function _NL(text) {
  if (!text) return text;
  try {
    const key  = `SD.Graph.${_slugLabel(text)}`;
    const lang = _ngLangSetting();

    if (lang !== "auto") {
      const direct = _ngLookupCached(lang, key);
      if (typeof direct === "string" && direct !== "") return _cleanGraphText(direct);
      const fb = _ngLookupCached(_NG_DEFAULT_LANG, key);
      if (typeof fb === "string" && fb !== "") return _cleanGraphText(fb);
      return _cleanGraphText(text);
    }

    const i18n = globalThis.game?.i18n;
    if (i18n?.has?.(key)) return _cleanGraphText(i18n.localize(key));
    if (i18n?.localize) {
      const s = i18n.localize(key);
      if (s && s !== key) return _cleanGraphText(s);
    }
  } catch {  }
  return _cleanGraphText(text);
}

function _round(expr, nodeData) {
  const mode = String(nodeData?.round ?? "none");
  if (mode === "floor") return `floor(${expr})`;
  if (mode === "ceil")  return `ceil(${expr})`;
  return expr;
}

const _ROUND_FIELD = {
  key:"round", label:"Round", type:"select", default:"none",
  options:[
    { value:"none",  label:"No rounding" },
    { value:"floor", label:"Down (floor)" },
    { value:"ceil",  label:"Up (ceil)" }
  ]
};

const AI_PROVIDER_PROFILE_OPTIONS = [
  { value:"",          label:"Default" },
  { value:"dialogue",  label:"Dialogue" },
  { value:"memory",    label:"Memory" },
  { value:"bio",       label:"Dynamic Bio" },
  { value:"assistant", label:"Assistant" }
];

export const NODE_DEFS = {

  output: {
    title:"OUTPUT", color:"#5a4ec0", cat:"_system",
    desc:"Connect a formula value OR an exec chain. Use Branch to split paths.",
    inputs:[
      {id:"value",     label:"Formula value", type:"value.any"},
      {id:"exec",      label:"Run (exec)",    type:"exec"}
    ],
    outputs:[],
    fields:[],
    isOutput:true
  },

  number_output: {
    title:"NUMBER OUTPUT", color:"#2a4060", cat:"_system",
    desc:"Number widget output. Wire Min, Max, and Step. No exec chain.",
    inputs:[
      {id:"min",  label:"Min",  type:"value.number"},
      {id:"max",  label:"Max",  type:"value.number"},
      {id:"step", label:"Step", type:"value.number"}
    ],
    outputs:[],
    fields:[],
    isNumberWidgetOutput:true,
    noDelete:true
  },

  attr_score_val: {
    title:"Attr Score", color:"#7a4a1a", cat:"Attribute",
    desc:"Live numeric value of this attribute (read-only, always present in attribute graphs).",
    inputs:[], outputs:[{id:"value",label:"Value",type:"value.number"}],
    fields:[{key:"path",label:"Score Path",type:"path",default:"system.attributes.attr1.value"}],
    isAttrScore: true,
    compile:(n)=>`{${n.data.path??"system.attributes.attr1.value"}}`
  },
  attr_output: {
    title:"ATTR OUTPUT", color:"#7a4a1a", cat:"_attr",
    desc:"Attribute widget output. Wire modValue to set what the modifier button shows and rolls.",
    inputs:[
      {id:"modValue", label:"Mod Value",   type:"value.number"}
    ],
    outputs:[],
    fields:[],
    isAttrOutput:true
  },

  skill_rank_val: {
    title:"Skill Rank", color:"#1a4a7a", cat:"_skill",
    desc:"Live numeric value of this skill rank (read-only, always present in skill graphs).",
    inputs:[], outputs:[{id:"value",label:"Value",type:"value.number"}],
    fields:[{key:"path",label:"Rank Path",type:"path",default:"system.skills.skill1.rank"}],
    isSkillRank: true,
    compile:(n)=>`{${n.data.path??"system.skills.skill1.rank"}}`
  },
  skill_output: {
    title:"SKILL OUTPUT", color:"#1a4a7a", cat:"_skill",
    desc:"Skill widget output. Wire modValue to set what the bonus button shows and rolls.",
    inputs:[
      {id:"modValue", label:"Mod Value", type:"value.number"}
    ],
    outputs:[],
    fields:[],
    isSkillOutput:true
  },

  init_on_roll: {
    title:"On Initiative Roll", color:"#b05000", cat:"_initiative",
    desc:"Fixed entry point fired when initiative is rolled. The compiled formula from this graph is used as the world initiative formula.",
    inputs:[],
    outputs:[{id:"exec", label:"Execute", type:"exec"}],
    fields:[],
    isTrigger: true,
    isInitTrigger: true
  },

  init_output: {
    title:"INITIATIVE OUTPUT", color:"#b05000", cat:"_initiative",
    desc:"Initiative formula output. Wire Initiative value (a roll value or number) to set the world initiative formula.",
    inputs:[
      {id:"value", label:"Initiative value", type:"value.any"}
    ],
    outputs:[],
    fields:[],
    isInitOutput: true
  },

  branch: {
    title:"Branch", color:"#8a2a8a", cat:"Flow Control",
    desc:"If Condition is TRUE runs True path; otherwise False path",
    inputs:[
      {id:"exec",  label:"",         type:"exec"},
      {id:"cond",  label:"Condition",type:"value.bool"}
    ],
    outputs:[
      {id:"true",  label:"True",  type:"exec"},
      {id:"false", label:"False", type:"exec"}
    ],
    fields:[],
    isBranch:true
  },

  if_node: {
    title:"If Compare", color:"#8a2a8a", cat:"Flow Control",
    desc:"Exec passes through when A compares true against B/value. Handy for assistant-built simple checks like HP < 5 -> Message.",
    inputs:[
      {id:"exec", label:"", type:"exec"},
      {id:"a",    label:"A", type:"value.any"},
      {id:"b",    label:"B", type:"value.any"}
    ],
    outputs:[{id:"exec", label:"True", type:"exec"}],
    fields:[
      {key:"operator",  label:"Operator", type:"select", default:"<", options:["<","<=",">",">=","==","!="]},
      {key:"value",     label:"B fallback", type:"text", default:"0"},
      {key:"condition", label:"Condition override", type:"text", default:"", placeholder:"Optional full formula condition"}
    ],
    isIfCompare:true,
    condition:(n,inp)=>{
      const explicit = String(n.data.condition ?? "").trim();
      if (explicit) return explicit;
      const allowed = new Set(["<","<=",">",">=","==","!="]);
      let op = String(n.data.operator ?? "<").trim();
      if (op === "=") op = "==";
      if (op === "===") op = "==";
      if (op === "!==") op = "!=";
      if (!allowed.has(op)) op = "<";
      const a = inp.a ?? "0";
      const b = inp.b ?? n.data.value ?? "0";
      return `(${a}${op}${b})`;
    }
  },

  on_click: {
    title:"On Click", color:"#b05000", cat:"Events",
    desc:"Entry point - fired when the item's Use button is pressed. Connect its exec output to your action chain.",
    inputs:[],
    outputs:[{id:"exec", label:"Execute", type:"exec"}],
    fields:[],
    isTrigger: true
  },

  sequence: {
    title:"Sequence", color:"#8a2a8a", cat:"Flow Control",
    desc:"Run N exec branches in strict order (1 → 2 → … → N). Set `count` to pick how many branches; connected + 1 is the smallest safe count.",
    inputs:[{id:"exec",label:"",type:"exec"}],
    outputs:[
      {id:"a0", label:"Then 1",  type:"exec"},
      {id:"a1", label:"Then 2",  type:"exec"},
      {id:"a2", label:"Then 3",  type:"exec"},
      {id:"a3", label:"Then 4",  type:"exec"},
      {id:"a4", label:"Then 5",  type:"exec"},
      {id:"a5", label:"Then 6",  type:"exec"},
      {id:"a6", label:"Then 7",  type:"exec"},
      {id:"a7", label:"Then 8",  type:"exec"},
      {id:"a8", label:"Then 9",  type:"exec"},
      {id:"a9", label:"Then 10", type:"exec"},
      {id:"a10",label:"Then 11", type:"exec"},
      {id:"a11",label:"Then 12", type:"exec"}
    ],
    fields:[
      {key:"count", label:"Count (2-12)", type:"number", default:2}
    ],
    isSequence: true
  },

  literal: {
    title:"Number", color:"#2a4a6a", cat:"Values",
    desc:"Numeric constant. A connected In value overrides the field.",
    inputs:[{id:"in",label:"In",type:"value.number"}], outputs:[{id:"v",label:"Out",type:"value.number"}],
    fields:[{key:"value",label:"",type:"number",default:0}],
    compile:(n,i)=> i.in !== undefined ? String(i.in) : String(n.data.value ?? 0)
  },
  literal_str: {
    title:"Text", color:"#2a4a6a", cat:"Values",
    desc:"Text constant. A connected In value overrides the field.",
    inputs:[{id:"in",label:"In",type:"value.string"}], outputs:[{id:"v",label:"Out",type:"value.string"}],
    fields:[{key:"value",label:"",type:"text",default:""}],
    compile:(n,i)=>{
      const v = i.in !== undefined ? String(i.in) : String(n.data.value ?? "");
      return `"${v.replace(/\\/g,"\\\\").replace(/"/g,'\\"')}"`;
    }
  },
  convert_number: {
    title:"To Number", color:"#2f8a72", cat:"Conversion",
    desc:"Convert any value to a number. Numeric text is parsed; invalid or empty input uses Default.",
    inputs:[{id:"value",label:"Value",type:"value.any"},{id:"default",label:"Default",type:"value.number"}],
    outputs:[{id:"v",label:"Number",type:"value.number"}],
    fields:[{key:"default",label:"Default",type:"number",default:0}],
    compile:(n,i)=>`{convertValue:number|${_arrayArg(i.value ?? "")}|${_arrayArg(i.default ?? n.data.default ?? 0)}}`
  },
  convert_text: {
    title:"To Text", color:"#2f8a72", cat:"Conversion",
    desc:"Convert a number, boolean, UUID or any scalar value to text.",
    inputs:[{id:"value",label:"Value",type:"value.any"}],
    outputs:[{id:"v",label:"Text",type:"value.string"}],
    fields:[], compile:(_n,i)=>`{convertValue:text|${_arrayArg(i.value ?? "")}}`
  },
  convert_boolean: {
    title:"To Boolean", color:"#2f8a72", cat:"Conversion",
    desc:"Convert common values to true/false. Empty, 0, false, no, off and null are false.",
    inputs:[{id:"value",label:"Value",type:"value.any"}],
    outputs:[{id:"v",label:"Boolean",type:"value.bool"}],
    fields:[], compile:(_n,i)=>`{convertValue:boolean|${_arrayArg(i.value ?? "")}}`
  },
  convert_array: {
    title:"To Array", color:"#2f8a72", cat:"Conversion",
    desc:"Convert a comma-separated value or JSON array to a typed Array pin.",
    inputs:[{id:"value",label:"Value",type:"value.any"}],
    outputs:[{id:"v",label:"Array",type:"value.array"}],
    fields:[], compile:(_n,i)=>`{convertValue:array|${_arrayArg(i.value ?? "")}}`
  },
  is_valid: {
    title:"Is Valid", color:"#2f8a72", cat:"Conversion",
    desc:"True when Value is not empty, null, undefined or a formula error.",
    inputs:[{id:"value",label:"Value",type:"value.any"}],
    outputs:[{id:"v",label:"Valid",type:"value.bool"}],
    fields:[], compile:(_n,i)=>`{convertValue:valid|${_arrayArg(i.value ?? "")}}`
  },

  get_path: {
    title:"Get Field Value", color:"#1a4060", cat:"Get Data", wideNode:true,
    keywords:"target field token field uuid field get field value read",
    desc:"Read any field by dot-path from a chosen Source: Self (this actor/item), First Target (first targeted token's actor), Token by Id (wire a Token Id, e.g. from For Each Token; defaults to the current loop token), or By UUID (wire an actor/item UUID into Ref). Replaces the old Target Field / Token Field nodes.",
    inputs:[{id:"ref", label:"Token Id / UUID", type:"value.any"}],
    outputs:[{id:"v",label:"Value",type:"value.any"}],
    fields:[
      {key:"source",label:"Source",type:"select",default:"self",options:["self","first target","token by id","by uuid"]},
      {key:"path",label:"Path",type:"path",default:"system.resources.hp.value"}
    ],
    compile:(n,i)=>{
      const p   = String(n.data.path ?? "").trim();
      const src = String(n.data.source ?? "self");
      if (src === "first target") return `{target.${p}}`;
      if (src === "token by id") {
        const tid = (i.ref != null && i.ref !== "") ? String(i.ref) : "{__currentTarget}";
        return `{tokenField:${tid}.${p}}`;
      }
      if (src === "by uuid") {
        const b64 = (x)=>{ try { return btoa(unescape(encodeURIComponent(String(x ?? "")))); } catch { return ""; } };
        return `{uuidField:${_arrayArg(i.ref ?? "")}|0|${b64(p)}}`;
      }
      return (p.startsWith("{") && p.endsWith("}")) ? p : `{${p}}`;
    }
  },
  get_widget: {
    title:"Get Widget Value", color:"#1a4060", cat:"Get Data",
    desc:"Read the current value of a widget. Pick a static Widget, or connect Widget Key to resolve a widget dynamically (for example, feed a Select containing attribute widget keys).",
    inputs:[{id:"key",label:"Widget Key",type:"value.string"}], outputs:[{id:"v",label:"Value",type:"value.any"}],
    fields:[{key:"key",label:"Widget",type:"widget-picker",default:""}],
    compile:(n,i)=>{
      const dynamicKey = i.key;
      if (dynamicKey !== undefined && dynamicKey !== null && String(dynamicKey).trim() !== "") {
        let b64 = "";
        try { b64 = btoa(unescape(encodeURIComponent(String(dynamicKey)))); } catch {}
        return `{__sdWidgetValue:${b64}}`;
      }
      return `{widget:${n.data.key??""}}`;
    }
  },
  get_widget_path: {
    title:"Get Widget Path", color:"#1a4060", cat:"Get Data",
    desc:"Emits the data path bound to a widget (e.g. system.flags.hp). Feed into Set Field / Modify to change the widget's value from the graph.",
    inputs:[], outputs:[{id:"v",label:"Path",type:"value.path"}],
    fields:[{key:"key",label:"Widget",type:"widget-picker",default:""}],
    compile:(n)=>`{widgetPath:${n.data.key??""}}`
  },
  get_name: {
    title:"Get Name", color:"#1a4060", cat:"Get Data",
    desc:"Returns the display name of an Item, Widget, Token, Actor or Sheet by UUID, ID, widget key, or name. Pick a Kind to constrain the lookup, or leave it on Auto to try each kind in order. The Ref pin (if connected) overrides the static reference.",
    inputs:[
      {id:"ref", label:"Ref", type:"value.any"}
    ],
    outputs:[{id:"v", label:"Name", type:"value.string"}],
    fields:[
      {key:"kind", label:"Kind", type:"select", default:"auto",
        options:[
          {value:"auto",   label:"Auto (try all)"},
          {value:"item",   label:"Item (uuid / id / name)"},
          {value:"widget", label:"Widget (widget key)"},
          {value:"token",  label:"Token (id / uuid / name)"},
          {value:"actor",  label:"Actor / Sheet (uuid / id / name)"},
          {value:"sheet",  label:"Sheet (uuid)"}
        ]},
      {key:"ref", label:"Ref / UUID / Key / Name", type:"text", default:"",
        placeholder:"Actor.xxxxx, Scene.x.Token.y, widgetKey, item name…"}
    ],
    isPure:true,
    compile:(n,i)=>{
      const _unquote = (v) => {
        if (v == null) return null;
        const s = String(v).trim();
        if (s.length >= 2 && ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))) {
          return s.slice(1, -1);
        }
        return s;
      };
      const r = (i.ref !== undefined && i.ref !== null && String(i.ref).trim() !== "")
        ? _unquote(i.ref)
        : String(n.data.ref ?? "");
      const kind = String(n.data.kind ?? "auto").trim() || "auto";
      const _b64 = (s) => {
        try { return btoa(unescape(encodeURIComponent(String(s ?? "")))); }
        catch { return ""; }
      };
      return `{__sdName:${kind}|${_b64(r)}}`;
    }
  },
  actor_ref: {
    title:"Get Derived Actor Value", color:"#1a4060", cat:"Get Data",
    desc:"Reads DERIVED roll-data values computed at roll time (@attr1 = attribute MODIFIER, @level, @prof) which do not exist as raw system.* fields. Use Get Field Value for raw stored fields; use this node for modifiers and other derived stats.",
    inputs:[], outputs:[{id:"v",label:"Value",type:"value.any"}],
    fields:[{key:"ref",label:"@name",type:"text",default:"attr1",placeholder:"attr1 / level / prof"}],
    compile:(n)=>`{@${n.data.ref??"attr1"}}`
  },
  slot_count: {
    title:"Slot Count", color:"#1a4060", cat:"Get Data",
    desc:"Count items in a slot across the source (this item / actor / wired Actor pin) and every nested item slot. Slot ID is plain text — type it or connect a string pin.",
    inputs:[
      {id:"slotId", label:"Slot ID", type:"value.string"},
      {id:"actor",  label:"Actor",   type:"value.actor"}
    ],
    outputs:[{id:"v",label:"Count",type:"value.number"}],
    fields:[{key:"slotId",label:"Slot ID",type:"text",default:"slot1",placeholder:"slot1"}],
    compile:(n,i)=>{
      const sid  = (i.slotId != null && i.slotId !== "") ? String(i.slotId) : (n.data.slotId ?? "slot1");
      const base = (i.actor  != null && i.actor  !== "") ? String(i.actor)  : `"self"`;
      return `{slotCountOn:${base}|${sid}}`;
    }
  },
  slot_field: {
    title:"Slot Item Field", color:"#1a4060", cat:"Get Data",
    desc:"Read a field from the first item found in any slot named Slot ID. Search walks the source actor (self / wired Actor pin) and every nested item slot at any depth until the field is found.",
    inputs:[
      {id:"slotId", label:"Slot ID", type:"value.string"},
      {id:"actor",  label:"Actor",   type:"value.actor"},
      {id:"path",   label:"Field",   type:"value.path"}
    ],
    outputs:[{id:"v",label:"Value",type:"value.any"}],
    fields:[
      {key:"slotId",label:"Slot ID",type:"text",default:"slot1",placeholder:"slot1"},
      {key:"path",  label:"Field",  type:"path",default:"system.hiddenFields.field"}
    ],
    compile:(n,i)=>{
      const sid  = (i.slotId != null && i.slotId !== "") ? String(i.slotId) : (n.data.slotId ?? "slot1");
      const base = (i.actor  != null && i.actor  !== "") ? String(i.actor)  : `"self"`;
      const path = (i.path   != null && i.path   !== "") ? String(i.path)   : (n.data.path   ?? "");
      return `{slotFind:${base}|${sid}|${path}}`;
    }
  },
  item_uuid: {
    title:"Item by UUID", color:"#1a3050", cat:"Get Data",
    desc:"Drag an item from the sidebar here to get its UUID, then read a field",
    inputs:[], outputs:[{id:"v",label:"Value",type:"value.any"}],
    fields:[
      {key:"uuid", label:"UUID",  type:"text",default:"",placeholder:"Item.xxxxx or drag item here"},
      {key:"path", label:"Field", type:"path",default:"system.hiddenFields.field"}
    ],
    compile:(n)=>{ const p=n.data.path??""; const u=n.data.uuid??""; return `{item:id:${u}${p?"."+p:""}}`; }
  },
  target_field: {
    title:"Target Field", color:"#1a4060", cat:"Get Data",
    hidden:true, replacement:"get_path",
    desc:"Read a field from the first targeted/selected token's actor",
    inputs:[], outputs:[{id:"v",label:"Value",type:"value.any"}],
    fields:[{key:"path",label:"Field",type:"path",default:"system.resources.hp.value"}],
    compile:(n)=>`{target.${n.data.path??""}}`
  },

  fa_icon: {
    title:"FA Icon", color:"#2a4060", cat:"Values",
    desc:"Font Awesome icon picker — single text output containing a ready-to-render `<i class=\"…\"></i>` HTML snippet. Drop it into Chat Output, a Richtext widget or a Text widget (sheet renders the icon for plain FA snippets) and it appears as an actual icon, not as the literal class text.",
    inputs:[
      {id:"icon", label:"Icon", type:"value.string"}
    ],
    outputs:[
      {id:"v", label:"Icon", type:"value.string"}
    ],
    fields:[
      {key:"icon",  label:"FA Icon", type:"text",   default:"fa-heart",
       placeholder:"fa-heart, fa-star, fa-skull…"},
      {key:"style", label:"Style",   type:"select", default:"fas",
        options:[
          {value:"fas", label:"Solid"},
          {value:"far", label:"Regular"},
          {value:"fab", label:"Brands"},
          {value:"fad", label:"Duotone"},
          {value:"fal", label:"Light"},
          {value:"fat", label:"Thin"}
        ]},
      {key:"color", label:"Color",   type:"text",   default:"#e04040",
       placeholder:"#e04040"},
      {key:"size",  label:"Size px", type:"number", default:16}
    ],
    compile:(n, i) => {
      const _unquote = (v) => {
        if (v == null) return null;
        const s = String(v).trim();
        if (s.length >= 2 && ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))) {
          return s.slice(1, -1);
        }
        return s;
      };
      const _quote = (s) => JSON.stringify(String(s ?? ""));

      const iconRaw = _unquote(i?.icon) ?? n.data.icon ?? "fa-heart";
      const style   = String(n.data.style ?? "fas").trim() || "fas";
      const colorRaw = String(n.data.color ?? "#e04040").trim() || "#e04040";
      const size     = Math.max(1, Number(n.data.size ?? 16) || 16);

      let cleaned = String(iconRaw).trim()
        .replace(/\bfa-(solid|regular|brands|duotone|light|thin|sharp)\b/gi, "")
        .replace(/\b(fas|far|fab|fad|fal|fat)\b/gi, "")
        .trim();
      if (!cleaned) cleaned = "fa-heart";
      if (!/^fa-/.test(cleaned)) cleaned = "fa-" + cleaned;

      const safeColor = /^(?:#[0-9a-f]{3,8}|rgb[a]?\([^)]+\)|[a-z]+)$/i.test(colorRaw) ? colorRaw : "#e04040";
      const faClass   = `${style} ${cleaned}`.trim();
      const html      = `<i class="${faClass}" style="color:${safeColor};font-size:${size}px"></i>`;
      return _quote(html);
    }
  },

  attr_mod: {
    title:"Attr Modifier", color:"#7a4a1a", cat:"Attribute",
    desc:"Calculates the modifier from an attribute score using the world setting `modifierFormula` (halved / direct / none). Default: floor((score − 10) / 2). Connect Attr Score → score pin.",
    inputs:[{id:"score",label:"Score",type:"value.number"}],
    outputs:[{id:"mod",label:"Mod",type:"value.number"}],
    fields:[],
    compile:(_,i)=>{
      const s = i.score ?? "0";
      const compile = (typeof CONFIG !== "undefined") && CONFIG?.SD?.compileModifierExpr;
      return compile ? compile(s) : `floor((${s}-10)/2)`;
    }
  },

  dice: {
    title:"Dice", color:"#7a4500", cat:"Dice & Rolls",
    desc:"Build a dice formula `<count><die>`. Die accepts any size — type \"d5\", \"d87\", \"5\", \"87\" or a {ref}. Optional Min / Max clamp the rolled result to a [min..max] range (leave blank to skip). Outputs: `Formula` (string for rolling), `Min` / `Max` (theoretical extremes — handy for HUD ranges or branch logic), `Avg` (expected value).",
    inputs:[
      {id:"count",label:"Count",type:"value.number"},
      {id:"die",  label:"Die",  type:"value.string"},
      {id:"minVal",label:"Min", type:"value.number"},
      {id:"maxVal",label:"Max", type:"value.number"}
    ],
    outputs:[
      {id:"v",   label:"Formula", type:"value.string"},
      {id:"min", label:"Min",     type:"value.number"},
      {id:"max", label:"Max",     type:"value.number"},
      {id:"avg", label:"Avg",     type:"value.number"}
    ],
    fields:[
      {key:"count", label:"#",   type:"number", default:1},
      {key:"die",   label:"Die", type:"text",   default:"d6", placeholder:"d6 / d20 / d87 / 5"},
      {key:"minVal",label:"Min", type:"text",   default:"",   placeholder:"e.g. 1 (blank = no floor)"},
      {key:"maxVal",label:"Max", type:"text",   default:"",   placeholder:"e.g. 20 (blank = no ceil)"}
    ],
    dynamicPins:[
      { base:"add", label:"Add", max:10, type:"value.number" },
      { base:"sub", label:"Sub", max:10, type:"value.number" }
    ],
    compilePin:(n, i, fromPin)=>{
      const c = i.count ?? n.data.count ?? 1;
      let dieSrc = (i.die !== undefined && i.die !== null && i.die !== "")
        ? String(i.die).trim()
        : String(n.data.die ?? "d6").trim();
      if (dieSrc.length >= 2 && (
            (dieSrc.startsWith('"') && dieSrc.endsWith('"')) ||
            (dieSrc.startsWith("'") && dieSrc.endsWith("'"))
          )) {
        dieSrc = dieSrc.slice(1, -1).trim();
      }
      if (!dieSrc) dieSrc = "d6";
      const dieFinal = /^d/i.test(dieSrc) ? dieSrc : `d${dieSrc}`;
      let f = `${c}${dieFinal}`;
      for (let j = 0; j < 10; j++) {
        const av = i[`add${j}`]; if (av != null && av !== "") f = `(${f}+(${av}))`;
        const sv = i[`sub${j}`]; if (sv != null && sv !== "") f = `(${f}-(${sv}))`;
      }
      const _bound = (pinVal, fieldVal) => {
        const pin = (pinVal !== undefined && pinVal !== null && String(pinVal).trim() !== "")
          ? String(pinVal).trim() : null;
        if (pin) return pin;
        const fld = String(fieldVal ?? "").trim();
        return fld === "" ? null : fld;
      };
      const lo = _bound(i.minVal, n.data.minVal);
      const hi = _bound(i.maxVal, n.data.maxVal);
      if (hi !== null) f = `min(${hi},${f})`;
      if (lo !== null) f = `max(${lo},${f})`;
      if (fromPin === "min" || fromPin === "max" || fromPin === "avg") {
        const b = formulaBounds(f);
        return String(b[fromPin] ?? 0);
      }
      return f;
    }
  },

  formula_range: {
    title:"Formula Range", color:"#7a4500", cat:"Dice & Rolls",
    desc:"Statically inspect a dice formula and emit its theoretical Min, Max and Average. `2d6+3` → min=5, max=15, avg=10. Works with any formula string — useful for HUD ranges, IF branches, or feeding clamps.",
    inputs:[{id:"formula", label:"Formula", type:"value.string"}],
    outputs:[
      {id:"min", label:"Min", type:"value.number"},
      {id:"max", label:"Max", type:"value.number"},
      {id:"avg", label:"Avg", type:"value.number"}
    ],
    fields:[
      {key:"formula", label:"Formula", type:"text", default:"1d6"}
    ],
    compilePin:(n, i, fromPin) => {
      const f = (i.formula != null && i.formula !== "") ? String(i.formula) : (n.data?.formula ?? "1d6");
      const b = formulaBounds(f);
      const which = (fromPin === "max" || fromPin === "avg") ? fromPin : "min";
      return String(b[which] ?? 0);
    }
  },

  formula_clamp: {
    title:"Formula Clamp", color:"#7a4500", cat:"Dice & Rolls",
    desc:"Wrap a formula with `max(MIN, min(MAX, F))`. Either bound may be left empty (open on that side). Stack multiple Clamp nodes to apply tighter ranges in sequence.",
    inputs:[
      {id:"formula", label:"Formula", type:"value.string"},
      {id:"minVal",  label:"Min",     type:"value.number"},
      {id:"maxVal",  label:"Max",     type:"value.number"}
    ],
    outputs:[{id:"v", label:"Formula", type:"value.string"}],
    fields:[
      {key:"minVal", label:"Min", type:"text", default:"", placeholder:"blank = no floor"},
      {key:"maxVal", label:"Max", type:"text", default:"", placeholder:"blank = no ceil"}
    ],
    compile:(n, i) => {
      const f  = (i.formula != null && i.formula !== "") ? String(i.formula) : "0";
      const _b = (pin, fld) => {
        const p = (pin !== undefined && pin !== null && String(pin).trim() !== "") ? String(pin).trim() : null;
        if (p) return p;
        const v = String(fld ?? "").trim();
        return v === "" ? null : v;
      };
      const lo = _b(i.minVal, n.data?.minVal);
      const hi = _b(i.maxVal, n.data?.maxVal);
      return clampFormula(f, lo, hi);
    }
  },

  formula_mul: {
    title:"Formula × N", color:"#7a4500", cat:"Dice & Rolls",
    desc:"Wrap a formula in `(N)*(F)`. Common case: crit doubling (`×2`). Set N=2 + leave Formula pin connected = doubled total.",
    inputs:[
      {id:"formula", label:"Formula", type:"value.string"},
      {id:"n",       label:"N",       type:"value.number"}
    ],
    outputs:[{id:"v", label:"Formula", type:"value.string"}],
    fields:[
      {key:"n", label:"N", type:"number", default:2}
    ],
    compile:(n, i) => {
      const f   = (i.formula != null && i.formula !== "") ? String(i.formula) : "0";
      const fac = (i.n != null && i.n !== "") ? i.n : (n.data?.n ?? 2);
      return multiplyFormula(f, fac);
    }
  },

  to_formula: {
    title:"To Formula", color:"#7a4500", cat:"Dice & Rolls",
    desc:"Strip surrounding quotes from a string and mark it to be inlined into a dice formula raw, without JSON quoting. Use this when a field contains a roll expression (e.g. `1d6`, `2d20+@mod`) that should be rolled as dice instead of being treated as a literal text term. Plain text values still work — they are simply emitted unquoted into the formula.",
    inputs:[{id:"in", label:"In", type:"value.string"}],
    outputs:[{id:"v", label:"Formula", type:"value.string"}],
    fields:[{key:"value", label:"", type:"text", default:"", placeholder:"e.g. 1d6, 2d20+@mod"}],
    compile:(n, i) => {
      let s = (i.in != null && i.in !== "") ? String(i.in) : String(n.data?.value ?? "");
      if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
        try {
          const t = JSON.parse(s);
          if (typeof t === "string") s = t;
        } catch {}
      } else if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) {
        s = s.slice(1, -1).replace(/\\(.)/g, "$1");
      }
      s = s.replace(/\{([^{}]+)\}/g, (m, inner) => {
        const t = inner.trim();
        if (t.startsWith("raw:")) return m;
        return `{raw:${t}}`;
      });
      return s;
    }
  },

  formula_add: {
    title:"Formula + Mod", color:"#7a4500", cat:"Dice & Rolls",
    desc:"Append a +/- modifier to a formula. Mod accepts numbers (`5`, `-3`) or expressions (`@mod`, `1d4`). Stack multiple of these to chain bonuses.",
    inputs:[
      {id:"formula", label:"Formula", type:"value.string"},
      {id:"mod",     label:"Mod",     type:"value.any"}
    ],
    outputs:[{id:"v", label:"Formula", type:"value.string"}],
    fields:[
      {key:"mod", label:"Mod", type:"text", default:"", placeholder:"e.g. @mod, 2, -1, 1d4"}
    ],
    compile:(n, i) => {
      const f = (i.formula != null && i.formula !== "") ? String(i.formula) : "0";
      const m = (i.mod != null && i.mod !== "") ? i.mod : (n.data?.mod ?? "");
      return addMod(f, m);
    }
  },

  roll_stat: {
    title:"Roll Stat", color:"#7a4500", cat:"Dice & Rolls",
    desc:"Produce a percentile (0..1) showing where the roll landed inside its theoretical range, plus echo Min/Max/Avg of the formula. Useful for heatmap UI or `If pct >= 0.9 → great hit`.",
    inputs:[
      {id:"formula", label:"Formula", type:"value.string"},
      {id:"roll",    label:"Roll",    type:"value.number"}
    ],
    outputs:[
      {id:"min", label:"Min", type:"value.number"},
      {id:"max", label:"Max", type:"value.number"},
      {id:"avg", label:"Avg", type:"value.number"},
      {id:"pct", label:"Pct", type:"value.number"}
    ],
    fields:[
      {key:"formula", label:"Formula", type:"text", default:"1d6"}
    ],
    compilePin:(n, i, fromPin) => {
      const f = (i.formula != null && i.formula !== "") ? String(i.formula) : (n.data?.formula ?? "1d6");
      const b = formulaBounds(f);
      if (fromPin === "min") return String(b.min);
      if (fromPin === "max") return String(b.max);
      if (fromPin === "avg") return String(b.avg);
      const r = (i.roll != null && i.roll !== "") ? i.roll : "0";
      const span = (b.max - b.min) || 1;
      return `(((${r})-(${b.min}))/(${span}))`;
    }
  },

  add:  {title:"Add",   color:"#1a5c2a",cat:"Math",desc:"Adds A and B. With Separator set, concatenates them as text.",inputs:[{id:"a",label:"A",type:"value.any"},{id:"b",label:"B",type:"value.any"}],outputs:[{id:"v",label:"",type:"value.any"}],fields:[{key:"sep",label:"Sep",type:"text",default:""},_ROUND_FIELD],compile:(n,i)=>{ const sep=n.data.sep??""; if (sep) return `(${i.a??""} + "${sep.replace(/"/g,'\\"')}" + ${i.b??""})`; return _round(`(${i.a??"0"}+${i.b??"0"})`, n.data); }},
  sub:  {title:"Subtract",   color:"#1a5c2a",cat:"Math",desc:"Subtracts B from A.",inputs:[{id:"a",label:"A",type:"value.number"},{id:"b",label:"B",type:"value.number"}],outputs:[{id:"v",label:"",type:"value.number"}],fields:[_ROUND_FIELD],compile:(n,i)=>_round(`(${i.a??"0"}-${i.b??"0"})`, n.data)},
  mul:  {title:"Multiply",   color:"#1a5c2a",cat:"Math",desc:"Multiplies A by B.",inputs:[{id:"a",label:"A",type:"value.number"},{id:"b",label:"B",type:"value.number"}],outputs:[{id:"v",label:"",type:"value.number"}],fields:[_ROUND_FIELD],compile:(n,i)=>_round(`(${i.a??"0"}*${i.b??"0"})`, n.data)},
  div:  {title:"Divide",   color:"#1a5c2a",cat:"Math",desc:"Divides A by B. Keep B non-zero.",inputs:[{id:"a",label:"A",type:"value.number"},{id:"b",label:"B",type:"value.number"}],outputs:[{id:"v",label:"",type:"value.number"}],fields:[_ROUND_FIELD],compile:(n,i)=>_round(`(${i.a??"0"}/${i.b??"1"})`, n.data)},
  floor:{title:"Floor", color:"#1a5c2a",cat:"Math",desc:"Rounds Value down to the nearest integer.",inputs:[{id:"a",label:"A",type:"value.number"}],outputs:[{id:"v",label:"",type:"value.number"}],fields:[],compile:(_,i)=>`floor(${i.a??"0"})`},
  ceil: {title:"Ceil",  color:"#1a5c2a",cat:"Math",desc:"Rounds Value up to the nearest integer.",inputs:[{id:"a",label:"A",type:"value.number"}],outputs:[{id:"v",label:"",type:"value.number"}],fields:[],compile:(_,i)=>`ceil(${i.a??"0"})`},
  round:{title:"Round", color:"#1a5c2a",cat:"Math",desc:"Rounds Value to the nearest integer.",inputs:[{id:"a",label:"A",type:"value.number"}],outputs:[{id:"v",label:"",type:"value.number"}],fields:[],compile:(_,i)=>`round(${i.a??"0"})`},
  max2: {title:"Max",   color:"#1a5c2a",cat:"Math",desc:"Returns the larger of A and B.",inputs:[{id:"a",label:"A",type:"value.number"},{id:"b",label:"B",type:"value.number"}],outputs:[{id:"v",label:"",type:"value.number"}],fields:[_ROUND_FIELD],compile:(n,i)=>_round(`max(${i.a??"0"},${i.b??"0"})`, n.data)},
  min2: {title:"Min",   color:"#1a5c2a",cat:"Math",desc:"Returns the smaller of A and B.",inputs:[{id:"a",label:"A",type:"value.number"},{id:"b",label:"B",type:"value.number"}],outputs:[{id:"v",label:"",type:"value.number"}],fields:[_ROUND_FIELD],compile:(n,i)=>_round(`min(${i.a??"0"},${i.b??"0"})`, n.data)},
  abs:  {title:"Absolute",   color:"#1a5c2a",cat:"Math",desc:"Returns the non-negative magnitude of Value.",inputs:[{id:"a",label:"A",type:"value.number"}],outputs:[{id:"v",label:"",type:"value.number"}],fields:[_ROUND_FIELD],compile:(n,i)=>_round(`abs(${i.a??"0"})`, n.data)},
  clamp:{title:"Clamp", color:"#1a5c2a",cat:"Math",desc:"Limits Value to the inclusive Min..Max range.",
         inputs:[{id:"v",label:"Val",type:"value.number"},{id:"lo",label:"Min",type:"value.number"},{id:"hi",label:"Max",type:"value.number"}],
         outputs:[{id:"v",label:"",type:"value.number"}],fields:[_ROUND_FIELD],
         compile:(n,i)=>_round(`max(${i.lo??"0"},min(${i.hi??"0"},${i.v??"0"}))`, n.data)},

  lerp: {title:"Lerp", color:"#1a5c2a", cat:"Math",
    desc:"Linear interpolation: A + Alpha × (B − A). Alpha 0 returns A; Alpha 1 returns B.",
    inputs:[{id:"a",label:"A",type:"value.number"},{id:"b",label:"B",type:"value.number"},{id:"alpha",label:"Alpha",type:"value.number"}],
    outputs:[{id:"v",label:"Result",type:"value.number"}], fields:[_ROUND_FIELD],
    compile:(n,i)=>_round(`((${i.a??"0"})+((${i.b??"0"})-(${i.a??"0"}))*(${i.alpha??"0"}))`,n.data)},
  map_range: {title:"Map Range", color:"#1a5c2a", cat:"Math",
    desc:"Maps Value from input range In Min..In Max to output range Out Min..Out Max without clamping.",
    inputs:[{id:"v",label:"Value",type:"value.number"},{id:"inMin",label:"In Min",type:"value.number"},{id:"inMax",label:"In Max",type:"value.number"},{id:"outMin",label:"Out Min",type:"value.number"},{id:"outMax",label:"Out Max",type:"value.number"}],
    outputs:[{id:"v",label:"Result",type:"value.number"}], fields:[_ROUND_FIELD],
    compile:(n,i)=>{const den=`((${i.inMax??"1"})-(${i.inMin??"0"}))`; return _round(`((${i.outMin??"0"})+(((${i.v??"0"})-(${i.inMin??"0"}))/(${den}))*(((${i.outMax??"1"})-(${i.outMin??"0"}))))`,n.data)}},
  map_range_clamped: {title:"Map Range Clamped", color:"#1a5c2a", cat:"Math",
    desc:"Maps Value between ranges and clamps it to the output range. Handles reversed output ranges.",
    inputs:[{id:"v",label:"Value",type:"value.number"},{id:"inMin",label:"In Min",type:"value.number"},{id:"inMax",label:"In Max",type:"value.number"},{id:"outMin",label:"Out Min",type:"value.number"},{id:"outMax",label:"Out Max",type:"value.number"}],
    outputs:[{id:"v",label:"Result",type:"value.number"}], fields:[_ROUND_FIELD],
    compile:(n,i)=>{const raw=`((${i.outMin??"0"})+(((${i.v??"0"})-(${i.inMin??"0"}))/(((${i.inMax??"1"})-(${i.inMin??"0"}))))*(((${i.outMax??"1"})-(${i.outMin??"0"}))))`; return _round(`max(min(${i.outMin??"0"},${i.outMax??"1"}),min(max(${i.outMin??"0"},${i.outMax??"1"}),${raw}))`,n.data)}},
  truncate: {title:"Truncate", color:"#1a5c2a", cat:"Math",
    desc:"Removes the fractional part and rounds toward zero.", inputs:[{id:"a",label:"Value",type:"value.number"}], outputs:[{id:"v",label:"Result",type:"value.number"}], fields:[],
    compile:(_,i)=>`((${i.a??"0"})<0?ceil(${i.a??"0"}):floor(${i.a??"0"}))`},
  fraction: {title:"Fraction", color:"#1a5c2a", cat:"Math",
    desc:"Returns the fractional part of Value with the same sign as the input.", inputs:[{id:"a",label:"Value",type:"value.number"}], outputs:[{id:"v",label:"Result",type:"value.number"}], fields:[],
    compile:(_,i)=>`((${i.a??"0"})-((${i.a??"0"})<0?ceil(${i.a??"0"}):floor(${i.a??"0"})))`},
  xor: {title:"XOR", color:"#6a1a1a", cat:"Logic",
    desc:"True when exactly one input is true.", inputs:[{id:"a",label:"A",type:"value.bool"},{id:"b",label:"B",type:"value.bool"}], outputs:[{id:"v",label:"Bool",type:"value.bool"}], fields:[],
    compile:(_,i)=>`((!!(${i.a??"0"}))!=(!!(${i.b??"0"})))`},
  nearly_equal: {title:"Nearly Equal", color:"#6a1a6a", cat:"Logic",
    desc:"True when the absolute difference between A and B is no greater than Tolerance.", inputs:[{id:"a",label:"A",type:"value.number"},{id:"b",label:"B",type:"value.number"},{id:"tolerance",label:"Tolerance",type:"value.number"}], outputs:[{id:"v",label:"Bool",type:"value.bool"}], fields:[],
    compile:(_,i)=>`(abs((${i.a??"0"})-(${i.b??"0"}))<=abs(${i.tolerance??"0.0001"}))`},
  in_range: {title:"In Range", color:"#6a1a6a", cat:"Logic",
    desc:"True when Value is between Min and Max, inclusive.", inputs:[{id:"v",label:"Value",type:"value.number"},{id:"min",label:"Min",type:"value.number"},{id:"max",label:"Max",type:"value.number"}], outputs:[{id:"v",label:"Bool",type:"value.bool"}], fields:[],
    compile:(_,i)=>`((${i.v??"0"})>=(${i.min??"0"})&&(${i.v??"0"})<=(${i.max??"0"}))`},

  eq: {title:"Equal",color:"#6a1a6a",cat:"Logic",desc:"Equality check. Works for both numbers (5 == 5) and text (\"hello\" == \"hello\", Cyrillic / Latin / Unicode).",inputs:[{id:"a",label:"A",type:"value.any"},{id:"b",label:"B",type:"value.any"}],outputs:[{id:"v",label:"Bool",type:"value.bool"}],fields:[],compile:(_,i)=>{
    const a = (i.a !== undefined && i.a !== null && i.a !== "") ? i.a : "0";
    const b = (i.b !== undefined && i.b !== null && i.b !== "") ? i.b : "0";
    const _b64 = (s) => {
      try { return btoa(unescape(encodeURIComponent(String(s)))); }
      catch { return ""; }
    };
    return `{__sdEq:${_b64(a)}|${_b64(b)}}`;
  }},
  neq:{title:"Not Equal", color:"#6a1a6a",cat:"Logic",desc:"Inequality check. Works for both numbers and text (Cyrillic / Latin / Unicode).",inputs:[{id:"a",label:"A",type:"value.any"},{id:"b",label:"B",type:"value.any"}],outputs:[{id:"v",label:"Bool",type:"value.bool"}],fields:[],compile:(_,i)=>{
    const a = (i.a !== undefined && i.a !== null && i.a !== "") ? i.a : "0";
    const b = (i.b !== undefined && i.b !== null && i.b !== "") ? i.b : "0";
    const _b64 = (s) => {
      try { return btoa(unescape(encodeURIComponent(String(s)))); }
      catch { return ""; }
    };
    return `{__sdNeq:${_b64(a)}|${_b64(b)}}`;
  }},
  gt: {title:"Greater Than", color:"#6a1a6a",cat:"Logic",desc:"True when A is greater than B.",inputs:[{id:"a",label:"A",type:"value.any"},{id:"b",label:"B",type:"value.any"}],outputs:[{id:"v",label:"Bool",type:"value.bool"}],fields:[],compile:(_,i)=>`(${i.a??"0"}>${i.b??"0"})`},
  lt: {title:"Less Than", color:"#6a1a6a",cat:"Logic",desc:"True when A is less than B.",inputs:[{id:"a",label:"A",type:"value.any"},{id:"b",label:"B",type:"value.any"}],outputs:[{id:"v",label:"Bool",type:"value.bool"}],fields:[],compile:(_,i)=>`(${i.a??"0"}<${i.b??"0"})`},
  gte:{title:"Greater or Equal",color:"#6a1a6a",cat:"Logic",desc:"True when A is greater than or equal to B.",inputs:[{id:"a",label:"A",type:"value.any"},{id:"b",label:"B",type:"value.any"}],outputs:[{id:"v",label:"Bool",type:"value.bool"}],fields:[],compile:(_,i)=>`(${i.a??"0"}>=${i.b??"0"})`},
  lte:{title:"Less or Equal",color:"#6a1a6a",cat:"Logic",desc:"True when A is less than or equal to B.",inputs:[{id:"a",label:"A",type:"value.any"},{id:"b",label:"B",type:"value.any"}],outputs:[{id:"v",label:"Bool",type:"value.bool"}],fields:[],compile:(_,i)=>`(${i.a??"0"}<=${i.b??"0"})`},

  and:{title:"AND",color:"#6a1a1a",cat:"Logic",desc:"True only when both A and B are true.",inputs:[{id:"a",label:"A",type:"value.bool"},{id:"b",label:"B",type:"value.bool"}],outputs:[{id:"v",label:"Bool",type:"value.bool"}],fields:[],compile:(_,i)=>`(${i.a??"0"}&&${i.b??"0"})`},
  or: {title:"OR", color:"#6a1a1a",cat:"Logic",desc:"True when A, B, or both are true.",inputs:[{id:"a",label:"A",type:"value.bool"},{id:"b",label:"B",type:"value.bool"}],outputs:[{id:"v",label:"Bool",type:"value.bool"}],fields:[],compile:(_,i)=>`(${i.a??"0"}||${i.b??"0"})`},
  not:{title:"NOT",color:"#6a1a1a",cat:"Logic",desc:"Inverts a boolean value.",inputs:[{id:"a",label:"A",type:"value.bool"}],outputs:[{id:"v",label:"Bool",type:"value.bool"}],fields:[],compile:(_,i)=>`(!${i.a??"0"})`},

  match_num: {
    title:"Select by Number", color:"#6a1a1a", cat:"Logic",
    desc:"Compare Value against each Case (top→bottom) by numeric equality and emit the matching Result. Cases and Results are independent input pins — wire any value (field, formula, literal) to each one. If no Case matches, the Default value is emitted (empty if not connected). Result pins accept any type (number / text / array / formula).",
    wideNode:true,
    inputs:[
      {id:"value",   label:"Value",   type:"value.number"},
      {id:"default", label:"Default", type:"value.any"}
    ],
    outputs:[{id:"out", label:"Out", type:"value.any"}],
    fields:[],
    dynamicPins:[
      { base:"c", label:"Case",   max:32, type:"value.number" },
      { base:"r", label:"Result", max:32, type:"value.any" }
    ],
    dynamicPinsPaired:true,
    compile:(n,i)=>{
      const _b64 = (s) => {
        try { return btoa(unescape(encodeURIComponent(String(s)))); }
        catch { return ""; }
      };
      const value = (i.value !== undefined && i.value !== null && i.value !== "") ? i.value : "0";
      const def   = (i.default !== undefined && i.default !== null && i.default !== "") ? i.default : "0";
      const pairs = [];
      for (let k = 0; k < 32; k++) {
        const c = i[`c${k}`];
        const r = i[`r${k}`];
        if ((c === undefined || c === null || c === "") &&
            (r === undefined || r === null || r === "")) continue;
        pairs.push(`${_b64(c ?? "")}|${_b64(r ?? "")}`);
      }
      return `{__sdMatch:num|${_b64(value)}|${_b64(def)}${pairs.length ? "|" + pairs.join("|") : ""}}`;
    }
  },

  match_str: {
    title:"Select by Text", color:"#6a1a1a", cat:"Logic",
    desc:"Compare Value against each Case (top→bottom) by exact string equality and emit the matching Result. Cases and Results are independent input pins — wire any value (field, formula, literal) to each one. If no Case matches, the Default value is emitted (empty if not connected). Result pins accept any type (number / text / array / formula).",
    wideNode:true,
    inputs:[
      {id:"value",   label:"Value",   type:"value.string"},
      {id:"default", label:"Default", type:"value.any"}
    ],
    outputs:[{id:"out", label:"Out", type:"value.any"}],
    fields:[],
    dynamicPins:[
      { base:"c", label:"Case",   max:32, type:"value.string" },
      { base:"r", label:"Result", max:32, type:"value.any" }
    ],
    dynamicPinsPaired:true,
    compile:(n,i)=>{
      const _b64 = (s) => {
        try { return btoa(unescape(encodeURIComponent(String(s)))); }
        catch { return ""; }
      };
      const value = (i.value !== undefined && i.value !== null && i.value !== "") ? i.value : "";
      const def   = (i.default !== undefined && i.default !== null && i.default !== "") ? i.default : "";
      const pairs = [];
      for (let k = 0; k < 32; k++) {
        const c = i[`c${k}`];
        const r = i[`r${k}`];
        if ((c === undefined || c === null || c === "") &&
            (r === undefined || r === null || r === "")) continue;
        pairs.push(`${_b64(c ?? "")}|${_b64(r ?? "")}`);
      }
      return `{__sdMatch:str|${_b64(value)}|${_b64(def)}${pairs.length ? "|" + pairs.join("|") : ""}}`;
    }
  },

  match_arr: {
    title:"Select by Array", color:"#6a1a1a", cat:"Logic",
    desc:"Compare Value against each Case (top→bottom) by exact CSV-string equality (\"a,b,c\") and emit the matching Result. Cases and Results are independent input pins — wire any value (field, formula, literal) to each one. If no Case matches, the Default value is emitted (empty if not connected). Result pins accept any type (number / text / array / formula).",
    wideNode:true,
    inputs:[
      {id:"value",   label:"Value",   type:"value.array"},
      {id:"default", label:"Default", type:"value.any"}
    ],
    outputs:[{id:"out", label:"Out", type:"value.any"}],
    fields:[],
    dynamicPins:[
      { base:"c", label:"Case",   max:32, type:"value.array" },
      { base:"r", label:"Result", max:32, type:"value.any" }
    ],
    dynamicPinsPaired:true,
    compile:(n,i)=>{
      const _b64 = (s) => {
        try { return btoa(unescape(encodeURIComponent(String(s)))); }
        catch { return ""; }
      };
      const value = (i.value !== undefined && i.value !== null && i.value !== "") ? i.value : "";
      const def   = (i.default !== undefined && i.default !== null && i.default !== "") ? i.default : "";
      const pairs = [];
      for (let k = 0; k < 32; k++) {
        const c = i[`c${k}`];
        const r = i[`r${k}`];
        if ((c === undefined || c === null || c === "") &&
            (r === undefined || r === null || r === "")) continue;
        pairs.push(`${_b64(c ?? "")}|${_b64(r ?? "")}`);
      }
      return `{__sdMatch:arr|${_b64(value)}|${_b64(def)}${pairs.length ? "|" + pairs.join("|") : ""}}`;
    }
  },

  act_roll_value: {
    hidden:true, replacement:"act_roll_v2 + act_analyze_roll + act_present_roll",
    title:"Roll -> Value", color:"#8a4400", cat:"Dice & Rolls",
    desc:"Rolls dice and forwards the numeric result as a value output. Min / Max / Avg are theoretical formula bounds. Min Value and Max Value contain the selected lowest/highest active die results from the actual roll; configure their independent counts, and use the Sum outputs when a numeric total of the selected dice is needed. Dice Array contains every active die result.",
    inputs:[
      {id:"exec",             label:"",              type:"exec"},
      {id:"formula",          label:"Formula",        type:"value.string"},
      {id:"advFormula",       label:"Adv Formula",    type:"value.string"},
      {id:"disFormula",       label:"Dis Formula",    type:"value.string"},
      {id:"rerollEnabled",    label:"Reroll button",  type:"value.bool"},
      {id:"rerollPath",       label:"Reroll Path",    type:"value.path"},
      {id:"rerollCost",       label:"Reroll Cost",    type:"value.number"},
      {id:"minValueCount",    label:"Lowest Count",   type:"value.number"},
      {id:"maxValueCount",    label:"Highest Count",  type:"value.number"}
    ],
    outputs:[
      {id:"exec",          label:"",              type:"exec"},
      {id:"result",        label:"Result",        type:"value.number"},
      {id:"formula",       label:"Formula",       type:"value.string"},
      {id:"min",           label:"Min",           type:"value.number"},
      {id:"max",           label:"Max",           type:"value.number"},
      {id:"avg",           label:"Avg",           type:"value.number"},
      {id:"diceArray",     label:"Dice Array",    type:"value.array"},
      {id:"minValue",      label:"Min Value",     type:"value.any"},
      {id:"maxValue",      label:"Max Value",     type:"value.any"},
      {id:"minValueTotal", label:"Min Value Sum", type:"value.number"},
      {id:"maxValueTotal", label:"Max Value Sum", type:"value.number"}
    ],
    fields:[
      {key:"formula",        label:"Formula",              type:"text",   default:"1d6"},
      {key:"flavor",         label:"Label",                type:"text",   default:"Roll"},
      {key:"toChat",         label:"To chat",              type:"select", default:"yes", options:["yes","no"]},
      {key:"rollDialogue",   label:"Roll dialog",          type:"select", default:"no",  options:["no","yes"]},
      {key:"advFormula",     label:"Adv formula (pin>field)", type:"text", default:"",   placeholder:"e.g. 2d20kh1 + @mod"},
      {key:"disFormula",     label:"Dis formula (pin>field)", type:"text", default:"",   placeholder:"e.g. 2d20kl1 + @mod"},
      {key:"rerollEnabled",  label:"Reroll button",       type:"select", default:"no", options:["no","yes"]},
      {key:"rerollPath",     label:"Reroll resource path", type:"path",   default:"",   placeholder:"e.g. system.resources.luck.value"},
      {key:"rerollCost",     label:"Reroll cost",          type:"number", default:1},
      {key:"minValueCount",  label:"Lowest dice count",    type:"number", default:1},
      {key:"maxValueCount",  label:"Highest dice count",   type:"number", default:1}
    ],
    isAction:true,
    toAction:(n,inp)=>{
      const formula = inp.formula ?? n.data.formula ?? "1d6";
      const advFormula = (inp.advFormula != null && inp.advFormula !== "") ? inp.advFormula : (n.data.advFormula ?? "");
      const disFormula = (inp.disFormula != null && inp.disFormula !== "") ? inp.disFormula : (n.data.disFormula ?? "");
      const _rrEnabledRaw = (inp.rerollEnabled != null && inp.rerollEnabled !== "") ? inp.rerollEnabled : n.data.rerollEnabled;
      const rerollEnabled = coerceBool(_rrEnabledRaw) ? "yes" : "no";
      return {
        type:"rollValue", formula,
        flavor:       n.data.flavor ?? "Roll",
        toChat:       n.data.toChat !== "no",
        rollDialogue: n.data.rollDialogue === "yes",
        advFormula,
        disFormula,
        rerollEnabled,
        rerollPath: (inp.rerollPath != null && inp.rerollPath !== "") ? String(inp.rerollPath) : (n.data.rerollPath ?? ""),
        rerollCost: Number((inp.rerollCost != null && inp.rerollCost !== "") ? inp.rerollCost : (n.data.rerollCost ?? 1)) || 0,
        minValueCount: (inp.minValueCount != null && inp.minValueCount !== "") ? inp.minValueCount : (n.data.minValueCount ?? 1),
        maxValueCount: (inp.maxValueCount != null && inp.maxValueCount !== "") ? inp.maxValueCount : (n.data.maxValueCount ?? 1)
      };
    }
  },

  act_damage: {
    hidden:true, replacement:"act_damage_simple",
    title:"Damage", color:"#8a1a1a", cat:"Combat", wideNode:true,
    desc:"Apply damage to target HP. Reads target's system.resistances[damageType] and scales the amount (immune=×0, resist=×0.5, vulnerable=×2, numeric factor used as-is). halfOnSave × savePassed halves damage when the preceding save passed. Three amount slots — Amount (base), Crit Amount (used when Is Crit? truthy), Fumble Amount (used when Is Fumble? truthy). Wire e.g. Roll Value's Is Crit / Crit Formula straight into Is Crit? / Crit Amount. Connect Targets pin from AoE Save / AoE Targets to apply to specific tokens.",
    inputs:[
      {id:"exec",label:"",type:"exec"},
      {id:"amount",      label:"Amount",        type:"value.number"},
      {id:"isCrit",      label:"Is Crit?",      type:"value.bool"},
      {id:"critAmount",  label:"Crit Amount",   type:"value.any"},
      {id:"isFumble",    label:"Is Fumble?",    type:"value.bool"},
      {id:"fumbleAmount",label:"Fumble Amount", type:"value.any"},
      {id:"damageType",  label:"Type",          type:"value.string"},
      {id:"savePassed",  label:"Save passed?",  type:"value.bool"},
      {id:"target",      label:"Target",        type:"value.actor"},
      {id:"targets",     label:"Targets",       type:"value.array"}
    ],
    outputs:[{id:"exec",label:"",type:"exec"}],
    fields:[
      {key:"label",        label:"Label",       type:"text",   default:"Damage"},
      {key:"target",       label:"To",          type:"select", default:"token_target", options:["actor","token_target","selected_token","all_targets"]},
      {key:"hpPath",       label:"HP path",     type:"path",   default:"system.resources.hp.value"},
      {key:"damageType",   label:"Damage type", type:"text",   default:"", placeholder:"fire / cold / physical …"},
      {key:"critAmount",   label:"Crit Amount (used when Is Crit? is true)",     type:"text", default:"", placeholder:"e.g. 2*(1d6+@mod) or 1d6+1d6+@mod"},
      {key:"fumbleAmount", label:"Fumble Amount (used when Is Fumble? is true)", type:"text", default:"", placeholder:"e.g. 1 or 1d4"},
      {key:"halfOnSave",   label:"Half on save", type:"select", default:"no", options:["no","yes"]},
      {key:"postToChat",   label:"Chat card",   type:"select", default:"yes", options:["yes","no"]},
      {key:"autoApply",    label:"Auto-apply",  type:"select", default:"no",  options:["no","yes"]},
      {key:"showApply",    label:"Apply btn",   type:"select", default:"yes", options:["yes","no"]}
    ],
    isAction:true,
    toAction:(n,inp)=>{
      const targetMode = (inp.target!=null && inp.target!=="" && inp.target!=="0") ? inp.target : (n.data.target ?? "token_target");
      const amt   = inp.amount ?? 0;
      const dmgType = inp.damageType ?? n.data.damageType ?? "";
      const halfOnSave = n.data.halfOnSave === "yes";
      const savePassed = inp.savePassed ?? null;
      const silent    = n.data.postToChat === "no";
      const _wired = (v) => v !== undefined && v !== "" && v !== null;
      const isCrit   = coerceBool(inp.isCrit)   ? 1 : 0;
      const isFumble = coerceBool(inp.isFumble) ? 1 : 0;
      const critAmount = _wired(inp.critAmount)
        ? String(inp.critAmount)
        : String(n.data.critAmount ?? "");
      const fumbleAmount = _wired(inp.fumbleAmount)
        ? String(inp.fumbleAmount)
        : String(n.data.fumbleAmount ?? "");
      return {type:"chatDamage", amount:String(amt), label:n.data.label??"Damage",
        target:targetMode, hpPath:n.data.hpPath??"system.resources.hp.value",
        damageType: dmgType, halfOnSave, savePassed,
        isCrit, critAmount,
        isFumble, fumbleAmount,
        targets: inp.targets ?? null,
        silent,
        showApply: !silent && n.data.showApply !== "no",
        autoApply: silent || n.data.autoApply === "yes"};
    }
  },

  act_heal: {
    hidden:true, replacement:"act_heal_simple",
    title:"Heal", color:"#1a7a2a", cat:"Combat", wideNode:true,
    desc:"Apply healing to target HP. postToChat:yes → chat card with Apply button. autoApply:yes → post to chat AND immediately heal (no click). postToChat:no → silent direct HP write. Three amount slots — Amount (base), Crit Amount (used when Is Crit? truthy), Fumble Amount (used when Is Fumble? truthy). Connect Targets pin from AoE Save to apply to specific tokens.",
    inputs:[
      {id:"exec",label:"",type:"exec"},
      {id:"amount",      label:"Amount",        type:"value.number"},
      {id:"isCrit",      label:"Is Crit?",      type:"value.bool"},
      {id:"critAmount",  label:"Crit Amount",   type:"value.any"},
      {id:"isFumble",    label:"Is Fumble?",    type:"value.bool"},
      {id:"fumbleAmount",label:"Fumble Amount", type:"value.any"},
      {id:"target",      label:"Target",        type:"value.actor"},
      {id:"targets",     label:"Targets",       type:"value.array"}
    ],
    outputs:[{id:"exec",label:"",type:"exec"}],
    fields:[
      {key:"label",        label:"Label",       type:"text",   default:"Healing"},
      {key:"target",       label:"To",          type:"select", default:"actor", options:["actor","token_target","selected_token","all_targets"]},
      {key:"hpPath",       label:"HP path",     type:"path",   default:"system.resources.hp.value"},
      {key:"critAmount",   label:"Crit Amount (used when Is Crit? is true)",     type:"text", default:"", placeholder:"e.g. 2*(1d8+@mod)"},
      {key:"fumbleAmount", label:"Fumble Amount (used when Is Fumble? is true)", type:"text", default:"", placeholder:"e.g. 1"},
      {key:"postToChat",   label:"Chat card",   type:"select", default:"no",  options:["yes","no"]},
      {key:"autoApply",    label:"Auto-apply",  type:"select", default:"no",  options:["no","yes"]},
      {key:"showApply",    label:"Apply btn",   type:"select", default:"yes", options:["yes","no"]}
    ],
    isAction:true,
    toAction:(n,inp)=>{
      const targetMode = (inp.target!=null && inp.target!=="" && inp.target!=="0") ? inp.target : (n.data.target ?? "actor");
      const _wired = (v) => v !== undefined && v !== "" && v !== null;
      const isCrit   = coerceBool(inp.isCrit)   ? 1 : 0;
      const isFumble = coerceBool(inp.isFumble) ? 1 : 0;
      const critAmount = _wired(inp.critAmount)
        ? String(inp.critAmount)
        : String(n.data.critAmount ?? "");
      const fumbleAmount = _wired(inp.fumbleAmount)
        ? String(inp.fumbleAmount)
        : String(n.data.fumbleAmount ?? "");

      const baseAmt = inp.amount ?? 0;
      const _amtForRoll =
        (isCrit   && critAmount   !== "") ? critAmount   :
        (isFumble && fumbleAmount !== "") ? fumbleAmount :
        String(baseAmt);
      if (n.data.postToChat === "yes") {
        return {type:"chatHeal",
          amount:String(baseAmt),
          isCrit, critAmount,
          isFumble, fumbleAmount,
          label:n.data.label??"Healing",
          target:targetMode, hpPath:n.data.hpPath??"system.resources.hp.value",
          targets: inp.targets ?? null,
          showApply: n.data.showApply !== "no",
          autoApply: n.data.autoApply === "yes"};
      }

      const path = n.data.hpPath ?? "system.resources.hp.value";
      const isSelfMode = (targetMode === "actor" || targetMode === "self");
      return {type:"modifyField",
        target: isSelfMode ? `actor.${path}` : `target.${path}`,
        targetMode, targets: inp.targets ?? null,
        delta:`+(${_amtForRoll})`,
        flavor:n.data.label??"Healing"};
    }
  },

  act_effect: {
    hidden:true, replacement:"act_effect_definition + act_effect_apply_v2",
    title:"Apply Effect", color:"#1a2a8a", cat:"Effects",
    desc:"Create or toggle an Active Effect on actor/target. Changes: JSON array [{key,value,mode}] where mode 2=Add 5=Override. Connect Target pin (single actor) or Targets pin (array) to override the field.",
    inputs:[
      {id:"exec",label:"",type:"exec"},
      {id:"duration",label:"Rounds",type:"value.number"},
      {id:"target",label:"Target",type:"value.actor"},
      {id:"targets",label:"Targets",type:"value.array"}
    ],
    outputs:[{id:"exec",label:"",type:"exec"}],
    fields:[
      {key:"effectName", label:"Name (existing or new)", type:"effect-picker", default:"My Effect"},
      {key:"icon",       label:"Icon",        type:"text",   default:"icons/svg/aura.svg", placeholder:"icons/svg/aura.svg"},
      {key:"target",     label:"Target",      type:"select", default:"actor", options:["actor","token_target","selected_token","all_targets"]},
      {key:"duration",   label:"Rounds (0=в€ћ)",type:"number", default:0},
      {key:"changes",    label:"Changes JSON",type:"text",   default:"", placeholder:'[{"key":"system.attributes.str.value","value":"2","mode":2}]'},
      {key:"toggleMode", label:"Mode",        type:"select", default:"create", options:["create","toggle","ensure_on","ensure_off"]}
    ],
    isAction:true, wideNode:true,
    toAction:(n,inp)=>({
      type:"applyEffect",
      effectName: n.data.effectName ?? "My Effect",
      icon:        n.data.icon       ?? "icons/svg/aura.svg",
      target:      (inp.target!=null && inp.target!=="" && inp.target!=="0") ? inp.target : (n.data.target ?? "actor"),
      targets:     inp.targets       ?? null,
      duration:    inp.duration      ?? n.data.duration ?? 0,
      changes:     (() => { try { return JSON.parse(n.data.changes||"[]"); } catch { return []; } })(),
      toggleMode:  n.data.toggleMode ?? "create"
    })
  },

  act_effect_uuid: {
    hidden:true, replacement:"act_effect_definition + act_effect_apply_v2",
    title:"Apply Effect (UUID)", color:"#1a2a8a", cat:"Effects",
    desc:"Apply an existing Active Effect to actor/target by UUID. Pick from the dropdown — UUID is filled automatically. Connect Target pin (single actor) or Targets pin (array) to override the field.",
    inputs:[
      {id:"exec",label:"",type:"exec"},
      {id:"duration",label:"Rounds",type:"value.number"},
      {id:"target",label:"Target",type:"value.actor"},
      {id:"targets",label:"Targets",type:"value.array"}
    ],
    outputs:[{id:"exec",label:"",type:"exec"}],
    fields:[
      {key:"effectUuid", label:"Effect",       type:"effect-uuid-picker", default:""},
      {key:"target",     label:"Target",        type:"select", default:"actor", options:["actor","token_target","selected_token","all_targets"]},
      {key:"toggleMode", label:"Mode",          type:"select", default:"create", options:["create","toggle","ensure_on","ensure_off"]},
      {key:"duration",   label:"Rounds (0=в€ћ)",  type:"number", default:0}
    ],
    isAction:true, wideNode:true,
    toAction:(n,inp)=>({
      type:       "applyEffectByUuid",
      effectUuid: n.data.effectUuid ?? "",
      target:     (inp.target!=null && inp.target!=="" && inp.target!=="0") ? inp.target : (n.data.target ?? "actor"),
      targets:    inp.targets       ?? null,
      toggleMode: n.data.toggleMode ?? "create",
      duration:   inp.duration      ?? n.data.duration ?? 0
    })
  },

  for_each_target: {
    title:"For Each Target", color:"#1a5a7a", cat:"Flow Control",
    desc:"Execute loop body once per targeted token. Use Set Target (multi-target with T) before activating.",
    inputs:[{id:"exec",label:"",type:"exec"}],
    outputs:[
      {id:"loop", label:"Loop →", type:"exec"},
      {id:"done", label:"Done →", type:"exec"}
    ],
    fields:[],
    isLoop: true
  },

  act_for_each_token: {
    title:"For Each Token", color:"#1a5a7a", cat:"Flow Control",
    desc:"Execute loop body once per token id in a comma-joined list (e.g. Saved[]/Failed[]/All[] from Save Branch). On each iteration {__currentTarget} = current token id and {__loopIndex} = i; the current token's actor becomes the action context.",
    inputs:[
      {id:"exec",   label:"",        type:"exec"},
      {id:"tokens", label:"Tokens",  type:"value.array"}
    ],
    outputs:[
      {id:"loop",  label:"Loop →",  type:"exec"},
      {id:"done",  label:"Done →",  type:"exec"},
      {id:"token", label:"Token",   type:"value.token"},
      {id:"index", label:"Index",   type:"value.number"}
    ],
    fields:[],
    isLoop: true,
    toAction:(_,inp)=>({
      type:   "forEachToken",
      tokens: inp.tokens ?? ""
    })
  },

  tok_field: {
    title:"Token Field", color:"#1a4060", cat:"Get Data",
    hidden:true, replacement:"get_path",
    desc:"Read a field from the actor of a token by token id. Token Id defaults to {__currentTarget} (set by For Each Token / per-target iterators). Use to read e.g. system.resources.hp.value of a specific saved/failed token.",
    inputs:[{id:"tokenId", label:"Token Id", type:"value.any"}],
    outputs:[{id:"v", label:"Value", type:"value.any"}],
    fields:[{key:"path",label:"Field",type:"path",default:"system.resources.hp.value"}],
    compile:(n,i)=>{
      const tid  = (i.tokenId != null && i.tokenId !== "") ? String(i.tokenId) : "{__currentTarget}";
      const path = n.data.path ?? "";
      return `{tokenField:${tid}.${path}}`;
    }
  },

  arr_length: {
    title:"Array Length", color:"#2a7a3a", cat:"Array",
    desc:"Number of token ids in a comma-joined list (e.g. Saved[]/Failed[]/All[] from Save Branch).",
    inputs:[{id:"tokens", label:"Tokens", type:"value.array"}],
    outputs:[{id:"v", label:"Count", type:"value.number"}],
    fields:[],
    compile:(_,i)=>`{arrayLength:${_arrayArg(i.tokens ?? "")}}`
  },

  arr_at: {
    title:"Get Token at Index", color:"#2a7a3a", cat:"Array",
    hidden:true, replacement:"arr_get",
    desc:"Returns the Nth token id (0-based) from a comma-joined list (Saved[]/Failed[]/All[] etc.). If Index is out of range, returns empty.",
    inputs:[
      {id:"tokens", label:"Tokens", type:"value.array"},
      {id:"index",  label:"Index",  type:"value.number"}
    ],
    outputs:[{id:"v", label:"Token", type:"value.any"}],
    fields:[{key:"index",label:"Index",type:"number",default:0}],
    compile:(n,i)=>`{arrayAt:${_arrayArg(i.tokens ?? "")}|${_arrayArg(i.index ?? n.data.index ?? 0)}}`
  },

  arr_map_field: {
    title:"Map Field", color:"#2a7a3a", cat:"Array",
    desc:"For every token in the array, read the same field from its actor and return all values as a new comma-joined list. Use to feed numeric arrays into Aggregate / Find / Filter or to compare values across tokens.",
    inputs:[{id:"tokens", label:"Tokens", type:"value.array"}],
    outputs:[{id:"v", label:"Values", type:"value.array"}],
    fields:[{key:"path",label:"Field",type:"path",default:"system.resources.hp.value"}],
    compile:(n,i)=>`{arrayMapField:${_arrayArg(i.tokens ?? "")}|${_arrayArg(n.data.path ?? "")}}`
  },

  arr_aggregate_field: {
    title:"Aggregate Field", color:"#2a7a3a", cat:"Array",
    desc:"Reduce a numeric field across all tokens in the array. Sum / Avg / Min / Max / Count. Non-numeric values are skipped.",
    inputs:[{id:"tokens", label:"Tokens", type:"value.array"}],
    outputs:[{id:"v", label:"Result", type:"value.number"}],
    fields:[
      {key:"path",label:"Field",type:"path",default:"system.resources.hp.value"},
      {key:"op",  label:"Op",   type:"select",default:"sum",options:["sum","avg","min","max","count"]}
    ],
    compile:(n,i)=>`{arrayAgg:${_arrayArg(i.tokens ?? "")}|${_arrayArg(n.data.path ?? "")}|${_arrayArg(n.data.op ?? "sum")}}`
  },

  arr_find_extreme: {
    title:"Find Top by Field", color:"#2a7a3a", cat:"Array",
    desc:"Returns the token id of the actor with the highest (max) or lowest (min) field value in the array. Useful for `who has more HP`, `slowest initiative`, etc.",
    inputs:[{id:"tokens", label:"Tokens", type:"value.array"}],
    outputs:[{id:"v", label:"Token", type:"value.any"}],
    fields:[
      {key:"path",label:"Field",type:"path",default:"system.resources.hp.value"},
      {key:"op",  label:"Pick", type:"select",default:"max",options:["max","min"]}
    ],
    compile:(n,i)=>`{arrayFindExtreme:${_arrayArg(i.tokens ?? "")}|${_arrayArg(n.data.path ?? "")}|${_arrayArg(n.data.op ?? "max")}}`
  },

  arr_filter: {
    title:"Filter by Field", color:"#2a7a3a", cat:"Array",
    desc:"Keep only tokens whose actor field passes `field <op> value`. Numeric comparisons when value parses as a number, string equality otherwise. Outputs a comma-joined list to feed back into other Array / For Each Token nodes.",
    inputs:[
      {id:"tokens", label:"Tokens", type:"value.array"},
      {id:"value",  label:"Value",  type:"value.any"}
    ],
    outputs:[{id:"v", label:"Filtered", type:"value.array"}],
    fields:[
      {key:"path",label:"Field",type:"path",default:"system.resources.hp.value"},
      {key:"op",  label:"Op",   type:"select",default:">",options:["==","!=",">","<",">=","<="]},
      {key:"value",label:"Value",type:"text",default:"0"}
    ],
    compile:(n,i)=>{
      const cmpRaw = (i.value !== undefined && i.value !== null && i.value !== "")
        ? String(i.value)
        : String(n.data.value ?? "0");
      let cmp = cmpRaw.trim();
      if (cmp.length >= 2 && (
            (cmp.startsWith('"') && cmp.endsWith('"')) ||
            (cmp.startsWith("'") && cmp.endsWith("'"))
          )) {
        cmp = cmp.slice(1, -1);
      }
      return `{arrayFilter:${_arrayArg(i.tokens ?? "")}|${_arrayArg(n.data.path ?? "")}|${_arrayArg(n.data.op ?? ">")}|${_arrayArg(cmp)}}`;
    }
  },

  arr_compare_two: {
    title:"Compare Two Tokens", color:"#5a3a7a", cat:"Array",
    desc:"Read the same field on two tokens and route exec into Greater / Less / Equal based on (A − B). Diff outputs the numeric difference and Winner outputs the id of the higher token (empty on tie).",
    inputs:[
      {id:"exec",   label:"",        type:"exec"},
      {id:"a",      label:"Token A", type:"value.token"},
      {id:"b",      label:"Token B", type:"value.token"}
    ],
    outputs:[
      {id:"greater", label:"A > B →", type:"exec"},
      {id:"less",    label:"A < B →", type:"exec"},
      {id:"equal",   label:"A = B →", type:"exec"},
      {id:"diff",    label:"Diff",    type:"value.number"},
      {id:"winner",  label:"Winner",  type:"value.token"}
    ],
    fields:[
      {key:"path",label:"Field",type:"path",default:"system.resources.hp.value"}
    ],
    isGenericBranch:true,
    toAction:(n,inp)=>({
      type:   "arrayCompareTwo",
      a:      inp.a ?? "",
      b:      inp.b ?? "",
      path:   n.data.path ?? ""
    })
  },

  arr_sort: {
    title:"Sort by Field", color:"#2a7a3a", cat:"Array",
    desc:"Sort token ids by a numeric actor field. Ascending or descending. Tokens with non-numeric values go to the end.",
    inputs:[{id:"tokens", label:"Tokens", type:"value.array"}],
    outputs:[{id:"v", label:"Sorted", type:"value.array"}],
    fields:[
      {key:"path",label:"Field",type:"path",default:"system.resources.hp.value"},
      {key:"op",  label:"Order",type:"select",default:"desc",options:["desc","asc"]}
    ],
    compile:(n,i)=>`{arraySort:${_arrayArg(i.tokens ?? "")}|${_arrayArg(n.data.path ?? "")}|${_arrayArg(n.data.op ?? "desc")}}`
  },

  arr_slice: {
    title:"Slice / Take", color:"#2a7a3a", cat:"Array",
    desc:"Take a sub-range of an array. Start is 0-based; Count of -1 means В«to the endВ». Use after Sort to get top-N / bottom-N.",
    inputs:[
      {id:"tokens", label:"Tokens", type:"value.array"},
      {id:"start",  label:"Start",  type:"value.number"},
      {id:"count",  label:"Count",  type:"value.number"}
    ],
    outputs:[{id:"v", label:"Slice", type:"value.array"}],
    fields:[
      {key:"start",label:"Start",type:"number",default:0},
      {key:"count",label:"Count (-1 = all)",type:"number",default:3}
    ],
    compile:(n,i)=>{
      const s = (i.start ?? n.data.start ?? 0);
      const c = (i.count ?? n.data.count ?? -1);
      return `{arraySlice:${_arrayArg(i.tokens ?? "")}|${_arrayArg(s)}|${_arrayArg(c)}}`;
    }
  },

  arr_concat: {
    title:"Concat", color:"#2a7a3a", cat:"Array",
    desc:"Join two arrays end-to-end (duplicates kept). For unique union use Union node.",
    inputs:[
      {id:"a", label:"A", type:"value.array"},
      {id:"b", label:"B", type:"value.array"}
    ],
    outputs:[{id:"v", label:"A+B", type:"value.array"}],
    fields:[],
    compile:(_,i)=>`{arrayConcat:${_arrayArg(i.a ?? "")}|${_arrayArg(i.b ?? "")}}`
  },

  arr_union: {
    title:"Union", color:"#2a7a3a", cat:"Array",
    desc:"All ids present in A or B (unique).",
    inputs:[
      {id:"a", label:"A", type:"value.array"},
      {id:"b", label:"B", type:"value.array"}
    ],
    outputs:[{id:"v", label:"A в€Є B", type:"value.array"}],
    fields:[],
    compile:(_,i)=>`{arrayUnion:${_arrayArg(i.a ?? "")}|${_arrayArg(i.b ?? "")}}`
  },

  arr_intersect: {
    title:"Intersect", color:"#2a7a3a", cat:"Array",
    desc:"Only ids present in BOTH A and B. В«Tokens that are buffed AND poisonedВ».",
    inputs:[
      {id:"a", label:"A", type:"value.array"},
      {id:"b", label:"B", type:"value.array"}
    ],
    outputs:[{id:"v", label:"A в€© B", type:"value.array"}],
    fields:[],
    compile:(_,i)=>`{arrayIntersect:${_arrayArg(i.a ?? "")}|${_arrayArg(i.b ?? "")}}`
  },

  arr_difference: {
    title:"Difference", color:"#2a7a3a", cat:"Array",
    desc:"Ids in A that are NOT in B. В«Targets that did not saveВ».",
    inputs:[
      {id:"a", label:"A", type:"value.array"},
      {id:"b", label:"B", type:"value.array"}
    ],
    outputs:[{id:"v", label:"A − B", type:"value.array"}],
    fields:[],
    compile:(_,i)=>`{arrayDifference:${_arrayArg(i.a ?? "")}|${_arrayArg(i.b ?? "")}}`
  },

  arr_contains: {
    title:"Contains", color:"#2a7a3a", cat:"Array",
    desc:"Returns 1 if Token id is present in the array, 0 otherwise. Useful for branches.",
    inputs:[
      {id:"tokens", label:"Tokens", type:"value.array"},
      {id:"id",     label:"Id",     type:"value.any"}
    ],
    outputs:[{id:"v", label:"In?", type:"value.bool"}],
    fields:[],
    compile:(_,i)=>`{arrayContains:${_arrayArg(i.tokens ?? "")}|${_arrayArg(i.id ?? "")}}`
  },

  arr_distinct: {
    title:"Distinct", color:"#2a7a3a", cat:"Array",
    desc:"Remove duplicate ids preserving first-seen order.",
    inputs:[{id:"tokens", label:"Tokens", type:"value.array"}],
    outputs:[{id:"v", label:"Unique", type:"value.array"}],
    fields:[],
    compile:(_,i)=>`{arrayDistinct:${_arrayArg(i.tokens ?? "")}}`
  },

  arr_make: {
    title:"Make Array", color:"#2a7a3a", cat:"Array",
    desc:"Build a new array from up to 8 individual values. Empty / unconnected slots are skipped. Output is a comma-joined list compatible with all other Array nodes.",
    inputs:[
      {id:"v0", label:"#0", type:"value.any"},
      {id:"v1", label:"#1", type:"value.any"},
      {id:"v2", label:"#2", type:"value.any"},
      {id:"v3", label:"#3", type:"value.any"},
      {id:"v4", label:"#4", type:"value.any"},
      {id:"v5", label:"#5", type:"value.any"},
      {id:"v6", label:"#6", type:"value.any"},
      {id:"v7", label:"#7", type:"value.any"}
    ],
    outputs:[{id:"v", label:"Array", type:"value.array"},{id:"len", label:"Length", type:"value.number"}],
    fields:[
      {key:"v0", label:"#0 (literal)", type:"text", default:""},
      {key:"v1", label:"#1 (literal)", type:"text", default:""},
      {key:"v2", label:"#2 (literal)", type:"text", default:""},
      {key:"v3", label:"#3 (literal)", type:"text", default:""}
    ],
    compile:(n,i)=>{
      const parts = [];
      for (let k = 0; k < 8; k++) {
        const id = `v${k}`;
        const fromPin = i[id];
        const fromField = n.data?.[id];
        const v = (fromPin != null && fromPin !== "") ? fromPin : (fromField ?? "");
        parts.push(_arrayArg(v));
      }
      return `{arrayMake:${parts.join("|")}}`;
    },
    compilePin:(n,i,pin)=>{
      const parts = [];
      for (let k = 0; k < 8; k++) {
        const id = `v${k}`;
        const fromPin = i[id];
        const fromField = n.data?.[id];
        const v = (fromPin != null && fromPin !== "") ? fromPin : (fromField ?? "");
        parts.push(_arrayArg(v));
      }
      const arr = `{arrayMake:${parts.join("|")}}`;
      if (pin === "len") return `{arrayLength:${arr}}`;
      return arr;
    }
  },

  arr_split: {
    title:"Array From String (Split)", color:"#2a7a3a", cat:"Array",
    desc:"Split a string into an array using a custom separator. Default separator is comma. Useful when you have a stored CSV value or want to convert a manually-typed list into an array.",
    inputs:[
      {id:"s",   label:"String",    type:"value.string"},
      {id:"sep", label:"Separator", type:"value.string"}
    ],
    outputs:[{id:"v", label:"Array", type:"value.array"},{id:"len", label:"Length", type:"value.number"}],
    fields:[{key:"sep",label:"Separator",type:"text",default:","}],
    compile:(n,i)=>{
      const sep = (i.sep != null && i.sep !== "") ? i.sep : (n.data.sep ?? ",");
      return `{arraySplit:${_arrayArg(i.s ?? "")}|${_arrayArg(sep)}}`;
    },
    compilePin:(n,i,pin)=>{
      const sep = (i.sep != null && i.sep !== "") ? i.sep : (n.data.sep ?? ",");
      const arr = `{arraySplit:${_arrayArg(i.s ?? "")}|${_arrayArg(sep)}}`;
      if (pin === "len") return `{arrayLength:${arr}}`;
      return arr;
    }
  },

  arr_join: {
    title:"Array Join (to String)", color:"#2a7a3a", cat:"Array",
    desc:"Concatenate array elements into a single string using a custom separator. Default separator is `, `. Useful for chat output / flavor text from a built array.",
    inputs:[
      {id:"a",   label:"Array",     type:"value.array"},
      {id:"sep", label:"Separator", type:"value.string"}
    ],
    outputs:[{id:"v", label:"String", type:"value.string"}],
    fields:[{key:"sep",label:"Separator",type:"text",default:", "}],
    compile:(n,i)=>{
      const sep = (i.sep != null && i.sep !== "") ? i.sep : (n.data.sep ?? ", ");
      return `{arrayJoin:${_arrayArg(i.a ?? "")}|${_arrayArg(sep)}}`;
    }
  },

  arr_push: {
    title:"Add to Array (Copy)", color:"#2a7a3a", cat:"Array",
    desc:"Append one element to an array and return the new array. Original array is not mutated. Empty Element is skipped (returns the array unchanged).",
    inputs:[
      {id:"a", label:"Array",   type:"value.array"},
      {id:"v", label:"Element", type:"value.any"}
    ],
    outputs:[{id:"v", label:"Array", type:"value.array"},{id:"len", label:"Length", type:"value.number"}],
    fields:[],
    compile:(_,i)=>{
      return `{arrayPush:${_arrayArg(i.a ?? "")}|${_arrayArg(i.v ?? "")}}`;
    },
    compilePin:(_,i,pin)=>{
      const arr = `{arrayPush:${_arrayArg(i.a ?? "")}|${_arrayArg(i.v ?? "")}}`;
      if (pin === "len") return `{arrayLength:${arr}}`;
      return arr;
    }
  },

  arr_get: {
    title:"Get Array Element", color:"#2a7a3a", cat:"Array",
    desc:"Generic version of `Token at Index` — works for ANY array (strings, numbers, ids). Supports negative indices: `-1` returns last, `-2` second-to-last, etc. If index is out of range and a Default is supplied, it is returned instead.",
    inputs:[
      {id:"a",   label:"Array",   type:"value.array"},
      {id:"i",   label:"Index",   type:"value.number"},
      {id:"def", label:"Default", type:"value.any"}
    ],
    outputs:[
      {id:"v",     label:"Value", type:"value.any"},
      {id:"found", label:"Found?", type:"value.bool"}
    ],
    fields:[
      {key:"i",  label:"Index",   type:"number", default:0},
      {key:"def",label:"Default", type:"text",   default:""}
    ],
    compile:(n,i)=>{
      const idx = (i.i != null && i.i !== "") ? i.i : (n.data.i ?? 0);
      const def = (i.def != null && i.def !== "") ? i.def : (n.data.def ?? "");
      return `{arrayGet:${_arrayArg(i.a ?? "")}|${_arrayArg(idx)}|${_arrayArg(def)}}`;
    },
    compilePin:(n,i,pin)=>{
      const idx = (i.i != null && i.i !== "") ? i.i : (n.data.i ?? 0);
      const def = (i.def != null && i.def !== "") ? i.def : (n.data.def ?? "");
      if (pin === "found") return `{arrayHasIndex:${_arrayArg(i.a ?? "")}|${_arrayArg(idx)}}`;
      return `{arrayGet:${_arrayArg(i.a ?? "")}|${_arrayArg(idx)}|${_arrayArg(def)}}`;
    }
  },

  arr_break: (() => {
    const MAX_P = 10;
    const _cnt = (d) => Math.max(1, Math.min(MAX_P, parseInt(d?.count) || 1));
    const idxFields = [];
    for (let k = 0; k < MAX_P; k++) {
      idxFields.push({ key:`idx${k}`, label:`Pin ${k+1} — index`, type:"number", default:k, visibleIf:(d)=>_cnt(d) > k });
    }
    return {
      title:"Break Array (Split Pins)", color:"#2a7a3a", cat:"Array", wideNode:true,
      desc:"Splits one array into several value pins. Add pin = raise the Pins count (1-10); each pin has its own configurable index (negative counts from the end: -1 is last). Works with any array: actor UUIDs from Get Target/Selected Actors, item ids, numbers, strings.",
      inputs:[{id:"a", label:"Array", type:"value.array"}],
      outputs:[],
      fields:[
        {key:"count", label:"Pins (add pin = +1)", type:"number", default:2},
        ...idxFields
      ],
      computeDynamicOutputs(node) {
        const d = node?.data ?? {};
        const c = _cnt(d);
        const outs = [];
        for (let k = 0; k < c; k++) {
          const idx = (d[`idx${k}`] === undefined || d[`idx${k}`] === null || d[`idx${k}`] === "") ? k : d[`idx${k}`];
          outs.push({ id:`out${k}`, label:`[${idx}]`, type:"value.any" });
        }
        return outs;
      },
      compile(n, i) {
        const idx = (n.data?.idx0 === undefined || n.data?.idx0 === null || n.data?.idx0 === "") ? 0 : n.data.idx0;
        return `{arrayGet:${_arrayArg(i.a ?? "")}|${_arrayArg(idx)}|${_arrayArg("")}}`;
      },
      compilePin(n, i, pin) {
        const m = /^out(\d+)$/.exec(String(pin ?? ""));
        const k = m ? parseInt(m[1]) : 0;
        const raw = n.data?.[`idx${k}`];
        const idx = (raw === undefined || raw === null || raw === "") ? k : raw;
        return `{arrayGet:${_arrayArg(i.a ?? "")}|${_arrayArg(idx)}|${_arrayArg("")}}`;
      }
    };
  })(),

  arr_first: {
    title:"Array First", color:"#2a7a3a", cat:"Array",
    hidden:true, replacement:"arr_get",
    desc:"Return the first element of an array (`arr[0]`). Empty if the array is empty.",
    inputs:[{id:"a", label:"Array", type:"value.array"}],
    outputs:[{id:"v", label:"Value", type:"value.any"}],
    fields:[],
    compile:(_,i)=>`{arrayGet:${_arrayArg(i.a ?? "")}|${_arrayArg(0)}|${_arrayArg("")}}`
  },

  arr_last: {
    title:"Array Last", color:"#2a7a3a", cat:"Array",
    hidden:true, replacement:"arr_get",
    desc:"Return the last element of an array (`arr[-1]`). Empty if the array is empty.",
    inputs:[{id:"a", label:"Array", type:"value.array"}],
    outputs:[{id:"v", label:"Value", type:"value.any"}],
    fields:[],
    compile:(_,i)=>`{arrayGet:${_arrayArg(i.a ?? "")}|${_arrayArg(-1)}|${_arrayArg("")}}`
  },

  arr_reverse: {
    title:"Array Reverse", color:"#2a7a3a", cat:"Array",
    desc:"Reverse the order of elements. Original array is not mutated.",
    inputs:[{id:"a", label:"Array", type:"value.array"}],
    outputs:[{id:"v", label:"Array", type:"value.array"}],
    fields:[],
    compile:(_,i)=>`{arrayReverse:${_arrayArg(i.a ?? "")}}`
  },

  arr_aggregate: {
    title:"Array Aggregate", color:"#2a7a3a", cat:"Array",
    desc:"Calculate Sum, Average, Minimum, Maximum, or numeric Count for any array. Non-numeric elements are ignored.",
    keywords:"sum average avg min max count numeric statistics",
    inputs:[{id:"a", label:"Array", type:"value.array"}],
    outputs:[{id:"v", label:"Result", type:"value.number"}],
    fields:[{
      key:"op", label:"Operation", type:"select", default:"sum",
      options:[
        {value:"sum",   label:"Sum"},
        {value:"avg",   label:"Average"},
        {value:"min",   label:"Minimum"},
        {value:"max",   label:"Maximum"},
        {value:"count", label:"Numeric Count"}
      ]
    }],
    compile:(n,i)=>`{arrayNum:${_arrayArg(i.a ?? "")}|${_arrayArg(n.data?.op ?? "sum")}}`
  },

  arr_sum_num: {
    title:"Array Sum (numeric)", color:"#2a7a3a", cat:"Array",
    hidden:true, replacement:"arr_aggregate",
    desc:"Sum of numeric elements in an already-numeric array (e.g. produced by `Map Field` or `Array Make` with numbers). Non-numeric elements are skipped. Returns 0 for empty arrays.",
    inputs:[{id:"a", label:"Array", type:"value.array"}],
    outputs:[{id:"v", label:"Sum", type:"value.number"}],
    fields:[],
    compile:(_,i)=>`{arrayNum:${_arrayArg(i.a ?? "")}|${_arrayArg("sum")}}`
  },

  arr_avg_num: {
    title:"Array Average (numeric)", color:"#2a7a3a", cat:"Array",
    hidden:true, replacement:"arr_aggregate",
    desc:"Average of numeric elements. Non-numeric elements are skipped. Returns 0 if there are no numeric elements.",
    inputs:[{id:"a", label:"Array", type:"value.array"}],
    outputs:[{id:"v", label:"Avg", type:"value.number"}],
    fields:[],
    compile:(_,i)=>`{arrayNum:${_arrayArg(i.a ?? "")}|${_arrayArg("avg")}}`
  },

  arr_min_num: {
    title:"Array Min (numeric)", color:"#2a7a3a", cat:"Array",
    hidden:true, replacement:"arr_aggregate",
    desc:"Lowest numeric element. Returns 0 for empty / non-numeric arrays.",
    inputs:[{id:"a", label:"Array", type:"value.array"}],
    outputs:[{id:"v", label:"Min", type:"value.number"}],
    fields:[],
    compile:(_,i)=>`{arrayNum:${_arrayArg(i.a ?? "")}|${_arrayArg("min")}}`
  },

  arr_max_num: {
    title:"Array Max (numeric)", color:"#2a7a3a", cat:"Array",
    hidden:true, replacement:"arr_aggregate",
    desc:"Highest numeric element. Returns 0 for empty / non-numeric arrays.",
    inputs:[{id:"a", label:"Array", type:"value.array"}],
    outputs:[{id:"v", label:"Max", type:"value.number"}],
    fields:[],
    compile:(_,i)=>`{arrayNum:${_arrayArg(i.a ?? "")}|${_arrayArg("max")}}`
  },

  arr_random_pick: {
    title:"Array Random Pick", color:"#2a7a3a", cat:"Array",
    hidden:true, replacement:"arr_random_from",
    desc:"Pick `count` random elements (without repetition). Default count is 1 and returns a single element as the value. Count > 1 returns an array.",
    inputs:[
      {id:"a", label:"Array", type:"value.array"},
      {id:"n", label:"Count", type:"value.number"}
    ],
    outputs:[
      {id:"v",   label:"Value/Array", type:"value.any"},
      {id:"arr", label:"Array",       type:"value.array"}
    ],
    fields:[{key:"n",label:"Count",type:"number",default:1}],
    compile:(n,i)=>{
      const cnt = (i.n != null && i.n !== "") ? i.n : (n.data.n ?? 1);
      return `{arrayRandomPick:${_arrayArg(i.a ?? "")}|${_arrayArg(cnt)}}`;
    },
    compilePin:(n,i,pin)=>{
      const cnt = (i.n != null && i.n !== "") ? i.n : (n.data.n ?? 1);
      return `{arrayRandomPick:${_arrayArg(i.a ?? "")}|${_arrayArg(cnt)}}`;
    }
  },

  arr_random_from: {
    title:"Random from Array", color:"#2a7a3a", cat:"Array",
    desc:"Pick `Count` random elements (no repetition) from one or more wired arrays — every wired source is concatenated first. Output is ALWAYS a comma-joined array (even when Count is 1), so it chains cleanly into any other Array node and works with every array type (tokens, items, UUIDs, names, strings, numbers, …). Extra Array pins appear automatically as you connect them.",
    inputs:[
      {id:"n", label:"Count", type:"value.number"}
    ],
    outputs:[
      {id:"arr", label:"Array",  type:"value.array"},
      {id:"len", label:"Length", type:"value.number"}
    ],
    fields:[{key:"n", label:"Count", type:"number", default:1}],
    dynamicPins:[
      { base:"a", label:"Array", max:8, type:"value.array" }
    ],
    compile:(n,i)=>{
      const cnt = (i.n != null && i.n !== "") ? i.n : (n.data.n ?? 1);
      const lists = [];
      for (let k = 0; k < 8; k++) {
        const v = i[`a${k}`];
        if (v != null && v !== "") lists.push(v);
      }
      return `{arrayRandomFrom:${_arrayArg(cnt)}|${lists.map(_arrayArg).join("|")}}`;
    },
    compilePin:(n,i,pin)=>{
      const cnt = (i.n != null && i.n !== "") ? i.n : (n.data.n ?? 1);
      const lists = [];
      for (let k = 0; k < 8; k++) {
        const v = i[`a${k}`];
        if (v != null && v !== "") lists.push(v);
      }
      const arr = `{arrayRandomFrom:${_arrayArg(cnt)}|${lists.map(_arrayArg).join("|")}}`;
      if (pin === "len") return `{arrayLength:${arr}}`;
      return arr;
    }
  },

  arr_filter_generic: {
    title:"Array Filter (by element)", color:"#2a7a3a", cat:"Array",
    desc:"Generic filter that compares each element of the array directly to a value (no actor.path). Operators: `==`, `!=`, `>`, `<`, `>=`, `<=`, `contains`, `startsWith`, `endsWith`. Numeric ops cast elements to numbers; string ops use case-sensitive substring matching.",
    inputs:[
      {id:"a", label:"Array", type:"value.array"},
      {id:"v", label:"Value", type:"value.any"}
    ],
    outputs:[
      {id:"out", label:"Filtered", type:"value.array"},
      {id:"len", label:"Length",   type:"value.number"}
    ],
    fields:[
      {key:"op",   label:"Op",    type:"select", default:"==",
       options:["==","!=",">","<",">=","<=","contains","startsWith","endsWith"]},
      {key:"v",    label:"Value", type:"text",   default:""}
    ],
    compile:(n,i)=>{
      const cmp = (i.v != null && i.v !== "") ? i.v : (n.data.v ?? "");
      return `{arrayFilterGeneric:${_arrayArg(i.a ?? "")}|${_arrayArg(n.data.op ?? "==")}|${_arrayArg(cmp)}}`;
    },
    compilePin:(n,i,pin)=>{
      const cmp = (i.v != null && i.v !== "") ? i.v : (n.data.v ?? "");
      const arr = `{arrayFilterGeneric:${_arrayArg(i.a ?? "")}|${_arrayArg(n.data.op ?? "==")}|${_arrayArg(cmp)}}`;
      if (pin === "len") return `{arrayLength:${arr}}`;
      return arr;
    }
  },

  arr_map_formula: {
    title:"Array Map (formula)", color:"#2a7a3a", cat:"Array",
    desc:"Apply a formula to every element of an array. Inside the formula, `{__elem}` is replaced with the current element, and `{__elemIndex}` with its 0-based index. Each result is evaluated by the formula engine. Useful for `array * 2`, `floor(array/3)`, conditional transforms, etc.",
    inputs:[
      {id:"a",       label:"Array",   type:"value.array"},
      {id:"formula", label:"Formula", type:"value.string"}
    ],
    outputs:[{id:"v", label:"Array", type:"value.array"}],
    fields:[
      {key:"formula", label:"Formula (use {__elem})", type:"text", default:"{__elem}", placeholder:"e.g. {__elem} * 2"}
    ],
    compile:(n,i)=>{
      const f = (i.formula != null && i.formula !== "") ? i.formula : (n.data.formula ?? "{__elem}");
      return `{arrayMapFormula:${_arrayArg(i.a ?? "")}|${_arrayArg(f)}}`;
    }
  },

  arr_for_each: {
    title:"For Each Element", color:"#1a5a7a", cat:"Flow Control",
    desc:"Generic version of `For Each Token` — execute a body once per element of an arbitrary array (strings, numbers, anything). On each iteration `{__loopItem}` = current element, `{__loopIndex}` = i. After all iterations, exec goes to Done.",
    inputs:[
      {id:"exec", label:"",      type:"exec"},
      {id:"a",    label:"Array", type:"value.array"}
    ],
    outputs:[
      {id:"loop",  label:"Loop →", type:"exec"},
      {id:"done",  label:"Done →", type:"exec"},
      {id:"item",  label:"Item",   type:"value.any"},
      {id:"index", label:"Index",  type:"value.number"}
    ],
    fields:[],
    isLoop: true,
    toAction:(_,inp)=>({
      type:  "forEachItem",
      items: inp.a ?? ""
    })
  },

  get_spell_slots: {
    title:"Spell Slots", color:"#1a4060", cat:"Sources",
    hidden:true,
    desc:"(Removed) Spell Slots node has been retired. Use Get Field Value on the relevant resource path instead.",
    inputs:[], outputs:[{id:"v",label:"Remaining",type:"value.number"}],
    fields:[{key:"level",label:"Spell Level",type:"number",default:1}],
    compile:(n)=>`{spellSlots:${n.data.level??1}}`
  },

  act_restore_slot: {
    title:"Restore Slot", color:"#1a4a2a", cat:"Resources",
    hidden:true,
    desc:"(Removed) Spell-slot restore has been retired together with the Spell Slots node. Use Modify Field on the relevant resource path instead.",
    inputs:[{id:"exec",label:"",type:"exec"},{id:"level",label:"Level",type:"value.number"}],
    outputs:[{id:"exec",label:"",type:"exec"}],
    fields:[{key:"level",label:"Default Level",type:"number",default:1}],
    isAction:true,
    toAction:(n,inp)=>({type:"restoreSlot", level:inp.level??n.data.level??1})
  },

  act_apply_effect_template: {
    title:"Apply Effect Template (legacy)", color:"#1a2a8a", cat:"Effects",
    hidden:true,
    desc:"Legacy — use Create Effect or Chat Apply Effect instead.",
    inputs:[
      {id:"exec",label:"",type:"exec"},
      {id:"target",label:"Target",type:"value.actor"}
    ],
    outputs:[{id:"exec",label:"",type:"exec"}],
    fields:[
      {key:"templateName",label:"Template Name",  type:"text",  default:""},
      {key:"target",      label:"Target Override", type:"select",default:"use_template", options:["use_template","self","actor","token_target","selected_token","all_targets"]}
    ],
    isAction:true, wideNode:true,
    toAction:(n,inp)=>({
      type:           "applyEffectTemplate",
      templateName:   n.data.templateName ?? "",
      targetOverride: (inp.target!=null && inp.target!=="" && inp.target!=="0")
        ? inp.target
        : (n.data.target === "use_template" ? null : (n.data.target ?? null))
    })
  },

  act_modify: {
    title:"Modify Field", color:"#4a2a6a", cat:"Set Data", wideNode:true,
    desc:"Add / subtract / set any field on self, actor or target. The Actor pin (when wired) overrides the Where dropdown — feed it a UUID, a Get Actor / Get All Targets node, or any actor expression. An array of actors loops the change over each. Path / Where / Op can all be fed dynamically — when wired, the matching field hides UE-style.",
    inputs:[
      {id:"exec",  label:"",        type:"exec"},
      {id:"actor", label:"Actor",   type:"value.actor"},
      {id:"amount",label:"Amount",  type:"value.number"},
      {id:"path",  label:"Path",    type:"value.path"},
      {id:"where", label:"Where",   type:"value.string"},
      {id:"op",    label:"Op",      type:"value.string"}
    ],
    outputs:[{id:"exec",label:"",type:"exec"},{id:"newValue",label:"New Value",type:"value.any"}],
    fields:[
      {key:"where",label:"Where",type:"select",default:"self",options:["self","actor","token_target","selected_token","all_targets","user_character"]},
      {key:"path", label:"Field",type:"path",default:"system.uses.value"},
      {key:"op",   label:"Op",type:"select",default:"add",options:["add","subtract","set"]}
    ],
    isAction:true,
    toAction:(n,inp)=>{
      const where = (inp.where != null && inp.where !== "") ? String(inp.where) : (n.data.where ?? "self");
      const op    = (inp.op    != null && inp.op    !== "") ? String(inp.op)    : (n.data.op    ?? "add");
      const pfx=where==="token_target"?"target.":where==="actor"?"actor.":where==="self"?"self.":"";
      const amt=inp.amount??0;
      const delta=op==="set"?null:op==="subtract"?`-(${amt})`:`+(${amt})`;
      const p = (inp.path!=null && inp.path!=="") ? String(inp.path) : (n.data.path??"");
      const out = {
        type:"modifyField",
        target:`${pfx}${p}`,
        rawPath:p,
        where,
        delta,
        setValue:op==="set"?String(amt):null
      };

      if (inp.actor != null && inp.actor !== "" && inp.actor !== "0" && inp.actor !== `"0"`) {
        out.actorOverride = inp.actor;
      }
      return out;
    }
  },

  act_set_text_field: {
    title:"Set Text Field", color:"#4a2a6a", cat:"Set Data", wideNode:true,
    desc:"Write a string/text value to any path on self / actor / target. The Actor pin (when wired) overrides the Where dropdown. An array of actors loops the write over each. Use this for non-numeric writes — chat AI responses to a notes field, paste a label, fill a description, etc. Modify Field is for numbers; this is for text. Where can be fed dynamically (UE-style — when the Where pin is wired the dropdown hides). Value supports module tokens ({widget:KEY}, {@attr1}, {item:Sword.system.notes}) and runtime tokens ({__lastAiResponse}, {__lastAiError}, {__lastRoll}).",
    inputs:[
      {id:"exec",  label:"",       type:"exec"},
      {id:"actor", label:"Actor",  type:"value.actor"},
      {id:"value", label:"Value",  type:"value.string"},
      {id:"path",  label:"Path",   type:"value.path"},
      {id:"where", label:"Where",  type:"value.string"}
    ],
    outputs:[{id:"exec",label:"",type:"exec"}],
    fields:[
      {key:"where", label:"Where",  type:"select", default:"self", options:["self","actor","token_target","selected_token","all_targets","user_character"]},
      {key:"path",  label:"Field",  type:"path",   default:"",
        placeholder:"e.g. system.notes.story or system.hiddenFields.aiAnswer"},
      {key:"value", label:"Value",  type:"text",   default:"",
        placeholder:"plain text or {__lastAiResponse} / {widget:save}"}
    ],
    isAction:true,
    toAction:(n,inp)=>{
      const where = (inp.where != null && inp.where !== "") ? String(inp.where) : (n.data.where ?? "self");
      const pfx = where==="token_target" ? "target." : where==="actor" ? "actor." : "self.";
      const p   = (inp.path  != null && inp.path  !== "") ? String(inp.path)  : (n.data.path  ?? "");
      const v   = (inp.value != null && inp.value !== "") ? String(inp.value) : (n.data.value ?? "");
      const out = {
        type:"setTextField",
        target:`${pfx}${p}`,
        rawPath:p,
        where,
        value:v
      };
      if (inp.actor != null && inp.actor !== "" && inp.actor !== "0" && inp.actor !== `"0"`) {
        out.actorOverride = inp.actor;
      }
      return out;
    }
  },

  act_cast_to: {
    title:"Cast To", color:"#4a2a6a", cat:"Set Data", wideNode:true,
    desc:"Casts (writes) a value into a field on an actor or item. Target: self (actor / this item) or wire a UUID into the Target pin. Value comes from the Value pin or the Formula field ({...} tokens and @refs like @hiddenFields.actor + 2 are supported, dice too). Cast Once: writes only the first time; afterwards the node just passes through Exec like a dot. Revert Cast by Bool + Revert pin: while the bool is false the cast is reverted (previous value restored) and Cast Once is re-armed. Exec always continues; Completed fires only when the value was actually written.",
    inputs:[
      {id:"exec",   label:"",              type:"exec"},
      {id:"target", label:"Target (UUID)", type:"value.any"},
      {id:"value",  label:"Value",         type:"value.any"},
      {id:"revert", label:"Revert (bool)", type:"value.bool"}
    ],
    outputs:[
      {id:"completed", label:"Completed →", type:"exec"},
      {id:"exec",      label:"Exec →",      type:"exec"}
    ],
    fields:[
      {key:"targetType",   label:"Cast to",             type:"select",   default:"actor", options:["actor","item"]},
      {key:"path",         label:"Field path",          type:"path",     default:"system.hiddenFields.myField"},
      {key:"formula",      label:"Formula",             type:"text",     default:""},
      {key:"castOnce",     label:"Cast Once",           type:"checkbox", default:false},
      {key:"revertByBool", label:"Revert Cast by Bool", type:"checkbox", default:false}
    ],
    isGenericBranch:true,
    toAction:(n,inp)=>({
      type:"castTo",
      castId: n.id,
      targetType: n.data.targetType ?? "actor",
      path: n.data.path ?? "",
      value: (inp.value != null && inp.value !== "") ? String(inp.value) : String(n.data.formula ?? ""),
      targetRef: (inp.target != null && inp.target !== "") ? String(inp.target) : "",
      castOnce: !!n.data.castOnce,
      revertByBool: !!n.data.revertByBool,
      revert: (inp.revert != null && inp.revert !== "") ? String(inp.revert) : ""
    })
  },

  act_set_initiative: {
    title:"Set Initiative", color:"#4a2a6a", cat:"Set Data",
    desc:"Set or roll initiative for the target actor in the active combat. Mode `roll` rolls the system formula; `value` sets the exact number. If the actor isn't in combat, a combatant is created (only for the active combat). Mode can be fed via pin (UE-style: when wired the field hides).",
    inputs:[
      {id:"exec",   label:"",          type:"exec"},
      {id:"target", label:"Target",    type:"value.actor"},
      {id:"mode",   label:"Mode",      type:"value.string"},
      {id:"value",  label:"Value",     type:"value.number"}
    ],
    outputs:[{id:"exec", label:"", type:"exec"}],
    fields:[
      {key:"target",label:"Target",type:"select",default:"actor",options:["self","actor","token_target","selected_token","all_targets"]},
      {key:"mode",  label:"Mode",  type:"select",default:"roll", options:["roll","value"]},
      {key:"value", label:"Value (mode=value)", type:"number", default:10}
    ],
    isAction:true,
    toAction:(n,inp)=>({
      type:   "setInitiative",
      target: inp.target ?? n.data.target ?? "actor",
      mode:   (inp.mode != null && inp.mode !== "") ? String(inp.mode) : (n.data.mode ?? "roll"),
      value:  inp.value  ?? n.data.value  ?? 0
    })
  },

  act_message: {
    title:"Message", color:"#4a4a1a", cat:"Chat",
    inputs:[{id:"exec",label:"",type:"exec"}],
    outputs:[{id:"exec",label:"",type:"exec"}],
    fields:[{key:"message",label:"Message",type:"textarea",default:""}],
    isAction:true,
    dynamicPins:[{ base:"text", label:"Text", max:10, type:"value.string" }],
    toAction:(n,inp)=>{
      const parts=[];
      const base = String(n.data.message ?? "").trim();
      if (base) parts.push(base);
      for(let i=0;i<10;i++){
        const v=inp[`text${i}`];
        if(v!==undefined && v!==null && v!=="") parts.push(String(v));
      }
      return {type:"message", messageParts:parts};
    }
  },

  act_message_composer: {
    title:"Message Composer", color:"#7a4a22", cat:"Chat", wideNode:true,
    desc:"Build one styled chat card from text, a result or damage value, an image, and up to six interactive buttons. Each button output runs its connected exec branch when clicked. For an Apply Damage button, connect it to Damage with Chat card set to no.",
    keywords:"message compiler compilator composer chat card damage message buttons interactive action card",
    inputs:[
      {id:"exec",       label:"",            type:"exec"},
      {id:"title",      label:"Title",       type:"value.string"},
      {id:"message",    label:"Message",     type:"value.string"},
      {id:"value",      label:"Value",       type:"value.any"},
      {id:"valueLabel", label:"Value label", type:"value.string"},
      {id:"image",      label:"Image",       type:"value.string"}
    ],
    outputs:[{id:"posted", label:"Posted ->", type:"exec"}],
    catalogOutputs:[
      {id:"btn0", label:"Button 1 ->", type:"exec"},
      {id:"btn1", label:"Button 2 ->", type:"exec"},
      {id:"btn2", label:"Button 3 ->", type:"exec"},
      {id:"btn3", label:"Button 4 ->", type:"exec"},
      {id:"btn4", label:"Button 5 ->", type:"exec"},
      {id:"btn5", label:"Button 6 ->", type:"exec"}
    ],
    fields:[
      {key:"style",      label:"Card style", type:"select", default:"message", options:[
        {value:"message", label:"Message"},
        {value:"damage",  label:"Damage"},
        {value:"healing", label:"Healing"},
        {value:"check",   label:"Check"},
        {value:"notice",  label:"Notice"}
      ]},
      {key:"title",      label:"Title",       type:"text",     default:"Message"},
      {key:"message",    label:"Message",     type:"textarea", default:"", rows:4},
      {key:"value",      label:"Value",       type:"text",     default:""},
      {key:"valueLabel", label:"Value label", type:"text",     default:""},
      {key:"image",      label:"Image",       type:"text",     default:"", placeholder:"Actor portrait, item image, or path"},
      {key:"access", label:"Button access", type:"select", default:"actorOwner", options:[
        {value:"actorOwner", label:"Actor owners"},
        {value:"author",     label:"Message author"},
        {value:"gm",         label:"GM only"},
        {value:"everyone",   label:"Everyone"}
      ]},
      {key:"buttonUse", label:"Button use", type:"select", default:"once", options:[
        {value:"once",     label:"Once"},
        {value:"reusable", label:"Reusable"}
      ]},
      {key:"visibility", label:"Message visibility", type:"select", default:"public", options:[
        {value:"public", label:"Public"},
        {value:"gm",     label:"Whisper to GM"},
        {value:"self",   label:"Whisper to self"}
      ]},
      {key:"buttons", label:"Buttons", type:"message-buttons-editor", default:[]}
    ],
    isAction:true,
    isGenericBranch:true,
    computeDynamicOutputs(node) {
      const buttons = _messageComposerButtons(node?.data).filter(button => button.enabled);
      return [
        {id:"posted", label:"Posted ->", type:"exec"},
        ...buttons.map(button => ({id:button.id, label:`${button.label} ->`, type:"exec"}))
      ];
    },
    toAction(n, inp = {}) {
      const buttons = _messageComposerButtons(n?.data).filter(button => button.enabled);
      return {
        type:"messageComposer",
        style:String(n.data?.style ?? "message"),
        title:inp.title ?? n.data?.title ?? "Message",
        message:inp.message ?? n.data?.message ?? "",
        value:inp.value ?? n.data?.value ?? "",
        valueLabel:inp.valueLabel ?? n.data?.valueLabel ?? "",
        image:inp.image ?? n.data?.image ?? "",
        access:String(n.data?.access ?? "actorOwner"),
        buttonUse:String(n.data?.buttonUse ?? "once"),
        visibility:String(n.data?.visibility ?? "public"),
        buttons:buttons.map(({id, label, icon, variant}) => ({id, label, icon, variant}))
      };
    }
  },

  act_add_item: {
    title:"Add Item(s)", color:"#2a4a2a", cat:"Items",
    desc:"Add one item or an array of item UUIDs/ids/names to the actor. A connected Item / Items pin overrides the static UUID.",
    inputs:[{id:"exec",label:"",type:"exec"},{id:"items",label:"Item / Items",type:"value.any"},{id:"qty",label:"Qty",type:"value.number"}],
    outputs:[{id:"exec",label:"",type:"exec"}],
    fields:[
      {key:"uuid",            label:"Item UUID (drag here)",  type:"text",          default:"", placeholder:"drag item from sidebar…"},
      {key:"qty",             label:"Qty",                    type:"number",         default:1},
      {key:"inventoryWidget", label:"Inventory Widget",       type:"widget-picker",  default:""}
    ],
    isAction:true, wideNode:true,
    toAction:(n,inp)=>({type:"createItemArray", items:inp.items ?? n.data.uuid ?? "", qty:Number(inp.qty ?? n.data.qty ?? 1), inventoryWidget:n.data.inventoryWidget??""})
  },

  act_add_slot: {
    title:"Add to Slot", color:"#2a4a2a", cat:"Items",
    desc:"Add an item to a slot on the source (this item / actor / wired Actor pin). Item is referenced by name or UUID (text or pin); Slot ID is plain text or pin.",
    inputs:[
      {id:"exec",     label:"",        type:"exec"},
      {id:"slotId",   label:"Slot ID", type:"value.string"},
      {id:"itemName", label:"Item",    type:"value.string"},
      {id:"itemUuid", label:"UUID",    type:"value.string"},
      {id:"actor",    label:"Actor",   type:"value.actor"}
    ],
    outputs:[{id:"exec",label:"",type:"exec"}],
    fields:[
      {key:"itemName", label:"Item name", type:"text", default:"", placeholder:"item name (optional)"},
      {key:"uuid",     label:"…or UUID", type:"text", default:"", placeholder:"Item.xxxxx"},
      {key:"slotId",   label:"Slot ID",  type:"text", default:"slot1", placeholder:"slot1"}
    ],
    isAction:true, wideNode:true,
    toAction:(n,inp)=>({
      type:     "addToSlot",
      itemName: (inp.itemName != null && inp.itemName !== "") ? String(inp.itemName) : (n.data.itemName ?? ""),
      uuid:     (inp.itemUuid != null && inp.itemUuid !== "") ? String(inp.itemUuid) : (n.data.uuid ?? ""),
      slotId:   (inp.slotId   != null && inp.slotId   !== "") ? String(inp.slotId)   : (n.data.slotId ?? "slot1"),
      slotPath: n.data.slotPath ?? null,
      actorOverride: (inp.actor != null && inp.actor !== "" && inp.actor !== "0" && inp.actor !== `"0"`) ? inp.actor : null
    })
  },

  act_remove_slot: {
    title:"Remove from Slot", color:"#6a2a2a", cat:"Items",
    desc:"Remove the first item from a slot by Slot ID. Source is this item / actor / wired Actor pin. Slot ID is plain text or pin.",
    inputs:[
      {id:"exec",   label:"",        type:"exec"},
      {id:"slotId", label:"Slot ID", type:"value.string"},
      {id:"actor",  label:"Actor",   type:"value.actor"}
    ],
    outputs:[{id:"exec",label:"",type:"exec"}],
    fields:[
      {key:"slotId", label:"Slot ID", type:"text", default:"slot1", placeholder:"slot1"}
    ],
    isAction:true, wideNode:true,
    toAction:(n,inp)=>({
      type:     "removeFromSlot",
      slotId:   (inp.slotId != null && inp.slotId !== "") ? String(inp.slotId) : (n.data.slotId ?? "slot1"),
      index:    0,
      slotPath: n.data.slotPath ?? null,
      actorOverride: (inp.actor != null && inp.actor !== "" && inp.actor !== "0" && inp.actor !== `"0"`) ? inp.actor : null
    })
  },

  act_remove_item: {
    title:"Remove Item(s)", color:"#6a2a2a", cat:"Items",
    desc:"Remove one owned item or an array of item UUIDs/ids/names. A connected Item / Items pin overrides the static picker.",
    inputs:[{id:"exec",label:"",type:"exec"},{id:"items",label:"Item / Items",type:"value.any"}],
    outputs:[{id:"exec",label:"",type:"exec"}],
    fields:[
      {key:"itemName",        label:"Item",              type:"item-picker",   default:""},
      {key:"uuid",            label:"…or UUID",          type:"text",          default:"", placeholder:"drag item from sidebar…"},
      {key:"inventoryWidget", label:"Inventory Widget",  type:"widget-picker", default:""}
    ],
    isAction:true, wideNode:true,
    toAction:(n,inp)=>({type:"removeItemArray", items:inp.items ?? n.data.uuid ?? n.data.itemName ?? "", inventoryWidget:n.data.inventoryWidget??""})
  },

  act_add_item_array: {
    hidden:true, replacement:"act_add_item",
    title:"Add Item Array", color:"#2a4a2a", cat:"Items",
    desc:"Add every item from an array (UUIDs or owned names/ids) as copies to the actor's inventory. Feed a Compendium Item UUIDs node or any value.array of item references. Qty per item can be set. Optionally scope to an inventory widget.",
    inputs:[
      {id:"exec",  label:"",       type:"exec"},
      {id:"items", label:"Items",  type:"value.array"},
      {id:"qty",   label:"Qty",    type:"value.number"}
    ],
    outputs:[{id:"exec",label:"",type:"exec"}],
    fields:[
      {key:"qty",            label:"Qty per item",     type:"number",        default:1},
      {key:"inventoryWidget",label:"Inventory Widget", type:"widget-picker", default:""}
    ],
    isAction:true, wideNode:true,
    toAction:(n,inp)=>({
      type:"createItemArray",
      items:           inp.items ?? "",
      qty:             Number(inp.qty ?? n.data.qty ?? 1),
      inventoryWidget: n.data.inventoryWidget ?? ""
    })
  },

  act_remove_item_array: {
    hidden:true, replacement:"act_remove_item",
    title:"Remove Item Array", color:"#6a2a2a", cat:"Items",
    desc:"Remove every item listed in the array (matches by name, id, or UUID source name) from the actor's inventory. Optionally scope to an inventory widget.",
    inputs:[
      {id:"exec",  label:"",      type:"exec"},
      {id:"items", label:"Items", type:"value.array"}
    ],
    outputs:[{id:"exec",label:"",type:"exec"}],
    fields:[
      {key:"inventoryWidget", label:"Inventory Widget",  type:"widget-picker", default:""}
    ],
    isAction:true, wideNode:true,
    toAction:(n,inp)=>({
      type:"removeItemArray",
      items:           inp.items ?? "",
      inventoryWidget: n.data.inventoryWidget ?? ""
    })
  },

  item_arr_names: {
    title:"Item Array Names", color:"#3a7a3a", cat:"Items",
    desc:"Resolve each ref in an array of items (UUIDs / owned ids / names) and return their display names as a comma-joined array.",
    inputs:[{id:"items", label:"Items", type:"value.array"}],
    outputs:[{id:"v", label:"Names", type:"value.array"}],
    fields:[],
    compile:(_n,i)=>`{itemNames:${i.items ?? ""}}`
  },

  item_arr_map_field: {
    title:"Item Map Field", color:"#3a7a3a", cat:"Items",
    desc:"For every item in the array, read the same field path and return all values as a comma-joined array. Use to feed numeric arrays into Aggregate / Find / Filter.",
    inputs:[{id:"items", label:"Items", type:"value.array"}],
    outputs:[{id:"v", label:"Values", type:"value.array"}],
    fields:[
      {key:"path", label:"Field", type:"path", default:"system.quantity"}
    ],
    compile:(n,i)=>`{itemMapField:${i.items ?? ""}|${n.data.path ?? ""}}`
  },

  item_arr_aggregate: {
    title:"Item Aggregate Field", color:"#3a7a3a", cat:"Items",
    desc:"Reduce a numeric field across all items in the array. Sum / Avg / Min / Max / Count. Non-numeric values are skipped.",
    inputs:[{id:"items", label:"Items", type:"value.array"}],
    outputs:[{id:"v", label:"Result", type:"value.number"}],
    fields:[
      {key:"path", label:"Field", type:"path",   default:"system.quantity"},
      {key:"op",   label:"Op",    type:"select", default:"sum", options:["sum","avg","min","max","count"]}
    ],
    compile:(n,i)=>`{itemAgg:${i.items ?? ""}|${n.data.path ?? ""}|${n.data.op ?? "sum"}}`
  },

  item_arr_filter: {
    title:"Item Filter by Field", color:"#3a7a3a", cat:"Items",
    desc:"Keep only items whose field passes `field <op> value`. Numeric comparisons when value parses as a number, string equality otherwise. Outputs a comma-joined list to feed back into other Items / Array nodes.",
    inputs:[
      {id:"items", label:"Items", type:"value.array"},
      {id:"value", label:"Value", type:"value.any"}
    ],
    outputs:[{id:"v", label:"Filtered", type:"value.array"}],
    fields:[
      {key:"path", label:"Field", type:"path",   default:"system.quantity"},
      {key:"op",   label:"Op",    type:"select", default:">", options:["==","!=",">","<",">=","<=","contains","startsWith","endsWith"]},
      {key:"value",label:"Value", type:"text",   default:"0"}
    ],
    compile:(n,i)=>{
      const cmpRaw = (i.value !== undefined && i.value !== null && i.value !== "")
        ? String(i.value)
        : String(n.data.value ?? "0");
      let cmp = cmpRaw.trim();
      if (cmp.length >= 2 && (
            (cmp.startsWith('"') && cmp.endsWith('"')) ||
            (cmp.startsWith("'") && cmp.endsWith("'"))
          )) {
        cmp = cmp.slice(1, -1);
      }
      return `{itemFilter:${i.items ?? ""}|${n.data.path ?? ""}|${n.data.op ?? ">"}|${cmp}}`;
    }
  },

  item_arr_sort: {
    title:"Item Sort by Field", color:"#3a7a3a", cat:"Items",
    desc:"Sort item refs by a numeric field. Ascending or descending. Items with non-numeric values go to the end.",
    inputs:[{id:"items", label:"Items", type:"value.array"}],
    outputs:[{id:"v", label:"Sorted", type:"value.array"}],
    fields:[
      {key:"path", label:"Field", type:"path",   default:"system.quantity"},
      {key:"op",   label:"Order", type:"select", default:"desc", options:["desc","asc"]}
    ],
    compile:(n,i)=>`{itemSort:${i.items ?? ""}|${n.data.path ?? ""}|${n.data.op ?? "desc"}}`
  },

  item_arr_find_extreme: {
    title:"Item Find Top by Field", color:"#3a7a3a", cat:"Items",
    desc:"Returns the ref of the item with the highest (max) or lowest (min) field value in the array.",
    inputs:[{id:"items", label:"Items", type:"value.array"}],
    outputs:[{id:"v", label:"Item", type:"value.string"}],
    fields:[
      {key:"path", label:"Field", type:"path",   default:"system.quantity"},
      {key:"op",   label:"Pick",  type:"select", default:"max", options:["max","min"]}
    ],
    compile:(n,i)=>`{itemFindExtreme:${i.items ?? ""}|${n.data.path ?? ""}|${n.data.op ?? "max"}}`
  },

  act_use_slot_item: {
    title:"Use Slot Item", color:"#2a5a3a", cat:"Items",
    hidden:true, replacement:"act_use_item",
    desc:"Calls item.use() on the first item found in a slot by Slot ID. Search walks the source (this item / actor / wired Actor pin) and every nested item slot.",
    inputs:[
      {id:"exec",   label:"",        type:"exec"},
      {id:"slotId", label:"Slot ID", type:"value.string"},
      {id:"actor",  label:"Actor",   type:"value.actor"}
    ],
    outputs:[{id:"exec",label:"",type:"exec"}],
    fields:[
      {key:"slotId", label:"Slot ID", type:"text", default:"slot1", placeholder:"slot1"}
    ],
    isAction:true, wideNode:true,
    toAction:(n,inp)=>({
      type:   "useSlotItem",
      slotId: (inp.slotId != null && inp.slotId !== "") ? String(inp.slotId) : (n.data.slotId ?? "slot1"),
      index:  0,
      actorOverride: (inp.actor != null && inp.actor !== "" && inp.actor !== "0" && inp.actor !== `"0"`) ? inp.actor : null
    })
  },

  act_use_item: {
    title:"Use Item", color:"#2a5a3a", cat:"Items",
    keywords:"use slot item",
    desc:"Call item.use() on an owned item. Find by: item = by name / UUID / category; slot = first item found in a slot by Slot ID (walks nested slots; Slot ID / Actor pins supported). Replaces the old Use Slot Item node.",
    inputs:[
      {id:"exec",   label:"",        type:"exec"},
      {id:"slotId", label:"Slot ID", type:"value.string"},
      {id:"actor",  label:"Actor",   type:"value.actor"}
    ],
    outputs:[{id:"exec",label:"",type:"exec"}],
    fields:[
      {key:"findBy",   label:"Find by",       type:"select",      default:"item", options:["item","slot"]},
      {key:"itemName", label:"Item",          type:"item-picker", default:""},
      {key:"uuid",     label:"…or UUID",      type:"text",        default:"", placeholder:"drag item here"},
      {key:"category", label:"…or Category",  type:"text",        default:"", placeholder:"first item of category"},
      {key:"index",    label:"Category index",type:"number",      default:0},
      {key:"slotId",   label:"Slot ID (slot mode)", type:"text",  default:"slot1", placeholder:"slot1"}
    ],
    isAction:true, wideNode:true,
    toAction:(n,inp)=>{
      if (String(n.data?.findBy ?? "item") === "slot") {
        return {
          type:   "useSlotItem",
          slotId: (inp.slotId != null && inp.slotId !== "") ? String(inp.slotId) : (n.data.slotId ?? "slot1"),
          index:  0,
          actorOverride: (inp.actor != null && inp.actor !== "" && inp.actor !== "0" && inp.actor !== `"0"`) ? inp.actor : null
        };
      }
      return {type:"useItem", itemName:n.data.itemName??"", uuid:n.data.uuid??"", category:n.data.category??"", index:Number(n.data.index??0)};
    }
  },

  act_equip: {
    title:"Equip / Unequip Item", color:"#2a5a7a", cat:"Items",
    keywords:"equip unequip equipment",
    desc:"Equip or unequip an owned inventory item. Mode: equip runs the canEquip() requirements check (Force skips it, blocks on concentration conflict); unequip clears the equipped state. Replaces the old Unequip Item node.",
    inputs:[{id:"exec",label:"",type:"exec"}],
    outputs:[{id:"exec",label:"",type:"exec"}],
    fields:[
      {key:"mode",     label:"Mode",          type:"select",      default:"equip", options:["equip","unequip"]},
      {key:"itemName", label:"Item",          type:"item-picker", default:""},
      {key:"uuid",     label:"…or UUID",      type:"text",        default:"", placeholder:"drag item here"},
      {key:"category", label:"…or Category",  type:"text",        default:"", placeholder:"first item of category"},
      {key:"index",    label:"Category index",type:"number",      default:0},
      {key:"force",    label:"Force (skip canEquip)", type:"checkbox", default:false}
    ],
    isAction:true, wideNode:true,
    toAction:(n)=>({
      type: (String(n.data?.mode ?? "equip") === "unequip") ? "unequipItem" : "equipItem",
      itemName:n.data.itemName??"", uuid:n.data.uuid??"", category:n.data.category??"", index:Number(n.data.index??0), force:!!n.data.force
    })
  },

  act_unequip: {
    title:"Unequip Item", color:"#7a2a2a", cat:"Items",
    hidden:true, replacement:"act_equip",
    desc:"Mark an owned inventory item as unequipped.",
    inputs:[{id:"exec",label:"",type:"exec"}],
    outputs:[{id:"exec",label:"",type:"exec"}],
    fields:[
      {key:"itemName", label:"Item",          type:"item-picker", default:""},
      {key:"uuid",     label:"…or UUID",      type:"text",        default:"", placeholder:"drag item here"},
      {key:"category", label:"…or Category",  type:"text",        default:"", placeholder:"first item of category"},
      {key:"index",    label:"Category index",type:"number",      default:0}
    ],
    isAction:true, wideNode:true,
    toAction:(n)=>({type:"unequipItem", itemName:n.data.itemName??"", uuid:n.data.uuid??"", category:n.data.category??"", index:Number(n.data.index??0)})
  },

  act_modify_slot_item_field: {
    title:"Modify Slot Item Field", color:"#4a2a6a", cat:"Set Data",
    hidden:true, replacement:"act_modify_item_field",
    desc:"Add / subtract / set a field on the first item found in a slot. Searches the source (this item / actor / wired Actor pin) and every nested item slot at any depth until an item carrying the field path is found. Path / Op / Slot ID can be fed via pins (UE-style).",
    inputs:[
      {id:"exec",   label:"",        type:"exec"},
      {id:"amount", label:"Amount",  type:"value.number"},
      {id:"slotId", label:"Slot ID", type:"value.string"},
      {id:"path",   label:"Path",    type:"value.path"},
      {id:"op",     label:"Op",      type:"value.string"},
      {id:"actor",  label:"Actor",   type:"value.actor"}
    ],
    outputs:[{id:"exec",label:"",type:"exec"}],
    fields:[
      {key:"slotId", label:"Slot ID",   type:"text",   default:"slot1", placeholder:"slot1"},
      {key:"path",   label:"Field Path", type:"path",   default:"system.hiddenFields.field"},
      {key:"op",     label:"Operation",  type:"select", default:"add", options:["add","subtract","set"]}
    ],
    isAction:true, wideNode:true,
    toAction:(n,inp)=>({
      type:   "modifySlotItemField",
      slotId: (inp.slotId != null && inp.slotId !== "") ? String(inp.slotId) : (n.data.slotId ?? "slot1"),
      index:  0,
      path:   (inp.path   != null && inp.path   !== "") ? String(inp.path)   : (n.data.path ?? ""),
      op:     (inp.op     != null && inp.op     !== "") ? String(inp.op)     : (n.data.op   ?? "add"),
      amount: inp.amount ?? 0,
      actorOverride: (inp.actor != null && inp.actor !== "" && inp.actor !== "0" && inp.actor !== `"0"`) ? inp.actor : null
    })
  },

  act_modify_item_field: {
    title:"Modify Item Field", color:"#4a2a6a", cat:"Set Data",
    keywords:"modify inventory item field modify slot item field",
    desc:"Add / subtract / set a field on an item. Find by: uuid = specific item by UUID (pin or field; 'Search in' picks inventory and/or slot snapshots); name = actor-owned item by name; category = first actor-owned item of a category (+ index); slot = first item found in a slot by Slot ID (walks nested slots at any depth). Path / Op / Amount / Slot ID can all be driven by pins (UE-style). Wire the Actor pin to run the update on other actors (single UUID or array loops over each). Replaces the old Modify Inventory Item Field and Modify Slot Item Field nodes.",
    inputs:[
      {id:"exec",   label:"",       type:"exec"},
      {id:"uuid",   label:"Item UUID", type:"value.string"},
      {id:"slotId", label:"Slot ID", type:"value.string"},
      {id:"actor",  label:"Actor",  type:"value.actor"},
      {id:"amount", label:"Amount", type:"value.number"},
      {id:"path",   label:"Path",   type:"value.path"},
      {id:"op",     label:"Op",     type:"value.string"}
    ],
    outputs:[
      {id:"exec",    label:"",         type:"exec"},
      {id:"newValue",label:"New Value",type:"value.any"}
    ],
    fields:[
      {key:"findBy",   label:"Find by",    type:"select", default:"uuid", options:["uuid","name","category","slot"]},
      {key:"uuid",     label:"Item UUID",  type:"text",   default:"", placeholder:"Item.xxxxx or drag item here"},
      {key:"itemName", label:"Item (name mode)", type:"item-picker", default:""},
      {key:"category", label:"Category (category mode)", type:"text", default:"", placeholder:"first item of category"},
      {key:"index",    label:"Category index", type:"number", default:0},
      {key:"slotId",   label:"Slot ID (slot mode)", type:"text", default:"slot1", placeholder:"slot1"},
      {key:"path",     label:"Field Path", type:"path",   default:"system.hiddenFields.field"},
      {key:"op",       label:"Operation",  type:"select", default:"add", options:["add","subtract","set"]},
      {key:"searchIn", label:"Search in (uuid mode)",  type:"select", default:"inventory",
       options:["inventory","slot","slot_then_inventory","inventory_then_slot"]}
    ],
    isAction:true, wideNode:true,
    toAction:(n,inp)=>{
      const findBy   = String(n.data?.findBy ?? "uuid");
      const path     = (inp.path != null && inp.path !== "") ? String(inp.path) : (n.data.path ?? "");
      const op       = (inp.op   != null && inp.op   !== "") ? String(inp.op)   : (n.data.op   ?? "add");
      const amount   = inp.amount ?? 0;
      const hasActor = (inp.actor != null && inp.actor !== "" && inp.actor !== "0" && inp.actor !== `"0"`);
      if (findBy === "slot") {
        const out = {
          type:   "modifySlotItemField",
          slotId: (inp.slotId != null && inp.slotId !== "") ? String(inp.slotId) : (n.data.slotId ?? "slot1"),
          index:  0,
          path, op, amount
        };
        if (hasActor) out.actorOverride = inp.actor;
        return out;
      }
      if (findBy === "name" || findBy === "category") {
        const out = {
          type:     "modifyInvItemField",
          itemName: findBy === "name" ? (n.data.itemName ?? "") : "",
          uuid:     "",
          category: findBy === "category" ? (n.data.category ?? "") : "",
          index:    Number(n.data.index ?? 0),
          path, op, amount
        };
        if (hasActor) out.actorOverride = inp.actor;
        return out;
      }
      const out = {
        type:     "modifyItemField",
        uuid:     (inp.uuid != null && inp.uuid !== "") ? String(inp.uuid) : (n.data.uuid ?? ""),
        path, op, amount,
        searchIn: String(n.data?.searchIn ?? "inventory")
      };
      if (hasActor) out.actorOverride = inp.actor;
      return out;
    }
  },

  act_modify_inv_item_field: {
    title:"Modify Inventory Item Field", color:"#4a2a6a", cat:"Set Data",
    hidden:true, replacement:"act_modify_item_field",
    desc:"Add / subtract / set a field on an actor-owned item. Item is auto-indexed from actor inventory. Wire the Actor pin to look up the item on a different actor (UUID / Get Actor / Get All Targets — array loops over each actor). Path / Op can be fed via pins (UE-style).",
    inputs:[
      {id:"exec",  label:"",       type:"exec"},
      {id:"actor", label:"Actor",  type:"value.actor"},
      {id:"amount",label:"Amount", type:"value.number"},
      {id:"path",  label:"Path",   type:"value.path"},
      {id:"op",    label:"Op",     type:"value.string"}
    ],
    outputs:[{id:"exec",label:"",type:"exec"}],
    fields:[
      {key:"itemName", label:"Item",               type:"item-picker", default:""},
      {key:"uuid",     label:"…or UUID",           type:"text",        default:"", placeholder:"drag item here"},
      {key:"category", label:"…or Category+index", type:"text",        default:"", placeholder:"category name"},
      {key:"index",    label:"Category index",     type:"number",      default:0},
      {key:"path",     label:"Field Path",         type:"path",        default:"system.hiddenFields.field"},
      {key:"op",       label:"Operation",          type:"select",      default:"add", options:["add","subtract","set"]}
    ],
    isAction:true, wideNode:true,
    toAction:(n,inp)=>{
      const out = {
        type:"modifyInvItemField",
        itemName: n.data.itemName??"",
        uuid:     n.data.uuid??"",
        category: n.data.category??"",
        index:    Number(n.data.index??0),
        path:     (inp.path != null && inp.path !== "") ? String(inp.path) : (n.data.path??""),
        op:       (inp.op   != null && inp.op   !== "") ? String(inp.op)   : (n.data.op??"add"),
        amount:   inp.amount??0
      };
      if (inp.actor != null && inp.actor !== "" && inp.actor !== "0" && inp.actor !== `"0"`) {
        out.actorOverride = inp.actor;
      }
      return out;
    }
  },

  inv_item_field: {
    title:"Inventory Item Field", color:"#1a4060", cat:"Get Data",
    desc:"Read a field from an actor-owned item. Item is auto-indexed from actor inventory.",
    inputs:[], outputs:[{id:"v",label:"Value",type:"value.any"}],
    fields:[
      {key:"itemName", label:"Item",          type:"item-picker", default:""},
      {key:"uuid",     label:"…or UUID",      type:"text",        default:"", placeholder:"drag item here"},
      {key:"category", label:"…or Category",  type:"text",        default:"", placeholder:"first item of category"},
      {key:"index",    label:"Category index (0=first)", type:"number", default:0},
      {key:"path",     label:"Field Path",    type:"path",        default:"system.hiddenFields.field"}
    ],
    compile:(n)=>{
      if (n.data.uuid)     return `{item:id:${n.data.uuid}.${n.data.path??""}}`;
      if (n.data.itemName) return `{item:${n.data.itemName}.${n.data.path??""}}`;
      if (n.data.category) return `{invcat:${n.data.category}.${n.data.index??0}.${n.data.path??""}}`;
      return "0";
    }
  },

  slot_item_uuid: {
    title:"Slot Item UUID", color:"#1a4060", cat:"Get Data",
    desc:"UUID of the first item found in any slot named Slot ID. Search walks the source (this item / actor / wired Actor pin) and every nested item slot.",
    inputs:[
      {id:"slotId", label:"Slot ID", type:"value.string"},
      {id:"actor",  label:"Actor",   type:"value.actor"}
    ],
    outputs:[{id:"v",label:"UUID (str)",type:"value.uuid"}],
    fields:[
      {key:"slotId", label:"Slot ID", type:"text", default:"slot1", placeholder:"slot1"}
    ],
    compile:(n,i)=>{
      const sid  = (i.slotId != null && i.slotId !== "") ? String(i.slotId) : (n.data.slotId ?? "slot1");
      const base = (i.actor  != null && i.actor  !== "") ? String(i.actor)  : `"self"`;
      return `{slotUuidFind:${base}|${sid}}`;
    }
  },

  get_actor_slot_id: {
    title:"Get Actor Slot ID", color:"#1a4060", cat:"Get Data",
    desc:"Emit a slot ID as a string. Type the id in the field or connect a text pin to override.",
    inputs:[
      {id:"slotId", label:"Slot ID", type:"value.string"}
    ],
    outputs:[{id:"v",label:"Slot ID",type:"value.string"}],
    fields:[{key:"slotId",label:"Slot ID",type:"text",default:"slot1",placeholder:"slot1"}],
    compile:(n,i)=>{
      const sid = (i.slotId != null && i.slotId !== "") ? String(i.slotId) : (n.data.slotId ?? "slot1");
      const raw = sid.replace(/^"(.*)"$/, "$1");
      return JSON.stringify(raw);
    }
  },

  inv_item_slot_count: {
    title:"Inv Item Slot Count", color:"#1a4060", cat:"Get Data",
    desc:"Count of items in a slot. If Item is empty, totals every nested item slot named Slot ID on the source (this item / actor / wired Actor pin). Otherwise scoped to the referenced container.",
    inputs:[
      {id:"slotId", label:"Slot ID",  type:"value.string"},
      {id:"item",   label:"Item ref", type:"value.string"},
      {id:"actor",  label:"Actor",    type:"value.actor"}
    ],
    outputs:[{id:"v",label:"Count",type:"value.number"}],
    fields:[
      {key:"itemName", label:"Item name",          type:"text", default:"", placeholder:"container name (optional)"},
      {key:"uuid",     label:"…or UUID",           type:"text", default:"", placeholder:"Item.xxxxx"},
      {key:"slotId",   label:"Slot on that item",  type:"text", default:"slot1", placeholder:"slot1"}
    ],
    compile:(n,i)=>{
      const sid  = (i.slotId != null && i.slotId !== "") ? String(i.slotId) : (n.data.slotId ?? "slot1");
      const ref  = (i.item   != null && i.item   !== "") ? String(i.item)   : (n.data.uuid || n.data.itemName || "");
      const base = (i.actor  != null && i.actor  !== "") ? String(i.actor)  : `"self"`;
      return `{invItemSlotCountOn:${base}|${ref}|${sid}}`;
    }
  },

  act_remove_from_inv_item_slot: {
    title:"Remove from Inv Item Slot", color:"#6a2a2a", cat:"Items",
    desc:"Find a container item by name / UUID (or any container holding Slot ID when both are blank) and remove the first item from its slot. Source is this item / actor / wired Actor pin.",
    inputs:[
      {id:"exec",   label:"",        type:"exec"},
      {id:"slotId", label:"Slot ID", type:"value.string"},
      {id:"item",   label:"Item ref",type:"value.string"},
      {id:"actor",  label:"Actor",   type:"value.actor"}
    ],
    outputs:[
      {id:"exec",  label:"Done →", type:"exec"},
      {id:"empty", label:"Empty →",type:"exec"}
    ],
    fields:[
      {key:"itemName", label:"Container name", type:"text", default:"", placeholder:"container name (optional)"},
      {key:"uuid",     label:"…or UUID",       type:"text", default:"", placeholder:"Item.xxxxx"},
      {key:"slotId",   label:"Slot ID",        type:"text", default:"slot1", placeholder:"slot1"}
    ],
    isAction:true, wideNode:true,
    isRemoveFromInvSlot: true,
    toAction:(n,inp)=>({
      type:     "removeFromInvItemSlot",
      itemName: (inp.item != null && inp.item !== "") ? String(inp.item) : (n.data.itemName ?? ""),
      uuid:     n.data.uuid ?? "",
      slotId:   (inp.slotId != null && inp.slotId !== "") ? String(inp.slotId) : (n.data.slotId ?? "slot1"),
      index:    0,
      actorOverride: (inp.actor != null && inp.actor !== "" && inp.actor !== "0" && inp.actor !== `"0"`) ? inp.actor : null
    })
  },

  act_add_to_inv_item_slot: {
    title:"Add to Inv Item Slot", color:"#2a4a2a", cat:"Items",
    desc:"Find a container item by name / UUID (or any container holding Slot ID when both are blank) and add an inventory item into its slot. Source is this item / actor / wired Actor pin.",
    inputs:[
      {id:"exec",      label:"",        type:"exec"},
      {id:"slotId",    label:"Slot ID", type:"value.string"},
      {id:"parent",    label:"Container", type:"value.string"},
      {id:"itemUuid",  label:"Item UUID", type:"value.string"},
      {id:"actor",     label:"Actor",   type:"value.actor"}
    ],
    outputs:[{id:"exec",label:"Done →",type:"exec"},{id:"full",label:"Full →",type:"exec"}],
    fields:[
      {key:"parentName", label:"Container name", type:"text", default:"", placeholder:"container name (optional)"},
      {key:"parentUuid", label:"…or UUID",       type:"text", default:"", placeholder:"Item.xxxxx"},
      {key:"slotId",     label:"Slot ID",        type:"text", default:"slot1", placeholder:"slot1"},
      {key:"itemUuid",   label:"Item to add UUID", type:"text", default:"", placeholder:"Item.xxxxx"}
    ],
    isAction:true, wideNode:true,
    isAddToInvSlot: true,
    toAction:(n,inp)=>({
      type:       "addToInvItemSlot",
      parentName: (inp.parent != null && inp.parent !== "") ? String(inp.parent) : (n.data.parentName ?? ""),
      parentUuid: n.data.parentUuid ?? "",
      slotId:     (inp.slotId != null && inp.slotId !== "") ? String(inp.slotId) : (n.data.slotId ?? "slot1"),
      itemName:   n.data.itemName ?? "",
      itemUuid:   (inp.itemUuid != null && inp.itemUuid !== "") ? String(inp.itemUuid) : (n.data.itemUuid ?? ""),
      actorOverride: (inp.actor != null && inp.actor !== "" && inp.actor !== "0" && inp.actor !== `"0"`) ? inp.actor : null
    })
  },
  act_attack_check: {
    hidden:true, replacement:"act_roll_v2 + act_compare_roll + act_present_roll",
    title:"Attack Check", color:"#8a3a00", cat:"Dice & Rolls",
    desc:"Roll attack vs target AC. Branches into Hit / Miss / Crit exec paths and posts result to chat. Roll Result carries the raw dice total; Margin = total − AC. Crit / Fumble are external bool inputs — wire them from your own comparison logic (e.g. Compare against natural d20 from a Roll Value). Reroll button (yes/no) adds a Re-roll button to the chat card; Reroll Path / Reroll Cost optionally consume a numeric resource from the source actor each time the player rerolls.",
    inputs:[
      {id:"exec",          label:"",              type:"exec"},
      {id:"formula",       label:"Attack",         type:"value.string"},
      {id:"bonus",         label:"Bonus",          type:"value.number"},
      {id:"isCrit",        label:"Is Crit?",       type:"value.bool"},
      {id:"isFumble",      label:"Is Fumble?",     type:"value.bool"},
      {id:"rerollEnabled", label:"Reroll button",  type:"value.bool"},
      {id:"rerollPath",    label:"Reroll Path",    type:"value.path"},
      {id:"rerollCost",    label:"Reroll Cost",    type:"value.number"}
    ],
    outputs:[
      {id:"hit",         label:"Hit →",      type:"exec"},
      {id:"miss",        label:"Miss →",     type:"exec"},
      {id:"crit",        label:"Crit →",     type:"exec"},
      {id:"result",      label:"Roll Result",type:"value.number"},
      {id:"margin",      label:"Margin",     type:"value.number"},
      {id:"formula",     label:"Formula",    type:"value.string"},
      {id:"min",         label:"Min",        type:"value.number"},
      {id:"max",         label:"Max",        type:"value.number"},
      {id:"avg",         label:"Avg",        type:"value.number"},
      {id:"natural",     label:"Natural",    type:"value.number"},
      {id:"isCrit",      label:"Is Crit",    type:"value.bool"},
      {id:"isFumble",    label:"Is Fumble",  type:"value.bool"},
      {id:"diceArray",   label:"Dice Array", type:"value.array"}
    ],
    fields:[
      {key:"formula",       label:"Roll",                  type:"text",   default:"1d20"},
      {key:"bonus",         label:"Bonus",                 type:"text",   default:"0"},
      {key:"acPath",        label:"AC path",               type:"path",   default:"system.attributes.ac.value"},
      {key:"flavor",        label:"Label",                 type:"text",   default:"Attack"},
      {key:"rerollEnabled", label:"Reroll button",        type:"select", default:"no", options:["no","yes"]},
      {key:"rerollPath",    label:"Reroll resource path",  type:"path",   default:"",   placeholder:"e.g. system.resources.luck.value"},
      {key:"rerollCost",    label:"Reroll cost",           type:"number", default:1}
    ],
    isAttackBranch: true,
    toAction:(n,inp)=>{
      const _rrRaw = (inp.rerollEnabled != null && inp.rerollEnabled !== "") ? inp.rerollEnabled : n.data.rerollEnabled;
      const rerollEnabled = (_rrRaw === true || _rrRaw === "yes" || _rrRaw === 1 || _rrRaw === "1") ? "yes" : "no";
      return {
        type:      "attackCheck",
        formula:   inp.formula ?? n.data.formula ?? "1d20",
        bonus:     inp.bonus   ?? n.data.bonus   ?? "0",
        acPath:    n.data.acPath  ?? "system.attributes.ac.value",
        flavor:    n.data.flavor  ?? "Attack",
        rerollEnabled,
        rerollPath: (inp.rerollPath != null && inp.rerollPath !== "") ? String(inp.rerollPath) : (n.data.rerollPath ?? ""),
        rerollCost: Number((inp.rerollCost != null && inp.rerollCost !== "") ? inp.rerollCost : (n.data.rerollCost ?? 1)) || 0,
        isCrit:    (inp.isCrit   != null && inp.isCrit   !== "") ? inp.isCrit   : null,
        isFumble:  (inp.isFumble != null && inp.isFumble !== "") ? inp.isFumble : null
      };
    }
  },

  act_roll_check: {
    hidden:true, replacement:"act_roll_v2 + act_compare_roll + act_present_roll",
    title:"Roll Check", color:"#8a4400", cat:"Dice & Rolls",
    desc:"Generic roll with a chosen comparison rule: roll_over (roll ≥ DC), roll_under (≤ DC), meet_and_beat (> DC, tie = fail), troika (success when roll is higher OR lower than target, depending on targetRule), custom (your own condition via {roll}/{dc}/{margin}). Branches into pass/fail and returns Roll / Margin. opposed:yes — after the initiator rolls, N 'Roll as Opponent' buttons appear in chat; the higher total wins (tie goes to the initiator). Crit / Fumble are external bool inputs — wire them from your own comparison logic. Reroll button (yes/no) adds a Re-roll button to the chat card; Reroll Path / Reroll Cost optionally consume a numeric resource from the source actor each time the player rerolls.",
    inputs:[
      {id:"exec",           label:"",           type:"exec"},
      {id:"formula",        label:"Formula",    type:"value.string"},
      {id:"dc",             label:"DC",          type:"value.number"},
      {id:"modifier",       label:"Modifier",    type:"value.number"},
      {id:"advFormula",     label:"Adv Formula", type:"value.string"},
      {id:"disFormula",     label:"Dis Formula", type:"value.string"},
      {id:"isCrit",         label:"Is Crit?",    type:"value.bool"},
      {id:"isFumble",       label:"Is Fumble?",  type:"value.bool"},
      {id:"opposedCount",   label:"Opposed N",   type:"value.number"},
      {id:"opposedFormula", label:"Opposed Formula", type:"value.string"},
      {id:"rerollEnabled",  label:"Reroll button",  type:"value.bool"},
      {id:"rerollPath",     label:"Reroll Path",    type:"value.path"},
      {id:"rerollCost",     label:"Reroll Cost",    type:"value.number"}
    ],
    outputs:[
      {id:"pass",        label:"Pass →",    type:"exec"},
      {id:"fail",        label:"Fail →",    type:"exec"},
      {id:"result",      label:"Roll",      type:"value.number"},
      {id:"margin",      label:"Margin",    type:"value.number"},
      {id:"youWon",      label:"You Won →", type:"exec"},
      {id:"youLost",     label:"You Lost →",type:"exec"},
      {id:"winnerRoll",  label:"Winner Roll", type:"value.number"},
      {id:"formula",     label:"Formula",    type:"value.string"},
      {id:"min",         label:"Min",        type:"value.number"},
      {id:"max",         label:"Max",        type:"value.number"},
      {id:"avg",         label:"Avg",        type:"value.number"},
      {id:"natural",     label:"Natural",    type:"value.number"},
      {id:"isCrit",      label:"Is Crit",    type:"value.bool"},
      {id:"isFumble",    label:"Is Fumble",  type:"value.bool"},
      {id:"diceArray",   label:"Dice Array", type:"value.array"}
    ],
    fields:[
      {key:"formula",        label:"Roll",      type:"text",   default:"1d20"},
      {key:"dc",             label:"DC",        type:"text",   default:"10"},
      {key:"modifier",       label:"Modifier",  type:"text",   default:"0"},
      {key:"mode",           label:"Rule",      type:"select", default:"roll_over",
        options:["roll_over","roll_under","meet_and_beat","troika","custom"]},
      {key:"custom",         label:"Custom cond (mode=custom)", type:"text", default:"{roll} >= {dc}",
        placeholder:"e.g. {roll} > {dc} && {roll} < 20"},
      {key:"flavor",         label:"Label",     type:"text",   default:"Check"},
      {key:"toChat",         label:"To chat",   type:"select", default:"yes", options:["yes","no"]},
      {key:"howRoll",        label:"How to roll",type:"select",default:"auto", options:["auto","chat_button"]},
      {key:"chatTimeout",    label:"Chat timeout (sec, 0=в€ћ)", type:"number", default:0},
      {key:"rollDialogue",   label:"Roll dialog",   type:"select", default:"no", options:["no","yes"]},
      {key:"opposed",        label:"Opposed",   type:"select", default:"no", options:["no","yes"]},
      {key:"opposedCount",   label:"Opposed N", type:"text",   default:"1"},
      {key:"opposedFormula", label:"Opposed Formula", type:"text", default:"1d20"},
      {key:"rerollEnabled",  label:"Reroll button",  type:"select", default:"no", options:["no","yes"]},
      {key:"rerollPath",     label:"Reroll resource path", type:"path", default:"", placeholder:"e.g. system.resources.luck.value"},
      {key:"rerollCost",     label:"Reroll cost",    type:"number", default:1}
    ],
    isSaveBranch:true,
    toAction:(n,inp)=>{
      const _rrRaw = (inp.rerollEnabled != null && inp.rerollEnabled !== "") ? inp.rerollEnabled : n.data.rerollEnabled;
      const rerollEnabled = (_rrRaw === true || _rrRaw === "yes" || _rrRaw === 1 || _rrRaw === "1") ? "yes" : "no";
      return {
        type:       "rollCheck",
        formula:    inp.formula   ?? n.data.formula   ?? "1d20",
        dc:         inp.dc        ?? n.data.dc        ?? "10",
        modifier:   inp.modifier  ?? n.data.modifier  ?? "0",
        advFormula: inp.advFormula ?? "",
        disFormula: inp.disFormula ?? "",
        mode:       n.data.mode   ?? "roll_over",
        custom:     n.data.custom ?? "{roll} >= {dc}",
        flavor:     n.data.flavor ?? "Check",
        toChat:     n.data.toChat !== "no",
        howRoll:    n.data.howRoll ?? "auto",
        chatTimeout: Number(n.data.chatTimeout ?? 0),
        rollDialogue: n.data.rollDialogue === "yes",
        opposed:       n.data.opposed === "yes",
        opposedCount:  inp.opposedCount   ?? n.data.opposedCount   ?? "1",
        opposedFormula: inp.opposedFormula ?? n.data.opposedFormula ?? "1d20",
        rerollEnabled,
        rerollPath: (inp.rerollPath != null && inp.rerollPath !== "") ? String(inp.rerollPath) : (n.data.rerollPath ?? ""),
        rerollCost: Number((inp.rerollCost != null && inp.rerollCost !== "") ? inp.rerollCost : (n.data.rerollCost ?? 1)) || 0,
        isCrit:    (inp.isCrit   != null && inp.isCrit   !== "") ? inp.isCrit   : null,
        isFumble:  (inp.isFumble != null && inp.isFumble !== "") ? inp.isFumble : null
      };
    }
  },

  act_tiered_roll: {
    hidden:true, replacement:"act_roll_v2 + chained act_compare_roll",
    title:"Tiered Roll", color:"#8a4400", cat:"Dice & Rolls",
    desc:"Rolls dice and routes exec into one of 4 tiers by thresholds. PbtA 2d6 example: T1 ≤6 (miss), T2 7-9 (partial), T3 10+ (full). Blades example: T1 crit fail, T2 partial, T3 full, T4 crit. Thresholds are arbitrary lower-bounds (inclusive). If result ≥ threshold of a tier, it takes that tier (top-down). Raw result is emitted on Roll. Crit / Fumble are external bool inputs — wire them from your own comparison logic. Reroll button (yes/no) adds a Re-roll button to the chat card; Reroll Path / Reroll Cost optionally consume a numeric resource from the source actor each time the player rerolls.",
    wideNode:true,
    inputs:[
      {id:"exec",          label:"",              type:"exec"},
      {id:"formula",       label:"Formula",        type:"value.string"},
      {id:"isCrit",        label:"Is Crit?",       type:"value.bool"},
      {id:"isFumble",      label:"Is Fumble?",     type:"value.bool"},
      {id:"rerollEnabled", label:"Reroll button",  type:"value.bool"},
      {id:"rerollPath",    label:"Reroll Path",    type:"value.path"},
      {id:"rerollCost",    label:"Reroll Cost",    type:"value.number"}
    ],
    outputs:[
      {id:"tier0",       label:"Tier 1 →", type:"exec"},
      {id:"tier1",       label:"Tier 2 →", type:"exec"},
      {id:"tier2",       label:"Tier 3 →", type:"exec"},
      {id:"tier3",       label:"Tier 4 →", type:"exec"},
      {id:"result",      label:"Roll",     type:"value.number"},
      {id:"formula",     label:"Formula",  type:"value.string"},
      {id:"min",         label:"Min",      type:"value.number"},
      {id:"max",         label:"Max",      type:"value.number"},
      {id:"avg",         label:"Avg",      type:"value.number"},
      {id:"natural",     label:"Natural",  type:"value.number"},
      {id:"isCrit",      label:"Is Crit",  type:"value.bool"},
      {id:"isFumble",    label:"Is Fumble",type:"value.bool"},
      {id:"diceArray",   label:"Dice Array",type:"value.array"}
    ],
    fields:[
      {key:"formula",  label:"Roll",          type:"text",   default:"2d6"},
      {key:"t1Label",  label:"Tier 1 label",  type:"text",   default:"Miss"},
      {key:"t1Min",    label:"Tier 1 ≥",      type:"text",   default:"-999"},
      {key:"t2Label",  label:"Tier 2 label",  type:"text",   default:"Partial"},
      {key:"t2Min",    label:"Tier 2 ≥",      type:"text",   default:"7"},
      {key:"t3Label",  label:"Tier 3 label",  type:"text",   default:"Full"},
      {key:"t3Min",    label:"Tier 3 ≥",      type:"text",   default:"10"},
      {key:"t4Label",  label:"Tier 4 label",  type:"text",   default:"Crit"},
      {key:"t4Min",    label:"Tier 4 ≥",      type:"text",   default:"12"},
      {key:"flavor",   label:"Label",         type:"text",   default:"Roll"},
      {key:"toChat",   label:"To chat",       type:"select", default:"yes", options:["yes","no"]},
      {key:"rerollEnabled", label:"Reroll button",  type:"select", default:"no", options:["no","yes"]},
      {key:"rerollPath",    label:"Reroll resource path", type:"path", default:"", placeholder:"e.g. system.resources.luck.value"},
      {key:"rerollCost",    label:"Reroll cost",  type:"number", default:1}
    ],
    isTieredBranch:true,
    toAction:(n,inp)=>{
      const _rrRaw = (inp.rerollEnabled != null && inp.rerollEnabled !== "") ? inp.rerollEnabled : n.data.rerollEnabled;
      const rerollEnabled = (_rrRaw === true || _rrRaw === "yes" || _rrRaw === 1 || _rrRaw === "1") ? "yes" : "no";
      return {
        type:    "tieredRoll",
        formula: inp.formula ?? n.data.formula ?? "2d6",
        tiers: [
          { min:n.data.t1Min ?? "-999", label:n.data.t1Label ?? "Tier 1" },
          { min:n.data.t2Min ?? "7",    label:n.data.t2Label ?? "Tier 2" },
          { min:n.data.t3Min ?? "10",   label:n.data.t3Label ?? "Tier 3" },
          { min:n.data.t4Min ?? "12",   label:n.data.t4Label ?? "Tier 4" }
        ],
        flavor: n.data.flavor ?? "Roll",
        toChat: n.data.toChat !== "no",
        rerollEnabled,
        rerollPath: (inp.rerollPath != null && inp.rerollPath !== "") ? String(inp.rerollPath) : (n.data.rerollPath ?? ""),
        rerollCost: Number((inp.rerollCost != null && inp.rerollCost !== "") ? inp.rerollCost : (n.data.rerollCost ?? 1)) || 0,
        isCrit:    (inp.isCrit   != null && inp.isCrit   !== "") ? inp.isCrit   : null,
        isFumble:  (inp.isFumble != null && inp.isFumble !== "") ? inp.isFumble : null
      };
    }
  },

  act_dice_pool: {
    hidden:true, replacement:"act_roll_v2 (pool mode) + act_compare_roll",
    title:"Dice Pool", color:"#8a4400", cat:"Dice & Rolls",
    desc:"Rolls N dice of a chosen size and counts successes by comparison rule. Outputs: pass/fail based on `required`, Successes, Botches, Raw. WoD example: count=5, die=10, target=8, compare=ge → count d10s that rolled ≥8. Botches = how many d10s equalled botchFace. Crit / Fumble are external bool inputs — wire them from your own comparison logic. Reroll button (yes/no) adds a Re-roll button to the chat card; Reroll Path / Reroll Cost optionally consume a numeric resource from the source actor each time the player rerolls.",
    inputs:[
      {id:"exec",          label:"",              type:"exec"},
      {id:"count",         label:"Count",          type:"value.number"},
      {id:"target",        label:"Target",         type:"value.actor"},
      {id:"isCrit",        label:"Is Crit?",       type:"value.bool"},
      {id:"isFumble",      label:"Is Fumble?",     type:"value.bool"},
      {id:"rerollEnabled", label:"Reroll button",  type:"value.bool"},
      {id:"rerollPath",    label:"Reroll Path",    type:"value.path"},
      {id:"rerollCost",    label:"Reroll Cost",    type:"value.number"}
    ],
    outputs:[
      {id:"pass",        label:"Pass →",      type:"exec"},
      {id:"fail",        label:"Fail →",      type:"exec"},
      {id:"successes",   label:"Successes",   type:"value.number"},
      {id:"botches",     label:"Botches",     type:"value.number"},
      {id:"result",      label:"Total",       type:"value.any"},
      {id:"formula",     label:"Formula",     type:"value.string"},
      {id:"min",         label:"Min",         type:"value.number"},
      {id:"max",         label:"Max",         type:"value.number"},
      {id:"avg",         label:"Avg",         type:"value.number"},
      {id:"natural",     label:"Natural",     type:"value.number"},
      {id:"isCrit",      label:"Is Crit",     type:"value.bool"},
      {id:"isFumble",    label:"Is Fumble",   type:"value.bool"},
      {id:"diceArray",   label:"Dice Array",  type:"value.array"}
    ],
    fields:[
      {key:"count",     label:"Count",       type:"text",   default:"5"},
      {key:"die",       label:"Die faces",   type:"number", default:10},
      {key:"target",    label:"Target",      type:"text",   default:"8"},
      {key:"compare",   label:"Compare",     type:"select", default:"ge",  options:["ge","le","eq"]},
      {key:"required",  label:"Pass if ≥",    type:"number", default:1},
      {key:"botchFace", label:"Botch on face",type:"number", default:1},
      {key:"flavor",    label:"Label",       type:"text",   default:"Dice Pool"},
      {key:"toChat",    label:"To chat",     type:"select", default:"yes", options:["yes","no"]},
      {key:"rerollEnabled", label:"Reroll button",  type:"select", default:"no", options:["no","yes"]},
      {key:"rerollPath",    label:"Reroll resource path", type:"path", default:"", placeholder:"e.g. system.resources.luck.value"},
      {key:"rerollCost",    label:"Reroll cost",  type:"number", default:1}
    ],
    isSaveBranch:true,
    toAction:(n,inp)=>{
      const _rrRaw = (inp.rerollEnabled != null && inp.rerollEnabled !== "") ? inp.rerollEnabled : n.data.rerollEnabled;
      const rerollEnabled = (_rrRaw === true || _rrRaw === "yes" || _rrRaw === 1 || _rrRaw === "1") ? "yes" : "no";
      return {
        type:      "dicePool",
        count:     inp.count  ?? n.data.count  ?? "5",
        die:       Number(n.data.die ?? 10),
        target:    inp.target ?? n.data.target ?? "8",
        compare:   n.data.compare ?? "ge",
        required:  Number(n.data.required ?? 1),
        botchFace: Number(n.data.botchFace ?? 1),
        flavor:    n.data.flavor ?? "Dice Pool",
        toChat:    n.data.toChat !== "no",
        rerollEnabled,
        rerollPath: (inp.rerollPath != null && inp.rerollPath !== "") ? String(inp.rerollPath) : (n.data.rerollPath ?? ""),
        rerollCost: Number((inp.rerollCost != null && inp.rerollCost !== "") ? inp.rerollCost : (n.data.rerollCost ?? 1)) || 0,
        isCrit:    (inp.isCrit   != null && inp.isCrit   !== "") ? inp.isCrit   : null,
        isFumble:  (inp.isFumble != null && inp.isFumble !== "") ? inp.isFumble : null
      };
    }
  },

  act_spend_token: {
    title:"Spend Token", color:"#4a2a6a", cat:"Resources",
    desc:"Spends N tokens from the given resource. If there aren't enough tokens, exec takes the Empty branch. Works like Consume Resource but with branching. Where / Path / Label can be fed via pins (UE-style — when wired the matching field hides).",
    inputs:[
      {id:"exec",   label:"",       type:"exec"},
      {id:"amount", label:"Amount", type:"value.number"},
      {id:"where",  label:"Where",  type:"value.string"},
      {id:"path",   label:"Path",   type:"value.path"},
      {id:"flavor", label:"Label",  type:"value.string"}
    ],
    outputs:[
      {id:"ok",       label:"Spent →",   type:"exec"},
      {id:"empty",    label:"Empty →",   type:"exec"},
      {id:"remaining",label:"Remaining", type:"value.number"}
    ],
    fields:[
      {key:"where", label:"Where",    type:"select", default:"self",  options:["self","actor","token_target"]},
      {key:"path",  label:"Token path",type:"path",  default:"system.resources.tokens.value"},
      {key:"amount",label:"Default",  type:"number", default:1},
      {key:"flavor",label:"Label",    type:"text",   default:"Spend Token"}
    ],
    isConsumeSlot:true,
    toAction:(n,inp)=>({
      type:   "spendToken",
      amount: inp.amount ?? n.data.amount ?? 1,
      where:  (inp.where  != null && inp.where  !== "") ? String(inp.where)  : (n.data.where  ?? "self"),
      path:   (inp.path   != null && inp.path   !== "") ? String(inp.path)   : (n.data.path   ?? "system.resources.tokens.value"),
      flavor: (inp.flavor != null && inp.flavor !== "") ? String(inp.flavor) : (n.data.flavor ?? "Spend Token")
    })
  },

  act_gain_token: {
    title:"Gain Token", color:"#2a5a4a", cat:"Resources",
    desc:"Adds N tokens to the resource. Handy for FATE points / Drama dice / stress. Where / Path / Label can be fed via pins (UE-style).",
    inputs:[
      {id:"exec",   label:"",       type:"exec"},
      {id:"amount", label:"Amount", type:"value.number"},
      {id:"where",  label:"Where",  type:"value.string"},
      {id:"path",   label:"Path",   type:"value.path"},
      {id:"flavor", label:"Label",  type:"value.string"}
    ],
    outputs:[{id:"exec",label:"",type:"exec"},{id:"newValue",label:"New Value",type:"value.any"}],
    fields:[
      {key:"where", label:"Where",    type:"select", default:"self", options:["self","actor","token_target"]},
      {key:"path",  label:"Token path",type:"path",  default:"system.resources.tokens.value"},
      {key:"amount",label:"Default",  type:"number", default:1},
      {key:"flavor",label:"Label",    type:"text",   default:"Gain Token"}
    ],
    isAction:true,
    toAction:(n,inp)=>({
      type:   "gainToken",
      amount: inp.amount ?? n.data.amount ?? 1,
      where:  (inp.where  != null && inp.where  !== "") ? String(inp.where)  : (n.data.where  ?? "self"),
      path:   (inp.path   != null && inp.path   !== "") ? String(inp.path)   : (n.data.path   ?? "system.resources.tokens.value"),
      flavor: (inp.flavor != null && inp.flavor !== "") ? String(inp.flavor) : (n.data.flavor ?? "Gain Token")
    })
  },

  get_token_count: {
    title:"Get Token Count", color:"#1a4060", cat:"Get Data",
    desc:"Pure source node: reads the current token count at the given resource path.",
    inputs:[], outputs:[{id:"v",label:"Count",type:"value.number"}],
    fields:[
      {key:"where",label:"Where",    type:"select",default:"self",options:["self","actor","token_target"]},
      {key:"path", label:"Token path",type:"path", default:"system.resources.tokens.value"}
    ],
    compile:(n)=>{
      const pfx = n.data.where === "token_target" ? "target." : n.data.where === "actor" ? "actor." : "";
      return `{${pfx}${n.data.path ?? "system.resources.tokens.value"}}`;
    }
  },

  act_progression: {
    hidden:true, replacement:"act_roll_v2 + Get Path + act_compare_roll + Set Path",
    title:"Progression Roll", color:"#8a4400", cat:"Dice & Rolls",
    desc:"Catches a fresh roll, compares with the previous value stored at History Path, and branches on Higher / Lower / Equal / No History. Writes the new roll back into History Path so next call compares against it. Useful for escalating dice, PbtA session clocks, 'raise / see' mechanics, etc. Crit / Fumble are external bool inputs — wire them from your own comparison logic. Reroll button (yes/no) adds a Re-roll button to the chat card; Reroll Path / Reroll Cost optionally consume a numeric resource from the source actor each time the player rerolls.",
    wideNode:true,
    inputs:[
      {id:"exec",          label:"",              type:"exec"},
      {id:"formula",       label:"Formula",        type:"value.string"},
      {id:"historyPath",   label:"History Path",   type:"value.path"},
      {id:"isCrit",        label:"Is Crit?",       type:"value.bool"},
      {id:"isFumble",      label:"Is Fumble?",     type:"value.bool"},
      {id:"rerollEnabled", label:"Reroll button",  type:"value.bool"},
      {id:"rerollPath",    label:"Reroll Path",    type:"value.path"},
      {id:"rerollCost",    label:"Reroll Cost",    type:"value.number"}
    ],
    outputs:[
      {id:"higher",      label:"Higher →",  type:"exec"},
      {id:"lower",       label:"Lower →",   type:"exec"},
      {id:"equal",       label:"Equal →",   type:"exec"},
      {id:"noHistory",   label:"First →",   type:"exec"},
      {id:"value",       label:"Value",     type:"value.any"},
      {id:"previous",    label:"Previous",  type:"value.any"},
      {id:"formula",     label:"Formula",   type:"value.string"},
      {id:"min",         label:"Min",       type:"value.number"},
      {id:"max",         label:"Max",       type:"value.number"},
      {id:"avg",         label:"Avg",       type:"value.number"},
      {id:"natural",     label:"Natural",   type:"value.number"},
      {id:"isCrit",      label:"Is Crit",   type:"value.bool"},
      {id:"isFumble",    label:"Is Fumble", type:"value.bool"},
      {id:"diceArray",   label:"Dice Array",type:"value.array"}
    ],
    fields:[
      {key:"formula",     label:"Formula",          type:"text", default:"1d6"},
      {key:"historyPath", label:"History Path",     type:"path", default:"system.flags.progressionDie"},
      {key:"flavor",      label:"Flavor",           type:"text", default:"Progression"},
      {key:"toChat",      label:"Post to chat",     type:"select", default:"yes", options:["yes","no"]},
      {key:"rerollEnabled", label:"Reroll button",  type:"select", default:"no", options:["no","yes"]},
      {key:"rerollPath",    label:"Reroll resource path", type:"path", default:"", placeholder:"e.g. system.resources.luck.value"},
      {key:"rerollCost",    label:"Reroll cost",  type:"number", default:1}
    ],
    isProgressionBranch:true,
    toAction:(n,inp)=>{
      const _rrRaw = (inp.rerollEnabled != null && inp.rerollEnabled !== "") ? inp.rerollEnabled : n.data.rerollEnabled;
      const rerollEnabled = (_rrRaw === true || _rrRaw === "yes" || _rrRaw === 1 || _rrRaw === "1") ? "yes" : "no";
      return {
        type:        "progression",
        formula:     inp.formula     ?? n.data.formula     ?? "1d6",
        historyPath: inp.historyPath ?? n.data.historyPath ?? "system.flags.progressionDie",
        flavor:      n.data.flavor   ?? "Progression",
        toChat:      n.data.toChat   !== "no",
        rerollEnabled,
        rerollPath: (inp.rerollPath != null && inp.rerollPath !== "") ? String(inp.rerollPath) : (n.data.rerollPath ?? ""),
        rerollCost: Number((inp.rerollCost != null && inp.rerollCost !== "") ? inp.rerollCost : (n.data.rerollCost ?? 1)) || 0,
        isCrit:    (inp.isCrit   != null && inp.isCrit   !== "") ? inp.isCrit   : null,
        isFumble:  (inp.isFumble != null && inp.isFumble !== "") ? inp.isFumble : null
      };
    }
  },

  act_throw_on_canvas: {
    hidden:true, replacement:"act_roll_v2 + act_present_roll",
    title:"Throw on Canvas", color:"#8a4400", cat:"Dice & Rolls",
    desc:"Rolls N dice and visually scatters them on the canvas (PIXI overlay on the active scene). Results are available as successes/total and via {__lastSuccesses}/{__lastRoll}. Crit / Fumble are external bool inputs — wire them from your own comparison logic. Reroll button (yes/no) adds a Re-roll button to the chat card; Reroll Path / Reroll Cost optionally consume a numeric resource from the source actor each time the player rerolls.",
    inputs:[
      {id:"exec",          label:"",              type:"exec"},
      {id:"count",         label:"Count",          type:"value.number"},
      {id:"target",        label:"Target",         type:"value.actor"},
      {id:"isCrit",        label:"Is Crit?",       type:"value.bool"},
      {id:"isFumble",      label:"Is Fumble?",     type:"value.bool"},
      {id:"rerollEnabled", label:"Reroll button",  type:"value.bool"},
      {id:"rerollPath",    label:"Reroll Path",    type:"value.path"},
      {id:"rerollCost",    label:"Reroll Cost",    type:"value.number"}
    ],
    outputs:[
      {id:"pass",        label:"Pass →",     type:"exec"},
      {id:"fail",        label:"Fail →",     type:"exec"},
      {id:"successes",   label:"Successes",  type:"value.number"},
      {id:"total",       label:"Total",      type:"value.number"},
      {id:"formula",     label:"Formula",    type:"value.string"},
      {id:"min",         label:"Min",        type:"value.number"},
      {id:"max",         label:"Max",        type:"value.number"},
      {id:"avg",         label:"Avg",        type:"value.number"},
      {id:"natural",     label:"Natural",    type:"value.number"},
      {id:"isCrit",      label:"Is Crit",    type:"value.bool"},
      {id:"isFumble",    label:"Is Fumble",  type:"value.bool"},
      {id:"diceArray",   label:"Dice Array", type:"value.array"}
    ],
    fields:[
      {key:"count",    label:"Count",      type:"text",   default:"3"},
      {key:"die",      label:"Die faces",  type:"number", default:6},
      {key:"target",   label:"Target",     type:"text",   default:"4"},
      {key:"compare",  label:"Compare",    type:"select", default:"ge", options:["ge","le","eq"]},
      {key:"required", label:"Pass if ≥",   type:"number", default:1},
      {key:"area",     label:"Area (px)",  type:"number", default:300},
      {key:"duration", label:"Duration (s)",type:"number", default:6},
      {key:"flavor",   label:"Label",      type:"text",   default:"Throw"},
      {key:"toChat",   label:"To chat",      type:"select", default:"yes", options:["yes","no"]},
      {key:"rerollEnabled", label:"Reroll button",  type:"select", default:"no", options:["no","yes"]},
      {key:"rerollPath",    label:"Reroll resource path", type:"path", default:"", placeholder:"e.g. system.resources.luck.value"},
      {key:"rerollCost",    label:"Reroll cost",  type:"number", default:1}
    ],
    isSaveBranch:true,
    toAction:(n,inp)=>{
      const _rrRaw = (inp.rerollEnabled != null && inp.rerollEnabled !== "") ? inp.rerollEnabled : n.data.rerollEnabled;
      const rerollEnabled = (_rrRaw === true || _rrRaw === "yes" || _rrRaw === 1 || _rrRaw === "1") ? "yes" : "no";
      return {
        type:     "throwOnCanvas",
        count:    inp.count  ?? n.data.count  ?? "3",
        die:      Number(n.data.die ?? 6),
        target:   inp.target ?? n.data.target ?? "4",
        compare:  n.data.compare ?? "ge",
        required: Number(n.data.required ?? 1),
        area:     Number(n.data.area ?? 300),
        duration: Number(n.data.duration ?? 6),
        flavor:   n.data.flavor ?? "Throw",
        toChat:   n.data.toChat !== "no",
        rerollEnabled,
        rerollPath: (inp.rerollPath != null && inp.rerollPath !== "") ? String(inp.rerollPath) : (n.data.rerollPath ?? ""),
        rerollCost: Number((inp.rerollCost != null && inp.rerollCost !== "") ? inp.rerollCost : (n.data.rerollCost ?? 1)) || 0,
        isCrit:    (inp.isCrit   != null && inp.isCrit   !== "") ? inp.isCrit   : null,
        isFumble:  (inp.isFumble != null && inp.isFumble !== "") ? inp.isFumble : null
      };
    }
  },

  act_throw_on_sheet: {
    hidden:true, replacement:"act_roll_v2 + act_present_roll",
    title:"Throw on Sheet", color:"#8a4400", cat:"Dice & Rolls",
    desc:"Rolls N dice and visually scatters them over the DOM of the current actor sheet. Results are available as successes/total and via {__lastSuccesses}/{__lastRoll}. Crit / Fumble are external bool inputs — wire them from your own comparison logic. Reroll button (yes/no) adds a Re-roll button to the chat card; Reroll Path / Reroll Cost optionally consume a numeric resource from the source actor each time the player rerolls.",
    inputs:[
      {id:"exec",          label:"",              type:"exec"},
      {id:"count",         label:"Count",          type:"value.number"},
      {id:"target",        label:"Target",         type:"value.actor"},
      {id:"isCrit",        label:"Is Crit?",       type:"value.bool"},
      {id:"isFumble",      label:"Is Fumble?",     type:"value.bool"},
      {id:"rerollEnabled", label:"Reroll button",  type:"value.bool"},
      {id:"rerollPath",    label:"Reroll Path",    type:"value.path"},
      {id:"rerollCost",    label:"Reroll Cost",    type:"value.number"}
    ],
    outputs:[
      {id:"pass",        label:"Pass →",     type:"exec"},
      {id:"fail",        label:"Fail →",     type:"exec"},
      {id:"successes",   label:"Successes",  type:"value.number"},
      {id:"total",       label:"Total",      type:"value.number"},
      {id:"formula",     label:"Formula",    type:"value.string"},
      {id:"min",         label:"Min",        type:"value.number"},
      {id:"max",         label:"Max",        type:"value.number"},
      {id:"avg",         label:"Avg",        type:"value.number"},
      {id:"natural",     label:"Natural",    type:"value.number"},
      {id:"isCrit",      label:"Is Crit",    type:"value.bool"},
      {id:"isFumble",    label:"Is Fumble",  type:"value.bool"},
      {id:"diceArray",   label:"Dice Array", type:"value.array"}
    ],
    fields:[
      {key:"count",    label:"Count",      type:"text",   default:"3"},
      {key:"die",      label:"Die faces",  type:"number", default:6},
      {key:"target",   label:"Target",     type:"text",   default:"4"},
      {key:"compare",  label:"Compare",    type:"select", default:"ge", options:["ge","le","eq"]},
      {key:"required", label:"Pass if ≥",   type:"number", default:1},
      {key:"duration", label:"Duration (s)",type:"number", default:6},
      {key:"flavor",   label:"Label",      type:"text",   default:"Throw"},
      {key:"toChat",   label:"To chat",      type:"select", default:"yes", options:["yes","no"]},
      {key:"rerollEnabled", label:"Reroll button",  type:"select", default:"no", options:["no","yes"]},
      {key:"rerollPath",    label:"Reroll resource path", type:"path", default:"", placeholder:"e.g. system.resources.luck.value"},
      {key:"rerollCost",    label:"Reroll cost",  type:"number", default:1}
    ],
    isSaveBranch:true,
    toAction:(n,inp)=>{
      const _rrRaw = (inp.rerollEnabled != null && inp.rerollEnabled !== "") ? inp.rerollEnabled : n.data.rerollEnabled;
      const rerollEnabled = (_rrRaw === true || _rrRaw === "yes" || _rrRaw === 1 || _rrRaw === "1") ? "yes" : "no";
      return {
        type:     "throwOnSheet",
        count:    inp.count  ?? n.data.count  ?? "3",
        die:      Number(n.data.die ?? 6),
        target:   inp.target ?? n.data.target ?? "4",
        compare:  n.data.compare ?? "ge",
        required: Number(n.data.required ?? 1),
        duration: Number(n.data.duration ?? 6),
        flavor:   n.data.flavor ?? "Throw",
        toChat:   n.data.toChat !== "no",
        rerollEnabled,
        rerollPath: (inp.rerollPath != null && inp.rerollPath !== "") ? String(inp.rerollPath) : (n.data.rerollPath ?? ""),
        rerollCost: Number((inp.rerollCost != null && inp.rerollCost !== "") ? inp.rerollCost : (n.data.rerollCost ?? 1)) || 0,
        isCrit:    (inp.isCrit   != null && inp.isCrit   !== "") ? inp.isCrit   : null,
        isFumble:  (inp.isFumble != null && inp.isFumble !== "") ? inp.isFumble : null
      };
    }
  },

  act_ai_request: {
    title:"AI Request (OpenAI-compatible)", color:"#4a4a8a", cat:"AI",
    desc:"POSTs an OpenAI-compatible chat-completion request to the given URL with Authorization: Bearer <key>. Compatible with api.openai.com, openrouter.ai, LM Studio (http://localhost:1234/v1/chat/completions), Ollama OAI compat, vLLM, etc. Output 'Response' carries choices[0].message.content as a string. Use {__lastAiResponse} in downstream formulas / text. SECURITY: API key is stored on the document where the graph lives — visible to all owners. Use 'API key setting' to read from a world setting (sd.<settingKey>) instead.",
    wideNode:true,
    hidden:true,
    inputs:[
      {id:"exec",         label:"",            type:"exec"},
      {id:"url",          label:"URL",          type:"value.string"},
      {id:"apiKey",       label:"API Key",      type:"value.string"},
      {id:"model",        label:"Model",        type:"value.string"},
      {id:"systemPrompt", label:"System Prompt",type:"value.string"},
      {id:"prompt",       label:"Prompt",       type:"value.string"},
      {id:"temperature",  label:"Temperature",  type:"value.number"},
      {id:"maxTokens",    label:"Max Tokens",   type:"value.number"}
    ],
    outputs:[
      {id:"exec",     label:"Done →",   type:"exec"},
      {id:"error",    label:"Error →",  type:"exec"},
      {id:"response", label:"Response", type:"value.string"},
      {id:"errorMsg", label:"Error",    type:"value.string"}
    ],
    fields:[
      {key:"providerProfile", label:"Provider Profile", type:"select", default:"", options:AI_PROVIDER_PROFILE_OPTIONS},
      {key:"url",          label:"URL",            type:"text",   default:"",
        placeholder:"https://api.openai.com/v1/chat/completions"},
      {key:"apiKey",       label:"API Key",        type:"text",   default:"",
        placeholder:"sk-... (leave empty if using API key setting)"},
      {key:"apiKeySetting",label:"API key setting (world)", type:"text", default:"",
        placeholder:"e.g. openaiKey  → reads game.settings.get('sd', '<this>')"},
      {key:"model",        label:"Model",          type:"text",   default:"",
        placeholder:"gpt-4o-mini, gpt-4o, claude-3-haiku, qwen2.5-7b-instruct…"},
      {key:"systemPrompt", label:"System Prompt",  type:"text",   default:"",
        placeholder:"e.g. You are a helpful Foundry VTT NPC."},
      {key:"prompt",       label:"Prompt",         type:"text",   default:"",
        placeholder:"e.g. Generate a tavern name and 3 rumours."},
      {key:"temperature",  label:"Temperature",    type:"number", default:0.7},
      {key:"maxTokens",    label:"Max Tokens",     type:"number", default:512},
      {key:"flavor",       label:"Chat label",     type:"text",   default:"AI"},
      {key:"toChat",       label:"Post to chat",   type:"select", default:"no", options:["no","yes"]}
    ],
    isAiBranch: true,
    toAction:(n,inp)=>({
      type:         "aiRequest",
      providerProfile: n.data.providerProfile ?? "",
      url:          inp.url          ?? n.data.url          ?? "",
      apiKey:       inp.apiKey       ?? n.data.apiKey       ?? "",
      apiKeySetting: n.data.apiKeySetting ?? "",
      model:        inp.model        ?? n.data.model        ?? "",
      systemPrompt: inp.systemPrompt ?? n.data.systemPrompt ?? "",
      prompt:       inp.prompt       ?? n.data.prompt       ?? "",
      temperature:  (inp.temperature != null && inp.temperature !== "") ? Number(inp.temperature) : Number(n.data.temperature ?? 0.7),
      maxTokens:    (inp.maxTokens   != null && inp.maxTokens   !== "") ? Number(inp.maxTokens)   : Number(n.data.maxTokens   ?? 512),
      flavor:       n.data.flavor ?? "AI",
      toChat:       n.data.toChat === "yes"
    })
  },

  act_ai_assistant: {
    title:"AI Assistant", color:"#4a4a8a", cat:"AI", wideNode:true, hidden:true,
    desc:"Asks the AI helper configured in AI Settings. Use it for graph logic help, narration, generated text, summaries, hints, or any assistant-style response. Blank provider fields use the selected Provider Profile; Assistant is the default profile.",
    inputs:[
      {id:"exec",         label:"",              type:"exec"},
      {id:"prompt",       label:"Prompt",        type:"value.string"},
      {id:"context",      label:"Context",       type:"value.string"},
      {id:"systemPrompt", label:"System Prompt", type:"value.string"},
      {id:"temperature",  label:"Temperature",   type:"value.number"},
      {id:"maxTokens",    label:"Max Tokens",    type:"value.number"}
    ],
    outputs:[
      {id:"exec",     label:"Done ->",  type:"exec"},
      {id:"error",    label:"Error ->", type:"exec"},
      {id:"response", label:"Response", type:"value.string"},
      {id:"errorMsg", label:"Error",    type:"value.string"}
    ],
    fields:[
      {key:"providerProfile", label:"Provider Profile", type:"select", default:"assistant", options:AI_PROVIDER_PROFILE_OPTIONS},
      {key:"systemPrompt", label:"System Prompt", type:"textarea", rows:3,
        default:"You are an AI assistant inside a Foundry VTT node graph. Help concisely and return directly usable text."},
      {key:"prompt", label:"Prompt", type:"textarea", rows:4, default:"", placeholder:"Ask the assistant what to generate or decide."},
      {key:"context", label:"Context", type:"textarea", rows:3, default:"", placeholder:"Optional extra context; can be wired from another node."},
      {key:"includeActorContext", label:"Include Actor AI Bio / World", type:"select", default:"yes", options:["yes","no"]},
      {key:"url",        label:"URL",         type:"text",   default:"", placeholder:"Blank = selected profile"},
      {key:"apiKey",     label:"API Key",     type:"text",   default:""},
      {key:"apiKeySetting", label:"API key setting (world)", type:"text", default:""},
      {key:"model",      label:"Model",       type:"text",   default:"", placeholder:"Blank = selected profile model"},
      {key:"temperature",label:"Temperature", type:"number", default:""},
      {key:"maxTokens",  label:"Max Tokens",  type:"number", default:""},
      {key:"flavor",     label:"Chat label",  type:"text",   default:"AI Assistant"},
      {key:"toChat",     label:"Post to chat", type:"select", default:"no", options:["no","yes"]}
    ],
    isAiBranch:true,
    toAction:(n,inp)=>({
      type:"aiAssistant",
      providerProfile: n.data.providerProfile ?? "assistant",
      systemPrompt: inp.systemPrompt ?? n.data.systemPrompt ?? "",
      prompt: inp.prompt ?? n.data.prompt ?? "",
      context: inp.context ?? n.data.context ?? "",
      includeActorContext: n.data.includeActorContext !== "no",
      url: n.data.url ?? "",
      apiKey: n.data.apiKey ?? "",
      apiKeySetting: n.data.apiKeySetting ?? "",
      model: n.data.model ?? "",
      temperature: (inp.temperature != null && inp.temperature !== "") ? Number(inp.temperature) : n.data.temperature,
      maxTokens: (inp.maxTokens != null && inp.maxTokens !== "") ? Number(inp.maxTokens) : n.data.maxTokens,
      flavor: n.data.flavor ?? "AI Assistant",
      toChat: n.data.toChat === "yes"
    })
  },

  ai_dialogue_choices: {
    title:"AI Dialogue Choices", color:"#4a4a8a", cat:"AI", wideNode:true, hidden:true,
    desc:"Configuration source for Dialogue Builder. Connect its AI Choices output into Dialogue Builder's AI Choices input. At runtime it asks an OpenAI-compatible model to generate the NPC dialogue text and player response choices. Infinity Dialogue keeps sending the selected player answer plus dialogue history back to the model and reopens the next dialogue window while the model returns continue=true.",
    inputs:[],
    outputs:[{id:"choices", label:"AI Choices", type:"value.any"}],
    fields:[
      {key:"providerProfile", label:"Provider Profile", type:"select", default:"dialogue", options:AI_PROVIDER_PROFILE_OPTIONS},
      {key:"url",          label:"URL",            type:"text",   default:"",
        placeholder:"https://api.openai.com/v1/chat/completions"},
      {key:"apiKey",       label:"API Key",        type:"text",   default:"",
        placeholder:"sk-... (leave empty if using API key setting)"},
      {key:"apiKeySetting",label:"API key setting (world)", type:"text", default:"",
        placeholder:"e.g. openaiKey - reads game.settings.get('sd', '<this>')"},
      {key:"model",        label:"Model",          type:"text",   default:"",
        placeholder:"gpt-4o-mini, gpt-4o, local model name..."},
      {key:"systemPrompt", label:"System Prompt",  type:"textarea", default:"You are an RPG NPC dialogue writer. Generate concise in-character dialogue and player response choices.", rows:3},
      {key:"prompt",       label:"Extra Prompt",   type:"textarea", default:"Use the current dialogue text as context. Generate meaningful player responses.", rows:3},
      {key:"aiResponse",    label:"AI Response Context", type:"textarea", default:"", rows:2,
        placeholder:"Optional: wire AI Request -> Response here, or use {__lastAiResponse}"},
      {key:"choiceCount",  label:"Choice Count",   type:"number", default:3},
      {key:"temperature",  label:"Temperature",    type:"number", default:0.7},
      {key:"maxTokens",    label:"Max Tokens",     type:"number", default:700},
      {key:"infinityDialogue", label:"Infinity Dialogue", type:"bool", default:false},
      {key:"maxTurns",     label:"Max Turns Safety", type:"number", default:20}
    ],
    compile:(n,i)=>{
      const asBool = (value) => {
        if (typeof value === "boolean") return value;
        if (typeof value === "number") return value !== 0;
        const s = String(value ?? "").trim().toLowerCase();
        return ["1", "true", "yes", "on"].includes(s);
      };
      const cfg = {
        providerProfile:  n.data.providerProfile ?? "dialogue",
        url:              i.url              ?? n.data.url              ?? "",
        apiKey:           i.apiKey           ?? n.data.apiKey           ?? "",
        apiKeySetting:    n.data.apiKeySetting ?? "",
        model:            i.model            ?? n.data.model            ?? "",
        systemPrompt:     i.systemPrompt     ?? n.data.systemPrompt     ?? "",
        prompt:           i.prompt           ?? n.data.prompt           ?? "",
        aiResponse:       i.aiResponse       ?? n.data.aiResponse       ?? "",
        choiceCount:      i.choiceCount      ?? n.data.choiceCount      ?? 3,
        temperature:      i.temperature      ?? n.data.temperature      ?? 0.7,
        maxTokens:        i.maxTokens        ?? n.data.maxTokens        ?? 700,
        infinityDialogue: asBool(n.data.infinityDialogue),
        maxTurns:         i.maxTurns         ?? n.data.maxTurns         ?? 20
      };
      const json = JSON.stringify(cfg);
      let b64 = "";
      try { b64 = btoa(unescape(encodeURIComponent(json))); }
      catch {
        try { b64 = Buffer.from(json, "utf8").toString("base64"); } catch { b64 = ""; }
      }
      return `{__sdAiDialogueChoices:${b64}}`;
    }
  },

  act_ai_memory_update: {
    title:"AI Memory Update", color:"#4a4a8a", cat:"AI", wideNode:true, hidden:true,
    desc:"Stores character memories. In Analyze mode it asks the default AI provider to extract durable memories from dialogue/context and adds them to the actor prompt. In Add mode it stores Memory Text directly. Provider fields are optional; blank values use AI Settings.",
    inputs:[
      {id:"exec",       label:"",            type:"exec"},
      {id:"context",    label:"Context",     type:"value.string"},
      {id:"memoryText", label:"Memory Text", type:"value.string"}
    ],
    outputs:[
      {id:"exec",        label:"Done ->", type:"exec"},
      {id:"error",       label:"Error ->", type:"exec"},
      {id:"memoryCount", label:"Count",    type:"value.number"},
      {id:"errorMsg",    label:"Error",    type:"value.string"}
    ],
    fields:[
      {key:"providerProfile", label:"Provider Profile", type:"select", default:"memory", options:AI_PROVIDER_PROFILE_OPTIONS},
      {key:"mode",       label:"Mode",        type:"select", default:"analyze", options:[{value:"analyze",label:"Analyze dialogue"},{value:"add",label:"Add memory text"}]},
      {key:"context",    label:"Context",     type:"textarea", default:"", rows:3, placeholder:"Blank = dialogue history and last AI response"},
      {key:"memoryText", label:"Memory Text", type:"textarea", default:"", rows:2, placeholder:"Direct memory, or extra note for analysis"},
      {key:"source",     label:"Source",      type:"text",     default:"AI Memory"},
      {key:"url",        label:"URL",         type:"text",     default:"", placeholder:"Blank = AI Settings provider"},
      {key:"apiKey",     label:"API Key",     type:"text",     default:""},
      {key:"apiKeySetting", label:"API key setting (world)", type:"text", default:""},
      {key:"model",      label:"Model",       type:"text",     default:"", placeholder:"Blank = AI Settings model"},
      {key:"temperature",label:"Temperature", type:"number",   default:""},
      {key:"maxTokens",  label:"Max Tokens",  type:"number",   default:""}
    ],
    isAiBranch:true,
    toAction:(n,inp)=>({
      type:"aiMemoryUpdate",
      providerProfile: n.data.providerProfile ?? "memory",
      mode: n.data.mode ?? "analyze",
      context: inp.context ?? n.data.context ?? "",
      memoryText: inp.memoryText ?? n.data.memoryText ?? "",
      source: n.data.source ?? "AI Memory",
      url: inp.url ?? n.data.url ?? "",
      apiKey: inp.apiKey ?? n.data.apiKey ?? "",
      apiKeySetting: n.data.apiKeySetting ?? "",
      model: inp.model ?? n.data.model ?? "",
      temperature: (inp.temperature != null && inp.temperature !== "") ? Number(inp.temperature) : n.data.temperature,
      maxTokens: (inp.maxTokens != null && inp.maxTokens !== "") ? Number(inp.maxTokens) : n.data.maxTokens
    })
  },

  switch_node: {
    title:"Switch on Value", color:"#8a2a8a", cat:"Flow Control",
    desc:"Compare Value against each Case and run the matching exec output. Smart mode trims text, ignores letter case, and compares numeric values numerically. Falls through to Default if no match.",
    wideNode:true,
    inputs:[
      {id:"exec",  label:"",        type:"exec"},
      {id:"value", label:"Value",   type:"value.any"}
    ],
    outputs:[
      {id:"case0", label:"Case 0",  type:"exec"},
      {id:"case1", label:"Case 1",  type:"exec"},
      {id:"case2", label:"Case 2",  type:"exec"},
      {id:"default",label:"Default",type:"exec"}
    ],
    fields:[
      {key:"case0", label:"Case 0 value", type:"text", default:"0"},
      {key:"case1", label:"Case 1 value", type:"text", default:"1"},
      {key:"case2", label:"Case 2 value", type:"text", default:"2"},
      {key:"matchMode", label:"Match", type:"select", default:"smart", options:[
        {value:"smart",label:"Smart (recommended)"},
        {value:"exact",label:"Exact text"},
        {value:"insensitive",label:"Text — ignore case"},
        {value:"number",label:"Number"}
      ]}
    ],
    isSwitch: true,
    toAction:(n,inp)=>({
      type:   "switchExec",
      value:  inp.value ?? 0,
      cases:  [n.data.case0??"0", n.data.case1??"1", n.data.case2??"2"],
      matchMode: n.data.matchMode ?? "smart"
    })
  },

  act_dialog_builder: (() => {
    const MAX_EL = 8;
    const TYPE_OPTS = ["label","section","text","number","checkbox","select","button"];
    const _count = (d) => Math.max(1, Math.min(MAX_EL, parseInt(d?.count) || 1));

    const elFields = [];
    for (let i = 0; i < MAX_EL; i++) {
      const _exists  = (d) => _count(d) > i;
      const _typeOf  = (d) => d?.[`el${i}_type`] ?? (i === 0 ? "button" : "text");
      const _hasId   = (d) => _exists(d) && !["label","section"].includes(_typeOf(d));
      const _hasDef  = (d) => _exists(d) && !["label","section","button"].includes(_typeOf(d));
      const _isSel   = (d) => _exists(d) && _typeOf(d) === "select";
      const _isBtn   = (d) => _exists(d) && _typeOf(d) === "button";
      elFields.push(
        {key:`el${i}_type`,    label:`Element ${i+1} — type`,        type:"select", default: i===0 ? "button" : "text",
          options: TYPE_OPTS, visibleIf: _exists},
        {key:`el${i}_id`,      label:`Element ${i+1} — Id (pin)`,    type:"text",   default:`item${i+1}`,
          placeholder:"unique id, e.g. stance",                       visibleIf: _hasId},
        {key:`el${i}_label`,   label:`Element ${i+1} — Label`,       type:"text",   default:`Element ${i+1}`,
          visibleIf: _exists},
        {key:`el${i}_default`, label:`Element ${i+1} — Default`,     type:"text",   default:"",
          placeholder:"start value (text/number/select) or 'yes' for checkbox", visibleIf: _hasDef},
        {key:`el${i}_options`, label:`Element ${i+1} — Options (CSV)`, type:"text", default:"",
          placeholder:"a,b,c — only for select",                      visibleIf: _isSel},
        {key:`el${i}_emit`,    label:`Element ${i+1} — Emit exec on click?`, type:"select", default:"no",
          options:["no","yes"],                                       visibleIf: _isBtn}
      );
    }
    return {
      title:"Dialog Builder", color:"#a04020", cat:"Dialogue", wideNode:true,
      desc:"Visual form-dialog builder. Pick element count (1-8), then for each element choose its type (label/section/text/number/checkbox/select/button), a unique Id, a Label, optional default and options. Each element with an Id exposes an output value pin that resolves to the runtime token {__dlg.<id>} (use it anywhere downstream — paths, formulas, text). Buttons additionally expose a per-button exec output when 'Emit exec on click?' is set to yes; turning it off hides that exec pin. Picked outputs the id of the last button clicked. Submit fires after any button (or OK if no buttons exist); Cancel fires on close without confirm.",
      inputs:[ {id:"exec", label:"", type:"exec"} ],

      outputs:[
        {id:"submit",  label:"Submit →", type:"exec"},
        {id:"cancel",  label:"Cancel",   type:"exec"},
        {id:"picked",  label:"Picked",   type:"value.string"}
      ],
      fields:[
        {key:"title",       label:"Title",                       type:"text",   default:"Dialog"},
        {key:"description", label:"Description",                 type:"text",   default:""},
        {key:"okLabel",     label:"OK label (when no buttons)",  type:"text",   default:"OK"},
        {key:"cancelLabel", label:"Cancel label",                type:"text",   default:"Cancel"},
        {key:"count",       label:"Number of elements (1-8)",    type:"number", default:1},
        ...elFields
      ],
      isGenericBranch:true,
      computeDynamicOutputs(node) {
        const data = node?.data ?? {};
        const c = _count(data);
        const dynVals  = [];
        const dynExecs = [];
        for (let i = 0; i < c; i++) {
          const t   = data[`el${i}_type`] ?? (i === 0 ? "button" : "text");
          const id  = String(data[`el${i}_id`] ?? "").trim();
          const lbl = String(data[`el${i}_label`] ?? "").trim() || `E${i+1}`;
          if (id && !["label","section"].includes(t)) {
            const pinType = t === "checkbox" ? "value.bool"
                         : t === "number"   ? "value.number"
                         : "value.string";
            dynVals.push({ id:`el${i}_val`, label:`${lbl}`, type: pinType });
          }
          if (t === "button" && data[`el${i}_emit`] === "yes") {
            dynExecs.push({ id:`el${i}_exec`, label:`${lbl} →`, type:"exec" });
          }
        }
        return [
          {id:"submit", label:"Submit →", type:"exec"},
          {id:"cancel", label:"Cancel",   type:"exec"},
          ...dynExecs,
          {id:"picked", label:"Picked",   type:"value.string"},
          ...dynVals
        ];
      },
      dynamicBranchToken(node, fromPin) {
        if (typeof fromPin !== "string") return null;
        if (fromPin === "picked") return "{__dlgPicked}";
        const m = fromPin.match(/^el(\d+)_val$/);
        if (!m) return null;
        const i = Number(m[1]);
        const elId = String(node?.data?.[`el${i}_id`] ?? "").trim();
        if (!elId) return "0";
        return `{__dlg.${elId}}`;
      },
      toAction(n) {
        const c = _count(n?.data ?? {});
        const elements = [];
        for (let i = 0; i < c; i++) {
          const t   = n.data[`el${i}_type`] ?? (i === 0 ? "button" : "text");
          const id  = String(n.data[`el${i}_id`] ?? "").trim();
          const lbl = String(n.data[`el${i}_label`] ?? "").trim();
          const def = n.data[`el${i}_default`] ?? "";
          const opts = String(n.data[`el${i}_options`] ?? "").split(",").map(s => s.trim()).filter(Boolean);
          const emit = n.data[`el${i}_emit`] === "yes";
          const o = { type: t, label: lbl };
          if (id) o.id = id;
          if (t === "select" && opts.length) o.options = opts;
          if (t === "checkbox") o.default = (def === "yes" || def === "true" || def === true || def === 1 || def === "1");
          else if (t === "number") o.default = (def === "" || def == null) ? 0 : Number(def);
          else if (t !== "label" && t !== "section" && t !== "button") o.default = String(def ?? "");
          if (t === "label" || t === "section") o.text = lbl;
          if (t === "button") {
            o.type = "button";
            o.formula = "0";
            o.execIndex = i;
            o.emit = emit;
          }
          elements.push(o);
        }
        return {
          type:        "dialogBuilder",
          title:       n.data.title       ?? "Dialog",
          description: n.data.description ?? "",
          okLabel:     n.data.okLabel     ?? "OK",
          cancelLabel: n.data.cancelLabel ?? "Cancel",
          elements
        };
      }
    };
  })(),

  while_loop: {
    title:"While Loop", color:"#1a5a7a", cat:"Flow Control",
    desc:"Execute Loop body while Condition is truthy. Re-evaluates the condition each iteration. Done fires when the condition becomes false or Max Iterations is reached.",
    inputs:[
      {id:"exec",      label:"",            type:"exec"},
      {id:"condition", label:"Condition",   type:"value.bool"},
      {id:"maxIter",   label:"Max Iter",    type:"value.number"}
    ],
    outputs:[
      {id:"loop",  label:"Loop →",  type:"exec"},
      {id:"index", label:"Index",   type:"value.number"},
      {id:"done",  label:"Done →",  type:"exec"}
    ],
    fields:[{key:"maxIter", label:"Max Iterations (safety)", type:"number", default:20}],
    isLoop: true,
    toAction:(n,inp)=>({
      type:      "whileLoop",
      condition: inp.condition ?? "1",
      maxIter:   inp.maxIter   ?? n.data.maxIter ?? 20
    })
  },

  act_create_effect: {
    hidden:true, replacement:"act_effect_definition + act_effect_apply_v2",
    title:"Create Effect", color:"#1a4a8a", cat:"Effects", wideNode:true,
    desc:"Creates an ActiveEffect on the target actor. Configure name, icon, duration, and attribute changes. Target resolves from pin or falls back to selected tokens / self.",
    inputs:[
      {id:"exec",     label:"",             type:"exec"},
      {id:"target",   label:"Target",       type:"value.actor"},
      {id:"duration", label:"Duration (rds)", type:"value.number"},
      {id:"name",     label:"Effect name",  type:"value.string"}
    ],
    outputs:[{id:"exec", label:"→", type:"exec"}],
    fields:[
      {key:"name",       label:"Effect name",       type:"text",   default:"New Effect"},
      {key:"icon",       label:"Icon path",          type:"text",   default:"icons/svg/aura.svg"},
      {key:"duration",   label:"Duration (rounds)",  type:"number", default:0, placeholder:"0 = permanent"},
      {key:"target",     label:"Target",             type:"select", default:"token_target", options:["self","actor","token_target","selected_token","all_targets"]},
      {key:"disabled",   label:"Start disabled",     type:"select", default:"no",  options:["no","yes"]},
      {key:"transfer",   label:"Transfer to actor",  type:"select", default:"yes", options:["yes","no"]},
      {key:"change0key", label:"Change 1 — key",     type:"text",   default:"", placeholder:"system.attributes.ac.bonus"},
      {key:"change0val", label:"Change 1 — value",   type:"text",   default:"0"},
      {key:"change0mode",label:"Change 1 — mode",    type:"select", default:"2", options:["0","1","2","3","4","5"]},
      {key:"change1key", label:"Change 2 — key",     type:"text",   default:""},
      {key:"change1val", label:"Change 2 — value",   type:"text",   default:"0"},
      {key:"change1mode",label:"Change 2 — mode",    type:"select", default:"2", options:["0","1","2","3","4","5"]},
      {key:"change2key", label:"Change 3 — key",     type:"text",   default:""},
      {key:"change2val", label:"Change 3 — value",   type:"text",   default:"0"},
      {key:"change2mode",label:"Change 3 — mode",    type:"select", default:"2", options:["0","1","2","3","4","5"]}
    ],
    isAction:true,
    toAction:(n,inp)=>{
      const changes = [];
      for (let i = 0; i < 3; i++) {
        const k = n.data[`change${i}key`];
        if (k) changes.push({ key:k, value:String(n.data[`change${i}val`] ?? "0"), mode:Number(n.data[`change${i}mode`] ?? 2) });
      }
      return {
        type:     "createEffect",
        name:     inp.name     ?? n.data.name     ?? "New Effect",
        icon:     n.data.icon  ?? "icons/svg/aura.svg",
        duration: inp.duration ?? n.data.duration ?? 0,
        target:   inp.target   ?? n.data.target   ?? "token_target",
        disabled: n.data.disabled === "yes",
        transfer: n.data.transfer !== "no",
        changes
      };
    }
  },

  act_apply_status: {
    title:"Apply Status", color:"#1a4a8a", cat:"Effects", wideNode:true,
    desc:"Apply / remove / toggle a status condition (CONFIG.statusEffects). Status Id can be e.g. `dead`, `prone`, `poisoned`, etc. — anything the active system or world registers. Status Id / Mode / Overlay pins override the matching field (UE-style).",
    inputs:[
      {id:"exec",     label:"",         type:"exec"},
      {id:"target",   label:"Target",   type:"value.actor"},
      {id:"statusId", label:"Status Id",type:"value.string"},
      {id:"mode",     label:"Mode",     type:"value.string"},
      {id:"overlay",  label:"Overlay",  type:"value.bool"}
    ],
    outputs:[{id:"exec", label:"→", type:"exec"}],
    fields:[
      {key:"statusId",label:"Status Id",   type:"text",   default:"poisoned", placeholder:"dead, prone, blinded, poisoned…"},
      {key:"target",  label:"Target",      type:"select", default:"token_target", options:["self","actor","token_target","selected_token","all_targets"]},
      {key:"mode",    label:"Mode",        type:"select", default:"apply",        options:["apply","remove","toggle"]},
      {key:"overlay", label:"Big overlay", type:"select", default:"no",           options:["no","yes"]}
    ],
    isAction:true,
    toAction:(n,inp)=>({
      type:     "applyStatus",
      statusId: inp.statusId ?? n.data.statusId ?? "",
      target:   inp.target   ?? n.data.target   ?? "token_target",
      mode:     (inp.mode    != null && inp.mode    !== "") ? String(inp.mode) : (n.data.mode ?? "apply"),
      overlay:  (inp.overlay != null && inp.overlay !== "") ? coerceBool(inp.overlay) : (n.data.overlay === "yes")
    })
  },

  act_remove_effect: {
    hidden:true, replacement:"act_effect_remove_v2",
    title:"Remove Effect", color:"#8a1a2a", cat:"Effects",
    desc:"Removes all ActiveEffects matching the given name from the target actor.",
    inputs:[
      {id:"exec",   label:"",           type:"exec"},
      {id:"target", label:"Target",     type:"value.actor"},
      {id:"name",   label:"Effect name", type:"value.string"}
    ],
    outputs:[{id:"exec", label:"→", type:"exec"}],
    fields:[
      {key:"name",   label:"Effect name", type:"text",   default:""},
      {key:"target", label:"Target",      type:"select", default:"token_target", options:["self","actor","token_target","selected_token","all_targets"]}
    ],
    isAction:true,
    toAction:(n,inp)=>({
      type:   "removeEffect",
      name:   inp.name   ?? n.data.name   ?? "",
      target: inp.target ?? n.data.target ?? "token_target"
    })
  },

  act_toggle_effect: {
    hidden:true, replacement:"act_effect_toggle_v2",
    title:"Toggle Effect", color:"#4a4a8a", cat:"Effects",
    desc:"Toggles the disabled state of an ActiveEffect matching the given name on the target actor.",
    inputs:[
      {id:"exec",   label:"",           type:"exec"},
      {id:"target", label:"Target",     type:"value.actor"},
      {id:"name",   label:"Effect name", type:"value.string"}
    ],
    outputs:[{id:"exec", label:"→", type:"exec"}],
    fields:[
      {key:"name",   label:"Effect name", type:"text",   default:""},
      {key:"target", label:"Target",      type:"select", default:"token_target", options:["self","actor","token_target","selected_token","all_targets"]},
      {key:"state",  label:"Set state",   type:"select", default:"toggle", options:["toggle","enable","disable"]}
    ],
    isAction:true,
    toAction:(n,inp)=>({
      type:   "toggleEffect",
      name:   inp.name   ?? n.data.name   ?? "",
      target: inp.target ?? n.data.target ?? "token_target",
      state:  n.data.state ?? "toggle"
    })
  },

  has_effect: {
    title:"Has Effect?", color:"#2a4a6a", cat:"Effects",
    desc:"Outputs 1 if the target actor has an active (non-disabled) effect with the given name, 0 otherwise.",
    inputs:[
      {id:"target", label:"Target", type:"value.actor"},
      {id:"name",   label:"Effect name", type:"value.string"}
    ],
    outputs:[{id:"v", label:"Has?", type:"value.bool"}],
    fields:[
      {key:"name",   label:"Effect name", type:"text",   default:""},
      {key:"target", label:"Target",      type:"select", default:"self", options:["self","actor","token_target","selected_token"]}
    ],
    compile:(n,i)=>`{__sdHasEffect:${_arrayArg(i.target ?? n.data.target ?? "self")}|${_arrayArg(i.name ?? n.data.name ?? "")}}`
  },

  act_place_aura: {
    hidden:true, replacement:"act_aura_definition + act_place_aura_zone",
    title:"Place Aura — With Effect", color:"#1a6a4a", cat:"Effects", wideNode:true,
    desc:"Places a Scene Region attached to the owner token. Tokens inside receive the named Active Effect automatically (hook-based enter/exit); leaving tokens lose it (configurable).",
    inputs:[
      {id:"exec",     label:"",          type:"exec"},
      {id:"owner",    label:"Owner",     type:"value.actor"},
      {id:"size",     label:"Size (ft)", type:"value.number"},
      {id:"name",     label:"Effect",    type:"value.string"}
    ],
    outputs:[{id:"exec", label:"→", type:"exec"}],
    fields:[
      {key:"shape",             label:"Shape",            type:"select",
       options:["emanation","circle","rectangle","ellipse","cone"], default:"emanation"},
      {key:"size",              label:"Size (ft)",        type:"number", default:10},
      {key:"angle",             label:"Cone angle (deg)", type:"number", default:53.13},
      {key:"name",              label:"Effect name",      type:"text",   default:"Aura"},
      {key:"icon",              label:"Effect icon",      type:"text",   default:"icons/svg/aura.svg"},
      {key:"owner",             label:"Owner",            type:"select", default:"self", options:["self","selected_token","token_target"]},
      {key:"auraKey",           label:"Aura key (unique)", type:"text",  default:"aura"},
      {key:"rounds",            label:"Lifetime (rounds, 0=в€ћ)", type:"number", default:0},
      {key:"deactivateOnLeave", label:"Remove effect on leave", type:"select", options:["yes","no"], default:"yes"},
      {key:"conditionEffect",   label:"Suppress when owner has effect", type:"text", default:""}
    ],
    isAction:true,
    toAction:(n,inp)=>({
      type:              "placeAuraEffect",
      shape:             n.data.shape   ?? "emanation",
      size:              inp.size       ?? n.data.size   ?? 10,
      angle:             n.data.angle   ?? 53.13,
      name:              inp.name       ?? n.data.name   ?? "Aura",
      icon:              n.data.icon    ?? "icons/svg/aura.svg",
      owner:             inp.owner      ?? n.data.owner  ?? "self",
      auraKey:           n.data.auraKey ?? "aura",
      rounds:            Number(n.data.rounds ?? 0) || 0,
      deactivateOnLeave: (n.data.deactivateOnLeave ?? "yes") === "yes",
      conditionEffect:   n.data.conditionEffect ?? ""
    })
  },

  act_place_aura_damage: {
    hidden:true, replacement:"act_place_aura_zone + act_damage_simple",
    title:"Place Aura — Damage", color:"#7a2a1a", cat:"Effects", wideNode:true,
    desc:"Attaches a region to the owner; rolls damage against tokens inside (onEnter / eachTurn / both). Respects system.resistances[damageType]. Chat card + visibility configurable.",
    inputs:[
      {id:"exec",       label:"",            type:"exec"},
      {id:"owner",      label:"Owner",       type:"value.actor"},
      {id:"size",       label:"Size (ft)",   type:"value.number"},
      {id:"formula",    label:"Formula",     type:"value.string"},
      {id:"name",       label:"Name",        type:"value.string"},
      {id:"damageType", label:"Damage Type", type:"value.string"},
      {id:"rounds",     label:"Lifetime",    type:"value.number"}
    ],
    outputs:[{id:"exec", label:"→", type:"exec"}],
    fields:[
      {key:"shape",            label:"Shape",              type:"select", options:["emanation","circle","rectangle","ellipse","cone"], default:"emanation"},
      {key:"size",             label:"Size (ft)",          type:"number", default:10},
      {key:"angle",            label:"Cone angle (deg)",   type:"number", default:53.13, visibleIf:d=>d.shape==="cone"},
      {key:"name",             label:"Aura name",          type:"text",   default:"Damage Aura"},
      {key:"icon",             label:"Icon",               type:"text",   default:"icons/svg/aura.svg"},
      {key:"owner",            label:"Owner",              type:"select", default:"self", options:["self","selected_token","token_target"]},
      {key:"auraKey",          label:"Aura key",           type:"text",   default:"damage-aura"},
      {key:"formula",          label:"Damage formula",     type:"text",   default:"1d6"},
      {key:"damageType",       label:"Damage type",        type:"text",   default:"fire"},
      {key:"hpPath",           label:"HP path",            type:"path",   default:"system.resources.hp.value"},
      {key:"hpMode",           label:"HP mode",            type:"select", options:["add","set"], default:"add"},
      {key:"tickMode",         label:"When",               type:"select", options:["onEnter","onEnter+eachTurn","eachTurn"], default:"onEnter+eachTurn"},
      {key:"showInChat",       label:"Show in chat",       type:"select", options:["yes","no"], default:"yes"},
      {key:"chatMode",         label:"Chat card (legacy)", type:"select", options:["auto","card"], default:"card"},
      {key:"applyMode",       label:"Apply mode",type:"select", options:["auto","card"], default:"auto"},
      {key:"rollApplyMode",   label:"Roll mode",          type:"select", options:["per_target","once"], default:"per_target"},
      {key:"visibility",       label:"Visibility",         type:"select", options:["everyone","gm"], default:"everyone"},
      {key:"rounds",           label:"Lifetime (rounds, 0=в€ћ)", type:"number", default:0},
      {key:"conditionEffect",  label:"Suppress when owner has effect", type:"text", default:""}
    ],
    isAction:true,
    toAction:(n,inp)=>({
      type:            "placeAuraDamage",
      shape:           n.data.shape   ?? "emanation",
      size:            inp.size       ?? n.data.size   ?? 10,
      angle:           n.data.angle   ?? 53.13,
      name:            inp.name       ?? n.data.name    ?? "Damage Aura",
      icon:            n.data.icon    ?? "icons/svg/aura.svg",
      owner:           inp.owner      ?? n.data.owner   ?? "self",
      auraKey:         n.data.auraKey ?? "damage-aura",
      formula:         inp.formula    ?? n.data.formula ?? "1d6",
      damageType:      inp.damageType ?? n.data.damageType ?? "",
      hpPath:          n.data.hpPath     ?? "system.resources.hp.value",
      hpMode:          n.data.hpMode     ?? "add",
      tickMode:        n.data.tickMode   ?? "onEnter+eachTurn",
      showInChat:      (n.data.showInChat ?? "yes") !== "no",
      chatMode:        n.data.chatMode   ?? "card",
      applyMode:        n.data.applyMode   ?? "auto",
      rollApplyMode:   n.data.rollApplyMode ?? "per_target",
      visibility:      n.data.visibility ?? "everyone",
      rounds:          Number(inp.rounds ?? n.data.rounds ?? 0) || 0,
      conditionEffect: n.data.conditionEffect ?? ""
    })
  },

  act_place_aura_heal: {
    hidden:true, replacement:"act_place_aura_zone + act_heal_simple",
    title:"Place Aura — Heal", color:"#1a6a3a", cat:"Effects", wideNode:true,
    desc:"Attaches a region to the owner; heals tokens inside (onEnter / eachTurn / both). HP path configurable. Chat card + visibility configurable.",
    inputs:[
      {id:"exec",    label:"",          type:"exec"},
      {id:"owner",   label:"Owner",     type:"value.actor"},
      {id:"size",    label:"Size (ft)", type:"value.number"},
      {id:"formula", label:"Formula",   type:"value.string"},
      {id:"name",    label:"Name",      type:"value.string"},
      {id:"rounds",  label:"Lifetime",  type:"value.number"}
    ],
    outputs:[{id:"exec", label:"→", type:"exec"}],
    fields:[
      {key:"shape",           label:"Shape",            type:"select", options:["emanation","circle","rectangle","ellipse","cone"], default:"emanation"},
      {key:"size",            label:"Size (ft)",        type:"number", default:10},
      {key:"angle",           label:"Cone angle (deg)", type:"number", default:53.13, visibleIf:d=>d.shape==="cone"},
      {key:"name",            label:"Aura name",        type:"text",   default:"Heal Aura"},
      {key:"icon",            label:"Icon",             type:"text",   default:"icons/svg/aura.svg"},
      {key:"owner",           label:"Owner",            type:"select", default:"self", options:["self","selected_token","token_target"]},
      {key:"auraKey",         label:"Aura key",         type:"text",   default:"heal-aura"},
      {key:"formula",         label:"Heal formula",     type:"text",   default:"1d4"},
      {key:"hpPath",          label:"HP path",          type:"path",   default:"system.resources.hp.value"},
      {key:"hpMode",          label:"HP mode",          type:"select", options:["add","set"], default:"add"},
      {key:"tickMode",        label:"When",             type:"select", options:["onEnter","onEnter+eachTurn","eachTurn"], default:"onEnter+eachTurn"},
      {key:"showInChat",      label:"Show in chat",     type:"select", options:["yes","no"], default:"yes"},
      {key:"chatMode",        label:"Chat card (legacy)", type:"select", options:["auto","card"], default:"card"},
      {key:"applyMode",      label:"Apply mode",type:"select", options:["auto","card"], default:"auto"},
      {key:"rollApplyMode",  label:"Roll mode",          type:"select", options:["per_target","once"], default:"per_target"},
      {key:"visibility",      label:"Visibility",       type:"select", options:["everyone","gm"], default:"everyone"},
      {key:"rounds",          label:"Lifetime (rounds, 0=в€ћ)", type:"number", default:0},
      {key:"conditionEffect", label:"Suppress when owner has effect", type:"text", default:""}
    ],
    isAction:true,
    toAction:(n,inp)=>({
      type:            "placeAuraHeal",
      shape:           n.data.shape    ?? "emanation",
      size:            inp.size        ?? n.data.size    ?? 10,
      angle:           n.data.angle    ?? 53.13,
      name:            inp.name        ?? n.data.name     ?? "Heal Aura",
      icon:            n.data.icon     ?? "icons/svg/aura.svg",
      owner:           inp.owner       ?? n.data.owner   ?? "self",
      auraKey:         n.data.auraKey  ?? "heal-aura",
      formula:         inp.formula     ?? n.data.formula ?? "1d4",
      hpPath:          n.data.hpPath     ?? "system.resources.hp.value",
      hpMode:          n.data.hpMode     ?? "add",
      tickMode:        n.data.tickMode   ?? "onEnter+eachTurn",
      showInChat:      (n.data.showInChat ?? "yes") !== "no",
      chatMode:        n.data.chatMode   ?? "card",
      applyMode:        n.data.applyMode   ?? "auto",
      rollApplyMode:   n.data.rollApplyMode ?? "per_target",
      visibility:      n.data.visibility ?? "everyone",
      rounds:          Number(inp.rounds ?? n.data.rounds ?? 0) || 0,
      conditionEffect: n.data.conditionEffect ?? ""
    })
  },

  act_place_aura_save_effect: {
    hidden:true, replacement:"act_place_aura_zone + act_save_dc + act_effect_apply_v2",
    title:"Place Aura — Save → Effect", color:"#6a4a1a", cat:"Effects", wideNode:true,
    desc:"Attaches a region to the owner; tokens inside roll a save (onEnter / eachTurn / both). On failure the named Active Effect is applied. On leave the effect is removed (configurable).",
    inputs:[
      {id:"exec",   label:"",          type:"exec"},
      {id:"owner",  label:"Owner",     type:"value.actor"},
      {id:"size",   label:"Size (ft)", type:"value.number"},
      {id:"dc",     label:"DC",        type:"value.number"},
      {id:"name",   label:"Name",      type:"value.string"}
    ],
    outputs:[{id:"exec", label:"→", type:"exec"}],
    fields:[
      {key:"shape",             label:"Shape",             type:"select", options:["emanation","circle","rectangle","ellipse","cone"], default:"emanation"},
      {key:"size",              label:"Size (ft)",         type:"number", default:10},
      {key:"angle",             label:"Cone angle (deg)",  type:"number", default:53.13, visibleIf:d=>d.shape==="cone"},
      {key:"name",              label:"Effect name",       type:"text",   default:"Aura Effect"},
      {key:"icon",              label:"Icon",              type:"text",   default:"icons/svg/aura.svg"},
      {key:"owner",             label:"Owner",             type:"select", default:"self", options:["self","selected_token","token_target"]},
      {key:"auraKey",           label:"Aura key",          type:"text",   default:"save-aura"},
      {key:"saveAttr",          label:"Save attr path",    type:"path",   default:"system.attributes.dex.value"},
      {key:"dc",                label:"DC",                type:"number", default:15},
      {key:"flavor",            label:"Save label",        type:"text",   default:"Saving Throw"},
      {key:"tickMode",          label:"When",              type:"select", options:["onEnter","onEnter+eachTurn","eachTurn"], default:"onEnter+eachTurn"},
      {key:"showInChat",        label:"Show in chat",      type:"select", options:["yes","no"], default:"yes"},
      {key:"advMode",           label:"Adv / Dis mode",    type:"select", options:["none","adv","dis","ask"], default:"none"},
      {key:"advFormula",        label:"Adv core formula",  type:"text",   default:"", placeholder:"2d20kh1 (default)"},
      {key:"disFormula",        label:"Dis core formula",  type:"text",   default:"", placeholder:"2d20kl1 (default)"},
      {key:"chatMode",          label:"Chat card (legacy)", type:"select", options:["auto","card"], default:"card"},
      {key:"applyMode",        label:"Apply mode",type:"select", options:["auto","card"], default:"auto"},
      {key:"visibility",        label:"Visibility",        type:"select", options:["everyone","gm"], default:"everyone"},
      {key:"deactivateOnLeave", label:"Remove effect on leave", type:"select", options:["yes","no"], default:"yes"},
      {key:"rounds",            label:"Lifetime (rounds, 0=в€ћ)", type:"number", default:0},
      {key:"conditionEffect",   label:"Suppress when owner has effect", type:"text", default:""}
    ],
    isAction:true,
    toAction:(n,inp)=>({
      type:              "placeAuraSaveEffect",
      shape:             n.data.shape    ?? "emanation",
      size:              inp.size        ?? n.data.size   ?? 10,
      angle:             n.data.angle    ?? 53.13,
      name:              inp.name        ?? n.data.name     ?? "Aura Effect",
      icon:              n.data.icon     ?? "icons/svg/aura.svg",
      owner:             inp.owner       ?? n.data.owner    ?? "self",
      auraKey:           n.data.auraKey  ?? "save-aura",
      saveAttr:          n.data.saveAttr ?? "system.attributes.dex.value",
      dc:                (v => Number.isFinite(v) ? v : 15)(Number(inp.dc ?? n.data.dc ?? 15)),
      flavor:            n.data.flavor   ?? "Saving Throw",
      advMode:           n.data.advMode ?? "none",
      advFormula:        n.data.advFormula ?? "",
      disFormula:        n.data.disFormula ?? "",
      tickMode:          n.data.tickMode ?? "onEnter+eachTurn",
      showInChat:        (n.data.showInChat ?? "yes") !== "no",
      chatMode:          n.data.chatMode ?? "card",
      applyMode:          n.data.applyMode ?? "auto",
      visibility:        n.data.visibility ?? "everyone",
      deactivateOnLeave: (n.data.deactivateOnLeave ?? "yes") === "yes",
      rounds:            Number(n.data.rounds ?? 0) || 0,
      conditionEffect:   n.data.conditionEffect ?? ""
    })
  },

  act_place_aura_targets: {
    hidden:true, replacement:"act_place_aura_zone",
    title:"Place Aura — Targets", color:"#6a7a2a", cat:"Effects", wideNode:true,
    desc:"Attaches a region to the owner; tokens inside are forwarded as targets — no save, no roll. Each token that enters (or sits in, if eachTurn is enabled) the area runs the postActions chain with itself as the only target. Connect the Targets[] output to a downstream Damage / Heal / Apply Effect node's Targets pin to apply to everyone in the aura.",
    inputs:[
      {id:"exec",  label:"",          type:"exec"},
      {id:"owner", label:"Owner",     type:"value.actor"},
      {id:"size",  label:"Size (ft)", type:"value.number"}
    ],
    outputs:[
      {id:"exec",    label:"→",         type:"exec"},
      {id:"targets", label:"Targets[]", type:"value.array"}
    ],
    fields:[
      {key:"shape",            label:"Shape",            type:"select", options:["emanation","circle","rectangle","ellipse","cone"], default:"emanation"},
      {key:"size",             label:"Size (ft)",        type:"number", default:10},
      {key:"angle",            label:"Cone angle (deg)", type:"number", default:53.13, visibleIf:d=>d.shape==="cone"},
      {key:"name",             label:"Aura name",        type:"text",   default:"Targets Aura"},
      {key:"icon",             label:"Icon",             type:"text",   default:"icons/svg/aura.svg"},
      {key:"owner",            label:"Owner",            type:"select", default:"self", options:["self","selected_token","token_target"]},
      {key:"auraKey",          label:"Aura key",         type:"text",   default:"targets-aura"},
      {key:"tickMode",         label:"When",             type:"select", options:["onEnter","onEnter+eachTurn","eachTurn"], default:"onEnter"},
      {key:"rounds",           label:"Lifetime (rounds, 0=в€ћ)", type:"number", default:0},
      {key:"conditionEffect",  label:"Suppress when owner has effect", type:"text", default:""}
    ],
    isAction:true,
    isAoeSave:true,
    toAction:(n,inp)=>({
      type:            "placeAuraTargets",
      shape:           n.data.shape    ?? "emanation",
      size:            inp.size        ?? n.data.size    ?? 10,
      angle:           n.data.angle    ?? 53.13,
      name:            n.data.name     ?? "Targets Aura",
      icon:            n.data.icon     ?? "icons/svg/aura.svg",
      owner:           inp.owner       ?? n.data.owner   ?? "self",
      auraKey:         n.data.auraKey  ?? "targets-aura",
      tickMode:        n.data.tickMode ?? "onEnter",
      rounds:          Number(n.data.rounds ?? 0) || 0,
      conditionEffect: n.data.conditionEffect ?? ""
    })
  },

  act_place_aura_save_branch: {
    hidden:true, replacement:"act_place_aura_zone + act_save_dc",
    title:"Place Aura — Save Branch", color:"#8a5a2a", cat:"Effects", wideNode:true,
    desc:"Attaches a region to the owner; tokens inside roll a save (onEnter / eachTurn / both). Connect Saved[]/Failed[]/All[] value outputs to the Targets pin of downstream Damage / Heal / Effect nodes (per-tick, per-token).",
    inputs:[
      {id:"exec",  label:"",          type:"exec"},
      {id:"owner", label:"Owner",     type:"value.actor"},
      {id:"size",  label:"Size (ft)", type:"value.number"},
      {id:"dc",    label:"DC",        type:"value.number"}
    ],
    outputs:[
      {id:"exec",   label:"→",        type:"exec"},
      {id:"saved",  label:"Saved[]",  type:"value.array"},
      {id:"failed", label:"Failed[]", type:"value.array"},
      {id:"all",    label:"All[]",    type:"value.array"}
    ],
    fields:[
      {key:"shape",            label:"Shape",            type:"select", options:["emanation","circle","rectangle","ellipse","cone"], default:"emanation"},
      {key:"size",             label:"Size (ft)",        type:"number", default:10},
      {key:"angle",            label:"Cone angle (deg)", type:"number", default:53.13, visibleIf:d=>d.shape==="cone"},
      {key:"name",             label:"Aura name",        type:"text",   default:"Save Aura"},
      {key:"icon",             label:"Icon",             type:"text",   default:"icons/svg/aura.svg"},
      {key:"owner",            label:"Owner",            type:"select", default:"self", options:["self","selected_token","token_target"]},
      {key:"auraKey",          label:"Aura key",         type:"text",   default:"save-branch-aura"},
      {key:"saveAttr",         label:"Save attr path",   type:"path",   default:"system.attributes.dex.value"},
      {key:"dc",               label:"DC",               type:"number", default:15},
      {key:"flavor",           label:"Save label",       type:"text",   default:"Saving Throw"},
      {key:"rollMode",         label:"Roll mode",        type:"select", options:["public","gmroll","blindroll","selfroll"], default:"public"},
      {key:"tickMode",         label:"When",             type:"select", options:["onEnter","onEnter+eachTurn","eachTurn"], default:"onEnter+eachTurn"},
      {key:"showInChat",       label:"Show in chat",     type:"select", options:["yes","no"], default:"yes"},
      {key:"advMode",          label:"Adv / Dis mode",   type:"select", options:["none","adv","dis","ask"], default:"none"},
      {key:"advFormula",       label:"Adv core formula", type:"text",   default:"", placeholder:"2d20kh1 (default)"},
      {key:"disFormula",       label:"Dis core formula", type:"text",   default:"", placeholder:"2d20kl1 (default)"},
      {key:"rounds",           label:"Lifetime (rounds, 0=в€ћ)", type:"number", default:0},
      {key:"conditionEffect",  label:"Suppress when owner has effect", type:"text", default:""}
    ],
    isAction:true,
    isAoeSave:true,
    toAction:(n,inp)=>({
      type:            "placeAuraSaveBranch",
      shape:           n.data.shape    ?? "emanation",
      size:            inp.size        ?? n.data.size    ?? 10,
      angle:           n.data.angle    ?? 53.13,
      name:            n.data.name     ?? "Save Aura",
      icon:            n.data.icon     ?? "icons/svg/aura.svg",
      owner:           inp.owner       ?? n.data.owner   ?? "self",
      auraKey:         n.data.auraKey  ?? "save-branch-aura",
      saveAttr:        n.data.saveAttr ?? "system.attributes.dex.value",
      dc:              (v => Number.isFinite(v) ? v : 15)(Number(inp.dc ?? n.data.dc ?? 15)),
      flavor:          n.data.flavor    ?? "Saving Throw",
      rollMode:        n.data.rollMode  ?? "public",
      tickMode:        n.data.tickMode  ?? "onEnter+eachTurn",
      showInChat:      (n.data.showInChat ?? "yes") !== "no",
      advMode:         n.data.advMode    ?? "none",
      advFormula:      n.data.advFormula ?? "",
      disFormula:      n.data.disFormula ?? "",
      rounds:          Number(n.data.rounds ?? 0) || 0,
      conditionEffect: n.data.conditionEffect ?? ""
    })
  },

  act_place_aoe_effect: {
    hidden:true, replacement:"act_spell",
    title:"Chat AoE — With Effect", color:"#1a4a8a", cat:"Effects", wideNode:true,
    desc:"Posts a chat card with a 'Place Template' button. Once placed, tokens inside gain the named Active Effect (removed on leave, configurable).",
    inputs:[
      {id:"exec",  label:"",          type:"exec"},
      {id:"size",  label:"Size (ft)", type:"value.number"},
      {id:"name",  label:"Name",      type:"value.string"},
      {id:"rounds",label:"Lifetime",  type:"value.number"}
    ],
    outputs:[{id:"exec", label:"→", type:"exec"}],
    fields:[
      {key:"cardTitle",         label:"Card title",       type:"text",   default:"Area of Effect"},
      {key:"shape",             label:"Shape",            type:"select", options:["circle","cone","ray","rect","ellipse"], default:"circle"},
      {key:"size",              label:"Size (ft)",        type:"number", default:20},
      {key:"angle",             label:"Cone angle (deg)", type:"number", default:53.13, visibleIf:d=>d.shape==="cone"},
      {key:"name",              label:"Effect name",      type:"text",   default:"AoE Effect"},
      {key:"icon",              label:"Icon",             type:"text",   default:"icons/svg/aura.svg"},
      {key:"deactivateOnLeave", label:"Remove on leave",  type:"select", options:["yes","no"], default:"yes"},
      {key:"persist",           label:"Keep template on map", type:"select", options:["yes","no"], default:"yes"},
      {key:"rounds",            label:"Lifetime (rounds, 0=в€ћ)", type:"number", default:0},
      {key:"visibility",        label:"Visibility",       type:"select", options:["everyone","gm"], default:"everyone"},
      {key:"conditionEffect",   label:"Suppress when source has effect", type:"text", default:""}
    ],
    isAction:true,
    toAction:(n,inp)=>({
      type:              "placeAoeEffect",
      cardTitle:         n.data.cardTitle ?? "Area of Effect",
      shape:             n.data.shape     ?? "circle",
      size:              inp.size         ?? n.data.size ?? 20,
      angle:             n.data.angle     ?? 53.13,
      name:              inp.name         ?? n.data.name      ?? "AoE Effect",
      icon:              n.data.icon      ?? "icons/svg/aura.svg",
      deactivateOnLeave: (n.data.deactivateOnLeave ?? "yes") === "yes",
      persist:           (n.data.persist ?? "yes") === "yes",
      rounds:            Number(inp.rounds ?? n.data.rounds ?? 0) || 0,
      visibility:        n.data.visibility ?? "everyone",
      conditionEffect:   n.data.conditionEffect ?? ""
    })
  },

  act_place_aoe_damage: {
    hidden:true, replacement:"act_spell",
    title:"Chat AoE — Damage", color:"#7a3a1a", cat:"Effects", wideNode:true,
    desc:"Posts a chat card with a 'Place Template' button. Once placed, rolls damage against tokens inside (onEnter / eachTurn / both). Respects resistances.",
    inputs:[
      {id:"exec",       label:"",            type:"exec"},
      {id:"size",       label:"Size (ft)",   type:"value.number"},
      {id:"formula",    label:"Formula",     type:"value.string"},
      {id:"name",       label:"Name",        type:"value.string"},
      {id:"damageType", label:"Damage Type", type:"value.string"},
      {id:"rounds",     label:"Lifetime",    type:"value.number"}
    ],
    outputs:[{id:"exec", label:"→", type:"exec"}],
    fields:[
      {key:"cardTitle",  label:"Card title",       type:"text",   default:"Damaging AoE"},
      {key:"shape",      label:"Shape",            type:"select", options:["circle","cone","ray","rect","ellipse"], default:"circle"},
      {key:"size",       label:"Size (ft)",        type:"number", default:20},
      {key:"angle",      label:"Cone angle (deg)", type:"number", default:53.13, visibleIf:d=>d.shape==="cone"},
      {key:"name",       label:"Name",             type:"text",   default:"Damage AoE"},
      {key:"formula",    label:"Damage formula",   type:"text",   default:"2d6"},
      {key:"damageType", label:"Damage type",      type:"text",   default:"fire"},
      {key:"hpPath",     label:"HP path",          type:"path",   default:"system.resources.hp.value"},
      {key:"hpMode",     label:"HP mode",          type:"select", options:["add","set"], default:"add"},
      {key:"tickMode",   label:"When",             type:"select", options:["onEnter","onEnter+eachTurn","eachTurn"], default:"onEnter"},
      {key:"showInChat", label:"Show in chat",     type:"select", options:["yes","no"], default:"yes"},
      {key:"chatMode",   label:"Chat card (legacy)", type:"select", options:["auto","card"], default:"card"},
      {key:"applyMode", label:"Apply mode",type:"select", options:["auto","card"], default:"auto"},
      {key:"rollApplyMode", label:"Roll mode", type:"select", options:["per_target","once"], default:"per_target"},
      {key:"visibility", label:"Visibility",       type:"select", options:["everyone","gm"], default:"everyone"},
      {key:"persist",    label:"Keep template on map", type:"select", options:["yes","no"], default:"no"},
      {key:"rounds",     label:"Lifetime (rounds, 0=в€ћ)", type:"number", default:0}
    ],
    isAction:true,
    toAction:(n,inp)=>({
      type:         "placeAoeDamage",
      cardTitle:    n.data.cardTitle ?? "Damaging AoE",
      shape:        n.data.shape     ?? "circle",
      size:         inp.size         ?? n.data.size ?? 20,
      angle:        n.data.angle     ?? 53.13,
      name:         inp.name         ?? n.data.name      ?? "Damage AoE",
      formula:      inp.formula      ?? n.data.formula ?? "2d6",
      damageType:   inp.damageType   ?? n.data.damageType ?? "",
      hpPath:       n.data.hpPath     ?? "system.resources.hp.value",
      hpMode:       n.data.hpMode     ?? "add",
      tickMode:     n.data.tickMode   ?? "onEnter",
      showInChat:   (n.data.showInChat ?? "yes") !== "no",
      chatMode:     n.data.chatMode   ?? "card",
      applyMode:     n.data.applyMode   ?? "auto",
      rollApplyMode: n.data.rollApplyMode ?? "per_target",
      visibility:   n.data.visibility ?? "everyone",
      persist:      (n.data.persist ?? "no") === "yes",
      rounds:       Number(inp.rounds ?? n.data.rounds ?? 0) || 0
    })
  },

  act_place_aoe_heal: {
    hidden:true, replacement:"act_spell",
    title:"Chat AoE — Heal", color:"#1a6a3a", cat:"Effects", wideNode:true,
    desc:"Posts a chat card with a 'Place Template' button. Once placed, heals tokens inside (onEnter / eachTurn / both).",
    inputs:[
      {id:"exec",    label:"",          type:"exec"},
      {id:"size",    label:"Size (ft)", type:"value.number"},
      {id:"formula", label:"Formula",   type:"value.string"},
      {id:"name",    label:"Name",      type:"value.string"},
      {id:"rounds",  label:"Lifetime",  type:"value.number"}
    ],
    outputs:[{id:"exec", label:"→", type:"exec"}],
    fields:[
      {key:"cardTitle",  label:"Card title",       type:"text",   default:"Healing AoE"},
      {key:"shape",      label:"Shape",            type:"select", options:["circle","cone","ray","rect","ellipse"], default:"circle"},
      {key:"size",       label:"Size (ft)",        type:"number", default:20},
      {key:"angle",      label:"Cone angle (deg)", type:"number", default:53.13, visibleIf:d=>d.shape==="cone"},
      {key:"name",       label:"Name",             type:"text",   default:"Heal AoE"},
      {key:"formula",    label:"Heal formula",     type:"text",   default:"2d4"},
      {key:"hpPath",     label:"HP path",          type:"path",   default:"system.resources.hp.value"},
      {key:"hpMode",     label:"HP mode",          type:"select", options:["add","set"], default:"add"},
      {key:"tickMode",   label:"When",             type:"select", options:["onEnter","onEnter+eachTurn","eachTurn"], default:"onEnter"},
      {key:"showInChat", label:"Show in chat",     type:"select", options:["yes","no"], default:"yes"},
      {key:"chatMode",   label:"Chat card (legacy)", type:"select", options:["auto","card"], default:"card"},
      {key:"applyMode", label:"Apply mode",type:"select", options:["auto","card"], default:"auto"},
      {key:"rollApplyMode", label:"Roll mode", type:"select", options:["per_target","once"], default:"per_target"},
      {key:"visibility", label:"Visibility",       type:"select", options:["everyone","gm"], default:"everyone"},
      {key:"persist",    label:"Keep template on map", type:"select", options:["yes","no"], default:"no"},
      {key:"rounds",     label:"Lifetime (rounds, 0=в€ћ)", type:"number", default:0}
    ],
    isAction:true,
    toAction:(n,inp)=>({
      type:         "placeAoeHeal",
      cardTitle:    n.data.cardTitle ?? "Healing AoE",
      shape:        n.data.shape     ?? "circle",
      size:         inp.size         ?? n.data.size ?? 20,
      angle:        n.data.angle     ?? 53.13,
      name:         inp.name         ?? n.data.name      ?? "Heal AoE",
      formula:      inp.formula      ?? n.data.formula ?? "2d4",
      hpPath:       n.data.hpPath     ?? "system.resources.hp.value",
      hpMode:       n.data.hpMode     ?? "add",
      tickMode:     n.data.tickMode   ?? "onEnter",
      showInChat:   (n.data.showInChat ?? "yes") !== "no",
      chatMode:     n.data.chatMode   ?? "card",
      applyMode:     n.data.applyMode   ?? "auto",
      rollApplyMode: n.data.rollApplyMode ?? "per_target",
      visibility:   n.data.visibility ?? "everyone",
      persist:      (n.data.persist ?? "no") === "yes",
      rounds:       Number(inp.rounds ?? n.data.rounds ?? 0) || 0
    })
  },

  act_place_aoe_save_effect: {
    hidden:true, replacement:"act_spell",
    title:"Chat AoE — Save → Effect", color:"#6a2a8a", cat:"Effects", wideNode:true,
    desc:"Posts a chat card with a 'Place Template' button. Once placed, tokens inside roll a save (onEnter / eachTurn / both); on failure, the named Active Effect is applied. On leave the effect is removed (configurable).",
    inputs:[
      {id:"exec",  label:"",          type:"exec"},
      {id:"size",  label:"Size (ft)", type:"value.number"},
      {id:"dc",    label:"DC",        type:"value.number"},
      {id:"name",  label:"Name",      type:"value.string"},
      {id:"rounds",label:"Lifetime",  type:"value.number"}
    ],
    outputs:[{id:"exec", label:"→", type:"exec"}],
    fields:[
      {key:"cardTitle",         label:"Card title",       type:"text",   default:"AoE Save"},
      {key:"shape",             label:"Shape",            type:"select", options:["circle","cone","ray","rect","ellipse"], default:"circle"},
      {key:"size",              label:"Size (ft)",        type:"number", default:20},
      {key:"angle",             label:"Cone angle (deg)", type:"number", default:53.13, visibleIf:d=>d.shape==="cone"},
      {key:"name",              label:"Effect name",      type:"text",   default:"AoE Effect"},
      {key:"icon",              label:"Icon",             type:"text",   default:"icons/svg/aura.svg"},
      {key:"saveAttr",          label:"Save attr path",   type:"path",   default:"system.attributes.dex.value"},
      {key:"dc",                label:"DC",               type:"number", default:15},
      {key:"flavor",            label:"Save label",       type:"text",   default:"Saving Throw"},
      {key:"tickMode",          label:"When",             type:"select", options:["onEnter","onEnter+eachTurn","eachTurn"], default:"onEnter"},
      {key:"showInChat",        label:"Show in chat",     type:"select", options:["yes","no"], default:"yes"},
      {key:"advMode",           label:"Adv / Dis mode",   type:"select", options:["none","adv","dis","ask"], default:"none"},
      {key:"advFormula",        label:"Adv core formula", type:"text",   default:"", placeholder:"2d20kh1 (default)"},
      {key:"disFormula",        label:"Dis core formula", type:"text",   default:"", placeholder:"2d20kl1 (default)"},
      {key:"chatMode",          label:"Chat card (legacy)", type:"select", options:["auto","card"], default:"card"},
      {key:"applyMode",        label:"Apply mode",type:"select", options:["auto","card"], default:"auto"},
      {key:"visibility",        label:"Visibility",       type:"select", options:["everyone","gm"], default:"everyone"},
      {key:"deactivateOnLeave", label:"Remove on leave",  type:"select", options:["yes","no"], default:"yes"},
      {key:"persist",           label:"Keep template on map", type:"select", options:["yes","no"], default:"yes"},
      {key:"rounds",            label:"Lifetime (rounds, 0=в€ћ)", type:"number", default:0}
    ],
    isAction:true,
    toAction:(n,inp)=>({
      type:              "placeAoeSaveEffect",
      cardTitle:         n.data.cardTitle ?? "AoE Save",
      shape:             n.data.shape     ?? "circle",
      size:              inp.size         ?? n.data.size ?? 20,
      angle:             n.data.angle     ?? 53.13,
      name:              inp.name         ?? n.data.name      ?? "AoE Effect",
      icon:              n.data.icon      ?? "icons/svg/aura.svg",
      saveAttr:          n.data.saveAttr  ?? "system.attributes.dex.value",
      dc:                (v => Number.isFinite(v) ? v : 15)(Number(inp.dc ?? n.data.dc ?? 15)),
      flavor:            n.data.flavor    ?? "Saving Throw",
      advMode:           n.data.advMode   ?? "none",
      advFormula:        n.data.advFormula ?? "",
      disFormula:        n.data.disFormula ?? "",
      tickMode:          n.data.tickMode  ?? "onEnter",
      showInChat:        (n.data.showInChat ?? "yes") !== "no",
      chatMode:          n.data.chatMode  ?? "card",
      applyMode:          n.data.applyMode  ?? "auto",
      visibility:        n.data.visibility ?? "everyone",
      deactivateOnLeave: (n.data.deactivateOnLeave ?? "yes") === "yes",
      persist:           (n.data.persist ?? "yes") === "yes",
      rounds:            Number(inp.rounds ?? n.data.rounds ?? 0) || 0
    })
  },

  act_place_aoe_targets: {
    hidden:true, replacement:"act_place_aoe_template",
    title:"Chat AoE — Targets", color:"#8a7a2a", cat:"Effects", wideNode:true,
    desc:"Posts a chat card with a 'Place Template' button. When placed, every token inside is collected — no checks, no rolls. Connect Targets[] to downstream Damage / Heal / Effect nodes' Targets pin to apply effects to everyone in the area.",
    inputs:[
      {id:"exec", label:"",          type:"exec"},
      {id:"size", label:"Size (ft)", type:"value.number"}
    ],
    outputs:[
      {id:"exec",    label:"→",          type:"exec"},
      {id:"targets", label:"Targets[]",  type:"value.array"}
    ],
    fields:[
      {key:"cardTitle",  label:"Card title",            type:"text",   default:"AoE Targets"},
      {key:"shape",      label:"Shape",                 type:"select", options:["circle","cone","ray","rect","ellipse"], default:"circle"},
      {key:"size",       label:"Size (ft)",             type:"number", default:20},
      {key:"angle",      label:"Cone angle (deg)",      type:"number", default:53.13, visibleIf:d=>d.shape==="cone"},
      {key:"persist",    label:"Keep template on map",  type:"select", options:["yes","no"], default:"no"}
    ],
    isAction:true,
    isAoeSave:true,
    toAction:(n,inp)=>({
      type:         "placeAoeTargets",
      cardTitle:    n.data.cardTitle ?? "AoE Targets",
      shape:        n.data.shape     ?? "circle",
      size:         inp.size         ?? n.data.size ?? 20,
      angle:        n.data.angle     ?? 53.13,
      persist:      (n.data.persist  ?? "no") === "yes"
    })
  },

  act_place_aoe_save_branch: {
    hidden:true, replacement:"act_save_dc",
    title:"Chat AoE — Save", color:"#8a5a2a", cat:"Effects", wideNode:true,
    desc:"Posts a chat card with a 'Place Template' button. When placed, every token inside rolls a save. Connect Saved[]/Failed[]/All[] value outputs to the Targets pin of downstream Damage / Heal / Effect nodes.",
    inputs:[
      {id:"exec", label:"",          type:"exec"},
      {id:"size", label:"Size (ft)", type:"value.number"},
      {id:"dc",   label:"DC",        type:"value.number"}
    ],
    outputs:[
      {id:"exec",   label:"→",        type:"exec"},
      {id:"saved",  label:"Saved[]",  type:"value.array"},
      {id:"failed", label:"Failed[]", type:"value.array"},
      {id:"all",    label:"All[]",    type:"value.array"}
    ],
    fields:[
      {key:"cardTitle",   label:"Card title",       type:"text",   default:"AoE Save"},
      {key:"shape",       label:"Shape",            type:"select", options:["circle","cone","ray","rect","ellipse"], default:"circle"},
      {key:"size",        label:"Size (ft)",        type:"number", default:20},
      {key:"angle",       label:"Cone angle (deg)", type:"number", default:53.13, visibleIf:d=>d.shape==="cone"},
      {key:"saveAttr",    label:"Save attr path",   type:"path",   default:"system.attributes.dex.value"},
      {key:"dc",          label:"DC",               type:"number", default:15},
      {key:"flavor",      label:"Save label",       type:"text",   default:"Saving Throw"},
      {key:"rollMode",    label:"Roll mode",        type:"select", options:["public","gmroll","blindroll","selfroll"], default:"public"},
      {key:"showInChat",  label:"Show in chat",     type:"select", options:["yes","no"], default:"yes"},
      {key:"advMode",     label:"Adv / Dis mode",   type:"select", options:["none","adv","dis","ask"], default:"none"},
      {key:"advFormula",  label:"Adv core formula", type:"text",   default:"", placeholder:"2d20kh1 (default)"},
      {key:"disFormula",  label:"Dis core formula", type:"text",   default:"", placeholder:"2d20kl1 (default)"},
      {key:"persist",     label:"Keep template on map",   type:"select", options:["yes","no"], default:"no"}
    ],
    isAction:true,
    isAoeSave:true,
    toAction:(n,inp)=>({
      type:         "placeAoeSaveBranch",
      cardTitle:    n.data.cardTitle ?? "AoE Save",
      shape:        n.data.shape     ?? "circle",
      size:         inp.size         ?? n.data.size ?? 20,
      angle:        n.data.angle     ?? 53.13,
      saveAttr:     n.data.saveAttr  ?? "system.attributes.dex.value",
      dc:           (v => Number.isFinite(v) ? v : 15)(Number(inp.dc ?? n.data.dc ?? 15)),
      flavor:       n.data.flavor    ?? "Saving Throw",
      rollMode:     n.data.rollMode  ?? "public",
      showInChat:   (n.data.showInChat ?? "yes") !== "no",
      advMode:      n.data.advMode    ?? "none",
      advFormula:   n.data.advFormula ?? "",
      disFormula:   n.data.disFormula ?? "",
      persist:      (n.data.persist   ?? "no")  === "yes"
    })
  },

  act_remove_aura: {
    title:"Remove Aura", color:"#6a1a3a", cat:"Effects",
    desc:"Removes the aura(s) matching the given key from the owner token and clears the linked Active Effect from any tokens currently inside.",
    inputs:[
      {id:"exec",  label:"",       type:"exec"},
      {id:"owner", label:"Owner",  type:"value.actor"}
    ],
    outputs:[{id:"exec", label:"→", type:"exec"}],
    fields:[
      {key:"auraKey", label:"Aura key", type:"text",   default:"aura"},
      {key:"owner",   label:"Owner",    type:"select", default:"self", options:["self","selected_token","token_target"]}
    ],
    isAction:true,
    toAction:(n,inp)=>({
      type:    "removeAura",
      auraKey: n.data.auraKey ?? "aura",
      owner:   inp.owner      ?? n.data.owner ?? "self"
    })
  },

  gate: {
    title:"Guard (Condition)", color:"#5a2a8a", cat:"Flow Control",
    desc:"Runs Out only when Condition is true. This is a stateless guard, not Unreal Engine’s stateful Gate (Open/Close/Toggle).",
    inputs:[
      {id:"exec",label:"",type:"exec"},
      {id:"cond",label:"Condition",type:"value.bool"}
    ],
    outputs:[{id:"exec",label:"Pass →",type:"exec"}],
    fields:[],
    isIfCompare:true,
    condition:(_,inp)=>inp.cond ?? "0"
  },

  reroute: {
    title:"•", color:"#2a2a3a", cat:"Flow Control",
    desc:"Visual wire re-routing point. No logic — just keeps graphs tidy.",
    inputs:[{id:"v",label:"",type:"value.any"}],
    outputs:[{id:"v",label:"",type:"value.any"}],
    fields:[],
    isReroute: true,
    compile:(_,i)=> i.v !== undefined ? String(i.v) : "0"
  },

  ternary: {
    title:"Select (Boolean)", color:"#6a1a6a", cat:"Values",
    desc:"Outputs True value when Condition is truthy, False value otherwise. Equivalent to (cond ? a : b). Eliminates common Branch→Output patterns.",
    inputs:[
      {id:"cond",  label:"Condition", type:"value.bool"},
      {id:"a",     label:"True val",  type:"value.any"},
      {id:"b",     label:"False val", type:"value.any"}
    ],
    outputs:[{id:"v", label:"Out", type:"value.any"}],
    fields:[
      {key:"a", label:"True (const)",  type:"text", default:"1"},
      {key:"b", label:"False (const)", type:"text", default:"0"}
    ],
    compile:(n,i)=>{
      const c = i.cond ?? "0";
      const a = i.a    ?? n.data?.a ?? "1";
      const b = i.b    ?? n.data?.b ?? "0";
      return `(${c}?${a}:${b})`;
    }
  },

  random_num: {
    title:"Random", color:"#2a4a6a", cat:"Values",
    desc:"Output a uniformly random integer between Min and Max (inclusive). Re-evaluated each time the formula runs.",
    inputs:[
      {id:"min", label:"Min", type:"value.number"},
      {id:"max", label:"Max", type:"value.number"}
    ],
    outputs:[{id:"v", label:"Value", type:"value.number"}],
    fields:[
      {key:"min", label:"Min", type:"number", default:1},
      {key:"max", label:"Max", type:"number", default:6}
    ],
    compile:(n,i)=>{
      const lo = i.min ?? n.data?.min ?? 1;
      const hi = i.max ?? n.data?.max ?? 6;
      return `floor(random*(${hi}-${lo}+1)+${lo})`;
    }
  },

  get_var: {
    title:"Get Variable", color:"#2a3a5a", cat:"Sources",
    hidden:true, replacement:"var_read",
    desc:"Read a named variable stored on this actor (actor.flags.sd.vars.NAME). Use with Set Variable to pass data between button clicks or graph segments.",
    inputs:[], outputs:[{id:"v", label:"Value", type:"value.any"}],
    fields:[{key:"name", label:"Variable Name", type:"text", default:"myVar", placeholder:"e.g. lastRollResult"}],
    compile:(n)=>`{var:${n.data.name??"myVar"}}`
  },

  mod: {
    title:"Remainder", color:"#1a5c2a", cat:"Math",
    inputs:[{id:"a",label:"A",type:"value.number"},{id:"b",label:"B",type:"value.number"}], outputs:[{id:"v",label:"",type:"value.number"}],
    fields:[_ROUND_FIELD], desc:"Integer remainder of A ÷ B",
    compile:(n,i)=>_round(`(${i.a??"0"}%${i.b??"1"})`, n.data)
  },

  pow: {
    title:"Power", color:"#1a5c2a", cat:"Math",
    inputs:[{id:"a",label:"Base",type:"value.number"},{id:"b",label:"Exp",type:"value.number"}], outputs:[{id:"v",label:"",type:"value.number"}],
    fields:[_ROUND_FIELD], desc:"A raised to the power of B",
    compile:(n,i)=>_round(`(${i.a??"0"}**${i.b??"2"})`, n.data)
  },

  sign: {
    title:"Sign", color:"#1a5c2a", cat:"Math",
    inputs:[{id:"a",label:"A",type:"value.number"}], outputs:[{id:"v",label:"",type:"value.number"}],
    fields:[], desc:"Returns -1, 0 or +1 based on the sign of A",
    compile:(_,i)=>`(${i.a??"0"}>0?1:${i.a??"0"}<0?-1:0)`
  },

  act_play_sound: {
    title:"Play Sound", color:"#4a2a7a", cat:"System",
    desc:"Play a sound file via Foundry's AudioHelper. Path is relative to the Data folder or a full URL. Src / Volume / Loop can all be fed via pins.",
    inputs:[
      {id:"exec",   label:"",       type:"exec"},
      {id:"src",    label:"Source", type:"value.string"},
      {id:"volume", label:"Volume", type:"value.number"},
      {id:"loop",   label:"Loop",   type:"value.bool"}
    ],
    outputs:[{id:"exec",label:"",type:"exec"}],
    fields:[
      {key:"src",    label:"Sound path / URL", type:"text",   default:"sounds/dice.wav", placeholder:"sounds/dice.wav"},
      {key:"volume", label:"Volume (0вЂ“1)",      type:"number", default:0.8},
      {key:"loop",   label:"Loop",              type:"select", default:"no", options:["no","yes"]}
    ],
    isAction:true, wideNode:true,
    toAction:(n,inp)=>({
      type:   "playSound",
      src:    (inp.src != null && inp.src !== "") ? String(inp.src) : (n.data.src ?? "sounds/dice.wav"),
      volume: (inp.volume != null && inp.volume !== "") ? Number(inp.volume) : Number(n.data.volume ?? 0.8),
      loop:   (inp.loop != null && inp.loop !== "") ? coerceBool(inp.loop) : (n.data.loop === "yes")
    })
  },

  act_run_macro: {
    title:"Run Macro", color:"#4a4a7a", cat:"System",
    desc:"Execute a world Macro by exact name. The macro runs with the current actor and token as speaker context. Macro name can be fed via pin.",
    inputs:[
      {id:"exec",      label:"",            type:"exec"},
      {id:"macroName", label:"Macro Name",  type:"value.string"}
    ],
    outputs:[{id:"exec",label:"",type:"exec"}],
    fields:[
      {key:"macroName", label:"Macro Name", type:"text", default:"", placeholder:"exact name from Macros directory"}
    ],
    isAction:true, wideNode:true,
    toAction:(n,inp)=>({type:"runMacro",
      macroName: (inp.macroName != null && inp.macroName !== "") ? String(inp.macroName) : (n.data.macroName ?? "")
    })
  },

  act_notify: {
    title:"Notify", color:"#4a4a1a", cat:"Chat",
    desc:"Show a toast notification (info / warning / error) to the current user. Useful for feedback without a full chat message. Both Message and Level can be fed via pins.",
    inputs:[
      {id:"exec",  label:"",        type:"exec"},
      {id:"text",  label:"Message", type:"value.string"},
      {id:"level", label:"Level",   type:"value.string"}
    ],
    outputs:[{id:"exec",label:"",type:"exec"}],
    fields:[
      {key:"text",  label:"Default text", type:"text",   default:"Done!"},
      {key:"level", label:"Level",        type:"select", default:"info", options:["info","warn","error"]}
    ],
    isAction:true,
    toAction:(n,inp)=>({
      type:  "notify",
      text:  inp.text ?? n.data.text ?? "Done!",
      level: (inp.level != null && inp.level !== "") ? String(inp.level) : (n.data.level ?? "info")
    })
  },

  act_set_var: {
    title:"Set Variable", color:"#2a3a6a", cat:"Field Ops",
    hidden:true, replacement:"var_write",
    desc:"Store a value in actor.flags.sd.vars.NAME (or world settings) for retrieval later. Useful for persisting roll results between button presses. Name and Scope can be fed via pins (UE-style — when wired the matching field hides).",
    inputs:[
      {id:"exec",  label:"",        type:"exec"},
      {id:"name",  label:"Name",    type:"value.string"},
      {id:"value", label:"Value",   type:"value.any"},
      {id:"scope", label:"Scope",   type:"value.string"}
    ],
    outputs:[{id:"exec",label:"",type:"exec"}],
    fields:[
      {key:"name",  label:"Variable Name", type:"text",   default:"myVar", placeholder:"e.g. lastRollResult"},
      {key:"scope", label:"Scope",         type:"select", default:"actor", options:["actor","world"]}
    ],
    isAction:true,
    toAction:(n,inp)=>({
      type:  "setVar",
      name:  (inp.name  != null && inp.name  !== "") ? String(inp.name)  : (n.data.name  ?? "myVar"),
      value: inp.value    ?? 0,
      scope: (inp.scope != null && inp.scope !== "") ? String(inp.scope) : (n.data.scope ?? "actor")
    })
  },

  act_open_sheet: {
    title:"Open Sheet", color:"#2a3a6a", cat:"Chat",
    desc:"Open the sheet window of another Actor or Item by UUID. Useful for 'Inspect' buttons on slot items. UUID and Require-ownership can be fed via pins.",
    inputs:[
      {id:"exec",    label:"",         type:"exec"},
      {id:"uuid",    label:"UUID",     type:"value.uuid"},
      {id:"asOwner", label:"As Owner", type:"value.bool"}
    ],
    outputs:[{id:"exec",label:"",type:"exec"}],
    fields:[
      {key:"uuid",    label:"UUID (or drag here)", type:"text",   default:"", placeholder:"Actor.xxx or Item.xxx"},
      {key:"asOwner", label:"Require ownership",   type:"select", default:"yes", options:["yes","no"]}
    ],
    isAction:true, wideNode:true,
    toAction:(n,inp)=>({
      type:     "openSheet",
      uuid:     inp.uuid ?? n.data.uuid ?? "",
      asOwner:  (inp.asOwner != null && inp.asOwner !== "") ? coerceBool(inp.asOwner) : (n.data.asOwner !== "no")
    })
  },

  act_roll_table: {
    title:"Roll Table", color:"#7a4500", cat:"Chat",
    desc:"Roll on a world RollTable. Found→ fires when at least one result is drawn. Empty→ fires when the table is empty or not found. Result text and index available as value outputs. Use drawCount > 1 to draw multiple entries — {__rollTableIndex} tracks the current draw (0-based).",
    inputs:[
      {id:"exec",      label:"",           type:"exec"},
      {id:"formula",   label:"Formula",    type:"value.string"},
      {id:"drawCount", label:"Draw count", type:"value.number"}
    ],
    outputs:[
      {id:"found",  label:"Found →",      type:"exec"},
      {id:"empty",  label:"Empty →",      type:"exec"},
      {id:"result", label:"Result text",  type:"value.any"},
      {id:"index",  label:"Draw index",   type:"value.number"}
    ],
    fields:[
      {key:"tableName",  label:"Table Name (exact)",  type:"text",   default:"",    placeholder:"exact table name"},
      {key:"tableUuid",  label:"…or Table UUID",      type:"text",   default:"",    placeholder:"RollTable.xxxx"},
      {key:"formula",    label:"Default formula",     type:"text",   default:"1d6", placeholder:"1d6"},
      {key:"drawCount",  label:"Draw count",          type:"number", default:1},
      {key:"toChat",     label:"Post to chat",        type:"select", default:"yes", options:["yes","no"]},
      {key:"replacement",label:"With replacement",    type:"select", default:"yes", options:["yes","no"]}
    ],
    isRollTableBranch:true, wideNode:true,
    toAction:(n,inp)=>({
      type:        "rollTable",
      tableName:   n.data.tableName   ?? "",
      tableUuid:   n.data.tableUuid   ?? "",
      formula:     inp.formula        ?? n.data.formula    ?? "1d6",
      drawCount:   inp.drawCount      ?? n.data.drawCount  ?? 1,
      toChat:      n.data.toChat      !== "no",
      replacement: n.data.replacement !== "no"
    })
  },

  chat_save_button: {
    hidden:true, replacement:"act_save_dc",
    title:"Save / Check Button", color:"#7a3a00", cat:"Dice & Rolls",
    desc:"Posts a chat card with an interactive 'Roll Save' or 'Roll Check' button. The target player clicks it to roll 1d20 + modifier vs the configured DC. Works like dnd5e saving throw / ability check prompts in chat. Connect pass/fail exec branches for follow-up actions. The button supports any attribute path, skill path, or custom modifier field. Crit / Fumble are external bool inputs — wire them from your own comparison logic. Reroll button (yes/no) adds a Re-roll button to the resulting roll message; Reroll Path / Reroll Cost optionally consume a numeric resource from the rolling actor each time they reroll.",
    inputs:[
      {id:"exec",          label:"",              type:"exec"},
      {id:"dc",            label:"DC",             type:"value.number"},
      {id:"target",        label:"Target",         type:"value.actor"},
      {id:"rollFormula",   label:"Roll Formula",   type:"value.string"},
      {id:"advFormula",    label:"Adv Formula",    type:"value.string"},
      {id:"disFormula",    label:"Dis Formula",    type:"value.string"},
      {id:"isCrit",        label:"Is Crit?",       type:"value.bool"},
      {id:"isFumble",      label:"Is Fumble?",     type:"value.bool"},
      {id:"rerollEnabled", label:"Reroll button",  type:"value.bool"},
      {id:"rerollPath",    label:"Reroll Path",    type:"value.path"},
      {id:"rerollCost",    label:"Reroll Cost",    type:"value.number"}
    ],
    outputs:[
      {id:"pass",        label:"Pass →",     type:"exec"},
      {id:"fail",        label:"Fail →",     type:"exec"},
      {id:"result",      label:"Roll Result",type:"value.any"},
      {id:"formula",     label:"Formula",    type:"value.string"},
      {id:"min",         label:"Min",        type:"value.number"},
      {id:"max",         label:"Max",        type:"value.number"},
      {id:"avg",         label:"Avg",        type:"value.number"},
      {id:"natural",     label:"Natural",    type:"value.number"},
      {id:"isCrit",      label:"Is Crit",    type:"value.bool"},
      {id:"isFumble",    label:"Is Fumble",  type:"value.bool"},
      {id:"diceArray",   label:"Dice Array", type:"value.array"}
    ],
    fields:[
      {key:"checkType",    label:"Check type",    type:"select", default:"save", options:["save","ability","skill","custom"]},
      {key:"modifierPath",  label:"Modifier path", type:"path",   default:"system.attributes.attr1.mod", placeholder:"system.attributes.attr1.mod"},
      {key:"dc",            label:"Default DC",    type:"number", default:15},
      {key:"flavor",        label:"Label",         type:"text",   default:"Saving Throw"},
      {key:"buttonLabel",   label:"Button text",   type:"text",   default:"Roll Save", placeholder:"Roll Save / Roll Check"},
      {key:"target",        label:"Prompt who",    type:"select", default:"token_target", options:["actor","token_target","selected_token","all_targets","selected_tokens"]},
      {key:"rollMode",      label:"Roll mode",     type:"select", default:"publicroll", options:["publicroll","gmroll","blindroll","selfroll"]},
      {key:"rollFormula",   label:"Roll formula",  type:"text",   default:"", placeholder:"e.g. 1d20, 2d6, d20 (empty = 1d20)"},
      {key:"rollDialogue",  label:"Roll dialog", type:"select", default:"no", options:["no","yes"]},
      {key:"advFormula",    label:"Adv formula (pin>field)", type:"text", default:"", placeholder:"e.g. 2d20kh1 + @mod"},
      {key:"disFormula",    label:"Dis formula (pin>field)", type:"text", default:"", placeholder:"e.g. 2d20kl1 + @mod"},
      {key:"timeout",       label:"Timeout (sec, 0=в€ћ)", type:"number", default:0},
      {key:"rerollEnabled", label:"Reroll button",  type:"select", default:"no", options:["no","yes"]},
      {key:"rerollPath",    label:"Reroll resource path", type:"path", default:"", placeholder:"e.g. system.resources.luck.value"},
      {key:"rerollCost",    label:"Reroll cost",  type:"number", default:1}
    ],
    isSaveBranch: true,
    toAction:(n,inp)=>{
      const rollFormula = (inp.rollFormula != null && inp.rollFormula !== "") ? inp.rollFormula : (n.data.rollFormula || "1d20");
      const advFormula  = (inp.advFormula  != null && inp.advFormula  !== "") ? inp.advFormula  : (n.data.advFormula ?? "");
      const disFormula  = (inp.disFormula  != null && inp.disFormula  !== "") ? inp.disFormula  : (n.data.disFormula ?? "");
      const _rrRaw = (inp.rerollEnabled != null && inp.rerollEnabled !== "") ? inp.rerollEnabled : n.data.rerollEnabled;
      const rerollEnabled = (_rrRaw === true || _rrRaw === "yes" || _rrRaw === 1 || _rrRaw === "1") ? "yes" : "no";
      return {
        type: "chatSaveButton",
        checkType:    n.data.checkType    ?? "save",
        modifierPath: n.data.modifierPath ?? "system.attributes.attr1.mod",
        dc:           inp.dc ?? n.data.dc ?? 15,
        flavor:       n.data.flavor       ?? "Saving Throw",
        buttonLabel:  n.data.buttonLabel  ?? "Roll Save",
        target:       (inp.target!=null && inp.target!=="" && inp.target!=="0") ? inp.target : (n.data.target ?? "token_target"),
        rollMode:     n.data.rollMode     ?? "publicroll",
        rollFormula,
        rollDialogue: n.data.rollDialogue === "yes",
        advFormula,
        disFormula,
        timeout:      Number(n.data.timeout ?? 0),
        rerollEnabled,
        rerollPath: (inp.rerollPath != null && inp.rerollPath !== "") ? String(inp.rerollPath) : (n.data.rerollPath ?? ""),
        rerollCost: Number((inp.rerollCost != null && inp.rerollCost !== "") ? inp.rerollCost : (n.data.rerollCost ?? 1)) || 0,
        isCrit:    (inp.isCrit   != null && inp.isCrit   !== "") ? inp.isCrit   : null,
        isFumble:  (inp.isFumble != null && inp.isFumble !== "") ? inp.isFumble : null
      };
    }
  },


  act_damage_simple: {
    title:"Damage", color:"#8a1a1a", cat:"Combat", wideNode:true,
    desc:"Final damage delivery only. Supply an already-calculated Value and a Token Pool. This node does not select targets, calculate saves, critical hits, resistances, or damage types.",
    inputs:[
      {id:"exec",label:"",type:"exec"},
      {id:"amount",label:"Value",type:"value.number"},
      {id:"targets",label:"Token Pool",type:"value.token_pool"}
    ],
    outputs:[{id:"exec",label:"Done →",type:"exec"}],
    fields:[
      {key:"label",label:"Title",type:"text",default:"Damage", noPin:true},
      {key:"customText",label:"Custom text",type:"textarea",default:"",placeholder:"Optional text shown in the chat card", noPin:true},
      {key:"buttonLabel",label:"Apply button text",type:"text",default:"Apply Damage", noPin:true},
      {key:"hpPath",label:"HP path",type:"path",default:"system.resources.hp.value", noPin:true},
      {key:"postToChat",label:"Post to chat",type:"select",default:"yes",options:["yes","no"]},
      {key:"autoApply",label:"Apply automatically",type:"select",default:"no",options:["no","yes"]},
      {key:"showApply",label:"Show Apply button",type:"select",default:"yes",options:["yes","no"]}
    ],
    isAction:true,
    toAction:(n,inp)=>({
      type:"chatDamage", amount:String(inp.amount ?? 0), targets:inp.targets ?? null,
      target:"none", requireTargets:true, label:n.data.label ?? "Damage",
      customText:n.data.customText ?? "", buttonLabel:n.data.buttonLabel ?? "Apply Damage",
      hpPath:n.data.hpPath ?? "system.resources.hp.value",
      silent:n.data.postToChat === "no", autoApply:n.data.autoApply === "yes",
      showApply:n.data.showApply !== "no", simpleDelivery:true
    })
  },

  act_heal_simple: {
    title:"Heal", color:"#1a7a2a", cat:"Combat", wideNode:true,
    desc:"Final healing delivery only. Supply an already-calculated Value and a Token Pool. All target selection and calculations stay in the graph.",
    inputs:[
      {id:"exec",label:"",type:"exec"},
      {id:"amount",label:"Value",type:"value.number"},
      {id:"targets",label:"Token Pool",type:"value.token_pool"}
    ],
    outputs:[{id:"exec",label:"Done →",type:"exec"}],
    fields:[
      {key:"label",label:"Title",type:"text",default:"Healing", noPin:true},
      {key:"customText",label:"Custom text",type:"textarea",default:"",placeholder:"Optional text shown in the chat card", noPin:true},
      {key:"buttonLabel",label:"Apply button text",type:"text",default:"Apply Healing", noPin:true},
      {key:"hpPath",label:"HP path",type:"path",default:"system.resources.hp.value", noPin:true},
      {key:"postToChat",label:"Post to chat",type:"select",default:"yes",options:["yes","no"]},
      {key:"autoApply",label:"Apply automatically",type:"select",default:"no",options:["no","yes"]},
      {key:"showApply",label:"Show Apply button",type:"select",default:"yes",options:["yes","no"]}
    ],
    isAction:true,
    toAction:(n,inp)=>({
      type:"chatHeal", amount:String(inp.amount ?? 0), targets:inp.targets ?? null,
      target:"none", requireTargets:true, label:n.data.label ?? "Healing",
      customText:n.data.customText ?? "", buttonLabel:n.data.buttonLabel ?? "Apply Healing",
      hpPath:n.data.hpPath ?? "system.resources.hp.value",
      silent:n.data.postToChat === "no", autoApply:n.data.autoApply === "yes",
      showApply:n.data.showApply !== "no", simpleDelivery:true
    })
  },

  act_save_dc: {
    title:"Save / DC", color:"#7a3a00", cat:"Dice & Rolls", wideNode:true,
    desc:"Requests a roll for every token in Token Pool and compares it with DC. Passed? is an optional boolean override: when connected, no roll is requested and the whole pool follows that branch. The node only branches and returns token pools; all consequences are built downstream.",
    inputs:[
      {id:"exec",label:"",type:"exec"},
      {id:"passed",label:"Passed? (override)",type:"value.bool"},
      {id:"dc",label:"DC",type:"value.number"},
      {id:"rollFormula",label:"Roll Formula",type:"value.string"},
      {id:"targets",label:"Token Pool",type:"value.token_pool"}
    ],
    outputs:[
      {id:"pass",label:"Passed →",type:"exec"},
      {id:"fail",label:"Failed →",type:"exec"},
      {id:"passedTargets",label:"Passed Tokens[]",type:"value.token_pool"},
      {id:"failedTargets",label:"Failed Tokens[]",type:"value.token_pool"},
      {id:"allTargets",label:"All Tokens[]",type:"value.token_pool"},
      {id:"result",label:"Last Roll",type:"value.any"}
    ],
    fields:[
      {key:"operator",label:"Pass if",type:"select",default:">=",options:[">=",">","<=","<","==","!="]},
      {key:"dc",label:"Default DC",type:"number",default:15},
      {key:"rollFormula",label:"Default roll formula",type:"text",default:"1d20",placeholder:"1d20 + @mod"},
      {key:"flavor",label:"Title",type:"text",default:"Saving Throw", noPin:true},
      {key:"customText",label:"Custom text",type:"textarea",default:"",placeholder:"Describe the requested save", noPin:true},
      {key:"buttonLabel",label:"Roll button text",type:"text",default:"Roll", noPin:true},
      {key:"rollMode",label:"Roll mode",type:"select",default:"publicroll",options:["publicroll","gmroll","blindroll","selfroll"]},
      {key:"rollDialogue",label:"Roll dialog",type:"select",default:"no",options:["no","yes"]},
      {key:"postToChat",label:"Post request to chat",type:"select",default:"yes",options:["yes","no"]}
    ],
    isSaveBranch:true,
    toAction:(n,inp)=>({
      type:"chatSaveButtonV2",
      passedOverride:inp.passed ?? null,
      dc:inp.dc ?? n.data.dc ?? 15,
      rollFormula:(inp.rollFormula != null && inp.rollFormula !== "") ? inp.rollFormula : (n.data.rollFormula ?? "1d20"),
      targets:inp.targets ?? null,
      operator:n.data.operator ?? ">=",
      flavor:n.data.flavor ?? "Saving Throw",
      customText:n.data.customText ?? "",
      buttonLabel:n.data.buttonLabel ?? "Roll",
      rollMode:n.data.rollMode ?? "publicroll",
      rollDialogue:n.data.rollDialogue === "yes",
      postToChat:n.data.postToChat !== "no"
    })
  },

  act_aoe_template_saver: {
    title:"AOE Template Saver", color:"#355a8a", cat:"Effects", wideNode:true,
    desc:"Foundry v14: save selected Scene Regions as persistent presets. Auto uses the current Item/Actor and falls back to World storage when the graph has no document owner. V13 Measured Templates remain a fallback.",
    inputs:[{id:"exec",label:"",type:"exec"}],
    outputs:[
      {id:"confirmed",label:"Confirmed →",type:"exec"},
      {id:"cancelled",label:"Cancelled →",type:"exec"},
      {id:"templates",label:"Templates[]",type:"value.aoe_templates"}
    ],
    fields:[
      {key:"title",label:"Dialog title",type:"text",default:"AOE Templates", noPin:true},
      {key:"allowEmpty",label:"Allow empty list",type:"select",default:"no",options:["no","yes"]},
      {key:"storageMode",label:"Preset storage",type:"select",default:"auto",options:[
        {value:"auto",label:"Auto — Item / Actor / World fallback"},
        {value:"world",label:"World"},
        {value:"actor",label:"Current Actor"},
        {value:"item",label:"Current Item"},
        {value:"runtime",label:"Runtime only"}
      ]}
    ],
    isGenericBranch:true,
    toAction:(n)=>({type:"aoeTemplateSaver",title:n.data.title ?? "AOE Templates",allowEmpty:n.data.allowEmpty === "yes",storageMode:n.data.storageMode ?? "auto",storageKey:n.id})
  },

  act_choice_from_array: {
    title:"Choice From Array", color:"#5a3a8a", cat:"Flow Control", wideNode:true,
    desc:"Opens a dialog and lets the user choose one or more values from an array. Execution continues only after Confirm or Cancel.",
    inputs:[
      {id:"exec",label:"",type:"exec"},
      {id:"array",label:"Array",type:"value.array"}
    ],
    outputs:[
      {id:"confirmed",label:"Confirmed →",type:"exec"},
      {id:"cancelled",label:"Cancelled →",type:"exec"},
      {id:"selected",label:"Selected",type:"value.any"},
      {id:"selectedArray",label:"Selected[]",type:"value.array"},
      {id:"index",label:"Index",type:"value.number"},
      {id:"indices",label:"Indices[]",type:"value.array"}
    ],
    fields:[
      {key:"title",label:"Dialog title",type:"text",default:"Choose", noPin:true},
      {key:"text",label:"Description",type:"textarea",default:"", noPin:true},
      {key:"multiple",label:"Multiple selection",type:"select",default:"no",options:["no","yes"]},
      {key:"min",label:"Minimum choices",type:"number",default:1, noPin:true},
      {key:"max",label:"Maximum choices (0 = unlimited)",type:"number",default:0, noPin:true},
      {key:"labelPath",label:"Label property",type:"text",default:"name",placeholder:"name / label / title", noPin:true},
      {key:"imagePath",label:"Image property",type:"text",default:"img",placeholder:"img / icon", noPin:true},
      {key:"confirmLabel",label:"Confirm text",type:"text",default:"Confirm", noPin:true}
    ],
    isGenericBranch:true,
    toAction:(n,inp)=>({
      type:"choiceFromArray",array:inp.array ?? [],title:n.data.title ?? "Choose",text:n.data.text ?? "",
      multiple:n.data.multiple === "yes",min:Math.max(0,Number(n.data.min ?? 1)||0),
      max:Math.max(0,Number(n.data.max ?? 0)||0),labelPath:n.data.labelPath ?? "name",
      imagePath:n.data.imagePath ?? "img",confirmLabel:n.data.confirmLabel ?? "Confirm"
    })
  },

  act_place_aoe_template: {
    title:"Place AOE Template", color:"#37698a", cat:"Effects", wideNode:true,
    desc:"Chooses one portable area snapshot and places it through RegionLayer.placeRegion in Foundry v14. It returns the tokens inside and performs no save, damage, healing, or effect logic.",
    inputs:[
      {id:"exec",label:"",type:"exec"},
      {id:"templates",label:"Templates[]",type:"value.aoe_templates"}
    ],
    outputs:[
      {id:"exec",label:"Placed →",type:"exec"},
      {id:"targets",label:"Tokens Inside[]",type:"value.token_pool"},
      {id:"template",label:"Placed Template",type:"value.aoe_template"}
    ],
    fields:[
      {key:"title",label:"Chat title",type:"text",default:"Place Area Template", noPin:true},
      {key:"buttonLabel",label:"Button text",type:"text",default:"Place Template", noPin:true},
      {key:"persist",label:"Keep template on map",type:"select",default:"yes",options:["yes","no"]}
    ],
    isAoeSave:true,
    toAction:(n,inp)=>({type:"placeAoeTemplateV2",templates:inp.templates ?? [],title:n.data.title ?? "Place Area Template",buttonLabel:n.data.buttonLabel ?? "Place Template",persist:n.data.persist !== "no"})
  },

  act_tokens_from_aoe: {
    title:"Tokens From AOE", color:"#37698a", cat:"Effects", wideNode:true,
    desc:"Reads the tokens currently inside an existing placed template or region.",
    inputs:[
      {id:"exec",label:"",type:"exec"},
      {id:"template",label:"Template",type:"value.aoe_template"}
    ],
    outputs:[
      {id:"found",label:"Found →",type:"exec"},
      {id:"missing",label:"Missing →",type:"exec"},
      {id:"targets",label:"Tokens[]",type:"value.token_pool"},
      {id:"count",label:"Count",type:"value.number"}
    ],
    fields:[],isGenericBranch:true,
    toAction:(n,inp)=>({type:"tokensFromAoe",template:inp.template ?? null})
  },

  act_spell: {
    title:"Spell", color:"#4a3a9a", cat:"Effects", wideNode:true,
    desc:"Adaptive chat card. AOE?, Target?, and Effect? only control the card sections. The node presents and returns context; all save, damage, healing, and effect consequences are built downstream.",
    inputs:[
      {id:"exec",label:"",type:"exec"},
      {id:"isAoe",label:"AOE?",type:"value.bool"},
      {id:"hasTarget",label:"Target?",type:"value.bool"},
      {id:"hasEffect",label:"Effect?",type:"value.bool"},
      {id:"targets",label:"Token Pool",type:"value.token_pool"},
      {id:"templates",label:"Templates[]",type:"value.aoe_templates"},
      {id:"effect",label:"Effect",type:"value.effect"},
      {id:"value",label:"Value",type:"value.any"},
      {id:"text",label:"Custom Text",type:"value.string"}
    ],
    outputs:[
      {id:"exec",label:"Cast →",type:"exec"},
      {id:"targets",label:"Tokens[]",type:"value.token_pool"},
      {id:"template",label:"Template",type:"value.aoe_template"},
      {id:"effect",label:"Effect",type:"value.effect"},
      {id:"value",label:"Value",type:"value.any"}
    ],
    fields:[
      {key:"title",label:"Spell title",type:"text",default:"Spell", noPin:true},
      {key:"customText",label:"Default text",type:"textarea",default:"", noPin:true},
      {key:"buttonLabel",label:"Cast button text",type:"text",default:"Cast", noPin:true},
      {key:"persist",label:"Keep AOE template",type:"select",default:"yes",options:["yes","no"]}
    ],
    isAoeSave:true,
    toAction:(n,inp)=>({
      type:"spellCardV2",title:n.data.title ?? "Spell",buttonLabel:n.data.buttonLabel ?? "Cast",
      text:(inp.text != null && inp.text !== "") ? inp.text : (n.data.customText ?? ""),
      isAoe:inp.isAoe ?? 0,hasTarget:inp.hasTarget ?? 0,hasEffect:inp.hasEffect ?? 0,
      targets:inp.targets ?? null,templates:inp.templates ?? [],effect:inp.effect ?? null,value:inp.value ?? null,
      persist:n.data.persist !== "no"
    })
  },



  // ── v0.15 composable Roll Result pipeline ──────────────────────────────
  act_roll_v2: {
    title:"Roll", color:"#8a4400", cat:"Dice & Rolls", wideNode:true,
    desc:"Evaluates a formula or dice pool and returns one typed Roll Result, the numeric total, and an array containing every active die result. This node does not decide success and does not post to chat; connect Analyze, Compare and Present nodes.",
    inputs:[
      {id:"exec",label:"",type:"exec"},
      {id:"formula",label:"Formula",type:"value.string"},
      {id:"count",label:"Pool Count",type:"value.number"},
      {id:"successTarget",label:"Success Target",type:"value.number"},
      {id:"advFormula",label:"Adv Formula",type:"value.string"},
      {id:"disFormula",label:"Dis Formula",type:"value.string"}
    ],
    outputs:[
      {id:"exec",label:"Rolled →",type:"exec"},
      {id:"result",label:"Roll Result",type:"value.roll_result"},
      {id:"total",label:"Total",type:"value.number"},
      {id:"dice",label:"Dice",type:"value.array"},
      {id:"successes",label:"Successes",type:"value.number"},
      {id:"botches",label:"Botches",type:"value.number"}
    ],
    fields:[
      {key:"mode",label:"Mode",type:"select",default:"formula",options:["formula","pool"],noPin:true},
      {key:"formula",label:"Formula",type:"text",default:"1d20"},
      {key:"flavor",label:"Label",type:"text",default:"Roll",noPin:true},
      {key:"rollDialogue",label:"Roll dialog",type:"select",default:"no",options:["no","yes"],noPin:true},
      {key:"advFormula",label:"Advantage formula",type:"text",default:""},
      {key:"disFormula",label:"Disadvantage formula",type:"text",default:""},
      {key:"count",label:"Pool count",type:"text",default:"5"},
      {key:"die",label:"Pool die faces",type:"number",default:10,noPin:true},
      {key:"successTarget",label:"Success target",type:"text",default:"8"},
      {key:"successCompare",label:"Success comparison",type:"select",default:">=",options:[">=",">","<=","<","==","!="],noPin:true},
      {key:"botchFace",label:"Botch face",type:"number",default:1,noPin:true},
      {key:"critOn",label:"Critical natural ≥",type:"number",default:20,noPin:true},
      {key:"fumbleOn",label:"Fumble natural ≤",type:"number",default:1,noPin:true}
    ],
    isGenericBranch:true,
    toAction:(n,inp)=>({
      type:"rollResultV2",
      mode:n.data.mode??"formula",
      formula:inp.formula??n.data.formula??"1d20",
      count:inp.count??n.data.count??"5",
      die:Number(n.data.die??10),
      successTarget:inp.successTarget??n.data.successTarget??"8",
      successCompare:n.data.successCompare??">=",
      botchFace:Number(n.data.botchFace??1),
      flavor:n.data.flavor??"Roll",
      rollDialogue:n.data.rollDialogue==="yes",
      advFormula:inp.advFormula??n.data.advFormula??"",
      disFormula:inp.disFormula??n.data.disFormula??"",
      critOn:Number(n.data.critOn??20),
      fumbleOn:Number(n.data.fumbleOn??1)
    })
  },

  act_analyze_roll: {
    title:"Analyze Roll", color:"#315b89", cat:"Dice & Rolls", wideNode:true,
    desc:"Breaks a typed Roll Result into reusable values without rolling again.",
    inputs:[{id:"exec",label:"",type:"exec"},{id:"result",label:"Roll Result",type:"value.roll_result"}],
    outputs:[
      {id:"exec",label:"Analyzed →",type:"exec"},
      {id:"result",label:"Roll Result",type:"value.roll_result"},
      {id:"total",label:"Total",type:"value.number"},
      {id:"formula",label:"Formula",type:"value.string"},
      {id:"dice",label:"Dice",type:"value.array"},
      {id:"natural",label:"Natural",type:"value.number"},
      {id:"min",label:"Minimum",type:"value.number"},
      {id:"max",label:"Maximum",type:"value.number"},
      {id:"avg",label:"Average",type:"value.number"},
      {id:"successes",label:"Successes",type:"value.number"},
      {id:"botches",label:"Botches",type:"value.number"},
      {id:"isCrit",label:"Critical",type:"value.bool"},
      {id:"isFumble",label:"Fumble",type:"value.bool"}
    ],
    fields:[], isGenericBranch:true,
    toAction:(n,inp)=>({type:"analyzeRollResult",result:inp.result??"{__rollResult}"})
  },

  act_compare_roll: {
    title:"Compare Roll", color:"#6b3e8e", cat:"Dice & Rolls", wideNode:true,
    desc:"Compares one property of a Roll Result with a value and routes execution to Passed or Failed.",
    inputs:[
      {id:"exec",label:"",type:"exec"},
      {id:"result",label:"Roll Result",type:"value.roll_result"},
      {id:"value",label:"Compare With",type:"value.number"}
    ],
    outputs:[
      {id:"pass",label:"Passed →",type:"exec"},
      {id:"fail",label:"Failed →",type:"exec"},
      {id:"result",label:"Roll Result",type:"value.roll_result"},
      {id:"compared",label:"Compared Value",type:"value.number"},
      {id:"target",label:"Target",type:"value.number"},
      {id:"margin",label:"Margin",type:"value.number"},
      {id:"passed",label:"Passed",type:"value.bool"}
    ],
    fields:[
      {key:"source",label:"Result property",type:"select",default:"total",options:["total","natural","successes","botches","min","max","avg"],noPin:true},
      {key:"operator",label:"Pass if",type:"select",default:">=",options:[">=",">","<=","<","==","!="],noPin:true},
      {key:"value",label:"Compare with",type:"text",default:"10"}
    ],
    isGenericBranch:true,
    toAction:(n,inp)=>({type:"compareRollResult",result:inp.result??"{__rollResult}",value:inp.value??n.data.value??"10",source:n.data.source??"total",operator:n.data.operator??">="})
  },

  act_present_roll: {
    title:"Present Roll", color:"#31705a", cat:"Dice & Rolls", wideNode:true,
    desc:"Displays an existing Roll Result in chat, on the canvas, or over the current actor sheet. It never rolls again.",
    inputs:[{id:"exec",label:"",type:"exec"},{id:"result",label:"Roll Result",type:"value.roll_result"}],
    outputs:[{id:"exec",label:"Presented →",type:"exec"},{id:"result",label:"Roll Result",type:"value.roll_result"}],
    fields:[
      {key:"destination",label:"Destination",type:"select",default:"chat",options:["chat","canvas","sheet"],noPin:true},
      {key:"label",label:"Label override",type:"text",default:"",noPin:true},
      {key:"rollMode",label:"Chat visibility",type:"select",default:"default",options:["default","publicroll","gmroll","blindroll","selfroll"],noPin:true},
      {key:"area",label:"Canvas area (px)",type:"number",default:300,noPin:true},
      {key:"duration",label:"Overlay duration (s)",type:"number",default:6,noPin:true}
    ],
    isGenericBranch:true,
    toAction:(n,inp)=>({type:"presentRollResult",result:inp.result??"{__rollResult}",destination:n.data.destination??"chat",label:n.data.label??"",rollMode:n.data.rollMode??"default",area:Number(n.data.area??300),duration:Number(n.data.duration??6)})
  },

  act_aura_definition: {
    title:"Aura Definition", color:"#39735b", cat:"Effects", wideNode:true,
    desc:"Builds a portable Aura definition. It does not place anything or apply consequences; connect it to Place Aura.",
    inputs:[
      {id:"exec",label:"",type:"exec"},
      {id:"owner",label:"Owner",type:"value.actor"},
      {id:"size",label:"Size",type:"value.number"}
    ],
    outputs:[
      {id:"exec",label:"Built →",type:"exec"},
      {id:"aura",label:"Aura",type:"value.object"}
    ],
    fields:[
      {key:"name",label:"Name",type:"text",default:"Aura",noPin:true},
      {key:"shape",label:"Shape",type:"select",default:"emanation",options:["emanation","circle","cone","ray","rect","ellipse"]},
      {key:"size",label:"Size (ft)",type:"number",default:10},
      {key:"angle",label:"Cone angle",type:"number",default:53.13,noPin:true},
      {key:"owner",label:"Owner fallback",type:"select",default:"actor",options:["actor","selected_token","token_target"]},
      {key:"tickMode",label:"Trigger",type:"select",default:"onEnter",options:["onEnter","eachTurn","onEnter+eachTurn"]},
      {key:"skipOwner",label:"Exclude owner",type:"select",default:"yes",options:["yes","no"]},
      {key:"rounds",label:"Lifetime (rounds, 0 = permanent)",type:"number",default:0,noPin:true},
      {key:"auraKey",label:"Aura key",type:"text",default:"composable-aura",noPin:true}
    ],
    isGenericBranch:true,
    toAction:(n,inp)=>({
      type:"buildAuraDefinition",name:n.data.name??"Aura",shape:n.data.shape??"emanation",
      size:inp.size??n.data.size??10,angle:n.data.angle??53.13,
      owner:(inp.owner!=null&&inp.owner!==""&&inp.owner!=="0")?inp.owner:(n.data.owner??"actor"),
      tickMode:n.data.tickMode??"onEnter",skipOwner:n.data.skipOwner!=="no",
      rounds:Number(n.data.rounds??0)||0,auraKey:n.data.auraKey??"composable-aura"
    })
  },

  act_place_aura_zone: {
    title:"Place Aura", color:"#2f7d5c", cat:"Effects", wideNode:true,
    desc:"Places an Aura definition on its owner. Each matching enter/turn event forwards a Token Pool to the downstream graph; it does not roll, damage, heal, or apply effects.",
    inputs:[
      {id:"exec",label:"",type:"exec"},
      {id:"aura",label:"Aura",type:"value.object"}
    ],
    outputs:[
      {id:"exec",label:"Token Event →",type:"exec"},
      {id:"targets",label:"Token Pool",type:"value.token_pool"},
      {id:"aura",label:"Placed Aura",type:"value.object"}
    ],
    fields:[],isAoeSave:true,
    toAction:(n,inp)=>({type:"placeAuraComposite",definition:inp.aura??null})
  },

  act_tokens_from_aura: {
    title:"Tokens From Aura", color:"#2f7d5c", cat:"Effects", wideNode:true,
    desc:"Returns the tokens currently inside an existing Aura region.",
    inputs:[
      {id:"exec",label:"",type:"exec"},
      {id:"aura",label:"Aura",type:"value.object"}
    ],
    outputs:[
      {id:"found",label:"Found →",type:"exec"},
      {id:"missing",label:"Missing →",type:"exec"},
      {id:"targets",label:"Token Pool",type:"value.token_pool"},
      {id:"count",label:"Count",type:"value.number"}
    ],
    fields:[],isGenericBranch:true,
    toAction:(n,inp)=>({type:"tokensFromAura",aura:inp.aura??null})
  },

  act_effect_definition: {
    title:"Effect Definition", color:"#68449a", cat:"Effects", wideNode:true,
    desc:"Builds an Active Effect definition without applying it. Add any number of Effect Change nodes, then pass it to Apply/Remove/Toggle Effect.",
    inputs:[
      {id:"exec",label:"",type:"exec"},
      {id:"name",label:"Name",type:"value.string"},
      {id:"icon",label:"Icon",type:"value.string"},
      {id:"duration",label:"Duration",type:"value.number"}
    ],
    outputs:[
      {id:"exec",label:"Built →",type:"exec"},
      {id:"effect",label:"Effect",type:"value.effect"}
    ],
    fields:[
      {key:"name",label:"Default name",type:"text",default:"Effect"},
      {key:"icon",label:"Default icon",type:"text",default:"icons/svg/aura.svg"},
      {key:"duration",label:"Default rounds",type:"number",default:0},
      {key:"disabled",label:"Start disabled",type:"select",default:"no",options:["no","yes"]},
      {key:"transfer",label:"Transfer",type:"select",default:"no",options:["no","yes"]}
    ],
    isGenericBranch:true,
    toAction:(n,inp)=>({type:"buildEffectDefinition",name:inp.name??n.data.name??"Effect",icon:inp.icon??n.data.icon??"icons/svg/aura.svg",duration:inp.duration??n.data.duration??0,disabled:n.data.disabled==="yes",transfer:n.data.transfer==="yes"})
  },

  act_effect_add_change: {
    title:"Add Effect Change", color:"#7650a8", cat:"Effects", wideNode:true,
    desc:"Adds one path/mode/value change to an Effect definition and returns the updated definition.",
    inputs:[
      {id:"exec",label:"",type:"exec"},
      {id:"effect",label:"Effect",type:"value.effect"},
      {id:"path",label:"Path",type:"value.path"},
      {id:"value",label:"Value",type:"value.any"},
      {id:"priority",label:"Priority",type:"value.number"}
    ],
    outputs:[
      {id:"exec",label:"Added →",type:"exec"},
      {id:"effect",label:"Effect",type:"value.effect"}
    ],
    fields:[
      {key:"path",label:"Default path",type:"path",default:"system.attributes.ac.bonus"},
      {key:"value",label:"Default value",type:"text",default:"0"},
      {key:"mode",label:"Mode",type:"select",default:"2",options:["0","1","2","3","4","5"]},
      {key:"priority",label:"Default priority",type:"number",default:20}
    ],
    isGenericBranch:true,
    toAction:(n,inp)=>({type:"addEffectDefinitionChange",effect:inp.effect??null,path:inp.path??n.data.path??"",value:inp.value??n.data.value??"0",mode:Number(n.data.mode??2),priority:inp.priority??n.data.priority??20})
  },

  act_effect_apply_v2: {
    title:"Apply Effect", color:"#4f3b91", cat:"Effects", wideNode:true,
    desc:"Applies a prepared Effect definition to a Token Pool.",
    inputs:[{id:"exec",label:"",type:"exec"},{id:"effect",label:"Effect",type:"value.effect"},{id:"targets",label:"Token Pool",type:"value.token_pool"}],
    outputs:[{id:"exec",label:"Done →",type:"exec"}],fields:[],isAction:true,
    toAction:(n,inp)=>({type:"applyEffectDefinition",operation:"apply",effect:inp.effect??null,targets:inp.targets??null})
  },

  act_effect_remove_v2: {
    title:"Remove Effect", color:"#8a334d", cat:"Effects", wideNode:true,
    desc:"Removes effects matching a prepared Effect definition from a Token Pool.",
    inputs:[{id:"exec",label:"",type:"exec"},{id:"effect",label:"Effect",type:"value.effect"},{id:"targets",label:"Token Pool",type:"value.token_pool"}],
    outputs:[{id:"exec",label:"Done →",type:"exec"}],fields:[],isAction:true,
    toAction:(n,inp)=>({type:"applyEffectDefinition",operation:"remove",effect:inp.effect??null,targets:inp.targets??null})
  },

  act_effect_toggle_v2: {
    title:"Toggle Effect", color:"#5a4a9a", cat:"Effects", wideNode:true,
    desc:"Toggles effects matching a prepared Effect definition on a Token Pool.",
    inputs:[{id:"exec",label:"",type:"exec"},{id:"effect",label:"Effect",type:"value.effect"},{id:"targets",label:"Token Pool",type:"value.token_pool"}],
    outputs:[{id:"exec",label:"Done →",type:"exec"}],fields:[],isAction:true,
    toAction:(n,inp)=>({type:"applyEffectDefinition",operation:"toggle",effect:inp.effect??null,targets:inp.targets??null})
  },

  on_update: {
    title:"On Update", color:"#c04040", cat:"Events",
    desc:"Fires whenever this document (actor/item) is updated. Useful for reacting to HP / resource changes.",
    inputs:[], outputs:[
      {id:"exec",     label:"→ On Update", type:"exec"},
      {id:"path",     label:"Changed Path",type:"value.path"},
      {id:"oldValue", label:"Old Value",   type:"value.any"},
      {id:"newValue", label:"New Value",   type:"value.any"}
    ],
    fields:[{key:"pathFilter",label:"Only path (optional)",type:"path",default:"",placeholder:"system.resources.hp.value"}],
    isEvent:true, eventHook:"updateDocument"
  },

  on_create: {
    title:"On Create", color:"#c04040", cat:"Events",
    desc:"Fires once when this document is created.",
    inputs:[], outputs:[{id:"exec",label:"→ On Create",type:"exec"}],
    fields:[],
    isEvent:true, eventHook:"createDocument"
  },

  on_delete: {
    title:"On Delete", color:"#c04040", cat:"Events",
    desc:"Fires when this document is about to be deleted.",
    inputs:[], outputs:[{id:"exec",label:"→ On Delete",type:"exec"}],
    fields:[],
    isEvent:true, eventHook:"deleteDocument"
  },

  on_turn_start: {
    title:"On Turn Start", color:"#c04040", cat:"Events",
    desc:"Fires at the start of this actor's combat turn.",
    inputs:[], outputs:[
      {id:"exec",       label:"→ On Turn Start",type:"exec"},
      {id:"round",      label:"Round",           type:"value.number"},
      {id:"combatantId",label:"Combatant Id",    type:"value.string"}
    ],
    fields:[],
    isEvent:true, eventHook:"combatTurnStart"
  },

  on_turn_end: {
    title:"On Turn End", color:"#c04040", cat:"Events",
    desc:"Fires at the end of this actor's combat turn.",
    inputs:[], outputs:[
      {id:"exec",       label:"→ On Turn End",type:"exec"},
      {id:"round",      label:"Round",         type:"value.number"},
      {id:"combatantId",label:"Combatant Id",  type:"value.string"}
    ],
    fields:[],
    isEvent:true, eventHook:"combatTurnEnd"
  },

  on_combat_start: {
    title:"On Start Combat", color:"#c04040", cat:"Events",
    desc:"Fires once when a combat encounter begins (this actor must be one of the combatants).",
    inputs:[], outputs:[
      {id:"exec",  label:"→ On Combat Start", type:"exec"},
      {id:"round", label:"Round",             type:"value.number"}
    ],
    fields:[],
    isEvent:true, eventHook:"combatEncounterStart"
  },

  on_combat_end: {
    title:"On End Combat", color:"#c04040", cat:"Events",
    desc:"Fires when a combat encounter is deleted/ends (this actor must be one of the combatants).",
    inputs:[], outputs:[
      {id:"exec",  label:"→ On Combat End", type:"exec"},
      {id:"round", label:"Final Round",     type:"value.number"}
    ],
    fields:[],
    isEvent:true, eventHook:"combatEncounterEnd"
  },

  on_effect_apply: {
    title:"On Effect Apply", color:"#c04040", cat:"Events",
    desc:"Fires when an Active Effect is applied to this actor.",
    inputs:[], outputs:[
      {id:"exec",      label:"→ On Effect",type:"exec"},
      {id:"effectName",label:"Name",        type:"value.string"}
    ],
    fields:[{key:"nameFilter",label:"Only name (optional)",type:"text",default:""}],
    isEvent:true, eventHook:"createActiveEffect"
  },

  on_damage_taken: {
    title:"On Damage Taken", color:"#c04040", cat:"Events",
    desc:"Fires when this actor's HP path decreases. Configure the HP path below.",
    inputs:[], outputs:[
      {id:"exec",   label:"→ On Damage",type:"exec"},
      {id:"amount", label:"Damage",      type:"value.number"},
      {id:"newHp",  label:"New HP",      type:"value.number"}
    ],
    fields:[{key:"hpPath",label:"HP Path",type:"path",default:"system.resources.hp.value"}],
    isEvent:true, eventHook:"hpDecrease"
  },

  on_rest: {
    title:"On Rest", color:"#c04040", cat:"Events",
    desc:"Fires when a rest flag is set on this actor (configurable flag path).",
    inputs:[], outputs:[
      {id:"exec", label:"→ On Rest",type:"exec"},
      {id:"type", label:"Rest Type",  type:"value.string"}
    ],
    fields:[{key:"flagPath",label:"Rest Flag Path",type:"path",default:"system.flags.rest"}],
    isEvent:true, eventHook:"restFlag"
  },

  on_equip: {
    title:"On Equip", color:"#c04040", cat:"Events",
    desc:"Fires when an item on this actor (or this item specifically) is equipped.",
    inputs:[], outputs:[
      {id:"exec",   label:"→ On Equip", type:"exec"},
      {id:"itemId", label:"Item Id",    type:"value.string"},
      {id:"itemName",label:"Item Name", type:"value.string"}
    ],
    fields:[],
    isEvent:true, eventHook:"itemEquipped"
  },
  on_unequip: {
    title:"On Unequip", color:"#c04040", cat:"Events",
    desc:"Fires when an item on this actor (or this item specifically) is unequipped.",
    inputs:[], outputs:[
      {id:"exec",   label:"→ On Unequip",type:"exec"},
      {id:"itemId", label:"Item Id",     type:"value.string"},
      {id:"itemName",label:"Item Name",  type:"value.string"}
    ],
    fields:[],
    isEvent:true, eventHook:"itemUnequipped"
  },

  custom_event: {
    title:"Custom Event", color:"#c04040", cat:"Events", wideNode:true,
    desc:"Named custom event entry point. Fire it with the Remote Activate node or a clickable Widget Builder element (event name: On Click <Element Name>). Event names must be unique.",
    inputs:[],
    outputs:[
      {id:"exec",        label:"Fire",         type:"exec"},
      {id:"payload",     label:"Payload",      type:"value.number"},
      {id:"sourceActor", label:"Source Actor", type:"value.actor"}
    ],
    fields:[
      {key:"name", label:"Event Name", type:"text", default:"", placeholder:"MyEvent", uniqueEventName:true}
    ],
    isEvent:true,
    eventHook:"sdCustomEvent"
  },

  remote_activate: {
    title:"Remote Activate", color:"#7b4fd0", cat:"Events", wideNode:true,
    desc:"Fire a Custom Event by name. Type the name or pick a discovered event from the dropdown. Scope: this actor only, or global (all actors).",
    inputs:[
      {id:"exec",    label:"",           type:"exec"},
      {id:"name",    label:"Event Name", type:"value.string"},
      {id:"payload", label:"Payload",    type:"value.number"}
    ],
    outputs:[{id:"exec", label:"", type:"exec"}],
    fields:[
      {key:"name",  label:"Custom Event name", type:"text", default:"", placeholder:"MyEvent", customEventDatalist:true},
      {key:"scope", label:"Scope", type:"select", default:"actor",
       options:[{value:"actor", label:"This actor"},{value:"global", label:"Global (all actors)"}]}
    ],
    isAction:true,
    toAction:(n,inp)=>({
      type:"remoteActivate",
      name:    (inp.name!=null && inp.name!=="" && inp.name!=="0") ? inp.name : (n.data.name ?? ""),
      scope:   n.data.scope ?? "actor",
      payload: inp.payload ?? ""
    })
  },

  widget_output: {
    title:"Custom Output", color:"#40a080", cat:"Widget", wideNode:true,
    desc:"Named value output for a Widget Builder element. Wire any value into this node; the element whose name matches Element name displays it. Saved when the graph is saved.",
    inputs:[{id:"value", label:"Value", type:"value.any"}],
    outputs:[],
    fields:[
      {key:"name", label:"Element name", type:"text", default:"", placeholder:"Btn1", uniqueEventName:true, valueElementDatalist:true}
    ]
  },

  on_event: {
    title:"On Event", color:"#c04040", cat:"Events", wideNode:true,
    hidden:true, replacement:"specific On-* event nodes",
    desc:"Declarative event trigger: pick the event type from the dropdown. Equivalent to the specific On-* nodes but keeps the graph compact when you only need a single exec chain.",
    inputs:[], outputs:[
      {id:"exec", label:"→ Fire", type:"exec"}
    ],
    fields:[
      {key:"event", label:"Event", type:"select", default:"update",
       options:["create","update","delete","turnStart","turnEnd","combatStart","combatEnd","damageTaken","rest","equip","unequip","effectApply"]},
      {key:"pathFilter", label:"Only path (update only)", type:"path", default:"", placeholder:"system.resources.hp.value"},
      {key:"nameFilter", label:"Only name (effect only)", type:"text", default:""}
    ],
    isEvent:true,
    eventHook:"updateDocument"
  },

  get_self: {
    hidden:true, replacement:"get_self_actor / get_self_item",
    title:"Get Self", color:"#2a5a7a", cat:"Targeting",
    desc:"Reference to the document the graph runs on (actor for sheet graphs, item for item graphs).",
    inputs:[], outputs:[{id:"v", label:"Self", type:"value.actor"}],
    fields:[],
    compile:()=>`"self"`
  },
  get_self_actor: {
    title:"Self (Actor)", color:"#2a5a7a", cat:"Targeting",
    desc:"The current actor. In an item graph this resolves to the item's owning actor.",
    inputs:[], outputs:[{id:"v", label:"Actor", type:"value.actor"}],
    fields:[], compile:()=>`"actor"`
  },
  get_self_item: {
    title:"Self (Item)", color:"#6a5420", cat:"Targeting",
    desc:"The item document the graph is running from. Actor-only graphs do not invent an item.",
    inputs:[], outputs:[{id:"v", label:"Item", type:"value.item"}],
    fields:[], compile:()=>`"self"`
  },
  get_actor: {
    title:"Get Actor", color:"#2a5a7a", cat:"Targeting",
    desc:"Reference to an actor or item context. Self (Actor) resolves the current/owning actor; Self (Item) resolves the item the graph belongs to. If a UUID is filled in, it takes priority and the Mode dropdown is ignored. Targeted/selected token modes return actors; All Targets returns an array.",
    inputs:[], outputs:[{id:"v", label:"Actor / Item", type:"value.any"}],
    fields:[
      {key:"uuid", label:"UUID", type:"text", default:"",
        placeholder:"Actor.abc123 or Item.abc123 (priority — Mode is ignored when filled)"},
      {key:"mode", label:"Mode", type:"select", default:"actor", options:[
        {value:"actor",          label:"Self (Actor)"},
        {value:"self",           label:"Self (Item)"},
        {value:"token_target",   label:"First targeted token"},
        {value:"selected_token", label:"First selected token"},
        {value:"all_targets",    label:"All targeted tokens (array)"},
        {value:"user_character", label:"User's assigned character"}
      ]}
    ],
    compile:(n)=>{

      const uuid = String(n.data.uuid ?? "").trim();
      if (uuid) return `"${uuid.replace(/"/g, '\\"')}"`;
      return `"${n.data.mode ?? "actor"}"`;
    }
  },
  get_target: {
    title:"Get Target", color:"#2a5a7a", cat:"Targeting",
    hidden:true, replacement:"get_actor",
    desc:"First targeted token's actor. Use Get All Targets for multi-target workflows.",
    inputs:[], outputs:[{id:"v", label:"Target", type:"value.token"}],
    fields:[],
    compile:()=>`"token_target"`
  },
  get_selected_token: {
    title:"Get Selected Token", color:"#2a5a7a", cat:"Targeting",
    hidden:true, replacement:"get_actor",
    desc:"First currently-selected token on the canvas. Falls back to self if none selected.",
    inputs:[], outputs:[{id:"v", label:"Token", type:"value.token"}],
    fields:[],
    compile:()=>`"selected_token"`
  },
  get_all_targets: {
    title:"Get All Targets", color:"#2a5a7a", cat:"Targeting",
    hidden:true, replacement:"get_actors_array",
    desc:"All currently targeted tokens as an array. Feed into For Each Target, AoE save branches, etc.",
    inputs:[], outputs:[{id:"v", label:"Targets", type:"value.array"}],
    fields:[],
    compile:()=>`"all_targets"`
  },

  get_player_actors: {
    title:"Get Player Actors", color:"#2a5a7a", cat:"Targeting",
    hidden:true, replacement:"get_actors_array",
    desc:"Returns the array of player-character actors. Feed into Dialog Select (Array) to let the user pick a PC, or into For Each Token / array nodes.",
    inputs:[], outputs:[{id:"v", label:"Players", type:"value.array"}],
    fields:[
      {key:"onlineOnly", label:"Online users only", type:"select", default:"yes", options:["yes","no"]},
      {key:"includeGM",  label:"Include GM",        type:"select", default:"no",  options:["no","yes"]}
    ],
    compile:(n)=>`"player_actors:${n.data.onlineOnly ?? "yes"}:${n.data.includeGM ?? "no"}"`
  },

  get_user_character: {
    title:"Get User's Character", color:"#2a5a7a", cat:"Targeting",
    hidden:true, replacement:"get_actor",
    desc:"Returns the actor assigned to the current user (game.user.character). Empty if the user has no assigned character.",
    inputs:[], outputs:[{id:"v", label:"Actor", type:"value.actor"}],
    fields:[],
    compile:()=>`"user_character"`
  },

  get_actors_array: {
    title:"Get Actors", color:"#2a5a7a", cat:"Targeting", wideNode:true,
    desc:"One actor-array source for targets, selected tokens, player characters, the current actor, the user's character or every token on the current scene. Outputs UUIDs, Count, First UUID and an optional mapped field.",
    inputs:[],
    outputs:[
      {id:"uuids",  label:"UUIDs (array)",  type:"value.array"},
      {id:"values", label:"Values (array)", type:"value.array"},
      {id:"count",  label:"Count",          type:"value.number"},
      {id:"first",  label:"First UUID",     type:"value.string"}
    ],
    fields:[
      {key:"mode", label:"Source", type:"select", default:"targets", options:[
        {value:"targets",  label:"Targeted tokens"},
        {value:"selected", label:"Selected tokens"},
        {value:"both",     label:"Targeted + selected"},
        {value:"players_online", label:"Player actors — online"},
        {value:"players_all",    label:"Player actors — all"},
        {value:"self_actor",     label:"Self (Actor)"},
        {value:"user_character", label:"User's assigned character"},
        {value:"scene",          label:"All actors on current scene"}
      ]},
      {key:"path", label:"Field path (for Values)", type:"path", default:""}
    ],
    compile:(n)=>`{targetUuids:${n.data.mode ?? "targets"}}`,
    compilePin:(n,_i,pin)=>{
      const mode = n.data.mode ?? "targets";
      if (pin === "count") return `{targetCount:${mode}}`;
      if (pin === "first") return `{targetFirst:${mode}}`;
      if (pin === "values") {
        const b64 = (s)=>{ try { return btoa(unescape(encodeURIComponent(String(s ?? "")))); } catch { return ""; } };
        return `{targetFields:${mode}|${b64(n.data.path ?? "")}}`;
      }
      return `{targetUuids:${mode}}`;
    }
  },

  get_uuid_from_array: {
    title:"Get UUID From Array", color:"#2a5a7a", cat:"Targeting",
    desc:"Takes an array (e.g. UUIDs from Get Target/Selected Actors) and an index and returns the element at that index as UUID, plus the resolved document Name. Negative index counts from the end (-1 = last).",
    inputs:[
      {id:"a", label:"Array", type:"value.array"},
      {id:"i", label:"Index", type:"value.number"}
    ],
    outputs:[
      {id:"uuid", label:"UUID", type:"value.string"},
      {id:"name", label:"Name", type:"value.string"}
    ],
    fields:[{key:"i", label:"Index", type:"number", default:0}],
    compile:(n,i)=>{
      const idx = (i.i != null && i.i !== "") ? i.i : (n.data.i ?? 0);
      return `{arrayGet:${_arrayArg(i.a ?? "")}|${_arrayArg(idx)}|${_arrayArg("")}}`;
    },
    compilePin:(n,i,pin)=>{
      const idx = (i.i != null && i.i !== "") ? i.i : (n.data.i ?? 0);
      if (pin === "name") {
        const b64 = (s)=>{ try { return btoa(unescape(encodeURIComponent(String(s ?? "")))); } catch { return ""; } };
        return `{uuidField:${_arrayArg(i.a ?? "")}|${_arrayArg(idx)}|${b64("name")}}`;
      }
      return `{arrayGet:${_arrayArg(i.a ?? "")}|${_arrayArg(idx)}|${_arrayArg("")}}`;
    }
  },

  get_field_by_uuid: {
    title:"Get Field By UUID", color:"#2a5a7a", cat:"Targeting", wideNode:true,
    desc:"Reads any field (system.resources.hp.value, system.hiddenFields.x, name, uuid, system.widgetFields.<key>.value ...) from an actor or item. UUID/Array accepts a single UUID or a whole array + Index (negative = from the end). Also accepts mode strings (targets/selected/self) from targeting nodes. Works with tokens, world actors and items.",
    inputs:[
      {id:"u", label:"UUID / Array", type:"value.any"},
      {id:"i", label:"Index",        type:"value.number"}
    ],
    outputs:[{id:"v", label:"Value", type:"value.any"}],
    fields:[
      {key:"i",    label:"Index",      type:"number", default:0},
      {key:"path", label:"Field path", type:"path",   default:"system.resources.hp.value"}
    ],
    compile:(n,i)=>{
      const b64 = (s)=>{ try { return btoa(unescape(encodeURIComponent(String(s ?? "")))); } catch { return ""; } };
      const idx = (i.i != null && i.i !== "") ? i.i : (n.data.i ?? 0);
      return `{uuidField:${_arrayArg(i.u ?? "")}|${_arrayArg(idx)}|${b64(n.data.path ?? "")}}`;
    }
  },

  get_fields_from_array: {
    title:"Get Fields From Actors (map)", color:"#2a5a7a", cat:"Targeting", wideNode:true,
    desc:"Maps an array of UUIDs to an array of field values: reads Field path from EVERY document in the array and outputs the values as an array in the same order. Chain: Get Target/Selected Actors → this node → any array node (Aggregate, Filter, Break Array...).",
    inputs:[{id:"a", label:"UUIDs (array)", type:"value.array"}],
    outputs:[{id:"v", label:"Values (array)", type:"value.array"}],
    fields:[{key:"path", label:"Field path", type:"path", default:"system.resources.hp.value"}],
    compile:(n,i)=>{
      const b64 = (s)=>{ try { return btoa(unescape(encodeURIComponent(String(s ?? "")))); } catch { return ""; } };
      return `{uuidsMapField:${_arrayArg(i.a ?? "")}|${b64(n.data.path ?? "")}}`;
    }
  },

  get_field_by_actor_name: {
    title:"Get Field By Actor Name", color:"#2a5a7a", cat:"Targeting", wideNode:true,
    desc:"Finds a world actor by exact Name and reads any field from it (system.hiddenFields.x, system.resources.hp.value, uuid, name...). If several actors share the name, Index picks which one (negative = from the end). Name can also be wired in as a value pin.",
    inputs:[
      {id:"name", label:"Name",  type:"value.string"},
      {id:"i",    label:"Index", type:"value.number"}
    ],
    outputs:[{id:"v", label:"Value", type:"value.any"}],
    fields:[
      {key:"name", label:"Actor name", type:"text",   default:""},
      {key:"i",    label:"Index",      type:"number", default:0},
      {key:"path", label:"Field path", type:"path",   default:"system.resources.hp.value"}
    ],
    compile:(n,i)=>{
      const b64 = (s)=>{ try { return btoa(unescape(encodeURIComponent(String(s ?? "")))); } catch { return ""; } };
      const nm  = (i.name != null && i.name !== "") ? i.name : `"${String(n.data.name ?? "").replace(/"/g, '\\"')}"`;
      const idx = (i.i != null && i.i !== "") ? i.i : (n.data.i ?? 0);
      return `{actorNameField:${_arrayArg(nm)}|${_arrayArg(idx)}|${b64(n.data.path ?? "")}}`;
    }
  },

  equipped_count: {
    title:"Equipped Count", color:"#2e6e4a", cat:"Get Data",
    desc:"Returns the count of items with `system.equipped:true` on the owning actor, optionally filtered by category. Type a free-form category string (matches `system.category` on the item, Cyrillic / Latin / any text). Leave empty or `any` to count all equipped items.",
    inputs:[], outputs:[{id:"value", label:"N", type:"value.any"}],
    fields:[
      {key:"category", label:"Category", type:"text", default:"",
        placeholder:"any (or item category, e.g. weapon / РѕСЂСѓР¶РёРµ / РјР°РіРёСЏ)"}
    ],
    isPure:true,
    compile:(n)=>{
      const cat = String(n.data.category ?? "").trim();
      return `{__sdEqCount:${cat}}`;
    }
  },

  act_delay: {
    title:"Delay", color:"#2a5a8a", cat:"Flow Control",
    desc:"Waits the given number of milliseconds, then continues the exec chain.",
    inputs:[
      {id:"exec",     label:"",        type:"exec"},
      {id:"duration", label:"ms",      type:"value.number"}
    ],
    outputs:[{id:"exec", label:"→", type:"exec"}],
    fields:[
      {key:"duration", label:"Duration (ms)", type:"text", default:"500"}
    ],
    isAction:true,
    toAction:(n,inp)=>({ type:"delay", duration: inp.duration ?? n.data.duration ?? "500" })
  },

  for_loop_range: {
    title:"For Loop (Range)", color:"#2a5a8a", cat:"Flow Control",
    desc:"Unreal-style inclusive loop from First Index through Last Index. If First is greater than Last, Body is skipped. A 1,000-iteration safety cap prevents accidental freezes.",
    inputs:[{id:"exec",label:"",type:"exec"},{id:"first",label:"First Index",type:"value.number"},{id:"last",label:"Last Index",type:"value.number"},{id:"delay",label:"Delay ms",type:"value.number"}],
    outputs:[{id:"loop",label:"Loop Body",type:"exec"},{id:"done",label:"Completed",type:"exec"},{id:"index",label:"Index",type:"value.number"}],
    fields:[{key:"first",label:"First Index",type:"text",default:"0"},{key:"last",label:"Last Index",type:"text",default:"3"},{key:"delay",label:"Delay ms",type:"text",default:"0"}],
    isLoop:true,
    toAction:(n,inp)=>({type:"forLoopRange",first:inp.first??n.data.first??"0",last:inp.last??n.data.last??"3",delay:inp.delay??n.data.delay??"0"})
  },

  act_loop: {
    title:"Repeat N Times", color:"#2a5a8a", cat:"Flow Control",
    desc:"Runs Body exactly Count times, from index 0 to Count - 1. This node keeps its original ID and behavior for saved graphs; use For Loop (Range) when First/Last Index semantics are needed.",
    inputs:[
      {id:"exec",  label:"",       type:"exec"},
      {id:"count", label:"Count",  type:"value.number"},
      {id:"delay", label:"Delay ms",type:"value.number"}
    ],
    outputs:[
      {id:"body", label:"Body →", type:"exec"},
      {id:"done", label:"Done →", type:"exec"},
      {id:"index",label:"Index",  type:"value.number"}
    ],
    fields:[
      {key:"count", label:"Count",   type:"text", default:"3"},
      {key:"delay", label:"Delay ms",type:"text", default:"0"}
    ],
    isGenericBranch:true,
    toAction:(n,inp)=>({
      type:  "forLoop",
      count: inp.count ?? n.data.count ?? "3",
      delay: inp.delay ?? n.data.delay ?? "0"
    })
  },

  act_wait_for_event: {
    title:"Wait For Event", color:"#2a5a8a", cat:"Flow Control",
    desc:"Pauses the exec chain until the first fire of a Foundry hook. Timeout is in milliseconds (0 = no timeout). Continues exec once the event fires.",
    inputs:[
      {id:"exec",    label:"",        type:"exec"},
      {id:"timeout", label:"Timeout", type:"value.number"}
    ],
    outputs:[
      {id:"done",    label:"Fired →",    type:"exec"},
      {id:"timedOut",label:"Timed out →",type:"exec"}
    ],
    fields:[
      {key:"hook",    label:"Hook name", type:"text",   default:"updateCombat"},
      {key:"timeout", label:"Timeout ms",type:"text",   default:"0"}
    ],
    isGenericBranch:true,
    toAction:(n,inp)=>({
      type:    "waitForEvent",
      hook:    n.data.hook ?? "updateCombat",
      timeout: inp.timeout ?? n.data.timeout ?? "0"
    })
  },

  random_pick: {
    title:"Random Pick", color:"#2a4a6a", cat:"Values",
    desc:"Randomly returns one of the connected value inputs (up to 5). Empty inputs are skipped. Gives a uniform distribution.",
    inputs:[
      {id:"a", label:"A", type:"value.any"},
      {id:"b", label:"B", type:"value.any"},
      {id:"c", label:"C", type:"value.any"},
      {id:"d", label:"D", type:"value.any"},
      {id:"e", label:"E", type:"value.any"}
    ],
    outputs:[{id:"v", label:"Value", type:"value.any"}],
    fields:[],
    compile:(_,i)=>{
      const opts = ["a","b","c","d","e"]
        .map(k=>i[k])
        .filter(v=>v!=null && v!=="");
      if (!opts.length) return "0";
      const n = opts.length;
      let expr = opts[n-1];
      for (let j = n-2; j >= 0; j--) {
        expr = `(floor(random*${n})==${j}?${opts[j]}:${expr})`;
      }
      return expr;
    }
  },

  resource_tier: {
    title:"Resource Tier", color:"#2a4a6a", cat:"Get Data",
    desc:"Maps a number to a tier (e.g. HP → 'critical / bloodied / healthy'). Thresholds are a list of values; tier labels are a list one longer.",
    inputs:[{id:"v", label:"Value", type:"value.number"}],
    outputs:[{id:"tier", label:"Tier", type:"value.string"}],
    fields:[
      {key:"thresholds", label:"Thresholds (csv, ascending)", type:"text", default:"25,50,75", placeholder:"e.g. 25,50,75"},
      {key:"labels",     label:"Labels (csv, one more)",       type:"text", default:"critical,bloodied,hurt,healthy"}
    ],
    compile:(n,i)=>{
      const v  = i.v ?? "0";
      const th = String(n.data.thresholds ?? "25,50,75").split(",").map(s=>s.trim()).filter(Boolean);
      const lb = String(n.data.labels ?? "critical,bloodied,hurt,healthy").split(",").map(s=>s.trim());
      if (!th.length || !lb.length) return `"unknown"`;
      let expr = JSON.stringify(lb[th.length] ?? lb[lb.length-1] ?? "unknown");
      for (let j = th.length - 1; j >= 0; j--) {
        const label = JSON.stringify(lb[j] ?? "unknown");
        expr = `((${v})<${th[j]}?${label}:${expr})`;
      }
      return expr;
    }
  },

  get_combat_state: {
    title:"Get Combat State", color:"#2a4a6a", cat:"Get Data",
    desc:"Value outputs about the current encounter: is combat active (0/1), current round, active combatant index, active combatant id/actor.",
    inputs:[],
    outputs:[
      {id:"active",      label:"Active?",       type:"value.bool"},
      {id:"round",       label:"Round",         type:"value.number"},
      {id:"turn",        label:"Turn index",    type:"value.number"},
      {id:"combatantId", label:"Combatant Id",  type:"value.string"},
      {id:"actorId",     label:"Actor Id",      type:"value.string"},
      {id:"actorName",   label:"Actor Name",    type:"value.string"}
    ],
    fields:[],
    compile:(_n, _i, _node, outPin)=>{
      if (outPin === "active")      return `{combat:active}`;
      if (outPin === "round")       return `{combat:round}`;
      if (outPin === "turn")        return `{combat:turn}`;
      if (outPin === "combatantId") return `{combat:combatantId}`;
      if (outPin === "actorId")     return `{combat:actorId}`;
      if (outPin === "actorName")   return `{combat:actorName}`;
      return "0";
    },
    compilePin:(_n, _i, pin)=>{
      if (pin === "active")      return `{combat:active}`;
      if (pin === "round")       return `{combat:round}`;
      if (pin === "turn")        return `{combat:turn}`;
      if (pin === "combatantId") return `{combat:combatantId}`;
      if (pin === "actorId")     return `{combat:actorId}`;
      if (pin === "actorName")   return `{combat:actorName}`;
      return "0";
    }
  },

  get_compendium_uuids: {
    title:"Compendium Item UUIDs", color:"#2a4a6a", cat:"Get Data",
    desc:"Returns all item UUIDs in a compendium pack as an array. Drag a compendium from the sidebar into the Pack field or type its id (e.g. 'world.my-items' or 'system-director.weapons'). Feeds into Add Item Array, item array ops, etc.",
    inputs:[{id:"pack", label:"Pack Id", type:"value.string"}],
    outputs:[
      {id:"v",   label:"UUIDs",  type:"value.array"},
      {id:"len", label:"Count",  type:"value.number"}
    ],
    fields:[
      {key:"pack", label:"Pack Id", type:"text", default:"", placeholder:"e.g. world.my-items"}
    ],
    compile:(n,i)=>{
      const pack = (i.pack != null && i.pack !== "") ? String(i.pack) : (n.data.pack ?? "");
      return `{compendium:${pack}|uuids}`;
    },
    compilePin:(n,i,pin)=>{
      const pack = (i.pack != null && i.pack !== "") ? String(i.pack) : (n.data.pack ?? "");
      if (pin === "len") return `{compendium:${pack}|count}`;
      return `{compendium:${pack}|uuids}`;
    }
  },

  get_compendium_count: {
    title:"Compendium Item Count", color:"#2a4a6a", cat:"Get Data",
    desc:"Returns the number of items in a compendium pack.",
    inputs:[{id:"pack", label:"Pack Id", type:"value.string"}],
    outputs:[{id:"v", label:"Count", type:"value.number"}],
    fields:[
      {key:"pack", label:"Pack Id", type:"text", default:"", placeholder:"e.g. world.my-items"}
    ],
    compile:(n,i)=>{
      const pack = (i.pack != null && i.pack !== "") ? String(i.pack) : (n.data.pack ?? "");
      return `{compendium:${pack}|count}`;
    }
  },

  get_compendium_names: {
    title:"Compendium Item Names", color:"#2a4a6a", cat:"Get Data",
    desc:"Returns the names of all items in a compendium pack as an array (comma-joined).",
    inputs:[{id:"pack", label:"Pack Id", type:"value.string"}],
    outputs:[
      {id:"v",   label:"Names",  type:"value.array"},
      {id:"len", label:"Count",  type:"value.number"}
    ],
    fields:[
      {key:"pack", label:"Pack Id", type:"text", default:"", placeholder:"e.g. world.my-items"}
    ],
    compile:(n,i)=>{
      const pack = (i.pack != null && i.pack !== "") ? String(i.pack) : (n.data.pack ?? "");
      return `{compendium:${pack}|names}`;
    },
    compilePin:(n,i,pin)=>{
      const pack = (i.pack != null && i.pack !== "") ? String(i.pack) : (n.data.pack ?? "");
      if (pin === "len") return `{compendium:${pack}|count}`;
      return `{compendium:${pack}|names}`;
    }
  },

  var_read: {
    title:"Read Variable", color:"#2a6a9a", cat:"Variables",
    desc:"Reads a typed variable. Local lasts for one graph pass; Actor and Item persist on that document; World is shared by the world.",
    inputs:[],
    outputs:[{id:"v",label:"Value",type:"value.any"}],
    computeDynamicOutputs:(n)=>[{id:"v",label:"Value",type:databaseTypePin(n.data?.valueType ?? "any")}],
    fields:[
      {key:"valueType",label:"Type",type:"select",default:"any",options:()=>databaseTypeOptions()},
      {key:"scope",label:"Scope",type:"select",default:"local",options:["local","actor","item","world"]},
      {key:"name",label:"Name",type:"text",default:"myVar"},
      {key:"default",label:"Default",type:"text",default:"0"}
    ],
    compile:(n)=>{
      const scope=n.data.scope??"local",name=n.data.name??"myVar",d=n.data.default??"0";
      if(scope==="actor")return `{__actorVar:${name}|${d}}`;
      if(scope==="item")return `{__itemVar:${name}|${d}}`;
      if(scope==="world")return `{__worldVar:${name}|${d}}`;
      return `{__var:${name}|${d}}`;
    }
  },

  var_write: {
    title:"Write Variable", color:"#2a6a9a", cat:"Variables",
    desc:"Writes a typed variable. Actor/Item flags and World values persist between executions.",
    inputs:[{id:"exec",label:"",type:"exec"},{id:"name",label:"Name",type:"value.string"},{id:"value",label:"Value",type:"value.any"},{id:"scope",label:"Scope",type:"value.string"}],
    computeDynamicInputs:(n)=>[{id:"exec",label:"",type:"exec"},{id:"name",label:"Name",type:"value.string"},{id:"value",label:"Value",type:databaseTypePin(n.data?.valueType??"any")},{id:"scope",label:"Scope",type:"value.string"}],
    outputs:[{id:"exec",label:"→",type:"exec"}],
    fields:[
      {key:"valueType",label:"Type",type:"select",default:"any",options:()=>databaseTypeOptions()},
      {key:"scope",label:"Scope",type:"select",default:"local",options:["local","actor","item","world"]},
      {key:"name",label:"Name",type:"text",default:"myVar"}
    ],
    isAction:true,
    toAction:(n,inp)=>({type:"setVar",name:(inp.name!=null&&inp.name!=="")?String(inp.name):(n.data.name??"myVar"),value:inp.value??"0",scope:(inp.scope!=null&&inp.scope!=="")?String(inp.scope):(n.data.scope??"local"),valueType:n.data.valueType??"any"})
  },

  database_get: {
    title:"Database Get",color:"#236b63",cat:"Database",wideNode:true,
    desc:"Reads a typed record from a shared world database. Document databases use the selected/current Actor or Item; World databases are global.",
    inputs:[{id:"exec",label:"",type:"exec"},{id:"owner",label:"Owner",type:"value.any"}],
    outputs:[{id:"exec",label:"→",type:"exec"},{id:"value",label:"Value",type:"value.any"}],
    computeDynamicOutputs:(n)=>[{id:"exec",label:"→",type:"exec"},{id:"value",label:"Value",type:databaseTypePin(getDatabaseRecord(n.data?.databaseId,n.data?.recordId)?.type??"any")}],
    fields:[
      {key:"databaseId",label:"Database",type:"select",default:"",options:()=>databaseSelectOptions()},
      {key:"recordId",label:"Record",type:"select",default:"",options:(n)=>databaseRecordSelectOptions(n.data?.databaseId)},
      {key:"ownerMode",label:"Storage owner",type:"select",default:"auto",options:[{value:"auto",label:"Current Item / Actor"},{value:"actor",label:"Current Actor"},{value:"item",label:"Current Item"},{value:"world",label:"World"}]}
    ],
    isAction:true,
    dynamicBranchToken:(n,p)=>p==="value"?`{__dbValue:${n.id}}`:null,
    toAction:(n,inp)=>({type:"databaseGet",databaseId:n.data.databaseId??"",recordId:n.data.recordId??"",ownerMode:n.data.ownerMode??"auto",owner:inp.owner??null,runtimeKey:n.id})
  },

  database_set: {
    title:"Database Set",color:"#287a70",cat:"Database",wideNode:true,
    desc:"Writes a value to a typed database record and outputs the stored value with the same pin type.",
    inputs:[{id:"exec",label:"",type:"exec"},{id:"owner",label:"Owner",type:"value.any"},{id:"value",label:"Value",type:"value.any"}],
    computeDynamicInputs:(n)=>[{id:"exec",label:"",type:"exec"},{id:"owner",label:"Owner",type:"value.any"},{id:"value",label:"Value",type:databaseTypePin(getDatabaseRecord(n.data?.databaseId,n.data?.recordId)?.type??"any")}],
    outputs:[{id:"exec",label:"→",type:"exec"},{id:"value",label:"Stored",type:"value.any"}],
    computeDynamicOutputs:(n)=>[{id:"exec",label:"→",type:"exec"},{id:"value",label:"Stored",type:databaseTypePin(getDatabaseRecord(n.data?.databaseId,n.data?.recordId)?.type??"any")}],
    fields:[
      {key:"databaseId",label:"Database",type:"select",default:"",options:()=>databaseSelectOptions()},
      {key:"recordId",label:"Record",type:"select",default:"",options:(n)=>databaseRecordSelectOptions(n.data?.databaseId)},
      {key:"ownerMode",label:"Storage owner",type:"select",default:"auto",options:[{value:"auto",label:"Current Item / Actor"},{value:"actor",label:"Current Actor"},{value:"item",label:"Current Item"},{value:"world",label:"World"}]}
    ],
    isAction:true,
    dynamicBranchToken:(n,p)=>p==="value"?`{__dbValue:${n.id}}`:null,
    toAction:(n,inp)=>({type:"databaseSet",databaseId:n.data.databaseId??"",recordId:n.data.recordId??"",ownerMode:n.data.ownerMode??"auto",owner:inp.owner??null,value:inp.value??null,runtimeKey:n.id})
  },

  database_create: {
    title:"Database Create",color:"#319887",cat:"Database",wideNode:true,
    desc:"Creates a new typed record in an existing database. Optionally writes an initial value for the current owner.",
    inputs:[{id:"exec",label:"",type:"exec"},{id:"owner",label:"Owner",type:"value.any"},{id:"value",label:"Initial Value",type:"value.any"}],
    computeDynamicInputs:(n)=>[{id:"exec",label:"",type:"exec"},{id:"owner",label:"Owner",type:"value.any"},{id:"value",label:"Initial Value",type:databaseTypePin(n.data?.valueType??"any")}],
    outputs:[{id:"exec",label:"Created →",type:"exec"},{id:"value",label:"Value",type:"value.any"},{id:"recordId",label:"Record ID",type:"value.string"}],
    computeDynamicOutputs:(n)=>[{id:"exec",label:"Created →",type:"exec"},{id:"value",label:"Value",type:databaseTypePin(n.data?.valueType??"any")},{id:"recordId",label:"Record ID",type:"value.string"}],
    fields:[
      {key:"databaseId",label:"Database",type:"select",default:"",options:()=>databaseSelectOptions()},
      {key:"recordId",label:"New record ID",type:"text",default:"new_record"},
      {key:"recordName",label:"Display name",type:"text",default:"New Record"},
      {key:"valueType",label:"Type",type:"select",default:"any",options:()=>databaseTypeOptions()},
      {key:"defaultValue",label:"Default",type:"text",default:""},
      {key:"writeInitial",label:"Write initial value",type:"select",default:"yes",options:["yes","no"]},
      {key:"ownerMode",label:"Storage owner",type:"select",default:"auto",options:[{value:"auto",label:"Current Item / Actor"},{value:"actor",label:"Current Actor"},{value:"item",label:"Current Item"},{value:"world",label:"World"}]}
    ],
    isAction:true,
    dynamicBranchToken:(n,p)=>p==="value"?`{__dbValue:${n.id}}`:p==="recordId"?`{__dbRecordId:${n.id}}`:null,
    toAction:(n,inp)=>({type:"databaseCreate",databaseId:n.data.databaseId??"",recordId:n.data.recordId??"new_record",recordName:n.data.recordName??"New Record",valueType:n.data.valueType??"any",defaultValue:n.data.defaultValue??null,writeInitial:n.data.writeInitial!=="no",ownerMode:n.data.ownerMode??"auto",owner:inp.owner??null,value:inp.value??null,runtimeKey:n.id})
  },

  var_get: {
    title:"Get Variable", color:"#2a6a9a", cat:"Sources",
    hidden:true, replacement:"var_read",
    desc:"Reads the value of a local graph variable. Variables are defined in the Variables panel of the graph editor.",
    inputs:[],
    outputs:[{id:"v", label:"Value", type:"value.any"}],
    fields:[
      {key:"name",    label:"Name",    type:"text", default:"myVar"},
      {key:"default", label:"Default", type:"text", default:"0"}
    ],
    compile:(n)=>`{__var:${n.data.name ?? "myVar"}|${n.data.default ?? "0"}}`
  },

  var_set: {
    title:"Set Variable", color:"#2a6a9a", cat:"Sources",
    hidden:true, replacement:"var_write",
    desc:"Assigns a value to a local graph variable. Variables live within a single button press (per-run).",
    inputs:[
      {id:"exec",  label:"",     type:"exec"},
      {id:"value", label:"Value",type:"value.any"}
    ],
    outputs:[{id:"exec", label:"→", type:"exec"}],
    fields:[
      {key:"name", label:"Name", type:"text", default:"myVar"}
    ],
    isAction:true,
    toAction:(n,inp)=>({
      type:  "setVar",
      name:  n.data.name ?? "myVar",
      value: inp.value ?? "0",
      scope: "local"
    })
  },

  cast_to_actor: {
    title:"Cast to Actor", color:"#6a2a6a", cat:"Flow Control",
    desc:"Attempts to cast Value (UUID string) to an Actor. On success, emits Cast Success with ActorId; otherwise Cast Failed.",
    inputs:[
      {id:"exec",  label:"",     type:"exec"},
      {id:"value", label:"Value",type:"value.any"}
    ],
    outputs:[
      {id:"ok",      label:"Cast Success →",type:"exec"},
      {id:"fail",    label:"Cast Failed →",  type:"exec"},
      {id:"actorId", label:"Actor ID",       type:"value.string"}
    ],
    fields:[],
    isGenericBranch:true,
    toAction:(n,inp)=>({ type:"castToActor", value: inp.value ?? "" })
  },

  cast_to_item: {
    title:"Cast to Item", color:"#6a2a6a", cat:"Flow Control",
    desc:"Attempts to cast Value (UUID string) to an Item. On success, emits Cast Success with ItemId; otherwise Cast Failed.",
    inputs:[
      {id:"exec",  label:"",     type:"exec"},
      {id:"value", label:"Value",type:"value.any"}
    ],
    outputs:[
      {id:"ok",     label:"Cast Success →",type:"exec"},
      {id:"fail",   label:"Cast Failed →",  type:"exec"},
      {id:"itemId", label:"Item ID",         type:"value.string"}
    ],
    fields:[],
    isGenericBranch:true,
    toAction:(n,inp)=>({ type:"castToItem", value: inp.value ?? "" })
  },

  macro_input: {
    title:"Macro Input", color:"#1a8a4a", cat:"Macros",
    desc:"Entry point for a nested graph (macro). Macro ID must match the ID in macro_call. Exec and up to 4 value pins are forwarded from macro_call.",
    inputs:[],
    outputs:[
      {id:"exec", label:"→",     type:"exec"},
      {id:"a",    label:"Arg 1", type:"value.any"},
      {id:"b",    label:"Arg 2", type:"value.any"},
      {id:"c",    label:"Arg 3", type:"value.any"},
      {id:"d",    label:"Arg 4", type:"value.any"}
    ],
    fields:[
      {key:"macroId", label:"Macro ID", type:"text", default:"myMacro"}
    ],
    isMacroInput:true
  },

  macro_output: {
    title:"Macro Output", color:"#1a8a4a", cat:"Macros",
    desc:"Exit point of a nested graph. Placed INSIDE the macro graph. Exec and up to 2 value pins are returned out to macro_call.",
    inputs:[
      {id:"exec", label:"",         type:"exec"},
      {id:"a",    label:"Return 1", type:"value.any"},
      {id:"b",    label:"Return 2", type:"value.any"}
    ],
    outputs:[],
    fields:[],
    isAction:true,
    toAction:(n,inp)=>({ type:"macroReturn", a: inp.a ?? "0", b: inp.b ?? "0" })
  },

  macro_call: {
    title:"Call Macro", color:"#1a8a4a", cat:"Macros",
    desc:"Calls a nested macro graph by ID. The macro must be defined in the Macros panel of the graph editor. Return values are available via value pins.",
    wideNode:true,
    inputs:[
      {id:"exec", label:"",  type:"exec"},
      {id:"a",    label:"Arg 1", type:"value.any"},
      {id:"b",    label:"Arg 2", type:"value.any"},
      {id:"c",    label:"Arg 3", type:"value.any"},
      {id:"d",    label:"Arg 4", type:"value.any"}
    ],
    outputs:[
      {id:"exec",   label:"→",        type:"exec"},
      {id:"retA",   label:"Return 1", type:"value.any"},
      {id:"retB",   label:"Return 2", type:"value.any"}
    ],
    fields:[
      {key:"macroId", label:"Macro ID", type:"text", default:""}
    ],
    isGenericBranch:true,
    toAction:(n,inp)=>({
      type:    "macroCall",
      macroId: n.data.macroId ?? "",
      args:    { a:inp.a ?? "0", b:inp.b ?? "0", c:inp.c ?? "0", d:inp.d ?? "0" }
    })
  },

  act_show_journal: {
    title:"Show Journal", color:"#3a5a8a", cat:"Chat",
    desc:"Render a JournalEntry to the player. If 'Force show to all' is enabled, GM pushes the entry to every connected player.",
    inputs:[
      {id:"exec", label:"", type:"exec"},
      {id:"uuid", label:"Journal UUID", type:"value.uuid"}
    ],
    outputs:[{id:"exec", label:"", type:"exec"}],
    fields:[
      {key:"uuid",   label:"Journal UUID (or drag here)", type:"text", default:"", placeholder:"JournalEntry.xxxx"},
      {key:"pageId", label:"Open at page id (optional)", type:"text", default:"", placeholder:"Leave blank for first page"},
      {key:"force",  label:"Force show to all", type:"select", default:"no", options:["yes","no"]}
    ],
    isAction:true, wideNode:true,
    toAction:(n,inp)=>({
      type:    "journalShow",
      uuid:    inp.uuid ?? n.data.uuid ?? "",
      pageId:  n.data.pageId ?? "",
      force:   n.data.force === "yes"
    })
  },

  act_journal_show_page: {
    title:"Show Journal Page", color:"#3a5a8a", cat:"Chat",
    desc:"Open a specific JournalEntryPage. If the page is an image type — Foundry shows it as a popup handout; text/markdown opens the journal sheet at that page.",
    inputs:[
      {id:"exec",      label:"", type:"exec"},
      {id:"entryUuid", label:"Journal UUID", type:"value.uuid"},
      {id:"pageId",    label:"Page id", type:"value.string"}
    ],
    outputs:[{id:"exec", label:"", type:"exec"}],
    fields:[
      {key:"entryUuid", label:"Journal UUID", type:"text", default:"", placeholder:"JournalEntry.xxxx"},
      {key:"pageId",    label:"Page id", type:"text", default:"", placeholder:"page _id (leave blank → first page)"},
      {key:"force",     label:"Force show to all", type:"select", default:"no", options:["yes","no"]}
    ],
    isAction:true, wideNode:true,
    toAction:(n,inp)=>({
      type:      "journalShowPage",
      entryUuid: inp.entryUuid ?? n.data.entryUuid ?? "",
      pageId:    inp.pageId    ?? n.data.pageId    ?? "",
      force:     n.data.force === "yes"
    })
  },

  act_reset_roll_table: {
    title:"Reset Roll Table", color:"#7a4500", cat:"Chat",
    desc:"Resets the 'drawn' state of all results in a RollTable. Useful for no-replacement tables — once exhausted, call this to make every result available again.",
    inputs:[{id:"exec", label:"", type:"exec"}],
    outputs:[{id:"exec", label:"", type:"exec"}],
    fields:[
      {key:"tableName", label:"Table name (exact)", type:"text", default:"", placeholder:"exact table name"},
      {key:"tableUuid", label:"…or Table UUID",    type:"text", default:"", placeholder:"RollTable.xxxx"}
    ],
    isAction:true,
    toAction:(n)=>({ type:"rollTableReset", tableName:n.data.tableName ?? "", tableUuid:n.data.tableUuid ?? "" })
  },

  act_show_roll_table: {
    title:"Show Roll Table", color:"#7a4500", cat:"Chat",
    desc:"Open a RollTable's sheet for inspection. GM additionally pushes it to all players (handy for shared 'fortune' or 'omen' tables).",
    inputs:[{id:"exec", label:"", type:"exec"}],
    outputs:[{id:"exec", label:"", type:"exec"}],
    fields:[
      {key:"tableName", label:"Table name (exact)", type:"text", default:"", placeholder:"exact table name"},
      {key:"tableUuid", label:"…or Table UUID",    type:"text", default:"", placeholder:"RollTable.xxxx"}
    ],
    isAction:true,
    toAction:(n)=>({ type:"rollTableShow", tableName:n.data.tableName ?? "", tableUuid:n.data.tableUuid ?? "" })
  },

  act_card_shuffle: {
    title:"Shuffle Deck", color:"#5a2a7a", cat:"Cards",
    desc:"Shuffle a Cards stack (deck or discard pile). Posts a chat notification by default.",
    inputs:[{id:"exec", label:"", type:"exec"}],
    outputs:[{id:"exec", label:"", type:"exec"}],
    fields:[
      {key:"name",   label:"Stack name (exact)", type:"text", default:"", placeholder:"e.g. Tarot Deck"},
      {key:"uuid",   label:"…or Cards UUID",    type:"text", default:"", placeholder:"Cards.xxxx"},
      {key:"toChat", label:"Post to chat",       type:"select", default:"yes", options:["yes","no"]}
    ],
    isAction:true, wideNode:true,
    toAction:(n)=>({ type:"cardShuffle", name:n.data.name ?? "", uuid:n.data.uuid ?? "", toChat:n.data.toChat !== "no" })
  },

  act_card_draw: {
    title:"Draw Cards", color:"#5a2a7a", cat:"Cards",
    desc:"Draw N cards from one stack (deck) into another (hand). Found→ fires when at least one card was drawn — exposes {__lastDrawnCard} and {__lastDrawnCards}. Empty→ fires when the source stack has no available cards.",
    inputs:[
      {id:"exec",  label:"",      type:"exec"},
      {id:"count", label:"Count", type:"value.number"}
    ],
    outputs:[
      {id:"found", label:"Drawn →", type:"exec"},
      {id:"empty", label:"Empty →", type:"exec"},
      {id:"card",  label:"Card",    type:"value.any"},
      {id:"cards", label:"Cards",   type:"value.any"}
    ],
    fields:[
      {key:"fromName", label:"From (deck name)",  type:"text", default:"", placeholder:"e.g. Tarot Deck"},
      {key:"fromUuid", label:"…or From UUID",     type:"text", default:"", placeholder:"Cards.xxxx"},
      {key:"toName",   label:"To (hand name)",    type:"text", default:"", placeholder:"e.g. Aelyn's Hand"},
      {key:"toUuid",   label:"…or To UUID",       type:"text", default:"", placeholder:"Cards.xxxx"},
      {key:"count",    label:"Default count",     type:"number", default:1},
      {key:"how",      label:"Take from",         type:"select", default:"top", options:["top","bottom","random"]},
      {key:"toChat",   label:"Post to chat",      type:"select", default:"yes", options:["yes","no"]}
    ],
    isRollTableBranch:true, wideNode:true,
    toAction:(n,inp)=>({
      type:     "cardDraw",
      fromName: n.data.fromName ?? "",
      fromUuid: n.data.fromUuid ?? "",
      toName:   n.data.toName   ?? "",
      toUuid:   n.data.toUuid   ?? "",
      count:    inp.count ?? n.data.count ?? 1,
      how:      n.data.how ?? "top",
      toChat:   n.data.toChat !== "no"
    })
  },

  act_card_play: {
    title:"Play Card", color:"#5a2a7a", cat:"Cards",
    desc:"Play (publicly reveal & discard) a card from a hand or pile. Posts a chat card showing the face. Selector: top / random / first / by_name / specific (cardId).",
    inputs:[
      {id:"exec",   label:"",          type:"exec"},
      {id:"cardId", label:"Card id",    type:"value.string"}
    ],
    outputs:[{id:"exec", label:"", type:"exec"}],
    fields:[
      {key:"stackName",    label:"Hand name (exact)", type:"text", default:"", placeholder:"e.g. Aelyn's Hand"},
      {key:"stackUuid",    label:"…or Hand UUID",     type:"text", default:"", placeholder:"Cards.xxxx"},
      {key:"cardSelector", label:"Which card",        type:"select", default:"top", options:["top","random","first","by_name","specific"]},
      {key:"cardName",     label:"Card name (if by_name)", type:"text", default:""},
      {key:"cardId",       label:"Card id (if specific)",  type:"text", default:""}
    ],
    isAction:true, wideNode:true,
    toAction:(n,inp)=>({
      type:         "cardPlay",
      stackName:    n.data.stackName ?? "",
      stackUuid:    n.data.stackUuid ?? "",
      cardSelector: n.data.cardSelector ?? "top",
      cardName:     n.data.cardName ?? "",
      cardId:       inp.cardId ?? n.data.cardId ?? ""
    })
  },

  act_card_discard: {
    title:"Discard Card", color:"#5a2a7a", cat:"Cards",
    desc:"Silently move a card from a hand to its source deck's discard pile (no public chat-card). Useful for resource-as-cards (reagents, hero points).",
    inputs:[
      {id:"exec",   label:"",       type:"exec"},
      {id:"cardId", label:"Card id", type:"value.string"}
    ],
    outputs:[{id:"exec", label:"", type:"exec"}],
    fields:[
      {key:"stackName",    label:"Hand name (exact)", type:"text", default:""},
      {key:"stackUuid",    label:"…or Hand UUID",     type:"text", default:""},
      {key:"cardSelector", label:"Which card",        type:"select", default:"top", options:["top","random","first","by_name","specific"]},
      {key:"cardName",     label:"Card name (if by_name)", type:"text", default:""},
      {key:"toChat",       label:"Post to chat",      type:"select", default:"no", options:["yes","no"]}
    ],
    isAction:true, wideNode:true,
    toAction:(n,inp)=>({
      type:         "cardDiscard",
      stackName:    n.data.stackName ?? "",
      stackUuid:    n.data.stackUuid ?? "",
      cardSelector: n.data.cardSelector ?? "top",
      cardName:     n.data.cardName ?? "",
      cardId:       inp.cardId ?? "",
      toChat:       n.data.toChat === "yes"
    })
  },

  act_card_reveal: {
    title:"Reveal Card", color:"#5a2a7a", cat:"Cards",
    desc:"Post a chat-card showing a card's face (image + name + description) WITHOUT moving it. The card stays where it is.",
    inputs:[
      {id:"exec",   label:"",       type:"exec"},
      {id:"cardId", label:"Card id", type:"value.string"}
    ],
    outputs:[{id:"exec", label:"", type:"exec"}],
    fields:[
      {key:"stackName",    label:"Stack name (exact)", type:"text", default:""},
      {key:"stackUuid",    label:"…or Stack UUID",     type:"text", default:""},
      {key:"cardSelector", label:"Which card",         type:"select", default:"top", options:["top","random","first","by_name","specific"]},
      {key:"cardName",     label:"Card name (if by_name)", type:"text", default:""}
    ],
    isAction:true, wideNode:true,
    toAction:(n,inp)=>({
      type:         "cardReveal",
      stackName:    n.data.stackName ?? "",
      stackUuid:    n.data.stackUuid ?? "",
      cardSelector: n.data.cardSelector ?? "top",
      cardName:     n.data.cardName ?? "",
      cardId:       inp.cardId ?? ""
    })
  },

  act_card_pass: {
    title:"Pass Card", color:"#5a2a7a", cat:"Cards",
    desc:"Pass a card from one stack to another (e.g. give a card to another player). Posts a chat notification by default.",
    inputs:[
      {id:"exec",   label:"",       type:"exec"},
      {id:"cardId", label:"Card id", type:"value.string"}
    ],
    outputs:[{id:"exec", label:"", type:"exec"}],
    fields:[
      {key:"fromName",     label:"From stack name", type:"text", default:""},
      {key:"fromUuid",     label:"…or From UUID",   type:"text", default:""},
      {key:"toName",       label:"To stack name",   type:"text", default:""},
      {key:"toUuid",       label:"…or To UUID",     type:"text", default:""},
      {key:"cardSelector", label:"Which card",      type:"select", default:"top", options:["top","random","first","by_name","specific"]},
      {key:"cardName",     label:"Card name (if by_name)", type:"text", default:""},
      {key:"toChat",       label:"Post to chat",    type:"select", default:"yes", options:["yes","no"]}
    ],
    isAction:true, wideNode:true,
    toAction:(n,inp)=>({
      type:         "cardPass",
      fromName:     n.data.fromName ?? "",
      fromUuid:     n.data.fromUuid ?? "",
      toName:       n.data.toName   ?? "",
      toUuid:       n.data.toUuid   ?? "",
      cardSelector: n.data.cardSelector ?? "top",
      cardName:     n.data.cardName ?? "",
      cardId:       inp.cardId ?? "",
      toChat:       n.data.toChat !== "no"
    })
  },

  act_card_recall: {
    title:"Recall Cards", color:"#5a2a7a", cat:"Cards",
    desc:"Return all cards (from hands and piles) back to this deck — Foundry's Cards.recall(). Use to reset the game between sessions or shuffle a fresh starting deck.",
    inputs:[{id:"exec", label:"", type:"exec"}],
    outputs:[{id:"exec", label:"", type:"exec"}],
    fields:[
      {key:"name",   label:"Deck name (exact)", type:"text", default:""},
      {key:"uuid",   label:"…or Deck UUID",     type:"text", default:""},
      {key:"toChat", label:"Post to chat",      type:"select", default:"yes", options:["yes","no"]}
    ],
    isAction:true, wideNode:true,
    toAction:(n)=>({ type:"cardRecall", name:n.data.name ?? "", uuid:n.data.uuid ?? "", toChat:n.data.toChat !== "no" })
  },

  act_card_deal: {
    title:"Deal Cards", color:"#5a2a7a", cat:"Cards",
    desc:"Deal N cards from a source deck to multiple destination hands (comma- or semicolon-separated names/UUIDs). E.g. 'Aelyn's Hand, Boric's Hand, Lyra's Hand'.",
    inputs:[
      {id:"exec",  label:"",      type:"exec"},
      {id:"count", label:"Count", type:"value.number"}
    ],
    outputs:[{id:"exec", label:"", type:"exec"}],
    fields:[
      {key:"fromName", label:"From (deck name)", type:"text", default:""},
      {key:"fromUuid", label:"…or From UUID",    type:"text", default:""},
      {key:"toList",   label:"To stacks (CSV of names or UUIDs)", type:"text", default:"", placeholder:"Hand A, Hand B, Cards.xxxx"},
      {key:"count",    label:"Cards per target", type:"number", default:1},
      {key:"how",      label:"Take from",        type:"select", default:"top", options:["top","bottom","random"]},
      {key:"toChat",   label:"Post to chat",     type:"select", default:"yes", options:["yes","no"]}
    ],
    isAction:true, wideNode:true,
    toAction:(n,inp)=>({
      type:     "cardDeal",
      fromName: n.data.fromName ?? "",
      fromUuid: n.data.fromUuid ?? "",
      toList:   n.data.toList   ?? "",
      count:    inp.count ?? n.data.count ?? 1,
      how:      n.data.how ?? "top",
      toChat:   n.data.toChat !== "no"
    })
  },

  act_card_flip: {
    title:"Flip Card(s)", color:"#5a2a7a", cat:"Cards",
    desc:"Toggle a card's face vs back. Use cardId='*' (or leave blank with selector='*') to flip ALL cards in the stack at once.",
    inputs:[
      {id:"exec",   label:"",       type:"exec"},
      {id:"cardId", label:"Card id", type:"value.string"}
    ],
    outputs:[{id:"exec", label:"", type:"exec"}],
    fields:[
      {key:"stackName",    label:"Stack name (exact)", type:"text", default:""},
      {key:"stackUuid",    label:"…or Stack UUID",     type:"text", default:""},
      {key:"cardSelector", label:"Which card",         type:"select", default:"top", options:["top","random","first","by_name","specific","all"]},
      {key:"cardName",     label:"Card name (if by_name)", type:"text", default:""},
      {key:"face",         label:"Target face index (blank → toggle)", type:"number", default:null}
    ],
    isAction:true, wideNode:true,
    toAction:(n,inp)=>({
      type:         "cardFlip",
      stackName:    n.data.stackName ?? "",
      stackUuid:    n.data.stackUuid ?? "",
      cardSelector: n.data.cardSelector ?? "top",
      cardName:     n.data.cardName ?? "",
      cardId:       (n.data.cardSelector === "all") ? "*" : (inp.cardId ?? n.data.cardId ?? ""),
      face:         n.data.face === null || n.data.face === undefined || n.data.face === "" ? null : Number(n.data.face)
    })
  },

  get_card: {
    title:"Get Card", color:"#5a2a7a", cat:"Cards", wideNode:true,
    desc:"Pure source — read properties of a single card from a Cards stack. Pick the stack by name or UUID and choose which card to read via the selector. All outputs reflect the same card. cardId field is used only when selector=specific; cardName when selector=by_name.",
    inputs:[],
    outputs:[
      {id:"cardId",  label:"Card Id",   type:"value.string"},
      {id:"name",    label:"Name",      type:"value.string"},
      {id:"face",    label:"Face Idx",  type:"value.number"},
      {id:"faceImg", label:"Face Img",  type:"value.string"},
      {id:"backImg", label:"Back Img",  type:"value.string"},
      {id:"drawn",   label:"Drawn?",    type:"value.bool"},
      {id:"value",   label:"Value",     type:"value.number"},
      {id:"suit",    label:"Suit",      type:"value.string"},
      {id:"type",    label:"Type",      type:"value.string"},
      {id:"card",    label:"Card",      type:"value.card"}
    ],
    fields:[
      {key:"stackName", label:"Stack name (exact)", type:"text", default:"", placeholder:"e.g. Tarot Deck / Aelyn's Hand"},
      {key:"stackUuid", label:"…or Stack UUID",     type:"text", default:"", placeholder:"Cards.xxxx"},
      {key:"selector",  label:"Which card",         type:"select", default:"top", options:["top","first","bottom","random","by_name","specific"]},
      {key:"cardName",  label:"Card name (by_name)", type:"text", default:""},
      {key:"cardId",    label:"Card id (specific)",  type:"text", default:""}
    ],

    compilePin:(n, _i, fromPin) => {
      const payload = {
        stackName: n.data?.stackName ?? "",
        stackUuid: n.data?.stackUuid ?? "",
        selector:  n.data?.selector  ?? "top",
        cardName:  n.data?.cardName  ?? "",
        cardId:    n.data?.cardId    ?? ""
      };
      let b64 = "";
      try {
        const json = JSON.stringify(payload);
        b64 = (typeof btoa === "function") ? btoa(json) : Buffer.from(json, "utf8").toString("base64");
      } catch { b64 = ""; }
      const prop = String(fromPin ?? "cardId").replace(/[^A-Za-z0-9_]/g, "");
      return `{cardGet:${b64}:${prop || "cardId"}}`;
    }
  },

  stack_info: {
    title:"Stack Info", color:"#5a2a7a", cat:"Cards", wideNode:true,
    desc:"Pure source — read statistics for a Cards stack. count = total cards, availableCount = cards with drawn=false, drawnCount = drawn=true count, isEmpty = 1 when nothing available, topCardId / bottomCardId = current first/last available card id.",
    inputs:[],
    outputs:[
      {id:"count",          label:"Count",          type:"value.number"},
      {id:"availableCount", label:"Available",      type:"value.number"},
      {id:"drawnCount",     label:"Drawn",          type:"value.number"},
      {id:"isEmpty",        label:"Empty?",         type:"value.bool"},
      {id:"topCardId",      label:"Top Card Id",    type:"value.string"},
      {id:"bottomCardId",   label:"Bottom Card Id", type:"value.string"},
      {id:"name",           label:"Name",           type:"value.string"},
      {id:"uuid",           label:"UUID",           type:"value.string"}
    ],
    fields:[
      {key:"stackName", label:"Stack name (exact)", type:"text", default:"", placeholder:"e.g. Tarot Deck"},
      {key:"stackUuid", label:"…or Stack UUID",     type:"text", default:"", placeholder:"Cards.xxxx"}
    ],
    compilePin:(n, _i, fromPin) => {
      const payload = {
        stackName: n.data?.stackName ?? "",
        stackUuid: n.data?.stackUuid ?? ""
      };
      let b64 = "";
      try {
        const json = JSON.stringify(payload);
        b64 = (typeof btoa === "function") ? btoa(json) : Buffer.from(json, "utf8").toString("base64");
      } catch { b64 = ""; }
      const prop = String(fromPin ?? "count").replace(/[^A-Za-z0-9_]/g, "");
      return `{stackInfo:${b64}:${prop || "count"}}`;
    }
  },

  on_card_drawn: {
    title:"On Card Drawn", color:"#c04040", cat:"Events", wideNode:true,
    desc:"Fires when a Card document is created in the configured Cards stack (i.e. when a card is drawn into this hand / pile). Filter by stack name or UUID. Outputs expose the drawn card's id, name, face index, value, and parent stack info.",
    inputs:[],
    outputs:[
      {id:"exec",      label:"→ On Drawn",  type:"exec"},
      {id:"cardId",    label:"Card Id",     type:"value.string"},
      {id:"name",      label:"Name",        type:"value.string"},
      {id:"face",      label:"Face Idx",    type:"value.number"},
      {id:"value",     label:"Value",       type:"value.number"},
      {id:"stackId",   label:"Stack Id",    type:"value.string"},
      {id:"stackName", label:"Stack Name",  type:"value.string"}
    ],
    fields:[
      {key:"stackName", label:"Filter — stack name (exact)", type:"text", default:"", placeholder:"e.g. Aelyn's Hand"},
      {key:"stackUuid", label:"…or stack UUID",              type:"text", default:"", placeholder:"Cards.xxxx"}
    ],
    isEvent:true, eventHook:"cardDrawn"
  },

  on_quest_activated: {
    title:"On Quest Activated", color:"#c04040", cat:"Quest", wideNode:true,
    desc:"Fires when a quest in this QuestLog becomes active on any actor. Outputs the actor and quest involved.",
    inputs:[],
    outputs:[
      {id:"exec",         label:"→ On Activated",  type:"exec"},
      {id:"questId",      label:"Quest Id",         type:"value.string"},
      {id:"questLogUuid", label:"QuestLog Uuid",    type:"value.string"},
      {id:"actorId",      label:"Actor Id",         type:"value.string"}
    ],
    fields:[
      {key:"questIdFilter", label:"Only quest id (optional, blank = any)", type:"quest-id", default:""}
    ],
    isEvent:true, eventHook:"sdQuestActivated"
  },

  on_quest_completed: {
    title:"On Quest Completed", color:"#c04040", cat:"Quest", wideNode:true,
    desc:"Fires when a quest in this QuestLog is marked Completed.",
    inputs:[],
    outputs:[
      {id:"exec",         label:"→ On Completed",  type:"exec"},
      {id:"questId",      label:"Quest Id",         type:"value.string"},
      {id:"questLogUuid", label:"QuestLog Uuid",    type:"value.string"}
    ],
    fields:[
      {key:"questIdFilter", label:"Only quest id (optional)", type:"quest-id", default:""}
    ],
    isEvent:true, eventHook:"sdQuestCompleted"
  },

  on_quest_failed: {
    title:"On Quest Failed", color:"#c04040", cat:"Quest", wideNode:true,
    desc:"Fires when a quest in this QuestLog is marked Failed.",
    inputs:[],
    outputs:[
      {id:"exec",         label:"→ On Failed",      type:"exec"},
      {id:"questId",      label:"Quest Id",         type:"value.string"},
      {id:"questLogUuid", label:"QuestLog Uuid",    type:"value.string"}
    ],
    fields:[
      {key:"questIdFilter", label:"Only quest id (optional)", type:"quest-id", default:""}
    ],
    isEvent:true, eventHook:"sdQuestFailed"
  },

  on_subtask_done: {
    title:"On Subtask Done", color:"#c04040", cat:"Quest", wideNode:true,
    desc:"Fires when a subtask of a quest in this QuestLog is marked done.",
    inputs:[],
    outputs:[
      {id:"exec",         label:"→ On Subtask Done",type:"exec"},
      {id:"questId",      label:"Quest Id",         type:"value.string"},
      {id:"subtaskId",    label:"Subtask Id",       type:"value.string"}
    ],
    fields:[
      {key:"questIdFilter",   label:"Only quest id (optional)",   type:"quest-id", default:""},
      {key:"subtaskIdFilter", label:"Only subtask id (optional)", type:"subtask-id", default:""}
    ],
    isEvent:true, eventHook:"sdSubtaskDone"
  },

  on_quest_revealed: {
    title:"On GM Reveal", color:"#c04040", cat:"Quest", wideNode:true,
    desc:"Fires when GM toggles 'Reveal' on a quest in this QuestLog (visible-to-players override).",
    inputs:[],
    outputs:[
      {id:"exec",      label:"→ On Reveal",  type:"exec"},
      {id:"questId",   label:"Quest Id",      type:"value.string"},
      {id:"revealed",  label:"Revealed?",     type:"value.bool"}
    ],
    fields:[],
    isEvent:true, eventHook:"sdQuestRevealed"
  },

  quest_set_state: {
    title:"Set Quest State", color:"#3a8a60", cat:"Quest", wideNode:true,
    desc:"Change a quest to Available, Active, Completed, Failed, or Locked. Replaces the five separate quest-state nodes.",
    keywords:"activate complete fail lock available status state",
    inputs:[
      {id:"exec",     label:"",          type:"exec"},
      {id:"questId",  label:"Quest Id",  type:"value.string"},
      {id:"actorRef", label:"Actor",     type:"value.string"}
    ],
    outputs:[{id:"exec", label:"->", type:"exec"}],
    fields:[
      {key:"state", label:"State", type:"select", default:"activate", options:[
        {value:"available", label:"Quest available"},
        {value:"activate",  label:"Quest active"},
        {value:"complete",  label:"Quest completed"},
        {value:"fail",      label:"Quest failed"},
        {value:"lock",      label:"Quest locked"}
      ]},
      {key:"questId",  label:"Quest Id", type:"quest-id", default:"this"},
      {key:"actorRef", label:"Actor for Active state", type:"text", default:"", placeholder:"id, UUID, this, or blank"}
    ],
    toAction:(n,inp)=>({
      type:"questAction",
      op:String(n.data?.state ?? "activate"),
      questLogUuid:"this",
      questId:String(inp.questId ?? n.data?.questId ?? "this"),
      actorRef:String(inp.actorRef ?? n.data?.actorRef ?? "")
    })
  },

  quest_activate: {
    title:"Activate Quest", color:"#3a8a60", cat:"Quest", wideNode:true,
    hidden:true, replacement:"quest_set_state",
    desc:"Set status of a quest to 'active'. If 'Set on actor' is wired or filled, also writes actor.system.activeQuest.",
    inputs:[
      {id:"exec",     label:"",          type:"exec"},
      {id:"questId",  label:"Quest Id",   type:"value.string"},
      {id:"actorRef", label:"Actor (id/uuid/this/triggering)", type:"value.string"}
    ],
    outputs:[{id:"exec", label:"→",       type:"exec"}],
    fields:[
      {key:"questId",  label:"Quest Id (default — this quest's id, or filter)", type:"quest-id", default:"this"},
      {key:"actorRef", label:"Actor (id, uuid, 'this'=triggering, blank=current user's char)", type:"text", default:""}
    ],
    toAction:(n,inp)=>({
      type:"questAction", op:"activate",
      questLogUuid:"this",
      questId:  String(inp.questId  ?? n.data.questId  ?? "this"),
      actorRef: String(inp.actorRef ?? n.data.actorRef ?? "")
    })
  },

  quest_complete: {
    title:"Complete Quest", color:"#3a8a60", cat:"Quest",
    hidden:true, replacement:"quest_set_state",
    desc:"Set status of a quest to 'completed' and fire sdQuestCompleted hook.",
    inputs:[
      {id:"exec",    label:"",         type:"exec"},
      {id:"questId", label:"Quest Id", type:"value.string"}
    ],
    outputs:[{id:"exec", label:"→", type:"exec"}],
    fields:[
      {key:"questId", label:"Quest Id (default 'this')", type:"quest-id", default:"this"}
    ],
    toAction:(n,inp)=>({
      type:"questAction", op:"complete",
      questLogUuid:"this",
      questId: String(inp.questId ?? n.data.questId ?? "this")
    })
  },

  quest_fail: {
    title:"Fail Quest", color:"#a04050", cat:"Quest",
    hidden:true, replacement:"quest_set_state",
    desc:"Set status of a quest to 'failed' and fire sdQuestFailed.",
    inputs:[
      {id:"exec",    label:"",         type:"exec"},
      {id:"questId", label:"Quest Id", type:"value.string"}
    ],
    outputs:[{id:"exec", label:"→", type:"exec"}],
    fields:[
      {key:"questId", label:"Quest Id (default 'this')", type:"quest-id", default:"this"}
    ],
    toAction:(n,inp)=>({
      type:"questAction", op:"fail",
      questLogUuid:"this",
      questId: String(inp.questId ?? n.data.questId ?? "this")
    })
  },

  quest_lock: {
    title:"Lock Quest", color:"#7a7a8a", cat:"Quest",
    hidden:true, replacement:"quest_set_state",
    desc:"Set status of a quest to 'locked' (hidden from players regardless of visibility).",
    inputs:[
      {id:"exec",    label:"",         type:"exec"},
      {id:"questId", label:"Quest Id", type:"value.string"}
    ],
    outputs:[{id:"exec", label:"→", type:"exec"}],
    fields:[
      {key:"questId", label:"Quest Id (default 'this')", type:"quest-id", default:"this"}
    ],
    toAction:(n,inp)=>({
      type:"questAction", op:"lock",
      questLogUuid:"this",
      questId: String(inp.questId ?? n.data.questId ?? "this")
    })
  },

  quest_make_available: {
    title:"Make Quest Available", color:"#5a8ad8", cat:"Quest",
    hidden:true, replacement:"quest_set_state",
    desc:"Set status of a quest to 'available' (unlocked for activation).",
    inputs:[
      {id:"exec",    label:"",         type:"exec"},
      {id:"questId", label:"Quest Id", type:"value.string"}
    ],
    outputs:[{id:"exec", label:"→", type:"exec"}],
    fields:[
      {key:"questId", label:"Quest Id (default 'this')", type:"quest-id", default:"this"}
    ],
    toAction:(n,inp)=>({
      type:"questAction", op:"available",
      questLogUuid:"this",
      questId: String(inp.questId ?? n.data.questId ?? "this")
    })
  },

  subtask_set_done: {
    title:"Set Subtask Done", color:"#3a8a60", cat:"Quest", wideNode:true,
    desc:"Mark a subtask done/undone. Fires sdSubtaskDone when becoming done.",
    inputs:[
      {id:"exec",       label:"",          type:"exec"},
      {id:"questId",    label:"Quest Id",   type:"value.string"},
      {id:"subtaskId",  label:"Subtask Id", type:"value.string"},
      {id:"done",       label:"Done",       type:"value.bool"}
    ],
    outputs:[{id:"exec", label:"→", type:"exec"}],
    fields:[
      {key:"questId",   label:"Quest Id (default 'this')",   type:"quest-id", default:"this"},
      {key:"subtaskId", label:"Subtask Id",                  type:"subtask-id", default:""},
      {key:"done",      label:"Done value (when no input)",  type:"select", default:"true", options:["true","false"]}
    ],
    toAction:(n,inp)=>({
      type:"questAction", op:"subtaskDone",
      questLogUuid:"this",
      questId:   String(inp.questId   ?? n.data.questId   ?? "this"),
      subtaskId: String(inp.subtaskId ?? n.data.subtaskId ?? ""),
      done: (inp.done !== undefined && inp.done !== "")
              ? !!(inp.done === true || inp.done === "true" || Number(inp.done) === 1)
              : (n.data.done === "false" ? false : true)
    })
  },

  quest_show_to_player: {
    title:"Show Quest To Player", color:"#5a8ad8", cat:"Quest", wideNode:true,
    desc:"Add a player (userId) to a quest's perPlayer visibility list. Switches mode to 'perPlayer' if not already.",
    inputs:[
      {id:"exec",    label:"",         type:"exec"},
      {id:"questId", label:"Quest Id", type:"value.string"},
      {id:"userId",  label:"User Id",  type:"value.string"}
    ],
    outputs:[{id:"exec", label:"→", type:"exec"}],
    fields:[
      {key:"questId", label:"Quest Id (default 'this')", type:"quest-id", default:"this"},
      {key:"userId",  label:"User Id ('this'=triggering, blank/all=everyone)", type:"text", default:""}
    ],
    toAction:(n,inp)=>({
      type:"questAction", op:"showToPlayer",
      questLogUuid:"this",
      questId: String(inp.questId ?? n.data.questId ?? "this"),
      userId:  String(inp.userId  ?? n.data.userId  ?? "")
    })
  },

  quest_toggle_gm_reveal: {
    title:"Toggle GM Reveal", color:"#d8a83a", cat:"Quest",
    desc:"Toggle the GM 'Revealed' override on a quest (makes it visible to players regardless of visibility mode).",
    inputs:[
      {id:"exec",    label:"",         type:"exec"},
      {id:"questId", label:"Quest Id", type:"value.string"},
      {id:"on",      label:"On (bool, blank=toggle)", type:"value.bool"}
    ],
    outputs:[{id:"exec", label:"→", type:"exec"}],
    fields:[
      {key:"questId", label:"Quest Id (default 'this')", type:"quest-id", default:"this"},
      {key:"on",      label:"On (true/false, blank=toggle)", type:"select", default:"toggle", options:["toggle","true","false"]}
    ],
    toAction:(n,inp)=>{
      const onIn = inp.on;
      let on = null;
      if (onIn !== undefined && onIn !== "" && onIn !== null) {
        on = !!(onIn === true || onIn === "true" || Number(onIn) === 1);
      } else if (n.data.on === "true")  on = true;
      else if (n.data.on === "false") on = false;
      return {
        type:"questAction", op:"toggleReveal",
        questLogUuid:"this",
        questId: String(inp.questId ?? n.data.questId ?? "this"),
        on
      };
    }
  },

  reward_reveal: {
    title:"Reveal Reward", color:"#d8a83a", cat:"Quest", wideNode:true,
    desc:"Toggle GM-reveal on a reward — overrides hidden/onCompletion/conditional visibility so players can see it.",
    inputs:[
      {id:"exec",     label:"",          type:"exec"},
      {id:"questId",  label:"Quest Id",  type:"value.string"},
      {id:"rewardId", label:"Reward Id", type:"value.string"},
      {id:"on",       label:"On (blank=toggle)", type:"value.bool"}
    ],
    outputs:[{id:"exec", label:"→", type:"exec"}],
    fields:[
      {key:"questId",  label:"Quest Id (default 'this')",  type:"quest-id", default:"this"},
      {key:"rewardId", label:"Reward Id (required)",       type:"reward-id", default:""},
      {key:"on",       label:"On (true/false, blank=toggle)", type:"select", default:"toggle", options:["toggle","true","false"]}
    ],
    toAction:(n,inp)=>{
      const onIn = inp.on;
      let on = null;
      if (onIn !== undefined && onIn !== "" && onIn !== null) {
        on = !!(onIn === true || onIn === "true" || Number(onIn) === 1);
      } else if (n.data.on === "true")  on = true;
      else if (n.data.on === "false") on = false;
      return {
        type:"questAction", op:"rewardReveal",
        questLogUuid:"this",
        questId:  String(inp.questId  ?? n.data.questId  ?? "this"),
        rewardId: String(inp.rewardId ?? n.data.rewardId ?? ""),
        on
      };
    }
  },

  reward_make_claimable: {
    title:"Make Reward Claimable", color:"#3a8a60", cat:"Quest", wideNode:true,
    desc:"Set the reward's 'claimable' flag, enabling/disabling the player's Claim button.",
    inputs:[
      {id:"exec",     label:"",          type:"exec"},
      {id:"questId",  label:"Quest Id",  type:"value.string"},
      {id:"rewardId", label:"Reward Id", type:"value.string"},
      {id:"on",       label:"On (blank=true)", type:"value.bool"}
    ],
    outputs:[{id:"exec", label:"→", type:"exec"}],
    fields:[
      {key:"questId",  label:"Quest Id (default 'this')",  type:"quest-id", default:"this"},
      {key:"rewardId", label:"Reward Id (required)",       type:"reward-id", default:""},
      {key:"on",       label:"On (true/false, blank=true)", type:"select", default:"true", options:["true","false"]}
    ],
    toAction:(n,inp)=>{
      const onIn = inp.on;
      let on = true;
      if (onIn !== undefined && onIn !== "" && onIn !== null) {
        on = !!(onIn === true || onIn === "true" || Number(onIn) === 1);
      } else if (n.data.on === "true")  on = true;
      else if (n.data.on === "false") on = false;
      return {
        type:"questAction", op:"rewardMakeClaimable",
        questLogUuid:"this",
        questId:  String(inp.questId  ?? n.data.questId  ?? "this"),
        rewardId: String(inp.rewardId ?? n.data.rewardId ?? ""),
        on
      };
    }
  },

  reward_grant_all: {
    title:"Grant Reward To All", color:"#a0408a", cat:"Quest", wideNode:true,
    desc:"Force-grant a reward to every player who has a character (skips claim, applies items/currency/path-changes).",
    inputs:[
      {id:"exec",     label:"",          type:"exec"},
      {id:"questId",  label:"Quest Id",  type:"value.string"},
      {id:"rewardId", label:"Reward Id", type:"value.string"}
    ],
    outputs:[{id:"exec", label:"→", type:"exec"}],
    fields:[
      {key:"questId",  label:"Quest Id (default 'this')", type:"quest-id", default:"this"},
      {key:"rewardId", label:"Reward Id (required)",      type:"reward-id", default:""}
    ],
    toAction:(n,inp)=>({
      type:"questAction", op:"rewardGrantAll",
      questLogUuid:"this",
      questId:  String(inp.questId  ?? n.data.questId  ?? "this"),
      rewardId: String(inp.rewardId ?? n.data.rewardId ?? "")
    })
  },

  quest_status: {
    title:"Quest Status", color:"#5a4ec0", cat:"Quest", wideNode:true,
    desc:"Pure source — read the current status of a quest as a string ('locked'/'available'/'active'/'completed'/'failed').",
    inputs:[],
    outputs:[
      {id:"status",     label:"Status",      type:"value.string"},
      {id:"isCompleted",label:"Completed?",  type:"value.bool"},
      {id:"isFailed",   label:"Failed?",     type:"value.bool"},
      {id:"isActive",   label:"Active?",     type:"value.bool"}
    ],
    fields:[
      {key:"questId", label:"Quest Id (default 'this')", type:"quest-id", default:"this"}
    ],
    compilePin:(n, _i, fromPin) => {
      const raw = String(n.data?.questId ?? "this");
      const qid = (raw === "this" || raw === "") ? "__SDQ_THIS__" : raw.replace(/[^A-Za-z0-9_-]/g, "");
      const prop = String(fromPin ?? "status").replace(/[^A-Za-z0-9_]/g, "");
      return `{questGet:${prop || "status"}:${qid}}`;
    }
  },

  quest_is_active: {
    title:"Quest Is Active?", color:"#5a4ec0", cat:"Quest",
    desc:"Pure source — true if a quest's status is 'active' (regardless of which actor).",
    inputs:[],
    outputs:[{id:"value", label:"Active?", type:"value.bool"}],
    fields:[
      {key:"questId", label:"Quest Id (default 'this')", type:"quest-id", default:"this"}
    ],
    compilePin:(n)=>{
      const raw = String(n.data?.questId ?? "this");
      const qid = (raw === "this" || raw === "") ? "__SDQ_THIS__" : raw.replace(/[^A-Za-z0-9_-]/g, "");
      return `{questGet:isActive:${qid}}`;
    }
  },

  subtask_done: {
    title:"Subtask Done?", color:"#5a4ec0", cat:"Quest", wideNode:true,
    desc:"Pure source — true if a subtask is marked done.",
    inputs:[],
    outputs:[{id:"value", label:"Done?", type:"value.bool"}],
    fields:[
      {key:"questId",   label:"Quest Id (default 'this')", type:"quest-id", default:"this"},
      {key:"subtaskId", label:"Subtask Id (default 'this')", type:"subtask-id", default:"this"}
    ],
    compilePin:(n)=>{
      const rawQ = String(n.data?.questId ?? "this");
      const qid = (rawQ === "this" || rawQ === "") ? "__SDQ_THIS__" : rawQ.replace(/[^A-Za-z0-9_-]/g, "");
      const rawS = String(n.data?.subtaskId ?? "this");
      const sid = (rawS === "this" || rawS === "") ? "__SDQ_THIS_SUB__" : rawS.replace(/[^A-Za-z0-9_-]/g, "");
      return `{questGet:subtaskDone:${qid}:${sid}}`;
    }
  },

  current_user_id: {
    title:"Current User", color:"#5a4ec0", cat:"Quest",
    desc:"Pure source — id and role of the user the script runs for.",
    inputs:[],
    outputs:[
      {id:"id",   label:"User Id",  type:"value.string"},
      {id:"name", label:"User Name",type:"value.string"},
      {id:"role", label:"Role",     type:"value.string"},
      {id:"isGM", label:"Is GM?",   type:"value.bool"}
    ],
    fields:[],
    compilePin:(_n, _i, fromPin) => {
      const prop = String(fromPin ?? "id").replace(/[^A-Za-z0-9_]/g, "");
      return `{currentUser:${prop || "id"}}`;
    }
  },

  actor_on_scene: {
    title:"Actor On Scene?", color:"#5a4ec0", cat:"Quest", wideNode:true,
    desc:"Pure source — true if the given actor (by id or name) has at least one token on the currently viewed scene.",
    inputs:[],
    outputs:[{id:"value", label:"On Scene?", type:"value.bool"}],
    fields:[
      {key:"actorRef", label:"Actor (id or exact name)", type:"text", default:""}
    ],
    compilePin:(n)=>{
      const ref = String(n.data?.actorRef ?? "").replace(/[^A-Za-z0-9_\- ]/g, "");
      return `{sdActorOnScene:${ref}}`;
    }
  },

  field_equals: {
    title:"Field Value Equals?", color:"#5a4ec0", cat:"Quest", wideNode:true,
    desc:"Pure source — true if a path on a referenced actor equals the given value (string compare). Use to gate quest progress on actor stats / flags.",
    inputs:[],
    outputs:[
      {id:"value", label:"Equals?", type:"value.bool"},
      {id:"raw",   label:"Raw",      type:"value.string"}
    ],
    fields:[
      {key:"actorRef", label:"Actor (id, name, blank=current user's char)", type:"text", default:""},
      {key:"path",     label:"Path on actor", type:"path", default:"system.attributes.attr1.value"},
      {key:"expected", label:"Expected value (string compare)", type:"text", default:""}
    ],
    compilePin:(n, _i, fromPin)=>{
      const ref = String(n.data?.actorRef ?? "").replace(/[^A-Za-z0-9_\- ]/g, "");
      const path = String(n.data?.path ?? "").replace(/[^A-Za-z0-9_.]/g, "");
      const exp  = String(n.data?.expected ?? "").replace(/[^A-Za-z0-9_.\- ]/g, "");
      const prop = (fromPin === "raw") ? "raw" : "eq";
      return `{sdFieldEq:${prop}|${ref}|${path}|${exp}}`;
    }
  },

  vision_visible_tokens: {
    title:"Vision — Visible Tokens", color:"#2a6a7a", cat:"Scene", wideNode:true,
    desc:"Pure source. Returns either a comma-joined array of token ids (pin `v`) or actor UUIDs (pin `actors`) visible from the source within Distance feet and within a vision cone of Angle degrees (360 = full circle). Token-id output feeds into For Each Token / tokenField / Array nodes; actor-uuid output is portable across scenes and feeds straight into actor-accepting nodes (Modify Field, Apply Effect, Cast To Actor, …). The Actor input accepts a Get Actor / Get Self / explicit Actor UUID (Actor.xxx) — UUIDs are resolved to the actor's first active token on the current scene. Optional Show draws a semi-transparent vision ray on the canvas every time the array is resolved (use sparingly).",
    inputs:[
      {id:"actor",    label:"Actor",        type:"value.actor"},
      {id:"distance", label:"Distance (ft)",type:"value.number"},
      {id:"angle",    label:"Angle (deg)",  type:"value.number"}
    ],
    outputs:[
      {id:"v",      label:"Visible Tokens",     type:"value.array"},
      {id:"actors", label:"Visible Actor UUIDs",type:"value.array"}
    ],
    fields:[
      {key:"distance",   label:"Distance (ft)",          type:"number", default:30},
      {key:"angle",      label:"Vision angle (deg)",     type:"number", default:360, placeholder:"360 = full circle"},
      {key:"show",       label:"Draw vision ray",        type:"select", default:"no", options:["no","yes"]},
      {key:"requireLOS", label:"Require Line of Sight",  type:"select", default:"yes", options:["yes","no"]}
    ],
    compilePin:(n, i, fromPin)=>{
      const base = (i.actor != null && i.actor !== "" && i.actor !== "0") ? String(i.actor) : `"self"`;
      const dist = (i.distance != null && i.distance !== "") ? String(i.distance) : String(n.data?.distance ?? 30);
      const ang  = (i.angle    != null && i.angle    !== "") ? String(i.angle)    : String(n.data?.angle    ?? 360);
      const show = (n.data?.show === "yes") ? 1 : 0;
      const los  = (n.data?.requireLOS === "no") ? 0 : 1;
      const head = (fromPin === "actors") ? "visibleActors" : "visibleTokens";
      return `{${head}:${base}|${dist}|${ang}|${show}|${los}}`;
    },
    compile:(n,i)=>{
      const base = (i.actor != null && i.actor !== "" && i.actor !== "0") ? String(i.actor) : `"self"`;
      const dist = (i.distance != null && i.distance !== "") ? String(i.distance) : String(n.data?.distance ?? 30);
      const ang  = (i.angle    != null && i.angle    !== "") ? String(i.angle)    : String(n.data?.angle    ?? 360);
      const show = (n.data?.show === "yes") ? 1 : 0;
      const los  = (n.data?.requireLOS === "no") ? 0 : 1;
      return `{visibleTokens:${base}|${dist}|${ang}|${show}|${los}}`;
    }
  },

  act_vision_scan: {
    title:"Vision Scan (Action)", color:"#2a6a7a", cat:"Scene", wideNode:true,
    desc:"Action node — runs a one-shot vision scan when its exec input fires. Use the new `On Vision Detect` event node for hook-driven triggers; this node stays for on-demand scans (e.g. from an On Click button, or chained after another action). The Actor input accepts a Get Actor / Get Self / explicit Actor UUID (Actor.xxx) — UUIDs are resolved to the actor's first active token on the current scene. Outputs both the token-id array (`v`, also as {__visionLast}) and the actor-UUID array (`actors`, also as {__visionLastActors}). Optionally draws a semi-transparent vision ray on the canvas (configurable colour & duration).",
    wideNode:true,
    inputs:[
      {id:"exec",     label:"",             type:"exec"},
      {id:"actor",    label:"Actor",        type:"value.actor"},
      {id:"distance", label:"Distance (ft)",type:"value.number"},
      {id:"angle",    label:"Angle (deg)",  type:"value.number"}
    ],
    outputs:[
      {id:"exec",   label:"",                  type:"exec"},
      {id:"v",      label:"Visible Tokens",    type:"value.array"},
      {id:"actors", label:"Visible Actor UUIDs", type:"value.array"}
    ],
    fields:[
      {key:"distance",    label:"Distance (ft)",                                  type:"number", default:30},
      {key:"angle",       label:"Vision angle (deg)",                             type:"number", default:360, placeholder:"360 = full circle"},
      {key:"distPath",    label:"Distance from hidden field (overrides number)",  type:"path",   default:"",  placeholder:"system.hiddenFields.vision"},
      {key:"anglePath",   label:"Angle from hidden field (overrides number)",     type:"path",   default:"",  placeholder:"system.hiddenFields.visionAngle"},
      {key:"show",        label:"Draw vision ray",                                type:"select", default:"yes", options:["yes","no"]},
      {key:"showColor",   label:"Ray colour",                                     type:"text",   default:"#74a7ff", placeholder:"#74a7ff"},
      {key:"showSeconds", label:"Ray duration (sec)",                             type:"number", default:2},
      {key:"requireLOS",  label:"Require Line of Sight",                          type:"select", default:"yes", options:["yes","no"]}
    ],
    isAction:true,
    compilePin:(_n, _ins, fromPin)=>{
      if (fromPin === "v")      return `{__visionLast}`;
      if (fromPin === "actors") return `{__visionLastActors}`;
      return "0";
    },
    toAction:(n,inp)=>{
      const _wired = (v) => v !== undefined && v !== null && v !== "" && v !== "0" && v !== `"0"`;
      return {
        type:        "visionScan",
        actorOverride: _wired(inp.actor) ? String(inp.actor) : null,
        distance:    _wired(inp.distance) ? String(inp.distance) : String(n.data?.distance ?? 30),
        angle:       _wired(inp.angle)    ? String(inp.angle)    : String(n.data?.angle    ?? 360),
        distPath:    String(n.data?.distPath ?? ""),
        anglePath:   String(n.data?.anglePath ?? ""),
        show:        n.data?.show !== "no",
        showColor:   String(n.data?.showColor ?? "#74a7ff"),
        showSeconds: Number(n.data?.showSeconds ?? 2) || 2,
        requireLOS:  n.data?.requireLOS !== "no"
      };
    }
  },

  on_vision_detect: {
    title:"On Vision Detect", color:"#2a6a7a", cat:"Scene", wideNode:true,
    desc:"Event trigger — fires when this actor (the document the graph runs on) detects one or more new tokens in its vision cone. Re-evaluated whenever tokens move/spawn/disappear on the same scene as the actor; only NEW tokens (relative to the previous scan) trigger the event. Configure the scan with Distance (number or hidden field), Angle (deg), and Require LOS just like the Vision Scan node. Outputs expose: the detector actor's UUID, the comma-joined array of NEW detected actor UUIDs and token ids, and the first newly-detected actor's UUID for the common single-target case. Optional Show draws a brief vision ray on every detection (useful for debugging).",
    inputs:[],
    outputs:[
      {id:"exec",        label:"→ On Detect",       type:"exec"},
      {id:"actorUuid",   label:"Detector Actor UUID", type:"value.string"},
      {id:"firstActor",  label:"First Detected Actor UUID", type:"value.string"},
      {id:"actors",      label:"Detected Actor UUIDs",     type:"value.array"},
      {id:"tokens",      label:"Detected Token Ids",        type:"value.array"}
    ],
    fields:[
      {key:"distance",   label:"Distance (ft)",                                  type:"number", default:30},
      {key:"angle",      label:"Vision angle (deg)",                             type:"number", default:360, placeholder:"360 = full circle"},
      {key:"distPath",   label:"Distance from hidden field (overrides number)",  type:"path",   default:"",    placeholder:"system.hiddenFields.vision"},
      {key:"anglePath",  label:"Angle from hidden field (overrides number)",     type:"path",   default:"",    placeholder:"system.hiddenFields.visionAngle"},
      {key:"requireLOS", label:"Require Line of Sight",                          type:"select", default:"yes", options:["yes","no"]},
      {key:"show",       label:"Draw vision ray on each fire",                   type:"select", default:"no",  options:["no","yes"]},
      {key:"showColor",  label:"Ray colour",                                     type:"text",   default:"#74a7ff", placeholder:"#74a7ff"},
      {key:"showSeconds",label:"Ray duration (sec)",                             type:"number", default:1.5}
    ],
    isEvent:true, eventHook:"sdVisionDetect"
  },

  tok_elevation: {
    title:"Get Token Elevation", color:"#1a4060", cat:"Scene", wideNode:true,
    desc:"Returns the elevation (vertical position) of a token. Source can be: \"self\" (this actor's first active token), \"selected_token\", \"token_target\", a token id, an Actor.xxxx UUID, or a wired Token / Actor pin. Optional rounding: floor, ceil, round (or none = raw value).",
    inputs:[{id:"token", label:"Token", type:"value.any"}],
    outputs:[{id:"v", label:"Elevation", type:"value.number"}],
    fields:[
      {key:"token", label:"Token / Actor (optional)", type:"text", default:"self", placeholder:"self / selected_token / token id / Actor.xxxx"},
      {key:"round", label:"Rounding", type:"select", default:"none", options:["none","floor","ceil","round"]}
    ],
    compile:(n, i) => {
      const _q = s => `"${String(s).replace(/"/g,'\\"')}"`;
      const t = (i?.token != null && i.token !== "") ? String(i.token) : _q(n.data?.token ?? "self");
      const r = String(n.data?.round ?? "none");
      return `{tokenElevation:${t}|${r}}`;
    }
  },

  tok_walls_between: {
    title:"Walls Between Tokens", color:"#1a4060", cat:"Scene", wideNode:true,
    desc:"Check walls on the straight line between two tokens. Source/Target accept: \"self\", \"selected_token\", \"token_target\", a token id, an Actor.xxxx UUID, or a wired Token / Actor pin. \"Wall blocks\" picks which wall property must restrict to count: move / sight / sound / any (any wall counts).",
    inputs:[
      {id:"source", label:"Source", type:"value.any"},
      {id:"target", label:"Target", type:"value.any"}
    ],
    outputs:[
      {id:"hasWall", label:"Has Wall", type:"value.bool"},
      {id:"count",   label:"Count",    type:"value.number"}
    ],
    fields:[
      {key:"source", label:"Source (optional)", type:"text", default:"self",         placeholder:"self / token id / Actor.xxxx"},
      {key:"target", label:"Target (optional)", type:"text", default:"token_target", placeholder:"token_target / selected_token / token id"},
      {key:"type",   label:"Wall blocks",       type:"select", default:"move", options:["move","sight","sound","any"]}
    ],
    compile:(n, i) => {
      const _q = s => `"${String(s).replace(/"/g,'\\"')}"`;
      const s = (i?.source != null && i.source !== "") ? String(i.source) : _q(n.data?.source ?? "self");
      const t = (i?.target != null && i.target !== "") ? String(i.target) : _q(n.data?.target ?? "token_target");
      const ty = String(n.data?.type ?? "move");
      return `{wallsBetween:${s}|${t}|${ty}}`;
    },
    compilePin:(n, ins, fromPin) => {
      const _q = s => `"${String(s).replace(/"/g,'\\"')}"`;
      const s = (ins?.source != null && ins.source !== "") ? String(ins.source) : _q(n.data?.source ?? "self");
      const t = (ins?.target != null && ins.target !== "") ? String(ins.target) : _q(n.data?.target ?? "token_target");
      const ty = String(n.data?.type ?? "move");
      const expr = `{wallsBetween:${s}|${t}|${ty}}`;
      if (fromPin === "hasWall") return `(${expr} > 0)`;
      return expr;
    }
  },

  tok_tiles_between: {
    title:"Tiles Between Tokens", color:"#1a4060", cat:"Scene", wideNode:true,
    desc:"Count tiles whose bounding rectangle is crossed by the straight line between two tokens. Source/Target accept: \"self\", \"selected_token\", \"token_target\", a token id, an Actor.xxxx UUID, or a wired Token / Actor pin. Filter: any / overhead / ground; hidden tiles are skipped unless explicitly included.",
    inputs:[
      {id:"source", label:"Source", type:"value.any"},
      {id:"target", label:"Target", type:"value.any"}
    ],
    outputs:[
      {id:"hasTile", label:"Has Tile", type:"value.bool"},
      {id:"count",   label:"Count",    type:"value.number"}
    ],
    fields:[
      {key:"source",        label:"Source (optional)", type:"text", default:"self",         placeholder:"self / token id / Actor.xxxx"},
      {key:"target",        label:"Target (optional)", type:"text", default:"token_target", placeholder:"token_target / selected_token / token id"},
      {key:"filter",        label:"Filter",            type:"select", default:"any",      options:["any","overhead","ground"]},
      {key:"includeHidden", label:"Include hidden tiles", type:"select", default:"no", options:["no","yes"]}
    ],
    compile:(n, i) => {
      const _q = s => `"${String(s).replace(/"/g,'\\"')}"`;
      const s = (i?.source != null && i.source !== "") ? String(i.source) : _q(n.data?.source ?? "self");
      const t = (i?.target != null && i.target !== "") ? String(i.target) : _q(n.data?.target ?? "token_target");
      const f = String(n.data?.filter ?? "any");
      const ih = (n.data?.includeHidden === "yes") ? "1" : "0";
      return `{tilesBetween:${s}|${t}|${f}|${ih}}`;
    },
    compilePin:(n, ins, fromPin) => {
      const _q = s => `"${String(s).replace(/"/g,'\\"')}"`;
      const s = (ins?.source != null && ins.source !== "") ? String(ins.source) : _q(n.data?.source ?? "self");
      const t = (ins?.target != null && ins.target !== "") ? String(ins.target) : _q(n.data?.target ?? "token_target");
      const f = String(n.data?.filter ?? "any");
      const ih = (n.data?.includeHidden === "yes") ? "1" : "0";
      const expr = `{tilesBetween:${s}|${t}|${f}|${ih}}`;
      if (fromPin === "hasTile") return `(${expr} > 0)`;
      return expr;
    }
  },

  act_set_elevation: {
    title:"Set Token Elevation", color:"#2a4a8a", cat:"Scene", wideNode:true,
    desc:"Change a token's elevation. Mode: set replaces the elevation with Value; add increments by Value (negative = descend). Token accepts the same options as Get Token Elevation. Value can be wired (Get Field Value / Literal) or typed inline.",
    inputs:[
      {id:"exec",  label:"",      type:"exec"},
      {id:"token", label:"Token", type:"value.any"},
      {id:"value", label:"Value", type:"value.number"}
    ],
    outputs:[{id:"exec", label:"", type:"exec"}],
    fields:[
      {key:"token", label:"Token (optional)", type:"text",   default:"self", placeholder:"self / selected_token / token id"},
      {key:"value", label:"Value",            type:"number", default:0},
      {key:"mode",  label:"Mode",             type:"select", default:"set", options:["set","add"]},
      {key:"animate", label:"Animate",        type:"select", default:"yes", options:["yes","no"]}
    ],
    isAction:true,
    toAction:(n, inp) => {
      const _wired = v => v !== undefined && v !== null && v !== "" && v !== "0" && v !== `"0"`;
      return {
        type:     "setTokenElevation",
        tokenRef: _wired(inp.token) ? String(inp.token) : String(n.data?.token ?? "self"),
        value:    _wired(inp.value) ? String(inp.value) : String(n.data?.value ?? 0),
        mode:     String(n.data?.mode ?? "set"),
        animate:  n.data?.animate !== "no"
      };
    }
  },

  on_macro_use: {
    title:"On Macro Use", color:"#c04040", cat:"Events", wideNode:true,
    desc:"Fires whenever a Macro is executed (chat command, hotbar click or any code-driven .execute()). Optionally filter by macro id, UUID or exact name; leave blank to react to ANY macro. Outputs expose the executed macro and the speaker actor / token at the moment of the call.",
    inputs:[],
    outputs:[
      {id:"exec",      label:"→ On Macro Use", type:"exec"},
      {id:"macroId",   label:"Macro Id",        type:"value.string"},
      {id:"macroName", label:"Macro Name",      type:"value.string"},
      {id:"actorId",   label:"Actor Id",        type:"value.string"},
      {id:"tokenId",   label:"Token Id",        type:"value.string"}
    ],
    fields:[
      {key:"macroFilter", label:"Only macro (id / uuid / name; optional)", type:"text", default:"", placeholder:"Macro.xxxx / My Macro Name"}
    ],
    isEvent:true, eventHook:"sdMacroUse"
  },

  act_move_token: {
    title:"Move Token", color:"#2a4a8a", cat:"Scene", wideNode:true,
    desc:"Move a token by Distance feet in the given Direction.  Direction modes:  • Degrees — Direction is a 0-360В° heading (0 = up / north, 90 = right / east, 180 = down, 270 = left).  • Square — Direction is an index 0-7 starting at North then clockwise: 0 N, 1 NE, 2 E, 3 SE, 4 S, 5 SW, 6 W, 7 NW (full 8-way including diagonals).  • Hex — Direction is an index 0-5 along the scene's hex grid directions (auto-detects columnar / row-wise).  Wall passthrough: when off, the move is cancelled if walls block the path.",
    inputs:[
      {id:"exec",      label:"",             type:"exec"},
      {id:"actor",     label:"Actor",        type:"value.actor"},
      {id:"distance",  label:"Distance (ft)",type:"value.number"},
      {id:"direction", label:"Direction",    type:"value.number"}
    ],
    outputs:[{id:"exec", label:"", type:"exec"}],
    fields:[
      {key:"distance",  label:"Distance (ft)",     type:"number", default:5},
      {key:"mode",      label:"Direction mode",    type:"select", default:"degrees", options:["degrees","square","hex"]},
      {key:"direction", label:"Direction value",   type:"number", default:0, placeholder:"0-360 / 0-7 / 0-5"},
      {key:"passWalls", label:"Pass through walls",type:"select", default:"no",  options:["no","yes"]},
      {key:"animate",   label:"Animate movement",  type:"select", default:"yes", options:["yes","no"]}
    ],
    isAction:true,
    toAction:(n,inp)=>{
      const _wired = (v) => v !== undefined && v !== null && v !== "" && v !== "0" && v !== `"0"`;
      return {
        type:      "moveToken",
        actorRef:  _wired(inp.actor)     ? String(inp.actor)     : null,
        distance:  _wired(inp.distance)  ? String(inp.distance)  : String(n.data?.distance  ?? 5),
        direction: _wired(inp.direction) ? String(inp.direction) : String(n.data?.direction ?? 0),
        mode:      String(n.data?.mode ?? "degrees"),
        passWalls: n.data?.passWalls === "yes",
        animate:   n.data?.animate !== "no"
      };
    }
  },

  act_tts: {
    title:"TTS — Speak", color:"#7a4a8a", cat:"System", wideNode:true,
    desc:"Speak the input text out loud through every connected client using the browser's built-in Web Speech API (no external service, no API key, voices come from the operating system). Text input is also passed through to the Text output pin so you can chain it (e.g. also post to chat). Voice & language pickers are free-form — leave blank to use the browser default. Rate 0.1-10, Pitch 0-2, Volume 0-1. Target controls who speaks: all = everyone (default), gm = GM only, players = all non-GM clients, self = only the user who triggered it.",
    inputs:[
      {id:"exec",  label:"",     type:"exec"},
      {id:"text",  label:"Text", type:"value.string"}
    ],
    outputs:[
      {id:"exec",  label:"",     type:"exec"},
      {id:"text",  label:"Text", type:"value.string"}
    ],
    fields:[
      {key:"text",   label:"Text (used if Text pin is empty)", type:"text",   default:""},
      {key:"voice",  label:"Voice name (blank = default)",     type:"text",   default:"",  placeholder:"Microsoft David — English (US)"},
      {key:"lang",   label:"Language tag (BCP-47)",            type:"text",   default:"",  placeholder:"en-US / ru-RU / de-DE"},
      {key:"rate",   label:"Rate (0.1 - 10)",                  type:"number", default:1},
      {key:"pitch",  label:"Pitch (0 - 2)",                    type:"number", default:1},
      {key:"volume", label:"Volume (0 - 1)",                   type:"number", default:1},
      {key:"target", label:"Speak on",                         type:"select", default:"all", options:["all","gm","players","self"]}
    ],
    isAction:true,
    compilePin:(_n, ins, fromPin)=>{
      if (fromPin === "text") return ins.text ?? `""`;
      return "0";
    },
    toAction:(n,inp)=>{
      const _wired = (v) => v !== undefined && v !== null && v !== "";
      return {
        type:   "speakTTS",
        text:   _wired(inp.text) ? String(inp.text) : String(n.data?.text ?? ""),
        voice:  String(n.data?.voice  ?? ""),
        lang:   String(n.data?.lang   ?? ""),
        rate:   Number(n.data?.rate   ?? 1) || 1,
        pitch:  Number(n.data?.pitch  ?? 1) || 1,
        volume: Number(n.data?.volume ?? 1) || 1,
        target: String(n.data?.target ?? "all")
      };
    }
  },

  func_inputs: {
    title: "Inputs",
    cat:   "Functions",
    color: "#3a7a8a",
    hidden: true,
    noDelete: true,
    noClone: true,
    isFunctionAnchor: true,
    isFunctionInputs: true,
    inputs: [],
    outputs: [],
    fields: [],
    computeDynamicOutputs(node) {
      const sig = node?.__sig;
      if (!sig) return [{id:"_exec",label:"→",type:"exec"}];
      const out = [{id:"_exec",label:"→",type:"exec"}];
      for (const p of (sig.inputs ?? [])) {
        out.push({id:p.id,label:p.label||p.id,type:p.type||"value.any"});
      }
      return out;
    },
    compile(n) { return "0"; },
    compilePin(n,ins,fromPin) {
      const v = n?.__overlay?.[fromPin];
      return v !== undefined && v !== null ? String(v) : "0";
    }
  },

  func_outputs: {
    title: "Outputs",
    cat:   "Functions",
    color: "#3a7a8a",
    hidden: true,
    noDelete: true,
    noClone: true,
    isFunctionAnchor: true,
    isFunctionOutputs: true,
    compilerSpecial: true,
    isAction: true,
    inputs: [],
    outputs: [],
    fields: [],
    computeDynamicInputs(node) {
      const sig = node?.__sig;
      if (!sig) return [{id:"_exec",label:"→",type:"exec"}];
      const out = [{id:"_exec",label:"→",type:"exec"}];
      for (const p of (sig.outputs ?? [])) {
        out.push({id:p.id,label:p.label||p.id,type:p.type||"value.any"});
      }
      return out;
    }
  },

  function_call: {
    title: "Function",
    cat:   "Functions",
    color: "#5a3a8a",
    hidden: true,
    isFunctionCall: true,
    isAction: true,
    inputs: [],
    outputs: [],
    fields: [],
    computeDynamicInputs(node) {
      const sig = node?.__sig;
      const out = [{id:"_exec",label:"→",type:"exec"}];
      if (sig) {
        for (const p of (sig.inputs ?? [])) {
          out.push({id:p.id,label:p.label||p.id,type:p.type||"value.any"});
        }
      }
      return out;
    },
    computeDynamicOutputs(node) {
      const sig = node?.__sig;
      const out = [{id:"_exec",label:"→",type:"exec"}];
      if (sig) {
        for (const p of (sig.outputs ?? [])) {
          out.push({id:p.id,label:p.label||p.id,type:p.type||"value.any"});
        }
      }
      return out;
    },
    compile(n) { return "0"; },
    compilePin(n,ins,fromPin) { return "0"; },
    toAction(n,ins) { return { type:"noop" }; }
  },

  get_self_uuid: {
    title:"Get Object Self UUID", color:"#1a4060", cat:"Get Data",
    isInteractableOnly:true,
    desc:"Returns the UUID of the scene placeable (Tile / Wall / Light / Token / Note / Token for Actor interactions) this Interactable Button is attached to. Only available in Interactable button graphs.",
    inputs:[],
    outputs:[{id:"v", label:"UUID", type:"value.string"}],
    fields:[],
    compile:(n)=>`{__sdSelfUuid}`
  },

  get_interactable_actor_uuid: {
    title:"Get Interactable Actor UUID", color:"#1a4060", cat:"Get Data",
    isInteractableOnly:true,
    desc:"Returns the Actor UUID behind the current interactable, when the interaction is configured on an Actor or attached to a Token with an actor.",
    inputs:[],
    outputs:[{id:"v", label:"Actor UUID", type:"value.string"}],
    fields:[],
    compile:()=>`{__sdInteractableActorUuid}`
  },

  get_interactable_config_uuid: {
    title:"Get Interactable Config UUID", color:"#1a4060", cat:"Get Data",
    isInteractableOnly:true,
    desc:"Returns the UUID of the document that owns this interactable configuration. For character interactions this is the Actor; for tile/token interactions it is the placeable document.",
    inputs:[],
    outputs:[{id:"v", label:"Config UUID", type:"value.string"}],
    fields:[],
    compile:()=>`{__sdInteractableConfigUuid}`
  },

  actor_token_info: {
    title:"Actor / Token Info", color:"#1a4060", cat:"Get Data",
    isInteractableOnly:true,
    desc:"Read the actor name, token name, actor portrait, and token image from the current character interaction in one node.",
    keywords:"get actor name token name portrait image texture avatar",
    inputs:[],
    outputs:[
      {id:"actorName",  label:"Actor Name",  type:"value.string"},
      {id:"tokenName",  label:"Token Name",  type:"value.string"},
      {id:"portrait",   label:"Portrait",    type:"value.string"},
      {id:"tokenImage", label:"Token Image", type:"value.string"}
    ],
    fields:[],
    compile:()=>`{__sdInteractableActorName}`,
    compilePin:(_,__,pin)=>({
      actorName:  "{__sdInteractableActorName}",
      tokenName:  "{__sdInteractableTokenName}",
      portrait:   "{__sdInteractableActorPortrait}",
      tokenImage: "{__sdInteractableTokenImage}"
    }[pin] ?? "")
  },

  get_actor_name: {
    title:"Get Actor Name", color:"#1a4060", cat:"Sources",
    hidden:true, replacement:"actor_token_info",
    isInteractableOnly:true,
    desc:"Returns the name of the Actor behind the current interactable target.",
    inputs:[],
    outputs:[{id:"v", label:"Actor Name", type:"value.string"}],
    fields:[],
    compile:()=>`{__sdInteractableActorName}`
  },

  get_token_name: {
    title:"Get Token Name", color:"#1a4060", cat:"Sources",
    hidden:true, replacement:"actor_token_info",
    isInteractableOnly:true,
    desc:"Returns the name of the Token the current interactable is shown on.",
    inputs:[],
    outputs:[{id:"v", label:"Token Name", type:"value.string"}],
    fields:[],
    compile:()=>`{__sdInteractableTokenName}`
  },

  get_actor_portrait: {
    title:"Get Actor Portrait", color:"#1a4060", cat:"Sources",
    hidden:true, replacement:"actor_token_info",
    isInteractableOnly:true,
    desc:"Returns the Actor portrait image path from the current interactable target.",
    inputs:[],
    outputs:[{id:"v", label:"Portrait", type:"value.string"}],
    fields:[],
    compile:()=>`{__sdInteractableActorPortrait}`
  },

  get_actor_token_image: {
    title:"Get Actor Token Image", color:"#1a4060", cat:"Sources",
    hidden:true, replacement:"actor_token_info",
    isInteractableOnly:true,
    desc:"Returns the token texture image path for the Token the current interactable is shown on.",
    inputs:[],
    outputs:[{id:"v", label:"Token Image", type:"value.string"}],
    fields:[],
    compile:()=>`{__sdInteractableTokenImage}`
  },

  act_set_tile_image: {
    title:"Set Tile Image", color:"#3a6a8a", cat:"Scene", wideNode:true,
    desc:"Set the texture.src on a Tile by UUID. Wire UUID (e.g. Get Object Self UUID) or paste a fixed Tile UUID into the field.",
    inputs:[
      {id:"exec", label:"",          type:"exec"},
      {id:"uuid", label:"Tile UUID", type:"value.string"},
      {id:"src",  label:"Image",     type:"value.string"}
    ],
    outputs:[{id:"exec", label:"", type:"exec"}],
    fields:[
      {key:"uuid", label:"Tile UUID", type:"text", default:"", placeholder:"Scene.X.Tile.Y or drag tile here"},
      {key:"src",  label:"Image",     type:"text", default:"", placeholder:"icons/svg/circle.svg"}
    ],
    isAction:true,
    toAction:(n,inp)=>({
      type:"setTileImage",
      uuid: (inp.uuid != null && inp.uuid !== "") ? String(inp.uuid) : String(n.data?.uuid ?? ""),
      src:  (inp.src  != null && inp.src  !== "") ? String(inp.src)  : String(n.data?.src  ?? "")
    })
  },

  act_set_tile_size: {
    title:"Set Tile Size", color:"#3a6a8a", cat:"Scene", wideNode:true,
    desc:"Set width and height (in pixels) on a Tile by UUID.",
    inputs:[
      {id:"exec",   label:"",          type:"exec"},
      {id:"uuid",   label:"Tile UUID", type:"value.string"},
      {id:"width",  label:"Width",     type:"value.number"},
      {id:"height", label:"Height",    type:"value.number"}
    ],
    outputs:[{id:"exec", label:"", type:"exec"}],
    fields:[
      {key:"uuid",   label:"Tile UUID",   type:"text",   default:""},
      {key:"width",  label:"Width (px)",  type:"number", default:100},
      {key:"height", label:"Height (px)", type:"number", default:100}
    ],
    isAction:true,
    toAction:(n,inp)=>({
      type:"setTileSize",
      uuid:   (inp.uuid   != null && inp.uuid   !== "") ? String(inp.uuid)   : String(n.data?.uuid   ?? ""),
      width:  (inp.width  != null && inp.width  !== "") ? String(inp.width)  : String(n.data?.width  ?? 100),
      height: (inp.height != null && inp.height !== "") ? String(inp.height) : String(n.data?.height ?? 100)
    })
  },

  act_set_tile_position: {
    title:"Set Tile Position", color:"#3a6a8a", cat:"Scene", wideNode:true,
    desc:"Set x/y world coordinates on a Tile by UUID.",
    inputs:[
      {id:"exec", label:"",          type:"exec"},
      {id:"uuid", label:"Tile UUID", type:"value.string"},
      {id:"x",    label:"X",         type:"value.number"},
      {id:"y",    label:"Y",         type:"value.number"}
    ],
    outputs:[{id:"exec", label:"", type:"exec"}],
    fields:[
      {key:"uuid", label:"Tile UUID", type:"text",   default:""},
      {key:"x",    label:"X (px)",    type:"number", default:0},
      {key:"y",    label:"Y (px)",    type:"number", default:0}
    ],
    isAction:true,
    toAction:(n,inp)=>({
      type:"setTilePosition",
      uuid: (inp.uuid != null && inp.uuid !== "") ? String(inp.uuid) : String(n.data?.uuid ?? ""),
      x:    (inp.x    != null && inp.x    !== "") ? String(inp.x)    : String(n.data?.x    ?? 0),
      y:    (inp.y    != null && inp.y    !== "") ? String(inp.y)    : String(n.data?.y    ?? 0)
    })
  },

  act_set_tile_rotation: {
    title:"Set Tile Rotation", color:"#3a6a8a", cat:"Scene", wideNode:true,
    desc:"Set rotation (degrees, 0-360) on a Tile by UUID.",
    inputs:[
      {id:"exec",     label:"",          type:"exec"},
      {id:"uuid",     label:"Tile UUID", type:"value.string"},
      {id:"rotation", label:"Rotation",  type:"value.number"}
    ],
    outputs:[{id:"exec", label:"", type:"exec"}],
    fields:[
      {key:"uuid",     label:"Tile UUID",     type:"text",   default:""},
      {key:"rotation", label:"Rotation (deg)", type:"number", default:0}
    ],
    isAction:true,
    toAction:(n,inp)=>({
      type:"setTileRotation",
      uuid:     (inp.uuid     != null && inp.uuid     !== "") ? String(inp.uuid)     : String(n.data?.uuid     ?? ""),
      rotation: (inp.rotation != null && inp.rotation !== "") ? String(inp.rotation) : String(n.data?.rotation ?? 0)
    })
  },

  act_set_tile_tint: {
    title:"Set Tile Tint", color:"#3a6a8a", cat:"Scene", wideNode:true,
    desc:"Set texture.tint on a Tile by UUID. Empty/null clears the tint. Hex format (#rrggbb).",
    inputs:[
      {id:"exec", label:"",          type:"exec"},
      {id:"uuid", label:"Tile UUID", type:"value.string"},
      {id:"tint", label:"Tint",      type:"value.string"}
    ],
    outputs:[{id:"exec", label:"", type:"exec"}],
    fields:[
      {key:"uuid", label:"Tile UUID",      type:"text", default:""},
      {key:"tint", label:"Tint (#rrggbb)", type:"text", default:"", placeholder:"#ffffff or empty"}
    ],
    isAction:true,
    toAction:(n,inp)=>({
      type:"setTileTint",
      uuid: (inp.uuid != null && inp.uuid !== "") ? String(inp.uuid) : String(n.data?.uuid ?? ""),
      tint: (inp.tint != null && inp.tint !== "") ? String(inp.tint) : String(n.data?.tint ?? "")
    })
  },

  act_set_tile_alpha: {
    title:"Set Tile Alpha", color:"#3a6a8a", cat:"Scene", wideNode:true,
    desc:"Set alpha (opacity 0..1) on a Tile by UUID.",
    inputs:[
      {id:"exec",  label:"",          type:"exec"},
      {id:"uuid",  label:"Tile UUID", type:"value.string"},
      {id:"alpha", label:"Alpha",     type:"value.number"}
    ],
    outputs:[{id:"exec", label:"", type:"exec"}],
    fields:[
      {key:"uuid",  label:"Tile UUID", type:"text",   default:""},
      {key:"alpha", label:"Alpha (0-1)", type:"number", default:1}
    ],
    isAction:true,
    toAction:(n,inp)=>({
      type:"setTileAlpha",
      uuid:  (inp.uuid  != null && inp.uuid  !== "") ? String(inp.uuid)  : String(n.data?.uuid  ?? ""),
      alpha: (inp.alpha != null && inp.alpha !== "") ? String(inp.alpha) : String(n.data?.alpha ?? 1)
    })
  },

  act_set_tile_hidden: {
    title:"Set Tile Hidden", color:"#3a6a8a", cat:"Scene", wideNode:true,
    desc:"Show / hide / toggle a Tile by UUID.",
    inputs:[
      {id:"exec", label:"",          type:"exec"},
      {id:"uuid", label:"Tile UUID", type:"value.string"}
    ],
    outputs:[{id:"exec", label:"", type:"exec"}],
    fields:[
      {key:"uuid", label:"Tile UUID", type:"text",   default:""},
      {key:"mode", label:"Mode",      type:"select", default:"toggle", options:["toggle","show","hide"]}
    ],
    isAction:true,
    toAction:(n,inp)=>({
      type:"setTileHidden",
      uuid: (inp.uuid != null && inp.uuid !== "") ? String(inp.uuid) : String(n.data?.uuid ?? ""),
      mode: String(n.data?.mode ?? "toggle")
    })
  },

  act_set_wall_door_state: {
    title:"Set Wall Door State", color:"#3a6a8a", cat:"Scene", wideNode:true,
    desc:"Open / close / lock / toggle a wall door by Wall UUID. Walls that are not doors are ignored.",
    inputs:[
      {id:"exec", label:"",          type:"exec"},
      {id:"uuid", label:"Wall UUID", type:"value.string"}
    ],
    outputs:[{id:"exec", label:"", type:"exec"}],
    fields:[
      {key:"uuid",  label:"Wall UUID", type:"text",   default:""},
      {key:"state", label:"State",     type:"select", default:"toggle", options:["toggle","open","close","lock"]}
    ],
    isAction:true,
    toAction:(n,inp)=>({
      type:"setWallDoorState",
      uuid:  (inp.uuid != null && inp.uuid !== "") ? String(inp.uuid) : String(n.data?.uuid ?? ""),
      state: String(n.data?.state ?? "toggle")
    })
  },

  act_set_wall_door_type: {
    title:"Set Wall Door Type", color:"#3a6a8a", cat:"Scene", wideNode:true,
    desc:"Convert a wall to / from a door, or a secret door, by Wall UUID.",
    inputs:[
      {id:"exec", label:"",          type:"exec"},
      {id:"uuid", label:"Wall UUID", type:"value.string"}
    ],
    outputs:[{id:"exec", label:"", type:"exec"}],
    fields:[
      {key:"uuid", label:"Wall UUID", type:"text",   default:""},
      {key:"type", label:"Type",      type:"select", default:"door", options:["none","door","secret"]}
    ],
    isAction:true,
    toAction:(n,inp)=>({
      type:"setWallDoorType",
      uuid:    (inp.uuid != null && inp.uuid !== "") ? String(inp.uuid) : String(n.data?.uuid ?? ""),
      doorType: String(n.data?.type ?? "door")
    })
  },

  act_set_wall_restriction: {
    title:"Set Wall Restriction", color:"#3a6a8a", cat:"Scene", wideNode:true,
    desc:"Change movement / sight / sound / light restriction on a wall by Wall UUID.",
    inputs:[
      {id:"exec", label:"",          type:"exec"},
      {id:"uuid", label:"Wall UUID", type:"value.string"}
    ],
    outputs:[{id:"exec", label:"", type:"exec"}],
    fields:[
      {key:"uuid",  label:"Wall UUID",   type:"text",   default:""},
      {key:"kind",  label:"Restriction", type:"select", default:"move", options:["move","sight","sound","light"]},
      {key:"value", label:"Value",       type:"select", default:"none", options:["none","normal","limited"]}
    ],
    isAction:true,
    toAction:(n,inp)=>({
      type:"setWallRestriction",
      uuid:  (inp.uuid != null && inp.uuid !== "") ? String(inp.uuid) : String(n.data?.uuid ?? ""),
      kind:  String(n.data?.kind  ?? "move"),
      value: String(n.data?.value ?? "none")
    })
  },

  act_set_light_enabled: {
    title:"Set Light Enabled", color:"#3a6a8a", cat:"Scene", wideNode:true,
    desc:"Show / hide / toggle an AmbientLight by UUID.",
    inputs:[
      {id:"exec", label:"",           type:"exec"},
      {id:"uuid", label:"Light UUID", type:"value.string"}
    ],
    outputs:[{id:"exec", label:"", type:"exec"}],
    fields:[
      {key:"uuid", label:"Light UUID", type:"text",   default:""},
      {key:"mode", label:"Mode",       type:"select", default:"toggle", options:["toggle","enable","disable"]}
    ],
    isAction:true,
    toAction:(n,inp)=>({
      type:"setLightEnabled",
      uuid: (inp.uuid != null && inp.uuid !== "") ? String(inp.uuid) : String(n.data?.uuid ?? ""),
      mode: String(n.data?.mode ?? "toggle")
    })
  },

  act_set_light_radius: {
    title:"Set Light Radius", color:"#3a6a8a", cat:"Scene", wideNode:true,
    desc:"Set bright / dim radius (in scene grid units, e.g. feet) on an AmbientLight by UUID. Either field can be left empty to keep its current value.",
    inputs:[
      {id:"exec",   label:"",           type:"exec"},
      {id:"uuid",   label:"Light UUID", type:"value.string"},
      {id:"bright", label:"Bright",     type:"value.number"},
      {id:"dim",    label:"Dim",        type:"value.number"}
    ],
    outputs:[{id:"exec", label:"", type:"exec"}],
    fields:[
      {key:"uuid",   label:"Light UUID", type:"text",   default:""},
      {key:"bright", label:"Bright",     type:"number", default:0},
      {key:"dim",    label:"Dim",        type:"number", default:0}
    ],
    isAction:true,
    toAction:(n,inp)=>({
      type:"setLightRadius",
      uuid:   (inp.uuid   != null && inp.uuid   !== "") ? String(inp.uuid)   : String(n.data?.uuid   ?? ""),
      bright: (inp.bright != null && inp.bright !== "") ? String(inp.bright) : String(n.data?.bright ?? ""),
      dim:    (inp.dim    != null && inp.dim    !== "") ? String(inp.dim)    : String(n.data?.dim    ?? "")
    })
  },

  act_set_light_color: {
    title:"Set Light Color", color:"#3a6a8a", cat:"Scene", wideNode:true,
    desc:"Set the color of an AmbientLight by UUID. Hex format (#rrggbb). Empty value clears the color.",
    inputs:[
      {id:"exec",  label:"",           type:"exec"},
      {id:"uuid",  label:"Light UUID", type:"value.string"},
      {id:"color", label:"Color",      type:"value.string"}
    ],
    outputs:[{id:"exec", label:"", type:"exec"}],
    fields:[
      {key:"uuid",  label:"Light UUID",    type:"text", default:""},
      {key:"color", label:"Color (#rrggbb)", type:"text", default:"#ffffff"}
    ],
    isAction:true,
    toAction:(n,inp)=>({
      type:"setLightColor",
      uuid:  (inp.uuid  != null && inp.uuid  !== "") ? String(inp.uuid)  : String(n.data?.uuid  ?? ""),
      color: (inp.color != null && inp.color !== "") ? String(inp.color) : String(n.data?.color ?? "")
    })
  },

  act_set_light_alpha: {
    title:"Set Light Alpha", color:"#3a6a8a", cat:"Scene", wideNode:true,
    desc:"Set alpha (0..1) on an AmbientLight by UUID.",
    inputs:[
      {id:"exec",  label:"",           type:"exec"},
      {id:"uuid",  label:"Light UUID", type:"value.string"},
      {id:"alpha", label:"Alpha",      type:"value.number"}
    ],
    outputs:[{id:"exec", label:"", type:"exec"}],
    fields:[
      {key:"uuid",  label:"Light UUID",  type:"text",   default:""},
      {key:"alpha", label:"Alpha (0-1)", type:"number", default:0.5}
    ],
    isAction:true,
    toAction:(n,inp)=>({
      type:"setLightAlpha",
      uuid:  (inp.uuid  != null && inp.uuid  !== "") ? String(inp.uuid)  : String(n.data?.uuid  ?? ""),
      alpha: (inp.alpha != null && inp.alpha !== "") ? String(inp.alpha) : String(n.data?.alpha ?? 0.5)
    })
  },

  act_set_light_animation: {
    title:"Set Light Animation", color:"#3a6a8a", cat:"Scene", wideNode:true,
    desc:"Change the animation type, speed, intensity, reverse on an AmbientLight by UUID. Leave speed / intensity at 0 to keep current values.",
    inputs:[
      {id:"exec",      label:"",           type:"exec"},
      {id:"uuid",      label:"Light UUID", type:"value.string"},
      {id:"speed",     label:"Speed",      type:"value.number"},
      {id:"intensity", label:"Intensity",  type:"value.number"}
    ],
    outputs:[{id:"exec", label:"", type:"exec"}],
    fields:[
      {key:"uuid",      label:"Light UUID",      type:"text",     default:""},
      {key:"animType",  label:"Animation",       type:"select",   default:"torch",
        options:["none","torch","pulse","chroma","wave","fog","sunburst","dome","emanation","hexa","ghost","energy","roiling","hole","vortex","witchwave","rainbowswirl","radialrainbow","fairy","grid","starlight","smokepatch","revolving"]},
      {key:"speed",     label:"Speed (1-10)",     type:"number",   default:5},
      {key:"intensity", label:"Intensity (1-10)", type:"number",   default:5},
      {key:"reverse",   label:"Reverse",          type:"checkbox", default:false}
    ],
    isAction:true,
    toAction:(n,inp)=>({
      type:"setLightAnimation",
      uuid:      (inp.uuid      != null && inp.uuid      !== "") ? String(inp.uuid)      : String(n.data?.uuid     ?? ""),
      animType:  String(n.data?.animType ?? "torch"),
      speed:     (inp.speed     != null && inp.speed     !== "") ? String(inp.speed)     : String(n.data?.speed    ?? 5),
      intensity: (inp.intensity != null && inp.intensity !== "") ? String(inp.intensity) : String(n.data?.intensity ?? 5),
      reverse:   !!n.data?.reverse
    })
  },

  act_set_doc_field: {
    title:"Set Document Field by UUID", color:"#3a6a8a", cat:"Set Data", wideNode:true,
    desc:"Generic update: set a single field at a dot-path on any document (Tile / Wall / Light / Token / Note / Scene / Item / Actor) by UUID. Value can be wired or typed. Use this when there is no dedicated node for the field you need.",
    inputs:[
      {id:"exec",  label:"",         type:"exec"},
      {id:"uuid",  label:"UUID",     type:"value.string"},
      {id:"path",  label:"Path",     type:"value.path"},
      {id:"value", label:"Value",    type:"value.any"}
    ],
    outputs:[{id:"exec", label:"", type:"exec"}],
    fields:[
      {key:"uuid",  label:"Document UUID", type:"text", default:""},
      {key:"path",  label:"Field Path",     type:"path", default:"hidden"},
      {key:"value", label:"Value",          type:"text", default:""}
    ],
    isAction:true,
    toAction:(n,inp)=>({
      type:"setDocField",
      uuid:  (inp.uuid  != null && inp.uuid  !== "") ? String(inp.uuid)  : String(n.data?.uuid  ?? ""),
      path:  (inp.path  != null && inp.path  !== "") ? String(inp.path)  : String(n.data?.path  ?? ""),
      value: (inp.value != null && inp.value !== "") ? String(inp.value) : String(n.data?.value ?? "")
    })
  },

  act_add_to_combat: {
    title:"Add Actors to Combat", color:"#3a6a8a", cat:"Scene", wideNode:true,
    desc:"Add one or more actors to the active combat encounter (or create a new encounter if there is none). Actors input accepts: a Targets[] / Saved[] / Failed[] / All[] array, a comma-joined list of token / actor IDs / UUIDs, or one of the keywords actor / selected_token / token_target / all_targets / player_actors. Optionally rolls initiative.",
    inputs:[
      {id:"exec",   label:"",       type:"exec"},
      {id:"actors", label:"Actors", type:"value.array"}
    ],
    outputs:[{id:"exec", label:"", type:"exec"}],
    fields:[
      {key:"actors",         label:"Actors",          type:"text",   default:"all_targets", placeholder:"all_targets / selected_token / actor / token id / Actor.xxxx, ..."},
      {key:"createIfMissing", label:"Create encounter if none", type:"checkbox", default:true},
      {key:"activate",       label:"Activate encounter",        type:"checkbox", default:true},
      {key:"rollInit",       label:"Roll initiative",           type:"select", default:"none", options:["none","per-actor","group"]}
    ],
    isAction:true,
    toAction:(n,inp)=>({
      type:"addActorsToCombat",
      actors: (inp.actors != null && inp.actors !== "") ? String(inp.actors) : String(n.data?.actors ?? "all_targets"),
      createIfMissing: n.data?.createIfMissing !== false,
      activate:        n.data?.activate !== false,
      rollInit:        String(n.data?.rollInit ?? "none")
    })
  },

  act_switch_scene: {
    title:"Switch Scene", color:"#3a6a8a", cat:"Scene", wideNode:true,
    desc:"Activate (View+Activate) a scene by UUID / id / name. Activate makes it the live scene for all users; View only navigates the GM/current user to it. Optionally pulls all players to the scene.",
    inputs:[
      {id:"exec",  label:"",      type:"exec"},
      {id:"scene", label:"Scene", type:"value.string"}
    ],
    outputs:[{id:"exec", label:"", type:"exec"}],
    fields:[
      {key:"scene", label:"Scene (UUID / id / name)", type:"text",   default:"", placeholder:"Scene.xxxx or scene name"},
      {key:"mode",  label:"Mode",                     type:"select", default:"activate", options:["activate","view"]},
      {key:"pullPlayers", label:"Pull all players",   type:"checkbox", default:false}
    ],
    isAction:true,
    toAction:(n,inp)=>({
      type:"switchScene",
      scene:       (inp.scene != null && inp.scene !== "") ? String(inp.scene) : String(n.data?.scene ?? ""),
      mode:        String(n.data?.mode ?? "activate"),
      pullPlayers: !!n.data?.pullPlayers
    })
  },

  act_spawn_token: {
    title:"Spawn Token from Actor UUID", color:"#3a6a8a", cat:"Scene", wideNode:true,
    desc:"Create a token of an actor on the current (or specified) scene at the given x/y world coordinates. Uses the actor's prototype token. Name and hidden flag optional. Requires GM permission.",
    inputs:[
      {id:"exec",      label:"",            type:"exec"},
      {id:"actorUuid", label:"Actor UUID",  type:"value.string"},
      {id:"x",         label:"X",           type:"value.number"},
      {id:"y",         label:"Y",           type:"value.number"},
      {id:"sceneUuid", label:"Scene UUID",  type:"value.string"}
    ],
    outputs:[{id:"exec", label:"", type:"exec"}],
    fields:[
      {key:"actorUuid",    label:"Actor UUID",        type:"text",     default:"", placeholder:"Actor.xxxx (or drag actor)"},
      {key:"x",            label:"X (px)",            type:"number",   default:0},
      {key:"y",            label:"Y (px)",            type:"number",   default:0},
      {key:"sceneUuid",    label:"Scene (optional)",   type:"text",     default:"", placeholder:"Scene.xxxx or empty = current"},
      {key:"nameOverride", label:"Name override",     type:"text",     default:"", placeholder:"Leave empty to use actor name"},
      {key:"hidden",       label:"Spawn hidden",       type:"checkbox", default:false},
      {key:"snapToGrid",   label:"Snap to grid",       type:"checkbox", default:true}
    ],
    isAction:true,
    toAction:(n,inp)=>({
      type:"spawnTokenFromActor",
      actorUuid:    (inp.actorUuid != null && inp.actorUuid !== "") ? String(inp.actorUuid) : String(n.data?.actorUuid ?? ""),
      x:            (inp.x         != null && inp.x         !== "") ? String(inp.x)         : String(n.data?.x ?? 0),
      y:            (inp.y         != null && inp.y         !== "") ? String(inp.y)         : String(n.data?.y ?? 0),
      sceneUuid:    (inp.sceneUuid != null && inp.sceneUuid !== "") ? String(inp.sceneUuid) : String(n.data?.sceneUuid    ?? ""),
      nameOverride: String(n.data?.nameOverride ?? ""),
      hidden:       !!n.data?.hidden,
      snapToGrid:   n.data?.snapToGrid !== false
    })
  }
};

(() => {
  const MAX_EL = 8;
  const TYPE_OPTS = [
    { value: "button",   label: "Choice button" },
    { value: "label",    label: "Narration line" },
    { value: "section",  label: "Section" },
    { value: "text",     label: "Text input" },
    { value: "number",   label: "Number input" },
    { value: "checkbox", label: "Checkbox" },
    { value: "select",   label: "Select" }
  ];
  const _count = (d) => Math.max(1, Math.min(MAX_EL, parseInt(d?.count) || 1));
  const _emitOf = (d, i) => {
    const v = d?.[`el${i}_emit`];
    if (v === undefined || v === null || v === "") return true;
    return v === "yes" || v === true;
  };

  const elFields = [];
  for (let i = 0; i < MAX_EL; i++) {
    const _exists  = (d) => _count(d) > i;
    const _typeOf  = (d) => d?.[`el${i}_type`] ?? (i === 0 ? "button" : "text");
    const _hasId   = (d) => _exists(d) && !["label","section"].includes(_typeOf(d));
    const _hasDef  = (d) => _exists(d) && !["label","section","button"].includes(_typeOf(d));
    const _isSel   = (d) => _exists(d) && _typeOf(d) === "select";
    const _isBtn   = (d) => _exists(d) && _typeOf(d) === "button";
    elFields.push(
      {key:`el${i}_type`,    label:`Element ${i+1} - type`,        type:"select", default: i===0 ? "button" : "text",
        options: TYPE_OPTS, visibleIf: _exists},
      {key:`el${i}_id`,      label:`Element ${i+1} - Id (pin)`,    type:"text",   default: i===0 ? "choice1" : `item${i+1}`,
        placeholder:"unique id, e.g. choice1",                    visibleIf: _hasId},
      {key:`el${i}_label`,   label:`Element ${i+1} - Label`,       type:"text",   default: i===0 ? "Choice 1" : `Element ${i+1}`,
        visibleIf: _exists},
      {key:`el${i}_default`, label:`Element ${i+1} - Default`,     type:"text",   default:"",
        placeholder:"start value (text/number/select) or 'yes' for checkbox", visibleIf: _hasDef},
      {key:`el${i}_options`, label:`Element ${i+1} - Options (CSV)`, type:"text", default:"",
        placeholder:"a,b,c - only for select",                    visibleIf: _isSel},
      {key:`el${i}_emit`,    label:`Element ${i+1} - Emit exec on click?`, type:"select", default:"yes",
        options:["yes","no"],                                     visibleIf: _isBtn}
    );
  }

  NODE_DEFS.act_dialog_builder = {
    title:"Dialogue Builder", color:"#a04020", cat:"Dialogue", wideNode:true,
    desc:"Build an RPG-style dialogue window or a compact form prompt. Choice buttons expose exec outputs so a selected line can continue into another Dialogue Builder node. Picked is the chosen id; Choice is the shown choice label; History contains the conversation, and element values are available as {__dlg.<id>}.",
    inputs:[
      {id:"exec",      label:"",           type:"exec"},
      {id:"aiChoices", label:"AI Choices", type:"value.any"}
    ],
    outputs:[
      {id:"submit",  label:"Submit ->", type:"exec"},
      {id:"cancel",  label:"Cancel",    type:"exec"},
      {id:"picked",  label:"Picked",    type:"value.string"},
      {id:"choice",  label:"Choice",    type:"value.string"},
      {id:"history", label:"History",   type:"value.string"}
    ],
    fields:[
      {key:"mode",        label:"Mode",                         type:"select", default:"rpg",
        options:[{value:"rpg",label:"RPG dialogue"},{value:"form",label:"Form prompt"}]},
      {key:"title",       label:"Title",                        type:"text",     default:"Dialogue"},
      {key:"speaker",     label:"Speaker",                      type:"text",     default:""},
      {key:"portrait",    label:"Portrait image",               type:"text",     default:"", placeholder:"icons/svg/mystery-man.svg or image URL"},
      {key:"description", label:"Dialogue text / Description",  type:"textarea", default:"", rows:4},
      {key:"okLabel",     label:"OK label (when no choices)",   type:"text",     default:"Continue"},
      {key:"cancelLabel", label:"Cancel label",                 type:"text",     default:"Cancel"},
      {key:"count",       label:"Number of elements (1-8)",     type:"number",   default:1},
      ...elFields
    ],
    isGenericBranch:true,
    computeDynamicOutputs(node) {
      const data = node?.data ?? {};
      const c = _count(data);
      const dynVals = [];
      const dynExecs = [];
      for (let i = 0; i < c; i++) {
        const t = data[`el${i}_type`] ?? (i === 0 ? "button" : "text");
        const id = String(data[`el${i}_id`] ?? "").trim();
        const lbl = String(data[`el${i}_label`] ?? "").trim() || `E${i+1}`;
        if (id && !["label","section"].includes(t)) {
          const pinType = t === "checkbox" ? "value.bool"
                       : t === "number"   ? "value.number"
                       : "value.string";
          dynVals.push({ id:`el${i}_val`, label:lbl, type: pinType });
        }
        if (t === "button" && _emitOf(data, i)) {
          dynExecs.push({ id:`el${i}_exec`, label:`${lbl} ->`, type:"exec" });
        }
      }
      return [
        {id:"submit", label:"Submit ->", type:"exec"},
        {id:"cancel", label:"Cancel",    type:"exec"},
        ...dynExecs,
        {id:"picked", label:"Picked",    type:"value.string"},
        {id:"choice", label:"Choice",    type:"value.string"},
        {id:"history", label:"History",  type:"value.string"},
        ...dynVals
      ];
    },
    dynamicBranchToken(node, fromPin) {
      if (typeof fromPin !== "string") return null;
      if (fromPin === "picked") return "{__dlgPicked}";
      if (fromPin === "choice") return "{__dlgChoice}";
      if (fromPin === "history") return "{__dlgHistory}";
      const m = fromPin.match(/^el(\d+)_val$/);
      if (!m) return null;
      const i = Number(m[1]);
      const elId = String(node?.data?.[`el${i}_id`] ?? "").trim();
      if (!elId) return "0";
      return `{__dlg.${elId}}`;
    },
    toAction(n, inp = {}) {
      const c = _count(n?.data ?? {});
      const elements = [];
      for (let i = 0; i < c; i++) {
        const t = n.data[`el${i}_type`] ?? (i === 0 ? "button" : "text");
        const id = String(n.data[`el${i}_id`] ?? "").trim();
        const lbl = String(n.data[`el${i}_label`] ?? "").trim();
        const def = n.data[`el${i}_default`] ?? "";
        const opts = String(n.data[`el${i}_options`] ?? "").split(",").map(s => s.trim()).filter(Boolean);
        const emit = _emitOf(n.data ?? {}, i);
        const o = { type: t, label: lbl };
        if (id) o.id = id;
        if (t === "select" && opts.length) o.options = opts;
        if (t === "checkbox") o.default = (def === "yes" || def === "true" || def === true || def === 1 || def === "1");
        else if (t === "number") {
          const num = Number(def);
          o.default = (def === "" || def == null) ? 0 : (Number.isFinite(num) ? num : String(def));
        }
        else if (t !== "label" && t !== "section" && t !== "button") o.default = String(def ?? "");
        if (t === "label" || t === "section") o.text = lbl;
        if (t === "button") {
          o.type = "button";
          o.formula = "0";
          o.execIndex = i;
          o.emit = emit;
          o.icon = "fas fa-comment-dots";
        }
        elements.push(o);
      }
      return {
        type:        "dialogBuilder",
        aiChoices:   inp.aiChoices ?? "",
        mode:        n.data.mode        ?? "rpg",
        title:       n.data.title       ?? "Dialogue",
        speaker:     n.data.speaker     ?? "",
        portrait:    n.data.portrait    ?? "",
        description: n.data.description ?? "",
        okLabel:     n.data.okLabel     ?? "Continue",
        cancelLabel: n.data.cancelLabel ?? "Cancel",
        elements
      };
    }
  };
})();

(() => {

  const OUT_OF_SHEET_FIELD = {
    key:     "outOfSheet",
    label:   "Standalone (fire when item is not on an actor)",
    type:    "bool",
    default: false
  };
  for (const def of Object.values(NODE_DEFS)) {
    if (!def?.isEvent) continue;
    const fields = Array.isArray(def.fields) ? def.fields : [];
    if (fields.some(f => f?.key === "outOfSheet")) continue;
    def.fields = [...fields, OUT_OF_SHEET_FIELD];
  }
})();

(() => {

  const _FIELD_PIN_TYPES = {
    text:     "value.any",
    textarea: "value.any",
    number:   "value.any",
    path:     "value.any"
  };
  const PIN_RESERVED = new Set(["exec"]);

  for (const def of Object.values(NODE_DEFS)) {
    if (!Array.isArray(def?.fields)) continue;

    if (def.isEvent === true) continue;
    const existingInIds  = new Set((def.inputs  ?? []).map(p => p.id));
    const existingOutIds = new Set((def.outputs ?? []).map(p => p.id));
    const newPins = [];
    for (const f of def.fields) {
      if (!f?.key) continue;
      if (f.noPin === true) continue;
      const t = _FIELD_PIN_TYPES[f.type];
      if (!t) continue;
      if (PIN_RESERVED.has(f.key)) continue;
      if (existingInIds.has(f.key) || existingOutIds.has(f.key)) continue;
      newPins.push({
        id:    f.key,
        label: f.label,
        type:  t,
        __autoFromField: true
      });
    }
    if (newPins.length) def.inputs = [...(def.inputs ?? []), ...newPins];
  }

  const _unwrapWired = (v) => {
    if (typeof v !== "string") return String(v);
    const t = v.trim();
    if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
      try { return JSON.parse(t); } catch { return t.slice(1, -1); }
    }
    return v;
  };

  const _overlayData = (def, n, inp) => {
    if (!Array.isArray(def?.fields)) return n;
    if (!inp) return n;
    const data = { ...(n?.data ?? {}) };
    let touched = false;
    for (const f of def.fields) {
      const k = f?.key; if (!k) continue;
      const v = inp[k];
      if (v === undefined || v === null || v === "") continue;
      data[k] = _unwrapWired(v);
      touched = true;
    }
    return touched ? { ...n, data } : n;
  };

  for (const def of Object.values(NODE_DEFS)) {
    if (typeof def?.toAction === "function") {
      const orig = def.toAction;
      def.toAction = function (n, inp) {
        return orig.call(this, _overlayData(def, n, inp), inp);
      };
    }
    if (typeof def?.compile === "function") {
      const orig = def.compile;
      def.compile = function (n, inp) {
        return orig.call(this, _overlayData(def, n, inp ?? {}), inp ?? {});
      };
    }
    if (typeof def?.compilePin === "function") {
      const orig = def.compilePin;
      def.compilePin = function (n, ins, fromPin) {
        return orig.call(this, _overlayData(def, n, ins ?? {}), ins ?? {}, fromPin);
      };
    }
  }
})();

function _sdCE_T(k, fallback) {
  try {
    const key = "SD.CustomEvents." + k;
    const v = game.i18n?.localize?.(key);
    if (v && v !== key) return v;
  } catch (e) {}
  return fallback;
}

const EVENT_PIN_TOKENS = {
  custom_event: {
    payload:     "{__customEventPayload}",
    sourceActor: "{__customEventSourceUuid}"
  },
  on_vision_detect: {
    actorUuid:  "{__visionDetectorUuid}",
    firstActor: "{__visionFirstActorUuid}",
    actors:     "{__visionDetectedActors}",
    tokens:     "{__visionDetectedTokens}"
  },
  on_update:       { path: "{__eventPath}", oldValue: "{__eventOldValue}", newValue: "{__eventNewValue}" },
  on_turn_start:   { round: "{__eventRound}", combatantId: "{__eventCombatantId}" },
  on_turn_end:     { round: "{__eventRound}", combatantId: "{__eventCombatantId}" },
  on_effect_apply: { effectName: "{__eventEffectName}" },
  on_damage_taken: { amount: "{__eventAmount}", newHp: "{__eventNewHp}" },
  on_rest:         { type: "{__eventRestType}" },
  on_equip:        { itemId: "{__eventItemId}", itemName: "{__eventItemName}" },
  on_unequip:      { itemId: "{__eventItemId}", itemName: "{__eventItemName}" },
  on_card_drawn:   {
    cardId:    "{__cardDrawnId}",
    name:      "{__cardDrawnName}",
    face:      "{__cardDrawnFace}",
    value:     "{__cardDrawnValue}",
    stackId:   "{__cardDrawnStackId}",
    stackName: "{__cardDrawnStackName}"
  },
  on_quest_activated: { questId: "{__questId}", questLogUuid: "{__questLogUuid}", actorId: "{__questActorId}" },
  on_quest_completed: { questId: "{__questId}", questLogUuid: "{__questLogUuid}" },
  on_quest_failed:    { questId: "{__questId}", questLogUuid: "{__questLogUuid}" },
  on_subtask_done:    { questId: "{__questId}", subtaskId: "{__subtaskId}" },
  on_quest_revealed:  { questId: "{__questId}", revealed: "{__questRevealed}" },
  on_macro_use:       {
    macroId:   "{__macroId}",
    macroName: "{__macroName}",
    actorId:   "{__macroActorId}",
    tokenId:   "{__macroTokenId}"
  }
};

const _ROLL_META_BASIC = {
  formula:       "{__lastFormula}",
  min:           "{__lastMin}",
  max:           "{__lastMax}",
  avg:           "{__lastAvg}",
  diceArray:     "{__lastDice}",
  minValue:      "{__lastMinValue}",
  maxValue:      "{__lastMaxValue}",
  minValueTotal: "{__lastMinValueTotal}",
  maxValueTotal: "{__lastMaxValueTotal}"
};
const _ROLL_META = {
  ..._ROLL_META_BASIC,
  natural:       "{__lastNatural}",

  isCrit:        "{__lastIsCrit}",
  isFumble:      "{__lastIsFumble}"
};
const BRANCH_PIN_TOKENS = {
  act_roll_v2: { result:"{__rollResult}", total:"{__rollTotal}", dice:"{__rollDice}", successes:"{__rollSuccesses}", botches:"{__rollBotches}" },
  act_analyze_roll: { result:"{__rollResult}", total:"{__rollTotal}", formula:"{__rollFormula}", dice:"{__rollDice}", natural:"{__rollNatural}", min:"{__rollMin}", max:"{__rollMax}", avg:"{__rollAvg}", successes:"{__rollSuccesses}", botches:"{__rollBotches}", isCrit:"{__rollIsCrit}", isFumble:"{__rollIsFumble}" },
  act_compare_roll: { result:"{__rollResult}", compared:"{__rollCompared}", target:"{__rollTarget}", margin:"{__rollMargin}", passed:"{__rollPassed}" },
  act_present_roll: { result:"{__rollResult}" },
  act_aura_definition: { aura:"{__auraDefinition}" },
  act_place_aura_zone: { targets:"{__allTargets}", aura:"{__auraRegion}" },
  act_tokens_from_aura: { targets:"{__allTargets}", count:"{__targetCount}" },
  act_effect_definition: { effect:"{__effectDefinition}" },
  act_effect_add_change: { effect:"{__effectDefinition}" },
  act_save_dc: { result:"{__lastRoll}", passedTargets:"{__savedTargets}", failedTargets:"{__failedTargets}", allTargets:"{__allTargets}" },
  act_aoe_template_saver: { templates:"{__aoeTemplates}" },
  act_choice_from_array: { selected:"{__choiceSelected}", selectedArray:"{__choiceSelectedArray}", index:"{__choiceIndex}", indices:"{__choiceIndices}" },
  act_place_aoe_template: { targets:"{__allTargets}", template:"{__aoeTemplate}" },
  act_tokens_from_aoe: { targets:"{__allTargets}", count:"{__targetCount}" },
  act_spell: { targets:"{__allTargets}", template:"{__aoeTemplate}", effect:"{__spellEffect}", value:"{__spellValue}" },
  act_roll_value:   { result: "{__lastRoll}", ..._ROLL_META_BASIC },
  act_attack_check: { result: "{__lastRoll}", margin: "{__lastMargin}", ..._ROLL_META },
  act_roll_check:   { result: "{__lastRoll}", margin: "{__lastMargin}", winnerRoll: "{__opposedWinnerRoll}", ..._ROLL_META },
  act_tiered_roll:  { result: "{__lastRoll}", ..._ROLL_META },
  act_dice_pool:    { successes: "{__lastSuccesses}", botches: "{__lastBotches}", result: "{__lastRoll}", ..._ROLL_META },
  act_throw_on_canvas: { successes: "{__lastSuccesses}", total: "{__lastRoll}", ..._ROLL_META },
  act_throw_on_sheet:  { successes: "{__lastSuccesses}", total: "{__lastRoll}", ..._ROLL_META },
  chat_save_button:    { result: "{__lastRoll}", ..._ROLL_META },
  act_progression:     { value: "{__lastRoll}", previous: "{__progPrev}", ..._ROLL_META },
  act_dialog_builder:  { picked: "{__dlgPicked}", choice: "{__dlgChoice}", history: "{__dlgHistory}" },
  act_ai_request:      { response: "{__lastAiResponse}", errorMsg: "{__lastAiError}" },
  act_ai_assistant:    { response: "{__lastAiResponse}", errorMsg: "{__lastAiError}" },
  act_ai_memory_update:{ memoryCount: "{__aiMemoryCount}", errorMsg: "{__lastAiError}" },
  act_loop:            { index: "{__loopIndex}" },
  for_loop_range:      { index: "{__loopIndex}" },
  cast_to_actor:       { actorId: "{__castActorId}" },
  cast_to_item:        { itemId: "{__castItemId}" },
  macro_call:          { retA: "{__macroRetA}", retB: "{__macroRetB}" },
  act_place_aoe_save_branch: {
    saved:  "{__savedTargets}",
    failed: "{__failedTargets}",
    all:    "{__allTargets}"
  },
  act_place_aoe_targets: {
    targets: "{__allTargets}"
  },
  act_place_aura_save_branch: {
    saved:  "{__savedTargets}",
    failed: "{__failedTargets}",
    all:    "{__allTargets}"
  },
  act_place_aura_targets: {
    targets: "{__allTargets}"
  },
  act_for_each_token: {
    token: "{__currentTarget}",
    index: "{__loopIndex}"
  },
  arr_for_each: {
    item:  "{__loopItem}",
    index: "{__loopIndex}"
  },
  arr_compare_two: {
    diff:   "{__cmpDiff}",
    winner: "{__cmpWinner}"
  },
  act_card_draw: {
    card:  "{__lastDrawnCard}",
    cards: "{__lastDrawnCards}"
  }
};

const CATS = [
  {id:"Events",       color:"#c04040"},
  {id:"Flow Control", color:"#8a3a8a"},
  {id:"Dialogue",     color:"#a04020"},
  {id:"Functions",    color:"#7a4abc"},
  {id:"Macros",       color:"#1a8a4a"},
  {id:"Variables",    color:"#2a6a9a"},
  {id:"Database",     color:"#287a70"},
  {id:"Values",       color:"#3a7a9a"},
  {id:"Conversion",   color:"#2f8a72"},
  {id:"Get Data",     color:"#2a6a9a"},
  {id:"Set Data",     color:"#4a2a6a"},
  {id:"Targeting",    color:"#8a3a6a"},
  {id:"Array",        color:"#2a7a3a"},
  {id:"Logic",        color:"#8a2a2a"},
  {id:"Math",         color:"#2a7a3a"},
  {id:"Dice & Rolls", color:"#9a6a1a"},
  {id:"Combat",       color:"#8a1a1a"},
  {id:"Effects",      color:"#1a4a8a"},
  {id:"Items",        color:"#2a5a3a"},
  {id:"Resources",    color:"#5a2a6a"},
  {id:"Chat",         color:"#4a4a1a"},
  {id:"Scene",        color:"#3a6a8a"},
  {id:"Cards",        color:"#5a2a7a"},
  {id:"Quest",        color:"#a04060"},
  {id:"Attribute",    color:"#7a4a1a"},
  {id:"System",       color:"#4a2a7a"}
];


// Public extension registry. Modules may register their own palette categories
// and node definitions without patching System Director source files.
export const NODE_CATEGORIES = CATS;
const _SD_BUILTIN_NODE_CATEGORIES = new Set(CATS.map(category => category.id));
const _SD_EXTENSION_NODE_TYPES = new Map();
const _SD_EXTENSION_CATEGORY_IDS = new Map();

function _sdRegistryOwner(options = {}) {
  return String(options.owner ?? options.moduleId ?? "external").trim() || "external";
}

function _sdNotifyNodeRegistryChanged(detail) {
  try { globalThis.Hooks?.callAll?.("sdNodeRegistryChanged", detail); } catch {}
}

export function registerNodeCategory(category, options = {}) {
  const source = typeof category === "string" ? { id: category } : (category ?? {});
  const id = String(source.id ?? "").trim();
  if (!id) throw new Error("SD node category requires a non-empty id");
  const owner = _sdRegistryOwner({ ...options, owner: options.owner ?? source.owner });
  const normalized = {
    id,
    color: String(source.color ?? "#64748b"),
    label: source.label != null ? String(source.label) : undefined,
    labels: source.labels && typeof source.labels === "object" ? { ...source.labels } : undefined,
    owner
  };
  let entry = CATS.find(item => item.id === id);
  if (entry) Object.assign(entry, normalized);
  else {
    entry = normalized;
    const before = String(options.before ?? source.before ?? "");
    const after = String(options.after ?? source.after ?? "");
    let index = before ? CATS.findIndex(item => item.id === before) : -1;
    if (index < 0 && after) {
      const afterIndex = CATS.findIndex(item => item.id === after);
      if (afterIndex >= 0) index = afterIndex + 1;
    }
    if (index < 0) CATS.push(entry); else CATS.splice(index, 0, entry);
  }
  if (!_SD_BUILTIN_NODE_CATEGORIES.has(id)) {
    const owned = _SD_EXTENSION_CATEGORY_IDS.get(owner) ?? new Set();
    owned.add(id); _SD_EXTENSION_CATEGORY_IDS.set(owner, owned);
  }
  _sdNotifyNodeRegistryChanged({ type: "category", action: "register", id, owner, category: entry });
  return entry;
}

export function registerNodeDefinition(type, definition, options = {}) {
  const id = String(type ?? "").trim();
  if (!id) throw new Error("SD node definition requires a non-empty type");
  if (!definition || typeof definition !== "object") throw new Error(`SD node '${id}' requires a definition object`);
  const owner = _sdRegistryOwner(options);
  const categoryInput = options.category;
  if (categoryInput && typeof categoryInput === "object") registerNodeCategory(categoryInput, { ...options, owner });
  const categoryId = String(definition.cat ?? (typeof categoryInput === "string" ? categoryInput : categoryInput?.id) ?? "System").trim();
  if (!CATS.some(category => category.id === categoryId)) {
    registerNodeCategory({ id: categoryId, label: categoryId, color: definition.color ?? "#64748b" }, { ...options, owner });
  }
  NODE_DEFS[id] = { ...definition, cat: categoryId, extensionOwner: owner };
  const owned = _SD_EXTENSION_NODE_TYPES.get(owner) ?? new Set();
  owned.add(id); _SD_EXTENSION_NODE_TYPES.set(owner, owned);
  _sdNotifyNodeRegistryChanged({ type: "node", action: "register", id, owner, definition: NODE_DEFS[id] });
  return NODE_DEFS[id];
}

export function registerNodeDefinitions(definitions, options = {}) {
  if (!definitions || typeof definitions !== "object") throw new Error("SD node definitions must be an object");
  const registered = {};
  for (const [type, definition] of Object.entries(definitions)) {
    registered[type] = registerNodeDefinition(type, definition, options);
  }
  return registered;
}

export function unregisterNodeExtension(ownerValue) {
  const owner = String(ownerValue ?? "").trim();
  if (!owner) return { nodes: [], categories: [] };
  const removedNodes = [...(_SD_EXTENSION_NODE_TYPES.get(owner) ?? [])];
  for (const type of removedNodes) {
    if (NODE_DEFS[type]?.extensionOwner === owner) delete NODE_DEFS[type];
  }
  _SD_EXTENSION_NODE_TYPES.delete(owner);
  const removedCategories = [];
  for (const id of _SD_EXTENSION_CATEGORY_IDS.get(owner) ?? []) {
    if (_SD_BUILTIN_NODE_CATEGORIES.has(id)) continue;
    if (Object.values(NODE_DEFS).some(definition => definition?.cat === id)) continue;
    const index = CATS.findIndex(category => category.id === id && category.owner === owner);
    if (index >= 0) { CATS.splice(index, 1); removedCategories.push(id); }
  }
  _SD_EXTENSION_CATEGORY_IDS.delete(owner);
  _sdNotifyNodeRegistryChanged({ type: "extension", action: "unregister", owner, nodes: removedNodes, categories: removedCategories });
  return { nodes: removedNodes, categories: removedCategories };
}

export function getNodeRegistrySnapshot() {
  return {
    categories: CATS.map(category => ({ ...category, labels: category.labels ? { ...category.labels } : undefined })),
    nodeTypes: Object.keys(NODE_DEFS),
    extensions: Object.fromEntries([..._SD_EXTENSION_NODE_TYPES].map(([owner, types]) => [owner, [...types]]))
  };
}

function _sdSafeCatalogValue(value, depth = 0, stack = new WeakSet()) {
  if (depth > 10 || value === undefined || typeof value === "function" || typeof value === "symbol") return undefined;
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return String(value);
  if (typeof value !== "object" || stack.has(value)) return undefined;
  stack.add(value);
  let result;
  if (Array.isArray(value)) {
    result = value.map(entry => _sdSafeCatalogValue(entry, depth + 1, stack)).filter(entry => entry !== undefined);
  } else {
    result = {};
    for (const [key, entry] of Object.entries(value)) {
      const safe = _sdSafeCatalogValue(entry, depth + 1, stack);
      if (safe !== undefined) result[key] = safe;
    }
  }
  stack.delete(value);
  return result;
}

function _sdStaticPins(definition, direction) {
  const value = definition?.[direction === "input" ? "inputs" : "outputs"];
  return Array.isArray(value) ? value : [];
}

function _sdHasDynamicPins(definition, direction) {
  const key = direction === "input" ? "dynamicInputs" : "dynamicOutputs";
  return typeof definition?.[direction === "input" ? "inputs" : "outputs"] === "function"
    || !!definition?.[key]
    || !!definition?.dynamicPins
    || typeof definition?.getDynamicPins === "function"
    || typeof definition?.getPins === "function";
}

export function exportNodeCatalog(options = {}) {
  const language = String(options.language ?? globalThis.game?.settings?.get?.("sd", "nodeGraphLanguage") ?? globalThis.game?.i18n?.lang ?? "en");
  const categories = CATS.map(category => ({
    ..._sdSafeCatalogValue(category),
    label: category.labels?.[language] ?? category.labels?.[language.split("-")[0]] ?? category.label ?? category.id
  }));
  const nodes = Object.entries(NODE_DEFS).map(([type, definition]) => {
    let localizedTitle = String(definition?.title ?? type);
    let localizedDescription = String(definition?.desc ?? "");
    try { localizedTitle = _NL(localizedTitle); localizedDescription = _NL(localizedDescription); } catch {}
    return {
      type,
      title: String(definition?.title ?? type),
      localizedTitle,
      description: String(definition?.desc ?? ""),
      localizedDescription,
      category: String(definition?.cat ?? "System"),
      color: String(definition?.color ?? "#64748b"),
      action: !!definition?.isAction,
      inputs: _sdSafeCatalogValue(_sdStaticPins(definition, "input")) ?? [],
      outputs: _sdSafeCatalogValue(_sdStaticPins(definition, "output")) ?? [],
      fields: _sdSafeCatalogValue(Array.isArray(definition?.fields) ? definition.fields : []) ?? [],
      dynamic: {
        inputs: _sdHasDynamicPins(definition, "input"),
        outputs: _sdHasDynamicPins(definition, "output"),
        descriptors: _sdSafeCatalogValue({ dynamicPins: definition?.dynamicPins, dynamicInputs: definition?.dynamicInputs, dynamicOutputs: definition?.dynamicOutputs }) ?? {}
      },
      extensionOwner: definition?.extensionOwner ?? null
    };
  }).sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title));
  return {
    schema: "sd.node-catalog",
    schemaVersion: 1,
    system: "sd",
    systemVersion: String(globalThis.game?.system?.version ?? "0.22.10"),
    language,
    generatedAt: new Date().toISOString(),
    categories,
    nodes,
    extensions: Object.fromEntries([..._SD_EXTENSION_NODE_TYPES].map(([owner, types]) => [owner, [...types]]))
  };
}

function _sdPlanTemplateList(plan) {
  if (Array.isArray(plan)) return plan;
  if (Array.isArray(plan?.templates)) return plan.templates;
  if (plan?.graph && typeof plan.graph === "object") return [{ name: plan.name ?? plan.graph.name, ...plan.graph }];
  return plan && typeof plan === "object" ? [plan] : [];
}

export function validateGraphPlan(plan, options = {}) {
  const errors = [];
  const warnings = [];
  const normalized = [];
  const templates = _sdPlanTemplateList(plan);
  if (!templates.length) errors.push({ path: "templates", code: "empty_plan", message: "Graph plan contains no templates" });
  templates.forEach((source, templateIndex) => {
    const base = `templates[${templateIndex}]`;
    const name = String(source?.name ?? `AI Template ${templateIndex + 1}`).trim() || `AI Template ${templateIndex + 1}`;
    const rawNodes = Array.isArray(source?.nodes) ? source.nodes : [];
    const rawEdges = Array.isArray(source?.edges) ? source.edges : [];
    const ids = new Set();
    const nodeById = new Map();
    const nodes = rawNodes.map((raw, index) => {
      const id = String(raw?.id ?? "").trim();
      const type = String(raw?.type ?? "").trim();
      if (!id) errors.push({ path: `${base}.nodes[${index}].id`, code: "missing_node_id", message: "Node id is required" });
      else if (ids.has(id)) errors.push({ path: `${base}.nodes[${index}].id`, code: "duplicate_node_id", message: `Duplicate node id: ${id}` });
      else ids.add(id);
      const definition = NODE_DEFS[type];
      if (!definition) errors.push({ path: `${base}.nodes[${index}].type`, code: "unknown_node_type", message: `Unknown node type: ${type || "(empty)"}` });
      const x = Number(raw?.x ?? index * 240);
      const y = Number(raw?.y ?? 0);
      if (!Number.isFinite(x) || !Number.isFinite(y)) errors.push({ path: `${base}.nodes[${index}]`, code: "invalid_position", message: "Node position must be finite numbers" });
      const data = _sdSafeCatalogValue(raw?.data && typeof raw.data === "object" ? raw.data : {}) ?? {};
      if (definition && Array.isArray(definition.fields)) {
        const known = new Set(definition.fields.map(field => field?.key).filter(Boolean));
        for (const key of Object.keys(data)) if (!known.has(key)) warnings.push({ path: `${base}.nodes[${index}].data.${key}`, code: "unknown_field", message: `Field '${key}' is not declared by ${type}` });
      }
      const node = { id, type, x: Number.isFinite(x) ? x : 0, y: Number.isFinite(y) ? y : 0, data };
      if (id) nodeById.set(id, node);
      return node;
    });
    const edges = rawEdges.map((raw, index) => {
      const edgePath = `${base}.edges[${index}]`;
      const edge = {
        id: String(raw?.id ?? `e${templateIndex}_${index}`).trim() || `e${templateIndex}_${index}`,
        fromNode: String(raw?.fromNode ?? raw?.from ?? "").trim(),
        fromPin: String(raw?.fromPin ?? raw?.output ?? "").trim(),
        toNode: String(raw?.toNode ?? raw?.to ?? "").trim(),
        toPin: String(raw?.toPin ?? raw?.input ?? "").trim()
      };
      const fromNode = nodeById.get(edge.fromNode);
      const toNode = nodeById.get(edge.toNode);
      if (!fromNode) errors.push({ path: `${edgePath}.fromNode`, code: "missing_source_node", message: `Source node not found: ${edge.fromNode}` });
      if (!toNode) errors.push({ path: `${edgePath}.toNode`, code: "missing_target_node", message: `Target node not found: ${edge.toNode}` });
      const fromDef = fromNode ? NODE_DEFS[fromNode.type] : null;
      const toDef = toNode ? NODE_DEFS[toNode.type] : null;
      const output = _sdStaticPins(fromDef, "output").find(pin => String(pin?.id) === edge.fromPin);
      const input = _sdStaticPins(toDef, "input").find(pin => String(pin?.id) === edge.toPin);
      if (fromDef && !output && !_sdHasDynamicPins(fromDef, "output")) errors.push({ path: `${edgePath}.fromPin`, code: "unknown_output_pin", message: `Output pin not found: ${fromNode.type}.${edge.fromPin}` });
      if (toDef && !input && !_sdHasDynamicPins(toDef, "input")) errors.push({ path: `${edgePath}.toPin`, code: "unknown_input_pin", message: `Input pin not found: ${toNode.type}.${edge.toPin}` });
      if (output && input && !arePinsCompatible(output.type, input.type)) errors.push({ path: edgePath, code: "incompatible_pins", message: `Incompatible pins: ${output.type} -> ${input.type}` });
      return edge;
    });
    const comments = (Array.isArray(source?.comments) ? source.comments : []).map((comment, index) => ({
      ...(_sdSafeCatalogValue(comment) ?? {}), id: String(comment?.id ?? `c${templateIndex}_${index}`),
      x: Number(comment?.x ?? 0) || 0, y: Number(comment?.y ?? 0) || 0
    }));
    if (!nodes.length) warnings.push({ path: `${base}.nodes`, code: "empty_template", message: `Template '${name}' has no nodes` });
    normalized.push({ name, nodes, edges, comments, created: Number(source?.created) || Date.now() });
  });
  return {
    schema: "sd.graph-plan-validation", schemaVersion: 1,
    valid: errors.length === 0, errors, warnings, templates: normalized,
    nodeCount: normalized.reduce((sum, template) => sum + template.nodes.length, 0),
    edgeCount: normalized.reduce((sum, template) => sum + template.edges.length, 0)
  };
}

export async function importNodeTemplates(plan, options = {}) {
  if (!globalThis.game?.user?.isGM) throw new Error("Only a GM can import node templates");
  const validation = validateGraphPlan(plan, options);
  if (!validation.valid || options.dryRun === true) return { ...validation, imported: [], dryRun: true };
  const current = globalThis.game?.settings?.get?.("sd", "nodeTemplates") ?? {};
  const store = globalThis.foundry?.utils?.deepClone ? foundry.utils.deepClone(current) : _sdSafeCatalogValue(current) ?? {};
  const imported = [];
  for (const template of validation.templates) {
    const requested = `${String(options.prefix ?? "")}${template.name}`;
    let name = requested;
    if (!options.overwrite) {
      let suffix = 2;
      while (Object.hasOwn(store, name)) name = `${requested} (${suffix++})`;
    }
    store[name] = { ...template, name, created: Date.now() };
    imported.push(name);
  }
  await globalThis.game.settings.set("sd", "nodeTemplates", store);
  try { globalThis.Hooks?.callAll?.("sdNodeTemplatesImported", { imported, source: options.source ?? "ai" }); } catch {}
  return { ...validation, imported, dryRun: false };
}

export const SD_NODE_REGISTRY = Object.freeze({
  registerCategory: registerNodeCategory,
  registerNode: registerNodeDefinition,
  registerNodes: registerNodeDefinitions,
  unregisterExtension: unregisterNodeExtension,
  snapshot: getNodeRegistrySnapshot,
  exportCatalog: exportNodeCatalog,
  validatePlan: validateGraphPlan,
  importTemplates: importNodeTemplates,
  categories: NODE_CATEGORIES,
  nodes: NODE_DEFS
});

function _nodeCategoryLabel(categoryOrId) {
  const category = typeof categoryOrId === "object"
    ? categoryOrId
    : CATS.find(item => item.id === categoryOrId);
  if (!category) return _NL(String(categoryOrId ?? "Other"));
  const configured = _ngLangSetting();
  const language = configured === "auto"
    ? String(globalThis.game?.i18n?.lang ?? "en")
    : configured;
  const localized = category.labels?.[language]
    ?? category.labels?.[language.split("-")[0]]
    ?? category.label;
  return localized ? _cleanGraphText(localized) : _NL(category.id);
}

export const SD_NODE_KIND_COLOURS = {
  pure:       "#3aa87a",
  imperative: "#e08a2a",
  event:      "#d04040"
};

export function getNodeKind(def) {
  if (!def) return "pure";
  if (def.isEvent) return "event";
  if (def.isTrigger) return "event";
  const hasExec = (arr) => (arr ?? []).some(p => p?.type === "exec");
  if (hasExec(def.inputs) || hasExec(def.outputs) || def.isAction) return "imperative";
  return "pure";
}

export const SD_TARGET_MODES = [
  { id:"actor",            label:"Self (Actor)" },
  { id:"self",             label:"Self (Item)" },
  { id:"token_target",     label:"First targeted token" },
  { id:"selected_token",   label:"First selected token" },
  { id:"all_targets",      label:"All targeted tokens" },
  { id:"selected_tokens",  label:"All selected tokens" },
  { id:"aoe_current",      label:"Current AoE template tokens" }
];

const _mkPin = (id, label) => ({ id, label, type: "value" });

const WIDGET_CONFIG_NODES = {
  wcfg_text:      { title:"Text Field",      color:"#2a4060", isWidgetConfig:true, widgetType:"text",
    inputs:[_mkPin("label","Label"),_mkPin("path","Path"),_mkPin("placeholder","Placeholder")],
    outputs:[], fields:[{key:"label",label:"Label",type:"text",default:"Label"},{key:"path",label:"Data Path",type:"path",default:"system.flags.myField"},{key:"placeholder",label:"Placeholder",type:"text",default:""}]
  },
  wcfg_number:    { title:"Number ±",        color:"#2a4060", isWidgetConfig:true, widgetType:"number",
    inputs:[_mkPin("label","Label"),_mkPin("path","Path"),_mkPin("min","Min"),_mkPin("max","Max"),_mkPin("step","Step")],
    outputs:[], fields:[{key:"label",label:"Label",type:"text",default:"Value"},{key:"path",label:"Data Path",type:"path",default:"system.flags.myNumber"},{key:"min",label:"Min",type:"text",default:""},{key:"max",label:"Max",type:"text",default:""},{key:"step",label:"Step",type:"number",default:1}]
  },
  wcfg_resource:  { title:"Resource Bar",    color:"#5a1a1a", isWidgetConfig:true, widgetType:"resource",
    inputs:[_mkPin("label","Label"),_mkPin("pathValue","Value Path"),_mkPin("pathMax","Max Path"),_mkPin("color","Color")],
    outputs:[], fields:[{key:"label",label:"Label",type:"text",default:"Resource"},{key:"pathValue",label:"Value Path",type:"path",default:"system.resources.hp.value"},{key:"pathMax",label:"Max Path",type:"path",default:"system.resources.hp.max"},{key:"color",label:"Bar Color",type:"text",default:"#e05a5a"}]
  },
  wcfg_dice:      { title:"Dice Button",     color:"#1a3a1a", isWidgetConfig:true, widgetType:"dice",
    inputs:[_mkPin("label","Label"),_mkPin("formula","Formula"),_mkPin("icon","Icon"),_mkPin("flavor","Flavor")],
    outputs:[], fields:[{key:"label",label:"Label",type:"text",default:"Roll"},{key:"formula",label:"Formula",type:"text",default:"1d20"},{key:"icon",label:"FA Icon",type:"text",default:"fa-dice-d20"},{key:"flavor",label:"Flavor",type:"text",default:""}]
  },
  wcfg_toggle:    { title:"Toggle",          color:"#2a1a4a", isWidgetConfig:true, widgetType:"toggle",
    inputs:[_mkPin("label","Label"),_mkPin("path","Path"),_mkPin("onLabel","On Label"),_mkPin("offLabel","Off Label")],
    outputs:[], fields:[{key:"label",label:"Label",type:"text",default:"Toggle"},{key:"path",label:"Data Path",type:"path",default:"system.flags.myToggle"},{key:"onLabel",label:"On Label",type:"text",default:"On"},{key:"offLabel",label:"Off Label",type:"text",default:"Off"}]
  },
  wcfg_slot:      { title:"Item Slot",       color:"#1a3a4a", isWidgetConfig:true, widgetType:"slot",
    inputs:[_mkPin("label","Label"),_mkPin("slotId","Slot ID"),_mkPin("maxCount","Max Items")],
    outputs:[], fields:[{key:"label",label:"Label",type:"text",default:"Slot"},{key:"slotId",label:"Slot ID",type:"text",default:""},{key:"maxCount",label:"Max Items",type:"number",default:1},{key:"allowedTypes",label:"Allowed Types",type:"text",default:""},{key:"allowedCategories",label:"Allowed Categories",type:"text",default:""},{key:"autoEquip",label:"Auto-equip added items",type:"select",default:"no",options:["no","yes"]}]
  },
  wcfg_attribute: { title:"Attribute",       color:"#1a4060", isWidgetConfig:true, widgetType:"attribute",
    inputs:[_mkPin("label","Label"),_mkPin("path","Score Path")],
    outputs:[], fields:[{key:"label",label:"Label",type:"text",default:"Attribute"},{key:"path",label:"Score Path",type:"path",default:"system.attributes.attr1.value"}]
  },
  wcfg_skill:     { title:"Skill",           color:"#1a4060", isWidgetConfig:true, widgetType:"skill",
    inputs:[_mkPin("label","Label"),_mkPin("path","Rank Path"),_mkPin("attrMod","Attr Mod"),_mkPin("rollFormula","Roll Formula")],
    outputs:[], fields:[{key:"label",label:"Label",type:"text",default:"Skill"},{key:"path",label:"Rank Path",type:"path",default:"system.skills.skill1.rank"},{key:"attrMod",label:"Attr Modifier",type:"number",default:0},{key:"rollFormula",label:"Roll Formula",type:"text",default:""}]
  },
  wcfg_progress:  { title:"Progress Bar",    color:"#1a2a5a", isWidgetConfig:true, widgetType:"progress",
    inputs:[_mkPin("label","Label"),_mkPin("pathValue","Value Path"),_mkPin("pathMax","Max Path"),_mkPin("color","Color")],
    outputs:[], fields:[{key:"label",label:"Label",type:"text",default:"Progress"},{key:"pathValue",label:"Value Path",type:"path",default:"system.advancement.xp.value"},{key:"pathMax",label:"Max Path",type:"path",default:"system.advancement.xp.max"},{key:"color",label:"Color",type:"text",default:"#5a8aff"}]
  },
  wcfg_clock:     { title:"Progress Clock",  color:"#4a3a1a", isWidgetConfig:true, widgetType:"clock",
    inputs:[_mkPin("label","Label"),_mkPin("path","Path"),_mkPin("segments","Segments"),_mkPin("color","Color")],
    outputs:[], fields:[{key:"label",label:"Label",type:"text",default:"Clock"},{key:"path",label:"Filled Count Path",type:"path",default:"system.flags.myClock"},{key:"segments",label:"Total Segments",type:"number",default:4},{key:"color",label:"Filled Color",type:"text",default:"#e0a020"}]
  },
  wcfg_tracker:   { title:"Token Tracker",   color:"#4a1a1a", isWidgetConfig:true, widgetType:"tracker",
    inputs:[_mkPin("label","Label"),_mkPin("path","Value Path"),_mkPin("maxCount","Max Count"),_mkPin("icon","Icon (filled)"),_mkPin("emptyIcon","Icon (empty)"),_mkPin("color","Color"),_mkPin("bgColor","Empty Color")],
    outputs:[], fields:[
      {key:"label",label:"Label",type:"text",default:"Stress"},
      {key:"path",label:"Value Path",type:"path",default:"system.flags.myTracker"},
      {key:"maxCount",label:"Max Count",type:"number",default:6},
      {key:"icon",label:"FA Icon (filled)",type:"text",default:"fa-circle"},
      {key:"emptyIcon",label:"FA Icon (empty, blank = same)",type:"text",default:""},
      {key:"color",label:"Filled Color",type:"text",default:"#e04040"},
      {key:"bgColor",label:"Empty Color",type:"text",default:"#2a2a3a"},
      {key:"pipSize",label:"Pip Size (px)",type:"number",default:14}
    ]
  },
  wcfg_tokenPool: { title:"Token Pool",      color:"#4a3a1a", isWidgetConfig:true, widgetType:"tokenPool",
    inputs:[_mkPin("label","Label"),_mkPin("path","Value Path"),_mkPin("maxPath","Max Path"),_mkPin("maxCount","Max Count"),_mkPin("icon","Icon (filled)"),_mkPin("emptyIcon","Icon (empty)"),_mkPin("color","Color"),_mkPin("bgColor","Empty Color")],
    outputs:[], fields:[
      {key:"label",label:"Label",type:"text",default:"Tokens"},
      {key:"path",label:"Value Path",type:"path",default:"system.flags.myTokens"},
      {key:"maxPath",label:"Max Path",type:"path",default:""},
      {key:"maxCount",label:"Max Count",type:"number",default:10},
      {key:"icon",label:"FA Icon (filled)",type:"text",default:"fa-coins"},
      {key:"emptyIcon",label:"FA Icon (empty, blank = same)",type:"text",default:""},
      {key:"color",label:"Filled Color",type:"text",default:"#f0c040"},
      {key:"bgColor",label:"Empty Color",type:"text",default:"#2a2a3a"},
      {key:"pipSize",label:"Pip Size (px)",type:"number",default:16}
    ]
  },
  wcfg_select:    { title:"Select Dropdown", color:"#2a2a4a", isWidgetConfig:true, widgetType:"select",
    inputs:[_mkPin("label","Label"),_mkPin("path","Path"),_mkPin("choices","Choices")],
    outputs:[], fields:[{key:"label",label:"Label",type:"text",default:"Pick"},{key:"path",label:"Data Path",type:"path",default:"system.flags.mySelect"},{key:"choices",label:"Choices (comma-sep)",type:"text",default:"option1,option2,option3"}]
  },
  wcfg_derived:   { title:"Derived Value",   color:"#1a3a2a", isWidgetConfig:true, widgetType:"derived",
    inputs:[_mkPin("label","Label"),_mkPin("formula","Formula"),_mkPin("decimalPlaces","Decimals")],
    outputs:[], fields:[{key:"label",label:"Label",type:"text",default:"Derived"},{key:"formula",label:"Formula",type:"text",default:"0"},{key:"decimalPlaces",label:"Decimal Places",type:"number",default:0}]
  },
  wcfg_tags:      { title:"Tags / Traits",   color:"#2a2a4a", isWidgetConfig:true, widgetType:"tags",
    inputs:[_mkPin("label","Label"),_mkPin("path","Path"),_mkPin("color","Color")],
    outputs:[], fields:[{key:"label",label:"Label",type:"text",default:"Tags"},{key:"path",label:"Data Path",type:"path",default:"system.flags.myTags"},{key:"color",label:"Pill Color",type:"text",default:"#5a6a9a"}]
  },
  wcfg_image:     { title:"Image",           color:"#2a3a3a", isWidgetConfig:true, widgetType:"image",
    inputs:[_mkPin("path","Image Path"),_mkPin("width","Width"),_mkPin("height","Height")],
    outputs:[], fields:[{key:"path",label:"Image Path",type:"path",default:""},{key:"staticSrc",label:"Static URL",type:"text",default:""},{key:"width",label:"Width px",type:"number",default:64},{key:"height",label:"Height px",type:"number",default:64},{key:"borderRadius",label:"Border Radius px",type:"number",default:4}]
  },
  wcfg_richtext:  { title:"Rich Text",       color:"#2a2a4a", isWidgetConfig:true, widgetType:"richtext",
    inputs:[_mkPin("label","Label"),_mkPin("path","Path")],
    outputs:[], fields:[{key:"label",label:"Label",type:"text",default:"Notes"},{key:"path",label:"Data Path",type:"path",default:"system.biography.notes"}]
  },
  wcfg_section:   { title:"Section Header",  color:"#2a2a2a", isWidgetConfig:true, widgetType:"section",
    inputs:[_mkPin("label","Label")],
    outputs:[], fields:[{key:"label",label:"Title",type:"text",default:"Section"}]
  },
  wcfg_counter:   { title:"Counter ±",        color:"#4a3a1a", isWidgetConfig:true, widgetType:"counter",
    inputs:[_mkPin("label","Label"),_mkPin("path","Path"),_mkPin("min","Min"),_mkPin("max","Max"),_mkPin("step","Step"),_mkPin("color","Color")],
    outputs:[], fields:[
      {key:"label",label:"Label",type:"text",default:"Counter"},
      {key:"path", label:"Data Path",type:"path",default:"system.flags.myCounter"},
      {key:"min",  label:"Min",type:"number",default:0},
      {key:"max",  label:"Max",type:"number",default:99},
      {key:"step", label:"Step",type:"number",default:1},
      {key:"color",label:"Accent colour",type:"text",default:"#e0a020"}
    ]
  },
  wcfg_tokenPool: { title:"Token Pool",       color:"#4a3a1a", isWidgetConfig:true, widgetType:"tokenPool",
    inputs:[_mkPin("label","Label"),_mkPin("path","Path"),_mkPin("maxPath","Max Path"),_mkPin("maxCount","Max"),_mkPin("icon","Icon"),_mkPin("color","Filled"),_mkPin("bgColor","Empty"),_mkPin("pipSize","Size")],
    outputs:[], fields:[
      {key:"label",   label:"Label",type:"text",default:"Tokens"},
      {key:"path",    label:"Value Path",type:"path",default:"system.flags.myTokens"},
      {key:"maxPath", label:"Max Path (blank = use Max)",type:"path",default:""},
      {key:"maxCount",label:"Max",type:"number",default:10},
      {key:"icon",    label:"FA Icon",type:"text",default:"fa-coins"},
      {key:"color",   label:"Filled colour",type:"text",default:"#f0c040"},
      {key:"bgColor", label:"Empty colour",type:"text",default:"#2a2a3a"},
      {key:"pipSize", label:"Token size (px)",type:"number",default:16}
    ]
  },
  wcfg_diceTray:  { title:"Dice Tray",        color:"#1a3a3a", isWidgetConfig:true, widgetType:"diceTray",
    inputs:[_mkPin("label","Label"),_mkPin("flagPath","Flag Path"),_mkPin("color","Color")],
    outputs:[], fields:[
      {key:"label",   label:"Label",type:"text",default:"Last Roll"},
      {key:"flagPath",label:"Flag Path (read-only)",type:"path",default:"flags.sd.lastRoll"},
      {key:"color",   label:"Accent colour",type:"text",default:"var(--sd-success)"},
      {key:"compact", label:"Compact (single line)",type:"toggle",default:false}
    ]
  },
};

for (const [, def] of Object.entries(WIDGET_CONFIG_NODES)) {
  const variants = WIDGET_VARIANTS?.[def.widgetType];
  if (!variants?.length) continue;
  if (!Array.isArray(def.inputs)) def.inputs = [];
  if (!Array.isArray(def.fields)) def.fields = [];
  if (!def.inputs.some(p => p.id === "variant")) {
    def.inputs.push(_mkPin("variant", "Variant"));
  }
  if (!def.fields.some(f => f.key === "variant")) {
    def.fields.push({
      key: "variant", label: "Variant", type: "select",
      options: variants, default: "default"
    });
  }
}

Object.assign(NODE_DEFS, WIDGET_CONFIG_NODES);

// Machine-readable recipes for legacy nodes which were split into several
// composable nodes. Saved legacy graphs remain executable; tooling can now
// validate and present the exact replacement chain instead of parsing prose.
export const COMPOSITE_NODE_REPLACEMENTS = Object.freeze({
  act_roll_value:["act_roll_v2","act_analyze_roll","act_present_roll"],
  act_effect:["act_effect_definition","act_effect_apply_v2"],
  act_effect_uuid:["act_effect_definition","act_effect_apply_v2"],
  act_attack_check:["act_roll_v2","act_compare_roll","act_present_roll"],
  act_roll_check:["act_roll_v2","act_compare_roll","act_present_roll"],
  act_tiered_roll:["act_roll_v2","act_compare_roll"],
  act_dice_pool:["act_roll_v2","act_compare_roll"],
  act_progression:["act_roll_v2","get_path","act_compare_roll","act_modify"],
  act_throw_on_canvas:["act_roll_v2","act_present_roll"],
  act_throw_on_sheet:["act_roll_v2","act_present_roll"],
  act_create_effect:["act_effect_definition","act_effect_apply_v2"],
  act_place_aura:["act_aura_definition","act_place_aura_zone"],
  act_place_aura_damage:["act_place_aura_zone","act_damage_simple"],
  act_place_aura_heal:["act_place_aura_zone","act_heal_simple"],
  act_place_aura_save_effect:["act_place_aura_zone","act_save_dc","act_effect_apply_v2"],
  act_place_aura_save_branch:["act_place_aura_zone","act_save_dc"],
  on_event:["on_update","on_create","on_delete","on_turn_start","on_turn_end","on_combat_start","on_combat_end","on_effect_apply","on_damage_taken","on_rest","on_equip","on_unequip"],
  get_self:["get_self_actor","get_self_item"]
});
for (const [legacyId, replacementNodes] of Object.entries(COMPOSITE_NODE_REPLACEMENTS)) {
  if (NODE_DEFS[legacyId]) NODE_DEFS[legacyId].replacementNodes = replacementNodes;
}

export class FormulaGraph {
  constructor(targetInput, doc, widget=null, saveCtx=null, itemSaveCtx=null, opts={}) {
    this.targetInput  = targetInput;
    this.doc          = doc;
    this.widget       = widget;
    this.saveCtx      = saveCtx;
    this.itemSaveCtx  = itemSaveCtx;
    this.configMode   = opts.mode === "config";
    this.sheetTrigger = opts.mode === "sheetTrigger";
    this.actionGraph  = opts.mode === "actionGraph";
    this.numberWidgetMode = opts.mode === "numberWidget";
    this.actionGraphContext = opts.actionGraphContext ?? "";
    this.chainTrigger = opts.mode === "chainTrigger";
    this.questTrigger = opts.mode === "questTrigger";
    this.initiativeMode = opts.mode === "initiative";
    this.customLoad   = typeof opts.customLoad === "function" ? opts.customLoad : null;
    this.customSave   = typeof opts.customSave === "function" ? opts.customSave : null;
    this.win          = null;
    this._windowApp   = null;
    this._functionManagerApp = null;
    this._aiChatApp   = null;
    this.edgeSVG      = null;
    this.nodesEl      = null;
    this.nodes        = [];
    this.edges        = [];
    this._id          = 1;
    this._zoom        = 1;
    this._pan         = {x:60, y:60};
    this._drag        = null;
    this._conn        = null;
    this._panDrag     = null;
    this._marquee     = null;
    this._selected    = new Set();
    this._selectedComments = new Set();
    this.comments     = [];
    this._commentDrag = null;
    this._commentResize = null;
    this._commentDraft= null;
    this._cleanup     = [];
    this._history     = [];
    this._historyIdx  = -1;
    this._suppressHistory = false;
    this._palQuery    = "";
    this._migrationCount = 0;
    this._loadGraph();
    this._sanitizeGraph();
    this._pushHistory();
  }

  /**
   * Coerce node coordinates to finite numbers and reset a broken pan/zoom.
   * Saved graph data (e.g. from world settings) may contain missing or
   * string x/y values; without this, _fitView produces NaN pan/zoom and the
   * whole editor freezes (no panning, nodes cannot be dragged).
   */
  _sanitizeGraph() {
    if (!Array.isArray(this.nodes)) this.nodes = [];
    let i = 0;
    for (const n of this.nodes) {
      if (!n || typeof n !== "object") continue;
      const x = Number(n.x), y = Number(n.y);
      n.x = Number.isFinite(x) ? x : 80 + (i % 4) * 260;
      n.y = Number.isFinite(y) ? y : 80 + Math.floor(i / 4) * 180;
      i++;
    }
    if (!Number.isFinite(Number(this._zoom)) || Number(this._zoom) <= 0) this._zoom = 1;
    else this._zoom = Number(this._zoom);
    if (!this._pan || !Number.isFinite(Number(this._pan.x)) || !Number.isFinite(Number(this._pan.y))) {
      this._pan = { x: 60, y: 60 };
    } else {
      this._pan.x = Number(this._pan.x);
      this._pan.y = Number(this._pan.y);
    }
  }

  _snapshot() {
    return {
      nodes:    foundry.utils.deepClone(this.nodes ?? []),
      edges:    foundry.utils.deepClone(this.edges ?? []),
      comments: foundry.utils.deepClone(this.comments ?? [])
    };
  }

  _pushHistory() {
    if (this._suppressHistory) return;
    if (this._historyIdx < this._history.length - 1) {
      this._history.length = this._historyIdx + 1;
    }
    this._history.push(this._snapshot());
    if (this._history.length > 80) {
      this._history.shift();
    } else {
      this._historyIdx++;
    }
  }

  _restoreSnapshot(s) {
    this._suppressHistory = true;
    try {
      this.nodes    = foundry.utils.deepClone(s.nodes ?? []);
      this.edges    = foundry.utils.deepClone(s.edges ?? []);
      this.comments = foundry.utils.deepClone(s.comments ?? []);
      this._selected.clear();
      this._selectedComments?.clear?.();
      this._renderAll();
      this._updatePreview?.();
    } finally {
      this._suppressHistory = false;
    }
  }

  _undo() {
    if (this._historyIdx <= 0) return;
    this._historyIdx--;
    this._restoreSnapshot(this._history[this._historyIdx]);
  }

  _redo() {
    if (this._historyIdx >= this._history.length - 1) return;
    this._historyIdx++;
    this._restoreSnapshot(this._history[this._historyIdx]);
  }

  _duplicateSelection(offset = 28) {
    if (!this._selected?.size) return;
    const ids = [...this._selected];
    const idMap = new Map();
    const created = [];
    for (const oldId of ids) {
      const src = this.nodes.find(n => n.id === oldId);
      if (!src) continue;
      const def = NODE_DEFS[src.type];
      if (!def) continue;
      if (def.noClone) continue;
      const newId = `n${this._id++}`;
      idMap.set(oldId, newId);
      const clone = foundry.utils.deepClone(src);
      clone.id = newId;
      clone.x  = (src.x ?? 0) + offset;
      clone.y  = (src.y ?? 0) + offset;
      this.nodes.push(clone);
      created.push(clone);
    }
    const newEdges = [];
    for (const e of this.edges) {
      if (idMap.has(e.fromNode) && idMap.has(e.toNode)) {
        newEdges.push({
          id:       `e${uid()}`,
          fromNode: idMap.get(e.fromNode),
          fromPin:  e.fromPin,
          toNode:   idMap.get(e.toNode),
          toPin:    e.toPin
        });
      }
    }
    this.edges.push(...newEdges);
    this._selected = new Set(created.map(n => n.id));
    for (const n of created) this._renderNode(n);
    this._refreshSelectionHighlights?.();
    this._layoutAIAssistantNodes(addedNodeIds);
    this._scheduleEdges?.();
    this._updatePreview?.();
    this._pushHistory();
  }

  _copySelection() {
    if (!this._selected?.size) return;
    const ids = new Set(this._selected);
    const nodes = this.nodes.filter(n => ids.has(n.id)).map(n => foundry.utils.deepClone(n));
    const edges = this.edges
      .filter(e => ids.has(e.fromNode) && ids.has(e.toNode))
      .map(e => foundry.utils.deepClone(e));
    this._clipboard = { nodes, edges };
  }

  _pasteClipboard(offset = 32) {
    if (!this._clipboard?.nodes?.length) return;
    const idMap = new Map();
    const created = [];
    for (const src of this._clipboard.nodes) {
      const def = NODE_DEFS[src.type];
      if (!def) continue;
      const newId = `n${this._id++}`;
      idMap.set(src.id, newId);
      const clone = foundry.utils.deepClone(src);
      clone.id = newId;
      clone.x  = (src.x ?? 0) + offset;
      clone.y  = (src.y ?? 0) + offset;
      this.nodes.push(clone);
      created.push(clone);
    }
    for (const e of this._clipboard.edges) {
      if (!idMap.has(e.fromNode) || !idMap.has(e.toNode)) continue;
      this.edges.push({
        id:       `e${uid()}`,
        fromNode: idMap.get(e.fromNode),
        fromPin:  e.fromPin,
        toNode:   idMap.get(e.toNode),
        toPin:    e.toPin
      });
    }
    this._selected = new Set(created.map(n => n.id));
    for (const n of created) this._renderNode(n);
    this._refreshSelectionHighlights?.();
    this._scheduleEdges?.();
    this._updatePreview?.();
    this._pushHistory();
  }

  _isNodeSelected(id) { return this._selected?.has(id); }

  _selectNode(id, additive = false) {
    if (!additive) this._selected.clear();
    this._selected.add(id);
    this._refreshSelectionHighlights();
  }

  _toggleSelectNode(id) {
    if (this._selected.has(id)) this._selected.delete(id);
    else this._selected.add(id);
    this._refreshSelectionHighlights();
  }

  _clearSelection() {
    const changed = this._selected.size || this._selectedComments.size;
    this._selected.clear();
    this._selectedComments.clear();
    if (changed) this._refreshSelectionHighlights();
  }

  _refreshSelectionHighlights() {
    if (this.nodesEl) {
      this.nodesEl.querySelectorAll("[data-nid]").forEach(el => {
        if (this._selected.has(el.dataset.nid)) {
          el.style.outline      = "2px solid #ffca6b";
          el.style.outlineOffset = "0";
          el.dataset.selected = "1";
        } else {
          if (el.dataset.selected === "1") {
            el.style.outline = "";
            el.style.outlineOffset = "";
            delete el.dataset.selected;
          }
        }
      });
    }
    if (this.commentsEl) {
      this.commentsEl.querySelectorAll("[data-cid]").forEach(el => {
        if (this._selectedComments.has(el.dataset.cid)) {
          el.style.outline       = "2px solid #ffca6b";
          el.style.outlineOffset = "2px";
        } else {
          el.style.outline       = "none";
          el.style.outlineOffset = "2px";
        }
      });
    }
  }

  _deleteSelection() {
    if (!this._selected?.size && !this._selectedComments?.size) return;
    this._suppressHistory = true;
    try {
      for (const id of Array.from(this._selected)) this._delNode(id);
      for (const id of Array.from(this._selectedComments)) this._deleteComment(id);
    } finally {
      this._suppressHistory = false;
    }
    this._selected.clear();
    this._selectedComments.clear();
    this._refreshSelectionHighlights();
    this._scheduleEdges?.();
    this._pushHistory();
  }

  _doCommentDraft(ev) {
    if (!this._commentDraft) return;
    const wrap = this.win?.querySelector("#gwrap");
    if (!wrap) return;
    const r = wrap.getBoundingClientRect();
    this._commentDraft.cx = ev.clientX - r.left;
    this._commentDraft.cy = ev.clientY - r.top;
    const x = Math.min(this._commentDraft.sx, this._commentDraft.cx);
    const y = Math.min(this._commentDraft.sy, this._commentDraft.cy);
    const w = Math.abs(this._commentDraft.cx - this._commentDraft.sx);
    const h = Math.abs(this._commentDraft.cy - this._commentDraft.sy);
    this._commentDraft.el.style.left   = x + "px";
    this._commentDraft.el.style.top    = y + "px";
    this._commentDraft.el.style.width  = w + "px";
    this._commentDraft.el.style.height = h + "px";
  }

  _endCommentDraft() {
    if (!this._commentDraft) return;
    const d = this._commentDraft;
    this._commentDraft = null;
    d.el?.remove();

    const x1s = Math.min(d.sx, d.cx);
    const y1s = Math.min(d.sy, d.cy);
    const x2s = Math.max(d.sx, d.cx);
    const y2s = Math.max(d.sy, d.cy);
    const gx1 = (x1s - this._pan.x) / this._zoom;
    const gy1 = (y1s - this._pan.y) / this._zoom;
    const gx2 = (x2s - this._pan.x) / this._zoom;
    const gy2 = (y2s - this._pan.y) / this._zoom;
    const w   = gx2 - gx1;
    const h   = gy2 - gy1;

    if (w < 24 || h < 24) return;

    this._addComment({
      x: Math.round(gx1),
      y: Math.round(gy1),
      w: Math.round(w),
      h: Math.round(h),
      title: "Comment",
      color: "#ffd94a"
    });
  }

  _serialiseComment(c) {
    return {
      id:    c.id,
      x:     Number(c.x) || 0,
      y:     Number(c.y) || 0,
      w:     Math.max(120, Number(c.w) || 120),
      h:     Math.max(80, Number(c.h) || 80),
      title: String(c.title ?? "Comment"),
      color: String(c.color ?? "#ffd94a"),
      mode:  c.mode === "note" ? "note" : "frame",
      text:  String(c.text ?? "")
    };
  }

  _serialiseSubgraph(nodeIds, commentIds = []) {
    const ids = new Set(nodeIds);
    const nodes = this.nodes
      .filter(n => ids.has(n.id))
      .map(n => ({ id: n.id, type: n.type, x: n.x, y: n.y, data: foundry.utils.deepClone(n.data ?? {}) }));
    if (!nodes.length) return null;

    // Explicitly selected comments are always included. Comment frames which
    // contain any selected node are included as well, so selecting a documented
    // group of nodes is enough to preserve its frame/note in a template.
    const selectedCommentIds = new Set(commentIds ?? []);
    const comments = this.comments
      .filter(c => selectedCommentIds.has(c.id) || nodes.some(n =>
        n.x >= c.x && n.x <= c.x + c.w && n.y >= c.y && n.y <= c.y + c.h
      ))
      .map(c => this._serialiseComment(c));

    const minX = Math.min(...nodes.map(n => n.x), ...comments.map(c => c.x));
    const minY = Math.min(...nodes.map(n => n.y), ...comments.map(c => c.y));
    for (const n of nodes)    { n.x -= minX; n.y -= minY; }
    for (const c of comments) { c.x -= minX; c.y -= minY; }
    const edges = this.edges
      .filter(e => ids.has(e.fromNode) && ids.has(e.toNode))
      .map(e => ({ id: e.id, fromNode: e.fromNode, fromPin: e.fromPin, toNode: e.toNode, toPin: e.toPin }));
    return { nodes, edges, comments };
  }

  _insertTemplate(tpl, gx = 80, gy = 80) {
    if (!tpl?.nodes?.length) return 0;
    const idMap = {};
    const newNodes = tpl.nodes.map(n => {
      const nid = `n${this._id++}`;
      idMap[n.id] = nid;
      return {
        id: nid,
        type: n.type,
        x: Math.round(gx + (n.x ?? 0)),
        y: Math.round(gy + (n.y ?? 0)),
        data: foundry.utils.deepClone(n.data ?? {})
      };
    });
    const valid = newNodes.filter(n => NODE_DEFS[n.type]);
    this.nodes.push(...valid);
    const newEdges = (tpl.edges ?? [])
      .filter(e => idMap[e.fromNode] && idMap[e.toNode])
      .map(e => ({
        id: `e${uid()}`,
        fromNode: idMap[e.fromNode], fromPin: e.fromPin,
        toNode:   idMap[e.toNode],   toPin:   e.toPin
      }));
    this.edges.push(...newEdges);
    const newComments = (tpl.comments ?? []).map(c => ({
      ...this._serialiseComment(c),
      id: `c${this._id++}`,
      x:  Math.round(gx + (Number(c.x) || 0)),
      y:  Math.round(gy + (Number(c.y) || 0))
    }));
    this.comments.push(...newComments);
    this._selected.clear();
    this._selectedComments.clear();
    for (const n of valid) {
      this._renderNode(n);
      this._selected.add(n.id);
    }
    for (const c of newComments) {
      this._renderComment(c);
      this._selectedComments.add(c.id);
    }
    this._refreshSelectionHighlights();
    this._scheduleEdges?.();
    this._updatePreview?.();
    return valid.length;
  }

  _readNodeTemplates() {
    try { return foundry.utils.deepClone(game.settings.get("sd", "nodeTemplates") ?? {}); }
    catch { return {}; }
  }

  async _writeNodeTemplates(store) {
    try { await game.settings.set("sd", "nodeTemplates", store); }
    catch (err) { console.error("SD | Failed to save node templates", err); }
  }

  async _saveSelectionAsTemplate() {
    const hasSelection = this._selected.size || this._selectedComments.size;
    const ids = this._selected.size
      ? Array.from(this._selected)
      : this.nodes.map(n => n.id);
    const commentIds = hasSelection
      ? Array.from(this._selectedComments)
      : this.comments.map(c => c.id);
    const tpl = this._serialiseSubgraph(ids, commentIds);
    if (!tpl || !tpl.nodes.length) {
      ui.notifications?.warn?.("Nothing to save. Shift-click nodes to select them first.");
      return;
    }
    const name = await this._promptText("Template name:", `Template ${Object.keys(this._readNodeTemplates()).length + 1}`);
    if (!name) return;
    const store = this._readNodeTemplates();
    store[name] = {
      name,
      nodes:   tpl.nodes,
      edges:   tpl.edges,
      comments: tpl.comments,
      created: Date.now()
    };
    await this._writeNodeTemplates(store);
    const notes = tpl.comments?.length ?? 0;
    ui.notifications?.info?.(`Template "${name}" saved (${tpl.nodes.length} node${tpl.nodes.length===1?"":"s"}, ${notes} note${notes===1?"":"s"}).`);
  }

  _openTemplatesMenu(anchorEl) {
    const doc = anchorEl?.ownerDocument ?? this._uiDocument();
    doc.querySelector(".sdgtpl-menu")?.remove();
    const store = this._readNodeTemplates();
    const entries = Object.values(store).sort((a,b)=>(a.name??"").localeCompare(b.name??""));

    const r = anchorEl.getBoundingClientRect();
    const menu = doc.createElement("div");
    menu.className = "sdgtpl-menu";
    menu.style.cssText = `position:fixed;left:${Math.round(r.left)}px;top:${Math.round(r.bottom+6)}px;min-width:260px;max-width:380px;max-height:60vh;overflow:auto;background:var(--sd-popover-bg,var(--sd-bg-2));border:1px solid var(--sd-popover-border,var(--sd-border));border-radius:8px;box-shadow:var(--sd-popover-shadow,0 12px 40px rgba(0,0,0,.8));z-index:25000;font-family:'Signika',sans-serif;color:var(--sd-text);padding:6px 0`;

    const header = doc.createElement("div");
    header.style.cssText = "padding:4px 12px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--sd-accent);border-bottom:1px solid var(--sd-border);margin-bottom:4px";
    header.textContent = `Node Templates (${entries.length})`;
    menu.appendChild(header);

    if (!entries.length) {
      const empty = doc.createElement("div");
      empty.style.cssText = "padding:12px;font-size:11px;color:var(--sd-text-3);font-style:italic";
      empty.textContent = "No templates yet. Select nodes with Shift and click Save as Tpl.";
      menu.appendChild(empty);
    }

    for (const tpl of entries) {
      const row = doc.createElement("div");
      row.style.cssText = "display:flex;align-items:center;gap:8px;padding:6px 12px;cursor:pointer;transition:background .15s";
      row.addEventListener("mouseenter", () => row.style.background = "var(--sd-accent-glow)");
      row.addEventListener("mouseleave", () => row.style.background = "");

      const main = doc.createElement("div");
      main.style.cssText = "flex:1;min-width:0";
      main.innerHTML = `
        <div style="font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(tpl.name)}</div>
        <div style="font-size:9px;color:var(--sd-text-3)">${(tpl.nodes??[]).length} nodes - ${(tpl.edges??[]).length} edges - ${(tpl.comments??[]).length} notes</div>`;
      main.addEventListener("click", () => {
        const wrap = this.win?.querySelector("#gwrap");
        let gx = 120, gy = 120;
        if (wrap) {
          const w = wrap.clientWidth, h = wrap.clientHeight;
          gx = (w / 2 - this._pan.x) / this._zoom;
          gy = (h / 2 - this._pan.y) / this._zoom;
        }
        const n = this._insertTemplate(tpl, gx, gy);
        menu.remove();
        if (n) ui.notifications?.info?.(`Inserted template "${tpl.name}" (${n} node${n===1?"":"s"}).`);
      });

      const exp = doc.createElement("button");
      exp.type = "button";
      exp.title = "Export this template as JSON";
      exp.style.cssText = "background:transparent;border:1px solid var(--sd-border);border-radius:4px;color:var(--sd-text-2);cursor:pointer;font-size:10px;padding:2px 7px";
      exp.innerHTML = '<i class="fas fa-file-export"></i>';
      exp.addEventListener("click", ev => {
        ev.stopPropagation();
        this._downloadTemplateJSON(tpl, `${tpl.name}.node-template.json`);
      });

      const del = doc.createElement("button");
      del.type = "button";
      del.title = "Delete template";
      del.style.cssText = "background:transparent;border:none;color:#a06666;cursor:pointer;font-size:14px;padding:0 4px";
      del.textContent = "x";
      del.addEventListener("click", async ev => {
        ev.stopPropagation();
        const store2 = this._readNodeTemplates();
        delete store2[tpl.name];
        await this._writeNodeTemplates(store2);
        menu.remove();
        this._openTemplatesMenu(anchorEl);
      });

      row.appendChild(main);
      row.appendChild(exp);
      row.appendChild(del);
      menu.appendChild(row);
    }

    doc.body.appendChild(menu);

    const off = (ev) => {
      if (!menu.contains(ev.target) && ev.target !== anchorEl) {
        menu.remove();
        doc.removeEventListener("mousedown", off, true);
      }
    };
    setTimeout(() => doc.addEventListener("mousedown", off, true), 0);
  }

  _runLint() {
    const report = lintGraph({ nodes: this.nodes, edges: this.edges }, NODE_DEFS);
    const header = lintSummary(report);
    const rows = report.length
      ? report.map(r => {
          const colour = r.severity === "error" ? "#ff7b7b"
                       : r.severity === "warn"  ? "#ffb74a"
                       : "#74c0ff";
          const jumpAttr = r.nodeId ? `data-jump="${esc(r.nodeId)}"` : "";
          return `<div class="sd-lint-row" ${jumpAttr} style="padding:6px 10px;border-bottom:1px solid var(--sd-border);${r.nodeId?"cursor:pointer;":""};">
            <span style="color:${colour};font-weight:700;text-transform:uppercase;font-size:10px;margin-right:6px">[${r.severity}] ${r.code}</span>
            <span style="color:var(--sd-text)">${esc(r.message)}</span>
            ${r.nodeId ? `<span style="color:#6a7a9a;font-family:monospace;font-size:10px;margin-left:6px">${esc(r.nodeId)}</span>` : ""}
          </div>`;
        }).join("")
      : `<div style="padding:14px;color:var(--sd-success)">No issues detected OK</div>`;

    foundry.applications.api.DialogV2.wait({
      window: { title: `Graph Lint - ${header}` },
      position: { width: 640 },
      modal: true,
      content: `<div style="max-height:60vh;overflow-y:auto;font-size:12px;background:var(--sd-bg);color:var(--sd-text);border-radius:6px">${rows}</div>`,
      buttons: [{
        action: "ok",
        label: "Close",
        default: true,
        callback: () => "ok"
      }],
      render: (ev, dlg) => {
        const root = dlg?.element ?? dlg;
        root.querySelectorAll?.(".sd-lint-row[data-jump]").forEach(row => {
          row.addEventListener("click", () => {
            const id = row.dataset.jump;
            this._selected = new Set([id]);
            this._renderNodes();
            this._redrawEdges();
          });
        });
      }
    });
  }

  _exportSelectionAsFile() {
    const hasSelection = this._selected.size || this._selectedComments.size;
    const ids = this._selected.size
      ? Array.from(this._selected)
      : this.nodes.map(n => n.id);
    const commentIds = hasSelection
      ? Array.from(this._selectedComments)
      : this.comments.map(c => c.id);
    const tpl = this._serialiseSubgraph(ids, commentIds);
    if (!tpl || !tpl.nodes.length) {
      ui.notifications?.warn?.("Nothing to export.");
      return;
    }
    const payload = {
      name:    this._selected.size ? `Selection (${tpl.nodes.length})` : `Full graph (${tpl.nodes.length})`,
      nodes:   tpl.nodes,
      edges:   tpl.edges,
      comments: tpl.comments,
      created: Date.now()
    };
    this._downloadTemplateJSON(payload, `node-template.json`);
  }

  _downloadTemplateJSON(tpl, filename = "node-template.json") {
    const json = JSON.stringify({ sdNodeTemplate: 1, ...tpl }, null, 2);
    try {
      if (typeof saveDataToFile === "function") {
        saveDataToFile(json, "application/json", filename);
        return;
      }
    } catch {}
    const blob = new Blob([json], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  _importTemplateFromFile() {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "application/json,.json";
    inp.addEventListener("change", async () => {
      const file = inp.files?.[0];
      if (!file) return;
      let parsed;
      try {
        parsed = JSON.parse(await file.text());
      } catch (e) {
        ui.notifications?.error?.("Invalid JSON file.");
        return;
      }
      await this._handleImportedTemplate(parsed);
    });
    inp.click();
  }

  async _handleImportedTemplate(parsed) {
    if (parsed?.templates && typeof parsed.templates === "object") {
      const store = this._readNodeTemplates();
      let n = 0;
      for (const [k, v] of Object.entries(parsed.templates)) {
        if (!v?.nodes?.length) continue;
        store[k] = { name: v.name ?? k, nodes: v.nodes, edges: v.edges ?? [], comments: v.comments ?? [], created: v.created ?? Date.now() };
        n++;
      }
      await this._writeNodeTemplates(store);
      ui.notifications?.info?.(`Imported ${n} template${n===1?"":"s"} into the library.`);
      return;
    }

    if (!parsed?.nodes?.length) {
      ui.notifications?.error?.("JSON does not contain any nodes.");
      return;
    }

    const choice = await foundry.applications.api.DialogV2.wait({
      window: { title: "Import node template" },
      modal: true,
      content: `<p style="margin:4px 0 10px">Template <b>${esc(parsed.name ?? "(unnamed)")}</b>: ${parsed.nodes.length} nodes, ${(parsed.edges??[]).length} edges.</p>
                <p style="margin:0 0 6px">Insert into this graph, save to the shared template library, or both?</p>`,
      buttons: [
        { action: "insert", label: "Insert only",         default: true },
        { action: "save",   label: "Save to library" },
        { action: "both",   label: "Save & Insert" },
        { action: "cancel", label: "Cancel" }
      ],
      rejectClose: false
    }).catch(() => "cancel");

    if (!choice || choice === "cancel") return;

    if (choice === "save" || choice === "both") {
      const store = this._readNodeTemplates();
      const name  = parsed.name?.trim() || (await this._promptText("Template name:", "Imported template"));
      if (!name) return;
      store[name] = { name, nodes: parsed.nodes, edges: parsed.edges ?? [], comments: parsed.comments ?? [], created: Date.now() };
      await this._writeNodeTemplates(store);
      ui.notifications?.info?.(`Template "${name}" added to the library.`);
    }
    if (choice === "insert" || choice === "both") {
      const wrap = this.win?.querySelector("#gwrap");
      let gx = 120, gy = 120;
      if (wrap) {
        const w = wrap.clientWidth, h = wrap.clientHeight;
        gx = (w / 2 - this._pan.x) / this._zoom;
        gy = (h / 2 - this._pan.y) / this._zoom;
      }
      const n = this._insertTemplate(parsed, gx, gy);
      if (n) ui.notifications?.info?.(`Inserted ${n} node${n===1?"":"s"} from template.`);
    }
  }

  async _promptText(label, def = "") {
    const result = await foundry.applications.api.DialogV2.wait({
      window: { title: "Graph Editor" },
      modal: true,
      content: `<div style="padding:8px 0">
        <label style="font-size:12px;color:var(--sd-text-2)">${esc(label)}</label>
        <input type="text" name="val" value="${esc(def)}"
          style="width:100%;margin-top:4px;background:#2a2a38;border:1px solid var(--sd-border);color:var(--sd-text);border-radius:4px;padding:4px 8px;font-size:13px;box-sizing:border-box">
      </div>`,
      buttons: [
        {
          action: "ok", label: "OK", icon: "fas fa-check", default: true,
          callback: (ev, btn, dialog) => {
            const root = dialog?.element ?? dialog;
            const v = root?.querySelector?.("input[name='val']")?.value?.trim();
            return { __sdOk: true, __sdValue: v && v.length ? v : null };
          }
        },
        {
          action: "cancel", label: "Cancel",
          callback: () => ({ __sdOk: false, __sdValue: null })
        }
      ],
      rejectClose: false
    }).catch(() => ({ __sdOk: false, __sdValue: null }));

    if (!result || typeof result !== "object" || !result.__sdOk) return null;
    const v = result.__sdValue;
    return (typeof v === "string" && v.length) ? v : null;
  }

  _runMigrations() {
    const result = migrateGraph(this);
    this._migrationCount += Number(result?.changed) || 0;
    return result;
  }

  _aiKnownDataPaths() {
    const paths = new Map();
    const add = (path, label = "", source = "document", valueType = "") => {
      const p = String(path ?? "").trim();
      if (!p || paths.has(p)) return;
      if (!p.startsWith("system.") && !p.startsWith("flags.")) return;
      paths.set(p, { path: p, label: String(label || p), source, valueType });
    };
    const typeOf = v => Array.isArray(v) ? "array" : (v === null ? "null" : typeof v);

    const addConfigured = () => {
      let cfg = null;
      try { cfg = game.settings.get("sd", "systemSettings") ?? null; } catch {}
      cfg ??= CONFIG?.SD ?? null;
      for (const [key, label] of Object.entries(cfg?.attributes ?? {})) {
        if (cfg?.attributesEnabled?.[key] === false) continue;
        const name = String(label || key);
        add(`system.attributes.${key}.value`, `${name} - Score`, "system");
        add(`system.attributes.${key}.mod`, `${name} - Modifier`, "system");
        add(`system.attributes.${key}.proficient`, `${name} - Proficient`, "system");
      }
      for (const [key, res] of Object.entries(cfg?.resources ?? {})) {
        if (!res || res.enabled === false) continue;
        const name = String(res.label || key);
        add(`system.resources.${key}.value`, `${name} - Current`, "system");
        add(`system.resources.${key}.max`, `${name} - Max`, "system");
        add(`system.resources.${key}.min`, `${name} - Min`, "system");
      }
      for (const c of (cfg?.currencies ?? [])) {
        if (c?.key) add(`system.currency.${c.key}`, `Currency - ${c.label || c.key}`, "system");
      }
      for (const [section, entries] of Object.entries(cfg?.calculations ?? {})) {
        for (const entry of (entries ?? [])) {
          if (!entry?.key) continue;
          add(`system.calculations.${section}.${entry.key}.value`, entry.label || entry.key, "system");
        }
      }
    };

    const addWidgetPaths = (doc, source) => {
      const visit = widgets => {
        for (const w of (widgets ?? [])) {
          if (!w || typeof w !== "object") continue;
          const label = w.label || w.widgetKey || w.type || "Widget";
          for (const key of ["path", "pathValue", "pathMax", "scorePath", "rankPath", "flagPath"]) {
            if (typeof w[key] === "string") add(w[key], `${label} (${key})`, source);
          }
          if (Array.isArray(w.widgets)) visit(w.widgets);
        }
      };
      for (const tab of (doc?.system?.customTabs ?? [])) {
        for (const row of (tab.rows ?? [])) visit(row.widgets ?? []);
      }
    };

    const addDoc = (doc, source) => {
      if (!doc?.system) return;
      for (const [key, value] of Object.entries(doc.system.hiddenFields ?? {})) {
        add(`system.hiddenFields.${key}`, `Hidden Field - ${key}`, source, typeOf(value));
      }
      try {
        const flat = foundry.utils.flattenObject(doc.system ?? {});
        for (const [key, value] of Object.entries(flat)) {
          if (value && typeof value === "object") continue;
          add(`system.${key}`, key, source, typeOf(value));
          if (paths.size > 280) break;
        }
      } catch {}
      addWidgetPaths(doc, source);
    };

    addConfigured();
    const ActorCls = globalThis.Actor;
    const doc = this.doc ?? null;
    const actor = ActorCls && doc instanceof ActorCls ? doc : (doc?.parent ?? doc?.actor ?? null);
    addDoc(doc, "current-document");
    if (actor && actor !== doc) addDoc(actor, "actor");
    return [...paths.values()].slice(0, 320);
  }

  _aiGraphSnapshot() {
    return {
      mode: this.actionGraph ? "action" : this.numberWidgetMode ? "number-widget" : this.initiativeMode ? "initiative" : "formula",
      widgetType: this.widget?.type ?? "",
      availableDataPaths: this._aiKnownDataPaths(),
      nodes: (this.nodes ?? []).map(n => {
        const def = NODE_DEFS[n.type];
        const brief = pins => (pins ?? []).map(p => ({ id: p.id, label: p.label ?? "", type: p.type ?? "value.any" }));
        return {
          id: n.id,
          type: n.type,
          title: def?.title ?? n.type,
          x: Math.round(Number(n.x) || 0),
          y: Math.round(Number(n.y) || 0),
          data: n.data ?? {},
          inputs: brief(this._aiPinsForDef(def, n, "input", true)),
          outputs: brief(this._aiPinsForDef(def, n, "output", true))
        };
      }),
      edges: (this.edges ?? []).map(e => ({
        id: e.id,
        fromNode: e.fromNode,
        fromPin: e.fromPin,
        toNode: e.toNode,
        toPin: e.toPin
      }))
    };
  }

  _aiNodeCatalog(query = "", max = 140) {
    const ctx = this._nodeFilterContext();
    const terms = String(query ?? "").toLowerCase().split(/[^\p{L}0-9_]+/u).filter(t => t.length > 1);
    const coreTypes = new Set(this._aiAssistantCoreNodeTypes());
    const pinBrief = pins => (pins ?? []).map(p => ({ id: p.id, label: p.label ?? "", type: p.type ?? "value.any" }));
    const fieldBrief = fields => (fields ?? []).map(f => ({
      key: f.key,
      label: f.label ?? f.key,
      type: f.type ?? "text",
      default: f.default ?? "",
      options: Array.isArray(f.options) ? f.options.slice(0, 20) : undefined
    }));
    const rows = [];
    for (const [type, def] of Object.entries(NODE_DEFS)) {
      if (!this._isNodeAvailableInCurrentGraph(type, def, null, ctx)) continue;
      const aliases = this._aiNodeAliases(type);
      const hay = `${type} ${def.title ?? ""} ${def.cat ?? ""} ${def.desc ?? ""} ${aliases.join(" ")}`.toLowerCase();
      const isCore = coreTypes.has(type);
      let score = terms.length ? 0 : 1;
      for (const t of terms) {
        if (type.toLowerCase().includes(t)) score += 6;
        if (String(def.title ?? "").toLowerCase().includes(t)) score += 5;
        if (String(def.cat ?? "").toLowerCase().includes(t)) score += 2;
        if (String(def.desc ?? "").toLowerCase().includes(t)) score += 1;
        if (aliases.some(a => String(a).toLowerCase().includes(t))) score += 4;
      }
      if (isCore) score += terms.length ? 0.5 : 1;
      if (terms.length && score <= 0 && !isCore) continue;
      rows.push({
        type,
        title: _NL(def.title ?? type),
        category: _nodeCategoryLabel(def.cat ?? ""),
        description: _NL(def.desc ?? "").slice(0, 260),
        aliases,
        inputs: pinBrief(this._aiPinsForDef(def, null, "input", true)),
        outputs: pinBrief(this._aiPinsForDef(def, null, "output", true)),
        fields: fieldBrief(def.fields),
        score
      });
    }
    rows.sort((a, b) => (b.score - a.score) || a.category.localeCompare(b.category) || a.title.localeCompare(b.title));
    return rows.slice(0, max);
  }

  _parseAIAssistantPlan(text) {
    let s = String(text ?? "").trim();
    const fence = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    if (fence) s = fence[1].trim();
    const firstObj = s.indexOf("{");
    const lastObj = s.lastIndexOf("}");
    if (firstObj >= 0 && lastObj > firstObj) s = s.slice(firstObj, lastObj + 1);
    const parsed = JSON.parse(s);
    if (Array.isArray(parsed)) return { message: "", actions: parsed };
    return parsed && typeof parsed === "object" ? parsed : { message: "", actions: [] };
  }

  _aiAssistantCoreNodeTypes() {
    return [
      "on_click", "branch", "if_node", "gate", "sequence",
      "get_path", "literal", "literal_str",
      "lt", "lte", "gt", "gte", "eq", "neq", "and", "or", "not",
      "act_message", "act_message_composer", "act_notify", "act_roll_v2", "act_analyze_roll", "act_compare_roll", "act_present_roll", "act_damage_simple", "act_heal_simple", "act_save_dc", "act_spell", "act_aura_definition", "act_place_aura_zone", "act_effect_definition", "act_effect_add_change", "act_effect_apply_v2", "act_modify",
      "act_ai_request", "act_ai_assistant", "ai_dialogue_choices", "act_dialog_builder",
      "actor_token_info", "arr_get", "arr_aggregate", "arr_random_from",
      "var_read", "var_write", "quest_set_state"
    ];
  }

  _aiNodeAliases(type) {
    const map = {
      on_click: ["trigger", "button click", "on click", "клик", "нажатие"],
      branch: ["if", "else", "condition branch", "ветвление", "условие"],
      if_node: ["if compare", "if_node", "compare exec", "если", "сравнить", "меньше", "больше"],
      gate: ["if pass", "guard", "condition gate", "пропустить если"],
      get_path: ["get field value", "field value", "get_field_value", "path value", "hp", "хп", "здоровье", "поле", "путь"],
      literal: ["number", "constant number", "threshold", "число", "константа"],
      literal_str: ["text", "string", "message text", "текст", "строка"],
      lt: ["less than", "<", "меньше"],
      lte: ["less or equal", "<=", "меньше равно"],
      gt: ["greater than", ">", "больше"],
      gte: ["greater or equal", ">=", "больше равно"],
      eq: ["equals", "==", "равно"],
      neq: ["not equals", "!=", "не равно"],
      act_message: ["chat output", "send chat", "act_send_chat", "message", "чат", "сообщение", "вывести в чат"],
      act_notify: ["notification", "toast", "уведомление"],
      act_roll_value: ["roll value", "roll -> value", "бросок", "ролл"],
      act_damage_simple: ["damage", "урон"],
      act_heal_simple: ["heal", "healing", "лечение"],
      act_save_dc: ["save", "dc", "saving throw", "спасбросок", "проверка сложности"],
      act_spell: ["spell", "aoe spell", "заклинание"],
      act_aoe_template_saver: ["aoe template saver", "template array", "шаблоны aoe"],
      act_choice_from_array: ["choice from array", "array dialog", "выбор из массива"],
      act_roll_v2: ["roll", "dice roll", "бросок", "бросить кубы"],
      act_analyze_roll: ["analyze roll", "break roll result", "разобрать бросок"],
      act_compare_roll: ["compare roll", "roll dc", "сравнить бросок"],
      act_present_roll: ["present roll", "show roll", "показать бросок"],
      get_self_actor: ["self actor", "context actor", "свой актор"],
      get_self_item: ["self item", "context item", "свой предмет"],
      act_aura_definition: ["aura definition", "make aura", "создать ауру"],
      act_place_aura_zone: ["place aura", "aura token pool", "разместить ауру"],
      act_tokens_from_aura: ["tokens from aura", "aura targets", "токены в ауре"],
      act_effect_definition: ["effect definition", "make effect", "создать эффект"],
      act_effect_add_change: ["effect change", "add effect change", "изменение эффекта"],
      act_effect_apply_v2: ["apply effect", "применить эффект"],
      act_effect_remove_v2: ["remove effect", "снять эффект"],
      act_effect_toggle_v2: ["toggle effect", "переключить эффект"],
      act_modify: ["modify field", "change field", "изменить поле"],
      act_dialog_builder: ["dialogue builder", "dialog builder", "диалог"],
      ai_dialogue_choices: ["ai dialogue choices", "ai choices", "варианты ответов"],
      act_ai_request: ["ai request", "request ai", "нейросеть"],
      act_ai_assistant: ["ai assistant", "assistant"],
      actor_token_info: ["get actor name", "get token name", "get actor portrait", "get actor token image", "actor info", "token info"],
      arr_get: ["array get", "token at index", "array at", "element at index"],
      arr_aggregate: ["array sum", "array average", "array min", "array max", "array count", "aggregate array"],
      arr_random_from: ["array random pick", "random from array", "pick random elements"],
      act_message_composer: ["message composer", "message compiler", "message compilator", "interactive chat card", "damage card", "chat buttons", "compile message"],
      var_read: ["get variable", "read variable"],
      var_write: ["set variable", "write variable"],
      quest_set_state: ["activate quest", "complete quest", "fail quest", "lock quest", "make quest available"]
    };
    return map[type] ?? [];
  }

  _aiNormKey(value) {
    return String(value ?? "")
      .trim()
      .toLowerCase()
      .replace(/[\s\-]+/g, "_")
      .replace(/[^a-z0-9_а-яё<>!=]/gi, "");
  }

  _aiPinsForDef(def, node = null, side = "input", catalog = false) {
    if (!def) return [];
    const pins = [];
    const addPins = arr => {
      for (const p of (arr ?? [])) {
        if (!p?.id || pins.some(x => x.id === p.id)) continue;
        pins.push(p);
      }
    };
    addPins(side === "output" ? def.outputs : def.inputs);
    if (catalog && side === "output") addPins(def.catalogOutputs);
    if (side === "output" && node && typeof def.computeDynamicOutputs === "function") {
      addPins(def.computeDynamicOutputs(node) ?? []);
    }
    if (side === "input" && node && typeof def.computeDynamicInputs === "function") {
      addPins(def.computeDynamicInputs(node) ?? []);
    }
    if (side === "input" && def.dynamicPins) {
      const groups = Array.isArray(def.dynamicPins) ? def.dynamicPins : [def.dynamicPins];
      for (const grp of groups) {
        const base = grp?.base;
        const max = Math.max(0, Number(grp?.max ?? 0) || 0);
        if (!base || !max) continue;
        const limit = catalog ? Math.min(max, 4) : max;
        for (let i = 0; i < limit; i++) {
          const id = `${base}${i}`;
          if (pins.some(x => x.id === id)) continue;
          pins.push({ id, label: `${grp.label ?? base} ${i + 1}`, type: grp.type ?? "value.any" });
        }
      }
    }
    return pins;
  }

  _normalizeAIAssistantOp(op) {
    const key = this._aiNormKey(op);
    const map = {
      add: "addNode",
      add_node: "addNode",
      create: "addNode",
      create_node: "addNode",
      node: "addNode",
      set: "setData",
      set_data: "setData",
      update: "setData",
      update_node: "setData",
      edit: "setData",
      connect_nodes: "connect",
      link: "connect",
      wire: "connect",
      delete: "deleteNode",
      delete_node: "deleteNode",
      remove: "deleteNode",
      remove_node: "deleteNode",
      disconnect: "deleteEdge",
      delete_edge: "deleteEdge",
      remove_edge: "deleteEdge",
      clear: "clearGraph",
      clear_graph: "clearGraph"
    };
    return map[key] ?? String(op ?? "").trim();
  }

  _normalizeAIAssistantNodeType(type, data = null) {
    const raw = String(type ?? "").trim();
    if (NODE_DEFS[raw]) {
      const migrated = NODE_TYPE_MIGRATIONS[raw]?.newType;
      if (migrated && NODE_DEFS[migrated]) return migrated;
      return raw;
    }
    const key = this._aiNormKey(raw);
    const op = this._aiNormKey(data?.operator ?? data?.op ?? data?.compare ?? "");
    const cmpByOp = {
      "<": "lt", lt: "lt", less: "lt", less_than: "lt", "меньше": "lt",
      "<=": "lte", lte: "lte", le: "lte", less_or_equal: "lte",
      ">": "gt", gt: "gt", greater: "gt", greater_than: "gt", "больше": "gt",
      ">=": "gte", gte: "gte", ge: "gte", greater_or_equal: "gte",
      "==": "eq", "=": "eq", eq: "eq", equals: "eq",
      "!=": "neq", neq: "neq", not_equals: "neq"
    };
    const map = {
      trigger: "on_click",
      on_click: "on_click",
      click: "on_click",
      get_field_value: "get_path",
      get_field: "get_path",
      field_value: "get_path",
      get_path_value: "get_path",
      path_value: "get_path",
      hp: "get_path",
      health: "get_path",
      text: "literal_str",
      string: "literal_str",
      message_text: "literal_str",
      number: "literal",
      constant: "literal",
      const: "literal",
      if: "if_node",
      if_node: "if_node",
      condition: "if_node",
      condition_check: "if_node",
      compare_exec: "if_node",
      compare: "if_node",
      comparator: "if_node",
      chat: "act_message",
      message: "act_message",
      send_chat: "act_message",
      act_send_chat: "act_message",
      chat_output: "act_message",
      output_chat: "act_message",
      message_composer: "act_message_composer",
      message_compiler: "act_message_composer",
      message_compilator: "act_message_composer",
      interactive_chat_card: "act_message_composer",
      chat_card: "act_message_composer",
      damage_card: "act_message_composer",
      notify: "act_notify",
      notification: "act_notify",
      roll_value: "act_roll_value",
      roll: "act_roll_value",
      damage: "act_damage_simple",
      heal: "act_heal_simple",
      healing: "act_heal_simple",
      save: "act_save_dc",
      save_dc: "act_save_dc",
      dc: "act_save_dc",
      spell: "act_spell",
      choice_from_array: "act_choice_from_array",
      roll: "act_roll_v2",
      dice_roll: "act_roll_v2",
      analyze_roll: "act_analyze_roll",
      compare_roll: "act_compare_roll",
      present_roll: "act_present_roll",
      self_actor: "get_self_actor",
      self_item: "get_self_item",
      aura: "act_aura_definition",
      aura_definition: "act_aura_definition",
      place_aura: "act_place_aura_zone",
      effect: "act_effect_definition",
      effect_definition: "act_effect_definition",
      apply_effect: "act_effect_apply_v2",
      remove_effect: "act_effect_remove_v2",
      toggle_effect: "act_effect_toggle_v2",
      modify: "act_modify",
      modify_field: "act_modify",
      dialogue_builder: "act_dialog_builder",
      dialog_builder: "act_dialog_builder",
      dialog: "act_dialog_builder"
    };
    if (map[key]) return map[key];
    const byCatalogName = Object.entries(NODE_DEFS).find(([nodeType, def]) => {
      if (def?.hidden || def?.isWidgetConfig) return false;
      if (this._aiNormKey(nodeType) === key || this._aiNormKey(def?.title) === key) return true;
      return this._aiNodeAliases(nodeType).some(alias => this._aiNormKey(alias) === key);
    });
    return byCatalogName?.[0] ?? raw;
  }

  _normalizeAIAssistantNodeData(type, data = {}, originalType = "") {
    let clean = data && typeof data === "object" ? { ...data } : {};
    const migration = NODE_TYPE_MIGRATIONS[String(originalType ?? "").trim()];
    if (migration?.newType === type) {
      const migrated = migration.dataMap ? migration.dataMap(clean) : { ...clean };
      clean = { ...(migrated ?? {}), ...clean };
    }
    if (type === "get_path") {
      clean.path = clean.path ?? clean.field ?? clean.fieldPath ?? clean.hpPath ?? clean.dataPath ?? "system.resources.hp.value";
    }
    if (type === "literal") {
      clean.value = clean.value ?? clean.number ?? clean.threshold ?? clean.amount ?? 0;
    }
    if (type === "literal_str") {
      clean.value = clean.value ?? clean.text ?? clean.message ?? clean.content ?? "";
    }
    if (type === "act_message") {
      clean.message = clean.message ?? clean.text ?? clean.content ?? clean.flavor ?? clean.label ?? "";
    }
    if (type === "act_message_composer") {
      clean.title = clean.title ?? clean.label ?? clean.flavor ?? "Message";
      clean.message = clean.message ?? clean.text ?? clean.content ?? clean.description ?? "";
      if (!Array.isArray(clean.buttons)) {
        const rawLabels = Array.isArray(clean.buttonLabels)
          ? clean.buttonLabels
          : String(clean.buttonLabels ?? clean.buttonLabel ?? "").split(/[|,]/).map(value => value.trim()).filter(Boolean);
        const requestedCount = Math.max(1, Math.min(6, Number(clean.buttonCount ?? rawLabels.length ?? 1) || 1));
        clean.buttons = Array.from({length:6}, (_, index) => ({
          id:`btn${index}`,
          enabled:index < requestedCount,
          label:String(rawLabels[index] ?? (index === 0 ? "Apply" : `Button ${index + 1}`)),
          icon:index === 0 ? "fas fa-check" : "fas fa-circle",
          variant:index === 0 ? "primary" : "secondary"
        }));
      } else {
        clean.buttons = clean.buttons.slice(0, 6).map((button, index) => ({
          id:`btn${index}`,
          enabled:button?.enabled !== false,
          label:String(button?.label ?? button?.text ?? `Button ${index + 1}`),
          icon:String(button?.icon ?? (index === 0 ? "fas fa-check" : "fas fa-circle")),
          variant:String(button?.variant ?? button?.style ?? (index === 0 ? "primary" : "secondary"))
        }));
      }
    }
    if (type === "if_node") {
      let op = clean.operator ?? clean.op ?? clean.compare ?? clean.comparison ?? "<";
      op = String(op).trim();
      if (op === "lt" || op === "less" || op === "less_than" || op === "меньше") op = "<";
      if (op === "lte" || op === "le" || op === "less_or_equal") op = "<=";
      if (op === "gt" || op === "greater" || op === "greater_than" || op === "больше") op = ">";
      if (op === "gte" || op === "ge" || op === "greater_or_equal") op = ">=";
      if (op === "=" || op === "eq" || op === "equals") op = "==";
      if (op === "neq" || op === "not_equals") op = "!=";
      clean.operator = ["<","<=",">",">=","==","!="].includes(op) ? op : "<";
      clean.value = clean.value ?? clean.b ?? clean.threshold ?? clean.limit ?? 0;
    }
    return clean;
  }

  _resolveAIAssistantNodeRef(ref, created = {}) {
    const key = String(ref ?? "").trim();
    if (!key) return null;
    if (created[key]) return this.nodes.find(n => n.id === created[key]) ?? null;
    const exact = this.nodes.find(n => n.id === key);
    if (exact) return exact;
    const norm = this._aiNormKey(key);
    if (norm === "trigger" || norm === "on_click" || norm === "click") {
      return this.nodes.find(n => NODE_DEFS[n.type]?.isTrigger || n.type === "on_click") ?? null;
    }
    const type = this._normalizeAIAssistantNodeType(key);
    const byType = this.nodes.find(n => n.type === type);
    if (byType) return byType;
    return this.nodes.find(n => this._aiNormKey(NODE_DEFS[n.type]?.title ?? n.type) === norm) ?? null;
  }

  _pinDefForAI(node, side, pinId) {
    const def = NODE_DEFS[node?.type ?? ""];
    if (!def) return null;
    return this._aiPinsForDef(def, node, side, false).find(p => p.id === pinId) ?? null;
  }

  _resolveAIAssistantPinId(node, side, requested, preferredType = null) {
    const def = NODE_DEFS[node?.type ?? ""];
    if (!def) return "";
    const pins = this._aiPinsForDef(def, node, side, false);
    if (!pins.length) return "";
    const raw = String(requested ?? "").trim();
    if (raw && pins.some(p => p.id === raw)) return raw;
    const norm = this._aiNormKey(raw);
    const byNorm = norm
      ? pins.find(p => this._aiNormKey(p.id) === norm || this._aiNormKey(p.label ?? "") === norm)
      : null;
    if (byNorm) return byNorm.id;
    const wanted = new Set([norm].filter(Boolean));
    const add = (...vals) => vals.forEach(v => wanted.add(this._aiNormKey(v)));
    if (side === "output") add("v", "value", "out", "output", "result", "formula", "text");
    else add("v", "value", "in", "input", "a", "b", "cond", "condition", "message", "text", "amount");
    if (wanted.has("condition")) wanted.add("cond");
    if (wanted.has("message")) wanted.add("text0");
    if (wanted.has("text")) wanted.add("text0");
    const byAlias = pins.find(p => wanted.has(this._aiNormKey(p.id)) || wanted.has(this._aiNormKey(p.label ?? "")));
    if (byAlias) return byAlias.id;
    if (preferredType) {
      const compatible = pins.filter(p => arePinsCompatible(preferredType, p.type));
      if (compatible.length === 1) return compatible[0].id;
      const nonExec = compatible.find(p => p.type !== "exec");
      if (nonExec) return nonExec.id;
      if (compatible[0]) return compatible[0].id;
    }
    if (pins.length === 1) return pins[0].id;
    const execPin = pins.find(p => p.type === "exec");
    if ((norm === "exec" || norm === "execute" || norm === "true" || norm === "pass") && execPin) return execPin.id;
    return "";
  }

  _previewAIAssistantActions(plan) {
    const actions = Array.isArray(plan?.actions) ? plan.actions : [];
    const lines = [];
    if (plan?.message) lines.push(String(plan.message));
    for (const [i, a] of actions.entries()) {
      const op = String(a?.op ?? a?.action ?? "").trim();
      if (op === "addNode") {
        const dataKeys = a.data && typeof a.data === "object" ? Object.keys(a.data) : [];
        lines.push(`${i + 1}. Add node ${a.type}${a.ref ? ` as ${a.ref}` : ""}${dataKeys.length ? ` with ${dataKeys.join(", ")}` : ""}`);
      }
      else if (op === "setData") {
        const data = a.data ?? a.fields ?? {};
        const fields = data && typeof data === "object"
          ? Object.entries(data).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", ")
          : "";
        lines.push(`${i + 1}. Set data on ${a.node ?? a.ref ?? a.id}${fields ? `: ${fields}` : ""}`);
      }
      else if (op === "connect") lines.push(`${i + 1}. Connect ${a.from ?? a.fromNode}.${a.fromPin} -> ${a.to ?? a.toNode}.${a.toPin}`);
      else if (op === "deleteNode") lines.push(`${i + 1}. Delete node ${a.node ?? a.ref ?? a.id}`);
      else if (op === "deleteEdge") lines.push(`${i + 1}. Delete edge ${a.edge ?? a.id ?? `${a.from ?? a.fromNode}.${a.fromPin} -> ${a.to ?? a.toNode}.${a.toPin}`}`);
      else if (op === "clearGraph") lines.push(`${i + 1}. Clear graph${Array.isArray(a.keep) && a.keep.length ? `, keep ${a.keep.join(", ")}` : ""}`);
      else lines.push(`${i + 1}. ${op || "Unknown action"}`);
    }
    return lines.join("\n") || "No graph changes proposed.";
  }

  async _confirmAIAssistantPlan(plan) {
    const { DialogV2 } = foundry.applications.api;
    const preview = this._previewAIAssistantActions(plan);
    const res = await DialogV2.wait({
      window: { title: "Apply AI Graph Plan", icon: "fa-solid fa-brain", resizable: true },
      modal: true,
      content: `<div style="display:flex;flex-direction:column;gap:8px;min-width:560px;min-height:320px;">
        <label style="font-size:12px;font-weight:700;color:var(--sd-text-2);">Planned graph changes</label>
        <textarea readonly rows="14" style="width:100%;min-height:260px;background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:6px;color:var(--sd-text);padding:9px 11px;resize:vertical;font-family:ui-monospace,Menlo,Consolas,monospace;line-height:1.4;">${esc(preview).replace(/<\/textarea/gi, "<\\/textarea")}</textarea>
      </div>`,
      buttons: [
        { action: "apply", label: "Apply", icon: "fas fa-check", default: true, callback: () => true },
        { action: "cancel", label: "Cancel", callback: () => false }
      ],
      rejectClose: false
    }).catch(() => false);
    return !!res;
  }

  _layoutAIAssistantNodes(nodeIds = []) {
    const ids = new Set(nodeIds.filter(Boolean));
    if (!ids.size) return;
    const addedNodes = this.nodes.filter(node => ids.has(node.id));
    if (!addedNodes.length) return;

    const levels = new Map(addedNodes.map(node => [node.id, 0]));
    for (let pass = 0; pass < addedNodes.length; pass++) {
      let changed = false;
      for (const edge of this.edges ?? []) {
        if (!ids.has(edge.toNode)) continue;
        const candidate = ids.has(edge.fromNode) ? (levels.get(edge.fromNode) ?? 0) + 1 : 0;
        if (candidate > (levels.get(edge.toNode) ?? 0)) { levels.set(edge.toNode, candidate); changed = true; }
      }
      if (!changed) break;
    }

    const externalSources = (this.edges ?? [])
      .filter(edge => ids.has(edge.toNode) && !ids.has(edge.fromNode))
      .map(edge => this.nodes.find(node => node.id === edge.fromNode))
      .filter(Boolean);
    const existing = this.nodes.filter(node => !ids.has(node.id));
    const anchors = externalSources.length ? externalSources : existing;
    const widthOf = node => this.nodesEl?.querySelector?.(`[data-nid="${node.id}"]`)?.offsetWidth || 460;
    const baseX = anchors.length ? Math.max(...anchors.map(node => Number(node.x || 0) + widthOf(node))) + 120 : 160;
    const baseY = anchors.length ? Math.min(...anchors.map(node => Number(node.y || 0))) : 160;
    const groups = new Map();
    for (const node of addedNodes) {
      const level = Math.min(12, levels.get(node.id) ?? 0);
      if (!groups.has(level)) groups.set(level, []);
      groups.get(level).push(node);
    }
    for (const [level, nodes] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
      let y = baseY;
      nodes.sort((a, b) => String(a.id).localeCompare(String(b.id)));
      for (const node of nodes) {
        node.x = Math.round(baseX + level * 620);
        node.y = Math.round(y);
        const element = this.nodesEl?.querySelector?.(`[data-nid="${node.id}"]`);
        if (element) { element.style.left = `${node.x}px`; element.style.top = `${node.y}px`; }
        y += Math.max(120, element?.offsetHeight || 180) + 70;
      }
    }
  }

  _applyAIAssistantPlan(plan) {
    const actions = Array.isArray(plan?.actions) ? plan.actions : [];
    const created = {};
    const pendingExecByValueNode = {};
    const addedNodeIds = [];
    const skipped = [];
    let added = 0, updated = 0, connected = 0, deleted = 0, disconnected = 0;

    const setNodeData = (node, data) => {
      if (!node || !data || typeof data !== "object") return false;
      const clean = {};
      for (const [k, v] of Object.entries(data)) {
        if (v === undefined || typeof v === "function") continue;
        clean[k] = v;
      }
      Object.assign(node.data, clean);
      this._renderNode(node);
      return true;
    };

    const prevSuppressHistory = this._suppressHistory;
    this._suppressHistory = true;
    try {
      for (const raw of actions) {
        const a = raw && typeof raw === "object" ? { ...raw } : {};
        const op = this._normalizeAIAssistantOp(a.op ?? a.action ?? "");
        try {
          if (op === "addNode") {
            const originalType = String(a.type ?? "").trim();
            const type = this._normalizeAIAssistantNodeType(originalType, a.data);
            const data = this._normalizeAIAssistantNodeData(type, a.data, originalType);
            const def = NODE_DEFS[type];
            if (!def || !this._isNodeAvailableInCurrentGraph(type, def)) {
              skipped.push(`addNode ${originalType || type}: unavailable node type`);
              continue;
            }
            const x = Number.isFinite(Number(a.x)) ? Number(a.x) : 160 + added * 260;
            const y = Number.isFinite(Number(a.y)) ? Number(a.y) : 180 + added * 60;
            const node = this._addNode(type, x, y, data);
            if (!node) {
              skipped.push(`addNode ${type}: failed`);
              continue;
            }
            const ref = String(a.ref ?? a.id ?? "").trim();
            if (ref) created[ref] = node.id;
            if (originalType && originalType !== ref) created[originalType] = node.id;
            addedNodeIds.push(node.id);
            added++;
            continue;
          }

        if (op === "setData") {
          const node = this._resolveAIAssistantNodeRef(a.node ?? a.ref ?? a.id, created);
          if (!node) {
            skipped.push(`setData ${a.node ?? a.ref ?? a.id}: node not found`);
            continue;
          }
          const data = this._normalizeAIAssistantNodeData(node.type, a.data ?? a.fields ?? {}, node.type);
          if (setNodeData(node, data)) updated++;
          continue;
        }

        if (op === "connect") {
          const from = this._resolveAIAssistantNodeRef(a.from ?? a.fromNode, created);
          const to = this._resolveAIAssistantNodeRef(a.to ?? a.toNode, created);
          const rawFromPin = a.fromPin ?? a.output ?? "";
          const rawToPin = a.toPin ?? a.input ?? "";
          const fromPin = this._resolveAIAssistantPinId(from, "output", rawFromPin);
          const outPin = fromPin ? this._pinDefForAI(from, "output", fromPin) : null;
          const toPin = this._resolveAIAssistantPinId(to, "input", rawToPin, outPin?.type);
          const inPin = toPin ? this._pinDefForAI(to, "input", toPin) : null;
          if (!from || !to || !fromPin) {
            skipped.push(`connect: missing node or pin`);
            continue;
          }
          if (!toPin) {
            const wantsExec = this._aiNormKey(rawToPin) === "exec" || this._aiNormKey(rawToPin) === "execute";
            const toHasExec = this._aiPinsForDef(NODE_DEFS[to.type], to, "input", false).some(p => p.type === "exec");
            if (outPin?.type === "exec" && wantsExec && !toHasExec) {
              pendingExecByValueNode[to.id] = { fromId: from.id, fromPin };
              continue;
            }
            skipped.push(`connect ${from.id}.${fromPin} -> ${to.id}.${String(rawToPin ?? "").trim()}: pin not found`);
            continue;
          }
          if (!outPin || !inPin) {
            const wantsExec = this._aiNormKey(rawToPin) === "exec" || this._aiNormKey(rawToPin) === "execute";
            const toHasExec = this._aiPinsForDef(NODE_DEFS[to.type], to, "input", false).some(p => p.type === "exec");
            if (outPin?.type === "exec" && wantsExec && !toHasExec) {
              pendingExecByValueNode[to.id] = { fromId: from.id, fromPin };
              continue;
            }
            skipped.push(`connect ${from.id}.${fromPin} -> ${to.id}.${toPin}: pin not found`);
            continue;
          }
          if (!arePinsCompatible(outPin.type, inPin.type)) {
            skipped.push(`connect ${from.id}.${fromPin} -> ${to.id}.${toPin}: incompatible ${outPin.type} -> ${inPin.type}`);
            continue;
          }
          const before = this.edges.length;
          this._addEdge(from.id, fromPin, to.id, toPin);
          if (this.edges.length > before) connected++;
          const pendingExec = pendingExecByValueNode[from.id];
          if (pendingExec) {
            const execIn = this._aiPinsForDef(NODE_DEFS[to.type], to, "input", false).find(p => p.type === "exec");
            if (execIn && !this.edges.some(e =>
              e.fromNode === pendingExec.fromId &&
              e.fromPin === pendingExec.fromPin &&
              e.toNode === to.id &&
              e.toPin === execIn.id
            )) {
              const beforeExec = this.edges.length;
              this._addEdge(pendingExec.fromId, pendingExec.fromPin, to.id, execIn.id);
              if (this.edges.length > beforeExec) connected++;
              delete pendingExecByValueNode[from.id];
            }
          }
          continue;
        }

        if (op === "deleteNode") {
          const node = this._resolveAIAssistantNodeRef(a.node ?? a.ref ?? a.id, created);
          if (!node) {
            skipped.push(`deleteNode ${a.node ?? a.ref ?? a.id}: node not found`);
            continue;
          }
          if (node.id === "output" || node.id === "init_on_roll" || node.id === "init_output" || NODE_DEFS[node.type]?.noDelete) {
            skipped.push(`deleteNode ${node.id}: protected node`);
            continue;
          }
          const before = this.nodes.length;
          this._delNode(node.id);
          if (this.nodes.length < before) deleted++;
          continue;
        }

        if (op === "deleteEdge") {
          const edgeId = String(a.edge ?? a.id ?? "").trim();
          let edge = edgeId ? this.edges.find(e => e.id === edgeId) : null;
          if (!edge) {
            const from = this._resolveAIAssistantNodeRef(a.from ?? a.fromNode, created);
            const to = this._resolveAIAssistantNodeRef(a.to ?? a.toNode, created);
            const fromPin = String(a.fromPin ?? a.output ?? "").trim();
            const toPin = String(a.toPin ?? a.input ?? "").trim();
            edge = this.edges.find(e =>
              (!from || e.fromNode === from.id) &&
              (!to || e.toNode === to.id) &&
              (!fromPin || e.fromPin === fromPin) &&
              (!toPin || e.toPin === toPin)
            );
          }
          if (!edge) {
            skipped.push(`deleteEdge: edge not found`);
            continue;
          }
          const before = this.edges.length;
          this._removeEdge(edge.id);
          if (this.edges.length < before) disconnected++;
          continue;
        }

        if (op === "clearGraph") {
          const keep = new Set((Array.isArray(a.keep) ? a.keep : []).map(v => String(v)));
          const protectedIds = new Set(["output", "init_on_roll", "init_output"]);
          const before = this.nodes.length;
          const removeIds = new Set(this.nodes
            .filter(n => !protectedIds.has(n.id) && !keep.has(n.id) && !keep.has(n.type) && !NODE_DEFS[n.type]?.noDelete)
            .map(n => n.id));
          if (!removeIds.size) {
            skipped.push("clearGraph: no removable nodes");
            continue;
          }
          this.nodes = this.nodes.filter(n => !removeIds.has(n.id));
          this.edges = this.edges.filter(e => !removeIds.has(e.fromNode) && !removeIds.has(e.toNode));
          this._renderAll();
          this._pushHistory?.();
          deleted += before - this.nodes.length;
          continue;
        }

          if (op) skipped.push(`${op}: unsupported operation`);
        } catch (e) {
          skipped.push(`${op || "action"}: ${String(e?.message ?? e)}`);
        }
      }
    } finally {
      this._suppressHistory = prevSuppressHistory;
    }

    this._scheduleEdges?.();
    this._updatePreview?.();
    if (added || updated || connected || deleted || disconnected) this._pushHistory?.();
    SDOnboarding.onGraphChanged?.(this);
    return { added, updated, connected, deleted, disconnected, skipped };
  }

  _aiChatStorageKey() {
    const docPart = this.doc?.uuid ?? this.doc?.id ?? "world";
    const widgetPart = this.widget?.id ?? this.widget?.key ?? this.saveCtx?.attrKey ?? this.saveCtx?.skillKey ?? "graph";
    return `sd.aiGraphAssistant.chats.v1.${docPart}.${widgetPart}`;
  }

  _loadAIAssistantChats() {
    try {
      const raw = localStorage.getItem(this._aiChatStorageKey());
      const parsed = JSON.parse(raw || "[]");
      if (Array.isArray(parsed)) {
        return parsed.filter(c => c && typeof c === "object").map(c => ({
          id: String(c.id || uid()),
          title: String(c.title || "New chat"),
          created: Number(c.created || Date.now()),
          updated: Number(c.updated || Date.now()),
          messages: Array.isArray(c.messages) ? c.messages : []
        }));
      }
    } catch { }
    return [];
  }

  _saveAIAssistantChats() {
    try {
      localStorage.setItem(this._aiChatStorageKey(), JSON.stringify(this._aiChats ?? []));
    } catch (e) {
      console.warn("SD | Could not save AI graph assistant chats:", e);
    }
  }

  _newAIAssistantChat() {
    const chat = { id: `chat_${uid()}`, title: "New chat", created: Date.now(), updated: Date.now(), messages: [] };
    if (!Array.isArray(this._aiChats)) this._aiChats = [];
    this._aiChats.unshift(chat);
    this._aiActiveChatId = chat.id;
    this._saveAIAssistantChats();
    return chat;
  }

  _activeAIAssistantChat() {
    if (!Array.isArray(this._aiChats)) this._aiChats = this._loadAIAssistantChats();
    if (!this._aiChats.length) return this._newAIAssistantChat();
    let chat = this._aiChats.find(c => c.id === this._aiActiveChatId);
    if (!chat) {
      chat = this._aiChats[0];
      this._aiActiveChatId = chat.id;
    }
    return chat;
  }

  _deleteAIAssistantChat(id) {
    this._aiChats = (this._aiChats ?? []).filter(c => c.id !== id);
    if (!this._aiChats.length) this._newAIAssistantChat();
    else if (this._aiActiveChatId === id) this._aiActiveChatId = this._aiChats[0].id;
    this._saveAIAssistantChats();
  }

  _renderAIAssistantChat() {
    const win = this._aiChatWin;
    if (!win) return;
    const chat = this._activeAIAssistantChat();
    const chats = this._aiChats ?? [];
    const msgHtml = (chat.messages ?? []).map((m, i) => {
      const role = String(m.role ?? "assistant");
      const isUser = role === "user";
      const isPending = !!m.pending;
      const hasPlan = m.plan && Array.isArray(m.plan.actions) && m.plan.actions.length;
      const plan = hasPlan && !m.applied;
      const body = esc(String(m.content ?? "")).replace(/>/g, "&gt;");
      return `<div class="sd-ai-chat-msg ${isUser ? "is-user" : "is-assistant"} ${hasPlan ? "has-plan" : ""}" data-msg-index="${i}">
        ${isUser ? "" : `<div class="sd-ai-chat-avatar"><i class="fas fa-brain"></i></div>`}
        <div class="sd-ai-chat-msg-stack">
          <div class="sd-ai-chat-role">${isUser ? "You" : hasPlan ? "Assistant Plan" : "Assistant"}</div>
          <div class="sd-ai-chat-bubble ${isUser ? "is-user" : ""} ${plan ? "is-plan" : ""}">
            ${isPending ? `<i class="fas fa-spinner fa-spin sd-ai-chat-spinner"></i>` : ""}${body}
          </div>
          ${plan ? `<div class="sd-ai-chat-plan-actions">
            <button type="button" data-action="apply-plan" data-msg-index="${i}" class="sd-ai-chat-apply"><i class="fas fa-wand-magic-sparkles"></i> Apply Plan</button>
            <span>Need changes? Tell me in chat and I will revise the plan.</span>
          </div>` : hasPlan && m.applied ? `<span class="sd-ai-chat-applied"><i class="fas fa-check"></i> Plan applied</span>` : ""}
        </div>
        ${isUser ? `<div class="sd-ai-chat-avatar is-user"><i class="fas fa-user"></i></div>` : ""}
      </div>`;
    }).join("");

    win.innerHTML = `
      <div class="sd-ai-chat-head">
        <div class="sd-ai-chat-mark"><i class="fas fa-brain"></i></div>
        <div class="sd-ai-chat-titlebox">
          <strong>AI Graph Assistant</strong>
          <span>Chat, inspect, search nodes, edit fields, delete nodes, and apply graph plans.</span>
        </div>
        <button type="button" data-action="new-chat" title="New chat" class="sd-ai-chat-iconbtn"><i class="fas fa-plus"></i></button>
        <button type="button" data-action="close" title="Close" class="sd-ai-chat-iconbtn"><i class="fas fa-xmark"></i></button>
      </div>
      <div class="sd-ai-chat-body">
        <aside class="sd-ai-chat-sidebar">
          <div class="sd-ai-chat-side-title">Chats</div>
          ${chats.map(c => `<div data-chat-id="${esc(c.id)}" class="sd-ai-chat-row">
            <button type="button" data-action="select-chat" data-chat-id="${esc(c.id)}" class="sd-ai-chat-tab ${c.id === chat.id ? "is-active" : ""}">${esc(c.title)}</button>
            <button type="button" data-action="delete-chat" data-chat-id="${esc(c.id)}" title="Delete chat" class="sd-ai-chat-delete"><i class="fas fa-trash"></i></button>
          </div>`).join("")}
        </aside>
        <main class="sd-ai-chat-main">
          <div class="sd-ai-chat-messages">
            ${msgHtml || `<div class="sd-ai-chat-empty">Ask normally. If you ask to create, change, delete, connect, clear, fix, or help build the graph, the assistant will propose an applyable plan in chat.</div>`}
          </div>
          <div class="sd-ai-chat-composer">
            <textarea name="message" rows="3" placeholder="Message the graph assistant..."></textarea>
            <div class="sd-ai-chat-compose-row">
              <span>Ctrl+Enter sends. Plans appear with an Apply Plan button.</span>
              <button type="button" data-action="send" class="sd-ai-chat-send"><i class="fas fa-paper-plane"></i> Send</button>
            </div>
          </div>
        </main>
      </div>`;

    const messages = win.querySelector(".sd-ai-chat-messages");
    if (messages) messages.scrollTop = messages.scrollHeight;

    win.querySelector("[data-action='close']")?.addEventListener("click", () => this._aiChatApp?.close?.());
    win.querySelector("[data-action='new-chat']")?.addEventListener("click", () => {
      this._newAIAssistantChat();
      this._renderAIAssistantChat();
    });
    win.querySelectorAll("[data-action='select-chat']").forEach(btn => {
      btn.addEventListener("click", () => {
        this._aiActiveChatId = btn.dataset.chatId;
        this._renderAIAssistantChat();
      });
    });
    win.querySelectorAll("[data-action='delete-chat']").forEach(btn => {
      btn.addEventListener("click", ev => {
        ev.stopPropagation();
        this._deleteAIAssistantChat(btn.dataset.chatId);
        this._renderAIAssistantChat();
      });
    });
    win.querySelector("[data-action='send']")?.addEventListener("click", () => this._sendAIAssistantChat());
    win.querySelector("[name='message']")?.addEventListener("keydown", ev => {
      if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) this._sendAIAssistantChat();
    });
    win.querySelectorAll("[data-action='apply-plan']").forEach(btn => {
      btn.addEventListener("click", async () => {
        const msg = chat.messages[Number(btn.dataset.msgIndex)];
        if (!msg?.plan) return;
        if (!(await this._confirmAIAssistantPlan(msg.plan))) return;
        const applied = this._applyAIAssistantPlan(msg.plan);
        msg.applied = true;
        const skippedText = applied.skipped.length
          ? `\n\nSkipped:\n${applied.skipped.slice(0, 8).map(s => `- ${s}`).join("\n")}${applied.skipped.length > 8 ? `\n- ...${applied.skipped.length - 8} more` : ""}`
          : "";
        chat.messages.push({
          role: "assistant",
          content: `Applied plan. Added: ${applied.added}, updated: ${applied.updated}, connected: ${applied.connected}, deleted: ${applied.deleted}, disconnected: ${applied.disconnected}${applied.skipped.length ? `, skipped: ${applied.skipped.length}` : ""}.${skippedText}`,
          ts: Date.now()
        });
        chat.updated = Date.now();
        this._saveAIAssistantChats();
        this._renderAIAssistantChat();
        if (applied.skipped.length) console.warn("SD | AI Graph Assistant skipped actions:", applied.skipped);
      });
    });

    if (!this._aiChatDragBound) {
      this._aiChatDragBound = true;
      let drag = null;
      win.addEventListener("mousedown", ev => {
        if (!ev.target.closest(".sd-ai-chat-head") || ev.target.closest("button")) return;
        drag = { x: ev.clientX - win.offsetLeft, y: ev.clientY - win.offsetTop };
      });
      const move = ev => {
        if (!drag || !this._aiChatWin) return;
        win.style.left = `${Math.max(0, ev.clientX - drag.x)}px`;
        win.style.top = `${Math.max(0, ev.clientY - drag.y)}px`;
      };
      const up = () => { drag = null; };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
      this._cleanup?.push?.(() => {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
      });
    }
  }

  async _sendAIAssistantChat() {
    const chat = this._activeAIAssistantChat();
    const input = this._aiChatWin?.querySelector?.("[name='message']");
    const prompt = String(input?.value ?? "").trim();
    if (!prompt) return;
    if (input) input.value = "";
    if (chat.title === "New chat") chat.title = prompt.slice(0, 42) || "New chat";
    chat.messages.push({ role: "user", content: prompt, ts: Date.now() });
    const pending = { role: "assistant", content: "Thinking...", pending: true, ts: Date.now() };
    chat.messages.push(pending);
    chat.updated = Date.now();
    this._saveAIAssistantChats();
    this._renderAIAssistantChat();

    const graphContext = this._aiGraphSnapshot();
    const nodeCatalog = this._aiNodeCatalog(prompt, 180);
    const conversation = chat.messages
      .filter(m => !m.pending)
      .slice(-12)
      .map(m => {
        const planText = m.plan ? `\nPlan JSON: ${JSON.stringify(m.plan).slice(0, 8000)}` : "";
        return `${m.role === "user" ? "User" : "Assistant"}: ${m.content}${planText}`;
      })
      .join("\n\n");

    try {
      const { requestAIChat } = await import("../helpers/ai-context.mjs");
      const answer = await requestAIChat({
        provider: { providerProfile: "assistant" },
        json: true,
        systemPrompt: [
          "You are an expert Foundry VTT Sheet Director node graph chat assistant.",
          "You can inspect the current graph, search the available node catalog, answer questions, and propose graph edits.",
          "Always return JSON only. No markdown.",
          "Response schema: {\"message\":\"chat response for the user\",\"actions\":[...]}",
          "If the user only asks a conceptual question, set actions to [].",
          "If the latest user request asks to build, create, add, help build, fix, change, update, set a value, connect, delete, remove, clear, redo, revise, or otherwise modify the graph, return a complete replacement actions plan based on the CURRENT graph.",
          "If the user dislikes a previous plan and asks to change it, use the conversation as context but output a full new replacement plan against the current graph. Do not output only a partial diff of an unapplied plan.",
          "Allowed operations:",
          "{\"op\":\"addNode\",\"ref\":\"shortNewNodeRef\",\"type\":\"node_type\",\"x\":number,\"y\":number,\"data\":{fieldKey:value}}",
          "{\"op\":\"setData\",\"node\":\"existingNodeIdOrNewRef\",\"data\":{fieldKey:value}}",
          "{\"op\":\"connect\",\"from\":\"existingNodeIdOrNewRef\",\"fromPin\":\"outputPinId\",\"to\":\"existingNodeIdOrNewRef\",\"toPin\":\"inputPinId\"}",
          "{\"op\":\"deleteNode\",\"node\":\"existingNodeIdOrNewRef\"}",
          "{\"op\":\"deleteEdge\",\"edge\":\"edgeId\"}",
          "{\"op\":\"deleteEdge\",\"from\":\"existingNodeIdOrNewRef\",\"fromPin\":\"outputPinId\",\"to\":\"existingNodeIdOrNewRef\",\"toPin\":\"inputPinId\"}",
          "{\"op\":\"clearGraph\",\"keep\":[\"nodeIdOrNodeTypeToKeep\"]}",
          "Use setData to change any field/value inside an existing or newly added node.",
          "The provided catalog is authoritative. Use only exact node type ids, field keys, and pin ids from the catalog/current graph.",
          "Do not invent node ids like get_field_value, send_chat, chat_output, compare, unless they appear in the catalog. Prefer catalog ids: get_path, if_node, branch, gate, act_message.",
          "Do not fan out one exec output directly into multiple independent nodes. Exec flow should be one chain. Use sequence for multiple independent actions, and branch/if_node for conditional flow.",
          "For simple checks like HP < 5 then chat: add get_path(path=system.resources.hp.value), add if_node(operator=<, value=5), add act_message(message=...), connect trigger.exec -> if_node.exec, get_path.v -> if_node.a, if_node.exec -> act_message.exec. Do not add a duplicate second if_node.",
          "For constant text in chat, set act_message.data.message. For dynamic chat text, connect literal_str.v to act_message.text0.",
          "Use availableDataPaths from Current graph JSON when choosing actor/item/system paths. Hidden fields are valid as system.hiddenFields.<key>.",
          "Never delete protected output/init/noDelete nodes. Avoid destructive changes unless the user asks for deletion or clearing.",
          "Keep plans minimal, readable, and spatially arranged."
        ].join("\n"),
        prompt: [
          "Conversation:",
          conversation,
          "",
          "Latest user request:",
          prompt,
          "",
          "Current graph JSON:",
          JSON.stringify(graphContext, null, 2).slice(0, 26000),
          "",
          "Available node catalog JSON:",
          JSON.stringify(nodeCatalog, null, 2).slice(0, 42000)
        ].join("\n")
      });

      let plan;
      try {
        plan = this._parseAIAssistantPlan(answer);
      } catch {
        plan = { message: String(answer ?? ""), actions: [] };
      }
      if (!Array.isArray(plan.actions)) plan.actions = [];
      pending.pending = false;
      if (plan.actions.length) {
        pending.plan = plan;
        pending.content = [
          plan.message || "I prepared a graph plan.",
          "",
          this._previewAIAssistantActions(plan)
        ].filter(Boolean).join("\n");
      } else {
        pending.content = plan.message || String(answer ?? "");
      }
    } catch (e) {
      pending.pending = false;
      pending.content = `Error: ${String(e?.message ?? e)}`;
      console.warn("SD | AI Graph Assistant failed:", e);
    }

    chat.updated = Date.now();
    this._saveAIAssistantChats();
    this._renderAIAssistantChat();
  }

  async _openAIAssistant() {
    if (this._aiChatApp?.rendered && this._aiChatWin) {
      this._aiChatApp.bringToFront?.();
      this._renderAIAssistantChat();
      return;
    }
    this._aiChats = this._loadAIAssistantChats();
    if (!this._aiChats.length) this._newAIAssistantChat();
    const win = document.createElement("div");
    win.className = "sd sd-ai-graph-chat";
    win.style.cssText = "position:relative;width:100%;height:100%;min-width:0;min-height:0;inset:auto;resize:none;border:0;border-radius:0;box-shadow:none";
    this._aiChatWin = win;
    this._aiChatDragBound = true;
    this._aiChatApp = openFoundryWindow({
      id:`sd-ai-graph-assistant-${foundry.utils.randomID(8)}`,
      title:"System Director — AI Graph Assistant",
      icon:"fa-solid fa-brain",
      width:Math.min(760, Math.floor(window.innerWidth * 0.90)),
      height:Math.min(640, Math.floor(window.innerHeight * 0.86)),
      minWidth:560,
      minHeight:420,
      classes:["sd-ai-graph-assistant-window"],
      content:win,
      onClose:()=>{ this._aiChatApp=null; this._aiChatWin=null; win.remove(); }
    });
    this._renderAIAssistantChat();
  }

  _loadGraph() {
    if (this.customLoad) {
      let s = null;
      try { s = this.customLoad(); } catch(e) { console.warn("[sd] formula-graph: customLoad failed", e); }
      if (s && typeof s === "object" && s._graphData?.nodes?.length) s = s._graphData;
      if (s?.nodes?.length) {
        this.nodes    = foundry.utils.deepClone(s.nodes);
        this.edges    = foundry.utils.deepClone(s.edges ?? []);
        this.comments = foundry.utils.deepClone(s.comments ?? []);
        this._runMigrations();
        if (this.initiativeMode) this._ensureInitiativeNodes();
        const numIds = this.nodes.map(n=>{ const v=parseInt(n.id?.replace(/\D/g,"")??0); return isNaN(v)?0:v; });
        this._id = (Math.max(0,...numIds) + 2) || 2;
      } else if (this.initiativeMode) {
        this._addInitiativeDefaultGraph();
      } else if (this.actionGraph) {
        this._addTriggerOutputNodes();
      } else if (!this.chainTrigger && !this.questTrigger) {
        this._addCalcDefaultGraph();
      }
      return;
    }
    if (this.numberWidgetMode && this.widget) {
      const s = this.widget.numberGraph;
      if (s?.nodes?.length) {
        this.nodes    = foundry.utils.deepClone(s.nodes);
        this.edges    = foundry.utils.deepClone(s.edges ?? []);
        this.comments = foundry.utils.deepClone(s.comments ?? []);
        this._runMigrations();
        this._ensureNumberWidgetGraph();
        const numIds = this.nodes.map(n=>{ const v=parseInt(n.id?.replace(/\D/g,"")??0); return isNaN(v)?0:v; });
        this._id = (Math.max(0,...numIds) + 2) || 2;
      } else {
        this._addNumberWidgetDefaultGraph();
      }
      return;
    }
    if (this.configMode && this.widget) {
      const s = this.widget.configGraph;
      if (s?.nodes?.length) {
        this.nodes = foundry.utils.deepClone(s.nodes);
        this.edges = foundry.utils.deepClone(s.edges ?? []);
        this.comments = foundry.utils.deepClone(s.comments ?? []);
        this._runMigrations();
        const numIds = this.nodes.map(n=>{ const v=parseInt(n.id?.replace(/\D/g,"")??0); return isNaN(v)?0:v; });
        this._id = (Math.max(0,...numIds) + 2) || 2;
      } else {
        this._addWidgetConfigNode();
      }
      return;
    }
    if (this.itemSaveCtx) {
      const s = this.itemSaveCtx.doc.system?.onClickGraph;
      if (s?.nodes?.length) {
        this.nodes = foundry.utils.deepClone(s.nodes);
        this.edges = foundry.utils.deepClone(s.edges ?? []);
        this.comments = foundry.utils.deepClone(s.comments ?? []);
        this._runMigrations();
        const numIds = this.nodes.map(n=>{ const v=parseInt(n.id?.replace(/\D/g,"")??0); return isNaN(v)?0:v; });
        this._id = (Math.max(0,...numIds) + 2) || 2;
      } else {
        this._addTriggerOutputNodes();
      }
      return;
    }
    if (this.sheetTrigger && this.doc) {
      const stg = this.doc.system?.sdTriggerGraph;
      const g   = (stg && typeof stg === "object") ? stg._graphData : null;
      if (g?.nodes?.length) {
        this.nodes = foundry.utils.deepClone(g.nodes);
        this.edges = foundry.utils.deepClone(g.edges ?? []);
        this.comments = foundry.utils.deepClone(g.comments ?? []);
        this._runMigrations();
        const numIds = this.nodes.map(n=>{ const v=parseInt(n.id?.replace(/\D/g,"")??0); return isNaN(v)?0:v; });
        this._id = (Math.max(0,...numIds) + 2) || 2;
      } else {
      }
      return;
    }

    if (this.widget?.type === "attributeGroup" && this.saveCtx?.attrKey) {
      const key = this.saveCtx.attrKey;
      const ag  = this.widget.attrGraphs?.[key];
      const s   = ag?.graphData;
      if (s?.nodes?.length) {
        this.nodes = foundry.utils.deepClone(s.nodes);
        this.edges = foundry.utils.deepClone(s.edges??[]);
        this.comments = foundry.utils.deepClone(s.comments ?? []);
        this._runMigrations();
        this._migrateAttrGraph();
        const numIds = this.nodes.map(n=>{ const v=parseInt(n.id?.replace(/\D/g,"")??0); return isNaN(v)?0:v; });
        this._id = (Math.max(0,...numIds) + 2) || 2;
      } else {
        this._addAttributeDefaultGraph();
      }
      return;
    }

    const s = this.widget?.graphData;
    if (s?.nodes?.length) {
      this.nodes = foundry.utils.deepClone(s.nodes);
      this.edges = foundry.utils.deepClone(s.edges??[]);
      this.comments = foundry.utils.deepClone(s.comments ?? []);
      this._runMigrations();
      if (this.widget?.type === "attribute") {
        this._migrateAttrGraph();
      } else if (this.widget?.type === "skill") {
        this._migrateSkillGraph();
      }
      const numIds = this.nodes.map(n=>{ const v=parseInt(n.id?.replace(/\D/g,"")??0); return isNaN(v)?0:v; });
      this._id = (Math.max(0,...numIds) + 2) || 2;
    } else {
      if (this.actionGraph) {
        this._addTriggerOutputNodes();
      } else if (this.widget?.type === "button") {
        this._addTriggerOutputNodes();
      } else if (this.widget?.type === "attribute") {
        this._addAttributeDefaultGraph();
      } else if (this.widget?.type === "skill") {
        this._addSkillDefaultGraph();
      } else {
        this._addOutputNode();
        const f = this.targetInput?.value??"";
        if (f && f!=="0") this._hydrateFormula(f);
      }
    }
  }

  _findWidgetDeepInRow(list, id) {
    if (!Array.isArray(list)) return null;
    for (const ww of list) {
      if (ww?.id === id) return ww;
      if (ww?.type === "vsection") {
        const nested = this._findWidgetDeepInRow(ww.widgets, id);
        if (nested) return nested;
      }
      if (ww?.type === "widgetBuilder") {
        const embedded = this._findWidgetDeepInRow((ww.elements ?? []).map(el => el?.widget).filter(Boolean), id);
        if (embedded) return embedded;
      }
    }
    return null;
  }

  async _saveGraph() {
    if (this.customSave) {
      const graphData = {
        nodes:    this.nodes.map(n=>({id:n.id,type:n.type,x:n.x,y:n.y,data:{...n.data}})),
        edges:    this.edges.map(e=>({id:e.id,fromNode:e.fromNode,fromPin:e.fromPin,toNode:e.toNode,toPin:e.toPin})),
        comments: this.comments.map(c => this._serialiseComment(c))
      };
      let compiled = "0";
      try { compiled = this.compile(); } catch(e) { console.warn("[sd] formula-graph: compile failed", e); }
      let payload = graphData;
      if (this.chainTrigger || this.questTrigger) {
        let compiledObj = {};
        try { compiledObj = JSON.parse(compiled); } catch { compiledObj = {}; }
        payload = (compiledObj && compiledObj._trigger === "multi") ? compiledObj : {};
        payload._graphData = graphData;
      }
      try { await this.customSave(payload, compiled); }
      catch(e) { console.warn("[sd] formula-graph: customSave failed", e); }
      return;
    }
    if (this.numberWidgetMode && this.saveCtx) {
      this._ensureNumberWidgetGraph();
      const {tab, row, w, doc} = this.saveCtx;
      const graphData = {
        nodes: this.nodes.map(n=>({id:n.id,type:n.type,x:n.x,y:n.y,data:{...n.data}})),
        edges: this.edges.map(e=>({id:e.id,fromNode:e.fromNode,fromPin:e.fromPin,toNode:e.toNode,toPin:e.toPin})),
        comments: this.comments.map(c => this._serialiseComment(c))
      };
      const tabs = foundry.utils.deepClone(doc.system?.customTabs ?? []);
      const _row = tabs.find(t=>t.id===tab.id)?.rows?.find(r=>r.id===row.id);
      const widget = _row ? this._findWidgetDeepInRow(_row.widgets, w.id) : null;
      if (!widget) console.warn("[sd] formula-graph: number widget not found in customTabs", { tabId: tab?.id, rowId: row?.id, widgetId: w?.id });
      if (widget) {
        const out = this.nodes.find(n => n.type === "number_output");
        const compilePin = (pin, fallback = "") => {
          if (!out) return fallback;
          const edge = this._incomingEdge(out.id, pin);
          if (!edge) return fallback;
          const src = this.nodes.find(n => n.id === edge.fromNode);
          return src ? this._compileValue(src, new Set(), edge.fromPin) : fallback;
        };
        if (String(widget.type ?? "") === "resource") {
          widget.resourceMode = "node";
        } else {
          widget.numberMode = "node";
          delete widget.min;
          delete widget.max;
          delete widget.step;
        }
        widget.numberGraph = graphData;
        widget.minFormula  = compilePin("min", "");
        widget.maxFormula  = compilePin("max", "");
        widget.stepFormula = compilePin("step", "1");
        await doc.update({"system.customTabs": tabs});
      }
      return;
    }
    if (this.configMode && this.saveCtx) {
      const {tab, row, w, doc} = this.saveCtx;
      const graphData = {
        nodes: this.nodes.map(n=>({id:n.id,type:n.type,x:n.x,y:n.y,data:{...n.data}})),
        edges: this.edges.map(e=>({id:e.id,fromNode:e.fromNode,fromPin:e.fromPin,toNode:e.toNode,toPin:e.toPin})),
        comments: this.comments.map(c => this._serialiseComment(c))
      };
      const cfgNode = this.nodes.find(n => NODE_DEFS[n.type]?.isWidgetConfig);
      const tabs = foundry.utils.deepClone(doc.system?.customTabs ?? []);
      const _row = tabs.find(t=>t.id===tab.id)?.rows?.find(r=>r.id===row.id);
      const widget = _row ? this._findWidgetDeepInRow(_row.widgets, w.id) : null;
      if (!widget) console.warn("[sd] formula-graph: widget not found in customTabs", { tabId: tab?.id, rowId: row?.id, widgetId: w?.id });
      if (widget && cfgNode) {
        const def = NODE_DEFS[cfgNode.type];
        const compiledIns = {};
        for (const pin of (def.inputs ?? [])) {
          const e = this._incomingEdge(cfgNode.id, pin.id);
          if (e) {
            const src = this.nodes.find(n=>n.id===e.fromNode);
            if (src) compiledIns[pin.id] = this._compileValue(src, new Set(), e.fromPin);
          }
        }

        const _unwrapStringLiteral = (v) => {
          if (typeof v !== "string") return v;
          const s = v.trim();
          if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
            try { return JSON.parse(s); } catch { return v; }
          }
          if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) {
            return s.slice(1, -1);
          }
          return v;
        };
        for (const field of (def.fields ?? [])) {
          let val = compiledIns[field.key] !== undefined
            ? compiledIns[field.key]
            : cfgNode.data[field.key] ?? field.default ?? "";
          if (compiledIns[field.key] !== undefined && field.type !== "number") {
            val = _unwrapStringLiteral(val);
          }
          widget[field.key] = field.type === "number" ? Number(val) : val;
        }
        widget.configGraph = graphData;
        await doc.update({"system.customTabs": tabs});
      }
      return;
    }
    if (this.saveCtx) {
      const {tab,row,w,doc,attrKey} = this.saveCtx;
      const data = {
        nodes: this.nodes.map(n=>({id:n.id,type:n.type,x:n.x,y:n.y,data:{...n.data}})),
        edges: this.edges.map(e=>({id:e.id,fromNode:e.fromNode,fromPin:e.fromPin,toNode:e.toNode,toPin:e.toPin})),
        comments: this.comments.map(c => this._serialiseComment(c))
      };
      const tabs   = foundry.utils.deepClone(doc.system.customTabs??[]);
      const _row   = tabs.find(t=>t.id===tab.id)?.rows?.find(r=>r.id===row.id);
      const widget = _row ? this._findWidgetDeepInRow(_row.widgets, w.id) : null;
      if (!widget) console.warn("[sd] formula-graph: widget not found in customTabs", { tabId: tab?.id, rowId: row?.id, widgetId: w?.id });
      if (widget) {

        if (this.widget?.type === "attributeGroup" && attrKey) {
          const attrOut = this.nodes.find(n => n.type === "attr_output");
          let modValueFormula = null;
          if (attrOut) {
            const mvEdge = this._incomingEdge(attrOut.id, "modValue");
            const modSrc = mvEdge ? this.nodes.find(n => n.id === mvEdge.fromNode) : null;
            modValueFormula = modSrc ? this._compileValue(modSrc, new Set(), mvEdge.fromPin) : null;
          }
          const onClickFormula = this._compileOnClickFormula();
          widget.attrGraphs = (widget.attrGraphs && typeof widget.attrGraphs === "object") ? { ...widget.attrGraphs } : {};
          widget.attrGraphs[attrKey] = { graphData: data, modValueFormula, onClickFormula };
        } else {
          widget.graphData = data;
          if (this.widget?.type === "widgetBuilder") {
            const outs2 = {};
            for (const on2 of this.nodes.filter(n => n.type === "widget_output")) {
              const nm2 = String(on2.data?.name ?? "").trim();
              if (!nm2) continue;
              const vEdge2 = this._incomingEdge(on2.id, "value");
              if (!vEdge2) continue;
              const src2 = this.nodes.find(n => n.id === vEdge2.fromNode);
              if (!src2) continue;
              try { outs2[nm2] = this._compileValue(src2, new Set(), vEdge2.fromPin); } catch (err) { /* skip broken chain */ }
            }
            widget.wbOutputs = outs2;
          }
          const _sdWType = String(this.widget?.type ?? "");
          if (_sdWType === "derived" || _sdWType === "calc" || _sdWType === "computed") {
            // Persist the compiled Output value straight into widget.formula so the
            // graph alone drives the widget: no second Save in the config popup needed.
            const valOut = this.nodes.find(n => n.type === "output");
            const vEdge = valOut ? this._incomingEdge(valOut.id, "value") : null;
            const vSrc = vEdge ? this.nodes.find(n => n.id === vEdge.fromNode) : null;
            if (vSrc) {
              try {
                let compiledVal = this._compileValue(vSrc, new Set(), vEdge.fromPin);
                if (typeof compiledVal === "string") {
                  const cs = compiledVal.trim();
                  if (cs.length >= 2 && cs.startsWith(String.fromCharCode(34)) && cs.endsWith(String.fromCharCode(34))) {
                    try { compiledVal = String(JSON.parse(cs)); } catch (err2) { compiledVal = cs.slice(1, -1); }
                  }
                }
                widget.formula = String(compiledVal);
                try { if (this.inputEl) this.inputEl.value = String(compiledVal); } catch (err2) {  }
              } catch (err2) { console.warn("[sd] formula-graph: derived value compile failed", err2); }
            }
          }
          if (this.widget?.type === "attribute") {
            const attrOut = this.nodes.find(n => n.type === "attr_output");
            if (attrOut) {
              const mvEdge = this._incomingEdge(attrOut.id, "modValue");
              const modSrc = mvEdge ? this.nodes.find(n => n.id === mvEdge.fromNode) : null;
              widget.modValueFormula = modSrc ? this._compileValue(modSrc, new Set(), mvEdge.fromPin) : null;
            }
            widget.onClickFormula = this._compileOnClickFormula();
            widget.modFormula = undefined;
            widget.formula    = undefined;
          } else if (this.widget?.type === "skill") {
            const sklOut = this.nodes.find(n => n.type === "skill_output");
            if (sklOut) {
              const mvEdge = this._incomingEdge(sklOut.id, "modValue");
              const modSrc = mvEdge ? this.nodes.find(n => n.id === mvEdge.fromNode) : null;
              widget.modValueFormula = modSrc ? this._compileValue(modSrc, new Set(), mvEdge.fromPin) : null;
            }
            widget.onClickFormula = this._compileOnClickFormula();
          }
        }
        await doc.update({"system.customTabs":tabs});
      }
      return;
    }
    if (this.itemSaveCtx) {
      const {doc} = this.itemSaveCtx;
      const data = {
        nodes: this.nodes.map(n=>({id:n.id,type:n.type,x:n.x,y:n.y,data:{...n.data}})),
        edges: this.edges.map(e=>({id:e.id,fromNode:e.fromNode,fromPin:e.fromPin,toNode:e.toNode,toPin:e.toPin})),
        comments: this.comments.map(c => this._serialiseComment(c))
      };
      const compiled = this.compile();
      await doc.update({"system.onClickGraph": data, "system.onClickFormula": compiled});
      return;
    }
    if (this.sheetTrigger && this.doc) {
      const data = {
        nodes: this.nodes.map(n=>({id:n.id,type:n.type,x:n.x,y:n.y,data:{...n.data}})),
        edges: this.edges.map(e=>({id:e.id,fromNode:e.fromNode,fromPin:e.fromPin,toNode:e.toNode,toPin:e.toPin})),
        comments: this.comments.map(c => this._serialiseComment(c))
      };
      const compiledStr = this.compile();
      let compiledObj = {};
      try { compiledObj = JSON.parse(compiledStr); } catch { compiledObj = {}; }
      const payload = (compiledObj && compiledObj._trigger === "multi")
        ? compiledObj
        : {};
      payload._graphData = data;
      await this.doc.update({ "system.sdTriggerGraph": payload });
    }
  }

  open() {
    // Drop focus from the button that opened the editor (e.g. "Edit graph" in
    // system settings) so Space/Delete/Ctrl+Z immediately work in the editor.
    try { if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) document.activeElement.blur(); } catch {  }
    this._smartIndex = this._buildSmartIndex(); this._buildWin(); this._renderAll(); setTimeout(()=>this._fitView(),120);
  }
  close(options={}) {
    this._cleanup.forEach(fn=>fn());
    this._cleanup = [];
    this._functionManagerApp?.close?.({ sdSkipCallback:true });
    this._functionManagerApp = null;
    this._aiChatApp?.close?.({ sdSkipCallback:true });
    this._aiChatApp = null;
    this._aiChatWin = null;
    const app = this._windowApp;
    this._windowApp = null;
    this.win?.remove();
    this.win = null;
    if (!options.fromHost) app?.close?.({ sdSkipCallback:true });
  }

  _buildSmartIndex() {
    const doc    = this.doc;
    const isItem = doc && !(doc instanceof Actor);
    const actor  = isItem ? (doc.parent ?? doc.actor ?? null) : (doc ?? null);
    const self   = doc ?? null;

    const idx = { slots:[], ownedItems:[], effects:[], widgets:[], invItemSlots:[] };

    const _indexItemSlots = (itemData, displayName, sourceId, depth = 0, slotPath = null) => {
      if (depth > 5) return;
      const defs = itemData?.system?.slotDefinitions ?? [];
      for (const d of defs) {
        const myPath = slotPath != null ? `${slotPath}/${d.id}` : null;
        idx.slots.push({ id: d.id, label: `${d.label || d.id} [${displayName}]`, source: sourceId, slotPath: myPath });
        if (sourceId !== "self" && sourceId !== "actor") {
          idx.invItemSlots.push({ itemId: sourceId, itemName: displayName, itemUuid: itemData.uuid ?? itemData._id, slotId: d.id, slotLabel: d.label || d.id, slotPath: myPath });
        }
        const slotContents = itemData?.system?.slotContents?.[d.id]?.contents ?? [];
        for (const nested of slotContents) {
          const nestedName = `${nested.name ?? "?"} (in ${displayName}/${d.label || d.id})`;
          const nestedId   = nested._id ?? nested.uuid ?? nestedName;
          const nestedPath = (myPath != null ? myPath : `${sourceId}/${d.id}`) + `/${nestedId}`;
          _indexItemSlots(nested, nestedName, nestedId, depth + 1, nestedPath);
        }
      }
    };

    const selfPathRoot = (self && !(self instanceof Actor) && self.id) ? self.id : null;
    _indexItemSlots(self, "self", "self", 0, selfPathRoot);

    if (actor && actor !== self) {
      _indexItemSlots(actor, "actor", "actor", 0, null);
    }

    for (const item of (actor?.items ?? [])) {
      _indexItemSlots(item, item.name, item.id, 0, item.id);
    }

    const seenSlots = new Set();
    idx.slots = idx.slots.filter(s => { const k=`${s.source}:${s.id}`; if(seenSlots.has(k)) return false; seenSlots.add(k); return true; });

    for (const item of (actor?.items ?? [])) {
      idx.ownedItems.push({ id: item.id, name: item.name, uuid: item.uuid, type: item.type });
    }
    idx.ownedItems.sort((a,b) => a.name.localeCompare(b.name));

    const effectSrc = actor ?? self;
    for (const fx of (effectSrc?.effects ?? [])) {
      idx.effects.push({ name: fx.name, uuid: fx.uuid, id: fx.id });
    }

    for (const item of (actor?.items ?? [])) {
      for (const fx of (item.effects ?? [])) {
        if (!idx.effects.find(e => e.uuid === fx.uuid))
          idx.effects.push({ name: `${fx.name} [${item.name}]`, uuid: fx.uuid, id: fx.id });
      }
    }

    const _collectWidgets = (list) => {
      if (!Array.isArray(list)) return;
      for (const w of list) {
        if (!w) continue;
        if (w.widgetKey) idx.widgets.push({ key: w.widgetKey, label: `${w.label || w.type} (${w.widgetKey})`, type: w.type });
        if (Array.isArray(w.widgets)) _collectWidgets(w.widgets);
        if (Array.isArray(w.elements)) _collectWidgets(w.elements.map(el => el?.widget).filter(Boolean));
      }
    };
    const _indexDoc = (d) => {
      const tabs = d?.system?.customTabs ?? [];
      for (const tab of tabs) for (const row of (tab.rows ?? [])) _collectWidgets(row.widgets);
    };
    _indexDoc(self);
    if (actor && actor !== self) _indexDoc(actor);
    for (const item of (actor?.items ?? [])) _indexDoc(item);

    return idx;
  }

  _slotsForItem(itemId) {
    if (!itemId) return this._smartIndex?.slots ?? [];
    if (itemId === "self" || itemId === "actor") return (this._smartIndex?.slots ?? []).filter(s => s.source === itemId);
    return (this._smartIndex?.invItemSlots ?? []).filter(s => s.itemId === itemId).map(s => ({ id: s.slotId, label: s.slotLabel, source: itemId }));
  }

  _compileEntryActions(entry, exitPin = "exec") {
    if (!entry) return [];
    const actions = [];
    const edges = this.edges.filter(edge => edge.fromNode === entry.id && edge.fromPin === exitPin);
    for (const edge of edges) {
      try {
        const branch = JSON.parse(this._compileExecChain(edge.toNode));
        if (Array.isArray(branch)) actions.push(...branch);
      } catch {}
    }
    return actions;
  }

  _compileOnClickFormula() {
    const actions = [];
    for (const trigger of this.nodes.filter(node => node.type === "on_click")) {
      actions.push(...this._compileEntryActions(trigger));
    }
    return actions.length ? JSON.stringify(actions) : null;
  }

  compile() {
    const valOut = this.nodes.find(n=>n.type==="attr_output" || n.type==="skill_output");
    if (valOut) {
      const mvEdge = this._incomingEdge(valOut.id, "modValue");
      if (mvEdge) {
        const modSrc = this.nodes.find(n=>n.id===mvEdge.fromNode);
        if (modSrc) return this._compileValue(modSrc, new Set(), mvEdge.fromPin);
      }
      return "0";
    }

    const initOut = this.nodes.find(n=>n.type==="init_output");
    if (initOut) {
      const vEdge = this._incomingEdge(initOut.id, "value");
      if (vEdge) {
        const src = this.nodes.find(n=>n.id===vEdge.fromNode);
        return src ? this._compileValue(src, new Set(), vEdge.fromPin) : "0";
      }
      return "0";
    }

    const numberOut = this.nodes.find(n=>n.type==="number_output");
    if (numberOut) {
      const compilePin = (pin, fallback = "") => {
        const edge = this._incomingEdge(numberOut.id, pin);
        if (!edge) return fallback;
        const src = this.nodes.find(n=>n.id===edge.fromNode);
        return src ? this._compileValue(src, new Set(), edge.fromPin) : fallback;
      };
      return JSON.stringify({
        min:  compilePin("min", ""),
        max:  compilePin("max", ""),
        step: compilePin("step", "1")
      });
    }

    const triggerNodes = this.nodes.filter(n=>n.type==="on_click");
    const eventNodes = this.nodes.filter(n => NODE_DEFS[n.type]?.isEvent);
    if (triggerNodes.length || eventNodes.length) {
      const triggers = {};
      const _chainFor = (entry) => this._compileEntryActions(entry);
      for (const trigger of triggerNodes) {
        const actions = _chainFor(trigger);
        if (!actions?.length) continue;
        if (!Array.isArray(triggers.onClick)) triggers.onClick = [];
        triggers.onClick.push(...actions);
      }
      const _dynHook = (ev) => {
        if (ev.type !== "on_event") return NODE_DEFS[ev.type]?.eventHook;
        const EVENT_HOOK_MAP = {
          create:       "createDocument",
          update:       "updateDocument",
          delete:       "deleteDocument",
          turnStart:    "combatTurnStart",
          turnEnd:      "combatTurnEnd",
          combatStart:  "combatEncounterStart",
          combatEnd:    "combatEncounterEnd",
          damageTaken:  "hpDecrease",
          rest:         "restFlag",
          equip:        "itemEquipped",
          unequip:      "itemUnequipped",
          effectApply:  "createActiveEffect",
          cardDrawn:    "cardDrawn"
        };
        return EVENT_HOOK_MAP[ev.data?.event ?? "update"] ?? "updateDocument";
      };
      for (const ev of eventNodes) {
        const actions = _chainFor(ev);
        if (!actions?.length) continue;
        const key = `${ev.type}::${ev.id}`;
        triggers[key] = { hook: _dynHook(ev), data: ev.data ?? {}, actions };
      }
      const macroInputs = this.nodes.filter(n => NODE_DEFS[n.type]?.isMacroInput);
      const macros = {};
      for (const mi of macroInputs) {
        const mid = mi.data?.macroId?.trim();
        if (!mid) continue;
        macros[mid] = this._compileEntryActions(mi);
      }

      if (Object.keys(triggers).length) {
        const onlyOnClick = Object.keys(triggers).length === 1 && triggers.onClick;
        const hasMacros   = Object.keys(macros).length > 0;
        if (onlyOnClick && !hasMacros) {
          if (this.saveCtx) return JSON.stringify(triggers.onClick);
          return JSON.stringify({ _trigger: "onClick", actions: triggers.onClick });
        }
        const payload = { _trigger: "multi", _events: triggers };
        if (hasMacros) payload._macros = macros;
        return JSON.stringify(payload);
      }
      if (Object.keys(macros).length) {
        return JSON.stringify({ _trigger: "macrosOnly", _macros: macros });
      }
    }

    const out = this.nodes.find(n=>n.type==="output");
    if (!out) return "0";
    const vEdge = this._incomingEdge(out.id, "value");
    if (vEdge) {
      const src = this.nodes.find(n=>n.id===vEdge.fromNode);
      return src ? this._compileValue(src,new Set(),vEdge.fromPin) : "0";
    }
    const xEdges = this.edges.filter(e=>e.toNode===out.id&&e.toPin==="exec");
    if (xEdges.length) {
      if (xEdges.length === 1) {
        const chainStart = this._findExecChainStart(xEdges[0].fromNode);
        return this._compileExecChain(chainStart);
      }
      const allActions = [];
      const seenStarts = new Set();
      for (const xe of xEdges) {
        const chainStart = this._findExecChainStart(xe.fromNode);
        if (seenStarts.has(chainStart)) continue;
        seenStarts.add(chainStart);
        try { allActions.push(...JSON.parse(this._compileExecChain(chainStart))); } catch {}
      }
      return JSON.stringify(allActions);
    }

    return "0";
  }

  _compileValue(node, vis, fromPin = null) {
    if (vis.has(node.id)) return "0";
    const v2 = new Set(vis); v2.add(node.id);
    const def = NODE_DEFS[node.type];

    if (def?.isFunctionInputs) {
      const v = this._funcInputsOverlay?.[fromPin];
      return v !== undefined && v !== null && v !== "" ? String(v) : "0";
    }
    if (def?.isFunctionCall) {
      return this._compileFunctionValue(node, fromPin);
    }

    if (def?.isEvent) return EVENT_PIN_TOKENS[node.type]?.[fromPin] ?? "0";
    if (def?.isMacroInput) return `{__macroArg:${fromPin ?? "a"}}`;
    if (typeof def?.dynamicBranchToken === "function") {
      const token = def.dynamicBranchToken(node, fromPin);
      if (token != null) return token;
    }
    if (def?.isAttackBranch || def?.isBranch || def?.isSaveBranch || def?.isTieredBranch || def?.isGenericBranch || def?.isProgressionBranch || def?.isAoeSave || def?.isAiBranch) {

      if (typeof def.dynamicBranchToken === "function") {
        const tok = def.dynamicBranchToken(node, fromPin);
        if (tok != null) return tok;
      }
      return BRANCH_PIN_TOKENS[node.type]?.[fromPin] ?? "0";
    }
    if (BRANCH_PIN_TOKENS[node.type]?.[fromPin]) {
      return BRANCH_PIN_TOKENS[node.type][fromPin];
    }
    if (!def||def.isAction) return "0";

    const ins = {};
    for (const pin of (def.inputs??[])) {
      if (pin.type==="exec") continue;
      const e = this._incomingEdge(node.id, pin.id);
      if (e) { const s=this.nodes.find(n=>n.id===e.fromNode); if(s) ins[pin.id]=this._compileValue(s,v2,e.fromPin); }
    }
    if (def.dynamicPins) {
      const groups = Array.isArray(def.dynamicPins) ? def.dynamicPins : [def.dynamicPins];
      for (const grp of groups) {
        const {base, max} = grp;
        for (let i=0;i<max;i++) {
          const pinId=`${base}${i}`;
          const e=this._incomingEdge(node.id, pinId);
          if(e){ const s=this.nodes.find(n=>n.id===e.fromNode); if(s) ins[pinId]=this._compileValue(s,v2,e.fromPin); }
        }
      }
    }
    if (def.compilePin) return def.compilePin(node, ins, fromPin);
    return def.compile?.(node,ins)??"0";
  }

  _findExecChainStart(nodeId) {
    const visited = new Set();
    let current = nodeId;
    while (current && !visited.has(current)) {
      visited.add(current);
      const prevEdges = this._incomingEdges(current, "exec");
      if (prevEdges.length !== 1) break;
      const prevEdge = prevEdges[0];
      if (!prevEdge) break;
      const prevNode = this.nodes.find(n => n.id === prevEdge.fromNode);
      if (!prevNode) break;
      if (NODE_DEFS[prevNode.type]?.isTrigger) break;
      current = prevEdge.fromNode;
    }
    return current;
  }

  _compileExecChain(startNodeId, startPin) {
    const actions = [];
    const _walk = (nodeId, vis=new Set()) => {
      if (!nodeId||vis.has(nodeId)) return;
      vis.add(nodeId);
      const node = this.nodes.find(n=>n.id===nodeId);
      if (!node) return;
      const def  = NODE_DEFS[node.type];
      if (!def) return;

      if (def.isFunctionOutputs) return;

      if (def.isFunctionCall) {
        const innerActions = this._inlineFunctionExec(node);
        if (Array.isArray(innerActions) && innerActions.length) actions.push(...innerActions);
        const outEdge = this.edges.find(e => e.fromNode === node.id && e.fromPin === "_exec");
        if (outEdge) _walk(outEdge.toNode, vis);
        return;
      }

      if (def.isIfCompare) {
        const ins = {};
        for (const pin of (def.inputs ?? [])) {
          if (pin.type === "exec") continue;
          const e = this._incomingEdge(node.id, pin.id);
          if (e) {
            const s = this.nodes.find(n => n.id === e.fromNode);
            if (s) ins[pin.id] = this._compileValue(s, new Set(), e.fromPin);
          }
        }
        const cond = def.condition?.(node, ins) ?? "0";
        const trueEdge = this.edges.find(e => e.fromNode === node.id && e.fromPin === "exec");
        const before = [...actions];
        if (trueEdge) _walk(trueEdge.toNode, new Set(vis));
        const trueActions = actions.splice(before.length);
        actions.push({ type: "branch", condition: cond, trueActions, falseActions: [] });
        return;
      }

      if (def.isBranch) {
        const condEdge = this._incomingEdge(node.id, "cond");
        const condNode = condEdge ? this.nodes.find(n=>n.id===condEdge.fromNode) : null;
        const cond     = condNode ? this._compileValue(condNode,new Set(),condEdge.fromPin) : "1";

        const trueEdge  = this.edges.find(e=>e.fromNode===node.id&&e.fromPin==="true");
        const falseEdge = this.edges.find(e=>e.fromNode===node.id&&e.fromPin==="false");

        const trueBefore = [...actions];
        if (trueEdge) _walk(trueEdge.toNode, new Set(vis));
        const trueActions = actions.splice(trueBefore.length);

        if (falseEdge) _walk(falseEdge.toNode, new Set(vis));
        const falseActions = actions.splice(trueBefore.length);

        actions.push({type:"branch",condition:cond,trueActions,falseActions});
        return;
      }

      if (def.isSwitch) {
        const valEdge = this._incomingEdge(node.id, "value");
        const valNode = valEdge ? this.nodes.find(n=>n.id===valEdge.fromNode) : null;
        const value   = valNode ? this._compileValue(valNode, new Set(), valEdge.fromPin) : (node.data?.value ?? "0");

        const cases = [node.data?.case0 ?? "0", node.data?.case1 ?? "1", node.data?.case2 ?? "2"];
        const act = {
          type: "switchExec",
          value,
          cases,
          matchMode: node.data?.matchMode ?? "smart"
        };

        const caseOutputs = ["case0", "case1", "case2", "default"];
        for (const outPin of caseOutputs) {
          const edge = this.edges.find(e=>e.fromNode===node.id&&e.fromPin===outPin);
          const before = [...actions];
          if (edge) _walk(edge.toNode, new Set(vis));
          const key = outPin === "default" ? "defaultActions" : `${outPin}Actions`;
          act[key] = actions.splice(before.length);
        }

        actions.push(act);
        return;
      }

      if (def.isLoop) {
        const ins = {};
        for (const pin of (def.inputs ?? [])) {
          if (pin.type === "exec") continue;
          const e = this._incomingEdge(node.id, pin.id);
          if (e) { const s=this.nodes.find(n=>n.id===e.fromNode); if(s) ins[pin.id]=this._compileValue(s,new Set(),e.fromPin); }
        }
        const loopEdge = this.edges.find(e=>e.fromNode===node.id&&e.fromPin==="loop");
        const doneEdge = this.edges.find(e=>e.fromNode===node.id&&e.fromPin==="done");

        const before = [...actions];
        if (loopEdge) _walk(loopEdge.toNode, new Set(vis));
        const loopActions = actions.splice(before.length);

        if (doneEdge) _walk(doneEdge.toNode, new Set(vis));
        const doneActions = actions.splice(before.length);

        const act = def.toAction?.(node, ins) ?? {type:"forEachTarget"};
        actions.push({...act, loopActions, doneActions});
        return;
      }

      if (def.isGenericBranch) {
        const ins = {};
        for (const pin of (def.inputs ?? [])) {
          if (pin.type === "exec") continue;
          const e = this._incomingEdge(node.id, pin.id);
          if (e) { const s=this.nodes.find(n=>n.id===e.fromNode); if (s) ins[pin.id]=this._compileValue(s,new Set(),e.fromPin); }
        }
        const act = def.toAction?.(node, ins) ?? {};
        const _outs = def.computeDynamicOutputs ? def.computeDynamicOutputs(node) : (def.outputs ?? []);
        for (const pin of _outs) {
          if (pin.type !== "exec") continue;
          const edge = this.edges.find(e=>e.fromNode===node.id&&e.fromPin===pin.id);
          const before = [...actions];
          if (edge) _walk(edge.toNode, new Set(vis));
          act[`${pin.id}Actions`] = actions.splice(before.length);
        }
        actions.push(act);
        return;
      }

      if (def.isProgressionBranch) {
        const pInp = {};
        for (const pin of (def.inputs ?? [])) {
          if (pin.type === "exec") continue;
          const e = this._incomingEdge(node.id, pin.id);
          if (e) { const s=this.nodes.find(n=>n.id===e.fromNode); if(s) pInp[pin.id]=this._compileValue(s,new Set(),e.fromPin); }
        }
        const hiEdge  = this.edges.find(e=>e.fromNode===node.id&&e.fromPin==="higher");
        const loEdge  = this.edges.find(e=>e.fromNode===node.id&&e.fromPin==="lower");
        const eqEdge  = this.edges.find(e=>e.fromNode===node.id&&e.fromPin==="equal");
        const nhEdge  = this.edges.find(e=>e.fromNode===node.id&&e.fromPin==="noHistory");

        const act = def.toAction?.(node, pInp) ?? {};
        const before = [...actions];
        if (hiEdge) _walk(hiEdge.toNode, new Set(vis));
        act.higherActions   = actions.splice(before.length);
        if (loEdge) _walk(loEdge.toNode, new Set(vis));
        act.lowerActions    = actions.splice(before.length);
        if (eqEdge) _walk(eqEdge.toNode, new Set(vis));
        act.equalActions    = actions.splice(before.length);
        if (nhEdge) _walk(nhEdge.toNode, new Set(vis));
        act.noHistoryActions= actions.splice(before.length);
        actions.push(act);
        return;
      }

      if (def.isAoeSave) {
        const saveInp = {};
        for (const pin of (def.inputs ?? [])) {
          if (pin.type === "exec") continue;
          const e = this._incomingEdge(node.id, pin.id);
          if (e) { const s=this.nodes.find(n=>n.id===e.fromNode); if(s) saveInp[pin.id]=this._compileValue(s,new Set(),e.fromPin); }
        }
        const act = def.toAction?.(node, saveInp) ?? {};
        const execEdge = this.edges.find(e=>e.fromNode===node.id&&e.fromPin==="exec");
        const before = [...actions];
        if (execEdge) _walk(execEdge.toNode, new Set(vis));
        act.postActions = actions.splice(before.length);
        actions.push(act);
        return;
      }

      if (def.isSaveBranch) {
        const saveInp = {};
        for (const pin of (def.inputs ?? [])) {
          if (pin.type === "exec") continue;
          const e = this._incomingEdge(node.id, pin.id);
          if (e) { const s=this.nodes.find(n=>n.id===e.fromNode); if(s) saveInp[pin.id]=this._compileValue(s,new Set(),e.fromPin); }
        }

        const failEdge = this.edges.find(e=>e.fromNode===node.id&&e.fromPin==="fail");
        const passEdge = this.edges.find(e=>e.fromNode===node.id&&e.fromPin==="pass");
        const wonEdge  = this.edges.find(e=>e.fromNode===node.id&&e.fromPin==="youWon");
        const lostEdge = this.edges.find(e=>e.fromNode===node.id&&e.fromPin==="youLost");

        const act = def.toAction?.(node, saveInp) ?? {};

        const before = [...actions];
        if (failEdge) _walk(failEdge.toNode, new Set(vis));
        act.failActions = actions.splice(before.length);

        if (passEdge) _walk(passEdge.toNode, new Set(vis));
        act.passActions = actions.splice(before.length);

        if (wonEdge)  _walk(wonEdge.toNode,  new Set(vis));
        act.wonActions  = actions.splice(before.length);

        if (lostEdge) _walk(lostEdge.toNode, new Set(vis));
        act.lostActions = actions.splice(before.length);

        actions.push(act);
        return;
      }

      if (def.isConsumeSlot) {
        const levelEdge = this._incomingEdge(node.id, "level");
        const levelNode = levelEdge ? this.nodes.find(n=>n.id===levelEdge.fromNode) : null;
        const levelVal  = levelNode ? this._compileValue(levelNode, new Set(), levelEdge.fromPin) : null;

        const okEdge    = this.edges.find(e=>e.fromNode===node.id&&e.fromPin==="ok");
        const emptyEdge = this.edges.find(e=>e.fromNode===node.id&&e.fromPin==="empty");

        const act = def.toAction?.(node, levelVal !== null ? {level: levelVal} : {}) ?? {};

        const before = [...actions];
        if (okEdge)    _walk(okEdge.toNode,    new Set(vis));
        act.okActions    = actions.splice(before.length);

        if (emptyEdge) _walk(emptyEdge.toNode, new Set(vis));
        act.emptyActions = actions.splice(before.length);

        actions.push(act);
        return;
      }

      if (def.isRemoveFromInvSlot) {
        const ins = {};
        for (const pin of (def.inputs ?? [])) {
          if (pin.type === "exec") continue;
          const e = this._incomingEdge(node.id, pin.id);
          if (e) { const s=this.nodes.find(n=>n.id===e.fromNode); if(s) ins[pin.id]=this._compileValue(s,new Set(),e.fromPin); }
        }

        const doneEdge  = this.edges.find(e=>e.fromNode===node.id&&e.fromPin==="exec");
        const emptyEdge = this.edges.find(e=>e.fromNode===node.id&&e.fromPin==="empty");

        const act = def.toAction?.(node, ins) ?? {};

        const before = [...actions];
        if (doneEdge)  _walk(doneEdge.toNode,  new Set(vis));
        act.doneActions  = actions.splice(before.length);

        if (emptyEdge) _walk(emptyEdge.toNode, new Set(vis));
        act.emptyActions = actions.splice(before.length);

        actions.push(act);
        return;
      }

      if (def.isAddToInvSlot) {
        const ins = {};
        for (const pin of (def.inputs ?? [])) {
          if (pin.type === "exec") continue;
          const e = this._incomingEdge(node.id, pin.id);
          if (e) { const s=this.nodes.find(n=>n.id===e.fromNode); if(s) ins[pin.id]=this._compileValue(s,new Set(),e.fromPin); }
        }

        const doneEdge  = this.edges.find(e=>e.fromNode===node.id&&e.fromPin==="exec");
        const fullEdge  = this.edges.find(e=>e.fromNode===node.id&&e.fromPin==="full");

        const act = def.toAction?.(node, ins) ?? {};

        const before = [...actions];
        if (doneEdge) _walk(doneEdge.toNode, new Set(vis));
        act.doneActions = actions.splice(before.length);

        if (fullEdge)  _walk(fullEdge.toNode, new Set(vis));
        act.fullActions = actions.splice(before.length);

        actions.push(act);
        return;
      }

      if (def.isRollTableBranch) {
        const ins = {};
        for (const pin of (def.inputs ?? [])) {
          if (pin.type === "exec") continue;
          const e = this._incomingEdge(node.id, pin.id);
          if (e) { const s=this.nodes.find(n=>n.id===e.fromNode); if(s) ins[pin.id]=this._compileValue(s,new Set(),e.fromPin); }
        }
        const act = def.toAction?.(node, ins) ?? {};

        const foundEdge = this.edges.find(e=>e.fromNode===node.id&&e.fromPin==="found");
        const emptyEdge = this.edges.find(e=>e.fromNode===node.id&&e.fromPin==="empty");

        const before = [...actions];
        if (foundEdge) _walk(foundEdge.toNode, new Set(vis));
        act.foundActions = actions.splice(before.length);

        if (emptyEdge) _walk(emptyEdge.toNode, new Set(vis));
        act.emptyActions = actions.splice(before.length);

        actions.push(act);
        return;
      }

      if (def.isTieredBranch) {
        const ins = {};
        for (const pin of (def.inputs ?? [])) {
          if (pin.type === "exec") continue;
          const e = this._incomingEdge(node.id, pin.id);
          if (e) { const s=this.nodes.find(n=>n.id===e.fromNode); if(s) ins[pin.id]=this._compileValue(s,new Set(),e.fromPin); }
        }
        const act = def.toAction?.(node, ins) ?? {};

        const tierPins = ["tier0","tier1","tier2","tier3"];
        const tierActions = [];
        for (const pin of tierPins) {
          const edge   = this.edges.find(e=>e.fromNode===node.id&&e.fromPin===pin);
          const before = [...actions];
          if (edge) _walk(edge.toNode, new Set(vis));
          tierActions.push(actions.splice(before.length));
        }
        act.tierActions = tierActions;

        actions.push(act);
        return;
      }

      if (def.isAiBranch) {
        const ins = {};
        for (const pin of (def.inputs ?? [])) {
          if (pin.type === "exec") continue;
          const e = this._incomingEdge(node.id, pin.id);
          if (e) { const s=this.nodes.find(n=>n.id===e.fromNode); if(s) ins[pin.id]=this._compileValue(s,new Set(),e.fromPin); }
        }
        const act = def.toAction?.(node, ins) ?? {};

        const doneEdge  = this.edges.find(e=>e.fromNode===node.id&&e.fromPin==="exec");
        const errorEdge = this.edges.find(e=>e.fromNode===node.id&&e.fromPin==="error");

        const before = [...actions];
        if (doneEdge)  _walk(doneEdge.toNode,  new Set(vis));
        act.successActions = actions.splice(before.length);

        if (errorEdge) _walk(errorEdge.toNode, new Set(vis));
        act.errorActions = actions.splice(before.length);

        actions.push(act);
        return;
      }

      if (def.isAttackBranch) {
        const ins = {};
        for (const pin of (def.inputs??[])) {
          if (pin.type==="exec") continue;
          const e = this._incomingEdge(node.id, pin.id);
          if (e) { const s=this.nodes.find(n=>n.id===e.fromNode); if(s) ins[pin.id]=this._compileValue(s,new Set(),e.fromPin); }
        }
        const act = def.toAction?.(node, ins) ?? {};

        const hitEdge  = this.edges.find(e=>e.fromNode===node.id&&e.fromPin==="hit");
        const missEdge = this.edges.find(e=>e.fromNode===node.id&&e.fromPin==="miss");
        const critEdge = this.edges.find(e=>e.fromNode===node.id&&e.fromPin==="crit");

        const before = [...actions];
        if (hitEdge)  _walk(hitEdge.toNode,  new Set(vis));
        act.hitActions  = actions.splice(before.length);

        if (missEdge) _walk(missEdge.toNode, new Set(vis));
        act.missActions = actions.splice(before.length);

        if (critEdge) _walk(critEdge.toNode, new Set(vis));
        act.critActions = actions.splice(before.length);

        actions.push(act);
        return;
      }

      if (node.type==="sequence") {
        const count = Math.max(2, Math.min(12, parseInt(node.data?.count) || 2));
        for (let i=0; i<count; i++) {
          const e = this.edges.find(edge=>edge.fromNode===node.id&&edge.fromPin===`a${i}`);
          if (e) _walk(e.toNode, new Set(vis));
        }
        return;
      }
      if (node.type==="sequence4") {
        for (const pin of ["a","b","c","d"]) {
          const e = this.edges.find(edge=>edge.fromNode===node.id&&edge.fromPin===pin);
          if (e) _walk(e.toNode, new Set(vis));
        }
        return;
      }

      if (def.isAction) {
        const ins = {};
        for (const pin of (def.inputs??[])) {
          if (pin.type==="exec") continue;
          const e = this._incomingEdge(node.id, pin.id);
          if (e) { const s=this.nodes.find(n=>n.id===e.fromNode); if(s) ins[pin.id]=this._compileValue(s,new Set(),e.fromPin); }
        }
        if (def.dynamicPins) {
          const groups = Array.isArray(def.dynamicPins) ? def.dynamicPins : [def.dynamicPins];
          for(const grp of groups) {
            const {base, max} = grp;
            for(let i=0;i<max;i++){
              const pinId=`${base}${i}`;
              const e=this._incomingEdge(node.id, pinId);
              if(e){ const s=this.nodes.find(n=>n.id===e.fromNode); if(s) ins[pinId]=this._compileValue(s,new Set(),e.fromPin); }
            }
          }
        }
        const act = def.toAction?.(node,ins);
        if (act) actions.push(act);

        const outEdge = this.edges.find(e=>e.fromNode===node.id&&e.fromPin==="exec");
        if (outEdge) _walk(outEdge.toNode, vis);
      }
    };
    _walk(startNodeId);
    return JSON.stringify(actions);
  }

  _updatePreview() {
    const f = this.compile();
    if (!this.win) return;
    this.win.querySelector("#gpreview").textContent = f || "-";

    this._buildVarPanel();

    this.nodesEl?.querySelectorAll("[data-nid]").forEach(el => {
      if (typeof el._refreshAttrCard === "function") el._refreshAttrCard();
    });

    const liveTargetNode = this.nodes.find(n => n.type === "output" || n.type === "attr_output" || n.type === "skill_output");
    if (liveTargetNode) {
      const outEl = this.nodesEl?.querySelector(`[data-nid="${liveTargetNode.id}"]`);
      if (outEl) {
        let liveEl = outEl.querySelector(".gn-live-val");
        if (!liveEl) {
          liveEl = document.createElement("div");
          liveEl.className = "gn-live-val";
          liveEl.style.cssText = "padding:3px 8px 4px;border-top:1px solid var(--sd-graph-live-border,#1a1a30);font-size:10px;font-family:monospace;color:var(--sd-graph-live-text,var(--sd-success));word-break:break-all;white-space:pre-wrap;background:var(--sd-graph-live-bg,#060610);border-radius:0 0 5px 5px";
          outEl.appendChild(liveEl);
        }
        let liveText = f || "-";
        if (this.doc && f && f !== "0") {
          try {
            const resolved = f.replace(/\{([^}]+)\}/g, (_, p) => {
              let v = foundry.utils.getProperty(this.doc, p);
              if (v && typeof v === "object" && "value" in v && typeof v.value !== "object") v = v.value;
              if (v === undefined || v === null) return "0";
              if (typeof v === "object") return "0";
              return String(v);
            });
            liveText = `${f}\n-> ${resolved}`;
          } catch {  }
        }
        liveEl.textContent = liveText;
      }
    }

    const badge = this.win.querySelector("#gmode-badge");
    if (!badge) return;
    const hasAttrOut  = this.nodes.some(n=>n.type==="attr_output");
    const hasSkillOut = this.nodes.some(n=>n.type==="skill_output");
    const hasOnClick  = this.nodes.some(n=>n.type==="on_click");
    const hasOutput   = this.nodes.some(n=>n.type==="output");
    if (hasAttrOut) {
      badge.style.display = "block";
      badge.style.color   = "#e8c060";
      badge.style.borderColor = "#7a4a1a";
      badge.textContent   = "OK Attribute graph - wire modValue (display) + On Click exec chain";
    } else if (hasSkillOut) {
      badge.style.display = "block";
      badge.style.color   = "#60c0e8";
      badge.style.borderColor = "#1a4a7a";
      badge.textContent   = "OK Skill graph - wire modValue (display) + On Click exec chain";
    } else if (hasOnClick) {
      badge.style.display = "block";
      badge.style.color   = "#5ae07a";
      badge.style.borderColor = "#1a5c2a";
      badge.textContent   = "OK Exec graph (On Click) - Output node not required";
    } else if (hasOutput) {
      badge.style.display = "block";
      badge.style.color   = "var(--sd-accent)";
      badge.style.borderColor = "#534AB7";
      badge.textContent   = "OK Formula graph - connect a node to Output";
    } else {
      badge.style.display = "none";
    }
  }

  _buildVarPanel() {
    const panel = this.win?.querySelector("#gvarpanel");
    if (!panel) return;

    const vars   = new Map();
    const macros = new Map();

    for (const n of this.nodes) {
      if (["var_read", "var_get", "get_var"].includes(n.type)) {
        const scope = n.type === "get_var" ? "actor" : (n.type === "var_get" ? "local" : String(n.data?.scope ?? "local"));
        const name = String(n.data?.name ?? "").trim() || "(unnamed)";
        const k = `${scope}: ${name}`;
        const rec = vars.get(k) ?? { nodes: [], hasSet:false, hasGet:false };
        rec.nodes.push(n.id); rec.hasGet = true;
        vars.set(k, rec);
      } else if (["var_write", "var_set", "act_set_var"].includes(n.type)) {
        const scope = n.type === "act_set_var" ? String(n.data?.scope ?? "actor") : (n.type === "var_set" ? "local" : String(n.data?.scope ?? "local"));
        const name = String(n.data?.name ?? "").trim() || "(unnamed)";
        const k = `${scope}: ${name}`;
        const rec = vars.get(k) ?? { nodes: [], hasSet:false, hasGet:false };
        rec.nodes.push(n.id); rec.hasSet = true;
        vars.set(k, rec);
      } else if (n.type === "macro_input") {
        const k = (n.data?.macroId ?? n.data?.id ?? "").trim() || "(unnamed)";
        const rec = macros.get(k) ?? { nodes: [], hasInput:false, hasCall:false };
        rec.nodes.push(n.id); rec.hasInput = true;
        macros.set(k, rec);
      } else if (n.type === "macro_call") {
        const k = (n.data?.macroId ?? "").trim() || "(unnamed)";
        const rec = macros.get(k) ?? { nodes: [], hasInput:false, hasCall:false };
        rec.nodes.push(n.id); rec.hasCall = true;
        macros.set(k, rec);
      }
    }

    const esc = s => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
    const sectionHeader = (label, count) => `
      <div style="padding:6px 10px;font-size:9px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--sd-accent);border-bottom:1px solid rgba(116,167,255,.15);background:rgba(116,167,255,.04);display:flex;align-items:center;gap:6px">
        <span style="flex:1">${label}</span>
        <span style="opacity:.55;font-weight:400">${count}</span>
      </div>`;

    const varRows = [...vars.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([name, rec]) => {
      const badges = [];
      if (rec.hasSet) badges.push(`<span title="Set here" style="font-size:8px;background:#e0a02033;color:#e0a020;border-radius:3px;padding:0 4px;font-weight:700">SET</span>`);
      if (rec.hasGet) badges.push(`<span title="Read here" style="font-size:8px;background:#5ae07a33;color:#5ae07a;border-radius:3px;padding:0 4px;font-weight:700">GET</span>`);
      if (!rec.hasSet) badges.push(`<span title="No setter" style="font-size:8px;background:#e0505033;color:#e05050;border-radius:3px;padding:0 4px;font-weight:700">!</span>`);
      return `<div class="gvar-row" data-nid="${esc(rec.nodes[0])}" style="padding:5px 10px;font-family:monospace;font-size:10px;display:flex;align-items:center;gap:5px;cursor:pointer;border-bottom:1px solid var(--sd-border);transition:background .1s" onmouseover="this.style.background='rgba(116,167,255,.08)'" onmouseout="this.style.background='transparent'">
        <span style="flex:1;color:#e0e0f0">${esc(name)}</span>
        ${badges.join("")}
      </div>`;
    }).join("");

    const macroRows = [...macros.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([id, rec]) => {
      const badges = [];
      if (rec.hasInput) badges.push(`<span title="Defined here" style="font-size:8px;background:#1a8a4a33;color:#5ae09a;border-radius:3px;padding:0 4px;font-weight:700">DEF</span>`);
      if (rec.hasCall)  badges.push(`<span title="Called here" style="font-size:8px;background:#5a9ae033;color:var(--sd-accent);border-radius:3px;padding:0 4px;font-weight:700">CALL</span>`);
      if (rec.hasCall && !rec.hasInput) badges.push(`<span title="Missing definition" style="font-size:8px;background:#e0505033;color:#e05050;border-radius:3px;padding:0 4px;font-weight:700">!</span>`);
      return `<div class="gvar-row" data-nid="${esc(rec.nodes[0])}" style="padding:5px 10px;font-family:monospace;font-size:10px;display:flex;align-items:center;gap:5px;cursor:pointer;border-bottom:1px solid var(--sd-border);transition:background .1s" onmouseover="this.style.background='rgba(26,138,74,.12)'" onmouseout="this.style.background='transparent'">
        <span style="flex:1;color:#e0e0f0">${esc(id)}</span>
        ${badges.join("")}
      </div>`;
    }).join("");

    panel.innerHTML = `
      ${sectionHeader("Variables", vars.size)}
      ${varRows || `<div style="padding:10px;font-size:10px;color:var(--sd-text-3);font-style:italic">No variables. Use Read Variable and Write Variable.</div>`}
      ${sectionHeader("Macros", macros.size)}
      ${macroRows || `<div style="padding:10px;font-size:10px;color:var(--sd-text-3);font-style:italic">No macros. Use <b>macro_input</b> (define) / <b>macro_call</b> (invoke).</div>`}
    `;

    panel.querySelectorAll(".gvar-row").forEach(row => {
      row.addEventListener("click", () => {
        const nid  = row.dataset.nid;
        const node = this.nodes.find(n => n.id === nid);
        const el   = this.nodesEl?.querySelector(`[data-nid="${nid}"]`);
        if (!el || !node) return;
        const wrap = this.win?.querySelector("#gwrap");
        if (wrap) {
          const w = (el.offsetWidth  || 180) * this._zoom;
          const h = (el.offsetHeight || 80)  * this._zoom;
          this._pan.x = wrap.clientWidth  / 2 - node.x * this._zoom - w / 2;
          this._pan.y = wrap.clientHeight / 2 - node.y * this._zoom - h / 2;
          this._applyTransform();
          this._scheduleEdges?.();
        }
        el.style.boxShadow = "0 0 0 2px var(--sd-accent), 0 0 24px var(--sd-accent-dim)";
        setTimeout(() => { el.style.boxShadow = ""; }, 1200);
      });
    });
  }

  _buildWin() {
    this.win?.remove();
    const win = document.createElement("div");
    win.id = "sd-formula-graph-win";
    win.classList.add("sd", "sd-formula-graph", "sd-formula-graph-host");
    try {
      const themeAttr = document.documentElement?.getAttribute?.("data-sd-theme")
        || document.body?.getAttribute?.("data-sd-theme")
        || "default";
      win.setAttribute("data-sd-theme", themeAttr);
      const fxAttr = document.documentElement?.getAttribute?.("data-sd-theme-fx")
        || document.body?.getAttribute?.("data-sd-theme-fx")
        || "";
      if (fxAttr) win.setAttribute("data-sd-theme-fx", fxAttr);
    } catch {  }
    {
      const _w = Math.min(1180, Math.floor(window.innerWidth * 0.97));
      const _h = Math.min(720, Math.floor(window.innerHeight * 0.93));
      const _l = Math.max(20, Math.floor((window.innerWidth - _w) / 2));
      win.style.cssText=`position:relative;width:100%;height:100%;min-width:0;min-height:0;background:var(--sd-bg);display:flex;flex-direction:column;font-family:Inter,'Segoe UI',Arial,sans-serif;color:var(--sd-text);overflow:hidden`;
    }
    win.innerHTML=`
      <div id="gbar" style="display:flex;align-items:center;gap:10px;padding:8px 14px;background:var(--sd-bg-2);border-bottom:1px solid var(--sd-border);flex-shrink:0;cursor:default;user-select:none">
        <i class="fas fa-diagram-project" style="color:var(--sd-accent);font-size:13px"></i>
        <b style="font-size:11px;text-transform:uppercase;letter-spacing:0;color:var(--sd-accent);flex:none">Graph Editor</b>
        ${this._migrationCount ? `<span id="gmigration" title="Legacy nodes were updated in memory. Save & Apply to persist the migrated graph." style="display:flex;align-items:center;gap:5px;flex:none;padding:4px 7px;border:1px solid var(--sd-warning,#d7a53a);border-radius:6px;color:var(--sd-warning,#d7a53a);font-size:10px;letter-spacing:0"><i class="fas fa-wand-magic-sparkles"></i>${this._migrationCount} updated</span>` : ""}
        <div id="gfnbar" style="display:none;align-items:center;gap:6px;flex:none;background:var(--sd-control-bg,var(--sd-bg-3));border:1px solid var(--sd-control-border,var(--sd-border));border-radius:8px;padding:3px 8px;color:var(--sd-text-2);font-size:11px">
          <button id="gfnback" style="background:var(--sd-control-bg,var(--sd-bg-3));border:1px solid var(--sd-control-border,var(--sd-border));border-radius:6px;color:var(--sd-text);cursor:pointer;font-size:11px;padding:3px 8px" title="Return to outer graph"><i class="fas fa-arrow-left" style="margin-right:3px"></i>Back</button>
          <span id="gfncrumb" style="font-family:monospace;font-weight:600">\u0192 function</span>
          <button id="gfnsave" style="background:var(--sd-success);border:1px solid var(--sd-success);border-radius:6px;color:var(--sd-accent-text,#fff);cursor:pointer;font-size:11px;padding:3px 8px" title="Save function changes"><i class="fas fa-floppy-disk" style="margin-right:3px"></i>Save Fn</button>
        </div>
        <div id="gpreview" style="flex:1;font-size:10px;color:var(--sd-text-3);font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">-</div>
        <button id="gtpl" style="background:var(--sd-bg-3);border:1px solid var(--sd-border);border-radius:8px;color:var(--sd-text-2);cursor:pointer;font-size:11px;padding:6px 10px" title="Insert a saved node template"><i class="fas fa-puzzle-piece" style="margin-right:4px"></i>Templates</button>
        <button id="gtplsave" style="background:var(--sd-bg-3);border:1px solid var(--sd-border);border-radius:8px;color:var(--sd-text-2);cursor:pointer;font-size:11px;padding:6px 10px" title="Save the selected nodes (Shift-click to select) as a reusable template"><i class="fas fa-bookmark" style="margin-right:4px"></i>Save as Tpl</button>
        <button id="gimport" style="background:var(--sd-bg-3);border:1px solid var(--sd-border);border-radius:8px;color:var(--sd-text-2);cursor:pointer;font-size:11px;padding:6px 10px" title="Import template(s) from a JSON file"><i class="fas fa-file-import" style="margin-right:4px"></i>Import</button>
        <button id="gexport" style="background:var(--sd-bg-3);border:1px solid var(--sd-border);border-radius:8px;color:var(--sd-text-2);cursor:pointer;font-size:11px;padding:6px 10px" title="Export current selection (or whole graph) as JSON template"><i class="fas fa-file-export" style="margin-right:4px"></i>Export</button>
        <button id="glint" style="background:var(--sd-bg-3);border:1px solid var(--sd-border);border-radius:8px;color:var(--sd-text-2);cursor:pointer;font-size:11px;padding:6px 10px" title="Validate this graph (unknown nodes, type mismatches, orphans, missing entry points)"><i class="fas fa-check-double" style="margin-right:4px"></i>Lint</button>
        <button id="gdebug" style="background:var(--sd-bg-3);border:1px solid var(--sd-border);border-radius:8px;color:var(--sd-text-2);cursor:pointer;font-size:11px;padding:6px 10px" title="${esc(this._dbgT("ButtonHint"))}"><i class="fas fa-bug" style="margin-right:4px"></i>${esc(this._dbgT("Button"))}</button>
        <button id="gsave" style="background:var(--sd-accent);border:none;border-radius:8px;color:var(--sd-accent-text);cursor:pointer;font-size:11px;font-weight:800;padding:6px 16px;transition:.15s"><i class="fas fa-check" style="margin-right:5px"></i>Save & Apply</button>
        <button id="grefresh" style="background:var(--sd-bg-3);border:1px solid var(--sd-border);border-radius:8px;color:var(--sd-text-2);cursor:pointer;font-size:11px;padding:6px 10px" title="Re-scan document"><i class="fas fa-arrows-rotate" style="margin-right:4px"></i>Refresh Index</button>
        <button id="gclose" style="background:var(--sd-bg-3);border:1px solid var(--sd-border);border-radius:8px;color:var(--sd-text-2);cursor:pointer;font-size:14px;width:30px;height:30px;display:flex;align-items:center;justify-content:center;line-height:1;transition:.15s" title="Close" aria-label="Close graph editor"><i class="fas fa-xmark"></i></button>
      </div>
      <div style="display:flex;flex:1;overflow:hidden;min-height:0">
        <aside style="width:210px;min-width:180px;flex-shrink:0;background:var(--sd-bg-2);border-right:1px solid var(--sd-border);display:flex;flex-direction:column;overflow:hidden">
          <div style="display:flex;align-items:center;gap:5px;padding:7px;border-bottom:1px solid var(--sd-border);flex-shrink:0">
            <label for="gpalsearch" style="display:flex;align-items:center;gap:6px;min-width:0;flex:1;background:var(--sd-graph-field-bg,var(--sd-bg));border:1px solid var(--sd-graph-field-border,var(--sd-border));border-radius:6px;padding:0 7px;color:var(--sd-text-3)">
              <i class="fas fa-magnifying-glass" aria-hidden="true"></i>
              <input id="gpalsearch" type="search" value="${esc(this._palQuery)}" placeholder="Find nodes..." autocomplete="off" style="width:100%;min-width:0;height:28px;padding:0;border:0;background:transparent;color:var(--sd-text);font-size:11px;outline:none;box-shadow:none;letter-spacing:0">
            </label>
            <button id="gpalclear" type="button" title="Clear node search" aria-label="Clear node search" style="width:30px;height:30px;display:flex;align-items:center;justify-content:center;flex:0 0 30px;border:1px solid var(--sd-border);border-radius:6px;background:var(--sd-bg-3);color:var(--sd-text-2);cursor:pointer"><i class="fas fa-xmark"></i></button>
          </div>
          <div id="gpal" style="flex:1;min-height:0;overflow-y:auto;padding:4px 0">${this._buildPal()}</div>
        </aside>
        <div id="gvarpanel" style="width:180px;flex-shrink:0;background:var(--sd-bg-3);border-right:1px solid var(--sd-border);overflow-y:auto;padding:4px 0;font-size:10px;color:var(--sd-text-2)"></div>
        <div id="gwrap" style="flex:1;position:relative;overflow:hidden;cursor:default;user-select:none;touch-action:none;
          background:
            linear-gradient(90deg,var(--sd-graph-grid-major,rgba(255,255,255,.045)) 1px,transparent 1px) 0 0/32px 32px,
            linear-gradient(var(--sd-graph-grid-major,rgba(255,255,255,.045)) 1px,transparent 1px) 0 0/32px 32px,
            linear-gradient(90deg,var(--sd-graph-grid-minor,rgba(255,255,255,.025)) 1px,transparent 1px) 0 0/8px 8px,
            linear-gradient(var(--sd-graph-grid-minor,rgba(255,255,255,.025)) 1px,transparent 1px) 0 0/8px 8px,
            var(--sd-graph-bg,var(--sd-bg))">
          <!-- EDGE SVG - screen-space coords, no transform -->
          <svg id="gedges" style="position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none">
            <defs>
              <linearGradient id="sd-link-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" style="stop-color:var(--sd-accent)"/>
                <stop offset="100%" style="stop-color:var(--sd-success)"/>
              </linearGradient>
            </defs>
          </svg>
          <!-- comments layer - drawn behind nodes (Unreal-style comment boxes) -->
          <div id="gcomments" style="position:absolute;left:0;top:0;transform-origin:0 0;overflow:visible;will-change:transform"></div>
          <!-- nodes layer - transform-origin 0 0, will-change for GPU -->
          <div id="gnodes" style="position:absolute;left:0;top:0;transform-origin:0 0;overflow:visible;will-change:transform"></div>
          <!-- zoom / fit controls -->
          <div style="position:absolute;bottom:12px;right:12px;display:flex;gap:4px">
            <button class="gz" data-d="0.15" title="Zoom in">+</button>
            <button class="gz" data-d="-0.15" title="Zoom out">-</button>
            <button id="gfit" title="Fit view">Fit</button>
          </div>
          <div style="position:absolute;bottom:12px;left:12px;font-size:9px;color:var(--sd-text-3);pointer-events:none">
            RMB/Space+drag: pan - Scroll: zoom - Drag header: move node - Shift+Click: multi-select - Shift+Drag: marquee - Ctrl+Drag: comment box - Backspace: delete selection - Output->Input: connect (multi-input allowed) - Dbl-click edge: delete
          </div>
          <div id="gmode-badge" style="position:absolute;top:10px;left:10px;font-size:10px;padding:4px 10px;border-radius:8px;pointer-events:none;border:1px solid var(--sd-border);background:var(--sd-bg-2);display:none;color:var(--sd-text-2)"></div>
        </div>
      </div>`;
    const graphTitle = this._activeFunctionId ? "System Director — Function Graph" : "System Director — Graph Editor";
    const _hostW = Math.min(1180, Math.floor(window.innerWidth * 0.97));
    const _hostH = Math.min(720, Math.floor(window.innerHeight * 0.93));
    this._windowApp = openFoundryWindow({
      id:`sd-formula-graph-${foundry.utils.randomID(8)}`,
      title:graphTitle,
      icon:"fa-solid fa-diagram-project",
      width:_hostW,
      height:_hostH,
      minWidth:800,
      minHeight:520,
      classes:["sd-formula-graph-window"],
      content:win,
      onClose:()=>this.close({ fromHost:true })
    });
    this.win     = win;
    this.edgeSVG = win.querySelector("#gedges");
    this.nodesEl = win.querySelector("#gnodes");
    this.commentsEl = win.querySelector("#gcomments");

    const btnBase = "background:var(--sd-control-bg,var(--sd-bg-2));border:1px solid var(--sd-control-border,var(--sd-border));border-radius:8px;color:var(--sd-text-2);cursor:pointer;font-size:12px;height:30px;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(6px);transition:.15s;box-shadow:var(--sd-window-shadow,0 4px 12px rgba(0,0,0,.4))";
    win.querySelectorAll(".gz").forEach(b=>{b.style.cssText=btnBase+";width:30px";});
    win.querySelector("#gfit").style.cssText=btnBase+";padding:0 10px;font-size:11px;font-weight:600;gap:4px";

    this._wireWin();
    SDOnboarding.bindGraph(win);
      }

  // ============================== GRAPH DEBUG ==============================
  // Dry-run: walks every execution path from every entry point, compiling each
  // node on the way (no side effects), and marks OK / path end / error / loop.
  // Pure value chains (no exec pins, e.g. Derived Value / widget-config graphs)
  // are also dry-run, walking value wires upstream from every value output.

  _clearDebug() {
    this.win?.querySelector?.("#gdebugpanel")?.remove();
    this.nodesEl?.querySelectorAll?.(".gdbg-badge")?.forEach(el => el.remove());
    this.nodesEl?.querySelectorAll?.("[data-nid]")?.forEach(el => {
      if (el.dataset.gdbg) {
        el.style.outline = "";
        el.style.outlineOffset = "";
        delete el.dataset.gdbg;
      }
    });
  }

  /** Localized debug-mode strings (SD.GraphDebug.*) with English fallback. */
  _dbgT(key, data = null) {
    const FB = {
      Button: "Debug",
      ButtonHint: "Debug: dry-run the graph through every execution path and value chain, and mark where each path ends, loops, or fails with an error",
      Title: "Graph Debug \u2014 dry run",
      Close: "Close debug",
      SummaryEntries: "Entry points: {count}",
      SummaryValueSinks: "value outputs: {count}",
      SummaryPaths: "paths: {count}",
      SummaryDone: "completed: {count}",
      SummaryErrors: "errors: {count}",
      SummaryCycles: "cycles: {count}",
      NoEntries: "No entry points (event / trigger / unwired exec start) and no value outputs.",
      NoPaths: "No executable paths or value chains. Add an event/trigger and connect an exec output, or wire nodes into a value output.",
      Path: "Path {num}",
      ValuePath: "Value chain {num}",
      ErrorAt: "Error at \u201c{node}\u201d: {msg}",
      CycleAt: "Cycle \u2014 re-entered \u201c{node}\u201d",
      EndedAt: "Finished at \u201c{node}\u201d",
      ValueOkAt: "Value chain evaluated up to \u201c{node}\u201d",
      BrokenWire: "Broken wire: target node not found",
      BrokenSourceWire: "Broken wire: source node not found",
      UnknownNodeType: "Unknown node type \u201c{type}\u201d",
      BadgeError: "Debug: error \u2014 {msg}",
      BadgeEnd: "Debug: execution path ends here",
      BadgeOk: "Debug: compiled and passed OK",
      BadgeValue: "Debug: value chain evaluated OK",
      BadgeUnreachable: "Debug: not reachable from any entry point"
    };
    let out = null;
    try {
      const k = `SD.GraphDebug.${key}`;
      const lang = _ngLangSetting();
      if (lang !== "auto") {
        out = _ngLookupCached(lang, k);
        if (typeof out !== "string" || !out) out = _ngLookupCached(_NG_DEFAULT_LANG, k);
      } else if (game?.i18n?.has?.(k)) {
        out = game.i18n.localize(k);
      } else if (game?.i18n?.localize) {
        const localized = game.i18n.localize(k);
        if (localized && localized !== k) out = localized;
      }
    } catch {}
    if (typeof out !== "string" || !out || out === `SD.GraphDebug.${key}`) out = FB[key] ?? key;
    for (const [dk, dv] of Object.entries(data ?? {})) out = out.replaceAll(`{${dk}}`, String(dv));
    return out;
  }

  _dbgInputPins(node, def) {
    const pins = [];
    const add = list => {
      for (const pin of (list ?? [])) {
        if (!pin?.id || pins.some(existing => existing.id === pin.id)) continue;
        pins.push(pin);
      }
    };
    add(def?.inputs);
    try {
      if (typeof def?.computeDynamicInputs === "function") add(def.computeDynamicInputs(node));
    } catch {}
    const groups = Array.isArray(def?.dynamicPins) ? def.dynamicPins : (def?.dynamicPins ? [def.dynamicPins] : []);
    for (const group of groups) {
      const max = Math.max(0, Number(group?.max ?? 0) || 0);
      for (let i = 0; i < max; i++) {
        add([{ id:`${group.base}${i}`, label:`${group.label ?? group.base} ${i + 1}`, type:group.type ?? "value.any" }]);
      }
    }
    return pins;
  }

  _dbgExecInPins(node, def) {
    return new Set(this._dbgInputPins(node, def).filter(p => p.type === "exec").map(p => p.id));
  }

  _dbgExecOutPins(node, def) {
    let outs;
    try { outs = def?.computeDynamicOutputs ? def.computeDynamicOutputs(node) : (def?.outputs ?? []); }
    catch { outs = def?.outputs ?? []; }
    return (outs ?? []).filter(p => p.type === "exec");
  }

  _debugEvalNode(node) {
    const def = NODE_DEFS[node.type];
    if (!def) return { ok: false, msg: this._dbgT("UnknownNodeType", { type: node.type }) };
    try {
      const ins = {};
      for (const pin of this._dbgInputPins(node, def)) {
        if (pin.type === "exec") continue;
        const e = this._incomingEdge(node.id, pin.id);
        if (e) {
          const src = this.nodes.find(n => n.id === e.fromNode);
          if (!src) return { ok:false, msg:this._dbgT("BrokenSourceWire") };
          ins[pin.id] = this._compileValue(src, new Set(), e.fromPin);
        }
      }
      if (def.isIfCompare && typeof def.condition === "function") def.condition(node, ins);
      if (typeof def.toAction === "function") def.toAction(node, ins);

      // Value nodes increasingly expose multiple outputs through compilePin.
      // Compile every connected output (or the first output when isolated) so
      // new source nodes are checked by the same path as the real compiler.
      let outs;
      try { outs = def.computeDynamicOutputs ? def.computeDynamicOutputs(node) : (def.outputs ?? []); }
      catch { outs = def.outputs ?? []; }
      const valueOuts = (outs ?? []).filter(pin => pin.type !== "exec");
      const connected = valueOuts.filter(pin => this.edges.some(e => e.fromNode === node.id && e.fromPin === pin.id));
      const toCompile = connected.length ? connected : valueOuts.slice(0, 1);
      for (const pin of toCompile) this._compileValue(node, new Set(), pin.id);

      if (!valueOuts.length && typeof def.compile === "function") def.compile(node, ins);
      return { ok: true };
    } catch (e) {
      return { ok: false, msg: e?.message ?? String(e) };
    }
  }

  _runDebug() {
    this._clearDebug();
    const MAX_PATHS = 300, MAX_STEPS = 400;
    const nodeTitle = (n) => _NL(NODE_DEFS[n?.type]?.title ?? n?.type ?? "?");

    // Entry points: events / triggers, plus exec-capable nodes without an incoming exec wire.
    const entries = this.nodes.filter(n => {
      const def = NODE_DEFS[n.type];
      if (!def) return false;
      if (!this._dbgExecOutPins(n, def).length) return false;
      if (def.isEvent || def.isTrigger) return true;
      const inIds = this._dbgExecInPins(n, def);
      if (!inIds.size) return true;
      return !this.edges.some(e => e.toNode === n.id && inIds.has(e.toPin));
    });

    const nodeState = new Map();
    const RANK = { error: 4, end: 3, value: 2, ok: 1 };
    const bump = (nid, status, msg) => {
      const prev = nodeState.get(nid);
      if (!prev || RANK[status] > RANK[prev.status]) nodeState.set(nid, { status, msg });
    };

    const paths = [];
    let budget = MAX_PATHS;

    const walk = (nid, steps, inPath) => {
      if (budget <= 0) return;
      const node = this.nodes.find(n => n.id === nid);
      if (!node) {
        budget--;
        paths.push({ steps, end: "error", endMsg: this._dbgT("BrokenWire"), endNid: steps[steps.length - 1]?.nid });
        return;
      }
      if (inPath.has(nid) || steps.length >= MAX_STEPS) {
        budget--;
        paths.push({ steps: [...steps, { nid, title: nodeTitle(node), ok: true }], end: "cycle", endNid: nid });
        return;
      }
      const def = NODE_DEFS[node.type];
      const ev = (def?.isEvent || def?.isTrigger) ? { ok: true } : this._debugEvalNode(node);
      const steps2 = [...steps, { nid, title: nodeTitle(node), ok: ev.ok, msg: ev.msg }];
      if (!ev.ok) {
        bump(nid, "error", ev.msg);
        budget--;
        paths.push({ steps: steps2, end: "error", endMsg: ev.msg, endNid: nid });
        return;
      }
      bump(nid, "ok");
      const wired = [];
      for (const pin of this._dbgExecOutPins(node, def)) {
        for (const e of this.edges.filter(e => e.fromNode === nid && e.fromPin === pin.id)) {
          wired.push(e.toNode);
        }
      }
      if (!wired.length) {
        bump(nid, "end");
        budget--;
        paths.push({ steps: steps2, end: "end", endNid: nid });
        return;
      }
      const inPath2 = new Set(inPath); inPath2.add(nid);
      for (const to of wired) walk(to, steps2, inPath2);
    };

    for (const entry of entries) walk(entry.id, [], new Set());

    // ---- Pure value chains (no exec wires): Derived Value widgets, number/
    // attribute outputs, widget-config graphs, etc. Walk value wires upstream
    // from every value sink, dry-compiling each node on the way.
    const VALUE_SINK_TYPES = new Set(["output", "number_output", "attr_output", "skill_output", "init_output"]);
    const execCapable = new Set();
    for (const n of this.nodes) {
      const def = NODE_DEFS[n.type];
      if (!def) continue;
      if (this._dbgExecOutPins(n, def).length || this._dbgExecInPins(n, def).size) execCapable.add(n.id);
    }
    const valueSinks = this.nodes.filter(n => {
      const def = NODE_DEFS[n.type];
      if (!def) return false;
      if (VALUE_SINK_TYPES.has(n.type) || def.isWidgetConfig || def.isFunctionOutputs) return true;
      if (def.isEvent || def.isTrigger || execCapable.has(n.id)) return false;
      // Terminal pure node: nothing consumes its outputs.
      return !this.edges.some(e => e.fromNode === n.id);
    });

    const valuePaths = [];
    const walkVal = (nid, downSteps, inPath) => {
      if (budget <= 0) return;
      const node = this.nodes.find(n => n.id === nid);
      if (!node) {
        budget--;
        valuePaths.push({ steps: downSteps, end: "error", endMsg: this._dbgT("BrokenWire"), endNid: downSteps[downSteps.length - 1]?.nid });
        return;
      }
      if (inPath.has(nid) || downSteps.length >= MAX_STEPS) {
        budget--;
        valuePaths.push({ steps: [{ nid, title: nodeTitle(node), ok: true }, ...downSteps], end: "cycle", endNid: nid });
        return;
      }
      const def = NODE_DEFS[node.type];
      const ev = (def?.isEvent || def?.isTrigger) ? { ok: true } : this._debugEvalNode(node);
      const steps2 = [{ nid, title: nodeTitle(node), ok: ev.ok, msg: ev.msg }, ...downSteps];
      if (!ev.ok) {
        bump(nid, "error", ev.msg);
        budget--;
        valuePaths.push({ steps: steps2, end: "error", endMsg: ev.msg, endNid: nid });
        return;
      }
      bump(nid, downSteps.length ? "ok" : "value");
      const execIns = this._dbgExecInPins(node, def);
      const incoming = this.edges.filter(e => e.toNode === nid && !execIns.has(e.toPin));
      if (!incoming.length) {
        budget--;
        valuePaths.push({ steps: steps2, end: "value", endNid: steps2[steps2.length - 1]?.nid ?? nid });
        return;
      }
      const inPath2 = new Set(inPath); inPath2.add(nid);
      for (const e of incoming) walkVal(e.fromNode, steps2, inPath2);
    };
    for (const sink of valueSinks) walkVal(sink.id, [], new Set());

    // Paint node badges.
    const badge = (el, color, char, tip) => {
      const b = document.createElement("div");
      b.className = "gdbg-badge";
      b.textContent = char;
      b.title = tip;
      b.style.cssText = `position:absolute;top:-9px;right:-9px;width:18px;height:18px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:900;color:#111;background:${color};z-index:5;box-shadow:0 2px 6px rgba(0,0,0,.4);pointer-events:auto`;
      el.appendChild(b);
    };
    for (const n of this.nodes) {
      const el = this.nodesEl?.querySelector(`[data-nid="${n.id}"]`);
      if (!el) continue;
      const def = NODE_DEFS[n.type];
      const st = nodeState.get(n.id);
      if (st) {
        const color = st.status === "error" ? "#ff5d5d" : st.status === "end" ? "#ffb84d" : st.status === "value" ? "#74a7ff" : "#3ec46e";
        el.style.outline = `2px solid ${color}`;
        el.style.outlineOffset = "3px";
        el.dataset.gdbg = st.status;
        badge(el, color,
          st.status === "error" ? "\u2716" : st.status === "end" ? "\u25a0" : st.status === "value" ? "=" : "\u2714",
          st.status === "error" ? this._dbgT("BadgeError", { msg: st.msg ?? "" }) : st.status === "end" ? this._dbgT("BadgeEnd") : st.status === "value" ? this._dbgT("BadgeValue") : this._dbgT("BadgeOk"));
      } else if (def && this._dbgExecInPins(n, def).size) {
        el.style.outline = "2px dashed rgba(160,160,175,.55)";
        el.style.outlineOffset = "3px";
        el.dataset.gdbg = "unreachable";
        badge(el, "#9aa0ad", "?", this._dbgT("BadgeUnreachable"));
      }
    }

    this._renderDebugPanel(entries, paths, valueSinks, valuePaths);
  }

  _renderDebugPanel(entries, paths, valueSinks = [], valuePaths = []) {
    const wrap = this.win?.querySelector?.("#gwrap");
    if (!wrap) return;
    const done = paths.filter(p => p.end === "end").length;
    const vals = valuePaths.filter(p => p.end === "value").length;
    const errs = paths.filter(p => p.end === "error").length + valuePaths.filter(p => p.end === "error").length;
    const cycs = paths.filter(p => p.end === "cycle").length + valuePaths.filter(p => p.end === "cycle").length;
    const rowFor = (p, head) => {
      const last = p.steps[p.steps.length - 1];
      const chain = p.steps.map(x => x.ok ? esc(x.title) : `<span style="color:#ff5d5d">${esc(x.title)}</span>`).join(" \u2192 ");
      const cfg = p.end === "error"
        ? { icon: "\u2716", color: "#ff5d5d", label: this._dbgT("ErrorAt", { node: last?.title ?? "?", msg: p.endMsg ?? "" }) }
        : p.end === "cycle"
        ? { icon: "\u27f3", color: "#ffb84d", label: this._dbgT("CycleAt", { node: last?.title ?? "?" }) }
        : p.end === "value"
        ? { icon: "=", color: "#74a7ff", label: this._dbgT("ValueOkAt", { node: last?.title ?? "?" }) }
        : { icon: "\u2714", color: "#3ec46e", label: this._dbgT("EndedAt", { node: last?.title ?? "?" }) };
      return `<div class="gdbg-row" data-focus="${esc(String(p.endNid ?? last?.nid ?? ""))}" style="padding:7px 10px;border-bottom:1px solid var(--sd-border);cursor:pointer">
        <div style="display:flex;gap:6px;align-items:flex-start;font-size:11px;font-weight:700;color:${cfg.color}"><span>${cfg.icon}</span><span style="flex:1">${esc(head)}: ${esc(cfg.label)}</span></div>
        <div style="font-size:10px;color:var(--sd-text-3);font-family:monospace;margin-top:3px;word-break:break-word;line-height:1.5">${chain}</div>
      </div>`;
    };
    const rows = paths.map((p, i) => rowFor(p, this._dbgT("Path", { num: i + 1 }))).join("")
      + valuePaths.map((p, i) => rowFor(p, this._dbgT("ValuePath", { num: i + 1 }))).join("");
    const noEntries = !entries.length && !valueSinks.length;
    const summary = [
      esc(this._dbgT("SummaryEntries", { count: entries.length })),
      esc(this._dbgT("SummaryValueSinks", { count: valueSinks.length })),
      esc(this._dbgT("SummaryPaths", { count: paths.length + valuePaths.length })),
      `<span style="color:#3ec46e">${esc(this._dbgT("SummaryDone", { count: done + vals }))}</span>`,
      `<span style="color:#ff5d5d">${esc(this._dbgT("SummaryErrors", { count: errs }))}</span>`
    ];
    if (cycs) summary.push(`<span style="color:#ffb84d">${esc(this._dbgT("SummaryCycles", { count: cycs }))}</span>`);
    const panel = document.createElement("div");
    panel.id = "gdebugpanel";
    panel.style.cssText = "position:absolute;top:10px;right:10px;width:360px;max-height:72%;display:flex;flex-direction:column;background:var(--sd-bg-2);border:1px solid var(--sd-border);border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.5);z-index:20;overflow:hidden";
    panel.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--sd-bg-3);border-bottom:1px solid var(--sd-border)">
        <i class="fas fa-bug" style="color:var(--sd-accent)"></i>
        <b style="font-size:11px;flex:1">${esc(this._dbgT("Title"))}</b>
        <button id="gdbgclose" title="${esc(this._dbgT("Close"))}" style="background:none;border:none;color:var(--sd-text-2);cursor:pointer;font-size:13px"><i class="fas fa-xmark"></i></button>
      </div>
      <div style="padding:6px 12px;font-size:10px;color:var(--sd-text-2);border-bottom:1px solid var(--sd-border)">
        ${summary.join(" \u00b7 ")}
        ${noEntries ? `<div style="color:#ff5d5d;margin-top:4px">${esc(this._dbgT("NoEntries"))}</div>` : ""}
      </div>
      <div style="flex:1;overflow-y:auto">${rows || `<div style="padding:12px;font-size:11px;color:var(--sd-text-3)">${esc(this._dbgT("NoPaths"))}</div>`}</div>`;
    wrap.appendChild(panel);
    panel.querySelector("#gdbgclose")?.addEventListener("click", () => this._clearDebug());
    panel.querySelectorAll(".gdbg-row").forEach(row => {
      row.addEventListener("click", () => this._debugFocus(row.dataset.focus));
      row.addEventListener("mouseenter", () => { row.style.background = "rgba(116,167,255,.08)"; });
      row.addEventListener("mouseleave", () => { row.style.background = "transparent"; });
    });
  }

  _debugFocus(nid) {
    const n = this.nodes.find(x => x.id === nid);
    const wrap = this.win?.querySelector?.("#gwrap");
    if (!n || !wrap) return;
    const r = wrap.getBoundingClientRect();
    this._pan.x = r.width / 2 - ((Number(n.x) || 0) + 110) * this._zoom;
    this._pan.y = r.height / 2 - ((Number(n.y) || 0) + 40) * this._zoom;
    this._applyTransform();
    this._redrawEdges();
    const el = this.nodesEl?.querySelector(`[data-nid="${nid}"]`);
    if (el) {
      const old = el.style.boxShadow;
      el.style.boxShadow = "0 0 0 4px rgba(116,167,255,.7)";
      setTimeout(() => { el.style.boxShadow = old; }, 900);
    }
  }

  _drawGrid() {
  }

  _nodeFilterContext() {
    const ALLOWED_CONFIG_CATS = new Set(["Values", "Conversion", "Get Data", "Math"]);
    const ALLOWED_NUMBER_CATS = new Set(["Values", "Conversion", "Get Data", "Math", "Logic"]);
    const ALLOWED_QUEST_CATS  = new Set(["Flow Control", "Dialogue", "Quest", "Values", "Conversion", "Get Data", "Math", "Logic"]);
    const ALLOWED_QUEST_SOURCES = new Set([
      "literal", "literal_str", "get_path", "actor_ref", "item_uuid", "fa_icon"
    ]);
    const IMPLICIT_CLICK_WIDGETS = new Set([
      "counter","dice","toggle","tracker","clock",
      "tokenPool","diceTray","number","resource","progress","richtext"
    ]);
    const isWidgetGraph    = !!this.widget && !this.configMode;
    const isNumberWidgetMode = !!this.numberWidgetMode;
    const isAttrGraph      = this.widget?.type === "attribute";
    const isItemGraph      = !!this.itemSaveCtx && !this.widget;
    const isSheetTrigger   = !!this.sheetTrigger;
    const isQuestModeAny   = !!(this.chainTrigger || this.questTrigger);
    const hidesEvents      = !isSheetTrigger && !isQuestModeAny
      && ((isWidgetGraph && !isAttrGraph) || isAttrGraph || isItemGraph);
    const hidesOnClick     = isSheetTrigger || isQuestModeAny || (isWidgetGraph && !isAttrGraph
      && IMPLICIT_CLICK_WIDGETS.has(this.widget?.type));

    const isFuncEditMode = !!this._activeFunctionId;

    return {
      ALLOWED_CONFIG_CATS,
      ALLOWED_NUMBER_CATS,
      ALLOWED_QUEST_CATS,
      ALLOWED_QUEST_SOURCES,
      isNumberWidgetMode,
      isSheetTrigger,
      isQuestModeAny,
      hidesEvents,
      hidesOnClick,
      isFuncEditMode
    };
  }

  _isNodeAvailableInCurrentGraph(type, d, catId = null, ctx = null) {
    if (!d) return false;
    ctx ??= this._nodeFilterContext();
    if (d.isWidgetConfig) return false;
    if (d.hidden) return false;
    if (catId && d.cat !== catId) return false;
    if (this.configMode && !ctx.ALLOWED_CONFIG_CATS.has(d.cat)) return false;
    if (ctx.isNumberWidgetMode) {
      const hasExecPin = pins => (pins ?? []).some(p => p?.type === "exec");
      if (!ctx.ALLOWED_NUMBER_CATS.has(d.cat)) return false;
      if (type === "output" || type === "number_output" || type === "on_click") return false;
      if (d.isAction || d.isEvent || hasExecPin(d.inputs) || hasExecPin(d.outputs)) return false;
    }
    if (ctx.isQuestModeAny && !ctx.ALLOWED_QUEST_CATS.has(d.cat)) return false;
    if (ctx.hidesEvents && d.isEvent) return false;
    if (ctx.hidesOnClick && type === "on_click") return false;
    if (ctx.isSheetTrigger && type === "output") return false;
    if (this.actionGraph && type === "output") return false;
    if (d.isInteractableOnly && this.actionGraphContext !== "interactable") return false;
    if (ctx.isFuncEditMode) {
      if (d.isEvent) return false;
      if (type === "output") return false;
      if (type === "on_click") return false;
    }
    if (ctx.isQuestModeAny) {
      if (type === "output") return false;
      if ((d.cat === "Values" || d.cat === "Get Data") && !ctx.ALLOWED_QUEST_SOURCES.has(type)) return false;
      if (d.isEvent && d.cat !== "Quest") return false;
    }
    return true;
  }

  _matchesNodeSearch(type, def, query = "") {
    const q = String(query ?? "").trim().toLocaleLowerCase();
    if (!q) return true;
    const terms = q.split(/\s+/).filter(Boolean);
    const haystack = [
      type,
      def?.title,
      _NL(def?.title),
      def?.desc,
      _NL(def?.desc),
      def?.cat,
      def?.keywords,
      def?.replacement
    ].filter(Boolean).join(" ").toLocaleLowerCase();
    return terms.every(term => haystack.includes(term));
  }

  _buildPal(query = this._palQuery) {
    const ctx = this._nodeFilterContext();

    const rows = CATS.map(cat=>{
      if (ctx.isQuestModeAny && !ctx.ALLOWED_QUEST_CATS.has(cat.id)) return "";
      if (ctx.isNumberWidgetMode && !ctx.ALLOWED_NUMBER_CATS.has(cat.id)) return "";

      if (cat.id === "Functions") {
        return this._buildPalFunctions(cat, query);
      }

      const nodes = Object.entries(NODE_DEFS)
        .filter(([type,d]) => this._isNodeAvailableInCurrentGraph(type, d, cat.id, ctx))
        .filter(([type,d]) => this._matchesNodeSearch(type, d, query))
        .sort((a,b) => String(_NL(a[1].title)).localeCompare(String(_NL(b[1].title))));
      if (!nodes.length) return "";
      return `<div style="display:flex;align-items:center;gap:6px;padding:6px 10px 3px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0;color:${cat.color};border-top:1px solid var(--sd-border);margin-top:4px">
          <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(_nodeCategoryLabel(cat))}</span>
          <span style="color:var(--sd-text-3);font-weight:600">${nodes.length}</span>
        </div>
        ${nodes.map(([type,d])=>`<div class="gpal" data-type="${type}" draggable="true" title="${esc(_NL(d.desc??d.title))}"
          style="display:flex;align-items:center;gap:8px;min-height:28px;padding:5px 10px;cursor:grab;border-radius:6px;margin:1px 4px;transition:.15s;box-sizing:border-box">
          <div style="width:9px;height:9px;border-radius:${d.isAction?'2px':'50%'};flex-shrink:0;background:${d.color};opacity:.9"></div>
          <span style="min-width:0;font-size:11px;color:var(--sd-text-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;letter-spacing:0">${esc(_NL(d.title))}</span>
        </div>`).join("")}`;
    }).join("");
    if (rows.trim()) return rows;
    return `<div style="padding:18px 12px;text-align:center;color:var(--sd-text-3);font-size:10px;line-height:1.4">No matching nodes</div>`;
  }

  _buildPalFunctions(cat, query = "") {
    const isGM = !!(game?.user?.isGM);
    const lib = this._getFunctionLib?.() ?? { functions: {} };
    const q = String(query ?? "").trim().toLocaleLowerCase();
    const fns = Object.values(lib.functions ?? {}).filter(fn => {
      if (!q) return true;
      const hay = [fn.id, fn.name, fn.description].filter(Boolean).join(" ").toLocaleLowerCase();
      return q.split(/\s+/).filter(Boolean).every(term => hay.includes(term));
    });
    fns.sort((a,b) => String(a.name||"").localeCompare(String(b.name||"")));
    if (q && !fns.length) return "";

    const head = `<div style="padding:5px 10px 3px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:${cat.color};border-top:1px solid var(--sd-border);margin-top:4px">${esc(_nodeCategoryLabel(cat))}</div>`;
    const btns = isGM ? `<div style="display:flex;gap:4px;padding:3px 6px 4px">
      <button id="gpalFnCreate" style="flex:1;background:#2a4a6a;border:1px solid #3a5a7a;border-radius:6px;color:#cfe8ff;cursor:pointer;font-size:10px;padding:4px 6px" title="Create a new function"><i class="fas fa-plus" style="margin-right:3px"></i>New</button>
      <button id="gpalFnManage" style="flex:1;background:#3a2a5a;border:1px solid #4a3a6a;border-radius:6px;color:#dccff8;cursor:pointer;font-size:10px;padding:4px 6px" title="Manage function library"><i class="fas fa-list" style="margin-right:3px"></i>Manage</button>
    </div>` : `<div style="padding:3px 10px 4px;font-size:9px;color:var(--sd-text-3);font-style:italic">GM-only editing</div>`;

    const items = fns.map(fn => {
      const color = fn.color || "#5a3a8a";
      const nIn   = (fn.inputs ?? []).length;
      const nOut  = (fn.outputs ?? []).length;
      return `<div class="gpal gpal-fn" data-type="function_call" data-function-id="${esc(String(fn.id))}" draggable="true" title="${esc(String(fn.description||fn.name||""))}"
        style="display:flex;align-items:center;gap:8px;padding:6px 12px;cursor:grab;border-radius:8px;margin:1px 4px;transition:.15s">
        <div style="width:9px;height:9px;border-radius:2px;flex-shrink:0;background:${color};opacity:.9"></div>
        <span style="font-size:11px;color:var(--sd-text-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">\u0192 ${esc(String(fn.name||"(unnamed)"))}</span>
        <span style="font-size:9px;color:var(--sd-text-3);font-family:monospace">${nIn}\u2192${nOut}</span>
      </div>`;
    }).join("");

    const empty = !items ? `<div style="padding:5px 12px 6px;font-size:10px;color:var(--sd-text-3);font-style:italic">No functions yet${isGM?". Click \u201cNew\u201d.":""}.</div>` : "";

    return head + btns + items + empty;
  }

  _uiDocument() {
    return this.win?.ownerDocument ?? globalThis.document;
  }

  _uiWindow() {
    return this._uiDocument()?.defaultView ?? globalThis.window;
  }

  _wireWin() {
    const win  = this.win;
    const wrap = win.querySelector("#gwrap");

    win.querySelector("#gclose").addEventListener("click", async () => {
      if (this._activeFunctionId) {
        await this._saveActiveFunction();
        while (this._funcStack?.length) this._leaveFunction();
      }
      await this._saveGraph(); this.close();
    });
    win.querySelector("#gsave").addEventListener("click", async () => {
      if (this._activeFunctionId) {
        await this._saveActiveFunction();
        return;
      }
      if (this.targetInput && this.widget?.type !== "attribute" && this.widget?.type !== "skill") {
        const f = this.compile();
        this.targetInput.value = f;
        this.targetInput.dispatchEvent(new Event("input",{bubbles:true}));
        this.targetInput.dispatchEvent(new Event("change",{bubbles:true}));
      }
      await this._saveGraph();
      ui.notifications?.info?.("Graph saved.");
      this.close();
    });
    win.querySelector("#gfnback")?.addEventListener("click", async () => {
      if (!this._activeFunctionId) return;
      await this._saveActiveFunction();
      this._leaveFunction();
    });
    win.querySelector("#gfnsave")?.addEventListener("click", async () => {
      await this._saveActiveFunction();
    });
    win.querySelector("#grefresh")?.addEventListener("click",()=>{
      this._smartIndex = this._buildSmartIndex();
      this._renderAll();
      this._scheduleEdges();
      const btn = win.querySelector("#grefresh");
      if(btn){ const orig=btn.innerHTML; btn.innerHTML='<i class="fas fa-check" style="margin-right:4px"></i>Refreshed'; btn.style.color="#aaffaa"; setTimeout(()=>{ btn.innerHTML=orig; btn.style.color="var(--sd-text-2)"; },1200); }
    });

    win.querySelector("#gtpl")?.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this._openTemplatesMenu(ev.currentTarget);
    });

    win.querySelector("#gtplsave")?.addEventListener("click", async () => {
      await this._saveSelectionAsTemplate();
    });

    win.querySelector("#gimport")?.addEventListener("click", () => this._importTemplateFromFile());

    win.querySelector("#gexport")?.addEventListener("click", () => this._exportSelectionAsFile());

    win.querySelector("#glint")?.addEventListener("click", () => this._runLint());

    const palSearch = win.querySelector("#gpalsearch");
    palSearch?.addEventListener("input", () => {
      this._palQuery = palSearch.value ?? "";
      this._refreshPalette(false);
    });
    win.querySelector("#gpalclear")?.addEventListener("click", () => {
      this._palQuery = "";
      if (palSearch) {
        palSearch.value = "";
        palSearch.focus();
      }
      this._refreshPalette(false);
    });

    this._raf = 0;
    this._scheduleEdges = () => {
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => {
        this._raf = 0;
        this._redrawEdges();
        this._updatePreview();
      });
    };

    const _move = ev => {
      // A detached browser window may miss mouseup when the pointer leaves its
      // right/bottom edge.  Do not keep a stale drag alive when the pointer
      // returns, otherwise the canvas jumps to the new screen coordinate.
      if ((this._panDrag || this._drag || this._commentDrag || this._commentResize) && ev.buttons === 0) {
        _up(ev);
        return;
      }
      if (this._panDrag) {
        if (!this._panDrag.moved &&
            Math.abs(ev.clientX - this._panDrag.sx) + Math.abs(ev.clientY - this._panDrag.sy) > 3) {
          this._panDrag.moved = true;
        }
        this._pan.x = ev.clientX - this._panDrag.ox;
        this._pan.y = ev.clientY - this._panDrag.oy;
        if (!this._panRaf) {
          this._panRaf = requestAnimationFrame(() => {
            this._panRaf = 0;
            this._applyTransform();
            this._scheduleEdges();
          });
        }
      }
      if (this._drag) {
        this._doDrag(ev);
      }

      if (this._conn) this._doConn(ev);

      if (this._marquee) this._doMarquee(ev);
      if (this._commentDrag)   this._doCommentDrag(ev);
      if (this._commentResize) this._doCommentResize(ev);
      if (this._commentDraft)  this._doCommentDraft(ev);
    };
    const _up = ev => {
      if (this._panDrag) {
        const pd = this._panDrag;
        this._panDrag = null;
        wrap.style.cursor = "";
        if (pd.rmb) {
          // Some platforms fire "contextmenu" on mousedown (suppressed below,
          // stored in pd.menuAt), others after mouseup (handled via _lastRmbPan).
          this._lastRmbPan = { moved: pd.moved, t: Date.now() };
          if (!pd.moved && pd.menuAt) {
            const r  = wrap.getBoundingClientRect();
            const gx = (pd.menuAt.x - r.left - this._pan.x) / this._zoom;
            const gy = (pd.menuAt.y - r.top  - this._pan.y) / this._zoom;
            this._ctxMenu(pd.menuAt.x, pd.menuAt.y, gx, gy);
          }
        }
      }
      let dragMoved = false;
      if (this._drag) {
        dragMoved = !!this._drag._moved;
        this._drag = null;
      }
      let commentDragMoved = false;
      if (this._commentDrag) {
        commentDragMoved = !!this._commentDrag._moved;
        this._commentDrag = null;
      }
      let commentResizeMoved = false;
      if (this._commentResize) {
        commentResizeMoved = !!this._commentResize._moved;
        this._commentResize = null;
      }
      if (this._conn)          this._endConn(ev);
      if (this._marquee)       this._endMarquee(ev);
      if (this._commentDraft)  this._endCommentDraft(ev);
      if (dragMoved || commentDragMoved || commentResizeMoved) {
        this._pushHistory();
      }
    };
    let space = false;
    const _kd = ev => {
      const uiDoc = this._uiDocument();
      if (!this.win || !uiDoc?.body?.contains(this.win)) return;

      if (ev.code === "Space") {
        const st = ev.target;
        const inSpaceField = st && (
          st.tagName === "INPUT" || st.tagName === "TEXTAREA" || st.tagName === "SELECT" ||
          st.isContentEditable
        );
        // When the editor is opened from a window (e.g. system settings), the
        // opening button keeps focus, so ev.target is never document.body.
        // Accept Space from any non-editable target and prevent it from
        // re-activating the still-focused button.
        if (!inSpaceField) {
          ev.preventDefault();
          if (st?.blur && st !== uiDoc.body) st.blur();
          space = true;
          wrap.style.cursor = "grab";
        }
        return;
      }

      const t = ev.target;
      const inField = t && (
        t.tagName === "INPUT" ||
        t.tagName === "TEXTAREA" ||
        t.isContentEditable
      );

      if (ev.key === "Backspace" || ev.key === "Delete") {
        if (inField) return;
        if (!this._selected.size && !this._selectedComments.size) return;
        ev.preventDefault();
        this._deleteSelection();
        return;
      }

      const mod = ev.ctrlKey || ev.metaKey;
      if (!mod || inField) return;

      const k = (ev.key || "").toLowerCase();
      if (k === "z" && !ev.shiftKey)         { ev.preventDefault(); this._undo(); }
      else if (k === "y" || (k === "z" && ev.shiftKey)) { ev.preventDefault(); this._redo(); }
      else if (k === "d")                    { ev.preventDefault(); this._duplicateSelection(); }
      else if (k === "c")                    { ev.preventDefault(); this._copySelection(); }
      else if (k === "v")                    { ev.preventDefault(); this._pasteClipboard(); }
    };
    const _ku = ev => { if (ev.code === "Space") { space = false; wrap.style.cursor = ""; }};

    // ApplicationV2 windows can be detached into another browser Document.
    // DOM nodes move with the window, but listeners registered on the original
    // global document do not.  Rebind document-level drag/keyboard listeners
    // whenever the graph receives focus or a pointer event in its new owner.
    let eventDoc = null;
    let eventView = null;
    const _unbindEventDocument = () => {
      eventDoc?.removeEventListener("mousemove", _move);
      eventDoc?.removeEventListener("mouseup", _up);
      eventDoc?.removeEventListener("keydown", _kd);
      eventDoc?.removeEventListener("keyup", _ku);
      eventView?.removeEventListener("blur", _up);
      eventDoc = null;
      eventView = null;
    };
    const _syncEventDocument = () => {
      const nextDoc = win.ownerDocument ?? globalThis.document;
      if (!nextDoc || nextDoc === eventDoc) return;
      _unbindEventDocument();
      eventDoc = nextDoc;
      eventView = nextDoc.defaultView ?? globalThis.window;
      eventDoc.addEventListener("mousemove", _move);
      eventDoc.addEventListener("mouseup", _up);
      eventDoc.addEventListener("keydown", _kd);
      eventDoc.addEventListener("keyup", _ku);
      eventView?.addEventListener("blur", _up);
    };
    win.addEventListener("pointerdown", _syncEventDocument, true);
    win.addEventListener("focusin", _syncEventDocument, true);
    _syncEventDocument();
    this._cleanup.push(() => {
      win.removeEventListener("pointerdown", _syncEventDocument, true);
      win.removeEventListener("focusin", _syncEventDocument, true);
      _unbindEventDocument();
    });

    // Pointer capture keeps panning responsive even when the pointer crosses
    // the edge of a detached window. Mouse handlers remain for v13 support.
    wrap.addEventListener("pointerdown", ev => {
      if (ev.button === 1 || ev.button === 2 || (ev.button === 0 && space)) {
        this._panPointerId = ev.pointerId;
        try { wrap.setPointerCapture?.(ev.pointerId); } catch { }
      }
    }, true);
    wrap.addEventListener("pointermove", ev => {
      if (this._panDrag && this._panPointerId === ev.pointerId) _move(ev);
    });
    const _pointerUp = ev => {
      if (this._panPointerId !== ev.pointerId) return;
      try { wrap.releasePointerCapture?.(ev.pointerId); } catch { }
      this._panPointerId = null;
      _up(ev);
    };
    wrap.addEventListener("pointerup", _pointerUp);
    wrap.addEventListener("pointercancel", _pointerUp);

    wrap.addEventListener("mousedown", ev => {
      _syncEventDocument();
      if (ev.button === 1 || ev.button === 2 || (ev.button === 0 && space)) {
        ev.preventDefault();
        this._panDrag = {
          ox: ev.clientX - this._pan.x, oy: ev.clientY - this._pan.y,
          rmb: ev.button === 2, sx: ev.clientX, sy: ev.clientY, moved: false
        };
        wrap.style.cursor = "grabbing";
        return;
      }

      if (ev.button === 0 && (ev.ctrlKey || ev.metaKey) && ev.target === wrap) {
        ev.preventDefault();
        const r = wrap.getBoundingClientRect();
        const sx = ev.clientX - r.left;
        const sy = ev.clientY - r.top;
        const box = document.createElement("div");
        box.className = "gcmt-draft";
        box.style.cssText = "position:absolute;border:2px dashed #ffd94a;background:rgba(255,217,74,.12);pointer-events:none;z-index:11;border-radius:10px";
        box.style.left = sx + "px";
        box.style.top  = sy + "px";
        box.style.width = "0px";
        box.style.height = "0px";
        wrap.appendChild(box);
        this._commentDraft = { sx, sy, cx: sx, cy: sy, el: box };
        return;
      }

      if (ev.button === 0 && ev.shiftKey && ev.target === wrap) {
        ev.preventDefault();
        const r = wrap.getBoundingClientRect();
        const sx = ev.clientX - r.left;
        const sy = ev.clientY - r.top;
        const box = document.createElement("div");
        box.className = "gmarquee";
        box.style.cssText = "position:absolute;border:1px dashed #ffca6b;background:rgba(255,202,107,.12);pointer-events:none;z-index:10";
        box.style.left = sx + "px";
        box.style.top  = sy + "px";
        box.style.width = "0px";
        box.style.height = "0px";
        wrap.appendChild(box);
        this._marquee = { sx, sy, cx: sx, cy: sy, el: box, additive: this._selected.size > 0 };
        return;
      }

      if (ev.button === 0 && !ev.shiftKey && ev.target === wrap) {
        this._clearSelection();
      }
    });

    const _zoomAt = (screenX, screenY, delta) => {
      const r   = wrap.getBoundingClientRect();
      const mx  = screenX - r.left;
      const my  = screenY - r.top;
      const wx0 = (mx - this._pan.x) / this._zoom;
      const wy0 = (my - this._pan.y) / this._zoom;
      this._zoom = Math.max(0.15, Math.min(3.0, this._zoom * (delta > 0 ? 0.92 : 1.08)));
      this._pan.x = mx - wx0 * this._zoom;
      this._pan.y = my - wy0 * this._zoom;
      this._applyTransform();
      this._scheduleEdges();
    };

    win.querySelectorAll(".gz").forEach(b => b.addEventListener("click", () => {
      const r   = wrap.getBoundingClientRect();
      const cx  = r.width / 2, cy = r.height / 2;
      _zoomAt(r.left + cx, r.top + cy, parseFloat(b.dataset.d) < 0 ? 1 : -1);
    }));
    win.querySelector("#gfit").addEventListener("click", () => this._fitView());
    win.querySelector("#gdebug")?.addEventListener("click", () => this._runDebug());

    wrap.addEventListener("wheel", ev => {
      ev.preventDefault();
      _zoomAt(ev.clientX, ev.clientY, ev.deltaY);
    }, { passive: false });

    wrap.addEventListener("contextmenu", ev => {
      ev.preventDefault();
      // Right-drag pans the canvas (matches the on-screen hint); only a
      // right-click without movement opens the node menu.
      if (this._panDrag?.rmb) {
        // contextmenu fired while the right button is still down (mousedown
        // platforms): defer the menu decision to mouseup.
        this._panDrag.menuAt = { x: ev.clientX, y: ev.clientY };
        return;
      }
      if (this._lastRmbPan && (Date.now() - this._lastRmbPan.t) < 300) {
        const wasPan = this._lastRmbPan.moved;
        this._lastRmbPan = null;
        if (wasPan) return;
      }
      const r  = wrap.getBoundingClientRect();
      const gx = (ev.clientX - r.left - this._pan.x) / this._zoom;
      const gy = (ev.clientY - r.top  - this._pan.y) / this._zoom;
      this._ctxMenu(ev.clientX, ev.clientY, gx, gy);
    });

    win.querySelectorAll(".gpal").forEach(el => {
      el.addEventListener("dragstart", ev => {
        const payload = { _sg: el.dataset.type };
        const fid = el.dataset.functionId;
        if (fid) payload._fnId = fid;
        ev.dataTransfer.setData("text/plain", JSON.stringify(payload));
      });
      el.addEventListener("mouseenter", () => el.style.background = "rgba(116,167,255,.1)");
      el.addEventListener("mouseleave", () => el.style.background = "");
    });

    win.querySelector("#gpalFnCreate")?.addEventListener("click", () => this._fnCreatePrompt?.());
    win.querySelector("#gpalFnManage")?.addEventListener("click", () => this._openManageFunctions?.());

    wrap.addEventListener("dragover", ev => ev.preventDefault());
    wrap.addEventListener("drop", ev => {
      ev.preventDefault();
      try {
        const d = JSON.parse(ev.dataTransfer.getData("text/plain"));
        if (d._sg) {
          const r = wrap.getBoundingClientRect();
          const gx = (ev.clientX - r.left - this._pan.x) / this._zoom;
          const gy = (ev.clientY - r.top  - this._pan.y) / this._zoom;
          const extra = d._fnId ? { functionId: d._fnId } : null;
          this._addNode(d._sg, gx, gy, extra);
        }
        if (d.type === "Item" || d.uuid?.includes("Item")) {
          const focused = this._uiDocument()?.activeElement;
          if (focused?.dataset?.fieldType === "text" && focused?.placeholder?.includes("drag")) {
            focused.value = d.uuid ?? d.id ?? "";
            focused.dispatchEvent(new Event("input", { bubbles: true }));
          }
        }
      } catch {}
    });
  }

  _ctxMenu(sx,sy,gx,gy,conn=null) {
    const doc = this._uiDocument();
    doc.querySelector(".sdgctx")?.remove();
    doc.getElementById("sd-quick-insert-menu")?.remove();
    const menu=doc.createElement("div");
    menu.className="sdgctx";
    menu.style.cssText=`position:fixed;left:${sx}px;top:${sy}px;background:var(--sd-popover-bg,var(--sd-bg-2));border:1px solid var(--sd-popover-border,var(--sd-border));border-radius:6px;box-shadow:var(--sd-popover-shadow,0 8px 32px rgba(0,0,0,.85));z-index:25000;min-width:200px;padding:4px 0;font-family:'Signika',serif;max-height:82vh;overflow-y:auto;color:var(--sd-text)`;

    const search=doc.createElement("input");
    search.placeholder="Search...";
    search.style.cssText="width:calc(100% - 16px);margin:6px 8px 3px;background:var(--sd-graph-field-bg,var(--sd-bg));border:1px solid var(--sd-graph-field-border,var(--sd-border));border-radius:4px;color:var(--sd-text);font-size:11px;padding:4px 8px;outline:none;box-sizing:border-box";
    menu.appendChild(search);

    const list=doc.createElement("div");
    menu.appendChild(list);

    const ctx = this._nodeFilterContext();
    const compatibleInput = def => {
      if (!conn) return null;
      return (def?.inputs ?? []).find(pin => {
        if (conn.fromType === "exec") return pin.type === "exec";
        return pin.type !== "exec" && arePinsCompatible(conn.fromType, pin.type);
      }) ?? null;
    };
    const build=(q="")=>{
      list.innerHTML="";
      CATS.forEach(cat=>{
        if (ctx.isNumberWidgetMode && !ctx.ALLOWED_NUMBER_CATS.has(cat.id)) return;
        if (ctx.isQuestModeAny && !ctx.ALLOWED_QUEST_CATS.has(cat.id)) return;
        const nodes=Object.entries(NODE_DEFS).filter(([type,d])=>{
          if (!this._isNodeAvailableInCurrentGraph(type, d, cat.id, ctx)) return false;
          if (conn && !compatibleInput(d)) return false;
          return this._matchesNodeSearch(type, d, q);
        }).sort((a,b)=>String(_NL(a[1].title)).localeCompare(String(_NL(b[1].title))));
        if(!nodes.length) return;
        const h=doc.createElement("div");
        h.style.cssText=`padding:3px 10px;font-size:9px;font-weight:700;text-transform:uppercase;color:${cat.color};border-top:1px solid var(--sd-border);margin-top:3px`;
        h.textContent=_nodeCategoryLabel(cat); list.appendChild(h);
        nodes.forEach(([type,def])=>{
          const item=doc.createElement("div");
          item.style.cssText="padding:5px 16px;font-size:11px;color:#c0c0d8;cursor:pointer;display:flex;align-items:center;gap:8px";
          item.innerHTML=`<div style="width:8px;height:8px;border-radius:2px;background:${def.color};flex-shrink:0"></div>${esc(_NL(def.title))}`;
          item.addEventListener("mouseenter",()=>item.style.background="rgba(116,167,255,.1)");
          item.addEventListener("mouseleave",()=>item.style.background="");
          item.addEventListener("click",()=>{
            menu.remove();
            if (!conn) {
              this._addNode(type,gx,gy);
              return;
            }
            const input = compatibleInput(def);
            if (!input) return;
            this._suppressHistory = true;
            let added = null;
            try {
              added = this._addNode(type,gx,gy);
              if (added) this._addEdge(conn.fromNode,conn.fromPin,added.id,input.id);
            } finally {
              this._suppressHistory = false;
            }
            if (added) this._pushHistory();
          });
          list.appendChild(item);
        });
      });
    };
    build();
    search.addEventListener("input",()=>build(search.value));
    doc.body.appendChild(menu);
    search.focus();
    setTimeout(()=>doc.addEventListener("click",function f(){menu.remove();doc.removeEventListener("click",f);},{once:true}),80);
  }

  _addWidgetConfigNode() {
    const wType = this.widget?.type;
    const cfgType = "wcfg_" + wType;
    const def = NODE_DEFS[cfgType];
    if (!def) return;
    const data = {};
    for (const field of (def.fields ?? [])) {
      data[field.key] = this.widget[field.key] ?? field.default ?? "";
    }
    this.nodes.push({ id: "wcfg_root", type: cfgType, x: 80, y: 80, data });
    this._id = 10;
  }

  _addOutputNode() {
    this.nodes.push({id:"output",type:"output",x:660,y:230,data:{}});
  }

  _addCalcDefaultGraph() {
    // Calculations are node-graph only. Seed a default Number(0) -> Output graph
    // so an empty calculation compiles to "0".
    this.nodes.push({ id:"num_default", type:"literal", x:320, y:230, data:{ value:0 } });
    this.nodes.push({ id:"output",      type:"output",  x:660, y:230, data:{} });
    this.edges.push({ id:"e_num_out", fromNode:"num_default", fromPin:"v", toNode:"output", toPin:"value" });
    this._id = 20;
  }

  _addNumberWidgetDefaultGraph() {
    const step = Number(this.widget?.stepFormula ?? this.widget?.step ?? 1);
    const stepValue = Number.isFinite(step) && step > 0 ? step : 1;
    this.nodes.push({ id:"num_step_default", type:"literal", x:320, y:260, data:{ value:stepValue } });
    this.nodes.push({ id:"number_output", type:"number_output", x:660, y:230, data:{} });
    this.edges.push({ id:"e_num_step_out", fromNode:"num_step_default", fromPin:"v", toNode:"number_output", toPin:"step" });
    this._id = 20;
  }

  _ensureNumberWidgetGraph() {
    const hasExecPin = pins => (pins ?? []).some(p => p?.type === "exec");
    const bannedIds = new Set(this.nodes.filter(n => {
      const def = NODE_DEFS[n.type];
      return n.type === "output"
        || n.type === "on_click"
        || def?.isAction
        || def?.isEvent
        || hasExecPin(def?.inputs)
        || hasExecPin(def?.outputs);
    }).map(n => n.id));
    if (bannedIds.size) {
      this.nodes = this.nodes.filter(n => !bannedIds.has(n.id));
      this.edges = this.edges.filter(e => !bannedIds.has(e.fromNode) && !bannedIds.has(e.toNode));
    }
    if (!this.nodes.some(n => n.type === "number_output")) {
      this.nodes.push({ id:"number_output", type:"number_output", x:660, y:230, data:{} });
    }
    const out = this.nodes.find(n => n.type === "number_output");
    if (out) {
      const allowed = new Set(["min", "max", "step"]);
      this.edges = this.edges.filter(e => e.toNode !== out.id || allowed.has(e.toPin));
    }
  }

  _addInitiativeDefaultGraph() {
    this.nodes.push({ id:"init_on_roll", type:"init_on_roll", x:80,  y:160, data:{} });
    this.nodes.push({ id:"init_output",  type:"init_output",  x:560, y:160, data:{} });
    this._id = 20;
  }

  _ensureInitiativeNodes() {
    if (!this.nodes.find(n => n.type === "init_on_roll")) {
      this.nodes.unshift({ id:"init_on_roll", type:"init_on_roll", x:80, y:160, data:{} });
    }
    if (!this.nodes.find(n => n.type === "init_output")) {
      this.nodes.push({ id:"init_output", type:"init_output", x:560, y:160, data:{} });
    }
  }

  _addAttributeDefaultGraph() {
    const attrKey   = this.saveCtx?.attrKey;
    const scorePath = this.widget?.path
      ?? (attrKey ? `system.attributes.${attrKey}.value` : "system.attributes.attr1.value");
    const scoreNode = { id:"attr_score_val", type:"attr_score_val", x:60,  y:160, data:{ path: scorePath } };
    const trigNode  = { id:"attr_on_click",  type:"on_click",       x:60,  y:330, data:{} };
    const outNode   = { id:"attr_output",    type:"attr_output",    x:500, y:240, data:{} };
    const modNode   = { id:"attr_mod_1",     type:"attr_mod",       x:270, y:160, data:{} };

    this.nodes.push(scoreNode, trigNode, outNode, modNode);

    this.edges.push({ id:"e_sv_mod",   fromNode:"attr_score_val", fromPin:"value", toNode:"attr_mod_1",  toPin:"score" });
    this.edges.push({ id:"e_mod_out",  fromNode:"attr_mod_1",     fromPin:"mod",   toNode:"attr_output", toPin:"modValue" });

    this._id = 20;
  }

  _addSkillDefaultGraph() {
    const rankPath = this.widget?.path ?? "system.skills.skill1.rank";
    const rankNode = { id:"skill_rank_val", type:"skill_rank_val", x:60,  y:160, data:{ path: rankPath } };
    const trigNode = { id:"skill_on_click", type:"on_click",       x:60,  y:330, data:{} };
    const outNode  = { id:"skill_output",   type:"skill_output",   x:500, y:240, data:{} };

    this.nodes.push(rankNode, trigNode, outNode);

    this.edges.push({ id:"e_rk_out", fromNode:"skill_rank_val", fromPin:"value", toNode:"skill_output", toPin:"modValue" });

    this._id = 20;
  }

  _migrateSkillGraph() {
    if (!this.nodes.find(n => n.type === "skill_output")) {
      const oldOut = this.nodes.find(n => n.type === "output");
      const valEdge = oldOut ? this._incomingEdge(oldOut.id, "value") : null;
      this.nodes = this.nodes.filter(n => n.type !== "output");
      this.edges = this.edges.filter(e => e.toNode !== (oldOut?.id ?? "__none__") && e.fromNode !== (oldOut?.id ?? "__none__"));
      this.nodes.push({ id:"skill_output", type:"skill_output", x: oldOut?.x ?? 500, y: oldOut?.y ?? 240, data:{} });
      if (valEdge) {
        this.edges.push({ id:`e_mig_${Date.now()}`, fromNode:valEdge.fromNode, fromPin:valEdge.fromPin, toNode:"skill_output", toPin:"modValue" });
      }
    }
    if (!this.nodes.find(n => n.type === "skill_rank_val")) {
      const rankPath = this.widget?.path ?? "system.skills.skill1.rank";
      this.nodes.unshift({ id:"skill_rank_val", type:"skill_rank_val", x:60, y:160, data:{ path: rankPath } });
    }
    if (!this.nodes.find(n => n.type === "on_click")) {
      this.nodes.push({ id:"skill_on_click", type:"on_click", x:60, y:330, data:{} });
    }
    const sklOut = this.nodes.find(n => n.type === "skill_output");
    if (sklOut) {
      this.edges = this.edges.filter(e => !(e.toNode === sklOut.id && e.toPin === "exec"));
    }
  }

  _migrateAttrGraph() {
    const hasNew = this.nodes.some(n => n.type === "attr_score_val" || n.type === "attr_output");
    if (!hasNew) {
      const scorePath = this.widget?.path ?? "system.attributes.attr1.value";
      this.nodes = this.nodes.filter(n => n.type !== "output");
      this.edges = this.edges.filter(e => e.toNode !== "output" && e.fromNode !== "output");
      for (const n of this.nodes) {
        if (n.type === "attr_score") { n.type = "attr_score_val"; if (!n.data.path) n.data.path = scorePath; }
      }
      if (!this.nodes.find(n => n.type === "attr_score_val")) {
        this.nodes.unshift({ id:"attr_score_val", type:"attr_score_val", x:60, y:160, data:{ path: scorePath } });
      }
      if (!this.nodes.find(n => n.type === "on_click")) {
        this.nodes.push({ id:"attr_on_click", type:"on_click", x:60, y:330, data:{} });
      }
      if (!this.nodes.find(n => n.type === "attr_output")) {
        this.nodes.push({ id:"attr_output", type:"attr_output", x:500, y:240, data:{} });
      }
    }
    const attrOut = this.nodes.find(n => n.type === "attr_output");
    if (attrOut) {
      this.edges = this.edges.filter(e => !(e.toNode === attrOut.id && e.toPin === "exec"));
    }
  }

  _addTriggerOutputNodes() {
    this.nodes.push({id:"trigger",type:"on_click",x:80,y:220,data:{}});
  }

  _addNode(type,x,y,extraData=null) {
    const def=NODE_DEFS[type]; if(!def) return null;
    const data = Object.fromEntries((def.fields??[]).map(f=>[f.key,f.default??""]));
    if (extraData && typeof extraData === "object") Object.assign(data, extraData);
    const node={id:`n${this._id++}`,type,x:Math.round(x),y:Math.round(y),data};
    this.nodes.push(node);
    this._renderNode(node);
    this._updatePreview();
    this._pushHistory();
    SDOnboarding.onGraphChanged?.(this);
    return node;
  }

  _delNode(id) {
    if(id==="output") return;
    if(id==="init_on_roll" || id==="init_output") return;
    const target = this.nodes.find(n => n.id === id);
    if (target && NODE_DEFS[target.type]?.noDelete) return;
    this.nodes=this.nodes.filter(n=>n.id!==id);
    this.edges=this.edges.filter(e=>e.fromNode!==id&&e.toNode!==id);
    this.nodesEl.querySelector(`[data-nid="${id}"]`)?.remove();
    this._scheduleEdges?.();
    this._pushHistory();
  }

  _addEdge(fn,fp,tn,tp) {
    if(fn===tn) return;
    const exists = this.edges.some(e =>
      e.fromNode === fn && e.fromPin === fp &&
      e.toNode === tn && e.toPin === tp
    );
    if (exists) return;
    this.edges.push({id:`e${uid()}`,fromNode:fn,fromPin:fp,toNode:tn,toPin:tp});
    const touched = new Set([fn, tn]);
    for (const id of touched) {
      const n = this.nodes.find(x => x.id === id);
      if (n) this._renderNode(n);
    }
    this._scheduleEdges?.();
    this._pushHistory();
    SDOnboarding.onGraphChanged?.(this);
  }

  _removeEdge(edgeId) {
    const edge = this.edges.find(e => e.id === edgeId);
    if (!edge) return;
    this.edges = this.edges.filter(e => e.id !== edgeId);
    for (const id of [edge.fromNode, edge.toNode]) {
      const n = this.nodes.find(x => x.id === id);
      if (n) this._renderNode(n);
    }
    this._scheduleEdges?.();
    this._pushHistory();
  }

  _incomingEdges(nodeId, pinId) {
    return this.edges.filter(e => e.toNode === nodeId && e.toPin === pinId);
  }

  _incomingEdge(nodeId, pinId) {
    const edges = this._incomingEdges(nodeId, pinId);
    return edges.length ? edges[edges.length - 1] : null;
  }

  _renderAll() {
    this.nodesEl.innerHTML="";
    this.nodes.forEach(n=>this._renderNode(n));
    this._renderComments();
    this._applyTransform();
    this._redrawEdges();
    this._updatePreview();
  }

  _renderComments() {
    if (!this.commentsEl) return;
    this.commentsEl.innerHTML = "";
    for (const c of this.comments) this._renderComment(c);
  }

  _renderComment(c) {
    if (!this.commentsEl) return;
    this.commentsEl.querySelector(`[data-cid="${c.id}"]`)?.remove();

    const selected = this._selectedComments.has(c.id);
    const color = c.color || "#ffd94a";
    const el = document.createElement("div");
    el.dataset.cid = c.id;
    el.className = "gcmt";
    el.style.cssText = `position:absolute;left:${c.x}px;top:${c.y}px;width:${c.w}px;height:${c.h}px;background:${color}22;border:2px solid ${color};border-radius:10px;pointer-events:auto;box-shadow:0 6px 18px rgba(0,0,0,.35);outline:${selected?"2px solid #ffca6b":"none"};outline-offset:2px`;
    const mode = (c.mode === "note") ? "note" : "frame";
    el.innerHTML = `
      <div class="gcmt-hdr" style="display:flex;align-items:center;gap:6px;padding:4px 10px;background:${color};border-radius:8px 8px 0 0;cursor:grab;user-select:none;font-family:Inter,'Segoe UI',Arial,sans-serif;color:#1a1a1a;font-weight:700;font-size:13px">
        <span class="gcmt-ttl" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.title || "Comment")}</span>
        <span class="gcmt-mode" style="cursor:pointer;padding:0 6px;color:#1a1a1a;opacity:.55;font-size:13px" title="${mode === "note" ? "Switch to frame (group) mode" : "Switch to notepad mode"}">${mode === "note" ? "\u25a3" : "\u270e"}</span>
        <span class="gcmt-del" style="cursor:pointer;padding:0 6px;color:#1a1a1a;opacity:.55;font-size:14px" title="Delete comment">x</span>
      </div>
      ${mode === "note" ? `<textarea class="gcmt-txt" placeholder="Type your note here..." style="position:absolute;top:30px;left:0;width:100%;height:calc(100% - 30px);box-sizing:border-box;background:transparent;border:none;outline:none;resize:none;padding:8px 10px;font-family:Inter,'Segoe UI',Arial,sans-serif;font-size:13px;line-height:1.45;color:var(--sd-text,#e8e8f0)">${esc(c.text ?? "")}</textarea>` : ""}
      <div class="gcmt-rsz" style="position:absolute;right:0;bottom:0;width:14px;height:14px;cursor:nwse-resize;background:linear-gradient(135deg,transparent 50%,${color} 50%);border-bottom-right-radius:10px"></div>
    `;
    this.commentsEl.appendChild(el);

    const hdr = el.querySelector(".gcmt-hdr");
    const del = el.querySelector(".gcmt-del");
    const ttl = el.querySelector(".gcmt-ttl");
    const rsz = el.querySelector(".gcmt-rsz");

    del.addEventListener("mousedown", ev => ev.stopPropagation());
    del.addEventListener("click", ev => {
      ev.stopPropagation();
      this._deleteComment(c.id);
    });

    const modeBtn = el.querySelector(".gcmt-mode");
    modeBtn.addEventListener("mousedown", ev => ev.stopPropagation());
    modeBtn.addEventListener("click", ev => {
      ev.stopPropagation();
      c.mode = (c.mode === "note") ? "frame" : "note";
      this._renderComment(c);
      this._pushHistory?.();
    });

    const txt = el.querySelector(".gcmt-txt");
    if (txt) {
      for (const t of ["mousedown", "pointerdown", "dblclick", "wheel", "contextmenu"]) {
        txt.addEventListener(t, ev => ev.stopPropagation());
      }
      txt.addEventListener("keydown", ev => ev.stopPropagation());
      txt.addEventListener("input", () => { c.text = txt.value; });
      txt.addEventListener("change", () => { c.text = txt.value; this._pushHistory?.(); });
    }

    hdr.addEventListener("dblclick", async ev => {
      ev.stopPropagation();
      const name = await this._promptText("Comment title:", c.title || "Comment");
      if (name != null) {
        c.title = name;
        ttl.textContent = name;
      }
    });

    hdr.addEventListener("mousedown", ev => {
      if (ev.target === del || ev.target === rsz) return;
      if (ev.button !== 0) return;
      ev.stopPropagation();
      if (ev.shiftKey) {
        if (this._selectedComments.has(c.id)) this._selectedComments.delete(c.id);
        else this._selectedComments.add(c.id);
        this._refreshSelectionHighlights();
        return;
      }
      if (!this._selectedComments.has(c.id)) {
        this._selectedComments.clear();
        this._selected.clear();
        this._selectedComments.add(c.id);
      }
      this._refreshSelectionHighlights();

      const cmtGroup = Array.from(this._selectedComments).map(id => {
        const cc = this.comments.find(x => x.id === id);
        return cc ? { id: cc.id, ox: cc.x, oy: cc.y } : null;
      }).filter(Boolean);

      const childIds = new Set();
      for (const id of this._selectedComments) {
        const cc = this.comments.find(x => x.id === id);
        if (!cc) continue;
        for (const n of this.nodes) {
          if (n.x >= cc.x && n.x <= cc.x + cc.w && n.y >= cc.y && n.y <= cc.y + cc.h) {
            childIds.add(n.id);
          }
        }
      }
      const nodeGroup = Array.from(childIds).map(id => {
        const n = this.nodes.find(x => x.id === id);
        return n ? { id: n.id, ox: n.x, oy: n.y } : null;
      }).filter(Boolean);

      this._commentDrag = {
        id: c.id,
        mx: ev.clientX, my: ev.clientY,
        cmtGroup, nodeGroup
      };
    });

    rsz.addEventListener("mousedown", ev => {
      if (ev.button !== 0) return;
      ev.stopPropagation();
      ev.preventDefault();
      this._commentResize = {
        id: c.id,
        mx: ev.clientX, my: ev.clientY,
        ow: c.w, oh: c.h
      };
    });
  }

  _addComment({x, y, w, h, title = "Comment", color = "#ffd94a"}) {
    const id = "c" + (this._id++);
    const c = { id, x, y, w: Math.max(120, w), h: Math.max(80, h), title, color };
    this.comments.push(c);
    this._renderComment(c);
    this._pushHistory();
    return c;
  }

  _deleteComment(id) {
    this.comments = this.comments.filter(c => c.id !== id);
    this._selectedComments.delete(id);
    this.commentsEl?.querySelector(`[data-cid="${id}"]`)?.remove();
    this._pushHistory();
  }

  _doCommentDrag(ev) {
    if (!this._commentDrag) return;
    const dx = (ev.clientX - this._commentDrag.mx) / this._zoom;
    const dy = (ev.clientY - this._commentDrag.my) / this._zoom;
    if (Math.abs(dx) + Math.abs(dy) > 1) this._commentDrag._moved = true;
    for (const g of this._commentDrag.cmtGroup) {
      const cc = this.comments.find(x => x.id === g.id);
      if (!cc) continue;
      cc.x = Math.round(g.ox + dx);
      cc.y = Math.round(g.oy + dy);
      const el = this.commentsEl.querySelector(`[data-cid="${cc.id}"]`);
      if (el) { el.style.left = cc.x + "px"; el.style.top = cc.y + "px"; }
    }
    for (const g of this._commentDrag.nodeGroup) {
      const n = this.nodes.find(x => x.id === g.id);
      if (!n) continue;
      n.x = Math.round(g.ox + dx);
      n.y = Math.round(g.oy + dy);
      const el = this.nodesEl.querySelector(`[data-nid="${n.id}"]`);
      if (el) { el.style.left = n.x + "px"; el.style.top = n.y + "px"; }
    }
    this._scheduleEdges?.();
  }

  _doCommentResize(ev) {
    if (!this._commentResize) return;
    const r = this._commentResize;
    const c = this.comments.find(x => x.id === r.id);
    if (!c) return;
    const dx = (ev.clientX - r.mx) / this._zoom;
    const dy = (ev.clientY - r.my) / this._zoom;
    if (Math.abs(dx) + Math.abs(dy) > 1) r._moved = true;
    c.w = Math.max(120, Math.round(r.ow + dx));
    c.h = Math.max(80,  Math.round(r.oh + dy));
    const el = this.commentsEl.querySelector(`[data-cid="${c.id}"]`);
    if (el) { el.style.width = c.w + "px"; el.style.height = c.h + "px"; }
  }

  _renderNode(node) {
    this.nodesEl.querySelector(`[data-nid="${node.id}"]`)?.remove();
    const def=NODE_DEFS[node.type]; if(!def) return;
    const isOut = node.type==="output" || node.type==="attr_output" || node.type==="attr_score_val" || node.type==="skill_output" || node.type==="skill_rank_val" || node.type==="on_click";
    const noDelete = !!def.noDelete;

    node.__sig = this._resolveNodeSig ? this._resolveNodeSig(node) : null;
    let _funcBroken = false;
    if (def.isFunctionCall) {
      const lib = this._getFunctionLib ? this._getFunctionLib() : null;
      const fn  = lib?.functions?.[node.data?.functionId];
      if (!fn) _funcBroken = true;
    }

    const el=document.createElement("div");
    el.dataset.nid=node.id;
    el.dataset.type=node.type;

    const _nodeComplexity = (def.inputs?.length ?? 0) + (def.outputs?.length ?? 0) + (def.fields?.length ?? 0);
    const W = Number(def.nodeWidth) || (def.wideNode || _nodeComplexity > 18
      ? 620
      : (def.isAttackBranch || def.isBranch || def.isGenericBranch)
        ? 540
        : def.isAction
          ? 520
          : (def.isOutput || def.isAttrOutput || def.isSkillOutput)
            ? 400
            : 460);

    const _kind   = getNodeKind(def);
    const _accent = SD_NODE_KIND_COLOURS[_kind] ?? "rgba(255,255,255,.08)";

    el.dataset.kind = _kind;
    const _brokenBorder = _funcBroken ? "#e04040" : null;
    const _border = _brokenBorder ?? `${_accent}55`;
    const _borderLeft = _brokenBorder ?? _accent;
    el.style.cssText=`position:absolute;left:${node.x}px;top:${node.y}px;width:${W}px;max-width:680px;
      background:var(--sd-graph-node-bg,linear-gradient(180deg,var(--sd-bg-2),#101521));
      border:1px solid ${_border};
      border-left:3px solid ${_borderLeft};
      border-radius:8px;
      box-shadow:var(--sd-graph-node-shadow,0 18px 45px rgba(0,0,0,.5)), 0 0 0 1px ${_accent}22 inset${_funcBroken?", 0 0 0 2px rgba(224,64,64,.4) inset":""};
      overflow:hidden;
      transform:translateZ(0);`;

    let _hdrTitle = def.title;
    if (def.isFunctionCall) {
      const lib = this._getFunctionLib ? this._getFunctionLib() : null;
      const fn  = lib?.functions?.[node.data?.functionId];
      if (fn?.name) _hdrTitle = `\u0192 ${fn.name}`;
      else _hdrTitle = `\u0192 ${node.data?.functionId ? "(broken: "+node.data.functionId+")" : "(no function)"}`;
    } else if (def.isFunctionAnchor) {
      const lib = this._getFunctionLib ? this._getFunctionLib() : null;
      const fn  = lib?.functions?.[this._activeFunctionId];
      _hdrTitle = `${def.title}${fn?.name?` \u2014 ${fn.name}`:""}`;
    }

    const _hc = def.color ?? "#555";
    el.innerHTML=`
      <div class="gnhdr" data-nid="${node.id}" style="
        height:42px;display:flex;align-items:center;gap:10px;padding:0 12px;
        background:linear-gradient(90deg,${_hc}dd,${_hc}99);
        cursor:grab;user-select:none;">
        <span style="font-size:12px;font-weight:800;color:#fff;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;letter-spacing:0" title="${esc(_NL(_hdrTitle))}">${esc(_NL(_hdrTitle))}</span>
        ${def.isFunctionCall && !_funcBroken ? `<button class="nfedit" data-nid="${node.id}" title="Edit function (double-click)"
          style="width:26px;height:26px;display:grid;place-items:center;border:none;border-radius:8px;
                 background:rgba(255,255,255,.1);color:#fff;cursor:pointer;font-size:12px;line-height:1;
                 transition:.15s;flex-shrink:0"><i class="fas fa-pen"></i></button>`:""}
        ${(!isOut && !def.isWidgetConfig && !noDelete)?`<button class="ndel" data-nid="${node.id}"
          style="width:26px;height:26px;display:grid;place-items:center;border:none;border-radius:8px;
                 background:rgba(255,255,255,.1);color:#fff;cursor:pointer;font-size:16px;line-height:1;
                 transition:.15s;flex-shrink:0" aria-label="Delete node"><i class="fas fa-xmark"></i></button>`:""}
      </div>
      <div class="gnbody" style="padding:6px 0"></div>`;

    const body=el.querySelector(".gnbody");

    let inputPins  = def.computeDynamicInputs  ? def.computeDynamicInputs(node)  : (def.inputs  ?? []);
    let outputPins = def.computeDynamicOutputs ? def.computeDynamicOutputs(node) : (def.outputs ?? []);
    const fields     = def.fields??[];

    if (def.isOutput) {
      const PASSIVE = new Set(["text","derived","image","section","richtext","tags"]);
      if (this.widget && PASSIVE.has(this.widget.type)) {
        inputPins = inputPins.filter(p => p.type !== "exec");
      }
      if (this.customLoad || this.customSave) {
        inputPins = inputPins.filter(p => p.type !== "exec");
      }
    }

    if(def.dynamicPins) {
      const groups = Array.isArray(def.dynamicPins) ? def.dynamicPins : [{ ...def.dynamicPins, label: "Text" }];
      const dynPins = [];
      if (def.dynamicPinsPaired && groups.length >= 2) {
        const maxAll = Math.min(...groups.map(g => g.max));
        let connected = -1;
        for (let i = 0; i < maxAll; i++) {
          for (const grp of groups) {
            if (this.edges.some(e => e.toNode === node.id && e.toPin === `${grp.base}${i}`)) {
              connected = i;
              break;
            }
          }
        }
        const show = Math.min(connected + 2, maxAll);
        for (let i = 0; i < show; i++) {
          for (const grp of groups) {
            const pinType = grp.type ?? "value.any";
            dynPins.push({ id: `${grp.base}${i}`, label: `${grp.label} ${i + 1}`, type: pinType });
          }
        }
      } else {
        for(const grp of groups) {
          const {base, label, max, type} = grp;
          let connected = -1;
          for(let i=0;i<max;i++){
            if(this.edges.some(e=>e.toNode===node.id&&e.toPin===`${base}${i}`)) connected=i;
          }
          const show = Math.min(connected+2, max);
          const pinType = type ?? "value.any";
          for(let i=0;i<show;i++) dynPins.push({id:`${base}${i}`,label:`${label} ${i+1}`,type:pinType});
        }
      }
      inputPins = [...inputPins, ...dynPins];
    }

    const valInsRaw = inputPins.filter(p=>p.type!=="exec");

    const valIns = valInsRaw.filter(p => {
      if (!p.__autoFromField) return true;
      const f = fields.find(x => x?.key === p.id);
      if (!f?.visibleIf) return true;
      try { return !!f.visibleIf(node.data ?? {}); } catch { return true; }
    });
    const valOuts = outputPins.filter(p=>p.type!=="exec");

    const _pinConnected = (pinId) =>
      this.edges.some(e => e.toNode === node.id && e.toPin === pinId);

    const pinKeys      = new Set(valIns.map(p => p.id));
    const connectedKeys = new Set(valIns.filter(p => _pinConnected(p.id)).map(p => p.id));
    const visibleFields = fields.filter(f => !connectedKeys.has(f.key) && (!f.visibleIf || f.visibleIf(node.data)));

    const rows = [];
    for (const p of valIns) {
      const inlineFld = fields.find(f => f.key === p.id);
      rows.push({ inp:p, fld: (inlineFld && !connectedKeys.has(p.id)) ? inlineFld : null });
    }
    const usedKeys = new Set(rows.filter(r => r.fld).map(r => r.fld.key));
    for (const f of visibleFields) {
      if (!pinKeys.has(f.key) && !usedKeys.has(f.key)) rows.push({ inp:null, fld:f });
    }

    let activeExecOuts = outputPins.filter(p=>p.type==="exec");
    if (def.isSequence) {
      const count = Math.max(2, Math.min(12, parseInt(node.data?.count) || 2));
      activeExecOuts = activeExecOuts.slice(0, count);
    }

    const logicalRows = [
      ...inputPins.filter(p => p.type === "exec").map(inp => ({ inp, fld:null })),
      ...rows.filter(row => row.inp),
      ...rows.filter(row => !row.inp)
    ];
    const rightPins = [...activeExecOuts, ...valOuts];
    const rowCount = Math.max(logicalRows.length, rightPins.length, 1);
    const layout = document.createElement("div");
    layout.className = "gn-columns";

    // Each grid row owns its input pin (or a field label), matching control,
    // and output pin. Exec rows retain their empty center cell, so controls
    // never shift upward relative to the input they configure.
    for (let index = 0; index < rowCount; index++) {
      const gridRow = document.createElement("div");
      gridRow.className = "gn-node-row";
      const row = logicalRows[index];

      const inputCell = document.createElement("div");
      inputCell.className = "gn-row-cell gn-row-input";
      if (row?.inp) {
        inputCell.appendChild(this._pinEl(node, row.inp, "input"));
      } else if (row?.fld?.label) {
        const fieldLabel = document.createElement("div");
        fieldLabel.className = "gn-field-label";
        const label = _NL(row.fld.label);
        fieldLabel.textContent = label;
        fieldLabel.title = label;
        inputCell.appendChild(fieldLabel);
      }

      const controlCell = document.createElement("div");
      controlCell.className = "gn-row-cell gn-row-control";
      if (row?.fld) controlCell.appendChild(this._fldEl(node, row.fld, { hideLabel:true }));

      const outputCell = document.createElement("div");
      outputCell.className = "gn-row-cell gn-row-output";
      if (rightPins[index]) outputCell.appendChild(this._pinEl(node, rightPins[index], "output"));

      gridRow.append(inputCell, controlCell, outputCell);
      layout.appendChild(gridRow);
    }
    body.appendChild(layout);

    el.querySelector(".ndel")?.addEventListener("click",ev=>{ev.stopPropagation();this._delNode(node.id);});
    el.querySelector(".nfedit")?.addEventListener("click",ev=>{
      ev.stopPropagation();
      const fid = node.data?.functionId;
      if (fid) this._enterFunction?.(fid);
    });
    if (def.isFunctionCall) {
      el.querySelector(".gnhdr").addEventListener("dblclick", ev => {
        ev.stopPropagation();
        const fid = node.data?.functionId;
        if (fid) this._enterFunction?.(fid);
      });
    }
    el.querySelector(".gnhdr").addEventListener("mousedown",ev=>{
      if(ev.button!==0) return;
      if(ev.target.classList.contains("ndel")) return;
      if(ev.target.closest(".nfedit")) return;
      ev.stopPropagation();

      if (ev.shiftKey) {
        this._toggleSelectNode(node.id);
        return;
      }

      if (!this._selected.has(node.id)) {
        this._selected.clear();
        this._selected.add(node.id);
      }
      this._refreshSelectionHighlights();

      const group = Array.from(this._selected).map(id => {
        const n = this.nodes.find(x => x.id === id);
        return n ? { id: n.id, ox: n.x, oy: n.y } : null;
      }).filter(Boolean);

      this._drag = {
        nodeId: node.id,
        mx: ev.clientX, my: ev.clientY,
        ox: node.x,     oy: node.y,
        group
      };
    });

    this.nodesEl.appendChild(el);

    if (node.type === "literal" || node.type === "literal_str") {
      const _refreshNodeLive = () => {
        let badge = el.querySelector(".gn-src-live");
        if (!badge) {
          badge = document.createElement("div");
          badge.className = "gn-src-live";
          badge.style.cssText = "text-align:right;padding:1px 10px 3px;font-size:9px;font-family:monospace;color:#5ae07a;opacity:.8";
          el.querySelector(".gnbody").appendChild(badge);
        }
        const v = node.data.value ?? "";
        badge.textContent = v !== "" ? `out: ${v}` : "";
      };
      _refreshNodeLive();
      el.addEventListener("input", _refreshNodeLive);
    }

    if (node.type === "attr_score_val" || node.type === "attr_score") {
      const body = el.querySelector(".gnbody");
      const card = document.createElement("div");
      card.className = "gn-attr-card";
      card.style.cssText = "margin:4px 8px 5px;border:1px solid var(--sd-graph-field-border,var(--sd-border));border-radius:5px;background:var(--sd-graph-live-bg,var(--sd-bg));padding:5px 8px;display:flex;flex-direction:column;gap:3px;align-items:center";

      const scoreDisplay = document.createElement("div");
      scoreDisplay.style.cssText = "font-size:28px;font-weight:700;color:#e8c060;font-family:monospace;line-height:1;letter-spacing:-1px";

      const modDisplay = document.createElement("div");
      modDisplay.style.cssText = "font-size:11px;color:#a08040;font-family:monospace";

      card.appendChild(scoreDisplay);
      card.appendChild(modDisplay);
      body.appendChild(card);

      const _refreshAttrCard = () => {
        const doc = this.doc;
        const p = node.data.path ?? "";
        if (!doc || !p) { scoreDisplay.textContent = "-"; modDisplay.textContent = ""; return; }
        let raw;
        try { raw = FormulaEngine._readDocProperty(doc, p); } catch { raw = foundry.utils.getProperty(doc, p); }
        const score = raw !== undefined && raw !== null ? Number(raw) : null;
        if (score === null || isNaN(score)) { scoreDisplay.textContent = "?"; modDisplay.textContent = ""; return; }
        scoreDisplay.textContent = String(score);
        const mod = Math.floor((score - 10) / 2);
        modDisplay.textContent = "mod " + (mod >= 0 ? "+" + mod : mod);
      };
      _refreshAttrCard();

      el.addEventListener("input", _refreshAttrCard);
      el._refreshAttrCard = _refreshAttrCard;
    }

    if (node.type === "skill_rank_val") {
      const body = el.querySelector(".gnbody");
      const card = document.createElement("div");
      card.className = "gn-skill-card";
      card.style.cssText = "margin:4px 8px 5px;border:1px solid var(--sd-graph-field-border,var(--sd-border));border-radius:5px;background:var(--sd-graph-live-bg,var(--sd-bg));padding:5px 8px;display:flex;flex-direction:column;gap:3px;align-items:center";

      const rankDisplay = document.createElement("div");
      rankDisplay.style.cssText = "font-size:28px;font-weight:700;color:#60c0e8;font-family:monospace;line-height:1;letter-spacing:-1px";

      card.appendChild(rankDisplay);
      body.appendChild(card);

      const _refreshSkillCard = () => {
        const doc = this.doc;
        const p = node.data.path ?? "";
        if (!doc || !p) { rankDisplay.textContent = "-"; return; }
        let raw;
        try { raw = FormulaEngine._readDocProperty(doc, p); } catch { raw = foundry.utils.getProperty(doc, p); }
        const rank = raw !== undefined && raw !== null ? Number(raw) : null;
        if (rank === null || isNaN(rank)) { rankDisplay.textContent = "?"; return; }
        rankDisplay.textContent = String(rank);
      };
      _refreshSkillCard();

      el.addEventListener("input", _refreshSkillCard);
      el._refreshAttrCard = _refreshSkillCard;
    }

    el.querySelectorAll("input[placeholder*='drag']").forEach(inp=>{
      inp.addEventListener("dragover",ev=>{ev.preventDefault();inp.style.borderColor="var(--sd-accent)";});
      inp.addEventListener("dragleave",()=>inp.style.borderColor="");
      inp.addEventListener("drop",async ev=>{
        ev.preventDefault(); inp.style.borderColor="";
        try{
          const d=JSON.parse(ev.dataTransfer.getData("text/plain"));
          const uuid=d.uuid??d.id??"";
          if(uuid){inp.value=uuid;inp.dispatchEvent(new Event("input",{bubbles:true}));}
        }catch{}
      });
    });
  }

  _pinEl(node,pin,side) {
    const wrap=document.createElement("div");
    wrap.className = `gn-pin gn-pin-${side}`;
    const meta=pinTypeMeta(pin.type);
    wrap.dataset.pinType=pinSubtype(pin.type);
    wrap.title=`${pin.label || pin.id} · ${meta.label}`;
    wrap.style.cssText=`display:flex;align-items:center;gap:7px;padding:3px 8px;min-height:30px;width:100%;min-width:0;${side==="output"?"justify-content:flex-end":"justify-content:flex-start"}`;
    const dot=this._dotEl(node,pin,side);
    const lbl=document.createElement("span");
    lbl.textContent=_NL(pin.label||"");

    lbl.style.cssText="font-size:11px;color:var(--sd-text-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;line-height:1;letter-spacing:0";
    const kind=document.createElement("span");
    kind.className="gn-pin-kind";
    kind.textContent=meta.short;
    kind.style.setProperty("--pin-color",meta.color);
    if(side==="input"){wrap.appendChild(dot);wrap.appendChild(lbl);wrap.appendChild(kind);}
    else{wrap.appendChild(kind);wrap.appendChild(lbl);wrap.appendChild(dot);}
    return wrap;
  }

  _dotEl(node,pin,side) {
    const isExec=pin.type==="exec";
    const meta=pinTypeMeta(pin.type);
    const dot=document.createElement("div");
    dot.className=`gpin gpin-shape-${meta.shape}${meta.container?" gpin-container":""}${meta.structured?" gpin-structured":""}`;
    dot.dataset.nid=node.id; dot.dataset.pid=pin.id; dot.dataset.side=side;
    dot.dataset.pinType=pinSubtype(pin.type);
    dot.style.setProperty("--pin-color",meta.color);
    const glyph=document.createElement("span");
    glyph.className="gpin-glyph";
    glyph.textContent=meta.glyph;
    dot.appendChild(glyph);
    const _typeColor = meta.color;
    const _connected = (side === "output")
      ? this.edges.some(e => e.fromNode === node.id && e.fromPin === pin.id)
      : this.edges.some(e => e.toNode  === node.id && e.toPin   === pin.id);
    dot.dataset.connected = _connected ? "1" : "0";
    const _fill = _connected ? _typeColor : "transparent";
    const _restingShadow = _connected ? "0 0 0 1px rgba(0,0,0,.35) inset" : "none";
    dot.style.cssText+=`width:18px;height:18px;
      background:${_fill};border:2px solid ${_typeColor};
      box-shadow:${_restingShadow};
      cursor:crosshair;flex-shrink:0;
      transition:transform .12s ease,box-shadow .12s ease,background .12s ease;`;
    dot.addEventListener("mousedown",ev=>{
      ev.stopPropagation();
      if(side==="output") this._startConn(node.id,pin.id,isExec,ev,pin.type);
    });
    dot.addEventListener("contextmenu",ev=>{
      ev.preventDefault();
      ev.stopPropagation();
      const hasEdge = side==="output"
        ? this.edges.some(e=>e.fromNode===node.id&&e.fromPin===pin.id)
        : this.edges.some(e=>e.toNode===node.id&&e.toPin===pin.id);
      if (isExec) { if (hasEdge) this._disconnectPin(node, pin, side); return; }
      this._pinContextMenu(ev, node, pin, side, hasEdge);
    });
    dot.addEventListener("mouseenter",()=>{
      dot.classList.add("is-hovered");
      dot.style.boxShadow="0 0 0 6px rgba(255,255,255,.1)";
      const hasEdge = side==="output"
        ? this.edges.some(e=>e.fromNode===node.id&&e.fromPin===pin.id)
        : this.edges.some(e=>e.toNode===node.id&&e.toPin===pin.id);
      const actionHint=isExec ? (hasEdge ? " · RMB: disconnect" : "") : " · RMB: Promote to Var / Disconnect";
      dot.title = `${meta.label} pin${actionHint}`;
    });
    dot.addEventListener("mouseleave",()=>{
      dot.classList.remove("is-hovered");
      dot.style.boxShadow = (dot.dataset.connected === "1") ? "0 0 0 1px rgba(0,0,0,.35) inset" : "none";
    });
    return dot;
  }

  _disconnectPin(node, pin, side) {
    const before = this.edges.length;
    const touched = new Set([node.id]);
    if (side === "output") {
      for (const e of this.edges) if (e.fromNode===node.id && e.fromPin===pin.id) touched.add(e.toNode);
      this.edges = this.edges.filter(e=>!(e.fromNode===node.id&&e.fromPin===pin.id));
    } else {
      for (const e of this.edges) if (e.toNode===node.id && e.toPin===pin.id) touched.add(e.fromNode);
      this.edges = this.edges.filter(e=>!(e.toNode===node.id&&e.toPin===pin.id));
    }
    if (this.edges.length !== before) {
      for (const tid of touched) { const tn = this.nodes.find(n => n.id === tid); if (tn) this._renderNode(tn); }
      this._redrawEdges();
      this._updatePreview();
      this._pushHistory();
    }
  }

  _pinContextMenu(ev, node, pin, side, hasEdge) {
    const doc = this._uiDocument();
    const view = this._uiWindow();
    doc.querySelector(".sd-pin-menu")?.remove();
    const menu = doc.createElement("div");
    menu.className = "sd-pin-menu";
    menu.style.cssText = `position:fixed;left:${ev.clientX}px;top:${ev.clientY}px;z-index:100000;background:var(--sd-bg,#1e1e2a);border:1px solid var(--sd-accent,#7b68ee);border-radius:6px;padding:4px;min-width:190px;box-shadow:0 6px 24px rgba(0,0,0,.6);font-size:12px;color:var(--sd-text,#e0e0ee)`;
    const mkItem = (label, icon, fn) => {
      const it = doc.createElement("div");
      it.style.cssText = "padding:6px 10px;border-radius:4px;cursor:pointer;display:flex;gap:8px;align-items:center";
      it.innerHTML = `<i class="fas ${icon}" style="width:14px;opacity:.75"></i>${label}`;
      it.addEventListener("mouseenter",()=>it.style.background="rgba(123,104,238,.25)");
      it.addEventListener("mouseleave",()=>it.style.background="");
      it.addEventListener("click",()=>{ menu.remove(); fn(); });
      menu.appendChild(it);
    };
    mkItem("Promote to Var (local)", "fa-square-plus", () => this._promotePinToVar(node, pin, side, "local"));
    mkItem("Promote to Var (actor)", "fa-user-plus",   () => this._promotePinToVar(node, pin, side, "actor"));
    if (hasEdge) mkItem("Disconnect", "fa-link-slash", () => this._disconnectPin(node, pin, side));
    doc.body.appendChild(menu);
    const r = menu.getBoundingClientRect();
    if (r.right  > view.innerWidth)  menu.style.left = Math.max(4, view.innerWidth  - r.width  - 8) + "px";
    if (r.bottom > view.innerHeight) menu.style.top  = Math.max(4, view.innerHeight - r.height - 8) + "px";
    const close = (e) => {
      if (!menu.contains(e.target)) { menu.remove(); doc.removeEventListener("mousedown", close, true); }
    };
    setTimeout(()=>doc.addEventListener("mousedown", close, true), 0);
  }

  _promotePinToVar(node, pin, side, scope = "local") {
    const base = String(pin.label || pin.id || "var").replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "var";
    const used = new Set(this.nodes.map(n => n?.data?.name).filter(Boolean));
    let name = base, i = 1;
    while (used.has(name)) name = `${base}_${i++}`;
    if (side === "input") {
      const vn = this._addNode("var_read", (node.x ?? 0) - 250, (node.y ?? 0) + 30);
      if (!vn) return;
      vn.data.name = name; vn.data.scope = scope;
      this.edges = this.edges.filter(e => !(e.toNode === node.id && e.toPin === pin.id));
      this._addEdge(vn.id, "v", node.id, pin.id);
      this._renderNode(vn);
    } else {
      const vn = this._addNode("var_write", (node.x ?? 0) + 290, (node.y ?? 0) + 30);
      if (!vn) return;
      vn.data.name = name; vn.data.scope = scope;
      this._addEdge(node.id, pin.id, vn.id, "value");
      this._renderNode(vn);
    }
    this._scheduleEdges?.();
    this._updatePreview();
    ui.notifications?.info?.(`Variable "${name}" (${scope}) created`);
  }

  async _editMessageComposerButtons(node) {
    const buttons = _messageComposerButtons(node?.data);
    const variants = [
      ["primary", "Primary"],
      ["secondary", "Secondary"],
      ["success", "Success"],
      ["danger", "Danger"],
      ["warning", "Warning"]
    ];
    const rows = buttons.map((button, index) => `
      <div class="sd-message-button-editor-row" data-index="${index}" style="display:grid;grid-template-columns:32px minmax(150px,1.3fr) minmax(150px,1fr) minmax(120px,.8fr);gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid var(--sd-border)">
        <input type="checkbox" name="enabled${index}" ${button.enabled ? "checked" : ""} aria-label="Enable button ${index + 1}" style="width:16px;height:16px;margin:auto;accent-color:var(--sd-accent)">
        <input type="text" name="label${index}" value="${esc(button.label)}" placeholder="Button label" style="width:100%;height:30px;box-sizing:border-box;background:var(--sd-bg-3);border:1px solid var(--sd-border);border-radius:6px;color:var(--sd-text);padding:0 8px">
        <input type="text" name="icon${index}" value="${esc(button.icon)}" placeholder="fas fa-check" style="width:100%;height:30px;box-sizing:border-box;background:var(--sd-bg-3);border:1px solid var(--sd-border);border-radius:6px;color:var(--sd-text);padding:0 8px;font-family:monospace">
        <select name="variant${index}" style="width:100%;height:30px;box-sizing:border-box;background:var(--sd-bg-3);border:1px solid var(--sd-border);border-radius:6px;color:var(--sd-text);padding:0 6px">
          ${variants.map(([value, label]) => `<option value="${value}" ${button.variant === value ? "selected" : ""}>${label}</option>`).join("")}
        </select>
      </div>`).join("");

    const DialogV2 = foundry.applications.api.DialogV2;
    const result = await DialogV2.wait({
      window:{title:"Message Composer Buttons", resizable:true},
      position:{width:700},
      modal:true,
      content:`
        <div class="sd-message-button-editor" style="min-width:600px;padding:4px 2px">
          <div style="display:grid;grid-template-columns:32px minmax(150px,1.3fr) minmax(150px,1fr) minmax(120px,.8fr);gap:8px;padding:0 0 5px;color:var(--sd-text-3);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0">
            <span>On</span><span>Label</span><span>Icon class</span><span>Style</span>
          </div>
          ${rows}
        </div>`,
      buttons:[
        {
          action:"save", label:"Save", icon:"fas fa-floppy-disk", default:true,
          callback:(event, button, dialog) => {
            const root = dialog?.element ?? dialog;
            return buttons.map((existing, index) => ({
              id:`btn${index}`,
              enabled:!!root?.querySelector?.(`[name="enabled${index}"]`)?.checked,
              label:root?.querySelector?.(`[name="label${index}"]`)?.value?.trim() || existing.label,
              icon:root?.querySelector?.(`[name="icon${index}"]`)?.value?.trim() || existing.icon,
              variant:root?.querySelector?.(`[name="variant${index}"]`)?.value || existing.variant
            }));
          }
        },
        {action:"cancel", label:"Cancel", callback:()=>null}
      ],
      rejectClose:false
    }).catch(() => null);

    if (!Array.isArray(result)) return;
    node.data.buttons = result;
    this._renderNode(node);
    this._redrawEdges();
    this._updatePreview();
    this._pushHistory();
  }

  _fldEl(node,field,opts){
    opts = opts || {};
    const wrap=document.createElement("div");
    wrap.className = "gn-control";
    wrap.style.cssText="display:flex;align-items:center;gap:6px;padding:3px 6px;min-height:30px;flex:1 1 auto;min-width:0;width:100%";
    if(field.label && !opts.hideLabel){
      const l=document.createElement("label");
      const lbl=_NL(field.label);
      l.textContent=lbl;
      l.style.cssText="font-size:10px;color:var(--sd-label,var(--sd-text-2));white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:110px;flex-shrink:1;min-width:0;font-weight:600;letter-spacing:0;text-transform:uppercase;margin-right:2px";
      l.title=lbl;
      wrap.appendChild(l);
    }

    const IS="background:var(--sd-graph-field-bg,var(--sd-bg-3));border:1px solid var(--sd-graph-field-border,var(--sd-border));border-radius:6px;color:var(--sd-text);font-size:12px;padding:5px 8px;font-family:monospace;outline:none;min-width:0;max-width:100%;width:100%;box-sizing:border-box;height:28px";
    const SI=IS+";cursor:pointer";
    const idx=this._smartIndex??{slots:[],ownedItems:[],effects:[],widgets:[],invItemSlots:[]};

    if (field.type === "message-buttons-editor") {
      const buttons = _messageComposerButtons(node?.data);
      const enabled = buttons.filter(button => button.enabled);
      const control = document.createElement("button");
      control.type = "button";
      control.title = "Configure message buttons";
      control.style.cssText = "width:100%;height:30px;display:flex;align-items:center;justify-content:center;gap:7px;background:var(--sd-bg-3);border:1px solid var(--sd-border);border-radius:6px;color:var(--sd-text-2);cursor:pointer;font-size:11px";
      control.innerHTML = `<i class="fas fa-sliders"></i><span>${enabled.length} button${enabled.length === 1 ? "" : "s"}</span>`;
      control.addEventListener("mousedown", event => event.stopPropagation());
      control.addEventListener("click", event => {
        event.stopPropagation();
        this._editMessageComposerButtons(node);
      });
      wrap.appendChild(control);
      return wrap;
    }

    if(field.type==="slot-picker"){
      const cur=node.data[field.key]??field.default??"slot1";
      const sel=document.createElement("select"); sel.style.cssText=SI; sel.title="Slot ID - auto-indexed";
      const groups={self:[],actor:[],items:{}};
      for(const s of idx.slots){
        if(s.source==="self") groups.self.push(s);
        else if(s.source==="actor") groups.actor.push(s);
        else (groups.items[s.source]||(groups.items[s.source]=[])).push(s);
      }
      const curPath=node.data.slotPath??null;
      const addGrp=(lbl,list)=>{
        if(!list.length) return;
        const g=document.createElement("optgroup"); g.label=lbl;
        for(const s of list){
          const o=document.createElement("option"); o.value=s.id;
          o.textContent=`${s.id} - ${s.label}`;
          if(s.slotPath!=null) o.dataset.slotPath=s.slotPath;
          const isMatch = s.id===cur && (curPath==null || curPath===s.slotPath || (!s.slotPath && curPath==null));
          if(isMatch) o.selected=true;
          g.appendChild(o);
        }
        sel.appendChild(g);
      };
      if(idx.slots.length===0){ const o=document.createElement("option"); o.value=cur||"slot1"; o.textContent=(cur||"slot1")+" (no slots found)"; sel.appendChild(o); }
      else { addGrp("Self",groups.self); addGrp("Actor",groups.actor); for(const [,list] of Object.entries(groups.items)) { const srcName=list[0]?.label?.match(/\[(.+)\]/)?.[1]??"Item"; addGrp(srcName,list); } }
      if(cur && !idx.slots.find(s=>s.id===cur)){ const o=document.createElement("option"); o.value=cur; o.textContent=cur+" (custom)"; o.selected=true; sel.appendChild(o); }
      sel.addEventListener("mousedown",ev=>ev.stopPropagation());
      sel.addEventListener("change",()=>{
        node.data[field.key]=sel.value;
        const selOpt=sel.options[sel.selectedIndex];
        node.data.slotPath = selOpt?.dataset?.slotPath ?? null;
        this._updatePreview();
      });
      wrap.appendChild(sel); return wrap;
    }

    if(field.type==="item-picker"){
      const cur=node.data[field.key]??field.default??"";
      const sel=document.createElement("select"); sel.style.cssText=SI; sel.title="Owned item - auto-indexed";
      { const o=document.createElement("option"); o.value=""; o.textContent="- pick item -"; if(!cur)o.selected=true; sel.appendChild(o); }
      const byType={};
      for(const it of idx.ownedItems)(byType[it.type]||(byType[it.type]=[])).push(it);
      for(const [tp,list] of Object.entries(byType)){
        const g=document.createElement("optgroup"); g.label=tp;
        for(const it of list){ const o=document.createElement("option"); o.value=it.name; o.textContent=it.name; if(it.name===cur)o.selected=true; g.appendChild(o); }
        sel.appendChild(g);
      }
      if(cur && !idx.ownedItems.find(i=>i.name===cur)){ const o=document.createElement("option"); o.value=cur; o.textContent=cur+" (custom)"; o.selected=true; sel.appendChild(o); }
      sel.addEventListener("mousedown",ev=>ev.stopPropagation());
      sel.addEventListener("change",()=>{ node.data[field.key]=sel.value; this._updatePreview(); this._renderNode(node); });
      wrap.appendChild(sel); return wrap;
    }

    if(field.type==="effect-picker"){
      const cur=node.data[field.key]??field.default??"";
      const sel=document.createElement("select"); sel.style.cssText=SI; sel.title="Active Effect - auto-indexed";
      { const o=document.createElement("option"); o.value=""; o.textContent="- pick effect -"; if(!cur)o.selected=true; sel.appendChild(o); }
      for(const fx of idx.effects){ const o=document.createElement("option"); o.value=fx.name; o.textContent=fx.name; if(fx.name===cur)o.selected=true; sel.appendChild(o); }
      if(cur && !idx.effects.find(e=>e.name===cur)){ const o=document.createElement("option"); o.value=cur; o.textContent=cur+" (custom)"; o.selected=true; sel.appendChild(o); }
      sel.addEventListener("mousedown",ev=>ev.stopPropagation());
      sel.addEventListener("change",()=>{ node.data[field.key]=sel.value; this._updatePreview(); });
      wrap.appendChild(sel); return wrap;
    }

    if(field.type==="effect-uuid-picker"){
      const cur=node.data[field.key]??field.default??"";
      const container=document.createElement("div"); container.style.cssText="display:flex;flex-direction:column;gap:2px;flex:1;min-width:0";
      const sel=document.createElement("select"); sel.style.cssText=SI; sel.title="Effect - picks UUID automatically";
      { const o=document.createElement("option"); o.value=""; o.textContent="- pick effect -"; if(!cur)o.selected=true; sel.appendChild(o); }
      for(const fx of idx.effects){ const o=document.createElement("option"); o.value=fx.uuid; o.textContent=fx.name; if(fx.uuid===cur)o.selected=true; sel.appendChild(o); }
      if(cur && !idx.effects.find(e=>e.uuid===cur)){ const o=document.createElement("option"); o.value=cur; o.textContent=cur+" (custom uuid)"; o.selected=true; sel.appendChild(o); }
      const rawInp=document.createElement("input"); rawInp.type="text"; rawInp.placeholder="or paste UUID..."; rawInp.value=cur;
      rawInp.style.cssText=IS+";font-size:11px;color:var(--sd-text-2)";
      sel.addEventListener("mousedown",ev=>ev.stopPropagation());
      rawInp.addEventListener("mousedown",ev=>ev.stopPropagation());
      sel.addEventListener("change",()=>{ node.data[field.key]=sel.value; rawInp.value=sel.value; this._updatePreview(); });
      rawInp.addEventListener("input",()=>{ node.data[field.key]=rawInp.value; this._updatePreview(); });
      container.appendChild(sel); container.appendChild(rawInp); wrap.appendChild(container); return wrap;
    }

    if(field.type==="widget-picker"){
      const cur=node.data[field.key]??field.default??"";
      const sel=document.createElement("select"); sel.style.cssText=SI; sel.title="Widget key - auto-indexed from tabs";
      { const o=document.createElement("option"); o.value=""; o.textContent="- any widget -"; if(!cur)o.selected=true; sel.appendChild(o); }
      for(const w of idx.widgets){ const o=document.createElement("option"); o.value=w.key; o.textContent=`${w.label} [${w.type}]`; if(w.key===cur)o.selected=true; sel.appendChild(o); }
      if(cur && !idx.widgets.find(w=>w.key===cur)){ const o=document.createElement("option"); o.value=cur; o.textContent=cur+" (custom)"; o.selected=true; sel.appendChild(o); }
      sel.addEventListener("mousedown",ev=>ev.stopPropagation());
      sel.addEventListener("change",()=>{ node.data[field.key]=sel.value; this._updatePreview(); });
      wrap.appendChild(sel); return wrap;
    }

    if(field.type==="inv-item-slot"){
      const itemKey=field.itemKey??"itemName";
      const slotKey=field.slotKey??"slotId";
      const curItem=node.data[itemKey]??"";
      const curSlot=node.data[slotKey]??"slot1";
      const container=document.createElement("div"); container.style.cssText="display:flex;flex-direction:column;gap:2px;flex:1;min-width:0";

      const selItem=document.createElement("select"); selItem.style.cssText=SI; selItem.title="Container item";
      { const o=document.createElement("option"); o.value=""; o.textContent="- container item -"; if(!curItem)o.selected=true; selItem.appendChild(o); }
      const byType={};
      for(const it of idx.ownedItems)(byType[it.type]||(byType[it.type]=[])).push(it);
      for(const [tp,list] of Object.entries(byType)){
        const g=document.createElement("optgroup"); g.label=tp;
        for(const it of list){ const hasSlots=idx.invItemSlots.some(s=>s.itemId===it.id); const o=document.createElement("option"); o.value=it.name; o.textContent=it.name+(hasSlots?" [slots]":""); if(it.name===curItem)o.selected=true; g.appendChild(o); }
        selItem.appendChild(g);
      }

      const selSlot=document.createElement("select"); selSlot.style.cssText=SI; selSlot.title="Slot on that item";
      const buildSlotOpts=()=>{
        while(selSlot.firstChild)selSlot.removeChild(selSlot.firstChild);
        const chosen=idx.ownedItems.find(i=>i.name===selItem.value);
        const slots=chosen ? idx.invItemSlots.filter(s=>s.itemId===chosen.id) : [];
        if(!slots.length){ const o=document.createElement("option"); o.value=node.data[slotKey]||"slot1"; o.textContent=(node.data[slotKey]||"slot1")+" (no indexed slots)"; selSlot.appendChild(o); return; }
        for(const s of slots){ const o=document.createElement("option"); o.value=s.slotId; o.textContent=`${s.slotId} - ${s.slotLabel}`; if(s.slotId===curSlot)o.selected=true; selSlot.appendChild(o); }
      };
      buildSlotOpts();

      selItem.addEventListener("mousedown",ev=>ev.stopPropagation());
      selSlot.addEventListener("mousedown",ev=>ev.stopPropagation());
      selItem.addEventListener("change",()=>{ node.data[itemKey]=selItem.value; buildSlotOpts(); this._updatePreview(); });
      selSlot.addEventListener("change",()=>{ node.data[slotKey]=selSlot.value; this._updatePreview(); });
      container.appendChild(selItem); container.appendChild(selSlot); wrap.appendChild(container); return wrap;
    }

    if(field.type==="item-uuid-drag"){
      const curUuid=node.data[field.key]??"";
      const curName=node.data["itemName"]??"";
      const container=document.createElement("div"); container.style.cssText="display:flex;flex-direction:column;gap:3px;flex:1;min-width:0";

      const selItem=document.createElement("select"); selItem.style.cssText=SI; selItem.title="Pick owned item by name";
      { const o=document.createElement("option"); o.value=""; o.textContent="- pick owned item -"; if(!curName)o.selected=true; selItem.appendChild(o); }
      const byType2={};
      for(const it of idx.ownedItems)(byType2[it.type]||(byType2[it.type]=[])).push(it);
      for(const [tp,list] of Object.entries(byType2)){
        const g=document.createElement("optgroup"); g.label=tp;
        for(const it of list){ const o=document.createElement("option"); o.value=it.name; o.dataset.uuid=it.uuid; o.textContent=it.name; if(it.name===curName)o.selected=true; g.appendChild(o); }
        selItem.appendChild(g);
      }
      selItem.addEventListener("mousedown",ev=>ev.stopPropagation());
      selItem.addEventListener("change",()=>{
        const chosen=idx.ownedItems.find(i=>i.name===selItem.value);
        node.data["itemName"]=selItem.value;
        node.data[field.key]=chosen?.uuid??"";
        dropZone.textContent=chosen ? `OK ${chosen.name}` : "Drop item here";
        dropZone.style.color=chosen?"#6aaa6a":"#5a7a9a";
        this._updatePreview();
      });

      const dropZone=document.createElement("div");
      const hasVal=curUuid||curName;
      dropZone.textContent=hasVal ? `OK ${curName||curUuid}` : "Drop item here";
      dropZone.style.cssText=`background:var(--sd-graph-live-bg,var(--sd-bg));border:2px dashed ${hasVal?"var(--sd-success)":"var(--sd-border)"};border-radius:4px;color:${hasVal?"var(--sd-success)":"var(--sd-text-3)"};font-size:11px;padding:5px 8px;text-align:center;cursor:copy;transition:border-color .15s,color .15s;`;
      dropZone.title="Drag an item from the Foundry sidebar to auto-fill UUID";
      dropZone.addEventListener("dragover",ev=>{ ev.preventDefault(); dropZone.style.borderColor="var(--sd-accent)"; dropZone.style.color="var(--sd-accent)"; });
      dropZone.addEventListener("dragleave",()=>{ dropZone.style.borderColor=node.data[field.key]?"var(--sd-success)":"var(--sd-border)"; dropZone.style.color=node.data[field.key]?"var(--sd-success)":"var(--sd-text-3)"; });
      dropZone.addEventListener("drop",async ev=>{
        ev.preventDefault();
        try{
          const d=JSON.parse(ev.dataTransfer.getData("text/plain"));
          const uuid=d.uuid??d.id??"";
          if(!uuid) return;
          node.data[field.key]=uuid;

          const found=idx.ownedItems.find(i=>i.uuid===uuid)||idx.ownedItems.find(i=>i.id===d.id);
          const label=found?.name ?? d.name ?? uuid;
          node.data["itemName"]=found?.name??"";
          dropZone.textContent=`OK ${label}`;
          dropZone.style.borderColor="var(--sd-success)"; dropZone.style.color="var(--sd-success)";

          const opt=[...selItem.options].find(o=>o.value===(found?.name??""));
          if(opt) selItem.value=opt.value;
          this._updatePreview();
        }catch{}
      });

      dropZone.addEventListener("dblclick",()=>{
        node.data[field.key]=""; node.data["itemName"]="";
        dropZone.textContent="Drop item here";
        dropZone.style.borderColor="var(--sd-border)"; dropZone.style.color="var(--sd-text-3)";
        selItem.value=""; this._updatePreview();
      });

      container.appendChild(selItem); container.appendChild(dropZone); wrap.appendChild(container); return wrap;
    }

    if (["quest-id","subtask-id","reward-id"].includes(field.type)) {
      const select = document.createElement("select");
      select.style.cssText = IS + ";cursor:pointer";
      const current = String(node.data[field.key] ?? field.default ?? "");
      const addOption = (value, label, group = null) => {
        const option = document.createElement("option");
        option.value = String(value ?? ""); option.textContent = _NL(label);
        if (option.value === current) option.selected = true;
        (group ?? select).appendChild(option);
      };
      if (field.allowBlank !== false) addOption("", field.blankLabel ?? "Any");
      if (field.allowThis !== false) addOption("this", field.thisLabel ?? "Current");
      const quests = (this.doc?.type === "questlog" && Array.isArray(this.doc?.system?.quests)) ? this.doc.system.quests : [];
      if (field.type === "quest-id") {
        for (const quest of quests) addOption(quest.id, quest.name || quest.id);
      } else {
        for (const quest of quests) {
          const list = field.type === "subtask-id" ? (quest.subtasks ?? []) : (quest.rewards ?? []);
          if (!list.length) continue;
          const group = document.createElement("optgroup"); group.label = quest.name || quest.id;
          for (const entry of list) addOption(entry.id, entry.name || entry.id, group);
          select.appendChild(group);
        }
      }
      if (current && ![...select.options].some(option => option.value === current)) addOption(current, `${current} (saved)`);
      select.addEventListener("mousedown", ev => ev.stopPropagation());
      select.addEventListener("change", () => { node.data[field.key] = select.value; this._updatePreview(); });
      wrap.appendChild(select);
      return wrap;
    }

    let inp;
    if(field.type==="bool"){
      inp=document.createElement("input");
      inp.type="checkbox";
      const curB = node.data[field.key];
      const asBool = (value) => {
        if (typeof value === "boolean") return value;
        if (typeof value === "number") return value !== 0;
        const s = String(value ?? "").trim().toLowerCase();
        return ["1", "true", "yes", "on"].includes(s);
      };
      inp.checked = (curB === undefined || curB === null) ? asBool(field.default) : asBool(curB);
      inp.style.cssText = "width:16px;height:16px;cursor:pointer;accent-color:var(--sd-accent);margin:0;flex-shrink:0";
      inp.dataset.fieldType=field.type;
      inp.addEventListener("mousedown",ev=>ev.stopPropagation());
      inp.addEventListener("change",ev=>{
        node.data[field.key]=ev.target.checked;
        this._updatePreview();
      });
      wrap.appendChild(inp);
      return wrap;
    }
    else if(field.type==="select"){
      inp=document.createElement("select");
      inp.style.cssText=IS+";cursor:pointer";

      const cur = node.data[field.key]??field.default;
      const fieldOptions = typeof field.options === "function" ? (field.options(node, this) ?? []) : (field.options ?? []);
      for(const o of fieldOptions){
        const oel=document.createElement("option");
        const val = (o && typeof o === "object") ? String(o.value ?? "") : String(o);
        const lbl = (o && typeof o === "object") ? String(o.label ?? o.value ?? "") : String(o);
        oel.value       = val;
        oel.textContent = _NL(lbl);
        if(val === String(cur ?? "")) oel.selected = true;
        inp.appendChild(oel);
      }
    } else if (field.type === "textarea") {
      inp = document.createElement("textarea");
      inp.value = node.data[field.key] ?? field.default ?? "";
      inp.placeholder = _NL(field.placeholder ?? (String(field.default ?? "") || ""));
      inp.rows = Number(field.rows ?? 6);
      inp.style.cssText = IS + ";font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11px;line-height:1.35;resize:vertical;min-height:64px;";
    } else {
      inp=document.createElement("input");
      inp.type=field.type==="number"?"number":"text";
      inp.value=node.data[field.key]??field.default??"";
      inp.placeholder=_NL(field.placeholder??(String(field.default??"")||""));
      inp.style.cssText=IS;
    }
    inp.dataset.fieldType=field.type;
    inp.addEventListener("focus",()=>inp.style.borderColor="var(--sd-accent)");
    inp.addEventListener("blur", ()=>inp.style.borderColor="#1a1a28");
    inp.addEventListener("mousedown",ev=>ev.stopPropagation());
    const _IS_TEXTUAL = (field.type === "text" || field.type === "textarea" || field.type === "path" || field.type === "formula" || field.type === "number");
    const _fullRerenderIfDynamic = () => {
      const _defV = NODE_DEFS[node.type];
      const _hasVis = _defV?.fields?.some(f => typeof f.visibleIf === "function");
      const _hasDyn = typeof _defV?.computeDynamicOutputs === "function" || typeof _defV?.computeDynamicInputs === "function";
      if (_hasVis || _hasDyn) {
        this._renderNode(node);
        this._scheduleEdges?.();
        return true;
      }
      return false;
    };
    if (_IS_TEXTUAL) {
      inp.addEventListener("change", () => {
        const _def3 = NODE_DEFS[node.type];
        if (_def3?.isSequence && field.key === "count") {
          const c = Math.max(2, Math.min(12, Number(inp.value) || 2));
          node.data.count = c;
          this._renderNode(node);
          this._scheduleEdges?.();
          return;
        }
        _fullRerenderIfDynamic();
      });
    }
    inp.addEventListener("input",ev=>{
      node.data[field.key]=inp.type==="number"?Number(ev.target.value):ev.target.value;
      this._updatePreview();
      if(field.type==="path" && liveBadge) _refreshLiveBadge();

      if (!_IS_TEXTUAL) {
        if (_fullRerenderIfDynamic()) return;
      }
      const _def2 = NODE_DEFS[node.type];
      if (!_IS_TEXTUAL && _def2?.isSequence && field.key === "count") {
        const c = Math.max(2, Math.min(12, Number(ev.target.value) || 2));
        node.data.count = c;
        this._renderNode(node);
        this._scheduleEdges?.();
      }
    });
    wrap.appendChild(inp);

    if (field.valueElementDatalist) {
      const dlId2 = "sd-wb-el-dl-" + node.id + "-" + field.key;
      const dl2 = document.createElement("datalist");
      dl2.id = dlId2;
      const fillDl2 = () => {
        dl2.innerHTML = "";
        try {
          const els2 = Array.isArray(this.widget?.elements) ? this.widget.elements : [];
          for (const el3 of els2) {
            if (String(el3?.kind ?? "") !== "value") continue;
            const nm3 = String(el3?.name ?? "").trim();
            if (!nm3) continue;
            const o3 = document.createElement("option");
            o3.value = nm3;
            dl2.appendChild(o3);
          }
        } catch (err) { /* noop */ }
      };
      fillDl2();
      inp.setAttribute("list", dlId2);
      inp.addEventListener("focus", fillDl2);
      wrap.appendChild(dl2);
    }
    if (field.customEventDatalist && typeof this._collectCustomEventNames === "function") {
      try {
        const dlId = "sd-ce-dl-" + String(node.id) + "-" + String(field.key);
        const dl = document.createElement("datalist");
        dl.id = dlId;
        const fillDl = () => {
          dl.innerHTML = "";
          for (const nm of this._collectCustomEventNames()) {
            const o = document.createElement("option");
            o.value = nm;
            dl.appendChild(o);
          }
        };
        fillDl();
        inp.setAttribute("list", dlId);
        inp.addEventListener("focus", fillDl);
        wrap.appendChild(dl);
      } catch (e) {}
    }
    if (field.uniqueEventName) {
      let dupWarnEl = null;
      const _checkUniqueEventName = () => {
        const val = String(node.data[field.key] ?? "").trim();
        const dup = !!val && this.nodes.some(n2 =>
          n2 !== node && n2.type === node.type &&
          String(n2.data?.[field.key] ?? "").trim() === val);
        if (dup) {
          const msg = _sdCE_T("DupName", "This name is already used by another Custom Event node");
          inp.style.borderColor = "var(--sd-danger, #e05555)";
          inp.style.boxShadow = "0 0 0 1px rgba(224,85,85,.5)";
          inp.title = msg;
          if (!dupWarnEl) {
            dupWarnEl = document.createElement("div");
            dupWarnEl.style.cssText = "font-size:9px;color:#e05555;margin-top:2px;line-height:1.3;white-space:normal";
            wrap.appendChild(dupWarnEl);
          }
          dupWarnEl.textContent = msg;
        } else {
          inp.style.borderColor = "#1a1a28";
          inp.style.boxShadow = "";
          inp.title = "";
          if (dupWarnEl) { dupWarnEl.remove(); dupWarnEl = null; }
        }
      };
      inp.addEventListener("input", _checkUniqueEventName);
      inp.addEventListener("blur", () => _checkUniqueEventName());
      _checkUniqueEventName();
    }

    let liveBadge = null;
    const _refreshLiveBadge = () => {
      const doc = this.doc;
      if (!doc || !liveBadge) return;
      const p = node.data[field.key] ?? "";
      if (!p) { liveBadge.textContent = ""; return; }
      let raw;
        try { raw = FormulaEngine._readDocProperty(doc, p); } catch { raw = foundry.utils.getProperty(doc, p); }
      const v = raw !== undefined && raw !== null ? String(raw) : "?";
      liveBadge.textContent = "= " + v;
    };
    if (field.type === "path" && this.doc) {
      liveBadge = document.createElement("span");
      liveBadge.style.cssText = "font-size:9px;color:#5ae07a;font-family:monospace;white-space:nowrap;flex-shrink:0;margin-left:2px;opacity:.85";
      _refreshLiveBadge();
      wrap.appendChild(liveBadge);
    }

    return wrap;
  }

  _collectCustomEventNames() {
    const names = new Set();
    const add = (v) => { const s = String(v ?? "").trim(); if (s) names.add(s); };
    const scanGraphData = (gd) => {
      for (const n of (gd?.nodes ?? [])) if (n?.type === "custom_event") add(n.data?.name);
    };
    const scanCompiled = (raw) => {
      if (typeof raw !== "string" || !raw.includes("custom_event::")) return;
      try {
        const obj = JSON.parse(raw);
        for (const [k, ev] of Object.entries(obj?._events ?? {})) {
          if (k.startsWith("custom_event::")) add(ev?.data?.name);
        }
      } catch (e) {}
    };
    const scanWidget = (w) => {
      if (!w || typeof w !== "object") return;
      scanCompiled(w.formula);
      scanCompiled(w.onClickFormula);
      for (const v of Object.values(w)) {
        if (!v || typeof v !== "object") continue;
        if (Array.isArray(v?.nodes)) { scanGraphData(v); continue; }
        for (const sub of Object.values(v)) {
          if (sub && typeof sub === "object" && Array.isArray(sub.graphData?.nodes)) scanGraphData(sub.graphData);
        }
      }
    };
    const scanDoc = (d) => {
      if (!d?.system) return;
      for (const tab of (d.system.customTabs ?? []))
        for (const row of (tab?.rows ?? []))
          for (const w of (row?.widgets ?? [])) scanWidget(w);
      const stg = d.system.sdTriggerGraph;
      if (stg && typeof stg === "object") {
        scanGraphData(stg._graphData);
        try { scanCompiled(JSON.stringify(stg)); } catch (e) {}
      } else if (typeof stg === "string") scanCompiled(stg);
    };
    for (const n of this.nodes) if (n?.type === "custom_event") add(n.data?.name);
    try {
      const doc = this.doc;
      scanDoc(doc);
      const actor = doc?.documentName === "Item" ? doc.actor : doc;
      if (actor && actor !== doc) scanDoc(actor);
      for (const it of (actor?.items ?? [])) { if (it !== doc) scanDoc(it); }
    } catch (e) {}
    return [...names].sort((a, b) => a.localeCompare(b));
  }

  _redrawEdges() {
    const svg=this.edgeSVG; if(!svg) return;

    const defs = svg.querySelector("defs");
    while(svg.lastChild && svg.lastChild !== defs) svg.removeChild(svg.lastChild);
    if (!defs) {
      const d = document.createElementNS("http://www.w3.org/2000/svg","defs");
      d.innerHTML = `<linearGradient id="sd-link-grad" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" style="stop-color:var(--sd-accent)"/>
        <stop offset="100%" style="stop-color:var(--sd-success)"/>
      </linearGradient>`;
      svg.insertBefore(d, svg.firstChild);
    }

    for(const edge of this.edges) {
      const from=this._pinScreen(edge.fromNode,edge.fromPin,"output");
      const to  =this._pinScreen(edge.toNode,  edge.toPin,  "input");
      if(!from||!to) continue;

      const fromNode  = this.nodes.find(n=>n.id===edge.fromNode);
      const def       = NODE_DEFS[fromNode?.type ?? ""];
      const dynOuts   = (def && typeof def.computeDynamicOutputs === "function")
        ? (def.computeDynamicOutputs(fromNode) ?? [])
        : [];
      const fromPinDef = dynOuts.find(p=>p.id===edge.fromPin)
                       ?? [...(def?.outputs??[])].find(p=>p.id===edge.fromPin);
      const isExec = fromPinDef?.type==="exec";
      const edgeMeta = pinTypeMeta(fromPinDef?.type);
      const subColor = edgeMeta.color;

      const bez = this._bez(from,to);

      const hit=document.createElementNS("http://www.w3.org/2000/svg","path");
      hit.setAttribute("d",bez);
      hit.setAttribute("fill","none");
      hit.setAttribute("stroke","transparent");
      hit.setAttribute("stroke-width","14");
      hit.setAttribute("pointer-events","stroke");
      hit.style.cursor="pointer";
      hit.addEventListener("dblclick",()=>{
        this._removeEdge(edge.id);
      });
      svg.appendChild(hit);

      const path=document.createElementNS("http://www.w3.org/2000/svg","path");
      path.setAttribute("d",bez);
      path.setAttribute("fill","none");
      const stroke = isExec ? "#ffca6b" : (subColor ?? "url(#sd-link-grad)");
      path.setAttribute("stroke", stroke);
      path.setAttribute("stroke-width",edgeMeta.container?"4.2":edgeMeta.structured?"3.8":"3.5");
      if(edgeMeta.container) path.setAttribute("stroke-dasharray","10,4");
      path.setAttribute("stroke-linecap","round");
      path.setAttribute("opacity","0.92");
      path.setAttribute("pointer-events","none");
      svg.appendChild(path);
    }
  }
  _bez(a,b) {
    const dx=Math.abs(b.x-a.x);
    const c=Math.max(dx*0.55,60);
    return `M${a.x},${a.y} C${a.x+c},${a.y} ${b.x-c},${b.y} ${b.x},${b.y}`;
  }

  _pinScreen(nodeId,pinId,side) {
    const el=this.nodesEl.querySelector(`[data-nid="${nodeId}"] [data-pid="${pinId}"][data-side="${side}"]`);
    if(!el) return null;
    const r=el.getBoundingClientRect();
    const wr=this.edgeSVG.getBoundingClientRect();
    return {x:r.left-wr.left+r.width/2, y:r.top-wr.top+r.height/2};
  }

  _startConn(nodeId,pinId,isExec,ev,pinType) {
    const pos=this._pinScreen(nodeId,pinId,"output"); if(!pos) return;
    const line=document.createElementNS("http://www.w3.org/2000/svg","path");
    line.setAttribute("fill","none");
    const dragMeta = pinTypeMeta(pinType);
    const dragColor = isExec ? "#F5C451" : dragMeta.color;
    line.setAttribute("stroke", dragColor);
    line.setAttribute("stroke-width","3");
    line.setAttribute("stroke-dasharray",dragMeta.container?"10,4":"7,7");
    line.setAttribute("stroke-opacity","0.75");
    line.setAttribute("stroke-linecap","round");
    this.edgeSVG.appendChild(line);
    this._conn={fromNode:nodeId,fromPin:pinId,isExec,fromType:pinType,sx:pos.x,sy:pos.y,line};
  }

  _doConn(ev) {
    if(!this._conn) return;
    const wr=this.edgeSVG.getBoundingClientRect();
    const mx=ev.clientX-wr.left;
    const my=ev.clientY-wr.top;
    this._conn.line.setAttribute("d",this._bez({x:this._conn.sx,y:this._conn.sy},{x:mx,y:my}));
  }

  _endConn(ev) {
    if(!this._conn) return;
    const conn=this._conn; this._conn=null;
    conn.line.remove();
    const doc = this._uiDocument();
    const clientX = Number.isFinite(ev?.clientX) ? ev.clientX : -1;
    const clientY = Number.isFinite(ev?.clientY) ? ev.clientY : -1;
    const pin=doc.elementFromPoint(clientX,clientY)?.closest?.(".gpin");
    if (!pin) {
      const wrap = this.win?.querySelector("#gwrap");
      const overWrap = wrap?.contains(ev?.target) || (doc.elementFromPoint(clientX, clientY)?.closest?.("#gwrap"));
      if (overWrap) {
        const r = wrap.getBoundingClientRect();
        const gx = (clientX - r.left - this._pan.x) / this._zoom;
        const gy = (clientY - r.top  - this._pan.y) / this._zoom;
        this._ctxMenu(clientX,clientY,gx,gy,conn);
      }
      return;
    }
    if (pin.dataset.side !== "input" || pin.dataset.nid === conn.fromNode) return;
    const targetNode = this.nodes.find(n=>n.id===pin.dataset.nid);
    const targetDef  = NODE_DEFS[targetNode?.type??""];
    const targetIns  = targetDef?.computeDynamicInputs
      ? (targetDef.computeDynamicInputs(targetNode) ?? [])
      : (targetDef?.inputs ?? []);
    const targetPinDef = targetIns.find(p=>p.id===pin.dataset.pid);
    const targetType   = targetPinDef?.type;
    if (!arePinsCompatible(conn.fromType, targetType)) {
      ui.notifications?.warn?.(`Incompatible pin types: ${pinSubtype(conn.fromType)} -> ${pinSubtype(targetType)}`);
      return;
    }
    this._addEdge(conn.fromNode,conn.fromPin,pin.dataset.nid,pin.dataset.pid);
  }

  _showQuickInsertMenu(conn, ev) {
    const wrap = this.win?.querySelector("#gwrap");
    if (!wrap) return;
    const r = wrap.getBoundingClientRect();
    const gx = (ev.clientX - r.left - this._pan.x) / this._zoom;
    const gy = (ev.clientY - r.top  - this._pan.y) / this._zoom;

    const fromType = conn.fromType;
    const candidates = [];
    const ctx = this._nodeFilterContext();
    for (const [type, def] of Object.entries(NODE_DEFS)) {
      if (!this._isNodeAvailableInCurrentGraph(type, def, null, ctx)) continue;
      const inputs = def.inputs ?? [];
      const compat = inputs.find(p => {
        if (fromType === "exec") return p.type === "exec";
        return p.type !== "exec" && arePinsCompatible(fromType, p.type);
      });
      if (!compat) continue;
      candidates.push({ type, def, pin: compat });
    }
    candidates.sort((a, b) => (_nodeCategoryLabel(a.def.cat ?? "")).localeCompare(_nodeCategoryLabel(b.def.cat ?? "")) || _NL(a.def.title ?? a.type).localeCompare(_NL(b.def.title ?? b.type)));

    const doc = this._uiDocument();
    doc.getElementById("sd-quick-insert-menu")?.remove();
    const menu = doc.createElement("div");
    menu.id = "sd-quick-insert-menu";
    menu.style.cssText = `position:fixed;left:${ev.clientX}px;top:${ev.clientY}px;
      min-width:240px;max-width:340px;max-height:60vh;overflow:auto;
      background:var(--sd-popover-bg,var(--sd-bg-2));border:1px solid var(--sd-popover-border,var(--sd-border));border-radius:8px;
      box-shadow:var(--sd-popover-shadow,0 12px 40px rgba(0,0,0,.8));z-index:25000;
      font-family:'Signika',sans-serif;color:var(--sd-text);padding:6px 0`;

    const head = doc.createElement("div");
    head.textContent = `${_NL("Insert node compatible with")} ${pinSubtype(fromType) || "exec"}`;
    head.style.cssText = "padding:6px 12px;font-size:11px;color:var(--sd-text-2);border-bottom:1px solid var(--sd-border)";
    menu.appendChild(head);

    if (!candidates.length) {
      const empty = doc.createElement("div");
      empty.textContent = _NL("No compatible nodes");
      empty.style.cssText = "padding:8px 12px;color:var(--sd-text-3)";
      menu.appendChild(empty);
    } else {
      let lastCat = null;
      for (const c of candidates.slice(0, 80)) {
        if (c.def.cat !== lastCat) {
          lastCat = c.def.cat;
          const sec = doc.createElement("div");
          sec.textContent = _nodeCategoryLabel(lastCat ?? "Other");
          sec.style.cssText = "padding:4px 12px 2px;font-size:10px;color:var(--sd-accent);text-transform:uppercase;letter-spacing:.5px";
          menu.appendChild(sec);
        }
        const item = doc.createElement("div");
        item.textContent = _NL(c.def.title ?? c.type);
        item.style.cssText = "padding:5px 14px;font-size:12px;cursor:pointer";
        item.addEventListener("mouseenter", () => item.style.background = "var(--sd-control-hover,var(--sd-bg-3))");
        item.addEventListener("mouseleave", () => item.style.background = "");
        item.addEventListener("click", () => {
          menu.remove();
          this._suppressHistory = true;
          let added;
          try {
            added = this._addNode(c.type, gx, gy);
            if (added) this._addEdge(conn.fromNode, conn.fromPin, added.id, c.pin.id);
          } finally {
            this._suppressHistory = false;
          }
          if (added) this._pushHistory();
        });
        menu.appendChild(item);
      }
    }
    doc.body.appendChild(menu);

    const close = (e) => {
      if (e && menu.contains(e.target)) return;
      menu.remove();
      doc.removeEventListener("mousedown", close, true);
      doc.removeEventListener("keydown", onKey, true);
    };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    setTimeout(() => {
      doc.addEventListener("mousedown", close, true);
      doc.addEventListener("keydown", onKey, true);
    }, 0);
  }

  _doDrag(ev) {
    if(!this._drag) return;
    const z  = (Number.isFinite(this._zoom) && this._zoom > 0) ? this._zoom : 1;
    const dx = (ev.clientX - this._drag.mx) / z;
    const dy = (ev.clientY - this._drag.my) / z;
    if (Math.abs(dx) + Math.abs(dy) > 1) this._drag._moved = true;

    const group = this._drag.group?.length
      ? this._drag.group
      : [{ id: this._drag.nodeId, ox: this._drag.ox, oy: this._drag.oy }];

    for (const g of group) {
      const n = this.nodes.find(x => x.id === g.id);
      if (!n) continue;
      n.x = Math.round(g.ox + dx);
      n.y = Math.round(g.oy + dy);
      const el = this.nodesEl.querySelector(`[data-nid="${n.id}"]`);
      if (el) { el.style.left = n.x + "px"; el.style.top = n.y + "px"; }
    }
    this._scheduleEdges?.();
  }

  _doMarquee(ev) {
    if (!this._marquee) return;
    const wrap = this.win?.querySelector("#gwrap");
    if (!wrap) return;
    const r = wrap.getBoundingClientRect();
    this._marquee.cx = ev.clientX - r.left;
    this._marquee.cy = ev.clientY - r.top;
    const x = Math.min(this._marquee.sx, this._marquee.cx);
    const y = Math.min(this._marquee.sy, this._marquee.cy);
    const w = Math.abs(this._marquee.cx - this._marquee.sx);
    const h = Math.abs(this._marquee.cy - this._marquee.sy);
    this._marquee.el.style.left   = x + "px";
    this._marquee.el.style.top    = y + "px";
    this._marquee.el.style.width  = w + "px";
    this._marquee.el.style.height = h + "px";
  }

  _endMarquee() {
    if (!this._marquee) return;
    const m = this._marquee;
    this._marquee = null;
    m.el?.remove();

    const x1s = Math.min(m.sx, m.cx);
    const y1s = Math.min(m.sy, m.cy);
    const x2s = Math.max(m.sx, m.cx);
    const y2s = Math.max(m.sy, m.cy);
    const gx1 = (x1s - this._pan.x) / this._zoom;
    const gy1 = (y1s - this._pan.y) / this._zoom;
    const gx2 = (x2s - this._pan.x) / this._zoom;
    const gy2 = (y2s - this._pan.y) / this._zoom;

    if ((x2s - x1s) < 4 && (y2s - y1s) < 4) return;

    if (!m.additive) this._selected.clear();
    for (const n of this.nodes) {
      const el = this.nodesEl.querySelector(`[data-nid="${n.id}"]`);
      const w  = el ? el.offsetWidth  : 220;
      const h  = el ? el.offsetHeight : 80;
      const nx1 = n.x, ny1 = n.y, nx2 = n.x + w, ny2 = n.y + h;
      const intersects = !(nx2 < gx1 || nx1 > gx2 || ny2 < gy1 || ny1 > gy2);
      if (intersects) this._selected.add(n.id);
    }
    this._refreshSelectionHighlights();
  }

  _applyTransform() {
    if (!Number.isFinite(this._zoom) || this._zoom <= 0) this._zoom = 1;
    if (!this._pan || !Number.isFinite(this._pan.x) || !Number.isFinite(this._pan.y)) this._pan = { x: 60, y: 60 };
    const tf = `translate(${this._pan.x}px,${this._pan.y}px) scale(${this._zoom})`;
    if(this.nodesEl)    this.nodesEl.style.transform    = tf;
    if(this.commentsEl) this.commentsEl.style.transform = tf;
    const wrap = this.win?.querySelector("#gwrap");
    if (wrap) {
      const ox = ((this._pan.x % 32) + 32) % 32;
      const oy = ((this._pan.y % 32) + 32) % 32;
      wrap.style.backgroundPosition = `${ox}px ${oy}px, ${ox}px ${oy}px, ${((this._pan.x%8)+8)%8}px ${((this._pan.y%8)+8)%8}px, ${((this._pan.x%8)+8)%8}px ${((this._pan.y%8)+8)%8}px`;
    }
  }

  _fitView() {
    if(!this.win) return;
    const wrap=this.win.querySelector("#gwrap");
    const W=wrap.clientWidth, H=wrap.clientHeight;
    const pts=this.nodes.filter(n=>Number.isFinite(n?.x)&&Number.isFinite(n?.y));
    if(!pts.length||!W||!H){ this._zoom=1; this._pan={x:60,y:60}; this._applyTransform(); return; }
    const xs=pts.map(n=>n.x), ys=pts.map(n=>n.y);
    const minX=Math.min(...xs)-50,maxX=Math.max(...xs)+220;
    const minY=Math.min(...ys)-40,maxY=Math.max(...ys)+160;
    this._zoom=Math.clamp(Math.min(W/(maxX-minX),H/(maxY-minY))*0.9,0.22,1.4);
    if(!Number.isFinite(this._zoom)||this._zoom<=0) this._zoom=1;
    this._pan.x=(W-(maxX-minX)*this._zoom)/2-minX*this._zoom;
    this._pan.y=(H-(maxY-minY)*this._zoom)/2-minY*this._zoom;
    if(!Number.isFinite(this._pan.x)||!Number.isFinite(this._pan.y)) this._pan={x:60,y:60};
    this._applyTransform();
    setTimeout(()=>this._redrawEdges(),50);
  }

  _hydrateFormula(f) {
    const m=f.match(/^\{([^}]+)\}$/);
    if(m){const n=this._addNode("get_path",350,230);if(n)n.data.path=m[1];}
  }

  _getFunctionLib() {
    try {
      const raw = game?.settings?.get?.("sd", "functionLibrary");
      if (raw && typeof raw === "object") return raw;
    } catch {}
    return { functions: {} };
  }

  _compileFunctionValue(callNode, fromPin) {
    const fid = callNode?.data?.functionId;
    if (!fid) return "0";
    const lib = this._getFunctionLib();
    const fn  = lib?.functions?.[fid];
    if (!fn) return "0";

    if (!this._funcStackCompile) this._funcStackCompile = [];
    if (this._funcStackCompile.includes(fid)) {
      console.warn(`[sd] Recursive function call (value) detected: ${fid}`);
      return "0";
    }

    const outerWires = {};
    for (const p of (fn.inputs ?? [])) {
      const e = this._incomingEdge(callNode.id, p.id);
      if (e) {
        const src = this.nodes.find(n => n.id === e.fromNode);
        if (src) outerWires[p.id] = this._compileValue(src, new Set(), e.fromPin);
      } else if (callNode.data && callNode.data[p.id] != null && callNode.data[p.id] !== "") {
        outerWires[p.id] = String(callNode.data[p.id]);
      }
    }

    const savedNodes   = this.nodes;
    const savedEdges   = this.edges;
    const savedOverlay = this._funcInputsOverlay;
    this.nodes = fn.nodes ?? [];
    this.edges = fn.edges ?? [];
    this._funcInputsOverlay = outerWires;
    this._funcStackCompile.push(fid);

    let result = "0";
    try {
      const outNode = this.nodes.find(n => n.type === "func_outputs");
      if (outNode) {
        const e = this._incomingEdge(outNode.id, fromPin);
        if (e) {
          const src = this.nodes.find(n => n.id === e.fromNode);
          if (src) result = this._compileValue(src, new Set(), e.fromPin);
        }
      }
    } catch (err) {
      console.warn("[sd] _compileFunctionValue failed", err);
    } finally {
      this.nodes = savedNodes;
      this.edges = savedEdges;
      this._funcInputsOverlay = savedOverlay;
      this._funcStackCompile.pop();
    }
    return result;
  }

  _inlineFunctionExec(callNode) {
    const fid = callNode?.data?.functionId;
    if (!fid) return [];
    const lib = this._getFunctionLib();
    const fn  = lib?.functions?.[fid];
    if (!fn) return [];

    if (!this._funcStackCompile) this._funcStackCompile = [];
    if (this._funcStackCompile.includes(fid)) {
      console.warn(`[sd] Recursive function call (exec) detected: ${fid}`);
      return [];
    }

    const outerWires = {};
    for (const p of (fn.inputs ?? [])) {
      if (p.type === "exec") continue;
      const e = this._incomingEdge(callNode.id, p.id);
      if (e) {
        const src = this.nodes.find(n => n.id === e.fromNode);
        if (src) outerWires[p.id] = this._compileValue(src, new Set(), e.fromPin);
      } else if (callNode.data && callNode.data[p.id] != null && callNode.data[p.id] !== "") {
        outerWires[p.id] = String(callNode.data[p.id]);
      }
    }

    const savedNodes   = this.nodes;
    const savedEdges   = this.edges;
    const savedOverlay = this._funcInputsOverlay;
    this.nodes = fn.nodes ?? [];
    this.edges = fn.edges ?? [];
    this._funcInputsOverlay = outerWires;
    this._funcStackCompile.push(fid);

    let innerActions = [];
    try {
      const inNode = this.nodes.find(n => n.type === "func_inputs");
      if (inNode) {
        const startEdge = this.edges.find(e => e.fromNode === inNode.id && e.fromPin === "_exec");
        if (startEdge) {
          const json = this._compileExecChain(startEdge.toNode);
          try { innerActions = JSON.parse(json); } catch {}
        }
      }
    } catch (err) {
      console.warn("[sd] _inlineFunctionExec failed", err);
    } finally {
      this.nodes = savedNodes;
      this.edges = savedEdges;
      this._funcInputsOverlay = savedOverlay;
      this._funcStackCompile.pop();
    }
    return innerActions;
  }

  _detectFunctionCycles(libDraft = null) {
    const lib = libDraft ?? this._getFunctionLib();
    const fns = lib?.functions ?? {};
    const adj = new Map();
    for (const [fid, fn] of Object.entries(fns)) {
      const deps = new Set();
      for (const n of (fn?.nodes ?? [])) {
        if (n?.type === "function_call") {
          const dep = n?.data?.functionId;
          if (dep) deps.add(dep);
        }
      }
      adj.set(fid, [...deps]);
    }
    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map();
    const cycles = [];
    const dfs = (fid, path) => {
      color.set(fid, GRAY);
      path.push(fid);
      for (const dep of (adj.get(fid) ?? [])) {
        const c = color.get(dep) ?? WHITE;
        if (c === GRAY) {
          const i = path.indexOf(dep);
          cycles.push(path.slice(i).concat(dep));
        } else if (c === WHITE && adj.has(dep)) {
          dfs(dep, path);
        }
      }
      path.pop();
      color.set(fid, BLACK);
    };
    for (const fid of adj.keys()) {
      if ((color.get(fid) ?? WHITE) === WHITE) dfs(fid, []);
    }
    return cycles;
  }

  async _saveFunctionLib(lib) {
    if (!game?.user?.isGM) {
      ui.notifications?.warn?.("Only the GM can edit the function library.");
      return false;
    }
    try {
      await game.settings.set("sd", "functionLibrary", lib);
      return true;
    } catch (e) {
      console.error("[sd] _saveFunctionLib failed", e);
      ui.notifications?.error?.("Failed to save function library.");
      return false;
    }
  }

  _resolveNodeSig(node) {
    const def = NODE_DEFS[node.type];
    if (!def) return null;
    if (def.isFunctionCall) {
      const fid = node.data?.functionId;
      const lib = this._getFunctionLib();
      const fn  = lib?.functions?.[fid];
      if (!fn) return null;
      return { inputs: fn.inputs ?? [], outputs: fn.outputs ?? [] };
    }
    if (def.isFunctionAnchor) {
      const fid = this._activeFunctionId;
      const lib = this._getFunctionLib();
      const fn  = lib?.functions?.[fid];
      if (!fn) return null;
      return { inputs: fn.inputs ?? [], outputs: fn.outputs ?? [] };
    }
    return null;
  }

  _refreshPalette(bindOnboarding = true) {
    const palEl = this.win?.querySelector("#gpal");
    if (!palEl) return;
    palEl.innerHTML = this._buildPal();
    this._wirePalette?.(bindOnboarding);
  }

  _wirePalette(bindOnboarding = true) {
    const win = this.win;
    if (!win) return;
    win.querySelectorAll(".gpal").forEach(el => {
      el.addEventListener("dragstart", ev => {
        const payload = { _sg: el.dataset.type };
        const fid = el.dataset.functionId;
        if (fid) payload._fnId = fid;
        ev.dataTransfer.setData("text/plain", JSON.stringify(payload));
      });
      el.addEventListener("mouseenter", () => el.style.background = "rgba(116,167,255,.1)");
      el.addEventListener("mouseleave", () => el.style.background = "");
    });
    win.querySelector("#gpalFnCreate")?.addEventListener("click", () => this._fnCreatePrompt?.());
    win.querySelector("#gpalFnManage")?.addEventListener("click", () => this._openManageFunctions?.());
    if (bindOnboarding) SDOnboarding.bindGraph(win);
  }

  _fnNewId() {
    return `fn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,6)}`;
  }

  _fnDefaultPalette() {
    return ["#5a3a8a","#3a6a5a","#7a5a3a","#5a3a3a","#3a5a7a","#7a3a5a","#8a7a3a"];
  }

  async _fnCreatePrompt() {
    if (!game?.user?.isGM) { ui.notifications?.warn?.("GM only."); return; }
    const name = (await this._promptText("Function name", "MyFunction", "Create function"))?.trim();
    if (!name) return;
    const lib = foundry.utils.deepClone(this._getFunctionLib());
    const id  = this._fnNewId();
    const palette = this._fnDefaultPalette();
    const used = new Set(Object.values(lib.functions ?? {}).map(f => f.color));
    const color = palette.find(c => !used.has(c)) ?? palette[0];
    lib.functions[id] = {
      id, name, description: "",
      color,
      inputs:  [],
      outputs: [],
      nodes: [
        { id: "func_inputs",  type: "func_inputs",  x: 80,  y: 240, data: {} },
        { id: "func_outputs", type: "func_outputs", x: 640, y: 240, data: {} }
      ],
      edges: [],
      comments: []
    };
    const ok = await this._saveFunctionLib(lib);
    if (ok) {
      this._refreshPalette();
      ui.notifications?.info?.(`Function "${name}" created.`);
    }
  }

  async _fnDelete(id) {
    if (!game?.user?.isGM) return;
    const lib = foundry.utils.deepClone(this._getFunctionLib());
    const fn  = lib.functions?.[id];
    if (!fn) return;
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Delete function" },
      content: `<p>Delete function "${esc(fn.name)}"?<br>All references in graphs will be marked as broken.</p>`,
      rejectClose: false
    }).catch(() => false);
    if (!confirmed) return;
    delete lib.functions[id];
    const ok = await this._saveFunctionLib(lib);
    if (ok) {
      this._refreshPalette();
      this._renderAll?.();
    }
  }

  async _fnRename(id) {
    if (!game?.user?.isGM) return;
    const lib = foundry.utils.deepClone(this._getFunctionLib());
    const fn = lib.functions?.[id];
    if (!fn) return;
    const next = await this._promptText("New name", fn.name, "Rename function");
    if (next === null) return;
    const trimmed = String(next).trim();
    if (!trimmed) return;
    fn.name = trimmed;
    const ok = await this._saveFunctionLib(lib);
    if (ok) { this._refreshPalette(); this._renderAll?.(); }
  }

  _enterFunction(functionId) {
    if (!functionId) return;
    const lib = this._getFunctionLib();
    const fn  = lib?.functions?.[functionId];
    if (!fn) { ui.notifications?.warn?.("Function is missing."); return; }

    if (!this._funcStack) this._funcStack = [];
    this._funcStack.push({
      activeFunctionId: this._activeFunctionId,
      nodes:    foundry.utils.deepClone(this.nodes ?? []),
      edges:    foundry.utils.deepClone(this.edges ?? []),
      comments: foundry.utils.deepClone(this.comments ?? []),
      id:       this._id,
      pan:      { ...(this._pan ?? {x:60,y:60}) },
      zoom:     this._zoom ?? 1
    });

    this._activeFunctionId = functionId;
    this.nodes    = foundry.utils.deepClone(fn.nodes ?? []);
    this.edges    = foundry.utils.deepClone(fn.edges ?? []);
    this.comments = foundry.utils.deepClone(fn.comments ?? []);
    this._ensureFunctionAnchors();
    this._sanitizeGraph();
    const numIds = this.nodes.map(n => { const v = parseInt(String(n.id ?? "").replace(/\D/g,"")) || 0; return v; });
    this._id = (Math.max(0, ...numIds) + 2) || 2;
    this._selected?.clear?.();
    this._selectedComments?.clear?.();
    this._history = [];
    this._historyIdx = -1;
    this._pushHistory?.();

    this._refreshFunctionBar();
    this._refreshPalette();
    this._renderAll();
    setTimeout(() => this._fitView?.(), 80);
  }

  _ensureFunctionAnchors() {
    const hasIn  = this.nodes.some(n => n.type === "func_inputs");
    const hasOut = this.nodes.some(n => n.type === "func_outputs");
    if (!hasIn)  this.nodes.unshift({ id: "func_inputs",  type: "func_inputs",  x: 80,  y: 240, data: {} });
    if (!hasOut) this.nodes.push   ({ id: "func_outputs", type: "func_outputs", x: 640, y: 240, data: {} });
  }

  _leaveFunction() {
    if (!this._funcStack?.length) return;
    const prev = this._funcStack.pop();
    this._activeFunctionId = prev.activeFunctionId ?? null;
    this.nodes    = prev.nodes    ?? [];
    this.edges    = prev.edges    ?? [];
    this.comments = prev.comments ?? [];
    this._id      = prev.id       ?? 1;
    this._pan     = prev.pan      ?? { x: 60, y: 60 };
    this._zoom    = prev.zoom     ?? 1;
    this._selected?.clear?.();
    this._selectedComments?.clear?.();
    this._history = [];
    this._historyIdx = -1;
    this._pushHistory?.();
    this._refreshFunctionBar();
    this._refreshPalette();
    this._renderAll();
  }

  _refreshFunctionBar() {
    const bar = this.win?.querySelector("#gfnbar");
    if (!bar) return;
    if (!this._activeFunctionId) {
      bar.style.display = "none";
      return;
    }
    const fn = this._getFunctionLib()?.functions?.[this._activeFunctionId];
    bar.style.display = "inline-flex";
    const crumb = this.win.querySelector("#gfncrumb");
    if (crumb) {
      const depth = (this._funcStack?.length ?? 0);
      const chain = this._funcStack?.map(s => {
        const fid = s.activeFunctionId;
        const f = fid ? this._getFunctionLib()?.functions?.[fid] : null;
        return f?.name || "graph";
      }).join(" \u203a ") || "graph";
      crumb.textContent = `\u0192 ${fn?.name || "(unknown)"} \u2190 ${chain}`;
    }
  }

  async _saveActiveFunction() {
    const fid = this._activeFunctionId;
    if (!fid) return;
    const lib = foundry.utils.deepClone(this._getFunctionLib());
    if (!lib.functions[fid]) { ui.notifications?.warn?.("Function no longer exists."); return; }
    lib.functions[fid].nodes    = foundry.utils.deepClone(this.nodes ?? []);
    lib.functions[fid].edges    = foundry.utils.deepClone(this.edges ?? []);
    lib.functions[fid].comments = foundry.utils.deepClone(this.comments ?? []);

    const cycles = this._detectFunctionCycles(lib);
    if (cycles.length) {
      const names = cycles.map(c => c.map(id => lib.functions?.[id]?.name ?? id).join(" \u2192 ")).join(", ");
      ui.notifications?.warn?.(`Recursive function call detected: ${names}. Calls will resolve to no-op at runtime.`);
    }

    const ok = await this._saveFunctionLib(lib);
    if (ok) ui.notifications?.info?.(`Function "${lib.functions[fid].name}" saved.`);
  }

  _openManageFunctions() {
    if (!game?.user?.isGM) { ui.notifications?.warn?.("GM only."); return; }
    this._functionManagerApp?.close?.({ sdSkipCallback:true });
    const wrap = document.createElement("div");
    wrap.id = "sd-fn-mgr";
    wrap.className = "sd";
    {
      const _w = Math.min(1000, Math.floor(window.innerWidth * 0.94));
      const _h = Math.min(640, Math.floor(window.innerHeight * 0.90));
      const _l = Math.max(20, Math.floor((window.innerWidth - _w) / 2));
      wrap.style.cssText = `position:relative;width:100%;height:100%;min-width:0;min-height:0;background:var(--sd-popover-bg,var(--sd-bg));display:flex;flex-direction:column;font-family:Inter,'Segoe UI',Arial,sans-serif;color:var(--sd-text);overflow:hidden`;
    }

    wrap.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--sd-bg-2);border-bottom:1px solid var(--sd-border)">
        <i class="fas fa-list" style="color:var(--sd-accent)"></i>
        <b style="font-size:12px;text-transform:uppercase;letter-spacing:.1em;color:var(--sd-accent);flex:1">Manage Functions</b>
        <button id="fmNew"     style="background:#2a4a6a;border:1px solid #3a5a7a;border-radius:6px;color:#cfe8ff;cursor:pointer;font-size:11px;padding:5px 10px"><i class="fas fa-plus" style="margin-right:4px"></i>New</button>
        <button id="fmImport"  style="background:var(--sd-bg-3);border:1px solid var(--sd-border);border-radius:6px;color:var(--sd-text-2);cursor:pointer;font-size:11px;padding:5px 10px"><i class="fas fa-file-import" style="margin-right:4px"></i>Import</button>
        <button id="fmClose"   style="background:var(--sd-bg-3);border:1px solid var(--sd-border);border-radius:6px;color:var(--sd-text-2);cursor:pointer;font-size:14px;width:30px;height:30px;display:grid;place-items:center" title="Close">\u2715</button>
      </div>
      <div style="display:flex;flex:1;min-height:0">
        <div id="fmList"   style="width:240px;border-right:1px solid var(--sd-border);overflow-y:auto;flex-shrink:0;background:var(--sd-bg-2)"></div>
        <div id="fmDetail" style="flex:1;padding:14px;overflow-y:auto"></div>
      </div>`;
    this._functionManagerApp = openFoundryWindow({
      id:`sd-function-manager-${foundry.utils.randomID(8)}`,
      title:"System Director — Manage Functions",
      icon:"fa-solid fa-list",
      width:Math.min(1000, Math.floor(window.innerWidth * 0.94)),
      height:Math.min(640, Math.floor(window.innerHeight * 0.90)),
      minWidth:620,
      minHeight:420,
      classes:["sd-function-manager-window"],
      content:wrap,
      onClose:()=>{ this._functionManagerApp=null; wrap.remove(); }
    });

    const selected = { id: null };
    const render = () => {
      const lib  = this._getFunctionLib();
      const list = wrap.querySelector("#fmList");
      const arr  = Object.values(lib.functions ?? {}).sort((a,b)=>String(a.name||"").localeCompare(String(b.name||"")));
      list.innerHTML = arr.map(fn => {
        const sel = fn.id === selected.id;
        return `<div class="fmRow" data-fid="${esc(fn.id)}" style="display:flex;align-items:center;gap:8px;padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--sd-border);${sel?"background:rgba(116,167,255,.12)":""}">
          <div style="width:9px;height:9px;border-radius:2px;background:${fn.color||"#5a3a8a"};flex-shrink:0"></div>
          <div style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
            <div style="font-size:12px;font-weight:600">${esc(String(fn.name||"(unnamed)"))}</div>
            <div style="font-size:9px;color:var(--sd-text-3);font-family:monospace">${(fn.inputs??[]).length}\u2192${(fn.outputs??[]).length} \u00b7 ${esc(fn.id)}</div>
          </div>
        </div>`;
      }).join("") || `<div style="padding:14px;color:var(--sd-text-3);font-size:11px;font-style:italic">No functions yet</div>`;

      list.querySelectorAll(".fmRow").forEach(row => {
        row.addEventListener("click", () => {
          selected.id = row.dataset.fid;
          render();
        });
      });

      const detail = wrap.querySelector("#fmDetail");
      const fn = selected.id ? lib.functions?.[selected.id] : null;
      if (!fn) {
        detail.innerHTML = `<div style="color:var(--sd-text-3);font-size:11px;font-style:italic">Select a function on the left, or click "New" to create one.</div>`;
        return;
      }
      detail.innerHTML = this._fnRenderDetail(fn);
      this._fnWireDetail(detail, fn, render);
    };

    wrap.querySelector("#fmClose").addEventListener("click", () => this._functionManagerApp?.close());
    wrap.querySelector("#fmNew").addEventListener("click", async () => {
      await this._fnCreatePrompt();
      render();
    });
    wrap.querySelector("#fmImport").addEventListener("click", () => this._fnImportPrompt(render));
    render();
  }

  _fnRenderDetail(fn) {
    const TYPES = [
      {id:"exec",        label:"Exec"},
      {id:"value.any",   label:"Any"},
      {id:"value.number",label:"Number"},
      {id:"value.string",label:"String"},
      {id:"value.bool",  label:"Bool"},
      {id:"value.token", label:"Token"},
      {id:"value.actor", label:"Actor"},
      {id:"value.item",  label:"Item"},
      {id:"value.array", label:"Array"},
      {id:"value.path",  label:"Path"},
      {id:"value.uuid",  label:"UUID"}
    ];
    const renderPinList = (pins, side) => `
      <div style="border:1px solid var(--sd-border);border-radius:6px;background:var(--sd-bg-2);padding:8px;display:flex;flex-direction:column;gap:6px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <b style="font-size:11px;color:var(--sd-accent);text-transform:uppercase;letter-spacing:.1em">${side==="inputs"?"Inputs":"Outputs"}</b>
          <button data-fn-add-pin="${side}" style="background:#2a4a6a;border:1px solid #3a5a7a;border-radius:6px;color:#cfe8ff;cursor:pointer;font-size:10px;padding:3px 8px"><i class="fas fa-plus" style="margin-right:3px"></i>Add</button>
        </div>
        ${(pins ?? []).map((p,i) => `
          <div class="fmPinRow" data-side="${side}" data-idx="${i}" style="display:grid;grid-template-columns:26px minmax(70px,1fr) minmax(90px,1.2fr) 96px 26px 26px;gap:4px;align-items:center">
            <div style="font-family:monospace;color:var(--sd-text-3);font-size:10px;text-align:right">${i+1}.</div>
            <input data-fnPinId    type="text" value="${esc(String(p.id ?? ""))}"    placeholder="id" style="background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:4px;color:var(--sd-text);font-size:11px;padding:4px 6px;font-family:monospace">
            <input data-fnPinLabel type="text" value="${esc(String(p.label ?? ""))}" placeholder="label" style="background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:4px;color:var(--sd-text);font-size:11px;padding:4px 6px">
            <select data-fnPinType style="background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:4px;color:var(--sd-text);font-size:11px;padding:4px 6px">
              ${TYPES.map(t => `<option value="${t.id}" ${t.id===(p.type||"value.any")?"selected":""}>${t.label}</option>`).join("")}
            </select>
            <button data-fnPinUp   title="Move up"   style="background:var(--sd-bg-3);border:1px solid var(--sd-border);border-radius:4px;color:var(--sd-text-2);cursor:pointer;font-size:10px;width:24px;height:24px"><i class="fas fa-arrow-up"></i></button>
            <button data-fnPinDel  title="Delete"   style="background:rgba(255,124,124,.12);border:1px solid #6a2a2a;border-radius:4px;color:#ff7c7c;cursor:pointer;font-size:10px;width:24px;height:24px"><i class="fas fa-trash"></i></button>
          </div>`).join("")}
        ${!(pins??[]).length ? `<div style="color:var(--sd-text-3);font-size:10px;font-style:italic">No ${side==="inputs"?"inputs":"outputs"}</div>` : ""}
      </div>`;
    return `
      <div style="display:flex;gap:10px;align-items:center;margin-bottom:12px">
        <input id="fmName" type="text" value="${esc(String(fn.name||""))}" placeholder="Name" style="flex:1;background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:6px;color:var(--sd-text);font-size:13px;font-weight:600;padding:6px 10px">
        <input id="fmColor" type="color" value="${esc(String(fn.color||"#5a3a8a"))}" style="width:38px;height:32px;border:1px solid var(--sd-border);border-radius:6px;background:transparent;padding:2px">
        <button id="fmEdit"   style="background:#3a2a5a;border:1px solid #4a3a6a;border-radius:6px;color:#dccff8;cursor:pointer;font-size:11px;padding:6px 12px"><i class="fas fa-pen" style="margin-right:4px"></i>Edit Graph</button>
        <button id="fmExport" style="background:var(--sd-bg-3);border:1px solid var(--sd-border);border-radius:6px;color:var(--sd-text-2);cursor:pointer;font-size:11px;padding:6px 12px"><i class="fas fa-file-export" style="margin-right:4px"></i>Export</button>
        <button id="fmDel"    style="background:rgba(255,124,124,.12);border:1px solid #6a2a2a;border-radius:6px;color:#ff7c7c;cursor:pointer;font-size:11px;padding:6px 12px"><i class="fas fa-trash" style="margin-right:4px"></i>Delete</button>
      </div>
      <textarea id="fmDesc" placeholder="Description (optional)" style="width:100%;height:50px;background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:6px;color:var(--sd-text);font-size:11px;padding:6px 10px;margin-bottom:12px;resize:vertical;font-family:inherit">${esc(String(fn.description||""))}</textarea>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        ${renderPinList(fn.inputs, "inputs")}
        ${renderPinList(fn.outputs, "outputs")}
      </div>
      <div style="margin-top:10px;padding:8px 10px;border:1px solid var(--sd-border);border-radius:6px;background:var(--sd-bg-2);font-size:10px;color:var(--sd-text-3)">
        <i class="fas fa-info-circle" style="margin-right:5px"></i>
        Editing the signature updates the function. Existing references in graphs may show as broken if pins were removed or renamed.
      </div>`;
  }

  _fnWireDetail(detail, fn, rerender) {
    const fid = fn.id;
    let updateQueue = Promise.resolve();
    const upd = (mut, { rerenderDetail = true, refreshPalette = true, refreshGraph = true } = {}) => {
      const run = async () => {
        const lib = foundry.utils.deepClone(this._getFunctionLib());
        const f = lib.functions?.[fid];
        if (!f) return false;
        mut(f);
        const ok = await this._saveFunctionLib(lib);
        if (ok) {
          if (rerenderDetail) rerender();
          if (refreshPalette) this._refreshPalette();
          if (refreshGraph) this._renderAll?.();
        }
        return ok;
      };
      updateQueue = updateQueue.then(run, run);
      return updateQueue;
    };

    const nameEl  = detail.querySelector("#fmName");
    const colorEl = detail.querySelector("#fmColor");
    const descEl  = detail.querySelector("#fmDesc");

    const applyDraft = f => {
      f.name        = String(nameEl?.value || "").trim();
      f.color       = String(colorEl?.value || "#5a3a8a");
      f.description = String(descEl?.value || "");
      detail.querySelectorAll(".fmPinRow").forEach(row => {
        const side = row.dataset.side;
        const idx = Number.parseInt(row.dataset.idx, 10);
        const arr = side === "inputs" ? f.inputs : f.outputs;
        if (!arr?.[idx]) return;
        const nextId = String(row.querySelector("[data-fnPinId]")?.value || "").trim();
        arr[idx].id = nextId || arr[idx].id;
        arr[idx].label = String(row.querySelector("[data-fnPinLabel]")?.value || "");
        arr[idx].type = String(row.querySelector("[data-fnPinType]")?.value || "value.any");
      });
    };

    let draftTimer = null;
    const saveDraft = ({ refresh = false } = {}) => upd(applyDraft, {
      rerenderDetail: false,
      refreshPalette: refresh,
      refreshGraph: refresh
    });
    const scheduleDraftSave = () => {
      if (draftTimer) clearTimeout(draftTimer);
      draftTimer = setTimeout(() => {
        draftTimer = null;
        void saveDraft();
      }, 350);
    };
    const flushDraft = () => {
      if (draftTimer) clearTimeout(draftTimer);
      draftTimer = null;
      return saveDraft({ refresh: true });
    };
    const structuralUpdate = async mut => {
      await flushDraft();
      return upd(mut);
    };

    for (const el of [nameEl, colorEl, descEl]) {
      el?.addEventListener("input", scheduleDraftSave);
      el?.addEventListener("change", () => { void flushDraft(); });
    }

    detail.querySelector("#fmDel")?.addEventListener("click", () => this._fnDelete(fid).then(rerender));
    detail.querySelector("#fmEdit")?.addEventListener("click", () => {
      document.getElementById("sd-fn-mgr")?.remove();
      this._enterFunction(fid);
    });
    detail.querySelector("#fmExport")?.addEventListener("click", () => this._fnExport(fid));

    detail.querySelectorAll("[data-fn-add-pin]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const side = btn.dataset.fnAddPin;
        await structuralUpdate(f => {
          const arr = side === "inputs" ? (f.inputs ??= []) : (f.outputs ??= []);
          const baseN = arr.length + 1;
          let n = baseN;
          let id;
          do { id = `${side === "inputs" ? "in" : "out"}${n++}`; } while (arr.some(p => p.id === id));
          arr.push({ id, label: `${side === "inputs" ? "Input" : "Output"} ${baseN}`, type: "value.any" });
        });
      });
    });

    detail.querySelectorAll(".fmPinRow").forEach(row => {
      const side = row.dataset.side;
      const idx  = parseInt(row.dataset.idx);
      const idEl    = row.querySelector("[data-fnPinId]");
      const lblEl   = row.querySelector("[data-fnPinLabel]");
      const typeEl  = row.querySelector("[data-fnPinType]");
      idEl?.addEventListener("input", scheduleDraftSave);
      lblEl?.addEventListener("input", scheduleDraftSave);
      idEl?.addEventListener("change", () => { void flushDraft(); });
      lblEl?.addEventListener("change", () => { void flushDraft(); });
      typeEl?.addEventListener("change", () => { void flushDraft(); });
      row.querySelector("[data-fnPinUp]")?.addEventListener("click", async () => {
        if (idx <= 0) return;
        await structuralUpdate(f => {
          const arr = side === "inputs" ? f.inputs : f.outputs;
          if (!arr || idx <= 0 || idx >= arr.length) return;
          [arr[idx-1], arr[idx]] = [arr[idx], arr[idx-1]];
        });
      });
      row.querySelector("[data-fnPinDel]")?.addEventListener("click", async () => {
        const okDel = await foundry.applications.api.DialogV2.confirm({
          window: { title: "Delete pin" },
          content: "<p>Delete this pin?</p>",
          rejectClose: false
        }).catch(() => false);
        if (!okDel) return;
        await structuralUpdate(f => {
          const arr = side === "inputs" ? f.inputs : f.outputs;
          if (!arr?.[idx]) return;
          arr.splice(idx, 1);
        });
      });
    });
  }

  async _fnExport(fid) {
    const lib = this._getFunctionLib();
    const fn  = lib?.functions?.[fid];
    if (!fn) return;
    const payload = {
      _sdFunction: true,
      name: fn.name, description: fn.description, color: fn.color,
      inputs: fn.inputs, outputs: fn.outputs,
      nodes: fn.nodes, edges: fn.edges, comments: fn.comments
    };
    const json = JSON.stringify(payload, null, 2);
    try {
      const blob = new Blob([json], { type: "application/json" });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `${(fn.name || "function").replace(/[^a-z0-9_-]/gi,"_")}.sdfn.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(()=>URL.revokeObjectURL(url), 1000);
    } catch (e) {
      console.warn("[sd] fnExport download failed; falling back to clipboard", e);
      await navigator.clipboard?.writeText?.(json);
      ui.notifications?.info?.("Exported to clipboard.");
    }
  }

  _fnImportPrompt(rerender) {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = ".json,application/json";
    inp.addEventListener("change", async () => {
      const file = inp.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        await this._fnImportFromJSON(text);
        rerender?.();
      } catch (e) {
        ui.notifications?.error?.("Failed to import: " + (e?.message ?? e));
      }
    });
    inp.click();
  }

  async _fnImportFromJSON(text) {
    const data = JSON.parse(text);
    if (!data || !data._sdFunction) throw new Error("Not a valid SD function export.");
    const lib = foundry.utils.deepClone(this._getFunctionLib());
    const id  = this._fnNewId();
    lib.functions[id] = {
      id,
      name:        String(data.name || "Imported"),
      description: String(data.description || ""),
      color:       String(data.color || "#5a3a8a"),
      inputs:      Array.isArray(data.inputs)  ? data.inputs  : [],
      outputs:     Array.isArray(data.outputs) ? data.outputs : [],
      nodes:       Array.isArray(data.nodes)   ? data.nodes   : [],
      edges:       Array.isArray(data.edges)   ? data.edges   : [],
      comments:    Array.isArray(data.comments)? data.comments: []
    };
    const ok = await this._saveFunctionLib(lib);
    if (ok) { this._refreshPalette(); this._renderAll?.(); ui.notifications?.info?.("Function imported."); }
  }
}

if(!document.getElementById("sd-graph-css")){
  const s=document.createElement("style");
  s.id="sd-graph-css";
  s.textContent=`
    .sdgctx *,.sd-graph-win *{box-sizing:border-box}
    .sd-ai-graph-assistant-window .window-content{padding:0!important;overflow:hidden!important;min-width:0!important;min-height:0!important}
    .sd-ai-graph-assistant-window .window-content>*{width:100%!important;height:100%!important;min-width:0!important;min-height:0!important}
    .sd-ai-graph-chat button{width:auto!important;min-width:0!important;max-width:100%!important;height:auto!important;margin:0!important}
    .sd-ai-graph-chat .sd-ai-chat-iconbtn{width:30px!important;min-width:30px!important;height:30px!important;padding:0!important}
    .sd-ai-graph-chat .sd-ai-chat-delete{width:26px!important;min-width:26px!important;height:26px!important;padding:0!important}
    .sd-ai-graph-chat .sd-ai-chat-send,.sd-ai-graph-chat .sd-ai-chat-apply{flex:0 0 auto!important}
    .gn-node-row .gn-control{width:100%;min-width:0;max-width:100%}
    .gn-node-row :is(input,select,textarea){box-sizing:border-box!important;width:100%!important;min-width:0!important;max-width:100%!important;margin:0!important}
    .gpin{position:relative;display:inline-grid;place-items:center;isolation:isolate;color:var(--pin-color);border-radius:50%;transition:transform .12s ease,box-shadow .12s ease,background .12s ease}
    .gpin-glyph{position:relative;z-index:2;display:inline-grid;place-items:center;min-width:0;color:var(--pin-color);font-family:Inter,'Segoe UI Symbol',Arial,sans-serif;font-size:8px;font-weight:900;line-height:1;letter-spacing:-1px;pointer-events:none;user-select:none;text-shadow:0 1px 1px rgba(0,0,0,.7)}
    .gpin[data-connected="1"] .gpin-glyph{color:#10131b;text-shadow:0 1px 0 rgba(255,255,255,.28)}
    .gpin.is-hovered:not(.gpin-shape-diamond){transform:scale(1.18)}
    .gpin-shape-exec{border-radius:3px!important}
    .gpin-shape-circle{border-radius:50%!important}
    .gpin-shape-square{border-radius:3px!important}
    .gpin-shape-capsule{border-radius:9px 4px 9px 4px!important}
    .gpin-shape-diamond{border-radius:3px!important;transform:rotate(45deg) scale(.82)}
    .gpin-shape-diamond.is-hovered{transform:rotate(45deg) scale(1)}
    .gpin-shape-diamond .gpin-glyph{transform:rotate(-45deg)}
    .gpin-shape-hex{border-radius:2px!important;clip-path:polygon(25% 0,75% 0,100% 50%,75% 100%,25% 100%,0 50%)}
    .gpin-shape-array{border-radius:4px!important;margin-right:2px}
    .gpin-shape-array::after{content:"";position:absolute;z-index:0;inset:2px -4px -4px 2px;border:1.5px solid var(--pin-color);border-radius:4px;background:rgba(15,17,25,.88);pointer-events:none}
    .gpin-shape-array .gpin-glyph{font-size:7px;letter-spacing:-1.5px}
    .gpin-shape-target{border-radius:50%!important}
    .gpin-shape-target::after{content:"";position:absolute;z-index:1;width:6px;height:6px;border:1.5px solid var(--pin-color);border-radius:50%;pointer-events:none}
    .gpin-structured{box-shadow:0 0 0 1px color-mix(in srgb,var(--pin-color) 35%,transparent)}
    .gn-pin-kind{display:inline-flex;align-items:center;justify-content:center;min-width:22px;max-width:46px;height:14px;padding:0 4px;border:1px solid color-mix(in srgb,var(--pin-color) 58%,transparent);border-radius:999px;background:color-mix(in srgb,var(--pin-color) 12%,transparent);color:var(--pin-color);font-size:7px;font-weight:800;line-height:1;letter-spacing:.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:.82;flex:0 0 auto}
    .gn-pin:hover .gn-pin-kind{opacity:1;background:color-mix(in srgb,var(--pin-color) 20%,transparent)}
    .gn-columns{display:flex;flex-direction:column;min-width:0;padding:4px 0 6px}
    .gn-node-row{display:grid;grid-template-columns:minmax(105px,.8fr) minmax(180px,1.6fr) minmax(105px,.8fr);align-items:stretch;min-width:0}
    .gn-row-cell{display:flex;min-width:0;min-height:36px}
    .gn-row-input{justify-content:flex-start}
    .gn-row-output{justify-content:flex-end}
    .gn-row-control{align-items:stretch;border-left:1px solid var(--sd-border);border-right:1px solid var(--sd-border);background:rgba(255,255,255,.018);padding:0 2px}
    .gn-field-label{display:flex;align-items:center;gap:7px;width:100%;min-width:0;min-height:30px;padding:3px 8px;color:var(--sd-text-2);font-size:11px;line-height:1;letter-spacing:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .gn-field-label::before{width:13px;height:13px;flex:0 0 13px;content:""}
    .gn-control>input,.gn-control>select,.gn-control>textarea{min-width:0;max-width:100%;width:100%}
    .gn-control textarea{height:auto!important;min-height:64px}
    .gnhdr{transition:opacity .15s}
    .gnhdr:active{cursor:grabbing!important;opacity:.9}
    .node-selected{outline:2px solid var(--sd-accent)!important;outline-offset:0}
    .ndel:hover{background:rgba(255,124,124,.22)!important}
    .gpal:hover{background:var(--sd-accent-glow)!important}
    #gpal::-webkit-scrollbar{width:4px}
    #gpal::-webkit-scrollbar-thumb{background:var(--sd-border);border-radius:2px}
    #gbar button{display:inline-flex;align-items:center;justify-content:center;min-height:28px;line-height:1;white-space:nowrap;flex:none}
    #gbar button i{pointer-events:none}
    #grefresh{min-width:104px}
    #gclose{padding:0!important;min-width:30px}
    #gsave:hover{filter:brightness(1.1)}
    #gclose:hover{background:rgba(255,124,124,.2)!important;color:#ff7c7c!important}
    .sd-ai-graph-chat,.sd-ai-graph-chat *{box-sizing:border-box;text-align:left}
    .sd-ai-graph-chat{
      position:fixed;right:30px;top:72px;width:min(760px,calc(100vw - 76px));height:min(640px,calc(100vh - 118px));
      min-width:min(560px,calc(100vw - 76px));min-height:420px;background:var(--sd-bg);border:1px solid var(--sd-border);
      border-radius:12px;box-shadow:var(--sd-popover-shadow,0 24px 80px rgba(0,0,0,.9));z-index:26000;
      display:flex;flex-direction:column;color:var(--sd-text);font-family:Inter,'Segoe UI',Arial,sans-serif;overflow:hidden;resize:both;
    }
    .sd-ai-chat-head{height:52px;display:flex;align-items:center;gap:10px;padding:9px 12px;background:linear-gradient(180deg,var(--sd-bg-2),var(--sd-bg-3));border-bottom:1px solid var(--sd-border);cursor:move;user-select:none;flex:0 0 auto}
    .sd-ai-chat-mark,.sd-ai-chat-avatar{width:28px;height:28px;border-radius:9px;background:linear-gradient(135deg,var(--sd-accent),#5ec6a8);display:flex;align-items:center;justify-content:center;color:var(--sd-accent-text,#fff);font-size:12px;flex:0 0 auto}
    .sd-ai-chat-titlebox{display:flex;flex-direction:column;gap:1px;flex:1;min-width:0}
    .sd-ai-chat-titlebox strong{font-size:12px;color:var(--sd-text);text-transform:uppercase;letter-spacing:.08em;line-height:1.1}
    .sd-ai-chat-titlebox span{font-size:11px;color:var(--sd-text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.2}
    .sd-ai-chat-iconbtn{background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:8px;color:var(--sd-text-2);width:30px;height:30px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;flex:0 0 auto}
    .sd-ai-chat-iconbtn:hover{border-color:var(--sd-accent);color:var(--sd-text)}
    .sd-ai-chat-body{display:grid;grid-template-columns:190px minmax(0,1fr);min-width:0;min-height:0;overflow:hidden;flex:1}
    .sd-ai-chat-sidebar{min-height:0;overflow:auto;background:var(--sd-bg-2);border-right:1px solid var(--sd-border);padding:8px}
    .sd-ai-chat-side-title{font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--sd-text-3);font-weight:800;margin:2px 2px 8px}
    .sd-ai-chat-row{display:grid;grid-template-columns:minmax(0,1fr) 26px;gap:5px;align-items:center;margin-bottom:5px}
    .sd-ai-chat-tab{min-width:0;text-align:left;background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:8px;color:var(--sd-text);padding:7px 8px;font-size:11px;line-height:1.25;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .sd-ai-chat-tab.is-active{background:rgba(116,167,255,.18);border-color:var(--sd-accent);box-shadow:0 0 0 1px rgba(116,167,255,.24) inset}
    .sd-ai-chat-delete{width:26px;height:26px;background:transparent;border:1px solid var(--sd-border);border-radius:7px;color:#d66;display:inline-flex;align-items:center;justify-content:center;cursor:pointer}
    .sd-ai-chat-delete:hover{background:rgba(214,80,80,.14)}
    .sd-ai-chat-main{display:flex;flex-direction:column;min-width:0;min-height:0;background:var(--sd-bg)}
    .sd-ai-chat-messages{flex:1;min-height:0;overflow:auto;padding:14px;display:flex;flex-direction:column;gap:14px;background:var(--sd-bg)}
    .sd-ai-chat-empty{margin:auto;max-width:430px;text-align:center!important;font-size:12px;color:var(--sd-text-3);line-height:1.5;border:1px dashed var(--sd-border);border-radius:10px;padding:18px;background:var(--sd-bg-2)}
    .sd-ai-chat-msg{display:flex;gap:9px;align-items:flex-start;justify-content:flex-start;width:100%}
    .sd-ai-chat-msg.is-user{justify-content:flex-end}
    .sd-ai-chat-avatar{width:26px;height:26px;border-radius:50%;font-size:11px;margin-top:18px}
    .sd-ai-chat-avatar.is-user{background:var(--sd-bg-3);border:1px solid var(--sd-border);color:var(--sd-text-2)}
    .sd-ai-chat-msg-stack{display:flex;flex-direction:column;gap:6px;max-width:min(560px,82%);align-items:flex-start;min-width:0}
    .sd-ai-chat-msg.is-user .sd-ai-chat-msg-stack{align-items:flex-end}
    .sd-ai-chat-role{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--sd-text-3);line-height:1}
    .sd-ai-chat-bubble{border:1px solid var(--sd-border);background:var(--sd-bg-2);border-radius:10px;padding:9px 11px;color:var(--sd-text);font-size:12px;line-height:1.5;white-space:pre-wrap;word-break:break-word;box-shadow:0 4px 14px rgba(0,0,0,.18);width:fit-content;max-width:100%;text-align:left!important}
    .sd-ai-chat-bubble.is-user{border-color:rgba(116,167,255,.45);background:rgba(70,105,170,.22)}
    .sd-ai-chat-bubble.is-plan{border-color:rgba(120,190,120,.45);background:rgba(60,120,70,.16)}
    .sd-ai-chat-spinner{margin-right:6px;color:var(--sd-accent)}
    .sd-ai-chat-plan-actions{display:flex;gap:7px;align-items:center;flex-wrap:wrap}
    .sd-ai-chat-plan-actions span{font-size:11px;color:var(--sd-text-3)}
    .sd-ai-chat-applied{font-size:11px;color:var(--sd-success)}
    .sd-ai-chat-apply,.sd-ai-chat-send{background:var(--sd-accent);border:1px solid var(--sd-accent);border-radius:8px;color:var(--sd-accent-text,#fff);padding:7px 12px;cursor:pointer;font-size:11px;font-weight:800;display:inline-flex;gap:5px;align-items:center;justify-content:center}
    .sd-ai-chat-apply:hover,.sd-ai-chat-send:hover{filter:brightness(1.08)}
    .sd-ai-chat-composer{border-top:1px solid var(--sd-border);padding:10px;background:var(--sd-bg-2);display:flex;flex-direction:column;gap:7px;flex:0 0 auto}
    .sd-ai-chat-composer textarea{width:100%;box-sizing:border-box;background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:9px;color:var(--sd-text);padding:9px 11px;resize:vertical;font-family:inherit;font-size:12px;line-height:1.45;min-height:70px;outline:none;text-align:left!important}
    .sd-ai-chat-composer textarea:focus{border-color:var(--sd-accent);box-shadow:0 0 0 1px rgba(116,167,255,.28)}
    .sd-ai-chat-compose-row{display:flex;gap:8px;align-items:center;justify-content:space-between}
    .sd-ai-chat-compose-row span{font-size:11px;color:var(--sd-text-3)}
    .sd-ai-chat-messages::-webkit-scrollbar,.sd-ai-chat-sidebar::-webkit-scrollbar{width:6px}
    .sd-ai-chat-messages::-webkit-scrollbar-thumb,.sd-ai-chat-sidebar::-webkit-scrollbar-thumb{background:var(--sd-border);border-radius:3px}
    @media(max-width:620px){.sd-ai-chat-body{grid-template-columns:1fr}.sd-ai-chat-sidebar{max-height:118px;border-right:0;border-bottom:1px solid var(--sd-border)}.sd-ai-chat-compose-row{align-items:stretch;flex-direction:column}.sd-ai-chat-send{width:100%!important}.sd-ai-chat-titlebox span{display:none}}
  `;
  document.head.appendChild(s);
}
