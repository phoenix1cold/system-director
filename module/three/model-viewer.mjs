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
      onClose: () => this.dispose()
    });
    // A WebGL canvas belongs to this document; do not offer native window detachment.
    await this.app.render(true);
    const [THREE, { OrbitControls }, { GLTFLoader }] = await loadDependencies();
    if (this.disposed) throw new Error(label3D("Viewer closed while loading.", "Окно закрыто во время загрузки."));
    this.THREE = THREE;
    this.scene = new THREE.Scene();
    const background = /^#[0-9a-f]{6}$/i.test(this.options.background ?? "") ? this.options.background : "#182131";
    this.scene.background = new THREE.Color(background);
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.01, 1000);
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
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
      this.renderer.render(this.scene, this.camera);
    });
    return this;
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
