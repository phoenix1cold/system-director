let sequence = 0;

/** Non-secret UI/instance identifiers, including Foundry served over plain HTTP. */
export function uniqueId() {
  try { if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID(); } catch {}
  try { if (typeof globalThis.foundry?.utils?.randomID === "function") return globalThis.foundry.utils.randomID(24); } catch {}
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    return [...globalThis.crypto.getRandomValues(new Uint8Array(16))].map(n=>n.toString(16).padStart(2,"0")).join("");
  }
  return `${Date.now().toString(36)}-${(++sequence).toString(36)}-${Math.random().toString(36).slice(2)}`;
}
