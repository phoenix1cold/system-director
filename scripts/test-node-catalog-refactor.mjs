// Regression checks for the 2.3.x node catalog refactor: palette state, retired
// replacement chains, legacy → merged node migrations, compilation of the new
// core nodes and evaluation of the text operations.
// Run: node scripts/test-node-catalog-refactor.mjs
import assert from "node:assert/strict";
import fs from "node:fs";

globalThis.document = {
  getElementById() { return {}; },
  createElement() { return { textContent:"", style:{}, appendChild() {} }; },
  head:{ appendChild() {} },
  body:{ appendChild() {} }
};
globalThis.window = globalThis;
globalThis.Actor = class Actor {};
globalThis.Item = class Item {};
globalThis.foundry = { utils:{
  getProperty(obj, path) { return String(path ?? "").split(".").reduce((v, k) => v?.[k], obj); },
  setProperty() {},
  deepClone:value => structuredClone(value),
  randomID:() => "id"
} };
globalThis.game = {
  user:{ targets:new Set(), isGM:true },
  users:{ contents:[] },
  actors:{ contents:[] },
  settings:{ get:() => undefined },
  i18n:{ localize:key => key, has:() => false }
};
globalThis.canvas = { tokens:{ controlled:[], placeables:[] } };
globalThis.fromUuidSync = () => null;
globalThis.fetch = async url => {
  const lang = String(url).endsWith("/ru.json") ? "ru" : "en";
  const data = JSON.parse(fs.readFileSync(new URL(`../lang/${lang}.json`, import.meta.url), "utf8"));
  return { ok:true, json:async () => data };
};

const { FormulaGraph, NODE_DEFS, NODE_CATEGORIES } = await import("../module/builder/formula-graph.mjs");
const { migrateGraph, NODE_TYPE_MIGRATIONS, isLegacyNodeType } = await import("../module/builder/node-migration.mjs");
const { resolveNodePins } = await import("../module/builder/node-pin-resolver.mjs");
const { FormulaEngine } = await import("../module/helpers/formula-engine.mjs");
const { lintGraph } = await import("../module/builder/graph-linter.mjs");

const visible = id => { const d = NODE_DEFS[id]; return !!d && !d.hidden && !d.internal; };

/* ---- 1. palette state ------------------------------------------------- */
for (const id of ["act_effect_add_change", "act_damage_simple", "act_heal_simple", "on_damage_taken", "on_rest",
  "on_vision_detect", "act_vision_scan", "get_actors_array", "get_compendium_uuids", "act_show_journal",
  "act_set_tile_property", "act_set_light_property", "act_set_wall_property", "act_log", "do_once", "flip_flop",
  "do_n", "multi_gate", "text_format", "text_concat", "text_length", "text_contains", "text_replace", "text_case",
  "text_substring", "text_index_of"]) {
  assert.ok(visible(id), `${id} must be in the palette`);
}
for (const id of ["get_compendium_count", "get_compendium_names", "act_journal_show_page", "act_set_tile_image",
  "act_set_light_radius", "act_set_wall_door_state", "attr_score_val", "skill_rank_val", "act_cast_to"]) {
  assert.ok(NODE_DEFS[id]?.hidden, `${id} must be hidden`);
}
assert.equal(NODE_DEFS.act_cast_to.replacement, "set_value");
assert.equal(NODE_DEFS.target_field.replacement, "get_value");
assert.ok(NODE_DEFS.attr_score_val.isContextNode && !NODE_DEFS.attr_score_val.replacement);
assert.ok(NODE_CATEGORIES.some(c => c.id === "Text") && NODE_CATEGORIES.some(c => c.id === "Debug"));
assert.ok(!NODE_CATEGORIES.some(c => c.id === "Macros"), "empty Macros category removed");

// Every retired node must point at a node that is itself offered in the palette.
const targets = value => String(value ?? "").split(/\s*[+/]\s*/).map(s => s.replace(/\(.*?\)/g, "").trim()).filter(t => NODE_DEFS[t]);
for (const [id, def] of Object.entries(NODE_DEFS)) {
  if (!def.hidden || def.isWidgetConfig || def.isFunctionAnchor || def.isContextNode) continue;
  for (const t of targets(def.replacement)) assert.ok(visible(t), `${id} -> ${t}: replacement is retired too`);
  for (const t of def.replacementNodes ?? []) assert.ok(visible(t), `${id} => ${t}: recipe node is retired`);
}
// Every migration target exists and is visible; migrated pins exist on the target.
for (const [legacy, rule] of Object.entries(NODE_TYPE_MIGRATIONS)) {
  if (rule.externalTarget) continue;
  assert.ok(NODE_DEFS[rule.newType], `${legacy}: migration target ${rule.newType} missing`);
  // act_set_field → act_modify predates this refactor; act_modify is itself retired (→ Set Value).
  const knownRetiredTarget = legacy === "act_set_field";
  const chainsOn = !!NODE_TYPE_MIGRATIONS[rule.newType];
  assert.ok(visible(rule.newType) || NODE_DEFS[rule.newType].isContextNode || knownRetiredTarget || chainsOn, `${legacy}: migration target ${rule.newType} is hidden`);
  const probe = { id:"p", type:rule.newType, data: rule.dataMap ? rule.dataMap({}) : {} };
  const outs = resolveNodePins(NODE_DEFS[rule.newType], probe, "output").map(p => p.id);
  const ins  = resolveNodePins(NODE_DEFS[rule.newType], probe, "input").map(p => p.id);
  for (const pin of Object.values(rule.pinMapOut ?? {})) assert.ok(outs.includes(pin), `${legacy}: output ${pin} missing on ${rule.newType}`);
  for (const pin of Object.values(rule.pinMapIn ?? {})) assert.ok(ins.includes(pin), `${legacy}: input ${pin} missing on ${rule.newType}`);
}

/* ---- 2. compile helper ------------------------------------------------- */
function compileGraph(nodes, edges) {
  const graph = Object.create(FormulaGraph.prototype);
  graph.nodes = nodes; graph.edges = edges; graph.comments = [];
  graph.doc = null; graph.functions = []; graph._macroDepth = 0;
  return graph;
}
// The compiler walks from the node wired to the event's exec pin.
function actionsFrom(graph, eventId) {
  const start = graph.edges.find(e => e.fromNode === eventId && e.fromPin === "exec");
  return JSON.parse(graph._compileExecChain(start.toNode));
}

/* ---- 3. Scene property migration compiles to the legacy action ---------- */
{
  const legacy = {
    nodes:[
      { id:"n1", type:"on_click", data:{} },
      { id:"n2", type:"act_set_tile_size", data:{ uuid:"Scene.a.Tile.b", width:200, height:50 } },
      { id:"n3", type:"literal", data:{ value:"640" } },
      { id:"n4", type:"act_set_light_animation", data:{ uuid:"Scene.a.AmbientLight.c", animType:"pulse", speed:3, intensity:7, reverse:true } },
      { id:"n5", type:"act_set_wall_restriction", data:{ uuid:"Scene.a.Wall.d", kind:"sight", value:"limited" } }
    ],
    edges:[
      { fromNode:"n1", fromPin:"exec", toNode:"n2", toPin:"exec" },
      { fromNode:"n3", fromPin:"v", toNode:"n2", toPin:"width" },
      { fromNode:"n2", fromPin:"exec", toNode:"n4", toPin:"exec" },
      { fromNode:"n4", fromPin:"exec", toNode:"n5", toPin:"exec" }
    ]
  };
  const changed = migrateGraph(legacy).changed;
  assert.ok(changed >= 3, "scene nodes migrated");
  assert.equal(legacy.nodes[1].type, "act_set_tile_property");
  assert.equal(legacy.nodes[1].data.property, "size");
  assert.ok(!legacy.nodes.some(n => isLegacyNodeType(n.type)));
  const acts = actionsFrom(compileGraph(legacy.nodes, legacy.edges), "n1");
  assert.equal(acts.length, 3);
  assert.deepEqual(acts[0], { type:"setTileSize", width:"640", height:"50", uuid:"Scene.a.Tile.b" });
  assert.deepEqual(acts[1], { type:"setLightAnimation", animType:"pulse", speed:"3", intensity:"7", reverse:true, uuid:"Scene.a.AmbientLight.c" });
  assert.deepEqual(acts[2], { type:"setWallRestriction", kind:"sight", value:"limited", uuid:"Scene.a.Wall.d" });
  // Dynamic pins follow the selected property.
  const pins = resolveNodePins(NODE_DEFS.act_set_tile_property, legacy.nodes[1], "input").map(p => p.id);
  assert.deepEqual(pins, ["exec", "uuid", "width", "height"]);
  assert.equal(lintGraph({ nodes:legacy.nodes, edges:legacy.edges }, NODE_DEFS).filter(w => w.code === "W005" || w.code === "E002").length, 0);
}

/* ---- 4. Compendium / journal / targeting / array / item migrations -------- */
{
  const g = {
    nodes:[
      { id:"c", type:"get_compendium_names", data:{ pack:"world.items" } },
      { id:"j", type:"act_journal_show_page", data:{ entryUuid:"JournalEntry.x", pageId:"p1", force:"yes" } },
      { id:"t", type:"get_all_targets", data:{} },
      { id:"f", type:"arr_last", data:{} },
      { id:"u", type:"act_unequip", data:{ itemName:"Sword" } },
      { id:"s", type:"act_use_slot_item", data:{ slotId:"slot2" } }
    ],
    edges:[
      { fromNode:"c", fromPin:"v", toNode:"f", toPin:"a" },
      { fromNode:"c", fromPin:"len", toNode:"x", toPin:"y" }
    ]
  };
  migrateGraph(g);
  assert.equal(g.nodes[0].type, "get_compendium_uuids");
  assert.deepEqual(g.edges[0], { fromNode:"c", fromPin:"names", toNode:"f", toPin:"a" });
  assert.equal(g.edges[1].fromPin, "len");
  assert.equal(g.nodes[1].type, "act_show_journal");
  assert.deepEqual(NODE_DEFS.act_show_journal.toAction(g.nodes[1], {}), { type:"journalShowPage", entryUuid:"JournalEntry.x", pageId:"p1", force:true });
  assert.deepEqual(NODE_DEFS.act_show_journal.toAction({ id:"j2", type:"act_show_journal", data:{ uuid:"JournalEntry.y", pageId:"", force:"no" } }, {}), { type:"journalShow", uuid:"JournalEntry.y", pageId:"", force:false });
  assert.equal(NODE_DEFS.get_actor.compile(g.nodes[2]), '"all_targets"');
  assert.equal(NODE_DEFS.get_compendium_uuids.compilePin(g.nodes[0], {}, "names"), "{compendium:world.items|names}");
  assert.equal(g.nodes[3].type, "arr_get");
  assert.match(NODE_DEFS.arr_get.compile(g.nodes[3], { a:"x" }), /arrayGet:b64:eA==\|b64:LTE=\|/); // index -1
  assert.equal(NODE_DEFS.act_equip.toAction(g.nodes[4]).type, "unequipItem");
  assert.equal(NODE_DEFS.act_use_item.toAction(g.nodes[5], {}).type, "useSlotItem");
  assert.equal(NODE_DEFS.act_use_item.toAction(g.nodes[5], {}).slotId, "slot2");
}

/* ---- 5. New flow / debug nodes compile to branch actions ----------------- */
{
  const nodes = [
    { id:"e", type:"on_click", data:{} },
    { id:"d", type:"do_once", data:{ scope:"session", key:"" } },
    { id:"l1", type:"act_log", data:{ text:"first", level:"info" } },
    { id:"l2", type:"act_log", data:{ text:"again", level:"warn", toScreen:"no" } },
    { id:"ff", type:"flip_flop", data:{} },
    { id:"mg", type:"multi_gate", data:{ count:3, loop:"no" } },
    { id:"n3", type:"act_notify", data:{ text:"" } }
  ];
  const edges = [
    { fromNode:"e", fromPin:"exec", toNode:"d", toPin:"exec" },
    { fromNode:"d", fromPin:"exec", toNode:"l1", toPin:"exec" },
    { fromNode:"d", fromPin:"blocked", toNode:"l2", toPin:"exec" },
    { fromNode:"l1", fromPin:"exec", toNode:"ff", toPin:"exec" },
    { fromNode:"ff", fromPin:"b", toNode:"mg", toPin:"exec" },
    { fromNode:"mg", fromPin:"out2", toNode:"n3", toPin:"exec" },
    { fromNode:"ff", fromPin:"isA", toNode:"n3", toPin:"text" }
  ];
  const acts = actionsFrom(compileGraph(nodes, edges), "e");
  assert.equal(acts.length, 1);
  const once = acts[0];
  assert.equal(once.type, "flowDoOnce");
  assert.equal(once.nodeId, "d");
  assert.equal(once.execActions[0].type, "logMessage");
  assert.equal(once.execActions[0].text, "first");
  assert.equal(once.blockedActions[0].toScreen, false);
  const flip = once.execActions[1];
  assert.equal(flip.type, "flowFlipFlop");
  assert.deepEqual(flip.aActions, []);
  const gate = flip.bActions[0];
  assert.equal(gate.type, "flowMultiGate");
  assert.equal(gate.count, 3);
  assert.equal(gate.loop, false);
  assert.equal(gate.out2Actions[0].type, "notify");
  // The Is A value output resolves through the node-result token.
  assert.equal(gate.out2Actions[0].text, "{__nodeResult:ff|isA}");
  assert.deepEqual(resolveNodePins(NODE_DEFS.multi_gate, nodes[5], "output").map(p => p.id), ["out0", "out1", "out2", "index"]);
}

/* ---- 6. Text nodes: compile + evaluate --------------------------------- */
{
  const doc = {};
  const evalText = (type, data, ins) => {
    const compiled = NODE_DEFS[type].compile({ id:"t", type, data }, ins);
    assert.match(compiled, /^\{__sdText:/);
    return FormulaEngine._resolveToken(compiled.slice(1, -1), doc);
  };
  assert.equal(evalText("text_format", { template:"{0} takes {1} damage ({2})" }, { arg0:'"Goblin"', arg1:"(3+4)", arg2:'"fire"' }), "Goblin takes 7 damage (fire)");
  assert.equal(evalText("text_format", { template:"{0}" }, {}), "");
  assert.equal(evalText("text_format", { template:"unused" }, { template:'"{1}-{0}"', arg0:"1", arg1:"2" }), "2-1");
  assert.equal(evalText("text_format", { template:"Total: {0} + {1} = 3" }, { arg0:"1", arg1:"2" }), "Total: 1 + 2 = 3");
  assert.equal(evalText("text_format", { template:"HP {0}/{1}" }, { arg0:"12", arg1:"20" }), "HP 12/20");
  assert.equal(evalText("text_concat", { sep:", " }, { s0:'"a"', s1:"2", s3:'"c"' }), "a, 2, c");
  assert.equal(evalText("text_length", {}, { text:'"héllo"' }), 5);
  assert.equal(evalText("text_contains", { search:"", mode:"contains", caseSensitive:"no" }, { text:'"Fire Bolt"', search:'"bolt"' }), 1);
  assert.equal(evalText("text_contains", { search:"bolt", mode:"contains", caseSensitive:"yes" }, { text:'"Fire Bolt"' }), 0);
  assert.equal(evalText("text_contains", { search:"Fire", mode:"starts" }, { text:'"Fire Bolt"' }), 1);
  assert.equal(evalText("text_contains", { search:"fire bolt", mode:"equals" }, { text:'"Fire Bolt"' }), 1);
  assert.equal(evalText("text_index_of", { search:"Bolt" }, { text:'"Fire Bolt"' }), 5);
  assert.equal(evalText("text_replace", { find:"a", replace:"o", first:"no" }, { text:'"banana"' }), "bonono");
  assert.equal(evalText("text_replace", { find:"a", replace:"o", first:"yes" }, { text:'"banana"' }), "bonana");
  assert.equal(evalText("text_case", { op:"upper" }, { text:'"abc"' }), "ABC");
  assert.equal(evalText("text_case", { op:"title" }, { text:'"fire bolt"' }), "Fire Bolt");
  assert.equal(evalText("text_case", { op:"trim" }, { text:'"  x  "' }), "x");
  assert.equal(evalText("text_substring", { start:5, length:"" }, { text:'"Fire Bolt"' }), "Bolt");
  assert.equal(evalText("text_substring", { start:-4, length:2 }, { text:'"Fire Bolt"' }), "Bo");
  // Whole-formula evaluation wraps the result like every other string node.
  const formatted = NODE_DEFS.text_format.compile({ id:"t", type:"text_format", data:{ template:"HP {0}/{1}" } }, { arg0:"12", arg1:"20" });
  assert.equal(FormulaEngine.evaluate(formatted, doc), "HP 12/20");
}

/* ---- 7. Wave 2: loops, If Compare, Random Pick, Select by Value, Roll ------ */
{
  // For Each ×3 + Repeat N + for_loop chain → for_each / for_loop_range, same executor actions.
  const g = {
    nodes:[
      { id:"n1", type:"on_click", data:{} },
      { id:"n2", type:"act_for_each_token", data:{}, x:100, y:100 },
      { id:"n3", type:"for_each_target", data:{} },
      { id:"n4", type:"for_loop", data:{ count:"4" } },
      { id:"n5", type:"arr_for_each", data:{} },
      { id:"n6", type:"act_notify", data:{ text:"" } },
      { id:"src", type:"get_actor", data:{ mode:"all_targets", uuid:"" } }
    ],
    edges:[
      { fromNode:"n1", fromPin:"exec", toNode:"n2", toPin:"exec" },
      { fromNode:"src", fromPin:"v", toNode:"n2", toPin:"tokens" },
      { fromNode:"n2", fromPin:"loop", toNode:"n3", toPin:"exec" },
      { fromNode:"n3", fromPin:"done", toNode:"n4", toPin:"exec" },
      { fromNode:"n4", fromPin:"loop", toNode:"n5", toPin:"exec" },
      { fromNode:"n5", fromPin:"loop", toNode:"n6", toPin:"exec" },
      { fromNode:"n5", fromPin:"item", toNode:"n6", toPin:"text" },
      { fromNode:"n2", fromPin:"token", toNode:"n6", toPin:"level" }
    ]
  };
  migrateGraph(g);
  assert.deepEqual(g.nodes.slice(1, 5).map(n => n.type), ["for_each", "for_each", "for_loop_range", "for_each"]);
  assert.equal(g.nodes[3].data.mode, "count");
  assert.equal(g.nodes[3].data.count, "4");
  assert.equal(g.edges[1].toPin, "a");
  assert.equal(g.edges[4].fromPin, "loop");
  const acts = actionsFrom(compileGraph(g.nodes, g.edges), "n1");
  assert.equal(acts[0].type, "forEachToken");
  assert.equal(acts[0].tokens, '"all_targets"');
  assert.equal(acts[0].loopActions[0].type, "forEachTarget");
  const loop = acts[0].loopActions[0].doneActions[0];
  assert.equal(loop.type, "forLoop");
  assert.equal(loop.count, "4");
  assert.equal(loop.loopActions[0].type, "forEachItem");
  const notify = loop.loopActions[0].loopActions[0];
  assert.equal(notify.text, "{__loopItem}");
  assert.equal(notify.level, "{__currentTarget}");
  assert.deepEqual(resolveNodePins(NODE_DEFS.for_each, { data:{ source:"targets" } }, "input").map(p => p.id), ["exec"]);
  assert.deepEqual(resolveNodePins(NODE_DEFS.for_loop_range, { data:{ mode:"count" } }, "input").map(p => p.id), ["exec", "count", "delay"]);
  assert.equal(lintGraph(g, NODE_DEFS).filter(w => w.code === "W005" || w.code === "E002").length, 0);

  // If Compare → Branch + comparison node; wires preserved; fallback B becomes a literal.
  const h = {
    nodes:[
      { id:"n1", type:"on_click", data:{} },
      { id:"n2", type:"if_node", data:{ operator:">=", value:"10", condition:"" }, x:300, y:100 },
      { id:"n3", type:"literal", data:{ value:"12" } },
      { id:"n4", type:"act_notify", data:{ text:"yes" } },
      { id:"n5", type:"if_node", data:{ operator:"<", value:"", condition:"{a} < 3" } }
    ],
    edges:[
      { fromNode:"n1", fromPin:"exec", toNode:"n2", toPin:"exec" },
      { fromNode:"n3", fromPin:"v", toNode:"n2", toPin:"a" },
      { fromNode:"n2", fromPin:"exec", toNode:"n4", toPin:"exec" }
    ]
  };
  migrateGraph(h);
  assert.equal(h.nodes[1].type, "branch");
  assert.equal(h.nodes[4].type, "if_node", "condition override keeps the legacy node");
  const gte = h.nodes.find(n => n.type === "gte");
  const lit = h.nodes.find(n => n.type === "literal" && n.data.value === "10");
  assert.ok(gte && lit, "comparison and fallback literal inserted");
  assert.ok(h.edges.some(e => e.fromNode === "n3" && e.toNode === gte.id && e.toPin === "a"));
  assert.ok(h.edges.some(e => e.fromNode === lit.id && e.toNode === gte.id && e.toPin === "b"));
  assert.ok(h.edges.some(e => e.fromNode === gte.id && e.fromPin === "v" && e.toNode === "n2" && e.toPin === "cond"));
  assert.ok(h.edges.some(e => e.fromNode === "n2" && e.fromPin === "true" && e.toNode === "n4"));
  assert.equal(new Set(h.nodes.map(n => n.id)).size, h.nodes.length, "unique node ids");
  const branchActs = actionsFrom(compileGraph(h.nodes, h.edges), "n1");
  assert.equal(branchActs[0].type, "branch");
  assert.equal(branchActs[0].condition, "(12>=10)");
  assert.equal(branchActs[0].trueActions[0].text, "yes");

  // Random Pick → Make Array + Random from Array.
  const r = {
    nodes:[{ id:"n1", type:"random_pick", data:{}, x:0, y:0 }, { id:"l1", type:"literal", data:{ value:"1" } }, { id:"l2", type:"literal", data:{ value:"2" } }],
    edges:[{ fromNode:"l1", fromPin:"v", toNode:"n1", toPin:"a" }, { fromNode:"l2", fromPin:"v", toNode:"n1", toPin:"c" }]
  };
  migrateGraph(r);
  assert.equal(r.nodes[0].type, "arr_random_from");
  const make = r.nodes.find(n => n.type === "arr_make");
  assert.deepEqual(r.edges.filter(e => e.toNode === make.id).map(e => e.toPin), ["v0", "v1"]);
  assert.ok(r.edges.some(e => e.fromNode === make.id && e.toNode === "n1" && e.toPin === "a"));

  // Select by Value keeps the __sdMatch token; auto mode compares loosely.
  const m = { nodes:[{ id:"n1", type:"match_str", data:{} }], edges:[] };
  migrateGraph(m);
  assert.equal(m.nodes[0].type, "match_value");
  assert.equal(m.nodes[0].data.mode, "str");
  const tok = NODE_DEFS.match_value.compile({ id:"m", type:"match_value", data:{ mode:"auto" } }, { value:"7", default:'"none"', c0:'"07"', r0:'"seven"' });
  assert.equal(FormulaEngine._resolveToken(tok.slice(1, -1), {}), "seven");
  const tokStr = NODE_DEFS.match_value.compile({ id:"m", type:"match_value", data:{ mode:"str" } }, { value:"7", default:'"none"', c0:'"07"', r0:'"seven"' });
  assert.equal(FormulaEngine._resolveToken(tokStr.slice(1, -1), {}), "none");

  // Roll exposes the analysis outputs directly; Formula Range → Formula Stats.
  for (const pin of ["natural", "isCrit", "isFumble", "min", "max", "avg"]) {
    assert.ok(NODE_DEFS.act_roll_v2.outputs.some(o => o.id === pin), `Roll output ${pin}`);
  }
  const rollGraph = compileGraph([
    { id:"e", type:"on_click", data:{} }, { id:"r", type:"act_roll_v2", data:{} }, { id:"n", type:"act_notify", data:{} }
  ], [
    { fromNode:"e", fromPin:"exec", toNode:"r", toPin:"exec" }, { fromNode:"r", fromPin:"exec", toNode:"n", toPin:"exec" },
    { fromNode:"r", fromPin:"natural", toNode:"n", toPin:"text" }
  ]);
  assert.equal(actionsFrom(rollGraph, "e")[0].execActions[0].text, "{__rollNatural}");
  const fr = { nodes:[{ id:"f", type:"formula_range", data:{ formula:"2d6" } }], edges:[{ fromNode:"f", fromPin:"avg", toNode:"x", toPin:"y" }] };
  migrateGraph(fr);
  assert.equal(fr.nodes[0].type, "roll_stat");
  assert.equal(NODE_DEFS.roll_stat.compilePin(fr.nodes[0], {}, "avg"), "7");

  // Advanced fields are flagged on the heavy nodes.
  for (const id of ["act_roll_v2", "act_save_dc", "act_present_roll", "act_damage_simple", "dice", "do_once", "act_log"]) {
    assert.ok(NODE_DEFS[id].fields.some(f => f.advanced === true), `${id} has advanced fields`);
  }
  for (const id of ["for_each_target", "act_for_each_token", "arr_for_each", "act_loop", "if_node", "random_pick", "match_num", "match_str", "match_arr", "formula_range"]) {
    assert.ok(NODE_DEFS[id].hidden, `${id} hidden`);
  }
  for (const id of ["for_each", "for_loop_range", "match_value", "roll_stat", "ternary", "branch", "arr_random_from"]) assert.ok(visible(id), `${id} visible`);
}

/* ---- 8. Damage/Heal keep a real HP path when no variable is selected ----- */
assert.equal(NODE_DEFS.act_damage_simple.toAction({ id:"d", type:"act_damage_simple", data:{ hpPath:"" } }, {}).hpPath, "system.resources.hp.value");
assert.equal(NODE_DEFS.act_heal_simple.toAction({ id:"h", type:"act_heal_simple", data:{} }, {}).hpPath, "system.resources.hp.value");

console.log("Node catalog refactor regression: OK");
