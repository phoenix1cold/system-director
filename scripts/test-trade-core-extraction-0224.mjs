import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const root=path.resolve(import.meta.dirname,"..");
const read=p=>fs.readFileSync(path.join(root,p),"utf8");
const manifest=JSON.parse(read("system.json"));
assert.equal(manifest.version,"0.22.9");
assert.equal(fs.existsSync(path.join(root,"module/helpers/trade.mjs")),false,"core trade runtime must be deleted");
for(const file of ["sd.mjs","module/sheets/character-sheet.mjs","module/sheets/item-sheet.mjs","templates/actor/sheet-header.hbs"]){const src=read(file);assert.doesNotMatch(src,/SDTrade|openTrade|helpers\/trade\.mjs/,`${file} still owns trade runtime/UI`);}
for(const lang of ["en","ru"]){const data=JSON.parse(read(`lang/${lang}.json`));assert.equal(Object.keys(data).some(k=>k.startsWith("SD.Trade.")),false,`${lang} still has core trade localisation`);}
console.log("PASS: System Director core no longer owns trading.");
