// Real WebGL/Three.js; only the Foundry window lifecycle is stubbed.
globalThis.game = { i18n: { lang: "en" } };
globalThis.foundry = { applications: { api: { ApplicationV2: class {
  constructor(options) { this.options = options; }
  async render() {
    if (typeof this._canDetach !== "function" || this._canDetach()) throw new Error("3D canvas should remain in its document");
    this.element = document.createElement("section");
    this.element.className = "application";
    this.element.style.width = `${this.options.position.width}px`;
    this.element.style.height = `${this.options.position.height}px`;
    const title = document.createElement("div");
    title.className = "test-title";
    title.textContent = this.title;
    const content = document.createElement("div");
    content.className = "window-content";
    this.element.append(title, content);
    document.body.append(this.element);
    this._replaceHTML(await this._renderHTML(), content);
    return this;
  }
  async close() { this.element?.remove(); }
} } } };

const assert = (value, message) => { if (!value) throw new Error(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 80));
const checks = [];
const originalFetch = globalThis.fetch;
const data = new Float32Array([
  -1,-1,0, 1,-1,0, 0,1,0, // positions
  0,0,1, 0,0,1, 0,0,1, // normals
  0,1, // animation times
  0,0,0, 0,1,0 // translation keys
]);
const binary = new Uint8Array(data.buffer);
const fixture = {
  asset: { version: "2.0", generator: "SD viewer tests" }, scene: 0,
  scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, material: 0 }] }],
  materials: [{ doubleSided: true, pbrMetallicRoughness: { baseColorFactor: [0.25,0.65,1,1], metallicFactor: 0, roughnessFactor: 0.6 } }],
  buffers: [{ byteLength: binary.length, uri: `data:application/octet-stream;base64,${btoa(String.fromCharCode(...binary))}` }],
  bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 36 }, { buffer: 0, byteOffset: 72, byteLength: 8 }, { buffer: 0, byteOffset: 80, byteLength: 24 }],
  accessors: [
    { bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [-1,-1,0], max: [1,1,0] },
    { bufferView: 1, componentType: 5126, count: 3, type: "VEC3" },
    { bufferView: 2, componentType: 5126, count: 2, type: "SCALAR", min: [0], max: [1] },
    { bufferView: 3, componentType: 5126, count: 2, type: "VEC3" }
  ],
  animations: [{ name: "Bounce", samplers: [{ input: 2, output: 3, interpolation: "LINEAR" }], channels: [{ sampler: 0, target: { node: 0, path: "translation" } }] }]
};
const glbJSON = structuredClone(fixture);
delete glbJSON.buffers[0].uri;
let json = JSON.stringify(glbJSON);
json = json.padEnd(Math.ceil(json.length / 4) * 4, " ");
const jsonBytes = new TextEncoder().encode(json);
const glb = new ArrayBuffer(12 + 8 + jsonBytes.length + 8 + binary.length);
const view = new DataView(glb);
[0x46546c67, 2, glb.byteLength, jsonBytes.length, 0x4e4f534a].forEach((value, i) => view.setUint32(i * 4, value, true));
new Uint8Array(glb, 20, jsonBytes.length).set(jsonBytes);
view.setUint32(20 + jsonBytes.length, binary.length, true);
view.setUint32(24 + jsonBytes.length, 0x004e4942, true);
new Uint8Array(glb, 28 + jsonBytes.length).set(binary);
globalThis.fetch = async (request, options) => {
  const url = typeof request === "string" ? request : request.url;
  if (url.endsWith("/fixture.gltf")) return new Response(JSON.stringify(fixture));
  if (url.endsWith("/fixture.glb")) return new Response(glb);
  if (url.endsWith("/invalid.glb")) return new Response("not a model");
  if (url.endsWith("/slow.gltf")) { await new Promise(resolve => setTimeout(resolve, 350)); return new Response(JSON.stringify(fixture)); }
  return originalFetch(request, options);
};

try {
  const { openModelViewer, closeModelViewer, getModelViewer } = await import("../module/three/model-viewer.mjs");
  let viewer = await openModelViewer({ viewerId: "qa", primitive: "cube" });
  await pause();
  assert(viewer.renderer.info.render.triangles > 0, "Primitive was not rendered");
  assert(viewer.camera.aspect > 1, "Initial camera aspect");
  checks.push("WebGL2 cube renders with camera framing");
  viewer.transform({ x: 3, y: 2, z: 1, ry: 90, scale: 2 });
  assert(Math.abs(viewer.pivot.rotation.y - Math.PI / 2) < 1e-6, "Degrees conversion");
  assert(viewer.pivot.scale.x === 2, "Scale");
  viewer.resetCamera();
  assert(Math.abs(viewer.controls.target.x - 3) < 0.001, "Reset camera does not follow transformed model");
  viewer.app.element.style.width = "430px";
  await pause();
  assert(Math.abs(viewer.camera.aspect - viewer.viewport.clientWidth / viewer.viewport.clientHeight) < 0.001, "ResizeObserver aspect");
  viewer.wireButton.click();
  assert(viewer.model.material.wireframe, "Wireframe button");
  viewer.rotateButton.click();
  assert(viewer.controls.autoRotate, "Auto rotate button");
  checks.push("Transforms, reset camera, resize, wireframe and automatic rotation");
  const old = viewer;
  viewer = await openModelViewer({ viewerId: "qa", src: "fixture.gltf" });
  assert(old.disposed && !old.root.isConnected, "Replacing the same viewer leaks its old window");
  assert(viewer.clips.length === 1 && !viewer.playButton.hidden, "glTF animation not available");
  viewer.animate("play", "Bounce", 2);
  await pause();
  assert(viewer.animation.time > 0, "Animation is not advancing");
  viewer.animate("pause");
  const paused = viewer.animation.time;
  await pause();
  assert(viewer.animation.time === paused, "Paused animation changed");
  viewer.animate("play", "0");
  viewer.animate("stop");
  assert(viewer.animation === null, "Stop failed");
  checks.push("Real glTF decoding, animation selection/play/pause/stop, replacement cleanup");
  const glbViewer = await openModelViewer({ viewerId: "glb", src: "fixture.glb" });
  await pause();
  assert(glbViewer.renderer.info.render.triangles > 0, "GLB geometry was not rendered");
  await glbViewer.app.close();
  assert(glbViewer.disposed && !getModelViewer("glb"), "Native close did not dispose");
  await closeModelViewer("qa");
  assert(!getModelViewer("qa"), "Closed viewer still registered");
  checks.push("Real GLB decoding and native window close cleanup");
  let failed = false;
  try { await openModelViewer({ viewerId: "bad", src: "invalid.glb" }); } catch { failed = true; }
  assert(failed && !getModelViewer("bad"), "Invalid model did not fail cleanly");
  const pending = openModelViewer({ viewerId: "slow", src: "slow.gltf" }).then(() => false, () => true);
  await pause();
  await closeModelViewer("slow");
  assert(await pending, "Closing during a request did not reject opening");
  await new Promise(resolve => setTimeout(resolve, 450));
  assert(!getModelViewer("slow") && !document.querySelector(".application"), "Late load resurrected closed viewer");
  checks.push("Malformed files, cancellation during loading and late response cleanup");
  for (const primitive of ["sphere", "cylinder", "torus"]) {
    const p = await openModelViewer({ viewerId: "shape", primitive });
    await pause();
    assert(p.renderer.info.render.triangles > 0, `${primitive} did not render`);
    await closeModelViewer("shape");
  }
  checks.push("All four built-in primitives render and close");
  globalThis.sd3dTestViewer = await openModelViewer({ viewerId: "preview", primitive: "torus", title: "3D Viewer · System Director" });
  document.getElementById("result").textContent = JSON.stringify({ status: "PASS", checks }, null, 2);
  document.title = "PASS";
} catch (error) {
  document.getElementById("result").textContent = JSON.stringify({ status: "FAIL", checks, error: error.stack }, null, 2);
  document.title = "FAIL";
} finally { globalThis.fetch = originalFetch; }
