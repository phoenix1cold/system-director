import fs from "node:fs";
const popup=fs.readFileSync(new URL("../module/builder/widget-config-popup.mjs",import.meta.url),"utf8");
const css=fs.readFileSync(new URL("../styles/system.css",import.meta.url),"utf8");
const guide=fs.readFileSync(new URL("../module/helpers/onboarding.mjs",import.meta.url),"utf8");
const catalogUrl=new URL("../../sd-wiki-server/seed/node-catalog.json",import.meta.url);
const catalog=fs.existsSync(catalogUrl)?JSON.parse(fs.readFileSync(catalogUrl,"utf8")):null;
const nodes=catalog?(catalog.nodes&&typeof catalog.nodes==="object"?catalog.nodes:catalog):null;
if(!popup.includes('class="wcfg-input-row"'))throw Error("path row lacks stable layout class");
for(const token of ['grid-template-columns:minmax(0,1fr) 28px','input[type="checkbox"]','width:15px!important','wcfg-clear-btn'])if(!css.includes(token))throw Error(`missing popup CSS: ${token}`);
for(const id of ['on_click','act_roll_v2','act_present_roll']){if(nodes&&!nodes[id])throw Error(`tutorial node missing from catalog: ${id}`);if(!guide.includes(`data-type='${id}'`))throw Error(`tutorial does not reference ${id}`);}
if(guide.includes("act_roll_value"))throw Error("obsolete Roll -> Value node remains in onboarding");
if(!guide.includes("Roll Result"))throw Error("tutorial does not teach the structured Roll Result wire");
console.log("Hidden Field alignment and onboarding regression: OK");
