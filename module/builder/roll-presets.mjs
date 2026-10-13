import { openFoundryWindow } from "../helpers/foundry-window-host.mjs";
import { getValueDefinitions, valueStoragePath } from "../helpers/value-database.mjs";

const clone = value => foundry.utils.deepClone(value);
const esc = value => String(value ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const integer = (value,fallback,min=1,max=100000) => Number.isFinite(Number(value)) ? Math.max(min,Math.min(max,Math.floor(Number(value)))) : fallback;
export const ROLL_PRESET_KEYS = ["normal","advantage","disadvantage"];
export const ROLL_PRESET_LABELS = {normal:"Normal roll",advantage:"Advantage",disadvantage:"Disadvantage"};

export function normalizeDiceTerm(term = {}) {
  const count=integer(term.count,1,1,999), sides=integer(term.sides,20,2);
  return {count,sides,keep:["highest","lowest"].includes(term.keep)?term.keep:"all",keepCount:integer(term.keepCount,1,1,count)};
}
export function normalizeRollPreset(source = {}) {
  return {mode:source.mode === "formula" ? "formula" : "constructor",formula:String(source.formula ?? "1d20"),
    diceTerms:(source.diceTerms?.length?source.diceTerms:[{count:1,sides:20}]).map(normalizeDiceTerm),
    flatModifier:Number.isFinite(Number(source.flatModifier))?Number(source.flatModifier):0,
    variableTerms:(Array.isArray(source.variableTerms)?source.variableTerms:[]).filter(t=>t?.variableId).map(t=>({variableId:String(t.variableId),operator:t.operator==="-"?"-":"+"})),
    widgetTerms:(Array.isArray(source.widgetTerms)?source.widgetTerms:[]).filter(t=>t?.widgetKey).map(t=>({widgetKey:String(t.widgetKey),operator:t.operator==="-"?"-":"+"}))};
}
export function diceTermFormula(term) {
  const value=normalizeDiceTerm(term);
  return `${value.count}d${value.sides}${value.keep==="all"?"":`${value.keep==="highest"?"kh":"kl"}${value.keepCount}`}`;
}
export function buildRollPresetFormula(source) {
  const p=normalizeRollPreset(source);
  if(p.mode==="formula")return p.formula.trim() || "1d20";
  let formula=p.diceTerms.map(diceTermFormula).join(" + ");
  if(p.flatModifier)formula+=` ${p.flatModifier<0?"-":"+"} ${Math.abs(p.flatModifier)}`;
  for(const term of p.variableTerms)formula+=` ${term.operator} {${valueStoragePath(term.variableId)}}`;
  for(const term of p.widgetTerms)formula+=` ${term.operator} {widget:${term.widgetKey}}`;
  return formula;
}

/** Parse only the supported simple grammar; never guess complex Foundry expressions. */
export function rollPresetFromFormula(formula = "1d20") {
  const raw=String(formula).trim();
  const parts=raw.match(/[+-]?\s*(?:\{[^{}]+\}|\d+(?:\.\d+)?d\d+(?:(?:kh|kl)\d*)?|\d+(?:\.\d+)?)/gi) ?? [];
  if(!parts.length || parts.join("").replace(/\s/g,"") !== raw.replace(/\s/g,""))return normalizeRollPreset({mode:"formula",formula:raw});
  const diceTerms=[],variableTerms=[],widgetTerms=[];let flatModifier=0;
  for(const part of parts){
    const operator=part.trim().startsWith("-")?"-":"+",text=part.trim().replace(/^[+-]\s*/,"");
    const dice=text.match(/^(\d+)d(\d+)(?:(kh|kl)(\d*))?$/i);
    if(dice){if(operator==="-")return normalizeRollPreset({mode:"formula",formula:raw});diceTerms.push({count:Number(dice[1]),sides:Number(dice[2]),keep:dice[3]?.toLowerCase()==="kh"?"highest":dice[3]?"lowest":"all",keepCount:Number(dice[4] || 1)});continue;}
    const db=text.match(/^\{system\.values\.([^{}]+)\}$/),widget=text.match(/^\{widget:([^{}]+)\}$/);
    if(db)variableTerms.push({variableId:db[1],operator});
    else if(widget)widgetTerms.push({widgetKey:widget[1],operator});
    else if(/^\d+(?:\.\d+)?$/.test(text))flatModifier+=(operator==="-"?-1:1)*Number(text);
    else return normalizeRollPreset({mode:"formula",formula:raw});
  }
  if(!diceTerms.length)return normalizeRollPreset({mode:"formula",formula:raw});
  return normalizeRollPreset({mode:"constructor",diceTerms,variableTerms,widgetTerms,flatModifier});
}
export function normalizeRollPresets(source, seed = {}) {
  const normal=source?.normal ? normalizeRollPreset(source.normal) : rollPresetFromFormula(seed.formula || "1d20");
  const variant=(key,formula)=>{
    if(source?.[key])return normalizeRollPreset(source[key]);
    if(formula)return rollPresetFromFormula(formula);
    const value=clone(normal);
    if(value.mode==="constructor")value.diceTerms=value.diceTerms.map(d=>({...d,count:Math.min(999,d.count*2),keep:key==="advantage"?"highest":"lowest",keepCount:d.count}));
    return normalizeRollPreset(value);
  };
  return {normal,advantage:variant("advantage",seed.advFormula),disadvantage:variant("disadvantage",seed.disFormula)};
}
export function applyRollPresetsToStep(step) {
  if(!step?.rollPresets)return step;
  step.rollPresets=normalizeRollPresets(step.rollPresets);
  step.formula=buildRollPresetFormula(step.rollPresets.normal);
  step.advFormula=buildRollPresetFormula(step.rollPresets.advantage);
  step.disFormula=buildRollPresetFormula(step.rollPresets.disadvantage);
  return step;
}

/** Same constructor for Quick Actions and Easy Button, with independent settings per mode. */
export function openRollPresetsEditor(source = null, doc = null, seed = {}) {
  const state=normalizeRollPresets(source,seed);let active="normal",app,settled=false;
  const root=document.createElement("div");root.className="sd-roll-presets-editor";
  const variables=getValueDefinitions(doc?.documentName==="Item"?"item":"actor").filter(v=>["number","integer"].includes(v.type));
  return new Promise(resolve=>{
    const finish=async value=>{if(settled)return;settled=true;resolve(value);await app?.close?.({sdSkipCallback:true});};
    const sync=()=>{
      const p=state[active];
      root.querySelectorAll("[data-preset-field]").forEach(input=>p[input.dataset.presetField]=input.type==="number"?Number(input.value):input.value);
      if(root.querySelector("[data-preset-die]"))p.diceTerms=[...root.querySelectorAll("[data-preset-die]")].map(row=>Object.fromEntries([...row.querySelectorAll("[data-die-field]")].map(input=>[input.dataset.dieField,input.type==="number"?Number(input.value):input.value])));
      if(root.querySelector("[data-add-preset-variable]"))p.variableTerms=[...root.querySelectorAll("[data-preset-variable]")].map(row=>({operator:row.querySelector("[data-mod-operator]").value,variableId:row.querySelector("[data-mod-variable]").value}));
      state[active]=normalizeRollPreset(p);
    };
    const preview=()=>{const el=root.querySelector("[data-preset-preview]");if(el)el.textContent=buildRollPresetFormula(state[active]);};
    const render=()=>{
      const p=state[active];
      root.innerHTML=`<header><b>Roll Constructor</b><small>Each roll mode has its own dice, kept results and Database modifiers.</small></header>
        <nav>${ROLL_PRESET_KEYS.map(key=>`<button type="button" data-preset-tab="${key}" class="${key===active?"active":""}">${ROLL_PRESET_LABELS[key]}</button>`).join("")}</nav>
        <main><label>Build mode<select data-preset-field="mode"><option value="constructor" ${p.mode==="constructor"?"selected":""}>Dice + modifiers</option><option value="formula" ${p.mode==="formula"?"selected":""}>Custom formula</option></select></label>
        ${p.mode==="formula"?`<label>Formula<textarea data-preset-field="formula">${esc(p.formula)}</textarea></label>`:`
        <h4>Dice</h4>${p.diceTerms.map((term,i)=>`<div class="sdrp-die" data-preset-die="${i}">
          <label>Count<input type="number" data-die-field="count" min="1" max="999" value="${term.count}"></label>
          <label>Sides<input type="number" data-die-field="sides" min="2" value="${term.sides}"></label>
          <label>Count results<select data-die-field="keep">${[["all","All"],["highest","Highest"],["lowest","Lowest"]].map(([v,label])=>`<option value="${v}" ${term.keep===v?"selected":""}>${label}</option>`).join("")}</select></label>
          <label>Keep count<input type="number" data-die-field="keepCount" min="1" max="${term.count}" value="${term.keepCount}" ${term.keep==="all"?"disabled":""}></label>
          <button type="button" data-remove-preset-die="${i}" ${p.diceTerms.length===1?"disabled":""} aria-label="Remove dice">×</button></div>`).join("")}
        <button type="button" data-add-preset-die>+ Add dice</button>
        <h4>Modifiers</h4><label>Constant modifier<input type="number" data-preset-field="flatModifier" step="any" value="${p.flatModifier}"></label>
        ${p.variableTerms.map((term,i)=>`<div class="sdrp-mod" data-preset-variable="${i}"><select data-mod-operator aria-label="Operator"><option ${term.operator!=="-"?"selected":""}>+</option><option ${term.operator==="-"?"selected":""}>-</option></select>
        <select data-mod-variable aria-label="Database modifier"><option value="">Select Database variable…</option>${!variables.some(v=>v.id===term.variableId)?`<option value="${esc(term.variableId)}" selected>${esc(term.variableId)} (missing)</option>`:""}${variables.map(v=>`<option value="${esc(v.id)}" ${v.id===term.variableId?"selected":""}>${esc(v.name)} [${esc(v.id)}]</option>`).join("")}</select><button type="button" data-remove-preset-variable="${i}" aria-label="Remove modifier">×</button></div>`).join("")}
        <button type="button" data-add-preset-variable ${variables.length?"":"disabled"}>+ Database modifier</button>
        ${active!=="normal"?'<button type="button" data-copy-normal-modifiers>Copy normal modifiers</button>':""}
        ${p.widgetTerms.length?`<small>Also includes ${p.widgetTerms.length} widget modifier(s) from Easy Button.</small>`:""}`}</main>
        <div class="sdrp-preview"><span>${ROLL_PRESET_LABELS[active]}</span><code data-preset-preview>${esc(buildRollPresetFormula(p))}</code></div>
        <footer><button type="button" data-cancel-presets>Cancel</button><button type="button" data-save-presets>Save roll settings</button></footer>`;
      root.querySelectorAll("[data-preset-tab]").forEach(button=>button.addEventListener("click",()=>{sync();active=button.dataset.presetTab;render();}));
      root.querySelector('[data-preset-field="mode"]')?.addEventListener("change",event=>{sync();if(event.target.value==="formula")state[active].formula=buildRollPresetFormula({...state[active],mode:"constructor"});render();});
      root.querySelectorAll('[data-die-field="keep"]').forEach(input=>input.addEventListener("change",()=>{sync();render();}));
      root.querySelectorAll("input,select,textarea").forEach(input=>input.addEventListener("input",()=>{sync();preview();}));
      root.querySelector("[data-add-preset-die]")?.addEventListener("click",()=>{sync();state[active].diceTerms.push(normalizeDiceTerm({count:1,sides:6}));render();});
      root.querySelectorAll("[data-remove-preset-die]").forEach(button=>button.addEventListener("click",()=>{sync();if(state[active].diceTerms.length>1)state[active].diceTerms.splice(Number(button.dataset.removePresetDie),1);render();}));
      root.querySelector("[data-add-preset-variable]")?.addEventListener("click",()=>{sync();state[active].variableTerms.push({operator:"+",variableId:variables[0].id});render();});
      root.querySelectorAll("[data-remove-preset-variable]").forEach(button=>button.addEventListener("click",()=>{sync();state[active].variableTerms.splice(Number(button.dataset.removePresetVariable),1);render();}));
      root.querySelector("[data-copy-normal-modifiers]")?.addEventListener("click",()=>{sync();for(const key of ["variableTerms","widgetTerms","flatModifier"])state[active][key]=clone(state.normal[key]);render();});
      root.querySelector("[data-cancel-presets]").addEventListener("click",()=>finish(null));
      root.querySelector("[data-save-presets]").addEventListener("click",()=>{sync();finish(normalizeRollPresets(state));});
    };
    render();app=openFoundryWindow({id:`sd-roll-presets-${seed.id??Math.random().toString(36).slice(2,8)}`,title:"Roll Constructor — Normal / Advantage / Disadvantage",width:760,height:650,minWidth:440,minHeight:420,content:root,onClose:()=>finish(null)});
  });
}
