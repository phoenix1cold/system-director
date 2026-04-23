import { migrateGraph } from "./node-migration.mjs";
import { pinSubtype, subtypeColor, arePinsCompatible } from "./pin-types.mjs";
import { lintGraph, lintSummary } from "./graph-linter.mjs";

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
  } catch { /* no-op */ }
  return text;
}

// NODE CATALOGUE

export const NODE_DEFS = {

  // System
  output: {
    title:"OUTPUT", color:"#5a4ec0", cat:"_system",
    desc:"Connect a formula value OR an exec chain. Use Branch to split paths.",
    inputs:[
      {id:"value",     label:"Formula value", type:"value"},
      {id:"exec",      label:"Run (exec)",    type:"exec"}
    ],
    outputs:[],
    fields:[],
    isOutput:true
  },

  // Attribute widget -- special nodes, only appear in attribute graphs
  attr_score_val: {
    title:"Attr Score", color:"#7a4a1a", cat:"_attr",
    desc:"Live numeric value of this attribute (read-only, always present in attribute graphs).",
    inputs:[], outputs:[{id:"value",label:"Value",type:"value"}],
    fields:[{key:"path",label:"Score Path",type:"path",default:"system.attributes.attr1.value"}],
    isAttrScore: true,
    compile:(n)=>`{${n.data.path??"system.attributes.attr1.value"}}`
  },
  attr_output: {
    title:"ATTR OUTPUT", color:"#7a4a1a", cat:"_attr",
    desc:"Attribute widget output. Wire modValue to set what the modifier button shows and rolls. Wire exec to set what happens on click.",
    inputs:[
      {id:"modValue", label:"Mod Value",   type:"value"},
      {id:"exec",     label:"On Click",    type:"exec"}
    ],
    outputs:[],
    fields:[],
    isAttrOutput:true
  },

  // Flow
  branch: {
    title:"Branch", color:"#8a2a8a", cat:"Flow",
    desc:"If Condition is TRUE runs True path; otherwise False path",
    inputs:[
      {id:"exec",  label:"",         type:"exec"},
      {id:"cond",  label:"Condition",type:"value"}
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
    // 12 static pins -- only the first `count` are rendered & walked.
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

  // Sources
  // Number -- outputs its value, or the wired input if connected
  literal: {
    title:"Number", color:"#2a4a6a", cat:"Sources",
    inputs:[{id:"in",label:"In",type:"value"}], outputs:[{id:"v",label:"Out",type:"value"}],
    fields:[{key:"value",label:"",type:"number",default:0}],
    compile:(n,i)=> i.in !== undefined ? String(i.in) : String(n.data.value ?? 0)
  },
  // Text -- outputs raw string (no quotes), used for labels/flavors not roll formulas
  literal_str: {
    title:"Text", color:"#2a4a6a", cat:"Sources",
    inputs:[{id:"in",label:"In",type:"value"}], outputs:[{id:"v",label:"Out",type:"value"}],
    fields:[{key:"value",label:"",type:"text",default:""}],
    compile:(n,i)=>{
      const v = i.in !== undefined ? String(i.in) : String(n.data.value ?? "");
      return `"${v.replace(/\\/g,"\\\\").replace(/"/g,'\\"')}"`;
    }
  },
  get_path: {
    title:"Get Field", color:"#1a4060", cat:"Sources",
    desc:"Read any field from the actor or item by dot-path",
    inputs:[], outputs:[{id:"v",label:"Value",type:"value"}],
    fields:[{key:"path",label:"Path",type:"path",default:"system.resources.hp.value"}],
    compile:(n)=>`{${n.data.path??""}}`
  },
  get_widget: {
    title:"Get Widget Value", color:"#1a4060", cat:"Sources",
    desc:"Read the current computed value of another widget by its Widget Key",
    inputs:[], outputs:[{id:"v",label:"Value",type:"value"}],
    fields:[{key:"key",label:"Widget",type:"widget-picker",default:""}],
    compile:(n)=>`{widget:${n.data.key??""}}`
  },
  get_widget_path: {
    title:"Get Widget Path", color:"#1a4060", cat:"Sources",
    desc:"Emits the data path bound to a widget (e.g. system.flags.hp). Feed into Set Field / Modify to change the widget's value from the graph.",
    inputs:[], outputs:[{id:"v",label:"Path",type:"value"}],
    fields:[{key:"key",label:"Widget",type:"widget-picker",default:""}],
    compile:(n)=>`{widgetPath:${n.data.key??""}}`
  },
  actor_ref: {
    title:"Actor @Ref", color:"#1a4060", cat:"Sources",
    desc:"Shorthand from actor roll data: @attr1=attr1.mod, @level, @prof",
    inputs:[], outputs:[{id:"v",label:"Value",type:"value"}],
    fields:[{key:"ref",label:"@name",type:"text",default:"attr1",placeholder:"attr1 / level / prof"}],
    compile:(n)=>`{@${n.data.ref??"attr1"}}`
  },
  slot_count: {
    title:"Slot Count", color:"#1a4060", cat:"Sources",
    desc:"Count items in a slot. Slot is auto-indexed — pick from dropdown or connect a Get Actor Slot ID node.",
    inputs:[{id:"itemSlot",label:"Item Slot",type:"value"}],
    outputs:[{id:"v",label:"Count",type:"value"}],
    fields:[{key:"slotId",label:"Slot ID",type:"slot-picker",default:"slot1"}],
    compile:(n,i)=>{
      // Dynamic pin always resolves against self/actor at runtime
      if (i.itemSlot != null) return `{slotCount:${i.itemSlot}}`;
      const path = n.data.slotPath;
      if (path) {
        const parts = path.split("/");
        // Direct actor-owned item slot: "itemId/slotId" (2 segments) -> invItemSlotCount
        if (parts.length === 2) return `{invItemSlotCount:${parts[0]}.${parts[1]}}`;
        // Deeply nested: "itemId/slotId/nestedItemId/slotId2/..." -> nestedSlotCount
        return `{nestedSlotCount:${path}}`;
      }
      // Self / actor slot
      return `{slotCount:${n.data.slotId??"slot1"}}`;
    }
  },
  slot_field: {
    title:"Slot Item Field", color:"#1a4060", cat:"Sources",
    desc:"Field on item at index inside a slot (0=first)",
    inputs:[], outputs:[{id:"v",label:"Value",type:"value"}],
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
    inputs:[], outputs:[{id:"v",label:"Value",type:"value"}],
    fields:[
      {key:"uuid", label:"UUID",  type:"text",default:"",placeholder:"Item.xxxxx or drag item here"},
      {key:"path", label:"Field", type:"path",default:"system.hiddenFields.field"}
    ],
    compile:(n)=>{ const p=n.data.path??""; const u=n.data.uuid??""; return `{item:id:${u}${p?"."+p:""}}`; }
  },
  target_field: {
    title:"Target Field", color:"#1a4060", cat:"Sources",
    desc:"Read a field from the first targeted/selected token's actor",
    inputs:[], outputs:[{id:"v",label:"Value",type:"value"}],
    fields:[{key:"path",label:"Field",type:"path",default:"system.resources.hp.value"}],
    compile:(n)=>`{target.${n.data.path??""}}`
  },

  attr_mod: {
    title:"Attr Modifier", color:"#7a4a1a", cat:"Attribute",
    desc:"Calculates the modifier from an attribute score. Default formula: floor((score − 10) / 2). Connect Attr Score → score pin.",
    inputs:[{id:"score",label:"Score",type:"value.number"}],
    outputs:[{id:"mod",label:"Mod",type:"value.number"}],
    fields:[],
    compile:(_,i)=>{
      const s = i.score ?? "0";
      return `floor((${s}-10)/2)`;
    }
  },

  // Dice
  dice: {
    title:"Dice", color:"#7a4500", cat:"Dice",
    inputs:[{id:"count",label:"Count",type:"value.number"}],
    outputs:[{id:"v",label:"Formula",type:"value.string"}],
    fields:[
      {key:"count",label:"#",type:"number",default:1},
      {key:"die",  label:"Die",type:"select",default:"d6",options:["d4","d6","d8","d10","d12","d20","d100"]}
    ],
    dynamicPins:[
      { base:"add", label:"Add", max:10 },
      { base:"sub", label:"Sub", max:10 }
    ],
    compile:(n,i)=>{
      let f=`${i.count??n.data.count??1}${n.data.die??"d6"}`;
      for(let j=0;j<10;j++){
        const av=i[`add${j}`]; if(av!=null&&av!=="") f=`(${f}+(${av}))`;
        const sv=i[`sub${j}`]; if(sv!=null&&sv!=="") f=`(${f}-(${sv}))`;
      }
      return f;
    }
  },

  // Math
  add:  {title:"Add",   color:"#1a5c2a",cat:"Math",inputs:[{id:"a",label:"A"},{id:"b",label:"B"}],outputs:[{id:"v",label:"",type:"value.number"}],fields:[{key:"sep",label:"Sep",type:"text",default:""}],compile:(n,i)=>{ const sep=n.data.sep??""; return sep ? `(${i.a??""} + "${sep.replace(/"/g,'\\"')}" + ${i.b??""})` : `(${i.a??"0"}+${i.b??"0"})`; }},
  sub:  {title:"Sub",   color:"#1a5c2a",cat:"Math",inputs:[{id:"a",label:"A"},{id:"b",label:"B"}],outputs:[{id:"v",label:"",type:"value.number"}],fields:[],compile:(_,i)=>`(${i.a??"0"}-${i.b??"0"})`},
  mul:  {title:"Mul",   color:"#1a5c2a",cat:"Math",inputs:[{id:"a",label:"A"},{id:"b",label:"B"}],outputs:[{id:"v",label:"",type:"value.number"}],fields:[],compile:(_,i)=>`(${i.a??"0"}*${i.b??"0"})`},
  div:  {title:"Div",   color:"#1a5c2a",cat:"Math",inputs:[{id:"a",label:"A"},{id:"b",label:"B"}],outputs:[{id:"v",label:"",type:"value.number"}],fields:[],compile:(_,i)=>`(${i.a??"0"}/${i.b??"1"})`},
  floor:{title:"Floor", color:"#1a5c2a",cat:"Math",inputs:[{id:"a",label:"A"}],outputs:[{id:"v",label:"",type:"value.number"}],fields:[],compile:(_,i)=>`floor(${i.a??"0"})`},
  ceil: {title:"Ceil",  color:"#1a5c2a",cat:"Math",inputs:[{id:"a",label:"A"}],outputs:[{id:"v",label:"",type:"value.number"}],fields:[],compile:(_,i)=>`ceil(${i.a??"0"})`},
  round:{title:"Round", color:"#1a5c2a",cat:"Math",inputs:[{id:"a",label:"A"}],outputs:[{id:"v",label:"",type:"value.number"}],fields:[],compile:(_,i)=>`round(${i.a??"0"})`},
  max2: {title:"Max",   color:"#1a5c2a",cat:"Math",inputs:[{id:"a",label:"A"},{id:"b",label:"B"}],outputs:[{id:"v",label:"",type:"value.number"}],fields:[],compile:(_,i)=>`max(${i.a??"0"},${i.b??"0"})`},
  min2: {title:"Min",   color:"#1a5c2a",cat:"Math",inputs:[{id:"a",label:"A"},{id:"b",label:"B"}],outputs:[{id:"v",label:"",type:"value.number"}],fields:[],compile:(_,i)=>`min(${i.a??"0"},${i.b??"0"})`},
  abs:  {title:"Abs",   color:"#1a5c2a",cat:"Math",inputs:[{id:"a",label:"A"}],outputs:[{id:"v",label:"",type:"value.number"}],fields:[],compile:(_,i)=>`abs(${i.a??"0"})`},
  clamp:{title:"Clamp", color:"#1a5c2a",cat:"Math",
         inputs:[{id:"v",label:"Val"},{id:"lo",label:"Min"},{id:"hi",label:"Max"}],
         outputs:[{id:"v",label:"",type:"value.number"}],fields:[],
         compile:(_,i)=>`max(${i.lo??"0"},min(${i.hi??"0"},${i.v??"0"}))`},

  // Compare
  eq: {title:"==",color:"#6a1a6a",cat:"Compare",inputs:[{id:"a",label:"A"},{id:"b",label:"B"}],outputs:[{id:"v",label:"Bool",type:"value.bool"}],fields:[],compile:(_,i)=>`(${i.a??"0"}==${i.b??"0"})`},
  neq:{title:"≠", color:"#6a1a6a",cat:"Compare",inputs:[{id:"a",label:"A"},{id:"b",label:"B"}],outputs:[{id:"v",label:"Bool",type:"value.bool"}],fields:[],compile:(_,i)=>`(${i.a??"0"}!=${i.b??"0"})`},
  gt: {title:">", color:"#6a1a6a",cat:"Compare",inputs:[{id:"a",label:"A"},{id:"b",label:"B"}],outputs:[{id:"v",label:"Bool",type:"value.bool"}],fields:[],compile:(_,i)=>`(${i.a??"0"}>${i.b??"0"})`},
  lt: {title:"<", color:"#6a1a6a",cat:"Compare",inputs:[{id:"a",label:"A"},{id:"b",label:"B"}],outputs:[{id:"v",label:"Bool",type:"value.bool"}],fields:[],compile:(_,i)=>`(${i.a??"0"}<${i.b??"0"})`},
  gte:{title:">=",color:"#6a1a6a",cat:"Compare",inputs:[{id:"a",label:"A"},{id:"b",label:"B"}],outputs:[{id:"v",label:"Bool",type:"value.bool"}],fields:[],compile:(_,i)=>`(${i.a??"0"}>=${i.b??"0"})`},
  lte:{title:"<=",color:"#6a1a6a",cat:"Compare",inputs:[{id:"a",label:"A"},{id:"b",label:"B"}],outputs:[{id:"v",label:"Bool",type:"value.bool"}],fields:[],compile:(_,i)=>`(${i.a??"0"}<=${i.b??"0"})`},

  // Logic
  and:{title:"AND",color:"#6a1a1a",cat:"Logic",inputs:[{id:"a",label:"A"},{id:"b",label:"B"}],outputs:[{id:"v",label:"Bool",type:"value.bool"}],fields:[],compile:(_,i)=>`(${i.a??"0"}&&${i.b??"0"})`},
  or: {title:"OR", color:"#6a1a1a",cat:"Logic",inputs:[{id:"a",label:"A"},{id:"b",label:"B"}],outputs:[{id:"v",label:"Bool",type:"value.bool"}],fields:[],compile:(_,i)=>`(${i.a??"0"}||${i.b??"0"})`},
  not:{title:"NOT",color:"#6a1a1a",cat:"Logic",inputs:[{id:"a",label:"A"}],outputs:[{id:"v",label:"Bool",type:"value.bool"}],fields:[],compile:(_,i)=>`(!${i.a??"0"})`},

  // Actions
  act_roll_value: {
    title:"Roll → Value", color:"#8a4400", cat:"Actions",
    desc:"Rolls dice and forwards the numeric result as a value output. When Roll dialog is enabled, a Disadvantage/Normal/Advantage picker opens first, each option using the formula from its corresponding pin.",
    inputs:[
      {id:"exec",       label:"",              type:"exec"},
      {id:"formula",    label:"Formula",        type:"value"},
      {id:"advFormula", label:"Adv Formula",    type:"value"},
      {id:"disFormula", label:"Dis Formula",    type:"value"}
    ],
    outputs:[{id:"exec",label:"",type:"exec"},{id:"result",label:"Result",type:"value"}],
    fields:[
      {key:"formula",      label:"Formula",              type:"text",   default:"1d6"},
      {key:"flavor",       label:"Label",                type:"text",   default:"Roll"},
      {key:"toChat",       label:"To chat",              type:"select", default:"yes", options:["yes","no"]},
      {key:"rollDialogue", label:"Roll dialog",          type:"select", default:"no",  options:["no","yes"]},
      {key:"advFormula",   label:"Adv formula (pin>field)", type:"text", default:"",   placeholder:"e.g. 2d20kh1 + @mod"},
      {key:"disFormula",   label:"Dis formula (pin>field)", type:"text", default:"",   placeholder:"e.g. 2d20kl1 + @mod"}
    ],
    isAction:true,
    toAction:(n,inp)=>{
      const formula = inp.formula ?? n.data.formula ?? "1d6";
      // advFormula / disFormula: pin takes priority over field
      const advFormula = (inp.advFormula != null && inp.advFormula !== "") ? inp.advFormula : (n.data.advFormula ?? "");
      const disFormula = (inp.disFormula != null && inp.disFormula !== "") ? inp.disFormula : (n.data.disFormula ?? "");
      return {
        type:"rollValue", formula,
        flavor:       n.data.flavor ?? "Roll",
        toChat:       n.data.toChat !== "no",
        rollDialogue: n.data.rollDialogue === "yes",
        advFormula,
        disFormula
      };
    }
  },

  act_damage: {
    title:"Damage", color:"#8a1a1a", cat:"Actions",
    desc:"Apply damage to target HP. Reads target's system.resistances[damageType] and scales the amount (immune=×0, resist=×0.5, vulnerable=×2, numeric factor used as-is). halfOnSave × savePassed pin halves damage when the preceding save node passed.",
    inputs:[
      {id:"exec",label:"",type:"exec"},
      {id:"amount",label:"Amount",type:"value"},
      {id:"critMultiplier",label:"Crit ×",type:"value"},
      {id:"damageType",label:"Type",type:"value"},
      {id:"savePassed",label:"Save passed?",type:"value"}
    ],
    outputs:[{id:"exec",label:"",type:"exec"}],
    fields:[
      {key:"label",          label:"Label",      type:"text",   default:"Damage"},
      {key:"target",         label:"To",         type:"select", default:"token_target", options:["actor","token_target","selected_token","all_targets"]},
      {key:"hpPath",         label:"HP path",    type:"path",   default:"system.resources.hp.value"},
      {key:"damageType",     label:"Damage type", type:"text",  default:"", placeholder:"fire / cold / physical …"},
      {key:"critMultiplier", label:"Crit multiplier (default)", type:"text", default:"1"},
      {key:"halfOnSave",     label:"Half on save", type:"select", default:"no", options:["no","yes"]},
      {key:"postToChat",     label:"Chat card",  type:"select", default:"yes", options:["yes","no"]},
      {key:"autoApply",      label:"Auto-apply", type:"select", default:"no",  options:["no","yes"]},
      {key:"showApply",      label:"Apply btn",  type:"select", default:"yes", options:["yes","no"]}
    ],
    isAction:true,
    toAction:(n,inp)=>{
      const targetMode = n.data.target ?? "token_target";
      const tgtPfx = (targetMode==="token_target"||targetMode==="selected_token"||targetMode==="all_targets") ? "target." : "actor.";
      const amt   = inp.amount ?? 0;
      const mult  = inp.critMultiplier ?? n.data.critMultiplier ?? "1";
      const scaled = `(${amt})*(${mult})`;
      const dmgType = inp.damageType ?? n.data.damageType ?? "";
      const halfOnSave = n.data.halfOnSave === "yes";
      const savePassed = inp.savePassed ?? null;
      // Always emit chatDamage so resistance/halfOnSave/savePassed scaling
      const silent    = n.data.postToChat === "no";
      return {type:"chatDamage", amount:scaled, label:n.data.label??"Damage",
        target:targetMode, hpPath:n.data.hpPath??"system.resources.hp.value",
        damageType: dmgType, halfOnSave, savePassed,
        silent,
        showApply: !silent && n.data.showApply !== "no",
        autoApply: silent || n.data.autoApply === "yes"};
    }
  },

  act_heal: {
    title:"Heal", color:"#1a7a2a", cat:"Actions",
    desc:"Apply healing to target HP. postToChat:yes → chat card with Apply button. autoApply:yes → post to chat AND immediately heal (no click). postToChat:no → silent direct HP write.",
    inputs:[{id:"exec",label:"",type:"exec"},{id:"amount",label:"Amount",type:"value"}],
    outputs:[{id:"exec",label:"",type:"exec"}],
    fields:[
      {key:"label",      label:"Label",      type:"text",   default:"Healing"},
      {key:"target",     label:"To",         type:"select", default:"actor", options:["actor","token_target","selected_token","all_targets"]},
      {key:"hpPath",     label:"HP path",    type:"path",   default:"system.resources.hp.value"},
      {key:"postToChat", label:"Chat card",  type:"select", default:"no",  options:["yes","no"]},
      {key:"autoApply",  label:"Auto-apply", type:"select", default:"no",  options:["no","yes"]},
      {key:"showApply",  label:"Apply btn",  type:"select", default:"yes", options:["yes","no"]}
    ],
    isAction:true,
    toAction:(n,inp)=>{
      const targetMode = n.data.target ?? "actor";
      const tgtPfx = (targetMode==="token_target"||targetMode==="selected_token"||targetMode==="all_targets") ? "target." : "actor.";
      if (n.data.postToChat === "yes") {
        return {type:"chatHeal", amount:inp.amount??0, label:n.data.label??"Healing",
          target:targetMode, hpPath:n.data.hpPath??"system.resources.hp.value",
          showApply: n.data.showApply !== "no",
          autoApply: n.data.autoApply === "yes"};
      }
      return {type:"modifyField",
        target:`${tgtPfx}${n.data.hpPath??"system.resources.hp.value"}`,
        targetMode, delta:`+(${inp.amount??0})`, flavor:n.data.label??"Healing"};
    }
  },

  act_effect: {
    title:"Apply Effect", color:"#1a2a8a", cat:"Actions",
    desc:"Create or toggle an Active Effect on actor/target. Changes: JSON array [{key,value,mode}] where mode 2=Add 5=Override",
    inputs:[{id:"exec",label:"",type:"exec"},{id:"duration",label:"Rounds",type:"value"}],
    outputs:[{id:"exec",label:"",type:"exec"}],
    fields:[
      {key:"effectName", label:"Name (existing or new)", type:"effect-picker", default:"My Effect"},
      {key:"icon",       label:"Icon",        type:"text",   default:"icons/svg/aura.svg", placeholder:"icons/svg/aura.svg"},
      {key:"target",     label:"Target",      type:"select", default:"actor", options:["actor","token_target","selected_token"]},
      {key:"duration",   label:"Rounds (0=∞)",type:"number", default:0},
      {key:"changes",    label:"Changes JSON",type:"text",   default:"", placeholder:'[{"key":"system.attributes.str.value","value":"2","mode":2}]'},
      {key:"toggleMode", label:"Mode",        type:"select", default:"create", options:["create","toggle","ensure_on","ensure_off"]}
    ],
    isAction:true, wideNode:true,
    toAction:(n,inp)=>({
      type:"applyEffect",
      effectName: n.data.effectName ?? "My Effect",
      icon:        n.data.icon       ?? "icons/svg/aura.svg",
      target:      n.data.target     ?? "actor",
      duration:    inp.duration      ?? n.data.duration ?? 0,
      changes:     (() => { try { return JSON.parse(n.data.changes||"[]"); } catch { return []; } })(),
      toggleMode:  n.data.toggleMode ?? "create"
    })
  },

  act_effect_uuid: {
    title:"Apply Effect (UUID)", color:"#1a2a8a", cat:"Actions",
    desc:"Apply an existing Active Effect to actor/target by UUID. Pick from the dropdown — UUID is filled automatically.",
    inputs:[{id:"exec",label:"",type:"exec"},{id:"duration",label:"Rounds",type:"value"}],
    outputs:[{id:"exec",label:"",type:"exec"}],
    fields:[
      {key:"effectUuid", label:"Effect",       type:"effect-uuid-picker", default:""},
      {key:"target",     label:"Target",        type:"select", default:"actor", options:["actor","token_target","selected_token"]},
      {key:"toggleMode", label:"Mode",          type:"select", default:"create", options:["create","toggle","ensure_on","ensure_off"]},
      {key:"duration",   label:"Rounds (0=∞)",  type:"number", default:0}
    ],
    isAction:true, wideNode:true,
    toAction:(n,inp)=>({
      type:       "applyEffectByUuid",
      effectUuid: n.data.effectUuid ?? "",
      target:     n.data.target     ?? "actor",
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

  // Spellbook / Casting

  get_spell_slots: {
    title:"Spell Slots", color:"#1a4060", cat:"Sources",
    desc:"Get remaining spell slots for a given level on actor",
    inputs:[], outputs:[{id:"v",label:"Remaining",type:"value"}],
    fields:[{key:"level",label:"Spell Level",type:"number",default:1}],
    compile:(n)=>`{spellSlots:${n.data.level??1}}`
  },

  act_consume_slot: {
    title:"Consume Slot", color:"#6a2a6a", cat:"Actions",
    desc:"Consume one spell slot of given level from actor. Branches OK (slot available) or Empty (no slots left).",
    inputs:[{id:"exec",label:"",type:"exec"},{id:"level",label:"Level",type:"value"}],
    outputs:[
      {id:"ok",   label:"OK →",   type:"exec"},
      {id:"empty",label:"Empty →",type:"exec"}
    ],
    fields:[{key:"level",label:"Default Level",type:"number",default:1}],
    isConsumeSlot: true,
    toAction:(n,inp)=>({
      type:  "consumeSlot",
      level: inp.level ?? n.data.level ?? 1
    })
  },

  act_restore_slot: {
    title:"Restore Slot", color:"#1a4a2a", cat:"Actions",
    desc:"Restore one spell slot of given level on actor",
    inputs:[{id:"exec",label:"",type:"exec"},{id:"level",label:"Level",type:"value"}],
    outputs:[{id:"exec",label:"",type:"exec"}],
    fields:[{key:"level",label:"Default Level",type:"number",default:1}],
    isAction:true,
    toAction:(n,inp)=>({type:"restoreSlot", level:inp.level??n.data.level??1})
  },
  /** Legacy — hidden.  Use `chat_apply_effect` or `act_create_effect` instead. */
  act_apply_effect_template: {
    title:"Apply Effect Template (legacy)", color:"#1a2a8a", cat:"Actions",
    hidden:true,
    desc:"Legacy — use Create Effect or Chat Apply Effect instead.",
    inputs:[{id:"exec",label:"",type:"exec"}],
    outputs:[{id:"exec",label:"",type:"exec"}],
    fields:[
      {key:"templateName",label:"Template Name",  type:"text",  default:""},
      {key:"target",      label:"Target Override", type:"select",default:"use_template", options:["use_template","self","actor","token_target","selected_token","all_targets"]}
    ],
    isAction:true, wideNode:true,
    toAction:(n)=>({
      type:           "applyEffectTemplate",
      templateName:   n.data.templateName ?? "",
      targetOverride: n.data.target === "use_template" ? null : (n.data.target ?? null)
    })
  },

  act_modify: {
    title:"Modify Field", color:"#4a2a6a", cat:"Actions",
    desc:"Add / subtract / set any field on self, actor or target. Path can be fed dynamically (e.g. from Get Widget Path).",
    inputs:[
      {id:"exec",  label:"",        type:"exec"},
      {id:"amount",label:"Amount",  type:"value"},
      {id:"path",  label:"Path",    type:"value"}
    ],
    outputs:[{id:"exec",label:"",type:"exec"},{id:"newValue",label:"New Value",type:"value"}],
    fields:[
      {key:"where",label:"Where",type:"select",default:"self",options:["self","actor","token_target"]},
      {key:"path", label:"Field",type:"path",default:"system.uses.value"},
      {key:"op",   label:"Op",type:"select",default:"add",options:["add","subtract","set"]}
    ],
    isAction:true,
    toAction:(n,inp)=>{
      const pfx=n.data.where==="token_target"?"target.":n.data.where==="actor"?"actor.":n.data.where==="self"?"self.":"";
      const amt=inp.amount??0;
      const delta=n.data.op==="set"?null:n.data.op==="subtract"?`-(${amt})`:`+(${amt})`;
      const p = (inp.path!=null && inp.path!=="") ? String(inp.path) : (n.data.path??"");
      return {
        type:"modifyField",
        target:`${pfx}${p}`,
        rawPath:p,
        where:n.data.where,
        delta,
        setValue:n.data.op==="set"?String(amt):null
      };
    }
  },

  act_message: {
    title:"Message", color:"#4a4a1a", cat:"Actions",
    inputs:[{id:"exec",label:"",type:"exec"}],
    outputs:[{id:"exec",label:"",type:"exec"}],
    fields:[],
    isAction:true,
    // Dynamic text pins: text0..text9 -- always show one more than connected, up to 10
    dynamicPins:[{ base:"text", label:"Text", max:10 }],
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
    title:"Add Item", color:"#2a4a2a", cat:"Actions",
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
    title:"Add to Slot", color:"#2a4a2a", cat:"Actions",
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
    title:"Remove from Slot", color:"#6a2a2a", cat:"Actions",
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
    title:"Remove Item", color:"#6a2a2a", cat:"Actions",
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

  // Item / Slot deep-access nodes

  act_use_slot_item: {
    title:"Use Slot Item", color:"#2a5a3a", cat:"Actions",
    desc:"Calls item.use() on the item sitting at [index] in a slot. Slot is auto-indexed.",
    inputs:[{id:"exec",label:"",type:"exec"},{id:"index",label:"Index",type:"value"}],
    outputs:[{id:"exec",label:"",type:"exec"}],
    fields:[
      {key:"slotId", label:"Slot",         type:"slot-picker", default:"slot1"},
      {key:"index",  label:"Index (0=first)", type:"number",   default:0}
    ],
    isAction:true, wideNode:true,
    toAction:(n,inp)=>({type:"useSlotItem", slotId:n.data.slotId??"slot1", index:inp.index??n.data.index??0})
  },

  act_use_item: {
    title:"Use Item", color:"#2a5a3a", cat:"Actions",
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

  act_modify_slot_item_field: {
    title:"Modify Slot Item Field", color:"#4a2a6a", cat:"Actions",
    desc:"Add / subtract / set a field on the item sitting at [index] in a slot. Slot is auto-indexed.",
    inputs:[{id:"exec",label:"",type:"exec"},{id:"amount",label:"Amount",type:"value"},{id:"index",label:"Index",type:"value"}],
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
      path:   n.data.path??"",
      op:     n.data.op??"add",
      amount: inp.amount??0
    })
  },

  act_modify_inv_item_field: {
    title:"Modify Inventory Item Field", color:"#4a2a6a", cat:"Actions",
    desc:"Add / subtract / set a field on an actor-owned item. Item is auto-indexed from actor inventory.",
    inputs:[{id:"exec",label:"",type:"exec"},{id:"amount",label:"Amount",type:"value"}],
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
    toAction:(n,inp)=>({
      type:"modifyInvItemField",
      itemName: n.data.itemName??"",
      uuid:     n.data.uuid??"",
      category: n.data.category??"",
      index:    Number(n.data.index??0),
      path:     n.data.path??"",
      op:       n.data.op??"add",
      amount:   inp.amount??0
    })
  },

  // Value sources for item field reading

  inv_item_field: {
    title:"Inventory Item Field", color:"#1a4060", cat:"Sources",
    desc:"Read a field from an actor-owned item. Item is auto-indexed from actor inventory.",
    inputs:[], outputs:[{id:"v",label:"Value",type:"value"}],
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
    inputs:[], outputs:[{id:"v",label:"UUID (str)",type:"value"}],
    fields:[
      {key:"slotId", label:"Slot",          type:"slot-picker", default:"slot1"},
      {key:"index",  label:"Index (0=first)", type:"number",    default:0}
    ],
    compile:(n)=>`{slotUuid:${n.data.slotId??"slot1"}.${n.data.index??0}}`
  },

  get_actor_slot_id: {
    title:"Get Actor Slot ID", color:"#1a4060", cat:"Sources",
    desc:"Reference a slot by ID — connect to the Item Slot pin on Slot Count, Add/Remove from Inv Item Slot nodes to dynamically select which slot to operate on.",
    inputs:[], outputs:[{id:"v",label:"Item Slot",type:"value"}],
    fields:[{key:"slotId",label:"Slot ID",type:"slot-picker",default:"slot1"}],
    compile:(n)=>(n.data.slotId??"slot1")
  },

  // Inventory Item → Slot cross-access

  inv_item_slot_count: {
    title:"Inv Item Slot Count", color:"#1a4060", cat:"Sources",
    desc:"Count of items in a slot on an actor-owned inventory item. Item and slot are auto-indexed. Connect Get Actor Slot ID to override slot.",
    inputs:[{id:"itemSlot",label:"Item Slot",type:"value"}],
    outputs:[{id:"v",label:"Count",type:"value"}],
    fields:[
      {key:"itemName", label:"Item",                    type:"item-picker", default:""},
      {key:"uuid",     label:"…or UUID",                type:"text",        default:"", placeholder:"drag item here"},
      {key:"slotId",   label:"Slot on that item",       type:"slot-picker", default:"slot1"}
    ],
    compile:(n,i)=>`{invItemSlotCount:${n.data.uuid||n.data.itemName||"?"}.${i.itemSlot??n.data.slotId??"slot1"}}`
  },

  act_remove_from_inv_item_slot: {
    title:"Remove from Inv Item Slot", color:"#6a2a2a", cat:"Actions",
    desc:"Find an item in actor's inventory, then remove one item from its slot. Both item and slot are auto-indexed — just pick from dropdowns. Connect Get Actor Slot ID to Item Slot pin to override.",
    inputs:[{id:"exec",label:"",type:"exec"},{id:"index",label:"Index",type:"value"},{id:"itemSlot",label:"Item Slot",type:"value"}],
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
    title:"Add to Inv Item Slot", color:"#2a4a2a", cat:"Actions",
    desc:"Find a container item and add another inventory item into its slot. Pick container from dropdown, drag item to add from sidebar.",
    inputs:[{id:"exec",label:"",type:"exec"},{id:"itemSlot",label:"Item Slot",type:"value"}],
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
    title:"Attack Check", color:"#8a3a00", cat:"Actions",
    desc:"Roll attack vs target AC. Branches into Hit / Miss / Crit exec paths and posts result to chat. Roll Result carries the raw dice total; Margin = total − AC.",
    inputs:[
      {id:"exec",   label:"",        type:"exec"},
      {id:"formula",label:"Attack",  type:"value"},
      {id:"bonus",  label:"Bonus",   type:"value"}
    ],
    outputs:[
      {id:"hit",    label:"Hit →",      type:"exec"},
      {id:"miss",   label:"Miss →",     type:"exec"},
      {id:"crit",   label:"Crit →",     type:"exec"},
      {id:"result", label:"Roll Result",type:"value"},
      {id:"margin", label:"Margin",     type:"value"}
    ],
    fields:[
      {key:"formula",  label:"Roll",      type:"text",   default:"1d20"},
      {key:"bonus",    label:"Bonus",     type:"text",   default:"0"},
      {key:"acPath",   label:"AC path",   type:"path",   default:"system.attributes.ac.value"},
      {key:"critFace", label:"Crit on",   type:"number", default:20},
      {key:"flavor",   label:"Label",     type:"text",   default:"Attack"}
    ],
    isAttackBranch: true,
    toAction:(n,inp)=>({
      type:      "attackCheck",
      formula:   inp.formula ?? n.data.formula ?? "1d20",
      bonus:     inp.bonus   ?? n.data.bonus   ?? "0",
      acPath:    n.data.acPath  ?? "system.attributes.ac.value",
      critFace:  Number(n.data.critFace ?? 20),
      flavor:    n.data.flavor  ?? "Attack"
    })
  },

  // Generic Roll Check (roll-over / roll-under / meet-and-beat / troika / custom)
  act_roll_check: {
    title:"Roll Check", color:"#8a4400", cat:"Actions",
    desc:"Generic roll with a chosen comparison rule: roll_over (roll ≥ DC), roll_under (≤ DC), meet_and_beat (> DC, tie = fail), troika (success when roll is higher OR lower than target, depending on targetRule), custom (your own condition via {roll}/{dc}/{margin}). Branches into pass/fail and returns Roll / Margin. opposed:yes — after the initiator rolls, N 'Roll as Opponent' buttons appear in chat; the higher total wins (tie goes to the initiator).",
    inputs:[
      {id:"exec",           label:"",           type:"exec"},
      {id:"formula",        label:"Formula",    type:"value"},
      {id:"dc",             label:"DC",          type:"value"},
      {id:"modifier",       label:"Modifier",    type:"value"},
      {id:"advFormula",     label:"Adv Formula", type:"value"},
      {id:"disFormula",     label:"Dis Formula", type:"value"},
      {id:"opposedCount",   label:"Opposed N",   type:"value"},
      {id:"opposedFormula", label:"Opposed Formula", type:"value"}
    ],
    outputs:[
      {id:"pass",        label:"Pass →",    type:"exec"},
      {id:"fail",        label:"Fail →",    type:"exec"},
      {id:"result",      label:"Roll",      type:"value"},
      {id:"margin",      label:"Margin",    type:"value"},
      {id:"youWon",      label:"You Won →", type:"exec"},
      {id:"youLost",     label:"You Lost →",type:"exec"},
      {id:"winnerRoll",  label:"Winner Roll", type:"value"}
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
      {key:"rollDialogue",   label:"Roll dialog",   type:"select", default:"no", options:["no","yes"]},
      {key:"opposed",        label:"Opposed",   type:"select", default:"no", options:["no","yes"]},
      {key:"opposedCount",   label:"Opposed N", type:"text",   default:"1"},
      {key:"opposedFormula", label:"Opposed Formula", type:"text", default:"1d20"}
    ],
    isSaveBranch:true,
    toAction:(n,inp)=>({
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
      rollDialogue: n.data.rollDialogue === "yes",
      opposed:       n.data.opposed === "yes",
      opposedCount:  inp.opposedCount   ?? n.data.opposedCount   ?? "1",
      opposedFormula: inp.opposedFormula ?? n.data.opposedFormula ?? "1d20"
    })
  },

  // Tiered Roll (PbtA / Blades-style threshold branches)
  act_tiered_roll: {
    title:"Tiered Roll", color:"#8a4400", cat:"Actions",
    desc:"Rolls dice and routes exec into one of 4 tiers by thresholds. PbtA 2d6 example: T1 ≤6 (miss), T2 7-9 (partial), T3 10+ (full). Blades example: T1 crit fail, T2 partial, T3 full, T4 crit. Thresholds are arbitrary lower-bounds (inclusive). If result ≥ threshold of a tier, it takes that tier (top-down). Raw result is emitted on Roll.",
    wideNode:true,
    inputs:[
      {id:"exec",    label:"",         type:"exec"},
      {id:"formula", label:"Formula",  type:"value"}
    ],
    outputs:[
      {id:"tier0",  label:"Tier 1 →", type:"exec"},
      {id:"tier1",  label:"Tier 2 →", type:"exec"},
      {id:"tier2",  label:"Tier 3 →", type:"exec"},
      {id:"tier3",  label:"Tier 4 →", type:"exec"},
      {id:"result", label:"Roll",     type:"value"}
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
      {key:"toChat",   label:"To chat",       type:"select", default:"yes", options:["yes","no"]}
    ],
    isTieredBranch:true,
    toAction:(n,inp)=>({
      type:    "tieredRoll",
      formula: inp.formula ?? n.data.formula ?? "2d6",
      tiers: [
        { min:n.data.t1Min ?? "-999", label:n.data.t1Label ?? "Tier 1" },
        { min:n.data.t2Min ?? "7",    label:n.data.t2Label ?? "Tier 2" },
        { min:n.data.t3Min ?? "10",   label:n.data.t3Label ?? "Tier 3" },
        { min:n.data.t4Min ?? "12",   label:n.data.t4Label ?? "Tier 4" }
      ],
      flavor: n.data.flavor ?? "Roll",
      toChat: n.data.toChat !== "no"
    })
  },

  // Dice Pool (count dice, count successes ≥ target)
  act_dice_pool: {
    title:"Dice Pool", color:"#8a4400", cat:"Actions",
    desc:"Rolls N dice of a chosen size and counts successes by comparison rule. Outputs: pass/fail based on `required`, Successes, Botches, Raw. WoD example: count=5, die=10, target=8, compare=ge → count d10s that rolled ≥8. Botches = how many d10s equalled botchFace.",
    inputs:[
      {id:"exec",   label:"",         type:"exec"},
      {id:"count",  label:"Count",    type:"value"},
      {id:"target", label:"Target",   type:"value"}
    ],
    outputs:[
      {id:"pass",      label:"Pass →",     type:"exec"},
      {id:"fail",      label:"Fail →",     type:"exec"},
      {id:"successes", label:"Successes",  type:"value"},
      {id:"botches",   label:"Botches",    type:"value"},
      {id:"result",    label:"Total",      type:"value"}
    ],
    fields:[
      {key:"count",     label:"Count",       type:"text",   default:"5"},
      {key:"die",       label:"Die faces",   type:"number", default:10},
      {key:"target",    label:"Target",      type:"text",   default:"8"},
      {key:"compare",   label:"Compare",     type:"select", default:"ge",  options:["ge","le","eq"]},
      {key:"required",  label:"Pass if ≥",    type:"number", default:1},
      {key:"botchFace", label:"Botch on face",type:"number", default:1},
      {key:"flavor",    label:"Label",       type:"text",   default:"Dice Pool"},
      {key:"toChat",    label:"To chat",     type:"select", default:"yes", options:["yes","no"]}
    ],
    isSaveBranch:true,
    toAction:(n,inp)=>({
      type:      "dicePool",
      count:     inp.count  ?? n.data.count  ?? "5",
      die:       Number(n.data.die ?? 10),
      target:    inp.target ?? n.data.target ?? "8",
      compare:   n.data.compare ?? "ge",
      required:  Number(n.data.required ?? 1),
      botchFace: Number(n.data.botchFace ?? 1),
      flavor:    n.data.flavor ?? "Dice Pool",
      toChat:    n.data.toChat !== "no"
    })
  },

  // Token-based resolution (diceless systems, metacurrency)
  act_spend_token: {
    title:"Spend Token", color:"#4a2a6a", cat:"Actions",
    desc:"Spends N tokens from the given resource. If there aren't enough tokens, exec takes the Empty branch. Works like Consume Resource but with branching.",
    inputs:[
      {id:"exec",   label:"",       type:"exec"},
      {id:"amount", label:"Amount", type:"value"}
    ],
    outputs:[
      {id:"ok",       label:"Spent →",   type:"exec"},
      {id:"empty",    label:"Empty →",   type:"exec"},
      {id:"remaining",label:"Remaining", type:"value"}
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
      where:  n.data.where ?? "self",
      path:   n.data.path  ?? "system.resources.tokens.value",
      flavor: n.data.flavor ?? "Spend Token"
    })
  },

  act_gain_token: {
    title:"Gain Token", color:"#2a5a4a", cat:"Actions",
    desc:"Adds N tokens to the resource. Handy for FATE points / Drama dice / stress.",
    inputs:[
      {id:"exec",   label:"",       type:"exec"},
      {id:"amount", label:"Amount", type:"value"}
    ],
    outputs:[{id:"exec",label:"",type:"exec"},{id:"newValue",label:"New Value",type:"value"}],
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
      where:  n.data.where ?? "self",
      path:   n.data.path  ?? "system.resources.tokens.value",
      flavor: n.data.flavor ?? "Gain Token"
    })
  },

  get_token_count: {
    title:"Get Token Count", color:"#1a4060", cat:"Sources",
    desc:"Pure source node: reads the current token count at the given resource path.",
    inputs:[], outputs:[{id:"v",label:"Count",type:"value"}],
    fields:[
      {key:"where",label:"Where",    type:"select",default:"self",options:["self","actor","token_target"]},
      {key:"path", label:"Token path",type:"path", default:"system.resources.tokens.value"}
    ],
    compile:(n)=>{
      const pfx = n.data.where === "token_target" ? "target." : n.data.where === "actor" ? "actor." : "";
      return `{${pfx}${n.data.path ?? "system.resources.tokens.value"}}`;
    }
  },

  // Progression (roll, compare with previous, branch)
  act_progression: {
    title:"Progression Roll", color:"#8a4400", cat:"Actions",
    desc:"Catches a fresh roll, compares with the previous value stored at History Path, and branches on Higher / Lower / Equal / No History. Writes the new roll back into History Path so next call compares against it. Useful for escalating dice, PbtA session clocks, 'raise / see' mechanics, etc.",
    wideNode:true,
    inputs:[
      {id:"exec",       label:"",              type:"exec"},
      {id:"formula",    label:"Formula",       type:"value"},
      {id:"historyPath",label:"History Path",  type:"value"}
    ],
    outputs:[
      {id:"higher",   label:"Higher →",  type:"exec"},
      {id:"lower",    label:"Lower →",   type:"exec"},
      {id:"equal",    label:"Equal →",   type:"exec"},
      {id:"noHistory",label:"First →",   type:"exec"},
      {id:"value",    label:"Value",     type:"value"},
      {id:"previous", label:"Previous",  type:"value"}
    ],
    fields:[
      {key:"formula",     label:"Formula",          type:"text", default:"1d6"},
      {key:"historyPath", label:"History Path",     type:"path", default:"system.flags.progressionDie"},
      {key:"flavor",      label:"Flavor",           type:"text", default:"Progression"},
      {key:"toChat",      label:"Post to chat",     type:"select", default:"yes", options:["yes","no"]}
    ],
    isProgressionBranch:true,
    toAction:(n,inp)=>({
      type:        "progression",
      formula:     inp.formula     ?? n.data.formula     ?? "1d6",
      historyPath: inp.historyPath ?? n.data.historyPath ?? "system.flags.progressionDie",
      flavor:      n.data.flavor   ?? "Progression",
      toChat:      n.data.toChat   !== "no"
    })
  },

  // Throw dice (visual scatter on canvas / sheet)
  act_throw_on_canvas: {
    title:"Throw on Canvas", color:"#8a4400", cat:"Actions",
    desc:"Rolls N dice and visually scatters them on the canvas (PIXI overlay on the active scene). Results are available as successes/total and via {__lastSuccesses}/{__lastRoll}.",
    inputs:[
      {id:"exec",   label:"",        type:"exec"},
      {id:"count",  label:"Count",   type:"value"},
      {id:"target", label:"Target",  type:"value"}
    ],
    outputs:[
      {id:"pass",      label:"Pass →",     type:"exec"},
      {id:"fail",      label:"Fail →",     type:"exec"},
      {id:"successes", label:"Successes",  type:"value"},
      {id:"total",     label:"Total",      type:"value"}
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
      {key:"toChat",   label:"To chat",      type:"select", default:"yes", options:["yes","no"]}
    ],
    isSaveBranch:true,
    toAction:(n,inp)=>({
      type:     "throwOnCanvas",
      count:    inp.count  ?? n.data.count  ?? "3",
      die:      Number(n.data.die ?? 6),
      target:   inp.target ?? n.data.target ?? "4",
      compare:  n.data.compare ?? "ge",
      required: Number(n.data.required ?? 1),
      area:     Number(n.data.area ?? 300),
      duration: Number(n.data.duration ?? 6),
      flavor:   n.data.flavor ?? "Throw",
      toChat:   n.data.toChat !== "no"
    })
  },

  act_throw_on_sheet: {
    title:"Throw on Sheet", color:"#8a4400", cat:"Actions",
    desc:"Rolls N dice and visually scatters them over the DOM of the current actor sheet. Results are available as successes/total and via {__lastSuccesses}/{__lastRoll}.",
    inputs:[
      {id:"exec",   label:"",        type:"exec"},
      {id:"count",  label:"Count",   type:"value"},
      {id:"target", label:"Target",  type:"value"}
    ],
    outputs:[
      {id:"pass",      label:"Pass →",     type:"exec"},
      {id:"fail",      label:"Fail →",     type:"exec"},
      {id:"successes", label:"Successes",  type:"value"},
      {id:"total",     label:"Total",      type:"value"}
    ],
    fields:[
      {key:"count",    label:"Count",      type:"text",   default:"3"},
      {key:"die",      label:"Die faces",  type:"number", default:6},
      {key:"target",   label:"Target",     type:"text",   default:"4"},
      {key:"compare",  label:"Compare",    type:"select", default:"ge", options:["ge","le","eq"]},
      {key:"required", label:"Pass if ≥",   type:"number", default:1},
      {key:"duration", label:"Duration (s)",type:"number", default:6},
      {key:"flavor",   label:"Label",      type:"text",   default:"Throw"},
      {key:"toChat",   label:"To chat",      type:"select", default:"yes", options:["yes","no"]}
    ],
    isSaveBranch:true,
    toAction:(n,inp)=>({
      type:     "throwOnSheet",
      count:    inp.count  ?? n.data.count  ?? "3",
      die:      Number(n.data.die ?? 6),
      target:   inp.target ?? n.data.target ?? "4",
      compare:  n.data.compare ?? "ge",
      required: Number(n.data.required ?? 1),
      duration: Number(n.data.duration ?? 6),
      flavor:   n.data.flavor ?? "Throw",
      toChat:   n.data.toChat !== "no"
    })
  },

  // Flow additions

  /** Switch — routes exec to one of N labeled branches based on a value match */
  switch_node: {
    title:"Switch", color:"#8a2a8a", cat:"Flow",
    desc:"Compare Value against each Case label and jump to the matching exec output. Falls through to Default if no match.",
    wideNode:true,
    inputs:[
      {id:"exec",  label:"",        type:"exec"},
      {id:"value", label:"Value",   type:"value"}
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
    title:"Dialog Switch", color:"#c05a20", cat:"Flow",
    desc:"Show a dialog with 2-8 named options. The player picks one and that exec branch fires. Outputs are named via fields.",
    wideNode:true,
    inputs:[{id:"exec", label:"", type:"exec"}],
    // All 8 possible exec outputs -- the graph renders only those up to count
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
    // Emits the number of active outputs so the graph renderer can hide inactive ones
    activeOutputCount: (n) => Math.max(2, Math.min(8, parseInt(n.data?.count) || 2)),
    toAction:(n, inp, compiler) => {
      const count = Math.max(2, Math.min(8, parseInt(n.data?.count) || 2));
      const outputs = [];
      for (let i = 0; i < count; i++) {
        outputs.push({
          label:   n.data[`label${i}`] ?? `Option ${i+1}`,
          // Sub-actions are compiled from the connected exec chain for each output pin
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

  /** While Loop — runs loop body while Condition is truthy */
  while_loop: {
    title:"While Loop", color:"#1a5a7a", cat:"Flow",
    desc:"Execute Loop body while Condition is truthy. Re-evaluates the condition each iteration. Done fires when the condition becomes false or Max Iterations is reached.",
    inputs:[
      {id:"exec",      label:"",            type:"exec"},
      {id:"condition", label:"Condition",   type:"value"},
      {id:"maxIter",   label:"Max Iter",    type:"value"}
    ],
    outputs:[
      {id:"loop",  label:"Loop →",  type:"exec"},
      {id:"index", label:"Index",   type:"value"},
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


  // Effect creation nodes

  act_create_effect: {
    title:"Create Effect", color:"#1a4a8a", cat:"Effects", wideNode:true,
    desc:"Creates an ActiveEffect on the target actor. Configure name, icon, duration, and attribute changes. Target resolves from pin or falls back to selected tokens / self.",
    inputs:[
      {id:"exec",     label:"",             type:"exec"},
      {id:"target",   label:"Target",       type:"value"},
      {id:"duration", label:"Duration (rds)", type:"value"},
      {id:"name",     label:"Effect name",  type:"value"}
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

  act_remove_effect: {
    title:"Remove Effect", color:"#8a1a2a", cat:"Effects",
    desc:"Removes all ActiveEffects matching the given name from the target actor.",
    inputs:[
      {id:"exec",   label:"",           type:"exec"},
      {id:"target", label:"Target",     type:"value"},
      {id:"name",   label:"Effect name", type:"value"}
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
      {id:"target", label:"Target",     type:"value"},
      {id:"name",   label:"Effect name", type:"value"}
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
      {id:"target", label:"Target", type:"value"},
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

  // Aura nodes
  act_place_aura: {
    title:"Place Aura — With Effect", color:"#1a6a4a", cat:"Effects", wideNode:true,
    desc:"Places a Scene Region attached to the owner token. Tokens inside receive the named Active Effect automatically (hook-based enter/exit); leaving tokens lose it (configurable).",
    inputs:[
      {id:"exec",     label:"",          type:"exec"},
      {id:"owner",    label:"Owner",     type:"value"},
      {id:"size",     label:"Size (ft)", type:"value"},
      {id:"name",     label:"Effect",    type:"value"}
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

  // Damage Aura -- periodic damage to tokens inside.
  act_place_aura_damage: {
    title:"Place Aura — Damage", color:"#7a2a1a", cat:"Effects", wideNode:true,
    desc:"Attaches a region to the owner; rolls damage against tokens inside (onEnter / eachTurn / both). Respects system.resistances[damageType]. Chat card + visibility configurable.",
    inputs:[
      {id:"exec",    label:"",            type:"exec"},
      {id:"owner",   label:"Owner",       type:"value"},
      {id:"size",    label:"Size (ft)",   type:"value"},
      {id:"formula", label:"Formula",     type:"value.string"},
      {id:"rounds",  label:"Lifetime",    type:"value"}
    ],
    outputs:[{id:"exec", label:"→", type:"exec"}],
    fields:[
      {key:"shape",            label:"Shape",              type:"select", options:["emanation","circle","rectangle","ellipse","cone"], default:"emanation"},
      {key:"size",             label:"Size (ft)",          type:"number", default:10},
      {key:"angle",            label:"Cone angle (deg)",   type:"number", default:53.13},
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
      {key:"bonusFormula",     label:"Bonus formula (+)",  type:"text",   default:"", placeholder:"e.g. @bonus or 1d4"},
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
      name:            n.data.name    ?? "Damage Aura",
      icon:            n.data.icon    ?? "icons/svg/aura.svg",
      owner:           inp.owner      ?? n.data.owner   ?? "self",
      auraKey:         n.data.auraKey ?? "damage-aura",
      formula:         inp.formula    ?? n.data.formula ?? "1d6",
      bonusFormula:    n.data.bonusFormula ?? "",
      damageType:      n.data.damageType ?? "",
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

  // Heal Aura -- periodic healing to tokens inside.
  act_place_aura_heal: {
    title:"Place Aura — Heal", color:"#1a6a3a", cat:"Effects", wideNode:true,
    desc:"Attaches a region to the owner; heals tokens inside (onEnter / eachTurn / both). HP path configurable. Chat card + visibility configurable.",
    inputs:[
      {id:"exec",    label:"",          type:"exec"},
      {id:"owner",   label:"Owner",     type:"value"},
      {id:"size",    label:"Size (ft)", type:"value"},
      {id:"formula", label:"Formula",   type:"value.string"},
      {id:"rounds",  label:"Lifetime",  type:"value"}
    ],
    outputs:[{id:"exec", label:"→", type:"exec"}],
    fields:[
      {key:"shape",           label:"Shape",            type:"select", options:["emanation","circle","rectangle","ellipse","cone"], default:"emanation"},
      {key:"size",            label:"Size (ft)",        type:"number", default:10},
      {key:"angle",           label:"Cone angle (deg)", type:"number", default:53.13},
      {key:"name",            label:"Aura name",        type:"text",   default:"Heal Aura"},
      {key:"icon",            label:"Icon",             type:"text",   default:"icons/svg/aura.svg"},
      {key:"owner",           label:"Owner",            type:"select", default:"self", options:["self","selected_token","token_target"]},
      {key:"auraKey",         label:"Aura key",         type:"text",   default:"heal-aura"},
      {key:"formula",         label:"Heal formula",     type:"text",   default:"1d4"},
      {key:"hpPath",          label:"HP path",          type:"path",   default:"system.resources.hp.value"},
      {key:"hpMode",          label:"HP mode",          type:"select", options:["add","set"], default:"add"},
      {key:"tickMode",        label:"When",             type:"select", options:["onEnter","onEnter+eachTurn","eachTurn"], default:"onEnter+eachTurn"},
      {key:"showInChat",      label:"Show in chat",     type:"select", options:["yes","no"], default:"yes"},
      {key:"bonusFormula",    label:"Bonus formula (+)", type:"text",  default:"", placeholder:"e.g. @bonus or 1d4"},
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
      name:            n.data.name     ?? "Heal Aura",
      icon:            n.data.icon     ?? "icons/svg/aura.svg",
      owner:           inp.owner       ?? n.data.owner   ?? "self",
      auraKey:         n.data.auraKey  ?? "heal-aura",
      formula:         inp.formula     ?? n.data.formula ?? "1d4",
      bonusFormula:    n.data.bonusFormula ?? "",
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

  // Save Aura w/ Effect -- each tick rolls a save, fail -> effect.
  /** Save Aura w/ Effect — each tick rolls a save, fail → effect. */
  act_place_aura_save_effect: {
    title:"Place Aura — Save → Effect", color:"#6a4a1a", cat:"Effects", wideNode:true,
    desc:"Attaches a region to the owner; tokens inside roll a save (onEnter / eachTurn / both). On failure the named Active Effect is applied. On leave the effect is removed (configurable).",
    inputs:[
      {id:"exec",   label:"",          type:"exec"},
      {id:"owner",  label:"Owner",     type:"value"},
      {id:"size",   label:"Size (ft)", type:"value"},
      {id:"dc",     label:"DC",        type:"value"}
    ],
    outputs:[{id:"exec", label:"→", type:"exec"}],
    fields:[
      {key:"shape",             label:"Shape",             type:"select", options:["emanation","circle","rectangle","ellipse","cone"], default:"emanation"},
      {key:"size",              label:"Size (ft)",         type:"number", default:10},
      {key:"angle",             label:"Cone angle (deg)",  type:"number", default:53.13},
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
      {key:"bonusFormula",      label:"Bonus formula (+)", type:"text",   default:"", placeholder:"e.g. @bonus or 1d4"},
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
      name:              n.data.name     ?? "Aura Effect",
      icon:              n.data.icon     ?? "icons/svg/aura.svg",
      owner:             inp.owner       ?? n.data.owner    ?? "self",
      auraKey:           n.data.auraKey  ?? "save-aura",
      saveAttr:          n.data.saveAttr ?? "system.attributes.dex.value",
      dc:                (v => Number.isFinite(v) ? v : 15)(Number(inp.dc ?? n.data.dc ?? 15)),
      flavor:            n.data.flavor   ?? "Saving Throw",
      advMode:           n.data.advMode ?? "none",
      advFormula:        n.data.advFormula ?? "",
      disFormula:        n.data.disFormula ?? "",
      bonusFormula:      n.data.bonusFormula ?? "",
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

  // AoE (free placement) variants -- post chat card w/ Place button
  /** AoE w/ Effect (no check) — places a region; while inside, Active Effect. */
  act_place_aoe_effect: {
    title:"Chat AoE — With Effect", color:"#1a4a8a", cat:"AoE", wideNode:true,
    desc:"Posts a chat card with a 'Place Template' button. Once placed, tokens inside gain the named Active Effect (removed on leave, configurable).",
    inputs:[
      {id:"exec",  label:"",          type:"exec"},
      {id:"size",  label:"Size (ft)", type:"value"},
      {id:"rounds",label:"Lifetime",  type:"value"}
    ],
    outputs:[{id:"exec", label:"→", type:"exec"}],
    fields:[
      {key:"cardTitle",         label:"Card title",       type:"text",   default:"Area of Effect"},
      {key:"shape",             label:"Shape",            type:"select", options:["circle","cone","ray","rect","ellipse"], default:"circle"},
      {key:"size",              label:"Size (ft)",        type:"number", default:20},
      {key:"angle",             label:"Cone angle (deg)", type:"number", default:53.13},
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
      name:              n.data.name      ?? "AoE Effect",
      icon:              n.data.icon      ?? "icons/svg/aura.svg",
      deactivateOnLeave: (n.data.deactivateOnLeave ?? "yes") === "yes",
      persist:           (n.data.persist ?? "yes") === "yes",
      rounds:            Number(inp.rounds ?? n.data.rounds ?? 0) || 0,
      visibility:        n.data.visibility ?? "everyone",
      conditionEffect:   n.data.conditionEffect ?? ""
    })
  },

  // AoE Damage -- chat card, place, damages tokens inside.
  act_place_aoe_damage: {
    title:"Chat AoE — Damage", color:"#7a3a1a", cat:"AoE", wideNode:true,
    desc:"Posts a chat card with a 'Place Template' button. Once placed, rolls damage against tokens inside (onEnter / eachTurn / both). Respects resistances.",
    inputs:[
      {id:"exec",    label:"",          type:"exec"},
      {id:"size",    label:"Size (ft)", type:"value"},
      {id:"formula", label:"Formula",   type:"value.string"},
      {id:"rounds",  label:"Lifetime",  type:"value"}
    ],
    outputs:[{id:"exec", label:"→", type:"exec"}],
    fields:[
      {key:"cardTitle",  label:"Card title",       type:"text",   default:"Damaging AoE"},
      {key:"shape",      label:"Shape",            type:"select", options:["circle","cone","ray","rect","ellipse"], default:"circle"},
      {key:"size",       label:"Size (ft)",        type:"number", default:20},
      {key:"angle",      label:"Cone angle (deg)", type:"number", default:53.13},
      {key:"name",       label:"Name",             type:"text",   default:"Damage AoE"},
      {key:"formula",    label:"Damage formula",   type:"text",   default:"2d6"},
      {key:"damageType", label:"Damage type",      type:"text",   default:"fire"},
      {key:"hpPath",     label:"HP path",          type:"path",   default:"system.resources.hp.value"},
      {key:"hpMode",     label:"HP mode",          type:"select", options:["add","set"], default:"add"},
      {key:"tickMode",   label:"When",             type:"select", options:["onEnter","onEnter+eachTurn","eachTurn"], default:"onEnter"},
      {key:"showInChat", label:"Show in chat",     type:"select", options:["yes","no"], default:"yes"},
      {key:"bonusFormula", label:"Bonus formula (+)", type:"text", default:"", placeholder:"e.g. @bonus or 1d4"},
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
      name:         n.data.name      ?? "Damage AoE",
      formula:      inp.formula      ?? n.data.formula ?? "2d6",
      bonusFormula: n.data.bonusFormula ?? "",
      damageType:   n.data.damageType ?? "",
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

  // AoE Heal -- chat card, place, heals tokens inside.
  act_place_aoe_heal: {
    title:"Chat AoE — Heal", color:"#1a6a3a", cat:"AoE", wideNode:true,
    desc:"Posts a chat card with a 'Place Template' button. Once placed, heals tokens inside (onEnter / eachTurn / both).",
    inputs:[
      {id:"exec",    label:"",          type:"exec"},
      {id:"size",    label:"Size (ft)", type:"value"},
      {id:"formula", label:"Formula",   type:"value.string"},
      {id:"rounds",  label:"Lifetime",  type:"value"}
    ],
    outputs:[{id:"exec", label:"→", type:"exec"}],
    fields:[
      {key:"cardTitle",  label:"Card title",       type:"text",   default:"Healing AoE"},
      {key:"shape",      label:"Shape",            type:"select", options:["circle","cone","ray","rect","ellipse"], default:"circle"},
      {key:"size",       label:"Size (ft)",        type:"number", default:20},
      {key:"angle",      label:"Cone angle (deg)", type:"number", default:53.13},
      {key:"name",       label:"Name",             type:"text",   default:"Heal AoE"},
      {key:"formula",    label:"Heal formula",     type:"text",   default:"2d4"},
      {key:"hpPath",     label:"HP path",          type:"path",   default:"system.resources.hp.value"},
      {key:"hpMode",     label:"HP mode",          type:"select", options:["add","set"], default:"add"},
      {key:"tickMode",   label:"When",             type:"select", options:["onEnter","onEnter+eachTurn","eachTurn"], default:"onEnter"},
      {key:"showInChat", label:"Show in chat",     type:"select", options:["yes","no"], default:"yes"},
      {key:"bonusFormula", label:"Bonus formula (+)", type:"text", default:"", placeholder:"e.g. @bonus or 1d4"},
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
      name:         n.data.name      ?? "Heal AoE",
      formula:      inp.formula      ?? n.data.formula ?? "2d4",
      bonusFormula: n.data.bonusFormula ?? "",
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

  // AoE Save -> Effect -- chat card, place, save each tick, fail -> effect.
  act_place_aoe_save_effect: {
    title:"Chat AoE — Save → Effect", color:"#6a2a8a", cat:"AoE", wideNode:true,
    desc:"Posts a chat card with a 'Place Template' button. Once placed, tokens inside roll a save (onEnter / eachTurn / both); on failure, the named Active Effect is applied. On leave the effect is removed (configurable).",
    inputs:[
      {id:"exec",  label:"",          type:"exec"},
      {id:"size",  label:"Size (ft)", type:"value"},
      {id:"dc",    label:"DC",        type:"value"},
      {id:"rounds",label:"Lifetime",  type:"value"}
    ],
    outputs:[{id:"exec", label:"→", type:"exec"}],
    fields:[
      {key:"cardTitle",         label:"Card title",       type:"text",   default:"AoE Save"},
      {key:"shape",             label:"Shape",            type:"select", options:["circle","cone","ray","rect","ellipse"], default:"circle"},
      {key:"size",              label:"Size (ft)",        type:"number", default:20},
      {key:"angle",             label:"Cone angle (deg)", type:"number", default:53.13},
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
      {key:"bonusFormula",      label:"Bonus formula (+)", type:"text",  default:"", placeholder:"e.g. @bonus or 1d4"},
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
      name:              n.data.name      ?? "AoE Effect",
      icon:              n.data.icon      ?? "icons/svg/aura.svg",
      saveAttr:          n.data.saveAttr  ?? "system.attributes.dex.value",
      dc:                (v => Number.isFinite(v) ? v : 15)(Number(inp.dc ?? n.data.dc ?? 15)),
      flavor:            n.data.flavor    ?? "Saving Throw",
      advMode:           n.data.advMode   ?? "none",
      advFormula:        n.data.advFormula ?? "",
      disFormula:        n.data.disFormula ?? "",
      bonusFormula:      n.data.bonusFormula ?? "",
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

  act_place_aoe_save_branch: {
    title:"Chat AoE — Save Branch", color:"#8a5a2a", cat:"AoE", wideNode:true,
    desc:"Posts a chat card with a 'Place Template' button. When placed, every token inside rolls a save. Fires the 'Saved →' branch for passing tokens and 'Failed →' branch for failing tokens. Use Saved/Failed/All array outputs (available as runtime.savedTargets / failedTargets / allTargets) to fan-out damage / heal / effects.",
    inputs:[
      {id:"exec", label:"",          type:"exec"},
      {id:"size", label:"Size (ft)", type:"value"},
      {id:"dc",   label:"DC",        type:"value"}
    ],
    outputs:[
      {id:"pass",   label:"Saved →",  type:"exec"},
      {id:"fail",   label:"Failed →", type:"exec"},
      {id:"saved",  label:"Saved[]",  type:"value"},
      {id:"failed", label:"Failed[]", type:"value"},
      {id:"all",    label:"All[]",    type:"value"}
    ],
    fields:[
      {key:"cardTitle",   label:"Card title",       type:"text",   default:"AoE Save"},
      {key:"shape",       label:"Shape",            type:"select", options:["circle","cone","ray","rect","ellipse"], default:"circle"},
      {key:"size",        label:"Size (ft)",        type:"number", default:20},
      {key:"angle",       label:"Cone angle (deg)", type:"number", default:53.13},
      {key:"saveAttr",    label:"Save attr path",   type:"path",   default:"system.attributes.dex.value"},
      {key:"dc",          label:"DC",               type:"number", default:15},
      {key:"flavor",      label:"Save label",       type:"text",   default:"Saving Throw"},
      {key:"rollMode",    label:"Roll mode",        type:"select", options:["public","gmroll","blindroll","selfroll"], default:"public"},
      {key:"showInChat",  label:"Show in chat",     type:"select", options:["yes","no"], default:"yes"},
      {key:"advMode",     label:"Adv / Dis mode",   type:"select", options:["none","adv","dis","ask"], default:"none"},
      {key:"advFormula",  label:"Adv core formula", type:"text",   default:"", placeholder:"2d20kh1 (default)"},
      {key:"disFormula",  label:"Dis core formula", type:"text",   default:"", placeholder:"2d20kl1 (default)"},
      {key:"bonusFormula", label:"Bonus formula (+)", type:"text", default:"", placeholder:"e.g. @bonus or 1d4"},
      {key:"perTarget",   label:"Fire branch per-target", type:"select", options:["yes","no"], default:"yes"},
      {key:"persist",     label:"Keep template on map",   type:"select", options:["yes","no"], default:"no"}
    ],
    isAction:true,
    isSaveBranch:true,
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
      bonusFormula: n.data.bonusFormula ?? "",
      perTarget:    (n.data.perTarget ?? "yes") === "yes",
      persist:      (n.data.persist   ?? "no")  === "yes"
    })
  },

  act_remove_aura: {
    title:"Remove Aura", color:"#6a1a3a", cat:"Effects",
    desc:"Removes the aura(s) matching the given key from the owner token and clears the linked Active Effect from any tokens currently inside.",
    inputs:[
      {id:"exec",  label:"",       type:"exec"},
      {id:"owner", label:"Owner",  type:"value"}
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

  /** Gate — lets exec pass only when Condition is true, otherwise silently stops */
  gate: {
    title:"Gate", color:"#5a2a8a", cat:"Flow",
    desc:"Exec passes through only when Condition is truthy. Acts as an early-exit guard without needing a Branch.",
    inputs:[
      {id:"exec",label:"",type:"exec"},
      {id:"cond",label:"Condition",type:"value"}
    ],
    outputs:[{id:"exec",label:"Pass →",type:"exec"}],
    fields:[],
    isAction:true,
    toAction:(n,inp)=>({type:"gate", condition: inp.cond ?? 0})
  },

  /** Reroute — visual routing helper, no logic */
  reroute: {
    title:"•", color:"#2a2a3a", cat:"Flow",
    desc:"Visual wire re-routing point. No logic — just keeps graphs tidy.",
    inputs:[{id:"v",label:"",type:"value"}],
    outputs:[{id:"v",label:"",type:"value"}],
    fields:[],
    isReroute: true,
    compile:(_,i)=> i.v !== undefined ? String(i.v) : "0"
  },

  // Sources additions

  /** Ternary — inline conditional value selection */
  ternary: {
    title:"Ternary", color:"#6a1a6a", cat:"Sources",
    desc:"Outputs True value when Condition is truthy, False value otherwise. Equivalent to (cond ? a : b). Eliminates common Branch→Output patterns.",
    inputs:[
      {id:"cond",  label:"Condition", type:"value"},
      {id:"a",     label:"True val",  type:"value"},
      {id:"b",     label:"False val", type:"value"}
    ],
    outputs:[{id:"v", label:"Out", type:"value"}],
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

  /** Random Number — uniform integer between min and max (inclusive) */
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

  /** Get Variable — read from actor.flags.sd.vars namespace */
  get_var: {
    title:"Get Variable", color:"#2a3a5a", cat:"Sources",
    desc:"Read a named variable stored on this actor (actor.flags.sd.vars.NAME). Use with Set Variable to pass data between button clicks or graph segments.",
    inputs:[], outputs:[{id:"v", label:"Value", type:"value"}],
    fields:[{key:"name", label:"Variable Name", type:"text", default:"myVar", placeholder:"e.g. lastRollResult"}],
    compile:(n)=>`{var:${n.data.name??"myVar"}}`
  },

  // Math additions

  /** Mod — remainder */
  mod: {
    title:"Mod %", color:"#1a5c2a", cat:"Math",
    inputs:[{id:"a",label:"A"},{id:"b",label:"B"}], outputs:[{id:"v",label:"",type:"value.number"}],
    fields:[], desc:"Integer remainder of A ÷ B",
    compile:(_,i)=>`(${i.a??"0"}%${i.b??"1"})`
  },

  /** Pow — exponentiation */
  pow: {
    title:"Pow ^", color:"#1a5c2a", cat:"Math",
    inputs:[{id:"a",label:"Base"},{id:"b",label:"Exp"}], outputs:[{id:"v",label:"",type:"value.number"}],
    fields:[], desc:"A raised to the power of B",
    compile:(_,i)=>`(${i.a??"0"}**${i.b??"2"})`
  },

  /** Sign — returns -1, 0 or +1 */
  sign: {
    title:"Sign", color:"#1a5c2a", cat:"Math",
    inputs:[{id:"a",label:"A"}], outputs:[{id:"v",label:"",type:"value.number"}],
    fields:[], desc:"Returns -1, 0 or +1 based on the sign of A",
    compile:(_,i)=>`(${i.a??"0"}>0?1:${i.a??"0"}<0?-1:0)`
  },

  // Actions additions

  /** Play Sound — AudioHelper.play wrapper */
  act_play_sound: {
    title:"Play Sound", color:"#4a2a7a", cat:"Actions",
    desc:"Play a sound file via Foundry's AudioHelper. Path is relative to the Data folder or a full URL.",
    inputs:[{id:"exec",label:"",type:"exec"}],
    outputs:[{id:"exec",label:"",type:"exec"}],
    fields:[
      {key:"src",    label:"Sound path / URL", type:"text",   default:"sounds/dice.wav", placeholder:"sounds/dice.wav"},
      {key:"volume", label:"Volume (0–1)",      type:"number", default:0.8},
      {key:"loop",   label:"Loop",              type:"select", default:"no", options:["no","yes"]}
    ],
    isAction:true, wideNode:true,
    toAction:(n)=>({
      type:   "playSound",
      src:    n.data.src    ?? "sounds/dice.wav",
      volume: Number(n.data.volume ?? 0.8),
      loop:   n.data.loop   === "yes"
    })
  },

  /** Run Macro — execute a world macro by name */
  act_run_macro: {
    title:"Run Macro", color:"#4a4a7a", cat:"Actions",
    desc:"Execute a world Macro by exact name. The macro runs with the current actor and token as speaker context.",
    inputs:[{id:"exec",label:"",type:"exec"}],
    outputs:[{id:"exec",label:"",type:"exec"}],
    fields:[
      {key:"macroName", label:"Macro Name", type:"text", default:"", placeholder:"exact name from Macros directory"}
    ],
    isAction:true, wideNode:true,
    toAction:(n)=>({type:"runMacro", macroName: n.data.macroName ?? ""})
  },

  /** Notify — show a toast notification to the current user */
  act_notify: {
    title:"Notify", color:"#4a4a1a", cat:"Actions",
    desc:"Show a toast notification (info / warning / error) to the current user. Useful for feedback without a full chat message.",
    inputs:[{id:"exec",label:"",type:"exec"},{id:"text",label:"Message",type:"value"}],
    outputs:[{id:"exec",label:"",type:"exec"}],
    fields:[
      {key:"text",  label:"Default text", type:"text",   default:"Done!"},
      {key:"level", label:"Level",        type:"select", default:"info", options:["info","warn","error"]}
    ],
    isAction:true,
    toAction:(n,inp)=>({
      type:  "notify",
      text:  inp.text ?? n.data.text ?? "Done!",
      level: n.data.level ?? "info"
    })
  },

  /** Consume Resource — consume one unit of any resource, branching OK / Empty */
  act_consume_resource: {
    title:"Consume Resource", color:"#6a2a6a", cat:"Actions",
    desc:"Decrement a resource value by Amount (default 1). If current value would go below 0 takes the Empty branch instead. Use instead of Modify Field + Branch for uses/charges/mana.",
    inputs:[
      {id:"exec",   label:"",       type:"exec"},
      {id:"amount", label:"Amount", type:"value"}
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
      path:   n.data.path   ?? "system.resources.mp.value",
      amount: inp.amount    ?? n.data.amount ?? 1,
      target: n.data.target ?? "self"
    })
  },

  /** Set Variable — write to actor.flags.sd.vars namespace */
  act_set_var: {
    title:"Set Variable", color:"#2a3a6a", cat:"Actions",
    desc:"Store a value in actor.flags.sd.vars.NAME for retrieval later in the same or other graphs. Useful for persisting roll results between button presses.",
    inputs:[{id:"exec",label:"",type:"exec"},{id:"value",label:"Value",type:"value"}],
    outputs:[{id:"exec",label:"",type:"exec"}],
    fields:[
      {key:"name",  label:"Variable Name", type:"text",   default:"myVar", placeholder:"e.g. lastRollResult"},
      {key:"scope", label:"Scope",         type:"select", default:"actor", options:["actor","world"]}
    ],
    isAction:true,
    toAction:(n,inp)=>({
      type:  "setVar",
      name:  n.data.name  ?? "myVar",
      value: inp.value    ?? 0,
      scope: n.data.scope ?? "actor"
    })
  },

  /** Open Sheet — open another actor or item sheet by UUID */
  act_open_sheet: {
    title:"Open Sheet", color:"#2a3a6a", cat:"Actions",
    desc:"Open the sheet window of another Actor or Item by UUID. Useful for 'Inspect' buttons on slot items.",
    inputs:[{id:"exec",label:"",type:"exec"},{id:"uuid",label:"UUID",type:"value"}],
    outputs:[{id:"exec",label:"",type:"exec"}],
    fields:[
      {key:"uuid",    label:"UUID (or drag here)", type:"text",   default:"", placeholder:"Actor.xxx or Item.xxx"},
      {key:"asOwner", label:"Require ownership",   type:"select", default:"yes", options:["yes","no"]}
    ],
    isAction:true, wideNode:true,
    toAction:(n,inp)=>({
      type:     "openSheet",
      uuid:     inp.uuid ?? n.data.uuid ?? "",
      asOwner:  n.data.asOwner !== "no"
    })
  },

  /** Roll Table — roll on a RollTable and branch on found / empty */
  act_roll_table: {
    title:"Roll Table", color:"#7a4500", cat:"Actions",
    desc:"Roll on a world RollTable. Found→ fires when at least one result is drawn. Empty→ fires when the table is empty or not found. Result text and index available as value outputs. Use drawCount > 1 to draw multiple entries — {__rollTableIndex} tracks the current draw (0-based).",
    inputs:[
      {id:"exec",      label:"",           type:"exec"},
      {id:"formula",   label:"Formula",    type:"value"},
      {id:"drawCount", label:"Draw count", type:"value"}
    ],
    outputs:[
      {id:"found",  label:"Found →",      type:"exec"},
      {id:"empty",  label:"Empty →",      type:"exec"},
      {id:"result", label:"Result text",  type:"value"},
      {id:"index",  label:"Draw index",   type:"value"}
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
    title:"Save / Check Button", color:"#7a3a00", cat:"Actions",
    desc:"Posts a chat card with an interactive 'Roll Save' or 'Roll Check' button. The target player clicks it to roll 1d20 + modifier vs the configured DC. Works like dnd5e saving throw / ability check prompts in chat. Connect pass/fail exec branches for follow-up actions. The button supports any attribute path, skill path, or custom modifier field.",
    inputs:[
      {id:"exec",        label:"",            type:"exec"},
      {id:"dc",          label:"DC",           type:"value"},
      {id:"rollFormula", label:"Roll Formula", type:"value"},
      {id:"advFormula",  label:"Adv Formula",  type:"value"},
      {id:"disFormula",  label:"Dis Formula",  type:"value"}
    ],
    outputs:[
      {id:"pass", label:"Pass →", type:"exec"},
      {id:"fail", label:"Fail →", type:"exec"},
      {id:"result", label:"Roll Result", type:"value"}
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
      {key:"timeout",       label:"Timeout (sec, 0=∞)", type:"number", default:0}
    ],
    isSaveBranch: true,
    toAction:(n,inp)=>{
      // pin takes priority over field (same pattern as act_roll_value)
      const rollFormula = (inp.rollFormula != null && inp.rollFormula !== "") ? inp.rollFormula : (n.data.rollFormula || "1d20");
      const advFormula  = (inp.advFormula  != null && inp.advFormula  !== "") ? inp.advFormula  : (n.data.advFormula ?? "");
      const disFormula  = (inp.disFormula  != null && inp.disFormula  !== "") ? inp.disFormula  : (n.data.disFormula ?? "");
      return {
        type: "chatSaveButton",
        checkType:    n.data.checkType    ?? "save",
        modifierPath: n.data.modifierPath ?? "system.attributes.attr1.mod",
        dc:           inp.dc ?? n.data.dc ?? 15,
        flavor:       n.data.flavor       ?? "Saving Throw",
        buttonLabel:  n.data.buttonLabel  ?? "Roll Save",
        target:       n.data.target       ?? "token_target",
        rollMode:     n.data.rollMode     ?? "publicroll",
        rollFormula,
        rollDialogue: n.data.rollDialogue === "yes",
        advFormula,
        disFormula,
        timeout:      Number(n.data.timeout ?? 0)
      };
    }
  },

  // Events
  on_update: {
    title:"On Update", color:"#c04040", cat:"Events",
    desc:"Fires whenever this document (actor/item) is updated. Useful for reacting to HP / resource changes.",
    inputs:[], outputs:[
      {id:"exec",     label:"→ On Update", type:"exec"},
      {id:"path",     label:"Changed Path",type:"value"},
      {id:"oldValue", label:"Old Value",   type:"value"},
      {id:"newValue", label:"New Value",   type:"value"}
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
      {id:"round",      label:"Round",           type:"value"},
      {id:"combatantId",label:"Combatant Id",    type:"value"}
    ],
    fields:[],
    isEvent:true, eventHook:"combatTurnStart"
  },

  on_turn_end: {
    title:"On Turn End", color:"#c04040", cat:"Events",
    desc:"Fires at the end of this actor's combat turn.",
    inputs:[], outputs:[
      {id:"exec",       label:"→ On Turn End",type:"exec"},
      {id:"round",      label:"Round",         type:"value"},
      {id:"combatantId",label:"Combatant Id",  type:"value"}
    ],
    fields:[],
    isEvent:true, eventHook:"combatTurnEnd"
  },

  on_effect_apply: {
    title:"On Effect Apply", color:"#c04040", cat:"Events",
    desc:"Fires when an Active Effect is applied to this actor.",
    inputs:[], outputs:[
      {id:"exec",      label:"→ On Effect",type:"exec"},
      {id:"effectName",label:"Name",        type:"value"}
    ],
    fields:[{key:"nameFilter",label:"Only name (optional)",type:"text",default:""}],
    isEvent:true, eventHook:"createActiveEffect"
  },

  on_damage_taken: {
    title:"On Damage Taken", color:"#c04040", cat:"Events",
    desc:"Fires when this actor's HP path decreases. Configure the HP path below.",
    inputs:[], outputs:[
      {id:"exec",   label:"→ On Damage",type:"exec"},
      {id:"amount", label:"Damage",      type:"value"},
      {id:"newHp",  label:"New HP",      type:"value"}
    ],
    fields:[{key:"hpPath",label:"HP Path",type:"path",default:"system.resources.hp.value"}],
    isEvent:true, eventHook:"hpDecrease"
  },

  on_rest: {
    title:"On Rest", color:"#c04040", cat:"Events",
    desc:"Fires when a rest flag is set on this actor (configurable flag path).",
    inputs:[], outputs:[
      {id:"exec", label:"→ On Rest",type:"exec"},
      {id:"type", label:"Rest Type",  type:"value"}
    ],
    fields:[{key:"flagPath",label:"Rest Flag Path",type:"path",default:"system.flags.rest"}],
    isEvent:true, eventHook:"restFlag"
  },

  on_equip: {
    title:"On Equip", color:"#c04040", cat:"Events",
    desc:"Fires when an item on this actor (or this item specifically) is equipped.",
    inputs:[], outputs:[
      {id:"exec",   label:"→ On Equip", type:"exec"},
      {id:"itemId", label:"Item Id",    type:"value"},
      {id:"itemName",label:"Item Name", type:"value"}
    ],
    fields:[],
    isEvent:true, eventHook:"itemEquipped"
  },
  on_unequip: {
    title:"On Unequip", color:"#c04040", cat:"Events",
    desc:"Fires when an item on this actor (or this item specifically) is unequipped.",
    inputs:[], outputs:[
      {id:"exec",   label:"→ On Unequip",type:"exec"},
      {id:"itemId", label:"Item Id",     type:"value"},
      {id:"itemName",label:"Item Name",  type:"value"}
    ],
    fields:[],
    isEvent:true, eventHook:"itemUnequipped"
  },

  // Unified event node -- Step 3
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

  // Target sources -- Step 3 (target as value)
  get_self: {
    title:"Get Self", color:"#2a5a7a", cat:"Targeting",
    desc:"Reference to the document the graph runs on (actor for sheet graphs, item for item graphs).",
    inputs:[], outputs:[{id:"v", label:"Self", type:"value.actor"}],
    fields:[],
    compile:()=>`"self"`
  },
  get_actor: {
    title:"Get Actor", color:"#2a5a7a", cat:"Targeting",
    desc:"Reference to the actor owning the graph (self for actor graphs, owner for item graphs).",
    inputs:[], outputs:[{id:"v", label:"Actor", type:"value.actor"}],
    fields:[],
    compile:()=>`"actor"`
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

  is_equipped: {
    title:"Is Equipped?", color:"#2e6e4a", cat:"Sources",
    desc:"Returns 1 if this item is currently equipped, 0 otherwise.  Reads `system.equipped` on the context item.",
    inputs:[], outputs:[{id:"value", label:"0/1", type:"value"}],
    fields:[], isPure:true,
    compile:()=>"{__sdIsEquipped}"
  },
  equipped_count: {
    title:"Equipped Count", color:"#2e6e4a", cat:"Sources",
    desc:"Returns the count of items with `system.equipped:true` on the owning actor, optionally filtered by category.",
    inputs:[], outputs:[{id:"value", label:"N", type:"value"}],
    fields:[
      {key:"category", label:"Category", type:"select", default:"any",
        options:["any","weapon","armor","shield","consumable","ammo","magazine","tool","gear","container","treasure","other"]}
    ],
    isPure:true,
    compile:(n)=>`{__sdEqCount:${n.data.category ?? "any"}}`
  },

  // Delay (wait N ms before continuing exec chain)
  act_delay: {
    title:"Delay", color:"#2a5a8a", cat:"Flow",
    desc:"Waits the given number of milliseconds, then continues the exec chain.",
    inputs:[
      {id:"exec",     label:"",        type:"exec"},
      {id:"duration", label:"ms",      type:"value"}
    ],
    outputs:[{id:"exec", label:"→", type:"exec"}],
    fields:[
      {key:"duration", label:"Duration (ms)", type:"text", default:"500"}
    ],
    isAction:true,
    toAction:(n,inp)=>({ type:"delay", duration: inp.duration ?? n.data.duration ?? "500" })
  },

  // Loop (run downstream exec N times, with optional delay between)
  act_loop: {
    title:"For Loop", color:"#2a5a8a", cat:"Flow",
    desc:"Runs Body N times. Current iteration index is available as {__loopIndex}. After all iterations, exec goes to Done.",
    inputs:[
      {id:"exec",  label:"",       type:"exec"},
      {id:"count", label:"Count",  type:"value"},
      {id:"delay", label:"Delay ms",type:"value"}
    ],
    outputs:[
      {id:"body", label:"Body →", type:"exec"},
      {id:"done", label:"Done →", type:"exec"},
      {id:"index",label:"Index",  type:"value"}
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

  // Wait for Foundry hook (one-shot)
  act_wait_for_event: {
    title:"Wait For Event", color:"#2a5a8a", cat:"Flow",
    desc:"Pauses the exec chain until the first fire of a Foundry hook. Timeout is in milliseconds (0 = no timeout). Continues exec once the event fires.",
    inputs:[
      {id:"exec",    label:"",        type:"exec"},
      {id:"timeout", label:"Timeout", type:"value"}
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

  // Step 8 additions (pure value nodes, no runtime rework)

  /** Random Pick — outputs one of up to 5 value inputs chosen uniformly. */
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
      // NB: runtime handles `{random}` as Math.random.
      // We wrap into chained ternaries keyed on discrete buckets.
      const n = opts.length;
      let expr = opts[n-1];
      for (let j = n-2; j >= 0; j--) {
        expr = `(floor(random*${n})==${j}?${opts[j]}:${expr})`;
      }
      return expr;
    }
  },

  /** Resource Tier — maps a numeric value to a tier label via thresholds. */
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
      // Nested ternary: if v < th[0] → lb[0]; elif < th[1] → lb[1]; … else lb[N]
      let expr = JSON.stringify(lb[th.length] ?? lb[lb.length-1] ?? "unknown");
      for (let j = th.length - 1; j >= 0; j--) {
        const label = JSON.stringify(lb[j] ?? "unknown");
        expr = `((${v})<${th[j]}?${label}:${expr})`;
      }
      return expr;
    }
  },

  /** Get Combat State — pure value source reading game.combat. */
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

  // Variables (unified) -- Step 6
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
      return `{__var:${nm}|${d}}`; // local
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
    outputs:[{id:"v", label:"Value", type:"value"}],
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
      {id:"value", label:"Value",type:"value"}
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

  // Cast / Type check
  cast_to_actor: {
    title:"Cast to Actor", color:"#6a2a6a", cat:"Flow",
    desc:"Attempts to cast Value (UUID string) to an Actor. On success, emits Cast Success with ActorId; otherwise Cast Failed.",
    inputs:[
      {id:"exec",  label:"",     type:"exec"},
      {id:"value", label:"Value",type:"value"}
    ],
    outputs:[
      {id:"ok",      label:"Cast Success →",type:"exec"},
      {id:"fail",    label:"Cast Failed →",  type:"exec"},
      {id:"actorId", label:"Actor ID",       type:"value"}
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
      {id:"value", label:"Value",type:"value"}
    ],
    outputs:[
      {id:"ok",     label:"Cast Success →",type:"exec"},
      {id:"fail",   label:"Cast Failed →",  type:"exec"},
      {id:"itemId", label:"Item ID",         type:"value"}
    ],
    fields:[],
    isGenericBranch:true,
    toAction:(n,inp)=>({ type:"castToItem", value: inp.value ?? "" })
  },

  // Macro (subgraph)
  macro_input: {
    title:"Macro Input", color:"#1a8a4a", cat:"Macros",
    desc:"Entry point for a nested graph (macro). Macro ID must match the ID in macro_call. Exec and up to 4 value pins are forwarded from macro_call.",
    inputs:[],
    outputs:[
      {id:"exec", label:"→",     type:"exec"},
      {id:"a",    label:"Arg 1", type:"value"},
      {id:"b",    label:"Arg 2", type:"value"},
      {id:"c",    label:"Arg 3", type:"value"},
      {id:"d",    label:"Arg 4", type:"value"}
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
      {id:"a",    label:"Return 1", type:"value"},
      {id:"b",    label:"Return 2", type:"value"}
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
      {id:"a",    label:"Arg 1", type:"value"},
      {id:"b",    label:"Arg 2", type:"value"},
      {id:"c",    label:"Arg 3", type:"value"},
      {id:"d",    label:"Arg 4", type:"value"}
    ],
    outputs:[
      {id:"exec",   label:"→",        type:"exec"},
      {id:"retA",   label:"Return 1", type:"value"},
      {id:"retB",   label:"Return 2", type:"value"}
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

};

// Event node value-pin → runtime token map used by _compileValue when an
const EVENT_PIN_TOKENS = {
  on_update:       { path: "{__eventPath}", oldValue: "{__eventOldValue}", newValue: "{__eventNewValue}" },
  on_turn_start:   { round: "{__eventRound}", combatantId: "{__eventCombatantId}" },
  on_turn_end:     { round: "{__eventRound}", combatantId: "{__eventCombatantId}" },
  on_effect_apply: { effectName: "{__eventEffectName}" },
  on_damage_taken: { amount: "{__eventAmount}", newHp: "{__eventNewHp}" },
  on_rest:         { type: "{__eventRestType}" },
  on_equip:        { itemId: "{__eventItemId}", itemName: "{__eventItemName}" },
  on_unequip:      { itemId: "{__eventItemId}", itemName: "{__eventItemName}" }
};

// Value-pin tokens for branch / save / attack / tiered action nodes
const BRANCH_PIN_TOKENS = {
  // Plain action-node result pins that need runtime tokens
  act_roll_value:   { result: "{__lastRoll}" },
  act_attack_check: { result: "{__lastRoll}", margin: "{__lastMargin}" },
  act_roll_check:   { result: "{__lastRoll}", margin: "{__lastMargin}", winnerRoll: "{__opposedWinnerRoll}" },
  act_tiered_roll:  { result: "{__lastRoll}" },
  act_dice_pool:    { successes: "{__lastSuccesses}", botches: "{__lastBotches}", result: "{__lastRoll}" },
  act_throw_on_canvas: { successes: "{__lastSuccesses}", total: "{__lastRoll}" },
  act_throw_on_sheet:  { successes: "{__lastSuccesses}", total: "{__lastRoll}" },
  chat_save_button:    { result: "{__lastRoll}" },
  act_progression:     { value: "{__lastRoll}", previous: "{__progPrev}" },
  act_loop:            { index: "{__loopIndex}" },
  cast_to_actor:       { actorId: "{__castActorId}" },
  cast_to_item:        { itemId: "{__castItemId}" },
  macro_call:          { retA: "{__macroRetA}", retB: "{__macroRetB}" },
  // Save Branch AoE exposes token-id arrays collected after rolling saves
  act_place_aoe_save_branch: {
    saved:  "{__savedTargets}",
    failed: "{__failedTargets}",
    all:    "{__allTargets}"
  }
};

// Category display order
const CATS = [
  {id:"Flow",      color:"#8a3a8a"},
  {id:"Events",    color:"#c04040"},
  {id:"Attribute", color:"#7a4a1a"},
  {id:"Sources",   color:"#2a6a9a"},
  {id:"Dice",      color:"#9a6a1a"},
  {id:"Math",      color:"#2a7a3a"},
  {id:"Compare",   color:"#8a2a8a"},
  {id:"Logic",     color:"#8a2a2a"},
  {id:"Macros",    color:"#1a8a4a"},
  {id:"Actions",   color:"#5a3a7a"},
  {id:"Effects",   color:"#1a4a8a"},
  {id:"AoE",       color:"#7a3a8a"},
  {id:"Targeting", color:"#8a3a6a"}
];

// NODE TAXONOMY
export const SD_NODE_KIND_COLOURS = {
  pure:       "#3aa87a",   // green
  imperative: "#e08a2a",   // orange
  event:      "#d04040"    // red
};

/** Resolve a node definition's behavioural kind. */
export function getNodeKind(def) {
  if (!def) return "pure";
  if (def.isEvent) return "event";
  if (def.isTrigger) return "event"; // on_click is an entry-point
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

// FormulaGraph


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
    inputs:[_mkPin("label","Label"),_mkPin("path","Value Path"),_mkPin("maxCount","Max Count"),_mkPin("icon","Icon"),_mkPin("color","Color")],
    outputs:[], fields:[{key:"label",label:"Label",type:"text",default:"Stress"},{key:"path",label:"Value Path",type:"path",default:"system.flags.myTracker"},{key:"maxCount",label:"Max Count",type:"number",default:6},{key:"icon",label:"FA Icon",type:"text",default:"fa-circle"},{key:"color",label:"Filled Color",type:"text",default:"#e04040"}]
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

// Merge config nodes into NODE_DEFS so _renderNode, _fldEl, etc. all work unchanged
Object.assign(NODE_DEFS, WIDGET_CONFIG_NODES);

export class FormulaGraph {
  constructor(targetInput, doc, widget=null, saveCtx=null, itemSaveCtx=null, opts={}) {
    this.targetInput  = targetInput;
    this.doc          = doc;
    this.widget       = widget;
    this.saveCtx      = saveCtx;
    this.itemSaveCtx  = itemSaveCtx;
    this.configMode   = opts.mode === "config"; // widget config-via-nodes mode
    this.sheetTrigger = opts.mode === "sheetTrigger";
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
    this._marquee     = null;                // {ox,oy,cx,cy, el}
    this._selected    = new Set();           // currently selected node ids
    this._selectedComments = new Set();      // currently selected comment ids
    this.comments     = [];                  // [{id,x,y,w,h,title,color}]
    this._commentDrag = null;                // {id, mx,my, ox,oy, group:[{id,ox,oy}], nodeGroup:[{id,ox,oy}]}
    this._commentResize = null;              // {id, mx,my, ow,oh}
    this._commentDraft= null;                // {sx,sy, el} — Ctrl+drag rubber band
    this._cleanup     = [];
    this._loadGraph();
  }

  // Selection helpers

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
          // Leave the one-shot "focused" outline intact; just clear our flag.
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
    for (const id of Array.from(this._selected)) this._delNode(id);
    for (const id of Array.from(this._selectedComments)) this._deleteComment(id);
    this._selected.clear();
    this._selectedComments.clear();
    this._refreshSelectionHighlights();
    this._scheduleEdges?.();
  }

  // Comment Box draft (Ctrl+drag rubber band)

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

  _endCommentDraft(/* ev */) {
    if (!this._commentDraft) return;
    const d = this._commentDraft;
    this._commentDraft = null;
    d.el?.remove();

    // Screen-space → graph-space
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

    // Discard tiny drags -- user probably just Ctrl-clicked.
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
    // Filter out nodes whose type is not registered in this graph to avoid ghosts
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
    // Render and select the inserted block so the user sees what landed
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

  /** Read all saved node templates from world settings, returning {name: tpl}. */
  _readNodeTemplates() {
    try { return foundry.utils.deepClone(game.settings.get("sd", "nodeTemplates") ?? {}); }
    catch { return {}; }
  }

  async _writeNodeTemplates(store) {
    try { await game.settings.set("sd", "nodeTemplates", store); }
    catch (err) { console.error("SD | Failed to save node templates", err); }
  }

  // Template UI actions

  /** Prompt for a name & save the current selection (or whole graph) as a world template. */
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

  /** Dropdown anchored near the Templates button, listing all saved templates. */
  _openTemplatesMenu(anchorEl) {
    document.querySelector(".sdgtpl-menu")?.remove();
    const store = this._readNodeTemplates();
    const entries = Object.values(store).sort((a,b)=>(a.name??"").localeCompare(b.name??""));

    const r = anchorEl.getBoundingClientRect();
    const menu = document.createElement("div");
    menu.className = "sdgtpl-menu";
    menu.style.cssText = `position:fixed;left:${Math.round(r.left)}px;top:${Math.round(r.bottom+6)}px;min-width:260px;max-width:380px;max-height:60vh;overflow:auto;background:#121220;border:1px solid #2a2a3e;border-radius:8px;box-shadow:0 12px 40px rgba(0,0,0,.8);z-index:25000;font-family:'Signika',sans-serif;color:#e0e0ee;padding:6px 0`;

    const header = document.createElement("div");
    header.style.cssText = "padding:4px 12px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#74a7ff;border-bottom:1px solid #1a1a28;margin-bottom:4px";
    header.textContent = `Node Templates (${entries.length})`;
    menu.appendChild(header);

    if (!entries.length) {
      const empty = document.createElement("div");
      empty.style.cssText = "padding:12px;font-size:11px;color:#666;font-style:italic";
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
        <div style="font-size:9px;color:#666">${(tpl.nodes??[]).length} nodes · ${(tpl.edges??[]).length} edges</div>`;
      main.addEventListener("click", () => {
        // Insert near the current viewport center (graph coords).
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
      exp.style.cssText = "background:transparent;border:1px solid #3a3a52;border-radius:4px;color:#98a6c6;cursor:pointer;font-size:10px;padding:2px 7px";
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
    // Click-outside to close
    const off = (ev) => {
      if (!menu.contains(ev.target) && ev.target !== anchorEl) {
        menu.remove();
        document.removeEventListener("mousedown", off, true);
      }
    };
    setTimeout(() => document.addEventListener("mousedown", off, true), 0);
  }

  /** Export the current selection (or whole graph) as a downloadable JSON file. */
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
      // Foundry's saveDataToFile is the preferred cross-platform helper
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

  /** Prompt a file picker, parse JSON and insert / store the result. */
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
    // Accept either { nodes, edges, name } OR { templates: { name: tpl, ... } }
    // so users can share bundles too.
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

    // Ask whether to insert at viewport centre or store in the library
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
    return foundry.applications.api.DialogV2.wait({
      window: { title: "Graph Editor" },
      modal: true,
      content: `<div style="padding:8px 0">
        <label style="font-size:12px;color:#888">${esc(label)}</label>
        <input type="text" name="val" value="${esc(def)}"
          style="width:100%;margin-top:4px;background:#2a2a38;border:1px solid #3a3a52;color:#e0e0ee;border-radius:4px;padding:4px 8px;font-size:13px;box-sizing:border-box">
      </div>`,
      buttons: [
        {
          action: "ok", label: "OK", icon: "fas fa-check", default: true,
          callback: (ev, btn, dialog) => {
            const root = dialog?.element ?? dialog;
            return root?.querySelector?.("input[name='val']")?.value?.trim() || null;
          }
        },
        { action: "cancel", label: "Cancel", callback: () => null }
      ],
      rejectClose: false
    }).catch(() => null);
  }

  // Persistence

  _loadGraph() {
    // Config mode -- load widget config graph from widget.configGraph
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
    // Item onClick mode -- load from system.onClickGraph
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
        // Default: On Click trigger → output
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
        // Empty surface -- user picks event nodes from the palette.
      }
      return;
    }
    // Widget graph mode -- load from widget.graphData
    const s = this.widget?.graphData;
    if (s?.nodes?.length) {
      this.nodes = foundry.utils.deepClone(s.nodes);
      this.edges = foundry.utils.deepClone(s.edges??[]);
      this.comments = foundry.utils.deepClone(s.comments ?? []);
      migrateGraph(this);
      // Migrate old attribute graphs: replace attr_score+output with new locked nodes
      if (this.widget?.type === "attribute") {
        this._migrateAttrGraph();
      }
      const numIds = this.nodes.map(n=>{ const v=parseInt(n.id?.replace(/\D/g,"")??0); return isNaN(v)?0:v; });
      this._id = (Math.max(0,...numIds) + 2) || 2;
    } else {
      // Button widgets default to exec/on_click mode; all others to formula/output mode
      if (this.widget?.type === "button") {
        this._addTriggerOutputNodes();
      } else if (this.widget?.type === "attribute") {
        this._addAttributeDefaultGraph();
      } else {
        this._addOutputNode();
        const f = this.targetInput?.value??"";
        if (f && f!=="0") this._hydrateFormula(f);
      }
    }
  }

  async _saveGraph() {
    // Config mode -- extract config node data back to widget fields, then persist
    if (this.configMode && this.saveCtx) {
      const {tab, row, w, doc} = this.saveCtx;
      const graphData = {
        nodes: this.nodes.map(n=>({id:n.id,type:n.type,x:n.x,y:n.y,data:{...n.data}})),
        edges: this.edges.map(e=>({id:e.id,fromNode:e.fromNode,fromPin:e.fromPin,toNode:e.toNode,toPin:e.toPin})),
        comments: this.comments.map(c=>({id:c.id,x:c.x,y:c.y,w:c.w,h:c.h,title:c.title,color:c.color}))
      };
      const cfgNode = this.nodes.find(n => NODE_DEFS[n.type]?.isWidgetConfig);
      const tabs = foundry.utils.deepClone(doc.system?.customTabs ?? []);
      const widget = tabs.find(t=>t.id===tab.id)?.rows?.find(r=>r.id===row.id)?.widgets?.find(x=>x.id===w.id);
      if (widget && cfgNode) {
        const def = NODE_DEFS[cfgNode.type];
        // Compile each input pin -- connected source overrides field value
        const compiledIns = {};
        for (const pin of (def.inputs ?? [])) {
          const e = this.edges.find(e=>e.toNode===cfgNode.id&&e.toPin===pin.id);
          if (e) {
            const src = this.nodes.find(n=>n.id===e.fromNode);
            if (src) compiledIns[pin.id] = this._compileValue(src, new Set(), e.fromPin);
          }
        }
        // Write each field: use compiled value if wired, else node.data value
        for (const field of (def.fields ?? [])) {
          const val = compiledIns[field.key] !== undefined
            ? compiledIns[field.key]
            : cfgNode.data[field.key] ?? field.default ?? "";
          widget[field.key] = field.type === "number" ? Number(val) : val;
        }
        widget.configGraph = graphData;
        await doc.update({"system.customTabs": tabs});
      }
      return;
    }
    // Mode: save into widget.graphData (normal Sheet Builder flow)
    if (this.saveCtx) {
      const {tab,row,w,doc} = this.saveCtx;
      const data = {
        nodes: this.nodes.map(n=>({id:n.id,type:n.type,x:n.x,y:n.y,data:{...n.data}})),
        edges: this.edges.map(e=>({id:e.id,fromNode:e.fromNode,fromPin:e.fromPin,toNode:e.toNode,toPin:e.toPin})),
        comments: this.comments.map(c=>({id:c.id,x:c.x,y:c.y,w:c.w,h:c.h,title:c.title,color:c.color}))
      };
      const tabs   = foundry.utils.deepClone(doc.system.customTabs??[]);
      const widget = tabs.find(t=>t.id===tab.id)?.rows?.find(r=>r.id===row.id)?.widgets?.find(x=>x.id===w.id);
      if (widget) {
        widget.graphData = data;
        if (this.widget?.type === "attribute") {
          // Attribute widget: compile modValueFormula (what to display/roll as mod)
          // and onClickFormula (exec chain triggered on modifier click).
          const attrOut = this.nodes.find(n => n.type === "attr_output");
          if (attrOut) {
            const mvEdge = this.edges.find(e => e.toNode === attrOut.id && e.toPin === "modValue");
            const modSrc = mvEdge ? this.nodes.find(n => n.id === mvEdge.fromNode) : null;
            widget.modValueFormula = modSrc ? this._compileValue(modSrc, new Set(), mvEdge.fromPin) : null;
          }
          // onClickFormula is compiled independently of attr_output -- the graph
          // may only contain on_click → roll with no attr_output node at all.
          const onClickNode = this.nodes.find(n => n.type === "on_click");
          const clickEdge   = onClickNode ? this.edges.find(e => e.fromNode === onClickNode.id && e.fromPin === "exec") : null;
          widget.onClickFormula = clickEdge ? this._compileExecChain(clickEdge.toNode) : null;
          widget.modFormula = undefined;
          widget.formula    = undefined;
        }
        await doc.update({"system.customTabs":tabs});
      }
      return;
    }
    // Mode: save into item.system.onClickGraph directly
    if (this.itemSaveCtx) {
      const {doc} = this.itemSaveCtx;
      const data = {
        nodes: this.nodes.map(n=>({id:n.id,type:n.type,x:n.x,y:n.y,data:{...n.data}})),
        edges: this.edges.map(e=>({id:e.id,fromNode:e.fromNode,fromPin:e.fromPin,toNode:e.toNode,toPin:e.toPin})),
        comments: this.comments.map(c=>({id:c.id,x:c.x,y:c.y,w:c.w,h:c.h,title:c.title,color:c.color}))
      };
      // Also compile and store the formula for the executor
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
      // Only multi-trigger event payloads are meaningful here -- degrade
      // gracefully if the user left the surface empty.
      const payload = (compiledObj && compiledObj._trigger === "multi")
        ? compiledObj
        : {};
      payload._graphData = data;
      await this.doc.update({ "system.sdTriggerGraph": payload });
    }
  }

  // Public

  open() { this._smartIndex = this._buildSmartIndex(); this._buildWin(); this._renderAll(); setTimeout(()=>this._fitView(),120); }
  close() { this._cleanup.forEach(fn=>fn()); this.win?.remove(); this.win=null; }

  // Smart Index
  // Scans the live document and builds dropdown option lists for smart pickers.

  _buildSmartIndex() {
    const doc    = this.doc;
    const isItem = doc && !(doc instanceof Actor);
    const actor  = isItem ? (doc.parent ?? doc.actor ?? null) : (doc ?? null);
    const self   = doc ?? null;

    const idx = { slots:[], ownedItems:[], effects:[], widgets:[], invItemSlots:[] };

    // Slots
    const _indexItemSlots = (itemData, displayName, sourceId, depth = 0, slotPath = null) => {
      if (depth > 5) return; // guard against cycles
      const defs = itemData?.system?.slotDefinitions ?? [];
      for (const d of defs) {
        const myPath = slotPath != null ? `${slotPath}/${d.id}` : null;
        idx.slots.push({ id: d.id, label: `${d.label || d.id} [${displayName}]`, source: sourceId, slotPath: myPath });
        if (sourceId !== "self" && sourceId !== "actor") {
          idx.invItemSlots.push({ itemId: sourceId, itemName: displayName, itemUuid: itemData.uuid ?? itemData._id, slotId: d.id, slotLabel: d.label || d.id, slotPath: myPath });
        }
        // Recurse into items stored inside this slot
        const slotContents = itemData?.system?.slotContents?.[d.id]?.contents ?? [];
        for (const nested of slotContents) {
          const nestedName = `${nested.name ?? "?"} (in ${displayName}/${d.label || d.id})`;
          const nestedId   = nested._id ?? nested.uuid ?? nestedName;
          // Build the nested path: append this slot id and the nested item's _id
          const nestedPath = (myPath != null ? myPath : `${sourceId}/${d.id}`) + `/${nestedId}`;
          _indexItemSlots(nested, nestedName, nestedId, depth + 1, nestedPath);
        }
      }
    };

    // Slots on self (the item being configured)
    const selfPathRoot = (self && !(self instanceof Actor) && self.id) ? self.id : null;
    _indexItemSlots(self, "self", "self", 0, selfPathRoot);

    // Slots on actor (character-level slots) -- no slotPath (null)
    if (actor && actor !== self) {
      _indexItemSlots(actor, "actor", "actor", 0, null);
    }

    // Slots inside every inventory item (+ their nested contents)
    // Pass the Foundry item id as the root of the slotPath chain.
    for (const item of (actor?.items ?? [])) {
      _indexItemSlots(item, item.name, item.id, 0, item.id);
    }

    // Deduplicate by id+source
    const seenSlots = new Set();
    idx.slots = idx.slots.filter(s => { const k=`${s.source}:${s.id}`; if(seenSlots.has(k)) return false; seenSlots.add(k); return true; });

    // Owned Items
    for (const item of (actor?.items ?? [])) {
      idx.ownedItems.push({ id: item.id, name: item.name, uuid: item.uuid, type: item.type });
    }
    idx.ownedItems.sort((a,b) => a.name.localeCompare(b.name));

    // Active Effects
    const effectSrc = actor ?? self;
    for (const fx of (effectSrc?.effects ?? [])) {
      idx.effects.push({ name: fx.name, uuid: fx.uuid, id: fx.id });
    }
    // Also effects on owned items
    for (const item of (actor?.items ?? [])) {
      for (const fx of (item.effects ?? [])) {
        if (!idx.effects.find(e => e.uuid === fx.uuid))
          idx.effects.push({ name: `${fx.name} [${item.name}]`, uuid: fx.uuid, id: fx.id });
      }
    }

    // Widgets (widgetKey)
    const tabs = self?.system?.customTabs ?? actor?.system?.customTabs ?? [];
    for (const tab of tabs) {
      for (const row of (tab.rows ?? [])) {
        for (const w of (row.widgets ?? [])) {
          if (w.widgetKey) idx.widgets.push({ key: w.widgetKey, label: `${w.label || w.type} (${w.widgetKey})`, type: w.type });
        }
      }
    }

    return idx;
  }

  // Returns slots filtered to those belonging to a specific item id (or "self"/"actor")
  _slotsForItem(itemId) {
    if (!itemId) return this._smartIndex?.slots ?? [];
    if (itemId === "self" || itemId === "actor") return (this._smartIndex?.slots ?? []).filter(s => s.source === itemId);
    return (this._smartIndex?.invItemSlots ?? []).filter(s => s.itemId === itemId).map(s => ({ id: s.slotId, label: s.slotLabel, source: itemId }));
  }

  compile() {
    // Attribute widget graph: handled entirely by _saveGraph
    // compile() for attribute returns the modValue expression for preview only.
    const attrOut = this.nodes.find(n=>n.type==="attr_output");
    if (attrOut) {
      const mvEdge = this.edges.find(e=>e.toNode===attrOut.id&&e.toPin==="modValue");
      if (mvEdge) {
        const modSrc = this.nodes.find(n=>n.id===mvEdge.fromNode);
        if (modSrc) return this._compileValue(modSrc, new Set(), mvEdge.fromPin);
      }
      return "0";
    }

    const trigger = this.nodes.find(n=>n.type==="on_click");
    const eventNodes = this.nodes.filter(n => NODE_DEFS[n.type]?.isEvent);
    if (trigger || eventNodes.length) {
      // Collect exec chains keyed by their entry-point type (onClick, onUpdate, …).
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
          effectApply:  "createActiveEffect"
        };
        return EVENT_HOOK_MAP[ev.data?.event ?? "update"] ?? "updateDocument";
      };
      for (const ev of eventNodes) {
        const actions = _chainFor(ev);
        if (!actions?.length) continue;
        // Multiple on_event nodes can coexist → disambiguate by node.id.
        const key = (ev.type === "on_event") ? `on_event::${ev.id}` : ev.type;
        triggers[key] = { hook: _dynHook(ev), data: ev.data ?? {}, actions };
      }
      // Compile all macro_input graph starts into a registry.  Each macro_input
      // defines its own independent chain (visually separate from on_click/events).
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
        // Multi-trigger shape -- event bus reads _events to wire Foundry hooks.
        const payload = { _trigger: "multi", _events: triggers };
        if (hasMacros) payload._macros = macros;
        return JSON.stringify(payload);
      }
      if (Object.keys(macros).length) {
        return JSON.stringify({ _trigger: "macrosOnly", _macros: macros });
      }
    }

    // Priority 2: output node (formula / explicit exec wired to output)
    const out = this.nodes.find(n=>n.type==="output");
    if (!out) return "0";
    // Value pin wired → compile as formula string
    const vEdge = this.edges.find(e=>e.toNode===out.id&&e.toPin==="value");
    if (vEdge) {
      const src = this.nodes.find(n=>n.id===vEdge.fromNode);
      return src ? this._compileValue(src,new Set(),vEdge.fromPin) : "0";
    }
    // Exec pin(s) wired to output → compile exec chain(s)
    const xEdges = this.edges.filter(e=>e.toNode===out.id&&e.toPin==="exec");
    if (xEdges.length) {
      if (xEdges.length === 1) {
        const chainStart = this._findExecChainStart(xEdges[0].fromNode);
        return this._compileExecChain(chainStart);
      }
      // Multiple connections: compile each chain independently and merge
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
    if (node.type === "act_roll_value") return "{__lastRoll}";
    // act_set_field: downstream nodes can read the set value via {__lastRoll} too,
    // since the executor stores the resolved value in __lastRoll as well.
    if (node.type === "act_set_field") return "{__lastRoll}";
    // Event node value outputs compile to runtime placeholders that the event
    // bus fills in via buttonDef.__eventRuntime.  Pin name decides the token.
    if (def?.isEvent) return EVENT_PIN_TOKENS[node.type]?.[fromPin] ?? "0";
    // Macro input: inside a subgraph, reading an argument pin compiles to a
    // placeholder that the macro-call runtime fills in from its args.
    if (def?.isMacroInput) return `{__macroArg:${fromPin ?? "a"}}`;
    // Branch/action nodes can still export value pins via runtime tokens written
    // by the executor (see button-executor _runAction writes to buttonDef.__last*).
    if (def?.isAttackBranch || def?.isBranch || def?.isSaveBranch || def?.isTieredBranch || def?.isGenericBranch || def?.isProgressionBranch) {
      return BRANCH_PIN_TOKENS[node.type]?.[fromPin] ?? "0";
    }
    // Non-branch action nodes with runtime-token outputs (e.g. act_roll_value.result).
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
    // Collect dynamic pins for compile-type value nodes (e.g. dice add/sub)
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
    return def.compile?.(node,ins)??"0";
  }

  _findExecChainStart(nodeId) {
    const visited = new Set();
    let current = nodeId;
    while (current && !visited.has(current)) {
      visited.add(current);
      // Who has their exec output wired into current's exec input?
      const prevEdge = this.edges.find(e => e.toNode === current && e.toPin === "exec");
      if (!prevEdge) break;
      const prevNode = this.nodes.find(n => n.id === prevEdge.fromNode);
      if (!prevNode) break;
      // Stop at trigger nodes (on_click) -- they are handled separately
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
        // Branch: compile condition, push a branch action
        const condEdge = this.edges.find(e=>e.toNode===node.id&&e.toPin==="cond");
        const condNode = condEdge ? this.nodes.find(n=>n.id===condEdge.fromNode) : null;
        const cond     = condNode ? this._compileValue(condNode,new Set(),condEdge.fromPin) : "1";

        const trueEdge  = this.edges.find(e=>e.fromNode===node.id&&e.fromPin==="true");
        const falseEdge = this.edges.find(e=>e.fromNode===node.id&&e.fromPin==="false");

        // Save current actions length, collect true/false branches recursively
        const trueBefore = [...actions];
        if (trueEdge) _walk(trueEdge.toNode, new Set(vis));
        const trueActions = actions.splice(trueBefore.length);

        if (falseEdge) _walk(falseEdge.toNode, new Set(vis));
        const falseActions = actions.splice(trueBefore.length);

        actions.push({type:"branch",condition:cond,trueActions,falseActions});
        return;
      }

      if (def.isSwitch) {
        // switch_node: compile value input, then walk each case/default exec output
        const valEdge = this.edges.find(e=>e.toNode===node.id&&e.toPin==="value");
        const valNode = valEdge ? this.nodes.find(n=>n.id===valEdge.fromNode) : null;
        const value   = valNode ? this._compileValue(valNode, new Set(), valEdge.fromPin) : (node.data?.value ?? "0");

        const cases = [node.data?.case0 ?? "0", node.data?.case1 ?? "1", node.data?.case2 ?? "2"];
        const act = { type: "switchExec", value, cases };

        // Walk each case exec output and the default fallthrough
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
        // dialog_switch: compile each active exec output into its own actions array
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
        // Compile a "continue" chain after the switch (exec output from the whole node, if any)
        // In our model there's no "after" pin, so just stop here.
        actions.push(act);
        return;
      }

      if (def.isLoop) {
        // Collect value inputs so toAction can read them (e.g. count for for_loop)
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

        // Use toAction for the correct type+params (for_loop->forLoop, forEach->forEachTarget)
        const act = def.toAction?.(node, ins) ?? {type:"forEachTarget"};
        actions.push({...act, loopActions, doneActions});
        return;
      }

      if (def.isGenericBranch) {
        // Generic branch: collect all non-exec inputs, walk every exec output
        // into `<pinId>Actions`, and build the action via toAction(node, ins).
        const ins = {};
        for (const pin of (def.inputs ?? [])) {
          if (pin.type === "exec") continue;
          const e = this.edges.find(e=>e.toNode===node.id&&e.toPin===pin.id);
          if (e) { const s=this.nodes.find(n=>n.id===e.fromNode); if (s) ins[pin.id]=this._compileValue(s,new Set(),e.fromPin); }
        }
        const act = def.toAction?.(node, ins) ?? {};
        for (const pin of (def.outputs ?? [])) {
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
        // Progression: 4 branches -- higher / lower / equal / noHistory
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

      if (def.isSaveBranch) {
        // Save Check: compile ALL input pins, collect fail/pass branches
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
        // consumeSlot: compile level input, collect ok/empty exec branches
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

      // Roll Table branch compiler
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
        // act_tiered_roll: compile value inputs, then walk each tier exec output
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

      // Unified Sequence (2-12 branches) -- walks `count` output pins in order.
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
        // Collect dynamic pins -- supports both single object and array of groups
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

        // Follow exec output
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

    // Refresh Attr Score cards (live score display)
    this.nodesEl?.querySelectorAll("[data-nid]").forEach(el => {
      if (typeof el._refreshAttrCard === "function") el._refreshAttrCard();
    });

    // Live value on Output / Attr Output node
    const liveTargetNode = this.nodes.find(n => n.type === "output" || n.type === "attr_output");
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
              const v = foundry.utils.getProperty(this.doc, p);
              return v !== undefined && v !== null ? String(v) : p;
            });
            liveText = `${f}\n→ ${resolved}`;
          } catch { /* noop */ }
        }
        liveEl.textContent = liveText;
      }
    }
    // Update mode badge
    const badge = this.win.querySelector("#gmode-badge");
    if (!badge) return;
    const hasAttrOut = this.nodes.some(n=>n.type==="attr_output");
    const hasOnClick = this.nodes.some(n=>n.type==="on_click");
    const hasOutput  = this.nodes.some(n=>n.type==="output");
    if (hasAttrOut) {
      badge.style.display = "block";
      badge.style.color   = "#e8c060";
      badge.style.borderColor = "#7a4a1a";
      badge.textContent   = "✓ Attribute graph — wire modValue (display) + On Click exec chain";
    } else if (hasOnClick) {
      badge.style.display = "block";
      badge.style.color   = "#5ae07a";
      badge.style.borderColor = "#1a5c2a";
      badge.textContent   = "✓ Exec graph (On Click) — Output node not required";
    } else if (hasOutput) {
      badge.style.display = "block";
      badge.style.color   = "#9d8fff";
      badge.style.borderColor = "#534AB7";
      badge.textContent   = "✓ Formula graph — connect a node to Output";
    } else {
      badge.style.display = "none";
    }
  }

  _buildVarPanel() {
    const panel = this.win?.querySelector("#gvarpanel");
    if (!panel) return;

    // Collect variables (var_get/var_set) and macro ids (macro_input/macro_call)
    const vars   = new Map();   // name → {nodes:[], hasSet, hasGet}
    const macros = new Map();   // id   → {nodes:[], hasInput, hasCall}

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

    // Click-to-focus on the first node of a row
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

  // Window

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

    // Style zoom buttons
    const btnBase = "background:rgba(21,26,36,.9);border:1px solid rgba(255,255,255,.08);border-radius:8px;color:#98a6c6;cursor:pointer;font-size:12px;height:30px;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(6px);transition:.15s;box-shadow:0 4px 12px rgba(0,0,0,.4)";
    win.querySelectorAll(".gz").forEach(b=>{b.style.cssText=btnBase+";width:30px";});
    win.querySelector("#gfit").style.cssText=btnBase+";padding:0 10px;font-size:11px;font-weight:600;gap:4px";

    this._wireWin();
      }

  _drawGrid() {
    // Grid is now handled by CSS background on #gwrap.
    // This method is kept as a no-op so existing call sites don't break.
  }

  _buildPal() {
    // Palette filters by context so each graph surface only offers nodes that
    const ALLOWED_CONFIG_CATS = new Set(["Sources", "Math"]);
    const IMPLICIT_CLICK_WIDGETS = new Set([
      "rollButton","counter","dice","toggle","tracker","clock",
      "tokenPool","diceTray","number","resource","progress","richtext"
    ]);
    const isWidgetGraph   = !!this.widget && !this.configMode;
    const isAttrGraph     = this.widget?.type === "attribute";
    const isItemGraph     = !!this.itemSaveCtx && !this.widget;
    const isSheetTrigger  = !!this.sheetTrigger;
    const hidesEvents     = !isSheetTrigger
      && ((isWidgetGraph && !isAttrGraph) || isAttrGraph || isItemGraph);
    const hidesOnClick    = isSheetTrigger || (isWidgetGraph && !isAttrGraph
      && IMPLICIT_CLICK_WIDGETS.has(this.widget?.type));

    const rows = CATS.map(cat=>{
      const nodes = Object.entries(NODE_DEFS).filter(([type,d]) => {
        if (d.isWidgetConfig) return false; // never in palette
        if (d.hidden) return false;
        if (this.configMode && !ALLOWED_CONFIG_CATS.has(d.cat)) return false;
        if (hidesEvents && d.isEvent) return false;
        if (hidesOnClick && type === "on_click") return false;
        // Sheet-trigger-graph has no formula output -- hide the `output` node.
        if (isSheetTrigger && type === "output") return false;
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

    // Close / Save
    win.querySelector("#gclose").addEventListener("click", async () => {
      await this._saveGraph(); this.close();
    });
    win.querySelector("#gsave").addEventListener("click", async () => {
      if (this.targetInput && this.widget?.type !== "attribute") {
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

    // Templates -- open picker / insert
    win.querySelector("#gtpl")?.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this._openTemplatesMenu(ev.currentTarget);
    });

    // Save selection as named template
    win.querySelector("#gtplsave")?.addEventListener("click", async () => {
      await this._saveSelectionAsTemplate();
    });

    // Import JSON (single template or {templates: {...}} bundle)
    win.querySelector("#gimport")?.addEventListener("click", () => this._importTemplateFromFile());

    // Export -- selection if any, otherwise the whole graph
    win.querySelector("#gexport")?.addEventListener("click", () => this._exportSelectionAsFile());

    // Lint -- validate graph (unknown nodes, type mismatches, orphans)
    win.querySelector("#glint")?.addEventListener("click", () => this._runLint());

    // RAF scheduler -- batches all visual updates
    this._raf = 0;
    this._scheduleEdges = () => {
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => {
        this._raf = 0;
        this._redrawEdges();
        this._updatePreview();
      });
    };

    // Title bar drag (window repositioning)
    let ds = null;
    win.querySelector("#gbar").addEventListener("mousedown", ev => {
      if (ev.target.closest("button")) return;
      ds = { x: ev.clientX - win.offsetLeft, y: ev.clientY - win.offsetTop };
    });

    // Unified pointermove / pointerup on document
    const _move = ev => {
      // Window drag
      if (ds) {
        win.style.transform = "none";
        win.style.left = `${Math.max(0, ev.clientX - ds.x)}px`;
        win.style.top  = `${Math.max(0, ev.clientY - ds.y)}px`;
      }
      // Canvas pan -- update state immediately, apply in rAF
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
      // Node drag -- update DOM position immediately, edges in rAF
      if (this._drag) {
        this._doDrag(ev);
      }
      // Connection preview
      if (this._conn) this._doConn(ev);
      // Marquee selection rectangle
      if (this._marquee) this._doMarquee(ev);
      // Comment box drag/resize + Ctrl+drag draft
      if (this._commentDrag)   this._doCommentDrag(ev);
      if (this._commentResize) this._doCommentResize(ev);
      if (this._commentDraft)  this._doCommentDraft(ev);
    };
    const _up = ev => {
      ds = null;
      if (this._panDrag) { this._panDrag = null; wrap.style.cursor = ""; }
      if (this._drag)    { this._drag    = null; }
      if (this._conn)          this._endConn(ev);
      if (this._marquee)       this._endMarquee(ev);
      if (this._commentDrag)   { this._commentDrag = null; }
      if (this._commentResize) { this._commentResize = null; }
      if (this._commentDraft)  this._endCommentDraft(ev);
    };
    document.addEventListener("mousemove", _move);
    document.addEventListener("mouseup",   _up);
    this._cleanup.push(() => {
      document.removeEventListener("mousemove", _move);
      document.removeEventListener("mouseup",   _up);
    });

    // Pan: space+LMB or middle mouse
    let space = false;
    const _kd = ev => {
      if (ev.code === "Space" && ev.target === document.body) { space = true; wrap.style.cursor = "grab"; return; }

      if (ev.key === "Backspace" || ev.key === "Delete") {
        if (!this.win || !document.body.contains(this.win)) return;
        const t = ev.target;
        const inField = t && (
          t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable
        );
        if (inField) return;
        if (!this._selected.size && !this._selectedComments.size) return;
        ev.preventDefault();
        this._deleteSelection();
      }
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

      // Shift + LMB on empty canvas → marquee selection (additive when
      // existing selection is present).
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

      // Plain LMB on empty canvas → clear selection.
      if (ev.button === 0 && !ev.shiftKey && ev.target === wrap) {
        this._clearSelection();
      }
    });

    // Zoom -- smooth focal-point zoom
    const _zoomAt = (screenX, screenY, delta) => {
      const r   = wrap.getBoundingClientRect();
      const mx  = screenX - r.left;
      const my  = screenY - r.top;
      // World point under cursor before zoom
      const wx0 = (mx - this._pan.x) / this._zoom;
      const wy0 = (my - this._pan.y) / this._zoom;
      this._zoom = Math.max(0.15, Math.min(3.0, this._zoom * (delta > 0 ? 0.92 : 1.08)));
      // Adjust pan so the world point stays under the cursor
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

    // Right-click → context menu
    wrap.addEventListener("contextmenu", ev => {
      ev.preventDefault();
      const r  = wrap.getBoundingClientRect();
      const gx = (ev.clientX - r.left - this._pan.x) / this._zoom;
      const gy = (ev.clientY - r.top  - this._pan.y) / this._zoom;
      this._ctxMenu(ev.clientX, ev.clientY, gx, gy);
    });

    // Palette drag-and-drop
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

  // Context menu

  _ctxMenu(sx,sy,gx,gy) {
    document.querySelector(".sdgctx")?.remove();
    const menu=document.createElement("div");
    menu.className="sdgctx";
    menu.style.cssText=`position:fixed;left:${sx}px;top:${sy}px;background:#121220;border:1px solid #2a2a3e;border-radius:6px;box-shadow:0 8px 32px rgba(0,0,0,.85);z-index:25000;min-width:200px;padding:4px 0;font-family:'Signika',serif;max-height:82vh;overflow-y:auto`;

    const search=document.createElement("input");
    search.placeholder="Search…";
    search.style.cssText="width:calc(100% - 16px);margin:6px 8px 3px;background:#0c0c18;border:1px solid #2a2a3e;border-radius:4px;color:#e0e0ee;font-size:11px;padding:4px 8px;outline:none;box-sizing:border-box";
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

  // Graph ops

  /** Auto-create the widget config node for configMode.
   *  Places it at a fixed position so it's immediately visible. */
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

  _addAttributeDefaultGraph() {
    const scorePath = this.widget?.path ?? "system.attributes.attr1.value";
    // 1. Attr Score Val -- undeletable, reads the raw numeric value from path
    const scoreNode = { id:"attr_score_val", type:"attr_score_val", x:60,  y:160, data:{ path: scorePath } };
    // 2. On Click trigger -- undeletable, fires when modifier button is clicked
    const trigNode  = { id:"attr_on_click",  type:"on_click",       x:60,  y:330, data:{} };
    // 3. Attr Output -- undeletable, unique to attribute widgets
    const outNode   = { id:"attr_output",    type:"attr_output",    x:500, y:240, data:{} };
    // 4. Default modifier calc: Attr Modifier node wired score→mod→modValue
    const modNode   = { id:"attr_mod_1",     type:"attr_mod",       x:270, y:160, data:{} };

    this.nodes.push(scoreNode, trigNode, outNode, modNode);

    // Wire: Attr Score Val.value → Attr Modifier.score
    this.edges.push({ id:"e_sv_mod",   fromNode:"attr_score_val", fromPin:"value", toNode:"attr_mod_1",  toPin:"score" });
    // Wire: Attr Modifier.mod → Attr Output.modValue
    this.edges.push({ id:"e_mod_out",  fromNode:"attr_mod_1",     fromPin:"mod",   toNode:"attr_output", toPin:"modValue" });

    this._id = 20;
  }

  /** Migrate old attribute graphData (attr_score/output) to new layout. */
  _migrateAttrGraph() {
    const hasNew = this.nodes.some(n => n.type === "attr_score_val" || n.type === "attr_output");
    if (hasNew) return; // already new format

    const scorePath = this.widget?.path ?? "system.attributes.attr1.value";
    // Remove old output node; keep user-placed nodes
    this.nodes = this.nodes.filter(n => n.type !== "output");
    this.edges = this.edges.filter(e => e.toNode !== "output" && e.fromNode !== "output");
    // Rename attr_score → attr_score_val if present
    for (const n of this.nodes) {
      if (n.type === "attr_score") { n.type = "attr_score_val"; if (!n.data.path) n.data.path = scorePath; }
    }
    // Add locked nodes if missing
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

  _addTriggerOutputNodes() {
    // Default graph for onClick mode: On Click → (user connects actions)
    this.nodes.push({id:"trigger",type:"on_click",x:80,y:220,data:{}});
  }

  _addNode(type,x,y) {
    const def=NODE_DEFS[type]; if(!def) return null;
    const node={id:`n${this._id++}`,type,x:Math.round(x),y:Math.round(y),
      data:Object.fromEntries((def.fields??[]).map(f=>[f.key,f.default??""]))};
    this.nodes.push(node);
    this._renderNode(node);
    this._updatePreview();
    return node;
  }

  _delNode(id) {
    if(id==="output") return;
    this.nodes=this.nodes.filter(n=>n.id!==id);
    this.edges=this.edges.filter(e=>e.fromNode!==id&&e.toNode!==id);
    this.nodesEl.querySelector(`[data-nid="${id}"]`)?.remove();
    this._scheduleEdges?.();
  }

  _addEdge(fn,fp,tn,tp) {
    if(fn===tn) return;
    this.edges=this.edges.filter(e=>!(e.toNode===tn&&e.toPin===tp));
    this.edges.push({id:`e${uid()}`,fromNode:fn,fromPin:fp,toNode:tn,toPin:tp});
    // Re-render target node so UE-style field-hide-on-connect kicks in, and
    // dynamic pins get a new empty slot.
    const toNode = this.nodes.find(n => n.id === tn);
    if (toNode) this._renderNode(toNode);
    this._scheduleEdges?.();
  }

  _removeEdge(edgeId) {
    const edge = this.edges.find(e => e.id === edgeId);
    if (!edge) return;
    this.edges = this.edges.filter(e => e.id !== edgeId);
    const toNode = this.nodes.find(n => n.id === edge.toNode);
    if (toNode) this._renderNode(toNode);
    this._scheduleEdges?.();
  }

  // Rendering

  _renderAll() {
    this.nodesEl.innerHTML="";
    this.nodes.forEach(n=>this._renderNode(n));
    this._renderComments();
    this._applyTransform();
    this._redrawEdges();
    this._updatePreview();
  }

  // Comment boxes (Unreal-style)

  _renderComments() {
    if (!this.commentsEl) return;
    this.commentsEl.innerHTML = "";
    for (const c of this.comments) this._renderComment(c);
  }

  _renderComment(c) {
    if (!this.commentsEl) return;
    // Remove any existing DOM node for this comment (idempotent re-render).
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

    // Delete button
    del.addEventListener("mousedown", ev => ev.stopPropagation());
    del.addEventListener("click", ev => {
      ev.stopPropagation();
      this._deleteComment(c.id);
    });

    // Rename on double-click
    hdr.addEventListener("dblclick", async ev => {
      ev.stopPropagation();
      const name = await this._promptText("Comment title:", c.title || "Comment");
      if (name != null) {
        c.title = name;
        ttl.textContent = name;
      }
    });

    // Header drag = move box + any node currently inside it
    hdr.addEventListener("mousedown", ev => {
      if (ev.target === del || ev.target === rsz) return;
      if (ev.button !== 0) return;
      ev.stopPropagation();
      // Selection semantics mirror node behaviour
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

      // Capture every selected comment AND every node currently inside any
      // of them so the group moves as a rigid block.
      const cmtGroup = Array.from(this._selectedComments).map(id => {
        const cc = this.comments.find(x => x.id === id);
        return cc ? { id: cc.id, ox: cc.x, oy: cc.y } : null;
      }).filter(Boolean);

      const childIds = new Set();
      for (const id of this._selectedComments) {
        const cc = this.comments.find(x => x.id === id);
        if (!cc) continue;
        for (const n of this.nodes) {
          // Approximate by top-left corner: node is "inside" if its (x,y)
          // sits within the comment rect.  Cheap, good-enough for header-drag.
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

    // Resize handle
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
    return c;
  }

  _deleteComment(id) {
    this.comments = this.comments.filter(c => c.id !== id);
    this._selectedComments.delete(id);
    this.commentsEl?.querySelector(`[data-cid="${id}"]`)?.remove();
  }

  _doCommentDrag(ev) {
    if (!this._commentDrag) return;
    const dx = (ev.clientX - this._commentDrag.mx) / this._zoom;
    const dy = (ev.clientY - this._commentDrag.my) / this._zoom;
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
    c.w = Math.max(120, Math.round(r.ow + dx));
    c.h = Math.max(80,  Math.round(r.oh + dy));
    const el = this.commentsEl.querySelector(`[data-cid="${c.id}"]`);
    if (el) { el.style.width = c.w + "px"; el.style.height = c.h + "px"; }
  }

  _renderNode(node) {
    this.nodesEl.querySelector(`[data-nid="${node.id}"]`)?.remove();
    const def=NODE_DEFS[node.type]; if(!def) return;
    const isOut = node.type==="output" || node.type==="attr_output" || node.type==="attr_score_val" || node.type==="on_click";

    const el=document.createElement("div");
    el.dataset.nid=node.id;
    // Width adapts to node type -- wider for actions/attack branches that have more fi
    const W_MIN = def.wideNode ? 380 : def.isAttackBranch ? 320 : def.isBranch ? 270 : def.isAction ? 300 : (def.isOutput||def.isAttrOutput) ? 220 : 240;
    const _longestDataVal = Object.values(node.data ?? {}).reduce((max, v) => {
      const len = typeof v === "string" ? v.length : 0;
      return len > max ? len : max;
    }, 0);
    const W_DATA = _longestDataVal > 0 ? Math.min(520, 100 + Math.ceil(_longestDataVal * 7.5)) : 0;
    const W = Math.max(W_MIN, W_DATA);

    // Kind-based accent border: pure=green, imperative=orange, event=red.
    const _kind   = getNodeKind(def);
    const _accent = SD_NODE_KIND_COLOURS[_kind] ?? "rgba(255,255,255,.08)";

    el.dataset.kind = _kind;
    el.style.cssText=`position:absolute;left:${node.x}px;top:${node.y}px;min-width:${W_MIN}px;width:${W}px;max-width:560px;
      background:linear-gradient(180deg,#151a24,#101521);
      border:1px solid ${_accent}55;
      border-left:3px solid ${_accent};
      border-radius:16px;
      box-shadow:0 18px 45px rgba(0,0,0,.5), 0 0 0 1px ${_accent}22 inset;
      overflow:hidden;
      transform:translateZ(0);`;

    // Build header color from def.color -- use as a gradient
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
    const outputPins = def.outputs??[];
    const fields     = def.fields??[];

    // Passive-widget OUTPUT node: hide the exec input -- nothing to click on
    // in a text / derived / image / section / richtext / tags widget.
    if (def.isOutput) {
      const PASSIVE = new Set(["text","derived","image","section","richtext","tags"]);
      if (this.widget && PASSIVE.has(this.widget.type)) {
        inputPins = inputPins.filter(p => p.type !== "exec");
      }
    }

    // Dynamic pins -- supports both single object and array of groups
    if(def.dynamicPins) {
      const groups = Array.isArray(def.dynamicPins) ? def.dynamicPins : [{ ...def.dynamicPins, label: "Text" }];
      const dynPins = [];
      for(const grp of groups) {
        const {base, label, max} = grp;
        let connected = -1;
        for(let i=0;i<max;i++){
          if(this.edges.some(e=>e.toNode===node.id&&e.toPin===`${base}${i}`)) connected=i;
        }
        const show = Math.min(connected+2, max);
        for(let i=0;i<show;i++) dynPins.push({id:`${base}${i}`,label:`${label} ${i+1}`,type:"value"});
      }
      inputPins = [...inputPins.filter(p=>p.type==="exec"), ...dynPins];
    }

    // Exec inputs first (left-aligned full row)
    for(const p of inputPins.filter(p=>p.type==="exec"))
      body.appendChild(this._pinRow(node,p,"input"));

    // Value rows -- each input pin + matching output pin side by side
    const valIns  = inputPins.filter(p=>p.type!=="exec");
    const valOuts = outputPins.filter(p=>p.type!=="exec");

    const _pinConnected = (pinId) =>
      this.edges.some(e => e.toNode === node.id && e.toPin === pinId);

    // Build the list of field slots to render, skipping any field that is "shadowed"
    // by a connected value-input pin with the same key.
    const pinKeys      = new Set(valIns.map(p => p.id));
    const connectedKeys = new Set(valIns.filter(p => _pinConnected(p.id)).map(p => p.id));
    const visibleFields = fields.filter(f => !connectedKeys.has(f.key));

    // Value-input rows: always show pin; show field inline only when NOT connected
    // and the field shares the pin's key (inline-edit like UE's embedded literals).
    const rows = [];
    for (const p of valIns) {
      const inlineFld = fields.find(f => f.key === p.id);
      rows.push({ inp:p, fld: (inlineFld && !connectedKeys.has(p.id)) ? inlineFld : null });
    }
    // Any remaining fields (no matching pin) render on their own row.
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

    // Exec outputs last.  `dialog_switch` and `sequence` use a `count` field
    // to limit how many exec branches are visible -- matches UE's "Add pin".
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

    // Interactions
    el.querySelector(".ndel")?.addEventListener("click",ev=>{ev.stopPropagation();this._delNode(node.id);});
    el.querySelector(".gnhdr").addEventListener("mousedown",ev=>{
      if(ev.target.classList.contains("ndel")) return;
      ev.stopPropagation();

      // Shift-click toggles this node in the multi-selection and does NOT
      // start a drag -- mirrors node-editor conventions (Blueprint, Blender…).
      if (ev.shiftKey) {
        this._toggleSelectNode(node.id);
        return;
      }

      if (!this._selected.has(node.id)) {
        this._selected.clear();
        this._selected.add(node.id);
      }
      this._refreshSelectionHighlights();

      // Capture starting positions of every selected node so group-drag
      // moves them all by the same screen-space delta.
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

    // Live value badge on Number / Text source nodes
    // Shows the value that will be emitted so the designer can verify instantly.
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
      // Re-run whenever the node's value field changes
      el.addEventListener("input", _refreshNodeLive);
    }

    // Attr Score Val node: big live score display
    if (node.type === "attr_score_val" || node.type === "attr_score") {
      const body = el.querySelector(".gnbody");
      // Scorecard display -- shows the live number from the document prominently
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

      // Re-refresh when the path field changes
      el.addEventListener("input", _refreshAttrCard);
      // Expose refresh so _updatePreview can call it
      el._refreshAttrCard = _refreshAttrCard;
    }

    // UUID fields -- accept item drop
    el.querySelectorAll("input[placeholder*='drag']").forEach(inp=>{
      inp.addEventListener("dragover",ev=>{ev.preventDefault();inp.style.borderColor="#7b68ee";});
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
    lbl.style.cssText="font-size:12px;color:#98a6c6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:120px;line-height:1";
    if(side==="input"){wrap.appendChild(dot);wrap.appendChild(lbl);}
    else{wrap.appendChild(lbl);wrap.appendChild(dot);}
    return wrap;
  }

  _dotEl(node,pin,side) {
    const isExec=pin.type==="exec";
    const dot=document.createElement("div");
    dot.className="gpin";
    dot.dataset.nid=node.id; dot.dataset.pid=pin.id; dot.dataset.side=side;
    // Exec pins = orange squares; value pins = colored circles matching preview.html
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
    // Right-click on pin → disconnect all edges attached to it
    dot.addEventListener("contextmenu",ev=>{
      ev.preventDefault();
      ev.stopPropagation();
      const before = this.edges.length;
      // Collect which target nodes need a re-render so UE-style fields can reappear.
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
    // UE-style autosize
    const IS="background:#1a1e2e;border:1px solid rgba(120,100,220,.35);border-radius:6px;color:#eef3ff;font-size:12px;padding:5px 10px;font-family:monospace;outline:none;min-width:80px;max-width:420px;width:auto;box-sizing:border-box;height:28px;field-sizing:content";
    const SI=IS+";cursor:pointer";
    const idx=this._smartIndex??{slots:[],ownedItems:[],effects:[],widgets:[],invItemSlots:[]};

    // slot-picker
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
          // Match by both id AND slotPath so the correct option stays selected
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
        // Persist the full slot path so compile() can generate the right formula token
        node.data.slotPath = selOpt?.dataset?.slotPath ?? null;
        this._updatePreview();
      });
      wrap.appendChild(sel); return wrap;
    }

    // item-picker
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

    // effect-picker
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

    // effect-uuid-picker
    if(field.type==="effect-uuid-picker"){
      const cur=node.data[field.key]??field.default??"";
      const container=document.createElement("div"); container.style.cssText="display:flex;flex-direction:column;gap:2px;flex:1;min-width:0";
      const sel=document.createElement("select"); sel.style.cssText=SI; sel.title="Effect — picks UUID automatically";
      { const o=document.createElement("option"); o.value=""; o.textContent="— pick effect —"; if(!cur)o.selected=true; sel.appendChild(o); }
      for(const fx of idx.effects){ const o=document.createElement("option"); o.value=fx.uuid; o.textContent=fx.name; if(fx.uuid===cur)o.selected=true; sel.appendChild(o); }
      if(cur && !idx.effects.find(e=>e.uuid===cur)){ const o=document.createElement("option"); o.value=cur; o.textContent=cur+" (custom uuid)"; o.selected=true; sel.appendChild(o); }
      const rawInp=document.createElement("input"); rawInp.type="text"; rawInp.placeholder="or paste UUID…"; rawInp.value=cur;
      rawInp.style.cssText=IS+";font-size:11px;color:#aaa";
      sel.addEventListener("mousedown",ev=>ev.stopPropagation());
      rawInp.addEventListener("mousedown",ev=>ev.stopPropagation());
      sel.addEventListener("change",()=>{ node.data[field.key]=sel.value; rawInp.value=sel.value; this._updatePreview(); });
      rawInp.addEventListener("input",()=>{ node.data[field.key]=rawInp.value; this._updatePreview(); });
      container.appendChild(sel); container.appendChild(rawInp); wrap.appendChild(container); return wrap;
    }

    // widget-picker
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

    // inv-item-slot: cascading item picker → slot picker
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

    // item-uuid-drag: drag-and-drop zone + owned-item picker
    if(field.type==="item-uuid-drag"){
      const curUuid=node.data[field.key]??"";
      const curName=node.data["itemName"]??"";
      const container=document.createElement("div"); container.style.cssText="display:flex;flex-direction:column;gap:3px;flex:1;min-width:0";

      // Owned-item dropdown (sets itemName + resolves uuid from index)
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

      // Drag-and-drop zone
      const dropZone=document.createElement("div");
      const hasVal=curUuid||curName;
      dropZone.textContent=hasVal ? `✔ ${curName||curUuid}` : "⬇ drag item here";
      dropZone.style.cssText=`background:#060612;border:2px dashed ${hasVal?"#3a6a3a":"#2a3a5a"};border-radius:4px;color:${hasVal?"#6aaa6a":"#5a7a9a"};font-size:11px;padding:5px 8px;text-align:center;cursor:copy;transition:border-color .15s,color .15s;`;
      dropZone.title="Drag an item from the Foundry sidebar to auto-fill UUID";
      dropZone.addEventListener("dragover",ev=>{ ev.preventDefault(); dropZone.style.borderColor="#7b68ee"; dropZone.style.color="#a090ff"; });
      dropZone.addEventListener("dragleave",()=>{ dropZone.style.borderColor=node.data[field.key]?"#3a6a3a":"#2a3a5a"; dropZone.style.color=node.data[field.key]?"#6aaa6a":"#5a7a9a"; });
      dropZone.addEventListener("drop",async ev=>{
        ev.preventDefault();
        try{
          const d=JSON.parse(ev.dataTransfer.getData("text/plain"));
          const uuid=d.uuid??d.id??"";
          if(!uuid) return;
          node.data[field.key]=uuid;
          // Try to resolve name from index
          const found=idx.ownedItems.find(i=>i.uuid===uuid)||idx.ownedItems.find(i=>i.id===d.id);
          const label=found?.name ?? d.name ?? uuid;
          node.data["itemName"]=found?.name??"";
          dropZone.textContent=`✔ ${label}`;
          dropZone.style.borderColor="#3a6a3a"; dropZone.style.color="#6aaa6a";
          // Sync select
          const opt=[...selItem.options].find(o=>o.value===(found?.name??""));
          if(opt) selItem.value=opt.value;
          this._updatePreview();
        }catch{}
      });
      // Clear on double-click
      dropZone.addEventListener("dblclick",()=>{
        node.data[field.key]=""; node.data["itemName"]="";
        dropZone.textContent="⬇ drag item here";
        dropZone.style.borderColor="#2a3a5a"; dropZone.style.color="#5a7a9a";
        selItem.value=""; this._updatePreview();
      });

      container.appendChild(selItem); container.appendChild(dropZone); wrap.appendChild(container); return wrap;
    }

    // Standard field types
    let inp;
    if(field.type==="select"){
      inp=document.createElement("select");
      inp.style.cssText=IS+";cursor:pointer";
      for(const o of (field.options??[])){
        const oel=document.createElement("option");
        oel.value=oel.textContent=o;
        if(o===(node.data[field.key]??field.default)) oel.selected=true;
        inp.appendChild(oel);
      }
    } else {
      inp=document.createElement("input");
      inp.type=field.type==="number"?"number":"text";
      inp.value=node.data[field.key]??field.default??"";
      inp.placeholder=_NL(field.placeholder??(String(field.default??"")||""));
      inp.style.cssText=IS;
    }
    inp.dataset.fieldType=field.type;
    inp.addEventListener("focus",()=>inp.style.borderColor="#7b68ee");
    inp.addEventListener("blur", ()=>inp.style.borderColor="#1a1a28");
    inp.addEventListener("mousedown",ev=>ev.stopPropagation());
    inp.addEventListener("input",ev=>{
      node.data[field.key]=inp.type==="number"?Number(ev.target.value):ev.target.value;
      this._updatePreview();
      if(field.type==="path" && liveBadge) _refreshLiveBadge();
      // Re-render for dialog_switch / sequence: count changes show/hide output pins; label changes update pin text
      const _def2 = NODE_DEFS[node.type];
      if (_def2?.isSequence && field.key === "count") {
        // Clamp count on the node immediately, then re-render (edges to
        // invisible pins are dropped on save if the user shrinks count).
        const c = Math.max(2, Math.min(12, Number(ev.target.value) || 2));
        node.data.count = c;
        this._renderNode(node);
        this._scheduleEdges?.();
      } else if (_def2?.isDialogSwitch) {
        if (field.key === "count") {
          // Count changed -- re-render the whole node to show/hide output pins
          this._renderNode(node);
        } else if (field.key.startsWith("label")) {
          // Label changed -- update the pin span text in-place so the input keeps focus
          const pinIdx = parseInt(field.key.replace("label", ""), 10);
          const _nodeEl2 = this.nodesEl?.querySelector(`[data-nid="${node.id}"]`);
          const dot = _nodeEl2?.querySelector(`[data-pid="out${pinIdx}"][data-side="output"]`);
          if (dot) {
            const span = [...dot.parentElement.children].find(c => c !== dot && c.tagName === "SPAN");
            if (span) span.textContent = ev.target.value || `Option ${pinIdx + 1}`;
          }
        }
      }
      // Live-resize the node element to fit the new value
      const _nodeEl = this.nodesEl?.querySelector(`[data-nid="${node.id}"]`);
      if (_nodeEl) {
        const _longestNow = Object.values(node.data ?? {}).reduce((max, v) => {
          const len = typeof v === "string" ? v.length : 0;
          return len > max ? len : max;
        }, 0);
        const def2 = NODE_DEFS[node.type] ?? {};
        const W_BASE2 = def2.wideNode ? 400 : def2.isAttackBranch ? 340 : def2.isBranch ? 290 : def2.isAction ? 320 : (def2.isOutput||def2.isAttrOutput) ? 240 : 260;
        const W_NEW = Math.max(W_BASE2, _longestNow > 0 ? Math.min(520, 100 + Math.ceil(_longestNow * 7.5)) : 0);
        _nodeEl.style.width = W_NEW + "px";
      }
    });
    wrap.appendChild(inp);

    // Live value badge for path-type fields
    // Shows the current doc value so the designer can see what the node resolves to.
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

  // Edge rendering (screen-space bezier, no transform)

  _redrawEdges() {
    const svg=this.edgeSVG; if(!svg) return;

    // Preserve <defs>, remove rendered paths
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

      // Wide transparent hit-area
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

      // Visible stroke: exec → orange, typed value → subtype colour, untyped → gradient.
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

  // Get pin position in SCREEN coordinates
  _pinScreen(nodeId,pinId,side) {
    const el=this.nodesEl.querySelector(`[data-nid="${nodeId}"] [data-pid="${pinId}"][data-side="${side}"]`);
    if(!el) return null;
    const r=el.getBoundingClientRect();
    const wr=this.edgeSVG.getBoundingClientRect();
    return {x:r.left-wr.left+r.width/2, y:r.top-wr.top+r.height/2};
  }

  // Connection drag

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
    if(!pin||pin.dataset.side!=="input"||pin.dataset.nid===conn.fromNode) return;
    // Compatibility check -- reject exec↔value and mismatched value.X ↔ value.Y.
    // value.any on either side is universally compatible.
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

  // Node drag

  _doDrag(ev) {
    if(!this._drag) return;
    const dx = (ev.clientX - this._drag.mx) / this._zoom;
    const dy = (ev.clientY - this._drag.my) / this._zoom;

    // Group drag -- move every node captured at mousedown by the same delta.
    // Falls back to single-node drag when `group` wasn't recorded.
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
    // Schedule edge redraw (RAF-throttled) instead of calling synchronously
    this._scheduleEdges?.();
  }

  // Marquee (Shift + drag on empty canvas)

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

  _endMarquee(/* ev */) {
    if (!this._marquee) return;
    const m = this._marquee;
    this._marquee = null;
    m.el?.remove();

    // Marquee in screen-space (relative to wrap). Convert to graph-space.
    const x1s = Math.min(m.sx, m.cx);
    const y1s = Math.min(m.sy, m.cy);
    const x2s = Math.max(m.sx, m.cx);
    const y2s = Math.max(m.sy, m.cy);
    const gx1 = (x1s - this._pan.x) / this._zoom;
    const gy1 = (y1s - this._pan.y) / this._zoom;
    const gx2 = (x2s - this._pan.x) / this._zoom;
    const gy2 = (y2s - this._pan.y) / this._zoom;

    // Treat tiny marquees as a simple click -- do nothing.
    if ((x2s - x1s) < 4 && (y2s - y1s) < 4) return;

    if (!m.additive) this._selected.clear();
    for (const n of this.nodes) {
      // Approximate node bounds from rendered element (falls back to 220×80).
      const el = this.nodesEl.querySelector(`[data-nid="${n.id}"]`);
      const w  = el ? el.offsetWidth  : 220;
      const h  = el ? el.offsetHeight : 80;
      const nx1 = n.x, ny1 = n.y, nx2 = n.x + w, ny2 = n.y + h;
      const intersects = !(nx2 < gx1 || nx1 > gx2 || ny2 < gy1 || ny1 > gy2);
      if (intersects) this._selected.add(n.id);
    }
    this._refreshSelectionHighlights();
  }

  // View

  _applyTransform() {
    const tf = `translate(${this._pan.x}px,${this._pan.y}px) scale(${this._zoom})`;
    if(this.nodesEl)    this.nodesEl.style.transform    = tf;
    if(this.commentsEl) this.commentsEl.style.transform = tf;
    // CSS background-based grid -- update offset so it pans with the canvas
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

// Inject CSS once
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
