import { readDatabaseValue, writeDatabaseValue } from "./value-database.mjs";

/** Keep qualified owner/database references intact until the actual read/write. */
export function readVariablePath(doc, path) {
  return String(path ?? "").startsWith("sdvar:") ? readDatabaseValue(doc, path) : foundry.utils.getProperty(doc, path);
}

export async function updateVariablePaths(doc, patch) {
  const ordinary = {};
  for (const [path, value] of Object.entries(patch)) {
    if (path.startsWith("sdvar:")) {
      if (!await writeDatabaseValue(doc, path, value)) ui.notifications?.warn?.("The selected Database variable has no matching object to update.");
    } else ordinary[path] = value;
  }
  if (Object.keys(ordinary).length) return doc.update(ordinary);
}
