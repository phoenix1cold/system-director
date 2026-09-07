// Serve the system folder over localhost and open test-graph-render-browser.html.
import {fixture,assert,checkPins,pause,finish} from './graph-render-test-support.mjs';
import {FormulaGraph} from '../module/builder/formula-graph.mjs';
import {graphEdgeVisible} from '../module/builder/graph-render-view.mjs';
const checks=[];
try{
 const g=fixture(FormulaGraph);g._renderAll();checkPins(g);const v=g._getGraphView();
 checks.push('Real node DOM, fractional coordinates and borders');
 const hit=g.edgeSVG.querySelector('[data-eid="e0"]');assert(hit,'Missing hit target');
 for(const z of [.15,.75,1,2.6]){g._zoom=z;g._pan={x:-37.25,y:33.125};g._applyTransform();g._redrawEdges();checkPins(g);}
 g._zoom=.65;g._pan={x:20.25,y:25.5};g._applyTransform();g._redrawEdges();
 assert(g.edgeSVG.querySelector('[data-eid="e0"]')===hit,'SVG paths rebuilt');checks.push('Pan/zoom alignment and stable SVG identities');
 let reads=0;const rect=Element.prototype.getBoundingClientRect;
 Element.prototype.getBoundingClientRect=function(){reads++;return rect.call(this);};
 try{for(let i=0;i<12;i++){g._pan.x+=.5;g._applyTransform();g._redrawEdges();}}finally{Element.prototype.getBoundingClientRect=rect;}
 assert(reads===0,`Warm pan made ${reads} rect reads`);checks.push('Warm pan: zero node/pin rectangle reads');
 const a=g.nodes[0],b=g.nodes[1],x=a.x;
 g._drag={nodeId:a.id,mx:100,my:100,ox:a.x,oy:a.y,group:[{id:a.id,ox:a.x,oy:a.y},{id:b.id,ox:b.x,oy:b.y}]};
 g._doDrag({clientX:139,clientY:119.5});assert(a.x===x+60,'Drag model not updated');g._redrawEdges();checkPins(g);g._drag=null;checks.push('Group dragging and final model coordinates');
 const seq={id:'seq',type:'sequence',x:50,y:200,data:{count:2}};g.nodes.push(seq);g._renderNode(seq);g._redrawEdges();
 assert(v.elements.get('seq').querySelectorAll('.gpin[data-side="output"]').length===2,'Sequence needs two pins');
 seq.data.count=5;g._renderNode(seq);g._redrawEdges();assert(v.elements.get('seq').querySelectorAll('.gpin[data-side="output"]').length===5,'Dynamic pins not updated');checkPins(g);checks.push('Dynamic sockets and node replacement');
 g._pushHistory();const saved=a.x;a.x+=150;v.moveNode(a);g._redrawEdges();g._pushHistory();g._undo();
 assert(g._nodeById('n0')!==a&&g._nodeById('n0').x===saved,'Undo stale cache');checkPins(g);
 g._redo();assert(g._nodeById('n0').x===saved+150,'Redo stale cache');checkPins(g);checks.push('Undo/Redo with unchanged IDs and node count');
 g._startConn('n0','v',false,{},'value.number');const line=g._conn.line;g._doConn({clientX:600,clientY:350});g._redrawEdges();
 assert(line.isConnected&&line.getAttribute('d'),'Connection preview lost');line.remove();g._conn=null;g._pendingConnectionPoint=null;checks.push('Connection preview survives redraw');
 const len=g.edges.length;g.edgeSVG.querySelector('[data-eid="e0"]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));g._redrawEdges();
 assert(g.edges.length===len-1&&!v.paths.has('e0'),'Edge deletion or cache cleanup failed');checks.push('Double-click disconnect and pool cleanup');
 assert(graphEdgeVisible({x:2200,y:30},{x:1170,y:60},1000,680),'Backwards loop wrongly culled');
 assert(!graphEdgeVisible({x:3000,y:30},{x:3300,y:60},1000,680),'Offscreen link not culled');
 g._pan={x:-90000,y:0};g._applyTransform();g._redrawEdges();assert([...v.geometry.values()].every(box=>box.hidden),'Node culling failed');
 g._pan={x:20,y:20};g._applyTransform();g._redrawEdges();assert(!v.geometry.get('n0').hidden,'Node not restored');checkPins(g);checks.push('Culling preserves crossing/backwards wires and restores nodes');
 const node=v.elements.get('n0'),spacer=document.createElement('div');spacer.style.height='27.25px';node.querySelector('.gnbody').prepend(spacer);
 g._redrawEdges();checkPins(g);checks.push('DOM mutation invalidates socket geometry');
 await pause();g._redrawEdges();node.style.width='590px';await pause(100);g._redrawEdges();checkPins(g);checks.push('Real ResizeObserver corrects CSS-only resizing');
 const frame=document.createElement('iframe');frame.style.cssText='width:1140px;height:780px';document.body.appendChild(frame);const other=frame.contentDocument;
 for(const s of document.querySelectorAll('style'))other.head.appendChild(s.cloneNode(true));other.body.appendChild(other.adoptNode(g.win));
 v.syncDocument();g._redrawEdges();checkPins(g);assert(g._uiWindow()===other.defaultView&&v.doc===other,'Wrong detached document');
 document.body.appendChild(document.adoptNode(g.win));v.syncDocument();g._redrawEdges();checkPins(g);frame.remove();checks.push('Detach/reattach and observer rebinding');
 g.close();assert(v.disposed&&v.geometry.size===0&&v.paths.size===0,'Disposal leaked cached DOM');checks.push('Closing releases caches and observers');
 const f=fixture(FormulaGraph,2,true);let draws=0,previews=0;f._redrawEdges=()=>draws++;f._updatePreview=()=>previews++;
 for(let i=0;i<60;i++)f._scheduleEdges(false);await pause(100);assert(draws===1&&previews===0,'Viewport events not batched or compiled unnecessarily');
 f._scheduleEdges(true);await pause(220);assert(previews===1,'Data change did not compile');const d=draws;f._scheduleEdges(true);f.close();await pause(180);
 assert(draws===d&&previews===1,'Queued work survived closing');checks.push('Frame batching, semantic-only preview and timer cancellation');
 finish({status:'PASS',checks});
}catch(error){finish({status:'FAIL',checks,error:error.stack||String(error)});}
