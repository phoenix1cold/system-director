/**
 * Foundry VTT v14 compatibility helpers.
 *
 * 1) Forced deletion keys.
 *    v14 deprecates the legacy `"parent.-=key": null` syntax in favour of
 *    `foundry.data.operators.ForcedDeletion`. Every SD update that removes a
 *    dynamic ObjectField key (graph events, spell slots, widget paths) must go
 *    through `deletionUpdate()` so the system stays warning-free on v14 while
 *    still working on older cores.
 *
 * 2) DialogV2 form reads.
 *    DialogV2 renders its content inside its own <form> element. A nested
 *    <form> in the content string is dropped by the HTML parser, so
 *    `button.form.elements.<name>` becomes `undefined` and the callback throws
 *    "Cannot read properties of undefined (reading 'value')". These helpers
 *    resolve the real form (or the application root) and never throw.
 */

/** True when the running core exposes the v14 deletion operator. */
export function supportsForcedDeletion() {
  try {
    return typeof globalThis.foundry?.data?.operators?.ForcedDeletion === "function";
  } catch {
    return false;
  }
}

/** A fresh ForcedDeletion operator instance, or `undefined` on older cores. */
export function forcedDeletion() {
  try {
    const Operator = globalThis.foundry?.data?.operators?.ForcedDeletion;
    if (typeof Operator === "function") return new Operator();
  } catch {}
  return undefined;
}

/**
 * Build an update payload that removes one or more keys from an object field.
 *
 * @param {string} parentPath  Dot path of the owning object, e.g. "system.sdTriggerGraph".
 * @param {string|string[]} keys  Key(s) to remove inside that object.
 * @returns {object} Update data. Empty object when there is nothing to delete.
 *
 * @example
 * await doc.update(deletionUpdate("system.sdTriggerGraph", ["_trigger", "_events"]));
 */
export function deletionUpdate(parentPath, keys) {
  const list = (Array.isArray(keys) ? keys : [keys])
    .map(key => String(key ?? "").trim())
    .filter(Boolean);
  if (!list.length) return {};
  const parent = String(parentPath ?? "").replace(/^\.+|\.+$/g, "");
  if (supportsForcedDeletion()) {
    const nested = {};
    for (const key of list) nested[key] = forcedDeletion();
    return parent ? { [parent]: nested } : nested;
  }
  const legacy = {};
  for (const key of list) legacy[parent ? `${parent}.-=${key}` : `-=${key}`] = null;
  return legacy;
}

/** Merge several deletionUpdate() payloads for the same parent object. */
export function mergeDeletionUpdates(...payloads) {
  const out = {};
  for (const payload of payloads) {
    if (!payload || typeof payload !== "object") continue;
    for (const [key, value] of Object.entries(payload)) {
      if (value && typeof value === "object" && !Array.isArray(value) && out[key] && typeof out[key] === "object" && !Array.isArray(out[key])) {
        Object.assign(out[key], value);
      } else {
        out[key] = value;
      }
    }
  }
  return out;
}

/** Resolve the <form> (or closest usable root) for a DialogV2 button callback. */
export function dialogForm(event, button) {
  const candidates = [
    button?.form,
    typeof button?.closest === "function" ? button.closest("form") : null,
    event?.currentTarget?.querySelector?.("form"),
    typeof button?.closest === "function" ? button.closest(".application")?.querySelector?.("form") : null,
    typeof button?.closest === "function" ? button.closest(".application") : null,
    event?.currentTarget ?? null
  ];
  for (const candidate of candidates) if (candidate) return candidate;
  return null;
}

/** Resolve a single named control inside a DialogV2, tolerating nested forms. */
export function dialogElement(event, button, name) {
  const key = String(name ?? "");
  if (!key) return null;
  const scopes = [
    button?.form,
    typeof button?.closest === "function" ? button.closest("form") : null,
    typeof button?.closest === "function" ? button.closest(".application") : null,
    event?.currentTarget ?? null,
    dialogForm(event, button)
  ];
  for (const scope of scopes) {
    if (!scope) continue;
    const viaElements = scope.elements?.[key];
    if (viaElements) {
      if (typeof viaElements.item === "function" && typeof viaElements.length === "number") {
        return viaElements.item(0) ?? null;
      }
      return viaElements;
    }
    let viaQuery = null;
    try {
      viaQuery = scope.querySelector?.(`[name="${key.replace(/"/g, '\\"')}"]`) ?? null;
    } catch {
      viaQuery = null;
    }
    if (viaQuery) return viaQuery;
  }
  return null;
}

/** Read one value out of a DialogV2 form. Checkboxes return booleans. */
export function dialogValue(event, button, name, fallback = "") {
  const element = dialogElement(event, button, name);
  if (!element) return fallback;
  if (element.type === "checkbox") return !!element.checked;
  if (element.type === "number") {
    const raw = String(element.value ?? "").trim();
    if (!raw) return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  const value = element.value;
  return value === undefined || value === null ? fallback : value;
}

/** Read a text value and trim it. */
export function dialogText(event, button, name, fallback = "") {
  const value = dialogValue(event, button, name, fallback);
  return typeof value === "string" ? value.trim() : String(value ?? "").trim();
}

/**
 * Read several values at once.
 *
 * @example
 * const data = dialogValues(event, button, { name: "", valueType: "any", muted: false });
 */
export function dialogValues(event, button, spec = {}) {
  const out = {};
  for (const [name, fallback] of Object.entries(spec)) out[name] = dialogValue(event, button, name, fallback);
  return out;
}
