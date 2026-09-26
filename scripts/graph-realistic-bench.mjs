// Realistic benchmark: mixed real node types, zoomed out so most nodes are on screen.
import {fixture} from './graph-render-test-support.mjs';
import {FormulaGraph, NODE_DEFS} from '../module/builder/formula-graph.mjs';
const frame=()=>new Promise(r=>requestAnimationFrame(r));
const stats=v=>{v.sort((a,b)=>a-b);return {median:+v[Math.floor(v.length*.5)].toFixed(2),p95:+v[Math.floor(v.length*.95)].toFixed(2)};};
export async function realisticBenchmark(count,zoom=.3){
 const types=['add','mul','eq','branch','sequence','get_value','literal','literal_str','act_modify','act_damage','act_effect','arr_filter','for_each_target','act_chat','var_read','switch_node','clamp','ternary','act_add_item','act_delay'].filter(t=>NODE_DEFS[t]);
 const g=fixture(FormulaGraph,0);g._zoom=zoom;g._pan={x:10,y:10};g._disableLod=!!globalThis.__sdDisableLod;try{g._smartIndex=g._buildSmartIndex();}catch{g._smartIndex={effects:[],ownedItems:[],paths:[],attrs:[],skills:[]};}
 const cols=Math.ceil(Math.sqrt(count*1.6));
 for(let i=0;i<count;i++){const type=types[i%types.length];g.nodes.push({id:`n${i}`,type,x:(i%cols)*560,y:Math.floor(i/cols)*300,data:{}});}
 for(let i=0;i<count-1;i++){const a=NODE_DEFS[g.nodes[i].type],b=NODE_DEFS[g.nodes[i+1].type];const o=a.outputs?.[0],p=b.inputs?.[0];if(o&&p)g.edges.push({id:`e${i}`,fromNode:`n${i}`,fromPin:o.id,toNode:`n${i+1}`,toPin:p.id});}
 let t=performance.now();g._renderAll();await frame();await frame();const openingMs=+(performance.now()-t).toFixed(1);
 const mounted=g.nodesEl.childElementCount,dom=g.nodesEl.querySelectorAll('*').length;
 const out={nodes:count,zoom,openingMs,mounted,domElements:dom,domPerNode:+(dom/Math.max(1,mounted)).toFixed(1)};
 for(const mode of ['pan','zoom','zoomLod','drag']){const work=[],iv=[];let last=await frame();
  for(let i=0;i<30;i++){const s=performance.now();
   if(mode==='pan')g._pan={x:10-i*9,y:10-i*3};
   if(mode==='zoom')g._zoom=zoom*(0.8+(i%10)*.05);
   if(mode==='zoomLod')g._zoom=(i%2?0.3:0.6);
   if(mode==='drag'){g.nodes[3].x+=4;g._getGraphView().moveNode(g.nodes[3]);}
   g._applyTransform();g._redrawEdges();work.push(performance.now()-s);const now=await frame();iv.push(now-last);last=now;}
  out[mode]={work:stats(work),frame:stats(iv)};}
 t=performance.now();g.compile();out.compileMs=+(performance.now()-t).toFixed(1);
 t=performance.now();g._updatePreview();out.updatePreviewMs=+(performance.now()-t).toFixed(1);
 t=performance.now();g._renderAll();out.rerenderAllMs=+(performance.now()-t).toFixed(1);
 g.close();return out;
}
export async function withStyle(css,fn){const s=document.createElement('style');s.textContent=css;document.head.appendChild(s);try{return await fn();}finally{s.remove();}}
