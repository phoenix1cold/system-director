/** Restore the enclosing loop even when an awaited body fails. */
export async function withLoopContext(runtime, keys, body) {
  const saved = keys.map(key => [key, Object.hasOwn(runtime, key), runtime[key]]);
  try { return await body(); }
  finally {
    for (const [key, existed, value] of saved) {
      if (existed) runtime[key] = value;
      else delete runtime[key];
    }
  }
}

/** Actual/JSON arrays retain objects, commas, null and falsy elements.
 * Only legacy plain text is interpreted as a comma-separated list.
 */
export function loopItems(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  let raw = value.trim();
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (typeof parsed === "string") raw = parsed;
  } catch { /* legacy CSV */ }
  return raw.split(",").map(entry => entry.trim()).filter(Boolean);
}
