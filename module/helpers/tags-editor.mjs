export class TagsEditor {

  /**
   * Wire all [data-tags-editor] elements inside a root DOM node.
   * @param {HTMLElement} root
   * @param {Actor|Item} doc
   */
  static wireAll(root, doc) {
    root.querySelectorAll("[data-tags-editor]").forEach(el => {
      if (el.dataset.tagsWired) return;
      el.dataset.tagsWired = "1";
      this._buildEditor(el, doc);
    });
  }

  static _buildEditor(host, doc) {
    const path  = host.dataset.tagsEditor;
    const raw   = foundry.utils.getProperty(doc, path);
    const tags  = Array.isArray(raw) ? [...raw] : [];

    // Build chip container
    const container = document.createElement("div");
    container.className = "tags-editor";
    container.style.cssText = "min-height:32px";

    const refresh = () => {
      [...container.children].forEach(c => {
        if (!c.classList.contains("tag-new-input")) c.remove();
      });
      // Re-add chips before the input
      tags.forEach((tag, idx) => {
        const chip = document.createElement("span");
        chip.className = "tag-chip";
        chip.innerHTML = `<span>${this._esc(tag)}</span>
          <button type="button" class="chip-remove" title="Remove">×</button>`;
        chip.querySelector(".chip-remove").addEventListener("click", async () => {
          tags.splice(idx, 1);
          await doc.update({ [path]: [...tags] });
          refresh();
        });
        container.insertBefore(chip, inp);
      });
    };

    // New tag input
    const inp = document.createElement("input");
    inp.type        = "text";
    inp.className   = "tag-new-input";
    inp.placeholder = "Add tag…";
    container.appendChild(inp);

    const addTag = async () => {
      const val = inp.value.trim();
      if (!val || tags.includes(val)) { inp.value = ""; return; }
      tags.push(val);
      inp.value = "";
      await doc.update({ [path]: [...tags] });
      refresh();
    };

    inp.addEventListener("keydown", async (ev) => {
      if (ev.key === "Enter" || ev.key === ",") { ev.preventDefault(); await addTag(); }
      if (ev.key === "Backspace" && !inp.value && tags.length) {
        tags.pop();
        await doc.update({ [path]: [...tags] });
        refresh();
      }
    });
    inp.addEventListener("blur", addTag);

    container.addEventListener("click", (ev) => {
      if (ev.target === container) inp.focus();
    });

    // Replace host
    host.replaceWith(container);
    refresh();
  }

  static _esc(s) {
    return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  }
}
