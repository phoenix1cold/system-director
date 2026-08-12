export function durationForRounds(rounds) {
  const value = Number(rounds);
  if (!Number.isFinite(value) || value <= 0) return {};
  const duration = { rounds: Math.trunc(value) };
  const combat = game?.combat ?? null;
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
  if (duration?.startRound != null && duration?.startTurn != null) return duration;
  return { ...(duration ?? {}), ...durationForRounds(rounds) };
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
    if (!("round" in (changed ?? {})) && !("turn" in (changed ?? {}))) return;
    const updates = [];
    for (const combatant of combat?.combatants ?? []) {
      const actor = combatant?.actor;
      if (!actor) continue;
      for (const effect of actor.effects ?? []) {
        const d = effect.duration ?? {};
        if (!(Number(d.rounds) > 0)) continue;
        if (d.startRound != null && d.startTurn != null) continue;
        updates.push(effect.update({ duration: _durationWithCombatStart(d) }).catch(() => null));
      }
    }
    if (updates.length) await Promise.all(updates);
  });
}

export function effectDurationLabel(effect) {
  const d = effect?.duration ?? {};
  if (typeof d.label === "string" && d.label.trim()) return d.label;

  const remaining = Number(d.remaining);
  if (Number.isFinite(remaining) && remaining >= 0) {
    if (Number(d.rounds) > 0) return `${Math.ceil(remaining)}r`;
    if (Number(d.seconds) > 0) return `${Math.ceil(remaining)}s`;
  }

  if (Number(d.rounds) > 0) return `${Number(d.rounds)}r`;
  if (Number(d.seconds) > 0) return `${Number(d.seconds)}s`;
  return "";
}
