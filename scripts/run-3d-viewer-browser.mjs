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
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error'&&!message.text().includes('404'))console.error(message.text());});
  await page.goto(`http://127.0.0.1:${server.address().port}/scripts/test-3d-viewer-browser.html`);
  await page.waitForFunction(()=>['PASS','FAIL'].includes(document.title));
  assert.equal(await page.title(),'PASS',await page.locator('#result').textContent());
  assert.equal(await page.evaluate(()=>sd3dTestViewer.renderer.getClearAlpha()),0.35);
  await page.getByText('Edit interactive points',{exact:true}).click();
  await page.getByLabel('Point ID',{exact:true}).fill('door');
  await page.getByLabel('Point tooltip',{exact:true}).fill('Open the door');
  await page.getByRole('button',{name:'Place point',exact:true}).click();
  await page.locator('canvas').click();
  await page.waitForFunction(()=>sd3dTestViewer.hotspots.has('door'));
  await page.locator('[data-point-id="door"]').hover();
  assert.equal(await page.locator('.sd-model-tooltip').textContent(),'Open the door');
  await page.locator('[data-point-id="door"]').click();
  assert.ok(await page.evaluate(()=>sd3dEvents.some(e=>e.event==='click'&&e.hotspotId==='door')));
  await page.getByLabel('Point tooltip',{exact:true}).fill('Door to the tower');
  await page.getByRole('button',{name:'Update point',exact:true}).click();
  await page.getByRole('button',{name:'Save points',exact:true}).click();
  assert.equal(await page.evaluate(()=>savedPoints[0].text),'Door to the tower');
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
  assert.deepEqual(errors,[]);
  const result=JSON.parse(await page.locator('#result').textContent());
  result.checks.push('User places, edits, saves and removes points using real pointer clicks','Hover tooltip and point click events','Full-screen toggle and Escape restore original window','Orbit drag does not trigger click','WebGL background alpha');
  fs.writeFileSync(path.join(root,'tests/3d-viewer-results.json'),JSON.stringify(result,null,2)+'\n');
  console.log(`PASS: ${result.checks.length} WebGL/browser scenarios`);
} finally {await browser.close();server.close();}
