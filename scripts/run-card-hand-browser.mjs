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
const browser=await chromium.launch({headless:true});
try {
  const page=await browser.newPage({viewport:{width:1200,height:1200}});
  const errors=[];page.on('pageerror',error=>errors.push(error.stack));
  page.on('console',message=>{if(message.type()==='error'&&!message.text().includes('404'))console.error(message.text());});
  await page.goto(`http://127.0.0.1:${server.address().port}/scripts/test-card-hand-browser.html`);
  await page.waitForFunction(()=>['READY','FAIL'].includes(document.title));
  assert.equal(await page.title(),'READY',await page.locator('#result').textContent());
  await page.evaluate(()=>{
    Object.defineProperty(crypto,'randomUUID',{configurable:true,value:undefined});
    foundry.utils.randomID=()=>Array.from(crypto.getRandomValues(new Uint8Array(12)),n=>n.toString(16).padStart(2,'0')).join('');
  });
  await page.getByLabel('Search test',{exact:true}).click();
  await page.locator('.sd-search-select input').fill('лё');
  assert.equal(await page.locator('.sd-search-options [role=option]').count(),1);
  await page.locator('.sd-search-select input').press('Enter');
  assert.equal(await page.getByLabel('Search test',{exact:true}).inputValue(),'b');
  await page.getByLabel('Search test',{exact:true}).focus();await page.keyboard.press('ArrowDown');
  assert.equal(await page.locator('.sd-search-options [role=option]').count(),2,'Disabled options and groups excluded');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.sd-search-select').count(),0);
  await page.getByLabel('Multiple test',{exact:true}).click();
  await page.locator('.sd-search-options button').filter({hasText:'Two'}).click();
  assert.deepEqual(await page.locator('select[aria-label="Multiple test"]').evaluate(el=>[...el.selectedOptions].map(o=>o.value)),['two']);
  await page.keyboard.press('Escape');
  await page.evaluate(()=>qa.checks.push('Searchable selectors: Cyrillic search, mouse/keyboard, Escape, disabled groups and multi-select'));
  await page.evaluate(()=>qa.checks.push('Searchable selectors work without crypto.randomUUID (HTTP compatibility)'));
  await page.locator('#tabs [data-rename] i').click();
  await page.locator('#tabs [data-rename]').focus();await page.keyboard.press('Enter');
  await page.locator('#tabs [data-deltab]').click();
  await page.locator('#tabs span').click();
  assert.deepEqual(await page.evaluate(()=>qa.calls),[['settings','hand'],['settings','hand'],['delete','hand'],['switch','hand']]);
  const initial=await page.evaluate(()=>qa.inspected.length);
  for(let i=0;i<6;i++) {
    await page.mouse.move(1,1);await page.waitForTimeout(180);
    const button=page.locator(`#fan .sd-hand-open[data-card-id="c${i}"]`);
    await button.scrollIntoViewIfNeeded();
    const point=await button.evaluate(el=>{
      const r=el.getBoundingClientRect();
      for(let y=Math.max(0,r.top)+12;y<Math.min(innerHeight,r.bottom)-12;y+=8)
        for(let x=Math.max(0,r.left)+12;x<Math.min(innerWidth,r.right)-12;x+=8)
          if(document.elementFromPoint(x,y)?.closest('.sd-hand-open')===el)return {x,y};
      return null;
    });
    assert.ok(point,`Fan card ${i} needs an exposed pointer target`);
    await page.mouse.move(point.x,point.y);await page.waitForTimeout(180);
    await button.click();
    await page.waitForFunction(n=>qa.inspected.length===n,initial+i+1);
    assert.equal(await page.evaluate(()=>qa.inspected.at(-1)),`c${i}`);
    await button.blur();
  }
  await page.locator('#strip .sd-hand-open').first().focus();await page.keyboard.press('Space');
  await page.waitForFunction(n=>qa.inspected.length===n,initial+7);
  const events=await page.evaluate(()=>qa.hooks.filter(e=>e.name==='sdSheetWidgetEvent'&&e.payload.event==='click').length);
  await page.locator('#strip .sd-hand-open').first().press('Enter');
  await page.waitForFunction(n=>qa.hooks.filter(e=>e.name==='sdSheetWidgetEvent'&&e.payload.event==='click').length===n,events+1);
  await page.locator('#strip .sd-hand-open').first().blur();await page.mouse.move(1,1);
  await page.evaluate(()=>{qa.checks.push('Nested tab icon, keyboard settings and tab switching','Every fan card has a real mouse target','Keyboard card activation and idempotent binding');document.querySelector('#result').textContent=`PASS · ${qa.checks.length} проверок`;});
  await page.waitForTimeout(180);
  await page.screenshot({path:path.join(root,'tests/card-hand-preview.png'),fullPage:true});
  // Narrow sheets must scroll inside the hand without widening the page.
  await page.setViewportSize({width:420,height:900});
  await page.evaluate(()=>document.querySelector('main').style.width='390px');
  assert.ok(await page.locator('#fan .sd-hand-scroll').evaluate(el=>el.scrollWidth>el.clientWidth),'Narrow fan should scroll');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal page overflow');
  await page.evaluate(async()=>{
    const {SheetTabReorder}=await import('../module/builder/sheet-tab-reorder.mjs');
    const {GridManager}=await import('../module/builder/grid-manager.mjs');
    const originalMove=GridManager.moveTab,originalShift=GridManager.shiftTab;
    const calls=[];GridManager.moveTab=async(...args)=>calls.push(args.slice(1));GridManager.shiftTab=async(...args)=>calls.push(args.slice(1));
    const sheet=document.createElement('section');sheet.className='sd sheet';sheet.style.cssText='position:relative;width:390px;height:600px';
    sheet.dataset.sdTabLabels='1';sheet.innerHTML='<div class="window-content"><nav class="sd-tab-nav"></nav><div class="sd-panels-container"></div></div>';document.body.append(sheet);
    const nav=sheet.querySelector('nav');
    for(const id of ['first','second']){
      const tab=document.createElement('a');tab.className='sd-tab-btn';tab.dataset.tabId=id;
      tab.innerHTML='<i class="sd-tab-icon">◆</i><span class="sd-tab-emoji">★</span><span class="sd-tab-label">Длинное название вкладки</span><button class="sd-tab-control" aria-label="Settings">⚙</button><button class="sd-tab-control" aria-label="Delete">×</button>';
      nav.append(tab);SheetTabReorder.attach({_editMode:true,isEditable:true,document:{uuid:'Actor.test'}},tab,id);
    }
    const assert=(ok,message)=>{if(!ok)throw new Error(message);};
    try {
      for(const layout of ['tabs-left','tabs-right','dashboard'])for(const labels of ['0','1']){
        sheet.dataset.sdSheetLayout=layout;sheet.dataset.sdTabLabels=labels;
        const nb=nav.getBoundingClientRect();
        assert(nb.width>=104,'Edit rail reserves space');
        for(const tab of nav.children){const tb=tab.getBoundingClientRect();
          const rects=[...tab.children].filter(el=>getComputedStyle(el).display!=='none').map(el=>el.getBoundingClientRect());
          for(const b of rects)assert(b.width>0&&b.left>=tb.left-1&&b.right<=tb.right+1&&b.top>=tb.top-1&&b.bottom<=tb.bottom+1,'Tab control clipped: '+layout);
          for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++){const a=rects[i],b=rects[j];assert(Math.min(a.right,b.right)-Math.max(a.left,b.left)<1||Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)<1,'Tab controls overlap');}
        }
      }
      sheet.dataset.sdSheetLayout='tabs-right';
      const first=nav.children[0],second=nav.children[1];const transfer=new DataTransfer();
      first.querySelector('.sd-tab-drag-handle').dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:transfer}));
      const b=second.getBoundingClientRect();
      second.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:transfer,clientX:b.left+1,clientY:b.bottom-1}));
      second.querySelector('.sd-tab-drag-handle').dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,key:'ArrowUp'}));
      assert(JSON.stringify(calls)===JSON.stringify([['first','second','after'],['second',-1]]),'Vertical drop and keyboard follow Y axis');
      qa.checks.push('Left/right/dashboard rails: all icons, handles and buttons fit at 390px with labels on/off','Vertical tab drop and keyboard ordering');
      sheet.id='rail-layout-test';
    } finally {GridManager.moveTab=originalMove;GridManager.shiftTab=originalShift;}
  });
  await page.locator('#rail-layout-test').screenshot({path:path.join(root,'tests/tab-rail-preview.png')});
  await page.locator('#rail-layout-test').evaluate(el=>el.remove());
  assert.deepEqual(errors,[]);
  const result=await page.evaluate(()=>({checks:qa.checks,errors:qa.errors}));
  result.checks.push('Narrow viewport uses internal scrolling');
  fs.writeFileSync(path.join(root,'tests/card-hand-results.json'),JSON.stringify(result,null,2)+'\n');
  console.log(`PASS: ${result.checks.length} browser checks; preview saved to tests/card-hand-preview.png`);
} finally {await browser.close();server.close();}
