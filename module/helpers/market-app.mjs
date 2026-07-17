/**
 * SD Community Market
 * Browse, install and share user-created SD systems.
 * The catalog is a static index.json hosted on GitHub Pages / raw.githubusercontent
 * (see docs/MARKET-REGISTRY.md for the registry repo setup).
 */

const { ApplicationV2, DialogV2 } = foundry.applications.api;

const loc = (k) => game.i18n.localize(k);
const fmt = (k, data = {}, fallback = "") => {
  let str = loc(k);
  if (str === k && fallback) str = fallback;
  for (const [key, v] of Object.entries(data)) str = str.replaceAll(`{${key}}`, String(v));
  return str;
};
const esc = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** World-scoped settings that make up an exportable "system package". */
const PACKAGE_SETTING_KEYS = [
  "systemSettings",
  "sheetTemplates",
  "customFields",
  "nodeTemplates",
  "functionLibrary",
  "initiativeFormula",
  "initiativeUseGraph",
  "initiativeGraph",
  "initiativeGraphCompiled",
  "useEncumbrance"
];

export class SDMarketApp extends ApplicationV2 {

  static DEFAULT_OPTIONS = {
    id: "sd-market",
    classes: ["sd", "sd-market"],
    window: {
      title:     "SD.Market.Title",
      icon:      "fas fa-store",
      resizable: true
    },
    position: { width: 860, height: 640 }
  };

  constructor(options = {}) {
    super(options);
    this._index   = null;
    this._error   = null;
    this._loading = false;
    this._query   = "";
  }

  get title() { return loc("SD.Market.Title"); }

  /* ------------------------------ data ------------------------------ */

  /** Derive the registry GitHub repo URL from the configured registry URL. */
  _registryRepoUrl() {
    try {
      const url = new URL(String(game.settings.get("sd", "marketRegistryUrl") ?? ""));
      if (url.hostname === "raw.githubusercontent.com") {
        const [owner, repo] = url.pathname.split("/").filter(Boolean);
        if (owner && repo) return `https://github.com/${owner}/${repo}`;
      }
      if (url.hostname.endsWith(".github.io")) {
        const owner = url.hostname.split(".")[0];
        const repo  = url.pathname.split("/").filter(Boolean)[0];
        if (owner && repo) return `https://github.com/${owner}/${repo}`;
      }
    } catch {}
    return null;
  }

  async _loadIndex() {
    let url = "";
    try { url = game.settings.get("sd", "marketRegistryUrl") ?? ""; } catch {}
    url = String(url).trim();
    if (!url) { this._error = "noRegistry"; this._index = null; this.render(); return; }

    this._loading = true;
    this._error   = null;
    this.render();
    try {
      const bust = url.includes("?") ? "&t=" : "?t=";
      const res  = await fetch(url + bust + Date.now(), { cache: "no-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data  = await res.json();
      this._index = Array.isArray(data?.systems) ? data.systems : [];
    } catch (err) {
      console.error("SD | Market: failed to load catalog", err);
      this._error = "load";
      this._index = null;
    } finally {
      this._loading = false;
      this.render();
    }
  }

  /* ----------------------------- render ----------------------------- */

  async _renderHTML() {
    let html = `<div class="sd-market-app">`;

    html += `<div class="sd-market-toolbar">
      <div class="sd-market-search">
        <i class="fas fa-search"></i>
        <input type="text" value="${esc(this._query)}" placeholder="${esc(loc("SD.Market.SearchPlaceholder"))}" data-action="search">
      </div>
      <button type="button" class="sd-market-btn" data-action="refresh" title="${esc(loc("SD.Market.Refresh"))}"><i class="fas fa-rotate"></i></button>
      <button type="button" class="sd-market-btn" data-action="export"><i class="fas fa-file-export"></i> ${loc("SD.Market.ExportBtn")}</button>
      ${this._registryRepoUrl() ? `<button type="button" class="sd-market-btn" data-action="publish" title="${esc(loc("SD.Market.PublishHint"))}"><i class="fab fa-github"></i> ${loc("SD.Market.PublishBtn")}</button>` : ""}
    </div>`;

    html += `<div class="sd-market-body">`;
    if (this._loading || (this._index === null && !this._error)) {
      html += `<div class="sd-market-msg"><i class="fas fa-spinner fa-spin"></i></div>`;
    } else if (this._error === "noRegistry") {
      html += `<div class="sd-market-msg"><i class="fas fa-plug-circle-xmark"></i><br>${loc("SD.Market.NoRegistry")}</div>`;
    } else if (this._error) {
      html += `<div class="sd-market-msg"><i class="fas fa-triangle-exclamation"></i><br>${loc("SD.Market.LoadError")}</div>`;
    } else {
      html += this._buildCards();
    }
    html += `</div></div>`;
    return html;
  }

  _buildCards() {
    const q  = this._query.trim().toLowerCase();
    let list = this._index ?? [];
    if (q) {
      list = list.filter(s =>
        [s.name, s.author, s.description, ...(Array.isArray(s.tags) ? s.tags : [])]
          .join(" ").toLowerCase().includes(q)
      );
    }
    if (!list.length) return `<div class="sd-market-msg">${loc("SD.Market.Empty")}</div>`;

    let html = `<div class="sd-market-grid">`;
    for (const s of list) {
      const idx = this._index.indexOf(s);
      html += `<div class="sd-market-card">
        <div class="sd-market-card-hdr">
          ${s.icon
            ? `<img class="sd-market-card-icon" src="${esc(s.icon)}" alt="">`
            : `<span class="sd-market-card-icon is-ph"><i class="fas fa-dice-d20"></i></span>`}
          <div class="sd-market-card-titles">
            <div class="sd-market-card-name">${esc(s.name ?? "?")}</div>
            <div class="sd-market-card-author">${esc(s.author ?? "")}${s.version ? ` \u00b7 v${esc(s.version)}` : ""}</div>
          </div>
          <div class="sd-market-card-stats" title="${esc(loc("SD.Market.LikeHint"))}">
            <span><i class="fas fa-star"></i> ${Number(s.stars ?? 0)}</span>
            <span><i class="fas fa-download"></i> ${Number(s.downloads ?? 0)}</span>
          </div>
        </div>
        <div class="sd-market-card-desc">${esc(s.description ?? "")}</div>
        ${Array.isArray(s.tags) && s.tags.length
          ? `<div class="sd-market-card-tags">${s.tags.map(t => `<span>${esc(t)}</span>`).join("")}</div>`
          : ""}
        <div class="sd-market-card-actions">
          <button type="button" class="sd-market-btn primary" data-action="install" data-idx="${idx}"><i class="fas fa-download"></i> ${loc("SD.Market.Install")}</button>
          ${s.rulebook ? `<a class="sd-market-btn" href="${esc(s.rulebook)}" target="_blank" rel="noopener"><i class="fas fa-book"></i> ${loc("SD.Market.Rulebook")}</a>` : ""}
          ${s.repo ? `<a class="sd-market-btn" href="${esc(s.repo)}" target="_blank" rel="noopener" title="${esc(loc("SD.Market.LikeHint"))}"><i class="fab fa-github"></i> <i class="fas fa-star"></i></a>` : ""}
        </div>
      </div>`;
    }
    html += `</div>`;
    return html;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
  }

  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    this._loadIndex();
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const root = this.element;
    if (!root) return;
    root.querySelectorAll("[data-action]").forEach(el => {
      if (el.dataset.action === "search") {
        el.addEventListener("input", ev => {
          this._query = ev.currentTarget.value;
          this._refreshCardsOnly();
        });
      } else {
        el.addEventListener("click", ev => this._handleAction(ev));
      }
    });
  }

  _refreshCardsOnly() {
    if (this._loading || this._error || !this.element) return;
    const body = this.element.querySelector(".sd-market-body");
    if (!body) return;
    body.innerHTML = this._buildCards();
    body.querySelectorAll("[data-action='install']").forEach(el =>
      el.addEventListener("click", ev => this._handleAction(ev))
    );
  }

  /* ----------------------------- actions ---------------------------- */

  async _handleAction(ev) {
    const action = ev.currentTarget.dataset.action;
    if (action === "refresh") return this._loadIndex();
    if (action === "export")  return this._exportCurrent();
    if (action === "publish") {
      const repo = this._registryRepoUrl();
      if (repo) window.open(`${repo}/issues/new?template=submit-system.yml`, "_blank");
      return;
    }
    if (action === "install") {
      const entry = this._index?.[Number(ev.currentTarget.dataset.idx)];
      if (entry) return this._install(entry);
    }
  }

  async _install(entry) {
    if (!game.user?.isGM) return;
    if (!entry?.package) {
      ui.notifications.error(loc("SD.Market.InstallError"));
      return;
    }
    const ok = await DialogV2.confirm({
      window:  { title: loc("SD.Market.InstallConfirmTitle") },
      content: `<p>${fmt("SD.Market.InstallConfirmMsg", { name: esc(entry.name ?? "") }, "Install \u201c{name}\u201d? Your current system configuration will be overwritten.")}</p>`
    });
    if (!ok) return;

    try {
      const res = await fetch(entry.package, { cache: "no-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const pkg = await res.json();
      const settings = pkg?.settings;
      if (!pkg?.sdMarket || !settings || typeof settings !== "object") throw new Error("invalid package format");

      for (const key of PACKAGE_SETTING_KEYS) {
        if (!(key in settings)) continue;
        try { await game.settings.set("sd", key, settings[key]); }
        catch (err) { console.warn(`SD | Market: failed to apply setting "${key}"`, err); }
      }

      await this._importContent(pkg.content);

      ui.notifications.info(fmt("SD.Market.InstallDone", { name: entry.name ?? "" }, "\u201c{name}\u201d installed. Reloading\u2026"));
      setTimeout(() => window.location.reload(), 1500);
    } catch (err) {
      console.error("SD | Market: install failed", err);
      ui.notifications.error(loc("SD.Market.InstallError"));
    }
  }

  /**
   * Import package content (NPC actors, journal entries, world compendiums)
   * into the current world. Documents whose ids already exist are skipped, so
   * installing the same package twice does not create duplicates.
   */
  async _importContent(content) {
    if (!content || typeof content !== "object") return;

    const npcs = Array.isArray(content.npcs) ? content.npcs : [];
    if (npcs.length) {
      try {
        const fresh = npcs.filter(d => !d._id || !game.actors.has(d._id));
        if (fresh.length) await CONFIG.Actor.documentClass.createDocuments(fresh, { keepId: true });
      } catch (err) { console.warn("SD | Market: NPC import failed", err); }
    }

    const journals = Array.isArray(content.journals) ? content.journals : [];
    if (journals.length) {
      try {
        const fresh = journals.filter(d => !d._id || !game.journal.has(d._id));
        if (fresh.length) await CONFIG.JournalEntry.documentClass.createDocuments(fresh, { keepId: true });
      } catch (err) { console.warn("SD | Market: journal import failed", err); }
    }

    const packs = Array.isArray(content.packs) ? content.packs : [];
    for (const p of packs) {
      try {
        if (!p?.name || !p?.documentName || !CONFIG[p.documentName]?.documentClass) continue;
        const CC = foundry.documents?.collections?.CompendiumCollection ?? globalThis.CompendiumCollection;
        let pack = game.packs.get(`world.${p.name}`);
        if (!pack) {
          pack = await CC.createCompendium({
            name:    p.name,
            label:   p.label || p.name,
            type:    p.documentName,
            package: "world"
          });
        }
        const docs     = Array.isArray(p.documents) ? p.documents : [];
        const existing = new Set(pack.index.map(e => e._id));
        const fresh    = docs.filter(d => !d._id || !existing.has(d._id));
        if (fresh.length) {
          await CONFIG[p.documentName].documentClass.createDocuments(fresh, { pack: pack.collection, keepId: true });
        }
      } catch (err) { console.warn(`SD | Market: compendium "${p?.name}" import failed`, err); }
    }
  }

  async _exportCurrent() {
    if (!game.user?.isGM) return;
    const npcCount     = game.actors?.filter(a => a.type === "npc").length ?? 0;
    const journalCount = game.journal?.size ?? 0;
    const worldPacks   = game.packs?.filter(p => p.metadata?.packageType === "world") ?? [];
    const content = `
      <div class="form-group"><label>${loc("SD.Market.ExportName")}</label><input type="text" name="name" value="${esc(game.world?.title ?? "")}"></div>
      <div class="form-group"><label>${loc("SD.Market.ExportAuthor")}</label><input type="text" name="author" value="${esc(game.user?.name ?? "")}"></div>
      <div class="form-group"><label>${loc("SD.Market.ExportVersion")}</label><input type="text" name="version" value="1.0.0"></div>
      <div class="form-group"><label>${loc("SD.Market.ExportDesc")}</label><textarea name="description" rows="3"></textarea></div>
      <hr>
      <p class="hint">${loc("SD.Market.ExportContentHint")}</p>
      <div class="form-group"><label class="checkbox"><input type="checkbox" name="withNpcs" ${npcCount ? "checked" : "disabled"}> ${loc("SD.Market.ExportNpc")} (${npcCount})</label></div>
      <div class="form-group"><label class="checkbox"><input type="checkbox" name="withJournals" ${journalCount ? "checked" : "disabled"}> ${loc("SD.Market.ExportJournals")} (${journalCount})</label></div>
      <div class="form-group"><label class="checkbox"><input type="checkbox" name="withPacks" ${worldPacks.length ? "checked" : "disabled"}> ${loc("SD.Market.ExportPacks")} (${worldPacks.length})</label></div>`;

    let meta = null;
    try {
      meta = await DialogV2.prompt({
        window:  { title: loc("SD.Market.ExportTitle") },
        content,
        ok: {
          icon:     "fas fa-file-export",
          callback: (event, button) => {
            const FDE = foundry.applications?.ux?.FormDataExtended ?? globalThis.FormDataExtended;
            return new FDE(button.form).object;
          }
        }
      });
    } catch { return; }
    if (!meta) return;

    const pkg = {
      sdMarket: 1,
      meta: {
        name:        meta.name || "Untitled system",
        author:      meta.author || "",
        version:     meta.version || "1.0.0",
        description: meta.description || "",
        created:     new Date().toISOString(),
        sdVersion:   game.system?.version ?? ""
      },
      settings: {}
    };
    for (const key of PACKAGE_SETTING_KEYS) {
      try { pkg.settings[key] = game.settings.get("sd", key); } catch {}
    }

    pkg.content = { npcs: [], journals: [], packs: [] };
    if (meta.withNpcs) {
      try { pkg.content.npcs = game.actors.filter(a => a.type === "npc").map(a => a.toObject()); }
      catch (err) { console.warn("SD | Market: NPC export failed", err); }
    }
    if (meta.withJournals) {
      try { pkg.content.journals = game.journal.contents.map(j => j.toObject()); }
      catch (err) { console.warn("SD | Market: journal export failed", err); }
    }
    if (meta.withPacks) {
      for (const p of (game.packs?.filter(pk => pk.metadata?.packageType === "world") ?? [])) {
        try {
          const docs = await p.getDocuments();
          pkg.content.packs.push({
            name:         p.metadata.name,
            label:        p.metadata.label || p.metadata.name,
            documentName: p.documentName,
            documents:    docs.map(d => d.toObject())
          });
        } catch (err) { console.warn(`SD | Market: compendium "${p?.metadata?.label}" export failed`, err); }
      }
    }

    const base = String(meta.name || "sd-system").toLowerCase()
      .replace(/[^a-z0-9\u0400-\u04ff]+/gi, "-").replace(/^-+|-+$/g, "") || "sd-system";
    const save = foundry.utils?.saveDataToFile ?? globalThis.saveDataToFile;
    save(JSON.stringify(pkg, null, 2), "application/json", `${base}.sd-system.json`);
    ui.notifications.info(loc("SD.Market.ExportDone"));
  }

  /* ----------------------------- close ------------------------------ */

  _onClose(options) {
    super._onClose?.(options);
  }
}
