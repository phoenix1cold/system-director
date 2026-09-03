import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  arePinsCompatible,
  automaticPinConverter,
  canConnectPins
} from "../module/builder/pin-types.mjs";

assert.equal(
  arePinsCompatible("value.string", "value.number"),
  false,
  "Text and Number must not be stored as a direct edge"
);
assert.deepEqual(
  automaticPinConverter("value.string", "value.number"),
  { type: "convert_number", inputPin: "value", outputPin: "v" },
  "Text → Number must select the visible To Number node"
);
assert.equal(canConnectPins("value.string", "value.number"), true);
assert.deepEqual(automaticPinConverter("value.number", "value.string"), { type: "convert_text", inputPin: "value", outputPin: "v" });
assert.deepEqual(automaticPinConverter("value.bool", "value.string"), { type: "convert_text", inputPin: "value", outputPin: "v" });
assert.deepEqual(automaticPinConverter("value.string", "value.bool"), { type: "convert_boolean", inputPin: "value", outputPin: "v" });
assert.deepEqual(automaticPinConverter("value.number", "value.bool"), { type: "convert_boolean", inputPin: "value", outputPin: "v" });
assert.deepEqual(automaticPinConverter("value.string", "value.array"), { type: "convert_array", inputPin: "value", outputPin: "v" });
assert.equal(automaticPinConverter("exec", "value.number"), null);

const source = await readFile(new URL("../module/builder/formula-graph.mjs", import.meta.url), "utf8");
assert.match(source, /_insertAutomaticConverter\(fn, fp, tn, tp, converter\)/);
assert.match(source, /type: converter\.type/);
assert.match(source, /toNode: node\.id, toPin: converter\.inputPin/);
assert.match(source, /fromNode: node\.id, fromPin: converter\.outputPin, toNode: tn, toPin: tp/);
assert.match(source, /if \(!canConnectPins\(conn\.fromType, targetType\)\)/);
assert.match(source, /automaticPinConverter\(output\.type, input\.type\)/);

console.log("PASS: Safe cross-type connections insert visible converter nodes automatically");
