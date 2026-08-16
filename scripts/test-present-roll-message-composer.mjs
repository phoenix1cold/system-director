import assert from "node:assert/strict";
import { materializeDeferredActionSnapshot } from "../module/helpers/deferred-action-snapshot.mjs";

const attackResult = {
  type: "sd.roll-result",
  formula: "1d20 + 5",
  total: 17,
  createdAt: 1
};
const damageResult = {
  type: "sd.roll-result",
  formula: "1d12 + 1d8",
  total: 13,
  createdAt: 2
};

let runtime = { __rollResult: attackResult };
const resolveRuntime = value => {
  if (value === "{__rollResult}") return runtime.__rollResult;
  return value.replaceAll("{__rollTotal}", String(runtime.__rollResult.total));
};

const buttonActions = [{
  type: "rollResultV2",
  formula: "1d12 + 1d8",
  execActions: [{
    type: "presentRollResult",
    result: "{__rollResult}",
    label: "Fire Damage!"
  }]
}];

const storedActions = materializeDeferredActionSnapshot(buttonActions, resolveRuntime);
assert.notStrictEqual(storedActions, buttonActions, "the deferred action tree is cloned");
assert.equal(
  storedActions[0].execActions[0].result,
  "{__rollResult}",
  "Present Roll must stay bound to the click-time Roll Result"
);

// Simulate Roll writing a new result before Present Roll executes.
runtime.__rollResult = damageResult;
const presented = resolveRuntime(storedActions[0].execActions[0].result);
assert.strictEqual(presented, damageResult);
assert.notStrictEqual(presented, attackResult);

// Non-Roll-Result text keeps the existing post-time snapshot behavior.
runtime.__rollResult = attackResult;
assert.equal(
  materializeDeferredActionSnapshot("Attack total: {__rollTotal}", resolveRuntime),
  "Attack total: 17"
);

console.log("Present Roll deferred Message Composer regression test: OK");
