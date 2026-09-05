import { findWidget } from "./widget-nodes.mjs";
import { SHEET_STYLE_PROPERTIES, coerceSheetStyleValue, normalizeSheetStyle } from "../helpers/sheet-style.mjs";

const OWNER = "sd-style-nodes";
const CATEGORY = "Styles";
const COLOR_GET = "#526ac4";
const COLOR_SET = "#9b52c4";

const b64 = value => { try { return btoa(unescape(encodeURIComponent(String(value ?? "")))); } catch { return ""; } };
const b64d = value => { try { return decodeURIComponent(escape(atob(String(value ?? "")))); } catch { return ""; } };
const arg = value => `b64:${b64(value)}`;
const unarg = raw => { const source = String(raw ?? ""); return source.startsWith("b64:") ? b64d(source.slice(4)) : source; };
const deepClone = value => {
  try { return foundry.utils.deepClone(value); } catch {}
  try { return structuredClone(value); } catch {}
  try { return JSON.parse(JSON.stringify(value)); } catch { return value; }
};
const asBoolean = value => typeof value === "boolean" ? value : !["", "0", "false", "no", "off"].includes(String(value ?? "").trim().toLowerCase());
const asNumber = (value, fallback = 0) => { const number = Number(value); return Number.isFinite(number) ? number : fallback; };
const option = (value, allowed, fallback) => allowed.includes(String(value ?? "")) ? String(value) : fallback;

export const WIDGET_STYLE_PROPERTIES = Object.freeze([
  {key:"variant", label:"Visual variant", type:"string", pin:"value.string"},
  {key:"boxW", label:"Width", type:"number", pin:"value.number"},
  {key:"boxH", label:"Height", type:"number", pin:"value.number"},
  {key:"boxMinH", label:"Minimum height", type:"number", pin:"value.number"},
  {key:"boxMaxH", label:"Maximum height", type:"number", pin:"value.number"},
  {key:"boxBg", label:"Background colour", type:"string", pin:"value.string"},
  {key:"boxFg", label:"Text colour", type:"string", pin:"value.string"},
  {key:"labelColor", label:"Label colour", type:"string", pin:"value.string"},
  {key:"boxBorder", label:"Border colour", type:"string", pin:"value.string"},
  {key:"boxBorderWidth", label:"Border width", type:"number", pin:"value.number"},
  {key:"boxBorderStyle", label:"Border style", type:"string", pin:"value.string", options:["solid","dashed","dotted","double","none"]},
  {key:"boxRadius", label:"Corner radius", type:"number", pin:"value.number"},
  {key:"boxPad", label:"Padding", type:"number", pin:"value.number"},
  {key:"boxMargin", label:"Margin", type:"number", pin:"value.number"},
  {key:"boxGap", label:"Content gap", type:"number", pin:"value.number"},
  {key:"fontSize", label:"Font size", type:"number", pin:"value.number"},
  {key:"labelFontSize", label:"Label font size", type:"number", pin:"value.number"},
  {key:"fontWeight", label:"Font weight", type:"number", pin:"value.number"},
  {key:"textAlign", label:"Text alignment", type:"string", pin:"value.string", options:["left","center","right"]},
  {key:"contentAlign", label:"Content alignment", type:"string", pin:"value.string", options:["start","center","end","stretch"]},
  {key:"opacity", label:"Opacity", type:"number", pin:"value.number"},
  {key:"overflow", label:"Overflow", type:"string", pin:"value.string", options:["visible","hidden","auto","scroll"]},
  {key:"iconColor", label:"Icon colour", type:"string", pin:"value.string"},
  {key:"iconSize", label:"Icon size", type:"number", pin:"value.number"},
  {key:"labelIcon", label:"Label icon", type:"string", pin:"value.string"},
  {key:"labelEmoji", label:"Label emoji", type:"string", pin:"value.string"},
  {key:"labelIconPosition", label:"Adornment position", type:"string", pin:"value.string", options:["before","after"]}
]);

export const TAB_STYLE_PROPERTIES = Object.freeze([
  {key:"label", label:"Label", type:"string", pin:"value.string"},
  {key:"icon", label:"Font Awesome icon", type:"string", pin:"value.string"},
  {key:"emoji", label:"Emoji", type:"string", pin:"value.string"},
  {key:"tooltip", label:"Tooltip", type:"string", pin:"value.string"},
  {key:"color", label:"Accent colour", type:"string", pin:"value.string"},
  {key:"showLabel", label:"Show label", type:"boolean", pin:"value.bool"}
]);

const widgetProperty = key => WIDGET_STYLE_PROPERTIES.find(entry => entry.key === key) ?? WIDGET_STYLE_PROPERTIES[0];
const sheetProperty = key => SHEET_STYLE_PROPERTIES.find(entry => entry.key === key) ?? SHEET_STYLE_PROPERTIES[0];
const tabProperty = key => TAB_STYLE_PROPERTIES.find(entry => entry.key === key) ?? TAB_STYLE_PROPERTIES[0];
const selectOptions = list => list.map(entry => ({value:entry.key, label:entry.label}));
const sourceDocument = ctx => {
  const actor = ctx?.actor ?? ctx?.item?.actor ?? null;
  if (actor?.system?.customTabs) return actor;
  const doc = ctx?.doc ?? ctx?.item ?? actor;
  return doc?.system?.customTabs ? doc : actor ?? doc;
};
const findTab = (doc, key) => {
  const source = String(key ?? "").trim();
  if (!source) return null;
  const loose = source.toLowerCase();
  return (doc?.system?.customTabs ?? []).find(tab => String(tab?.id ?? "") === source)
    ?? (doc?.system?.customTabs ?? []).find(tab => String(tab?.label ?? "").trim().toLowerCase() === loose)
    ?? null;
};
const coerceWidgetStyle = (definition, value) => {
  if (definition.type === "number") {
    const number = asNumber(value);
    if (definition.key === "opacity") return Math.max(0, Math.min(1, number));
    if (definition.key === "fontWeight") return Math.max(100, Math.min(900, number));
    return Math.max(0, Math.min(2000, number));
  }
  const source = String(value ?? "");
  if (definition.options) return option(source, definition.options, definition.options[0]);
  if (definition.key === "labelEmoji") return source.slice(0, 16);
  if (definition.key === "labelIcon") return source.replace(/[^a-z0-9 _-]/gi, "").slice(0, 80);
  return source.slice(0, 500);
};
const coerceTabStyle = (definition, value) => {
  if (definition.type === "boolean") return asBoolean(value);
  if (definition.key === "emoji") return String(value ?? "").slice(0, 16);
  if (definition.key === "icon") return String(value ?? "").replace(/[^a-z0-9 _-]/gi, "").slice(0, 80);
  return String(value ?? "").slice(0, 500);
};

export function installStyleTokens() {
  const runtime = globalThis.SD_NODE_RUNTIME;
  if (!runtime?.registerToken) return;
  runtime.registerToken("sdWidgetStyle:", (rest, ctx) => {
    const [property, ...tail] = String(rest ?? "").split(":");
    const definition = WIDGET_STYLE_PROPERTIES.find(entry => entry.key === property);
    if (!definition) return "";
    const doc = sourceDocument(ctx);
    const widget = findWidget(doc, unarg(tail.join(":")));
    return widget?.[definition.key] ?? "";
  }, {owner:OWNER});
  runtime.registerToken("sdSheetStyle:", (rest, ctx) => {
    const definition = SHEET_STYLE_PROPERTIES.find(entry => entry.key === String(rest ?? ""));
    if (!definition) return "";
    const style = normalizeSheetStyle(sourceDocument(ctx)?.system?.sheetStyle ?? {});
    return style[definition.key] ?? "";
  }, {owner:OWNER});
  runtime.registerToken("sdTabStyle:", (rest, ctx) => {
    const [property, ...tail] = String(rest ?? "").split(":");
    const definition = TAB_STYLE_PROPERTIES.find(entry => entry.key === property);
    if (!definition) return "";
    const tab = findTab(sourceDocument(ctx), unarg(tail.join(":")));
    return tab?.[definition.key] ?? "";
  }, {owner:OWNER});
}

export function installStyleActions() {
  const runtime = globalThis.SD_NODE_RUNTIME;
  if (!runtime?.registerAction) return;
  runtime.registerAction("sdSetWidgetStyle", async ctx => {
    const action = ctx.action ?? {};
    const doc = sourceDocument(ctx);
    if (!doc?.update) return;
    const definition = WIDGET_STYLE_PROPERTIES.find(entry => entry.key === action.property);
    if (!definition) return;
    const tabs = deepClone(doc.system?.customTabs ?? []);
    const proxy = {system:{customTabs:tabs}};
    const widget = findWidget(proxy, unarg(action.widgetKey));
    if (!widget) return console.warn(`[sd] Set Widget Style: no widget matched "${unarg(action.widgetKey)}"`);
    if (String(action.operation ?? "set") === "clear") delete widget[definition.key];
    else {
      const raw = ctx.resolveValue ? await ctx.resolveValue(action.value) : action.value;
      widget[definition.key] = coerceWidgetStyle(definition, raw);
    }
    await doc.update({"system.customTabs":tabs});
  }, {owner:OWNER});

  runtime.registerAction("sdSetSheetStyle", async ctx => {
    const action = ctx.action ?? {};
    const doc = sourceDocument(ctx);
    if (!doc?.update) return;
    const definition = SHEET_STYLE_PROPERTIES.find(entry => entry.key === action.property);
    if (!definition) return;
    const style = {...normalizeSheetStyle(doc.system?.sheetStyle ?? {})};
    if (String(action.operation ?? "set") === "clear") style[definition.key] = normalizeSheetStyle({})[definition.key];
    else {
      const raw = ctx.resolveValue ? await ctx.resolveValue(action.value) : action.value;
      style[definition.key] = coerceSheetStyleValue(definition.key, raw);
    }
    style.preset = "custom";
    await doc.update({"system.sheetStyle":normalizeSheetStyle(style)});
  }, {owner:OWNER});

  runtime.registerAction("sdSetTabStyle", async ctx => {
    const action = ctx.action ?? {};
    const doc = sourceDocument(ctx);
    if (!doc?.update) return;
    const definition = TAB_STYLE_PROPERTIES.find(entry => entry.key === action.property);
    if (!definition) return;
    const tabs = deepClone(doc.system?.customTabs ?? []);
    const tab = findTab({system:{customTabs:tabs}}, unarg(action.tabKey));
    if (!tab) return console.warn(`[sd] Set Tab Style: no tab matched "${unarg(action.tabKey)}"`);
    if (String(action.operation ?? "set") === "clear") delete tab[definition.key];
    else {
      const raw = ctx.resolveValue ? await ctx.resolveValue(action.value) : action.value;
      tab[definition.key] = coerceTabStyle(definition, raw);
    }
    await doc.update({"system.customTabs":tabs});
  }, {owner:OWNER});
}

export function registerStyleNodes() {
  const registry = globalThis.SD?.nodeRegistry ?? globalThis.CONFIG?.SD?.nodeRegistry;
  const registerNode = registry?.registerNode ?? registry?.registerNodeDefinition;
  const registerCategory = registry?.registerCategory ?? registry?.registerNodeCategory;
  if (!registerNode) return;
  try { registerCategory?.({id:CATEGORY, color:COLOR_GET}, {owner:OWNER}); } catch {}

  registerNode("style_get_widget", {
    title:"Get Widget Style", color:COLOR_GET, cat:CATEGORY, wideNode:true,
    desc:"Read one allow-listed visual property from a placed widget.",
    inputs:[{id:"widgetKey", label:"Widget", type:"value.string"}],
    outputs:[{id:"value", label:"Style value", type:"value.any"}],
    fields:[
      {key:"widgetKey", label:"Widget", type:"widget-picker", default:"", allowManual:true},
      {key:"property", label:"Property", type:"select", default:"boxH", options:selectOptions(WIDGET_STYLE_PROPERTIES), noPin:true}
    ],
    computeDynamicOutputs:n => [{id:"value", label:widgetProperty(n?.data?.property).label, type:widgetProperty(n?.data?.property).pin}],
    compile:(n, i) => `{sdWidgetStyle:${widgetProperty(n?.data?.property).key}:${arg(i.widgetKey ?? n.data?.widgetKey ?? "")}}`,
    compilePin:(n, i) => `{sdWidgetStyle:${widgetProperty(n?.data?.property).key}:${arg(i.widgetKey ?? n.data?.widgetKey ?? "")}}`
  }, {owner:OWNER});

  registerNode("style_set_widget", {
    title:"Set Widget Style", color:COLOR_SET, cat:CATEGORY, wideNode:true, isAction:true,
    desc:"Set or clear one allow-listed visual property on a placed widget.",
    inputs:[{id:"exec",label:"",type:"exec"},{id:"widgetKey",label:"Widget",type:"value.string"},{id:"value",label:"Value",type:"value.any"}],
    outputs:[{id:"exec",label:"Then →",type:"exec"}],
    fields:[
      {key:"widgetKey",label:"Widget",type:"widget-picker",default:"",allowManual:true},
      {key:"property",label:"Property",type:"select",default:"boxH",options:selectOptions(WIDGET_STYLE_PROPERTIES),noPin:true},
      {key:"operation",label:"Operation",type:"select",default:"set",options:[{value:"set",label:"Set"},{value:"clear",label:"Reset to default"}],noPin:true},
      {key:"value",label:"Value",type:"text",default:""}
    ],
    toAction:(n, inp={}) => ({type:"sdSetWidgetStyle",widgetKey:arg(inp.widgetKey ?? n.data?.widgetKey ?? ""),property:widgetProperty(n.data?.property).key,operation:n.data?.operation ?? "set",value:inp.value ?? n.data?.value ?? ""})
  }, {owner:OWNER});

  registerNode("style_get_sheet", {
    title:"Get Sheet Style", color:COLOR_GET, cat:CATEGORY, wideNode:true,
    desc:"Read one character-sheet appearance setting.", inputs:[], outputs:[{id:"value",label:"Style value",type:"value.any"}],
    fields:[{key:"property",label:"Property",type:"select",default:"layout",options:selectOptions(SHEET_STYLE_PROPERTIES),noPin:true}],
    computeDynamicOutputs:n => [{id:"value",label:sheetProperty(n?.data?.property).label,type:sheetProperty(n?.data?.property).pin}],
    compile:n => `{sdSheetStyle:${sheetProperty(n?.data?.property).key}}`, compilePin:n => `{sdSheetStyle:${sheetProperty(n?.data?.property).key}}`
  }, {owner:OWNER});

  registerNode("style_set_sheet", {
    title:"Set Sheet Style", color:COLOR_SET, cat:CATEGORY, wideNode:true, isAction:true,
    desc:"Set or reset one character-sheet appearance setting.",
    inputs:[{id:"exec",label:"",type:"exec"},{id:"value",label:"Value",type:"value.any"}], outputs:[{id:"exec",label:"Then →",type:"exec"}],
    fields:[
      {key:"property",label:"Property",type:"select",default:"layout",options:selectOptions(SHEET_STYLE_PROPERTIES),noPin:true},
      {key:"operation",label:"Operation",type:"select",default:"set",options:[{value:"set",label:"Set"},{value:"clear",label:"Reset to default"}],noPin:true},
      {key:"value",label:"Value",type:"text",default:""}
    ],
    toAction:(n, inp={}) => ({type:"sdSetSheetStyle",property:sheetProperty(n.data?.property).key,operation:n.data?.operation ?? "set",value:inp.value ?? n.data?.value ?? ""})
  }, {owner:OWNER});

  registerNode("style_get_tab", {
    title:"Get Tab Style", color:COLOR_GET, cat:CATEGORY, wideNode:true,
    desc:"Read a tab label, icon, emoji, tooltip or colour.",
    inputs:[{id:"tabKey",label:"Tab id / label",type:"value.string"}], outputs:[{id:"value",label:"Tab value",type:"value.any"}],
    fields:[
      {key:"tabKey",label:"Tab id / label",type:"text",default:""},
      {key:"property",label:"Property",type:"select",default:"icon",options:selectOptions(TAB_STYLE_PROPERTIES),noPin:true}
    ],
    computeDynamicOutputs:n => [{id:"value",label:tabProperty(n?.data?.property).label,type:tabProperty(n?.data?.property).pin}],
    compile:(n,i) => `{sdTabStyle:${tabProperty(n?.data?.property).key}:${arg(i.tabKey ?? n.data?.tabKey ?? "")}}`,
    compilePin:(n,i) => `{sdTabStyle:${tabProperty(n?.data?.property).key}:${arg(i.tabKey ?? n.data?.tabKey ?? "")}}`
  }, {owner:OWNER});

  registerNode("style_set_tab", {
    title:"Set Tab Style", color:COLOR_SET, cat:CATEGORY, wideNode:true, isAction:true,
    desc:"Set or reset a tab label, icon, emoji, tooltip, colour or label visibility.",
    inputs:[{id:"exec",label:"",type:"exec"},{id:"tabKey",label:"Tab id / label",type:"value.string"},{id:"value",label:"Value",type:"value.any"}], outputs:[{id:"exec",label:"Then →",type:"exec"}],
    fields:[
      {key:"tabKey",label:"Tab id / label",type:"text",default:""},
      {key:"property",label:"Property",type:"select",default:"icon",options:selectOptions(TAB_STYLE_PROPERTIES),noPin:true},
      {key:"operation",label:"Operation",type:"select",default:"set",options:[{value:"set",label:"Set"},{value:"clear",label:"Reset to default"}],noPin:true},
      {key:"value",label:"Value",type:"text",default:""}
    ],
    toAction:(n, inp={}) => ({type:"sdSetTabStyle",tabKey:arg(inp.tabKey ?? n.data?.tabKey ?? ""),property:tabProperty(n.data?.property).key,operation:n.data?.operation ?? "set",value:inp.value ?? n.data?.value ?? ""})
  }, {owner:OWNER});
}

export function initStyleNodes() {
  installStyleTokens();
  installStyleActions();
  if (globalThis.SD?.nodeRegistry) registerStyleNodes();
  else Hooks.once("sdNodeRegistryReady", () => registerStyleNodes());
}
