import { deletionUpdate } from "./foundry-compat.mjs";

const SCOPES = new Set(["sd", "sd-improved-trading"]);
const UNSAFE_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function flagPath(scope, key) {
  // Only the system's historical namespaces are supported. This is not a
  // general-purpose way to access flags belonging to inactive third parties.
  if (!SCOPES.has(scope)) throw new Error(`Unsupported SD flag scope: ${scope}`);
  if (typeof key !== "string" || !key || key.split(".").some(part => !part || UNSAFE_KEYS.has(part))) {
    throw new Error("Invalid SD flag key");
  }
  return `flags.${scope}.${key}`;
}

/**
 * Access SD's persisted flag namespaces independently of the installed package
 * id. Lite and embedded Trading still own their legacy data, but Foundry's flag
 * convenience methods reject those namespaces when the old package is inactive.
 * Keep the storage paths (also used by effects, formulas and existing worlds),
 * and use normal Document.update: hooks, validation and server-side permissions
 * are unchanged. No prototype patch, scope registration or data migration.
 */
export function sdFlags(document) {
  return {
    getFlag(scope, key) {
      flagPath(scope, key);
      // flags is a schema-backed accessor on real Foundry documents, not
      // necessarily an own property of the Document instance.
      return [scope, ...key.split(".")].reduce((value, part) =>
        value != null && Object.hasOwn(value, part) ? value[part] : undefined, document?.flags);
    },
    async setFlag(scope, key, value) {
      const path = flagPath(scope, key);
      if (value === undefined) throw new Error("SD flag value must not be undefined");
      if (!document) return undefined;
      if (value === null) return this.unsetFlag(scope, key);
      return document.update({ [path]: value });
    },
    async unsetFlag(scope, key) {
      const path = flagPath(scope, key);
      if (!document) return undefined;
      const dot = path.lastIndexOf(".");
      return document.update(deletionUpdate(path.slice(0, dot), path.slice(dot + 1)));
    }
  };
}
