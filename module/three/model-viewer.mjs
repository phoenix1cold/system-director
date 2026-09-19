import { SDFoundryWindowHost } from "../helpers/foundry-window-host.mjs";

const viewers = new Map();
let dependencies;
const ru = () => globalThis.game?.i18n?.lang === "ru";
export const label3D = (en, russian) => ru() ? russian : en;
const number = (v, fallback) => Number.isFinite(Number(v)) ? Number(v) : fallback;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

class ModelViewerWindow extends SDFoundryWindowHost {
  _canDetach() { return false; }
}

function loadDependencies() {
  return dependencies ??= Promise.all([
    import("../../vendor/three/build/three.module.min.js"),
    import("../../vendor/three/examples/jsm/controls/OrbitControls.js"),
    import("../../vendor/three/examples/jsm/loaders/GLTFLoader.js")
  ]).catch(error => { dependencies = null; throw error; });
}

export function modelURL(source, base = globalThis.document?.baseURI) {
  const raw = String(source ?? "").trim();
  if (!raw) throw new Error(label3D("Specify a GLB or glTF file path.", "Укажите путь к файлу GLB или glTF."));
  const routed = !/^(?:[a-z]+:|\/)/i.test(raw) ? (globalThis.foundry?.utils?.getRoute?.(raw) ?? raw) : raw;
  const url = new URL(routed, base);
  if (!["http:", "https:"].includes(url.protocol) || !/\.(glb|gltf)$/i.test(url.pathname)) {
    throw new Error(label3D("Use an HTTP(S) or Foundry path ending in .glb or .gltf.", "Нужен путь Foundry или HTTP(S)-адрес файла .glb/.gltf."));
  }
  return url.href;
}

/** Dispose shared geometries/materials/textures only once, including unused glTF scenes. */
export function disposeModels(roots) {
  const geometries = new Set(), materials = new Set(), textures = new Set(), skeletons = new Set(), images = new Set();
  for (const root of roots ?? []) root?.traverse?.(object => {
    if (object.geometry) geometries.add(object.geometry);
    if (object.skeleton) skeletons.add(object.skeleton);
    for (const material of [object.material].flat().filter(Boolean)) {
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
  });
  for (const texture of textures) {
    for (const image of [texture.source?.data].flat()) if (image?.close) images.add(image);
    texture.dispose();
  }
  images.forEach(image => image.close());
  geometries.forEach(geometry => geometry.dispose());
  materials.forEach(material => material.dispose());
  skeletons.forEach(skeleton => skeleton.dispose());
}

export class ModelViewer {
  constructor(id, options = {}) {
    this.id = id;
    this.options = options;
    this.disposed = false;
    this.roots = [];
    this.clips = [];
    this.hotspots = new Map();
  }

  async open() {
    this.root = document.createElement("div");
    this.root.className = "sd-model-viewer";
    const toolbar = document.createElement("div");
    toolbar.className = "sd-model-toolbar";
    this.root.append(toolbar);
    const button = (text, callback) => {
      const element = document.createElement("button");
      element.type = "button";
      element.textContent = text;
      element.addEventListener("click", callback);
      toolbar.append(element);
      return element;
    };
    this.resetButton = button(label3D("Reset camera", "Сброс камеры"), () => this.resetCamera());
    this.rotateButton = button(label3D("Auto rotate", "Автовращение"), () => {
      if (!this.controls) return;
      this.controls.autoRotate = !this.controls.autoRotate;
      this.rotateButton.setAttribute("aria-pressed", String(this.controls.autoRotate));
    });
    this.rotateButton.setAttribute("aria-pressed", "false");
    this.wireButton = button(label3D("Wireframe", "Каркас"), () => {
      this.wireframe = !this.wireframe;
      this.model?.traverse(object => {
        for (const material of [object.material].flat().filter(Boolean)) material.wireframe = this.wireframe;
      });
      this.wireButton.setAttribute("aria-pressed", String(this.wireframe));
    });
    this.wireButton.setAttribute("aria-pressed", "false");
    this.fullscreenButton = button(label3D("Full screen", "На весь экран"), () => this.setFullscreen(!this.fullscreen));
    this.fullscreenButton.setAttribute("aria-pressed", "false");
    const opacityLabel = document.createElement("label");
    opacityLabel.textContent = label3D("Background", "Фон");
    this.opacityInput = document.createElement("input");this.opacityInput.type="range";
    this.opacityInput.min="0";this.opacityInput.max="1";this.opacityInput.step="0.05";
    this.opacityInput.value=String(clamp(number(this.options.backgroundOpacity,1),0,1));
    this.opacityInput.setAttribute("aria-label",label3D("Background opacity", "Непрозрачность фона"));
    this.opacityInput.addEventListener("input",()=>this.setBackgroundOpacity(this.opacityInput.value));
    opacityLabel.append(this.opacityInput);toolbar.append(opacityLabel);
    const pointStart=toolbar.childElementCount;
    this.pointButton=button(label3D("Place point", "Разместить точку"),()=>{
      this.placing=!this.placing;this.pointButton.setAttribute("aria-pressed",String(this.placing));
    });
    this.pointButton.setAttribute("aria-pressed","false");
    this.pointId=document.createElement("input");this.pointId.placeholder="Point ID";this.pointId.value="point1";this.pointId.setAttribute("aria-label","Point ID");
    this.pointText=document.createElement("input");this.pointText.placeholder=label3D("Point tooltip", "Текст подсказки");this.pointText.setAttribute("aria-label",this.pointText.placeholder);
    toolbar.append(this.pointId,this.pointText);
    this.pointSelect=document.createElement("select");this.pointSelect.setAttribute("aria-label",label3D("Edit point", "Редактировать точку"));
    this.pointSelect.addEventListener("change",()=>{const p=this.hotspots.get(this.pointSelect.value)?.data;if(p){this.pointId.value=p.id;this.pointText.value=p.text;}});toolbar.append(this.pointSelect);
    button(label3D("Update point", "Изменить точку"),()=>{const p=this.hotspots.get(this.pointSelect.value)?.data;if(p){const id=this.pointId.value.trim()||p.id;if(id!==p.id)this.setHotspot({id:p.id,operation:"remove"});this.setHotspot({...p,id,text:this.pointText.value});}});
    button(label3D("Delete point", "Удалить точку"),()=>this.setHotspot({id:this.pointSelect.value,operation:"remove"}));
    this.savePointsButton=button(label3D("Save points", "Сохранить точки"),async()=>{
      this.savePointsButton.disabled=true;
      try {await this.options.onSaveHotspots?.([...this.hotspots.values()].map(p=>p.data));this.savePointsButton.textContent=label3D("Saved", "Сохранено");}
      catch(error){globalThis.ui?.notifications?.error?.(String(error.message??error));}
      finally{this.savePointsButton.disabled=false;}
    });
    this.savePointsButton.hidden=typeof this.options.onSaveHotspots!=="function";
    button(label3D("Export points", "Экспорт точек"),()=>{
      if(!this.exportArea){this.exportArea=document.createElement("textarea");this.exportArea.className="sd-model-export";this.exportArea.readOnly=true;this.root.append(this.exportArea);}
      this.exportArea.value=JSON.stringify([...this.hotspots.values()].map(p=>p.data),null,2);this.exportArea.hidden=false;this.exportArea.focus();this.exportArea.select();
    });
    const editor=document.createElement("details");editor.className="sd-model-point-editor";
    const summary=document.createElement("summary");summary.textContent=label3D("Edit interactive points", "Редактор интерактивных точек");
    const pointTools=document.createElement("div");
    for(const child of [...toolbar.children].slice(pointStart))pointTools.append(child);
    editor.append(summary,pointTools);toolbar.append(editor);
    this.clipSelect = document.createElement("select");
    this.clipSelect.setAttribute("aria-label", label3D("Animation", "Анимация"));
    this.clipSelect.hidden = true;
    this.clipSelect.addEventListener("change", () => this.animate("play", this.clipSelect.value));
    toolbar.append(this.clipSelect);
    this.playButton = button(label3D("Play / pause", "Пуск / пауза"), () => {
      if (this.animation) this.animate(this.animation.paused ? "play" : "pause", this.clipSelect.value);
      else this.animate("play", this.clipSelect.value);
    });
    this.playButton.hidden = true;
    this.viewport = document.createElement("div");
    this.viewport.className = "sd-model-viewport";
    this.status = document.createElement("div");
    this.status.className = "sd-model-status";
    this.status.setAttribute("role", "status");
    this.status.textContent = label3D("Loading 3D model…", "Загрузка 3D-модели…");
    this.viewport.append(this.status);
    const hint = document.createElement("div");
    hint.className = "sd-model-hint";
    hint.textContent = label3D("Drag: orbit · Wheel: zoom · Right drag: pan", "ЛКМ: вращение · Колесо: масштаб · ПКМ: перемещение");
    this.root.append(this.viewport, hint);
    this.resetButton.disabled = this.rotateButton.disabled = this.wireButton.disabled = true;
    this.app = new ModelViewerWindow({
      id: `sd-model-${crypto.randomUUID()}`, title: String(this.options.title || label3D("3D Viewer", "Просмотр 3D")),
      icon: "fa-solid fa-cube", width: clamp(number(this.options.width, 720), 360, 1920),
      height: clamp(number(this.options.height, 580), 300, 1440), content: this.root,
      classes: ["sd-model-window"],
      onClose: () => this.dispose()
    });
    // A WebGL canvas belongs to this document; do not offer native window detachment.
    await this.app.render(true);
    const [THREE, { OrbitControls }, { GLTFLoader }] = await loadDependencies();
    if (this.disposed) throw new Error(label3D("Viewer closed while loading.", "Окно закрыто во время загрузки."));
    this.THREE = THREE;
    this.scene = new THREE.Scene();
    const background = /^#[0-9a-f]{6}$/i.test(this.options.background ?? "") ? this.options.background : "#182131";
    this.background = background;
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.01, 1000);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.setBackgroundOpacity(this.opacityInput.value);
    this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.viewport.append(this.renderer.domElement);
    this.renderer.domElement.setAttribute("aria-label", label3D("Interactive 3D model", "Интерактивная 3D-модель"));
    this.renderer.domElement.addEventListener("webglcontextlost", event => {
      event.preventDefault();
      this.renderer.setAnimationLoop(null);
      this.status.hidden = false;
      this.status.textContent = label3D("Graphics context lost. Reopen the viewer.", "Графический контекст потерян. Откройте просмотр заново.");
    });
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x59667c, 2.5));
    const key = new THREE.DirectionalLight(0xffffff, 3);
    key.position.set(3, 5, 4);
    this.scene.add(key);
    this.pivot = new THREE.Group();
    this.scene.add(this.pivot);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.viewport);
    this.resize();

    if (this.options.primitive) {
      const geometries = { cube: () => new THREE.BoxGeometry(), sphere: () => new THREE.SphereGeometry(0.7, 40, 24), cylinder: () => new THREE.CylinderGeometry(0.5, 0.5, 1.3, 40), torus: () => new THREE.TorusGeometry(0.6, 0.2, 20, 64) };
      if (!geometries[this.options.primitive]) throw new Error("Unknown 3D primitive");
      const color = /^#[0-9a-f]{6}$/i.test(this.options.color ?? "") ? this.options.color : "#68b9ed";
      this.model = new THREE.Mesh(geometries[this.options.primitive](), new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.15 }));
      this.roots = [this.model];
    } else {
      const loader = new GLTFLoader();
      // Closing during a request is handled by the disposed check below.
      loader.manager.setURLModifier(url => {
        const resolved = new URL(url, document.baseURI);
        if (!["http:", "https:", "data:", "blob:"].includes(resolved.protocol)) throw new Error("Unsupported model resource URL");
        return resolved.href;
      });
      const gltf = await this.loadModel(loader, modelURL(this.options.src));
      this.model = gltf.scene;
      this.roots = gltf.scenes ?? [gltf.scene];
      this.clips = gltf.animations ?? [];
    }
    this.pivot.add(this.model);
    this.installInteractions();
    const initialPoints=typeof this.options.hotspots==="string" ? JSON.parse(this.options.hotspots||"[]") : this.options.hotspots??[];
    if(!Array.isArray(initialPoints))throw new Error("3D points must be an array");
    for(const point of initialPoints)this.setHotspot(point);
    if (new THREE.Box3().setFromObject(this.model).isEmpty()) throw new Error(label3D("The model has no visible geometry.", "Модель не содержит видимой геометрии."));
    this.mixer = new THREE.AnimationMixer(this.model);
    for (const [index, clip] of this.clips.entries()) {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = clip.name || `Animation ${index + 1}`;
      this.clipSelect.append(option);
    }
    this.clipSelect.hidden = this.playButton.hidden = !this.clips.length;
    this.resetCamera();
    this.status.hidden = true;
    this.resetButton.disabled = this.rotateButton.disabled = this.wireButton.disabled = false;
    let last;
    this.renderer.setAnimationLoop(time => {
      if (this.disposed) return;
      const delta = last === undefined ? 0 : Math.min((time - last) / 1000, 0.1);
      last = time;
      if (this.root.ownerDocument.hidden || this.app.minimized) return;
      this.controls.update(delta);
      this.mixer.update(delta);
      this.updateHotspots();
      this.renderer.render(this.scene, this.camera);
    });
    if(this.options.fullscreen===true||this.options.fullscreen==="yes")this.setFullscreen(true);
    return this;
  }

  setBackgroundOpacity(value) {
    this.backgroundOpacity=clamp(number(value,1),0,1);
    if(this.opacityInput)this.opacityInput.value=String(this.backgroundOpacity);
    this.renderer?.setClearColor(this.background||"#182131",this.backgroundOpacity);
  }

  setFullscreen(enabled) {
    if(this.disposed)return;
    this.fullscreen=!!enabled;
    if(this.fullscreen&&!this.fullscreenPlaceholder){
      this.fullscreenPlaceholder=document.createComment("3D viewer window");this.root.before(this.fullscreenPlaceholder);document.body.append(this.root);
    }else if(!this.fullscreen&&this.fullscreenPlaceholder){this.fullscreenPlaceholder.replaceWith(this.root);this.fullscreenPlaceholder=null;}
    this.root.classList.toggle("sd-model-fullscreen",this.fullscreen);
    this.fullscreenButton?.setAttribute("aria-pressed",String(this.fullscreen));this.resize();
  }

  emitInteraction(event, point = {}, local = null) {
    const payload={viewerId:this.id,event,hotspotId:String(point.id??""),text:String(point.text??this.options.tooltip??""),objectName:String(point.objectName??""),x:local?.x??point.x??0,y:local?.y??point.y??0,z:local?.z??point.z??0};
    globalThis.Hooks?.callAll?.("sdModelInteraction",payload);
    Promise.resolve(this.options.onInteraction?.(payload)).catch(error=>console.error("SD | 3D interaction",error));
  }

  installInteractions() {
    const {THREE}=this;this.interactionAbort=new AbortController();const signal=this.interactionAbort.signal;
    this.raycaster=new THREE.Raycaster();
    this.tooltip=document.createElement("div");this.tooltip.className="sd-model-tooltip";this.tooltip.hidden=true;this.tooltip.setAttribute("role","tooltip");this.viewport.append(this.tooltip);
    this.markerLayer=document.createElement("div");this.markerLayer.className="sd-model-points";this.viewport.append(this.markerLayer);
    this.hitAt=event=>{
      const r=this.renderer.domElement.getBoundingClientRect();
      this.raycaster.setFromCamera(new THREE.Vector2((event.clientX-r.left)/r.width*2-1,-(event.clientY-r.top)/r.height*2+1),this.camera);
      this.model.updateWorldMatrix(true,true);return this.raycaster.intersectObject(this.model,true)[0];
    };
    const canvas=this.renderer.domElement;
    let down,hovered=false;
    canvas.addEventListener("pointerdown",event=>{if(event.button===0)down={x:event.clientX,y:event.clientY};},{signal});
    canvas.addEventListener("pointermove",event=>{
      if(event.buttons){this.tooltip.hidden=true;return;}
      const hit=this.hitAt(event);
      if(hit){this.showTooltip(this.options.tooltip,event.clientX,event.clientY);if(!hovered)this.emitInteraction("hover",{objectName:hit.object.name},this.model.worldToLocal(hit.point.clone()));}
      else {this.tooltip.hidden=true;if(hovered)this.emitInteraction("leave");}
      hovered=!!hit;
    },{signal});
    canvas.addEventListener("pointerleave",()=>{this.tooltip.hidden=true;if(hovered)this.emitInteraction("leave");hovered=false;},{signal});
    canvas.addEventListener("pointerup",event=>{
      const start=down;down=null;if(!start||Math.hypot(event.clientX-start.x,event.clientY-start.y)>6)return;
      const hit=this.hitAt(event);if(!hit)return;
      const local=this.model.worldToLocal(hit.point.clone());
      if(this.placing){
        const id=this.pointId.value.trim()||`point${this.hotspots.size+1}`;
        this.setHotspot({id,text:this.pointText.value||id,x:local.x,y:local.y,z:local.z});
        this.placing=false;this.pointButton.setAttribute("aria-pressed","false");this.pointId.value=id;
        this.emitInteraction("place",{id,text:this.pointText.value},local);
      }else this.emitInteraction("click",{objectName:hit.object.name},local);
    },{signal});
    canvas.addEventListener("pointercancel",()=>{down=null;},{signal});
    document.addEventListener("keydown",event=>{if(event.key==="Escape"&&this.fullscreen&&!event.target.closest?.(".sd-search-select")){event.preventDefault();event.stopPropagation();this.setFullscreen(false);}},{signal,capture:true});
  }

  showTooltip(text,x,y) {
    this.tooltip.textContent=String(text??"");this.tooltip.hidden=!text;
    const r=this.viewport.getBoundingClientRect();
    this.tooltip.style.left=`${Math.max(8,Math.min(x-r.left+12,this.viewport.clientWidth-this.tooltip.offsetWidth-8))}px`;
    this.tooltip.style.top=`${Math.max(8,Math.min(y-r.top+12,this.viewport.clientHeight-this.tooltip.offsetHeight-8))}px`;
  }

  setHotspot(options) {
    const id=String(options.id||options.hotspotId||"point");
    if(options.operation==="remove"){this.hotspots.get(id)?.button.remove();this.hotspots.delete(id);this.refreshPointChoices();return;}
    const data={id,text:String(options.text||id),objectName:String(options.objectName||""),x:number(options.x,0),y:number(options.y,0),z:number(options.z,0)};
    if(this.hotspots.size>=128&&!this.hotspots.has(id))throw new Error("Maximum 128 points per viewer");
    if(data.objectName&&!this.model.getObjectByName(data.objectName))throw new Error(`3D object not found: ${data.objectName}`);
    this.hotspots.get(id)?.button.remove();
    const button=document.createElement("button");button.type="button";button.className="sd-model-point";button.textContent="●";button.setAttribute("aria-label",data.text);button.dataset.pointId=id;
    button.addEventListener("pointerdown",e=>e.stopPropagation());
    button.addEventListener("pointerenter",e=>{this.showTooltip(data.text,e.clientX,e.clientY);this.emitInteraction("hover",data);});
    button.addEventListener("pointerleave",()=>{this.tooltip.hidden=true;this.emitInteraction("leave",data);});
    button.addEventListener("focus",()=>{const r=button.getBoundingClientRect();this.showTooltip(data.text,r.left,r.bottom);});
    button.addEventListener("blur",()=>{this.tooltip.hidden=true;});
    button.addEventListener("click",e=>{e.stopPropagation();this.emitInteraction("click",data);});
    this.markerLayer.append(button);this.hotspots.set(id,{data,button});this.refreshPointChoices(id);this.updateHotspots();
  }

  refreshPointChoices(selected=this.pointSelect.value) {
    this.pointSelect.replaceChildren();
    for(const {data} of this.hotspots.values()){const option=document.createElement("option");option.value=data.id;option.textContent=`${data.id} · ${data.text}`;this.pointSelect.append(option);}
    this.pointSelect.value=selected;
    this.savePointsButton.textContent=label3D("Save points", "Сохранить точки");
  }

  updateHotspots() {
    if(!this.model)return;
    this.model.updateWorldMatrix(true,true);this.camera.updateMatrixWorld();
    for(const {data,button} of this.hotspots.values()) {
      const object=data.objectName?this.model.getObjectByName(data.objectName):this.model;
      const point=object.localToWorld(new this.THREE.Vector3(data.x,data.y,data.z)).project(this.camera);
      button.hidden=point.z < -1||point.z>1||Math.abs(point.x)>1||Math.abs(point.y)>1;
      button.style.left=`${(point.x+1)*.5*this.viewport.clientWidth}px`;button.style.top=`${(1-point.y)*.5*this.viewport.clientHeight}px`;
    }
  }

  async loadModel(loader, url) {
    let accepting = true, timer;
    const cancelled = new Promise((_, reject) => {
      this.cancelLoad = () => reject(new Error(label3D("Viewer closed while loading.", "Окно закрыто во время загрузки.")));
      timer = setTimeout(() => reject(new Error(label3D("Model loading timed out (60 seconds).", "Время загрузки модели истекло (60 секунд)."))), 60000);
    });
    const loading = loader.loadAsync(url).then(gltf => {
      if (!accepting || this.disposed) {
        disposeModels(gltf.scenes ?? [gltf.scene]);
        throw new Error("Model load cancelled");
      }
      return gltf;
    });
    try { return await Promise.race([loading, cancelled]); }
    finally { accepting = false; clearTimeout(timer); this.cancelLoad = null; }
  }

  resize() {
    if (!this.renderer || this.disposed) return;
    const width = Math.max(1, this.viewport.clientWidth), height = Math.max(1, this.viewport.clientHeight);
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  resetCamera() {
    if (!this.model || this.disposed) return;
    const THREE = this.THREE;
    this.pivot.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.pivot);
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 0.001);
    const vertical = THREE.MathUtils.degToRad(this.camera.fov) / 2;
    const angle = Math.min(vertical, Math.atan(Math.tan(vertical) * this.camera.aspect));
    const distance = radius / Math.sin(angle) * 1.2;
    this.camera.near = Math.max(radius / 1000, 0.000001);
    this.camera.far = distance + radius * 100;
    this.camera.position.copy(center).add(new THREE.Vector3(1, 0.65, 1).normalize().multiplyScalar(distance));
    this.controls.target.copy(center);
    this.controls.minDistance = radius * 0.05;
    this.controls.maxDistance = distance * 20;
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.controls.saveState();
  }

  transform(options) {
    if (!this.model || this.disposed) throw new Error(label3D("The viewer is not ready.", "Окно ещё не готово."));
    const values = ["x", "y", "z", "rx", "ry", "rz", "scale"].map(key => Number(options[key] ?? (key === "scale" ? 1 : 0)));
    if (!values.every(Number.isFinite) || values[6] <= 0) throw new Error(label3D("Transform requires finite numbers and a positive scale.", "Координаты должны быть числами, масштаб — больше нуля."));
    this.pivot.position.set(...values.slice(0, 3));
    this.pivot.rotation.set(...values.slice(3, 6).map(this.THREE.MathUtils.degToRad));
    this.pivot.scale.setScalar(values[6]);
  }

  animate(operation = "play", clip = "", speed = 1) {
    if (!this.model || this.disposed) throw new Error(label3D("The viewer is not ready.", "Окно ещё не готово."));
    if (!this.clips.length) throw new Error(label3D("This model has no animations.", "В модели нет анимаций."));
    if (!["play", "pause", "stop"].includes(operation)) throw new Error("Unknown animation operation");
    if (operation === "stop") { this.mixer.stopAllAction(); this.animation = null; return; }
    if (operation === "pause") { if (this.animation) this.animation.paused = true; return; }
    const selected = this.clips.find(entry => entry.name === String(clip)) ?? this.clips[clip === "" ? 0 : Number(clip)];
    if (!selected) throw new Error(label3D("Animation not found.", "Анимация не найдена."));
    const rate = Number(speed);
    if (!Number.isFinite(rate) || rate < 0) throw new Error("Animation speed must be a non-negative number");
    const action = this.mixer.clipAction(selected);
    if (action !== this.animation) { this.mixer.stopAllAction(); action.reset(); }
    action.paused = false;
    action.setEffectiveTimeScale(rate);
    action.play();
    this.animation = action;
    this.clipSelect.value = String(this.clips.indexOf(selected));
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.interactionAbort?.abort();this.fullscreenPlaceholder?.remove();this.hotspots.clear();
    this.cancelLoad?.();
    if (viewers.get(this.id) === this) viewers.delete(this.id);
    this.resizeObserver?.disconnect();
    this.renderer?.setAnimationLoop(null);
    this.controls?.dispose();
    this.mixer?.stopAllAction();
    if (this.model) this.mixer?.uncacheRoot(this.model);
    disposeModels(this.roots);
    this.scene?.clear();
    this.renderer?.dispose();
    this.renderer?.forceContextLoss();
    this.root?.remove();
    this.roots = [];
  }

  async close() { this.dispose(); await this.app?.close(); }
}

export async function openModelViewer(options = {}) {
  const id = String(options.viewerId || "model");
  const previous = viewers.get(id);
  const viewer = new ModelViewer(id, options);
  viewers.set(id, viewer);
  try {
    await previous?.close();
    if (viewers.get(id) !== viewer || viewer.disposed) throw new Error("Viewer opening was cancelled");
    await viewer.open();
    return viewer;
  } catch (error) { await viewer.close(); throw error; }
}

export function getModelViewer(id) { return viewers.get(String(id || "model")); }
export async function closeModelViewer(id) {
  const viewer = getModelViewer(id);
  if (!viewer) return false;
  await viewer.close();
  return true;
}
