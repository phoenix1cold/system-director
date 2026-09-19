# Three.js 0.180.0 (MIT)

Vendored from https://cdn.jsdelivr.net/npm/three@0.180.0/ (upstream https://github.com/mrdoob/three.js/tree/r180).
The license is included in `LICENSE`. Only the ES module build, OrbitControls,
GLTFLoader and its BufferGeometryUtils dependency are shipped.

The three addon imports of `from 'three'` are changed to
`from '../../../build/three.module.min.js'` so Foundry needs no import map or CDN.
The minified builds are unmodified. Loaded only when a 3D viewer is opened.
