/**
 * 3D skill tree: nodes are glowing orbs arranged on concentric spheres around
 * the root skill, connections are volumetric beams, acquired nodes emit soft
 * ember particles. Rendering only — progression rules stay in ProgressionApp.
 */

let dependencies;
function loadDependencies() {
  return dependencies ??= Promise.all([
    import("../../vendor/three/build/three.module.min.js"),
    import("../../vendor/three/examples/jsm/controls/OrbitControls.js")
  ]).catch(error => { dependencies = null; throw error; });
}

const SHELL_RADIUS = 2.6;
const NODE_RADIUS  = 0.5;
const UP_AXIS = [0, 1, 0];

function cssColor(el, name, fallback) {
  const raw = globalThis.getComputedStyle?.(el)?.getPropertyValue(name)?.trim();
  return raw || fallback;
}

function routeURL(src) {
  const raw = String(src ?? "").trim();
  if (!raw) return "";
  return /^(?:[a-z]+:|\/)/i.test(raw) ? raw : (globalThis.foundry?.utils?.getRoute?.(raw) ?? raw);
}

/**
 * Sphere layout. BFS depth from the root(s) picks the shell; children fan out
 * in a cone around their parent's direction so branches visibly radiate.
 * Returns Map<nodeId, {x,y,z,depth,dir}>.
 */
export function layoutSkillTreeSphere(nodes, connections, radius = SHELL_RADIUS) {
  const ids = new Set(nodes.map(n => n.id));
  const out = new Map(), inc = new Map();
  for (const id of ids) { out.set(id, []); inc.set(id, []); }
  for (const c of connections) {
    if (!ids.has(c.from) || !ids.has(c.to) || c.from === c.to) continue;
    out.get(c.from).push(c.to);
    inc.get(c.to).push(c.from);
  }
  const order = (a, b) => ((a?.row ?? 0) - (b?.row ?? 0)) || ((a?.col ?? 0) - (b?.col ?? 0));
  const byId = new Map(nodes.map(n => [n.id, n]));
  const sorted = [...nodes].sort(order);
  for (const list of out.values()) list.sort((a, b) => order(byId.get(a), byId.get(b)));

  let roots = sorted.filter(n => inc.get(n.id).length === 0).map(n => n.id);
  if (!roots.length && sorted.length) {
    roots = [sorted.reduce((best, n) => out.get(n.id).length > out.get(best.id).length ? n : best, sorted[0]).id];
  }

  const placed = new Map();
  const norm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const basis = dir => {
    const helper = Math.abs(dir[1]) > 0.9 ? [1, 0, 0] : UP_AXIS;
    const u = norm(cross(dir, helper));
    return [u, cross(dir, u)];
  };
  const fibonacci = (k, i) => {
    if (k === 1) return [0, 1, 0];
    const y = 1 - (2 * (i + 0.5)) / k;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const phi = i * Math.PI * (3 - Math.sqrt(5));
    return [Math.cos(phi) * r, y, Math.sin(phi) * r];
  };
  const coneDirs = (dir, k, depth) => {
    if (k === 1) return [dir];
    const [u, v] = basis(dir);
    // Narrower cones deeper in the tree keep sibling branches from crossing.
    const tilt = Math.min(1.1, 0.95 / Math.sqrt(depth));
    const offset = depth * 0.7;
    const s = Math.sin(tilt), c = Math.cos(tilt);
    return Array.from({ length: k }, (_, i) => {
      const a = offset + (2 * Math.PI * i) / k;
      const ca = Math.cos(a), sa = Math.sin(a);
      return norm([c * dir[0] + s * (ca * u[0] + sa * v[0]),
                   c * dir[1] + s * (ca * u[1] + sa * v[1]),
                   c * dir[2] + s * (ca * u[2] + sa * v[2])]);
    });
  };

  const queue = [];
  const place = (id, dir, depth) => {
    placed.set(id, { x: dir[0] * radius * depth, y: dir[1] * radius * depth, z: dir[2] * radius * depth, depth, dir });
    queue.push(id);
  };
  if (roots.length === 1) place(roots[0], [0, 1, 0], 0);
  else roots.forEach((id, i) => place(id, fibonacci(roots.length, i), 1));

  while (queue.length) {
    const id = queue.shift();
    const parent = placed.get(id);
    const children = out.get(id).filter(c => !placed.has(c));
    if (!children.length) continue;
    const dirs = parent.depth === 0
      ? children.map((_, i) => fibonacci(children.length, i))
      : coneDirs(parent.dir, children.length, parent.depth);
    children.forEach((c, i) => place(c, dirs[i], parent.depth + 1));
  }

  // Orphans (unreachable from any root) sit on the outermost shell.
  const orphans = sorted.filter(n => !placed.has(n.id));
  if (orphans.length) {
    const depth = Math.max(1, ...[...placed.values()].map(p => p.depth)) + 1;
    orphans.forEach((n, i) => place(n.id, fibonacci(orphans.length, i), depth));
  }
  return placed;
}

export class SkillTree3D {
  /**
   * @param {HTMLElement} container
   * @param {object} callbacks { onSelect(id, event), onHover(id|null), onContext(id, event) }
   */
  constructor(container, callbacks = {}) {
    this.container = container;
    this.callbacks = callbacks;
    this.disposed = false;
    this.nodeObjects = new Map();
    this.beams = [];
    this.hoverId = null;
    this.textures = new Map();
    this.pending = null;
    this.flash = new Map();
    this.prevStatus = new Map();
  }

  async mount() {
    const [THREE, { OrbitControls }] = await loadDependencies();
    if (this.disposed) return;
    this.THREE = THREE;
    const c = this.container;
    this.palette = {
      accent:  cssColor(c, "--sd-accent", "#7b68ee"),
      accent2: cssColor(c, "--sd-accent-2", "#5a4ec0"),
      text:    cssColor(c, "--sd-text", "#e0e0ee"),
      text3:   cssColor(c, "--sd-text-3", "#666688"),
      border:  cssColor(c, "--sd-border", "#3a3a52"),
      danger:  cssColor(c, "--sd-hp", "#e05a5a"),
      warn:    cssColor(c, "--sd-warn", "#ffb347")
    };
    this.font = cssColor(c, "--sd-font", "Signika, sans-serif");

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.05, 400);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.domElement.className = "sd-st3d-canvas";
    this.renderer.domElement.setAttribute("aria-label", "Skill tree 3D");
    c.append(this.renderer.domElement);
    this.renderer.domElement.addEventListener("webglcontextlost", ev => { ev.preventDefault(); this.renderer?.setAnimationLoop(null); });

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.45;
    this.controls.minDistance = 2;
    this.controls.maxDistance = 120;
    this.controls.addEventListener("start", () => { this.controls.autoRotate = false; });

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x2a2a44, 1.4));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(4, 7, 5);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(new THREE.Color(this.palette.accent), 1.1);
    rim.position.set(-6, -3, -5);
    this.scene.add(rim);

    this.world = new THREE.Group();
    this.scene.add(this.world);
    this.world.add(this._makeDust());

    this.haloTexture = this._radialTexture();
    this.sharedGeometry = {
      sphere: new THREE.SphereGeometry(NODE_RADIUS, 40, 28),
      ring:   new THREE.TorusGeometry(NODE_RADIUS * 1.28, 0.028, 10, 72),
      beam:   new THREE.CylinderGeometry(1, 1, 1, 10, 1, true),
      tip:    new THREE.ConeGeometry(0.11, 0.26, 12)
    };

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this._tmpVec = new THREE.Vector3();
    this._tmpScale = new THREE.Vector3();
    this._bindPointer();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(c);
    this.resize();
    this.clock = new THREE.Clock();
    this.renderer.setAnimationLoop(() => this._frame());

    if (this.pending) { const data = this.pending; this.pending = null; this.update(data); }
  }

  /** Replace the visible tree. Camera and hover state are preserved. */
  update(data) {
    if (this.disposed) return;
    if (!this.THREE) { this.pending = data; return; }
    const { nodes = [], connections = [], connecting = null } = data;
    this.data = data;
    this._clearTree();

    const layout = layoutSkillTreeSphere(nodes, connections);
    let maxDepth = 0;
    const now = this.clock?.getElapsedTime() ?? 0;
    for (const node of nodes) {
      const p = layout.get(node.id);
      maxDepth = Math.max(maxDepth, p.depth);
      const group = this._makeNode(node, node.id === connecting);
      group.position.set(p.x, p.y, p.z);
      this.world.add(group);
      this.nodeObjects.set(node.id, group);
      const prev = this.prevStatus.get(node.id);
      if (prev && prev !== "acquired" && node.status === "acquired") this.flash.set(node.id, now);
      this.prevStatus.set(node.id, node.status);
    }
    for (const conn of connections) {
      const a = layout.get(conn.from), b = layout.get(conn.to);
      if (!a || !b) continue;
      this.beams.push(this._makeBeam(a, b, conn));
    }
    this.particles = this._makeParticles(nodes, layout);
    if (this.particles) this.world.add(this.particles);

    if (!this.framed) {
      const dist = Math.max(7, (maxDepth + 1.1) * SHELL_RADIUS * 1.35);
      this.camera.position.set(dist * 0.55, dist * 0.35, dist * 0.75);
      this.controls.target.set(0, 0, 0);
      this.controls.update();
      this.framed = true;
    }
  }

  resetView() {
    this.framed = false;
    if (this.controls) this.controls.autoRotate = true;
    if (this.data) this.update(this.data);
  }

  /** Move the live canvas into a freshly rendered container (keeps camera, textures and animations). */
  attach(container) {
    if (this.disposed || container === this.container) return;
    this.container = container;
    if (!this.renderer) return;
    this.resizeObserver?.disconnect();
    container.prepend(this.renderer.domElement);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  resize() {
    if (!this.renderer) return;
    const w = Math.max(1, this.container.clientWidth), h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this.disposed = true;
    this.resizeObserver?.disconnect();
    this.renderer?.setAnimationLoop(null);
    this._unbindPointer?.();
    this.controls?.dispose();
    if (this.world) this._clearTree();
    for (const t of this.textures.values()) t.dispose();
    this.textures.clear();
    this.haloTexture?.dispose();
    for (const g of Object.values(this.sharedGeometry ?? {})) g.dispose();
    this.dust?.geometry.dispose(); this.dust?.material.dispose();
    this.renderer?.dispose();
    this.renderer?.domElement.remove();
    this.renderer = null;
  }

  /* ------------------------------------------------------------------ */

  _clearTree() {
    for (const group of this.nodeObjects.values()) {
      this.world.remove(group);
      // Textures are cached in this.textures; geometries are shared. Only per-node materials go here.
      group.traverse(o => o.material?.dispose?.());
    }
    this.nodeObjects.clear();
    for (const beam of this.beams) { this.world.remove(beam); beam.children[0]?.material.dispose(); }
    this.beams = [];
    if (this.particles) {
      this.world.remove(this.particles);
      this.particles.geometry.dispose(); this.particles.material.dispose();
      this.particles = null;
    }
  }

  _ownColor(node) { return /^#[0-9a-f]{3,8}$/i.test(node.color ?? "") ? node.color : null; }

  _nodeColors(node) {
    const THREE = this.THREE;
    const own = this._ownColor(node);
    if (node.status === "acquired") {
      const glow = new THREE.Color(own ?? this.palette.accent);
      return { base: glow.clone().multiplyScalar(0.55), emissive: glow, intensity: 1.15, halo: glow, haloScale: 2.9, haloOpacity: 0.85 };
    }
    if (node.status === "available") {
      const glow = new THREE.Color(own ?? this.palette.accent);
      return { base: new THREE.Color("#2b2b3f").lerp(glow, 0.25), emissive: glow, intensity: 0.28, halo: glow, haloScale: 1.9, haloOpacity: 0.32 };
    }
    return { base: new THREE.Color("#2a2a36"), emissive: new THREE.Color(this.palette.border), intensity: 0.05, halo: null };
  }

  _makeNode(node, connecting) {
    const THREE = this.THREE;
    const group = new THREE.Group();
    group.userData.nodeId = node.id;
    const colors = this._nodeColors(node);
    const locked = node.status === "locked";

    const sphere = new THREE.Mesh(this.sharedGeometry.sphere, new THREE.MeshPhysicalMaterial({
      color: colors.base, emissive: colors.emissive, emissiveIntensity: colors.intensity,
      roughness: 0.32, metalness: 0.2, clearcoat: 0.7, clearcoatRoughness: 0.25,
      transparent: locked, opacity: locked ? 0.82 : 1
    }));
    sphere.userData.nodeId = node.id;
    group.add(sphere);
    Object.assign(group.userData, { sphere, baseIntensity: colors.intensity, status: node.status });

    if (colors.halo) {
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.haloTexture, color: colors.halo, transparent: true, opacity: colors.haloOpacity, blending: THREE.AdditiveBlending, depthWrite: false }));
      halo.scale.setScalar(colors.haloScale);
      halo.userData.baseScale = colors.haloScale;
      halo.userData.baseOpacity = colors.haloOpacity;
      group.add(halo);
      group.userData.halo = halo;
    }

    if (connecting || node.status === "available") {
      const ring = new THREE.Mesh(this.sharedGeometry.ring, new THREE.MeshBasicMaterial({ color: connecting ? this.palette.warn : this.palette.accent, transparent: true, opacity: connecting ? 0.95 : 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
      group.add(ring);
      group.userData.ring = ring;
    }

    // Icon is pushed toward the camera each frame so the orb never hides it.
    const icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: this._iconTexture(node), transparent: true, depthWrite: false, opacity: locked ? 0.55 : 1 }));
    icon.scale.setScalar(NODE_RADIUS * 1.25);
    group.add(icon);
    group.userData.icon = icon;

    const labelMap = this._labelTexture(node);
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelMap, transparent: true, depthWrite: false, opacity: locked ? 0.7 : 1 }));
    const labelHeight = 0.42 * labelMap.userData.lines;
    label.scale.set(labelHeight * labelMap.userData.aspect, labelHeight, 1);
    label.position.set(0, -(NODE_RADIUS + 0.16), 0);
    label.center.set(0.5, 1);
    group.add(label);
    return group;
  }

  _makeBeam(a, b, conn) {
    const THREE = this.THREE;
    const from = new THREE.Vector3(a.x, a.y, a.z), to = new THREE.Vector3(b.x, b.y, b.z);
    const dir = to.clone().sub(from).normalize();
    const start = from.clone().addScaledVector(dir, NODE_RADIUS + 0.05);
    const end = to.clone().addScaledVector(dir, -(NODE_RADIUS + 0.28));
    const bodyLen = Math.max(0.05, end.distanceTo(start));
    const color = conn.active ? this.palette.accent : conn.reachable ? this.palette.accent2 : this.palette.border;
    const radius = conn.active ? 0.05 : conn.reachable ? 0.038 : 0.028;
    const group = new THREE.Group();
    const beamColor = new THREE.Color(color);
    if (conn.active) beamColor.lerp(new THREE.Color("#ffffff"), 0.3);
    const material = new THREE.MeshBasicMaterial({ color: beamColor, transparent: true, opacity: conn.active ? 0.95 : conn.reachable ? 0.7 : 0.35, side: THREE.DoubleSide });
    const body = new THREE.Mesh(this.sharedGeometry.beam, material);
    body.scale.set(radius, bodyLen, radius);
    body.position.copy(start).addScaledVector(dir, bodyLen / 2);
    body.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    group.add(body);
    const tip = new THREE.Mesh(this.sharedGeometry.tip, material);
    tip.position.copy(end).addScaledVector(dir, 0.13);
    tip.quaternion.copy(body.quaternion);
    group.add(tip);
    group.userData = { active: conn.active, from: conn.from, to: conn.to };
    this.world.add(group);
    return group;
  }

  _makeParticles(nodes, layout) {
    const THREE = this.THREE;
    const emitters = nodes.filter(n => n.status !== "locked");
    if (!emitters.length) return null;
    const origins = [], dirs = [], phase = [], speed = [], color = [], size = [];
    for (const node of emitters) {
      const p = layout.get(node.id);
      const acquired = node.status === "acquired";
      const count = acquired ? 42 : 10;
      const c = new THREE.Color(this._ownColor(node) ?? this.palette.accent).lerp(new THREE.Color("#fff2d0"), acquired ? 0.35 : 0.1);
      for (let i = 0; i < count; i++) {
        const u = Math.random() * 2 - 1, t = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
        origins.push(p.x, p.y, p.z);
        dirs.push(r * Math.cos(t), u * 0.6 + 0.55, r * Math.sin(t));
        phase.push(Math.random());
        speed.push(acquired ? 0.12 + Math.random() * 0.16 : 0.07 + Math.random() * 0.06);
        color.push(c.r, c.g, c.b);
        size.push(acquired ? 7 + Math.random() * 9 : 4 + Math.random() * 4);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(origins, 3));
    geometry.setAttribute("aDir", new THREE.Float32BufferAttribute(dirs, 3));
    geometry.setAttribute("aPhase", new THREE.Float32BufferAttribute(phase, 1));
    geometry.setAttribute("aSpeed", new THREE.Float32BufferAttribute(speed, 1));
    geometry.setAttribute("aColor", new THREE.Float32BufferAttribute(color, 3));
    geometry.setAttribute("aSize", new THREE.Float32BufferAttribute(size, 1));
    const material = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uPixelRatio: { value: this.renderer.getPixelRatio() } },
      vertexShader: `
        attribute vec3 aDir; attribute float aPhase; attribute float aSpeed; attribute vec3 aColor; attribute float aSize;
        uniform float uTime; uniform float uPixelRatio;
        varying float vAlpha; varying vec3 vColor;
        void main() {
          float t = fract(uTime * aSpeed + aPhase);
          float wobble = sin(uTime * 2.3 + aPhase * 40.0) * 0.08 * t;
          vec3 p = position + normalize(aDir) * (${NODE_RADIUS.toFixed(2)} + t * 1.05) + vec3(wobble, t * t * 0.35, -wobble);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = aSize * uPixelRatio * (1.0 - t * 0.7) * (9.0 / max(1.0, -mv.z));
          vAlpha = smoothstep(0.0, 0.12, t) * (1.0 - smoothstep(0.55, 1.0, t));
          vColor = aColor;
        }`,
      fragmentShader: `
        varying float vAlpha; varying vec3 vColor;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.05, d) * vAlpha;
          gl_FragColor = vec4(vColor * (1.0 + (1.0 - d) * 0.6), a);
        }`
    });
    return new THREE.Points(geometry, material);
  }

  _makeDust() {
    const THREE = this.THREE;
    const pos = [];
    for (let i = 0; i < 260; i++) {
      const r = 9 + Math.random() * 26, u = Math.random() * 2 - 1, t = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      pos.push(r * s * Math.cos(t), r * u, r * s * Math.sin(t));
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    this.dust = new THREE.Points(geometry, new THREE.PointsMaterial({ color: this.palette.accent, size: 0.06, transparent: true, opacity: 0.35, depthWrite: false, sizeAttenuation: true }));
    return this.dust;
  }

  _radialTexture() {
    const size = 128, canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.25, "rgba(255,255,255,.55)");
    g.addColorStop(0.6, "rgba(255,255,255,.12)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const texture = new this.THREE.CanvasTexture(canvas);
    texture.colorSpace = this.THREE.SRGBColorSpace;
    return texture;
  }

  _iconTexture(node) {
    const THREE = this.THREE;
    const key = `icon:${node.img || "*"}`;
    if (this.textures.has(key)) return this.textures.get(key);
    const size = 128, canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");
    // Dark disc behind the glyph keeps icons readable on brightly glowing orbs.
    const backdrop = () => { ctx.fillStyle = "rgba(10,10,20,.45)"; ctx.beginPath(); ctx.arc(size / 2, size / 2, size * 0.44, 0, Math.PI * 2); ctx.fill(); };
    backdrop();
    ctx.fillStyle = "rgba(255,255,255,.95)";
    ctx.shadowColor = "rgba(0,0,0,.8)"; ctx.shadowBlur = 6;
    ctx.font = `${size * 0.6}px ${this.font}`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("★", size / 2, size / 2 + 4);
    ctx.shadowBlur = 0;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    this.textures.set(key, texture);
    const url = routeURL(node.img);
    if (url) {
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.onload = () => {
        if (this.disposed) return;
        ctx.clearRect(0, 0, size, size);
        backdrop();
        ctx.save();
        ctx.beginPath(); ctx.arc(size / 2, size / 2, size * 0.42, 0, Math.PI * 2); ctx.clip();
        ctx.drawImage(image, size * 0.08, size * 0.08, size * 0.84, size * 0.84);
        ctx.restore();
        ctx.lineWidth = 3; ctx.strokeStyle = "rgba(255,255,255,.55)";
        ctx.beginPath(); ctx.arc(size / 2, size / 2, size * 0.42, 0, Math.PI * 2); ctx.stroke();
        texture.needsUpdate = true;
      };
      image.src = url;
    }
    return texture;
  }

  _labelTexture(node) {
    const THREE = this.THREE;
    const lines = [];
    const title = String(node.label ?? "").trim();
    if (title) lines.push({ text: title.length > 26 ? `${title.slice(0, 25)}…` : title, size: 26, color: this.palette.text, weight: 600 });
    const meta = [];
    if (node.cost > 0) meta.push(`★ ${node.cost}`);
    if (node.maxAcquire > 1) meta.push(`${node.count}/${node.maxAcquire}`);
    if (meta.length) lines.push({ text: meta.join("   "), size: 22, color: node.canAfford === false && node.status !== "acquired" ? this.palette.danger : this.palette.accent, weight: 700 });
    const key = `label:${lines.map(l => `${l.text}|${l.color}`).join("\n")}`;
    if (this.textures.has(key)) return this.textures.get(key);
    const pad = 12, lineGap = 6, width = 360;
    const height = lines.length ? lines.reduce((h, l) => h + l.size + lineGap, pad * 2) : 8;
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    let y = pad;
    for (const l of lines) {
      ctx.font = `${l.weight} ${l.size}px ${this.font}`;
      ctx.shadowColor = "rgba(0,0,0,.85)"; ctx.shadowBlur = 8;
      ctx.fillStyle = l.color;
      ctx.fillText(l.text, width / 2, y, width - pad * 2);
      y += l.size + lineGap;
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.userData.aspect = width / height;
    texture.userData.lines = Math.max(1, lines.length);
    this.textures.set(key, texture);
    return texture;
  }

  /* ------------------------------------------------------------------ */

  _bindPointer() {
    const el = this.renderer.domElement;
    let down = null;
    const onMove = ev => {
      const rect = el.getBoundingClientRect();
      this.pointer.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
      const id = this._pick();
      if (id !== this.hoverId) {
        this.hoverId = id;
        el.style.cursor = id ? "pointer" : "";
        this.callbacks.onHover?.(id);
      }
    };
    const onDown = ev => { down = { x: ev.clientX, y: ev.clientY, button: ev.button }; };
    const onUp = ev => {
      if (!down) return;
      const moved = Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > 5;
      const button = down.button; down = null;
      if (moved || button !== 0) return;
      onMove(ev);
      if (this.hoverId) this.callbacks.onSelect?.(this.hoverId, ev);
    };
    const onLeave = () => { if (this.hoverId) { this.hoverId = null; el.style.cursor = ""; this.callbacks.onHover?.(null); } };
    const onContext = ev => { onMove(ev); if (this.hoverId) { ev.preventDefault(); ev.stopPropagation(); this.callbacks.onContext?.(this.hoverId, ev); } };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointerleave", onLeave);
    el.addEventListener("contextmenu", onContext);
    this._unbindPointer = () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointerleave", onLeave);
      el.removeEventListener("contextmenu", onContext);
    };
  }

  _pick() {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const spheres = [];
    for (const g of this.nodeObjects.values()) spheres.push(g.userData.sphere);
    const hit = this.raycaster.intersectObjects(spheres, false)[0];
    return hit?.object.userData.nodeId ?? null;
  }

  _frame() {
    if (this.disposed || !this.renderer) return;
    const t = this.clock.getElapsedTime();
    const camDir = this._tmpVec;
    for (const [id, group] of this.nodeObjects) {
      const { sphere, halo, ring, icon, baseIntensity, status } = group.userData;
      const hovered = id === this.hoverId;
      const pulse = status === "acquired" ? 0.5 + 0.5 * Math.sin(t * 1.7 + group.position.x)
                  : status === "available" ? 0.5 + 0.5 * Math.sin(t * 2.6 + group.position.y) : 0;
      let boost = 0;
      const flashAt = this.flash.get(id);
      if (flashAt !== undefined) {
        const age = t - flashAt;
        if (age > 1.6) this.flash.delete(id);
        else boost = Math.sin(Math.min(1, age / 1.6) * Math.PI) * 2.2;
      }
      sphere.material.emissiveIntensity = baseIntensity * (0.8 + pulse * 0.45) + boost + (hovered ? 0.35 : 0);
      const targetScale = (hovered ? 1.14 : 1) + boost * 0.09;
      sphere.scale.lerp(this._tmpScale.setScalar(targetScale), 0.18);
      if (halo) {
        halo.scale.setScalar(halo.userData.baseScale * (0.92 + pulse * 0.16 + boost * 0.35));
        halo.material.opacity = Math.min(1, halo.userData.baseOpacity * (0.85 + pulse * 0.3) + boost * 0.25);
      }
      if (ring) { ring.quaternion.copy(this.camera.quaternion); ring.material.opacity = 0.35 + pulse * 0.5; }
      camDir.copy(this.camera.position).sub(group.position).normalize();
      icon.position.copy(camDir).multiplyScalar(NODE_RADIUS * sphere.scale.x + 0.02);
    }
    if (this.particles) this.particles.material.uniforms.uTime.value = t;
    if (this.dust) this.dust.rotation.y = t * 0.01;
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
