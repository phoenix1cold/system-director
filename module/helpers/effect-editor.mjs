import { getValueDefinitions, valueStoragePath } from "./value-database.mjs";

const esc=s=>String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const MODE_OPTIONS=[
  {value:0,label:"Custom"},{value:1,label:"Multiply"},{value:2,label:"Add"},
  {value:3,label:"Downgrade"},{value:4,label:"Upgrade"},{value:5,label:"Override"}
];

export async function openItemSheetFromSnapshot(snapshot, parentActor) {
  if (!snapshot) return;
  try {
    if (snapshot._sourceUuid) {
      const live = await fromUuid(snapshot._sourceUuid).catch(() => null);
      if (live?.sheet) { live.sheet.render(true); return; }
    }
    if (snapshot._id && parentActor) {
      const live = parentActor.items?.get?.(snapshot._id);
      if (live?.sheet) { live.sheet.render(true); return; }
    }
    const cls = CONFIG.Item?.documentClass ?? Item;
    new cls(foundry.utils.deepClone(snapshot), { parent: parentActor ?? null }).sheet.render(true);
  } catch (err) {
    console.warn("SD | Could not open item card:", err);
    ui.notifications?.warn?.("Could not open item");
  }
}

function variableIdFromChange(change,definitions){
  const key=String(change?.key??"");
  return String(change?.variableId??definitions.find(v=>valueStoragePath(v.id)===key||v.legacyPath===key)?.id??"");
}

function changeRow(change={},definitions=[]){
  const variableId=variableIdFromChange(change,definitions);
  return `<div class="sd-ve-change" style="display:grid;grid-template-columns:minmax(180px,1fr) 110px minmax(100px,1fr) 70px 30px;gap:6px;align-items:end;margin:6px 0">
    <label><span>Database variable</span><select name="variableId"><option value="">Select value…</option>${definitions.map(v=>`<option value="${esc(v.id)}" ${variableId===v.id?"selected":""}>${esc(v.name)} · ${esc(v.type)} [${esc(v.id)}]</option>`).join("")}</select></label>
    <label><span>Operation</span><select name="mode">${MODE_OPTIONS.map(m=>`<option value="${m.value}" ${Number(change.mode??2)===m.value?"selected":""}>${m.label}</option>`).join("")}</select></label>
    <label><span>Value</span><input name="value" value="${esc(change.value??"")}" placeholder="Value or formula"></label>
    <label><span>Priority</span><input type="number" name="priority" value="${Number(change.priority??20)}"></label>
    <button type="button" data-sd-ve-remove title="Remove"><i class="fas fa-trash"></i></button>
  </div>`;
}

/** Variable-only Active Effect editor. Technical storage keys never appear. */
export async function editVariableEffect(snapshot, { parent, title } = {}) {
  if (!parent || !["Actor","Item"].includes(parent.documentName)) return null;
  const definitions=getValueDefinitions();
  if(!definitions.length){ui.notifications?.warn?.("Add at least one value to Settings → Database first.");return null;}
  const data=foundry.utils.deepClone(snapshot??{});
  const rows=(data.changes??[]).map(c=>changeRow(c,definitions)).join("")||changeRow({},definitions);
  const content=`<form class="sd-variable-effect-editor" style="display:flex;flex-direction:column;gap:10px">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><label><span>Name</span><input name="name" value="${esc(data.name??"Effect")}"></label><label><span>Icon</span><input name="icon" value="${esc(data.img??data.icon??"icons/svg/aura.svg")}"></label></div>
    <div style="display:grid;grid-template-columns:100px 100px 1fr 1fr;gap:8px"><label><span>Rounds</span><input type="number" min="0" name="rounds" value="${Number(data.duration?.rounds??0)}"></label><label><span>Seconds</span><input type="number" min="0" name="seconds" value="${Number(data.duration?.seconds??0)}"></label><label><input type="checkbox" name="disabled" ${data.disabled?"checked":""}> Start disabled</label><label><input type="checkbox" name="transfer" ${data.transfer?"checked":""}> Transfer</label></div>
    <section><div style="display:flex;justify-content:space-between;align-items:center"><b>Variable changes</b><button type="button" data-sd-ve-add><i class="fas fa-plus"></i> Add change</button></div><div data-sd-ve-rows>${rows}</div></section>
    <p style="font-size:11px;color:var(--color-text-subtle)">Effects operate only on typed Database variables. Paths and Active Effect keys are internal.</p>
  </form>`;
  const onClick=event=>{
    const add=event.target?.closest?.("[data-sd-ve-add]");
    if(add){const holder=add.closest("form")?.querySelector("[data-sd-ve-rows]");if(holder)holder.insertAdjacentHTML("beforeend",changeRow({},definitions));return;}
    const remove=event.target?.closest?.("[data-sd-ve-remove]");if(remove)remove.closest(".sd-ve-change")?.remove();
  };
  document.addEventListener("click",onClick,true);
  let result;
  try{
    result=await foundry.applications.api.DialogV2.prompt({
      window:{title:title??"Variable Effect Editor",resizable:true},position:{width:800,height:"auto"},content,
      ok:{label:"Save effect",icon:"fas fa-floppy-disk",callback:(_event,button)=>{
        const form=button.form;
        const changes=[...form.querySelectorAll(".sd-ve-change")].map(row=>({
          variableId:row.querySelector('[name="variableId"]')?.value??"",
          mode:Number(row.querySelector('[name="mode"]')?.value??2),
          value:String(row.querySelector('[name="value"]')?.value??""),
          priority:Number(row.querySelector('[name="priority"]')?.value??20)
        })).filter(c=>c.variableId).map(c=>({key:valueStoragePath(c.variableId),mode:c.mode,value:c.value,priority:c.priority}));
        return {...data,name:String(form.elements.name?.value??"Effect"),img:String(form.elements.icon?.value??"icons/svg/aura.svg"),icon:String(form.elements.icon?.value??"icons/svg/aura.svg"),disabled:!!form.elements.disabled?.checked,transfer:!!form.elements.transfer?.checked,duration:{rounds:Number(form.elements.rounds?.value??0),seconds:Number(form.elements.seconds?.value??0)},changes};
      }}
    });
  }catch{return null;}finally{document.removeEventListener("click",onClick,true);}
  return result??null;
}

// Compatibility alias for integrations written before the Database-variable editor.
export const editEffectViaStandardConfig = editVariableEffect;
