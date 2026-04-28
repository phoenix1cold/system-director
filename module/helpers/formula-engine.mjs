export class FormulaEngine {

  // Публичный API

  /**
   * Resolve all {refs} and evaluate math.
   * @param {string}      formula
   * @param {Actor|Item}  doc
   * @returns {number|string}  computed result
   */
  static evaluate(formula, doc) {
    if (!formula) return "";
    try {
      const resolved = this._resolveRefs(String(formula), doc);
      return this._evalMath(resolved);
    } catch(e) {
      return `!err: ${e.message}`;
    }
  }

  /**
   * Resolve {refs} to numbers -- return a dice-notation string for Roll.
   * Dice tokens (1d20, 2d6, etc.) are kept untouched.
   * Also handles @shorthand from getRollData.
   *
   * IMPORTANT: paths must be wrapped in {curly braces}.
   * e.g. "1d20 + {system.attributes.attr1.mod}" resolves to "1d20 + 3"
   *
   * @param {string}      formula
   * @param {Actor|Item}  doc
   * @returns {string}  resolved dice formula string
   */
  static resolveForRoll(formula, doc) {
    if (!formula) return "1d20";
    try {
      let result = String(formula)
        .replace(/А/g,"A").replace(/а/g,"a")
        .replace(/В/g,"B")
        .replace(/С/g,"C").replace(/с/g,"c")
        .replace(/Е/g,"E").replace(/е/g,"e")
        .replace(/О/g,"O").replace(/о/g,"o")
        .replace(/Р/g,"P").replace(/р/g,"p")
        .replace(/Х/g,"X").replace(/х/g,"x")
        .replace(/К/g,"K").replace(/М/g,"M").replace(/Т/g,"T");
      result = this._resolveRefs(result, doc, true);

      result = result.replace(/\b([a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*){1,})\b/gi, (match) => {
        if (/^\d+d\d+/i.test(match)) return match;
        if (/^(Math|floor|ceil|round|abs|max|min)$/.test(match)) return match;
        const val = foundry.utils.getProperty(doc, match);
        if (val !== undefined && val !== null && typeof val !== "object") {
          console.debug(`SD | Formula: bare path "${match}" resolved to ${val}. Wrap in {curly braces} for clarity.`);
          return String(val);
        }
        // Try getRollData
        const rd = (doc instanceof Actor ? doc : doc.actor)?.getRollData?.() ?? {};
        const rdVal = foundry.utils.getProperty(rd, match);
        if (rdVal !== undefined && rdVal !== null && typeof rdVal !== "object") {
          return String(rdVal);
        }
        return match;
      });

      result = result.replace(/\{[^}]*\}/g, "0");
      result = result.replace(/[{}]/g, "");

      return result;
    } catch(e) {
      console.warn("SD | resolveForRoll error:", e);
      return formula;
    }
  }

  static isFormula(str) {
    return /[{}+\-*\/]|floor|ceil|round|max|min|abs|item:|slot/.test(str ?? "");
  }

  // Внутреннее

  /** Find a widget anywhere in doc.system.customTabs by its widgetKey. */
  static _findWidgetByKey(doc, key) {
    const tabs = doc?.system?.customTabs ?? [];
    for (const tab of tabs) {
      for (const row of (tab.rows ?? [])) {
        for (const w of (row.widgets ?? [])) {
          if (w.widgetKey === key) return w;
        }
      }
    }
    return null;
  }

  static _resolveRefs(formula, doc, rollMode = false) {
    let prev = null;
    let cur  = String(formula);
    let pass = 0;
    while (cur !== prev && pass++ < 8 && /\{[^{}]+\}/.test(cur)) {
      prev = cur;
      cur = cur.replace(/\{([^{}]+)\}/g, (match, inner) => {
        const val = this._resolveToken(inner.trim(), doc);
        if (val === undefined || val === null) return "0";
        return String(val);
      });
    }
    return cur;
  }

  static _sdResolveCardForToken(payload) {
    if (!payload) return null;
    const stack = this._sdResolveStackForToken(payload);
    if (!stack) return null;
    const all = Array.from(stack.cards ?? []);
    if (!all.length) return null;
    const avail = stack.availableCards?.length ? stack.availableCards : all;
    const sel = String(payload.selector ?? "top").toLowerCase();
    if (sel === "specific" && payload.cardId) {
      return stack.cards.get(String(payload.cardId)) ?? null;
    }
    if (sel === "by_name" && payload.cardName) {
      const want = String(payload.cardName);
      return all.find(c => c.name === want) ?? avail.find(c => c.name === want) ?? null;
    }
    if (sel === "random") return avail[Math.floor(Math.random() * avail.length)] ?? null;
    if (sel === "bottom") return avail[avail.length - 1] ?? null;
    if (sel === "first")  return avail[0] ?? null;
    return avail[0] ?? null;
  }

  static _sdResolveStackForToken(payload) {
    if (!payload) return null;
    if (payload.stackUuid) {
      try {
        const id = String(payload.stackUuid);
        const direct = game.cards?.get?.(id.replace(/^Cards\./, ""));
        if (direct) return direct;
        const tail = id.split(".").pop();
        if (tail) {
          const byTail = game.cards?.get?.(tail);
          if (byTail) return byTail;
        }
      } catch {}
    }
    if (payload.stackName) {
      const byName = game.cards?.getName?.(String(payload.stackName));
      if (byName) return byName;
    }
    return null;
  }

  static _sdReadCardProp(card, prop) {
    if (!card) return "";
    switch (String(prop)) {
      case "cardId":
      case "_id":
      case "id":      return card.id ?? card._id ?? "";
      case "name":    return card.name ?? "";
      case "face":    return card.face === null || card.face === undefined ? -1 : card.face;
      case "faceImg": {
        if (typeof card.face === "number" && card.faces?.[card.face]?.img) return card.faces[card.face].img;
        return card.faces?.[0]?.img ?? card.back?.img ?? "";
      }
      case "backImg": return card.back?.img ?? "";
      case "drawn":   return card.drawn ? 1 : 0;
      case "value": {
        if (typeof card.value === "number") return card.value;
        if (typeof card.face === "number" && card.faces?.[card.face]?.value !== undefined) return Number(card.faces[card.face].value) || 0;
        return Number(card.value) || 0;
      }
      case "suit":    return card.suit ?? card.system?.suit ?? "";
      case "type":    return card.type ?? "";
      default:
        try {
          const v = foundry.utils.getProperty(card, prop);
          if (v === undefined || v === null || typeof v === "object") return "";
          return v;
        } catch { return ""; }
    }
  }

  static _sdReadStackProp(stack, prop) {
    if (!stack) return "";
    const all = Array.from(stack.cards ?? []);
    const avail = stack.availableCards?.length ? stack.availableCards : all.filter(c => !c.drawn);
    switch (String(prop)) {
      case "count":          return all.length;
      case "availableCount": return avail.length;
      case "drawnCount":     return all.filter(c => c.drawn).length;
      case "isEmpty":        return avail.length ? 0 : 1;
      case "topCardId":      return avail[0]?.id ?? avail[0]?._id ?? "";
      case "bottomCardId":   return avail[avail.length - 1]?.id ?? avail[avail.length - 1]?._id ?? "";
      case "name":           return stack.name ?? "";
      case "uuid":           return stack.uuid ?? "";
      default: {
        try {
          const v = foundry.utils.getProperty(stack, prop);
          if (v === undefined || v === null || typeof v === "object") return "";
          return v;
        } catch { return ""; }
      }
    }
  }

  /** SD | Cards: decode a base64 token payload into a JS object. */
  static _sdDecodeCardPayload(b64) {
    if (!b64) return null;
    try {
      const json = (typeof atob === "function") ? atob(b64) : Buffer.from(b64, "base64").toString("utf8");
      return JSON.parse(json);
    } catch (e) {
      console.warn("SD | Cards: failed to decode token payload", e);
      return null;
    }
  }

  static _resolveToken(token, doc) {
    if (token.startsWith("widget:")) {
      const key    = token.slice("widget:".length);
      const w      = this._findWidgetByKey(doc, key);
      if (!w) return 0;
      if (w.valueFormula && this.isFormula(w.valueFormula)) {
        return this.evaluate(w.valueFormula, doc);
      }
      if (w.path) return foundry.utils.getProperty(doc, w.path) ?? 0;
      if (w.pathValue) return foundry.utils.getProperty(doc, w.pathValue) ?? 0;
      return 0;
    }

    if (token.startsWith("widgetPath:")) {
      const key = token.slice("widgetPath:".length);
      const w   = this._findWidgetByKey(doc, key);
      return w?.path ?? w?.pathValue ?? "";
    }

    // item:Name.path
    if (token.startsWith("item:id:")) {
      const rest    = token.slice("item:id:".length);
      const dotIdx  = rest.indexOf(".");
      if (dotIdx < 0) return 0;
      const itemId  = rest.slice(0, dotIdx);
      const path    = rest.slice(dotIdx + 1);
      const actor   = doc instanceof Actor ? doc : doc.actor;
      const item    = actor?.items?.get(itemId);
      return item ? (foundry.utils.getProperty(item, path) ?? 0) : 0;
    }

    if (token.startsWith("item:")) {
      const rest    = token.slice("item:".length);
      const dotIdx  = rest.indexOf(".");
      if (dotIdx < 0) return 0;
      const name    = rest.slice(0, dotIdx).toLowerCase();
      const path    = rest.slice(dotIdx + 1);
      const actor   = doc instanceof Actor ? doc : doc.actor;
      const item    = actor?.items?.find(i => i.name.toLowerCase() === name);
      return item ? (foundry.utils.getProperty(item, path) ?? 0) : 0;
    }

    if (token.startsWith("slotCount:")) {
      const slotId = token.slice("slotCount:".length);
      const _cnt = (t) => t?.system?.slotContents?.[slotId]?.contents?.length
                       ?? t?.system?.slotContents?.[slotId]?.count
                       ?? null;
      // Check doc itself first
      const directVal = _cnt(doc);
      if (directVal !== null) return directVal;
      // Check actor
      const actor = doc instanceof Actor ? doc : (doc.actor ?? null);
      if (actor) {
        const actorVal = _cnt(actor);
        if (actorVal !== null) return actorVal;
        for (const item of (actor.items ?? [])) {
          const itemVal = _cnt(item);
          if (itemVal !== null) return itemVal;
        }
      }
      return 0;
    }

    if (token.startsWith("spellSlots:")) {
      const level  = token.slice("spellSlots:".length);
      const actor  = doc instanceof Actor ? doc : doc.actor ?? null;
      if (!actor) return 0;
      return actor.system?.spellSlots?.[level]?.value ?? 0;
    }

    if (token.startsWith("invItemSlotCount:")) {
      const rest   = token.slice("invItemSlotCount:".length);
      const dotIdx = rest.lastIndexOf(".");
      if (dotIdx < 0) return 0;
      const ref    = rest.slice(0, dotIdx);
      const slotId = rest.slice(dotIdx + 1);
      const actor  = doc instanceof Actor ? doc : doc.actor ?? null;
      if (!actor) return 0;
      const parentItem = actor.items.get(ref) ?? actor.items.find(i => i.name === ref) ?? null;
      if (!parentItem) return 0;
      return parentItem.system?.slotContents?.[slotId]?.contents?.length
          ?? parentItem.system?.slotContents?.[slotId]?.count
          ?? 0;
    }

    // nestedSlotCount
    if (token.startsWith("nestedSlotCount:")) {
      const parts = token.slice("nestedSlotCount:".length).split("/");
      if (parts.length < 3) return 0;
      const actor = doc instanceof Actor ? doc : doc.actor ?? null;
      let current;
      const root = parts[0];
      if (root === "actor") {
        current = actor;
      } else if (root === "self") {
        current = (doc instanceof Actor) ? null : doc;
      } else {
        current = actor?.items.get(root) ?? null;
        if (!current && doc && !(doc instanceof Actor) && doc.id === root) current = doc;
      }
      if (!current) return 0;
      // Walk pairs
      let i = 1;
      while (i + 1 < parts.length) {
        const slotId   = parts[i];
        const nestedId = parts[i + 1];
        const contents = current.system?.slotContents?.[slotId]?.contents ?? [];
        current = contents.find(c => (c._id ?? c.id) === nestedId) ?? null;
        if (!current) return 0;
        i += 2;
      }
      const finalSlotId = parts[parts.length - 1];
      return current.system?.slotContents?.[finalSlotId]?.contents?.length
          ?? current.system?.slotContents?.[finalSlotId]?.count
          ?? 0;
    }

    // slot:slotId.index.path
    if (token.startsWith("slot:")) {
      const rest    = token.slice("slot:".length);
      const parts   = rest.split(".");
      if (parts.length < 3) return 0;
      const slotId  = parts[0];
      const idx     = parseInt(parts[1]);
      const path    = parts.slice(2).join(".");
      const target  = doc instanceof Actor ? null : doc;
      if (!target) return 0;
      const contents = target.system?.slotContents?.[slotId]?.contents ?? [];
      const slotItem = contents[idx];
      return slotItem ? (foundry.utils.getProperty(slotItem, path) ?? 0) : 0;
    }

    if (token.startsWith("slotUuid:")) {
      const rest   = token.slice("slotUuid:".length);
      const dot    = rest.lastIndexOf(".");
      if (dot < 0) return "";
      const slotId = rest.slice(0, dot);
      const idx    = parseInt(rest.slice(dot + 1));
      const actor  = doc instanceof Actor ? doc : doc.actor;
      const targets = [doc instanceof Actor ? null : doc, actor].filter(Boolean);
      for (const t of targets) {
        const contents = t?.system?.slotContents?.[slotId]?.contents ?? [];
        const entry    = contents[idx];
        if (entry) return entry.uuid ?? entry._id ?? "";
      }
      return "";
    }

    if (token.startsWith("invcat:")) {
      const rest   = token.slice("invcat:".length);
      const parts  = rest.split(".");
      if (parts.length < 3) return 0;
      const category = parts[0];
      const idx      = parseInt(parts[1]);
      const path     = parts.slice(2).join(".");
      const actor    = doc instanceof Actor ? doc : doc.actor;
      if (!actor) return 0;
      const catItems = [...(actor.items ?? [])].filter(i => i.system?.category === category);
      const item     = catItems[idx];
      return item ? (foundry.utils.getProperty(item, path) ?? 0) : 0;
    }

    if (token.startsWith("target.")) {
      const path   = token.slice("target.".length);
      const tActor = (typeof game !== "undefined")
        ? (game.user?.targets?.first()?.actor ?? canvas?.tokens?.controlled?.[0]?.actor ?? null)
        : null;
      if (!tActor) return 0;
      const v = foundry.utils.getProperty(tActor, path);
      if (v === undefined || v === null || typeof v === "object") return 0;
      return v;
    }

    if (token.startsWith("tokenField:")) {
      const rest = token.slice("tokenField:".length);
      const dot  = rest.indexOf(".");
      if (dot < 0) return 0;
      const tokenId = rest.slice(0, dot).trim();
      const path    = rest.slice(dot + 1);
      if (!tokenId) return 0;
      const tk = (typeof canvas !== "undefined") ? canvas?.tokens?.get?.(tokenId) : null;
      const a  = tk?.actor;
      if (!a) return 0;
      const v = foundry.utils.getProperty(a, path);
      if (v === undefined || v === null || typeof v === "object") return 0;
      return v;
    }

    if (token.startsWith("arrayLength:")) {
      const rest = token.slice("arrayLength:".length);
      if (!rest) return 0;
      return rest.split(",").map(s => s.trim()).filter(Boolean).length;
    }

    if (token.startsWith("arrayAt:")) {
      const rest = token.slice("arrayAt:".length);
      const sep  = rest.indexOf("|");
      if (sep < 0) return "";
      const list = rest.slice(0, sep).split(",").map(s => s.trim()).filter(Boolean);
      const idx  = Math.floor(Number(rest.slice(sep + 1)) || 0);
      return list[idx] ?? "";
    }

    if (token.startsWith("arrayMapField:")) {
      const rest = token.slice("arrayMapField:".length);
      const sep  = rest.indexOf("|");
      if (sep < 0) return "";
      const list = rest.slice(0, sep).split(",").map(s => s.trim()).filter(Boolean);
      const path = rest.slice(sep + 1);
      if (!path) return "";
      const out = [];
      for (const tid of list) {
        const tk = (typeof canvas !== "undefined") ? canvas?.tokens?.get?.(tid) : null;
        const a  = tk?.actor;
        if (!a) { out.push(""); continue; }
        const v = foundry.utils.getProperty(a, path);
        out.push(v === undefined || v === null || typeof v === "object" ? "" : String(v));
      }
      return out.join(",");
    }

    if (token.startsWith("arrayAgg:")) {
      const parts = token.slice("arrayAgg:".length).split("|");
      if (parts.length < 3) return 0;
      const list = parts[0].split(",").map(s => s.trim()).filter(Boolean);
      const path = parts[1];
      const op   = parts[2];
      const nums = [];
      for (const tid of list) {
        const tk = (typeof canvas !== "undefined") ? canvas?.tokens?.get?.(tid) : null;
        const a  = tk?.actor;
        if (!a) continue;
        const v = Number(foundry.utils.getProperty(a, path));
        if (!isNaN(v)) nums.push(v);
      }
      if (op === "count") return nums.length;
      if (!nums.length)   return 0;
      if (op === "sum")   return nums.reduce((s,n)=>s+n,0);
      if (op === "avg")   return nums.reduce((s,n)=>s+n,0) / nums.length;
      if (op === "min")   return Math.min(...nums);
      if (op === "max")   return Math.max(...nums);
      return 0;
    }

    if (token.startsWith("arrayFindExtreme:")) {
      const parts = token.slice("arrayFindExtreme:".length).split("|");
      if (parts.length < 3) return "";
      const list = parts[0].split(",").map(s => s.trim()).filter(Boolean);
      const path = parts[1];
      const op   = parts[2];
      let bestId  = "";
      let bestVal = null;
      for (const tid of list) {
        const tk = (typeof canvas !== "undefined") ? canvas?.tokens?.get?.(tid) : null;
        const a  = tk?.actor;
        if (!a) continue;
        const v = Number(foundry.utils.getProperty(a, path));
        if (isNaN(v)) continue;
        if (bestVal === null || (op === "min" ? v < bestVal : v > bestVal)) {
          bestVal = v;
          bestId  = tid;
        }
      }
      return bestId;
    }

    if (token.startsWith("arraySort:")) {
      const parts = token.slice("arraySort:".length).split("|");
      if (parts.length < 3) return "";
      const list = parts[0].split(",").map(s => s.trim()).filter(Boolean);
      const path = parts[1];
      const op   = parts[2];
      const annotated = list.map(tid => {
        const tk = (typeof canvas !== "undefined") ? canvas?.tokens?.get?.(tid) : null;
        const a  = tk?.actor;
        const v  = a ? Number(foundry.utils.getProperty(a, path)) : NaN;
        return { tid, v: isNaN(v) ? null : v };
      });
      annotated.sort((x, y) => {
        if (x.v === null && y.v === null) return 0;
        if (x.v === null) return  1;
        if (y.v === null) return -1;
        return op === "asc" ? (x.v - y.v) : (y.v - x.v);
      });
      return annotated.map(e => e.tid).join(",");
    }

    if (token.startsWith("arraySlice:")) {
      const parts = token.slice("arraySlice:".length).split("|");
      if (parts.length < 3) return "";
      const list  = parts[0].split(",").map(s => s.trim()).filter(Boolean);
      const start = Math.max(0, Math.floor(Number(parts[1]) || 0));
      const cnt   = Math.floor(Number(parts[2]));
      const end   = (cnt < 0) ? list.length : Math.min(list.length, start + cnt);
      return list.slice(start, end).join(",");
    }

    if (token.startsWith("arrayConcat:")) {
      const parts = token.slice("arrayConcat:".length).split("|");
      if (parts.length < 2) return "";
      const a = parts[0].split(",").map(s => s.trim()).filter(Boolean);
      const b = parts[1].split(",").map(s => s.trim()).filter(Boolean);
      return [...a, ...b].join(",");
    }

    if (token.startsWith("arrayUnion:")) {
      const parts = token.slice("arrayUnion:".length).split("|");
      if (parts.length < 2) return "";
      const a = parts[0].split(",").map(s => s.trim()).filter(Boolean);
      const b = parts[1].split(",").map(s => s.trim()).filter(Boolean);
      const seen = new Set();
      const out  = [];
      for (const id of [...a, ...b]) {
        if (seen.has(id)) continue;
        seen.add(id);
        out.push(id);
      }
      return out.join(",");
    }

    if (token.startsWith("arrayIntersect:")) {
      const parts = token.slice("arrayIntersect:".length).split("|");
      if (parts.length < 2) return "";
      const a = parts[0].split(",").map(s => s.trim()).filter(Boolean);
      const b = new Set(parts[1].split(",").map(s => s.trim()).filter(Boolean));
      const seen = new Set();
      const out  = [];
      for (const id of a) {
        if (!b.has(id) || seen.has(id)) continue;
        seen.add(id);
        out.push(id);
      }
      return out.join(",");
    }

    if (token.startsWith("arrayDifference:")) {
      const parts = token.slice("arrayDifference:".length).split("|");
      if (parts.length < 2) return "";
      const a = parts[0].split(",").map(s => s.trim()).filter(Boolean);
      const b = new Set(parts[1].split(",").map(s => s.trim()).filter(Boolean));
      const seen = new Set();
      const out  = [];
      for (const id of a) {
        if (b.has(id) || seen.has(id)) continue;
        seen.add(id);
        out.push(id);
      }
      return out.join(",");
    }

    if (token.startsWith("arrayContains:")) {
      const parts = token.slice("arrayContains:".length).split("|");
      if (parts.length < 2) return 0;
      const list = new Set(parts[0].split(",").map(s => s.trim()).filter(Boolean));
      const id   = String(parts.slice(1).join("|")).trim();
      return list.has(id) ? 1 : 0;
    }

    if (token.startsWith("arrayDistinct:")) {
      const rest = token.slice("arrayDistinct:".length);
      const list = rest.split(",").map(s => s.trim()).filter(Boolean);
      const seen = new Set();
      const out  = [];
      for (const id of list) {
        if (seen.has(id)) continue;
        seen.add(id);
        out.push(id);
      }
      return out.join(",");
    }

    if (token.startsWith("arrayFilter:")) {
      const parts = token.slice("arrayFilter:".length).split("|");
      if (parts.length < 4) return "";
      const list   = parts[0].split(",").map(s => s.trim()).filter(Boolean);
      const path   = parts[1];
      const op     = parts[2];
      const cmpRaw = parts.slice(3).join("|");
      const cmpNum = Number(cmpRaw);
      const isNum  = cmpRaw.trim() !== "" && !isNaN(cmpNum);
      const out = [];
      for (const tid of list) {
        const tk = (typeof canvas !== "undefined") ? canvas?.tokens?.get?.(tid) : null;
        const a  = tk?.actor;
        if (!a) continue;
        const fv = foundry.utils.getProperty(a, path);
        if (fv === undefined || fv === null || typeof fv === "object") continue;
        const lv = isNum ? Number(fv)  : String(fv);
        const rv = isNum ? cmpNum      : String(cmpRaw);
        let ok = false;
        switch (op) {
          case "==": ok = (lv === rv); break;
          case "!=": ok = (lv !== rv); break;
          case ">":  ok = (lv >   rv); break;
          case "<":  ok = (lv <   rv); break;
          case ">=": ok = (lv >=  rv); break;
          case "<=": ok = (lv <=  rv); break;
          default:   ok = false;
        }
        if (ok) out.push(tid);
      }
      return out.join(",");
    }

    if (token.startsWith("var:")) {
      const varName = token.slice("var:".length).trim();
      const a = doc instanceof Actor ? doc : (doc.actor ?? null);
      return a?.getFlag?.("sd", `vars.${varName}`) ?? 0;
    }

    if (token.startsWith("hasCondition:")) {
      const rest = token.slice("hasCondition:".length);
      const dotIdx = rest.indexOf(".");
      const targetKey  = dotIdx >= 0 ? rest.slice(0, dotIdx) : "actor";
      const effectName = (dotIdx >= 0 ? rest.slice(dotIdx + 1) : rest).trim().toLowerCase();
      let checkDoc = doc instanceof Actor ? doc : (doc.actor ?? doc);
      if (targetKey === "token_target") {
        const targets = game.user?.targets ?? new Set();
        checkDoc = targets.first()?.actor ?? checkDoc;
      }
      const effects = checkDoc?.appliedEffects ?? checkDoc?.effects ?? [];
      const found = [...effects].some(e =>
        !e.disabled && e.name?.toLowerCase() === effectName
      );
      return found ? 1 : 0;
    }

    if (token.startsWith("cardGet:")) {
      const rest = token.slice("cardGet:".length);
      const colon = rest.lastIndexOf(":");
      if (colon < 0) return "";
      const b64  = rest.slice(0, colon);
      const prop = rest.slice(colon + 1);
      const payload = this._sdDecodeCardPayload(b64);
      const card = this._sdResolveCardForToken(payload);
      return this._sdReadCardProp(card, prop);
    }

    if (token.startsWith("stackInfo:")) {
      const rest = token.slice("stackInfo:".length);
      const colon = rest.lastIndexOf(":");
      if (colon < 0) return "";
      const b64  = rest.slice(0, colon);
      const prop = rest.slice(colon + 1);
      const payload = this._sdDecodeCardPayload(b64);
      const stack = this._sdResolveStackForToken(payload);
      return this._sdReadStackProp(stack, prop);
    }

    if (token.startsWith("__")) {
      return 0;
    }

    // @shorthand
    if (token.startsWith("@")) {
      const key    = token.slice(1);
      const rd     = (doc instanceof Actor ? doc : doc.actor)?.getRollData?.() ?? {};
      return foundry.utils.getProperty(rd, key) ?? 0;
    }

    if (token === "random") return Math.random();

    const val = foundry.utils.getProperty(doc, token);
    if (val !== undefined && val !== null && typeof val !== "object") return val;
    const _actor2 = (doc instanceof Actor) ? null : (doc?.actor ?? null);
    if (_actor2) {
      const val2 = foundry.utils.getProperty(_actor2, token);
      if (val2 !== undefined && val2 !== null && typeof val2 !== "object") return val2;
    }
    if (val !== undefined && val !== null) return 0;
    return 0;
  }

  static _evalMath(expr) {
    let e = expr
      .replace(/floor\s*\(/g, "Math.floor(")
      .replace(/ceil\s*\(/g,  "Math.ceil(")
      .replace(/round\s*\(/g, "Math.round(")
      .replace(/abs\s*\(/g,   "Math.abs(")
      .replace(/max\s*\(/g,   "Math.max(")
      .replace(/min\s*\(/g,   "Math.min(");

    const isNumericMath = !/[^0-9+\-*/()., %MathflorceiabsundxN\s?:<>!=&|]/.test(e);
    const hasStrings = e.includes('"') || e.includes("'");

    if (!isNumericMath && !hasStrings) {
      return e;
    }

    try {
      // eslint-disable-next-line no-new-func
      const result = Function(`"use strict"; return (${e})`)();
      if (typeof result === "number" && isFinite(result)) return result;
      if (typeof result === "boolean") return result;
      if (typeof result === "string") return result;
      return e;
    } catch {
      return e;
    }
  }
}


export const BLUEPRINT_NODES = [
  // Источники
  { cat: "Sources", id: "get_path",    label: "Get Path",       icon: "fa-database",       color: "#5a8ae0",
    syntax: "{system.path.here}",      hint: "Read any field from the sheet",
    desc: "Reads a value from the actor or item at the given path." },

  { cat: "Sources", id: "get_widget",  label: "Widget Value",   icon: "fa-link",            color: "#5a8ae0",
    syntax: "{widget:myWidgetKey}",    hint: "Reference another widget by its Widget Key",
    desc: "Reads the computed value of another widget on this sheet. Set the Widget Key on the other widget first." },

  { cat: "Sources", id: "get_item",    label: "Item Field",     icon: "fa-box",             color: "#5a8ae0",
    syntax: "{item:ItemName.system.hiddenFields.field}",  hint: "Read hidden field from an owned item",
    desc: "Reads a field from an actor-owned item by name." },

  { cat: "Sources", id: "get_item_id", label: "Item by ID",     icon: "fa-fingerprint",     color: "#5a8ae0",
    syntax: "{item:id:ITEM_ID.system.field}",  hint: "Read field from item by ID",
    desc: "More stable reference using item ID instead of name." },

  { cat: "Sources", id: "slot_count",  label: "Slot Count",     icon: "fa-layer-group",     color: "#5a8ae0",
    syntax: "{slotCount:slotId}",      hint: "Number of items in a slot (self/actor) — nested slots auto-resolved by Slot Count node",
    desc: "Returns how many items are currently in a slot." },

  { cat: "Sources", id: "slot_field",  label: "Slot Item Field",icon: "fa-list",            color: "#5a8ae0",
    syntax: "{slot:slotId.0.system.hiddenFields.field}",  hint: "Field from slot contents[0]",
    desc: "Reads a field from the first item inside a slot." },

  { cat: "Sources", id: "actor_data",  label: "Actor @Ref",     icon: "fa-user",            color: "#5a8ae0",
    syntax: "{@attr1}",                hint: "Actor roll data shorthand (@attr1, @level…)",
    desc: "Uses Foundry roll data shorthands: @attr1=attr1.mod, @level, @prof." },

  // Кубы
  { cat: "Dice", id: "d4",   label: "d4",   icon: "fa-dice-d6",  color: "#e0a85a", syntax: "1d4",   hint: "Roll a d4" },
  { cat: "Dice", id: "d6",   label: "d6",   icon: "fa-dice-d6",  color: "#e0a85a", syntax: "1d6",   hint: "Roll a d6" },
  { cat: "Dice", id: "d8",   label: "d8",   icon: "fa-dice",     color: "#e0a85a", syntax: "1d8",   hint: "Roll a d8" },
  { cat: "Dice", id: "d10",  label: "d10",  icon: "fa-dice",     color: "#e0a85a", syntax: "1d10",  hint: "Roll a d10" },
  { cat: "Dice", id: "d12",  label: "d12",  icon: "fa-dice",     color: "#e0a85a", syntax: "1d12",  hint: "Roll a d12" },
  { cat: "Dice", id: "d20",  label: "d20",  icon: "fa-dice-d20", color: "#e0a85a", syntax: "1d20",  hint: "Roll a d20" },
  { cat: "Dice", id: "d100", label: "d100", icon: "fa-dice",     color: "#e0a85a", syntax: "1d100", hint: "Roll percentile" },

  // Математика
  { cat: "Math", id: "add",   label: "Add",      icon: "fa-plus",        color: "#5ae07a", syntax: " + ",             hint: "Addition" },
  { cat: "Math", id: "sub",   label: "Subtract", icon: "fa-minus",       color: "#5ae07a", syntax: " - ",             hint: "Subtraction" },
  { cat: "Math", id: "mul",   label: "Multiply", icon: "fa-xmark",       color: "#5ae07a", syntax: " * ",             hint: "Multiplication" },
  { cat: "Math", id: "div",   label: "Divide",   icon: "fa-divide",      color: "#5ae07a", syntax: " / ",             hint: "Division" },
  { cat: "Math", id: "floor", label: "Floor",    icon: "fa-arrow-down",  color: "#5ae07a", syntax: "floor({|cursor|})", hint: "Round down" },
  { cat: "Math", id: "ceil",  label: "Ceil",     icon: "fa-arrow-up",    color: "#5ae07a", syntax: "ceil({|cursor|})(",  hint: "Round up" },
  { cat: "Math", id: "round", label: "Round",    icon: "fa-arrows-up-down", color: "#5ae07a", syntax: "round({|cursor|})", hint: "Round to nearest" },
  { cat: "Math", id: "max",   label: "Max",      icon: "fa-angle-up",    color: "#5ae07a", syntax: "max({|cursor|}, 0)", hint: "Maximum of two values" },
  { cat: "Math", id: "min",   label: "Min",      icon: "fa-angle-down",  color: "#5ae07a", syntax: "min({|cursor|}, 0)", hint: "Minimum of two values" },
  { cat: "Math", id: "abs",   label: "Abs",      icon: "fa-circle",      color: "#5ae07a", syntax: "abs({|cursor|})",    hint: "Absolute value" },

  // Сравнения
  { cat: "Compare", id: "eq",  label: "Equals",     icon: "fa-equals",    color: "#ee68ee", syntax: " == ", hint: "Equal to" },
  { cat: "Compare", id: "neq", label: "Not Equal",  icon: "fa-not-equal", color: "#ee68ee", syntax: " != ", hint: "Not equal to" },
  { cat: "Compare", id: "gt",  label: "Greater >",  icon: "fa-chevron-right", color: "#ee68ee", syntax: " > ", hint: "Greater than" },
  { cat: "Compare", id: "lt",  label: "Less <",     icon: "fa-chevron-left",  color: "#ee68ee", syntax: " < ", hint: "Less than" },
  { cat: "Compare", id: "gte", label: "Greater >=", icon: "fa-chevron-right", color: "#ee68ee", syntax: " >= ", hint: "Greater or equal" },
  { cat: "Compare", id: "lte", label: "Less <=",    icon: "fa-chevron-left",  color: "#ee68ee", syntax: " <= ", hint: "Less or equal" },

  // Логика
  { cat: "Logic", id: "if_else", label: "If/Else", icon: "fa-code-branch",  color: "#e05a5a",
    syntax: "({condition} ? {true_val} : {false_val})",   hint: "Ternary — if condition then value_a else value_b",
    desc: "Returns true_val if condition is truthy, otherwise false_val." },
];

export const BLUEPRINT_CATS = ["Sources", "Dice", "Math", "Compare", "Logic"];
