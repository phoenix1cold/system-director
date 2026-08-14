

const SOCKET_NS = "system.sd";

function _i18n(k, fb=k) { return game.i18n?.localize?.(k) ?? fb; }

export class SDQuest {

  static _rewardLocks = new Set();

  static init() {
    Hooks.once("ready", () => {
      game.socket.on(SOCKET_NS, async (data) => {
        if (!data || data.type !== "quest.action") return;
        if (!game.user?.isGM) return;

        const activeGMs = (game.users?.contents ?? []).filter(u => u.isGM && u.active);
        const primaryGM = activeGMs[0]?.id ?? null;
        if (primaryGM && game.user.id !== primaryGM) return;
        try {
          await SDQuest._applyOnGM(data.action ?? {}, data.ctx ?? {});
        } catch (err) {
          console.error("SD | quest.action GM-side failed", err);
        }
      });
      SDQuest.initAutoClaimable();
    });
  }


  static async resolveActor(actorRef, ctx) {
    if (!actorRef) {

      const u = game.user;
      const charId = u?.character?.id ?? null;
      if (charId) return game.actors?.get(charId);
      const owned = (game.actors?.contents ?? []).filter(a => a.isOwner && a.type === "character");
      return owned[0] ?? null;
    }
    if (actorRef === "this" || actorRef === "triggering") {
      const id = ctx?.actorId;
      if (id) return game.actors?.get(id) ?? null;
      return null;
    }

    if (typeof actorRef === "string" && actorRef.startsWith("Actor.")) {
      const a = await fromUuid(actorRef).catch(() => null);
      return a instanceof Actor ? a : null;
    }
    return game.actors?.get(actorRef) ?? null;
  }


  static async applyAction(action, ctx = {}) {
    if (!action || action.type !== "questAction") return;

    if (game.user?.isGM) {
      await SDQuest._applyOnGM(action, ctx);
      return;
    }

    const hasGM = (game.users?.contents ?? []).some(u => u.isGM && u.active);
    if (!hasGM) {
      ui.notifications?.warn(_i18n("SD.QuestLog.NoGMOnline","No GM online — quest action skipped."));
      return;
    }
    game.socket.emit(SOCKET_NS, { type: "quest.action", action, ctx });
  }


  static async _applyOnGM(action, ctx) {
    const op = action.op;
    let logUuid = action.questLogUuid;
    if (!logUuid || logUuid === "this") logUuid = ctx?.questLogUuid ?? null;
    if (!logUuid) return;

    const log = await fromUuid(logUuid).catch(() => null);
    if (!log || log.documentName !== "Item" || log.type !== "questlog") return;

    let qid = action.questId;
    if (!qid || qid === "this" || qid === "__SDQ_THIS__") qid = ctx?.questId ?? "";
    let sid = action.subtaskId;
    if (sid === "this" || sid === "__SDQ_THIS_SUB__") sid = ctx?.subtaskId ?? "";

    const quests = foundry.utils.deepClone(log.system?.quests ?? []);
    const quest  = quests.find(q => q?.id === qid);

    switch (op) {
      case "activate": {
        if (!quest) return;
        const statusChanged = quest.status !== "active";
        if (statusChanged) {
          quest.status = "active";
          await log.update({ "system.quests": quests });
        }

        let actor = null;
        try { actor = await SDQuest.resolveActor(action.actorRef ?? "", ctx); } catch (_) {}
        if (actor) {
          await actor.update({
            "system.activeQuest": { questLogUuid: logUuid, questId: qid }
          }).catch(() => {});
        }
        if (statusChanged || actor) Hooks.callAll("sdQuestActivated", {
          questLogUuid: logUuid, questId: qid, actorId: actor?.id ?? "", userId: game.user?.id ?? ""
        });
        return;
      }
      case "complete": {
        if (!quest) return;
        const statusChanged = quest.status !== "completed";
        if (statusChanged) {
          quest.status = "completed";
          SDQuest._unlockDependents(quests);
          await log.update({ "system.quests": quests });
        }
        await SDQuest._clearActiveQuestReferences(logUuid, qid);
        if (statusChanged) Hooks.callAll("sdQuestCompleted", { questLogUuid: logUuid, questId: qid });
        return;
      }
      case "fail": {
        if (!quest) return;
        const statusChanged = quest.status !== "failed";
        if (statusChanged) {
          quest.status = "failed";
          await log.update({ "system.quests": quests });
        }
        await SDQuest._clearActiveQuestReferences(logUuid, qid);
        if (statusChanged) Hooks.callAll("sdQuestFailed", { questLogUuid: logUuid, questId: qid });
        return;
      }
      case "lock": {
        if (!quest) return;
        if (quest.status !== "locked") {
          quest.status = "locked";
          await log.update({ "system.quests": quests });
        }
        await SDQuest._clearActiveQuestReferences(logUuid, qid);
        return;
      }
      case "available": {
        if (!quest) return;
        if (quest.status === "available") return;
        quest.status = "available";
        await log.update({ "system.quests": quests });
        return;
      }
      case "subtaskDone": {
        if (!quest) return;
        const sub = (quest.subtasks ?? []).find(s => s?.id === sid);
        if (!sub) return;
        const newDone = !!action.done;
        if (sub.done === newDone) return;
        sub.done = newDone;
        const required = (quest.subtasks ?? []).filter(s => s.required !== false);
        const autoCompleted = newDone && quest.autoComplete && required.length > 0
          && required.every(s => s.done) && quest.status !== "completed";
        if (autoCompleted) {
          quest.status = "completed";
          SDQuest._unlockDependents(quests);
        }
        await log.update({ "system.quests": quests });
        if (newDone) Hooks.callAll("sdSubtaskDone", { questLogUuid: logUuid, questId: qid, subtaskId: sid });
        if (autoCompleted) {
          await SDQuest._clearActiveQuestReferences(logUuid, qid);
          Hooks.callAll("sdQuestCompleted", { questLogUuid: logUuid, questId: qid });
        }
        return;
      }
      case "showToPlayer": {
        if (!quest) return;
        quest.visibility = quest.visibility ?? { mode: "visible", players: [], gmRevealed: false };
        let uid = action.userId;
        if (uid === "this") uid = ctx?.userId ?? game.user?.id ?? "";
        if (!uid || uid === "all") {
          quest.visibility.mode = "visible";
          quest.visibility.players = [];
        } else {
          quest.visibility.mode = "perPlayer";
          quest.visibility.players = quest.visibility.players ?? [];
          if (!quest.visibility.players.includes(uid)) quest.visibility.players.push(uid);
        }
        await log.update({ "system.quests": quests });
        return;
      }
      case "toggleReveal": {
        if (!quest) return;
        quest.visibility = quest.visibility ?? { mode: "visible", players: [], gmRevealed: false };
        const cur = !!quest.visibility.gmRevealed;
        const next = (action.on === null || action.on === undefined) ? !cur : !!action.on;
        if (cur === next) return;
        quest.visibility.gmRevealed = next;
        await log.update({ "system.quests": quests });
        Hooks.callAll("sdQuestRevealed", { questLogUuid: logUuid, questId: qid, revealed: next });
        return;
      }


      case "rewardReveal": {
        if (!quest) return;
        const r = (quest.rewards ?? []).find(x => x.id === action.rewardId);
        if (!r) return;
        const cur = !!r.revealed;
        const next = (action.on === null || action.on === undefined) ? !cur : !!action.on;
        if (cur === next) return;
        r.revealed = next;
        await log.update({ "system.quests": quests });
        return;
      }

      case "rewardMakeClaimable": {
        if (!quest) return;
        const r = (quest.rewards ?? []).find(x => x.id === action.rewardId);
        if (!r) return;
        const next = (action.on === null || action.on === undefined) ? true : !!action.on;
        if (r.claimable === next) return;
        r.claimable = next;
        await log.update({ "system.quests": quests });
        return;
      }

      case "rewardClaim": {
        if (!quest) return;
        const r = (quest.rewards ?? []).find(x => x.id === action.rewardId);
        if (!r) return;

        const userId = ctx?.userId ?? game.user?.id ?? "";
        if (!userId || !r.claimable) return;
        const lockKey = `${logUuid}:${qid}:${r.id}`;
        if (SDQuest._rewardLocks.has(lockKey)) {
          ui.notifications?.warn(_i18n("SD.QuestLog.Reward.Busy", "Reward is already being processed."));
          return;
        }
        SDQuest._rewardLocks.add(lockKey);
        try {
          if (r.mode === "single" && Object.keys(r.claimedBy ?? {}).length > 0) return;
          if (r.mode !== "single" && r.claimedBy?.[userId]) return;

          const u = game.users?.get(userId);
          const claimerActor = u?.character?.id ? game.actors?.get(u.character.id) : null;
          if (!claimerActor) {
            ui.notifications?.warn(_i18n("SD.QuestLog.Reward.NoCharacter", "A character must be assigned before claiming a reward."));
            return;
          }

          const payout = await SDQuest._payoutReward(r, claimerActor, "claim");
          if (!payout.ok) {
            console.warn("SD | reward payout incomplete", payout.errors);
            ui.notifications?.error(`${_i18n("SD.QuestLog.Reward.PayoutFailed", "Reward payout failed")}: ${payout.errors.join("; ")}`);
            return;
          }

          r.claimedBy = r.claimedBy ?? {};
          r.claimedBy[userId] = { ts: Date.now(), actorId: claimerActor.id };
          await log.update({ "system.quests": quests });
        } finally {
          SDQuest._rewardLocks.delete(lockKey);
        }
        return;
      }

      case "rewardGrantAll": {
        if (!quest) return;
        const r = (quest.rewards ?? []).find(x => x.id === action.rewardId);
        if (!r) return;
        const lockKey = `${logUuid}:${qid}:${r.id}:all`;
        if (SDQuest._rewardLocks.has(lockKey)) return;
        SDQuest._rewardLocks.add(lockKey);
        try {
          const players = (game.users?.contents ?? []).filter(u => !u.isGM && u.character);
          if (!players.length) {
            ui.notifications?.warn(_i18n("SD.QuestLog.Reward.NoCharacters", "No players with assigned characters."));
            return;
          }

          const failures = [];
          let granted = 0;
          r.claimedBy = r.claimedBy ?? {};
          for (const u of players) {
            if (r.claimedBy[u.id]) continue;
            const a = game.actors?.get(u.character.id);
            if (!a) continue;
            const payout = await SDQuest._payoutReward(r, a, "grantAll");
            if (!payout.ok) {
              failures.push(`${a.name}: ${payout.errors.join(", ")}`);
              continue;
            }
            r.claimedBy[u.id] = { ts: Date.now(), actorId: a.id, mode: "grantAll" };
            granted++;
          }
          if (granted) await log.update({ "system.quests": quests });
          if (failures.length) {
            console.warn("SD | rewardGrantAll partial failures", failures);
            ui.notifications?.error(`${_i18n("SD.QuestLog.Reward.PayoutFailed", "Reward payout failed")}: ${failures.join("; ")}`);
          } else if (!granted) {
            ui.notifications?.info(_i18n("SD.QuestLog.Reward.AlreadyGranted", "Reward was already granted to all eligible characters."));
          }
        } finally {
          SDQuest._rewardLocks.delete(lockKey);
        }
        return;
      }

      default:
        console.warn("SD | quest.action unknown op:", op);
    }
  }


  static async _payoutReward(reward, actor, source) {
    const errors = [];
    if (!reward || !actor) return { ok:false, errors:["missing reward or actor"] };

    try {
      const docs = [];
      for (const it of (reward.items ?? [])) {
        if (!it.uuid) continue;
        const src = await fromUuid(it.uuid).catch(() => null);
        if (!src) { errors.push(`item not found: ${it.name || it.uuid}`); continue; }
        const data = src.toObject();
        const qty = Math.max(1, Math.floor(Number(it.qty) || 1));
        if (data.system && typeof data.system === "object" && "quantity" in data.system) {
          data.system.quantity = qty;
          docs.push(data);
        } else {
          for (let i = 0; i < qty; i++) docs.push(foundry.utils.deepClone(data));
        }
      }
      if (errors.length) return { ok:false, errors };
      if (docs.length) await actor.createEmbeddedDocuments("Item", docs);
    } catch (e) { errors.push(`items: ${e?.message ?? e}`); }

    for (const c of (reward.currency ?? [])) {
      try {
        const path = String(c.path ?? "");
        if (!path) continue;
        const amount = await SDQuest._evaluateAmount(c.amount, actor);
        if (!Number.isFinite(amount)) { errors.push(`currency ${path}: invalid amount`); continue; }
        const cur = Number(foundry.utils.getProperty(actor, path) ?? 0);
        await actor.update({ [path]: cur + amount });
      } catch (e) { errors.push(`currency: ${e?.message ?? e}`); }
    }

    try {
      const changes = reward.pathChanges ?? [];
      const selected = source === "grantAll" ? changes : changes.filter(pc => pc.scope !== "all");
      for (const pc of selected) await SDQuest._applyPathChange(pc, actor);
      if (source === "claim") {
        const allOnClaim = changes.filter(pc => pc.scope === "all");
        if (allOnClaim.length) {
          for (const u of (game.users?.contents ?? []).filter(u => !u.isGM && u.character)) {
            const target = game.actors?.get(u.character.id);
            if (!target) continue;
            for (const pc of allOnClaim) await SDQuest._applyPathChange(pc, target);
          }
        }
      }
    } catch (e) { errors.push(`field changes: ${e?.message ?? e}`); }

    return { ok: errors.length === 0, errors };
  }

  static async _evaluateAmount(raw, actor) {
    const s = String(raw ?? "").trim();
    if (!s) return 0;
    const n = Number(s);
    if (Number.isFinite(n)) return n;
    try {
      const { FormulaEngine } = await import("./formula-engine.mjs");
      const ev = FormulaEngine.evaluate(s, actor);
      const num = Number(ev);
      return Number.isFinite(num) ? num : 0;
    } catch { return 0; }
  }

  static async _applyPathChange(pc, actor) {
    const path = String(pc.path ?? "");
    if (!path || !actor) return;
    const amount = await SDQuest._evaluateAmount(pc.value, actor);
    const cur = Number(foundry.utils.getProperty(actor, path) ?? 0);
    let next = cur;
    switch (pc.op) {
      case "set": next = amount; break;
      case "add": next = cur + amount; break;
      case "sub": next = cur - amount; break;
      case "mul": next = cur * amount; break;
      case "min": next = Math.min(cur, amount); break;
      case "max": next = Math.max(cur, amount); break;
      default:    next = cur + amount;
    }
    await actor.update({ [path]: next });
  }


  static _unlockDependents(quests) {
    const completed = new Set((quests ?? []).filter(q => q?.status === "completed").map(q => q.id));
    for (const q of (quests ?? [])) {
      const req = Array.isArray(q?.prerequisites) ? q.prerequisites.filter(Boolean) : [];
      if (q?.status === "locked" && req.length && req.every(id => completed.has(id))) q.status = "available";
    }
  }

  static async _clearActiveQuestReferences(questLogUuid, questId) {
    const updates = [];
    for (const actor of (game.actors?.contents ?? [])) {
      const active = actor?.system?.activeQuest;
      if (active?.questLogUuid !== questLogUuid || active?.questId !== questId) continue;
      updates.push(actor.update({ "system.activeQuest": {} }).catch(err => console.warn("SD | clear active quest failed", err)));
    }
    await Promise.all(updates);
  }

  static initAutoClaimable() {
    Hooks.on("sdQuestCompleted", async ({ questLogUuid, questId }) => {
      if (!game.user?.isGM) return;
      const activeGMs = (game.users?.contents ?? []).filter(u => u.isGM && u.active);
      const primaryGM = activeGMs[0]?.id ?? null;
      if (primaryGM && game.user.id !== primaryGM) return;
      try { await SDQuest._maybeMakeClaimable(questLogUuid, questId, "questCompleted"); } catch (e) { console.warn(e); }
    });

    Hooks.on("sdSubtaskDone", async ({ questLogUuid, questId, subtaskId }) => {
      if (!game.user?.isGM) return;
      const activeGMs = (game.users?.contents ?? []).filter(u => u.isGM && u.active);
      const primaryGM = activeGMs[0]?.id ?? null;
      if (primaryGM && game.user.id !== primaryGM) return;
      try { await SDQuest._maybeMakeClaimable(questLogUuid, questId, "subtaskCompleted", subtaskId); } catch (e) { console.warn(e); }
    });
  }

  static async _maybeMakeClaimable(questLogUuid, questId, trigger, subtaskId) {
    const log = await fromUuid(questLogUuid).catch(() => null);
    if (!log || log.documentName !== "Item" || log.type !== "questlog") return;

    const quests = foundry.utils.deepClone(log.system?.quests ?? []);
    const quest = quests.find(q => q?.id === questId);
    if (!quest) return;

    let dirty = false;
    for (const r of (quest.rewards ?? [])) {
      if (r.claimable) continue;
      if (r.grantOn === trigger) {
        if (trigger === "subtaskCompleted" && r.subtaskId && r.subtaskId !== subtaskId) continue;
        r.claimable = true;
        dirty = true;
      }
    }
    if (dirty) await log.update({ "system.quests": quests });
  }
}
