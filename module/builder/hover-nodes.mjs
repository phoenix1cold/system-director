import { registerNodeActionHandler } from "../helpers/node-runtime-api.mjs";
import { matchesHoverObject, installCanvasHoverEvents } from "../helpers/hover-events.mjs";
const owner="sd:hover";
const text=(en,ru)=>globalThis.game?.i18n?.lang==="ru"?ru:en;

export function registerHoverNodes(registry=globalThis.SD?.nodeRegistry??globalThis.CONFIG?.SD?.nodeRegistry){
  if(!registry?.registerNode)return;
  registry.registerNode("on_hover",{
    title:"On Hover",cat:"Events",color:"#c64646",wideNode:true,isEvent:true,eventHook:"sdObjectHover",
    desc:text("Runs once when the pointer enters a widget, 3D model/point or canvas object. Choose a widget or connect an object/reference (UUID, Widget Key, 3D Object or Points).","Срабатывает при входе курсора в виджет, 3D-модель/точку или объект карты. Выберите виджет или подключите объект/ссылку: UUID, Widget Key, 3D-объект, массив точек."),
    inputs:[{id:"object",label:text("Object","Объект"),type:"value.any"}],
    outputs:[{id:"exec",label:"On Hover",type:"exec"},{id:"object",label:text("Object","Объект"),type:"value.any"},{id:"widgetKey",label:"Widget Key",type:"value.string"},{id:"hotspotId",label:"Point ID",type:"value.string"},{id:"text",label:text("Text","Текст"),type:"value.string"}],
    fields:[{key:"key",label:text("Widget","Виджет"),type:"widget-picker",default:"",noPin:true}],
    compileEventData:(n,i,graph)=>{
      const edge=graph?.edges?.find(e=>e.toNode===n.id&&e.toPin==="object");
      const source=graph?.nodes?.find(s=>s.id===edge?.fromNode);
      // Get Widget nodes expose values; their selection still carries the identity to watch.
      let widgetExpression;
      if(source?.type?.startsWith("widget_get_")) {
        const widgetEdge=graph.edges.find(e=>e.toNode===source.id&&e.toPin==="widgetKey");
        const widgetSource=graph.nodes.find(s=>s.id===widgetEdge?.fromNode);
        widgetExpression=widgetSource?graph._compileValue(widgetSource,new Set(),widgetEdge.fromPin):JSON.stringify(source.data?.widgetKey??"");
      }
      return {...n.data,...(i.object!==undefined?{object:i.object,connected:true,...(widgetExpression?{sourceWidgetExpression:widgetExpression}:{})}:{})};
    },
    compilePin:(_n,_i,p)=>`{__var:__hover_${p}|}`
  },{owner});
  registry.registerNode("popup_message",{
    title:text("Popup Message","Всплывающее сообщение"),cat:"UI",color:"#728ccc",wideNode:true,isAction:true,
    inputs:[{id:"exec",label:"",type:"exec"},{id:"message",label:text("Message","Сообщение"),type:"value.string"},{id:"title",label:text("Title","Заголовок"),type:"value.string"},{id:"duration",label:text("Seconds","Секунды"),type:"value.number"}],
    outputs:[{id:"exec",label:text("Then","Далее"),type:"exec"}],
    fields:[{key:"title",label:text("Title","Заголовок"),type:"text",default:""},{key:"message",label:text("Message","Сообщение"),type:"textarea",default:""},{key:"duration",label:text("Seconds (0 = until closed)","Секунды (0 = до закрытия)"),type:"number",default:4},{key:"position",label:text("Position","Положение"),type:"select",default:"pointer",options:[{value:"pointer",label:text("Near cursor","У курсора")},{value:"center",label:text("Center","По центру")},{value:"top-right",label:text("Top right","Справа сверху")}]}],
    toAction:(n,i={})=>({type:"popup_message",args:{title:i.title??JSON.stringify(n.data?.title??""),message:i.message??JSON.stringify(n.data?.message??""),duration:i.duration??n.data?.duration??4,position:JSON.stringify(n.data?.position??"pointer")}})
  },{owner});
}

export function installHoverActions(){
  registerNodeActionHandler("sd_hover_match",async ctx=>{
    const a=ctx.action;
    if(a.connected){const wanted=await ctx.resolveValue(a.sourceWidgetExpression??a.object);return matchesHoverObject(wanted,a.payload);}
    return a.key ? matchesHoverObject(a.key,a.payload) : !!a.payload.widgetId;
  },{owner});
  registerNodeActionHandler("popup_message",async ctx=>{
    const args={};for(const [key,value] of Object.entries(ctx.action.args??{}))args[key]=await ctx.resolveValue(value);
    const {showPopupMessage}=await import("../helpers/popup-message.mjs");showPopupMessage(args);return {success:true};
  },{owner});
}

globalThis.Hooks?.once?.("ready",async()=>{
  installHoverActions();registerHoverNodes();installCanvasHoverEvents();
  const {trackPopupPointer}=await import("../helpers/popup-message.mjs");trackPopupPointer();
});
