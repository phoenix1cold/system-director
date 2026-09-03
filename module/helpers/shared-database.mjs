const applicationApi = globalThis.foundry?.applications?.api ?? {};
const ApplicationV2 = applicationApi.ApplicationV2 ?? class ApplicationV2Fallback {};
const HandlebarsApplicationMixin = applicationApi.HandlebarsApplicationMixin ?? (Base => Base);

export const DATABASE_TYPES = Object.freeze([
  { id:"any",          label:"Any / JSON",       pin:"value.any" },
  { id:"number",       label:"Number",           pin:"value.number" },
  { id:"text",         label:"Text",             pin:"value.string" },
  { id:"boolean",      label:"Boolean",          pin:"value.bool" },
  { id:"array",        label:"Array",            pin:"value.array" },
  { id:"object",       label:"Object",           pin:"value.object" },
  { id:"actor",        label:"Actor",            pin:"value.actor" },
  { id:"item",         label:"Item",             pin:"value.item" },
  { id:"uuid",         label:"UUID",             pin:"value.uuid" },
  { id:"token_pool",   label:"Token Pool",       pin:"value.token_pool" },
  { id:"roll_result",  label:"Roll Result",      pin:"value.roll_result" },
  { id:"effect",       label:"Effect",           pin:"value.effect" },
  { id:"aoe_template",  label:"AOE Region preset",   pin:"value.aoe_template" },
  { id:"aoe_templates", label:"AOE Region presets[]", pin:"value.aoe_templates" },
  { id:"dialog_result", label:"Dialog Result",        pin:"value.dialog_result" },
  { id:"region",        label:"Placed Region",        pin:"value.aoe_template" },
  { id:"date",         label:"Date / Time",      pin:"value.string" }
]);

const TYPE_IDS = new Set(DATABASE_TYPES.map(t => t.id));
const EMPTY_CONFIG = Object.freeze({ version:1, databases:[] });

function clone(value) {
  if (value == null) return value;
  try { return foundry.utils.deepClone?.(value) ?? structuredClone(value); }
  catch { try { return JSON.parse(JSON.stringify(value)); } catch { return value; } }
}

export function databaseSafeId(value, prefix="entry") {
  const clean = String(value ?? "").trim().replace(/\s+/g,"_").replace(/[^A-Za-z0-9_-]/g,"_").replace(/^_+|_+$/g,"");
  return clean || `${prefix}_${foundry.utils.randomID?.(8) ?? Math.random().toString(36).slice(2,10)}`;
}

export function databaseTypePin(type) {
  return DATABASE_TYPES.find(t => t.id === type)?.pin ?? "value.any";
}

export function databaseTypeOptions() {
  return DATABASE_TYPES.map(({id,label}) => ({value:id,label}));
}

function normalizeRecord(record={}, index=0) {
  const id = databaseSafeId(record.id ?? record.key ?? `record_${index+1}`, "record");
  const type = TYPE_IDS.has(String(record.type)) ? String(record.type) : "any";
  return {
    id,
    name:String(record.name ?? record.label ?? id),
    type,
    default:clone(record.default ?? null),
    description:String(record.description ?? "")
  };
}

function normalizeDatabase(database={}, index=0) {
  const id = databaseSafeId(database.id ?? database.key ?? `database_${index+1}`, "database");
  const storage = database.storage === "world" ? "world" : "document";
  const kind = ["variables","enum","dataTable"].includes(database.kind) ? database.kind : "variables";
  const used = new Set();
  const records=[];
  for (const [ri,raw] of (Array.isArray(database.records)?database.records:[]).entries()) {
    const rec=normalizeRecord(raw,ri);
    let rid=rec.id,n=2; while(used.has(rid)) rid=`${rec.id}_${n++}`; rec.id=rid;used.add(rid);records.push(rec);
  }
  return {id,name:String(database.name ?? id),kind,storage,description:String(database.description ?? ""),records};
}

export function normalizeDatabaseConfig(raw) {
  const source = raw && typeof raw === "object" ? raw : EMPTY_CONFIG;
  const used = new Set();
  const databases=[];
  for (const [i,value] of (Array.isArray(source.databases)?source.databases:[]).entries()) {
    const db=normalizeDatabase(value,i);
    let id=db.id,n=2;while(used.has(id))id=`${db.id}_${n++}`;db.id=id;used.add(id);databases.push(db);
  }
  return {version:1,databases};
}

export function registerSharedDatabaseSettings() {
  game.settings.register("sd","sharedDatabases",{
    name:"Shared Databases",scope:"world",config:false,type:Object,default:{version:1,databases:[]}
  });
  game.settings.register("sd","sharedDatabaseWorldValues",{
    name:"Shared Database World Values",scope:"world",config:false,type:Object,default:{}
  });
}

export function getSharedDatabaseConfig() {
  try { return normalizeDatabaseConfig(game.settings.get("sd","sharedDatabases")); }
  catch { return normalizeDatabaseConfig(EMPTY_CONFIG); }
}

export async function saveSharedDatabaseConfig(config) {
  if (!game.user?.isGM) throw new Error("Only a GM can edit the shared database schema.");
  const normalized=normalizeDatabaseConfig(config);
  await game.settings.set("sd","sharedDatabases",normalized);
  return normalized;
}

export function getDatabase(databaseId) {
  return getSharedDatabaseConfig().databases.find(db=>db.id===String(databaseId ?? "")) ?? null;
}

export function getDatabaseRecord(databaseId,recordId) {
  return getDatabase(databaseId)?.records?.find(record=>record.id===String(recordId ?? "")) ?? null;
}

export function getEnumEntries(databaseId){const db=getDatabase(databaseId);return db?.kind==="enum"?(db.records??[]):[];}
export function getDataTableRows(databaseId){const db=getDatabase(databaseId);return db?.kind==="dataTable"?(db.records??[]):[];}
export function readDataAsset(databaseId,recordId,field=""){
  const record=getDatabaseRecord(databaseId,recordId);if(!record)return undefined;
  const value=clone(record.default);if(!field)return value;
  try{return foundry.utils.getProperty(value,String(field));}catch{return undefined;}
}

export function databaseSelectOptions(kind="") {
  const list=getSharedDatabaseConfig().databases.filter(db=>!kind||db.kind===kind).map(db=>({value:db.id,label:`${db.name} [${db.kind} · ${db.storage}]`}));
  return list.length?[{value:"",label:"Select database…"},...list]:[{value:"",label:"No databases — open Database settings"}];
}

export function databaseRecordSelectOptions(databaseId) {
  const db=getDatabase(databaseId);
  const list=(db?.records??[]).map(record=>({value:record.id,label:`${record.name} (${record.type})`}));
  return list.length?[{value:"",label:"Select record…"},...list]:[{value:"",label:db?"No records in this database":"Choose a database first"}];
}

function parseJson(value,fallback) {
  if (typeof value !== "string") return clone(value);
  const text=value.trim();
  if (!text) return clone(fallback);
  try { return JSON.parse(text); } catch { return clone(fallback); }
}

export function coerceDatabaseValue(value,type="any") {
  const t=TYPE_IDS.has(String(type))?String(type):"any";
  if (value?.documentName && ["actor","item","region","uuid"].includes(t)) return String(value.uuid ?? value.id ?? "");
  if (t==="number") { const n=Number(value); return Number.isFinite(n)?n:0; }
  if (t==="text") return value==null?"":String(value);
  if (t==="boolean") {
    if(typeof value==="boolean")return value;if(typeof value==="number")return value!==0;
    return ["1","true","yes","on"].includes(String(value??"").trim().toLowerCase());
  }
  if (t==="array" || t==="token_pool") {
    if(Array.isArray(value))return clone(value).map(v=>v?.uuid??v?.id??v);
    const parsed=parseJson(value,null);if(Array.isArray(parsed))return parsed.map(v=>v?.uuid??v?.id??v);
    return String(value??"").split(",").map(v=>v.trim()).filter(Boolean);
  }
  if (["object","roll_result","effect","aoe_template","aoe_templates","dialog_result"].includes(t)) {
    if(value&&typeof value==="object")return clone(value);
    const parsed=parseJson(value,{});return parsed&&typeof parsed==="object"?parsed:{};
  }
  if (["actor","item","uuid","region","date"].includes(t)) return value==null?"":String(value?.uuid??value?.id??value);
  if (t==="any") {
    if(value==null||typeof value!=="string")return clone(value);
    const text=value.trim();if(!text)return "";
    try{return JSON.parse(text);}catch{return value;}
  }
  return clone(value);
}

export function formatDatabaseValue(value,type="any") {
  if(value===undefined||value===null)return "";
  if(["object","array","token_pool","roll_result","effect","aoe_template","aoe_templates","dialog_result","any"].includes(type)&&typeof value==="object"){
    try{return JSON.stringify(value,null,2);}catch{return String(value);}
  }
  return String(value);
}

async function resolveDocumentRef(value) {
  if(!value)return null;
  if(value.documentName)return value;
  const raw=String(value);
  if(raw.startsWith("Actor."))return game.actors?.get?.(raw.split(".").at(-1))??(typeof fromUuid==="function"?fromUuid(raw):null);
  if(raw.startsWith("Item."))return game.items?.get?.(raw.split(".").at(-1))??(typeof fromUuid==="function"?fromUuid(raw):null);
  return game.actors?.get?.(raw)??game.items?.get?.(raw)??(typeof fromUuid==="function"?fromUuid(raw):null);
}

export async function resolveDatabaseOwner({databaseId,ownerMode="auto",owner=null,item=null,actor=null}={}) {
  const db=getDatabase(databaseId);
  if(!db)return {database:null,kind:"missing",document:null};
  if(db.storage==="world")return {database:db,kind:"world",document:null};
  let doc=owner?.documentName?owner:null;
  if(!doc&&owner)doc=await resolveDocumentRef(owner);
  if(!doc){
    if(ownerMode==="actor")doc=actor??item?.actor??null;
    else if(ownerMode==="item")doc=item??null;
    else doc=item??actor??null;
  }
  return {database:db,kind:doc?"document":"missing",document:doc};
}

async function hydrateValue(value,type) {
  if(!value)return value;
  if(type==="actor"||type==="item"||type==="region") {
    try{return await resolveDocumentRef(value)??value;}catch{return value;}
  }
  return clone(value);
}

export async function readDatabaseValue({databaseId,recordId,ownerMode="auto",owner=null,item=null,actor=null}={}) {
  const record=getDatabaseRecord(databaseId,recordId);
  if(!record)throw new Error(`Database record not found: ${databaseId}.${recordId}`);
  const resolved=await resolveDatabaseOwner({databaseId,ownerMode,owner,item,actor});
  let value;
  if(resolved.kind==="world"){
    const values=game.settings.get("sd","sharedDatabaseWorldValues")??{};
    value=foundry.utils.getProperty(values,`${databaseSafeId(databaseId)}.${databaseSafeId(recordId)}`);
  }else if(resolved.document){
    value=foundry.utils.getProperty(resolved.document,`flags.sd.databaseValues.${databaseSafeId(databaseId)}.${databaseSafeId(recordId)}`);
  }
  if(value===undefined)value=clone(record.default);
  return hydrateValue(value,record.type);
}

export async function writeDatabaseValue({databaseId,recordId,value,ownerMode="auto",owner=null,item=null,actor=null}={}) {
  const record=getDatabaseRecord(databaseId,recordId);
  if(!record)throw new Error(`Database record not found: ${databaseId}.${recordId}`);
  const stored=coerceDatabaseValue(value,record.type);
  const resolved=await resolveDatabaseOwner({databaseId,ownerMode,owner,item,actor});
  if(resolved.kind==="world"){
    if(!game.user?.isGM)throw new Error("Only a GM can write world database values.");
    const values=clone(game.settings.get("sd","sharedDatabaseWorldValues")??{});
    foundry.utils.setProperty(values,`${databaseSafeId(databaseId)}.${databaseSafeId(recordId)}`,stored);
    await game.settings.set("sd","sharedDatabaseWorldValues",values);
  }else if(resolved.document){
    if(!resolved.document.isOwner&&!game.user?.isGM)throw new Error("You do not own the database document.");
    await resolved.document.setFlag("sd",`databaseValues.${databaseSafeId(databaseId)}.${databaseSafeId(recordId)}`,stored);
  }else throw new Error("No Actor or Item is available for this document database.");
  return hydrateValue(stored,record.type);
}

export async function createDatabaseRecord({databaseId,recordId,name,type="any",defaultValue=null,initialValue,writeInitial=false,ownerMode="auto",owner=null,item=null,actor=null}={}) {
  if(!game.user?.isGM)throw new Error("Only a GM can create database records.");
  const config=getSharedDatabaseConfig();
  const db=config.databases.find(d=>d.id===databaseId);
  if(!db)throw new Error(`Database not found: ${databaseId}`);
  let id=databaseSafeId(recordId||name||"record","record");
  if(db.records.some(r=>r.id===id))throw new Error(`Record already exists: ${db.name}.${id}`);
  const record=normalizeRecord({id,name:name||id,type,default:coerceDatabaseValue(defaultValue,type)},db.records.length);
  db.records.push(record);
  await saveSharedDatabaseConfig(config);
  let value=clone(record.default);
  if(writeInitial){
    value=await writeDatabaseValue({databaseId,recordId:record.id,value:initialValue,ownerMode,owner,item,actor});
  }
  return {record,value};
}

export class SharedDatabaseApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options={}){super(options);this.contextDocument=options.document??null;}
  static DEFAULT_OPTIONS={
    id:"sd-shared-database",classes:["sd","shared-database"],
    window:{title:"Database",icon:"fa-solid fa-database",resizable:true},
    position:{width:900,height:700},
    actions:{
      addDatabase:SharedDatabaseApp._onAddDatabase,removeDatabase:SharedDatabaseApp._onRemoveDatabase,
      addRecord:SharedDatabaseApp._onAddRecord,removeRecord:SharedDatabaseApp._onRemoveRecord,
      save:SharedDatabaseApp._onSave
    }
  };
  static PARTS={content:{template:"systems/sd/templates/config/shared-database.hbs",scrollable:[".sd-db-body"]}};

  async _prepareContext(options){
    const base=await super._prepareContext(options);const cfg=getSharedDatabaseConfig();
    const rows=[];
    for(const [di,db] of cfg.databases.entries()){
      const records=[];
      for(const [ri,record] of db.records.entries()){
        let value="";try{value=formatDatabaseValue(await readDatabaseValue({databaseId:db.id,recordId:record.id,ownerMode:db.storage==="world"?"world":"auto",owner:this.contextDocument,item:this.contextDocument?.documentName==="Item"?this.contextDocument:null,actor:this.contextDocument?.documentName==="Actor"?this.contextDocument:this.contextDocument?.actor}),record.type);}catch{}
        records.push({...record,index:ri,databaseIndex:di,value,defaultText:formatDatabaseValue(record.default,record.type),typeOptions:DATABASE_TYPES.map(t=>({...t,selected:t.id===record.type}))});
      }
      rows.push({...db,index:di,isWorld:db.storage==="world",isVariables:db.kind==="variables",isEnum:db.kind==="enum",isDataTable:db.kind==="dataTable",records});
    }
    return {...base,databaseEntries:rows,contextName:this.contextDocument?.name??"World",hasContext:!!this.contextDocument,isGM:!!game.user?.isGM,typeOptions:DATABASE_TYPES};
  }

  _collect(){
    const cfg=getSharedDatabaseConfig();const form=this.element?.querySelector("form");if(!form)return cfg;
    const FDE=foundry.applications?.ux?.FormDataExtended??FormDataExtended;const raw=new FDE(form).object;
    for(const [di,db] of cfg.databases.entries()){
      db.name=String(raw[`db_${di}_name`]??db.name);db.kind=["variables","enum","dataTable"].includes(raw[`db_${di}_kind`])?raw[`db_${di}_kind`]:db.kind;db.storage=raw[`db_${di}_storage`]==="world"?"world":"document";db.description=String(raw[`db_${di}_description`]??db.description??"");
      for(const [ri,record] of db.records.entries()){
        record.name=String(raw[`rec_${di}_${ri}_name`]??record.name);record.type=TYPE_IDS.has(String(raw[`rec_${di}_${ri}_type`]))?String(raw[`rec_${di}_${ri}_type`]):record.type;
        record.default=coerceDatabaseValue(raw[`rec_${di}_${ri}_default`]??record.default,record.type);
        record.description=String(raw[`rec_${di}_${ri}_description`]??record.description??"");
        record.__value=raw[`rec_${di}_${ri}_value`];
      }
    }
    return cfg;
  }

  async _persist(cfg,{values=true}={}){
    const pending=[];for(const db of cfg.databases)for(const record of db.records)if(record.__value!==undefined)pending.push([db,record,record.__value]);
    for(const db of cfg.databases)for(const record of db.records)delete record.__value;
    if(game.user?.isGM) await saveSharedDatabaseConfig(cfg);
    if(values)for(const [db,record,value] of pending){
      if(db.storage!=="world"&&!this.contextDocument)continue;
      await writeDatabaseValue({databaseId:db.id,recordId:record.id,value,ownerMode:db.storage==="world"?"world":"auto",owner:this.contextDocument,item:this.contextDocument?.documentName==="Item"?this.contextDocument:null,actor:this.contextDocument?.documentName==="Actor"?this.contextDocument:this.contextDocument?.actor});
    }
  }

  static async _onAddDatabase(){const cfg=this._collect();let id=databaseSafeId(`database_${cfg.databases.length+1}`);while(cfg.databases.some(d=>d.id===id))id=databaseSafeId(`${id}_2`);cfg.databases.push({id,name:`Database ${cfg.databases.length+1}`,kind:"variables",storage:"document",description:"",records:[]});await this._persist(cfg,{values:true});this.render();}
  static async _onRemoveDatabase(event,target){const cfg=this._collect();const i=Number(target.dataset.index);if(!Number.isInteger(i)||!cfg.databases[i])return;cfg.databases.splice(i,1);await this._persist(cfg,{values:true});this.render();}
  static async _onAddRecord(event,target){const cfg=this._collect();const i=Number(target.dataset.index);const db=cfg.databases[i];if(!db)return;let id=databaseSafeId(`record_${db.records.length+1}`);while(db.records.some(r=>r.id===id))id=databaseSafeId(`${id}_2`);db.records.push({id,name:`Record ${db.records.length+1}`,type:"any",default:null,description:""});await this._persist(cfg,{values:true});this.render();}
  static async _onRemoveRecord(event,target){const cfg=this._collect();const di=Number(target.dataset.databaseIndex),ri=Number(target.dataset.recordIndex);if(!cfg.databases[di]?.records?.[ri])return;cfg.databases[di].records.splice(ri,1);await this._persist(cfg,{values:true});this.render();}
  static async _onSave(){try{await this._persist(this._collect(),{values:true});ui.notifications?.info?.("Database saved.");this.render();}catch(error){console.error("SD | Database save failed",error);ui.notifications?.error?.(`Database: ${error.message}`);}}
}

export function openSharedDatabaseApp(document=null){const app=new SharedDatabaseApp({document});app.render(true);return app;}
