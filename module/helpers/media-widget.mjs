import { readVariablePath, updateVariablePaths } from "./variable-binding.mjs";
import { collectSheetWidgets, emitSheetWidgetEvent } from "./sheet-widget-events.mjs";
import { resolveVariableReference, writeDatabaseValue } from "./value-database.mjs";

export const mediaEnabled = value => value === true || value === "true";
export function isVideoMedia(src) {
  return /\.(webm|mp4|m4v|ogv|ogg|mov)(?:[?#]|$)/i.test(String(src ?? "")) || /^data:video\//i.test(String(src ?? ""));
}
export function mediaSource(widget, doc) {
  return String((widget.path ? readVariablePath(doc, widget.path) : widget.staticSrc) ?? "");
}
export function mediaFilePickerClass() {
  const picker = globalThis.foundry?.applications?.apps?.FilePicker;
  return picker?.implementation ?? picker ?? globalThis.FilePicker;
}
export function mediaPickerType(FP = mediaFilePickerClass()) {
  const types = FP?.TYPES;
  return types && !(Array.isArray(types) ? types.includes("imagevideo") : "imagevideo" in types) ? "any" : "imagevideo";
}

/** Bind by the media's own id, not the enclosing layout cell (nested widgets). */
export function bindMediaWidgets(root, doc, { disabled = () => false } = {}) {
  for (const media of root.querySelectorAll("[data-sd-media]")) {
    if (media._sdMediaBound) continue;
    media._sdMediaBound = true;
    const find = () => collectSheetWidgets(doc).find(w => String(w.id) === media.dataset.sdMedia);
    const permitted = () => !disabled() && !!(doc?.isOwner || globalThis.game?.user?.isGM);
    const notify = (widget, event, value) => emitSheetWidgetEvent(doc, {
      event, value, widgetId: String(widget.id ?? ""), widgetKey: String(widget.widgetKey ?? widget.id ?? ""),
      widgetLabel: String(widget.label ?? ""), widgetType: "image", documentUuid: String(doc.uuid ?? ""),
      sourceUuid: String(doc.uuid ?? ""), actorId: String((doc.documentName === "Item" ? doc.actor : doc)?.id ?? "")
    });
    media.querySelector(".sd-media-pick")?.toggleAttribute("hidden", !permitted());
    media.addEventListener("click", async event => {
      if (disabled()) return;
      const widget = find();
      if (!widget) return;
      if (event.target.closest("video") && !mediaEnabled(widget.replaceOnClick)) return;
      const explicit = !!event.target.closest(".sd-media-pick");
      if (!explicit) await notify(widget, "click", mediaSource(widget, doc));
      if (!permitted() || (!explicit && !mediaEnabled(widget.replaceOnClick))) return;
      event.preventDefault();
      const FP = mediaFilePickerClass();
      if (!FP) return;
      new FP({ type: mediaPickerType(FP), current: mediaSource(widget, doc), callback: async src => {
        const current = find();
        if (!permitted() || !current || !String(src ?? "").trim()) return;
        if (String(current.path ?? "").startsWith("sdvar:")) {
          const resolved = resolveVariableReference(current.path, { document: doc });
          if (!resolved || resolved.kind === "missing") return;
          if (!globalThis.game?.user?.isGM && (resolved.kind === "world" || !resolved.document?.isOwner)) return;
          if (!await writeDatabaseValue(doc, current.path, src)) return;
        } else if (current.path) await updateVariablePaths(doc, { [current.path]: src });
        else {
          const tabs = foundry.utils.deepClone(doc.system.customTabs ?? []);
          const copy = collectSheetWidgets({ system: { customTabs: tabs } }).find(w => String(w.id) === String(current.id));
          if (!copy) return;
          copy.staticSrc = src;
          await doc.update({ "system.customTabs": tabs });
        }
        // Same-document commits already dispatch change through the shared hooks.
        const { widgetCommitEventsInstalled } = await import("./sheet-widget-commits.mjs");
        const boundOwner = String(current.path ?? "").startsWith("sdvar:")
          ? resolveVariableReference(current.path, { document: doc })?.document : doc;
        if (!widgetCommitEventsInstalled() || boundOwner !== doc) await notify(current, "change", src);
      } }).render(true);
    });
  }
}
