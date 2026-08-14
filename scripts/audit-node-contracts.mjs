import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const graphPath = path.join(root, "module/builder/formula-graph.mjs");
const executorPath = path.join(root, "module/helpers/button-executor.mjs");

function installFoundryStubs() {
  globalThis.document ??= {
    getElementById: () => ({}),
    createElement: () => ({ textContent: "", appendChild() {} }),
    head: { appendChild() {} }
  };
  globalThis.window ??= { addEventListener() {} };
}
function add(map, key, value) {
  if (!key) return;
  const values = map.get(key) ?? new Set();
  values.add(value);
  map.set(key, values);
}
function quotedCases(source) {
  return new Set([...source.matchAll(/case\s+["'`]([A-Za-z0-9_]+)["'`]\s*:/g)].map(match => match[1]));
}
function quotedActionTypes(source) {
  return new Set([...source.matchAll(/\btype\s*:\s*["'`]([A-Za-z0-9_]+)["'`]/g)].map(match => match[1]));
}

installFoundryStubs();
const { NODE_DEFS } = await import(pathToFileURL(graphPath).href);
const graphSource = fs.readFileSync(graphPath, "utf8");
const executorSource = fs.readFileSync(executorPath, "utf8");
const executorCases = quotedCases(executorSource);
const auditInputs = {
  graphSource: fs.statSync(graphPath).mtimeMs,
  executorSource: fs.statSync(executorPath).mtimeMs
};
const emittedByNode = new Map();
const compileFailures = [];
const compilerSpecial = [];
const ignoredRuntimeTypes = new Set([
  // Deliberate compiler sentinels or executor-external handlers.
  "noop"
]);

for (const [nodeId, def] of Object.entries(NODE_DEFS)) {
  if (!def?.isAction) continue;
  if (typeof def.toAction === "function") {
    try {
      const action = def.toAction({ id: `audit-${nodeId}`, type: nodeId, data: {} }, {});
      const type = String(action?.type ?? "").trim();
      if (!type) compileFailures.push(`${nodeId}: toAction returned no action.type.`);
      else add(emittedByNode, type, nodeId);
    } catch (error) {
      compileFailures.push(`${nodeId}: toAction threw: ${error?.message ?? error}`);
    }
  } else if (def.isFunctionCall) {
    compilerSpecial.push(`${nodeId}: function-call compiler path`);
  } else {
    compilerSpecial.push(`${nodeId}: explicit _compileExecChain path`);
  }
}

// Special compiler branches emit action types without a definition-level
// toAction. Only accept static action types that also have an executor case;
// object literals elsewhere in this large module use `type` for nodes, fields,
// and UI controls and are not runtime actions.
for (const type of quotedActionTypes(graphSource)) {
  if (executorCases.has(type) && !emittedByNode.has(type)) {
    add(emittedByNode, type, "<special compiler emission>");
  }
}

const emittedTypes = new Set(emittedByNode.keys());
const missingExecutor = [...emittedTypes]
  .filter(type => !executorCases.has(type) && !ignoredRuntimeTypes.has(type))
  .sort();
const executorOnly = [...executorCases]
  .filter(type => !emittedTypes.has(type))
  .sort();

const report = {
  sourceMtimes: auditInputs,
  summary: {
    actionNodes: Object.values(NODE_DEFS).filter(def => def?.isAction).length,
    emittedActionTypes: emittedTypes.size,
    executorCaseLabels: executorCases.size,
    compileFailures: compileFailures.length,
    missingExecutor: missingExecutor.length,
    executorOnly: executorOnly.length,
    compilerSpecial: compilerSpecial.length
  },
  compileFailures,
  missingExecutor: missingExecutor.map(type => ({
    type,
    emitters: [...(emittedByNode.get(type) ?? [])].sort()
  })),
  executorOnly,
  compilerSpecial
};

const outPath = path.join(root, "docs/data/node-contract-audit.json");
fs.mkdirSync(path.dirname(outPath), { recursive: true });
const serialized = `${JSON.stringify(report, null, 2)}\n`;
const previous = fs.existsSync(outPath) ? fs.readFileSync(outPath, "utf8") : "";
if (previous !== serialized) fs.writeFileSync(outPath, serialized, "utf8");

console.log("Node compiler/executor contract audit:");
for (const [key, value] of Object.entries(report.summary)) console.log(`  ${key}: ${value}`);
console.log(`  report: ${path.relative(root, outPath).replaceAll("\\", "/")}`);

if (compileFailures.length || missingExecutor.length) {
  for (const message of compileFailures) console.error(`  FAIL: ${message}`);
  for (const item of report.missingExecutor) {
    console.error(`  FAIL: action type "${item.type}" has no ButtonExecutor case (emitters: ${item.emitters.join(", ")}).`);
  }
  process.exitCode = 1;
}
