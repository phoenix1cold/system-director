import { databaseSelectOptions, databaseRecordSelectOptions, databaseTypePin, getDatabaseRecord, readDataAsset } from "./shared-database.mjs";
const OWNER="sd:data-assets-v2";
function token(rest){const [kind,databaseId,recordId,...tail]=String(rest??"").split("|");if(kind==="enum")return readDataAsset(databaseId,recordId);if(kind==="row")return readDataAsset(databaseId,recordId,tail.join("|"));return undefined;}
export function registerDataAssetNodes(){
  const registry=globalThis.SD?.nodeRegistry??globalThis.CONFIG?.SD?.nodeRegistry;
  if(!registry?.registerNode)return;
  try{registry.registerNode("database_enum_value",{
    title:"Enum Asset Value",cat:"Database",color:"#8b66d9",wideNode:true,
    desc:"Reads an entry from a UE-style Enum asset stored in the System Director Database.",
    inputs:[],outputs:[{id:"value",label:"Value",type:"value.any"}],
    computeDynamicOutputs:n=>[{id:"value",label:"Value",type:databaseTypePin(getDatabaseRecord(n.data?.databaseId,n.data?.recordId)?.type??"any")}],
    fields:[
      {key:"databaseId",label:"Enum Asset",type:"select",default:"",options:()=>databaseSelectOptions("enum")},
      {key:"recordId",label:"Entry",type:"select",default:"",options:n=>databaseRecordSelectOptions(n.data?.databaseId)}
    ],compile:n=>`{sdDataAsset:enum|${n.data.databaseId??""}|${n.data.recordId??""}}`
  },{owner:OWNER});}catch(error){console.warn("SD | Enum Asset node registration failed",error);}
  try{registry.registerNode("database_data_table_row",{
    title:"Data Table Row",cat:"Database",color:"#d5803b",wideNode:true,
    desc:"Reads a typed row or a property from a UE-style Data Table asset.",
    inputs:[],outputs:[{id:"row",label:"Row / Field",type:"value.any"}],
    computeDynamicOutputs:n=>[{id:"row",label:n.data?.field?"Field":"Row",type:n.data?.field?"value.any":databaseTypePin(getDatabaseRecord(n.data?.databaseId,n.data?.recordId)?.type??"object")}],
    fields:[
      {key:"databaseId",label:"Data Table",type:"select",default:"",options:()=>databaseSelectOptions("dataTable")},
      {key:"recordId",label:"Row",type:"select",default:"",options:n=>databaseRecordSelectOptions(n.data?.databaseId)},
      {key:"field",label:"Field path (optional)",type:"text",default:""}
    ],compile:n=>`{sdDataAsset:row|${n.data.databaseId??""}|${n.data.recordId??""}|${n.data.field??""}}`
  },{owner:OWNER});}catch(error){console.warn("SD | Data Table node registration failed",error);}
}
export function initDataAssets(){
  globalThis.SD_NODE_RUNTIME?.registerToken?.("sdDataAsset:",token,{owner:OWNER});
  if(globalThis.SD?.nodeRegistry)registerDataAssetNodes();else Hooks.once("sdNodeRegistryReady",registerDataAssetNodes);
}
Hooks.once("ready",initDataAssets);
