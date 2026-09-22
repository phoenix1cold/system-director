import {WidgetRenderer} from '../module/builder/widget-renderer.mjs';
import {WIDGET_VARIANTS} from '../module/builder/widget-registry.mjs';

export function checkWidgetStyles(){
  globalThis.CONFIG??={SD:{}};
  const host=document.createElement('div');host.className='sd';host.style.width='700px';document.body.append(host);
  const doc=new Actor();doc.system={value:true};doc.items=[];
  let checks=0;
  const expect=(actual,want,label)=>{if(actual!==want)throw new Error(`${label}: ${actual} !== ${want}`);checks++;};
  try {
    for(const type of ['text','number','counter','resource','button','easyButton','toggle','attribute','skill','progress','select','tags','derived']){
      for(const variant of WIDGET_VARIANTS[type]??['default']){
        host.innerHTML=WidgetRenderer.render({type,id:'styled',widgetKey:'styled',label:'Styled',path:'system.value',variant,boxW:240,boxH:150,boxPad:0,boxGap:0,boxRadius:0,boxBorderWidth:0,boxBg:'#123456',boxFg:'#abcdef',fontSize:19,labelFontSize:17,onColor:'#ee1122',offColor:'#334455',btnBg:'#224466',btnFg:'#ffffff',btnColor:'#778899'},doc);
        const root=host.querySelector('.widget');if(!root||root.classList.contains('widget-error'))throw new Error(`Cannot render ${type}/${variant}`);
        const style=getComputedStyle(root);
        for(const [property,want] of Object.entries({width:'240px',height:'150px',paddingTop:'0px',gap:'0px',borderRadius:'0px',borderTopWidth:'0px',backgroundColor:'rgb(18, 52, 86)'}))expect(style[property],want,`${type}/${variant} ${property}`);
        const label=root.querySelector('.widget-label');if(label)expect(getComputedStyle(label).fontSize,'17px',`${type}/${variant} label size`);
        if(type==='toggle'){
          const track=root.querySelector('.tog-track');expect(getComputedStyle(track).backgroundColor,'rgb(238, 17, 34)',`Toggle ${variant} on color`);
          expect(getComputedStyle(root.querySelector('.tog-val')).fontSize,'19px',`Toggle ${variant} text size`);
          expect(getComputedStyle(root.querySelector('.tog-val')).color,'rgb(171, 205, 239)',`Toggle ${variant} text color`);
        }
        if(['button','easyButton'].includes(type))expect(getComputedStyle(root.querySelector('.sd-action-btn')).backgroundColor,'rgb(34, 68, 102)',`${type}/${variant} button background`);
      }
    }
    host.innerHTML=WidgetRenderer.render({type:'toggle',label:'Off',path:'system.missing',offColor:'#334455',boxPad:18,boxGap:13,boxBorderWidth:3,boxBorderStyle:'dashed',boxRadius:12},doc);
    const root=host.querySelector('.widget'),style=getComputedStyle(root);
    expect(style.paddingTop,'18px','Explicit padding');expect(style.gap,'13px','Explicit gap');expect(style.borderTopWidth,'3px','Border width without color');expect(style.borderTopStyle,'dashed','Border style without color');expect(style.borderRadius,'12px','Explicit radius');
    expect(getComputedStyle(root.querySelector('.tog-track')).backgroundColor,'rgb(51, 68, 85)','Off color');
  } finally {host.remove();}
  return checks;
}
