import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {pathToFileURL,fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || path.join(process.env.TEMP || '/tmp','sd-3d-qa/node_modules/playwright/index.mjs')));
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const server=http.createServer((req,res)=>{
  const file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
  if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  try{res.setHeader('Content-Type',({'.mjs':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));}
  catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true});
try{
  const page=await browser.newPage({viewport:{width:1200,height:900}});
  const errors=[];page.on('pageerror',e=>errors.push(e.stack));
  await page.goto(`http://127.0.0.1:${server.address().port}/scripts/test-graph-render-browser.html`);
  await page.waitForFunction(()=>['PASS','FAIL'].includes(document.title));
  const regression=JSON.parse(await page.locator('#result').textContent());
  assert.equal(regression.status,'PASS',JSON.stringify(regression));assert.deepEqual(errors,[]);
  const metrics=await page.evaluate(async()=>{
    const {benchmark}=await import('./graph-render-test-support.mjs');
    const {FormulaGraph}=await import('../module/builder/formula-graph.mjs');
    return [200,300,600].map(count=>benchmark(FormulaGraph,count,'dense',60));
  });
  const result={regression,metrics};console.log(JSON.stringify(result,null,2));
  if(process.argv[2])fs.writeFileSync(path.resolve(process.argv[2]),JSON.stringify(result,null,2)+'\n');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
