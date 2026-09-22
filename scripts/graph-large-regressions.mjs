import {fixture,assert,checkPins,checkWires,pause} from './graph-render-test-support.mjs';
import {FormulaGraph,NODE_DEFS,SD_NODE_REGISTRY} from '../module/builder/formula-graph.mjs';

export async function largeRegressions(){
 const checks=[],g=fixture(FormulaGraph,10000);g._zoom=.65;
 for(let i=0;i<g.nodes.length;i++){g.nodes[i].x=i%100*600;g.nodes[i].y=Math.floor(i/100)*260;}
 g._renderAll();await pause();g._redrawEdges();const v=g._getGraphView();
 assert(v.elements.size<100,'10k graph mounted all nodes');checkPins(g);checkWires(g);
 const original=v.elements.get('n0'),input=original.querySelector('input[type=number]');
 input.value='123';input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();
 g._pan={x:-30000,y:-12000};g._applyTransform();g._redrawEdges();
 assert(v.elements.get('n0')===original&&document.activeElement===input,'Virtualization lost focused input');input.blur();g._redrawEdges();
 assert(!v.elements.has('n0'),'Offscreen node remains mounted after blur');
 g._debugFocus('n0');g._redrawEdges();assert(v.elements.get('n0').querySelector('input').value==='123','Pan back lost field data');
 checkPins(g);checkWires(g);checks.push('10k viewport, precise wires, focus retention, navigation and restored inputs');
 for(let i=0;i<20;i++){g._pan={x:-i*2000,y:-i*900};g._applyTransform();g._redrawEdges();}
 assert(v.detachedElements.size<=256&&v.elements.size<200,'Viewport caches grew without bound');
 g._debugFocus('n5000');g._redrawEdges();checkPins(g);checkWires(g);
 g._pushHistory();const saved=g.nodes[5000].x;g.nodes[5000].x+=90;v.moveNode(g.nodes[5000]);g._redrawEdges();g._pushHistory();g._undo();
 assert(g._nodeById('n5000').x===saved,'Virtualized undo failed');g._redo();assert(g._nodeById('n5000').x===saved+90,'Virtualized redo failed');
 checks.push('Bounded DOM cache, distant navigation and 10k undo/redo');
 g._zoom=.15;g._debugFocus('n5050');g._redrawEdges();
 assert(v.elements.size>0&&v.elements.size<1000,'Minimum zoom must show nodes without retaining most of the 10k graph');checkPins(g);checkWires(g);
 checks.push('Minimum supported zoom keeps bounded DOM and exact wires');
 globalThis.graphPerformancePreview=g.win.cloneNode(true);document.body.append(graphPerformancePreview);
 // A wire crossing the viewport must stay visible with BOTH nodes unmounted.
 g.nodes=[{id:'left',type:'literal',x:-3000,y:200,data:{value:1}},{id:'right',type:'literal',x:4000,y:200,data:{value:2}},...Array.from({length:128},(_,i)=>({id:`far${i}`,type:'literal',x:20000+i*500,y:20000,data:{value:i}}))];
 g.edges=[{id:'cross',fromNode:'left',fromPin:'v',toNode:'right',toPin:'in'}];g._zoom=1;g._pan={x:0,y:0};g._renderAll();
 assert(v.paths.has('cross')&&!v.paths.get('cross').hidden,'Crossing wire disappeared');checkWires(g);
 const leftNode=g.nodes[0];leftNode.type='sequence';leftNode.data={count:5};g._renderNode(leftNode);g._redrawEdges();
 g._debugFocus('left');g._redrawEdges();assert(v.elements.get('left').querySelectorAll('.gpin[data-side=output]').length===5,'Offscreen dynamic pins became stale');
 checks.push('Crossing wires and offscreen dynamic pin changes');
 g.nodes=g.nodes.slice(0,2);g.edges=[];g._redrawEdges();assert(g.nodes.every(n=>v.elements.has(n.id)),'Shrinking below virtualization threshold lost nodes');
 g.close();assert(v.detachedElements.size===0&&v.elements.size===0,'Close leaked detached cache');checks.push('Threshold changes and disposal');

 const panelGraph=fixture(FormulaGraph,1),panel=document.createElement('div');panel.id='gvarpanel';panelGraph.win.append(panel);
 panelGraph.nodes.push({id:'variable',type:'var_read',x:20000,y:0,data:{name:'score',scope:'local'}});panelGraph._renderAll();
 const row=panel.querySelector('.gvar-row');panelGraph.nodes[0].data.value=99;panelGraph._updatePreview();assert(panel.querySelector('.gvar-row')===row,'Unrelated input rebuilt variables panel');
 panelGraph.nodes[1].data.name='renamed';panelGraph._updatePreview();assert(panel.querySelector('.gvar-row').dataset.varName==='renamed','Panel cache hid a variable rename');panelGraph.close();
 checks.push('Variables panel reuse with correct invalidation');

 const c=Object.create(FormulaGraph.prototype);c.nodes=Array.from({length:10000},(_,i)=>({id:`n${i}`,type:'literal',data:{value:7}}));
 c.edges=Array.from({length:9999},(_,i)=>({fromNode:`n${i}`,fromPin:'v',toNode:`n${i+1}`,toPin:'in'}));
 c.nodes.push({id:'out',type:'output',data:{}});c.edges.push({fromNode:'n9999',fromPin:'v',toNode:'out',toPin:'value'});
 let t=performance.now();assert(c.compile()==='7','10k value chain failed');const valueCompileMs=+(performance.now()-t).toFixed(2);
 c.edges.push({fromNode:'n9999',fromPin:'v',toNode:'n0',toPin:'in'});assert(c.compile()==='0','10k cyclic chain failed');
 SD_NODE_REGISTRY.registerNode('qa_long_action',{title:'QA action',cat:'Actions',isAction:true,inputs:[{id:'exec',type:'exec'}],outputs:[{id:'exec',type:'exec'}],fields:[],toAction:n=>({type:'qa_long_action',id:n.id})},{owner:'qa'});
 c.nodes=Array.from({length:10000},(_,i)=>({id:`n${i}`,type:'qa_long_action',data:{}}));c.nodes.unshift({id:'start',type:'on_click',data:{}});
 c.edges=Array.from({length:10000},(_,i)=>({fromNode:i?`n${i-1}`:'start',fromPin:'exec',toNode:`n${i}`,toPin:'exec'}));
 t=performance.now();assert(JSON.parse(c.compile()).actions.length===10000,'10k exec chain failed');const execCompileMs=+(performance.now()-t).toFixed(2);
 checks.push('10k value/exec chains without stack overflow and cyclic value termination');
 const reference=(node,vis=new Set())=>{
  if(vis.has(node.id))return '0';const next=new Set(vis);next.add(node.id);const ins={};
  for(const pin of NODE_DEFS[node.type].inputs??[]){const edge=c.edges.findLast(e=>e.toNode===node.id&&e.toPin===pin.id);if(edge)ins[pin.id]=reference(c.nodes.find(n=>n.id===edge.fromNode),next);}
  return NODE_DEFS[node.type].compile(node,ins);
 };
 for(let seed=0;seed<40;seed++){
  c.nodes=Array.from({length:12},(_,i)=>({id:`r${i}`,type:i%3?'add':'literal',data:{value:i}}));c.edges=[];
  for(let i=0;i<12;i++)for(const [j,pin] of (NODE_DEFS[c.nodes[i].type].inputs??[]).entries())if((i+seed+j)%3)c.edges.push({fromNode:`r${(i*7+seed+j)%12}`,fromPin:'v',toNode:`r${i}`,toPin:pin.id});
  assert(c._compileValue(c.nodes[11],new Set(),'v')===reference(c.nodes[11]),`Compiler equivalence failed for seed ${seed}`);
 }
 checks.push('Reference compiler equivalence on shared subgraphs and cycles');
 return {checks,valueCompileMs,execCompileMs};
}
