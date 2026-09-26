// Visual editor for array values (Database `array` / `token_pool` records and
// Database variables of type array). Entries can be typed, dropped from the
// sidebar (Items, Actors, Journals, …) or taken from Database variables — either
// their current value or a `{system.values.<id>}` reference that resolves at run time.
import { openFoundryWindow } from "./foundry-window-host.mjs";
import { getValueDefinitions, readDatabaseValue, valueStoragePath } from "./value-database.mjs";

const esc = value => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const randomId = () => (globalThis.foundry?.utils?.randomID?.(8) ?? Math.random().toString(36).slice(2, 10));

/** Accept a JSON array, a comma separated string or a real array. */
export function parseArrayValue(value) {
  if (Array.isArray(value)) return value.slice();
  if (value === null || value === undefined) return [];
  const text = String(value).trim();
  if (!text) return [];
  if (text.startsWith("[")) { try { const parsed = JSON.parse(text); if (Array.isArray(parsed)) return parsed; } catch {} }
  return text.split(",").map(s => s.trim()).filter(Boolean);
}

const UUID_RE = /^(Actor|Item|JournalEntry|Scene|RollTable|Macro|Cards|Playlist|Compendium)\.[A-Za-z0-9._-]+$/;

function entryMeta(value) {
  if (value !== null && typeof value === "object") return { icon:"fa-brackets-curly", label:JSON.stringify(value), kind:"object" };
  const text = String(value ?? "");
  if (UUID_RE.test(text)) {
    let doc = null;
    try { doc = globalThis.fromUuidSync?.(text) ?? null; } catch { doc = null; }
    const type = text.split(".")[0];
    const icon = type === "Actor" ? "fa-user" : type === "Item" ? "fa-suitcase" : type === "JournalEntry" ? "fa-book" : type === "Scene" ? "fa-map" : "fa-link";
    return { icon, label:doc?.name ? `${doc.name}` : text, sub:doc?.name ? text : "", kind:"uuid", img:doc?.img ?? "" };
  }
  if (/^\{[^{}]+\}$/.test(text)) return { icon:"fa-database", label:text, kind:"ref" };
  if (text !== "" && Number.isFinite(Number(text))) return { icon:"fa-hashtag", label:text, kind:"number" };
  return { icon:"fa-font", label:text, kind:"text" };
}

function dropValue(event) {
  let data = null;
  try { data = JSON.parse(event.dataTransfer?.getData("text/plain") || "null"); } catch { data = null; }
  if (!data) { const text = event.dataTransfer?.getData("text/plain"); return text ? String(text).trim() : ""; }
  if (typeof data === "string") return data;
  if (data.uuid) return String(data.uuid);
  if (data.type && data.id) return `${data.type}.${data.id}`;
  return "";
}

/**
 * Open the array editor.
 * @param {any} value  Current value (array, JSON text or comma list).
 * @param {object} options `{ doc, title, numeric }`
 * @returns {Promise<any[]|null>}
 */
export function openArrayValueEditor(value, options = {}) {
  const doc = options.doc ?? null;
  const items = parseArrayValue(value).map(v => ({ id: randomId(), value: v }));
  const scope = doc?.documentName === "Item" ? "item" : doc?.documentName === "Actor" ? "actor" : "";
  const variables = getValueDefinitions(scope || undefined);
  const root = document.createElement("div");
  root.className = "sd-array-editor";
  let app = null, settled = false, selected = -1;

  return new Promise(resolve => {
    const finish = async result => {
      if (settled) return;
      settled = true;
      resolve(result);
      await app?.close?.({ sdSkipCallback: true });
    };
    const sync = () => {
      root.querySelectorAll("[data-entry-index]").forEach(row => {
        const entry = items[Number(row.dataset.entryIndex)];
        const input = row.querySelector("[data-entry-value]");
        if (!entry || !input) return;
        if (typeof entry.value === "object" && entry.value !== null) {
          try { entry.value = JSON.parse(input.value); } catch { entry.value = input.value; }
        } else entry.value = input.value;
      });
    };
    const render = () => {
      root.innerHTML = `<style>
        .sd-array-editor{height:100%;min-height:0;display:flex;flex-direction:column;background:var(--sd-popover-bg,var(--sd-bg,#171b2b));color:var(--sd-text,#eee);font:12px Signika,sans-serif}
        .sdar-head{padding:12px 16px 10px;border-bottom:1px solid var(--sd-border,#3a4260);display:flex;gap:12px;align-items:center;background:linear-gradient(120deg,color-mix(in srgb,var(--sd-accent,#7775ff) 18%,transparent),transparent)}
        .sdar-head b{display:block;font-size:15px;color:var(--sd-accent,#9290ff)}.sdar-head small{display:block;color:var(--sd-text-3,#8f96aa);font-size:11px}
        .sdar-body{flex:1;min-height:0;overflow:auto;padding:10px 16px;display:flex;flex-direction:column;gap:6px}
        .sdar-row{display:grid;grid-template-columns:22px 26px 1fr auto;gap:8px;align-items:center;padding:6px 8px;border:1px solid var(--sd-border,#3a4260);border-radius:7px;background:var(--sd-bg-2,#1d2235)}
        .sdar-row.is-selected{border-color:var(--sd-accent,#7775ff)}
        .sdar-row .num{font-size:10px;color:var(--sd-text-3)}
        .sdar-row img{width:26px;height:26px;border-radius:4px;object-fit:cover}
        .sdar-row i.kind{display:grid;place-items:center;width:26px;height:26px;color:var(--sd-text-3)}
        .sdar-row input{background:var(--sd-bg,#171b2b);border:1px solid var(--sd-border,#3a4260);border-radius:6px;color:var(--sd-text,#eee);padding:5px 7px;font:inherit;min-width:0;width:100%}
        .sdar-row small{display:block;color:var(--sd-text-3);font-size:10px;margin-top:2px}
        .sdar-row .acts{display:flex;gap:2px}.sdar-row .acts button{width:24px;height:24px;border:none;border-radius:5px;background:transparent;color:var(--sd-text-3);cursor:pointer}
        .sdar-row .acts button:hover{background:var(--sd-bg);color:var(--sd-text)}.sdar-row .acts button:disabled{opacity:.3}
        .sdar-drop{border:2px dashed var(--sd-border,#3a4260);border-radius:9px;padding:16px;text-align:center;color:var(--sd-text-3,#8f96aa)}
        .sdar-drop.is-over{border-color:var(--sd-accent,#7775ff);background:color-mix(in srgb,var(--sd-accent,#7775ff) 12%,var(--sd-bg))}
        .sdar-add{display:flex;gap:6px;flex-wrap:wrap;align-items:center;padding:8px 16px;border-top:1px solid var(--sd-border,#3a4260)}
        .sdar-add input,.sdar-add select{background:var(--sd-bg,#171b2b);border:1px solid var(--sd-border,#3a4260);border-radius:6px;color:var(--sd-text,#eee);padding:6px 8px;font:inherit;min-width:0}
        .sdar-btn{border:1px solid var(--sd-border,#3a4260);border-radius:7px;background:var(--sd-bg-2,#1d2235);color:var(--sd-text,#eee);padding:6px 10px;cursor:pointer;font:inherit;display:inline-flex;align-items:center;gap:6px}
        .sdar-btn.primary{background:var(--sd-accent,#7775ff);border-color:var(--sd-accent,#7775ff);color:#fff;font-weight:600}
        .sdar-foot{display:flex;gap:8px;padding:8px 16px;border-top:1px solid var(--sd-border,#3a4260)}.sdar-foot .spacer{flex:1}
        .sdar-foot code{font-size:10px;color:var(--sd-text-3);align-self:center;max-width:50%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      </style>
      <div class="sdar-head"><i class="fas fa-list-ol" style="font-size:20px"></i><div><b>${esc(options.title ?? "Array")}</b><small>${items.length} element${items.length === 1 ? "" : "s"}. Drag Items, Actors or Journals from the sidebar, type values, or pick Database variables.</small></div></div>
      <div class="sdar-body" data-drop>
        ${items.map((entry, index) => {
          const meta = entryMeta(entry.value);
          const text = typeof entry.value === "object" && entry.value !== null ? JSON.stringify(entry.value) : String(entry.value ?? "");
          return `<div class="sdar-row ${index === selected ? "is-selected" : ""}" data-entry-index="${index}">
            <span class="num">${index + 1}</span>
            ${meta.img ? `<img src="${esc(meta.img)}" alt="">` : `<i class="kind fas ${meta.icon}" title="${esc(meta.kind)}"></i>`}
            <div><input data-entry-value value="${esc(text)}" ${meta.kind === "uuid" ? `title="${esc(meta.label)}"` : ""}>${meta.kind === "uuid" && meta.sub ? `<small><i class="fas fa-link"></i> ${esc(meta.label)}</small>` : ""}</div>
            <div class="acts">
              <button type="button" data-move="-1" ${index === 0 ? "disabled" : ""} title="Up"><i class="fas fa-arrow-up"></i></button>
              <button type="button" data-move="1" ${index === items.length - 1 ? "disabled" : ""} title="Down"><i class="fas fa-arrow-down"></i></button>
              <button type="button" data-remove title="Remove"><i class="fas fa-xmark"></i></button>
            </div>
          </div>`;
        }).join("")}
        <div class="sdar-drop"><i class="fas fa-hand-pointer"></i> Drop documents here to add their UUIDs</div>
      </div>
      <div class="sdar-add">
        <input data-new-value placeholder="Value (text or number)" style="flex:1;min-width:140px">
        <button type="button" class="sdar-btn" data-add-value><i class="fas fa-plus"></i> Add</button>
        <select data-variable style="min-width:170px"><option value="">Database variable…</option>${variables.map(v => `<option value="${esc(v.id)}">${esc(v.name ?? v.id)} · ${esc(v.type)}</option>`).join("")}</select>
        <button type="button" class="sdar-btn" data-add-var-value title="Insert the variable's current value" ${doc ? "" : 'disabled title="Open from a sheet to read values"'}><i class="fas fa-download"></i> Value</button>
        <button type="button" class="sdar-btn" data-add-var-ref title="Insert a reference that resolves when the graph runs"><i class="fas fa-link"></i> Reference</button>
      </div>
      <div class="sdar-foot">
        <button type="button" class="sdar-btn" data-cancel>Cancel</button>
        <button type="button" class="sdar-btn" data-clear><i class="fas fa-eraser"></i> Clear</button>
        <code title="Resulting JSON">${esc(JSON.stringify(items.map(e => e.value)))}</code>
        <span class="spacer"></span>
        <button type="button" class="sdar-btn primary" data-save><i class="fas fa-check"></i> Save</button>
      </div>`;
      bind();
    };
    const addValue = raw => {
      const text = String(raw ?? "").trim();
      if (!text) return;
      const numeric = options.numeric !== false && text !== "" && Number.isFinite(Number(text)) && !UUID_RE.test(text);
      items.push({ id: randomId(), value: numeric ? Number(text) : text });
      selected = items.length - 1;
      render();
    };
    const bind = () => {
      const zone = root.querySelector("[data-drop]");
      zone.addEventListener("dragover", event => { event.preventDefault(); zone.querySelector(".sdar-drop")?.classList.add("is-over"); });
      zone.addEventListener("dragleave", () => zone.querySelector(".sdar-drop")?.classList.remove("is-over"));
      zone.addEventListener("drop", event => {
        event.preventDefault(); zone.querySelector(".sdar-drop")?.classList.remove("is-over");
        sync(); const dropped = dropValue(event);
        if (dropped) addValue(dropped);
      });
      root.querySelectorAll("[data-entry-index]").forEach(row => {
        const index = Number(row.dataset.entryIndex);
        row.querySelector("[data-entry-value]")?.addEventListener("focus", () => { selected = index; });
        row.querySelector("[data-entry-value]")?.addEventListener("change", () => { sync(); render(); });
        row.querySelectorAll("[data-move]").forEach(button => button.addEventListener("click", () => {
          sync(); const to = index + Number(button.dataset.move);
          if (to < 0 || to >= items.length) return;
          const [entry] = items.splice(index, 1); items.splice(to, 0, entry); selected = to; render();
        }));
        row.querySelector("[data-remove]")?.addEventListener("click", () => { sync(); items.splice(index, 1); selected = -1; render(); });
      });
      const newValue = root.querySelector("[data-new-value]");
      root.querySelector("[data-add-value]")?.addEventListener("click", () => { sync(); addValue(newValue.value); });
      newValue?.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); sync(); addValue(newValue.value); } });
      root.querySelector("[data-add-var-value]")?.addEventListener("click", () => {
        const id = root.querySelector("[data-variable]")?.value; if (!id) return;
        sync();
        let current = doc ? readDatabaseValue(doc, id) : variables.find(v => v.id === id)?.initial;
        if (Array.isArray(current)) { for (const v of current) items.push({ id: randomId(), value: v }); render(); return; }
        if (current !== undefined && current !== null && current !== "") { items.push({ id: randomId(), value: current }); selected = items.length - 1; render(); }
      });
      root.querySelector("[data-add-var-ref]")?.addEventListener("click", () => {
        const id = root.querySelector("[data-variable]")?.value; if (!id) return;
        sync(); items.push({ id: randomId(), value: `{${valueStoragePath(id)}}` }); selected = items.length - 1; render();
      });
      root.querySelector("[data-clear]")?.addEventListener("click", () => { items.length = 0; selected = -1; render(); });
      root.querySelector("[data-cancel]")?.addEventListener("click", () => finish(null));
      root.querySelector("[data-save]")?.addEventListener("click", () => { sync(); finish(items.map(entry => entry.value)); });
    };
    render();
    app = openFoundryWindow({
      id: `sd-array-editor-${randomId()}`,
      title: options.windowTitle ?? "Edit array",
      icon: "fa-solid fa-list-ol",
      width: 620, height: 560, minWidth: 420, minHeight: 360,
      classes: ["sd-array-editor-window"],
      content: root,
      onClose: () => finish(null)
    });
  });
}
