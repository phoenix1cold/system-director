import assert from "node:assert/strict";
import fs from "node:fs";

const read=p=>fs.readFileSync(new URL(`../${p}`,import.meta.url),"utf8");
const host=read("module/helpers/foundry-window-host.mjs");
assert.match(host,/class SDFoundryWindowHost extends ApplicationV2/);
assert.match(host,/resizable:\s*true/);
assert.match(host,/minimizable:\s*true/);
assert.match(host,/sd-foundry-window-slot/);

const graph=read("module/builder/formula-graph.mjs");
assert.match(graph,/openFoundryWindow\(\{[\s\S]*?sd-formula-graph-/);
assert.match(graph,/sd-function-manager-/);
assert.match(graph,/sd-ai-graph-assistant-/);
assert.doesNotMatch(graph,/_buildWin\(\)[\s\S]{0,9000}document\.body\.appendChild\(win\)/);

const widget=read("module/builder/widget-config-popup.mjs");
assert.match(widget,/sd-widget-config-/);
assert.match(widget,/classes:\["sd-widget-config-window"\]/);
assert.doesNotMatch(widget,/document\.body\.appendChild\(popup\)/);

const builder=read("module/builder/builder-mixin.mjs");
assert.match(builder,/sd-legacy-widget-config-/);
assert.doesNotMatch(builder,/document\.body\.appendChild\(popup\)/);

const interact=read("module/helpers/interactables.mjs");
assert.match(interact,/sd-interactables-/);
assert.doesNotMatch(interact,/document\.body\.appendChild\(popup\)/);

const dialogue=read("module/helpers/dialogue-builder.mjs");
assert.match(dialogue,/sd-dialogue-foundry-window/);
assert.doesNotMatch(dialogue,/document\.body\.appendChild\(overlay\)/);

for(const p of ["module/helpers/system-config.mjs","module/helpers/shared-database.mjs","module/helpers/action-hud-inline-editor.mjs","module/builder/toolbox-app.mjs"]){
  assert.match(read(p),/ApplicationV2/,`${p} must remain a Foundry ApplicationV2 window`);
}
console.log("Foundry v14 native window migration regression: OK");
