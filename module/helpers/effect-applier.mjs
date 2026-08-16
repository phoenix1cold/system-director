import { localizeTree, getLanguages, translationEditLanguage, setTranslationEditLanguage, setLocalizedField } from "./localization.mjs";

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
    changes:Array.isArray(p.changes)?p.changes.map(c=>({key:String(c.key||""),mode:Number(c.mode??2),value:String(c.value??""),priority:Number(c.priority??20)})):[],
    i18n:p.i18n&&typeof p.i18n==="object"?clone(p.i18n):{}
  };
}
function getPresetMap(){let v={};try{v=game.settings.get("sd","effectPresets")??{};}catch{};return Object.fromEntries(Object.entries(v).map(([id,p])=>[id,normalizePreset({...p,id:p?.id||id})]));}
async function savePresetMap(v){return game.settings.set("sd","effectPresets",v);}

export function registerEffectApplierSettings(){
  game.settings.register("sd","effectPresets",{name:"Effect Applier presets",scope:"world",config:false,type:Object,default:{}});
  game.settings.register("sd","allowPlayerEffectApplier",{name:"Allow players to use Effect Applier",scope:"world",config:false,type:Boolean,default:false});
}

export class EffectApplierApp extends ApplicationV2 {
  static DEFAULT_OPTIONS={
    id:"sd-effect-applier",classes:["sd","sd-effect-applier"],
    window:{title:"Effect Applier",icon:"fa-solid fa-wand-magic-sparkles",resizable:true,minimizable:true},
    position:{width:960,height:700}
  };
  static _instance=null;
  static open(){
    if(!game.user?.isGM&&!game.settings.get("sd","allowPlayerEffectApplier")){ui.notifications?.warn?.("Effect Applier is disabled for players.");return null;}
    if(!this._instance)this._instance=new EffectApplierApp();
    else if(!this._instance.rendered){this._instance._presets=getPresetMap();this._instance._selected=Object.keys(this._instance._presets)[0]||null;}
    this._instance.render(true);return this._instance;
  }
  constructor(options={}){super(options);this._presets=getPresetMap();this._selected=Object.keys(this._presets)[0]||null;}
  get title(){return "Effect Applier";}
  _selectedPreset(){return this._selected?this._presets[this._selected]??null:null;}
  async _renderHTML(){
    const editLang=translationEditLanguage(),langs=getLanguages(),canEdit=!!game.user?.isGM,raw=this._selectedPreset(),p=raw?localizeTree(raw,editLang):null,lock=canEdit?"":"disabled";
    const rows=Object.values(this._presets).map(x=>{const l=localizeTree(x);return `<button type="button" class="sd-ea-preset ${x.id===this._selected?"is-active":""}" data-preset="${esc(x.id)}"><img src="${esc(x.icon)}" alt=""><span><strong>${esc(l.name)}</strong><small>${x.changes.length} change${x.changes.length===1?"":"s"}</small></span><i class="fas fa-chevron-right"></i></button>`}).join("");
    const changes=p?.changes?.map((c,i)=>`<div class="sd-ea-change" data-index="${i}"><label><span>Attribute key</span><input data-change="key" value="${esc(c.key)}" placeholder="system.attributes.hp.value" ${lock}></label><label><span>Mode</span><select data-change="mode" ${lock}>${MODES.map(m=>`<option value="${m.value}" ${Number(c.mode)===m.value?"selected":""}>${m.label}</option>`).join("")}</select></label><label><span>Value</span><input data-change="value" value="${esc(c.value)}" placeholder="Value or formula" ${lock}></label><label class="sd-ea-priority"><span>Priority</span><input type="number" data-change="priority" value="${Number(c.priority??20)}" ${lock}></label><button type="button" class="sd-ea-icon-btn danger" data-action="removeChange" title="Remove change" ${lock}><i class="fas fa-trash"></i></button></div>`).join("")||`<div class="sd-ea-empty-small"><i class="fas fa-code-branch"></i><span>No changes yet.</span></div>`;
    const editor=p?`<div class="sd-ea-editor-head"><div><span class="sd-ea-eyebrow">Effect preset</span><h2>${esc(p.name||"New Effect")}</h2></div><label class="sd-ea-language"><span>Editing language</span><select data-action="editLanguage">${langs.map(l=>`<option value="${l.id}" ${l.id===editLang?"selected":""}>${esc(l.name)}</option>`).join("")}</select><small>Base stores source text</small></label></div><div class="sd-ea-scroll"><section class="sd-ea-card"><div class="sd-ea-fields two"><label><span>Name</span><input name="name" value="${esc(p.name)}" ${canEdit?"":"readonly"}></label><label><span>Icon path</span><input name="icon" value="${esc(raw.icon)}" ${canEdit?"":"readonly"}></label></div><label class="sd-ea-description"><span>Description</span><textarea name="description" rows="4" ${canEdit?"":"readonly"}>${esc(p.description)}</textarea></label><div class="sd-ea-fields duration"><label><span>Rounds</span><input type="number" min="0" name="rounds" value="${raw.duration.rounds}" ${lock}></label><label><span>Seconds</span><input type="number" min="0" name="seconds" value="${raw.duration.seconds}" ${lock}></label><label class="sd-ea-toggle"><input type="checkbox" name="disabled" ${raw.disabled?"checked":""} ${lock}><span>Start disabled</span></label><label class="sd-ea-toggle"><input type="checkbox" name="transfer" ${raw.transfer?"checked":""} ${lock}><span>Transfer to actor</span></label></div></section><section class="sd-ea-card sd-ea-changes-card"><header><div><span class="sd-ea-eyebrow">Active Effect data</span><h3>Changes</h3></div><button type="button" class="sd-ea-add-change" data-action="addChange" ${lock}><i class="fas fa-plus"></i> Add change</button></header><div class="sd-ea-changes">${changes}</div></section></div><footer class="sd-ea-footer"><div class="sd-ea-footer-left"><button type="button" data-action="duplicate" ${lock}><i class="fas fa-copy"></i> Duplicate</button><button type="button" class="danger" data-action="delete" ${lock}><i class="fas fa-trash"></i> Delete</button></div><div class="sd-ea-footer-right"><button type="button" data-action="save" ${lock}><i class="fas fa-floppy-disk"></i> Save preset</button><button type="button" class="primary" data-action="apply"><i class="fas fa-wand-magic-sparkles"></i> Apply to selected</button></div></footer>`:`<div class="sd-ea-empty"><i class="fas fa-wand-magic-sparkles"></i><h2>No effect selected</h2><p>Select a preset on the left or create a new one.</p></div>`;
    return `<div class="sd-ea-root"><aside class="sd-ea-sidebar"><header><div><i class="fas fa-sparkles"></i><span><strong>Effect presets</strong><small>Create and reuse effects</small></span></div><button type="button" class="sd-ea-new" data-action="new" title="New effect" ${lock}><i class="fas fa-plus"></i><span>New effect</span></button></header><nav class="sd-ea-list">${rows||'<div class="sd-ea-list-empty"><i class="fas fa-layer-group"></i><span>No presets</span></div>'}</nav></aside><main class="sd-ea-main">${editor}</main></div>`;
  }
  _replaceHTML(html,content){content.innerHTML=html;content.style.padding="0";}
  _collect(){const p=this._selectedPreset();if(!p||!this.element)return p;const lang=translationEditLanguage();const name=this.element.querySelector('[name="name"]')?.value??p.name;const description=this.element.querySelector('[name="description"]')?.value??p.description;setLocalizedField(p,"name",name,lang);setLocalizedField(p,"description",description,lang);p.icon=this.element.querySelector('[name="icon"]')?.value??p.icon;p.disabled=!!this.element.querySelector('[name="disabled"]')?.checked;p.transfer=!!this.element.querySelector('[name="transfer"]')?.checked;p.duration={rounds:Number(this.element.querySelector('[name="rounds"]')?.value||0),seconds:Number(this.element.querySelector('[name="seconds"]')?.value||0)};p.changes=[...this.element.querySelectorAll('.sd-ea-change')].map(r=>({key:r.querySelector('[data-change="key"]')?.value||"",mode:Number(r.querySelector('[data-change="mode"]')?.value??2),value:r.querySelector('[data-change="value"]')?.value||"",priority:Number(r.querySelector('[data-change="priority"]')?.value??20)}));return p;}
  _onRender(){
    super._onRender?.();
    const root=this.element;root?.querySelectorAll('[data-preset]').forEach(b=>b.addEventListener('click',()=>{this._collect();this._selected=b.dataset.preset;this.render();}));
    root?.querySelector('[data-action="editLanguage"]')?.addEventListener('change',async e=>{this._collect();await setTranslationEditLanguage(e.target.value);this.render();});
    root?.querySelector('[data-action="new"]')?.addEventListener('click',()=>{const p=normalizePreset();this._presets[p.id]=p;this._selected=p.id;this.render();});
    root?.querySelector('[data-action="addChange"]')?.addEventListener('click',async()=>{const p=this._collect();p.changes.push({key:"",mode:2,value:"",priority:20});await this.render();this.element?.querySelector('.sd-ea-change:last-child [data-change="key"]')?.focus();});
    root?.querySelectorAll('[data-action="removeChange"]').forEach(b=>b.addEventListener('click',()=>{const p=this._collect();p.changes.splice(Number(b.closest('.sd-ea-change').dataset.index),1);this.render();}));
    root?.querySelector('[data-action="duplicate"]')?.addEventListener('click',()=>{const src=this._collect();const p=normalizePreset({...clone(src),id:foundry.utils.randomID(10),name:`${src.name} Copy`});this._presets[p.id]=p;this._selected=p.id;this.render();});
    root?.querySelector('[data-action="delete"]')?.addEventListener('click',async()=>{if(!this._selected)return;const ok=await DialogV2.confirm({window:{title:"Delete effect preset"},content:"<p>Delete selected preset?</p>"}).catch(()=>false);if(!ok)return;delete this._presets[this._selected];this._selected=Object.keys(this._presets)[0]||null;await savePresetMap(this._presets);this.render();});
    root?.querySelector('[data-action="save"]')?.addEventListener('click',async()=>{const p=this._collect();p.changes=p.changes.filter(c=>c.key.trim());await savePresetMap(this._presets);ui.notifications?.info?.("Effect preset saved.");this.render();});
    root?.querySelector('[data-action="apply"]')?.addEventListener('click',()=>this._apply());
  }
  async _apply(){const p=this._collect();if(!p)return;const tokens=[...(canvas?.tokens?.controlled??[])];if(!tokens.length)return ui.notifications?.warn?.("Select at least one token.");const data={name:localizeTree(p).name,img:p.icon,icon:p.icon,disabled:p.disabled,transfer:p.transfer,duration:clone(p.duration),changes:clone(p.changes.filter(c=>c.key.trim())),flags:{sd:{effectPresetId:p.id,effectPresetI18n:clone(p.i18n)}}};let applied=0;for(const token of tokens){const actor=token.actor;if(!actor)continue;if(!game.user.isGM&&!actor.isOwner)continue;await actor.createEmbeddedDocuments("ActiveEffect",[data]);applied++;}if(!applied)return ui.notifications?.warn?.("No selected token can receive this effect.");ui.notifications?.info?.(`Applied “${data.name}” to ${applied} token${applied===1?"":"s"}.`);}
}
