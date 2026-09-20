let pointer={x:24,y:24};
export function trackPopupPointer(){document.addEventListener("pointermove",event=>{pointer={x:event.clientX,y:event.clientY};},{passive:true});}

/** Plain text popup; user content never becomes HTML. */
export function showPopupMessage({title="",message="",duration=4,position="pointer"}={}) {
  const root=document.createElement("div");root.className="sd sd-floating-message";root.setAttribute("role","status");
  root.style.cssText="position:fixed;z-index:2147483640;max-width:min(380px,calc(100vw - 24px));padding:14px 38px 14px 16px;border:1px solid var(--sd-border-2,#4e4e70);border-radius:var(--sd-r-lg,9px);background:var(--sd-bg,#1a1a24);color:var(--sd-text,#e0e0ee);box-shadow:var(--sd-shadow,0 8px 28px #0008);white-space:pre-wrap;overflow-wrap:anywhere;font:var(--sd-base-font-size,13px)/1.4 var(--sd-font,serif);";
  if(title){const heading=document.createElement("strong");heading.textContent=String(title);heading.style.cssText="display:block;margin-bottom:5px";root.append(heading);}
  const body=document.createElement("div");body.textContent=String(message);root.append(body);
  const close=document.createElement("button");close.type="button";close.textContent="×";close.setAttribute("aria-label",game.i18n?.lang==="ru"?"Закрыть":"Close");close.style.cssText="position:absolute;right:7px;top:5px;width:24px;background:none;border:0;color:inherit;cursor:pointer";root.append(close);
  (document.fullscreenElement??document.body).append(root);
  if(position==="center"){root.style.left="50%";root.style.top="50%";root.style.transform="translate(-50%,-50%)";}
  else if(position==="top-right"){root.style.right="18px";root.style.top=`${18+(document.querySelectorAll('.sd-floating-message').length-1)*80}px`;}
  else {root.style.left=`${Math.max(12,Math.min(pointer.x+14,innerWidth-root.offsetWidth-12))}px`;root.style.top=`${Math.max(12,Math.min(pointer.y+14,innerHeight-root.offsetHeight-12))}px`;}
  let timer;
  const dismiss=()=>{clearTimeout(timer);root.remove();};close.addEventListener("click",dismiss);
  if(Number(duration)>0)timer=setTimeout(dismiss,Math.min(3600,Number(duration))*1000);
  return root;
}
