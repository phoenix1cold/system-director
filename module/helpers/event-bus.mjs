const HOOK_MAP = {
  updateDocument:        ["updateActor", "updateItem"],
  createDocument:        ["createActor", "createItem"],
  deleteDocument:        ["deleteActor", "deleteItem"],
  combatTurnStart:       ["combatTurnStart"],
  combatTurnEnd:         ["combatTurnEnd"],
  combatEncounterStart:  ["combatEncounterStart"],
  combatEncounterEnd:    ["combatEncounterEnd"],
  createActiveEffect:    ["createActiveEffect"],
  hpDecrease:            ["updateActor"],
  restFlag:              ["updateActor"],
  itemEquipped:          ["sdItemEquipped"],
  itemUnequipped:        ["sdItemUnequipped"],
  cardDrawn:             ["createCard"],

  sdQuestActivated:   ["sdQuestActivated"],
  sdQuestCompleted:   ["sdQuestCompleted"],
  sdQuestFailed:      ["sdQuestFailed"],
  sdSubtaskDone:      ["sdSubtaskDone"],
  sdQuestRevealed:    ["sdQuestRevealed"],

  sdVisionDetect:     ["sdVisionDetect"],

  sdMacroUse:         ["sdMacroUse"]
};

function _installCombatHookBridge() {
  if (globalThis.__sdCombatBridgeInstalled) return;
  globalThis.__sdCombatBridgeInstalled = true;

  const _turnAt = (combat, idx) => {
    if (!combat || idx == null || idx < 0) return null;
    return combat.turns?.[idx] ?? null;
  };

  const _wrapCombatAtTurn = (combat, turnIdx, round) => {
    if (!combat) return null;
    const view = Object.create(combat);
    Object.defineProperty(view, "turn",  { value: turnIdx, enumerable: true });
    Object.defineProperty(view, "round", { value: round,   enumerable: true });
    return view;
  };

  Hooks.on("combatTurnChange", (combat, prior, current) => {
    try {
      const priorCombatant = (prior?.combatantId)
        ? combat?.combatants?.get?.(prior.combatantId) ?? combat?.turns?.find?.(t => t.id === prior.combatantId) ?? null
        : null;
      if (priorCombatant) {
        const priorTurnIdx = combat?.turns?.findIndex?.(t => t.id === prior.combatantId) ?? -1;
        const priorView = (priorTurnIdx >= 0)
          ? _wrapCombatAtTurn(combat, priorTurnIdx, prior.round ?? combat.round)
          : combat;
        Hooks.callAll("combatTurnEnd", priorView);
      }
      if (current?.combatantId) {
        Hooks.callAll("combatTurnStart", combat);
      }
    } catch (e) {
      console.warn("SD | combatTurnChange bridge failed", e);
    }
  });

  Hooks.on("combatStart", (combat, updateData) => {
    try {
      Hooks.callAll("combatEncounterStart", combat);
      const turnIdx = updateData?.turn ?? combat?.turn ?? 0;
      if (_turnAt(combat, turnIdx)) {
        Hooks.callAll("combatTurnStart", combat);
      }
    } catch (e) {
      console.warn("SD | combatStart bridge failed", e);
    }
  });

  Hooks.on("deleteCombat", (combat) => {
    try {
      if (combat?.started && _turnAt(combat, combat.turn ?? 0)) {
        Hooks.callAll("combatTurnEnd", combat);
      }
      Hooks.callAll("combatEncounterEnd", combat);
    } catch (e) {
      console.warn("SD | deleteCombat bridge failed", e);
    }
  });
}

const QUEST_HOOKS = new Set(["sdQuestActivated","sdQuestCompleted","sdQuestFailed","sdSubtaskDone","sdQuestRevealed"]);

function _installMacroHookBridge() {
  if (globalThis.__sdMacroBridgeInstalled) return;
  globalThis.__sdMacroBridgeInstalled = true;

  const MacroCls = globalThis.Macro
    ?? globalThis.CONFIG?.Macro?.documentClass
    ?? null;
  const proto = MacroCls?.prototype;
  if (!proto || typeof proto.execute !== "function") {
    console.warn("SD | sdMacroUse bridge: Macro.prototype.execute unavailable");
    return;
  }

  const origExecute = proto.execute;
  proto.execute = async function(scope, ...rest) {
    let result, err = null;
    try {
      result = await origExecute.call(this, scope, ...rest);
    } catch (e) {
      err = e;
    }
    try {
      let speakerActor = scope?.actor ?? null;
      let speakerToken = scope?.token ?? null;
      if (!speakerActor && !speakerToken && typeof ChatMessage?.getSpeaker === "function") {
        const sp = ChatMessage.getSpeaker();
        if (sp?.token)  speakerToken = canvas?.tokens?.get?.(sp.token)?.document ?? canvas?.tokens?.get?.(sp.token) ?? null;
        if (sp?.actor)  speakerActor = game.actors?.get?.(sp.actor) ?? null;
      }
      Hooks.callAll("sdMacroUse", {
        macro:     this,
        macroId:   this?.id   ?? "",
        macroUuid: this?.uuid ?? "",
        macroName: this?.name ?? "",
        actorId:   speakerActor?.id   ?? "",
        tokenId:   speakerToken?.id   ?? speakerToken?.document?.id ?? "",
        scope:     scope ?? null
      });
    } catch (e) {
      console.warn("SD | sdMacroUse hook failed:", e);
    }
    if (err) throw err;
    return result;
  };
}

function _installVisionDetectBridge(eventBus) {
  if (globalThis.__sdVisionDetectBridgeInstalled) return;
  globalThis.__sdVisionDetectBridgeInstalled = true;

  const _rescan = (sceneId) => {
    try { eventBus._rescanVisionDetect(sceneId); } catch (e) {
      console.warn("SD | vision detect rescan failed:", e);
    }
  };

  Hooks.on("updateToken", (tokenDoc, changes) => {
    const moved = changes && ["x","y","rotation","hidden","elevation","width","height"].some(k => k in changes);
    if (!moved) return;
    _rescan(tokenDoc?.parent?.id ?? null);
  });
  Hooks.on("createToken", (tokenDoc) => _rescan(tokenDoc?.parent?.id ?? null));
  Hooks.on("deleteToken", (tokenDoc) => _rescan(tokenDoc?.parent?.id ?? null));

  Hooks.on("canvasReady", () => _rescan(canvas?.scene?.id ?? null));
  Hooks.on("combatTurnStart", () => _rescan(canvas?.scene?.id ?? null));
}

class EventBus {
  constructor() {
    this._reg = new Map();

    this._hookIds = new Map();
  }

  init() {
    _installCombatHookBridge();
    _installVisionDetectBridge(this);
    _installMacroHookBridge();
    this._visionState = this._visionState ?? new Map();
    for (const actor of game.actors ?? []) this._registerActor(actor);
    for (const item of game.items ?? []) this._registerWorldItem(item);

    Hooks.on("createActor", (actor) => this._registerActor(actor));
    Hooks.on("updateActor", (actor) => this._registerActor(actor));
    Hooks.on("deleteActor", (actor) => this._unregisterByActor(actor.id));
    Hooks.on("createItem",  (item)  => {
      if (item.actor) this._registerActor(item.actor);
      else            this._registerWorldItem(item);
    });
    Hooks.on("updateItem",  (item)  => {
      if (item.actor) this._registerActor(item.actor);
      else            this._registerWorldItem(item);
    });
    Hooks.on("deleteItem",  (item)  => {
      if (item.actor) this._registerActor(item.actor);
      else            this._unregisterByDocUuid(item.uuid);
    });
  }

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

  _unregisterByDocUuid(docUuid) {
    if (!docUuid) return;
    for (const [hook, map] of this._reg.entries()) {
      for (const key of [...map.keys()]) {
        if (map.get(key)?.docUuid === docUuid) map.delete(key);
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

  _registerWorldItem(item) {
    if (!item || item.actor) return;
    this._unregisterByDocUuid(item.uuid);
    this._scanDoc(null, item);
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

    if (doc.documentName === "Item" && doc.type === "questlog") {
      const cg = doc.system?.chainGraph;
      if (cg) {
        const raw = typeof cg === "string" ? cg : JSON.stringify(cg);
        this._registerPayload(actor, doc, "__questChain", raw, { questLogUuid: doc.uuid });
      }
      for (const q of (doc.system?.quests ?? [])) {
        const qg = q?.questGraph;
        if (!qg) continue;
        const raw = typeof qg === "string" ? qg : JSON.stringify(qg);
        if (typeof raw !== "string" || !raw.startsWith("{")) continue;
        this._registerPayload(actor, doc, `__questGraph::${q.id}`, raw, {
          questLogUuid: doc.uuid,
          questId:      q.id
        });
      }
    }
  }

  _registerPayload(actor, doc, widgetId, raw, extra = {}) {
    if (typeof raw !== "string" || !raw.startsWith("{")) return;
    let obj; try { obj = JSON.parse(raw); } catch { return; }
    if (obj?._trigger !== "multi" || !obj._events) return;
    const macros = obj._macros ?? null;
    const isWorldItem = !actor;
    const isQuestGraph = !!extra?.questLogUuid;

    for (const [evKey, ev] of Object.entries(obj._events)) {
      if (evKey === "onClick") continue;
      const eventHook = ev?.hook ?? evKey;
      const foundryHooks = HOOK_MAP[eventHook];
      if (!foundryHooks || !ev?.actions?.length) continue;

      const outOfSheet = !!ev?.data?.outOfSheet;

      if (isWorldItem && !isQuestGraph && !outOfSheet) continue;

      const validForWorld = (h) => h === "updateItem" || h === "createItem" || h === "deleteItem"
        || h === "createCard" || h === "combatTurnStart" || h === "combatTurnEnd"
        || h === "combatEncounterStart" || h === "combatEncounterEnd"
        || h === "sdMacroUse"
        || QUEST_HOOKS.has(h);

      for (const hookName of foundryHooks) {

        if (isWorldItem && !validForWorld(hookName)) continue;

        if (QUEST_HOOKS.has(hookName) && !isQuestGraph) continue;
        const key = `${doc.uuid}::${widgetId}::${evKey}::${hookName}`;
        if (!this._reg.has(hookName)) this._bind(hookName);
        this._reg.get(hookName).set(key, {
          actorId:   actor?.id ?? null,
          docUuid:   doc.uuid,
          widgetId,
          eventKey:  evKey,
          eventHook,
          actions:   ev.actions,
          data:      ev.data ?? {},
          outOfSheet,
          macros,

          questLogUuid: extra?.questLogUuid ?? null,
          questId:      extra?.questId      ?? null
        });
      }
    }
  }

  _bind(hookName) {
    this._reg.set(hookName, new Map());
    const id = Hooks.on(hookName, (...args) => this._dispatch(hookName, args));
    this._hookIds.set(hookName, id);
  }

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
    const isWorldItemEntry = !entry.actorId;
    const actor    = isWorldItemEntry ? null : game.actors?.get(entry.actorId);
    if (!isWorldItemEntry && !actor) return false;

    switch (hookName) {
      case "updateActor":
      case "createActor":
      case "deleteActor": {
        if (isWorldItemEntry) return false;
        if (firstDoc?.id !== entry.actorId) return false;
        return this._matchesSynthetic(hookName, args, entry);
      }
      case "updateItem":
      case "createItem":
      case "deleteItem": {
        const host = firstDoc?.actor;
        if (isWorldItemEntry) {
          if (host) return false;
          if (firstDoc?.uuid !== entry.docUuid) return false;
          return this._matchesSynthetic(hookName, args, entry);
        }
        if (!host || host.id !== entry.actorId) return false;
        return this._matchesSynthetic(hookName, args, entry);
      }
      case "combatTurnStart":
      case "combatTurnEnd": {
        if (isWorldItemEntry) return entry.outOfSheet === true;
        const combat = firstDoc;
        const turnIdx = combat?.turn ?? 0;
        const combatant = combat?.turns?.[turnIdx];
        return combatant?.actorId === entry.actorId;
      }
      case "combatEncounterStart":
      case "combatEncounterEnd": {
        if (isWorldItemEntry) return entry.outOfSheet === true;
        const combat = firstDoc;
        const combatants = combat?.combatants ?? combat?.turns ?? [];
        for (const c of combatants) {
          if (c?.actorId === entry.actorId) return true;
        }
        return false;
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

        const [item, actor] = args;
        const hostId = actor?.id ?? item?.parent?.id;
        if (hostId !== entry.actorId) return false;
        if (entry.docUuid && !entry.docUuid.includes(".Item.")) return true;
        if (entry.docUuid && item?.uuid && entry.docUuid !== item.uuid) return false;
        return true;
      }
      case "sdQuestActivated":
      case "sdQuestCompleted":
      case "sdQuestFailed":
      case "sdQuestRevealed":
      case "sdSubtaskDone": {
        const payload = args[0] ?? {};
        if (entry.questLogUuid && payload.questLogUuid !== entry.questLogUuid) return false;

        if (entry.questId && payload.questId && payload.questId !== entry.questId) return false;

        const qFilter = entry.data?.questIdFilter;
        if (qFilter && payload.questId !== qFilter) return false;
        if (hookName === "sdSubtaskDone") {
          const sFilter = entry.data?.subtaskIdFilter;
          if (sFilter && payload.subtaskId !== sFilter) return false;
        }
        return true;
      }
      case "createCard": {
        const card  = firstDoc;
        const stack = card?.parent;
        if (!stack) return false;
        const wantUuid = (entry.data?.stackUuid ?? "").trim();
        const wantName = (entry.data?.stackName ?? "").trim();
        if (wantUuid) {
          const tail = wantUuid.split(".").pop();
          const sid  = stack.id ?? "";
          if (sid !== tail && stack.uuid !== wantUuid) return false;
        } else if (wantName) {
          if ((stack.name ?? "") !== wantName) return false;
        } else {
          return false;
        }
        return true;
      }
      case "sdVisionDetect": {
        const payload = firstDoc;
        if (isWorldItemEntry) return false;
        if (!payload || payload.actorId !== entry.actorId) return false;
        return true;
      }
      case "sdMacroUse": {
        const payload = firstDoc ?? {};
        const filter = String(entry.data?.macroFilter ?? "").trim();
        if (filter) {
          const id   = String(payload.macroId   ?? "");
          const uuid = String(payload.macroUuid ?? "");
          const name = String(payload.macroName ?? "");
          if (filter !== id && filter !== uuid && filter !== name) return false;
        }
        if (isWorldItemEntry) return entry.outOfSheet === true;

        const aid = String(payload.actorId ?? "");
        if (aid && aid !== entry.actorId) return false;
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
    const actor = entry.actorId ? game.actors.get(entry.actorId) : null;
    if (entry.actorId && !actor) return;

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

  _rescanVisionDetect(sceneId) {
    const map = this._reg.get("sdVisionDetect");
    if (!map || !map.size) return;
    const Vision = globalThis._SD_VISION;
    const computeFn = Vision?.sdComputeVisible ?? null;
    const computeIds = Vision?.sdComputeVisibleTokens ?? null;
    if (!computeFn && !computeIds) return;

    if (!this._visionState) this._visionState = new Map();

    const fired = new Set();
    for (const entry of map.values()) {
      if (!entry?.actorId) continue;

      const stateKey = `${entry.actorId}::${entry.docUuid}::${entry.widgetId}::${entry.eventKey}`;
      if (fired.has(stateKey)) continue;
      fired.add(stateKey);

      const actor = game.actors?.get?.(entry.actorId);
      if (!actor) continue;

      const tk = actor.getActiveTokens?.()?.[0];
      if (!tk) continue;
      const tokenScene = tk.scene ?? tk.document?.parent;
      if (sceneId && tokenScene?.id && tokenScene.id !== sceneId) continue;

      const data = entry.data ?? {};

      let distFt = 0;
      const distPath = String(data.distPath ?? "").trim();
      if (distPath) {
        const v = foundry.utils.getProperty(actor, distPath);
        if (v !== undefined && v !== null && v !== "") distFt = Number(v) || 0;
      }
      if (!distFt) distFt = Number(data.distance ?? 30) || 30;

      let angDeg = 0;
      const anglePath = String(data.anglePath ?? "").trim();
      if (anglePath) {
        const v = foundry.utils.getProperty(actor, anglePath);
        if (v !== undefined && v !== null && v !== "") angDeg = Number(v) || 0;
      }
      if (!angDeg) angDeg = Number(data.angle ?? 360) || 360;

      const requireLOS = data.requireLOS !== "no" && data.requireLOS !== false;

      let result;
      try {
        result = computeFn
          ? computeFn({ source: tk, distanceFt: distFt, angleDeg: angDeg, requireLOS, includeHidden: false })
          : {
              tokenIds: computeIds({ source: tk, distanceFt: distFt, angleDeg: angDeg, requireLOS, includeHidden: false }) ?? [],
              actorUuids: []
            };
      } catch (e) {
        console.warn("SD | sdVisionDetect compute failed:", e);
        continue;
      }

      const tokenIds   = result?.tokenIds   ?? [];
      const actorUuids = result?.actorUuids ?? [];

      const prev = this._visionState.get(stateKey) ?? new Set();
      const current = new Set(tokenIds);

      const newTokenIds = tokenIds.filter(id => !prev.has(id));

      const tokenIdToUuid = new Map();
      for (let i = 0; i < tokenIds.length; i++) tokenIdToUuid.set(tokenIds[i], actorUuids[i] ?? "");
      const newActorUuids = newTokenIds.map(id => tokenIdToUuid.get(id) ?? "").filter(Boolean);

      this._visionState.set(stateKey, current);

      if (newTokenIds.length === 0) continue;

      if (data.show === "yes" || data.show === true) {
        try {
          Vision?.sdShowVisionRay?.({
            source:     tk,
            distanceFt: distFt,
            angleDeg:   angDeg,
            color:      String(data.showColor ?? "#74a7ff"),
            durationMs: Math.max(100, Number(data.showSeconds ?? 1.5) * 1000)
          });
        } catch (e) {
          console.warn("SD | sdVisionDetect ray draw failed:", e);
        }
      }

      try {
        Hooks.callAll("sdVisionDetect", {
          actorId:        actor.id,
          actorUuid:      actor.uuid,
          firstActorUuid: newActorUuids[0] ?? "",
          newTokenIds,
          newActorUuids,
          allTokenIds:    tokenIds,
          allActorUuids:  actorUuids
        });
      } catch (e) {
        console.warn("SD | sdVisionDetect callAll failed:", e);
      }
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
      case "combatEncounterStart":
      case "combatEncounterEnd": {
        const combat = args[0];
        rt.__eventRound      = combat?.round ?? 0;
        rt.__eventCombatId   = combat?.id ?? "";
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
      case "sdMacroUse": {
        const payload = args[0] ?? {};
        rt.__macroId       = String(payload.macroId     ?? "");
        rt.__macroUuid     = String(payload.macroUuid   ?? "");
        rt.__macroName     = String(payload.macroName   ?? "");
        rt.__macroActorId  = String(payload.actorId     ?? "");
        rt.__macroTokenId  = String(payload.tokenId     ?? "");
        break;
      }
      case "sdQuestActivated":
      case "sdQuestCompleted":
      case "sdQuestFailed":
      case "sdQuestRevealed":
      case "sdSubtaskDone": {
        const payload = args[0] ?? {};
        rt.__questId      = payload.questId      ?? entry.questId      ?? "";
        rt.__questLogUuid = payload.questLogUuid ?? entry.questLogUuid ?? "";
        rt.__questActorId = payload.actorId      ?? "";
        rt.__questUserId  = payload.userId       ?? game.user?.id ?? "";
        rt.__subtaskId    = payload.subtaskId    ?? "";
        rt.__questRevealed= payload.revealed === true || payload.revealed === "true" ? 1 : 0;
        rt.__sdQuestCtx = {
          questLogUuid: rt.__questLogUuid,
          questId:      rt.__questId,
          subtaskId:    rt.__subtaskId,
          actorId:      rt.__questActorId
        };
        break;
      }
      case "sdVisionDetect": {
        const payload = args[0] ?? {};
        rt.__visionDetectorUuid  = payload.actorUuid     ?? "";
        rt.__visionFirstActorUuid= payload.firstActorUuid ?? "";
        rt.__visionDetectedActors= Array.isArray(payload.newActorUuids) ? payload.newActorUuids.join(",") : (payload.newActorUuids ?? "");
        rt.__visionDetectedTokens= Array.isArray(payload.newTokenIds)   ? payload.newTokenIds.join(",")   : (payload.newTokenIds   ?? "");
        break;
      }
      case "cardDrawn": {
        const card  = args[0];
        const stack = card?.parent;
        rt.__cardDrawnId        = card?.id   ?? card?._id ?? "";
        rt.__cardDrawnName      = card?.name ?? "";
        const _faceIdx          = (card?.face === null || card?.face === undefined) ? -1 : Number(card.face);
        rt.__cardDrawnFace      = isNaN(_faceIdx) ? -1 : _faceIdx;
        let _value              = (typeof card?.value === "number") ? card.value : null;
        if (_value === null && typeof card?.face === "number" && card?.faces?.[card.face]?.value !== undefined) {
          _value = Number(card.faces[card.face].value);
        }
        rt.__cardDrawnValue     = (_value === null || isNaN(_value)) ? 0 : _value;
        rt.__cardDrawnStackId   = stack?.id   ?? "";
        rt.__cardDrawnStackName = stack?.name ?? "";
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
  } catch {  }
  return null;
}

export const EVENT_BUS = new EventBus();
