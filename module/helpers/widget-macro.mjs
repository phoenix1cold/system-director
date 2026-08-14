import { FormulaEngine } from "./formula-engine.mjs";

function _utf8ToBase64(value) {
  const bytes = new TextEncoder().encode(String(value ?? ""));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function _base64ToUtf8(value) {
  const binary = atob(String(value ?? ""));
  const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeMacroScript(script) {
  return _utf8ToBase64(script);
}

export function decodeMacroScript(buttonOrValue) {
  const dataset = buttonOrValue?.dataset ?? {};
  const encoded = dataset.copyMacroB64 ?? (typeof buttonOrValue === "string" ? buttonOrValue : "");
  if (encoded) {
    try { return _base64ToUtf8(encoded); } catch (error) { console.warn("SD | Could not decode macro payload", error); }
  }
  const legacy = String(dataset.copyMacro ?? "");
  // Old releases stored literal \\n separators in the HTML attribute.
  return legacy.includes("\\n") && !legacy.includes("\n") ? legacy.replace(/\\n/g, "\n") : legacy;
}

export function buildWidgetMacroScript(config = {}) {
  const payload = JSON.stringify(config, null, 2);
  return [
    "// System Director widget macro",
    'const { WidgetMacroRunner } = await import("/systems/sd/module/helpers/widget-macro.mjs");',
    `await WidgetMacroRunner.run(${payload});`
  ].join("\n");
}

function _isActor(document) {
  return document?.documentName === "Actor" || document?.constructor?.name?.includes?.("Actor");
}

function _isItem(document) {
  return document?.documentName === "Item" || document?.constructor?.name?.includes?.("Item");
}

async function _resolveSource(uuid) {
  if (!uuid || typeof globalThis.fromUuid !== "function") return null;
  try { return await globalThis.fromUuid(uuid); } catch { return null; }
}

function _selectedActor(source = null) {
  return globalThis.token?.actor
    ?? globalThis.canvas?.tokens?.controlled?.[0]?.actor
    ?? globalThis.game?.user?.character
    ?? source?.actor
    ?? (_isActor(source) ? source : null)
    ?? null;
}

async function _runActions(actions, item, actor, label) {
  const { ButtonExecutor } = await import("./button-executor.mjs");
  const runtime = {};
  const button = { label: String(label ?? "Macro") };
  for (const action of actions) {
    await ButtonExecutor._runAction(action, item ?? { system: {}, actor }, actor, button, runtime);
  }
  return runtime;
}

export class WidgetMacroRunner {
  static async run(config = {}) {
    const source = await _resolveSource(config.sourceUuid);
    const actor = _selectedActor(source);
    const item = _isItem(source) ? source : null;
    const context = item ?? actor;
    if (!context) {
      globalThis.ui?.notifications?.warn?.("System Director: select a token or assign a character first.");
      return null;
    }

    let actionSource = config.actions ?? config.onClickFormula ?? "";
    if (Array.isArray(actionSource)) return _runActions(actionSource, item, actor, config.flavor);
    if (typeof actionSource === "string" && actionSource.trim().startsWith("[")) {
      try {
        const actions = JSON.parse(actionSource);
        if (Array.isArray(actions)) return _runActions(actions, item, actor, config.flavor);
      } catch (error) {
        console.error("SD | Invalid widget action macro", error);
        globalThis.ui?.notifications?.error?.("System Director: invalid widget action macro.");
        return null;
      }
    }

    let rawFormula = String(config.formula ?? "").trim();
    if (typeof config.onClickFormula === "string" && config.onClickFormula.trim() && !config.onClickFormula.trim().startsWith("[")) {
      rawFormula = config.onClickFormula.trim();
    }

    if (config.kind === "skill") {
      if (!actor) {
        globalThis.ui?.notifications?.warn?.("System Director: a Skill macro requires an Actor.");
        return null;
      }
      const rank = Number(globalThis.foundry?.utils?.getProperty?.(actor, String(config.path ?? ""))) || 0;
      let bonus = rank + (Number(config.attrMod) || 0);
      if (String(config.modValueFormula ?? "").trim()) {
        const evaluated = Number(FormulaEngine.evaluate(String(config.modValueFormula), actor));
        if (Number.isFinite(evaluated)) bonus = evaluated;
      }
      if (!rawFormula) rawFormula = `1d20+(${bonus})`;
    }

    if (!rawFormula) rawFormula = "1d20";
    if (rawFormula.startsWith("[")) {
      try {
        const actions = JSON.parse(rawFormula);
        if (Array.isArray(actions)) return _runActions(actions, item, actor, config.flavor);
      } catch {}
    }

    let formula = rawFormula;
    try { formula = FormulaEngine.resolveForRoll(rawFormula, context) || rawFormula; } catch {}
    const rollData = {
      ...(actor?.getRollData?.() ?? {}),
      ...(item?.system ? { item: item.system } : {})
    };
    try {
      const roll = new Roll(formula, rollData);
      await roll.evaluate();
      await roll.toMessage({
        speaker: ChatMessage.getSpeaker({ actor: actor ?? item?.actor ?? null }),
        flavor: String(config.flavor ?? config.label ?? "Roll")
      });
      return roll;
    } catch (error) {
      console.error("SD | Widget macro failed", error, { config, formula });
      globalThis.ui?.notifications?.error?.(`System Director: macro failed (${error?.message ?? error}).`);
      return null;
    }
  }
}
