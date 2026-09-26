// Real WebGL/Three.js rendering of the 3D skill tree; ProgressionApp is not involved.
import { SkillTree3D } from "../module/helpers/skilltree-3d.mjs";

const assert = (value, message) => { if (!value) throw new Error(message); };
const checks = [];
const events = globalThis.sdTreeEvents = [];
const icon = (hue) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="hsl(${hue} 70% 45%)"/><path d="M32 10l6 14 15 2-11 10 3 15-13-7-13 7 3-15L11 26l15-2z" fill="#fff"/></svg>`)}`;

const nodes = [
  { id: "root", col: 4, row: 2, label: "Awakening", img: icon(40), cost: 0, count: 1, maxAcquire: 1, status: "acquired", canAfford: true, canAcquire: false },
  { id: "fire", col: 2, row: 1, label: "Ember Touch", img: icon(10), cost: 1, count: 1, maxAcquire: 1, status: "acquired", canAfford: true, canAcquire: false, color: "#ff7a3d" },
  { id: "frost", col: 6, row: 1, label: "Frost Bite", img: icon(200), cost: 1, count: 0, maxAcquire: 1, status: "available", canAfford: true, canAcquire: true, color: "#5ec8ff" },
  { id: "storm", col: 4, row: 4, label: "Storm Call", img: icon(260), cost: 2, count: 0, maxAcquire: 1, status: "available", canAfford: false, canAcquire: false },
  { id: "inferno", col: 1, row: 0, label: "Inferno", img: icon(15), cost: 2, count: 0, maxAcquire: 3, status: "available", canAfford: true, canAcquire: true, color: "#ff7a3d" },
  { id: "cinder", col: 2, row: 0, label: "Cinder Shield", img: "", cost: 1, count: 0, maxAcquire: 1, status: "available", canAfford: true, canAcquire: true },
  { id: "glacier", col: 7, row: 0, label: "Glacier", img: icon(210), cost: 3, count: 0, maxAcquire: 1, status: "locked", canAfford: true, canAcquire: false },
  { id: "blizzard", col: 7, row: 2, label: "Blizzard", img: icon(190), cost: 3, count: 0, maxAcquire: 1, status: "locked", canAfford: true, canAcquire: false },
  { id: "thunder", col: 3, row: 5, label: "Thunder", img: icon(270), cost: 2, count: 0, maxAcquire: 1, status: "locked", canAfford: true, canAcquire: false },
  { id: "tempest", col: 5, row: 5, label: "Tempest", img: icon(280), cost: 4, count: 0, maxAcquire: 1, status: "locked", canAfford: true, canAcquire: false },
  { id: "phoenix", col: 0, row: 0, label: "Phoenix Heart", img: icon(30), cost: 5, count: 0, maxAcquire: 1, status: "locked", canAfford: true, canAcquire: false, color: "#ffb347" }
];
const edges = [["root","fire"],["root","frost"],["root","storm"],["fire","inferno"],["fire","cinder"],["frost","glacier"],["frost","blizzard"],["storm","thunder"],["storm","tempest"],["inferno","phoenix"]];
const acquired = new Set(nodes.filter(n => n.status === "acquired").map(n => n.id));
const data = () => ({
  nodes: nodes.map(n => ({ ...n })),
  connections: edges.map(([from, to]) => ({ from, to, active: acquired.has(from) && acquired.has(to), reachable: acquired.has(from) })),
  connecting: null
});

const host = document.getElementById("host");
const viewer = globalThis.sdTree = new SkillTree3D(host, {
  onHover: id => events.push({ event: "hover", id }),
  onSelect: id => events.push({ event: "select", id }),
  onContext: id => events.push({ event: "context", id })
});
document.getElementById("reset").addEventListener("click", () => viewer.resetView());

/** Test helper: acquire a node the way ProgressionApp would (state change + update()). */
globalThis.sdTreeAcquire = id => {
  const node = nodes.find(n => n.id === id);
  node.status = "acquired"; node.count = node.maxAcquire; node.canAcquire = false;
  acquired.add(id);
  for (const [from, to] of edges) if (from === id) { const child = nodes.find(n => n.id === to); if (child.status === "locked") { child.status = "available"; child.canAcquire = child.canAfford; } }
  viewer.update(data());
};
/** Test helper: project a node's centre to CSS pixels inside the canvas. */
globalThis.sdTreeScreenPoint = id => {
  const group = viewer.nodeObjects.get(id);
  const v = group.position.clone().project(viewer.camera);
  const rect = viewer.renderer.domElement.getBoundingClientRect();
  return { x: rect.left + (v.x + 1) / 2 * rect.width, y: rect.top + (1 - v.y) / 2 * rect.height };
};

try {
  viewer.update(data());
  await viewer.mount();
  assert(viewer.renderer && viewer.nodeObjects.size === nodes.length, "all nodes are built");
  assert(viewer.beams.length === edges.length, "all connections are built");
  assert(viewer.particles && viewer.particles.geometry.getAttribute("position").count === 2 * 42 + 4 * 10, "acquired nodes emit 42 particles, available 10, locked none");
  assert(viewer.nodeObjects.get("root").position.length() < 1e-6, "root skill is the centre of the sphere");
  assert(viewer.nodeObjects.get("root").userData.halo && !viewer.nodeObjects.get("glacier").userData.halo, "only lit nodes get a halo");
  assert(viewer.nodeObjects.get("frost").userData.ring, "available nodes get an accent ring");
  checks.push("Sphere layout, orbs, beams, halos and particle emitters");

  await new Promise(r => setTimeout(r, 300));
  const gl = viewer.renderer.getContext();
  const px = new Uint8Array(4);
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  viewer.renderer.render(viewer.scene, viewer.camera);
  gl.readPixels(Math.floor(w / 2), Math.floor(h / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  assert(px[3] > 0, "the centre orb is drawn over the transparent background");
  checks.push("WebGL frame renders the centre orb");

  viewer.controls.autoRotate = false;
  document.title = "PASS";
  document.getElementById("result").textContent = checks.map(c => `✔ ${c}`).join("\n");
} catch (error) {
  console.error(error);
  document.title = "FAIL";
  document.getElementById("result").textContent = `${checks.map(c => `✔ ${c}`).join("\n")}\n✘ ${error.message}`;
}
