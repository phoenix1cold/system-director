import { FormulaEngine } from "../helpers/formula-engine.mjs";

/**
 * SD ActiveEffect: resolves module tokens ({widget:key}, {system.path},
 * {item:Name.field}, {@attr}, math like "{widget:a}+2") inside change values
 * before core applies them.
 *
 * Foundry v13 applied changes through the INSTANCE method `apply(doc, change)`.
 * Foundry v14 (Active Effects V2) applies changes through the STATIC method
 * `applyChange(targetDoc, change, options)` and the instance `apply` is gone,
 * so BOTH entry points are overridden here.
 */
export class SDActiveEffect extends ActiveEffect {

  /**
   * Resolve formula tokens inside a change value string.
   * Returns the resolved string, or null when the value has no tokens or
   * cannot be resolved (caller should then keep the original change).
   */
  static _sdResolveValueString(ctx, raw) {
    if (typeof raw !== "string" || !raw.includes("{")) return null;
    if (!ctx) return null;

    let resolved = null;
    try { resolved = FormulaEngine.evaluate(raw, ctx); } catch { resolved = null; }
    let str = (resolved === undefined || resolved === null) ? "" : String(resolved);

    if (str === "" || str.startsWith("!err")) {
      // Not a numeric formula -- substitute tokens without math evaluation.
      try { str = String(FormulaEngine._resolveRefs(raw, ctx) ?? ""); } catch { return null; }
      if (str.includes("{")) return null;
      if (str.length >= 2 && str.startsWith(String.fromCharCode(34)) && str.endsWith(String.fromCharCode(34))) str = str.slice(1, -1);
    }
    return str;
  }

  /** Plain-object copy of a change so the stored effect data is never mutated. */
  static _sdCloneChange(change) {
    const out = {};
    for (const k of ["key", "value", "priority", "type", "phase", "effect"]) {
      let v;
      try { v = change[k]; } catch { v = undefined; }
      if (v !== undefined) out[k] = v;
    }
    // Read the deprecated numeric #mode only when the string #type is absent
    // (v13 or plain objects); on v14+ accessing #mode logs a compat warning.
    if (out.type === undefined) {
      let m;
      try { m = change.mode; } catch { m = undefined; }
      if (m !== undefined) out.mode = m;
    }
    return out;
  }

  static _sdLogResolve(key, raw, str) {
    try {
      const seen = SDActiveEffect._sdLogSeen ?? (SDActiveEffect._sdLogSeen = new Set());
      const sig = `${key}|${raw}|${str}`;
      if (!seen.has(sig)) {
        seen.add(sig);
        console.log(`[sd] AE resolve: key="${key}" value="${raw}" -> "${str}"`);
      }
    } catch { /* ignore */ }
  }

  /** Shared: return a change with resolved value, or the original change. */
  static _sdPrepareChange(ctx, change) {
    const raw = change?.value;
    const str = this._sdResolveValueString(ctx, raw);
    if (str === null || str === raw) return change;
    const out = this._sdCloneChange(change);
    out.value = str;
    this._sdLogResolve(change?.key, raw, str);
    return out;
  }

  /** Foundry v14+ (Active Effects V2) static application pipeline. */
  static applyChange(targetDoc, change, ...rest) {
    try { change = this._sdPrepareChange(targetDoc, change); } catch (e) {
      console.warn("SD | Failed to resolve effect change value:", e);
    }
    return super.applyChange(targetDoc, change, ...rest);
  }

  /** Foundry v13 instance application pipeline (not called on v14). */
  apply(doc, change, ...rest) {
    try {
      const ctx = (doc && doc.documentName) ? doc : (this.parent ?? doc ?? null);
      change = SDActiveEffect._sdPrepareChange(ctx, change);
    } catch (e) {
      console.warn("SD | Failed to resolve effect change value:", e);
    }
    return super.apply(doc, change, ...rest);
  }
}
