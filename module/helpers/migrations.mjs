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

  await game.settings.set("sd", "schemaVersion", currentVersion);
  ui.notifications.info(game.i18n.format("SD.MigrationComplete", { version: currentVersion }));
}

async function migrateActors(fn) {
  for (const actor of game.actors) {
    const updates = fn(actor.toObject());
    if (updates && Object.keys(updates).length) {
      await actor.update(updates);
      CONFIG.debug?.sd && console.log(`SD | Migrated actor: ${actor.name}`);
    }

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
  },

  {
    version:     "0.3.6",
    description: "Backfill custom resource keys from System Config onto existing actors.",
    run: async () => {
      const cfg = game.settings.get("sd", "systemConfig") || {};
      const resCfg = cfg.resources ?? {};
      if (!Object.keys(resCfg).length) return;

      const _seedFromCfg = () => {
        const seed = {};
        for (const [key, res] of Object.entries(resCfg)) {
          if (!res || res.enabled === false) continue;
          const v  = Number.isFinite(Number(res.initialValue)) ? Math.trunc(Number(res.initialValue)) : 0;
          const mx = Number.isFinite(Number(res.initialMax))   ? Math.max(0, Math.trunc(Number(res.initialMax))) : v;
          const mn = Number.isFinite(Number(res.initialMin))   ? Math.trunc(Number(res.initialMin)) : 0;
          seed[key] = { value: v, max: mx, min: mn };
        }
        return seed;
      };

      await migrateActors(data => {
        const have = data.system?.resources ?? {};
        const seed = _seedFromCfg();
        const merged = { ...have };
        let changed = false;
        for (const [key, defaults] of Object.entries(seed)) {
          if (!merged[key] || typeof merged[key] !== "object") {
            merged[key] = { ...defaults };
            changed = true;
          }
        }
        return changed ? { "system.resources": merged } : null;
      });
    }
  }

];
