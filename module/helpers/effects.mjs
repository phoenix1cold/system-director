/**
 * Prepare the effects list for a sheet, sorted by category.
 * @param {Actor|Item} doc
 * @returns {object[]}
 */
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

export const EFFECT_PATHS = {
  // Attributes
  "system.attributes.attr1.value": "SD.Attributes.attr1",
  "system.attributes.attr2.value": "SD.Attributes.attr2",
  "system.attributes.attr3.value": "SD.Attributes.attr3",
  "system.attributes.attr4.value": "SD.Attributes.attr4",
  "system.attributes.attr5.value": "SD.Attributes.attr5",
  "system.attributes.attr6.value": "SD.Attributes.attr6",

  // Defense
  "system.defense.armor":  "SD.Defense.Armor",
  "system.defense.bonus":  "SD.Defense.Bonus",
  "system.defense.total":  "SD.Defense.Total",

  // Resources
  "system.resources.hp.max":      "SD.Resources.HPMax",
  "system.resources.hp.value":    "SD.Resources.HPValue",
  "system.resources.mp.max":      "SD.Resources.MPMax",
  "system.resources.mp.value":    "SD.Resources.MPValue",
  "system.resources.stamina.max": "SD.Resources.StaminaMax",

  // Movement
  "system.movement.walk":  "SD.Movement.Walk",
  "system.movement.fly":   "SD.Movement.Fly",
  "system.movement.swim":  "SD.Movement.Swim",
  "system.movement.climb": "SD.Movement.Climb",

  // Initiative
  "system.initiative.bonus": "SD.Initiative.Bonus",

  // Advancement
  "system.advancement.proficiencyBonus": "SD.Advancement.ProficiencyBonus"
};
