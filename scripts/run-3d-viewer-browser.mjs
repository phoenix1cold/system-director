import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {pathToFileURL,fileURLToPath} from 'node:url';

// npm install playwright in a temporary directory, or supply PLAYWRIGHT_MODULE.
const playwrightModule=process.env.PLAYWRIGHT_MODULE || path.join(process.env.TEMP || '/tmp','sd-3d-qa/node_modules/playwright/index.mjs');
const {chromium}=await import(pathToFileURL(playwrightModule));
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const server=http.createServer((req,res)=>{
  const file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
  if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  try {res.setHeader('Content-Type',({'.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));}
  catch {res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,args:["--enable-unsafe-swiftshader"]});
try {
  const page=await browser.newPage({viewport:{width:1200,height:1200}});
  await page.addInitScript(()=>Object.defineProperty(crypto,'randomUUID',{configurable:true,value:undefined}));
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error'&&!message.text().includes('404'))console.error(message.text());});
  await page.goto(`http://127.0.0.1:${server.address().port}/scripts/test-3d-viewer-browser.html`);
  await page.waitForFunction(()=>['PASS','FAIL'].includes(document.title));
  assert.equal(await page.title(),'PASS',await page.locator('#result').textContent());
  assert.equal(await page.evaluate(()=>sd3dTestViewer.renderer.getClearAlpha()),0.35);
  await page.getByLabel('Point ID',{exact:true}).fill('door');
  await page.getByLabel('Point tooltip',{exact:true}).fill('Open the door');
  await page.getByRole('button',{name:'Set point',exact:true}).click();
  await page.locator('canvas').click();
  await page.waitForFunction(()=>sd3dTestViewer.hotspots.has('door'));
  await page.locator('[data-point-id="door"]').hover();
  assert.equal(await page.locator('.sd-model-tooltip').textContent(),'Open the door');
  await page.locator('[data-point-id="door"]').click();
  assert.equal(await page.evaluate(()=>sd3dEvents.length),0,'Authoring never runs game events');
  await page.getByLabel('Point tooltip',{exact:true}).fill('Door to the tower');
  await page.getByLabel('Point Show If',{exact:true}).fill('{system.level} > 2');
  await page.getByRole('button',{name:'Update point',exact:true}).click();
  await page.getByRole('button',{name:'Save points',exact:true}).click();
  assert.equal(await page.evaluate(()=>JSON.parse(sd3dGraph.nodes[0].data.hotspots)[0].text),'Door to the tower');
  assert.equal(await page.evaluate(()=>JSON.parse(sd3dGraph.nodes[0].data.hotspots)[0].showIf),'{system.level} > 2','Show If persists with the point');
  await page.evaluate(()=>{globalThis.savedPoints=JSON.parse(sd3dGraph.nodes[0].data.hotspots);});
  await page.getByRole('button',{name:'Full screen',exact:true}).click();
  assert.ok(await page.evaluate(()=>sd3dTestViewer.fullscreen&&sd3dTestViewer.viewport.clientWidth===innerWidth));
  await page.keyboard.press('Escape');
  assert.ok(await page.evaluate(()=>!sd3dTestViewer.fullscreen&&sd3dTestViewer.app.element.contains(sd3dTestViewer.root)));
  const before=await page.evaluate(()=>sd3dEvents.filter(e=>e.event==='click').length);
  const bounds=await page.locator('canvas').boundingBox();
  await page.mouse.move(bounds.x+bounds.width*.4,bounds.y+bounds.height*.5);await page.mouse.down();
  await page.mouse.move(bounds.x+bounds.width*.65,bounds.y+bounds.height*.55,{steps:10});await page.mouse.up();
  assert.equal(await page.evaluate(()=>sd3dEvents.filter(e=>e.event==='click').length),before,'Orbit must not click the model');
  await page.getByRole('button',{name:'Reset camera',exact:true}).click();
  await page.getByRole('button',{name:'Delete point',exact:true}).click();
  assert.equal(await page.evaluate(()=>sd3dTestViewer.hotspots.size),0);
  await page.evaluate(()=>{for(const p of savedPoints)sd3dTestViewer.setHotspot(p);});
  await page.locator('[data-point-id="door"]').hover();
  await page.screenshot({path:path.join(root,'tests/3d-interaction-preview.png'),fullPage:true});
  await page.evaluate(async()=>{
    await sd3dTestViewer.close();
    const {openModelViewer}=await import('../module/three/model-viewer.mjs');
    globalThis.sd3dTestViewer=await openModelViewer({viewerId:'playback',primitive:'cube',document:{system:{level:3}},hotspots:JSON.parse(sd3dGraph.nodes[0].data.hotspots),onInteraction:p=>sd3dEvents.push(p)});
  });
  assert.equal(await page.locator('.sd-model-point-editor').count(),0,'Playback contains no editing tools');
  assert.equal(await page.evaluate(async()=>{const {FormulaEngine}=await import('../module/helpers/formula-engine.mjs');return FormulaEngine.evaluate('{system.level} > 2',sd3dTestViewer.options.document);}),true,'Playback resolves Show If against its owner');
  await page.locator('[data-point-id="door"]').hover();
  await page.locator('[data-point-id="door"]').click();
  assert.ok(await page.evaluate(()=>sd3dEvents.some(e=>e.event==='click'&&e.hotspotId==='door')));
  assert.ok(await page.evaluate(()=>sd3dEvents.some(e=>e.event==='hover'&&e.hotspotId==='door')));
  const beforeHidden=await page.evaluate(()=>sd3dEvents.filter(e=>e.event==='click').length);
  await page.evaluate(()=>{sd3dTestViewer.options.document.system.level=1;});
  await page.waitForFunction(()=>document.querySelector('[data-point-id="door"]').hidden);
  await page.evaluate(()=>document.querySelector('[data-point-id="door"]').click());
  assert.equal(await page.evaluate(()=>sd3dEvents.filter(e=>e.event==='click').length),beforeHidden,'Hidden points cannot execute clicks');
  await page.evaluate(()=>{sd3dTestViewer.options.document.system.level=3;});
  await page.waitForFunction(()=>!document.querySelector('[data-point-id="door"]').hidden);
  await page.evaluate(async()=>{
    await sd3dTestViewer.close();
    const {editModelNodePoints}=await import('../module/three/model-point-data.mjs');
    globalThis.sd3dTestViewer=await editModelNodePoints(sd3dGraph,sd3dGraph.nodes[0]);
  });
  assert.equal(await page.evaluate(()=>sd3dTestViewer.getPoints()[0].text),'Door to the tower','Reopen restores graph points');
  assert.equal(await page.getByLabel('Point Show If',{exact:true}).inputValue(),'{system.level} > 2','Reopen restores Show If in editor');
  await page.getByRole('button',{name:'Delete point',exact:true}).click();
  await page.getByRole('button',{name:'Save points',exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>JSON.parse(sd3dGraph.nodes[0].data.hotspots)),[],'Empty point list saves to node');
  await page.evaluate(async()=>{
    const {showPopupMessage}=await import('../module/helpers/popup-message.mjs');
    showPopupMessage({title:'Test',message:'<img src=x onerror=alert(1)>',duration:0,position:'center'});
  });
  assert.equal(await page.locator('.sd-floating-message img').count(),0,'Popup treats input as plain text');
  await page.locator('.sd-floating-message button').click();
  assert.equal(await page.locator('.sd-floating-message').count(),0);
  await page.evaluate(async()=>{
    await sd3dTestViewer.close();
    const {renderModelWidget,bindModelWidgets}=await import('../module/three/model-widget.mjs');
    const root=document.createElement('section');root.id='widget-test';root.style.width='420px';document.body.append(root);
    root.innerHTML=renderModelWidget({id:'artifact',src:'/fixture.glb',label:'3D Object',previewMode:true,hotspots:[{id:'rune',text:'Ancient rune',x:0,y:0,z:0}]});
    globalThis.modelRequests=0;const fetchModel=globalThis.sd3dFixtureFetch;globalThis.fetch=(url,...rest)=>{if(String(url?.url??url).endsWith('/fixture.glb'))modelRequests++;return fetchModel(url,...rest);};
    bindModelWidgets(root,null);
  });
  await page.mouse.move(0,0);
  assert.equal(await page.locator('#widget-test canvas').count(),0,'Preview creates no WebGL renderer before hover');
  assert.equal(await page.evaluate(()=>modelRequests),0,'Preview does not request the model before hover');
  await page.locator('.sd-model-widget').hover();
  await page.waitForFunction(()=>document.querySelector('.sd-model-widget')._sdModelBinding.viewer?.model);
  assert.equal(await page.locator('.application').count(),0,'Embedded model does not open a separate window');
  assert.equal(await page.evaluate(()=>modelRequests),1);
  assert.equal(await page.locator('.sd-model-point-editor').count(),0,'Embedded playback cannot edit points');
  assert.equal(await page.locator('#widget-test [data-point-id="rune"]').count(),1,'Widget restores saved points');
  await page.evaluate(()=>{globalThis.embeddedViewer=document.querySelector('.sd-model-widget')._sdModelBinding.viewer;});
  await page.getByRole('button',{name:'Full screen',exact:true}).click();
  assert.ok(await page.evaluate(()=>embeddedViewer.fullscreen&&!embeddedViewer.disposed));
  await page.keyboard.press('Escape');
  assert.ok(await page.evaluate(()=>!embeddedViewer.fullscreen&&document.querySelector('#widget-test').contains(embeddedViewer.root)));
  await page.evaluate(()=>document.activeElement?.blur());
  await page.mouse.move(0,0);
  await page.waitForFunction(()=>embeddedViewer.disposed);
  assert.equal(await page.locator('#widget-test canvas').count(),0,'Leaving preview disposes WebGL');
  assert.ok(await page.locator('.sd-model-poster img').getAttribute('src'),'Last rendered frame becomes preview');
  await page.locator('.sd-model-widget').hover();
  await page.waitForFunction(()=>document.querySelector('.sd-model-widget')._sdModelBinding.viewer?.model);
  await page.screenshot({path:path.join(root,'tests/3d-widget-preview.png')});
  await page.evaluate(()=>{globalThis.embeddedViewer=document.querySelector('.sd-model-widget')._sdModelBinding.viewer;document.querySelector('#widget-test').remove();});
  await page.waitForFunction(()=>embeddedViewer.disposed);
  // Remove a widget while its GLB request is pending: it must never resurrect.
  await page.evaluate(async()=>{
    const {renderModelWidget,bindModelWidgets}=await import('../module/three/model-widget.mjs');
    const root=document.createElement('section');root.id='pending-widget';document.body.append(root);
    root.innerHTML=renderModelWidget({id:'pending',src:'/slow.gltf',previewMode:false});
    bindModelWidgets(root,null);
  });
  await page.waitForFunction(()=>document.querySelector('.sd-model-widget')._sdModelBinding.viewer?.renderer);
  await page.evaluate(()=>{globalThis.pendingViewer=document.querySelector('.sd-model-widget')._sdModelBinding.viewer;document.querySelector('#pending-widget').remove();});
  await page.waitForFunction(()=>pendingViewer.disposed);
  assert.deepEqual(errors,[]);
  const result=JSON.parse(await page.locator('#result').textContent());
  result.checks.push('Graph editor: Set point then LMB, save/reopen/delete node data','Playback has no editing UI and still emits point click/hover','Authoring never executes graph events','Popup text safety and dismiss','Full-screen toggle and Escape restore original window','Orbit drag does not trigger click','WebGL background alpha');
  result.checks.push('3D widget: no model request or canvas until hover','Embedded viewer, saved points and full-screen restore','Hover exit releases WebGL and keeps snapshot; re-entry reloads','Sheet removal disposes active and loading widgets');
  result.checks.push('Point Show If survives save/reopen, updates live visibility, blocks hidden point clicks');
  fs.writeFileSync(path.join(root,'tests/3d-viewer-results.json'),JSON.stringify(result,null,2)+'\n');
  console.log(`PASS: ${result.checks.length} WebGL/browser scenarios`);
} finally {await browser.close();server.close();}
