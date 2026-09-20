/**
 * Return the explicit button which owns a sheet-widget click.
 *
 * The sheet cell itself is only layout. Labels, images, inputs and empty space
 * must not raise On Click. Card Hand and the 3D viewer dispatch their own more
 * specific events, so their controls are deliberately excluded here.
 */
export function sheetWidgetClickControl(root, event) {
  const target = event?.target;
  if (!root || !(target instanceof Element)) return null;
  const control = target.closest("button, input[type='button'], input[type='submit'], input[type='reset'], [role='button']");
  if (!control || !root.contains(control)) return null;
  if (control.matches(":disabled") || control.getAttribute("aria-disabled") === "true") return null;
  if (control.closest("[data-cardhand], .sd-model-widget")) return null;
  if (control.closest("[data-action='wbElement']")) return null;
  if (control.closest(".sd-img-pick, .widget-copy-macro, [data-copy-macro-b64]")) return null;
  return control;
}
