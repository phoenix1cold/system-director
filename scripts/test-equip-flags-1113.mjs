import assert from "node:assert/strict";
import fs from "node:fs";
import {
  EQUIP_TOGGLE_OPTION, EQUIP_TOGGLE_KEYS, asEquipBool, isEquipToggleUpdate,
  systemDiffRootKeys, stripEquipToggleNoise, isFullInventorySource,
  isFullDocumentSource, resolveEquippableFlag, applyEquippableMigration,
  snapshotEquippable
} from "../module/helpers/equip-guard.mjs";

const read = name => fs.readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
const ACTOR_ANCHORS = ["attributes", "resources", "skills", "currency", "hiddenFields", "biography"];

const fullSource = (overrides = {}) => ({
  category: "gear", rarity: "", quantity: 1, weight: 0, price: 0, currency: "primary",
  hiddenFields: {}, description: "", equipped: false, identified: true, ...overrides
});

// 1. An equip payload is never enriched with schema defaults.
const equipDiff = { equipped: true };
applyEquippableMigration(equipDiff);
assert.deepEqual(equipDiff, { equipped: true }, "equip payload must stay untouched");
assert.equal(resolveEquippableFlag({ equipped: false }), undefined);
assert.equal(isFullInventorySource({ equipped: true }), false);
const unequipDiff = { equipped: false, widgetFields: {} };
applyEquippableMigration(unequipDiff);
assert.equal("equippable" in unequipDiff, false, "unequip payload must stay untouched");

// 2. An explicit checkbox value always wins and retires the legacy mirror.
assert.equal(resolveEquippableFlag(fullSource({ equippable: true })), undefined);
const ticked = fullSource({ equippable: true, hiddenFields: { equippable: false } });
applyEquippableMigration(ticked);
assert.equal(ticked.equippable, true, "the checkbox is the single source of truth");
assert.equal("equippable" in ticked.hiddenFields, false, "legacy mirror is dropped");

// 3. The legacy mirror is adopted once, whatever the payload shape.
const legacyOn = fullSource({ hiddenFields: { equippable: "true" } });
applyEquippableMigration(legacyOn);
assert.equal(legacyOn.equippable, true);
assert.equal("equippable" in legacyOn.hiddenFields, false);
const legacyOff = { hiddenFields: { equippable: 0 } };
applyEquippableMigration(legacyOff);
assert.equal(legacyOff.equippable, false);

// 4. The old category heuristic only runs for a complete source.
const weapon = fullSource({ category: "weapon" });
applyEquippableMigration(weapon);
assert.equal(weapon.equippable, true);
const gear = fullSource();
applyEquippableMigration(gear);
assert.equal(gear.equippable, false);
const quantityEdit = { category: "weapon", quantity: 2 };
applyEquippableMigration(quantityEdit);
assert.equal(quantityEdit.equippable, undefined, "a quantity edit must not touch the flag");

// 5. Loose legacy values.
for (const value of [true, "true", 1, "yes"]) assert.equal(asEquipBool(value), true, `${value}`);
for (const value of [false, "false", 0, "0", "", null, undefined]) assert.equal(asEquipBool(value), false, `${value}`);

// 6. Equip toggles may only write `system.equipped`.
assert.deepEqual(EQUIP_TOGGLE_KEYS, ["equipped", "widgetFields"]);
assert.equal(isEquipToggleUpdate({ [EQUIP_TOGGLE_OPTION]: true }), true);
assert.equal(isEquipToggleUpdate({}), false);
assert.equal(isEquipToggleUpdate(undefined), false);
const dotted = {
  "system.equipped": true, "system.equippable": false,
  "system.hiddenFields": { a: 1 }, "system.concentration": false, name: "Sword"
};
stripEquipToggleNoise(dotted);
assert.deepEqual(dotted, { "system.equipped": true, name: "Sword" });
const nested = { system: { equipped: false, equippable: false, equipRequirements: "", widgetFields: {} } };
stripEquipToggleNoise(nested);
assert.deepEqual(nested, { system: { equipped: false, widgetFields: {} } });
const onlyNoise = { system: { equippable: false } };
stripEquipToggleNoise(onlyNoise);
assert.deepEqual(onlyNoise, {});
assert.deepEqual(
  [...systemDiffRootKeys({ "system.equipped": true, "system.hiddenFields.type": "a", system: { equippable: false } })].sort(),
  ["equippable", "equipped", "hiddenFields"]
);

// 7. Slot snapshots stay equippable with either storage form.
assert.equal(snapshotEquippable({ system: { equippable: true } }), true);
assert.equal(snapshotEquippable({ system: { equippable: false, hiddenFields: { equippable: true } } }), false);
assert.equal(snapshotEquippable({ system: { hiddenFields: { equippable: "1" } } }), true);
assert.equal(snapshotEquippable({ system: {} }), false);
assert.equal(snapshotEquippable(null), false);

// 8. Actor defaults are gated behind a complete source too.
assert.equal(isFullDocumentSource({ resources: {} }, ACTOR_ANCHORS, 4), false);
assert.equal(isFullDocumentSource(
  { attributes: {}, resources: {}, skills: {}, currency: {}, hiddenFields: {}, biography: {} },
  ACTOR_ANCHORS, 4), true);

// 9. Wiring: the models delegate and every equip call site marks its update.
const wired = [
  ["module/data/item-inventory.mjs", /applyEquippableMigration\(source\)/],
  ["module/documents/item.mjs", /isEquipToggleUpdate\(options\)\) stripEquipToggleNoise\(changed\)/],
  ["module/data/actor-character.mjs", /isFullDocumentSource\(source,/],
  ["module/data/item-slots.mjs", /snapshotEquippable\(snap\)/],
  ["module/sheets/character-sheet.mjs", /"system\.equipped": next \}, \{ sdEquipToggle: true \}/],
  ["module/sheets/item-sheet.mjs", /"system\.equipped": next \}, \{ sdEquipToggle: true \}/],
  ["module/helpers/action-hud.mjs", /"system\.equipped": next \}, \{ sdEquipToggle: true \}/],
  ["module/helpers/button-executor.mjs", /"system\.equipped": _eqNext \}, \{ sdEquipToggle: true \}/],
  ["module/helpers/migrations.mjs", /version:\s*"1\.11\.3"/]
];
for (const [file, pattern] of wired) assert.match(read(file), pattern, `${file} is not wired`);
assert.doesNotMatch(read("module/data/item-inventory.mjs"), /source\.equippable = \["weapon"/,
  "the category heuristic must live behind the full-source guard");

const manifest = JSON.parse(read("system.json"));
assert.equal(manifest.version, "1.11.3");

console.log("PASS: equip toggles keep the Equippable flag (1.11.3).");
