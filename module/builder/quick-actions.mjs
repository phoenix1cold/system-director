// Quick Actions: a no-graph way to give any Sheet Builder widget behaviour.
// A widget stores `quickActions = { event, steps:[…] }`; steps are compiled into
// ordinary ButtonExecutor actions, so everything a step does is exactly what the
// matching Blueprint node would do. Easy Button reuses the same editor for its
// "Actions" mode and stores the compiled list in `formula` (a JSON action array
// is already understood by the widget button click handler).
import { openFoundryWindow } from "../helpers/foundry-window-host.mjs";
import { getValueDefinitions } from "../helpers/value-database.mjs";

const esc = value => String(value ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const clone = value => { try { return foundry.utils.deepClone(value); } catch { return JSON.parse(JSON.stringify(value ?? {})); } };
const randomId = () => (globalThis.foundry?.utils?.randomID?.(8) ?? Math.random().toString(36).slice(2, 10));

const TARGET_OPTIONS = [
  { value:"actor",          label:"Self (this actor)" },
  { value:"token_target",   label:"First targeted token" },
  { value:"all_targets",    label:"All targeted tokens" },
  { value:"selected_token", label:"First selected token" }
];
const LEVELS = [["info","Info"],["warn","Warning"],["error","Error"]];
const ROLL_MODES = [["default","Default"],["publicroll","Public"],["gmroll","GM"],["blindroll","Blind"],["selfroll","Self"]];
const opts = pairs => pairs.map(([value, label]) => ({ value, label }));

const uiBlueprintOptions = () => [...(globalThis.game?.items ?? [])]
  .filter(item => item.type === "uiwidget")
  .map(item => ({ value: String(item.system?.blueprintId ?? item.system?.widgetKey ?? ""), label: String(item.system?.title ?? item.name) }))
  .filter(entry => entry.value);
const variableOptions = scope => getValueDefinitions(scope).map(def => ({ value: def.id, label: `${def.name ?? def.id} · ${def.type ?? "value"}` }));
const statusOptions = () => (globalThis.CONFIG?.statusEffects ?? []).map(status => ({
  value: String(status.id ?? ""), label: String(globalThis.game?.i18n?.localize?.(status.name ?? status.label ?? status.id) ?? status.id)
})).filter(entry => entry.value);
const journalOptions = () => [...(globalThis.game?.journal ?? [])].map(entry => ({ value: entry.uuid, label: entry.name }));
const macroOptions = () => [...(globalThis.game?.macros ?? [])].map(entry => ({ value: entry.uuid, label: entry.name }));

/** Step catalog. `fields` drives the editor; `compile(step, ctx)` returns executor actions. */
export const QUICK_ACTION_STEPS = {
  roll: {
    label:"Roll dice", icon:"fa-dice-d20",
    hint:"Rolls a formula and posts the result. Tokens like {system.values.strength} and @attributes work.",
    fields:[
      { key:"formula", label:"Formula", type:"text", default:"1d20", placeholder:"1d20 + {system.values.str}" },
      { key:"label",   label:"Label",   type:"text", default:"" },
      { key:"rollMode", label:"Visibility", type:"select", default:"default", options:opts(ROLL_MODES) },
      { key:"dialog", label:"Ask for modifiers (roll dialog)", type:"checkbox", default:false }
    ],
    compile:(step, ctx)=>[
      { type:"rollResultV2", mode:"formula", formula:String(step.formula || "1d20"), flavor:String(step.label || ctx.label || "Roll"),
        rollDialogue:!!step.dialog, advFormula:"", disFormula:"", critOn:20, fumbleOn:1,
        execActions:[{ type:"presentRollResult", result:"{__rollResult}", destination:"chat", label:String(step.label || ctx.label || ""), text:"", rollMode:String(step.rollMode || "default"), area:300, duration:6 }] }
    ]
  },
  openWindow: {
    label:"Open UI window", icon:"fa-window-restore",
    hint:"Opens a UI Blueprint (custom window) for the chosen audience.",
    fields:[
      { key:"blueprintId", label:"UI Blueprint", type:"select", default:"", options:uiBlueprintOptions, emptyLabel:"Select UI Blueprint…" },
      { key:"audience", label:"Show to", type:"select", default:"self", options:opts([["self","Me"],["owners","Actor owners"],["gm","GM"],["all","Everyone"]]) },
      { key:"mode", label:"Layout", type:"select", default:"", options:opts([["","Blueprint default"],["window","Window"],["fullscreen","Fullscreen"],["dock-left","Dock left"],["dock-right","Dock right"],["dock-top","Dock top"],["dock-bottom","Dock bottom"]]) }
    ],
    compile:(step)=>[{ type:"sdUiWidgetOpen", widgetKey:String(step.blueprintId ?? ""), audience:String(step.audience || "self"), users:"", mode:String(step.mode ?? ""), vars:{} }]
  },
  message: {
    label:"Chat message", icon:"fa-comment",
    hint:"Posts text to chat. Tokens like {system.values.hp} and {widget:Key} are resolved.",
    fields:[{ key:"text", label:"Message", type:"textarea", default:"", placeholder:"{name} attacks!" }],
    compile:(step)=>[{ type:"message", messageParts:[String(step.text ?? "")] }]
  },
  notify: {
    label:"Notification", icon:"fa-bell",
    hint:"Shows a toast to the current user.",
    fields:[
      { key:"text", label:"Text", type:"text", default:"Done!" },
      { key:"level", label:"Level", type:"select", default:"info", options:opts(LEVELS) }
    ],
    compile:(step)=>[{ type:"notify", text:String(step.text ?? ""), level:String(step.level || "info") }]
  },
  setVariable: {
    label:"Set Database variable", icon:"fa-database",
    hint:"Writes, adds to or subtracts from a Database variable of this sheet.",
    fields:[
      { key:"variableId", label:"Variable", type:"select", default:"", options:(ctx)=>variableOptions(ctx.scope), emptyLabel:"Select variable…" },
      { key:"operation", label:"Operation", type:"select", default:"set", options:opts([["set","Set to"],["add","Add"],["sub","Subtract"],["toggle","Toggle (boolean)"]]) },
      { key:"value", label:"Value", type:"text", default:"1", placeholder:"1, text, {system.values.other}" }
    ],
    compile:(step)=>[{ type:"setDatabaseValue", source:"self", itemId:"", variableId:String(step.variableId ?? ""), operation:String(step.operation || "set"), ref:"", value:String(step.value ?? "") }]
  },
  damage: {
    label:"Damage", icon:"fa-burst",
    hint:"Posts a damage card (or applies it directly) to the chosen tokens.",
    fields:[
      { key:"amount", label:"Amount", type:"text", default:"1d6", placeholder:"1d6 + 2" },
      { key:"target", label:"Targets", type:"select", default:"all_targets", options:TARGET_OPTIONS },
      { key:"label", label:"Title", type:"text", default:"Damage" },
      { key:"autoApply", label:"Apply automatically", type:"checkbox", default:false }
    ],
    compile:(step)=>[{ type:"chatDamage", amount:String(step.amount || "0"), target:String(step.target || "all_targets"), targets:null, label:String(step.label || "Damage"),
      customText:"", buttonLabel:"Apply Damage", hpPath:"system.resources.hp.value", postToChat:true, autoApply:!!step.autoApply, showApply:true }]
  },
  heal: {
    label:"Heal", icon:"fa-heart-pulse",
    hint:"Posts a healing card (or applies it directly) to the chosen tokens.",
    fields:[
      { key:"amount", label:"Amount", type:"text", default:"1d8", placeholder:"1d8 + 2" },
      { key:"target", label:"Targets", type:"select", default:"actor", options:TARGET_OPTIONS },
      { key:"label", label:"Title", type:"text", default:"Heal" },
      { key:"autoApply", label:"Apply automatically", type:"checkbox", default:false }
    ],
    compile:(step)=>[{ type:"chatHeal", amount:String(step.amount || "0"), target:String(step.target || "actor"), targets:null, label:String(step.label || "Heal"),
      customText:"", buttonLabel:"Apply Healing", hpPath:"system.resources.hp.value", postToChat:true, autoApply:!!step.autoApply, showApply:true }]
  },
  status: {
    label:"Status condition", icon:"fa-skull",
    hint:"Applies, removes or toggles a status condition on the chosen tokens.",
    fields:[
      { key:"statusId", label:"Status", type:"select", default:"", options:statusOptions, emptyLabel:"Select status…" },
      { key:"mode", label:"Mode", type:"select", default:"toggle", options:opts([["apply","Apply"],["remove","Remove"],["toggle","Toggle"]]) },
      { key:"target", label:"Targets", type:"select", default:"token_target", options:TARGET_OPTIONS }
    ],
    compile:(step)=>[{ type:"applyStatus", statusId:String(step.statusId ?? ""), target:String(step.target || "token_target"), mode:String(step.mode || "toggle"), overlay:false }]
  },
  addItem: {
    label:"Give item", icon:"fa-box-open",
    hint:"Adds an item to this actor. Drag the item from the sidebar or a compendium into the field.",
    fields:[
      { key:"uuid", label:"Item", type:"uuid", default:"", placeholder:"Drop an item here", accept:["Item"] },
      { key:"qty", label:"Quantity", type:"number", default:1, min:1 }
    ],
    compile:(step)=>[{ type:"createItemArray", items:String(step.uuid ?? ""), qty:Math.max(1, Number(step.qty) || 1), inventoryWidget:"" }]
  },
  journal: {
    label:"Show journal", icon:"fa-book-open",
    hint:"Opens a journal entry (optionally for everyone).",
    fields:[
      { key:"uuid", label:"Journal", type:"select", default:"", options:journalOptions, emptyLabel:"Select journal…" },
      { key:"force", label:"Show to all players (GM)", type:"checkbox", default:false }
    ],
    compile:(step)=>[{ type:"journalShow", uuid:String(step.uuid ?? ""), pageId:"", force:!!step.force }]
  },
  openSheet: {
    label:"Open sheet", icon:"fa-address-card",
    hint:"Opens the sheet of this actor / item or of the targeted token.",
    fields:[{ key:"which", label:"Sheet", type:"select", default:"self", options:opts([["self","This actor / item"],["target","First targeted token"]]) }],
    compile:(step)=>[{ type:"openSheet", uuid: step.which === "target" ? "{targetFirst:targets}" : "", asOwner:true }]
  },
  sound: {
    label:"Play sound", icon:"fa-volume-high",
    hint:"Plays an audio file for everyone.",
    fields:[
      { key:"src", label:"File", type:"file", default:"sounds/dice.wav", fileType:"audio" },
      { key:"volume", label:"Volume (0–1)", type:"number", default:0.8, step:0.1, min:0, max:1 }
    ],
    compile:(step)=>[{ type:"playSound", src:String(step.src || "sounds/dice.wav"), volume:Math.max(0, Math.min(1, Number(step.volume ?? 0.8))), loop:false }]
  },
  macro: {
    label:"Run macro", icon:"fa-code",
    hint:"Executes a world macro with this actor and item as context.",
    fields:[{ key:"uuid", label:"Macro", type:"select", default:"", options:macroOptions, emptyLabel:"Select macro…" }],
    compile:(step)=>[{ type:"runMacroByUuid", uuid:String(step.uuid ?? "") }]
  },
  delay: {
    label:"Wait", icon:"fa-hourglass-half",
    hint:"Pauses before the next step.",
    fields:[{ key:"ms", label:"Milliseconds", type:"number", default:500, min:0, max:60000 }],
    compile:(step)=>[{ type:"delay", duration:String(Math.max(0, Number(step.ms) || 0)) }]
  }
};

export const QUICK_ACTION_EVENTS = [
  { value:"click",  label:"Click" },
  { value:"change", label:"Value changed" },
  { value:"toggle", label:"Toggled" },
  { value:"hover",  label:"Hovered" },
  { value:"any",    label:"Any interaction" }
];

export function normalizeQuickStep(source = {}) {
  const kind = QUICK_ACTION_STEPS[source?.kind] ? String(source.kind) : "roll";
  const def = QUICK_ACTION_STEPS[kind];
  const step = { id: String(source?.id ?? "") || randomId(), kind };
  for (const field of def.fields) {
    const raw = source?.[field.key];
    if (field.type === "checkbox") step[field.key] = raw === true || raw === "true" || raw === "yes";
    else if (field.type === "number") step[field.key] = raw === undefined || raw === null || raw === "" ? field.default : Number(raw);
    else step[field.key] = raw === undefined || raw === null ? field.default : String(raw);
  }
  return step;
}

export function normalizeQuickActions(source) {
  const src = source && typeof source === "object" && !Array.isArray(source) ? source : { steps: Array.isArray(source) ? source : [] };
  const event = QUICK_ACTION_EVENTS.some(e => e.value === src.event) ? String(src.event) : "click";
  const steps = (Array.isArray(src.steps) ? src.steps : []).map(normalizeQuickStep);
  return { event, steps };
}

/** Compile quick steps into executor actions. */
export function compileQuickActions(steps = [], ctx = {}) {
  const out = [];
  for (const raw of Array.isArray(steps) ? steps : []) {
    const step = normalizeQuickStep(raw);
    try { out.push(...QUICK_ACTION_STEPS[step.kind].compile(step, ctx)); }
    catch (error) { console.warn("SD | quick action step failed to compile", step, error); }
  }
  return out;
}

export function describeQuickActions(steps = []) {
  const list = (Array.isArray(steps) ? steps : []).map(step => QUICK_ACTION_STEPS[step?.kind]?.label ?? step?.kind).filter(Boolean);
  return list.length ? list.join(" → ") : "No actions";
}

/** Extract a document uuid from a Foundry drag event. */
export function uuidFromDrop(event, accept = []) {
  let data = null;
  try { data = JSON.parse(event.dataTransfer?.getData("text/plain") || "null"); } catch { data = null; }
  if (!data) return "";
  let uuid = "";
  if (typeof data === "string") uuid = data;
  else if (data.uuid) uuid = String(data.uuid);
  else if (data.type && data.id) uuid = `${data.type}.${data.id}`;
  if (!uuid) return "";
  if (accept.length) {
    const type = data?.type ?? uuid.split(".")[0];
    if (!accept.includes(String(type))) return "";
  }
  return uuid;
}

/* ------------------------------------------------------------------ editor */

const STYLE = `
.sd-quick-actions{height:100%;min-height:0;display:flex;flex-direction:column;background:var(--sd-popover-bg,var(--sd-bg,#171b2b));color:var(--sd-text,#eee);font:13px Signika,sans-serif}
.sdqa-head{padding:14px 18px 10px;border-bottom:1px solid var(--sd-border,#3a4260);background:linear-gradient(120deg,color-mix(in srgb,var(--sd-accent,#7775ff) 18%,transparent),transparent);display:flex;gap:14px;align-items:center}
.sdqa-head b{display:block;font-size:16px;color:var(--sd-accent,#9290ff)}.sdqa-head small{display:block;color:var(--sd-text-3,#8f96aa);font-size:11px;margin-top:2px}
.sdqa-head label{margin-left:auto;display:flex;flex-direction:column;gap:3px;font-size:11px;color:var(--sd-text-3)}
.sdqa-body{flex:1;min-height:0;overflow:auto;padding:12px 18px;display:flex;flex-direction:column;gap:10px}
.sdqa-step{border:1px solid var(--sd-border,#3a4260);border-radius:9px;background:var(--sd-bg-2,#1d2235);overflow:hidden}
.sdqa-step-head{display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--sd-bg-3,#232a40);border-bottom:1px solid var(--sd-border,#3a4260)}
.sdqa-step-head .sdqa-index{width:22px;height:22px;border-radius:50%;display:grid;place-items:center;font-size:11px;font-weight:700;background:var(--sd-accent,#7775ff);color:#fff}
.sdqa-step-head select{flex:1;min-width:0}
.sdqa-step-head button{width:26px;height:26px;border:none;border-radius:6px;background:transparent;color:var(--sd-text-3);cursor:pointer}
.sdqa-step-head button:hover{background:var(--sd-bg);color:var(--sd-text)}
.sdqa-step-head button:disabled{opacity:.3;cursor:default}
.sdqa-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px 12px;padding:10px}
.sdqa-fields label{display:flex;flex-direction:column;gap:3px;font-size:11px;color:var(--sd-text-3,#8f96aa)}
.sdqa-fields label.wide{grid-column:1/-1}
.sdqa-fields label.check{flex-direction:row;align-items:center;gap:8px;color:var(--sd-text)}
.sdqa-fields input,.sdqa-fields select,.sdqa-fields textarea,.sdqa-head select{background:var(--sd-bg,#171b2b);border:1px solid var(--sd-border,#3a4260);border-radius:6px;color:var(--sd-text,#eee);padding:6px 8px;font:inherit;min-width:0}
.sdqa-fields textarea{min-height:64px;resize:vertical}
.sdqa-hint{padding:0 10px 10px;font-size:11px;color:var(--sd-text-3,#8f96aa)}
.sdqa-drop{border:1px dashed var(--sd-border,#3a4260);border-radius:6px;padding:6px 8px;min-height:32px;display:flex;align-items:center;gap:8px;background:var(--sd-bg,#171b2b);color:var(--sd-text)}
.sdqa-drop.is-over{border-color:var(--sd-accent,#7775ff);background:color-mix(in srgb,var(--sd-accent,#7775ff) 12%,var(--sd-bg))}
.sdqa-drop small{color:var(--sd-text-3)}.sdqa-drop button{margin-left:auto;border:none;background:transparent;color:var(--sd-text-3);cursor:pointer}
.sdqa-empty{padding:26px;text-align:center;color:var(--sd-text-3,#8f96aa);border:1px dashed var(--sd-border,#3a4260);border-radius:9px}
.sdqa-add-row{display:flex;flex-wrap:wrap;gap:6px}
.sdqa-add{border:1px solid var(--sd-border,#3a4260);border-radius:7px;background:var(--sd-bg-2,#1d2235);color:var(--sd-text,#eee);padding:6px 10px;cursor:pointer;font:inherit;font-size:12px;display:flex;align-items:center;gap:6px}
.sdqa-add:hover{border-color:var(--sd-accent,#7775ff);color:var(--sd-accent,#9290ff)}
.sdqa-foot{display:flex;gap:8px;padding:10px 18px;border-top:1px solid var(--sd-border,#3a4260)}
.sdqa-foot .spacer{flex:1}
.sdqa-btn{border:1px solid var(--sd-border,#3a4260);border-radius:7px;background:var(--sd-bg-2,#1d2235);color:var(--sd-text,#eee);padding:7px 14px;cursor:pointer;font:inherit}
.sdqa-btn.primary{background:var(--sd-accent,#7775ff);border-color:var(--sd-accent,#7775ff);color:#fff;font-weight:600}
`;

function fieldControl(step, field, ctx) {
  const value = step[field.key];
  const name = `data-step-field="${esc(field.key)}"`;
  if (field.type === "checkbox") return `<label class="check"><input type="checkbox" ${name} ${value ? "checked" : ""}><span>${esc(field.label)}</span></label>`;
  if (field.type === "select") {
    const options = typeof field.options === "function" ? field.options(ctx) : field.options;
    const known = options.some(option => String(option.value) === String(value ?? ""));
    return `<label><span>${esc(field.label)}</span><select ${name}>
      ${field.emptyLabel ? `<option value="">${esc(field.emptyLabel)}</option>` : ""}
      ${!known && value ? `<option value="${esc(value)}" selected>${esc(value)} (missing)</option>` : ""}
      ${options.map(option => `<option value="${esc(option.value)}" ${String(option.value) === String(value ?? "") ? "selected" : ""}>${esc(option.label)}</option>`).join("")}
    </select></label>`;
  }
  if (field.type === "textarea") return `<label class="wide"><span>${esc(field.label)}</span><textarea ${name} placeholder="${esc(field.placeholder ?? "")}">${esc(value)}</textarea></label>`;
  if (field.type === "uuid") {
    let label = "";
    try { label = value ? (globalThis.fromUuidSync?.(String(value))?.name ?? "") : ""; } catch { label = ""; }
    return `<label class="wide"><span>${esc(field.label)}</span>
      <div class="sdqa-drop" data-drop-field="${esc(field.key)}" data-accept="${esc((field.accept ?? []).join(","))}">
        <i class="fas fa-hand-pointer"></i>
        <span>${value ? `<b>${esc(label || value)}</b> <small>${esc(value)}</small>` : `<small>${esc(field.placeholder ?? "Drop a document here")}</small>`}</span>
        <input type="hidden" ${name} value="${esc(value)}">
        ${value ? `<button type="button" data-clear-field="${esc(field.key)}" title="Clear"><i class="fas fa-xmark"></i></button>` : ""}
      </div></label>`;
  }
  if (field.type === "file") return `<label class="wide"><span>${esc(field.label)}</span><div style="display:flex;gap:6px"><input type="text" ${name} value="${esc(value)}" style="flex:1"><button type="button" class="sdqa-btn" data-pick-file="${esc(field.key)}" data-file-type="${esc(field.fileType ?? "audio")}" title="Browse"><i class="fas fa-folder-open"></i></button></div></label>`;
  if (field.type === "number") return `<label><span>${esc(field.label)}</span><input type="number" ${name} value="${esc(value)}" step="${esc(field.step ?? 1)}" ${field.min !== undefined ? `min="${field.min}"` : ""} ${field.max !== undefined ? `max="${field.max}"` : ""}></label>`;
  return `<label><span>${esc(field.label)}</span><input type="text" ${name} value="${esc(value)}" placeholder="${esc(field.placeholder ?? "")}"></label>`;
}

/**
 * Open the Quick Actions editor.
 * @param {object} config  `{ event, steps }`
 * @param {Document|null} doc
 * @param {object} options `{ title, windowTitle, showEvent, label, id }`
 * @returns {Promise<{event:string, steps:object[]}|null>}
 */
export function openQuickActionsEditor(config = {}, doc = null, options = {}) {
  const state = normalizeQuickActions(clone(config));
  const ctx = { scope: doc?.documentName === "Item" ? "item" : "actor", label: String(options.label ?? "") };
  const showEvent = options.showEvent !== false;
  const root = document.createElement("div");
  root.className = "sd-quick-actions";
  let app = null, settled = false;

  return new Promise(resolve => {
    const finish = async value => {
      if (settled) return;
      settled = true;
      resolve(value);
      await app?.close?.({ sdSkipCallback: true });
    };
    const sync = () => {
      const eventSelect = root.querySelector("[data-event]");
      if (eventSelect) state.event = eventSelect.value;
      root.querySelectorAll("[data-step-index]").forEach(card => {
        const step = state.steps[Number(card.dataset.stepIndex)];
        if (!step) return;
        card.querySelectorAll("[data-step-field]").forEach(input => {
          const key = input.dataset.stepField;
          step[key] = input.type === "checkbox" ? input.checked : input.type === "number" ? Number(input.value) : input.value;
        });
      });
    };
    const stepCard = (step, index) => {
      const def = QUICK_ACTION_STEPS[step.kind];
      return `<div class="sdqa-step" data-step-index="${index}">
        <div class="sdqa-step-head">
          <span class="sdqa-index">${index + 1}</span>
          <i class="fas ${esc(def.icon)}"></i>
          <select data-step-kind>${Object.entries(QUICK_ACTION_STEPS).map(([kind, entry]) => `<option value="${kind}" ${kind === step.kind ? "selected" : ""}>${esc(entry.label)}</option>`).join("")}</select>
          <button type="button" data-move="-1" ${index === 0 ? "disabled" : ""} title="Move up"><i class="fas fa-arrow-up"></i></button>
          <button type="button" data-move="1" ${index === state.steps.length - 1 ? "disabled" : ""} title="Move down"><i class="fas fa-arrow-down"></i></button>
          <button type="button" data-duplicate title="Duplicate"><i class="fas fa-clone"></i></button>
          <button type="button" data-remove title="Remove"><i class="fas fa-trash"></i></button>
        </div>
        <div class="sdqa-fields">${def.fields.map(field => fieldControl(step, field, ctx)).join("")}</div>
        <div class="sdqa-hint"><i class="fas fa-circle-info"></i> ${esc(def.hint)}</div>
      </div>`;
    };
    const render = () => {
      root.innerHTML = `<style>${STYLE}</style>
        <div class="sdqa-head">
          <div><b>${esc(options.title ?? "Quick Actions")}</b><small>Steps run top to bottom, without a Blueprint graph. Each step is a ready-made Blueprint action.</small></div>
          ${showEvent ? `<label><span>Run on</span><select data-event>${QUICK_ACTION_EVENTS.map(e => `<option value="${e.value}" ${e.value === state.event ? "selected" : ""}>${esc(e.label)}</option>`).join("")}</select></label>` : ""}
        </div>
        <div class="sdqa-body">
          ${state.steps.length ? state.steps.map(stepCard).join("") : `<div class="sdqa-empty"><i class="fas fa-wand-magic-sparkles"></i><br>No steps yet. Add one below — roll dice, open a window, post a message…</div>`}
          <div class="sdqa-add-row">${Object.entries(QUICK_ACTION_STEPS).map(([kind, entry]) => `<button type="button" class="sdqa-add" data-add="${kind}"><i class="fas ${esc(entry.icon)}"></i>${esc(entry.label)}</button>`).join("")}</div>
        </div>
        <div class="sdqa-foot">
          <button type="button" class="sdqa-btn" data-cancel>Cancel</button>
          <span class="spacer"></span>
          <button type="button" class="sdqa-btn primary" data-save><i class="fas fa-check"></i> Save</button>
        </div>`;
      bind();
    };
    const bind = () => {
      root.querySelectorAll("[data-add]").forEach(button => button.addEventListener("click", () => {
        sync(); state.steps.push(normalizeQuickStep({ kind: button.dataset.add })); render();
      }));
      root.querySelectorAll("[data-step-index]").forEach(card => {
        const index = Number(card.dataset.stepIndex);
        card.querySelector("[data-step-kind]")?.addEventListener("change", event => {
          sync(); state.steps[index] = normalizeQuickStep({ id: state.steps[index].id, kind: event.target.value }); render();
        });
        card.querySelectorAll("[data-move]").forEach(button => button.addEventListener("click", () => {
          sync(); const to = index + Number(button.dataset.move);
          if (to < 0 || to >= state.steps.length) return;
          const [step] = state.steps.splice(index, 1); state.steps.splice(to, 0, step); render();
        }));
        card.querySelector("[data-duplicate]")?.addEventListener("click", () => {
          sync(); state.steps.splice(index + 1, 0, normalizeQuickStep({ ...clone(state.steps[index]), id: "" })); render();
        });
        card.querySelector("[data-remove]")?.addEventListener("click", () => { sync(); state.steps.splice(index, 1); render(); });
        card.querySelectorAll("[data-clear-field]").forEach(button => button.addEventListener("click", () => {
          sync(); state.steps[index][button.dataset.clearField] = ""; render();
        }));
        card.querySelectorAll("[data-pick-file]").forEach(button => button.addEventListener("click", () => {
          const FP = foundry.applications?.apps?.FilePicker ?? globalThis.FilePicker;
          if (!FP) return;
          sync();
          new FP({ type: button.dataset.fileType || "audio", current: String(state.steps[index][button.dataset.pickFile] ?? ""),
            callback: src => { state.steps[index][button.dataset.pickFile] = src || ""; render(); } }).render(true);
        }));
        card.querySelectorAll("[data-drop-field]").forEach(zone => {
          const accept = String(zone.dataset.accept ?? "").split(",").filter(Boolean);
          zone.addEventListener("dragover", event => { event.preventDefault(); zone.classList.add("is-over"); });
          zone.addEventListener("dragleave", () => zone.classList.remove("is-over"));
          zone.addEventListener("drop", event => {
            event.preventDefault(); zone.classList.remove("is-over");
            const uuid = uuidFromDrop(event, accept);
            if (!uuid) { ui.notifications?.warn?.(`Drop ${accept.join(" / ") || "a document"} here.`); return; }
            sync(); state.steps[index][zone.dataset.dropField] = uuid; render();
          });
        });
      });
      root.querySelector("[data-cancel]")?.addEventListener("click", () => finish(null));
      root.querySelector("[data-save]")?.addEventListener("click", () => { sync(); finish(normalizeQuickActions(state)); });
    };
    render();
    app = openFoundryWindow({
      id: `sd-quick-actions-${options.id ?? randomId()}`,
      title: options.windowTitle ?? "Quick Actions",
      icon: "fa-solid fa-wand-magic-sparkles",
      width: 700, height: 640, minWidth: 460, minHeight: 400,
      classes: ["sd-quick-actions-window"],
      content: root,
      onClose: () => finish(null)
    });
  });
}
