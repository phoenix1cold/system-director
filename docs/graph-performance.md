# Node graph performance

The editor keeps full node controls, vector wires, wire hit targets and dynamic
pins. No resolution reduction or zoom-dependent simplified rendering is used.

Changes:

- Pan translates one SVG group; existing wire paths are unchanged. Zoom still
  calculates curves in screen pixels to preserve the minimum bend, stroke
  thickness, dash pattern and 14 px hit area.
- Endpoint caching recalculates only affected visible wires when moving nodes.
- Geometry is measured before pending position writes, avoiding an extra layout
  flush between the two operations.
- Text/number inputs update node data immediately, while preview compilation is
  coalesced after 140 ms of inactivity. Saving compiles current data immediately.
- Compilation indexes incoming connections for the duration of that call only,
  including separate indexes for nested function graphs. Last-edge precedence
  and cycle handling are preserved.
- Full node rendering synchronizes 3D point definitions once before the batch.
  Unchanged preview text no longer replaces DOM text nodes.

## Reproduce

Run `node scripts/run-graph-render-browser.mjs tests/graph-performance-after.json`.
Requires Playwright at `PLAYWRIGHT_MODULE`, or the temporary `sd-3d-qa` install.

The browser suite exercises real DOM/SVG in headless Chromium with Foundry
services stubbed. It checks wire curves across zoom levels, group drag, dynamic
pins, undo/redo, disconnect, culling, resize, detached documents, typing, large
chains, nested functions and disposal. It is not a full Foundry integration run.

The benchmark pans graphs of 200, 300 and 600 nodes over 60 synchronous steps.
Times include JavaScript and a forced layout read, **not full frame paint/GPU
time or end-user FPS**. Raw before/after measurements are in
`tests/graph-performance-before.json` and `tests/graph-performance-after.json`.
The 300-node baseline made 34,800 path geometry writes; the optimized run makes
zero. One rectangle read per benchmark step is the explicit layout probe, not
a node/pin measurement. Timings vary between runs and machines.
