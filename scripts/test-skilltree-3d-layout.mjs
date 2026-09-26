import assert from "node:assert/strict";
import { layoutSkillTreeSphere } from "../module/helpers/skilltree-3d.mjs";

const node = (id, col, row) => ({ id, col, row });
const dist = p => Math.hypot(p.x, p.y, p.z);

// Single root sits at the origin; children by depth on concentric shells.
{
  const nodes = [node("root", 0, 0), node("a", 1, 0), node("b", 1, 1), node("c", 1, 2), node("a1", 2, 0), node("a2", 2, 1)];
  const conns = [["root", "a"], ["root", "b"], ["root", "c"], ["a", "a1"], ["a", "a2"]].map(([from, to]) => ({ from, to }));
  const layout = layoutSkillTreeSphere(nodes, conns, 2);
  assert.equal(layout.size, nodes.length);
  assert.equal(dist(layout.get("root")), 0);
  for (const id of ["a", "b", "c"]) assert.ok(Math.abs(dist(layout.get(id)) - 2) < 1e-6, `${id} on first shell`);
  for (const id of ["a1", "a2"]) assert.ok(Math.abs(dist(layout.get(id)) - 4) < 1e-6, `${id} on second shell`);
  // Grandchildren fan out around the parent's direction rather than collapsing onto it.
  const a = layout.get("a"), a1 = layout.get("a1"), a2 = layout.get("a2");
  const dot = (p, q) => (p.x * q.x + p.y * q.y + p.z * q.z) / (dist(p) * dist(q));
  assert.ok(dot(a, a1) > 0.3 && dot(a, a2) > 0.3, "children stay on the parent's side");
  assert.ok(Math.hypot(a1.x - a2.x, a1.y - a2.y, a1.z - a2.z) > 0.5, "siblings are separated");
  // Positions are unique.
  const keys = new Set([...layout.values()].map(p => `${p.x.toFixed(4)},${p.y.toFixed(4)},${p.z.toFixed(4)}`));
  assert.equal(keys.size, nodes.length);
}

// Several roots share the first shell; unreachable nodes land on the outer shell; cycles do not hang.
{
  const nodes = [node("r1", 0, 0), node("r2", 0, 1), node("x", 3, 3), node("y", 3, 4), node("loop1", 5, 5), node("loop2", 5, 6)];
  const conns = [{ from: "r1", to: "x" }, { from: "loop1", to: "loop2" }, { from: "loop2", to: "loop1" }, { from: "ghost", to: "y" }];
  const layout = layoutSkillTreeSphere(nodes, conns, 1);
  assert.equal(layout.size, nodes.length);
  assert.ok(Math.abs(dist(layout.get("r1")) - 1) < 1e-6 && Math.abs(dist(layout.get("r2")) - 1) < 1e-6);
  assert.ok(Math.abs(dist(layout.get("y")) - 1) < 1e-6, "dangling prerequisite makes y a root");
  assert.ok(dist(layout.get("loop1")) >= 2, "cycle members are placed on the outer shell");
}

// Empty tree and a lone node.
assert.equal(layoutSkillTreeSphere([], []).size, 0);
assert.equal(dist(layoutSkillTreeSphere([node("solo", 0, 0)], []).get("solo")), 0);

console.log("skilltree-3d layout: PASS");
