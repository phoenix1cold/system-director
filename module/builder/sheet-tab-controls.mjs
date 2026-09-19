/** Resolve nested icon clicks before switching the surrounding tab. */
export function wireSheetTabClick(element, sheet, tabId) {
  element.addEventListener("click", event => {
    const control = event.target.closest?.("[data-rename],[data-deltab]");
    if (control && element.contains(control)) {
      event.preventDefault(); event.stopPropagation();
      if (control.hasAttribute("data-rename")) sheet._renameTab(tabId);
      else sheet._deleteTab(tabId);
      return;
    }
    sheet._switchTab(tabId);
  });
}
