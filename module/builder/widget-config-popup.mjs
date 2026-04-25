import { FormulaEngine } from "../helpers/formula-engine.mjs";
import { FormulaGraph }  from "./formula-graph.mjs";

const FIELD_DEFS = {
  text:      [["Label","label"],["Widget Key","widgetKey","text"],["Data Path","path","path"],["Value Formula","valueFormula","formula"],["Placeholder","placeholder"],["Read Only","readOnly","boolean"]],
  number:    [["Label","label"],["Widget Key","widgetKey","text"],["Data Path","path","path"],["Value Formula","valueFormula","formula"],["Min","min","number"],["Max","max","number"],["Step","step","number"]],
  resource:  [["Label","label"],["Widget Key","widgetKey","text"],["Value Path","pathValue","path"],["Max Path","pathMax","path"],["Bar Color","color","color"]],
  dice:      [["Label","label"],["Widget Key","widgetKey","text"],["Roll Formula","formula","formula"],["FA Icon (e.g. fa-gun)","icon","text"],["Chat Flavor","flavor","text"]],
  button:    [["Label","label"],["Widget Key","widgetKey","text"],["FA Icon (e.g. fa-bolt)","icon","text"],["Color","color","color"],["Roll Formula (optional)","formula","formula"],["Chat Flavor / Message","flavor","text"]],
  toggle:    [["Label","label"],["Widget Key","widgetKey","text"],["Data Path","path","path"],["On Label","onLabel","text"],["Off Label","offLabel","text"]],
  section:   [["Section Title","label"]],
  richtext:  [["Label","label"],["Widget Key","widgetKey","text"],["Data Path","path","path"]],
  attribute: [["Label","label"],["Widget Key","widgetKey","text"],["Score Path","path","path"],["Chat Flavor","flavor","text"]],
  skill:     [["Label","label"],["Widget Key","widgetKey","text"],["Rank Path","path","path"],["Attr Modifier","attrMod","number"],["Roll Formula Override","formula","formula"],["Chat Flavor","flavor","text"]],
  slot:      [["Label","label"],["Widget Key","widgetKey","text"],["Slot ID","slotId","text"],["Max Items","maxCount","number"]],
  inventory: [["Label","label"],["Filter Categories","categories","array"],["Extra Columns (hidden field names)","columns","array"],["Show Currency Section","showCurrency","boolean"],["Currency Path (optional)","currencyPath","path"]],
  effects:   [["Label","label"],["Show Disabled","showDisabled","boolean"],["Show Passive","showPassive","boolean"]],
  spellbook: [["Label","label"],["Ability type filter (empty = all)","abilityType","text"]],

  // New widget types
  progress: [["Label","label"],["Widget Key","widgetKey","text"],["Value Path","pathValue","path"],["Max Path","pathMax","path"],["Bar Colour","color","color"],["Show label","showLabel","boolean"],["Show percentage","showPct","boolean"]],
  select:   [["Label","label"],["Widget Key","widgetKey","text"],["Data Path","path","path"],["Choices (comma-separated)","choices","text"]],
  clock:    [["Label","label"],["Widget Key","widgetKey","text"],["Filled count path","path","path"],["Segments (2–12)","segments","number"],["Filled colour","color","color"],["Empty colour","bgColor","color"]],
  tracker:  [["Label","label"],["Widget Key","widgetKey","text"],["Value path","path","path"],["Max path (blank=use Max)","maxPath","path"],["Max","maxCount","number"],["FA icon","icon","text"],["Filled colour","color","color"]],
  tags:     [["Label","label"],["Widget Key","widgetKey","text"],["Data path","path","path"],["Pill colour","color","color"]],
  image:    [["Label (optional)","label"],["Widget Key","widgetKey","text"],["Static URL (blank=use path)","staticSrc","text"],["Document path to image","path","path"],["Width px","width","number"],["Height px","height","number"],["Border radius px","borderRadius","number"],["Click to change","clickable","boolean"]],
  derived:  [["Label","label"],["Widget Key","widgetKey","text"],["Formula","formula","formula"],["Decimal places","decimalPlaces","number"]]
};

const FIELD_HINTS = {
  path:         "Path on actor/item — directly reads/writes the field (two-way bind)",
  valueFormula: "Formula — computed at display time. Use {system.path}, {item:Name.field}, {widget:key}, 1d20+{@attr1}",
  formula:      "Roll formula — supports {path} refs. E.g: 1d20 + {system.attributes.attr1.mod}",
  widgetKey:    "Optional unique name for this widget. Other widgets can read its value via {widget:thisKey}",
  showIf:       "Show this widget only when a field or widget equals a specific value. Leave blank to always show.",
  cssClass:     "Space-separated CSS class names added to the widget's outer element for custom styling",
  choices:      "Comma-separated list of option values. Example: low,medium,high",
  segments:     "Number of clock segments (2–12). The path stores the filled count as an integer.",
  icon:         "FontAwesome icon class. Examples: fa-circle, fa-heart, fa-star",
  bgColor:      "Colour of empty/unfilled segments",
  staticSrc:    "Static image URL. Leave blank to use the document path instead.",
  decimalPlaces:"Decimal places to show for derived numeric values (0 = whole number)",
  showCurrency: "Show a currency row at the top of the inventory. " +
                "Leave Currency Path blank to use the built-in system.currency (primary / secondary / tertiary). " +
                "Set Currency Path to show a single custom money field instead.",
  currencyPath: "Path to a single money field — e.g. system.currency.primary or system.flags.gold. " +
                "When set, the currency row shows one labelled input bound to this path. " +
                "Leave blank to use the default three-column currency (primary / secondary / tertiary).",
  costField:    "HiddenField key on each ability item that stores its activation cost. " +
                "Create a HiddenField named «cost» on every ability item — its value will be deducted " +
                "from the Mana Path when the ability is activated. Default key: cost",
};

// Main export

export async function openWidgetConfigPopup(w, tab, row, doc) {
  document.querySelector(".sd-wcfg-popup")?.remove();

  const _typeFields = FIELD_DEFS[w.type] ?? [["Label","label"]];
  const _commonFields = [
  ];
  const fields = [..._typeFields, ..._commonFields];
  const allPaths = _buildPathList(doc);
  const esc      = s => String(s ?? "").replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;");

  // Build field HTML
  const IS = "width:100%;background:#1a1a2e;border:1px solid #3a3a52;border-radius:4px;color:#e0e0ee;font-size:12px;padding:5px 8px;box-sizing:border-box;outline:none;transition:border-color .15s";
  const MONO = ";font-family:'Courier New',monospace;font-size:11px";

  const attrGraphRow = (w.type === "attribute" || w.type === "skill") ? `
    <div class="wcfg-f" style="margin-bottom:10px">
      <label class="wcfg-lbl">Node Graph</label>
      <div style="font-size:10px;color:#555;margin-bottom:5px;line-height:1.4">${w.type === "skill" ? "Wire Roll Formula output and On Click exec chain for this skill." : "Wire Attr Score → modValue output, and On Click exec chain."}</div>
      <button type="button" id="wcfg-attr-graph-btn"
        style="width:100%;background:#2a1a4e;border:1px solid #7b68ee;border-radius:5px;color:#9d8fff;cursor:pointer;font-size:11px;padding:7px 12px;display:flex;align-items:center;justify-content:center;gap:7px;transition:background .15s"
        onmouseover="this.style.background='#3a2a6e'" onmouseout="this.style.background='#2a1a4e'">
        <i class="fas fa-diagram-project"></i> Open Graph Editor
      </button>
    </div>` : "";

  const _showIfSources = (() => {
    const list = [];
    for (const t of (doc.system?.customTabs ?? [])) {
      for (const r of (t.rows ?? [])) {
        for (const ww of (r.widgets ?? [])) {
          if (ww.widgetKey && ww.widgetKey !== w.widgetKey) {
            list.push({ value: `widget:${ww.widgetKey}`, label: `Widget: ${ww.widgetKey}` });
          }
        }
      }
    }
    // hidden fields
    for (const [k] of Object.entries(doc.system?.hiddenFields ?? {})) {
      list.push({ value: `hidden:${k}`, label: `Hidden Field: ${k}` });
    }
    return list;
  })();

  const _showIfKey   = w.showIfKey   ?? "";
  const _showIfValue = w.showIfValue ?? "";

  const showIfRow = `
    <div class="wcfg-f" style="margin-top:10px;border-top:1px solid #2a2a3e;padding-top:10px">
      <label class="wcfg-lbl" style="margin-bottom:4px;display:block">Show if…</label>
      <div style="display:grid;grid-template-columns:1fr auto 1fr;gap:5px;align-items:center">
        <select id="wcfg-showif-key" style="background:#1a1a2e;border:1px solid #3a3a52;border-radius:4px;color:#e0e0ee;font-size:11px;padding:4px 6px">
          <option value="">— Always show —</option>
          ${_showIfSources.map(s => `<option value="${esc(s.value)}" ${_showIfKey===s.value?"selected":""}>${esc(s.label)}</option>`).join("")}
        </select>
        <span style="color:#555;font-size:11px;flex-shrink:0">=</span>
        <input id="wcfg-showif-value" type="text" placeholder="e.g. true, 1, sword"
          value="${esc(_showIfValue)}"
          style="background:#1a1a2e;border:1px solid #3a3a52;border-radius:4px;color:#e0e0ee;font-size:11px;padding:4px 6px;width:100%;box-sizing:border-box">
      </div>
      <div style="font-size:9px;color:#444;margin-top:4px;line-height:1.4">
        Select a widget key or hidden field, then set the value it must equal to show this widget.
      </div>
    </div>`;

  const fieldRows = fields.map(([lbl, key, type="text", opts=[]]) => {
    let cur = w[key] ?? ""; if (Array.isArray(cur) && type !== "select") cur = cur.join(", ");
    const isPF = type === "path" || type === "formula";
    const hint = FIELD_HINTS[key] ?? FIELD_HINTS[type] ?? "";
    const noteColor = type === "formula" ? "#5a4ec0" : type === "path" ? "#5a8ae0" : "";

    if (type === "color") return `
      <div class="wcfg-f" style="margin-bottom:10px">
        <label class="wcfg-lbl">${esc(lbl)}</label>
        <input type="color" data-field="${esc(key)}" value="${esc(cur||"#7b68ee")}" style="height:32px;width:56px;padding:2px;border:1px solid #3a3a52;border-radius:4px;background:#1a1a2e;cursor:pointer">
      </div>`;

    if (type === "boolean") return `
      <div class="wcfg-f" style="margin-bottom:10px;display:flex;align-items:center;gap:8px">
        <input type="checkbox" data-field="${esc(key)}" data-ftype="boolean"
          id="wcfg-bool-${esc(key)}" ${cur === true || cur === "true" ? "checked" : ""}
          style="width:15px;height:15px;accent-color:#7b68ee;cursor:pointer;flex-shrink:0">
        <label for="wcfg-bool-${esc(key)}" class="wcfg-lbl" style="margin:0;cursor:pointer">${esc(lbl)}</label>
      </div>`;

    if (type === "select") return `
      <div class="wcfg-f" style="margin-bottom:10px">
        <label class="wcfg-lbl">${esc(lbl)}</label>
        <select data-field="${esc(key)}" data-ftype="select"
          style="${IS}">
          ${opts.map(o => `<option value="${esc(o)}" ${String(cur)===String(o)?"selected":""}>${esc(o)}</option>`).join("")}
        </select>
      </div>`;

    if (type === "slotconfig") {
      const rows = (Array.isArray(w[key]) ? w[key] : []).map((entry, i) => {
        const lvl  = esc(String(entry.level   ?? i + 1));
        const maxP = esc(String(entry.maxPath  ?? ""));
        const valP = esc(String(entry.valuePath ?? ""));
        return `
        <div class="wcfg-slotrow" style="display:grid;grid-template-columns:32px 1fr 1fr 22px;gap:4px;align-items:center;margin-bottom:5px" data-idx="${i}">
          <input type="number" class="wcfg-slot-level" value="${lvl}" min="0" max="20"
            style="background:#1a1a2e;border:1px solid #3a3a52;border-radius:3px;color:#9d8fff;font-size:11px;padding:2px 4px;text-align:center;width:100%"
            title="Level number">
          <input type="text" class="wcfg-slot-maxpath" value="${maxP}"
            style="background:#1a1a2e;border:1px solid #2a3a5a;border-radius:3px;color:#7aaaf0;font-size:10px;padding:2px 5px;width:100%;font-family:'Courier New',monospace"
            placeholder="system.hiddenFields.l1max">
          <input type="text" class="wcfg-slot-valpath" value="${valP}"
            style="background:#1a1a2e;border:1px solid #2a4a2a;border-radius:3px;color:#7af07a;font-size:10px;padding:2px 5px;width:100%;font-family:'Courier New',monospace"
            placeholder="system.spellSlots.1.value">
          <button type="button" class="wcfg-slot-del" style="background:none;border:none;color:#5a2a2a;cursor:pointer;font-size:13px;padding:0;line-height:1" title="Remove level">✕</button>
        </div>`;
      }).join("");

      return `
      <div class="wcfg-f" style="margin-bottom:10px">
        <label class="wcfg-lbl">${esc(lbl)}</label>
        <div style="font-size:10px;color:#555;margin-bottom:6px;line-height:1.4">
          Lv · <span style="color:#7aaaf0">Max path (hiddenField or spellSlots.N.max)</span> · <span style="color:#7af07a">Value path (hiddenField or spellSlots.N.value)</span>
        </div>
        <div id="wcfg-slotrows" style="max-height:220px;overflow-y:auto">
          ${rows || "<div style='font-size:10px;color:#444;font-style:italic'>No levels — click Add Level below</div>"}
        </div>
        <button type="button" id="wcfg-slot-add"
          style="margin-top:6px;background:#1a1a3a;border:1px solid #5a4ec0;border-radius:4px;color:#9d8fff;cursor:pointer;font-size:10px;padding:3px 10px">
          + Add Level
        </button>
        <input type="hidden" id="wcfg-slotconfig-json" data-field="${esc(key)}" data-ftype="json" value="${esc(JSON.stringify(Array.isArray(w[key]) ? w[key] : []))}">
      </div>`;
    }

    return `
      <div class="wcfg-f" style="margin-bottom:10px;position:relative">
        <label class="wcfg-lbl">
          ${esc(lbl)}
          ${noteColor ? `<span style="background:${noteColor};color:#fff;font-size:9px;padding:1px 5px;border-radius:3px;margin-left:4px;font-weight:400;text-transform:none;letter-spacing:0">${type}</span>` : ""}
        </label>
        ${hint ? `<div style="font-size:10px;color:#555;margin-bottom:3px;line-height:1.4">${esc(hint)}</div>` : ""}
        <div style="display:flex;gap:5px;align-items:center">
          <input type="${type==="number"?"number":"text"}" data-field="${esc(key)}" data-ftype="${type}"
            value="${esc(cur)}"
            style="${IS}${isPF?MONO:""};flex:1"
            placeholder="${type==="path"?"system.resources.hp.value":type==="formula"?"1d20 + {system.attributes.attr1.mod}":type==="array"?"ammo, magazine":""}">
          ${type === "formula" ? `<button type="button" data-open-graph="${esc(key)}" style="flex-shrink:0;background:#2a1a4e;border:1px solid #7b68ee;border-radius:4px;color:#9d8fff;cursor:pointer;font-size:10px;padding:4px 8px;white-space:nowrap;line-height:1;transition:background .15s" title="Open Blueprint Graph">🔷 Graph</button>` : ""}
          ${isPF ? `<button type="button" data-clear-field="${esc(key)}" class="wcfg-clear-btn" title="Clear">✕</button>` : ""}
        </div>
        ${isPF ? `<div class="wcfg-sug" data-for="${esc(key)}" style="display:none;position:absolute;left:0;right:0;top:100%;z-index:9999;background:#1a1a2e;border:1px solid #5a4ec0;border-top:none;border-radius:0 0 5px 5px;max-height:130px;overflow-y:auto;box-shadow:0 6px 20px rgba(0,0,0,.6)"></div>` : ""}
      </div>`;
  }).join("");


  // Path picker
  const pathPickerOpts = allPaths.map(p => `<option value="${esc(p.path)}">${esc(p.label)}</option>`).join("");

  // Full popup HTML
  const popup = document.createElement("div");
  popup.className = "sd-wcfg-popup";

  const sheetRect = document.querySelector(".app.sd.sheet.item, .app.sd.sheet.actor, [id^='sd-']")?.getBoundingClientRect()
    ?? { right: 400, top: 80, width: 0 };
  const popLeft = Math.min(Math.max(sheetRect.right + 10, 20), window.innerWidth - 440);
  const popTop  = Math.max(sheetRect.top + 40, 10);

  popup.style.cssText = `
    position:fixed;left:${popLeft}px;top:${popTop}px;
    width:430px;max-height:92vh;overflow:hidden;
    background:#13131d;border:1px solid #5a4ec0;border-radius:8px;
    box-shadow:0 8px 40px rgba(0,0,0,.85);z-index:10000;
    font-family:'Signika','Palatino Linotype',serif;color:#e0e0ee;
    display:flex;flex-direction:column;`;

  const ICON_MAP = { text:"fa-font", number:"fa-hashtag", resource:"fa-heart-pulse", dice:"fa-dice-d20", button:"fa-square-bolt", toggle:"fa-toggle-on", section:"fa-minus", richtext:"fa-align-left", attribute:"fa-chart-bar", skill:"fa-list-check", slot:"fa-layer-group", inventory:"fa-backpack", effects:"fa-sparkles", spellbook:"fa-book-sparkles" };

  popup.innerHTML = `
    <!-- Header -->
    <div id="wcfg-hdr" style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:#1a1a28;border-bottom:1px solid #2a2a3e;flex-shrink:0;cursor:move">
      <span style="font-size:12px;font-weight:700;text-transform:uppercase;color:#9d8fff">
        <i class="fas ${ICON_MAP[w.type]??'fa-gear'}" style="margin-right:7px;opacity:.8"></i>Configure: ${esc(w.label || w.type)}
      </span>
      <div style="display:flex;align-items:center;gap:8px">
        <button type="button" id="wcfg-tab-fields" class="wcfg-tab-btn active" style="font-size:10px;padding:3px 10px;border-radius:4px;border:1px solid #5a4ec0;background:#5a4ec0;color:#fff;cursor:pointer">Fields</button>

        <button type="button" id="wcfg-x" style="background:none;border:none;color:#555;cursor:pointer;font-size:16px;padding:0;margin-left:4px">✕</button>
      </div>
    </div>

    <!-- Fields panel -->
    <div id="wcfg-panel-fields" style="flex:1;overflow-y:auto;padding:14px 16px;display:flex;flex-direction:column;gap:0">
      ${attrGraphRow}
      ${fieldRows}
      ${showIfRow}

      <!-- Drag-drop zone (hidden per user request — kept for drag-drop support) -->
      <div style="display:none">
        <div id="wcfg-drop"></div>
        <div id="wcfg-drop-chips"></div>
      </div>

      <!-- Known paths picker -->
      <div style="border-top:1px solid #2a2a38;padding-top:10px;margin-top:8px">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:#888;margin-bottom:6px"><i class="fas fa-database"></i> Known Paths</div>
        <div style="display:flex;gap:5px">
          <select id="wcfg-ps" style="flex:1;background:#1a1a2e;border:1px solid #3a3a52;border-radius:4px;color:#e0e0ee;font-size:11px;font-family:'Courier New',monospace;padding:3px 5px;height:28px">
            <option value="">— select a path —</option>
            ${pathPickerOpts}
          </select>
          <button type="button" id="wcfg-pi" style="background:#5a4ec0;border:1px solid #7b68ee;border-radius:4px;color:#fff;cursor:pointer;font-size:11px;padding:5px 10px;flex-shrink:0">Insert</button>
        </div>
      </div>
    </div>

    <!-- Blueprints panel (hidden initially) -->
    

    <!-- Footer -->
    <div style="display:flex;justify-content:flex-end;gap:8px;padding:10px 16px;border-top:1px solid #2a2a38;flex-shrink:0;background:#13131d">
      <button type="button" id="wcfg-cancel" class="wcfg-footer-btn" style="padding:7px 16px;font-size:12px;font-weight:600;border-radius:5px;cursor:pointer;border:1px solid #3a3a52;background:#2a2a38;color:#a0a0c0">Cancel</button>
      <button type="button" id="wcfg-save"   class="wcfg-footer-btn" style="padding:7px 18px;font-size:12px;font-weight:700;border-radius:5px;cursor:pointer;border:1px solid #7b68ee;background:#7b68ee;color:#fff">
        <i class="fas fa-check" style="margin-right:5px"></i>Save
      </button>
    </div>`;

  document.body.appendChild(popup);

  // State
  let _lastFocused = null;

  const panelFields = popup.querySelector("#wcfg-panel-fields");
    const tabFields   = popup.querySelector("#wcfg-tab-fields");
  
  tabFields.addEventListener("click", () => {
    panelFields.style.display = "flex"; panelBP.style.display = "none";
    tabFields.style.background="#5a4ec0"; tabFields.style.borderColor="#5a4ec0"; tabFields.style.color="#fff";
    tabBP.style.background="transparent"; tabBP.style.borderColor="#3a3a52"; tabBP.style.color="#888";
  });


  // Focus tracking
  popup.querySelectorAll("input[data-field]").forEach(inp => {
    inp.addEventListener("focus", () => { _lastFocused = inp; });
  });

  // Autocomplete
  popup.querySelectorAll("input[data-ftype='path'], input[data-ftype='formula']").forEach(inp => {
    inp.addEventListener("focus",  () => { _lastFocused = inp; _refreshSug(inp); });
    inp.addEventListener("input",  () => _refreshSug(inp));
  });

  const _showIfInp = popup.querySelector("input[data-field='showIf']");
  if (_showIfInp) {
    const _errEl = document.createElement("div");
    _errEl.style.cssText = "font-size:10px;color:#e05050;margin-top:2px;display:none;line-height:1.3";
    _showIfInp.parentElement?.after?.(_errEl) ?? _showIfInp.insertAdjacentElement("afterend", _errEl);

    const _validateShowIf = () => {
      const val = _showIfInp.value.trim();
      if (!val) {
        _showIfInp.style.borderColor = "";
        _errEl.style.display = "none";
        return;
      }
      try {
        FormulaEngine.evaluate(val, {});
        _showIfInp.style.borderColor = "#3a3a52"; // reset to normal
        _errEl.style.display = "none";
      } catch (err) {
        _showIfInp.style.borderColor = "#e05050";
        _errEl.textContent = "⚠ " + (err?.message ?? "Formula error");
        _errEl.style.display = "block";
      }
    };
    _showIfInp.addEventListener("input", _validateShowIf);
    _showIfInp.addEventListener("blur",  _validateShowIf);
    _validateShowIf();
  }

  function _refreshSug(inp) {
    const list = popup.querySelector(`.wcfg-sug[data-for="${inp.dataset.field}"]`);
    if (!list) return;
    const q = inp.value.toLowerCase();
    if (!q) { list.style.display = "none"; return; }
    const matches = allPaths.filter(p => p.path.toLowerCase().includes(q) || p.label.toLowerCase().includes(q)).slice(0,8);
    if (!matches.length) { list.style.display = "none"; return; }
    list.style.display = "block";
    list.innerHTML = matches.map(p => `
      <div data-path="${esc(p.path)}" class="wcfg-sug-item" style="padding:4px 9px;cursor:pointer;font-size:11px;font-family:'Courier New',monospace;border-bottom:1px solid #2a2a38;display:flex;gap:8px;align-items:center">
        <span style="color:#e0e0ee;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.path)}</span>
        <span style="color:#444;font-size:10px;font-family:inherit;flex-shrink:0">${esc(p.label)}</span>
      </div>`).join("");
    list.querySelectorAll(".wcfg-sug-item").forEach(item => {
      item.addEventListener("mouseenter", () => item.style.background = "#2a2a3e");
      item.addEventListener("mouseleave", () => item.style.background = "");
      item.addEventListener("mousedown", ev => {
        ev.preventDefault();
        _insertAt(inp, item.dataset.path);
        list.style.display = "none";
      });
    });
  }

  document.addEventListener("click", ev => {
    if (!popup.contains(ev.target)) return;
    popup.querySelectorAll(".wcfg-sug").forEach(l => { if (!l.contains(ev.target)) l.style.display = "none"; });
  }, true);

  // Clear buttons
  popup.querySelectorAll(".wcfg-clear-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const inp = popup.querySelector(`input[data-field="${btn.dataset.clearField}"]`);
      if (inp) { inp.value = ""; inp.focus(); }
    });
  });

  // showIf key+value save
  const _syncShowIf = () => {
    const keyEl = popup.querySelector("#wcfg-showif-key");
    const valEl = popup.querySelector("#wcfg-showif-value");
    if (!keyEl) return;
    w.showIfKey   = keyEl.value;
    w.showIfValue = valEl?.value ?? "";
  };
  popup.querySelector("#wcfg-showif-key")?.addEventListener("change", _syncShowIf);
  popup.querySelector("#wcfg-showif-value")?.addEventListener("input",  _syncShowIf);

  // Slot config level editor
  const slotRowsContainer = popup.querySelector("#wcfg-slotrows");
  const slotAddBtn        = popup.querySelector("#wcfg-slot-add");

  const _rebuildSlotRows = () => {
    if (!slotRowsContainer) return;
    const isEmpty = slotRowsContainer.querySelectorAll(".wcfg-slotrow").length === 0;
    if (isEmpty) {
      const p = slotRowsContainer.querySelector(".wcfg-empty-hint");
      if (!p) {
        slotRowsContainer.innerHTML = "<div class='wcfg-empty-hint' style='font-size:10px;color:#444;font-style:italic'>No levels — click Add Level below</div>";
      }
    } else {
      slotRowsContainer.querySelector(".wcfg-empty-hint")?.remove();
    }
  };

  if (slotRowsContainer) {
    slotRowsContainer.addEventListener("click", ev => {
      if (ev.target.closest(".wcfg-slot-del")) {
        ev.target.closest(".wcfg-slotrow").remove();
        _rebuildSlotRows();
      }
    });
    _rebuildSlotRows();
  }

  slotAddBtn?.addEventListener("click", () => {
    if (!slotRowsContainer) return;
    slotRowsContainer.querySelector(".wcfg-empty-hint")?.remove();
    // Find the next level number
    const existing = [...slotRowsContainer.querySelectorAll(".wcfg-slot-level")]
      .map(el => parseInt(el.value) || 0);
    let next = 1;
    while (existing.includes(next)) next++;
    const div = document.createElement("div");
    div.className = "wcfg-slotrow";
    div.style.cssText = "display:grid;grid-template-columns:32px 1fr 1fr 22px;gap:4px;align-items:center;margin-bottom:5px";
    div.innerHTML = `
      <input type="number" class="wcfg-slot-level" value="${next}" min="0" max="20"
        style="background:#1a1a2e;border:1px solid #3a3a52;border-radius:3px;color:#9d8fff;font-size:11px;padding:2px 4px;text-align:center;width:100%" title="Level number">
      <input type="text" class="wcfg-slot-maxpath" value="system.hiddenFields.l${next}max"
        style="background:#1a1a2e;border:1px solid #2a3a5a;border-radius:3px;color:#7aaaf0;font-size:10px;padding:2px 5px;width:100%;font-family:'Courier New',monospace"
        placeholder="system.hiddenFields.l${next}max">
      <input type="text" class="wcfg-slot-valpath" value="system.spellSlots.${next}.value"
        style="background:#1a1a2e;border:1px solid #2a4a2a;border-radius:3px;color:#7af07a;font-size:10px;padding:2px 5px;width:100%;font-family:'Courier New',monospace"
        placeholder="system.spellSlots.${next}.value">
      <button type="button" class="wcfg-slot-del" style="background:none;border:none;color:#5a2a2a;cursor:pointer;font-size:13px;padding:0;line-height:1" title="Remove level">✕</button>`;
    slotRowsContainer.appendChild(div);
  });
  popup.querySelectorAll("[data-open-graph]").forEach(btn => {
    btn.addEventListener("mouseenter", () => btn.style.background = "#3a2a6e");
    btn.addEventListener("mouseleave", () => btn.style.background = "#2a1a4e");
    btn.addEventListener("click", () => {
      const key = btn.dataset.openGraph;
      const inp = popup.querySelector(`input[data-field="${key}"]`);
      if (!inp) return;
      const graph = new FormulaGraph(inp, doc, w, { tab, row, w, doc });
      graph.open();
    });
  });

  popup.querySelector("#wcfg-attr-graph-btn")?.addEventListener("click", () => {
    const graph = new FormulaGraph(null, doc, w, { tab, row, w, doc });
    graph.open();
  });


  function _insertAt(inp, text) {
    if (!inp) return;
    const pos    = inp.selectionStart ?? inp.value.length;
    const before = inp.value.substring(0, pos);
    const after  = inp.value.substring(inp.selectionEnd ?? pos);
    inp.value = before + text + after;
    const newPos = pos + text.length;
    inp.setSelectionRange(newPos, newPos);
    inp.focus();
    inp.dispatchEvent(new Event("input", { bubbles: true }));
  }

  // Known path insert
  popup.querySelector("#wcfg-pi").addEventListener("click", () => {
    const val = popup.querySelector("#wcfg-ps").value;
    if (!val || !_lastFocused) return;
    const wrap = _lastFocused.dataset.ftype === "formula" ? `{${val}}` : val;
    _insertAt(_lastFocused, wrap);
    popup.querySelector("#wcfg-ps").value = "";
  });

  // Drop zone
  const dropZone  = popup.querySelector("#wcfg-drop");
  const dropChips = popup.querySelector("#wcfg-drop-chips");

  dropZone.addEventListener("dragover",  ev => { ev.preventDefault(); dropZone.style.background="rgba(123,104,238,.1)"; dropZone.style.color="#9d8fff"; dropZone.style.borderColor="#7b68ee"; });
  dropZone.addEventListener("dragleave", () => { dropZone.style.background="#1a1a24"; dropZone.style.color="#555"; dropZone.style.borderColor="#4b3e9e"; });
  dropZone.addEventListener("drop", async ev => {
    ev.preventDefault();
    dropZone.style.background="#1a1a24"; dropZone.style.color="#555"; dropZone.style.borderColor="#4b3e9e";
    try {
      const data = JSON.parse(ev.dataTransfer.getData("text/plain"));

      if (data.sdType === "path") {
        if (_lastFocused) {
          const wrap = _lastFocused.dataset.ftype === "formula" ? `{${data.path}}` : data.path;
          _insertAt(_lastFocused, wrap);
        }
        return;
      }

      // Blueprint node dropped
      if (data.sdType === "blueprint") {
        if (_lastFocused) {
          const clean = (data.syntax ?? "").replace(/\{\|cursor\|\}/g, "");
          _insertAt(_lastFocused, clean);
        }
        dropZone.innerHTML = `<i class="fas fa-check-circle" style="color:#5ae07a;margin-right:5px"></i>Blueprint inserted into focused field`;
        return;
      }

      const item = data.uuid ? await fromUuid(data.uuid) : null;
      if (!item) return;

      const paths = [];
      const sys = item.system ?? {};

      for (const [k] of Object.entries(sys.hiddenFields ?? {})) {
        const p = `system.hiddenFields.${k}`;
        paths.push({ path: p, formula: `{item:${item.name}.${p}}`, label: `${item.name}: hidden.${k}` });
      }
      for (const a of (sys.declaredAttrs ?? [])) {
        if (a.path) paths.push({ path: a.path, formula: `{item:${item.name}.${a.path}}`, label: `${item.name}: ${a.name||a.id}` });
      }
      for (const f of ["quantity","weight","price","uses.value","uses.max","slotContents"]) {
        const v = foundry.utils.getProperty(sys, f);
        if (v !== undefined) paths.push({ path: `system.${f}`, formula: `{item:${item.name}.system.${f}}`, label: `${item.name}: ${f}` });
      }
      for (const def of (sys.slotDefinitions ?? [])) {
        paths.push({ path: `system.slotContents.${def.id}.count`, formula: `{slotCount:${def.id}}`, label: `${item.name}: slot '${def.label}' count` });
        paths.push({ path: `system.slotContents.${def.id}.contents.0`, formula: `{slot:${def.id}.0.system.hiddenFields.field}`, label: `${item.name}: slot '${def.label}' item[0]` });
      }

      if (!paths.length) {
        dropZone.innerHTML = `<i class="fas fa-circle-exclamation" style="color:#e05a5a;margin-right:5px"></i>"${item.name}" has no accessible paths. Add Hidden Fields first.`;
        return;
      }

      dropZone.innerHTML = `<i class="fas fa-check-circle" style="color:#5ae07a;margin-right:5px"></i>Found paths from <strong style="color:#9d8fff">${item.name}</strong> — click to insert:`;
      dropChips.innerHTML = paths.map(p => `
        <div style="display:flex;gap:4px;align-items:center">
          <button type="button" data-path="${esc(p.path)}" class="wcfg-path-chip" style="flex:1;background:#1a1a2e;border:1px solid #3a3a52;border-radius:3px;padding:3px 7px;color:#9d8fff;cursor:pointer;font-family:'Courier New',monospace;font-size:10px;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="Insert direct path: ${esc(p.path)}">
            ${esc(p.path)}
          </button>
          <button type="button" data-path="${esc(p.formula)}" class="wcfg-path-chip wcfg-chip-formula" style="flex-shrink:0;background:#1a1a2e;border:1px solid #5a4ec0;border-radius:3px;padding:3px 7px;color:#5a4ec0;cursor:pointer;font-size:10px" title="Insert formula reference: ${esc(p.formula)}">ƒ</button>
        </div>
        <div style="font-size:10px;color:#444;margin-top:-1px;padding:0 2px">${esc(p.label)}</div>`).join("");

      dropChips.querySelectorAll(".wcfg-path-chip").forEach(chip => {
        chip.addEventListener("click", () => {
          if (_lastFocused) _insertAt(_lastFocused, chip.dataset.path);
          chip.style.background = "#1a2e1a"; chip.style.borderColor = "#5ae07a";
          setTimeout(() => { chip.style.background=""; chip.style.borderColor=""; }, 800);
        });
      });
    } catch(e) { console.warn("SD | wcfg drop:", e); }
  });

  // Save
  const doSave = async () => {
    const slotRowsEl = popup.querySelector("#wcfg-slotrows");
    const slotJsonEl = popup.querySelector("#wcfg-slotconfig-json");
    if (slotRowsEl && slotJsonEl) {
      const entries = [];
      slotRowsEl.querySelectorAll(".wcfg-slotrow").forEach(row => {
        const level    = parseInt(row.querySelector(".wcfg-slot-level")?.value)   || 0;
        const maxPath  = row.querySelector(".wcfg-slot-maxpath")?.value?.trim()   ?? "";
        const valuePath = row.querySelector(".wcfg-slot-valpath")?.value?.trim()  ?? "";
        if (level > 0) entries.push({ level, maxPath, valuePath });
      });
      slotJsonEl.value = JSON.stringify(entries);
    }

    const changes = {};
    popup.querySelectorAll("input[data-field]").forEach(el => {
      const key  = el.dataset.field;
      const type = el.dataset.ftype ?? el.type;
      let val = type === "number" ? (parseFloat(el.value) || 0) : el.value;
      if (type === "array")  val = String(val).split(",").map(s => s.trim()).filter(Boolean);
      if (type === "boolean") val = el.type === "checkbox" ? el.checked : val === "true";
      if (type === "json") { try { val = JSON.parse(el.value || "[]"); } catch { val = []; } }
      changes[key] = val;
    });
    popup.querySelectorAll("select[data-field]").forEach(el => {
      changes[el.dataset.field] = el.value;
    });

    const tabs   = foundry.utils.deepClone(doc.system.customTabs ?? []);
    const widget = tabs.find(t=>t.id===tab.id)?.rows?.find(r=>r.id===row.id)?.widgets?.find(x=>x.id===w.id);
    if (widget) {
      Object.assign(widget, changes);

      if (widget.type === "slot" && widget.slotId != null) {
        const sid   = String(widget.slotId);
        const defs  = foundry.utils.deepClone(doc.system.slotDefinitions ?? []);
        const defIdx = defs.findIndex(d => String(d.id) === sid);
        if (defIdx !== -1) {
          if (changes.maxCount !== undefined) defs[defIdx].maxCount = Math.max(1, parseInt(changes.maxCount) || 1);
          if (changes.label    !== undefined) defs[defIdx].label    = changes.label || defs[defIdx].label;
          await doc.update({ "system.customTabs": tabs, "system.slotDefinitions": defs });
        } else {
          await doc.update({ "system.customTabs": tabs });
        }
      } else {
        await doc.update({ "system.customTabs": tabs });
      }

      ui.notifications?.info?.(`Widget "${widget.label || widget.type}" saved.`);
    }
    popup.remove();
  };

  popup.querySelector("#wcfg-save").addEventListener("click", doSave);
  popup.querySelector("#wcfg-cancel").addEventListener("click", () => popup.remove());
  popup.querySelector("#wcfg-x").addEventListener("click",     () => popup.remove());

  // Button hover effects
  const saveBtn = popup.querySelector("#wcfg-save");
  saveBtn.addEventListener("mouseenter", () => saveBtn.style.background = "#9d8fff");
  saveBtn.addEventListener("mouseleave", () => saveBtn.style.background = "#7b68ee");

  // Draggable header
  let ds = null;
  popup.querySelector("#wcfg-hdr").addEventListener("mousedown", ev => {
    if (["wcfg-x","wcfg-tab-fields"].includes(ev.target.id)) return;
    ds = { x: ev.clientX - popup.offsetLeft, y: ev.clientY - popup.offsetTop };
  });
  document.addEventListener("mousemove", ev => {
    if (!ds) return;
    popup.style.left = `${Math.max(0, ev.clientX - ds.x)}px`;
    popup.style.top  = `${Math.max(0, ev.clientY - ds.y)}px`;
  });
  document.addEventListener("mouseup", () => ds = null);

  // Focus first field
  popup.querySelector("input[data-field]")?.focus();

  return popup;
}


function _buildPathList(doc) {
  const paths = [];

  // 1. World-level custom fields
  try {
    const customFields = game.settings.get("sd", "customFields") ?? [];
    for (const cf of customFields) {
      paths.push({ path: `system.flags.${cf.name}`, label: `Custom: ${cf.name}` });
    }
  } catch {}

  const ownHF = Object.entries(doc.system?.hiddenFields ?? {});
  for (const [k] of ownHF) {
    paths.push({ path: `system.hiddenFields.${k}`, label: `Hidden: ${k}` });
  }

  // 3. Declared attrs
  for (const a of (doc.system?.declaredAttrs ?? [])) {
    if (a.path) paths.push({ path: a.path, label: `Attr: ${a.name || a.id}` });
  }

  // 4. Slot counts on this doc
  for (const def of (doc.system?.slotDefinitions ?? [])) {
    paths.push({ path: `system.slotContents.${def.id}.count`, label: `Slot count: ${def.label}` });
  }

  if (doc instanceof Actor) {
    for (const item of (doc.items ?? [])) {
      for (const [k] of Object.entries(item.system?.hiddenFields ?? {})) {
        paths.push({ path: `system.hiddenFields.${k}`, label: `${item.name}: ${k}` });
      }
      for (const a of (item.system?.declaredAttrs ?? [])) {
        if (a.path) paths.push({ path: a.path, label: `${item.name}: ${a.name || a.id}` });
      }
      for (const def of (item.system?.slotDefinitions ?? [])) {
        paths.push({ path: `system.slotContents.${def.id}.count`, label: `${item.name}: slot '${def.label}'` });
      }
    }
    // Actor own slot counts
    for (const def of (doc.system?.slotDefinitions ?? [])) {
      paths.push({ path: `system.slotContents.${def.id}.count`, label: `Actor slot: ${def.label}` });
    }
  } else {
    const actor = doc.actor;
    if (actor) {
      for (const item of (actor.items ?? [])) {
        if (item.id === doc.id) continue;
        for (const [k] of Object.entries(item.system?.hiddenFields ?? {})) {
          paths.push({ path: `system.hiddenFields.${k}`, label: `${item.name}: ${k}` });
        }
      }
    }
  }

  return paths;
}
