import { forEachWidget, WIDGET_NODE_CONTRACTS, attributeGroupEntries } from "../builder/widget-nodes.mjs";
import { emitSheetWidgetEvent } from "./sheet-widget-events.mjs";
import { WIDGET_VARIABLES } from "./widget-variables.mjs";

let installed=false;
export const widgetCommitEventsInstalled=()=>installed;
const active=new Set();
const sources=new WeakMap();
export function registerWidgetEventSource(cell,doc,widget) {
  let entries=sources.get(doc);if(!entries)sources.set(doc,entries=new Set());
  for(const entry of entries)if(!entry.cell.deref()?.isConnected)entries.delete(entry);
  entries.add({cell:new WeakRef(cell),widget});
}

export function widgetValueSnapshot(doc) {
  const result=[];
  const widgets=new Map();
  forEachWidget(doc,widget=>widgets.set(widget.widgetKey||widget.id,widget));
  for(const entry of sources.get(doc)??[])if(entry.cell.deref()?.isConnected&&!widgets.has(entry.widget.widgetKey||entry.widget.id))widgets.set(entry.widget.widgetKey||entry.widget.id,entry.widget);
  for(const widget of widgets.values()){
    const base={widgetId:String(widget.id??""),widgetKey:String(widget.widgetKey||widget.id||""),widgetLabel:String(widget.label??""),widgetType:widget.type};
    try {
      if(widget.type==="attributeGroup") {
        for(const entry of attributeGroupEntries(widget,doc))result.push({...base,elementKey:entry.key,value:entry.score,state:[entry.score,entry.mod]});
      } else if(widget.type==="cardHand") {
        const stack=(widget.sourceUuid?globalThis.fromUuidSync?.(widget.sourceUuid):null)??game.cards?.getName?.(widget.sourceName);
        const cards=[...(stack?.cards??[])].map(card=>({id:card.id,name:card.name,face:card.face,sort:card.sort,drawn:card.drawn}));
        result.push({...base,elementKey:"",value:cards,state:[cards]});
      } else if(widget.type==="image") {
        const src=widget.staticSrc||(widget.path?foundry.utils.getProperty(doc,widget.path):"")||"";
        result.push({...base,elementKey:"",value:src,state:[src]});
      } else {
        const contract=WIDGET_NODE_CONTRACTS[widget.type];
        if(!contract)continue;
        const state=contract.map(pin=>pin[3](widget,doc));
        const bindings=(WIDGET_VARIABLES[widget.type]??[]).map(field=>String(widget[field.field]??"")).filter(path=>path.startsWith("system."));
        const actual=bindings.map(path=>foundry.utils.getProperty(doc,path));
        result.push({...base,elementKey:"",value:actual[0]??state[0],state:[...state,...actual]});
      }
    } catch(error){console.warn("SD | cannot read widget event state",widget.id,error);}
  }
  return JSON.parse(JSON.stringify(result));
}

export async function emitWidgetValueChanges(doc,before,options={},userId) {
  if(!before||options.sdSkipEventBus||userId&&game.user?.id&&userId!==game.user.id)return;
  const after=widgetValueSnapshot(doc);
  for(const value of after){
    const previous=before.find(old=>old.widgetId===value.widgetId&&old.widgetKey===value.widgetKey&&old.elementKey===value.elementKey);
    if(!previous||JSON.stringify(previous.state)===JSON.stringify(value.state))continue;
    const key=`${doc.uuid}|${value.widgetKey}|${value.elementKey}`;
    if(active.has(key))continue;
    active.add(key);
    try {
      const changed=value.state.findIndex((entry,index)=>JSON.stringify(entry)!==JSON.stringify(previous.state[index]));
      const payload={...value,value:value.state[changed]??value.value,oldValue:previous.state[changed]??previous.value,documentUuid:doc.uuid,sourceUuid:doc.uuid,actorId:doc.actor?.id??(doc.documentName==="Actor"?doc.id:"")};
      delete payload.state;
      await emitSheetWidgetEvent(doc,{...payload,event:"change"});
      if(value.widgetType==="toggle")await emitSheetWidgetEvent(doc,{...payload,event:"toggle"});
    } finally {active.delete(key);}
  }
}

export function installWidgetCommitEvents() {
  if(installed)return;installed=true;
  const ownersFor=(doc,type)=>{
    if(["Card","Cards"].includes(type)){
      const actors=[...(game.actors??[])];
      return [...actors,...actors.flatMap(actor=>[...(actor.items??[])]),...(game.items??[])];
    }
    return [doc,doc.actor,doc.parent,doc.parent?.actor].filter((owner,index,list)=>owner?.system&&list.indexOf(owner)===index);
  };
  for(const type of ["Actor","Item","ActiveEffect","Card","Cards"]){
    for(const operation of ["Update","Create","Delete"]){
      const capture=(doc,changesOrOptions,options)=>{
        const opts=operation==="Update"||operation==="Create"?options:changesOrOptions;
        if(!opts||opts.sdSkipEventBus)return;
        const owners=ownersFor(doc,type);
        opts.sdWidgetSnapshots=Object.fromEntries(owners.map(owner=>[owner.uuid,widgetValueSnapshot(owner)]));
      };
      const commit=(doc,changesOrOptions,optionsOrUser,user)=>{
        const options=operation==="Update"?optionsOrUser:changesOrOptions;
        const userId=operation==="Update"?user:optionsOrUser;
        const owners=ownersFor(doc,type);
        for(const owner of owners)void emitWidgetValueChanges(owner,options?.sdWidgetSnapshots?.[owner.uuid],options,userId).catch(error=>console.error("SD | widget change event failed",error));
      };
      Hooks.on(`pre${operation}${type}`,capture);
      Hooks.on(`${operation.toLowerCase()}${type}`,commit);
    }
  }
}
