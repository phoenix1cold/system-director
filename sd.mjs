// Imports

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

import { SDActor }       from "./module/documents/actor.mjs";
import { SDItem }        from "./module/documents/item.mjs";

import { CharacterSheet }      from "./module/sheets/character-sheet.mjs";
import { NPCSheet }            from "./module/sheets/npc-sheet.mjs";
import { SDItemSheet }         from "./module/sheets/item-sheet.mjs";

import { runMigrations }       from "./module/helpers/migrations.mjs";
import { EFFECT_PATHS }        from "./module/helpers/effects.mjs";
import { SystemConfig, applySettings, buildActorBaseDefaults } from "./module/helpers/system-config.mjs";
import { installColorSchemeObserver } from "./module/helpers/color-schemes.mjs";
import { Toolbox }             from "./module/builder/toolbox-app.mjs";
import { SDActionHUD, SDActionHUDConfig, registerActionHudSettings, mountActionHudHooks } from "./module/helpers/action-hud.mjs";

// CONFIG Namespace

globalThis.SD = {};

function registerConfig() {
  CONFIG.SD = {

    // Dice
    diceTypes: ["d4", "d6", "d8", "d10", "d12", "d20", "d100"],

    attributes: {
      attr1: "SD.Attributes.attr1",
      attr2: "SD.Attributes.attr2",
      attr3: "SD.Attributes.attr3",
      attr4: "SD.Attributes.attr4",
      attr5: "SD.Attributes.attr5",
      attr6: "SD.Attributes.attr6"
    },

    // Resources
    resources: {
      hp:      "SD.Resources.HP",
      mp:      "SD.Resources.MP",
      stamina: "SD.Resources.Stamina",
      custom1: "SD.Resources.Custom1",
      custom2: "SD.Resources.Custom2"
    },

    // Skills
    skills: Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [`skill${i+1}`, `SD.Skills.skill${i+1}`])
    ),

    // Item Categories
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

    // Rarities
    rarities: {
      common:    "SD.Rarities.common",
      uncommon:  "SD.Rarities.uncommon",
      rare:      "SD.Rarities.rare",
      "very-rare": "SD.Rarities.veryRare",
      legendary: "SD.Rarities.legendary",
      artifact:  "SD.Rarities.artifact",
      unique:    "SD.Rarities.unique"
    },

    // Sizes
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

// Hooks

Hooks.once("init", () => {
  console.log("SD | Initialising system…");

  // Register CONFIG namespace
  registerConfig();

  import("./module/helpers/sd-region.mjs").then(({ SDRegion }) => {
    SDRegion.register();
    globalThis._SD_REGION = SDRegion;
  }).catch(e => console.warn("SD | SDRegion.register() failed:", e));

  CONFIG.Actor.documentClass = SDActor;
  CONFIG.Item.documentClass  = SDItem;

  // Register DataModels
  CONFIG.Actor.dataModels = {
    character: CharacterData,
    npc:       NPCData
  };
  CONFIG.Item.dataModels = {
    inventory: InventoryData,
    ability:   AbilityData,
    feature:   FeatureData,
    class:     ClassData,
    skilltree: SkillTreeData
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
    makeDefault: true,
    label:       "SD.Sheets.Item"
  });

  // System configuration UI button
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
        // Re-prepare all actor data so attr.mod values reflect the new formula.
        for (const a of game.actors ?? []) {
          try { a.reset(); } catch (e) {}
        }
        // Re-render any open SD sheets so widgets pick up the new modifier.
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

  // Builder: sheet templates store
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

  // Register Action HUD settings + menu (must happen during init)
  registerActionHudSettings();

  // Register system settings
  registerSettings();

  // Register Handlebars helpers
  registerHandlebarsHelpers();

  SystemConfig.applyStoredSettings();

  // Install MutationObserver so popouts/dialogs rendered after init still
  // pick up the active color scheme (they mount outside the main body tree).
  installColorSchemeObserver();

  CONFIG.SD.Toolbox = Toolbox;

  console.log("SD | Initialisation complete.");
});

// Default new player-character actors to a linked prototype token so a single
// world Actor is shared across all of its scene tokens. NPCs intentionally
// remain unlinked so duplicates can diverge between encounters.
//
// At creation time we also stamp in the user-configured base attribute /
// resource values from the System Config window. This is a *base value* —
// existing actors are never mutated; only freshly-created actors are seeded.
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
      // Only seed paths that aren't already explicitly carried by the input
      // data (e.g. duplicates / compendium imports). Schema defaults aren't
      // considered "explicit", but anything the user actually typed in the
      // creation dialog or any cloned source value will be present here and
      // is preserved as-is.
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
  }
  const { GridManager }    = await import("./module/builder/grid-manager.mjs");
  const { WidgetRenderer } = await import("./module/builder/widget-renderer.mjs");
  const { FormulaEngine }  = await import("./module/helpers/formula-engine.mjs");
  globalThis._SD_BUILDER = { GridManager, WidgetRenderer };
  globalThis._SD_FE      = { FormulaEngine };

  const { EVENT_BUS } = await import("./module/helpers/event-bus.mjs");
  EVENT_BUS.init();
  globalThis._SD_EVENT_BUS = EVENT_BUS;

  // SD Socket listener
  game.socket.on("system.sd", async (data) => {
    // Player receives a save request
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


// Settings

function registerSettings() {
  game.settings.register("sd", "schemaVersion", {
    name:    "Schema Version",
    scope:   "world",
    config:  false,
    type:    String,
    default: "0.0.0"
  });

  // Initiative formula
  game.settings.register("sd", "initiativeFormula", {
    name:    "SD.Settings.InitiativeFormula",
    hint:    "SD.Settings.InitiativeFormulaHint",
    scope:   "world",
    config:  false,
    type:    String,
    default: "1d20"
  });

  game.settings.register("sd", "useEncumbrance", {
    name:    "SD.Settings.UseEncumbrance",
    hint:    "SD.Settings.UseEncumbranceHint",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: false
  });
}

// Handlebars Helpers

function registerHandlebarsHelpers() {
  Handlebars.registerHelper("signedNumber", n => {
    const num = Number(n);
    return num >= 0 ? `+${num}` : `${num}`;
  });

  // Percentage helper
  Handlebars.registerHelper("percent", (value, max) => {
    if (!max || max <= 0) return 0;
    return Math.round((value / max) * 100);
  });

  // Localise CONFIG key
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

  // Capitalise first letter
  Handlebars.registerHelper("capitalize", s => {
    if (typeof s !== "string") return s;
    return s.charAt(0).toUpperCase() + s.slice(1);
  });

  Handlebars.registerHelper("concat", (...args) => args.slice(0, -1).join(""));

  Handlebars.registerHelper("diceIcon", die => {
    const map = { d4:"d4", d6:"d6", d8:"d8", d10:"dice", d12:"d12", d20:"d20", d100:"dice" };
    return `fas fa-dice-${map[die] ?? "dice"}`;
  });

  // Rarity CSS class
  Handlebars.registerHelper("rarityClass", rarity => `rarity-${rarity}`);

  Handlebars.registerHelper("hiddenFieldPairs", (obj) => {
    if (!obj || typeof obj !== "object") return [];
    return Object.entries(obj).map(([key, value]) => ({ key, value }));
  });

  // concat helper for localize
  Handlebars.registerHelper("concat", (...args) => args.slice(0, -1).join(""));
}

Hooks.once("ready", () => {
  try {
    const formula = game.settings.get("sd", "initiativeFormula");
    if (formula) {
      game.system.initiative = formula;
      CONFIG.Combat.initiative.formula = formula;
    }
  } catch(e) { /* setting may not be available yet */ }

  try { mountActionHudHooks(); } catch(e) { console.warn("SD | mountActionHudHooks failed:", e); }
});

Hooks.on("updateSetting", (setting) => {
  if (setting.key !== "sd.initiativeFormula") return;
  const formula = setting.value;
  if (formula) {
    game.system.initiative = formula;
    CONFIG.Combat.initiative.formula = formula;
  }
});

// When a Cards stack is mutated (shuffle, draw, flip, deal, recall) — re-render
// any actor sheets that show that stack via cardHand / cardDrawButton widgets.
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
      try { app.render(false); } catch (e) { /* ignore individual render failures */ }
    }
  } catch(e) { console.warn("SD | _sdRerenderForCardsStack:", e); }
}
Hooks.on("updateCards", _sdRerenderForCardsStack);
Hooks.on("createCard", (card) => _sdRerenderForCardsStack(card?.parent));
Hooks.on("updateCard", (card) => _sdRerenderForCardsStack(card?.parent));
Hooks.on("deleteCard", (card) => _sdRerenderForCardsStack(card?.parent));

// Chat card interactions
Hooks.on("renderChatMessageHTML", (message, html) => {

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

  // 1. Apply to stored actor-id
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

  // 2b. Cancel preview
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

      // Keep the green "Apply N" button in sync with the chosen multiplier so
      // a follow-up click applies the scaled amount (and matches the label).
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

      // Resolution order for the multiplier auto-apply:
      //   1. live targeted / selected token (matches "→ Selected" semantics)
      //   2. the actor stored on the card (set when the damage node ran with
      //      target=selected_token / token_target / a uuid)
      // This makes the ½/¼/⅛/×2/×4 buttons usable even when the original
      // selection has since been cleared.
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

  // 4. Re-roll button
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

// 6b
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

// 7b
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
      // damage/heal specifics
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
      // bookkeeping
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

// 7c-2 — AoE Targets (no-save). Shares the Place Template UX with the
// save-branch card but doesn't roll anything. After placement we collect
// every token inside the region, snapshot the IDs as `allTargets`, then
// run the post-actions chain (Damage / Heal / Effects, etc.) with the
// preserved runtime so {__lastRoll}/{__lastDice} etc. still resolve.
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

// 7c
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

html.addEventListener("click", async (e) => {
  const btn = e.target.closest(".sd-save-roll-btn");
  if (!btn || btn.disabled) return;

  const card = btn.closest(".sd-save-card");
  if (!card) return;

  const actorId      = btn.dataset.actorId              ?? card.dataset.saveActorId;
  const modifierPath = btn.dataset.saveModifierPath     ?? card.dataset.saveModifierPath;
  const dc           = Number(btn.dataset.saveDc        ?? card.dataset.saveDc    ?? 15);
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

  const saveMod = Number(foundry.utils.getProperty(saveActor, modifierPath) ?? 0);
  const baseFormula = `${rollFormula} + ${saveMod}`;

  // Roll Dialogue (optional)
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
  const passMsg = rollTotal >= dc;
  const modeStr = modeTag ? ` [${modeTag}]` : "";
  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor: saveActor }),
    flavor:  `${flavor}${modeStr} — DC ${dc} — ${passMsg ? "✅ Success" : "❌ Failure"}`,
    rollMode
  });

  const pass      = rollTotal >= dc;
  const passLabel = pass ? "✅ Success" : "❌ Failure";

  // Reroll flag (if save-button card declared reroll opts)
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
      // Attach to last posted message (the one we just created above)
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
      <span style="color:#a0a0c0">${rollTotal} vs DC ${dc}</span>`;
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
  if (message) {
    const msgId   = message.dataset.messageId;
    const chatMsg = game.messages.get(msgId);
    if (chatMsg) {
      const existing = chatMsg.getFlag("sd", "saveResult") ?? {};
      existing[saveActor.id] = { total: rollTotal, pass, actorId: saveActor.id, userId: game.user.id };
      await chatMsg.setFlag("sd", "saveResult", existing);
    }
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

// 9b
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
    if (payload.opponents[idx]) return;            // already rolled

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

// 10
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

        // Disable the roll button
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

// === Generic node reroll button (rollValue / attackCheck / rollCheck / tieredRoll / progression / dicePool / throwOn* / save-button result rolls) ===
try {
  const rrFlag = message.flags?.sd?.reroll ?? null;
  if (rrFlag && rrFlag.enabled && rrFlag.formula) {
    // Avoid double-injecting (e.g. if Foundry re-renders the message)
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

      // Append button INSIDE the message body if possible
      const target = html.querySelector?.(".message-content") ?? html;
      target.appendChild(wrap);

      const btn = wrap.querySelector(".sd-node-reroll-btn");
      btn.addEventListener("click", async () => {
        if (btn.disabled) return;

        const srcActor = rrFlag.srcActorId ? game.actors.get(rrFlag.srcActorId) : null;

        // Cost check / consumption
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

        // Re-roll
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
            // Re-attach the same reroll flag so the new card can also be rerolled
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
