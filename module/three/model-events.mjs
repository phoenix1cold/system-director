import { FormulaEngine } from "../helpers/formula-engine.mjs";
import { findPointWidget, modelPoints } from "./model-point-data.mjs";
import { modelPointVisible } from "./model-point-visibility.mjs";

export function matchesModelPointAction(data, payload, doc) {
  if(!payload.hotspotId || payload.event!==(data.event||"click"))return false;
  if(data.connected) {
    const expression=String(data.point??"").trim();
    const single=expression.match(/^\{([^{}]+)\}$/);
    let point=single?FormulaEngine._resolveToken(single[1],doc):FormulaEngine.evaluate(expression,doc);
    if(typeof point==="string"){try{point=JSON.parse(point);}catch{return false;}}
    if(!point || Array.isArray(point) || point.id!==payload.hotspotId || !modelPointVisible(point,doc))return false;
    if(point.documentUuid && point.documentUuid!==doc?.uuid)return false;
    if(point.widgetKey && point.widgetKey!==payload.widgetKey)return false;
    if(point.widgetId && point.widgetId!==payload.widgetId)return false;
    if(point.viewerId && point.viewerId!==payload.viewerId)return false;
    return true;
  }
  if(data.widgetKey) {
    const widget=findPointWidget(doc,data.widgetKey);
    if(!widget || ![widget.widgetKey,widget.id].filter(Boolean).some(id=>id===payload.widgetKey||id===payload.widgetId))return false;
    const point=modelPoints(widget.hotspots).find(p=>p.id===payload.hotspotId);
    if(!point || !modelPointVisible(point,doc))return false;
  }
  return !data.pointId || data.pointId===payload.hotspotId;
}

/** Resolve the latest owning graph on every local interaction, including unsynchronised graph saves. */
export async function runModelInteraction(doc, payload, runtime = {}) {
  if (!doc) return;
  if(payload.point && !modelPointVisible(payload.point,doc))return;
  if(payload.event === "hover") {
    const {runHoverGraph}=await import("../helpers/hover-events.mjs");
    await runHoverGraph(doc,payload,runtime);
  }
  let graph=doc.system?.sdTriggerGraph;
  if(typeof graph==="string"){try{graph=JSON.parse(graph);}catch{return;}}
  const entries=Object.values(graph?._events??{}).filter(entry=>entry?.hook==="sdModelPointAction" ? matchesModelPointAction(entry.data??{},payload,doc) : entry?.hook==="sdModelInteraction"
    &&(!entry.data?.viewerId||entry.data.viewerId===payload.viewerId)
    &&(!entry.data?.hotspotId||entry.data.hotspotId===payload.hotspotId)
    &&(!entry.data?.event||entry.data.event==="any"||entry.data.event===payload.event));
  if(!entries.length)return;
  const {ButtonExecutor}=await import("../helpers/button-executor.mjs");
  for(const entry of entries) {
    const eventRuntime={...runtime,__vars:{...runtime.__vars}};
    for(const [key,value] of Object.entries(payload))if(["string","number","boolean"].includes(typeof value)){
      eventRuntime[`__model3d_${key}`]=value;eventRuntime.__vars[`__model3d_${key}`]=value;
    }
    const point=payload.point?{...payload.point,widgetKey:payload.widgetKey,widgetId:payload.widgetId,documentUuid:doc.uuid}:null;
    eventRuntime.__model3d_point=point;eventRuntime.__vars.__model3d_point=point;
    const btn={__eventRuntime:eventRuntime,__macros:graph._macros};
    try {for(const action of entry.actions??[])await ButtonExecutor._runAction(action,doc.documentName==="Item"?doc:null,doc.documentName==="Item"?doc.actor:doc,btn,eventRuntime);}
    catch(error){console.error("SD | 3D interaction",error);globalThis.ui?.notifications?.error?.(String(error.message??error));}
  }
}
