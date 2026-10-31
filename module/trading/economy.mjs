import { sdFlags } from "../helpers/document-flags.mjs";
export const MODULE_ID = "sd-improved-trading";
export const START_NODE = "sdit_start_trade";
export const ACTOR_MODIFIER_OUTPUT = "sdit_actor_price_modifier_output";
export const ITEM_REF_NODE = "sdit_item_ref";
export const ITEM_PRICE_OUTPUT = "sdit_item_price_output";
export const GET_CURRENCY_NODE = "sdit_get_currency_type";

const SCHEMA_VERSION = 4;
const MODULE_NODE_TYPES = new Set([
  START_NODE, ACTOR_MODIFIER_OUTPUT, ITEM_REF_NODE, ITEM_PRICE_OUTPUT, GET_CURRENCY_NODE,
  "sdit_trade_economy_output", "sdit_trade_fields", "sdit_trade_discount",
  "sdit_trade_price_modifier", "sdit_trade_product_override"
]);
let CORE_NODE_DEFS = null;
let FORMULA_ENGINE = null;

const num = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const bool = value => value === true || value === 1 || ["true", "1", "yes", "on"].includes(String(value ?? "").toLowerCase());
const clone = value => { try { return foundry.utils.deepClone(value); } catch { return JSON.parse(JSON.stringify(value)); } };
const safe = value => String(value ?? "").replace(/[^a-zA-Z0-9_-]/g, "_");
const graphFrom = value => value?._graphData ?? value ?? { nodes: [], edges: [] };
const itemKey = item => String(item?.uuid ?? item?.id ?? "");
const itemRefId = item => `sdit-item-ref-${safe(itemKey(item))}`;
const itemOutputId = item => `sdit-item-output-${safe(itemKey(item))}`;
const edgeId = (fromNode, fromPin, toNode, toPin) => `sdit-${safe(fromNode)}-${safe(fromPin)}-${safe(toNode)}-${safe(toPin)}`;
const currencyList = () => Array.isArray(CONFIG?.SD?.currencies) && CONFIG.SD.currencies.length
  ? CONFIG.SD.currencies
  : [{ key: "primary", label: "Gold" }, { key: "secondary", label: "Silver" }, { key: "tertiary", label: "Copper" }];
const currencyOptions = () => currencyList().map(currency => ({ value: String(currency.key), label: String(currency.label ?? currency.key) }));

export function configureTradeGraphRuntime({ nodeDefs = null, formulaEngine = null } = {}) {
  CORE_NODE_DEFS = nodeDefs;
  FORMULA_ENGINE = formulaEngine;
}

function saleConfig(item) {
  const hidden = item?.system?.hiddenFields ?? {};
  const path = String(hidden.salePricePath ?? "").trim();
  const pathValue = path ? foundry.utils.getProperty(item, path) : undefined;
  return {
    saleable: bool(hidden.saleable),
    price: Math.max(0, num(pathValue ?? hidden.salePrice ?? item?.system?.price, 0)),
    currency: String(hidden.saleCurrency ?? item?.system?.currency ?? currencyList()[0]?.key ?? "primary"),
    infiniteSale: bool(hidden.infiniteSale),
    count: Math.max(0, Math.floor(num(item?.system?.quantity, 0)))
  };
}

function markedItems(doc) {
  const actor = doc?.documentName === "Actor" ? doc : doc?.actor;
  if (actor) return [...(actor.items ?? [])].filter(item => item.type === "inventory" && saleConfig(item).saleable);
  if (doc?.documentName === "Item" && doc.type === "inventory" && saleConfig(doc).saleable) return [doc];
  return [];
}

function ensureEdge(graph, fromNode, fromPin, toNode, toPin) {
  if (graph.edges.some(edge => edge.toNode === toNode && edge.toPin === toPin)) return;
  graph.edges.push({ id: edgeId(fromNode, fromPin, toNode, toPin), fromNode, fromPin, toNode, toPin });
}

function ensureFixedNode(graph, type, id, x, y) {
  let node = graph.nodes.find(entry => entry.type === type);
  const created = !node;
  if (!node) {
    node = { id, type, x, y, data: {} };
    graph.nodes.push(node);
  }
  return { node, created };
}

export function syncGraphProducts(raw, doc) {
  const graph = clone(graphFrom(raw));
  graph.nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  graph.edges = Array.isArray(graph.edges) ? graph.edges : [];

  const previousSchema = Number(graph.sditSchema ?? 0);
  if (previousSchema !== SCHEMA_VERSION) {
    // 3.x incorrectly created Start Trade as a fixed trigger. Remove only that
    // node when migrating a current graph so custom pricing chains survive.
    const staleNode = previousSchema === 3
      ? node => node.type === START_NODE
      : node => MODULE_NODE_TYPES.has(node.type) || String(node.type ?? "").startsWith("sdit_");
    const removed = new Set(graph.nodes.filter(staleNode).map(node => node.id));
    graph.nodes = graph.nodes.filter(node => !removed.has(node.id));
    graph.edges = graph.edges.filter(edge => !removed.has(edge.fromNode) && !removed.has(edge.toNode));
  }
  graph.sditSchema = SCHEMA_VERSION;

  ensureFixedNode(graph, ACTOR_MODIFIER_OUTPUT, "sdit-actor-modifier-output", 760, 70);

  const products = markedItems(doc);
  const validKeys = new Set(products.map(itemKey));
  const stale = new Set(graph.nodes.filter(node => [ITEM_REF_NODE, ITEM_PRICE_OUTPUT].includes(node.type) && !validKeys.has(String(node.data?.itemUuid ?? ""))).map(node => node.id));
  graph.nodes = graph.nodes.filter(node => !stale.has(node.id));
  graph.edges = graph.edges.filter(edge => !stale.has(edge.fromNode) && !stale.has(edge.toNode));

  products.forEach((item, index) => {
    const key = itemKey(item);
    const cfg = saleConfig(item);
    let ref = graph.nodes.find(node => node.type === ITEM_REF_NODE && String(node.data?.itemUuid ?? "") === key);
    let output = graph.nodes.find(node => node.type === ITEM_PRICE_OUTPUT && String(node.data?.itemUuid ?? "") === key);
    const newRef = !ref;
    const newOutput = !output;
    const y = 230 + index * 245;
    if (!ref) {
      ref = { id: itemRefId(item), type: ITEM_REF_NODE, x: 90, y, data: {} };
      graph.nodes.push(ref);
    }
    if (!output) {
      output = { id: itemOutputId(item), type: ITEM_PRICE_OUTPUT, x: 760, y, data: {} };
      graph.nodes.push(output);
    }
    const common = { itemUuid: key, itemId: String(item.id ?? ""), itemName: String(item.name ?? "Item") };
    ref.data = { ...(ref.data ?? {}), ...common, defaultPrice: cfg.price, defaultCurrency: cfg.currency, defaultInfiniteSale: cfg.infiniteSale, inventoryCount: cfg.count };
    output.data = { ...(output.data ?? {}), ...common };
    if (newRef || newOutput) {
      ensureEdge(graph, ref.id, "defaultPrice", output.id, "price");
      ensureEdge(graph, ref.id, "defaultCurrency", output.id, "currency");
      ensureEdge(graph, ref.id, "defaultInfiniteSale", output.id, "infiniteSale");
      ensureEdge(graph, ref.id, "inventoryCount", output.id, "countForSale");
    }
  });
  return graph;
}

export function economyNodeDefinitions() {
  return {
    [START_NODE]: {
      title: "START TRADE", cat: "sd-improved-trading", color: "#b45309",
      desc: "Open the Pick trade partner window for the current Actor, then continue the exec chain.",
      inputs: [{ id: "exec", label: "", type: "exec" }],
      outputs: [{ id: "exec", label: "Then", type: "exec" }],
      fields: [], isAction: true,
      toAction: () => ({ type: "remoteActivate", name: "SDIT.StartTrade", scope: "actor", payload: "" })
    },
    [ACTOR_MODIFIER_OUTPUT]: {
      title: "ACTOR PRICE MODIFIER OUTPUT", cat: "sd-improved-trading", color: "#b77900", wideNode: true,
      desc: "Final price multiplier for this Actor. Empty means 1. Connect any number or math chain into Modifier.",
      inputs: [{ id: "modifier", label: "Price Modifier", type: "value.number" }], outputs: [], fields: [],
      noDelete: true, noClone: true, hidden: true, isTradeOutput: true
    },
    [ITEM_REF_NODE]: {
      title: "ITEM REF", cat: "sd-improved-trading", color: "#0369a1", wideNode: true,
      desc: "Fixed reference to one inventory item marked Saleable in the Trade tab. Defaults are read directly from that Item.",
      inputs: [],
      outputs: [
        { id: "item", label: "Item Ref", type: "value.item" },
        { id: "defaultPrice", label: "Default Price", type: "value.number" },
        { id: "defaultCurrency", label: "Default Currency Type", type: "value.string" },
        { id: "defaultInfiniteSale", label: "Infinite Sale", type: "value.bool" },
        { id: "inventoryCount", label: "Inventory Count", type: "value.number" }
      ],
      fields: [
        { key: "itemName", label: "Item", type: "text", default: "" },
        { key: "itemUuid", label: "Item UUID", type: "text", default: "" }
      ],
      compilePin: (node, _inputs, pin) => {
        if (pin === "item") return JSON.stringify(node.data?.itemUuid ?? "");
        if (pin === "defaultCurrency") return JSON.stringify(node.data?.defaultCurrency ?? "primary");
        if (pin === "defaultInfiniteSale") return String(!!node.data?.defaultInfiniteSale);
        if (pin === "inventoryCount") return String(num(node.data?.inventoryCount, 0));
        return String(num(node.data?.defaultPrice, 0));
      },
      noDelete: true, noClone: true, hidden: true
    },
    [ITEM_PRICE_OUTPUT]: {
      title: "PRICE OUTPUT", cat: "sd-improved-trading", color: "#b77900", wideNode: true,
      desc: "Final sale data for one marked Item. Disconnect any default wire and insert normal System Director math or value nodes.",
      inputs: [
        { id: "price", label: "Price", type: "value.number" },
        { id: "currency", label: "Currency Type", type: "value.string" },
        { id: "infiniteSale", label: "Infinite Sale", type: "value.bool" },
        { id: "countForSale", label: "Count for Sale", type: "value.number" }
      ],
      outputs: [], fields: [{ key: "itemName", label: "Item", type: "text", default: "" }],
      noDelete: true, noClone: true, hidden: true, isTradeOutput: true
    },
    [GET_CURRENCY_NODE]: {
      title: "Get Currency Type", cat: "sd-improved-trading", color: "#0f766e",
      desc: "Choose a currency type from System Settings and connect it to a Price Output.",
      inputs: [], outputs: [{ id: "currency", label: "Currency Type", type: "value.string" }],
      fields: [{ key: "currency", label: "Currency Type", type: "select", default: "", options: currencyOptions }],
      compilePin: node => JSON.stringify(node.data?.currency ?? currencyOptions()[0]?.value ?? "primary")
    }
  };
}

function findItem(ctx, node) {
  const key = String(node?.data?.itemUuid ?? "");
  const actorItem = [...(ctx.trader?.items ?? [])].find(item => itemKey(item) === key || String(item.id) === String(node?.data?.itemId ?? ""));
  return actorItem ?? (itemKey(ctx.item) === key ? ctx.item : null);
}

function incoming(graph, node, pin) {
  return graph.edges.find(edge => edge.toNode === node.id && edge.toPin === pin);
}

function coreInputs(node) {
  const def = CORE_NODE_DEFS?.[node?.type];
  if (!def) return [];
  try { return def.computeDynamicInputs?.(node) ?? def.inputs ?? []; }
  catch { return def.inputs ?? []; }
}

function compileCore(graph, node, pin, ctx, stack) {
  const def = CORE_NODE_DEFS?.[node?.type];
  if (!def) return null;
  const inputs = {};
  for (const input of coreInputs(node).filter(entry => entry.type !== "exec")) {
    const edge = incoming(graph, node, input.id);
    if (!edge) continue;
    const source = graph.nodes.find(entry => entry.id === edge.fromNode);
    const value = evaluate(graph, source, edge.fromPin, ctx, new Set(stack));
    if (value !== undefined) inputs[input.id] = typeof value === "string" ? JSON.stringify(value) : String(value);
  }
  try {
    return def.compilePin ? def.compilePin(node, inputs, pin) : def.compile?.(node, inputs);
  } catch { return null; }
}

function evaluate(graph, node, pin, ctx, stack = new Set()) {
  if (!node) return undefined;
  const token = `${node.id}:${pin}`;
  if (stack.has(token)) return undefined;
  stack.add(token);
  const input = (id, fallback) => {
    const edge = incoming(graph, node, id);
    if (!edge) return fallback;
    return evaluate(graph, graph.nodes.find(entry => entry.id === edge.fromNode), edge.fromPin, ctx, new Set(stack));
  };

  if (node.type === ITEM_REF_NODE) {
    const item = findItem(ctx, node);
    const cfg = saleConfig(item);
    if (pin === "item") return item?.uuid ?? node.data?.itemUuid ?? "";
    if (pin === "defaultPrice") return cfg.price;
    if (pin === "defaultCurrency") return cfg.currency;
    if (pin === "defaultInfiniteSale") return cfg.infiniteSale;
    if (pin === "inventoryCount") return cfg.count;
  }
  if (node.type === GET_CURRENCY_NODE) return String(node.data?.currency ?? currencyOptions()[0]?.value ?? "primary");
  if (node.type === "literal" || node.type === "literal_num") return num(input("in", node.data?.value), 0);
  if (node.type === "literal_str") return String(input("in", node.data?.value ?? ""));
  if (node.type === "literal_bool" || node.type === "boolean") return bool(input("in", node.data?.value));

  const a = () => num(input("a", input("value", 0)), 0);
  const b = () => num(input("b", 0), 0);
  switch (node.type) {
    case "add": return a() + b();
    case "sub": return a() - b();
    case "mul": return a() * b();
    case "div": { const divisor = b(); return divisor ? a() / divisor : 0; }
    case "mod": return b() ? a() % b() : 0;
    case "pow": return a() ** b();
    case "abs": return Math.abs(a());
    case "neg": return -a();
    case "sqrt": return Math.sqrt(Math.max(0, a()));
    case "floor": return Math.floor(a());
    case "ceil": return Math.ceil(a());
    case "round": return Math.round(a());
    case "min2": return Math.min(a(), b());
    case "max2": return Math.max(a(), b());
    case "clamp": return Math.max(num(input("lo", 0), 0), Math.min(num(input("hi", 0), 0), num(input("v", 0), 0)));
    case "convert_number": return num(input("value", input("default", node.data?.default ?? 0)), num(node.data?.default, 0));
    case "convert_text": return String(input("value", ""));
    case "convert_boolean": return bool(input("value", false));
  }

  const formula = compileCore(graph, node, pin, ctx, stack);
  if (formula != null && FORMULA_ENGINE?.evaluate) {
    const result = FORMULA_ENGINE.evaluate(String(formula), ctx.item ?? ctx.trader);
    if (!(typeof result === "string" && result.startsWith("!err"))) return result;
  }
  return node.data?.value;
}

function readOutputInput(graph, output, pin, ctx, fallback) {
  const edge = incoming(graph, output, pin);
  if (!edge) return fallback;
  const source = graph.nodes.find(node => node.id === edge.fromNode);
  const value = evaluate(graph, source, edge.fromPin, ctx);
  return value === undefined ? fallback : value;
}

export function computeTradeEconomy({ mode = "buy", trader, item, fallbackPrice = 0, fallbackCurrency = "primary" } = {}) {
  const raw = sdFlags(trader).getFlag(MODULE_ID, "tradeGraph");
  const graph = graphFrom(raw);
  const ctx = { mode, trader, item, fallbackPrice, fallbackCurrency };
  const cfg = saleConfig(item);
  const key = itemKey(item);
  const output = graph.nodes?.find(node => node.type === ITEM_PRICE_OUTPUT && (String(node.data?.itemUuid ?? "") === key || String(node.data?.itemId ?? "") === String(item?.id ?? "")));
  const modifierOutput = graph.nodes?.find(node => node.type === ACTOR_MODIFIER_OUTPUT);

  const basePrice = Math.max(0, num(output ? readOutputInput(graph, output, "price", ctx, cfg.price || fallbackPrice) : (cfg.price || fallbackPrice), fallbackPrice));
  const modifier = Math.max(0, num(modifierOutput ? readOutputInput(graph, modifierOutput, "modifier", ctx, 1) : 1, 1));
  const currency = String(output ? readOutputInput(graph, output, "currency", ctx, cfg.currency || fallbackCurrency) : (cfg.currency || fallbackCurrency));
  const infiniteSale = bool(output ? readOutputInput(graph, output, "infiniteSale", ctx, cfg.infiniteSale) : cfg.infiniteSale);
  const inventoryCount = Math.max(0, Math.floor(num(item?.system?.quantity, cfg.count)));
  const countForSale = Math.max(0, Math.floor(num(output ? readOutputInput(graph, output, "countForSale", ctx, inventoryCount) : inventoryCount, inventoryCount)));

  return {
    basePrice,
    unitPrice: basePrice * modifier,
    multiplier: modifier,
    discountPercent: 0,
    currency,
    infiniteSale,
    countForSale,
    availableCount: infiniteSale ? Infinity : Math.min(inventoryCount, countForSale)
  };
}

export async function publishGlobalEconomyRules() {}
