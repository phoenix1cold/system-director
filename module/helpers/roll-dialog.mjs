const { DialogV2 } = foundry.applications.api;

function _sdMsgMode() {
  try {
    const v = game.settings.get("core", "messageMode");
    if (v) return v;
  } catch {}
  try { return game.settings.get("core", "rollMode"); } catch {}
  return "publicroll";
}

export class SdRollDialog {

  static async prompt({ actor, title, formula = "1d20", label = "" } = {}) {
    const parsed = SdRollDialog.parseFormula(formula);

    const renderTpl = foundry.applications?.handlebars?.renderTemplate
      ?? foundry.utils.fetchJsonWithTimeout  // fallback guard
      ?? renderTemplate;

    const rollModes = Object.entries(CONFIG.Dice.rollModes ?? {}).map(([key, val]) => ({
      value: key,
      label: (typeof val === "object" ? val.label : val) ?? key
    }));

    const content = await (foundry.applications?.handlebars?.renderTemplate ?? renderTemplate)(
      "systems/sd/templates/dialog/roll-dialog.hbs",
      {
        formula,
        quantity:    parsed.quantity,
        die:         parsed.die,
        bonus:       parsed.bonus,
        diceTypes:   CONFIG.SD.diceTypes,
        rollModes,
        currentMode: _sdMsgMode(),
        label
      }
    );

    const result = await DialogV2.prompt({
      window: { title },
      content,
      ok: {
        label:    game.i18n.localize("SD.Roll.label"),
        icon:     "fa-dice",
        callback: (event, button, dialog) => {
          const form = button.form;
          return {
            quantity:    parseInt(form.quantity?.value ?? parsed.quantity),
            die:         form.die?.value ?? parsed.die,
            bonus:       parseInt(form.bonus?.value ?? 0) || 0,
            situational: parseInt(form.situational?.value ?? 0) || 0,
            rollMode:    form.rollMode?.value ?? _sdMsgMode()
          };
        }
      },
      rejectClose: false
    });

    if (!result) return null;

    const { quantity, die, bonus, situational, rollMode } = result;
    const totalBonus  = bonus + situational;
    const bonusPart   = totalBonus !== 0 ? (totalBonus > 0 ? `+${totalBonus}` : `${totalBonus}`) : "";
    const builtFormula = `${quantity}${die}${bonusPart}`;

    const roll = new Roll(builtFormula, actor?.getRollData?.() ?? {});
    await roll.evaluate();
    await roll.toMessage({
      speaker:  ChatMessage.getSpeaker({ actor }),
      flavor:   label || title,
      rollMode
    });

    return roll;
  }

  static parseFormula(formula) {
    if (!formula || typeof formula !== "string") return { quantity: 1, die: "d20", bonus: 0 };
    const match = formula.match(/^(\d+)(d\d+)([+-]\d+)?$/i);
    if (!match) return { quantity: 1, die: "d20", bonus: 0 };
    return {
      quantity: parseInt(match[1]) || 1,
      die:      match[2].toLowerCase(),
      bonus:    parseInt(match[3] ?? 0) || 0
    };
  }
}
