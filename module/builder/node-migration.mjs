export const NODE_TYPE_MIGRATIONS = {

  get_path: {
    newType: "get_value",
    dataMap: d => ({ source: d?.source ?? "self", variableId: d?.variableId ?? "", legacyPath: d?.legacyPath ?? d?.path ?? "" })
  },

  ui_set_variable_v2: {
    newType: "ui_set_variable_v3",
    externalTarget: true
  },

  ui_open_widget: {
    newType: "ui_blueprint_call",
    externalTarget: true,
    dataMap: (d) => ({
      blueprintId: String(d?.widgetKey ?? d?.blueprintId ?? ""),
      audience: String(d?.audience ?? "self"),
      users: String(d?.users ?? ""),
      mode: String(d?.mode ?? ""),
      unique: d?.unique ?? "yes",
      title: String(d?.title ?? "")
    })
  },

  get_var: {
    newType: "var_read",
    dataMap: (d) => ({
      scope: "actor",
      name: String(d?.name ?? "myVar"),
      default: String(d?.default ?? "0")
    })
  },

  var_get: {
    newType: "var_read",
    dataMap: (d) => ({
      scope: "local",
      name: String(d?.name ?? "myVar"),
      default: String(d?.default ?? "0")
    })
  },

  act_set_var: {
    newType: "var_write",
    dataMap: (d) => ({
      scope: String(d?.scope ?? "actor"),
      name: String(d?.name ?? "myVar")
    })
  },

  var_set: {
    newType: "var_write",
    dataMap: (d) => ({
      scope: "local",
      name: String(d?.name ?? "myVar")
    })
  },

  arr_at: {
    newType: "arr_get",
    dataMap: (d) => ({
      i: Number.isFinite(Number(d?.index)) ? Number(d.index) : 0,
      def: ""
    }),
    pinMapIn: { tokens: "a", index: "i" }
  },

  arr_sum_num: {
    newType: "arr_aggregate",
    dataMap: () => ({ op: "sum" })
  },

  arr_avg_num: {
    newType: "arr_aggregate",
    dataMap: () => ({ op: "avg" })
  },

  arr_min_num: {
    newType: "arr_aggregate",
    dataMap: () => ({ op: "min" })
  },

  arr_max_num: {
    newType: "arr_aggregate",
    dataMap: () => ({ op: "max" })
  },

  arr_random_pick: {
    newType: "arr_random_from",
    dataMap: (d) => ({ n: Number.isFinite(Number(d?.n)) ? Number(d.n) : 1 }),
    pinMapIn: { a: "a0" },
    pinMapOut: { v: "arr" }
  },

  get_actor_name: {
    newType: "actor_token_info",
    pinMapOut: { v: "actorName" }
  },

  get_token_name: {
    newType: "actor_token_info",
    pinMapOut: { v: "tokenName" }
  },

  get_actor_portrait: {
    newType: "actor_token_info",
    pinMapOut: { v: "portrait" }
  },

  get_actor_token_image: {
    newType: "actor_token_info",
    pinMapOut: { v: "tokenImage" }
  },

  quest_activate: {
    newType: "quest_set_state",
    dataMap: (d) => ({ ...d, state: "activate" })
  },

  quest_complete: {
    newType: "quest_set_state",
    dataMap: (d) => ({ ...d, state: "complete" })
  },

  quest_fail: {
    newType: "quest_set_state",
    dataMap: (d) => ({ ...d, state: "fail" })
  },

  quest_lock: {
    newType: "quest_set_state",
    dataMap: (d) => ({ ...d, state: "lock" })
  },

  quest_make_available: {
    newType: "quest_set_state",
    dataMap: (d) => ({ ...d, state: "available" })
  },

  attr_score: {
    newType: "attr_score_val"
  },

  for_loop: {
    newType: "act_loop",
    dataMap: (d) => ({ count: String(d?.count ?? 3), delay: "0" }),
    pinMapOut: { loop: "body" }
  },

  sequence4: {
    newType: "sequence",
    dataMap: (d) => ({ count: 4, ...(d ?? {}) }),
    pinMapOut: { a: "a0", b: "a1", c: "a2", d: "a3" }
  },

  actor_level: {
    newType: "get_value",
    dataMap: (d) => ({ source:"self", variableId:"", legacyPath:d?.path ?? "system.advancement.level" })
  },

  condition_check: {
    newType: "has_effect",
    dataMap: (d) => ({
      name:   d?.effectName ?? "",
      target: d?.target ?? "actor"
    })
  },

  act_set_field: {
    newType: "act_modify",
    dataMap: (d) => ({
      where: d?.where ?? "self",
      path:  d?.path  ?? "system.hiddenFields.field",
      op:    "set"
    }),
    pinMapIn: { value: "amount" }
  }
};

export const NODE_FIELD_MIGRATIONS = {

  fa_icon: {
    dropPinsIn:   ["color"],
    pinRenameOut: { class: "v", name: "v", color: "v", html: "v" }
  },

  act_damage: {
    dataRename:   { critFormula: "critAmount" },
    pinRenameIn:  { critFormula: "critAmount" }
  },
  act_heal: {

  },

  act_roll_value: {
    dropDataKeys: ["critOn", "critFormula", "fumbleOn", "fumbleFormula"],
    dropPinsIn:   ["critOn", "critFormula", "isCritOverride", "fumbleOn", "fumbleFormula", "isFumbleOverride"],
    dropPinsOut:  ["natural", "isCrit", "critFormula", "isFumble", "fumbleFormula"],

    pinRenameOut: { dice: "diceArray" }
  },

  act_attack_check: {
    pinRenameIn:  { isCritOverride: "isCrit", isFumbleOverride: "isFumble" },
    dropDataKeys: ["critOn", "critFormula", "critFace", "fumbleOn", "fumbleFormula"],
    dropPinsIn:   ["critOn", "critFormula", "fumbleOn", "fumbleFormula"],
    dropPinsOut:  ["critFormula", "fumbleFormula"]
  },
  act_roll_check: {
    pinRenameIn:  { isCritOverride: "isCrit", isFumbleOverride: "isFumble" },
    dropDataKeys: ["critOn", "critFormula", "fumbleOn", "fumbleFormula"],
    dropPinsIn:   ["critOn", "critFormula", "fumbleOn", "fumbleFormula"],
    dropPinsOut:  ["critFormula", "fumbleFormula"]
  },
  act_tiered_roll: {
    pinRenameIn:  { isCritOverride: "isCrit", isFumbleOverride: "isFumble" },
    dropDataKeys: ["critOn", "critFormula", "fumbleOn", "fumbleFormula"],
    dropPinsIn:   ["critOn", "critFormula", "fumbleOn", "fumbleFormula"],
    dropPinsOut:  ["critFormula", "fumbleFormula"]
  },
  act_dice_pool: {
    pinRenameIn:  { isCritOverride: "isCrit", isFumbleOverride: "isFumble" },
    dropDataKeys: ["critOn", "critFormula", "fumbleOn", "fumbleFormula"],
    dropPinsIn:   ["critOn", "critFormula", "fumbleOn", "fumbleFormula"],
    dropPinsOut:  ["critFormula", "fumbleFormula"]
  },
  act_progression: {
    pinRenameIn:  { isCritOverride: "isCrit", isFumbleOverride: "isFumble" },
    dropDataKeys: ["critOn", "critFormula", "fumbleOn", "fumbleFormula"],
    dropPinsIn:   ["critOn", "critFormula", "fumbleOn", "fumbleFormula"],
    dropPinsOut:  ["critFormula", "fumbleFormula"]
  },
  act_throw_on_canvas: {
    pinRenameIn:  { isCritOverride: "isCrit", isFumbleOverride: "isFumble" },
    dropDataKeys: ["critOn", "critFormula", "fumbleOn", "fumbleFormula"],
    dropPinsIn:   ["critOn", "critFormula", "fumbleOn", "fumbleFormula"],
    dropPinsOut:  ["critFormula", "fumbleFormula"]
  },
  act_throw_on_sheet: {
    pinRenameIn:  { isCritOverride: "isCrit", isFumbleOverride: "isFumble" },
    dropDataKeys: ["critOn", "critFormula", "fumbleOn", "fumbleFormula"],
    dropPinsIn:   ["critOn", "critFormula", "fumbleOn", "fumbleFormula"],
    dropPinsOut:  ["critFormula", "fumbleFormula"]
  },
  chat_save_button: {
    pinRenameIn:  { isCritOverride: "isCrit", isFumbleOverride: "isFumble" },
    dropDataKeys: ["critOn", "critFormula", "fumbleOn", "fumbleFormula"],
    dropPinsIn:   ["critOn", "critFormula", "fumbleOn", "fumbleFormula"],
    dropPinsOut:  ["critFormula", "fumbleFormula"]
  },

  slot_count: {
    pinRenameIn:  { itemSlot: "slotId" }
  },
  slot_field: {
    dropDataKeys: ["index"]
  },
  slot_item_uuid: {
    dropDataKeys: ["index"]
  },
  inv_item_slot_count: {
    pinRenameIn:  { itemSlot: "slotId" }
  },
  act_remove_slot: {
    dropDataKeys: ["index"]
  },
  act_use_slot_item: {
    dropDataKeys: ["index"],
    dropPinsIn:   ["index"]
  },
  act_modify_slot_item_field: {
    dropDataKeys: ["index"],
    dropPinsIn:   ["index"]
  },
  act_remove_from_inv_item_slot: {
    dropDataKeys: ["index"],
    dropPinsIn:   ["index", "itemSlot"]
  },
  act_add_to_inv_item_slot: {
    dropPinsIn:   ["itemSlot"]
  }
};

const NODE_CUSTOM_MIGRATIONS = {

  act_dialog_builder(node, edges) {
    const data = node.data || (node.data = {});
    let changes = 0;

    // Migrate the legacy two-value 'mode' to the new three-value scheme:
    // 'rpg' → 'rpg-fullscreen'; 'form' and anything else already valid stays.
    if (data.mode === "rpg" || data.mode == null || data.mode === "") {
      data.mode = "rpg-fullscreen";
      changes++;
    }

    const raw = data.elementsJson;
    if (typeof raw !== "string" || raw.trim() === "") return changes;
    let arr;
    try { arr = JSON.parse(raw); } catch { return 0; }
    if (!Array.isArray(arr) || arr.length === 0) {
      delete data.elementsJson;
      return 1;
    }
    const MAX = 8;
    const items = arr.slice(0, MAX);

    const rollIdxByBtn = [];
    items.forEach((el, i) => {
      if (el && el.type === "rollButton") rollIdxByBtn.push(i);
    });

    data.count = items.length;
    items.forEach((el, i) => {
      const t = (el && typeof el.type === "string") ? el.type : "label";
      const isBtn = (t === "rollButton" || t === "button");
      data[`el${i}_type`]    = isBtn ? "button" : t;
      data[`el${i}_id`]      = String(el?.id ?? "");
      data[`el${i}_label`]   = String(el?.label ?? el?.text ?? "");
      const def = el?.default;
      data[`el${i}_default`] = def == null ? "" :
        (typeof def === "boolean") ? (def ? "yes" : "no") :
        String(def);
      data[`el${i}_options`] = Array.isArray(el?.options) ? el.options.join(",") : "";

      data[`el${i}_emit`]    = isBtn ? "yes" : "no";
      changes++;
    });
    delete data.elementsJson;
    changes++;

    for (const e of edges) {
      if (e.fromNode === node.id && /^btn[0-7]$/.test(e.fromPin)) {
        const n = Number(e.fromPin.slice(3));
        const newIdx = rollIdxByBtn[n];
        if (Number.isInteger(newIdx)) {
          e.fromPin = `el${newIdx}_exec`;
          changes++;
        }
      }
    }
    return changes;
  }
};

export function migrateGraph(graph) {
  if (!graph || !Array.isArray(graph.nodes)) return { changed: 0 };
  const edges = Array.isArray(graph.edges) ? graph.edges : [];
  if (graph.edges !== edges) graph.edges = edges;

  let changed = 0;

  for (const node of graph.nodes) {
    const rule = NODE_TYPE_MIGRATIONS[node?.type];
    if (!rule) continue;

    const oldType = node.type;
    const oldData = node.data ?? {};

    node.type = rule.newType;
    node.data = rule.dataMap ? rule.dataMap(oldData) : { ...oldData };
    changed++;

    if (rule.pinMapIn || rule.pinMapOut) {
      for (const edge of edges) {
        if (edge.toNode === node.id && rule.pinMapIn && rule.pinMapIn[edge.toPin]) {
          edge.toPin = rule.pinMapIn[edge.toPin];
        }
        if (edge.fromNode === node.id && rule.pinMapOut && rule.pinMapOut[edge.fromPin]) {
          edge.fromPin = rule.pinMapOut[edge.fromPin];
        }
      }
    }
  }

  for (const node of graph.nodes) {
    const fr = NODE_FIELD_MIGRATIONS[node?.type];
    if (!fr) continue;
    if (fr.dataRename && node.data && typeof node.data === "object") {
      let dataDirty = false;
      for (const [oldK, newK] of Object.entries(fr.dataRename)) {
        if (Object.prototype.hasOwnProperty.call(node.data, oldK) &&
            !Object.prototype.hasOwnProperty.call(node.data, newK)) {
          node.data[newK] = node.data[oldK];
          delete node.data[oldK];
          dataDirty = true;
        }
      }
      if (dataDirty) changed++;
    }
    if (fr.pinRenameIn || fr.pinRenameOut) {
      for (const edge of edges) {
        if (edge.toNode === node.id && fr.pinRenameIn && fr.pinRenameIn[edge.toPin]) {
          edge.toPin = fr.pinRenameIn[edge.toPin];
          changed++;
        }
        if (edge.fromNode === node.id && fr.pinRenameOut && fr.pinRenameOut[edge.fromPin]) {
          edge.fromPin = fr.pinRenameOut[edge.fromPin];
          changed++;
        }
      }
    }
    if (Array.isArray(fr.dropDataKeys) && node.data && typeof node.data === "object") {
      for (const k of fr.dropDataKeys) {
        if (Object.prototype.hasOwnProperty.call(node.data, k)) {
          delete node.data[k];
          changed++;
        }
      }
    }
  }

  for (const node of graph.nodes) {
    const fn = NODE_CUSTOM_MIGRATIONS[node?.type];
    if (typeof fn === "function") {
      try {
        const n = fn(node, edges);
        if (Number.isFinite(n)) changed += n;
      } catch (e) {
        console.warn("SD | custom migration failed for", node?.type, e);
      }
    }
  }

  const dropInByType  = new Map();
  const dropOutByType = new Map();
  for (const [type, fr] of Object.entries(NODE_FIELD_MIGRATIONS)) {
    if (Array.isArray(fr.dropPinsIn))  dropInByType.set(type,  new Set(fr.dropPinsIn));
    if (Array.isArray(fr.dropPinsOut)) dropOutByType.set(type, new Set(fr.dropPinsOut));
  }
  if (dropInByType.size || dropOutByType.size) {
    const nodeType = new Map(graph.nodes.map(n => [n.id, n.type]));
    for (let i = edges.length - 1; i >= 0; i--) {
      const e = edges[i];
      const tType = nodeType.get(e.toNode);
      const fType = nodeType.get(e.fromNode);
      const inSet  = tType ? dropInByType.get(tType)  : null;
      const outSet = fType ? dropOutByType.get(fType) : null;
      if ((inSet && inSet.has(e.toPin)) || (outSet && outSet.has(e.fromPin))) {
        edges.splice(i, 1);
        changed++;
      }
    }
  }

  return { changed };
}

export function isLegacyNodeType(type) {
  return Object.prototype.hasOwnProperty.call(NODE_TYPE_MIGRATIONS, type);
}
