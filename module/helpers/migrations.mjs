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
  },

  {
    version:     "0.5.6",
    description: "Convert deprecated 'feature' items to 'ability' items.",
    run: async () => convertLegacyFeatureItems()
  },

  {
    version:     "0.9.7",
    description: "Calculations are node-graph only: seed a default Number(0) -> Output graph and drop legacy operator/path fields.",
    run: async () => {
      const DEF_GRAPH = () => ({
        nodes: [
          { id: "num_default", type: "literal", x: 320, y: 230, data: { value: 0 } },
          { id: "output",      type: "output",  x: 660, y: 230, data: {} }
        ],
        edges: [
          { id: "e_num_out", fromNode: "num_default", fromPin: "v", toNode: "output", toPin: "value" }
        ],
        comments: []
      });
      const cfg = foundry.utils.deepClone(game.settings.get("sd", "systemSettings") ?? {});
      if (!cfg || typeof cfg !== "object") return;
      const calc = cfg.calculations;
      if (!calc || typeof calc !== "object") return;
      const SECTIONS = ["defense", "initiative", "movement"];
      let changed = false;
      for (const sec of SECTIONS) {
        const list = Array.isArray(calc[sec]) ? calc[sec] : null;
        if (!list) continue;
        for (const entry of list) {
          if (!entry || typeof entry !== "object") continue;
          const hasGraph = entry.graphData && typeof entry.graphData === "object"
            && Array.isArray(entry.graphData.nodes) && entry.graphData.nodes.length;
          if (!hasGraph) {
            entry.graphData = DEF_GRAPH();
            entry.compiledFormula = "0";
            changed = true;
          }
          if (entry.useGraph !== true) { entry.useGraph = true; changed = true; }
          if (Array.isArray(entry.parts) && entry.parts.length) { entry.parts = []; changed = true; }
        }
      }
      if (changed) await game.settings.set("sd", "systemSettings", cfg);
    }
  },
  {
    version:     "0.22.4",
    description: "Replace every legacy Roll Button widget/dialog element with the ordinary Button widget.",
    run: async () => {
      const convert = root => {
        const seen = new WeakSet();
        let changed = 0;
        const walk = value => {
          if (!value || typeof value !== "object" || seen.has(value)) return;
          seen.add(value);
          if (value.type === "rollButton") {
            value.type = "button";
            if (["d20", "flat", "stamp"].includes(String(value.variant ?? ""))) value.variant = "default";
            changed++;
          }
          for (const [key, child] of Object.entries(value)) {
            if (/(_type|Type)$/.test(key) && child === "rollButton") { value[key] = "button"; changed++; continue; }
            if (typeof child === "string" && child.includes("rollButton") && /^[\s]*[\[{]/.test(child)) {
              try { const parsed=JSON.parse(child); const before=changed; walk(parsed); if(changed>before)value[key]=JSON.stringify(parsed); } catch {}
            } else walk(child);
          }
        };
        walk(root);
        return changed;
      };
      const migrateDocument = async doc => {
        const system=foundry.utils.deepClone(doc.system??{}), flags=foundry.utils.deepClone(doc.flags??{});
        if (convert(system)+convert(flags)) await doc.update({system,flags},{diff:false,recursive:false});
      };
      for (const actor of game.actors??[]) { await migrateDocument(actor); for (const item of actor.items??[]) await migrateDocument(item); }
      for (const item of game.items??[]) await migrateDocument(item);
      const cfg=foundry.utils.deepClone(game.settings.get("sd","systemSettings")??{});
      if (convert(cfg)) await game.settings.set("sd","systemSettings",cfg);
    }
  }
,
  {
    version:     "1.11.0",
    description: "Dice Button widgets become ordinary Buttons, widget roll formulas are dropped, and every widget keeps its own values.",
    run: async () => {
      const { widgetVariables, widgetVarPath, isWidgetVarPath, coerceWidgetValue } =
        await import("./widget-variables.mjs");

      /**
       * Rewrite one widget tree in place.
       * Returns the `system.widgetVars.*` patch that keeps the values currently
       * shown on the sheet, so nothing visually changes after the update.
       */
      const convertWidget = (widget, doc, patch) => {
        if (!widget || typeof widget !== "object") return;

        // 1. The Dice Button widget no longer exists.
        if (widget.type === "dice") {
          widget.type = "button";
          if (!widget.icon) widget.icon = "fa-dice-d20";
          if (["d20", "flat", "stamp"].includes(String(widget.variant ?? ""))) widget.variant = "default";
        }

        // 2. Dice are rolled from nodes now, so widget roll formulas are gone.
        if (widget.type === "button") delete widget.formula;
        if (widget.type === "skill") delete widget.rollFormula;

        // 3. Widgets own their values instead of pointing at Database variables.
        for (const descriptor of widgetVariables(widget)) {
          const previous = widget[descriptor.field];
          const selfPath = widgetVarPath(widget, descriptor.field);
          widget.varDefaults = (widget.varDefaults && typeof widget.varDefaults === "object") ? widget.varDefaults : {};
          if (widget.varDefaults[descriptor.field] === undefined) {
            let carried;
            if (typeof previous === "string" && previous && !isWidgetVarPath(previous)) {
              try { carried = foundry.utils.getProperty(doc, previous); } catch {}
            }
            widget.varDefaults[descriptor.field] = coerceWidgetValue(
              carried !== undefined ? carried : descriptor.initial, descriptor.type);
          }
          widget[descriptor.field] = selfPath;
          let stored;
          try { stored = foundry.utils.getProperty(doc, selfPath); } catch {}
          if (stored === undefined) {
            patch[selfPath] = coerceWidgetValue(widget.varDefaults[descriptor.field], descriptor.type);
          }
        }

        for (const child of (widget.widgets ?? [])) convertWidget(child, doc, patch);
        for (const element of (widget.elements ?? [])) if (element?.widget) convertWidget(element.widget, doc, patch);
      };

      const migrateDocument = async doc => {
        const tabs = foundry.utils.deepClone(doc.system?.customTabs ?? null);
        if (!Array.isArray(tabs) || !tabs.length) return;
        const patch = {};
        for (const tab of tabs) for (const row of (tab?.rows ?? [])) for (const widget of (row?.widgets ?? [])) {
          convertWidget(widget, doc, patch);
        }
        try { await doc.update({ "system.customTabs": tabs, ...patch }); }
        catch (error) { console.warn(`SD | 1.11.0 migration skipped ${doc?.name}:`, error); }
      };

      for (const actor of game.actors ?? []) {
        await migrateDocument(actor);
        for (const item of actor.items ?? []) await migrateDocument(item);
      }
      for (const item of game.items ?? []) await migrateDocument(item);
      for (const scene of game.scenes ?? []) {
        for (const token of scene.tokens ?? []) {
          if (token.actorLink || !token.actor) continue;
          await migrateDocument(token.actor);
        }
      }
    }
  }


];

export async function convertLegacyFeatureItems() {
  const _abilityActivationType = (t) => {
    const allowed = ["action","bonus","reaction","minute","hour","special","none"];
    if (t === "passive") return "none";
    return allowed.includes(t) ? t : "none";
  };

  const _abilityCategory = (c) => {
    const allowed = ["active","passive","reaction","free","special"];
    return allowed.includes(c) ? c : "passive";
  };

  const _buildAbilitySystem = (oldSys) => ({
    category:    _abilityCategory(oldSys.category),
    school:      "",
    level:       { value: Number(oldSys.level ?? 0) || 0, max: 9 },
    activation:  {
      type:      _abilityActivationType(oldSys.activation?.type),
      cost:      Number(oldSys.activation?.cost ?? 0) || 0,
      condition: ""
    },
    uses: {
      enabled: !!oldSys.uses?.enabled,
      value:   Number(oldSys.uses?.value ?? 0) || 0,
      max:     Number(oldSys.uses?.max ?? 0) || 0,
      per:     oldSys.uses?.per ?? "day"
    },
    tags:           Array.isArray(oldSys.tags) ? oldSys.tags : [],
    description:    oldSys.description ?? "",
    source:         oldSys.source ?? "",
    flags:          oldSys.flags ?? {},
    onClickGraph:   oldSys.onClickGraph   ?? {},
    onClickFormula: oldSys.onClickFormula ?? ""
  });

  const _convert = async (collection) => {
    const items = [...collection].filter(i => i.type === "feature");
    for (const item of items) {
      try {
        const old = item.toObject();
        const newSys = _buildAbilitySystem(old.system ?? {});
        await item.update(
          { type: "ability", system: newSys },
          { diff: false, recursive: false }
        );
        CONFIG.debug?.sd && console.log(`SD | Converted feature → ability: ${item.name}`);
      } catch (err) {
        console.warn(`SD | Failed to convert feature item ${item?.name}:`, err);
      }
    }
  };

  await _convert(game.items);
  for (const actor of game.actors) {
    await _convert(actor.items);
  }
}
