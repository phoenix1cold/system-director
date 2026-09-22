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
- From 128 nodes, full controls are mounted only around the viewport. A capped
  retention halo and a 256-node detached LRU prevent zoom-boundary churn. Focused
  controls and active connection sources stay mounted. Stacking order is stable.
- Offscreen sockets retain measured coordinates. Crossing wires still measure
  their endpoints, including when both nodes are offscreen. Estimated bounds
  are used only for broad-phase visibility, never to draw socket positions.
- Value compilation uses an explicit traversal stack and per-call memoization
  for acyclic shared subgraphs. Linear exec chains use a loop. Both handle
  10,000-node chains without recursive call-stack overflow.
- The variables/widgets panel keeps its DOM and handlers when its displayed
  contents are unchanged; renames, schema changes and context changes invalidate
  the panel cache.

## Research and choice

[React Flow's viewport rendering option](https://reactflow.dev/api-reference/react-flow)
documents rendering visible nodes/edges rather than the entire graph, with an
overhead tradeoff. This editor uses its existing DOM/SVG renderer and activates
virtualization above a small-graph threshold, rather than changing frameworks.

[web.dev's layout guidance](https://web.dev/articles/avoid-large-complex-layouts-and-layout-thrashing)
explains the interaction cost of large DOMs and interleaved reads/writes. The
implementation reduces live DOM size and batches geometry reads before writes.

[MDN's content-visibility reference](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/content-visibility)
describes skipping rendering while retaining offscreen content in the DOM.
That alone would still construct thousands of editor controls and listeners, so
viewport mounting is the primary optimization here. No rasterized nodes, reduced
resolution, straightened wires or hidden editable fields are used.

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

## 10,000-node stress test

Run `node scripts/run-graph-render-browser.mjs tests/graph-stress-after.json --stress`.
The baseline for this second optimization pass is `tests/graph-stress-before.json`.
Unlike the synchronous microbenchmark, this test uses requestAnimationFrame
between pan, zoom and drag steps. Its frame intervals are browser-test intervals,
not a guarantee of Foundry FPS. The fixture uses 10,000 Number nodes and 9,999
wires, arranged in 100 columns, starting at zoom 0.65.

The recorded baseline mounted 10,000 nodes / 330,000 DOM elements and took
7,938.8 ms to open. The final recorded run mounted 24 nodes / 792 DOM elements
in the initial view and opened in 64 ms. Median frame intervals were 16.7 ms
for pan, zoom and drag (baseline zoom: 66.7 ms; drag: 33.3 ms).
The suite also verifies minimum zoom, long crossing wires, focus retention,
offscreen edits, dynamic pins, 10k undo/redo, bounded caches, variable-panel
invalidation, 10k value/exec compilation, and equivalence to reference compilation
on shared subgraphs and cycles. `tests/graph-10000-preview.png` captures a viewport
at minimum supported zoom within the 10k graph, not all 10k nodes simultaneously.

There is still a cold-zoom cost when a jump exposes many previously unbuilt
controls: the recorded first zoom step took 82.9 ms. Very dense visible graphs
with many crossing wires can also cost more than this fixture. The changes have
not been profiled inside a running Foundry world with its modules and document
data; they do not establish that every 10k-node graph on every PC is lag-free.

## Grid persistence regression

The properties popup now passes its draft layout to Widget Builder and receives
all saved designer settings back, including its inline element draft. Saving the
still-open popup no longer restores its stale Free selection. Zero snap/gap values
also remain visible as zero after reopening. UI Blueprint toolbar changes share
the serialized document-update queue with element edits.

`node scripts/run-card-hand-browser.mjs` verifies both paths along with the
existing designer, widget styling and interaction regressions.
