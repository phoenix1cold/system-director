import assert from "node:assert/strict";
import fs from "node:fs";
const read=p=>fs.readFileSync(new URL(p,import.meta.url),"utf8");
const actor=read("../module/sheets/character-sheet.mjs");
const item=read("../module/sheets/item-sheet.mjs");
const identity=read("../module/builder/widget-identity.mjs");
for(const sheet of [actor,item]){
  assert.match(sheet,/import \{ promptWidgetIdentity \}/);
  assert.match(sheet,/const identity=await promptWidgetIdentity\(/);
  assert.match(sheet,/if\(!identity\)return/);
  assert.match(sheet,/widgetKey:\s*identity\.widgetKey/);
}
assert.match(identity,/title:"Place Sheet Widget"/);
assert.match(identity,/Widget Key <em>required<\/em>/);
assert.match(identity,/collectWidgetKeys\(tabs\)\.has\(widgetKey\)/);
assert.match(identity,/Widget Key is required/);
console.log("PASS: ordinary Actor and Item widgets require a unique Widget Key before placement.");
