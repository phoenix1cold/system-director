import { decodeVariableRef, getValueDefinition, listVariableDatabases, variableReferenceOptions } from "./value-database.mjs";

const bindings=new WeakMap();

/** Enhance the original control, so form names and existing change listeners survive. */
export function enhanceVariableSelect(select,{ownerType="actor",types=null,storagePath=false,preserveOptions=false,allowWorld=true}={}){
  if(!select||select.tagName!=="SELECT")return null;
  if(bindings.has(select))return bindings.get(select);
  const document=select.ownerDocument;
  const initial=select.dataset.variableRef??select.value;
  let initialValues=select.multiple?[...select.selectedOptions].map(option=>option.value):[initial];
  if(select.multiple&&select.dataset.variableRefs){try{const values=JSON.parse(select.dataset.variableRefs);if(Array.isArray(values))initialValues=values.map(String);}catch{}}
  const ref=decodeVariableRef(initial);
  const controls=document.createElement("span");controls.className="sd-variable-selector-controls";
  controls.style.cssText="display:flex;gap:4px;flex-wrap:wrap;align-items:center";
  const makeControl=label=>{
    const wrapper=document.createElement("label");wrapper.textContent=label;
    const control=document.createElement("select");control.setAttribute("aria-label",label);
    wrapper.append(control);controls.append(wrapper);return control;
  };
  const database=makeControl("Database");const owner=makeControl("Actor/Item");
  const option=(value,label)=>{const node=document.createElement("option");node.value=value;node.textContent=label;return node;};
  const databases=listVariableDatabases().filter(db=>allowWorld||db.storage!=="world");
  for(const db of databases)database.append(option(db.id,db.name+(db.storage==="world"?" (World)":"")));
  for(const [value,label] of [["actor","Actor"],["item","Item"],["auto","Context"],["world","World"]])owner.append(option(value,label));
  database.value=ref?.databaseId??"";
  owner.value=(ref?.qualified?ref.ownerType:null)??select.dataset.variableOwner??ownerType;
  const extras=preserveOptions?[...select.options].filter(opt=>opt.value&&!getValueDefinition(opt.value)).map(opt=>opt.cloneNode(true)):[];
  const populate=(current="",keepUnknown=false)=>{
    const selected=Array.isArray(current)?current:[current];
    const db=databases.find(db=>db.id===database.value);
    if(db?.storage==="world")owner.value="world";
    else if(owner.value==="world")owner.value=select.dataset.variableOwner??ownerType;
    owner.disabled=select.disabled||db?.storage==="world";
    database.disabled=select.disabled;
    for(const opt of owner.options)opt.hidden=opt.value==="world"&&db?.storage!=="world";
    const options=variableReferenceOptions({databaseId:database.value,ownerType:owner.value,types,storagePath});
    select.replaceChildren(option("","Select variable..."),...extras.map(opt=>opt.cloneNode(true)),...options.map(entry=>option(entry.value,entry.label)));
    for(const value of selected)if(value&&!Array.from(select.options).some(opt=>opt.value===value)&&(keepUnknown||select.multiple)){
      const def=getValueDefinition(value);
      select.append(option(value,def?.name??`${value} (unavailable)`));
    }
    if(select.multiple){for(const opt of select.options)opt.selected=selected.includes(opt.value);}
    else {select.value=selected[0]??"";if(select.selectedIndex<0)select.value="";}
  };
  // Hydration must not rewrite persisted legacy IDs or fire application handlers.
  populate(select.multiple?initialValues:initial,true);
  select.before(controls);
  const changed=()=>{
    const selectedValues=select.multiple?[...select.selectedOptions].map(option=>option.value):null;
    const previous=decodeVariableRef(select.value);
    const db=databases.find(db=>db.id===database.value);
    if(db?.storage==="world")owner.value="world";
    else if(owner.value==="world")owner.value=select.dataset.variableOwner??ownerType;
    const options=variableReferenceOptions({databaseId:database.value,ownerType:owner.value,types,storagePath});
    const selected=options.find(entry=>entry.id===previous?.variableId)?.value??"";
    populate(selectedValues??selected);
    select.dataset.variableRef=select.value;
    if(select.multiple)select.dataset.variableRefs=JSON.stringify([...select.selectedOptions].map(option=>option.value));
    select.dispatchEvent(new document.defaultView.Event("change",{bubbles:true}));
  };
  const sync=()=>{select.dataset.variableRef=select.value;if(select.multiple)select.dataset.variableRefs=JSON.stringify([...select.selectedOptions].map(option=>option.value));};
  database.addEventListener("change",changed);owner.addEventListener("change",changed);
  select.addEventListener("change",sync);
  const binding={database,owner,select,refresh:()=>populate(select.multiple?[...select.selectedOptions].map(option=>option.value):select.value,true),destroy:()=>{
    database.removeEventListener("change",changed);owner.removeEventListener("change",changed);
    select.removeEventListener("change",sync);controls.remove();bindings.delete(select);
  }};
  bindings.set(select,binding);return binding;
}

/** Opt-in observation handles rows replaced by dialogs and graph rerenders. */
export function enhanceVariableSelectors(root,{selector="select[data-variable-ref], select[data-variable-selector]",...options}={}){
  root=root?.[0]??root;if(!root?.querySelectorAll)return ()=>{};
  const active=new Set();
  const scan=()=>{
    for(const binding of active)if(!root.contains(binding.select)){binding.destroy();active.delete(binding);}
    const selects=[...(root.matches?.(selector)?[root]:[]),...root.querySelectorAll(selector)];
    for(const select of selects){const binding=enhanceVariableSelect(select,options);if(binding)active.add(binding);}
  };
  scan();
  const Observer=root.ownerDocument?.defaultView?.MutationObserver??globalThis.MutationObserver;
  const observer=Observer?new Observer(scan):null;
  observer?.observe(root,{childList:true,subtree:true});
  return ()=>{observer?.disconnect();for(const binding of active)binding.destroy();active.clear();};
}
