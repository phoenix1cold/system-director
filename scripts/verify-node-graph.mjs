import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const failures = [];
const warnings = [];
const checks = [];

function installFoundryStubs() {
  globalThis.document ??= {
    getElementById: () => ({}),
    createElement: () => ({ textContent: "", appendChild() {} }),
    head: { appendChild() {} }
  };
  globalThis.window ??= { addEventListener() {} };
}

function fail(message) { failures.push(message); }
function warn(message) { warnings.push(message); }
function pass(message) { checks.push(message); }
function readJson(relative) {
  return JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
}
function pinId(pin) { return String(pin?.id ?? "").trim(); }

installFoundryStubs();
const [{ NODE_DEFS }, migrations, pinTypes, linter] = await Promise.all([
  import(pathToFileURL(path.join(root, "module/builder/formula-graph.mjs")).href),
  import(pathToFileURL(path.join(root, "module/builder/node-migration.mjs")).href),
  import(pathToFileURL(path.join(root, "module/builder/pin-types.mjs")).href),
  import(pathToFileURL(path.join(root, "module/builder/graph-linter.mjs")).href)
]);

const nodeIds = Object.keys(NODE_DEFS);
const nodeIdSet = new Set(nodeIds);
pass(`Loaded ${nodeIds.length} runtime node definitions.`);

for (const id of nodeIds) {
  const def = NODE_DEFS[id];
  if (!def || typeof def !== "object") {
    fail(`${id}: definition is not an object.`);
    continue;
  }
  if (!String(def.title ?? "").trim()) fail(`${id}: missing display title.`);

  const staticPins = [];
  for (const side of ["inputs", "outputs"]) {
    const pins = Array.isArray(def[side]) ? def[side] : [];
    const seen = new Set();
    for (const pin of pins) {
      const pid = pinId(pin);
      if (!pid) fail(`${id}: ${side} contains a pin without an id.`);
      else if (seen.has(pid)) fail(`${id}: duplicate ${side} pin id "${pid}".`);
      else seen.add(pid);
      if (pid) staticPins.push({ id: pid, side });
      const type = pin?.type == null ? "value.any" : String(pin.type);
      // Widget-config pins use the legacy generic "value" marker, which the
      // runtime normalizes to value.any. Reject it outside that context.
      const normalizedType = type === "value" && def.isWidgetConfig ? "value.any" : type;
      if (!pinTypes.PIN_SUBTYPE_COLORS || !(normalizedType in pinTypes.PIN_SUBTYPE_COLORS)) {
        fail(`${id}.${pid || "?"}: unknown pin type "${type}".`);
      }
    }
  }
  // Input/output IDs intentionally share a namespace only within each side:
  // exec-through and value-transform nodes commonly reuse IDs across sides.
  // Treat those as a supported contract rather than noisy warnings.

  if (def.hidden === true && def.replacement) {
    const replacement = String(def.replacement);
    const replacementNodes = Array.isArray(def.replacementNodes) ? def.replacementNodes : [];
    if (replacementNodes.length) {
      for (const replacementId of replacementNodes) {
        if (!nodeIdSet.has(replacementId)) fail(`${id}: composite replacement node "${replacementId}" does not exist.`);
      }
      continue;
    }
    // A replacement is machine-checkable only when it names a stable node ID.
    // Human migration guidance (for example, "specific On-* event nodes") is
    // intentionally allowed but reported as a warning.
    if (/^[A-Za-z0-9_]+$/.test(replacement)) {
      if (!nodeIdSet.has(replacement)) fail(`${id}: replacement "${replacement}" does not exist.`);
    } else {
      warn(`${id}: replacement is descriptive text, not a machine-checkable node ID: "${replacement}".`);
    }
  }
  if (def.isAction === true && typeof def.toAction !== "function" && !def.isFunctionCall && !def.compilerSpecial) {
    warn(`${id}: action definition has no toAction compiler; verify that it is compiler-special-cased.`);
  }
}
pass("Validated static titles, pins, pin types, and replacement targets.");

for (const [oldType, rule] of Object.entries(migrations.NODE_TYPE_MIGRATIONS ?? {})) {
  if (!rule?.newType || (!rule.externalTarget && !nodeIdSet.has(rule.newType))) {
    fail(`Migration ${oldType}: target "${rule?.newType ?? ""}" does not exist.`);
  }
}
pass(`Validated ${Object.keys(migrations.NODE_TYPE_MIGRATIONS ?? {}).length} node-type migration targets.`);

const documented = readJson("docs/data/nodes.json");
const docIds = Object.keys(documented);
const missingDocs = nodeIds.filter(id => !(id in documented));
const staleDocs = docIds.filter(id => !nodeIdSet.has(id));
if (missingDocs.length) fail(`Documentation misses runtime nodes: ${missingDocs.join(", ")}`);
if (staleDocs.length) fail(`Documentation contains stale nodes: ${staleDocs.join(", ")}`);
for (const id of nodeIds) {
  const doc = documented[id];
  if (!doc) continue;
  if (String(doc.title ?? "") !== String(NODE_DEFS[id].title ?? "")) {
    fail(`${id}: documentation title differs from runtime title.`);
  }
}
pass(`Compared documentation with ${nodeIds.length} runtime nodes.`);

const fixture = {
  nodes: [
    { id: "oldGet", type: "get_var", data: { name: "score" } },
    { id: "oldSet", type: "act_set_var", data: { name: "score" } },
    { id: "legacyArray", type: "arr_at", data: { index: 2 } },
    { id: "sink", type: "output", data: {} }
  ],
  edges: [
    { fromNode: "oldGet", fromPin: "v", toNode: "oldSet", toPin: "value" },
    { fromNode: "legacyArray", fromPin: "v", toNode: "sink", toPin: "v" }
  ]
};
const migrated = structuredClone(fixture);
const migrationResult = migrations.migrateGraph(migrated);
const types = Object.fromEntries(migrated.nodes.map(node => [node.id, node.type]));
if (types.oldGet !== "var_read") fail("Migration fixture: get_var did not migrate to var_read.");
if (types.oldSet !== "var_write") fail("Migration fixture: act_set_var did not migrate to var_write.");
if (types.legacyArray !== "arr_get") fail("Migration fixture: arr_at did not migrate to arr_get.");
const arrayEdge = migrated.edges.find(edge => edge.fromNode === "legacyArray");
if (arrayEdge?.fromPin !== "v") fail("Migration fixture: arr_at output edge was unexpectedly changed.");
if (!(migrationResult.changed > 0)) fail("Migration fixture reported no changes.");
const secondPass = migrations.migrateGraph(migrated);
if (secondPass.changed !== 0) fail(`Migration fixture is not idempotent; second pass changed ${secondPass.changed} entries.`);
pass("Migration fixture passed and is idempotent.");

const compatibilityCases = [
  ["value.number", "value.number", true],
  ["value.number", "value.string", false],
  ["value.any", "value.actor", true],
  ["exec", "exec", true],
  ["exec", "value.any", false],
  ["value.card", "value.cards", false]
];
for (const [from, to, expected] of compatibilityCases) {
  const actual = pinTypes.arePinsCompatible(from, to);
  if (actual !== expected) fail(`Pin compatibility ${from} -> ${to}: expected ${expected}, got ${actual}.`);
}
pass(`Validated ${compatibilityCases.length} pin compatibility cases.`);

const lintFixtures = [
  {
    name: "unknown node",
    graph: { nodes: [{ id: "n1", type: "does_not_exist", data: {} }], edges: [] },
    code: "E001", severity: "error"
  },
  {
    name: "legacy node",
    graph: { nodes: [{ id: "n1", type: "get_var", data: {} }], edges: [] },
    code: "E002", severity: "error"
  },
  {
    name: "dangling edge",
    graph: { nodes: [{ id: "n1", type: "literal", data: {} }], edges: [{ fromNode: "n1", fromPin: "v", toNode: "missing", toPin: "v" }] },
    code: "E004", severity: "error"
  },
  {
    name: "incompatible pins",
    graph: {
      nodes: [{ id: "a", type: "literal", data: {} }, { id: "b", type: "literal_str", data: {} }],
      edges: [{ fromNode: "a", fromPin: "v", toNode: "b", toPin: "in" }]
    },
    code: "E003", severity: "error"
  },
  {
    name: "missing entry",
    graph: { nodes: [{ id: "n1", type: "literal", data: {} }], edges: [] },
    code: "W001", severity: "warn"
  },
  {
    name: "orphan node",
    graph: { nodes: [{ id: "n1", type: "literal", data: {} }, { id: "out", type: "output", data: {} }], edges: [] },
    code: "W002", severity: "info"
  }
];
for (const fixture of lintFixtures) {
  const report = linter.lintGraph(fixture.graph, NODE_DEFS);
  if (!report.some(item => item.code === fixture.code && item.severity === fixture.severity)) {
    fail(`Linter fixture "${fixture.name}" did not produce ${fixture.severity} ${fixture.code}.`);
  }
}
const cleanLint = linter.lintGraph({
  nodes: [{ id: "source", type: "literal", data: {} }, { id: "sink", type: "output", data: {} }],
  edges: [{ fromNode: "source", fromPin: "v", toNode: "sink", toPin: "v" }]
}, NODE_DEFS);
if (cleanLint.some(item => item.severity === "error")) {
  fail(`Clean linter fixture produced errors: ${JSON.stringify(cleanLint)}`);
}
pass(`Validated ${lintFixtures.length} linter diagnostics plus one clean graph.`);

const contractAuditPath = path.join(root, "docs/data/node-contract-audit.json");
if (!fs.existsSync(contractAuditPath)) {
  fail("Compiler/executor contract audit is missing; run node scripts/audit-node-contracts.mjs.");
} else {
  const contractAudit = readJson("docs/data/node-contract-audit.json");
  const graphPath = path.join(root, "module/builder/formula-graph.mjs");
  const executorPath = path.join(root, "module/helpers/button-executor.mjs");
  const expectedMtimes = contractAudit?.sourceMtimes ?? {};
  const currentMtimes = {
    graphSource: fs.statSync(graphPath).mtimeMs,
    executorSource: fs.statSync(executorPath).mtimeMs
  };
  if (expectedMtimes.graphSource !== currentMtimes.graphSource
      || expectedMtimes.executorSource !== currentMtimes.executorSource) {
    fail("Compiler/executor audit is stale; run node scripts/audit-node-contracts.mjs.");
  }
  const contractFailures = Number(contractAudit?.summary?.compileFailures ?? 0)
    + Number(contractAudit?.summary?.missingExecutor ?? 0);
  if (contractFailures) {
    fail(`Compiler/executor audit reports ${contractFailures} contract failures.`);
  }
  pass(`Validated compiler/executor audit (${contractAudit?.summary?.emittedActionTypes ?? 0} emitted action types).`);
}

console.log(`Node graph verification: ${checks.length} checks, ${warnings.length} warnings, ${failures.length} failures.`);
for (const message of checks) console.log(`  PASS: ${message}`);
for (const message of warnings) console.warn(`  WARN: ${message}`);
for (const message of failures) console.error(`  FAIL: ${message}`);
if (failures.length) process.exitCode = 1;
