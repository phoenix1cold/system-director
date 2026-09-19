import { registerNodeActionHandler } from "../helpers/node-runtime-api.mjs";

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
        pin("success", text("Success", "Успех"), "bool"),
        pin("error", text("Error", "Ошибка"))
      ],
      fields: [viewer(), ...fields],
      // Action outputs must also use dynamicBranchToken: the graph's value compiler
      // stops at isAction before reaching compilePin.
      dynamicBranchToken: resultToken,
      compilePin: (node, _inputs, output) => resultToken(node, output),
      toAction: (node, connected = {}) => ({
        type: id, __resultNodeId: node.id,
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
    field("background", text("Background #RRGGBB", "Фон #RRGGBB"), "#182131")
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
}

export function installModelActions(serviceLoader = () => import("./model-viewer.mjs")) {
  for (const type of ["model3d_open", "model3d_primitive", "model3d_transform", "model3d_animation", "model3d_reset", "model3d_close"]) {
    registerNodeActionHandler(type, async ctx => {
      const args = {};
      try {
        for (const [key, value] of Object.entries(ctx.action?.args ?? {})) {
          args[key] = ctx.resolveValue ? await ctx.resolveValue(value) : value;
        }
        args.viewerId = String(args.viewerId || "model");
        const service = await serviceLoader();
        if (type === "model3d_open" || type === "model3d_primitive") await service.openModelViewer(args);
        else if (type === "model3d_close") await service.closeModelViewer(args.viewerId);
        else {
          const viewer = service.getModelViewer(args.viewerId);
          if (!viewer || viewer.disposed || !viewer.model) throw new Error(text("3D viewer is not open or still loading.", "3D-окно не открыто или ещё загружается."));
          if (type === "model3d_transform") viewer.transform(args);
          else if (type === "model3d_animation") viewer.animate(args.operation, args.clip, args.speed);
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
