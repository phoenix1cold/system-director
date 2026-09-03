const TYPES = new Set(["number","integer","text","boolean","color","array","object"]);
const SCOPES = new Set(["actor","item","both"]);

function clone(value){
  try { return foundry.utils.deepClone(value); } catch { return structuredClone(value); }
}

export function normalizeValueId(value, fallback="value") {
  const id=String(value??"").trim().toLowerCase().replace(/\s+/g,"_").replace(/[^\p{L}\p{N}_-]/gu,"").slice(0,64);
  return id || fallback;
}

export function normalizeValueDefinition(source={}, index=0) {
  const type=TYPES.has(String(source.type))?String(source.type):"number";
  const scope=SCOPES.has(String(source.scope))?String(source.scope):"both";
  const id=normalizeValueId(source.id??source.key,`value_${index+1}`);
  let initial=source.initial??source.default??(type==="boolean"?false:type==="number"||type==="integer"?0:"");
  if(type==="number"||type==="integer") initial=Number(initial)||0;
  if(type==="integer") initial=Math.trunc(initial);
  if(type==="boolean") initial=initial===true||initial===1||initial==="true"||initial==="1";
  return {id,name:String(source.name??source.label??id),type,scope,initial,min:source.min??null,max:source.max??null,legacyPath:String(source.legacyPath??"")};
}

export function migrateLegacyValueDefinitions(settings={}) {
  const out=[];
  const add=(id,name,type,initial,legacyPath,scope="actor")=>out.push(normalizeValueDefinition({id,name,type,initial,legacyPath,scope},out.length));
  for(const [key,label] of Object.entries(settings.attributes??{})){
    if(settings.attributesEnabled?.[key]===false)continue;
    add(key,label||key,"number",settings.attributesInitial?.[key]??10,`system.attributes.${key}.value`);
  }
  for(const [key,res] of Object.entries(settings.resources??{})){
    if(!res||res.enabled===false)continue;
    add(key,res.label||key,"number",res.initialValue??0,`system.resources.${key}.value`);
    add(`${key}_max`,`${res.label||key} Max`,"number",res.initialMax??0,`system.resources.${key}.max`);
    add(`${key}_min`,`${res.label||key} Min`,"number",res.initialMin??0,`system.resources.${key}.min`);
  }
  for(const [section,list] of Object.entries(settings.calculations??{})) for(const entry of (list??[])){
    if(!entry?.key)continue;
    add(`${section}_${entry.key}`,entry.label||entry.key,"number",entry.default??0,`system.${section}.${entry.key}`);
  }
  for(const c of (settings.currencies??[])) if(c?.key) add(`currency_${c.key}`,c.label||c.key,"number",0,`system.currency.${c.key}`,"both");
  const hadLegacy=out.length>0;
  if(hadLegacy){
    add("level","Level","integer",1,"system.advancement.level");
    add("xp","Experience","number",0,"system.advancement.xp.value");
    add("xp_max","Experience Max","number",300,"system.advancement.xp.max");
  }
  return out;
}

export function normalizeValueDatabase(value, legacySettings=null) {
  const raw=Array.isArray(value)?value:Array.isArray(value?.values)?value.values:[];
  const src=raw.length?raw:(legacySettings?migrateLegacyValueDefinitions(legacySettings):[]);
  const used=new Set();
  return src.map((entry,index)=>{
    const def=normalizeValueDefinition(entry,index); let id=def.id,n=2;
    while(used.has(id))id=`${def.id}_${n++}`;
    used.add(id); return {...def,id};
  });
}

export function getValueDefinitions(settings=null) {
  // Callers may pass a document scope directly ("actor", "item" or
  // "both").  Older helpers treated that string as the settings object,
  // which made Progression render an empty variable list.
  const scope=typeof settings==="string"&&SCOPES.has(settings)?settings:"";
  let cfg=settings;
  if(scope)cfg=null;
  if(!cfg){try{cfg=game.settings.get("sd","systemSettings")??{};}catch{cfg={};}}
  const definitions=normalizeValueDatabase(cfg?.database,cfg);
  return scope&&scope!=="both"
    ? definitions.filter(def=>def.scope==="both"||def.scope===scope)
    : definitions;
}

export function getValueDefinition(id, settings=null){return getValueDefinitions(settings).find(v=>v.id===String(id??""))??null;}
export function valueSelectOptions(_node=null, graph=null){
  const defs=getValueDefinitions();
  const scope=graph?.doc?.documentName==="Item"?"item":graph?.doc?.documentName==="Actor"?"actor":"";
  return [{value:"",label:"Select value…"},...defs.filter(d=>!scope||d.scope==="both"||d.scope===scope).map(d=>({value:d.id,label:`${d.name} · ${d.type} [${d.id}]`}))];
}
export function valueStoragePath(id){return `system.values.${normalizeValueId(id)}`;}

export function coerceDatabaseValue(value, definition){
  const type=definition?.type??"text";
  if(type==="number")return Number(value)||0;
  if(type==="integer")return Math.trunc(Number(value)||0);
  if(type==="boolean")return value===true||value===1||["true","1","yes","on"].includes(String(value??"").toLowerCase());
  if(type==="array"){
    if(Array.isArray(value))return value;
    try{const parsed=JSON.parse(String(value??"[]"));return Array.isArray(parsed)?parsed:[];}catch{return String(value??"").split(",").map(x=>x.trim()).filter(Boolean);}
  }
  if(type==="object"){
    if(value&&typeof value==="object"&&!Array.isArray(value))return value;
    try{const parsed=JSON.parse(String(value??"{}"));return parsed&&typeof parsed==="object"&&!Array.isArray(parsed)?parsed:{};}catch{return {};}
  }
  return String(value??"");
}

export function readDatabaseValue(doc,id,{fallback=true}={}){
  const def=getValueDefinition(id); if(!def)return undefined;
  const direct=foundry.utils.getProperty(doc,valueStoragePath(def.id));
  if(direct!==undefined)return direct;
  if(fallback&&def.legacyPath){const legacy=foundry.utils.getProperty(doc,def.legacyPath);if(legacy!==undefined)return legacy;}
  return clone(def.initial);
}

export async function writeDatabaseValue(doc,id,value){
  const def=getValueDefinition(id); if(!doc||!def)return false;
  await doc.update({[valueStoragePath(def.id)]:coerceDatabaseValue(value,def)});
  return true;
}

export function buildInitialDatabaseValues(settings=null,scope="actor"){
  return Object.fromEntries(getValueDefinitions(settings).filter(d=>d.scope==="both"||d.scope===scope).map(d=>[d.id,clone(d.initial)]));
}

export function variableChangeToFoundry(change={}){
  const variableId=String(change.variableId??change.id??"");
  return {key:valueStoragePath(variableId),type:String(change.type??change.mode??"add"),value:String(change.value??"0"),priority:Number(change.priority??20)};
}

export function variableLabelForChange(change={}){
  const id=String(change.variableId??"")||String(change.key??"").replace(/^system\.values\./,"");
  return getValueDefinition(id)?.name??id;
}


export function variableIdForLegacyPath(path,settings=null){
  return getValueDefinitions(settings).find(v=>v.legacyPath===String(path??"")||valueStoragePath(v.id)===String(path??""))?.id??"";
}

export function fieldChangeStoragePath(change,settings=null){
  const id=String(change?.variableId??"")||variableIdForLegacyPath(change?.path,settings);
  return id?valueStoragePath(id):String(change?.path??"");
}

export async function migrateDocumentDatabaseValues(doc){
  if(!doc?.update)return false;
  const patch={};
  for(const def of getValueDefinitions()){
    if(def.scope!=="both"&&def.scope!==(doc.documentName==="Item"?"item":"actor"))continue;
    const target=valueStoragePath(def.id);
    if(foundry.utils.getProperty(doc,target)!==undefined)continue;
    const legacy=def.legacyPath?foundry.utils.getProperty(doc,def.legacyPath):undefined;
    patch[target]=coerceDatabaseValue(legacy!==undefined?legacy:def.initial,def);
  }
  if(!Object.keys(patch).length)return false;
  await doc.update(patch,{sdSkipEventBus:true}); return true;
}

const VARIABLE_REFERENCE_KEYS=new Set([
  "variableId","valueId","itemVariableId","actorVariableId",
  "path","pathValue","pathMax","maxPath","valuePath","currencyPath","flagPath"
]);

/** Replace Database IDs in graphs, widgets, effects and other public models. */
export function remapVariableIdsInObject(source, renameMap={}) {
  const map=renameMap instanceof Map?renameMap:new Map(Object.entries(renameMap??{}));
  const walk=(value,key="")=>{
    if(Array.isArray(value))return value.map(entry=>walk(entry,key));
    if(!value||typeof value!=="object"){
      if(typeof value!=="string")return value;
      if(VARIABLE_REFERENCE_KEYS.has(key)&&map.has(value))return map.get(value);
      const active=value.match(/^system\.values\.([^.]+)$/);
      if(active&&map.has(active[1]))return `system.values.${map.get(active[1])}`;
      return value;
    }
    const out={};
    for(const [childKey,childValue] of Object.entries(value)){
      const nextKey=key==="values"&&map.has(childKey)?map.get(childKey):childKey;
      out[nextKey]=walk(childValue,childKey);
    }
    return out;
  };
  return walk(source,"");
}

/** Migrate existing Actor/Item values and every known variable reference after a rename. */
export async function migrateVariableIds(renameMap={}) {
  const map=renameMap instanceof Map?renameMap:new Map(Object.entries(renameMap??{}));
  for(const [oldId,newId] of [...map])if(!oldId||!newId||oldId===newId)map.delete(oldId);
  if(!map.size)return {documents:0,effects:0};
  let documents=0,effects=0;
  const docs=[...(game.actors?.contents??game.actors??[]),...(game.items?.contents??game.items??[])];
  for(const actor of (game.actors?.contents??game.actors??[]))docs.push(...(actor.items?.contents??actor.items??[]));
  const seen=new Set();
  for(const doc of docs){
    if(!doc?.update||seen.has(doc.uuid??doc.id))continue;seen.add(doc.uuid??doc.id);
    const raw=doc.system?.toObject?.()??doc.system??{};
    const next=remapVariableIdsInObject(raw,map);
    const patch={};
    for(const key of Object.keys(next)){
      if(JSON.stringify(raw[key])!==JSON.stringify(next[key]))patch[`system.${key}`]=next[key];
    }
    if(Object.keys(patch).length){await doc.update(patch,{sdSkipEventBus:true});documents++;}
    for(const effect of (doc.effects?.contents??doc.effects??[])){
      const changes=remapVariableIdsInObject(effect.changes??[],map);
      if(JSON.stringify(changes)!==JSON.stringify(effect.changes??[])){await effect.update({changes},{sdSkipEventBus:true});effects++;}
    }
  }
  try{
    const presets=game.settings.get("sd","effectPresets")??{};
    const next=remapVariableIdsInObject(presets,map);
    if(JSON.stringify(next)!==JSON.stringify(presets))await game.settings.set("sd","effectPresets",next);
  }catch{}
  return {documents,effects};
}

import { dialogElement, dialogText, dialogValue } from "./foundry-compat.mjs";

/** Write several typed Database variables in one settings update. */
export async function createDatabaseVariables(drafts=[], {seedValues=true, notify=false}={}) {
  const list=(Array.isArray(drafts)?drafts:[drafts]).filter(Boolean);
  if(!list.length)return [];
  let settings={};
  try{settings=clone(game.settings.get("sd","systemSettings")??{});}catch{settings={};}
  const definitions=normalizeValueDatabase(settings.database,settings);
  const created=[];
  for(const draft of list){
    const rawName=String(draft?.name??"").trim();
    if(!rawName)continue;
    const name=/^[0-9]+$/.test(rawName)?`Value ${rawName}`:rawName;
    const base=normalizeValueId(name,"value");let id=base,suffix=2;
    while(definitions.some(def=>def.id===id)||created.some(def=>def.id===id))id=`${base}_${suffix++}`;
    const temp=normalizeValueDefinition({id,name,type:draft.type,scope:draft.scope,initial:draft.initial},definitions.length+created.length);
    let parsed=draft.initial;
    if(temp.type==="array"||temp.type==="object"){
      try{parsed=JSON.parse(String(draft.initial??(temp.type==="array"?"[]":"{}")));}
      catch{parsed=temp.type==="array"?[]:{};}
    }
    created.push({...temp,initial:coerceDatabaseValue(parsed,temp),legacyPath:""});
  }
  if(!created.length)return [];
  settings.database=[...definitions,...created];
  await game.settings.set("sd","systemSettings",settings);

  if(seedValues){
    const docs=[...(game.actors?.contents??game.actors??[]),...(game.items?.contents??game.items??[])];
    for(const actor of (game.actors?.contents??game.actors??[]))docs.push(...(actor.items?.contents??actor.items??[]));
    const seen=new Set();
    for(const doc of docs){
      if(!doc?.update||seen.has(doc.uuid??doc.id))continue;seen.add(doc.uuid??doc.id);
      const docScope=doc.documentName==="Item"?"item":"actor";
      const patch={};
      for(const definition of created){
        if(definition.scope!=="both"&&definition.scope!==docScope)continue;
        if(foundry.utils.getProperty(doc,valueStoragePath(definition.id))!==undefined)continue;
        patch[valueStoragePath(definition.id)]=clone(definition.initial);
      }
      if(Object.keys(patch).length)await doc.update(patch,{sdSkipEventBus:true});
    }
  }
  if(notify)ui.notifications?.info?.(created.length===1
    ? `Database variable “${created[0].name}” created.`
    : `${created.length} Database variables created.`);
  return created;
}

/** Update the declared initial value of existing variables. */
export async function updateDatabaseInitialValues(values={}) {
  let settings={};
  try{settings=clone(game.settings.get("sd","systemSettings")??{});}catch{settings={};}
  const definitions=normalizeValueDatabase(settings.database,settings);
  let changed=false;
  settings.database=definitions.map(def=>{
    if(!Object.prototype.hasOwnProperty.call(values,def.id))return def;
    const next=coerceDatabaseValue(values[def.id],def);
    if(JSON.stringify(next)===JSON.stringify(def.initial))return def;
    changed=true;return {...def,initial:next};
  });
  if(changed)await game.settings.set("sd","systemSettings",settings);
  return changed;
}

/** Delete one variable definition from the world Database. */
export async function removeDatabaseVariable(id) {
  const target=normalizeValueId(id,"");
  if(!target)return false;
  let settings={};
  try{settings=clone(game.settings.get("sd","systemSettings")??{});}catch{settings={};}
  const definitions=normalizeValueDatabase(settings.database,settings);
  const next=definitions.filter(def=>def.id!==target);
  if(next.length===definitions.length)return false;
  settings.database=next;
  await game.settings.set("sd","systemSettings",settings);
  return true;
}

/** Create a typed global Database variable and seed every matching document. */
export async function createDatabaseVariable({name="",type="number",scope="both",initial=undefined,prompt=true}={}) {
  const escape=value=>String(value??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  let draft={name:String(name??""),type:TYPES.has(String(type))?String(type):"number",scope:SCOPES.has(String(scope))?String(scope):"both",initial};
  if(prompt){
    const result=await foundry.applications.api.DialogV2.prompt({
      window:{title:"Create Database Variable",resizable:true},position:{width:500,height:"auto"},
      content:`<div class="sd-db-variable-create">
        <div class="sd-db-create-hero"><i class="fas fa-cube"></i><div><b>New Database Variable</b><small>Available immediately in every matching Actor/Item sheet and Blueprint.</small></div></div>
        <label><span>Name</span><input name="name" value="${escape(draft.name)}" placeholder="Health" autofocus required></label>
        <div class="sd-db-create-grid"><label><span>Type</span><select name="type">${[...TYPES].map(value=>`<option value="${value}" ${draft.type===value?"selected":""}>${value}</option>`).join("")}</select></label><label><span>Scope</span><select name="scope">${[...SCOPES].map(value=>`<option value="${value}" ${draft.scope===value?"selected":""}>${value}</option>`).join("")}</select></label></div>
        <label><span>Initial value</span><input name="initial" value="${escape(draft.initial??(draft.type==="boolean"?"false":draft.type==="array"?"[]":draft.type==="object"?"{}":draft.type==="color"?"#7aa2ff":draft.type==="text"?"":0))}"></label>
        <div class="sd-db-create-id"><i class="fas fa-fingerprint"></i> Variable ID is generated from the name.</div>
      </div>`,
      ok:{label:"Create Variable",icon:"fas fa-plus",callback:(event,button)=>({name:dialogText(event,button,"name"),type:dialogValue(event,button,"type","number"),scope:dialogValue(event,button,"scope","both"),initial:dialogValue(event,button,"initial","")})}
    }).catch(()=>null);
    if(!result)return null;
    draft=result;
  }
  if(!String(draft.name??"").trim()){ui.notifications?.warn?.("Variable name is required.");return null;}
  const [definition]=await createDatabaseVariables([draft],{notify:true});
  return definition??null;
}

/** Per-document Database window used by Actor and Item sheets. */
export async function openDocumentValueDatabase(doc) {
  const {ValueDatabaseApp}=await import("./value-database-app.mjs");
  return ValueDatabaseApp.open({doc});
}

export const VALUE_DATABASE_TYPES=[...TYPES];
export const VALUE_DATABASE_SCOPES=[...SCOPES];
