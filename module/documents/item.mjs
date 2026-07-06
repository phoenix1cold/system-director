import { AutoanimationsIntegration } from "../integrations/autoanimations.mjs";

export class SDItem extends Item {

  prepareData() {
    super.prepareData();
  }

  async canEquip() {
    if (this.type !== "inventory" || !this.system?.equippable) {
      return { ok: false, reason: "Not equippable." };
    }
    const actor = this.parent instanceof Actor ? this.parent : null;

    if (this.system.concentration && actor) {
      const conflict = actor.items.find(i =>
        i.id !== this.id &&
        i.type === "inventory" &&
        i.system?.equipped === true &&
        i.system?.concentration === true
      );
      if (conflict) {
        return {
          ok: false,
          reason: game.i18n?.format?.("SD.EquipConflictConcentration", { name: conflict.name })
               ?? `Already concentrating on ${conflict.name}.`
        };
      }
    }

    const req = String(this.system.equipRequirements ?? "").trim();
    if (req && actor) {
      try {
        const { FormulaEngine } = await import("../helpers/formula-engine.mjs");
        const val = await FormulaEngine.evaluate?.(req, { actor, item: this });
        if (val === undefined || val === null || val === 0 || val === false) {
          return { ok: false, reason: `Requirements not met: ${req}` };
        }
      } catch (e) {
        console.warn("SD | canEquip formula failed:", e);
      }
    }
    return { ok: true };
  }

  async _onUpdate(changed, options, userId) {
    const equippedDiff = foundry.utils.getProperty(changed, "system.equipped");
    const hadEquipChange = equippedDiff !== undefined;
    await this._origOnUpdate(changed, options, userId);

    if (hadEquipChange && game.user?.id === userId) {
      const nowEquipped = Boolean(equippedDiff);
      const effects = this.effects?.contents ?? [];
      const effUpdates = [];
      for (const ef of effects) {
        const flag = ef.flags?.sd?.activateOnEquip;
        if (!flag) continue;
        const wantDisabled = !nowEquipped;
        if (ef.disabled !== wantDisabled) effUpdates.push({ _id: ef.id, disabled: wantDisabled });
      }
      if (effUpdates.length) {
        try { await this.updateEmbeddedDocuments("ActiveEffect", effUpdates); }
        catch (e) { console.warn("SD | activate-on-equip cascade failed:", e); }
      }
      Hooks.callAll(nowEquipped ? "sdItemEquipped" : "sdItemUnequipped", this, this.parent ?? null);
    }
  }

  async _origOnUpdate(changed, options, userId) {
    await super._onUpdate(changed, options, userId);
    const actor = this.parent instanceof Actor ? this.parent : null;
    if (!actor) return;

    const myId   = this.id;
    const myData = this.toObject();
    if (this.uuid) myData._sourceUuid = this.uuid;

    const updates = [];
    for (const parentItem of actor.items) {
      if (parentItem.id === myId) continue;
      const slotContents = parentItem.system?.slotContents;
      if (!slotContents) continue;

      let dirty = false;
      const cloned = foundry.utils.deepClone(slotContents);
      for (const [slotId, slotData] of Object.entries(cloned)) {
        const contents = slotData?.contents ?? [];
        for (let i = 0; i < contents.length; i++) {
          if ((contents[i]._id ?? contents[i].id) === myId) {
            const preserved = {
              _id:         contents[i]._id,
              _sourceUuid: contents[i]._sourceUuid ?? myData._sourceUuid,
            };
            contents[i] = { ...myData, ...preserved };
            dirty = true;
          }
        }
        if (dirty) cloned[slotId].count = contents.length;
      }
      if (dirty) updates.push({ _id: parentItem.id, "system.slotContents": cloned });
    }
    if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
  }

  async use({ event } = {}) {
    const system = this.system;

    try { AutoanimationsIntegration.playForItem(this, this.actor ?? null); } catch (e) { console.warn("SD | AutoAnimations trigger failed:", e); }

    const formula = system.onClickFormula;
    if (formula && formula !== "0") {
      try {
        const { ButtonExecutor } = await import("../helpers/button-executor.mjs");
        const parsed = JSON.parse(formula);

        let actions = [];
        let macros  = null;
        if (Array.isArray(parsed)) actions = parsed;
        else if (parsed?._trigger === "onClick") actions = parsed.actions ?? [];
        else if (parsed?._trigger === "multi") {
          actions = parsed._events?.onClick?.actions ?? parsed._events?.onClick ?? [];
          macros  = parsed._macros ?? null;
        } else if (parsed?._trigger === "macrosOnly") {
          macros = parsed._macros ?? null;
        }
        if (!Array.isArray(actions)) actions = [];
        const buttonDef = { label: this.name, __macros: macros };
        const runtime = {};
        for (const action of actions) {
          await ButtonExecutor._runAction(action, this, this.actor ?? null, buttonDef, runtime);
        }
      } catch(e) {
        console.error("SD | onClick graph error:", e);
      }
      return;
    }

    if (system.uses?.enabled) {
      if (system.uses.value <= 0) {
        ui.notifications.warn(game.i18n.format("SD.NoUsesRemaining", { name: this.name }));
        return null;
      }
      await this.update({ "system.uses.value": system.uses.value - 1 });
    }

    if (this.parent && system.cost?.resource && system.cost.value > 0) {
      const resourcePath = `system.${system.cost.resource}.value`;
      const current = foundry.utils.getProperty(this.parent, resourcePath) ?? 0;
      if (current < system.cost.value) {
        ui.notifications.warn(game.i18n.format("SD.InsufficientResource", { name: this.name }));
        return null;
      }
      await this.parent.update({ [resourcePath]: current - system.cost.value });
    }

    if (this.type === "ability" && (system.effectTemplates ?? []).length > 0) {
      await this._applyEffectTemplates(system.effectTemplates);
    }

    return this._rollToChat({ event });
  }

  async _rollToChat({ event } = {}) {
    const system = this.system;
    const rolls  = [];

    if (this.type === "inventory" && system.attack?.enabled) {
      const formula = system.attackFormula;
      const roll    = new Roll(formula, this.actor?.getRollData() ?? {});
      await roll.evaluate();
      rolls.push({ label: game.i18n.localize("SD.Attack"), roll });
    }

    if (this.type === "ability" && system.roll?.enabled) {
      const formula = system.roll.finalFormula || "1d20";
      const roll    = new Roll(formula, this.actor?.getRollData() ?? {});
      await roll.evaluate();
      rolls.push({ label: game.i18n.localize("SD.AbilityRoll"), roll });
    }

    if (system.damage?.enabled || (this.type === "inventory" && system.attack?.enabled)) {
      const formula = this.type === "inventory" ? system.damageFormula : system.damage?.formula;
      if (formula) {
        const dmgRoll = new Roll(formula, this.actor?.getRollData() ?? {});
        await dmgRoll.evaluate();
        rolls.push({ label: game.i18n.localize("SD.Damage"), roll: dmgRoll });
      }
    }

    const _renderTpl = foundry.applications?.handlebars?.renderTemplate ?? renderTemplate;
    const html = await _renderTpl("systems/sd/templates/chat/item-card.hbs", {
      item:   this,
      system: this.system,
      rolls,
      actor:  this.actor
    });

    const chatData = {
      user:     game.user.id,
      speaker:  ChatMessage.implementation.getSpeaker?.({ actor: this.actor })
                  ?? ChatMessage.getSpeaker({ actor: this.actor }),
      content:  html,
      rolls:    rolls.map(r => r.roll)
    };

    return ChatMessage.create(chatData);
  }

  async _applyEffectTemplates(templates) {
    for (const tpl of templates) {
      if (!tpl.autoApply) continue;
      const name   = tpl.name   || "Effect";
      const icon   = tpl.icon   || "icons/svg/aura.svg";
      const rounds = Number(tpl.durationRounds ?? 0);

      let changes = [];
      try { changes = JSON.parse(tpl.changes || "[]"); } catch { changes = []; }
      changes = changes.map(c => ({
        key:   c.key   ?? "",
        value: String(c.value ?? "0"),
        mode:  Number(c.mode  ?? 2)
      }));

      const effectData = {
        name,
        img: icon,
        disabled:  false,
        duration:  rounds > 0 ? { rounds } : {},
        changes,
        origin:    this.uuid,
        flags:     { sd: { sourceItemId: this.id } }
      };

      const target = tpl.target ?? "actor";
      let targets = [];

      if (target === "self")          targets = [this.actor ?? null];
      else if (target === "actor")    targets = [this.actor ?? null];
      else if (target === "token_target") {
        const t = game.user.targets?.first()?.actor ?? null;
        if (t) targets = [t];
      } else if (target === "all_targets") {
        targets = [...(game.user.targets ?? [])].map(t => t.actor).filter(Boolean);
      }

      for (const a of targets) {
        if (!a) continue;
        const existing = a.effects.find(e => e.name === name && e.flags?.sd?.sourceItemId === this.id);
        if (existing) await existing.update({ ...effectData, disabled: false });
        else          await a.createEmbeddedDocuments("ActiveEffect", [effectData]);
      }
    }
  }

  getRollData() {
    const data = this.actor?.getRollData() ?? {};
    data.item = { ...this.system };
    return data;
  }

  static _isLegacyTransferredActorEffect(actor, effect) {
    const sourceItemId = effect?.flags?.sd?.sourceItemId;
    if (!sourceItemId || !effect?.flags?.sd?.sourceItemName) return false;
    const item = actor?.items?.get?.(sourceItemId);
    if (!item) return false;
    const origin = String(effect.origin ?? "");
    if (origin && origin !== item.uuid && !origin.startsWith(`${item.uuid}.`)) return false;
    return item.effects?.some?.(ef => ef.name === effect.name && ef.transfer !== false) ?? false;
  }

  static async cleanupLegacyTransferredEffects(actor) {
    if (!actor || !game?.user?.isGM) return;
    const toDelete = actor.effects
      .filter(effect => SDItem._isLegacyTransferredActorEffect(actor, effect))
      .map(effect => effect.id);
    if (!toDelete.length) return;
    try {
      await actor.deleteEmbeddedDocuments("ActiveEffect", toDelete);
    } catch (err) {
      console.warn("SD | legacy transferred effect cleanup failed:", err);
    }
  }

}
