const DEFAULT_LANGUAGES = [
  { id:"base", name:"Base", enabled:true, fallback:"" },
  { id:"en", name:"English", enabled:true, fallback:"base" },
  { id:"ru", name:"Русский", enabled:true, fallback:"base" }
];

export const TRANSLATABLE_KEYS = new Set([
  "label","title","name","description","placeholder","hint","tooltip","flavor","text",
  "speaker","buttonLabel","confirmLabel","cancelLabel","valueLabel","emptyLabel","onLabel","offLabel"
]);

const clone = value => {
  try { return foundry.utils.deepClone(value); } catch { return structuredClone(value); }
};
const safeId = value => String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g,"-").replace(/^-+|-+$/g,"");

export function normalizeLanguages(value) {
  const input = Array.isArray(value) ? value : DEFAULT_LANGUAGES;
  const seen = new Set();
  const out = [];
  for (const row of input) {
    const id = safeId(row?.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name:String(row?.name || id), enabled:row?.enabled !== false, fallback:safeId(row?.fallback), primary:!!row?.primary });
  }
  if (!seen.has("base")) out.unshift(clone(DEFAULT_LANGUAGES[0]));
  let primarySeen=false;
  for(const row of out){ if(row.primary&&!primarySeen) primarySeen=true; else row.primary=false; }
  if(!primarySeen)(out.find(l=>l.id==="base")??out[0]).primary=true;
  return out;
}

export function registerLocalizationSettings() {
  game.settings.register("sd","localizationLanguages",{
    name:"Languages",scope:"world",config:false,type:Array,default:clone(DEFAULT_LANGUAGES),
    onChange:()=>rerenderLocalizedWindows()
  });
  game.settings.register("sd","localizationLanguage",{
    name:"Language",scope:"client",config:false,type:String,default:"base",
    onChange:()=>rerenderLocalizedWindows()
  });
  game.settings.register("sd","translationEditLanguage",{
    name:"Translation editing language",scope:"client",config:false,type:String,default:"base"
  });
}

export function getLanguages({ enabledOnly=false }={}) {
  let rows=DEFAULT_LANGUAGES;
  try { rows=game.settings.get("sd","localizationLanguages"); } catch {}
  const out=normalizeLanguages(rows);
  return enabledOnly ? out.filter(l=>l.enabled) : out;
}
export function currentLanguage() {
  let id="base";
  try { id=safeId(game.settings.get("sd","localizationLanguage")) || "base"; } catch {}
  const enabled=getLanguages({enabledOnly:true});
  return enabled.some(l=>l.id===id) ? id : (enabled.find(l=>l.primary)?.id||"base");
}
export function translationEditLanguage() {
  let id="base";
  try { id=safeId(game.settings.get("sd","translationEditLanguage")) || "base"; } catch {}
  return getLanguages().some(l=>l.id===id) ? id : "base";
}
export async function setCurrentLanguage(id) { return game.settings.set("sd","localizationLanguage",safeId(id)||"base"); }
export async function setTranslationEditLanguage(id) { return game.settings.set("sd","translationEditLanguage",safeId(id)||"base"); }
export async function saveLanguages(rows) { return game.settings.set("sd","localizationLanguages",normalizeLanguages(rows)); }

function languageChain(lang=currentLanguage()) {
  const map=new Map(getLanguages().map(l=>[l.id,l]));
  const out=[]; const seen=new Set(); let id=safeId(lang)||"base";
  while(id&&!seen.has(id)){seen.add(id);out.push(id);id=map.get(id)?.fallback||"";}
  if(!seen.has("base"))out.push("base");
  return out;
}

export function localizedField(object,key,lang=currentLanguage(),fallback=undefined) {
  if (!object || typeof object!=="object") return fallback;
  for (const id of languageChain(lang)) {
    if (id==="base") break;
    const v=object.i18n?.[id]?.[key];
    if (v!==undefined&&v!==null&&String(v)!=="") return v;
  }
  const base=object[key];
  return base===undefined ? fallback : base;
}

export function setLocalizedField(object,key,value,lang=translationEditLanguage()) {
  if (!object || typeof object!=="object") return object;
  if (!lang || lang==="base") object[key]=value;
  else {
    object.i18n ??={}; object.i18n[lang]??={};
    if (value===undefined||value===null||value==="") delete object.i18n[lang][key];
    else object.i18n[lang][key]=value;
  }
  return object;
}

export function localizeTree(value,lang=currentLanguage(),seen=new WeakMap()) {
  if (value==null||typeof value!=="object") return value;
  if (seen.has(value)) return seen.get(value);
  const out=Array.isArray(value)?[]:{}; seen.set(value,out);
  for (const [key,val] of Object.entries(value)) {
    if (key==="i18n") { out[key]=clone(val); continue; }
    out[key]=localizeTree(val,lang,seen);
  }
  if (!Array.isArray(value)) {
    for (const key of TRANSLATABLE_KEYS) if (key in value) out[key]=localizedField(value,key,lang,value[key]);
    if (Array.isArray(value.choices)) {
      out.choices=value.choices.map((choice,index)=>{
        if(choice&&typeof choice==="object")return localizeTree(choice,lang,seen);
        const translated=value.i18n?.[lang]?.choices?.[index];
        return translated??choice;
      });
    }
  }
  return out;
}

export function applyTranslationChanges(target,changes,lang=translationEditLanguage()) {
  if (!target||typeof target!=="object") return target;
  for (const [key,value] of Object.entries(changes??{})) {
    if (TRANSLATABLE_KEYS.has(key)) setLocalizedField(target,key,value,lang);
    else if (lang==="base") target[key]=value;
  }
  return target;
}

export function languageOptions({enabledOnly=false,selected=currentLanguage()}={}) {
  return getLanguages({enabledOnly}).map(l=>({ ...l, selected:l.id===selected }));
}

export function rerenderLocalizedWindows() {
  for (const app of Object.values(ui?.windows ?? foundry.applications?.instances ?? {})) {
    try { app?.render?.(); } catch {}
  }
  try { Hooks.callAll("sdLanguageChanged",currentLanguage()); } catch {}
}

export function exportLocalizationBundle() {
  return { schema:1, languages:getLanguages(), exportedAt:new Date().toISOString() };
}
