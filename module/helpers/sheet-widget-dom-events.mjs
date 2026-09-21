import { sheetWidgetClickControl } from "./sheet-widget-click.mjs";

export function ownsWidgetEvent(cell,event) {
  for(let element=event?.target;element&&element!==cell;element=element.parentElement)if(element._sdEmitWidgetEvent)return false;
  return true;
}

export function bindExtraWidgetEvents(cell) {
  if(cell._sdExtraEvents)return;cell._sdExtraEvents=true;
  for(const [dom,name] of [["dblclick","dblclick"],["contextmenu","rightclick"]])cell.addEventListener(dom,event=>{
    if(!ownsWidgetEvent(cell,event)||event.target.closest?.('[data-cardhand],.sd-model-widget'))return;
    const control=sheetWidgetClickControl(cell,event)??event.target.closest?.('[data-action="wbElement"],.skill-pip');
    if(!control||control.matches(':disabled')||control.getAttribute('aria-disabled')==='true')return;
    cell._sdEmitWidgetEvent?.(name,event,{elementKey:control.closest('[data-element-key]')?.dataset.elementKey??""});
  },true);
  for(const [dom,name] of [["focusin","focus"],["focusout","blur"]])cell.addEventListener(dom,event=>{
    if(ownsWidgetEvent(cell,event))cell._sdEmitWidgetEvent?.(name,event);
  },true);
}
