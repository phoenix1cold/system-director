function _sanitizeRollData(data) {
  return Object.fromEntries(
    Object.entries(data ?? {}).map(([k, v]) =>
      [k, (typeof v === "string" && /^\s*\d*d\d+/i.test(v)) ? 0 : v]
    )
  );
}

function _sdMsgMode() {
  try {
    const v = game.settings.get("core", "messageMode");
    if (v) return v;
  } catch {}
  try { return game.settings.get("core", "rollMode"); } catch {}
  return "publicroll";
}

import { CharacterData }       from "./module/data/actor-character.mjs";
import { NPCData }             from "./module/data/actor-npc.mjs";
import { InventoryData }       from "./module/data/item-inventory.mjs";
import { AbilityData, FeatureData } from "./module/data/item-ability.mjs";
import { ClassData }           from "./module/data/item-class.mjs";
import { SkillTreeData }       from "./module/data/item-skilltree.mjs";
import { QuestLogData }        from "./module/data/item-questlog.mjs";

import { SDActor }       from "./module/documents/actor.mjs";
import { SDItem }        from "./module/documents/item.mjs";
import { SDActiveEffect } from "./module/documents/active-effect.mjs";

import { exposeAutoanimationsIntegration } from "./module/integrations/autoanimations.mjs";

import { CharacterSheet }      from "./module/sheets/character-sheet.mjs";
import { NPCSheet }            from "./module/sheets/npc-sheet.mjs";
import { SDItemSheet }         from "./module/sheets/item-sheet.mjs";

import { runMigrations }       from "./module/helpers/migrations.mjs";
import { EFFECT_PATHS }        from "./module/helpers/effects.mjs";
import { SystemConfig, applySettings, buildActorBaseDefaults } from "./module/helpers/system-config.mjs";
import { installColorSchemeObserver } from "./module/helpers/color-schemes.mjs";
import { Toolbox }             from "./module/builder/toolbox-app.mjs";
import { SDMarketApp }         from "./module/helpers/market-app.mjs";
import { SDActionHUD, SDActionHUDConfig, registerActionHudSettings, mountActionHudHooks } from "./module/helpers/action-hud.mjs";
import { SDTrade }             from "./module/helpers/trade.mjs";
import { SDQuest }             from "./module/helpers/quest.mjs";
import { installSdPause }      from "./module/helpers/sd-pause.mjs";
import { SlotEffectSync }      from "./module/helpers/slot-effects.mjs";
import { registerEffectDurationHooks } from "./module/helpers/effect-duration.mjs";
import { installOnboarding, SDOnboarding } from "./module/helpers/onboarding.mjs";

SDTrade.init();
SDQuest.init();
installSdPause();
SlotEffectSync.install();
registerEffectDurationHooks();

globalThis.SD = {};

function registerConfig() {
  CONFIG.SD = {

    diceTypes: ["d4", "d6", "d8", "d10", "d12", "d20", "d100"],

    attributes: {
      attr1: "SD.Attributes.attr1",
      attr2: "SD.Attributes.attr2",
      attr3: "SD.Attributes.attr3",
      attr4: "SD.Attributes.attr4",
      attr5: "SD.Attributes.attr5",
      attr6: "SD.Attributes.attr6"
    },

    resources: {
      hp:      "SD.Resources.HP",
      mp:      "SD.Resources.MP",
      stamina: "SD.Resources.Stamina",
      custom1: "SD.Resources.Custom1",
      custom2: "SD.Resources.Custom2"
    },

    skills: Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [`skill${i+1}`, `SD.Skills.skill${i+1}`])
    ),

    itemCategories: {
      weapon:     "SD.ItemCategories.weapon",
      armor:      "SD.ItemCategories.armor",
      shield:     "SD.ItemCategories.shield",
      consumable: "SD.ItemCategories.consumable",
      tool:       "SD.ItemCategories.tool",
      gear:       "SD.ItemCategories.gear",
      container:  "SD.ItemCategories.container",
      treasure:   "SD.ItemCategories.treasure",
      other:      "SD.ItemCategories.other"
    },

    rarities: {
      common:    "SD.Rarities.common",
      uncommon:  "SD.Rarities.uncommon",
      rare:      "SD.Rarities.rare",
      "very-rare": "SD.Rarities.veryRare",
      legendary: "SD.Rarities.legendary",
      artifact:  "SD.Rarities.artifact",
      unique:    "SD.Rarities.unique"
    },

    sizes: {
      tiny:        "SD.Sizes.tiny",
      small:       "SD.Sizes.small",
      medium:      "SD.Sizes.medium",
      large:       "SD.Sizes.large",
      huge:        "SD.Sizes.huge",
      gargantuan:  "SD.Sizes.gargantuan"
    },

    effectPaths: EFFECT_PATHS
  };

  CONFIG.SD._crToXP = {
    0: 10, 0.125: 25, 0.25: 50, 0.5: 100,
    1: 200, 2: 450, 3: 700, 4: 1100, 5: 1800,
    6: 2300, 7: 2900, 8: 3900, 9: 5000, 10: 5900,
    11: 7200, 12: 8400, 13: 10000, 14: 11500, 15: 13000,
    16: 15000, 17: 18000, 18: 20000, 19: 22000, 20: 25000,
    21: 33000, 22: 41000, 23: 50000, 24: 62000, 30: 155000
  };
}

Hooks.once("init", () => {
  console.log("SD | Initialising system…");

  registerConfig();

  try { exposeAutoanimationsIntegration(); } catch (e) { console.warn("SD | exposeAutoanimationsIntegration failed:", e); }

  import("./module/helpers/sd-region.mjs").then(({ SDRegion }) => {
    SDRegion.register();
    globalThis._SD_REGION = SDRegion;
  }).catch(e => console.warn("SD | SDRegion.register() failed:", e));

  CONFIG.Actor.documentClass = SDActor;
  CONFIG.Item.documentClass  = SDItem;
  CONFIG.ActiveEffect.documentClass = SDActiveEffect;

  CONFIG.Actor.dataModels = {
    character: CharacterData,
    npc:       NPCData
  };
  CONFIG.Item.dataModels = {
    inventory: InventoryData,
    ability:   AbilityData,
    feature:   FeatureData,
    class:     ClassData,
    skilltree: SkillTreeData,
    questlog:  QuestLogData
  };

  CONFIG.Actor.trackableAttributes = {
    character: {
      bar:   ["resources.hp", "resources.mp", "resources.stamina", "resources.custom1", "resources.custom2"],
      value: ["advancement.level", "advancement.xp.value", "defense.total", "initiative.total"]
    },
    npc: {
      bar:   ["resources.hp", "resources.mp"],
      value: ["classification.cr", "defense.total"]
    }
  };

  const ActorsCollection = foundry.documents.collections.Actors;
  const ItemsCollection  = foundry.documents.collections.Items;
  const LegacyActorSheet = foundry.appv1?.sheets?.ActorSheet;
  const LegacyItemSheet  = foundry.appv1?.sheets?.ItemSheet;

  if (LegacyActorSheet) ActorsCollection.unregisterSheet("core", LegacyActorSheet);
  ActorsCollection.registerSheet("sd", CharacterSheet, {
    types:       ["character"],
    makeDefault: true,
    label:       "SD.Sheets.Character"
  });
  ActorsCollection.registerSheet("sd", NPCSheet, {
    types:       ["npc"],
    makeDefault: true,
    label:       "SD.Sheets.NPC"
  });

  if (LegacyItemSheet) ItemsCollection.unregisterSheet("core", LegacyItemSheet);
  ItemsCollection.registerSheet("sd", SDItemSheet, {
    types:       ["inventory","ability","feature","class","skilltree"],
    makeDefault: true,
    label:       "SD.Sheets.Item"
  });

  import("./module/sheets/questlog-sheet.mjs").then(({ SDQuestLogSheet }) => {
    ItemsCollection.registerSheet("sd", SDQuestLogSheet, {
      types:       ["questlog"],
      makeDefault: true,
      label:       "SD.Sheets.QuestLog"
    });
  }).catch(e => console.error("SD | failed to register QuestLog sheet:", e));

  game.settings.registerMenu("sd", "marketMenu", {
    name:   "SD.Market.MenuName",
    label:  "SD.Market.MenuLabel",
    hint:   "SD.Market.MenuHint",
    icon:   "fa-solid fa-store",
    type:   SDMarketApp,
    restricted: true
  });

  game.settings.register("sd", "marketRegistryUrl", {
    name:    "SD.Market.RegistrySettingName",
    hint:    "SD.Market.RegistrySettingHint",
    scope:   "world",
    config:  true,
    type:    String,
    default: "https://raw.githubusercontent.com/phoenix1cold/sd-market/main/index.json"
  });

  game.settings.registerMenu("sd", "systemConfig", {
    name:   "SD.Settings.SystemConfig",
    label:  "SD.Settings.SystemConfigLabel",
    hint:   "SD.Settings.SystemConfigHint",
    icon:   "fa-solid fa-sliders",
    type:   SystemConfig,
    restricted: true
  });

  game.settings.register("sd", "systemSettings", {
    name:   "System Settings Data",
    scope:  "world",
    config: false,
    type:   Object,
    default: {},
    onChange: (cfg) => {
      try {
        applySettings(cfg ?? {});

        for (const a of game.actors ?? []) {
          try { a.reset(); } catch (e) {}
        }

        for (const app of Object.values(ui.windows ?? {})) {
          if (app?.constructor?.name?.startsWith("SDActor") || app?.constructor?.name?.startsWith("SDItem")) {
            try { app.render(false); } catch (e) {}
          }
        }
      } catch (e) {
        console.warn("SD | systemSettings onChange handler failed:", e);
      }
    }
  });

  game.settings.register("sd", "aiSettings", {
    name:    "AI Settings",
    scope:   "world",
    config:  false,
    type:    Object,
    default: {
      worldKnowledge: "",
      worldEvents: [],
      provider: {
        url: "",
        apiKey: "",
        apiKeySetting: "",
        model: "",
        temperature: 0.7,
        maxTokens: 700,
        systemPrompt: ""
      },
      providerProfiles: {
        default: {
          url: "",
          apiKey: "",
          apiKeySetting: "",
          model: "",
          temperature: 0.7,
          maxTokens: 700,
          systemPrompt: ""
        },
        dialogue: {
          url: "",
          apiKey: "",
          apiKeySetting: "",
          model: "",
          temperature: "",
          maxTokens: "",
          systemPrompt: ""
        },
        memory: {
          url: "",
          apiKey: "",
          apiKeySetting: "",
          model: "",
          temperature: "",
          maxTokens: "",
          systemPrompt: ""
        },
        bio: {
          url: "",
          apiKey: "",
          apiKeySetting: "",
          model: "",
          temperature: "",
          maxTokens: "",
          systemPrompt: ""
        },
        assistant: {
          url: "",
          apiKey: "",
          apiKeySetting: "",
          model: "",
          temperature: "",
          maxTokens: "",
          systemPrompt: ""
        }
      }
    }
  });

  game.settings.register("sd", "sheetTemplates", {
    name:    "Sheet Templates",
    scope:   "world",
    config:  false,
    type:    Object,
    default: {}
  });

  game.settings.register("sd", "customFields", {
    name:    "Custom Fields",
    scope:   "world",
    config:  false,
    type:    Array,
    default: []
  });

  game.settings.register("sd", "nodeTemplates", {
    name:    "Node Graph Templates",
    scope:   "world",
    config:  false,
    type:    Object,
    default: {}
  });

  game.settings.register("sd", "functionLibrary", {
    name:    "Node Graph Function Library",
    scope:   "world",
    config:  false,
    type:    Object,
    default: { functions: {} }
  });

  game.settings.register("sd", "nodeGraphLanguage", {
    name:    "SD.Settings.NodeGraphLanguage",
    hint:    "SD.Settings.NodeGraphLanguageHint",
    scope:   "client",
    config:  true,
    type:    String,
    default: "auto",
    choices: {
      auto: "SD.Settings.NodeGraphLanguageOption.Auto",
      en:   "SD.Settings.NodeGraphLanguageOption.English",
      ru:   "SD.Settings.NodeGraphLanguageOption.Russian"
    },
    onChange: () => {
      try {
        document.querySelectorAll(".graph-window, .toolbox-window").forEach(el => el.dispatchEvent(new CustomEvent("sd-reload", { bubbles: true })));
      } catch {}
    }
  });

  (async () => {
    try {
      const { _loadNodeGraphLangs } = await import("./module/builder/formula-graph.mjs");
      await _loadNodeGraphLangs();
    } catch (e) { console.warn("SD | failed to preload node-graph lang dicts:", e); }
  })();

  registerActionHudSettings();

  registerSettings();
  installOnboarding();

  registerHandlebarsHelpers();

  SystemConfig.applyStoredSettings();

  installColorSchemeObserver();

  CONFIG.SD.Toolbox = Toolbox;

  console.log("SD | Initialisation complete.");
});

const _sdRemoveFeatureOption = (root) => {
  if (!root) return;
  root.querySelectorAll?.('select[name="type"] option[value="feature"]').forEach(o => o.remove());
};
Hooks.on("renderDialogV2", (_dialog, html) => _sdRemoveFeatureOption(html));
Hooks.on("renderDialog", (_dialog, html) => _sdRemoveFeatureOption(html?.[0] ?? html));
Hooks.on("renderApplication", (_app, html) => _sdRemoveFeatureOption(html?.[0] ?? html));
Hooks.on("preCreateItem", (_item, data) => {
  if (data?.type === "feature") {
    ui.notifications?.warn?.('Item type "feature" is deprecated; please create an "ability" instead.');
    return false;
  }
});

Hooks.on("preCreateActor", (actor, data, _options, _userId) => {
  if (data?.type === "character") {
    const ptLink = foundry.utils.getProperty(data, "prototypeToken.actorLink");
    if (ptLink === undefined) {
      actor.updateSource({ "prototypeToken.actorLink": true });
    }
  }

  if (data?.type === "character" || data?.type === "npc") {
    try {
      const updates = buildActorBaseDefaults(data?.type);
      if (!updates) return;

      const filtered = {};
      for (const [path, value] of Object.entries(updates)) {
        const existing = foundry.utils.getProperty(data, path);
        if (existing === undefined || existing === null) {
          filtered[path] = value;
        }
      }
      if (Object.keys(filtered).length) actor.updateSource(filtered);
    } catch (e) {
      console.warn("SD | Failed to apply base actor defaults:", e);
    }
  }
});

Hooks.once("ready", async () => {
  if (game.user.isGM) {
    await runMigrations();

    try {
      const { convertLegacyFeatureItems } = await import("./module/helpers/migrations.mjs");
      await convertLegacyFeatureItems();
    } catch (err) {
      console.warn("SD | feature→ability cleanup failed:", err);
    }

    try {
      for (const actor of game.actors ?? []) {
        await SDItem.cleanupLegacyTransferredEffects?.(actor);
      }
    } catch (err) {
      console.warn("SD | legacy item transfer cleanup failed:", err);
    }
  }
  const { GridManager }    = await import("./module/builder/grid-manager.mjs");
  const { WidgetRenderer } = await import("./module/builder/widget-renderer.mjs");
  const { FormulaEngine }  = await import("./module/helpers/formula-engine.mjs");
  globalThis._SD_BUILDER = { GridManager, WidgetRenderer };
  globalThis._SD_FE      = { FormulaEngine };

  const { EVENT_BUS } = await import("./module/helpers/event-bus.mjs");
  EVENT_BUS.init();
  globalThis._SD_EVENT_BUS = EVENT_BUS;
  SDOnboarding.showWelcomeIfNeeded();

  try {
    const Vision = await import("./module/helpers/vision.mjs");
    const Move   = await import("./module/helpers/move-token.mjs");
    const TTS    = await import("./module/helpers/tts.mjs");
    globalThis._SD_VISION = Vision;
    globalThis._SD_MOVE   = Move;
    globalThis._SD_TTS    = TTS;
  } catch (e) {
    console.warn("SD | vision/move/tts module load failed:", e);
  }

  game.socket.on("system.sd", async (data) => {

    if (data.type === "messageComposer.used") {
      const activeGM = game.users?.find?.(user => user.active && user.isGM) ?? null;
      if (!game.user?.isGM || (activeGM && activeGM.id !== game.user.id)) return;

      const message = game.messages?.get?.(data.messageId);
      const config = message?.flags?.sd?.messageComposer;
      const buttonId = String(data.buttonId ?? "");
      const requestingUser = game.users?.get?.(data.userId);
      const buttonExists = Array.isArray(config?.buttons)
        && config.buttons.some(button => button?.id === buttonId);
      if (!message || !config || config.reusable || !requestingUser || !buttonExists) return;

      const actor = game.actors?.get?.(config.actorId) ?? null;
      const ownerLevel = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
      const actorOwner = requestingUser.isGM
        || !!actor?.testUserPermission?.(requestingUser, ownerLevel)
        || Number(actor?.ownership?.[requestingUser.id] ?? 0) >= ownerLevel;
      const allowed = config.access === "everyone"
        || (config.access === "gm" && requestingUser.isGM)
        || (config.access === "author" && (requestingUser.isGM || requestingUser.id === config.authorId))
        || (config.access === "actorOwner" && (actorOwner || (!actor && requestingUser.id === config.authorId)));
      if (!allowed) return;

      const usedButtons = Array.from(new Set([...(config.usedButtons ?? []), buttonId]));
      try {
        await message.update({"flags.sd.messageComposer.usedButtons": usedButtons});
      } catch (error) {
        console.warn("SD | Could not persist Message Composer button state:", error);
      }
    }

    if (data.type === "saveRequest" && data.targetUser === game.user.id) {
      const actor = game.actors.get(data.actorId);
      if (!actor) return;
      const { ButtonExecutor } = await import("./module/helpers/button-executor.mjs");
      const total = await ButtonExecutor._showLocalSaveDialog({
        saveActor:   actor,
        saveMod:     data.saveMod     ?? 0,
        dc:          data.dc          ?? 15,
        flavor:      data.flavor      ?? "Saving Throw",
        rollFormula: data.rollFormula || "1d20",
        timeout:     data.timeout     ?? 60
      });
      game.socket.emit("system.sd", {
        type:       "saveResult",
        callbackId: data.callbackId,
        total
      });
    }

    if (data.type === "tts") {
      try { globalThis._SD_TTS?.sdHandleTTSSocket?.(data); }
      catch (e) { console.warn("SD | TTS socket handle failed:", e); }
    }
  });
});

Hooks.on("getSceneControlButtons", (controls) => {
  if (!game.user?.isGM) return;

  const toolDef = {
    name:    "sd-toolbox",
    title:   "Sheet Builder",
    icon:    "fas fa-toolbox",
    order:   99,
    button:  true,
    onChange: () => Toolbox.toggle()
  };

  if (Array.isArray(controls)) {
    const tokenGroup = controls.find(c => c.name === "token");
    if (tokenGroup) (tokenGroup.tools ??= []).push(toolDef);
    return;
  }
  const tokenGroup = controls.token ?? controls.tokens;
  if (!tokenGroup) return;
  const tools = tokenGroup.tools ?? tokenGroup;
  if (tools) tools["sd-toolbox"] = toolDef;
});

function registerSettings() {
  game.settings.register("sd", "schemaVersion", {
    name:    "Schema Version",
    scope:   "world",
    config:  false,
    type:    String,
    default: "0.0.0"
  });

  game.settings.register("sd", "initiativeFormula", {
    name:    "SD.Settings.InitiativeFormula",
    hint:    "SD.Settings.InitiativeFormulaHint",
    scope:   "world",
    config:  false,
    type:    String,
    default: "1d20"
  });

  game.settings.register("sd", "initiativeUseGraph", {
    name:    "SD.Settings.InitiativeUseGraph",
    scope:   "world",
    config:  false,
    type:    Boolean,
    default: false
  });

  game.settings.register("sd", "initiativeGraph", {
    name:    "SD.Settings.InitiativeGraph",
    scope:   "world",
    config:  false,
    type:    Object,
    default: { nodes: [], edges: [], comments: [] }
  });

  game.settings.register("sd", "initiativeGraphCompiled", {
    name:    "SD.Settings.InitiativeGraphCompiled",
    scope:   "world",
    config:  false,
    type:    String,
    default: ""
  });

  game.settings.register("sd", "useEncumbrance", {
    name:    "SD.Settings.UseEncumbrance",
    hint:    "SD.Settings.UseEncumbranceHint",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: false
  });

  game.settings.register("sd", "onboardingEnabled", {
    name:    "SD.Guide.ShowQuickOnboarding",
    hint:    "SD.Guide.ShowQuickOnboardingHint",
    scope:   "client",
    config:  true,
    type:    Boolean,
    default: true
  });

  game.settings.register("sd", "helperTooltips", {
    name:    "SD.Guide.ShowHelperTooltips",
    hint:    "SD.Guide.ShowHelperTooltipsHint",
    scope:   "client",
    config:  true,
    type:    Boolean,
    default: true
  });

  game.settings.register("sd", "onboardingSeenTours", {
    name:    "SD.Guide.SeenTours",
    scope:   "client",
    config:  false,
    type:    Object,
    default: {}
  });
}

function registerHandlebarsHelpers() {
  Handlebars.registerHelper("signedNumber", n => {
    const num = Number(n);
    return num >= 0 ? `+${num}` : `${num}`;
  });

  Handlebars.registerHelper("percent", (value, max) => {
    if (!max || max <= 0) return 0;
    return Math.round((value / max) * 100);
  });

  Handlebars.registerHelper("localeConfig", key => {
    const path = foundry.utils.getProperty(CONFIG.SD, key);
    return path ? game.i18n.localize(path) : key;
  });

  Handlebars.registerHelper("eq",  (a, b) => a === b);
  Handlebars.registerHelper("neq", (a, b) => a !== b);
  Handlebars.registerHelper("gt",  (a, b) => a > b);
  Handlebars.registerHelper("lt",  (a, b) => a < b);
  Handlebars.registerHelper("and", (a, b) => a && b);
  Handlebars.registerHelper("or",  (a, b) => a || b);
  Handlebars.registerHelper("not", a => !a);

  Handlebars.registerHelper("join", (arr, sep) => {
    if (!Array.isArray(arr)) return arr ?? "";
    return arr.join(typeof sep === "string" ? sep : ", ");
  });

  Handlebars.registerHelper("add", (a, b) => Number(a) + Number(b));

  Handlebars.registerHelper("array", (...args) => args.slice(0, -1));

  Handlebars.registerHelper("times", (n, block) => {
    let result = "";
    for (let i = 0; i < n; i++) result += block.fn(i);
    return result;
  });

  Handlebars.registerHelper("capitalize", s => {
    if (typeof s !== "string") return s;
    return s.charAt(0).toUpperCase() + s.slice(1);
  });

  Handlebars.registerHelper("concat", (...args) => args.slice(0, -1).join(""));

  Handlebars.registerHelper("diceIcon", die => {
    const map = { d4:"d4", d6:"d6", d8:"d8", d10:"dice", d12:"d12", d20:"d20", d100:"dice" };
    return `fas fa-dice-${map[die] ?? "dice"}`;
  });

  Handlebars.registerHelper("rarityClass", rarity => `rarity-${rarity}`);

  Handlebars.registerHelper("hiddenFieldPairs", (obj) => {
    if (!obj || typeof obj !== "object") return [];
    return Object.entries(obj).map(([key, value]) => ({ key, value }));
  });

  Handlebars.registerHelper("concat", (...args) => args.slice(0, -1).join(""));
}

function applyInitiativeFromAllSettings() {
  try {
    const formula  = String(game.settings.get("sd", "initiativeFormula") ?? "1d20");
    const useGraph = !!game.settings.get("sd", "initiativeUseGraph");
    const compiled = String(game.settings.get("sd", "initiativeGraphCompiled") ?? "");
    const effective = (useGraph && compiled.trim()) ? compiled.trim() : formula;
    if (effective) {
      game.system.initiative = effective;
      if (CONFIG?.Combat?.initiative) CONFIG.Combat.initiative.formula = effective;
    }
  } catch(e) {  }
}

async function _sdResolveInitiativeFormulaForActor(actor) {
  const useGraph = !!game.settings.get("sd", "initiativeUseGraph");
  const compiled = String(game.settings.get("sd", "initiativeGraphCompiled") ?? "");
  const fallback = String(game.settings.get("sd", "initiativeFormula") ?? "1d20") || "1d20";
  const raw = (useGraph && compiled.trim()) ? compiled.trim() : fallback;
  if (!raw) return "1d20";
  try {
    const { FormulaEngine } = await import("./module/helpers/formula-engine.mjs");
    if (actor && /[{}]/.test(raw)) return FormulaEngine.resolveForRoll(raw, actor) || raw;
  } catch(e) { console.warn("SD | resolveForRoll failed", e); }
  return raw;
}

function _installInitiativeOverride() {
  const CombatantCls = CONFIG?.Combatant?.documentClass;
  if (!CombatantCls?.prototype) return;
  if (CombatantCls.prototype.__sdInitiativePatched) return;
  CombatantCls.prototype.__sdInitiativePatched = true;

  const _origGetFormula = CombatantCls.prototype._getInitiativeFormula;
  CombatantCls.prototype._getInitiativeFormula = function() {
    const orig = _origGetFormula?.call(this);
    const useGraph = (() => { try { return !!game.settings.get("sd", "initiativeUseGraph"); } catch { return false; } })();
    const compiled = (() => { try { return String(game.settings.get("sd", "initiativeGraphCompiled") ?? ""); } catch { return ""; } })();
    const fallback = (() => { try { return String(game.settings.get("sd", "initiativeFormula") ?? "1d20"); } catch { return "1d20"; } })();
    const raw = (useGraph && compiled.trim()) ? compiled.trim() : (fallback || orig || "1d20");
    if (!raw) return "1d20";
    if (!/[{}]/.test(raw)) return raw;
    try {
      const FormulaEngine = globalThis.SD?.FormulaEngine;
      if (FormulaEngine && this.actor) {
        return FormulaEngine.resolveForRoll(raw, this.actor) || raw;
      }
    } catch(e) { console.warn("SD | _getInitiativeFormula resolveForRoll failed", e); }
    return raw;
  };

  const _origGetInitiativeRoll = CombatantCls.prototype.getInitiativeRoll;
  CombatantCls.prototype.getInitiativeRoll = function(formula) {
    let f = formula;
    if (!f) f = this._getInitiativeFormula();
    if (typeof f === "string" && /[{}]/.test(f)) {
      try {
        const FormulaEngine = globalThis.SD?.FormulaEngine;
        if (FormulaEngine && this.actor) f = FormulaEngine.resolveForRoll(f, this.actor) || f;
      } catch(e) { console.warn("SD | getInitiativeRoll resolveForRoll failed", e); }
    }
    return _origGetInitiativeRoll.call(this, f);
  };
}

Hooks.once("ready", async () => {
  applyInitiativeFromAllSettings();

  try {
    const { FormulaEngine } = await import("./module/helpers/formula-engine.mjs");
    globalThis.SD = globalThis.SD ?? {};
    globalThis.SD.FormulaEngine = FormulaEngine;
  } catch(e) { console.warn("SD | Could not import FormulaEngine for initiative", e); }

  try { _installInitiativeOverride(); } catch(e) { console.warn("SD | initiative override failed", e); }

  try { mountActionHudHooks(); } catch(e) { console.warn("SD | mountActionHudHooks failed:", e); }

  try {
    const { registerInteractables } = await import("./module/helpers/interactables.mjs");
    registerInteractables();
  } catch(e) { console.warn("SD | registerInteractables failed:", e); }

  void _sdResolveInitiativeFormulaForActor;
});

Hooks.on("updateSetting", (setting) => {
  const k = setting?.key;
  if (k === "sd.initiativeUseGraph" || k === "sd.initiativeGraphCompiled" || k === "sd.initiativeGraph") {
    applyInitiativeFromAllSettings();
    return;
  }
  if (k !== "sd.initiativeFormula") return;
  const formula = setting.value;
  if (formula) {
    game.system.initiative = formula;
    CONFIG.Combat.initiative.formula = formula;
  }
});

function _sdRerenderForCardsStack(cardsDoc) {
  try {
    const stackUuid = cardsDoc?.uuid;
    const stackName = cardsDoc?.name;
    if (!stackUuid && !stackName) return;

    const usesStack = (doc) => {
      if (!doc?.system?.customTabs) return false;
      return doc.system.customTabs.some(tab =>
        (tab.rows ?? []).some(row =>
          (row.widgets ?? []).some(w => {
            if (!w) return false;
            if (w.type === "cardHand") {
              return w.sourceUuid === stackUuid || w.sourceName === stackName;
            }
            if (w.type === "cardDrawButton") {
              return w.fromUuid === stackUuid || w.fromName === stackName
                  || w.toUuid   === stackUuid || w.toName   === stackName;
            }
            if (w.type === "vsection" && Array.isArray(w.widgets)) {
              return w.widgets.some(cw => {
                if (cw?.type === "cardHand") return cw.sourceUuid === stackUuid || cw.sourceName === stackName;
                if (cw?.type === "cardDrawButton") return cw.fromUuid === stackUuid || cw.fromName === stackName
                    || cw.toUuid === stackUuid || cw.toName === stackName;
                return false;
              });
            }
            return false;
          })
        )
      );
    };

    const seen = new Set();
    const apps = [];
    for (const app of Object.values(ui.windows ?? {})) apps.push(app);
    const v2 = foundry.applications?.instances;
    if (v2?.values) for (const app of v2.values()) apps.push(app);
    else if (v2 && typeof v2 === "object") for (const app of Object.values(v2)) apps.push(app);

    for (const app of apps) {
      if (!app || seen.has(app)) continue;
      seen.add(app);
      const doc = app.document ?? app.object ?? null;
      if (!usesStack(doc)) continue;
      try { app.render(false); } catch (e) {  }
    }
  } catch(e) { console.warn("SD | _sdRerenderForCardsStack:", e); }
}
Hooks.on("updateCards", _sdRerenderForCardsStack);
Hooks.on("createCard", (card) => _sdRerenderForCardsStack(card?.parent));
Hooks.on("updateCard", (card) => _sdRerenderForCardsStack(card?.parent));
Hooks.on("deleteCard", (card) => _sdRerenderForCardsStack(card?.parent));

function _sdRerenderActorSheetsLinkedToQuestLog(item) {
  try {
    if (!item || item.documentName !== "Item" || item.type !== "questlog") return;
    const logUuid = item.uuid;
    const apps = [];
    for (const app of Object.values(ui.windows ?? {})) apps.push(app);
    const v2 = foundry.applications?.instances;
    if (v2?.values) for (const app of v2.values()) apps.push(app);
    else if (v2 && typeof v2 === "object") for (const app of Object.values(v2)) apps.push(app);
    const seen = new Set();
    for (const app of apps) {
      if (!app || seen.has(app)) continue;
      seen.add(app);
      const doc = app.document ?? app.object ?? null;
      if (doc?.documentName !== "Actor") continue;
      const aq = doc.system?.activeQuest;
      if (aq?.questLogUuid === logUuid) {
        try { app.render(false); } catch {}
      }
    }
  } catch(e) { console.warn("SD | rerender actors for questlog:", e); }
}
Hooks.on("updateItem", (item, _changes, _opts, _userId) => _sdRerenderActorSheetsLinkedToQuestLog(item));

Hooks.on("renderChatMessageHTML", (message, html) => {

  const _sdChatText = (key, fallback) => {
    const localized = game.i18n.localize(key);
    return localized && localized !== key ? localized : fallback;
  };

  function _liveTarget() {
    return game.user.targets?.first()?.actor
        ?? canvas?.tokens?.controlled?.[0]?.actor
        ?? null;
  }

  function _markApplied(card, summaryHtml) {
    card?.querySelectorAll(
      ".sd-apply-hp-btn, .sd-apply-selected-btn, .sd-mult-btn, .sd-reroll-btn, .sd-selected-confirm-btn, .sd-selected-cancel-btn"
    ).forEach(b => { b.disabled = true; b.style.opacity = "0.4"; b.style.cursor = "default"; });
    const row = card?.querySelector(".sd-card-apply-row");
    if (row && summaryHtml) {
      const note = document.createElement("div");
      note.style.cssText = "font-size:10px;color:#5ae07a;margin-top:4px;display:flex;align-items:center;gap:4px;";
      note.innerHTML = `<i class="fas fa-check-circle"></i> ${summaryHtml}`;
      row.after(note);
    }
  }

  async function _applyDelta(actor, hpPath, delta, label, card) {
    if (!actor) { ui.notifications.warn(game.i18n.localize("SD.Chat.NoTarget")); return; }
    if (!game.user.isGM && !actor.isOwner) { ui.notifications.warn(game.i18n.localize("SD.Chat.NotOwner")); return; }
    const cur    = Number(foundry.utils.getProperty(actor, hpPath) ?? 0);
    const newVal = Math.max(0, cur + delta);
    await actor.update({ [hpPath]: newVal });
    _markApplied(card, `${label} → ${actor.name}: ${cur} → ${newVal}`);
  }

  const composerConfig = message.flags?.sd?.messageComposer;
  if (composerConfig && Array.isArray(composerConfig.buttons)) {
    const usedButtons = new Set(composerConfig.usedButtons ?? []);
    html.querySelectorAll(".sd-message-composer-btn").forEach(btn => {
      const buttonId = String(btn.dataset.sdMessageButton ?? "");
      const buttonConfig = composerConfig.buttons.find(button => button?.id === buttonId);
      if (!buttonConfig) {
        btn.disabled = true;
        return;
      }

      if (!composerConfig.reusable && usedButtons.has(buttonId)) {
        btn.disabled = true;
        btn.classList.add("is-used");
        btn.title = _sdChatText("SD.Chat.MessageButtonUsed", "Already used");
      }

      btn.addEventListener("click", async () => {
        if (btn.disabled) return;
        const actor = game.actors?.get?.(composerConfig.actorId) ?? null;
        const allowed = composerConfig.access === "everyone"
          || (composerConfig.access === "gm" && game.user.isGM)
          || (composerConfig.access === "author" && (game.user.isGM || game.user.id === composerConfig.authorId))
          || (composerConfig.access === "actorOwner" && (game.user.isGM || actor?.isOwner || (!actor && game.user.id === composerConfig.authorId)));
        if (!allowed) {
          ui.notifications.warn(_sdChatText("SD.Chat.MessageButtonNoPermission", "You cannot use this message button."));
          return;
        }

        const icon = btn.querySelector("i");
        const previousIcon = icon?.className ?? "";
        btn.disabled = true;
        btn.classList.add("is-running");
        if (icon) icon.className = "fas fa-spinner fa-spin";

        try {
          if (!composerConfig.reusable) {
            usedButtons.add(buttonId);
            const nextUsed = Array.from(usedButtons);
            const canUpdate = game.user.isGM || message.isOwner || message.canUserModify?.(game.user, "update");
            if (canUpdate) {
              try {
                await message.update({"flags.sd.messageComposer.usedButtons": nextUsed});
              } catch {
                game.socket.emit("system.sd", {
                  type:"messageComposer.used",
                  messageId:message.id,
                  buttonId,
                  userId:game.user.id
                });
              }
            } else {
              game.socket.emit("system.sd", {
                type:"messageComposer.used",
                messageId:message.id,
                buttonId,
                userId:game.user.id
              });
            }
          }

          let item = null;
          if (composerConfig.itemUuid) {
            try { item = await fromUuid(composerConfig.itemUuid); }
            catch { item = null; }
          }
          const actionActor = actor ?? item?.actor ?? null;
          const { ButtonExecutor } = await import("./module/helpers/button-executor.mjs");
          const buttonDef = {
            ...(foundry.utils.deepClone(composerConfig.buttonSnapshot ?? {})),
            label:composerConfig.title ?? buttonConfig.label ?? "Message"
          };
          const runtime = foundry.utils.deepClone(composerConfig.runtimeSnapshot ?? {});
          for (const action of (buttonConfig.actions ?? [])) {
            await ButtonExecutor._runAction(action, item, actionActor, buttonDef, runtime);
          }

          btn.classList.remove("is-running");
          btn.classList.add("is-complete");
          if (icon) icon.className = "fas fa-check";
          if (composerConfig.reusable) {
            window.setTimeout(() => {
              btn.disabled = false;
              btn.classList.remove("is-complete");
              if (icon) icon.className = previousIcon;
            }, 700);
          } else {
            btn.classList.add("is-used");
            btn.title = _sdChatText("SD.Chat.MessageButtonUsed", "Already used");
          }
        } catch (error) {
          console.error("SD | Message Composer button failed:", error);
          btn.classList.remove("is-running", "is-complete");
          if (icon) icon.className = previousIcon;
          if (composerConfig.reusable) {
            btn.disabled = false;
          } else {
            btn.disabled = true;
            btn.classList.add("is-used");
            btn.title = _sdChatText("SD.Chat.MessageButtonUsed", "Already used");
          }
          ui.notifications.error(_sdChatText("SD.Chat.MessageButtonFailed", "Message button action failed."));
        }
      });
    });
  }

  html.querySelectorAll(".sd-apply-hp-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const card   = btn.closest(".sd-chat-card");
      const actor  = game.actors.get(btn.dataset.actorId);
      const hpPath = btn.dataset.hpPath ?? "system.resources.hp.value";
      const delta  = Number(btn.dataset.delta ?? 0);
      const label  = btn.dataset.label ?? "Apply";
      await _applyDelta(actor, hpPath, delta, label, card);
    });
  });

  html.querySelectorAll(".sd-apply-selected-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const card     = btn.closest(".sd-chat-card");
      const hpPath   = btn.dataset.hpPath    ?? card?.dataset.hpPath    ?? "system.resources.hp.value";
      const isDamage = (btn.dataset.isDamage ?? card?.dataset.isDamage) === "1";
      const baseAmt  = Number(btn.dataset.baseAmount ?? card?.dataset.baseAmount ?? 0);
      const delta    = isDamage ? -baseAmt : baseAmt;
      const label    = btn.dataset.label ?? card?.dataset.label ?? "Apply";
      const accentColor = isDamage ? "#b83232" : "#2e8b46";

      const seenIds = new Set();
      const actors  = [];
      for (const t of (game.user.targets ?? [])) {
        if (t.actor && !seenIds.has(t.actor.id)) { seenIds.add(t.actor.id); actors.push(t.actor); }
      }
      for (const t of (canvas?.tokens?.controlled ?? [])) {
        if (t.actor && !seenIds.has(t.actor.id)) { seenIds.add(t.actor.id); actors.push(t.actor); }
      }

      if (!actors.length) {
        ui.notifications.warn(game.i18n.localize("SD.Chat.NoTarget"));
        return;
      }

      const previewArea = card?.querySelector(".sd-selected-preview");
      if (!previewArea) {
        _applyDelta(actors[0], hpPath, delta, label, card);
        return;
      }

      const actorsList = previewArea.querySelector(".sd-selected-actors-list");
      if (actorsList) {
        actorsList.innerHTML = actors.map(a => {
          const cur   = Number(foundry.utils.getProperty(a, hpPath) ?? 0);
          const maxHp = Number(foundry.utils.getProperty(a, hpPath.replace(/\.value$/, ".max")) ?? 0);
          const newHp = Math.max(0, cur + delta);
          const diff  = newHp - cur;
          const diffStr   = diff >= 0 ? `+${diff}` : String(diff);
          const diffColor = isDamage ? "#e05a5a" : "#5ae07a";
          const barPct    = maxHp ? Math.round((newHp / maxHp) * 100) : 0;
          const barColor  = barPct > 50 ? "#2e8b46" : barPct > 25 ? "#c07820" : "#b83232";
          return `
            <div data-actor-id="${a.id}"
                 style="padding:4px 0;border-bottom:1px solid #2a2a3a;font-size:11px;">
              <div style="display:flex;align-items:center;gap:6px;">
                <img src="${a.img ?? "icons/svg/mystery-man.svg"}"
                     style="width:18px;height:18px;border-radius:50%;object-fit:cover;flex-shrink:0;">
                <span style="flex:1;color:#c0c0d8;overflow:hidden;text-overflow:ellipsis;
                             white-space:nowrap;">${a.name}</span>
                <span style="color:#888;white-space:nowrap;">
                  ${cur}
                  <span style="color:${diffColor};font-weight:700;margin:0 2px">${diffStr}</span>
                  → <strong style="color:#e0e0ff">${newHp}</strong>
                  ${maxHp ? `<span style="color:#5a5a7a"> / ${maxHp}</span>` : ""}
                </span>
              </div>
              ${maxHp ? `<div style="background:#2a2a3a;border-radius:2px;height:3px;margin-top:3px;overflow:hidden;">
                <div style="width:${barPct}%;height:100%;background:${barColor};transition:width .3s;"></div>
              </div>` : ""}
            </div>`;
        }).join("");
      }

      const confirmBtn = previewArea.querySelector(".sd-selected-confirm-btn");
      if (confirmBtn) {
        confirmBtn.dataset.actorIds = actors.map(a => a.id).join(",");
        confirmBtn.dataset.delta    = String(delta);
        confirmBtn.dataset.hpPath   = hpPath;
      }

      previewArea.style.display = "block";
      btn.disabled     = true;
      btn.style.opacity = "0.5";
    });
  });

  html.querySelectorAll(".sd-selected-confirm-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const card     = btn.closest(".sd-chat-card");
      const hpPath   = btn.dataset.hpPath   ?? card?.dataset.hpPath   ?? "system.resources.hp.value";
      const delta    = Number(btn.dataset.delta  ?? 0);
      const label    = card?.dataset.label ?? "Apply";
      const actorIds = (btn.dataset.actorIds ?? "").split(",").filter(Boolean);

      if (!actorIds.length) { ui.notifications.warn(game.i18n.localize("SD.Chat.NoTarget")); return; }

      const results = [];
      for (const id of actorIds) {
        const a = game.actors.get(id);
        if (!a) { results.push(`? (${id}): not found`); continue; }
        if (!game.user.isGM && !a.isOwner) {
          ui.notifications.warn(game.i18n.localize("SD.Chat.NotOwner"));
          continue;
        }
        const cur    = Number(foundry.utils.getProperty(a, hpPath) ?? 0);
        const newVal = Math.max(0, cur + delta);
        await a.update({ [hpPath]: newVal });
        results.push(`${a.name}: ${cur}→${newVal}`);
      }
      if (results.length) _markApplied(card, results.join(", "));
    });
  });

  html.querySelectorAll(".sd-selected-cancel-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const card        = btn.closest(".sd-chat-card");
      const previewArea = card?.querySelector(".sd-selected-preview");
      const selBtn      = card?.querySelector(".sd-apply-selected-btn");
      if (previewArea) previewArea.style.display = "none";
      if (selBtn)      { selBtn.disabled = false; selBtn.style.opacity = "1"; }
    });
  });

  html.querySelectorAll(".sd-mult-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const card     = btn.closest(".sd-chat-card");
      const mult     = Number(btn.dataset.mult ?? 1);
      const hpPath   = card?.dataset.hpPath   ?? "system.resources.hp.value";
      const isDamage = card?.dataset.isDamage === "1";
      const baseAmt  = Number(card?.dataset.baseAmount ?? 0);
      const label    = card?.dataset.label ?? "Damage";
      const iconCls  = isDamage ? "fa-heart-crack" : "fa-heart";

      const scaledAmt = Math.ceil(baseAmt * mult);
      const delta     = isDamage ? -scaledAmt : scaledAmt;

      const totalEl = card?.querySelector(".sd-card-total");
      if (totalEl) totalEl.textContent = scaledAmt;

      card?.querySelectorAll(".sd-apply-hp-btn").forEach(b => {
        b.dataset.delta  = String(delta);
        b.dataset.amount = String(scaledAmt);
        b.innerHTML      = `<i class="fas ${iconCls}"></i> Apply ${scaledAmt}`;
        b.disabled       = false;
        b.style.opacity  = "1";
      });

      card?.querySelectorAll(".sd-apply-selected-btn").forEach(b => {
        b.dataset.baseAmount = scaledAmt;
        b.disabled     = false;
        b.style.opacity = "1";
      });
      const previewArea = card?.querySelector(".sd-selected-preview");
      if (previewArea) {
        previewArea.style.display = "none";
        previewArea.querySelector(".sd-selected-actors-list")?.replaceChildren();
      }

      let actor = _liveTarget();
      if (!actor) {
        const storedId = card?.dataset.targetId
          || card?.querySelector(".sd-apply-hp-btn")?.dataset.actorId
          || "";
        if (storedId) {
          actor = game.actors.get(storedId)
               ?? canvas?.tokens?.get(storedId)?.actor
               ?? null;
        }
      }
      if (!actor) {
        ui.notifications.info(
          game.i18n.format("SD.Chat.MultNoTarget", { mult: btn.textContent.trim(), amount: scaledAmt })
        );
        return;
      }
      await _applyDelta(actor, hpPath, delta, `${label} ${btn.textContent.trim()}`, card);
    });
  });

  html.querySelectorAll(".sd-reroll-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const card       = btn.closest(".sd-chat-card");
      const formula    = btn.dataset.formula;
      const srcActorId = btn.dataset.srcActorId;
      const hpPath     = btn.dataset.hpPath    ?? card?.dataset.hpPath    ?? "system.resources.hp.value";
      const isDamage   = (btn.dataset.isDamage ?? card?.dataset.isDamage) === "1";
      const label      = btn.dataset.label     ?? card?.dataset.label     ?? "Damage";
      const targetId   = btn.dataset.targetId;

      if (!formula) return;

      const actor = srcActorId ? game.actors.get(srcActorId) : null;
      let amount  = 0;
      try {
        const r = new Roll(formula, _sanitizeRollData(actor?.getRollData?.() ?? {}));
        await r.evaluate();
        await r.toMessage({
          speaker:  ChatMessage.getSpeaker({ actor }),
          flavor:   `${label} (re-roll)`,
          rollMode: _sdMsgMode()
        });
        amount = r.total;
      } catch(e) {
        console.error("SD | Re-roll failed:", e);
        ui.notifications.error("Re-roll failed: " + formula);
        return;
      }

      const totalEl = card?.querySelector(".sd-card-total");
      if (totalEl) totalEl.textContent = amount;
      if (card) {
        card.dataset.baseAmount = amount;
        card.querySelectorAll(".sd-apply-selected-btn").forEach(b => {
          b.dataset.baseAmount = amount;
          b.disabled     = false;
          b.style.opacity = "1";
        });
        const previewArea = card.querySelector(".sd-selected-preview");
        if (previewArea) {
          previewArea.style.display = "none";
          previewArea.querySelector(".sd-selected-actors-list")?.replaceChildren();
        }
        card.querySelectorAll(".sd-apply-hp-btn").forEach(b => {
          b.dataset.delta  = isDamage ? -amount : amount;
          b.dataset.amount = amount;
          const icon = isDamage ? "fa-heart-crack" : "fa-heart";
          b.innerHTML = `<i class="fas ${icon}"></i> Apply ${amount}`;
        });
      }

      const tActor = (targetId ? game.actors.get(targetId) : null) ?? _liveTarget();
      if (tActor) {
        const delta = isDamage ? -amount : amount;
        const ok = await foundry.applications.api.DialogV2.confirm({
          window:  { title: game.i18n.localize("SD.Chat.ApplyReroll") },
          content: `<p>${game.i18n.format("SD.Chat.ApplyRerollMsg", { amount, name: tActor.name })}</p>`,
          yes:     { label: game.i18n.localize("SD.Chat.Apply"), icon: "fas fa-check" }
        }).catch(() => false);
        if (ok) await _applyDelta(tActor, hpPath, delta, `${label} (re-roll)`, card);
      }
    });
  });

html.querySelectorAll(".sd-apply-region-effect").forEach(btn => {
  btn.addEventListener("click", async () => {
    if (btn.disabled) return;
    const { actorId, sceneId, regionId } = btn.dataset ?? {};
    if (!actorId || !regionId) return;
    btn.disabled = true; btn.style.opacity = "0.5";
    btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Applying…`;
    try {
      const { SDRegion } = await import("./module/helpers/sd-region.mjs");
      const ok = await SDRegion.applyRegionEffect({ sceneId, regionId, actorId });
      btn.innerHTML = ok
        ? `<i class="fas fa-check-circle"></i> Applied`
        : `<i class="fas fa-times-circle"></i> Failed`;
      btn.style.opacity = "0.6";
    } catch (e) {
      console.warn("SD | apply-region-effect button failed:", e);
      btn.innerHTML = `<i class="fas fa-times-circle"></i> Error`;
    }
  });
});

html.querySelectorAll(".sd-chat-aoe-place-btn[data-aoe-region-cfg]").forEach(btn => {
  btn.addEventListener("click", async () => {
    if (btn.disabled) return;
    let cfg;
    try { cfg = JSON.parse(btn.dataset.aoeRegionCfg ?? "{}"); } catch { return; }

    btn.disabled = true;
    btn.style.opacity = "0.5";
    btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Placing…`;

    const { buildShape, placeRegionInteractive } =
      await import("./module/helpers/sd-region.mjs");

    const shape = buildShape(
      cfg.shape ?? "circle",
      Number(cfg.size ?? 20),
      Number(cfg.angle ?? 53.13)
    );

    const applyEffect = {
      mode:              cfg.mode,
      effectName:        cfg.effectName ?? "AoE",
      effectImg:         cfg.effectImg  ?? "icons/svg/aura.svg",
      auraKey:           `aoe-${foundry.utils.randomID(8)}`,
      changes:           Array.isArray(cfg.changes) ? cfg.changes : [],
      tickMode:          cfg.tickMode ?? "onEnter",
      showInChat:        cfg.showInChat !== false,
      chatMode:          cfg.chatMode ?? "auto",
      applyMode:         cfg.applyMode ?? "auto",
      rollApplyMode:     cfg.rollApplyMode ?? "per_target",
      visibility:        cfg.visibility ?? "everyone",
      deactivateOnLeave: cfg.deactivateOnLeave !== false,
      persist:           cfg.persist !== false,
      conditionEffect:   cfg.conditionEffect ?? "",
      roundsRemaining:   Number(cfg.rounds ?? 0) || 0,

      formula:           cfg.formula      ?? "",
      bonusFormula:      cfg.bonusFormula ?? "",
      damageType:        cfg.damageType   ?? "",
      hpPath:            cfg.hpPath       ?? "system.resources.hp.value",
      hpMode:            cfg.hpMode       ?? "add",
      saveAttr:          cfg.saveAttr    ?? "system.attributes.dex.value",
      dc:                (v => Number.isFinite(v) ? v : 15)(Number(cfg.dc ?? 15)),
      flavor:            cfg.flavor      ?? "Saving Throw",
      advMode:           cfg.advMode     ?? "none",
      advFormula:        cfg.advFormula  ?? "",
      disFormula:        cfg.disFormula  ?? "",

      skipOwner:         false
    };

    const regionDoc = await placeRegionInteractive({
      name:  cfg.effectName ?? "SD AoE",
      shape,
      flags: { sd: { aoe: { srcActorId: cfg.srcActorId ?? "" }, applyEffect } }
    });

    if (!regionDoc) {
      btn.disabled = false;
      btn.style.opacity = "1";
      btn.innerHTML = `<i class="fas fa-crosshairs"></i> Place Template`;
      return;
    }

    btn.innerHTML = `<i class="fas fa-check"></i> Placed`;
  });
});

html.querySelectorAll(".sd-chat-aoe-targets-btn").forEach(btn => {
  btn.addEventListener("click", async () => {
    if (btn.disabled) return;
    let cfg;
    try { cfg = JSON.parse(btn.dataset.aoeTargetsCfg ?? "{}"); } catch { return; }

    btn.disabled = true;
    btn.style.opacity = "0.5";
    btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Placing…`;

    const { buildShape, placeRegionInteractive, getRegionTokens } =
      await import("./module/helpers/sd-region.mjs");

    const shape = buildShape(
      cfg.shape ?? "circle",
      Number(cfg.size ?? 20),
      Number(cfg.angle ?? 53.13)
    );

    const regionDoc = await placeRegionInteractive({
      name:  "SD AoE Targets",
      shape,
      flags: { sd: { aoeTargets: true, srcActorId: cfg.srcActorId ?? "" } }
    });

    if (!regionDoc) {
      btn.disabled = false;
      btn.style.opacity = "1";
      btn.innerHTML = `<i class="fas fa-crosshairs"></i> Place Template`;
      return;
    }

    await new Promise(r => setTimeout(r, 250));

    const tokenDocs = getRegionTokens(regionDoc);
    const allIds    = tokenDocs.map(t => t.id).filter(Boolean);

    if (!cfg.persist) { try { await regionDoc.delete(); } catch {} }

    const { ButtonExecutor } = await import("./module/helpers/button-executor.mjs");
    const srcActor = cfg.srcActorId ? game.actors.get(cfg.srcActorId) : null;
    let srcItem = null;
    if (cfg.srcItemUuid) { try { srcItem = await fromUuid(cfg.srcItemUuid); } catch {} }

    const rt = {
      savedTargets:  [],
      failedTargets: [],
      allTargets:    allIds
    };

    const synthBtn = {};
    if (cfg.runtimeSnapshot && typeof cfg.runtimeSnapshot === "object") {
      Object.assign(synthBtn, cfg.runtimeSnapshot);
    }

    for (const sub of (cfg.postActions ?? [])) {
      try { await ButtonExecutor._runAction(sub, srcItem, srcActor, synthBtn, rt); }
      catch (err) { console.warn("SD | AoE targets post-action error:", err); }
    }

    const card = btn.closest(".sd-chat-aoe-card");
    const results = card?.querySelector(".sd-chat-aoe-results");
    if (results) {
      results.style.display = "block";
      results.innerHTML = `
        <div><i class="fas fa-crosshairs" style="color:#3b73a6;margin-right:4px;"></i>Targets: ${allIds.length}</div>
      `;
    }
    btn.innerHTML = `<i class="fas fa-check"></i> Resolved`;
  });
});

html.querySelectorAll(".sd-chat-aoe-save-branch-btn").forEach(btn => {
  btn.addEventListener("click", async () => {
    if (btn.disabled) return;
    let cfg;
    try { cfg = JSON.parse(btn.dataset.aoeSaveBranchCfg ?? "{}"); } catch { return; }

    btn.disabled = true;
    btn.style.opacity = "0.5";
    btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Placing…`;

    const { buildShape, placeRegionInteractive, getRegionTokens } =
      await import("./module/helpers/sd-region.mjs");

    const shape = buildShape(
      cfg.shape ?? "circle",
      Number(cfg.size ?? 20),
      Number(cfg.angle ?? 53.13)
    );

    const regionDoc = await placeRegionInteractive({
      name:  "SD AoE Save Branch",
      shape,
      flags: { sd: { aoeSaveBranch: true, srcActorId: cfg.srcActorId ?? "" } }
    });

    if (!regionDoc) {
      btn.disabled = false;
      btn.style.opacity = "1";
      btn.innerHTML = `<i class="fas fa-crosshairs"></i> Place Template`;
      return;
    }

    await new Promise(r => setTimeout(r, 250));

    const tokenDocs = getRegionTokens(regionDoc);

    const { ButtonExecutor: _BE } = await import("./module/helpers/button-executor.mjs");
    const advCore = (mode) =>
      mode === "adv" ? ((cfg.advFormula || "").trim() || "2d20kh1")
    : mode === "dis" ? ((cfg.disFormula || "").trim() || "2d20kl1")
    : "1d20";
    const showInChat = cfg.showInChat !== false;
    const bonus      = String(cfg.bonusFormula ?? "").trim();

    const saved  = [];
    const failed = [];
    for (const tDoc of tokenDocs) {
      const tActor = tDoc.actor;
      if (!tActor) continue;
      const mod  = Number(foundry.utils.getProperty(tActor, cfg.saveAttr ?? "system.attributes.dex.value") ?? 0);

      let mode = String(cfg.advMode ?? "none");
      if (mode === "ask") {
        try {
          const res = await _BE._showRollDialogue({
            flavor:      cfg.flavor || "Saving Throw",
            baseFormula: `1d20 + ${mod}`,
            advFormula:  `${(cfg.advFormula || "").trim() || "2d20kh1"} + ${mod}`,
            disFormula:  `${(cfg.disFormula || "").trim() || "2d20kl1"} + ${mod}`,
            actor: tActor
          });
          if (!res || res.cancelled) { failed.push(tDoc); continue; }
          mode = res.mode === "advantage" ? "adv" : res.mode === "disadvantage" ? "dis" : "none";
        } catch { mode = "none"; }
      }

      const rollFormula = `${advCore(mode)} + ${mod}${bonus ? ` + (${bonus})` : ""}`;
      const roll        = await (new Roll(rollFormula)).evaluate();
      if (showInChat) {
        try {
          const advTag = mode === "adv" ? " (Adv)" : mode === "dis" ? " (Dis)" : "";
          await roll.toMessage({
            speaker:  ChatMessage.getSpeaker({ actor: tActor }),
            flavor:   `${cfg.flavor ?? "Saving Throw"}${advTag} vs DC ${cfg.dc ?? 15}`,
            rollMode: cfg.rollMode ?? "public"
          });
        } catch {}
      }
      if (roll.total >= (cfg.dc ?? 15)) saved.push(tDoc);
      else                              failed.push(tDoc);
    }

    if (!cfg.persist) { try { await regionDoc.delete(); } catch {} }

    const { ButtonExecutor } = await import("./module/helpers/button-executor.mjs");
    const srcActor = cfg.srcActorId ? game.actors.get(cfg.srcActorId) : null;
    let srcItem = null;
    if (cfg.srcItemUuid) { try { srcItem = await fromUuid(cfg.srcItemUuid); } catch {} }

    const savedIds  = saved.map(t  => t.id);
    const failedIds = failed.map(t => t.id);
    const allIds    = [...savedIds, ...failedIds];

    const rt = {
      savedTargets:  savedIds,
      failedTargets: failedIds,
      allTargets:    allIds
    };

    const synthBtn = {};
    if (cfg.runtimeSnapshot && typeof cfg.runtimeSnapshot === "object") {
      Object.assign(synthBtn, cfg.runtimeSnapshot);
    }

    for (const sub of (cfg.postActions ?? [])) {
      try { await ButtonExecutor._runAction(sub, srcItem, srcActor, synthBtn, rt); }
      catch (err) { console.warn("SD | AoE save-branch post-action error:", err); }
    }

    const card = btn.closest(".sd-chat-aoe-card");
    const results = card?.querySelector(".sd-chat-aoe-results");
    if (results) {
      results.style.display = "block";
      results.innerHTML = `
        <div><i class="fas fa-check" style="color:#2e8b46;margin-right:4px;"></i>Saved: ${saved.length}</div>
        <div><i class="fas fa-times" style="color:#b83232;margin-right:4px;"></i>Failed: ${failed.length}</div>
      `;
    }
    btn.innerHTML = `<i class="fas fa-check"></i> Resolved`;
  });
});


html.querySelectorAll(".sd-spell-v2-cast-btn[data-spell-v2-cfg]").forEach(btn => {
  btn.addEventListener("click", async () => {
    if (btn.disabled) return;
    let cfg;
    try { cfg = JSON.parse(btn.dataset.spellV2Cfg ?? "{}"); } catch { return; }
    const esc = (v) => String(v ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
    const templates = Array.isArray(cfg.templates) ? cfg.templates : [];
    let selectedTemplate = templates[0] ?? null;

    if (cfg.isAoe && templates.length > 1) {
      const { DialogV2 } = foundry.applications.api;
      const options = templates.map((t,i)=>`<label style="display:flex;align-items:center;gap:8px;padding:7px;border-bottom:1px solid var(--color-border-light-2);cursor:pointer"><input type="radio" name="sd-spell-template" value="${i}" ${i===0?"checked":""}><strong>${esc(t.name ?? `Template ${i+1}`)}</strong><span style="margin-left:auto">${esc(t.t ?? "circle")} · ${Number(t.distance ?? 0)} ft</span></label>`).join("");
      const picked = await DialogV2.wait({
        window:{title:cfg.title ?? "Choose AOE Template"},modal:true,
        content:`<div style="max-height:360px;overflow:auto">${options}</div>`,
        buttons:[
          {action:"ok",label:"Place",icon:"fas fa-crosshairs",default:true,callback:(ev,b,dlg)=>Number(dlg?.element?.querySelector?.('input[name="sd-spell-template"]:checked')?.value ?? 0)},
          {action:"cancel",label:"Cancel",icon:"fas fa-times",callback:()=>null}
        ],rejectClose:false
      }).catch(()=>null);
      if (picked === null) return;
      selectedTemplate = templates[picked] ?? templates[0];
    }

    btn.disabled=true;btn.style.opacity="0.55";btn.innerHTML='<i class="fas fa-spinner fa-spin"></i> Working…';
    let regionDoc=null;
    let tokenIds=[];
    try {
      if (cfg.isAoe) {
        if (!selectedTemplate) throw new Error("No AOE template supplied");
        const { buildShape, placeRegionInteractive, getRegionTokens } = await import("./module/helpers/sd-region.mjs");
        const shape = buildShape(selectedTemplate.t ?? selectedTemplate.shape ?? "circle", Number(selectedTemplate.distance ?? selectedTemplate.size ?? 20) || 20, Number(selectedTemplate.angle ?? 53.13) || 53.13);
        regionDoc = await placeRegionInteractive({
          name:selectedTemplate.name ?? cfg.title ?? "Spell AOE",
          shape,
          flags:{sd:{spellV2:true,templateSnapshot:selectedTemplate,srcActorId:cfg.srcActorId ?? ""}}
        });
        if (!regionDoc) {
          btn.disabled=false;btn.style.opacity="1";btn.innerHTML=`<i class="fas fa-wand-magic-sparkles"></i> ${esc(cfg.buttonLabel ?? "Cast")}`;
          return;
        }
        await new Promise(r=>setTimeout(r,250));
        tokenIds=getRegionTokens(regionDoc).map(t=>t.id).filter(Boolean);
        if (!cfg.persist) { try { await regionDoc.delete(); } catch {} }
      } else if (cfg.hasTarget) {
        const raw=String(cfg.targets ?? "").split(",").map(x=>x.trim()).filter(Boolean);
        tokenIds=raw.length ? raw : [
          ...(game.user?.targets ? [...game.user.targets].map(t=>t.id) : []),
          ...(canvas?.tokens?.controlled ?? []).map(t=>t.id)
        ];
        tokenIds=[...new Set(tokenIds)];
      }

      const { ButtonExecutor } = await import("./module/helpers/button-executor.mjs");
      const srcActor=cfg.srcActorId ? game.actors.get(cfg.srcActorId) : null;
      let srcItem=null;
      if(cfg.srcItemUuid){try{srcItem=await fromUuid(cfg.srcItemUuid);}catch{}}
      const runtime={
        savedTargets:[],failedTargets:[],allTargets:tokenIds,
        __aoeTemplate:regionDoc ?? selectedTemplate ?? null,
        __spellEffect:cfg.effect ?? null,
        __spellValue:cfg.value ?? null,
        __targetCount:tokenIds.length
      };
      const synthBtn={};
      for(const sub of (cfg.postActions ?? [])){
        try{await ButtonExecutor._runAction(sub,srcItem,srcActor,synthBtn,runtime);}
        catch(err){console.warn("SD | Spell v2 post-action failed:",err);}
      }
      const result=btn.closest(".sd-spell-v2-card")?.querySelector(".sd-spell-v2-result");
      if(result){result.style.display="block";result.innerHTML=`<i class="fas fa-check"></i> Resolved${tokenIds.length?` · ${tokenIds.length} target(s)`:""}`;}
      btn.innerHTML='<i class="fas fa-check"></i> Resolved';
    } catch(err) {
      console.warn("SD | Spell v2 failed:",err);
      ui.notifications?.warn?.(`SD | Spell: ${err?.message ?? err}`);
      btn.disabled=false;btn.style.opacity="1";btn.innerHTML=`<i class="fas fa-wand-magic-sparkles"></i> ${esc(cfg.buttonLabel ?? "Cast")}`;
    }
  });
});

html.addEventListener("click", async (e) => {
  const btn = e.target.closest(".sd-save-roll-btn");
  if (!btn || btn.disabled) return;

  const card = btn.closest(".sd-save-card");
  if (!card) return;

  const actorId      = btn.dataset.actorId              ?? card.dataset.saveActorId;
  const modifierPath = btn.dataset.saveModifierPath     ?? card.dataset.saveModifierPath;
  const dc           = Number(btn.dataset.saveDc        ?? card.dataset.saveDc    ?? 15);
  const operator     = btn.dataset.saveOperator          ?? card.dataset.saveOperator ?? ">=";
  const _sdPassCompare = (value, threshold, op) => {
    switch (op) {
      case ">":  return value > threshold;
      case "<":  return value < threshold;
      case "<=": return value <= threshold;
      case "==": return value == threshold;
      case "!=": return value != threshold;
      case ">=":
      default:   return value >= threshold;
    }
  };
  const flavor       = btn.dataset.saveFlavor           ?? card.dataset.saveFlavor ?? "Saving Throw";
  const rollMode     = btn.dataset.saveRollMode         ?? card.dataset.saveRollMode ?? "publicroll";
  const checkType    = btn.dataset.saveType             ?? card.dataset.saveType    ?? "save";
  const rollDialogue = (btn.dataset.saveRollDialogue    ?? card.dataset.saveRollDialogue) === "yes";
  const advFormula   = btn.dataset.saveAdvFormula       ?? card.dataset.saveAdvFormula ?? "";
  const disFormula   = btn.dataset.saveDisFormula       ?? card.dataset.saveDisFormula ?? "";
  const rollFormula  = btn.dataset.saveRollFormula      ?? card.dataset.saveRollFormula ?? "1d20";

  const saveActor = game.actors.get(actorId);
  if (!saveActor) { ui.notifications.warn(game.i18n.localize("SD.ChatSave.ActorNotFound")); return; }
  if (!game.user.isGM && !saveActor.isOwner) { ui.notifications.warn(game.i18n.localize("SD.ChatSave.NotOwner")); return; }

  const _rawMod = foundry.utils.getProperty(saveActor, modifierPath);
  const _modVal = (_rawMod && typeof _rawMod === "object" && "value" in _rawMod) ? _rawMod.value : _rawMod;
  const saveMod = Number(_modVal ?? 0) || 0;

  let _rollFormulaResolved = rollFormula;
  try {
    const FE = globalThis.SD?.FormulaEngine;
    if (FE && /[{}]|[A-Za-z_][\w]*\.[A-Za-z_]/.test(String(rollFormula))) {
      _rollFormulaResolved = FE.resolveForRoll(String(rollFormula), saveActor) || rollFormula;
    }
  } catch (e) { console.warn("SD | save-button: resolveForRoll(rollFormula) failed", e); }

  const baseFormula = `${_rollFormulaResolved} + ${saveMod}`;

  let rollTotal;
  let modeTag = "";
  let finalFormula = baseFormula;

  if (rollDialogue) {
    const resolveF = (f) => {
      if (!f) return "";
      if (f.includes("@mod")) return f.replace(/@mod/g, String(saveMod));
      return `${f} + ${saveMod}`;
    };
    const { ButtonExecutor } = await import("./module/helpers/button-executor.mjs");
    const result = await ButtonExecutor._showRollDialogue({
      flavor,
      baseFormula,
      advFormula: resolveF(advFormula),
      disFormula: resolveF(disFormula),
      actor: saveActor
    });
    if (result.cancelled) return;
    finalFormula = result.formula;
    modeTag = result.mode !== "normal"
      ? (result.mode === "advantage"
          ? (game.i18n.localize("SD.Roll.Advantage")    || "Advantage")
          : (game.i18n.localize("SD.Roll.Disadvantage") || "Disadvantage"))
      : "";
  }

  const _rawRollData = saveActor.getRollData?.() ?? {};
  const _safeRollData = Object.fromEntries(
    Object.entries(_rawRollData).map(([k, v]) =>
      [k, (typeof v === "string" && /^\s*\d*d\d+/i.test(v)) ? 0 : v]
    )
  );
  if (!Roll.validate(finalFormula)) {
    ui.notifications.error(`Invalid roll formula: ${finalFormula}`);
    return;
  }
  const roll = new Roll(finalFormula, _safeRollData);
  await roll.evaluate();
  rollTotal = roll.total;
  const passMsg = _sdPassCompare(rollTotal, dc, operator);
  const modeStr = modeTag ? ` [${modeTag}]` : "";
  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor: saveActor }),
    flavor:  `${flavor}${modeStr} — DC ${dc} — ${passMsg ? "✅ Success" : "❌ Failure"}`,
    rollMode
  });

  const pass      = passMsg;
  const passLabel = pass ? "✅ Success" : "❌ Failure";

  const _rrEnabled = (card.dataset.saveRerollEnabled ?? "0") === "1";
  if (_rrEnabled) {
    try {
      const _rrFlag = {
        enabled:    true,
        formula:    finalFormula,
        label:      flavor || "Save",
        srcActorId: saveActor.id,
        costPath:   String(card.dataset.saveRerollPath ?? "").trim(),
        costAmount: Number(card.dataset.saveRerollCost ?? 0) || 0
      };

      const lastMsg = [...game.messages].reverse().find(m => m.author?.id === game.user.id);
      if (lastMsg && _rrFlag.formula) await lastMsg.setFlag("sd", "reroll", _rrFlag);
    } catch (e) { console.warn("SD | save-button: failed to attach reroll flag", e); }
  }

  btn.disabled      = true;
  btn.style.opacity = "0.4";
  btn.style.cursor  = "default";
  btn.innerHTML     = `<i class="fas fa-${pass ? "check" : "times"}-circle"></i> ${rollTotal}`;

  const resultBg  = pass ? "#0a2a0a" : "#2a0a0a";
  const resultBdr = pass ? "#1e6030" : "#7a2020";

  const actorRow = btn.closest(".sd-save-actor-row");
  if (actorRow) {
    if (actorRow.nextElementSibling?.classList?.contains("sd-save-result"))
      actorRow.nextElementSibling.remove();
    const resultEl = document.createElement("div");
    resultEl.className = "sd-save-result";
    resultEl.style.cssText = `margin:3px 0 3px 38px;padding:4px 8px;border-radius:4px;
      font-size:11px;font-weight:700;color:#fff;background:${resultBg};border:1px solid ${resultBdr};
      display:flex;align-items:center;gap:6px;`;
    resultEl.innerHTML = `
      <i class="fas fa-${pass ? "check" : "times"}"></i>
      <span style="flex:1">${passLabel}${modeTag ? ` [${modeTag}]` : ""}</span>
      <span style="color:#a0a0c0">${rollTotal} ${operator} ${dc}</span>`;
    actorRow.after(resultEl);
  } else {
    const resultDiv = document.createElement("div");
    resultDiv.className = "sd-save-result";
    resultDiv.style.cssText = `margin-top:8px;padding:6px 10px;border-radius:4px;text-align:center;
      font-size:13px;font-weight:700;color:#fff;background:${resultBg};border:1px solid ${resultBdr}`;
    resultDiv.innerHTML = `<i class="fas fa-${pass ? "check" : "times"}"></i> ${passLabel}${modeTag ? ` [${modeTag}]` : ""} — ${game.i18n.format("SD.ChatSave.RolledVsDC", { total: rollTotal, dc })}`;
    btn.parentElement?.after(resultDiv);
  }

  const message = card.closest(".chat-message");
  let chatMsg = null;
  let aggregateResults = {};
  if (message) {
    const msgId = message.dataset.messageId;
    chatMsg = game.messages.get(msgId);
    if (chatMsg) {
      const existing = chatMsg.getFlag("sd", "saveResult") ?? {};
      existing[saveActor.id] = { total: rollTotal, pass, actorId: saveActor.id, userId: game.user.id };
      aggregateResults = existing;
      await chatMsg.setFlag("sd", "saveResult", existing);
    }
  }

  try {
    const passActions = chatMsg?.getFlag("sd", "passActions") ?? [];
    const failActions = chatMsg?.getFlag("sd", "failActions") ?? [];
    const branch = pass ? passActions : failActions;
    if (Array.isArray(branch) && branch.length) {
      const { ButtonExecutor } = await import("./module/helpers/button-executor.mjs");
      const synthBtn = {
        __lastRoll:    rollTotal,
        __lastFormula: finalFormula,
        __lastMargin:  rollTotal - dc,
        __lastDC:      dc
      };
      const aggregateEntries = Object.values(aggregateResults ?? {});
      const savedTargets = aggregateEntries.filter(r => r?.pass === true).map(r => r.actorId).filter(Boolean);
      const failedTargets = aggregateEntries.filter(r => r?.pass === false).map(r => r.actorId).filter(Boolean);
      const allTargets = [...new Set([...savedTargets, ...failedTargets])];
      const runtime = {
        __lastRoll:    rollTotal,
        __lastFormula: finalFormula,
        __lastMargin:  rollTotal - dc,
        __lastDC:      dc,
        savedTargets:  savedTargets.length || failedTargets.length ? savedTargets : (pass ? [saveActor.id] : []),
        failedTargets: savedTargets.length || failedTargets.length ? failedTargets : (pass ? [] : [saveActor.id]),
        allTargets:    allTargets.length ? allTargets : [saveActor.id],
        currentTarget: saveActor.id
      };
      for (const sub of branch) {
        try {
          await ButtonExecutor._runAction(sub, null, saveActor, synthBtn, runtime);
        } catch (err) {
          console.error("SD | save-button branch action failed:", err, sub);
        }
      }
    }
  } catch (err) {
    console.error("SD | save-button: failed to run pass/fail branch:", err);
  }
});

html.querySelectorAll(".sd-save-selected-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const card         = btn.closest(".sd-save-card");
    const modifierPath = btn.dataset.saveModifierPath  ?? card?.dataset.saveModifierPath  ?? "";
    const dc           = Number(btn.dataset.saveDc     ?? card?.dataset.saveDc     ?? 15);
    const flavor       = btn.dataset.saveFlavor        ?? card?.dataset.saveFlavor  ?? "Saving Throw";
    const rollMode     = btn.dataset.saveRollMode      ?? card?.dataset.saveRollMode ?? "publicroll";
    const rollDialogue = btn.dataset.saveRollDialogue  ?? card?.dataset.saveRollDialogue ?? "no";
    const advFormula   = btn.dataset.saveAdvFormula    ?? card?.dataset.saveAdvFormula    ?? "";
    const disFormula   = btn.dataset.saveDisFormula    ?? card?.dataset.saveDisFormula    ?? "";
    const rollFormula  = btn.dataset.saveRollFormula   ?? card?.dataset.saveRollFormula   ?? "1d20";
    const timeout      = Number(btn.dataset.saveTimeout ?? 0);
    const checkType    = btn.dataset.saveType          ?? card?.dataset.saveType    ?? "save";
    const buttonLabel  = btn.dataset.buttonLabel       ?? "Roll Save";

    const existingIds = new Set(
      [...(card?.querySelectorAll(".sd-save-actor-row[data-actor-id]") ?? [])]
        .map(r => r.dataset.actorId)
    );

    const seenNew = new Set();
    const actors  = [];
    for (const t of (game.user.targets ?? [])) {
      if (t.actor && !existingIds.has(t.actor.id) && !seenNew.has(t.actor.id)) {
        seenNew.add(t.actor.id); actors.push(t.actor);
      }
    }
    for (const t of (canvas?.tokens?.controlled ?? [])) {
      if (t.actor && !existingIds.has(t.actor.id) && !seenNew.has(t.actor.id)) {
        seenNew.add(t.actor.id); actors.push(t.actor);
      }
    }

    if (!actors.length) {
      ui.notifications.warn(game.i18n.localize("SD.Chat.NoTarget"));
      return;
    }

    const previewArea = card?.querySelector(".sd-save-selected-preview");
    const actorsList  = previewArea?.querySelector(".sd-save-selected-actors-list");
    if (!actorsList) return;

    actorsList.innerHTML = actors.map(a => {
      const saveMod = Number(foundry.utils.getProperty(a, modifierPath) ?? 0);
      const sign    = saveMod >= 0 ? `+${saveMod}` : String(saveMod);
      const modLbl  = modifierPath.split(".").pop()?.toUpperCase() ?? "MOD";
      return `
        <div class="sd-save-actor-row" data-actor-id="${a.id}"
             style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid #2a2a3a;">
          <img src="${a.img ?? "icons/svg/mystery-man.svg"}"
               style="width:30px;height:30px;border-radius:50%;border:2px solid #7a3a00;
                      object-fit:cover;flex-shrink:0;">
          <div style="flex:1;min-width:0;">
            <div style="font-size:12px;font-weight:700;color:#d0d0e8;overflow:hidden;
                        text-overflow:ellipsis;white-space:nowrap;">${a.name}</div>
            <div style="font-size:10px;color:#8888a0;">
              ${rollFormula ?? "1d20"} <span style="color:#c8a0ff">${sign}</span>
              <span style="color:#5a5a7a;margin-left:4px;">${modLbl}</span>
            </div>
          </div>
          <button type="button" class="sd-save-roll-btn"
                  data-actor-id="${a.id}"
                  data-save-modifier-path="${modifierPath.replace(/"/g, "&quot;")}"
                  data-save-dc="${dc}"
                  data-save-flavor="${flavor.replace(/"/g, "&quot;")}"
                  data-save-roll-mode="${rollMode}"
                  data-save-roll-dialogue="${rollDialogue}"
                  data-save-adv-formula="${advFormula.replace(/"/g, "&quot;")}"
                  data-save-dis-formula="${disFormula.replace(/"/g, "&quot;")}"
                  data-save-roll-formula="${(rollFormula ?? "1d20").replace(/"/g, "&quot;")}"
                  data-save-timeout="${timeout}"
                  data-save-type="${checkType}"
                  style="background:#7a3a00;border:1px solid #5a2a00;border-radius:5px;
                         color:#fff;cursor:pointer;font-size:11px;font-weight:700;
                         padding:5px 10px;display:flex;align-items:center;gap:5px;
                         white-space:nowrap;flex-shrink:0;transition:background .12s;">
            <i class="fas fa-dice-d20"></i> ${buttonLabel}
          </button>
        </div>`;
    }).join("");

    previewArea.style.display = "block";
    btn.disabled      = true;
    btn.style.opacity = "0.5";
  });
});

html.querySelectorAll(".sd-save-selected-cancel-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const card        = btn.closest(".sd-save-card");
    const previewArea = card?.querySelector(".sd-save-selected-preview");
    const selBtn      = card?.querySelector(".sd-save-selected-btn");
    if (previewArea) previewArea.style.display = "none";
    if (selBtn)      { selBtn.disabled = false; selBtn.style.opacity = "1"; }
  });
});

html.querySelectorAll(".sd-rollcheck-btn").forEach(btn => {
  btn.addEventListener("click", async () => {
    const card    = btn.closest(".sd-rollcheck-card");
    const msgId   = btn.closest(".chat-message")?.dataset.messageId;
    const chatMsg = msgId ? game.messages.get(msgId) : null;
    if (!card || !chatMsg) return;

    const payload = foundry.utils.deepClone(chatMsg.getFlag("sd", "rollCheck") ?? {});
    if (payload.resolved) return;

    const formula = btn.dataset.sdRcFormula ?? "1d20";
    const cardId  = btn.dataset.sdRc;
    const actor   = payload.actorUuid ? await fromUuid(payload.actorUuid).catch(() => null) : null;
    const r = new Roll(formula, actor?.getRollData?.() ?? {});
    await r.evaluate();
    await r.toMessage({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor:  `${payload.flavor ?? "Check"} (DC ${payload.dc ?? "?"})`,
      rollMode: _sdMsgMode()
    });

    payload.resolved = true;
    payload.total    = r.total;
    payload.rollerId = game.user?.id ?? null;
    payload.rollerName = game.user?.name ?? null;
    if (game.user.isGM) {
      await chatMsg.setFlag("sd", "rollCheck", payload);
    }
    game.socket.emit("system.sd", { type: "rollCheckResult", cardId, total: r.total });
    if (payload.requesterId === game.user?.id) {
      try {
        const ev = new CustomEvent("sd-rollcheck-result", { detail: { cardId, total: r.total } });
        document.dispatchEvent(ev);
      } catch {}
    }
  });
});

{
  const rc = message.getFlag?.("sd", "rollCheck");
  if (rc?.cardId && rc.resolved) {
    html.querySelectorAll(`.sd-rollcheck-card[data-sd-rc-card="${rc.cardId}"]`).forEach(card => {
      const btn = card.querySelector(".sd-rollcheck-btn");
      if (btn) {
        btn.disabled = true;
        btn.style.opacity = "0.5";
        btn.innerHTML = `<i class="fas fa-check"></i> ${rc.rollerName ?? "Rolled"}: ${rc.total}`;
      }
      const status = card.querySelector(".sd-rollcheck-status");
      if (status) status.textContent = `Result: ${rc.total} (DC ${rc.dc})`;
    });
  }
}

html.querySelectorAll(".sd-opposed-btn").forEach(btn => {
  btn.addEventListener("click", async () => {
    const card   = btn.closest(".sd-opposed-card");
    const msgId  = btn.closest(".chat-message")?.dataset.messageId;
    const chatMsg = msgId ? game.messages.get(msgId) : null;
    if (!card || !chatMsg) return;

    const idx     = Number(btn.dataset.sdOpposedIdx ?? 0);
    const formula = btn.dataset.sdOpposedFormula ?? "1d20";
    const payload = foundry.utils.deepClone(chatMsg.getFlag("sd", "opposed") ?? {});
    if (!payload.opponents) payload.opponents = [];
    if (payload.opponents[idx]) return;

    const actor = canvas?.tokens?.controlled?.[0]?.actor ?? game.user.character;
    const r = new Roll(formula, actor?.getRollData?.() ?? {});
    await r.evaluate();
    await r.toMessage({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor:  `${payload.flavor ?? "Check"} — Opponent #${idx+1}`,
      rollMode: _sdMsgMode()
    });
    payload.opponents[idx] = {
      total: r.total,
      actorId: actor?.id ?? null,
      actorName: actor?.name ?? game.user.name
    };
    await chatMsg.setFlag("sd", "opposed", payload);
  });
});

{
  const opp = message.getFlag?.("sd", "opposed");
  if (opp?.cardId) {
    html.querySelectorAll(`.sd-opposed-card[data-sd-opposed-card="${opp.cardId}"]`).forEach(card => {
      card.querySelectorAll(".sd-opposed-btn").forEach(btn => {
        const idx = Number(btn.dataset.sdOpposedIdx ?? 0);
        const entry = opp.opponents?.[idx];
        if (entry) {
          btn.disabled = true;
          btn.style.opacity = "0.4";
          btn.innerHTML = `<i class="fas fa-check"></i> ${entry.actorName ?? "Opp"}: ${entry.total}`;
        }
      });
      const filled = (opp.opponents ?? []).filter(Boolean);
      if (filled.length === opp.oppCount) {
        const maxOpp = Math.max(...filled.map(o => Number(o.total) || 0));
        const initRoll = Number(opp.initiatorRoll) || 0;
        const youWon = initRoll >= maxOpp;
        const status = card.querySelector(".sd-opposed-status");
        if (status) {
          status.innerHTML = youWon
            ? `<strong>${opp.initiatorName}</strong> wins (${initRoll} vs ${maxOpp})`
            : `${opp.initiatorName} loses (${initRoll} vs ${maxOpp})`;
        }
        if (!opp.resolved && opp.userId && opp.userId === game.user?.id) {
          (async () => {
            const branch = youWon ? (opp.wonActions ?? []) : (opp.lostActions ?? []);
            if (branch.length) {
              try {
                const { ButtonExecutor } = await import("./module/helpers/button-executor.mjs");
                const actor = opp.actorUuid ? await fromUuid(opp.actorUuid).catch(() => null) : null;
                const item  = opp.itemUuid  ? await fromUuid(opp.itemUuid).catch(() => null)  : null;
                const winnerRoll = youWon ? initRoll : maxOpp;
                const runtime = { __opposedWinnerRoll: winnerRoll };
                const fakeBtnDef = {
                  label: "Opposed Resolve",
                  __lastRoll: initRoll,
                  __opposedWinnerRoll: winnerRoll,
                  __eventRuntime: runtime
                };
                for (const a of branch) {
                  await ButtonExecutor._runAction(a, item, actor, fakeBtnDef, runtime);
                }
              } catch (e) {
                console.error("SD | opposed dispatch failed:", e);
              }
            }
            const payload = foundry.utils.deepClone(message.getFlag("sd", "opposed") ?? {});
            payload.resolved = true;
            await message.setFlag("sd", "opposed", payload);
          })();
        }
      }
    });
  }
}

{
  const saveResult = message.getFlag?.("sd", "saveResult");
  if (saveResult && typeof saveResult === "object") {
    html.querySelectorAll(".sd-save-card").forEach(card => {
      const dc = Number(card.dataset.saveDc ?? 15);
      card.querySelectorAll(".sd-save-actor-row[data-actor-id]").forEach(actorRow => {
        const aid   = actorRow.dataset.actorId;
        const entry = saveResult[aid];
        if (!entry) return;

        const { total, pass } = entry;
        const passLabel = pass ? "✅ Success" : "❌ Failure";
        const resultBg  = pass ? "#0a2a0a" : "#2a0a0a";
        const resultBdr = pass ? "#1e6030" : "#7a2020";

        const btn = actorRow.querySelector(".sd-save-roll-btn");
        if (btn && !btn.disabled) {
          btn.disabled      = true;
          btn.style.opacity = "0.4";
          btn.style.cursor  = "default";
          btn.innerHTML     = `<i class="fas fa-${pass ? "check" : "times"}-circle"></i> ${total}`;
        }

        if (!actorRow.nextElementSibling?.classList?.contains("sd-save-result")) {
          const resultEl = document.createElement("div");
          resultEl.className = "sd-save-result";
          resultEl.style.cssText = `margin:3px 0 3px 38px;padding:4px 8px;border-radius:4px;
            font-size:11px;font-weight:700;color:#fff;background:${resultBg};border:1px solid ${resultBdr};
            display:flex;align-items:center;gap:6px;`;
          resultEl.innerHTML = `
            <i class="fas fa-${pass ? "check" : "times"}"></i>
            <span style="flex:1">${passLabel}</span>
            <span style="color:#a0a0c0">${total} vs DC ${dc}</span>`;
          actorRow.after(resultEl);
        }
      });
    });
  }
}

try {
  const rrFlag = message.flags?.sd?.reroll ?? null;
  if (rrFlag && rrFlag.enabled && rrFlag.formula) {

    const alreadyHas = html.querySelector?.(".sd-node-reroll-btn");
    if (!alreadyHas) {
      const _rrCostLabel = (rrFlag.costPath && rrFlag.costAmount > 0)
        ? ` (− ${rrFlag.costAmount})`
        : "";
      const _rrTitle = rrFlag.costPath
        ? `Costs ${rrFlag.costAmount} from ${rrFlag.costPath}`
        : "Free re-roll";

      const wrap = document.createElement("div");
      wrap.style.cssText = "margin:4px 0 0;padding:0 4px;";
      wrap.innerHTML = `
        <button type="button" class="sd-node-reroll-btn"
                title="${_rrTitle.replace(/"/g,"&quot;")}"
                style="width:100%;background:#1e1e30;border:1px solid #4a4a6a;
                       border-radius:5px;color:#8080c0;cursor:pointer;
                       font-size:11px;font-weight:600;padding:4px 0;
                       display:flex;align-items:center;justify-content:center;
                       gap:6px;transition:background .12s,color .12s;">
          <i class="fas fa-dice"></i>
          <span>Re-roll${_rrCostLabel}</span>
        </button>`;

      const target = html.querySelector?.(".message-content") ?? html;
      target.appendChild(wrap);

      const btn = wrap.querySelector(".sd-node-reroll-btn");
      btn.addEventListener("click", async () => {
        if (btn.disabled) return;

        const srcActor = rrFlag.srcActorId ? game.actors.get(rrFlag.srcActorId) : null;

        if (rrFlag.costPath && rrFlag.costAmount > 0) {
          if (!srcActor) {
            ui.notifications.warn("SD | Re-roll: source actor not found.");
            return;
          }
          const cur = Number(foundry.utils.getProperty(srcActor, rrFlag.costPath) ?? 0);
          if (cur < rrFlag.costAmount) {
            ui.notifications.warn(
              `SD | Re-roll: not enough resource at ${rrFlag.costPath} ` +
              `(need ${rrFlag.costAmount}, have ${cur}).`
            );
            return;
          }
          if (!srcActor.isOwner && !game.user.isGM) {
            ui.notifications.warn("SD | Re-roll: only the owner can spend the resource.");
            return;
          }
          try {
            await srcActor.update({ [rrFlag.costPath]: cur - rrFlag.costAmount });
          } catch (e) {
            console.error("SD | Re-roll: failed to spend resource", e);
            ui.notifications.error("SD | Re-roll: failed to spend resource.");
            return;
          }
        }

        btn.disabled = true;
        btn.style.opacity = "0.6";
        btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Re-rolling…`;

        try {
          const _rawRollData = srcActor?.getRollData?.() ?? {};
          const _safeRollData = Object.fromEntries(
            Object.entries(_rawRollData).map(([k, v]) =>
              [k, (typeof v === "string" && /^\s*\d*d\d+/i.test(v)) ? 0 : v]
            )
          );
          const newRoll = new Roll(rrFlag.formula, _safeRollData);
          await newRoll.evaluate();

          const _rrLabel = `${rrFlag.label} (re-roll)`;
          await newRoll.toMessage({
            speaker:  ChatMessage.getSpeaker({ actor: srcActor }),
            flavor:   _rrLabel,
            rollMode: _sdMsgMode(),

            flags: { sd: { reroll: { ...rrFlag, label: rrFlag.label } } }
          });
        } catch (e) {
          console.error("SD | Re-roll failed:", e);
          ui.notifications.error("Re-roll failed: " + rrFlag.formula);
        }
      });
    }
  }
} catch (e) {
  console.warn("SD | reroll injection failed:", e);
}

});
