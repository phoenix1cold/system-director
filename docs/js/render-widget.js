import { pickLocale, t } from "./i18n.js";

function elt(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "style") e.style.cssText = v;
    else if (k === "class") e.className = v;
    else if (k.startsWith("data-")) e.setAttribute(k, v);
    else if (k === "innerHTML") e.innerHTML = v;
    else e[k] = v;
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    if (typeof c === "string") e.appendChild(document.createTextNode(c));
    else e.appendChild(c);
  }
  return e;
}

const PREV = {

  text: (w) => elt("div", { class: "wp-text" }, [
    elt("label", { class: "wp-label" }, w.label ?? "Label"),
    elt("input",  { type: "text", value: "Sample value" })
  ]),

  number: (w) => elt("div", { class: "wp-num" }, [
    elt("label", { class: "wp-label" }, w.label ?? "Value"),
    elt("div", { class: "wp-num-row" }, [
      elt("button", {}, "−"),
      elt("input",  { type: "number", value: 12, style: "width:60px" }),
      elt("button", {}, "+")
    ])
  ]),

  counter: (w) => elt("div", { class: "wp-num" }, [
    elt("label", { class: "wp-label" }, w.label ?? "Counter"),
    elt("div", { class: "wp-num-row" }, [
      elt("button", {}, "−"),
      elt("span", { style: "font-weight:800;font-size:18px" }, "3"),
      elt("button", {}, "+")
    ])
  ]),

  resource: (w) => {
    const fill = w.color ?? "#e05a5a";
    const cur = 18, max = 25;
    return elt("div", { class: "wp-res" }, [
      elt("div", { class: "wp-res-head" }, [
        elt("span", {}, w.label ?? "Resource"),
        elt("span", { class: "wp-res-vals" }, `${cur} / ${max}`)
      ]),
      elt("div", { class: "wp-res-bar" }, [
        elt("div", {
          class: "wp-res-fill",
          style: `width:${(cur/max*100)|0}%;background:${fill}`
        })
      ])
    ]);
  },

  progress: (w) => {
    const fill = w.color ?? "#7b68ee";
    return elt("div", { class: "wp-res" }, [
      elt("div", { class: "wp-res-bar" }, [
        elt("div", { class: "wp-res-fill", style: `width:62%;background:${fill}` })
      ])
    ]);
  },

  dice: (w) => elt("button", { class: "wp-btn" }, [
    elt("i", { class: "fa fa-dice", innerHTML: "🎲" }),
    elt("span", {}, w.label ?? "Roll"), " ",
    elt("code", {}, w.formula ?? "1d20")
  ]),
  button: (w) => elt("button", { class: "wp-btn" }, [
    elt("span", {}, "▶ "),
    elt("span", {}, w.label ?? "Action")
  ]),
  rollButton: (w) => elt("button", { class: "wp-btn" }, [
    elt("span", {}, w.label ?? "Roll Attack"),
  ]),

  toggle: (w) => elt("div", { class: "wp-toggle" }, [
    elt("span", {}, w.label ?? "Toggle"),
    elt("span", { class: "sw on" }, [
      elt("span", { class: "knob" })
    ]),
    elt("span", { class: "wp-mut" }, "On")
  ]),

  attribute: (w) => elt("div", { class: "wp-attr" }, [
    elt("div", { class: "wp-attr-num" }, "16"),
    elt("div", { class: "wp-attr-mod" }, "+3"),
    elt("div", { class: "wp-attr-name" }, w.label ?? "STR")
  ]),

  skill: (w) => elt("div", { class: "wp-skill" }, [
    elt("span", { class: "wp-skill-name" }, w.label ?? "Athletics"),
    elt("input",  { type: "number", value: 4, style: "width:48px" }),
    elt("button", {}, "🎲")
  ]),

  section: (w) => elt("div", { class: "wp-section" }, [
    elt("span", {}, w.label ?? "Section"),
    elt("hr")
  ]),
  vsection: (w) => elt("div", { class: "wp-vsection" }, [
    elt("div", { class: "wp-vsection-title" }, w.label ?? "Group"),
    elt("div", { class: "wp-vsection-body" }, [
      elt("div", { class: "wp-mut" }, "(group of widgets)")
    ])
  ]),

  richtext: (w) => elt("div", { class: "wp-rt" }, [
    elt("div", { class: "wp-rt-row" }, [
      "📝 ", elt("strong", {}, w.label ?? "Notes")
    ]),
    elt("div", { class: "wp-rt-body" },
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit.")
  ]),

  select: (w) => elt("div", { class: "wp-select" }, [
    elt("label", { class: "wp-label" }, w.label ?? "Mode"),
    elt("select", {}, [
      elt("option", {}, "Option A"),
      elt("option", {}, "Option B"),
      elt("option", {}, "Option C")
    ])
  ]),

  slot: (w) => elt("div", { class: "wp-slot" }, [
    elt("div", { class: "wp-slot-title" }, w.label ?? "Slot"),
    elt("div", { class: "wp-slot-list" }, [
      elt("div", { class: "wp-slot-item" }, [
        elt("span", { style: "font-size:18px" }, "⚔️"),
        elt("span", {}, "Longsword"),
        elt("button", {}, "▶"),
        elt("button", {}, "✕")
      ])
    ])
  ]),

  inventory: (w) => elt("div", { class: "wp-inv" }, [
    elt("div", { class: "wp-inv-head" }, [
      elt("span", {}, w.label ?? "Inventory"),
      elt("span", { class: "wp-mut" }, "💰 50 / ⚖ 12.4")
    ]),
    elt("div", { class: "wp-inv-row" }, [
      elt("span", {}, "🛡 Plate Armor"),
      elt("span", { class: "wp-mut" }, "x1"),
      elt("button", {}, "▶")
    ]),
    elt("div", { class: "wp-inv-row" }, [
      elt("span", {}, "🧪 Health Potion"),
      elt("span", { class: "wp-mut" }, "x3"),
      elt("button", {}, "▶")
    ])
  ]),

  effects: (w) => elt("div", { class: "wp-fx" }, [
    elt("div", { class: "wp-inv-head" }, [
      elt("span", {}, w.label ?? "Effects"),
    ]),
    elt("div", { class: "wp-fx-row" }, [
      elt("span", {}, "✨ Bless"),
      elt("span", { class: "wp-mut" }, "1 min"),
    ]),
    elt("div", { class: "wp-fx-row" }, [
      elt("span", {}, "🔥 Burning"),
      elt("span", { class: "wp-mut" }, "3 turns"),
    ])
  ]),

  spellbook: (w) => elt("div", { class: "wp-fx" }, [
    elt("div", { class: "wp-inv-head" }, [
      elt("span", {}, w.label ?? "Spellbook"),
    ]),
    elt("div", { class: "wp-fx-row" }, [
      elt("span", {}, "🔮 Magic Missile"),
      elt("button", {}, "▶")
    ]),
    elt("div", { class: "wp-fx-row" }, [
      elt("span", {}, "🌊 Ice Wave"),
      elt("button", {}, "▶")
    ])
  ]),

  tracker: (w) => {
    const fill = w.color ?? "#7b68ee";
    const empty = w.emptyColor ?? "#3a3a52";
    const wrap = elt("div", { class: "wp-pips" });
    for (let i = 0; i < 6; i++) {
      wrap.appendChild(elt("span", {
        class: "pip",
        style: `background:${i < 4 ? fill : empty}`
      }));
    }
    return wrap;
  },
  clock: (w) => {
    const fill = w.color ?? "#5dd6a8";
    const empty = w.bgColor ?? "#3a3a52";
    const wrap = elt("div", { class: "wp-clock" });
    const total = 8, filled = 5;
    for (let i = 0; i < total; i++) {
      wrap.appendChild(elt("span", {
        class: "seg",
        style: `background:${i < filled ? fill : empty}`
      }));
    }
    return wrap;
  },
  tokenPool: (w) => {
    const fill = w.color ?? "#ffd94a";
    const empty = w.emptyColor ?? "#3a3a52";
    const wrap = elt("div", { class: "wp-pips" });
    for (let i = 0; i < 5; i++) {
      wrap.appendChild(elt("span", {
        class: "pip", style: `background:${i < 3 ? fill : empty}`
      }));
    }
    return wrap;
  },

  diceTray: (w) => elt("div", { class: "wp-tray" }, [
    elt("span", { class: "die" }, "1d6"),
    elt("span", { class: "die" }, "1d8"),
    elt("span", { class: "die" }, "1d10"),
    elt("button", {}, "Roll")
  ]),

  tags: (w) => elt("div", { class: "wp-tags" }, [
    elt("span", { class: "tag", style: `background:${w.color ?? "#7b68ee"}` }, "fire"),
    elt("span", { class: "tag", style: `background:${w.color ?? "#7b68ee"}` }, "lvl 3"),
    elt("span", { class: "tag", style: `background:${w.color ?? "#7b68ee"}` }, "ranged"),
  ]),

  image: (w) => elt("div", { class: "wp-image" }, [
    elt("div", { class: "wp-image-thumb", innerHTML: "🖼️" }),
    elt("div", { class: "wp-image-meta" }, w.label ?? "Portrait")
  ]),

  derived: (w) => elt("div", { class: "wp-derived" }, [
    elt("span", { class: "wp-label" }, w.label ?? "Total Mod"),
    elt("span", { class: "wp-derived-val" }, "+5")
  ]),

  attributeGroup: (w) => elt("button", { class: "wp-btn" }, [
    elt("span", {}, "🎲"),
    elt("span", {}, w.label ?? "Attributes"),
    elt("span", { class: "wp-mut" }, " STR DEX WIS")
  ]),

  cardHand: (w) => elt("div", { class: "wp-inv" }, [
    elt("div", { class: "wp-inv-head" }, [elt("span", {}, w.label ?? "Hand"), elt("span", { class: "wp-mut" }, "5 cards")]),
    elt("div", { style: "display:flex;gap:6px;overflow:hidden" }, [
      elt("div", { class: "wp-image-thumb", innerHTML: "🂡" }),
      elt("div", { class: "wp-image-thumb", innerHTML: "🂱" }),
      elt("div", { class: "wp-image-thumb", innerHTML: "🃁" })
    ])
  ]),

  questMarker: (w) => elt("div", { class: "wp-fx" }, [
    elt("div", { class: "wp-fx-row" }, [elt("span", {}, "🚩 Find the Gate"), elt("span", { class: "wp-mut" }, "active")])
  ]),

  cardDrawButton: (w) => elt("button", { class: "wp-btn" }, [
    elt("span", {}, "▴"), elt("span", {}, w.label ?? "Draw"), elt("span", { class: "wp-mut" }, String(w.count ?? 1))
  ])
};

export function renderWidgetPreview(typeId, def, sample = null) {
  const fn = PREV[typeId] ?? (() => elt("div", { class: "wp-mut" }, "no preview"));
  const data = sample ?? def?.defaults ?? {};
  const shell = elt("div", { class: "wgt-shell" }, [ fn(data) ]);
  return shell;
}
