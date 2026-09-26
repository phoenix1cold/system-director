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
const browser=await chromium.launch({headless:true,args:["--enable-unsafe-swiftshader","--use-angle=swiftshader","--use-gl=angle","--ignore-gpu-blocklist","--in-process-gpu"]});
try {
  const page=await browser.newPage({viewport:{width:1000,height:760}});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error'&&!message.text().includes('404'))console.error(message.text());});
  await page.goto(`http://127.0.0.1:${server.address().port}/scripts/test-skilltree-3d-browser.html`);
  await page.waitForFunction(()=>['PASS','FAIL'].includes(document.title));
  assert.equal(await page.title(),'PASS',await page.locator('#result').textContent());
  await page.waitForTimeout(600);
  await page.screenshot({path:path.join(root,'tests','skilltree-3d-preview.png')});

  // Hover and click resolve to the node under the pointer.
  const frost=await page.evaluate(()=>sdTreeScreenPoint('frost'));
  await page.mouse.move(frost.x,frost.y);
  await page.waitForFunction(()=>sdTreeEvents.some(e=>e.event==='hover'&&e.id==='frost'));
  await page.mouse.down();await page.mouse.up();
  assert.ok(await page.evaluate(()=>sdTreeEvents.some(e=>e.event==='select'&&e.id==='frost')),'click selects the hovered node');
  await page.mouse.click(frost.x,frost.y,{button:'right'});
  assert.ok(await page.evaluate(()=>sdTreeEvents.some(e=>e.event==='context'&&e.id==='frost')),'right-click reports the node');

  // Dragging orbits the camera without selecting.
  const before=await page.evaluate(()=>sdTreeEvents.filter(e=>e.event==='select').length);
  const box=await page.locator('canvas').boundingBox();
  await page.mouse.move(box.x+box.width*.5,box.y+box.height*.5);await page.mouse.down();
  await page.mouse.move(box.x+box.width*.75,box.y+box.height*.6,{steps:12});await page.mouse.up();
  assert.equal(await page.evaluate(()=>sdTreeEvents.filter(e=>e.event==='select').length),before,'orbit drag must not select');
  assert.ok(await page.evaluate(()=>!sdTree.controls.autoRotate),'user interaction stops auto-rotate');

  // Acquiring a node keeps the camera, lights the node, flashes it and unlocks children.
  const cam=await page.evaluate(()=>sdTree.camera.position.toArray());
  await page.evaluate(()=>sdTreeAcquire('frost'));
  assert.deepEqual(await page.evaluate(()=>sdTree.camera.position.toArray()),cam,'update() keeps the camera');
  assert.ok(await page.evaluate(()=>sdTree.flash.has('frost')),'newly acquired node flashes');
  assert.equal(await page.evaluate(()=>sdTree.nodeObjects.get('frost').userData.status),'acquired');
  assert.equal(await page.evaluate(()=>sdTree.nodeObjects.get('glacier').userData.status),'available','children unlock');
  assert.ok(await page.evaluate(()=>sdTree.beams.find(b=>b.userData.from==='root'&&b.userData.to==='frost').userData.active),'connection lights up');
  await page.waitForTimeout(500);
  await page.screenshot({path:path.join(root,'tests','skilltree-3d-acquired.png')});

  // Re-render moves the live canvas into a new container.
  const camBefore=await page.evaluate(()=>sdTree.camera.position.toArray());
  await page.evaluate(()=>{const next=document.createElement('div');next.className='sd-prog-st-3d';next.id='host2';document.getElementById('host').replaceWith(next);sdTree.attach(next);});
  assert.equal(await page.locator('#host2 canvas').count(),1,'attach moves the canvas');
  const camAfter=await page.evaluate(()=>sdTree.camera.position.toArray());
  assert.ok(Math.hypot(...camAfter.map((v,i)=>v-camBefore[i]))<0.5,'attach keeps the camera (only damping drift)');

  // Reset and dispose clean up.
  await page.evaluate(()=>sdTree.resetView());
  assert.ok(await page.evaluate(()=>sdTree.controls.autoRotate),'reset restores auto-rotate');
  await page.evaluate(()=>sdTree.dispose());
  assert.equal(await page.locator('canvas').count(),0,'dispose removes the canvas');
  assert.equal(await page.evaluate(()=>sdTree.nodeObjects.size),0);
  assert.deepEqual(errors,[]);
  console.log('skilltree-3d browser: PASS');
} finally {
  await browser.close();
  server.close();
}
