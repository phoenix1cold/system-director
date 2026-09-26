import assert from 'node:assert/strict';import fs from 'node:fs';
const m=fs.readFileSync(new URL('../module/helpers/effect-applier.mjs',import.meta.url),'utf8');
const c=fs.readFileSync(new URL('../styles/system.css',import.meta.url),'utf8');
const shell=fs.readFileSync(new URL('../styles/editor-shell.css',import.meta.url),'utf8');
// Effect Applier is built on the shared editor shell: master list + detail + footer, no inline layout styles.
for(const x of [/sd-shell sd-ea-root/,/sd-master-detail/,/sd-master-search/,/sd-list-row/,/sd-detail-hdr/,/sd-form-grid/,/sd-switch/,/sd-ea-change/,/sd-footer/,/sd-btn-primary" data-action="apply"/,/_persist\(\)/])assert.match(m,x);
assert.doesNotMatch(m,/style="display:grid;grid-template-columns/);
assert.doesNotMatch(m,/data-action="save"/,'presets autosave; no Save button');
for(const x of [/\.sd-effect-applier \.window-content\{padding:0!important;overflow:hidden!important\}/])assert.match(c,x);
assert.doesNotMatch(c,/sd-ea-sidebar/,'legacy Effect Applier CSS removed');
for(const x of [/\.sd-master-detail/,/\.sd-ea-change \{ grid-template-columns/,/\.sd-switch-track/])assert.match(shell,x);
console.log('Effect Applier shell layout regression: OK');
