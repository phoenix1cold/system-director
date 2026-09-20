import { uniqueId } from "../helpers/unique-id.mjs";
const label = (en, ru) => globalThis.game?.i18n?.lang === "ru" ? ru : en;
const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

export function renderModelWidget(w) {
  const height = Math.max(180, Math.min(1000, Number(w.viewportHeight) || 280));
  const config = { src:w.src || "", previewMode:!!w.previewMode, background:w.background || "#182131", backgroundOpacity:w.backgroundOpacity ?? 1, hotspots:w.hotspots ?? [], widgetKey:w.widgetKey || w.id, widgetId:w.id };
  return `<div class="widget widget-model3d">
    ${w.label ? `<span class="widget-label">${escape(w.label)}</span>` : ""}
    <div class="sd-model-widget" data-model-config="${escape(JSON.stringify(config))}" style="height:${height}px" tabindex="0" aria-label="${escape(w.label || "3D Object")}">
      <div class="sd-model-poster">${w.previewImage ? `<img src="${escape(w.previewImage)}" alt="${escape(w.label || "3D Object")}">` : '<i class="fas fa-cube" aria-hidden="true"></i>'}
      <span role="status">${escape(!config.src ? label("Choose a 3D model in widget settings", "Выберите 3D-модель в настройках виджета") : config.previewMode ? label("Hover or focus to view 3D", "Наведите курсор для просмотра 3D") : label("Loading 3D…", "Загрузка 3D…"))}</span></div>
      <div class="sd-model-widget-host"></div>
    </div></div>`;
}

export function captureModelPreview(viewer) {
  if (!viewer?.renderer || viewer.disposed) return "";
  try {
    viewer.renderer.render(viewer.scene, viewer.camera);
    return viewer.renderer.domElement.toDataURL("image/png");
  } catch { return ""; }
}

/** Bind after rendering. Import Three.js only when this widget actually needs 3D. */
export function bindModelWidgets(root, doc, {disabled = () => false} = {}) {
  for (const element of root.querySelectorAll(".sd-model-widget")) {
    if (element._sdModelBinding || disabled()) continue;
    const config = JSON.parse(element.dataset.modelConfig);
    const host = element.querySelector(".sd-model-widget-host");
    const poster = element.querySelector(".sd-model-poster");
    const status = poster.querySelector('[role="status"]');
    const abort = new AbortController();
    const later = callback => (globalThis.requestAnimationFrame ?? (fn => setTimeout(fn,0)))(callback);
    let viewer, generation = 0, disposed = false, active = false;
    const restore = () => { host.hidden = true; poster.hidden = false; };
    const unload = () => {
      generation++;
      const src = captureModelPreview(viewer);
      if (src) {
        let img = poster.querySelector("img");
        if (!img) { img = document.createElement("img"); img.alt = "3D Object"; poster.prepend(img); }
        img.src = src;
        poster.querySelector("i")?.remove();
      }
      viewer?.dispose(); viewer = null; active = false; restore();
    };
    const dispose = () => { if (disposed) return; disposed = true; unload(); abort.abort(); observer.disconnect(); };
    const observer = new MutationObserver(() => { if (!element.isConnected) dispose(); });
    observer.observe(document.body, {childList:true, subtree:true});
    const load = async () => {
      if (disposed || active || disabled() || !config.src) return;
      active = true;
      const token = ++generation;
      status.textContent = label("Loading 3D…", "Загрузка 3D…");
      try {
        const {openModelViewer, getModelViewer} = await import("./model-viewer.mjs");
        if (disposed || token !== generation || disabled()) { if (token === generation) active = false; return; }
        const viewerId = `widget-${config.widgetKey}-${uniqueId()}`;
        const opening = openModelViewer({
          ...config, viewerId, container:host, editPoints:false, document:doc,
          onFullscreenChange: enabled => { if(!enabled)later(maybeUnload); },
          onInteraction: async payload => {
            if (disabled()) return;
            const {runModelInteraction} = await import("./model-events.mjs");
            await runModelInteraction(doc, {...payload, widgetKey:config.widgetKey, widgetId:config.widgetId});
          }
        });
        const instance = viewer = getModelViewer(viewerId); host.hidden = false;
        await opening;
        if (disposed || token !== generation) { instance.dispose(); return; }
        poster.hidden = true;
      } catch (error) {
        if (disposed || token !== generation) return;
        viewer?.dispose(); viewer = null; active = false; restore();
        status.textContent = String(error.message ?? error);
      }
    };
    const maybeUnload = () => {
      if (!config.previewMode || element.matches(":hover") || viewer?.fullscreen || element.contains(document.activeElement)) return;
      unload(); status.textContent = label("Hover or focus to view 3D", "Наведите курсор для просмотра 3D");
    };
    element._sdModelBinding = {dispose, get viewer() { return viewer; }};
    element.addEventListener("pointerenter", () => void load(), {signal:abort.signal});
    element.addEventListener("pointerleave", () => later(maybeUnload), {signal:abort.signal});
    element.addEventListener("focusin", () => void load(), {signal:abort.signal});
    element.addEventListener("focusout", () => later(maybeUnload), {signal:abort.signal});
    // Orbiting and toolbar buttons should not activate surrounding sheet controls.
    for (const event of ["click", "dblclick", "pointerdown"]) element.addEventListener(event, e => e.stopPropagation(), {signal:abort.signal});
    restore();
    if (!config.previewMode) void load();
  }
}
