import { sdFlags } from "../helpers/document-flags.mjs";
import { SDTrade, SDTradeWindow, SDAutoTradeShop } from "./trade.mjs";
import { installTradeSheetIntegration, registerStoredTradeGraphs } from "./sheet-integration.mjs";
import { economyNodeDefinitions, computeTradeEconomy, configureTradeGraphRuntime } from "./economy.mjs";
const MODULE_ID = "sd-improved-trading";
// Settings/flags keep the historical module namespace so existing worlds read
// their trade rules and buttons unchanged after the integration. sdFlags uses
// Document.update rather than requiring the old standalone module to be active.
const SD_SOCKET = "system.sd";
const SOCKET_NS = SD_SOCKET;
const ACTION_PREFIX = "SDIT.";

let FormulaEngine = null;
let originals = {};

const DEFAULT_RULES = Object.freeze({
  buyMultiplier: 1,
  sellMultiplier: 1,
  feePercent: 0,
  minPrice: 0,
  maxPrice: 0,
  maxQuantity: 0,
  currencyOverride: "",
  blockedCategories: []
});

const TONES = new Set(["primary", "success", "warning", "danger", "neutral"]);
const LOCATIONS = new Set(["shop", "manual", "both"]);

const t = (key, fallback, data = {}) => {
  try {
    const full = `${MODULE_ID}.${key}`;
    if (game.i18n?.has?.(full)) return game.i18n.format(full, data);
  } catch {}
  return fallback.replace(/\{(\w+)\}/g, (_, k) => data[k] ?? `{${k}}`);
};

const esc = value => String(value ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const num = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const clone = value => foundry.utils.deepClone(value);

function normalizeRules(raw = {}) {
  return {
    buyMultiplier: Math.max(0, num(raw.buyMultiplier, 1)),
    sellMultiplier: Math.max(0, num(raw.sellMultiplier, 1)),
    feePercent: Math.max(-100, num(raw.feePercent, 0)),
    minPrice: Math.max(0, num(raw.minPrice, 0)),
    maxPrice: Math.max(0, num(raw.maxPrice, 0)),
    maxQuantity: Math.max(0, Math.floor(num(raw.maxQuantity, 0))),
    currencyOverride: String(raw.currencyOverride ?? "").trim(),
    blockedCategories: [...new Set((Array.isArray(raw.blockedCategories) ? raw.blockedCategories : String(raw.blockedCategories ?? "").split(","))
      .map(v => String(v).trim()).filter(Boolean))]
  };
}

function worldRules() {
  try { return normalizeRules(game.settings.get(MODULE_ID, "rules")); }
  catch { return normalizeRules(DEFAULT_RULES); }
}

function actorRules(actor) {
  return normalizeRules(sdFlags(actor).getFlag(MODULE_ID, "rules") ?? DEFAULT_RULES);
}

function combinedLimit(...rules) {
  const values = rules.map(r => num(r?.maxQuantity, 0)).filter(v => v > 0);
  return values.length ? Math.min(...values) : 0;
}

function categoryBlocked(category, ...rules) {
  const key = String(category ?? "");
  return rules.some(r => (r?.blockedCategories ?? []).includes(key));
}

function readTraderConfig(actor) {
  const hidden = actor?.system?.hiddenFields ?? {};
  return {
    priceDistortion: Math.max(0, num(hidden.priceDistortion, 100)),
    tradeCategories: Array.isArray(hidden.tradeCategories) ? hidden.tradeCategories.map(String) : []
  };
}

function readSaleConfig(item) {
  const hidden = item?.system?.hiddenFields ?? {};
  const saleable = !!hidden.saleable;
  const path = String(hidden.salePricePath ?? "").trim();
  const pathValue = path ? foundry.utils.getProperty(item, path) : undefined;
  const explicit = pathValue ?? hidden.salePrice ?? item?.system?.price ?? 0;
  return {
    saleable,
    price: Math.max(0, num(explicit, 0)),
    currency: String(hidden.saleCurrency ?? item?.system?.currency ?? "primary"),
    infiniteSale: hidden.infiniteSale === true || ["true","1","yes","on"].includes(String(hidden.infiniteSale ?? "").toLowerCase())
  };
}

function calculatePrice({ mode, buyer, seller, trader, item, quantity = 1, basePrice, currency } = {}) {
  const qty = Math.max(1, Math.floor(num(quantity, 1)));
  const sale = readSaleConfig(item);
  const economy = computeTradeEconomy({ mode, trader, item, fallbackPrice: basePrice ?? sale.price, fallbackCurrency: currency || sale.currency });
  const unit = Math.max(0, num(economy.unitPrice, sale.price));
  const total = unit * qty;
  const ctx = {
    mode, buyer, seller, trader, item, quantity: qty,
    basePrice: economy.basePrice, unitPrice: unit, totalPrice: total,
    currency: String(economy.currency || sale.currency), multiplier: economy.multiplier,
    feePercent: 0, discountPercent: 0, economy,
    infiniteSale: !!economy.infiniteSale,
    countForSale: economy.countForSale,
    availableCount: economy.availableCount,
    cancel: false, reason: ""
  };
  Hooks.callAll("sdImprovedTradeCalculatePrice", ctx);
  ctx.unitPrice = Math.max(0, num(ctx.unitPrice, unit));
  ctx.totalPrice = Math.max(0, Math.round(num(ctx.totalPrice, total)));
  ctx.currency = String(ctx.currency || economy.currency || sale.currency);
  return ctx;
}

async function resolveDocument(uuid) {
  if (!uuid) return null;
  try { return await fromUuid(String(uuid)); } catch { return null; }
}

function sourceActor(doc) {
  if (!doc) return null;
  if (doc.documentName === "Actor") return doc;
  if (doc.actor) return doc.actor;
  if (doc.parent?.documentName === "Actor") return doc.parent;
  return null;
}

async function resolveValue(value, actor) {
  if (value == null || typeof value !== "string") return value;
  let raw = value.trim();
  if (!raw) return "";

  // Graph string constants are JSON-quoted. Decode those before deciding if
  // the value is a formula; plain UUIDs, item IDs and currency keys must never
  // be sent through the numeric formula evaluator.
  if (raw.startsWith('"') && raw.endsWith('"')) {
    try {
      const decoded = JSON.parse(raw);
      if (typeof decoded === "string") raw = decoded;
    } catch {}
  } else {
    const singleQuoted = raw.match(/^'([\s\S]*)'$/);
    if (singleQuoted) raw = singleQuoted[1];
  }

  const looksLikeFormula = /^[-+]?\d+(?:\.\d+)?$/.test(raw)
    || /\{[^}]+\}/.test(raw)
    || /\d+d\d+/i.test(raw)
    || /[+*/%<>=!&|()]/.test(raw)
    || /^-?\d+(?:\.\d+)?\s*-\s*\d/.test(raw);
  if (!looksLikeFormula) return raw;
  try {
    if (!FormulaEngine) ({ FormulaEngine } = await import("../helpers/formula-engine.mjs"));
    const result = FormulaEngine.evaluate(raw, actor ?? {});
    if (result !== undefined && result !== null) return result;
  } catch {}
  return raw;
}

async function resolvePayload(payload = {}, actor) {
  const out = {};
  for (const [key, value] of Object.entries(payload && typeof payload === "object" ? payload : { value: payload })) {
    out[key] = await resolveValue(value, actor);
  }
  return out;
}

async function setActorRule(actor, key, rawValue, mode = "set") {
  if (!actor) throw new Error(t("errors.actorMissing", "Actor not found."));
  const rules = actorRules(actor);
  if (key === "blockedCategories") {
    const category = String(rawValue ?? "").trim();
    if (!category) return;
    const set = new Set(rules.blockedCategories);
    if (mode === "remove") set.delete(category); else set.add(category);
    rules.blockedCategories = [...set];
  } else if (key === "currencyOverride") {
    rules.currencyOverride = String(rawValue ?? "").trim();
  } else {
    rules[key] = num(rawValue, DEFAULT_RULES[key] ?? 0);
  }
  await sdFlags(actor).setFlag(MODULE_ID, "rules", normalizeRules(rules));
  refreshTradeWindows();
}

async function moveItems(from, to, items = []) {
  for (const entry of items) {
    const src = from?.items?.get?.(String(entry.id));
    if (!src) throw new Error(t("errors.itemMissing", "Item not found."));
    const qty = Math.max(1, Math.floor(num(entry.qty, 1)));
    const have = Math.max(1, num(src.system?.quantity, 1));
    if (qty > have) throw new Error(t("errors.stock", "Not enough item quantity."));
    const data = src.toObject();
    delete data._id;
    data.system ??= {};
    data.system.quantity = qty;
    await to.createEmbeddedDocuments("Item", [data]);
    if (qty >= have) await src.delete();
    else await src.update({ "system.quantity": have - qty });
  }
}

async function copyItemWithoutDecrement(sourceItem, targetActor, quantity) {
  const qty = Math.max(1, Math.floor(num(quantity, 1)));
  const data = sourceItem.toObject();
  data.system = data.system ?? {};
  data.system.quantity = qty;
  delete data._id;
  await targetActor.createEmbeddedDocuments("Item", [data]);
}

async function moveCurrency(from, to, key, amount) {
  const value = Math.max(0, num(amount, 0));
  if (!value) return;
  const have = num(from?.system?.currency?.[key], 0);
  if (have < value) throw new Error(t("errors.currency", "Not enough currency."));
  await from.update({ [`system.currency.${key}`]: have - value });
  await to.update({ [`system.currency.${key}`]: num(to?.system?.currency?.[key], 0) + value });
}

function canMutate(actor, userId = game.user.id) {
  const user = game.users?.get(userId);
  if (user?.isGM) return true;
  if (!game.settings.get(MODULE_ID, "allowPlayerMutations")) return false;
  return !!actor?.testUserPermission?.(user, "OWNER");
}

async function executeOperation(name, payload, sourceUuid, userId = game.user.id) {
  const source = await resolveDocument(sourceUuid);
  const actor = sourceActor(source);
  const data = await resolvePayload(payload, actor);
  const requiresMutation = !["StartTrade", "openShop", "modifyOffer", "offerCurrency", "cancelTrade"].includes(name);
  if (requiresMutation && !canMutate(actor, userId)) throw new Error(t("errors.permission", "You are not allowed to run this trade mutation."));

  switch (name) {
    case "setBuyMultiplier": return setActorRule(actor, "buyMultiplier", data.value);
    case "setSellMultiplier": return setActorRule(actor, "sellMultiplier", data.value);
    case "setFee": return setActorRule(actor, "feePercent", data.value);
    case "setMaxQuantity": return setActorRule(actor, "maxQuantity", data.value);
    case "setMinPrice": return setActorRule(actor, "minPrice", data.value);
    case "setMaxPrice": return setActorRule(actor, "maxPrice", data.value);
    case "setCurrency": return setActorRule(actor, "currencyOverride", data.value);
    case "blockCategory": return setActorRule(actor, "blockedCategories", data.category, "add");
    case "allowCategory": return setActorRule(actor, "blockedCategories", data.category, "remove");
    case "clearRules": {
      if (!actor) throw new Error(t("errors.actorMissing", "Actor not found."));
      await sdFlags(actor).unsetFlag(MODULE_ID, "rules");
      refreshTradeWindows();
      return;
    }
    case "setSalePrice": {
      const item = actor?.items?.get?.(String(data.itemId));
      if (!item) throw new Error(t("errors.itemMissing", "Item not found."));
      await item.update({ "system.hiddenFields.salePrice": Math.max(0, num(data.price, 0)) });
      return;
    }
    case "setSaleable": {
      const item = actor?.items?.get?.(String(data.itemId));
      if (!item) throw new Error(t("errors.itemMissing", "Item not found."));
      const yes = data.value === true || data.value === 1 || ["1", "yes", "true"].includes(String(data.value).toLowerCase());
      await item.update({ "system.hiddenFields.saleable": yes });
      return;
    }
    case "transferItem": {
      const target = sourceActor(await resolveDocument(data.targetActor));
      if (!actor || !target) throw new Error(t("errors.actorMissing", "Actor not found."));
      return moveItems(actor, target, [{ id: String(data.itemId), qty: data.quantity }]);
    }
    case "transferCurrency": {
      const target = sourceActor(await resolveDocument(data.targetActor));
      if (!actor || !target) throw new Error(t("errors.actorMissing", "Actor not found."));
      return moveCurrency(actor, target, String(data.currency), data.amount);
    }
    case "addButton": return addPersistentButton(actor, data, userId);
    case "removeButton": return removePersistentButton(actor, String(data.id), String(data.scope), userId);
    case "StartTrade": {
      if (!actor) throw new Error(t("errors.actorMissing", "Actor not found."));
      Hooks.callAll("sdImprovedTradeStart", { actor, actorUuid: actor.uuid, source: "node" });
      return SDTrade.openFor(actor);
    }
    case "openShop": {
      const trader = sourceActor(await resolveDocument(data.traderActor));
      const buyer = sourceActor(await resolveDocument(data.buyerActor)) ?? actor;
      if (!buyer || !trader) throw new Error(t("errors.actorMissing", "Actor not found."));
      return new SDAutoTradeShop({ buyer, trader }).render(true);
    }
    case "modifyOffer": return modifyOffer(data, actor);
    case "offerCurrency": return modifyOfferCurrency(data, actor);
    case "cancelTrade": return cancelActiveTrade(String(data.requestId));
    default: throw new Error(`Unknown Improved Trading operation: ${name}`);
  }
}

async function dispatchOperation(name, payload, sourceUuid) {
  const localOnly = ["StartTrade", "openShop", "modifyOffer", "offerCurrency", "cancelTrade"].includes(name);
  if (game.user.isGM || localOnly) return executeOperation(name, payload, sourceUuid, game.user.id);
  game.socket.emit(SOCKET_NS, { type: "execute", name, payload, sourceUuid, userId: game.user.id });
}

function normalizeButton(raw = {}) {
  const id = String(raw.id || foundry.utils.randomID(8)).replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 48);
  return {
    id: id || foundry.utils.randomID(8),
    label: String(raw.label || "Action").slice(0, 80),
    icon: String(raw.icon || "fas fa-bolt").slice(0, 80),
    eventName: String(raw.eventName || "TradeAction").slice(0, 100),
    location: LOCATIONS.has(String(raw.location)) ? String(raw.location) : "both",
    tone: TONES.has(String(raw.tone)) ? String(raw.tone) : "neutral",
    enabled: raw.enabled !== false
  };
}

async function addPersistentButton(actor, raw, userId) {
  const button = normalizeButton(raw);
  if (String(raw.scope) === "global") {
    if (!game.users?.get(userId)?.isGM) throw new Error(t("errors.gmOnly", "Only a GM can change global trade buttons."));
    const list = clone(game.settings.get(MODULE_ID, "buttons") ?? []);
    const index = list.findIndex(entry => entry.id === button.id);
    if (index >= 0) list[index] = button; else list.push(button);
    await game.settings.set(MODULE_ID, "buttons", list);
  } else {
    if (!actor) throw new Error(t("errors.actorMissing", "Actor not found."));
    const list = clone(sdFlags(actor).getFlag(MODULE_ID, "buttons") ?? []);
    const index = list.findIndex(entry => entry.id === button.id);
    if (index >= 0) list[index] = button; else list.push(button);
    await sdFlags(actor).setFlag(MODULE_ID, "buttons", list);
  }
  refreshTradeWindows();
}

async function removePersistentButton(actor, id, scope, userId) {
  if (scope === "global") {
    if (!game.users?.get(userId)?.isGM) throw new Error(t("errors.gmOnly", "Only a GM can change global trade buttons."));
    await game.settings.set(MODULE_ID, "buttons", (game.settings.get(MODULE_ID, "buttons") ?? []).filter(entry => entry.id !== id));
  } else if (actor) {
    await sdFlags(actor).setFlag(MODULE_ID, "buttons", (sdFlags(actor).getFlag(MODULE_ID, "buttons") ?? []).filter(entry => entry.id !== id));
  }
  refreshTradeWindows();
}

function buttonsFor(location, actors = []) {
  const all = [...(game.settings.get(MODULE_ID, "buttons") ?? [])];
  for (const actor of actors.filter(Boolean)) all.push(...(sdFlags(actor).getFlag(MODULE_ID, "buttons") ?? []));
  const unique = new Map();
  for (const raw of all) {
    if (String(raw?.id ?? "") === "trade-action" && String(raw?.label ?? "") === "Action" && String(raw?.eventName ?? "") === "TradeAction") continue;
    const button = normalizeButton(raw);
    if (!button.enabled || (button.location !== "both" && button.location !== location)) continue;
    unique.set(button.id, button);
  }
  return [...unique.values()];
}

function actionButtonsHtml(location, actors) {
  const buttons = buttonsFor(location, actors);
  if (!buttons.length) return "";
  return `<div class="sdit-actions" data-location="${location}">
    <span class="sdit-actions-label">${esc(t("actions.label", "Trade actions"))}</span>
    ${buttons.map(button => `<button type="button" class="sdit-action sdit-${button.tone}" data-sdit-id="${esc(button.id)}" title="${esc(button.eventName)}"><i class="${esc(button.icon)}"></i><span>${esc(button.label)}</span></button>`).join("")}
  </div>`;
}

function fireTradeButton(button, context, actor) {
  const payload = foundry.utils.deepClone(context);
  payload.buttonId = button.id;
  payload.buttonLabel = button.label;
  const event = {
    name: button.eventName,
    scope: "global",
    actorId: actor?.id ?? "",
    sourceUuid: actor?.uuid ?? "",
    payload
  };
  Hooks.callAll("sdImprovedTradeButton", event);
  Hooks.callAll("sdCustomEvent", event);
}

function enhanceShop(app) {
  const root = app.element;
  const content = root?.querySelector?.(".window-content");
  if (!content) return;
  content.querySelectorAll(".sdit-actions").forEach(el => el.remove());

  for (const row of content.querySelectorAll(".sd-shop-row[data-item-id]")) {
    row.querySelector(".sdit-final-price")?.remove();
    const itemId = row.dataset.itemId;
    const item = app._tab === "sell" ? app.buyer?.items?.get(itemId) : app.trader?.items?.get(itemId);
    if (!item) continue;
    const qtyInput = row.querySelector("input[type=number]");
    const paint = () => {
      row.querySelector(".sdit-final-price")?.remove();
      const qty = Math.max(1, num(qtyInput?.value, 1));
      const ctx = app._tab === "sell"
        ? calculatePrice({ mode: "sell", seller: app.buyer, buyer: app.trader, trader: app.trader, item, quantity: qty })
        : calculatePrice({ mode: "buy", buyer: app.buyer, seller: app.trader, trader: app.trader, item, quantity: qty });
      if (app._tab === "buy" && qtyInput) {
        if (ctx.infiniteSale) qtyInput.removeAttribute("max");
        else qtyInput.max = String(Math.max(0, ctx.availableCount));
        const stockLine = [...row.querySelectorAll("div")].find(el => /stock\s+/i.test(el.textContent ?? ""));
        if (stockLine) stockLine.textContent = stockLine.textContent.replace(/stock\s+[^·]+/i, `stock ${ctx.infiniteSale ? "∞" : ctx.availableCount}`);
      }
      const badge = document.createElement("div");
      badge.className = "sdit-final-price";
      badge.textContent = `${t("price.final", "Final")}: ${ctx.totalPrice} ${ctx.currency}`;
      row.querySelector("button")?.before(badge);
    };
    paint();
    qtyInput?.addEventListener("input", paint);
  }
}

function enhanceManual(app) {
  const root = app.element;
  const content = root?.querySelector?.(".window-content");
  const state = SDTrade?._state?.get?.(app.requestId);
  if (!content || !state) return;
  content.querySelectorAll(".sdit-actions").forEach(el => el.remove());
  const init = fromUuidSync?.(state.initiatorActorUuid);
  const part = fromUuidSync?.(state.partnerActorUuid);
  content.insertAdjacentHTML("beforeend", actionButtonsHtml("manual", [init, part]));
  for (const el of content.querySelectorAll(".sdit-action")) {
    el.addEventListener("click", () => {
      const button = buttonsFor("manual", [init, part]).find(entry => entry.id === el.dataset.sditId);
      if (!button) return;
      const me = game.user.id === state.partnerUserId ? part : init;
      fireTradeButton(button, {
        mode: "manual", requestId: app.requestId,
        initiatorActorUuid: state.initiatorActorUuid,
        partnerActorUuid: state.partnerActorUuid,
        offers: clone(state.offers)
      }, me);
    });
  }
}

function refreshTradeWindows() {
  for (const win of SDAutoTradeShop?._open?.values?.() ?? []) win.refresh?.();
  for (const win of SDTradeWindow?._open?.values?.() ?? []) win.refresh?.();
}

function modifyOffer(data, actor) {
  const state = SDTrade?._state?.get?.(String(data.requestId));
  if (!state) throw new Error(t("errors.tradeMissing", "Active trade not found."));
  let side = String(data.side || "");
  if (!['init','part'].includes(side)) side = actor?.uuid === state.partnerActorUuid ? "part" : "init";
  const ownerUuid = side === "init" ? state.initiatorActorUuid : state.partnerActorUuid;
  if (!game.user.isGM && actor?.uuid !== ownerUuid) throw new Error(t("errors.permission", "You cannot modify the other side's offer."));
  const offer = state.offers[side] ??= { items: [], currency: {} };
  const itemId = String(data.itemId || "");
  const operation = String(data.operation || "add");
  const qty = Math.max(1, Math.floor(num(data.quantity, 1)));
  const existing = offer.items.find(entry => entry.id === itemId);
  if (operation === "remove") offer.items = offer.items.filter(entry => entry.id !== itemId);
  else if (operation === "set") {
    if (existing) existing.qty = qty; else offer.items.push({ id: itemId, qty });
  } else if (existing) existing.qty += qty;
  else offer.items.push({ id: itemId, qty });
  state.ready.init = state.ready.part = false;
  game.socket.emit(SD_SOCKET, { type: "trade.update", requestId: state.requestId, from: game.user.id, side, offer });
  refreshTradeWindows();
}

function modifyOfferCurrency(data, actor) {
  const state = SDTrade?._state?.get?.(String(data.requestId));
  if (!state) throw new Error(t("errors.tradeMissing", "Active trade not found."));
  let side = String(data.side || "");
  if (!['init','part'].includes(side)) side = actor?.uuid === state.partnerActorUuid ? "part" : "init";
  const ownerUuid = side === "init" ? state.initiatorActorUuid : state.partnerActorUuid;
  if (!game.user.isGM && actor?.uuid !== ownerUuid) throw new Error(t("errors.permission", "You cannot modify the other side's offer."));
  const offer = state.offers[side] ??= { items: [], currency: {} };
  offer.currency[String(data.currency)] = Math.max(0, num(data.amount, 0));
  state.ready.init = state.ready.part = false;
  game.socket.emit(SD_SOCKET, { type: "trade.update", requestId: state.requestId, from: game.user.id, side, offer });
  refreshTradeWindows();
}

function cancelActiveTrade(requestId) {
  const state = SDTrade?._state?.get?.(requestId);
  if (!state) return;
  game.socket.emit(SD_SOCKET, { type: "trade.cancelled", requestId, from: game.user.id });
  SDTrade._state.delete(requestId);
  SDTradeWindow?._open?.get?.(requestId)?.close?.({ skipNotify: true });
}

function emitAutoResult(data, ok, msg) {
  const packet = { type: "trade.autoResult", to: data.from, ok, msg };
  game.socket.emit(SD_SOCKET, packet);
  if (data.from === game.user.id) SDTrade._onSocket(packet);
}

async function improvedAutoBuy(data) {
  const buyer = await resolveDocument(data.buyerActorUuid);
  const trader = await resolveDocument(data.traderActorUuid);
  const item = trader?.items?.get?.(data.itemId);
  const qty = Math.max(1, Math.floor(num(data.qty, 1)));
  if (!buyer || !trader || !item) return emitAutoResult(data, false, t("errors.missingTradeData", "Trade failed: actor or item missing."));
  const sale = readSaleConfig(item);
  if (!sale.saleable) return emitAutoResult(data, false, t("errors.notSaleable", "Item is not for sale."));
  const ctx = calculatePrice({ mode: "buy", buyer, seller: trader, trader, item, quantity: qty });
  Hooks.callAll("sdImprovedTradeBeforeBuy", ctx);
  if (ctx.cancel) return emitAutoResult(data, false, ctx.reason || t("errors.cancelled", "Purchase cancelled."));
  const have = num(buyer.system?.currency?.[ctx.currency], 0);
  if (have < ctx.totalPrice) return emitAutoResult(data, false, t("errors.currency", "Not enough currency."));
  if (!ctx.infiniteSale && qty > Math.max(0, num(ctx.availableCount, 0))) return emitAutoResult(data, false, t("errors.stock", "Not enough stock."));
  try {
    if (ctx.infiniteSale) await copyItemWithoutDecrement(item, buyer, qty);
    else await moveItems(trader, buyer, [{ id: item.id, qty }]);
    await buyer.update({ [`system.currency.${ctx.currency}`]: have - ctx.totalPrice });
    await trader.update({ [`system.currency.${ctx.currency}`]: num(trader.system?.currency?.[ctx.currency], 0) + ctx.totalPrice });
    Hooks.callAll("sdImprovedTradeAfterBuy", ctx);
    emitAutoResult(data, true, t("messages.bought", "Purchase complete: {price} {currency}.", { price: ctx.totalPrice, currency: ctx.currency }));
  } catch (error) {
    console.error("SD Improved Trading | autoBuy", error);
    emitAutoResult(data, false, String(error?.message || error));
  }
}

async function improvedAutoSell(data) {
  const seller = await resolveDocument(data.sellerActorUuid);
  const trader = await resolveDocument(data.traderActorUuid);
  const item = seller?.items?.get?.(data.itemId);
  const qty = Math.max(1, Math.floor(num(data.qty, 1)));
  if (!seller || !trader || !item) return emitAutoResult(data, false, t("errors.missingTradeData", "Trade failed: actor or item missing."));
  const traderCfg = readTraderConfig(trader);
  const category = String(item.system?.category ?? "");
  if (traderCfg.tradeCategories.length && !traderCfg.tradeCategories.includes(category)) return emitAutoResult(data, false, t("errors.wrongCategory", "Trader does not buy this category."));
  const rules = [worldRules(), actorRules(seller), actorRules(trader)];
  if (categoryBlocked(category, ...rules)) return emitAutoResult(data, false, t("errors.blockedCategory", "This item category is blocked."));
  const limit = combinedLimit(...rules);
  if (limit && qty > limit) return emitAutoResult(data, false, t("errors.quantityLimit", "Maximum trade quantity is {limit}.", { limit }));
  const ctx = calculatePrice({ mode: "sell", seller, buyer: trader, trader, item, quantity: qty });
  Hooks.callAll("sdImprovedTradeBeforeSell", ctx);
  if (ctx.cancel) return emitAutoResult(data, false, ctx.reason || t("errors.cancelled", "Sale cancelled by a trade rule."));
  const traderHas = num(trader.system?.currency?.[ctx.currency], 0);
  if (traderHas < ctx.totalPrice) return emitAutoResult(data, false, t("errors.traderBroke", "Trader cannot afford this."));
  if (num(item.system?.quantity, 1) < qty) return emitAutoResult(data, false, t("errors.stock", "Not enough stock."));
  try {
    await moveItems(seller, trader, [{ id: item.id, qty }]);
    await trader.update({ [`system.currency.${ctx.currency}`]: traderHas - ctx.totalPrice });
    await seller.update({ [`system.currency.${ctx.currency}`]: num(seller.system?.currency?.[ctx.currency], 0) + ctx.totalPrice });
    Hooks.callAll("sdImprovedTradeAfterSell", ctx);
    emitAutoResult(data, true, t("messages.sold", "Sale complete: {price} {currency}.", { price: ctx.totalPrice, currency: ctx.currency }));
  } catch (error) {
    console.error("SD Improved Trading | autoSell", error);
    emitAutoResult(data, false, String(error?.message || error));
  }
}

async function improvedManualCommit(state) {
  const init = await resolveDocument(state.initiatorActorUuid);
  const part = await resolveDocument(state.partnerActorUuid);
  const ctx = { state, initiator: init, partner: part, offers: state.offers, cancel: false, reason: "" };
  for (const [side, actor] of [["init", init], ["part", part]]) {
    const limit = combinedLimit(worldRules(), actorRules(actor));
    if (limit && (state.offers?.[side]?.items ?? []).some(entry => num(entry.qty, 1) > limit)) {
      ctx.cancel = true;
      ctx.reason = t("errors.quantityLimit", "Maximum trade quantity is {limit}.", { limit });
    }
  }
  Hooks.callAll("sdImprovedTradeBeforeExchange", ctx);
  if (ctx.cancel) {
    const error = ctx.reason || t("errors.cancelled", "Trade cancelled by a trade rule.");
    for (const uid of [state.initiatorUserId, state.partnerUserId]) game.socket.emit(SD_SOCKET, { type: "trade.commit-result", requestId: state.requestId, to: uid, ok: false, error });
    return;
  }
  const result = await originals.gmCommit.call(SDTrade, state);
  Hooks.callAll("sdImprovedTradeAfterExchange", ctx);
  return result;
}

function patchTrading() {
  if (!SDTrade || originals.gmAutoBuy) return;
  originals.gmAutoBuy = SDTrade._gmAutoBuy;
  originals.gmAutoSell = SDTrade._gmAutoSell;
  originals.gmCommit = SDTrade._gmCommit;
  originals.shopWire = SDAutoTradeShop.prototype._wire;
  originals.manualWire = SDTradeWindow.prototype._wire;

  SDTrade._gmAutoBuy = improvedAutoBuy;
  SDTrade._gmAutoSell = improvedAutoSell;
  SDTrade._gmCommit = improvedManualCommit;
  SDAutoTradeShop.prototype._wire = function(...args) {
    const result = originals.shopWire.apply(this, args);
    enhanceShop(this);
    return result;
  };
  SDTradeWindow.prototype._wire = function(...args) {
    const result = originals.manualWire.apply(this, args);
    enhanceManual(this);
    return result;
  };
}

const actionNode = ({ title, desc, inputs = [], fields = [], eventName, payload }) => ({
  title, desc, cat: "sd-improved-trading", color: "#ca8a04", isAction: true,
  inputs: [{ id: "exec", label: "", type: "exec" }, ...inputs],
  outputs: [{ id: "exec", label: "Then", type: "exec" }],
  fields,
  toAction: (node, inp) => ({ type: "remoteActivate", name: `${ACTION_PREFIX}${eventName}`, payload: payload(node, inp) })
});

function registerNodes(registry) {
  if (!registry?.registerCategory || !registry?.registerNodes) throw new Error("System Director node registry API is unavailable");
  const NODE_DEFS = economyNodeDefinitions();
  registry.registerCategory({
    id: "sd-improved-trading", color: "#ca8a04", after: "Items",
    labels: { en: "Improved Trading", ru: "Улучшенная торговля" }
  }, { owner: MODULE_ID });
  registry.registerNodes(NODE_DEFS, { owner: MODULE_ID });
  return NODE_DEFS;
}

class ImprovedTradeSettings extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "sdit-settings", classes: ["sdit-settings"],
    position: { width: 760, height: 650 },
    window: { title: "SD Improved Trading", resizable: true }
  };
  async _renderHTML() {
    const r = worldRules();
    const buttons = game.settings.get(MODULE_ID, "buttons") ?? [];
    return `<form class="sdit-settings-form">
      <section class="sdit-panel"><h2>${esc(t("settings.rules", "Global price rules"))}</h2>
        <div class="sdit-grid">
          ${this._number("buyMultiplier", t("settings.buyMultiplier", "Buy multiplier"), r.buyMultiplier, 0, 0.01)}
          ${this._number("sellMultiplier", t("settings.sellMultiplier", "Sell multiplier"), r.sellMultiplier, 0, 0.01)}
          ${this._number("feePercent", t("settings.feePercent", "Fee %"), r.feePercent, -100, 1)}
          ${this._number("minPrice", t("settings.minPrice", "Minimum unit price"), r.minPrice, 0, 1)}
          ${this._number("maxPrice", t("settings.maxPrice", "Maximum unit price (0 = off)"), r.maxPrice, 0, 1)}
          ${this._number("maxQuantity", t("settings.maxQuantity", "Maximum quantity (0 = off)"), r.maxQuantity, 0, 1)}
          <label><span>${esc(t("settings.currency", "Currency override"))}</span><input name="currencyOverride" value="${esc(r.currencyOverride)}"></label>
          <label><span>${esc(t("settings.blocked", "Blocked categories, comma separated"))}</span><input name="blockedCategories" value="${esc(r.blockedCategories.join(", "))}"></label>
        </div>
      </section>
      <section class="sdit-panel"><div class="sdit-panel-head"><h2>${esc(t("settings.buttons", "Optional trade buttons"))}</h2><button type="button" data-action="add"><i class="fas fa-plus"></i> ${esc(t("settings.add", "Add button"))}</button></div>
        <div class="sdit-button-list">${buttons.map((b, i) => this._buttonRow(normalizeButton(b), i)).join("")}</div>
      </section>
      <footer><button type="button" data-action="save" class="sdit-save"><i class="fas fa-floppy-disk"></i> ${esc(t("settings.save", "Save"))}</button></footer>
    </form>`;
  }
  _replaceHTML(html, content) { content.innerHTML = html; this._wire(); }
  _number(name, label, value, min, step) { return `<label><span>${esc(label)}</span><input type="number" name="${name}" value="${value}" min="${min}" step="${step}"></label>`; }
  _buttonRow(b, i) {
    return `<div class="sdit-button-row" data-index="${i}">
      <input data-key="id" value="${esc(b.id)}" placeholder="ID">
      <input data-key="label" value="${esc(b.label)}" placeholder="${esc(t("settings.label", "Label"))}">
      <input data-key="icon" value="${esc(b.icon)}" placeholder="fas fa-bolt">
      <input data-key="eventName" value="${esc(b.eventName)}" placeholder="Custom Event">
      <select data-key="location">${["shop","manual","both"].map(v => `<option value="${v}" ${b.location===v?"selected":""}>${v}</option>`).join("")}</select>
      <select data-key="tone">${["primary","success","warning","danger","neutral"].map(v => `<option value="${v}" ${b.tone===v?"selected":""}>${v}</option>`).join("")}</select>
      <button type="button" data-action="remove" title="${esc(t("settings.remove", "Remove"))}"><i class="fas fa-trash"></i></button>
    </div>`;
  }
  _wire() {
    const root = this.element;
    root?.querySelector('[data-action="add"]')?.addEventListener("click", () => {
      const list = root.querySelector(".sdit-button-list");
      const index = list.querySelectorAll(".sdit-button-row").length;
      list.insertAdjacentHTML("beforeend", this._buttonRow(normalizeButton({ id:`action-${index+1}` }), index));
      this._wireRows();
    });
    root?.querySelector('[data-action="save"]')?.addEventListener("click", () => this._save());
    this._wireRows();
  }
  _wireRows() {
    this.element?.querySelectorAll('[data-action="remove"]').forEach(btn => {
      if (btn.dataset.sditWired) return;
      btn.dataset.sditWired = "1";
      btn.addEventListener("click", () => btn.closest(".sdit-button-row")?.remove());
    });
  }
  async _save() {
    const root = this.element;
    const read = name => root.querySelector(`[name="${name}"]`)?.value;
    const rules = normalizeRules({
      buyMultiplier: read("buyMultiplier"), sellMultiplier: read("sellMultiplier"), feePercent: read("feePercent"),
      minPrice: read("minPrice"), maxPrice: read("maxPrice"), maxQuantity: read("maxQuantity"),
      currencyOverride: read("currencyOverride"), blockedCategories: read("blockedCategories")
    });
    const buttons = [...root.querySelectorAll(".sdit-button-row")].map(row => normalizeButton(Object.fromEntries([...row.querySelectorAll("[data-key]")].map(input => [input.dataset.key, input.value]))));
    await game.settings.set(MODULE_ID, "rules", rules);
    await game.settings.set(MODULE_ID, "buttons", buttons);
    ui.notifications.info(t("messages.saved", "Improved Trading settings saved."));
    refreshTradeWindows();
    this.close();
  }
}

function registerSettings() {
  game.settings.register(MODULE_ID, "rules", { scope: "world", config: false, type: Object, default: clone(DEFAULT_RULES) });
  game.settings.register(MODULE_ID, "buttons", { scope: "world", config: false, type: Array, default: [] });
  game.settings.register(MODULE_ID, "economyGlobals", { scope: "world", config: false, type: Object, default: { sources: {} } });
  game.settings.register(MODULE_ID, "allowPlayerMutations", {
    name: t("settings.allowPlayerMutations", "Allow player node mutations"),
    hint: t("settings.allowPlayerMutationsHint", "Allows actor owners to run item/currency transfer and persistent rule nodes. Disabled by default."),
    scope: "world", config: true, type: Boolean, default: false
  });
  game.settings.registerMenu(MODULE_ID, "configuration", {
    name: t("settings.menu", "Improved Trading"),
    label: t("settings.open", "Configure trading"),
    hint: t("settings.menuHint", "Configure global price rules and optional shop/manual trade buttons."),
    icon: "fas fa-scale-balanced", type: ImprovedTradeSettings, restricted: true
  });
}

async function cleanupLegacyPlaceholderButtons() {
  const isLegacy = button => String(button?.id ?? "") === "trade-action" && String(button?.label ?? "") === "Action" && String(button?.eventName ?? "") === "TradeAction";
  if (game.user?.isGM) {
    const world = game.settings.get(MODULE_ID, "buttons") ?? [];
    const clean = world.filter(button => !isLegacy(button));
    if (clean.length !== world.length) await game.settings.set(MODULE_ID, "buttons", clean);
  }
  for (const actor of game.actors ?? []) {
    const own = sdFlags(actor).getFlag(MODULE_ID, "buttons") ?? [];
    const clean = own.filter(button => !isLegacy(button));
    if (clean.length === own.length || (!game.user?.isGM && !actor.isOwner)) continue;
    if (clean.length) await sdFlags(actor).setFlag(MODULE_ID, "buttons", clean); else await sdFlags(actor).unsetFlag(MODULE_ID, "buttons");
  }
}

Hooks.once("init", registerSettings);

Hooks.once("ready", async () => {
  if (game.modules.get(MODULE_ID)?.active) {
    console.warn("SD Improved Trading | The standalone sd-improved-trading module is active together with the trading embedded in System Director. Disable the module to avoid duplicate node actions.");
  }
  try {
    const graph = await import("../builder/formula-graph.mjs");
    ({ FormulaEngine } = await import("../helpers/formula-engine.mjs"));
    registerNodes(graph.SD_NODE_REGISTRY);
    configureTradeGraphRuntime({ nodeDefs: graph.NODE_DEFS, formulaEngine: FormulaEngine });
    SDTrade.init();
    patchTrading();
    await cleanupLegacyPlaceholderButtons();
    await installTradeSheetIntegration({ SDTrade });
    await registerStoredTradeGraphs();
    game.socket.on(SOCKET_NS, async packet => {
      if (!game.user.isGM || packet?.type !== "execute") return;
      try { await executeOperation(packet.name, packet.payload, packet.sourceUuid, packet.userId); }
      catch (error) {
        console.error("SD Improved Trading | socket operation", error);
        game.socket.emit(SOCKET_NS, { type: "error", to: packet.userId, message: String(error?.message || error) });
      }
    });
    game.socket.on(SOCKET_NS, packet => {
      if (packet?.type === "error" && packet.to === game.user.id) ui.notifications.error(packet.message);
    });
    Hooks.on("sdCustomEvent", event => {
      const name = String(event?.name ?? "");
      if (!name.startsWith(ACTION_PREFIX)) return;
      const operation = name.slice(ACTION_PREFIX.length);
      if (["CalculatePrice","BeforeBuy","AfterBuy","BeforeSell","AfterSell","BeforeExchange","AfterExchange","TradeButton"].includes(operation)) return;
      dispatchOperation(operation, event.payload, event.sourceUuid).catch(error => {
        console.error("SD Improved Trading | node action", error);
        ui.notifications.error(String(error?.message || error));
      });
    });
    const tradingApi = {
      calculatePrice, computeTradeEconomy, getWorldRules: worldRules, getActorRules: actorRules,
      addButton: addPersistentButton, removeButton: removePersistentButton,
      refresh: refreshTradeWindows, startTrade: actor => SDTrade.openFor(actor),
      hooks: ["sdImprovedTradeCalculatePrice", "sdImprovedTradeBeforeBuy", "sdImprovedTradeAfterBuy", "sdImprovedTradeBeforeSell", "sdImprovedTradeAfterSell", "sdImprovedTradeBeforeExchange", "sdImprovedTradeAfterExchange", "sdImprovedTradeButton"]
    };
    // The historical module id no longer hosts this code; keep the API discoverable
    // both ways for macros and third-party modules written against the module.
    globalThis.SD ??= {};
    globalThis.SD.trading = tradingApi;
    const legacyModule = game.modules.get(MODULE_ID);
    if (legacyModule) legacyModule.api = tradingApi;
    console.info(`SD Improved Trading | Ready; registered ${Object.keys(graph.NODE_DEFS).filter(key => key.startsWith("sdit_")).length} nodes.`);
  } catch (error) {
    console.error("SD Improved Trading | Initialization failed", error);
    ui.notifications.error(t("errors.init", "Improved Trading failed to initialize. Check console."));
  }
});
