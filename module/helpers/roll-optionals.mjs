import { openFoundryWindow } from "./foundry-window-host.mjs";
const esc = v => String(v ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
export const OPTIONAL_OPERATIONS = {add:"Add",subtract:"Subtract",multiply:"Multiply",divide:"Divide",max:"Greater value (max)",min:"Lesser value (min)",keepHighest:"Keep highest dice",keepLowest:"Keep lowest dice",diceCount:"Dice count"};
export function normalizeRollOptionals(source) {
  return (Array.isArray(source) ? source : []).slice(0,32).map((v,i)=>({id:`optional${i}`,label:String(v.label || `Option ${i+1}`),type:v.type === "checkbox" ? "checkbox" : "number",operation:OPTIONAL_OPERATIONS[v.operation] ? v.operation : "add",value:String(v.value ?? "1"),checked:v.checked === true}));
}
/** Inputs are numeric at the trust boundary; configured formulas never become executable JS. Dice operations affect the first dice group. */
export function applyRollOptionals(formula, source, values = {}, resolve = v => v) {
  let result = String(formula);
  for (const option of normalizeRollOptionals(source)) {
    if (option.type === "checkbox" && !(values[option.id] ?? option.checked)) continue;
    const raw = option.type === "checkbox" ? resolve(option.value) : (values[option.id] ?? resolve(option.value));
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new Error(`Invalid number: ${option.label}`);
    if (["keepHighest","keepLowest","diceCount"].includes(option.operation)) {
      if (!/\b\d+d\d+/i.test(result)) throw new Error(`No dice group for ${option.label}`);
      result = result.replace(/\b(\d+)d(\d+)(?:(kh|kl)(\d*))?/i, (_m,count,sides,keep,kept) => {
        if (option.operation === "diceCount") return `${Math.max(1,Math.min(999,Math.floor(n)))}d${sides}${keep ? `${keep}${Math.min(Number(kept)||1,Math.max(1,Math.floor(n)))}` : ""}`;
        return `${count}d${sides}${option.operation === "keepHighest" ? "kh" : "kl"}${Math.max(1,Math.min(Number(count),Math.floor(n)))}`;
      });
    } else if (option.operation === "max" || option.operation === "min") result = `${option.operation}((${result}), ${n})`;
    else {
      if (option.operation === "divide" && n === 0) throw new Error(`Division by zero: ${option.label}`);
      result = `(${result}) ${{add:"+",subtract:"-",multiply:"*",divide:"/"}[option.operation]} (${n})`;
    }
  }
  return result;
}
export function rollOptionalsInputs(source) {
  return normalizeRollOptionals(source).map(o=>`<label style="display:flex;gap:8px;align-items:center;margin:8px 0"><input data-roll-optional="${o.id}" type="${o.type}" ${o.type === "checkbox" ? (o.checked ? "checked" : "") : `value="${esc(o.value)}" step="any"`}><span>${esc(o.label)}</span></label>`).join("");
}
export function collectRollOptionalValues(root) {
  return Object.fromEntries([...root.querySelectorAll("[data-roll-optional]")].map(input=>[input.dataset.rollOptional,input.type === "checkbox" ? input.checked : input.value]));
}
export function openRollOptionalsEditor(source) {
  let state = normalizeRollOptionals(source), app, settled = false;
  const root = document.createElement("div");
  root.style.cssText="display:flex;flex-direction:column;gap:12px;padding:14px;min-height:0;flex:1;color:var(--sd-text,#eee);background:var(--sd-bg,#171b2b)";
  return new Promise(resolve=>{
    const finish=async value=>{if(settled)return;settled=true;resolve(value);await app?.close?.({sdSkipCallback:true});};
    const sync=()=>root.querySelectorAll("[data-option]").forEach(row=>{const o=state[Number(row.dataset.option)];row.querySelectorAll("[data-field]").forEach(input=>o[input.dataset.field]=input.type === "checkbox" ? input.checked : input.value);});
    const render=()=>{
      root.innerHTML=`<b>Optional roll fields</b><small>Checkboxes apply a configured value only when checked. Number fields let the player enter a value. Dice operations affect the first dice group; order matters.</small><div style="overflow:auto;flex:1;min-height:0">${state.map((o,i)=>`<section data-option="${i}" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;padding:12px;margin-bottom:10px;border:1px solid #586078;border-radius:6px">${[
        `<label>Label<input data-field="label" aria-label="Option label" value="${esc(o.label)}"></label>`,
        `<label>Input<select data-field="type" aria-label="Input type"><option value="checkbox" ${o.type==="checkbox"?"selected":""}>Checkbox</option><option value="number" ${o.type==="number"?"selected":""}>Number field</option></select></label>`,
        `<label>Operation<select data-field="operation" aria-label="Operation">${Object.entries(OPTIONAL_OPERATIONS).map(([key,label])=>`<option value="${key}" ${o.operation===key?"selected":""}>${label}</option>`).join("")}</select></label>`,
        `<label>Value / default<input data-field="value" aria-label="Option value" value="${esc(o.value)}"></label>`,
        `<label><input data-field="checked" type="checkbox" ${o.checked?"checked":""}> Checked by default</label>`,
        `<button type="button" data-remove="${i}">Remove</button>`].join("")}</section>`).join("")}</div><footer style="display:flex;gap:8px;flex:none"><button type="button" data-add-option>Add optional field</button><button type="button" data-save-options>Save optional fields</button><button type="button" data-cancel-options>Cancel</button></footer>`;
      root.querySelector("[data-add-option]").onclick=()=>{sync();state=normalizeRollOptionals([...state,{type:"checkbox"}]);render();};
      root.querySelectorAll("[data-remove]").forEach(button=>button.onclick=()=>{sync();state.splice(Number(button.dataset.remove),1);render();});
      root.querySelector("[data-save-options]").onclick=()=>{sync();finish(normalizeRollOptionals(state));};
      root.querySelector("[data-cancel-options]").onclick=()=>finish(null);
      root.querySelectorAll("label").forEach(label=>{label.style.cssText="display:flex;flex-direction:column;align-items:stretch;gap:4px;text-transform:none;white-space:normal";});
    };
    render();app=openFoundryWindow({id:"sd-roll-optionals",title:"Optional roll fields",width:640,height:550,content:root,onClose:()=>finish(null)});
  });
}
