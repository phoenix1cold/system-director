// Playwright: npm install playwright in a temporary directory, or supply PLAYWRIGHT_MODULE.
import fs from 'node:fs';import path from 'node:path';import http from 'node:http';import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || path.join(process.env.TEMP || '/tmp','sd-3d-qa/node_modules/playwright/index.mjs')));
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://l').pathname));try{res.setHeader('Content-Type',({'.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,args:["--enable-unsafe-swiftshader","--use-angle=swiftshader","--use-gl=angle","--ignore-gpu-blocklist","--in-process-gpu"]});
const page=await browser.newPage({viewport:{width:1140,height:720}});
page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('404'))console.error('[page]',m.text());});page.on('pageerror',e=>console.error('[pageerror]',e.message));
await page.goto(`http://127.0.0.1:${server.address().port}/scripts/test-item-skilltree-3d-browser.html`);
await page.waitForFunction(()=>document.querySelector('canvas'),null,{timeout:60000});await page.waitForTimeout(1200);
await page.locator('#sheet').screenshot({path:root+'/tests/skilltree-3d-item-sheet.png'});
await page.waitForFunction(()=>globalThis.__gridShot||['PASS','FAIL'].includes(document.title),null,{timeout:60000}).catch(()=>{});await page.locator('#sheet').screenshot({path:root+'/tests/item-skilltree-grid-shell.png'});await page.waitForFunction(()=>['PASS','FAIL'].includes(document.title),null,{timeout:60000}).catch(()=>{});
const title=await page.title();const result=await page.locator('#result').textContent();console.log(result);
if(title!=='PASS'){process.exitCode=1;console.error('item skilltree 3d browser: FAIL');}else console.log('item skilltree 3d browser: PASS');
await browser.close();server.close();
