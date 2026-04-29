import { SlotManager } from "../data/item-slots.mjs";

function _sdMsgMode() {
  try {
    const v = game.settings.get("core", "messageMode");
    if (v) return v;
  } catch {}
  try { return game.settings.get("core", "rollMode"); } catch {}
  return "publicroll";
}


const { StringField, NumberField, BooleanField, ArrayField, ObjectField, SchemaField } = foundry.data.fields;

// Помощники вложенных слотов
function _resolveNestedSlotParent(actor, item, slotPath) {
  if (!slotPath) return null;
  const parts = slotPath.split("/");
  if (parts.length < 2) return null;

  // Корневой сегмент
  let current;
  const root = parts[0];
  if (root === "actor") {
    current = actor ?? null;
  } else if (root === "self") {
    current = item ?? actor ?? null;
  } else {
    current = actor?.items.get(root) ?? null;
    if (!current && item?.id === root) current = item;
  }
  if (!current) return null;

  if (parts.length === 2) {
    const isLive = typeof current?.update === "function";
    return { parent: current, slotId: parts[1], liveAncestor: isLive ? current : null, snapshotChain: [] };
  }

  const liveAncestor = typeof current?.update === "function" ? current : null;
  const snapshotChain = [];

  for (let i = 1; i + 1 < parts.length; i += 2) {
    const sid      = parts[i];
    const nestedId = parts[i + 1];
    const contents = current.system?.slotContents?.[sid]?.contents ?? [];
    CONFIG.debug?.sd && console.log("[SD|nested]",`  step [${i}] slotId="${sid}" nestedId="${nestedId}" contents.length=${contents.length}`, contents.map(c=>c._id??c.name));
    const snap     = contents.find(c => (c._id ?? c.id) === nestedId) ?? null;
    if (!snap) { console.warn("[SD|nested]",`  step [${i}] snapshot NOT FOUND for nestedId="${nestedId}" in slot "${sid}"`); return null; }
    CONFIG.debug?.sd && console.log("[SD|nested]",`  step [${i}] found snapshot:`, snap.name ?? snap._id);
    snapshotChain.push({ slotId: sid, itemId: nestedId });
    current = snap;
  }

  CONFIG.debug?.sd && console.log("[SD|nested]","_resolveNestedSlotParent result | parent:", current?.name ?? current?._id, "| slotId:", parts[parts.length-1], "| liveAncestor:", liveAncestor?.name ?? liveAncestor?.id, "| chain:", JSON.stringify(snapshotChain));
  return { parent: current, slotId: parts[parts.length - 1], liveAncestor, snapshotChain };
}

async function _nestedRemoveFromSlot(resolved, slotId, index) {
  const { parent, liveAncestor, snapshotChain } = resolved;
  const SM = (await import("../data/item-slots.mjs")).SlotManager;
  const actor = liveAncestor?.parent ?? liveAncestor?.actor ?? null;

  if (snapshotChain.length > 0 && actor) {
    const lastStep = snapshotChain[snapshotChain.length - 1];
    const liveParent = actor.items.get(lastStep.itemId) ?? null;
    if (liveParent) {
      CONFIG.debug?.sd && console.log("[SD|nested]", "_nestedRemoveFromSlot | via live item:", liveParent.name, "slot:", slotId, "index:", index);
      return SM.removeFromSlot(liveParent, slotId, index);
    }
  }

  if (typeof parent?.update === "function") {
    return SM.removeFromSlot(parent, slotId, index);
  }

  if (!liveAncestor) { console.error("SD | nestedRemoveFromSlot: no liveAncestor"); return; }
  const cloned = foundry.utils.deepClone(liveAncestor.system.slotContents ?? {});
  let node = cloned;
  for (const step of snapshotChain) {
    const snap = (node[step.slotId]?.contents ?? []).find(c => (c._id ?? c.id) === step.itemId);
    if (!snap) { console.error("SD | nestedRemoveFromSlot: snapshot not found at", step); return; }
    if (!snap.system) snap.system = {};
    if (!snap.system.slotContents) snap.system.slotContents = {};
    node = snap.system.slotContents;
  }
  if (!node[slotId]) { console.error("SD | nestedRemoveFromSlot: slot not found:", slotId); return; }
  const contents = node[slotId].contents ?? [];
  contents.splice(index, 1);
  node[slotId].contents = contents;
  node[slotId].count    = contents.length;
  await liveAncestor.update({ "system.slotContents": cloned });
}

async function _nestedAddToSlot(resolved, slotId, srcItem) {
  const { parent, liveAncestor, snapshotChain } = resolved;
  const SM = (await import("../data/item-slots.mjs")).SlotManager;
  const actor = liveAncestor?.parent ?? liveAncestor?.actor ?? null;

  if (snapshotChain.length > 0 && actor) {
    const lastStep = snapshotChain[snapshotChain.length - 1];
    const liveParent = actor.items.get(lastStep.itemId) ?? null;
    if (liveParent) {
      CONFIG.debug?.sd && console.log("[SD|nested]", "_nestedAddToSlot | via live item:", liveParent.name, "slot:", slotId);
      return SM.addToSlot(liveParent, slotId, srcItem);
    }
  }

  if (typeof parent?.update === "function") {
    return SM.addToSlot(parent, slotId, srcItem);
  }

  if (!liveAncestor) { console.error("SD | nestedAddToSlot: no liveAncestor"); return; }
  const cloned = foundry.utils.deepClone(liveAncestor.system.slotContents ?? {});
  let node = cloned;
  for (const step of snapshotChain) {
    const snap = (node[step.slotId]?.contents ?? []).find(c => (c._id ?? c.id) === step.itemId);
    if (!snap) { console.error("SD | nestedAddToSlot: snapshot not found at", step); return; }
    if (!snap.system) snap.system = {};
    if (!snap.system.slotContents) snap.system.slotContents = {};
    node = snap.system.slotContents;
  }
  if (!node[slotId]) node[slotId] = { contents: [], count: 0 };
  const itemData = srcItem instanceof Item ? srcItem.toObject() : foundry.utils.deepClone(srcItem);
  if (srcItem instanceof Item && srcItem.uuid) itemData._sourceUuid = srcItem.uuid;
  node[slotId].contents.push(itemData);
  node[slotId].count = node[slotId].contents.length;
  await liveAncestor.update({ "system.slotContents": cloned });
}


export function ButtonConditionField() {
  return new SchemaField({
    type:     new StringField({ initial: "always", blank: false }),
    field:    new StringField({ initial: "", blank: true }),
    // Operator: > < >= <= == != 
    operator: new StringField({ initial: ">", blank: false }),
    value:    new StringField({ initial: "0", blank: true }),
    slotId:   new StringField({ initial: "", blank: true }),
    minCount: new NumberField({ required: false, integer: true, initial: 0, nullable: true }),
    // Инверсия
    negate:   new BooleanField({ initial: false })
  });
}

export function ButtonActionField() {
  return new SchemaField({
    type:     new StringField({ initial: "roll", choices: ["roll","modifyField","createItem","removeItem","playSound","runMacro","message"], blank: false }),
    // roll
    formula:  new StringField({ initial: "1d6", blank: true }),
    flavor:   new StringField({ initial: "", blank: true }),
    rollMode: new StringField({ initial: "publicroll", blank: true }),
    // modifyField
    target:   new StringField({ initial: "self.system.uses.value", blank: true }),
    delta:    new NumberField({ required: false, integer: false, initial: -1, nullable: true }),
    setValue: new StringField({ initial: "", blank: true }),
    clampMin: new NumberField({ required: false, integer: false, initial: null, nullable: true }),
    clampMax: new NumberField({ required: false, integer: false, initial: null, nullable: true }),
    // createItem / removeItem
    itemName:     new StringField({ initial: "", blank: true }),
    itemType:     new StringField({ initial: "inventory", blank: true }),
    itemCategory: new StringField({ initial: "", blank: true }),
    itemData:     new ObjectField(),
    // playSound
    soundPath: new StringField({ initial: "", blank: true }),
    // runMacro
    macroName: new StringField({ initial: "", blank: true }),
    // message
    messageText: new StringField({ initial: "", blank: true }),
    delay: new NumberField({ required: false, integer: true, initial: 0, nullable: true })
  });
}

export function ButtonDefinitionField() {
  return new SchemaField({
    id:       new StringField({ required: true, blank: false, initial: () => foundry.utils.randomID(8) }),
    label:    new StringField({ initial: "Action", blank: false }),
    icon:     new StringField({ initial: "fa-dice", blank: true }),
    color:    new StringField({ initial: "#7b68ee", blank: true }),
    tooltip:  new StringField({ initial: "", blank: true }),
    showIn:   new StringField({ initial: "inline", choices: ["inline","sheet","both"], blank: false }),
    conditions:   new ArrayField(ButtonConditionField()),
    actions: new ArrayField(ButtonActionField())
  });
}

// Вычисление условий

export class ConditionEvaluator {

  /**
   * Evaluate all conditions on a button.
   * @returns {boolean}
   */
  static evaluate(button, item, actor) {
    if (!button.conditions?.length) return true;
    return button.conditions.every(c => {
      const result = this._evaluateOne(c, item, actor);
      return c.negate ? !result : result;
    });
  }

  static _evaluateOne(cond, item, actor) {
    switch (cond.type) {
      case "always":        return true;
      case "field":         return this._compareField(cond, this._resolveValue(cond.field, item, actor));
      case "actorField":    return this._compareField(cond, foundry.utils.getProperty(actor ?? {}, cond.field));
      case "slotHasItems":  return (SlotManager.getContents(item, cond.slotId)?.length ?? 0) >= (cond.minCount ?? 1);
      case "slotNotFull": {
        const def = SlotManager.getDefinition(item, cond.slotId);
        const cnt = SlotManager.getContents(item, cond.slotId)?.length ?? 0;
        return def ? cnt < def.maxCount : false;
      }
      default: return true;
    }
  }

  static _compareField(cond, actual) {
    const expected = isNaN(cond.value) ? cond.value : Number(cond.value);
    const a = typeof actual === "number" ? actual : Number(actual);
    switch (cond.operator) {
      case ">":  return a >  expected;
      case "<":  return a <  expected;
      case ">=": return a >= expected;
      case "<=": return a <= expected;
      case "==": return a == expected;
      case "!=": return a != expected;
      default:   return true;
    }
  }

  static _resolveValue(path, item, actor) {
    if (!path) return undefined;
    if (path.startsWith("actor."))  return foundry.utils.getProperty(actor ?? {}, path.slice(6));
    if (path.startsWith("slots."))  return SlotManager.resolveSlotPath(item, path);
    if (path.startsWith("self."))   return foundry.utils.getProperty(item, path.slice(5));
    return foundry.utils.getProperty(item, path);
  }
}

// Исполнитель действий

// Резолвинг целей

/** Strip wrapping double-quotes and trim. */
function _sdStripQuotes(s) {
  let out = String(s ?? "").trim();
  if (out.length >= 2 && out.startsWith('"') && out.endsWith('"')) out = out.slice(1, -1);
  return out;
}

/**
 * Resolve a single value coming from a graph compile/runtime substitution to
 * a Foundry Actor. Accepts either:
 *   - magic mode strings: "self", "actor", "token_target", "selected_token",
 *     "all_targets" (returns first), "user_character"
 *   - a Foundry UUID like "Actor.abc123", "Scene.X.Token.Y", "Token.X" — the
 *     embedded actor (or itself, if Actor) is returned.
 *   - an Actor / Token / TokenDocument / actor uuid object — reduced.
 *   - falsy → null.
 */
function _sdResolveActor(spec, actor) {
  if (spec == null || spec === "") return null;
  if (spec instanceof Actor) return spec;
  if (typeof spec === "object") {
    if (spec.actor instanceof Actor) return spec.actor;          // Token / TokenDocument
    if (typeof spec.uuid === "string") return _sdResolveActor(spec.uuid, actor);
  }
  const raw = _sdStripQuotes(spec);
  if (!raw || raw === "0") return null;

  // Magic mode strings
  if (raw === "self")           return actor ?? null;
  if (raw === "actor")          return actor ?? null;
  if (raw === "user_character") return game.user.character ?? null;
  if (raw === "token_target") {
    return game.user.targets?.first()?.actor
        ?? canvas?.tokens?.controlled?.[0]?.actor
        ?? actor ?? null;
  }
  if (raw === "selected_token") {
    return canvas?.tokens?.controlled?.[0]?.actor
        ?? game.user.targets?.first()?.actor
        ?? actor ?? null;
  }
  if (raw === "all_targets") {
    return [...(game.user.targets ?? [])][0]?.actor
        ?? canvas?.tokens?.controlled?.[0]?.actor
        ?? actor ?? null;
  }

  // UUID? (contains a dot and looks like Doc.id pattern)
  if (raw.includes(".") && /^[A-Za-z][A-Za-z0-9]*\./.test(raw)) {
    try {
      const doc = (typeof fromUuidSync === "function" ? fromUuidSync(raw) : null);
      if (doc) {
        if (doc instanceof Actor) return doc;
        if (doc.actor instanceof Actor) return doc.actor;       // Token / TokenDocument / Item
      }
    } catch { /* fall through */ }
  }

  // Token id on canvas (16-char alphanumeric)
  if (/^[A-Za-z0-9]{16}$/.test(raw)) {
    const tok = canvas?.tokens?.get?.(raw);
    if (tok?.actor) return tok.actor;
    const a = game.actors?.get?.(raw);
    if (a) return a;
  }

  return null;
}

/** Multi-resolver. Returns an array of Actors. */
function _sdResolveActorsList(spec, actor) {
  if (spec == null || spec === "") return [];
  if (Array.isArray(spec)) {
    const out = [];
    for (const x of spec) {
      const a = _sdResolveActor(x, actor);
      if (a) out.push(a);
    }
    return out;
  }
  const raw = _sdStripQuotes(spec);
  if (!raw || raw === "0") return [];

  if (raw === "all_targets") {
    const tgt = [...(game.user.targets ?? [])].map(t => t.actor).filter(Boolean);
    if (tgt.length) return tgt;
    const sel = (canvas?.tokens?.controlled ?? []).map(t => t.actor).filter(Boolean);
    if (sel.length) return sel;
    return actor ? [actor] : [];
  }
  if (raw.startsWith("player_actors")) {
    return _resolvePlayerActors(raw);
  }
  // Comma-separated ids/uuids
  if (raw.includes(",")) {
    const parts = raw.split(",").map(x => x.trim()).filter(Boolean);
    const out = [];
    for (const p of parts) {
      const a = _sdResolveActor(p, actor);
      if (a) out.push(a);
    }
    if (out.length) return out;
  }
  const single = _sdResolveActor(raw, actor);
  return single ? [single] : [];
}

function _resolveTarget(mode, actor) {
  // Backwards-compatible: old "actor"/"selected_token"/etc. magic strings still
  // work, but we also accept UUIDs / "user_character" via _sdResolveActor.
  const a = _sdResolveActor(mode, actor);
  if (a) return a;
  if (mode === "actor") return actor ?? null;
  const targeted = game.user.targets?.first()?.actor ?? null;
  const selected = canvas?.tokens?.controlled?.[0]?.actor ?? null;
  if (mode === "selected_token") return selected ?? targeted ?? actor ?? null;
  return targeted ?? selected ?? actor ?? null;
}

/** Resolve a Cards stack by uuid or by name (priority: uuid). */
async function _sdResolveCards({ uuid, name } = {}) {
  if (uuid) { try { const d = await fromUuid(uuid); if (d) return d; } catch {} }
  if (name) {
    const byName = game.cards?.getName?.(name);
    if (byName) return byName;
  }
  return null;
}

/** Resolve a single Card document inside a stack. selectorMode = "specific"|"top"|"bottom"|"random"|"by_name"|"first". */
async function _sdResolveCard(stack, action) {
  if (!stack) return null;
  const cards = stack.availableCards?.length ? stack.availableCards : Array.from(stack.cards ?? []);
  if (!cards.length) return null;
  const mode = action.cardSelector || (action.cardId ? "specific" : "top");
  if (mode === "specific" && action.cardId) {
    return stack.cards.get(action.cardId) ?? null;
  }
  if (mode === "by_name" && action.cardName) {
    return cards.find(c => c.name === action.cardName) ?? null;
  }
  if (mode === "random") return cards[Math.floor(Math.random() * cards.length)] ?? null;
  if (mode === "bottom") return cards[cards.length - 1] ?? null;
  if (mode === "first")  return cards[0] ?? null;
  /* top (default) — take first available drawn order */
  return cards[0] ?? null;
}

function _resolveAllTargets(mode, actor) {
  const list = _sdResolveActorsList(mode, actor);
  if (list.length) return list;
  if (mode === "all_targets") {
    const targeted = [...(game.user.targets ?? [])].map(t => t.actor).filter(Boolean);
    if (targeted.length) return targeted;
    const selected = (canvas?.tokens?.controlled ?? []).map(t => t.actor).filter(Boolean);
    if (selected.length) return selected;
    return actor ? [actor] : [];
  }
  const single = _resolveTarget(mode ?? "token_target", actor);
  return single ? [single] : [];
}

/** Resolve "player_actors:onlineOnly:includeGM" → array of player-character actors. */
function _resolvePlayerActors(spec) {
  const parts = String(spec).split(":");
  const onlineOnly = (parts[1] ?? "yes") === "yes";
  const includeGM  = (parts[2] ?? "no")  === "yes";
  const users = game.users.filter(u => {
    if (!includeGM && u.isGM) return false;
    if (onlineOnly && !u.active) return false;
    return true;
  });
  const seen = new Set();
  const actors = [];
  for (const u of users) {
    const a = u.character;
    if (!a) continue;
    if (seen.has(a.id)) continue;
    seen.add(a.id);
    actors.push(a);
  }
  return actors;
}

/**
 * Resolve a serialized "items" value coming from the graph compiler into an
 * array of actors / tokens / generic objects. Handles:
 *   - "all_targets"            → currently targeted token actors
 *   - "selected_token"         → first selected token's actor (1-element array)
 *   - "user_character"         → game.user.character (1-element array)
 *   - "player_actors:..."      → player character actors
 *   - "uuid1,uuid2,..."        → resolved fromUuidSync each
 *   - JSON-encoded array       → parsed as-is
 *   - anything else            → wrapped as 1-element array
 */
async function _sdResolveItems(spec, actor) {
  if (Array.isArray(spec)) return spec;
  if (spec == null || spec === "" || spec === '""') return [];
  let s = String(spec).trim();
  // Strip surrounding quotes (compiled string literal)
  if (s.length >= 2 && (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  )) {
    s = s.slice(1, -1);
  }
  if (!s) return [];
  if (s === "all_targets") return _resolveAllTargets("all_targets", actor);
  if (s === "selected_token" || s === "token_target") {
    const single = _resolveTarget(s, actor);
    return single ? [single] : [];
  }
  if (s === "user_character") {
    return game.user.character ? [game.user.character] : [];
  }
  if (s.startsWith("player_actors")) return _resolvePlayerActors(s);
  // JSON array?
  if (s.startsWith("[")) {
    try { const arr = JSON.parse(s); if (Array.isArray(arr)) return arr; } catch { /* fall through */ }
  }
  // Comma-separated UUIDs
  if (s.includes(",")) {
    const parts = s.split(",").map(x => x.trim()).filter(Boolean);
    const out = [];
    for (const p of parts) {
      try {
        const doc = await fromUuid(p).catch(() => null) ?? fromUuidSync?.(p);
        out.push(doc ?? p);
      } catch { out.push(p); }
    }
    return out;
  }
  // Single UUID?
  if (/^[A-Za-z]+\.[A-Za-z0-9]+/.test(s)) {
    try {
      const doc = await fromUuid(s).catch(() => null) ?? fromUuidSync?.(s);
      return doc ? [doc] : [s];
    } catch { return [s]; }
  }
  return [s];
}

/** Get a display label from an array element using a dot-path (e.g. "name"). */
function _sdItemLabel(item, labelPath, fallbackIndex) {
  if (item == null) return `Item ${fallbackIndex + 1}`;
  if (typeof item === "string") return item;
  if (labelPath) {
    const v = foundry.utils.getProperty(item, labelPath);
    if (v !== undefined && v !== null && v !== "") return String(v);
  }
  return item.name ?? item.label ?? String(item.id ?? `Item ${fallbackIndex + 1}`);
}

function _resistanceFactor(tActor, damageType) {
  if (!tActor || !damageType) return { factor: 1, label: "" };
  const key = String(damageType).toLowerCase().trim();
  if (!key) return { factor: 1, label: "" };

  // (1) Structured map.
  const map = tActor.system?.resistances;
  if (map && typeof map === "object") {
    const raw = map[key] ?? map[damageType];
    if (raw !== undefined && raw !== null && raw !== "") {
      if (typeof raw === "number" || /^-?\d*\.?\d+$/.test(String(raw))) {
        const n = Number(raw);
        if (n === 0) return { factor: 0, label: "immune" };
        if (n < 1)  return { factor: n, label: `×${n}` };
        if (n > 1)  return { factor: n, label: `×${n}` };
        return { factor: 1, label: "" };
      }
      const s = String(raw).toLowerCase();
      if (s === "immune")           return { factor: 0,   label: "immune" };
      if (s === "resist" || s === "resistant")
                                    return { factor: 0.5, label: "resist" };
      if (s === "vulnerable")       return { factor: 2,   label: "vulnerable" };
      if (s === "normal")           return { factor: 1,   label: "" };
    }
  }

  const t = tActor.system?.traits ?? {};
  const has = (arr) => Array.isArray(arr) && arr.some(v => String(v).toLowerCase() === key);
  if (has(t.immunities))       return { factor: 0,   label: "immune" };
  if (has(t.resistances))      return { factor: 0.5, label: "resist" };
  if (has(t.vulnerabilities))  return { factor: 2,   label: "vulnerable" };

  return { factor: 1, label: "" };
}

/** Coerce the `savePassed` pin value into a boolean. */
function _savePassedVal(v) {
  if (v === true || v === "true" || v === "yes" || v === 1 || v === "1") return true;
  return false;
}

export class ButtonExecutor {

  /**
   * Build the reroll-flag object for chat messages produced by roll-action nodes.
   * Returns null when reroll is disabled (so callers can spread it in `flags.sd`
   * conditionally without polluting the flag with an empty record).
   *
   * @param {object} action  the compiled action descriptor
   * @param {Actor}  srcActor the source actor (button owner) — used for resource lookups
   * @param {string} formula the (already runtime-injected) roll formula to replay
   * @param {string} label   short human label shown next to the reroll button
   * @returns {object|null}
   */
  static _buildRerollFlag(action, srcActor, formula, label) {
    if (!action || action.rerollEnabled !== "yes" && action.rerollEnabled !== true) return null;
    if (!formula) return null;
    const costPath   = String(action.rerollPath ?? "").trim();
    const costAmount = Number(action.rerollCost ?? 0) || 0;
    return {
      enabled:    true,
      formula,
      label:      label ?? "Re-roll",
      srcActorId: srcActor?.id ?? null,
      costPath,
      costAmount
    };
  }

  static async execute(button, item, actor) {
    if (!ConditionEvaluator.evaluate(button, item, actor)) {
      ui.notifications.warn(game.i18n.format("SD.Buttons.ConditionFailed", { label: button.label }));
      return;
    }

    const runtime = {};
    for (const action of (button.actions ?? [])) {
      if (action.delay > 0) await new Promise(r => setTimeout(r, action.delay));
      await this._runAction(action, item, actor, button, runtime);
    }
  }

  static async _runAction(action, item, actor, buttonDef = null, runtime = {}) {
    const _sanitizeRollData = (data) => Object.fromEntries(
      Object.entries(data ?? {}).map(([k, v]) =>
        [k, (typeof v === "string" && /^\s*\d*d\d+/i.test(v)) ? 0 : v]
      )
    );

    const _injectRuntime = (formula) => {
      if (typeof formula !== "string") return formula;
      if (buttonDef?.__lastRoll !== undefined) {
        formula = formula.replace(/\{__lastRoll\}/g, String(buttonDef.__lastRoll));
      }
      if (buttonDef?.__lastMargin !== undefined) {
        formula = formula.replace(/\{__lastMargin\}/g, String(buttonDef.__lastMargin));
      }
      if (buttonDef?.__lastSuccesses !== undefined) {
        formula = formula.replace(/\{__lastSuccesses\}/g, String(buttonDef.__lastSuccesses));
      }
      if (buttonDef?.__lastBotches !== undefined) {
        formula = formula.replace(/\{__lastBotches\}/g, String(buttonDef.__lastBotches));
      }
      if (buttonDef?.__cmpDiff !== undefined) {
        formula = formula.replace(/\{__cmpDiff\}/g, String(buttonDef.__cmpDiff));
      }
      if (buttonDef?.__cmpWinner !== undefined) {
        formula = formula.replace(/\{__cmpWinner\}/g, String(buttonDef.__cmpWinner));
      }
      if (buttonDef?.__progPrev !== undefined) {
        formula = formula.replace(/\{__progPrev\}/g, String(buttonDef.__progPrev));
      }
      const evRt = buttonDef?.__eventRuntime;
      if (evRt) {
        for (const k of Object.keys(evRt)) {
          formula = formula.replace(new RegExp(`\\{${k}\\}`, "g"), String(evRt[k] ?? ""));
        }
      }
      if (runtime.__lastRollTableResult !== undefined) {
        formula = formula.replace(/\{__lastRollTableResult\}/g, String(runtime.__lastRollTableResult));
      }
      if (runtime.__lastAiResponse !== undefined) {
        formula = formula.replace(/\{__lastAiResponse\}/g, String(runtime.__lastAiResponse));
      }
      if (runtime.__lastAiError !== undefined) {
        formula = formula.replace(/\{__lastAiError\}/g, String(runtime.__lastAiError));
      }
      if (runtime.__loopIndex !== undefined) {
        formula = formula.replace(/\{__loopIndex\}/g, String(runtime.__loopIndex));
      }
      // AoE Save Branch
      const _tokList = (arr) => Array.isArray(arr) ? arr.join(",") : String(arr ?? "");
      if (runtime.savedTargets !== undefined) {
        formula = formula.replace(/\{__savedTargets\}/g, _tokList(runtime.savedTargets));
      }
      if (runtime.failedTargets !== undefined) {
        formula = formula.replace(/\{__failedTargets\}/g, _tokList(runtime.failedTargets));
      }
      if (runtime.allTargets !== undefined) {
        formula = formula.replace(/\{__allTargets\}/g, _tokList(runtime.allTargets));
      }
      if (runtime.currentTarget !== undefined) {
        formula = formula.replace(/\{__currentTarget\}/g, String(runtime.currentTarget ?? ""));
      }
      if (runtime.__castActorId !== undefined) {
        formula = formula.replace(/\{__castActorId\}/g, String(runtime.__castActorId));
      }
      if (runtime.__castItemId !== undefined) {
        formula = formula.replace(/\{__castItemId\}/g, String(runtime.__castItemId));
      }
      if (runtime.__macroRetA !== undefined) {
        formula = formula.replace(/\{__macroRetA\}/g, String(runtime.__macroRetA));
      }
      if (runtime.__macroRetB !== undefined) {
        formula = formula.replace(/\{__macroRetB\}/g, String(runtime.__macroRetB));
      }
      if (Array.isArray(runtime.__macroStack) && runtime.__macroStack.length) {
        const frame = runtime.__macroStack[runtime.__macroStack.length - 1] ?? {};
        formula = formula.replace(/\{__macroArg:([a-z])\}/g, (_, pin) => String(frame[pin] ?? "0"));
      } else {
        formula = formula.replace(/\{__macroArg:[a-z]\}/g, "0");
      }
      if (runtime.__sdSelectedItem !== undefined) {
        formula = formula.replace(/\{__sdSelectedItem\}/g, String(runtime.__sdSelectedItem ?? ""));
      }
      if (runtime.__sdSelectedIndex !== undefined) {
        formula = formula.replace(/\{__sdSelectedIndex\}/g, String(runtime.__sdSelectedIndex ?? 0));
      }
      if (runtime.__sdInputText !== undefined) {
        formula = formula.replace(/\{__sdInputText\}/g, String(runtime.__sdInputText ?? ""));
      }
      formula = formula.replace(/\{__var:([A-Za-z0-9_]+)\|([^}]*)\}/g, (_, name, dflt) => {
        const vars = foundry.utils.getProperty(actor ?? {}, "flags.sd.vars") ?? {};
        const v = vars[name];
        return v === undefined || v === null ? dflt : String(v);
      });
      if (formula.includes("{__sdIsEquipped}")) {
        const v = item?.system?.equipped ? 1 : 0;
        formula = formula.replace(/\{__sdIsEquipped\}/g, String(v));
      }
      formula = formula.replace(/\{__sdEqCount:([A-Za-z]+)\}/g, (_, cat) => {
        const owner = actor ?? item?.parent ?? null;
        const items = owner?.items?.contents ?? [];
        const n = items.filter(i => i?.type === "inventory"
          && i.system?.equipped === true
          && (cat === "any" || i.system?.category === cat)).length;
        return String(n);
      });
      return formula;
    };
    switch (action.type) {

      case "roll": {
        const safeActor = actor ?? null;
        const safeItem  = item?.system ? item : null;
        const rollData  = { ...(safeActor?.getRollData?.() ?? {}), ...(safeItem ? { item: safeItem.system } : {}), ...( buttonDef?.__lastRoll !== undefined ? { __lastRoll: buttonDef.__lastRoll } : {} ) };
        let formula = _injectRuntime(action.formula || "1d20");
        let flavor  = _injectRuntime(action.flavor || buttonDef?.label || safeItem?.name || "");
        try {
          const { FormulaEngine } = await import("./formula-engine.mjs");
          const doc = safeItem ?? safeActor ?? {};
          formula = FormulaEngine.resolveForRoll(formula, doc);
          flavor  = FormulaEngine.resolveForRoll(flavor, doc);
        } catch(e) { /* FormulaEngine optional */ }
        const roll = new Roll(formula, _sanitizeRollData(rollData));
        await roll.evaluate();
        const _rrFlag = ButtonExecutor._buildRerollFlag(action, safeActor, formula, flavor || "Roll");
        await roll.toMessage({
          speaker:  ChatMessage.getSpeaker({ actor: safeActor }),
          flavor,
          rollMode: action.rollMode || _sdMsgMode(),
          ...(_rrFlag ? { flags: { sd: { reroll: _rrFlag } } } : {})
        });
        break;
      }

      case "rollValue": {
        const safeActor = actor ?? null;
        const safeItem  = item?.system ? item : null;
        const rollData  = { ...(safeActor?.getRollData?.() ?? {}), ...(safeItem ? { item: safeItem.system } : {}) };
        let formula    = _injectRuntime(action.formula    || "1d6");
        let advFormula = _injectRuntime(action.advFormula || "");
        let disFormula = _injectRuntime(action.disFormula || "");
        try {
          const { FormulaEngine } = await import("./formula-engine.mjs");
          const doc = safeItem ?? safeActor ?? {};
          formula    = FormulaEngine.resolveForRoll(formula,    doc);
          if (advFormula) advFormula = FormulaEngine.resolveForRoll(advFormula, doc);
          if (disFormula) disFormula = FormulaEngine.resolveForRoll(disFormula, doc);
        } catch(e) {}
        const _stripBraces = (s) => String(s ?? "")
          .replace(/\{[^{}]*\}/g, "0")
          .replace(/[{}]/g, "");
        formula    = _stripBraces(formula);
        advFormula = _stripBraces(advFormula);
        disFormula = _stripBraces(disFormula);

        const flavorLabel = action.flavor || buttonDef?.label || safeItem?.name || "";

        if (action.rollDialogue) {
          const dlgResult = await ButtonExecutor._showRollDialogue({
            flavor:     flavorLabel,
            baseFormula: formula,
            advFormula,
            disFormula,
            actor:      safeActor
          });
          if (dlgResult.cancelled) break;
          formula = dlgResult.formula;
        }

        const roll = new Roll(formula, _sanitizeRollData(rollData));
        await roll.evaluate();
        if (buttonDef) buttonDef.__lastRoll = roll.total;
        if (rollData)  rollData.__lastRoll  = roll.total;
        if (safeActor) {
          try {
            await safeActor.setFlag("sd", "lastRoll", {
              total:   roll.total,
              formula: formula,
              flavor:  flavorLabel,
              dice:    roll.dice?.flatMap(d => d.results?.map(r => ({ faces: d.faces, result: r.result }))) ?? [],
              at:      Date.now()
            });
          } catch(e) { /* flag write errors are non-fatal */ }
        }
        if (action.toChat !== false) {
          const _rrFlag = ButtonExecutor._buildRerollFlag(action, safeActor, formula, flavorLabel || "Roll");
          await roll.toMessage({
            speaker:  ChatMessage.getSpeaker({ actor: safeActor }),
            flavor:   flavorLabel,
            rollMode: _sdMsgMode(),
            ...(_rrFlag ? { flags: { sd: { reroll: _rrFlag } } } : {})
          });
        }
        break;
      }

      case "modifyField": {
        action = {
          ...action,
          delta: _injectRuntime(action.delta),
          setValue: action.setValue != null && action.setValue !== "" ? _injectRuntime(String(action.setValue)) : action.setValue,
          targetMode: action.targetMode != null && typeof action.targetMode === "string" ? _injectRuntime(action.targetMode) : action.targetMode,
          actorOverride: action.actorOverride != null && typeof action.actorOverride === "string" ? _injectRuntime(action.actorOverride) : action.actorOverride
        };
        const target = action.target;
        if (!target) break;

        const _resolveDelta = async (deltaStr) => {
          if (!deltaStr && deltaStr !== 0) return 0;
          const s = String(deltaStr).replace(/^\+/, "");
          if (/\d*d\d+/i.test(s)) {
            try {
              const { FormulaEngine } = await import("./formula-engine.mjs");
              const resolved = FormulaEngine.resolveForRoll(s, item ?? actor);
              const r = new Roll(resolved, _sanitizeRollData(actor?.getRollData?.() ?? {}));
              await r.evaluate();
              return r.total;
            } catch { return 0; }
          }
          try {
            const { FormulaEngine } = await import("./formula-engine.mjs");
            return Number(FormulaEngine.evaluate(s, item ?? actor)) || 0;
          } catch { return parseFloat(s) || 0; }
        };

        // ─── Actor pin override ────────────────────────────────────────
        // If the graph wired an Actor into the input pin, it wins over the
        // Where dropdown. The override may resolve to a single actor, an
        // array (e.g. all_targets), or nothing (UUID couldn't be found).
        // The path is stripped of any self./actor./target. prefix so it's
        // applied raw to whatever actors we resolve.
        if (action.actorOverride != null && action.actorOverride !== "" && action.actorOverride !== '""' && action.actorOverride !== "0") {
          const targets = _sdResolveActorsList(action.actorOverride, actor);
          if (targets.length) {
            const path = action.rawPath
              || target.replace(/^(?:self|actor|target)\./, "");
            for (const tActor of targets) {
              let newVal;
              if (action.setValue !== "" && action.setValue !== null && action.setValue !== undefined) {
                newVal = Number(action.setValue);
              } else {
                const delta = action.delta != null ? await _resolveDelta(action.delta) : -1;
                const cur   = Number(foundry.utils.getProperty(tActor, path) ?? 0);
                newVal = cur + delta;
              }
              if (action.clampMin !== null && action.clampMin !== undefined) newVal = Math.max(newVal, action.clampMin);
              if (action.clampMax !== null && action.clampMax !== undefined) newVal = Math.min(newVal, action.clampMax);
              try { await tActor.update({ [path]: newVal }); } catch (e) { console.warn("SD modifyField (actorOverride) failed for", tActor?.name, e); }
            }
            break;
          }
          // Override was set but resolved to nothing — fall through to legacy
          // behaviour rather than silently skipping the action.
        }

        if (target.startsWith("target.")) {
          const path   = target.slice(7);
          const tActor = _resolveTarget(action.targetMode ?? "token_target", actor);
          if (!tActor) { ui.notifications.warn("No token selected or targeted."); break; }
          let newVal;
          if (action.setValue !== "" && action.setValue !== null && action.setValue !== undefined) {
            newVal = Number(action.setValue);
          } else {
            const delta = action.delta != null ? await _resolveDelta(action.delta) : -1;
            const cur   = Number(foundry.utils.getProperty(tActor, path) ?? 0);
            newVal = cur + delta;
          }
          await tActor.update({ [path]: newVal });
          if (action.chatButton) {
            const delta = action.delta != null ? await _resolveDelta(action.delta) : 0;
            await this._postChatApply(action.chatButton, Math.abs(delta), actor, tActor);
          }
          break;
        }

        const current = this._getFieldValue(target, item, actor);
        let newVal;
        let deltaVal = action.delta != null ? await _resolveDelta(action.delta) : 0;
        if (action.setValue !== "" && action.setValue !== null && action.setValue !== undefined) {
          newVal = Number(action.setValue);
        } else {
          newVal = (Number(current) || 0) + deltaVal;
        }
        if (action.clampMin !== null && action.clampMin !== undefined) newVal = Math.max(newVal, action.clampMin);
        if (action.clampMax !== null && action.clampMax !== undefined) newVal = Math.min(newVal, action.clampMax);
        await this._setFieldValue(target, item, actor, newVal);
        if (action.chatButton) {
          const tActor = _resolveTarget("token_target", actor);
          await this._postChatApply(action.chatButton, Math.abs(deltaVal), actor, tActor);
        }
        break;
      }

      case "setField": {
        const rawVal = _injectRuntime(String(action.value ?? "0"));
        let newVal = 0;
        try {
          const { FormulaEngine } = await import("./formula-engine.mjs");
          const resolved = FormulaEngine.resolveForRoll(rawVal, item ?? actor ?? {});
          if (/\d*d\d+/i.test(resolved)) {
            const r = new Roll(resolved, _sanitizeRollData(actor?.getRollData?.() ?? {}));
            await r.evaluate();
            newVal = r.total;
          } else {
            newVal = Number(FormulaEngine.evaluate(resolved, item ?? actor)) || 0;
          }
        } catch { newVal = parseFloat(rawVal) || 0; }

        // Store for downstream nodes
        if (buttonDef) buttonDef.__lastRoll = newVal;

        const sfTarget = action.target ?? "";
        if (sfTarget.startsWith("target.")) {
          const path   = sfTarget.slice(7);
          const tActor = game.user.targets?.first()?.actor ?? canvas.tokens?.controlled?.[0]?.actor;
          if (tActor) await tActor.update({ [path]: newVal });
          else ui.notifications.warn("No token targeted.");
        } else {
          await this._setFieldValue(sfTarget, item, actor, newVal);
        }
        break;
      }

      case "setTextField": {
        // Write a string value to a path on self/actor/target.
        // Resolves runtime tokens ({__lastAiResponse}, {__lastRoll}, …) and
        // module tokens ({widget:KEY}, {@attr1}, {item:Name.path}, …) but does
        // NOT eval as a roll formula — natural-language text is written as-is.
        const stfTarget = action.target ?? "";
        if (!stfTarget) break;

        let _stfFE = null;
        try {
          const m = await import("./formula-engine.mjs");
          _stfFE = m?.FormulaEngine ?? null;
        } catch { /* optional */ }
        const _stfDoc = item ?? actor ?? {};
        const _stfResolveTokens = (s) => {
          if (!_stfFE) return s;
          try {
            return s.replace(/\{([^}]+)\}/g, (match, inner) => {
              try {
                const v = _stfFE._resolveToken
                  ? _stfFE._resolveToken(inner.trim(), _stfDoc)
                  : null;
                return (v == null) ? match : String(v);
              } catch { return match; }
            });
          } catch { return s; }
        };

        let stfValue = String(action.value ?? "");
        try { stfValue = _injectRuntime(stfValue); } catch {}
        stfValue = _stfResolveTokens(stfValue);

        // Actor pin override — wins over the Where dropdown. Loops over
        // every resolved actor (so all_targets writes to each).
        if (action.actorOverride != null && action.actorOverride !== "" && action.actorOverride !== '""' && action.actorOverride !== "0") {
          const stfOverride = typeof action.actorOverride === "string"
            ? _injectRuntime(action.actorOverride)
            : action.actorOverride;
          const targets = _sdResolveActorsList(stfOverride, actor);
          if (targets.length) {
            const path = action.rawPath || stfTarget.replace(/^(?:self|actor|target)\./, "");
            for (const tActor of targets) {
              try { await tActor.update({ [path]: stfValue }); } catch (e) { console.warn("SD setTextField (actorOverride) failed for", tActor?.name, e); }
            }
            break;
          }
        }

        if (stfTarget.startsWith("target.")) {
          const path   = stfTarget.slice(7);
          const tActor = _resolveTarget(action.targetMode ?? "token_target", actor);
          if (!tActor) { ui.notifications.warn("Set Text Field: no token targeted."); break; }
          await tActor.update({ [path]: stfValue });
          break;
        }

        // self. / actor. / raw — delegate to _setFieldValue
        await this._setFieldValue(stfTarget, item, actor, stfValue);
        break;
      }

      case "createItem": {
        if (!actor) { ui.notifications.warn("No actor context for Add Item."); break; }
        if (action.uuid) {
          try {
            const srcItem = await fromUuid(action.uuid);
            if (srcItem) {
              const obj = srcItem.toObject();
              const qty = Number(action.qty ?? 1);
              if (qty > 1 && "quantity" in (obj.system ?? {})) obj.system.quantity = qty;
              if (action.inventoryWidget) {
                const widgetKey = action.inventoryWidget;
                const tabs = actor.system?.customTabs ?? [];
                for (const tab of tabs) {
                  for (const row of (tab.rows ?? [])) {
                    for (const w of (row.widgets ?? [])) {
                      if (w.widgetKey === widgetKey && w.type === "inventory") {
                        const cats = w.categories ?? [];
                        if (cats.length > 0 && !obj.system.category) obj.system.category = cats[0];
                      }
                    }
                  }
                }
              }
              await actor.createEmbeddedDocuments("Item", [obj]);
              break;
            }
          } catch(e) { console.warn("SD | createItem uuid error:", e); }
        }
        if (action.itemName) {
          await actor.createEmbeddedDocuments("Item", [{
            name: action.itemName,
            type: action.itemType ?? "inventory",
            system: { category: action.itemCategory ?? "" }
          }]);
        } else if (!action.uuid) {
          ui.notifications.warn("SD | Add Item node: drag an item from the sidebar into the UUID field.");
        }
        break;
      }

      case "removeItem": {
        if (!actor) break;
        let toDelete = null;
        if (action.uuid) {
          try {
            const srcItem = await fromUuid(action.uuid);
            if (srcItem) toDelete = actor.items.find(i => i.name === srcItem.name);
          } catch {}
        }
        if (!toDelete && action.itemName) {
          toDelete = actor.items.find(i => i.name === action.itemName);
        }
        if (toDelete && action.inventoryWidget) {
          const widgetKey = action.inventoryWidget;
          let allowedCats = null;
          const tabs = actor.system?.customTabs ?? [];
          for (const tab of tabs) {
            for (const row of (tab.rows ?? [])) {
              for (const w of (row.widgets ?? [])) {
                if (w.widgetKey === widgetKey && w.type === "inventory") {
                  allowedCats = w.categories ?? [];
                }
              }
            }
          }
          if (allowedCats && allowedCats.length > 0 && !allowedCats.includes(toDelete.system?.category)) {
            ui.notifications.warn(`Item "${toDelete.name}" is not in inventory widget "${widgetKey}".`);
            break;
          }
        }
        if (toDelete) await toDelete.delete();
        else ui.notifications.warn(`Item not found on ${actor.name}.`);
        break;
      }

      case "useSlotItem": {
        const _useSlotId = String(action.slotId ?? "");
        const _useIdx    = Number(action.index ?? 0);
        const { SlotManager } = await import("../data/item-slots.mjs");

        const _useParents = [item, actor].filter(Boolean);
        let _usedItem = null;
        let _entryData = null;
        for (const parent of _useParents) {
          const contents = SlotManager.getContents(parent, _useSlotId);
          if (!contents.length) continue;
          const entry = contents[_useIdx];
          if (!entry) continue;
          _entryData = entry;
          let live = actor?.items?.get(entry._id) ?? null;
          // 2. Live actor item by name
          if (!live) live = actor?.items?.find(i => i.name === entry.name) ?? null;
          if (!live && entry.uuid) { try { live = await fromUuid(entry.uuid); } catch {} }
          if (live) { _usedItem = live; break; }
        }
        if (!_usedItem && _entryData) {
          try {
            const ItemCls = foundry.utils.getDocumentClass("Item");
            _usedItem = new ItemCls(_entryData, { parent: actor ?? undefined });
          } catch(e) { console.warn("SD | useSlotItem: could not build temp item:", e); }
        }
        if (_usedItem) await _usedItem.use({});
        else ui.notifications.warn(`useSlotItem: no item at index ${_useIdx} in slot "${_useSlotId}".`);
        break;
      }

      case "useItem": {
        if (!actor) break;
        let _useTarget = null;
        if (action.uuid) {
          try {
            const src = await fromUuid(action.uuid);
            if (src) _useTarget = actor.items.find(i => i.name === src.name) ?? src;
          } catch {}
        }
        if (!_useTarget && action.itemName) {
          _useTarget = actor.items.find(i => i.name === action.itemName) ?? null;
        }
        if (!_useTarget && action.category) {
          const catItems = [...actor.items].filter(i => i.system?.category === action.category);
          _useTarget = catItems[Number(action.index ?? 0)] ?? null;
        }
        if (_useTarget) await _useTarget.use({});
        else ui.notifications.warn(`useItem: item not found on ${actor.name}.`);
        break;
      }

      case "equipItem":
      case "unequipItem": {
        if (!actor) break;
        let _eqTarget = null;
        if (action.uuid) {
          try {
            const src = await fromUuid(action.uuid);
            if (src) _eqTarget = actor.items.find(i => i.name === src.name) ?? null;
          } catch {}
        }
        if (!_eqTarget && action.itemName) {
          _eqTarget = actor.items.find(i => i.name === action.itemName) ?? null;
        }
        if (!_eqTarget && action.category) {
          const catItems = [...actor.items].filter(i => i.system?.category === action.category);
          _eqTarget = catItems[Number(action.index ?? 0)] ?? null;
        }
        if (!_eqTarget) { ui.notifications.warn(`${action.type}: item not found on ${actor.name}.`); break; }
        if (_eqTarget.type !== "inventory" || !_eqTarget.system?.equippable) {
          ui.notifications.warn(`${action.type}: "${_eqTarget.name}" is not equippable.`);
          break;
        }
        const _eqNext = action.type === "equipItem";
        if (_eqNext === Boolean(_eqTarget.system.equipped)) break;
        if (_eqNext && !action.force && typeof _eqTarget.canEquip === "function") {
          const { ok, reason } = await _eqTarget.canEquip();
          if (!ok) {
            ui.notifications?.warn(reason ?? game.i18n.localize("SD.EquipBlocked") ?? "Cannot equip.");
            break;
          }
        }
        await _eqTarget.update({ "system.equipped": _eqNext });
        break;
      }

      case "modifySlotItemField": {
        const _mSlotId = String(action.slotId ?? "");
        const _mIdx    = Number(action.index ?? 0);
        const { SlotManager: SM2 } = await import("../data/item-slots.mjs");

        const _mParents = [item, actor].filter(Boolean);
        let _mLiveItem = null;
        for (const parent of _mParents) {
          const contents = SM2.getContents(parent, _mSlotId);
          const entry    = contents[_mIdx];
          if (!entry) continue;
          _mLiveItem = actor?.items?.get(entry._id) ?? actor?.items?.find(i => i.name === entry.name) ?? null;
          if (_mLiveItem) break;
        }
        if (!_mLiveItem) { ui.notifications.warn(`modifySlotItemField: no live item at slot "${_mSlotId}" index ${_mIdx}.`); break; }

        const _mPath   = action.path ?? "";
        const _mCur    = Number(foundry.utils.getProperty(_mLiveItem, _mPath) ?? 0);
        const _mAmt    = Number(action.amount ?? 0);
        let   _mResult;
        if      (action.op === "subtract") _mResult = _mCur - _mAmt;
        else if (action.op === "set")      _mResult = _mAmt;
        else                               _mResult = _mCur + _mAmt;
        await _mLiveItem.update({ [_mPath]: _mResult });
        break;
      }

      case "modifyInvItemField": {
        // Resolve the list of source actors. The Actor pin (actorOverride)
        // wins over the implicit context actor and supports both single
        // actors (UUID, mode-strings) and arrays (all_targets, comma-list).
        let _invSourceActors;
        if (action.actorOverride != null && action.actorOverride !== "" && action.actorOverride !== '""' && action.actorOverride !== "0") {
          const ovr = typeof action.actorOverride === "string"
            ? _injectRuntime(action.actorOverride)
            : action.actorOverride;
          _invSourceActors = _sdResolveActorsList(ovr, actor);
          if (!_invSourceActors.length) _invSourceActors = actor ? [actor] : [];
        } else {
          _invSourceActors = actor ? [actor] : [];
        }
        if (!_invSourceActors.length) break;

        for (const _srcActor of _invSourceActors) {
          let _invItem = null;
          if (action.uuid) {
            try {
              const src = await fromUuid(action.uuid);
              if (src) _invItem = _srcActor.items.find(i => i.name === src.name) ?? null;
            } catch {}
          }
          if (!_invItem && action.itemName) {
            _invItem = _srcActor.items.find(i => i.name === action.itemName) ?? null;
          }
          if (!_invItem && action.category) {
            const catItems = [...(_srcActor.items ?? [])].filter(i => i.system?.category === action.category);
            _invItem = catItems[Number(action.index ?? 0)] ?? null;
          }
          if (!_invItem) {
            ui.notifications.warn(`modifyInvItemField: item not found on ${_srcActor.name}.`);
            continue;
          }

          const _fPath = action.path ?? "";
          const _fCur  = Number(foundry.utils.getProperty(_invItem, _fPath) ?? 0);
          const _fAmt  = Number(action.amount ?? 0);
          let   _fResult;
          if      (action.op === "subtract") _fResult = _fCur - _fAmt;
          else if (action.op === "set")      _fResult = _fAmt;
          else                               _fResult = _fCur + _fAmt;
          try { await _invItem.update({ [_fPath]: _fResult }); } catch (e) { console.warn("SD modifyInvItemField failed for", _srcActor?.name, e); }
        }
        break;
      }

      case "removeFromInvItemSlot": {
        const _invCtx = actor ?? item ?? null;
        if (!_invCtx) break;
        const { SlotManager: SM } = await import("../data/item-slots.mjs");

        let _parentItem = null;
        if (action.uuid) {
          try {
            const src = await fromUuid(action.uuid);
            if (src) _parentItem = (actor?.items.get(src.id) ?? actor?.items.find(i => i.name === src.name))
                                ?? (src.id === item?.id || src.name === item?.name ? item : null)
                                ?? null;
          } catch {}
        }
        if (!_parentItem && action.itemName) {
          _parentItem = actor?.items.find(i => i.name === action.itemName)
                     ?? (item?.name === action.itemName ? item : null)
                     ?? null;
        }
        if (!_parentItem && !actor) _parentItem = item ?? null;
        if (!_parentItem) {
          ui.notifications.warn(`removeFromInvItemSlot: parent item "${action.itemName || action.uuid}" not found.`);
          for (const sub of (action.emptyActions ?? [])) await this._runAction(sub, item, actor, buttonDef, runtime);
          break;
        }

        const _slotId   = String(action.slotId ?? "slot1");
        const _contents = SM.getContents(_parentItem, _slotId);
        const _idx      = Number(action.index ?? 0);

        if (_contents.length === 0 || _idx >= _contents.length) {
          for (const sub of (action.emptyActions ?? [])) await this._runAction(sub, item, actor, buttonDef, runtime);
          break;
        }

        await SM.removeFromSlot(_parentItem, _slotId, _idx);
        for (const sub of (action.doneActions ?? [])) await this._runAction(sub, item, actor, buttonDef, runtime);
        break;
      }

      case "addToInvItemSlot": {
        const _addCtx = actor ?? item ?? null;
        if (!_addCtx) break;
        const { SlotManager: SM2 } = await import("../data/item-slots.mjs");

        // Контейнер
        let _container = null;
        if (action.parentUuid) {
          try {
            const src = await fromUuid(action.parentUuid);
            if (src) _container = (actor?.items.get(src.id) ?? actor?.items.find(i => i.name === src.name))
                                ?? (src.id === item?.id || src.name === item?.name ? item : null)
                                ?? null;
          } catch {}
        }
        if (!_container && action.parentName) {
          _container = actor?.items.find(i => i.name === action.parentName)
                    ?? (item?.name === action.parentName ? item : null)
                    ?? null;
        }
        if (!_container && !actor) _container = item ?? null;
        if (!_container) {
          ui.notifications.warn(`addToInvItemSlot: container "${action.parentName || action.parentUuid}" not found.`);
          for (const sub of (action.fullActions ?? [])) await this._runAction(sub, item, actor, buttonDef, runtime);
          break;
        }

        // Предмет для размещения
        let _toPlace = null;
        if (action.itemUuid) {
          try {
            const src = await fromUuid(action.itemUuid);
            if (src) _toPlace = (actor?.items.get(src.id) ?? actor?.items.find(i => i.name === src.name)) ?? src;
          } catch {}
        }
        if (!_toPlace && action.itemName) {
          _toPlace = (actor?.items ?? item?.items ?? []).find(i => i.name === action.itemName) ?? null;
        }
        if (!_toPlace) {
          ui.notifications.warn(`addToInvItemSlot: item "${action.itemName || action.itemUuid}" not found.`);
          for (const sub of (action.fullActions ?? [])) await this._runAction(sub, item, actor, buttonDef, runtime);
          break;
        }

        const _slotId2 = String(action.slotId ?? "slot1");
        const _def     = SM2.getDefinition(_container, _slotId2);
        const _cur     = SM2.getContents(_container, _slotId2);

        if (_def && _cur.length >= _def.maxCount) {
          // Full branch
          for (const sub of (action.fullActions ?? [])) await this._runAction(sub, item, actor, buttonDef, runtime);
          break;
        }

        await SM2.addToSlot(_container, _slotId2, _toPlace);
        for (const sub of (action.doneActions ?? [])) await this._runAction(sub, item, actor, buttonDef, runtime);
        break;
      }

      case "addToSlot": {
        const _slotCtx = actor ?? item ?? null;
        if (!_slotCtx) break;

        const _sid = String(action.slotId ?? "");

        let _resolved = null;
        if (action.slotPath) {
          _resolved = _resolveNestedSlotParent(actor, item, action.slotPath);
        }
        let slotParent = _resolved?.parent ?? null;
        if (!slotParent) {
          const itemHasSlot = !!item?.system?.slotDefinitions?.find?.(d => String(d.id) === _sid);
          if (itemHasSlot) {
            slotParent = item;
            _resolved = { parent: item, slotId: _sid, liveAncestor: item, snapshotChain: [] };
          } else {
            const found = (actor?.items ?? []).find(it =>
              it.system?.slotDefinitions?.find(d => String(d.id) === _sid)
            ) ?? _slotCtx;
            slotParent = found;
            _resolved = { parent: found, slotId: _sid, liveAncestor: found, snapshotChain: [] };
          }
        }

        const defs = slotParent.system?.slotDefinitions ?? [];
        if (!defs.find(d => String(d.id) === _sid)) {
          const allWidgets = (slotParent.system?.customTabs ?? [])
            .flatMap(t => (t.rows ?? []).flatMap(r => r.widgets ?? []));
          const wCfg = allWidgets.find(ww => ww.type === "slot" && String(ww.slotId) === _sid);
          const newDefs = foundry.utils.deepClone(defs);
          newDefs.push({
            id:                _sid,
            label:             wCfg?.label ?? _sid,
            allowedTypes:      wCfg?.allowedTypes      ?? [],
            allowedCategories: wCfg?.allowedCategories ?? [],
            attrFilters:       [],
            maxCount:          wCfg?.maxCount ?? 1,
            displayMode:       "compact",
            removable:         true,
            consumeOnRemove:   false
          });
          await slotParent.update({ "system.slotDefinitions": newDefs });
        }

        let srcItem = null;
        if (action.uuid) {
          try { srcItem = await fromUuid(action.uuid); } catch {}
          if (srcItem && actor && srcItem.parent !== actor) {
            srcItem = actor.items.find(i => i.name === srcItem.name) ?? srcItem;
          }
        }
        if (!srcItem && action.itemName) {
          srcItem = (actor?.items ?? item?.items ?? []).find(i => i.name === action.itemName) ?? null;
        }
        if (!srcItem) {
          if (!action.uuid && !action.itemName) {
            ui.notifications.warn("SD | Add to Slot: drag an item from the sidebar into the UUID field.");
          } else {
            ui.notifications.warn(`Item "${action.itemName || action.uuid}" not found.`);
          }
          break;
        }
        CONFIG.debug?.sd && console.log("[SD|nested]","addToSlot action | _sid:", _sid, "| _resolved:", _resolved ? "ok" : "null", "| srcItem:", srcItem?.name);
        await _nestedAddToSlot(_resolved, _sid, srcItem);
        break;
      }

      case "removeFromSlot": {
        const _sid2 = String(action.slotId ?? "");
        const _slotCtx2 = actor ?? item ?? null;
        if (!_slotCtx2) break;
        let _resolved2 = null;
        if (action.slotPath) {
          _resolved2 = _resolveNestedSlotParent(actor, item, action.slotPath);
        }
        let slotParent2 = _resolved2?.parent ?? null;
        if (!slotParent2) {
          const itemHasSlot2 = !!item?.system?.slotDefinitions?.find?.(d => String(d.id) === _sid2);
          if (itemHasSlot2) {
            slotParent2 = item;
            _resolved2 = { parent: item, slotId: _sid2, liveAncestor: item, snapshotChain: [] };
          } else {
            const found2 = (actor?.items ?? []).find(it =>
              it.system?.slotDefinitions?.find(d => String(d.id) === _sid2)
            ) ?? _slotCtx2;
            slotParent2 = found2;
            _resolved2 = { parent: found2, slotId: _sid2, liveAncestor: found2, snapshotChain: [] };
          }
        }
        CONFIG.debug?.sd && console.log("[SD|nested]","removeFromSlot action | _sid2:", _sid2, "index:", action.index ?? 0, "| _resolved2:", _resolved2 ? JSON.stringify({parent:_resolved2.parent?.name??_resolved2.parent?._id, liveAncestor:_resolved2.liveAncestor?.name??_resolved2.liveAncestor?.id, chain:_resolved2.snapshotChain}) : "null");
        if (!slotParent2) { console.warn("[SD|nested]","removeFromSlot: no slotParent2, breaking"); break; }
        await _nestedRemoveFromSlot(_resolved2, _sid2, action.index ?? 0);
        break;
      }

      case "applyEffect": {
        let _aeTargets;
        const _aeTargetsRaw = action.targets != null ? _injectRuntime(String(action.targets)) : null;
        if (_aeTargetsRaw) {
          const _aeMulti = _sdResolveActorsList(_aeTargetsRaw, actor);
          if (_aeMulti.length) {
            _aeTargets = _aeMulti;
          } else {
            const tIds = String(_aeTargetsRaw).split(",").filter(Boolean);
            _aeTargets = tIds.map(id => canvas?.tokens?.get(id)?.actor).filter(Boolean);
          }
        } else {
          const _aeSpec = action.target != null ? _injectRuntime(String(action.target)) : action.target;
          _aeTargets = _resolveAllTargets(_aeSpec ?? "actor", actor);
        }
        if (!_aeTargets.length) { ui.notifications.warn("No valid actor for applyEffect."); break; }

        const rounds = Number(action.duration ?? 0);
        const changes = (action.changes ?? []).map(c => ({
          key:   c.key   ?? "",
          value: String(c.value ?? "0"),
          mode:  Number(c.mode  ?? 2)
        }));

        for (const effectActor of _aeTargets) {
          const existing = effectActor.effects.find(e => e.name === action.effectName);
          const mode     = action.toggleMode ?? "create";

          if (mode === "toggle") {
            if (existing) { await existing.update({ disabled: !existing.disabled }); continue; }
          }
          if (mode === "ensure_on"  && existing) { await existing.update({ disabled: false }); continue; }
          if (mode === "ensure_off" && existing) { await existing.update({ disabled: true  }); continue; }
          if (mode === "toggle"     && existing) continue;

          const effectData = {
            name:     action.effectName || "Effect",
            img:      action.icon ?? "icons/svg/aura.svg",
            disabled: false,
            duration: rounds > 0 ? { rounds } : {},
            changes,
            origin:   item?.uuid ?? null,
            flags:    { sd: { sourceItemId: item?.id } }
          };

          if (existing && (mode === "create" || mode === "ensure_on")) {
            await existing.update({ ...effectData, disabled: false });
          } else {
            await effectActor.createEmbeddedDocuments("ActiveEffect", [effectData]);
          }
        }
        break;
      }


      case "applyEffectByUuid": {
        const uuid = String(action.effectUuid ?? "").trim();
        if (!uuid) { ui.notifications.warn("applyEffectByUuid: no UUID provided."); break; }

        let sourceEffect = null;
        try { sourceEffect = await fromUuid(uuid); } catch {}
        if (!sourceEffect) {
          ui.notifications.warn(`applyEffectByUuid: effect not found — ${uuid}`);
          break;
        }

        let _aeuTargets;
        const _aeuRaw = action.targets != null ? _injectRuntime(String(action.targets)) : null;
        if (_aeuRaw) {
          const _aeuMulti = _sdResolveActorsList(_aeuRaw, actor);
          if (_aeuMulti.length) {
            _aeuTargets = _aeuMulti;
          } else {
            const tIds = String(_aeuRaw).split(",").filter(Boolean);
            _aeuTargets = tIds.map(id => canvas?.tokens?.get(id)?.actor).filter(Boolean);
          }
        } else {
          const _aeuSpec = action.target != null ? _injectRuntime(String(action.target)) : action.target;
          _aeuTargets = _resolveAllTargets(_aeuSpec ?? "actor", actor);
        }
        if (!_aeuTargets.length) { ui.notifications.warn("No valid actor for applyEffectByUuid."); break; }

        const _aeuRounds = Number(action.duration ?? 0);
        for (const effectActor of _aeuTargets) {
          const mode     = action.toggleMode ?? "create";
          const existing = effectActor.effects.find(e => e.name === sourceEffect.name);

          if (mode === "toggle") {
            if (existing) { await existing.update({ disabled: !existing.disabled }); continue; }
          }
          if (mode === "ensure_on"  && existing) { await existing.update({ disabled: false }); continue; }
          if (mode === "ensure_off" && existing) { await existing.update({ disabled: true  }); continue; }
          if (mode === "toggle"     && existing) continue;

          const effectData = foundry.utils.mergeObject(
            sourceEffect.toObject(),
            {
              disabled: false,
              origin:   item?.uuid ?? sourceEffect.parent?.uuid ?? null,
              flags:    { sd: { sourceItemId: item?.id ?? null } },
              duration: _aeuRounds > 0 ? { rounds: _aeuRounds } : {}
            },
            { inplace: false }
          );
          delete effectData._id;

          if (existing && (mode === "create" || mode === "ensure_on")) {
            await existing.update({ ...effectData, disabled: false });
          } else {
            await effectActor.createEmbeddedDocuments("ActiveEffect", [effectData]);
          }
        }
        break;
      }

      case "forEachTarget": {
        const targets = [...(game.user.targets ?? [])];
        let _i = 0;
        const _prevCT = runtime.currentTarget;
        const _prevLI = runtime.__loopIndex;
        for (const token of targets) {
          const tActor = token.actor;
          if (!tActor) continue;
          runtime.currentTarget = token.id;
          runtime.__loopIndex   = _i++;
          for (const sub of (action.loopActions ?? [])) {
            await this._runAction(sub, item, tActor, buttonDef, runtime);
          }
        }
        if (_prevCT !== undefined) runtime.currentTarget = _prevCT; else delete runtime.currentTarget;
        if (_prevLI !== undefined) runtime.__loopIndex   = _prevLI; else delete runtime.__loopIndex;
        for (const sub of (action.doneActions ?? [])) {
          await this._runAction(sub, item, actor, buttonDef, runtime);
        }
        break;
      }

      case "forEachToken": {
        const raw = _injectRuntime(String(action.tokens ?? ""));
        const ids = String(raw).split(",").map(s => s.trim()).filter(Boolean);
        const _prevCT = runtime.currentTarget;
        const _prevLI = runtime.__loopIndex;
        for (let i = 0; i < ids.length; i++) {
          const tid     = ids[i];
          const tk      = (typeof canvas !== "undefined") ? canvas?.tokens?.get?.(tid) : null;
          const tActor  = tk?.actor ?? null;
          runtime.currentTarget = tid;
          runtime.__loopIndex   = i;
          for (const sub of (action.loopActions ?? [])) {
            await this._runAction(sub, item, tActor ?? actor, buttonDef, runtime);
          }
        }
        if (_prevCT !== undefined) runtime.currentTarget = _prevCT; else delete runtime.currentTarget;
        if (_prevLI !== undefined) runtime.__loopIndex   = _prevLI; else delete runtime.__loopIndex;
        for (const sub of (action.doneActions ?? [])) {
          await this._runAction(sub, item, actor, buttonDef, runtime);
        }
        break;
      }

      case "arrayCompareTwo": {
        const { FormulaEngine } = await import("./formula-engine.mjs");
        const _resolveTokId = (raw) => {
          const v = FormulaEngine.evaluate(_injectRuntime(String(raw ?? "")), actor);
          return String(v ?? "").trim();
        };
        const aId   = _resolveTokId(action.a);
        const bId   = _resolveTokId(action.b);
        const path  = String(action.path ?? "").trim();
        const _read = (tid) => {
          if (!tid) return NaN;
          const tk = (typeof canvas !== "undefined") ? canvas?.tokens?.get?.(tid) : null;
          const a  = tk?.actor;
          if (!a || !path) return NaN;
          const v = foundry.utils.getProperty(a, path);
          return Number(v);
        };
        const aV = _read(aId);
        const bV = _read(bId);
        const aOk = !isNaN(aV);
        const bOk = !isNaN(bV);
        const diff = (aOk && bOk) ? (aV - bV) : 0;
        let branch;
        let winner = "";
        if (!aOk || !bOk || diff === 0) {
          branch = action.equalActions ?? [];
          winner = "";
        } else if (diff > 0) {
          branch = action.greaterActions ?? [];
          winner = aId;
        } else {
          branch = action.lessActions ?? [];
          winner = bId;
        }
        const _prevDiff   = buttonDef?.__cmpDiff;
        const _prevWinner = buttonDef?.__cmpWinner;
        if (buttonDef) {
          buttonDef.__cmpDiff   = diff;
          buttonDef.__cmpWinner = winner;
        }
        for (const sub of branch) {
          await this._runAction(sub, item, actor, buttonDef, runtime);
        }
        if (buttonDef) {
          if (_prevDiff   !== undefined) buttonDef.__cmpDiff   = _prevDiff;   else delete buttonDef.__cmpDiff;
          if (_prevWinner !== undefined) buttonDef.__cmpWinner = _prevWinner; else delete buttonDef.__cmpWinner;
        }
        break;
      }

      case "saveCheck": {
        const { FormulaEngine } = await import("./formula-engine.mjs");
        const tActor   = _resolveTarget(action.target ?? "actor", actor)
        const saveActor = tActor ?? actor;
        if (!saveActor) break;

        const saveMod = Number(foundry.utils.getProperty(saveActor, action.savePath ?? "system.attributes.will.value") ?? 0);
        const dc      = Number(_injectRuntime(String(action.dc ?? 15)));
        const resolvedDC = isNaN(dc) ? 15 : dc;

        const roll = new Roll(`1d20 + ${saveMod}`, _sanitizeRollData(saveActor?.getRollData?.() ?? {}));
        await roll.evaluate();

        const pass = roll.total >= resolvedDC;
        await roll.toMessage({
          speaker:  ChatMessage.getSpeaker({ actor: saveActor }),
          flavor:   `${action.flavor ?? "Saving Throw"} — DC ${resolvedDC} — ${pass ? "✅ Passed" : "❌ Failed"}`,
          rollMode: _sdMsgMode()
        });

        const branch = pass ? (action.passActions ?? []) : (action.failActions ?? []);
        for (const sub of branch) {
          await this._runAction(sub, item, saveActor, buttonDef, runtime);
        }
        break;
      }

      case "consumeSlot": {
        const slotActor = actor ?? null;
        if (!slotActor) { ui.notifications.warn("No actor for consumeSlot."); break; }
        const { FormulaEngine } = await import("./formula-engine.mjs");
        const lvlRaw = _injectRuntime(String(action.level ?? 1));
        const lvl    = String(Math.max(1, Math.round(Number(FormulaEngine.evaluate(lvlRaw, slotActor)) || 1)));
        const slotPath  = `system.spellSlots.${lvl}`;
        const slot      = foundry.utils.getProperty(slotActor, slotPath) ?? {};
        const sv        = Number(slot.value ?? 0);
        const sm        = Number(slot.max   ?? 0);
        if (sm <= 0 || sv <= 0) {
          for (const sub of (action.emptyActions ?? [])) {
            await this._runAction(sub, item, actor, buttonDef, runtime);
          }
          break;
        }
        await slotActor.update({ [`${slotPath}.value`]: sv - 1 });
        for (const sub of (action.okActions ?? [])) {
          await this._runAction(sub, item, actor, buttonDef, runtime);
        }
        break;
      }

      case "restoreSlot": {
        const slotActor = actor ?? null;
        if (!slotActor) break;
        const { FormulaEngine } = await import("./formula-engine.mjs");
        const lvlRaw = _injectRuntime(String(action.level ?? 1));
        const lvl    = String(Math.max(1, Math.round(Number(FormulaEngine.evaluate(lvlRaw, slotActor)) || 1)));
        const slotPath = `system.spellSlots.${lvl}`;
        const slot     = foundry.utils.getProperty(slotActor, slotPath) ?? {};
        const sv       = Number(slot.value ?? 0);
        const sm       = Number(slot.max   ?? 0);
        if (sm > 0) await slotActor.update({ [`${slotPath}.value`]: Math.min(sm, sv + 1) });
        break;
      }

      case "applyEffectTemplate": {
        if (!item?.system?.effectTemplates) break;
        const tplName = action.templateName ?? "";
        const tpl = item.system.effectTemplates.find(t => t.name === tplName || (!tplName && t));
        if (!tpl) {
          if (tplName) ui.notifications.warn(`Effect template "${tplName}" not found on ${item.name}.`);
          break;
        }

        const rounds  = Number(tpl.durationRounds ?? 0);
        let changes   = [];
        try { changes = JSON.parse(tpl.changes || "[]"); } catch { changes = []; }
        changes = changes.map(c => ({ key: c.key ?? "", value: String(c.value ?? "0"), mode: Number(c.mode ?? 2) }));

        const effectData = {
          name:     tpl.name     || "Effect",
          img:      tpl.icon     || "icons/svg/aura.svg",
          disabled: false,
          duration: rounds > 0 ? { rounds } : {},
          changes,
          origin:   item.uuid,
          flags:    { sd: { sourceItemId: item.id } }
        };

        const _aetRaw = action.targetOverride ?? tpl.target ?? "actor";
        const targetMode = typeof _aetRaw === "string" ? _injectRuntime(_aetRaw) : _aetRaw;
        let targets = _resolveAllTargets(targetMode, actor);
        if (!targets.length) targets = [actor ?? null].filter(Boolean);

        for (const tActor of targets) {
          if (!tActor) continue;
          const existing = tActor.effects.find(e => e.name === tpl.name && e.flags?.sd?.sourceItemId === item.id);
          if (existing) await existing.update({ ...effectData, disabled: false });
          else          await tActor.createEmbeddedDocuments("ActiveEffect", [effectData]);
        }
        break;
      }

      case "playSound": {
        const soundSrc = action.src ?? action.soundPath;
        if (soundSrc) {
          const vol  = (action.volume !== undefined && action.volume !== null) ? Number(action.volume) : 0.8;
          const loop = action.loop === true || action.loop === "yes";
          foundry.audio.AudioHelper.play({ src: soundSrc, volume: vol, autoplay: true, loop }, true);
        }
        break;
      }

      case "runMacro": {
        const macro = game.macros.getName(action.macroName);
        if (macro) await macro.execute({ item, actor });
        break;
      }

      case "branch": {
        if (!action.condition && action.condition !== 0) break;
        let pass = false;
        try {
          const { FormulaEngine } = await import("./formula-engine.mjs");
          let cond = _injectRuntime(String(action.condition));

          // Step 1: Resolve {ref} tokens
          cond = FormulaEngine.resolveForRoll(cond, item ?? actor ?? {});

          if (/\d*d\d+/i.test(cond)) {
            const diceRegex = /(\d*)d(\d+)/gi;
            const matches = [...cond.matchAll(diceRegex)].reverse();
            for (const m of matches) {
              const formula = m[0];
              try {
                const r = new Roll(formula, _sanitizeRollData(actor?.getRollData?.() ?? {}));
                await r.evaluate();
                cond = cond.slice(0, m.index) + r.total + cond.slice(m.index + formula.length);
              } catch { /* leave as-is on error */ }
            }
          }

          const resolved = FormulaEngine.evaluate(cond, item ?? actor);
          if (typeof resolved === "boolean") {
            pass = resolved;
          } else {
            pass = !!resolved && resolved !== "0" && resolved !== 0 && resolved !== false;
          }
        } catch { pass = !!action.condition; }
        const branch = pass ? (action.trueActions ?? []) : (action.falseActions ?? []);
        for (const subAction of branch) {
          await this._runAction(subAction, item, actor, buttonDef, runtime);
        }
        break;
      }

      case "message": {
        const rawParts = action.messageParts?.length
          ? action.messageParts
          : [action.messageText ?? action.text ?? ""];

        const resolvedParts = [];
        for (let rawPart of rawParts) {
          let p = _injectRuntime(String(rawPart));
          if (!p) continue;
          try {
            const { FormulaEngine } = await import("./formula-engine.mjs");
            const doc = item ?? actor ?? {};
            p = p.replace(/\{([^}]+)\}/g, (match, inner) => {
              const val = FormulaEngine.evaluate(`{${inner}}`, doc);
              return (val === match || val === undefined || val === null) ? "0" : String(val);
            });
            if (p && !p.startsWith("{")) {
              const evaled = FormulaEngine.evaluate(p, doc);
              if (evaled !== undefined && evaled !== p) p = String(evaled);
            }
          } catch {}
          if (p) resolvedParts.push(p);
        }

        const text = resolvedParts.join("\n");
        if (text) {
          await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor: actor ?? null }),
            content: `<p style="margin:0;font-size:13px">${text.replace(/\n/g, "<br>")}</p>`
          });
        }
        break;
      }

      case "attackCheck": {
        const { FormulaEngine } = await import("./formula-engine.mjs");
        let atkFormula = action.formula ?? "1d20";
        const bonus    = action.bonus ? FormulaEngine.evaluate(String(action.bonus), item ?? actor) : 0;
        try { atkFormula = FormulaEngine.resolveForRoll(atkFormula, item ?? actor); } catch {}
        if (bonus && Number(bonus) !== 0) atkFormula = `(${atkFormula})+${bonus}`;

        const roll = new Roll(atkFormula, _sanitizeRollData(actor?.getRollData?.() ?? {}));
        await roll.evaluate();

        // Get target AC
        const tActor = game.user.targets?.first()?.actor ?? canvas.tokens?.controlled?.[1]?.actor ?? null;
        const ac     = tActor ? (Number(foundry.utils.getProperty(tActor, action.acPath ?? "system.attributes.ac.value")) || 0) : null;
        const hit    = ac !== null ? (roll.total >= ac) : null;
        const margin = ac !== null ? (roll.total - ac) : 0;

        const critFace = Number(action.critFace ?? 20);
        const firstDie = roll.dice?.[0]?.results?.[0]?.result;
        const isCrit   = critFace > 0 && firstDie === critFace;

        const outcomeLabel = isCrit ? "🌟 Crit!" : hit === null ? "" : hit ? "✅ Hit!" : "❌ Miss";
        const acLabel      = ac !== null ? `Target AC: <strong>${ac}</strong>` : "(no target)";

        if (buttonDef) {
          buttonDef.__lastRoll   = roll.total;
          buttonDef.__lastMargin = margin;
        }

        const _rrFlagAtk = ButtonExecutor._buildRerollFlag(action, actor, atkFormula, action.flavor ?? "Attack");
        await roll.toMessage({
          speaker: ChatMessage.getSpeaker({ actor }),
          flavor: `${action.flavor ?? "Attack"} — ${outcomeLabel} ${ac !== null ? `(${acLabel})` : ""}`,
          rollMode: _sdMsgMode(),
          ...(_rrFlagAtk ? { flags: { sd: { reroll: _rrFlagAtk } } } : {})
        });

        const branch = isCrit
          ? (action.critActions?.length ? action.critActions : (action.hitActions ?? []))
          : (hit !== false ? (action.hitActions ?? []) : (action.missActions ?? []));
        for (const subAction of branch) {
          await this._runAction(subAction, item, actor, buttonDef, runtime);
        }
        break;
      }

      case "rollCheck": {
        const { FormulaEngine } = await import("./formula-engine.mjs");
        const doc = item ?? actor ?? {};
        let formula = _injectRuntime(action.formula    ?? "1d20");
        let advF    = _injectRuntime(action.advFormula ?? "");
        let disF    = _injectRuntime(action.disFormula ?? "");
        try { formula = FormulaEngine.resolveForRoll(formula, doc); } catch {}
        try { if (advF) advF = FormulaEngine.resolveForRoll(advF, doc); } catch {}
        try { if (disF) disF = FormulaEngine.resolveForRoll(disF, doc); } catch {}
        const _stripBraces2 = (s) => String(s ?? "")
          .replace(/\{[^{}]*\}/g, "0")
          .replace(/[{}]/g, "");
        formula = _stripBraces2(formula);
        advF    = _stripBraces2(advF);
        disF    = _stripBraces2(disF);

        if (action.rollDialogue) {
          const dlg = await ButtonExecutor._showRollDialogue({
            flavor:      action.flavor ?? "Check",
            baseFormula: formula,
            advFormula:  advF,
            disFormula:  disF,
            actor
          });
          if (dlg.cancelled) break;
          formula = dlg.formula;
        }

        const dc       = Number(FormulaEngine.evaluate(String(action.dc ?? "0"), doc)) || 0;
        const modifier = Number(FormulaEngine.evaluate(String(action.modifier ?? "0"), doc)) || 0;
        const rollStr  = modifier ? `(${formula})+(${modifier})` : formula;

        let total;
        if (action.howRoll === "chat_button") {
          const cardId = foundry.utils.randomID();
          const flavor = action.flavor ?? "Check";
          const buttonLabel = `${flavor} (DC ${dc})`;
          const content = `
            <div class="sd-chat-card sd-rollcheck-card" data-sd-rc-card="${cardId}">
              <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;">
                <img src="${actor?.img ?? "icons/svg/mystery-man.svg"}"
                     style="width:36px;height:36px;border-radius:50%;object-fit:cover;">
                <div style="flex:1">
                  <div style="font-size:13px;font-weight:700;">${actor?.name ?? "?"}</div>
                  <div style="font-size:11px;color:#666;">${flavor} — DC ${dc}</div>
                </div>
              </div>
              <div style="padding:6px 12px;">
                <button type="button" class="sd-rollcheck-btn"
                        data-sd-rc="${cardId}"
                        data-sd-rc-formula="${rollStr.replace(/"/g,"&quot;")}"
                        style="display:block;width:100%;padding:7px 10px;
                               border-radius:5px;cursor:pointer;font-weight:700;
                               background:#7a3a00;color:#fff;border:1px solid #5a2a00;">
                  <i class="fas fa-dice-d20"></i> ${buttonLabel}
                </button>
                <div class="sd-rollcheck-status" style="padding:6px 0 2px;font-size:11px;color:#888;">
                  Waiting for roll…
                </div>
              </div>
            </div>`;
          const msgPayload = {
            cardId,
            actorUuid: actor?.uuid ?? null,
            requesterId: game.user?.id ?? null,
            flavor,
            dc,
            rollStr,
            resolved: false
          };
          await ChatMessage.create({
            user:    game.user.id,
            speaker: ChatMessage.getSpeaker({ actor }),
            flavor:  `${flavor} — Roll Check`,
            content,
            flags: { sd: { rollCheck: msgPayload } }
          });

          const timeoutSec = Number(action.chatTimeout ?? 0) || 0;
          total = await new Promise((resolve) => {
            let timer = null;
            const handler = (data) => {
              if (data?.type !== "rollCheckResult" || data?.cardId !== cardId) return;
              game.socket.off("system.sd", handler);
              if (timer) clearTimeout(timer);
              resolve(Number(data.total) || 0);
            };
            game.socket.on("system.sd", handler);
            if (timeoutSec > 0) {
              timer = setTimeout(() => {
                game.socket.off("system.sd", handler);
                ui.notifications?.warn?.(`SD | Roll Check «${flavor}» timed out (${timeoutSec}s).`);
                resolve(0);
              }, timeoutSec * 1000);
            }
          });
        } else {
          const roll = new Roll(rollStr, _sanitizeRollData(actor?.getRollData?.() ?? {}));
          await roll.evaluate();
          total = roll.total;
        }
        const margin = total - dc;

        let passed = false;
        switch (action.mode ?? "roll_over") {
          case "roll_under":    passed = total <= dc; break;
          case "meet_and_beat": passed = total >  dc; break;
          case "troika":        passed = total >  dc || total < dc; break;  // any non-tie
          case "custom": {
            const cond = String(action.custom ?? "{roll} >= {dc}")
              .replace(/\{roll\}/g,  String(total))
              .replace(/\{dc\}/g,    String(dc))
              .replace(/\{margin\}/g,String(margin));
            try { passed = !!FormulaEngine.evaluate(cond, doc); } catch { passed = false; }
            break;
          }
          case "roll_over":
          default:              passed = total >= dc; break;
        }

        if (buttonDef) { buttonDef.__lastRoll = total; buttonDef.__lastMargin = margin; }

        if (action.opposed) {
          const n = Math.max(1, Math.min(16, Number(action.opposedCount ?? 1) || 1));
          const oppFormula = String(action.opposedFormula ?? "1d20");
          const cardId = foundry.utils.randomID();
          const payload = {
            cardId,
            initiatorName:  actor?.name ?? item?.name ?? "?",
            initiatorImg:   actor?.img  ?? item?.img  ?? "icons/svg/mystery-man.svg",
            initiatorRoll:  total,
            flavor:         action.flavor ?? "Check",
            oppFormula,
            oppCount:       n,
            opponents:      [],
            actorUuid:      actor?.uuid ?? null,
            itemUuid:       item?.uuid  ?? null,
            userId:         game.user?.id ?? null,
            wonActions:     action.wonActions  ?? [],
            lostActions:    action.lostActions ?? [],
            resolved:       false
          };
          const rows = Array.from({length:n}, (_,i) => `
            <button type="button" class="sd-opposed-btn"
                    data-sd-opposed="${cardId}" data-sd-opposed-idx="${i}"
                    data-sd-opposed-formula="${oppFormula.replace(/"/g,"&quot;")}"
                    style="display:block;width:100%;margin:3px 0;padding:6px 10px;
                           border-radius:4px;cursor:pointer;font-weight:600;">
              <i class="fas fa-dice-d20"></i> Roll as Opponent #${i+1} (${oppFormula})
            </button>`).join("");
          const content = `
            <div class="sd-chat-card sd-opposed-card" data-sd-opposed-card="${cardId}">
              <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;">
                <img src="${payload.initiatorImg}"
                     style="width:36px;height:36px;border-radius:50%;object-fit:cover;">
                <div style="flex:1">
                  <div style="font-size:13px;font-weight:700;">${payload.initiatorName}</div>
                  <div style="font-size:11px;">${payload.flavor} — rolled <strong>${total}</strong></div>
                </div>
              </div>
              <div style="padding:4px 10px 10px;">${rows}</div>
              <div class="sd-opposed-status" style="padding:6px 12px;font-size:11px;">
                Waiting for ${n} opponent${n===1?"":"s"}…
              </div>
            </div>`;
          const msg = await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor }),
            content,
            flags: { sd: { opposed: payload } }
          });
          action._opposedMessageId = msg.id;
          break;
        }

        if (action.toChat !== false) {
          const label = passed ? "✅" : "❌";
          const _rrFlagRC = ButtonExecutor._buildRerollFlag(action, actor, rollStr, action.flavor ?? "Check");
          await roll.toMessage({
            speaker:  ChatMessage.getSpeaker({ actor }),
            flavor:   `${action.flavor ?? "Check"} — ${label} (DC ${dc}, margin ${margin >= 0 ? "+" : ""}${margin})`,
            rollMode: _sdMsgMode(),
            ...(_rrFlagRC ? { flags: { sd: { reroll: _rrFlagRC } } } : {})
          });
        }

        const branch = passed ? (action.passActions ?? []) : (action.failActions ?? []);
        for (const sub of branch) await this._runAction(sub, item, actor, buttonDef, runtime);
        break;
      }

      case "tieredRoll": {
        const { FormulaEngine } = await import("./formula-engine.mjs");
        const doc = item ?? actor ?? {};
        let formula = action.formula ?? "2d6";
        try { formula = FormulaEngine.resolveForRoll(formula, doc); } catch {}

        const roll = new Roll(formula, _sanitizeRollData(actor?.getRollData?.() ?? {}));
        await roll.evaluate();
        const total = roll.total;
        if (buttonDef) buttonDef.__lastRoll = total;

        const tiers = action.tiers ?? [];
        let tierIdx = 0;
        for (let i = 0; i < tiers.length; i++) {
          const min = Number(FormulaEngine.evaluate(String(tiers[i]?.min ?? "0"), doc));
          if (total >= min) tierIdx = i;
        }

        if (action.toChat !== false) {
          const label = tiers[tierIdx]?.label ?? `Tier ${tierIdx + 1}`;
          const _rrFlagTier = ButtonExecutor._buildRerollFlag(action, actor, formula, action.flavor ?? "Roll");
          await roll.toMessage({
            speaker:  ChatMessage.getSpeaker({ actor }),
            flavor:   `${action.flavor ?? "Roll"} — ${label}`,
            rollMode: _sdMsgMode(),
            ...(_rrFlagTier ? { flags: { sd: { reroll: _rrFlagTier } } } : {})
          });
        }

        const branch = action.tierActions?.[tierIdx] ?? [];
        for (const sub of branch) await this._runAction(sub, item, actor, buttonDef, runtime);
        break;
      }

      case "progression": {
        const { FormulaEngine } = await import("./formula-engine.mjs");
        const doc = item ?? actor ?? {};
        let formula = action.formula ?? "1d6";
        try { formula = FormulaEngine.resolveForRoll(formula, doc); } catch {}

        const roll = new Roll(formula, _sanitizeRollData(actor?.getRollData?.() ?? {}));
        await roll.evaluate();
        const total = roll.total;

        const historyPath = String(action.historyPath ?? "system.flags.progressionDie");
        const readDoc = historyPath.startsWith("flags.") ? actor : (item ?? actor);
        let prev = null;
        try { prev = foundry.utils.getProperty(readDoc ?? {}, historyPath); } catch {}
        const hasPrev = prev !== undefined && prev !== null && prev !== "";
        const prevNum = hasPrev ? Number(prev) : 0;

        if (buttonDef) {
          buttonDef.__lastRoll = total;
          buttonDef.__progPrev = hasPrev ? prevNum : 0;
        }

        if (action.toChat !== false) {
          const cmp = !hasPrev ? "—"
                    : total >  prevNum ? `▲ ${total}>${prevNum}`
                    : total <  prevNum ? `▼ ${total}<${prevNum}`
                    :                    `= ${total}`;
          const _rrFlagProg = ButtonExecutor._buildRerollFlag(action, actor, formula, action.flavor ?? "Progression");
          await roll.toMessage({
            speaker:  ChatMessage.getSpeaker({ actor }),
            flavor:   `${action.flavor ?? "Progression"} — ${cmp}`,
            rollMode: _sdMsgMode(),
            ...(_rrFlagProg ? { flags: { sd: { reroll: _rrFlagProg } } } : {})
          });
        }

        try {
          if (readDoc?.update) await readDoc.update({ [historyPath]: total });
        } catch (e) { console.warn("SD progression: failed to write history", e); }

        let branch;
        if      (!hasPrev)         branch = action.noHistoryActions ?? [];
        else if (total >  prevNum) branch = action.higherActions    ?? [];
        else if (total <  prevNum) branch = action.lowerActions     ?? [];
        else                       branch = action.equalActions     ?? [];
        for (const sub of branch) await this._runAction(sub, item, actor, buttonDef, runtime);
        break;
      }

      case "dicePool": {
        const { FormulaEngine } = await import("./formula-engine.mjs");
        const doc = item ?? actor ?? {};
        const count  = Math.max(0, Number(FormulaEngine.evaluate(String(action.count  ?? "0"), doc)) | 0);
        const die    = Math.max(2, Number(action.die    ?? 10) | 0);
        const target = Number(FormulaEngine.evaluate(String(action.target ?? "0"), doc)) || 0;
        const botchFace = Number(action.botchFace ?? 1) | 0;
        const required  = Number(action.required  ?? 1);

        if (count <= 0) {
          const branch = action.failActions ?? [];
          for (const sub of branch) await this._runAction(sub, item, actor, buttonDef, runtime);
          break;
        }

        const roll = new Roll(`${count}d${die}`, _sanitizeRollData(actor?.getRollData?.() ?? {}));
        await roll.evaluate();
        const faces = roll.dice?.[0]?.results?.map(r => r.result) ?? [];

        let successes = 0;
        let botches   = 0;
        for (const f of faces) {
          const ok =
              action.compare === "le" ? f <= target
            : action.compare === "eq" ? f === target
            :                           f >= target;
          if (ok) successes++;
          if (f === botchFace) botches++;
        }

        const passed = successes >= required;
        if (buttonDef) {
          buttonDef.__lastRoll      = successes;
          buttonDef.__lastSuccesses = successes;
          buttonDef.__lastBotches   = botches;
        }

        if (action.toChat !== false) {
          const faceStr = faces.join(", ");
          const _rrFlagPool = ButtonExecutor._buildRerollFlag(action, actor, `${count}d${die}`, action.flavor ?? "Dice Pool");
          await roll.toMessage({
            speaker:  ChatMessage.getSpeaker({ actor }),
            flavor:   `${action.flavor ?? "Dice Pool"} — ${successes} success${successes===1?"":"es"}${botches ? `, ${botches} botch${botches===1?"":"es"}` : ""} (${faceStr})`,
            rollMode: _sdMsgMode(),
            ...(_rrFlagPool ? { flags: { sd: { reroll: _rrFlagPool } } } : {})
          });
        }

        const branch = passed ? (action.passActions ?? []) : (action.failActions ?? []);
        for (const sub of branch) await this._runAction(sub, item, actor, buttonDef, runtime);
        break;
      }

      case "throwOnCanvas":
      case "throwOnSheet": {
        const { FormulaEngine } = await import("./formula-engine.mjs");
        const doc = item ?? actor ?? {};
        const count  = Math.max(0, Number(FormulaEngine.evaluate(String(action.count  ?? "0"), doc)) | 0);
        const die    = Math.max(2, Number(action.die    ?? 6) | 0);
        const target = Number(FormulaEngine.evaluate(String(action.target ?? "0"), doc)) || 0;
        const required = Number(action.required ?? 1);

        if (count <= 0) {
          const branch = action.failActions ?? [];
          for (const sub of branch) await this._runAction(sub, item, actor, buttonDef, runtime);
          break;
        }

        const roll = new Roll(`${count}d${die}`, _sanitizeRollData(actor?.getRollData?.() ?? {}));
        await roll.evaluate();
        const faces = roll.dice?.[0]?.results?.map(r => r.result) ?? [];

        let successes = 0;
        for (const f of faces) {
          const ok =
              action.compare === "le" ? f <= target
            : action.compare === "eq" ? f === target
            :                           f >= target;
          if (ok) successes++;
        }
        const total = faces.reduce((s, f) => s + f, 0);
        const passed = successes >= required;

        if (buttonDef) {
          buttonDef.__lastRoll      = total;
          buttonDef.__lastSuccesses = successes;
        }

        const { ThrowOverlay } = await import("./throw-overlay.mjs");
        try {
          if (action.type === "throwOnCanvas") {
            ThrowOverlay.scatterOnCanvas(faces, die, { area: Number(action.area ?? 300), duration: Number(action.duration ?? 6), actor });
          } else {
            ThrowOverlay.scatterOnSheet(faces, die, { duration: Number(action.duration ?? 6), actor });
          }
        } catch (e) {
          console.error("SD | throw overlay failed", e);
        }

        if (action.toChat !== false) {
          const _rrFlagThrow = ButtonExecutor._buildRerollFlag(action, actor, `${count}d${die}`, action.flavor ?? "Throw");
          await roll.toMessage({
            speaker:  ChatMessage.getSpeaker({ actor }),
            flavor:   `${action.flavor ?? "Throw"} — ${successes} success${successes===1?"":"es"} (${faces.join(", ")})`,
            rollMode: _sdMsgMode(),
            ...(_rrFlagThrow ? { flags: { sd: { reroll: _rrFlagThrow } } } : {})
          });
        }

        const branch = passed ? (action.passActions ?? []) : (action.failActions ?? []);
        for (const sub of branch) await this._runAction(sub, item, actor, buttonDef, runtime);
        break;
      }

      case "spendToken":
      case "gainToken": {
        const isSpend = action.type === "spendToken";
        const where   = action.where ?? "self";
        const target  = where === "token_target" ? _resolveTarget("token_target", actor) : (where === "actor" ? actor : (item ?? actor));
        if (!target) break;

        const path = action.path ?? "system.resources.tokens.value";
        const cur  = Number(foundry.utils.getProperty(target, path) ?? 0);
        const amt  = Math.max(0, Number(action.amount ?? 1) | 0);

        if (isSpend && cur < amt) {
          const branch = action.emptyActions ?? [];
          for (const sub of branch) await this._runAction(sub, item, actor, buttonDef, runtime);
          break;
        }

        const maxPath = path.replace(/\.value$/, ".max");
        const maxVal  = Number(foundry.utils.getProperty(target, maxPath) ?? NaN);
        let newVal    = isSpend ? cur - amt : cur + amt;
        if (!Number.isNaN(maxVal) && maxVal > 0) newVal = Math.min(maxVal, newVal);
        newVal = Math.max(0, newVal);

        await target.update({ [path]: newVal });
        if (buttonDef) buttonDef.__lastRoll = newVal;

        if (isSpend) {
          const branch = action.okActions ?? [];
          for (const sub of branch) await this._runAction(sub, item, actor, buttonDef, runtime);
        }
        break;
      }

      case "chatDamage":
      case "chatHeal": {
        action = {
          ...action,
          amount:      _injectRuntime(action.amount),
          damageType:  action.damageType != null && action.damageType !== ""
                         ? _injectRuntime(String(action.damageType))
                         : action.damageType,
          savePassed:  action.savePassed != null && action.savePassed !== ""
                         ? _injectRuntime(String(action.savePassed))
                         : action.savePassed,
          target:      action.target != null && action.target !== ""
                         ? _injectRuntime(String(action.target))
                         : action.target,
          targets:     action.targets != null ? _injectRuntime(String(action.targets)) : null
        };
        const isHeal = action.type === "chatHeal";
        const silent = action.silent === true || action.silent === "yes";
        const { FormulaEngine } = await import("./formula-engine.mjs");

        let amount = 0;
        const amtStr = String(action.amount ?? "0");
        if (/\d*d\d+/i.test(amtStr)) {
          try {
            const resolved = FormulaEngine.resolveForRoll(amtStr, item ?? actor);
            const r = new Roll(resolved, _sanitizeRollData(actor?.getRollData?.() ?? {}));
            await r.evaluate();
            amount = r.total;
          } catch { amount = 0; }
        } else {
          amount = Number(FormulaEngine.evaluate(amtStr, item ?? actor)) || 0;
        }

        if (!isHeal && action.halfOnSave && _savePassedVal(action.savePassed)) {
          amount = Math.floor(amount / 2);
        }

        const hpPath    = action.hpPath ?? "system.resources.hp.value";
        const tMode     = action.target ?? "actor";
        const autoApply = action.autoApply === true || action.autoApply === "yes";

        let tActors;
        if (action.targets) {
          const _multi = _sdResolveActorsList(action.targets, actor);
          if (_multi.length) {
            tActors = _multi;
          } else {
            const tIds = String(action.targets).split(",").filter(Boolean);
            tActors = tIds.map(id => canvas?.tokens?.get(id)?.actor).filter(Boolean);
          }
        } else {
          tActors = _resolveAllTargets(tMode, actor);
        }

        const targets = tActors.length ? tActors : [null];

        for (const tActor of targets) {
          let finalAmount = amount;
          let resLabel    = "";
          if (!isHeal && tActor && action.damageType) {
            const { factor, label } = _resistanceFactor(tActor, action.damageType);
            finalAmount = Math.max(0, Math.floor(amount * factor));
            resLabel    = label;
          }

          if (autoApply && tActor) {
            const delta = isHeal ? finalAmount : -finalAmount;
            const cur   = Number(foundry.utils.getProperty(tActor, hpPath) ?? 0);
            const maxHp = Number(foundry.utils.getProperty(tActor,
              hpPath.replace(/\.value$/, ".max")) ?? 0);
            const newVal = maxHp
              ? Math.min(maxHp, Math.max(0, cur + delta))
              : Math.max(0, cur + delta);
            await tActor.update({ [hpPath]: newVal });
          }

          if (silent) continue;

          const cardLabel = action.label ?? (isHeal ? "Healing" : "Damage");
          const content = ButtonExecutor._buildChatCard({
            type:        isHeal ? "heal" : "damage",
            label:       resLabel ? `${cardLabel} (${resLabel})` : cardLabel,
            amount:      finalAmount,
            srcName:     actor?.name ?? item?.name ?? "?",
            srcImg:      actor?.img  ?? item?.img  ?? "icons/svg/mystery-man.svg",
            tActor,
            hpPath,
            showApply:   !autoApply && (action.showApply !== false && action.showApply !== "no"),
            rollFormula: /\d*d\d+/i.test(String(action.amount ?? "")) ? String(action.amount) : null,
            srcActorId:  actor?.id ?? null,
            autoApplied: autoApply
          });
          await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content });
        }
        break;
      }

      case "gate": {
        const { FormulaEngine } = await import("./formula-engine.mjs");
        let cond = _injectRuntime(String(action.condition ?? "0"));
        cond = FormulaEngine.resolveForRoll(cond, item ?? actor ?? {});
        const val = FormulaEngine.evaluate(cond, item ?? actor ?? {});
        if (!val || val === "0" || val === 0 || val === false) return; // halt chain
        break;
      }

      case "notify": {
        const { FormulaEngine } = await import("./formula-engine.mjs");
        let text = _injectRuntime(String(action.text ?? ""));
        try {
          text = FormulaEngine.evaluate(text, item ?? actor ?? {});
        } catch { /* leave raw */ }
        const level = action.level ?? "info";
        if (level === "warn")  ui.notifications.warn(String(text));
        else if (level === "error") ui.notifications.error(String(text));
        else ui.notifications.info(String(text));
        break;
      }

      case "setVar": {
        const { FormulaEngine } = await import("./formula-engine.mjs");
        const varName = action.name ?? "myVar";
        let val = action.value ?? 0;
        try {
          let s = _injectRuntime(String(val));
          s = FormulaEngine.resolveForRoll(s, item ?? actor ?? {});
          val = FormulaEngine.evaluate(s, item ?? actor ?? {});
        } catch { /* use raw */ }
        if (action.scope === "world") {
          if (game.user.isGM) {
            const vars = game.settings.get("sd", "systemSettings")?.vars ?? {};
            vars[varName] = val;
            const cur = game.settings.get("sd", "systemSettings") ?? {};
            await game.settings.set("sd", "systemSettings", { ...cur, vars });
          }
        } else {
          // Actor-scope (default)
          const a = actor ?? item?.actor;
          if (a) await a.setFlag("sd", `vars.${varName}`, val);
        }
        break;
      }

      case "consumeResource": {
        const { FormulaEngine } = await import("./formula-engine.mjs");
        const _crSpec = action.target != null ? _injectRuntime(String(action.target)) : action.target;
        let a = _sdResolveActor(_crSpec, actor);
        if (!a) {
          a = _crSpec === "token_target"
            ? _resolveTarget("token_target", actor)
            : (_crSpec === "actor" ? actor : (item?.actor ?? actor));
        }
        if (!a) break;
        const path = action.path ?? "system.resources.mp.value";
        const cur  = Number(foundry.utils.getProperty(a, path)) || 0;
        let cost   = action.amount ?? 1;
        try {
          let s = _injectRuntime(String(cost));
          s = FormulaEngine.resolveForRoll(s, a);
          cost = Number(FormulaEngine.evaluate(s, a)) || 1;
        } catch { cost = 1; }
        if (cur < cost) {
          for (const sub of (action.emptyActions ?? [])) {
            await this._runAction(sub, item, actor, buttonDef, runtime);
          }
        } else {
          await a.update({ [path]: cur - cost });
          for (const sub of (action.okActions ?? [])) {
            await this._runAction(sub, item, actor, buttonDef, runtime);
          }
        }
        break;
      }

      case "openSheet": {
        let uuid = _injectRuntime(String(action.uuid ?? ""));
        try {
          const { FormulaEngine } = await import("./formula-engine.mjs");
          uuid = String(FormulaEngine.evaluate(uuid, item ?? actor ?? {}));
        } catch { /* use raw */ }
        if (!uuid) break;
        try {
          const doc = await fromUuid(uuid);
          if (!doc) { ui.notifications.warn(`SD | Open Sheet: UUID not found — ${uuid}`); break; }
          if (action.asOwner !== false && !doc.isOwner && !game.user.isGM) {
            ui.notifications.warn("SD | Open Sheet: you do not own this document."); break;
          }
          doc.sheet?.render(true);
        } catch(e) { console.error("SD | openSheet:", e); }
        break;
      }

      case "rollTable": {
        const { FormulaEngine } = await import("./formula-engine.mjs");
        let table = null;
        if (action.tableUuid) {
          try { table = await fromUuid(action.tableUuid); } catch { /* fall through */ }
        }
        if (!table && action.tableName) {
          table = game.tables.getName(action.tableName);
        }
        if (!table) {
          ui.notifications.warn(`SD | Roll Table: table not found — "${action.tableName || action.tableUuid}"`);
          // Empty branch
          for (const sub of (action.emptyActions ?? [])) {
            await this._runAction(sub, item, actor, buttonDef, runtime);
          }
          break;
        }

        let formula = _injectRuntime(String(action.formula ?? "1d6"));
        try { formula = FormulaEngine.resolveForRoll(formula, item ?? actor ?? {}); } catch { /* raw */ }

        let drawCount = 1;
        try {
          let dcStr = _injectRuntime(String(action.drawCount ?? 1));
          dcStr = FormulaEngine.resolveForRoll(dcStr, item ?? actor ?? {});
          drawCount = Math.max(1, Math.round(Number(FormulaEngine.evaluate(dcStr, item ?? actor ?? {})) || 1));
        } catch { drawCount = 1; }

        const available = table.results?.filter(r => action.replacement !== false || !r.drawn);
        if (!available?.length) {
          runtime.__lastRollTableResult = "";
          for (const sub of (action.emptyActions ?? [])) {
            await this._runAction(sub, item, actor, buttonDef, runtime);
          }
          break;
        }

        // Draw all results
        const allResults = [];
        for (let i = 0; i < drawCount; i++) {
          const draw = await table.roll({ roll: new Roll(formula) });
          if (action.toChat !== false) await table.draw({ roll: draw.roll, results: draw.results, displayChat: true });
          const text = draw.results?.[0]?.text ?? draw.results?.[0]?.getChatText?.() ?? "";
          allResults.push(text);
          runtime.__lastRollTableResult = text;
          runtime.__rollTableIndex = i;

          for (const sub of (action.foundActions ?? [])) {
            await this._runAction(sub, item, actor, buttonDef, runtime);
          }
        }

        runtime.__lastRollTableResult = allResults[0] ?? "";
        runtime.__rollTableIndex = undefined;
        break;
      }

      case "forLoop": {
        const { FormulaEngine } = await import("./formula-engine.mjs");
        const _evalNum = (raw, fb = 0) => {
          try {
            let s = _injectRuntime(String(raw));
            s = FormulaEngine.resolveForRoll(s, item ?? actor ?? {});
            return Math.max(0, Math.round(Number(FormulaEngine.evaluate(s, item ?? actor ?? {})) || 0));
          } catch { return fb; }
        };
        const count = _evalNum(action.count ?? 3, 0);
        const delay = _evalNum(action.delay ?? 0, 0);
        const bodyKey = Array.isArray(action.bodyActions) ? "bodyActions" : "loopActions";
        for (let i = 0; i < count; i++) {
          runtime.__loopIndex = i;
          for (const sub of (action[bodyKey] ?? [])) {
            await this._runAction(sub, item, actor, buttonDef, runtime);
          }
          if (delay > 0 && i < count - 1) await new Promise(r => setTimeout(r, delay));
        }
        runtime.__loopIndex = undefined;
        for (const sub of (action.doneActions ?? [])) {
          await this._runAction(sub, item, actor, buttonDef, runtime);
        }
        break;
      }

      case "delay": {
        const { FormulaEngine } = await import("./formula-engine.mjs");
        let ms = 0;
        try {
          let s = _injectRuntime(String(action.duration ?? "0"));
          s = FormulaEngine.resolveForRoll(s, item ?? actor ?? {});
          ms = Math.max(0, Math.round(Number(FormulaEngine.evaluate(s, item ?? actor ?? {})) || 0));
        } catch { ms = 0; }
        if (ms > 0) await new Promise(r => setTimeout(r, Math.min(ms, 60000)));
        break;
      }

      case "waitForEvent": {
        const { FormulaEngine } = await import("./formula-engine.mjs");
        let ms = 0;
        try {
          let s = _injectRuntime(String(action.timeout ?? "0"));
          s = FormulaEngine.resolveForRoll(s, item ?? actor ?? {});
          ms = Math.max(0, Math.round(Number(FormulaEngine.evaluate(s, item ?? actor ?? {})) || 0));
        } catch { ms = 0; }
        const hook = String(action.hook ?? "updateCombat");
        const fired = await new Promise(resolve => {
          let settled = false;
          const id = Hooks.once(hook, () => { if (!settled) { settled = true; resolve(true); } });
          if (ms > 0) setTimeout(() => {
            if (settled) return;
            settled = true;
            try { Hooks.off(hook, id); } catch {}
            resolve(false);
          }, Math.min(ms, 600000));
        });
        const branch = fired ? (action.doneActions ?? []) : (action.timedOutActions ?? []);
        for (const sub of branch) await this._runAction(sub, item, actor, buttonDef, runtime);
        break;
      }

      case "castToActor": {
        const { FormulaEngine } = await import("./formula-engine.mjs");
        let uuid = "";
        try {
          uuid = String(FormulaEngine.evaluate(
            FormulaEngine.resolveForRoll(_injectRuntime(String(action.value ?? "")), item ?? actor ?? {}),
            item ?? actor ?? {}
          ));
        } catch { uuid = String(action.value ?? ""); }
        let resolved = null;
        try { resolved = uuid ? await fromUuid(uuid) : null; } catch { resolved = null; }
        const ok = resolved && resolved instanceof Actor;
        if (ok) runtime.__castActorId = resolved.id;
        const branch = ok ? (action.okActions ?? []) : (action.failActions ?? []);
        for (const sub of branch) await this._runAction(sub, item, actor, buttonDef, runtime);
        runtime.__castActorId = undefined;
        break;
      }

      case "castToItem": {
        const { FormulaEngine } = await import("./formula-engine.mjs");
        let uuid = "";
        try {
          uuid = String(FormulaEngine.evaluate(
            FormulaEngine.resolveForRoll(_injectRuntime(String(action.value ?? "")), item ?? actor ?? {}),
            item ?? actor ?? {}
          ));
        } catch { uuid = String(action.value ?? ""); }
        let resolved = null;
        try { resolved = uuid ? await fromUuid(uuid) : null; } catch { resolved = null; }
        const ok = resolved && resolved instanceof Item;
        if (ok) runtime.__castItemId = resolved.id;
        const branch = ok ? (action.okActions ?? []) : (action.failActions ?? []);
        for (const sub of branch) await this._runAction(sub, item, actor, buttonDef, runtime);
        runtime.__castItemId = undefined;
        break;
      }

      case "macroCall": {
        const { FormulaEngine } = await import("./formula-engine.mjs");
        const macros = buttonDef?.__macros ?? {};
        const mid    = String(action.macroId ?? "");
        const body   = Array.isArray(macros[mid]) ? macros[mid] : null;
        if (!body) {
          console.warn("SD | macroCall: macro not found", mid);
          for (const sub of (action.execActions ?? [])) await this._runAction(sub, item, actor, buttonDef, runtime);
          break;
        }
        const resolvedArgs = {};
        for (const k of ["a","b","c","d"]) {
          const raw = action.args?.[k] ?? "0";
          try {
            const s = FormulaEngine.resolveForRoll(_injectRuntime(String(raw)), item ?? actor ?? {});
            resolvedArgs[k] = String(FormulaEngine.evaluate(s, item ?? actor ?? {}) ?? 0);
          } catch { resolvedArgs[k] = String(raw); }
        }
        const stack = runtime.__macroStack ?? (runtime.__macroStack = []);
        stack.push(resolvedArgs);
        const prevRetA = runtime.__macroRetA;
        const prevRetB = runtime.__macroRetB;
        runtime.__macroRetA = undefined;
        runtime.__macroRetB = undefined;
        try {
          for (const sub of body) await this._runAction(sub, item, actor, buttonDef, runtime);
        } finally {
          stack.pop();
        }
        for (const sub of (action.execActions ?? [])) {
          await this._runAction(sub, item, actor, buttonDef, runtime);
        }
        runtime.__macroRetA = prevRetA;
        runtime.__macroRetB = prevRetB;
        break;
      }

      case "macroReturn": {
        const { FormulaEngine } = await import("./formula-engine.mjs");
        for (const [k, field] of [["a","__macroRetA"],["b","__macroRetB"]]) {
          const raw = action[k] ?? "0";
          try {
            const s = FormulaEngine.resolveForRoll(_injectRuntime(String(raw)), item ?? actor ?? {});
            runtime[field] = String(FormulaEngine.evaluate(s, item ?? actor ?? {}) ?? 0);
          } catch { runtime[field] = String(raw); }
        }
        break;
      }

      case "whileLoop": {
        const { FormulaEngine } = await import("./formula-engine.mjs");
        const maxIter = Math.max(1, Math.min(100, Math.round(Number(action.maxIter) || 20)));
        let i = 0;
        while (i < maxIter) {
          let condVal;
          try {
            let s = _injectRuntime(String(action.condition ?? "0"));
            s = FormulaEngine.resolveForRoll(s, item ?? actor ?? {});
            condVal = FormulaEngine.evaluate(s, item ?? actor ?? {});
          } catch { condVal = 0; }
          const isFalsy = !condVal || condVal === "false" || condVal === "0" || condVal === 0 || condVal === false;
          if (isFalsy) break;
          runtime.__loopIndex = i;
          for (const sub of (action.loopActions ?? [])) {
            await this._runAction(sub, item, actor, buttonDef, runtime);
          }
          i++;
        }
        runtime.__loopIndex = undefined;
        for (const sub of (action.doneActions ?? [])) {
          await this._runAction(sub, item, actor, buttonDef, runtime);
        }
        break;
      }

      case "switchExec": {
        const { FormulaEngine } = await import("./formula-engine.mjs");
        let val = _injectRuntime(String(action.value ?? "0"));
        try {
          val = String(FormulaEngine.evaluate(
            FormulaEngine.resolveForRoll(val, item ?? actor ?? {}),
            item ?? actor ?? {}
          ));
        } catch { /* raw string */ }
        const cases  = action.cases  ?? [];
        const matched = cases.findIndex(c => String(c) === val);
        const branch = matched >= 0
          ? (action[`case${matched}Actions`] ?? [])
          : (action.defaultActions ?? []);
        for (const sub of branch) {
          await this._runAction(sub, item, actor, buttonDef, runtime);
        }
        break;
      }

      case "sequence4": {
        for (const key of ["aActions","bActions","cActions","dActions"]) {
          for (const sub of (action[key] ?? [])) {
            await this._runAction(sub, item, actor, buttonDef, runtime);
          }
        }
        break;
      }

      // Dialog Switch
      case "dialogSwitch": {
        const outputs = (action.outputs ?? []).filter(o => o?.label);
        if (!outputs.length) break;

        const title       = action.title ?? "Choose";
        const description = action.description ?? "";
        const { DialogV2 } = foundry.applications.api;

        const dlgButtons = outputs.map((out, i) => ({
          action:  String(i),
          label:   out.label ?? `Option ${i + 1}`,
          icon:    "fas fa-play",
          default: i === 0
        }));

        const chosen = await DialogV2.wait({
          window:       { title },
          content:      description
            ? `<p style="padding:6px 2px 10px;color:#c0c0d8;font-size:12px;line-height:1.5">${description}</p>`
            : `<div style="height:6px"></div>`,
          buttons:      dlgButtons,
          rejectClose:  false
        }).catch(() => null);

        if (chosen === null || chosen === undefined) break;
        const idx    = parseInt(chosen);
        const branch = outputs[idx]?.actions ?? [];
        for (const sub of branch) {
          await this._runAction(sub, item, actor, buttonDef, runtime);
        }
        break;
      }

      case "dialogSelectArray": {
        const items = await _sdResolveItems(action.items, actor);
        if (!items.length) {
          ui.notifications?.warn?.("SD | Dialog Select: items array is empty.");
          for (const sub of (action.cancelActions ?? [])) {
            await this._runAction(sub, item, actor, buttonDef, runtime);
          }
          break;
        }

        const title       = action.title       ?? "Choose";
        const description = action.description ?? "";
        const labelPath   = action.labelPath   ?? "name";
        const { DialogV2 } = foundry.applications.api;

        const dlgButtons = items.map((it, i) => ({
          action:  String(i),
          label:   _sdItemLabel(it, labelPath, i),
          icon:    "fas fa-play",
          default: i === 0
        }));

        const chosen = await DialogV2.wait({
          window:      { title },
          content:     description
            ? `<p style="padding:6px 2px 10px;color:#c0c0d8;font-size:12px;line-height:1.5">${description}</p>`
            : `<div style="height:6px"></div>`,
          buttons:     dlgButtons,
          rejectClose: false
        }).catch(() => null);

        if (chosen === null || chosen === undefined) {
          for (const sub of (action.cancelActions ?? [])) {
            await this._runAction(sub, item, actor, buttonDef, runtime);
          }
          break;
        }

        const idx = parseInt(chosen);
        const sel = items[idx];
        // Coerce selected item to a transportable token (uuid > id > string)
        const selToken = (sel && typeof sel === "object")
          ? (sel.uuid ?? sel.id ?? sel.name ?? "")
          : (sel ?? "");
        const childRuntime = {
          ...runtime,
          __sdSelectedItem:  selToken,
          __sdSelectedIndex: idx
        };
        for (const sub of (action.selActions ?? [])) {
          await this._runAction(sub, item, actor, buttonDef, childRuntime);
        }
        break;
      }

      case "dialogTextInput": {
        const title       = action.title       ?? "Enter text";
        const description = action.description ?? "";
        const dflt        = action.default     ?? "";
        const { DialogV2 } = foundry.applications.api;

        const content = `
          ${description ? `<p style="padding:6px 2px 8px;color:#c0c0d8;font-size:12px;line-height:1.5">${description}</p>` : ""}
          <input type="text" name="sd-dlg-text" value="${String(dflt).replace(/"/g,"&quot;")}"
                 style="width:100%;box-sizing:border-box;padding:6px 8px;background:#1d1d27;color:#e8e8f0;border:1px solid #3a3a4a;border-radius:4px;margin-bottom:6px"/>
        `;

        const result = await DialogV2.wait({
          window:      { title },
          content,
          buttons: [
            { action:"ok",     label:"OK",     icon:"fas fa-check", default:true,
              callback: (_e, _btn, dlg) => dlg.element.querySelector('input[name="sd-dlg-text"]')?.value ?? "" },
            { action:"cancel", label:"Cancel", icon:"fas fa-times" }
          ],
          rejectClose: false
        }).catch(() => null);

        if (result === null || result === undefined || result === "cancel") {
          for (const sub of (action.cancelActions ?? [])) {
            await this._runAction(sub, item, actor, buttonDef, runtime);
          }
          break;
        }
        const childRuntime = { ...runtime, __sdInputText: String(result ?? "") };
        for (const sub of (action.okActions ?? [])) {
          await this._runAction(sub, item, actor, buttonDef, childRuntime);
        }
        break;
      }

      case "dialogConfirm": {
        const title    = action.title    ?? "Confirm";
        const message  = action.message  ?? "";
        const yesLabel = action.yesLabel ?? "Yes";
        const noLabel  = action.noLabel  ?? "No";
        const { DialogV2 } = foundry.applications.api;

        const choice = await DialogV2.wait({
          window:      { title },
          content:     message
            ? `<p style="padding:6px 2px 10px;color:#c0c0d8;font-size:12px;line-height:1.5">${message}</p>`
            : `<div style="height:6px"></div>`,
          buttons: [
            { action:"yes", label:yesLabel, icon:"fas fa-check", default:true },
            { action:"no",  label:noLabel,  icon:"fas fa-times" }
          ],
          rejectClose: false
        }).catch(() => null);

        const branch = (choice === "yes")
          ? (action.yesActions ?? [])
          : (action.noActions  ?? []);
        for (const sub of branch) {
          await this._runAction(sub, item, actor, buttonDef, runtime);
        }
        break;
      }


      // Create Effect
      case "createEffect": {
        const _ceSpec = action.target != null ? _injectRuntime(String(action.target)) : null;
        const targets = _resolveAllTargets(_ceSpec ?? "token_target", actor);
        if (!targets.length) { ui.notifications.warn("SD | Create Effect: no target."); break; }
        const rounds = Number(action.duration ?? 0);
        const effectData = {
          name:     action.name     ?? "New Effect",
          img:      action.icon     ?? "icons/svg/aura.svg",
          disabled: !!action.disabled,
          transfer: action.transfer !== false,
          duration: rounds > 0 ? { rounds } : {},
          changes:  (action.changes ?? []).filter(c => c.key),
          origin:   item?.uuid ?? actor?.uuid ?? "",
          flags:    { sd: { sourceItemId: item?.id ?? "" } }
        };
        for (const tActor of targets) {
          if (!tActor) continue;
          if (!game.user.isGM && !tActor.isOwner) continue;
          await tActor.createEmbeddedDocuments("ActiveEffect", [effectData]);
        }
        break;
      }

      case "removeEffect": {
        const effectName = action.name ?? action.effectName ?? "";
        if (!effectName) break;
        const _reSpec = action.target != null ? _injectRuntime(String(action.target)) : null;
        const targets = _resolveAllTargets(_reSpec ?? "token_target", actor);
        for (const tActor of targets) {
          if (!tActor || (!game.user.isGM && !tActor.isOwner)) continue;
          const toDelete = tActor.effects.filter(e => e.name === effectName).map(e => e.id);
          if (toDelete.length) await tActor.deleteEmbeddedDocuments("ActiveEffect", toDelete);
        }
        break;
      }

      // Toggle Effect
      case "toggleEffect": {
        const effectName = action.name ?? "";
        if (!effectName) break;
        const _teSpec = action.target != null ? _injectRuntime(String(action.target)) : null;
        const targets = _resolveAllTargets(_teSpec ?? "token_target", actor);
        for (const tActor of targets) {
          if (!tActor || (!game.user.isGM && !tActor.isOwner)) continue;
          for (const ef of tActor.effects) {
            if (ef.name !== effectName) continue;
            const newState = action.state === "enable" ? false
                           : action.state === "disable" ? true
                           : !ef.disabled;
            await ef.update({ disabled: newState });
          }
        }
        break;
      }

      case "setInitiative": {
        const combat = game.combat;
        if (!combat) {
          ui.notifications?.warn?.("Set Initiative: no active combat.");
          break;
        }
        const _siSpec = action.target != null ? _injectRuntime(String(action.target)) : null;
        const targets = _resolveAllTargets(_siSpec ?? "actor", actor);
        for (const tActor of targets) {
          if (!tActor) continue;
          const token = tActor.getActiveTokens?.()?.[0]?.document
                     ?? canvas?.tokens?.placeables?.find?.(t => t.actor?.id === tActor.id)?.document;
          let combatant = combat.combatants.find(c => c.actorId === tActor.id);
          if (!combatant) {
            const created = await combat.createEmbeddedDocuments("Combatant", [{
              actorId: tActor.id,
              tokenId: token?.id ?? null,
              sceneId: token?.parent?.id ?? canvas?.scene?.id ?? null
            }]);
            combatant = created?.[0];
          }
          if (!combatant) continue;
          if (action.mode === "value") {
            const v = Number(action.value ?? 0) || 0;
            await combat.setInitiative(combatant.id, v);
          } else {
            await combat.rollInitiative([combatant.id]);
          }
        }
        break;
      }

      case "applyStatus": {
        const raw = String(action.statusId ?? "").trim();
        if (!raw) break;
        const reg = (CONFIG.statusEffects ?? []);
        const match = reg.find(s => s.id === raw)
                   ?? reg.find(s => (s.label ?? s.name ?? "").toLowerCase() === raw.toLowerCase())
                   ?? reg.find(s => game.i18n?.localize?.(s.label ?? s.name ?? "")?.toLowerCase?.() === raw.toLowerCase());
        const statusId = match?.id ?? raw;
        const _asSpec = action.target != null ? _injectRuntime(String(action.target)) : null;
        const targets  = _resolveAllTargets(_asSpec ?? "token_target", actor);
        for (const tActor of targets) {
          if (!tActor || (!game.user.isGM && !tActor.isOwner)) continue;
          const has = tActor.statuses?.has?.(statusId);
          let active;
          if (action.mode === "remove") active = false;
          else if (action.mode === "toggle") active = !has;
          else active = true;
          try {
            await tActor.toggleStatusEffect(statusId, { active, overlay: !!action.overlay });
          } catch (err) {
            console.warn(`SD | applyStatus failed for ${tActor.name}/${statusId}:`, err);
          }
        }
        break;
      }

      case "placeAura":
      case "placeAuraEffect":
      case "placeAuraDamage":
      case "placeAuraHeal":
      case "placeAuraSaveEffect":
      case "placeAuraSaveBranch": {
        if (!canvas?.scene) break;
        action = {
          ...action,
          formula:      action.formula      != null ? _injectRuntime(String(action.formula))      : action.formula,
          bonusFormula: action.bonusFormula != null ? _injectRuntime(String(action.bonusFormula)) : action.bonusFormula,
          advFormula:   action.advFormula   != null ? _injectRuntime(String(action.advFormula))   : action.advFormula,
          disFormula:   action.disFormula   != null ? _injectRuntime(String(action.disFormula))   : action.disFormula,
          dc:           action.dc           != null ? _injectRuntime(String(action.dc))           : action.dc
        };
        // Токен хозяина
        let ownerToken = null;
        if (action.owner === "selected_token") {
          ownerToken = canvas.tokens?.controlled?.[0] ?? null;
        } else if (action.owner === "token_target") {
          const first = game.user?.targets ? [...game.user.targets][0] : null;
          ownerToken = first ?? null;
        } else {
          ownerToken = actor?.getActiveTokens?.()?.[0] ?? canvas.tokens?.controlled?.[0] ?? null;
        }
        if (!ownerToken) {
          ui.notifications?.warn?.("Place Aura: no owner token found.");
          break;
        }
        const { buildEmanationShape, buildShape, placeAuraRegion } =
          await import("./sd-region.mjs");

        const shapeKind = action.shape ?? "emanation";
        const size      = Number(action.size ?? 10) || 10;
        const auraKey   = String(action.auraKey ?? "aura");
        const effName   = String(action.name    ?? "Aura");
        const rounds    = Number(action.rounds  ?? 0) || 0;

        const modeMap = {
          placeAuraEffect:      "effect",
          placeAuraDamage:      "damage",
          placeAuraHeal:        "heal",
          placeAuraSaveEffect:  "save-effect",
          placeAuraSaveBranch:  "save-branch"
        };
        const mode = modeMap[action.type] ?? action.mode ?? "effect";

        const shape = shapeKind === "emanation"
          ? buildEmanationShape(ownerToken.document, size)
          : buildShape(shapeKind, size, Number(action.angle ?? 53.13));

        const applyEffect = {
          mode,
          effectName:        effName || "Aura",
          effectImg:         action.icon ?? "icons/svg/aura.svg",
          auraKey,
          skipOwner:         action.skipOwner !== false,
          ownerTokenId:      ownerToken.id,
          changes:           Array.isArray(action.changes) ? action.changes : [],
          tickMode:          action.tickMode ?? "onEnter",
          showInChat:        action.showInChat !== false,
          chatMode:          action.chatMode ?? "auto",
          applyMode:         action.applyMode ?? "auto",
          rollApplyMode:     action.rollApplyMode ?? "per_target",
          visibility:        action.visibility ?? "everyone",
          deactivateOnLeave: action.deactivateOnLeave !== false,
          conditionEffect:   action.conditionEffect ?? "",
          roundsRemaining:   rounds,
          // damage/heal specifics
          formula:           action.formula      ?? "",
          bonusFormula:      action.bonusFormula ?? "",
          damageType:        action.damageType   ?? "",
          hpPath:            action.hpPath       ?? "system.resources.hp.value",
          hpMode:            action.hpMode       ?? "add",
          saveAttr:          action.saveAttr    ?? "system.attributes.dex.value",
          dc:                (v => Number.isFinite(v) ? v : 15)(Number(action.dc  ?? 15)),
          flavor:            action.flavor      ?? "Saving Throw",
          advMode:           action.advMode     ?? "none",
          advFormula:        action.advFormula  ?? "",
          disFormula:        action.disFormula  ?? "",
          // save-branch specifics
          rollMode:          action.rollMode    ?? "public",
          postActions:       action.postActions ?? [],
          srcActorId:        actor?.id          ?? "",
          srcItemUuid:       item?.uuid         ?? "",
          runtimeSnapshot:   (() => {
            if (!buttonDef) return null;
            const o = {};
            for (const k of ["__lastRoll","__lastMargin","__lastSuccesses","__lastBotches","__progPrev","__opposedWinnerRoll"]) {
              if (buttonDef[k] !== undefined) o[k] = buttonDef[k];
            }
            return Object.keys(o).length ? o : null;
          })()
        };

        try {
          await placeAuraRegion({
            ownerToken,
            shape,
            name: effName || "SD Aura",
            flags: {
              sd: {
                aura: {
                  key:          auraKey,
                  ownerTokenId: ownerToken.id,
                  ownerSceneId: canvas.scene.id,
                  effectName:   effName
                },
                applyEffect
              }
            }
          });
        } catch (e) {
          console.error("SD | placeAura failed:", e);
        }
        break;
      }

      case "placeAoeEffect":
      case "placeAoeDamage":
      case "placeAoeHeal":
      case "placeAoeSaveEffect": {
        action = {
          ...action,
          formula:      action.formula      != null ? _injectRuntime(String(action.formula))      : action.formula,
          bonusFormula: action.bonusFormula != null ? _injectRuntime(String(action.bonusFormula)) : action.bonusFormula,
          advFormula:   action.advFormula   != null ? _injectRuntime(String(action.advFormula))   : action.advFormula,
          disFormula:   action.disFormula   != null ? _injectRuntime(String(action.disFormula))   : action.disFormula,
          dc:           action.dc           != null ? _injectRuntime(String(action.dc))           : action.dc
        };
        const modeMap = {
          placeAoeEffect:     "effect",
          placeAoeDamage:     "damage",
          placeAoeHeal:       "heal",
          placeAoeSaveEffect: "save-effect"
        };
        const mode       = modeMap[action.type];
        const shape      = action.shape ?? "circle";
        const size       = Number(action.size   ?? 20)    || 20;
        const angle      = Number(action.angle  ?? 53.13) || 53.13;
        const rounds     = Number(action.rounds ?? 0)     || 0;
        const effName    = String(action.name ?? "AoE");
        const cardTitle  = String(action.cardTitle ?? effName);
        const shapeIcon  = { circle:"fa-circle", cone:"fa-ice-cream", ray:"fa-arrows-alt-h", rect:"fa-square" }[shape] ?? "fa-circle";

        const persist = action.persist !== false;
        const cfg = JSON.stringify({
          type: "aoeRegion",
          mode,
          shape,
          size,
          angle,
          rounds,
          persist,
          effectName:        effName,
          effectImg:         action.icon ?? "icons/svg/aura.svg",
          changes:           Array.isArray(action.changes) ? action.changes : [],
          tickMode:          action.tickMode ?? "onEnter",
          showInChat:        action.showInChat !== false,
          chatMode:          action.chatMode ?? "auto",
          applyMode:         action.applyMode ?? "auto",
          rollApplyMode:     action.rollApplyMode ?? "per_target",
          visibility:        action.visibility ?? "everyone",
          deactivateOnLeave: action.deactivateOnLeave !== false,
          conditionEffect:   action.conditionEffect ?? "",
          formula:           action.formula      ?? "",
          bonusFormula:      action.bonusFormula ?? "",
          damageType:        action.damageType   ?? "",
          hpPath:            action.hpPath       ?? "system.resources.hp.value",
          hpMode:            action.hpMode       ?? "add",
          saveAttr:          action.saveAttr    ?? "system.attributes.dex.value",
          dc:                (v => Number.isFinite(v) ? v : 15)(Number(action.dc ?? 15)),
          flavor:            action.flavor     ?? "Saving Throw",
          advMode:           action.advMode    ?? "none",
          advFormula:        action.advFormula ?? "",
          disFormula:        action.disFormula ?? "",
          srcActorId:        actor?.id ?? ""
        }).replace(/'/g, "&#39;");

        const modeLabel = {
          effect:        "Effect",
          damage:        "Damage",
          heal:          "Heal",
          "save-effect": "Save → Effect"
        }[mode];

        const cardHtml = `
<div class="sd-chat-aoe-card sd-chat-card sd-aoe-card" style="background:#f0ebe4;color:#191813;border:1px solid #b5b3a4;border-radius:4px;padding:8px 10px;font-family:'Signika',sans-serif;">
  <header class="sd-chat-aoe-header" style="background:transparent;color:#191813;display:flex;align-items:center;gap:8px;padding:0 0 6px 0;margin:0 0 8px 0;border-bottom:1px solid #b5b3a4;font-size:14px;font-weight:600;">
    <i class="fas fa-burst" style="opacity:.75;"></i>
    <strong style="color:#191813;">${cardTitle}</strong>
    <span class="sd-chat-aoe-mode" style="color:#555;font-weight:400;"> — ${modeLabel}</span>
  </header>
  <div class="sd-chat-aoe-info" style="color:#191813;display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;font-size:12px;margin-bottom:8px;">
    <span style="color:#191813;"><i class="fas ${shapeIcon}" style="opacity:.6;margin-right:4px;"></i>${shape}</span>
    <span style="color:#191813;"><i class="fas fa-ruler" style="opacity:.6;margin-right:4px;"></i>${size} ft</span>
    ${action.formula ? `<span style="color:#191813;"><i class="fas fa-dice-d20" style="opacity:.6;margin-right:4px;"></i>${action.formula}${action.damageType ? ` (${action.damageType})` : ""}</span>` : ""}
    ${mode === "save-effect" ? `<span style="color:#191813;"><i class="fas fa-shield-alt" style="opacity:.6;margin-right:4px;"></i>DC ${Number(action.dc ?? 15)}</span>` : ""}
    ${rounds ? `<span style="color:#191813;"><i class="fas fa-clock" style="opacity:.6;margin-right:4px;"></i>${rounds} rd</span>` : ""}
  </div>
  <button type="button" class="sd-chat-aoe-place-btn" data-aoe-region-cfg='${cfg}' style="width:100%;padding:8px;background:#e0dcd4;color:#191813;border:1px solid #7a7971;border-radius:4px;font-weight:600;font-size:13px;cursor:pointer;">
    <i class="fas fa-crosshairs"></i> Place Template
  </button>
</div>`;

        await ChatMessage.create({
          content: cardHtml,
          speaker: ChatMessage.getSpeaker({ actor }),
          flags:   { sd: { aoeRegion: true } }
        });
        break;
      }

      // AoE -- Save Branch
      case "placeAoeSaveBranch": {
        action = {
          ...action,
          dc:           action.dc           != null ? _injectRuntime(String(action.dc))           : action.dc,
          advFormula:   action.advFormula   != null ? _injectRuntime(String(action.advFormula))   : action.advFormula,
          disFormula:   action.disFormula   != null ? _injectRuntime(String(action.disFormula))   : action.disFormula,
          bonusFormula: action.bonusFormula != null ? _injectRuntime(String(action.bonusFormula)) : action.bonusFormula
        };
        const shape       = action.shape ?? "circle";
        const size        = Number(action.size  ?? 20)    || 20;
        const angle       = Number(action.angle ?? 53.13) || 53.13;
        const cardTitle   = String(action.cardTitle ?? "AoE Save");
        const shapeIcon   = { circle:"fa-circle", cone:"fa-ice-cream", ray:"fa-arrows-alt-h", rect:"fa-square" }[shape] ?? "fa-circle";

        const _rtSnap = (() => {
          if (!buttonDef) return null;
          const o = {};
          for (const k of ["__lastRoll","__lastMargin","__lastSuccesses","__lastBotches","__progPrev","__opposedWinnerRoll"]) {
            if (buttonDef[k] !== undefined) o[k] = buttonDef[k];
          }
          return Object.keys(o).length ? o : null;
        })();

        const cfg = JSON.stringify({
          type:         "aoeSaveBranch",
          shape, size, angle,
          saveAttr:     action.saveAttr ?? "system.attributes.dex.value",
          dc:           (v => Number.isFinite(v) ? v : 15)(Number(action.dc ?? 15)),
          flavor:       action.flavor    ?? "Saving Throw",
          rollMode:     action.rollMode  ?? "public",
          showInChat:   action.showInChat !== false,
          advMode:      action.advMode    ?? "none",
          advFormula:   action.advFormula ?? "",
          disFormula:   action.disFormula ?? "",
          bonusFormula: action.bonusFormula ?? "",
          persist:      action.persist === true,
          postActions:  action.postActions ?? [],
          runtimeSnapshot: _rtSnap,
          srcActorId:   actor?.id ?? "",
          srcItemUuid:  item?.uuid ?? ""
        }).replace(/'/g, "&#39;");

        const cardHtml = `
<div class="sd-chat-aoe-card sd-chat-card sd-aoe-card" style="background:#f0ebe4;color:#191813;border:1px solid #b5b3a4;border-radius:4px;padding:8px 10px;font-family:'Signika',sans-serif;">
  <header class="sd-chat-aoe-header" style="background:transparent;color:#191813;display:flex;align-items:center;gap:8px;padding:0 0 6px 0;margin:0 0 8px 0;border-bottom:1px solid #b5b3a4;font-size:14px;font-weight:600;">
    <i class="fas fa-burst" style="opacity:.75;"></i>
    <strong style="color:#191813;">${cardTitle}</strong>
    <span class="sd-chat-aoe-mode" style="color:#555;font-weight:400;"> — Save Branch</span>
  </header>
  <div class="sd-chat-aoe-info" style="color:#191813;display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;font-size:12px;margin-bottom:8px;">
    <span style="color:#191813;"><i class="fas ${shapeIcon}" style="opacity:.6;margin-right:4px;"></i>${shape}</span>
    <span style="color:#191813;"><i class="fas fa-ruler" style="opacity:.6;margin-right:4px;"></i>${size} ft</span>
    <span style="color:#191813;"><i class="fas fa-shield-alt" style="opacity:.6;margin-right:4px;"></i>DC ${Number(action.dc ?? 15)}</span>
  </div>
  <div class="sd-chat-aoe-results" style="display:none;color:#191813;font-size:12px;margin-bottom:8px;"></div>
  <button type="button" class="sd-chat-aoe-save-branch-btn" data-aoe-save-branch-cfg='${cfg}' style="width:100%;padding:8px;background:#e0dcd4;color:#191813;border:1px solid #7a7971;border-radius:4px;font-weight:600;font-size:13px;cursor:pointer;">
    <i class="fas fa-crosshairs"></i> Place Template
  </button>
</div>`;

        await ChatMessage.create({
          content: cardHtml,
          speaker: ChatMessage.getSpeaker({ actor }),
          flags:   { sd: { aoeSaveBranch: true } }
        });
        break;
      }

      case "removeAura": {
        if (!canvas?.scene) break;
        let ownerToken = null;
        if (action.owner === "selected_token") {
          ownerToken = canvas.tokens?.controlled?.[0] ?? null;
        } else if (action.owner === "token_target") {
          const first = game.user?.targets ? [...game.user.targets][0] : null;
          ownerToken = first ?? null;
        } else {
          ownerToken = actor?.getActiveTokens?.()?.[0] ?? canvas.tokens?.controlled?.[0] ?? null;
        }
        if (!ownerToken) break;
        const key = String(action.auraKey ?? "aura");

        const matchedRegions = (canvas.scene.regions ?? []).filter(r => {
          const a = r.flags?.sd?.aura;
          if (!a) return false;
          if (a.key !== key) return false;
          if (a.ownerTokenId && a.ownerTokenId !== ownerToken.id) return false;
          return true;
        });
        const regionIds = matchedRegions.map(r => r.id);
        const effNames  = [...new Set(matchedRegions.map(r => r.flags?.sd?.aura?.effectName).filter(Boolean))];

        if (regionIds.length) {
          try { await canvas.scene.deleteEmbeddedDocuments("Region", regionIds); } catch (e) {
            console.warn("SD | removeAura: deleteRegion failed:", e);
          }
        }

        const legacyMatched = (canvas.scene.templates ?? []).filter(t => {
          const a = t.flags?.sd?.aura;
          return a && a.ownerTokenId === ownerToken.id && a.key === key;
        });
        if (legacyMatched.length) {
          for (const t of legacyMatched) {
            const n = t.flags?.sd?.aura?.effectName;
            if (n) effNames.push(n);
          }
          try {
            await canvas.scene.deleteEmbeddedDocuments("MeasuredTemplate",
              legacyMatched.map(t => t.id));
          } catch {}
        }

        for (const effName of effNames) {
          for (const tok of canvas.tokens?.placeables ?? []) {
            const a = tok.actor;
            if (!a) continue;
            const ids = a.effects
              .filter(e => e.name === effName &&
                      (e.flags?.sd?.auraKey === key
                    || e.flags?.sd?.fromAura === key))
              .map(e => e.id);
            if (ids.length && (game.user.isGM || a.isOwner)) {
              try { await a.deleteEmbeddedDocuments("ActiveEffect", ids); } catch {}
            }
          }
        }
        break;
      }

      case "aiRequest": {
        // Generic OpenAI-compatible chat completion request.
        // Works with: api.openai.com, openrouter.ai, LM Studio, Ollama (OAI compat), vLLM, etc.
        let _aiFE = null;
        try {
          const mod = await import("./formula-engine.mjs");
          _aiFE = mod?.FormulaEngine ?? null;
        } catch { /* optional */ }
        const _aiDoc = item ?? actor ?? {};
        // Narrow resolver: only substitute {widget:KEY}, {widgetPath:KEY},
        // {item:…}, {@attr}, etc. — does NOT transliterate Cyrillic and does
        // NOT mangle natural-language text the way resolveForRoll() does.
        const _aiResolveTokens = (s) => {
          if (!_aiFE) return s;
          try {
            return s.replace(/\{([^}]+)\}/g, (match, inner) => {
              try {
                const v = _aiFE._resolveToken
                  ? _aiFE._resolveToken(inner.trim(), _aiDoc)
                  : null;
                return (v == null) ? match : String(v);
              } catch { return match; }
            });
          } catch { return s; }
        };
        const _runStr = (raw) => {
          if (raw == null) return "";
          let s = String(raw);
          // 1) replace runtime tokens ({__lastRoll}, {__lastAiResponse}, …)
          try { s = _injectRuntime(s); } catch {}
          // 2) replace module tokens ({widget:KEY}, {item:…}, {@attr1}, etc.)
          //    via narrow per-token resolver (no transliteration, no math eval).
          s = _aiResolveTokens(s);
          return s;
        };
        const url        = _runStr(action.url   || "https://api.openai.com/v1/chat/completions").trim();
        let   apiKey     = _runStr(action.apiKey || "").trim();
        const model      = _runStr(action.model || "gpt-4o-mini").trim();
        const sysPrompt  = _runStr(action.systemPrompt || "");
        const userPrompt = _runStr(action.prompt || "");
        const temperature = action.temperature === "" || action.temperature == null
          ? null
          : Number(action.temperature);
        const maxTokens  = action.maxTokens === "" || action.maxTokens == null
          ? null
          : Math.max(1, Number(action.maxTokens) | 0);
        const postToChat = action.toChat === "yes" || action.toChat === true;

        // World-setting fallback for the API key (safer than embedding key on the actor)
        const settingKey = String(action.apiKeySetting ?? "").trim();
        if (!apiKey && settingKey) {
          try {
            const v = game.settings.get("sd", settingKey);
            if (v) apiKey = String(v).trim();
          } catch { /* unregistered setting — ignore */ }
        }

        runtime.__lastAiResponse = "";
        runtime.__lastAiError    = "";

        if (!url) {
          ui.notifications.warn("SD | AI Request: URL is empty.");
          for (const sub of (action.errorActions ?? [])) {
            await this._runAction(sub, item, actor, buttonDef, runtime);
          }
          break;
        }
        if (!userPrompt) {
          ui.notifications.warn("SD | AI Request: prompt is empty.");
          for (const sub of (action.errorActions ?? [])) {
            await this._runAction(sub, item, actor, buttonDef, runtime);
          }
          break;
        }

        const messages = [];
        if (sysPrompt) messages.push({ role: "system", content: sysPrompt });
        messages.push({ role: "user", content: userPrompt });

        const body = { model, messages };
        if (temperature !== null && !isNaN(temperature)) body.temperature = temperature;
        if (maxTokens   !== null && !isNaN(maxTokens))   body.max_tokens  = maxTokens;

        let responseText = "";
        let errMsg = "";
        try {
          const headers = { "Content-Type": "application/json" };
          if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

          const r = await fetch(url, {
            method:  "POST",
            headers,
            body:    JSON.stringify(body)
          });
          if (!r.ok) {
            const txt = await r.text().catch(() => "");
            throw new Error(`HTTP ${r.status} ${r.statusText} — ${txt.slice(0, 400)}`);
          }
          const data = await r.json();
          responseText =
              data?.choices?.[0]?.message?.content
            ?? data?.choices?.[0]?.text
            ?? data?.message?.content
            ?? "";
          if (typeof responseText !== "string") responseText = JSON.stringify(responseText);
        } catch (e) {
          errMsg = String(e?.message ?? e);
          console.error("SD | AI Request failed:", e);
        }

        runtime.__lastAiResponse = responseText;
        runtime.__lastAiError    = errMsg;

        if (errMsg) {
          ui.notifications.warn(`SD | AI Request failed: ${errMsg}`);
          for (const sub of (action.errorActions ?? [])) {
            await this._runAction(sub, item, actor, buttonDef, runtime);
          }
          break;
        }

        if (postToChat && responseText) {
          const flavor = action.flavor ?? "AI";
          const safeText = String(responseText)
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/\n/g, "<br>");
          await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor }),
            content: `<div class="sd-chat-card sd-ai-card"
                         style="background:#0f0f1f;border:1px solid #4a4a6a;
                                border-top:3px solid #6868c0;border-radius:6px;
                                font-family:'Signika Negative',serif;overflow:hidden;
                                box-shadow:0 2px 8px rgba(0,0,0,.5)">
                       <div style="padding:6px 12px;border-bottom:1px solid #2a2a4a;
                                   background:rgba(0,0,0,.25);font-size:11px;
                                   color:#a0a0c0;display:flex;align-items:center;gap:6px;">
                         <i class="fas fa-robot" style="color:#8080c0"></i>
                         <span style="flex:1;text-transform:uppercase;letter-spacing:.5px">${flavor}</span>
                         <span style="font-size:9px;color:#6a6a8a">${model}</span>
                       </div>
                       <div style="padding:8px 12px;font-size:12px;color:#d0d0e0;line-height:1.4;">
                         ${safeText}
                       </div>
                     </div>`
          });
        }

        for (const sub of (action.successActions ?? [])) {
          await this._runAction(sub, item, actor, buttonDef, runtime);
        }
        break;
      }

    case "chatSaveButton": {
      const { FormulaEngine } = await import("./formula-engine.mjs");
      const _csbRaw = action.target ?? "token_target";
      const tMode = typeof _csbRaw === "string" ? _injectRuntime(_csbRaw) : _csbRaw;

      let saveActors = [];
      if (tMode === "all_targets") {
        saveActors = [...(game.user.targets ?? [])].map(t => t.actor).filter(Boolean);
      } else if (tMode === "selected_tokens") {
        saveActors = (canvas?.tokens?.controlled ?? []).map(t => t.actor).filter(Boolean);
      } else {
        // _sdResolveActorsList handles UUIDs / user_character / player_actors / Get Actor / etc.
        saveActors = _sdResolveActorsList(tMode, actor);
        if (!saveActors.length) {
          const tActor = _resolveTarget(tMode, actor);
          if (tActor) saveActors = [tActor];
        }
      }

      if (!saveActors.length) {
        ui.notifications.warn("SD | Save/Check Button: no targets. Target or select tokens first.");
        break;
      }

      const dc = Number(_injectRuntime(String(action.dc ?? 15)));
      const resolvedDC = isNaN(dc) ? 15 : dc;
      const modifierPath = action.modifierPath ?? "system.attributes.attr1.mod";
      const flavor = action.flavor ?? "Saving Throw";
      const buttonLabel = action.buttonLabel ?? "Roll Save";
      const checkType = action.checkType ?? "save";
      const rollMode = action.rollMode ?? "publicroll";
      const rollDialogue = action.rollDialogue ? "yes" : "no";
      const advFormula   = action.advFormula ?? "";
      const disFormula   = action.disFormula ?? "";
      const rollFormula  = action.rollFormula  || "1d20";
      const timeout = Number(action.timeout ?? 0);

      const checkTypeLabel = {
        save:    game.i18n.localize("SD.ChatSave.Save"),
        ability: game.i18n.localize("SD.ChatSave.AbilityCheck"),
        skill:   game.i18n.localize("SD.ChatSave.SkillCheck"),
        custom:  game.i18n.localize("SD.ChatSave.CustomCheck")
      }[checkType] ?? checkType;

      // Build one row per actor
      const actorRows = saveActors.map(tActor => {
        const saveMod = Number(foundry.utils.getProperty(tActor, modifierPath) ?? 0);
        const sign    = saveMod >= 0 ? `+${saveMod}` : String(saveMod);
        const modLbl  = modifierPath.split(".").pop()?.toUpperCase() ?? "MOD";
        return `
          <div class="sd-save-actor-row" data-actor-id="${tActor.id}"
               style="display:flex;align-items:center;gap:8px;padding:7px 0;
                      border-bottom:1px solid #e0dcd4;">
            <img src="${tActor.img ?? "icons/svg/mystery-man.svg"}"
                 style="width:30px;height:30px;border-radius:50%;border:2px solid #7a3a00;
                        object-fit:cover;flex-shrink:0;">
            <div style="flex:1;min-width:0;">
              <div style="font-size:12px;font-weight:700;color:#191813;
                          overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${tActor.name}</div>
              <div style="font-size:10px;color:#8888a0;">${rollFormula} <span style="color:#c8a0ff">${sign}</span>
                   <span style="color:#555555;margin-left:4px;">${modLbl}</span></div>
            </div>
            <button type="button" class="sd-save-roll-btn"
                    data-actor-id="${tActor.id}"
                    data-save-modifier-path="${modifierPath.replace(/"/g,"&quot;")}"
                    data-save-dc="${resolvedDC}"
                    data-save-flavor="${flavor.replace(/"/g,"&quot;")}"
                    data-save-roll-mode="${rollMode}"
                    data-save-roll-dialogue="${rollDialogue}"
                    data-save-adv-formula="${advFormula.replace(/"/g,"&quot;")}"
                    data-save-dis-formula="${disFormula.replace(/"/g,"&quot;")}"
                    data-save-roll-formula="${rollFormula.replace(/"/g,"&quot;")}"
                    data-save-timeout="${timeout}"
                    data-save-type="${checkType}"
                    style="background:#7a3a00;border:1px solid #5a2a00;border-radius:5px;
                           color:#fff;cursor:pointer;font-size:11px;font-weight:700;
                           padding:5px 10px;display:flex;align-items:center;gap:5px;
                           white-space:nowrap;flex-shrink:0;transition:background .12s;">
              <i class="fas fa-dice-d20"></i> ${buttonLabel}
            </button>
          </div>`;
      }).join("");

      const multiNote = saveActors.length > 1
        ? `<div style="font-size:10px;color:#555555;text-align:right;padding:2px 0 4px;
                       text-transform:uppercase;letter-spacing:.5px">${saveActors.length} targets</div>`
        : "";

      const _saveRerollEnabled = (action.rerollEnabled === "yes" || action.rerollEnabled === true) ? "1" : "0";
      const _saveRerollPath    = String(action.rerollPath ?? "").trim();
      const _saveRerollCost    = String(Number(action.rerollCost ?? 0) || 0);
      const _saveRerollSrcId   = actor?.id ?? "";

      const cardHtml = `
        <div class="sd-save-card"
             data-save-modifier-path="${modifierPath.replace(/"/g,"&quot;")}"
             data-save-dc="${resolvedDC}"
             data-save-flavor="${flavor.replace(/"/g,"&quot;")}"
             data-save-roll-mode="${rollMode}"
             data-save-roll-dialogue="${rollDialogue}"
             data-save-adv-formula="${advFormula.replace(/"/g,"&quot;")}"
             data-save-dis-formula="${disFormula.replace(/"/g,"&quot;")}"
             data-save-roll-formula="${rollFormula.replace(/"/g,"&quot;")}"
             data-save-timeout="${timeout}"
             data-save-type="${checkType}"
             data-save-reroll-enabled="${_saveRerollEnabled}"
             data-save-reroll-path="${_saveRerollPath.replace(/"/g,"&quot;")}"
             data-save-reroll-cost="${_saveRerollCost}"
             data-save-reroll-src-actor-id="${_saveRerollSrcId}"
             style="background:linear-gradient(135deg,#f0ebe4 0%,#f0ebe4 100%);
             border:1px solid #b5b3a4;border-top:3px solid #7a3a00;
             border-radius:6px;font-family:'Signika Negative',serif;overflow:hidden;
             box-shadow:0 2px 8px rgba(0,0,0,.5)">

          <!-- Header: source + DC -->
          <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;
               border-bottom:1px solid #e0dcd4;background:rgba(0,0,0,.25)">
            <img src="${actor?.img ?? item?.img ?? "icons/svg/mystery-man.svg"}"
                 style="width:36px;height:36px;border-radius:50%;border:2px solid #7a3a00;
                        object-fit:cover;flex-shrink:0;">
            <div style="min-width:0;flex:1">
              <div style="font-size:12px;font-weight:700;color:#191813;
                          white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                ${actor?.name ?? item?.name ?? "?"}
              </div>
              <div style="font-size:10px;color:#555555">${checkTypeLabel}</div>
            </div>
            <div style="text-align:right;flex-shrink:0">
              <div style="font-size:28px;font-weight:700;color:#7a3a00;line-height:1">DC ${resolvedDC}</div>
              <div style="font-size:9px;color:#555555;text-transform:uppercase;letter-spacing:.5px">${flavor}</div>
            </div>
          </div>

          <!-- Per-actor roll rows -->
          <div class="sd-save-actors-list" style="padding:4px 12px 4px;">
            ${multiNote}
            ${actorRows}
          </div>

          <!-- → Selected: dynamically adds selected actors -->
          <div style="padding:0 12px 10px;border-top:1px solid #e0dcd4;padding-top:8px;">
            <button type="button" class="sd-save-selected-btn"
                    data-save-modifier-path="${modifierPath.replace(/"/g,"&quot;")}"
                    data-save-dc="${resolvedDC}"
                    data-save-flavor="${flavor.replace(/"/g,"&quot;")}"
                    data-save-roll-mode="${rollMode}"
                    data-save-roll-dialogue="${rollDialogue}"
                    data-save-adv-formula="${advFormula.replace(/"/g,"&quot;")}"
                    data-save-dis-formula="${disFormula.replace(/"/g,"&quot;")}"
                    data-save-roll-formula="${rollFormula.replace(/"/g,"&quot;")}"
                    data-save-timeout="${timeout}"
                    data-save-type="${checkType}"
                    data-button-label="${buttonLabel.replace(/"/g,"&quot;")}"
                    style="width:100%;background:#e0dcd4;border:1px solid #b5b3a4;border-radius:5px;
                           color:#191813;cursor:pointer;font-size:11px;font-weight:600;padding:5px 8px;
                           display:flex;align-items:center;justify-content:center;gap:6px;transition:.12s"
                    title="Pull selected / targeted tokens into this card">
              <i class="fas fa-bullseye"></i> → Selected
            </button>

            <!-- Hidden preview panel for selected tokens -->
            <div class="sd-save-selected-preview" style="display:none;margin-top:8px;">
              <div style="font-size:10px;color:#555555;margin-bottom:5px;
                          display:flex;align-items:center;gap:4px;">
                <i class="fas fa-bullseye" style="color:#7a3a00"></i>
                <span>Selected:</span>
              </div>
              <div class="sd-save-selected-actors-list"></div>
              <button type="button" class="sd-save-selected-cancel-btn"
                      style="margin-top:6px;width:100%;background:#1a1a2e;
                             border:1px solid #b5b3a4;border-radius:4px;
                             color:#6868a0;cursor:pointer;font-size:11px;padding:4px;
                             display:flex;align-items:center;justify-content:center;gap:5px;
                             transition:.12s">
                ✗ Cancel
              </button>
            </div>
          </div>
        </div>`;

      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content: cardHtml,
        flags: {
          sd: {
            saveButton:    true,
            modifierPath,
            dc:            resolvedDC,
            flavor,
            rollMode,
            timeout,
            checkType,
            passActions:   action.passActions ?? [],
            failActions:   action.failActions ?? []
          }
        }
      });
      break;
    }

    case "journalShow": {
      let uuid = _injectRuntime(String(action.uuid ?? ""));
      try {
        const { FormulaEngine } = await import("./formula-engine.mjs");
        uuid = String(FormulaEngine.evaluate(uuid, item ?? actor ?? {}));
      } catch { /* raw */ }
      if (!uuid) { ui.notifications.warn("SD | Show Journal: empty UUID"); break; }
      try {
        const doc = await fromUuid(uuid);
        if (!doc) { ui.notifications.warn(`SD | Show Journal: not found — ${uuid}`); break; }
        if (action.pageId) {
          doc.sheet?.render(true, { pageId: action.pageId });
        } else {
          doc.sheet?.render(true);
        }
        if (action.force === true && game.user.isGM) {
          try { await doc.show?.(true); } catch(e) { console.warn("SD | journal.show:", e); }
        }
      } catch(e) { console.error("SD | journalShow:", e); }
      break;
    }

    case "journalShowPage": {
      let entryUuid = _injectRuntime(String(action.entryUuid ?? ""));
      let pageId    = _injectRuntime(String(action.pageId ?? ""));
      try {
        const { FormulaEngine } = await import("./formula-engine.mjs");
        entryUuid = String(FormulaEngine.evaluate(entryUuid, item ?? actor ?? {}));
        pageId    = String(FormulaEngine.evaluate(pageId,    item ?? actor ?? {}));
      } catch { /* raw */ }
      try {
        const entry = await fromUuid(entryUuid);
        if (!entry) { ui.notifications.warn(`SD | Show Page: entry not found — ${entryUuid}`); break; }
        const page = pageId ? entry.pages.get(pageId) : entry.pages.contents?.[0];
        if (!page) { ui.notifications.warn(`SD | Show Page: page not found in ${entry.name}`); break; }
        entry.sheet?.render(true, { pageId: page.id });
        if (action.force === true && game.user.isGM) {
          try { await entry.show?.(true); } catch(e) { console.warn("SD | journal.show:", e); }
        }
      } catch(e) { console.error("SD | journalShowPage:", e); }
      break;
    }

    /* ─────────  CARDS  ───────── */

    case "cardShuffle": {
      const stack = await _sdResolveCards(action);
      if (!stack) { ui.notifications.warn(`SD | Card Shuffle: stack not found`); break; }
      try {
        await stack.shuffle({ chatNotification: action.toChat !== false });
      } catch(e) { console.error("SD | cardShuffle:", e); }
      break;
    }

    case "cardDraw": {
      const from = await _sdResolveCards({ uuid: action.fromUuid, name: action.fromName });
      const to   = await _sdResolveCards({ uuid: action.toUuid,   name: action.toName });
      if (!from || !to) {
        ui.notifications.warn(`SD | Card Draw: stack not found (from="${action.fromName||action.fromUuid}", to="${action.toName||action.toUuid}")`);
        for (const sub of (action.emptyActions ?? [])) await this._runAction(sub, item, actor, buttonDef, runtime);
        break;
      }
      const count = Math.max(1, Math.round(Number(action.count ?? 1)) || 1);
      const how = action.how === "bottom" ? CONST.CARD_DRAW_MODES.BOTTOM
                : action.how === "random" ? CONST.CARD_DRAW_MODES.RANDOM
                : CONST.CARD_DRAW_MODES.TOP;
      const available = from.availableCards?.length ?? from.cards?.size ?? 0;
      if (available <= 0) {
        runtime.__lastDrawnCards = [];
        for (const sub of (action.emptyActions ?? [])) await this._runAction(sub, item, actor, buttonDef, runtime);
        break;
      }
      let drawn = [];
      try {
        drawn = await to.draw(from, Math.min(count, available), { how, chatNotification: action.toChat !== false });
      } catch(e) { console.error("SD | cardDraw:", e); }
      runtime.__lastDrawnCards = drawn ?? [];
      runtime.__lastDrawnCard  = drawn?.[0] ?? null;
      for (const sub of (action.foundActions ?? [])) await this._runAction(sub, item, actor, buttonDef, runtime);
      runtime.__lastDrawnCards = undefined;
      runtime.__lastDrawnCard  = undefined;
      break;
    }

    case "cardPlay":
    case "cardDiscard":
    case "cardReveal": {
      const stack = await _sdResolveCards({ uuid: action.stackUuid, name: action.stackName });
      if (!stack) { ui.notifications.warn(`SD | Card ${action.type}: stack not found`); break; }
      const card = await _sdResolveCard(stack, action);
      if (!card) { ui.notifications.warn(`SD | Card ${action.type}: card not found`); break; }
      try {
        if (action.type === "cardPlay") {
          await card.pass(stack, { action: "play", chatNotification: true });
        } else if (action.type === "cardDiscard") {
          await card.pass(stack, { action: "discard", chatNotification: action.toChat !== false });
        } else {
          // reveal — chat-only, no movement
          await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor: actor ?? null }),
            content: `<div class="sd-card-reveal" style="display:flex;gap:8px;align-items:center"><img src="${card.face >= 0 ? card.faces?.[card.face]?.img ?? card.back?.img ?? "" : card.back?.img ?? ""}" style="height:96px;border-radius:6px"><div><strong>${actor?.name ?? game.user.name} reveals:</strong><br><em>${card.name ?? ""}</em>${card.description ? `<div style="opacity:.8;margin-top:4px">${card.description}</div>` : ""}</div></div>`
          });
        }
      } catch(e) { console.error(`SD | ${action.type}:`, e); }
      break;
    }

    case "cardPass": {
      const from = await _sdResolveCards({ uuid: action.fromUuid, name: action.fromName });
      const to   = await _sdResolveCards({ uuid: action.toUuid,   name: action.toName });
      if (!from || !to) { ui.notifications.warn(`SD | Card Pass: stack not found`); break; }
      const card = await _sdResolveCard(from, action);
      if (!card) { ui.notifications.warn(`SD | Card Pass: card not found`); break; }
      try {
        await card.pass(to, { chatNotification: action.toChat !== false });
      } catch(e) { console.error("SD | cardPass:", e); }
      break;
    }

    case "cardRecall": {
      const stack = await _sdResolveCards(action);
      if (!stack) { ui.notifications.warn(`SD | Card Recall: deck not found`); break; }
      try {
        await stack.recall({ chatNotification: action.toChat !== false });
      } catch(e) { console.error("SD | cardRecall:", e); }
      break;
    }

    case "cardDeal": {
      const from = await _sdResolveCards({ uuid: action.fromUuid, name: action.fromName });
      if (!from) { ui.notifications.warn(`SD | Card Deal: deck not found`); break; }
      const targets = [];
      const list = Array.isArray(action.toList) ? action.toList : String(action.toList ?? "").split(/\s*[;,]\s*/).filter(Boolean);
      for (const t of list) {
        const stack = await _sdResolveCards(t.startsWith("Cards.") ? { uuid: t } : { name: t });
        if (stack) targets.push(stack);
      }
      if (!targets.length) { ui.notifications.warn(`SD | Card Deal: no targets resolved`); break; }
      const count = Math.max(1, Math.round(Number(action.count ?? 1)) || 1);
      const how = action.how === "bottom" ? CONST.CARD_DRAW_MODES.BOTTOM
                : action.how === "random" ? CONST.CARD_DRAW_MODES.RANDOM
                : CONST.CARD_DRAW_MODES.TOP;
      try {
        await from.deal(targets, count, { how, chatNotification: action.toChat !== false });
      } catch(e) { console.error("SD | cardDeal:", e); }
      break;
    }

    case "cardFlip": {
      const stack = await _sdResolveCards({ uuid: action.stackUuid, name: action.stackName });
      if (!stack) { ui.notifications.warn(`SD | Card Flip: stack not found`); break; }
      try {
        if (action.cardId === "*" || !action.cardId) {
          // flip all
          const ids = stack.cards.map(c => c.id);
          const updates = ids.map(id => {
            const c = stack.cards.get(id);
            const newFace = c.face === null ? 0 : null;
            return { _id: id, face: newFace };
          });
          await stack.updateEmbeddedDocuments("Card", updates);
        } else {
          const card = await _sdResolveCard(stack, action);
          if (!card) break;
          const newFace = card.face === null ? 0 : (action.face ?? null);
          await card.update({ face: newFace });
        }
      } catch(e) { console.error("SD | cardFlip:", e); }
      break;
    }

    case "rollTableReset": {
      let table = null;
      if (action.tableUuid) { try { table = await fromUuid(action.tableUuid); } catch {} }
      if (!table && action.tableName) table = game.tables.getName(action.tableName);
      if (!table) { ui.notifications.warn(`SD | Roll Table Reset: not found`); break; }
      try { await table.resetResults(); } catch(e) { console.error("SD | rollTableReset:", e); }
      break;
    }

    case "rollTableShow": {
      let table = null;
      if (action.tableUuid) { try { table = await fromUuid(action.tableUuid); } catch {} }
      if (!table && action.tableName) table = game.tables.getName(action.tableName);
      if (!table) { ui.notifications.warn(`SD | Roll Table Show: not found`); break; }
      try { table.sheet?.render(true); if (game.user.isGM) await table.show?.(true); } catch(e) { console.error("SD | rollTableShow:", e); }
      break;
    }

    }
  }

  static async _requestSaveDialog({ saveActor, saveMod, dc, flavor, rollFormula = "1d20", timeout = 60 }) {
    // Чей это актор
    const ownerIds = Object.entries(saveActor.ownership ?? {})
      .filter(([uid, lvl]) => lvl >= CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER && uid !== "default")
      .map(([uid]) => uid);
    const owningUser = game.users.find(u => u.active && ownerIds.includes(u.id));

    if (!owningUser || owningUser.id === game.user.id) {
      return ButtonExecutor._showLocalSaveDialog({ saveActor, saveMod, dc, flavor, rollFormula, timeout });
    }

    const callbackId = `sd_save_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    return new Promise((resolve) => {
      // Одноразовый листенер
      const handler = (data) => {
        if (data.type !== "saveResult" || data.callbackId !== callbackId) return;
        game.socket.off("system.sd", handler);
        clearTimeout(timer);
        resolve(Number(data.total) || 1);
      };
      game.socket.on("system.sd", handler);

      const timer = setTimeout(async () => {
        game.socket.off("system.sd", handler);
        ui.notifications.warn(`SD | ${saveActor.name}: save timeout — auto-rolling.`);
        const roll = new Roll(`${rollFormula} + ${saveMod}`, _sanitizeRollData(saveActor?.getRollData?.() ?? {}));
        await roll.evaluate();
        await roll.toMessage({
          speaker: ChatMessage.getSpeaker({ actor: saveActor }),
          flavor:  `${flavor} — DC ${dc} (auto) — ${roll.total >= dc ? "✅" : "❌"}`,
          rollMode: _sdMsgMode()
        });
        resolve(roll.total);
      }, timeout * 1000);

      // Запрос целевому юзеру
      game.socket.emit("system.sd", {
        type:       "saveRequest",
        targetUser: owningUser.id,
        callbackId,
        actorId:    saveActor.id,
        saveMod,
        dc,
        flavor,
        rollFormula,
        timeout
      });
    });
  }

  static async _showRollDialogue({ flavor, baseFormula, advFormula, disFormula, actor }) {
    const { DialogV2 } = foundry.applications.api;
    let mode = "normal";

    const fmtShort = (f) => f ? (f.length > 22 ? f.slice(0, 20) + "…" : f) : "—";
    const getBase = (m) =>
      m === "advantage"    ? (advFormula || baseFormula)
    : m === "disadvantage" ? (disFormula || baseFormula)
    : baseFormula;

    const renderTpl = foundry.applications?.handlebars?.renderTemplate ?? renderTemplate;
    const content = await renderTpl("systems/sd/templates/dialog/roll-mode-dialog.hbs", {
      baseFormula,
      baseShort: fmtShort(baseFormula),
      advShort:  fmtShort(advFormula),
      disShort:  fmtShort(disFormula)
    });

    const bindUI = (root) => {
      const formulaEl = root.querySelector(".sd-rdlg-formula");
      const bonusEl   = root.querySelector(".sd-rdlg-bonus");
      const modeBtns  = root.querySelectorAll(".sd-rdlg-mode");

      const updateDisplay = () => {
        const bonus = (bonusEl?.value ?? "").trim();
        const base  = getBase(mode);
        const display = bonus ? `${base} + ${bonus}` : base;
        if (formulaEl) formulaEl.textContent = display;

        for (const btn of modeBtns) {
          const m = btn.dataset.mode;
          const active = m === mode;
          const style = btn.style;
          if (active) {
            style.borderWidth = "2px";
            style.borderColor = m === "normal" ? "#2e8b46" : "#9a50ff";
            style.background  = m === "normal" ? "#1a3a1a" : "#2a1a4a";
            style.color       = m === "normal" ? "#5ae07a" : "#c080ff";
            style.transform   = "scale(1.03)";
          } else {
            style.borderWidth = "1px";
            style.borderColor = "#3a2a5a";
            style.background  = "#1a1a2e";
            style.color       = "#6050a0";
            style.transform   = "scale(1)";
          }
        }
      };

      for (const btn of modeBtns) {
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          mode = btn.dataset.mode;
          updateDisplay();
        });
      }
      bonusEl?.addEventListener("input", updateDisplay);
      updateDisplay();
    };

    const extractBonus = (dialog) => {
      const root = dialog?.element ?? dialog;
      const el = root?.querySelector?.(".sd-rdlg-bonus");
      return (el?.value ?? "").trim();
    };

    try {
      const result = await DialogV2.wait({
        window:  { title: flavor ? `🎲 ${flavor}` : "🎲 Roll" },
        content,
        position:  { width: 380 },
        buttons: [
          {
            action:  "roll",
            icon:    "fas fa-dice-d20",
            label:   "Roll",
            default: true,
            callback: (event, button, dialog) => {
              const bonus = extractBonus(dialog);
              const base  = getBase(mode);
              const formula = bonus ? `(${base}) + ${bonus}` : base;
              return { formula, mode, cancelled: false };
            }
          },
          {
            action: "cancel",
            icon:   "fas fa-times",
            label:  "Cancel",
            callback: () => ({ cancelled: true })
          }
        ],
        rejectClose: false,
        render: (event, dialog) => {
          const root = dialog?.element ?? event?.target ?? null;
          if (root) bindUI(root);
        }
      });
      return result ?? { cancelled: true };
    } catch (e) {
      console.warn("SD | _showRollDialogue DialogV2 failed:", e);
      return { cancelled: true };
    }
  }

    static _showLocalSaveDialog({ saveActor, saveMod, dc, flavor, rollFormula = "1d20", timeout }) {
    return new Promise(async (resolve) => {
      const sign  = saveMod >= 0 ? `+${saveMod}` : String(saveMod);
      const renderTpl = foundry.applications?.handlebars?.renderTemplate ?? renderTemplate;
      const content = await renderTpl("systems/sd/templates/dialog/local-save-dialog.hbs", {
        actorName: saveActor.name,
        rollFormula,
        sign,
        dc
      });
      const dlg   = new Dialog({
        title:   `${flavor} — DC ${dc}`,
        content,
        buttons: {
          roll: {
            icon:  '<i class="fas fa-dice-d20"></i>',
            label: "Roll Save",
            callback: async () => {
              const roll = new Roll(`${rollFormula} + ${saveMod}`, _sanitizeRollData(saveActor?.getRollData?.() ?? {}));
              await roll.evaluate();
              await roll.toMessage({
                speaker:  ChatMessage.getSpeaker({ actor: saveActor }),
                flavor:   `${flavor} — DC ${dc} — ${roll.total >= dc ? "✅ Success" : "❌ Failure"}`,
                rollMode: _sdMsgMode()
              });
              resolve(roll.total);
            }
          },
          manual: {
            icon:  '<i class="fas fa-keyboard"></i>',
            label: "Enter result",
            callback: (html) => {
              const val = parseInt(html.find("#sd-manual-roll").val()) || 1;
              resolve(val);
            }
          }
        },
        default: "roll",
        render: (html) => {
          // Ручной ввод
          html.find(".dialog-buttons").before(
            `<div style="margin:8px 0;display:flex;align-items:center;gap:8px;">
               <label style="font-size:11px;color:#888;">Or enter total:</label>
               <input id="sd-manual-roll" type="number" min="1" max="30"
                 style="width:60px;background:#1a1a2e;border:1px solid #4a4a6a;
                        color:#e0e0ff;border-radius:4px;padding:2px 6px;font-size:13px;">
             </div>`
          );
          // Авто-таймаут
          if (timeout > 0) {
            const t = setTimeout(() => {
              dlg.close();
              const roll = new Roll(`${rollFormula} + ${saveMod}`);
              roll.evaluate().then(r => {
                r.toMessage({ speaker: ChatMessage.getSpeaker({ actor: saveActor }),
                  flavor: `${flavor} — DC ${dc} (timeout auto-roll) — ${r.total >= dc ? "✅" : "❌"}`,
                  rollMode: _sdMsgMode() });
                resolve(r.total);
              });
            }, timeout * 1000);
            dlg._sdTimeoutId = t;
          }
        },
        close: () => {
          if (dlg._sdTimeoutId) clearTimeout(dlg._sdTimeoutId);
        }
      }, { width: 320 });
      dlg.render(true);
    });
  }
  static _buildChatCard({ type, label, amount, srcName, srcImg, tActor, hpPath,
                           showApply = true, rollFormula = null, srcActorId = null,
                           autoApplied = false }) {
    const isDamage    = type === "damage";
    const accentColor = isDamage ? "#b83232" : "#2e8b46";
    const dimColor    = isDamage ? "#7a2020" : "#1e6030";
    const iconClass   = isDamage ? "fa-heart-crack" : "fa-heart";
    const targetName  = tActor?.name ?? "—";
    const targetId    = tActor?.id   ?? null;
    const delta       = isDamage ? -amount : amount;
    const curHp       = tActor ? (Number(foundry.utils.getProperty(tActor, hpPath ?? "system.resources.hp.value")) || 0) : null;
    const maxHp       = tActor ? (Number(foundry.utils.getProperty(tActor,
      (hpPath ?? "system.resources.hp.value").replace(/\.value$/, ".max"))) || 0) : null;
    const newHp       = curHp !== null ? Math.max(0, curHp + delta) : null;
    const hpBarPct    = maxHp ? Math.round((Math.max(0, newHp ?? curHp) / maxHp) * 100) : 0;
    const safeHpPath  = hpPath ?? "system.resources.hp.value";

    // Multiplier buttons row
    const multBtns = isDamage ? `
      <div class="sd-card-mults" style="display:flex;gap:3px;margin-top:8px;flex-wrap:wrap;">
        ${[["½","0.5"],["¼","0.25"],["⅛","0.125"],["×2","2"],["×4","4"]].map(([lbl,mul]) => `
        <button type="button" class="sd-mult-btn"
          data-mult="${mul}"
          style="flex:1;min-width:28px;background:#e0dcd4;border:1px solid #b5b3a4;border-radius:4px;
                 color:#555555;cursor:pointer;font-size:11px;font-weight:700;padding:3px 2px;
                 transition:background .12s,color .12s"
          title="Apply ${lbl} damage">
          ${lbl}
        </button>`).join("")}
      </div>` : "";

    const applyBtns = autoApplied
      ? `<div style="text-align:center;font-size:11px;color:#5ae07a;padding:4px 0;margin-top:8px;
                     border:1px solid #2a6a3a;border-radius:4px;background:#0a2a0a;">
           <i class="fas fa-check"></i> Applied automatically
         </div>`
      : showApply ? `
      <div class="sd-card-apply-row" style="display:flex;gap:5px;margin-top:8px;">
        ${targetId ? `
        <button type="button" class="sd-apply-hp-btn"
          data-actor-id="${targetId}"
          data-hp-path="${safeHpPath}"
          data-delta="${delta}"
          data-amount="${amount}"
          data-label="${label}"
          data-target-name="${targetName}"
          style="flex:2;background:${accentColor};border:1px solid ${dimColor};border-radius:5px;
                 color:#fff;cursor:pointer;font-size:11px;font-weight:700;padding:5px 4px;
                 display:flex;align-items:center;justify-content:center;gap:5px;transition:.12s">
          <i class="fas ${iconClass}"></i> Apply ${amount}
        </button>` : ""}
        <button type="button" class="sd-apply-selected-btn"
          data-hp-path="${safeHpPath}"
          data-base-amount="${amount}"
          data-delta="${delta}"
          data-is-damage="${isDamage ? 1 : 0}"
          data-label="${label}"
          style="flex:${targetId ? 1 : 3};background:#e0dcd4;border:1px solid #b5b3a4;border-radius:5px;
                 color:#191813;cursor:pointer;font-size:11px;font-weight:600;padding:5px 4px;
                 display:flex;align-items:center;justify-content:center;gap:5px;transition:.12s"
          title="Preview: selected / targeted tokens">
          <i class="fas fa-bullseye"></i> → Selected
        </button>
      </div>
      <!-- Live-selection preview (hidden until '→ Selected' is clicked) -->
      <div class="sd-selected-preview" style="display:none;margin-top:8px;
           border:1px solid #b5b3a4;border-radius:5px;background:#f0ebe4;padding:8px;">
        <div style="font-size:10px;color:#555555;margin-bottom:5px;
                    display:flex;align-items:center;gap:4px;">
          <i class="fas fa-bullseye" style="color:${accentColor}"></i>
          <span>Apply to selected:</span>
        </div>
        <div class="sd-selected-actors-list" style="margin-bottom:6px;"></div>
        <div style="display:flex;gap:5px;">
          <button type="button" class="sd-selected-confirm-btn"
            data-hp-path="${safeHpPath}"
            data-is-damage="${isDamage ? 1 : 0}"
            data-label="${label}"
            style="flex:3;background:${accentColor};border:1px solid ${dimColor};border-radius:4px;
                   color:#fff;cursor:pointer;font-size:11px;font-weight:700;padding:5px 4px;
                   display:flex;align-items:center;justify-content:center;gap:5px;transition:.12s">
            <i class="fas ${iconClass}"></i> Confirm Apply
          </button>
          <button type="button" class="sd-selected-cancel-btn"
            style="flex:1;background:#1a1a2e;border:1px solid #b5b3a4;border-radius:4px;
                   color:#6868a0;cursor:pointer;font-size:13px;padding:5px;
                   display:flex;align-items:center;justify-content:center;transition:.12s">
            ✗
          </button>
        </div>
      </div>` : "";

    // Re-roll button
    const rerollBtn = rollFormula ? `
      <div style="margin-top:6px;">
        <button type="button" class="sd-reroll-btn"
          data-formula="${rollFormula.replace(/"/g,"&quot;")}"
          data-src-actor-id="${srcActorId ?? ""}"
          data-hp-path="${safeHpPath}"
          data-is-damage="${isDamage ? 1 : 0}"
          data-target-id="${targetId ?? ""}"
          data-label="${label}"
          style="width:100%;background:#1e1e30;border:1px solid #4a4a6a;border-radius:5px;
                 color:#8080c0;cursor:pointer;font-size:11px;font-weight:600;padding:4px 0;
                 display:flex;align-items:center;justify-content:center;gap:6px;
                 transition:background .12s,color .12s">
          <i class="fas fa-dice"></i> Re-roll
        </button>
      </div>` : "";

    // HP bar
    const hpBar = (newHp !== null && maxHp) ? `
      <div style="margin-top:8px">
        <div style="display:flex;justify-content:space-between;font-size:10px;color:#888;margin-bottom:2px">
          <span>${targetName} HP</span>
          <span>${newHp} / ${maxHp}</span>
        </div>
        <div style="background:#e0dcd4;border-radius:3px;height:6px;overflow:hidden">
          <div style="width:${hpBarPct}%;height:100%;background:${hpBarPct > 50 ? "#2e8b46" : hpBarPct > 25 ? "#c07820" : "#b83232"};transition:width .3s"></div>
        </div>
      </div>` : "";

    return `
<div class="sd-chat-card"
  data-base-amount="${amount}"
  data-hp-path="${safeHpPath}"
  data-is-damage="${isDamage ? 1 : 0}"
  data-roll-formula="${(rollFormula ?? "").replace(/"/g,"&quot;")}"
  data-src-actor-id="${srcActorId ?? ""}"
  data-target-id="${targetId ?? ""}"
  data-label="${label}"
  style="background:linear-gradient(135deg,#f0ebe4 0%,#f0ebe4 100%);
    border:1px solid ${dimColor};border-top:3px solid ${accentColor};
    border-radius:6px;font-family:'Signika Negative',serif;overflow:hidden;
    box-shadow:0 2px 8px rgba(0,0,0,.5)">

  <!-- Header -->
  <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;
              border-bottom:1px solid #e0dcd4;background:rgba(0,0,0,.25)">
    <img src="${srcImg}" style="width:36px;height:36px;border-radius:50%;
         border:2px solid ${accentColor};object-fit:cover;flex-shrink:0">
    <div style="min-width:0">
      <div style="font-size:12px;font-weight:700;color:#191813;white-space:nowrap;
                  overflow:hidden;text-overflow:ellipsis">${srcName}</div>
      <div style="font-size:10px;color:#555555">${label}</div>
    </div>
    <div style="margin-left:auto;text-align:right;flex-shrink:0">
      <div class="sd-card-total" style="font-size:28px;font-weight:700;color:${accentColor};line-height:1">${amount}</div>
      <div style="font-size:9px;color:#555555;text-transform:uppercase;letter-spacing:.5px">${isDamage ? "damage" : "healing"}</div>
    </div>
  </div>

  <!-- Body -->
  <div style="padding:6px 12px 10px">
    <div style="display:flex;align-items:center;gap:6px;font-size:11px;color:#555555">
      <i class="fas fa-crosshairs" style="color:${accentColor}"></i>
      <span>Target: <strong style="color:#c0c0d8">${targetName}</strong></span>
    </div>
    ${hpBar}
    ${multBtns}
    ${applyBtns}
    ${rerollBtn}
  </div>
</div>`;}

  // Chat apply buttons

  static async _postChatApply(btnType, amount, sourceActor, targetActor) {
    const isHeal = btnType === "applyHealing";
    const content = ButtonExecutor._buildChatCard({
      type:     isHeal ? "heal" : "damage",
      label:    isHeal ? "Apply Healing" : "Apply Damage",
      amount:   Math.abs(amount),
      srcName:  sourceActor?.name ?? "?",
      srcImg:   sourceActor?.img  ?? "icons/svg/mystery-man.svg",
      tActor:   targetActor,
      hpPath:   "system.resources.hp.value",
      showApply: !!targetActor
    });
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: sourceActor }),
      content,
      flags: { "sd": { applyAction: { btnType, amount, targetId: targetActor?.id ?? null } } }
    });
  }

  // Field resolution helpers

  static _getFieldValue(path, item, actor) {
    if (path.startsWith("slots."))       return SlotManager.resolveSlotPath(item, path);
    if (path.startsWith("self."))        return foundry.utils.getProperty(item, path.slice(5));
    if (path.startsWith("actor."))       return foundry.utils.getProperty(actor ?? {}, path.slice(6));
    return foundry.utils.getProperty(item, path);
  }

  static async _setFieldValue(path, item, actor, value) {
    if (path.startsWith("slots.")) {
      await SlotManager.setSlotPath(item, path, value);
    } else if (path.startsWith("self.")) {
      await item.update({ [path.slice(5)]: value });
    } else if (path.startsWith("actor.")) {
      if (actor) await actor.update({ [path.slice(6)]: value });
    } else {
      await item.update({ [path]: value });
    }
  }

}
