import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const root=path.resolve(import.meta.dirname,"..");
const read=p=>fs.readFileSync(path.join(root,p),"utf8");
const manifest=JSON.parse(read("system.json"));
assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
assert.equal(fs.existsSync(path.join(root,"module/helpers/trade.mjs")),true,"standalone trade module must remain untouched");
for(const file of ["sd.mjs","module/sheets/character-sheet.mjs","module/sheets/item-sheet.mjs","templates/actor/sheet-header.hbs"]){const src=read(file);assert.doesNotMatch(src,/SDTrade|openTrade|helpers\/trade\.mjs/,`${file} still owns trade runtime/UI`);}
console.log("PASS: Trade remains standalone and is not imported by core UI surfaces.");
