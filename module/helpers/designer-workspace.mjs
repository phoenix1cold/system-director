const text=(en,ru)=>game.i18n?.lang==="ru"?ru:en;

/** Shared navigation shell. Moves existing panels without changing their controls or data. */
export function mountDesignerWorkspace(root,{sheet=false}={}) {
  const workspace=root.querySelector('.sduw-root');
  if(!workspace||workspace.dataset.workspaceReady)return;
  workspace.dataset.workspaceReady='true';
  const intro=document.createElement('div');intro.className='sd-designer-intro';
  const title=document.createElement('strong');title.textContent=sheet?'Widget Builder':'UI Blueprint';
  const hint=document.createElement('span');hint.textContent=text('Add elements → arrange the canvas → connect behavior', 'Добавьте элементы → соберите макет → подключите логику');
  const save=document.createElement('small');save.dataset.designerSaveStatus='';save.textContent=sheet?text('Save applies the layout','Макет применяется кнопкой «Сохранить»'):text('Changes save automatically','Изменения сохраняются автоматически');
  intro.append(title,hint,save);workspace.prepend(intro);
  const tabs=(side,splitSelector,names)=>{
    const aside=workspace.querySelector(side),split=aside?.querySelector(splitSelector);if(!aside||!split)return;
    const splitHead=split.previousElementSibling;
    const children=[...aside.children];const index=children.indexOf(splitHead);
    if(index<0)return;
    const bar=document.createElement('div');bar.className='sd-designer-tabs';bar.setAttribute('role','tablist');
    const panels=names.map((name,i)=>{const panel=document.createElement('section');panel.className='sd-designer-panel';panel.setAttribute('role','tabpanel');panel.hidden=i>0;
      for(const child of (i===0?children.slice(0,index):children.slice(index)))panel.append(child);
      const button=document.createElement('button');button.type='button';button.textContent=name;button.setAttribute('role','tab');button.setAttribute('aria-selected',String(i===0));
      button.addEventListener('click',()=>{for(const [n,p] of panels.entries()){p.hidden=n!==i;bar.children[n].setAttribute('aria-selected',String(n===i));}});bar.append(button);return panel;});
    aside.append(bar,...panels);
  };
  tabs('.sduw-left','[data-region="hierarchy"]',[text('Add','Добавить'),text('Layers','Слои')]);
  tabs('.sduw-right','[data-region="variables"]',[text('Properties','Свойства'),text('Data & logic','Данные и логика')]);
  const toolbar=workspace.querySelector('.sduw-toolbar'),sub=toolbar?.querySelector('.sduw-toolbar-row-sub');
  if(sub){
    const settings=document.createElement('details');settings.className='sd-designer-settings';
    const summary=document.createElement('summary');summary.textContent=text('Canvas and advanced settings','Холст и дополнительные настройки');settings.append(summary,sub);
    const zoom=sub.querySelector('.sduw-toolbar-actions');if(zoom){zoom.classList.add('sd-designer-zoom');workspace.querySelector('.sduw-statusbar')?.after(zoom);}
    for(const input of toolbar.querySelectorAll('[name="system.blueprintId"],[name="system.layout"],[name="system.size.w"]')){const field=input.closest('.sduw-field');if(field)sub.prepend(field);}
    if(sheet)toolbar.querySelector('.sduw-field input[readonly]')?.closest('.sduw-field')?.remove();
    toolbar.append(settings);
  }
  for(const button of workspace.querySelectorAll('[data-action="graph"],[data-action="openGraph"]')){
    button.textContent=text('Logic ↗','Логика ↗');button.title=sheet?text('Save the layout and open Sheet Blueprint','Сохранить макет и открыть Sheet Blueprint'):text('Open the shared UI Blueprint graph','Открыть общий граф UI Blueprint');
  }
  const saveButton=workspace.querySelector('[data-action="save"]');if(saveButton)saveButton.textContent=text('Save','Сохранить');
  for(const [action,en,ru] of [['zoomIn','Zoom in','Увеличить'],['zoomOut','Zoom out','Уменьшить'],['fit','Fit canvas','Уместить холст']]) {
    const button=workspace.querySelector(`[data-action="${action}"]`);if(button){button.title=text(en,ru);button.setAttribute('aria-label',text(en,ru));}
  }
  if(sheet){const status=workspace.querySelector('[data-region="status"]');if(status)status.textContent=text('Click to add · Drag to move · Select to edit · Save to apply','Нажмите на виджет, чтобы добавить · Перетаскивайте на холсте · Настройте справа · Сохраните макет');}
}
