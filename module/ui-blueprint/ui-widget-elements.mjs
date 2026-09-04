/**
 * UMG-style element registry.
 *
 * This is the module's own widget vocabulary, modelled on Unreal Engine's UMG
 * palette (panels + common + input + data), independent of the system's
 * sheet-oriented `WIDGET_TYPES`. System widgets stay reachable through the
 * `sdwidget` bridge element, so dice/resource/attribute/card widgets can still
 * be dropped into a window when an actor context exists.
 *
 * Element record (stored in `item.system.elements`, flat list, parent links):
 *
 *   {
 *     id, type, name, parent,                  // parent "" = root
 *     x, y, w, h, z,                           // canvas slot (px)
 *     anchor, padding, grow, hAlign, vAlign,   // box/anchor slot
 *     props: {…}, style: {…},
 *     bind:  { <propKey>: "<formula>" },       // UMG-style property bindings
 *     events:{ onClick: { formula, graphData }, … },
 *     locked, hidden
 *   }
 *
 * Every render function returns a DOM node. `api` supplies reads, writes,
 * bindings, child rendering and event emission (see ui-widget-runtime.mjs).
 */

export const ELEMENT_CATEGORIES = [
  { id: "panel",  label: "SDUI.Cat.Panel",  icon: "fa-layer-group" },
  { id: "common", label: "SDUI.Cat.Common", icon: "fa-shapes" },
  { id: "input",  label: "SDUI.Cat.Input",  icon: "fa-keyboard" },
  { id: "data",   label: "SDUI.Cat.Data",   icon: "fa-database" },
  { id: "sd",     label: "SDUI.Cat.SD",     icon: "fa-dice-d20" }
];

export const ANCHOR_PRESETS = [
  "top-left", "top-center", "top-right",
  "middle-left", "center", "middle-right",
  "bottom-left", "bottom-center", "bottom-right",
  "stretch-h", "stretch-v", "fill"
];

// ---------------------------------------------------------------------------
// Small DOM helpers
// ---------------------------------------------------------------------------

export function h(tag, { cls = "", style = "", attrs = {}, text = "", html = "" } = {}) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (style) node.setAttribute("style", style);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    node.setAttribute(k, String(v));
  }
  if (text) node.textContent = String(text);
  else if (html) node.innerHTML = html;
  return node;
}

function px(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function boolish(v) {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return false;
  return !["0", "false", "no", "off", "none"].includes(s);
}

/** Text style block shared by most elements. */
function textStyle(style = {}) {
  const out = [];
  if (style.color) out.push(`color:${style.color}`);
  if (style.fontSize) out.push(`font-size:${px(style.fontSize, 14)}px`);
  if (style.fontWeight) out.push(`font-weight:${style.fontWeight}`);
  if (style.fontFamily) out.push(`font-family:${style.fontFamily}`);
  if (style.align) out.push(`text-align:${style.align}`);
  if (style.lineHeight) out.push(`line-height:${style.lineHeight}`);
  if (style.italic) out.push("font-style:italic");
  if (style.uppercase) out.push("text-transform:uppercase");
  return out.join(";");
}

/** Box style block shared by panels and framed elements. */
export function boxStyle(style = {}) {
  const out = [];
  if (style.bg) out.push(`background:${style.bg}`);
  if (style.borderColor) out.push(`border:${px(style.borderWidth, 1)}px ${style.borderStyle || "solid"} ${style.borderColor}`);
  else if (style.borderWidth) out.push(`border:${px(style.borderWidth)}px ${style.borderStyle || "solid"} currentColor`);
  if (style.radius !== undefined && style.radius !== "") out.push(`border-radius:${px(style.radius)}px`);
  if (style.padding !== undefined && style.padding !== "") out.push(`padding:${px(style.padding)}px`);
  if (style.opacity !== undefined && style.opacity !== "") out.push(`opacity:${style.opacity}`);
  if (style.shadow) out.push(`box-shadow:${style.shadow}`);
  if (style.backdrop) out.push(`backdrop-filter:blur(${px(style.backdrop, 4)}px)`);
  return out.join(";");
}

const COMMON_STYLE_PROPS = [
  { key: "bg",          label: "SDUI.Prop.Background",  type: "color",  group: "appearance", style: true, bindable: true },
  { key: "color",       label: "SDUI.Prop.TextColor",   type: "color",  group: "appearance", style: true, bindable: true },
  { key: "borderColor", label: "SDUI.Prop.BorderColor", type: "color",  group: "appearance", style: true },
  { key: "borderWidth", label: "SDUI.Prop.BorderWidth", type: "number", group: "appearance", style: true },
  { key: "radius",      label: "SDUI.Prop.Radius",      type: "number", group: "appearance", style: true },
  { key: "padding",     label: "SDUI.Prop.Padding",     type: "number", group: "appearance", style: true },
  { key: "opacity",     label: "SDUI.Prop.Opacity",     type: "number", group: "appearance", style: true, bindable: true }
];

const FONT_STYLE_PROPS = [
  { key: "fontSize",   label: "SDUI.Prop.FontSize",   type: "number", group: "appearance", style: true },
  { key: "fontWeight", label: "SDUI.Prop.FontWeight", type: "select", group: "appearance", style: true,
    options: ["", "400", "500", "600", "700", "800"] },
  { key: "align",      label: "SDUI.Prop.Align",      type: "select", group: "appearance", style: true,
    options: ["left", "center", "right", "justify"] },
  { key: "uppercase",  label: "SDUI.Prop.Uppercase",  type: "checkbox", group: "appearance", style: true },
  { key: "italic",     label: "SDUI.Prop.Italic",     type: "checkbox", group: "appearance", style: true }
];

/** Properties every element carries, shown in the Behaviour group. */
export const UNIVERSAL_PROPS = [
  { key: "tooltip",  label: "SDUI.Prop.Tooltip",  type: "text",     group: "behaviour", bindable: true },
  { key: "visible",  label: "SDUI.Prop.Visible",  type: "checkbox", group: "behaviour", default: true, bindable: true },
  { key: "enabled",  label: "SDUI.Prop.Enabled",  type: "checkbox", group: "behaviour", default: true, bindable: true },
  { key: "cssClass", label: "SDUI.Prop.CssClass", type: "text",     group: "behaviour" }
];

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/** @type {Record<string, object>} */
export const UI_ELEMENT_TYPES = {};

function define(id, def) {
  UI_ELEMENT_TYPES[id] = {
    id,
    container: false,
    events: [],
    props: [],
    defaults: {},
    ...def
  };
}

// ------------------------------- panels ------------------------------------

define("canvas", {
  label: "SDUI.El.Canvas", icon: "fa-object-group", cat: "panel", container: true,
  desc: "SDUI.El.CanvasDesc",
  defaults: { w: 400, h: 300, style: { bg: "rgba(0,0,0,.15)", radius: 6 } },
  props: [
    { key: "childLayout", label: "SDUI.Prop.ChildLayout", type: "select", group: "content", default: "free",
      options: ["free", "grid"] },
    { key: "columns", label: "SDUI.Prop.Columns", type: "number", group: "content", default: 2 },
    { key: "gap", label: "SDUI.Prop.Gap", type: "number", group: "content", default: 6 },
    { key: "clip", label: "SDUI.Prop.Clip", type: "checkbox", group: "content", default: true },
    ...COMMON_STYLE_PROPS
  ],
  render(el, api) {
    const free = (el.props?.childLayout ?? "free") !== "grid";
    // Clipping is a runtime concern; in the designer a child dragged past the
    // edge must stay visible, otherwise it looks like it vanished.
    const clip = boolish(el.props?.clip ?? true) && !api.editMode;
    const style = [
      "position:relative",
      free ? "" : `display:grid;grid-template-columns:repeat(${Math.max(1, px(el.props?.columns, 2))},minmax(0,1fr));gap:${px(el.props?.gap, 6)}px`,
      clip ? "overflow:hidden" : "overflow:visible",
      boxStyle(el.style)
    ].filter(Boolean).join(";");
    const node = h("div", { cls: "uiw-panel uiw-canvas", style });
    api.renderChildren(el, node, { free, grid: !free });
    return node;
  }
});

function defineBox(id, dir, label, icon) {
  define(id, {
    label, icon, cat: "panel", container: true,
    desc: dir === "column" ? "SDUI.El.VBoxDesc" : "SDUI.El.HBoxDesc",
    defaults: { w: 240, h: 160, props: { gap: 6, justify: "flex-start", align: "stretch" } },
    props: [
      { key: "gap", label: "SDUI.Prop.Gap", type: "number", group: "content", default: 6 },
      { key: "justify", label: "SDUI.Prop.Justify", type: "select", group: "content", default: "flex-start",
        options: ["flex-start", "center", "flex-end", "space-between", "space-around"] },
      { key: "align", label: "SDUI.Prop.AlignItems", type: "select", group: "content", default: "stretch",
        options: ["stretch", "flex-start", "center", "flex-end"] },
      { key: "wrap", label: "SDUI.Prop.Wrap", type: "checkbox", group: "content", default: false },
      { key: "scroll", label: "SDUI.Prop.Scroll", type: "checkbox", group: "content", default: false },
      ...COMMON_STYLE_PROPS
    ],
    render(el, api) {
      const p = el.props ?? {};
      const style = [
        `display:flex;flex-direction:${dir}`,
        `gap:${px(p.gap, 6)}px`,
        `justify-content:${p.justify || "flex-start"}`,
        `align-items:${p.align || "stretch"}`,
        boolish(p.wrap) ? "flex-wrap:wrap" : "",
        boolish(p.scroll) ? (dir === "column" ? "overflow-y:auto" : "overflow-x:auto") : "",
        boxStyle(el.style)
      ].filter(Boolean).join(";");
      const node = h("div", { cls: `uiw-panel uiw-${id}`, style });
      api.renderChildren(el, node, { free: false });
      return node;
    }
  });
}
defineBox("vbox", "column", "SDUI.El.VBox", "fa-bars");
defineBox("hbox", "row", "SDUI.El.HBox", "fa-grip-lines-vertical");

define("grid", {
  label: "SDUI.El.Grid", icon: "fa-table-cells", cat: "panel", container: true,
  desc: "SDUI.El.GridDesc",
  defaults: { w: 300, h: 200, props: { columns: 3, gap: 6 } },
  props: [
    { key: "columns", label: "SDUI.Prop.Columns", type: "number", group: "content", default: 3 },
    { key: "gap", label: "SDUI.Prop.Gap", type: "number", group: "content", default: 6 },
    { key: "rowHeight", label: "SDUI.Prop.RowHeight", type: "text", group: "content", default: "auto" },
    ...COMMON_STYLE_PROPS
  ],
  render(el, api) {
    const p = el.props ?? {};
    const style = [
      `display:grid;grid-template-columns:repeat(${Math.max(1, px(p.columns, 3))},minmax(0,1fr))`,
      `grid-auto-rows:${p.rowHeight || "auto"}`,
      `gap:${px(p.gap, 6)}px`,
      boxStyle(el.style)
    ].join(";");
    const node = h("div", { cls: "uiw-panel uiw-grid", style });
    api.renderChildren(el, node, { free: false, grid: true });
    return node;
  }
});

define("border", {
  label: "SDUI.El.Border", icon: "fa-square", cat: "panel", container: true,
  desc: "SDUI.El.BorderDesc",
  defaults: { w: 220, h: 120, style: { bg: "rgba(0,0,0,.35)", borderColor: "#6a6a6a", borderWidth: 1, radius: 8, padding: 8 } },
  props: [
    { key: "title", label: "SDUI.Prop.Title", type: "text", group: "content", bindable: true },
    { key: "gap", label: "SDUI.Prop.Gap", type: "number", group: "content", default: 6 },
    ...COMMON_STYLE_PROPS,
    ...FONT_STYLE_PROPS
  ],
  render(el, api) {
    const style = ["display:flex;flex-direction:column", `gap:${px(el.props?.gap, 6)}px`, boxStyle(el.style)].join(";");
    const node = h("div", { cls: "uiw-panel uiw-border", style });
    const title = api.value(el, "title");
    if (title) node.appendChild(h("div", { cls: "uiw-border-title", style: textStyle(el.style), text: title }));
    const body = h("div", { cls: "uiw-border-body", style: "position:relative;flex:1;min-height:0" });
    node.appendChild(body);
    api.renderChildren(el, body, { free: true });
    return node;
  }
});

define("scrollbox", {
  label: "SDUI.El.ScrollBox", icon: "fa-scroll", cat: "panel", container: true,
  desc: "SDUI.El.ScrollBoxDesc",
  defaults: { w: 240, h: 200, props: { gap: 6, direction: "column" } },
  props: [
    { key: "direction", label: "SDUI.Prop.Direction", type: "select", group: "content", default: "column",
      options: ["column", "row"] },
    { key: "gap", label: "SDUI.Prop.Gap", type: "number", group: "content", default: 6 },
    ...COMMON_STYLE_PROPS
  ],
  render(el, api) {
    const dir = el.props?.direction === "row" ? "row" : "column";
    const style = [
      `display:flex;flex-direction:${dir};gap:${px(el.props?.gap, 6)}px`,
      dir === "column" ? "overflow-y:auto;overflow-x:hidden" : "overflow-x:auto;overflow-y:hidden",
      boxStyle(el.style)
    ].join(";");
    const node = h("div", { cls: "uiw-panel uiw-scrollbox", style });
    api.renderChildren(el, node, { free: false });
    return node;
  }
});

define("overlay", {
  label: "SDUI.El.Overlay", icon: "fa-clone", cat: "panel", container: true,
  desc: "SDUI.El.OverlayDesc",
  defaults: { w: 200, h: 120 },
  props: [...COMMON_STYLE_PROPS],
  render(el, api) {
    const node = h("div", { cls: "uiw-panel uiw-overlay", style: `position:relative;${boxStyle(el.style)}` });
    api.renderChildren(el, node, { free: true, stretch: true });
    return node;
  }
});

// ------------------------------- common ------------------------------------

define("label", {
  label: "SDUI.El.Label", icon: "fa-font", cat: "common",
  desc: "SDUI.El.LabelDesc",
  defaults: { w: 160, h: 28, props: { text: "Label" }, style: { fontSize: 14 } },
  props: [
    { key: "text", label: "SDUI.Prop.Text", type: "text", group: "content", default: "Label", bindable: true },
    { key: "wrap", label: "SDUI.Prop.Wrap", type: "checkbox", group: "content", default: false },
    { key: "vcenter", label: "SDUI.Prop.VCenter", type: "checkbox", group: "content", default: true },
    ...COMMON_STYLE_PROPS, ...FONT_STYLE_PROPS
  ],
  render(el, api) {
    const p = el.props ?? {};
    const style = [
      boolish(p.vcenter ?? true) ? "display:flex;align-items:center" : "display:block",
      boolish(p.wrap) ? "white-space:normal" : "white-space:nowrap;overflow:hidden;text-overflow:ellipsis",
      p.align === "center" ? "justify-content:center" : p.align === "right" ? "justify-content:flex-end" : "",
      textStyle(el.style), boxStyle(el.style)
    ].filter(Boolean).join(";");
    return h("div", { cls: "uiw-label", style, text: api.value(el, "text") });
  }
});

define("richtext", {
  label: "SDUI.El.RichText", icon: "fa-align-left", cat: "common",
  desc: "SDUI.El.RichTextDesc",
  defaults: { w: 260, h: 120, props: { html: "<p>Rich text</p>" } },
  props: [
    { key: "html", label: "SDUI.Prop.Html", type: "textarea", group: "content", default: "", bindable: true },
    { key: "scroll", label: "SDUI.Prop.Scroll", type: "checkbox", group: "content", default: true },
    ...COMMON_STYLE_PROPS, ...FONT_STYLE_PROPS
  ],
  render(el, api) {
    const style = [
      boolish(el.props?.scroll ?? true) ? "overflow:auto" : "overflow:hidden",
      textStyle(el.style), boxStyle(el.style)
    ].filter(Boolean).join(";");
    return h("div", { cls: "uiw-richtext", style, html: String(api.value(el, "html") ?? "") });
  }
});

define("image", {
  label: "SDUI.El.Image", icon: "fa-image", cat: "common",
  desc: "SDUI.El.ImageDesc",
  defaults: { w: 96, h: 96, props: { src: "icons/svg/mystery-man.svg", fit: "contain" } },
  props: [
    { key: "src", label: "SDUI.Prop.Source", type: "image", group: "content", default: "", bindable: true },
    { key: "fit", label: "SDUI.Prop.Fit", type: "select", group: "content", default: "contain",
      options: ["contain", "cover", "fill", "none"] },
    { key: "tint", label: "SDUI.Prop.Tint", type: "color", group: "appearance", bindable: true },
    ...COMMON_STYLE_PROPS
  ],
  events: ["onClick"],
  render(el, api) {
    const p = el.props ?? {};
    const src = String(api.value(el, "src") ?? "");
    const tint = api.value(el, "tint");
    const style = [
      "width:100%;height:100%;display:block",
      `object-fit:${p.fit || "contain"}`,
      tint ? `filter:drop-shadow(0 0 0 ${tint})` : "",
      boxStyle(el.style)
    ].filter(Boolean).join(";");
    const img = h("img", { cls: "uiw-image", style, attrs: { src, alt: el.name ?? "" } });
    if (api.hasEvent(el, "onClick")) {
      img.style.cursor = "pointer";
      api.bindClick(img, el);
    }
    return img;
  }
});

define("icon", {
  label: "SDUI.El.Icon", icon: "fa-icons", cat: "common",
  desc: "SDUI.El.IconDesc",
  defaults: { w: 40, h: 40, props: { icon: "fa-solid fa-star", size: 22 } },
  props: [
    { key: "icon", label: "SDUI.Prop.Icon", type: "text", group: "content", default: "fa-solid fa-star", bindable: true },
    { key: "size", label: "SDUI.Prop.IconSize", type: "number", group: "appearance", default: 22 },
    ...COMMON_STYLE_PROPS
  ],
  events: ["onClick"],
  render(el, api) {
    const style = ["display:flex;align-items:center;justify-content:center;width:100%;height:100%",
      `font-size:${px(el.props?.size, 22)}px`, textStyle(el.style), boxStyle(el.style)].join(";");
    const wrap = h("div", { cls: "uiw-icon", style });
    wrap.appendChild(h("i", { cls: String(api.value(el, "icon") ?? "fa-solid fa-star") }));
    if (api.hasEvent(el, "onClick")) {
      wrap.style.cursor = "pointer";
      api.bindClick(wrap, el);
    }
    return wrap;
  }
});

define("button", {
  label: "SDUI.El.Button", icon: "fa-hand-pointer", cat: "common",
  desc: "SDUI.El.ButtonDesc",
  defaults: { w: 160, h: 34, props: { text: "Button", variant: "primary" } },
  props: [
    { key: "text", label: "SDUI.Prop.Text", type: "text", group: "content", default: "Button", bindable: true },
    { key: "icon", label: "SDUI.Prop.Icon", type: "text", group: "content", default: "", bindable: true },
    { key: "variant", label: "SDUI.Prop.Variant", type: "select", group: "appearance", default: "primary",
      options: ["primary", "secondary", "ghost", "danger", "success"] },
    { key: "value", label: "SDUI.Prop.ClickValue", type: "text", group: "behaviour", default: "", bindable: true },
    { key: "confirm", label: "SDUI.Prop.Confirm", type: "checkbox", group: "behaviour", default: false },
    ...COMMON_STYLE_PROPS, ...FONT_STYLE_PROPS
  ],
  events: ["onClick"],
  render(el, api) {
    const p = el.props ?? {};
    const style = ["width:100%;height:100%", textStyle(el.style), boxStyle(el.style)].filter(Boolean).join(";");
    const btn = h("button", {
      cls: `uiw-button uiw-variant-${p.variant || "primary"}`,
      style,
      attrs: { type: "button" }
    });
    const icon = api.value(el, "icon");
    if (icon) btn.appendChild(h("i", { cls: String(icon) }));
    const text = api.value(el, "text");
    if (text) btn.appendChild(h("span", { text }));
    if (!api.enabled(el)) btn.disabled = true;
    api.bindClick(btn, el, { value: api.value(el, "value"), confirm: boolish(p.confirm) });
    return btn;
  }
});

define("progress", {
  label: "SDUI.El.Progress", icon: "fa-bars-progress", cat: "common",
  desc: "SDUI.El.ProgressDesc",
  defaults: { w: 200, h: 24, props: { value: "0", max: "100", showLabel: true, color: "#3aa76d" } },
  props: [
    { key: "value", label: "SDUI.Prop.Value", type: "formula", group: "data", default: "0", bindable: true },
    { key: "max", label: "SDUI.Prop.Max", type: "formula", group: "data", default: "100", bindable: true },
    { key: "showLabel", label: "SDUI.Prop.ShowLabel", type: "checkbox", group: "content", default: true },
    { key: "showPercent", label: "SDUI.Prop.ShowPercent", type: "checkbox", group: "content", default: false },
    { key: "mode", label: "Display Mode", type: "select", group: "content", default: "bar", options: ["bar", "segments", "pips", "radial"] },
    { key: "segments", label: "Segments", type: "number", group: "content", default: 10 },
    { key: "color", label: "SDUI.Prop.BarColor", type: "color", group: "appearance", default: "#3aa76d", bindable: true },
    { key: "track", label: "SDUI.Prop.TrackColor", type: "color", group: "appearance", default: "rgba(0,0,0,.5)" },
    { key: "vertical", label: "SDUI.Prop.Vertical", type: "checkbox", group: "appearance", default: false },
    ...COMMON_STYLE_PROPS, ...FONT_STYLE_PROPS
  ],
  render(el, api) {
    const p = el.props ?? {};
    const value = Number(api.number(el, "value", 0));
    const max = Number(api.number(el, "max", 100)) || 1;
    const pct = Math.max(0, Math.min(100, (value / max) * 100));
    const vertical = boolish(p.vertical);
    const mode=p.mode??"bar";
    const wrap = h("div", {
      cls: `uiw-progress uiw-meter-${mode}`,
      style: ["position:relative;width:100%;height:100%;overflow:hidden",
        `background:${p.track || "rgba(0,0,0,.5)"}`,
        `border-radius:${px(el.style?.radius, 4)}px`, boxStyle(el.style)].join(";")
    });
    if(mode==="radial"){
      wrap.style.background=`conic-gradient(${api.value(el,"color")||"#3aa76d"} ${pct}%,${p.track||"rgba(0,0,0,.5)"} 0)`;wrap.style.borderRadius="50%";
    }else if(mode==="segments"||mode==="pips"){
      wrap.style.display="flex";wrap.style.gap="3px";wrap.style.background="transparent";const count=Math.max(1,Math.round(Number(p.segments??10)));const filled=Math.round(pct/100*count);for(let i=0;i<count;i++){const pip=h("span",{cls:`uiw-meter-segment ${i<filled?"is-filled":""}`});pip.style.cssText=`flex:1;height:100%;border-radius:3px;background:${i<filled?(api.value(el,"color")||"#3aa76d"):(p.track||"rgba(0,0,0,.5)")}`;wrap.appendChild(pip)}
    }else wrap.appendChild(h("div", {
      cls: "uiw-progress-fill",
      style: vertical
        ? `position:absolute;left:0;right:0;bottom:0;height:${pct}%;background:${api.value(el, "color") || "#3aa76d"}`
        : `position:absolute;left:0;top:0;bottom:0;width:${pct}%;background:${api.value(el, "color") || "#3aa76d"}`
    }));
    if (boolish(p.showLabel ?? true) || boolish(p.showPercent)) {
      const text = boolish(p.showPercent) ? `${Math.round(pct)}%` : `${value} / ${max}`;
      wrap.appendChild(h("span", {
        cls: "uiw-progress-label",
        style: `position:absolute;inset:0;display:flex;align-items:center;justify-content:center;${textStyle(el.style)}`,
        text
      }));
    }
    return wrap;
  }
});

define("separator", {
  label: "SDUI.El.Separator", icon: "fa-grip-lines", cat: "common",
  desc: "SDUI.El.SeparatorDesc",
  defaults: { w: 200, h: 8, props: { thickness: 1, color: "#666" } },
  props: [
    { key: "thickness", label: "SDUI.Prop.Thickness", type: "number", group: "appearance", default: 1 },
    { key: "color", label: "SDUI.Prop.LineColor", type: "color", group: "appearance", default: "#666" },
    { key: "vertical", label: "SDUI.Prop.Vertical", type: "checkbox", group: "appearance", default: false }
  ],
  render(el) {
    const p = el.props ?? {};
    const t = px(p.thickness, 1);
    const style = boolish(p.vertical)
      ? `width:${t}px;height:100%;margin:0 auto;background:${p.color || "#666"}`
      : `height:${t}px;width:100%;margin:auto 0;background:${p.color || "#666"}`;
    return h("div", { cls: "uiw-separator", style });
  }
});

define("spacer", {
  label: "SDUI.El.Spacer", icon: "fa-arrows-left-right-to-line", cat: "common",
  desc: "SDUI.El.SpacerDesc",
  defaults: { w: 40, h: 20 },
  props: [],
  render() { return h("div", { cls: "uiw-spacer", style: "width:100%;height:100%" }); }
});

// ------------------------------- input -------------------------------------

/** Shared props for anything that reads/writes a value. */
const VALUE_PROPS = [
  { key: "default", label: "SDUI.Prop.Default", type: "text", group: "data", default: "" }
];

define("textbox", {
  label: "SDUI.El.TextBox", icon: "fa-i-cursor", cat: "input",
  desc: "SDUI.El.TextBoxDesc",
  defaults: { w: 200, h: 30, props: { placeholder: "" } },
  props: [
    ...VALUE_PROPS,
    { key: "placeholder", label: "SDUI.Prop.Placeholder", type: "text", group: "content", default: "" },
    { key: "readOnly", label: "SDUI.Prop.ReadOnly", type: "checkbox", group: "behaviour", default: false },
    { key: "commitOn", label: "SDUI.Prop.CommitOn", type: "select", group: "behaviour", default: "change",
      options: ["change", "input"] },
    ...COMMON_STYLE_PROPS, ...FONT_STYLE_PROPS
  ],
  events: ["onChange", "onSubmit"],
  render(el, api) {
    const p = el.props ?? {};
    const input = h("input", {
      cls: "uiw-input",
      style: ["width:100%;height:100%", textStyle(el.style), boxStyle(el.style)].join(";"),
      attrs: { type: "text", placeholder: p.placeholder ?? "" }
    });
    input.value = String(api.boundValue(el, "") ?? "");
    if (boolish(p.readOnly) || !api.enabled(el)) input.readOnly = true;
    api.bindValueInput(input, el, { event: p.commitOn === "input" ? "input" : "change" });
    input.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter") return;
      api.emit(el, "submit", input.value);
    });
    return input;
  }
});

define("textarea", {
  label: "SDUI.El.TextArea", icon: "fa-paragraph", cat: "input",
  desc: "SDUI.El.TextAreaDesc",
  defaults: { w: 240, h: 100 },
  props: [
    ...VALUE_PROPS,
    { key: "placeholder", label: "SDUI.Prop.Placeholder", type: "text", group: "content", default: "" },
    { key: "readOnly", label: "SDUI.Prop.ReadOnly", type: "checkbox", group: "behaviour", default: false },
    ...COMMON_STYLE_PROPS, ...FONT_STYLE_PROPS
  ],
  events: ["onChange"],
  render(el, api) {
    const ta = h("textarea", {
      cls: "uiw-input uiw-textarea",
      style: ["width:100%;height:100%;resize:none", textStyle(el.style), boxStyle(el.style)].join(";"),
      attrs: { placeholder: el.props?.placeholder ?? "" }
    });
    ta.value = String(api.boundValue(el, "") ?? "");
    if (boolish(el.props?.readOnly) || !api.enabled(el)) ta.readOnly = true;
    api.bindValueInput(ta, el, { event: "change" });
    return ta;
  }
});

define("number", {
  label: "SDUI.El.Number", icon: "fa-hashtag", cat: "input",
  desc: "SDUI.El.NumberDesc",
  defaults: { w: 140, h: 30, props: { min: 0, max: 100, step: 1, spinners: true } },
  props: [
    ...VALUE_PROPS,
    { key: "min", label: "SDUI.Prop.Min", type: "formula", group: "data", default: "0", bindable: true },
    { key: "max", label: "SDUI.Prop.Max", type: "formula", group: "data", default: "100", bindable: true },
    { key: "step", label: "SDUI.Prop.Step", type: "number", group: "data", default: 1 },
    { key: "spinners", label: "SDUI.Prop.Spinners", type: "checkbox", group: "content", default: true },
    ...COMMON_STYLE_PROPS, ...FONT_STYLE_PROPS
  ],
  events: ["onChange"],
  render(el, api) {
    const p = el.props ?? {};
    const min = api.number(el, "min", 0);
    const max = api.number(el, "max", 100);
    const step = px(p.step, 1) || 1;
    const wrap = h("div", {
      cls: "uiw-number",
      style: ["display:flex;align-items:stretch;width:100%;height:100%", boxStyle(el.style)].join(";")
    });
    const input = h("input", {
      cls: "uiw-input",
      style: ["flex:1;min-width:0;text-align:center", textStyle(el.style)].join(";"),
      attrs: { type: "number", min, max, step }
    });
    input.value = String(Number(api.boundValue(el, 0)) || 0);
    if (!api.enabled(el)) input.disabled = true;
    api.bindValueInput(input, el, { event: "change", numeric: true, min, max });
    if (boolish(p.spinners ?? true)) {
      const mk = (delta, icon) => {
        const b = h("button", { cls: "uiw-step", attrs: { type: "button" } });
        b.appendChild(h("i", { cls: icon }));
        b.addEventListener("click", async (ev) => {
          ev.preventDefault();
          const cur = Number(input.value) || 0;
          const next = Math.max(min, Math.min(max, cur + delta * step));
          input.value = String(next);
          await api.commitValue(el, next);
        });
        return b;
      };
      wrap.appendChild(mk(-1, "fa-solid fa-minus"));
      wrap.appendChild(input);
      wrap.appendChild(mk(1, "fa-solid fa-plus"));
    } else {
      wrap.appendChild(input);
    }
    return wrap;
  }
});

define("slider", {
  label: "SDUI.El.Slider", icon: "fa-sliders", cat: "input",
  desc: "SDUI.El.SliderDesc",
  defaults: { w: 200, h: 30, props: { min: 0, max: 100, step: 1, showValue: true } },
  props: [
    ...VALUE_PROPS,
    { key: "min", label: "SDUI.Prop.Min", type: "formula", group: "data", default: "0", bindable: true },
    { key: "max", label: "SDUI.Prop.Max", type: "formula", group: "data", default: "100", bindable: true },
    { key: "step", label: "SDUI.Prop.Step", type: "number", group: "data", default: 1 },
    { key: "showValue", label: "SDUI.Prop.ShowValue", type: "checkbox", group: "content", default: true },
    { key: "live", label: "SDUI.Prop.LiveUpdate", type: "checkbox", group: "behaviour", default: false },
    ...COMMON_STYLE_PROPS, ...FONT_STYLE_PROPS
  ],
  events: ["onChange"],
  render(el, api) {
    const p = el.props ?? {};
    const min = api.number(el, "min", 0);
    const max = api.number(el, "max", 100);
    const wrap = h("div", {
      cls: "uiw-slider",
      style: ["display:flex;align-items:center;gap:6px;width:100%;height:100%", boxStyle(el.style)].join(";")
    });
    const input = h("input", {
      cls: "uiw-range",
      style: "flex:1;min-width:0",
      attrs: { type: "range", min, max, step: px(p.step, 1) || 1 }
    });
    input.value = String(Number(api.boundValue(el, min)) || min);
    if (!api.enabled(el)) input.disabled = true;
    const out = boolish(p.showValue ?? true)
      ? h("span", { cls: "uiw-slider-value", style: textStyle(el.style), text: input.value })
      : null;
    input.addEventListener("input", () => { if (out) out.textContent = input.value; });
    api.bindValueInput(input, el, { event: boolish(p.live) ? "input" : "change", numeric: true, min, max });
    wrap.appendChild(input);
    if (out) wrap.appendChild(out);
    return wrap;
  }
});

define("checkbox", {
  label: "SDUI.El.Checkbox", icon: "fa-square-check", cat: "input",
  desc: "SDUI.El.CheckboxDesc",
  defaults: { w: 160, h: 26, props: { text: "Option" } },
  props: [
    ...VALUE_PROPS,
    { key: "text", label: "SDUI.Prop.Text", type: "text", group: "content", default: "Option", bindable: true },
    ...COMMON_STYLE_PROPS, ...FONT_STYLE_PROPS
  ],
  events: ["onChange"],
  render(el, api) {
    const wrap = h("label", {
      cls: "uiw-checkbox",
      style: ["display:flex;align-items:center;gap:6px;width:100%;height:100%", textStyle(el.style), boxStyle(el.style)].join(";")
    });
    const input = h("input", { attrs: { type: "checkbox" } });
    input.checked = boolish(api.boundValue(el, false));
    if (!api.enabled(el)) input.disabled = true;
    api.bindValueInput(input, el, { event: "change", boolean: true });
    wrap.appendChild(input);
    wrap.appendChild(h("span", { text: api.value(el, "text") }));
    return wrap;
  }
});

define("switch", {
  label: "SDUI.El.Switch", icon: "fa-toggle-on", cat: "input",
  desc: "SDUI.El.SwitchDesc",
  defaults: { w: 140, h: 30, props: { onLabel: "On", offLabel: "Off" } },
  props: [
    ...VALUE_PROPS,
    { key: "onLabel", label: "SDUI.Prop.OnLabel", type: "text", group: "content", default: "On" },
    { key: "offLabel", label: "SDUI.Prop.OffLabel", type: "text", group: "content", default: "Off" },
    { key: "onColor", label: "SDUI.Prop.OnColor", type: "color", group: "appearance", default: "#3aa76d" },
    { key: "offColor", label: "SDUI.Prop.OffColor", type: "color", group: "appearance", default: "#5a5a5a" },
    ...COMMON_STYLE_PROPS, ...FONT_STYLE_PROPS
  ],
  events: ["onChange"],
  render(el, api) {
    const p = el.props ?? {};
    const on = boolish(api.boundValue(el, false));
    const btn = h("button", {
      cls: `uiw-switch ${on ? "is-on" : "is-off"}`,
      style: ["width:100%;height:100%", `background:${on ? (p.onColor || "#3aa76d") : (p.offColor || "#5a5a5a")}`,
        textStyle(el.style), boxStyle(el.style)].join(";"),
      attrs: { type: "button" },
      text: on ? (p.onLabel ?? "On") : (p.offLabel ?? "Off")
    });
    if (!api.enabled(el)) btn.disabled = true;
    btn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      await api.commitValue(el, !on);
    });
    return btn;
  }
});

define("dropdown", {
  label: "SDUI.El.Dropdown", icon: "fa-caret-down", cat: "input",
  desc: "SDUI.El.DropdownDesc",
  defaults: { w: 180, h: 30, props: { choices: "One,Two,Three" } },
  props: [
    ...VALUE_PROPS,
    { key: "choices", label: "SDUI.Prop.Choices", type: "text", group: "data", default: "", bindable: true,
      hint: "SDUI.Hint.Choices" },
    ...COMMON_STYLE_PROPS, ...FONT_STYLE_PROPS
  ],
  events: ["onChange"],
  render(el, api) {
    const raw = String(api.value(el, "choices") ?? "");
    const choices = raw.split(/[,;|]/).map(s => s.trim()).filter(Boolean);
    const select = h("select", {
      cls: "uiw-input uiw-select",
      style: ["width:100%;height:100%", textStyle(el.style), boxStyle(el.style)].join(";")
    });
    const current = String(api.boundValue(el, "") ?? "");
    for (const choice of choices) {
      const [value, label] = choice.includes("=") ? choice.split("=") : [choice, choice];
      const opt = h("option", { attrs: { value }, text: label });
      if (value === current) opt.selected = true;
      select.appendChild(opt);
    }
    if (!api.enabled(el)) select.disabled = true;
    api.bindValueInput(select, el, { event: "change" });
    return select;
  }
});

define("radiogroup", {
  label: "SDUI.El.RadioGroup", icon: "fa-list-check", cat: "input",
  desc: "SDUI.El.RadioGroupDesc",
  defaults: { w: 200, h: 90, props: { choices: "One,Two,Three", direction: "column" } },
  props: [
    ...VALUE_PROPS,
    { key: "choices", label: "SDUI.Prop.Choices", type: "text", group: "data", default: "", bindable: true },
    { key: "direction", label: "SDUI.Prop.Direction", type: "select", group: "content", default: "column",
      options: ["column", "row"] },
    { key: "pills", label: "SDUI.Prop.PillStyle", type: "checkbox", group: "appearance", default: false },
    ...COMMON_STYLE_PROPS, ...FONT_STYLE_PROPS
  ],
  events: ["onChange"],
  render(el, api) {
    const p = el.props ?? {};
    const choices = String(api.value(el, "choices") ?? "").split(/[,;|]/).map(s => s.trim()).filter(Boolean);
    const current = String(api.boundValue(el, "") ?? "");
    const wrap = h("div", {
      cls: "uiw-radiogroup",
      style: [`display:flex;flex-direction:${p.direction === "row" ? "row" : "column"};gap:4px;width:100%;height:100%`,
        p.direction === "row" ? "align-items:center" : "", "overflow:auto", boxStyle(el.style)].filter(Boolean).join(";")
    });
    for (const choice of choices) {
      const [value, label] = choice.includes("=") ? choice.split("=") : [choice, choice];
      if (boolish(p.pills)) {
        const pill = h("button", {
          cls: `uiw-pill ${value === current ? "is-active" : ""}`,
          style: textStyle(el.style), attrs: { type: "button" }, text: label
        });
        pill.addEventListener("click", async (ev) => { ev.preventDefault(); await api.commitValue(el, value); });
        wrap.appendChild(pill);
        continue;
      }
      const row = h("label", { cls: "uiw-radio", style: `display:flex;align-items:center;gap:6px;${textStyle(el.style)}` });
      const input = h("input", { attrs: { type: "radio", name: `uiw-${el.id}` } });
      input.checked = value === current;
      input.addEventListener("change", async () => { if (input.checked) await api.commitValue(el, value); });
      row.appendChild(input);
      row.appendChild(h("span", { text: label }));
      wrap.appendChild(row);
    }
    return wrap;
  }
});

define("colorpick", {
  label: "SDUI.El.ColorPick", icon: "fa-palette", cat: "input",
  desc: "SDUI.El.ColorPickDesc",
  defaults: { w: 120, h: 30 },
  props: [...VALUE_PROPS, ...COMMON_STYLE_PROPS],
  events: ["onChange"],
  render(el, api) {
    const input = h("input", {
      cls: "uiw-input uiw-color",
      style: ["width:100%;height:100%", boxStyle(el.style)].join(";"),
      attrs: { type: "color" }
    });
    const value = String(api.boundValue(el, "#ffffff") ?? "#ffffff");
    input.value = /^#[0-9a-f]{6}$/i.test(value) ? value : "#ffffff";
    if (!api.enabled(el)) input.disabled = true;
    api.bindValueInput(input, el, { event: "change" });
    return input;
  }
});

// -------------------------------- data -------------------------------------

define("list", {
  label: "SDUI.El.List", icon: "fa-list", cat: "data",
  desc: "SDUI.El.ListDesc",
  defaults: { w: 240, h: 160, props: { source: "", rowTemplate: "{item}", rowHeight: 26 } },
  props: [
    { key: "source", label: "SDUI.Prop.Source", type: "formula", group: "data", default: "", bindable: true,
      hint: "SDUI.Hint.ListSource" },
    { key: "rowTemplate", label: "SDUI.Prop.RowTemplate", type: "text", group: "content", default: "{item}",
      hint: "SDUI.Hint.RowTemplate" },
    { key: "labelKey", label: "SDUI.Prop.LabelKey", type: "text", group: "data", default: "name" },
    { key: "valueKey", label: "SDUI.Prop.ValueKey", type: "text", group: "data", default: "" },
    { key: "rowHeight", label: "SDUI.Prop.RowHeight", type: "number", group: "appearance", default: 26 },
    { key: "selectable", label: "SDUI.Prop.Selectable", type: "checkbox", group: "behaviour", default: true },
    { key: "showIcons", label: "SDUI.Prop.ShowIcons", type: "checkbox", group: "appearance", default: true },
    { key: "emptyText", label: "SDUI.Prop.EmptyText", type: "text", group: "content", default: "" },
    ...COMMON_STYLE_PROPS, ...FONT_STYLE_PROPS
  ],
  events: ["onClick", "onChange"],
  render(el, api) {
    const p = el.props ?? {};
    const raw = api.value(el, "source");

    // Lists accept a real array (from a node), a JSON array, or comma/newline text.
    let rows = [];
    if (Array.isArray(raw)) rows = raw;
    else {
      const text = String(raw ?? "").trim();
      if (text.startsWith("[")) { try { const parsed = JSON.parse(text); rows = Array.isArray(parsed) ? parsed : []; } catch { rows = []; } }
      if (!rows.length && text) rows = text.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
    }

    const labelKey = String(p.labelKey ?? "name") || "name";
    const valueKey = String(p.valueKey ?? "");
    const labelOf = item => {
      if (item && typeof item === "object") return String(item[labelKey] ?? item.label ?? item.name ?? item.value ?? JSON.stringify(item));
      return String(item ?? "");
    };
    const valueOf = item => {
      if (item && typeof item === "object") return valueKey ? (item[valueKey] ?? "") : item;
      return item;
    };
    const iconOf = item => (item && typeof item === "object") ? String(item.img ?? item.icon ?? "") : "";

    const wrap = h("div", {
      cls: "uiw-list",
      style: ["display:flex;flex-direction:column;gap:2px;width:100%;height:100%;overflow:auto", boxStyle(el.style)].join(";")
    });
    if (!rows.length) {
      if (p.emptyText) wrap.appendChild(h("div", { cls: "uiw-list-empty", style: textStyle(el.style), text: p.emptyText }));
      return wrap;
    }

    const template = String(p.rowTemplate ?? "{item}");
    const selected = api.state?.getVariable?.(`${el.name ?? el.id}__index`);
    rows.forEach((item, index) => {
      const label = labelOf(item);
      const text = template.replaceAll("{item}", label).replaceAll("{index}", String(index + 1));
      const row = h("div", {
        cls: `uiw-list-row${Number(selected) === index ? " is-selected" : ""}`,
        style: [`min-height:${px(p.rowHeight, 26)}px;display:flex;align-items:center;gap:6px;padding:0 6px`, textStyle(el.style)].join(";")
      });
      const img = iconOf(item);
      if (img && boolish(p.showIcons ?? true)) {
        row.appendChild(h("img", { style: `width:${px(p.rowHeight, 26) - 8}px;height:${px(p.rowHeight, 26) - 8}px;object-fit:cover;border-radius:3px;flex:0 0 auto`, attrs: { src: img, alt: "" } }));
      }
      row.appendChild(h("span", { style: "flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap", text }));

      // Every row is clickable: it commits the row value and fires the click event.
      if (boolish(p.selectable ?? true)) {
        row.style.cursor = "pointer";
        row.addEventListener("click", async () => {
          const value = valueOf(item);
          try { await api.state?.setVariable?.(`${el.name ?? el.id}__index`, index); } catch {}
          await api.commitValue(el, value, { silentEvent: true });
          api.emit(el, "click", value, { index, item, label, count: rows.length });
          api.emit(el, "change", value, { index, item, label, count: rows.length });
        });
      }
      wrap.appendChild(row);
    });
    return wrap;
  }
});

define("timer", {
  label: "SDUI.El.Timer", icon: "fa-stopwatch", cat: "data",
  desc: "SDUI.El.TimerDesc",
  defaults: { w: 140, h: 34, props: { seconds: 60, autoStart: true, format: "mm:ss" } },
  props: [
    { key: "seconds", label: "SDUI.Prop.Seconds", type: "formula", group: "data", default: "60", bindable: true },
    { key: "autoStart", label: "SDUI.Prop.AutoStart", type: "checkbox", group: "behaviour", default: true },
    { key: "format", label: "SDUI.Prop.Format", type: "select", group: "content", default: "mm:ss",
      options: ["mm:ss", "ss", "hh:mm:ss"] },
    ...COMMON_STYLE_PROPS, ...FONT_STYLE_PROPS
  ],
  events: ["onTick", "onFinished"],
  render(el, api) {
    const total = Math.max(0, Math.round(api.number(el, "seconds", 60)));
    const node = h("div", {
      cls: "uiw-timer",
      style: ["display:flex;align-items:center;justify-content:center;width:100%;height:100%",
        textStyle(el.style), boxStyle(el.style)].join(";")
    });
    const fmt = (secs) => {
      const s = Math.max(0, secs);
      const hh = String(Math.floor(s / 3600)).padStart(2, "0");
      const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
      const ss = String(s % 60).padStart(2, "0");
      if (el.props?.format === "ss") return String(s);
      if (el.props?.format === "hh:mm:ss") return `${hh}:${mm}:${ss}`;
      return `${mm}:${ss}`;
    };
    let left = total;
    node.textContent = fmt(left);
    if (!api.editMode && boolish(el.props?.autoStart ?? true)) {
      const handle = setInterval(() => {
        if (!node.isConnected) { clearInterval(handle); return; }
        left -= 1;
        node.textContent = fmt(left);
        api.emit(el, "tick", left);
        if (left <= 0) {
          clearInterval(handle);
          api.emit(el, "finished", 0);
        }
      }, 1000);
      api.onTeardown(() => clearInterval(handle));
    }
    return node;
  }
});

// ------------------------------ SD bridge ----------------------------------

define("sdwidget", {
  label: "SDUI.El.SDWidget", icon: "fa-dice-d20", cat: "sd",
  desc: "SDUI.El.SDWidgetDesc",
  defaults: { w: 220, h: 60, props: { widget: null } },
  props: [
    { key: "widgetType", label: "SDUI.Prop.WidgetType", type: "sdWidgetType", group: "data", default: "" },
    { key: "widget", label: "SDUI.Prop.WidgetConfig", type: "sdWidgetConfig", group: "data" }
  ],
  events: ["onClick", "onChange"],
  /** Rendered by the runtime through the system's WidgetRenderer. */
  render(el, api) {
    return api.renderSystemWidget(el);
  }
});

// ---------------------------------------------------------------------------
// Palette / helpers
// ---------------------------------------------------------------------------

export const PALETTE_ORDER = [
  "canvas", "vbox", "hbox", "grid", "border", "scrollbox", "overlay",
  "label", "richtext", "image", "icon", "button", "progress", "separator", "spacer",
  "textbox", "textarea", "number", "slider", "checkbox", "switch", "dropdown", "radiogroup", "colorpick",
  "list", "timer",
  "sdwidget"
];

export function elementDef(type) {
  return UI_ELEMENT_TYPES[String(type ?? "")] ?? null;
}

export function isContainer(type) {
  return !!elementDef(type)?.container;
}

/** Full property schema for the details panel, including universal props. */
export function propSchema(type) {
  const def = elementDef(type);
  if (!def) return [...UNIVERSAL_PROPS];
  return [...(def.props ?? []), ...UNIVERSAL_PROPS];
}

/** Create a fresh element record of `type`. */
export function createElement(type, overrides = {}) {
  const def = elementDef(type);
  const d = def?.defaults ?? {};
  const props = {};
  for (const p of (def?.props ?? [])) {
    if (p.style) continue;
    if (p.default !== undefined) props[p.key] = p.default;
  }
  const base = {
    id: foundry.utils.randomID(10),
    type,
    name: "",
    parent: "",
    x: 16, y: 16,
    w: d.w ?? 160, h: d.h ?? 32, z: 0,
    anchor: "top-left",
    grow: 0,
    props: { ...props, ...(d.props ?? {}) },
    style: { ...(d.style ?? {}) },
    bind: {},
    events: {},
    locked: false,
    hidden: false
  };
  const merged = foundry.utils.mergeObject(base, overrides, { inplace: false, insertKeys: true });
  if (!merged.name) merged.name = `${type}_${merged.id.slice(0, 4)}`;
  merged.widgetId = merged.id;
  return merged;
}
