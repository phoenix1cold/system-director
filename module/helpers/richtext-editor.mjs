
export class RichTextEditor {

  static wire(cell, doc) {
    if (!cell || !doc) return;

    cell.querySelectorAll('.widget-richtext').forEach(widget => this._wireAutoHeight(widget));
    cell.querySelectorAll('prose-mirror.sd-richtext-native[data-path]').forEach(editorEl => this._wireNativeEditor(editorEl, doc));

    cell.querySelectorAll('.sd-richtext-editor[data-path]').forEach(editorEl => {
      if (editorEl.dataset.sdRichtextWired === "1") return;
      const path = editorEl.dataset.path;
      if (!path) return;
      editorEl.dataset.sdRichtextWired = "1";

      const editBtn = editorEl.querySelector(".sd-richtext-edit-btn");
      const content = editorEl.querySelector(".editor-content");
      if (!editBtn || !content) return;

      editBtn.addEventListener("click", ev => {
        ev.preventDefault();
        ev.stopPropagation();
        ev.stopImmediatePropagation?.();
        this._activateHtmlEditor(doc, path, editorEl).catch(err => {
          console.error("SD | richtext (html) activation failed:", err);
          this._deactivateHtmlEditor(editorEl);
        });
      });
    });

    cell.querySelectorAll('.richtext-display[data-path][data-mode="raw"]').forEach(display => {
      if (display.dataset.sdRichtextWired === "1") return;
      const widget   = display.closest(".widget-richtext");
      const editWrap = widget?.querySelector('.richtext-edit-wrap[data-mode="raw"]');
      if (!widget || !editWrap) return;
      display.dataset.sdRichtextWired = "1";

      display.addEventListener("click", ev => {
        ev.preventDefault();
        ev.stopPropagation();
        this._openRawEditor(doc, display, editWrap);
      });
    });
  }

  static _wireNativeEditor(editorEl, doc) {
    if (!editorEl || editorEl.dataset.sdRichtextNativeWired === "1") return;
    const path = editorEl.dataset.path || editorEl.getAttribute("name");
    if (!path) return;
    editorEl.dataset.sdRichtextNativeWired = "1";
    const resize = () => {
      this._stabilizeNativeLayout(editorEl);
      this._requestAutoHeight(editorEl);
    };
    for (const type of ["open", "close", "input", "change", "toggle"]) editorEl.addEventListener(type, resize);
    editorEl.addEventListener("save", ev => {
      ev.stopPropagation();
      const value = String(editorEl.value ?? editorEl.getAttribute("value") ?? "");
      Promise.resolve(doc.update({ [path]: value })).then(() => {
        editorEl.setAttribute("value", value);
        resize();
      }).catch(err => {
        console.error("SD | native richtext save failed:", err);
        ui.notifications?.error?.("Failed to save Rich Text content.");
      });
    });

    // Foundry builds the menu after the custom element is connected. Re-run
    // layout when that DOM changes so the toolbar always occupies real space
    // above the editable document instead of floating over its first lines.
    if (typeof MutationObserver !== "undefined") {
      const observer = new MutationObserver(resize);
      observer.observe(editorEl, { childList: true, subtree: true, attributes: true, attributeFilter: ["open", "toggled"] });
      if (editorEl.shadowRoot) observer.observe(editorEl.shadowRoot, { childList: true, subtree: true });
      editorEl._sdRichtextNativeObserver = observer;
    }
    resize();
  }

  static _stabilizeNativeLayout(editorEl) {
    if (!editorEl) return;
    const roots = [editorEl];
    if (editorEl.shadowRoot) roots.push(editorEl.shadowRoot);
    const important = (el, name, value) => el?.style?.setProperty?.(name, value, "important");

    for (const root of roots) {
      const containers = root.querySelectorAll?.(".editor-container, .prosemirror-container") ?? [];
      for (const container of containers) {
        important(container, "position", "relative");
        important(container, "display", "flex");
        important(container, "flex-direction", "column");
        important(container, "align-items", "stretch");
        important(container, "width", "100%");
        important(container, "height", "auto");
        important(container, "overflow", "visible");
      }

      const menus = root.querySelectorAll?.([
        "menu",
        ".editor-menu",
        ".editor-toolbar",
        "menu.prosemirror-menu",
        ".prosemirror-menu",
        ".ProseMirror-menubar",
        "[role='toolbar']"
      ].join(",")) ?? [];
      for (const menu of menus) {
        important(menu, "position", "relative");
        important(menu, "inset", "auto");
        important(menu, "transform", "none");
        important(menu, "float", "none");
        important(menu, "display", "flex");
        important(menu, "flex-wrap", "wrap");
        important(menu, "align-items", "center");
        important(menu, "align-content", "flex-start");
        important(menu, "gap", "4px");
        important(menu, "width", "100%");
        important(menu, "max-width", "100%");
        important(menu, "height", "auto");
        important(menu, "min-height", "36px");
        important(menu, "margin", "0 0 6px 0");
        important(menu, "padding", "4px");
        important(menu, "box-sizing", "border-box");
      }

      const documents = root.querySelectorAll?.(".ProseMirror, .editor-content[contenteditable='true']") ?? [];
      for (const content of documents) {
        important(content, "position", "relative");
        important(content, "inset", "auto");
        important(content, "transform", "none");
        important(content, "float", "none");
        important(content, "clear", "both");
        important(content, "width", "100%");
        important(content, "min-width", "0");
        important(content, "max-width", "100%");
        important(content, "height", "auto");
        important(content, "margin", "0");
        important(content, "box-sizing", "border-box");
        important(content, "overflow-wrap", "anywhere");
        important(content, "word-break", "break-word");
        important(content, "white-space", "pre-wrap");
      }
    }
  }

  static _wireAutoHeight(widget) {
    if (!widget || widget.dataset.sdRichtextAutoHeight === "1") return;
    widget.dataset.sdRichtextAutoHeight = "1";

    let scheduled = false;
    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      const run = () => {
        scheduled = false;
        if (!widget.isConnected) return;

        widget.style.setProperty("height", "auto", "important");
        widget.style.setProperty("max-height", "none", "important");
        widget.style.setProperty("overflow", "visible", "important");

        const expandable = widget.querySelectorAll([
          ".richtext-display",
          ".sd-richtext-editor",
          ".editor-content",
          "prose-mirror",
          ".ProseMirror",
          ".richtext-edit-wrap"
        ].join(","));
        expandable.forEach(el => {
          el.style.setProperty("height", "auto", "important");
          el.style.setProperty("max-height", "none", "important");
          el.style.setProperty("overflow", "visible", "important");
        });

        widget.querySelectorAll("textarea.richtext-editor").forEach(ta => {
          ta.style.setProperty("height", "auto", "important");
          const next = Math.max(80, Math.ceil(ta.scrollHeight || 0));
          if (next) ta.style.setProperty("height", `${next}px`, "important");
        });

        const cell = widget.closest("[data-widget-id]");
        if (cell) {
          cell.style.setProperty("height", "auto", "important");
          cell.style.setProperty("max-height", "none", "important");
          cell.style.setProperty("overflow", "visible", "important");
          cell.style.setProperty("align-self", "start");
          cell.style.removeProperty("min-height");
          const natural = Math.max(0, Math.ceil(widget.scrollHeight || widget.getBoundingClientRect?.().height || 0));
          if (natural > 0) cell.style.setProperty("min-height", `${natural}px`);
        }

        // A nested Rich Text in a free-layout Widget Builder keeps the user's
        // configured height as a minimum, then grows beyond it with content.
        const freeElement = widget.closest(".sd-wb-element");
        if (freeElement) {
          if (!freeElement.dataset.sdRichtextBaseHeight) {
            const inlineHeight = parseFloat(freeElement.style.height || "0") || 0;
            freeElement.dataset.sdRichtextBaseHeight = String(inlineHeight);
          }
          const base = Number(freeElement.dataset.sdRichtextBaseHeight) || 0;
          const natural = Math.max(base, Math.ceil(widget.scrollHeight || widget.getBoundingClientRect?.().height || 0));
          freeElement.style.setProperty("height", "auto", "important");
          if (natural > 0) freeElement.style.setProperty("min-height", `${natural}px`);
          freeElement.style.setProperty("overflow", "visible", "important");

          const canvas = freeElement.closest(".sd-wb-canvas");
          if (canvas) {
            if (!canvas.dataset.sdRichtextBaseHeight) {
              const inlineHeight = parseFloat(canvas.style.height || "0") || 0;
              canvas.dataset.sdRichtextBaseHeight = String(inlineHeight);
            }
            const baseCanvas = Number(canvas.dataset.sdRichtextBaseHeight) || 0;
            const top = parseFloat(freeElement.style.top || "0") || 0;
            const bottom = top + Math.max(natural, freeElement.scrollHeight || 0);
            canvas.style.setProperty("min-height", `${Math.max(baseCanvas, Math.ceil(bottom))}px`);
          }
        }
      };
      if (typeof queueMicrotask === "function") queueMicrotask(run);
      else Promise.resolve().then(run).catch(() => setTimeout(run, 0));
    };

    widget.addEventListener("input", schedule, true);
    widget.addEventListener("change", schedule, true);
    widget.addEventListener("sd-richtext-resize", schedule);

    if (typeof MutationObserver !== "undefined") {
      const mo = new MutationObserver(schedule);
      mo.observe(widget, { childList: true, subtree: true, characterData: true });
      widget._sdRichtextMutationObserver = mo;
    }
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(schedule);
      ro.observe(widget);
      widget._sdRichtextResizeObserver = ro;
    }
    schedule();
  }

  static _requestAutoHeight(element) {
    const widget = element?.closest?.(".widget-richtext");
    if (!widget) return;
    widget.dispatchEvent(new Event("sd-richtext-resize"));
  }

  static async _activateHtmlEditor(doc, path, editorEl) {
    if (editorEl.dataset.sdRichtextActive === "1") return;

    if (!editorEl.querySelector(".editor-content")) return;

    editorEl.dataset.sdRichtextActive = "1";
    editorEl.classList.add("editor-active");

    const stored  = this._readPath(doc, path);
    const initial = this._normaliseForEditor(stored);

    this._sweepStrayEditorChrome(editorEl);
    const content = this._resetEditorChildren(editorEl);
    const editBtn = editorEl.querySelector(".sd-richtext-edit-btn");
    if (editBtn) editBtn.style.display = "none";

    let editor = null;
    let closed = false;
    const cleanup = (restoreValue = stored) => {
      if (closed) return;
      closed = true;
      try { editor?.destroy?.(); } catch {}
      editor = null;
      this._deactivateHtmlEditor(editorEl, restoreValue);
    };

    const save = async () => {
      const value = this._extractEditorValue(editor, content, initial);
      try {
        await doc.update({ [path]: value });
      } catch (err) {
        console.error("SD | richtext save failed:", err);
        ui.notifications?.error?.("Failed to save Rich Text content.");
        return;
      }
      cleanup(value);
    };

    // Foundry 13/14: create(targetHTMLElement, content, options).
    // TextEditor.implementation resolves to the configured editor class.
    const PMEditor = foundry?.applications?.ux?.ProseMirrorEditor
                  ?? foundry?.applications?.ux?.TextEditor?.implementation
                  ?? globalThis.ProseMirrorEditor;

    try {
      if (PMEditor?.create) {
        editor = await PMEditor.create(content, initial, {
          document:      doc,
          fieldName:     path,
          collaborate:   false,
          relativeLinks: true,
          plugins:       {},
          save
        });
      } else {
        // Compatibility for older legacy TextEditor implementations only.
        const LegacyTextEditor = globalThis.TextEditor;
        if (!LegacyTextEditor?.create) throw new Error("No ProseMirror editor available");
        editor = await LegacyTextEditor.create({
          target:        content,
          fieldName:     path,
          document:      doc,
          collaborate:   false,
          relativeLinks: true,
          plugins:       {},
          save
        }, initial);
      }
    } catch (err) {
      console.error("SD | richtext editor creation failed:", err);
      this._deactivateHtmlEditor(editorEl, stored);
      ui.notifications?.error?.("Failed to open Rich Text editor.");
      return;
    }

    editorEl._sdPM = editor;

    const oldChrome = editorEl.querySelector(".sd-richtext-chrome");
    oldChrome?.remove();

    const chrome = document.createElement("div");
    chrome.className = "sd-richtext-chrome";

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "save";
    const saveLabel = (game?.i18n?.localize?.("EDITOR.Save") || "Save Entry");
    saveBtn.innerHTML = `<i class="fa-solid fa-feather"></i> ${this._esc(saveLabel)}`;
    saveBtn.addEventListener("click", ev => {
      ev.preventDefault();
      ev.stopPropagation();
      save();
    });

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "sd-richtext-cancel-btn";
    const cancelLabel = (game?.i18n?.localize?.("Cancel") || "Cancel");
    cancelBtn.innerHTML = `<i class="fa-solid fa-xmark"></i> ${this._esc(cancelLabel)}`;
    cancelBtn.addEventListener("click", ev => {
      ev.preventDefault();
      ev.stopPropagation();
      cleanup();
    });

    chrome.appendChild(cancelBtn);
    chrome.appendChild(saveBtn);
    editorEl.appendChild(chrome);

    const onKey = ev => {
      if (ev.key !== "Escape") return;
      ev.preventDefault();
      ev.stopPropagation();
      cleanup();
    };
    editorEl.addEventListener("keydown", onKey, true);
    editorEl._sdRichtextKeyHandler = onKey;

    try {
      const pm = content.querySelector(".ProseMirror");
      pm?.focus?.();
    } catch {}
    this._requestAutoHeight(editorEl);
  }

  static _esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  static _resetEditorChildren(editorEl) {
    const pencil = editorEl.querySelector(".sd-richtext-edit-btn");

    while (editorEl.firstChild) editorEl.removeChild(editorEl.firstChild);

    const content = document.createElement("div");
    content.className = "editor-content";
    editorEl.appendChild(content);

    if (pencil) {
      pencil.style.display = "";
      editorEl.appendChild(pencil);
    }
    return content;
  }

  static _deactivateHtmlEditor(editorEl, restoreValue = null) {
    if (!editorEl) return;
    delete editorEl.dataset.sdRichtextActive;
    editorEl.classList.remove("editor-active");

    try { editorEl._sdPM?.destroy?.(); } catch {}
    delete editorEl._sdPM;

    const keyHandler = editorEl._sdRichtextKeyHandler;
    if (keyHandler) editorEl.removeEventListener("keydown", keyHandler, true);
    delete editorEl._sdRichtextKeyHandler;

    const content = this._resetEditorChildren(editorEl);
    if (content) {
      const display = typeof restoreValue === "string"
        ? this._displayHTMLFromRich(restoreValue)
        : "";
      content.innerHTML = display;
    }

    this._sweepStrayEditorChrome(editorEl);
    this._requestAutoHeight(editorEl);

  }

  static _sweepStrayEditorChrome(editorEl) {
    const widget = editorEl.closest(".widget-richtext") || editorEl;
    const stray = widget.querySelectorAll([
      "menu.prosemirror-menu",
      ".prosemirror-menu",
      ".prosemirror-dropdown",
      ".ProseMirror",
      ".ProseMirror-menubar",
      ".sd-richtext-chrome"
    ].join(","));
    stray.forEach(n => {

      if (n.classList.contains("editor-content")) return;
      if (n.classList.contains("sd-richtext-edit-btn")) return;
      n.remove();
    });
  }

  static _openRawEditor(doc, display, editWrap) {
    if (editWrap.dataset.sdRichtextOpen === "1") return;
    const path = display.dataset.path;
    if (!path) return;

    editWrap.dataset.sdRichtextOpen = "1";
    display.style.display  = "none";
    editWrap.style.display = "block";

    const initialRaw = this._readPath(doc, path);

    editWrap.innerHTML = `
      <textarea class="richtext-editor sd-richtext-raw" rows="4"
        style="width:100%;min-height:80px;resize:vertical;background:var(--sd-w-bg,var(--sd-bg));border:1px solid var(--sd-accent);border-radius:4px 4px 0 0;color:var(--sd-w-fg,var(--sd-text));font-size:12px;padding:6px 8px;box-sizing:border-box;font-family:inherit;line-height:1.6;display:block"
        placeholder="Enter text…"></textarea>
      <div style="display:flex;gap:6px;padding:4px 0 2px">
        <button type="button" class="richtext-save"
          style="flex:1;background:rgba(76,175,80,.18);border:1px solid var(--sd-success,#3a3);border-radius:4px;color:var(--sd-success,#3a3);cursor:pointer;font-size:11px;padding:4px 8px">✓ Save</button>
        <button type="button" class="richtext-cancel"
          style="background:var(--sd-danger-dim,rgba(255,80,80,.18));border:1px solid var(--sd-danger,#f55);border-radius:4px;color:var(--sd-danger,#f55);cursor:pointer;font-size:11px;padding:4px 10px">✕</button>
      </div>`;

    const ta     = editWrap.querySelector(".richtext-editor");
    const save   = editWrap.querySelector(".richtext-save");
    const cancel = editWrap.querySelector(".richtext-cancel");
    if (!ta) return;
    ta.value = initialRaw;
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);

    const stopBubble = ev => ev.stopPropagation();
    ta.addEventListener("input",  ev => { stopBubble(ev); this._requestAutoHeight(ta); });
    ta.addEventListener("change", ev => { stopBubble(ev); this._requestAutoHeight(ta); });
    this._requestAutoHeight(ta);

    const close = () => {
      delete editWrap.dataset.sdRichtextOpen;
      editWrap.style.display = "none";
      editWrap.innerHTML = "";
      display.style.removeProperty("display");
      this._requestAutoHeight(display);
    };

    const commit = async () => {
      const value = ta.value;
      try {
        await doc.update({ [path]: value });
      } catch (err) {
        console.error("SD | richtext (raw) save failed:", err);
        ui.notifications?.error?.("Failed to save Rich Text content.");
        return;
      }
      close();
    };

    save?.addEventListener("click", ev => { ev.preventDefault(); commit(); });
    cancel?.addEventListener("click", ev => { ev.preventDefault(); close(); });
    ta.addEventListener("keydown", ev => {
      if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) {
        ev.preventDefault();
        commit();
      }
      if (ev.key === "Escape") {
        ev.preventDefault();
        close();
      }
    });
  }

  static _readPath(doc, path) {
    if (!path) return "";
    try {
      return String(foundry.utils.getProperty(doc, path) ?? "");
    } catch {
      return "";
    }
  }

  static _normaliseForEditor(raw) {
    const s = String(raw ?? "");
    if (!s) return "";
    if (/<[a-z][\s\S]*>/i.test(s)) return s;
    const escaped = s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    const paragraphs = escaped
      .split(/\r\n?\r\n?|\n\n+/)
      .map(p => `<p>${p.replace(/\r\n?|\n/g, "<br>")}</p>`)
      .join("");
    return paragraphs || `<p>${escaped}</p>`;
  }

  static _displayHTMLFromRich(value) {
    const s = String(value ?? "");
    if (!s) return "";
    if (/<[a-z][\s\S]*>/i.test(s)) return this._stripEditorChrome(s);
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\r\n?|\n/g, "<br>");
  }

  static _stripEditorChrome(html) {
    try {
      const doc = new DOMParser().parseFromString(
        `<!doctype html><body>${html}</body>`, "text/html");
      const body = doc.body;
      if (!body) return html;

      const killSelectors = [
        "menu.prosemirror-menu",
        ".prosemirror-menu",
        ".prosemirror-dropdown",
        ".editor-menu",
        ".sd-richtext-chrome",
        ".sd-richtext-edit-btn",
        ".editor-edit",
        ".save",
        ".sd-richtext-cancel-btn",

        ".ProseMirror-menubar",
        ".ProseMirror-menuitem",
        ".ProseMirror-icon",
        ".ProseMirror-gapcursor",
        ".ProseMirror-widget"
      ];

      body.querySelectorAll(killSelectors.join(",")).forEach(n => n.remove());

      const unwrapSelectors = [".editor", ".ProseMirror", ".editor-content"];
      for (const sel of unwrapSelectors) {
        body.querySelectorAll(sel).forEach(node => {
          while (node.firstChild) node.parentNode.insertBefore(node.firstChild, node);
          node.remove();
        });
      }

      body.querySelectorAll("[contenteditable], [data-pm-slice], [translate]")
          .forEach(n => {
            n.removeAttribute("contenteditable");
            n.removeAttribute("data-pm-slice");
            if (n.getAttribute("translate") === "no") n.removeAttribute("translate");
          });

      return body.innerHTML;
    } catch {
      return html;
    }
  }

  static _extractEditorValue(editor, target, fallback = "") {

    try {
      if (editor && typeof editor.value === "string") {
        return this._stripEditorChrome(editor.value);
      }
    } catch {}
    try {
      const dom = editor?.view?.dom ?? target?.querySelector?.(".ProseMirror");
      if (dom?.innerHTML) return this._stripEditorChrome(dom.innerHTML);
    } catch {}
    return fallback ?? "";
  }
}
