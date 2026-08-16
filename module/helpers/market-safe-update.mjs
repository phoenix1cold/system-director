const isObject=value=>value!==null&&typeof value==="object"&&!Array.isArray(value);
export const cloneMarketValue=value=>value===undefined?undefined:(globalThis.structuredClone?structuredClone(value):JSON.parse(JSON.stringify(value)));
export const equalMarketValue=(a,b)=>{if(Object.is(a,b))return true;if(a===undefined||b===undefined)return false;try{return JSON.stringify(a)===JSON.stringify(b)}catch{return false}};
const identityKey=arrays=>{const values=arrays.flat().filter(v=>v!==undefined);if(!values.length||!values.every(isObject))return null;for(const key of["id","_id","key","uuid","name"]){if(!values.every(v=>v[key]!==undefined&&v[key]!==null))continue;const ids=values.map(v=>String(v[key]));if(new Set(ids).size===ids.length||arrays.every(arr=>new Set(arr.map(v=>String(v[key]))).size===arr.length))return key}return null};
function mergeValue(base,local,remote,path,conflicts){
 if(equalMarketValue(local,base))return cloneMarketValue(remote);
 if(equalMarketValue(remote,base)||equalMarketValue(local,remote))return cloneMarketValue(local);
 if(Array.isArray(base)&&Array.isArray(local)&&Array.isArray(remote)){
  const key=identityKey([base,local,remote]);if(!key){conflicts.push(path||"$");return cloneMarketValue(local)}
  const bm=new Map(base.map(v=>[String(v[key]),v])),lm=new Map(local.map(v=>[String(v[key]),v])),rm=new Map(remote.map(v=>[String(v[key]),v])),ids=[...rm.keys(),...lm.keys().filter(id=>!rm.has(id))],out=[];
  for(const id of ids){const bp=bm.has(id),lp=lm.has(id),rp=rm.has(id),p=`${path}[${key}=${id}]`;if(!bp){if(lp&&rp)out.push(mergeValue(undefined,lm.get(id),rm.get(id),p,conflicts));else out.push(cloneMarketValue((lp?lm:rm).get(id)));continue}if(!rp){if(lp&&!equalMarketValue(lm.get(id),bm.get(id))){conflicts.push(p);out.push(cloneMarketValue(lm.get(id)))}continue}if(!lp){if(!equalMarketValue(rm.get(id),bm.get(id)))conflicts.push(p);continue}out.push(mergeValue(bm.get(id),lm.get(id),rm.get(id),p,conflicts))}return out
 }
 if(isObject(base)&&isObject(local)&&isObject(remote)){
  const out={},keys=new Set([...Object.keys(base),...Object.keys(local),...Object.keys(remote)]);for(const key of keys){const bp=Object.hasOwn(base,key),lp=Object.hasOwn(local,key),rp=Object.hasOwn(remote,key),p=path?`${path}.${key}`:key;if(!bp){if(lp&&rp)out[key]=mergeValue(undefined,local[key],remote[key],p,conflicts);else if(lp||rp)out[key]=cloneMarketValue(lp?local[key]:remote[key]);continue}if(!rp){if(lp&&!equalMarketValue(local[key],base[key])){conflicts.push(p);out[key]=cloneMarketValue(local[key])}continue}if(!lp){if(!equalMarketValue(remote[key],base[key]))conflicts.push(p);continue}out[key]=mergeValue(base[key],local[key],remote[key],p,conflicts)}return out
 }
 conflicts.push(path||"$");return cloneMarketValue(local)
}
export function mergeMarketSettings(base={},local={},remote={}){const conflicts=[];return{value:mergeValue(base,local,remote,"",conflicts),conflicts:[...new Set(conflicts)]}}
export function compareMarketVersions(a,b){const parse=v=>String(v??"").replace(/^v/i,"").split(/[.+-]/).map(x=>/^\d+$/.test(x)?Number(x):x);const x=parse(a),y=parse(b),n=Math.max(x.length,y.length);for(let i=0;i<n;i++){const av=x[i]??0,bv=y[i]??0;if(av===bv)continue;if(typeof av==="number"&&typeof bv==="number")return av>bv?1:-1;return String(av).localeCompare(String(bv),undefined,{numeric:true})}return 0}
