import {SheetWidgetDesigner} from '../module/builder/widget-builder-designer.mjs';
import {SDUIWidgetEditor} from '../module/ui-blueprint/ui-widget-editor.mjs';
import {UIWidgetTree} from '../module/ui-blueprint/ui-widget-runtime.mjs';

export async function checkDesignerWorkspace(){
  const assert=(value,message)=>{if(!value)throw new Error(message);};
  const source={id:'builder',type:'widgetBuilder',label:'Панель персонажа',canvasW:600,canvasH:400,elements:Array.from({length:60},(_,i)=>({id:`el${i}`,name:`Элемент ${i+1}`,label:`Текст ${i+1}`,x:i%6*94,y:Math.floor(i/6)*36,w:90,h:32}))};
  const app=new SheetWidgetDesigner({widget:source,doc:{system:{customTabs:[]}}});
  const root=document.createElement('section');root.className='application sd sd-ui-widget-editor-window sd-sheet-widget-designer';root.style.cssText='width:1140px;height:760px;position:relative';
  root.innerHTML=await app._renderHTML();document.body.append(root);app.element=root;app._onRender();
  assert(root.querySelectorAll('[role=tab]').length===4,'Shared workspace provides four panel tabs');
  const original=app.regions.canvas.firstElementChild;
  for(let i=0;i<40;i++)app._selectElement(`el${i}`);
  assert(app.regions.canvas.firstElementChild===original,'Selection preserves the canvas DOM');
  for(let i=0;i<25;i++)app._renderCanvas();
  let additions=0;app._addWidget=()=>additions++;
  const transfer=new DataTransfer();transfer.setData('text/plain',JSON.stringify({sdSheetDesigner:true,widgetType:'text'}));
  app.regions.canvas.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:transfer}));
  assert(additions===1,'Repeated renders do not multiply drop handlers');
  app.regions.palette.querySelector('[data-widget-type]').click();assert(additions===2,'Palette adds with one click');
  const field=root.querySelector('[data-detail="name"]');field.focus();field.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
  assert(document.activeElement===field,'Inspector retains focus');
  const beforeEdit=app.regions.canvas.firstElementChild;
  field.value='Новое имя';field.dispatchEvent(new Event('input',{bubbles:true}));
  assert(app.regions.canvas.firstElementChild===beforeEdit&&app.elements.find(el=>el.id===app.selectedId).name==='Новое имя','Inspector updates only the selected element without rebuilding the canvas');
  const count=app.elements.length;document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Delete',bubbles:true}));assert(app.elements.length===count,'Delete outside the editor does not delete elements');
  app.widget.label='Changed';assert(source.label==='Панель персонажа','Designer changes are staged until save');
  root.querySelectorAll('[role=tab]')[1].click();assert(!app.regions.hierarchy.closest('[role=tabpanel]').hidden,'Layers tab exposes hierarchy');
  await app._onClose({});
  globalThis.designerPreview=root;

  const ui=new SDUIWidgetEditor();ui._regions={};ui.element=document.createElement('div');
  const writes=[];let release;
  ui.document={system:{},update:async data=>{writes.push(data['system.elements'][0].name);if(writes.length===1)await new Promise(resolve=>release=resolve);}};
  ui._rebuildCanvas=()=>{};ui._rebuildHierarchy=()=>{};ui._rebuildDetails=()=>{};ui._updateStatus=()=>{};
  const first=ui._commit([{id:'one',name:'First'}]),second=ui._commit([{id:'one',name:'Second'}]);
  await new Promise(resolve=>setTimeout(resolve,0));assert(writes.length===1,'Saves are serialized');release();await Promise.all([first,second]);
  assert(writes.join(',')==='First,Second'&&ui._elements[0].name==='Second','Newest edit is persisted last');
  const prepare=UIWidgetTree.prototype.prepare,render=UIWidgetTree.prototype.render;
  const pending=[],paint=[];const canvas=document.createElement('div');document.body.append(canvas);
  try {
    UIWidgetTree.prototype.prepare=function(){return new Promise(resolve=>pending.push({tree:this,resolve}));};
    UIWidgetTree.prototype.render=function(){paint.push(this);};
    ui._regions={canvas};ui._applyCanvasSize=()=>{};ui._decorateCanvas=()=>{};ui._syncSelectionClasses=()=>{};
    ui._elements=[];
    SDUIWidgetEditor.prototype._rebuildCanvas.call(ui);SDUIWidgetEditor.prototype._rebuildCanvas.call(ui);
    pending[1].resolve();await Promise.resolve();pending[0].resolve();await Promise.resolve();
    assert(paint.length===1&&paint[0]===pending[1].tree,'Stale asynchronous previews never paint over the newest canvas');
  } finally {UIWidgetTree.prototype.prepare=prepare;UIWidgetTree.prototype.render=render;canvas.remove();}
  return 12;
}
