import { modelPointVisible } from "./model-point-visibility.mjs";
import { uniqueId } from "../helpers/unique-id.mjs";

/** Shared graph/editor metadata. Point IDs also identify stable execution pins. */
export function modelPoints(value) {
  if (typeof value === "string") { try { value = JSON.parse(value || "[]"); } catch { return []; } }
  return Array.isArray(value) ? value.filter(p => p && typeof p === "object" && String(p.id ?? p.hotspotId ?? "").trim())
    .map(p => ({ ...p, id: String(p.id ?? p.hotspotId) })) : [];
}

export const pointPinId = id => `point_${Array.from(String(id), c=>c.codePointAt(0).toString(16)).join("_")}`;

export function findPointWidget(doc, key) {
  const widgets=[];
  const visit=w=>{if(!w)return;if(w.type==="model3d")widgets.push(w);for(const c of w.widgets??[])visit(c);for(const e of w.elements??[])visit(e.widget);};
  for(const tab of doc?.system?.customTabs??[])for(const row of tab.rows??[])for(const w of row.widgets??[])visit(w);
  const norm=v=>String(v??"").trim().toLowerCase();
  return widgets.find(w=>[w.widgetKey,w.id].some(v=>v && norm(v)===norm(key))) ?? widgets.find(w=>w.label && norm(w.label)===norm(key));
}

export function modelWidgetPoints(widget, doc) {
  return modelPoints(widget?.hotspots).map(p=>({...p,showIf:String(p.showIf??""),widgetKey:widget.widgetKey||widget.id,widgetId:widget.id,documentUuid:doc?.uuid??"",visible:modelPointVisible(p,doc)}));
}

export function modelPointValuePins(points) {
  return modelPoints(points).flatMap(p=>[
    {id:pointPinId(p.id),label:p.id,type:"value.any"},
    ...[["text","Text","string"],["x","X","number"],["y","Y","number"],["z","Z","number"],["visible","Visible","bool"]]
      .map(([key,label,type])=>({id:`${pointPinId(p.id)}_${key}`,label:`${p.id} · ${label}`,type:`value.${type}`}))
  ]);
}

export function readModelPointPin(widget,doc,pin) {
  for(const p of modelWidgetPoints(widget,doc)) {
    const id=pointPinId(p.id);
    if(pin===id)return p;
    for(const field of ["text","x","y","z","visible"])if(pin===`${id}_${field}`)return p[field]??(["x","y","z"].includes(field)?0:"");
  }
  return "";
}

export function syncModelPointNodes(graph) {
  for (const node of graph.nodes ?? []) {
    if(!["widget_get_model3d","on_model3d_point_action"].includes(node.type))continue;
    const widget=findPointWidget(graph.doc,node.data?.widgetKey||node.data?.widgetId);
    node.data??={};node.data.pointDefinitions=modelPoints(widget?.hotspots);
  }
  for (const node of graph.nodes ?? []) {
    if (node.type !== "model3d_point_events") continue;
    const edge = (graph.edges ?? []).find(e => e.toNode === node.id && e.toPin === "points");
    const source = (graph.nodes ?? []).find(n => n.id === edge?.fromNode);
    node.data ??= {};
    if (source && ["model3d_open", "model3d_primitive"].includes(source.type)) {
      node.data.pointDefinitions = modelPoints(source.data?.hotspots).map(p => ({ id: p.id, text: p.text }));
    } else if(source?.type==="widget_get_model3d") {
      node.data.pointDefinitions=modelPoints(source.data?.pointDefinitions);
    }
  }
}

/** Saves to the graph draft. The graph's normal Save persists both nodes and compiled actions. */
export async function editModelNodePoints(graph, node, serviceLoader = () => import("./model-viewer.mjs")) {
  const service = await serviceLoader();
  const data = node.data ??= {};
  let src=data.src;
  const sourceEdge=graph.edges?.find(e=>e.toNode===node.id&&e.toPin==="src");
  const sourceNode=graph.nodes?.find(n=>n.id===sourceEdge?.fromNode);
  if(sourceNode&&graph._compileValue){
    const {FormulaEngine}=await import("../helpers/formula-engine.mjs");
    const expression=graph._compileValue(sourceNode,new Set(),sourceEdge.fromPin);
    if(!String(expression).includes("__nodeResult:"))src=FormulaEngine.evaluate(expression,graph.doc??{});
  }
  const key=encodeURIComponent(String(node.id||data.viewerId||"model")).replaceAll('.','%2E');
  const legacy=graph.doc?.flags?.sd?.modelHotspots?.[key];
  return service.openModelViewer({
    ...data, src, document:graph.doc,
    primitive: node.type === "model3d_primitive" ? (data.primitive || "cube") : undefined,
    viewerId: `editor-${node.id}-${uniqueId()}`,
    title: globalThis.game?.i18n?.lang === "ru" ? "Редактор точек 3D" : "3D Point Editor",
    fullscreen: "no", editPoints: true, hotspots: modelPoints(!data.pointsAuthored&&Array.isArray(legacy)?legacy:data.hotspots),
    onSaveHotspots: async points => {
      if (!graph.nodes.includes(node)) throw new Error("The 3D node has been removed from this graph.");
      data.hotspots = JSON.stringify(modelPoints(points));
      data.pointsAuthored = true;
      syncModelPointNodes(graph);
      graph._renderNode?.(node);
      for (const target of graph.nodes) if (target.type === "model3d_point_events") graph._renderNode?.(target);
      graph._redrawEdges?.(); graph._updatePreview?.(); graph._pushHistory?.();
    }
  });
}
