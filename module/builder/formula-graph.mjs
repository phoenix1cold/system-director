import { migrateGraph } from "./node-migration.mjs";
import { pinSubtype, subtypeColor, arePinsCompatible } from "./pin-types.mjs";
import { lintGraph, lintSummary } from "./graph-linter.mjs";
import {
  formulaBounds, clampFormula, multiplyFormula, addMod, doubleDice,
  resolveAtRefs, coerceBool
} from "./formula-utils.mjs";
import { WIDGET_VARIANTS } from "./widget-registry.mjs";

function uid() { return Math.random().toString(36).slice(2,9); }
function esc(s) { return String(s??"").replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;"); }

function _slugLabel(s) {
  const map = {
    "→":"Arrow", "←":"ArrowL", "↑":"ArrowU", "↓":"ArrowD",
    "≠":"NEq", "≥":"GEq", "≤":"LEq", "∞":"Inf",
    "×":"Times", "÷":"Div",
    "•":"Bullet",
    "@":"At", "#":"Hash", "%":"Pct", "+":"Plus", "-":"Minus",
    "&":"Amp", "/":"Slash", "\\":"Bslash",
    "(":"", ")":"", "[":"", "]":"", "{":"", "}":"",
    ",":"", ".":"", ":":"", ";":"", "?":"Q", "!":"Bang", "*":"Star",
    "=":"Eq", "<":"Lt", ">":"Gt", "|":"Pipe"
  };
  let out = "";
  for (const ch of String(s ?? "")) {
    if (/[A-Za-zА-Яа-яЁё0-9]/.test(ch)) out += ch;
    else if (map[ch] !== undefined)     out += map[ch];
    else if (/\s/.test(ch))             out += "_";
  }
  return out.replace(/^_+|_+$/g, "").replace(/__+/g, "_") || "_";
}

function _NL(text) {
  if (!text) return text;
  try {
    const key  = `SD.Graph.${_slugLabel(text)}`;
    const i18n = globalThis.game?.i18n;
    if (i18n?.has?.(key)) return i18n.localize(key);
    if (i18n?.localize) {
      const s = i18n.localize(key);
      if (s && s !== key) return s;
    }
  } catch {  }
  return text;
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

  attr_score_val: {
    title:"Attr Score", color:"#7a4a1a", cat:"_attr",
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
    outputs:[{id:"exec", label:"→ Execute", type:"exec"}],
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
    title:"Branch", color:"#8a2a8a", cat:"Flow",
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

  on_click: {
    title:"On Click", color:"#b05000", cat:"Flow",
    desc:"Entry point — fired when the item's Use button is pressed. Connect its exec output to your action chain.",
    inputs:[],
    outputs:[{id:"exec", label:"→ Execute", type:"exec"}],
    fields:[],
    isTrigger: true
  },

  sequence: {
    title:"Sequence", color:"#8a2a8a", cat:"Flow",
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
    title:"Number", color:"#2a4a6a", cat:"Sources",
    inputs:[{id:"in",label:"In",type:"value.number"}], outputs:[{id:"v",label:"Out",type:"value.number"}],
    fields:[{key:"value",label:"",type:"number",default:0}],
    compile:(n,i)=> i.in !== undefined ? String(i.in) : String(n.data.value ?? 0)
  },
  literal_str: {
    title:"Text", color:"#2a4a6a", cat:"Sources",
    inputs:[{id:"in",label:"In",type:"value.string"}], outputs:[{id:"v",label:"Out",type:"value.string"}],
    fields:[{key:"value",label:"",type:"text",default:""}],
    compile:(n,i)=>{
      const v = i.in !== undefined ? String(i.in) : String(n.data.value ?? "");
      return `"${v.replace(/\\/g,"\\\\").replace(/"/g,'\\"')}"`;
    }
  },
  get_path: {
    title:"Get Field Value", color:"#1a4060", cat:"Sources",
    desc:"Read any field from the actor or item by dot-path. Outputs the value at the given path.",
    inputs:[], outputs:[{id:"v",label:"Value",type:"value.any"}],
    fields:[{key:"path",label:"Path",type:"path",default:"system.resources.hp.value"}],
    compile:(n)=>`{${n.data.path??""}}`
  },
  get_widget: {
    title:"Get Widget Value", color:"#1a4060", cat:"Sources",
    desc:"Read the current computed value of another widget by its Widget Key",
    inputs:[], outputs:[{id:"v",label:"Value",type:"value.any"}],
    fields:[{key:"key",label:"Widget",type:"widget-picker",default:""}],
    compile:(n)=>`{widget:${n.data.key??""}}`
  },
  get_widget_path: {
    title:"Get Widget Path", color:"#1a4060", cat:"Sources",
    desc:"Emits the data path bound to a widget (e.g. system.flags.hp). Feed into Set Field / Modify to change the widget's value from the graph.",
    inputs:[], outputs:[{id:"v",label:"Path",type:"value.path"}],
    fields:[{key:"key",label:"Widget",type:"widget-picker",default:""}],
    compile:(n)=>`{widgetPath:${n.data.key??""}}`
  },
  get_name: {
    title:"Get Name", color:"#1a4060", cat:"Sources",
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
    title:"Actor @Ref", color:"#1a4060", cat:"Sources",
    desc:"Shorthand from actor roll data: @attr1=attr1.mod, @level, @prof",
    inputs:[], outputs:[{id:"v",label:"Value",type:"value.any"}],
    fields:[{key:"ref",label:"@name",type:"text",default:"attr1",placeholder:"attr1 / level / prof"}],
    compile:(n)=>`{@${n.data.ref??"attr1"}}`
  },
  slot_count: {
    title:"Slot Count", color:"#1a4060", cat:"Sources",
    desc:"Count items in a slot. Slot is auto-indexed — pick from dropdown or connect a Get Actor Slot ID node.",
    inputs:[{id:"itemSlot",label:"Item Slot",type:"value.any"}],
    outputs:[{id:"v",label:"Count",type:"value.number"}],
    fields:[{key:"slotId",label:"Slot ID",type:"slot-picker",default:"slot1"}],
    compile:(n,i)=>{
      if (i.itemSlot != null) return `{slotCount:${i.itemSlot}}`;
      const path = n.data.slotPath;
      if (path) {
        const parts = path.split("/");
        if (parts.length === 2) return `{invItemSlotCount:${parts[0]}.${parts[1]}}`;
        return `{nestedSlotCount:${path}}`;
      }

      return `{slotCount:${n.data.slotId??"slot1"}}`;
    }
  },
  slot_field: {
    title:"Slot Item Field", color:"#1a4060", cat:"Sources",
    desc:"Field on item at index inside a slot (0=first)",
    inputs:[], outputs:[{id:"v",label:"Value",type:"value.any"}],
    fields:[
      {key:"slotId",label:"Slot ID",type:"text",default:"slot1"},
      {key:"index", label:"Index",  type:"number",default:0},
      {key:"path",  label:"Field",  type:"path",default:"system.hiddenFields.field"}
    ],
    compile:(n)=>`{slot:${n.data.slotId??"slot1"}.${n.data.index??0}.${n.data.path??""}}`
  },
  item_uuid: {
    title:"Item by UUID", color:"#1a3050", cat:"Sources",
    desc:"Drag an item from the sidebar here to get its UUID, then read a field",
    inputs:[], outputs:[{id:"v",label:"Value",type:"value.any"}],
    fields:[
      {key:"uuid", label:"UUID",  type:"text",default:"",placeholder:"Item.xxxxx or drag item here"},
      {key:"path", label:"Field", type:"path",default:"system.hiddenFields.field"}
    ],
    compile:(n)=>{ const p=n.data.path??""; const u=n.data.uuid??""; return `{item:id:${u}${p?"."+p:""}}`; }
  },
  target_field: {
    title:"Target Field", color:"#1a4060", cat:"Sources",
    desc:"Read a field from the first targeted/selected token's actor",
    inputs:[], outputs:[{id:"v",label:"Value",type:"value.any"}],
    fields:[{key:"path",label:"Field",type:"path",default:"system.resources.hp.value"}],
    compile:(n)=>`{target.${n.data.path??""}}`
  },

  fa_icon: {
    title:"FA Icon", color:"#2a4060", cat:"Sources",
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
    title:"Dice", color:"#7a4500", cat:"Dice",
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
    title:"Formula Range", color:"#7a4500", cat:"Dice",
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
    title:"Formula Clamp", color:"#7a4500", cat:"Dice",
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
    title:"Formula × N", color:"#7a4500", cat:"Dice",
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

  formula_add: {
    title:"Formula + Mod", color:"#7a4500", cat:"Dice",
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
    title:"Roll Stat", color:"#7a4500", cat:"Dice",
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

  add:  {title:"Add",   color:"#1a5c2a",cat:"Math",inputs:[{id:"a",label:"A",type:"value.any"},{id:"b",label:"B",type:"value.any"}],outputs:[{id:"v",label:"",type:"value.any"}],fields:[{key:"sep",label:"Sep",type:"text",default:""},_ROUND_FIELD],compile:(n,i)=>{ const sep=n.data.sep??""; if (sep) return `(${i.a??""} + "${sep.replace(/"/g,'\\"')}" + ${i.b??""})`; return _round(`(${i.a??"0"}+${i.b??"0"})`, n.data); }},
  sub:  {title:"Sub",   color:"#1a5c2a",cat:"Math",inputs:[{id:"a",label:"A",type:"value.number"},{id:"b",label:"B",type:"value.number"}],outputs:[{id:"v",label:"",type:"value.number"}],fields:[_ROUND_FIELD],compile:(n,i)=>_round(`(${i.a??"0"}-${i.b??"0"})`, n.data)},
  mul:  {title:"Mul",   color:"#1a5c2a",cat:"Math",inputs:[{id:"a",label:"A",type:"value.number"},{id:"b",label:"B",type:"value.number"}],outputs:[{id:"v",label:"",type:"value.number"}],fields:[_ROUND_FIELD],compile:(n,i)=>_round(`(${i.a??"0"}*${i.b??"0"})`, n.data)},
  div:  {title:"Div",   color:"#1a5c2a",cat:"Math",inputs:[{id:"a",label:"A",type:"value.number"},{id:"b",label:"B",type:"value.number"}],outputs:[{id:"v",label:"",type:"value.number"}],fields:[_ROUND_FIELD],compile:(n,i)=>_round(`(${i.a??"0"}/${i.b??"1"})`, n.data)},
  floor:{title:"Floor", color:"#1a5c2a",cat:"Math",inputs:[{id:"a",label:"A",type:"value.number"}],outputs:[{id:"v",label:"",type:"value.number"}],fields:[],compile:(_,i)=>`floor(${i.a??"0"})`},
  ceil: {title:"Ceil",  color:"#1a5c2a",cat:"Math",inputs:[{id:"a",label:"A",type:"value.number"}],outputs:[{id:"v",label:"",type:"value.number"}],fields:[],compile:(_,i)=>`ceil(${i.a??"0"})`},
  round:{title:"Round", color:"#1a5c2a",cat:"Math",inputs:[{id:"a",label:"A",type:"value.number"}],outputs:[{id:"v",label:"",type:"value.number"}],fields:[],compile:(_,i)=>`round(${i.a??"0"})`},
  max2: {title:"Max",   color:"#1a5c2a",cat:"Math",inputs:[{id:"a",label:"A",type:"value.number"},{id:"b",label:"B",type:"value.number"}],outputs:[{id:"v",label:"",type:"value.number"}],fields:[_ROUND_FIELD],compile:(n,i)=>_round(`max(${i.a??"0"},${i.b??"0"})`, n.data)},
  min2: {title:"Min",   color:"#1a5c2a",cat:"Math",inputs:[{id:"a",label:"A",type:"value.number"},{id:"b",label:"B",type:"value.number"}],outputs:[{id:"v",label:"",type:"value.number"}],fields:[_ROUND_FIELD],compile:(n,i)=>_round(`min(${i.a??"0"},${i.b??"0"})`, n.data)},
  abs:  {title:"Abs",   color:"#1a5c2a",cat:"Math",inputs:[{id:"a",label:"A",type:"value.number"}],outputs:[{id:"v",label:"",type:"value.number"}],fields:[_ROUND_FIELD],compile:(n,i)=>_round(`abs(${i.a??"0"})`, n.data)},
  clamp:{title:"Clamp", color:"#1a5c2a",cat:"Math",
         inputs:[{id:"v",label:"Val",type:"value.number"},{id:"lo",label:"Min",type:"value.number"},{id:"hi",label:"Max",type:"value.number"}],
         outputs:[{id:"v",label:"",type:"value.number"}],fields:[_ROUND_FIELD],
         compile:(n,i)=>_round(`max(${i.lo??"0"},min(${i.hi??"0"},${i.v??"0"}))`, n.data)},

  eq: {title:"==",color:"#6a1a6a",cat:"Compare",desc:"Equality check. Works for both numbers (5 == 5) and text (\"hello\" == \"hello\", Cyrillic / Latin / Unicode).",inputs:[{id:"a",label:"A",type:"value.any"},{id:"b",label:"B",type:"value.any"}],outputs:[{id:"v",label:"Bool",type:"value.bool"}],fields:[],compile:(_,i)=>{
    const a = (i.a !== undefined && i.a !== null && i.a !== "") ? i.a : "0";
    const b = (i.b !== undefined && i.b !== null && i.b !== "") ? i.b : "0";
    const _b64 = (s) => {
      try { return btoa(unescape(encodeURIComponent(String(s)))); }
      catch { return ""; }
    };
    return `{__sdEq:${_b64(a)}|${_b64(b)}}`;
  }},
  neq:{title:"≠", color:"#6a1a6a",cat:"Compare",desc:"Inequality check. Works for both numbers and text (Cyrillic / Latin / Unicode).",inputs:[{id:"a",label:"A",type:"value.any"},{id:"b",label:"B",type:"value.any"}],outputs:[{id:"v",label:"Bool",type:"value.bool"}],fields:[],compile:(_,i)=>{
    const a = (i.a !== undefined && i.a !== null && i.a !== "") ? i.a : "0";
    const b = (i.b !== undefined && i.b !== null && i.b !== "") ? i.b : "0";
    const _b64 = (s) => {
      try { return btoa(unescape(encodeURIComponent(String(s)))); }
      catch { return ""; }
    };
    return `{__sdNeq:${_b64(a)}|${_b64(b)}}`;
  }},
  gt: {title:">", color:"#6a1a6a",cat:"Compare",inputs:[{id:"a",label:"A",type:"value.any"},{id:"b",label:"B",type:"value.any"}],outputs:[{id:"v",label:"Bool",type:"value.bool"}],fields:[],compile:(_,i)=>`(${i.a??"0"}>${i.b??"0"})`},
  lt: {title:"<", color:"#6a1a6a",cat:"Compare",inputs:[{id:"a",label:"A",type:"value.any"},{id:"b",label:"B",type:"value.any"}],outputs:[{id:"v",label:"Bool",type:"value.bool"}],fields:[],compile:(_,i)=>`(${i.a??"0"}<${i.b??"0"})`},
  gte:{title:">=",color:"#6a1a6a",cat:"Compare",inputs:[{id:"a",label:"A",type:"value.any"},{id:"b",label:"B",type:"value.any"}],outputs:[{id:"v",label:"Bool",type:"value.bool"}],fields:[],compile:(_,i)=>`(${i.a??"0"}>=${i.b??"0"})`},
  lte:{title:"<=",color:"#6a1a6a",cat:"Compare",inputs:[{id:"a",label:"A",type:"value.any"},{id:"b",label:"B",type:"value.any"}],outputs:[{id:"v",label:"Bool",type:"value.bool"}],fields:[],compile:(_,i)=>`(${i.a??"0"}<=${i.b??"0"})`},

  and:{title:"AND",color:"#6a1a1a",cat:"Logic",inputs:[{id:"a",label:"A",type:"value.bool"},{id:"b",label:"B",type:"value.bool"}],outputs:[{id:"v",label:"Bool",type:"value.bool"}],fields:[],compile:(_,i)=>`(${i.a??"0"}&&${i.b??"0"})`},
  or: {title:"OR", color:"#6a1a1a",cat:"Logic",inputs:[{id:"a",label:"A",type:"value.bool"},{id:"b",label:"B",type:"value.bool"}],outputs:[{id:"v",label:"Bool",type:"value.bool"}],fields:[],compile:(_,i)=>`(${i.a??"0"}||${i.b??"0"})`},
  not:{title:"NOT",color:"#6a1a1a",cat:"Logic",inputs:[{id:"a",label:"A",type:"value.bool"}],outputs:[{id:"v",label:"Bool",type:"value.bool"}],fields:[],compile:(_,i)=>`(!${i.a??"0"})`},

  act_roll_value: {
    title:"Roll → Value", color:"#8a4400", cat:"Roll",
    desc:"Rolls dice and forwards the numeric result as a value output. When Roll dialog is enabled, a Disadvantage/Normal/Advantage picker opens first, each option using the formula from its corresponding pin. Reroll button (yes/no) adds a Re-roll button to the chat card; Reroll Path / Reroll Cost optionally consume a numeric resource from the source actor each time the player rerolls. Outputs: Result (final sum), Formula (resolved string), Min/Max/Avg (theoretical bounds & expected value), Dice Array (every active die's value as a CSV array — pipe into Array Join / Array Length / Get Element / Filter to inspect individual die results, e.g. 2d6 → \"3,5\"). For crit / fumble logic use Attack Check or Roll Check — Roll Value is intentionally just numbers and dice.",
    inputs:[
      {id:"exec",             label:"",              type:"exec"},
      {id:"formula",          label:"Formula",        type:"value.string"},
      {id:"advFormula",       label:"Adv Formula",    type:"value.string"},
      {id:"disFormula",       label:"Dis Formula",    type:"value.string"},
      {id:"rerollEnabled",    label:"Reroll button",  type:"value.bool"},
      {id:"rerollPath",       label:"Reroll Path",    type:"value.path"},
      {id:"rerollCost",       label:"Reroll Cost",    type:"value.number"}
    ],
    outputs:[
      {id:"exec",          label:"",              type:"exec"},
      {id:"result",        label:"Result",        type:"value.number"},
      {id:"formula",       label:"Formula",       type:"value.string"},
      {id:"min",           label:"Min",           type:"value.number"},
      {id:"max",           label:"Max",           type:"value.number"},
      {id:"avg",           label:"Avg",           type:"value.number"},
      {id:"diceArray",     label:"Dice Array",    type:"value.array"}
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
      {key:"rerollCost",     label:"Reroll cost",          type:"number", default:1}
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
        rerollCost: Number((inp.rerollCost != null && inp.rerollCost !== "") ? inp.rerollCost : (n.data.rerollCost ?? 1)) || 0
      };
    }
  },

  act_damage: {
    title:"Damage", color:"#8a1a1a", cat:"Damage", wideNode:true,
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
    title:"Heal", color:"#1a7a2a", cat:"Damage", wideNode:true,
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
      {key:"duration",   label:"Rounds (0=∞)",type:"number", default:0},
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
      {key:"duration",   label:"Rounds (0=∞)",  type:"number", default:0}
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
    title:"For Each Target", color:"#1a5a7a", cat:"Flow",
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
    title:"For Each Token", color:"#1a5a7a", cat:"Flow",
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
    title:"Token Field", color:"#1a4060", cat:"Sources",
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
    compile:(_,i)=>`{arrayLength:${i.tokens ?? ""}}`
  },

  arr_at: {
    title:"Token at Index", color:"#2a7a3a", cat:"Array",
    desc:"Returns the Nth token id (0-based) from a comma-joined list (Saved[]/Failed[]/All[] etc.). If Index is out of range, returns empty.",
    inputs:[
      {id:"tokens", label:"Tokens", type:"value.array"},
      {id:"index",  label:"Index",  type:"value.number"}
    ],
    outputs:[{id:"v", label:"Token", type:"value.any"}],
    fields:[{key:"index",label:"Index",type:"number",default:0}],
    compile:(n,i)=>`{arrayAt:${i.tokens ?? ""}|${i.index ?? n.data.index ?? 0}}`
  },

  arr_map_field: {
    title:"Map Field", color:"#2a7a3a", cat:"Array",
    desc:"For every token in the array, read the same field from its actor and return all values as a new comma-joined list. Use to feed numeric arrays into Aggregate / Find / Filter or to compare values across tokens.",
    inputs:[{id:"tokens", label:"Tokens", type:"value.array"}],
    outputs:[{id:"v", label:"Values", type:"value.array"}],
    fields:[{key:"path",label:"Field",type:"path",default:"system.resources.hp.value"}],
    compile:(n,i)=>`{arrayMapField:${i.tokens ?? ""}|${n.data.path ?? ""}}`
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
    compile:(n,i)=>`{arrayAgg:${i.tokens ?? ""}|${n.data.path ?? ""}|${n.data.op ?? "sum"}}`
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
    compile:(n,i)=>`{arrayFindExtreme:${i.tokens ?? ""}|${n.data.path ?? ""}|${n.data.op ?? "max"}}`
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
      return `{arrayFilter:${i.tokens ?? ""}|${n.data.path ?? ""}|${n.data.op ?? ">"}|${cmp}}`;
    }
  },

  arr_compare_two: {
    title:"Compare Two Tokens", color:"#5a3a7a", cat:"Array",
    desc:"Read the same field on two tokens and route exec into Greater / Less / Equal based on (A − B). Diff outputs the numeric difference and Winner outputs the id of the higher token (empty on tie).",
    inputs:[
      {id:"exec",   label:"",        type:"exec"},
      {id:"a",      label:"Token A", type:"value.array"},
      {id:"b",      label:"Token B", type:"value.array"}
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
    compile:(n,i)=>`{arraySort:${i.tokens ?? ""}|${n.data.path ?? ""}|${n.data.op ?? "desc"}}`
  },

  arr_slice: {
    title:"Slice / Take", color:"#2a7a3a", cat:"Array",
    desc:"Take a sub-range of an array. Start is 0-based; Count of -1 means «to the end». Use after Sort to get top-N / bottom-N.",
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
      return `{arraySlice:${i.tokens ?? ""}|${s}|${c}}`;
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
    compile:(_,i)=>`{arrayConcat:${i.a ?? ""}|${i.b ?? ""}}`
  },

  arr_union: {
    title:"Union", color:"#2a7a3a", cat:"Array",
    desc:"All ids present in A or B (unique).",
    inputs:[
      {id:"a", label:"A", type:"value.array"},
      {id:"b", label:"B", type:"value.array"}
    ],
    outputs:[{id:"v", label:"A ∪ B", type:"value.array"}],
    fields:[],
    compile:(_,i)=>`{arrayUnion:${i.a ?? ""}|${i.b ?? ""}}`
  },

  arr_intersect: {
    title:"Intersect", color:"#2a7a3a", cat:"Array",
    desc:"Only ids present in BOTH A and B. «Tokens that are buffed AND poisoned».",
    inputs:[
      {id:"a", label:"A", type:"value.array"},
      {id:"b", label:"B", type:"value.array"}
    ],
    outputs:[{id:"v", label:"A ∩ B", type:"value.array"}],
    fields:[],
    compile:(_,i)=>`{arrayIntersect:${i.a ?? ""}|${i.b ?? ""}}`
  },

  arr_difference: {
    title:"Difference", color:"#2a7a3a", cat:"Array",
    desc:"Ids in A that are NOT in B. «Targets that did not save».",
    inputs:[
      {id:"a", label:"A", type:"value.array"},
      {id:"b", label:"B", type:"value.array"}
    ],
    outputs:[{id:"v", label:"A − B", type:"value.array"}],
    fields:[],
    compile:(_,i)=>`{arrayDifference:${i.a ?? ""}|${i.b ?? ""}}`
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
    compile:(_,i)=>`{arrayContains:${i.tokens ?? ""}|${i.id ?? ""}}`
  },

  arr_distinct: {
    title:"Distinct", color:"#2a7a3a", cat:"Array",
    desc:"Remove duplicate ids preserving first-seen order.",
    inputs:[{id:"tokens", label:"Tokens", type:"value.array"}],
    outputs:[{id:"v", label:"Unique", type:"value.array"}],
    fields:[],
    compile:(_,i)=>`{arrayDistinct:${i.tokens ?? ""}}`
  },

  arr_make: {
    title:"Array Make", color:"#2a7a3a", cat:"Array",
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
      const _b64 = (s) => { try { return btoa(unescape(encodeURIComponent(String(s ?? "")))); } catch { return ""; } };
      const parts = [];
      for (let k = 0; k < 8; k++) {
        const id = `v${k}`;
        const fromPin = i[id];
        const fromField = n.data?.[id];
        const v = (fromPin != null && fromPin !== "") ? fromPin : (fromField ?? "");
        parts.push(_b64(v));
      }
      const tail = `|len`.padStart(0, "");
      return `{arrayMake:${parts.join("|")}}`;
    },
    compilePin:(n,i,pin)=>{
      const _b64 = (s) => { try { return btoa(unescape(encodeURIComponent(String(s ?? "")))); } catch { return ""; } };
      const parts = [];
      for (let k = 0; k < 8; k++) {
        const id = `v${k}`;
        const fromPin = i[id];
        const fromField = n.data?.[id];
        const v = (fromPin != null && fromPin !== "") ? fromPin : (fromField ?? "");
        parts.push(_b64(v));
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
      const _b64 = (s) => { try { return btoa(unescape(encodeURIComponent(String(s ?? "")))); } catch { return ""; } };
      const sep = (i.sep != null && i.sep !== "") ? i.sep : (n.data.sep ?? ",");
      return `{arraySplit:${_b64(i.s ?? "")}|${_b64(sep)}}`;
    },
    compilePin:(n,i,pin)=>{
      const _b64 = (s) => { try { return btoa(unescape(encodeURIComponent(String(s ?? "")))); } catch { return ""; } };
      const sep = (i.sep != null && i.sep !== "") ? i.sep : (n.data.sep ?? ",");
      const arr = `{arraySplit:${_b64(i.s ?? "")}|${_b64(sep)}}`;
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
      const _b64 = (s) => { try { return btoa(unescape(encodeURIComponent(String(s ?? "")))); } catch { return ""; } };
      const sep = (i.sep != null && i.sep !== "") ? i.sep : (n.data.sep ?? ", ");
      return `{arrayJoin:${i.a ?? ""}|${_b64(sep)}}`;
    }
  },

  arr_push: {
    title:"Array Push", color:"#2a7a3a", cat:"Array",
    desc:"Append one element to an array and return the new array. Original array is not mutated. Empty Element is skipped (returns the array unchanged).",
    inputs:[
      {id:"a", label:"Array",   type:"value.array"},
      {id:"v", label:"Element", type:"value.any"}
    ],
    outputs:[{id:"v", label:"Array", type:"value.array"},{id:"len", label:"Length", type:"value.number"}],
    fields:[],
    compile:(_,i)=>{
      const _b64 = (s) => { try { return btoa(unescape(encodeURIComponent(String(s ?? "")))); } catch { return ""; } };
      return `{arrayPush:${i.a ?? ""}|${_b64(i.v ?? "")}}`;
    },
    compilePin:(_,i,pin)=>{
      const _b64 = (s) => { try { return btoa(unescape(encodeURIComponent(String(s ?? "")))); } catch { return ""; } };
      const arr = `{arrayPush:${i.a ?? ""}|${_b64(i.v ?? "")}}`;
      if (pin === "len") return `{arrayLength:${arr}}`;
      return arr;
    }
  },

  arr_get: {
    title:"Array Get (generic)", color:"#2a7a3a", cat:"Array",
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
      const _b64 = (s) => { try { return btoa(unescape(encodeURIComponent(String(s ?? "")))); } catch { return ""; } };
      const idx = (i.i != null && i.i !== "") ? i.i : (n.data.i ?? 0);
      const def = (i.def != null && i.def !== "") ? i.def : (n.data.def ?? "");
      return `{arrayGet:${i.a ?? ""}|${idx}|${_b64(def)}}`;
    },
    compilePin:(n,i,pin)=>{
      const _b64 = (s) => { try { return btoa(unescape(encodeURIComponent(String(s ?? "")))); } catch { return ""; } };
      const idx = (i.i != null && i.i !== "") ? i.i : (n.data.i ?? 0);
      const def = (i.def != null && i.def !== "") ? i.def : (n.data.def ?? "");
      if (pin === "found") return `{arrayHasIndex:${i.a ?? ""}|${idx}}`;
      return `{arrayGet:${i.a ?? ""}|${idx}|${_b64(def)}}`;
    }
  },

  arr_first: {
    title:"Array First", color:"#2a7a3a", cat:"Array",
    desc:"Return the first element of an array (`arr[0]`). Empty if the array is empty.",
    inputs:[{id:"a", label:"Array", type:"value.array"}],
    outputs:[{id:"v", label:"Value", type:"value.any"}],
    fields:[],
    compile:(_,i)=>`{arrayGet:${i.a ?? ""}|0|}`
  },

  arr_last: {
    title:"Array Last", color:"#2a7a3a", cat:"Array",
    desc:"Return the last element of an array (`arr[-1]`). Empty if the array is empty.",
    inputs:[{id:"a", label:"Array", type:"value.array"}],
    outputs:[{id:"v", label:"Value", type:"value.any"}],
    fields:[],
    compile:(_,i)=>`{arrayGet:${i.a ?? ""}|-1|}`
  },

  arr_reverse: {
    title:"Array Reverse", color:"#2a7a3a", cat:"Array",
    desc:"Reverse the order of elements. Original array is not mutated.",
    inputs:[{id:"a", label:"Array", type:"value.array"}],
    outputs:[{id:"v", label:"Array", type:"value.array"}],
    fields:[],
    compile:(_,i)=>`{arrayReverse:${i.a ?? ""}}`
  },

  arr_sum_num: {
    title:"Array Sum (numeric)", color:"#2a7a3a", cat:"Array",
    desc:"Sum of numeric elements in an already-numeric array (e.g. produced by `Map Field` or `Array Make` with numbers). Non-numeric elements are skipped. Returns 0 for empty arrays.",
    inputs:[{id:"a", label:"Array", type:"value.array"}],
    outputs:[{id:"v", label:"Sum", type:"value.number"}],
    fields:[],
    compile:(_,i)=>`{arrayNum:${i.a ?? ""}|sum}`
  },

  arr_avg_num: {
    title:"Array Average (numeric)", color:"#2a7a3a", cat:"Array",
    desc:"Average of numeric elements. Non-numeric elements are skipped. Returns 0 if there are no numeric elements.",
    inputs:[{id:"a", label:"Array", type:"value.array"}],
    outputs:[{id:"v", label:"Avg", type:"value.number"}],
    fields:[],
    compile:(_,i)=>`{arrayNum:${i.a ?? ""}|avg}`
  },

  arr_min_num: {
    title:"Array Min (numeric)", color:"#2a7a3a", cat:"Array",
    desc:"Lowest numeric element. Returns 0 for empty / non-numeric arrays.",
    inputs:[{id:"a", label:"Array", type:"value.array"}],
    outputs:[{id:"v", label:"Min", type:"value.number"}],
    fields:[],
    compile:(_,i)=>`{arrayNum:${i.a ?? ""}|min}`
  },

  arr_max_num: {
    title:"Array Max (numeric)", color:"#2a7a3a", cat:"Array",
    desc:"Highest numeric element. Returns 0 for empty / non-numeric arrays.",
    inputs:[{id:"a", label:"Array", type:"value.array"}],
    outputs:[{id:"v", label:"Max", type:"value.number"}],
    fields:[],
    compile:(_,i)=>`{arrayNum:${i.a ?? ""}|max}`
  },

  arr_random_pick: {
    title:"Array Random Pick", color:"#2a7a3a", cat:"Array",
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
      return `{arrayRandomPick:${i.a ?? ""}|${cnt}}`;
    },
    compilePin:(n,i,pin)=>{
      const cnt = (i.n != null && i.n !== "") ? i.n : (n.data.n ?? 1);
      return `{arrayRandomPick:${i.a ?? ""}|${cnt}}`;
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
      const _b64 = (s) => { try { return btoa(unescape(encodeURIComponent(String(s ?? "")))); } catch { return ""; } };
      const cmp = (i.v != null && i.v !== "") ? i.v : (n.data.v ?? "");
      return `{arrayFilterGeneric:${i.a ?? ""}|${n.data.op ?? "=="}|${_b64(cmp)}}`;
    },
    compilePin:(n,i,pin)=>{
      const _b64 = (s) => { try { return btoa(unescape(encodeURIComponent(String(s ?? "")))); } catch { return ""; } };
      const cmp = (i.v != null && i.v !== "") ? i.v : (n.data.v ?? "");
      const arr = `{arrayFilterGeneric:${i.a ?? ""}|${n.data.op ?? "=="}|${_b64(cmp)}}`;
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
      const _b64 = (s) => { try { return btoa(unescape(encodeURIComponent(String(s ?? "")))); } catch { return ""; } };
      const f = (i.formula != null && i.formula !== "") ? i.formula : (n.data.formula ?? "{__elem}");
      return `{arrayMapFormula:${i.a ?? ""}|${_b64(f)}}`;
    }
  },

  arr_for_each: {
    title:"For Each Element", color:"#1a5a7a", cat:"Flow",
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
    title:"Modify Field", color:"#4a2a6a", cat:"Field Ops", wideNode:true,
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
    title:"Set Text Field", color:"#4a2a6a", cat:"Field Ops", wideNode:true,
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

  act_set_initiative: {
    title:"Set Initiative", color:"#4a2a6a", cat:"Field Ops",
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
    fields:[],
    isAction:true,
    dynamicPins:[{ base:"text", label:"Text", max:10, type:"value.string" }],
    toAction:(n,inp)=>{
      const parts=[];
      for(let i=0;i<10;i++){
        const v=inp[`text${i}`];
        if(v!==undefined && v!==null && v!=="") parts.push(String(v));
      }
      return {type:"message", messageParts:parts};
    }
  },

  act_add_item: {
    title:"Add Item", color:"#2a4a2a", cat:"Items",
    desc:"Add a world item (drag UUID from sidebar) as a copy to the actor's inventory. Optionally restrict to an inventory widget.",
    inputs:[{id:"exec",label:"",type:"exec"}],
    outputs:[{id:"exec",label:"",type:"exec"}],
    fields:[
      {key:"uuid",            label:"Item UUID (drag here)",  type:"text",          default:"", placeholder:"drag item from sidebar…"},
      {key:"qty",             label:"Qty",                    type:"number",         default:1},
      {key:"inventoryWidget", label:"Inventory Widget",       type:"widget-picker",  default:""}
    ],
    isAction:true, wideNode:true,
    toAction:(n)=>({type:"createItem", uuid:n.data.uuid??"", qty:Number(n.data.qty??1), inventoryWidget:n.data.inventoryWidget??""})
  },

  act_add_slot: {
    title:"Add to Slot", color:"#2a4a2a", cat:"Items",
    desc:"Add an actor-owned item to a slot on this item or actor. Item and Slot are auto-indexed from the document.",
    inputs:[{id:"exec",label:"",type:"exec"}],
    outputs:[{id:"exec",label:"",type:"exec"}],
    fields:[
      {key:"itemName", label:"Item",   type:"item-picker", default:""},
      {key:"slotId",   label:"Slot",   type:"slot-picker", default:"slot1"}
    ],
    isAction:true, wideNode:true,
    toAction:(n)=>({type:"addToSlot", itemName:n.data.itemName??"", slotId:n.data.slotId??"slot1", slotPath:n.data.slotPath??null})
  },

  act_remove_slot: {
    title:"Remove from Slot", color:"#6a2a2a", cat:"Items",
    desc:"Remove an item from a slot by slot ID. Slot is auto-indexed.",
    inputs:[{id:"exec",label:"",type:"exec"}],
    outputs:[{id:"exec",label:"",type:"exec"}],
    fields:[
      {key:"slotId", label:"Slot",  type:"slot-picker", default:"slot1"},
      {key:"index",  label:"Index (0=first)", type:"number", default:0}
    ],
    isAction:true, wideNode:true,
    toAction:(n)=>({type:"removeFromSlot", slotId:n.data.slotId??"slot1", index:n.data.index??0, slotPath:n.data.slotPath??null})
  },

  act_remove_item: {
    title:"Remove Item", color:"#6a2a2a", cat:"Items",
    desc:"Remove an owned item from actor inventory. Item is auto-indexed — pick from dropdown. Optionally scope to a widget.",
    inputs:[{id:"exec",label:"",type:"exec"}],
    outputs:[{id:"exec",label:"",type:"exec"}],
    fields:[
      {key:"itemName",        label:"Item",              type:"item-picker",   default:""},
      {key:"uuid",            label:"…or UUID",          type:"text",          default:"", placeholder:"drag item from sidebar…"},
      {key:"inventoryWidget", label:"Inventory Widget",  type:"widget-picker", default:""}
    ],
    isAction:true, wideNode:true,
    toAction:(n)=>({type:"removeItem", uuid:n.data.uuid??"", itemName:n.data.itemName??"", inventoryWidget:n.data.inventoryWidget??""})
  },

  act_use_slot_item: {
    title:"Use Slot Item", color:"#2a5a3a", cat:"Items",
    desc:"Calls item.use() on the item sitting at [index] in a slot. Slot is auto-indexed.",
    inputs:[{id:"exec",label:"",type:"exec"},{id:"index",label:"Index",type:"value.number"}],
    outputs:[{id:"exec",label:"",type:"exec"}],
    fields:[
      {key:"slotId", label:"Slot",         type:"slot-picker", default:"slot1"},
      {key:"index",  label:"Index (0=first)", type:"number",   default:0}
    ],
    isAction:true, wideNode:true,
    toAction:(n,inp)=>({type:"useSlotItem", slotId:n.data.slotId??"slot1", index:inp.index??n.data.index??0})
  },

  act_use_item: {
    title:"Use Item", color:"#2a5a3a", cat:"Items",
    desc:"Find an owned item by name and call item.use(). Item is auto-indexed from actor inventory.",
    inputs:[{id:"exec",label:"",type:"exec"}],
    outputs:[{id:"exec",label:"",type:"exec"}],
    fields:[
      {key:"itemName", label:"Item",          type:"item-picker", default:""},
      {key:"uuid",     label:"…or UUID",      type:"text",        default:"", placeholder:"drag item here"},
      {key:"category", label:"…or Category",  type:"text",        default:"", placeholder:"first item of category"},
      {key:"index",    label:"Category index",type:"number",      default:0}
    ],
    isAction:true, wideNode:true,
    toAction:(n)=>({type:"useItem", itemName:n.data.itemName??"", uuid:n.data.uuid??"", category:n.data.category??"", index:Number(n.data.index??0)})
  },

  act_equip: {
    title:"Equip Item", color:"#2a5a7a", cat:"Items",
    desc:"Mark an owned inventory item as equipped. Runs canEquip() requirements check; blocks on concentration conflict. If Force is on, skips the check.",
    inputs:[{id:"exec",label:"",type:"exec"}],
    outputs:[{id:"exec",label:"",type:"exec"}],
    fields:[
      {key:"itemName", label:"Item",          type:"item-picker", default:""},
      {key:"uuid",     label:"…or UUID",      type:"text",        default:"", placeholder:"drag item here"},
      {key:"category", label:"…or Category",  type:"text",        default:"", placeholder:"first item of category"},
      {key:"index",    label:"Category index",type:"number",      default:0},
      {key:"force",    label:"Force (skip canEquip)", type:"checkbox", default:false}
    ],
    isAction:true, wideNode:true,
    toAction:(n)=>({type:"equipItem", itemName:n.data.itemName??"", uuid:n.data.uuid??"", category:n.data.category??"", index:Number(n.data.index??0), force:!!n.data.force})
  },

  act_unequip: {
    title:"Unequip Item", color:"#7a2a2a", cat:"Items",
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
    title:"Modify Slot Item Field", color:"#4a2a6a", cat:"Field Ops",
    desc:"Add / subtract / set a field on the item sitting at [index] in a slot. Slot is auto-indexed. Path / Op can be fed via pins (UE-style).",
    inputs:[
      {id:"exec",  label:"",       type:"exec"},
      {id:"amount",label:"Amount", type:"value.number"},
      {id:"index", label:"Index",  type:"value.number"},
      {id:"path",  label:"Path",   type:"value.path"},
      {id:"op",    label:"Op",     type:"value.string"}
    ],
    outputs:[{id:"exec",label:"",type:"exec"}],
    fields:[
      {key:"slotId", label:"Slot",          type:"slot-picker", default:"slot1"},
      {key:"index",  label:"Index (0=first)",  type:"number", default:0},
      {key:"path",   label:"Field Path",       type:"path",   default:"system.hiddenFields.field"},
      {key:"op",     label:"Operation",        type:"select", default:"add", options:["add","subtract","set"]}
    ],
    isAction:true, wideNode:true,
    toAction:(n,inp)=>({
      type:"modifySlotItemField",
      slotId: n.data.slotId??"slot1",
      index:  inp.index??n.data.index??0,
      path:   (inp.path != null && inp.path !== "") ? String(inp.path) : (n.data.path??""),
      op:     (inp.op   != null && inp.op   !== "") ? String(inp.op)   : (n.data.op??"add"),
      amount: inp.amount??0
    })
  },

  act_modify_inv_item_field: {
    title:"Modify Inventory Item Field", color:"#4a2a6a", cat:"Field Ops",
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
    title:"Inventory Item Field", color:"#1a4060", cat:"Sources",
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
    title:"Slot Item UUID", color:"#1a4060", cat:"Sources",
    desc:"Outputs the UUID of the item at [index] in a slot. Slot is auto-indexed.",
    inputs:[], outputs:[{id:"v",label:"UUID (str)",type:"value.uuid"}],
    fields:[
      {key:"slotId", label:"Slot",          type:"slot-picker", default:"slot1"},
      {key:"index",  label:"Index (0=first)", type:"number",    default:0}
    ],
    compile:(n)=>`{slotUuid:${n.data.slotId??"slot1"}.${n.data.index??0}}`
  },

  get_actor_slot_id: {
    title:"Get Actor Slot ID", color:"#1a4060", cat:"Sources",
    desc:"Reference a slot by ID — connect to the Item Slot pin on Slot Count, Add/Remove from Inv Item Slot nodes to dynamically select which slot to operate on.",
    inputs:[], outputs:[{id:"v",label:"Item Slot",type:"value.any"}],
    fields:[{key:"slotId",label:"Slot ID",type:"slot-picker",default:"slot1"}],
    compile:(n)=>(n.data.slotId??"slot1")
  },

  inv_item_slot_count: {
    title:"Inv Item Slot Count", color:"#1a4060", cat:"Sources",
    desc:"Count of items in a slot on an actor-owned inventory item. Item and slot are auto-indexed. Connect Get Actor Slot ID to override slot.",
    inputs:[{id:"itemSlot",label:"Item Slot",type:"value.any"}],
    outputs:[{id:"v",label:"Count",type:"value.number"}],
    fields:[
      {key:"itemName", label:"Item",                    type:"item-picker", default:""},
      {key:"uuid",     label:"…or UUID",                type:"text",        default:"", placeholder:"drag item here"},
      {key:"slotId",   label:"Slot on that item",       type:"slot-picker", default:"slot1"}
    ],
    compile:(n,i)=>`{invItemSlotCount:${n.data.uuid||n.data.itemName||"?"}.${i.itemSlot??n.data.slotId??"slot1"}}`
  },

  act_remove_from_inv_item_slot: {
    title:"Remove from Inv Item Slot", color:"#6a2a2a", cat:"Items",
    desc:"Find an item in actor's inventory, then remove one item from its slot. Both item and slot are auto-indexed — just pick from dropdowns. Connect Get Actor Slot ID to Item Slot pin to override.",
    inputs:[{id:"exec",label:"",type:"exec"},{id:"index",label:"Index",type:"value.number"},{id:"itemSlot",label:"Item Slot",type:"value.any"}],
    outputs:[
      {id:"exec",  label:"Done →", type:"exec"},
      {id:"empty", label:"Empty →",type:"exec"}
    ],
    fields:[
      {key:"_compound", label:"Container → Slot", type:"inv-item-slot", itemKey:"itemName", slotKey:"slotId"},
      {key:"index",     label:"Index (0=first)",  type:"number", default:0}
    ],
    isAction:true, wideNode:true,
    isRemoveFromInvSlot: true,
    toAction:(n,inp)=>({
      type:     "removeFromInvItemSlot",
      itemName: n.data.itemName ?? "",
      uuid:     n.data.uuid     ?? "",
      slotId:   inp.itemSlot    ?? n.data.slotId ?? "slot1",
      index:    inp.index       ?? n.data.index ?? 0
    })
  },

  act_add_to_inv_item_slot: {
    title:"Add to Inv Item Slot", color:"#2a4a2a", cat:"Items",
    desc:"Find a container item and add another inventory item into its slot. Pick container from dropdown, drag item to add from sidebar.",
    inputs:[{id:"exec",label:"",type:"exec"},{id:"itemSlot",label:"Item Slot",type:"value.any"}],
    outputs:[{id:"exec",label:"Done →",type:"exec"},{id:"full",label:"Full →",type:"exec"}],
    fields:[
      {key:"_compound",  label:"Container → Slot", type:"inv-item-slot", itemKey:"parentName", slotKey:"slotId"},
      {key:"itemUuid",   label:"Item to add",       type:"item-uuid-drag", default:""}
    ],
    isAction:true, wideNode:true,
    isAddToInvSlot: true,
    toAction:(n,inp)=>({
      type:       "addToInvItemSlot",
      parentName: n.data.parentName ?? "",
      parentUuid: n.data.parentUuid ?? "",
      slotId:     inp.itemSlot      ?? n.data.slotId     ?? "slot1",
      itemName:   n.data.itemName   ?? "",
      itemUuid:   n.data.itemUuid   ?? ""
    })
  },
  act_attack_check: {
    title:"Attack Check", color:"#8a3a00", cat:"Roll",
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
    title:"Roll Check", color:"#8a4400", cat:"Roll",
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
      {key:"chatTimeout",    label:"Chat timeout (sec, 0=∞)", type:"number", default:0},
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
    title:"Tiered Roll", color:"#8a4400", cat:"Roll",
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
    title:"Dice Pool", color:"#8a4400", cat:"Roll",
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
    title:"Get Token Count", color:"#1a4060", cat:"Sources",
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
    title:"Progression Roll", color:"#8a4400", cat:"Roll",
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
    title:"Throw on Canvas", color:"#8a4400", cat:"Roll",
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
    title:"Throw on Sheet", color:"#8a4400", cat:"Roll",
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
      {key:"url",          label:"URL",            type:"text",   default:"https://api.openai.com/v1/chat/completions",
        placeholder:"https://api.openai.com/v1/chat/completions"},
      {key:"apiKey",       label:"API Key",        type:"text",   default:"",
        placeholder:"sk-... (leave empty if using API key setting)"},
      {key:"apiKeySetting",label:"API key setting (world)", type:"text", default:"",
        placeholder:"e.g. openaiKey  → reads game.settings.get('sd', '<this>')"},
      {key:"model",        label:"Model",          type:"text",   default:"gpt-4o-mini",
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
      url:          inp.url          ?? n.data.url          ?? "https://api.openai.com/v1/chat/completions",
      apiKey:       inp.apiKey       ?? n.data.apiKey       ?? "",
      apiKeySetting: n.data.apiKeySetting ?? "",
      model:        inp.model        ?? n.data.model        ?? "gpt-4o-mini",
      systemPrompt: inp.systemPrompt ?? n.data.systemPrompt ?? "",
      prompt:       inp.prompt       ?? n.data.prompt       ?? "",
      temperature:  (inp.temperature != null && inp.temperature !== "") ? Number(inp.temperature) : Number(n.data.temperature ?? 0.7),
      maxTokens:    (inp.maxTokens   != null && inp.maxTokens   !== "") ? Number(inp.maxTokens)   : Number(n.data.maxTokens   ?? 512),
      flavor:       n.data.flavor ?? "AI",
      toChat:       n.data.toChat === "yes"
    })
  },

  switch_node: {
    title:"Switch", color:"#8a2a8a", cat:"Flow",
    desc:"Compare Value against each Case label and jump to the matching exec output. Falls through to Default if no match.",
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
      {key:"case2", label:"Case 2 value", type:"text", default:"2"}
    ],
    isSwitch: true,
    toAction:(n,inp)=>({
      type:   "switchExec",
      value:  inp.value ?? 0,
      cases:  [n.data.case0??"0", n.data.case1??"1", n.data.case2??"2"]
    })
  },

  dialog_switch: {
    title:"Dialog Switch (legacy)", color:"#c05a20", cat:"Flow",
    desc:"Show a dialog with 2-8 named options. The player picks one and that exec branch fires. Outputs are named via fields.",
    wideNode:true,
    inputs:[{id:"exec", label:"", type:"exec"}],
    outputs:[
      {id:"out0",label:"Option 1",type:"exec"},
      {id:"out1",label:"Option 2",type:"exec"},
      {id:"out2",label:"Option 3",type:"exec"},
      {id:"out3",label:"Option 4",type:"exec"},
      {id:"out4",label:"Option 5",type:"exec"},
      {id:"out5",label:"Option 6",type:"exec"},
      {id:"out6",label:"Option 7",type:"exec"},
      {id:"out7",label:"Option 8",type:"exec"}
    ],
    fields:[
      {key:"count",  label:"Number of options (2-8)", type:"number", default:2},
      {key:"title",  label:"Dialog title",            type:"text",   default:"Choose"},
      {key:"desc",   label:"Description (optional)",  type:"text",   default:""},
      {key:"label0", label:"Option 1 label",          type:"text",   default:"Option 1"},
      {key:"label1", label:"Option 2 label",          type:"text",   default:"Option 2"},
      {key:"label2", label:"Option 3 label",          type:"text",   default:"Option 3"},
      {key:"label3", label:"Option 4 label",          type:"text",   default:"Option 4"},
      {key:"label4", label:"Option 5 label",          type:"text",   default:"Option 5"},
      {key:"label5", label:"Option 6 label",          type:"text",   default:"Option 6"},
      {key:"label6", label:"Option 7 label",          type:"text",   default:"Option 7"},
      {key:"label7", label:"Option 8 label",          type:"text",   default:"Option 8"}
    ],
    isDialogSwitch: true,
    activeOutputCount: (n) => Math.max(2, Math.min(8, parseInt(n.data?.count) || 2)),
    toAction:(n, inp, compiler) => {
      const count = Math.max(2, Math.min(8, parseInt(n.data?.count) || 2));
      const outputs = [];
      for (let i = 0; i < count; i++) {
        outputs.push({
          label:   n.data[`label${i}`] ?? `Option ${i+1}`,
          actions: compiler ? compiler.compileExecPin(n, `out${i}`) : []
        });
      }
      return {
        type:        "dialogSwitch",
        title:       n.data.title ?? "Choose",
        description: n.data.desc  ?? "",
        outputs
      };
    }
  },

  dialog_select_array: {
    title:"Dialog Select Array (legacy)", color:"#c05a20", cat:"Flow",
    desc:"Show a dialog with one button per element of the input array. The chosen element is emitted on `Selected` (value), the index on `Index`, and Selected→ exec fires after pick. Cancel → Cancel exec.",
    inputs:[
      {id:"exec",  label:"",      type:"exec"},
      {id:"items", label:"Items", type:"value.array"}
    ],
    outputs:[
      {id:"sel",      label:"Selected →", type:"exec"},
      {id:"cancel",   label:"Cancel",     type:"exec"},
      {id:"selected", label:"Selected",   type:"value.any"},
      {id:"index",    label:"Index",      type:"value.number"}
    ],
    fields:[
      {key:"title",     label:"Dialog title",                 type:"text", default:"Choose"},
      {key:"desc",      label:"Description (optional)",       type:"text", default:""},
      {key:"labelPath", label:"Label path (e.g. name)",       type:"text", default:"name"}
    ],
    isGenericBranch: true,
    toAction:(n, inp) => ({
      type:        "dialogSelectArray",
      title:       n.data.title ?? "Choose",
      description: n.data.desc  ?? "",
      labelPath:   n.data.labelPath ?? "name",
      items:       inp.items ?? ""
    })
  },

  dialog_text_input: {
    title:"Dialog Text Input (legacy)", color:"#c05a20", cat:"Flow",
    desc:"Show a single-line text input dialog. The entered text is emitted on `Text` and OK exec fires.",
    inputs:[{id:"exec", label:"", type:"exec"}],
    outputs:[
      {id:"ok",     label:"OK →",   type:"exec"},
      {id:"cancel", label:"Cancel", type:"exec"},
      {id:"text",   label:"Text",   type:"value.string"}
    ],
    fields:[
      {key:"title",   label:"Dialog title", type:"text", default:"Enter text"},
      {key:"desc",    label:"Description",  type:"text", default:""},
      {key:"default", label:"Default value", type:"text", default:""}
    ],
    isGenericBranch: true,
    toAction:(n) => ({
      type:        "dialogTextInput",
      title:       n.data.title   ?? "Enter text",
      description: n.data.desc    ?? "",
      default:     n.data.default ?? ""
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
      title:"Dialog Builder", color:"#a04020", cat:"Flow", wideNode:true,
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
            o.type = "rollButton";
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

  dialog_confirm: {
    title:"Dialog Confirm (legacy)", color:"#c05a20", cat:"Flow",
    desc:"Show a Yes/No confirmation dialog. The matching exec branch fires.",
    inputs:[{id:"exec", label:"", type:"exec"}],
    outputs:[
      {id:"yes", label:"Yes →", type:"exec"},
      {id:"no",  label:"No →",  type:"exec"}
    ],
    fields:[
      {key:"title",   label:"Dialog title", type:"text", default:"Confirm"},
      {key:"message", label:"Message",      type:"text", default:"Are you sure?"},
      {key:"yesLabel",label:"Yes label",    type:"text", default:"Yes"},
      {key:"noLabel", label:"No label",     type:"text", default:"No"}
    ],
    isGenericBranch: true,
    toAction:(n) => ({
      type:        "dialogConfirm",
      title:       n.data.title    ?? "Confirm",
      message:     n.data.message  ?? "",
      yesLabel:    n.data.yesLabel ?? "Yes",
      noLabel:     n.data.noLabel  ?? "No"
    })
  },

  while_loop: {
    title:"While Loop", color:"#1a5a7a", cat:"Flow",
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
    compile:(_,i,n)=>{
      return `(hasEffect(${JSON.stringify(i.name ?? n?.data?.name ?? "")},${JSON.stringify(i.target ?? n?.data?.target ?? "self")}))`;
    }
  },

  act_place_aura: {
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
      {key:"rounds",            label:"Lifetime (rounds, 0=∞)", type:"number", default:0},
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
      {key:"rounds",           label:"Lifetime (rounds, 0=∞)", type:"number", default:0},
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
      {key:"rounds",          label:"Lifetime (rounds, 0=∞)", type:"number", default:0},
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
      {key:"rounds",            label:"Lifetime (rounds, 0=∞)", type:"number", default:0},
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
      {key:"rounds",           label:"Lifetime (rounds, 0=∞)", type:"number", default:0},
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
      {key:"rounds",           label:"Lifetime (rounds, 0=∞)", type:"number", default:0},
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
    title:"Chat AoE — With Effect", color:"#1a4a8a", cat:"AoE", wideNode:true,
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
      {key:"rounds",            label:"Lifetime (rounds, 0=∞)", type:"number", default:0},
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
    title:"Chat AoE — Damage", color:"#7a3a1a", cat:"AoE", wideNode:true,
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
      {key:"rounds",     label:"Lifetime (rounds, 0=∞)", type:"number", default:0}
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
    title:"Chat AoE — Heal", color:"#1a6a3a", cat:"AoE", wideNode:true,
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
      {key:"rounds",     label:"Lifetime (rounds, 0=∞)", type:"number", default:0}
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
    title:"Chat AoE — Save → Effect", color:"#6a2a8a", cat:"AoE", wideNode:true,
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
      {key:"rounds",            label:"Lifetime (rounds, 0=∞)", type:"number", default:0}
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
    title:"Chat AoE — Targets", color:"#8a7a2a", cat:"AoE", wideNode:true,
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
    title:"Chat AoE — Save", color:"#8a5a2a", cat:"AoE", wideNode:true,
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
    title:"Gate", color:"#5a2a8a", cat:"Flow",
    desc:"Exec passes through only when Condition is truthy. Acts as an early-exit guard without needing a Branch.",
    inputs:[
      {id:"exec",label:"",type:"exec"},
      {id:"cond",label:"Condition",type:"value.bool"}
    ],
    outputs:[{id:"exec",label:"Pass →",type:"exec"}],
    fields:[],
    isAction:true,
    toAction:(n,inp)=>({type:"gate", condition: inp.cond ?? 0})
  },

  reroute: {
    title:"•", color:"#2a2a3a", cat:"Flow",
    desc:"Visual wire re-routing point. No logic — just keeps graphs tidy.",
    inputs:[{id:"v",label:"",type:"value.any"}],
    outputs:[{id:"v",label:"",type:"value.any"}],
    fields:[],
    isReroute: true,
    compile:(_,i)=> i.v !== undefined ? String(i.v) : "0"
  },

  ternary: {
    title:"Ternary", color:"#6a1a6a", cat:"Sources",
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
    compile:(_,i,n)=>{
      const c = i.cond ?? "0";
      const a = i.a    ?? n?.data?.a ?? "1";
      const b = i.b    ?? n?.data?.b ?? "0";
      return `(${c}?${a}:${b})`;
    }
  },

  random_num: {
    title:"Random", color:"#2a4a6a", cat:"Sources",
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
    compile:(_,i,n)=>{
      const lo = i.min ?? n?.data?.min ?? 1;
      const hi = i.max ?? n?.data?.max ?? 6;
      return `floor(random*(${hi}-${lo}+1)+${lo})`;
    }
  },

  get_var: {
    title:"Get Variable", color:"#2a3a5a", cat:"Sources",
    desc:"Read a named variable stored on this actor (actor.flags.sd.vars.NAME). Use with Set Variable to pass data between button clicks or graph segments.",
    inputs:[], outputs:[{id:"v", label:"Value", type:"value.any"}],
    fields:[{key:"name", label:"Variable Name", type:"text", default:"myVar", placeholder:"e.g. lastRollResult"}],
    compile:(n)=>`{var:${n.data.name??"myVar"}}`
  },

  mod: {
    title:"Mod %", color:"#1a5c2a", cat:"Math",
    inputs:[{id:"a",label:"A",type:"value.number"},{id:"b",label:"B",type:"value.number"}], outputs:[{id:"v",label:"",type:"value.number"}],
    fields:[_ROUND_FIELD], desc:"Integer remainder of A ÷ B",
    compile:(n,i)=>_round(`(${i.a??"0"}%${i.b??"1"})`, n.data)
  },

  pow: {
    title:"Pow ^", color:"#1a5c2a", cat:"Math",
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
      {key:"volume", label:"Volume (0–1)",      type:"number", default:0.8},
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

  act_consume_resource: {
    title:"Consume Resource", color:"#6a2a6a", cat:"Resources",
    desc:"Decrement a resource value by Amount (default 1). If current value would go below 0 takes the Empty branch instead. Path can be fed dynamically (UE-style — when wired, the field hides). Use instead of Modify Field + Branch for uses/charges/mana.",
    inputs:[
      {id:"exec",   label:"",       type:"exec"},
      {id:"amount", label:"Amount", type:"value.number"},
      {id:"target", label:"Target", type:"value.actor"},
      {id:"path",   label:"Path",   type:"value.path"}
    ],
    outputs:[
      {id:"ok",    label:"OK →",    type:"exec"},
      {id:"empty", label:"Empty →", type:"exec"}
    ],
    fields:[
      {key:"path",   label:"Resource value path", type:"path",   default:"system.resources.mp.value"},
      {key:"amount", label:"Default amount",       type:"number", default:1},
      {key:"target", label:"On",                   type:"select", default:"self", options:["self","actor","token_target"]}
    ],
    isConsumeResource: true,
    toAction:(n,inp)=>({
      type:   "consumeResource",
      path:   (inp.path != null && inp.path !== "") ? String(inp.path) : (n.data.path ?? "system.resources.mp.value"),
      amount: inp.amount    ?? n.data.amount ?? 1,
      target: (inp.target!=null && inp.target!=="" && inp.target!=="0") ? inp.target : (n.data.target ?? "self")
    })
  },

  act_set_var: {
    title:"Set Variable", color:"#2a3a6a", cat:"Field Ops",
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
    title:"Roll Table", color:"#7a4500", cat:"Tables",
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
    title:"Save / Check Button", color:"#7a3a00", cat:"Roll",
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
      {key:"timeout",       label:"Timeout (sec, 0=∞)", type:"number", default:0},
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

  on_event: {
    title:"On Event", color:"#c04040", cat:"Events", wideNode:true,
    desc:"Declarative event trigger: pick the event type from the dropdown. Equivalent to the specific On-* nodes but keeps the graph compact when you only need a single exec chain.",
    inputs:[], outputs:[
      {id:"exec", label:"→ Fire", type:"exec"}
    ],
    fields:[
      {key:"event", label:"Event", type:"select", default:"update",
       options:["create","update","delete","turnStart","turnEnd","damageTaken","rest","equip","unequip","effectApply"]},
      {key:"pathFilter", label:"Only path (update only)", type:"path", default:"", placeholder:"system.resources.hp.value"},
      {key:"nameFilter", label:"Only name (effect only)", type:"text", default:""}
    ],
    isEvent:true,
    eventHook:"updateDocument"
  },

  get_self: {
    title:"Get Self", color:"#2a5a7a", cat:"Targeting",
    desc:"Reference to the document the graph runs on (actor for sheet graphs, item for item graphs).",
    inputs:[], outputs:[{id:"v", label:"Self", type:"value.actor"}],
    fields:[],
    compile:()=>`"self"`
  },
  get_actor: {
    title:"Get Actor", color:"#2a5a7a", cat:"Targeting",
    desc:"Reference to one or more actors. If a UUID is filled in, it takes priority and the Mode dropdown is ignored. Otherwise the Mode resolves at runtime: self/actor (the graph's owner), targeted/selected token, all targets (array), or the user's character.",
    inputs:[], outputs:[{id:"v", label:"Actor(s)", type:"value.actor"}],
    fields:[
      {key:"uuid", label:"UUID", type:"text", default:"",
        placeholder:"Actor.abc123 (priority — Mode is ignored when filled)"},
      {key:"mode", label:"Mode", type:"select", default:"actor", options:[
        {value:"actor",          label:"Self / context actor"},
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
    desc:"First targeted token's actor. Use Get All Targets for multi-target workflows.",
    inputs:[], outputs:[{id:"v", label:"Target", type:"value.token"}],
    fields:[],
    compile:()=>`"token_target"`
  },
  get_selected_token: {
    title:"Get Selected Token", color:"#2a5a7a", cat:"Targeting",
    desc:"First currently-selected token on the canvas. Falls back to self if none selected.",
    inputs:[], outputs:[{id:"v", label:"Token", type:"value.token"}],
    fields:[],
    compile:()=>`"selected_token"`
  },
  get_all_targets: {
    title:"Get All Targets", color:"#2a5a7a", cat:"Targeting",
    desc:"All currently targeted tokens as an array. Feed into For Each Target, AoE save branches, etc.",
    inputs:[], outputs:[{id:"v", label:"Targets", type:"value.array"}],
    fields:[],
    compile:()=>`"all_targets"`
  },

  get_player_actors: {
    title:"Get Player Actors", color:"#2a5a7a", cat:"Targeting",
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
    desc:"Returns the actor assigned to the current user (game.user.character). Empty if the user has no assigned character.",
    inputs:[], outputs:[{id:"v", label:"Actor", type:"value.actor"}],
    fields:[],
    compile:()=>`"user_character"`
  },

  equipped_count: {
    title:"Equipped Count", color:"#2e6e4a", cat:"Sources",
    desc:"Returns the count of items with `system.equipped:true` on the owning actor, optionally filtered by category. Type a free-form category string (matches `system.category` on the item, Cyrillic / Latin / any text). Leave empty or `any` to count all equipped items.",
    inputs:[], outputs:[{id:"value", label:"N", type:"value.any"}],
    fields:[
      {key:"category", label:"Category", type:"text", default:"",
        placeholder:"any (or item category, e.g. weapon / оружие / магия)"}
    ],
    isPure:true,
    compile:(n)=>{
      const cat = String(n.data.category ?? "").trim();
      return `{__sdEqCount:${cat}}`;
    }
  },

  act_delay: {
    title:"Delay", color:"#2a5a8a", cat:"Flow",
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

  act_loop: {
    title:"For Loop", color:"#2a5a8a", cat:"Flow",
    desc:"Runs Body N times. Current iteration index is available as {__loopIndex}. After all iterations, exec goes to Done.",
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
    title:"Wait For Event", color:"#2a5a8a", cat:"Flow",
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
    title:"Random Pick", color:"#2a4a6a", cat:"Sources",
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
    title:"Resource Tier", color:"#2a4a6a", cat:"Sources",
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
    title:"Get Combat State", color:"#2a4a6a", cat:"Sources",
    desc:"Value outputs about the current encounter: is combat active (0/1), current round, active combatant index.",
    inputs:[],
    outputs:[
      {id:"active",      label:"Active?",       type:"value.bool"},
      {id:"round",       label:"Round",         type:"value.number"},
      {id:"turn",        label:"Turn index",    type:"value.number"}
    ],
    fields:[],
    compile:(_, _i, _n, outPin)=>{
      if (outPin === "active") return `({combat:active})`;
      if (outPin === "round")  return `({combat:round})`;
      if (outPin === "turn")   return `({combat:turn})`;
      return "0";
    }
  },

  var_read: {
    title:"Read Variable", color:"#2a6a9a", cat:"Variables",
    desc:"Reads a variable by scope. Local — within a single press. Actor — on the actor (persists). World — in system settings.",
    inputs:[],
    outputs:[{id:"v", label:"Value", type:"value.any"}],
    fields:[
      {key:"scope",   label:"Scope",   type:"select", default:"local", options:["local","actor","world"]},
      {key:"name",    label:"Name",    type:"text",   default:"myVar"},
      {key:"default", label:"Default", type:"text",   default:"0"}
    ],
    compile:(n)=>{
      const s = n.data.scope ?? "local";
      const nm = n.data.name ?? "myVar";
      const d = n.data.default ?? "0";
      if (s === "actor") return `{var:${nm}}`;
      if (s === "world") return `{wvar:${nm}|${d}}`;
      return `{__var:${nm}|${d}}`;
    }
  },

  var_write: {
    title:"Write Variable", color:"#2a6a9a", cat:"Variables",
    desc:"Writes a variable by scope. Local lasts until the end of the current graph pass. Actor is stored in actor.flags.sd.vars. World goes into game.settings.",
    inputs:[
      {id:"exec",  label:"",      type:"exec"},
      {id:"value", label:"Value", type:"value.any"}
    ],
    outputs:[{id:"exec", label:"→", type:"exec"}],
    fields:[
      {key:"scope", label:"Scope", type:"select", default:"local", options:["local","actor","world"]},
      {key:"name",  label:"Name",  type:"text",   default:"myVar"}
    ],
    isAction:true,
    toAction:(n,inp)=>({
      type:  "setVar",
      name:  n.data.name  ?? "myVar",
      value: inp.value    ?? "0",
      scope: n.data.scope ?? "local"
    })
  },

  var_get: {
    title:"Get Variable", color:"#2a6a9a", cat:"Sources",
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
      value: inp.value ?? "0"
    })
  },

  cast_to_actor: {
    title:"Cast to Actor", color:"#6a2a6a", cat:"Flow",
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
    title:"Cast to Item", color:"#6a2a6a", cat:"Flow",
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
    title:"Show Journal", color:"#3a5a8a", cat:"Journal",
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
    title:"Show Journal Page", color:"#3a5a8a", cat:"Journal",
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
    title:"Reset Roll Table", color:"#7a4500", cat:"Tables",
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
    title:"Show Roll Table", color:"#7a4500", cat:"Tables",
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
      {key:"questIdFilter", label:"Only quest id (optional, blank = any)", type:"text", default:""}
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
      {key:"questIdFilter", label:"Only quest id (optional)", type:"text", default:""}
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
      {key:"questIdFilter", label:"Only quest id (optional)", type:"text", default:""}
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
      {key:"questIdFilter",   label:"Only quest id (optional)",   type:"text", default:""},
      {key:"subtaskIdFilter", label:"Only subtask id (optional)", type:"text", default:""}
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


  quest_activate: {
    title:"Activate Quest", color:"#3a8a60", cat:"Quest", wideNode:true,
    desc:"Set status of a quest to 'active'. If 'Set on actor' is wired or filled, also writes actor.system.activeQuest.",
    inputs:[
      {id:"exec",     label:"",          type:"exec"},
      {id:"questId",  label:"Quest Id",   type:"value.string"},
      {id:"actorRef", label:"Actor (id/uuid/this/triggering)", type:"value.string"}
    ],
    outputs:[{id:"exec", label:"→",       type:"exec"}],
    fields:[
      {key:"questId",  label:"Quest Id (default — this quest's id, or filter)", type:"text", default:"this"},
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
    desc:"Set status of a quest to 'completed' and fire sdQuestCompleted hook.",
    inputs:[
      {id:"exec",    label:"",         type:"exec"},
      {id:"questId", label:"Quest Id", type:"value.string"}
    ],
    outputs:[{id:"exec", label:"→", type:"exec"}],
    fields:[
      {key:"questId", label:"Quest Id (default 'this')", type:"text", default:"this"}
    ],
    toAction:(n,inp)=>({
      type:"questAction", op:"complete",
      questLogUuid:"this",
      questId: String(inp.questId ?? n.data.questId ?? "this")
    })
  },

  quest_fail: {
    title:"Fail Quest", color:"#a04050", cat:"Quest",
    desc:"Set status of a quest to 'failed' and fire sdQuestFailed.",
    inputs:[
      {id:"exec",    label:"",         type:"exec"},
      {id:"questId", label:"Quest Id", type:"value.string"}
    ],
    outputs:[{id:"exec", label:"→", type:"exec"}],
    fields:[
      {key:"questId", label:"Quest Id (default 'this')", type:"text", default:"this"}
    ],
    toAction:(n,inp)=>({
      type:"questAction", op:"fail",
      questLogUuid:"this",
      questId: String(inp.questId ?? n.data.questId ?? "this")
    })
  },

  quest_lock: {
    title:"Lock Quest", color:"#7a7a8a", cat:"Quest",
    desc:"Set status of a quest to 'locked' (hidden from players regardless of visibility).",
    inputs:[
      {id:"exec",    label:"",         type:"exec"},
      {id:"questId", label:"Quest Id", type:"value.string"}
    ],
    outputs:[{id:"exec", label:"→", type:"exec"}],
    fields:[
      {key:"questId", label:"Quest Id (default 'this')", type:"text", default:"this"}
    ],
    toAction:(n,inp)=>({
      type:"questAction", op:"lock",
      questLogUuid:"this",
      questId: String(inp.questId ?? n.data.questId ?? "this")
    })
  },

  quest_make_available: {
    title:"Make Quest Available", color:"#5a8ad8", cat:"Quest",
    desc:"Set status of a quest to 'available' (unlocked for activation).",
    inputs:[
      {id:"exec",    label:"",         type:"exec"},
      {id:"questId", label:"Quest Id", type:"value.string"}
    ],
    outputs:[{id:"exec", label:"→", type:"exec"}],
    fields:[
      {key:"questId", label:"Quest Id (default 'this')", type:"text", default:"this"}
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
      {key:"questId",   label:"Quest Id (default 'this')",   type:"text", default:"this"},
      {key:"subtaskId", label:"Subtask Id",                  type:"text", default:""},
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
      {key:"questId", label:"Quest Id (default 'this')", type:"text", default:"this"},
      {key:"userId",  label:"User Id ('this'=triggering, blank=all)", type:"text", default:""}
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
      {key:"questId", label:"Quest Id (default 'this')", type:"text", default:"this"},
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
      {key:"questId",  label:"Quest Id (default 'this')",  type:"text", default:"this"},
      {key:"rewardId", label:"Reward Id (required)",       type:"text", default:""},
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
      {key:"questId",  label:"Quest Id (default 'this')",  type:"text", default:"this"},
      {key:"rewardId", label:"Reward Id (required)",       type:"text", default:""},
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
      {key:"questId",  label:"Quest Id (default 'this')", type:"text", default:"this"},
      {key:"rewardId", label:"Reward Id (required)",      type:"text", default:""}
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
      {key:"questId", label:"Quest Id (default 'this')", type:"text", default:"this"}
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
      {key:"questId", label:"Quest Id (default 'this')", type:"text", default:"this"}
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
      {key:"questId",   label:"Quest Id (default 'this')", type:"text", default:"this"},
      {key:"subtaskId", label:"Subtask Id (default 'this')", type:"text", default:"this"}
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

};

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

const EVENT_PIN_TOKENS = {
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
  on_quest_revealed:  { questId: "{__questId}", revealed: "{__questRevealed}" }
};

const _ROLL_META_BASIC = {
  formula:       "{__lastFormula}",
  min:           "{__lastMin}",
  max:           "{__lastMax}",
  avg:           "{__lastAvg}",
  diceArray:     "{__lastDice}"
};
const _ROLL_META = {
  ..._ROLL_META_BASIC,
  natural:       "{__lastNatural}",

  isCrit:        "{__lastIsCrit}",
  isFumble:      "{__lastIsFumble}"
};
const BRANCH_PIN_TOKENS = {
  act_roll_value:   { result: "{__lastRoll}", ..._ROLL_META_BASIC },
  act_attack_check: { result: "{__lastRoll}", margin: "{__lastMargin}", ..._ROLL_META },
  act_roll_check:   { result: "{__lastRoll}", margin: "{__lastMargin}", winnerRoll: "{__opposedWinnerRoll}", ..._ROLL_META },
  act_tiered_roll:  { result: "{__lastRoll}", ..._ROLL_META },
  act_dice_pool:    { successes: "{__lastSuccesses}", botches: "{__lastBotches}", result: "{__lastRoll}", ..._ROLL_META },
  act_throw_on_canvas: { successes: "{__lastSuccesses}", total: "{__lastRoll}", ..._ROLL_META },
  act_throw_on_sheet:  { successes: "{__lastSuccesses}", total: "{__lastRoll}", ..._ROLL_META },
  chat_save_button:    { result: "{__lastRoll}", ..._ROLL_META },
  act_progression:     { value: "{__lastRoll}", previous: "{__progPrev}", ..._ROLL_META },
  act_dialog_builder:  { picked: "{__dlgPicked}" },
  act_ai_request:      { response: "{__lastAiResponse}", errorMsg: "{__lastAiError}" },
  act_loop:            { index: "{__loopIndex}" },
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
  arr_compare_two: {
    diff:   "{__cmpDiff}",
    winner: "{__cmpWinner}"
  },
  dialog_select_array: {
    selected: "{__sdSelectedItem}",
    index:    "{__sdSelectedIndex}"
  },
  dialog_text_input: {
    text: "{__sdInputText}"
  },
  act_card_draw: {
    card:  "{__lastDrawnCard}",
    cards: "{__lastDrawnCards}"
  }
};

const CATS = [
  {id:"Flow",       color:"#8a3a8a"},
  {id:"Events",     color:"#c04040"},
  {id:"Quest",      color:"#a04060"},
  {id:"Attribute",  color:"#7a4a1a"},
  {id:"Sources",    color:"#2a6a9a"},
  {id:"Dice",       color:"#9a6a1a"},
  {id:"Math",       color:"#2a7a3a"},
  {id:"Compare",    color:"#8a2a8a"},
  {id:"Logic",      color:"#8a2a2a"},
  {id:"Array",      color:"#2a7a3a"},
  {id:"Variables",  color:"#2a6a9a"},
  {id:"Macros",     color:"#1a8a4a"},

  {id:"Roll",       color:"#8a4400"},
  {id:"Damage",     color:"#8a1a1a"},
  {id:"Effects",    color:"#1a4a8a"},
  {id:"Resources",  color:"#5a2a6a"},
  {id:"Field Ops",  color:"#4a2a6a"},
  {id:"Items",      color:"#2a5a3a"},
  {id:"Chat",       color:"#4a4a1a"},
  {id:"Tables",     color:"#7a4500"},
  {id:"AI",         color:"#4a4a8a"},
  {id:"System",     color:"#4a2a7a"},
  {id:"AoE",        color:"#7a3a8a"},
  {id:"Targeting",  color:"#8a3a6a"},
  {id:"Journal",    color:"#3a5a8a"},
  {id:"Cards",      color:"#5a2a7a"}
];

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
  { id:"self",            label:"Self (this document)" },
  { id:"actor",            label:"Owning actor" },
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
    outputs:[], fields:[{key:"label",label:"Label",type:"text",default:"Value"},{key:"path",label:"Data Path",type:"path",default:"system.flags.myNumber"},{key:"min",label:"Min",type:"number",default:0},{key:"max",label:"Max",type:"number",default:100},{key:"step",label:"Step",type:"number",default:1}]
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
    outputs:[], fields:[{key:"label",label:"Label",type:"text",default:"Slot"},{key:"slotId",label:"Slot ID",type:"text",default:""},{key:"maxCount",label:"Max Items",type:"number",default:1},{key:"allowedTypes",label:"Allowed Types",type:"text",default:""},{key:"allowedCategories",label:"Allowed Categories",type:"text",default:""}]
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
  wcfg_rollButton:{ title:"Roll Button",      color:"#1a3a1a", isWidgetConfig:true, widgetType:"rollButton",
    inputs:[_mkPin("label","Label"),_mkPin("formula","Formula"),_mkPin("flavor","Flavor"),_mkPin("icon","Icon"),_mkPin("color","Color")],
    outputs:[], fields:[
      {key:"label",  label:"Label",type:"text",default:"Roll"},
      {key:"formula",label:"Formula",type:"text",default:"1d20"},
      {key:"flavor", label:"Flavor text (chat)",type:"text",default:""},
      {key:"icon",   label:"FA Icon",type:"text",default:"fa-dice-d20"},
      {key:"color",  label:"Accent colour",type:"text",default:"#5a9ae0"}
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
      {key:"color",   label:"Accent colour",type:"text",default:"#7ef0c3"},
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
    this.chainTrigger = opts.mode === "chainTrigger";
    this.questTrigger = opts.mode === "questTrigger";
    this.initiativeMode = opts.mode === "initiative";
    this.customLoad   = typeof opts.customLoad === "function" ? opts.customLoad : null;
    this.customSave   = typeof opts.customSave === "function" ? opts.customSave : null;
    this.win          = null;
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
    this._loadGraph();
    this._pushHistory();
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

  _serialiseSubgraph(nodeIds) {
    const ids = new Set(nodeIds);
    const nodes = this.nodes
      .filter(n => ids.has(n.id))
      .map(n => ({ id: n.id, type: n.type, x: n.x, y: n.y, data: foundry.utils.deepClone(n.data ?? {}) }));
    if (!nodes.length) return null;
    const minX = Math.min(...nodes.map(n => n.x));
    const minY = Math.min(...nodes.map(n => n.y));
    for (const n of nodes) { n.x -= minX; n.y -= minY; }
    const edges = this.edges
      .filter(e => ids.has(e.fromNode) && ids.has(e.toNode))
      .map(e => ({ id: e.id, fromNode: e.fromNode, fromPin: e.fromPin, toNode: e.toNode, toPin: e.toPin }));
    return { nodes, edges };
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
    this._selected.clear();
    for (const n of valid) {
      this._renderNode(n);
      this._selected.add(n.id);
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
    const ids = this._selected.size
      ? Array.from(this._selected)
      : this.nodes.map(n => n.id);
    const tpl = this._serialiseSubgraph(ids);
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
      created: Date.now()
    };
    await this._writeNodeTemplates(store);
    ui.notifications?.info?.(`Template "${name}" saved (${tpl.nodes.length} node${tpl.nodes.length===1?"":"s"}).`);
  }

  _openTemplatesMenu(anchorEl) {
    document.querySelector(".sdgtpl-menu")?.remove();
    const store = this._readNodeTemplates();
    const entries = Object.values(store).sort((a,b)=>(a.name??"").localeCompare(b.name??""));

    const r = anchorEl.getBoundingClientRect();
    const menu = document.createElement("div");
    menu.className = "sdgtpl-menu";
    menu.style.cssText = `position:fixed;left:${Math.round(r.left)}px;top:${Math.round(r.bottom+6)}px;min-width:260px;max-width:380px;max-height:60vh;overflow:auto;background:#121220;border:1px solid #2a2a3e;border-radius:8px;box-shadow:0 12px 40px rgba(0,0,0,.8);z-index:25000;font-family:'Signika',sans-serif;color:var(--sd-text);padding:6px 0`;

    const header = document.createElement("div");
    header.style.cssText = "padding:4px 12px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#74a7ff;border-bottom:1px solid #1a1a28;margin-bottom:4px";
    header.textContent = `Node Templates (${entries.length})`;
    menu.appendChild(header);

    if (!entries.length) {
      const empty = document.createElement("div");
      empty.style.cssText = "padding:12px;font-size:11px;color:var(--sd-text-3);font-style:italic";
      empty.textContent = "No templates yet. Select nodes with Shift and click Save as Tpl.";
      menu.appendChild(empty);
    }

    for (const tpl of entries) {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;align-items:center;gap:8px;padding:6px 12px;cursor:pointer;transition:background .15s";
      row.addEventListener("mouseenter", () => row.style.background = "rgba(116,167,255,.12)");
      row.addEventListener("mouseleave", () => row.style.background = "");

      const main = document.createElement("div");
      main.style.cssText = "flex:1;min-width:0";
      main.innerHTML = `
        <div style="font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(tpl.name)}</div>
        <div style="font-size:9px;color:var(--sd-text-3)">${(tpl.nodes??[]).length} nodes · ${(tpl.edges??[]).length} edges</div>`;
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

      const exp = document.createElement("button");
      exp.type = "button";
      exp.title = "Export this template as JSON";
      exp.style.cssText = "background:transparent;border:1px solid var(--sd-border);border-radius:4px;color:#98a6c6;cursor:pointer;font-size:10px;padding:2px 7px";
      exp.innerHTML = '<i class="fas fa-file-export"></i>';
      exp.addEventListener("click", ev => {
        ev.stopPropagation();
        this._downloadTemplateJSON(tpl, `${tpl.name}.node-template.json`);
      });

      const del = document.createElement("button");
      del.type = "button";
      del.title = "Delete template";
      del.style.cssText = "background:transparent;border:none;color:#a06666;cursor:pointer;font-size:14px;padding:0 4px";
      del.textContent = "×";
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

    document.body.appendChild(menu);

    const off = (ev) => {
      if (!menu.contains(ev.target) && ev.target !== anchorEl) {
        menu.remove();
        document.removeEventListener("mousedown", off, true);
      }
    };
    setTimeout(() => document.addEventListener("mousedown", off, true), 0);
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
          return `<div class="sd-lint-row" ${jumpAttr} style="padding:6px 10px;border-bottom:1px solid rgba(255,255,255,.06);${r.nodeId?"cursor:pointer;":""};">
            <span style="color:${colour};font-weight:700;text-transform:uppercase;font-size:10px;margin-right:6px">[${r.severity}] ${r.code}</span>
            <span style="color:#eef3ff">${esc(r.message)}</span>
            ${r.nodeId ? `<span style="color:#6a7a9a;font-family:monospace;font-size:10px;margin-left:6px">${esc(r.nodeId)}</span>` : ""}
          </div>`;
        }).join("")
      : `<div style="padding:14px;color:#7ef0c3">No issues detected ✓</div>`;

    foundry.applications.api.DialogV2.wait({
      window: { title: `Graph Lint — ${header}` },
      position: { width: 640 },
      modal: true,
      content: `<div style="max-height:60vh;overflow-y:auto;font-size:12px;background:#0d1117;color:#eef3ff;border-radius:6px">${rows}</div>`,
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
    const ids = this._selected.size
      ? Array.from(this._selected)
      : this.nodes.map(n => n.id);
    const tpl = this._serialiseSubgraph(ids);
    if (!tpl || !tpl.nodes.length) {
      ui.notifications?.warn?.("Nothing to export.");
      return;
    }
    const payload = {
      name:    this._selected.size ? `Selection (${tpl.nodes.length})` : `Full graph (${tpl.nodes.length})`,
      nodes:   tpl.nodes,
      edges:   tpl.edges,
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
        store[k] = { name: v.name ?? k, nodes: v.nodes, edges: v.edges ?? [], created: v.created ?? Date.now() };
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
      store[name] = { name, nodes: parsed.nodes, edges: parsed.edges ?? [], created: Date.now() };
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

  _loadGraph() {
    if (this.customLoad) {
      let s = null;
      try { s = this.customLoad(); } catch(e) { console.warn("[sd] formula-graph: customLoad failed", e); }
      if (s && typeof s === "object" && s._graphData?.nodes?.length) s = s._graphData;
      if (s?.nodes?.length) {
        this.nodes    = foundry.utils.deepClone(s.nodes);
        this.edges    = foundry.utils.deepClone(s.edges ?? []);
        this.comments = foundry.utils.deepClone(s.comments ?? []);
        migrateGraph(this);
        if (this.initiativeMode) this._ensureInitiativeNodes();
        const numIds = this.nodes.map(n=>{ const v=parseInt(n.id?.replace(/\D/g,"")??0); return isNaN(v)?0:v; });
        this._id = (Math.max(0,...numIds) + 2) || 2;
      } else if (this.initiativeMode) {
        this._addInitiativeDefaultGraph();
      } else if (!this.chainTrigger && !this.questTrigger) {
        this._addOutputNode();
      }
      return;
    }
    if (this.configMode && this.widget) {
      const s = this.widget.configGraph;
      if (s?.nodes?.length) {
        this.nodes = foundry.utils.deepClone(s.nodes);
        this.edges = foundry.utils.deepClone(s.edges ?? []);
        this.comments = foundry.utils.deepClone(s.comments ?? []);
        migrateGraph(this);
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
        migrateGraph(this);
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
        migrateGraph(this);
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
        migrateGraph(this);
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
      migrateGraph(this);
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
    }
    return null;
  }

  async _saveGraph() {
    if (this.customSave) {
      const graphData = {
        nodes:    this.nodes.map(n=>({id:n.id,type:n.type,x:n.x,y:n.y,data:{...n.data}})),
        edges:    this.edges.map(e=>({id:e.id,fromNode:e.fromNode,fromPin:e.fromPin,toNode:e.toNode,toPin:e.toPin})),
        comments: this.comments.map(c=>({id:c.id,x:c.x,y:c.y,w:c.w,h:c.h,title:c.title,color:c.color}))
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
    if (this.configMode && this.saveCtx) {
      const {tab, row, w, doc} = this.saveCtx;
      const graphData = {
        nodes: this.nodes.map(n=>({id:n.id,type:n.type,x:n.x,y:n.y,data:{...n.data}})),
        edges: this.edges.map(e=>({id:e.id,fromNode:e.fromNode,fromPin:e.fromPin,toNode:e.toNode,toPin:e.toPin})),
        comments: this.comments.map(c=>({id:c.id,x:c.x,y:c.y,w:c.w,h:c.h,title:c.title,color:c.color}))
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
          const e = this.edges.find(e=>e.toNode===cfgNode.id&&e.toPin===pin.id);
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
        comments: this.comments.map(c=>({id:c.id,x:c.x,y:c.y,w:c.w,h:c.h,title:c.title,color:c.color}))
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
            const mvEdge = this.edges.find(e => e.toNode === attrOut.id && e.toPin === "modValue");
            const modSrc = mvEdge ? this.nodes.find(n => n.id === mvEdge.fromNode) : null;
            modValueFormula = modSrc ? this._compileValue(modSrc, new Set(), mvEdge.fromPin) : null;
          }
          const onClickNode = this.nodes.find(n => n.type === "on_click");
          const clickEdge   = onClickNode ? this.edges.find(e => e.fromNode === onClickNode.id && e.fromPin === "exec") : null;
          const onClickFormula = clickEdge ? this._compileExecChain(clickEdge.toNode) : null;
          widget.attrGraphs = (widget.attrGraphs && typeof widget.attrGraphs === "object") ? { ...widget.attrGraphs } : {};
          widget.attrGraphs[attrKey] = { graphData: data, modValueFormula, onClickFormula };
        } else {
          widget.graphData = data;
          if (this.widget?.type === "attribute") {
            const attrOut = this.nodes.find(n => n.type === "attr_output");
            if (attrOut) {
              const mvEdge = this.edges.find(e => e.toNode === attrOut.id && e.toPin === "modValue");
              const modSrc = mvEdge ? this.nodes.find(n => n.id === mvEdge.fromNode) : null;
              widget.modValueFormula = modSrc ? this._compileValue(modSrc, new Set(), mvEdge.fromPin) : null;
            }
            const onClickNode = this.nodes.find(n => n.type === "on_click");
            const clickEdge   = onClickNode ? this.edges.find(e => e.fromNode === onClickNode.id && e.fromPin === "exec") : null;
            widget.onClickFormula = clickEdge ? this._compileExecChain(clickEdge.toNode) : null;
            widget.modFormula = undefined;
            widget.formula    = undefined;
          } else if (this.widget?.type === "skill") {
            const sklOut = this.nodes.find(n => n.type === "skill_output");
            if (sklOut) {
              const mvEdge = this.edges.find(e => e.toNode === sklOut.id && e.toPin === "modValue");
              const modSrc = mvEdge ? this.nodes.find(n => n.id === mvEdge.fromNode) : null;
              widget.modValueFormula = modSrc ? this._compileValue(modSrc, new Set(), mvEdge.fromPin) : null;
            }
            const onClickNode = this.nodes.find(n => n.type === "on_click");
            const clickEdge   = onClickNode ? this.edges.find(e => e.fromNode === onClickNode.id && e.fromPin === "exec") : null;
            widget.onClickFormula = clickEdge ? this._compileExecChain(clickEdge.toNode) : null;
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
        comments: this.comments.map(c=>({id:c.id,x:c.x,y:c.y,w:c.w,h:c.h,title:c.title,color:c.color}))
      };
      const compiled = this.compile();
      await doc.update({"system.onClickGraph": data, "system.onClickFormula": compiled});
      return;
    }
    if (this.sheetTrigger && this.doc) {
      const data = {
        nodes: this.nodes.map(n=>({id:n.id,type:n.type,x:n.x,y:n.y,data:{...n.data}})),
        edges: this.edges.map(e=>({id:e.id,fromNode:e.fromNode,fromPin:e.fromPin,toNode:e.toNode,toPin:e.toPin})),
        comments: this.comments.map(c=>({id:c.id,x:c.x,y:c.y,w:c.w,h:c.h,title:c.title,color:c.color}))
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

  open() { this._smartIndex = this._buildSmartIndex(); this._buildWin(); this._renderAll(); setTimeout(()=>this._fitView(),120); }
  close() { this._cleanup.forEach(fn=>fn()); this.win?.remove(); this.win=null; }

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

  compile() {
    const valOut = this.nodes.find(n=>n.type==="attr_output" || n.type==="skill_output");
    if (valOut) {
      const mvEdge = this.edges.find(e=>e.toNode===valOut.id&&e.toPin==="modValue");
      if (mvEdge) {
        const modSrc = this.nodes.find(n=>n.id===mvEdge.fromNode);
        if (modSrc) return this._compileValue(modSrc, new Set(), mvEdge.fromPin);
      }
      return "0";
    }

    const initOut = this.nodes.find(n=>n.type==="init_output");
    if (initOut) {
      const vEdge = this.edges.find(e=>e.toNode===initOut.id&&e.toPin==="value");
      if (vEdge) {
        const src = this.nodes.find(n=>n.id===vEdge.fromNode);
        return src ? this._compileValue(src, new Set(), vEdge.fromPin) : "0";
      }
      return "0";
    }

    const trigger = this.nodes.find(n=>n.type==="on_click");
    const eventNodes = this.nodes.filter(n => NODE_DEFS[n.type]?.isEvent);
    if (trigger || eventNodes.length) {
      const triggers = {};
      const _chainFor = (entry) => {
        const exitPin = (entry.type === "on_click") ? "exec" : "exec";
        const e = this.edges.find(ed => ed.fromNode === entry.id && ed.fromPin === exitPin);
        if (!e) return null;
        try { return JSON.parse(this._compileExecChain(e.toNode)); }
        catch { return []; }
      };
      if (trigger) {
        const actions = _chainFor(trigger);
        if (actions?.length) triggers.onClick = actions;
      }
      const _dynHook = (ev) => {
        if (ev.type !== "on_event") return NODE_DEFS[ev.type]?.eventHook;
        const EVENT_HOOK_MAP = {
          create:       "createDocument",
          update:       "updateDocument",
          delete:       "deleteDocument",
          turnStart:    "combatTurnStart",
          turnEnd:      "combatTurnEnd",
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
        const key = (ev.type === "on_event") ? `on_event::${ev.id}` : ev.type;
        triggers[key] = { hook: _dynHook(ev), data: ev.data ?? {}, actions };
      }
      const macroInputs = this.nodes.filter(n => NODE_DEFS[n.type]?.isMacroInput);
      const macros = {};
      for (const mi of macroInputs) {
        const mid = mi.data?.macroId?.trim();
        if (!mid) continue;
        const e = this.edges.find(ed => ed.fromNode === mi.id && ed.fromPin === "exec");
        if (!e) { macros[mid] = []; continue; }
        try { macros[mid] = JSON.parse(this._compileExecChain(e.toNode)); }
        catch { macros[mid] = []; }
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
    const vEdge = this.edges.find(e=>e.toNode===out.id&&e.toPin==="value");
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

    if (def?.isEvent) return EVENT_PIN_TOKENS[node.type]?.[fromPin] ?? "0";
    if (def?.isMacroInput) return `{__macroArg:${fromPin ?? "a"}}`;
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
      const e = this.edges.find(e=>e.toNode===node.id&&e.toPin===pin.id);
      if (e) { const s=this.nodes.find(n=>n.id===e.fromNode); if(s) ins[pin.id]=this._compileValue(s,v2,e.fromPin); }
    }
    if (def.dynamicPins) {
      const groups = Array.isArray(def.dynamicPins) ? def.dynamicPins : [def.dynamicPins];
      for (const grp of groups) {
        const {base, max} = grp;
        for (let i=0;i<max;i++) {
          const pinId=`${base}${i}`;
          const e=this.edges.find(e=>e.toNode===node.id&&e.toPin===pinId);
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
      const prevEdge = this.edges.find(e => e.toNode === current && e.toPin === "exec");
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

      if (def.isBranch) {
        const condEdge = this.edges.find(e=>e.toNode===node.id&&e.toPin==="cond");
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
        const valEdge = this.edges.find(e=>e.toNode===node.id&&e.toPin==="value");
        const valNode = valEdge ? this.nodes.find(n=>n.id===valEdge.fromNode) : null;
        const value   = valNode ? this._compileValue(valNode, new Set(), valEdge.fromPin) : (node.data?.value ?? "0");

        const cases = [node.data?.case0 ?? "0", node.data?.case1 ?? "1", node.data?.case2 ?? "2"];
        const act = { type: "switchExec", value, cases };

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

      if (def.isDialogSwitch) {
        const count = Math.max(2, Math.min(8, parseInt(node.data?.count) || 2));
        const act = {
          type:        "dialogSwitch",
          title:       node.data?.title ?? "Choose",
          description: node.data?.desc  ?? "",
          outputs:     []
        };
        for (let i = 0; i < count; i++) {
          const edge   = this.edges.find(e=>e.fromNode===node.id&&e.fromPin===`out${i}`);
          const before = [...actions];
          if (edge) _walk(edge.toNode, new Set(vis));
          const branchActions = actions.splice(before.length);
          act.outputs.push({
            label:   node.data?.[`label${i}`] ?? `Option ${i+1}`,
            actions: branchActions
          });
        }
        actions.push(act);
        return;
      }

      if (def.isLoop) {
        const ins = {};
        for (const pin of (def.inputs ?? [])) {
          if (pin.type === "exec") continue;
          const e = this.edges.find(e=>e.toNode===node.id&&e.toPin===pin.id);
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
          const e = this.edges.find(e=>e.toNode===node.id&&e.toPin===pin.id);
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
          const e = this.edges.find(e=>e.toNode===node.id&&e.toPin===pin.id);
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
          const e = this.edges.find(e=>e.toNode===node.id&&e.toPin===pin.id);
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
          const e = this.edges.find(e=>e.toNode===node.id&&e.toPin===pin.id);
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
        const levelEdge = this.edges.find(e=>e.toNode===node.id&&e.toPin==="level");
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
        const indexEdge = this.edges.find(e=>e.toNode===node.id&&e.toPin==="index");
        const indexNode = indexEdge ? this.nodes.find(n=>n.id===indexEdge.fromNode) : null;
        const indexVal  = indexNode ? this._compileValue(indexNode, new Set(), indexEdge.fromPin) : null;

        const doneEdge  = this.edges.find(e=>e.fromNode===node.id&&e.fromPin==="exec");
        const emptyEdge = this.edges.find(e=>e.fromNode===node.id&&e.fromPin==="empty");

        const act = def.toAction?.(node, indexVal !== null ? {index: indexVal} : {}) ?? {};

        const before = [...actions];
        if (doneEdge)  _walk(doneEdge.toNode,  new Set(vis));
        act.doneActions  = actions.splice(before.length);

        if (emptyEdge) _walk(emptyEdge.toNode, new Set(vis));
        act.emptyActions = actions.splice(before.length);

        actions.push(act);
        return;
      }

      if (def.isAddToInvSlot) {
        const doneEdge  = this.edges.find(e=>e.fromNode===node.id&&e.fromPin==="exec");
        const fullEdge  = this.edges.find(e=>e.fromNode===node.id&&e.fromPin==="full");

        const act = def.toAction?.(node, {}) ?? {};

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
          const e = this.edges.find(e=>e.toNode===node.id&&e.toPin===pin.id);
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
          const e = this.edges.find(e=>e.toNode===node.id&&e.toPin===pin.id);
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
          const e = this.edges.find(e=>e.toNode===node.id&&e.toPin===pin.id);
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
          const e = this.edges.find(e=>e.toNode===node.id&&e.toPin===pin.id);
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
          const e = this.edges.find(e=>e.toNode===node.id&&e.toPin===pin.id);
          if (e) { const s=this.nodes.find(n=>n.id===e.fromNode); if(s) ins[pin.id]=this._compileValue(s,new Set(),e.fromPin); }
        }
        if (def.dynamicPins) {
          const groups = Array.isArray(def.dynamicPins) ? def.dynamicPins : [def.dynamicPins];
          for(const grp of groups) {
            const {base, max} = grp;
            for(let i=0;i<max;i++){
              const pinId=`${base}${i}`;
              const e=this.edges.find(e=>e.toNode===node.id&&e.toPin===pinId);
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
    this.win.querySelector("#gpreview").textContent = f||"—";

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
          liveEl.style.cssText = "padding:3px 8px 4px;border-top:1px solid #1a1a30;font-size:10px;font-family:monospace;color:#5ae07a;word-break:break-all;white-space:pre-wrap;background:#060610;border-radius:0 0 5px 5px";
          outEl.appendChild(liveEl);
        }
        let liveText = f || "—";
        if (this.doc && f && f !== "0") {
          try {
            const resolved = f.replace(/\{([^}]+)\}/g, (_, p) => {
              let v = foundry.utils.getProperty(this.doc, p);
              if (v && typeof v === "object" && "value" in v && typeof v.value !== "object") v = v.value;
              if (v === undefined || v === null) return "0";
              if (typeof v === "object") return "0";
              return String(v);
            });
            liveText = `${f}\n→ ${resolved}`;
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
      badge.textContent   = "✓ Attribute graph — wire modValue (display) + On Click exec chain";
    } else if (hasSkillOut) {
      badge.style.display = "block";
      badge.style.color   = "#60c0e8";
      badge.style.borderColor = "#1a4a7a";
      badge.textContent   = "✓ Skill graph — wire modValue (display) + On Click exec chain";
    } else if (hasOnClick) {
      badge.style.display = "block";
      badge.style.color   = "#5ae07a";
      badge.style.borderColor = "#1a5c2a";
      badge.textContent   = "✓ Exec graph (On Click) — Output node not required";
    } else if (hasOutput) {
      badge.style.display = "block";
      badge.style.color   = "var(--sd-accent)";
      badge.style.borderColor = "#534AB7";
      badge.textContent   = "✓ Formula graph — connect a node to Output";
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
      if (n.type === "var_get") {
        const k = (n.data?.name ?? "").trim() || "(unnamed)";
        const rec = vars.get(k) ?? { nodes: [], hasSet:false, hasGet:false };
        rec.nodes.push(n.id); rec.hasGet = true;
        vars.set(k, rec);
      } else if (n.type === "var_set") {
        const k = (n.data?.name ?? "").trim() || "(unnamed)";
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
      <div style="padding:6px 10px;font-size:9px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#74a7ff;border-bottom:1px solid rgba(116,167,255,.15);background:rgba(116,167,255,.04);display:flex;align-items:center;gap:6px">
        <span style="flex:1">${label}</span>
        <span style="opacity:.55;font-weight:400">${count}</span>
      </div>`;

    const varRows = [...vars.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([name, rec]) => {
      const badges = [];
      if (rec.hasSet) badges.push(`<span title="Set here" style="font-size:8px;background:#e0a02033;color:#e0a020;border-radius:3px;padding:0 4px;font-weight:700">SET</span>`);
      if (rec.hasGet) badges.push(`<span title="Read here" style="font-size:8px;background:#5ae07a33;color:#5ae07a;border-radius:3px;padding:0 4px;font-weight:700">GET</span>`);
      if (!rec.hasSet) badges.push(`<span title="No setter" style="font-size:8px;background:#e0505033;color:#e05050;border-radius:3px;padding:0 4px;font-weight:700">!</span>`);
      return `<div class="gvar-row" data-nid="${esc(rec.nodes[0])}" style="padding:5px 10px;font-family:monospace;font-size:10px;display:flex;align-items:center;gap:5px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,.03);transition:background .1s" onmouseover="this.style.background='rgba(116,167,255,.08)'" onmouseout="this.style.background='transparent'">
        <span style="flex:1;color:#e0e0f0">${esc(name)}</span>
        ${badges.join("")}
      </div>`;
    }).join("");

    const macroRows = [...macros.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([id, rec]) => {
      const badges = [];
      if (rec.hasInput) badges.push(`<span title="Defined here" style="font-size:8px;background:#1a8a4a33;color:#5ae09a;border-radius:3px;padding:0 4px;font-weight:700">DEF</span>`);
      if (rec.hasCall)  badges.push(`<span title="Called here" style="font-size:8px;background:#5a9ae033;color:#74a7ff;border-radius:3px;padding:0 4px;font-weight:700">CALL</span>`);
      if (rec.hasCall && !rec.hasInput) badges.push(`<span title="Missing definition" style="font-size:8px;background:#e0505033;color:#e05050;border-radius:3px;padding:0 4px;font-weight:700">!</span>`);
      return `<div class="gvar-row" data-nid="${esc(rec.nodes[0])}" style="padding:5px 10px;font-family:monospace;font-size:10px;display:flex;align-items:center;gap:5px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,.03);transition:background .1s" onmouseover="this.style.background='rgba(26,138,74,.12)'" onmouseout="this.style.background='transparent'">
        <span style="flex:1;color:#e0e0f0">${esc(id)}</span>
        ${badges.join("")}
      </div>`;
    }).join("");

    panel.innerHTML = `
      ${sectionHeader("Variables", vars.size)}
      ${varRows || `<div style="padding:10px;font-size:10px;color:rgba(255,255,255,.25);font-style:italic">No variables. Use <b>var_set</b> / <b>var_get</b> nodes.</div>`}
      ${sectionHeader("Macros", macros.size)}
      ${macroRows || `<div style="padding:10px;font-size:10px;color:rgba(255,255,255,.25);font-style:italic">No macros. Use <b>macro_input</b> (define) / <b>macro_call</b> (invoke).</div>`}
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
        el.style.boxShadow = "0 0 0 2px #74a7ff, 0 0 24px #74a7ff88";
        setTimeout(() => { el.style.boxShadow = ""; }, 1200);
      });
    });
  }

  _buildWin() {
    this.win?.remove();
    const win = document.createElement("div");
    win.style.cssText=`position:fixed;top:30px;left:50%;transform:translateX(-50%);width:min(1180px,97vw);height:min(720px,93vh);background:#0d1117;border:1px solid rgba(255,255,255,.08);border-radius:12px;box-shadow:0 24px 80px rgba(0,0,0,.95);z-index:20000;display:flex;flex-direction:column;font-family:Inter,'Segoe UI',Arial,sans-serif;color:#eef3ff;overflow:hidden;`;
    win.innerHTML=`
      <div id="gbar" style="display:flex;align-items:center;gap:10px;padding:8px 14px;background:#151a24;border-bottom:1px solid rgba(255,255,255,.07);flex-shrink:0;cursor:move;user-select:none">
        <i class="fas fa-diagram-project" style="color:#74a7ff;font-size:13px"></i>
        <b style="font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:#74a7ff;flex:none">Graph Editor</b>
        <div id="gpreview" style="flex:1;font-size:10px;color:rgba(255,255,255,.18);font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">—</div>
        <button id="gtpl" style="background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);border-radius:8px;color:#98a6c6;cursor:pointer;font-size:11px;padding:6px 10px" title="Insert a saved node template"><i class="fas fa-puzzle-piece" style="margin-right:4px"></i>Templates</button>
        <button id="gtplsave" style="background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);border-radius:8px;color:#98a6c6;cursor:pointer;font-size:11px;padding:6px 10px" title="Save the selected nodes (Shift-click to select) as a reusable template"><i class="fas fa-bookmark" style="margin-right:4px"></i>Save as Tpl</button>
        <button id="gimport" style="background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);border-radius:8px;color:#98a6c6;cursor:pointer;font-size:11px;padding:6px 10px" title="Import template(s) from a JSON file"><i class="fas fa-file-import" style="margin-right:4px"></i>Import</button>
        <button id="gexport" style="background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);border-radius:8px;color:#98a6c6;cursor:pointer;font-size:11px;padding:6px 10px" title="Export current selection (or whole graph) as JSON template"><i class="fas fa-file-export" style="margin-right:4px"></i>Export</button>
        <button id="glint" style="background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);border-radius:8px;color:#98a6c6;cursor:pointer;font-size:11px;padding:6px 10px" title="Validate this graph (unknown nodes, type mismatches, orphans, missing entry points)"><i class="fas fa-check-double" style="margin-right:4px"></i>Lint</button>
        <button id="gsave" style="background:#74a7ff;border:none;border-radius:8px;color:#0d1117;cursor:pointer;font-size:11px;font-weight:800;padding:6px 16px;transition:.15s"><i class="fas fa-check" style="margin-right:5px"></i>Save & Apply</button>
        <button id="grefresh" style="background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);border-radius:8px;color:#98a6c6;cursor:pointer;font-size:11px;padding:6px 10px" title="Re-scan document"><i class="fas fa-rotate" style="margin-right:4px"></i>↺ Index</button>
        <button id="gclose" style="background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);border-radius:8px;color:#98a6c6;cursor:pointer;font-size:14px;width:30px;height:30px;display:flex;align-items:center;justify-content:center;line-height:1;transition:.15s" title="Close">✕</button>
      </div>
      <div style="display:flex;flex:1;overflow:hidden;min-height:0">
        <div id="gpal" style="width:190px;flex-shrink:0;background:#0e121a;border-right:1px solid rgba(255,255,255,.06);overflow-y:auto;padding:4px 0">${this._buildPal()}</div>
        <div id="gvarpanel" style="width:180px;flex-shrink:0;background:#0b0f16;border-right:1px solid rgba(255,255,255,.06);overflow-y:auto;padding:4px 0;font-size:10px;color:#98a6c6"></div>
        <div id="gwrap" style="flex:1;position:relative;overflow:hidden;cursor:default;user-select:none;touch-action:none;
          background:
            linear-gradient(90deg,rgba(255,255,255,.045) 1px,transparent 1px) 0 0/32px 32px,
            linear-gradient(rgba(255,255,255,.045) 1px,transparent 1px) 0 0/32px 32px,
            linear-gradient(90deg,rgba(255,255,255,.025) 1px,transparent 1px) 0 0/8px 8px,
            linear-gradient(rgba(255,255,255,.025) 1px,transparent 1px) 0 0/8px 8px,
            #0d1117">
          <!-- EDGE SVG — screen-space coords, no transform -->
          <svg id="gedges" style="position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none">
            <defs>
              <linearGradient id="sd-link-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stop-color="#74a7ff"/>
                <stop offset="100%" stop-color="#7ef0c3"/>
              </linearGradient>
            </defs>
          </svg>
          <!-- comments layer — drawn behind nodes (Unreal-style comment boxes) -->
          <div id="gcomments" style="position:absolute;left:0;top:0;transform-origin:0 0;overflow:visible;will-change:transform"></div>
          <!-- nodes layer — transform-origin 0 0, will-change for GPU -->
          <div id="gnodes" style="position:absolute;left:0;top:0;transform-origin:0 0;overflow:visible;will-change:transform"></div>
          <!-- zoom / fit controls -->
          <div style="position:absolute;bottom:12px;right:12px;display:flex;gap:4px">
            <button class="gz" data-d="0.15" title="Zoom in">+</button>
            <button class="gz" data-d="-0.15" title="Zoom out">−</button>
            <button id="gfit" title="Fit view">⊡ Fit</button>
          </div>
          <div style="position:absolute;bottom:12px;left:12px;font-size:9px;color:rgba(255,255,255,.18);pointer-events:none">
            RMB/Space+drag: pan · Scroll: zoom · Drag header: move node · Shift+Click: multi-select · Shift+Drag: marquee · Ctrl+Drag: comment box · Backspace: delete selection · Output→Input: connect · Dbl-click edge: delete
          </div>
          <div id="gmode-badge" style="position:absolute;top:10px;left:10px;font-size:10px;padding:4px 10px;border-radius:8px;pointer-events:none;border:1px solid rgba(255,255,255,.08);background:#151a24;display:none;color:#98a6c6"></div>
        </div>
      </div>`;
    document.body.appendChild(win);
    this.win     = win;
    this.edgeSVG = win.querySelector("#gedges");
    this.nodesEl = win.querySelector("#gnodes");
    this.commentsEl = win.querySelector("#gcomments");

    const btnBase = "background:rgba(21,26,36,.9);border:1px solid rgba(255,255,255,.08);border-radius:8px;color:#98a6c6;cursor:pointer;font-size:12px;height:30px;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(6px);transition:.15s;box-shadow:0 4px 12px rgba(0,0,0,.4)";
    win.querySelectorAll(".gz").forEach(b=>{b.style.cssText=btnBase+";width:30px";});
    win.querySelector("#gfit").style.cssText=btnBase+";padding:0 10px;font-size:11px;font-weight:600;gap:4px";

    this._wireWin();
      }

  _drawGrid() {
  }

  _buildPal() {
    const ALLOWED_CONFIG_CATS = new Set(["Sources", "Math"]);
    const ALLOWED_QUEST_CATS  = new Set(["Flow", "Quest", "Sources", "Math", "Compare", "Logic"]);
    const ALLOWED_QUEST_SOURCES = new Set([
      "literal", "literal_str", "get_path", "actor_ref", "item_uuid", "fa_icon"
    ]);
    const IMPLICIT_CLICK_WIDGETS = new Set([
      "rollButton","counter","dice","toggle","tracker","clock",
      "tokenPool","diceTray","number","resource","progress","richtext"
    ]);
    const isWidgetGraph    = !!this.widget && !this.configMode;
    const isAttrGraph      = this.widget?.type === "attribute";
    const isItemGraph      = !!this.itemSaveCtx && !this.widget;
    const isSheetTrigger   = !!this.sheetTrigger;
    const isQuestModeAny   = !!(this.chainTrigger || this.questTrigger);
    const hidesEvents      = !isSheetTrigger && !isQuestModeAny
      && ((isWidgetGraph && !isAttrGraph) || isAttrGraph || isItemGraph);
    const hidesOnClick     = isSheetTrigger || isQuestModeAny || (isWidgetGraph && !isAttrGraph
      && IMPLICIT_CLICK_WIDGETS.has(this.widget?.type));

    const rows = CATS.map(cat=>{
      if (isQuestModeAny && !ALLOWED_QUEST_CATS.has(cat.id)) return "";

      const nodes = Object.entries(NODE_DEFS).filter(([type,d]) => {
        if (d.isWidgetConfig) return false;
        if (d.hidden) return false;
        if (this.configMode && !ALLOWED_CONFIG_CATS.has(d.cat)) return false;
        if (hidesEvents && d.isEvent) return false;
        if (hidesOnClick && type === "on_click") return false;
        if (isSheetTrigger && type === "output") return false;
        if (this.actionGraph && type === "output") return false;
        if (isQuestModeAny) {
          if (type === "output") return false;
          if (d.cat === "Sources" && !ALLOWED_QUEST_SOURCES.has(type)) return false;
          if (d.isEvent && d.cat !== "Quest") return false;
        }
        return d.cat === cat.id;
      });
      if (!nodes.length) return "";
      return `<div style="padding:5px 10px 3px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:${cat.color};border-top:1px solid rgba(255,255,255,.05);margin-top:4px">${cat.id}</div>
        ${nodes.map(([type,d])=>`<div class="gpal" data-type="${type}" draggable="true" title="${esc(d.desc??d.title)}"
          style="display:flex;align-items:center;gap:8px;padding:6px 12px;cursor:grab;border-radius:8px;margin:1px 4px;transition:.15s">
          <div style="width:9px;height:9px;border-radius:${d.isAction?'2px':'50%'};flex-shrink:0;background:${d.color};opacity:.9"></div>
          <span style="font-size:11px;color:#98a6c6;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${d.title}</span>
        </div>`).join("")}`;
    }).join("");
    return rows;
  }

  _wireWin() {
    const win  = this.win;
    const wrap = win.querySelector("#gwrap");

    win.querySelector("#gclose").addEventListener("click", async () => {
      await this._saveGraph(); this.close();
    });
    win.querySelector("#gsave").addEventListener("click", async () => {
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
    win.querySelector("#grefresh")?.addEventListener("click",()=>{
      this._smartIndex = this._buildSmartIndex();
      this._renderAll();
      this._scheduleEdges();
      const btn = win.querySelector("#grefresh");
      if(btn){ const orig=btn.innerHTML; btn.innerHTML='<i class="fas fa-check" style="margin-right:4px"></i>Refreshed!'; btn.style.color="#aaffaa"; setTimeout(()=>{ btn.innerHTML=orig; btn.style.color="#6aaa6a"; },1200); }
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

    this._raf = 0;
    this._scheduleEdges = () => {
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => {
        this._raf = 0;
        this._redrawEdges();
        this._updatePreview();
      });
    };

    let ds = null;
    win.querySelector("#gbar").addEventListener("mousedown", ev => {
      if (ev.target.closest("button")) return;
      ds = { x: ev.clientX - win.offsetLeft, y: ev.clientY - win.offsetTop };
    });

    const _move = ev => {

      if (ds) {
        win.style.transform = "none";
        win.style.left = `${Math.max(0, ev.clientX - ds.x)}px`;
        win.style.top  = `${Math.max(0, ev.clientY - ds.y)}px`;
      }
      if (this._panDrag) {
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
      ds = null;
      if (this._panDrag) { this._panDrag = null; wrap.style.cursor = ""; }
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
    document.addEventListener("mousemove", _move);
    document.addEventListener("mouseup",   _up);
    this._cleanup.push(() => {
      document.removeEventListener("mousemove", _move);
      document.removeEventListener("mouseup",   _up);
    });

    let space = false;
    const _kd = ev => {
      if (ev.code === "Space" && ev.target === document.body) { space = true; wrap.style.cursor = "grab"; return; }

      if (!this.win || !document.body.contains(this.win)) return;
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
    document.addEventListener("keydown", _kd);
    document.addEventListener("keyup",   _ku);
    this._cleanup.push(() => {
      document.removeEventListener("keydown", _kd);
      document.removeEventListener("keyup",   _ku);
    });

    wrap.addEventListener("mousedown", ev => {
      if (ev.button === 1 || (ev.button === 0 && space)) {
        ev.preventDefault();
        this._panDrag = { ox: ev.clientX - this._pan.x, oy: ev.clientY - this._pan.y };
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

    wrap.addEventListener("wheel", ev => {
      ev.preventDefault();
      _zoomAt(ev.clientX, ev.clientY, ev.deltaY);
    }, { passive: false });

    wrap.addEventListener("contextmenu", ev => {
      ev.preventDefault();
      const r  = wrap.getBoundingClientRect();
      const gx = (ev.clientX - r.left - this._pan.x) / this._zoom;
      const gy = (ev.clientY - r.top  - this._pan.y) / this._zoom;
      this._ctxMenu(ev.clientX, ev.clientY, gx, gy);
    });

    win.querySelectorAll(".gpal").forEach(el => {
      el.addEventListener("dragstart", ev => ev.dataTransfer.setData("text/plain", JSON.stringify({ _sg: el.dataset.type })));
      el.addEventListener("mouseenter", () => el.style.background = "rgba(116,167,255,.1)");
      el.addEventListener("mouseleave", () => el.style.background = "");
    });
    wrap.addEventListener("dragover", ev => ev.preventDefault());
    wrap.addEventListener("drop", ev => {
      ev.preventDefault();
      try {
        const d = JSON.parse(ev.dataTransfer.getData("text/plain"));
        if (d._sg) {
          const r = wrap.getBoundingClientRect();
          this._addNode(d._sg, (ev.clientX - r.left - this._pan.x) / this._zoom, (ev.clientY - r.top - this._pan.y) / this._zoom);
        }
        if (d.type === "Item" || d.uuid?.includes("Item")) {
          const focused = document.activeElement;
          if (focused?.dataset?.fieldType === "text" && focused?.placeholder?.includes("drag")) {
            focused.value = d.uuid ?? d.id ?? "";
            focused.dispatchEvent(new Event("input", { bubbles: true }));
          }
        }
      } catch {}
    });
  }

  _ctxMenu(sx,sy,gx,gy) {
    document.querySelector(".sdgctx")?.remove();
    const menu=document.createElement("div");
    menu.className="sdgctx";
    menu.style.cssText=`position:fixed;left:${sx}px;top:${sy}px;background:#121220;border:1px solid #2a2a3e;border-radius:6px;box-shadow:0 8px 32px rgba(0,0,0,.85);z-index:25000;min-width:200px;padding:4px 0;font-family:'Signika',serif;max-height:82vh;overflow-y:auto`;

    const search=document.createElement("input");
    search.placeholder="Search…";
    search.style.cssText="width:calc(100% - 16px);margin:6px 8px 3px;background:#0c0c18;border:1px solid #2a2a3e;border-radius:4px;color:var(--sd-text);font-size:11px;padding:4px 8px;outline:none;box-sizing:border-box";
    menu.appendChild(search);

    const list=document.createElement("div");
    menu.appendChild(list);

    const build=(q="")=>{
      list.innerHTML="";
      CATS.forEach(cat=>{
        const nodes=Object.entries(NODE_DEFS).filter(([,d])=>{
          if(d.cat!==cat.id||d.hidden) return false;
          if(!q) return true;
          const hay = (_NL(d.title) + " " + d.title).toLowerCase();
          return hay.includes(q.toLowerCase());
        });
        if(!nodes.length) return;
        const h=document.createElement("div");
        h.style.cssText=`padding:3px 10px;font-size:9px;font-weight:700;text-transform:uppercase;color:${cat.color};border-top:1px solid #1a1a28;margin-top:3px`;
        h.textContent=cat.id; list.appendChild(h);
        nodes.forEach(([type,def])=>{
          const item=document.createElement("div");
          item.style.cssText="padding:5px 16px;font-size:11px;color:#c0c0d8;cursor:pointer;display:flex;align-items:center;gap:8px";
          item.innerHTML=`<div style="width:8px;height:8px;border-radius:2px;background:${def.color};flex-shrink:0"></div>${esc(_NL(def.title))}`;
          item.addEventListener("mouseenter",()=>item.style.background="rgba(116,167,255,.1)");
          item.addEventListener("mouseleave",()=>item.style.background="");
          item.addEventListener("click",()=>{this._addNode(type,gx,gy);menu.remove();});
          list.appendChild(item);
        });
      });
    };
    build();
    search.addEventListener("input",()=>build(search.value));
    document.body.appendChild(menu);
    search.focus();
    setTimeout(()=>document.addEventListener("click",function f(){menu.remove();document.removeEventListener("click",f);},{once:true}),80);
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
      const valEdge = oldOut ? this.edges.find(e => e.toNode === oldOut.id && e.toPin === "value") : null;
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

  _addNode(type,x,y) {
    const def=NODE_DEFS[type]; if(!def) return null;
    const node={id:`n${this._id++}`,type,x:Math.round(x),y:Math.round(y),
      data:Object.fromEntries((def.fields??[]).map(f=>[f.key,f.default??""]))};
    this.nodes.push(node);
    this._renderNode(node);
    this._updatePreview();
    this._pushHistory();
    return node;
  }

  _delNode(id) {
    if(id==="output") return;
    if(id==="init_on_roll" || id==="init_output") return;
    this.nodes=this.nodes.filter(n=>n.id!==id);
    this.edges=this.edges.filter(e=>e.fromNode!==id&&e.toNode!==id);
    this.nodesEl.querySelector(`[data-nid="${id}"]`)?.remove();
    this._scheduleEdges?.();
    this._pushHistory();
  }

  _addEdge(fn,fp,tn,tp) {
    if(fn===tn) return;
    this.edges=this.edges.filter(e=>!(e.toNode===tn&&e.toPin===tp));
    this.edges.push({id:`e${uid()}`,fromNode:fn,fromPin:fp,toNode:tn,toPin:tp});
    const toNode = this.nodes.find(n => n.id === tn);
    if (toNode) this._renderNode(toNode);
    this._scheduleEdges?.();
    this._pushHistory();
  }

  _removeEdge(edgeId) {
    const edge = this.edges.find(e => e.id === edgeId);
    if (!edge) return;
    this.edges = this.edges.filter(e => e.id !== edgeId);
    const toNode = this.nodes.find(n => n.id === edge.toNode);
    if (toNode) this._renderNode(toNode);
    this._scheduleEdges?.();
    this._pushHistory();
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
    el.innerHTML = `
      <div class="gcmt-hdr" style="display:flex;align-items:center;gap:6px;padding:4px 10px;background:${color};border-radius:8px 8px 0 0;cursor:grab;user-select:none;font-family:Inter,'Segoe UI',Arial,sans-serif;color:#1a1a1a;font-weight:700;font-size:13px">
        <span class="gcmt-ttl" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.title || "Comment")}</span>
        <span class="gcmt-del" style="cursor:pointer;padding:0 6px;color:#1a1a1a;opacity:.55;font-size:14px" title="Delete comment">×</span>
      </div>
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

    const el=document.createElement("div");
    el.dataset.nid=node.id;

    const W_BASE = def.wideNode ? 440 : def.isAttackBranch ? 340 : def.isBranch ? 280 : def.isAction ? 320 : (def.isOutput||def.isAttrOutput||def.isSkillOutput) ? 220 : 250;

    const _allPinLabels = [
      ...(def.inputs ?? []).map(p => p.label ?? ""),
      ...(def.outputs ?? []).map(p => p.label ?? "")
    ];
    const _longestPinLabel = _allPinLabels.reduce((m, s) => Math.max(m, String(s).length), 0);
    const W_PIN = _longestPinLabel > 0 ? 80 + Math.ceil(_longestPinLabel * 7.2) : 0;

    const _longestDataVal = Object.values(node.data ?? {}).reduce((max, v) => {
      const len = typeof v === "string" ? v.length : 0;
      return len > max ? len : max;
    }, 0);
    const W_DATA = _longestDataVal > 0 ? Math.min(560, 100 + Math.ceil(_longestDataVal * 7.5)) : 0;
    const W_MIN = W_BASE;
    const W = Math.max(W_BASE, W_PIN, W_DATA);

    const _kind   = getNodeKind(def);
    const _accent = SD_NODE_KIND_COLOURS[_kind] ?? "rgba(255,255,255,.08)";

    el.dataset.kind = _kind;
    el.style.cssText=`position:absolute;left:${node.x}px;top:${node.y}px;min-width:${W_MIN}px;width:${W}px;max-width:640px;
      background:linear-gradient(180deg,#151a24,#101521);
      border:1px solid ${_accent}55;
      border-left:3px solid ${_accent};
      border-radius:16px;
      box-shadow:0 18px 45px rgba(0,0,0,.5), 0 0 0 1px ${_accent}22 inset;
      overflow:hidden;
      transform:translateZ(0);`;

    const _hc = def.color ?? "#555";
    el.innerHTML=`
      <div class="gnhdr" data-nid="${node.id}" style="
        height:42px;display:flex;align-items:center;gap:10px;padding:0 12px;
        background:linear-gradient(90deg,${_hc}dd,${_hc}99);
        cursor:grab;user-select:none;">
        <span style="font-size:12px;font-weight:800;color:#fff;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;letter-spacing:.2px" title="${esc(_NL(def.title))}">${esc(_NL(def.title))}</span>
        ${(!isOut && !def.isWidgetConfig)?`<button class="ndel" data-nid="${node.id}"
          style="width:26px;height:26px;display:grid;place-items:center;border:none;border-radius:8px;
                 background:rgba(255,255,255,.1);color:#fff;cursor:pointer;font-size:16px;line-height:1;
                 transition:.15s;flex-shrink:0">✕</button>`:""}
      </div>
      <div class="gnbody" style="padding:6px 0"></div>`;

    const body=el.querySelector(".gnbody");

    let inputPins  = def.inputs??[];
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
      inputPins = [...inputPins, ...dynPins];
    }

    for(const p of inputPins.filter(p=>p.type==="exec"))
      body.appendChild(this._pinRow(node,p,"input"));

    const valIns  = inputPins.filter(p=>p.type!=="exec");
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

    const rowCount = Math.max(rows.length, valOuts.length);

    for(let i=0;i<rowCount;i++) {
      const row = document.createElement("div");
      row.style.cssText="display:flex;align-items:center;justify-content:space-between;min-height:32px;padding:0 4px;gap:8px";

      const r   = rows[i] ?? { inp:null, fld:null };
      const inp = r.inp;
      const fld = r.fld;
      const outp = valOuts[i] ?? null;

      const left = document.createElement("div");
      left.style.cssText = outp ? "flex:1;display:flex;align-items:center;min-width:0;gap:6px" : "flex:1 1 100%;display:flex;align-items:center;min-width:0;gap:6px";

      if (inp) left.appendChild(this._pinEl(node, inp, "input"));
      if (fld) left.appendChild(this._fldEl(node, fld));

      row.appendChild(left);

      if (outp) {
        const right = document.createElement("div");
        right.style.cssText = "flex:0 0 auto;display:flex;align-items:center;justify-content:flex-end;min-width:0";
        right.appendChild(this._pinEl(node, outp, "output"));
        row.appendChild(right);
      }
      body.appendChild(row);
    }

    let activeExecOuts = outputPins.filter(p=>p.type==="exec");
    if (def.isDialogSwitch) {
      const count = Math.max(2, Math.min(8, parseInt(node.data?.count) || 2));
      activeExecOuts = activeExecOuts.slice(0, count).map((p, i) => ({
        ...p,
        label: node.data?.[`label${i}`] || p.label
      }));
    } else if (def.isSequence) {
      const count = Math.max(2, Math.min(12, parseInt(node.data?.count) || 2));
      activeExecOuts = activeExecOuts.slice(0, count);
    }
    for(const p of activeExecOuts)
      body.appendChild(this._pinRow(node,p,"output"));

    el.querySelector(".ndel")?.addEventListener("click",ev=>{ev.stopPropagation();this._delNode(node.id);});
    el.querySelector(".gnhdr").addEventListener("mousedown",ev=>{
      if(ev.target.classList.contains("ndel")) return;
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
      card.style.cssText = "margin:4px 8px 5px;border:1px solid #4a3a1a;border-radius:5px;background:#0e0a04;padding:5px 8px;display:flex;flex-direction:column;gap:3px;align-items:center";

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
        if (!doc || !p) { scoreDisplay.textContent = "—"; modDisplay.textContent = ""; return; }
        const raw = foundry.utils.getProperty(doc, p);
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
      card.style.cssText = "margin:4px 8px 5px;border:1px solid #1a3a4a;border-radius:5px;background:#04090e;padding:5px 8px;display:flex;flex-direction:column;gap:3px;align-items:center";

      const rankDisplay = document.createElement("div");
      rankDisplay.style.cssText = "font-size:28px;font-weight:700;color:#60c0e8;font-family:monospace;line-height:1;letter-spacing:-1px";

      card.appendChild(rankDisplay);
      body.appendChild(card);

      const _refreshSkillCard = () => {
        const doc = this.doc;
        const p = node.data.path ?? "";
        if (!doc || !p) { rankDisplay.textContent = "—"; return; }
        const raw = foundry.utils.getProperty(doc, p);
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

  _pinRow(node,pin,side) {
    const row=document.createElement("div");
    const isExec=pin.type==="exec"||!pin.type;
    row.style.cssText=`display:flex;align-items:center;gap:7px;min-height:28px;
      ${side==="output"?"justify-content:flex-end;padding-right:10px":"padding-left:10px"}`;
    const dot=this._dotEl(node,pin,side);
    const lbl=document.createElement("span");
    lbl.textContent=_NL(pin.label||"");
    lbl.style.cssText=`font-size:12px;color:${isExec?"#ffca6b":"#98a6c6"};
      white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:160px;line-height:1`;
    if(side==="input"){row.appendChild(dot);row.appendChild(lbl);}
    else{row.appendChild(lbl);row.appendChild(dot);}
    return row;
  }

  _pinEl(node,pin,side) {
    const wrap=document.createElement("div");
    wrap.style.cssText=`display:flex;align-items:center;gap:7px;padding:3px 0;${side==="output"?"padding-right:10px;justify-content:flex-end":"padding-left:10px"}`;
    const dot=this._dotEl(node,pin,side);
    const lbl=document.createElement("span");
    lbl.textContent=_NL(pin.label||"");

    lbl.style.cssText="font-size:12px;color:#98a6c6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px;line-height:1";
    if(side==="input"){wrap.appendChild(dot);wrap.appendChild(lbl);}
    else{wrap.appendChild(lbl);wrap.appendChild(dot);}
    return wrap;
  }

  _dotEl(node,pin,side) {
    const isExec=pin.type==="exec";
    const dot=document.createElement("div");
    dot.className="gpin";
    dot.dataset.nid=node.id; dot.dataset.pid=pin.id; dot.dataset.side=side;
    const _pinBg  = isExec ? "#ffca6b" : (side==="output" ? "#22d48a" : "#497efb");
    const _pinBdr = isExec ? "#c09020" : (side==="output" ? "#16a864" : "#2a5ab0");
    dot.style.cssText=`width:13px;height:13px;border-radius:${isExec?"3px":"50%"};
      background:${_pinBg};border:2px solid rgba(255,255,255,.7);
      box-shadow:0 0 0 1px rgba(0,0,0,.2) inset;
      cursor:crosshair;flex-shrink:0;
      transition:transform .12s ease,box-shadow .12s ease;`;
    dot.addEventListener("mousedown",ev=>{
      ev.stopPropagation();
      if(side==="output") this._startConn(node.id,pin.id,isExec,ev,pin.type);
    });
    dot.addEventListener("contextmenu",ev=>{
      ev.preventDefault();
      ev.stopPropagation();
      const before = this.edges.length;
      const touchedTargets = new Set();
      if(side==="output") {
        for (const e of this.edges) {
          if (e.fromNode===node.id && e.fromPin===pin.id) touchedTargets.add(e.toNode);
        }
        this.edges = this.edges.filter(e=>!(e.fromNode===node.id&&e.fromPin===pin.id));
      } else {
        touchedTargets.add(node.id);
        this.edges = this.edges.filter(e=>!(e.toNode===node.id&&e.toPin===pin.id));
      }
      if(this.edges.length !== before) {
        for (const tid of touchedTargets) {
          const tn = this.nodes.find(n => n.id === tid);
          if (tn) this._renderNode(tn);
        }
        this._redrawEdges();
        this._updatePreview();
      }
    });
    dot.addEventListener("mouseenter",()=>{
      dot.style.transform="scale(1.2)";
      dot.style.boxShadow="0 0 0 6px rgba(255,255,255,.1)";
      const hasEdge = side==="output"
        ? this.edges.some(e=>e.fromNode===node.id&&e.fromPin===pin.id)
        : this.edges.some(e=>e.toNode===node.id&&e.toPin===pin.id);
      dot.title = hasEdge ? "RMB: disconnect" : "";
    });
    dot.addEventListener("mouseleave",()=>{dot.style.transform="";dot.style.boxShadow="0 0 0 1px rgba(0,0,0,.2) inset";});
    return dot;
  }

  _fldEl(node,field) {
    const wrap=document.createElement("div");
    wrap.style.cssText="display:flex;align-items:center;gap:6px;padding:2px 8px;flex:1;min-width:0";
    if(field.label){
      const l=document.createElement("label");
      const lbl=_NL(field.label);
      l.textContent=lbl;
      l.style.cssText="font-size:10px;color:#8080aa;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:120px;flex-shrink:1;min-width:0;font-weight:600;letter-spacing:.03em;text-transform:uppercase;margin-right:4px";
      l.title=lbl;
      wrap.appendChild(l);
    }

    const IS="background:#1a1e2e;border:1px solid rgba(120,100,220,.35);border-radius:6px;color:#eef3ff;font-size:12px;padding:5px 10px;font-family:monospace;outline:none;min-width:80px;max-width:420px;width:auto;box-sizing:border-box;height:28px;field-sizing:content";
    const SI=IS+";cursor:pointer";
    const idx=this._smartIndex??{slots:[],ownedItems:[],effects:[],widgets:[],invItemSlots:[]};

    if(field.type==="slot-picker"){
      const cur=node.data[field.key]??field.default??"slot1";
      const sel=document.createElement("select"); sel.style.cssText=SI; sel.title="Slot ID — auto-indexed";
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
          o.textContent=`${s.id} — ${s.label}`;
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
      const sel=document.createElement("select"); sel.style.cssText=SI; sel.title="Owned item — auto-indexed";
      { const o=document.createElement("option"); o.value=""; o.textContent="— pick item —"; if(!cur)o.selected=true; sel.appendChild(o); }
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
      const sel=document.createElement("select"); sel.style.cssText=SI; sel.title="Active Effect — auto-indexed";
      { const o=document.createElement("option"); o.value=""; o.textContent="— pick effect —"; if(!cur)o.selected=true; sel.appendChild(o); }
      for(const fx of idx.effects){ const o=document.createElement("option"); o.value=fx.name; o.textContent=fx.name; if(fx.name===cur)o.selected=true; sel.appendChild(o); }
      if(cur && !idx.effects.find(e=>e.name===cur)){ const o=document.createElement("option"); o.value=cur; o.textContent=cur+" (custom)"; o.selected=true; sel.appendChild(o); }
      sel.addEventListener("mousedown",ev=>ev.stopPropagation());
      sel.addEventListener("change",()=>{ node.data[field.key]=sel.value; this._updatePreview(); });
      wrap.appendChild(sel); return wrap;
    }

    if(field.type==="effect-uuid-picker"){
      const cur=node.data[field.key]??field.default??"";
      const container=document.createElement("div"); container.style.cssText="display:flex;flex-direction:column;gap:2px;flex:1;min-width:0";
      const sel=document.createElement("select"); sel.style.cssText=SI; sel.title="Effect — picks UUID automatically";
      { const o=document.createElement("option"); o.value=""; o.textContent="— pick effect —"; if(!cur)o.selected=true; sel.appendChild(o); }
      for(const fx of idx.effects){ const o=document.createElement("option"); o.value=fx.uuid; o.textContent=fx.name; if(fx.uuid===cur)o.selected=true; sel.appendChild(o); }
      if(cur && !idx.effects.find(e=>e.uuid===cur)){ const o=document.createElement("option"); o.value=cur; o.textContent=cur+" (custom uuid)"; o.selected=true; sel.appendChild(o); }
      const rawInp=document.createElement("input"); rawInp.type="text"; rawInp.placeholder="or paste UUID…"; rawInp.value=cur;
      rawInp.style.cssText=IS+";font-size:11px;color:var(--sd-text-2)";
      sel.addEventListener("mousedown",ev=>ev.stopPropagation());
      rawInp.addEventListener("mousedown",ev=>ev.stopPropagation());
      sel.addEventListener("change",()=>{ node.data[field.key]=sel.value; rawInp.value=sel.value; this._updatePreview(); });
      rawInp.addEventListener("input",()=>{ node.data[field.key]=rawInp.value; this._updatePreview(); });
      container.appendChild(sel); container.appendChild(rawInp); wrap.appendChild(container); return wrap;
    }

    if(field.type==="widget-picker"){
      const cur=node.data[field.key]??field.default??"";
      const sel=document.createElement("select"); sel.style.cssText=SI; sel.title="Widget key — auto-indexed from tabs";
      { const o=document.createElement("option"); o.value=""; o.textContent="— any widget —"; if(!cur)o.selected=true; sel.appendChild(o); }
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
      { const o=document.createElement("option"); o.value=""; o.textContent="— container item —"; if(!curItem)o.selected=true; selItem.appendChild(o); }
      const byType={};
      for(const it of idx.ownedItems)(byType[it.type]||(byType[it.type]=[])).push(it);
      for(const [tp,list] of Object.entries(byType)){
        const g=document.createElement("optgroup"); g.label=tp;
        for(const it of list){ const hasSlots=idx.invItemSlots.some(s=>s.itemId===it.id); const o=document.createElement("option"); o.value=it.name; o.textContent=it.name+(hasSlots?" ⬡":""); if(it.name===curItem)o.selected=true; g.appendChild(o); }
        selItem.appendChild(g);
      }

      const selSlot=document.createElement("select"); selSlot.style.cssText=SI; selSlot.title="Slot on that item";
      const buildSlotOpts=()=>{
        while(selSlot.firstChild)selSlot.removeChild(selSlot.firstChild);
        const chosen=idx.ownedItems.find(i=>i.name===selItem.value);
        const slots=chosen ? idx.invItemSlots.filter(s=>s.itemId===chosen.id) : [];
        if(!slots.length){ const o=document.createElement("option"); o.value=node.data[slotKey]||"slot1"; o.textContent=(node.data[slotKey]||"slot1")+" (no indexed slots)"; selSlot.appendChild(o); return; }
        for(const s of slots){ const o=document.createElement("option"); o.value=s.slotId; o.textContent=`${s.slotId} — ${s.slotLabel}`; if(s.slotId===curSlot)o.selected=true; selSlot.appendChild(o); }
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
      { const o=document.createElement("option"); o.value=""; o.textContent="— pick owned item —"; if(!curName)o.selected=true; selItem.appendChild(o); }
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
        dropZone.textContent=chosen ? `✔ ${chosen.name}` : "⬇ drag item here";
        dropZone.style.color=chosen?"#6aaa6a":"#5a7a9a";
        this._updatePreview();
      });

      const dropZone=document.createElement("div");
      const hasVal=curUuid||curName;
      dropZone.textContent=hasVal ? `✔ ${curName||curUuid}` : "⬇ drag item here";
      dropZone.style.cssText=`background:#060612;border:2px dashed ${hasVal?"#3a6a3a":"#2a3a5a"};border-radius:4px;color:${hasVal?"#6aaa6a":"#5a7a9a"};font-size:11px;padding:5px 8px;text-align:center;cursor:copy;transition:border-color .15s,color .15s;`;
      dropZone.title="Drag an item from the Foundry sidebar to auto-fill UUID";
      dropZone.addEventListener("dragover",ev=>{ ev.preventDefault(); dropZone.style.borderColor="var(--sd-accent)"; dropZone.style.color="#a090ff"; });
      dropZone.addEventListener("dragleave",()=>{ dropZone.style.borderColor=node.data[field.key]?"#3a6a3a":"#2a3a5a"; dropZone.style.color=node.data[field.key]?"#6aaa6a":"#5a7a9a"; });
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
          dropZone.textContent=`✔ ${label}`;
          dropZone.style.borderColor="#3a6a3a"; dropZone.style.color="#6aaa6a";

          const opt=[...selItem.options].find(o=>o.value===(found?.name??""));
          if(opt) selItem.value=opt.value;
          this._updatePreview();
        }catch{}
      });

      dropZone.addEventListener("dblclick",()=>{
        node.data[field.key]=""; node.data["itemName"]="";
        dropZone.textContent="⬇ drag item here";
        dropZone.style.borderColor="#2a3a5a"; dropZone.style.color="#5a7a9a";
        selItem.value=""; this._updatePreview();
      });

      container.appendChild(selItem); container.appendChild(dropZone); wrap.appendChild(container); return wrap;
    }

    let inp;
    if(field.type==="bool"){
      inp=document.createElement("input");
      inp.type="checkbox";
      const curB = node.data[field.key];
      inp.checked = (curB === undefined || curB === null) ? !!field.default : !!curB;
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
      for(const o of (field.options??[])){
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
    inp.addEventListener("input",ev=>{
      node.data[field.key]=inp.type==="number"?Number(ev.target.value):ev.target.value;
      this._updatePreview();
      if(field.type==="path" && liveBadge) _refreshLiveBadge();

      {
        const _defV = NODE_DEFS[node.type];
        const _hasVis = _defV?.fields?.some(f => typeof f.visibleIf === "function");
        const _hasDyn = typeof _defV?.computeDynamicOutputs === "function";
        if (_hasVis || _hasDyn) {
          this._renderNode(node); this._scheduleEdges?.(); return;
        }
      }
      const _def2 = NODE_DEFS[node.type];
      if (_def2?.isSequence && field.key === "count") {
        const c = Math.max(2, Math.min(12, Number(ev.target.value) || 2));
        node.data.count = c;
        this._renderNode(node);
        this._scheduleEdges?.();
      } else if (_def2?.isDialogSwitch) {
        if (field.key === "count") {
          this._renderNode(node);
        } else if (field.key.startsWith("label")) {
          const pinIdx = parseInt(field.key.replace("label", ""), 10);
          const _nodeEl2 = this.nodesEl?.querySelector(`[data-nid="${node.id}"]`);
          const dot = _nodeEl2?.querySelector(`[data-pid="out${pinIdx}"][data-side="output"]`);
          if (dot) {
            const span = [...dot.parentElement.children].find(c => c !== dot && c.tagName === "SPAN");
            if (span) span.textContent = ev.target.value || `Option ${pinIdx + 1}`;
          }
        }
      }
      const _nodeEl = this.nodesEl?.querySelector(`[data-nid="${node.id}"]`);
      if (_nodeEl) {
        const _longestNow = Object.values(node.data ?? {}).reduce((max, v) => {
          const len = typeof v === "string" ? v.length : 0;
          return len > max ? len : max;
        }, 0);
        const def2 = NODE_DEFS[node.type] ?? {};
        const W_BASE2 = def2.wideNode ? 400 : def2.isAttackBranch ? 340 : def2.isBranch ? 290 : def2.isAction ? 320 : (def2.isOutput||def2.isAttrOutput||def2.isSkillOutput) ? 240 : 260;
        const W_NEW = Math.max(W_BASE2, _longestNow > 0 ? Math.min(520, 100 + Math.ceil(_longestNow * 7.5)) : 0);
        _nodeEl.style.width = W_NEW + "px";
      }
    });
    wrap.appendChild(inp);

    let liveBadge = null;
    const _refreshLiveBadge = () => {
      const doc = this.doc;
      if (!doc || !liveBadge) return;
      const p = node.data[field.key] ?? "";
      if (!p) { liveBadge.textContent = ""; return; }
      const raw = foundry.utils.getProperty(doc, p);
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

  _redrawEdges() {
    const svg=this.edgeSVG; if(!svg) return;

    const defs = svg.querySelector("defs");
    while(svg.lastChild && svg.lastChild !== defs) svg.removeChild(svg.lastChild);
    if (!defs) {
      const d = document.createElementNS("http://www.w3.org/2000/svg","defs");
      d.innerHTML = `<linearGradient id="sd-link-grad" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#74a7ff"/>
        <stop offset="100%" stop-color="#7ef0c3"/>
      </linearGradient>`;
      svg.insertBefore(d, svg.firstChild);
    }

    for(const edge of this.edges) {
      const from=this._pinScreen(edge.fromNode,edge.fromPin,"output");
      const to  =this._pinScreen(edge.toNode,  edge.toPin,  "input");
      if(!from||!to) continue;

      const def = NODE_DEFS[this.nodes.find(n=>n.id===edge.fromNode)?.type??""];
      const fromPinDef = [...(def?.outputs??[])].find(p=>p.id===edge.fromPin);
      const isExec = fromPinDef?.type==="exec";
      const subColor = subtypeColor(fromPinDef?.type);

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
      path.setAttribute("stroke-width","3.5");
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
    const dragColor = isExec ? "#ffca6b" : (subtypeColor(pinType) ?? "#ffffff");
    line.setAttribute("stroke", dragColor);
    line.setAttribute("stroke-width","3");
    line.setAttribute("stroke-dasharray","7,7");
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
    const pin=document.elementFromPoint(ev.clientX,ev.clientY)?.closest?.(".gpin");
    if (!pin) {
      const wrap = this.win?.querySelector("#gwrap");
      const overWrap = wrap?.contains(ev.target) || (document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.("#gwrap"));
      if (overWrap) {
        this._showQuickInsertMenu(conn, ev);
      }
      return;
    }
    if (pin.dataset.side !== "input" || pin.dataset.nid === conn.fromNode) return;
    const targetNode = this.nodes.find(n=>n.id===pin.dataset.nid);
    const targetDef  = NODE_DEFS[targetNode?.type??""];
    const targetPinDef = (targetDef?.inputs??[]).find(p=>p.id===pin.dataset.pid);
    const targetType   = targetPinDef?.type;
    if (!arePinsCompatible(conn.fromType, targetType)) {
      ui.notifications?.warn?.(`Incompatible pin types: ${pinSubtype(conn.fromType)} → ${pinSubtype(targetType)}`);
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
    for (const [type, def] of Object.entries(NODE_DEFS)) {
      if (def.hidden) continue;
      const inputs = def.inputs ?? [];
      const compat = inputs.find(p => {
        if (fromType === "exec") return p.type === "exec";
        return p.type !== "exec" && arePinsCompatible(fromType, p.type);
      });
      if (!compat) continue;
      candidates.push({ type, def, pin: compat });
    }
    candidates.sort((a, b) => (a.def.cat ?? "").localeCompare(b.def.cat ?? "") || (a.def.title ?? a.type).localeCompare(b.def.title ?? b.type));

    document.getElementById("sd-quick-insert-menu")?.remove();
    const menu = document.createElement("div");
    menu.id = "sd-quick-insert-menu";
    menu.style.cssText = `position:fixed;left:${ev.clientX}px;top:${ev.clientY}px;
      min-width:240px;max-width:340px;max-height:60vh;overflow:auto;
      background:#121220;border:1px solid #2a2a3e;border-radius:8px;
      box-shadow:0 12px 40px rgba(0,0,0,.8);z-index:25000;
      font-family:'Signika',sans-serif;color:var(--sd-text);padding:6px 0`;

    const head = document.createElement("div");
    head.textContent = `Insert node compatible with ${pinSubtype(fromType) || "exec"}`;
    head.style.cssText = "padding:6px 12px;font-size:11px;color:#98a6c6;border-bottom:1px solid #2a2a3e";
    menu.appendChild(head);

    if (!candidates.length) {
      const empty = document.createElement("div");
      empty.textContent = "No compatible nodes";
      empty.style.cssText = "padding:8px 12px;color:var(--sd-text-3)";
      menu.appendChild(empty);
    } else {
      let lastCat = null;
      for (const c of candidates.slice(0, 80)) {
        if (c.def.cat !== lastCat) {
          lastCat = c.def.cat;
          const sec = document.createElement("div");
          sec.textContent = lastCat ?? "Other";
          sec.style.cssText = "padding:4px 12px 2px;font-size:10px;color:#74a7ff;text-transform:uppercase;letter-spacing:.5px";
          menu.appendChild(sec);
        }
        const item = document.createElement("div");
        item.textContent = c.def.title ?? c.type;
        item.style.cssText = "padding:5px 14px;font-size:12px;cursor:pointer";
        item.addEventListener("mouseenter", () => item.style.background = "#1f2538");
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
    document.body.appendChild(menu);

    const close = (e) => {
      if (e && menu.contains(e.target)) return;
      menu.remove();
      document.removeEventListener("mousedown", close, true);
      document.removeEventListener("keydown", onKey, true);
    };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    setTimeout(() => {
      document.addEventListener("mousedown", close, true);
      document.addEventListener("keydown", onKey, true);
    }, 0);
  }

  _doDrag(ev) {
    if(!this._drag) return;
    const dx = (ev.clientX - this._drag.mx) / this._zoom;
    const dy = (ev.clientY - this._drag.my) / this._zoom;
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
    if(!this.nodes.length||!this.win) return;
    const wrap=this.win.querySelector("#gwrap");
    const W=wrap.clientWidth, H=wrap.clientHeight;
    const xs=this.nodes.map(n=>n.x), ys=this.nodes.map(n=>n.y);
    const minX=Math.min(...xs)-50,maxX=Math.max(...xs)+220;
    const minY=Math.min(...ys)-40,maxY=Math.max(...ys)+160;
    this._zoom=Math.clamp(Math.min(W/(maxX-minX),H/(maxY-minY))*0.9,0.22,1.4);
    this._pan.x=(W-(maxX-minX)*this._zoom)/2-minX*this._zoom;
    this._pan.y=(H-(maxY-minY)*this._zoom)/2-minY*this._zoom;
    this._applyTransform();
    setTimeout(()=>this._redrawEdges(),50);
  }

  _hydrateFormula(f) {
    const m=f.match(/^\{([^}]+)\}$/);
    if(m){const n=this._addNode("get_path",350,230);if(n)n.data.path=m[1];}
  }
}

if(!document.getElementById("sd-graph-css")){
  const s=document.createElement("style");
  s.id="sd-graph-css";
  s.textContent=`
    .sdgctx *,.sd-graph-win *{box-sizing:border-box}
    .gpin{transition:transform .12s ease,box-shadow .12s ease}
    .gnhdr{transition:opacity .15s}
    .gnhdr:active{cursor:grabbing!important;opacity:.9}
    .node-selected{outline:2px solid rgba(116,167,255,.9)!important;outline-offset:0}
    .ndel:hover{background:rgba(255,124,124,.22)!important}
    .gpal:hover{background:rgba(116,167,255,.1)!important}
    #gpal::-webkit-scrollbar{width:4px}
    #gpal::-webkit-scrollbar-thumb{background:rgba(255,255,255,.1);border-radius:2px}
    #gsave:hover{filter:brightness(1.1)}
    #gclose:hover{background:rgba(255,124,124,.2)!important;color:#ff7c7c!important}
  `;
  document.head.appendChild(s);
}
