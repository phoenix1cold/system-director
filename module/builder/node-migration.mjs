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
  },

  // --- 2.3.x catalog clean-up -------------------------------------------

  // Targeting shortcuts → Get Actor with the matching mode (same compiled literal).
  get_target:         { newType: "get_actor", dataMap: () => ({ uuid: "", mode: "token_target" }) },
  get_selected_token: { newType: "get_actor", dataMap: () => ({ uuid: "", mode: "selected_token" }) },
  get_user_character: { newType: "get_actor", dataMap: () => ({ uuid: "", mode: "user_character" }) },
  get_all_targets:    { newType: "get_actor", dataMap: () => ({ uuid: "", mode: "all_targets" }) },

  // Array First / Last → Get Array Element (negative index counts from the end).
  arr_first: { newType: "arr_get", dataMap: () => ({ i: 0,  def: "" }) },
  arr_last:  { newType: "arr_get", dataMap: () => ({ i: -1, def: "" }) },

  // Unequip → Equip / Unequip Item in unequip mode (same executor action).
  act_unequip: {
    newType: "act_equip",
    dataMap: (d) => ({ ...(d ?? {}), mode: "unequip", force: false })
  },
  // Use Slot Item → Use Item in slot mode (same pins, same executor action).
  act_use_slot_item: {
    newType: "act_use_item",
    dataMap: (d) => ({ findBy: "slot", slotId: String(d?.slotId ?? "slot1") })
  },

  // Compendium Count / Names → the single Compendium node.
  get_compendium_count: { newType: "get_compendium_uuids", pinMapOut: { v: "len" } },
  get_compendium_names: { newType: "get_compendium_uuids", pinMapOut: { v: "names", len: "len" } },

  // Show Journal Page → Show Journal with a page id.
  act_journal_show_page: {
    newType: "act_show_journal",
    dataMap: (d) => ({ uuid: String(d?.entryUuid ?? ""), pageId: String(d?.pageId ?? ""), force: d?.force ?? "no" }),
    pinMapIn: { entryUuid: "uuid" }
  },

  // Loops → For Each (source mode) / For Loop (count mode).
  arr_for_each:       { newType: "for_each", dataMap: () => ({ source: "array" }) },
  act_for_each_token: { newType: "for_each", dataMap: () => ({ source: "tokens" }), pinMapIn: { tokens: "a" } },
  for_each_target:    { newType: "for_each", dataMap: () => ({ source: "targets" }) },
  act_loop: {
    newType: "for_loop_range",
    dataMap: (d) => ({ mode: "count", count: String(d?.count ?? "3"), first: "0", last: "3", delay: String(d?.delay ?? "0") }),
    pinMapOut: { body: "loop" }
  },

  // Formula Range → Formula Stats (same pins).
  formula_range: { newType: "roll_stat", dataMap: (d) => ({ formula: String(d?.formula ?? "1d6") }) },

  // Select by Number / Text / Array → Select by Value (same pins, explicit compare mode).
  match_num: { newType: "match_value", dataMap: () => ({ mode: "num" }) },
  match_str: { newType: "match_value", dataMap: () => ({ mode: "str" }) },
  match_arr: { newType: "match_value", dataMap: () => ({ mode: "arr" }) },

  // One-property Scene setters → Set Tile / Light / Wall Property. Pin ids are
  // unchanged; only the property selector is added.
  ...Object.fromEntries(Object.entries({
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
  }).map(([legacy, [newType, property]]) => [legacy, {
    newType,
    dataMap: (d) => ({ ...(d ?? {}), property })
  }]))
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

// Custom migrations receive (node, edges, graph). `graph.addNode(type, data, dx, dy)`
// inserts a helper node next to the migrated one so a single legacy node can be
// expanded into a small sub-graph while keeping every external wire.
const IF_COMPARE_NODES = { "<":"lt", "<=":"lte", ">":"gt", ">=":"gte", "==":"eq", "!=":"neq", "=":"eq", "===":"eq", "!==":"neq" };

const NODE_CUSTOM_MIGRATIONS = {

  // If Compare (single True exec) → Branch + comparison node. Nodes with a free-form
  // "Condition override" stay as they are: the override is a formula, not two operands.
  if_node(node, edges, graph) {
    if (!graph?.addNode) return 0;
    if (String(node.data?.condition ?? "").trim()) return 0;
    const compareType = IF_COMPARE_NODES[String(node.data?.operator ?? "<").trim()] ?? "lt";
    const compare = graph.addNode(compareType, {}, -230, 60);
    const aEdge = edges.find(e => e.toNode === node.id && e.toPin === "a");
    const bEdge = edges.find(e => e.toNode === node.id && e.toPin === "b");
    if (aEdge) { aEdge.toNode = compare.id; aEdge.toPin = "a"; }
    if (bEdge) { bEdge.toNode = compare.id; bEdge.toPin = "b"; }
    else {
      const fallback = String(node.data?.value ?? "0");
      const literal = /^-?\d+(\.\d+)?$/.test(fallback.trim())
        ? graph.addNode("literal", { value: fallback.trim() }, -460, 120)
        : graph.addNode("literal_str", { value: fallback }, -460, 120);
      edges.push({ fromNode: literal.id, fromPin: "v", toNode: compare.id, toPin: "b" });
    }
    edges.push({ fromNode: compare.id, fromPin: "v", toNode: node.id, toPin: "cond" });
    for (const e of edges) if (e.fromNode === node.id && e.fromPin === "exec") e.fromPin = "true";
    node.type = "branch";
    node.data = {};
    return 1;
  },

  // Random Pick (A…E) → Make Array + Random from Array.
  random_pick(node, edges, graph) {
    if (!graph?.addNode) return 0;
    const make = graph.addNode("arr_make", {}, -240, 0);
    let index = 0;
    for (const pin of ["a", "b", "c", "d", "e"]) {
      const edge = edges.find(e => e.toNode === node.id && e.toPin === pin);
      if (!edge) continue;
      edge.toNode = make.id; edge.toPin = `v${index++}`;
    }
    edges.push({ fromNode: make.id, fromPin: "v", toNode: node.id, toPin: "a" });
    node.type = "arr_random_from";
    node.data = {};
    return 1;
  },

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
    // Rules may chain (for_loop → act_loop → for_loop_range); follow them to the end.
    for (let hop = 0; hop < 8; hop++) {
      const rule = NODE_TYPE_MIGRATIONS[node?.type];
      if (!rule || rule.newType === node.type) break;

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

  const nodeIds = () => new Set(graph.nodes.map(n => String(n?.id ?? "")));
  const nextNodeId = () => {
    const ids = nodeIds();
    let counter = graph.nodes.length + 1;
    while (ids.has(`n${counter}`)) counter++;
    return `n${counter}`;
  };
  const helpers = (anchor) => ({
    addNode: (type, data = {}, dx = 0, dy = 0) => {
      const added = { id: nextNodeId(), type, x: Math.round(Number(anchor?.x) || 0) + dx, y: Math.round(Number(anchor?.y) || 0) + dy, data: { ...data } };
      graph.nodes.push(added);
      return added;
    }
  });
  for (const node of [...graph.nodes]) {
    const fn = NODE_CUSTOM_MIGRATIONS[node?.type];
    if (typeof fn === "function") {
      try {
        const n = fn(node, edges, helpers(node));
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
