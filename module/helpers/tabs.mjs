export class TabManager {

  /**
   * Wire click listeners and apply initial active state.
   * Call from _onRender(). Safe to call multiple times -- re-wires cleanly.
   * @param {ApplicationV2} app
   */
  static activate(app) {
    const root = app.element;
    if (!root) return;

    const groups = new Set();
    root.querySelectorAll("[data-tab][data-group]").forEach(el => {
      groups.add(el.dataset.group);
    });

    groups.forEach(group => {
      root.querySelectorAll(`[data-group="${group}"][data-tab]`).forEach(link => {
        const tag = link.tagName.toLowerCase();
        if (tag !== "a" && tag !== "button") return;

        const fresh = link.cloneNode(true);
        link.replaceWith(fresh);
        fresh.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          const tabId = fresh.dataset.tab;
          TabManager._switch(app, root, group, tabId);
        });
      });

      const current = app.tabGroups?.[group];
      if (current) {
        TabManager._applyActive(root, group, current);
      } else {
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
    root.querySelectorAll(`[data-group="${group}"][data-tab]`).forEach(el => {
      const tag = el.tagName.toLowerCase();
      if (tag === "a" || tag === "button") {
        el.classList.toggle("active", el.dataset.tab === tabId);
      }
    });

    root.querySelectorAll(`[data-group="${group}"][data-tab]`).forEach(el => {
      const tag = el.tagName.toLowerCase();
      if (tag !== "a" && tag !== "button") {
        el.classList.toggle("active", el.dataset.tab === tabId);
      }
    });
  }
}
