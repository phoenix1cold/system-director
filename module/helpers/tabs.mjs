/**
 * module/helpers/tabs.mjs
 *
 * Reliable tab manager for Foundry v13 ApplicationV2 with PARTS rendering.
 *
 * In PARTS mode each template part (header, tabs, attributes, inventory…)
 * renders into its own separate wrapper div inside .window-content.
 * The <nav> from "tabs" part and the <section> from "attributes" part are
 * SIBLINGS inside .window-content -- not parent/child.
 *
 * TabManager queries the whole sheet element (window root) for both
 * nav links and content sections, so it works regardless of DOM nesting.
 */

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

  /**
   * Programmatically switch to a tab.
   */
  static _switch(app, root, group, tabId) {
    if (app.tabGroups) app.tabGroups[group] = tabId;
    TabManager._applyActive(root, group, tabId);
  }

  /**
   * Apply .active to matching nav links and content sections,
   * remove .active from all others in the same group.
   */
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
