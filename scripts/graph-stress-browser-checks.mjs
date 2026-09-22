import {fixture,pause} from './graph-render-test-support.mjs';
import {FormulaGraph} from '../module/builder/formula-graph.mjs';
const frame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
const stats=values=>{values.sort((a,b)=>a-b);return {medianMs:+values[Math.floor(values.length*.5)].toFixed(2),p95Ms:+values[Math.floor(values.length*.95)].toFixed(2)};};
export async function stressBenchmark(count){
 const g=fixture(FormulaGraph,count);g._zoom=.65;
 const columns=Math.ceil(Math.sqrt(count));
 for(let i=0;i<count;i++){g.nodes[i].x=(i%columns)*600;g.nodes[i].y=Math.floor(i/columns)*260;}
 const start=performance.now();g._renderAll();await frame();await frame();const openingMs=performance.now()-start;
 const mounted=g.nodesEl.childElementCount,domElements=g.nodesEl.querySelectorAll('*').length;
 const scenarios={};
 for(const mode of ['pan','zoom','drag']){
  const work=[],intervals=[],slowFrames=[];let last=await frame();
  for(let i=0;i<36;i++){
   const t=performance.now();
   if(mode==='pan')g._pan={x:20-i*12,y:25-i*4};
   if(mode==='zoom')g._zoom=.3+(i%12)*.035;
   if(mode==='drag'){g.nodes[1].x+=3;g._getGraphView().moveNode(g.nodes[1]);}
   g._applyTransform();g._redrawEdges();const elapsed=performance.now()-t;work.push(elapsed);
   if(elapsed>12)slowFrames.push({step:i,ms:+elapsed.toFixed(1),mounted:g.nodesEl.childElementCount,cached:g._getGraphView().detachedElements?.size??0});
   const now=await frame();intervals.push(now-last);last=now;
  }
  scenarios[mode]={work:stats(work),frameIntervals:stats(intervals),slowFrames};
 }
 const result={nodes:count,edges:g.edges.length,openingMs:+openingMs.toFixed(2),mountedNodes:mounted,domElements,scenarios};
 g.close();await pause();return result;
}
