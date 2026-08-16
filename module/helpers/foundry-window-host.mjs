const api = globalThis.foundry?.applications?.api ?? {};
const ApplicationV2 = api.ApplicationV2 ?? class ApplicationV2Fallback {
  constructor(options={}) { this.options=options; this.rendered=false; this.element=null; }
  async render() { this.rendered=true; return this; }
  async close() { this.rendered=false; this.element?.remove?.(); return this; }
};

const OPEN_HOSTS = new Map();

/**
 * A small ApplicationV2 bridge for legacy editors which already build their
 * own DOM tree. The tree is mounted inside a real Foundry window so it gains
 * native focus, z-order, movement, resize and minimize/detach behaviour.
 */
export class SDFoundryWindowHost extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    classes: ["sd", "sd-foundry-window-host"],
    window: {
      title: "System Director",
      icon: "fa-solid fa-window-maximize",
      resizable: true,
      minimizable: true
    },
    position: { width: 720, height: 640 }
  };

  constructor({ id, title="System Director", icon="fa-solid fa-window-maximize", width=720, height=640,
    minWidth=320, minHeight=240, classes=[], content=null, onClose=null }={}) {
    const safeId = String(id || `sd-window-${Math.random().toString(36).slice(2,9)}`)
      .replace(/[^a-zA-Z0-9_-]/g,"-");
    super({
      id: safeId,
      classes: ["sd", "sd-foundry-window-host", ...classes],
      window: { title, icon, resizable:true, minimizable:true },
      position: { width, height }
    });
    this._sdId = safeId;
    this._sdTitle = title;
    this._sdContent = content;
    this._sdOnClose = onClose;
    this._sdMinWidth = minWidth;
    this._sdMinHeight = minHeight;
    this._sdClosed = false;
  }

  get title() { return this._sdTitle; }

  async _renderHTML() {
    return `<div class="sd-foundry-window-slot" style="width:100%;height:100%;min-width:0;min-height:0;display:flex;flex-direction:column;overflow:hidden"></div>`;
  }

  _replaceHTML(html, content) {
    content.innerHTML = html;
    content.style.padding = "0";
    content.style.overflow = "hidden";
    content.style.display = "flex";
    content.style.flexDirection = "column";
    content.style.minWidth = "0";
    content.style.minHeight = "0";
    const slot = content.querySelector(".sd-foundry-window-slot") ?? content;
    if (this._sdContent) slot.appendChild(this._sdContent);
    const frame = content.closest?.(".window-app,.application");
    if (frame) {
      frame.style.minWidth = `${this._sdMinWidth}px`;
      frame.style.minHeight = `${this._sdMinHeight}px`;
    }
  }

  async close(options={}) {
    if (!this._sdClosed) {
      this._sdClosed = true;
      OPEN_HOSTS.delete(this._sdId);
      if (!options?.sdSkipCallback) {
        try { await this._sdOnClose?.(); } catch (error) { console.warn("SD | Foundry window close callback failed", error); }
      }
    }
    return super.close(options);
  }
}

export function openFoundryWindow(options={}) {
  const id = String(options.id || `sd-window-${Math.random().toString(36).slice(2,9)}`)
    .replace(/[^a-zA-Z0-9_-]/g,"-");
  const previous = OPEN_HOSTS.get(id);
  if (previous) previous.close({ sdSkipCallback:true }).catch?.(()=>{});
  const app = new SDFoundryWindowHost({ ...options, id });
  OPEN_HOSTS.set(id, app);
  app.render(true);
  return app;
}

export function closeFoundryWindow(id, options={}) {
  return OPEN_HOSTS.get(String(id))?.close(options);
}

export function getFoundryWindow(id) {
  return OPEN_HOSTS.get(String(id)) ?? null;
}
