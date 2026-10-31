import { sdFlags } from "../helpers/document-flags.mjs";
import { syncGraphProducts } from "./economy.mjs";
const MODULE_ID = "sd-improved-trading";
const TRADE_TAB = "_sdit_trade";
let FormulaGraph = null;
let TradeApi = null;
let installed = false;

const esc = value => String(value ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
const loc = (key, fallback) => { try { const full=`${MODULE_ID}.${key}`; return game.i18n?.has?.(full) ? game.i18n.localize(full) : fallback; } catch { return fallback; } };
const truthy = value => value === true || value === 1 || ["true","1","yes","on"].includes(String(value ?? "").toLowerCase());
const number = (value, fallback=0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const currencies = () => Array.isArray(CONFIG?.SD?.currencies) && CONFIG.SD.currencies.length ? CONFIG.SD.currencies : [{key:"primary",label:"Gold"},{key:"secondary",label:"Silver"},{key:"tertiary",label:"Copper"}];

function getRule(doc) {
  const raw=sdFlags(doc).getFlag(MODULE_ID,"rules") ?? {};
  return {buyMultiplier:number(raw.buyMultiplier,1),sellMultiplier:number(raw.sellMultiplier,1),feePercent:number(raw.feePercent,0),minPrice:number(raw.minPrice,0),maxPrice:number(raw.maxPrice,0),maxQuantity:number(raw.maxQuantity,0),currencyOverride:String(raw.currencyOverride??""),blockedCategories:Array.isArray(raw.blockedCategories)?raw.blockedCategories.join(", "):String(raw.blockedCategories??"")};
}

function navButton(app) {
  const nav=app.element?.querySelector?.(".sd-sheet-icon-actions");
  if(!nav) return;
  // Both nav and panels rebuild this control. Remove every previous/legacy
  // entry, not only the first match, before adding the single shared button.
  app.element.querySelectorAll(`[data-tab-id="${TRADE_TAB}"], .sdit-trade-tab, .sd-sheet-icon-actions [data-action="openTrade"], .sd-sheet-icon-actions [data-action="openShop"]`).forEach(button=>button.remove());
  const active=app.tabGroups?.sheet===TRADE_TAB;
  const a=document.createElement("button");
  a.type="button";
  a.className=`sdit-trade-tab${active ? " is-active" : ""}`;
  a.setAttribute("aria-pressed", String(active));
  a.dataset.tabId=TRADE_TAB;
  a.title="Trade — left click: settings; right click: start trade";
  a.setAttribute("aria-label", a.title);
  a.innerHTML=`<i class="fas fa-scale-balanced"></i>`;
  a.addEventListener("click",()=>app._switchTab(TRADE_TAB));
  a.addEventListener("contextmenu",event=>{event.preventDefault();event.stopPropagation();const actor=app.document?.documentName==="Actor"?app.document:app.document?.actor;if(actor){Hooks.callAll("sdImprovedTradeStart",{actor,actorUuid:actor.uuid});TradeApi?.openFor?.(actor);}});
  nav.insertBefore(a,nav.querySelector('[data-action="openDatabase"]'));
}

function currencyOptions(selected, includeEmpty=true) {
  const out=[];
  if(includeEmpty) out.push(`<option value="" ${selected?"":"selected"}>—</option>`);
  for(const c of currencies()) out.push(`<option value="${esc(c.key)}" ${String(selected)===String(c.key)?"selected":""}>${esc(c.label??c.key)}</option>`);
  return out.join("");
}

function actorPanel(app, panel) {
  const actor = app.document, hf = actor.system?.hiddenFields ?? {}, editable = app.isEditable !== false;
  // Lite configures trading with header buttons; the graph stays a Nexus feature.
  const liteMode = !!globalThis.CONFIG?.SD?.liteMode;
  const inv = [...(actor.items ?? [])].filter(item => item.type === "inventory");
  const rows = inv.map(item => {
    const ih = item.system?.hiddenFields ?? {};
    return `<div class="sdit-shop-config-row" data-item-id="${esc(item.id)}">
      <input type="checkbox" data-item-field="saleable" ${truthy(ih.saleable) ? "checked" : ""} ${editable ? "" : "disabled"} title="For sale">
      <img src="${esc(item.img || "icons/svg/item-bag.svg")}">
      <span>${esc(item.name)}</span>
      <input type="number" data-item-field="salePrice" value="${ih.salePrice ?? ""}" placeholder="${number(item.system?.price, 0)}" ${editable ? "" : "disabled"}>
      <select data-item-field="saleCurrency" ${editable ? "" : "disabled"}>${currencyOptions(ih.saleCurrency)}</select>
      <label class="sdit-inline-check"><input type="checkbox" data-item-field="infiniteSale" ${truthy(ih.infiniteSale) ? "checked" : ""} ${editable ? "" : "disabled"}><span>${esc(loc("trade.InfiniteSale", "Infinite"))}</span></label>
    </div>`;
  }).join("");
  panel.innerHTML = `<div class="sdit-sheet-tab">
    <div class="sdit-tab-head"><div><h2><i class="fas fa-scale-balanced"></i> ${esc(loc("tabs.trade", "Trade & Trade Node Graph"))}</h2><p>${esc(loc("tabs.simpleGraphHint", "Mark items for sale. The graph creates Item Ref → Price Output for every checked item."))}</p></div><div class="sdit-tab-actions">${liteMode ? "" : `<button type="button" data-sdit-action="graph" class="primary"><i class="fas fa-diagram-project"></i> ${esc(loc("tabs.openGraph", "Open Trade Node Graph"))}</button>`}</div></div>
    <section class="sdit-panel"><h3>${esc(loc("trade.TraderSettings", "Trader settings"))}</h3><div class="sdit-toggle-grid"><div class="sdit-toggle"><input id="sdit-trader-${actor.id}" type="checkbox" data-actor-hidden="trader" ${truthy(hf.trader) ? "checked" : ""} ${editable ? "" : "disabled"}><label for="sdit-trader-${actor.id}">${esc(loc("trade.IsTrader", "Trader"))}</label></div><div class="sdit-toggle"><input id="sdit-auto-${actor.id}" type="checkbox" data-actor-hidden="autoTrade" ${truthy(hf.autoTrade) ? "checked" : ""} ${editable ? "" : "disabled"}><label for="sdit-auto-${actor.id}">${esc(loc("trade.AutoTrade", "AutoTrade"))}</label></div></div></section>
    <section class="sdit-panel"><h3>${esc(loc("trade.ShopTitle", "Shop inventory"))}</h3><div class="sdit-shop-head"><span>${esc(loc("trade.ForSale", "Sale"))}</span><span></span><span>${esc(loc("trade.Item", "Item"))}</span><span>${esc(loc("trade.SalePriceOverride", "Price"))}</span><span>${esc(loc("trade.SaleCurrency", "Currency"))}</span><span>${esc(loc("trade.InfiniteSale", "Infinite"))}</span></div>${rows || `<p class="sdit-empty">${esc(loc("trade.NoInventory", "No inventory items."))}</p>`}</section>
  </div>`;
  wirePanel(app, panel);
}

function itemPanel(app, panel) {
  const item = app.document, hf = item.system?.hiddenFields ?? {}, editable = app.isEditable !== false;
  const liteMode = !!globalThis.CONFIG?.SD?.liteMode;
  const graphButton = (item.actor && !liteMode) ? `<button type="button" data-sdit-action="graph" class="primary"><i class="fas fa-diagram-project"></i> ${esc(loc("tabs.openGraph", "Open Actor Trade Node Graph"))}</button>` : "";
  panel.innerHTML = `<div class="sdit-sheet-tab"><div class="sdit-tab-head"><div><h2><i class="fas fa-scale-balanced"></i> ${esc(loc("tabs.trade", "Trade"))}</h2><p>${esc(loc("tabs.itemHint", "Mark this item for sale. Its Item Ref and Price Output are created in the owning Actor's Trade Graph."))}</p></div>${graphButton}</div><section class="sdit-panel"><h3>${esc(loc("trade.SaleSettings", "Sale settings"))}</h3><div class="sdit-toggle-grid"><div class="sdit-toggle"><input id="sdit-saleable-${item.id}" type="checkbox" data-item-own="saleable" ${truthy(hf.saleable) ? "checked" : ""} ${editable ? "" : "disabled"}><label for="sdit-saleable-${item.id}">${esc(loc("trade.Saleable", "Saleable"))}</label></div><div class="sdit-toggle"><input id="sdit-infinite-${item.id}" type="checkbox" data-item-own="infiniteSale" ${truthy(hf.infiniteSale) ? "checked" : ""} ${editable ? "" : "disabled"}><label for="sdit-infinite-${item.id}">${esc(loc("trade.InfiniteSale", "Infinite sale"))}</label></div></div><div class="sdit-grid"><label><span>${esc(loc("trade.SalePriceOverride", "Default price"))}</span><input type="number" min="0" data-item-own="salePrice" value="${hf.salePrice ?? ""}" placeholder="${number(item.system?.price, 0)}" ${editable ? "" : "disabled"}></label><label><span>${esc(loc("trade.SaleCurrency", "Default currency"))}</span><select data-item-own="saleCurrency" ${editable ? "" : "disabled"}>${currencyOptions(hf.saleCurrency)}</select></label></div></section></div>`;
  wirePanel(app, panel);
}

async function updateHidden(doc,key,input) {
  const value=input.type==="checkbox"?input.checked:input.type==="number"?(input.value===""?"":number(input.value)):input.value;
  await doc.update({[`system.hiddenFields.${key}`]:value});
}

function wirePanel(app,panel) {
  panel.querySelector('[data-sdit-action="graph"]')?.addEventListener("click",()=>openTradeNodeGraph(app.document?.documentName==="Item"&&app.document.actor?app.document.actor:app.document));

  panel.querySelectorAll("[data-actor-hidden]").forEach(input=>input.addEventListener("change",async()=>{await updateHidden(app.document,input.dataset.actorHidden,input);app._buildTabPanels();}));
  panel.querySelectorAll("[data-item-own]").forEach(input=>input.addEventListener("change",async()=>{await updateHidden(app.document,input.dataset.itemOwn,input);app._buildTabPanels();}));
  panel.querySelectorAll("[data-item-field]").forEach(input=>input.addEventListener("change",async()=>{const item=app.document.items?.get?.(input.closest("[data-item-id]")?.dataset.itemId);if(!item)return;await updateHidden(item,input.dataset.itemField,input);}));
  panel.querySelector('[data-sdit-action="save-rules"]')?.addEventListener("click",async()=>{const raw={};panel.querySelectorAll("[data-rule]").forEach(input=>raw[input.dataset.rule]=input.value);raw.blockedCategories=String(raw.blockedCategories??"").split(",").map(x=>x.trim()).filter(Boolean);for(const key of ["buyMultiplier","sellMultiplier","feePercent","maxQuantity","minPrice","maxPrice"])raw[key]=number(raw[key]);await sdFlags(app.document).setFlag(MODULE_ID,"rules",raw);ui.notifications.info(loc("messages.saved","Improved Trading settings saved."));});
}

function appendPanel(app) {
  const container=app.element?.querySelector?.(".sd-panels-container");
  if(!container)return;
  container.querySelector(`[data-tab="${TRADE_TAB}"]`)?.remove();
  const panel=document.createElement("div");panel.className="sd-tab-panel sdit-trade-panel";panel.dataset.tab=TRADE_TAB;panel.style.cssText=`display:${app.tabGroups?.sheet===TRADE_TAB?"flex":"none"};flex:1;overflow-y:auto;padding:12px 14px;flex-direction:column;gap:8px;min-height:0`;
  if(app.document?.documentName==="Actor")actorPanel(app,panel);else itemPanel(app,panel);
  container.appendChild(panel);
  if(app.tabGroups?.sheet===TRADE_TAB)container.querySelectorAll(".sd-tab-panel").forEach(el=>el.style.display=el===panel?"flex":"none");
}

function patchSheetClass(SheetClass) {
  const p=SheetClass?.prototype;if(!p||p.Patched)return;p.Patched=true;
  const nav=p._buildTabNav,panels=p._buildTabPanels,switchTab=p._switchTab;
  p._buildTabNav=function(...args){const result=nav.apply(this,args);navButton(this);return result;};
  p._buildTabPanels=function(...args){const wanted=this.tabGroups?.sheet===TRADE_TAB;if(wanted)this.tabGroups.sheet=(this.document.system?.customTabs??[])[0]?.id??"_sys_hidden";const result=panels.apply(this,args);if(wanted)this.tabGroups.sheet=TRADE_TAB;appendPanel(this);navButton(this);return result;};
  p._switchTab=function(id,...args){if(id!==TRADE_TAB)return switchTab.call(this,id,...args);this.tabGroups.sheet=TRADE_TAB;this._buildTabNav();this._buildTabPanels();};
}

export async function openTradeSettings(doc) {
  const { openFoundryWindow } = await import("../helpers/foundry-window-host.mjs");
  const panel = document.createElement("div");
  panel.style.cssText = "padding:14px;overflow:auto;flex:1;min-height:0";
  const app = { document:doc, isEditable:doc.isOwner !== false, _buildTabPanels() {} };
  if (doc.documentName === "Actor") actorPanel(app, panel); else itemPanel(app, panel);
  return openFoundryWindow({id:`sd-trade-settings-${doc.id}`,title:"Trade settings",width:760,height:620,content:panel});
}

export async function registerTradeGraph() {}
export async function registerStoredTradeGraphs() {}

export async function openTradeNodeGraph(doc) {
  if (!FormulaGraph) ({ FormulaGraph } = await import("../builder/formula-graph.mjs"));
  const graph = new FormulaGraph(null, doc, null, null, null, {
    mode: "sheetTrigger",
    customLoad: () => syncGraphProducts(sdFlags(doc).getFlag(MODULE_ID, "tradeGraph") ?? null, doc),
    customSave: async graphData => {
      const synced = syncGraphProducts(graphData, doc);
      await sdFlags(doc).setFlag(MODULE_ID, "tradeGraph", { _graphData: synced });
    }
  });
  graph.open();
  setTimeout(() => {
    const title = graph.win?.querySelector?.(".window-title,.sdg-title,.sdg-head-title");
    if (title) title.textContent = "Trade Node Graph";
  }, 50);
  return graph;
}

export function installTradeGraphEventBridge() {}

export async function installTradeSheetIntegration({SDTrade}={}) {if(installed)return;installed=true;TradeApi=SDTrade;const [{CharacterSheet},{SDItemSheet}]=await Promise.all([import("../sheets/character-sheet.mjs"),import("../sheets/item-sheet.mjs")]);patchSheetClass(CharacterSheet);patchSheetClass(SDItemSheet);for(const app of Object.values(foundry.applications.instances??{})){if(app instanceof CharacterSheet||app instanceof SDItemSheet){app._buildTabNav?.();app._buildTabPanels?.();}}}
