// Browser regression fixture. Foundry documents are stubbed; renderer, CSS and handlers are real.
const checks = [];
function check(value, message) { if (!value) throw new Error(message); checks.push(message); }
class Collection extends Map { [Symbol.iterator]() { return this.values(); } }
class Application {
  constructor(options={}) { this.options=options; }
  async render() {
    this.element=document.createElement('div'); this.element.className='application sd';
    document.querySelector('#scratch').append(this.element);
    this._replaceHTML?.(await this._renderHTML(),this.element); this.rendered=true; return this;
  }
  async close() { this.element?.remove(); this.rendered=false; }
}
globalThis.foundry={ applications:{api:{ApplicationV2:Application,DocumentSheetV2:Application,HandlebarsApplicationMixin:Base=>Base},sheets:{ActorSheetV2:Application,ItemSheetV2:Application}},data:{fields:{}},utils:{deepClone:value=>structuredClone(value),randomID:()=>crypto.randomUUID().slice(0,8),getProperty:(o,p)=>String(p).split('.').reduce((v,k)=>v?.[k],o)} };
globalThis.Actor=class {}; globalThis.Item=class {};
const hooks=[],errors=[],inspected=[],played=[],captures=[],transfers=[];
globalThis.Hooks={on(){},once(){},callAll(name,payload){hooks.push({name,payload});}};
globalThis.ui={notifications:{error:e=>errors.push(e),warn:e=>errors.push(e)}};
globalThis.game={user:{id:'gm',isGM:true},settings:{get(){}},i18n:{lang:'ru',localize:k=>k,format:k=>k},cards:new Collection(),actors:new Collection(),items:new Collection(),modules:new Map()};
const doc={uuid:'Actor.qa',id:'qa',documentName:'Actor',items:[],system:{customTabs:[]}};
const stack={id:'hand',uuid:'Cards.hand',name:'Моя рука',cards:new Collection(),playDialog:async card=>played.push(card.id),drawDialog:async()=>transfers.push('draw'),passDialog:async(...args)=>{check(args.length===0,'Pass uses native destination/count dialog');transfers.push('pass');},shuffle:async()=>{},recall:async()=>{},updateEmbeddedDocuments:async(type,updates)=>{for(const u of updates)await stack.cards.get(u._id).update(u);}};
const suits=['♥','♥','♠','♣','♦','♠'], ranks=['A','K','Q','J','10','9'];
for(let i=0;i<6;i++) {
  const color=['♥','♦'].includes(suits[i])?'#c2253b':'#172039';
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="180" height="256" viewBox="0 0 180 256"><rect width="180" height="256" rx="8" fill="#fffaf1"/><rect x="6" y="6" width="168" height="244" rx="6" fill="none" stroke="#d4cabb"/><g fill="${color}" font-family="Georgia,serif"><text x="14" y="36" font-size="28">${ranks[i]}</text><text x="15" y="61" font-size="25">${suits[i]}</text><text x="90" y="158" text-anchor="middle" font-size="88">${suits[i]}</text><g transform="rotate(180 90 128)"><text x="14" y="36" font-size="28">${ranks[i]}</text><text x="15" y="61" font-size="25">${suits[i]}</text></g></g></svg>`;
  const card={id:`c${i}`,uuid:`Cards.hand.Card.c${i}`,name:`${ranks[i]} ${suits[i]}`,face:0,value:14-i,faces:[{img:'data:image/svg+xml,'+encodeURIComponent(svg)}],back:{img:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="180" height="256"><rect width="180" height="256" fill="#334d88"/></svg>')},sheet:{render:async()=>inspected.push(`c${i}`)},async update(change){Object.assign(this,change);}};
  stack.cards.set(card.id,card);
}
game.cards.set(stack.id,stack); game.actors.set(doc.id,doc);
globalThis.fromUuid=async uuid=>uuid===stack.uuid?stack:uuid===doc.uuid?doc:undefined;
globalThis.fromUuidSync=uuid=>uuid===stack.uuid?stack:undefined;
const tick=()=>new Promise(resolve=>setTimeout(resolve,20));
try {
  const {WidgetRenderer}=await import('../module/builder/widget-renderer.mjs');
  const {renderCardHand,bindCardHands}=await import('../module/helpers/card-hand.mjs');
  const {wireSheetTabClick}=await import('../module/builder/sheet-tab-controls.mjs');
  const {registerNodeActionHandler}=await import('../module/helpers/node-runtime-api.mjs');
  const {emitSheetWidgetEvent}=await import('../module/helpers/sheet-widget-events.mjs');
  const {openWidgetConfigPopup}=await import('../module/builder/widget-config-popup.mjs');
  const {WIDGET_TYPES,createWidget,WIDGET_VARIANTS}=await import('../module/builder/widget-registry.mjs');
  const {sheetWidgetClickControl}=await import('../module/helpers/sheet-widget-click.mjs');
  const clickProbe=document.createElement('div');
  clickProbe.innerHTML='<div class="background"><span>Label</span><img><input type="text"><button type="button" data-element-key="go"><i>Go</i></button><span role="button" data-element-key="virtual">Virtual</span><button disabled>Disabled</button><button class="sd-img-pick">Utility</button><div data-cardhand><button>Card</button></div><div class="sd-model-widget"><button>Point</button></div></div>';
  const probe=selector=>sheetWidgetClickControl(clickProbe,{target:clickProbe.querySelector(selector)});
  check(!probe('.background')&&!probe('.background > span')&&!probe('img')&&!probe('input[type="text"]'),'Widget background, label, image and value input are not On Click targets');
  check(probe('button i')?.dataset.elementKey==='go'&&probe('[role="button"]')?.dataset.elementKey==='virtual','Only explicit button controls are On Click targets');
  check(!probe('button:disabled')&&!probe('.sd-img-pick')&&!probe('[data-cardhand] button')&&!probe('.sd-model-widget button'),'Disabled, utility, Card Hand and 3D controls keep their dedicated events');
  const calls=[];
  wireSheetTabClick(document.querySelector('#tabs a'),{_renameTab:id=>calls.push(['settings',id]),_deleteTab:id=>calls.push(['delete',id]),_switchTab:id=>calls.push(['switch',id])},'hand');
  const widget={id:'hand-widget',widgetKey:'my_hand',type:'cardHand',label:'Моя рука',sourceUuid:stack.uuid,layout:'strip',cardWidth:132,clickAction:'inspect'};
  check(/<button[^>]+class="tog-row"/.test(WidgetRenderer.render({type:'toggle',label:'Toggle',path:'system.toggle'},doc)),'Toggle control is an accessible button');
  const {CharacterSheet}=await import('../module/sheets/character-sheet.mjs');
  const sheet=Object.create(CharacterSheet.prototype);sheet.document=doc;sheet._editMode=false;
  const clickCell=document.createElement('div');clickCell.innerHTML='<div class="widget"><span class="label">Background label</span><button type="button" data-element-key="go"><i>Run</i></button></div>';document.getElementById('scratch').append(clickCell);
  sheet._wireWidget(clickCell,{id:'button-test',widgetKey:'button_test',type:'button',label:'Button'});
  const sheetClicks=()=>hooks.filter(entry=>entry.name==='sdSheetWidgetEvent'&&entry.payload.widgetKey==='button_test'&&entry.payload.event==='click');
  clickCell.querySelector('.label').click();check(sheetClicks().length===0,'Actor sheet background does not fire On Click');
  clickCell.querySelector('button i').click();check(sheetClicks().length===1&&sheetClicks()[0].payload.elementKey==='go','Actor sheet button fires one On Click with its element key');
  clickCell.remove();
  const {SDItemSheet}=await import('../module/sheets/item-sheet.mjs');
  const itemOwner={...doc,documentName:'Item',uuid:'Item.click-test',actor:doc,system:{...doc.system}};
  const itemSheet=Object.create(SDItemSheet.prototype);itemSheet.document=itemOwner;itemSheet._editMode=false;
  const itemCell=document.createElement('div');itemCell.innerHTML='<div class="widget"><span class="label">Item label</span><button type="button"><i>Run</i></button></div>';document.getElementById('scratch').append(itemCell);
  itemSheet._wireSheetWidgetEvents(itemCell,{id:'item-button',widgetKey:'item_button',type:'button',label:'Item Button'});
  const itemClicks=()=>hooks.filter(entry=>entry.name==='sdSheetWidgetEvent'&&entry.payload.widgetKey==='item_button'&&entry.payload.event==='click');
  itemCell.querySelector('.label').click();check(itemClicks().length===0,'Item sheet background does not fire On Click');
  itemCell.querySelector('button i').click();check(itemClicks().length===1,'Item sheet button fires one On Click');
  itemCell.remove();
  for (const [id,variant] of [['strip','default'],['fan','poker-fan']]) {
    const root=document.getElementById(id);
    root.innerHTML=WidgetRenderer.render({...widget,variant,label:id==='fan'?'Вы':'Моя рука'},doc);
    bindCardHands(root,doc);bindCardHands(root,doc);
    check(root.querySelectorAll('.sd-hand-open').length===6,`${id}: six full card buttons`);
  }
  check(WIDGET_VARIANTS.cardHand.includes('poker-fan'),'HUD variant registered');
  const scratch=document.getElementById('scratch');
  const mount=(changes={},owner=doc,disabled=false)=>{const root=document.createElement('div');root.innerHTML=renderCardHand({...widget,...changes},stack);scratch.append(root);bindCardHands(root,owner,{disabled:()=>disabled});return root;};
  const click=async(root,sel,event='click')=>{root.querySelector(sel).dispatchEvent(new MouseEvent(event,{bubbles:true,cancelable:true}));for(let n=0;n<100&&root.querySelector('[data-busy="true"]');n++)await tick();};
  let root=mount({clickAction:'play'});await click(root,'.sd-hand-open');root.remove();
  root=mount({clickAction:'discard'});await click(root,'.sd-hand-open');root.remove();
  check(played.join(',')==='c0,c0','Play and discard target only selected card');
  root=mount();await click(root,'[data-hand-action="draw"]');await click(root,'[data-hand-action="pass"]');root.remove();
  check(transfers.join(',')==='draw,pass','Draw and Pass are built into Card Hand');
  check(WidgetRenderer.render({type:'cardDrawButton'},doc)==='','Standalone Draw Button no longer renders');
  root=mount();const before=inspected.length;await click(root,'.sd-hand-flip');
  check(stack.cards.get('c0').face===null&&inspected.length===before,'Flip control does not inspect card');
  check(renderCardHand(widget,stack).includes(stack.cards.get('c0').back.img.replaceAll("'",'&#39;')),'Face-down card uses back image');
  stack.cards.get('c0').face=0;root.remove();
  root=mount({},doc,true);const hookCount=hooks.length;await click(root,'.sd-hand-open');
  check(hooks.length===hookCount&&inspected.length===before,'Edit mode does not execute cards');root.remove();
  check((renderCardHand({...widget,maxVisible:2},stack).match(/class="sd-hand-open"/g)||[]).length===2,'Explicit visible limit supported');
  check(renderCardHand({...widget,maxVisible:2},stack).includes('data-hand-action="stack"'),'Truncated hand has open-full-hand control');
  check(renderCardHand(widget,null).includes('sd-hand-empty'),'Missing stack has empty state');
  const many={...stack,cards:Array.from({length:23},(_,i)=>({...stack.cards.get('c0'),id:String(i)}))};
  check((renderCardHand({...widget,variant:'fan'},many).match(/class="sd-hand-fan"/g)||[]).length===3,'Large hands split into accessible fans');
  registerNodeActionHandler('qa_card_capture',async ctx=>{captures.push({runtime:{...ctx.runtime},actor:ctx.actor?.uuid,item:ctx.item?.uuid});});
  registerNodeActionHandler('qa_card_write',async ctx=>{ctx.runtime.sharedTest=42;});
  doc.system.sdTriggerGraph={_events:{hand:{hook:'sdSheetWidgetEvent',data:{key:'my_hand',event:'any'},actions:[{type:'qa_card_write'},{type:'qa_card_capture'}]}}};
  root=mount({clickAction:'blueprint'});
  for(const event of ['click','dblclick','contextmenu'])await click(root,'.sd-hand-open',event);
  check(captures.length===3,'Sheet Blueprint receives click, double click and right click');
  check(captures.every(c=>c.runtime.__sheetWidgetValue==='Cards.hand.Card.c0'&&c.runtime.__cardClickedId==='c0'&&c.runtime.sharedTest===42),'Card context and intermediate action state reach graph');
  root.remove();
  const item={...doc,documentName:'Item',uuid:'Item.qa',actor:doc};
  await emitSheetWidgetEvent(item,{widgetKey:'my_hand',event:'click'});
  check(captures.at(-1).item===item.uuid&&captures.at(-1).actor===doc.uuid,'Item graph retains item and actor context');
  doc.system.sdTriggerGraph=null;
  const previousCaptures=captures.length;
  root=mount({clickAction:'runGraph',runGraphOn:'dblclick',actionGraph:JSON.stringify([{type:'qa_card_capture'}])});
  await click(root,'.sd-hand-open');
  check(captures.length===previousCaptures,'Legacy graph respects saved double-click trigger');
  await click(root,'.sd-hand-open','dblclick');
  check(captures.length===previousCaptures+1&&captures.at(-1).runtime.__cardClickedId==='c0','Saved legacy card graph remains executable');root.remove();
  for(const type of Object.keys(WIDGET_TYPES)) {
    const w=createWidget(type);w.id=`config-${type}`;
    if(type==='cardHand'){w.clickAction='runGraph';w.actionGraph='[]';}
    if(type==='widgetBuilder')w.elements=[{id:'value',name:'Value',kind:'value',clickable:true}];
    const popup=await openWidgetConfigPopup(w,{id:'t',rows:[]},{id:'r',widgets:[w]},doc);
    await tick();
    check(popup.querySelectorAll('[data-open-sheet-blueprint]').length===1,`${type}: one Sheet Blueprint entry`);
    check(!popup.querySelector('[data-open-action-graph],[data-open-graph],.wb-vout,.wb-event,[data-field="actionGraph"],[data-field="runGraphOn"]'),`${type}: no private graph controls`);
    if(type==='cardHand')check(popup.querySelector('[data-field="clickAction"]').value==='blueprint','Legacy graph mode maps to Sheet Blueprint');
    popup.querySelector('#wcfg-cancel').click();await tick();
  }
  const {installSearchableSelects,nodeFileType}=await import('../module/helpers/editor-controls.mjs');
  const {FormulaGraph,NODE_DEFS,SD_NODE_REGISTRY}=await import('../module/builder/formula-graph.mjs');
  const {registerModelNodes}=await import('../module/three/model-nodes.mjs');
  const {registerMusicNodes}=await import('../module/builder/music-nodes.mjs');
  registerModelNodes(SD_NODE_REGISTRY);registerMusicNodes(SD_NODE_REGISTRY);installSearchableSelects();
  check(nodeFileType({key:'path',type:'path',label:'Actor path'})===null,'Document property path is not a file');
  check(nodeFileType({key:'icon',type:'text',label:'FA Icon'})===null,'Font Awesome icon is not a file');
  check(nodeFileType({key:'icon',type:'text',label:'Effect icon'})==='image','Effect icon gets image picker');
  const picks=[];
  foundry.applications.apps={FilePicker:class {constructor(options){this.options=options;}async render(){picks.push(this.options.type);this.options.callback('worlds/test/chosen.asset');}}};
  const editor=Object.create(FormulaGraph.prototype);editor._updatePreview=()=>{};editor._renderNode=()=>{};
  const modelWidget=createWidget('model3d',{src:'/fixture.glb',previewMode:true,hotspots:[{id:'door',x:0,y:0,z:0}]});
  const modelPopup=await openWidgetConfigPopup(modelWidget,{id:'t',rows:[]},{id:'r',widgets:[modelWidget]},doc,{embedded:true,onSave:()=>{}});
  check(modelPopup.querySelector('[data-field="previewMode"]').checked,'3D widget has a preview-mode checkbox');
  check(!!modelPopup.querySelector('[data-edit-model-points]'),'3D widget has point editor');
  check(JSON.parse(modelPopup.querySelector('[data-field="hotspots"]').value)[0].id==='door','3D point draft restores saved data');
  modelPopup.querySelector('[data-fp-target="src"]').click();await tick();
  check(picks.at(-1)==='any'&&modelPopup.querySelector('[data-field="src"]').value==='worlds/test/chosen.asset','3D model picker accepts model files and updates path');
  modelPopup.querySelector('[data-fp-target="previewImage"]').click();await tick();
  check(picks.at(-1)==='image','3D preview has image picker');
  modelPopup.querySelector('#wcfg-cancel').click();await tick();
  check(modelWidget.src==='/fixture.glb','Cancelling 3D settings leaves widget unchanged');
  check(WidgetRenderer.render(modelWidget,doc).includes('sd-model-widget'),'Registered 3D widget renders inside sheet');
  const pointEvent={id:'point-action',type:'on_model3d_point_action',data:{widgetKey:modelWidget.id,pointId:'door',event:'hover'}};
  editor.nodes=[pointEvent];editor.edges=[];editor.doc={system:{customTabs:[{rows:[{widgets:[modelWidget]}]}]}};
  const pointPicker=editor._fldEl(pointEvent,NODE_DEFS.on_model3d_point_action.fields.find(f=>f.key==='pointId'));
  check(pointPicker.querySelector('select').value==='door'&&pointPicker.querySelector('option[value="door"]'),'Point Action lists points belonging to the selected 3D widget');
  const actionPicker=editor._fldEl(pointEvent,NODE_DEFS.on_model3d_point_action.fields.find(f=>f.key==='event'));
  check([...actionPicker.querySelector('select').options].map(o=>o.value).join(',')==='hover,click','Point Action offers Hover and Click');
  const pointField=NODE_DEFS.model3d_primitive.fields.find(f=>f.key==='hotspots');
  const pointControl=editor._fldEl({id:'point-editor',type:'model3d_primitive',data:{hotspots:'[]'}},pointField);
  check(pointControl.querySelector('button')&&!pointControl.querySelector('textarea,input'),'Show 3D has a point-editor button instead of raw JSON');
  const {registerHoverNodes}=await import('../module/builder/hover-nodes.mjs');registerHoverNodes(SD_NODE_REGISTRY);
  editor._smartIndex={widgets:[{key:'hp',label:'Health',type:'number'}]};
  const hoverControl=editor._fldEl({id:'hover',type:'on_hover',data:{key:'hp'}},NODE_DEFS.on_hover.fields[0]);
  check(hoverControl.querySelector('select')?.value==='hp','On Hover exposes the existing searchable widget selector');
  let fileCount=0;
  for(const [type,def] of Object.entries(NODE_DEFS))for(const field of def.fields??[]){
    const fileType=nodeFileType(field,type);if(!fileType)continue;
    const node={id:'file-'+fileCount,type,data:{}};
    const control=editor._fldEl(node,field);scratch.append(control);
    const picker=control.querySelector('.sd-file-picker');check(!!picker,`${type}.${field.key}: file picker present`);
    picker.click();await tick();
    check(node.data[field.key]==='worlds/test/chosen.asset'&&picks.at(-1)===fileType,`${type}.${field.key}: picker updates node and retains manual path`);
    control.remove();fileCount++;
  }
  check(fileCount>=14,'File fields covered across core and extension nodes');
  const controls=document.createElement('section');controls.className='qa-panel';controls.id='qa-controls';
  controls.innerHTML='<h2>Селекторы с поиском</h2><select aria-label="Search test"><option value="a">Огонь</option><option value="b">Лёд</option><option disabled value="c">Disabled</option><optgroup disabled label="Unavailable"><option value="d">Disabled group</option></optgroup></select><select aria-label="Multiple test" multiple><option value="one">One</option><option value="two">Two</option></select>';
  document.querySelector('main').append(controls);
  check(errors.length===0,'No notification errors');
  window.qa={checks,errors,inspected,hooks,calls,stack,doc};
  document.querySelector('#result').textContent=`PASS · ${checks.length} проверок`;document.title='READY';
} catch(error) { document.querySelector('#result').textContent=error.stack;document.title='FAIL';throw error; }
