/** Bridge client lifecycle hooks into the Blueprint event bus. No socket broadcast. */
export function installLifecycleEvents(bus) {
  if (bus._lifecycleInstalled) return;
  bus._lifecycleInstalled = true;
  const openSheets = new WeakSet();
  let loadedScene = null;
  const emit = (hook, payload) => Promise.resolve(bus._dispatch(hook, [payload]))
    .catch(error => console.error(`SD | ${hook} failed`, error));

  Hooks.on("renderApplicationV2", app => {
    const Sheet = globalThis.foundry?.applications?.api?.DocumentSheetV2;
    if (!Sheet || !(app instanceof Sheet) || !app.document?.uuid || openSheets.has(app)) return;
    openSheets.add(app);
    const doc = app.document;
    // Preserve self matching for unlinked-token actors and their embedded items.
    const sourceUuid = doc.documentName === "Actor" && doc.isToken ? `Actor.${doc.id}`
      : doc.documentName === "Item" && doc.actor?.isToken ? `Actor.${doc.actor.id}.Item.${doc.id}` : doc.uuid;
    return emit("sdSheetOpen", { document: doc, documentUuid: doc.uuid, sourceUuid,
      documentName: doc.name ?? "", documentType: doc.documentName ?? "", userId: game.user?.id ?? "" });
  });
  Hooks.on("closeApplicationV2", app => openSheets.delete(app));

  const onMapLoaded = canvas => {
    const scene = canvas?.scene;
    if (!scene?.uuid || loadedScene === scene.uuid) return;
    loadedScene = scene.uuid;
    return emit("sdMapLoaded", { sceneUuid: scene.uuid, sceneId: scene.id, sceneName: scene.name ?? "", userId: game.user?.id ?? "" });
  };
  Hooks.on("canvasTearDown", () => { loadedScene = null; });
  Hooks.on("canvasReady", onMapLoaded);
  // Foundry may finish the initial canvas draw before the system's ready hook.
  if (globalThis.canvas?.ready) queueMicrotask(() => onMapLoaded(globalThis.canvas));
}

export function isLifecycleGM() {
  const activeGM = game.users?.activeGM ?? [...(game.users ?? [])]
    .filter(user => user.active && user.isGM).sort((a, b) => String(a.id).localeCompare(String(b.id)))[0];
  return !!game.user?.isGM && activeGM?.id === game.user.id;
}
