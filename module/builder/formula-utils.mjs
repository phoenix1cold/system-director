/**
 * Pure helpers for inspecting / transforming dice formulas.
 *
 * Used by the Dice / Formula utility nodes (Formula Range, Formula Clamp,
 * Formula × N, Formula + Mod, Crit Check, Roll Stat) and by the roll-node
 * output enrichment (formula / min / max / isCrit / natural / critFormula
 * pins exposed on every roll-producing node).
 *
 * The functions are deliberately self-contained: no Foundry imports, just
 * string + numeric reasoning over Foundry's classic dice notation. They
 * accept `rollData` so that `@var` references resolve to numbers when known
 * (best-effort — unresolved refs are conservatively treated as 0 for the
 * lower bound and as themselves for the upper bound).
 */

const _RX_NDM   = /(\d+)?d(\d+)/gi;
const _RX_KH_KL = /k[hl]\d+|dl\d+|dh\d+|kh|kl|min\d+|max\d+|r<?=?\d+|x>?=?\d+|cs[<>=]\d+|cf[<>=]\d+/gi;
const _RX_NUM   = /-?\d+(\.\d+)?/g;
const _RX_AT    = /@([A-Za-z_][A-Za-z0-9_.]*)/g;

/** Replace all `@name` references with concrete numbers from rollData. */
export function resolveAtRefs(formula, rollData = {}) {
  if (typeof formula !== "string") return String(formula ?? "");
  return formula.replace(_RX_AT, (m, name) => {
    const path = name.split(".");
    let v = rollData;
    for (const seg of path) {
      if (v == null) return "0";
      v = v[seg];
    }
    if (v == null || Number.isNaN(Number(v))) return "0";
    return String(Number(v));
  });
}

/**
 * Compute the theoretical minimum / maximum / average of a dice formula
 * using Foundry-classic notation. Supports +, -, *, /, parentheses, the
 * `floor()/ceil()/round()/abs()/min()/max()/clamped()` math functions, and
 * dice modifiers `kh/kl/dh/dl/min/max/r/x/cs/cf` (the simpler ones — exotic
 * stuff is parsed loosely, the bounds err on the side of including the
 * unmodified range).
 *
 * Returns `{ min, max, avg }`. Falls back to `{min:0, max:0, avg:0}` for
 * formulas that can't be parsed at all (empty / non-string).
 */
export function formulaBounds(formula, rollData = {}) {
  if (formula == null || formula === "") return { min: 0, max: 0, avg: 0 };
  const src = resolveAtRefs(String(formula), rollData);

  // Build expressions for the lower/upper/average bound by replacing each
  // dice term `NdM` with its theoretical lo/hi/avg value. We strip dice
  // modifiers first — they almost always tighten or widen the bounds, but
  // for the user's needs the unmodified [N..N*M] envelope is good enough.
  const stripMods = (s) => s.replace(_RX_KH_KL, "");

  const subDice = (s, kind) => stripMods(s).replace(_RX_NDM, (m, nRaw, sides) => {
    const n     = Math.max(1, Number.parseInt(nRaw || "1", 10));
    const sided = Math.max(1, Number.parseInt(sides, 10));
    if (kind === "min") return String(n);
    if (kind === "max") return String(n * sided);
    return String(n * (sided + 1) / 2);
  });

  const _safeEval = (expr) => {
    // Hand the expression to Foundry's Roll — it will resolve math functions
    // and arithmetic on plain numbers (no dice left after subDice).
    try {
      const Cls = globalThis?.Roll ?? globalThis?.foundry?.dice?.Roll;
      if (Cls) {
        const r = new Cls(expr);
        // Roll without the async dice rolling — safe because no dice remain.
        if (typeof r.evaluateSync === "function") {
          r.evaluateSync({ allowStrings: false });
        } else if (typeof r.roll === "function") {
          r.roll({ async: false });
        }
        const total = Number(r.total);
        if (Number.isFinite(total)) return total;
      }
    } catch {}
    // Fallback: only allow digits, +-*/(), spaces, dots, commas, and the
    // four math functions we whitelist. Anything else → 0.
    const cleaned = expr
      .replace(/\bclamped\s*\(/g, "(")
      .replace(/\bfloor\s*\(/g, "Math.floor(")
      .replace(/\bceil\s*\(/g,  "Math.ceil(")
      .replace(/\bround\s*\(/g, "Math.round(")
      .replace(/\babs\s*\(/g,   "Math.abs(")
      .replace(/\bmin\s*\(/g,   "Math.min(")
      .replace(/\bmax\s*\(/g,   "Math.max(");
    if (!/^[\d+\-*/().,\sMath.floorceiranbsx]+$/i.test(cleaned)) return 0;
    try {
      // eslint-disable-next-line no-new-func
      const fn = new Function(`"use strict"; return (${cleaned});`);
      const v = fn();
      return Number.isFinite(v) ? Number(v) : 0;
    } catch {
      return 0;
    }
  };

  const lo = _safeEval(subDice(src, "min"));
  const hi = _safeEval(subDice(src, "max"));
  const av = _safeEval(subDice(src, "avg"));
  return {
    min: Math.min(lo, hi),
    max: Math.max(lo, hi),
    avg: av
  };
}

/**
 * Wrap a formula with `min(MAX, max(MIN, F))`. Either bound may be `null`
 * / `""` / `undefined` — the corresponding side is left open. Returns the
 * original formula unchanged if both bounds are absent.
 */
export function clampFormula(formula, lo, hi) {
  let f = String(formula ?? "");
  const _has = (v) => v !== null && v !== undefined && String(v).trim() !== "";
  if (_has(hi)) f = `min(${String(hi).trim()},${f})`;
  if (_has(lo)) f = `max(${String(lo).trim()},${f})`;
  return f;
}

/**
 * Multiply a formula by a numeric factor: `(N)*(F)`. Used internally by
 * Formula × N and by the default Crit Formula derivation when the user
 * picks `mode="multiply"`.
 */
export function multiplyFormula(formula, n) {
  const fact = String(n ?? 1).trim();
  if (fact === "" || fact === "1") return String(formula ?? "");
  return `(${fact})*(${String(formula ?? "")})`;
}

/**
 * Append / subtract a modifier to a formula. Strings are passed through
 * verbatim (so `+@mod` works), numbers are formatted with their sign.
 */
export function addMod(formula, mod) {
  const f = String(formula ?? "");
  if (mod == null || mod === "") return f;
  const s = String(mod).trim();
  if (s === "") return f;
  if (Number.isFinite(Number(s))) {
    const n = Number(s);
    if (n === 0) return f;
    return n >= 0 ? `(${f})+(${n})` : `(${f})-(${Math.abs(n)})`;
  }
  // Treat as expression — wrap in parens so signs work correctly.
  if (s.startsWith("-")) return `(${f})-(${s.slice(1)})`;
  if (s.startsWith("+")) return `(${f})+(${s.slice(1)})`;
  return `(${f})+(${s})`;
}

/**
 * Default crit-formula derivation: doubles every dice term's count.
 * `1d6+3` → `2d6+3`, `2d6+1d4+5` → `4d6+2d4+5`.  Non-dice math is
 * preserved as-is. If the formula has no dice at all, returns the formula
 * multiplied by 2 (so `5` → `(2)*(5)`).
 */
export function doubleDice(formula) {
  const src = String(formula ?? "");
  if (!_RX_NDM.test(src)) {
    _RX_NDM.lastIndex = 0;
    return multiplyFormula(src, 2);
  }
  _RX_NDM.lastIndex = 0;
  return src.replace(_RX_NDM, (m, nRaw, sides) => {
    const n = Math.max(1, Number.parseInt(nRaw || "1", 10));
    return `${n * 2}d${sides}`;
  });
}

/**
 * Pick the natural value of the leading d20 from a Foundry Roll instance.
 * Returns `null` if there is no d20 in the roll.
 *
 * Walks `roll.terms` (and nested `PoolTerm`/`ParentheticalTerm` rolls).
 * For `kh/kl` (advantage / disadvantage) returns the kept die's natural.
 */
export function leadingD20Natural(roll) {
  if (!roll?.terms) return null;
  const _scanTerms = (terms) => {
    for (const t of terms) {
      // DiceTerm with faces=20
      if (t?.faces === 20 && Array.isArray(t.results)) {
        // Prefer non-discarded result; if multiple kept, take the first.
        const kept = t.results.find(r => !r.discarded && r.active !== false)
                  ?? t.results[0];
        if (kept) return Number(kept.result) || null;
      }
      // PoolTerm — has .rolls (array of Rolls)
      if (Array.isArray(t?.rolls)) {
        for (const r of t.rolls) {
          const v = leadingD20Natural(r);
          if (v != null) return v;
        }
      }
      // ParentheticalTerm — has .term (a sub-roll)
      if (t?.term?.terms) {
        const v = _scanTerms(t.term.terms);
        if (v != null) return v;
      }
    }
    return null;
  };
  return _scanTerms(roll.terms);
}

/**
 * Tiny condition evaluator used by the Dialog Builder for `visibleWhen`,
 * `disabledWhen`, etc. Supports `{fieldId}` substitutions, comparisons
 * (==, !=, >=, <=, >, <), boolean ops (&&, ||, !), and parentheses.
 *
 * Strict allow-list — any unrecognised character → returns `true` (fail
 * open) so a typo doesn't accidentally hide every button.
 */
/**
 * Coerce any pin / field value to a strict boolean.
 *
 * The graph runtime can deliver booleans from many places: literal `true`/
 * `false`, numeric 0/1 (e.g. from a hiddenField int), CSV `"yes"` / `"no"`
 * strings (legacy select fields), tokenised runtime values (`"{__lastIsCrit}"`
 * resolved to `"1"`), or evaluable expressions (`"(@flag.x > 3)"`).
 *
 * Rules:
 *   - undefined / null / "" → false
 *   - typeof number          → !== 0
 *   - typeof boolean         → as-is
 *   - string "0", "false", "no", "off", "null", "undefined" (any case) → false
 *   - any other non-empty string → true (callers can pre-evaluate via
 *     FormulaEngine if they want expression support)
 */
export function coerceBool(v) {
  if (v === undefined || v === null || v === "") return false;
  if (typeof v === "number")  return v !== 0;
  if (typeof v === "boolean") return v;
  const s = String(v).trim().toLowerCase();
  if (!s) return false;
  return !["0", "false", "no", "off", "null", "undefined"].includes(s);
}

export function evalCondition(expr, ctx = {}) {
  if (expr == null || expr === "") return true;
  let s = String(expr);
  // Substitute {fieldId} → JSON-encoded value.
  s = s.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (m, id) => {
    const v = ctx[id];
    if (v === true || v === false) return String(v);
    if (Number.isFinite(Number(v))) return String(Number(v));
    return JSON.stringify(String(v ?? ""));
  });
  // Allow only safe characters.
  if (!/^[\s\d+\-*/().,'"<>=!&|truefalsnl]+$/i.test(s)) return true;
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function(`"use strict"; return (${s});`);
    return Boolean(fn());
  } catch {
    return true;
  }
}

/**
 * Resolve a list of options from a path on a document (used by the Dialog
 * Builder's `optionsFrom` for select fields). Path can end with `[]`
 * indicating an array-of-objects whose `name` (default) becomes the label.
 *
 *  - `system.equipped.weapons[].name`  → array of `{value:'name', label:'name'}`
 *  - `system.attributes.str.value`     → single-value array (rare)
 *
 * Returns an array of `{value, label}` objects; falls back to `[]`.
 */
export function resolveOptionsFrom(spec, doc, helpers = {}) {
  if (!spec || !doc) return [];
  const getProperty = helpers.getProperty
    ?? globalThis?.foundry?.utils?.getProperty
    ?? ((o, p) => p.split(".").reduce((a, k) => (a == null ? a : a[k]), o));
  const arrayMode = spec.includes("[]");
  const cleanPath = spec.replace(/\[\]/g, "");
  const labelAfter = arrayMode ? cleanPath.split("[]")[1]?.replace(/^\./, "") || "name" : null;
  const collectionPath = arrayMode ? cleanPath.split("[]")[0].replace(/\.$/, "") : cleanPath;
  const v = getProperty(doc, collectionPath);
  if (v == null) return [];
  if (arrayMode) {
    if (!Array.isArray(v)) return [];
    return v.map((item, i) => {
      const label = labelAfter ? getProperty(item, labelAfter) ?? `#${i}` : String(item);
      return { value: String(label), label: String(label) };
    });
  }
  if (Array.isArray(v)) return v.map(x => ({ value: String(x), label: String(x) }));
  return [{ value: String(v), label: String(v) }];
}
