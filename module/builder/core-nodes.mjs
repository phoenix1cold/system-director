// Core Blueprint nodes added by the 2.3.x catalog refactor: text operations,
// Print/Log, stateful flow control (Do Once, Flip Flop, Do N, Multi Gate) and
// the merged Scene property setters. Merged into NODE_DEFS by formula-graph.mjs
// before the catalog post-processing passes run, so auto-pins, localisation and
// the Database-variable pass treat them like every other built-in node.

function b64arg(value) {
  try { return `b64:${btoa(unescape(encodeURIComponent(String(value ?? ""))))}`; }
  catch { return "b64:"; }
}

const wired = (v) => v !== undefined && v !== null && v !== "";
const pick = (inp, data, key, fallback = "") => wired(inp?.[key]) ? inp[key] : (data?.[key] ?? fallback);
// Field text is literal, wired pins are compiled expressions: quote the fallback so the
// engine treats it as text and keeps spaces, commas and digits exactly as typed.
const pickText = (inp, data, key, fallback = "") => wired(inp?.[key]) ? inp[key] : JSON.stringify(String(data?.[key] ?? fallback));
const nodeResult = (node, pin) => `{__nodeResult:${node.id}|${pin}}`;

const TEXT_COLOR = "#7a3a6a";
const FLOW_COLOR = "#8a2a8a";
const SCENE_COLOR = "#3a6a8a";

/* ------------------------------------------------------------------ Text */

function textToken(op, ...args) {
  return `{__sdText:${op}|${args.map(b64arg).join("|")}}`;
}

export const TEXT_NODES = {
  text_format: {
    title:"Format Text", color:TEXT_COLOR, cat:"Text", wideNode:true,
    desc:"Builds text from a template. Write {0}, {1}, … where the Arg pins should be inserted, e.g. \"{0} takes {1} damage\". Arguments may be any value (numbers, names, arrays).",
    keywords:"format string template concat interpolate printf",
    inputs:[{id:"template", label:"Template", type:"value.string"}],
    outputs:[{id:"v", label:"Text", type:"value.string"}],
    fields:[{key:"template", label:"Template", type:"textarea", default:"{0}", placeholder:"{0} takes {1} damage", noPin:true}],
    dynamicPins:[{ base:"arg", label:"Arg", max:10, type:"value.any" }],
    compile:(n,i)=>{
      const args = [];
      for (let k = 0; k < 10; k++) args.push(i[`arg${k}`] ?? "");
      return textToken("format", pickText(i, n.data, "template", "{0}"), ...args);
    }
  },
  text_concat: {
    title:"Concat Text", color:TEXT_COLOR, cat:"Text",
    desc:"Joins every connected Text pin in order with an optional separator.",
    keywords:"concat append join strings",
    inputs:[{id:"sep", label:"Separator", type:"value.string"}],
    outputs:[{id:"v", label:"Text", type:"value.string"}],
    fields:[{key:"sep", label:"Separator", type:"text", default:"", noPin:true}],
    dynamicPins:[{ base:"s", label:"Text", max:10, type:"value.any" }],
    compile:(n,i)=>{
      const parts = [];
      for (let k = 0; k < 10; k++) if (wired(i[`s${k}`])) parts.push(i[`s${k}`]);
      return textToken("concat", pickText(i, n.data, "sep", ""), ...parts);
    }
  },
  text_length: {
    title:"Text Length", color:TEXT_COLOR, cat:"Text",
    desc:"Number of characters in the text.",
    inputs:[{id:"text", label:"Text", type:"value.string"}],
    outputs:[{id:"v", label:"Length", type:"value.number"}],
    fields:[],
    compile:(_n,i)=>textToken("length", i.text ?? "")
  },
  text_contains: {
    title:"Text Contains", color:TEXT_COLOR, cat:"Text",
    desc:"True when Text contains / starts with / ends with / equals Search. Case-insensitive unless Case sensitive is enabled.",
    keywords:"contains includes starts with ends with equals substring",
    inputs:[{id:"text", label:"Text", type:"value.string"}, {id:"search", label:"Search", type:"value.string"}],
    outputs:[{id:"v", label:"Bool", type:"value.bool"}],
    fields:[
      {key:"search", label:"Search", type:"text", default:"", noPin:true},
      {key:"mode", label:"Mode", type:"select", default:"contains", options:[
        {value:"contains", label:"Contains"}, {value:"starts", label:"Starts with"},
        {value:"ends", label:"Ends with"}, {value:"equals", label:"Equals"}]},
      {key:"caseSensitive", label:"Case sensitive", type:"select", default:"no", options:["no","yes"], advanced:true}
    ],
    compile:(n,i)=>textToken("contains", i.text ?? "", pickText(i, n.data, "search", ""), n.data?.mode ?? "contains", n.data?.caseSensitive === "yes" ? "1" : "0")
  },
  text_index_of: {
    title:"Find in Text", color:TEXT_COLOR, cat:"Text",
    desc:"Position (0-based) of the first occurrence of Search inside Text, or -1 when absent.",
    keywords:"index of find position search",
    inputs:[{id:"text", label:"Text", type:"value.string"}, {id:"search", label:"Search", type:"value.string"}],
    outputs:[{id:"v", label:"Index", type:"value.number"}],
    fields:[{key:"search", label:"Search", type:"text", default:"", noPin:true}],
    compile:(n,i)=>textToken("indexOf", i.text ?? "", pickText(i, n.data, "search", ""))
  },
  text_replace: {
    title:"Replace Text", color:TEXT_COLOR, cat:"Text",
    desc:"Replaces Find with Replace inside Text. Replaces every occurrence unless Only first is enabled.",
    inputs:[{id:"text", label:"Text", type:"value.string"}, {id:"find", label:"Find", type:"value.string"}, {id:"replace", label:"Replace", type:"value.string"}],
    outputs:[{id:"v", label:"Text", type:"value.string"}],
    fields:[
      {key:"find", label:"Find", type:"text", default:"", noPin:true},
      {key:"replace", label:"Replace with", type:"text", default:"", noPin:true},
      {key:"first", label:"Only first occurrence", type:"select", default:"no", options:["no","yes"]}
    ],
    compile:(n,i)=>textToken("replace", i.text ?? "", pickText(i, n.data, "find", ""), pickText(i, n.data, "replace", ""), n.data?.first === "yes" ? "1" : "0")
  },
  text_case: {
    title:"Change Case", color:TEXT_COLOR, cat:"Text",
    desc:"Upper / lower / capitalised text, or trims surrounding whitespace.",
    keywords:"upper lower case trim capitalize",
    inputs:[{id:"text", label:"Text", type:"value.string"}],
    outputs:[{id:"v", label:"Text", type:"value.string"}],
    fields:[{key:"op", label:"Operation", type:"select", default:"upper", options:[
      {value:"upper", label:"UPPER CASE"}, {value:"lower", label:"lower case"},
      {value:"capitalize", label:"Capitalize first letter"}, {value:"title", label:"Title Case"}, {value:"trim", label:"Trim spaces"}]}],
    compile:(n,i)=>textToken("case", i.text ?? "", n.data?.op ?? "upper")
  },
  text_substring: {
    title:"Substring", color:TEXT_COLOR, cat:"Text",
    desc:"Part of the text starting at Start (0-based) with the given Length. Empty Length takes everything to the end; a negative Start counts from the end.",
    inputs:[{id:"text", label:"Text", type:"value.string"}, {id:"start", label:"Start", type:"value.number"}, {id:"length", label:"Length", type:"value.number"}],
    outputs:[{id:"v", label:"Text", type:"value.string"}],
    fields:[
      {key:"start", label:"Start", type:"number", default:0, noPin:true},
      {key:"length", label:"Length (empty = to end)", type:"text", default:"", noPin:true}
    ],
    compile:(n,i)=>textToken("substring", i.text ?? "", pick(i, n.data, "start", 0), pick(i, n.data, "length", ""))
  }
};

/* ----------------------------------------------------------------- Debug */

export const DEBUG_NODES = {
  act_log: {
    title:"Print / Log", color:"#4a4a4a", cat:"Debug",
    desc:"Developer output: writes the message to the browser console and/or shows it on screen. Message accepts any value, including arrays and roll results. Disable the screen output to keep the log silent for players.",
    keywords:"print string log debug console trace",
    inputs:[
      {id:"exec", label:"", type:"exec"},
      {id:"text", label:"Message", type:"value.any"}
    ],
    outputs:[{id:"exec", label:"", type:"exec"}],
    fields:[
      {key:"text", label:"Message", type:"textarea", default:"Hello", noPin:true},
      {key:"prefix", label:"Prefix", type:"text", default:"", placeholder:"optional label shown before the value", noPin:true, advanced:true},
      {key:"level", label:"Level", type:"select", default:"log", options:["log","info","warn","error"]},
      {key:"toScreen", label:"Show on screen", type:"select", default:"yes", options:["yes","no"]},
      {key:"toConsole", label:"Write to console", type:"select", default:"yes", options:["yes","no"], advanced:true},
      {key:"gmOnly", label:"Only for GM", type:"select", default:"no", options:["no","yes"], advanced:true}
    ],
    isAction:true,
    toAction:(n,inp)=>({
      type:"logMessage",
      text: pick(inp, n.data, "text", ""),
      prefix: String(n.data?.prefix ?? ""),
      level: String(n.data?.level ?? "log"),
      toScreen: n.data?.toScreen !== "no",
      toConsole: n.data?.toConsole !== "no",
      gmOnly: n.data?.gmOnly === "yes",
      nodeId: n.id
    })
  }
};

/* ----------------------------------------------------------------- Logic */

function b64(value) {
  try { return btoa(unescape(encodeURIComponent(String(value ?? "")))); } catch { return ""; }
}

export const LOGIC_NODES = {
  match_value: {
    title:"Select by Value", color:"#6a1a1a", cat:"Logic", wideNode:true,
    desc:"Compares Value with each Case (top → bottom) and emits the matching Result, or Default when nothing matches. Compare as: Auto (numbers numerically, otherwise text), Number, Text or Array (comma-joined).",
    keywords:"select switch match case value number text array",
    inputs:[{id:"value", label:"Value", type:"value.any"}, {id:"default", label:"Default", type:"value.any"}],
    outputs:[{id:"out", label:"Out", type:"value.any"}],
    fields:[{key:"mode", label:"Compare as", type:"select", default:"auto", options:[
      {value:"auto", label:"Auto"}, {value:"num", label:"Number"}, {value:"str", label:"Text"}, {value:"arr", label:"Array"}]}],
    dynamicPins:[{ base:"c", label:"Case", max:32, type:"value.any" }, { base:"r", label:"Result", max:32, type:"value.any" }],
    dynamicPinsPaired:true,
    compile:(n,i)=>{
      const value = wired(i.value) ? i.value : "0";
      const def   = wired(i.default) ? i.default : "0";
      const pairs = [];
      for (let k = 0; k < 32; k++) {
        const c = i[`c${k}`], r = i[`r${k}`];
        if (!wired(c) && !wired(r)) continue;
        pairs.push(`${b64(c ?? "")}|${b64(r ?? "")}`);
      }
      const mode = ["num","str","arr","auto"].includes(n.data?.mode) ? n.data.mode : "auto";
      return `{__sdMatch:${mode}|${b64(value)}|${b64(def)}${pairs.length ? "|" + pairs.join("|") : ""}}`;
    }
  }
};

/* ---------------------------------------------------------- Flow Control */

const RESET_PIN = {id:"reset", label:"Reset", type:"value.bool"};
const SCOPE_FIELD = {key:"scope", label:"Remember", type:"select", default:"session", advanced:true, options:[
  {value:"session", label:"Until page reload"},
  {value:"actor", label:"On the actor (persists)"}
]};
const KEY_FIELD = {key:"key", label:"Shared key (optional)", type:"text", default:"", placeholder:"nodes with the same key share one state", noPin:true, advanced:true};

export const FLOW_NODES = {
  for_each: {
    title:"For Each", color:"#1a5a7a", cat:"Flow Control",
    desc:"Runs the Loop body once per element. Source: an Array pin (any values), a Tokens array (token ids — the token's actor becomes the action context) or the currently targeted tokens. Item / Token / Index are valid inside the loop body.",
    keywords:"for each loop array tokens targets iterate",
    inputs:[{id:"exec", label:"", type:"exec"}],
    computeDynamicInputs:(n)=> String(n?.data?.source ?? "array") === "targets"
      ? [{id:"exec", label:"", type:"exec"}]
      : [{id:"exec", label:"", type:"exec"}, {id:"a", label: String(n?.data?.source) === "tokens" ? "Tokens" : "Array", type:"value.array"}],
    outputs:[
      {id:"loop",  label:"Loop →", type:"exec"},
      {id:"done",  label:"Done →", type:"exec"},
      {id:"item",  label:"Item",   type:"value.any"},
      {id:"token", label:"Token",  type:"value.token"},
      {id:"index", label:"Index",  type:"value.number"}
    ],
    fields:[{key:"source", label:"Source", type:"select", default:"array", options:[
      {value:"array",   label:"Array elements"},
      {value:"tokens",  label:"Tokens (ids array)"},
      {value:"targets", label:"Targeted tokens"}
    ]}],
    isLoop:true,
    toAction:(n,inp)=>{
      const source = String(n.data?.source ?? "array");
      if (source === "targets") return { type:"forEachTarget" };
      if (source === "tokens")  return { type:"forEachToken", tokens: inp.a ?? "" };
      return { type:"forEachItem", items: inp.a ?? "" };
    }
  },
  do_once: {
    title:"Do Once", color:FLOW_COLOR, cat:"Flow Control",
    desc:"Lets execution through only the first time. Later runs go to Already Done. A truthy Reset re-arms the node (and lets the current run through). \"On the actor\" keeps the state across reloads in the actor's flags.",
    keywords:"do once single fire gate first time",
    inputs:[{id:"exec", label:"", type:"exec"}, RESET_PIN],
    outputs:[
      {id:"exec", label:"Completed →", type:"exec"},
      {id:"blocked", label:"Already Done →", type:"exec"}
    ],
    fields:[SCOPE_FIELD, KEY_FIELD],
    isGenericBranch:true,
    toAction:(n,inp)=>({ type:"flowDoOnce", reset: inp.reset ?? "", scope: n.data?.scope ?? "session", key: String(n.data?.key ?? ""), nodeId: n.id })
  },
  flip_flop: {
    title:"Flip Flop", color:FLOW_COLOR, cat:"Flow Control",
    desc:"Alternates between A and B on every run. Is A reports which side fired this time.",
    keywords:"flip flop toggle alternate",
    inputs:[{id:"exec", label:"", type:"exec"}],
    outputs:[
      {id:"a", label:"A →", type:"exec"},
      {id:"b", label:"B →", type:"exec"},
      {id:"isA", label:"Is A", type:"value.bool"}
    ],
    fields:[SCOPE_FIELD, KEY_FIELD],
    isGenericBranch:true,
    dynamicBranchToken:(node, pin)=> pin === "isA" ? nodeResult(node, "isA") : null,
    toAction:(n)=>({ type:"flowFlipFlop", scope: n.data?.scope ?? "session", key: String(n.data?.key ?? ""), nodeId: n.id })
  },
  do_n: {
    title:"Do N", color:FLOW_COLOR, cat:"Flow Control",
    desc:"Lets execution through N times, then routes to Exhausted. Counter is the number of completed runs (1-based). Reset restarts the count.",
    keywords:"do n times limit counter charges",
    inputs:[{id:"exec", label:"", type:"exec"}, {id:"n", label:"N", type:"value.number"}, RESET_PIN],
    outputs:[
      {id:"exec", label:"Completed →", type:"exec"},
      {id:"blocked", label:"Exhausted →", type:"exec"},
      {id:"counter", label:"Counter", type:"value.number"}
    ],
    fields:[{key:"n", label:"N", type:"number", default:1, noPin:true}, SCOPE_FIELD, KEY_FIELD],
    isGenericBranch:true,
    dynamicBranchToken:(node, pin)=> pin === "counter" ? nodeResult(node, "counter") : null,
    toAction:(n,inp)=>({ type:"flowDoN", n: pick(inp, n.data, "n", 1), reset: inp.reset ?? "", scope: n.data?.scope ?? "session", key: String(n.data?.key ?? ""), nodeId: n.id })
  },
  multi_gate: {
    title:"Multi Gate", color:FLOW_COLOR, cat:"Flow Control",
    desc:"Each run fires the next output in order (Out 1, Out 2, …). With Loop off the node stops after the last output; Random picks an unused output each time. Reset starts over.",
    keywords:"multi gate sequence rotate round robin random",
    inputs:[{id:"exec", label:"", type:"exec"}, RESET_PIN],
    outputs:[],
    computeDynamicOutputs:(n)=>{
      const count = Math.max(2, Math.min(8, parseInt(n?.data?.count) || 2));
      const outs = [];
      for (let k = 0; k < count; k++) outs.push({id:`out${k}`, label:`Out ${k + 1} →`, type:"exec"});
      outs.push({id:"index", label:"Index", type:"value.number"});
      return outs;
    },
    catalogOutputs:[{id:"out0", label:"Out 1 →", type:"exec"}, {id:"out1", label:"Out 2 →", type:"exec"}, {id:"index", label:"Index", type:"value.number"}],
    fields:[
      {key:"count", label:"Outputs (2-8)", type:"number", default:2, noPin:true},
      {key:"loop", label:"Loop", type:"select", default:"yes", options:["yes","no"]},
      {key:"random", label:"Random order", type:"select", default:"no", options:["no","yes"], advanced:true},
      SCOPE_FIELD, KEY_FIELD
    ],
    isGenericBranch:true,
    dynamicBranchToken:(node, pin)=> pin === "index" ? nodeResult(node, "index") : null,
    toAction:(n,inp)=>({
      type:"flowMultiGate",
      count: Math.max(2, Math.min(8, parseInt(n.data?.count) || 2)),
      loop: n.data?.loop !== "no",
      random: n.data?.random === "yes",
      reset: inp.reset ?? "",
      scope: n.data?.scope ?? "session", key: String(n.data?.key ?? ""), nodeId: n.id
    })
  }
};

/* ------------------------------------------------- Scene property setters */

const str = (inp, data, key, fallback) => wired(inp?.[key]) ? String(inp[key]) : String(data?.[key] ?? fallback);
const uuidPin = (label) => ({id:"uuid", label, type:"value.string"});
const only = (prop) => (d) => String(d?.property ?? "") === prop;

// Every property keeps the pin ids and action types of the node it replaces so
// migrated graphs compile to exactly the same executor actions.
const TILE_PROPERTIES = {
  image:    { label:"Image",    pins:[{id:"src", label:"Image", type:"value.string"}],
              action:(n,inp)=>({type:"setTileImage", src:str(inp,n.data,"src","")}) },
  size:     { label:"Size",     pins:[{id:"width", label:"Width", type:"value.number"}, {id:"height", label:"Height", type:"value.number"}],
              action:(n,inp)=>({type:"setTileSize", width:str(inp,n.data,"width",100), height:str(inp,n.data,"height",100)}) },
  position: { label:"Position", pins:[{id:"x", label:"X", type:"value.number"}, {id:"y", label:"Y", type:"value.number"}],
              action:(n,inp)=>({type:"setTilePosition", x:str(inp,n.data,"x",0), y:str(inp,n.data,"y",0)}) },
  rotation: { label:"Rotation", pins:[{id:"rotation", label:"Rotation", type:"value.number"}],
              action:(n,inp)=>({type:"setTileRotation", rotation:str(inp,n.data,"rotation",0)}) },
  tint:     { label:"Tint",     pins:[{id:"tint", label:"Tint", type:"value.string"}],
              action:(n,inp)=>({type:"setTileTint", tint:str(inp,n.data,"tint","")}) },
  alpha:    { label:"Alpha",    pins:[{id:"alpha", label:"Alpha", type:"value.number"}],
              action:(n,inp)=>({type:"setTileAlpha", alpha:str(inp,n.data,"alpha",1)}) },
  hidden:   { label:"Hidden",   pins:[],
              action:(n)=>({type:"setTileHidden", mode:String(n.data?.mode ?? "toggle")}) }
};

const LIGHT_PROPERTIES = {
  enabled:   { label:"Enabled",   pins:[], action:(n)=>({type:"setLightEnabled", mode:String(n.data?.mode ?? "toggle")}) },
  radius:    { label:"Radius",    pins:[{id:"bright", label:"Bright", type:"value.number"}, {id:"dim", label:"Dim", type:"value.number"}],
               action:(n,inp)=>({type:"setLightRadius", bright:str(inp,n.data,"bright",0), dim:str(inp,n.data,"dim",0)}) },
  color:     { label:"Color",     pins:[{id:"color", label:"Color", type:"value.string"}],
               action:(n,inp)=>({type:"setLightColor", color:str(inp,n.data,"color","#ffffff")}) },
  alpha:     { label:"Alpha",     pins:[{id:"alpha", label:"Alpha", type:"value.number"}],
               action:(n,inp)=>({type:"setLightAlpha", alpha:str(inp,n.data,"alpha",0.5)}) },
  animation: { label:"Animation", pins:[{id:"speed", label:"Speed", type:"value.number"}, {id:"intensity", label:"Intensity", type:"value.number"}],
               action:(n,inp)=>({type:"setLightAnimation", animType:String(n.data?.animType ?? "torch"), speed:str(inp,n.data,"speed",5), intensity:str(inp,n.data,"intensity",5), reverse:!!n.data?.reverse}) }
};

const WALL_PROPERTIES = {
  doorState:   { label:"Door state",  pins:[], action:(n)=>({type:"setWallDoorState", state:String(n.data?.state ?? "toggle")}) },
  doorType:    { label:"Door type",   pins:[], action:(n)=>({type:"setWallDoorType", doorType:String(n.data?.type ?? "door")}) },
  restriction: { label:"Restriction", pins:[], action:(n)=>({type:"setWallRestriction", kind:String(n.data?.kind ?? "move"), value:String(n.data?.value ?? "none")}) }
};

const LIGHT_ANIMATIONS = ["none","torch","pulse","chroma","wave","fog","sunburst","dome","emanation","hexa","ghost","energy","roiling","hole","vortex","witchwave","rainbowswirl","radialrainbow","fairy","grid","starlight","smokepatch","revolving"];

function propertyNode({ title, desc, keywords, target, properties, defaultProperty, extraFields }) {
  const options = Object.entries(properties).map(([value, p]) => ({ value, label: p.label }));
  const dynamicInputs = (n) => {
    const prop = properties[String(n?.data?.property ?? defaultProperty)] ?? properties[defaultProperty];
    return [{id:"exec", label:"", type:"exec"}, uuidPin(`${target} UUID`), ...prop.pins];
  };
  return {
    title, color:SCENE_COLOR, cat:"Scene", wideNode:true, desc, keywords,
    inputs:[{id:"exec", label:"", type:"exec"}, uuidPin(`${target} UUID`)],
    computeDynamicInputs: dynamicInputs,
    outputs:[{id:"exec", label:"", type:"exec"}],
    fields:[
      {key:"uuid", label:`${target} UUID`, type:"text", default:"", placeholder:`Scene.X.${target}.Y or drag here`},
      {key:"property", label:"Property", type:"select", default:defaultProperty, options},
      ...extraFields
    ],
    isAction:true,
    toAction:(n,inp)=>{
      const prop = properties[String(n.data?.property ?? defaultProperty)] ?? properties[defaultProperty];
      return { ...prop.action(n, inp), uuid: str(inp, n.data, "uuid", "") };
    }
  };
}

export const SCENE_PROPERTY_NODES = {
  act_set_tile_property: propertyNode({
    title:"Set Tile Property", target:"Tile", properties:TILE_PROPERTIES, defaultProperty:"image",
    desc:"Changes one property of a Tile: image, size, position, rotation, tint, alpha or visibility. Pick the property, then fill the matching pins or fields.",
    keywords:"tile image size position rotation tint alpha hidden show hide",
    extraFields:[
      {key:"src",      label:"Image",          type:"text",   default:"",  placeholder:"icons/svg/circle.svg", noPin:true, visibleIf:only("image")},
      {key:"width",    label:"Width (px)",     type:"number", default:100, noPin:true, visibleIf:only("size")},
      {key:"height",   label:"Height (px)",    type:"number", default:100, noPin:true, visibleIf:only("size")},
      {key:"x",        label:"X (px)",         type:"number", default:0,   noPin:true, visibleIf:only("position")},
      {key:"y",        label:"Y (px)",         type:"number", default:0,   noPin:true, visibleIf:only("position")},
      {key:"rotation", label:"Rotation (deg)", type:"number", default:0,   noPin:true, visibleIf:only("rotation")},
      {key:"tint",     label:"Tint (#rrggbb)", type:"text",   default:"",  placeholder:"#ffffff or empty", noPin:true, visibleIf:only("tint")},
      {key:"alpha",    label:"Alpha (0-1)",    type:"number", default:1,   noPin:true, visibleIf:only("alpha")},
      {key:"mode",     label:"Visibility",     type:"select", default:"toggle", options:["toggle","show","hide"], visibleIf:only("hidden")}
    ]
  }),
  act_set_light_property: propertyNode({
    title:"Set Light Property", target:"Light", properties:LIGHT_PROPERTIES, defaultProperty:"enabled",
    desc:"Changes one property of an Ambient Light: on/off, radius, color, alpha or animation.",
    keywords:"light enable disable radius bright dim color alpha animation",
    extraFields:[
      {key:"mode",      label:"Mode",             type:"select", default:"toggle", options:["toggle","enable","disable"], visibleIf:only("enabled")},
      {key:"bright",    label:"Bright",           type:"number", default:0, noPin:true, visibleIf:only("radius")},
      {key:"dim",       label:"Dim",              type:"number", default:0, noPin:true, visibleIf:only("radius")},
      {key:"color",     label:"Color (#rrggbb)",  type:"text",   default:"#ffffff", noPin:true, visibleIf:only("color")},
      {key:"alpha",     label:"Alpha (0-1)",      type:"number", default:0.5, noPin:true, visibleIf:only("alpha")},
      {key:"animType",  label:"Animation",        type:"select", default:"torch", options:LIGHT_ANIMATIONS, visibleIf:only("animation")},
      {key:"speed",     label:"Speed (1-10)",     type:"number", default:5, noPin:true, visibleIf:only("animation")},
      {key:"intensity", label:"Intensity (1-10)", type:"number", default:5, noPin:true, visibleIf:only("animation")},
      {key:"reverse",   label:"Reverse",          type:"checkbox", default:false, visibleIf:only("animation")}
    ]
  }),
  act_set_wall_property: propertyNode({
    title:"Set Wall Property", target:"Wall", properties:WALL_PROPERTIES, defaultProperty:"doorState",
    desc:"Changes one property of a Wall: door state (open / close / lock), door type or a movement / sight / sound / light restriction.",
    keywords:"wall door open close lock secret restriction move sight sound light",
    extraFields:[
      {key:"state", label:"State",       type:"select", default:"toggle", options:["toggle","open","close","lock"], visibleIf:only("doorState")},
      {key:"type",  label:"Type",        type:"select", default:"door",   options:["none","door","secret"], visibleIf:only("doorType")},
      {key:"kind",  label:"Restriction", type:"select", default:"move",   options:["move","sight","sound","light"], visibleIf:only("restriction")},
      {key:"value", label:"Value",       type:"select", default:"none",   options:["none","normal","limited"], visibleIf:only("restriction")}
    ]
  })
};

/** Legacy one-property Scene nodes → merged property nodes (type + preset property). */
export const SCENE_PROPERTY_MIGRATIONS = {
  act_set_tile_image:       ["act_set_tile_property", "image"],
  act_set_tile_size:        ["act_set_tile_property", "size"],
  act_set_tile_position:    ["act_set_tile_property", "position"],
  act_set_tile_rotation:    ["act_set_tile_property", "rotation"],
  act_set_tile_tint:        ["act_set_tile_property", "tint"],
  act_set_tile_alpha:       ["act_set_tile_property", "alpha"],
  act_set_tile_hidden:      ["act_set_tile_property", "hidden"],
  act_set_light_enabled:    ["act_set_light_property", "enabled"],
  act_set_light_radius:     ["act_set_light_property", "radius"],
  act_set_light_color:      ["act_set_light_property", "color"],
  act_set_light_alpha:      ["act_set_light_property", "alpha"],
  act_set_light_animation:  ["act_set_light_property", "animation"],
  act_set_wall_door_state:  ["act_set_wall_property", "doorState"],
  act_set_wall_door_type:   ["act_set_wall_property", "doorType"],
  act_set_wall_restriction: ["act_set_wall_property", "restriction"]
};

export const CORE_EXTRA_NODES = { ...TEXT_NODES, ...DEBUG_NODES, ...LOGIC_NODES, ...FLOW_NODES, ...SCENE_PROPERTY_NODES };
