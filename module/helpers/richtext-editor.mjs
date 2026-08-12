
export class RichTextEditor {

  static wire(cell, doc) {
    if (!cell || !doc) return;

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

    const TextEditor = foundry?.applications?.ux?.TextEditor?.implementation
                    ?? foundry?.applications?.ux?.TextEditor
                    ?? globalThis.TextEditor;

    try {
      if (TextEditor?.create) {
        editor = await TextEditor.create({
          target:        content,
          fieldName:     path,
          document:      doc,
          collaborate:   false,
          relativeLinks: true,
          plugins:       {},
          save
        }, initial);
      } else {
        const PMEditor = foundry?.applications?.ux?.ProseMirrorEditor
                      ?? globalThis.ProseMirrorEditor;
        if (!PMEditor?.create) throw new Error("No ProseMirror editor available");
        editor = await PMEditor.create(content, initial, {
          document:      doc,
          fieldName:     path,
          collaborate:   false,
          relativeLinks: true,
          plugins:       {},
          save
        });
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
    ta.addEventListener("input",  stopBubble);
    ta.addEventListener("change", stopBubble);

    const close = () => {
      delete editWrap.dataset.sdRichtextOpen;
      editWrap.style.display = "none";
      editWrap.innerHTML = "";
      display.style.removeProperty("display");
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
