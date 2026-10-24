import { QUICK_ACTION_STEPS, normalizeQuickActions, normalizeQuickStep, compileQuickActions } from "./quick-actions.mjs";
import { normalizeRollPresets, normalizeRollPreset, rollPresetFromFormula } from "./roll-presets.mjs";
import { buildEasyButtonFormula } from "./easy-button-wizard.mjs";
import { collectSheetWidgets, matchesSheetWidgetEvent, sheetWidgetGraphEvents } from "../helpers/sheet-widget-events.mjs";

const clone = value => foundry.utils.deepClone(value);
const queues = new WeakMap();
const configQueues = new WeakMap();
const openGraphs = new WeakMap();

/** Every quick step has an editable, typed node; rolls and cards use the native nodes. */
export function registerQuickActionGraphNodes(definitions) {
  for (const [kind, step] of Object.entries(QUICK_ACTION_STEPS)) {
    if (["roll", "composer"].includes(kind)) continue;
    definitions[`quick_${kind}`] = {
      title:step.label, color:"#7356a3", cat:"Flow Control", wideNode:true,
      desc:step.hint, isAction:true,
      hidden:step.hidden === true, replacement:step.replacement,
      inputs:[{id:"exec",label:"",type:"exec"}], outputs:[{id:"exec",label:"Done →",type:"exec"}],
      fields:step.fields.map(field=>({...field, type:field.type === "checkbox" ? "bool" : ["uuid","file"].includes(field.type) ? "text" : field.type,
        options:typeof field.options === "function" ? (node,graph)=>field.options({scope:graph?.doc?.documentName==="Item"?"item":"actor"}) : field.options})),
      toAction:(node,inputs)=>compileQuickActions([{...node.data,...inputs,kind}])[0]
    };
  }
}

function widgetSpecs(widget) {
  const specs=[];
  const quick=normalizeQuickActions(widget.quickActions);
  if (quick.steps.length) specs.push({source:"quick",event:quick.event,steps:quick.steps});
  if ((widget.type === "easyButton" || widget.type === "dice") && !(quick.steps.length && ["click","any"].includes(quick.event))) {
    let steps;
    if (widget.easyMode === "actions") steps=normalizeQuickActions({steps:widget.actionSteps}).steps;
    else {
      // Advanced fallback stores actions in formula; the constructor is still the source of truth.
      let formula = widget.type === "dice" ? widget.formula : buildEasyButtonFormula({...widget, easyMode:widget.easyMode === "formula" ? "formula" : "constructor"});
      steps=[normalizeQuickStep({kind:"roll",formula,label:widget.flavor || widget.label,advFormula:widget.advFormula,disFormula:widget.disFormula,dialog:widget.rollDialogue,rollMode:widget.rollMode,rollPresets:widget.rollPresets})];
      if (widget.rollComposer) steps.push(normalizeQuickStep({kind:"composer",title:widget.composerTitle || widget.label,message:widget.composerMessage,includeRoll:true,
        visibility:widget.rollMode === "selfroll" ? "self" : ["gmroll","blindroll"].includes(widget.rollMode) ? "gm" : "public"}));
    }
    if (steps.length) specs.push({source:"roll",event:"click",steps,useConstructor:widget.easyMode!=="actions"&&widget.easyMode!=="formula"&&widget.type==="easyButton"});
  }
  return specs;
}

/** Materialize only changed quick settings; preserve manual graph edits on unchanged settings. */
export function materializeWidgetQuickGraph(graph) {
  if (!graph.sheetTrigger || !graph.doc) return false;
  let changed=false;
  const widgets=collectSheetWidgets(graph.doc);
  const wanted=new Set();
  for (const widget of widgets) for (const spec of widgetSpecs(widget)) {
    const owner=String(widget.id || widget.widgetKey); if (!owner) continue;
    const group=`${owner}:${spec.source}`; wanted.add(group);
    const cleanSteps=spec.steps.map(step=>{const value=clone(step);delete value.id;return value;});
    const signature=JSON.stringify({revision:4,key:widget.widgetKey || widget.id,label:widget.label,steps:cleanSteps,event:spec.event,constructor:spec.useConstructor,
      dice:spec.useConstructor?widget.diceTerms:undefined,vars:spec.useConstructor?widget.variableTerms:undefined,widgets:spec.useConstructor?widget.widgetTerms:undefined});
    const previous=graph.nodes.filter(n=>n.data?.__quickGroup===group);
    const root=previous.find(n=>n.type==="sheet_widget_event");
    if (root?.data?.__quickSignature===signature) continue;
    changed=true;
    const oldIds=new Set(previous.map(n=>n.id));
    const positions=new Map(previous.map(n=>[n.id,{x:n.x,y:n.y}]));
    graph.nodes=graph.nodes.filter(n=>!oldIds.has(n.id));
    // Keep user connections across group boundaries if their endpoints survive regeneration.
    graph.edges=graph.edges.filter(e=>!(oldIds.has(e.fromNode)&&oldIds.has(e.toNode)));
    let sequence=0;
    const baseY=root?.y ?? Math.max(0,...graph.nodes.map(n=>Number(n.y)||0))+500;
    const baseX=root?.x ?? 60;
    const create=(type,data={},x=null,y=null)=>{
      const id=`qa_${encodeURIComponent(group).replace(/%/g,"_")}_${sequence++}`;
      const node={id,type,x:x??baseX+sequence*350,y:y??baseY,data:{...clone(data),__quickGroup:group}};
      if(positions.has(id))Object.assign(node,positions.get(id));
      graph.nodes.push(node);return node;
    };
    const connect=(from,fromPin,to,toPin)=>graph.edges.push({id:`qe_${from.id}_${fromPin}_${to.id}_${toPin}`,fromNode:from.id,fromPin,toNode:to.id,toPin});
    const event=create("sheet_widget_event",{key:widget.widgetKey||widget.id,widgetId:widget.id,event:spec.event,__quickSource:spec.source,__quickSignature:signature},baseX,baseY);
    const build=(steps,entry,pin="exec",branchY=baseY,depth=0)=>{
      if(depth>8)throw new Error("Quick Actions nesting exceeds 8 levels");
      let last=entry,lastPin=pin,roll=null;
      for(let index=0;index<steps.length;index++){
        const step=normalizeQuickStep(steps[index]);let node;
        if(step.kind==="roll") {
          node=create("act_roll_v2",{mode:"formula",formula:step.formula,flavor:step.label||widget.label,rollDialogue:step.dialog?"yes":"no",advFormula:step.advFormula,disFormula:step.disFormula},null,branchY);
          connect(last,lastPin,node,"exec");roll=node;
          const normalPreset=step.rollPresets?.normal ?? (spec.useConstructor&&depth===0&&index===0 ? normalizeRollPreset({diceTerms:widget.diceTerms,variableTerms:widget.variableTerms,widgetTerms:widget.widgetTerms}) : rollPresetFromFormula(step.formula));
          const presets={normal:normalPreset,advantage:step.rollPresets?.advantage ?? (step.advFormula?rollPresetFromFormula(step.advFormula):null),disadvantage:step.rollPresets?.disadvantage ?? (step.disFormula?rollPresetFromFormula(step.disFormula):null)};
          let modeIndex=0;
          for(const [mode,presetSource] of Object.entries(presets)){
            modeIndex++;if(!presetSource)continue;
            const preset=normalizeRollPreset(presetSource),formulaY=branchY-300*modeIndex;
            if(preset.mode==="formula")continue; // arbitrary custom syntax stays on the Roll field
            let formulaNode=null;
            for(const term of preset.diceTerms){
              const suffix=term.keep==="all"?"":`${term.keep==="highest"?"kh":"kl"}${term.keepCount}`;
              const die=create("dice",{count:term.count,die:`d${term.sides}${suffix}`,__quickRollMode:mode},null,formulaY);
              if(!formulaNode)formulaNode=die;
              else {const add=create("formula_add",{__quickRollMode:mode},null,formulaY);connect(formulaNode,"v",add,"formula");connect(die,"v",add,"mod");formulaNode=add;}
            }
            if(preset.flatModifier){const add=create("formula_add",{mod:String(preset.flatModifier),__quickRollMode:mode},null,formulaY);connect(formulaNode,"v",add,"formula");formulaNode=add;}
            for(const [type,terms] of [["get_value",preset.variableTerms],["get_widget",preset.widgetTerms]])for(const term of terms){
              let value=create(type,{...(type==="get_value"?{source:"self",variableId:term.variableId}:{key:term.widgetKey}),__quickRollMode:mode},null,formulaY);
              if(term.operator==="-"){const negative=create("quick_negate",{__quickRollMode:mode},null,formulaY);connect(value,"v",negative,"value");value=negative;}
              const add=create("formula_add",{__quickRollMode:mode},null,formulaY);connect(formulaNode,"v",add,"formula");connect(value,"v",add,"mod");formulaNode=add;
            }
            connect(formulaNode,"v",node,mode==="normal"?"formula":mode==="advantage"?"advFormula":"disFormula");
          }
          last=node;lastPin="exec";
          if(!(steps[index+1]?.kind==="composer"&&steps[index+1]?.includeRoll)){
            const present=create("act_present_roll",{destination:"chat",label:step.label||widget.label,text:"",rollMode:step.rollMode},null,branchY);
            connect(node,"exec",present,"exec");connect(node,"result",present,"result");last=present;
          }
          continue;
        }
        if(step.kind==="composer") {
          // Native Composer uses fixed btn0..5 / field0..7 slots. Disable unused default Apply button.
          const buttons=Array.from({length:6},(_,i)=>({...step.buttons[i],id:`btn${i}`,enabled:!!step.buttons[i]&&step.buttons[i].enabled!==false}));
          const controls=step.controls.map((control,i)=>({...control,id:`field${i}`}));
          node=create("act_message_composer",{...step,buttons,controls},null,branchY);
          if(step.includeRoll&&roll)connect(roll,"result",node,"rollResult");
          for(let i=0;i<buttons.length;i++)if(buttons[i].enabled&&buttons[i].steps?.length)build(buttons[i].steps,node,`btn${i}`,branchY+450*(i+1),depth+1);
          lastPin && connect(last,lastPin,node,"exec");last=node;lastPin="posted";continue;
        }
        node=create(`quick_${step.kind}`,step,null,branchY);
        connect(last,lastPin,node,"exec");last=node;lastPin="exec";
      }
    };
    build(spec.steps,event);
    const ids=new Set(graph.nodes.map(n=>n.id));
    graph.edges=graph.edges.filter(e=>ids.has(e.fromNode)&&ids.has(e.toNode));
  }
  const removed=new Set(graph.nodes.filter(n=>n.data?.__quickGroup&&!wanted.has(n.data.__quickGroup)).map(n=>n.id));
  if(removed.size){changed=true;graph.nodes=graph.nodes.filter(n=>!removed.has(n.id));graph.edges=graph.edges.filter(e=>!removed.has(e.fromNode)&&!removed.has(e.toNode));}
  return changed;
}

/** Serialise saves per document so concurrent config windows cannot overwrite branches. */
export function syncWidgetQuickGraph(doc) {
  const previous=queues.get(doc) ?? Promise.resolve();
  const next=previous.catch(()=>{}).then(async()=>{
    const { FormulaGraph }=await import("./formula-graph.mjs");
    const graph=new FormulaGraph(null,doc,null,null,null,{mode:"sheetTrigger"});
    if(graph._quickGraphChanged)await graph._saveGraph();
    refreshOpenWidgetQuickGraphs(doc);
    return graph;
  });
  queues.set(doc,next);
  return next;
}

/** Only skip a legacy handler when a persisted compiled graph actually owns this click. */
export function widgetGraphHandlesClick(doc, widgetOrControl) {
  const widget=widgetOrControl?.closest ? {id:widgetOrControl.closest("[data-widget-id]")?.dataset.widgetId,widgetKey:widgetOrControl.closest("[data-widget-key]")?.dataset.widgetKey} : widgetOrControl;
  if(!widget?.id&&!widget?.widgetKey)return false;
  return sheetWidgetGraphEvents(doc).some(entry=>["roll","quick"].includes(entry.data?.__quickSource)&&matchesSheetWidgetEvent(entry.data,{event:"click",widgetId:widget.id,widgetKey:widget.widgetKey}));
}


export function watchWidgetQuickGraph(graph) {
  let graphs=openGraphs.get(graph.doc);if(!graphs)openGraphs.set(graph.doc,graphs=new Set());
  graphs.add(graph);return ()=>graphs.delete(graph);
}
export function refreshOpenWidgetQuickGraphs(doc) {
  for(const graph of openGraphs.get(doc) ?? []){
    if(!graph.win)continue;
    if(materializeWidgetQuickGraph(graph)){
      graph._sanitizeGraph();graph._smartIndex=graph._buildSmartIndex();graph._pushHistory();graph._renderAll();
    }
  }
}
/** Save the nested editor's changes now, not only in the outer popup's hidden fields. */
export function saveWidgetQuickSettings(doc, widget, changes) {
  if(!doc?.update)return Promise.resolve(false);
  const previous=configQueues.get(doc) ?? Promise.resolve();
  const next=previous.catch(()=>{}).then(async()=>{
    const tabs=clone(doc.system?.customTabs ?? []);let target=null;
    const walk=widgets=>{for(const value of widgets??[]){if(value?.id===widget?.id)target=value;walk(value?.widgets);walk((value?.elements??[]).map(e=>e?.widget).filter(Boolean));}};
    for(const tab of tabs)for(const row of tab.rows??[])walk(row.widgets);
    if(!target)return false; // new embedded draft: its parent editor still owns persistence
    Object.assign(target,clone(changes));
    await doc.update({"system.customTabs":tabs},{sdSkipEventBus:true});
    await syncWidgetQuickGraph(doc);
    return true;
  });
  configQueues.set(doc,next);
  return next;
}
