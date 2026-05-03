const _RX_NDM   = /(\d+)?d(\d+)/gi;
const _RX_KH_KL = /k[hl]\d+|dl\d+|dh\d+|kh|kl|min\d+|max\d+|r<?=?\d+|x>?=?\d+|cs[<>=]\d+|cf[<>=]\d+/gi;
const _RX_NUM   = /-?\d+(\.\d+)?/g;
const _RX_AT    = /@([A-Za-z_][A-Za-z0-9_.]*)/g;

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

export function formulaBounds(formula, rollData = {}) {
  if (formula == null || formula === "") return { min: 0, max: 0, avg: 0 };
  const src = resolveAtRefs(String(formula), rollData);

  const stripMods = (s) => s.replace(_RX_KH_KL, "");

  const subDice = (s, kind) => stripMods(s).replace(_RX_NDM, (m, nRaw, sides) => {
    const n     = Math.max(1, Number.parseInt(nRaw || "1", 10));
    const sided = Math.max(1, Number.parseInt(sides, 10));
    if (kind === "min") return String(n);
    if (kind === "max") return String(n * sided);
    return String(n * (sided + 1) / 2);
  });

  const _safeEval = (expr) => {

    try {
      const Cls = globalThis?.Roll ?? globalThis?.foundry?.dice?.Roll;
      if (Cls) {
        const r = new Cls(expr);

        if (typeof r.evaluateSync === "function") {
          r.evaluateSync({ allowStrings: false });
        } else if (typeof r.roll === "function") {
          r.roll({ async: false });
        }
        const total = Number(r.total);
        if (Number.isFinite(total)) return total;
      }
    } catch {}

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

export function clampFormula(formula, lo, hi) {
  let f = String(formula ?? "");
  const _has = (v) => v !== null && v !== undefined && String(v).trim() !== "";
  if (_has(hi)) f = `min(${String(hi).trim()},${f})`;
  if (_has(lo)) f = `max(${String(lo).trim()},${f})`;
  return f;
}

export function multiplyFormula(formula, n) {
  const fact = String(n ?? 1).trim();
  if (fact === "" || fact === "1") return String(formula ?? "");
  return `(${fact})*(${String(formula ?? "")})`;
}

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

  if (s.startsWith("-")) return `(${f})-(${s.slice(1)})`;
  if (s.startsWith("+")) return `(${f})+(${s.slice(1)})`;
  return `(${f})+(${s})`;
}

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

export function leadingD20Natural(roll) {
  if (!roll?.terms) return null;
  const _scanTerms = (terms) => {
    for (const t of terms) {

      if (t?.faces === 20 && Array.isArray(t.results)) {

        const kept = t.results.find(r => !r.discarded && r.active !== false)
                  ?? t.results[0];
        if (kept) return Number(kept.result) || null;
      }

      if (Array.isArray(t?.rolls)) {
        for (const r of t.rolls) {
          const v = leadingD20Natural(r);
          if (v != null) return v;
        }
      }

      if (t?.term?.terms) {
        const v = _scanTerms(t.term.terms);
        if (v != null) return v;
      }
    }
    return null;
  };
  return _scanTerms(roll.terms);
}

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

  s = s.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (m, id) => {
    const v = ctx[id];
    if (v === true || v === false) return String(v);
    if (Number.isFinite(Number(v))) return String(Number(v));
    return JSON.stringify(String(v ?? ""));
  });

  if (!/^[\s\d+\-*/().,'"<>=!&|truefalsnl]+$/i.test(s)) return true;
  try {

    const fn = new Function(`"use strict"; return (${s});`);
    return Boolean(fn());
  } catch {
    return true;
  }
}

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
