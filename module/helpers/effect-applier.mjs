import { localizeTree, getLanguages, translationEditLanguage, setTranslationEditLanguage, setLocalizedField } from "./localization.mjs";
import { getValueDefinitions, getValueDefinition, valueStoragePath } from "./value-database.mjs";
import { effectTargetVariables } from "./effects.mjs";

const { ApplicationV2, DialogV2 } = globalThis.foundry?.applications?.api ?? {};
const clone=v=>foundry.utils.deepClone(v);
const esc=s=>String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const MODES=[
  {value:0,label:"Custom"},{value:1,label:"Multiply"},{value:2,label:"Add"},
  {value:3,label:"Downgrade"},{value:4,label:"Upgrade"},{value:5,label:"Override"}
];

function normalizePreset(p={}){
  return {
    id:String(p.id||foundry.utils.randomID(10)),name:String(p.name||"New Effect"),description:String(p.description||""),
    icon:String(p.icon||p.img||"icons/svg/aura.svg"),disabled:!!p.disabled,transfer:!!p.transfer,
    duration:{rounds:Number(p.duration?.rounds||0),seconds:Number(p.duration?.seconds||0)},
    changes:Array.isArray(p.changes)?p.changes.map(c=>{const key=String(c.key||"");const def=getValueDefinitions().find(v=>v.id===c.variableId||valueStoragePath(v.id)===key||v.legacyPath===key);return {variableId:String(c.variableId||def?.id||""),legacyKey:def?"":key,mode:Number(c.mode??2),value:String(c.value??""),priority:Number(c.priority??20)}}):[],
    i18n:p.i18n&&typeof p.i18n==="object"?clone(p.i18n):{}
  };
}
function getPresetMap(){let v={};try{v=game.settings.get("sd","effectPresets")??{};}catch{};return Object.fromEntries(Object.entries(v).map(([id,p])=>[id,normalizePreset({...p,id:p?.id||id})]));}
async function savePresetMap(v){return game.settings.set("sd","effectPresets",v);}

export function registerEffectApplierSettings(){
  game.settings.register("sd","effectPresets",{name:"Effect Applier presets",scope:"world",config:false,type:Object,default:{}});
  game.settings.register("sd","allowPlayerEffectApplier",{name:"Allow players to use Effect Applier",scope:"world",config:false,type:Boolean,default:false});
}

export const EFFECT_TARGET_SCOPES = [
  { value: "selected", label: "Selected tokens" },
  { value: "targeted", label: "Targeted tokens" },
  { value: "self", label: "My character" },
  { value: "owned", label: "All my actors" },
  { value: "all", label: "All actors in the scene" }
];

/** Resolve the actors an Effect Applier operation should touch. */
export function resolveEffectTargets(scope = "selected", { actor = null } = {}) {
  const list = [];
  const push = candidate => { if (candidate && !list.includes(candidate)) list.push(candidate); };
  switch (String(scope)) {
    case "targeted": for (const token of (game.user?.targets ?? [])) push(token.actor); break;
    case "self": push(actor ?? game.user?.character ?? canvas?.tokens?.controlled?.[0]?.actor); break;
    case "owned": for (const candidate of (game.actors ?? [])) if (candidate.isOwner) push(candidate); break;
    case "all": for (const token of (canvas?.tokens?.placeables ?? [])) push(token.actor); break;
    default: for (const token of (canvas?.tokens?.controlled ?? [])) push(token.actor);
  }
  return list.filter(candidate => game.user?.isGM || candidate.isOwner);
}

/** Build the ActiveEffect payload of a preset. Changes always point at Database variables. */
export function presetToEffectData(rawPreset) {
  const preset = normalizePreset(rawPreset ?? {});
  const known = effectTargetVariables();
  return {
    name: localizeTree(preset).name,
    img: preset.icon, icon: preset.icon,
    disabled: preset.disabled, transfer: preset.transfer,
    duration: clone(preset.duration),
    changes: preset.changes
      .filter(change => (change.variableId && getValueDefinition(change.variableId)) || change.legacyKey)
      .map(change => ({
        key: change.variableId ? valueStoragePath(change.variableId) : change.legacyKey,
        mode: Number(change.mode ?? 2),
        value: String(change.value ?? ""),
        priority: Number(change.priority ?? 20)
      })),
    flags: { sd: {
      effectPresetId: preset.id,
      effectPresetI18n: clone(preset.i18n),
      effectVariables: preset.changes.map(change => ({
        variableId: change.variableId,
        name: known.find(entry => entry.id === change.variableId)?.name ?? change.variableId ?? change.legacyKey,
        mode: Number(change.mode ?? 2),
        value: String(change.value ?? "")
      }))
    } }
  };
}

const presetEffectsOf = (actor, presetId) => [...(actor?.effects ?? [])]
  .filter(effect => effect.getFlag?.("sd", "effectPresetId") === presetId || effect.flags?.sd?.effectPresetId === presetId);

/** Apply / remove / toggle one preset on a set of actors. Returns the number of actors touched. */
export async function runEffectPreset({ preset, actors = [], operation = "apply" } = {}) {
  const data = presetToEffectData(preset);
  const presetId = data.flags.sd.effectPresetId;
  let touched = 0;
  for (const actor of actors) {
    const existing = presetEffectsOf(actor, presetId);
    if (operation === "remove") {
      if (!existing.length) continue;
      await actor.deleteEmbeddedDocuments("ActiveEffect", existing.map(effect => effect.id));
      touched++;
      continue;
    }
    if (operation === "toggle") {
      if (existing.length) {
        await actor.updateEmbeddedDocuments("ActiveEffect", existing.map(effect => ({ _id: effect.id, disabled: !effect.disabled })));
      } else {
        await actor.createEmbeddedDocuments("ActiveEffect", [data]);
      }
      touched++;
      continue;
    }
    if (existing.length) {
      await actor.updateEmbeddedDocuments("ActiveEffect", existing.map(effect => ({ _id: effect.id, ...data })));
    } else {
      await actor.createEmbeddedDocuments("ActiveEffect", [data]);
    }
    touched++;
  }
  return touched;
}

/** Presets available to graphs and macros. */
export function effectPresets() { return Object.values(getPresetMap()); }
export function findEffectPreset(idOrName) {
  const wanted = String(idOrName ?? "").trim().toLowerCase();
  if (!wanted) return null;
  const all = effectPresets();
  return all.find(preset => preset.id.toLowerCase() === wanted)
      ?? all.find(preset => String(localizeTree(preset).name ?? "").toLowerCase() === wanted)
      ?? null;
}

export class EffectApplierApp extends ApplicationV2 {
  static DEFAULT_OPTIONS={
    id:"sd-effect-applier",classes:["sd","sd-effect-applier"],
    window:{title:"Effect Applier",icon:"fa-solid fa-wand-magic-sparkles",resizable:true,minimizable:true},
    position:{width:900,height:620}
  };
  static _instance=null;
  static open(){
    if(!game.user?.isGM&&!game.settings.get("sd","allowPlayerEffectApplier")){ui.notifications?.warn?.("Effect Applier is disabled for players.");return null;}
    if(!this._instance)this._instance=new EffectApplierApp();
    else if(!this._instance.rendered){this._instance._presets=getPresetMap();this._instance._selected=Object.keys(this._instance._presets)[0]||null;}
    this._instance.render(true);return this._instance;
  }
  constructor(options={}){super(options);this._presets=getPresetMap();this._selected=Object.keys(this._presets)[0]||null;this._scope="selected";}
  get title(){return "Effect Applier";}
  _selectedPreset(){return this._selected?this._presets[this._selected]??null:null;}
  async _renderHTML(){
    const editLang=translationEditLanguage(),langs=getLanguages(),canEdit=!!game.user?.isGM,raw=this._selectedPreset(),p=raw?localizeTree(raw,editLang):null,lock=canEdit?"":"disabled",variables=getValueDefinitions();
    const q=String(this._filter??"").trim().toLowerCase();
    const list=Object.values(this._presets).map(x=>({x,l:localizeTree(x)})).filter(({l})=>!q||String(l.name??"").toLowerCase().includes(q));
    const rows=list.map(({x,l})=>`<div class="sd-list-row ${x.id===this._selected?"active":""}" data-preset="${esc(x.id)}" role="button" tabindex="0">
        <img src="${esc(x.icon)}" alt=""><span class="sd-list-name">${esc(l.name)}</span><span class="sd-badge" title="Changes">${x.changes.length}</span>
        ${canEdit?`<span class="sd-row-actions"><button type="button" data-row-action="duplicate" title="Duplicate"><i class="fas fa-copy"></i></button><button type="button" class="danger" data-row-action="delete" title="Delete"><i class="fas fa-trash"></i></button></span>`:""}
      </div>`).join("");
    const changeRows=p?.changes?.map((c,i)=>`<div class="sd-table-row sd-ea-change" data-index="${i}">
        <select class="sd-select" data-change="variableId" ${lock}><option value="">Select variable…</option>${variables.map(v=>`<option value="${esc(v.id)}" ${c.variableId===v.id?"selected":""}>${esc(v.name)} · ${esc(v.type)}</option>`).join("")}</select>
        <select class="sd-select" data-change="mode" ${lock}>${MODES.map(m=>`<option value="${m.value}" ${Number(c.mode)===m.value?"selected":""}>${m.label}</option>`).join("")}</select>
        <input class="sd-input" data-change="value" value="${esc(c.value)}" placeholder="Value or formula" ${lock}>
        <input class="sd-input" type="number" data-change="priority" value="${Number(c.priority??20)}" title="Priority" ${lock}>
        <span class="sd-row-actions"><button type="button" class="danger" data-action="removeChange" title="Remove change" ${lock}><i class="fas fa-trash"></i></button></span>
      </div>`).join("");
    const changes=changeRows?`<div class="sd-table sd-ea-changes">${changeRows}</div>`
      :`<div class="sd-empty"><i class="fas fa-code-branch"></i><span>No changes yet.</span>${canEdit?`<button type="button" class="sd-btn" data-action="addChange"><i class="fas fa-plus"></i> Add change</button>`:""}</div>`;
    const sw=(name,label,checked)=>`<label class="sd-switch"><input type="checkbox" name="${name}" ${checked?"checked":""} ${lock}><span class="sd-switch-track"></span><span>${label}</span></label>`;
    const editor=p?`
      <div class="sd-detail-hdr">
        <div class="sd-detail-icon" data-action="pickIcon" title="Change icon"><img src="${esc(raw.icon)}" alt=""></div>
        <div class="sd-detail-name">
          <input name="name" value="${esc(p.name)}" placeholder="Effect name" ${canEdit?"":"readonly"}>
          <div class="sd-detail-sub">${raw.changes.length} change${raw.changes.length===1?"":"s"} · ${raw.duration.rounds||raw.duration.seconds?`${raw.duration.rounds?raw.duration.rounds+" rd":""} ${raw.duration.seconds?raw.duration.seconds+" s":""}`.trim():"no duration"}<span class="sd-ea-saved" data-saved hidden> · saved</span></div>
        </div>
        <div class="sd-detail-actions">
          <select class="sd-select" data-action="editLanguage" title="Editing language (Base stores source text)">${langs.map(l=>`<option value="${l.id}" ${l.id===editLang?"selected":""}>${esc(l.name)}</option>`).join("")}</select>
        </div>
      </div>
      <div class="sd-form-grid">
        <label class="sd-span-2"><span>Description</span><textarea class="sd-textarea" name="description" rows="3" ${canEdit?"":"readonly"}>${esc(p.description)}</textarea></label>
        <label><span>Icon path</span><input class="sd-input" name="icon" value="${esc(raw.icon)}" ${canEdit?"":"readonly"}></label>
        <div class="sd-form-row" style="align-self:end"><label>Rounds <input class="sd-input" type="number" min="0" name="rounds" value="${raw.duration.rounds}" ${lock}></label><label>Seconds <input class="sd-input" type="number" min="0" name="seconds" value="${raw.duration.seconds}" ${lock}></label></div>
        <div class="sd-form-row sd-span-2">${sw("disabled","Start disabled",raw.disabled)}${sw("transfer","Transfer to actor",raw.transfer)}</div>
      </div>
      <section class="sd-section">
        <div class="sd-section-hdr"><h4>Changes <span class="sd-badge">${raw.changes.length}</span></h4>${canEdit&&changeRows?`<button type="button" class="sd-btn sd-btn-ghost" data-action="addChange"><i class="fas fa-plus"></i> Add change</button>`:""}</div>
        ${changes}
      </section>`
      :`<div class="sd-empty" style="margin:auto;border:none"><i class="fas fa-wand-magic-sparkles"></i><span>Select a preset or create a new one.</span>${canEdit?`<button type="button" class="sd-btn sd-btn-primary" data-action="new"><i class="fas fa-plus"></i> New effect</button>`:""}</div>`;
    return `<div class="sd-shell sd-ea-root">
      <div class="sd-master-detail">
        <aside class="sd-master">
          <div class="sd-master-search"><i class="fas fa-search"></i><input class="sd-input" data-action="filter" value="${esc(this._filter??"")}" placeholder="Search presets"></div>
          <nav class="sd-list">${rows||`<div class="sd-empty" style="border:none"><i class="fas fa-layer-group"></i><span>${q?"Nothing found":"No presets"}</span></div>`}</nav>
          ${canEdit?`<div class="sd-master-foot"><button type="button" class="sd-btn" style="width:100%" data-action="new"><i class="fas fa-plus"></i> New effect</button></div>`:""}
        </aside>
        <main class="sd-detail">${editor}</main>
      </div>
      <footer class="sd-footer">
        <label class="sd-form-row"><span class="sd-field-label">Targets</span><select class="sd-select" style="width:auto" data-action="targetScope">${EFFECT_TARGET_SCOPES.map(s=>`<option value="${s.value}" ${s.value===this._scope?"selected":""}>${esc(s.label)}</option>`).join("")}</select></label>
        <div class="sd-toolbar-spacer"></div>
        ${p?`<button type="button" class="sd-btn sd-btn-ghost" data-action="toggle"><i class="fas fa-toggle-on"></i> Toggle</button>
        <button type="button" class="sd-btn sd-btn-danger-ghost" data-action="remove"><i class="fas fa-eraser"></i> Remove</button>
        <button type="button" class="sd-btn sd-btn-primary" data-action="apply"><i class="fas fa-wand-magic-sparkles"></i> Apply</button>`:""}
      </footer>
    </div>`;
  }
  _replaceHTML(html,content){content.innerHTML=html;content.style.padding="0";}
  async close(options){clearTimeout(this._saveTimer);if(this._saveTimer!==undefined){const snap=clone(this._presets);for(const p of Object.values(snap))p.changes=p.changes.filter(c=>c.variableId.trim()||c.legacyKey);await savePresetMap(snap).catch(()=>{});}return super.close(options);}
  _collect(){const p=this._selectedPreset();if(!p||!this.element)return p;const lang=translationEditLanguage();const name=this.element.querySelector('[name="name"]')?.value??p.name;const description=this.element.querySelector('[name="description"]')?.value??p.description;setLocalizedField(p,"name",name,lang);setLocalizedField(p,"description",description,lang);p.icon=this.element.querySelector('[name="icon"]')?.value??p.icon;p.disabled=!!this.element.querySelector('[name="disabled"]')?.checked;p.transfer=!!this.element.querySelector('[name="transfer"]')?.checked;p.duration={rounds:Number(this.element.querySelector('[name="rounds"]')?.value||0),seconds:Number(this.element.querySelector('[name="seconds"]')?.value||0)};p.changes=[...this.element.querySelectorAll('.sd-ea-change')].map(r=>({variableId:r.querySelector('[data-change="variableId"]')?.value||"",mode:Number(r.querySelector('[data-change="mode"]')?.value??2),value:r.querySelector('[data-change="value"]')?.value||"",priority:Number(r.querySelector('[data-change="priority"]')?.value??20)}));return p;}
  _onRender(){
    super._onRender?.();
    const root=this.element;if(!root)return;
    const canEdit=!!game.user?.isGM;
    root.querySelectorAll('[data-preset]').forEach(row=>{
      const pick=()=>{this._collect();this._selected=row.dataset.preset;this.render();};
      row.addEventListener('click',ev=>{if(ev.target.closest('[data-row-action]'))return;pick();});
      row.addEventListener('keydown',ev=>{if(ev.key==='Enter'||ev.key===' '){ev.preventDefault();pick();}});
      row.querySelector('[data-row-action="duplicate"]')?.addEventListener('click',ev=>{ev.stopPropagation();this._collect();const src=this._presets[row.dataset.preset];if(!src)return;const p=normalizePreset({...clone(src),id:foundry.utils.randomID(10),name:`${src.name} Copy`});this._presets[p.id]=p;this._selected=p.id;this._persist();this.render();});
      row.querySelector('[data-row-action="delete"]')?.addEventListener('click',async ev=>{ev.stopPropagation();const id=row.dataset.preset;const ok=await DialogV2.confirm({window:{title:"Delete effect preset"},content:`<p>Delete “${esc(localizeTree(this._presets[id]??{}).name??"")}”?</p>`}).catch(()=>false);if(!ok)return;delete this._presets[id];if(this._selected===id)this._selected=Object.keys(this._presets)[0]||null;await savePresetMap(this._presets);this.render();});
    });
    const filter=root.querySelector('[data-action="filter"]');
    filter?.addEventListener('input',()=>{this._filter=filter.value;const list=root.querySelector('.sd-list');const q=filter.value.trim().toLowerCase();list?.querySelectorAll('[data-preset]').forEach(r=>{r.hidden=!!q&&!r.querySelector('.sd-list-name').textContent.toLowerCase().includes(q);});});
    root.querySelector('[data-action="editLanguage"]')?.addEventListener('change',async e=>{this._collect();await setTranslationEditLanguage(e.target.value);this.render();});
    root.querySelectorAll('[data-action="new"]').forEach(b=>b.addEventListener('click',()=>{const p=normalizePreset();this._presets[p.id]=p;this._selected=p.id;this._persist();this.render().then(()=>this.element?.querySelector('[name="name"]')?.select());}));
    root.querySelectorAll('[data-action="addChange"]').forEach(b=>b.addEventListener('click',async()=>{const p=this._collect();p.changes.push({variableId:"",mode:2,value:"",priority:20});await this.render();this.element?.querySelector('.sd-ea-change:last-child [data-change="variableId"]')?.focus();}));
    root.querySelectorAll('[data-action="removeChange"]').forEach(b=>b.addEventListener('click',()=>{const p=this._collect();p.changes.splice(Number(b.closest('.sd-ea-change').dataset.index),1);this._persist();this.render();}));
    root.querySelector('[data-action="pickIcon"]')?.addEventListener('click',()=>{
      if(!canEdit)return;
      const FP=globalThis.foundry?.applications?.apps?.FilePicker?.implementation??globalThis.FilePicker;
      if(!FP)return root.querySelector('[name="icon"]')?.focus();
      new FP({type:"image",current:this._selectedPreset()?.icon,callback:path=>{const inp=root.querySelector('[name="icon"]');if(inp){inp.value=path;inp.dispatchEvent(new Event('change',{bubbles:true}));}}}).render(true);
    });
    // Autosave: every edit persists the preset map (debounced); the header mirrors icon/name live.
    if(canEdit){
      const detail=root.querySelector('.sd-detail');
      const onEdit=ev=>{
        const t=ev.target;if(!t.matches('input,select,textarea'))return;
        this._collect();
        if(t.name==='icon')root.querySelector('.sd-detail-icon img')?.setAttribute('src',t.value);
        if(t.name==='name'){const row=root.querySelector(`[data-preset="${this._selected}"] .sd-list-name`);if(row)row.textContent=t.value;}
        this._persist();
      };
      detail?.addEventListener('input',onEdit);detail?.addEventListener('change',onEdit);
    }
    root.querySelector('[data-action="targetScope"]')?.addEventListener('change',e=>{this._scope=e.target.value;});
    root.querySelector('[data-action="apply"]')?.addEventListener('click',()=>this._run("apply"));
    root.querySelector('[data-action="remove"]')?.addEventListener('click',()=>this._run("remove"));
    root.querySelector('[data-action="toggle"]')?.addEventListener('click',()=>this._run("toggle"));
  }
  _persist(){
    clearTimeout(this._saveTimer);
    this._saveTimer=setTimeout(async()=>{
      const snapshot=clone(this._presets);
      for(const p of Object.values(snapshot))p.changes=p.changes.filter(c=>c.variableId.trim()||c.legacyKey);
      try{await savePresetMap(snapshot);}catch(err){console.error("SD | Effect Applier autosave failed:",err);return;}
      const badge=this.element?.querySelector('[data-saved]');if(badge){badge.hidden=false;clearTimeout(this._savedTimer);this._savedTimer=setTimeout(()=>{badge.hidden=true;},1500);}
    },400);
  }
  async _run(operation="apply"){
    const raw=this._collect();
    if(!raw)return;
    const scope=this.element?.querySelector('[data-action="targetScope"]')?.value??this._scope??"selected";
    this._scope=scope;
    const actors=resolveEffectTargets(scope);
    if(!actors.length)return ui.notifications?.warn?.("No target found for this scope.");
    const touched=await runEffectPreset({preset:raw,actors,operation});
    if(!touched)return ui.notifications?.warn?.("Nothing to change on the chosen targets.");
    const name=localizeTree(normalizePreset(raw)).name;
    const verb=operation==="remove"?"Removed":operation==="toggle"?"Toggled":"Applied";
    ui.notifications?.info?.(`${verb} \u201c${name}\u201d on ${touched} actor${touched===1?"":"s"}.`);
  }
  async _apply(){return this._run("apply");}
}
