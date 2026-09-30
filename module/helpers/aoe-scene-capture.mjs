// Capture AOE Region presets with Foundry's own Region tools.
//
// Foundry VTT v14 ships a "Measured Template Mode" toggle on the Region layer:
// every shape drawn becomes its own Region with measurements enabled. Instead of
// re-implementing a drawing surface, `captureAoeFromScene()` switches the scene
// controls to that mode, watches the Regions created while a small companion
// panel is open, and turns them into the same portable presets the
// "AOE Template Saver" node and the Database `aoe_template(s)` types use.
import { openFoundryWindow } from "./foundry-window-host.mjs";
import { normalizeAoePreset, snapshotRegionDocument, openAoePresetEditor } from "./aoe-preset-editor.mjs";

const esc = value => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const randomId = () => (globalThis.foundry?.utils?.randomID?.(10) ?? Math.random().toString(36).slice(2, 12));
const SHAPE_TOOLS = ["circle", "rectangle", "ellipse", "cone", "line", "polygon"];

function regionTools() {
  return globalThis.ui?.controls?.controls?.regions?.tools ?? {};
}

/** Key of the Measured Template Mode toggle in the Region controls, if present. */
function findTemplateToggle() {
  const tools = regionTools();
  for (const [key, tool] of Object.entries(tools)) {
    if (!tool?.toggle) continue;
    const title = String(tool.title ?? "");
    const text = `${key} ${title} ${globalThis.game?.i18n?.localize?.(title) ?? ""}`.toLowerCase();
    if (/template/.test(text)) return key;
  }
  return ["templateMode", "measuredTemplate", "template"].find(key => tools[key]) ?? null;
}

function firstShapeTool() {
  const tools = regionTools();
  return SHAPE_TOOLS.find(key => tools[key])
    ?? Object.keys(tools).find(key => !tools[key]?.toggle && key !== "select" && key !== "clear")
    ?? "select";
}

async function activateTemplateMode() {
  const layer = globalThis.canvas?.regions;
  const controls = globalThis.ui?.controls;
  const prev = {
    control: controls?.control?.name ?? null,
    tool: controls?.tool?.name ?? null,
    templateMode: !!layer?.templateMode
  };
  try { layer?.activate?.(); } catch {}
  const toggleKey = findTemplateToggle();
  const tool = firstShapeTool();
  try {
    const options = { control: "regions", tool };
    if (toggleKey && !layer?.templateMode) options.toggles = { [toggleKey]: true };
    await controls?.activate?.(options);
  } catch (error) {
    console.warn("SD | Could not activate the Region controls:", error);
  }
  return { prev, toggleKey, templateModeActive: !!layer?.templateMode };
}

async function restoreControls(prev, toggleKey) {
  const controls = globalThis.ui?.controls;
  if (!controls) return;
  try {
    if (toggleKey && prev && !prev.templateMode && globalThis.canvas?.regions?.templateMode) {
      await controls.activate?.({ control: "regions", toggles: { [toggleKey]: false } });
    }
    if (prev?.control && prev.control !== "regions") await controls.activate?.({ control: prev.control, tool: prev.tool ?? undefined });
    else if (prev?.tool) await controls.activate?.({ control: "regions", tool: prev.tool });
  } catch {}
}

/**
 * Draw AOE presets with the Region layer tools of the current scene.
 * @param {object|object[]|null} value  Existing preset or preset list.
 * @param {object} options `{ multiple, title }`
 * @returns {Promise<object|object[]|null>} preset (or array when `multiple`) or null on cancel.
 */
export async function captureAoeFromScene(value = null, options = {}) {
  const multiple = !!options.multiple;
  const canvasRef = globalThis.canvas;
  if (!canvasRef?.ready || !canvasRef.scene || !canvasRef.regions) {
    globalThis.ui?.notifications?.info?.("No active scene: opening the grid editor instead.");
    return openAoePresetEditor(value, options);
  }
  const scene = canvasRef.scene;
  const initial = Array.isArray(value) ? value : (value && typeof value === "object" && Object.keys(value).length ? [value] : []);
  const kept = initial.map(normalizeAoePreset).filter(preset => preset.shapes?.length);
  const drawn = [];
  const state = { cleanup: true };
  const { prev, toggleKey, templateModeActive } = await activateTemplateMode();

  return new Promise(resolve => {
    let settled = false;
    let app = null;
    const hooks = [];
    const on = (name, fn) => { const id = Hooks.on(name, fn); hooks.push([name, id]); };
    const finish = async result => {
      if (settled) return;
      settled = true;
      for (const [name, id] of hooks) { try { Hooks.off(name, id); } catch {} }
      if (state.cleanup && drawn.length) {
        const ids = drawn.map(entry => entry.id).filter(id => scene.regions?.has?.(id));
        if (ids.length) { try { await scene.deleteEmbeddedDocuments("Region", ids); } catch (error) { console.warn("SD | AOE capture cleanup failed:", error); } }
      }
      await restoreControls(prev, toggleKey);
      resolve(result);
      await app?.close?.({ sdSkipCallback: true });
    };

    const root = document.createElement("div");
    root.className = "sd-aoe-capture";
    const entries = () => [...kept.map(preset => ({ preset, saved: true })), ...drawn.map(entry => ({ preset: entry.preset, saved: false, id: entry.id }))];
    const nextName = () => `Template ${kept.length + drawn.length + 1}`;

    const render = () => {
      const list = entries();
      root.innerHTML = `
        <div class="sdac-hint ${templateModeActive ? "" : "is-warn"}">
          <i class="fas ${templateModeActive ? "fa-draw-polygon" : "fa-triangle-exclamation"}"></i>
          <div>
            ${templateModeActive
              ? `<b>Measured Template Mode is on.</b> Draw the area${multiple ? "s" : ""} with the Region tools on the left (circle, square, cone, line, polygon). Every shape you finish appears below.`
              : `<b>Turn on Measured Template Mode</b> on the Region toolbar (left), then draw the area${multiple ? "s" : ""}. Finished shapes appear below.`}
            <small>Shapes are saved relative to their centre, so the preset is placed under the cursor by <b>Place AOE Template</b>.</small>
          </div>
        </div>
        <div class="sdac-list">
          ${list.length ? list.map((entry, index) => `
            <div class="sdac-item ${entry.saved ? "is-saved" : "is-new"}" data-index="${index}">
              <span class="sdac-swatch" style="--c:${esc(/^#[0-9a-f]{6}$/i.test(entry.preset.appearance?.color ?? "") ? entry.preset.appearance.color : "#ff0000")}"></span>
              <input class="sdac-name" data-name="${index}" value="${esc(entry.preset.name)}" placeholder="Template name">
              <span class="sdac-meta">${entry.preset.shapes.length} shape${entry.preset.shapes.length === 1 ? "" : "s"} · ${entry.saved ? "saved" : "drawn now"}</span>
              ${entry.id ? `<button type="button" class="sdac-icon" data-select="${index}" title="Select this Region on the scene"><i class="fas fa-location-crosshairs"></i></button>` : ""}
              <button type="button" class="sdac-icon danger" data-remove="${index}" title="Remove from the list${entry.id ? " and from the scene" : ""}"><i class="fas fa-xmark"></i></button>
            </div>`).join("")
          : `<div class="sdac-empty"><i class="fas fa-bullseye"></i>Nothing captured yet. Draw on the scene, or select an existing Region and press <b>Add selected</b>.</div>`}
        </div>
        <label class="sdac-option"><input type="checkbox" data-cleanup ${state.cleanup ? "checked" : ""}> Remove the drawn Regions from the scene when done</label>
        <div class="sdac-foot">
          <button type="button" class="sdac-btn" data-add-selected title="Add the Region(s) currently selected on the scene"><i class="fas fa-object-group"></i> Add selected</button>
          <button type="button" class="sdac-btn" data-grid title="Draw on an abstract grid instead of the scene"><i class="fas fa-border-all"></i> Grid editor</button>
          <span class="sdac-spacer"></span>
          <button type="button" class="sdac-btn" data-cancel>Cancel</button>
          <button type="button" class="sdac-btn primary" data-save><i class="fas fa-check"></i> Save</button>
        </div>`;
      bind();
    };

    const bind = () => {
      root.querySelectorAll("[data-name]").forEach(input => input.addEventListener("input", () => {
        const entry = entries()[Number(input.dataset.name)];
        if (entry) entry.preset.name = input.value;
      }));
      root.querySelectorAll("[data-remove]").forEach(button => button.addEventListener("click", async () => {
        const index = Number(button.dataset.remove);
        if (index < kept.length) kept.splice(index, 1);
        else {
          const [entry] = drawn.splice(index - kept.length, 1);
          if (entry && scene.regions?.has?.(entry.id)) { try { await scene.deleteEmbeddedDocuments("Region", [entry.id]); } catch {} }
        }
        render();
      }));
      root.querySelectorAll("[data-select]").forEach(button => button.addEventListener("click", () => {
        const entry = entries()[Number(button.dataset.select)];
        const placeable = entry?.id ? canvasRef.regions?.get?.(entry.id) : null;
        try { placeable?.control?.({ releaseOthers: true }); } catch {}
      }));
      root.querySelector("[data-cleanup]")?.addEventListener("change", event => { state.cleanup = !!event.target.checked; });
      root.querySelector("[data-add-selected]")?.addEventListener("click", () => {
        const selected = canvasRef.regions?.controlled ?? [];
        if (!selected.length) { globalThis.ui?.notifications?.warn?.("Select a Region on the scene first."); return; }
        let added = 0;
        for (const placeable of selected) {
          const doc = placeable?.document;
          if (!doc || drawn.some(entry => entry.id === doc.id)) continue;
          const preset = snapshotRegionDocument(doc);
          if (!preset) continue;
          if (!multiple) { kept.splice(0, kept.length); drawn.splice(0, drawn.length); }
          kept.push(preset); added++;
          if (!multiple) break;
        }
        if (!added) globalThis.ui?.notifications?.warn?.("The selected Region has no shapes.");
        render();
      });
      root.querySelector("[data-grid]")?.addEventListener("click", async () => {
        const current = entries().map(entry => entry.preset);
        const result = await openAoePresetEditor(multiple ? current : (current[0] ?? null), { multiple, title: options.title });
        if (result === null || result === undefined) return;
        finish(result);
      });
      root.querySelector("[data-cancel]")?.addEventListener("click", () => finish(null));
      root.querySelector("[data-save]")?.addEventListener("click", () => {
        const out = entries().map(entry => {
          const preset = normalizeAoePreset(entry.preset);
          preset.t = preset.shapes.length === 1 ? String(preset.shapes[0].type) : "region";
          return preset;
        }).filter(preset => preset.shapes.length);
        if (!out.length) { globalThis.ui?.notifications?.warn?.("Draw at least one shape."); return; }
        finish(multiple ? out : out[out.length - 1]);
      });
    };

    on("createRegion", doc => {
      if (settled || doc?.parent?.id !== scene.id) return;
      const preset = snapshotRegionDocument(doc);
      if (!preset) return;
      if (!doc.name || /^(Region|New Region)\s*\d*$/i.test(doc.name)) preset.name = nextName();
      if (!multiple) {
        kept.splice(0, kept.length);
        const old = drawn.splice(0, drawn.length);
        if (state.cleanup) for (const entry of old) { if (scene.regions?.has?.(entry.id)) scene.deleteEmbeddedDocuments("Region", [entry.id]).catch(() => {}); }
      }
      drawn.push({ id: doc.id, preset });
      render();
    });
    on("updateRegion", doc => {
      if (settled) return;
      const entry = drawn.find(item => item.id === doc.id);
      if (!entry) return;
      const preset = snapshotRegionDocument(doc);
      if (!preset) return;
      preset.name = entry.preset.name;
      entry.preset = preset;
      render();
    });
    on("deleteRegion", doc => {
      if (settled) return;
      const index = drawn.findIndex(item => item.id === doc.id);
      if (index >= 0) { drawn.splice(index, 1); render(); }
    });

    render();
    app = openFoundryWindow({
      id: `sd-aoe-capture-${randomId()}`,
      title: options.title ?? (multiple ? "Draw AOE templates" : "Draw AOE template"),
      icon: "fa-solid fa-bullseye",
      width: 420, height: 440, minWidth: 340, minHeight: 320,
      classes: ["sd-aoe-capture-window"],
      content: root,
      onClose: () => finish(null)
    });
  });
}
