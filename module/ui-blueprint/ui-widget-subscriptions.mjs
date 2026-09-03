/** Shared document subscriptions for every open UI Blueprint instance. */
const documentSubscribers = new Map();
const effectSubscribers = new Map();
const resizeSubscribers = new Set();
let installed = false;

function notify(map, key, ...args) {
  if (!key) return;
  for (const callback of [...(map.get(key) ?? [])]) {
    try { callback(...args); }
    catch (error) { console.warn("sd-ui-widget | subscription callback failed", error); }
  }
}

function install() {
  if (installed) return;
  installed = true;
  Hooks.on("updateActor", (document, changes) => notify(documentSubscribers, document?.uuid, document, changes));
  Hooks.on("updateItem", (document, changes) => notify(documentSubscribers, document?.uuid, document, changes));
  const onEffect = effect => notify(effectSubscribers, effect?.parent?.uuid, effect);
  Hooks.on("createActiveEffect", onEffect);
  Hooks.on("updateActiveEffect", onEffect);
  Hooks.on("deleteActiveEffect", onEffect);
  window.addEventListener("resize", () => {
    for (const callback of [...resizeSubscribers]) {
      try { callback(); }
      catch (error) { console.warn("sd-ui-widget | resize callback failed", error); }
    }
  });
}

function subscribe(map, key, callback) {
  if (!key || typeof callback !== "function") return () => {};
  install();
  const values = map.get(key) ?? new Set();
  values.add(callback);
  map.set(key, values);
  return () => {
    values.delete(callback);
    if (!values.size) map.delete(key);
  };
}

export function subscribeDocument(document, callback) {
  return subscribe(documentSubscribers, document?.uuid, callback);
}

export function subscribeEffects(document, callback) {
  return subscribe(effectSubscribers, document?.uuid, callback);
}

export function subscribeViewport(callback) {
  if (typeof callback !== "function") return () => {};
  install();
  resizeSubscribers.add(callback);
  return () => resizeSubscribers.delete(callback);
}

export function subscriptionSnapshot() {
  return {
    documents: documentSubscribers.size,
    effects: effectSubscribers.size,
    viewports: resizeSubscribers.size
  };
}
