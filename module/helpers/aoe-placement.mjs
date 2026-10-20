import { buildShape, placeRegionInteractive, getRegionTokens } from "./sd-region.mjs";

const esc = value => String(value ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");

/** Shared placement for spell cards and Message Composer buttons. */
export async function placeAoePreset({ templates = [], title = "Place AOE", actorId = "", persist = true } = {}) {
  if (!Array.isArray(templates) || !templates.length) throw new Error("No AOE template supplied");
  let selectedTemplate = templates[0];
  if (templates.length > 1) {
    const options = templates.map((template, index) => `<label style="display:flex;gap:8px;padding:7px"><input type="radio" name="sd-spell-template" value="${index}" ${index === 0 ? "checked" : ""}><strong>${esc(template.name ?? `Template ${index + 1}`)}</strong></label>`).join("");
    const picked = await foundry.applications.api.DialogV2.wait({
      window:{title}, modal:true, content:`<div style="max-height:360px;overflow:auto">${options}</div>`,
      buttons:[
        {action:"ok",label:"Place",icon:"fas fa-crosshairs",default:true,callback:(_event,button,dialog)=>Number((dialog?.element ?? button?.form)?.querySelector?.('input[name="sd-spell-template"]:checked')?.value ?? 0)},
        {action:"cancel",label:"Cancel",callback:()=>null}
      ],rejectClose:false
    });
    if (picked == null) return null;
    selectedTemplate = templates[picked] ?? templates[0];
  }
  const isRegion = selectedTemplate.kind === "region-v14" && Array.isArray(selectedTemplate.shapes) && selectedTemplate.shapes.length > 0;
  const regionDoc = await placeRegionInteractive({
    name:selectedTemplate.name ?? title,
    shape:isRegion ? null : buildShape(selectedTemplate.t ?? selectedTemplate.shape ?? "circle", Number(selectedTemplate.distance ?? selectedTemplate.size ?? 20) || 20, Number(selectedTemplate.angle ?? 53.13) || 53.13),
    shapes:isRegion ? selectedTemplate.shapes : null,
    appearance:isRegion ? selectedTemplate.appearance ?? {} : {},
    behaviors:isRegion ? selectedTemplate.behaviors ?? [] : [],
    flags:{...(selectedTemplate.flags ?? {}),sd:{...(selectedTemplate.flags?.sd ?? {}),spellV2:true,templateSnapshot:selectedTemplate,srcActorId:actorId}}
  });
  if (!regionDoc) return null;
  await new Promise(resolve => setTimeout(resolve, 250));
  const tokenIds = getRegionTokens(regionDoc).map(token => token.id).filter(Boolean);
  if (!persist) await regionDoc.delete();
  return {regionDoc, selectedTemplate, tokenIds};
}
