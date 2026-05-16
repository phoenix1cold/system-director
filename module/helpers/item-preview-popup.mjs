import { WidgetRenderer } from "../builder/widget-renderer.mjs";

function _esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function _loc(key, fallback) {
  try {
    const s = game?.i18n?.localize?.(key);
    if (s && s !== key) return s;
  } catch {}
  return fallback;
}

const POPUP_ID = "sd-item-preview-popup";

export class ItemPreviewPopup {

  static _popup       = null;
  static _pinned      = null;
  static _activeRef   = null;
  static _activeTabId = null;
  static _bound       = false;
  static _hideTimer   = null;
  static _docs        = new WeakMap();

  static attach(root, doc) {
    if (!root || !doc) return;
    if (root.dataset.sdPreviewAttached === "1") {
      this._docs.set(root, doc);
      return;
    }
    root.dataset.sdPreviewAttached = "1";
    this._docs.set(root, doc);
    this._bindGlobal();

    root.addEventListener("mouseover", ev => this._onOver(ev, root));
    root.addEventListener("mouseout",  ev => this._onOut(ev, root));
    root.addEventListener("click",     ev => this._onClick(ev, root), true);
  }

  static _bindGlobal() {
    if (this._bound) return;
    this._bound = true;

    document.addEventListener("keydown", ev => {
      if (ev.key === "Escape" && this._pinned) {
        ev.stopPropagation();
        this._unpinAndHide();
      }
    }, true);

    document.addEventListener("mousedown", ev => {
      if (!this._pinned) return;
      const popup = this._popup;
      if (!popup) return;
      if (popup.contains(ev.target)) return;
      const previewEl = ev.target.closest?.("[data-sd-preview-ref]");
      if (previewEl) return;
      this._unpinAndHide();
    }, true);

    window.addEventListener("scroll", () => {
      if (this._pinned || !this._popup || this._popup.style.display === "none") return;
      this._hide();
    }, true);
  }

  static _onOver(ev, root) {
    const node = ev.target?.closest?.("[data-sd-preview-ref]");
    if (!node || !root.contains(node)) return;
    // Only fire when crossing the row boundary (not for inner descendants).
    const from = ev.relatedTarget;
    if (from && node.contains(from)) return;
    if (this._pinned) return;
    if (this._hideTimer) { clearTimeout(this._hideTimer); this._hideTimer = null; }
    const refKey = this._refKey(node);
    if (!refKey) return;
    if (this._activeRef === refKey && this._popup?.style.display === "block") {
      this._position(node);
      return;
    }
    const doc = this._docs.get(root);
    const payload = this._resolveNode(doc, node);
    if (!payload) return;
    this._activeRef = refKey;
    this._show(node, payload);
  }

  static _onOut(ev, root) {
    const node = ev.target?.closest?.("[data-sd-preview-ref]");
    if (!node || !root.contains(node)) return;
    // Don't fire when moving inside the same row.
    const to = ev.relatedTarget;
    if (to && node.contains(to)) return;
    // Don't hide if moving into the popup itself.
    if (to && this._popup && this._popup.contains(to)) return;
    if (this._pinned) return;
    if (this._hideTimer) clearTimeout(this._hideTimer);
    this._hideTimer = setTimeout(() => {
      this._hide();
      this._hideTimer = null;
    }, 80);
  }

  static _onClick(ev, root) {
    if (!ev.shiftKey) return;
    const node = ev.target?.closest?.("[data-sd-preview-ref]");
    if (!node || !root.contains(node)) return;

    ev.preventDefault();
    ev.stopPropagation();
    ev.stopImmediatePropagation?.();

    const refKey = this._refKey(node);
    if (!refKey) return;
    const doc = this._docs.get(root);
    const payload = this._resolveNode(doc, node);
    if (!payload) return;

    if (this._pinned && this._pinned.ref === refKey) {
      this._unpinAndHide();
      return;
    }

    this._pinned = { ref: refKey, payload };
    this._activeRef = refKey;
    this._show(node, payload, true);
  }

  static _refKey(node) {
    const ref = node.dataset.sdPreviewRef;
    if (!ref) return null;
    if (ref === "slot") {
      const slotId = node.dataset.slotId ?? "";
      const idx    = node.dataset.slotIndex ?? "";
      return `slot:${slotId}:${idx}`;
    }
    return ref;
  }

  static _resolveNode(doc, node) {
    const ref = node.dataset.sdPreviewRef;
    if (!doc || !ref) return null;

    if (ref === "slot") {
      return this._resolveSlot(doc, node);
    }

    const colon = ref.indexOf(":");
    if (colon < 0) return null;
    const kind = ref.slice(0, colon);
    const id   = ref.slice(colon + 1);

    if (kind === "item") {
      const item = doc.items?.get?.(id) ?? null;
      if (!item) return null;
      return { kind: "item", id, data: item };
    }
    if (kind === "effect") {
      const ef = doc.effects?.get?.(id) ?? null;
      if (ef) return { kind: "effect", id, data: ef };
      for (const it of (doc.items?.contents ?? [])) {
        const found = it.effects?.get?.(id);
        if (found) return { kind: "effect", id, data: found };
      }
      return null;
    }
    return null;
  }

  static _resolveSlot(doc, node) {
    const slotId = node.dataset.slotId ?? "";
    const idx    = Number(node.dataset.slotIndex ?? -1);
    if (!slotId || !Number.isFinite(idx) || idx < 0) return null;
    const snapshot = doc?.system?.slotContents?.[slotId]?.contents?.[idx];
    if (!snapshot) return null;
    // Try to resolve a live item first (more up-to-date), fall back to snapshot.
    let live = null;
    const itemId = snapshot._id ?? node.dataset.itemId ?? null;
    if (itemId) {
      try { live = doc.items?.get?.(itemId) ?? null; } catch {}
    }
    return { kind: "item", id: `${slotId}:${idx}`, data: live ?? snapshot };
  }

  static _ensurePopup() {
    if (this._popup && document.body.contains(this._popup)) return this._popup;
    const el = document.createElement("aside");
    el.id = POPUP_ID;
    el.className = "sd sd-item-preview-popup sd-prog-preview";
    el.dataset.pinned = "0";
    el.style.display = "none";
    el.addEventListener("mouseenter", () => {
      if (this._hideTimer) { clearTimeout(this._hideTimer); this._hideTimer = null; }
    });
    el.addEventListener("mouseleave", () => {
      if (this._pinned) return;
      if (this._hideTimer) clearTimeout(this._hideTimer);
      this._hideTimer = setTimeout(() => { this._hide(); this._hideTimer = null; }, 80);
    });
    el.addEventListener("click", ev => {
      const tabBtn = ev.target.closest?.("[data-preview-tab-id]");
      if (tabBtn) {
        ev.stopPropagation();
        this._activeTabId = tabBtn.dataset.previewTabId;
        this._rerenderPinned();
        return;
      }
      const unpin = ev.target.closest?.("[data-action='unpinPreview']");
      if (unpin) {
        ev.stopPropagation();
        this._unpinAndHide();
      }
    });
    document.body.appendChild(el);
    this._popup = el;
    return el;
  }

  static _show(node, payload, pinned = false) {
    const el = this._ensurePopup();
    el.innerHTML = this._buildHTML(payload, pinned || !!this._pinned);
    el.dataset.pinned = (pinned || !!this._pinned) ? "1" : "0";
    el.style.display = "block";
    this._position(node);
  }

  static _rerenderPinned() {
    if (!this._pinned || !this._popup) return;
    this._popup.innerHTML = this._buildHTML(this._pinned.payload, true);
    this._popup.dataset.pinned = "1";
  }

  static _hide() {
    if (!this._popup) return;
    this._popup.style.display = "none";
    this._activeRef = null;
    if (!this._pinned) this._activeTabId = null;
  }

  static _unpinAndHide() {
    this._pinned = null;
    this._activeTabId = null;
    this._hide();
  }

  static _position(node) {
    const el = this._popup;
    if (!el) return;
    const rect = node.getBoundingClientRect();
    el.style.maxWidth  = "420px";
    el.style.maxHeight = `${Math.min(560, window.innerHeight - 40)}px`;

    el.style.left = "0px";
    el.style.top  = "0px";
    const pw = el.offsetWidth  || 360;
    const ph = el.offsetHeight || 240;

    const margin = 8;
    let left = rect.right + margin;
    if (left + pw > window.innerWidth - 4) left = Math.max(4, rect.left - margin - pw);
    if (left + pw > window.innerWidth - 4) left = Math.max(4, window.innerWidth - pw - 4);

    let top = rect.top;
    if (top + ph > window.innerHeight - 4) top = Math.max(4, window.innerHeight - ph - 4);

    el.style.left = `${Math.round(left)}px`;
    el.style.top  = `${Math.round(top)}px`;
  }

  static _buildHTML(payload, isPinned) {
    if (!payload) return "";
    if (payload.kind === "item")    return this._renderItem(payload.data, isPinned);
    if (payload.kind === "effect")  return this._renderEffect(payload.data, isPinned);
    return "";
  }

  static _header(title, subtitle, img, isPinned) {
    const sub = subtitle ? `<div class="sd-prog-preview-sub">${_esc(subtitle)}</div>` : "";
    const pinTitle = _loc("SD.Progression.Unpin", "Unpin");
    const hint = _loc("SD.Preview.PinHint", "Shift+click to pin");
    const actions = isPinned
      ? `<button type="button" class="sd-prog-preview-unpin" data-action="unpinPreview" title="${_esc(pinTitle)}"><i class="fas fa-thumbtack"></i></button>`
      : `<span class="sd-item-preview-hint" title="${_esc(hint)}"><i class="fas fa-thumbtack"></i></span>`;
    return `<header class="sd-prog-preview-hdr">
      <div class="sd-prog-preview-img">${img ? `<img src="${_esc(img)}" alt="">` : `<i class="fas fa-image"></i>`}</div>
      <div class="sd-prog-preview-title-wrap">
        <div class="sd-prog-preview-title">${_esc(title)}</div>
        ${sub}
      </div>
      <div class="sd-prog-preview-actions">${actions}</div>
    </header>`;
  }

  static _renderItem(item, isPinned) {
    if (!item) return "";
    const name = item.name || "Item";
    const img  = item.img || "icons/svg/item-bag.svg";
    const type = item.type || "";

    const tabs = this._collectItemTabs(item);
    const head = this._header(name, type, img, isPinned);

    if (!tabs.length) {
      const body = `<div class="sd-prog-preview-body">
        <div class="sd-prog-preview-empty-mini">${_esc(_loc("SD.Progression.NoDescription", "No information."))}</div>
      </div>`;
      return head + body;
    }

    let activeId = this._activeTabId;
    if (!activeId || !tabs.some(t => t.id === activeId)) activeId = tabs[0].id;
    const activeTab = tabs.find(t => t.id === activeId) ?? tabs[0];

    let body = `<div class="sd-prog-preview-body">`;
    if (tabs.length > 1) {
      body += `<nav class="sd-prog-preview-tabs">`;
      for (const t of tabs) {
        body += `<button type="button" class="sd-prog-preview-tab${t.id === activeTab.id ? " active" : ""}" data-preview-tab-id="${_esc(t.id)}">${t.iconHtml ?? ""}${_esc(t.label)}</button>`;
      }
      body += `</nav>`;
    }
    body += `<div class="sd-prog-preview-tab-panel" data-tab-id="${_esc(activeTab.id)}">`;
    body += activeTab.render();
    body += `</div></div>`;
    return head + body;
  }

  static _collectItemTabs(item) {
    const sys = item.system ?? {};
    const customTabs = Array.isArray(sys.customTabs) ? sys.customTabs : [];
    const out = [];

    for (const tab of customTabs) {
      const rows = Array.isArray(tab.rows) ? tab.rows : [];
      const hasContent = rows.some(r => Array.isArray(r.widgets) && r.widgets.length > 0);
      if (!hasContent && !tab.label) continue;
      out.push({
        id: tab.id ?? `custom-${out.length}`,
        label: tab.label || _loc("SD.Progression.Tab", "Tab"),
        iconHtml: `<i class="fas fa-folder"></i>`,
        render: () => this._renderTabRows(item, rows)
      });
    }

    const effects = Array.isArray(item.effects?.contents) ? item.effects.contents
                  : Array.isArray(item.effects) ? item.effects : [];
    if (effects.length) {
      out.push({
        id: "_sys_effects",
        label: _loc("SD.Progression.Effects", "Effects"),
        iconHtml: `<i class="fas fa-sparkles"></i>`,
        render: () => this._renderEffectsList(effects)
      });
    }

    const tags = Array.isArray(sys.tags) ? sys.tags.filter(Boolean) : [];
    if (tags.length) {
      out.push({
        id: "_sys_tags",
        label: _loc("SD.Progression.Tags", "Tags"),
        iconHtml: `<i class="fas fa-tags"></i>`,
        render: () => {
          let h = `<div class="sd-prog-preview-tags">`;
          for (const t of tags) h += `<span class="sd-prog-preview-tag">${_esc(t)}</span>`;
          h += `</div>`;
          return h;
        }
      });
    }

    if (out.length === 0) {
      const desc = String(sys.description ?? "").trim();
      if (desc) {
        out.push({
          id: "_sys_desc",
          label: _loc("SD.Progression.Description", "Description"),
          iconHtml: `<i class="fas fa-scroll"></i>`,
          render: () => `<div class="sd-prog-preview-html">${desc}</div>`
        });
      }
    }

    return out;
  }

  static _renderTabRows(item, rows) {
    if (!rows.length) {
      return `<div class="sd-prog-preview-empty-mini">${_esc(_loc("SD.Progression.EmptyTab", "Empty tab."))}</div>`;
    }
    let html = `<div class="sd-prog-preview-rows">`;
    for (const row of rows) {
      const cols = Math.max(1, Math.min(9, Number(row.cols) || 3));
      html += `<div class="sd-prog-preview-row" style="display:grid;grid-template-columns:repeat(${cols},1fr);gap:6px;align-items:start;min-width:0;">`;
      for (const w of (row.widgets ?? [])) {
        if (w?.type === "vsection") html += this._renderVSection(item, w);
        else                         html += this._renderCell(item, row, w);
      }
      html += `</div>`;
    }
    html += `</div>`;
    return html;
  }

  static _renderVSection(item, vs) {
    const span = Math.max(1, Math.min(9, Number(vs.span) || 1));
    let html = `<div class="sd-prog-preview-vsection" style="grid-column:span ${span};display:flex;flex-direction:column;gap:5px;padding:6px;border:1px dashed var(--prog-border, rgba(255,255,255,.1));border-radius:5px;min-width:0;">`;
    if (vs.label) html += `<div class="sd-prog-preview-vsection-title">${_esc(vs.label)}</div>`;
    for (const cw of (vs.widgets ?? [])) {
      if (cw?.type === "vsection") html += this._renderVSection(item, cw);
      else                          html += this._renderCell(item, { cols: 1 }, cw, true);
    }
    html += `</div>`;
    return html;
  }

  static _renderCell(item, row, w, insideVS = false) {
    if (!w) return "";
    const rowCols = Math.max(1, Math.min(9, Number(row.cols) || 3));
    const span = insideVS ? 1 : Math.max(1, Math.min(rowCols, Number(w.span) || 1));
    let inner = "";
    try { inner = WidgetRenderer.render(w, item, false) ?? ""; }
    catch (err) { inner = `<div class="sd-prog-preview-widget-err">${_esc(String(err?.message ?? err))}</div>`; }
    if (!inner?.trim()) return "";
    return `<div class="sd-prog-preview-cell" style="grid-column:span ${span};min-width:0;">${inner}</div>`;
  }

  static _renderEffectsList(effects) {
    let html = `<div class="sd-prog-preview-effects-list">`;
    for (const ef of effects) {
      const changes  = Array.isArray(ef.changes) ? ef.changes : [];
      const disabled = !!ef.disabled;
      html += `<div class="sd-prog-preview-effect-card${disabled ? " is-disabled" : ""}">
        <div class="sd-prog-preview-effect-hdr">
          <img src="${_esc(ef.icon ?? ef.img ?? "icons/svg/aura.svg")}" alt="">
          <span class="sd-prog-preview-effect-name">${_esc(ef.name ?? "Effect")}</span>
          ${disabled
            ? `<span class="sd-prog-preview-pill is-off">${_esc(_loc("SD.Progression.EffectDisabled", "Disabled"))}</span>`
            : `<span class="sd-prog-preview-pill is-on">${_esc(_loc("SD.Progression.Enabled", "Enabled"))}</span>`}
        </div>`;
      if (changes.length) {
        html += `<div class="sd-prog-preview-changes">`;
        for (const ch of changes) {
          const m = Number(ch.mode);
          const sym = m === 5 ? "↑" : m === 4 ? "↓" : m === 3 ? "×" : m === 6 ? "=" : m === 1 ? "+" : m === 0 ? "⊕" : "?";
          html += `<div class="sd-prog-preview-change-row">
            <code>${_esc(ch.key ?? "")}</code>
            <span class="sd-prog-preview-change-sym">${sym}</span>
            <strong>${_esc(String(ch.value ?? ""))}</strong>
          </div>`;
        }
        html += `</div>`;
      }
      html += `</div>`;
    }
    html += `</div>`;
    return html;
  }

  static _renderEffect(ef, isPinned) {
    if (!ef) return "";
    const name = ef.name || "Effect";
    const img  = ef.icon || ef.img || "icons/svg/aura.svg";
    const changes  = Array.isArray(ef.changes) ? ef.changes : [];
    const disabled = !!ef.disabled;

    let body = `<div class="sd-prog-preview-body">`;
    body += `<div class="sd-prog-preview-section">
      <div class="sd-prog-preview-section-title"><i class="fas fa-magic"></i> ${_esc(_loc("SD.Progression.Effects", "Effect"))}</div>
      <div class="sd-prog-preview-meta">
        <span class="sd-prog-preview-pill ${disabled ? "is-off" : "is-on"}">${_esc(disabled
          ? _loc("SD.Progression.EffectDisabled", "Disabled")
          : _loc("SD.Progression.EffectEnabled", "Enabled"))}</span>
        <span class="sd-prog-preview-pill">${changes.length} ${_esc(_loc("SD.Progression.EffectChanges", "changes"))}</span>
      </div>
    </div>`;
    if (changes.length) {
      body += `<div class="sd-prog-preview-section">
        <div class="sd-prog-preview-section-title"><i class="fas fa-sliders-h"></i> ${_esc(_loc("SD.Progression.Changes", "Changes"))}</div>
        <div class="sd-prog-preview-changes">`;
      for (const ch of changes) {
        const m = Number(ch.mode);
        const sym = m === 5 ? "↑" : m === 4 ? "↓" : m === 3 ? "×" : m === 6 ? "=" : m === 1 ? "+" : m === 0 ? "⊕" : "?";
        body += `<div class="sd-prog-preview-change-row">
          <code>${_esc(ch.key ?? "")}</code>
          <span class="sd-prog-preview-change-sym">${sym}</span>
          <strong>${_esc(String(ch.value ?? ""))}</strong>
        </div>`;
      }
      body += `</div></div>`;
    } else {
      body += `<div class="sd-prog-preview-empty-mini">${_esc(_loc("SD.Progression.NoChanges", "This effect has no changes."))}</div>`;
    }

    const desc = String(ef.description ?? "").trim();
    if (desc) {
      body += `<div class="sd-prog-preview-section">
        <div class="sd-prog-preview-section-title"><i class="fas fa-scroll"></i> ${_esc(_loc("SD.Progression.Description", "Description"))}</div>
        <div class="sd-prog-preview-html">${desc}</div>
      </div>`;
    }

    body += `</div>`;
    return this._header(name, _loc("SD.Progression.Effects", "Effect"), img, isPinned) + body;
  }

  /**
   * Render a self-contained "card" for an item without any popup chrome.
   * Used by inventory/spellbook card-slider / card-grid widget variants so each
   * card looks like the hover preview without the pin button.
   *
   * Tabs (if any) are rendered as collapsible <details> sections so each card
   * stays interactive without requiring shared state.
   */
  static renderItemCardHTML(item) {
    if (!item) return "";
    const name = item.name || "Item";
    const img  = item.img || "icons/svg/item-bag.svg";
    const subtitle = item.type || "";

    const header = `<header class="sd-item-card-hdr">
      <div class="sd-item-card-img">${img ? `<img src="${_esc(img)}" alt="">` : `<i class="fas fa-image"></i>`}</div>
      <div class="sd-item-card-title-wrap">
        <div class="sd-item-card-title" title="${_esc(name)}">${_esc(name)}</div>
        ${subtitle ? `<div class="sd-item-card-sub">${_esc(subtitle)}</div>` : ""}
      </div>
    </header>`;

    const tabs = this._collectItemTabs(item);
    let body = `<div class="sd-item-card-body">`;
    if (!tabs.length) {
      body += `<div class="sd-item-card-empty">${_esc(_loc("SD.Progression.NoDescription", "No information."))}</div>`;
    } else if (tabs.length === 1) {
      body += `<div class="sd-item-card-section">${tabs[0].render()}</div>`;
    } else {
      for (let i = 0; i < tabs.length; i++) {
        const t = tabs[i];
        const open = i === 0 ? " open" : "";
        body += `<details class="sd-item-card-tab"${open}>
          <summary>${t.iconHtml ?? ""}<span>${_esc(t.label)}</span></summary>
          <div class="sd-item-card-tab-body">${t.render()}</div>
        </details>`;
      }
    }
    body += `</div>`;
    return header + body;
  }

  /**
   * Render a self-contained "card" for an ActiveEffect for the
   * effects card-slider / card-grid widget variants.
   */
  static renderEffectCardHTML(ef) {
    if (!ef) return "";
    const name = ef.name || "Effect";
    const img  = ef.icon || ef.img || "icons/svg/aura.svg";
    const changes  = Array.isArray(ef.changes) ? ef.changes : [];
    const disabled = !!ef.disabled;

    const header = `<header class="sd-item-card-hdr">
      <div class="sd-item-card-img"><img src="${_esc(img)}" alt=""></div>
      <div class="sd-item-card-title-wrap">
        <div class="sd-item-card-title" title="${_esc(name)}">${_esc(name)}</div>
        <div class="sd-item-card-sub">${_esc(_loc("SD.Progression.Effects", "Effect"))}</div>
      </div>
    </header>`;

    let body = `<div class="sd-item-card-body">
      <div class="sd-prog-preview-meta">
        <span class="sd-prog-preview-pill ${disabled ? "is-off" : "is-on"}">${_esc(disabled
          ? _loc("SD.Progression.EffectDisabled", "Disabled")
          : _loc("SD.Progression.EffectEnabled", "Enabled"))}</span>
        <span class="sd-prog-preview-pill">${changes.length} ${_esc(_loc("SD.Progression.EffectChanges", "changes"))}</span>
      </div>`;
    if (changes.length) {
      body += `<div class="sd-prog-preview-changes">`;
      for (const ch of changes) {
        const m = Number(ch.mode);
        const sym = m === 5 ? "↑" : m === 4 ? "↓" : m === 3 ? "×" : m === 6 ? "=" : m === 1 ? "+" : m === 0 ? "⊕" : "?";
        body += `<div class="sd-prog-preview-change-row">
          <code>${_esc(ch.key ?? "")}</code>
          <span class="sd-prog-preview-change-sym">${sym}</span>
          <strong>${_esc(String(ch.value ?? ""))}</strong>
        </div>`;
      }
      body += `</div>`;
    }
    const desc = String(ef.description ?? "").trim();
    if (desc) {
      body += `<div class="sd-prog-preview-html">${desc}</div>`;
    }
    body += `</div>`;
    return header + body;
  }
}
