/**
 * System Director native UI Blueprint subsystem.
 */

import { MODULE_ID, SETTINGS, AUDIENCES } from "./ui-widget-const.mjs";
import { UIWidgetItemData, installUIWidgetIndexHooks, rebuildUIWidgetIndex, findUIWidgetItem, listUIWidgetItems } from "./ui-widget-document.mjs";
import { SDUIWidgetEditor } from "./ui-widget-editor.mjs";
import { initUINodes } from "./ui-widget-nodes.mjs";
import { initUIElementNodes } from "./ui-element-nodes.mjs";
import { SDUIWidgetApp } from "./ui-widget-app.mjs";
import { loadWidgetRenderer } from "./ui-widget-runtime.mjs";
import {
  allInstances, findInstancesByKey, getInstance, localBroadcast, refreshByKey,
  resolveInstance, setInstanceField, snapshotRegistry
} from "./ui-widget-registry.mjs";
import { installSocket, setNetHandlers, resolveAudienceUsers, dispatchOpen, dispatchClose, dispatchSetVar, dispatchBroadcast } from "./ui-widget-net.mjs";
import { BLUEPRINT_SCHEMA_VERSION, migrateBlueprintData } from "./ui-widget-blueprint.mjs";
import { initBlueprintNodes } from "./ui-widget-blueprint-nodes.mjs";

globalThis.SD ??= {};
globalThis.SD.uiBlueprintNative = true;


Hooks.once("init", () => {
  console.log(`${MODULE_ID} | init`);

  const models = CONFIG.Item.dataModels ??= {};
  models.uiwidget = UIWidgetItemData;

  try {
    const Items = foundry.documents.collections.Items;
    Items.registerSheet("sd-blueprint", SDUIWidgetEditor, {
      types: ["uiwidget"],
      makeDefault: true,
      label: "SDUI.Editor.Title"
    });
  } catch (err) {
    console.error(`${MODULE_ID} | failed to register the editor sheet:`, err);
  }

  const typeLabels = CONFIG.Item.typeLabels ??= {};
  typeLabels.uiwidget = "TYPES.Item.uiwidget";

  game.settings.register(MODULE_ID, SETTINGS.broadcastPolicy, {
    name: "SDUI.Settings.BroadcastPolicy",
    hint: "SDUI.Settings.BroadcastPolicyHint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      all: "SDUI.Settings.BroadcastAll",
      gm: "SDUI.Settings.BroadcastGMOnly"
    },
    default: "all"
  });
});

/** Open a widget window on this client. */
async function openLocal({ widgetKey, actorUuid = "", itemUuid = "", mode = "", vars = {}, unique = true, title = "" }) {
  const item = findUIWidgetItem(widgetKey);
  if (!item) {
    ui.notifications?.warn?.(game.i18n.format("SDUI.Runtime.MissingWidget", { key: widgetKey }));
    return null;
  }
  if (unique) {
    const existing = findInstancesByKey(item.system.blueprintId ?? item.system.widgetKey)[0];
    if (existing) {
      for (const [name, value] of Object.entries(vars ?? {})) await existing.state.setVariable(name, value);
      existing.app?.bringToFront?.();
      existing.app?.refresh?.();
      return existing.id;
    }
  }
  let actor = null;
  if (actorUuid) {
    try { actor = await fromUuid(actorUuid); } catch { actor = null; }
    if (actor?.documentName !== "Actor") actor = actor?.actor ?? null;
  }
  let contextItem = null;
  if (itemUuid) { try { contextItem = await fromUuid(itemUuid); } catch {} if (contextItem?.documentName !== "Item") contextItem = null; }
  const app = new SDUIWidgetApp({ widgetItem: item, actor, item: contextItem, layoutOverride: mode, vars, title });
  await app.render(true);
  return app.instanceId;
}

async function closeLocal({ widgetKey = "", instanceId = "" }) {
  const targets = instanceId
    ? [getInstance(instanceId)].filter(Boolean)
    : (widgetKey ? findInstancesByKey(widgetKey) : allInstances());
  for (const rec of targets) {
    try { await rec.app?.close?.(); } catch { /* already gone */ }
  }
}

async function setVarLocal({ widgetKey = "", instanceId = "", name, value }) {
  const rec = resolveInstance({ instanceId, widgetKey });
  if (!rec) return;
  await setInstanceField(rec.id, name, value);
}

Hooks.once("ready", async () => {
  if (game.user?.isGM) for (const item of (game.items ?? []).filter(entry => entry.type === "uiwidget" && Number(entry.system?.schemaVersion ?? 1) < BLUEPRINT_SCHEMA_VERSION)) {
    try { const migrated=migrateBlueprintData(item.system.toObject?.()??item.system); await item.update(Object.fromEntries(Object.entries(migrated).map(([k,v])=>[`system.${k}`,v])),{render:false}); }
    catch(err){ console.warn(`${MODULE_ID} | migration failed`,err); }
  }
  installUIWidgetIndexHooks();
  rebuildUIWidgetIndex();
  initUINodes();
  initUIElementNodes();
  initBlueprintNodes();

  setNetHandlers({
    openLocal,
    closeLocal,
    setVarLocal,
    broadcastLocal: localBroadcast,
    refreshLocal: refreshByKey
  });
  installSocket();

  // Cache the system pieces the runtime uses so no code path has to guess URLs.
  await loadWidgetRenderer();
  try {
    const mod = await import("/systems/sd/module/helpers/formula-engine.mjs");
    globalThis.SD_FORMULA_ENGINE = mod.FormulaEngine ?? null;
  } catch (err) {
    console.warn(`${MODULE_ID} | FormulaEngine unavailable — property bindings will not evaluate:`, err);
  }
  try {
    const mod = await import("/systems/sd/module/builder/widget-registry.mjs");
    globalThis.SD_WIDGET_TYPES = mod.WIDGET_TYPES ?? {};
  } catch (err) {
    console.warn(`${MODULE_ID} | system widget registry unavailable — the SD bridge element is disabled:`, err);
  }

  /**
   * Public API.
   *
   * await game.system.api.uiBlueprint.open("hp-hud", {
   *   actor: game.user.character,
   *   audience: "owners",     // self | gm | owners | players | everyone | users
   *   users: "Alice,Bob",     // only for audience "users"
   *   mode: "dock-right",
   *   vars: { hp: 10 }
   * });
   */
  const api = {
      async open(widgetKey, { actor = null, item = null, mode = "", audience = AUDIENCES.self, users = "", vars = {}, title = "", unique = true } = {}) {
        const actorDoc = typeof actor === "string" ? await fromUuid(actor).catch(() => null) : actor;
        const itemDoc = typeof item === "string" ? await fromUuid(item).catch(() => null) : item;
        const targets = resolveAudienceUsers(audience, { actor: actorDoc, userList: users, callerId: game.user?.id });
        return dispatchOpen({
          widgetKey, targets, actorUuid: actorDoc?.uuid ?? "", itemUuid: itemDoc?.uuid ?? "", mode, vars, unique, title
        });
      },
      async close(widgetKey, { instanceId = "", audience = AUDIENCES.self, users = "" } = {}) {
        const targets = resolveAudienceUsers(audience, { userList: users, callerId: game.user?.id });
        return dispatchClose({ widgetKey, instanceId, targets });
      },
      async set(widgetKey, name, value, { instanceId = "", audience = AUDIENCES.self, users = "" } = {}) {
        const targets = resolveAudienceUsers(audience, { userList: users, callerId: game.user?.id });
        return dispatchSetVar({ widgetKey, instanceId, name, value, targets });
      },
      get(widgetKey, name, { instanceId = "" } = {}) {
        const rec = resolveInstance({ instanceId, widgetKey });
        return rec?.state?.getVariable?.(name);
      },
      broadcast(widgetKey, event, payload, { audience = AUDIENCES.everyone, users = "" } = {}) {
        const targets = resolveAudienceUsers(audience, { userList: users, callerId: game.user?.id });
        return dispatchBroadcast({ widgetKey, event, payload, targets });
      },
      refresh(widgetKey = "") {
        if (widgetKey) refreshByKey(widgetKey);
        else for (const rec of allInstances()) rec.app?.refresh?.();
      },
      list: () => listUIWidgetItems().map(item => ({
        key: item.system.blueprintId ?? item.system.widgetKey, title: item.system.title, uuid: item.uuid
      })),
      instances: () => snapshotRegistry(),
      isOpen: (widgetKey) => findInstancesByKey(widgetKey).length > 0,
      spawn(widgetKey, options={}) { return this.open(widgetKey, options); },
      getVariable(instanceId, ref) { return resolveInstance({instanceId})?.state?.getVariable?.(ref); },
      setVariable(instanceId, ref, value) { return setInstanceField(instanceId, ref, value); },
      getWidgetProperty(instanceId, widgetId, property="value") { return resolveInstance({instanceId})?.state?.getWidgetProperty?.(widgetId, property); },
      setWidgetProperty(instanceId, widgetId, property, value) { return resolveInstance({instanceId})?.state?.setWidgetProperty?.(widgetId, property, value); }
  };
  game.system.api ??= {};
  game.system.api.uiBlueprint = api;
  game.sd ??= {};
  game.sd.uiBlueprint = api;
  globalThis.SD ??= {};
  globalThis.SD.uiBlueprint = api;
  Hooks.callAll("sdUiBlueprintReady", api);

  console.log(`${MODULE_ID} | native UI Blueprint ready`);
});
