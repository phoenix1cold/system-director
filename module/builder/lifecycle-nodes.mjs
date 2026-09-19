const OWNER = "sd:lifecycle";
const value = (id, label) => ({ id, label, type: "value.string" });
const token = (_node, _inputs, pin) => `{__var:__lifecycle_${pin}|}`;

export function registerLifecycleNodes(registry = globalThis.SD?.nodeRegistry ?? globalThis.CONFIG?.SD?.nodeRegistry) {
  if (!registry?.registerNode) return;
  registry.registerNode("on_sheet_open", {
    title: "On Sheet Open", cat: "Events", color: "#c04040", wideNode: true,
    desc: "Fires locally once when a document sheet opens, not when it re-renders. Use self for the graph's Actor/Item, or an exact document UUID. Closing and reopening fires again.",
    isEvent: true, eventHook: "sdSheetOpen", inputs: [],
    outputs: [{ id: "exec", label: "On Open", type: "exec" }, value("documentUuid", "Opened UUID"), value("documentName", "Name"), value("documentType", "Document Type"), value("userId", "User ID")],
    fields: [{ key: "documentUuid", label: "Sheet UUID / self", type: "text", default: "self", noPin: true }],
    compilePin: token
  }, { owner: OWNER });
  registry.registerNode("on_map_loaded", {
    title: "On Map Loaded", cat: "Events", color: "#c04040", wideNode: true,
    desc: "Fires after the selected scene finishes loading on this client, including initial world loading. Empty selects any scene. Active GM mode avoids duplicate shared playlist changes across clients.",
    isEvent: true, eventHook: "sdMapLoaded", inputs: [],
    outputs: [{ id: "exec", label: "On Loaded", type: "exec" }, value("sceneUuid", "Scene UUID"), value("sceneId", "Scene ID"), value("sceneName", "Scene Name"), value("userId", "User ID")],
    fields: [
      { key: "sceneUuid", label: "Scene", type: "select", default: "", noPin: true,
        options: () => [{ value: "", label: "Any scene" }, ...[...(globalThis.game?.scenes ?? [])].map(scene => ({ value: scene.uuid, label: scene.name }))] },
      { key: "sceneFilter", label: "Scene UUID / ID override", type: "text", default: "", noPin: true },
      { key: "runFor", label: "Run on", type: "select", default: "local", noPin: true,
        options: [{ value: "local", label: "Current client" }, { value: "gm", label: "Active GM only" }] }
    ], compilePin: token
  }, { owner: OWNER });
}

globalThis.Hooks?.once?.("ready", () => registerLifecycleNodes());
