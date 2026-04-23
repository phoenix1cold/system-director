/**
 * aura-sync.mjs -- legacy shim (no-op).
 *
 * Originally drove MeasuredTemplate-based auras.  MeasuredTemplate has been
 * merged into the Region document in Foundry v14, and our Aura pipeline now
 * runs on native Scene Regions with a simple updateToken hook defined in
 * sd-region.mjs.  This file is kept so external imports don't break; its
 * runtime initialiser is a deliberate no-op.
 */

export const AuraSync = {
  init() { /* no-op — Region-based aura sync lives in sd-region.mjs */ }
};
