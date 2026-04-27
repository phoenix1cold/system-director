// Render a single node-graph node visually, in the same style as the
// in-module formula-graph editor. Pure DOM, no Foundry deps.
//
// Call:
//   const el = renderNode(def, { showFields: true, scale: 1 });
//   container.appendChild(el);

import { pickLocale, t } from "./i18n.js";

const KIND_COLOURS = {
  pure:        "#3aa87a",
  imperative:  "#e08a2a",
  event:       "#d04040"
};

const PIN_COLOURS = {
  "exec":         "#ffca6b",
  "value.any":    "#9aa1b2",
  "value.number": "#74c0ff",
  "value.string": "#e06bff",
  "value.bool":   "#ff7b7b",
  "value.path":   "#c8a268",
  "value.uuid":   "#a76bff",
  "value.actor":  "#5dd6a8",
  "value.item":   "#ffd94a",
  "value.token":  "#3ec8e0",
  "value.array":  "#d0d0d0"
};

export function nodeKind(def) {
  if (!def) return "pure";
  if (def.isEvent || def.isTrigger) return "event";
  const hasExec = (arr) => (arr ?? []).some(p => p?.type === "exec");
  if (hasExec(def.inputs) || hasExec(def.outputs) || def.isAction) return "imperative";
  return "pure";
}

function pinColor(t) {
  if (!t) return PIN_COLOURS["value.any"];
  if (t === "exec") return PIN_COLOURS.exec;
  if (t === "value") return PIN_COLOURS["value.any"];
  return PIN_COLOURS[t] ?? PIN_COLOURS["value.any"];
}

function elt(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "style") e.style.cssText = v;
    else if (k === "class") e.className = v;
    else if (k.startsWith("data-")) e.setAttribute(k, v);
    else e[k] = v;
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    if (typeof c === "string") e.appendChild(document.createTextNode(c));
    else e.appendChild(c);
  }
  return e;
}

function pinRow(p, side /* "input" | "output" */) {
  const isExec = p.type === "exec";
  const cls = ["pin"];
  if (side === "output") cls.push("right");
  if (isExec) cls.push("exec");
  const color = pinColor(p.type);
  return elt("span", {
    class: cls.join(" "),
    style: `--pc:${color};`
  }, [
    elt("span", { class: "dot" }),
    elt("span", { class: "lbl", style: "max-width:180px;overflow:hidden;text-overflow:ellipsis" }, p.label || "")
  ]);
}

function fieldRow(f, value) {
  const wrap = elt("div", { class: "field" });
  const display = value !== undefined ? value : (f.def ?? f.placeholder ?? "");
  if (f.type === "bool" || f.type === "checkbox") {
    wrap.appendChild(elt("span", { class: "lbl" }, f.label || f.key));
    const cb = elt("input", { type: "checkbox", style: "flex:0 0 auto" });
    cb.checked = !!display;
    wrap.appendChild(cb);
  } else if (f.type === "select" && f.options) {
    wrap.appendChild(elt("span", { class: "lbl" }, f.label || f.key));
    const sel = elt("select");
    for (const opt of f.options) {
      const o = elt("option", { value: opt.value ?? opt.id ?? opt }, opt.label ?? opt);
      if ((opt.value ?? opt.id ?? opt) === display) o.selected = true;
      sel.appendChild(o);
    }
    wrap.appendChild(sel);
  } else if (f.type === "textarea") {
    wrap.appendChild(elt("span", { class: "lbl" }, f.label || f.key));
    const ta = elt("textarea", { rows: 1 });
    ta.value = String(display ?? "");
    wrap.appendChild(ta);
  } else {
    wrap.appendChild(elt("span", { class: "lbl" }, f.label || f.key));
    const inp = elt("input", { type: f.type === "number" ? "number" : "text" });
    inp.value = String(display ?? "");
    wrap.appendChild(inp);
  }
  return wrap;
}

/**
 * Render one node card.
 * @param {object} def - node definition (from nodes.json)
 * @param {object} opts
 * @param {boolean} [opts.showFields=true]
 * @param {object}  [opts.data]   pre-filled field values
 * @param {string}  [opts.title]  override title
 * @param {number}  [opts.width]  fixed width override
 */
export function renderNode(def, opts = {}) {
  const showFields = opts.showFields !== false;
  const kind   = nodeKind(def);
  const accent = KIND_COLOURS[kind];
  const headerColor = def.color ?? "#5b6a8c";

  const node = elt("div", {
    class: "node",
    style: `--accent:${accent};` +
           `--accent-strong:${headerColor}dd;--accent-soft:${headerColor}99;` +
           (opts.width ? `width:${opts.width}px;` : "")
  });

  // Header
  const hdr = elt("div", { class: "nhdr" }, [
    opts.title ?? pickLocale(def.title, def.id)
  ]);
  if (def.cat) hdr.appendChild(elt("small", {}, def.cat));
  node.appendChild(hdr);

  const body = elt("div", { class: "nbody" });
  node.appendChild(body);

  const inputs  = def.inputs ?? [];
  const outputs = def.outputs ?? [];
  const fields  = def.fields ?? [];

  // dynamic pin preview (only show one extra dynamic pin slot)
  const dynPins = [];
  if (def.dynamicPins) {
    const groups = Array.isArray(def.dynamicPins) ? def.dynamicPins : [{ ...def.dynamicPins, label: "Slot" }];
    for (const g of groups) {
      const lbl = g.label ?? "Slot";
      const tp  = g.type ?? "value.any";
      dynPins.push({ id: `${g.base}0`, label: `${lbl} 1`, type: tp });
      dynPins.push({ id: `${g.base}1`, label: `${lbl} 2…`, type: tp, dim: true });
    }
  }

  // exec inputs row
  const execIns  = inputs.filter(p => p.type === "exec");
  const execOuts = outputs.filter(p => p.type === "exec");
  const valIns   = inputs.filter(p => p.type !== "exec");
  const valOuts  = outputs.filter(p => p.type !== "exec");

  // Top exec row(s): show input + first output exec on same row
  const execRowCount = Math.max(execIns.length, execOuts.length);
  for (let i = 0; i < execRowCount; i++) {
    const row = elt("div", { class: "nrow" });
    const left = elt("div", { class: "left" });
    const right = elt("div", { class: "right" });
    if (execIns[i])  left.appendChild(pinRow(execIns[i], "input"));
    if (execOuts[i]) right.appendChild(pinRow(execOuts[i], "output"));
    row.appendChild(left); row.appendChild(right);
    body.appendChild(row);
  }

  // Field rows mixed with pin rows like in editor
  const fieldByKey = Object.fromEntries(fields.map(f => [f.key, f]));
  const valInPins = valIns.concat(dynPins);

  const rowMax = Math.max(valInPins.length, valOuts.length, fields.length);
  let pinIdx = 0, outIdx = 0, fldIdx = 0;
  const used = new Set();

  // Strategy: pair input pins with same-key fields inline, then leftovers.
  const data = opts.data ?? {};
  for (const p of valInPins) {
    const row = elt("div", { class: "nrow" });
    const left = elt("div", { class: "left" });
    const right = elt("div", { class: "right" });
    left.appendChild(pinRow(p, "input"));
    if (showFields && fieldByKey[p.id]) {
      left.appendChild(fieldRow(fieldByKey[p.id], data[p.id]));
      used.add(p.id);
    }
    if (valOuts[outIdx]) { right.appendChild(pinRow(valOuts[outIdx], "output")); outIdx++; }
    row.appendChild(left); row.appendChild(right);
    body.appendChild(row);
  }

  // Fields without matching pins
  if (showFields) {
    for (const f of fields) {
      if (used.has(f.key)) continue;
      const row = elt("div", { class: "nrow" });
      const left = elt("div", { class: "left" });
      const right = elt("div", { class: "right" });
      left.appendChild(fieldRow(f, data[f.key]));
      if (valOuts[outIdx]) { right.appendChild(pinRow(valOuts[outIdx], "output")); outIdx++; }
      row.appendChild(left); row.appendChild(right);
      body.appendChild(row);
    }
  }

  // Remaining outputs
  while (valOuts[outIdx]) {
    const row = elt("div", { class: "nrow" });
    const left = elt("div", { class: "left" });
    const right = elt("div", { class: "right" });
    right.appendChild(pinRow(valOuts[outIdx], "output"));
    outIdx++;
    row.appendChild(left); row.appendChild(right);
    body.appendChild(row);
  }

  return node;
}

/** Convenience: build a small "wire" between two anchored nodes for examples. */
export function ghostWire(color = "#7b68ee", w = 36) {
  return elt("div", {
    class: "ex-arrow",
    style: `color:${color};`
  }, "→");
}

export { KIND_COLOURS, PIN_COLOURS };
