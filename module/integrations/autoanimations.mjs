const MODULE_ID = "autoanimations";

export class AutoanimationsIntegration {
  static get moduleId() {
    return MODULE_ID;
  }

  static isModuleActive() {
    try {
      return !!game.modules?.get?.(MODULE_ID)?.active;
    } catch {
      return false;
    }
  }

  static getApi() {
    const aa = globalThis.AutomatedAnimations;
    if (aa && typeof aa.playAnimation === "function") return aa;
    const legacy = globalThis.AutoAnimations;
    if (legacy && typeof legacy.playAnimation === "function") return legacy;
    return null;
  }

  static isAvailable() {
    return this.isModuleActive() && !!this.getApi();
  }

  static resolveSourceToken(actor, item) {
    const parentToken = item?.parent;
    if (parentToken && typeof parentToken === "object" && parentToken?.documentName === "Token") {
      return parentToken.object ?? parentToken;
    }
    const a = actor ?? item?.actor ?? null;
    if (!a) return null;
    if (a.token) return a.token.object ?? a.token;
    const controlled = canvas?.tokens?.controlled ?? [];
    const mine = controlled.find?.(t => t?.actor?.id === a.id);
    if (mine) return mine;
    const placeables = canvas?.tokens?.placeables ?? [];
    const onScene = placeables.find?.(t => t?.actor?.id === a.id);
    if (onScene) return onScene;
    const active = typeof a.getActiveTokens === "function" ? a.getActiveTokens(true, false) : [];
    if (active && active.length) return active[0];
    return null;
  }

  static resolveTargets(explicit) {
    if (Array.isArray(explicit)) return explicit;
    if (explicit instanceof Set) return Array.from(explicit);
    if (explicit && typeof explicit === "object") return [explicit];
    const userTargets = game.user?.targets;
    if (userTargets instanceof Set) return Array.from(userTargets);
    if (Array.isArray(userTargets)) return userTargets;
    return [];
  }

  static _hasItemShape(item) {
    if (!item || typeof item !== "object") return false;
    if (typeof item.name !== "string" || !item.name.length) return false;
    return true;
  }

  static async playForItem(item, actor, options = {}) {
    if (!this._hasItemShape(item)) return false;
    if (!this.isAvailable()) return false;
    const sourceToken = options.sourceToken ?? this.resolveSourceToken(actor, item);
    if (!sourceToken) return false;
    const targets = this.resolveTargets(options.targets);
    const api = this.getApi();
    if (!api) return false;
    const playOptions = { ...options, targets };
    delete playOptions.sourceToken;
    try {
      const result = api.playAnimation(sourceToken, item, playOptions);
      if (result && typeof result.then === "function") await result;
      return true;
    } catch (err) {
      console.warn("SD | AutoAnimations playAnimation failed:", err);
      return false;
    }
  }

  static _resolveActorFromDoc(doc) {
    if (!doc) return null;
    if (doc instanceof Actor) return doc;
    if (doc.actor instanceof Actor) return doc.actor;
    const parent = doc.parent;
    if (parent instanceof Actor) return parent;
    return null;
  }

  static async playForTag(tag, doc, options = {}) {
    if (typeof tag !== "string") return false;
    const name = tag.trim();
    if (!name) return false;
    if (!this.isAvailable()) return false;
    const actor = options.actor ?? this._resolveActorFromDoc(doc);
    const fakeItem = { name, type: "sdAnimationTag", system: {}, flags: {} };
    const passOptions = { ...options };
    delete passOptions.actor;
    return this.playForItem(fakeItem, actor, passOptions);
  }

  static enrichChatMessageData(chatData, item, actor, options = {}) {
    if (!chatData || typeof chatData !== "object") return chatData;
    if (!this._hasItemShape(item)) return chatData;
    const flags = chatData.flags ?? (chatData.flags = {});
    const sd = flags.sd ?? (flags.sd = {});
    if (item.id != null && sd.itemId == null) sd.itemId = item.id;
    if (item.uuid && sd.itemUuid == null) sd.itemUuid = item.uuid;
    const a = actor ?? item.actor ?? null;
    if (a?.id && sd.actorId == null) sd.actorId = a.id;
    const token = options.token ?? this.resolveSourceToken(a, item);
    const tokenDoc = token?.document ?? token;
    if (tokenDoc?.uuid && sd.tokenUuid == null) sd.tokenUuid = tokenDoc.uuid;
    return chatData;
  }
}

export function exposeAutoanimationsIntegration() {
  const ns = globalThis.sd ?? (globalThis.sd = {});
  const integrations = ns.integrations ?? (ns.integrations = {});
  integrations.autoanimations = AutoanimationsIntegration;
}
