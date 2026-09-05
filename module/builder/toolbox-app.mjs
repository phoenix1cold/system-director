import { BLUEPRINT_NODES, BLUEPRINT_CATS } from "../helpers/formula-engine.mjs";
import { loadSettings } from "../helpers/system-config.mjs";
import { getValueDefinitions } from "../helpers/value-database.mjs";
import { SDOnboarding } from "../helpers/onboarding.mjs";
import { getLanguages, saveLanguages } from "../helpers/localization.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Sheet template payload version.
 *  1/2 - tabs + graphs only (widget values and world dependencies were lost)
 *  3   - full snapshot: widget values, per-widget node data, the unique
 *        data-path registry and the world pieces the sheet depends on.
 */
export const SHEET_TEMPLATE_FORMAT = 3;

/** Read one world setting without throwing when it is not registered. */
function safeSetting(key, fallback) {
  try {
    const value = game.settings.get("sd", key);
    return value === undefined ? fallback : value;
  } catch { return fallback; }
}

export class Toolbox extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id:       "sd-toolbox",

    classes:  ["sd", "sd-toolbox"],
    window: {
      title:       "Sheet Builder",
      icon:        "fas fa-toolbox",
      resizable:   true,
      minimizable: true
    },
    position: { width: 520, height: 780, top: 54, left: 54 }
  };

  static PARTS = {
    body: { template: "systems/sd/templates/builder/toolbox.hbs" }
  };

  static _instance = null;

  static toggle() {
    if (!Toolbox._instance) Toolbox._instance = new Toolbox();
    if (Toolbox._instance.rendered) Toolbox._instance.close();
    else Toolbox._instance.render(true);
  }

  async _prepareContext(options) {
    const base = await super._prepareContext(options);

    const { WIDGET_TYPES: _WR, WIDGET_PALETTE_ORDER } = await import("./widget-registry.mjs");
    const WIDGET_TYPES = WIDGET_PALETTE_ORDER
      .map(id => _WR[id])
      .filter(Boolean)
      .map(w => ({ id: w.id, label: w.label, icon: "fas " + w.icon, desc: w.desc ?? "" }));

    const focusedSheet = this._getFocusedSheet();
    const focusedDoc   = focusedSheet?.document ?? null;
    let knownPaths;
    if (focusedDoc) {
      knownPaths = this._buildDocPaths(focusedDoc);
    } else {
      knownPaths = this._buildSettingsPaths();
    }

    const templates   = Object.values(game.settings.get("sd", "sheetTemplates") ?? {});
    const customFields = game.settings.get("sd", "customFields") ?? [];

    const blueprintSources  = BLUEPRINT_NODES.filter(n => n.cat === "Sources");
    const blueprintDice     = BLUEPRINT_NODES.filter(n => n.cat === "Dice");
    const blueprintMath     = BLUEPRINT_NODES.filter(n => n.cat === "Math");
    const blueprintCompare  = BLUEPRINT_NODES.filter(n => n.cat === "Compare");
    const blueprintLogic    = BLUEPRINT_NODES.filter(n => n.cat === "Logic");

    return {
      ...base,
      focusedSheetName: focusedDoc?.name ?? "No sheet selected",
      focusedSheetType: focusedDoc ? `${focusedDoc.documentName} · ${focusedDoc.type}` : "Open an Actor or Item sheet",
      hasFocusedSheet: !!focusedDoc,
      focusedIsActor: focusedDoc?.documentName === "Actor",
      databaseCount: knownPaths.length,
      widgets: WIDGET_TYPES,
      knownPaths,
      templates,
      customFields,
      blueprintSources,
      blueprintDice,
      blueprintMath,
      blueprintCompare,
      blueprintLogic
    };
  }

  _buildSettingsPaths() {
    return getValueDefinitions().map(value=>({path:value.id,label:`${value.name} · ${value.type} [${value.id}]`}));
  }

  _buildDocPaths(doc) {
    const scope=doc?.documentName==="Item"?"item":"actor";
    return getValueDefinitions().filter(value=>value.scope==="both"||value.scope===scope)
      .map(value=>({path:value.id,label:`${value.name} · ${value.type} [${value.id}]`}));
  }

  _onRender(context, options) {
    this._wireTabBar();
    this._wireDrag();
    this._wireTemplateActions();
    this._wireCustomFields();
    this._wireBlueprintCopy();
    this._wireSearch();
    this.element?.querySelector("[data-action='openEffectApplier']")?.addEventListener("click", async () => {
      const { EffectApplierApp } = await import("../helpers/effect-applier.mjs");
      EffectApplierApp.open();
    });
    this.element?.querySelector("[data-action='refreshPaths']")?.addEventListener("click", () => this.render());
    this.element?.querySelector("[data-action='openSheetGraph']")?.addEventListener("click", async () => {
      const sheet=this._getFocusedSheet();
      if(!sheet?.document)return ui.notifications?.warn?.("Open an Actor or Item sheet first.");
      const {FormulaGraph}=await import("./formula-graph.mjs");
      new FormulaGraph(null,sheet.document,null,null,null,{mode:"sheetTrigger"}).open();
    });
    this.element?.querySelector("[data-action='toggleSheetEdit']")?.addEventListener("click", async () => {
      const sheet=this._getFocusedSheet();
      if(!sheet)return ui.notifications?.warn?.("Open an Actor or Item sheet first.");
      const handler=sheet.constructor?._onToggleEditMode;
      if(typeof handler==="function")await handler.call(sheet,null,null);
      else { sheet._editMode=!sheet._editMode; sheet.render?.(); }
      this.render();
    });
    this.element?.querySelector("[data-action='openDocumentDatabase']")?.addEventListener("click", async () => {
      const sheet=this._getFocusedSheet();
      if(!sheet?.document)return ui.notifications?.warn?.("Open an Actor or Item sheet first.");
      const {openDocumentValueDatabase}=await import("../helpers/value-database.mjs");
      await openDocumentValueDatabase(sheet.document);
    });
    this.element?.querySelector("[data-action='openProgression']")?.addEventListener("click", async () => {
      const sheet=this._getFocusedSheet();
      if(sheet?.document?.documentName!=="Actor")return ui.notifications?.warn?.("Open an Actor sheet first.");
      const {ProgressionApp}=await import("../helpers/progression-app.mjs");
      ProgressionApp.open(sheet.document);
    });
    this.element?.querySelector("[data-action='openInteractions']")?.addEventListener("click", async () => {
      const sheet=this._getFocusedSheet();
      if(sheet?.document?.documentName!=="Actor")return ui.notifications?.warn?.("Open an Actor sheet first.");
      const {openInteractablesEditor}=await import("../helpers/interactables.mjs");
      openInteractablesEditor(sheet.document);
    });
    SDOnboarding.bindToolbox(this.element);
  }

  _wireSearch() {
    const root = this.element;
    if (!root) return;

    const hook = (inputId, clearAction, gridId, emptyId, itemSel, matcher) => {
      const input = root.querySelector(`#${inputId}`);
      const grid  = root.querySelector(`#${gridId}`);
      const empty = emptyId ? root.querySelector(`#${emptyId}`) : null;
      const clear = root.querySelector(`[data-action="${clearAction}"]`);
      if (!input || !grid) return;

      const apply = () => {
        const q = input.value.trim().toLowerCase();
        const items = grid.querySelectorAll(itemSel);
        let shown = 0;
        items.forEach(el => {
          const ok = !q || matcher(el, q);
          el.style.display = ok ? "" : "none";
          if (ok) shown++;
        });
        if (empty) empty.style.display = (items.length && shown === 0) ? "block" : "none";
        if (clear) clear.style.display = q ? "block" : "none";
      };

      input.addEventListener("input", apply);
      input.addEventListener("keydown", ev => {
        if (ev.key === "Escape") { input.value = ""; apply(); input.blur(); }
      });
      clear?.addEventListener("click", () => { input.value = ""; apply(); input.focus(); });
    };

    hook(
      "tb-search-widgets", "clearWidgetSearch",
      "tb-widget-grid", "tb-widget-empty",
      "[data-drag-type='widget']",
      (el, q) => {
        const label = (el.dataset.widgetLabel ?? "").toLowerCase();
        const desc  = (el.dataset.widgetDesc  ?? "").toLowerCase();
        const id    = (el.dataset.widgetType  ?? "").toLowerCase();
        return label.includes(q) || desc.includes(q) || id.includes(q);
      }
    );

    hook(
      "tb-search-paths", "clearPathSearch",
      "tb-path-list", null,
      "[data-drag-type='path']",
      (el, q) => {
        const path  = (el.dataset.path      ?? "").toLowerCase();
        const label = (el.dataset.pathLabel ?? "").toLowerCase();
        return path.includes(q) || label.includes(q);
      }
    );
  }

  _wireTabBar() {
    const root = this.element;
    if (!root) return;

    const tabs = [
      { btnId: "tb-tab-widgets", panelId: "tb-panel-widgets" },
      { btnId: "tb-tab-paths", panelId: "tb-panel-paths" }
    ];
    const activate = (activeId) => {
      tabs.forEach(({btnId,panelId}) => {
        const button=root.querySelector(`#${btnId}`);
        const panel=root.querySelector(`#${panelId}`);
        const active=btnId===activeId;
        button?.classList.toggle("is-active",active);
        button?.setAttribute("aria-pressed",active?"true":"false");
        if(panel){
          panel.style.display=active?"flex":"none";
          if(active)panel.style.flexDirection="column";
        }
      });
    };
    tabs.forEach(({btnId})=>root.querySelector(`#${btnId}`)?.addEventListener("click",()=>activate(btnId)));
    activate(root.querySelector(".sd-builder-mode.is-active")?.id||"tb-tab-widgets");
  }

  _wireDrag() {
    const root = this.element;
    if (!root) return;

    const newTabEl = root.querySelector("[data-drag-type='newTab']");
    if (newTabEl) {
      newTabEl.draggable = true;
      newTabEl.addEventListener("dragstart", ev => {
        ev.dataTransfer.setData("text/plain", JSON.stringify({ sdType: "newTab" }));
        ev.dataTransfer.effectAllowed = "copy";
      });
    }

    root.querySelectorAll("[data-drag-type='widget']").forEach(el => {
      el.draggable = true;
      el.addEventListener("dragstart", ev => {
        ev.dataTransfer.setData("text/plain", JSON.stringify({ sdType:"widget", widgetType: el.dataset.widgetType }));
        ev.dataTransfer.effectAllowed = "copy";
        el.style.opacity = "0.5";
      });
      el.addEventListener("dragend", () => { el.style.opacity = ""; });
    });

    root.querySelectorAll("[data-drag-type='path']").forEach(el => {
      el.draggable = true;
      el.addEventListener("dragstart", ev => {
        ev.dataTransfer.setData("text/plain", JSON.stringify({ sdType:"path", path: el.dataset.path }));
        ev.dataTransfer.effectAllowed = "copy";
        el.style.opacity = "0.5";
      });
      el.addEventListener("dragend", () => { el.style.opacity = ""; });

      el.addEventListener("click", async ev => {
        if (ev.target.closest("button")) return;
        const path = el.dataset.path ?? "";
        if (!path) return;
        try {
          await navigator.clipboard.writeText(path);
          ui.notifications?.info?.(`Path copied: ${path}`);
        } catch (err) {
          const ta = document.createElement("textarea");
          ta.value = path;
          ta.style.position = "fixed";
          ta.style.opacity = "0";
          document.body.appendChild(ta);
          ta.select();
          try { document.execCommand("copy"); ui.notifications?.info?.(`Path copied: ${path}`); }
          catch { ui.notifications?.warn?.("Couldn't copy path to clipboard."); }
          ta.remove();
        }

        const prev = el.style.background;
        el.style.background = "#1a4a2a";
        setTimeout(() => { el.style.background = prev; }, 180);
      });
    });

  }

  _wireTemplateActions() {
    const root = this.element;
    if (!root) return;

    root.querySelector("[data-action='saveTemplate']")?.addEventListener("click", async () => {
      const sheet = this._getFocusedSheet();
      if (!sheet) return ui.notifications.warn("Open a character or item sheet first, then click Save Template.");
      const name = await this._prompt("Template name:", "My Template");
      if (!name) return;
      const doc      = sheet.document;
      const sys      = doc.system ?? {};
      const isActor  = doc instanceof Actor;
      const docType  = isActor ? "Actor" : "Item";
      const itemType = doc.type ?? (isActor ? "character" : "ability");
      const stored = foundry.utils.deepClone(game.settings.get("sd", "sheetTemplates") ?? {});
      const worldSettings = safeSetting("systemSettings", {}) ?? {};
      stored[name] = {
        name,
        docType,
        itemType,
        formatVersion: SHEET_TEMPLATE_FORMAT,
        sdVersion: game.system?.version ?? "",

        customTabs:      foundry.utils.deepClone(sys.customTabs      ?? []),
        sheetStyle:      foundry.utils.deepClone(sys.sheetStyle      ?? {}),

        hiddenFields:    foundry.utils.deepClone(sys.hiddenFields     ?? {}),

        declaredAttrs:   foundry.utils.deepClone(sys.declaredAttrs    ?? []),

        slotDefinitions: foundry.utils.deepClone(sys.slotDefinitions  ?? []),
        sdTriggerGraph:  foundry.utils.deepClone(sys.sdTriggerGraph   ?? {}),
        buttons:         foundry.utils.deepClone(sys.buttons          ?? []),
        onClickGraph:    foundry.utils.deepClone(sys.onClickGraph      ?? {}),
        effectTemplates: foundry.utils.deepClone(sys.effectTemplates   ?? []),

        // Widget-owned values, per-widget node data and the unique data-path
        // registry. Without these a restored sheet shows empty widgets and
        // re-assigns paths, which silently breaks existing graphs.
        widgetVars:         foundry.utils.deepClone(sys.widgetVars ?? {}),
        nodes:              foundry.utils.deepClone(sys.nodes      ?? {}),
        widgetPathRegistry: foundry.utils.deepClone(sys.flags?.__widgetPaths ?? {}),

        // World-level pieces the sheet depends on. Restoring a template into a
        // fresh world used to produce graphs pointing at variables and
        // functions that did not exist there.
        dependencies: {
          database:        foundry.utils.deepClone(worldSettings.database ?? []),
          functionLibrary: foundry.utils.deepClone(safeSetting("functionLibrary", {}) ?? {}),
          nodeTemplates:   foundry.utils.deepClone(safeSetting("nodeTemplates", {}) ?? {}),
          customFields:    foundry.utils.deepClone(safeSetting("customFields", {}) ?? {})
        },

        languages:       foundry.utils.deepClone(getLanguages()),
        effectPresets:   foundry.utils.deepClone(game.settings.get("sd","effectPresets") ?? {}),
        created: Date.now()
      };
      await game.settings.set("sd", "sheetTemplates", stored);
      ui.notifications.info(`Template "${name}" saved.`);
      this.render();
    });

    root.querySelectorAll("[data-action='createFromTemplate']").forEach(btn => {
      btn.addEventListener("click", async () => {
        const name    = btn.dataset.name;
        const stored  = game.settings.get("sd", "sheetTemplates") ?? {};
        const tmpl    = stored[name];
        if (!tmpl) return;

        if (Array.isArray(tmpl.languages)) await saveLanguages(this._mergeLanguages(getLanguages(), tmpl.languages));
        if (tmpl.effectPresets && typeof tmpl.effectPresets === "object") {
          await game.settings.set("sd","effectPresets",{
            ...(game.settings.get("sd","effectPresets") ?? {}),
            ...foundry.utils.deepClone(tmpl.effectPresets)
          });
        }
        const restored = await this._restoreTemplateDependencies(tmpl);

        const docName = await this._prompt(`Name for new ${tmpl.docType ?? "document"}:`, tmpl.name);
        if (!docName) return;

        const freshTabs = this._freshenIds(
          foundry.utils.deepClone(tmpl.customTabs ?? tmpl.tabs ?? [])
        );

        const systemPayload = {
          customTabs:      freshTabs,
          sheetStyle:      foundry.utils.deepClone(tmpl.sheetStyle ?? {}),
          hiddenFields:    foundry.utils.deepClone(tmpl.hiddenFields  ?? {}),
          declaredAttrs:   foundry.utils.deepClone(tmpl.declaredAttrs ?? []),
          slotDefinitions: this._freshenSlotIds(
            foundry.utils.deepClone(tmpl.slotDefinitions ?? [])
          ),
          sdTriggerGraph:  foundry.utils.deepClone(tmpl.sdTriggerGraph ?? {}),
        };

        // Widget values keep the sheet showing real numbers instead of blanks.
        // They are keyed by Widget Key, which `_freshenIds` deliberately keeps
        // stable, so they survive the id refresh above.
        if (tmpl.widgetVars && typeof tmpl.widgetVars === "object") {
          systemPayload.widgetVars = foundry.utils.deepClone(tmpl.widgetVars);
        }
        if (tmpl.nodes && typeof tmpl.nodes === "object") {
          systemPayload.nodes = foundry.utils.deepClone(tmpl.nodes);
        }
        if (tmpl.widgetPathRegistry && typeof tmpl.widgetPathRegistry === "object") {
          systemPayload.flags = {
            ...(systemPayload.flags ?? {}),
            __widgetPaths: foundry.utils.deepClone(tmpl.widgetPathRegistry)
          };
        }

        if (tmpl.docType !== "Actor") {
          systemPayload.buttons         = foundry.utils.deepClone(tmpl.buttons          ?? []);
          systemPayload.onClickGraph    = foundry.utils.deepClone(tmpl.onClickGraph      ?? {});
          systemPayload.effectTemplates = foundry.utils.deepClone(tmpl.effectTemplates   ?? []);
        }

        if (tmpl.docType === "Actor") {
          const created = await Actor.create({
            name:   docName,
            type:   tmpl.itemType ?? "character",
            system: systemPayload
          });
          created?.sheet?.render(true);
          ui.notifications.info(`Actor "${docName}" created from template.${restored.summary}`);
        } else {
          const created = await Item.create({
            name:   docName,
            type:   tmpl.itemType ?? "ability",
            system: systemPayload
          });
          created?.sheet?.render(true);
          ui.notifications.info(`Item "${docName}" created from template.${restored.summary}`);
        }
        if (restored.warnings.length) ui.notifications.warn(restored.warnings.join(" "));
      });
    });

    root.querySelectorAll("[data-action='deleteTemplate']").forEach(btn => {
      btn.addEventListener("click", async () => {
        const name   = btn.dataset.name;
        const stored = foundry.utils.deepClone(game.settings.get("sd", "sheetTemplates") ?? {});
        delete stored[name];
        await game.settings.set("sd", "sheetTemplates", stored);
        this.render();
      });
    });

    root.querySelectorAll("[data-action='exportTemplate']").forEach(btn => {
      btn.addEventListener("click", () => {
        const name   = btn.dataset.name;
        const stored = game.settings.get("sd", "sheetTemplates") ?? {};
        const tmpl   = stored[name];
        if (!tmpl) return ui.notifications.warn(`Template "${name}" not found.`);
        const payload = { sdSheetTemplate: SHEET_TEMPLATE_FORMAT, localizationSchema:1, ...foundry.utils.deepClone(tmpl), languages:getLanguages(), effectPresets:game.settings.get("sd","effectPresets")??{} };
        Toolbox._downloadJSON(payload, `${name}.sheet-template.json`);
      });
    });

    root.querySelector("[data-action='exportAllTemplates']")?.addEventListener("click", () => {
      const stored = foundry.utils.deepClone(game.settings.get("sd", "sheetTemplates") ?? {});
      const names  = Object.keys(stored);
      if (!names.length) return ui.notifications.warn("No templates to export.");
      const payload = { sdSheetTemplateBundle: SHEET_TEMPLATE_FORMAT, localizationSchema:1, templates: stored, languages:getLanguages(), effectPresets:game.settings.get("sd","effectPresets")??{}, exported: Date.now() };
      Toolbox._downloadJSON(payload, `sd-sheet-templates.json`);
    });

    root.querySelector("[data-action='importTemplates']")?.addEventListener("click", () => {
      const inp = document.createElement("input");
      inp.type = "file";
      inp.accept = "application/json,.json";
      inp.addEventListener("change", async () => {
        const file = inp.files?.[0];
        if (!file) return;
        let parsed;
        try { parsed = JSON.parse(await file.text()); }
        catch { return ui.notifications.error("Invalid JSON file."); }
        await this._importSheetTemplates(parsed);
      });
      inp.click();
    });
  }

  /**
   * Backfill the world-level pieces a sheet template depends on (Database
   * variables, saved functions, node templates, custom field groups).
   *
   * Entries that already exist in this world always win - importing a template
   * must never silently overwrite something the GM authored.
   *
   * @param {object} tmpl Stored template payload.
   * @returns {Promise<{added:object, warnings:string[], summary:string}>}
   */
  async _restoreTemplateDependencies(tmpl) {
    const added = { variables: 0, functions: 0, nodeTemplates: 0, customFields: 0 };
    const warnings = [];
    const deps = tmpl?.dependencies;

    if (!deps || typeof deps !== "object") {
      if (Number(tmpl?.formatVersion ?? 0) < SHEET_TEMPLATE_FORMAT) {
        warnings.push("This template was saved by an older version: Database variables and functions it relies on are not included, so some nodes may point at missing values.");
      }
      return { added, warnings, summary: "" };
    }

    // Database variables live inside the systemSettings blob.
    if (Array.isArray(deps.database) && deps.database.length) {
      const settings = foundry.utils.deepClone(safeSetting("systemSettings", {}) ?? {});
      const list = Array.isArray(settings.database) ? settings.database : [];
      const have = new Set(list.map(def => String(def?.id ?? "")));
      let changed = 0;
      for (const def of deps.database) {
        const id = String(def?.id ?? "").trim();
        if (!id || have.has(id)) continue;
        list.push(foundry.utils.deepClone(def));
        have.add(id);
        changed++;
      }
      if (changed) {
        settings.database = list;
        try {
          await game.settings.set("sd", "systemSettings", settings);
          added.variables = changed;
        } catch (err) {
          console.warn("SD | template dependencies: database restore failed", err);
          warnings.push("Database variables from the template could not be restored.");
        }
      }
    }

    // Object-keyed or array settings: add what is missing, keep what is local.
    const mergeSetting = async (key, source, counter) => {
      if (!source) return;
      const local = foundry.utils.deepClone(safeSetting(key, Array.isArray(source) ? [] : {}));
      let changed = 0;
      if (Array.isArray(source)) {
        if (!Array.isArray(local)) return;
        const idOf = entry => String(entry?.id ?? entry?.key ?? entry?.name ?? "");
        const have = new Set(local.map(idOf).filter(Boolean));
        for (const entry of source) {
          const id = idOf(entry);
          if (!id || have.has(id)) continue;
          local.push(foundry.utils.deepClone(entry));
          have.add(id);
          changed++;
        }
      } else if (typeof source === "object") {
        if (!local || typeof local !== "object" || Array.isArray(local)) return;
        for (const [name, value] of Object.entries(source)) {
          if (name in local) continue;
          local[name] = foundry.utils.deepClone(value);
          changed++;
        }
      } else return;
      if (!changed) return;
      try {
        await game.settings.set("sd", key, local);
        added[counter] = changed;
      } catch (err) {
        console.warn(`SD | template dependencies: ${key} restore failed`, err);
      }
    };

    await mergeSetting("functionLibrary", deps.functionLibrary, "functions");
    await mergeSetting("nodeTemplates",   deps.nodeTemplates,   "nodeTemplates");
    await mergeSetting("customFields",    deps.customFields,    "customFields");

    const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
    const parts = [];
    if (added.variables)     parts.push(plural(added.variables, "database variable"));
    if (added.functions)     parts.push(plural(added.functions, "saved function"));
    if (added.nodeTemplates) parts.push(plural(added.nodeTemplates, "node template"));
    if (added.customFields)  parts.push(plural(added.customFields, "custom field group"));
    return { added, warnings, summary: parts.length ? ` Also restored ${parts.join(", ")}.` : "" };
  }

  async _importSheetTemplates(parsed) {
    if (Array.isArray(parsed?.languages)) await saveLanguages(this._mergeLanguages(getLanguages(), parsed.languages));
    if (parsed?.effectPresets && typeof parsed.effectPresets === "object") {
      await game.settings.set("sd","effectPresets",{...(game.settings.get("sd","effectPresets")??{}),...foundry.utils.deepClone(parsed.effectPresets)});
    }
    let incoming = {};
    if (parsed?.templates && typeof parsed.templates === "object") {
      incoming = parsed.templates;
    } else if (parsed?.name && (parsed.customTabs || parsed.tabs || parsed.docType)) {
      incoming[parsed.name] = parsed;
    } else {
      return ui.notifications.error("JSON does not contain any sheet templates.");
    }

    const stored = foundry.utils.deepClone(game.settings.get("sd", "sheetTemplates") ?? {});
    const conflicts = Object.keys(incoming).filter(k => stored[k]);
    let mode = "keep";
    if (conflicts.length) {
      mode = await foundry.applications.api.DialogV2.wait({
        window: { title: "Import sheet templates" },
        modal: true,
        content: `<p style="margin:4px 0 10px">${conflicts.length} template name${conflicts.length===1?"":"s"} already exist${conflicts.length===1?"s":""}:</p>
                  <ul style="margin:0 0 10px 16px;padding:0;max-height:140px;overflow:auto;font-size:11px">${conflicts.map(n=>`<li>${foundry.utils.escapeHTML(n)}</li>`).join("")}</ul>
                  <p style="margin:0 0 4px">How should conflicts be handled?</p>`,
        buttons: [
          { action: "overwrite", label: "Overwrite",       default: true },
          { action: "keep",      label: "Keep both (rename imported)" },
          { action: "skip",      label: "Skip conflicting" },
          { action: "cancel",    label: "Cancel" }
        ],
        rejectClose: false
      }).catch(() => "cancel");
      if (!mode || mode === "cancel") return;
    }

    let added = 0, skipped = 0, renamed = 0, overwritten = 0;
    for (const [rawName, tpl] of Object.entries(incoming)) {
      if (!tpl) continue;
      const clean = foundry.utils.deepClone(tpl);
      delete clean.sdSheetTemplate;
      delete clean.sdSheetTemplateBundle;
      clean.name = clean.name ?? rawName;

      let targetName = clean.name;
      if (stored[targetName]) {
        if (mode === "skip") { skipped++; continue; }
        if (mode === "keep") {
          let i = 2;
          while (stored[`${clean.name} (${i})`]) i++;
          targetName = `${clean.name} (${i})`;
          clean.name = targetName;
          renamed++;
        }
        if (mode === "overwrite") overwritten++;
      } else {
        added++;
      }
      stored[targetName] = clean;
    }
    await game.settings.set("sd", "sheetTemplates", stored);
    ui.notifications.info(`Imported templates — added: ${added}, overwritten: ${overwritten}, renamed: ${renamed}, skipped: ${skipped}.`);
    this.render();
  }

  _mergeLanguages(current, incoming) {
    const map=new Map((current??[]).map(l=>[l.id,{...l}]));
    for(const l of (incoming??[])) if(l?.id) map.set(l.id,{...(map.get(l.id)??{}),...l});
    return [...map.values()];
  }

  static _downloadJSON(obj, filename = "export.json") {
    const json = JSON.stringify(obj, null, 2);
    try {
      if (typeof saveDataToFile === "function") {
        saveDataToFile(json, "application/json", filename);
        return;
      }
    } catch {}
    const blob = new Blob([json], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  _wireCustomFields() {
    const root = this.element;
    if (!root) return;

    root.querySelector("[data-action='addCustomField']")?.addEventListener("click", async () => {
      const fields = foundry.utils.deepClone(game.settings.get("sd", "customFields") ?? []);
      const name   = await this._prompt("Field name (no spaces):", `field_${fields.length + 1}`);
      if (!name) return;
      fields.push({ name: name.replace(/\s+/g, "_"), type: "string" });
      await game.settings.set("sd", "customFields", fields);
      ui.notifications.info(`Custom field "${name}" added. Path: system.flags.${name}`);
      this.render();
    });

    root.querySelectorAll("[data-action='removeCustomField']").forEach(btn => {
      btn.addEventListener("click", async () => {
        const idx    = parseInt(btn.dataset.index);
        const fields = foundry.utils.deepClone(game.settings.get("sd", "customFields") ?? []);
        fields.splice(idx, 1);
        await game.settings.set("sd", "customFields", fields);
        this.render();
      });
    });
  }

  _wireBlueprintCopy() {
    const root = this.element;
    if (!root) return;
    root.querySelectorAll("[data-blueprint-copy]").forEach(el => {
      el.addEventListener("click", () => {
        const text = el.dataset.blueprintCopy ?? el.dataset.syntax ?? el.textContent.trim();
        navigator.clipboard?.writeText(text).then(() => {
          ui.notifications.info("Copied to clipboard.");
        }).catch(() => {
          ui.notifications.warn("Could not copy to clipboard.");
        });
      });
    });
  }

  _getFocusedSheet() {
    const apps=[...Object.values(ui.windows??{})];
    const instances=foundry.applications?.instances;
    if(instances?.values)apps.push(...instances.values());
    else if(instances&&typeof instances==="object")apps.push(...Object.values(instances));
    return [...new Set(apps)]
      .filter(w=>w!==this&&w?.rendered!==false&&(w.document instanceof Actor||w.document instanceof Item))
      .sort((a,b)=>(b.position?.zIndex??b._renderTime??0)-(a.position?.zIndex??a._renderTime??0))[0]??null;
  }

  _freshenIds(tabs) {
    return (tabs ?? []).map(tab => ({
      ...tab,
      id:   foundry.utils.randomID(8),
      rows: (tab.rows ?? []).map(row => ({
        ...row,
        id:      foundry.utils.randomID(8),
        widgets: (row.widgets ?? []).map(w => ({ ...w, id: foundry.utils.randomID(8) }))
      }))
    }));
  }

  _freshenSlotIds(slotDefs) {
    return (slotDefs ?? []).map(def => ({ ...def, id: foundry.utils.randomID(8) }));
  }

  async _prompt(label, defaultValue = "") {
    const result = await foundry.applications.api.DialogV2.wait({
      window: { title: "Sheet Builder" },
      modal: true,
      content: `<div style="padding:8px 0">
        <label style="font-size:12px;color:#888">${label}</label>
        <input type="text" name="val" value="${defaultValue}"
          style="width:100%;margin-top:4px;background:#2a2a38;border:1px solid #3a3a52;color:#e0e0ee;border-radius:4px;padding:4px 8px;font-size:13px;box-sizing:border-box">
      </div>`,
      buttons: [
        {
          action: "ok",
          label: "OK",
          icon: "fas fa-check",
          default: true,
          callback: (event, button, dialog) => {
            const root = dialog?.element ?? dialog;
            const v = root?.querySelector?.("input[name='val']")?.value?.trim();
            return { __sdOk: true, __sdValue: v && v.length ? v : null };
          }
        },
        {
          action: "cancel", label: "Cancel",
          callback: () => ({ __sdOk: false, __sdValue: null })
        }
      ],
      rejectClose: false
    }).catch(() => ({ __sdOk: false, __sdValue: null }));

    if (!result || typeof result !== "object" || !result.__sdOk) return null;
    const v = result.__sdValue;
    return (typeof v === "string" && v.length) ? v : null;
  }
}
