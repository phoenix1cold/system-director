/**
 * SD Community Market
 * Browse, install and submit user-created SD systems through the custom server.
 */

import { getLanguages, saveLanguages } from "./localization.mjs";

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
const CUSTOM_MARKET_CATALOG = "https://sdmarket.flamegogang.com/api/v1/catalog";
const CUSTOM_MARKET_API = "https://sdmarket.flamegogang.com/api/v1";

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
  ,"localizationLanguages"
  ,"effectPresets"
  ,"allowPlayerEffectApplier"
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
    position: { width: 1080, height: 720 }
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

  _marketApiBase() {
    return CUSTOM_MARKET_API;
  }

  async _loadIndex() {
    const url = CUSTOM_MARKET_CATALOG;
    if (game.user?.isGM) {
      try {
        if (game.settings.get("sd", "marketRegistryUrl") !== url) {
          game.settings.set("sd", "marketRegistryUrl", url).catch?.(() => {});
        }
      } catch {}
    }

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
    html += `<section class="sd-market-hero">
      <div class="sd-market-hero-mark"><i class="fas fa-store"></i></div>
      <div class="sd-market-hero-copy"><span>${loc("SD.Market.CommunityEyebrow")}</span><strong>${loc("SD.Market.Title")}</strong><small>${loc("SD.Market.HeroSubtitle")}</small></div>
      <div class="sd-market-hero-actions">
        <button type="button" class="sd-market-btn" data-action="export"><i class="fas fa-box-archive"></i> ${loc("SD.Market.ExportBtn")}</button>
        <button type="button" class="sd-market-btn" data-action="import" title="${esc(loc("SD.Market.ImportHint"))}"><i class="fas fa-file-arrow-up"></i> ${loc("SD.Market.ImportBtn")}</button>
        <button type="button" class="sd-market-btn" data-action="update-system" title="${esc(loc("SD.Market.UpdateHint"))}"><i class="fas fa-arrows-rotate"></i> ${loc("SD.Market.UpdateBtn")}</button>
        <button type="button" class="sd-market-btn primary" data-action="publish" title="${esc(loc("SD.Market.PublishHint"))}"><i class="fas fa-cloud-arrow-up"></i> ${loc("SD.Market.PublishBtn")}</button>
      </div>
    </section>`;
    html += `<div class="sd-market-toolbar">
      <div class="sd-market-search">
        <i class="fas fa-search"></i>
        <input type="text" value="${esc(this._query)}" placeholder="${esc(loc("SD.Market.SearchPlaceholder"))}" data-action="search">
      </div>
      <span class="sd-market-count">${Number(this._index?.length ?? 0)} ${loc("SD.Market.SystemCount")}</span>
      <button type="button" class="sd-market-btn icon-only" data-action="refresh" title="${esc(loc("SD.Market.Refresh"))}"><i class="fas fa-rotate"></i></button>
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
        <div class="sd-market-card-cover">${s.cover?`<img src="${esc(s.cover)}" alt="">`:`<span><i class="fas fa-wand-magic-sparkles"></i></span>`}<b>v${esc(s.version??"1.0.0")}</b></div>
        <div class="sd-market-card-hdr">
          ${s.icon
            ? `<img class="sd-market-card-icon" src="${esc(s.icon)}" alt="">`
            : `<span class="sd-market-card-icon is-ph"><i class="fas fa-dice-d20"></i></span>`}
          <div class="sd-market-card-titles">
            <div class="sd-market-card-name">${esc(s.name ?? "?")}</div>
            <div class="sd-market-card-author">${esc(s.author ?? "")}${s.version ? ` \u00b7 v${esc(s.version)}` : ""}</div>
          </div>
          <div class="sd-market-card-stats"><span><i class="fas fa-download"></i> ${Number(s.downloads ?? 0)}</span><button type="button" class="sd-market-vote ${this._savedVote(s.id)==="like"?"active":""}" data-action="vote" data-id="${esc(s.id)}" data-vote="like" title="${esc(loc("SD.Market.Like"))}"><i class="fas fa-thumbs-up"></i> ${Number(s.likes ?? 0)}</button><button type="button" class="sd-market-vote dislike ${this._savedVote(s.id)==="dislike"?"active":""}" data-action="vote" data-id="${esc(s.id)}" data-vote="dislike" title="${esc(loc("SD.Market.Dislike"))}"><i class="fas fa-thumbs-down"></i> ${Number(s.dislikes ?? 0)}</button></div>
        </div>
        <div class="sd-market-card-desc">${esc(s.description ?? "")}</div>
        ${Array.isArray(s.tags) && s.tags.length
          ? `<div class="sd-market-card-tags">${s.tags.map(t => `<span>${esc(t)}</span>`).join("")}</div>`
          : ""}
        ${Array.isArray(s.languages) && s.languages.length ? `<div class="sd-market-card-tags">${s.languages.map(l=>`<span><i class="fas fa-language"></i> ${esc(l.name??l.id??l)}</span>`).join("")}</div>`:""}
        <div class="sd-market-card-actions">
          <button type="button" class="sd-market-btn primary" data-action="install" data-idx="${idx}"><i class="fas fa-download"></i> ${loc("SD.Market.Install")}</button>
          ${s.rulebook ? `<a class="sd-market-btn" href="${esc(s.rulebook)}" target="_blank" rel="noopener"><i class="fas fa-book"></i> ${loc("SD.Market.Rulebook")}</a>` : ""}
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
    body.querySelectorAll("[data-action]").forEach(el =>
      el.addEventListener("click", ev => this._handleAction(ev))
    );
  }

  /* ----------------------------- actions ---------------------------- */

  async _handleAction(ev) {
    const action = ev.currentTarget.dataset.action;
    if (action === "refresh") return this._loadIndex();
    if (action === "export")  return this._exportCurrent();
    if (action === "import")  return this._importFromFile();
    if (action === "publish") return this._publishCurrent();
    if (action === "update-system") return this._updateCurrent();
    if (action === "vote") return this._vote(ev.currentTarget.dataset.id, ev.currentTarget.dataset.vote);
    if (action === "install") {
      const entry = this._index?.[Number(ev.currentTarget.dataset.idx)];
      if (entry) return this._install(entry);
    }
  }

  _savedVote(id) { try { return localStorage.getItem(`sd.market.vote.${id}`) ?? ""; } catch { return ""; } }
  _voterId() { const key="sd.market.voterId"; try { let id=localStorage.getItem(key); if(!id){id=crypto.randomUUID();localStorage.setItem(key,id)} return id; } catch { return crypto.randomUUID(); } }
  async _vote(id, requested) {
    if(!id||!["like","dislike"].includes(requested))return;
    const vote=this._savedVote(id)===requested?"clear":requested;
    try { const response=await fetch(`${CUSTOM_MARKET_API}/systems/${encodeURIComponent(id)}/vote`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({vote,voterId:this._voterId()})}),result=await response.json().catch(()=>({}));if(!response.ok)throw Error(result.error||`HTTP ${response.status}`);const entry=this._index?.find(x=>x.id===id);if(entry){entry.likes=result.likes;entry.dislikes=result.dislikes}try{result.vote?localStorage.setItem(`sd.market.vote.${id}`,result.vote):localStorage.removeItem(`sd.market.vote.${id}`)}catch{}this._refreshCardsOnly(); } catch(error){console.error("SD | Market vote failed",error);ui.notifications?.error?.(loc("SD.Market.VoteError"));}
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
      await this._applyPackage(pkg, entry.name ?? "");
    } catch (err) {
      console.error("SD | Market: install failed", err);
      ui.notifications.error(loc("SD.Market.InstallError"));
    }
  }

  /** Validate a package, back up current settings, then apply it and reload. */
  async _applyPackage(pkg, name) {
    const settings = pkg?.settings;
    if (!pkg?.sdMarket || !settings || typeof settings !== "object") throw new Error("invalid package format");

    this._downloadBackup();

    for (const key of PACKAGE_SETTING_KEYS) {
      if (!(key in settings)) continue;
      try {
        if (key === "localizationLanguages") {
          const map=new Map(getLanguages().map(l=>[l.id,l]));
          for(const l of (settings[key]??[])) if(l?.id) map.set(l.id,{...(map.get(l.id)??{}),...l});
          await saveLanguages([...map.values()]);
        } else if (key === "effectPresets") {
          await game.settings.set("sd",key,{...(game.settings.get("sd",key)??{}),...(settings[key]??{})});
        } else await game.settings.set("sd", key, settings[key]);
      }
      catch (err) { console.warn(`SD | Market: failed to apply setting "${key}"`, err); }
    }

    await this._importContent(pkg.content);

    ui.notifications.info(fmt("SD.Market.InstallDone", { name }, "\u201c{name}\u201d installed. Reloading\u2026"));
    setTimeout(() => window.location.reload(), 1500);
  }

  /** Download a backup package with the world's current settings. */
  _downloadBackup() {
    try {
      const backup = {
        sdMarket: 2,
        schemaVersion: 2,
        capabilities: { localizations:true, effectPresets:true },
        languages: getLanguages().map(l=>({id:l.id,name:l.name})),
        meta: {
          name:        `Backup ${game.world?.title ?? ""}`.trim(),
          author:      game.user?.name ?? "",
          version:     "backup",
          description: "Automatic backup created before installing a market system.",
          created:     new Date().toISOString(),
          sdVersion:   game.system?.version ?? ""
        },
        settings: {}
      };
      for (const key of PACKAGE_SETTING_KEYS) {
        try { backup.settings[key] = game.settings.get("sd", key); } catch {}
      }
      const save  = foundry.utils?.saveDataToFile ?? globalThis.saveDataToFile;
      const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
      save(JSON.stringify(backup, null, 2), "application/json", `backup-${stamp}.sd-system.json`);
      ui.notifications.info(loc("SD.Market.BackupDone"));
    } catch (err) { console.warn("SD | Market: backup failed", err); }
  }

  /** Install a system from a local *.sd-system.json file (e.g. a backup). */
  async _importFromFile() {
    if (!game.user?.isGM) return;
    const input  = document.createElement("input");
    input.type   = "file";
    input.accept = ".json,application/json";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const pkg  = JSON.parse(await file.text());
        const name = pkg?.meta?.name ?? file.name;
        const ok = await DialogV2.confirm({
          window:  { title: loc("SD.Market.InstallConfirmTitle") },
          content: `<p>${fmt("SD.Market.InstallConfirmMsg", { name: esc(name) }, "Install \u201c{name}\u201d? Your current system configuration will be overwritten.")}</p>`
        });
        if (!ok) return;
        await this._applyPackage(pkg, name);
      } catch (err) {
        console.error("SD | Market: file import failed", err);
        ui.notifications.error(loc("SD.Market.InstallError"));
      }
    });
    input.click();
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

  async _buildPackage(meta={}) {
    const pkg={sdMarket:3,schemaVersion:3,capabilities:{localizations:true,effectPresets:true,media:true},languages:getLanguages().map(l=>({id:l.id,name:l.name})),meta:{name:meta.name||"Untitled system",author:meta.author||"",version:meta.version||"1.0.0",description:meta.description||"",created:new Date().toISOString(),sdVersion:game.system?.version??"",languages:getLanguages().map(l=>({id:l.id,name:l.name}))},settings:{},content:{npcs:[],journals:[],packs:[]}};
    for(const key of PACKAGE_SETTING_KEYS){try{pkg.settings[key]=game.settings.get("sd",key);}catch{}}
    if(meta.withNpcs){try{pkg.content.npcs=game.actors.filter(a=>a.type==="npc").map(a=>a.toObject());}catch(e){console.warn("SD | Market NPC export",e);}}
    if(meta.withJournals){try{pkg.content.journals=game.journal.contents.map(j=>j.toObject());}catch(e){console.warn("SD | Market journal export",e);}}
    if(meta.withPacks)for(const p of(game.packs?.filter(pk=>pk.metadata?.packageType==="world")??[])){try{const docs=await p.getDocuments();pkg.content.packs.push({name:p.metadata.name,label:p.metadata.label||p.metadata.name,documentName:p.documentName,documents:docs.map(d=>d.toObject())});}catch(e){console.warn("SD | Market pack export",e);}}
    return pkg;
  }

  async _publishCurrent() { return this._openSubmissionForm({mode:"create"}); }

  async _updateCurrent() {
    if(!game.user?.isGM)return ui.notifications?.warn?.("Only a GM can update a system.");
    let secretKey;try{secretKey=await DialogV2.prompt({window:{title:loc("SD.Market.UpdateLookupTitle")},content:`<div class="sd-market-key-prompt"><i class="fas fa-key"></i><p>${loc("SD.Market.UpdateLookupIntro")}</p><label>${loc("SD.Market.SecretKey")}<input type="password" name="secretKey" autocomplete="off" required></label></div>`,ok:{label:loc("SD.Market.FindSystem"),icon:"fas fa-magnifying-glass",callback:(event,button)=>String(button.form.elements.secretKey?.value??"").trim()}})}catch{return}if(!secretKey)return ui.notifications?.warn?.(loc("SD.Market.SecretRequired"));
    try{ui.notifications?.info?.(loc("SD.Market.FindingSystem"));const response=await fetch(`${CUSTOM_MARKET_API}/updates/lookup`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({secretKey})}),result=await response.json().catch(()=>({}));if(!response.ok)throw Error(result.error||`HTTP ${response.status}`);return this._openSubmissionForm({mode:"update",secretKey,existing:result.system??{}})}catch(error){console.error("SD | Market update lookup",error);ui.notifications?.error?.(fmt("SD.Market.UpdateLookupError",{error:error.message},"System lookup failed: {error}"))}
  }

  async _openSubmissionForm({mode="create",secretKey="",existing={}}={}) {
    if(!game.user?.isGM)return ui.notifications?.warn?.("Only a GM can submit a system.");const isUpdate=mode==="update",api=this._marketApiBase(),npcCount=game.actors?.filter(a=>a.type==="npc").length??0,journalCount=game.journal?.size??0,worldPacks=game.packs?.filter(p=>p.metadata?.packageType==="world")??[],tags=Array.isArray(existing.tags)?existing.tags.join(", "):"",field=(label,name,value="",attrs="")=>`<label>${label}<input ${attrs} name="${name}" value="${esc(value)}"></label>`,keyField=isUpdate?`<div class="wide sd-market-secret-confirmed"><i class="fas fa-key"></i><div><b>${loc("SD.Market.SecretMatched")}</b><small>${loc("SD.Market.SecretNeverShown")}</small></div></div>`:`<label class="wide sd-market-secret-field">${loc("SD.Market.SecretKey")}<input required type="password" name="secretKey" autocomplete="new-password" placeholder="${esc(loc("SD.Market.SecretPlaceholder"))}"><small>${loc("SD.Market.SecretHelp")}</small></label>`;
    const content=`<div class="sd-market-publish-form"><div class="sd-market-publish-intro"><i class="fas ${isUpdate?"fa-arrows-rotate":"fa-cloud-arrow-up"}"></i><div><b>${loc(isUpdate?"SD.Market.UpdateTitle":"SD.Market.SubmitTitle")}</b><span>${loc(isUpdate?"SD.Market.UpdateIntro":"SD.Market.SubmitIntro")}</span></div></div><div class="sd-market-publish-grid">${field(loc("SD.Market.ExportName"),"name",existing.name||game.world?.title||"","required")}${field(loc("SD.Market.ExportAuthor"),"author",existing.author||game.user?.name||"","required")}${field(loc("SD.Market.ExportVersion"),"version",existing.version||"1.0.0","required")}${field(loc("SD.Market.Contact"),"contact",existing.contact||"",'placeholder="Discord / email"')}<label class="wide">${loc("SD.Market.ExportDesc")}<textarea required name="description" rows="4">${esc(existing.description||"")}</textarea></label><label class="wide">${loc("SD.Market.Tags")}<input name="tags" value="${esc(tags)}" placeholder="fantasy, sci-fi, rules-light"></label>${keyField}<label class="sd-market-media-upload"><input type="file" name="iconFile" accept="image/*"><span><i class="fas fa-icons"></i><b>${loc("SD.Market.IconImage")}</b><small>${loc(isUpdate?"SD.Market.ImageReplaceHint":"SD.Market.ImagePickHint")}</small></span></label><label class="sd-market-media-upload"><input type="file" name="coverFile" accept="image/*"><span><i class="fas fa-panorama"></i><b>${loc("SD.Market.CoverImage")}</b><small>${loc(isUpdate?"SD.Market.ImageReplaceHint":"SD.Market.ImagePickHint")}</small></span></label><label class="wide sd-market-media-upload is-screens"><input type="file" name="screenshotFiles" accept="image/*" multiple><span><i class="fas fa-images"></i><b>${loc("SD.Market.Screenshots")}</b><small>${loc(isUpdate?"SD.Market.ImagesReplaceHint":"SD.Market.ImagesPickHint")}</small></span></label></div><div class="sd-market-publish-options"><label><input type="checkbox" name="withNpcs" ${npcCount?"checked":""}> ${loc("SD.Market.ExportNpc")} (${npcCount})</label><label><input type="checkbox" name="withJournals" ${journalCount?"checked":""}> ${loc("SD.Market.ExportJournals")} (${journalCount})</label><label><input type="checkbox" name="withPacks" ${worldPacks.length?"checked":""}> ${loc("SD.Market.ExportPacks")} (${worldPacks.length})</label></div><p class="hint">${loc(isUpdate?"SD.Market.UpdateReviewHint":"SD.Market.SubmitReviewHint")}</p></div>`;
    let values;try{values=await DialogV2.prompt({window:{title:loc(isUpdate?"SD.Market.UpdateTitle":"SD.Market.SubmitTitle"),resizable:true},content,ok:{label:loc(isUpdate?"SD.Market.UpdateSubmitBtn":"SD.Market.SubmitBtn"),icon:isUpdate?"fas fa-arrows-rotate":"fas fa-cloud-arrow-up",callback:(event,button)=>{const form=button.form,FDE=foundry.applications?.ux?.FormDataExtended??globalThis.FormDataExtended,obj=new FDE(form).object;return{...obj,secretKey:isUpdate?secretKey:String(form.elements.secretKey?.value??"").trim(),iconFile:form.querySelector("[name='iconFile']")?.files?.[0]??null,coverFile:form.querySelector("[name='coverFile']")?.files?.[0]??null,screenshotFiles:[...(form.querySelector("[name='screenshotFiles']")?.files??[])]}}}})}catch{return}if(!values)return;if(!values.secretKey)return ui.notifications?.warn?.(loc("SD.Market.SecretRequired"));
    try{ui.notifications?.info?.(loc(isUpdate?"SD.Market.UpdateUploading":"SD.Market.SubmitUploading"));const pkg=await this._buildPackage(values),body=new FormData();body.append("secretKey",values.secretKey);body.append("meta",JSON.stringify({name:values.name,author:values.author,version:values.version,description:values.description,tags:values.tags,contact:values.contact,world:game.world?.title??"",foundryUser:game.user?.name??""}));const base=String(values.name||"sd-system").toLowerCase().replace(/[^a-z0-9\u0400-\u04ff]+/gi,"-").replace(/^-+|-+$/g,"")||"sd-system";body.append("package",new Blob([JSON.stringify(pkg,null,2)],{type:"application/json"}),`${base}.sd-system.json`);if(values.iconFile)body.append("icon",values.iconFile,values.iconFile.name);if(values.coverFile)body.append("cover",values.coverFile,values.coverFile.name);for(const file of values.screenshotFiles.slice(0,6))body.append("screenshots",file,file.name);const response=await fetch(`${api}/${isUpdate?"updates":"submissions"}`,{method:"POST",body}),result=await response.json().catch(()=>({}));if(!response.ok)throw Error(result.error||`HTTP ${response.status}`);ui.notifications?.info?.(fmt(isUpdate?"SD.Market.UpdateDone":"SD.Market.SubmitDone",{id:result.updateId||result.submissionId},"Request {id} is waiting for approval."))}catch(error){console.error("SD | Market submission",error);ui.notifications?.error?.(fmt(isUpdate?"SD.Market.UpdateError":"SD.Market.SubmitError",{error:error.message},`Request failed: ${error.message}`))}
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
      <div class="form-group"><label class="checkbox"><input type="checkbox" name="withNpcs" ${npcCount ? "checked" : ""}> ${loc("SD.Market.ExportNpc")} (${npcCount})</label></div>
      <div class="form-group"><label class="checkbox"><input type="checkbox" name="withJournals" ${journalCount ? "checked" : ""}> ${loc("SD.Market.ExportJournals")} (${journalCount})</label></div>
      <div class="form-group"><label class="checkbox"><input type="checkbox" name="withPacks" ${worldPacks.length ? "checked" : ""}> ${loc("SD.Market.ExportPacks")} (${worldPacks.length})</label></div>`;

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
      sdMarket: 2,
      schemaVersion: 2,
      capabilities: { localizations:true, effectPresets:true },
      languages: getLanguages().map(l=>({id:l.id,name:l.name})),
      meta: {
        name:        meta.name || "Untitled system",
        author:      meta.author || "",
        version:     meta.version || "1.0.0",
        description: meta.description || "",
        created:     new Date().toISOString(),
        sdVersion:   game.system?.version ?? "",
        languages:   getLanguages().map(l=>({id:l.id,name:l.name}))
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
