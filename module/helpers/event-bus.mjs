const HOOK_MAP = {
  updateDocument:     ["updateActor", "updateItem"],
  createDocument:     ["createActor", "createItem"],
  deleteDocument:     ["deleteActor", "deleteItem"],
  combatTurnStart:    ["combatTurnStart"],
  combatTurnEnd:      ["combatTurnEnd"],
  createActiveEffect: ["createActiveEffect"],
  hpDecrease:         ["updateActor"],
  restFlag:           ["updateActor"],
  itemEquipped:       ["sdItemEquipped"],
  itemUnequipped:     ["sdItemUnequipped"]
};

class EventBus {
  constructor() {
    this._reg = new Map();
    // hookName → foundry hook id
    this._hookIds = new Map();
  }

  init() {
    for (const actor of game.actors ?? []) this._registerActor(actor);

    Hooks.on("createActor", (actor) => this._registerActor(actor));
    Hooks.on("updateActor", (actor) => this._registerActor(actor));
    Hooks.on("deleteActor", (actor) => this._unregisterByActor(actor.id));
    Hooks.on("createItem",  (item)  => { if (item.actor) this._registerActor(item.actor); });
    Hooks.on("updateItem",  (item)  => { if (item.actor) this._registerActor(item.actor); });
    Hooks.on("deleteItem",  (item)  => { if (item.actor) this._registerActor(item.actor); });
  }

  /* ────────────────────────────────────────────────────────────────────── */

  _unregisterByActor(actorId) {
    for (const [hook, map] of this._reg.entries()) {
      for (const key of [...map.keys()]) {
        if (map.get(key)?.actorId === actorId) map.delete(key);
      }
      if (!map.size) {
        const id = this._hookIds.get(hook);
        if (id !== undefined) Hooks.off(hook, id);
        this._hookIds.delete(hook);
        this._reg.delete(hook);
      }
    }
  }

  _registerActor(actor) {
    if (!actor) return;
    this._unregisterByActor(actor.id);
    this._scanDoc(actor, actor);
    for (const item of (actor.items ?? [])) this._scanDoc(actor, item);
  }

  _scanDoc(actor, doc) {
    const tabs = doc.system?.customTabs ?? [];
    for (const tab of tabs) {
      for (const row of (tab.rows ?? [])) {
        for (const w of (row.widgets ?? [])) {
          const raw = w.formula ?? w.onClickFormula ?? null;
          this._registerPayload(actor, doc, w.id, raw);
        }
      }
    }

    const stg = doc.system?.sdTriggerGraph;
    if (stg) {
      const raw = typeof stg === "string" ? stg : JSON.stringify(stg);
      this._registerPayload(actor, doc, "__sheetTrigger", raw);
    }
  }

  _registerPayload(actor, doc, widgetId, raw) {
    if (typeof raw !== "string" || !raw.startsWith("{")) return;
    let obj; try { obj = JSON.parse(raw); } catch { return; }
    if (obj?._trigger !== "multi" || !obj._events) return;
    const macros = obj._macros ?? null;

    for (const [evKey, ev] of Object.entries(obj._events)) {
      if (evKey === "onClick") continue;
      const eventHook = ev?.hook ?? evKey;
      const foundryHooks = HOOK_MAP[eventHook];
      if (!foundryHooks || !ev?.actions?.length) continue;

      for (const hookName of foundryHooks) {
        const key = `${doc.uuid}::${widgetId}::${evKey}::${hookName}`;
        if (!this._reg.has(hookName)) this._bind(hookName);
        this._reg.get(hookName).set(key, {
          actorId:   actor.id,
          docUuid:   doc.uuid,
          widgetId,
          eventKey:  evKey,
          eventHook,
          actions:   ev.actions,
          data:      ev.data ?? {},
          macros
        });
      }
    }
  }

  _bind(hookName) {
    this._reg.set(hookName, new Map());
    const id = Hooks.on(hookName, (...args) => this._dispatch(hookName, args));
    this._hookIds.set(hookName, id);
  }

  /* ────────────────────────────────────────────────────────────────────── */

  async _dispatch(hookName, args) {
    const map = this._reg.get(hookName);
    if (!map) return;

    for (const entry of map.values()) {
      if (!this._matches(hookName, args, entry)) continue;
      await this._run(entry, args, hookName);
    }
  }

  _matches(hookName, args, entry) {
    const firstDoc = args[0];
    const actor    = game.actors?.get(entry.actorId);
    if (!actor) return false;

    switch (hookName) {
      case "updateActor":
      case "createActor":
      case "deleteActor": {
        if (firstDoc?.id !== entry.actorId) return false;
        return this._matchesSynthetic(hookName, args, entry);
      }
      case "updateItem":
      case "createItem":
      case "deleteItem": {
        const host = firstDoc?.actor;
        if (!host || host.id !== entry.actorId) return false;
        return this._matchesSynthetic(hookName, args, entry);
      }
      case "combatTurnStart":
      case "combatTurnEnd": {
        const combat = firstDoc;
        const turnIdx = combat?.turn ?? 0;
        const combatant = combat?.turns?.[turnIdx];
        return combatant?.actorId === entry.actorId;
      }
      case "createActiveEffect": {
        const parent = firstDoc?.parent;
        if (parent?.id !== entry.actorId) return false;
        const filter = entry.data?.nameFilter;
        if (filter && firstDoc?.name !== filter) return false;
        return true;
      }
      case "sdItemEquipped":
      case "sdItemUnequipped": {
        // args: [item, actor]
        const [item, actor] = args;
        const hostId = actor?.id ?? item?.parent?.id;
        if (hostId !== entry.actorId) return false;
        if (entry.docUuid && !entry.docUuid.includes(".Item.")) return true;
        if (entry.docUuid && item?.uuid && entry.docUuid !== item.uuid) return false;
        return true;
      }
      default: return false;
    }
  }

  _matchesSynthetic(hookName, args, entry) {
    if (entry.eventHook === "updateDocument" ||
        entry.eventHook === "createDocument" ||
        entry.eventHook === "deleteDocument") {
      if (entry.eventHook !== "updateDocument") return true;
      const diff = args[1] ?? {};
      const pathFilter = entry.data?.pathFilter;
      if (!pathFilter) return true;
      return foundry.utils.getProperty(diff, pathFilter) !== undefined;
    }
    if (entry.eventHook === "hpDecrease") {
      const [doc, diff] = args;
      const hpPath = entry.data?.hpPath ?? "system.resources.hp.value";
      const newVal = foundry.utils.getProperty(diff, hpPath);
      if (newVal === undefined) return false;
      const oldVal = Number(foundry.utils.getProperty(doc, hpPath) ?? 0);
      return Number(newVal) < oldVal;
    }
    if (entry.eventHook === "restFlag") {
      const [, diff] = args;
      const flagPath = entry.data?.flagPath ?? "system.flags.rest";
      return foundry.utils.getProperty(diff, flagPath) !== undefined;
    }
    return true;
  }

  async _run(entry, args, hookName) {
    const { ButtonExecutor } = await import("./button-executor.mjs");
    const actor = game.actors.get(entry.actorId);
    if (!actor) return;

    const doc = await fromUuid(entry.docUuid).catch(() => null);
    const itemCtx = doc?.documentName === "Item" ? doc : null;

    const runtime = this._buildRuntime(entry, args);
    const fakeBtnDef = {
      label:         `Event ${entry.eventKey}`,
      __eventRuntime: runtime,
      __macros:       entry.macros ?? null
    };

    try {
      for (const action of entry.actions) {
        await ButtonExecutor._runAction(action, itemCtx, actor, fakeBtnDef, runtime);
      }
    } catch (e) {
      console.error(`SD | event-bus ${hookName}/${entry.eventKey} failed`, e);
    }
  }

  _buildRuntime(entry, args) {
    const rt = {};
    switch (entry.eventHook) {
      case "updateDocument": {
        const [doc, diff] = args;
        const path = entry.data?.pathFilter;
        if (path) {
          rt.__eventPath     = path;
          rt.__eventNewValue = foundry.utils.getProperty(doc, path);
          rt.__eventOldValue = _oldValueFromDiff(diff, path, doc);
        }
        break;
      }
      case "combatTurnStart":
      case "combatTurnEnd": {
        const combat = args[0];
        rt.__eventRound       = combat?.round ?? 0;
        rt.__eventCombatantId = combat?.turns?.[combat?.turn ?? 0]?.id ?? "";
        break;
      }
      case "createActiveEffect": {
        rt.__eventEffectName = args[0]?.name ?? "";
        break;
      }
      case "hpDecrease": {
        const [doc, diff] = args;
        const hpPath = entry.data?.hpPath ?? "system.resources.hp.value";
        const newVal = Number(foundry.utils.getProperty(diff, hpPath) ?? 0);
        const oldVal = Number(foundry.utils.getProperty(doc, hpPath) ?? 0);
        rt.__eventAmount = Math.max(0, oldVal - newVal);
        rt.__eventNewHp  = newVal;
        break;
      }
      case "restFlag": {
        const [, diff] = args;
        const flagPath = entry.data?.flagPath ?? "system.flags.rest";
        rt.__eventRestType = String(foundry.utils.getProperty(diff, flagPath) ?? "");
        break;
      }
      case "itemEquipped":
      case "itemUnequipped": {
        const [item] = args;
        rt.__eventItemId   = item?.id   ?? "";
        rt.__eventItemName = item?.name ?? "";
        break;
      }
    }
    return rt;
  }
}

function _oldValueFromDiff(diff, path, doc) {
  try {
    const prev = foundry.utils.getProperty(doc._source ?? {}, path);
    if (prev !== undefined) return prev;
  } catch { /* noop */ }
  return null;
}

export const EVENT_BUS = new EventBus();
