export class FormulaEngine {

  static evaluate(formula, doc) {
    if (!formula) return "";
    try {
      const resolved = this._resolveRefs(String(formula), doc);
      return this._evalMath(resolved);
    } catch(e) {
      return `!err: ${e.message}`;
    }
  }

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
        const val = this._asScalar(this._readDocProperty(doc, match));
        if (val !== undefined && val !== null && typeof val !== "object") {
          console.debug(`SD | Formula: bare path "${match}" resolved to ${val}. Wrap in {curly braces} for clarity.`);
          return this._safeLiteral(val, true);
        }

        const rd = (doc instanceof Actor ? doc : doc.actor)?.getRollData?.() ?? {};
        const rdVal = this._asScalar(foundry.utils.getProperty(rd, match));
        if (rdVal !== undefined && rdVal !== null && typeof rdVal !== "object") {
          return this._safeLiteral(rdVal, true);
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

  static _asScalar(val) {
    if (val === undefined || val === null) return val;
    if (typeof val !== "object") return val;
    if ("value" in val && val.value !== null && val.value !== undefined && typeof val.value !== "object") {
      return val.value;
    }
    return val;
  }

  static isFormula(str) {
    const s = String(str ?? "");
    if (/[{}+\-*\/]|floor|ceil|round|max|min|abs|item:|slot/.test(s)) return true;
    const t = s.trim();
    if (t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))) return true;
    if (t !== "" && /^-?\d+(?:\.\d+)?$/.test(t)) return true;
    return false;
  }

  static _actorFor(doc) {
    if (!doc) return null;
    try {
      if (typeof Actor !== "undefined" && doc instanceof Actor) return doc;
    } catch {  }
    if (doc?.documentName === "Actor") return doc;
    if (doc?.actor) return doc.actor;
    return null;
  }

  static _resolveItemRef(ref, doc) {
    if (!ref) return null;
    const actor = this._actorFor(doc);
    if (ref.includes(".")) {
      try { return fromUuidSync?.(ref) ?? null; } catch { return null; }
    }
    if (actor) {
      const byId = actor.items?.get?.(ref);
      if (byId) return byId;
      const byName = actor.items?.find?.(i => i.name === ref);
      if (byName) return byName;
    }
    try {
      const byCollectionId = game?.items?.get?.(ref);
      if (byCollectionId) return byCollectionId;
      const byCollectionName = game?.items?.getName?.(ref);
      if (byCollectionName) return byCollectionName;
    } catch {}
    return null;
  }

  static _readDocProperty(doc, path) {
    if (typeof path === "string" && path.startsWith("system.widgetFields.")) {
      const rest   = path.slice("system.widgetFields.".length);
      const dotIdx = rest.indexOf(".");
      const key    = dotIdx < 0 ? rest : rest.slice(0, dotIdx);
      const prop   = dotIdx < 0 ? "value" : rest.slice(dotIdx + 1);
      const w = this._findWidgetByKey(doc, key);
      if (w) return this._readWidgetProp(w, prop, doc);
      // Persisted widgetFields is also a real document field. This fallback is
      // important for Get Field Value by UUID and for documents whose sheet
      // definition is not currently available in memory.
      try {
        const stored = foundry.utils.getProperty(doc, path);
        if (stored !== undefined) return stored;
      } catch {}
      return undefined;
    }
    if (!doc || !path) return undefined;
    const HF = "system.hiddenFields.";
    if (path.startsWith(HF)) {
      const k = path.slice(HF.length);
      const v = doc?.system?.hiddenFields?.[k];
      return v;
    }
    try {
      return foundry.utils.getProperty(doc, path);
    } catch {
      return undefined;
    }
  }

  static _readWidgetValue(w, doc) {
    if (!w) return 0;
    const owner = this._findWidgetOwner(w, doc) ?? doc;

    if (w.valueFormula !== undefined && w.valueFormula !== null && String(w.valueFormula).trim() !== "") {
      return this.evaluate(String(w.valueFormula), owner);
    }

    const t = String(w.type ?? "");

    // Action / decoration widgets produce no value output: the
    // system.widgetFields.<key>.value field does not exist for them.
    if (t === "button" || t === "rollButton" || t === "cardDrawButton" || t === "section" || t === "vsection" || t === "widgetBuilder") return undefined;

    if (t === "derived" || t === "calc" || t === "computed") {
      const v = this.evaluate(w.formula ?? "0", owner);
      const dp = Number(w.decimalPlaces ?? 0);
      if (typeof v === "number" && Number.isFinite(v) && dp > 0) {
        return Number(v.toFixed(dp));
      }
      return v;
    }

    if (t === "resource" || t === "progress") {
      const v = this._asScalar(this._readDocProperty(owner, w.pathValue));
      if (v !== undefined && v !== null && typeof v !== "object") return v;
    }

    if (t === "toggle") {
      const v = this._readDocProperty(owner, w.path);
      if (v === true || v === false) return v ? 1 : 0;
      if (v === "true" || v === 1 || v === "1") return 1;
      if (v === undefined || v === null || v === "" || v === "false" || v === 0 || v === "0") return 0;
      return v ? 1 : 0;
    }

    if (t === "richtext") {
      const v = w.path ? this._readDocProperty(owner, w.path) : (w.staticHtml ?? "");
      if (typeof v === "string" && v) return v.replace(/<[^>]+>/g, "").trim();
      return "";
    }

    if (t === "tags") {
      const v = this._readDocProperty(owner, w.path);
      if (Array.isArray(v)) return v.join(", ");
      if (typeof v === "string") return v;
      return "";
    }

    if (t === "select") {
      const options = String(w.choices ?? "").split(",").map(v => v.trim()).filter(Boolean);
      const key = String(w.widgetKey ?? "").trim();
      if (key) {
        let stored;
        try { stored = foundry.utils.getProperty(owner, `system.widgetFields.${key}.value`); } catch {}
        if (stored !== undefined && stored !== null && (!options.length || options.includes(String(stored)))) return stored;
      }
      if (w.path && !String(w.path).startsWith("system.widgetFields.")) {
        const v = this._readDocProperty(owner, w.path);
        if (v !== undefined && v !== null && (!options.length || options.includes(String(v)))) return v;
      }
      return options[0] ?? "";
    }

    if (t === "diceTray") {
      const flag = w.flagPath ? this._readDocProperty(owner, w.flagPath) : null;
      if (flag && typeof flag === "object") {
        if ("total" in flag) return Number(flag.total) || 0;
        if ("result" in flag) return Number(flag.result) || 0;
      }
      return 0;
    }

    if (t === "section") {
      return String(w.label ?? "");
    }

    if (t === "image") {
      return String(w.staticSrc ?? "");
    }

    if (t === "inventory") {
      const actor = this._actorFor(owner);
      if (!actor) return 0;
      const cats = Array.isArray(w.categories) ? w.categories : [];
      const items = actor.items?.contents ?? actor.items ?? [];
      const filtered = cats.length
        ? items.filter(i => i?.type === "inventory" && cats.includes(i.system?.category))
        : items.filter(i => i?.type === "inventory");
      return filtered.length;
    }
    if (t === "effects") {
      const actor = this._actorFor(owner);
      return actor?.effects?.contents?.length ?? actor?.effects?.size ?? 0;
    }
    if (t === "spellbook") {
      const actor = this._actorFor(owner);
      if (!actor) return 0;
      const filter = String(w.abilityType ?? "").trim();
      const items = actor.items?.contents ?? actor.items ?? [];
      const filtered = items.filter(i => i?.type === "ability" && (filter === "" || i.system?.abilityType === filter));
      return filtered.length;
    }

    if (t === "slot") {
      const slotId = String(w.slotId ?? "");
      if (slotId) {
        const sc = this._readDocProperty(owner, `system.slotContents.${slotId}`);
        if (sc && typeof sc === "object") {
          if (Array.isArray(sc.contents)) return sc.contents.length;
          if (Number.isFinite(Number(sc.count))) return Number(sc.count);
        }
      }
      return 0;
    }

    if (w.path) {
      const v = this._asScalar(this._readDocProperty(owner, w.path));
      if (v !== undefined && v !== null && typeof v !== "object") return v;
    }
    if (w.pathValue) {
      const v = this._asScalar(this._readDocProperty(owner, w.pathValue));
      if (v !== undefined && v !== null && typeof v !== "object") return v;
    }

    if (w.staticValue !== undefined && w.staticValue !== "") return w.staticValue;

    if (typeof w.label === "string" && w.label) return w.label;
    return 0;
  }

  static _findWidgetOwner(w, doc) {
    const _has = (d) => {
      const _walk = (list) => {
        if (!Array.isArray(list)) return false;
        for (const ww of list) {
          if (!ww) continue;
          if (ww === w) return true;
          if (_walk(ww.widgets)) return true;
          if (_walk((ww.elements ?? []).map(el => el?.widget).filter(Boolean))) return true;
        }
        return false;
      };
      const tabs = d?.system?.customTabs ?? [];
      for (const tab of tabs) for (const row of (tab.rows ?? [])) {
        if (_walk(row.widgets)) return true;
      }
      return false;
    };
    if (_has(doc)) return doc;
    if (doc?.actor && doc.actor !== doc && _has(doc.actor)) return doc.actor;
    const items = Array.isArray(doc?.items) ? doc.items : (doc?.items?.contents ?? []);
    for (const item of items) {
      if (_has(item)) return item;
    }
    return null;
  }

  static _findWidgetByKey(doc, key) {
    if (!key) return null;
    const want = String(key).trim();
    if (!want) return null;
    const wantLc = want.toLowerCase();

    // Match passes: 0 = exact widgetKey, 1 = exact label,
    // 2 = case-insensitive widgetKey, 3 = case-insensitive label.
    // The case-insensitive passes let {widget:derived2} and
    // system.widgetFields.derived2.value find a widget labeled "Derived2".
    const _match = (w, mode) => {
      const k = String(w.widgetKey ?? "").trim();
      const l = String(w.label ?? "").trim();
      if (mode === 0) return k !== "" && k === want;
      if (mode === 1) return l !== "" && l === want;
      if (mode === 2) return k !== "" && k.toLowerCase() === wantLc;
      return l !== "" && l.toLowerCase() === wantLc;
    };

    const _walk = (list, mode) => {
      if (!Array.isArray(list)) return null;
      for (const w of list) {
        if (!w) continue;
        if (_match(w, mode)) return w;
        const nested = _walk(w.widgets, mode);
        if (nested) return nested;
        const embedded = _walk((w.elements ?? []).map(el => el?.widget).filter(Boolean), mode);
        if (embedded) return embedded;
      }
      return null;
    };

    const _scan = (doc) => {
      const tabs = doc?.system?.customTabs ?? [];
      for (const mode of [0, 1, 2, 3]) {
        for (const tab of tabs) {
          for (const row of (tab.rows ?? [])) {
            const hit = _walk(row.widgets, mode);
            if (hit) return hit;
          }
        }
      }
      return null;
    };

    let w = _scan(doc);
    if (w) return w;

    if (doc?.actor && doc.actor !== doc) {
      w = _scan(doc.actor);
      if (w) return w;
    }
    if (Array.isArray(doc?.items)) {
      for (const item of doc.items) {
        w = _scan(item);
        if (w) return w;
      }
    } else if (doc?.items?.contents) {
      for (const item of doc.items.contents) {
        w = _scan(item);
        if (w) return w;
      }
    }

    // Diagnostics: report once per missing key which widgets ARE visible, so
    // broken {system.widgetFields...} / {widget:...} refs are easy to debug.
    try {
      const missed = FormulaEngine._sdMissWarned ?? (FormulaEngine._sdMissWarned = new Set());
      const missKey = `${doc?.uuid ?? doc?.id ?? "?"}|${want}`;
      if (!missed.has(missKey)) {
        missed.add(missKey);
        const names = [];
        const _collect = (list) => {
          if (!Array.isArray(list)) return;
          for (const ww of list) {
            if (!ww) continue;
            const nm = String(ww.widgetKey ?? "").trim() || String(ww.label ?? "").trim();
            if (nm) names.push(`"${nm}" (${String(ww.type ?? "?")})`);
            _collect(ww.widgets);
            _collect((ww.elements ?? []).map(el => el?.widget).filter(Boolean));
          }
        };
        const _collectDoc = (d) => {
          for (const tab of (d?.system?.customTabs ?? [])) {
            for (const row of (tab.rows ?? [])) _collect(row.widgets);
          }
        };
        _collectDoc(doc);
        if (doc?.actor && doc.actor !== doc) _collectDoc(doc.actor);
        const items = Array.isArray(doc?.items) ? doc.items : (doc?.items?.contents ?? []);
        for (const it of items) _collectDoc(it);
        console.warn(`[sd] widgetFields: widget "${want}" not found on "${doc?.name ?? "?"}". Widgets visible here: ${names.join(", ") || "(none)"}`);
      }
    } catch (err) { /* never break formula resolution */ }
    return null;
  }

  static _collectTargetUuids(mode, doc = null) {
    const m = String(mode ?? "targets");
    const toks = [];
    if (m === "selected" || m === "both") toks.push(...(canvas?.tokens?.controlled ?? []));
    if (m === "targets" || m === "both" || m === "all_targets") toks.push(...(game?.user?.targets ?? []));
    const seen = new Set(); const out = [];
    const addActor = (a) => {
      const u = a?.uuid ?? a?.id;
      if (u && !seen.has(u)) { seen.add(u); out.push(u); }
    };
    if (m === "self_actor") addActor(this._actorFor(doc));
    if (m === "user_character") addActor(game?.user?.character ?? null);
    if (m === "scene") for (const t of (canvas?.tokens?.placeables ?? [])) addActor(t?.actor);
    if (m === "players_online" || m === "players_all") {
      const users = game?.users?.contents ?? game?.users ?? [];
      for (const user of users) {
        if (user?.isGM) continue;
        if (m === "players_online" && user?.active === false) continue;
        addActor(user?.character ?? null);
      }
      if (m === "players_all") {
        for (const actor of (game?.actors?.contents ?? [])) if (actor?.hasPlayerOwner) addActor(actor);
      }
    }
    for (const t of toks) {
      addActor(t?.actor);
    }
    return out;
  }

  static _docByUuidSync(uuid) {
    const id = String(uuid ?? "").trim();
    if (!id) return null;
    let t = null;
    try { t = (typeof fromUuidSync === "function") ? fromUuidSync(id) : null; } catch { t = null; }
    if (!t) t = game?.actors?.get?.(id) ?? game?.actors?.getName?.(id) ?? null;
    if (t?.documentName === "Token") t = t.actor ?? t;
    return t ?? null;
  }

  static _readDocField(target, path) {
    if (!target) return 0;
    const p = String(path ?? "").trim();
    if (!p || p === "uuid") return target.uuid ?? target.id ?? "";
    if (p === "name") return target.name ?? "";
    const v = this._readDocProperty(target, p);
    if (v === undefined || v === null) return 0;
    if (Array.isArray(v)) return v.join(",");
    if (typeof v === "object") return 0;
    return v;
  }

  static _readWidgetProp(w, prop, doc) {
    if (!w) return 0;
    if (prop === "value" || prop === "") return this._readWidgetValue(w, doc);
    const owner = this._findWidgetOwner(w, doc) ?? doc;
    if (prop === "max" && (w.pathMax || w.maxPath)) {
      const mv = this._asScalar(this._readDocProperty(owner, w.pathMax ?? w.maxPath));
      if (mv !== undefined && mv !== null && typeof mv !== "object") return mv;
    }
    if (prop === "names" || prop === "ids" || prop === "uuids") {
      const t = String(w.type ?? "");
      const actor = this._actorFor(owner);
      let list = [];
      if (t === "inventory" && actor) {
        const cats = Array.isArray(w.categories) ? w.categories : [];
        list = (actor.items?.contents ?? []).filter(i => i?.type === "inventory" && (!cats.length || cats.includes(i.system?.category)));
      } else if (t === "spellbook" && actor) {
        const filter = String(w.abilityType ?? "").trim();
        list = (actor.items?.contents ?? []).filter(i => i?.type === "ability" && (filter === "" || i.system?.abilityType === filter));
      } else if (t === "slot") {
        const sc = this._readDocProperty(owner, `system.slotContents.${String(w.slotId ?? "")}`);
        const ids = Array.isArray(sc?.contents) ? sc.contents : [];
        if (prop === "ids") return ids.join(",");
        list = ids.map(id => actor?.items?.get?.(id)).filter(Boolean);
      }
      if (prop === "ids")   return list.map(i => i.id).join(",");
      if (prop === "uuids") return list.map(i => i.uuid ?? i.id).join(",");
      return list.map(i => i.name).join(",");
    }
    if (String(w.type ?? "") === "widgetBuilder") {
      if (prop === "label") return String(w.label ?? "");
      const outs = (w.wbOutputs && typeof w.wbOutputs === "object") ? w.wbOutputs : null;
      let elKey = String(prop ?? "");
      if (elKey.endsWith(".value")) elKey = elKey.slice(0, -".value".length);
      let f = outs ? outs[elKey] : undefined;
      if (f === undefined && outs) {
        const elLc = elKey.trim().toLowerCase();
        for (const k2 of Object.keys(outs)) {
          if (String(k2).trim().toLowerCase() === elLc) { f = outs[k2]; break; }
        }
      }
      if (typeof f === "string" && f.trim() !== "") {
        let raw = f.trim();
        if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
          try { raw = String(JSON.parse(raw)); } catch (err) { raw = raw.slice(1, -1); }
        }
        try {
          const v2 = this.evaluate(raw, owner);
          if (v2 !== undefined && v2 !== null && !(typeof v2 === "string" && String(v2).startsWith("!err"))) return v2;
        } catch (err) { /* fall through to text resolution */ }
        try { return String(this._resolveRefs?.(raw, owner) ?? raw); } catch (err) { return raw; }
      }
      return undefined;
    }
    const v = w[prop];
    if (v === undefined || v === null) return 0;
    if (Array.isArray(v)) return v.join(",");
    if (typeof v === "object") return 0;
    return v;
  }

  static _resolveRefs(formula, doc, rollMode = false) {
    let prev = null;
    let cur  = String(formula);
    // Tolerate accidentally double-wrapped tokens like {{widget:Key}}
    cur = cur.replace(/\{\{([^{}]+)\}\}/g, "{$1}");
    let pass = 0;
    while (cur !== prev && pass++ < 8 && /\{[^{}]+\}/.test(cur)) {
      prev = cur;
      cur = cur.replace(/\{([^{}]+)\}/g, (match, inner) => {
        const trimmed = inner.trim();
        if (trimmed.startsWith("raw:")) {
          const val = this._resolveToken(trimmed.slice(4).trim(), doc);
          if (val === undefined || val === null) return "0";
          if (typeof val === "object") return "0";
          return String(val);
        }
        const val = this._resolveToken(trimmed, doc);
        if (val === undefined || val === null) return "0";
        return this._safeLiteral(val, rollMode);
      });
    }
    return cur;
  }

  static _looksLikeRollExpr(s) {
    if (!/^[\sA-Za-z0-9+\-*/().,@_#\[\]!?<>=:]+$/.test(s)) return false;
    if (/\d+\s*d\s*\d+/i.test(s))                    return true;
    if (/[+\-*/]/.test(s))                            return true;
    if (/@[A-Za-z_]/.test(s))                         return true;
    if (/\b(?:floor|ceil|round|abs|min|max)\s*\(/i.test(s)) return true;
    return false;
  }

  static _safeLiteral(val, rollMode = false) {
    const t = typeof val;
    if (t === "number")  return Number.isFinite(val) ? String(val) : "0";
    if (t === "boolean") return val ? "true" : "false";
    const s = String(val ?? "");
    if (s === "") return rollMode ? "0" : '""';
    if (/^-?\d+(?:\.\d+)?$/.test(s)) return s;
    if (rollMode && this._looksLikeRollExpr(s.trim())) return s.trim();
    return JSON.stringify(s);
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

  static _b64decodeUtf8(b64) {
    if (!b64) return "";
    try {
      const bin = (typeof atob === "function")
        ? atob(b64)
        : (typeof Buffer !== "undefined" ? Buffer.from(b64, "base64").toString("binary") : "");
      try { return decodeURIComponent(escape(bin)); }
      catch { return bin; }
    } catch (e) {
      return "";
    }
  }

  static _unwrapTokenString(raw) {
    if (raw === undefined || raw === null) return "";
    let s = String(raw).trim();
    if (s.length >= 2 && ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))) {
      try { s = JSON.parse(s); }
      catch { s = s.slice(1, -1); }
    }
    return String(s ?? "");
  }

  static _parseArrayList(raw) {
    const s = this._unwrapTokenString(raw);
    if (!s) return [];
    return s.split(",").map(x => x.trim()).filter(Boolean);
  }

  static _parseArrayNum(raw, fallback = 0) {
    if (raw === undefined || raw === null || raw === "") return fallback;
    const s = this._unwrapTokenString(raw);
    const n = Number(s);
    return Number.isFinite(n) ? n : fallback;
  }

  static _resolveArrayArg(raw, doc, { template = false } = {}) {
    const source = String(raw ?? "");
    if (!source.startsWith("b64:")) return source;

    const expr = this._b64decodeUtf8(source.slice(4));
    return template
      ? this._resolveArrayTemplate(expr, doc)
      : this._evalSideForCompare(expr, doc);
  }

  static _resolveArrayTemplate(raw, doc) {
    let expr = String(raw ?? "");
    const placeholders = [
      ["{__elem}", "__SD_ARRAY_ELEM__"],
      ["{__elemIndex}", "__SD_ARRAY_INDEX__"]
    ];
    for (const [needle, replacement] of placeholders) expr = expr.replaceAll(needle, replacement);
    let resolved = String(this._evalSideForCompare(expr, doc) ?? "");
    for (const [needle, replacement] of placeholders) resolved = resolved.replaceAll(replacement, needle);
    return resolved;
  }

  static _evalSideForCompare(expr, doc) {
    if (expr === undefined || expr === null) return "";
    const s = String(expr).trim();
    if (!s) return "";

    if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) {
      return s.slice(1, -1);
    }

    let str = s;
    let prev = null;
    let pass = 0;
    while (prev !== str && pass++ < 8 && /\{[^{}]+\}/.test(str)) {
      prev = str;
      str = str.replace(/\{([^{}]+)\}/g, (_match, inner) => {
        const trimmed = inner.trim();
        const tk = trimmed.startsWith("raw:") ? trimmed.slice(4).trim() : trimmed;
        const val = this._resolveToken(tk, doc);
        if (val === undefined || val === null) return "";
        if (typeof val === "object") return "";
        return String(val);
      });
    }

    let unwrapPasses = 0;
    while (typeof str === "string" && unwrapPasses++ < 4) {
      const t = str.trim();
      if (t.length < 2 || !t.startsWith('"') || !t.endsWith('"')) break;
      try {
        const parsed = JSON.parse(t);
        if (typeof parsed !== "string" || parsed === t) { str = parsed; break; }
        str = parsed;
      } catch { break; }
    }
    if (typeof str !== "string") return str;

    const evald = this._evalMath(str);
    if (typeof evald === "string") {
      const t = evald.trim();
      if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
        try { return JSON.parse(t); } catch {}
      }
    }
    return evald;
  }

  static _looseEq(a, b) {
    if (a === b) return true;
    if (typeof a === "number" && typeof b === "number") return a === b;

    const na = Number(a);
    const nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb) && String(a).trim() !== "" && String(b).trim() !== "") {
      if (na === nb) return true;
    }

    const sa = String(a ?? "");
    const sb = String(b ?? "");
    return sa === sb;
  }

  static _sdStripQuotes(s) {
    if (s === undefined || s === null) return "";
    let out = String(s).trim();
    if (out.length >= 2 && ((out.startsWith('"') && out.endsWith('"')) || (out.startsWith("'") && out.endsWith("'")))) {
      out = out.slice(1, -1);
    }
    return out;
  }

  static _resolveActorFromBase(base, doc) {
    const raw = this._sdStripQuotes(base);
    if (!raw || raw === "0") {
      return (doc instanceof Actor) ? doc : (doc?.actor ?? null);
    }
    if (raw === "self") {
      if (doc instanceof Actor) return doc;
      return doc?.actor ?? doc ?? null;
    }
    if (raw === "actor") {
      return (doc instanceof Actor) ? doc : (doc?.actor ?? null);
    }
    if (raw === "token_target" || raw === "target") {
      try {
        return game.user?.targets?.first()?.actor
            ?? canvas?.tokens?.controlled?.[0]?.actor
            ?? null;
      } catch { return null; }
    }
    if (raw === "selected_token" || raw === "selected") {
      try {
        return canvas?.tokens?.controlled?.[0]?.actor
            ?? game.user?.targets?.first()?.actor
            ?? null;
      } catch { return null; }
    }
    if (raw === "user_character") {
      try { return game.user?.character ?? null; } catch { return null; }
    }
    if (raw === "all_targets") {
      try {
        return [...(game.user?.targets ?? [])][0]?.actor
            ?? canvas?.tokens?.controlled?.[0]?.actor
            ?? null;
      } catch { return null; }
    }
    if (raw.includes(".") && /^[A-Za-z][A-Za-z0-9]*\./.test(raw)) {
      try {
        const d = (typeof fromUuidSync === "function") ? fromUuidSync(raw) : null;
        if (d instanceof Actor) return d;
        if (d?.actor instanceof Actor) return d.actor;
      } catch {}
    }
    if (/^[A-Za-z0-9]{16}$/.test(raw)) {
      try {
        const tok = canvas?.tokens?.get?.(raw);
        if (tok?.actor) return tok.actor;
        const a = game.actors?.get?.(raw);
        if (a) return a;
      } catch {}
    }
    return null;
  }

  static _sdEachSlotItem(host, slotId, visit, _seen) {
    if (!host) return;
    const seen = _seen ?? new Set();
    if (seen.has(host)) return;
    seen.add(host);
    const contents = host?.system?.slotContents?.[slotId]?.contents ?? [];
    for (const entry of contents) {
      if (!entry) continue;
      const stop = visit(entry, host);
      if (stop === true) return true;
      if (this._sdEachSlotItem(entry, slotId, visit, seen) === true) return true;
    }
    return false;
  }

  static _sdEachSlotItemAcrossActor(actor, slotId, visit) {
    if (!actor) return;
    if (this._sdEachSlotItem(actor, slotId, visit) === true) return true;
    for (const item of (actor.items ?? [])) {
      if (this._sdEachSlotItem(item, slotId, visit) === true) return true;
    }
    return false;
  }

  static _sdCountSlotItemsAcrossActor(actor, slotId) {
    if (!actor) return 0;
    let total = 0;
    const seen = new Set();
    const walk = (host) => {
      if (!host || seen.has(host)) return;
      seen.add(host);
      const contents = host?.system?.slotContents?.[slotId]?.contents ?? [];
      total += contents.length;
      for (const c of contents) walk(c);
    };
    walk(actor);
    for (const item of (actor.items ?? [])) walk(item);
    return total;
  }

  static _sdReadPathFromAny(entry, path, actor) {
    if (!entry || !path) return undefined;
    let v;
    try { v = foundry.utils.getProperty(entry, path); } catch { v = undefined; }
    if (v !== undefined && v !== null && typeof v !== "object") return v;
    if (entry._id && actor) {
      const live = actor.items?.get?.(entry._id);
      if (live) {
        try { v = foundry.utils.getProperty(live, path); } catch { v = undefined; }
        if (v !== undefined && v !== null && typeof v !== "object") return v;
      }
    }
    return undefined;
  }

  static _resolveToken(token, doc) {
    if (token.startsWith("__sdHasEffect:")) {
      const parts = token.slice("__sdHasEffect:".length).split("|");
      if (parts.length < 2) return 0;
      const targetRef = this._resolveArrayArg(parts[0], doc);
      const effectRef = String(this._resolveArrayArg(parts.slice(1).join("|"), doc) ?? "").trim();
      if (!effectRef) return 0;
      const actor = this._resolveActorFromBase(targetRef, doc);
      if (!actor) return 0;
      const effects = actor.effects?.contents ?? actor.effects ?? [];
      for (const effect of effects) {
        if (effect?.disabled === true) continue;
        if (String(effect?.name ?? "") === effectRef || String(effect?.id ?? "") === effectRef) return 1;
      }
      return 0;
    }

    if (token.startsWith("__sdEq:") || token.startsWith("__sdNeq:")) {
      const isNeq = token.startsWith("__sdNeq:");
      const rest  = token.slice(isNeq ? "__sdNeq:".length : "__sdEq:".length);
      const sep   = rest.indexOf("|");
      if (sep < 0) return 0;
      const a = this._b64decodeUtf8(rest.slice(0, sep));
      const b = this._b64decodeUtf8(rest.slice(sep + 1));
      const aVal = this._evalSideForCompare(a, doc);
      const bVal = this._evalSideForCompare(b, doc);
      const eq = this._looseEq(aVal, bVal);
      return (isNeq ? !eq : eq) ? 1 : 0;
    }

    if (token.startsWith("__sdMatch:")) {
      const rest = token.slice("__sdMatch:".length);
      const parts = rest.split("|");
      if (parts.length < 3) return "";
      const mode    = String(parts[0] || "str").toLowerCase();
      const valExpr = this._b64decodeUtf8(parts[1]);
      const defExpr = this._b64decodeUtf8(parts[2]);

      const _normArr = (v) => {
        if (Array.isArray(v)) return v.map(x => String(x ?? "")).join(",");
        return String(v ?? "");
      };
      const _toMatchKey = (v) => {
        if (mode === "num") {
          const n = Number(v);
          return Number.isFinite(n) ? n : null;
        }
        if (mode === "arr") return _normArr(v);
        return String(v ?? "");
      };

      const valResolved = this._evalSideForCompare(valExpr, doc);
      const valKey = _toMatchKey(valResolved);

      for (let k = 3; k + 1 < parts.length; k += 2) {
        const caseExpr   = this._b64decodeUtf8(parts[k]);
        const resultExpr = this._b64decodeUtf8(parts[k + 1]);
        if (caseExpr === "" && resultExpr === "") continue;
        const caseResolved = this._evalSideForCompare(caseExpr, doc);
        const caseKey = _toMatchKey(caseResolved);
        let hit = false;
        if (mode === "num") {
          if (valKey !== null && caseKey !== null && valKey === caseKey) hit = true;
        } else {
          if (valKey === caseKey) hit = true;
        }
        if (hit) {
          if (resultExpr === "") return mode === "num" ? 0 : "";
          return this._evalSideForCompare(resultExpr, doc);
        }
      }

      if (defExpr === "") return mode === "num" ? 0 : "";
      return this._evalSideForCompare(defExpr, doc);
    }

    if (token.startsWith("__sdName:")) {
      const rest = token.slice("__sdName:".length);
      const sep  = rest.indexOf("|");
      if (sep < 0) return "";
      const kind   = rest.slice(0, sep).trim();
      const b64Ref = rest.slice(sep + 1).trim();
      let   ref    = this._b64decodeUtf8(b64Ref);

      if (ref.startsWith('"') && ref.endsWith('"')) {
        try { ref = JSON.parse(ref); } catch {}
      } else if (ref.startsWith("'") && ref.endsWith("'")) {
        ref = ref.slice(1, -1);
      }
      ref = String(ref ?? "").trim();
      if (!ref) return "";

      const _byUuid = (s) => {
        try { return fromUuidSync?.(s) ?? null; } catch { return null; }
      };
      const actor = doc instanceof Actor ? doc : (doc?.actor ?? null);

      const _tryItem = () => {
        if (ref.includes(".")) {
          const d = _byUuid(ref);
          if (d?.documentName === "Item") return d?.name ?? "";
        }
        if (actor) {
          const byId = actor.items?.get?.(ref);
          if (byId) return byId.name ?? "";
          const byName = actor.items?.find?.(i => i.name === ref);
          if (byName) return byName.name ?? "";
        }
        try {
          const byCollectionId = game?.items?.get?.(ref);
          if (byCollectionId) return byCollectionId.name ?? "";
          const byCollectionName = game?.items?.getName?.(ref);
          if (byCollectionName) return byCollectionName.name ?? "";
        } catch {}
        return "";
      };
      const _tryWidget = () => {
        const w = this._findWidgetByKey(doc, ref);
        return w?.label ?? "";
      };
      const _tryToken = () => {
        try {
          if (typeof canvas !== "undefined") {
            const tk = canvas?.tokens?.get?.(ref);
            if (tk) return tk.name ?? tk.document?.name ?? "";
            const tkByName = canvas?.tokens?.placeables?.find?.(t => (t.name ?? t.document?.name) === ref);
            if (tkByName) return tkByName.name ?? tkByName.document?.name ?? "";
          }
        } catch {}
        if (ref.startsWith("Scene.")) {
          const d = _byUuid(ref);
          if (d?.documentName === "Token") return d?.name ?? "";
        }
        return "";
      };
      const _tryActor = () => {
        if (ref.includes(".")) {
          const d = _byUuid(ref);
          if (d) return d?.name ?? "";
        }
        try {
          const a = game?.actors?.get?.(ref) ?? game?.actors?.getName?.(ref);
          if (a) return a.name ?? "";
        } catch {}
        return "";
      };
      const _trySheet = () => {
        if (ref.includes(".")) {
          const d = _byUuid(ref);
          if (d) return d?.name ?? "";
        }
        return "";
      };

      switch (kind) {
        case "item":   return _tryItem();
        case "widget": return _tryWidget();
        case "token":  return _tryToken();
        case "actor":  return _tryActor();
        case "sheet":  return _trySheet();
        case "auto":
        default: {
          if (ref.includes(".")) {
            const d = _byUuid(ref);
            if (d) return d?.name ?? "";
          }
          const fns = [_tryWidget, _tryItem, _tryToken, _tryActor];
          for (const fn of fns) {
            const n = fn();
            if (n) return n;
          }
          return "";
        }
      }
    }

    if (token.startsWith("__sdEqCount:")) {
      const cat   = token.slice("__sdEqCount:".length).trim();
      const owner = doc instanceof Actor ? doc : (doc?.actor ?? null);
      const items = owner?.items?.contents ?? [];
      const n = items.filter(i => i?.type === "inventory"
        && i.system?.equipped === true
        && (cat === "" || cat === "any" || i.system?.category === cat)).length;
      return n;
    }

    if (token.startsWith("__sdWidgetValue:")) {
      const encoded = token.slice("__sdWidgetValue:".length).trim();
      let expression = "";
      try { expression = this._b64decodeUtf8(encoded); } catch { expression = ""; }
      let key = "";
      try { key = this._evalSideForCompare(expression, doc); }
      catch { key = expression; }
      key = this._sdStripQuotes(key).trim();
      if (!key) return 0;
      const w = this._findWidgetByKey(doc, key);
      if (w) return this._readWidgetValue(w, doc);
      try {
        const stored = foundry.utils.getProperty(doc, `system.widgetFields.${key}.value`);
        if (stored !== undefined && stored !== null) return stored;
      } catch {}
      return 0;
    }

    if (token.startsWith("widget:")) {
      const key    = token.slice("widget:".length);
      let w        = this._findWidgetByKey(doc, key);
      if (w) return this._readWidgetValue(w, doc);
      const dotIdx = key.lastIndexOf(".");
      if (dotIdx > 0) {
        const base = key.slice(0, dotIdx);
        const prop = key.slice(dotIdx + 1);
        w = this._findWidgetByKey(doc, base);
        if (w) return this._readWidgetProp(w, prop, doc);
      }
      return 0;
    }

    if (token.startsWith("widgetPath:")) {
      const key = token.slice("widgetPath:".length);
      const w   = this._findWidgetByKey(doc, key);
      return w?.path ?? w?.pathValue ?? "";
    }

    if (token.startsWith("item:id:")) {
      const rest    = token.slice("item:id:".length);
      const dotIdx  = rest.indexOf(".");
      if (dotIdx < 0) return 0;
      const itemId  = rest.slice(0, dotIdx);
      const path    = rest.slice(dotIdx + 1);
      const actor   = doc instanceof Actor ? doc : doc.actor;
      const item    = actor?.items?.get(itemId);
      return item ? (this._readDocProperty(item, path) ?? 0) : 0;
    }

    if (token.startsWith("item:")) {
      const rest    = token.slice("item:".length);
      const dotIdx  = rest.indexOf(".");
      if (dotIdx < 0) return 0;
      const name    = rest.slice(0, dotIdx).toLowerCase();
      const path    = rest.slice(dotIdx + 1);
      const actor   = doc instanceof Actor ? doc : doc.actor;
      const item    = actor?.items?.find(i => i.name.toLowerCase() === name);
      return item ? (this._readDocProperty(item, path) ?? 0) : 0;
    }

    if (token.startsWith("slotCount:")) {
      const slotId = token.slice("slotCount:".length);
      const _cnt = (t) => t?.system?.slotContents?.[slotId]?.contents?.length
                       ?? t?.system?.slotContents?.[slotId]?.count
                       ?? null;

      const directVal = _cnt(doc);
      if (directVal !== null) return directVal;

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

    if (token.startsWith("slotCountOn:")) {
      const rest = token.slice("slotCountOn:".length);
      const sep1 = rest.indexOf("|");
      if (sep1 < 0) return 0;
      const base   = rest.slice(0, sep1);
      const slotId = this._sdStripQuotes(rest.slice(sep1 + 1));
      const actor  = this._resolveActorFromBase(base, doc);
      if (!actor) {
        const fallback = (doc instanceof Actor) ? doc : (doc?.actor ?? null);
        if (!fallback) return 0;
        return this._sdCountSlotItemsAcrossActor(fallback, slotId);
      }
      return this._sdCountSlotItemsAcrossActor(actor, slotId);
    }

    if (token.startsWith("slotFind:")) {
      const rest = token.slice("slotFind:".length);
      const sep1 = rest.indexOf("|");
      if (sep1 < 0) return 0;
      const base  = rest.slice(0, sep1);
      const tail  = rest.slice(sep1 + 1);
      const sep2  = tail.indexOf("|");
      if (sep2 < 0) return 0;
      const slotId = this._sdStripQuotes(tail.slice(0, sep2));
      const path   = tail.slice(sep2 + 1);
      const actor  = this._resolveActorFromBase(base, doc)
                  ?? (doc instanceof Actor ? doc : (doc?.actor ?? null));
      if (!actor || !slotId || !path) return 0;
      let found;
      this._sdEachSlotItemAcrossActor(actor, slotId, (entry) => {
        const v = this._sdReadPathFromAny(entry, path, actor);
        if (v !== undefined) { found = v; return true; }
        return false;
      });
      return found ?? 0;
    }

    if (token.startsWith("slotUuidFind:")) {
      const rest = token.slice("slotUuidFind:".length);
      const sep1 = rest.indexOf("|");
      if (sep1 < 0) return "";
      const base   = rest.slice(0, sep1);
      const slotId = this._sdStripQuotes(rest.slice(sep1 + 1));
      const actor  = this._resolveActorFromBase(base, doc)
                  ?? (doc instanceof Actor ? doc : (doc?.actor ?? null));
      if (!actor || !slotId) return "";
      let found = "";
      this._sdEachSlotItemAcrossActor(actor, slotId, (entry, host) => {
        const u = entry.uuid ?? entry._sourceUuid ?? null;
        if (u) { found = u; return true; }
        if (entry._id && actor.items?.get) {
          const live = actor.items.get(entry._id);
          if (live?.uuid) { found = live.uuid; return true; }
        }
        if (entry._id) { found = `${host?.uuid ?? actor.uuid}.Item.${entry._id}`; return true; }
        return false;
      });
      return found;
    }

    if (token.startsWith("invItemSlotCountOn:")) {
      const rest = token.slice("invItemSlotCountOn:".length);
      const sep1 = rest.indexOf("|");
      if (sep1 < 0) return 0;
      const base  = rest.slice(0, sep1);
      const tail  = rest.slice(sep1 + 1);
      const sep2  = tail.indexOf("|");
      if (sep2 < 0) return 0;
      const ref    = this._sdStripQuotes(tail.slice(0, sep2));
      const slotId = this._sdStripQuotes(tail.slice(sep2 + 1));
      if (!slotId) return 0;
      const actor  = this._resolveActorFromBase(base, doc)
                  ?? (doc instanceof Actor ? doc : (doc?.actor ?? null));
      if (!actor) return 0;
      if (!ref) return this._sdCountSlotItemsAcrossActor(actor, slotId);
      const parentItem = actor.items?.get?.(ref)
                      ?? actor.items?.find?.(i => i.name === ref)
                      ?? actor.items?.find?.(i => i.uuid === ref)
                      ?? null;
      if (!parentItem) return 0;
      return this._sdCountSlotItemsAcrossActor({ items: [parentItem] }, slotId);
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
      return item ? (this._readDocProperty(item, path) ?? 0) : 0;
    }

    if (token.startsWith("target.")) {
      const path   = token.slice("target.".length);
      const tActor = (typeof game !== "undefined")
        ? (game.user?.targets?.first()?.actor ?? canvas?.tokens?.controlled?.[0]?.actor ?? null)
        : null;
      if (!tActor) return 0;
      const v = this._readDocProperty(tActor, path);
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
      const v = this._readDocProperty(a, path);
      if (v === undefined || v === null || typeof v === "object") return 0;
      return v;
    }

    if (token.startsWith("arrayLength:")) {
      const rest = token.slice("arrayLength:".length);
      if (!rest) return 0;
      return this._parseArrayList(this._resolveArrayArg(rest, doc)).length;
    }

    if (token.startsWith("arrayAt:")) {
      const rest = token.slice("arrayAt:".length);
      const sep  = rest.indexOf("|");
      if (sep < 0) return "";
      const list = this._parseArrayList(this._resolveArrayArg(rest.slice(0, sep), doc));
      const idx  = Math.floor(Number(this._resolveArrayArg(rest.slice(sep + 1), doc)) || 0);
      return list[idx] ?? "";
    }

    if (token.startsWith("arrayMapField:")) {
      const rest = token.slice("arrayMapField:".length);
      const sep  = rest.indexOf("|");
      if (sep < 0) return "";
      const list = this._parseArrayList(this._resolveArrayArg(rest.slice(0, sep), doc));
      const path = String(this._resolveArrayArg(rest.slice(sep + 1), doc) ?? "");
      if (!path) return "";
      const out = [];
      for (const tid of list) {
        const tk = (typeof canvas !== "undefined") ? canvas?.tokens?.get?.(tid) : null;
        const a  = tk?.actor;
        if (!a) { out.push(""); continue; }
        const v = this._readDocProperty(a, path);
        out.push(v === undefined || v === null || typeof v === "object" ? "" : String(v));
      }
      return out.join(",");
    }

    if (token.startsWith("visibleTokens:") || token.startsWith("visibleActors:")) {
      const wantActors = token.startsWith("visibleActors:");
      const head  = wantActors ? "visibleActors:" : "visibleTokens:";
      const parts = token.slice(head.length).split("|");
      let baseRaw = (parts[0] ?? "self").trim();
      if (baseRaw.length >= 2 && baseRaw.startsWith('"') && baseRaw.endsWith('"')) baseRaw = baseRaw.slice(1, -1);
      const distFt  = Number(parts[1] ?? 30) || 0;
      const angDeg  = Number(parts[2] ?? 360) || 360;
      const show    = Number(parts[3] ?? 0) ? true : false;
      const requireLOS = (parts[4] === undefined ? true : (Number(parts[4]) !== 0));

      let sourceActor = null;
      let sourceToken = null;
      try {
        if (baseRaw === "self" || baseRaw === "actor") {
          sourceActor = (doc?.documentName === "Actor") ? doc : (doc?.actor ?? null);
        } else if (baseRaw === "token_target") {
          sourceActor = [...(game.user?.targets ?? [])][0]?.actor ?? null;
        } else if (baseRaw === "selected_token") {
          sourceActor = canvas?.tokens?.controlled?.[0]?.actor ?? null;
        } else if (baseRaw === "user_character") {
          sourceActor = game.user?.character ?? null;
        } else if (baseRaw) {
          if (/^(Actor|Scene|Item|Token|Compendium)\.[A-Za-z0-9._-]+/.test(baseRaw)) {
            try {
              const d = (typeof fromUuidSync === "function") ? fromUuidSync(baseRaw) : null;
              if (d?.documentName === "Token") sourceToken = d.object ?? canvas?.tokens?.get?.(d.id) ?? null;
              else if (d?.documentName === "Actor") sourceActor = d;
              else if (d?.actor) sourceActor = d.actor;
            } catch {}
          }
          if (!sourceToken && !sourceActor) {
            const tk = canvas?.tokens?.get?.(baseRaw);
            if (tk) sourceToken = tk;
            else {
              const a = game?.actors?.get?.(baseRaw);
              if (a) sourceActor = a;
            }
          }
        }
      } catch {}

      try {
        const helper = globalThis._SD_VISION;
        const fn = helper?.sdComputeVisible ?? null;
        const fallback = helper?.sdComputeVisibleTokens;
        if (typeof fn !== "function" && typeof fallback !== "function") return "";
        const result = (typeof fn === "function")
          ? fn({
              source: sourceToken ?? sourceActor,
              distanceFt: distFt,
              angleDeg:   angDeg,
              requireLOS,
              includeHidden: false
            })
          : { tokenIds: fallback({
              source: sourceToken ?? sourceActor,
              distanceFt: distFt,
              angleDeg:   angDeg,
              requireLOS,
              includeHidden: false
            }) ?? [], actorUuids: [] };
        if (show) {
          try { helper.sdShowVisionRay?.({
            source: sourceToken ?? sourceActor,
            distanceFt: distFt,
            angleDeg:   angDeg,
            durationMs: 1500
          }); } catch {}
        }
        const list = wantActors ? (result.actorUuids ?? []) : (result.tokenIds ?? []);
        return list.join(",");
      } catch (e) {
        console.warn(`SD | ${head} resolve failed:`, e);
        return "";
      }
    }

    if (token.startsWith("tokenElevation:")) {
      const rest  = token.slice("tokenElevation:".length);
      const sep   = rest.lastIndexOf("|");
      const baseRaw = sep >= 0 ? rest.slice(0, sep) : rest;
      const round = sep >= 0 ? rest.slice(sep + 1) : "none";
      const ref = this._unquoteSimple(baseRaw);
      const tk  = this._resolveTokenObject(ref, doc);
      if (!tk) return 0;
      let v = Number(tk?.document?.elevation ?? tk?.elevation ?? 0);
      if (!Number.isFinite(v)) v = 0;
      switch (String(round)) {
        case "floor": return Math.floor(v);
        case "ceil":  return Math.ceil(v);
        case "round": return Math.round(v);
        default:      return v;
      }
    }

    if (token.startsWith("wallsBetween:")) {
      const parts = token.slice("wallsBetween:".length).split("|");
      if (parts.length < 2) return 0;
      const srcRef = this._unquoteSimple(parts[0]);
      const tgtRef = this._unquoteSimple(parts[1]);
      const type   = String(parts[2] ?? "move").toLowerCase();
      const ta = this._resolveTokenObject(srcRef, doc);
      const tb = this._resolveTokenObject(tgtRef, doc);
      if (!ta || !tb || !canvas?.walls) return 0;
      const a = { x: ta.center?.x ?? ta.x ?? 0, y: ta.center?.y ?? ta.y ?? 0 };
      const b = { x: tb.center?.x ?? tb.x ?? 0, y: tb.center?.y ?? tb.y ?? 0 };
      try {
        const walls = (canvas.walls?.placeables ?? canvas.walls?.objects?.children ?? [])
          .map(w => w?.document ?? w)
          .filter(Boolean);
        let n = 0;
        for (const w of walls) {
          if (!this._wallMatchesType(w, type)) continue;
          const c = w.c ?? (Array.isArray(w?.coords) ? w.coords : null);
          if (!c || c.length < 4) continue;
          if (this._segmentsIntersect(a.x, a.y, b.x, b.y, c[0], c[1], c[2], c[3])) n++;
        }
        return n;
      } catch (e) {
        console.warn("SD | wallsBetween failed:", e);
        return 0;
      }
    }

    if (token.startsWith("tilesBetween:")) {
      const parts = token.slice("tilesBetween:".length).split("|");
      if (parts.length < 2) return 0;
      const srcRef = this._unquoteSimple(parts[0]);
      const tgtRef = this._unquoteSimple(parts[1]);
      const filter = String(parts[2] ?? "any").toLowerCase();
      const includeHidden = String(parts[3] ?? "0") === "1";
      const ta = this._resolveTokenObject(srcRef, doc);
      const tb = this._resolveTokenObject(tgtRef, doc);
      if (!ta || !tb || !canvas?.tiles) return 0;
      const a = { x: ta.center?.x ?? ta.x ?? 0, y: ta.center?.y ?? ta.y ?? 0 };
      const b = { x: tb.center?.x ?? tb.x ?? 0, y: tb.center?.y ?? tb.y ?? 0 };
      try {
        const tiles = (canvas.tiles?.placeables ?? canvas.tiles?.objects?.children ?? [])
          .map(t => t?.document ? t : (t?.object ?? t))
          .filter(Boolean);
        let n = 0;
        for (const tile of tiles) {
          const td = tile.document ?? tile;
          if (!includeHidden && td?.hidden) continue;
          const overhead = (td?.overhead === true) || (Number(td?.elevation ?? 0) > 0);
          if (filter === "overhead" && !overhead) continue;
          if (filter === "ground"   &&  overhead) continue;
          const x = Number(td?.x ?? 0);
          const y = Number(td?.y ?? 0);
          const w = Number(td?.width  ?? 0);
          const h = Number(td?.height ?? 0);
          if (this._segmentIntersectsRect(a.x, a.y, b.x, b.y, x, y, x + w, y + h)) n++;
        }
        return n;
      } catch (e) {
        console.warn("SD | tilesBetween failed:", e);
        return 0;
      }
    }

    if (token === "__visionLast") {
      try {
        return String(globalThis._SD_RUNTIME?.__visionLast ?? "");
      } catch { return ""; }
    }

    if (token === "__visionLastActors") {
      try {
        return String(globalThis._SD_RUNTIME?.__visionLastActors ?? "");
      } catch { return ""; }
    }

    if (token.startsWith("arrayAgg:")) {
      const parts = token.slice("arrayAgg:".length).split("|");
      if (parts.length < 3) return 0;
      const list = this._parseArrayList(this._resolveArrayArg(parts[0], doc));
      const path = String(this._resolveArrayArg(parts[1], doc) ?? "");
      const op   = String(this._resolveArrayArg(parts[2], doc) ?? "sum");
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
      const list = this._parseArrayList(this._resolveArrayArg(parts[0], doc));
      const path = String(this._resolveArrayArg(parts[1], doc) ?? "");
      const op   = String(this._resolveArrayArg(parts[2], doc) ?? "max");
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
      const list = this._parseArrayList(this._resolveArrayArg(parts[0], doc));
      const path = String(this._resolveArrayArg(parts[1], doc) ?? "");
      const op   = String(this._resolveArrayArg(parts[2], doc) ?? "desc");
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
      const list  = this._parseArrayList(this._resolveArrayArg(parts[0], doc));
      const start = Math.max(0, Math.floor(Number(this._resolveArrayArg(parts[1], doc)) || 0));
      const cnt   = Math.floor(Number(this._resolveArrayArg(parts[2], doc)));
      const end   = (cnt < 0) ? list.length : Math.min(list.length, start + cnt);
      return list.slice(start, end).join(",");
    }

    if (token.startsWith("arrayConcat:")) {
      const parts = token.slice("arrayConcat:".length).split("|");
      if (parts.length < 2) return "";
      const a = this._parseArrayList(this._resolveArrayArg(parts[0], doc));
      const b = this._parseArrayList(this._resolveArrayArg(parts[1], doc));
      return [...a, ...b].join(",");
    }

    if (token.startsWith("arrayUnion:")) {
      const parts = token.slice("arrayUnion:".length).split("|");
      if (parts.length < 2) return "";
      const a = this._parseArrayList(this._resolveArrayArg(parts[0], doc));
      const b = this._parseArrayList(this._resolveArrayArg(parts[1], doc));
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
      const a = this._parseArrayList(this._resolveArrayArg(parts[0], doc));
      const b = new Set(this._parseArrayList(this._resolveArrayArg(parts[1], doc)));
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
      const a = this._parseArrayList(this._resolveArrayArg(parts[0], doc));
      const b = new Set(this._parseArrayList(this._resolveArrayArg(parts[1], doc)));
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
      const list = new Set(this._parseArrayList(this._resolveArrayArg(parts[0], doc)));
      const id   = String(this._resolveArrayArg(parts.slice(1).join("|"), doc) ?? "").trim();
      return list.has(id) ? 1 : 0;
    }

    if (token.startsWith("arrayDistinct:")) {
      const rest = token.slice("arrayDistinct:".length);
      const list = this._parseArrayList(this._resolveArrayArg(rest, doc));
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
      const list   = this._parseArrayList(this._resolveArrayArg(parts[0], doc));
      const path   = String(this._resolveArrayArg(parts[1], doc) ?? "");
      const op     = String(this._resolveArrayArg(parts[2], doc) ?? "==");
      const cmpRaw = String(this._resolveArrayArg(parts.slice(3).join("|"), doc) ?? "");
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

    const _b64dec = (s) => {
      try { return decodeURIComponent(escape(atob(String(s ?? "")))); }
      catch { return String(s ?? ""); }
    };

    if (token.startsWith("arrayMake:")) {
      const rest = token.slice("arrayMake:".length);
      const parts = rest === "" ? [] : rest.split("|").map(part =>
        part.startsWith("b64:")
          ? this._resolveArrayArg(part, doc)
          : this._evalSideForCompare(_b64dec(part), doc)
      );

      return parts.filter(s => String(s).trim() !== "").join(",");
    }

    if (token.startsWith("arrayPush:")) {
      const rest = token.slice("arrayPush:".length);
      const sep  = rest.indexOf("|");
      if (sep < 0) return rest;
      const arrayRaw = rest.slice(0, sep);
      const elemRaw  = rest.slice(sep + 1);
      const list = this._parseArrayList(this._resolveArrayArg(arrayRaw, doc));
      const elem = elemRaw.startsWith("b64:")
        ? this._resolveArrayArg(elemRaw, doc)
        : this._evalSideForCompare(_b64dec(elemRaw), doc);
      if (String(elem).trim() !== "") list.push(String(elem));
      return list.join(",");
    }

    if (token.startsWith("arraySplit:")) {
      const rest = token.slice("arraySplit:".length);
      const sep  = rest.indexOf("|");
      if (sep < 0) return _b64dec(rest);
      const sourceRaw = rest.slice(0, sep);
      const sepRaw    = rest.slice(sep + 1);
      const s = sourceRaw.startsWith("b64:")
        ? this._resolveArrayArg(sourceRaw, doc)
        : this._evalSideForCompare(_b64dec(sourceRaw), doc);
      const sp = sepRaw.startsWith("b64:")
        ? this._resolveArrayArg(sepRaw, doc)
        : this._evalSideForCompare(_b64dec(sepRaw), doc);
      if (s == null || s === "") return "";
      const list = String(s).split(sp || ",").map(x => x.trim()).filter(Boolean);
      return list.join(",");
    }

    if (token.startsWith("arrayJoin:")) {
      const rest = token.slice("arrayJoin:".length);
      const sep  = rest.indexOf("|");
      if (sep < 0) return rest;
      const arrayRaw = rest.slice(0, sep);
      const sepRaw   = rest.slice(sep + 1);
      const list = this._parseArrayList(this._resolveArrayArg(arrayRaw, doc));
      const sp = sepRaw.startsWith("b64:")
        ? this._resolveArrayArg(sepRaw, doc)
        : this._evalSideForCompare(_b64dec(sepRaw), doc);
      return list.join(sp);
    }

    if (token.startsWith("arrayGet:")) {
      const parts = token.slice("arrayGet:".length).split("|");
      const list  = this._parseArrayList(this._resolveArrayArg(parts[0], doc));
      const idxN  = Math.floor(Number(this._resolveArrayArg(parts[1], doc)) || 0);
      const defRaw = parts.slice(2).join("|");
      const def = defRaw.startsWith("b64:")
        ? this._resolveArrayArg(defRaw, doc)
        : this._evalSideForCompare(_b64dec(defRaw), doc);
      const real  = idxN < 0 ? (list.length + idxN) : idxN;
      const v     = (real >= 0 && real < list.length) ? list[real] : undefined;
      return v ?? def ?? "";
    }

    if (token.startsWith("convertValue:")) {
      const parts = token.slice("convertValue:".length).split("|");
      const mode = String(parts[0] ?? "text").toLowerCase();
      const value = this._resolveArrayArg(parts[1] ?? "", doc);
      if (mode === "number") {
        const n = Number(value);
        if (value !== "" && value !== null && value !== undefined && Number.isFinite(n)) return n;
        const fallback = Number(this._resolveArrayArg(parts[2] ?? "", doc));
        return Number.isFinite(fallback) ? fallback : 0;
      }
      if (mode === "boolean") {
        const s = String(value ?? "").trim().toLowerCase();
        return (!["", "0", "false", "no", "off", "null", "undefined"].includes(s)) ? 1 : 0;
      }
      if (mode === "array") {
        if (Array.isArray(value)) return value.join(",");
        const s = String(value ?? "").trim();
        if (!s) return "";
        if (s.startsWith("[") && s.endsWith("]")) {
          try { const parsed = JSON.parse(s); if (Array.isArray(parsed)) return parsed.map(v => String(v ?? "")).join(","); } catch {}
        }
        return this._parseArrayList(s).join(",");
      }
      if (mode === "valid") {
        const s = String(value ?? "").trim().toLowerCase();
        return (value !== null && value !== undefined && !["", "null", "undefined"].includes(s) && !s.startsWith("!err")) ? 1 : 0;
      }
      return String(value ?? "");
    }

    if (token.startsWith("targetUuids:")) {
      return this._collectTargetUuids(token.slice("targetUuids:".length), doc).join(",");
    }

    if (token.startsWith("targetCount:")) {
      return this._collectTargetUuids(token.slice("targetCount:".length), doc).length;
    }

    if (token.startsWith("targetFirst:")) {
      return this._collectTargetUuids(token.slice("targetFirst:".length), doc)[0] ?? "";
    }

    if (token.startsWith("targetFields:")) {
      const rest = token.slice("targetFields:".length);
      const sep  = rest.indexOf("|");
      const mode = sep < 0 ? rest : rest.slice(0, sep);
      const path = sep < 0 ? "" : this._b64decodeUtf8(rest.slice(sep + 1));
      return this._collectTargetUuids(mode, doc)
        .map(u => { const v = this._readDocField(this._docByUuidSync(u), path); return v == null ? "" : v; })
        .join(",");
    }

    if (token.startsWith("uuidField:")) {
      const parts = token.slice("uuidField:".length).split("|");
      let arrRaw = String(this._resolveArrayArg(parts[0] ?? "", doc) ?? "").trim();
      if (/^(targets|selected|both|all_targets)$/.test(arrRaw)) arrRaw = this._collectTargetUuids(arrRaw).join(",");
      if (arrRaw === "self" || arrRaw === "actor") arrRaw = this._actorFor(doc)?.uuid ?? "";
      const list = this._parseArrayList(arrRaw);
      const idxN = Math.floor(Number(this._resolveArrayArg(parts[1] ?? "", doc)) || 0);
      const real = idxN < 0 ? list.length + idxN : idxN;
      const uuid = (real >= 0 && real < list.length) ? list[real] : (list.length === 1 ? list[0] : "");
      const path = this._b64decodeUtf8(parts.slice(2).join("|"));
      return this._readDocField(this._docByUuidSync(uuid), path);
    }

    if (token.startsWith("uuidsMapField:")) {
      const rest = token.slice("uuidsMapField:".length);
      const sep  = rest.lastIndexOf("|");
      let arrRaw = String(this._resolveArrayArg(sep < 0 ? rest : rest.slice(0, sep), doc) ?? "").trim();
      if (/^(targets|selected|both|all_targets)$/.test(arrRaw)) arrRaw = this._collectTargetUuids(arrRaw).join(",");
      const path = sep < 0 ? "" : this._b64decodeUtf8(rest.slice(sep + 1));
      return this._parseArrayList(arrRaw)
        .map(u => { const v = this._readDocField(this._docByUuidSync(u), path); return v == null ? "" : v; })
        .join(",");
    }

    if (token.startsWith("actorNameField:")) {
      const parts = token.slice("actorNameField:".length).split("|");
      const name  = String(this._resolveArrayArg(parts[0] ?? "", doc) ?? "").trim();
      const idxN  = Math.floor(Number(this._resolveArrayArg(parts[1] ?? "", doc)) || 0);
      const path  = this._b64decodeUtf8(parts.slice(2).join("|"));
      const matches = (game?.actors?.contents ?? []).filter(a => a?.name === name);
      const real = idxN < 0 ? matches.length + idxN : idxN;
      const a = matches[real] ?? matches[0] ?? null;
      return this._readDocField(a, path);
    }

    if (token.startsWith("arrayHasIndex:")) {
      const parts = token.slice("arrayHasIndex:".length).split("|");
      const list  = this._parseArrayList(this._resolveArrayArg(parts[0], doc));
      const idxN  = Math.floor(Number(this._resolveArrayArg(parts[1], doc)) || 0);
      const real  = idxN < 0 ? (list.length + idxN) : idxN;
      return (real >= 0 && real < list.length) ? 1 : 0;
    }

    if (token.startsWith("arrayReverse:")) {
      const list = this._parseArrayList(this._resolveArrayArg(token.slice("arrayReverse:".length), doc));
      return list.reverse().join(",");
    }

    if (token.startsWith("arrayNum:")) {
      const rest = token.slice("arrayNum:".length);
      const sep  = rest.lastIndexOf("|");
      if (sep < 0) return 0;
      const list = this._parseArrayList(this._resolveArrayArg(rest.slice(0, sep), doc));
      const op   = String(this._resolveArrayArg(rest.slice(sep + 1), doc) ?? "sum");
      const nums = list.map(Number).filter(n => !isNaN(n));
      if (op === "count") return nums.length;
      if (!nums.length)   return 0;
      if (op === "sum")   return nums.reduce((s,n)=>s+n,0);
      if (op === "avg")   return nums.reduce((s,n)=>s+n,0) / nums.length;
      if (op === "min")   return Math.min(...nums);
      if (op === "max")   return Math.max(...nums);
      return 0;
    }

    if (token.startsWith("arrayRandomPick:")) {
      const parts = token.slice("arrayRandomPick:".length).split("|");
      const list  = this._parseArrayList(this._resolveArrayArg(parts[0], doc));
      const cnt   = Math.max(0, Math.floor(this._parseArrayNum(this._resolveArrayArg(parts[1], doc), 0)));
      if (!list.length || cnt <= 0) return "";

      const arr = list.slice();
      for (let i = arr.length - 1; i > arr.length - 1 - cnt && i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      const picked = arr.slice(Math.max(0, arr.length - cnt));
      if (cnt === 1) return picked[0] ?? "";
      return picked.join(",");
    }

    if (token.startsWith("arrayRandomFrom:")) {

      const parts = token.slice("arrayRandomFrom:".length).split("|");
      const cnt   = Math.max(0, Math.floor(this._parseArrayNum(this._resolveArrayArg(parts[0], doc), 0)));
      const pool  = [];
      for (let k = 1; k < parts.length; k++) {
        const seg = this._parseArrayList(this._resolveArrayArg(parts[k], doc));
        for (const el of seg) pool.push(el);
      }
      if (!pool.length || cnt <= 0) return "";

      const arr  = pool.slice();
      const pick = Math.min(cnt, arr.length);
      for (let i = arr.length - 1; i > arr.length - 1 - pick && i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr.slice(arr.length - pick).join(",");
    }

    if (token.startsWith("arrayFilterGeneric:")) {
      const parts = token.slice("arrayFilterGeneric:".length).split("|");
      const list  = this._parseArrayList(this._resolveArrayArg(parts[0], doc));
      const op    = String(this._resolveArrayArg(parts[1], doc) ?? "==");
      const cmpRaw = parts.slice(2).join("|");
      const cmp = cmpRaw.startsWith("b64:")
        ? this._resolveArrayArg(cmpRaw, doc)
        : this._evalSideForCompare(_b64dec(cmpRaw), doc);
      const cmpN  = Number(cmp);
      const isNum = String(cmp).trim() !== "" && !isNaN(cmpN);
      const out   = [];
      for (const el of list) {
        const lvN = Number(el);
        const lvOk = !isNaN(lvN);
        let ok = false;
        switch (op) {
          case "==":  ok = isNum && lvOk ? (lvN === cmpN) : (String(el) === String(cmp)); break;
          case "!=":  ok = isNum && lvOk ? (lvN !== cmpN) : (String(el) !== String(cmp)); break;
          case ">":   ok = lvOk && isNum && (lvN >  cmpN); break;
          case "<":   ok = lvOk && isNum && (lvN <  cmpN); break;
          case ">=":  ok = lvOk && isNum && (lvN >= cmpN); break;
          case "<=":  ok = lvOk && isNum && (lvN <= cmpN); break;
          case "contains":   ok = String(el).includes(String(cmp)); break;
          case "startsWith": ok = String(el).startsWith(String(cmp)); break;
          case "endsWith":   ok = String(el).endsWith(String(cmp)); break;
          default:    ok = false;
        }
        if (ok) out.push(el);
      }
      return out.join(",");
    }

    if (token.startsWith("arrayMapFormula:")) {
      const rest = token.slice("arrayMapFormula:".length);
      const sep  = rest.indexOf("|");
      if (sep < 0) return "";
      const list = this._parseArrayList(this._resolveArrayArg(rest.slice(0, sep), doc));
      const formulaRaw = rest.slice(sep + 1);
      const formula = formulaRaw.startsWith("b64:")
        ? this._resolveArrayArg(formulaRaw, doc, { template: true })
        : this._resolveArrayTemplate(_b64dec(formulaRaw), doc);
      const out = [];
      for (let i = 0; i < list.length; i++) {
        const el = list[i];
        const f = String(formula)
          .replace(/\{__elem\}/g, String(el))
          .replace(/\{__elemIndex\}/g, String(i));
        try {
          const v = this.evaluate(f, doc);
          out.push(v === undefined || v === null ? "" : String(v));
        } catch {
          out.push("");
        }
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

    if (token.startsWith("questGet:")) {
      const rest  = token.slice("questGet:".length);
      const parts = rest.split(":");
      const prop  = parts[0] ?? "";
      const qid   = parts[1] ?? "";
      const sid   = parts[2] ?? "";

      if (qid === "__SDQ_THIS__" || sid === "__SDQ_THIS_SUB__") return "";
      let log = (doc instanceof Item && doc.type === "questlog") ? doc : null;
      if (!log) {
        const a = (doc instanceof Actor) ? doc : doc?.actor;
        if (a) {
          log = (a.items?.contents ?? []).find(i => i.type === "questlog") ?? null;
        }
      }
      if (!log) return "";
      const quest = (log.system?.quests ?? []).find(q => q?.id === qid);
      if (!quest) return "";
      switch (prop) {
        case "status":      return String(quest.status ?? "");
        case "isCompleted": return quest.status === "completed" ? 1 : 0;
        case "isFailed":    return quest.status === "failed"    ? 1 : 0;
        case "isActive":    return quest.status === "active"    ? 1 : 0;
        case "subtaskDone": {
          const s = (quest.subtasks ?? []).find(x => x?.id === sid);
          return s?.done ? 1 : 0;
        }
      }
      return "";
    }

    if (token.startsWith("sdActorOnScene:")) {
      const ref = token.slice("sdActorOnScene:".length).trim();
      const scene = game.scenes?.viewed ?? null;
      if (!scene) return 0;
      let actorId = "";
      let a = game.actors?.get(ref);
      if (!a && ref) a = (game.actors?.contents ?? []).find(x => x.name === ref) ?? null;
      if (a) actorId = a.id;
      if (!actorId) return 0;
      const tokens = scene.tokens?.contents ?? [];
      for (const t of tokens) {
        if (t.actorId === actorId) return 1;
        if (t.actor?.id === actorId) return 1;
      }
      return 0;
    }

    if (token.startsWith("sdFieldEq:")) {
      const rest = token.slice("sdFieldEq:".length);
      const [propPart, refPart, pathPart, expPart] = rest.split("|");
      const prop = propPart ?? "eq";
      const ref  = (refPart ?? "").trim();
      const path = (pathPart ?? "").trim();
      const exp  = expPart ?? "";

      let target = null;
      if (!ref) {
        target = game.user?.character ?? null;
      } else {
        target = game.actors?.get(ref) ?? null;
        if (!target) target = (game.actors?.contents ?? []).find(x => x.name === ref) ?? null;
      }
      if (!target || !path) return prop === "raw" ? "" : 0;
      const val = foundry.utils.getProperty(target, path);
      if (prop === "raw") return val === undefined || val === null ? "" : String(val);
      return String(val ?? "") === String(exp ?? "") ? 1 : 0;
    }

    if (token.startsWith("currentUser:")) {
      const prop = token.slice("currentUser:".length);
      const u = game.user;
      if (!u) return "";
      switch (prop) {
        case "id":   return String(u.id ?? "");
        case "name": return String(u.name ?? "");
        case "role": {
          const role = u.role ?? 0;
          if (u.isGM) return "gm";
          if (role >= 3) return "trusted";
          if (role >= 1) return "player";
          return "none";
        }
        case "isGM": return u.isGM ? 1 : 0;
      }
      return "";
    }

    if (token.startsWith("combat:")) {
      const prop = token.slice("combat:".length);
      const combat = (typeof game !== "undefined") ? game?.combat : null;
      if (!combat) {
        if (prop === "active" || prop === "started") return 0;
        if (prop === "round" || prop === "turn") return 0;
        return "";
      }
      switch (prop) {
        case "active":
        case "started":     return combat.started ? 1 : 0;
        case "round":       return Number(combat.round ?? 0);
        case "turn":        return Number(combat.turn ?? 0);
        case "combatantId": return combat.turns?.[combat.turn ?? 0]?.id ?? "";
        case "actorId":     return combat.turns?.[combat.turn ?? 0]?.actorId ?? "";
        case "actorName": {
          const a = combat.turns?.[combat.turn ?? 0]?.actor;
          return a?.name ?? "";
        }
        case "turnCount":   return combat.turns?.length ?? 0;
        case "id":          return combat.id ?? "";
        default:            return "";
      }
    }

    if (token.startsWith("compendium:")) {
      const rest = token.slice("compendium:".length);
      const sep  = rest.indexOf("|");
      const packId = (sep >= 0 ? rest.slice(0, sep) : rest).trim();
      const prop   = sep >= 0 ? rest.slice(sep + 1).trim() : "uuids";
      if (!packId) return prop === "count" ? 0 : "";
      const pack = (typeof game !== "undefined") ? game?.packs?.get?.(packId) : null;
      if (!pack) return prop === "count" ? 0 : "";
      const index = pack.index?.contents ?? [];
      switch (prop) {
        case "uuids":
        case "uuid":  return index.map(e => e.uuid ?? `${pack.collection}.${e._id}`).filter(Boolean).join(",");
        case "ids":
        case "id":    return index.map(e => e._id ?? e.id).filter(Boolean).join(",");
        case "names":
        case "name":  return index.map(e => e.name ?? "").filter(Boolean).join(",");
        case "count":
        case "length":return index.length;
        case "types":
        case "type":  return index.map(e => e.type ?? "").filter(Boolean).join(",");
        default:      return "";
      }
    }

    if (token.startsWith("itemMapField:")) {
      const rest = token.slice("itemMapField:".length);
      const sep  = rest.indexOf("|");
      if (sep < 0) return "";
      const list = this._parseArrayList(rest.slice(0, sep));
      const path = rest.slice(sep + 1);
      if (!path) return "";
      const out = [];
      for (const ref of list) {
        const it = this._resolveItemRef(ref, doc);
        if (!it) { out.push(""); continue; }
        const v = foundry.utils.getProperty(it, path);
        out.push(v === undefined || v === null || typeof v === "object" ? "" : String(v));
      }
      return out.join(",");
    }

    if (token.startsWith("itemNames:")) {
      const list = this._parseArrayList(token.slice("itemNames:".length));
      const out = [];
      for (const ref of list) {
        const it = this._resolveItemRef(ref, doc);
        out.push(it?.name ?? "");
      }
      return out.join(",");
    }

    if (token.startsWith("itemAgg:")) {
      const parts = token.slice("itemAgg:".length).split("|");
      if (parts.length < 3) return 0;
      const list = this._parseArrayList(parts[0]);
      const path = parts[1];
      const op   = parts[2];
      const nums = [];
      for (const ref of list) {
        const it = this._resolveItemRef(ref, doc);
        if (!it) continue;
        const v = Number(foundry.utils.getProperty(it, path));
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

    if (token.startsWith("itemFilter:")) {
      const parts  = token.slice("itemFilter:".length).split("|");
      if (parts.length < 4) return "";
      const list   = this._parseArrayList(parts[0]);
      const path   = parts[1];
      const op     = parts[2];
      const cmpRaw = parts.slice(3).join("|");
      const cmpNum = Number(cmpRaw);
      const isNum  = cmpRaw.trim() !== "" && !isNaN(cmpNum);
      const out = [];
      for (const ref of list) {
        const it = this._resolveItemRef(ref, doc);
        if (!it) continue;
        const fv = foundry.utils.getProperty(it, path);
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
          case "contains":   ok = String(fv).includes(String(cmpRaw)); break;
          case "startsWith": ok = String(fv).startsWith(String(cmpRaw)); break;
          case "endsWith":   ok = String(fv).endsWith(String(cmpRaw)); break;
          default:   ok = false;
        }
        if (ok) out.push(ref);
      }
      return out.join(",");
    }

    if (token.startsWith("itemSort:")) {
      const parts = token.slice("itemSort:".length).split("|");
      if (parts.length < 3) return "";
      const list = this._parseArrayList(parts[0]);
      const path = parts[1];
      const op   = parts[2];
      const annotated = list.map(ref => {
        const it = this._resolveItemRef(ref, doc);
        const v  = it ? Number(foundry.utils.getProperty(it, path)) : NaN;
        return { ref, v: isNaN(v) ? null : v };
      });
      annotated.sort((x, y) => {
        if (x.v === null && y.v === null) return 0;
        if (x.v === null) return  1;
        if (y.v === null) return -1;
        return op === "asc" ? (x.v - y.v) : (y.v - x.v);
      });
      return annotated.map(e => e.ref).join(",");
    }

    if (token.startsWith("itemFindExtreme:")) {
      const parts = token.slice("itemFindExtreme:".length).split("|");
      if (parts.length < 3) return "";
      const list = this._parseArrayList(parts[0]);
      const path = parts[1];
      const op   = parts[2];
      let best  = "";
      let bestV = null;
      for (const ref of list) {
        const it = this._resolveItemRef(ref, doc);
        if (!it) continue;
        const v = Number(foundry.utils.getProperty(it, path));
        if (isNaN(v)) continue;
        if (bestV === null || (op === "min" ? v < bestV : v > bestV)) {
          bestV = v;
          best  = ref;
        }
      }
      return best;
    }

    if (token.startsWith("__")) {
      return 0;
    }

    if (token.startsWith("@")) {
      const key    = token.slice(1);
      const rd     = (doc instanceof Actor ? doc : doc.actor)?.getRollData?.() ?? {};
      return foundry.utils.getProperty(rd, key) ?? 0;
    }

    if (token === "random") return Math.random();

    const val = this._asScalar(this._readDocProperty(doc, token));
    if (val !== undefined && val !== null && typeof val !== "object") return val;
    const _actor2 = (doc instanceof Actor) ? null : (doc?.actor ?? null);
    if (_actor2) {
      const val2 = this._asScalar(this._readDocProperty(_actor2, token));
      if (val2 !== undefined && val2 !== null && typeof val2 !== "object") return val2;
    }
    if (val !== undefined && val !== null) return 0;
    return 0;
  }

  static _evalMath(expr) {
    let e = expr
      .replace(/\brandom\b/g, "Math.random()")
      .replace(/floor\s*\(/g, "Math.floor(")
      .replace(/ceil\s*\(/g,  "Math.ceil(")
      .replace(/round\s*\(/g, "Math.round(")
      .replace(/abs\s*\(/g,   "Math.abs(")
      .replace(/max\s*\(/g,   "Math.max(")
      .replace(/min\s*\(/g,   "Math.min(");

    {
      let depth = 0, inStr = null, hasTopComma = false;
      for (let i = 0; i < e.length; i++) {
        const ch = e[i];
        if (inStr) {
          if (ch === "\\") { i++; continue; }
          if (ch === inStr) inStr = null;
          continue;
        }
        if (ch === '"' || ch === "'") { inStr = ch; continue; }
        if (ch === "(") depth++;
        else if (ch === ")") depth = Math.max(0, depth - 1);
        else if (ch === "," && depth === 0) { hasTopComma = true; break; }
      }
      if (hasTopComma) return e;
    }

    const isNumericMath = !/[^0-9+\-*/()., %MathflorceiabsundxNm\s?:<>!=&|]/.test(e);
    const hasStrings = e.includes('"') || e.includes("'");

    if (!isNumericMath && !hasStrings) {
      return e;
    }

    try {

      const result = Function(`"use strict"; return (${e})`)();
      if (typeof result === "number" && isFinite(result)) return result;
      if (typeof result === "boolean") return result;
      if (typeof result === "string") return result;
      return e;
    } catch {
      return e;
    }
  }

  static _unquoteSimple(s) {
    if (typeof s !== "string") return s;
    const t = s.trim();
    if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
      try { return JSON.parse(t); } catch { return t.slice(1, -1); }
    }
    return t;
  }

  static _resolveTokenObject(ref, doc) {
    if (!ref) ref = "self";
    const r = String(ref).trim();
    try {
      if (r === "self" || r === "actor") {
        const actor = (doc?.documentName === "Actor") ? doc : (doc?.actor ?? null);
        if (!actor) return null;
        return actor.getActiveTokens?.()?.[0] ?? null;
      }
      if (r === "selected_token") {
        return canvas?.tokens?.controlled?.[0] ?? null;
      }
      if (r === "token_target") {
        return [...(game.user?.targets ?? [])][0] ?? null;
      }
      if (r === "user_character") {
        const ac = game.user?.character;
        return ac?.getActiveTokens?.()?.[0] ?? null;
      }
      if (/^(Actor|Scene|Item|Token|Compendium)\.[A-Za-z0-9._-]+/.test(r)) {
        try {
          const d = (typeof fromUuidSync === "function") ? fromUuidSync(r) : null;
          if (d?.documentName === "Token") return d.object ?? canvas?.tokens?.get?.(d.id) ?? null;
          if (d?.documentName === "Actor") return d.getActiveTokens?.()?.[0] ?? null;
          if (d?.actor) return d.actor.getActiveTokens?.()?.[0] ?? null;
        } catch {}
      }
      const tk = canvas?.tokens?.get?.(r);
      if (tk) return tk;
      const a = game?.actors?.get?.(r);
      if (a) return a.getActiveTokens?.()?.[0] ?? null;
    } catch (e) {
      console.warn("SD | _resolveTokenObject failed:", e);
    }
    return null;
  }

  static _wallMatchesType(wallDoc, type) {
    if (!wallDoc) return false;
    const move  = Number(wallDoc.move  ?? wallDoc.movement ?? 0);
    const sight = Number(wallDoc.sight ?? 0);
    const sound = Number(wallDoc.sound ?? 0);
    const door  = Number(wallDoc.door  ?? 0);
    const ds    = Number(wallDoc.ds    ?? 0);
    if (door > 0 && ds === 1) return false;
    switch (String(type)) {
      case "any":   return move !== 0 || sight !== 0 || sound !== 0;
      case "sight": return sight !== 0;
      case "sound": return sound !== 0;
      case "move":
      default:      return move !== 0;
    }
  }

  static _segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
    const d1x = bx - ax, d1y = by - ay;
    const d2x = dx - cx, d2y = dy - cy;
    const denom = d1x * d2y - d1y * d2x;
    if (Math.abs(denom) < 1e-9) return false;
    const t = ((cx - ax) * d2y - (cy - ay) * d2x) / denom;
    const u = ((cx - ax) * d1y - (cy - ay) * d1x) / denom;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1;
  }

  static _segmentIntersectsRect(ax, ay, bx, by, x1, y1, x2, y2) {
    const inside = (px, py) => px >= x1 && px <= x2 && py >= y1 && py <= y2;
    if (inside(ax, ay) || inside(bx, by)) return true;
    if (this._segmentsIntersect(ax, ay, bx, by, x1, y1, x2, y1)) return true;
    if (this._segmentsIntersect(ax, ay, bx, by, x2, y1, x2, y2)) return true;
    if (this._segmentsIntersect(ax, ay, bx, by, x2, y2, x1, y2)) return true;
    if (this._segmentsIntersect(ax, ay, bx, by, x1, y2, x1, y1)) return true;
    return false;
  }
}

export const BLUEPRINT_NODES = [

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

  { cat: "Sources", id: "actor_data",  label: "Derived Actor Value",     icon: "fa-user",            color: "#5a8ae0",
    syntax: "{@attr1}",                hint: "Actor roll data shorthand (@attr1, @level…)",
    desc: "Uses Foundry roll data shorthands: @attr1=attr1.mod, @level, @prof." },

  { cat: "Dice", id: "d4",   label: "d4",   icon: "fa-dice-d6",  color: "#e0a85a", syntax: "1d4",   hint: "Roll a d4" },
  { cat: "Dice", id: "d6",   label: "d6",   icon: "fa-dice-d6",  color: "#e0a85a", syntax: "1d6",   hint: "Roll a d6" },
  { cat: "Dice", id: "d8",   label: "d8",   icon: "fa-dice",     color: "#e0a85a", syntax: "1d8",   hint: "Roll a d8" },
  { cat: "Dice", id: "d10",  label: "d10",  icon: "fa-dice",     color: "#e0a85a", syntax: "1d10",  hint: "Roll a d10" },
  { cat: "Dice", id: "d12",  label: "d12",  icon: "fa-dice",     color: "#e0a85a", syntax: "1d12",  hint: "Roll a d12" },
  { cat: "Dice", id: "d20",  label: "d20",  icon: "fa-dice-d20", color: "#e0a85a", syntax: "1d20",  hint: "Roll a d20" },
  { cat: "Dice", id: "d100", label: "d100", icon: "fa-dice",     color: "#e0a85a", syntax: "1d100", hint: "Roll percentile" },

  { cat: "Math", id: "add",   label: "Add",      icon: "fa-plus",        color: "#5ae07a", syntax: " + ",             hint: "Addition" },
  { cat: "Math", id: "sub",   label: "Subtract", icon: "fa-minus",       color: "#5ae07a", syntax: " - ",             hint: "Subtraction" },
  { cat: "Math", id: "mul",   label: "Multiply", icon: "fa-xmark",       color: "#5ae07a", syntax: " * ",             hint: "Multiplication" },
  { cat: "Math", id: "div",   label: "Divide",   icon: "fa-divide",      color: "#5ae07a", syntax: " / ",             hint: "Division" },
  { cat: "Math", id: "floor", label: "Floor",    icon: "fa-arrow-down",  color: "#5ae07a", syntax: "floor({|cursor|})", hint: "Round down" },
  { cat: "Math", id: "ceil",  label: "Ceil",     icon: "fa-arrow-up",    color: "#5ae07a", syntax: "ceil({|cursor|})",  hint: "Round up" },
  { cat: "Math", id: "round", label: "Round",    icon: "fa-arrows-up-down", color: "#5ae07a", syntax: "round({|cursor|})", hint: "Round to nearest" },
  { cat: "Math", id: "max",   label: "Max",      icon: "fa-angle-up",    color: "#5ae07a", syntax: "max({|cursor|}, 0)", hint: "Maximum of two values" },
  { cat: "Math", id: "min",   label: "Min",      icon: "fa-angle-down",  color: "#5ae07a", syntax: "min({|cursor|}, 0)", hint: "Minimum of two values" },
  { cat: "Math", id: "abs",   label: "Absolute",      icon: "fa-circle",      color: "#5ae07a", syntax: "abs({|cursor|})",    hint: "Absolute value" },

  { cat: "Compare", id: "eq",  label: "Equals",     icon: "fa-equals",    color: "#ee68ee", syntax: " == ", hint: "Equal to" },
  { cat: "Compare", id: "neq", label: "Not Equal",  icon: "fa-not-equal", color: "#ee68ee", syntax: " != ", hint: "Not equal to" },
  { cat: "Compare", id: "gt",  label: "Greater >",  icon: "fa-chevron-right", color: "#ee68ee", syntax: " > ", hint: "Greater than" },
  { cat: "Compare", id: "lt",  label: "Less <",     icon: "fa-chevron-left",  color: "#ee68ee", syntax: " < ", hint: "Less than" },
  { cat: "Compare", id: "gte", label: "Greater >=", icon: "fa-chevron-right", color: "#ee68ee", syntax: " >= ", hint: "Greater or equal" },
  { cat: "Compare", id: "lte", label: "Less <=",    icon: "fa-chevron-left",  color: "#ee68ee", syntax: " <= ", hint: "Less or equal" },

  { cat: "Logic", id: "if_else", label: "If/Else", icon: "fa-code-branch",  color: "#e05a5a",
    syntax: "({condition} ? {true_val} : {false_val})",   hint: "Ternary — if condition then value_a else value_b",
    desc: "Returns true_val if condition is truthy, otherwise false_val." },
];

export const BLUEPRINT_CATS = ["Sources", "Dice", "Math", "Compare", "Logic"];
