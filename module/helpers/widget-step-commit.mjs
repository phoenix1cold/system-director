// Serialize +/- per bound document/path. Both click actions and value references
// observe the persisted new value, including during rapid alternating clicks.
const queues = new WeakMap();
export function commitWidgetStep(doc, {path,step,min=-Infinity,max=Infinity,readCurrent,onValue,emit,emitChange=false}) {
  if (!path || !Number.isFinite(step)) return Promise.resolve();
  let paths=queues.get(doc);if(!paths)queues.set(doc,paths=new Map());
  const previous=paths.get(path) ?? Promise.resolve();
  const task=previous.catch(()=>{}).then(async()=>{
    const current=Number(readCurrent?.() ?? foundry.utils.getProperty(doc,path)) || 0;
    const value=Math.max(min,Math.min(max,current+step));
    try {
      await doc.update({[path]:value});
      onValue?.(value);
      await emit?.("click",null,{value});
      if(emitChange&&value!==current)await emit?.("change",null,{value});
      return value;
    } catch(error) { onValue?.(Number(foundry.utils.getProperty(doc,path)) || 0);throw error; }
  });
  paths.set(path,task);
  task.finally(()=>{if(paths.get(path)===task)paths.delete(path);}).catch(()=>{});
  return task;
}
