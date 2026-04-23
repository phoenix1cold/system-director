/**
 * module/documents/item.mjs
 *
 * Extends the base Item document.
 * - Roll methods for attacks and abilities
 * - Use tracking (charges/uses)
 * - Active Effects application from items
 */

export class SDItem extends Item {

  /** @override */
  prepareData() {
    super.prepareData();
  }

  // PR14: Equip / Unequip

  /**
   * Check whether this item can currently be equipped.  Runs any configured
   * `equipRequirements` formula against the owning actor's roll-data and
   * blocks equipping a second concentration-item when one is already on.
   *
   * @returns {Promise<{ok:boolean, reason?:string}>}
   */
  async canEquip() {
    if (this.type !== "inventory" || !this.system?.equippable) {
      return { ok: false, reason: "Not equippable." };
    }
    const actor = this.parent instanceof Actor ? this.parent : null;

    // Concentration conflict: another concentration item already equipped?
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

    // Optional requirements formula -- non-empty means "evaluate and require truthy".
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

  /** @override — emit sdItemEquipped / sdItemUnequipped and cascade flag-based ActiveEffect toggling. */
  async _onUpdate(changed, options, userId) {
    // Detect equipped transition before delegating (parent _onUpdate may not preserve diff shape).
    const equippedDiff = foundry.utils.getProperty(changed, "system.equipped");
    const hadEquipChange = equippedDiff !== undefined;
    await this._origOnUpdate(changed, options, userId);

    // PR15: only the originating client runs the cascade + hook to avoid
    // duplicate ActiveEffect writes from every connected client.
    if (hadEquipChange && game.user?.id === userId) {
      const nowEquipped = Boolean(equippedDiff);
      // Toggle ActiveEffect.disabled for effects flagged activateOnEquip.
      const effects = this.effects?.contents ?? [];
      const effUpdates = [];
      for (const ef of effects) {
        const flag = ef.flags?.sd?.activateOnEquip;
        if (!flag) continue;
        // When equipped → enable (disabled:false); when unequipped → disable (disabled:true).
        const wantDisabled = !nowEquipped;
        if (ef.disabled !== wantDisabled) effUpdates.push({ _id: ef.id, disabled: wantDisabled });
      }
      if (effUpdates.length) {
        try { await this.updateEmbeddedDocuments("ActiveEffect", effUpdates); }
        catch (e) { console.warn("SD | activate-on-equip cascade failed:", e); }
      }
      // Fire the system hook so event-bus can dispatch on_equip / on_unequip.
      Hooks.callAll(nowEquipped ? "sdItemEquipped" : "sdItemUnequipped", this, this.parent ?? null);
    }
  }

  // Delegate to the original snapshot-sync logic (was the previous _onUpdate
  // implementation).  Moved into a named helper so we can wrap it above.
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

  // Roll Methods

  /**
   * Activate/use this item.
   * Handles:
   *  - use count decrement
   *  - MP/resource cost
   *  - attack roll
   *  - damage roll
   *  - chat card
   */
  async use({ event } = {}) {
    const system = this.system;

    // Run onClick node graph if one is configured
    const formula = system.onClickFormula;
    if (formula && formula !== "0") {
      try {
        const { ButtonExecutor } = await import("../helpers/button-executor.mjs");
        const parsed = JSON.parse(formula);
        // Supported shapes:
        //   - plain array (saveCtx output)
        //   - { _trigger:"onClick", actions:[...] }
        //   - { _trigger:"multi", _events:{ onClick:{actions,...}, ... }, _macros? }
        //   - { _trigger:"macrosOnly", _macros:{...} }
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
        // Shared buttonDef + runtime so actions can pass data to each other
        // (e.g. rollValue stores __lastRoll, chatDamage reads it)
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

    // Check and consume uses
    if (system.uses?.enabled) {
      if (system.uses.value <= 0) {
        ui.notifications.warn(game.i18n.format("SD.NoUsesRemaining", { name: this.name }));
        return null;
      }
      await this.update({ "system.uses.value": system.uses.value - 1 });
    }

    // Consume resource cost from parent actor
    if (this.parent && system.cost?.resource && system.cost.value > 0) {
      const resourcePath = `system.${system.cost.resource}.value`;
      const current = foundry.utils.getProperty(this.parent, resourcePath) ?? 0;
      if (current < system.cost.value) {
        ui.notifications.warn(game.i18n.format("SD.InsufficientResource", { name: this.name }));
        return null;
      }
      await this.parent.update({ [resourcePath]: current - system.cost.value });
    }

    // Apply effect templates (autoApply: true) to appropriate targets
    if (this.type === "ability" && (system.effectTemplates ?? []).length > 0) {
      await this._applyEffectTemplates(system.effectTemplates);
    }

    // Build and send chat message
    return this._rollToChat({ event });
  }

  /**
   * Post this item as a chat message, optionally rolling attack/damage.
   */
  async _rollToChat({ event } = {}) {
    const system = this.system;
    const rolls  = [];

    // Attack roll for inventory weapons
    if (this.type === "inventory" && system.attack?.enabled) {
      const formula = system.attackFormula;
      const roll    = new Roll(formula, this.actor?.getRollData() ?? {});
      await roll.evaluate();
      rolls.push({ label: game.i18n.localize("SD.Attack"), roll });
    }

    // Ability roll
    if (this.type === "ability" && system.roll?.enabled) {
      const formula = system.roll.finalFormula || "1d20";
      const roll    = new Roll(formula, this.actor?.getRollData() ?? {});
      await roll.evaluate();
      rolls.push({ label: game.i18n.localize("SD.AbilityRoll"), roll });
    }

    // Damage roll
    if (system.damage?.enabled || (this.type === "inventory" && system.attack?.enabled)) {
      const formula = this.type === "inventory" ? system.damageFormula : system.damage?.formula;
      if (formula) {
        const dmgRoll = new Roll(formula, this.actor?.getRollData() ?? {});
        await dmgRoll.evaluate();
        rolls.push({ label: game.i18n.localize("SD.Damage"), roll: dmgRoll });
      }
    }

    // Render chat card
    // v13: renderTemplate is now namespaced
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

  /**
   * Apply autoApply effectTemplates to the correct target actor.
   * @param {object[]} templates
   */
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
        // Replace existing effect of same name+origin rather than stacking
        const existing = a.effects.find(e => e.name === name && e.flags?.sd?.sourceItemId === this.id);
        if (existing) await existing.update({ ...effectData, disabled: false });
        else          await a.createEmbeddedDocuments("ActiveEffect", [effectData]);
      }
    }
  }

  /**
   * Returns roll data merged with parent actor's roll data.
   */
  getRollData() {
    const data = this.actor?.getRollData() ?? {};
    data.item = { ...this.system };
    return data;
  }
  // Transfer Effects
  // When this item is created/deleted on an actor, transfer/remove its effects.
  // Only effects with transfer !== false are synced (Foundry default is true).
  //
  // Design mirrors dnd5e:
  //  - Each transferred effect gets flags.sd.sourceItemId = item.id
  //  - On item delete we find & remove all actor effects with that sourceItemId
  //  - On item update we refresh transferred effects if the effect collection changed

  /** Returns the effects on this item that should transfer to the owning actor. */
  get transferrableEffects() {
    return [...(this.effects ?? [])].filter(ef => ef.transfer !== false && !ef.disabled);
  }

  /** @override — fires when this item is created as embedded in an actor. */
  async _onCreate(data, options, userId) {
    await super._onCreate(data, options, userId);
    if (game.user.id !== userId) return;
    const actor = this.parent instanceof Actor ? this.parent : null;
    if (!actor) return;
    await this._applyTransferredEffects(actor);
  }

  /** @override — fires when this item is deleted from an actor. */
  async _onDelete(options, userId) {
    await super._onDelete(options, userId);
    if (game.user.id !== userId) return;
    const actor = this.parent instanceof Actor ? this.parent : null;
    if (!actor) return;
    await this._removeTransferredEffects(actor);
  }

  /**
   * Create transferred effects on the actor.
   * Skips effects that already exist (identified by flags.sd.sourceItemId + name).
   */
  async _applyTransferredEffects(actor) {
    const toCreate = [];
    for (const ef of this.transferrableEffects) {
      const already = actor.effects.find(e =>
        e.flags?.sd?.sourceItemId === this.id && e.name === ef.name
      );
      if (already) continue;
      const efData = ef.toObject();
      efData.origin   = this.uuid;
      efData.transfer = true;
      foundry.utils.setProperty(efData, "flags.sd.sourceItemId", this.id);
      foundry.utils.setProperty(efData, "flags.sd.sourceItemName", this.name);
      toCreate.push(efData);
    }
    if (toCreate.length) {
      await actor.createEmbeddedDocuments("ActiveEffect", toCreate);
    }
  }

  /**
   * Remove all actor effects that were transferred from this item.
   */
  async _removeTransferredEffects(actor) {
    const toDelete = actor.effects
      .filter(e => e.flags?.sd?.sourceItemId === this.id)
      .map(e => e.id);
    if (toDelete.length) {
      await actor.deleteEmbeddedDocuments("ActiveEffect", toDelete);
    }
  }

  /**
   * @override -- when item effects change, refresh what's on the actor.
   * Only runs for the triggering user to avoid double-execution.
   */
  async _onUpdateDescendantDocuments(parent, collection, documents, changes, options, userId) {
    await super._onUpdateDescendantDocuments?.(parent, collection, documents, changes, options, userId);
    if (collection !== "effects") return;
    if (game.user.id !== userId) return;
    const actor = this.parent instanceof Actor ? this.parent : null;
    if (!actor) return;
    // Full refresh: remove old, apply current
    await this._removeTransferredEffects(actor);
    await this._applyTransferredEffects(actor);
  }

}
