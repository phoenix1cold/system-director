import { getValueDefinitions, valueStoragePath } from "./value-database.mjs";

export function prepareActiveEffectCategories(doc) {
  const categories = {
    temporary: {
      type:   "temporary",
      label:  game.i18n.localize("SD.Effects.Temporary"),
      effects: []
    },
    passive: {
      type:   "passive",
      label:  game.i18n.localize("SD.Effects.Passive"),
      effects: []
    },
    inactive: {
      type:   "inactive",
      label:  game.i18n.localize("SD.Effects.Inactive"),
      effects: []
    }
  };

  for (const effect of doc.allApplicableEffects?.() ?? doc.effects) {
    effect.sourceName;
    if (effect.disabled) {
      categories.inactive.effects.push(effect);
    } else if (effect.isTemporary) {
      categories.temporary.effects.push(effect);
    } else {
      categories.passive.effects.push(effect);
    }
  }

  return Object.values(categories);
}

/**
 * Effect targets.
 *
 * Everything an effect can modify is a Database variable, so the target list is
 * built from the Database at runtime instead of a hardcoded table. The legacy
 * table below is only kept as a fallback for very old worlds that still store
 * raw `system.*` keys inside their effects.
 */
export const LEGACY_EFFECT_PATHS = {
  "system.attributes.attr1.value": "SD.Attributes.attr1",
  "system.attributes.attr2.value": "SD.Attributes.attr2",
  "system.attributes.attr3.value": "SD.Attributes.attr3",
  "system.attributes.attr4.value": "SD.Attributes.attr4",
  "system.attributes.attr5.value": "SD.Attributes.attr5",
  "system.attributes.attr6.value": "SD.Attributes.attr6",
  "system.defense.armor":  "SD.Defense.Armor",
  "system.defense.bonus":  "SD.Defense.Bonus",
  "system.defense.total":  "SD.Defense.Total",
  "system.resources.hp.max":      "SD.Resources.HPMax",
  "system.resources.hp.value":    "SD.Resources.HPValue",
  "system.resources.mp.max":      "SD.Resources.MPMax",
  "system.resources.mp.value":    "SD.Resources.MPValue",
  "system.resources.stamina.max": "SD.Resources.StaminaMax",
  "system.movement.walk":  "SD.Movement.Walk",
  "system.movement.fly":   "SD.Movement.Fly",
  "system.movement.swim":  "SD.Movement.Swim",
  "system.movement.climb": "SD.Movement.Climb",
  "system.initiative.bonus": "SD.Initiative.Bonus",
  "system.advancement.proficiencyBonus": "SD.Advancement.ProficiencyBonus"
};

/** Every Database variable an effect can target: `{ path: label }`. */
export function effectTargetPaths() {
  const out = {};
  try {
    for (const definition of getValueDefinitions()) {
      out[valueStoragePath(definition.id)] = definition.name ?? definition.id;
    }
  } catch (error) {
    console.warn("SD | could not read Database variables for effects", error);
  }
  return Object.keys(out).length ? out : { ...LEGACY_EFFECT_PATHS };
}

/** Variable descriptors for effect UIs: `[{ id, name, type, path }]`. */
export function effectTargetVariables() {
  try {
    return getValueDefinitions().map(definition => ({
      id: definition.id,
      name: definition.name ?? definition.id,
      type: definition.type ?? "number",
      path: valueStoragePath(definition.id)
    }));
  } catch {
    return [];
  }
}

/** Human label for one effect change, resolved through the Database. */
export function effectChangeLabel(change = {}) {
  const key = String(change.key ?? "");
  const variable = effectTargetVariables().find(entry => entry.path === key || entry.id === change.variableId);
  const label = variable?.name ?? LEGACY_EFFECT_PATHS[key] ?? key;
  const modes = { 0: "custom", 1: "×", 2: "+", 3: "↓", 4: "↑", 5: "=" };
  return { label, symbol: modes[Number(change.mode ?? 2)] ?? "+", value: String(change.value ?? "") };
}

/** Backwards compatible alias: still consumed by `game.system.api.effectPaths`. */
export const EFFECT_PATHS = LEGACY_EFFECT_PATHS;
