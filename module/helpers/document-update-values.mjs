import { getValueDefinitions, readDatabaseValue, valueStoragePath } from "./value-database.mjs";

/** Foundry updates may contain both dotted keys and nested objects, including deletions. */
export function changedPath(diff, path) {
  const walk=(object,prefix="")=>Object.entries(object??{}).some(([key,value])=>{
    const full=prefix?`${prefix}.${key}`:key;
    const clean=full.replace(/(^|\.)-=/g,"$1");
    if(clean===path||clean.startsWith(path+"."))return true;
    if(path.startsWith(clean+"."))return value&&typeof value==="object"?walk(value,clean):true;
    return false;
  });
  return walk(diff);
}

export function changedDatabaseVariables(diff) {
  return getValueDefinitions().filter(def=>changedPath(diff,valueStoragePath(def.id))||(def.legacyPath&&changedPath(diff,def.legacyPath))).map(def=>def.id);
}

export function captureUpdateValues(doc,diff,options={}) {
  options.sdPreviousDatabaseValues=Object.fromEntries(changedDatabaseVariables(diff).map(id=>[id,structuredClone(readDatabaseValue(doc,id))]));
}
