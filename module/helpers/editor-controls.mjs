import { uniqueId } from "./unique-id.mjs";
const ru = () => globalThis.game?.i18n?.lang === "ru";
let closeSelect;

/** Keep the native select as the form value; the searchable popup only changes it. */
export function openSearchableSelect(select) {
  if (select.disabled) return;
  closeSelect?.();
  const popup=document.createElement("div"); popup.className="sd sd-search-select";
  const theme=getComputedStyle(select);
  for(const key of ["--sd-bg","--sd-bg-2","--sd-bg-3","--sd-border","--sd-border-2","--sd-text","--sd-accent","--sd-accent-glow","--sd-font","--sd-base-font-size","--sd-r","--sd-r-lg"]) {
    const value=theme.getPropertyValue(key);if(value)popup.style.setProperty(key,value);
  }
  popup.setAttribute("role","dialog");popup.setAttribute("aria-label",select.getAttribute("aria-label")|| (ru()?"Выбор значения":"Choose value"));
  const search=document.createElement("input"); search.type="search"; search.placeholder=ru()?"Поиск…":"Search…";
  search.setAttribute("aria-label",search.placeholder); search.setAttribute("role","combobox");search.setAttribute("aria-expanded","true");
  const list=document.createElement("div");list.className="sd-search-options";list.id=`sd-options-${uniqueId()}`;list.setAttribute("role","listbox");
  search.setAttribute("aria-controls",list.id);popup.append(search,list);
  // Native dialogs are in the browser top layer; keep their popup in that layer too.
  (select.closest("dialog[open]") ?? document.fullscreenElement ?? document.body).append(popup);
  const rect=select.getBoundingClientRect();popup.style.width=`${Math.min(Math.max(rect.width,240),innerWidth-16)}px`;
  popup.style.left=`${Math.max(8,Math.min(rect.left,innerWidth-popup.offsetWidth-8))}px`;
  popup.style.top=`${Math.max(8,Math.min(rect.bottom+3,innerHeight-300))}px`;
  let active=0,visible=[];
  const abort=new AbortController(), signal=abort.signal;
  const close=(focus=true)=>{abort.abort();popup.remove();closeSelect=null;if(focus&&select.isConnected)select.focus();};closeSelect=close;
  const choose=option=>{
    if(select.multiple)option.selected=!option.selected;else select.selectedIndex=option.index;
    select.dispatchEvent(new Event("input",{bubbles:true}));select.dispatchEvent(new Event("change",{bubbles:true}));
    if(select.multiple&&select.isConnected)render();else close();
  };
  const highlight=()=>{[...list.children].forEach((el,i)=>{el.classList.toggle("is-active",i===active);if(i===active){search.setAttribute("aria-activedescendant",el.id);el.scrollIntoView({block:"nearest"});}});};
  const render=()=>{
    const query=search.value.trim().toLocaleLowerCase();list.replaceChildren();
    visible=[...select.options].filter(o=>!o.hidden&&!o.disabled&&!o.parentElement?.disabled&&`${o.textContent} ${o.value} ${o.parentElement?.label||""}`.toLocaleLowerCase().includes(query));active=0;
    for(const [i,option] of visible.entries()) {
      const row=document.createElement("button");row.type="button";row.id=`${list.id}-${i}`;row.setAttribute("role","option");row.setAttribute("aria-selected",String(option.selected));
      row.textContent=(option.selected?"✓ ":"")+option.textContent;row.addEventListener("click",()=>choose(option));list.append(row);
    }
    if(!visible.length){const empty=document.createElement("p");empty.textContent=ru()?"Ничего не найдено":"No matches";list.append(empty);}
    highlight();
  };
  search.addEventListener("input",render);
  popup.addEventListener("pointerdown",e=>e.stopPropagation());popup.addEventListener("mousedown",e=>e.stopPropagation());
  popup.addEventListener("keydown",e=>{
    e.stopPropagation();
    if(e.key==="Escape"){e.preventDefault();close();}
    else if(e.key==="Tab")close(false);
    else if(e.key==="ArrowDown"||e.key==="ArrowUp"){e.preventDefault();active=Math.max(0,Math.min(visible.length-1,active+(e.key==="ArrowDown"?1:-1)));highlight();}
    else if(e.key==="Enter"){e.preventDefault();if(visible[active])choose(visible[active]);}
  });
  document.addEventListener("pointerdown",e=>{if(!popup.contains(e.target)&&e.target!==select)close(false);},{capture:true,signal});
  window.addEventListener("resize",()=>close(false),{signal});
  const observer=new MutationObserver(()=>{if(!select.isConnected)close(false);});observer.observe(document.body,{childList:true,subtree:true});
  signal.addEventListener("abort",()=>observer.disconnect());render();search.focus();
  return popup;
}

export function installSearchableSelects() {
  if(document.documentElement.dataset.sdSearchSelects)return;
  document.documentElement.dataset.sdSearchSelects="true";
  const target=e=>{const s=e.target.closest?.("select");return s?.closest('.sd,[class*="sd-"],[id^="sd-"]')&&!s.disabled?s:null;};
  document.addEventListener("mousedown",e=>{const s=target(e);if(!s||e.button!==0)return;e.preventDefault();e.stopPropagation();openSearchableSelect(s);},true);
  document.addEventListener("keydown",e=>{const s=target(e);if(!s||e.ctrlKey||e.metaKey||e.key==="Tab"||e.key==="Escape")return;if(["Enter"," ","ArrowDown","ArrowUp"].includes(e.key)||e.key.length===1){e.preventDefault();e.stopPropagation();const p=openSearchableSelect(s);if(e.key.length===1&&e.key!==" "){const i=p.querySelector("input");i.value=e.key;i.dispatchEvent(new Event("input"));}}},true);
}

/** File metadata wins; legacy text fields are recognised without confusing document property paths. */
export function nodeFileType(field,nodeType="") {
  if(field.fileType)return field.fileType;
  if(field.type==="file")return "any";
  if(!["text","formula"].includes(field.type))return null;
  const key=String(field.key),label=String(field.label||"");
  if(/property|field path|data path|image property/i.test(label))return null;
  if(key==="icon"&&!/\bFA\b|font.?awesome/i.test(label)&&nodeType!=="fa_icon")return "image";
  if(/^(src|file|filePath|image|img|texture|portrait|staticSrc|sound|soundPath|audioPath|videoPath|imagePath|iconPath|texturePath|backgroundImage|backgroundVideo|audio|video)$/.test(key)||/(?:Image|Sound|Audio|Video|Texture)(?:Path|Src|Url)$/.test(key)||/\b(file|image|texture|sound|audio|video) (path|url)\b/i.test(label)) {
    const hint=`${nodeType} ${key} ${label}`;
    if(/sound|audio|music/i.test(hint))return "audio";
    if(/model3d|glb|gltf/i.test(hint))return "any";
    if(/video/i.test(hint))return "imagevideo";
    if(/image|texture|portrait|icon|img|staticSrc/i.test(hint))return "image";
    return "any";
  }
  return null;
}

export function addFilePicker(input,type="any") {
  const group=document.createElement("div");group.className="sd-file-input";input.replaceWith(group);group.append(input);
  const button=document.createElement("button");button.type="button";button.className="sd-file-picker";button.textContent="📁";button.title=button.ariaLabel=ru()?"Выбрать файл":"Choose file";
  button.addEventListener("mousedown",e=>e.stopPropagation());
  button.addEventListener("click",async e=>{
    e.preventDefault();e.stopPropagation();
    const Picker=globalThis.foundry?.applications?.apps?.FilePicker??globalThis.FilePicker;
    if(!Picker){globalThis.ui?.notifications?.warn?.("FilePicker is unavailable");return;}
    const picker=new Picker({type,current:input.value,callback:path=>{input.value=path;input.dispatchEvent(new Event("input",{bubbles:true}));input.dispatchEvent(new Event("change",{bubbles:true}));}});
    await picker.render(true);
  });group.append(button);return button;
}

globalThis.Hooks?.once?.("ready",installSearchableSelects);
