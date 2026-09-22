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
  constructor(graph) {
    this.graph = graph;
    this.svg = graph.edgeSVG;
    this.root = graph.nodesEl;
    this.wrap = graph.win?.querySelector("#gwrap");
    this.elements = new Map(); this.geometry = new Map(); this.dirty = new Set();
    this.pendingPositions = new Map(); this.paths = new Map(); this.nodes = new Map();
    this.connected = new Map(); this.edgeIds = new Set(); this.disposed = false;
    this.geometryStyles = new WeakMap();
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
      for (const entry of entries) this.invalidateTarget(entry.target);
      this.graph._scheduleEdges?.(false);
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
  invalidateAll() { for (const id of this.elements.keys()) this.dirty.add(id); }
  syncNodes() {
    const source = this.graph.nodes;
    if (this.nodeSource !== source || this.nodeCount !== source.length) {
      this.nodeSource = source; this.nodeCount = source.length;
      this.nodes = new Map(source.map(node => [String(node.id), node]));
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
    this.geometryStyles.set(element, geometryStyle(element));
    if (node) this.nodes.set(id, node);
    this.geometry.delete(id); this.dirty.add(id); this.resizeObserver?.observe(element);
  }
  removeNode(id, removeElement = true) {
    id = String(id);
    const element = this.elements.get(id);
    if (element) { this.resizeObserver?.unobserve(element); if (removeElement) element.remove(); }
    this.elements.delete(id); this.geometry.delete(id); this.dirty.delete(id);
    this.pendingPositions.delete(id); this.nodes.delete(id);
  }
  resetNodes() {
    for (const element of this.elements.values()) this.resizeObserver?.unobserve(element);
    this.elements.clear(); this.geometry.clear(); this.dirty.clear(); this.pendingPositions.clear();
    this.nodeSource = null; this.edgeSource = null; this.nodes.clear();
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
    for (const id of this.dirty) {
      const element = this.elements.get(id);
      if (!element?.isConnected) continue;
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
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
    for (const [id,box] of this.geometry) {
      const node=this.nodes.get(id), element=this.elements.get(id);
      if (!node || !element) continue;
      const x=pan.x+Number(node.x)*zoom,y=pan.y+Number(node.y)*zoom;
      const hidden=!!(width&&height&&id!==focused&&(x+box.width*zoom < -160 || y+box.height*zoom < -160 || x>width+160 || y>height+160));
      if (box.hidden!==hidden) { element.style.visibility=hidden?"hidden":"";box.hidden=hidden; }
    }
    let fragment=null;
    for (const edge of this.graph.edges) {
      const id=String(edge.id), a=this.screenPoint(edge.fromNode,edge.fromPin,"output",false), b=this.screenPoint(edge.toNode,edge.toPin,"input",false);
      let slot=this.paths.get(id);
      if (!a || !b || !graphEdgeVisible({x:a.x+pan.x,y:a.y+pan.y},{x:b.x+pan.x,y:b.y+pan.y},width,height)) {
        if (slot&&!slot.hidden) { slot.hit.style.display=slot.path.style.display="none";slot.hidden=true; }
        continue;
      }
      slot ??= this.createPaths(id,fragment ??= this.doc.createDocumentFragment());
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
      if (this.edgeIds.has(id)) continue;
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
