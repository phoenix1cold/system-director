import { KNOWN_PATHS } from "./widget-registry.mjs";
import { BLUEPRINT_NODES, BLUEPRINT_CATS } from "../helpers/formula-engine.mjs";
import { loadSettings } from "../helpers/system-config.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

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
    position: { width: 300, height: 620, top: 80, left: 80 }
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
    const paths = [];
    const _add = (path, label) => { if (!paths.find(p => p.path === path)) paths.push({ path, label }); };

    try {
      const cfg = loadSettings();

      for (const [key, label] of Object.entries(cfg.attributes ?? {})) {
        if (cfg.attributesEnabled?.[key] === false) continue;
        _add(`system.attributes.${key}.value`, `${label} — Score`);
        _add(`system.attributes.${key}.mod`,   `${label} — Modifier`);
      }

      for (const [key, res] of Object.entries(cfg.resources ?? {})) {
        if (res.enabled === false) continue;
        const lbl = res.label ?? key;
        _add(`system.resources.${key}.value`, `${lbl} — Current`);
        _add(`system.resources.${key}.max`,   `${lbl} — Max`);
      }

      for (const c of (cfg.currencies ?? [])) {
        if (!c?.key) continue;
        const lbl = c.label && String(c.label).trim() ? c.label : c.key;
        _add(`system.currency.${c.key}`, `Currency — ${lbl}`);
      }
    } catch {}

    _add("system.advancement.level",        "Level");
    _add("system.advancement.xp.value",     "XP — Current");
    _add("system.advancement.xp.max",       "XP — Max");
    _add("system.defense.total",            "Defense — Total");
    _add("system.defense.armor",            "Defense — Armor");
    _add("system.initiative.total",         "Initiative — Total");
    _add("system.initiative.bonus",         "Initiative — Bonus");
    _add("system.movement.walk",            "Movement — Walk");
    _add("system.movement.fly",             "Movement — Fly");

    try {
      for (const cf of (game.settings.get("sd", "customFields") ?? [])) {
        _add(`system.flags.${cf.name}`, `Custom: ${cf.name}`);
      }
    } catch {}

    return paths;
  }

  _buildDocPaths(doc) {
    const paths = [];
    const isActor = doc instanceof Actor;
    const cfg = (() => { try { return loadSettings(); } catch { return null; } })();

    const _add = (path, label) => { if (!paths.find(p => p.path === path)) paths.push({ path, label }); };

    if (isActor) {
      const sys = doc.system ?? {};
      for (const [key, attr] of Object.entries(sys.attributes ?? {})) {
        const cfgLabel = cfg?.attributes?.[key] ?? key;
        if (attr?.value !== undefined) _add(`system.attributes.${key}.value`, `${cfgLabel} — Score`);
        if (attr?.mod   !== undefined) _add(`system.attributes.${key}.mod`,   `${cfgLabel} — Modifier`);
      }
      for (const [key, res] of Object.entries(sys.resources ?? {})) {
        const cfgLabel = cfg?.resources?.[key]?.label ?? key.toUpperCase();
        if (res?.value !== undefined) _add(`system.resources.${key}.value`, `${cfgLabel} — Current`);
        if (res?.max   !== undefined) _add(`system.resources.${key}.max`,   `${cfgLabel} — Max`);
      }
      const _seenCur = new Set();
      for (const [key, val] of Object.entries(sys.currency ?? {})) {
        if (val === null || typeof val === "object") continue;
        const cfgLabel = (cfg?.currencies ?? []).find(c => c.key === key)?.label;
        const lbl = cfgLabel && String(cfgLabel).trim() ? cfgLabel : key;
        _add(`system.currency.${key}`, `Currency — ${lbl}`);
        _seenCur.add(key);
      }
      for (const c of (cfg?.currencies ?? [])) {
        if (!c?.key || _seenCur.has(c.key)) continue;
        const lbl = c.label && String(c.label).trim() ? c.label : c.key;
        _add(`system.currency.${c.key}`, `Currency — ${lbl}`);
      }

      if (sys.advancement?.level !== undefined) _add("system.advancement.level", "Level");
      if (sys.advancement?.xp?.value !== undefined) _add("system.advancement.xp.value", "XP — Current");
      if (sys.advancement?.xp?.max   !== undefined) _add("system.advancement.xp.max",   "XP — Max");
      if (sys.defense?.total    !== undefined) _add("system.defense.total",       "Defense — Total");
      if (sys.defense?.armor    !== undefined) _add("system.defense.armor",       "Defense — Armor");
      if (sys.initiative?.total !== undefined) _add("system.initiative.total",    "Initiative — Total");
      if (sys.initiative?.bonus !== undefined) _add("system.initiative.bonus",    "Initiative — Bonus");
      if (sys.movement?.walk    !== undefined) _add("system.movement.walk",       "Movement — Walk");
      if (sys.movement?.fly     !== undefined) _add("system.movement.fly",        "Movement — Fly");
    }

    for (const [k] of Object.entries(doc.system?.hiddenFields ?? {})) {
      _add(`system.hiddenFields.${k}`, `Hidden: ${k}`);
    }

    for (const a of (doc.system?.declaredAttrs ?? [])) {
      if (a.path) _add(a.path, `Attr: ${a.name || a.id}`);
    }

    for (const def of (doc.system?.slotDefinitions ?? [])) {
      _add(`system.slotContents.${def.id}.count`, `Slot count: ${def.label}`);
    }

    if (isActor) {
      for (const item of (doc.items ?? [])) {
        for (const [k] of Object.entries(item.system?.hiddenFields ?? {})) {
          _add(`system.hiddenFields.${k}`, `${item.name}: hidden.${k}`);
        }
        for (const a of (item.system?.declaredAttrs ?? [])) {
          if (a.path) _add(a.path, `${item.name}: ${a.name || a.id}`);
        }
        for (const def of (item.system?.slotDefinitions ?? [])) {
          _add(`system.slotContents.${def.id}.count`, `${item.name}: slot '${def.label}'`);
        }
      }
    }

    try {
      for (const cf of (game.settings.get("sd", "customFields") ?? [])) {
        _add(`system.flags.${cf.name}`, `Custom: ${cf.name}`);
      }
    } catch {}

    return paths;
  }

  _onRender(context, options) {
    this._wireTabBar();
    this._wireDrag();
    this._wireTemplateActions();
    this._wireCustomFields();
    this._wireBlueprintCopy();
    this._wireSearch();
    this.element?.querySelector("[data-action='refreshPaths']")?.addEventListener("click", () => this.render());
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
      { btnId: "tb-tab-widgets",    panelId: "tb-panel-widgets" },
      { btnId: "tb-tab-paths",      panelId: "tb-panel-paths" }
    ];

    tabs.forEach(({ btnId, panelId }) => {
      const btn   = root.querySelector(`#${btnId}`);
      const panel = root.querySelector(`#${panelId}`);
      if (!btn || !panel) return;

      btn.addEventListener("click", () => {

        tabs.forEach(t => {
          const b = root.querySelector(`#${t.btnId}`);
          const p = root.querySelector(`#${t.panelId}`);
          if (b) { b.style.background="#13131d"; b.style.color="#555"; b.style.borderBottom="2px solid transparent"; }
          if (p) p.style.display = "none";
        });

        btn.style.background   = "#1a1a24";
        btn.style.color        = "#7b68ee";
        btn.style.borderBottom = "2px solid #7b68ee";
        panel.style.display    = "flex";
        panel.style.flexDirection = "column";
      });
    });
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
      stored[name] = {
        name,
        docType,
        itemType,

        customTabs:      foundry.utils.deepClone(sys.customTabs      ?? []),

        hiddenFields:    foundry.utils.deepClone(sys.hiddenFields     ?? {}),

        declaredAttrs:   foundry.utils.deepClone(sys.declaredAttrs    ?? []),

        slotDefinitions: foundry.utils.deepClone(sys.slotDefinitions  ?? []),
        sdTriggerGraph:  foundry.utils.deepClone(sys.sdTriggerGraph   ?? {}),
        buttons:         foundry.utils.deepClone(sys.buttons          ?? []),
        onClickGraph:    foundry.utils.deepClone(sys.onClickGraph      ?? {}),
        effectTemplates: foundry.utils.deepClone(sys.effectTemplates   ?? []),
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

        const docName = await this._prompt(`Name for new ${tmpl.docType ?? "document"}:`, tmpl.name);
        if (!docName) return;

        const freshTabs = this._freshenIds(
          foundry.utils.deepClone(tmpl.customTabs ?? tmpl.tabs ?? [])
        );

        const systemPayload = {
          customTabs:      freshTabs,
          hiddenFields:    foundry.utils.deepClone(tmpl.hiddenFields  ?? {}),
          declaredAttrs:   foundry.utils.deepClone(tmpl.declaredAttrs ?? []),
          slotDefinitions: this._freshenSlotIds(
            foundry.utils.deepClone(tmpl.slotDefinitions ?? [])
          ),
          sdTriggerGraph:  foundry.utils.deepClone(tmpl.sdTriggerGraph ?? {}),
        };

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
          ui.notifications.info(`Actor "${docName}" created from template.`);
        } else {
          const created = await Item.create({
            name:   docName,
            type:   tmpl.itemType ?? "ability",
            system: systemPayload
          });
          created?.sheet?.render(true);
          ui.notifications.info(`Item "${docName}" created from template.`);
        }
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
        const payload = { sdSheetTemplate: 1, ...foundry.utils.deepClone(tmpl) };
        Toolbox._downloadJSON(payload, `${name}.sheet-template.json`);
      });
    });

    root.querySelector("[data-action='exportAllTemplates']")?.addEventListener("click", () => {
      const stored = foundry.utils.deepClone(game.settings.get("sd", "sheetTemplates") ?? {});
      const names  = Object.keys(stored);
      if (!names.length) return ui.notifications.warn("No templates to export.");
      const payload = { sdSheetTemplateBundle: 1, templates: stored, exported: Date.now() };
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

  async _importSheetTemplates(parsed) {
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
    return Object.values(ui.windows ?? {})
      .filter(w => w.document instanceof Actor || w.document instanceof Item)
      .sort((a, b) => (b._renderTime ?? 0) - (a._renderTime ?? 0))[0] ?? null;
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
