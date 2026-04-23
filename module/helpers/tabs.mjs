export class TabManager {

  /**
   * Wire click listeners and apply initial active state.
   * Call from _onRender(). Safe to call multiple times -- re-wires cleanly.
   * @param {ApplicationV2} app
   */
  static activate(app) {
    const root = app.element;
    if (!root) return;

    // Collect all groups that exist in this sheet
    const groups = new Set();
    root.querySelectorAll("[data-tab][data-group]").forEach(el => {
      groups.add(el.dataset.group);
    });

    groups.forEach(group => {
      // Wire click on all nav links for this group
      root.querySelectorAll(`[data-group="${group}"][data-tab]`).forEach(link => {
        // Only wire nav <a> / <button> links (not content sections)
        const tag = link.tagName.toLowerCase();
        if (tag !== "a" && tag !== "button") return;

        // Remove old listener by cloning (simplest safe reset)
        const fresh = link.cloneNode(true);
        link.replaceWith(fresh);
        fresh.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          const tabId = fresh.dataset.tab;
          TabManager._switch(app, root, group, tabId);
        });
      });

      // Apply initial active state from app.tabGroups
      const current = app.tabGroups?.[group];
      if (current) {
        TabManager._applyActive(root, group, current);
      } else {
        // If no tabGroups set, activate whatever link already has .active
        const activeLink = root.querySelector(`[data-group="${group}"][data-tab].active`);
        if (activeLink) TabManager._applyActive(root, group, activeLink.dataset.tab);
      }
    });
  }

  static _switch(app, root, group, tabId) {
    if (app.tabGroups) app.tabGroups[group] = tabId;
    TabManager._applyActive(root, group, tabId);
  }

  static _applyActive(root, group, tabId) {
    // Nav links: <a data-group="X" data-tab="Y">
    root.querySelectorAll(`[data-group="${group}"][data-tab]`).forEach(el => {
      const tag = el.tagName.toLowerCase();
      if (tag === "a" || tag === "button") {
        el.classList.toggle("active", el.dataset.tab === tabId);
      }
    });

    // Content sections: elements with BOTH data-group and data-tab
    // that are NOT nav links (i.e. sections/divs)
    root.querySelectorAll(`[data-group="${group}"][data-tab]`).forEach(el => {
      const tag = el.tagName.toLowerCase();
      if (tag !== "a" && tag !== "button") {
        el.classList.toggle("active", el.dataset.tab === tabId);
      }
    });
  }
}
