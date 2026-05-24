

import { ItemPreviewPopup } from "./item-preview-popup.mjs";

const { ApplicationV2 } = foundry.applications.api;

const SOCKET_NS = "system.sd";

function _esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function _i18n(key, fallback) {
  const v = game.i18n?.localize?.(key);
  if (!v || v === key) return fallback ?? key;
  return v;
}

function _gid(prefix) {
  return `${prefix}${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-3)}`;
}

function _getCurrencies() {
  if (Array.isArray(CONFIG?.SD?.currencies) && CONFIG.SD.currencies.length) return CONFIG.SD.currencies;
  return [
    { key: "primary",   label: "Gold"   },
    { key: "secondary", label: "Silver" },
    { key: "tertiary",  label: "Copper" }
  ];
}

function _readTraderConfig(actor) {
  const hf = actor?.system?.hiddenFields ?? {};
  const cats = String(hf.tradeCategories ?? "")
    .split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
  return {
    isTrader:        _coerceBool(hf.trader),
    autoTrade:       _coerceBool(hf.autoTrade),
    priceDistortion: Number(hf.priceDistortion ?? 100),
    tradeCategories: cats
  };
}

function _readSaleConfig(item) {
  const hf = item?.system?.hiddenFields ?? {};
  const owner = item.parent;

  let price = Number(item?.system?.price ?? 0);

  if (hf.salePrice !== undefined && hf.salePrice !== null && hf.salePrice !== "") {
    const v = Number(hf.salePrice);
    if (Number.isFinite(v)) price = v;
  }

  if (hf.salePricePath && owner) {
    const v = foundry.utils.getProperty(owner, String(hf.salePricePath));
    if (Number.isFinite(Number(v))) price = Number(v);
  }

  let currency = String(hf.saleCurrency || item?.system?.currency || "primary");
  const known = _getCurrencies().map(c => c.key);
  if (!known.includes(currency)) currency = known[0] ?? "primary";

  return {
    saleable: _coerceBool(hf.saleable),
    price,
    currency
  };
}

function _coerceBool(v) {
  if (v === true || v === "true" || v === 1 || v === "1" || v === "yes" || v === "on") return true;
  return false;
}

function _firstActiveGM() {
  return game.users?.find(u => u.isGM && u.active) ?? null;
}

function _isGMActive() {
  return !!_firstActiveGM();
}

function _ownerUserOf(actor) {

  if (!actor) return null;
  const direct = actor.ownership ?? {};
  for (const [uid, lvl] of Object.entries(direct)) {
    if (uid === "default") continue;
    if (lvl < 3) continue;
    const u = game.users?.get(uid);
    if (u?.active && !u.isGM) return u;
  }
  if ((direct.default ?? 0) >= 3) {
    const u = game.users?.find(u => u.active && !u.isGM);
    if (u) return u;
  }
  return null;
}

function _userTargetForActor(actor) {

  return _ownerUserOf(actor) ?? _firstActiveGM();
}

function _itemSummaryFromActor(actor, itemId, qty) {
  const item = actor?.items?.get?.(itemId);
  if (!item) return null;
  return {
    id:       item.id,
    name:     item.name,
    img:      item.img,
    type:     item.type,
    have:     Number(item.system?.quantity ?? 1),
    qty:      Math.max(1, Math.min(Number(qty ?? 1), Number(item.system?.quantity ?? 1)))
  };
}

export class SDTrade {

  static _state = new Map();

  static init() {

    Hooks.once("ready", () => {
      game.socket.on(SOCKET_NS, (data) => SDTrade._onSocket(data).catch(err => console.error("SD | trade socket error", err)));
    });
  }

  static async openFor(actor) {
    if (!actor) return;
    const partner = await SDTrade.pickPartner(actor);
    if (!partner) return;
    if (partner.id === actor.id) {
      ui.notifications?.warn?.(_i18n("SD.Trade.SelfWarning", "Cannot trade with yourself."));
      return;
    }

    const cfg = _readTraderConfig(partner);
    if (cfg.isTrader && cfg.autoTrade) {

      new SDAutoTradeShop({ buyer: actor, trader: partner }).render(true);
      return;
    }

    return SDTrade.requestManualTrade(actor, partner);
  }

  static async pickPartner(actor) {

    const sceneTokenActorIds = new Set();
    const scene = game.scenes?.viewed ?? game.scenes?.active;
    if (scene) {
      for (const tok of scene.tokens) {
        const a = tok.actor;
        if (!a || a.id === actor.id) continue;
        sceneTokenActorIds.add(a.id);
      }
    }

    const traderIds = new Set();
    for (const a of game.actors) {
      if (a.id === actor.id) continue;
      const cfg = _readTraderConfig(a);
      if (cfg.isTrader) traderIds.add(a.id);
    }

    const all = [];
    const seen = new Set();
    const _add = (a, source) => {
      if (!a || seen.has(a.id)) return;
      seen.add(a.id);
      all.push({ actor: a, source });
    };
    for (const id of sceneTokenActorIds) _add(game.actors.get(id), "scene");
    for (const id of traderIds) {
      if (seen.has(id)) continue;
      _add(game.actors.get(id), "trader");
    }

    if (!all.length) {
      ui.notifications?.warn?.(_i18n("SD.Trade.NoPartners", "No trade partners available (no tokens on scene, no traders)."));
      return null;
    }

    const rows = all.map(({ actor: a, source }) => {
      const cfg = _readTraderConfig(a);
      const badges = [];
      if (source === "scene")  badges.push(`<span style="background:#5a8ad8;color:#fff;border-radius:8px;padding:1px 6px;font-size:9px">${_esc(_i18n("SD.Trade.OnScene","On Scene"))}</span>`);
      if (cfg.isTrader)        badges.push(`<span style="background:#d8a83a;color:#000;border-radius:8px;padding:1px 6px;font-size:9px">${_esc(_i18n("SD.Trade.Trader","Trader"))}</span>`);
      if (cfg.isTrader && cfg.autoTrade) badges.push(`<span style="background:#3aa860;color:#fff;border-radius:8px;padding:1px 6px;font-size:9px">${_esc(_i18n("SD.Trade.Auto","Auto"))}</span>`);
      return `<label style="display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid var(--sd-border);border-radius:6px;cursor:pointer;background:var(--sd-bg-2);transition:background .1s">
        <input type="radio" name="partnerId" value="${_esc(a.id)}" style="margin:0">
        <img src="${_esc(a.img)}" style="width:32px;height:32px;border-radius:4px;object-fit:cover">
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600;color:var(--sd-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_esc(a.name)}</div>
          <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:2px">${badges.join("")}</div>
        </div>
      </label>`;
    }).join("");

    return new Promise(resolve => {
      new foundry.applications.api.DialogV2({
        modal: true,
        window: { title: _i18n("SD.Trade.PickPartner", "Pick trade partner") },
        position: { width: 460 },
        content: `<div style="padding:10px;display:flex;flex-direction:column;gap:6px;max-height:400px;overflow:auto">${rows}</div>`,
        buttons: [
          {
            action: "ok",
            label: _i18n("SD.Trade.OK", "Trade"),
            icon: "fas fa-handshake",
            default: true,
            callback: (ev, btn) => {
              const root = btn?.form ?? document;
              const checked = root.querySelector("input[name='partnerId']:checked");
              const id = checked?.value ?? null;
              resolve(id ? game.actors.get(id) : null);
            }
          },
          { action: "cancel", label: _i18n("SD.Trade.Cancel", "Cancel"), icon: "fas fa-xmark", callback: () => resolve(null) }
        ],
        rejectClose: false,
        close: () => resolve(null)
      }).render(true);
    });
  }

  static async requestManualTrade(initiator, partner) {
    if (!_isGMActive()) {
      ui.notifications?.warn?.(_i18n("SD.Trade.GMOffline", "Trading requires an active GM."));
      return;
    }

    const requestId  = _gid("trade-");
    const partnerUser = _ownerUserOf(partner) ?? _firstActiveGM();
    if (!partnerUser) {
      ui.notifications?.warn?.(_i18n("SD.Trade.NoPartnerUser", "No active user owns the partner actor."));
      return;
    }

    const sameUser = (partnerUser.id === game.user.id);

    SDTrade._state.set(requestId, {
      requestId,
      initiatorActorUuid: initiator.uuid,
      partnerActorUuid:   partner.uuid,
      initiatorUserId:    game.user.id,
      partnerUserId:      partnerUser.id,
      sameUser,
      offers: {
        init: { items: [], currency: {} },
        part: { items: [], currency: {} }
      },
      ready: { init: false, part: false }
    });

    if (sameUser) {

      SDTrade._openWindow(requestId);
      return;
    }

    game.socket.emit(SOCKET_NS, {
      type:       "trade.request",
      requestId,
      from:       game.user.id,
      to:         partnerUser.id,
      initiatorActorUuid: initiator.uuid,
      partnerActorUuid:   partner.uuid,
      initiatorName:      initiator.name,
      partnerName:        partner.name
    });

    ui.notifications?.info?.(_i18n("SD.Trade.Sent", "Trade request sent. Waiting for response…"));
  }

  static async _onSocket(data) {
    if (!data || typeof data !== "object") return;
    if (typeof data.type !== "string" || !data.type.startsWith("trade.")) return;

    switch (data.type) {

      case "trade.request": {
        if (data.to !== game.user.id) return;
        const accepted = await SDTrade._showAcceptDialog(data);
        if (!accepted) {
          game.socket.emit(SOCKET_NS, { type: "trade.declined", requestId: data.requestId, to: data.from });
          return;
        }
        SDTrade._state.set(data.requestId, {
          requestId:          data.requestId,
          initiatorActorUuid: data.initiatorActorUuid,
          partnerActorUuid:   data.partnerActorUuid,
          initiatorUserId:    data.from,
          partnerUserId:      game.user.id,
          sameUser:           false,
          offers: {
            init: { items: [], currency: {} },
            part: { items: [], currency: {} }
          },
          ready: { init: false, part: false }
        });
        game.socket.emit(SOCKET_NS, { type: "trade.accepted", requestId: data.requestId, to: data.from });
        SDTrade._openWindow(data.requestId);
        return;
      }

      case "trade.accepted": {
        if (data.to !== game.user.id) return;
        if (!SDTrade._state.has(data.requestId)) return;
        ui.notifications?.info?.(_i18n("SD.Trade.Accepted", "Trade accepted. Opening window…"));
        SDTrade._openWindow(data.requestId);
        return;
      }

      case "trade.declined": {
        if (data.to !== game.user.id) return;
        SDTrade._state.delete(data.requestId);
        ui.notifications?.warn?.(_i18n("SD.Trade.Declined", "Trade declined."));
        return;
      }

      case "trade.cancelled": {
        const st = SDTrade._state.get(data.requestId);
        if (!st) return;
        SDTrade._state.delete(data.requestId);
        const win = SDTradeWindow._open.get(data.requestId);
        win?.close({ skipNotify: true });
        if (data.from !== game.user.id) {
          ui.notifications?.warn?.(_i18n("SD.Trade.OtherCancelled", "Trade cancelled by other party."));
        }
        return;
      }

      case "trade.update": {
        const st = SDTrade._state.get(data.requestId);
        if (!st) return;
        if (data.from === game.user.id) return;
        const side = (data.side === "init" || data.side === "part") ? data.side
                   : (data.from === st.initiatorUserId) ? "init"
                   : (data.from === st.partnerUserId)   ? "part" : null;
        if (!side) return;
        const prevOffer = st.offers[side] ?? { items: [], currency: {} };
        const nextOffer = data.offer ?? { items: [], currency: {} };
        const offerChanged = !_offersEqual(prevOffer, nextOffer);
        st.offers[side] = nextOffer;

        if (offerChanged) {
          st.ready.init = false;
          st.ready.part = false;
        }
        const win = SDTradeWindow._open.get(data.requestId);
        win?.refresh();
        return;
      }

      case "trade.ready": {
        const st = SDTrade._state.get(data.requestId);
        if (!st) return;
        const side = (data.side === "init" || data.side === "part") ? data.side
                   : (data.from === st.initiatorUserId) ? "init"
                   : (data.from === st.partnerUserId)   ? "part" : null;
        if (!side) return;
        st.ready[side] = !!data.ready;
        const win = SDTradeWindow._open.get(data.requestId);
        win?.refresh();
        if (st.ready.init && st.ready.part) {
          if (game.user.isGM && data.from !== game.user.id) {

            await SDTrade._gmCommit(st);
          }
        }
        return;
      }

      case "trade.commit-result": {
        const st = SDTrade._state.get(data.requestId);
        if (!st) return;
        const win = SDTradeWindow._open.get(data.requestId);
        if (data.ok) {
          ui.notifications?.info?.(_i18n("SD.Trade.Done", "Trade complete."));
          win?.close({ skipNotify: true });
          SDTrade._state.delete(data.requestId);
        } else {
          ui.notifications?.error?.(data.error || _i18n("SD.Trade.Failed", "Trade failed."));
          st.ready.init = false;
          st.ready.part = false;
          win?.refresh();
        }
        return;
      }

      case "trade.autoBuy": {
        if (!game.user.isGM) return;
        await SDTrade._gmAutoBuy(data);
        return;
      }
      case "trade.autoSell": {
        if (!game.user.isGM) return;
        await SDTrade._gmAutoSell(data);
        return;
      }
      case "trade.autoResult": {
        if (data.to !== game.user.id) return;
        if (data.ok) ui.notifications?.info?.(data.msg || _i18n("SD.Trade.AutoOk", "Trade complete."));
        else         ui.notifications?.error?.(data.msg || _i18n("SD.Trade.AutoErr", "Trade failed."));

        for (const win of SDAutoTradeShop._open.values()) win.refresh();
        return;
      }
    }
  }

  static async _showAcceptDialog(data) {
    const initActor = await fromUuid(data.initiatorActorUuid).catch(() => null);
    const partActor = await fromUuid(data.partnerActorUuid).catch(() => null);
    const html = `
      <div style="padding:14px;font-size:13px;line-height:1.6">
        <p>${_esc(_i18n("SD.Trade.AcceptPrompt", "Accept trade request?"))}</p>
        <div style="display:flex;align-items:center;gap:10px;background:var(--sd-bg-2);padding:8px;border-radius:6px;margin-top:8px">
          <img src="${_esc(initActor?.img ?? data.initiatorName)}" style="width:36px;height:36px;border-radius:4px;object-fit:cover">
          <div>
            <div style="font-size:11px;color:var(--sd-text-3);text-transform:uppercase;letter-spacing:.04em">${_esc(_i18n("SD.Trade.From", "From"))}</div>
            <div style="font-weight:600">${_esc(initActor?.name ?? data.initiatorName)}</div>
          </div>
          <i class="fas fa-arrow-right" style="margin:0 6px;color:var(--sd-accent)"></i>
          <img src="${_esc(partActor?.img ?? data.partnerName)}" style="width:36px;height:36px;border-radius:4px;object-fit:cover">
          <div>
            <div style="font-size:11px;color:var(--sd-text-3);text-transform:uppercase;letter-spacing:.04em">${_esc(_i18n("SD.Trade.To", "To"))}</div>
            <div style="font-weight:600">${_esc(partActor?.name ?? data.partnerName)}</div>
          </div>
        </div>
      </div>`;
    return new Promise(resolve => {
      new foundry.applications.api.DialogV2({
        modal: false,
        window: { title: _i18n("SD.Trade.RequestTitle", "Trade Request") },
        content: html,
        buttons: [
          { action: "accept", label: _i18n("SD.Trade.Accept", "Accept"), icon: "fas fa-check", default: true, callback: () => resolve(true) },
          { action: "decline", label: _i18n("SD.Trade.Decline", "Decline"), icon: "fas fa-xmark", callback: () => resolve(false) }
        ],
        rejectClose: false,
        close: () => resolve(false)
      }).render(true);
    });
  }

  static _openWindow(requestId) {
    const st = SDTrade._state.get(requestId);
    if (!st) return;
    if (SDTradeWindow._open.has(requestId)) return;
    new SDTradeWindow({ requestId }).render(true);
  }

  static async _gmCommit(state) {
    const reqId = state.requestId;
    try {
      const initActor = await fromUuid(state.initiatorActorUuid);
      const partActor = await fromUuid(state.partnerActorUuid);
      if (!initActor || !partActor) throw new Error("Actor missing");

      const initOffer = state.offers.init ?? { items: [], currency: {} };
      const partOffer = state.offers.part ?? { items: [], currency: {} };

      _validateOffer(initActor, initOffer);
      _validateOffer(partActor, partOffer);

      await _moveItems(initActor, partActor, initOffer.items);
      await _moveItems(partActor, initActor, partOffer.items);
      await _moveCurrency(initActor, partActor, initOffer.currency);
      await _moveCurrency(partActor, initActor, partOffer.currency);

      [state.initiatorUserId, state.partnerUserId].forEach(uid => {
        game.socket.emit(SOCKET_NS, { type: "trade.commit-result", requestId: reqId, to: uid, ok: true });
      });

      if (game.user.id === state.initiatorUserId || game.user.id === state.partnerUserId) {
        SDTrade._onSocket({ type: "trade.commit-result", requestId: reqId, to: game.user.id, ok: true });
      }

    } catch (err) {
      console.error("SD | trade commit failed", err);
      const msg = String(err?.message || err || "Unknown error");
      [state.initiatorUserId, state.partnerUserId].forEach(uid => {
        game.socket.emit(SOCKET_NS, { type: "trade.commit-result", requestId: reqId, to: uid, ok: false, error: msg });
      });
      if (game.user.id === state.initiatorUserId || game.user.id === state.partnerUserId) {
        SDTrade._onSocket({ type: "trade.commit-result", requestId: reqId, to: game.user.id, ok: false, error: msg });
      }
    }
  }

  static async _gmAutoBuy(data) {

    const buyer  = await fromUuid(data.buyerActorUuid).catch(() => null);
    const trader = await fromUuid(data.traderActorUuid).catch(() => null);
    const item   = trader?.items?.get?.(data.itemId);
    const qty    = Math.max(1, Number(data.qty || 1));
    if (!buyer || !trader || !item) {
      game.socket.emit(SOCKET_NS, { type: "trade.autoResult", to: data.from, ok: false, msg: _i18n("SD.Trade.AutoErr","Trade failed: actor or item missing.") });
      return;
    }
    const sale = _readSaleConfig(item);
    if (!sale.saleable) {
      game.socket.emit(SOCKET_NS, { type: "trade.autoResult", to: data.from, ok: false, msg: _i18n("SD.Trade.NotSaleable","Item is not for sale.") });
      return;
    }
    const cost = sale.price * qty;
    const have = Number(buyer.system?.currency?.[sale.currency] ?? 0);
    if (have < cost) {
      game.socket.emit(SOCKET_NS, { type: "trade.autoResult", to: data.from, ok: false, msg: _i18n("SD.Trade.NotEnoughCurrency","Not enough currency.") });
      return;
    }
    const haveQty = Number(item.system?.quantity ?? 1);
    if (haveQty < qty) {
      game.socket.emit(SOCKET_NS, { type: "trade.autoResult", to: data.from, ok: false, msg: _i18n("SD.Trade.NotEnoughStock","Not enough stock.") });
      return;
    }

    try {
      await _moveItems(trader, buyer, [{ id: item.id, qty }]);
      await buyer.update({ [`system.currency.${sale.currency}`]: have - cost });
      await trader.update({ [`system.currency.${sale.currency}`]: Number(trader.system?.currency?.[sale.currency] ?? 0) + cost });
      game.socket.emit(SOCKET_NS, { type: "trade.autoResult", to: data.from, ok: true, msg: _i18n("SD.Trade.BoughtMsg","Purchase complete.") });

      if (data.from === game.user.id) SDTrade._onSocket({ type: "trade.autoResult", to: game.user.id, ok: true, msg: _i18n("SD.Trade.BoughtMsg","Purchase complete.") });
    } catch (err) {
      console.error("SD | autoBuy failed", err);
      game.socket.emit(SOCKET_NS, { type: "trade.autoResult", to: data.from, ok: false, msg: String(err?.message || err) });
    }
  }

  static async _gmAutoSell(data) {

    const seller = await fromUuid(data.sellerActorUuid).catch(() => null);
    const trader = await fromUuid(data.traderActorUuid).catch(() => null);
    const item   = seller?.items?.get?.(data.itemId);
    const qty    = Math.max(1, Number(data.qty || 1));
    if (!seller || !trader || !item) {
      game.socket.emit(SOCKET_NS, { type: "trade.autoResult", to: data.from, ok: false, msg: _i18n("SD.Trade.AutoErr","Trade failed: actor or item missing.") });
      return;
    }
    const tcfg = _readTraderConfig(trader);
    const cat  = String(item.system?.category ?? "");
    if (tcfg.tradeCategories.length && !tcfg.tradeCategories.includes(cat)) {
      game.socket.emit(SOCKET_NS, { type: "trade.autoResult", to: data.from, ok: false, msg: _i18n("SD.Trade.WrongCategory","Trader does not buy this category.") });
      return;
    }
    const sale = _readSaleConfig(item);
    const list = sale.price;
    const pay  = Math.floor(list * qty * (tcfg.priceDistortion / 100));
    const traderHas = Number(trader.system?.currency?.[sale.currency] ?? 0);
    if (traderHas < pay) {
      game.socket.emit(SOCKET_NS, { type: "trade.autoResult", to: data.from, ok: false, msg: _i18n("SD.Trade.TraderBroke","Trader cannot afford this.") });
      return;
    }
    const haveQty = Number(item.system?.quantity ?? 1);
    if (haveQty < qty) {
      game.socket.emit(SOCKET_NS, { type: "trade.autoResult", to: data.from, ok: false, msg: _i18n("SD.Trade.NotEnoughStock","Not enough stock.") });
      return;
    }

    try {
      await _moveItems(seller, trader, [{ id: item.id, qty }]);
      await trader.update({ [`system.currency.${sale.currency}`]: traderHas - pay });
      await seller.update({ [`system.currency.${sale.currency}`]: Number(seller.system?.currency?.[sale.currency] ?? 0) + pay });
      game.socket.emit(SOCKET_NS, { type: "trade.autoResult", to: data.from, ok: true, msg: _i18n("SD.Trade.SoldMsg","Sale complete.") });
      if (data.from === game.user.id) SDTrade._onSocket({ type: "trade.autoResult", to: game.user.id, ok: true, msg: _i18n("SD.Trade.SoldMsg","Sale complete.") });
    } catch (err) {
      console.error("SD | autoSell failed", err);
      game.socket.emit(SOCKET_NS, { type: "trade.autoResult", to: data.from, ok: false, msg: String(err?.message || err) });
    }
  }
}

function _offersEqual(a, b) {
  const ai = Array.isArray(a?.items) ? a.items : [];
  const bi = Array.isArray(b?.items) ? b.items : [];
  if (ai.length !== bi.length) return false;
  const bMap = new Map();
  for (const it of bi) bMap.set(String(it?.id ?? ""), Math.max(1, Number(it?.qty ?? 1)));
  for (const it of ai) {
    const id = String(it?.id ?? "");
    const aq = Math.max(1, Number(it?.qty ?? 1));
    if (bMap.get(id) !== aq) return false;
  }
  const ac = a?.currency ?? {};
  const bc = b?.currency ?? {};
  const keys = new Set([...Object.keys(ac), ...Object.keys(bc)]);
  for (const k of keys) {
    const av = Math.max(0, Number(ac[k] ?? 0));
    const bv = Math.max(0, Number(bc[k] ?? 0));
    if (av !== bv) return false;
  }
  return true;
}

function _validateOffer(actor, offer) {
  for (const it of (offer.items ?? [])) {
    const item = actor.items.get(it.id);
    if (!item) throw new Error(_i18n("SD.Trade.MissingItem","Item missing on actor."));
    const qty = Math.max(1, Number(it.qty || 1));
    const have = Number(item.system?.quantity ?? 1);
    if (have < qty) throw new Error(_i18n("SD.Trade.QtyShort", `Not enough quantity for ${item.name}.`));
  }
  for (const [key, amt] of Object.entries(offer.currency ?? {})) {
    const have = Number(actor.system?.currency?.[key] ?? 0);
    if (have < Number(amt || 0)) throw new Error(_i18n("SD.Trade.CashShort", `Not enough ${key}.`));
  }
}

async function _moveItems(from, to, items) {
  for (const it of (items ?? [])) {
    const src = from.items.get(it.id);
    if (!src) continue;
    const moveQty = Math.max(1, Number(it.qty || 1));
    const haveQty = Number(src.system?.quantity ?? 1);

    const data = src.toObject();
    data.system = data.system ?? {};
    data.system.quantity = moveQty;
    delete data._id;
    await to.createEmbeddedDocuments("Item", [data]);

    if (moveQty >= haveQty) {
      await src.delete();
    } else {
      await src.update({ "system.quantity": haveQty - moveQty });
    }
  }
}

async function _moveCurrency(from, to, currency) {
  if (!currency) return;
  const fromUpd = {};
  const toUpd   = {};
  let any = false;
  for (const [key, amtRaw] of Object.entries(currency)) {
    const amt = Math.max(0, Number(amtRaw || 0));
    if (!amt) continue;
    fromUpd[`system.currency.${key}`] = Number(from.system?.currency?.[key] ?? 0) - amt;
    toUpd[`system.currency.${key}`]   = Number(to.system?.currency?.[key]   ?? 0) + amt;
    any = true;
  }
  if (!any) return;
  await from.update(fromUpd);
  await to.update(toUpd);
}

export class SDTradeWindow extends ApplicationV2 {

  static _open = new Map();

  static DEFAULT_OPTIONS = {
    classes: ["sd","sd-trade-window"],
    position: { width: 760, height: 560 },
    window: { title: "Trade", resizable: true, minimizable: true }
  };

  constructor({ requestId } = {}, options = {}) {
    super(options);
    this.requestId = requestId;
    SDTradeWindow._open.set(requestId, this);
  }

  get title() {
    const st = SDTrade._state.get(this.requestId);
    if (!st) return _i18n("SD.Trade.Title", "Trade");
    return _i18n("SD.Trade.Title", "Trade");
  }

  async _renderHTML(context, options) { return this._renderBody(); }
  _replaceHTML(html, content, options) { content.innerHTML = html; this._wire(); }

  refresh() {
    const root = this.element;
    if (!root) return;
    const content = root.querySelector(".window-content");
    if (!content) return;
    content.innerHTML = this._renderBody();
    this._wire();
  }

  _renderBody() {
    const st = SDTrade._state.get(this.requestId);
    if (!st) return `<div style="padding:18px;color:var(--sd-text-3)">${_esc(_i18n("SD.Trade.GoneAway","This trade is no longer active."))}</div>`;

    const initActor = fromUuidSync?.(st.initiatorActorUuid) ?? null;
    const partActor = fromUuidSync?.(st.partnerActorUuid)   ?? null;
    const isSameUser = !!st.sameUser;

    const mySide = isSameUser ? "both"
                 : (game.user.id === st.initiatorUserId) ? "init"
                 : "part";

    const cur = _getCurrencies();

    const _renderOfferCol = (actor, offer, sideKey, label, readonly) => {
      const ownerUuid = _esc(actor?.uuid ?? "");
      const items = (offer.items ?? []).map(it => {
        const summary = _itemSummaryFromActor(actor, it.id, it.qty) ?? { name: "?", img: "icons/svg/item-bag.svg", qty: it.qty, have: 0 };
        const removeBtn = readonly ? "" : `<button type="button" class="sd-tw-remove" data-side="${sideKey}" data-id="${_esc(it.id)}" style="background:none;border:none;color:var(--sd-text-3);cursor:pointer;font-size:13px">✕</button>`;
        const qtyInput  = readonly
          ? `<span style="min-width:34px;text-align:right">×${summary.qty}</span>`
          : `<input type="number" min="1" max="${summary.have}" value="${summary.qty}" data-side="${sideKey}" data-id="${_esc(it.id)}" class="sd-tw-qty" style="width:50px;background:var(--sd-bg);border:1px solid var(--sd-w-bd,var(--sd-border));border-radius:4px;color:var(--sd-text);text-align:center;padding:2px 4px">`;

        return `<div class="sd-tw-item-row" data-sd-preview-ref="item:${_esc(it.id)}" data-sd-actor-uuid="${ownerUuid}" data-item-id="${_esc(it.id)}" style="display:flex;align-items:center;gap:6px;padding:4px 6px;background:var(--sd-bg-2);border-radius:5px;margin-bottom:4px">
          <img src="${_esc(summary.img)}" style="width:28px;height:28px;border-radius:3px;object-fit:cover">
          <div style="flex:1;min-width:0;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_esc(summary.name)}</div>
          ${qtyInput}
          ${removeBtn}
        </div>`;
      }).join("") || `<div style="padding:14px;text-align:center;color:var(--sd-text-3);font-size:11px;font-style:italic">${_esc(_i18n("SD.Trade.DropHint","Drop items here"))}</div>`;

      const curRows = cur.map(c => {
        const v = Number(offer.currency?.[c.key] ?? 0);
        const have = Number(actor?.system?.currency?.[c.key] ?? 0);
        const inp = readonly
          ? `<span style="min-width:60px;text-align:right">${v}</span>`
          : `<input type="number" min="0" max="${have}" value="${v}" data-side="${sideKey}" data-key="${_esc(c.key)}" class="sd-tw-cur" style="width:80px;background:var(--sd-bg);border:1px solid var(--sd-w-bd,var(--sd-border));border-radius:4px;color:var(--sd-text);text-align:right;padding:2px 6px">`;
        return `<div style="display:flex;align-items:center;gap:6px;padding:3px 6px">
          <span style="flex:1;font-size:12px">${_esc(c.label ?? c.key)}</span>
          <span style="font-size:10px;color:var(--sd-text-3)">/ ${have}</span>
          ${inp}
        </div>`;
      }).join("");

      return `<div class="sd-tw-col" data-side="${sideKey}" style="flex:1;display:flex;flex-direction:column;gap:8px;min-width:0;background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:8px;padding:10px">
        <div style="display:flex;align-items:center;gap:8px">
          <img src="${_esc(actor?.img ?? "")}" style="width:36px;height:36px;border-radius:5px;object-fit:cover">
          <div style="flex:1;min-width:0">
            <div style="font-size:13px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_esc(actor?.name ?? "?")}</div>
            <div style="font-size:10px;color:var(--sd-text-3);text-transform:uppercase;letter-spacing:.04em">${_esc(label)}</div>
          </div>
        </div>
        <div class="sd-tw-items" data-drop-zone="${readonly ? "none" : sideKey}" style="flex:1;min-height:160px;max-height:260px;overflow-y:auto;border:1px dashed var(--sd-w-bd,var(--sd-border));border-radius:6px;padding:6px">
          ${items}
        </div>
        <div class="sd-tw-currency" style="border-top:1px solid var(--sd-border);padding-top:6px">
          ${curRows}
        </div>
      </div>`;
    };

    const initOffer = st.offers.init;
    const partOffer = st.offers.part;
    const initReady = !!st.ready.init;
    const partReady = !!st.ready.part;

    const youOffer  = _i18n("SD.Trade.YouOffer","You offer");
    const theyOffer = _i18n("SD.Trade.TheyOffer","They offer");
    const initLabel = _i18n("SD.Trade.InitiatorOffer","Initiator offers");
    const partLabel = _i18n("SD.Trade.PartnerOffer","Partner offers");

    let columns = "";
    if (isSameUser) {

      columns = `${_renderOfferCol(initActor, initOffer, "init", initLabel, false)}
                 ${_renderOfferCol(partActor, partOffer, "part", partLabel, false)}`;
    } else {
      const meIsInit  = mySide === "init";
      const meActor   = meIsInit ? initActor : partActor;
      const themActor = meIsInit ? partActor : initActor;
      const meOffer   = meIsInit ? initOffer : partOffer;
      const themOffer = meIsInit ? partOffer : initOffer;
      const themSide  = meIsInit ? "part"    : "init";
      columns = `${_renderOfferCol(meActor, meOffer, mySide, youOffer, false)}
                 ${_renderOfferCol(themActor, themOffer, themSide, theyOffer, true)}`;
    }

    let footerRight;
    if (isSameUser) {
      const bothReady = initReady && partReady;
      const bothLbl = bothReady
        ? _i18n("SD.Trade.UnreadyBoth","Cancel ready (both sides)")
        : _i18n("SD.Trade.ReadyBoth","Mark both sides ready");
      const bg = bothReady ? "#3aa860" : "var(--sd-accent)";
      footerRight = `<button type="button" class="sd-tw-ready" data-mode="both" style="background:${bg};border:none;color:#fff;border-radius:5px;padding:6px 14px;cursor:pointer;font-size:13px;font-weight:600">
        ${bothReady ? '<i class="fas fa-rotate-left"></i>' : '<i class="fas fa-check"></i>'} ${_esc(bothLbl)}
      </button>`;
    } else {
      const meReady   = mySide === "init" ? initReady : partReady;
      const themReady = mySide === "init" ? partReady : initReady;
      const meReadyTxt   = meReady   ? _i18n("SD.Trade.UnReady","Cancel ready") : _i18n("SD.Trade.Ready","I'm ready");
      const themReadyTxt = themReady ? `✓ ${_i18n("SD.Trade.OtherReady","Other side ready")}` : _i18n("SD.Trade.OtherWait","Waiting…");
      const meReadyBg    = meReady   ? "#3aa860" : "var(--sd-accent)";
      footerRight = `<div style="font-size:11px;color:var(--sd-text-3)">${_esc(themReadyTxt)}</div>
        <button type="button" class="sd-tw-ready" data-mode="me" style="background:${meReadyBg};border:none;color:#fff;border-radius:5px;padding:6px 14px;cursor:pointer;font-size:13px;font-weight:600">
          ${meReady ? '<i class="fas fa-rotate-left"></i>' : '<i class="fas fa-check"></i>'} ${_esc(meReadyTxt)}
        </button>`;
    }

    return `<div class="window-content" style="padding:0">
      <div style="padding:10px 12px;display:flex;flex-direction:column;gap:10px">
        <div style="display:flex;gap:10px;align-items:stretch">${columns}</div>
        <div style="display:flex;align-items:center;gap:10px;justify-content:space-between;border-top:1px solid var(--sd-border);padding-top:8px">
          <button type="button" class="sd-tw-cancel" style="background:transparent;border:1px solid var(--sd-border);color:var(--sd-text-3);border-radius:5px;padding:6px 12px;cursor:pointer;font-size:12px">
            <i class="fas fa-xmark"></i> ${_esc(_i18n("SD.Trade.CancelTrade","Cancel trade"))}
          </button>
          ${footerRight}
        </div>
      </div>
    </div>`;
  }

  _wire() {
    const root = this.element;
    if (!root) return;
    const st = SDTrade._state.get(this.requestId);
    if (!st) return;

    const initActor = fromUuidSync?.(st.initiatorActorUuid) ?? null;
    const partActor = fromUuidSync?.(st.partnerActorUuid)   ?? null;
    const actorBySide = (s) => s === "init" ? initActor : partActor;

    ItemPreviewPopup.attach(root, initActor ?? partActor ?? null);

    root.querySelectorAll('.sd-tw-items[data-drop-zone="init"], .sd-tw-items[data-drop-zone="part"]').forEach(dropZone => {
      const sideKey = dropZone.dataset.dropZone;
      const targetActor = actorBySide(sideKey);

      const onOver  = ev => { ev.preventDefault(); ev.stopPropagation(); dropZone.style.background = "var(--sd-accent-glow,rgba(123,104,238,.15))"; };
      const onEnter = ev => { ev.preventDefault(); ev.stopPropagation(); };
      const onLeave = () => { dropZone.style.background = ""; };

      dropZone.addEventListener("dragenter", onEnter);
      dropZone.addEventListener("dragover",  onOver);
      dropZone.addEventListener("dragleave", onLeave);

      dropZone.addEventListener("drop", async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        dropZone.style.background = "";
        try {
          const raw = ev.dataTransfer?.getData("text/plain")
                   || ev.dataTransfer?.getData("application/json")
                   || "";
          const data = raw ? JSON.parse(raw) : null;
          if (!data) return;

          if (data.type && data.type !== "Item") return;
          if (data.sdType || data.sdTypeAlt) return;
          const looksLikeItem = !!(data.uuid || data._id || data.id || data.sdSrc?.itemId || data.actorId);
          if (!looksLikeItem) return;

          const candidateIds = [
            data.sdSrc?.itemId,
            data._id,
            data.id,
            (typeof data.uuid === "string" ? data.uuid.split(".").pop() : null)
          ].filter(Boolean);

          let item = null;

          if (targetActor) {
            for (const id of candidateIds) {
              const it = targetActor.items?.get(id);
              if (it) { item = it; break; }
            }
          }

          if (!item && data.sdSrc?.kind === "inventory" && data.sdSrc?.actorUuid && data.sdSrc?.itemId) {
            const srcActor = await fromUuid(data.sdSrc.actorUuid).catch(() => null);
            item = srcActor?.items?.get(data.sdSrc.itemId) ?? null;
          }
          if (!item && data.uuid) {
            item = await fromUuid(data.uuid).catch(() => null);
          }
          if (!item && data._id && data.actorId) {
            const srcActor = game.actors?.get(data.actorId);
            item = srcActor?.items?.get(data._id) ?? null;
          }

          if (!item) {
            console.warn("SD | trade drop: could not resolve", { data, targetActorUuid: targetActor?.uuid });
            ui.notifications?.warn?.(_i18n("SD.Trade.DropResolveFail", "Could not resolve dropped item."));
            return;
          }

          const ownerMatches = !!(targetActor
            && item.parent
            && (item.parent.uuid === targetActor.uuid
                || item.parent.id  === targetActor.id));
          const onTargetActor = !!(targetActor && targetActor.items?.get(item.id));

          if (!ownerMatches && !onTargetActor) {
            ui.notifications?.warn?.(_i18n("SD.Trade.OnlyOwn","Items must come from this actor's own inventory."));
            return;
          }

          this._addItemToOffer(sideKey, item.id, 1);
        } catch (err) {
          console.warn("SD | trade drop", err);
          ui.notifications?.error?.(_i18n("SD.Trade.DropError", "Failed to add item to trade."));
        }
      });
    });

    root.querySelectorAll(".sd-tw-remove").forEach(btn => {
      btn.addEventListener("click", () => this._removeItemFromOffer(btn.dataset.side, btn.dataset.id));
    });
    root.querySelectorAll(".sd-tw-qty").forEach(inp => {
      inp.addEventListener("input",  () => this._setQty(inp.dataset.side, inp.dataset.id, Number(inp.value || 1), { silent: true }));
      inp.addEventListener("change", () => this._setQty(inp.dataset.side, inp.dataset.id, Number(inp.value || 1)));
    });
    root.querySelectorAll(".sd-tw-cur").forEach(inp => {
      inp.addEventListener("input",  () => this._setCurrency(inp.dataset.side, inp.dataset.key, Number(inp.value || 0), { silent: true }));
      inp.addEventListener("change", () => this._setCurrency(inp.dataset.side, inp.dataset.key, Number(inp.value || 0)));
    });

    root.querySelector(".sd-tw-ready")?.addEventListener("mousedown", () => this._flushOfferInputs());
    root.querySelector(".sd-tw-ready")?.addEventListener("click", () => this._toggleReady());
    root.querySelector(".sd-tw-cancel")?.addEventListener("click", () => this._cancel());
  }

  _flushOfferInputs() {
    const root = this.element;
    if (!root) return;
    const st = SDTrade._state.get(this.requestId);
    if (!st) return;
    let changed = false;

    root.querySelectorAll(".sd-tw-cur").forEach(inp => {
      const side = inp.dataset.side;
      if (!this._canEdit(side)) return;
      const offer = this._offer(side);
      if (!offer) return;
      const key = inp.dataset.key;
      const v = Math.max(0, Number(inp.value || 0));

      const cur = Number(offer.currency?.[key] ?? 0);
      if (cur !== v) { offer.currency[key] = v; changed = true; }
    });

    root.querySelectorAll(".sd-tw-qty").forEach(inp => {
      const side = inp.dataset.side;
      if (!this._canEdit(side)) return;
      const offer = this._offer(side);
      if (!offer) return;
      const id = inp.dataset.id;
      const it = offer.items.find(i => i.id === id);
      if (!it) return;
      const v = Math.max(1, Number(inp.value || 1));
      const cur = Number(it.qty ?? 1);
      if (cur !== v) { it.qty = v; changed = true; }
    });

    if (changed && !st.sameUser) {
      for (const side of ["init","part"]) {
        if (!this._canEdit(side)) continue;
        game.socket.emit(SOCKET_NS, {
          type: "trade.update",
          requestId: this.requestId,
          from: game.user.id,
          side,
          offer: st.offers[side]
        });
      }
    }
  }

  _mySide() {
    const st = SDTrade._state.get(this.requestId);
    if (!st) return null;
    if (st.sameUser) return "both";
    if (game.user.id === st.initiatorUserId) return "init";
    if (game.user.id === st.partnerUserId)   return "part";
    return null;
  }

  _canEdit(sideKey) {
    const ms = this._mySide();
    if (!ms) return false;
    if (ms === "both") return sideKey === "init" || sideKey === "part";
    return ms === sideKey;
  }

  _offer(sideKey) {
    const st = SDTrade._state.get(this.requestId);
    if (!st) return null;
    return st.offers[sideKey] ?? (st.offers[sideKey] = { items: [], currency: {} });
  }

  _broadcastSide(sideKey, { silent = false } = {}) {
    const st = SDTrade._state.get(this.requestId);
    if (!st) return;
    const offer = st.offers[sideKey];

    st.ready.init = false;
    st.ready.part = false;
    if (!st.sameUser) {
      game.socket.emit(SOCKET_NS, {
        type: "trade.update",
        requestId: this.requestId,
        from: game.user.id,
        side: sideKey,
        offer
      });
    }
    if (silent) return;

    setTimeout(() => this.refresh(), 0);
  }

  _addItemToOffer(sideKey, itemId, qty) {
    if (!this._canEdit(sideKey)) return;
    const offer = this._offer(sideKey);
    if (!offer) return;
    const exist = offer.items.find(i => i.id === itemId);
    if (exist) exist.qty = Math.max(1, Number(exist.qty || 1) + Number(qty || 1));
    else offer.items.push({ id: itemId, qty: Math.max(1, Number(qty || 1)) });
    this._broadcastSide(sideKey);
  }

  _removeItemFromOffer(sideKey, itemId) {
    if (!this._canEdit(sideKey)) return;
    const offer = this._offer(sideKey);
    if (!offer) return;
    offer.items = offer.items.filter(i => i.id !== itemId);
    this._broadcastSide(sideKey);
  }

  _setQty(sideKey, itemId, qty, { silent = false } = {}) {
    if (!this._canEdit(sideKey)) return;
    const offer = this._offer(sideKey);
    if (!offer) return;
    const it = offer.items.find(i => i.id === itemId);
    if (!it) return;
    const v = Math.max(1, Number(qty || 1));

    const cur = Number(it.qty ?? 1);
    if (cur === v) return;
    it.qty = v;
    this._broadcastSide(sideKey, { silent });
  }

  _setCurrency(sideKey, key, amt, { silent = false } = {}) {
    if (!this._canEdit(sideKey)) return;
    const offer = this._offer(sideKey);
    if (!offer) return;
    const v = Math.max(0, Number(amt || 0));

    const cur = Number(offer.currency?.[key] ?? 0);
    if (cur === v) return;
    offer.currency[key] = v;
    this._broadcastSide(sideKey, { silent });
  }

  async _toggleReady() {
    const st = SDTrade._state.get(this.requestId);
    if (!st) return;

    if (st.sameUser) {
      const both = !!(st.ready.init && st.ready.part);
      const next = !both;
      st.ready.init = next;
      st.ready.part = next;
      this.refresh();
      if (next && game.user.isGM) {
        await SDTrade._gmCommit(st);
      }
      return;
    }

    const ms = this._mySide();
    if (ms !== "init" && ms !== "part") return;
    const cur = !!st.ready[ms];
    st.ready[ms] = !cur;
    game.socket.emit(SOCKET_NS, {
      type: "trade.ready",
      requestId: this.requestId,
      from: game.user.id,
      side: ms,
      ready: !cur
    });
    this.refresh();

    if (st.ready.init && st.ready.part && game.user.isGM) {
      await SDTrade._gmCommit(st);
    }
  }

  async _cancel() {
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: _i18n("SD.Trade.CancelTitle","Cancel trade?") },
      content: `<p style="padding:8px 4px">${_esc(_i18n("SD.Trade.CancelConfirm","Cancel this trade?"))}</p>`
    }).catch(() => false);
    if (!ok) return;
    game.socket.emit(SOCKET_NS, {
      type: "trade.cancelled",
      requestId: this.requestId,
      from: game.user.id
    });
    SDTrade._state.delete(this.requestId);
    this.close({ skipNotify: true });
  }

  _onClose(options) {
    SDTradeWindow._open.delete(this.requestId);
    return super._onClose?.(options);
  }
}

export class SDAutoTradeShop extends ApplicationV2 {

  static _open = new Map();

  static DEFAULT_OPTIONS = {
    classes: ["sd","sd-trade-shop"],
    position: { width: 720, height: 580 },
    window: { title: "Shop", resizable: true, minimizable: true }
  };

  constructor({ buyer, trader } = {}, options = {}) {
    super(options);
    this.buyer  = buyer;
    this.trader = trader;
    this._tab   = "buy";
    SDAutoTradeShop._open.set(`${buyer.uuid}|${trader.uuid}`, this);
  }

  get title() {
    return _i18n("SD.Trade.ShopTitle", "Shop") + " — " + this.trader.name;
  }

  async _renderHTML(context, options) { return this._renderBody(); }
  _replaceHTML(html, content, options) { content.innerHTML = html; this._wire(); }
  refresh() {

    const live = game.actors.get(this.buyer.id)  ?? this.buyer;
    const live2 = game.actors.get(this.trader.id) ?? this.trader;
    this.buyer  = live;
    this.trader = live2;
    const root = this.element;
    if (!root) return;
    const content = root.querySelector(".window-content");
    if (!content) return;
    content.innerHTML = this._renderBody();
    this._wire();
  }

  _renderBody() {
    const cur = _getCurrencies();
    const tcfg = _readTraderConfig(this.trader);
    const tab  = this._tab;

    const buyerCurrency = cur.map(c => `<span title="${_esc(c.label ?? c.key)}" style="font-size:11px"><strong>${_esc(c.label ?? c.key)}:</strong> ${Number(this.buyer.system?.currency?.[c.key] ?? 0)}</span>`).join(" · ");
    const traderCats = tcfg.tradeCategories.length ? tcfg.tradeCategories.join(", ") : _i18n("SD.Trade.AnyCategory","any");

    const buyItems = [...this.trader.items].filter(it => it.type === "inventory" && _readSaleConfig(it).saleable);
    const sellItems = [...this.buyer.items].filter(it => {
      if (it.type !== "inventory") return false;
      if (tcfg.tradeCategories.length === 0) return true;
      return tcfg.tradeCategories.includes(String(it.system?.category ?? ""));
    });

    const traderUuid = _esc(this.trader?.uuid ?? "");
    const buyerUuid  = _esc(this.buyer?.uuid  ?? "");

    const _renderBuyRow = (item) => {
      const sale = _readSaleConfig(item);
      const curLbl = (cur.find(c => c.key === sale.currency)?.label ?? sale.currency);

      return `<div class="sd-shop-row" data-sd-preview-ref="item:${_esc(item.id)}" data-sd-actor-uuid="${traderUuid}" data-item-id="${_esc(item.id)}" style="display:flex;align-items:center;gap:8px;padding:6px;background:var(--sd-bg-2);border-radius:6px;margin-bottom:4px">
        <img src="${_esc(item.img)}" style="width:32px;height:32px;border-radius:4px;object-fit:cover">
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_esc(item.name)}</div>
          <div style="font-size:10px;color:var(--sd-text-3)">${_esc(item.system?.category || "—")} · stock ${Number(item.system?.quantity ?? 1)}</div>
        </div>
        <div style="font-size:12px;font-weight:600;color:var(--sd-accent);min-width:80px;text-align:right">${sale.price} ${_esc(curLbl)}</div>
        <input type="number" min="1" max="${Number(item.system?.quantity ?? 1)}" value="1" class="sd-shop-buy-qty" data-id="${_esc(item.id)}" style="width:54px;background:var(--sd-bg);border:1px solid var(--sd-w-bd,var(--sd-border));border-radius:4px;color:var(--sd-text);text-align:center;padding:2px 4px">
        <button type="button" class="sd-shop-buy" data-id="${_esc(item.id)}" style="background:var(--sd-accent);border:none;color:#fff;border-radius:5px;padding:5px 10px;cursor:pointer;font-size:11px;font-weight:600">
          <i class="fas fa-cart-arrow-down"></i> ${_esc(_i18n("SD.Trade.Buy","Buy"))}
        </button>
      </div>`;
    };

    const _renderSellRow = (item) => {
      const sale = _readSaleConfig(item);
      const list = sale.price;
      const offered = Math.floor(list * (tcfg.priceDistortion / 100));
      const curLbl = (cur.find(c => c.key === sale.currency)?.label ?? sale.currency);

      return `<div class="sd-shop-row" data-sd-preview-ref="item:${_esc(item.id)}" data-sd-actor-uuid="${buyerUuid}" data-item-id="${_esc(item.id)}" style="display:flex;align-items:center;gap:8px;padding:6px;background:var(--sd-bg-2);border-radius:6px;margin-bottom:4px">
        <img src="${_esc(item.img)}" style="width:32px;height:32px;border-radius:4px;object-fit:cover">
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_esc(item.name)}</div>
          <div style="font-size:10px;color:var(--sd-text-3)">${_esc(item.system?.category || "—")} · own ${Number(item.system?.quantity ?? 1)}</div>
        </div>
        <div style="font-size:11px;color:var(--sd-text-3);min-width:120px;text-align:right">
          ${_esc(_i18n("SD.Trade.Listed","Listed"))} ${list} → <strong style="color:var(--sd-accent)">${offered} ${_esc(curLbl)}</strong>
        </div>
        <input type="number" min="1" max="${Number(item.system?.quantity ?? 1)}" value="1" class="sd-shop-sell-qty" data-id="${_esc(item.id)}" style="width:54px;background:var(--sd-bg);border:1px solid var(--sd-w-bd,var(--sd-border));border-radius:4px;color:var(--sd-text);text-align:center;padding:2px 4px">
        <button type="button" class="sd-shop-sell" data-id="${_esc(item.id)}" style="background:var(--sd-stamina);border:none;color:#fff;border-radius:5px;padding:5px 10px;cursor:pointer;font-size:11px;font-weight:600">
          <i class="fas fa-cart-arrow-up"></i> ${_esc(_i18n("SD.Trade.Sell","Sell"))}
        </button>
      </div>`;
    };

    const empty = `<div style="padding:16px;text-align:center;color:var(--sd-text-3);font-size:11px;font-style:italic">${_esc(_i18n("SD.Trade.Empty","Nothing here yet."))}</div>`;
    const tabBody = tab === "sell"
      ? (sellItems.length ? sellItems.map(_renderSellRow).join("") : empty)
      : (buyItems.length  ? buyItems .map(_renderBuyRow ).join("") : empty);

    const _tabBtn = (id, label) => `<button type="button" class="sd-shop-tab" data-tab="${id}" style="padding:6px 14px;background:${tab===id?"var(--sd-accent)":"transparent"};color:${tab===id?"#fff":"var(--sd-text-3)"};border:1px solid var(--sd-border);border-radius:5px 5px 0 0;cursor:pointer;font-size:12px;font-weight:600">${_esc(label)}</button>`;

    return `<div class="window-content" style="padding:0">
      <div style="padding:8px 12px;background:var(--sd-bg-2);border-bottom:1px solid var(--sd-border);display:flex;align-items:center;gap:10px">
        <img src="${_esc(this.trader.img)}" style="width:38px;height:38px;border-radius:5px;object-fit:cover">
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:700">${_esc(this.trader.name)}</div>
          <div style="font-size:10px;color:var(--sd-text-3)">${_esc(_i18n("SD.Trade.Buys","Buys"))}: ${_esc(traderCats)} · ${_esc(_i18n("SD.Trade.At","at"))} ${tcfg.priceDistortion}%</div>
        </div>
        <div style="font-size:11px;color:var(--sd-text-3);text-align:right">
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:.04em">${_esc(_i18n("SD.Trade.YourPurse","Your purse"))}</div>
          <div>${buyerCurrency}</div>
        </div>
      </div>
      <div style="padding:8px 12px 0;display:flex;gap:4px;border-bottom:1px solid var(--sd-border)">
        ${_tabBtn("buy", _i18n("SD.Trade.BuyTab","Buy"))}
        ${_tabBtn("sell", _i18n("SD.Trade.SellTab","Sell"))}
      </div>
      <div style="padding:10px 12px;flex:1;overflow:auto">
        ${tabBody}
      </div>
    </div>`;
  }

  _wire() {
    const root = this.element;
    if (!root) return;

    ItemPreviewPopup.attach(root, this.buyer ?? this.trader ?? null);
    root.querySelectorAll(".sd-shop-tab").forEach(btn => {
      btn.addEventListener("click", () => { this._tab = btn.dataset.tab; this.refresh(); });
    });
    root.querySelectorAll(".sd-shop-buy").forEach(btn => {
      btn.addEventListener("click", () => {
        const id  = btn.dataset.id;
        const qty = Number(root.querySelector(`.sd-shop-buy-qty[data-id="${id}"]`)?.value || 1);
        this._buy(id, qty);
      });
    });
    root.querySelectorAll(".sd-shop-sell").forEach(btn => {
      btn.addEventListener("click", () => {
        const id  = btn.dataset.id;
        const qty = Number(root.querySelector(`.sd-shop-sell-qty[data-id="${id}"]`)?.value || 1);
        this._sell(id, qty);
      });
    });
  }

  _buy(itemId, qty) {
    if (!_isGMActive()) {
      ui.notifications?.warn?.(_i18n("SD.Trade.GMOffline", "Trading requires an active GM."));
      return;
    }
    if (game.user.isGM) {
      SDTrade._gmAutoBuy({
        from:             game.user.id,
        buyerActorUuid:   this.buyer.uuid,
        traderActorUuid:  this.trader.uuid,
        itemId, qty
      });
      return;
    }
    game.socket.emit(SOCKET_NS, {
      type:             "trade.autoBuy",
      from:             game.user.id,
      buyerActorUuid:   this.buyer.uuid,
      traderActorUuid:  this.trader.uuid,
      itemId, qty
    });
  }

  _sell(itemId, qty) {
    if (!_isGMActive()) {
      ui.notifications?.warn?.(_i18n("SD.Trade.GMOffline", "Trading requires an active GM."));
      return;
    }
    if (game.user.isGM) {
      SDTrade._gmAutoSell({
        from:             game.user.id,
        sellerActorUuid:  this.buyer.uuid,
        traderActorUuid:  this.trader.uuid,
        itemId, qty
      });
      return;
    }
    game.socket.emit(SOCKET_NS, {
      type:             "trade.autoSell",
      from:             game.user.id,
      sellerActorUuid:  this.buyer.uuid,
      traderActorUuid:  this.trader.uuid,
      itemId, qty
    });
  }

  _onClose(options) {
    SDAutoTradeShop._open.delete(`${this.buyer.uuid}|${this.trader.uuid}`);
    return super._onClose?.(options);
  }
}

Hooks.once("ready", () => {

  Hooks.on("updateActor", (actor) => {
    for (const win of SDAutoTradeShop._open.values()) {
      if (win.buyer?.id === actor.id || win.trader?.id === actor.id) win.refresh();
    }
  });
  Hooks.on("updateItem", (item) => {
    const owner = item.parent;
    for (const win of SDAutoTradeShop._open.values()) {
      if (owner?.id === win.buyer?.id || owner?.id === win.trader?.id) win.refresh();
    }
  });
  Hooks.on("createItem", (item) => {
    const owner = item.parent;
    for (const win of SDAutoTradeShop._open.values()) {
      if (owner?.id === win.buyer?.id || owner?.id === win.trader?.id) win.refresh();
    }
  });
  Hooks.on("deleteItem", (item) => {
    const owner = item.parent;
    for (const win of SDAutoTradeShop._open.values()) {
      if (owner?.id === win.buyer?.id || owner?.id === win.trader?.id) win.refresh();
    }
  });
});
