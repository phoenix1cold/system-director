const MIGRATION_KEY = "sd.schemaVersion";

export async function runMigrations() {
  const currentVersion = game.system.version;
  const worldVersion   = game.settings.get("sd", "schemaVersion") || "0.0.0";

  if (!foundry.utils.isNewerVersion(currentVersion, worldVersion)) return;

  CONFIG.debug?.sd && console.log(`SD | Running migrations from ${worldVersion} → ${currentVersion}`);
  ui.notifications.info(game.i18n.format("SD.MigrationStart", { version: currentVersion }));

  const pending = MIGRATIONS.filter(m => foundry.utils.isNewerVersion(m.version, worldVersion));

  for (const migration of pending.sort((a, b) => foundry.utils.isNewerVersion(b.version, a.version) ? -1 : 1)) {
    CONFIG.debug?.sd && console.log(`SD | Applying migration ${migration.version}: ${migration.description}`);
    try {
      await migration.run();
    } catch (err) {
      console.error(`SD | Migration ${migration.version} failed:`, err);
    }
  }

  // Store new schema version
  await game.settings.set("sd", "schemaVersion", currentVersion);
  ui.notifications.info(game.i18n.format("SD.MigrationComplete", { version: currentVersion }));
}

/**
 * Utility: migrate all world Actors.
 * @param {Function} fn  (actorData) => updates object or null
 */
async function migrateActors(fn) {
  for (const actor of game.actors) {
    const updates = fn(actor.toObject());
    if (updates && Object.keys(updates).length) {
      await actor.update(updates);
      CONFIG.debug?.sd && console.log(`SD | Migrated actor: ${actor.name}`);
    }
    // Also migrate tokens in scenes
    for (const scene of game.scenes) {
      for (const token of scene.tokens) {
        if (!token.isLinked && token.actor) {
          const tokenUpdates = fn(token.actor.toObject());
          if (tokenUpdates && Object.keys(tokenUpdates).length) {
            await token.actor.update(tokenUpdates);
          }
        }
      }
    }
  }
}

async function migrateItems(fn) {
  for (const item of game.items) {
    const updates = fn(item.toObject());
    if (updates && Object.keys(updates).length) {
      await item.update(updates);
      CONFIG.debug?.sd && console.log(`SD | Migrated item: ${item.name}`);
    }
  }
  for (const actor of game.actors) {
    for (const item of actor.items) {
      const updates = fn(item.toObject());
      if (updates && Object.keys(updates).length) {
        await item.update(updates);
      }
    }
  }
}

export const MIGRATIONS = [

  {
    version:     "0.1.0",
    description: "Initial schema — no data migration needed.",
    run: async () => {}
  },

  // 0
  {
    version:     "0.2.0",
    description: "Rename legacy attr_score nodes → attr_score_val in stored widget graphs.",
    run: async () => {
      const _rewrite = (tabs) => {
        let changed = false;
        for (const tab of tabs ?? []) {
          for (const row of tab.rows ?? []) {
            for (const w of row.widgets ?? []) {
              const g = w.graphData;
              if (!g?.nodes?.length) continue;
              for (const n of g.nodes) {
                if (n.type === "attr_score") {
                  n.type = "attr_score_val";
                  changed = true;
                }
              }
            }
          }
        }
        return changed;
      };
      await migrateActors(data => {
        const tabs = foundry.utils.deepClone(data.system?.customTabs ?? []);
        return _rewrite(tabs) ? { "system.customTabs": tabs } : null;
      });
      await migrateItems(data => {
        const tabs = foundry.utils.deepClone(data.system?.customTabs ?? []);
        return _rewrite(tabs) ? { "system.customTabs": tabs } : null;
      });
    }
  },

  // 0
  {
    version:     "0.3.0",
    description: "Merge sequence + sequence4 into unified Sequence with count field.",
    run: async () => {
      const _rewriteGraph = (g) => {
        if (!g?.nodes?.length) return false;
        let changed = false;
        const remapPairs = [];
        for (const n of g.nodes) {
          if (n.type === "sequence4") {
            n.type = "sequence";
            n.data = { ...(n.data ?? {}), count: 4 };
            remapPairs.push({ nodeId: n.id, pinMap: { a:"a0", b:"a1", c:"a2", d:"a3" } });
            changed = true;
          } else if (n.type === "sequence") {
            const cnt = Number(n.data?.count);
            if (!cnt || cnt < 2) {
              n.data = { ...(n.data ?? {}), count: 2 };
              remapPairs.push({ nodeId: n.id, pinMap: { a:"a0", b:"a1" } });
              changed = true;
            }
          }
        }
        for (const { nodeId, pinMap } of remapPairs) {
          for (const edge of (g.edges ?? [])) {
            if (edge.fromNode === nodeId && pinMap[edge.fromPin]) {
              edge.fromPin = pinMap[edge.fromPin];
              changed = true;
            }
          }
        }
        return changed;
      };

      const _rewriteCustomTabs = (tabs) => {
        let changed = false;
        for (const tab of tabs ?? []) {
          for (const row of tab.rows ?? []) {
            for (const w of row.widgets ?? []) {
              if (_rewriteGraph(w.graphData)) changed = true;
            }
          }
        }
        return changed;
      };

      const _rewriteTriggerGraph = (stg) => {
        const g = stg?._graphData;
        return g ? _rewriteGraph(g) : false;
      };
      const _rewriteOnClickGraph = (ocg) => {
        if (!ocg || typeof ocg !== "object") return false;
        if (ocg.nodes) return _rewriteGraph(ocg);
        if (ocg._graphData) return _rewriteGraph(ocg._graphData);
        return false;
      };

      await migrateActors(data => {
        const tabs   = foundry.utils.deepClone(data.system?.customTabs     ?? []);
        const trig   = foundry.utils.deepClone(data.system?.sdTriggerGraph ?? null);
        const cTabs  = _rewriteCustomTabs(tabs);
        const cTrig  = trig ? _rewriteTriggerGraph(trig) : false;
        const upd = {};
        if (cTabs) upd["system.customTabs"]     = tabs;
        if (cTrig) upd["system.sdTriggerGraph"] = trig;
        return Object.keys(upd).length ? upd : null;
      });
      await migrateItems(data => {
        const tabs   = foundry.utils.deepClone(data.system?.customTabs     ?? []);
        const trig   = foundry.utils.deepClone(data.system?.sdTriggerGraph ?? null);
        const click  = foundry.utils.deepClone(data.system?.onClickGraph   ?? null);
        const cTabs  = _rewriteCustomTabs(tabs);
        const cTrig  = trig  ? _rewriteTriggerGraph(trig)  : false;
        const cClick = click ? _rewriteOnClickGraph(click) : false;
        const upd = {};
        if (cTabs)  upd["system.customTabs"]     = tabs;
        if (cTrig)  upd["system.sdTriggerGraph"] = trig;
        if (cClick) upd["system.onClickGraph"]   = click;
        return Object.keys(upd).length ? upd : null;
      });
    }
  }

  // TEMPLATE for future migrations
];
