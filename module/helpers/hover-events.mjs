const parse = value => { if(typeof value!=="string")return value;try{return JSON.parse(value);}catch{return value;} };

/** Match identity, never compare an object's mutable display value. */
export function matchesHoverObject(wanted, payload) {
  wanted=parse(wanted);
  if(Array.isArray(wanted))return wanted.some(value=>matchesHoverObject(value,payload));
  if(wanted==null||wanted==="")return false;
  if(typeof wanted==="object") {
    if(wanted.viewerId)return String(wanted.viewerId)===String(payload.viewerId??"")
      && (!wanted.hotspotId&&!wanted.id || String(wanted.hotspotId??wanted.id)===String(payload.hotspotId??""));
    wanted=wanted.widgetKey??wanted.widgetId??wanted.uuid??wanted.document?.uuid??wanted.tokenId??wanted.actorId??wanted.id??wanted._id;
  }
  if(wanted==null)return false;
  return [payload.widgetKey,payload.widgetId,payload.objectUuid,payload.actorUuid,payload.actorId,payload.objectId,payload.viewerId,payload.hotspotId]
    .filter(v=>v!=null&&String(v)!=="").some(value=>String(value)===String(wanted));
}

export async function runHoverGraph(doc, payload, baseRuntime = {}) {
  const graph=parse(doc?.system?.sdTriggerGraph);
  if(!graph||payload.event!=="hover")return 0;
  const entries=Object.values(graph._events??{}).filter(entry=>entry?.hook==="sdObjectHover");
  if(!entries.length)return 0;
  const {ButtonExecutor}=await import("./button-executor.mjs");
  let fired=0;
  for(const entry of entries) {
    const runtime={...baseRuntime,__vars:{...baseRuntime.__vars},__nodeResults:{...baseRuntime.__nodeResults}};
    const object=payload.object??(payload.viewerId?{kind:"model3d",viewerId:payload.viewerId,id:payload.hotspotId||undefined}:{widgetKey:payload.widgetKey,uuid:payload.objectUuid});
    for(const [key,value] of Object.entries({...payload,object}))runtime.__vars[`__hover_${key}`]=value;
    const btn={__eventRuntime:runtime,__macros:graph._macros};
    try {
      const matched=await ButtonExecutor._runAction({type:"sd_hover_match",...entry.data,payload},doc.documentName==="Item"?doc:null,doc.documentName==="Item"?doc.actor:doc,btn,runtime);
      if(!matched)continue;
      for(const action of entry.actions??[])await ButtonExecutor._runAction(action,doc.documentName==="Item"?doc:null,doc.documentName==="Item"?doc.actor:doc,btn,runtime);
      fired++;
    } catch(error) {console.error("SD | On Hover",error);}
  }
  return fired;
}

export function installCanvasHoverEvents() {
  for(const hook of ["hoverToken","hoverTile","hoverDrawing","hoverWall","hoverNote","hoverAmbientLight","hoverAmbientSound","hoverRegion"]) {
    globalThis.Hooks?.on?.(hook,(object,hovered)=>{
      if(!hovered)return;
      const document=object.document??object;
      const payload={event:"hover",objectUuid:document.uuid,objectId:document.id,actorUuid:object.actor?.uuid,actorId:object.actor?.id,object:{uuid:document.uuid,id:document.id}};
      const docs=[...(game.actors??[]),...(game.items??[])];
      for(const actor of game.actors??[])docs.push(...(actor.items??[]));
      for(const doc of docs)if(doc.isOwner||game.user?.isGM)void runHoverGraph(doc,payload);
    });
  }
}
