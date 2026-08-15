import { pickLocale, t } from "./i18n.js";

const KIND_COLOURS = {
  pure:        "#3aa87a",
  imperative:  "#e08a2a",
  event:       "#d04040"
};

const PIN_META = {
  "exec":                { color:"#F5C451", glyph:"▶", short:"Exec", shape:"exec" },
  "value.any":           { color:"#8B93A7", glyph:"?", short:"Any", shape:"circle" },
  "value.number":        { color:"#42A5F5", glyph:"#", short:"Num", shape:"circle" },
  "value.string":        { color:"#E052D1", glyph:"T", short:"Text", shape:"circle" },
  "value.bool":          { color:"#EF5350", glyph:"✓", short:"Bool", shape:"diamond" },
  "value.path":          { color:"#C49A6C", glyph:"/", short:"Path", shape:"diamond" },
  "value.uuid":          { color:"#7E57C2", glyph:"◇", short:"UUID", shape:"diamond" },
  "value.actor":         { color:"#35C98A", glyph:"A", short:"Actor", shape:"capsule" },
  "value.item":          { color:"#F2B84B", glyph:"I", short:"Item", shape:"square" },
  "value.token":         { color:"#26C6DA", glyph:"●", short:"Token", shape:"diamond" },
  "value.array":         { color:"#7C8CFF", glyph:"[]",short:"Array", shape:"array" },
  "value.card":          { color:"#F57C3D", glyph:"C", short:"Card", shape:"square" },
  "value.cards":         { color:"#FFAB5A", glyph:"≡", short:"Cards", shape:"array" },
  "value.token_pool":    { color:"#00BFA5", glyph:"••",short:"Pool", shape:"array" },
  "value.roll_result":   { color:"#3D7DFF", glyph:"⚄", short:"Roll", shape:"hex" },
  "value.effect":        { color:"#B05CFF", glyph:"✦", short:"Effect", shape:"diamond" },
  "value.aoe_template":  { color:"#FF7043", glyph:"◎", short:"AOE", shape:"target" },
  "value.aoe_templates": { color:"#FF8A65", glyph:"◉", short:"AOEs", shape:"array" },
  "value.dialog_result": { color:"#D65DB1", glyph:"▣", short:"Dialog", shape:"square" },
  "value.object":        { color:"#9AA4B8", glyph:"{}",short:"Object", shape:"hex" }
};

export function nodeKind(def) {
  if (!def) return "pure";
  if (def.isEvent || def.isTrigger) return "event";
  const hasExec = (arr) => (arr ?? []).some(p => p?.type === "exec");
  if (hasExec(def.inputs) || hasExec(def.outputs) || def.isAction) return "imperative";
  return "pure";
}

function pinMeta(t) {
  if (!t || t === "value") return PIN_META["value.any"];
  return PIN_META[t] ?? PIN_META["value.any"];
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

function pinRow(p, side ) {
  const isExec = p.type === "exec";
  const cls = ["pin"];
  if (side === "output") cls.push("right");
  if (isExec) cls.push("exec");
  const meta = pinMeta(p.type);
  return elt("span", {
    class: `${cls.join(" ")} pin-shape-${meta.shape}`,
    style: `--pc:${meta.color};`
  }, [
    elt("span", { class: "dot" }, elt("span", { class:"pin-glyph" }, meta.glyph)),
    elt("span", { class: "lbl", style: "max-width:180px;overflow:hidden;text-overflow:ellipsis" }, p.label || ""),
    elt("span", { class:"pin-kind" }, meta.short)
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
  } else if (f.type === "select" && Array.isArray(f.options)) {
    wrap.appendChild(elt("span", { class: "lbl" }, f.label || f.key));
    const sel = elt("select");
    for (const opt of (f.options ?? [])) {
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

  const execIns  = inputs.filter(p => p.type === "exec");
  const execOuts = outputs.filter(p => p.type === "exec");
  const valIns   = inputs.filter(p => p.type !== "exec");
  const valOuts  = outputs.filter(p => p.type !== "exec");

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

  const fieldByKey = Object.fromEntries(fields.map(f => [f.key, f]));
  const valInPins = valIns.concat(dynPins);

  const rowMax = Math.max(valInPins.length, valOuts.length, fields.length);
  let pinIdx = 0, outIdx = 0, fldIdx = 0;
  const used = new Set();

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

export function ghostWire(color = "#7b68ee", w = 36) {
  return elt("div", {
    class: "ex-arrow",
    style: `color:${color};`
  }, "→");
}

export { KIND_COLOURS, PIN_META };
