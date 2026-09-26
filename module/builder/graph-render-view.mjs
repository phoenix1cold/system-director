import { pinTypeMeta } from "./pin-types.mjs";
const NS = "http://www.w3.org/2000/svg";
const keyOf = (pin, side) => `${side}\0${pin}`;
// CSS text only: this does not trigger layout. Ignore left/top/visibility,
// which change during gestures but cannot move pins relative to their node.
const geometryStyle = el => ["width","height","min-width","max-width","min-height","max-height",
  "padding","border-width","box-sizing","font","font-size","font-family","font-weight","line-height","display","gap"]
  .map(name => el.style?.getPropertyValue(name) ?? "").join("|");

// Conservative cubic-Bezier hull, including backwards links that loop on-screen.
export function graphEdgeVisible(a, b, width, height, margin = 160) {
  if (!width || !height) return true;
  const c = Math.max(Math.abs(b.x - a.x) * 0.55, 60);
  return !(Math.max(a.x, a.x + c, b.x - c, b.x) < -margin
    || Math.min(a.x, a.x + c, b.x - c, b.x) > width + margin
    || Math.max(a.y, b.y) < -margin || Math.min(a.y, b.y) > height + margin);
}

/** Per-editor render cache. Never persisted to the saved graph.
 * All geometry reads precede SVG writes. Pan/zoom and drag use graph-space
 * pin offsets; DOM changes, undo, resize, fonts and detachment invalidate them.
 */
export class GraphRenderView {
  // Fresh node builds per frame while zooming out / opening; the rest continue next frame.
  static MOUNT_BATCH = 16;
  static MOUNT_MIN = 4;
  static MOUNT_TIME_BUDGET_MS = 6;
  // Below this zoom node bodies are not rendered (semantic LOD): the header,
  // the box and the wires stay; controls are unreadable at that scale anyway.
  static LOD_ZOOM = 0.42;
  static LOD_ZOOM_EXIT = 0.5; // hysteresis: avoid re-layout storms while wheeling around the threshold
  constructor(graph) {
    this.graph = graph;
    this.svg = graph.edgeSVG;
    this.root = graph.nodesEl;
    this.wrap = graph.win?.querySelector("#gwrap");
    this.elements = new Map(); this.geometry = new Map(); this.dirty = new Set();
    this.pendingPositions = new Map(); this.paths = new Map(); this.nodes = new Map();
    this.connected = new Map(); this.edgeIds = new Set(); this.disposed = false;
    this.geometryStyles = new WeakMap();
    this.estimates = new WeakMap();
    this.detachedElements = new Map();
    // Translate the wire layer as a whole. Keep zoom in the path coordinates:
    // stroke widths, hit targets and the minimum Bezier bend stay in pixels.
    this.wireLayer = this.svg.ownerDocument.createElementNS(NS, "g");
    this.svg.appendChild(this.wireLayer);
    this._onEdgeDoubleClick = event => {
      const id = event.target?.dataset?.eid;
      if (id) this.graph._removeEdge(id);
    };
    this._onFieldChange = event => {
      this.invalidateTarget(event.target);
      this.graph._scheduleEdges?.(false);
    };
    this._onFonts = () => { this.invalidateAll(); this.graph._scheduleEdges?.(false); };
    this.svg.addEventListener("dblclick", this._onEdgeDoubleClick);
    this.root.addEventListener("input", this._onFieldChange, true);
    this.root.addEventListener("change", this._onFieldChange, true);
    this.syncDocument();
    for (const element of this.root.children) if (element.dataset.nid) this.registerNode(null, element);
  }
  syncDocument() {
    const doc = this.svg.ownerDocument;
    if (this.doc === doc) return;
    this.resizeObserver?.disconnect(); this.mutationObserver?.disconnect();
    this.doc?.fonts?.removeEventListener?.("loadingdone", this._onFonts);
    this.doc = doc;
    const view = doc.defaultView;
    this.resizeObserver = view?.ResizeObserver ? new view.ResizeObserver(entries => {
      if (this.disposed) return;
      let changed=false;
      for (const entry of entries) {
        if(entry.target===this.wrap){
          const size=entry.contentRect,key=`${size.width}:${size.height}`;
          if(this.wrapSize!==undefined&&this.wrapSize!==key)this.invalidateAll();
          this.wrapSize=key;changed=true;continue;
        }
        const old=this.geometry.get(entry.target.dataset.nid),size=entry.borderBoxSize?.[0];
        if(old&&size&&Math.abs(old.width-size.inlineSize)<.1&&Math.abs(old.height-size.blockSize)<.1)continue;
        changed=this.invalidateTarget(entry.target)||changed;
      }
      if(changed)this.graph._scheduleEdges?.(false);
    }) : null;
    this.mutationObserver = view?.MutationObserver ? new view.MutationObserver(records => {
      if (!this.disposed && this.consumeMutations(records)) this.graph._scheduleEdges?.(false);
    }) : null;
    this.mutationObserver?.observe(this.root, { subtree:true, childList:true, characterData:true,
      attributes:true, attributeFilter:["hidden", "class", "style"] });
    if (this.wrap) this.resizeObserver?.observe(this.wrap);
    for (const el of this.elements.values()) this.resizeObserver?.observe(el);
    doc.fonts?.addEventListener?.("loadingdone", this._onFonts);
    this.invalidateAll();
  }
  consumeMutations(records) {
    let changed = false;
    const seenStyles = new Set();
    for (const record of records) {
      if (record.type === "attributes" && record.target.classList?.contains("gpin")) continue;
      if (record.type === "attributes" && record.attributeName === "style") {
        const target = record.target;
        if (!target.closest?.("[data-nid]") || seenStyles.has(target)) continue;
        seenStyles.add(target);
        const signature = geometryStyle(target), old = this.geometryStyles.get(target);
        this.geometryStyles.set(target, signature);
        if (old === signature) continue;
      }
      changed = this.invalidateTarget(record.target) || changed;
    }
    return changed;
  }
  invalidateTarget(target) {
    const el = target?.nodeType === 1 ? target : target?.parentElement;
    const id = el?.closest?.("[data-nid]")?.dataset?.nid;
    if (!id || !this.elements.has(id)) return false;
    this.dirty.add(id); return true;
  }
  invalidateAll() {
    for (const id of this.elements.keys()) this.dirty.add(id);
    for (const id of this.geometry.keys())if(!this.elements.has(id))this.geometry.delete(id);
    this.detachedElements.clear();
  }
  syncNodes() {
    const source = this.graph.nodes;
    if (this.nodeSource !== source || this.nodeCount !== source.length) {
      this.nodeSource = source; this.nodeCount = source.length;
      this.nodes = new Map(source.map(node => [String(node.id), node]));
      this.nodeOrder = new Map(source.map((node,index)=>[String(node.id),index]));
      for(const id of this.elements.keys())if(!this.nodes.has(id))this.removeNode(id);
      for(const id of this.geometry.keys())if(!this.nodes.has(id)){this.geometry.delete(id);this.detachedElements.delete(id);}
    }
  }
  nodeById(id) { this.syncNodes(); return this.nodes.get(String(id)) ?? null; }
  syncEdges() {
    const source = this.graph.edges;
    if (this.edgeSource === source && this.edgeCount === source.length) return;
    this.edgeSource = source; this.edgeCount = source.length;
    this.connected.clear(); this.edgeIds = new Set();
    for (const edge of source) {
      this.edgeIds.add(String(edge.id));
      for (const [node,pin,side] of [[edge.fromNode,edge.fromPin,"output"],[edge.toNode,edge.toPin,"input"]]) {
        const id = String(node);
        let pins = this.connected.get(id);
        if (!pins) this.connected.set(id, pins = new Set());
        pins.add(keyOf(pin, side));
      }
    }
  }
  isConnected(nodeId, pinId, side) {
    this.syncEdges(); return this.connected.get(String(nodeId))?.has(keyOf(pinId, side)) ?? false;
  }
  registerNode(node, element) {
    const id = String(node?.id ?? element.dataset.nid), old = this.elements.get(id);
    if (old && old !== element) this.resizeObserver?.unobserve(old);
    this.elements.set(id, element);
    this.detachedElements.delete(id);
    // Mount order changes with viewport virtualization; stacking order must not.
    element.style.zIndex = String(this.nodeOrder?.get(id) ?? this.graph.nodes.indexOf(node));
    this.geometryStyles.set(element, geometryStyle(element));
    if (node) this.nodes.set(id, node);
    this.geometry.delete(id); this.dirty.add(id); this.resizeObserver?.observe(element);
  }
  removeNode(id, removeElement = true) {
    id = String(id);
    const element = this.elements.get(id);
    if (element) { this.resizeObserver?.unobserve(element); if (removeElement) element.remove(); }
    this.elements.delete(id); this.geometry.delete(id); this.dirty.delete(id);
    this.detachedElements.delete(id);
    this.pendingPositions.delete(id); this.nodes.delete(id);
  }
  resetNodes() {
    for (const element of this.elements.values()) this.resizeObserver?.unobserve(element);
    this.elements.clear(); this.geometry.clear(); this.dirty.clear(); this.pendingPositions.clear();
    this.nodeSource = null; this.edgeSource = null; this.nodes.clear();
    this.estimates = new WeakMap();
    this.detachedElements.clear();
  }
  get virtualized() { return this.graph.nodes.length >= 128; }
  nodeBounds(node) {
    const measured = this.geometry.get(String(node.id));
    if (measured) return measured;
    let estimate = this.estimates.get(node);
    if (!estimate) { estimate = this.graph._estimateNodeSize(node); this.estimates.set(node, estimate); }
    return estimate;
  }
  unmountNode(id) {
    const element = this.elements.get(id);
    if (!element) return;
    this.resizeObserver?.unobserve(element); element.remove();
    this.elements.delete(id); this.dirty.delete(id);
    // Bounded detached LRU avoids rebuilding controls when zooming back and
    // forth. It never grows with the graph, and detached nodes cost no layout.
    this.detachedElements.set(id,element);
    while(this.detachedElements.size>256)this.detachedElements.delete(this.detachedElements.keys().next().value);
  }
  prepareViewport() {
    this.syncNodes(); this.syncEdges();
    if (!this.virtualized) {
      this.viewportEdges = null;
      const previous=this.graph._renderingAllNodes;this.graph._renderingAllNodes=true;
      try {for(const [id,node] of this.nodes)if(!this.elements.has(id))this.graph._renderNode(node);}
      finally {this.graph._renderingAllNodes=previous;}
      return;
    }
    const g=this.graph, zoom=Number(g._zoom)||1, pan=g._pan;
    const width=this.wrap?.clientWidth||1100,height=this.wrap?.clientHeight||680;
    const margin=320/zoom, left=-pan.x/zoom-margin, top=-pan.y/zoom-margin;
    const right=(width-pan.x)/zoom+margin,bottom=(height-pan.y)/zoom+margin;
    const keep=new Set(),measure=new Set();
    for(const [id,node] of this.nodes){
      const box=this.nodeBounds(node),x=Number(node.x),y=Number(node.y);
      if(x+box.width>=left&&x<=right&&y+box.height>=top&&y<=bottom)keep.add(id);
    }
    // Hysteresis: avoid detaching/remounting the same controls at every wheel
    // step around a viewport boundary. The retained halo is still bounded by
    // screen area, not total graph size.
    const halo=2048/zoom;
    let retained=0;
    for(const id of this.elements.keys()){
      if(keep.has(id))continue;
      if(retained>=256)break;
      const node=this.nodes.get(id);if(!node)continue;
      const box=this.nodeBounds(node),x=Number(node.x),y=Number(node.y);
      if(x+box.width>=left-halo&&x<=right+halo&&y+box.height>=top-halo&&y<=bottom+halo){keep.add(id);retained++;}
    }
    const focused=this.doc.activeElement?.closest?.('[data-nid]')?.dataset?.nid;
    if(focused)keep.add(focused);
    if(g._conn?.fromNode)keep.add(String(g._conn.fromNode));
    for(const entry of g._drag?.group??[])if(this.elements.has(String(entry.id)))keep.add(String(entry.id));
    this.viewportEdges=[];
    // Conservative hull of endpoint rectangles. Render actual endpoint controls
    // to measure sockets for crossing wires, even when both nodes are offscreen.
    for(const edge of g.edges){
      const a=this.nodes.get(String(edge.fromNode)),b=this.nodes.get(String(edge.toNode));
      if(!a||!b)continue;
      const ab=this.nodeBounds(a),bb=this.nodeBounds(b);
      const ax=Number(a.x),ay=Number(a.y),bx=Number(b.x),by=Number(b.y);
      if(Math.max(ay+ab.height,by+bb.height)<top||Math.min(ay,by)>bottom)continue;
      const bend=Math.max(Math.abs(bx+bb.width-ax),Math.abs(ax+ab.width-bx))*.55+60/zoom;
      if(Math.max(ax+ab.width,bx+bb.width)+bend<left||Math.min(ax,bx)-bend>right)continue;
      this.viewportEdges.push(edge);
      for(const node of [a,b])if(!this.geometry.has(String(node.id)))measure.add(String(node.id));
    }
    const previous=g._renderingAllNodes;g._renderingAllNodes=true;
    let mounted=false;
    // Building a node's controls is the expensive part of a zoom-out or a
    // first open. Reattach cached elements freely, but build fresh ones in
    // bounded batches (nearest to the viewport centre first) and finish on
    // the next animation frame so a wheel step never blocks for hundreds of ms.
    const fresh=[];
    const cx=(left+right)/2, cy=(top+bottom)/2;
    const budgetEnd=performance.now()+GraphRenderView.MOUNT_TIME_BUDGET_MS;
    let built=0, deferred=false;
    try {
      for(const id of new Set([...keep,...measure])){
        if(this.elements.has(id))continue;
        const node=this.nodes.get(id);
        if(!node)continue;
        const cached=this.detachedElements.get(id);
        if(!cached){fresh.push(node);continue;}
        this.detachedElements.delete(id);this.elements.set(id,cached);
        cached.style.left=`${node.x}px`;cached.style.top=`${node.y}px`;cached.style.visibility='';
        const box=this.geometry.get(id);if(box)box.hidden=false;
        this.root.appendChild(cached);this.resizeObserver?.observe(cached);
        cached._refreshAttrCard?.();
        if(node.id===g._livePreviewNodeId)g._refreshOutputPreview?.(cached);
        g._paintDebugNode?.(node,cached);
        mounted=true;
      }
      if(fresh.length>GraphRenderView.MOUNT_BATCH){
        const d=node=>{const b=this.nodeBounds(node);return Math.hypot(Number(node.x)+b.width/2-cx,Number(node.y)+b.height/2-cy);};
        fresh.sort((a,b)=>d(a)-d(b));
      }
      for(const node of fresh){
        const overBudget=built>=GraphRenderView.MOUNT_BATCH||(built>=GraphRenderView.MOUNT_MIN&&performance.now()>budgetEnd);
        if(overBudget&&!g._renderingAllNodesSync){deferred=true;break;}
        g._renderNode(node);built++;
        const element=this.elements.get(String(node.id));
        if(node.id===g._livePreviewNodeId)g._refreshOutputPreview?.(element);
        g._paintDebugNode?.(node,element);
        mounted=true;
      }
    } finally {g._renderingAllNodes=previous;}
    this.mountBacklog=deferred;
    if(deferred)g._scheduleEdges?.(false);
    this.measure();
    for(const id of this.elements.keys())if(!keep.has(id))this.unmountNode(id);
    if(mounted)g._refreshSelectionHighlights();
  }
  /** Flush deferred node construction synchronously (tests, exports, focus jumps). */
  mountAll() {
    let guard=0;
    while(this.mountBacklog&&guard++<64){this.graph._renderingAllNodesSync=true;try{this.prepareViewport();}finally{this.graph._renderingAllNodesSync=false;}}
  }
  /** Semantic LOD: hide node bodies at low zoom; a node being edited stays full. */
  applyLod() {
    const zoom = Number(this.graph._zoom) || 1;
    const was = this.root.classList.contains("sd-graph-lod");
    const threshold = was ? GraphRenderView.LOD_ZOOM_EXIT : GraphRenderView.LOD_ZOOM;
    const lod = this.virtualized && zoom < threshold && !this.graph._disableLod;
    this.root.classList.toggle("sd-graph-lod", lod);
    const focused = this.doc.activeElement?.closest?.("[data-nid]");
    if (this.lodKeep && this.lodKeep !== focused) this.lodKeep.classList.remove("sd-graph-lod-keep");
    if (lod && focused) focused.classList.add("sd-graph-lod-keep");
    this.lodKeep = lod ? focused : null;
  }
  moveNode(node) { this.pendingPositions.set(String(node.id), node); }
  flushPositions() {
    for (const [id, node] of this.pendingPositions) {
      const el = this.elements.get(id);
      if (el) { el.style.left = `${node.x}px`; el.style.top = `${node.y}px`; }
    }
    this.pendingPositions.clear();
  }
  measure() {
    this.syncDocument(); this.syncNodes();
    this.consumeMutations(this.mutationObserver?.takeRecords() ?? []);
    const zoom = Number(this.graph._renderedZoom ?? this.graph._zoom) || 1;
    // READ phase: retain sub-pixel accuracy, borders and nested pin layout.
    const lod = this.root.classList.contains("sd-graph-lod");
    // Batch: reveal every dirty body first (writes), then read all rects in a
    // single layout pass, then hide them again. Interleaving would force one
    // layout per node.
    const pending = [];
    for (const id of this.dirty) {
      const element = this.elements.get(id);
      if (!element?.isConnected) continue;
      const body = element.querySelector(":scope > .gnbody");
      if (lod && body) body.style.contentVisibility = "visible";
      pending.push({ id, element, body });
    }
    for (const { id, element, body } of pending) {
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      if (body) element.style.setProperty("--gnbody-h", `${Math.max(8, body.getBoundingClientRect().height / zoom)}px`);
      const pins = new Map();
      for (const pin of element.querySelectorAll(".gpin[data-pid][data-side]")) {
        const r = pin.getBoundingClientRect();
        if (!r.width && !r.height) continue;
        const type = pin.dataset.pinType || "value.any";
        pins.set(keyOf(pin.dataset.pid,pin.dataset.side), {
          x:(r.left+r.width/2-rect.left)/zoom, y:(r.top+r.height/2-rect.top)/zoom,
          type, meta:pinTypeMeta(type)
        });
      }
      const old = this.geometry.get(id);
      this.geometry.set(id, {width:rect.width/zoom,height:rect.height/zoom,pins,hidden:old?.hidden ?? false});
      this.dirty.delete(id);
    }
    if (lod) for (const { body } of pending) if (body) body.style.contentVisibility = "";
  }
  pinOffset(nodeId, pinId, side) {
    this.measure(); return this.geometry.get(String(nodeId))?.pins.get(keyOf(pinId,side)) ?? null;
  }
  pinGraph(nodeId, pinId, side) {
    const pin = this.pinOffset(nodeId,pinId,side), node = this.nodeById(nodeId);
    return pin && node ? {x:Number(node.x)+pin.x,y:Number(node.y)+pin.y} : null;
  }
  screenPoint(nodeId, pinId, side, translated = true) {
    const pin = this.geometry.get(String(nodeId))?.pins.get(keyOf(pinId,side));
    const node = this.nodes.get(String(nodeId));
    if (!pin || !node) return null;
    const g = this.graph, zoom = Number(g._zoom) || 1;
    return {x:(translated ? g._pan.x : 0)+(Number(node.x)+pin.x)*zoom,y:(translated ? g._pan.y : 0)+(Number(node.y)+pin.y)*zoom,pin};
  }
  pinScreen(nodeId, pinId, side) { this.measure(); return this.screenPoint(nodeId,pinId,side); }
  createPaths(id, fragment) {
    const hit = this.doc.createElementNS(NS,"path"), path = this.doc.createElementNS(NS,"path");
    hit.dataset.eid = id;
    for (const p of [hit,path]) p.setAttribute("fill","none");
    hit.setAttribute("stroke","transparent"); hit.setAttribute("stroke-width","14");
    hit.setAttribute("pointer-events","stroke"); hit.style.cursor="pointer";
    path.setAttribute("stroke-linecap","round"); path.setAttribute("opacity","0.92");
    path.setAttribute("pointer-events","none");
    fragment.append(hit,path);
    const slot = {hit,path,hidden:false}; this.paths.set(id,slot); return slot;
  }
  draw() {
    if (this.disposed) return;
    this.applyLod();
    this.prepareViewport();
    this.measure(); this.syncEdges();
    const width = this.wrap?.clientWidth || 0, height = this.wrap?.clientHeight || 0;
    const focused = this.doc.activeElement?.closest?.("[data-nid]")?.dataset?.nid;
    const zoom = Number(this.graph._zoom) || 1, pan = this.graph._pan;
    this.flushPositions();
    if (this.panX !== pan.x || this.panY !== pan.y) {
      this.wireLayer.setAttribute("transform", `translate(${pan.x} ${pan.y})`);
      this.panX = pan.x; this.panY = pan.y;
    }
    // WRITE phase: visibility preserves controls and measurable off-screen pins.
    for (const [id,element] of this.elements) {
      const node=this.nodes.get(id), box=this.geometry.get(id);
      if (!node || !box) continue;
      const x=pan.x+Number(node.x)*zoom,y=pan.y+Number(node.y)*zoom;
      const hidden=!!(width&&height&&id!==focused&&(x+box.width*zoom < -160 || y+box.height*zoom < -160 || x>width+160 || y>height+160));
      if (box.hidden!==hidden) { element.style.visibility=hidden?"hidden":"";box.hidden=hidden; }
    }
    let fragment=null;
    const drawn = this.virtualized ? new Set() : null;
    for (const edge of this.viewportEdges ?? this.graph.edges) {
      const id=String(edge.id), a=this.screenPoint(edge.fromNode,edge.fromPin,"output",false), b=this.screenPoint(edge.toNode,edge.toPin,"input",false);
      let slot=this.paths.get(id);
      if (!a || !b || !graphEdgeVisible({x:a.x+pan.x,y:a.y+pan.y},{x:b.x+pan.x,y:b.y+pan.y},width,height)) {
        if (slot&&!slot.hidden) { slot.hit.style.display=slot.path.style.display="none";slot.hidden=true; }
        continue;
      }
      slot ??= this.createPaths(id,fragment ??= this.doc.createDocumentFragment());
      drawn?.add(id);
      if (slot.ax!==a.x || slot.ay!==a.y || slot.bx!==b.x || slot.by!==b.y) {
        const d=this.graph._bez(a,b);
        slot.hit.setAttribute("d",d);slot.path.setAttribute("d",d);slot.d=d;
        slot.ax=a.x;slot.ay=a.y;slot.bx=b.x;slot.by=b.y;
      }
      const meta=a.pin.meta, stroke=a.pin.type==="exec"?"#ffca6b":meta.color;
      const sw=meta.container?"4.2":meta.structured?"3.8":"3.5",dash=meta.container?"10,4":"";
      if (slot.stroke!==stroke) {slot.path.setAttribute("stroke",stroke);slot.stroke=stroke;}
      if (slot.width!==sw) {slot.path.setAttribute("stroke-width",sw);slot.width=sw;}
      if (slot.dash!==dash) {
        if (dash) slot.path.setAttribute("stroke-dasharray",dash); else slot.path.removeAttribute("stroke-dasharray");
        slot.dash=dash;
      }
      if (slot.hidden) {slot.hit.style.display=slot.path.style.display="";slot.hidden=false;}
    }
    if (fragment?.childNodes.length) this.wireLayer.appendChild(fragment);
    for (const [id,slot] of this.paths) {
      if (this.edgeIds.has(id) && (!drawn || drawn.has(id))) continue;
      slot.hit.remove();slot.path.remove();this.paths.delete(id);
    }
  }
  dispose() {
    this.disposed=true;this.resizeObserver?.disconnect();this.mutationObserver?.disconnect();
    this.doc?.fonts?.removeEventListener?.("loadingdone",this._onFonts);
    this.svg.removeEventListener("dblclick",this._onEdgeDoubleClick);
    this.root.removeEventListener("input",this._onFieldChange,true);
    this.root.removeEventListener("change",this._onFieldChange,true);
    for (const el of this.elements.values()) el.style.visibility="";
    for (const slot of this.paths.values()) {slot.hit.remove();slot.path.remove();}
    this.wireLayer.remove();
    this.paths.clear();this.resetNodes();
  }
}
