import { GridManager } from "./grid-manager.mjs";

let activeDrag = null;

function clearDropState(nav) {
  nav?.querySelectorAll?.(".sd-tab-drop-before, .sd-tab-drop-after")?.forEach?.(tab => {
    tab.classList.remove("sd-tab-drop-before", "sd-tab-drop-after");
  });
}

export class SheetTabReorder {
  static attach(sheet, tabElement, tabId) {
    const editable = sheet?.isEditable ?? sheet?.document?.isOwner ?? false;
    if (!sheet?._editMode || !editable || !tabElement || !tabId) return;

    tabElement.classList.add("sd-tab-sortable");
    const handle = document.createElement("i");
    handle.className = "fas fa-grip-vertical sd-tab-drag-handle";
    handle.draggable = true;
    handle.tabIndex = 0;
    handle.setAttribute("role", "button");
    const moveLabel = game.i18n?.localize?.("SD.Sheets.MoveTab") ?? "Move tab";
    const dragHint = game.i18n?.localize?.("SD.Sheets.DragTab") ?? "Drag to reorder tab";
    handle.setAttribute("aria-label", moveLabel === "SD.Sheets.MoveTab" ? "Move tab" : moveLabel);
    handle.title = dragHint === "SD.Sheets.DragTab" ? "Drag to reorder tab" : dragHint;
    tabElement.prepend(handle);

    handle.addEventListener("click", event => event.stopPropagation());
    handle.addEventListener("dragstart", event => {
      event.stopPropagation();
      activeDrag = { documentUuid:sheet.document.uuid, tabId };
      tabElement.classList.add("sd-tab-dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", JSON.stringify({
        sdType:"moveTab",
        documentUuid:sheet.document.uuid,
        tabId
      }));
    });
    handle.addEventListener("dragend", () => {
      activeDrag = null;
      tabElement.classList.remove("sd-tab-dragging");
      clearDropState(tabElement.closest(".sd-tab-nav"));
    });
    handle.addEventListener("keydown", async event => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      event.stopPropagation();
      await GridManager.shiftTab(sheet.document, tabId, event.key === "ArrowLeft" ? -1 : 1);
    });

    tabElement.addEventListener("dragover", event => {
      if (!activeDrag || activeDrag.documentUuid !== sheet.document.uuid || activeDrag.tabId === tabId) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      clearDropState(tabElement.closest(".sd-tab-nav"));
      const bounds = tabElement.getBoundingClientRect();
      const placement = event.clientX < bounds.left + bounds.width / 2 ? "before" : "after";
      tabElement.classList.add(placement === "before" ? "sd-tab-drop-before" : "sd-tab-drop-after");
    });
    tabElement.addEventListener("dragleave", event => {
      if (event.relatedTarget && tabElement.contains(event.relatedTarget)) return;
      tabElement.classList.remove("sd-tab-drop-before", "sd-tab-drop-after");
    });
    tabElement.addEventListener("drop", async event => {
      if (!activeDrag || activeDrag.documentUuid !== sheet.document.uuid || activeDrag.tabId === tabId) return;
      event.preventDefault();
      event.stopPropagation();
      const bounds = tabElement.getBoundingClientRect();
      const placement = event.clientX < bounds.left + bounds.width / 2 ? "before" : "after";
      const draggedId = activeDrag.tabId;
      activeDrag = null;
      clearDropState(tabElement.closest(".sd-tab-nav"));
      await GridManager.moveTab(sheet.document, draggedId, tabId, placement);
    });
  }
}
