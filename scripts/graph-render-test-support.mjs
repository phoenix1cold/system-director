// Browser harness: stub document services, but use real graph DOM/CSS/SVG.
globalThis.Actor=class Actor{}; globalThis.Item=class Item{};
globalThis.Hooks={once(){},on(){},callAll(){}};
globalThis.foundry={utils:{getProperty:(o,p)=>String(p??'').split('.').reduce((v,k)=>v?.[k],o),
  setProperty(o,p,v){const ks=p.split('.'),last=ks.pop();for(const k of ks)o=o[k]??={};o[last]=v;},
  deepClone:v=>structuredClone(v),randomID:()=>Math.random().toString(36).slice(2,10)}};
globalThis.game={user:{targets:new Set()},users:{contents:[]},actors:{contents:[]},items:{contents:[]},
  settings:{get:(_,k)=>k==='nodeGraphLanguage'?'en':undefined},i18n:{localize:k=>k,has:()=>false,format:k=>k}};
globalThis.canvas={tokens:{controlled:[],placeables:[]}};globalThis.fromUuidSync=()=>null;
globalThis.fetch=async()=>({ok:false,json:async()=>({})});
globalThis.ui={notifications:{info(){},warn(){},error(){}}};Math.clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
export const assert=(ok,msg)=>{if(!ok)throw Error(msg);};
export const pause=(ms=80)=>new Promise(r=>setTimeout(r,ms));
export function finish(data){document.getElementById('result').textContent=JSON.stringify(data,null,2);document.title=data.status;}
export function fixture(FormulaGraph,count=6,schedule=false){
 const g=Object.create(FormulaGraph.prototype),win=document.createElement('div');
 win.className='sd sd-formula-graph sd-formula-graph-host';win.style.cssText='width:1100px;height:720px;position:relative';
 win.innerHTML=`<div id="gpreview"></div><div id="gmode-badge"></div><div id="gwrap" style="width:1100px;height:680px;position:relative;overflow:hidden;touch-action:none">
 <svg id="gedges" style="position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none"><defs></defs></svg>
 <div id="gcomments" style="position:absolute;left:0;top:0;transform-origin:0 0"></div>
 <div id="gnodes" style="position:absolute;left:0;top:0;transform-origin:0 0;will-change:transform"></div></div>`;
 document.body.appendChild(win);
 Object.assign(g,{win,edgeSVG:win.querySelector('#gedges'),nodesEl:win.querySelector('#gnodes'),commentsEl:win.querySelector('#gcomments'),nodes:[],edges:[],comments:[],
 _selected:new Set(),_selectedComments:new Set(),_pan:{x:20.25,y:25.5},_zoom:.65,_cleanup:[],_history:[],_historyIdx:-1,_id:count+2,
 _previewTimer:null,_smartIndex:{},_drag:null,_panDrag:null,doc:null,widget:null,configMode:false,customLoad:null,customSave:null});
 if(!schedule)g._scheduleEdges=()=>{};
 for(let i=0;i<count;i++)g.nodes.push({id:`n${i}`,type:'literal',x:(i%10)*515,y:Math.floor(i/10)*185,data:{value:i}});
 for(let i=0;i<count-1;i++)g.edges.push({id:`e${i}`,fromNode:`n${i}`,fromPin:'v',toNode:`n${i+1}`,toPin:'in'});
 return g;
}
export function checkPins(g){
 const origin=g.edgeSVG.getBoundingClientRect();
 for(const el of g.nodesEl.children)for(const pin of el.querySelectorAll('.gpin')){
  const r=pin.getBoundingClientRect(),p=g._pinScreen(pin.dataset.nid,pin.dataset.pid,pin.dataset.side);
  assert(p,`Missing pin ${pin.dataset.nid}/${pin.dataset.pid}`);
  assert(Math.abs(p.x-r.left-r.width/2+origin.left)<.7,'pin x mismatch');
  assert(Math.abs(p.y-r.top-r.height/2+origin.top)<.7,'pin y mismatch');
 }
}
export function checkWires(g){
 const view=g._getGraphView(),expected=document.createElementNS('http://www.w3.org/2000/svg','path');
 for(const edge of g.edges){
  const slot=view.paths.get(String(edge.id));if(!slot||slot.hidden)continue;
  const a=g._pinScreen(edge.fromNode,edge.fromPin,'output'),b=g._pinScreen(edge.toNode,edge.toPin,'input');
  expected.setAttribute('d',g._bez(a,b));
  // Compare all cubic control points, not getPointAtLength's approximate
  // tessellation: Chromium's arc-length sampling drifts on very long loops.
  const numbers=path=>path.getAttribute('d').match(/[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi).map(Number);
  const want=numbers(expected),actual=numbers(slot.path),transform=slot.path.parentNode.transform.baseVal.consolidate()?.matrix;
  assert(want.length===8&&actual.length===8,'Invalid cubic path');
  for(let i=0;i<8;i+=2){const p=new DOMPoint(actual[i],actual[i+1]),q=transform?p.matrixTransform(transform):p;
   assert(Math.hypot(want[i]-q.x,want[i+1]-q.y)<.01,`Wire control point changed: ${edge.id}`);}
  assert(slot.hit.getAttribute('d')===slot.path.getAttribute('d'),'Hit path differs from visible curve');
  assert(slot.hit.getAttribute('stroke-width')==='14','Wire hit target changed');
 }
}
export function benchmark(Type,count,label,frames=12){
 const g=fixture(Type,count);g._zoom=.15;
 const start=performance.now();g._renderAll();g.edgeSVG.getBoundingClientRect();const initial=performance.now()-start;
 for(let i=0;i<2;i++){g._pan.x+=3;g._applyTransform();g._redrawEdges();}
 let reads=0,creates=0,pathWrites=0;const rect=Element.prototype.getBoundingClientRect,create=document.createElementNS,setAttribute=Element.prototype.setAttribute;
 Element.prototype.setAttribute=function(name,value){if(this.tagName==='path'&&name==='d')pathWrites++;return setAttribute.call(this,name,value);};
 Element.prototype.getBoundingClientRect=function(){reads++;return rect.call(this);};
 document.createElementNS=function(...a){creates++;return create.apply(this,a);};
 const samples=[];
 try{for(let i=0;i<frames;i++){
  g._pan.x=20.25+i%6*7;g._pan.y=25.5+i%4*3;
  const t=performance.now();g._applyTransform();g._redrawEdges();g.edgeSVG.getBoundingClientRect();samples.push(performance.now()-t);
 }}finally{Element.prototype.getBoundingClientRect=rect;document.createElementNS=create;Element.prototype.setAttribute=setAttribute;}
 samples.sort((a,b)=>a-b);
 const metrics={label,nodes:count,edges:g.edges.length,frames,initialRenderMs:+initial.toFixed(2),medianFrameMs:+samples[Math.floor(samples.length/2)].toFixed(2),
 p95FrameMs:+samples[Math.floor(samples.length*.95)].toFixed(2),rectReads:reads,svgElementsCreated:creates,pathWrites};
 g.close();return metrics;
}
