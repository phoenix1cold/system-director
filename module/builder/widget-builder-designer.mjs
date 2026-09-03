import { WIDGET_TYPES, WIDGET_PALETTE_ORDER, getWidgetPaletteOrder, createWidget } from "./widget-registry.mjs";
import { WidgetRenderer } from "./widget-renderer.mjs";
import { assignUniqueWidgetDataPaths, buildWidgetPathRegistryUpdate } from "./widget-paths.mjs";
import { getValueDefinitions, getValueDefinition, createDatabaseVariable } from "../helpers/value-database.mjs";
import { widgetVariables, widgetVarPath, coerceWidgetValue, ensureWidgetVariables } from "../helpers/widget-variables.mjs";

const { ApplicationV2 } = foundry.applications.api;
const clone = value => foundry.utils.deepClone(value);
const esc = value => String(value ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const id = () => foundry.utils.randomID(8);
// Only self-nesting is forbidden: a Widget Builder cannot contain another
// Widget Builder. Everything else (Attribute, Skill, Progress, ...) is allowed
// inside a builder canvas and drives its own widget variables.
const BLOCKED = new Set(["widgetBuilder","tokenPool","tracker"]);
const BINDINGS = ["path","pathValue","pathMax","maxPath"];

function normalizeElement(source={}, index=0) {
  const widget = source.widget && typeof source.widget === "object" ? clone(source.widget) : null;
  return {
    id: String(source.id || id()),
    name: String(source.name || source.label || widget?.label || `Widget ${index+1}`),
    kind: widget ? "widget" : String(source.kind || "label"),
    widget,
    label: String(source.label ?? ""), icon: String(source.icon ?? ""), img: String(source.img ?? ""), color: String(source.color ?? ""),
    x: Number(source.x) || 0, y: Number(source.y) || 0,
    w: Math.max(28, Number(source.w) || (widget ? 180 : 100)), h: Math.max(24, Number(source.h) || (widget ? 76 : 36)),
    z: Number.isFinite(Number(source.z)) ? Number(source.z) : index,
    locked: source.locked === true, hidden: source.hidden === true, clickable: source.clickable === true
  };
}

function findWidgetDeep(widgets, widgetId) {
  for (const widget of (widgets ?? [])) {
    if (widget?.id === widgetId) return widget;
    const nested = findWidgetDeep(widget?.widgets, widgetId);
    if (nested) return nested;
    const built = findWidgetDeep((widget?.elements ?? []).map(entry => entry?.widget).filter(Boolean), widgetId);
    if (built) return built;
  }
  return null;
}

export class SheetWidgetDesigner extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "sd-sheet-widget-designer",
    classes: ["sd","sd-ui-widget-editor-window","sd-sheet-widget-designer"],
    position: {width:1320,height:820},
    window: {title:"Widget Builder — Sheet Designer",icon:"fa-solid fa-object-group",resizable:true,minimizable:true}
  };

  constructor({widget,doc,tab,row,onSave=null}={}) {
    super();
    this.widget=widget;
    this.doc=doc;
    this.tab=tab;
    this.row=row;
    this.onSave=onSave;
    this.elements=(widget?.elements??[]).map(normalizeElement);
    this.selectedId=this.elements[0]?.id??null;
    this.zoom=1;
  }

  static open(options={}) { const app=new SheetWidgetDesigner(options); app.render(true); return app; }
  get title(){return `Widget Builder: ${this.widget?.label||this.widget?.id||"Widget"}`;}

  async _renderHTML(){
    return `<div class="sduw-root sdsw-root">
      <header class="sduw-toolbar">
        <div class="sduw-toolbar-row">
          <div class="sdsw-brand"><i class="fas fa-object-group"></i><span><b>WIDGET BUILDER</b><small>Ordinary sheet widgets · UMG-style designer</small></span></div>
          <label class="sduw-field sduw-grow"><span>Display Name</span><input data-setting="label" value="${esc(this.widget?.label||"Widget Builder")}"></label>
          <label class="sduw-field"><span>Widget ID</span><input value="${esc(this.widget?.id||"")}" readonly></label>
          <div class="sduw-toolbar-actions">
            <button type="button" data-action="graph" class="sduw-main-graph-button"><i class="fas fa-diagram-project"></i> SHEET BLUEPRINT — ALL WIDGETS</button>
            <button type="button" data-action="save" class="sdsw-save"><i class="fas fa-floppy-disk"></i> SAVE DESIGNER</button>
          </div>
        </div>
        <div class="sduw-toolbar-row sduw-toolbar-row-sub">
          <label class="sduw-field"><span>Canvas Mode</span><select data-setting="wbLayout"><option value="free" ${(this.widget?.wbLayout??"free")==="free"?"selected":""}>Free</option><option value="grid" ${this.widget?.wbLayout==="grid"?"selected":""}>Grid</option></select></label>
          <label class="sduw-field"><span>Canvas</span><span class="sduw-inline-inputs"><input type="number" data-setting="canvasW" value="${Number(this.widget?.canvasW)||0}" title="0 = fill"><span>×</span><input type="number" data-setting="canvasH" value="${Number(this.widget?.canvasH)||420}"></span></label>
          <label class="sduw-field"><span>Snap / Grid</span><span class="sduw-inline-inputs"><input type="number" data-setting="snap" value="${Number(this.widget?.snap)||4}"><input type="number" data-setting="gridSize" value="${Number(this.widget?.gridSize)||16}"></span></label>
          <label class="sduw-field"><span>Columns / Gap</span><span class="sduw-inline-inputs"><input type="number" data-setting="columns" value="${Number(this.widget?.columns)||3}"><input type="number" data-setting="gap" value="${Number(this.widget?.gap)||6}"></span></label>
          <div class="sduw-toolbar-actions"><button type="button" data-action="zoomOut"><i class="fas fa-magnifying-glass-minus"></i></button><span class="sduw-zoom-label">100%</span><button type="button" data-action="zoomIn"><i class="fas fa-magnifying-glass-plus"></i></button><button type="button" data-action="fit"><i class="fas fa-expand"></i></button></div>
        </div>
      </header>
      <section class="sduw-body">
        <aside class="sduw-left"><div class="sduw-panel-head"><i class="fas fa-shapes"></i> PALETTE</div><label class="sduw-search"><i class="fas fa-magnifying-glass"></i><input type="search" data-search placeholder="Search widgets"></label><div class="sduw-palette" data-region="palette"></div><div class="sduw-panel-head"><i class="fas fa-sitemap"></i> HIERARCHY</div><div class="sduw-hierarchy" data-region="hierarchy"></div></aside>
        <main class="sduw-center"><div class="sduw-canvas-wrap" data-region="canvas-wrap"><div class="sduw-canvas-scaler" data-region="scaler"><div class="sduw-canvas sdsw-canvas" data-region="canvas"></div></div></div><footer class="sduw-statusbar" data-region="status">Drag from Palette · Free mode follows the pointer · Select and press Delete · Logic lives in Sheet Blueprint</footer></main>
        <aside class="sduw-right"><div class="sduw-panel-head"><i class="fas fa-sliders"></i> DETAILS</div><div class="sduw-details" data-region="details"></div><div class="sduw-panel-head"><i class="fas fa-database"></i> DATABASE VARIABLES <button type="button" class="sduw-panel-add" data-action="createVariable" title="Create Database Variable" aria-label="Create Database Variable"><i class="fas fa-plus"></i></button></div><div class="sduw-variables" data-region="variables"></div></aside>
      </section>
    </div>`;
  }
  _replaceHTML(html,content){content.innerHTML=html;content.style.padding="0";}

  _onRender(){
    super._onRender?.(); const root=this.element;
    root.tabIndex=0;
    this._keyAbort?.abort();this._keyAbort=new AbortController();
    root.ownerDocument.addEventListener('keydown',event=>this._onDesignerKey(event),{signal:this._keyAbort.signal});
    root.addEventListener('pointerdown',()=>root.focus({preventScroll:true}),{signal:this._keyAbort.signal});
    this.regions={palette:root.querySelector('[data-region="palette"]'),hierarchy:root.querySelector('[data-region="hierarchy"]'),canvas:root.querySelector('[data-region="canvas"]'),wrap:root.querySelector('[data-region="canvas-wrap"]'),scaler:root.querySelector('[data-region="scaler"]'),details:root.querySelector('[data-region="details"]'),variables:root.querySelector('[data-region="variables"]'),zoom:root.querySelector('.sduw-zoom-label')};
    root.querySelectorAll('[data-setting]').forEach(input=>input.addEventListener('change',()=>{const key=input.dataset.setting;this.widget[key]=input.type==='number'?Number(input.value)||0:input.value;this._renderCanvas();}));
    root.querySelector('[data-action="graph"]')?.addEventListener('click',()=>this._openGraph());
    root.querySelector('[data-action="save"]')?.addEventListener('click',()=>this._save());
    root.querySelector('[data-action="zoomIn"]')?.addEventListener('click',()=>this._setZoom(this.zoom+.1));
    root.querySelector('[data-action="zoomOut"]')?.addEventListener('click',()=>this._setZoom(this.zoom-.1));
    root.querySelector('[data-action="fit"]')?.addEventListener('click',()=>this._fit());
    root.querySelector('[data-action="createVariable"]')?.addEventListener('click',()=>this._createVariable());
    root.querySelector('[data-search]')?.addEventListener('input',event=>this._renderPalette(event.target.value));
    this._renderPalette();this._renderHierarchy();this._renderCanvas();this._renderDetails();this._renderVariables();
  }

  _onDesignerKey(event){
    if(!['Delete','Backspace'].includes(event.key)||!this.selectedId)return;
    const target=event.target;
    if(target?.matches?.('input,textarea,select,[contenteditable="true"]')||target?.closest?.('input,textarea,select,[contenteditable="true"]'))return;
    const element=this.elements.find(entry=>entry.id===this.selectedId);if(!element)return;
    event.preventDefault();event.stopPropagation();
    this.elements=this.elements.filter(entry=>entry.id!==element.id);
    this.selectedId=this.elements[0]?.id??null;
    this._refresh();
  }

  async _onClose(options){this._keyAbort?.abort();this._keyAbort=null;return super._onClose?.(options);}

  _availableWidgets(){return getWidgetPaletteOrder().map(key=>WIDGET_TYPES[key]).filter(def=>def&&!BLOCKED.has(def.id));}
  _renderPalette(query=""){
    const q=String(query).trim().toLowerCase(); const list=this._availableWidgets().filter(def=>!q||`${def.label} ${def.id} ${def.desc||""}`.toLowerCase().includes(q));
    this.regions.palette.innerHTML=list.map(def=>`<button type="button" class="sduw-palette-item" draggable="true" data-widget-type="${esc(def.id)}"><i class="fas ${esc(def.icon||"fa-puzzle-piece")}"></i><span><b>${esc(def.label)}</b><small>${esc(def.desc||def.id)}</small></span></button>`).join("")||`<div class="sduw-empty">No widgets</div>`;
    this.regions.palette.querySelectorAll('[data-widget-type]').forEach(button=>{button.addEventListener('dragstart',event=>{event.dataTransfer.setData('text/plain',JSON.stringify({sdSheetDesigner:true,widgetType:button.dataset.widgetType}));event.dataTransfer.effectAllowed='copy';});button.addEventListener('dblclick',()=>this._addWidget(button.dataset.widgetType,24,24));});
  }

  _renderHierarchy(){
    const ordered=[...this.elements].sort((a,b)=>(Number(b.z)||0)-(Number(a.z)||0));
    this.regions.hierarchy.innerHTML=`<div class="sduw-tree-root"><i class="fas fa-object-group"></i> ${esc(this.widget?.label||"Widget Builder")}</div>`+ordered.map(element=>`<div class="sduw-tree-row ${element.id===this.selectedId?'is-selected':''}" data-element-id="${esc(element.id)}"><i class="fas ${esc(WIDGET_TYPES[element.widget?.type]?.icon||"fa-square")}"></i><span class="sduw-tree-name">${esc(element.name)}</span><span class="sduw-tree-type">${esc(element.widget?.type||element.kind)}</span><button type="button" class="sduw-tree-btn" data-tree-action="visibility"><i class="fas ${element.hidden?'fa-eye-slash':'fa-eye'}"></i></button><button type="button" class="sduw-tree-btn" data-tree-action="lock"><i class="fas ${element.locked?'fa-lock':'fa-lock-open'}"></i></button></div>`).join("");
    this.regions.hierarchy.querySelectorAll('[data-element-id]').forEach(row=>{row.addEventListener('click',event=>{const el=this.elements.find(x=>x.id===row.dataset.elementId);if(!el)return;const action=event.target.closest('[data-tree-action]')?.dataset.treeAction;if(action==='visibility')el.hidden=!el.hidden;else if(action==='lock')el.locked=!el.locked;this.selectedId=el.id;this._refresh();});});
  }

  _renderCanvas(){
    const free=(this.widget?.wbLayout??'free')!=='grid'; const canvas=this.regions.canvas; const grid=Math.max(4,Number(this.widget?.gridSize)||16);const h=Math.max(160,Number(this.widget?.canvasH)||420);const w=Number(this.widget?.canvasW)||0;
    canvas.style.cssText=`position:relative;${w>0?`width:${w}px;`:'width:100%;'}height:${h}px;min-width:300px;min-height:160px;--sduw-grid:${grid}px;`;
    canvas.innerHTML='';canvas.classList.toggle('is-grid-layout',!free);
    if(!free){canvas.style.display='grid';canvas.style.gridTemplateColumns=`repeat(${Math.max(1,Number(this.widget?.columns)||3)},minmax(0,1fr))`;canvas.style.gap=`${Math.max(0,Number(this.widget?.gap)||6)}px`;canvas.style.alignContent='start';canvas.style.padding='10px';}else{canvas.style.display='block';canvas.style.padding='0';}
    for(const element of [...this.elements].sort((a,b)=>(Number(a.z)||0)-(Number(b.z)||0))){const box=document.createElement('div');box.className=`sdsw-element ${element.id===this.selectedId?'is-selected':''} ${element.locked?'is-locked':''}`;box.dataset.elementId=element.id;if(free)box.style.cssText=`position:absolute;left:${element.x}px;top:${element.y}px;width:${element.w}px;height:${element.h}px;z-index:${element.z};`;else box.style.cssText=`position:relative;min-height:${element.h}px;order:${element.z};`;box.style.opacity=element.hidden?'.3':'1';box.innerHTML=this._elementHTML(element)+`<span class="sdsw-element-caption">${esc(element.name)}</span>${free&&!element.locked?'<i class="sdsw-resize"></i>':''}`;box.addEventListener('pointerdown',event=>this._pointerDown(event,element,box));box.addEventListener('click',event=>{event.stopPropagation();this.selectedId=element.id;this._refresh();});box.draggable=!free&&!element.locked;box.addEventListener('dragstart',event=>event.dataTransfer.setData('text/plain',JSON.stringify({sdSheetDesignerMove:true,id:element.id})));box.addEventListener('dragover',event=>event.preventDefault());box.addEventListener('drop',event=>{event.preventDefault();let data={};try{data=JSON.parse(event.dataTransfer.getData('text/plain'));}catch{}if(data.sdSheetDesignerMove)this._reorder(data.id,element.id);});canvas.appendChild(box);}
    canvas.addEventListener('pointerdown',event=>{if(event.target===canvas){this.selectedId=null;this._refresh();}});canvas.addEventListener('dragover',event=>{event.preventDefault();event.dataTransfer.dropEffect='copy';});canvas.addEventListener('drop',event=>{event.preventDefault();let data={};try{data=JSON.parse(event.dataTransfer.getData('text/plain'));}catch{}if(!data.sdSheetDesigner||!data.widgetType)return;const rect=canvas.getBoundingClientRect();this._addWidget(data.widgetType,Math.max(0,(event.clientX-rect.left)/this.zoom),Math.max(0,(event.clientY-rect.top)/this.zoom));});this._applyZoom();
  }

  _elementHTML(element){if(element.widget){try{return `<div class="sdsw-widget-preview">${WidgetRenderer.render(element.widget,this.doc,{isEditMode:true})}</div>`;}catch{return `<div class="sdsw-widget-preview"><i class="fas fa-puzzle-piece"></i> ${esc(element.widget.type)}</div>`;}}if(element.img)return `<img src="${esc(element.img)}" alt="">`;return `<div class="sdsw-primitive" style="color:${esc(element.color||'inherit')}"><i class="fas ${esc(element.icon||'fa-font')}"></i>${esc(element.label||element.name)}</div>`;}
  _snap(value){const step=Math.max(0,Number(this.widget?.snap)||0);return step?Math.round(value/step)*step:Math.round(value);}
  _pointerDown(event,element,box){if(element.locked||this.widget?.wbLayout==='grid')return;const resize=event.target.closest('.sdsw-resize');if(event.button!==0)return;event.preventDefault();event.stopPropagation();this.selectedId=element.id;const startX=event.clientX,startY=event.clientY,ox=element.x,oy=element.y,ow=element.w,oh=element.h;const canvasRect=this.regions.canvas.getBoundingClientRect();const move=ev=>{const dx=(ev.clientX-startX)/this.zoom,dy=(ev.clientY-startY)/this.zoom;if(resize){element.w=Math.max(36,this._snap(ow+dx));element.h=Math.max(24,this._snap(oh+dy));box.style.width=`${element.w}px`;box.style.height=`${element.h}px`;}else{element.x=Math.max(0,this._snap(ox+dx));element.y=Math.max(0,this._snap(oy+dy));box.style.left=`${element.x}px`;box.style.top=`${element.y}px`;}};const up=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);this._renderHierarchy();this._renderDetails();};window.addEventListener('pointermove',move);window.addEventListener('pointerup',up);}
  _addWidget(type,x=0,y=0){const def=WIDGET_TYPES[type];if(!def||BLOCKED.has(type))return;const widget=ensureWidgetVariables(assignUniqueWidgetDataPaths(createWidget(type),this.doc,{additionalWidgets:this.elements.map(e=>e.widget).filter(Boolean)}),this.doc);const element=normalizeElement({id:id(),name:`${def.label} ${this.elements.length+1}`,kind:'widget',widget,x:this._snap(x),y:this._snap(y),w:180,h:76,z:Math.max(-1,...this.elements.map(e=>Number(e.z)||0))+1},this.elements.length);this.elements.push(element);this.selectedId=element.id;this._refresh();}
  _reorder(fromId,toId){const from=this.elements.findIndex(e=>e.id===fromId),to=this.elements.findIndex(e=>e.id===toId);if(from<0||to<0||from===to)return;const [entry]=this.elements.splice(from,1);this.elements.splice(to,0,entry);this.elements.forEach((e,i)=>e.z=i);this._refresh();}

  _renderDetails(){const element=this.elements.find(e=>e.id===this.selectedId);if(!element){this.regions.details.innerHTML='<div class="sduw-empty">Select a widget on the canvas.</div>';return;}const widget=element.widget;const def=WIDGET_TYPES[widget?.type];if(widget)ensureWidgetVariables(widget,this.doc);this.regions.details.innerHTML=`<div class="sdsw-details-grid"><label>Name<input data-detail="name" value="${esc(element.name)}"></label><label>Element ID<input value="${esc(element.id)}" readonly></label><div class="sdsw-xy"><label>X<input type="number" data-detail="x" value="${element.x}"></label><label>Y<input type="number" data-detail="y" value="${element.y}"></label><label>W<input type="number" data-detail="w" value="${element.w}"></label><label>H<input type="number" data-detail="h" value="${element.h}"></label></div>${widget?`<label>Widget Type<input value="${esc(def?.label||widget.type)}" readonly></label><label>Display Name<input data-widget-detail="label" value="${esc(widget.label||'')}"></label><label>Widget ID<input value="${esc(widget.id||'') }" readonly></label>${this._widgetVarFields(widget)}<button type="button" data-detail-action="configure"><i class="fas fa-gear"></i> Widget Properties</button>`:''}<div class="sdsw-detail-actions"><button type="button" data-detail-action="front"><i class="fas fa-arrow-up"></i> Front</button><button type="button" data-detail-action="back"><i class="fas fa-arrow-down"></i> Back</button><button type="button" class="danger" data-detail-action="delete"><i class="fas fa-trash"></i> Delete</button></div></div>`;
    this.regions.details.querySelectorAll('[data-detail]').forEach(input=>input.addEventListener('input',()=>{const key=input.dataset.detail;element[key]=key==='name'?input.value:Number(input.value)||0;this._renderCanvas();this._renderHierarchy();}));this.regions.details.querySelectorAll('[data-widget-detail]').forEach(input=>input.addEventListener('change',()=>{widget[input.dataset.widgetDetail]=input.value;this._renderCanvas();this._renderHierarchy();}));this.regions.details.querySelectorAll('[data-widget-var]').forEach(input=>input.addEventListener('change',async()=>{const field=input.dataset.widgetVar;const descriptor=(widgetVariables(widget)??[]).find(entry=>entry.field===field);const value=coerceWidgetValue(input.type==='checkbox'?input.checked:input.value,descriptor?.type??'text');await this._writeWidgetVar(widget,field,value);this._renderCanvas();}));this.regions.details.querySelectorAll('[data-detail-action]').forEach(button=>button.addEventListener('click',()=>this._detailAction(button.dataset.detailAction,element)));}
  _widgetVarFields(widget){
    const vars=widgetVariables(widget)??[];
    if(!vars.length)return '<div class="sdsw-var-note">This widget has no editable value. Drive it from its Blueprint node.</div>';
    return `<div class="sdsw-var-block"><span class="sdsw-var-head"><i class="fas fa-cube"></i> WIDGET VALUES</span>${vars.map(entry=>{
      const stored=this.doc?foundry.utils.getProperty(this.doc,widgetVarPath(widget,entry.field)):undefined;
      const current=stored!==undefined?stored:(widget.varDefaults?.[entry.field]??entry.initial);
      if(entry.type==='boolean')return `<label class="sdsw-var-row">${esc(entry.label)}<input type="checkbox" data-widget-var="${esc(entry.field)}" ${current?'checked':''}></label>`;
      const shown=Array.isArray(current)?current.join(', '):current;
      return `<label class="sdsw-var-row">${esc(entry.label)}<input type="${entry.type==='number'?'number':'text'}" ${entry.type==='number'?'step="any"':''} data-widget-var="${esc(entry.field)}" value="${esc(shown)}"></label>`;
    }).join('')}<small>Owned by this widget. Nodes can read and write the same value.</small></div>`;
  }

  async _writeWidgetVar(widget,field,value){
    widget.varDefaults={...(widget.varDefaults??{}),[field]:value};
    widget[field]=widgetVarPath(widget,field);
    try{await this.doc?.update?.({[widgetVarPath(widget,field)]:value});}catch(error){console.warn('[sd] widget value write failed',error);}
  }

  async _detailAction(action,element){if(action==='delete'){this.elements=this.elements.filter(e=>e.id!==element.id);this.selectedId=this.elements[0]?.id??null;this._refresh();return;}if(action==='front')element.z=Math.max(0,...this.elements.map(e=>Number(e.z)||0))+1;if(action==='back')element.z=Math.min(0,...this.elements.map(e=>Number(e.z)||0))-1;if(action==='configure'&&element.widget){const {openWidgetConfigPopup}=await import('./widget-config-popup.mjs');await openWidgetConfigPopup(element.widget,this.tab,this.row,this.doc,{embedded:true,onSave:updated=>{element.widget=updated;this._refresh();}});return;}this._refresh();}
  _renderVariables(){const scope=this.doc?.documentName==='Item'?'item':'actor';const defs=getValueDefinitions().filter(v=>v.scope==='both'||v.scope===scope);this.regions.variables.innerHTML=defs.map(v=>`<div class="sdsw-variable" draggable="true" data-variable-id="${esc(v.id)}"><i class="fas fa-cube"></i><span><b>${esc(v.name)}</b><small>${esc(v.id)}</small></span><em>${esc(v.type)}</em></div>`).join('')||'<div class="sduw-empty">Press + to create a typed Database variable.</div>';this.regions.variables.querySelectorAll('[data-variable-id]').forEach(row=>row.addEventListener('dragstart',event=>{event.dataTransfer.setData('text/plain',JSON.stringify({sdType:'path',path:row.dataset.variableId}));event.dataTransfer.effectAllowed='copy';}));}
  async _createVariable(){const scope=this.doc?.documentName==='Item'?'item':'actor';const created=await createDatabaseVariable({scope});if(created)this._renderVariables();}
  _refresh(){this._renderHierarchy();this._renderCanvas();this._renderDetails();}
  _setZoom(value){this.zoom=Math.max(.35,Math.min(2,Number(value)||1));this._applyZoom();}
  _applyZoom(){if(!this.regions?.scaler)return;this.regions.scaler.style.transform=`scale(${this.zoom})`;this.regions.scaler.style.transformOrigin='0 0';if(this.regions.zoom)this.regions.zoom.textContent=`${Math.round(this.zoom*100)}%`;}
  _fit(){const wrap=this.regions.wrap,canvas=this.regions.canvas;if(!wrap||!canvas)return;this._setZoom(Math.min(1,(wrap.clientWidth-40)/Math.max(320,canvas.scrollWidth),(wrap.clientHeight-40)/Math.max(180,canvas.scrollHeight)));}
  async _openGraph(){const {FormulaGraph}=await import('./formula-graph.mjs');new FormulaGraph(null,this.doc,null,null,null,{mode:'sheetTrigger'}).open();}
  async _save(){this.widget.elements=this.elements.map(e=>clone(e));const tabs=clone(this.doc?.system?.customTabs??[]);const target=findWidgetDeep(tabs.flatMap(t=>(t.rows??[]).flatMap(r=>r.widgets??[])),this.widget.id);if(target)Object.assign(target,clone(this.widget));if(target&&this.doc?.update)await this.doc.update({'system.customTabs':tabs,...buildWidgetPathRegistryUpdate(this.doc,tabs)});this.onSave?.(clone(this.widget));ui.notifications?.info?.(`Widget Builder “${this.widget.label||this.widget.id}” saved.`);}
}

export function openSheetWidgetDesigner(options={}){return SheetWidgetDesigner.open(options);}
