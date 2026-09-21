import './test-3d-nodes.mjs';
import assert from 'node:assert/strict';
import {EVENT_BUS} from '../module/helpers/event-bus.mjs';
import {captureUpdateValues,changedDatabaseVariables} from '../module/helpers/document-update-values.mjs';
import {widgetValueSnapshot,emitWidgetValueChanges,installWidgetCommitEvents} from '../module/helpers/sheet-widget-commits.mjs';
import {matchesSheetWidgetEvent} from '../module/helpers/sheet-widget-events.mjs';

globalThis.CONFIG={SD:{}};
game.user={id:'local'};
game.settings.get=()=>({database:[{id:'a',type:'number',initial:0},{id:'b',type:'number',initial:0,legacyPath:'system.attributes.str.value'}]});
const hooks=new Map(),events=[];
Hooks.on=(name,fn)=>{const list=hooks.get(name)??[];list.push(fn);hooks.set(name,list);return list.length;};
Hooks.callAll=(name,payload)=>{if(name==='sdSheetWidgetEvent')events.push(payload);};
const doc={id:'actor',uuid:'Actor.actor',documentName:'Actor',system:{values:{a:1,b:2},customTabs:[]}};
const diff={'system.values.a':3,'system.values.b':4},options={};
captureUpdateValues(doc,diff,options);doc.system.values={a:3,b:4};
for(const variableId of ['a','b']){
 const entry={eventHook:'updateDocument',docUuid:doc.uuid,data:{variableId}};
 assert.equal(EVENT_BUS._matchesSynthetic('updateActor',[doc,diff,options],entry),true);
 const runtime=EVENT_BUS._buildRuntime(entry,[doc,diff,options]);
 assert.equal(runtime.__eventOldValue,variableId==='a'?1:2);assert.equal(runtime.__eventNewValue,variableId==='a'?3:4);
}
assert.deepEqual(changedDatabaseVariables({system:{values:{a:0,b:0}}}),['a','b']);
assert.deepEqual(changedDatabaseVariables({'system.attributes.str.value':12}),['b']);
assert.deepEqual(changedDatabaseVariables({'system.values.-=b':null}),['b']);
const bus=new EVENT_BUS.constructor();
const item={uuid:'Item.test',documentName:'Item',system:{sdTriggerGraph:{_trigger:'multi',_events:{update:{hook:'updateDocument',data:{},actions:[{type:'noop'}]}}}}};
bus._registerWorldItem(item);assert.equal(bus._reg.get('updateItem').size,1,'World items register On Update');
const hook=bus._hookIds.get('updateItem');bus._registerWorldItem(item);assert.equal(bus._hookIds.get('updateItem'),hook,'Rescans preserve hook identity');
assert.equal(bus._matchesSynthetic('updateItem',[{uuid:'Item.other'},{},{}],{eventHook:'updateDocument',docUuid:item.uuid,data:{}}),false);

const widgets=['text','richtext','number','counter','attribute','skill','toggle','select','tags','clock','resource','progress','tracker','tokenPool','derived'].map((type,index)=>({id:`w${index}`,widgetKey:`w${index}`,type,path:`system.widgetVars.w${index}.path`,pathValue:`system.widgetVars.w${index}.pathValue`}));
widgets.push({id:'group',widgetKey:'group',type:'attributeGroup',attributeKeys:['a','b']});
doc.system.customTabs=[{rows:[{widgets:[{id:'container',type:'vsection',widgets}]}]}];
doc.system.widgetVars=Object.fromEntries(widgets.map(w=>[w.widgetKey,{path:w.type==='tags'?[]:0,pathValue:0}]));
for(const widget of widgets){
 const before=widgetValueSnapshot(doc);const count=events.length;
 if(widget.type==='attributeGroup')doc.system.values.b++;
 else if(['resource','progress'].includes(widget.type))doc.system.widgetVars[widget.widgetKey].pathValue=7;
 else doc.system.widgetVars[widget.widgetKey].path=widget.type==='tags'?['tag']:widget.type==='toggle'?true:7;
 await emitWidgetValueChanges(doc,before,{},'local');
 const changes=events.slice(count).filter(e=>e.event==='change');
 assert.equal(changes.length,1,widget.type+' emits one committed change');
 assert.equal(changes[0].widgetId,widget.id);
 if(widget.type==='attributeGroup')assert.equal(changes[0].elementKey,'b');
 if(widget.type==='toggle')assert.equal(events.at(-1).event,'toggle');
 const n=events.length;await emitWidgetValueChanges(doc,widgetValueSnapshot(doc),{},'local');assert.equal(events.length,n,'Unchanged values do not emit');
}
assert.equal(matchesSheetWidgetEvent({event:'update',key:'group'},events.at(-1)),true,'Widget On Update accepts committed change');
const before=widgetValueSnapshot(doc);doc.system.values.b++;
const count=events.length;await emitWidgetValueChanges(doc,before,{},'remote');assert.equal(events.length,count,'Remote clients do not repeat graph execution');
await emitWidgetValueChanges(doc,before,{sdSkipEventBus:true},'local');assert.equal(events.length,count,'Internal saves skip widget events');
installWidgetCommitEvents();assert.ok(hooks.get('preUpdateActor')?.length);assert.ok(hooks.get('updateItem')?.length);assert.ok(hooks.get('createActiveEffect')?.length);
const hookOptions={};
for(const listener of hooks.get('preUpdateActor'))listener(doc,{'system.widgetVars.w3.path':19},hookOptions,'local');
doc.system.widgetVars.w3.path=19;
const hookCount=events.length;
for(const listener of hooks.get('updateActor')??[])await listener(doc,{'system.widgetVars.w3.path':19},hookOptions,'local');
await new Promise(resolve=>setTimeout(resolve,0));
assert.equal(events.length,hookCount+1,'Foundry pre/update hook integration emits one committed event');
doc.items=[];doc.effects=[];
const cards=[{id:'card',name:'Ace',face:0,sort:0}];globalThis.fromUuidSync=()=>({cards});
const extras=[{id:'image',widgetKey:'image',type:'image',path:'system.picture'},{id:'cards',widgetKey:'cards',type:'cardHand',sourceUuid:'Cards.hand'},{id:'inventory',widgetKey:'inventory',type:'inventory'},{id:'effects',widgetKey:'effects',type:'effects'}];
widgets.push(...extras);
for(const [id,mutate] of [['image',()=>doc.system.picture='new.webp'],['cards',()=>cards[0].face=null],['inventory',()=>doc.items.push({id:'sword',type:'inventory',name:'Sword',system:{}})],['effects',()=>doc.effects.push({id:'effect',name:'Bless',changes:[]})]]){
 const snapshot=widgetValueSnapshot(doc),count=events.length;mutate();await emitWidgetValueChanges(doc,snapshot,{},'local');
 assert.equal(events.length,count+1,id+' change emits once');assert.equal(events.at(-1).widgetKey,id);
}
console.log('PASS: widget event coverage across 20 types, nested widgets, On Update filters, old/new values, world items and stable hooks');
