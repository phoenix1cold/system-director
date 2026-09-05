const DEFERRED_RUNTIME_TOKENS = new Set([
  // Keep Roll Result late-bound inside Message Composer button branches.
  // The branch can create a newer roll before Present Roll consumes it.
  "{__rollResult}"
]);

/**
 * Prepare a deferred Message Composer action branch for ChatMessage flags.
 *
 * Most runtime references are materialized when the card is posted so the
 * button keeps the values visible at that moment. Roll Result is different:
 * it must remain a token because a button branch may roll again and then pass
 * the new result to Present Roll.
 */
export function materializeDeferredActionSnapshot(value, resolveRuntime, depth = 0) {
  if (depth > 12 || value === null || value === undefined) return value;

  if (typeof value === "string") {
    if (DEFERRED_RUNTIME_TOKENS.has(value) || /\{__messageField:[A-Za-z0-9_-]+\}/.test(value)) return value;
    return resolveRuntime(value);
  }

  if (Array.isArray(value)) {
    return value.map(entry => materializeDeferredActionSnapshot(entry, resolveRuntime, depth + 1));
  }

  if (typeof value === "object") {
    const out = {};
    for (const [key, entry] of Object.entries(value)) {
      if (typeof entry === "function") continue;
      out[key] = materializeDeferredActionSnapshot(entry, resolveRuntime, depth + 1);
    }
    return out;
  }

  return value;
}
