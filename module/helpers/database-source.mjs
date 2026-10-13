/** Resolve a Database read document. A connected Ref overrides the selector. */
export function resolveDatabaseSource(doc, source = "self", ref = "", itemId = "") {
  const uuid = value => { try { return globalThis.fromUuidSync?.(value) ?? null; } catch { return null; } };
  const actor = doc?.documentName === "Actor" ? doc : doc?.actor ?? (doc?.parent?.documentName === "Actor" ? doc.parent : null);
  const lookupItem = value => actor?.items?.get?.(value) ?? actor?.items?.find?.(item => [item.id,item.uuid,item.name].includes(value)) ?? null;
  const lookup = value => uuid(value) ?? globalThis.canvas?.tokens?.get?.(value)?.actor ?? lookupItem(value)
    ?? globalThis.game?.actors?.get?.(value) ?? globalThis.game?.items?.get?.(value)
    ?? globalThis.game?.actors?.getName?.(value) ?? globalThis.game?.items?.getName?.(value) ?? null;
  if (ref && typeof ref === "object") return ref.documentName === "Token" ? ref.actor : ref;
  if (ref) { const resolved = lookup(String(ref).trim()); return resolved?.documentName === "Token" ? resolved.actor : resolved; }
  switch (source) {
    case "actor": return actor;
    case "item": return doc?.documentName === "Item" ? doc : lookupItem(String(itemId || ref));
    case "owned item": return lookupItem(String(itemId || ref));
    case "first target": return globalThis.game?.user?.targets?.first?.()?.actor ?? globalThis.canvas?.tokens?.controlled?.[0]?.actor ?? null;
    case "token by id": return globalThis.canvas?.tokens?.get?.(String(ref))?.actor ?? null;
    case "by uuid": return uuid(String(ref));
    default: return doc;
  }
}
