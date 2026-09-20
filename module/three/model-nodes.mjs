import { registerNodeActionHandler } from "../helpers/node-runtime-api.mjs";
import { runModelInteraction } from "./model-events.mjs";
import { modelPoints, pointPinId } from "./model-point-data.mjs";

const OWNER = "sd:3d-viewer";
const text = (en, ru) => globalThis.game?.i18n?.lang === "ru" ? ru : en;
const pin = (id, label, type = "string") => ({ id, label, type: `value.${type}` });
const field = (key, label, value = "", type = "text", options) => ({ key, label, default: value, type, ...(options ? { options } : {}) });
const resultToken = (node, output) => `{__nodeResult:${node.id}|${output}}`;

export function registerModelNodes(registry = globalThis.SD?.nodeRegistry ?? globalThis.CONFIG?.SD?.nodeRegistry) {
  if (!registry?.registerNode) return;
  registry.registerCategory({ id: "3D", label: "3D", labels: { en: "3D Objects", ru: "3D-объекты" }, color: "#368fa8" }, { owner: OWNER });
  const viewer = () => field("viewerId", text("Viewer ID", "ID окна"), "model");
  function add(id, title, description, fields, inputs = []) {
    registry.registerNode(id, {
      title, desc: description, cat: "3D", color: "#368fa8", wideNode: true, isAction: true,
      inputs: [{ id: "exec", label: "", type: "exec" }, pin("viewerId", text("Viewer ID", "ID окна")), ...inputs],
      outputs: [
        { id: "exec", label: text("Then", "Далее"), type: "exec" },
        pin("viewerId", text("Viewer ID", "ID окна")),
        ...(["model3d_open", "model3d_primitive"].includes(id) ? [pin("points", text("Points", "Массив точек"), "array"), pin("object", text("3D Object", "3D-объект"), "any")] : []),
        pin("success", text("Success", "Успех"), "bool"),
        pin("error", text("Error", "Ошибка"))
      ],
      fields: [viewer(), ...fields],
      // Action outputs must also use dynamicBranchToken: the graph's value compiler
      // stops at isAction before reaching compilePin.
      dynamicBranchToken: resultToken,
      compilePin: (node, _inputs, output) => resultToken(node, output),
      toAction: (node, connected = {}) => ({
        type: id, __resultNodeId: node.id, pointsAuthored:node.data?.pointsAuthored===true,
        ...(["model3d_open","model3d_primitive"].includes(id)?{hotspots:modelPoints(node.data?.hotspots)}:{}),
        ...(id==="model3d_hotspot" && connected.showIf===undefined?{showIfExpression:String(node.data?.showIf??"")}:{}),
        args: Object.fromEntries([viewer(), ...fields].map(def => [def.key,
          connected[def.key] ?? (def.type === "number" ? (node.data?.[def.key] ?? def.default) : JSON.stringify(node.data?.[def.key] ?? def.default))
        ]))
      })
    }, { owner: OWNER });
  }
  const windowFields = () => [
    field("title", text("Window title", "Заголовок окна"), text("3D Viewer", "Просмотр 3D")),
    field("width", text("Width", "Ширина"), 720, "number"),
    field("height", text("Height", "Высота"), 580, "number"),
    field("background", text("Background #RRGGBB", "Фон #RRGGBB"), "#182131"),
    field("backgroundOpacity", text("Background opacity 0–1", "Непрозрачность фона 0–1"),1,"number"),
    field("fullscreen",text("Full screen", "На весь экран"),"no","select",["no","yes"]),
    field("tooltip",text("Model hover text", "Текст при наведении на модель")),
    {...field("hotspots",text("Interactive points", "Интерактивные точки"),"[]","model-points-editor"), noPin:true}
  ];
  add("model3d_open", text("Show 3D Model", "Показать 3D-модель"),
    text("Open a GLB/glTF in a local interactive window. Same Viewer ID replaces its previous window. Then runs after loading; check Success before continuing.",
      "Открывает GLB/glTF в интерактивном окне текущего пользователя. Одинаковый ID заменяет окно. Далее выполняется после загрузки; проверяйте Успех."),
    [field("src", text("GLB / glTF path", "Путь GLB / glTF"), ""), ...windowFields()],
    [pin("src", text("Model path", "Путь модели")), pin("title", text("Title", "Заголовок"))]);
  add("model3d_primitive", text("Show 3D Primitive", "Показать 3D-фигуру"),
    text("Display a built-in shape without uploading a file.", "Показывает встроенную фигуру без загрузки файла."),
    [field("primitive", text("Shape", "Фигура"), "cube", "select", [
      { value: "cube", label: text("Cube", "Куб") }, { value: "sphere", label: text("Sphere", "Сфера") },
      { value: "cylinder", label: text("Cylinder", "Цилиндр") }, { value: "torus", label: text("Torus", "Тор") }
    ]), field("color", text("Color #RRGGBB", "Цвет #RRGGBB"), "#68b9ed"), ...windowFields()]);
  const coordinates = [["x", "X"], ["y", "Y"], ["z", "Z"], ["rx", text("Rotation X (degrees)", "Поворот X (градусы)")],
    ["ry", text("Rotation Y (degrees)", "Поворот Y (градусы)")], ["rz", text("Rotation Z (degrees)", "Поворот Z (градусы)")], ["scale", text("Scale", "Масштаб")]];
  add("model3d_transform", text("Transform 3D Model", "Трансформация 3D-модели"),
    text("Set absolute position, Euler rotation in degrees and uniform scale. Reset Camera to frame the result.", "Задаёт абсолютную позицию, углы Эйлера в градусах и единый масштаб. Сброс камеры впишет результат в окно."),
    coordinates.map(([key, label]) => field(key, label, key === "scale" ? 1 : 0, "number")),
    coordinates.map(([key, label]) => pin(key, label, "number")));
  add("model3d_animation", text("Control 3D Animation", "Анимация 3D-модели"),
    text("Play, pause or stop an embedded glTF animation. Clip accepts a name or zero-based index; empty selects the first.", "Запускает, приостанавливает или останавливает анимацию glTF. Клип: имя или индекс с нуля; пустое значение выбирает первый."),
    [field("operation", text("Operation", "Действие"), "play", "select", [
      { value: "play", label: text("Play", "Запустить") }, { value: "pause", label: text("Pause", "Пауза") }, { value: "stop", label: text("Stop", "Остановить") }
    ]), field("clip", text("Clip name / index", "Имя / индекс клипа")), field("speed", text("Speed", "Скорость"), 1, "number")],
    [pin("clip", text("Clip", "Клип")), pin("speed", text("Speed", "Скорость"), "number")]);
  add("model3d_reset", text("Reset 3D Camera", "Сброс 3D-камеры"), text("Frame the whole model again.", "Снова вписывает всю модель в окно."), []);
  add("model3d_close", text("Close 3D Viewer", "Закрыть 3D-окно"), text("Close a local viewer and release its graphics resources.", "Закрывает локальное окно и освобождает графические ресурсы."), []);
  add("model3d_hotspot",text("Set 3D Point", "Задать точку 3D"),text("Add, update or remove a model-local point programmatically. For visual authoring, use Edit points on the Show node.","Добавьте, измените или удалите точку программно. Для настройки мышью нажмите Задать точки в ноде показа."),[
    field("hotspotId", "Point ID", "point1"),field("text",text("Hover text", "Текст подсказки")),
    field("showIf", "Show If"),
    field("operation",text("Operation", "Действие"),"set","select",["set","remove"]),
    field("objectName",text("Mesh name (optional)", "Имя объекта модели (необязательно)")),
    ...["x","y","z"].map(k=>field(k,k.toUpperCase(),0,"number"))
  ],[pin("hotspotId","Point ID"),pin("text",text("Text","Текст")),...["x","y","z"].map(k=>pin(k,k.toUpperCase(),"number"))]);
  add("model3d_display",text("3D Display Settings", "Настройки показа 3D"),text("Change full-screen mode and background opacity.","Изменить полноэкранный режим и прозрачность фона."),[
    field("fullscreen",text("Full screen","На весь экран"),"no","select",["no","yes"]),field("backgroundOpacity",text("Background opacity 0–1","Непрозрачность фона 0–1"),1,"number")
  ],[pin("backgroundOpacity",text("Opacity","Непрозрачность"),"number")]);
  registry.registerNode("on_model3d_interaction",{
    title:text("On 3D Interaction", "При взаимодействии с 3D"),cat:"3D",color:"#368fa8",wideNode:true,isEvent:true,eventHook:"sdModelInteraction",
    desc:text("Reacts to this document's viewer. Blank Point ID matches the model and all points; hover fires once on entry.","События окна, открытого этим документом. Пустой ID точки — вся модель и все точки; наведение срабатывает при входе."),
    inputs:[],outputs:[{id:"exec",type:"exec",label:""},...['viewerId','hotspotId','event','text','objectName'].map(k=>pin(k,k)),...["x","y","z"].map(k=>pin(k,k.toUpperCase(),"number"))],
    fields:[{...viewer(),noPin:true},{...field("hotspotId","Point ID (optional)"),noPin:true},{...field("event",text("Event","Событие"),"click","select",["click","hover","leave","any"]),noPin:true}],
    compilePin:(_n,_i,p)=>`{__var:__model3d_${p}|}`
  },{owner:OWNER});
  registry.registerNode("on_model3d_point_action", {
    title:text("On 3D Point Action", "Действие точки 3D"),cat:"3D",color:"#c64646",wideNode:true,isEvent:true,eventHook:"sdModelPointAction",
    desc:text("Pick a 3D widget and point, or connect a point output from Get 3D Object. Runs on Hover or Click; hidden points do not fire.","Выберите 3D-виджет и точку или подключите выход точки из Get 3D Object. Срабатывает по Hover / Click; скрытые точки не вызывают события."),
    inputs:[pin("point",text("Point","Точка"),"any")],
    outputs:[{id:"exec",label:text("On action","При действии"),type:"exec"},pin("point",text("Point","Точка"),"any"),pin("pointId","Point ID"),pin("text",text("Text","Текст")),...["x","y","z"].map(k=>pin(k,k.toUpperCase(),"number")),pin("widgetKey","Widget Key"),pin("event",text("Action","Действие"))],
    fields:[
      {key:"widgetKey",label:text("3D Widget","3D-виджет"),type:"widget-picker",widgetType:"model3d",default:"",noPin:true,refreshNode:true},
      {key:"pointId",label:text("Point","Точка"),type:"model-point-picker",default:"",noPin:true},
      {...field("event",text("Action","Действие"),"click","select",[{value:"hover",label:"Hover"},{value:"click",label:"Click"}]),noPin:true}
    ],
    compileEventData:(n,i)=>({...n.data,...(i.point!==undefined?{point:i.point,connected:true}:{})}),
    compilePin:(_n,_i,p)=>`{__var:__model3d_${p==="pointId"?"hotspotId":p}|}`
  },{owner:OWNER});
  registry.registerNode("model3d_point_events", {
    title:text("3D Point Events", "События точек 3D"),cat:"3D",color:"#368fa8",wideNode:true,isAction:true,isGenericBranch:true,
    desc:text("Connect Show 3D Model's Points and Then outputs. Each saved point gets an Exec output, fired when that point is clicked/hovered. Connect after every Show to bind the new window.","Подключите Массив точек и Далее от ноды показа. Каждая сохранённая точка получает Exec-выход по клику или наведению. Подключайте после каждого показа окна."),
    inputs:[{id:"exec",label:"",type:"exec"},pin("points",text("Points","Массив точек"),"array")],
    outputs:[{id:"ready",label:text("Ready","Готово"),type:"exec"}],
    computeDynamicOutputs:n=>[{id:"ready",label:text("Ready","Готово"),type:"exec"},...modelPoints(n.data?.pointDefinitions).map(p=>({id:pointPinId(p.id),label:p.text?`${p.id} · ${p.text}`:p.id,type:"exec"})),pin("pointId","Point ID"),pin("point",text("Point","Точка"),"any")],
    fields:[field("event",text("Event","Событие"),"click","select",["click","hover","leave"])],
    dynamicBranchToken:resultToken,
    toAction:(n,i={})=>({type:"model3d_point_events",__resultNodeId:n.id,points:i.points??"[]",event:n.data?.event??"click",pointDefinitions:modelPoints(n.data?.pointDefinitions)})
  },{owner:OWNER});
}

export function installModelActions(serviceLoader = () => import("./model-viewer.mjs")) {
  registerNodeActionHandler("model3d_point_events", async ctx => {
    const points=modelPoints(await ctx.resolveValue(ctx.action.points));
    const service=await serviceLoader();
    const {ButtonExecutor}=await import("../helpers/button-executor.mjs");
    const run=async(actions,runtime)=>{for(const action of actions??[])await ButtonExecutor._runAction(action,ctx.item,ctx.actor,ctx.buttonDef,runtime);};
    const ids=new Set(points.map(p=>p.viewerId).filter(Boolean));
    for(const id of ids){
      const viewer=service.getModelViewer(id);
      if(!viewer||viewer.disposed)continue;
      const pointIds=new Set(points.filter(p=>p.viewerId===id).map(p=>p.id));
      viewer.interactionListeners.set(ctx.action.__resultNodeId,async payload=>{
        if(payload.event!==ctx.action.event||!pointIds.has(payload.hotspotId))return;
        const runtime={...ctx.runtime,__nodeResults:{...ctx.runtime?.__nodeResults}};
        runtime.__nodeResults[ctx.action.__resultNodeId]={pointId:payload.hotspotId,point:points.find(p=>p.viewerId===id&&p.id===payload.hotspotId)};
        await run(ctx.action[`${pointPinId(payload.hotspotId)}Actions`],runtime);
      });
    }
    await run(ctx.action.readyActions,ctx.runtime);
    return {success:ids.size>0};
  },{owner:OWNER});
  for (const type of ["model3d_open", "model3d_primitive", "model3d_transform", "model3d_animation", "model3d_reset", "model3d_close", "model3d_hotspot", "model3d_display"]) {
    registerNodeActionHandler(type, async ctx => {
      const args = {};
      try {
        for (const [key, value] of Object.entries(ctx.action?.args ?? {})) {
          args[key] = key==="hotspots" && Array.isArray(ctx.action.hotspots) ? ctx.action.hotspots
            : key==="showIf" && ctx.action.showIfExpression!==undefined ? ctx.action.showIfExpression
            : ctx.resolveValue ? await ctx.resolveValue(value) : value;
        }
        args.viewerId = String(args.viewerId || "model");
        const service = await serviceLoader();
        if (type === "model3d_open" || type === "model3d_primitive") {
          const doc=ctx.item??ctx.actor;
          const legacyKey=encodeURIComponent(String(ctx.action.__resultNodeId||args.viewerId)).replaceAll('.','%2E');
          const legacy=doc?.flags?.sd?.modelHotspots?.[legacyKey];
          if(!ctx.action.pointsAuthored&&Array.isArray(legacy))args.hotspots=legacy;
          args.editPoints=false;
          args.document=doc;
          args.onInteraction=payload=>runModelInteraction(doc,payload,ctx.runtime);
          const opened=await service.openModelViewer(args);
          const points=opened?.getPoints?.()??modelPoints(args.hotspots).map(p=>({...p,viewerId:args.viewerId}));
          return {viewerId:args.viewerId,points,object:{viewerId:args.viewerId,kind:"model3d"},success:true,error:""};
        }
        else if (type === "model3d_close") await service.closeModelViewer(args.viewerId);
        else {
          const viewer = service.getModelViewer(args.viewerId);
          if (!viewer || viewer.disposed || !viewer.model) throw new Error(text("3D viewer is not open or still loading.", "3D-окно не открыто или ещё загружается."));
          if (type === "model3d_transform") viewer.transform(args);
          else if (type === "model3d_animation") viewer.animate(args.operation, args.clip, args.speed);
          else if (type === "model3d_hotspot") viewer.setHotspot(args);
          else if (type === "model3d_display") {viewer.setFullscreen(args.fullscreen===true||args.fullscreen==="yes");viewer.setBackgroundOpacity(args.backgroundOpacity);}
          else viewer.resetCamera();
        }
        return { viewerId: args.viewerId, success: true, error: "" };
      } catch (error) {
        const message = String(error?.message ?? error);
        globalThis.ui?.notifications?.warn?.(`3D: ${message}`);
        return { viewerId: String(args.viewerId || "model"), success: false, error: message };
      }
    }, { owner: OWNER });
  }
}

export function initModelNodes() {
  installModelActions();
  if (globalThis.SD?.nodeRegistry ?? globalThis.CONFIG?.SD?.nodeRegistry) registerModelNodes();
  else globalThis.Hooks?.once?.("sdNodeRegistryReady", registerModelNodes);
}
globalThis.Hooks?.once?.("ready", initModelNodes);
