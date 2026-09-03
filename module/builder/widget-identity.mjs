import { dialogText } from "../helpers/foundry-compat.mjs";

function esc(value){return String(value??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}

export function normalizeWidgetKey(value,fallback="widget"){
  const key=String(value??"").trim().toLowerCase().replace(/\s+/g,"_").replace(/[^\p{L}\p{N}_-]/gu,"").slice(0,64);
  return key||fallback;
}

export function collectWidgetKeys(tabs,skipWidgetId=null){
  const keys=new Set();
  const walk=widgets=>{for(const widget of (widgets??[])){
    if(!widget||widget.id===skipWidgetId)continue;
    const key=String(widget.widgetKey??"").trim();if(key)keys.add(key);
    walk(widget.widgets);
    walk((widget.elements??[]).map(element=>element?.widget).filter(Boolean));
  }};
  for(const tab of (tabs??[]))for(const row of (tab.rows??[]))walk(row.widgets);
  return keys;
}

export function uniqueWidgetKey(value,tabs,skipWidgetId=null){
  const used=collectWidgetKeys(tabs,skipWidgetId);
  const base=normalizeWidgetKey(value);
  let key=base,index=2;
  while(used.has(key))key=`${base}_${index++}`;
  return key;
}

/** Ask for the public identity of an ordinary Sheet Builder widget before it is placed. */
export async function promptWidgetIdentity({widgetType="widget",defaultLabel="Widget",tabs=[]}={}){
  const suggested=uniqueWidgetKey(defaultLabel||widgetType,tabs);
  while(true){
    const result=await foundry.applications.api.DialogV2.wait({
      modal:true,rejectClose:false,
      window:{title:"Place Sheet Widget"},
      content:`<div class="sd-widget-identity-dialog"><header><i class="fas fa-fingerprint"></i><div><b>Ordinary Sheet Widget</b><small>Set its display name and unique Widget Key before placement.</small></div></header><label><span>Display Name</span><input name="displayName" value="${esc(defaultLabel)}" required autofocus></label><label><span>Widget Key <em>required</em></span><input name="widgetKey" value="${esc(suggested)}" required spellcheck="false"><small>Used by the common Sheet Blueprint to address this widget.</small></label></div>`,
      buttons:[
        {action:"place",label:"Place Widget",icon:"fas fa-plus",default:true,callback:(event,button)=>({label:dialogText(event,button,"displayName"),widgetKey:dialogText(event,button,"widgetKey")})},
        {action:"cancel",label:"Cancel",icon:"fas fa-xmark",callback:()=>null}
      ]
    }).catch(()=>null);
    if(!result)return null;
    const label=result.label||defaultLabel||widgetType;
    const widgetKey=normalizeWidgetKey(result.widgetKey,"");
    if(!widgetKey){ui.notifications?.warn?.("Widget Key is required.");continue;}
    if(collectWidgetKeys(tabs).has(widgetKey)){ui.notifications?.warn?.(`Widget Key “${widgetKey}” already exists on this sheet.`);continue;}
    return {label,widgetKey};
  }
}
