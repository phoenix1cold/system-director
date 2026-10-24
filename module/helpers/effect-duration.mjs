export const EFFECT_DURATION_UNITS = ["rounds", "turns", "seconds", "minutes", "hours", "days", "months", "years"];

/** Convert stored SD/v13 durations; native durations never read deprecated seconds. */
export function effectDurationData(input = {}, { start, renew = false } = {}) {
  const d = typeof input === "number" || typeof input === "string" ? { rounds: input } : (input ?? {});
  const native = "value" in d || "units" in d;
  let units = native && EFFECT_DURATION_UNITS.includes(d.units) ? d.units : "seconds";
  let value = null;
  if (native) {
    if (d.value != null && d.value !== "" && Number.isFinite(Number(d.value))) value = Math.max(0, Number(d.value));
  } else {
    for (const unit of ["rounds", "turns", "seconds"]) {
      if (Number.isFinite(Number(d[unit])) && Number(d[unit]) > 0) {
        units = unit;
        value = Number(d[unit]);
        break;
      }
    }
  }
  const duration = { value, units, expiry: d.expiry || null, expired: renew ? false : !!d.expired };
  let initial = start ? { ...start } : undefined;
  if (!native) {
    for (const [oldKey, key] of [["startTime", "time"], ["startRound", "round"], ["startTurn", "turn"], ["combat", "combat"]]) {
      if (d[oldKey] != null && initial?.[key] == null) (initial ??= {})[key] = d[oldKey];
    }
  }
  if (renew) {
    // Public v14 API supplies the world time and current combat/initiative anchor.
    const cls = globalThis.CONFIG?.ActiveEffect?.documentClass ?? globalThis.ActiveEffect;
    initial = cls.getEffectStart();
  }
  return { duration, ...(initial ? { start: initial } : {}) };
}

/** Kept duration-only for existing create payloads; core supplies their start. */
export function durationForRounds(rounds) {
  return effectDurationData(rounds).duration;
}

/** Ordinary duration edits are not a reapplication of the effect. */
export function editEffectDuration(effect, input) {
  const source = effect?._source ?? effect ?? {};
  const previous = effectDurationData(source.duration, { start: source.start });
  const next = effectDurationData({ ...previous.duration, ...input });
  const temporary = next.duration.value != null || next.duration.expiry != null;
  if (!temporary) next.duration.expired = false;
  return effectDurationData(next.duration, {
    start: previous.start,
    renew: temporary && (previous.duration.units !== next.duration.units || (previous.duration.value == null && previous.duration.expiry == null))
  });
}

export function registerEffectDurationHooks() {
  if (globalThis.__sdEffectDurationHooksInstalled) return;
  globalThis.__sdEffectDurationHooksInstalled = true;

  // v14's registry alone decides when effects expire. Its global delete policy
  // would also remove Item definitions, so scope removal after its native update.
  CONFIG.ActiveEffect.expiryAction ??= "update";
  Hooks.on("preCreateActiveEffect", (effect, data) => {
    if (!data?.duration) return;
    const converted = effectDurationData(data.duration, { start: data.start });
    if (converted.start) converted.start = { ...effect._source?.start, ...converted.start };
    effect.updateSource(converted);
  });
  Hooks.on("updateActiveEffect", (effect, changed, _options, userId) => {
    if (globalThis.game?.user?.id !== userId) return;
    if (changed?.duration?.expired !== true && changed?.["duration.expired"] !== true) return;
    if (effect.parent?.documentName !== "Actor" || effect.inCompendium) return;
    const { duration } = effectDurationData(effect._source?.duration ?? effect.duration);
    if (!duration.expired || (duration.value == null && duration.expiry == null)) return;
    return effect.delete().catch(error => console.error("SD | Failed to remove expired effect:", error));
  });
}

export function effectDurationLabel(effect) {
  const d = effect?.duration ?? {};
  const { duration } = effectDurationData(d);
  if (duration.expired) {
    const key = "SD.Effects.Expired";
    const label = globalThis.game?.i18n?.localize?.(key);
    return label && label !== key ? label : "Expired";
  }
  if (duration.value == null && duration.expiry == null) return "";
  const label = typeof d.label === "string" ? d.label.trim() : "";
  if (label && label.toLowerCase() !== "none") return label;
  if (duration.value == null) return duration.expiry;
  const remaining = d.remaining == null ? NaN : Number(d.remaining);
  const value = Number.isFinite(remaining) && remaining >= 0 ? Math.ceil(remaining) : duration.value;
  const suffix = { rounds: "r", turns: "t", seconds: "s", minutes: "m", hours: "h", days: "d", months: "mo", years: "y" };
  return `${value}${suffix[duration.units]}`;
}
