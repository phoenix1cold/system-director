export function durationForRounds(rounds) {
  const value = Number(rounds);
  if (!Number.isFinite(value) || value <= 0) return {};
  const duration = { rounds: Math.trunc(value) };
  const combat = globalThis.game?.combat ?? null;
  if (combat?.started || Number(combat?.round) > 0) {
    const round = Number(combat.round);
    const turn = Number(combat.turn);
    if (Number.isFinite(round)) duration.startRound = round;
    if (Number.isFinite(turn)) duration.startTurn = turn;
  }
  return duration;
}

function _durationWithCombatStart(duration) {
  const rounds = Number(duration?.rounds);
  if (!Number.isFinite(rounds) || rounds <= 0) return duration ?? {};
  const normalized = duration?.seconds === 0 ? { ...duration, seconds: null } : duration;
  if (duration?.startRound != null && duration?.startTurn != null) return normalized;
  return { ...normalized, ...durationForRounds(rounds) };
}

export function registerEffectDurationHooks() {
  if (globalThis.__sdEffectDurationHooksInstalled) return;
  globalThis.__sdEffectDurationHooksInstalled = true;

  Hooks.on("preCreateActiveEffect", (effect, data) => {
    const duration = _durationWithCombatStart(data?.duration ?? effect?.duration ?? {});
    if (duration !== data?.duration) {
      try { effect.updateSource({ duration }); } catch {  }
    }
  });

  Hooks.on("updateCombat", async (combat, changed) => {
    if (!game.user?.isGM) return;
    if (game.users?.activeGM && game.users.activeGM.id !== game.user.id) return;
    if (!("round" in (changed ?? {})) && !("turn" in (changed ?? {}))) return;
    if (!(Number(combat?.round) > 0)) return;
    const updates = [];
    const seen = new Set();
    for (const combatant of combat?.combatants ?? []) {
      const actor = combatant?.actor;
      if (!actor || seen.has(actor)) continue;
      seen.add(actor);
      for (const effect of actor.effects ?? []) {
        if (effect.disabled) continue;
        const d = effect._source?.duration ?? effect.duration ?? {};
        if (!(Number(d.rounds) > 0 || Number(d.turns) > 0)) continue;
        const update = d.seconds === 0 ? { "duration.seconds": null } : {};
        if (d.startRound == null || d.startTurn == null) {
          updates.push(effect.update({ ...update, "duration.startRound": Number(combat.round), "duration.startTurn": Number(combat.turn ?? 0) }).catch(() => null));
          continue;
        }
        const turns = Math.max(1, combat.turns?.length ?? combat.combatants?.size ?? 1);
        const elapsed = (Number(combat.round) - Number(d.startRound)) * turns
          + Number(combat.turn ?? 0) - Number(d.startTurn);
        if (elapsed >= (Number(d.rounds) || 0) * turns + (Number(d.turns) || 0)) {
          update.disabled = true;
        }
        if (Object.keys(update).length) updates.push(effect.update(update).catch(() => null));
      }
    }
    if (updates.length) await Promise.all(updates);
  });

  Hooks.on("updateWorldTime", async worldTime => {
    if (!game.user?.isGM) return;
    if (game.users?.activeGM && game.users.activeGM.id !== game.user.id) return;
    const actors = new Set(game.actors ?? []);
    for (const scene of game.scenes ?? []) for (const token of scene.tokens ?? []) if (token.actor) actors.add(token.actor);
    for (const actor of actors) for (const effect of actor.effects ?? []) {
      const d = effect._source?.duration ?? effect.duration ?? {};
      if (effect.disabled || Number(d.rounds) > 0 || Number(d.turns) > 0) continue;
      if (Number(d.seconds) > 0 && d.startTime != null && Number(worldTime) >= Number(d.startTime) + Number(d.seconds)) {
        await effect.update({ disabled: true }).catch(() => null);
      }
    }
  });
}

export function effectDurationLabel(effect) {
  const d = effect?.duration ?? {};

  // Permanent effects: Foundry reports duration.label === "None", which used to
  // leak into every effect row as an ugly "None" badge. Passive effects get no
  // badge at all.
  const hasRounds  = Number(d.rounds)  > 0;
  const hasSeconds = Number(d.seconds) > 0;
  const hasTurns   = Number(d.turns)   > 0;
  if (!hasRounds && !hasSeconds && !hasTurns) return "";

  const rawLabel = (typeof d.label === "string") ? d.label.trim() : "";
  if (rawLabel && rawLabel.toLowerCase() !== "none") return rawLabel;

  const remaining = Number(d.remaining);
  if (Number.isFinite(remaining) && remaining >= 0) {
    if (Number(d.rounds) > 0) return `${Math.ceil(remaining)}r`;
    if (Number(d.seconds) > 0) return `${Math.ceil(remaining)}s`;
  }

  if (hasRounds) return `${Number(d.rounds)}r`;
  if (hasSeconds) return `${Number(d.seconds)}s`;
  if (hasTurns) return `${Number(d.turns)}t`;
  return "";
}
