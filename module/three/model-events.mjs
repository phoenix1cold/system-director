/** Resolve the latest owning graph on every local interaction, including unsynchronised graph saves. */
export async function runModelInteraction(doc, payload, runtime = {}) {
  if (!doc) return;
  if(payload.event === "hover") {
    const {runHoverGraph}=await import("../helpers/hover-events.mjs");
    await runHoverGraph(doc,payload,runtime);
  }
  let graph=doc.system?.sdTriggerGraph;
  if(typeof graph==="string"){try{graph=JSON.parse(graph);}catch{return;}}
  const entries=Object.values(graph?._events??{}).filter(entry=>entry?.hook==="sdModelInteraction"
    &&(!entry.data?.viewerId||entry.data.viewerId===payload.viewerId)
    &&(!entry.data?.hotspotId||entry.data.hotspotId===payload.hotspotId)
    &&(!entry.data?.event||entry.data.event==="any"||entry.data.event===payload.event));
  if(!entries.length)return;
  const {ButtonExecutor}=await import("../helpers/button-executor.mjs");
  for(const entry of entries) {
    const runtime={__vars:{}};
    for(const [key,value] of Object.entries(payload))if(["string","number","boolean"].includes(typeof value)){
      runtime[`__model3d_${key}`]=value;runtime.__vars[`__model3d_${key}`]=value;
    }
    const btn={__eventRuntime:runtime,__macros:graph._macros};
    try {for(const action of entry.actions??[])await ButtonExecutor._runAction(action,doc.documentName==="Item"?doc:null,doc.documentName==="Item"?doc.actor:doc,btn,runtime);}
    catch(error){console.error("SD | 3D interaction",error);globalThis.ui?.notifications?.error?.(String(error.message??error));}
  }
}
