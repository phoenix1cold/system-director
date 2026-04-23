/**
 * module/helpers/button-executor.mjs
 *
 * Custom Button system for System Director.
 *
 * Each item (and actor) can carry an array of ButtonDefinitions.
 * A button has:
 *   - label, icon, color
 *   - conditions (show/enabled guards)
 *   - actions (ordered chain executed on click)
 *
 * Action types:
 *   roll         - roll a dice formula, post to chat
 *   modifyField  - add/subtract/set a field value (on self, actor, slot item)
 *   createItem   - spawn a new item on the actor (e.g. a shell casing)
 *   removeItem   - delete an owned item of a given category from actor
 *   playSound    - play a sound file
 *   runMacro     - call a world macro by name
 *   message      - post a plain chat message
 *
 * Field target syntax:
 *   self.<path>                        - field on this item
 *   actor.<path>                       - field on the owning actor
 *   slots.<slotId>.<idx>.<path>        - field inside a slotted item
 *   actor.slots.<slotId>.<idx>.<path>  - slot on an actor-owned item (via item name lookup)
 */

import { SlotManager } from "../data/item-slots.mjs";

// v14 renamed `core.rollMode` → `core.messageMode` (old key is a deprecated
// shim until v16).  Read the new key when available, fall back to the old
// one so v13 and older cores keep working without throwing.
function _sdMsgMode() {
  try {
    const v = game.settings.get("core", "messageMode");
    if (v) return v;
  } catch {}
  try { return game.settings.get("core", "rollMode"); } catch {}
  return "publicroll";
}

// Schema helpers (used in DataModel)

const { StringField, NumberField, BooleanField, ArrayField, ObjectField, SchemaField } = foundry.data.fields;

// Nested-slot helpers
/**
 * Resolves a slotPath like "topItemId/slotId/nestedId/slotId2" into
 * { parent, slotId } where parent is the plain-data object that owns the
 * final slot, and slotId is the last segment.
 *
 * For a 2-segment path ("topItemId/slotId") the parent is the live Foundry Item.
 * For deeper paths the parent is a plain data object inside slotContents.
 * Returns null if anything along the chain is missing.
 */
/**
 * Resolves a slotPath into enough information to read/write nested slot data.
 *
 * Returns { parent, slotId, liveAncestor, snapshotChain } where:
 *   parent        -- data object that owns the final slot (may be a plain snapshot)
 *   slotId        -- the final slot id to operate on
 *   liveAncestor  -- the nearest live Foundry Item that can .update()
 *   snapshotChain -- [{slotId, itemId}] pairs from liveAncestor → parent (empty if parent IS live)
 *
 * Returns null if the root cannot be resolved.
 */
function _resolveNestedSlotParent(actor, item, slotPath) {
  if (!slotPath) return null;
  const parts = slotPath.split("/");
  if (parts.length < 2) return null;

  // Resolve root segment
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

  // Direct slot (2-segment path): no traversal needed
  if (parts.length === 2) {
    const isLive = typeof current?.update === "function";
    return { parent: current, slotId: parts[1], liveAncestor: isLive ? current : null, snapshotChain: [] };
  }

  // Walk the chain from root toward the final slot.
  // We track:
  //   liveAncestor  -- root live item (pistol). Never changes once set.
  //   snapshotChain -- [{slotId, itemId}] path from liveAncestor through snapshots to parent.
  //
  // Key insight: the slot UI widget ALWAYS reads from the snapshot stored inside
  // liveAncestor.system.slotContents (even if a matching live actor item exists).
  // So we MUST update the snapshot, not the live item. snapshotChain is never reset.
  const liveAncestor = typeof current?.update === "function" ? current : null;
  const snapshotChain = []; // [{slotId, itemId}] from liveAncestor → parent

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

/**
 * Remove an item at `index` from slot `slotId` on the resolved parent.
 * Handles both live items (direct update) and snapshots (update liveAncestor).
 */
async function _nestedRemoveFromSlot(resolved, slotId, index) {
  const { parent, liveAncestor, snapshotChain } = resolved;
  const SM = (await import("../data/item-slots.mjs")).SlotManager;
  const actor = liveAncestor?.parent ?? liveAncestor?.actor ?? null;

  // Find the live item that actually owns the target slot.
  // Walk the chain: the last step's itemId is the direct parent of slotId.
  // If that item is live in actor.items, operate on it directly.
  // SDItem._onUpdate will then auto-refresh its snapshot inside liveAncestor.
  if (snapshotChain.length > 0 && actor) {
    const lastStep = snapshotChain[snapshotChain.length - 1];
    const liveParent = actor.items.get(lastStep.itemId) ?? null;
    if (liveParent) {
      CONFIG.debug?.sd && console.log("[SD|nested]", "_nestedRemoveFromSlot | via live item:", liveParent.name, "slot:", slotId, "index:", index);
      return SM.removeFromSlot(liveParent, slotId, index);
    }
  }

  // Fallback: operate directly on parent if it is live
  if (typeof parent?.update === "function") {
    return SM.removeFromSlot(parent, slotId, index);
  }

  // Last resort: update snapshot in liveAncestor manually
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

/**
 * Add srcItem to slot `slotId` on the resolved parent.
 * Handles both live items (direct update) and snapshots (update liveAncestor).
 */
async function _nestedAddToSlot(resolved, slotId, srcItem) {
  const { parent, liveAncestor, snapshotChain } = resolved;
  const SM = (await import("../data/item-slots.mjs")).SlotManager;
  const actor = liveAncestor?.parent ?? liveAncestor?.actor ?? null;

  // Prefer operating on the live item -- _onUpdate will sync the snapshot.
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

  // Fallback: write snapshot manually
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
    // "always" | "field" | "slotHasItems" | "slotNotFull" | "actorField"
    type:     new StringField({ initial: "always", blank: false }),
    // For type "field" / "actorField":  target path  (self.system.uses.value)
    field:    new StringField({ initial: "", blank: true }),
    // Operator: > < >= <= == != 
    operator: new StringField({ initial: ">", blank: false }),
    value:    new StringField({ initial: "0", blank: true }),
    // For type "slotHasItems" / "slotNotFull":
    slotId:   new StringField({ initial: "", blank: true }),
    minCount: new NumberField({ required: false, integer: true, initial: 0, nullable: true }),
    // Invert the condition
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
    setValue: new StringField({ initial: "", blank: true }),  // if set, override delta
    clampMin: new NumberField({ required: false, integer: false, initial: null, nullable: true }),
    clampMax: new NumberField({ required: false, integer: false, initial: null, nullable: true }),
    // createItem / removeItem
    itemName:     new StringField({ initial: "", blank: true }),
    itemType:     new StringField({ initial: "inventory", blank: true }),
    itemCategory: new StringField({ initial: "", blank: true }),
    itemData:     new ObjectField(),     // full item data for createItem
    // playSound
    soundPath: new StringField({ initial: "", blank: true }),
    // runMacro
    macroName: new StringField({ initial: "", blank: true }),
    // message
    messageText: new StringField({ initial: "", blank: true }),
    // Delay before this action fires (ms)
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
    // "inline" = show on item row, "sheet" = show in sheet header
    showIn:   new StringField({ initial: "inline", choices: ["inline","sheet","both"], blank: false }),
    // Conditions that must ALL pass for the button to be enabled (visible but greyed if failed)
    conditions:   new ArrayField(ButtonConditionField()),
    // Ordered list of actions executed when button is clicked
    actions: new ArrayField(ButtonActionField())
  });
}

// Condition Evaluator

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
      case "==": return a == expected;  // loose equality intentional
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

// Action Executor

// Target resolution
// Resolves "actor" | "token_target" | "selected_token" to an Actor document.
//
// Unified fallback chain so actions never silently do nothing:
//   token_target  → targeted token  → selected token  → own actor
//   selected_token→ selected token  → targeted token  → own actor
//   actor         → own actor (no canvas lookup)
function _resolveTarget(mode, actor) {
  if (mode === "actor") return actor ?? null;
  const targeted = game.user.targets?.first()?.actor ?? null;
  const selected = canvas?.tokens?.controlled?.[0]?.actor ?? null;
  if (mode === "selected_token") return selected ?? targeted ?? actor ?? null;
  return targeted ?? selected ?? actor ?? null; // token_target (default)
}

/**
 * PR13: resolve a list of target actors for plural modes.  Used by
 * chatDamage/AoE/for-each-target when the user wants to fan-out across
 * whatever is currently targeted or selected.  Empty list falls back to the
 * selected token (dnd5e-style "I forgot to click the target") → own actor.
 */
function _resolveAllTargets(mode, actor) {
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

/**
 * Read a target actor's damage resistance for a given damageType.
 *
 * Consulted sources (first hit wins):
 *   1. `system.resistances[type]` -- structured map added in PR11.
 *        Values: "immune" | "resist" | "resistant" | "normal" | "vulnerable"
 *                | numeric factor (e.g. 0.5) or numeric string.
 *   2. `system.traits.*` string arrays (NPC) -- `immunities` / `resistances` /
 *        `vulnerabilities`, each containing lowercased damageType strings.
 *
 * Returns `{factor, label}` where factor is the multiplier applied to the
 * damage amount and label is a short human-readable tag for chat cards
 * (empty string when the damage is unmodified).
 */
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

  // (2) Free-form string arrays (traits.*).
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
   * Execute all actions on a button definition.
   */
  static async execute(button, item, actor) {
    if (!ConditionEvaluator.evaluate(button, item, actor)) {
      ui.notifications.warn(game.i18n.format("SD.Buttons.ConditionFailed", { label: button.label }));
      return;
    }

    // Create a fresh runtime context per-execution so parallel button clicks
    // don't share state (bug: this._runtime was class-level, shared across all calls).
    const runtime = {};
    for (const action of (button.actions ?? [])) {
      if (action.delay > 0) await new Promise(r => setTimeout(r, action.delay));
      await this._runAction(action, item, actor, button, runtime);
    }
  }

  static async _runAction(action, item, actor, buttonDef = null, runtime = {}) {
    // Inject accumulated runtime values (e.g. from rollValue, rollTable, forLoop)
    // into formula resolution.  All values come from the per-execution `runtime`
    // object, NOT from a class-level field, so parallel calls can't interfere.
    // Strip string values that look like dice notation (e.g. "1d6") from roll data.
    // Foundry v13 creates unresolvable StringTerms for these if left in rollData.
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
      if (runtime.__loopIndex !== undefined) {
        formula = formula.replace(/\{__loopIndex\}/g, String(runtime.__loopIndex));
      }
      // Save Branch AoE: comma-joined token-id lists captured after placement.
      // Set by the "sd-chat-aoe-save-branch-btn" handler in sd.mjs.  These tokens
      // are meant to be consumed by act_for_each_target-style iterators that
      // split a comma list; scalar consumers fall back to the list string.
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
      // Cast-to-* runtime outputs (set by castToActor / castToItem branches)
      if (runtime.__castActorId !== undefined) {
        formula = formula.replace(/\{__castActorId\}/g, String(runtime.__castActorId));
      }
      if (runtime.__castItemId !== undefined) {
        formula = formula.replace(/\{__castItemId\}/g, String(runtime.__castItemId));
      }
      // Macro call return values (set by macroReturn inside the called macro)
      if (runtime.__macroRetA !== undefined) {
        formula = formula.replace(/\{__macroRetA\}/g, String(runtime.__macroRetA));
      }
      if (runtime.__macroRetB !== undefined) {
        formula = formula.replace(/\{__macroRetB\}/g, String(runtime.__macroRetB));
      }
      // Macro argument reads: resolved from the top of runtime.__macroStack (peek)
      if (Array.isArray(runtime.__macroStack) && runtime.__macroStack.length) {
        const frame = runtime.__macroStack[runtime.__macroStack.length - 1] ?? {};
        formula = formula.replace(/\{__macroArg:([a-z])\}/g, (_, pin) => String(frame[pin] ?? "0"));
      } else {
        formula = formula.replace(/\{__macroArg:[a-z]\}/g, "0");
      }
      // Graph-scoped variables: read from actor.flags.sd.vars.<name> with default fallback.
      // Pattern: {__var:name|default}
      formula = formula.replace(/\{__var:([A-Za-z0-9_]+)\|([^}]*)\}/g, (_, name, dflt) => {
        const vars = foundry.utils.getProperty(actor ?? {}, "flags.sd.vars") ?? {};
        const v = vars[name];
        return v === undefined || v === null ? dflt : String(v);
      });
      // PR14: equip state tokens.
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
          const doc = safeItem ?? safeActor ?? {}; // item first: lets {slotCount} read item's own slots
          formula = FormulaEngine.resolveForRoll(formula, doc);
          flavor  = FormulaEngine.resolveForRoll(flavor, doc);
        } catch(e) { /* FormulaEngine optional */ }
        const roll = new Roll(formula, _sanitizeRollData(rollData));
        await roll.evaluate();
        await roll.toMessage({
          speaker:  ChatMessage.getSpeaker({ actor: safeActor }),
          flavor,
          rollMode: action.rollMode || _sdMsgMode()
        });
        break;
      }

      case "rollValue": {
        // Roll formula, optionally show Roll Dialogue before rolling.
        const safeActor = actor ?? null;
        const safeItem  = item?.system ? item : null;
        const rollData  = { ...(safeActor?.getRollData?.() ?? {}), ...(safeItem ? { item: safeItem.system } : {}) };
        // Substitute runtime tokens (e.g. {__lastRoll}, {widgetPath:...}) BEFORE
        // passing to Roll.  Otherwise a residual `{` blows up the Roll parser.
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
        // Final safety net -- strip any unresolved `{...}` tokens so the Roll
        // parser never sees a literal curly brace it can't handle.
        const _stripBraces = (s) => String(s ?? "")
          .replace(/\{[^{}]*\}/g, "0")
          .replace(/[{}]/g, "");
        formula    = _stripBraces(formula);
        advFormula = _stripBraces(advFormula);
        disFormula = _stripBraces(disFormula);

        const flavorLabel = action.flavor || buttonDef?.label || safeItem?.name || "";

        // Roll Dialogue: let user pick Dis/Normal/Adv + optional bonus
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
        // Persist last roll into actor flags so passive display widgets
        // (Dice Tray etc.) can read it across sheet re-renders. PR7.
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
          await roll.toMessage({
            speaker:  ChatMessage.getSpeaker({ actor: safeActor }),
            flavor:   flavorLabel,
            rollMode: _sdMsgMode()
          });
        }
        break;
      }

      case "modifyField": {
        action = { ...action, delta: _injectRuntime(action.delta), setValue: action.setValue != null && action.setValue !== "" ? _injectRuntime(String(action.setValue)) : action.setValue };
        const target = action.target;
        if (!target) break;

        // Helper: resolve a delta -- rolls dice if formula contains dice notation, otherwise evaluates math
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

        // target.* = first selected/targeted/selected_token actor
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
        // Direct field assignment -- value may be a number, formula, or {__lastRoll}
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

      case "createItem": {
        if (!actor) { ui.notifications.warn("No actor context for Add Item."); break; }
        // UUID approach: find world item by UUID and duplicate it onto the actor
        if (action.uuid) {
          try {
            const srcItem = await fromUuid(action.uuid);
            if (srcItem) {
              const obj = srcItem.toObject();
              const qty = Number(action.qty ?? 1);
              if (qty > 1 && "quantity" in (obj.system ?? {})) obj.system.quantity = qty;
              // If inventoryWidget specified, stamp the category from that widget's filter
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
        // Fallback: create blank item by name if no UUID
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
        // UUID → find world item name → match on actor
        if (action.uuid) {
          try {
            const srcItem = await fromUuid(action.uuid);
            if (srcItem) toDelete = actor.items.find(i => i.name === srcItem.name);
          } catch {}
        }
        if (!toDelete && action.itemName) {
          toDelete = actor.items.find(i => i.name === action.itemName);
        }
        // Scope by inventory widget key if provided
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
        // Use the item sitting at [index] in a slot (actor slot or item slot)
        const _useSlotId = String(action.slotId ?? "");
        const _useIdx    = Number(action.index ?? 0);
        const { SlotManager } = await import("../data/item-slots.mjs");

        // Try item slots first, then actor slots
        const _useParents = [item, actor].filter(Boolean);
        let _usedItem = null;
        let _entryData = null;
        for (const parent of _useParents) {
          const contents = SlotManager.getContents(parent, _useSlotId);
          if (!contents.length) continue;
          const entry = contents[_useIdx];
          if (!entry) continue;
          _entryData = entry;
          // 1. Live actor item by stored _id
          let live = actor?.items?.get(entry._id) ?? null;
          // 2. Live actor item by name
          if (!live) live = actor?.items?.find(i => i.name === entry.name) ?? null;
          // 3. World / compendium item by uuid
          if (!live && entry.uuid) { try { live = await fromUuid(entry.uuid); } catch {} }
          if (live) { _usedItem = live; break; }
        }
        if (!_usedItem && _entryData) {
          // 4. Build a temporary Item document from the stored snapshot and use() it
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
        // Find and use an actor-owned item by name, UUID or category+index
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

      case "modifySlotItemField": {
        // Modify a field on the item at [index] in a slot (live actor item)
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
        // Modify a field on an actor-owned item found by name, UUID or category+index
        if (!actor) break;
        let _invItem = null;
        if (action.uuid) {
          try {
            const src = await fromUuid(action.uuid);
            if (src) _invItem = actor.items.find(i => i.name === src.name) ?? null;
          } catch {}
        }
        if (!_invItem && action.itemName) {
          _invItem = actor.items.find(i => i.name === action.itemName) ?? null;
        }
        if (!_invItem && action.category) {
          const catItems = [...actor.items].filter(i => i.system?.category === action.category);
          _invItem = catItems[Number(action.index ?? 0)] ?? null;
        }
        if (!_invItem) { ui.notifications.warn(`modifyInvItemField: item not found on ${actor.name}.`); break; }

        const _fPath   = action.path ?? "";
        const _fCur    = Number(foundry.utils.getProperty(_invItem, _fPath) ?? 0);
        const _fAmt    = Number(action.amount ?? 0);
        let   _fResult;
        if      (action.op === "subtract") _fResult = _fCur - _fAmt;
        else if (action.op === "set")      _fResult = _fAmt;
        else                               _fResult = _fCur + _fAmt;
        await _invItem.update({ [_fPath]: _fResult });
        break;
      }

      case "removeFromInvItemSlot": {
        // actor → find inventory item by name/UUID → remove from its slot
        // Falls back to using the current item context when actor is null (world item).
        const _invCtx = actor ?? item ?? null;
        if (!_invCtx) break;
        const { SlotManager: SM } = await import("../data/item-slots.mjs");

        // Resolve parent item -- search actor.items, or use item itself if it matches
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
        // If still not found and we have an item context, use it directly
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
          // Slot empty or index out of range → empty branch
          for (const sub of (action.emptyActions ?? [])) await this._runAction(sub, item, actor, buttonDef, runtime);
          break;
        }

        await SM.removeFromSlot(_parentItem, _slotId, _idx);
        for (const sub of (action.doneActions ?? [])) await this._runAction(sub, item, actor, buttonDef, runtime);
        break;
      }

      case "addToInvItemSlot": {
        // actor → find container item → add another actor-owned item to its slot
        // Falls back to item context when actor is null (world item).
        const _addCtx = actor ?? item ?? null;
        if (!_addCtx) break;
        const { SlotManager: SM2 } = await import("../data/item-slots.mjs");

        // Resolve container
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

        // Resolve item to place
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
        // Add an item (by name or UUID) to a slot.
        // Works from item sheets, character-sheet widget buttons, and world items (no actor).
        // When actor is null (world item not embedded in actor), item itself is the context.
        const _slotCtx = actor ?? item ?? null;
        if (!_slotCtx) break;

        const _sid = String(action.slotId ?? "");

        // Resolve the slot parent (item or actor)
        let _resolved = null;
        if (action.slotPath) {
          _resolved = _resolveNestedSlotParent(actor, item, action.slotPath);
        }
        // Fallback: search by slotId across actor items (no slotPath or resolution failed)
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

        // Auto-create slot definition on parent if missing
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

        // Find the item to place into the slot
        let srcItem = null;
        if (action.uuid) {
          try { srcItem = await fromUuid(action.uuid); } catch {}
          // If actor exists and item comes from world, prefer actor's embedded copy
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
        // Same parent-resolution logic as addToSlot (item first, then actor.items search, then ctx)
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
        const effectActor = _resolveTarget(action.target ?? "actor", actor)
        if (!effectActor) { ui.notifications.warn("No valid actor for applyEffect."); break; }

        const existing = effectActor.effects.find(e => e.name === action.effectName);
        const mode     = action.toggleMode ?? "create";

        if (mode === "toggle") {
          if (existing) await existing.update({ disabled: !existing.disabled });
          else mode_create: {
            // fall through to create below
          }
        }
        if (mode === "ensure_on"  && existing) { await existing.update({ disabled: false }); break; }
        if (mode === "ensure_off" && existing) { await existing.update({ disabled: true  }); break; }
        if (mode === "toggle"     && existing) break; // already handled above

        // Build effect data
        const rounds = Number(action.duration ?? 0);
        const changes = (action.changes ?? []).map(c => ({
          key:   c.key   ?? "",
          value: String(c.value ?? "0"),
          mode:  Number(c.mode  ?? 2)
        }));
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
          // Update existing with new data instead of duplicating
          await existing.update({ ...effectData, disabled: false });
        } else {
          await effectActor.createEmbeddedDocuments("ActiveEffect", [effectData]);
        }
        break;
      }

      // Old removeEffect handler removed -- unified into the new one below (line ~2596).
      // Backward compat: new handler reads action.name ?? action.effectName.

      case "applyEffectByUuid": {
        // Apply an existing AE to actor/target identified purely by UUID.
        // No need to configure keys/values manually -- the source effect is cloned.
        const effectActor = _resolveTarget(action.target ?? "actor", actor)
        if (!effectActor) { ui.notifications.warn("No valid actor for applyEffectByUuid."); break; }

        const uuid = String(action.effectUuid ?? "").trim();
        if (!uuid) { ui.notifications.warn("applyEffectByUuid: no UUID provided."); break; }

        // Resolve the source effect document by UUID.
        let sourceEffect = null;
        try { sourceEffect = await fromUuid(uuid); } catch {}
        if (!sourceEffect) {
          ui.notifications.warn(`applyEffectByUuid: effect not found — ${uuid}`);
          break;
        }

        const mode     = action.toggleMode ?? "create";
        const existing = effectActor.effects.find(e => e.name === sourceEffect.name);

        if (mode === "toggle") {
          if (existing) { await existing.update({ disabled: !existing.disabled }); break; }
          // fall through to create
        }
        if (mode === "ensure_on"  && existing) { await existing.update({ disabled: false }); break; }
        if (mode === "ensure_off" && existing) { await existing.update({ disabled: true  }); break; }
        if (mode === "toggle"     && existing) break;

        // Clone the source effect data onto the target actor.
        const rounds = Number(action.duration ?? 0);
        const effectData = foundry.utils.mergeObject(
          sourceEffect.toObject(),
          {
            disabled: false,
            origin:   item?.uuid ?? sourceEffect.parent?.uuid ?? null,
            flags:    { sd: { sourceItemId: item?.id ?? null } },
            duration: rounds > 0 ? { rounds } : {}
          },
          { inplace: false }
        );
        // Remove the source id so a new document is created.
        delete effectData._id;

        if (existing && (mode === "create" || mode === "ensure_on")) {
          await existing.update({ ...effectData, disabled: false });
        } else {
          await effectActor.createEmbeddedDocuments("ActiveEffect", [effectData]);
        }
        break;
      }

      case "forEachTarget": {
        // Execute loopActions for every targeted token, then doneActions
        const targets = [...(game.user.targets ?? [])];
        for (const token of targets) {
          const tActor = token.actor;
          if (!tActor) continue;
          for (const sub of (action.loopActions ?? [])) {
            await this._runAction(sub, item, tActor, buttonDef, runtime);
          }
        }
        for (const sub of (action.doneActions ?? [])) {
          await this._runAction(sub, item, actor, buttonDef, runtime);
        }
        break;
      }

      case "saveCheck": {
        const { FormulaEngine } = await import("./formula-engine.mjs");
        const tActor   = _resolveTarget(action.target ?? "actor", actor)
        // tActor defaults to actor context (when inside forEachTarget, actor IS the target)
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
        // Consume one spell slot of given level from the actor
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
          // No slots available -- run empty branch
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
        // Find a template by name on the current item (ability item), then apply it
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

        // Target resolution: override from node takes priority over template setting
        const targetMode = action.targetOverride ?? tpl.target ?? "actor";
        let targets = [];
        if      (targetMode === "self" || targetMode === "actor") targets = [actor ?? null];
        else if (targetMode === "token_target" || targetMode === "selected_token") {
          const t = _resolveTarget(targetMode, actor);
          if (t) targets = [t];
        } else if (targetMode === "all_targets") {
          targets = [...(game.user.targets ?? [])].map(t => t.actor).filter(Boolean);
        }

        for (const tActor of targets) {
          if (!tActor) continue;
          const existing = tActor.effects.find(e => e.name === tpl.name && e.flags?.sd?.sourceItemId === item.id);
          if (existing) await existing.update({ ...effectData, disabled: false });
          else          await tActor.createEmbeddedDocuments("ActiveEffect", [effectData]);
        }
        break;
      }

      case "playSound": {
        // Support both legacy soundPath and new src field
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
        // Compiled by Branch node in formula-graph exec chain
        if (!action.condition && action.condition !== 0) break;
        let pass = false;
        try {
          const { FormulaEngine } = await import("./formula-engine.mjs");
          // Step 0: Inject runtime roll results ({__lastRoll})
          let cond = _injectRuntime(String(action.condition));

          // Step 1: Resolve {ref} tokens
          cond = FormulaEngine.resolveForRoll(cond, item ?? actor ?? {});

          // Step 2: Roll any dice notation in the condition
          // e.g. "(1d6<5)" → roll 1d6 → "(3<5)" → evaluate → true
          if (/\d*d\d+/i.test(cond)) {
            const diceRegex = /(\d*)d(\d+)/gi;
            const matches = [...cond.matchAll(diceRegex)].reverse(); // reverse to preserve indices
            for (const m of matches) {
              const formula = m[0];
              try {
                const r = new Roll(formula, _sanitizeRollData(actor?.getRollData?.() ?? {}));
                await r.evaluate();
                cond = cond.slice(0, m.index) + r.total + cond.slice(m.index + formula.length);
              } catch { /* leave as-is on error */ }
            }
          }

          // Step 3: Evaluate the now-numeric condition
          const resolved = FormulaEngine.evaluate(cond, item ?? actor);
          // resolved may be boolean (from comparisons like 3<2), number, or string fallback
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
        // Collect parts: from messageParts array (dynamic pins) or legacy messageText
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
            // Replace every {ref} token with its live value
            p = p.replace(/\{([^}]+)\}/g, (match, inner) => {
              const val = FormulaEngine.evaluate(`{${inner}}`, doc);
              return (val === match || val === undefined || val === null) ? "0" : String(val);
            });
            // Evaluate any remaining formula (e.g. compiled add/concat result)
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
        // Resolve attack formula (may contain dice + refs)
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

        // Crit detection: first d20-style die showing critFace (default 20)
        const critFace = Number(action.critFace ?? 20);
        const firstDie = roll.dice?.[0]?.results?.[0]?.result;
        const isCrit   = critFace > 0 && firstDie === critFace;

        const outcomeLabel = isCrit ? "🌟 Крит!" : hit === null ? "" : hit ? "✅ Попадание!" : "❌ Промах";
        const acLabel      = ac !== null ? `КБ цели: <strong>${ac}</strong>` : "(нет цели)";

        if (buttonDef) {
          buttonDef.__lastRoll   = roll.total;
          buttonDef.__lastMargin = margin;
        }

        await roll.toMessage({
          speaker: ChatMessage.getSpeaker({ actor }),
          flavor: `${action.flavor ?? "Атака"} — ${outcomeLabel} ${ac !== null ? `(${acLabel})` : ""}`,
          rollMode: _sdMsgMode()
        });

        // Dispatch: crit → critActions (falls back to hitActions),
        //          hit  → hitActions, miss → missActions
        const branch = isCrit
          ? (action.critActions?.length ? action.critActions : (action.hitActions ?? []))
          : (hit !== false ? (action.hitActions ?? []) : (action.missActions ?? []));
        for (const subAction of branch) {
          await this._runAction(subAction, item, actor, buttonDef, runtime);
        }
        break;
      }

      case "rollCheck": {
        // Generic Roll Check: roll_over / roll_under / meet_and_beat / troika / custom
        const { FormulaEngine } = await import("./formula-engine.mjs");
        const doc = item ?? actor ?? {};
        let formula = _injectRuntime(action.formula    ?? "1d20");
        let advF    = _injectRuntime(action.advFormula ?? "");
        let disF    = _injectRuntime(action.disFormula ?? "");
        try { formula = FormulaEngine.resolveForRoll(formula, doc); } catch {}
        try { if (advF) advF = FormulaEngine.resolveForRoll(advF, doc); } catch {}
        try { if (disF) disF = FormulaEngine.resolveForRoll(disF, doc); } catch {}
        // Strip any unresolved `{...}` to keep the Roll parser happy.
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

        const roll = new Roll(rollStr, _sanitizeRollData(actor?.getRollData?.() ?? {}));
        await roll.evaluate();
        const total = roll.total;
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

        // PR13: opposed-roll chat card -- resolves async via button clicks.
        if (action.opposed) {
          const n = Math.max(1, Math.min(16, Number(action.opposedCount ?? 1) || 1));
          const oppFormula = String(action.opposedFormula ?? "1d20");
          // Serialise per-card payload so the click handler can re-roll later.
          const cardId = foundry.utils.randomID();
          const payload = {
            cardId,
            initiatorName:  actor?.name ?? item?.name ?? "?",
            initiatorImg:   actor?.img  ?? item?.img  ?? "icons/svg/mystery-man.svg",
            initiatorRoll:  total,
            flavor:         action.flavor ?? "Check",
            oppFormula,
            oppCount:       n,
            opponents:      [], // filled in as buttons are clicked
            // PR13 hotfix: persist enough context to run the won/lost branches
            // from the chat-card resolver in sd.mjs.  Only one client (the
            // original user) dispatches, avoiding double-fires.
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
                Ожидание ${n} противник${n===1?"а":"ов"}…
              </div>
            </div>`;
          const msg = await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor }),
            content,
            flags: { sd: { opposed: payload } }
          });
          // Record the button handler metadata on the message for later pickup
          // by the click listener (bound globally in sd.mjs renderChatMessage).
          action._opposedMessageId = msg.id;
          break;
        }

        if (action.toChat !== false) {
          const label = passed ? "✅" : "❌";
          await roll.toMessage({
            speaker:  ChatMessage.getSpeaker({ actor }),
            flavor:   `${action.flavor ?? "Check"} — ${label} (DC ${dc}, margin ${margin >= 0 ? "+" : ""}${margin})`,
            rollMode: _sdMsgMode()
          });
        }

        const branch = passed ? (action.passActions ?? []) : (action.failActions ?? []);
        for (const sub of branch) await this._runAction(sub, item, actor, buttonDef, runtime);
        break;
      }

      case "tieredRoll": {
        // Roll a formula, compare total against threshold list, run matching tier's actions
        const { FormulaEngine } = await import("./formula-engine.mjs");
        const doc = item ?? actor ?? {};
        let formula = action.formula ?? "2d6";
        try { formula = FormulaEngine.resolveForRoll(formula, doc); } catch {}

        const roll = new Roll(formula, _sanitizeRollData(actor?.getRollData?.() ?? {}));
        await roll.evaluate();
        const total = roll.total;
        if (buttonDef) buttonDef.__lastRoll = total;

        const tiers = action.tiers ?? [];
        // Pick the highest tier whose min ≤ total.
        let tierIdx = 0;
        for (let i = 0; i < tiers.length; i++) {
          const min = Number(FormulaEngine.evaluate(String(tiers[i]?.min ?? "0"), doc));
          if (total >= min) tierIdx = i;
        }

        if (action.toChat !== false) {
          const label = tiers[tierIdx]?.label ?? `Tier ${tierIdx + 1}`;
          await roll.toMessage({
            speaker:  ChatMessage.getSpeaker({ actor }),
            flavor:   `${action.flavor ?? "Roll"} — ${label}`,
            rollMode: _sdMsgMode()
          });
        }

        const branch = action.tierActions?.[tierIdx] ?? [];
        for (const sub of branch) await this._runAction(sub, item, actor, buttonDef, runtime);
        break;
      }

      case "progression": {
        // Roll formula, read previous value from History Path, branch, write new value back.
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
          await roll.toMessage({
            speaker:  ChatMessage.getSpeaker({ actor }),
            flavor:   `${action.flavor ?? "Progression"} — ${cmp}`,
            rollMode: _sdMsgMode()
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
        // Roll N dice of a given face, count successes vs target with compare rule.
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
          await roll.toMessage({
            speaker:  ChatMessage.getSpeaker({ actor }),
            flavor:   `${action.flavor ?? "Dice Pool"} — ${successes} success${successes===1?"":"es"}${botches ? `, ${botches} botch${botches===1?"":"es"}` : ""} (${faceStr})`,
            rollMode: _sdMsgMode()
          });
        }

        const branch = passed ? (action.passActions ?? []) : (action.failActions ?? []);
        for (const sub of branch) await this._runAction(sub, item, actor, buttonDef, runtime);
        break;
      }

      case "throwOnCanvas":
      case "throwOnSheet": {
        // Roll N dice and visually scatter them on the canvas (PIXI overlay)
        // or on the actor's sheet DOM. Also computes successes against target
        // like dicePool and branches pass/fail.
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
          await roll.toMessage({
            speaker:  ChatMessage.getSpeaker({ actor }),
            flavor:   `${action.flavor ?? "Throw"} — ${successes} success${successes===1?"":"es"} (${faces.join(", ")})`,
            rollMode: _sdMsgMode()
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
        // Runtime-inject every field that may carry a pin token ({__lastRoll},
        // {__lastMargin}, {widgetPath:...}, etc.) -- not just `amount`.  Prior
        // to this PR, `savePassed` / `damageType` were passed through verbatim
        // which meant wiring them from a roll-check's output pin silently
        // failed (tokens never resolved → resistance/halfOnSave ignored).
        action = {
          ...action,
          amount:      _injectRuntime(action.amount),
          damageType:  action.damageType != null && action.damageType !== ""
                         ? _injectRuntime(String(action.damageType))
                         : action.damageType,
          savePassed:  action.savePassed != null && action.savePassed !== ""
                         ? _injectRuntime(String(action.savePassed))
                         : action.savePassed
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

        // PR11: half-damage-on-save short-circuit (damage only).
        if (!isHeal && action.halfOnSave && _savePassedVal(action.savePassed)) {
          amount = Math.floor(amount / 2);
        }

        const hpPath    = action.hpPath ?? "system.resources.hp.value";
        const tMode     = action.target ?? "actor";
        const autoApply = action.autoApply === true || action.autoApply === "yes";

        // PR13: fan out across user.targets with selected-token fallback.
        const tActors = _resolveAllTargets(tMode, actor);

        // If nothing was targeted, still send a card with no target shown
        const targets = tActors.length ? tActors : [null];

        for (const tActor of targets) {
          // PR11: per-target resistance/vulnerability/immunity scaling.
          let finalAmount = amount;
          let resLabel    = "";
          if (!isHeal && tActor && action.damageType) {
            const { factor, label } = _resistanceFactor(tActor, action.damageType);
            finalAmount = Math.max(0, Math.floor(amount * factor));
            resLabel    = label;
          }

          // autoApply: immediately write HP before (or instead of) showing card
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

          // Silent path -- resistance/halfOnSave already applied + HP written
          // via autoApply; skip chat card entirely.
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
            // If auto-applied, show Apply btn disabled so card is informational only
            showApply:   !autoApply && (action.showApply !== false && action.showApply !== "no"),
            rollFormula: /\d*d\d+/i.test(String(action.amount ?? "")) ? String(action.amount) : null,
            srcActorId:  actor?.id ?? null,
            autoApplied: autoApply
          });
          await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content });
        }
        break;
      }

      // New action types added in SD patch

      case "gate": {
        // Pass-through only if condition is truthy; otherwise stops exec chain
        const { FormulaEngine } = await import("./formula-engine.mjs");
        let cond = _injectRuntime(String(action.condition ?? "0"));
        cond = FormulaEngine.resolveForRoll(cond, item ?? actor ?? {});
        const val = FormulaEngine.evaluate(cond, item ?? actor ?? {});
        if (!val || val === "0" || val === 0 || val === false) return; // halt chain
        break;
      }

      case "notify": {
        // Show a toast notification to the current user
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
        // Store a value in actor.flags.sd.vars.NAME
        const { FormulaEngine } = await import("./formula-engine.mjs");
        const varName = action.name ?? "myVar";
        let val = action.value ?? 0;
        try {
          let s = _injectRuntime(String(val));
          s = FormulaEngine.resolveForRoll(s, item ?? actor ?? {});
          val = FormulaEngine.evaluate(s, item ?? actor ?? {});
        } catch { /* use raw */ }
        if (action.scope === "world") {
          // World-scope: stored in game.settings (requires GM; best-effort)
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
        // Decrement a resource; branch to ok or empty via __gotoLabel
        const { FormulaEngine } = await import("./formula-engine.mjs");
        const a = action.target === "token_target"
          ? _resolveTarget("token_target", actor)
          : action.target === "actor" ? actor : (item?.actor ?? actor);
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
          // Empty branch -- run emptyActions if provided
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
        // Open another document sheet by UUID
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
        // Roll on a RollTable -- supports drawCount, found/empty branches
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

        // Determine draw count (may be a formula)
        let drawCount = 1;
        try {
          let dcStr = _injectRuntime(String(action.drawCount ?? 1));
          dcStr = FormulaEngine.resolveForRoll(dcStr, item ?? actor ?? {});
          drawCount = Math.max(1, Math.round(Number(FormulaEngine.evaluate(dcStr, item ?? actor ?? {})) || 1));
        } catch { drawCount = 1; }

        // Check if table has any available results
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

          // Run foundActions per-draw (so each draw can trigger its own chain)
          for (const sub of (action.foundActions ?? [])) {
            await this._runAction(sub, item, actor, buttonDef, runtime);
          }
        }

        // Aggregate convenience: first result stays in __lastRollTableResult
        runtime.__lastRollTableResult = allResults[0] ?? "";
        runtime.__rollTableIndex = undefined;
        break;
      }

      case "forLoop": {
        // Execute loopActions (or bodyActions, for act_loop generic-branch form)
        // N times, injecting current index as __loopIndex.  Optional delay in ms
        // between iterations.
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
        // Sleep N milliseconds, then continue exec chain via `execActions`
        // (emitted by generic-branch isAction compiler).  Supports legacy
        // shape where delay is an isAction node (no branched sub-actions).
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
        // One-shot listener for a Foundry hook; resolves on first firing or timeout.
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
        // Try to resolve `value` (uuid string) to an actor doc; branch ok/fail.
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
        // Call a compiled subgraph (macro) registered on buttonDef.__macros.
        // Args are resolved strings pushed onto runtime.__macroStack so that
        // {__macroArg:a..d} inside the macro body resolves correctly.
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
        // Continue downstream exec (post-call) with returned values still in runtime
        for (const sub of (action.execActions ?? [])) {
          await this._runAction(sub, item, actor, buttonDef, runtime);
        }
        runtime.__macroRetA = prevRetA;
        runtime.__macroRetB = prevRetB;
        break;
      }

      case "macroReturn": {
        // Set return values A/B on the enclosing runtime so post-call value pins
        // (retA / retB tokens) resolve correctly in the caller.
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
        // Execute loopActions while condition is truthy, up to maxIter times
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
        // Route to one of N case branches based on value match
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
        // Run four sub-chains in order: a → b → c → d
        for (const key of ["aActions","bActions","cActions","dActions"]) {
          for (const sub of (action[key] ?? [])) {
            await this._runAction(sub, item, actor, buttonDef, runtime);
          }
        }
        break;
      }

      // Dialog Switch
      // Shows a modal dialog listing named exec outputs.
      // The user picks one; that branch's actions run.
      // action = {
      //   type: "dialogSwitch",
      //   title: "Choose action",
      //   outputs: [
      //     { label: "Strike", actions: [...] },
      //     { label: "Parry",  actions: [...] },
      //     ...  up to 8
      //   ]
      // }
      case "dialogSwitch": {
        // Show a dialog with N named buttons; run the actions for the chosen branch.
        const outputs = (action.outputs ?? []).filter(o => o?.label);
        if (!outputs.length) break;

        const title       = action.title ?? "Choose";
        const description = action.description ?? "";
        const { DialogV2 } = foundry.applications.api;

        // Build the button descriptors for DialogV2.wait()
        const dlgButtons = outputs.map((out, i) => ({
          action:  String(i),
          label:   out.label ?? `Option ${i + 1}`,
          icon:    "fas fa-play",
          default: i === 0
        }));

        // DialogV2.wait resolves with the chosen action string, or null on close
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


      // Create Effect
      case "createEffect": {
        const targets = _resolveAllTargets(action.target ?? "token_target", actor);
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

      // Remove Effect (unified -- handles both old effectName and new name)
      case "removeEffect": {
        const effectName = action.name ?? action.effectName ?? "";
        if (!effectName) break;
        const targets = _resolveAllTargets(action.target ?? "token_target", actor);
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
        const targets = _resolveAllTargets(action.target ?? "token_target", actor);
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

      // Place Aura (unified) -- native v14 Region attached to owner token
      // Four modes, same placement pipeline:
      //   effect        -- applies an Active Effect while tokens are inside
      //   damage        -- rolls damage (onEnter and/or each turn)
      //   heal          -- rolls healing (onEnter and/or each turn)
      //   save-effect   -- rolls a save; applies Active Effect on failure
      // Per-region behaviour lives in region.flags.sd.applyEffect (read by
      // module/helpers/sd-region.mjs hooks -- no custom RegionBehaviorType).
      case "placeAura":
      case "placeAuraEffect":
      case "placeAuraDamage":
      case "placeAuraHeal":
      case "placeAuraSaveEffect": {
        if (!canvas?.scene) break;
        // Resolve runtime tokens in formula fields so `act_roll_value →
        // Formula` pins (which compile to `{__lastRoll}`) land correctly
        // in the persisted region cfg.  Without this the aura/AoE region
        // saw a literal `{__lastRoll}` string and rolled 0 per tick.
        action = {
          ...action,
          formula:      action.formula      != null ? _injectRuntime(String(action.formula))      : action.formula,
          bonusFormula: action.bonusFormula != null ? _injectRuntime(String(action.bonusFormula)) : action.bonusFormula,
          advFormula:   action.advFormula   != null ? _injectRuntime(String(action.advFormula))   : action.advFormula,
          disFormula:   action.disFormula   != null ? _injectRuntime(String(action.disFormula))   : action.disFormula,
          dc:           action.dc           != null ? _injectRuntime(String(action.dc))           : action.dc
        };
        // Resolve owner token
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

        // Derive mode from action.type (new explicit cases) or action.mode
        // (legacy "placeAura" with mode field).
        const modeMap = {
          placeAuraEffect:      "effect",
          placeAuraDamage:      "damage",
          placeAuraHeal:        "heal",
          placeAuraSaveEffect:  "save-effect"
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
          // Chat output: explicit showInChat wins, chatMode kept for back-compat.
          showInChat:        action.showInChat !== false,
          chatMode:          action.chatMode ?? "auto",
          // v6: explicit auto/card toggle -- when undefined falls back to chatMode.
          applyMode:         action.applyMode ?? "auto",
          // Shared-roll toggle for damage/heal sweeps: "per_target" (default)
          // rolls the formula separately for each token; "once" rolls one
          // number and applies it to every token the sweep hits.
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
          // save-effect specifics (+ Adv/Dis/ask)
          saveAttr:          action.saveAttr    ?? "system.attributes.dex.value",
          dc:                (v => Number.isFinite(v) ? v : 15)(Number(action.dc  ?? 15)),
          flavor:            action.flavor      ?? "Saving Throw",
          advMode:           action.advMode     ?? "none",
          advFormula:        action.advFormula  ?? "",
          disFormula:        action.disFormula  ?? ""
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

      // Place AoE -- post a chat card with an interactive Place button
      // Same four modes as auras; the chat button in sd.mjs collects the
      // placement point and creates a (non-attached) SD region there with
      // flags.sd.applyEffect pre-populated.
      case "placeAoeEffect":
      case "placeAoeDamage":
      case "placeAoeHeal":
      case "placeAoeSaveEffect": {
        // Same {__lastRoll}/pin-token resolution as placeAura* above, so
        // wiring `act_roll_value → Formula` into an AoE works correctly.
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
          // v6: explicit auto/card toggle -- when undefined falls back to chatMode.
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

      // AoE -- Save Branch.  Unlike placeAoeSaveEffect (which installs a
      //    persistent region and applies a named effect on fail), this node
      //    places a one-shot template, rolls saves for every token caught
      //    inside, then fires the compiled `passActions` / `failActions`
      //    sub-graphs.  Saved / failed / all token-id arrays are exposed via
      //    runtime so the branch sub-actions can fan damage / heal / effects
      //    across them.
      case "placeAoeSaveBranch": {
        // Resolve runtime tokens (same as placeAura*/placeAoe* above) so a
        // `Roll → Value` piped into an AoE Save Branch's DC/formula pins
        // actually becomes a number in the stored cfg, not the literal
        // `{__lastRoll}` string.
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
          perTarget:    action.perTarget !== false,
          persist:      action.persist === true,
          passActions:  action.passActions ?? [],
          failActions:  action.failActions ?? [],
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
    <span style="color:#191813;"><i class="fas fa-code-branch" style="opacity:.6;margin-right:4px;"></i>${action.perTarget !== false ? "per-target" : "once"}</span>
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

      // Remove Aura -- deletes attached region(s) and clears linked effects
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

        // Legacy MeasuredTemplate auras (pre-Region migration) -- still clean those up.
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

    case "chatSaveButton": {
      const { FormulaEngine } = await import("./formula-engine.mjs");
      const tMode = action.target ?? "token_target";

      // Collect save actors (supports single or multi-target)
      let saveActors = [];
      if (tMode === "all_targets") {
        saveActors = [...(game.user.targets ?? [])].map(t => t.actor).filter(Boolean);
      } else if (tMode === "selected_tokens") {
        saveActors = (canvas?.tokens?.controlled ?? []).map(t => t.actor).filter(Boolean);
      } else {
        const tActor = _resolveTarget(tMode, actor);
        if (tActor) saveActors = [tActor];
      }

      if (!saveActors.length) {
        ui.notifications.warn("SD | Save/Check Button: нет целей. Нацельтесь или выберите токены.");
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

          <!-- → Selected: динамически добавляет выбранных актёров -->
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
                    title="Подтянуть выбранные / нацеленные токены в карточку">
              <i class="fas fa-bullseye"></i> → Selected
            </button>

            <!-- Скрытая панель превью выбранных -->
            <div class="sd-save-selected-preview" style="display:none;margin-top:8px;">
              <div style="font-size:10px;color:#555555;margin-bottom:5px;
                          display:flex;align-items:center;gap:4px;">
                <i class="fas fa-bullseye" style="color:#7a3a00"></i>
                <span>Выбранные:</span>
              </div>
              <div class="sd-save-selected-actors-list"></div>
              <button type="button" class="sd-save-selected-cancel-btn"
                      style="margin-top:6px;width:100%;background:#1a1a2e;
                             border:1px solid #b5b3a4;border-radius:4px;
                             color:#6868a0;cursor:pointer;font-size:11px;padding:4px;
                             display:flex;align-items:center;justify-content:center;gap:5px;
                             transition:.12s">
                ✗ Отмена
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

    }
  }

  // Static helper -- show a save dialog to the owning user, await their roll.
  // Returns the numeric roll total (1d20 + mod).
  // If the user doesn't respond within `timeout` seconds, auto-rolls for them.
  static async _requestSaveDialog({ saveActor, saveMod, dc, flavor, rollFormula = "1d20", timeout = 60 }) {
    // Figure out who owns this actor
    const ownerIds = Object.entries(saveActor.ownership ?? {})
      .filter(([uid, lvl]) => lvl >= CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER && uid !== "default")
      .map(([uid]) => uid);
    const owningUser = game.users.find(u => u.active && ownerIds.includes(u.id));

    // If we ARE the owning user (or no specific owner found), show dialog locally
    if (!owningUser || owningUser.id === game.user.id) {
      return ButtonExecutor._showLocalSaveDialog({ saveActor, saveMod, dc, flavor, rollFormula, timeout });
    }

    // Otherwise emit via socket and await response
    const callbackId = `sd_save_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    return new Promise((resolve) => {
      // Register one-shot listener
      const handler = (data) => {
        if (data.type !== "saveResult" || data.callbackId !== callbackId) return;
        game.socket.off("system.sd", handler);
        clearTimeout(timer);
        resolve(Number(data.total) || 1);
      };
      game.socket.on("system.sd", handler);

      // Timeout fallback -- auto-roll for the player if they don't respond
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

      // Emit request to target user
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

  // Show the save dialog locally (current user owns this actor)
  // Roll Dialogue -- shown before rollValue / save when rollDialogue:true.
  // Lets the user choose Disadvantage / Normal / Advantage and add a bonus.
  // advFormula and disFormula come from node pins/fields (set in the graph).
  // Returns { formula, mode, cancelled }.
  static async _showRollDialogue({ flavor, baseFormula, advFormula, disFormula, actor }) {
    // v14-friendly DialogV2 implementation -- no jQuery, no Dialog v1.
    const { DialogV2 } = foundry.applications.api;
    let mode = "normal";

    const fmtShort = (f) => f ? (f.length > 22 ? f.slice(0, 20) + "…" : f) : "—";
    const getBase = (m) =>
      m === "advantage"    ? (advFormula || baseFormula)
    : m === "disadvantage" ? (disFormula || baseFormula)
    : baseFormula;

    const content = `
      <div style="font-family:inherit;padding:4px 0;">
        <div style="margin-bottom:12px;background:#f0ebe4;border:1px solid #b5b3a4;
                    border-radius:6px;padding:10px 14px;">
          <div style="font-size:9px;color:#555555;text-transform:uppercase;
                      letter-spacing:.6px;margin-bottom:4px;">Формула броска</div>
          <div class="sd-rdlg-formula" style="font-size:15px;font-weight:700;color:#c8a0ff;
                                              font-family:monospace;word-break:break-all;">${baseFormula}</div>
        </div>

        <div style="display:flex;gap:6px;margin-bottom:12px;">
          <button type="button" class="sd-rdlg-mode" data-mode="disadvantage"
            style="flex:1;background:#1a1a2e;border:1px solid #4a2a6a;border-radius:6px;
                   color:#8060b0;cursor:pointer;padding:8px 4px;transition:all .15s;
                   display:flex;flex-direction:column;align-items:center;gap:3px;">
            <span style="font-size:18px;">⬇️</span>
            <span style="font-size:11px;font-weight:700;">Помеха</span>
            <span style="font-size:9px;opacity:.65;font-family:monospace;">${fmtShort(disFormula)}</span>
          </button>
          <button type="button" class="sd-rdlg-mode" data-mode="normal"
            style="flex:1;background:#1a3a1a;border:2px solid #2e8b46;border-radius:6px;
                   color:#5ae07a;cursor:pointer;padding:8px 4px;transition:all .15s;
                   display:flex;flex-direction:column;align-items:center;gap:3px;">
            <span style="font-size:18px;">🎲</span>
            <span style="font-size:11px;font-weight:700;">Обычный</span>
            <span style="font-size:9px;opacity:.65;font-family:monospace;">${fmtShort(baseFormula)}</span>
          </button>
          <button type="button" class="sd-rdlg-mode" data-mode="advantage"
            style="flex:1;background:#1a1a2e;border:1px solid #4a2a6a;border-radius:6px;
                   color:#8060b0;cursor:pointer;padding:8px 4px;transition:all .15s;
                   display:flex;flex-direction:column;align-items:center;gap:3px;">
            <span style="font-size:18px;">⬆️</span>
            <span style="font-size:11px;font-weight:700;">Преимущество</span>
            <span style="font-size:9px;opacity:.65;font-family:monospace;">${fmtShort(advFormula)}</span>
          </button>
        </div>

        <div style="display:flex;align-items:center;gap:8px;background:#f0ebe4;
                    border:1px solid #b5b3a4;border-radius:6px;padding:9px 12px;">
          <span style="font-size:13px;color:#555555;white-space:nowrap;flex-shrink:0;">
            <i class="fas fa-plus" style="font-size:10px;"></i> Бонус
          </span>
          <input type="text" class="sd-rdlg-bonus" name="sdRdlgBonus" placeholder="1d4, +2, ..."
            style="flex:1;background:transparent;border:none;border-bottom:1px solid #b5b3a4;
                   color:#191813;font-size:13px;padding:2px 4px;outline:none;
                   font-family:monospace;">
        </div>
      </div>`;

    // DialogV2.render receives (event, dialog) in v13+.  Button callbacks
    // receive (event, button, dialog); the returned value resolves .wait().
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
            label:   "Бросить",
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
            label:  "Отмена",
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
    return new Promise((resolve) => {
      const sign  = saveMod >= 0 ? `+${saveMod}` : String(saveMod);
      const dlg   = new Dialog({
        title:   `${flavor} — DC ${dc}`,
        content: `
          <div style="font-family:inherit;padding:4px 0;">
            <p style="margin:0 0 8px;font-size:13px;">
              <strong>${saveActor.name}</strong> must make a saving throw.
            </p>
            <div style="display:flex;align-items:center;justify-content:center;gap:12px;
                        background:#1a1a2e;border:1px solid #b5b3a4;border-radius:6px;padding:10px;">
              <span style="font-size:22px;font-weight:bold;color:#c8a0ff;">${rollFormula} ${sign}</span>
              <span style="font-size:12px;color:#888;">vs DC ${dc}</span>
            </div>
          </div>`,
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
          // Add manual input field
          html.find(".dialog-buttons").before(
            `<div style="margin:8px 0;display:flex;align-items:center;gap:8px;">
               <label style="font-size:11px;color:#888;">Or enter total:</label>
               <input id="sd-manual-roll" type="number" min="1" max="30"
                 style="width:60px;background:#1a1a2e;border:1px solid #4a4a6a;
                        color:#e0e0ff;border-radius:4px;padding:2px 6px;font-size:13px;">
             </div>`
          );
          // Auto-timeout
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
  // Produces a dnd5e-style interactive card for chatDamage / chatHeal.
  //
  // Stored data attributes allow the renderChatMessageHTML hook to wire:
  //   • Re-roll button          (re-evaluates the original formula)
  //   • Damage multipliers      (½ ¼ ⅛ ×2 ×4)
  //   • Target-mode toggle      (targeted token ↔ selected token)
  //   • Apply-to-selected       (override stored target at click time)
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

    // Apply / selected-apply buttons
    // Primary apply uses stored targetId; "selected" button opens a live preview panel
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
          title="Предпросмотр: выбранные / нацеленные токены">
          <i class="fas fa-bullseye"></i> → Selected
        </button>
      </div>
      <!-- ── Live-selection preview (скрыта до клика «→ Selected») ── -->
      <div class="sd-selected-preview" style="display:none;margin-top:8px;
           border:1px solid #b5b3a4;border-radius:5px;background:#f0ebe4;padding:8px;">
        <div style="font-size:10px;color:#555555;margin-bottom:5px;
                    display:flex;align-items:center;gap:4px;">
          <i class="fas fa-bullseye" style="color:${accentColor}"></i>
          <span>Применить к выбранным:</span>
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
