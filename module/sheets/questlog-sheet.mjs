const { ItemSheetV2 } = foundry.applications.sheets;
const { HandlebarsApplicationMixin } = foundry.applications.api;

function _gid(prefix) {
  return `${prefix}${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-3)}`;
}

function _esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function _i18n(key, fallback) {
  const v = game.i18n?.localize?.(key);
  if (!v || v === key) return fallback ?? key;
  return v;
}

const STATUS_OPTIONS = [
  { value: "locked",    labelKey: "SD.QuestLog.Status.Locked",    fallback: "Locked",    color: "#7a7a8a" },
  { value: "available", labelKey: "SD.QuestLog.Status.Available", fallback: "Available", color: "#5a8ad8" },
  { value: "active",    labelKey: "SD.QuestLog.Status.Active",    fallback: "Active",    color: "#d8a83a" },
  { value: "completed", labelKey: "SD.QuestLog.Status.Completed", fallback: "Completed", color: "#3aa860" },
  { value: "failed",    labelKey: "SD.QuestLog.Status.Failed",    fallback: "Failed",    color: "#c04050" }
];

const VIS_OPTIONS = [
  { value: "visible",   labelKey: "SD.QuestLog.Vis.Visible",   fallback: "Visible to all" },
  { value: "hidden",    labelKey: "SD.QuestLog.Vis.Hidden",    fallback: "Hidden (GM only)" },
  { value: "perPlayer", labelKey: "SD.QuestLog.Vis.PerPlayer", fallback: "Per-player" }
];

export class SDQuestLogSheet extends HandlebarsApplicationMixin(ItemSheetV2) {

  static DEFAULT_OPTIONS = {
    classes: ["sd", "sheet", "item", "sd-questlog"],
    position: { width: 920, height: 660 },
    window: {
      resizable: true,
      controls: []
    },
    actions: {
      editImage: SDQuestLogSheet._onEditImage
    },
    form: { submitOnChange: true }
  };

  static PARTS = {
    header: { template: "systems/sd/templates/item/questlog-header.hbs" },
    canvas: { template: "systems/sd/templates/item/questlog-canvas.hbs" }
  };

  tabGroups = { sheet: "quests" };
  _selectedId = null;

  get title() { return this.document.name; }

  async _prepareContext(options) {
    const base = await super._prepareContext(options);
    return {
      ...base,
      item:       this.document,
      system:     this.document.system,
      questCount: (this.document.system.quests ?? []).length,
      isEditable: this.isEditable,
      isGM:       !!game.user?.isGM
    };
  }

  _onRender(context, options) {
    this._injectStyles();
    this._buildTabNav();
    this._buildTabPanels();
  }

  static _onEditImage(ev, btn) {
    const fp = new foundry.applications.apps.FilePicker.implementation({
      type:    "image",
      current: this.document.img,
      callback: (path) => this.document.update({ img: path })
    });
    fp.browse();
  }

  _isGM()    { return !!game.user?.isGM; }
  _quests()  { return this.document.system.quests ?? []; }
  _findQ(id) { return this._quests().find(q => q.id === id); }

  _canSee(q) {
    if (this._isGM()) return true;
    if (!q) return false;
    if (q.status === "locked") return false;
    if (q.visibility?.gmRevealed) return true;
    const m = q.visibility?.mode ?? "visible";
    if (m === "visible")   return true;
    if (m === "hidden")    return false;
    if (m === "perPlayer") return (q.visibility?.players ?? []).includes(game.user?.id);
    return false;
  }

  _injectStyles() {
    const root = this.element;
    if (!root || root.querySelector("style[data-sd-questlog]")) return;
    const style = document.createElement("style");
    style.setAttribute("data-sd-questlog", "");
    style.textContent = `
      .sd-questlog .sd-tab-nav {
        display: flex; flex-wrap: wrap; gap: 2px;
        padding: 5px 12px 0;
        background: var(--sd-bg-2); border-bottom: 1px solid var(--sd-border);
      }
      .sd-questlog .sd-tab-nav button {
        background: transparent; border: 1px solid transparent;
        border-bottom: none; border-radius: 6px 6px 0 0;
        color: var(--sd-text-2); font-size: 12px; padding: 5px 12px;
        cursor: pointer;
      }
      .sd-questlog .sd-tab-nav button.active {
        background: var(--sd-bg-1); color: var(--sd-text);
        border-color: var(--sd-border);
      }
      .sd-questlog .window-content { display: flex; flex-direction: column; min-height: 0; overflow: hidden; padding: 0; }
      .sd-questlog .sd-tab-nav { flex: 0 0 auto; }
      .sd-questlog .sd-questlog-root { flex: 1 1 auto !important; min-height: 0; overflow: hidden; display: block; }
      .sd-questlog .sd-panel { display: none; height: 100%; min-height: 0; box-sizing: border-box; }
      .sd-questlog .sd-panel.active { display: block; }
      .sd-questlog .sd-panel.sd-quests-layout.active {
        display: grid; grid-template-columns: 280px minmax(0, 1fr); height: 100%;
        gap: 0; overflow: hidden; min-height: 0;
      }
      .sd-questlog .sd-panel.sd-settings.active {
        display: flex; flex-direction: column; gap: 12px; padding: 14px;
        overflow-y: auto; overflow-x: hidden; height: 100%; box-sizing: border-box;
      }
      .sd-questlog .sd-quests-layout {
        gap: 0;
      }
      .sd-questlog .sd-quest-list {
        background: var(--sd-bg-2); border-right: 1px solid var(--sd-border);
        overflow-y: auto; padding: 6px; display: flex; flex-direction: column; gap: 4px;
        min-height: 0;
      }
      .sd-questlog .sd-quest-row {
        display: flex; align-items: center; gap: 8px;
        background: var(--sd-bg-1); border: 1px solid var(--sd-border);
        border-radius: 6px; padding: 6px 8px; cursor: pointer;
        font-size: 12px; color: var(--sd-text);
        transition: background .15s, border-color .15s;
      }
      .sd-questlog .sd-quest-row:hover { background: var(--sd-bg-3); }
      .sd-questlog .sd-quest-row.selected {
        border-color: var(--sd-accent);
        box-shadow: 0 0 0 1px var(--sd-accent) inset;
      }
      .sd-questlog .sd-quest-row.dim { opacity: .45; }
      .sd-questlog .sd-quest-row .qicon { width: 18px; text-align: center; color: var(--sd-text-2); }
      .sd-questlog .sd-quest-row .qname { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .sd-questlog .sd-quest-row .qchip {
        font-size: 9px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase;
        padding: 1px 6px; border-radius: 999px; color: #fff; flex-shrink: 0;
      }
      .sd-questlog .sd-quest-row .qhid {
        font-size: 10px; color: var(--sd-text-2); flex-shrink: 0;
      }

      .sd-questlog .sd-quest-detail {
        padding: 12px 14px; overflow-y: auto; overflow-x: hidden;
        display: flex; flex-direction: column; gap: 10px;
        min-height: 0; min-width: 0; height: 100%; box-sizing: border-box;
      }
      .sd-questlog .sd-detail-empty {
        color: var(--sd-text-2); font-style: italic; text-align: center; margin: 24px 8px;
      }
      .sd-questlog .sd-detail-name {
        font-size: 18px; font-weight: 600; color: var(--sd-text);
        background: var(--sd-bg-1); border: 1px solid var(--sd-border);
        border-radius: 6px; padding: 6px 10px; width: 100%; box-sizing: border-box;
      }
      .sd-questlog .sd-detail-row {
        display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
        font-size: 12px; color: var(--sd-text-2);
      }
      .sd-questlog .sd-detail-row label { font-weight: 600; min-width: 70px; }
      .sd-questlog select, .sd-questlog input[type=text], .sd-questlog input[type=number] {
        background: var(--sd-bg-1); border: 1px solid var(--sd-border);
        color: var(--sd-text); border-radius: 4px; padding: 4px 8px; font-size: 12px;
      }
      .sd-questlog textarea {
        background: var(--sd-bg-1); border: 1px solid var(--sd-border);
        color: var(--sd-text); border-radius: 4px; padding: 6px 10px; font-size: 12px;
        width: 100%; min-height: 90px; resize: vertical; font-family: inherit; box-sizing: border-box;
      }
      .sd-questlog .sd-detail-section {
        background: var(--sd-bg-2); border: 1px solid var(--sd-border);
        border-radius: 6px; padding: 10px;
      }
      .sd-questlog .sd-detail-section h4 {
        margin: 0 0 8px; font-size: 11px; font-weight: 700;
        text-transform: uppercase; letter-spacing: .05em; color: var(--sd-text-2);
      }
      .sd-questlog .sd-subtask-row {
        display: flex; align-items: center; gap: 8px; padding: 4px 0;
        border-bottom: 1px dashed var(--sd-border);
      }
      .sd-questlog .sd-subtask-row:last-child { border-bottom: none; }
      .sd-questlog .sd-subtask-row input[type=text] { flex: 1; min-width: 0; }
      .sd-questlog .sd-subtask-row input[type=checkbox] { margin: 0; flex-shrink: 0; accent-color: var(--sd-accent); }
      .sd-questlog .sd-quest-actions {
        display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px;
      }
      .sd-questlog button.sd-btn {
        background: var(--sd-bg-3); color: var(--sd-text); border: 1px solid var(--sd-border);
        border-radius: 4px; padding: 5px 10px; font-size: 11px; cursor: pointer;
        display: inline-flex; align-items: center; gap: 5px;
      }
      .sd-questlog button.sd-btn:hover:not(:disabled) { background: var(--sd-accent); color: #fff; }
      .sd-questlog button.sd-btn:disabled { opacity: .5; cursor: not-allowed; }
      .sd-questlog button.sd-btn.danger { color: #d27c7c; }
      .sd-questlog button.sd-btn.danger:hover { background: #a83a3a; color: #fff; }
      .sd-questlog .sd-vis-radio {
        display: flex; flex-wrap: wrap; gap: 8px;
      }
      .sd-questlog .sd-vis-radio label {
        display: inline-flex; align-items: center; gap: 4px; font-size: 11px;
        color: var(--sd-text-2); cursor: pointer;
      }
      .sd-questlog .sd-player-pick {
        display: grid; grid-template-columns: repeat(2, 1fr); gap: 4px 12px;
        margin-top: 4px;
      }
      .sd-questlog .sd-stub {
        margin: 8px 0; padding: 12px; border: 1px dashed var(--sd-border);
        border-radius: 6px; background: var(--sd-bg-2); color: var(--sd-text-2);
        font-size: 11px; font-style: italic; text-align: center;
      }
      
      .sd-questlog .sd-add-quest-btn {
        margin-top: auto; padding: 8px; text-align: center; cursor: pointer;
        background: var(--sd-accent); color: #fff; border-radius: 6px;
        font-size: 12px; font-weight: 600;
      }
      .sd-questlog .sd-add-quest-btn:hover { filter: brightness(1.15); }
    `;
    root.appendChild(style);
  }

  _buildTabNav() {
    const root = this.element;
    if (!root) return;
    let nav = root.querySelector(".sd-tab-nav");
    if (!nav) {
      nav = document.createElement("nav");
      nav.className = "sd-tab-nav";
      root.querySelector(".window-content")?.appendChild(nav);
    }
    nav.innerHTML = "";
    const isGM = this._isGM();
    const tabs = [
      { id: "quests", label: _i18n("SD.QuestLog.Tabs.Quests", "Quests") }
    ];
    if (isGM) {
      tabs.push({ id: "chainGraph", label: _i18n("SD.QuestLog.Tabs.ChainGraph", "Chain Graph") });
      tabs.push({ id: "settings",   label: _i18n("SD.QuestLog.Tabs.Settings",   "Settings") });
    }
    if (!tabs.some(t => t.id === this.tabGroups.sheet)) this.tabGroups.sheet = "quests";
    for (const t of tabs) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = t.label;
      if (t.id === this.tabGroups.sheet) b.classList.add("active");
      b.addEventListener("click", () => {
        this.tabGroups.sheet = t.id;
        this._buildTabNav();
        this._buildTabPanels();
      });
      nav.appendChild(b);
    }
  }

  _buildTabPanels() {
    const root = this.element;
    if (!root) return;
    let host = root.querySelector(".sd-questlog-root");
    if (!host) {
      host = document.createElement("div");
      host.className = "sd-questlog-root";
      root.querySelector(".window-content")?.appendChild(host);
    }
    host.style.display = "block";
    host.style.flex    = "1 1 auto";
    host.style.minHeight = "0";
    host.style.overflow = "hidden";
    host.innerHTML = "";

    const tab = this.tabGroups.sheet ?? "quests";
    const isGM = this._isGM();

    if (tab === "chainGraph" && isGM)    host.appendChild(this._renderChainGraphTab());
    else if (tab === "settings" && isGM) host.appendChild(this._renderSettingsTab());
    else                                 host.appendChild(this._renderQuestsTab());
  }


  _renderQuestsTab() {
    const wrap = document.createElement("div");
    wrap.className = "sd-quests-layout sd-panel active";

    const list = document.createElement("div");
    list.className = "sd-quest-list";
    wrap.appendChild(list);
    this._renderQuestList(list);

    const detail = document.createElement("div");
    detail.className = "sd-quest-detail";
    wrap.appendChild(detail);
    this._renderQuestDetail(detail);

    return wrap;
  }

  _renderQuestList(host) {
    host.innerHTML = "";
    const isGM = this._isGM();
    const quests = this._quests();

    if (!this._selectedId || !quests.find(q => q.id === this._selectedId)) {
      this._selectedId = quests.find(q => isGM || this._canSee(q))?.id ?? null;
    }

    const visible = quests.filter(q => isGM || this._canSee(q));
    if (!visible.length) {
      const empty = document.createElement("div");
      empty.className = "sd-detail-empty";
      empty.textContent = _i18n("SD.QuestLog.NoQuestsVisible", "No quests visible.");
      host.appendChild(empty);
    }

    for (const q of quests) {
      if (!isGM && !this._canSee(q)) continue;

      const row = document.createElement("div");
      row.className = "sd-quest-row";
      row.dataset.questId = q.id;
      if (q.id === this._selectedId) row.classList.add("selected");
      const dim = isGM && (q.status === "locked" || q.visibility?.mode === "hidden");
      if (dim && !q.visibility?.gmRevealed) row.classList.add("dim");

      const status = STATUS_OPTIONS.find(s => s.value === q.status) ?? STATUS_OPTIONS[1];
      row.innerHTML = `
        <i class="fas ${_esc(q.icon || "fa-flag")} qicon"></i>
        <span class="qname">${_esc(q.name || "—")}</span>
        ${q.visibility?.mode === "hidden" && isGM ? `<span class="qhid" title="${_esc(_i18n('SD.QuestLog.HiddenTip','Hidden from players'))}"><i class="fas fa-eye-slash"></i></span>` : ""}
        <span class="qchip" style="background:${status.color}">${_esc(_i18n(status.labelKey, status.fallback))}</span>
      `;
      row.addEventListener("click", () => {
        this._selectedId = q.id;
        this._buildTabPanels();
      });
      host.appendChild(row);
    }

    if (isGM) {
      const add = document.createElement("div");
      add.className = "sd-add-quest-btn";
      add.innerHTML = `<i class="fas fa-plus"></i> ${_esc(_i18n("SD.QuestLog.AddQuest", "Add quest"))}`;
      add.addEventListener("click", () => this._addQuest());
      host.appendChild(add);
    }
  }

  _renderQuestDetail(host) {
    host.innerHTML = "";
    const isGM = this._isGM();
    const q = this._findQ(this._selectedId);
    if (!q) {
      const empty = document.createElement("div");
      empty.className = "sd-detail-empty";
      empty.textContent = _i18n("SD.QuestLog.SelectQuest", "Select a quest from the list.");
      host.appendChild(empty);
      return;
    }


    const nameRow = document.createElement("div");
    nameRow.style.cssText = "display:flex;gap:8px;align-items:center";
    const name = document.createElement("input");
    name.type = "text";
    name.className = "sd-detail-name";
    name.value = q.name ?? "";
    name.disabled = !isGM;
    name.addEventListener("change", () => this._patchQuest(q.id, { name: name.value }));
    nameRow.appendChild(name);

    if (isGM) {
      const iconBtn = document.createElement("button");
      iconBtn.className = "sd-btn";
      iconBtn.title = _i18n("SD.QuestLog.IconClass", "Icon class (Font Awesome)");
      iconBtn.innerHTML = `<i class="fas ${_esc(q.icon || "fa-flag")}"></i>`;
      iconBtn.addEventListener("click", async () => {
        const v = await SDQuestLogSheet._promptText(_i18n("SD.QuestLog.IconClass","Icon class (Font Awesome)"), q.icon || "fa-flag");
        if (v != null) this._patchQuest(q.id, { icon: v.trim() || "fa-flag" });
      });
      nameRow.appendChild(iconBtn);
    }
    host.appendChild(nameRow);


    const metaRow = document.createElement("div");
    metaRow.className = "sd-detail-row";

    const lblStatus = document.createElement("label");
    lblStatus.textContent = _i18n("SD.QuestLog.StatusLabel", "Status:");
    metaRow.appendChild(lblStatus);

    const sel = document.createElement("select");
    sel.disabled = !isGM;
    for (const s of STATUS_OPTIONS) {
      const o = document.createElement("option");
      o.value = s.value; o.textContent = _i18n(s.labelKey, s.fallback);
      if (s.value === q.status) o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener("change", () => this._patchQuest(q.id, { status: sel.value }));
    metaRow.appendChild(sel);


    if (isGM) {
      const lblVis = document.createElement("label");
      lblVis.textContent = _i18n("SD.QuestLog.VisibilityLabel", "Visibility:");
      lblVis.style.marginLeft = "12px";
      metaRow.appendChild(lblVis);
      const visGroup = document.createElement("div");
      visGroup.className = "sd-vis-radio";
      for (const v of VIS_OPTIONS) {
        const lab = document.createElement("label");
        const r = document.createElement("input");
        r.type = "radio"; r.name = `vis_${q.id}`; r.value = v.value;
        if ((q.visibility?.mode ?? "visible") === v.value) r.checked = true;
        r.addEventListener("change", () => {
          const vis = foundry.utils.deepClone(q.visibility ?? { mode: "visible", players: [], gmRevealed: false });
          vis.mode = v.value;
          this._patchQuest(q.id, { visibility: vis });
        });
        lab.appendChild(r);
        lab.appendChild(document.createTextNode(" " + _i18n(v.labelKey, v.fallback)));
        visGroup.appendChild(lab);
      }
      metaRow.appendChild(visGroup);

      const reveal = document.createElement("button");
      reveal.className = "sd-btn";
      reveal.style.marginLeft = "auto";
      const revealed = !!q.visibility?.gmRevealed;
      reveal.innerHTML = `<i class="fas ${revealed ? "fa-eye" : "fa-eye-slash"}"></i> ${_esc(revealed ? _i18n("SD.QuestLog.RevealedToggle","Revealed") : _i18n("SD.QuestLog.RevealAction","Reveal"))}`;
      reveal.title = _i18n("SD.QuestLog.RevealHint", "Toggle GM reveal — overrides hidden so players can see it.");
      reveal.addEventListener("click", () => {
        const vis = foundry.utils.deepClone(q.visibility ?? { mode: "visible", players: [], gmRevealed: false });
        vis.gmRevealed = !vis.gmRevealed;
        this._patchQuest(q.id, { visibility: vis });
      });
      metaRow.appendChild(reveal);
    }
    host.appendChild(metaRow);


    if (isGM && (q.visibility?.mode === "perPlayer")) {
      const sect = document.createElement("div");
      sect.className = "sd-detail-section";
      const h = document.createElement("h4");
      h.textContent = _i18n("SD.QuestLog.PerPlayerLabel", "Visible to specific players");
      sect.appendChild(h);
      const grid = document.createElement("div");
      grid.className = "sd-player-pick";
      const players = (game.users?.contents ?? []).filter(u => !u.isGM);
      const sel = new Set(q.visibility?.players ?? []);
      for (const u of players) {
        const lab = document.createElement("label");
        lab.style.cssText = "display:flex;align-items:center;gap:6px;color:var(--sd-text);";
        const cb = document.createElement("input");
        cb.type = "checkbox"; cb.checked = sel.has(u.id);
        cb.addEventListener("change", () => {
          const vis = foundry.utils.deepClone(q.visibility ?? { mode: "perPlayer", players: [], gmRevealed: false });
          const set = new Set(vis.players ?? []);
          if (cb.checked) set.add(u.id); else set.delete(u.id);
          vis.players = [...set];
          this._patchQuest(q.id, { visibility: vis });
        });
        lab.appendChild(cb);
        const nm = document.createElement("span");
        nm.textContent = u.name;
        lab.appendChild(nm);
        grid.appendChild(lab);
      }
      sect.appendChild(grid);
      host.appendChild(sect);
    }


    {
      const sect = document.createElement("div");
      sect.className = "sd-detail-section";
      const h = document.createElement("h4");
      h.textContent = _i18n("SD.QuestLog.DescriptionLabel", "Description");
      sect.appendChild(h);
      const ta = document.createElement("textarea");
      ta.value = q.description ?? "";
      ta.placeholder = _i18n("SD.QuestLog.DescriptionPlaceholder", "Describe the quest. HTML allowed.");
      ta.disabled = !isGM;
      ta.addEventListener("change", () => this._patchQuest(q.id, { description: ta.value }));
      sect.appendChild(ta);
      host.appendChild(sect);
    }


    {
      const sect = document.createElement("div");
      sect.className = "sd-detail-section";
      const h = document.createElement("h4");
      h.textContent = _i18n("SD.QuestLog.SubtasksLabel", "Subtasks");
      sect.appendChild(h);

      const subs = q.subtasks ?? [];
      for (const s of subs) {
        if (!isGM && s.hidden && !s.done) continue;
        const row = document.createElement("div");
        row.className = "sd-subtask-row";

        const cb = document.createElement("input");
        cb.type = "checkbox"; cb.checked = !!s.done;
        cb.disabled = !isGM;
        cb.addEventListener("change", () => this._patchSubtask(q.id, s.id, { done: cb.checked }));
        row.appendChild(cb);

        const nm = document.createElement("input");
        nm.type = "text"; nm.value = s.name ?? "";
        nm.disabled = !isGM;
        nm.addEventListener("change", () => this._patchSubtask(q.id, s.id, { name: nm.value }));
        row.appendChild(nm);

        if (isGM) {
          const hidBtn = document.createElement("button");
          hidBtn.className = "sd-btn";
          hidBtn.title = _i18n("SD.QuestLog.SubtaskHiddenHint", "Toggle hidden — only shown when done.");
          hidBtn.innerHTML = `<i class="fas ${s.hidden ? "fa-eye-slash" : "fa-eye"}"></i>`;
          hidBtn.addEventListener("click", () => this._patchSubtask(q.id, s.id, { hidden: !s.hidden }));
          row.appendChild(hidBtn);

          const del = document.createElement("button");
          del.className = "sd-btn danger";
          del.innerHTML = `<i class="fas fa-trash"></i>`;
          del.title = _i18n("SD.Delete", "Delete");
          del.addEventListener("click", () => this._deleteSubtask(q.id, s.id));
          row.appendChild(del);
        }
        sect.appendChild(row);
      }
      if (isGM) {
        const add = document.createElement("button");
        add.className = "sd-btn";
        add.style.marginTop = "8px";
        add.innerHTML = `<i class="fas fa-plus"></i> ${_esc(_i18n("SD.QuestLog.AddSubtask","Add subtask"))}`;
        add.addEventListener("click", () => this._addSubtask(q.id));
        sect.appendChild(add);
      }
      host.appendChild(sect);
    }


    {
      const sect = document.createElement("div");
      sect.className = "sd-detail-section sd-rewards";
      const h = document.createElement("h4");
      h.style.cssText = "display:flex;align-items:center;gap:8px";
      h.innerHTML = `<i class="fas fa-gift"></i> ${_esc(_i18n("SD.QuestLog.RewardsLabel","Rewards"))}`;
      if (isGM) {
        const add = document.createElement("button");
        add.className = "sd-btn";
        add.style.cssText = "margin-left:auto;padding:3px 10px;font-size:11px";
        add.innerHTML = `<i class="fas fa-plus"></i> ${_esc(_i18n("SD.QuestLog.AddReward","Add reward"))}`;
        add.addEventListener("click", () => this._addReward(q.id));
        h.appendChild(add);
      }
      sect.appendChild(h);

      const list = document.createElement("div");
      list.style.cssText = "display:flex;flex-direction:column;gap:10px";
      const rewards = q.rewards ?? [];
      const visibleR = isGM ? rewards : rewards.filter(r => this._canSeeReward(q, r));
      if (!visibleR.length) {
        const empty = document.createElement("div");
        empty.style.cssText = "color:var(--sd-text-3);font-style:italic;font-size:11px;padding:6px";
        empty.textContent = isGM
          ? _i18n("SD.QuestLog.NoRewardsGM","No rewards yet — click Add reward.")
          : _i18n("SD.QuestLog.NoRewardsPlayer","No visible rewards.");
        list.appendChild(empty);
      } else {
        for (const r of visibleR) list.appendChild(this._renderRewardCard(q, r));
      }
      sect.appendChild(list);
      host.appendChild(sect);
    }


    if (isGM) {
      const sect = document.createElement("div");
      sect.className = "sd-detail-section";
      const h = document.createElement("h4");
      h.textContent = _i18n("SD.QuestLog.QuestGraphLabel", "Quest trigger graph");
      sect.appendChild(h);
      const intro = document.createElement("div");
      intro.style.cssText = "font-size:11px;color:var(--sd-text-3);line-height:1.5;margin-bottom:6px";
      intro.textContent = _i18n("SD.QuestLog.QuestGraphIntro",
        "Per-quest trigger graph: events from this quest, actions on its state and subtasks. Use 'this' as quest id to refer to the current quest.");
      sect.appendChild(intro);
      const btn = document.createElement("button");
      btn.className = "sd-btn";
      btn.style.cssText = "padding:6px 12px";
      btn.innerHTML = `<i class="fas fa-diagram-project"></i> ${_esc(_i18n("SD.QuestLog.OpenQuestGraph","Open Quest Graph"))}`;
      btn.addEventListener("click", async () => {
        const { FormulaGraph } = await import("../builder/formula-graph.mjs");
        const targetQuestId = q.id;
        const graph = new FormulaGraph(null, this.document, null, null, null, {
          mode: "questTrigger",
          customLoad: () => {
            const quests = this._quests();
            const cur = quests.find(x => x.id === targetQuestId);
            return cur?.questGraph ?? null;
          },
          customSave: async (data) => {
            const quests = foundry.utils.deepClone(this._quests());
            const cur = quests.find(x => x.id === targetQuestId);
            if (!cur) return;
            cur.questGraph = data;
            await this.document.update({ "system.quests": quests });
          }
        });
        graph.open();
      });
      sect.appendChild(btn);
      host.appendChild(sect);
    }


    {
      const actions = document.createElement("div");
      actions.className = "sd-quest-actions";

      const setActive = document.createElement("button");
      setActive.className = "sd-btn";
      setActive.innerHTML = `<i class="fas fa-bullseye"></i> ${_esc(_i18n("SD.QuestLog.SetActive","Set Active"))}`;
      setActive.title = _i18n("SD.QuestLog.SetActiveHint", "Mark this quest as active on a character. Players: their own; GM: pick.");
      setActive.addEventListener("click", () => this._setActive(q.id));
      actions.appendChild(setActive);

      if (isGM) {
        const complete = document.createElement("button");
        complete.className = "sd-btn";
        complete.innerHTML = `<i class="fas fa-check"></i> ${_esc(_i18n("SD.QuestLog.MarkCompleted","Mark Completed"))}`;
        complete.addEventListener("click", () => this._patchQuest(q.id, { status: "completed" }));
        actions.appendChild(complete);

        const fail = document.createElement("button");
        fail.className = "sd-btn";
        fail.innerHTML = `<i class="fas fa-xmark"></i> ${_esc(_i18n("SD.QuestLog.MarkFailed","Mark Failed"))}`;
        fail.addEventListener("click", () => this._patchQuest(q.id, { status: "failed" }));
        actions.appendChild(fail);

        const del = document.createElement("button");
        del.className = "sd-btn danger";
        del.style.marginLeft = "auto";
        del.innerHTML = `<i class="fas fa-trash"></i> ${_esc(_i18n("SD.QuestLog.DeleteQuest","Delete Quest"))}`;
        del.addEventListener("click", () => this._deleteQuest(q.id));
        actions.appendChild(del);
      }
      host.appendChild(actions);
    }
  }

  _renderChainGraphTab() {
    const wrap = document.createElement("div");
    wrap.className = "sd-panel active";
    wrap.style.cssText = "padding:20px;display:flex;flex-direction:column;gap:14px;height:100%;box-sizing:border-box";
    const isGM = this._isGM();
    const sys  = this.document.system ?? {};
    const quests = this._quests();

    const head = document.createElement("div");
    head.style.cssText = "display:flex;flex-direction:column;gap:6px";
    head.innerHTML = `
      <div style="font-weight:600;color:var(--sd-text);font-size:13px">
        <i class="fas fa-diagram-project"></i> ${_esc(_i18n("SD.QuestLog.ChainGraphTitle","Chain Graph"))}
      </div>
      <div style="font-size:11px;color:var(--sd-text-3);line-height:1.5">${_esc(_i18n("SD.QuestLog.ChainGraphIntro",
        "Quest-chain logic graph. Use Quest events/actions to gate quests on each other (e.g. activate B when A completes)."))}
      </div>`;
    wrap.appendChild(head);

    const openBtn = document.createElement("button");
    openBtn.className = "sd-btn";
    openBtn.style.cssText = "align-self:flex-start;padding:6px 12px";
    openBtn.innerHTML = `<i class="fas fa-diagram-project"></i> ${_esc(_i18n("SD.QuestLog.OpenChainGraph","Open Chain Graph"))}`;
    openBtn.disabled = !isGM;
    if (!isGM) openBtn.title = _i18n("SD.QuestLog.GraphGMOnly","Only GM can edit graphs.");
    openBtn.addEventListener("click", async () => {
      if (!isGM) return;
      const { FormulaGraph } = await import("../builder/formula-graph.mjs");
      const graph = new FormulaGraph(null, this.document, null, null, null, {
        mode: "chainTrigger",
        customLoad: () => this.document.system?.chainGraph ?? null,
        customSave: async (data) => {
          await this.document.update({ "system.chainGraph": data });
        }
      });
      graph.open();
    });
    wrap.appendChild(openBtn);


    const list = document.createElement("div");
    list.style.cssText = "display:flex;flex-direction:column;gap:6px;border:1px solid var(--sd-border);border-radius:6px;padding:10px;background:var(--sd-bg-2)";
    const lh = document.createElement("div");
    lh.style.cssText = "font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--sd-text-3);font-weight:700";
    lh.textContent = _i18n("SD.QuestLog.ChainQuestList","Quests in this chain (id reference)");
    list.appendChild(lh);

    if (!quests.length) {
      const empty = document.createElement("div");
      empty.style.cssText = "color:var(--sd-text-3);font-style:italic;font-size:11px;padding:6px";
      empty.textContent = _i18n("SD.QuestLog.NoQuests","No quests yet — add some on the Quests tab.");
      list.appendChild(empty);
    } else {
      const grid = document.createElement("div");
      grid.style.cssText = "display:grid;grid-template-columns:auto auto 1fr auto;gap:4px 14px;align-items:center;font-size:12px";
      const hdr = (txt) => {
        const d = document.createElement("div");
        d.style.cssText = "font-size:10px;text-transform:uppercase;color:var(--sd-text-3);font-weight:700;border-bottom:1px solid var(--sd-border);padding-bottom:3px";
        d.textContent = txt;
        return d;
      };
      grid.appendChild(hdr(_i18n("SD.QuestLog.ChainColIcon","")));
      grid.appendChild(hdr(_i18n("SD.QuestLog.ChainColStatus","Status")));
      grid.appendChild(hdr(_i18n("SD.QuestLog.ChainColName","Name")));
      grid.appendChild(hdr(_i18n("SD.QuestLog.ChainColId","Id (use in graph)")));
      for (const q of quests) {
        const ico = document.createElement("i");
        ico.className = `fas ${q.icon || "fa-flag"}`;
        ico.style.cssText = "color:var(--sd-text-2);width:16px;text-align:center";
        grid.appendChild(ico);

        const st = document.createElement("span");
        st.style.cssText = "font-size:10px;text-transform:uppercase;letter-spacing:.04em;padding:1px 6px;border-radius:3px;background:var(--sd-bg-3);color:var(--sd-text-2)";
        st.textContent = q.status ?? "";
        grid.appendChild(st);

        const nm = document.createElement("span");
        nm.style.cssText = "color:var(--sd-text);font-weight:500";
        nm.textContent = q.name ?? "";
        grid.appendChild(nm);

        const id = document.createElement("code");
        id.style.cssText = "background:var(--sd-bg);padding:1px 6px;border-radius:3px;font-size:11px;color:var(--sd-accent);user-select:all";
        id.textContent = q.id;
        grid.appendChild(id);
      }
      list.appendChild(grid);
    }
    wrap.appendChild(list);

    return wrap;
  }

  _renderSettingsTab() {
    const wrap = document.createElement("div");
    wrap.className = "sd-panel sd-settings active";
    const isGM = this._isGM();
    const sys  = this.document.system ?? {};

    const mk = (labelKey, fb, child) => {
      const row = document.createElement("div");
      row.className = "sd-detail-row";
      const lab = document.createElement("label");
      lab.style.minWidth = "140px";
      lab.textContent = _i18n(labelKey, fb);
      row.appendChild(lab);
      row.appendChild(child);
      return row;
    };

    const nameInp = document.createElement("input");
    nameInp.type = "text";
    nameInp.value = sys.chainName ?? "";
    nameInp.placeholder = _i18n("SD.QuestLog.ChainNamePlaceholder", "(uses item name when blank)");
    nameInp.disabled = !isGM;
    nameInp.style.flex = "1";
    nameInp.addEventListener("change", () => this.document.update({ "system.chainName": nameInp.value }));
    wrap.appendChild(mk("SD.QuestLog.ChainName", "Chain name", nameInp));

    const iconInp = document.createElement("input");
    iconInp.type = "text";
    iconInp.value = sys.chainIcon ?? "fa-scroll";
    iconInp.placeholder = "fa-scroll";
    iconInp.disabled = !isGM;
    iconInp.addEventListener("change", () => this.document.update({ "system.chainIcon": iconInp.value }));
    wrap.appendChild(mk("SD.QuestLog.ChainIcon", "Chain icon", iconInp));

    const descSect = document.createElement("div");
    descSect.className = "sd-detail-section";
    const dh = document.createElement("h4");
    dh.textContent = _i18n("SD.QuestLog.ChainDescription", "Chain description");
    descSect.appendChild(dh);
    const ta = document.createElement("textarea");
    ta.value = sys.chainDescription ?? "";
    ta.disabled = !isGM;
    ta.addEventListener("change", () => this.document.update({ "system.chainDescription": ta.value }));
    descSect.appendChild(ta);
    wrap.appendChild(descSect);

    const note = document.createElement("div");
    note.className = "sd-stub";
    note.textContent = _i18n("SD.QuestLog.PermissionsHint",
      "Players need Observer permission on this item to see quests in their UI.");
    wrap.appendChild(note);

    return wrap;
  }


  static async _promptText(label, defaultValue = "") {
    return new Promise(resolve => {
      const esc = s => String(s ?? "").replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;");
      new foundry.applications.api.DialogV2({
        modal: true,
        window: { title: label },
        content: `<div style="padding:6px 0">
          <input type="text" name="val" value="${esc(defaultValue)}"
            style="width:100%;background:var(--sd-bg-3);border:1px solid var(--sd-border);color:var(--sd-text);border-radius:4px;padding:4px 8px;font-size:13px" autofocus>
        </div>`,
        buttons: [
          { action: "save", label: _i18n("SD.Save","Save"), icon: "fas fa-floppy-disk", default: true,
            callback: (ev, btn) => {
              const r = btn.closest("[data-application]") ?? btn.closest("dialog") ?? document;
              resolve(r.querySelector("input[name='val']")?.value ?? null);
            }},
          { action: "cancel", label: _i18n("SD.Cancel","Cancel"), icon: "fas fa-xmark",
            callback: () => resolve(null) }
        ],
        submit: () => {}
      }).render(true);
    });
  }

  async _addQuest() {
    const id = _gid("q_");
    const newQ = {
      id, name: _i18n("SD.QuestLog.NewQuestName", "New Quest"),
      description: "", icon: "fa-flag",
      status: "available",
      visibility: { mode: "visible", players: [], gmRevealed: false },
      subtasks: [], questGraph: {}, rewards: [],
      chainCol: null, chainRow: null
    };
    const quests = foundry.utils.deepClone(this._quests());
    quests.push(newQ);
    this._selectedId = id;
    await this.document.update({ "system.quests": quests });
  }

  async _deleteQuest(qid) {
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: _i18n("SD.QuestLog.DeleteQuestTitle","Delete Quest") },
      content: `<p style="padding:8px 4px">${_esc(_i18n("SD.QuestLog.DeleteQuestConfirm","Permanently delete this quest? This cannot be undone."))}</p>`
    }).catch(() => false);
    if (!ok) return;
    const quests = (this._quests()).filter(q => q.id !== qid);
    if (this._selectedId === qid) this._selectedId = quests[0]?.id ?? null;
    await this.document.update({ "system.quests": quests });
  }

  async _patchQuest(qid, patch) {
    const quests = foundry.utils.deepClone(this._quests());
    const q = quests.find(x => x.id === qid);
    if (!q) return;
    const prevStatus      = q.status;
    const prevGmRevealed  = !!q.visibility?.gmRevealed;
    Object.assign(q, patch);
    await this.document.update({ "system.quests": quests });

    try {
      const logUuid = this.document.uuid;
      if (prevStatus !== q.status) {
        if (q.status === "active")    Hooks.callAll("sdQuestActivated", { questLogUuid: logUuid, questId: qid, userId: game.user?.id ?? "" });
        if (q.status === "completed") Hooks.callAll("sdQuestCompleted", { questLogUuid: logUuid, questId: qid });
        if (q.status === "failed")    Hooks.callAll("sdQuestFailed",    { questLogUuid: logUuid, questId: qid });
      }
      const newGmRevealed = !!q.visibility?.gmRevealed;
      if (prevGmRevealed !== newGmRevealed) {
        Hooks.callAll("sdQuestRevealed", { questLogUuid: logUuid, questId: qid, revealed: newGmRevealed });
      }
    } catch (e) { console.warn("SD | questlog hook fire failed", e); }
  }

  async _addSubtask(qid) {
    const quests = foundry.utils.deepClone(this._quests());
    const q = quests.find(x => x.id === qid);
    if (!q) return;
    q.subtasks = q.subtasks ?? [];
    q.subtasks.push({ id: _gid("s_"), name: _i18n("SD.QuestLog.NewSubtask","New subtask"), description: "", done: false, hidden: false });
    await this.document.update({ "system.quests": quests });
  }

  async _deleteSubtask(qid, sid) {
    const quests = foundry.utils.deepClone(this._quests());
    const q = quests.find(x => x.id === qid);
    if (!q) return;
    q.subtasks = (q.subtasks ?? []).filter(s => s.id !== sid);
    await this.document.update({ "system.quests": quests });
  }

  async _patchSubtask(qid, sid, patch) {
    const quests = foundry.utils.deepClone(this._quests());
    const q = quests.find(x => x.id === qid);
    if (!q) return;
    const s = (q.subtasks ?? []).find(x => x.id === sid);
    if (!s) return;
    const wasDone = !!s.done;
    Object.assign(s, patch);
    await this.document.update({ "system.quests": quests });
    if (!wasDone && s.done) {
      try { Hooks.callAll("sdSubtaskDone", { questLogUuid: this.document.uuid, questId: qid, subtaskId: sid }); }
      catch (e) { console.warn("SD | sdSubtaskDone hook fire failed", e); }
    }
  }

  async _setActive(qid) {
    const candidates = (game.actors?.contents ?? []).filter(a => a.isOwner && a.type === "character");
    if (!candidates.length) {
      ui.notifications?.warn(_i18n("SD.QuestLog.NoOwnedCharacter", "You don't own any character actor."));
      return;
    }
    let actor = candidates[0];
    if (candidates.length > 1) {
      actor = await SDQuestLogSheet._pickActor(candidates);
      if (!actor) return;
    }
    await actor.update({
      "system.activeQuest": {
        questLogUuid: this.document.uuid,
        questId:      qid
      }
    });
    try {
      Hooks.callAll("sdQuestActivated", {
        questLogUuid: this.document.uuid, questId: qid, actorId: actor.id, userId: game.user?.id ?? ""
      });
    } catch (_) {}
    ui.notifications?.info(`${_i18n("SD.QuestLog.ActivatedFor","Active quest set on")} ${actor.name}`);
  }

  _canSeeReward(q, r) {
    if (!r) return false;
    if (this._isGM()) return true;
    if (!this._canSee(q)) return false;
    if (r.revealed) return true;
    const v = r.visibility ?? "visible";
    if (v === "visible") return true;
    if (v === "hidden")  return false;
    if (v === "onCompletion") return q.status === "completed";
    if (v === "conditional") {
      try {
        const formula = String(r.conditionFormula ?? "").trim();
        if (!formula) return false;
        if (typeof globalThis._SD_FE === "undefined") return false;
        const { FormulaEngine } = globalThis._SD_FE;
        const ev = FormulaEngine.evaluate(formula, this.document);
        const n = Number(ev);
        if (Number.isFinite(n)) return n !== 0;
        return Boolean(ev);
      } catch { return false; }
    }
    return false;
  }


  _hasUserClaimed(r) {
    if (!r) return false;
    const uid = game.user?.id;
    if (!uid) return false;
    const cb = r.claimedBy ?? {};
    if (r.mode === "single") return Object.keys(cb).length > 0;
    return !!cb[uid];
  }

  _claimedNames(r) {
    const cb = r?.claimedBy ?? {};
    const ids = Object.keys(cb);
    if (!ids.length) return "";
    const names = ids.map(uid => game.users?.get(uid)?.name ?? uid);
    return names.join(", ");
  }

  _renderRewardCard(q, r) {
    const isGM = this._isGM();
    const card = document.createElement("div");
    card.className = "sd-reward-card";
    card.style.cssText = "border:1px solid var(--sd-border);border-radius:6px;padding:10px;background:var(--sd-bg-2);display:flex;flex-direction:column;gap:8px";


    const head = document.createElement("div");
    head.style.cssText = "display:flex;align-items:center;gap:8px";
    const icon = document.createElement("i");
    icon.className = `fas ${_esc(r.icon || "fa-gift")}`;
    icon.style.cssText = "color:#d8a83a;width:18px;text-align:center";
    head.appendChild(icon);

    if (isGM) {
      const nameInp = document.createElement("input");
      nameInp.type = "text";
      nameInp.value = r.name ?? "";
      nameInp.placeholder = _i18n("SD.QuestLog.RewardNamePh","Reward name");
      nameInp.style.cssText = "flex:1;background:var(--sd-bg-3);border:1px solid var(--sd-border);color:var(--sd-text);border-radius:4px;padding:3px 6px;font-size:12px";
      nameInp.addEventListener("change", () => this._patchReward(q.id, r.id, { name: nameInp.value }));
      head.appendChild(nameInp);
    } else {
      const nm = document.createElement("span");
      nm.style.cssText = "flex:1;color:var(--sd-text);font-weight:600;font-size:12px";
      nm.textContent = r.name ?? "";
      head.appendChild(nm);
    }


    const status = document.createElement("span");
    status.style.cssText = "font-size:9px;text-transform:uppercase;letter-spacing:.04em;padding:2px 6px;border-radius:3px;background:var(--sd-bg-3);color:var(--sd-text-2)";
    if (r.claimable) {
      status.textContent = _i18n("SD.QuestLog.Reward.Claimable","Claimable");
      status.style.background = "#3aa860"; status.style.color = "#fff";
    } else {
      status.textContent = _i18n("SD.QuestLog.Reward.Pending","Pending");
    }
    head.appendChild(status);

    if (r.mode === "single" && Object.keys(r.claimedBy ?? {}).length > 0) {
      const claimed = document.createElement("span");
      claimed.style.cssText = "font-size:10px;color:var(--sd-text-3)";
      claimed.textContent = `${_i18n("SD.QuestLog.Reward.ClaimedBy","Claimed by")}: ${this._claimedNames(r)}`;
      head.appendChild(claimed);
    }

    if (isGM) {
      const del = document.createElement("button");
      del.className = "sd-btn danger";
      del.style.cssText = "padding:3px 8px;font-size:10px;margin-left:auto";
      del.innerHTML = `<i class="fas fa-trash"></i>`;
      del.title = _i18n("SD.QuestLog.DeleteReward","Delete reward");
      del.addEventListener("click", () => this._deleteReward(q.id, r.id));
      head.appendChild(del);
    }
    card.appendChild(head);


    if (isGM) {
      const config = document.createElement("div");
      config.style.cssText = "display:grid;grid-template-columns:auto 1fr auto 1fr;gap:4px 8px;align-items:center;font-size:11px";
      const lbl = (txt) => { const d = document.createElement("div"); d.style.cssText="color:var(--sd-text-3);text-align:right"; d.textContent=txt; return d; };
      const sel = (val, opts, onChange) => {
        const s = document.createElement("select");
        s.style.cssText = "background:var(--sd-bg-3);border:1px solid var(--sd-border);color:var(--sd-text);border-radius:3px;padding:2px 4px;font-size:11px";
        for (const o of opts) {
          const op = document.createElement("option");
          op.value = o.v; op.textContent = o.l;
          if (o.v === val) op.selected = true;
          s.appendChild(op);
        }
        s.addEventListener("change", () => onChange(s.value));
        return s;
      };

      config.appendChild(lbl(_i18n("SD.QuestLog.Reward.Mode","Mode")));
      config.appendChild(sel(r.mode ?? "shared",
        [{v:"shared",l:_i18n("SD.QuestLog.Reward.ModeShared","Shared (each player)")},
         {v:"single",l:_i18n("SD.QuestLog.Reward.ModeSingle","Single (first claimer)")}],
        (v) => this._patchReward(q.id, r.id, { mode: v })));

      config.appendChild(lbl(_i18n("SD.QuestLog.Reward.Visibility","Visibility")));
      config.appendChild(sel(r.visibility ?? "visible",
        [{v:"visible",l:_i18n("SD.QuestLog.Reward.VisVisible","Visible")},
         {v:"hidden",l:_i18n("SD.QuestLog.Reward.VisHidden","Hidden")},
         {v:"onCompletion",l:_i18n("SD.QuestLog.Reward.VisOnComp","On quest completion")},
         {v:"conditional",l:_i18n("SD.QuestLog.Reward.VisCond","Conditional (formula)")}],
        (v) => this._patchReward(q.id, r.id, { visibility: v })));

      config.appendChild(lbl(_i18n("SD.QuestLog.Reward.GrantOn","Grant on")));
      config.appendChild(sel(r.grantOn ?? "manual",
        [{v:"manual",l:_i18n("SD.QuestLog.Reward.GrantManual","Manual (GM)")},
         {v:"questCompleted",l:_i18n("SD.QuestLog.Reward.GrantQC","Quest completed")},
         {v:"subtaskCompleted",l:_i18n("SD.QuestLog.Reward.GrantSubT","Subtask done")}],
        (v) => this._patchReward(q.id, r.id, { grantOn: v })));

      const subOptions = [{v:"",l:"—"}].concat((q.subtasks ?? []).map(s => ({ v:s.id, l: s.name || s.id })));
      config.appendChild(lbl(_i18n("SD.QuestLog.Reward.Subtask","Subtask")));
      config.appendChild(sel(r.subtaskId ?? "", subOptions,
        (v) => this._patchReward(q.id, r.id, { subtaskId: v })));

      card.appendChild(config);

      if ((r.visibility ?? "visible") === "conditional") {
        const condRow = document.createElement("div");
        condRow.style.cssText = "display:flex;gap:6px;align-items:center";
        const lab = document.createElement("span");
        lab.style.cssText = "font-size:11px;color:var(--sd-text-3);min-width:120px;text-align:right";
        lab.textContent = _i18n("SD.QuestLog.Reward.CondFormula","Visibility formula:");
        const inp = document.createElement("input");
        inp.type = "text";
        inp.value = r.conditionFormula ?? "";
        inp.placeholder = "{system.attributes.attr1.value} >= 5";
        inp.style.cssText = "flex:1;background:var(--sd-bg-3);border:1px solid var(--sd-border);color:var(--sd-text);border-radius:3px;padding:2px 6px;font-size:11px;font-family:monospace";
        inp.addEventListener("change", () => this._patchReward(q.id, r.id, { conditionFormula: inp.value }));
        condRow.appendChild(lab); condRow.appendChild(inp);
        card.appendChild(condRow);
      }
    } else {
      const summary = document.createElement("div");
      summary.style.cssText = "font-size:10px;color:var(--sd-text-3)";
      summary.textContent = (r.mode === "single")
        ? _i18n("SD.QuestLog.Reward.SingleHint","Single — first to claim wins.")
        : _i18n("SD.QuestLog.Reward.SharedHint","Shared — each player can claim.");
      card.appendChild(summary);
    }


    const itemsBlock = this._renderRewardItems(q, r, isGM);
    card.appendChild(itemsBlock);


    const curBlock = this._renderRewardCurrencies(q, r, isGM);
    card.appendChild(curBlock);


    const pcBlock = this._renderRewardPathChanges(q, r, isGM);
    card.appendChild(pcBlock);


    if (isGM) {
      const customRow = document.createElement("div");
      customRow.style.cssText = "display:flex;flex-direction:column;gap:3px";
      const lab = document.createElement("span");
      lab.style.cssText = "font-size:11px;color:var(--sd-text-3)";
      lab.textContent = _i18n("SD.QuestLog.Reward.CustomText","Custom text (shown to players):");
      customRow.appendChild(lab);
      const ta = document.createElement("textarea");
      ta.rows = 2;
      ta.value = r.customText ?? "";
      ta.style.cssText = "background:var(--sd-bg-3);border:1px solid var(--sd-border);color:var(--sd-text);border-radius:3px;padding:4px 6px;font-size:11px;resize:vertical";
      ta.addEventListener("change", () => this._patchReward(q.id, r.id, { customText: ta.value }));
      customRow.appendChild(ta);
      card.appendChild(customRow);
    } else if (r.customText) {
      const txt = document.createElement("div");
      txt.style.cssText = "font-size:11px;color:var(--sd-text-2);font-style:italic;background:var(--sd-bg-3);padding:6px 8px;border-radius:4px";
      txt.textContent = r.customText;
      card.appendChild(txt);
    }


    const actions = document.createElement("div");
    actions.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;border-top:1px solid var(--sd-border);padding-top:8px";

    if (isGM) {
      const reveal = document.createElement("button");
      reveal.className = "sd-btn";
      reveal.style.cssText = "padding:4px 10px;font-size:11px";
      reveal.innerHTML = `<i class="fas ${r.revealed ? "fa-eye" : "fa-eye-slash"}"></i> ${_esc(r.revealed ? _i18n("SD.QuestLog.Reward.Revealed","Revealed") : _i18n("SD.QuestLog.Reward.Reveal","Reveal"))}`;
      reveal.title = _i18n("SD.QuestLog.Reward.RevealHint","Toggle GM-revealed (overrides visibility hidden/onCompletion/conditional).");
      reveal.addEventListener("click", () => this._patchReward(q.id, r.id, { revealed: !r.revealed }));
      actions.appendChild(reveal);

      const claimable = document.createElement("button");
      claimable.className = "sd-btn";
      claimable.style.cssText = "padding:4px 10px;font-size:11px";
      claimable.innerHTML = `<i class="fas ${r.claimable ? "fa-unlock" : "fa-lock"}"></i> ${_esc(r.claimable ? _i18n("SD.QuestLog.Reward.MakeUnclaimable","Lock claim") : _i18n("SD.QuestLog.Reward.MakeClaimable","Make claimable"))}`;
      claimable.addEventListener("click", () => this._patchReward(q.id, r.id, { claimable: !r.claimable }));
      actions.appendChild(claimable);

      const grantAll = document.createElement("button");
      grantAll.className = "sd-btn";
      grantAll.style.cssText = "padding:4px 10px;font-size:11px;margin-left:auto";
      grantAll.innerHTML = `<i class="fas fa-bolt"></i> ${_esc(_i18n("SD.QuestLog.Reward.GrantAll","Grant to all"))}`;
      grantAll.title = _i18n("SD.QuestLog.Reward.GrantAllHint","Force-grant this reward to every player who has a character (skips claim).");
      grantAll.addEventListener("click", () => this._grantRewardToAll(q.id, r.id));
      actions.appendChild(grantAll);
    }

    if (!isGM) {
      const userClaimed = this._hasUserClaimed(r);
      const claim = document.createElement("button");
      claim.className = "sd-btn";
      claim.style.cssText = "padding:5px 14px;font-size:12px;margin-left:auto";

      if (userClaimed) {
        claim.disabled = true;
        claim.innerHTML = `<i class="fas fa-check"></i> ${_esc(_i18n("SD.QuestLog.Reward.Claimed","Claimed"))}`;
      } else if (r.mode === "single" && Object.keys(r.claimedBy ?? {}).length > 0) {
        claim.disabled = true;
        claim.innerHTML = `<i class="fas fa-lock"></i> ${_esc(_i18n("SD.QuestLog.Reward.AlreadyTaken","Already taken"))}`;
      } else if (!r.claimable) {
        claim.disabled = true;
        claim.innerHTML = `<i class="fas fa-hourglass"></i> ${_esc(_i18n("SD.QuestLog.Reward.NotYet","Not claimable yet"))}`;
      } else {
        claim.innerHTML = `<i class="fas fa-hand-holding-heart"></i> ${_esc(_i18n("SD.QuestLog.Reward.Claim","Claim"))}`;
        claim.addEventListener("click", () => this._claimReward(q.id, r.id));
      }
      actions.appendChild(claim);
    }
    card.appendChild(actions);

    return card;
  }

  _renderRewardItems(q, r, isGM) {
    const block = document.createElement("div");
    block.style.cssText = "display:flex;flex-direction:column;gap:4px";
    const head = document.createElement("div");
    head.style.cssText = "display:flex;align-items:center;gap:6px;font-size:11px;color:var(--sd-text-3);text-transform:uppercase;letter-spacing:.04em";
    head.innerHTML = `<i class="fas fa-box"></i> ${_esc(_i18n("SD.QuestLog.Reward.Items","Items"))}`;
    block.appendChild(head);

    const list = document.createElement("div");
    list.className = "sd-reward-items";
    list.style.cssText = "display:flex;flex-direction:column;gap:2px";
    if (isGM) {
      list.style.minHeight = "32px";
      list.style.border = "1px dashed var(--sd-border)";
      list.style.borderRadius = "4px";
      list.style.padding = "4px";
      list.addEventListener("dragover", (ev) => { ev.preventDefault(); list.style.background = "var(--sd-bg-3)"; });
      list.addEventListener("dragleave", () => { list.style.background = ""; });
      list.addEventListener("drop", async (ev) => {
        ev.preventDefault();
        list.style.background = "";
        try {
          const data = JSON.parse(ev.dataTransfer.getData("text/plain") || ev.dataTransfer.getData("application/json") || "{}");
          if (data?.type !== "Item" || !data?.uuid) return;
          const it = await fromUuid(data.uuid).catch(() => null);
          if (!it) return;
          await this._addRewardItem(q.id, r.id, { uuid: data.uuid, name: it.name ?? "", img: it.img ?? "", qty: 1 });
        } catch (e) { console.warn("SD | reward item drop failed", e); }
      });
    }

    const items = r.items ?? [];
    if (!items.length) {
      const e = document.createElement("div");
      e.style.cssText = "font-size:11px;color:var(--sd-text-3);font-style:italic;padding:3px 6px";
      e.textContent = isGM
        ? _i18n("SD.QuestLog.Reward.DropItems","Drag items here to add to this reward.")
        : _i18n("SD.QuestLog.Reward.NoItems","No items.");
      list.appendChild(e);
    }

    for (let idx = 0; idx < items.length; idx++) {
      const it = items[idx];
      const row = document.createElement("div");
      row.style.cssText = "display:flex;align-items:center;gap:6px;padding:2px 4px;border-radius:3px;background:var(--sd-bg-3)";

      const img = document.createElement("img");
      img.src = it.img || "icons/svg/item-bag.svg";
      img.style.cssText = "width:18px;height:18px;border-radius:3px;flex-shrink:0";
      row.appendChild(img);

      const nm = document.createElement("span");
      nm.style.cssText = "flex:1;font-size:12px;color:var(--sd-text)";
      nm.textContent = it.name || it.uuid;
      row.appendChild(nm);

      if (isGM) {
        const qty = document.createElement("input");
        qty.type = "number"; qty.min = "1"; qty.value = it.qty ?? 1;
        qty.style.cssText = "width:60px;background:var(--sd-bg);border:1px solid var(--sd-border);color:var(--sd-text);border-radius:3px;padding:2px 4px;font-size:11px";
        qty.addEventListener("change", () => this._patchRewardItem(q.id, r.id, idx, { qty: Math.max(1, Math.floor(Number(qty.value) || 1)) }));
        row.appendChild(qty);

        const del = document.createElement("button");
        del.className = "sd-btn danger"; del.style.cssText = "padding:2px 6px;font-size:10px";
        del.innerHTML = `<i class="fas fa-xmark"></i>`;
        del.addEventListener("click", () => this._removeRewardItem(q.id, r.id, idx));
        row.appendChild(del);
      } else {
        const qtyView = document.createElement("span");
        qtyView.style.cssText = "color:var(--sd-text-2);font-size:11px";
        qtyView.textContent = `×${it.qty ?? 1}`;
        row.appendChild(qtyView);
      }
      list.appendChild(row);
    }
    block.appendChild(list);
    return block;
  }

  _renderRewardCurrencies(q, r, isGM) {
    const block = document.createElement("div");
    block.style.cssText = "display:flex;flex-direction:column;gap:4px";
    const head = document.createElement("div");
    head.style.cssText = "display:flex;align-items:center;gap:6px;font-size:11px;color:var(--sd-text-3);text-transform:uppercase;letter-spacing:.04em";
    head.innerHTML = `<i class="fas fa-coins"></i> ${_esc(_i18n("SD.QuestLog.Reward.Currency","Currency"))}`;
    if (isGM) {
      const add = document.createElement("button");
      add.className = "sd-btn"; add.style.cssText = "margin-left:auto;padding:1px 6px;font-size:10px";
      add.innerHTML = `<i class="fas fa-plus"></i>`;
      add.title = _i18n("SD.QuestLog.Reward.AddCurrency","Add currency entry");
      add.addEventListener("click", () => this._addRewardCurrency(q.id, r.id));
      head.appendChild(add);
    }
    block.appendChild(head);

    const list = (r.currency ?? []);
    if (!list.length) {
      const e = document.createElement("div");
      e.style.cssText = "font-size:11px;color:var(--sd-text-3);font-style:italic;padding:3px 6px";
      e.textContent = _i18n("SD.QuestLog.Reward.NoCurrency","No currency reward.");
      block.appendChild(e);
    }
    const currencies = Array.isArray(CONFIG.SD?.currencies) ? CONFIG.SD.currencies : [];
    const curOpts = currencies.map(c => ({
      v: `system.currency.${c.key}`,
      l: `${c.key}${c.label ? ` (${game.i18n?.localize?.(c.label) ?? c.label})` : ""}`
    }));
    if (!curOpts.length) curOpts.push({ v:"system.currency.primary", l:"primary" });

    for (let idx = 0; idx < list.length; idx++) {
      const c = list[idx];
      const row = document.createElement("div");
      row.style.cssText = "display:grid;grid-template-columns:1fr 1fr auto;gap:4px;align-items:center";

      if (isGM) {
        const sel = document.createElement("select");
        sel.style.cssText = "background:var(--sd-bg-3);border:1px solid var(--sd-border);color:var(--sd-text);border-radius:3px;padding:2px 4px;font-size:11px";
        for (const o of curOpts) {
          const op = document.createElement("option");
          op.value = o.v; op.textContent = o.l;
          if (o.v === c.path) op.selected = true;
          sel.appendChild(op);
        }
        sel.addEventListener("change", () => this._patchRewardCurrency(q.id, r.id, idx, { path: sel.value }));
        row.appendChild(sel);

        const amt = document.createElement("input");
        amt.type = "text"; amt.value = c.amount ?? "0";
        amt.placeholder = _i18n("SD.QuestLog.Reward.AmountPh","Amount (number or formula)");
        amt.style.cssText = "background:var(--sd-bg-3);border:1px solid var(--sd-border);color:var(--sd-text);border-radius:3px;padding:2px 6px;font-size:11px";
        amt.addEventListener("change", () => this._patchRewardCurrency(q.id, r.id, idx, { amount: amt.value }));
        row.appendChild(amt);

        const del = document.createElement("button");
        del.className = "sd-btn danger"; del.style.cssText = "padding:2px 6px;font-size:10px";
        del.innerHTML = `<i class="fas fa-xmark"></i>`;
        del.addEventListener("click", () => this._removeRewardCurrency(q.id, r.id, idx));
        row.appendChild(del);
      } else {
        const lbl = document.createElement("span");
        lbl.style.cssText = "font-size:12px;color:var(--sd-text)";
        const key = String(c.path ?? "").replace(/^system\.currency\./,"");
        lbl.textContent = `${c.amount ?? "0"} ${key}`;
        row.appendChild(lbl);
      }
      block.appendChild(row);
    }
    return block;
  }

  _renderRewardPathChanges(q, r, isGM) {
    const block = document.createElement("div");
    block.style.cssText = "display:flex;flex-direction:column;gap:4px";
    const head = document.createElement("div");
    head.style.cssText = "display:flex;align-items:center;gap:6px;font-size:11px;color:var(--sd-text-3);text-transform:uppercase;letter-spacing:.04em";
    head.innerHTML = `<i class="fas fa-pen-to-square"></i> ${_esc(_i18n("SD.QuestLog.Reward.PathChanges","Path changes"))}`;
    if (isGM) {
      const add = document.createElement("button");
      add.className = "sd-btn"; add.style.cssText = "margin-left:auto;padding:1px 6px;font-size:10px";
      add.innerHTML = `<i class="fas fa-plus"></i>`;
      add.title = _i18n("SD.QuestLog.Reward.AddPathChange","Add path change");
      add.addEventListener("click", () => this._addRewardPathChange(q.id, r.id));
      head.appendChild(add);
    }
    block.appendChild(head);

    const list = (r.pathChanges ?? []);
    if (!list.length) {
      const e = document.createElement("div");
      e.style.cssText = "font-size:11px;color:var(--sd-text-3);font-style:italic;padding:3px 6px";
      e.textContent = _i18n("SD.QuestLog.Reward.NoPathChanges","No path changes.");
      block.appendChild(e);
    }

    const opOpts = [
      {v:"set",l:"="},{v:"add",l:"+"},{v:"sub",l:"-"},{v:"mul",l:"×"},{v:"min",l:"min"},{v:"max",l:"max"}
    ];

    for (const pc of list) {
      const row = document.createElement("div");
      row.style.cssText = "display:grid;grid-template-columns:1fr auto 1fr auto auto;gap:4px;align-items:center";
      if (isGM) {
        const path = document.createElement("input");
        path.type = "text"; path.value = pc.path ?? ""; path.placeholder = "system.xp";
        path.style.cssText = "background:var(--sd-bg-3);border:1px solid var(--sd-border);color:var(--sd-text);border-radius:3px;padding:2px 6px;font-size:11px;font-family:monospace";
        path.addEventListener("change", () => this._patchRewardPathChange(q.id, r.id, pc.id, { path: path.value }));
        row.appendChild(path);

        const op = document.createElement("select");
        op.style.cssText = "background:var(--sd-bg-3);border:1px solid var(--sd-border);color:var(--sd-text);border-radius:3px;padding:2px 4px;font-size:11px;width:60px";
        for (const o of opOpts) {
          const oo = document.createElement("option"); oo.value = o.v; oo.textContent = o.l;
          if (o.v === pc.op) oo.selected = true; op.appendChild(oo);
        }
        op.addEventListener("change", () => this._patchRewardPathChange(q.id, r.id, pc.id, { op: op.value }));
        row.appendChild(op);

        const val = document.createElement("input");
        val.type = "text"; val.value = pc.value ?? "0"; val.placeholder = _i18n("SD.QuestLog.Reward.ValuePh","Value or formula");
        val.style.cssText = "background:var(--sd-bg-3);border:1px solid var(--sd-border);color:var(--sd-text);border-radius:3px;padding:2px 6px;font-size:11px;font-family:monospace";
        val.addEventListener("change", () => this._patchRewardPathChange(q.id, r.id, pc.id, { value: val.value }));
        row.appendChild(val);

        const scope = document.createElement("select");
        scope.style.cssText = "background:var(--sd-bg-3);border:1px solid var(--sd-border);color:var(--sd-text);border-radius:3px;padding:2px 4px;font-size:11px";
        for (const s of [{v:"claimer",l:_i18n("SD.QuestLog.Reward.ScopeClaimer","Claimer")},{v:"all",l:_i18n("SD.QuestLog.Reward.ScopeAll","All on claim")}]) {
          const oo = document.createElement("option"); oo.value = s.v; oo.textContent = s.l;
          if (s.v === pc.scope) oo.selected = true; scope.appendChild(oo);
        }
        scope.addEventListener("change", () => this._patchRewardPathChange(q.id, r.id, pc.id, { scope: scope.value }));
        row.appendChild(scope);

        const del = document.createElement("button");
        del.className = "sd-btn danger"; del.style.cssText = "padding:2px 6px;font-size:10px";
        del.innerHTML = `<i class="fas fa-xmark"></i>`;
        del.addEventListener("click", () => this._removeRewardPathChange(q.id, r.id, pc.id));
        row.appendChild(del);
      } else {
        const txt = document.createElement("span");
        txt.style.cssText = "font-size:11px;color:var(--sd-text)";
        const opSym = (opOpts.find(o => o.v === pc.op) ?? {l:pc.op})?.l;
        const scopeTxt = pc.scope === "all" ? _i18n("SD.QuestLog.Reward.ScopeAll","All on claim") : _i18n("SD.QuestLog.Reward.ScopeClaimer","Claimer");
        txt.textContent = `${pc.path} ${opSym} ${pc.value}  (${scopeTxt})`;
        row.appendChild(txt);
      }
      block.appendChild(row);
    }
    return block;
  }


  async _addReward(qid) {
    const quests = foundry.utils.deepClone(this._quests());
    const q = quests.find(x => x.id === qid); if (!q) return;
    q.rewards = q.rewards ?? [];
    q.rewards.push({
      id: _gid("r_"),
      name: _i18n("SD.QuestLog.Reward.Default","Reward"),
      icon: "fa-gift",
      mode: "shared",
      visibility: "visible",
      conditionFormula: "",
      grantOn: "manual",
      subtaskId: "",
      items: [], currency: [], pathChanges: [],
      customText: "",
      revealed: false, claimable: false,
      claimedBy: {}
    });
    await this.document.update({ "system.quests": quests });
  }

  async _deleteReward(qid, rid) {
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: _i18n("SD.QuestLog.DeleteRewardTitle","Delete Reward") },
      content: `<p>${_esc(_i18n("SD.QuestLog.DeleteRewardConfirm","Permanently delete this reward?"))}</p>`,
      modal: true
    }).catch(() => false);
    if (!ok) return;
    const quests = foundry.utils.deepClone(this._quests());
    const q = quests.find(x => x.id === qid); if (!q) return;
    q.rewards = (q.rewards ?? []).filter(r => r.id !== rid);
    await this.document.update({ "system.quests": quests });
  }

  async _patchReward(qid, rid, patch) {
    const quests = foundry.utils.deepClone(this._quests());
    const q = quests.find(x => x.id === qid); if (!q) return;
    const r = (q.rewards ?? []).find(x => x.id === rid); if (!r) return;
    Object.assign(r, patch);
    await this.document.update({ "system.quests": quests });
  }


  async _addRewardItem(qid, rid, payload) {
    const quests = foundry.utils.deepClone(this._quests());
    const q = quests.find(x => x.id === qid); if (!q) return;
    const r = (q.rewards ?? []).find(x => x.id === rid); if (!r) return;
    r.items = r.items ?? [];
    r.items.push({ uuid: payload.uuid ?? "", name: payload.name ?? "", img: payload.img ?? "", qty: Math.max(1, Math.floor(Number(payload.qty) || 1)) });
    await this.document.update({ "system.quests": quests });
  }

  async _removeRewardItem(qid, rid, idx) {
    const quests = foundry.utils.deepClone(this._quests());
    const q = quests.find(x => x.id === qid); if (!q) return;
    const r = (q.rewards ?? []).find(x => x.id === rid); if (!r) return;
    r.items = (r.items ?? []).filter((_,i) => i !== idx);
    await this.document.update({ "system.quests": quests });
  }

  async _patchRewardItem(qid, rid, idx, patch) {
    const quests = foundry.utils.deepClone(this._quests());
    const q = quests.find(x => x.id === qid); if (!q) return;
    const r = (q.rewards ?? []).find(x => x.id === rid); if (!r) return;
    const it = (r.items ?? [])[idx]; if (!it) return;
    Object.assign(it, patch);
    await this.document.update({ "system.quests": quests });
  }


  async _addRewardCurrency(qid, rid) {
    const quests = foundry.utils.deepClone(this._quests());
    const q = quests.find(x => x.id === qid); if (!q) return;
    const r = (q.rewards ?? []).find(x => x.id === rid); if (!r) return;
    r.currency = r.currency ?? [];
    const currencies = Array.isArray(CONFIG.SD?.currencies) ? CONFIG.SD.currencies : [];
    const firstKey = currencies[0]?.key ?? "primary";
    r.currency.push({ path: `system.currency.${firstKey}`, amount: "0", label: "" });
    await this.document.update({ "system.quests": quests });
  }

  async _removeRewardCurrency(qid, rid, idx) {
    const quests = foundry.utils.deepClone(this._quests());
    const q = quests.find(x => x.id === qid); if (!q) return;
    const r = (q.rewards ?? []).find(x => x.id === rid); if (!r) return;
    r.currency = (r.currency ?? []).filter((_,i) => i !== idx);
    await this.document.update({ "system.quests": quests });
  }

  async _patchRewardCurrency(qid, rid, idx, patch) {
    const quests = foundry.utils.deepClone(this._quests());
    const q = quests.find(x => x.id === qid); if (!q) return;
    const r = (q.rewards ?? []).find(x => x.id === rid); if (!r) return;
    const c = (r.currency ?? [])[idx]; if (!c) return;
    Object.assign(c, patch);
    await this.document.update({ "system.quests": quests });
  }


  async _addRewardPathChange(qid, rid) {
    const quests = foundry.utils.deepClone(this._quests());
    const q = quests.find(x => x.id === qid); if (!q) return;
    const r = (q.rewards ?? []).find(x => x.id === rid); if (!r) return;
    r.pathChanges = r.pathChanges ?? [];
    r.pathChanges.push({ id: _gid("pc_"), path: "system.xp", op: "add", value: "0", scope: "claimer", label: "" });
    await this.document.update({ "system.quests": quests });
  }

  async _removeRewardPathChange(qid, rid, pid) {
    const quests = foundry.utils.deepClone(this._quests());
    const q = quests.find(x => x.id === qid); if (!q) return;
    const r = (q.rewards ?? []).find(x => x.id === rid); if (!r) return;
    r.pathChanges = (r.pathChanges ?? []).filter(p => p.id !== pid);
    await this.document.update({ "system.quests": quests });
  }

  async _patchRewardPathChange(qid, rid, pid, patch) {
    const quests = foundry.utils.deepClone(this._quests());
    const q = quests.find(x => x.id === qid); if (!q) return;
    const r = (q.rewards ?? []).find(x => x.id === rid); if (!r) return;
    const pc = (r.pathChanges ?? []).find(p => p.id === pid); if (!pc) return;
    Object.assign(pc, patch);
    await this.document.update({ "system.quests": quests });
  }


  async _claimReward(qid, rid) {
    const { SDQuest } = await import("../helpers/quest.mjs");
    await SDQuest.applyAction(
      { type:"questAction", op:"rewardClaim", questLogUuid: this.document.uuid, questId: qid, rewardId: rid },
      { questLogUuid: this.document.uuid, questId: qid, userId: game.user?.id ?? "" }
    );
  }

  async _grantRewardToAll(qid, rid) {
    const { SDQuest } = await import("../helpers/quest.mjs");
    await SDQuest.applyAction(
      { type:"questAction", op:"rewardGrantAll", questLogUuid: this.document.uuid, questId: qid, rewardId: rid },
      { questLogUuid: this.document.uuid, questId: qid, userId: game.user?.id ?? "" }
    );
  }

  static async _pickActor(actors) {
    return new Promise(resolve => {
      const opts = actors.map(a => `<option value="${a.id}">${_esc(a.name)}</option>`).join("");
      new foundry.applications.api.DialogV2({
        modal: true,
        window: { title: _i18n("SD.QuestLog.PickActor","Pick character") },
        content: `<div style="padding:6px 0">
          <select name="aid" style="width:100%;background:var(--sd-bg-3);border:1px solid var(--sd-border);color:var(--sd-text);border-radius:4px;padding:4px 8px;font-size:13px">${opts}</select>
        </div>`,
        buttons: [
          { action: "ok", label: _i18n("SD.OK","OK"), icon: "fas fa-check", default: true,
            callback: (ev, btn) => {
              const r = btn.closest("[data-application]") ?? btn.closest("dialog") ?? document;
              const id = r.querySelector("select[name='aid']")?.value ?? null;
              resolve(actors.find(a => a.id === id) ?? null);
            }},
          { action: "cancel", label: _i18n("SD.Cancel","Cancel"), icon: "fas fa-xmark",
            callback: () => resolve(null) }
        ],
        submit: () => {}
      }).render(true);
    });
  }
}
