/**
 * module/helpers/formula-engine.mjs  -- System Director
 *
 * Evaluates formula strings against a document context.
 *
 * Syntax reference
 *
 *  {path}                        → value at foundry path on the actor/item
 *  {item:Name.system.field}      → field on actor-owned item named "Name"
 *  {item:id:ITEMID.system.field} → field on item by id
 *  {slotCount:slotId}            → number of items in slot (self/actor)
 *  {nestedSlotCount:itemId/sId/nestedId/sId2/...} → slot count on a deeply nested item
 *  {slot:slotId.0.system.field}  → field inside slot contents[0]
 *  floor({...})                  → math function
 *  ceil({...})                   → math function
 *  round({...})                  → math function
 *  max(a, b)                     → math function
 *  min(a, b)                     → math function
 *  abs({...})                    → math function
 *  ({cond} ? {then} : {else})    → ternary
 *  Standard dice: 1d20, 2d6+3    → kept as-is for Roll (in roll mode)
 *
 * Two evaluation modes
 *
 *  FormulaEngine.evaluate(formula, doc)
 *    → resolves all {refs} and evaluates math → returns a number or string
 *    → used for widget value display
 *
 *  FormulaEngine.resolveForRoll(formula, doc)
 *    → resolves {refs} to numbers → returns a dice formula string
 *    → used for Roll button formulas like "1d20 + {system.attributes.attr1.mod}"
 */

export class FormulaEngine {

  // Public API

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
      // Normalize Cyrillic lookalike letters → Latin equivalents.
      // These are visually identical but cause "Unresolved StringTerm" errors in Foundry's Roll parser.
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

      // Warn if bare dot-paths remain (no braces) -- detect "word.word.word" not dice
      // Attempt to auto-resolve them as a fallback
      result = result.replace(/\b([a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*){1,})\b/gi, (match) => {
        // Skip dice notation like "1d20" patterns already resolved
        if (/^\d+d\d+/i.test(match)) return match;
        // Skip JS keywords / Foundry roll terms
        if (/^(Math|floor|ceil|round|abs|max|min)$/.test(match)) return match;
        // Try resolving as path on the doc
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
        return match; // leave as-is, Roll will handle or error
      });

      // Final pass: remove any remaining unresolved {ref} tokens and stray braces
      // that would cause Foundry's Roll parser to fail
      result = result.replace(/\{[^}]*\}/g, "0"); // {unresolved} → 0
      result = result.replace(/[{}]/g, "");        // stray { or } → strip

      return result;
    } catch(e) {
      console.warn("SD | resolveForRoll error:", e);
      return formula;
    }
  }

  /**
   * Check if a string contains any formula refs (i.e. is a formula, not a plain path).
   */
  static isFormula(str) {
    return /[{}+\-*\/]|floor|ceil|round|max|min|abs|item:|slot/.test(str ?? "");
  }

  // Internal

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
    // Replace all {...} tokens
    return formula.replace(/\{([^}]+)\}/g, (match, inner) => {
      const val = this._resolveToken(inner.trim(), doc);
      if (val === undefined || val === null) return "0";
      return String(val);
    });
  }

  static _resolveToken(token, doc) {
    // widget:keyName -- resolve from doc's customTabs widgets by widgetKey
    if (token.startsWith("widget:")) {
      const key    = token.slice("widget:".length);
      const w      = this._findWidgetByKey(doc, key);
      if (!w) return 0;
      // Evaluate this widget's own valueFormula or read its path
      if (w.valueFormula && this.isFormula(w.valueFormula)) {
        return this.evaluate(w.valueFormula, doc);
      }
      if (w.path) return foundry.utils.getProperty(doc, w.path) ?? 0;
      if (w.pathValue) return foundry.utils.getProperty(doc, w.pathValue) ?? 0;
      return 0;
    }

    // widgetPath:keyName -- resolve to the widget's bound data path (as a string token
    // wrapped in braces so other nodes can treat it as a live path). This lets the
    // graph WRITE back to whatever path the widget is wired to.
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

    // slotCount:slotId
    // Searches: (1) doc itself, (2) actor, (3) any actor-owned item that has the slot.
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
        // Search actor-owned items for one that has this slot
        for (const item of (actor.items ?? [])) {
          const itemVal = _cnt(item);
          if (itemVal !== null) return itemVal;
        }
      }
      return 0;
    }

    // spellSlots:level -- remaining spell slots of that level on actor
    if (token.startsWith("spellSlots:")) {
      const level  = token.slice("spellSlots:".length);
      const actor  = doc instanceof Actor ? doc : doc.actor ?? null;
      if (!actor) return 0;
      return actor.system?.spellSlots?.[level]?.value ?? 0;
    }

    // invItemSlotCount:itemNameOrUuid.slotId -- slot count on an actor-owned item
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

    // nestedSlotCount:root/slotId/nestedItemId/slotId2/.../finalSlotId
    // root is "self" (the item), "actor", or a Foundry item id.
    // Path layout: [ root, slotId, nestedItemId, slotId, nestedItemId, ..., finalSlotId ]
    // At every step we prefer the LIVE actor item (up-to-date data) over the
    // stale snapshot copy stored inside parent's slotContents.
    if (token.startsWith("nestedSlotCount:")) {
      const parts = token.slice("nestedSlotCount:".length).split("/");
      if (parts.length < 3) return 0;
      const actor = doc instanceof Actor ? doc : doc.actor ?? null;
      // Resolve root. New paths use real item ids so actor.items.get() works from
      // both the item sheet and the actor sheet. "self"/"actor" are legacy/special cases.
      let current;
      const root = parts[0];
      if (root === "actor") {
        current = actor;
      } else if (root === "self") {
        // Legacy: try doc if it is an item; if doc is an actor the path is unresolvable
        current = (doc instanceof Actor) ? null : doc;
      } else {
        // Real item id -- resolve via live actor items (works regardless of who fired the button)
        current = actor?.items.get(root) ?? null;
        // Edge-case: doc itself might be the item (button fired from item sheet, actor not linked)
        if (!current && doc && !(doc instanceof Actor) && doc.id === root) current = doc;
      }
      if (!current) return 0;
      // Walk pairs: slotId at i, nestedItemId at i+1.
      // ALWAYS follow the snapshot chain -- the slot UI widget and button actions
      // both read/write the snapshot stored in slotContents, so we must read from
      // the same source for consistency.
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

    // slotUuid:slotId.index -- returns UUID string of the item at that slot index
    // (actor slots or item slots; searches actor first, then doc)
    if (token.startsWith("slotUuid:")) {
      const rest   = token.slice("slotUuid:".length);
      const dot    = rest.lastIndexOf(".");
      if (dot < 0) return "";
      const slotId = rest.slice(0, dot);
      const idx    = parseInt(rest.slice(dot + 1));
      // Try actor slots first, then item (doc) slots
      const actor  = doc instanceof Actor ? doc : doc.actor;
      const targets = [doc instanceof Actor ? null : doc, actor].filter(Boolean);
      for (const t of targets) {
        const contents = t?.system?.slotContents?.[slotId]?.contents ?? [];
        const entry    = contents[idx];
        if (entry) return entry.uuid ?? entry._id ?? "";
      }
      return "";
    }

    // invcat:category.index.path -- read field from actor inventory item by category+index
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

    // target.path -- read from first targeted/selected token's actor
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

    // var:name -- read from actor.flags.sd.vars.NAME
    if (token.startsWith("var:")) {
      const varName = token.slice("var:".length).trim();
      const a = doc instanceof Actor ? doc : (doc.actor ?? null);
      return a?.getFlag?.("sd", `vars.${varName}`) ?? 0;
    }

    // hasCondition:target.effectName -- 1 if AE with that name exists and is enabled
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

    // __loopIndex / __lastRoll / __lastRollTableResult -- runtime context
    if (token.startsWith("__")) {
      // These are resolved at runtime by the executor via _injectRuntime;
      // if they appear in a pure-evaluate context, return 0 as safe default.
      return 0;
    }

    // @shorthand (Foundry roll data)
    if (token.startsWith("@")) {
      const key    = token.slice(1);
      const rd     = (doc instanceof Actor ? doc : doc.actor)?.getRollData?.() ?? {};
      return foundry.utils.getProperty(rd, key) ?? 0;
    }

    // random -- built-in: used by random_num node compile output
    if (token === "random") return Math.random();

    // plain path on doc -- try the doc first, then its parent actor as fallback.
    // This lets {system.attributes.str.value} (an actor path) work correctly
    // even when the formula is evaluated in an item context (e.g. ability spell).
    const val = foundry.utils.getProperty(doc, token);
    if (val !== undefined && val !== null && typeof val !== "object") return val;
    // Fallback: if doc is an item, try the owning actor
    const _actor2 = (doc instanceof Actor) ? null : (doc?.actor ?? null);
    if (_actor2) {
      const val2 = foundry.utils.getProperty(_actor2, token);
      if (val2 !== undefined && val2 !== null && typeof val2 !== "object") return val2;
    }
    if (val !== undefined && val !== null) return 0; // path found but was object
    return 0;
  }

  static _evalMath(expr) {
    // Replace math functions with JS equivalents
    let e = expr
      .replace(/floor\s*\(/g, "Math.floor(")
      .replace(/ceil\s*\(/g,  "Math.ceil(")
      .replace(/round\s*\(/g, "Math.round(")
      .replace(/abs\s*\(/g,   "Math.abs(")
      .replace(/max\s*\(/g,   "Math.max(")
      .replace(/min\s*\(/g,   "Math.min(");

    // Pure numeric/boolean math -- safe chars only
    const isNumericMath = !/[^0-9+\-*/()., %MathflorceiabsundxN\s?:<>!=&|]/.test(e);
    // String expression -- contains quoted string literals
    const hasStrings = e.includes('"') || e.includes("'");

    if (!isNumericMath && !hasStrings) {
      return e; // Unknown content — return as-is
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

// Blueprint node definitions (used by Toolbox + config popup)

export const BLUEPRINT_NODES = [
  // Sources
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

  // Dice
  { cat: "Dice", id: "d4",   label: "d4",   icon: "fa-dice-d6",  color: "#e0a85a", syntax: "1d4",   hint: "Roll a d4" },
  { cat: "Dice", id: "d6",   label: "d6",   icon: "fa-dice-d6",  color: "#e0a85a", syntax: "1d6",   hint: "Roll a d6" },
  { cat: "Dice", id: "d8",   label: "d8",   icon: "fa-dice",     color: "#e0a85a", syntax: "1d8",   hint: "Roll a d8" },
  { cat: "Dice", id: "d10",  label: "d10",  icon: "fa-dice",     color: "#e0a85a", syntax: "1d10",  hint: "Roll a d10" },
  { cat: "Dice", id: "d12",  label: "d12",  icon: "fa-dice",     color: "#e0a85a", syntax: "1d12",  hint: "Roll a d12" },
  { cat: "Dice", id: "d20",  label: "d20",  icon: "fa-dice-d20", color: "#e0a85a", syntax: "1d20",  hint: "Roll a d20" },
  { cat: "Dice", id: "d100", label: "d100", icon: "fa-dice",     color: "#e0a85a", syntax: "1d100", hint: "Roll percentile" },

  // Math
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

  // Compare
  { cat: "Compare", id: "eq",  label: "Equals",     icon: "fa-equals",    color: "#ee68ee", syntax: " == ", hint: "Equal to" },
  { cat: "Compare", id: "neq", label: "Not Equal",  icon: "fa-not-equal", color: "#ee68ee", syntax: " != ", hint: "Not equal to" },
  { cat: "Compare", id: "gt",  label: "Greater >",  icon: "fa-chevron-right", color: "#ee68ee", syntax: " > ", hint: "Greater than" },
  { cat: "Compare", id: "lt",  label: "Less <",     icon: "fa-chevron-left",  color: "#ee68ee", syntax: " < ", hint: "Less than" },
  { cat: "Compare", id: "gte", label: "Greater >=", icon: "fa-chevron-right", color: "#ee68ee", syntax: " >= ", hint: "Greater or equal" },
  { cat: "Compare", id: "lte", label: "Less <=",    icon: "fa-chevron-left",  color: "#ee68ee", syntax: " <= ", hint: "Less or equal" },

  // Logic / Control
  { cat: "Logic", id: "if_else", label: "If/Else", icon: "fa-code-branch",  color: "#e05a5a",
    syntax: "({condition} ? {true_val} : {false_val})",   hint: "Ternary — if condition then value_a else value_b",
    desc: "Returns true_val if condition is truthy, otherwise false_val." },
];

export const BLUEPRINT_CATS = ["Sources", "Dice", "Math", "Compare", "Logic"];
