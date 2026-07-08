import { SlotManager } from "../data/item-slots.mjs";
import { formulaBounds, doubleDice, leadingD20Natural } from "../builder/formula-utils.mjs";
import { AutoanimationsIntegration } from "../integrations/autoanimations.mjs";
import { durationForRounds } from "./effect-duration.mjs";
import { SDDialogueBuilder } from "./dialogue-builder.mjs";
import {
  addActorAIInteraction,
  addActorAIMemory,
  buildAIDialogueContext,
  getAIProviderConfig,
  requestAIChat
} from "./ai-context.mjs";

function _writeRollMeta(buttonDef, {
  roll, formula,
  critOn = 20, critFormula = "", isCritOverride = null,
  fumbleOn = 1, fumbleFormula = "", isFumbleOverride = null,
  rollData = {}
} = {}) {
  if (!buttonDef) return;
  try {
    const f = String(formula ?? "");
    const b = formulaBounds(f, rollData ?? {});
    buttonDef.__lastFormula = f;
    buttonDef.__lastMin     = b.min;
    buttonDef.__lastMax     = b.max;
    buttonDef.__lastAvg     = b.avg;
    const nat = leadingD20Natural(roll);
    buttonDef.__lastNatural = nat ?? 0;
    const _truthy = (v) => v === true || v === 1 || v === "1" || v === "yes" || v === "true";
    let isCrit;
    if (isCritOverride !== null && isCritOverride !== undefined && isCritOverride !== "") {
      isCrit = _truthy(isCritOverride) ? 1 : 0;
    } else {
      const thr = Number(critOn) || 20;
      isCrit = (nat != null && nat >= thr) ? 1 : 0;
    }
    let isFumble;
    if (isFumbleOverride !== null && isFumbleOverride !== undefined && isFumbleOverride !== "") {
      isFumble = _truthy(isFumbleOverride) ? 1 : 0;
    } else {
      const thr = Number(fumbleOn);
      isFumble = (Number.isFinite(thr) && nat != null && nat <= thr) ? 1 : 0;
    }

    if (isCrit && isFumble && (isCritOverride == null || isCritOverride === "")) isFumble = 0;
    buttonDef.__lastIsCrit  = isCrit;
    buttonDef.__lastIsFumble = isFumble;
    buttonDef.__lastCritFormula = critFormula && String(critFormula).trim() !== ""
      ? String(critFormula)
      : doubleDice(f);
    buttonDef.__lastFumbleFormula = fumbleFormula && String(fumbleFormula).trim() !== ""
      ? String(fumbleFormula)
      : "";

    try {
      const dice = [];
      for (const d of (roll?.dice ?? [])) {
        for (const r of (d?.results ?? [])) {
          if (r && r.active !== false && !r.discarded) dice.push(Number(r.result));
        }
      }
      buttonDef.__lastDice = dice.join(",");
    } catch { buttonDef.__lastDice = ""; }
  } catch (e) {
    console.warn("SD | _writeRollMeta failed:", e);
  }
}

function _sdMsgMode() {
  try {
    const v = game.settings.get("core", "messageMode");
    if (v) return v;
  } catch {}
  try { return game.settings.get("core", "rollMode"); } catch {}
  return "publicroll";
}

const SD_AI_DIALOGUE_MARKER = "{__sdAiDialogueChoices:";

function _sdStripQuotedString(value) {
  if (typeof value !== "string") return value;
  const s = value.trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    try {
      const parsed = JSON.parse(s);
      if (typeof parsed === "string") return parsed;
    } catch { return s.slice(1, -1); }
  }
  return value;
}

function _sdDecodeB64(value) {
  try {
    const bin = (typeof atob === "function")
      ? atob(value)
      : Buffer.from(value, "base64").toString("binary");
    try { return decodeURIComponent(escape(bin)); }
    catch { return bin; }
  } catch { return ""; }
}

function _sdParseAiDialogueConfig(raw) {
  if (raw == null || raw === "") return null;
  let s = String(_sdStripQuotedString(String(raw))).trim();
  if (!s) return null;
  if (s.startsWith(SD_AI_DIALOGUE_MARKER) && s.endsWith("}")) {
    const b64 = s.slice(SD_AI_DIALOGUE_MARKER.length, -1);
    try {
      const cfg = JSON.parse(_sdDecodeB64(b64));
      return cfg && typeof cfg === "object" ? cfg : null;
    } catch (e) {
      console.warn("SD | AI Dialogue Choices config decode failed:", e);
      return null;
    }
  }
  try {
    const cfg = JSON.parse(s);
    return cfg && typeof cfg === "object" ? cfg : null;
  } catch { return null; }
}

function _sdCleanAiJsonText(text) {
  let s = String(text ?? "").trim();
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) s = fence[1].trim();
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first >= 0 && last > first) return s.slice(first, last + 1);
  return s;
}

function _sdParseAiDialogueResponse(text, fallbackCount = 3) {
  const raw = String(text ?? "").trim();
  const max = Math.max(1, Math.min(12, Number(fallbackCount) || 3));
  let payload = null;
  try { payload = JSON.parse(_sdCleanAiJsonText(raw)); } catch { payload = null; }

  if (payload && typeof payload === "object") {
    let choices = payload.choices ?? payload.answers ?? payload.responses ?? payload.options ?? [];
    if (!Array.isArray(choices)) choices = [];
    choices = choices.map((c, i) => {
      if (c && typeof c === "object") {
        return {
          id: String(c.id ?? `ai${i + 1}`),
          label: String(c.label ?? c.text ?? c.answer ?? c.choice ?? c.value ?? `Choice ${i + 1}`),
          hint: String(c.hint ?? c.description ?? "")
        };
      }
      return { id: `ai${i + 1}`, label: String(c ?? `Choice ${i + 1}`), hint: "" };
    }).filter(c => c.label.trim() !== "");
    const requested = Number(payload.count ?? choices.length ?? max);
    const count = Math.max(1, Math.min(12, Number.isFinite(requested) ? requested : max));
    choices = choices.slice(0, count);
    return {
      dialogueText: String(payload.dialogueText ?? payload.text ?? payload.npc ?? payload.response ?? payload.message ?? ""),
      choices,
      continueDialogue: payload.continue ?? payload.continueDialogue ?? payload.infinity ?? (choices.length > 0),
      raw
    };
  }

  const lines = raw.split(/\r?\n/)
    .map(line => line.trim())
    .map(line => line.replace(/^\s*(?:[-*]|\d+[\).\]:-])\s*/, "").trim())
    .filter(Boolean);
  const choices = lines.slice(0, max).map((label, i) => ({ id: `ai${i + 1}`, label, hint: "" }));
  return {
    dialogueText: choices.length ? "" : raw,
    choices,
    continueDialogue: choices.length > 0,
    raw
  };
}

async function _sdRequestAiDialogueChoices(cfg, {
  baseText = "",
  latestAiText = "",
  history = [],
  selectedChoice = "",
  actor = null,
  item = null,
  speaker = "",
  resolveText = (s) => s
} = {}) {
  const run = (value) => {
    let s = String(_sdStripQuotedString(String(value ?? "")));
    try { s = String(resolveText(s)); } catch {}
    return s;
  };

  const provider = getAIProviderConfig({
    providerProfile: run(cfg.providerProfile || "dialogue"),
    url: run(cfg.url || ""),
    apiKey: run(cfg.apiKey || ""),
    apiKeySetting: run(cfg.apiKeySetting || ""),
    model: run(cfg.model || ""),
    temperature: cfg.temperature,
    maxTokens: cfg.maxTokens
  });
  const count = Math.max(1, Math.min(12, Number(run(cfg.choiceCount ?? cfg.count ?? 3)) || 3));

  const historyText = history.length
    ? history.map((h, i) => {
        const npc = h.ai ? `AI/NPC: ${h.ai}` : "";
        const user = h.user ? `Player: ${h.user}` : "";
        return `${i + 1}. ${[npc, user].filter(Boolean).join("\n")}`;
      }).join("\n\n")
    : "(empty)";
  const userInstruction = run(cfg.prompt || "");
  const aiContext = buildAIDialogueContext({
    actor,
    item,
    speaker: run(speaker || "")
  });
  const systemPrompt = [
    aiContext,
    run(cfg.systemPrompt || "You generate RPG dialogue choices for a Foundry VTT dialogue window."),
    "Return JSON only. No markdown.",
    "JSON schema: {\"dialogueText\":\"NPC or AI line shown in the dialogue window\",\"count\":3,\"choices\":[{\"id\":\"choice1\",\"label\":\"player response text\",\"hint\":\"optional short hint\"}],\"continue\":true}.",
    "The count must match the number of choices. If the conversation should end, return choices: [] and continue: false.",
    `Generate around ${count} concise player response choices unless the scene clearly needs fewer.`
  ].filter(Boolean).join("\n");
  const prompt = [
    userInstruction,
    "Current Dialogue Text / Description:",
    baseText || "(empty)",
    latestAiText ? `Latest AI/NPC response:\n${latestAiText}` : "",
    selectedChoice ? `Latest player choice:\n${selectedChoice}` : "",
    "Dialogue history:",
    historyText
  ].filter(Boolean).join("\n\n");

  const text = await requestAIChat({ provider, systemPrompt, prompt, json: true });
  return _sdParseAiDialogueResponse(text, count);
}

function _sdApplyAiDialogueChoices(action, aiResult) {
  const baseElements = (Array.isArray(action.elements) ? action.elements : [])
    .filter(el => el && !["button", "choice", "rollButton"].includes(String(el.type ?? "")));
  const choices = (aiResult?.choices ?? []).map((choice, i) => ({
    type: "rollButton",
    id: String(choice.id ?? `ai${i + 1}`),
    label: String(choice.label ?? `Choice ${i + 1}`),
    hint: String(choice.hint ?? ""),
    icon: "fas fa-comment-dots",
    emit: false
  }));
  return {
    ...action,
    description: aiResult?.dialogueText || action.description || "",
    elements: [...baseElements, ...choices],
    okLabel: choices.length ? (action.okLabel ?? "Continue") : "Continue"
  };
}

const { StringField, NumberField, BooleanField, ArrayField, ObjectField, SchemaField } = foundry.data.fields;

function _resolveNestedSlotParent(actor, item, slotPath) {
  if (!slotPath) return null;
  const parts = slotPath.split("/");
  if (parts.length < 2) return null;

  let current;
  const root = parts[0];
  if (root === "actor") {
    current = actor ?? null;
  } else if (root === "self") {
    current = item ?? actor ?? null;
  } else {
    current = actor?.items.get(root) ?? null;
    if (!current && item?.id === root) current = item;
  }
  if (!current) return null;

  if (parts.length === 2) {
    const isLive = typeof current?.update === "function";
    return { parent: current, slotId: parts[1], liveAncestor: isLive ? current : null, snapshotChain: [] };
  }

  const liveAncestor = typeof current?.update === "function" ? current : null;
  const snapshotChain = [];

  for (let i = 1; i + 1 < parts.length; i += 2) {
    const sid      = parts[i];
    const nestedId = parts[i + 1];
    const contents = current.system?.slotContents?.[sid]?.contents ?? [];
    CONFIG.debug?.sd && console.log("[SD|nested]",`  step [${i}] slotId="${sid}" nestedId="${nestedId}" contents.length=${contents.length}`, contents.map(c=>c._id??c.name));
    const snap     = contents.find(c => (c._id ?? c.id) === nestedId) ?? null;
    if (!snap) { console.warn("[SD|nested]",`  step [${i}] snapshot NOT FOUND for nestedId="${nestedId}" in slot "${sid}"`); return null; }
    CONFIG.debug?.sd && console.log("[SD|nested]",`  step [${i}] found snapshot:`, snap.name ?? snap._id);
    snapshotChain.push({ slotId: sid, itemId: nestedId });
    current = snap;
  }

  CONFIG.debug?.sd && console.log("[SD|nested]","_resolveNestedSlotParent result | parent:", current?.name ?? current?._id, "| slotId:", parts[parts.length-1], "| liveAncestor:", liveAncestor?.name ?? liveAncestor?.id, "| chain:", JSON.stringify(snapshotChain));
  return { parent: current, slotId: parts[parts.length - 1], liveAncestor, snapshotChain };
}

async function _nestedRemoveFromSlot(resolved, slotId, index) {
  const { parent, liveAncestor, snapshotChain } = resolved;
  const SM = (await import("../data/item-slots.mjs")).SlotManager;
  const actor = liveAncestor?.parent ?? liveAncestor?.actor ?? null;

  if (snapshotChain.length > 0 && actor) {
    const lastStep = snapshotChain[snapshotChain.length - 1];
    const liveParent = actor.items.get(lastStep.itemId) ?? null;
    if (liveParent) {
      CONFIG.debug?.sd && console.log("[SD|nested]", "_nestedRemoveFromSlot | via live item:", liveParent.name, "slot:", slotId, "index:", index);
      return SM.removeFromSlot(liveParent, slotId, index);
    }
  }

  if (typeof parent?.update === "function") {
    return SM.removeFromSlot(parent, slotId, index);
  }

  if (!liveAncestor) { console.error("SD | nestedRemoveFromSlot: no liveAncestor"); return; }
  const cloned = foundry.utils.deepClone(liveAncestor.system.slotContents ?? {});
  let node = cloned;
  for (const step of snapshotChain) {
    const snap = (node[step.slotId]?.contents ?? []).find(c => (c._id ?? c.id) === step.itemId);
    if (!snap) { console.error("SD | nestedRemoveFromSlot: snapshot not found at", step); return; }
    if (!snap.system) snap.system = {};
    if (!snap.system.slotContents) snap.system.slotContents = {};
    node = snap.system.slotContents;
  }
  if (!node[slotId]) { console.error("SD | nestedRemoveFromSlot: slot not found:", slotId); return; }
  const contents = node[slotId].contents ?? [];
  contents.splice(index, 1);
  node[slotId].contents = contents;
  node[slotId].count    = contents.length;
  await liveAncestor.update({ "system.slotContents": cloned });
}

async function _nestedAddToSlot(resolved, slotId, srcItem) {
  const { parent, liveAncestor, snapshotChain } = resolved;
  const SM = (await import("../data/item-slots.mjs")).SlotManager;
  const actor = liveAncestor?.parent ?? liveAncestor?.actor ?? null;

  if (snapshotChain.length > 0 && actor) {
    const lastStep = snapshotChain[snapshotChain.length - 1];
    const liveParent = actor.items.get(lastStep.itemId) ?? null;
    if (liveParent) {
      CONFIG.debug?.sd && console.log("[SD|nested]", "_nestedAddToSlot | via live item:", liveParent.name, "slot:", slotId);
      return SM.addToSlot(liveParent, slotId, srcItem);
    }
  }

  if (typeof parent?.update === "function") {
    return SM.addToSlot(parent, slotId, srcItem);
  }

  if (!liveAncestor) { console.error("SD | nestedAddToSlot: no liveAncestor"); return; }
  const cloned = foundry.utils.deepClone(liveAncestor.system.slotContents ?? {});
  let node = cloned;
  for (const step of snapshotChain) {
    const snap = (node[step.slotId]?.contents ?? []).find(c => (c._id ?? c.id) === step.itemId);
    if (!snap) { console.error("SD | nestedAddToSlot: snapshot not found at", step); return; }
    if (!snap.system) snap.system = {};
    if (!snap.system.slotContents) snap.system.slotContents = {};
    node = snap.system.slotContents;
  }
  if (!node[slotId]) node[slotId] = { contents: [], count: 0 };
  const itemData = srcItem instanceof Item ? srcItem.toObject() : foundry.utils.deepClone(srcItem);
  if (srcItem instanceof Item && srcItem.uuid) itemData._sourceUuid = srcItem.uuid;
  node[slotId].contents.push(itemData);
  node[slotId].count = node[slotId].contents.length;
  await liveAncestor.update({ "system.slotContents": cloned });
}

export function ButtonConditionField() {
  return new SchemaField({
    type:     new StringField({ initial: "always", blank: false }),
    field:    new StringField({ initial: "", blank: true }),

    operator: new StringField({ initial: ">", blank: false }),
    value:    new StringField({ initial: "0", blank: true }),
    slotId:   new StringField({ initial: "", blank: true }),
    minCount: new NumberField({ required: false, integer: true, initial: 0, nullable: true }),

    negate:   new BooleanField({ initial: false })
  });
}

export function ButtonActionField() {
  return new SchemaField({
    type:     new StringField({ initial: "roll", choices: ["roll","modifyField","createItem","removeItem","createItemArray","removeItemArray","playSound","runMacro","message"], blank: false }),

    formula:  new StringField({ initial: "1d6", blank: true }),
    flavor:   new StringField({ initial: "", blank: true }),
    rollMode: new StringField({ initial: "publicroll", blank: true }),

    target:   new StringField({ initial: "self.system.uses.value", blank: true }),
    delta:    new NumberField({ required: false, integer: false, initial: -1, nullable: true }),
    setValue: new StringField({ initial: "", blank: true }),
    clampMin: new NumberField({ required: false, integer: false, initial: null, nullable: true }),
    clampMax: new NumberField({ required: false, integer: false, initial: null, nullable: true }),

    itemName:     new StringField({ initial: "", blank: true }),
    itemType:     new StringField({ initial: "inventory", blank: true }),
    itemCategory: new StringField({ initial: "", blank: true }),
    itemData:     new ObjectField(),

    soundPath: new StringField({ initial: "", blank: true }),

    macroName: new StringField({ initial: "", blank: true }),

    messageText: new StringField({ initial: "", blank: true }),
    delay: new NumberField({ required: false, integer: true, initial: 0, nullable: true })
  });
}

export function ButtonDefinitionField() {
  return new SchemaField({
    id:       new StringField({ required: true, blank: false, initial: () => foundry.utils.randomID(8) }),
    label:    new StringField({ initial: "Action", blank: false }),
    icon:     new StringField({ initial: "fa-dice", blank: true }),
    color:    new StringField({ initial: "#7b68ee", blank: true }),
    tooltip:  new StringField({ initial: "", blank: true }),
    showIn:   new StringField({ initial: "inline", choices: ["inline","sheet","both"], blank: false }),
    conditions:   new ArrayField(ButtonConditionField()),
    actions: new ArrayField(ButtonActionField())
  });
}

export class ConditionEvaluator {

  static evaluate(button, item, actor) {
    if (!button.conditions?.length) return true;
    return button.conditions.every(c => {
      const result = this._evaluateOne(c, item, actor);
      return c.negate ? !result : result;
    });
  }

  static _evaluateOne(cond, item, actor) {
    switch (cond.type) {
      case "always":        return true;
      case "field":         return this._compareField(cond, this._resolveValue(cond.field, item, actor));
      case "actorField":    return this._compareField(cond, foundry.utils.getProperty(actor ?? {}, cond.field));
      case "slotHasItems":  return (SlotManager.getContents(item, cond.slotId)?.length ?? 0) >= (cond.minCount ?? 1);
      case "slotNotFull": {
        const def = SlotManager.getDefinition(item, cond.slotId);
        const cnt = SlotManager.getContents(item, cond.slotId)?.length ?? 0;
        return def ? cnt < def.maxCount : false;
      }
      default: return true;
    }
  }

  static _compareField(cond, actual) {
    const expected = isNaN(cond.value) ? cond.value : Number(cond.value);
    const a = typeof actual === "number" ? actual : Number(actual);
    switch (cond.operator) {
      case ">":  return a >  expected;
      case "<":  return a <  expected;
      case ">=": return a >= expected;
      case "<=": return a <= expected;
      case "==": return a == expected;
      case "!=": return a != expected;
      default:   return true;
    }
  }

  static _resolveValue(path, item, actor) {
    if (!path) return undefined;
    if (path.startsWith("actor."))  return foundry.utils.getProperty(actor ?? {}, path.slice(6));
    if (path.startsWith("slots."))  return SlotManager.resolveSlotPath(item, path);
    if (path.startsWith("self."))   return foundry.utils.getProperty(item, path.slice(5));
    return foundry.utils.getProperty(item, path);
  }
}

function _sdStripQuotes(s) {
  let out = String(s ?? "").trim();
  if (out.length >= 2 && out.startsWith('"') && out.endsWith('"')) out = out.slice(1, -1);
  return out;
}

function _sdResolveActor(spec, actor) {
  if (spec == null || spec === "") return null;
  if (spec instanceof Actor) return spec;
  if (typeof spec === "object") {
    if (spec.actor instanceof Actor) return spec.actor;
    if (typeof spec.uuid === "string") return _sdResolveActor(spec.uuid, actor);
  }
  const raw = _sdStripQuotes(spec);
  if (!raw || raw === "0") return null;

  if (raw === "self")           return actor ?? null;
  if (raw === "actor")          return actor ?? null;
  if (raw === "user_character") return game.user.character ?? null;
  if (raw === "token_target") {
    return game.user.targets?.first()?.actor
        ?? canvas?.tokens?.controlled?.[0]?.actor
        ?? actor ?? null;
  }
  if (raw === "selected_token") {
    return canvas?.tokens?.controlled?.[0]?.actor
        ?? game.user.targets?.first()?.actor
        ?? actor ?? null;
  }
  if (raw === "all_targets") {
    return [...(game.user.targets ?? [])][0]?.actor
        ?? canvas?.tokens?.controlled?.[0]?.actor
        ?? actor ?? null;
  }

  if (raw.includes(".") && /^[A-Za-z][A-Za-z0-9]*\./.test(raw)) {
    try {
      const doc = (typeof fromUuidSync === "function" ? fromUuidSync(raw) : null);
      if (doc) {
        if (doc instanceof Actor) return doc;
        if (doc.actor instanceof Actor) return doc.actor;
      }
    } catch {  }
  }

  if (/^[A-Za-z0-9]{16}$/.test(raw)) {
    const tok = canvas?.tokens?.get?.(raw);
    if (tok?.actor) return tok.actor;
    const a = game.actors?.get?.(raw);
    if (a) return a;
  }

  return null;
}

function _sdResolveActorsList(spec, actor) {
  if (spec == null || spec === "") return [];
  if (Array.isArray(spec)) {
    const out = [];
    for (const x of spec) {
      const a = _sdResolveActor(x, actor);
      if (a) out.push(a);
    }
    return out;
  }
  const raw = _sdStripQuotes(spec);
  if (!raw || raw === "0") return [];

  if (raw === "all_targets") {
    const tgt = [...(game.user.targets ?? [])].map(t => t.actor).filter(Boolean);
    if (tgt.length) return tgt;
    const sel = (canvas?.tokens?.controlled ?? []).map(t => t.actor).filter(Boolean);
    if (sel.length) return sel;
    return actor ? [actor] : [];
  }
  if (raw.startsWith("player_actors")) {
    return _resolvePlayerActors(raw);
  }

  if (raw.includes(",")) {
    const parts = raw.split(",").map(x => x.trim()).filter(Boolean);
    const out = [];
    for (const p of parts) {
      const a = _sdResolveActor(p, actor);
      if (a) out.push(a);
    }
    if (out.length) return out;
  }
  const single = _sdResolveActor(raw, actor);
  return single ? [single] : [];
}

function _resolveTarget(mode, actor) {

  const a = _sdResolveActor(mode, actor);
  if (a) return a;
  if (mode === "actor") return actor ?? null;
  const targeted = game.user.targets?.first()?.actor ?? null;
  const selected = canvas?.tokens?.controlled?.[0]?.actor ?? null;
  if (mode === "selected_token") return selected ?? targeted ?? actor ?? null;
  return targeted ?? selected ?? actor ?? null;
}

async function _sdResolveCards({ uuid, name } = {}) {
  if (uuid) { try { const d = await fromUuid(uuid); if (d) return d; } catch {} }
  if (name) {
    const byName = game.cards?.getName?.(name);
    if (byName) return byName;
  }
  return null;
}

async function _sdResolveCard(stack, action) {
  if (!stack) return null;
  const cards = stack.availableCards?.length ? stack.availableCards : Array.from(stack.cards ?? []);
  if (!cards.length) return null;
  const mode = action.cardSelector || (action.cardId ? "specific" : "top");
  if (mode === "specific" && action.cardId) {
    return stack.cards.get(action.cardId) ?? null;
  }
  if (mode === "by_name" && action.cardName) {
    return cards.find(c => c.name === action.cardName) ?? null;
  }
  if (mode === "random") return cards[Math.floor(Math.random() * cards.length)] ?? null;
  if (mode === "bottom") return cards[cards.length - 1] ?? null;
  if (mode === "first")  return cards[0] ?? null;

  return cards[0] ?? null;
}

function _resolveAllTargets(mode, actor) {
  const list = _sdResolveActorsList(mode, actor);
  if (list.length) return list;
  if (mode === "all_targets") {
    const targeted = [...(game.user.targets ?? [])].map(t => t.actor).filter(Boolean);
    if (targeted.length) return targeted;
    const selected = (canvas?.tokens?.controlled ?? []).map(t => t.actor).filter(Boolean);
    if (selected.length) return selected;
    return actor ? [actor] : [];
  }
  const single = _resolveTarget(mode ?? "token_target", actor);
  return single ? [single] : [];
}

function _resolvePlayerActors(spec) {
  const parts = String(spec).split(":");
  const onlineOnly = (parts[1] ?? "yes") === "yes";
  const includeGM  = (parts[2] ?? "no")  === "yes";
  const users = game.users.filter(u => {
    if (!includeGM && u.isGM) return false;
    if (onlineOnly && !u.active) return false;
    return true;
  });
  const seen = new Set();
  const actors = [];
  for (const u of users) {
    const a = u.character;
    if (!a) continue;
    if (seen.has(a.id)) continue;
    seen.add(a.id);
    actors.push(a);
  }
  return actors;
}

function _resistanceFactor(tActor, damageType) {
  if (!tActor || !damageType) return { factor: 1, label: "" };
  const key = String(damageType).toLowerCase().trim();
  if (!key) return { factor: 1, label: "" };

  const map = tActor.system?.resistances;
  if (map && typeof map === "object") {
    const raw = map[key] ?? map[damageType];
    if (raw !== undefined && raw !== null && raw !== "") {
      if (typeof raw === "number" || /^-?\d*\.?\d+$/.test(String(raw))) {
        const n = Number(raw);
        if (n === 0) return { factor: 0, label: "immune" };
        if (n < 1)  return { factor: n, label: `×${n}` };
        if (n > 1)  return { factor: n, label: `×${n}` };
        return { factor: 1, label: "" };
      }
      const s = String(raw).toLowerCase();
      if (s === "immune")           return { factor: 0,   label: "immune" };
      if (s === "resist" || s === "resistant")
                                    return { factor: 0.5, label: "resist" };
      if (s === "vulnerable")       return { factor: 2,   label: "vulnerable" };
      if (s === "normal")           return { factor: 1,   label: "" };
    }
  }

  const t = tActor.system?.traits ?? {};
  const has = (arr) => Array.isArray(arr) && arr.some(v => String(v).toLowerCase() === key);
  if (has(t.immunities))       return { factor: 0,   label: "immune" };
  if (has(t.resistances))      return { factor: 0.5, label: "resist" };
  if (has(t.vulnerabilities))  return { factor: 2,   label: "vulnerable" };

  return { factor: 1, label: "" };
}

function _savePassedVal(v) {
  if (v === true || v === "true" || v === "yes" || v === 1 || v === "1") return true;
  return false;
}

export class ButtonExecutor {

  static _buildRerollFlag(action, srcActor, formula, label) {
    if (!action || action.rerollEnabled !== "yes" && action.rerollEnabled !== true) return null;
    if (!formula) return null;
    const costPath   = String(action.rerollPath ?? "").trim();
    const costAmount = Number(action.rerollCost ?? 0) || 0;
    return {
      enabled:    true,
      formula,
      label:      label ?? "Re-roll",
      srcActorId: srcActor?.id ?? null,
      costPath,
      costAmount
    };
  }

  static async execute(button, item, actor) {
    if (!ConditionEvaluator.evaluate(button, item, actor)) {
      ui.notifications.warn(game.i18n.format("SD.Buttons.ConditionFailed", { label: button.label }));
      return;
    }

    try { AutoanimationsIntegration.playForItem(item, actor); } catch (e) { console.warn("SD | AutoAnimations trigger failed:", e); }

    const runtime = {};
    for (const action of (button.actions ?? [])) {
      if (action.delay > 0) await new Promise(r => setTimeout(r, action.delay));
      await this._runAction(action, item, actor, button, runtime);
    }
  }

  static async _runAction(action, item, actor, buttonDef = null, runtime = {}) {
    const _sanitizeRollData = (data) => Object.fromEntries(
      Object.entries(data ?? {}).map(([k, v]) =>
        [k, (typeof v === "string" && /^\s*\d*d\d+/i.test(v)) ? 0 : v]
      )
    );

    const _injectRuntime = (formula) => {
      if (typeof formula !== "string") return formula;
      if (buttonDef?.__placeableUuid !== undefined) {
        formula = formula.replace(/\{__sdSelfUuid\}/g, String(buttonDef.__placeableUuid));
      }
      if (buttonDef?.__interactableConfigUuid !== undefined) {
        formula = formula.replace(/\{__sdInteractableConfigUuid\}/g, String(buttonDef.__interactableConfigUuid));
      }
      if (buttonDef?.__interactableActorUuid !== undefined) {
        formula = formula.replace(/\{__sdInteractableActorUuid\}/g, String(buttonDef.__interactableActorUuid));
      }
      if (buttonDef?.__interactableActorName !== undefined) {
        formula = formula.replace(/\{__sdInteractableActorName\}/g, String(buttonDef.__interactableActorName));
      }
      if (buttonDef?.__interactableTokenName !== undefined) {
        formula = formula.replace(/\{__sdInteractableTokenName\}/g, String(buttonDef.__interactableTokenName));
      }
      if (buttonDef?.__interactableActorPortrait !== undefined) {
        formula = formula.replace(/\{__sdInteractableActorPortrait\}/g, String(buttonDef.__interactableActorPortrait));
      }
      if (buttonDef?.__interactableTokenImage !== undefined) {
        formula = formula.replace(/\{__sdInteractableTokenImage\}/g, String(buttonDef.__interactableTokenImage));
      }
      if (buttonDef?.__lastRoll !== undefined) {
        formula = formula.replace(/\{__lastRoll\}/g, String(buttonDef.__lastRoll));
      }
      if (buttonDef?.__lastMargin !== undefined) {
        formula = formula.replace(/\{__lastMargin\}/g, String(buttonDef.__lastMargin));
      }
      if (buttonDef?.__lastSuccesses !== undefined) {
        formula = formula.replace(/\{__lastSuccesses\}/g, String(buttonDef.__lastSuccesses));
      }
      if (buttonDef?.__lastBotches !== undefined) {
        formula = formula.replace(/\{__lastBotches\}/g, String(buttonDef.__lastBotches));
      }

      if (buttonDef?.__lastFormula !== undefined) {
        formula = formula.replace(/\{__lastFormula\}/g, String(buttonDef.__lastFormula));
      }
      if (buttonDef?.__lastMin !== undefined) {
        formula = formula.replace(/\{__lastMin\}/g, String(buttonDef.__lastMin));
      }
      if (buttonDef?.__lastMax !== undefined) {
        formula = formula.replace(/\{__lastMax\}/g, String(buttonDef.__lastMax));
      }
      if (buttonDef?.__lastAvg !== undefined) {
        formula = formula.replace(/\{__lastAvg\}/g, String(buttonDef.__lastAvg));
      }
      if (buttonDef?.__lastNatural !== undefined) {
        formula = formula.replace(/\{__lastNatural\}/g, String(buttonDef.__lastNatural));
      }
      if (buttonDef?.__lastIsCrit !== undefined) {
        formula = formula.replace(/\{__lastIsCrit\}/g, String(buttonDef.__lastIsCrit));
      }
      if (buttonDef?.__lastCritFormula !== undefined) {
        formula = formula.replace(/\{__lastCritFormula\}/g, String(buttonDef.__lastCritFormula));
      }
      if (buttonDef?.__lastIsFumble !== undefined) {
        formula = formula.replace(/\{__lastIsFumble\}/g, String(buttonDef.__lastIsFumble));
      }
      if (buttonDef?.__lastFumbleFormula !== undefined) {
        formula = formula.replace(/\{__lastFumbleFormula\}/g, String(buttonDef.__lastFumbleFormula));
      }
      if (buttonDef?.__lastDice !== undefined) {
        formula = formula.replace(/\{__lastDice\}/g, String(buttonDef.__lastDice));
      }
      if (buttonDef?.__dlgPicked !== undefined) {
        formula = formula.replace(/\{__dlgPicked\}/g, String(buttonDef.__dlgPicked));
      }
      if (buttonDef?.__dlgChoice !== undefined) {
        formula = formula.replace(/\{__dlgChoice\}/g, String(buttonDef.__dlgChoice));
      }
      if (buttonDef?.__dlgHistory !== undefined) {
        formula = formula.replace(/\{__dlgHistory\}/g, String(buttonDef.__dlgHistory));
      }
      if (formula.includes("{__dlg.")) {
        formula = formula.replace(/\{__dlg\.([A-Za-z_][\w]*)\}/g, (_m, id) => {
          const state = (buttonDef?.__dlgState && typeof buttonDef.__dlgState === "object")
            ? buttonDef.__dlgState
            : {};
          const v = state[id];
          if ((v === undefined || v === null) && id === String(buttonDef?.__dlgPicked ?? "")) {
            return String(buttonDef?.__dlgChoice ?? "");
          }
          if ((v === undefined || v === null) && id === "choice") return String(buttonDef?.__dlgChoice ?? "");
          if ((v === undefined || v === null) && id === "picked") return String(buttonDef?.__dlgPicked ?? "");
          if (v === undefined || v === null) return "";
          if (typeof v === "boolean") return v ? "1" : "0";
          return String(v);
        });
      }
      if (buttonDef?.__cmpDiff !== undefined) {
        formula = formula.replace(/\{__cmpDiff\}/g, String(buttonDef.__cmpDiff));
      }
      if (buttonDef?.__cmpWinner !== undefined) {
        formula = formula.replace(/\{__cmpWinner\}/g, String(buttonDef.__cmpWinner));
      }
      if (buttonDef?.__progPrev !== undefined) {
        formula = formula.replace(/\{__progPrev\}/g, String(buttonDef.__progPrev));
      }
      const evRt = buttonDef?.__eventRuntime;
      if (evRt) {
        for (const k of Object.keys(evRt)) {
          formula = formula.replace(new RegExp(`\\{${k}\\}`, "g"), String(evRt[k] ?? ""));
        }

        if (evRt.__questId !== undefined && evRt.__questId !== "") {
          formula = formula.replace(/__SDQ_THIS__/g, String(evRt.__questId));
        }
        if (evRt.__subtaskId !== undefined && evRt.__subtaskId !== "") {
          formula = formula.replace(/__SDQ_THIS_SUB__/g, String(evRt.__subtaskId));
        }
      }
      if (runtime.__lastRollTableResult !== undefined) {
        formula = formula.replace(/\{__lastRollTableResult\}/g, String(runtime.__lastRollTableResult));
      }
      if (runtime.__lastAiResponse !== undefined) {
        formula = formula.replace(/\{__lastAiResponse\}/g, String(runtime.__lastAiResponse));
      }
      if (runtime.__lastAiError !== undefined) {
        formula = formula.replace(/\{__lastAiError\}/g, String(runtime.__lastAiError));
      }
      if (runtime.__aiMemoryCount !== undefined) {
        formula = formula.replace(/\{__aiMemoryCount\}/g, String(runtime.__aiMemoryCount));
      }
      if (runtime.__loopIndex !== undefined) {
        formula = formula.replace(/\{__loopIndex\}/g, String(runtime.__loopIndex));
      }
      if (runtime.__loopItem !== undefined) {
        formula = formula.replace(/\{__loopItem\}/g, String(runtime.__loopItem));
      }

      const _tokList = (arr) => Array.isArray(arr) ? arr.join(",") : String(arr ?? "");
      if (runtime.savedTargets !== undefined) {
        formula = formula.replace(/\{__savedTargets\}/g, _tokList(runtime.savedTargets));
      }
      if (runtime.failedTargets !== undefined) {
        formula = formula.replace(/\{__failedTargets\}/g, _tokList(runtime.failedTargets));
      }
      if (runtime.allTargets !== undefined) {
        formula = formula.replace(/\{__allTargets\}/g, _tokList(runtime.allTargets));
      }
      if (runtime.currentTarget !== undefined) {
        formula = formula.replace(/\{__currentTarget\}/g, String(runtime.currentTarget ?? ""));
      }
      if (runtime.__castActorId !== undefined) {
        formula = formula.replace(/\{__castActorId\}/g, String(runtime.__castActorId));
      }
      if (runtime.__castItemId !== undefined) {
        formula = formula.replace(/\{__castItemId\}/g, String(runtime.__castItemId));
      }
      if (runtime.__macroRetA !== undefined) {
        formula = formula.replace(/\{__macroRetA\}/g, String(runtime.__macroRetA));
      }
      if (runtime.__macroRetB !== undefined) {
        formula = formula.replace(/\{__macroRetB\}/g, String(runtime.__macroRetB));
      }
      if (Array.isArray(runtime.__macroStack) && runtime.__macroStack.length) {
        const frame = runtime.__macroStack[runtime.__macroStack.length - 1] ?? {};
        formula = formula.replace(/\{__macroArg:([a-z])\}/g, (_, pin) => String(frame[pin] ?? "0"));
      } else {
        formula = formula.replace(/\{__macroArg:[a-z]\}/g, "0");
      }
      if (runtime.__sdSelectedItem !== undefined) {
        formula = formula.replace(/\{__sdSelectedItem\}/g, String(runtime.__sdSelectedItem ?? ""));
      }
      if (runtime.__sdSelectedIndex !== undefined) {
        formula = formula.replace(/\{__sdSelectedIndex\}/g, String(runtime.__sdSelectedIndex ?? 0));
      }
      if (runtime.__sdInputText !== undefined) {
        formula = formula.replace(/\{__sdInputText\}/g, String(runtime.__sdInputText ?? ""));
      }
      formula = formula.replace(/\{__var:([A-Za-z0-9_]+)\|([^}]*)\}/g, (_, name, dflt) => {
        const vars = foundry.utils.getProperty(actor ?? {}, "flags.sd.vars") ?? {};
        const v = vars[name];
        return v === undefined || v === null ? dflt : String(v);
      });
      formula = formula.replace(/\{__sdEqCount:([^}]*)\}/g, (_, cat) => {
        const owner = actor ?? item?.parent ?? null;
        const items = owner?.items?.contents ?? [];
        const c = String(cat ?? "").trim();
        const n = items.filter(i => i?.type === "inventory"
          && i.system?.equipped === true
          && (c === "" || c === "any" || i.system?.category === c)).length;
        return String(n);
      });
      return formula;
    };

    const _resolveBoolPin = async (v) => {
      if (v === undefined || v === null || v === "") return null;
      if (typeof v === "number")  return v !== 0;
      if (typeof v === "boolean") return v;
      const raw = _injectRuntime(String(v)).trim();
      if (!raw) return null;
      const lo = raw.toLowerCase();
      if (["0","false","no","off","null","undefined"].includes(lo)) return false;
      if (["1","true","yes","on"].includes(lo)) return true;
      try {
        const { FormulaEngine } = await import("./formula-engine.mjs");
        const ev = FormulaEngine.evaluate(raw, item ?? actor ?? {});
        const n = Number(ev);
        if (Number.isFinite(n)) return n !== 0;
        return Boolean(ev);
      } catch { return null; }
    };

    switch (action.type) {

      case "questAction": {
        try {
          const resolved = {
            ...action,
            questId:   _injectRuntime(String(action.questId   ?? "")),
            subtaskId: _injectRuntime(String(action.subtaskId ?? "")),
            userId:    _injectRuntime(String(action.userId    ?? "")),
            actorRef:  _injectRuntime(String(action.actorRef  ?? "")),
            rewardId:  _injectRuntime(String(action.rewardId  ?? ""))
          };
          const ctx = {
            questLogUuid: runtime?.__questLogUuid ?? (item?.documentName === "Item" && item.type === "questlog" ? item.uuid : ""),
            questId:      runtime?.__questId      ?? "",
            subtaskId:    runtime?.__subtaskId    ?? "",
            actorId:      runtime?.__questActorId ?? actor?.id ?? "",
            userId:       runtime?.__questUserId  ?? game.user?.id ?? ""
          };
          const { SDQuest } = await import("./quest.mjs");
          await SDQuest.applyAction(resolved, ctx);
        } catch (err) {
          console.error("SD | questAction failed", err);
        }
        break;
      }

      case "roll": {
        const safeActor = actor ?? null;
        const safeItem  = item?.system ? item : null;
        const rollData  = { ...(safeActor?.getRollData?.() ?? {}), ...(safeItem ? { item: safeItem.system } : {}), ...( buttonDef?.__lastRoll !== undefined ? { __lastRoll: buttonDef.__lastRoll } : {} ) };
        let formula = _injectRuntime(action.formula || "1d20");
        let flavor  = _injectRuntime(action.flavor || buttonDef?.label || safeItem?.name || "");
        try {
          const { FormulaEngine } = await import("./formula-engine.mjs");
          const doc = safeItem ?? safeActor ?? {};
          formula = FormulaEngine.resolveForRoll(formula, doc);
          flavor  = FormulaEngine.resolveForRoll(flavor, doc);
        } catch(e) {  }
        const roll = new Roll(formula, _sanitizeRollData(rollData));
        await roll.evaluate();
        const _rrFlag = ButtonExecutor._buildRerollFlag(action, safeActor, formula, flavor || "Roll");
        await roll.toMessage({
          speaker:  ChatMessage.getSpeaker({ actor: safeActor }),
          flavor,
          rollMode: action.rollMode || _sdMsgMode(),
          ...(_rrFlag ? { flags: { sd: { reroll: _rrFlag } } } : {})
        });
        break;
      }

      case "rollValue": {
        const safeActor = actor ?? null;
        const safeItem  = item?.system ? item : null;
        const rollData  = { ...(safeActor?.getRollData?.() ?? {}), ...(safeItem ? { item: safeItem.system } : {}) };
        let formula    = _injectRuntime(action.formula    || "1d6");
        let advFormula = _injectRuntime(action.advFormula || "");
        let disFormula = _injectRuntime(action.disFormula || "");
        try {
          const { FormulaEngine } = await import("./formula-engine.mjs");
          const doc = safeItem ?? safeActor ?? {};
          formula    = FormulaEngine.resolveForRoll(formula,    doc);
          if (advFormula) advFormula = FormulaEngine.resolveForRoll(advFormula, doc);
          if (disFormula) disFormula = FormulaEngine.resolveForRoll(disFormula, doc);
        } catch(e) {}
        const _stripBraces = (s) => String(s ?? "")
          .replace(/\{[^{}]*\}/g, "0")
          .replace(/[{}]/g, "");
        formula    = _stripBraces(formula);
        advFormula = _stripBraces(advFormula);
        disFormula = _stripBraces(disFormula);

        const flavorLabel = action.flavor || buttonDef?.label || safeItem?.name || "";

        if (action.rollDialogue) {
          const dlgResult = await ButtonExecutor._showRollDialogue({
            flavor:     flavorLabel,
            baseFormula: formula,
            advFormula,
            disFormula,
            actor:      safeActor
          });
          if (dlgResult.cancelled) break;
          formula = dlgResult.formula;
        }

        const roll = new Roll(formula, _sanitizeRollData(rollData));
        await roll.evaluate();
        if (buttonDef) buttonDef.__lastRoll = roll.total;
        if (rollData)  rollData.__lastRoll  = roll.total;

        _writeRollMeta(buttonDef, { roll, formula, rollData });
        if (safeActor) {
          try {
            await safeActor.setFlag("sd", "lastRoll", {
              total:   roll.total,
              formula: formula,
              flavor:  flavorLabel,
              dice:    roll.dice?.flatMap(d => d.results?.map(r => ({ faces: d.faces, result: r.result }))) ?? [],
              at:      Date.now()
            });
          } catch(e) {  }
        }
        if (action.toChat !== false) {
          const _rrFlag = ButtonExecutor._buildRerollFlag(action, safeActor, formula, flavorLabel || "Roll");
          await roll.toMessage({
            speaker:  ChatMessage.getSpeaker({ actor: safeActor }),
            flavor:   flavorLabel,
            rollMode: _sdMsgMode(),
            ...(_rrFlag ? { flags: { sd: { reroll: _rrFlag } } } : {})
          });
        }
        break;
      }

      case "modifyField": {
        action = {
          ...action,
          delta: _injectRuntime(action.delta),
          setValue: action.setValue != null && action.setValue !== "" ? _injectRuntime(String(action.setValue)) : action.setValue,
          targetMode: action.targetMode != null && typeof action.targetMode === "string" ? _injectRuntime(action.targetMode) : action.targetMode,
          actorOverride: action.actorOverride != null && typeof action.actorOverride === "string" ? _injectRuntime(action.actorOverride) : action.actorOverride
        };
        const target = action.target;
        if (!target) break;

        const _resolveDelta = async (deltaStr) => {
          if (!deltaStr && deltaStr !== 0) return 0;
          const s = String(deltaStr).replace(/^\+/, "");
          if (/\d*d\d+/i.test(s)) {
            try {
              const { FormulaEngine } = await import("./formula-engine.mjs");
              const resolved = FormulaEngine.resolveForRoll(s, item ?? actor);
              const r = new Roll(resolved, _sanitizeRollData(actor?.getRollData?.() ?? {}));
              await r.evaluate();
              return r.total;
            } catch { return 0; }
          }
          try {
            const { FormulaEngine } = await import("./formula-engine.mjs");
            return Number(FormulaEngine.evaluate(s, item ?? actor)) || 0;
          } catch { return parseFloat(s) || 0; }
        };

        if (action.actorOverride != null && action.actorOverride !== "" && action.actorOverride !== '""' && action.actorOverride !== "0") {
          const targets = _sdResolveActorsList(action.actorOverride, actor);
          if (targets.length) {
            const path = action.rawPath
              || target.replace(/^(?:self|actor|target)\./, "");
            for (const tActor of targets) {
              let newVal;
              if (action.setValue !== "" && action.setValue !== null && action.setValue !== undefined) {
                newVal = await _resolveDelta(action.setValue);
              } else {
                const delta = action.delta != null ? await _resolveDelta(action.delta) : -1;
                const cur   = Number(foundry.utils.getProperty(tActor, path) ?? 0);
                newVal = cur + delta;
              }
              if (action.clampMin !== null && action.clampMin !== undefined) newVal = Math.max(newVal, action.clampMin);
              if (action.clampMax !== null && action.clampMax !== undefined) newVal = Math.min(newVal, action.clampMax);
              try { await tActor.update({ [path]: newVal }); } catch (e) { console.warn("SD modifyField (actorOverride) failed for", tActor?.name, e); }
            }
            break;
          }

        }

        if (target.startsWith("target.")) {
          const path   = target.slice(7);
          const tActor = _resolveTarget(action.targetMode ?? "token_target", actor);
          if (!tActor) { ui.notifications.warn("No token selected or targeted."); break; }
          let newVal;
          if (action.setValue !== "" && action.setValue !== null && action.setValue !== undefined) {
            newVal = await _resolveDelta(action.setValue);
          } else {
            const delta = action.delta != null ? await _resolveDelta(action.delta) : -1;
            const cur   = Number(foundry.utils.getProperty(tActor, path) ?? 0);
            newVal = cur + delta;
          }
          await tActor.update({ [path]: newVal });
          if (action.chatButton) {
            const delta = action.delta != null ? await _resolveDelta(action.delta) : 0;
            await this._postChatApply(action.chatButton, Math.abs(delta), actor, tActor);
          }
          break;
        }

        const current = this._getFieldValue(target, item, actor);
        let newVal;
        let deltaVal = action.delta != null ? await _resolveDelta(action.delta) : 0;
        if (action.setValue !== "" && action.setValue !== null && action.setValue !== undefined) {
          newVal = await _resolveDelta(action.setValue);
        } else {
          newVal = (Number(current) || 0) + deltaVal;
        }
        if (action.clampMin !== null && action.clampMin !== undefined) newVal = Math.max(newVal, action.clampMin);
        if (action.clampMax !== null && action.clampMax !== undefined) newVal = Math.min(newVal, action.clampMax);
        await this._setFieldValue(target, item, actor, newVal);
        if (action.chatButton) {
          const tActor = _resolveTarget("token_target", actor);
          await this._postChatApply(action.chatButton, Math.abs(deltaVal), actor, tActor);
        }
        break;
      }

      case "setField": {
        const rawVal = _injectRuntime(String(action.value ?? "0"));
        let newVal = 0;
        try {
          const { FormulaEngine } = await import("./formula-engine.mjs");
          const resolved = FormulaEngine.resolveForRoll(rawVal, item ?? actor ?? {});
          if (/\d*d\d+/i.test(resolved)) {
            const r = new Roll(resolved, _sanitizeRollData(actor?.getRollData?.() ?? {}));
            await r.evaluate();
            newVal = r.total;
          } else {
            newVal = Number(FormulaEngine.evaluate(resolved, item ?? actor)) || 0;
          }
        } catch { newVal = parseFloat(rawVal) || 0; }

        if (buttonDef) buttonDef.__lastRoll = newVal;

        const sfTarget = action.target ?? "";
        if (sfTarget.startsWith("target.")) {
          const path   = sfTarget.slice(7);
          const tActor = game.user.targets?.first()?.actor ?? canvas.tokens?.controlled?.[0]?.actor;
          if (tActor) await tActor.update({ [path]: newVal });
          else ui.notifications.warn("No token targeted.");
        } else {
          await this._setFieldValue(sfTarget, item, actor, newVal);
        }
        break;
      }

      case "setTextField": {

        const stfTarget = action.target ?? "";
        if (!stfTarget) break;

        let _stfFE = null;
        try {
          const m = await import("./formula-engine.mjs");
          _stfFE = m?.FormulaEngine ?? null;
        } catch {  }
        const _stfDoc = item ?? actor ?? {};
        const _stfResolveTokens = (s) => {
          if (!_stfFE) return s;
          try {
            return s.replace(/\{([^}]+)\}/g, (match, inner) => {
              try {
                const v = _stfFE._resolveToken
                  ? _stfFE._resolveToken(inner.trim(), _stfDoc)
                  : null;
                return (v == null) ? match : String(v);
              } catch { return match; }
            });
          } catch { return s; }
        };

        let stfValue = String(action.value ?? "");
        try { stfValue = _injectRuntime(stfValue); } catch {}
        stfValue = _stfResolveTokens(stfValue);

        try {
          const _trimmed = stfValue.trim();
          if (_trimmed.length >= 2 && _trimmed.startsWith('"') && _trimmed.endsWith('"')) {
            stfValue = JSON.parse(_trimmed);
          } else if (_trimmed.length >= 2 && _trimmed.startsWith("'") && _trimmed.endsWith("'")) {
            stfValue = _trimmed.slice(1, -1);
          }
        } catch {}

        if (action.actorOverride != null && action.actorOverride !== "" && action.actorOverride !== '""' && action.actorOverride !== "0") {
          const stfOverride = typeof action.actorOverride === "string"
            ? _injectRuntime(action.actorOverride)
            : action.actorOverride;
          const targets = _sdResolveActorsList(stfOverride, actor);
          if (targets.length) {
            const path = action.rawPath || stfTarget.replace(/^(?:self|actor|target)\./, "");
            for (const tActor of targets) {
              try { await tActor.update({ [path]: stfValue }); } catch (e) { console.warn("SD setTextField (actorOverride) failed for", tActor?.name, e); }
            }
            break;
          }
        }

        if (stfTarget.startsWith("target.")) {
          const path   = stfTarget.slice(7);
          const tActor = _resolveTarget(action.targetMode ?? "token_target", actor);
          if (!tActor) { ui.notifications.warn("Set Text Field: no token targeted."); break; }
          await tActor.update({ [path]: stfValue });
          break;
        }

        await this._setFieldValue(stfTarget, item, actor, stfValue);
        break;
      }

      case "createItem": {
        if (!actor) { ui.notifications.warn("No actor context for Add Item."); break; }
        if (action.uuid) {
          try {
            const srcItem = await fromUuid(action.uuid);
            if (srcItem) {
              const obj = srcItem.toObject();
              const qty = Number(action.qty ?? 1);
              if (qty > 1 && "quantity" in (obj.system ?? {})) obj.system.quantity = qty;
              if (action.inventoryWidget) {
                const widgetKey = action.inventoryWidget;
                const tabs = actor.system?.customTabs ?? [];
                for (const tab of tabs) {
                  for (const row of (tab.rows ?? [])) {
                    for (const w of (row.widgets ?? [])) {
                      if (w.widgetKey === widgetKey && w.type === "inventory") {
                        const cats = w.categories ?? [];
                        if (cats.length > 0 && !obj.system.category) obj.system.category = cats[0];
                      }
                    }
                  }
                }
              }
              await actor.createEmbeddedDocuments("Item", [obj]);
              break;
            }
          } catch(e) { console.warn("SD | createItem uuid error:", e); }
        }
        if (action.itemName) {
          await actor.createEmbeddedDocuments("Item", [{
            name: action.itemName,
            type: action.itemType ?? "inventory",
            system: { category: action.itemCategory ?? "" }
          }]);
        } else if (!action.uuid) {
          ui.notifications.warn("SD | Add Item node: drag an item from the sidebar into the UUID field.");
        }
        break;
      }

      case "removeItem": {
        if (!actor) break;
        let toDelete = null;
        if (action.uuid) {
          try {
            const srcItem = await fromUuid(action.uuid);
            if (srcItem) toDelete = actor.items.find(i => i.name === srcItem.name);
          } catch {}
        }
        if (!toDelete && action.itemName) {
          toDelete = actor.items.find(i => i.name === action.itemName);
        }
        if (toDelete && action.inventoryWidget) {
          const widgetKey = action.inventoryWidget;
          let allowedCats = null;
          const tabs = actor.system?.customTabs ?? [];
          for (const tab of tabs) {
            for (const row of (tab.rows ?? [])) {
              for (const w of (row.widgets ?? [])) {
                if (w.widgetKey === widgetKey && w.type === "inventory") {
                  allowedCats = w.categories ?? [];
                }
              }
            }
          }
          if (allowedCats && allowedCats.length > 0 && !allowedCats.includes(toDelete.system?.category)) {
            ui.notifications.warn(`Item "${toDelete.name}" is not in inventory widget "${widgetKey}".`);
            break;
          }
        }
        if (toDelete) await toDelete.delete();
        else ui.notifications.warn(`Item not found on ${actor.name}.`);
        break;
      }

      case "createItemArray": {
        if (!actor) { ui.notifications.warn("No actor context for Add Item Array."); break; }
        const refs = String(action.items ?? "")
          .split(",").map(s => s.trim()).filter(Boolean);
        if (!refs.length) break;
        const qty = Number(action.qty ?? 1);
        let allowedCats = null;
        if (action.inventoryWidget) {
          const widgetKey = action.inventoryWidget;
          const tabs = actor.system?.customTabs ?? [];
          for (const tab of tabs) {
            for (const row of (tab.rows ?? [])) {
              for (const w of (row.widgets ?? [])) {
                if (w.widgetKey === widgetKey && w.type === "inventory") {
                  allowedCats = w.categories ?? [];
                }
              }
            }
          }
        }
        const objs = [];
        for (const ref of refs) {
          let src = null;
          if (ref.includes(".")) {
            try { src = await fromUuid(ref); } catch (e) { console.warn("SD | createItemArray fromUuid error:", ref, e); }
          }
          if (!src) {
            const byId   = game.items?.get?.(ref);
            const byName = byId ? null : game.items?.getName?.(ref);
            src = byId ?? byName ?? null;
          }
          if (!src) continue;
          const obj = src.toObject();
          if (qty > 1 && "quantity" in (obj.system ?? {})) obj.system.quantity = qty;
          if (allowedCats && allowedCats.length > 0 && !obj.system?.category) {
            obj.system = obj.system ?? {};
            obj.system.category = allowedCats[0];
          }
          objs.push(obj);
        }
        if (objs.length) await actor.createEmbeddedDocuments("Item", objs);
        break;
      }

      case "removeItemArray": {
        if (!actor) break;
        const refs = String(action.items ?? "")
          .split(",").map(s => s.trim()).filter(Boolean);
        if (!refs.length) break;
        let allowedCats = null;
        if (action.inventoryWidget) {
          const widgetKey = action.inventoryWidget;
          const tabs = actor.system?.customTabs ?? [];
          for (const tab of tabs) {
            for (const row of (tab.rows ?? [])) {
              for (const w of (row.widgets ?? [])) {
                if (w.widgetKey === widgetKey && w.type === "inventory") {
                  allowedCats = w.categories ?? [];
                }
              }
            }
          }
        }
        const ids = new Set();
        for (const ref of refs) {
          let candidate = null;
          if (ref.includes(".")) {
            try {
              const src = await fromUuid(ref);
              if (src) candidate = actor.items.find(i => i.name === src.name);
            } catch {}
          }
          if (!candidate) candidate = actor.items.get?.(ref) ?? null;
          if (!candidate) candidate = actor.items.find?.(i => i.name === ref) ?? null;
          if (!candidate) continue;
          if (allowedCats && allowedCats.length > 0 && !allowedCats.includes(candidate.system?.category)) continue;
          ids.add(candidate.id);
        }
        if (ids.size) await actor.deleteEmbeddedDocuments("Item", [...ids]);
        break;
      }

      case "useSlotItem": {
        const _useSlotId = String(action.slotId ?? "");
        const _useIdx    = Number(action.index ?? 0);
        const { SlotManager } = await import("../data/item-slots.mjs");

        const _useActorOvr = (action.actorOverride != null && action.actorOverride !== "" && action.actorOverride !== '"0"' && action.actorOverride !== "0")
          ? (typeof action.actorOverride === "string" ? _sdResolveActor(action.actorOverride, actor) : _sdResolveActor(action.actorOverride, actor))
          : null;
        const _useActor = _useActorOvr ?? actor ?? null;
        const _useHosts = [];
        if (action.actorOverride == null || action.actorOverride === "" || action.actorOverride === "0") {
          if (item) _useHosts.push(item);
        }
        if (_useActor) {
          _useHosts.push(_useActor);
          for (const it of (_useActor.items ?? [])) _useHosts.push(it);
        }

        const walk = (host, seen) => {
          if (!host || seen.has(host)) return null;
          seen.add(host);
          const contents = SlotManager.getContents(host, _useSlotId);
          for (let i = 0; i < contents.length; i++) {
            const entry = contents[i];
            if (!entry) continue;
            if (host === item && i !== _useIdx && _useIdx > 0 && contents.length > _useIdx) continue;
            return { entry, host };
          }
          for (const e of contents) {
            const r = walk(e, seen);
            if (r) return r;
          }
          return null;
        };
        let _found = null;
        const seen = new Set();
        for (const h of _useHosts) {
          _found = walk(h, seen);
          if (_found) break;
        }

        let _usedItem = null;
        let _entryData = _found?.entry ?? null;
        if (_entryData) {
          let live = _useActor?.items?.get?.(_entryData._id) ?? null;
          if (!live) live = _useActor?.items?.find?.(i => i.name === _entryData.name) ?? null;
          if (!live && _entryData.uuid) { try { live = await fromUuid(_entryData.uuid); } catch {} }
          _usedItem = live ?? null;
          if (!_usedItem) {
            try {
              const ItemCls = foundry.utils.getDocumentClass("Item");
              _usedItem = new ItemCls(_entryData, { parent: _useActor ?? undefined });
            } catch(e) { console.warn("SD | useSlotItem: could not build temp item:", e); }
          }
        }
        if (_usedItem) await _usedItem.use({});
        else ui.notifications.warn(`useSlotItem: no item in slot "${_useSlotId}".`);
        break;
      }

      case "useItem": {
        if (!actor) break;
        let _useTarget = null;
        if (action.uuid) {
          try {
            const src = await fromUuid(action.uuid);
            if (src) _useTarget = actor.items.find(i => i.name === src.name) ?? src;
          } catch {}
        }
        if (!_useTarget && action.itemName) {
          _useTarget = actor.items.find(i => i.name === action.itemName) ?? null;
        }
        if (!_useTarget && action.category) {
          const catItems = [...actor.items].filter(i => i.system?.category === action.category);
          _useTarget = catItems[Number(action.index ?? 0)] ?? null;
        }
        if (_useTarget) await _useTarget.use({});
        else ui.notifications.warn(`useItem: item not found on ${actor.name}.`);
        break;
      }

      case "equipItem":
      case "unequipItem": {
        if (!actor) break;
        let _eqTarget = null;
        if (action.uuid) {
          try {
            const src = await fromUuid(action.uuid);
            if (src) _eqTarget = actor.items.find(i => i.name === src.name) ?? null;
          } catch {}
        }
        if (!_eqTarget && action.itemName) {
          _eqTarget = actor.items.find(i => i.name === action.itemName) ?? null;
        }
        if (!_eqTarget && action.category) {
          const catItems = [...actor.items].filter(i => i.system?.category === action.category);
          _eqTarget = catItems[Number(action.index ?? 0)] ?? null;
        }
        if (!_eqTarget) { ui.notifications.warn(`${action.type}: item not found on ${actor.name}.`); break; }
        if (_eqTarget.type !== "inventory" || !_eqTarget.system?.equippable) {
          ui.notifications.warn(`${action.type}: "${_eqTarget.name}" is not equippable.`);
          break;
        }
        const _eqNext = action.type === "equipItem";
        if (_eqNext === Boolean(_eqTarget.system.equipped)) break;
        if (_eqNext && !action.force && typeof _eqTarget.canEquip === "function") {
          const { ok, reason } = await _eqTarget.canEquip();
          if (!ok) {
            ui.notifications?.warn(reason ?? game.i18n.localize("SD.EquipBlocked") ?? "Cannot equip.");
            break;
          }
        }
        await _eqTarget.update({ "system.equipped": _eqNext });
        break;
      }

      case "modifySlotItemField": {
        const _mStripQ = (s) => {
          if (s == null) return "";
          let out = String(s).trim();
          if (out.length >= 2 && ((out.startsWith('"') && out.endsWith('"')) || (out.startsWith("'") && out.endsWith("'")))) {
            try { out = JSON.parse(out); } catch { out = out.slice(1, -1); }
          }
          return String(out ?? "");
        };
        const _mSlotId = _mStripQ(_injectRuntime(String(action.slotId ?? "")));
        const _mPath   = _mStripQ(_injectRuntime(String(action.path ?? "")));
        const _mOpRaw  = _mStripQ(_injectRuntime(String(action.op ?? "")));
        const _mOp     = _mOpRaw || "add";
        if (!_mSlotId || !_mPath) { ui.notifications.warn("modifySlotItemField: slotId or path is empty."); break; }
        const { SlotManager: SM2 } = await import("../data/item-slots.mjs");

        const _mActorOvr = (action.actorOverride != null && action.actorOverride !== "" && action.actorOverride !== '"0"' && action.actorOverride !== "0")
          ? _sdResolveActor(action.actorOverride, actor)
          : null;
        const _mActor = _mActorOvr ?? actor ?? null;
        const _mHosts = [];
        if (!_mActorOvr && item) _mHosts.push(item);
        if (_mActor) {
          if (!_mHosts.includes(_mActor)) _mHosts.push(_mActor);
          for (const it of (_mActor.items ?? [])) {
            if (!_mHosts.includes(it)) _mHosts.push(it);
          }
        }

        const seenM = new Set();
        const findMatch = (host) => {
          if (!host || seenM.has(host)) return null;
          seenM.add(host);
          const contents = SM2.getContents(host, _mSlotId);
          for (let i = 0; i < contents.length; i++) {
            const entry = contents[i];
            if (!entry) continue;
            const v = foundry.utils.getProperty(entry, _mPath);
            if (v !== undefined && typeof v !== "object") {
              return { host, index: i, entry };
            }
          }
          for (const entry of contents) {
            const r = findMatch(entry);
            if (r) return r;
          }
          return null;
        };

        let _mMatch = null;
        for (const h of _mHosts) {
          _mMatch = findMatch(h);
          if (_mMatch) break;
        }

        if (!_mMatch) {
          const seenF = new Set();
          const walkFallback = (host) => {
            if (!host || seenF.has(host)) return null;
            seenF.add(host);
            const contents = SM2.getContents(host, _mSlotId);
            if (contents.length) return { host, index: 0, entry: contents[0] };
            for (const entry of contents) {
              const r = walkFallback(entry);
              if (r) return r;
            }
            return null;
          };
          for (const h of _mHosts) {
            _mMatch = walkFallback(h);
            if (_mMatch) break;
          }
        }

        if (!_mMatch) { ui.notifications.warn(`modifySlotItemField: no item in slot "${_mSlotId}" (path "${_mPath}").`); break; }

        const _mResolveNum = async (raw) => {
          if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0;
          if (raw == null || raw === "") return 0;
          let s = _mStripQ(_injectRuntime(String(raw)));
          if (s === "") return 0;
          if (/\{|[+\-*/]/.test(s)) {
            try {
              const { FormulaEngine: _FE } = await import("./formula-engine.mjs");
              const v = _FE.evaluate(s, item ?? _mActor ?? actor);
              const n = Number(v);
              if (Number.isFinite(n)) return n;
            } catch {}
          }
          const n = parseFloat(s);
          return Number.isFinite(n) ? n : 0;
        };
        const _mAmt = await _mResolveNum(action.amount);
        const _mCur = Number(foundry.utils.getProperty(_mMatch.entry, _mPath) ?? 0);
        let _mResult;
        if      (_mOp === "subtract") _mResult = _mCur - _mAmt;
        else if (_mOp === "set")      _mResult = _mAmt;
        else                          _mResult = _mCur + _mAmt;
        try {
          await SM2.updateSlottedField(_mMatch.host, _mSlotId, _mMatch.index, _mPath, _mResult);
        } catch (e) {
          console.warn("SD modifySlotItemField update failed", e);
          ui.notifications.warn(`modifySlotItemField: update failed (${e?.message ?? e}).`);
        }
        break;
      }

      case "modifyItemField": {
        const _miStripQuotes = (s) => {
          if (typeof s !== "string") return s;
          let out = s.trim();
          if (out.length >= 2 && ((out.startsWith('"') && out.endsWith('"')) || (out.startsWith("'") && out.endsWith("'")))) {
            try { out = JSON.parse(out); } catch { out = out.slice(1, -1); }
          }
          return String(out ?? "");
        };
        const _miPath = _miStripQuotes(_injectRuntime(String(action.path ?? "")));
        const _miOpRaw = _miStripQuotes(_injectRuntime(String(action.op ?? "")));
        const _miOp = _miOpRaw || "add";
        const _miSearchIn = String(action.searchIn ?? "inventory");
        if (!_miPath) { ui.notifications.warn("modifyItemField: path is empty."); break; }
        let _miUuid = action.uuid ?? "";
        if (typeof _miUuid === "string") _miUuid = _injectRuntime(_miUuid);
        _miUuid = String(_miUuid ?? "").trim();
        if (_miUuid.includes("{") && _miUuid.includes("}")) {
          try {
            const { FormulaEngine: _miFE } = await import("./formula-engine.mjs");
            const _miCtx = item ?? actor ?? null;
            const resolved = _miFE._resolveRefs(_miUuid, _miCtx);
            if (typeof resolved === "string" && resolved.trim()) _miUuid = resolved;
          } catch (e) {
            console.warn("SD modifyItemField: token resolve failed", e);
          }
        }
        _miUuid = _miStripQuotes(_miUuid);
        if (!_miUuid) { ui.notifications.warn("modifyItemField: item UUID is empty."); break; }

        let _miSourceActors = null;
        if (action.actorOverride != null && action.actorOverride !== "" && action.actorOverride !== '""' && action.actorOverride !== "0") {
          const ovr = typeof action.actorOverride === "string"
            ? _injectRuntime(action.actorOverride)
            : action.actorOverride;
          const list = _sdResolveActorsList(ovr, actor);
          if (list.length) _miSourceActors = list;
        }

        let _miBaseDoc = null;
        try { _miBaseDoc = await fromUuid(_miUuid); } catch {}
        const _miBaseName = (_miBaseDoc instanceof Item) ? _miBaseDoc.name : null;
        const _miUuidShortId = (() => {
          const s = String(_miUuid);
          const parts = s.split(".");
          return parts[parts.length - 1] || s;
        })();

        const _miFindLive = (a) => {
          if (!a?.items) return null;
          let it = a.items.find?.(i => i.uuid === _miUuid) ?? null;
          if (!it) it = a.items.get?.(_miUuid) ?? null;
          if (!it && _miBaseName) it = a.items.find?.(i => i.name === _miBaseName) ?? null;
          return it;
        };

        const _miFindSlot = (a) => {
          if (!a?.items) return [];
          const hits = [];
          const visit = (host) => {
            const defs = host?.system?.slotDefinitions ?? [];
            for (const def of defs) {
              const sid = String(def?.id ?? "");
              if (!sid) continue;
              const contents = host?.system?.slotContents?.[sid]?.contents ?? [];
              for (let i = 0; i < contents.length; i++) {
                const e = contents[i];
                if (!e) continue;
                const match =
                     e._sourceUuid === _miUuid
                  || e.uuid        === _miUuid
                  || e._id         === _miUuidShortId
                  || (_miBaseName && e.name === _miBaseName);
                if (match) hits.push({ host, slotId: sid, index: i, entry: e });
                visit(e);
              }
            }
          };
          for (const it of a.items) visit(it);
          return hits;
        };

        const _miActors = _miSourceActors ?? (actor ? [actor] : []);
        const _miResolveNum = async (raw) => {
          if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0;
          if (raw == null || raw === "") return 0;
          let s = _miStripQuotes(_injectRuntime(String(raw)));
          if (s === "") return 0;
          if (/\{|[+\-*/]/.test(s)) {
            try {
              const { FormulaEngine: _FE } = await import("./formula-engine.mjs");
              const v = _FE.evaluate(s, item ?? actor);
              const n = Number(v);
              if (Number.isFinite(n)) return n;
            } catch {}
          }
          const n = parseFloat(s);
          return Number.isFinite(n) ? n : 0;
        };
        const _miAmt = await _miResolveNum(action.amount);
        const { SlotManager: _miSM } = await import("../data/item-slots.mjs");

        const _miApply = async (probeDoc, applyFn) => {
          const cur = Number(foundry.utils.getProperty(probeDoc, _miPath) ?? 0);
          let res;
          if      (_miOp === "subtract") res = cur - _miAmt;
          else if (_miOp === "set")      res = _miAmt;
          else                           res = cur + _miAmt;
          try { await applyFn(res); }
          catch (e) {
            console.warn("SD modifyItemField update failed", e);
            ui.notifications.warn(`modifyItemField: update failed (${e?.message ?? e}).`);
          }
        };

        const _miTrySlot = async (a) => {
          if (!a) return false;
          const hits = _miFindSlot(a);
          if (!hits.length) return false;
          for (const h of hits) {
            await _miApply(h.entry, (val) =>
              _miSM.updateSlottedField(h.host, h.slotId, h.index, _miPath, val));
          }
          return true;
        };
        const _miTryInv = async (a) => {
          let it = a ? _miFindLive(a) : null;
          if (!it && !a && _miBaseDoc instanceof Item) it = _miBaseDoc;
          if (!it) return false;
          await _miApply(it, (val) => it.update({ [_miPath]: val }));
          return true;
        };

        let _miAny = false;
        const _miLoop = _miActors.length ? _miActors : [null];
        for (const a of _miLoop) {
          let ok = false;
          if (_miSearchIn === "slot") {
            ok = await _miTrySlot(a);
          } else if (_miSearchIn === "inventory") {
            ok = await _miTryInv(a);
          } else if (_miSearchIn === "slot_then_inventory") {
            ok = await _miTrySlot(a);
            if (!ok) ok = await _miTryInv(a);
          } else if (_miSearchIn === "inventory_then_slot") {
            ok = await _miTryInv(a);
            if (!ok) ok = await _miTrySlot(a);
          } else {
            ok = await _miTryInv(a);
          }
          if (ok) _miAny = true;
        }

        if (!_miAny) {
          ui.notifications.warn(`modifyItemField: item "${_miUuid}" not found (searchIn=${_miSearchIn}).`);
        }
        break;
      }

      case "modifyInvItemField": {

        let _invSourceActors;
        if (action.actorOverride != null && action.actorOverride !== "" && action.actorOverride !== '""' && action.actorOverride !== "0") {
          const ovr = typeof action.actorOverride === "string"
            ? _injectRuntime(action.actorOverride)
            : action.actorOverride;
          _invSourceActors = _sdResolveActorsList(ovr, actor);
          if (!_invSourceActors.length) _invSourceActors = actor ? [actor] : [];
        } else {
          _invSourceActors = actor ? [actor] : [];
        }
        if (!_invSourceActors.length) break;

        for (const _srcActor of _invSourceActors) {
          let _invItem = null;
          if (action.uuid) {
            try {
              const src = await fromUuid(action.uuid);
              if (src) _invItem = _srcActor.items.find(i => i.name === src.name) ?? null;
            } catch {}
          }
          if (!_invItem && action.itemName) {
            _invItem = _srcActor.items.find(i => i.name === action.itemName) ?? null;
          }
          if (!_invItem && action.category) {
            const catItems = [...(_srcActor.items ?? [])].filter(i => i.system?.category === action.category);
            _invItem = catItems[Number(action.index ?? 0)] ?? null;
          }
          if (!_invItem) {
            ui.notifications.warn(`modifyInvItemField: item not found on ${_srcActor.name}.`);
            continue;
          }

          const _fPath = action.path ?? "";
          const _fCur  = Number(foundry.utils.getProperty(_invItem, _fPath) ?? 0);
          const _fAmt  = Number(action.amount ?? 0);
          let   _fResult;
          if      (action.op === "subtract") _fResult = _fCur - _fAmt;
          else if (action.op === "set")      _fResult = _fAmt;
          else                               _fResult = _fCur + _fAmt;
          try { await _invItem.update({ [_fPath]: _fResult }); } catch (e) { console.warn("SD modifyInvItemField failed for", _srcActor?.name, e); }
        }
        break;
      }

      case "removeFromInvItemSlot": {
        const { SlotManager: SM } = await import("../data/item-slots.mjs");
        const _rfActorOvr = (action.actorOverride != null && action.actorOverride !== "" && action.actorOverride !== '"0"' && action.actorOverride !== "0")
          ? _sdResolveActor(action.actorOverride, actor)
          : null;
        const _rfActor = _rfActorOvr ?? actor ?? null;
        if (!_rfActor && !item) break;

        const _slotId   = String(action.slotId ?? "slot1");

        let _parentItem = null;
        if (action.uuid) {
          try {
            const src = await fromUuid(action.uuid);
            if (src) _parentItem = (_rfActor?.items?.get?.(src.id) ?? _rfActor?.items?.find?.(i => i.name === src.name))
                                ?? (src.id === item?.id || src.name === item?.name ? item : null)
                                ?? null;
          } catch {}
        }
        if (!_parentItem && action.itemName) {
          _parentItem = _rfActor?.items?.find?.(i => i.name === action.itemName)
                     ?? _rfActor?.items?.find?.(i => i.uuid === action.itemName)
                     ?? (item?.name === action.itemName ? item : null)
                     ?? null;
        }
        if (!_parentItem) {
          const candidates = [];
          if (!_rfActorOvr && item) candidates.push(item);
          if (_rfActor) for (const it of (_rfActor.items ?? [])) candidates.push(it);
          _parentItem = candidates.find(c => SM.getDefinition(c, _slotId)) ?? null;
          if (!_parentItem) _parentItem = candidates.find(c => SM.getContents(c, _slotId).length) ?? null;
        }

        if (!_parentItem) {
          ui.notifications.warn(`removeFromInvItemSlot: container with slot "${_slotId}" not found.`);
          for (const sub of (action.emptyActions ?? [])) await this._runAction(sub, item, actor, buttonDef, runtime);
          break;
        }

        const _contents = SM.getContents(_parentItem, _slotId);
        const _idx      = Number(action.index ?? 0);

        if (_contents.length === 0 || _idx >= _contents.length) {
          for (const sub of (action.emptyActions ?? [])) await this._runAction(sub, item, actor, buttonDef, runtime);
          break;
        }

        await SM.removeFromSlot(_parentItem, _slotId, _idx);
        for (const sub of (action.doneActions ?? [])) await this._runAction(sub, item, actor, buttonDef, runtime);
        break;
      }

      case "addToInvItemSlot": {
        const { SlotManager: SM2 } = await import("../data/item-slots.mjs");
        const _aiActorOvr = (action.actorOverride != null && action.actorOverride !== "" && action.actorOverride !== '"0"' && action.actorOverride !== "0")
          ? _sdResolveActor(action.actorOverride, actor)
          : null;
        const _aiActor = _aiActorOvr ?? actor ?? null;
        if (!_aiActor && !item) break;

        const _slotId2 = String(action.slotId ?? "slot1");

        let _container = null;
        if (action.parentUuid) {
          try {
            const src = await fromUuid(action.parentUuid);
            if (src) _container = (_aiActor?.items?.get?.(src.id) ?? _aiActor?.items?.find?.(i => i.name === src.name))
                                ?? (src.id === item?.id || src.name === item?.name ? item : null)
                                ?? null;
          } catch {}
        }
        if (!_container && action.parentName) {
          _container = _aiActor?.items?.find?.(i => i.name === action.parentName)
                    ?? _aiActor?.items?.find?.(i => i.uuid === action.parentName)
                    ?? (item?.name === action.parentName ? item : null)
                    ?? null;
        }
        if (!_container) {
          const candidates = [];
          if (!_aiActorOvr && item) candidates.push(item);
          if (_aiActor) for (const it of (_aiActor.items ?? [])) candidates.push(it);
          _container = candidates.find(c => SM2.getDefinition(c, _slotId2)) ?? null;
        }

        if (!_container) {
          ui.notifications.warn(`addToInvItemSlot: container with slot "${_slotId2}" not found.`);
          for (const sub of (action.fullActions ?? [])) await this._runAction(sub, item, actor, buttonDef, runtime);
          break;
        }

        let _toPlace = null;
        if (action.itemUuid) {
          try {
            const src = await fromUuid(action.itemUuid);
            if (src) _toPlace = (_aiActor?.items?.get?.(src.id) ?? _aiActor?.items?.find?.(i => i.name === src.name)) ?? src;
          } catch {}
        }
        if (!_toPlace && action.itemName) {
          _toPlace = (_aiActor?.items ?? item?.items ?? []).find?.(i => i.name === action.itemName) ?? null;
        }
        if (!_toPlace) {
          ui.notifications.warn(`addToInvItemSlot: item "${action.itemName || action.itemUuid}" not found.`);
          for (const sub of (action.fullActions ?? [])) await this._runAction(sub, item, actor, buttonDef, runtime);
          break;
        }

        const _def     = SM2.getDefinition(_container, _slotId2);
        const _cur     = SM2.getContents(_container, _slotId2);

        if (_def && _cur.length >= _def.maxCount) {
          for (const sub of (action.fullActions ?? [])) await this._runAction(sub, item, actor, buttonDef, runtime);
          break;
        }

        await SM2.addToSlot(_container, _slotId2, _toPlace);
        for (const sub of (action.doneActions ?? [])) await this._runAction(sub, item, actor, buttonDef, runtime);
        break;
      }

      case "addToSlot": {
        const _addSlotActorOvr = (action.actorOverride != null && action.actorOverride !== "" && action.actorOverride !== '"0"' && action.actorOverride !== "0")
          ? _sdResolveActor(action.actorOverride, actor)
          : null;
        const _addSlotActor = _addSlotActorOvr ?? actor ?? null;
        const _slotCtx = _addSlotActor ?? item ?? null;
        if (!_slotCtx) break;

        const _sid = String(action.slotId ?? "");

        let _resolved = null;
        if (action.slotPath) {
          _resolved = _resolveNestedSlotParent(_addSlotActor, item, action.slotPath);
        }
        let slotParent = _resolved?.parent ?? null;
        if (!slotParent) {
          const _itemAvail = !_addSlotActorOvr && item;
          const itemHasSlot = _itemAvail && !!item?.system?.slotDefinitions?.find?.(d => String(d.id) === _sid);
          if (itemHasSlot) {
            slotParent = item;
            _resolved = { parent: item, slotId: _sid, liveAncestor: item, snapshotChain: [] };
          } else {
            const found = (_addSlotActor?.items ?? []).find(it =>
              it.system?.slotDefinitions?.find(d => String(d.id) === _sid)
            ) ?? _slotCtx;
            slotParent = found;
            _resolved = { parent: found, slotId: _sid, liveAncestor: found, snapshotChain: [] };
          }
        }

        const defs = slotParent.system?.slotDefinitions ?? [];
        if (!defs.find(d => String(d.id) === _sid)) {
          const allWidgets = (slotParent.system?.customTabs ?? [])
            .flatMap(t => (t.rows ?? []).flatMap(r => r.widgets ?? []));
          const wCfg = allWidgets.find(ww => ww.type === "slot" && String(ww.slotId) === _sid);
          const newDefs = foundry.utils.deepClone(defs);
          newDefs.push({
            id:                _sid,
            label:             wCfg?.label ?? _sid,
            allowedTypes:      wCfg?.allowedTypes      ?? [],
            allowedCategories: wCfg?.allowedCategories ?? [],
            attrFilters:       [],
            maxCount:          wCfg?.maxCount ?? 1,
            displayMode:       "compact",
            removable:         true,
            consumeOnRemove:   false
          });
          await slotParent.update({ "system.slotDefinitions": newDefs });
        }

        let srcItem = null;
        if (action.uuid) {
          try { srcItem = await fromUuid(action.uuid); } catch {}
          if (srcItem && _addSlotActor && srcItem.parent !== _addSlotActor) {
            srcItem = _addSlotActor.items.find(i => i.name === srcItem.name) ?? srcItem;
          }
        }
        if (!srcItem && action.itemName) {
          srcItem = (_addSlotActor?.items ?? item?.items ?? []).find(i => i.name === action.itemName) ?? null;
        }
        if (!srcItem) {
          if (!action.uuid && !action.itemName) {
            ui.notifications.warn("SD | Add to Slot: provide an Item name or UUID.");
          } else {
            ui.notifications.warn(`Item "${action.itemName || action.uuid}" not found.`);
          }
          break;
        }
        CONFIG.debug?.sd && console.log("[SD|nested]","addToSlot action | _sid:", _sid, "| _resolved:", _resolved ? "ok" : "null", "| srcItem:", srcItem?.name);
        await _nestedAddToSlot(_resolved, _sid, srcItem);
        break;
      }

      case "removeFromSlot": {
        const _sid2 = String(action.slotId ?? "");
        const _rmSlotActorOvr = (action.actorOverride != null && action.actorOverride !== "" && action.actorOverride !== '"0"' && action.actorOverride !== "0")
          ? _sdResolveActor(action.actorOverride, actor)
          : null;
        const _rmSlotActor = _rmSlotActorOvr ?? actor ?? null;
        const _slotCtx2 = _rmSlotActor ?? item ?? null;
        if (!_slotCtx2) break;
        let _resolved2 = null;
        if (action.slotPath) {
          _resolved2 = _resolveNestedSlotParent(_rmSlotActor, item, action.slotPath);
        }
        let slotParent2 = _resolved2?.parent ?? null;
        if (!slotParent2) {
          const _itemAvail2 = !_rmSlotActorOvr && item;
          const itemHasSlot2 = _itemAvail2 && !!item?.system?.slotDefinitions?.find?.(d => String(d.id) === _sid2);
          if (itemHasSlot2) {
            slotParent2 = item;
            _resolved2 = { parent: item, slotId: _sid2, liveAncestor: item, snapshotChain: [] };
          } else {
            const { SlotManager: _SMrm } = await import("../data/item-slots.mjs");
            const _byContents = (_rmSlotActor?.items ?? []).find(it => _SMrm.getContents(it, _sid2).length > 0);
            const found2 = (_rmSlotActor?.items ?? []).find(it =>
              it.system?.slotDefinitions?.find(d => String(d.id) === _sid2)
            ) ?? _byContents ?? _slotCtx2;
            slotParent2 = found2;
            _resolved2 = { parent: found2, slotId: _sid2, liveAncestor: found2, snapshotChain: [] };
          }
        }
        CONFIG.debug?.sd && console.log("[SD|nested]","removeFromSlot action | _sid2:", _sid2, "index:", action.index ?? 0, "| _resolved2:", _resolved2 ? JSON.stringify({parent:_resolved2.parent?.name??_resolved2.parent?._id, liveAncestor:_resolved2.liveAncestor?.name??_resolved2.liveAncestor?.id, chain:_resolved2.snapshotChain}) : "null");
        if (!slotParent2) { console.warn("[SD|nested]","removeFromSlot: no slotParent2, breaking"); break; }
        await _nestedRemoveFromSlot(_resolved2, _sid2, action.index ?? 0);
        break;
      }

      case "applyEffect": {
        let _aeTargets;
        const _aeTargetsRaw = action.targets != null ? _injectRuntime(String(action.targets)) : null;
        if (_aeTargetsRaw) {
          const _aeMulti = _sdResolveActorsList(_aeTargetsRaw, actor);
          if (_aeMulti.length) {
            _aeTargets = _aeMulti;
          } else {
            const tIds = String(_aeTargetsRaw).split(",").filter(Boolean);
            _aeTargets = tIds.map(id => canvas?.tokens?.get(id)?.actor).filter(Boolean);
          }
        } else {
          const _aeSpec = action.target != null ? _injectRuntime(String(action.target)) : action.target;
          _aeTargets = _resolveAllTargets(_aeSpec ?? "actor", actor);
        }
        if (!_aeTargets.length) { ui.notifications.warn("No valid actor for applyEffect."); break; }

        const rounds = Number(action.duration ?? 0);
        const changes = (action.changes ?? []).map(c => ({
          key:   c.key   ?? "",
          value: String(c.value ?? "0"),
          mode:  Number(c.mode  ?? 2)
        }));

        for (const effectActor of _aeTargets) {
          const existing = effectActor.effects.find(e => e.name === action.effectName);
          const mode     = action.toggleMode ?? "create";

          if (mode === "toggle") {
            if (existing) { await existing.update({ disabled: !existing.disabled }); continue; }
          }
          if (mode === "ensure_on"  && existing) { await existing.update({ disabled: false }); continue; }
          if (mode === "ensure_off" && existing) { await existing.update({ disabled: true  }); continue; }
          if (mode === "toggle"     && existing) continue;

          const effectData = {
            name:     action.effectName || "Effect",
            img:      action.icon ?? "icons/svg/aura.svg",
            disabled: false,
            duration: durationForRounds(rounds),
            changes,
            origin:   item?.uuid ?? null,
            flags:    { sd: { sourceItemId: item?.id } }
          };

          if (existing && (mode === "create" || mode === "ensure_on")) {
            await existing.update({ ...effectData, disabled: false });
          } else {
            await effectActor.createEmbeddedDocuments("ActiveEffect", [effectData]);
          }
        }
        break;
      }

      case "applyEffectByUuid": {
        const uuid = String(action.effectUuid ?? "").trim();
        if (!uuid) { ui.notifications.warn("applyEffectByUuid: no UUID provided."); break; }

        let sourceEffect = null;
        try { sourceEffect = await fromUuid(uuid); } catch {}
        if (!sourceEffect) {
          ui.notifications.warn(`applyEffectByUuid: effect not found — ${uuid}`);
          break;
        }

        let _aeuTargets;
        const _aeuRaw = action.targets != null ? _injectRuntime(String(action.targets)) : null;
        if (_aeuRaw) {
          const _aeuMulti = _sdResolveActorsList(_aeuRaw, actor);
          if (_aeuMulti.length) {
            _aeuTargets = _aeuMulti;
          } else {
            const tIds = String(_aeuRaw).split(",").filter(Boolean);
            _aeuTargets = tIds.map(id => canvas?.tokens?.get(id)?.actor).filter(Boolean);
          }
        } else {
          const _aeuSpec = action.target != null ? _injectRuntime(String(action.target)) : action.target;
          _aeuTargets = _resolveAllTargets(_aeuSpec ?? "actor", actor);
        }
        if (!_aeuTargets.length) { ui.notifications.warn("No valid actor for applyEffectByUuid."); break; }

        const _aeuRounds = Number(action.duration ?? 0);
        for (const effectActor of _aeuTargets) {
          const mode     = action.toggleMode ?? "create";
          const existing = effectActor.effects.find(e => e.name === sourceEffect.name);

          if (mode === "toggle") {
            if (existing) { await existing.update({ disabled: !existing.disabled }); continue; }
          }
          if (mode === "ensure_on"  && existing) { await existing.update({ disabled: false }); continue; }
          if (mode === "ensure_off" && existing) { await existing.update({ disabled: true  }); continue; }
          if (mode === "toggle"     && existing) continue;

          const effectData = foundry.utils.mergeObject(
            sourceEffect.toObject(),
            {
              disabled: false,
              origin:   item?.uuid ?? sourceEffect.parent?.uuid ?? null,
              flags:    { sd: { sourceItemId: item?.id ?? null } },
              duration: durationForRounds(_aeuRounds)
            },
            { inplace: false }
          );
          delete effectData._id;

          if (existing && (mode === "create" || mode === "ensure_on")) {
            await existing.update({ ...effectData, disabled: false });
          } else {
            await effectActor.createEmbeddedDocuments("ActiveEffect", [effectData]);
          }
        }
        break;
      }

      case "forEachTarget": {
        const targets = [...(game.user.targets ?? [])];
        let _i = 0;
        const _prevCT = runtime.currentTarget;
        const _prevLI = runtime.__loopIndex;
        for (const token of targets) {
          const tActor = token.actor;
          if (!tActor) continue;
          runtime.currentTarget = token.id;
          runtime.__loopIndex   = _i++;
          for (const sub of (action.loopActions ?? [])) {
            await this._runAction(sub, item, tActor, buttonDef, runtime);
          }
        }
        if (_prevCT !== undefined) runtime.currentTarget = _prevCT; else delete runtime.currentTarget;
        if (_prevLI !== undefined) runtime.__loopIndex   = _prevLI; else delete runtime.__loopIndex;
        for (const sub of (action.doneActions ?? [])) {
          await this._runAction(sub, item, actor, buttonDef, runtime);
        }
        break;
      }

      case "forEachToken": {
        let raw = _injectRuntime(String(action.tokens ?? ""));
        if (typeof raw === "string" && raw.includes("{")) {
          try {
            const { FormulaEngine } = await import("./formula-engine.mjs");
            raw = FormulaEngine._resolveRefs(raw, item ?? actor ?? {});
          } catch {}
        }
        if (typeof raw === "string") {
          const t = raw.trim();
          if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
            try { raw = JSON.parse(t); } catch { raw = t.slice(1, -1); }
          }
        }
        const ids = String(raw).split(",").map(s => s.trim()).filter(Boolean);
        const _prevCT = runtime.currentTarget;
        const _prevLI = runtime.__loopIndex;
        for (let i = 0; i < ids.length; i++) {
          const tid     = ids[i];
          const tk      = (typeof canvas !== "undefined") ? canvas?.tokens?.get?.(tid) : null;
          const tActor  = tk?.actor ?? null;
          runtime.currentTarget = tid;
          runtime.__loopIndex   = i;
          for (const sub of (action.loopActions ?? [])) {
            await this._runAction(sub, item, tActor ?? actor, buttonDef, runtime);
          }
        }
        if (_prevCT !== undefined) runtime.currentTarget = _prevCT; else delete runtime.currentTarget;
        if (_prevLI !== undefined) runtime.__loopIndex   = _prevLI; else delete runtime.__loopIndex;
        for (const sub of (action.doneActions ?? [])) {
          await this._runAction(sub, item, actor, buttonDef, runtime);
        }
        break;
      }

      case "forEachItem": {

        const raw   = _injectRuntime(String(action.items ?? ""));
        const items = String(raw).split(",").map(s => s.trim()).filter(Boolean);
        const _prevLI = runtime.__loopIndex;
        const _prevLT = runtime.__loopItem;
        for (let i = 0; i < items.length; i++) {
          runtime.__loopIndex = i;
          runtime.__loopItem  = items[i];
          for (const sub of (action.loopActions ?? [])) {
            await this._runAction(sub, item, actor, buttonDef, runtime);
          }
        }
        if (_prevLI !== undefined) runtime.__loopIndex = _prevLI; else delete runtime.__loopIndex;
        if (_prevLT !== undefined) runtime.__loopItem  = _prevLT; else delete runtime.__loopItem;
        for (const sub of (action.doneActions ?? [])) {
          await this._runAction(sub, item, actor, buttonDef, runtime);
        }
        break;
      }

      case "visionScan": {
        try {
          const { FormulaEngine } = await import("./formula-engine.mjs");

          let srcActor = null;
          let srcToken = null;
          if (action.actorOverride) {
            const raw = _injectRuntime(String(action.actorOverride));
            const resolved = _sdStripQuotes(raw);
            if (resolved) {

              if (/^(Actor|Scene|Item|Token|Compendium)\.[A-Za-z0-9._-]+/.test(resolved)) {
                try {
                  const d = (typeof fromUuidSync === "function") ? fromUuidSync(resolved) : null;
                  if (d?.documentName === "Token") srcToken = d.object ?? canvas?.tokens?.get?.(d.id) ?? null;
                  else if (d?.documentName === "Actor") srcActor = d;
                  else if (d?.actor) srcActor = d.actor;
                } catch {}
              }

              if (!srcToken && !srcActor) srcToken = canvas?.tokens?.get?.(resolved) ?? null;

              if (!srcToken && !srcActor) srcActor = _sdResolveActor(resolved, actor);
            }
          }
          if (!srcToken && !srcActor) srcActor = actor;

          let distFt = 0;
          if (action.distPath) {
            const onDoc = srcActor ?? actor ?? item;
            const v = onDoc ? foundry.utils.getProperty(onDoc, String(action.distPath).trim()) : null;
            if (v !== undefined && v !== null && v !== "") distFt = Number(v) || 0;
          }
          if (!distFt) {
            const dRaw = _injectRuntime(String(action.distance ?? 0));
            const dStr = FormulaEngine.resolveForRoll(dRaw, srcActor ?? actor ?? item ?? {});
            distFt = Number(FormulaEngine.evaluate(dStr, srcActor ?? actor)) || Number(dStr) || 0;
          }

          let angDeg = 0;
          if (action.anglePath) {
            const onDoc = srcActor ?? actor ?? item;
            const v = onDoc ? foundry.utils.getProperty(onDoc, String(action.anglePath).trim()) : null;
            if (v !== undefined && v !== null && v !== "") angDeg = Number(v) || 0;
          }
          if (!angDeg) {
            const aRaw = _injectRuntime(String(action.angle ?? 360));
            const aStr = FormulaEngine.resolveForRoll(aRaw, srcActor ?? actor ?? item ?? {});
            angDeg = Number(FormulaEngine.evaluate(aStr, srcActor ?? actor)) || Number(aStr) || 360;
          }
          if (!angDeg) angDeg = 360;

          const Vision = globalThis._SD_VISION;
          const result = Vision?.sdComputeVisible?.({
            source:     srcToken ?? srcActor ?? actor,
            distanceFt: distFt,
            angleDeg:   angDeg,
            requireLOS: action.requireLOS !== false,
            includeHidden: false
          }) ?? null;
          const ids        = result?.tokenIds   ?? (Vision?.sdComputeVisibleTokens?.({
            source:     srcToken ?? srcActor ?? actor,
            distanceFt: distFt,
            angleDeg:   angDeg,
            requireLOS: action.requireLOS !== false,
            includeHidden: false
          }) ?? []);
          const actorUuids = result?.actorUuids ?? [];

          const joined       = ids.join(",");
          const joinedActors = actorUuids.join(",");
          const rt = (globalThis._SD_RUNTIME = globalThis._SD_RUNTIME ?? {});
          rt.__visionLast        = joined;
          rt.__visionLastActors  = joinedActors;
          runtime.__visionLast        = joined;
          runtime.__visionLastActors  = joinedActors;
          if (buttonDef) {
            buttonDef.__visionLast       = joined;
            buttonDef.__visionLastActors = joinedActors;
          }

          if (action.show) {
            try {
              Vision?.sdShowVisionRay?.({
                source:     srcToken ?? srcActor ?? actor,
                distanceFt: distFt,
                angleDeg:   angDeg,
                color:      String(action.showColor ?? "#74a7ff"),
                durationMs: Math.max(100, Number(action.showSeconds ?? 2) * 1000)
              });
            } catch (e) {
              console.warn("SD | visionScan ray draw failed:", e);
            }
          }
        } catch (e) {
          console.warn("SD | visionScan error:", e);
          ui.notifications?.warn?.(`Vision Scan failed: ${e?.message ?? e}`);
        }
        break;
      }

      case "setTokenElevation": {
        try {
          const { FormulaEngine } = await import("./formula-engine.mjs");
          const tokenRefRaw = _injectRuntime(String(action.tokenRef ?? "self"));
          const tokenRef    = _sdStripQuotes(tokenRefRaw);

          const srcDoc = (actor && actor.documentName === "Actor") ? actor : (actor?.actor ?? null);
          const tk = FormulaEngine._resolveTokenObject(tokenRef, srcDoc ?? item ?? actor);
          if (!tk?.document) {
            console.warn("SD | setTokenElevation: token not found for ref", tokenRef);
            break;
          }

          const valRaw = _injectRuntime(String(action.value ?? 0));
          const valStr = FormulaEngine.resolveForRoll(valRaw, srcDoc ?? actor ?? item ?? {});
          const value  = Number(FormulaEngine.evaluate(valStr, srcDoc ?? actor)) || Number(valStr) || 0;

          const mode    = String(action.mode ?? "set");
          const animate = action.animate !== false;
          const current = Number(tk.document.elevation ?? 0) || 0;
          const next    = (mode === "add") ? (current + value) : value;

          await tk.document.update({ elevation: next }, { animate });
        } catch (e) {
          console.warn("SD | setTokenElevation error:", e);
          ui.notifications?.warn?.(`Set Token Elevation failed: ${e?.message ?? e}`);
        }
        break;
      }

      case "moveToken": {
        try {
          const { FormulaEngine } = await import("./formula-engine.mjs");

          let srcActor = null;
          let srcToken = null;
          if (action.actorRef) {
            const raw = _injectRuntime(String(action.actorRef));
            const resolved = _sdStripQuotes(raw);
            if (resolved) {
              srcToken = canvas?.tokens?.get?.(resolved) ?? null;
              if (!srcToken) srcActor = _sdResolveActor(resolved, actor);
            }
          }
          if (!srcToken && !srcActor) srcActor = actor;

          const dRaw = _injectRuntime(String(action.distance ?? 0));
          const dStr = FormulaEngine.resolveForRoll(dRaw, srcActor ?? actor ?? item ?? {});
          const distFt = Number(FormulaEngine.evaluate(dStr, srcActor ?? actor)) || Number(dStr) || 0;

          const dirRaw = _injectRuntime(String(action.direction ?? 0));
          const dirStr = FormulaEngine.resolveForRoll(dirRaw, srcActor ?? actor ?? item ?? {});
          const direction = Number(FormulaEngine.evaluate(dirStr, srcActor ?? actor)) || Number(dirStr) || 0;

          const Move = globalThis._SD_MOVE;
          const res = await (Move?.sdMoveToken?.({
            source:     srcToken ?? srcActor ?? actor,
            distanceFt: distFt,
            mode:       String(action.mode ?? "degrees"),
            direction:  direction,
            passWalls:  !!action.passWalls,
            animate:    action.animate !== false
          }) ?? Promise.resolve({ ok: false }));

          if (!res?.ok && res?.reason && res.reason !== "wall-blocked") {
            console.warn("SD | moveToken returned non-ok:", res);
          }
        } catch (e) {
          console.warn("SD | moveToken error:", e);
          ui.notifications?.warn?.(`Move Token failed: ${e?.message ?? e}`);
        }
        break;
      }

      case "setTileImage":
      case "setTileSize":
      case "setTilePosition":
      case "setTileRotation":
      case "setTileTint":
      case "setTileAlpha":
      case "setTileHidden":
      case "setWallDoorState":
      case "setWallDoorType":
      case "setWallRestriction":
      case "setLightEnabled":
      case "setLightRadius":
      case "setLightColor":
      case "setLightAlpha":
      case "setLightAnimation":
      case "setDocField": {
        try {
          const { FormulaEngine } = await import("./formula-engine.mjs");
          const _sdStripQ = (s) => {
            if (s == null) return "";
            let out = String(s).trim();
            if (out.length >= 2 && ((out.startsWith('"') && out.endsWith('"')) || (out.startsWith("'") && out.endsWith("'")))) {
              try { out = JSON.parse(out); } catch { out = out.slice(1, -1); }
            }
            return String(out ?? "");
          };
          const _sdResolveStr = (raw) => {
            if (raw == null) return "";
            let s = _injectRuntime(String(raw));
            if (typeof s === "string" && s.includes("{")) {
              try { s = FormulaEngine._resolveRefs(s, item ?? actor ?? {}); } catch {}
            }
            return _sdStripQ(s);
          };
          const _sdResolveNum = async (raw, fallback = 0) => {
            if (raw == null || raw === "") return fallback;
            let s = _injectRuntime(String(raw));
            if (typeof s === "string" && s.includes("{")) {
              try { s = FormulaEngine.resolveForRoll(s, actor ?? item ?? {}); } catch {}
            }
            const ev = FormulaEngine.evaluate(s, actor ?? item ?? {});
            const n = Number(ev);
            if (Number.isFinite(n)) return n;
            const n2 = Number(s);
            return Number.isFinite(n2) ? n2 : fallback;
          };

          const uuid = _sdResolveStr(action.uuid ?? "");
          if (!uuid) { ui.notifications?.warn?.(`${action.type}: empty UUID.`); break; }

          let doc = null;
          try { doc = await fromUuid(uuid); } catch (e) { doc = null; }
          if (!doc) { ui.notifications?.warn?.(`${action.type}: document not found for UUID ${uuid}`); break; }

          const dn = doc.documentName;
          const _need = (...types) => {
            if (!types.includes(dn)) {
              ui.notifications?.warn?.(`${action.type}: target is ${dn}, expected ${types.join(" / ")}.`);
              return false;
            }
            return true;
          };

          const update = {};
          switch (action.type) {
            case "setTileImage": {
              if (!_need("Tile")) break;
              const src = _sdResolveStr(action.src ?? "");
              update["texture.src"] = src;
              break;
            }
            case "setTileSize": {
              if (!_need("Tile")) break;
              if (action.width  !== "" && action.width  != null) update.width  = await _sdResolveNum(action.width,  doc.width);
              if (action.height !== "" && action.height != null) update.height = await _sdResolveNum(action.height, doc.height);
              break;
            }
            case "setTilePosition": {
              if (!_need("Tile")) break;
              if (action.x !== "" && action.x != null) update.x = await _sdResolveNum(action.x, doc.x);
              if (action.y !== "" && action.y != null) update.y = await _sdResolveNum(action.y, doc.y);
              break;
            }
            case "setTileRotation": {
              if (!_need("Tile")) break;
              const r = await _sdResolveNum(action.rotation, doc.rotation ?? 0);
              update.rotation = ((r % 360) + 360) % 360;
              break;
            }
            case "setTileTint": {
              if (!_need("Tile")) break;
              const tint = _sdResolveStr(action.tint ?? "");
              update["texture.tint"] = tint || null;
              break;
            }
            case "setTileAlpha": {
              if (!_need("Tile")) break;
              const a = await _sdResolveNum(action.alpha, 1);
              update.alpha = Math.max(0, Math.min(1, a));
              break;
            }
            case "setTileHidden": {
              if (!_need("Tile")) break;
              const mode = String(action.mode ?? "toggle");
              if (mode === "show") update.hidden = false;
              else if (mode === "hide") update.hidden = true;
              else update.hidden = !doc.hidden;
              break;
            }
            case "setWallDoorState": {
              if (!_need("Wall")) break;
              const isDoor = Number(doc.door) > 0;
              if (!isDoor) { ui.notifications?.warn?.(`setWallDoorState: wall ${uuid} is not a door.`); break; }
              const st = String(action.state ?? "toggle");
              const CLOSED = 0, OPEN = 1, LOCKED = 2;
              const cur = Number(doc.ds ?? 0);
              let next = cur;
              if (st === "open")  next = OPEN;
              else if (st === "close") next = CLOSED;
              else if (st === "lock")  next = LOCKED;
              else next = (cur === OPEN) ? CLOSED : OPEN;
              update.ds = next;
              break;
            }
            case "setWallDoorType": {
              if (!_need("Wall")) break;
              const t = String(action.doorType ?? "door");
              const NONE = 0, DOOR = 1, SECRET = 2;
              update.door = (t === "secret") ? SECRET : (t === "none") ? NONE : DOOR;
              break;
            }
            case "setWallRestriction": {
              if (!_need("Wall")) break;
              const kind  = String(action.kind  ?? "move");
              const value = String(action.value ?? "none");
              const NONE = 0, NORMAL = 20, LIMITED = 10;
              const v = (value === "normal") ? NORMAL : (value === "limited") ? LIMITED : NONE;
              if (["move","sight","sound","light"].includes(kind)) update[kind] = v;
              break;
            }
            case "setLightEnabled": {
              if (!_need("AmbientLight")) break;
              const mode = String(action.mode ?? "toggle");
              if (mode === "enable")  update.hidden = false;
              else if (mode === "disable") update.hidden = true;
              else update.hidden = !doc.hidden;
              break;
            }
            case "setLightRadius": {
              if (!_need("AmbientLight")) break;
              if (action.bright !== "" && action.bright != null) update["config.bright"] = await _sdResolveNum(action.bright, doc.config?.bright ?? 0);
              if (action.dim    !== "" && action.dim    != null) update["config.dim"]    = await _sdResolveNum(action.dim,    doc.config?.dim    ?? 0);
              break;
            }
            case "setLightColor": {
              if (!_need("AmbientLight")) break;
              const c = _sdResolveStr(action.color ?? "");
              update["config.color"] = c || null;
              break;
            }
            case "setLightAlpha": {
              if (!_need("AmbientLight")) break;
              const a = await _sdResolveNum(action.alpha, 0.5);
              update["config.alpha"] = Math.max(0, Math.min(1, a));
              break;
            }
            case "setLightAnimation": {
              if (!_need("AmbientLight")) break;
              const animType  = _sdResolveStr(action.animType ?? "");
              const speed     = await _sdResolveNum(action.speed,     doc.config?.animation?.speed     ?? 5);
              const intensity = await _sdResolveNum(action.intensity, doc.config?.animation?.intensity ?? 5);
              const reverse   = !!action.reverse;
              const animPayload = {
                type:      animType || null,
                speed:     Math.max(0, Math.min(10, Math.round(speed))),
                intensity: Math.max(0, Math.min(10, Math.round(intensity))),
                reverse
              };
              if (!animType || animType === "none") animPayload.type = null;
              update["config.animation"] = animPayload;
              break;
            }
            case "setDocField": {
              const path = _sdResolveStr(action.path ?? "");
              if (!path) { ui.notifications?.warn?.("setDocField: path is empty."); break; }
              let val = _sdResolveStr(action.value ?? "");
              if (val === "true") val = true;
              else if (val === "false") val = false;
              else if (val === "null") val = null;
              else if (val !== "" && /^-?\d+(\.\d+)?$/.test(val)) val = Number(val);
              update[path] = val;
              break;
            }
          }

          if (Object.keys(update).length > 0) {
            await doc.update(update);
          }
        } catch (e) {
          console.warn(`SD | ${action.type} error:`, e);
          ui.notifications?.warn?.(`${action.type} failed: ${e?.message ?? e}`);
        }
        break;
      }

      case "addActorsToCombat": {
        try {
          const { FormulaEngine } = await import("./formula-engine.mjs");
          let spec = _injectRuntime(String(action.actors ?? ""));
          if (typeof spec === "string" && spec.includes("{")) {
            try { spec = FormulaEngine._resolveRefs(spec, item ?? actor ?? {}); } catch {}
          }
          spec = String(spec ?? "").trim();
          if (spec.length >= 2 && ((spec.startsWith('"') && spec.endsWith('"')) || (spec.startsWith("'") && spec.endsWith("'")))) {
            try { spec = JSON.parse(spec); } catch { spec = spec.slice(1, -1); }
          }
          const targets = _resolveAllTargets(spec || "all_targets", actor);
          if (!targets.length) { ui.notifications?.warn?.("Add Actors to Combat: no actors resolved."); break; }

          let combat = game.combat;
          if (!combat) {
            if (action.createIfMissing === false) { ui.notifications?.warn?.("Add Actors to Combat: no active combat."); break; }
            if (!game.user.isGM) { ui.notifications?.warn?.("Add Actors to Combat: only GM can create a combat encounter."); break; }
            combat = await Combat.create({ scene: canvas?.scene?.id ?? null, active: action.activate !== false });
          } else if (action.activate !== false && combat.active !== true) {
            try { await combat.activate(); } catch {}
          }
          if (!combat) break;

          const newCombatantIds = [];
          for (const tActor of targets) {
            if (!tActor) continue;
            const existing = combat.combatants.find(c => c.actorId === tActor.id);
            if (existing) continue;
            const tokenDoc = tActor.getActiveTokens?.()?.[0]?.document
                          ?? canvas?.tokens?.placeables?.find?.(t => t.actor?.id === tActor.id)?.document;
            try {
              const created = await combat.createEmbeddedDocuments("Combatant", [{
                actorId: tActor.id,
                tokenId: tokenDoc?.id ?? null,
                sceneId: tokenDoc?.parent?.id ?? canvas?.scene?.id ?? null,
                hidden:  false
              }]);
              const c = created?.[0];
              if (c) newCombatantIds.push(c.id);
            } catch (err) {
              console.warn("SD | addActorsToCombat: failed for", tActor?.name, err);
            }
          }

          const mode = String(action.rollInit ?? "none");
          if (newCombatantIds.length) {
            if (mode === "per-actor") {
              for (const id of newCombatantIds) {
                try { await combat.rollInitiative([id]); } catch {}
              }
            } else if (mode === "group") {
              try { await combat.rollInitiative(newCombatantIds); } catch {}
            }
          }
        } catch (e) {
          console.warn("SD | addActorsToCombat error:", e);
          ui.notifications?.warn?.(`Add Actors to Combat failed: ${e?.message ?? e}`);
        }
        break;
      }

      case "switchScene": {
        try {
          if (!game.user.isGM && action.mode !== "view") {
            ui.notifications?.warn?.("Switch Scene: only the GM can activate a scene.");
            break;
          }
          const { FormulaEngine } = await import("./formula-engine.mjs");
          let raw = _injectRuntime(String(action.scene ?? ""));
          if (typeof raw === "string" && raw.includes("{")) {
            try { raw = FormulaEngine._resolveRefs(raw, item ?? actor ?? {}); } catch {}
          }
          let ref = String(raw ?? "").trim();
          if (ref.length >= 2 && ((ref.startsWith('"') && ref.endsWith('"')) || (ref.startsWith("'") && ref.endsWith("'")))) {
            try { ref = JSON.parse(ref); } catch { ref = ref.slice(1, -1); }
          }
          if (!ref) { ui.notifications?.warn?.("Switch Scene: empty scene reference."); break; }

          let scene = null;
          if (ref.includes(".") && /^[A-Za-z][A-Za-z0-9]*\./.test(ref)) {
            try { scene = await fromUuid(ref); } catch {}
          }
          if (!scene) scene = game.scenes?.get?.(ref) ?? null;
          if (!scene) scene = game.scenes?.getName?.(ref) ?? null;
          if (!scene || scene.documentName !== "Scene") {
            ui.notifications?.warn?.(`Switch Scene: scene not found for "${ref}".`);
            break;
          }

          const mode = String(action.mode ?? "activate");
          if (mode === "view") {
            await scene.view();
          } else {
            await scene.activate();
          }
          if (action.pullPlayers && game.user.isGM) {
            try { game.socket?.emit?.("pullToScene", scene.id); } catch {}
            try { game.users?.players?.forEach?.(u => game.socket?.emit?.("pullToScene", scene.id, u.id)); } catch {}
            try { Hooks.callAll("pullToScene", scene, game.users.players); } catch {}
            try {
              for (const u of (game.users?.filter?.(u => !u.isGM && u.active) ?? [])) {
                game.socket?.emit?.("pullToScene", scene.id, u.id);
              }
            } catch {}
          }
        } catch (e) {
          console.warn("SD | switchScene error:", e);
          ui.notifications?.warn?.(`Switch Scene failed: ${e?.message ?? e}`);
        }
        break;
      }

      case "spawnTokenFromActor": {
        try {
          if (!game.user.isGM) {
            ui.notifications?.warn?.("Spawn Token: only the GM can spawn tokens.");
            break;
          }
          const { FormulaEngine } = await import("./formula-engine.mjs");
          const _stStripQ = (s) => {
            if (s == null) return "";
            let out = String(s).trim();
            if (out.length >= 2 && ((out.startsWith('"') && out.endsWith('"')) || (out.startsWith("'") && out.endsWith("'")))) {
              try { out = JSON.parse(out); } catch { out = out.slice(1, -1); }
            }
            return String(out ?? "");
          };
          const _stResolveStr = (raw) => {
            if (raw == null) return "";
            let s = _injectRuntime(String(raw));
            if (typeof s === "string" && s.includes("{")) {
              try { s = FormulaEngine._resolveRefs(s, item ?? actor ?? {}); } catch {}
            }
            return _stStripQ(s);
          };
          const _stResolveNum = (raw, fallback = 0) => {
            if (raw == null || raw === "") return fallback;
            let s = _injectRuntime(String(raw));
            if (typeof s === "string" && s.includes("{")) {
              try { s = FormulaEngine.resolveForRoll(s, actor ?? item ?? {}); } catch {}
            }
            const ev = FormulaEngine.evaluate(s, actor ?? item ?? {});
            const n = Number(ev);
            if (Number.isFinite(n)) return n;
            const n2 = Number(s);
            return Number.isFinite(n2) ? n2 : fallback;
          };

          const actorUuid = _stResolveStr(action.actorUuid ?? "");
          if (!actorUuid) { ui.notifications?.warn?.("Spawn Token: empty Actor UUID."); break; }
          let spawnActor = null;
          try { spawnActor = await fromUuid(actorUuid); } catch {}
          if (!spawnActor || spawnActor.documentName !== "Actor") {
            ui.notifications?.warn?.(`Spawn Token: actor not found for UUID "${actorUuid}".`);
            break;
          }

          let scene = canvas?.scene ?? null;
          const sceneUuid = _stResolveStr(action.sceneUuid ?? "");
          if (sceneUuid) {
            try { scene = await fromUuid(sceneUuid); } catch {}
            if (!scene) scene = game.scenes?.get?.(sceneUuid) ?? game.scenes?.getName?.(sceneUuid) ?? null;
          }
          if (!scene || scene.documentName !== "Scene") {
            ui.notifications?.warn?.("Spawn Token: no scene resolved.");
            break;
          }

          const tokenData = (await spawnActor.getTokenDocument?.({})) ?? null;
          const tdSrc = tokenData ? tokenData.toObject() : (spawnActor.prototypeToken?.toObject?.() ?? {});

          let x = _stResolveNum(action.x, 0);
          let y = _stResolveNum(action.y, 0);
          if (action.snapToGrid !== false) {
            const gs = Number(scene.grid?.size ?? scene.grid ?? 100) || 100;
            x = Math.round(x / gs) * gs;
            y = Math.round(y / gs) * gs;
          }
          tdSrc.x = x;
          tdSrc.y = y;
          const nm = _stStripQ(String(action.nameOverride ?? ""));
          if (nm) tdSrc.name = nm;
          tdSrc.hidden = !!action.hidden;
          delete tdSrc._id;
          delete tdSrc.actorId;
          tdSrc.actorId = spawnActor.id;

          await scene.createEmbeddedDocuments("Token", [tdSrc]);
        } catch (e) {
          console.warn("SD | spawnTokenFromActor error:", e);
          ui.notifications?.warn?.(`Spawn Token failed: ${e?.message ?? e}`);
        }
        break;
      }

      case "speakTTS": {
        try {
          const { FormulaEngine } = await import("./formula-engine.mjs");
          const rawTxt = _injectRuntime(String(action.text ?? ""));
          let text = rawTxt;
          if (typeof text === "string" && text.includes("{")) {
            try { text = FormulaEngine._resolveRefs(text, item ?? actor ?? {}); } catch {}
          }
          if (typeof text === "string") {
            const t = text.trim();
            if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
              try { text = JSON.parse(t); } catch { text = t.slice(1, -1); }
            }
          }
          if (!text) break;

          const TTS = globalThis._SD_TTS;
          TTS?.sdSpeakBroadcast?.({
            text:   String(text),
            voice:  String(action.voice  ?? ""),
            lang:   String(action.lang   ?? ""),
            rate:   Number(action.rate   ?? 1) || 1,
            pitch:  Number(action.pitch  ?? 1) || 1,
            volume: Number(action.volume ?? 1) || 1,
            target: String(action.target ?? "all")
          });
        } catch (e) {
          console.warn("SD | speakTTS error:", e);
          ui.notifications?.warn?.(`TTS failed: ${e?.message ?? e}`);
        }
        break;
      }

      case "arrayCompareTwo": {
        const { FormulaEngine } = await import("./formula-engine.mjs");
        const _resolveTokId = (raw) => {
          const v = FormulaEngine.evaluate(_injectRuntime(String(raw ?? "")), actor);
          return String(v ?? "").trim();
        };
        const aId   = _resolveTokId(action.a);
        const bId   = _resolveTokId(action.b);
        const path  = String(action.path ?? "").trim();
        const _read = (tid) => {
          if (!tid) return NaN;
          const tk = (typeof canvas !== "undefined") ? canvas?.tokens?.get?.(tid) : null;
          const a  = tk?.actor;
          if (!a || !path) return NaN;
          const v = foundry.utils.getProperty(a, path);
          return Number(v);
        };
        const aV = _read(aId);
        const bV = _read(bId);
        const aOk = !isNaN(aV);
        const bOk = !isNaN(bV);
        const diff = (aOk && bOk) ? (aV - bV) : 0;
        let branch;
        let winner = "";
        if (!aOk || !bOk || diff === 0) {
          branch = action.equalActions ?? [];
          winner = "";
        } else if (diff > 0) {
          branch = action.greaterActions ?? [];
          winner = aId;
        } else {
          branch = action.lessActions ?? [];
          winner = bId;
        }
        const _prevDiff   = buttonDef?.__cmpDiff;
        const _prevWinner = buttonDef?.__cmpWinner;
        if (buttonDef) {
          buttonDef.__cmpDiff   = diff;
          buttonDef.__cmpWinner = winner;
        }
        for (const sub of branch) {
          await this._runAction(sub, item, actor, buttonDef, runtime);
        }
        if (buttonDef) {
          if (_prevDiff   !== undefined) buttonDef.__cmpDiff   = _prevDiff;   else delete buttonDef.__cmpDiff;
          if (_prevWinner !== undefined) buttonDef.__cmpWinner = _prevWinner; else delete buttonDef.__cmpWinner;
        }
        break;
      }

      case "saveCheck": {
        const { FormulaEngine } = await import("./formula-engine.mjs");
        const tActor   = _resolveTarget(action.target ?? "actor", actor)
        const saveActor = tActor ?? actor;
        if (!saveActor) break;

        const saveMod = Number(foundry.utils.getProperty(saveActor, action.savePath ?? "system.attributes.will.value") ?? 0);
        const dc      = Number(_injectRuntime(String(action.dc ?? 15)));
        const resolvedDC = isNaN(dc) ? 15 : dc;

        const roll = new Roll(`1d20 + ${saveMod}`, _sanitizeRollData(saveActor?.getRollData?.() ?? {}));
        await roll.evaluate();

        const pass = roll.total >= resolvedDC;
        await roll.toMessage({
          speaker:  ChatMessage.getSpeaker({ actor: saveActor }),
          flavor:   `${action.flavor ?? "Saving Throw"} — DC ${resolvedDC} — ${pass ? "✅ Passed" : "❌ Failed"}`,
          rollMode: _sdMsgMode()
        });

        const branch = pass ? (action.passActions ?? []) : (action.failActions ?? []);
        for (const sub of branch) {
          await this._runAction(sub, item, saveActor, buttonDef, runtime);
        }
        break;
      }

      case "restoreSlot": {
        const slotActor = actor ?? null;
        if (!slotActor) break;
        const { FormulaEngine } = await import("./formula-engine.mjs");
        const lvlRaw = _injectRuntime(String(action.level ?? 1));
        const lvl    = String(Math.max(1, Math.round(Number(FormulaEngine.evaluate(lvlRaw, slotActor)) || 1)));
        const slotPath = `system.spellSlots.${lvl}`;
        const slot     = foundry.utils.getProperty(slotActor, slotPath) ?? {};
        const sv       = Number(slot.value ?? 0);
        const sm       = Number(slot.max   ?? 0);
        if (sm > 0) await slotActor.update({ [`${slotPath}.value`]: Math.min(sm, sv + 1) });
        break;
      }

      case "applyEffectTemplate": {
        if (!item?.system?.effectTemplates) break;
        const tplName = action.templateName ?? "";
        const tpl = item.system.effectTemplates.find(t => t.name === tplName || (!tplName && t));
        if (!tpl) {
          if (tplName) ui.notifications.warn(`Effect template "${tplName}" not found on ${item.name}.`);
          break;
        }

        const rounds  = Number(tpl.durationRounds ?? 0);
        let changes   = [];
        try { changes = JSON.parse(tpl.changes || "[]"); } catch { changes = []; }
        changes = changes.map(c => ({ key: c.key ?? "", value: String(c.value ?? "0"), mode: Number(c.mode ?? 2) }));

        const effectData = {
          name:     tpl.name     || "Effect",
          img:      tpl.icon     || "icons/svg/aura.svg",
          disabled: false,
          duration: durationForRounds(rounds),
          changes,
          origin:   item.uuid,
          flags:    { sd: { sourceItemId: item.id } }
        };

        const _aetRaw = action.targetOverride ?? tpl.target ?? "actor";
        const targetMode = typeof _aetRaw === "string" ? _injectRuntime(_aetRaw) : _aetRaw;
        let targets = _resolveAllTargets(targetMode, actor);
        if (!targets.length) targets = [actor ?? null].filter(Boolean);

        for (const tActor of targets) {
          if (!tActor) continue;
          const existing = tActor.effects.find(e => e.name === tpl.name && e.flags?.sd?.sourceItemId === item.id);
          if (existing) await existing.update({ ...effectData, disabled: false });
          else          await tActor.createEmbeddedDocuments("ActiveEffect", [effectData]);
        }
        break;
      }

      case "playSound": {
        const soundSrc = action.src ?? action.soundPath;
        if (soundSrc) {
          const vol  = (action.volume !== undefined && action.volume !== null) ? Number(action.volume) : 0.8;
          const loop = action.loop === true || action.loop === "yes";
          foundry.audio.AudioHelper.play({ src: soundSrc, volume: vol, autoplay: true, loop }, true);
        }
        break;
      }

      case "runMacro": {
        const macro = game.macros.getName(action.macroName);
        if (macro) await macro.execute({ item, actor });
        break;
      }

      case "branch": {
        if (!action.condition && action.condition !== 0) break;
        let pass = false;
        try {
          const { FormulaEngine } = await import("./formula-engine.mjs");
          let cond = _injectRuntime(String(action.condition));

          cond = FormulaEngine.resolveForRoll(cond, item ?? actor ?? {});

          if (/\d*d\d+/i.test(cond)) {
            const diceRegex = /(\d*)d(\d+)/gi;
            const matches = [...cond.matchAll(diceRegex)].reverse();
            for (const m of matches) {
              const formula = m[0];
              try {
                const r = new Roll(formula, _sanitizeRollData(actor?.getRollData?.() ?? {}));
                await r.evaluate();
                cond = cond.slice(0, m.index) + r.total + cond.slice(m.index + formula.length);
              } catch {  }
            }
          }

          const resolved = FormulaEngine.evaluate(cond, item ?? actor);
          if (typeof resolved === "boolean") {
            pass = resolved;
          } else {
            pass = !!resolved && resolved !== "0" && resolved !== 0 && resolved !== false;
          }
        } catch { pass = !!action.condition; }
        const branch = pass ? (action.trueActions ?? []) : (action.falseActions ?? []);
        for (const subAction of branch) {
          await this._runAction(subAction, item, actor, buttonDef, runtime);
        }
        break;
      }

      case "message": {
        const rawParts = action.messageParts?.length
          ? action.messageParts
          : [action.messageText ?? action.text ?? ""];

        const resolvedParts = [];
        for (let rawPart of rawParts) {
          let p = _injectRuntime(String(rawPart));
          if (!p) continue;
          try {
            const { FormulaEngine } = await import("./formula-engine.mjs");
            const doc = item ?? actor ?? {};
            p = p.replace(/\{([^}]+)\}/g, (match, inner) => {
              const val = FormulaEngine.evaluate(`{${inner}}`, doc);
              return (val === match || val === undefined || val === null) ? "0" : String(val);
            });
            if (p && !p.startsWith("{")) {
              const evaled = FormulaEngine.evaluate(p, doc);
              if (evaled !== undefined && evaled !== p) p = String(evaled);
            }
          } catch {}
          if (p) resolvedParts.push(p);
        }

        const text = resolvedParts.join("\n");
        if (text) {
          await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor: actor ?? null }),
            content: `<p style="margin:0;font-size:13px">${text.replace(/\n/g, "<br>")}</p>`
          });
        }
        break;
      }

      case "attackCheck": {
        const { FormulaEngine } = await import("./formula-engine.mjs");
        let atkFormula = action.formula ?? "1d20";
        const bonus    = action.bonus ? FormulaEngine.evaluate(String(action.bonus), item ?? actor) : 0;
        try { atkFormula = FormulaEngine.resolveForRoll(atkFormula, item ?? actor); } catch {}
        if (bonus && Number(bonus) !== 0) atkFormula = `(${atkFormula})+${bonus}`;

        const roll = new Roll(atkFormula, _sanitizeRollData(actor?.getRollData?.() ?? {}));
        await roll.evaluate();

        const tActor = game.user.targets?.first()?.actor ?? canvas.tokens?.controlled?.[1]?.actor ?? null;
        const ac     = tActor ? (Number(foundry.utils.getProperty(tActor, action.acPath ?? "system.attributes.ac.value")) || 0) : null;
        const hit    = ac !== null ? (roll.total >= ac) : null;
        const margin = ac !== null ? (roll.total - ac) : 0;

        const firstDie = roll.dice?.[0]?.results?.[0]?.result;
        if (buttonDef) {
          buttonDef.__lastRoll    = roll.total;
          buttonDef.__lastMargin  = margin;
          buttonDef.__lastNatural = leadingD20Natural(roll) ?? 0;
        }
        const _isCritOv   = await _resolveBoolPin(action.isCrit);
        const _isFumbleOv = await _resolveBoolPin(action.isFumble);
        const isCrit  = _isCritOv  !== null ? _isCritOv  : firstDie === 20;

        const outcomeLabel = isCrit ? "🌟 Crit!" : hit === null ? "" : hit ? "✅ Hit!" : "❌ Miss";
        const acLabel      = ac !== null ? `Target AC: <strong>${ac}</strong>` : "(no target)";

        _writeRollMeta(buttonDef, {
          roll, formula: atkFormula,
          isCritOverride:   _isCritOv   !== null ? (_isCritOv   ? 1 : 0) : null,
          isFumbleOverride: _isFumbleOv !== null ? (_isFumbleOv ? 1 : 0) : null,
          rollData:    actor?.getRollData?.() ?? {}
        });

        const _rrFlagAtk = ButtonExecutor._buildRerollFlag(action, actor, atkFormula, action.flavor ?? "Attack");
        await roll.toMessage({
          speaker: ChatMessage.getSpeaker({ actor }),
          flavor: `${action.flavor ?? "Attack"} — ${outcomeLabel} ${ac !== null ? `(${acLabel})` : ""}`,
          rollMode: _sdMsgMode(),
          ...(_rrFlagAtk ? { flags: { sd: { reroll: _rrFlagAtk } } } : {})
        });

        const branch = isCrit
          ? (action.critActions?.length ? action.critActions : (action.hitActions ?? []))
          : (hit !== false ? (action.hitActions ?? []) : (action.missActions ?? []));
        for (const subAction of branch) {
          await this._runAction(subAction, item, actor, buttonDef, runtime);
        }
        break;
      }

      case "rollCheck": {
        const { FormulaEngine } = await import("./formula-engine.mjs");
        const doc = item ?? actor ?? {};
        let formula = _injectRuntime(action.formula    ?? "1d20");
        let advF    = _injectRuntime(action.advFormula ?? "");
        let disF    = _injectRuntime(action.disFormula ?? "");
        try { formula = FormulaEngine.resolveForRoll(formula, doc); } catch {}
        try { if (advF) advF = FormulaEngine.resolveForRoll(advF, doc); } catch {}
        try { if (disF) disF = FormulaEngine.resolveForRoll(disF, doc); } catch {}
        const _stripBraces2 = (s) => String(s ?? "")
          .replace(/\{[^{}]*\}/g, "0")
          .replace(/[{}]/g, "");
        formula = _stripBraces2(formula);
        advF    = _stripBraces2(advF);
        disF    = _stripBraces2(disF);

        if (action.rollDialogue) {
          const dlg = await ButtonExecutor._showRollDialogue({
            flavor:      action.flavor ?? "Check",
            baseFormula: formula,
            advFormula:  advF,
            disFormula:  disF,
            actor
          });
          if (dlg.cancelled) break;
          formula = dlg.formula;
        }

        const dc       = Number(FormulaEngine.evaluate(String(action.dc ?? "0"), doc)) || 0;
        const modifier = Number(FormulaEngine.evaluate(String(action.modifier ?? "0"), doc)) || 0;
        const rollStr  = modifier ? `(${formula})+(${modifier})` : formula;

        let total;
        let _rollObj = null;
        if (action.howRoll === "chat_button") {
          const cardId = foundry.utils.randomID();
          const flavor = action.flavor ?? "Check";
          const buttonLabel = `${flavor} (DC ${dc})`;
          const content = `
            <div class="sd-chat-card sd-rollcheck-card" data-sd-rc-card="${cardId}">
              <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;">
                <img src="${actor?.img ?? "icons/svg/mystery-man.svg"}"
                     style="width:36px;height:36px;border-radius:50%;object-fit:cover;">
                <div style="flex:1">
                  <div style="font-size:13px;font-weight:700;">${actor?.name ?? "?"}</div>
                  <div style="font-size:11px;color:#666;">${flavor} — DC ${dc}</div>
                </div>
              </div>
              <div style="padding:6px 12px;">
                <button type="button" class="sd-rollcheck-btn"
                        data-sd-rc="${cardId}"
                        data-sd-rc-formula="${rollStr.replace(/"/g,"&quot;")}"
                        style="display:block;width:100%;padding:7px 10px;
                               border-radius:5px;cursor:pointer;font-weight:700;
                               background:#7a3a00;color:#fff;border:1px solid #5a2a00;">
                  <i class="fas fa-dice-d20"></i> ${buttonLabel}
                </button>
                <div class="sd-rollcheck-status" style="padding:6px 0 2px;font-size:11px;color:#888;">
                  Waiting for roll…
                </div>
              </div>
            </div>`;
          const msgPayload = {
            cardId,
            actorUuid: actor?.uuid ?? null,
            requesterId: game.user?.id ?? null,
            flavor,
            dc,
            rollStr,
            resolved: false
          };
          await ChatMessage.create({
            user:    game.user.id,
            speaker: ChatMessage.getSpeaker({ actor }),
            flavor:  `${flavor} — Roll Check`,
            content,
            flags: { sd: { rollCheck: msgPayload } }
          });

          const timeoutSec = Number(action.chatTimeout ?? 0) || 0;
          total = await new Promise((resolve) => {
            let timer = null;
            const handler = (data) => {
              if (data?.type !== "rollCheckResult" || data?.cardId !== cardId) return;
              game.socket.off("system.sd", handler);
              if (timer) clearTimeout(timer);
              resolve(Number(data.total) || 0);
            };
            game.socket.on("system.sd", handler);
            if (timeoutSec > 0) {
              timer = setTimeout(() => {
                game.socket.off("system.sd", handler);
                ui.notifications?.warn?.(`SD | Roll Check «${flavor}» timed out (${timeoutSec}s).`);
                resolve(0);
              }, timeoutSec * 1000);
            }
          });
        } else {
          const roll = new Roll(rollStr, _sanitizeRollData(actor?.getRollData?.() ?? {}));
          await roll.evaluate();
          total = roll.total;
          _rollObj = roll;
        }
        const margin = total - dc;

        let passed = false;
        switch (action.mode ?? "roll_over") {
          case "roll_under":    passed = total <= dc; break;
          case "meet_and_beat": passed = total >  dc; break;
          case "troika":        passed = total >  dc || total < dc; break;
          case "custom": {
            const cond = String(action.custom ?? "{roll} >= {dc}")
              .replace(/\{roll\}/g,  String(total))
              .replace(/\{dc\}/g,    String(dc))
              .replace(/\{margin\}/g,String(margin));
            try { passed = !!FormulaEngine.evaluate(cond, doc); } catch { passed = false; }
            break;
          }
          case "roll_over":
          default:              passed = total >= dc; break;
        }

        if (buttonDef) {
          buttonDef.__lastRoll    = total;
          buttonDef.__lastMargin  = margin;
          buttonDef.__lastNatural = _rollObj ? (leadingD20Natural(_rollObj) ?? 0) : 0;
        }
        const _isCritOvRC   = await _resolveBoolPin(action.isCrit);
        const _isFumbleOvRC = await _resolveBoolPin(action.isFumble);
        _writeRollMeta(buttonDef, {
          roll: _rollObj,
          formula: rollStr,
          isCritOverride:   _isCritOvRC   !== null ? (_isCritOvRC   ? 1 : 0) : null,
          isFumbleOverride: _isFumbleOvRC !== null ? (_isFumbleOvRC ? 1 : 0) : null,
          rollData:    actor?.getRollData?.() ?? {}
        });

        if (action.opposed) {
          const n = Math.max(1, Math.min(16, Number(action.opposedCount ?? 1) || 1));
          const oppFormula = String(action.opposedFormula ?? "1d20");
          const cardId = foundry.utils.randomID();
          const payload = {
            cardId,
            initiatorName:  actor?.name ?? item?.name ?? "?",
            initiatorImg:   actor?.img  ?? item?.img  ?? "icons/svg/mystery-man.svg",
            initiatorRoll:  total,
            flavor:         action.flavor ?? "Check",
            oppFormula,
            oppCount:       n,
            opponents:      [],
            actorUuid:      actor?.uuid ?? null,
            itemUuid:       item?.uuid  ?? null,
            userId:         game.user?.id ?? null,
            wonActions:     action.wonActions  ?? [],
            lostActions:    action.lostActions ?? [],
            resolved:       false
          };
          const rows = Array.from({length:n}, (_,i) => `
            <button type="button" class="sd-opposed-btn"
                    data-sd-opposed="${cardId}" data-sd-opposed-idx="${i}"
                    data-sd-opposed-formula="${oppFormula.replace(/"/g,"&quot;")}"
                    style="display:block;width:100%;margin:3px 0;padding:6px 10px;
                           border-radius:4px;cursor:pointer;font-weight:600;">
              <i class="fas fa-dice-d20"></i> Roll as Opponent #${i+1} (${oppFormula})
            </button>`).join("");
          const content = `
            <div class="sd-chat-card sd-opposed-card" data-sd-opposed-card="${cardId}">
              <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;">
                <img src="${payload.initiatorImg}"
                     style="width:36px;height:36px;border-radius:50%;object-fit:cover;">
                <div style="flex:1">
                  <div style="font-size:13px;font-weight:700;">${payload.initiatorName}</div>
                  <div style="font-size:11px;">${payload.flavor} — rolled <strong>${total}</strong></div>
                </div>
              </div>
              <div style="padding:4px 10px 10px;">${rows}</div>
              <div class="sd-opposed-status" style="padding:6px 12px;font-size:11px;">
                Waiting for ${n} opponent${n===1?"":"s"}…
              </div>
            </div>`;
          const msg = await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor }),
            content,
            flags: { sd: { opposed: payload } }
          });
          action._opposedMessageId = msg.id;
          break;
        }

        if (action.toChat !== false) {
          const label = passed ? "✅" : "❌";
          const _rrFlagRC = ButtonExecutor._buildRerollFlag(action, actor, rollStr, action.flavor ?? "Check");
          await roll.toMessage({
            speaker:  ChatMessage.getSpeaker({ actor }),
            flavor:   `${action.flavor ?? "Check"} — ${label} (DC ${dc}, margin ${margin >= 0 ? "+" : ""}${margin})`,
            rollMode: _sdMsgMode(),
            ...(_rrFlagRC ? { flags: { sd: { reroll: _rrFlagRC } } } : {})
          });
        }

        const branch = passed ? (action.passActions ?? []) : (action.failActions ?? []);
        for (const sub of branch) await this._runAction(sub, item, actor, buttonDef, runtime);
        break;
      }

      case "tieredRoll": {
        const { FormulaEngine } = await import("./formula-engine.mjs");
        const doc = item ?? actor ?? {};
        let formula = action.formula ?? "2d6";
        try { formula = FormulaEngine.resolveForRoll(formula, doc); } catch {}

        const roll = new Roll(formula, _sanitizeRollData(actor?.getRollData?.() ?? {}));
        await roll.evaluate();
        const total = roll.total;
        if (buttonDef) {
          buttonDef.__lastRoll    = total;
          buttonDef.__lastNatural = leadingD20Natural(roll) ?? 0;
        }
        const _isCritOvTR   = await _resolveBoolPin(action.isCrit);
        const _isFumbleOvTR = await _resolveBoolPin(action.isFumble);
        _writeRollMeta(buttonDef, {
          roll, formula,
          isCritOverride:   _isCritOvTR   !== null ? (_isCritOvTR   ? 1 : 0) : null,
          isFumbleOverride: _isFumbleOvTR !== null ? (_isFumbleOvTR ? 1 : 0) : null,
          rollData:    actor?.getRollData?.() ?? {}
        });

        const tiers = action.tiers ?? [];
        let tierIdx = 0;
        for (let i = 0; i < tiers.length; i++) {
          const min = Number(FormulaEngine.evaluate(String(tiers[i]?.min ?? "0"), doc));
          if (total >= min) tierIdx = i;
        }

        if (action.toChat !== false) {
          const label = tiers[tierIdx]?.label ?? `Tier ${tierIdx + 1}`;
          const _rrFlagTier = ButtonExecutor._buildRerollFlag(action, actor, formula, action.flavor ?? "Roll");
          await roll.toMessage({
            speaker:  ChatMessage.getSpeaker({ actor }),
            flavor:   `${action.flavor ?? "Roll"} — ${label}`,
            rollMode: _sdMsgMode(),
            ...(_rrFlagTier ? { flags: { sd: { reroll: _rrFlagTier } } } : {})
          });
        }

        const branch = action.tierActions?.[tierIdx] ?? [];
        for (const sub of branch) await this._runAction(sub, item, actor, buttonDef, runtime);
        break;
      }

      case "progression": {
        const { FormulaEngine } = await import("./formula-engine.mjs");
        const doc = item ?? actor ?? {};
        let formula = action.formula ?? "1d6";
        try { formula = FormulaEngine.resolveForRoll(formula, doc); } catch {}

        const roll = new Roll(formula, _sanitizeRollData(actor?.getRollData?.() ?? {}));
        await roll.evaluate();
        const total = roll.total;

        const historyPath = String(action.historyPath ?? "system.flags.progressionDie");
        const readDoc = historyPath.startsWith("flags.") ? actor : (item ?? actor);
        let prev = null;
        try { prev = foundry.utils.getProperty(readDoc ?? {}, historyPath); } catch {}
        const hasPrev = prev !== undefined && prev !== null && prev !== "";
        const prevNum = hasPrev ? Number(prev) : 0;

        if (buttonDef) {
          buttonDef.__lastRoll    = total;
          buttonDef.__progPrev    = hasPrev ? prevNum : 0;
          buttonDef.__lastNatural = leadingD20Natural(roll) ?? 0;
        }
        const _isCritOvProg   = await _resolveBoolPin(action.isCrit);
        const _isFumbleOvProg = await _resolveBoolPin(action.isFumble);
        _writeRollMeta(buttonDef, {
          roll, formula,
          isCritOverride:   _isCritOvProg   !== null ? (_isCritOvProg   ? 1 : 0) : null,
          isFumbleOverride: _isFumbleOvProg !== null ? (_isFumbleOvProg ? 1 : 0) : null,
          rollData:    actor?.getRollData?.() ?? {}
        });

        if (action.toChat !== false) {
          const cmp = !hasPrev ? "—"
                    : total >  prevNum ? `▲ ${total}>${prevNum}`
                    : total <  prevNum ? `▼ ${total}<${prevNum}`
                    :                    `= ${total}`;
          const _rrFlagProg = ButtonExecutor._buildRerollFlag(action, actor, formula, action.flavor ?? "Progression");
          await roll.toMessage({
            speaker:  ChatMessage.getSpeaker({ actor }),
            flavor:   `${action.flavor ?? "Progression"} — ${cmp}`,
            rollMode: _sdMsgMode(),
            ...(_rrFlagProg ? { flags: { sd: { reroll: _rrFlagProg } } } : {})
          });
        }

        try {
          if (readDoc?.update) await readDoc.update({ [historyPath]: total });
        } catch (e) { console.warn("SD progression: failed to write history", e); }

        let branch;
        if      (!hasPrev)         branch = action.noHistoryActions ?? [];
        else if (total >  prevNum) branch = action.higherActions    ?? [];
        else if (total <  prevNum) branch = action.lowerActions     ?? [];
        else                       branch = action.equalActions     ?? [];
        for (const sub of branch) await this._runAction(sub, item, actor, buttonDef, runtime);
        break;
      }

      case "dicePool": {
        const { FormulaEngine } = await import("./formula-engine.mjs");
        const doc = item ?? actor ?? {};
        const count  = Math.max(0, Number(FormulaEngine.evaluate(String(action.count  ?? "0"), doc)) | 0);
        const die    = Math.max(2, Number(action.die    ?? 10) | 0);
        const target = Number(FormulaEngine.evaluate(String(action.target ?? "0"), doc)) || 0;
        const botchFace = Number(action.botchFace ?? 1) | 0;
        const required  = Number(action.required  ?? 1);

        if (count <= 0) {
          const branch = action.failActions ?? [];
          for (const sub of branch) await this._runAction(sub, item, actor, buttonDef, runtime);
          break;
        }

        const roll = new Roll(`${count}d${die}`, _sanitizeRollData(actor?.getRollData?.() ?? {}));
        await roll.evaluate();
        const faces = roll.dice?.[0]?.results?.map(r => r.result) ?? [];

        let successes = 0;
        let botches   = 0;
        for (const f of faces) {
          const ok =
              action.compare === "le" ? f <= target
            : action.compare === "eq" ? f === target
            :                           f >= target;
          if (ok) successes++;
          if (f === botchFace) botches++;
        }

        const passed = successes >= required;
        if (buttonDef) {
          buttonDef.__lastRoll      = successes;
          buttonDef.__lastSuccesses = successes;
          buttonDef.__lastBotches   = botches;
          buttonDef.__lastNatural   = leadingD20Natural(roll) ?? 0;
        }
        const _isCritOvDP   = await _resolveBoolPin(action.isCrit);
        const _isFumbleOvDP = await _resolveBoolPin(action.isFumble);
        _writeRollMeta(buttonDef, {
          roll, formula: `${count}d${die}`,
          isCritOverride:   _isCritOvDP   !== null ? (_isCritOvDP   ? 1 : 0) : null,
          isFumbleOverride: _isFumbleOvDP !== null ? (_isFumbleOvDP ? 1 : 0) : null,
          rollData:    actor?.getRollData?.() ?? {}
        });

        if (action.toChat !== false) {
          const faceStr = faces.join(", ");
          const _rrFlagPool = ButtonExecutor._buildRerollFlag(action, actor, `${count}d${die}`, action.flavor ?? "Dice Pool");
          await roll.toMessage({
            speaker:  ChatMessage.getSpeaker({ actor }),
            flavor:   `${action.flavor ?? "Dice Pool"} — ${successes} success${successes===1?"":"es"}${botches ? `, ${botches} botch${botches===1?"":"es"}` : ""} (${faceStr})`,
            rollMode: _sdMsgMode(),
            ...(_rrFlagPool ? { flags: { sd: { reroll: _rrFlagPool } } } : {})
          });
        }

        const branch = passed ? (action.passActions ?? []) : (action.failActions ?? []);
        for (const sub of branch) await this._runAction(sub, item, actor, buttonDef, runtime);
        break;
      }

      case "throwOnCanvas":
      case "throwOnSheet": {
        const { FormulaEngine } = await import("./formula-engine.mjs");
        const doc = item ?? actor ?? {};
        const count  = Math.max(0, Number(FormulaEngine.evaluate(String(action.count  ?? "0"), doc)) | 0);
        const die    = Math.max(2, Number(action.die    ?? 6) | 0);
        const target = Number(FormulaEngine.evaluate(String(action.target ?? "0"), doc)) || 0;
        const required = Number(action.required ?? 1);

        if (count <= 0) {
          const branch = action.failActions ?? [];
          for (const sub of branch) await this._runAction(sub, item, actor, buttonDef, runtime);
          break;
        }

        const roll = new Roll(`${count}d${die}`, _sanitizeRollData(actor?.getRollData?.() ?? {}));
        await roll.evaluate();
        const faces = roll.dice?.[0]?.results?.map(r => r.result) ?? [];

        let successes = 0;
        for (const f of faces) {
          const ok =
              action.compare === "le" ? f <= target
            : action.compare === "eq" ? f === target
            :                           f >= target;
          if (ok) successes++;
        }
        const total = faces.reduce((s, f) => s + f, 0);
        const passed = successes >= required;

        if (buttonDef) {
          buttonDef.__lastRoll      = total;
          buttonDef.__lastSuccesses = successes;
          buttonDef.__lastNatural   = leadingD20Natural(roll) ?? 0;
        }
        const _isCritOvTH   = await _resolveBoolPin(action.isCrit);
        const _isFumbleOvTH = await _resolveBoolPin(action.isFumble);
        _writeRollMeta(buttonDef, {
          roll, formula: `${count}d${die}`,
          isCritOverride:   _isCritOvTH   !== null ? (_isCritOvTH   ? 1 : 0) : null,
          isFumbleOverride: _isFumbleOvTH !== null ? (_isFumbleOvTH ? 1 : 0) : null,
          rollData:    actor?.getRollData?.() ?? {}
        });

        const { ThrowOverlay } = await import("./throw-overlay.mjs");
        try {
          if (action.type === "throwOnCanvas") {
            ThrowOverlay.scatterOnCanvas(faces, die, { area: Number(action.area ?? 300), duration: Number(action.duration ?? 6), actor });
          } else {
            ThrowOverlay.scatterOnSheet(faces, die, { duration: Number(action.duration ?? 6), actor });
          }
        } catch (e) {
          console.error("SD | throw overlay failed", e);
        }

        if (action.toChat !== false) {
          const _rrFlagThrow = ButtonExecutor._buildRerollFlag(action, actor, `${count}d${die}`, action.flavor ?? "Throw");
          await roll.toMessage({
            speaker:  ChatMessage.getSpeaker({ actor }),
            flavor:   `${action.flavor ?? "Throw"} — ${successes} success${successes===1?"":"es"} (${faces.join(", ")})`,
            rollMode: _sdMsgMode(),
            ...(_rrFlagThrow ? { flags: { sd: { reroll: _rrFlagThrow } } } : {})
          });
        }

        const branch = passed ? (action.passActions ?? []) : (action.failActions ?? []);
        for (const sub of branch) await this._runAction(sub, item, actor, buttonDef, runtime);
        break;
      }

      case "spendToken":
      case "gainToken": {
        const isSpend = action.type === "spendToken";
        const where   = action.where ?? "self";
        const target  = where === "token_target" ? _resolveTarget("token_target", actor) : (where === "actor" ? actor : (item ?? actor));
        if (!target) break;

        const path = action.path ?? "system.resources.tokens.value";
        const cur  = Number(foundry.utils.getProperty(target, path) ?? 0);
        const amt  = Math.max(0, Number(action.amount ?? 1) | 0);

        if (isSpend && cur < amt) {
          const branch = action.emptyActions ?? [];
          for (const sub of branch) await this._runAction(sub, item, actor, buttonDef, runtime);
          break;
        }

        const maxPath = path.replace(/\.value$/, ".max");
        const maxVal  = Number(foundry.utils.getProperty(target, maxPath) ?? NaN);
        let newVal    = isSpend ? cur - amt : cur + amt;
        if (!Number.isNaN(maxVal) && maxVal > 0) newVal = Math.min(maxVal, newVal);
        newVal = Math.max(0, newVal);

        await target.update({ [path]: newVal });
        if (buttonDef) buttonDef.__lastRoll = newVal;

        if (isSpend) {
          const branch = action.okActions ?? [];
          for (const sub of branch) await this._runAction(sub, item, actor, buttonDef, runtime);
        }
        break;
      }

      case "chatDamage":
      case "chatHeal": {
        action = {
          ...action,
          amount:       _injectRuntime(action.amount),
          damageType:   action.damageType != null && action.damageType !== ""
                          ? _injectRuntime(String(action.damageType))
                          : action.damageType,
          savePassed:   action.savePassed != null && action.savePassed !== ""
                          ? _injectRuntime(String(action.savePassed))
                          : action.savePassed,
          isCrit:       action.isCrit != null && action.isCrit !== ""
                          ? _injectRuntime(String(action.isCrit))
                          : action.isCrit,
          critAmount:   action.critAmount != null && action.critAmount !== ""
                          ? _injectRuntime(String(action.critAmount))
                          : action.critAmount,
          isFumble:     action.isFumble != null && action.isFumble !== ""
                          ? _injectRuntime(String(action.isFumble))
                          : action.isFumble,
          fumbleAmount: action.fumbleAmount != null && action.fumbleAmount !== ""
                          ? _injectRuntime(String(action.fumbleAmount))
                          : action.fumbleAmount,
          target:       action.target != null && action.target !== ""
                          ? _injectRuntime(String(action.target))
                          : action.target,
          targets:      action.targets != null ? _injectRuntime(String(action.targets)) : null
        };
        const isHeal = action.type === "chatHeal";
        const silent = action.silent === true || action.silent === "yes";
        const { FormulaEngine } = await import("./formula-engine.mjs");

        const _bool = (v) => {
          if (v === undefined || v === null || v === "") return false;
          if (typeof v === "number")  return v !== 0;
          if (typeof v === "boolean") return v;
          const s = String(v).trim().toLowerCase();
          if (!s) return false;
          if (["0","false","no","off","null","undefined"].includes(s)) return false;
          try {
            const evald = FormulaEngine.evaluate(String(v), item ?? actor ?? {});
            const n = Number(evald);
            if (Number.isFinite(n)) return n !== 0;
            return Boolean(evald);
          } catch { return true; }
        };
        const _useCrit   = _bool(action.isCrit)   && String(action.critAmount   ?? "").trim() !== "";
        const _useFumble = !_useCrit && _bool(action.isFumble) && String(action.fumbleAmount ?? "").trim() !== "";
        const _amtForRoll = _useCrit
          ? String(action.critAmount).trim()
          : _useFumble
            ? String(action.fumbleAmount).trim()
            : String(action.amount ?? "0");

        let amount = 0;
        const amtStr = _amtForRoll;
        if (/\d*d\d+/i.test(amtStr)) {
          try {
            const resolved = FormulaEngine.resolveForRoll(amtStr, item ?? actor);
            const r = new Roll(resolved, _sanitizeRollData(actor?.getRollData?.() ?? {}));
            await r.evaluate();
            amount = r.total;
          } catch { amount = 0; }
        } else {
          amount = Number(FormulaEngine.evaluate(amtStr, item ?? actor)) || 0;
        }

        if (!isHeal && action.halfOnSave && _savePassedVal(action.savePassed)) {
          amount = Math.floor(amount / 2);
        }

        const hpPath    = action.hpPath ?? "system.resources.hp.value";
        const tMode     = action.target ?? "actor";
        const autoApply = action.autoApply === true || action.autoApply === "yes";

        let tActors;
        if (action.targets) {
          const _multi = _sdResolveActorsList(action.targets, actor);
          if (_multi.length) {
            tActors = _multi;
          } else {
            const tIds = String(action.targets).split(",").filter(Boolean);
            tActors = tIds.map(id => canvas?.tokens?.get(id)?.actor).filter(Boolean);
          }
        } else {
          tActors = _resolveAllTargets(tMode, actor);
        }

        const targets = tActors.length ? tActors : [null];

        for (const tActor of targets) {
          let finalAmount = amount;
          let resLabel    = "";
          if (!isHeal && tActor && action.damageType) {
            const { factor, label } = _resistanceFactor(tActor, action.damageType);
            finalAmount = Math.max(0, Math.floor(amount * factor));
            resLabel    = label;
          }

          if (autoApply && tActor) {
            const delta = isHeal ? finalAmount : -finalAmount;
            const cur   = Number(foundry.utils.getProperty(tActor, hpPath) ?? 0);
            const maxHp = Number(foundry.utils.getProperty(tActor,
              hpPath.replace(/\.value$/, ".max")) ?? 0);
            const newVal = maxHp
              ? Math.min(maxHp, Math.max(0, cur + delta))
              : Math.max(0, cur + delta);
            await tActor.update({ [hpPath]: newVal });
          }

          if (silent) continue;

          const baseLabel = action.label ?? (isHeal ? "Healing" : "Damage");
          const swingTag = _useCrit ? " — CRIT" : _useFumble ? " — FUMBLE" : "";
          const cardLabel = `${baseLabel}${swingTag}`;
          const content = ButtonExecutor._buildChatCard({
            type:        isHeal ? "heal" : "damage",
            label:       resLabel ? `${cardLabel} (${resLabel})` : cardLabel,
            amount:      finalAmount,
            srcName:     actor?.name ?? item?.name ?? "?",
            srcImg:      actor?.img  ?? item?.img  ?? "icons/svg/mystery-man.svg",
            tActor,
            hpPath,
            showApply:   !autoApply && (action.showApply !== false && action.showApply !== "no"),
            rollFormula: /\d*d\d+/i.test(String(_amtForRoll)) ? String(_amtForRoll) : null,
            srcActorId:  actor?.id ?? null,
            autoApplied: autoApply
          });
          await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content });
        }
        break;
      }

      case "gate": {
        const { FormulaEngine } = await import("./formula-engine.mjs");
        let cond = _injectRuntime(String(action.condition ?? "0"));
        cond = FormulaEngine.resolveForRoll(cond, item ?? actor ?? {});
        const val = FormulaEngine.evaluate(cond, item ?? actor ?? {});
        if (!val || val === "0" || val === 0 || val === false) return;
        break;
      }

      case "notify": {
        const { FormulaEngine } = await import("./formula-engine.mjs");
        let text = _injectRuntime(String(action.text ?? ""));
        try {
          text = FormulaEngine.evaluate(text, item ?? actor ?? {});
        } catch {  }
        const level = action.level ?? "info";
        if (level === "warn")  ui.notifications.warn(String(text));
        else if (level === "error") ui.notifications.error(String(text));
        else ui.notifications.info(String(text));
        break;
      }

      case "setVar": {
        const { FormulaEngine } = await import("./formula-engine.mjs");
        const varName = String(action.name ?? "myVar").trim() || "myVar";
        let val = action.value ?? 0;
        try {
          let s = _injectRuntime(String(val));
          s = FormulaEngine.resolveForRoll(s, item ?? actor ?? {});
          val = FormulaEngine.evaluate(s, item ?? actor ?? {});
        } catch (e) {
          console.warn(`SD | setVar(${varName}) evaluate failed:`, e);
        }

        if (typeof val === "string") {
          const t = val.trim();
          if (t !== "" && /^-?\d+(?:\.\d+)?$/.test(t)) {
            const n = Number(t);
            if (Number.isFinite(n)) val = n;
          }
        }

        if (action.scope === "world") {
          if (game.user.isGM) {
            const vars = game.settings.get("sd", "systemSettings")?.vars ?? {};
            vars[varName] = val;
            const cur = game.settings.get("sd", "systemSettings") ?? {};
            await game.settings.set("sd", "systemSettings", { ...cur, vars });
          } else {
            console.warn(`SD | setVar(${varName}) skipped — world scope requires GM.`);
          }
        } else {
          const a = actor ?? item?.actor;
          if (!a) {
            console.warn(`SD | setVar(${varName}) skipped — no actor available.`);
          } else {
            await a.setFlag("sd", `vars.${varName}`, val);
          }
        }
        break;
      }

      case "openSheet": {
        let uuid = _injectRuntime(String(action.uuid ?? ""));
        try {
          const { FormulaEngine } = await import("./formula-engine.mjs");
          uuid = String(FormulaEngine.evaluate(uuid, item ?? actor ?? {}));
        } catch {  }
        if (!uuid) break;
        try {
          const doc = await fromUuid(uuid);
          if (!doc) { ui.notifications.warn(`SD | Open Sheet: UUID not found — ${uuid}`); break; }
          if (action.asOwner !== false && !doc.isOwner && !game.user.isGM) {
            ui.notifications.warn("SD | Open Sheet: you do not own this document."); break;
          }
          doc.sheet?.render(true);
        } catch(e) { console.error("SD | openSheet:", e); }
        break;
      }

      case "rollTable": {
        const { FormulaEngine } = await import("./formula-engine.mjs");
        let table = null;
        if (action.tableUuid) {
          try { table = await fromUuid(action.tableUuid); } catch {  }
        }
        if (!table && action.tableName) {
          table = game.tables.getName(action.tableName);
        }
        if (!table) {
          ui.notifications.warn(`SD | Roll Table: table not found — "${action.tableName || action.tableUuid}"`);

          for (const sub of (action.emptyActions ?? [])) {
            await this._runAction(sub, item, actor, buttonDef, runtime);
          }
          break;
        }

        let formula = _injectRuntime(String(action.formula ?? "1d6"));
        try { formula = FormulaEngine.resolveForRoll(formula, item ?? actor ?? {}); } catch {  }

        let drawCount = 1;
        try {
          let dcStr = _injectRuntime(String(action.drawCount ?? 1));
          dcStr = FormulaEngine.resolveForRoll(dcStr, item ?? actor ?? {});
          drawCount = Math.max(1, Math.round(Number(FormulaEngine.evaluate(dcStr, item ?? actor ?? {})) || 1));
        } catch { drawCount = 1; }

        const available = table.results?.filter(r => action.replacement !== false || !r.drawn);
        if (!available?.length) {
          runtime.__lastRollTableResult = "";
          for (const sub of (action.emptyActions ?? [])) {
            await this._runAction(sub, item, actor, buttonDef, runtime);
          }
          break;
        }

        const allResults = [];
        for (let i = 0; i < drawCount; i++) {
          const draw = await table.roll({ roll: new Roll(formula) });
          if (action.toChat !== false) await table.draw({ roll: draw.roll, results: draw.results, displayChat: true });
          const text = draw.results?.[0]?.text ?? draw.results?.[0]?.getChatText?.() ?? "";
          allResults.push(text);
          runtime.__lastRollTableResult = text;
          runtime.__rollTableIndex = i;

          for (const sub of (action.foundActions ?? [])) {
            await this._runAction(sub, item, actor, buttonDef, runtime);
          }
        }

        runtime.__lastRollTableResult = allResults[0] ?? "";
        runtime.__rollTableIndex = undefined;
        break;
      }

      case "forLoop": {
        const { FormulaEngine } = await import("./formula-engine.mjs");
        const _evalNum = (raw, fb = 0) => {
          try {
            let s = _injectRuntime(String(raw));
            s = FormulaEngine.resolveForRoll(s, item ?? actor ?? {});
            return Math.max(0, Math.round(Number(FormulaEngine.evaluate(s, item ?? actor ?? {})) || 0));
          } catch { return fb; }
        };
        const count = _evalNum(action.count ?? 3, 0);
        const delay = _evalNum(action.delay ?? 0, 0);
        const bodyKey = Array.isArray(action.bodyActions) ? "bodyActions" : "loopActions";
        for (let i = 0; i < count; i++) {
          runtime.__loopIndex = i;
          for (const sub of (action[bodyKey] ?? [])) {
            await this._runAction(sub, item, actor, buttonDef, runtime);
          }
          if (delay > 0 && i < count - 1) await new Promise(r => setTimeout(r, delay));
        }
        runtime.__loopIndex = undefined;
        for (const sub of (action.doneActions ?? [])) {
          await this._runAction(sub, item, actor, buttonDef, runtime);
        }
        break;
      }

      case "delay": {
        const { FormulaEngine } = await import("./formula-engine.mjs");
        let ms = 0;
        try {
          let s = _injectRuntime(String(action.duration ?? "0"));
          s = FormulaEngine.resolveForRoll(s, item ?? actor ?? {});
          ms = Math.max(0, Math.round(Number(FormulaEngine.evaluate(s, item ?? actor ?? {})) || 0));
        } catch { ms = 0; }
        if (ms > 0) await new Promise(r => setTimeout(r, Math.min(ms, 60000)));
        break;
      }

      case "waitForEvent": {
        const { FormulaEngine } = await import("./formula-engine.mjs");
        let ms = 0;
        try {
          let s = _injectRuntime(String(action.timeout ?? "0"));
          s = FormulaEngine.resolveForRoll(s, item ?? actor ?? {});
          ms = Math.max(0, Math.round(Number(FormulaEngine.evaluate(s, item ?? actor ?? {})) || 0));
        } catch { ms = 0; }
        const hook = String(action.hook ?? "updateCombat");
        const fired = await new Promise(resolve => {
          let settled = false;
          const id = Hooks.once(hook, () => { if (!settled) { settled = true; resolve(true); } });
          if (ms > 0) setTimeout(() => {
            if (settled) return;
            settled = true;
            try { Hooks.off(hook, id); } catch {}
            resolve(false);
          }, Math.min(ms, 600000));
        });
        const branch = fired ? (action.doneActions ?? []) : (action.timedOutActions ?? []);
        for (const sub of branch) await this._runAction(sub, item, actor, buttonDef, runtime);
        break;
      }

      case "castToActor": {
        const { FormulaEngine } = await import("./formula-engine.mjs");
        let uuid = "";
        try {
          uuid = String(FormulaEngine.evaluate(
            FormulaEngine.resolveForRoll(_injectRuntime(String(action.value ?? "")), item ?? actor ?? {}),
            item ?? actor ?? {}
          ));
        } catch { uuid = String(action.value ?? ""); }
        let resolved = null;
        try { resolved = uuid ? await fromUuid(uuid) : null; } catch { resolved = null; }
        const ok = resolved && resolved instanceof Actor;
        if (ok) runtime.__castActorId = resolved.id;
        const branch = ok ? (action.okActions ?? []) : (action.failActions ?? []);
        for (const sub of branch) await this._runAction(sub, item, actor, buttonDef, runtime);
        runtime.__castActorId = undefined;
        break;
      }

      case "castToItem": {
        const { FormulaEngine } = await import("./formula-engine.mjs");
        let uuid = "";
        try {
          uuid = String(FormulaEngine.evaluate(
            FormulaEngine.resolveForRoll(_injectRuntime(String(action.value ?? "")), item ?? actor ?? {}),
            item ?? actor ?? {}
          ));
        } catch { uuid = String(action.value ?? ""); }
        let resolved = null;
        try { resolved = uuid ? await fromUuid(uuid) : null; } catch { resolved = null; }
        const ok = resolved && resolved instanceof Item;
        if (ok) runtime.__castItemId = resolved.id;
        const branch = ok ? (action.okActions ?? []) : (action.failActions ?? []);
        for (const sub of branch) await this._runAction(sub, item, actor, buttonDef, runtime);
        runtime.__castItemId = undefined;
        break;
      }

      case "macroCall": {
        const { FormulaEngine } = await import("./formula-engine.mjs");
        const macros = buttonDef?.__macros ?? {};
        const mid    = String(action.macroId ?? "");
        const body   = Array.isArray(macros[mid]) ? macros[mid] : null;
        if (!body) {
          console.warn("SD | macroCall: macro not found", mid);
          for (const sub of (action.execActions ?? [])) await this._runAction(sub, item, actor, buttonDef, runtime);
          break;
        }
        const resolvedArgs = {};
        for (const k of ["a","b","c","d"]) {
          const raw = action.args?.[k] ?? "0";
          try {
            const s = FormulaEngine.resolveForRoll(_injectRuntime(String(raw)), item ?? actor ?? {});
            resolvedArgs[k] = String(FormulaEngine.evaluate(s, item ?? actor ?? {}) ?? 0);
          } catch { resolvedArgs[k] = String(raw); }
        }
        const stack = runtime.__macroStack ?? (runtime.__macroStack = []);
        stack.push(resolvedArgs);
        const prevRetA = runtime.__macroRetA;
        const prevRetB = runtime.__macroRetB;
        runtime.__macroRetA = undefined;
        runtime.__macroRetB = undefined;
        try {
          for (const sub of body) await this._runAction(sub, item, actor, buttonDef, runtime);
        } finally {
          stack.pop();
        }
        for (const sub of (action.execActions ?? [])) {
          await this._runAction(sub, item, actor, buttonDef, runtime);
        }
        runtime.__macroRetA = prevRetA;
        runtime.__macroRetB = prevRetB;
        break;
      }

      case "macroReturn": {
        const { FormulaEngine } = await import("./formula-engine.mjs");
        for (const [k, field] of [["a","__macroRetA"],["b","__macroRetB"]]) {
          const raw = action[k] ?? "0";
          try {
            const s = FormulaEngine.resolveForRoll(_injectRuntime(String(raw)), item ?? actor ?? {});
            runtime[field] = String(FormulaEngine.evaluate(s, item ?? actor ?? {}) ?? 0);
          } catch { runtime[field] = String(raw); }
        }
        break;
      }

      case "whileLoop": {
        const { FormulaEngine } = await import("./formula-engine.mjs");
        const maxIter = Math.max(1, Math.min(100, Math.round(Number(action.maxIter) || 20)));
        let i = 0;
        while (i < maxIter) {
          let condVal;
          try {
            let s = _injectRuntime(String(action.condition ?? "0"));
            s = FormulaEngine.resolveForRoll(s, item ?? actor ?? {});
            condVal = FormulaEngine.evaluate(s, item ?? actor ?? {});
          } catch { condVal = 0; }
          const isFalsy = !condVal || condVal === "false" || condVal === "0" || condVal === 0 || condVal === false;
          if (isFalsy) break;
          runtime.__loopIndex = i;
          for (const sub of (action.loopActions ?? [])) {
            await this._runAction(sub, item, actor, buttonDef, runtime);
          }
          i++;
        }
        runtime.__loopIndex = undefined;
        for (const sub of (action.doneActions ?? [])) {
          await this._runAction(sub, item, actor, buttonDef, runtime);
        }
        break;
      }

      case "switchExec": {
        const { FormulaEngine } = await import("./formula-engine.mjs");
        let val = _injectRuntime(String(action.value ?? "0"));
        try {
          val = String(FormulaEngine.evaluate(
            FormulaEngine.resolveForRoll(val, item ?? actor ?? {}),
            item ?? actor ?? {}
          ));
        } catch {  }
        const cases  = action.cases  ?? [];
        const matched = cases.findIndex(c => String(c) === val);
        const branch = matched >= 0
          ? (action[`case${matched}Actions`] ?? [])
          : (action.defaultActions ?? []);
        for (const sub of branch) {
          await this._runAction(sub, item, actor, buttonDef, runtime);
        }
        break;
      }

      case "sequence4": {
        for (const key of ["aActions","bActions","cActions","dActions"]) {
          for (const sub of (action[key] ?? [])) {
            await this._runAction(sub, item, actor, buttonDef, runtime);
          }
        }
        break;
      }

      case "dialogBuilder": {
        try {
          const dialogCtx = {
            item,
            actor,
            buttonDef,
            runtime,
            resolveText: _injectRuntime
          };
          const aiCfg = _sdParseAiDialogueConfig(action.aiChoices);

          if (aiCfg) {
            const infinity = aiCfg.infinityDialogue === true
              || aiCfg.infinityDialogue === "yes"
              || aiCfg.infinityDialogue === "true"
              || aiCfg.infinity === true
              || aiCfg.infinity === "yes";
            const maxTurns = Math.max(1, Math.min(50, Number(aiCfg.maxTurns ?? 20) || 20));
            const history = [];
            let latestAiText = runtime.__lastAiResponse ?? "";
            const seededAiText = String(_sdStripQuotedString(_injectRuntime(String(aiCfg.aiResponse ?? aiCfg.aiText ?? "")))).trim();
            if (seededAiText) latestAiText = seededAiText;
            let selectedChoice = "";
            let finalResult = null;
            let cancelled = false;

            for (let turn = 0; turn < (infinity ? maxTurns : 1); turn++) {
              let aiResult;
              try {
                aiResult = await _sdRequestAiDialogueChoices(aiCfg, {
                  baseText: _injectRuntime(String(action.description ?? "")),
                  latestAiText,
                  history,
                  selectedChoice,
                  actor,
                  item,
                  speaker: action.speaker ?? "",
                  resolveText: _injectRuntime
                });
              } catch (err) {
                const msg = String(err?.message ?? err);
                runtime.__lastAiError = msg;
                console.warn("SD | AI Dialogue Choices failed:", err);
                ui.notifications?.warn?.(`SD | AI Dialogue Choices failed: ${msg}`);
                aiResult = {
                  dialogueText: _injectRuntime(String(action.description ?? "")),
                  choices: [],
                  continueDialogue: false,
                  raw: ""
                };
              }

              runtime.__lastAiResponse = aiResult.dialogueText || aiResult.raw || "";
              latestAiText = aiResult.dialogueText || latestAiText;
              const renderAction = _sdApplyAiDialogueChoices(
                { ...action, description: latestAiText || action.description || "" },
                aiResult
              );

              const result = await SDDialogueBuilder.show(renderAction, dialogCtx);

              if (buttonDef && result?.state) buttonDef.__dlgState = { ...result.state };
              if (!result || result.cancelled) {
                cancelled = true;
                for (const sub of (action.cancelActions ?? [])) {
                  await this._runAction(sub, item, actor, buttonDef, runtime);
                }
                break;
              }

              finalResult = result;
              const pickedId = String(result.pickedId ?? "");
              const pickedLabel = String(result.pickedLabel ?? (pickedId || result.pinId || ""));
              const pinId = String(result.pinId ?? "");
              selectedChoice = pickedLabel;
              history.push({ ai: latestAiText, user: selectedChoice });
              try {
                await addActorAIInteraction(actor, {
                  speaker: _injectRuntime(String(action.speaker ?? "")),
                  ai: latestAiText,
                  user: selectedChoice
                });
              } catch (e) {
                console.warn("SD | Could not record AI dialogue interaction:", e);
              }

              if (buttonDef) {
                const state = { ...(buttonDef.__dlgState ?? {}), ...(result.state ?? {}) };
                if (pickedId) state[pickedId] = pickedLabel;
                if (pinId) state[pinId] = pickedLabel;
                buttonDef.__dlgState = state;
                buttonDef.__dlgPicked = pickedId || pinId || "";
                buttonDef.__dlgChoice = pickedLabel;
                buttonDef.__dlgHistory = JSON.stringify(history);
              }

              if (!infinity || aiResult.continueDialogue === false || aiResult.continueDialogue === "false" || aiResult.continueDialogue === "no") {
                break;
              }
            }

            if (!cancelled && finalResult) {
              if (buttonDef) buttonDef.__dlgHistory = JSON.stringify(history);
              for (const sub of (action.submitActions ?? [])) {
                await this._runAction(sub, item, actor, buttonDef, runtime);
              }
            }
            break;
          }

          const result = await SDDialogueBuilder.show(action, dialogCtx);

          if (buttonDef && result?.state) buttonDef.__dlgState = { ...result.state };
          if (!result || result.cancelled) {
            for (const sub of (action.cancelActions ?? [])) {
              await this._runAction(sub, item, actor, buttonDef, runtime);
            }
            break;
          }

          const pinId = String(result.pinId ?? "");
          const pickedId = String(result.pickedId ?? "");
          const pickedLabel = String(result.pickedLabel ?? (pickedId || pinId));
          const emitFlag = String(result.emitFlag ?? "yes");
          if (buttonDef) {
            const state = { ...(buttonDef.__dlgState ?? {}), ...(result.state ?? {}) };
            if (pickedId) state[pickedId] = pickedLabel;
            if (pinId) state[pinId] = pickedLabel;
            buttonDef.__dlgState = state;
            buttonDef.__dlgPicked = pickedId || pinId || "";
            buttonDef.__dlgChoice = pickedLabel;
          }
          try {
            await addActorAIInteraction(actor, {
              speaker: _injectRuntime(String(action.speaker ?? "")),
              ai: _injectRuntime(String(action.description ?? "")),
              user: pickedLabel
            });
          } catch (e) {
            console.warn("SD | Could not record dialogue interaction:", e);
          }

          if (pinId && (pinId.startsWith("btn") || (/^el\d+_exec$/.test(pinId) && emitFlag === "yes"))) {
            const branch = action[`${pinId}Actions`] ?? [];
            for (const sub of branch) await this._runAction(sub, item, actor, buttonDef, runtime);
          }
          for (const sub of (action.submitActions ?? [])) {
            await this._runAction(sub, item, actor, buttonDef, runtime);
          }
          break;
        } catch (err) {
          console.warn("SD | Dialog Builder custom UI failed, falling back to DialogV2.", err);
        }

        const { DialogV2 } = foundry.applications.api;
        let elements = [];
        if (Array.isArray(action.elements)) {

          elements = action.elements;
        } else if (typeof action.elementsJson === "string" && action.elementsJson.trim() !== "") {

          try {
            const parsed = JSON.parse(action.elementsJson);
            if (Array.isArray(parsed)) elements = parsed;
          } catch (e) {
            ui.notifications?.warn?.("SD | Dialog Builder: bad legacy elementsJson.");
          }
        }
        const title       = action.title       ?? "Dialog";
        const description = action.description ?? "";
        const okLabel     = action.okLabel     ?? "OK";
        const cancelLabel = action.cancelLabel ?? "Cancel";

        const state = {};
        for (const el of elements) {
          if (!el || typeof el !== "object") continue;
          if (el.id == null) continue;
          if (el.type === "rollButton" || el.type === "label" || el.type === "section") continue;
          state[el.id] = (el.default !== undefined) ? el.default : (el.type === "checkbox" ? false : "");
        }

        const _esc = (s) => String(s ?? "").replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
        const _evalCond = (expr, st) => {
          if (!expr) return true;
          let s = String(expr);
          s = s.replace(/\{([A-Za-z_][\w]*)\}/g, (_, id) => {
            const v = st[id];
            if (v === undefined) return "undefined";
            if (typeof v === "boolean") return v ? "true" : "false";
            if (typeof v === "number")  return String(v);
            return JSON.stringify(String(v));
          });
          try { return !!(new Function(`"use strict";return (${s});`))(); } catch { return false; }
        };

        const _renderBody = (st) => {
          const parts = [];
          if (description) {
            parts.push(`<p style="padding:6px 2px 8px;color:#c0c0d8;font-size:12px;line-height:1.5">${_esc(description)}</p>`);
          }
          for (const el of elements) {
            if (!el || typeof el !== "object") continue;
            const visible  = _evalCond(el.visibleWhen,  st);
            const disabled = el.disabledWhen ? _evalCond(el.disabledWhen, st) : false;
            if (!visible) continue;
            const id = _esc(el.id ?? "");
            const lbl = _esc(el.label ?? "");
            const ph  = _esc(el.placeholder ?? "");
            const dis = disabled ? "disabled" : "";
            switch (el.type) {
              case "label":
                parts.push(`<div style="padding:4px 2px;color:#dcdcef;font-weight:600">${_esc(el.text ?? "")}</div>`);
                break;
              case "section":
                parts.push(`<div style="margin:8px 0 4px;padding:4px 8px;border-bottom:1px solid #3a3a4a;color:#c0c0d8;font-size:11px;text-transform:uppercase;letter-spacing:.05em">${_esc(el.text ?? "")}</div>`);
                break;
              case "number":
                parts.push(`<div style="display:flex;gap:8px;align-items:center;margin:4px 0">
                  <label style="flex:0 0 40%;color:#c0c0d8;font-size:12px">${lbl}</label>
                  <input type="number" data-sd-dlg-id="${id}" value="${_esc(st[el.id] ?? "")}" placeholder="${ph}" ${dis}
                         style="flex:1;box-sizing:border-box;padding:5px 7px;background:#1d1d27;color:#e8e8f0;border:1px solid #3a3a4a;border-radius:4px"/>
                </div>`);
                break;
              case "text":
                parts.push(`<div style="display:flex;gap:8px;align-items:center;margin:4px 0">
                  <label style="flex:0 0 40%;color:#c0c0d8;font-size:12px">${lbl}</label>
                  <input type="text" data-sd-dlg-id="${id}" value="${_esc(st[el.id] ?? "")}" placeholder="${ph}" ${dis}
                         style="flex:1;box-sizing:border-box;padding:5px 7px;background:#1d1d27;color:#e8e8f0;border:1px solid #3a3a4a;border-radius:4px"/>
                </div>`);
                break;
              case "checkbox":
                parts.push(`<div style="display:flex;gap:8px;align-items:center;margin:4px 0">
                  <input type="checkbox" data-sd-dlg-id="${id}" ${st[el.id] ? "checked" : ""} ${dis}
                         style="margin:0 4px 0 0"/>
                  <label style="flex:1;color:#c0c0d8;font-size:12px">${lbl}</label>
                </div>`);
                break;
              case "select": {
                let opts = Array.isArray(el.options) ? el.options : [];

                if (el.optionsFrom && actor) {
                  try {
                    const path = String(el.optionsFrom).replace(/^actor\./, "");
                    const raw  = foundry.utils.getProperty(actor, path);
                    let dyn = [];
                    if (Array.isArray(raw)) {
                      dyn = raw.map(v => (v && typeof v === "object")
                        ? { value: String(v.value ?? v.id ?? v.key ?? ""), label: String(v.label ?? v.name ?? v.value ?? "") }
                        : String(v));
                    } else if (raw && typeof raw === "object") {
                      dyn = Object.entries(raw).map(([k, v]) => ({
                        value: k,
                        label: (v && typeof v === "object") ? String(v.label ?? v.name ?? k) : String(v ?? k)
                      }));
                    } else if (typeof raw === "string") {
                      dyn = raw.split(/[\n,]/).map(s => s.trim()).filter(Boolean);
                    }
                    opts = [...opts, ...dyn];
                  } catch (e) { console.warn("SD | Dialog Builder optionsFrom failed:", e); }
                }
                const cur = String(st[el.id] ?? "");
                const optHtml = opts.map(o => {
                  const v = (o && typeof o === "object") ? String(o.value ?? "") : String(o);
                  const t = (o && typeof o === "object") ? String(o.label ?? o.value ?? "") : String(o);
                  return `<option value="${_esc(v)}" ${v === cur ? "selected" : ""}>${_esc(t)}</option>`;
                }).join("");
                parts.push(`<div style="display:flex;gap:8px;align-items:center;margin:4px 0">
                  <label style="flex:0 0 40%;color:#c0c0d8;font-size:12px">${lbl}</label>
                  <select data-sd-dlg-id="${id}" ${dis}
                          style="flex:1;box-sizing:border-box;padding:5px 7px;background:#1d1d27;color:#e8e8f0;border:1px solid #3a3a4a;border-radius:4px">
                    ${optHtml}
                  </select>
                </div>`);
                break;
              }
              case "rollButton":

                break;
              default:
                break;
            }
          }
          return parts.join("");
        };

        const rollButtons = elements
          .map((el, i) => ({ el, idx: i }))
          .filter(({ el }) => el && el.type === "rollButton");
        let dlgButtons = [];
        let btnSeq = 0;
        for (const { el } of rollButtons) {
          const pinId   = (Number.isInteger(el.execIndex)) ? `el${el.execIndex}_exec` : `btn${btnSeq}`;
          btnSeq++;
          if (btnSeq > 8) break;
          dlgButtons.push({
            action: `__sd_${pinId}__${el.id ?? ""}`,
            label:  el.label ?? "Roll",
            icon:   el.icon ?? "fas fa-dice-d20",
            default: false,
            callback: () => `${pinId}|${el.id ?? ""}|${el.emit === false ? "no" : "yes"}`
          });
        }

        dlgButtons.push({
          action:  "__sd_submit",
          label:   okLabel,
          icon:    "fas fa-check",
          default: rollButtons.length === 0,
          callback: () => "submit||yes"
        });
        dlgButtons.push({ action:"cancel", label: cancelLabel, icon:"fas fa-times" });

        let _dlgRoot = null;

        const _syncStateFromDom = () => {
          if (!_dlgRoot) return;
          const inputs = _dlgRoot.querySelectorAll("[data-sd-dlg-id]");
          inputs.forEach(el => {
            const id = el.getAttribute("data-sd-dlg-id");
            if (!id) return;
            if (el.type === "checkbox") state[id] = !!el.checked;
            else if (el.type === "number") state[id] = Number(el.value);
            else state[id] = el.value;
          });
        };

        const _bindInputs = (root) => {
          if (!root) return;
          const inputs = root.querySelectorAll("[data-sd-dlg-id]");
          inputs.forEach(el => {
            if (el.dataset.sdBound === "1") return;
            el.dataset.sdBound = "1";
            const id = el.getAttribute("data-sd-dlg-id");
            const onChange = () => {
              if (el.type === "checkbox") state[id] = !!el.checked;
              else if (el.type === "number") state[id] = Number(el.value);
              else state[id] = el.value;

              const refRe = new RegExp(`\\{${id}\\}`);
              const condDirty = elements.some(e =>
                e && (refRe.test(e.visibleWhen || "") || refRe.test(e.disabledWhen || ""))
              );
              if (condDirty) _refresh(root);
            };
            el.addEventListener("change", onChange);
            el.addEventListener("input",  onChange);
          });
        };

        const _refresh = (root) => {
          if (!root) return;
          try {
            const newHtml = _renderBody(state);
            const target = root.querySelector("[data-sd-dlg-form]")
                        ?? root.querySelector(".dialog-content")
                        ?? root.querySelector(".window-content")
                        ?? root;
            if (target) target.innerHTML = newHtml;
            _bindInputs(root);
          } catch (err) { console.warn("SD | Dialog Builder refresh failed:", err); }
        };

        const _onRender = (root) => {
          if (!root) return;
          _dlgRoot = root;
          _bindInputs(root);
        };

        const result = await new Promise((resolve) => {
          let resolved = false;
          const _finish = (val) => {
            if (resolved) return;
            resolved = true;
            resolve(val);
          };
          const wrappedButtons = dlgButtons.map(b => {
            const orig = b.callback;
            return {
              ...b,
              callback: (...args) => {
                if (b.action === "cancel") { _finish(null); return; }
                _syncStateFromDom();
                const r = (typeof orig === "function") ? orig(...args) : `${b.action}|`;
                _finish(r);
              }
            };
          });

          const bodyHtml = `<div data-sd-dlg-form>${_renderBody(state)}</div>`;

          const _hookId = Hooks.on("renderDialogV2", (app, htmlOrEl) => {
            const root = htmlOrEl?.[0] ?? htmlOrEl ?? app?.element ?? null;
            if (!root?.querySelector?.("[data-sd-dlg-form]")) return;
            _onRender(root);
          });

          const dlg = new DialogV2({
            window:      { title },
            content:     bodyHtml,
            buttons:     wrappedButtons,
            rejectClose: false,
            close:       () => {
              try { Hooks.off("renderDialogV2", _hookId); } catch {}
              _finish(null);
            },
            render: (_e, dialog) => {
              const root = dialog?.element ?? null;
              _onRender(root);
            }
          });
          dlg.render(true);

          Promise.resolve().then(() => {

          });
        });

        if (buttonDef) buttonDef.__dlgState = { ...state };
        if (result === null || result === undefined) {
          for (const sub of (action.cancelActions ?? [])) {
            await this._runAction(sub, item, actor, buttonDef, runtime);
          }
          break;
        }
        const [pinId, pickedId, emitFlag] = String(result).split("|");
        const pickedEl = elements.find(el => String(el?.id ?? "") === String(pickedId ?? ""));
        const pickedLabel = String(pickedEl?.label ?? pickedId ?? pinId ?? "");
        if (buttonDef) {
          const st = { ...(buttonDef.__dlgState ?? {}) };
          if (pickedId) st[pickedId] = pickedLabel;
          if (pinId) st[pinId] = pickedLabel;
          buttonDef.__dlgState = st;
          buttonDef.__dlgPicked = pickedId || pinId || "";
          buttonDef.__dlgChoice = pickedLabel;
        }

        if (pinId && (pinId.startsWith("btn") || (/^el\d+_exec$/.test(pinId) && emitFlag === "yes"))) {
          const branch = action[`${pinId}Actions`] ?? [];
          for (const sub of branch) await this._runAction(sub, item, actor, buttonDef, runtime);
        }
        for (const sub of (action.submitActions ?? [])) {
          await this._runAction(sub, item, actor, buttonDef, runtime);
        }
        break;
      }

      case "createEffect": {
        const _ceSpec = action.target != null ? _injectRuntime(String(action.target)) : null;
        const targets = _resolveAllTargets(_ceSpec ?? "token_target", actor);
        if (!targets.length) { ui.notifications.warn("SD | Create Effect: no target."); break; }
        const rounds = Number(action.duration ?? 0);
        const effectData = {
          name:     action.name     ?? "New Effect",
          img:      action.icon     ?? "icons/svg/aura.svg",
          disabled: !!action.disabled,
          transfer: action.transfer !== false,
          duration: durationForRounds(rounds),
          changes:  (action.changes ?? []).filter(c => c.key),
          origin:   item?.uuid ?? actor?.uuid ?? "",
          flags:    { sd: { sourceItemId: item?.id ?? "" } }
        };
        for (const tActor of targets) {
          if (!tActor) continue;
          if (!game.user.isGM && !tActor.isOwner) continue;
          await tActor.createEmbeddedDocuments("ActiveEffect", [effectData]);
        }
        break;
      }

      case "removeEffect": {
        const effectName = action.name ?? action.effectName ?? "";
        if (!effectName) break;
        const _reSpec = action.target != null ? _injectRuntime(String(action.target)) : null;
        const targets = _resolveAllTargets(_reSpec ?? "token_target", actor);
        for (const tActor of targets) {
          if (!tActor || (!game.user.isGM && !tActor.isOwner)) continue;
          const toDelete = tActor.effects.filter(e => e.name === effectName).map(e => e.id);
          if (toDelete.length) await tActor.deleteEmbeddedDocuments("ActiveEffect", toDelete);
        }
        break;
      }

      case "toggleEffect": {
        const effectName = action.name ?? "";
        if (!effectName) break;
        const _teSpec = action.target != null ? _injectRuntime(String(action.target)) : null;
        const targets = _resolveAllTargets(_teSpec ?? "token_target", actor);
        for (const tActor of targets) {
          if (!tActor || (!game.user.isGM && !tActor.isOwner)) continue;
          for (const ef of tActor.effects) {
            if (ef.name !== effectName) continue;
            const newState = action.state === "enable" ? false
                           : action.state === "disable" ? true
                           : !ef.disabled;
            await ef.update({ disabled: newState });
          }
        }
        break;
      }

      case "setInitiative": {
        const combat = game.combat;
        if (!combat) {
          ui.notifications?.warn?.("Set Initiative: no active combat.");
          break;
        }
        const _siSpec = action.target != null ? _injectRuntime(String(action.target)) : null;
        const targets = _resolveAllTargets(_siSpec ?? "actor", actor);
        for (const tActor of targets) {
          if (!tActor) continue;
          const token = tActor.getActiveTokens?.()?.[0]?.document
                     ?? canvas?.tokens?.placeables?.find?.(t => t.actor?.id === tActor.id)?.document;
          let combatant = combat.combatants.find(c => c.actorId === tActor.id);
          if (!combatant) {
            const created = await combat.createEmbeddedDocuments("Combatant", [{
              actorId: tActor.id,
              tokenId: token?.id ?? null,
              sceneId: token?.parent?.id ?? canvas?.scene?.id ?? null
            }]);
            combatant = created?.[0];
          }
          if (!combatant) continue;
          if (action.mode === "value") {
            const v = Number(action.value ?? 0) || 0;
            await combat.setInitiative(combatant.id, v);
          } else {
            await combat.rollInitiative([combatant.id]);
          }
        }
        break;
      }

      case "applyStatus": {
        const raw = String(action.statusId ?? "").trim();
        if (!raw) break;
        const reg = (CONFIG.statusEffects ?? []);
        const match = reg.find(s => s.id === raw)
                   ?? reg.find(s => (s.label ?? s.name ?? "").toLowerCase() === raw.toLowerCase())
                   ?? reg.find(s => game.i18n?.localize?.(s.label ?? s.name ?? "")?.toLowerCase?.() === raw.toLowerCase());
        const statusId = match?.id ?? raw;
        const _asSpec = action.target != null ? _injectRuntime(String(action.target)) : null;
        const targets  = _resolveAllTargets(_asSpec ?? "token_target", actor);
        for (const tActor of targets) {
          if (!tActor || (!game.user.isGM && !tActor.isOwner)) continue;
          const has = tActor.statuses?.has?.(statusId);
          let active;
          if (action.mode === "remove") active = false;
          else if (action.mode === "toggle") active = !has;
          else active = true;
          try {
            await tActor.toggleStatusEffect(statusId, { active, overlay: !!action.overlay });
          } catch (err) {
            console.warn(`SD | applyStatus failed for ${tActor.name}/${statusId}:`, err);
          }
        }
        break;
      }

      case "placeAura":
      case "placeAuraEffect":
      case "placeAuraDamage":
      case "placeAuraHeal":
      case "placeAuraSaveEffect":
      case "placeAuraSaveBranch":
      case "placeAuraTargets": {
        if (!canvas?.scene) break;
        action = {
          ...action,
          formula:      action.formula      != null ? _injectRuntime(String(action.formula))      : action.formula,
          bonusFormula: action.bonusFormula != null ? _injectRuntime(String(action.bonusFormula)) : action.bonusFormula,
          advFormula:   action.advFormula   != null ? _injectRuntime(String(action.advFormula))   : action.advFormula,
          disFormula:   action.disFormula   != null ? _injectRuntime(String(action.disFormula))   : action.disFormula,
          dc:           action.dc           != null ? _injectRuntime(String(action.dc))           : action.dc
        };

        let ownerToken = null;
        if (action.owner === "selected_token") {
          ownerToken = canvas.tokens?.controlled?.[0] ?? null;
        } else if (action.owner === "token_target") {
          const first = game.user?.targets ? [...game.user.targets][0] : null;
          ownerToken = first ?? null;
        } else {
          ownerToken = actor?.getActiveTokens?.()?.[0] ?? canvas.tokens?.controlled?.[0] ?? null;
        }
        if (!ownerToken) {
          ui.notifications?.warn?.("Place Aura: no owner token found.");
          break;
        }
        const { buildEmanationShape, buildShape, placeAuraRegion } =
          await import("./sd-region.mjs");

        const shapeKind = action.shape ?? "emanation";
        const size      = Number(action.size ?? 10) || 10;
        const auraKey   = String(action.auraKey ?? "aura");
        const effName   = String(action.name    ?? "Aura");
        const rounds    = Number(action.rounds  ?? 0) || 0;

        const modeMap = {
          placeAuraEffect:      "effect",
          placeAuraDamage:      "damage",
          placeAuraHeal:        "heal",
          placeAuraSaveEffect:  "save-effect",
          placeAuraSaveBranch:  "save-branch",
          placeAuraTargets:     "targets"
        };
        const mode = modeMap[action.type] ?? action.mode ?? "effect";

        const shape = shapeKind === "emanation"
          ? buildEmanationShape(ownerToken.document, size)
          : buildShape(shapeKind, size, Number(action.angle ?? 53.13));

        const applyEffect = {
          mode,
          effectName:        effName || "Aura",
          effectImg:         action.icon ?? "icons/svg/aura.svg",
          auraKey,
          skipOwner:         action.skipOwner !== false,
          ownerTokenId:      ownerToken.id,
          changes:           Array.isArray(action.changes) ? action.changes : [],
          tickMode:          action.tickMode ?? "onEnter",
          showInChat:        action.showInChat !== false,
          chatMode:          action.chatMode ?? "auto",
          applyMode:         action.applyMode ?? "auto",
          rollApplyMode:     action.rollApplyMode ?? "per_target",
          visibility:        action.visibility ?? "everyone",
          deactivateOnLeave: action.deactivateOnLeave !== false,
          conditionEffect:   action.conditionEffect ?? "",
          roundsRemaining:   rounds,

          formula:           action.formula      ?? "",
          bonusFormula:      action.bonusFormula ?? "",
          damageType:        action.damageType   ?? "",
          hpPath:            action.hpPath       ?? "system.resources.hp.value",
          hpMode:            action.hpMode       ?? "add",
          saveAttr:          action.saveAttr    ?? "system.attributes.dex.value",
          dc:                (v => Number.isFinite(v) ? v : 15)(Number(action.dc  ?? 15)),
          flavor:            action.flavor      ?? "Saving Throw",
          advMode:           action.advMode     ?? "none",
          advFormula:        action.advFormula  ?? "",
          disFormula:        action.disFormula  ?? "",

          rollMode:          action.rollMode    ?? "public",
          postActions:       action.postActions ?? [],
          srcActorId:        actor?.id          ?? "",
          srcItemUuid:       item?.uuid         ?? "",
          runtimeSnapshot:   (() => {
            if (!buttonDef) return null;
            const o = {};
            for (const k of ["__lastRoll","__lastMargin","__lastSuccesses","__lastBotches","__progPrev","__opposedWinnerRoll","__lastDice","__lastIsCrit","__lastCritFormula","__lastIsFumble","__lastFumbleFormula","__lastNatural","__lastFormula","__lastMin","__lastMax","__lastAvg"]) {
              if (buttonDef[k] !== undefined) o[k] = buttonDef[k];
            }
            return Object.keys(o).length ? o : null;
          })()
        };

        try {
          await placeAuraRegion({
            ownerToken,
            shape,
            name: effName || "SD Aura",
            flags: {
              sd: {
                aura: {
                  key:          auraKey,
                  ownerTokenId: ownerToken.id,
                  ownerSceneId: canvas.scene.id,
                  effectName:   effName
                },
                applyEffect
              }
            }
          });
        } catch (e) {
          console.error("SD | placeAura failed:", e);
        }
        break;
      }

      case "placeAoeEffect":
      case "placeAoeDamage":
      case "placeAoeHeal":
      case "placeAoeSaveEffect": {
        action = {
          ...action,
          formula:      action.formula      != null ? _injectRuntime(String(action.formula))      : action.formula,
          bonusFormula: action.bonusFormula != null ? _injectRuntime(String(action.bonusFormula)) : action.bonusFormula,
          advFormula:   action.advFormula   != null ? _injectRuntime(String(action.advFormula))   : action.advFormula,
          disFormula:   action.disFormula   != null ? _injectRuntime(String(action.disFormula))   : action.disFormula,
          dc:           action.dc           != null ? _injectRuntime(String(action.dc))           : action.dc
        };
        const modeMap = {
          placeAoeEffect:     "effect",
          placeAoeDamage:     "damage",
          placeAoeHeal:       "heal",
          placeAoeSaveEffect: "save-effect"
        };
        const mode       = modeMap[action.type];
        const shape      = action.shape ?? "circle";
        const size       = Number(action.size   ?? 20)    || 20;
        const angle      = Number(action.angle  ?? 53.13) || 53.13;
        const rounds     = Number(action.rounds ?? 0)     || 0;
        const effName    = String(action.name ?? "AoE");
        const cardTitle  = String(action.cardTitle ?? effName);
        const shapeIcon  = { circle:"fa-circle", cone:"fa-ice-cream", ray:"fa-arrows-alt-h", rect:"fa-square" }[shape] ?? "fa-circle";

        const persist = action.persist !== false;
        const cfg = JSON.stringify({
          type: "aoeRegion",
          mode,
          shape,
          size,
          angle,
          rounds,
          persist,
          effectName:        effName,
          effectImg:         action.icon ?? "icons/svg/aura.svg",
          changes:           Array.isArray(action.changes) ? action.changes : [],
          tickMode:          action.tickMode ?? "onEnter",
          showInChat:        action.showInChat !== false,
          chatMode:          action.chatMode ?? "auto",
          applyMode:         action.applyMode ?? "auto",
          rollApplyMode:     action.rollApplyMode ?? "per_target",
          visibility:        action.visibility ?? "everyone",
          deactivateOnLeave: action.deactivateOnLeave !== false,
          conditionEffect:   action.conditionEffect ?? "",
          formula:           action.formula      ?? "",
          bonusFormula:      action.bonusFormula ?? "",
          damageType:        action.damageType   ?? "",
          hpPath:            action.hpPath       ?? "system.resources.hp.value",
          hpMode:            action.hpMode       ?? "add",
          saveAttr:          action.saveAttr    ?? "system.attributes.dex.value",
          dc:                (v => Number.isFinite(v) ? v : 15)(Number(action.dc ?? 15)),
          flavor:            action.flavor     ?? "Saving Throw",
          advMode:           action.advMode    ?? "none",
          advFormula:        action.advFormula ?? "",
          disFormula:        action.disFormula ?? "",
          srcActorId:        actor?.id ?? ""
        }).replace(/'/g, "&#39;");

        const modeLabel = {
          effect:        "Effect",
          damage:        "Damage",
          heal:          "Heal",
          "save-effect": "Save → Effect"
        }[mode];

        const cardHtml = `
<div class="sd-chat-aoe-card sd-chat-card sd-aoe-card" style="background:#f0ebe4;color:#191813;border:1px solid #b5b3a4;border-radius:4px;padding:8px 10px;font-family:'Signika',sans-serif;">
  <header class="sd-chat-aoe-header" style="background:transparent;color:#191813;display:flex;align-items:center;gap:8px;padding:0 0 6px 0;margin:0 0 8px 0;border-bottom:1px solid #b5b3a4;font-size:14px;font-weight:600;">
    <i class="fas fa-burst" style="opacity:.75;"></i>
    <strong style="color:#191813;">${cardTitle}</strong>
    <span class="sd-chat-aoe-mode" style="color:#555;font-weight:400;"> — ${modeLabel}</span>
  </header>
  <div class="sd-chat-aoe-info" style="color:#191813;display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;font-size:12px;margin-bottom:8px;">
    <span style="color:#191813;"><i class="fas ${shapeIcon}" style="opacity:.6;margin-right:4px;"></i>${shape}</span>
    <span style="color:#191813;"><i class="fas fa-ruler" style="opacity:.6;margin-right:4px;"></i>${size} ft</span>
    ${action.formula ? `<span style="color:#191813;"><i class="fas fa-dice-d20" style="opacity:.6;margin-right:4px;"></i>${action.formula}${action.damageType ? ` (${action.damageType})` : ""}</span>` : ""}
    ${mode === "save-effect" ? `<span style="color:#191813;"><i class="fas fa-shield-alt" style="opacity:.6;margin-right:4px;"></i>DC ${Number(action.dc ?? 15)}</span>` : ""}
    ${rounds ? `<span style="color:#191813;"><i class="fas fa-clock" style="opacity:.6;margin-right:4px;"></i>${rounds} rd</span>` : ""}
  </div>
  <button type="button" class="sd-chat-aoe-place-btn" data-aoe-region-cfg='${cfg}' style="width:100%;padding:8px;background:#e0dcd4;color:#191813;border:1px solid #7a7971;border-radius:4px;font-weight:600;font-size:13px;cursor:pointer;">
    <i class="fas fa-crosshairs"></i> Place Template
  </button>
</div>`;

        await ChatMessage.create({
          content: cardHtml,
          speaker: ChatMessage.getSpeaker({ actor }),
          flags:   { sd: { aoeRegion: true } }
        });
        break;
      }

      case "placeAoeSaveBranch": {
        action = {
          ...action,
          dc:           action.dc           != null ? _injectRuntime(String(action.dc))           : action.dc,
          advFormula:   action.advFormula   != null ? _injectRuntime(String(action.advFormula))   : action.advFormula,
          disFormula:   action.disFormula   != null ? _injectRuntime(String(action.disFormula))   : action.disFormula,
          bonusFormula: action.bonusFormula != null ? _injectRuntime(String(action.bonusFormula)) : action.bonusFormula
        };
        const shape       = action.shape ?? "circle";
        const size        = Number(action.size  ?? 20)    || 20;
        const angle       = Number(action.angle ?? 53.13) || 53.13;
        const cardTitle   = String(action.cardTitle ?? "AoE Save");
        const shapeIcon   = { circle:"fa-circle", cone:"fa-ice-cream", ray:"fa-arrows-alt-h", rect:"fa-square" }[shape] ?? "fa-circle";

        const _rtSnap = (() => {
          if (!buttonDef) return null;
          const o = {};
          for (const k of ["__lastRoll","__lastMargin","__lastSuccesses","__lastBotches","__progPrev","__opposedWinnerRoll"]) {
            if (buttonDef[k] !== undefined) o[k] = buttonDef[k];
          }
          return Object.keys(o).length ? o : null;
        })();

        const cfg = JSON.stringify({
          type:         "aoeSaveBranch",
          shape, size, angle,
          saveAttr:     action.saveAttr ?? "system.attributes.dex.value",
          dc:           (v => Number.isFinite(v) ? v : 15)(Number(action.dc ?? 15)),
          flavor:       action.flavor    ?? "Saving Throw",
          rollMode:     action.rollMode  ?? "public",
          showInChat:   action.showInChat !== false,
          advMode:      action.advMode    ?? "none",
          advFormula:   action.advFormula ?? "",
          disFormula:   action.disFormula ?? "",
          bonusFormula: action.bonusFormula ?? "",
          persist:      action.persist === true,
          postActions:  action.postActions ?? [],
          runtimeSnapshot: _rtSnap,
          srcActorId:   actor?.id ?? "",
          srcItemUuid:  item?.uuid ?? ""
        }).replace(/'/g, "&#39;");

        const cardHtml = `
<div class="sd-chat-aoe-card sd-chat-card sd-aoe-card" style="background:#f0ebe4;color:#191813;border:1px solid #b5b3a4;border-radius:4px;padding:8px 10px;font-family:'Signika',sans-serif;">
  <header class="sd-chat-aoe-header" style="background:transparent;color:#191813;display:flex;align-items:center;gap:8px;padding:0 0 6px 0;margin:0 0 8px 0;border-bottom:1px solid #b5b3a4;font-size:14px;font-weight:600;">
    <i class="fas fa-burst" style="opacity:.75;"></i>
    <strong style="color:#191813;">${cardTitle}</strong>
    <span class="sd-chat-aoe-mode" style="color:#555;font-weight:400;"> — Save Branch</span>
  </header>
  <div class="sd-chat-aoe-info" style="color:#191813;display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;font-size:12px;margin-bottom:8px;">
    <span style="color:#191813;"><i class="fas ${shapeIcon}" style="opacity:.6;margin-right:4px;"></i>${shape}</span>
    <span style="color:#191813;"><i class="fas fa-ruler" style="opacity:.6;margin-right:4px;"></i>${size} ft</span>
    <span style="color:#191813;"><i class="fas fa-shield-alt" style="opacity:.6;margin-right:4px;"></i>DC ${Number(action.dc ?? 15)}</span>
  </div>
  <div class="sd-chat-aoe-results" style="display:none;color:#191813;font-size:12px;margin-bottom:8px;"></div>
  <button type="button" class="sd-chat-aoe-save-branch-btn" data-aoe-save-branch-cfg='${cfg}' style="width:100%;padding:8px;background:#e0dcd4;color:#191813;border:1px solid #7a7971;border-radius:4px;font-weight:600;font-size:13px;cursor:pointer;">
    <i class="fas fa-crosshairs"></i> Place Template
  </button>
</div>`;

        await ChatMessage.create({
          content: cardHtml,
          speaker: ChatMessage.getSpeaker({ actor }),
          flags:   { sd: { aoeSaveBranch: true } }
        });
        break;
      }

      case "placeAoeTargets": {
        const shape       = action.shape ?? "circle";
        const size        = Number(action.size  ?? 20)    || 20;
        const angle       = Number(action.angle ?? 53.13) || 53.13;
        const cardTitle   = String(action.cardTitle ?? "AoE Targets");
        const shapeIcon   = { circle:"fa-circle", cone:"fa-ice-cream", ray:"fa-arrows-alt-h", rect:"fa-square" }[shape] ?? "fa-circle";

        const _rtSnap = (() => {
          if (!buttonDef) return null;
          const o = {};
          for (const k of ["__lastRoll","__lastMargin","__lastSuccesses","__lastBotches","__progPrev","__opposedWinnerRoll","__lastDice","__lastIsCrit","__lastCritFormula","__lastIsFumble","__lastFumbleFormula","__lastNatural","__lastFormula","__lastMin","__lastMax","__lastAvg"]) {
            if (buttonDef[k] !== undefined) o[k] = buttonDef[k];
          }
          return Object.keys(o).length ? o : null;
        })();

        const cfg = JSON.stringify({
          type:         "aoeTargets",
          shape, size, angle,
          persist:      action.persist === true,
          postActions:  action.postActions ?? [],
          runtimeSnapshot: _rtSnap,
          srcActorId:   actor?.id ?? "",
          srcItemUuid:  item?.uuid ?? ""
        }).replace(/'/g, "&#39;");

        const cardHtml = `
<div class="sd-chat-aoe-card sd-chat-card sd-aoe-card" style="background:#f0ebe4;color:#191813;border:1px solid #b5b3a4;border-radius:4px;padding:8px 10px;font-family:'Signika',sans-serif;">
  <header class="sd-chat-aoe-header" style="background:transparent;color:#191813;display:flex;align-items:center;gap:8px;padding:0 0 6px 0;margin:0 0 8px 0;border-bottom:1px solid #b5b3a4;font-size:14px;font-weight:600;">
    <i class="fas fa-burst" style="opacity:.75;"></i>
    <strong style="color:#191813;">${cardTitle}</strong>
    <span class="sd-chat-aoe-mode" style="color:#555;font-weight:400;"> — Targets</span>
  </header>
  <div class="sd-chat-aoe-info" style="color:#191813;display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;font-size:12px;margin-bottom:8px;">
    <span style="color:#191813;"><i class="fas ${shapeIcon}" style="opacity:.6;margin-right:4px;"></i>${shape}</span>
    <span style="color:#191813;"><i class="fas fa-ruler" style="opacity:.6;margin-right:4px;"></i>${size} ft</span>
  </div>
  <div class="sd-chat-aoe-results" style="display:none;color:#191813;font-size:12px;margin-bottom:8px;"></div>
  <button type="button" class="sd-chat-aoe-targets-btn" data-aoe-targets-cfg='${cfg}' style="width:100%;padding:8px;background:#e0dcd4;color:#191813;border:1px solid #7a7971;border-radius:4px;font-weight:600;font-size:13px;cursor:pointer;">
    <i class="fas fa-crosshairs"></i> Place Template
  </button>
</div>`;

        await ChatMessage.create({
          content: cardHtml,
          speaker: ChatMessage.getSpeaker({ actor }),
          flags:   { sd: { aoeTargets: true } }
        });
        break;
      }

      case "removeAura": {
        if (!canvas?.scene) break;
        let ownerToken = null;
        if (action.owner === "selected_token") {
          ownerToken = canvas.tokens?.controlled?.[0] ?? null;
        } else if (action.owner === "token_target") {
          const first = game.user?.targets ? [...game.user.targets][0] : null;
          ownerToken = first ?? null;
        } else {
          ownerToken = actor?.getActiveTokens?.()?.[0] ?? canvas.tokens?.controlled?.[0] ?? null;
        }
        if (!ownerToken) break;
        const key = String(action.auraKey ?? "aura");

        const matchedRegions = (canvas.scene.regions ?? []).filter(r => {
          const a = r.flags?.sd?.aura;
          if (!a) return false;
          if (a.key !== key) return false;
          if (a.ownerTokenId && a.ownerTokenId !== ownerToken.id) return false;
          return true;
        });
        const regionIds = matchedRegions.map(r => r.id);
        const effNames  = [...new Set(matchedRegions.map(r => r.flags?.sd?.aura?.effectName).filter(Boolean))];

        if (regionIds.length) {
          try { await canvas.scene.deleteEmbeddedDocuments("Region", regionIds); } catch (e) {
            console.warn("SD | removeAura: deleteRegion failed:", e);
          }
        }

        const legacyMatched = (canvas.scene.templates ?? []).filter(t => {
          const a = t.flags?.sd?.aura;
          return a && a.ownerTokenId === ownerToken.id && a.key === key;
        });
        if (legacyMatched.length) {
          for (const t of legacyMatched) {
            const n = t.flags?.sd?.aura?.effectName;
            if (n) effNames.push(n);
          }
          try {
            await canvas.scene.deleteEmbeddedDocuments("MeasuredTemplate",
              legacyMatched.map(t => t.id));
          } catch {}
        }

        for (const effName of effNames) {
          for (const tok of canvas.tokens?.placeables ?? []) {
            const a = tok.actor;
            if (!a) continue;
            const ids = a.effects
              .filter(e => e.name === effName &&
                      (e.flags?.sd?.auraKey === key
                    || e.flags?.sd?.fromAura === key))
              .map(e => e.id);
            if (ids.length && (game.user.isGM || a.isOwner)) {
              try { await a.deleteEmbeddedDocuments("ActiveEffect", ids); } catch {}
            }
          }
        }
        break;
      }

      case "aiRequest": {

        let _aiFE = null;
        try {
          const mod = await import("./formula-engine.mjs");
          _aiFE = mod?.FormulaEngine ?? null;
        } catch {  }
        const _aiDoc = item ?? actor ?? {};

        const _aiResolveTokens = (s) => {
          if (!_aiFE) return s;
          try {
            return s.replace(/\{([^}]+)\}/g, (match, inner) => {
              try {
                const v = _aiFE._resolveToken
                  ? _aiFE._resolveToken(inner.trim(), _aiDoc)
                  : null;
                return (v == null) ? match : String(v);
              } catch { return match; }
            });
          } catch { return s; }
        };
        const _runStr = (raw) => {
          if (raw == null) return "";
          let s = String(raw);

          try { s = _injectRuntime(s); } catch {}

          s = _aiResolveTokens(s);
          return s;
        };
        const provider = getAIProviderConfig({
          providerProfile: _runStr(action.providerProfile || ""),
          url: _runStr(action.url || ""),
          apiKey: _runStr(action.apiKey || ""),
          apiKeySetting: _runStr(action.apiKeySetting || ""),
          model: _runStr(action.model || ""),
          temperature: action.temperature,
          maxTokens: action.maxTokens
        });
        const url        = String(provider.url ?? "").trim();
        let   apiKey     = String(provider.apiKey ?? "").trim();
        const model      = String(provider.model || "gpt-4o-mini").trim();
        const sysPrompt  = [_runStr(provider.systemPrompt || ""), _runStr(action.systemPrompt || "")]
          .map(s => String(s ?? "").trim()).filter(Boolean).join("\n\n");
        const userPrompt = _runStr(action.prompt || "");
        const temperature = provider.temperature === "" || provider.temperature == null
          ? null
          : Number(provider.temperature);
        const maxTokens  = provider.maxTokens === "" || provider.maxTokens == null
          ? null
          : Math.max(1, Number(provider.maxTokens) | 0);
        const postToChat = action.toChat === "yes" || action.toChat === true;

        const settingKey = String(provider.apiKeySetting ?? "").trim();
        if (!apiKey && settingKey) {
          try {
            const v = game.settings.get("sd", settingKey);
            if (v) apiKey = String(v).trim();
          } catch {  }
        }

        runtime.__lastAiResponse = "";
        runtime.__lastAiError    = "";

        if (!url) {
          ui.notifications.warn("SD | AI Request: URL is empty.");
          for (const sub of (action.errorActions ?? [])) {
            await this._runAction(sub, item, actor, buttonDef, runtime);
          }
          break;
        }
        if (!userPrompt) {
          ui.notifications.warn("SD | AI Request: prompt is empty.");
          for (const sub of (action.errorActions ?? [])) {
            await this._runAction(sub, item, actor, buttonDef, runtime);
          }
          break;
        }

        const messages = [];
        if (sysPrompt) messages.push({ role: "system", content: sysPrompt });
        messages.push({ role: "user", content: userPrompt });

        const body = { model, messages };
        if (temperature !== null && !isNaN(temperature)) body.temperature = temperature;
        if (maxTokens   !== null && !isNaN(maxTokens))   body.max_tokens  = maxTokens;

        let responseText = "";
        let errMsg = "";
        try {
          const headers = { "Content-Type": "application/json" };
          if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

          const r = await fetch(url, {
            method:  "POST",
            headers,
            body:    JSON.stringify(body)
          });
          if (!r.ok) {
            const txt = await r.text().catch(() => "");
            throw new Error(`HTTP ${r.status} ${r.statusText} — ${txt.slice(0, 400)}`);
          }
          const data = await r.json();
          responseText =
              data?.choices?.[0]?.message?.content
            ?? data?.choices?.[0]?.text
            ?? data?.message?.content
            ?? "";
          if (typeof responseText !== "string") responseText = JSON.stringify(responseText);
        } catch (e) {
          errMsg = String(e?.message ?? e);
          console.error("SD | AI Request failed:", e);
        }

        runtime.__lastAiResponse = responseText;
        runtime.__lastAiError    = errMsg;

        if (errMsg) {
          ui.notifications.warn(`SD | AI Request failed: ${errMsg}`);
          for (const sub of (action.errorActions ?? [])) {
            await this._runAction(sub, item, actor, buttonDef, runtime);
          }
          break;
        }

        if (postToChat && responseText) {
          const flavor = action.flavor ?? "AI";
          const safeText = String(responseText)
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/\n/g, "<br>");
          await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor }),
            content: `<div class="sd-chat-card sd-ai-card"
                         style="background:#0f0f1f;border:1px solid #4a4a6a;
                                border-top:3px solid #6868c0;border-radius:6px;
                                font-family:'Signika Negative',serif;overflow:hidden;
                                box-shadow:0 2px 8px rgba(0,0,0,.5)">
                       <div style="padding:6px 12px;border-bottom:1px solid #2a2a4a;
                                   background:rgba(0,0,0,.25);font-size:11px;
                                   color:#a0a0c0;display:flex;align-items:center;gap:6px;">
                         <i class="fas fa-robot" style="color:#8080c0"></i>
                         <span style="flex:1;text-transform:uppercase;letter-spacing:.5px">${flavor}</span>
                         <span style="font-size:9px;color:#6a6a8a">${model}</span>
                       </div>
                       <div style="padding:8px 12px;font-size:12px;color:#d0d0e0;line-height:1.4;">
                         ${safeText}
                       </div>
                     </div>`
          });
        }

        for (const sub of (action.successActions ?? [])) {
          await this._runAction(sub, item, actor, buttonDef, runtime);
        }
        break;
      }

      case "aiAssistant": {
        let _aiFE = null;
        try {
          const mod = await import("./formula-engine.mjs");
          _aiFE = mod?.FormulaEngine ?? null;
        } catch { }
        const _aiDoc = item ?? actor ?? {};
        const _aiResolveTokens = (s) => {
          if (!_aiFE) return s;
          try {
            return s.replace(/\{([^}]+)\}/g, (match, inner) => {
              try {
                const v = _aiFE._resolveToken
                  ? _aiFE._resolveToken(inner.trim(), _aiDoc)
                  : null;
                return (v == null) ? match : String(v);
              } catch { return match; }
            });
          } catch { return s; }
        };
        const _runStr = (raw) => {
          if (raw == null) return "";
          let s = String(raw);
          try { s = _injectRuntime(s); } catch {}
          return _aiResolveTokens(s);
        };

        runtime.__lastAiResponse = "";
        runtime.__lastAiError = "";

        const actorContext = action.includeActorContext === false || action.includeActorContext === "no"
          ? ""
          : buildAIDialogueContext({ actor, item });
        const systemPrompt = [
          actorContext,
          _runStr(action.systemPrompt || "You are an AI assistant inside a Foundry VTT node graph.")
        ].map(s => String(s ?? "").trim()).filter(Boolean).join("\n\n");
        const userPrompt = [
          _runStr(action.context || "").trim() ? `Context:\n${_runStr(action.context || "").trim()}` : "",
          _runStr(action.prompt || "").trim() ? `Request:\n${_runStr(action.prompt || "").trim()}` : ""
        ].filter(Boolean).join("\n\n");
        const provider = getAIProviderConfig({
          providerProfile: _runStr(action.providerProfile || "assistant"),
          url: _runStr(action.url || ""),
          apiKey: _runStr(action.apiKey || ""),
          apiKeySetting: _runStr(action.apiKeySetting || ""),
          model: _runStr(action.model || ""),
          temperature: action.temperature,
          maxTokens: action.maxTokens
        });

        if (!userPrompt.trim()) {
          runtime.__lastAiError = "Prompt is empty.";
          ui.notifications?.warn?.("SD | AI Assistant: prompt is empty.");
          for (const sub of (action.errorActions ?? [])) {
            await this._runAction(sub, item, actor, buttonDef, runtime);
          }
          break;
        }

        try {
          const responseText = await requestAIChat({ provider, systemPrompt, prompt: userPrompt });
          runtime.__lastAiResponse = String(responseText ?? "");
          if (action.toChat === true || action.toChat === "yes") {
            const flavor = action.flavor ?? "AI Assistant";
            const safeText = String(runtime.__lastAiResponse)
              .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
              .replace(/\n/g, "<br>");
            await ChatMessage.create({
              speaker: ChatMessage.getSpeaker({ actor }),
              content: `<div class="sd-chat-card sd-ai-card"
                           style="background:#101622;border:1px solid #3d5d82;border-top:3px solid #6aa4df;border-radius:6px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.45)">
                         <div style="padding:6px 12px;border-bottom:1px solid rgba(255,255,255,.12);background:rgba(0,0,0,.24);font-size:11px;color:#b9d5f0;display:flex;align-items:center;gap:6px;">
                           <i class="fas fa-brain"></i>
                           <span style="flex:1;text-transform:uppercase;letter-spacing:.5px">${flavor}</span>
                           <span style="font-size:9px;color:#86a6c4">${provider.model}</span>
                         </div>
                         <div style="padding:8px 12px;font-size:12px;color:#e4edf6;line-height:1.4;">${safeText}</div>
                       </div>`
            });
          }
          for (const sub of (action.successActions ?? [])) {
            await this._runAction(sub, item, actor, buttonDef, runtime);
          }
        } catch (e) {
          const errMsg = String(e?.message ?? e);
          runtime.__lastAiError = errMsg;
          console.warn("SD | AI Assistant failed:", e);
          ui.notifications?.warn?.(`SD | AI Assistant failed: ${errMsg}`);
          for (const sub of (action.errorActions ?? [])) {
            await this._runAction(sub, item, actor, buttonDef, runtime);
          }
        }
        break;
      }

      case "aiMemoryUpdate": {
        const _runStr = (raw) => {
          if (raw == null) return "";
          let s = String(raw);
          try { s = _injectRuntime(s); } catch {}
          return s;
        };
        runtime.__lastAiError = "";
        runtime.__aiMemoryCount = 0;

        const mode = String(action.mode ?? "analyze");
        const contextText = _runStr(action.context ?? "");
        const directMemory = _runStr(action.memoryText ?? "");
        const provider = {
          providerProfile: _runStr(action.providerProfile || "memory"),
          url: _runStr(action.url ?? ""),
          apiKey: _runStr(action.apiKey ?? ""),
          apiKeySetting: _runStr(action.apiKeySetting ?? ""),
          model: _runStr(action.model ?? ""),
          temperature: action.temperature,
          maxTokens: action.maxTokens
        };

        try {
          const memories = [];
          if (mode === "add") {
            if (directMemory.trim()) memories.push(directMemory.trim());
          } else {
            const source = [
              directMemory.trim() ? `Manual note:\n${directMemory.trim()}` : "",
              contextText.trim() ? `Context / dialogue:\n${contextText.trim()}` : "",
              buttonDef?.__dlgHistory ? `Dialogue history:\n${buttonDef.__dlgHistory}` : "",
              runtime.__lastAiResponse ? `Last AI response:\n${runtime.__lastAiResponse}` : ""
            ].filter(Boolean).join("\n\n");
            if (source.trim()) {
              const text = await requestAIChat({
                provider,
                json: true,
                systemPrompt: "You extract durable RPG character memories from dialogue. Return JSON only.",
                prompt: [
                  "Analyze the text and return only memories that the character should remember later.",
                  "Return JSON: {\"memories\":[\"short memory 1\",\"short memory 2\"]}.",
                  "If there is nothing worth remembering, return {\"memories\":[]}.",
                  "",
                  source
                ].join("\n")
              });
              let parsed = null;
              try { parsed = JSON.parse(_sdCleanAiJsonText(text)); } catch { parsed = null; }
              const arr = Array.isArray(parsed?.memories) ? parsed.memories
                : Array.isArray(parsed) ? parsed
                : [];
              for (const m of arr) {
                const value = typeof m === "string" ? m : (m?.text ?? m?.memory ?? "");
                if (String(value ?? "").trim()) memories.push(String(value).trim());
              }
            }
          }

          for (const m of memories) await addActorAIMemory(actor, m, action.source ?? "AI Memory");
          runtime.__aiMemoryCount = memories.length;

          for (const sub of (action.successActions ?? [])) {
            await this._runAction(sub, item, actor, buttonDef, runtime);
          }
        } catch (e) {
          const errMsg = String(e?.message ?? e);
          runtime.__lastAiError = errMsg;
          console.warn("SD | AI Memory Update failed:", e);
          ui.notifications?.warn?.(`SD | AI Memory Update failed: ${errMsg}`);
          for (const sub of (action.errorActions ?? [])) {
            await this._runAction(sub, item, actor, buttonDef, runtime);
          }
        }
        break;
      }

    case "chatSaveButton": {
      const { FormulaEngine } = await import("./formula-engine.mjs");
      const _csbRaw = action.target ?? "token_target";
      const tMode = typeof _csbRaw === "string" ? _injectRuntime(_csbRaw) : _csbRaw;

      let saveActors = [];
      if (tMode === "all_targets") {
        saveActors = [...(game.user.targets ?? [])].map(t => t.actor).filter(Boolean);
      } else if (tMode === "selected_tokens") {
        saveActors = (canvas?.tokens?.controlled ?? []).map(t => t.actor).filter(Boolean);
      } else {

        saveActors = _sdResolveActorsList(tMode, actor);
        if (!saveActors.length) {
          const tActor = _resolveTarget(tMode, actor);
          if (tActor) saveActors = [tActor];
        }
      }

      if (!saveActors.length) {
        ui.notifications.warn("SD | Save/Check Button: no targets. Target or select tokens first.");
        break;
      }

      const _dcDoc = item ?? actor ?? saveActors[0] ?? {};
      const _dcRaw = _injectRuntime(String(action.dc ?? 15));
      let _dcResolved = Number(_dcRaw);
      if (!Number.isFinite(_dcResolved)) {
        try {
          const v = FormulaEngine.evaluate(String(_dcRaw ?? ""), _dcDoc);
          _dcResolved = Number(v);
        } catch { _dcResolved = NaN; }
      }
      if (!Number.isFinite(_dcResolved)) {
        try {
          const v = foundry.utils.getProperty(_dcDoc, String(_dcRaw ?? ""));
          if (v != null) _dcResolved = Number(v);
        } catch {  }
      }
      const resolvedDC = Number.isFinite(_dcResolved) ? _dcResolved : 15;
      const modifierPath = action.modifierPath ?? "system.attributes.attr1.mod";
      const flavor = action.flavor ?? "Saving Throw";
      const buttonLabel = action.buttonLabel ?? "Roll Save";
      const checkType = action.checkType ?? "save";
      const rollMode = action.rollMode ?? "publicroll";
      const rollDialogue = action.rollDialogue ? "yes" : "no";
      const advFormula   = action.advFormula ?? "";
      const disFormula   = action.disFormula ?? "";
      const rollFormula  = action.rollFormula  || "1d20";
      const timeout = Number(action.timeout ?? 0);

      const checkTypeLabel = {
        save:    game.i18n.localize("SD.ChatSave.Save"),
        ability: game.i18n.localize("SD.ChatSave.AbilityCheck"),
        skill:   game.i18n.localize("SD.ChatSave.SkillCheck"),
        custom:  game.i18n.localize("SD.ChatSave.CustomCheck")
      }[checkType] ?? checkType;

      const _resolveDisplayFormula = (raw, ctx) => {
        if (!raw) return "1d20";
        const s = String(raw);
        if (!/[{}]|[A-Za-z_][\w]*\.[A-Za-z_]/.test(s)) return s;
        try { return FormulaEngine.resolveForRoll(s, ctx) || s; }
        catch { return s; }
      };
      const actorRows = saveActors.map(tActor => {
        const _rawMod  = foundry.utils.getProperty(tActor, modifierPath);
        const _modVal  = (_rawMod && typeof _rawMod === "object" && "value" in _rawMod) ? _rawMod.value : _rawMod;
        const saveMod  = Number(_modVal ?? 0) || 0;
        const sign     = saveMod >= 0 ? `+${saveMod}` : String(saveMod);
        const modLbl   = modifierPath.split(".").pop()?.toUpperCase() ?? "MOD";
        const rollDisp = _resolveDisplayFormula(rollFormula, tActor);
        return `
          <div class="sd-save-actor-row" data-actor-id="${tActor.id}"
               style="display:flex;align-items:center;gap:8px;padding:7px 0;
                      border-bottom:1px solid #e0dcd4;">
            <img src="${tActor.img ?? "icons/svg/mystery-man.svg"}"
                 style="width:30px;height:30px;border-radius:50%;border:2px solid #7a3a00;
                        object-fit:cover;flex-shrink:0;">
            <div style="flex:1;min-width:0;">
              <div style="font-size:12px;font-weight:700;color:#191813;
                          overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${tActor.name}</div>
              <div style="font-size:10px;color:#8888a0;">${rollDisp} <span style="color:#c8a0ff">${sign}</span>
                   <span style="color:#555555;margin-left:4px;">${modLbl}</span></div>
            </div>
            <button type="button" class="sd-save-roll-btn"
                    data-actor-id="${tActor.id}"
                    data-save-modifier-path="${modifierPath.replace(/"/g,"&quot;")}"
                    data-save-dc="${resolvedDC}"
                    data-save-flavor="${flavor.replace(/"/g,"&quot;")}"
                    data-save-roll-mode="${rollMode}"
                    data-save-roll-dialogue="${rollDialogue}"
                    data-save-adv-formula="${advFormula.replace(/"/g,"&quot;")}"
                    data-save-dis-formula="${disFormula.replace(/"/g,"&quot;")}"
                    data-save-roll-formula="${rollFormula.replace(/"/g,"&quot;")}"
                    data-save-timeout="${timeout}"
                    data-save-type="${checkType}"
                    style="background:#7a3a00;border:1px solid #5a2a00;border-radius:5px;
                           color:#fff;cursor:pointer;font-size:11px;font-weight:700;
                           padding:5px 10px;display:flex;align-items:center;gap:5px;
                           white-space:nowrap;flex-shrink:0;transition:background .12s;">
              <i class="fas fa-dice-d20"></i> ${buttonLabel}
            </button>
          </div>`;
      }).join("");

      const multiNote = saveActors.length > 1
        ? `<div style="font-size:10px;color:#555555;text-align:right;padding:2px 0 4px;
                       text-transform:uppercase;letter-spacing:.5px">${saveActors.length} targets</div>`
        : "";

      const _saveRerollEnabled = (action.rerollEnabled === "yes" || action.rerollEnabled === true) ? "1" : "0";
      const _saveRerollPath    = String(action.rerollPath ?? "").trim();
      const _saveRerollCost    = String(Number(action.rerollCost ?? 0) || 0);
      const _saveRerollSrcId   = actor?.id ?? "";

      const cardHtml = `
        <div class="sd-save-card"
             data-save-modifier-path="${modifierPath.replace(/"/g,"&quot;")}"
             data-save-dc="${resolvedDC}"
             data-save-flavor="${flavor.replace(/"/g,"&quot;")}"
             data-save-roll-mode="${rollMode}"
             data-save-roll-dialogue="${rollDialogue}"
             data-save-adv-formula="${advFormula.replace(/"/g,"&quot;")}"
             data-save-dis-formula="${disFormula.replace(/"/g,"&quot;")}"
             data-save-roll-formula="${rollFormula.replace(/"/g,"&quot;")}"
             data-save-timeout="${timeout}"
             data-save-type="${checkType}"
             data-save-reroll-enabled="${_saveRerollEnabled}"
             data-save-reroll-path="${_saveRerollPath.replace(/"/g,"&quot;")}"
             data-save-reroll-cost="${_saveRerollCost}"
             data-save-reroll-src-actor-id="${_saveRerollSrcId}"
             style="background:linear-gradient(135deg,#f0ebe4 0%,#f0ebe4 100%);
             border:1px solid #b5b3a4;border-top:3px solid #7a3a00;
             border-radius:6px;font-family:'Signika Negative',serif;overflow:hidden;
             box-shadow:0 2px 8px rgba(0,0,0,.5)">

          <!-- Header: source + DC -->
          <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;
               border-bottom:1px solid #e0dcd4;background:rgba(0,0,0,.25)">
            <img src="${actor?.img ?? item?.img ?? "icons/svg/mystery-man.svg"}"
                 style="width:36px;height:36px;border-radius:50%;border:2px solid #7a3a00;
                        object-fit:cover;flex-shrink:0;">
            <div style="min-width:0;flex:1">
              <div style="font-size:12px;font-weight:700;color:#191813;
                          white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                ${actor?.name ?? item?.name ?? "?"}
              </div>
              <div style="font-size:10px;color:#555555">${checkTypeLabel}</div>
            </div>
            <div style="text-align:right;flex-shrink:0">
              <div style="font-size:28px;font-weight:700;color:#7a3a00;line-height:1">DC ${resolvedDC}</div>
              <div style="font-size:9px;color:#555555;text-transform:uppercase;letter-spacing:.5px">${flavor}</div>
            </div>
          </div>

          <!-- Per-actor roll rows -->
          <div class="sd-save-actors-list" style="padding:4px 12px 4px;">
            ${multiNote}
            ${actorRows}
          </div>

          <!-- → Selected: dynamically adds selected actors -->
          <div style="padding:0 12px 10px;border-top:1px solid #e0dcd4;padding-top:8px;">
            <button type="button" class="sd-save-selected-btn"
                    data-save-modifier-path="${modifierPath.replace(/"/g,"&quot;")}"
                    data-save-dc="${resolvedDC}"
                    data-save-flavor="${flavor.replace(/"/g,"&quot;")}"
                    data-save-roll-mode="${rollMode}"
                    data-save-roll-dialogue="${rollDialogue}"
                    data-save-adv-formula="${advFormula.replace(/"/g,"&quot;")}"
                    data-save-dis-formula="${disFormula.replace(/"/g,"&quot;")}"
                    data-save-roll-formula="${rollFormula.replace(/"/g,"&quot;")}"
                    data-save-timeout="${timeout}"
                    data-save-type="${checkType}"
                    data-button-label="${buttonLabel.replace(/"/g,"&quot;")}"
                    style="width:100%;background:#e0dcd4;border:1px solid #b5b3a4;border-radius:5px;
                           color:#191813;cursor:pointer;font-size:11px;font-weight:600;padding:5px 8px;
                           display:flex;align-items:center;justify-content:center;gap:6px;transition:.12s"
                    title="Pull selected / targeted tokens into this card">
              <i class="fas fa-bullseye"></i> → Selected
            </button>

            <!-- Hidden preview panel for selected tokens -->
            <div class="sd-save-selected-preview" style="display:none;margin-top:8px;">
              <div style="font-size:10px;color:#555555;margin-bottom:5px;
                          display:flex;align-items:center;gap:4px;">
                <i class="fas fa-bullseye" style="color:#7a3a00"></i>
                <span>Selected:</span>
              </div>
              <div class="sd-save-selected-actors-list"></div>
              <button type="button" class="sd-save-selected-cancel-btn"
                      style="margin-top:6px;width:100%;background:#1a1a2e;
                             border:1px solid #b5b3a4;border-radius:4px;
                             color:#6868a0;cursor:pointer;font-size:11px;padding:4px;
                             display:flex;align-items:center;justify-content:center;gap:5px;
                             transition:.12s">
                ✗ Cancel
              </button>
            </div>
          </div>
        </div>`;

      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content: cardHtml,
        flags: {
          sd: {
            saveButton:    true,
            modifierPath,
            dc:            resolvedDC,
            flavor,
            rollMode,
            timeout,
            checkType,
            passActions:   action.passActions ?? [],
            failActions:   action.failActions ?? []
          }
        }
      });
      break;
    }

    case "journalShow": {
      let uuid = _injectRuntime(String(action.uuid ?? ""));
      try {
        const { FormulaEngine } = await import("./formula-engine.mjs");
        uuid = String(FormulaEngine.evaluate(uuid, item ?? actor ?? {}));
      } catch {  }
      if (!uuid) { ui.notifications.warn("SD | Show Journal: empty UUID"); break; }
      try {
        const doc = await fromUuid(uuid);
        if (!doc) { ui.notifications.warn(`SD | Show Journal: not found — ${uuid}`); break; }
        if (action.pageId) {
          doc.sheet?.render(true, { pageId: action.pageId });
        } else {
          doc.sheet?.render(true);
        }
        if (action.force === true && game.user.isGM) {
          try { await doc.show?.(true); } catch(e) { console.warn("SD | journal.show:", e); }
        }
      } catch(e) { console.error("SD | journalShow:", e); }
      break;
    }

    case "journalShowPage": {
      let entryUuid = _injectRuntime(String(action.entryUuid ?? ""));
      let pageId    = _injectRuntime(String(action.pageId ?? ""));
      try {
        const { FormulaEngine } = await import("./formula-engine.mjs");
        entryUuid = String(FormulaEngine.evaluate(entryUuid, item ?? actor ?? {}));
        pageId    = String(FormulaEngine.evaluate(pageId,    item ?? actor ?? {}));
      } catch {  }
      try {
        const entry = await fromUuid(entryUuid);
        if (!entry) { ui.notifications.warn(`SD | Show Page: entry not found — ${entryUuid}`); break; }
        const page = pageId ? entry.pages.get(pageId) : entry.pages.contents?.[0];
        if (!page) { ui.notifications.warn(`SD | Show Page: page not found in ${entry.name}`); break; }
        entry.sheet?.render(true, { pageId: page.id });
        if (action.force === true && game.user.isGM) {
          try { await entry.show?.(true); } catch(e) { console.warn("SD | journal.show:", e); }
        }
      } catch(e) { console.error("SD | journalShowPage:", e); }
      break;
    }

    case "cardShuffle": {
      const stack = await _sdResolveCards(action);
      if (!stack) { ui.notifications.warn(`SD | Card Shuffle: stack not found`); break; }
      try {
        await stack.shuffle({ chatNotification: action.toChat !== false });
      } catch(e) { console.error("SD | cardShuffle:", e); }
      break;
    }

    case "cardDraw": {
      const from = await _sdResolveCards({ uuid: action.fromUuid, name: action.fromName });
      const to   = await _sdResolveCards({ uuid: action.toUuid,   name: action.toName });
      if (!from || !to) {
        ui.notifications.warn(`SD | Card Draw: stack not found (from="${action.fromName||action.fromUuid}", to="${action.toName||action.toUuid}")`);
        for (const sub of (action.emptyActions ?? [])) await this._runAction(sub, item, actor, buttonDef, runtime);
        break;
      }
      const count = Math.max(1, Math.round(Number(action.count ?? 1)) || 1);
      const how = action.how === "bottom" ? CONST.CARD_DRAW_MODES.BOTTOM
                : action.how === "random" ? CONST.CARD_DRAW_MODES.RANDOM
                : CONST.CARD_DRAW_MODES.TOP;
      const available = from.availableCards?.length ?? from.cards?.size ?? 0;
      if (available <= 0) {
        runtime.__lastDrawnCards = [];
        for (const sub of (action.emptyActions ?? [])) await this._runAction(sub, item, actor, buttonDef, runtime);
        break;
      }
      let drawn = [];
      try {
        drawn = await to.draw(from, Math.min(count, available), { how, chatNotification: action.toChat !== false });
      } catch(e) { console.error("SD | cardDraw:", e); }
      runtime.__lastDrawnCards = drawn ?? [];
      runtime.__lastDrawnCard  = drawn?.[0] ?? null;
      for (const sub of (action.foundActions ?? [])) await this._runAction(sub, item, actor, buttonDef, runtime);
      runtime.__lastDrawnCards = undefined;
      runtime.__lastDrawnCard  = undefined;
      break;
    }

    case "cardPlay":
    case "cardDiscard":
    case "cardReveal": {
      const stack = await _sdResolveCards({ uuid: action.stackUuid, name: action.stackName });
      if (!stack) { ui.notifications.warn(`SD | Card ${action.type}: stack not found`); break; }
      const card = await _sdResolveCard(stack, action);
      if (!card) { ui.notifications.warn(`SD | Card ${action.type}: card not found`); break; }
      try {
        if (action.type === "cardPlay") {
          await card.pass(stack, { action: "play", chatNotification: true });
        } else if (action.type === "cardDiscard") {
          await card.pass(stack, { action: "discard", chatNotification: action.toChat !== false });
        } else {

          await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor: actor ?? null }),
            content: `<div class="sd-card-reveal" style="display:flex;gap:8px;align-items:center"><img src="${card.face >= 0 ? card.faces?.[card.face]?.img ?? card.back?.img ?? "" : card.back?.img ?? ""}" style="height:96px;border-radius:6px"><div><strong>${actor?.name ?? game.user.name} reveals:</strong><br><em>${card.name ?? ""}</em>${card.description ? `<div style="opacity:.8;margin-top:4px">${card.description}</div>` : ""}</div></div>`
          });
        }
      } catch(e) { console.error(`SD | ${action.type}:`, e); }
      break;
    }

    case "cardPass": {
      const from = await _sdResolveCards({ uuid: action.fromUuid, name: action.fromName });
      const to   = await _sdResolveCards({ uuid: action.toUuid,   name: action.toName });
      if (!from || !to) { ui.notifications.warn(`SD | Card Pass: stack not found`); break; }
      const card = await _sdResolveCard(from, action);
      if (!card) { ui.notifications.warn(`SD | Card Pass: card not found`); break; }
      try {
        await card.pass(to, { chatNotification: action.toChat !== false });
      } catch(e) { console.error("SD | cardPass:", e); }
      break;
    }

    case "cardRecall": {
      const stack = await _sdResolveCards(action);
      if (!stack) { ui.notifications.warn(`SD | Card Recall: deck not found`); break; }
      try {
        await stack.recall({ chatNotification: action.toChat !== false });
      } catch(e) { console.error("SD | cardRecall:", e); }
      break;
    }

    case "cardDeal": {
      const from = await _sdResolveCards({ uuid: action.fromUuid, name: action.fromName });
      if (!from) { ui.notifications.warn(`SD | Card Deal: deck not found`); break; }
      const targets = [];
      const list = Array.isArray(action.toList) ? action.toList : String(action.toList ?? "").split(/\s*[;,]\s*/).filter(Boolean);
      for (const t of list) {
        const stack = await _sdResolveCards(t.startsWith("Cards.") ? { uuid: t } : { name: t });
        if (stack) targets.push(stack);
      }
      if (!targets.length) { ui.notifications.warn(`SD | Card Deal: no targets resolved`); break; }
      const count = Math.max(1, Math.round(Number(action.count ?? 1)) || 1);
      const how = action.how === "bottom" ? CONST.CARD_DRAW_MODES.BOTTOM
                : action.how === "random" ? CONST.CARD_DRAW_MODES.RANDOM
                : CONST.CARD_DRAW_MODES.TOP;
      try {
        await from.deal(targets, count, { how, chatNotification: action.toChat !== false });
      } catch(e) { console.error("SD | cardDeal:", e); }
      break;
    }

    case "cardFlip": {
      const stack = await _sdResolveCards({ uuid: action.stackUuid, name: action.stackName });
      if (!stack) { ui.notifications.warn(`SD | Card Flip: stack not found`); break; }
      try {
        if (action.cardId === "*" || !action.cardId) {

          const ids = stack.cards.map(c => c.id);
          const updates = ids.map(id => {
            const c = stack.cards.get(id);
            const newFace = c.face === null ? 0 : null;
            return { _id: id, face: newFace };
          });
          await stack.updateEmbeddedDocuments("Card", updates);
        } else {
          const card = await _sdResolveCard(stack, action);
          if (!card) break;
          const newFace = card.face === null ? 0 : (action.face ?? null);
          await card.update({ face: newFace });
        }
      } catch(e) { console.error("SD | cardFlip:", e); }
      break;
    }

    case "rollTableReset": {
      let table = null;
      if (action.tableUuid) { try { table = await fromUuid(action.tableUuid); } catch {} }
      if (!table && action.tableName) table = game.tables.getName(action.tableName);
      if (!table) { ui.notifications.warn(`SD | Roll Table Reset: not found`); break; }
      try { await table.resetResults(); } catch(e) { console.error("SD | rollTableReset:", e); }
      break;
    }

    case "rollTableShow": {
      let table = null;
      if (action.tableUuid) { try { table = await fromUuid(action.tableUuid); } catch {} }
      if (!table && action.tableName) table = game.tables.getName(action.tableName);
      if (!table) { ui.notifications.warn(`SD | Roll Table Show: not found`); break; }
      try { table.sheet?.render(true); if (game.user.isGM) await table.show?.(true); } catch(e) { console.error("SD | rollTableShow:", e); }
      break;
    }

    }
  }

  static async _requestSaveDialog({ saveActor, saveMod, dc, flavor, rollFormula = "1d20", timeout = 60 }) {

    const ownerIds = Object.entries(saveActor.ownership ?? {})
      .filter(([uid, lvl]) => lvl >= CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER && uid !== "default")
      .map(([uid]) => uid);
    const owningUser = game.users.find(u => u.active && ownerIds.includes(u.id));

    if (!owningUser || owningUser.id === game.user.id) {
      return ButtonExecutor._showLocalSaveDialog({ saveActor, saveMod, dc, flavor, rollFormula, timeout });
    }

    const callbackId = `sd_save_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    return new Promise((resolve) => {

      const handler = (data) => {
        if (data.type !== "saveResult" || data.callbackId !== callbackId) return;
        game.socket.off("system.sd", handler);
        clearTimeout(timer);
        resolve(Number(data.total) || 1);
      };
      game.socket.on("system.sd", handler);

      const timer = setTimeout(async () => {
        game.socket.off("system.sd", handler);
        ui.notifications.warn(`SD | ${saveActor.name}: save timeout — auto-rolling.`);
        const roll = new Roll(`${rollFormula} + ${saveMod}`, _sanitizeRollData(saveActor?.getRollData?.() ?? {}));
        await roll.evaluate();
        await roll.toMessage({
          speaker: ChatMessage.getSpeaker({ actor: saveActor }),
          flavor:  `${flavor} — DC ${dc} (auto) — ${roll.total >= dc ? "✅" : "❌"}`,
          rollMode: _sdMsgMode()
        });
        resolve(roll.total);
      }, timeout * 1000);

      game.socket.emit("system.sd", {
        type:       "saveRequest",
        targetUser: owningUser.id,
        callbackId,
        actorId:    saveActor.id,
        saveMod,
        dc,
        flavor,
        rollFormula,
        timeout
      });
    });
  }

  static async _showRollDialogue({ flavor, baseFormula, advFormula, disFormula, actor }) {
    const { DialogV2 } = foundry.applications.api;
    let mode = "normal";

    const fmtShort = (f) => f ? (f.length > 22 ? f.slice(0, 20) + "…" : f) : "—";
    const getBase = (m) =>
      m === "advantage"    ? (advFormula || baseFormula)
    : m === "disadvantage" ? (disFormula || baseFormula)
    : baseFormula;

    const renderTpl = foundry.applications?.handlebars?.renderTemplate ?? renderTemplate;
    const content = await renderTpl("systems/sd/templates/dialog/roll-mode-dialog.hbs", {
      baseFormula,
      baseShort: fmtShort(baseFormula),
      advShort:  fmtShort(advFormula),
      disShort:  fmtShort(disFormula)
    });

    const bindUI = (root) => {
      if (!root || root.__sdRdlgBound) return;
      root.__sdRdlgBound = true;
      const formulaEl = root.querySelector(".sd-rdlg-formula");
      const bonusEl   = root.querySelector(".sd-rdlg-bonus");
      const modeBtns  = root.querySelectorAll(".sd-rdlg-mode");
      if (!modeBtns.length) { root.__sdRdlgBound = false; return; }

      const updateDisplay = () => {
        const bonus = (bonusEl?.value ?? "").trim();
        const base  = getBase(mode);
        const display = bonus ? `${base} + ${bonus}` : base;
        if (formulaEl) formulaEl.textContent = display;

        for (const btn of modeBtns) {
          const m = btn.dataset.mode;
          const active = m === mode;
          const style = btn.style;
          if (active) {
            style.borderWidth = "2px";
            style.borderColor = m === "normal" ? "#2e8b46" : "#9a50ff";
            style.background  = m === "normal" ? "#1a3a1a" : "#2a1a4a";
            style.color       = m === "normal" ? "#5ae07a" : "#c080ff";
            style.transform   = "scale(1.03)";
          } else {
            style.borderWidth = "1px";
            style.borderColor = "#3a2a5a";
            style.background  = "#1a1a2e";
            style.color       = "#6050a0";
            style.transform   = "scale(1)";
          }
        }
      };

      for (const btn of modeBtns) {
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          mode = btn.dataset.mode;
          updateDisplay();
        });
      }
      bonusEl?.addEventListener("input", updateDisplay);
      updateDisplay();
    };

    const extractBonus = (dialog) => {
      const root = dialog?.element ?? dialog;
      const el = root?.querySelector?.(".sd-rdlg-bonus");
      return (el?.value ?? "").trim();
    };

    try {
      const _safeBind = (rootCandidate) => {

        let tries = 0;
        const tick = () => {
          let root = rootCandidate;
          if (!root || !root.querySelector?.(".sd-rdlg-mode")) {

            const sd = document.querySelector(".sd-rdlg");
            root = sd?.closest("dialog,.application,.app,form") ?? sd?.parentElement ?? null;
          }
          const btns = root?.querySelectorAll?.(".sd-rdlg-mode");
          if (btns && btns.length) { bindUI(root); return; }
          if (++tries < 40) requestAnimationFrame(tick);
        };
        tick();
      };

      const _hookId = Hooks.on("renderDialogV2", (app, htmlOrEl) => {
        const root = htmlOrEl?.[0] ?? htmlOrEl ?? app?.element ?? null;
        if (root?.querySelector?.(".sd-rdlg")) _safeBind(root);
      });

      let result;
      try {
        result = await DialogV2.wait({
          window:  { title: flavor ? `🎲 ${flavor}` : "🎲 Roll" },
          content,
          position:  { width: 380 },
          buttons: [
            {
              action:  "roll",
              icon:    "fas fa-dice-d20",
              label:   "Roll",
              default: true,
              callback: (event, button, dialog) => {
                const bonus = extractBonus(dialog);
                const base  = getBase(mode);
                const formula = bonus ? `(${base}) + ${bonus}` : base;
                return { formula, mode, cancelled: false };
              }
            },
            {
              action: "cancel",
              icon:   "fas fa-times",
              label:  "Cancel",
              callback: () => ({ cancelled: true })
            }
          ],
          rejectClose: false,
          render: (event, dialog) => {
            const root = dialog?.element ?? event?.target ?? event?.currentTarget ?? null;
            _safeBind(root);
          }
        });
      } finally {
        try { Hooks.off("renderDialogV2", _hookId); } catch {}
      }
      return result ?? { cancelled: true };
    } catch (e) {
      console.warn("SD | _showRollDialogue DialogV2 failed:", e);
      return { cancelled: true };
    }
  }

    static _showLocalSaveDialog({ saveActor, saveMod, dc, flavor, rollFormula = "1d20", timeout }) {
    return new Promise(async (resolve) => {
      const sign  = saveMod >= 0 ? `+${saveMod}` : String(saveMod);
      const renderTpl = foundry.applications?.handlebars?.renderTemplate ?? renderTemplate;
      const content = await renderTpl("systems/sd/templates/dialog/local-save-dialog.hbs", {
        actorName: saveActor.name,
        rollFormula,
        sign,
        dc
      });
      const dlg   = new Dialog({
        title:   `${flavor} — DC ${dc}`,
        content,
        buttons: {
          roll: {
            icon:  '<i class="fas fa-dice-d20"></i>',
            label: "Roll Save",
            callback: async () => {
              const roll = new Roll(`${rollFormula} + ${saveMod}`, _sanitizeRollData(saveActor?.getRollData?.() ?? {}));
              await roll.evaluate();
              await roll.toMessage({
                speaker:  ChatMessage.getSpeaker({ actor: saveActor }),
                flavor:   `${flavor} — DC ${dc} — ${roll.total >= dc ? "✅ Success" : "❌ Failure"}`,
                rollMode: _sdMsgMode()
              });
              resolve(roll.total);
            }
          },
          manual: {
            icon:  '<i class="fas fa-keyboard"></i>',
            label: "Enter result",
            callback: (html) => {
              const val = parseInt(html.find("#sd-manual-roll").val()) || 1;
              resolve(val);
            }
          }
        },
        default: "roll",
        render: (html) => {

          html.find(".dialog-buttons").before(
            `<div style="margin:8px 0;display:flex;align-items:center;gap:8px;">
               <label style="font-size:11px;color:#888;">Or enter total:</label>
               <input id="sd-manual-roll" type="number" min="1" max="30"
                 style="width:60px;background:#1a1a2e;border:1px solid #4a4a6a;
                        color:#e0e0ff;border-radius:4px;padding:2px 6px;font-size:13px;">
             </div>`
          );

          if (timeout > 0) {
            const t = setTimeout(() => {
              dlg.close();
              const roll = new Roll(`${rollFormula} + ${saveMod}`);
              roll.evaluate().then(r => {
                r.toMessage({ speaker: ChatMessage.getSpeaker({ actor: saveActor }),
                  flavor: `${flavor} — DC ${dc} (timeout auto-roll) — ${r.total >= dc ? "✅" : "❌"}`,
                  rollMode: _sdMsgMode() });
                resolve(r.total);
              });
            }, timeout * 1000);
            dlg._sdTimeoutId = t;
          }
        },
        close: () => {
          if (dlg._sdTimeoutId) clearTimeout(dlg._sdTimeoutId);
        }
      }, { width: 320 });
      dlg.render(true);
    });
  }
  static _buildChatCard({ type, label, amount, srcName, srcImg, tActor, hpPath,
                           showApply = true, rollFormula = null, srcActorId = null,
                           autoApplied = false }) {
    const isDamage    = type === "damage";
    const accentColor = isDamage ? "#b83232" : "#2e8b46";
    const dimColor    = isDamage ? "#7a2020" : "#1e6030";
    const iconClass   = isDamage ? "fa-heart-crack" : "fa-heart";
    const targetName  = tActor?.name ?? "—";
    const targetId    = tActor?.id   ?? null;
    const delta       = isDamage ? -amount : amount;
    const curHp       = tActor ? (Number(foundry.utils.getProperty(tActor, hpPath ?? "system.resources.hp.value")) || 0) : null;
    const maxHp       = tActor ? (Number(foundry.utils.getProperty(tActor,
      (hpPath ?? "system.resources.hp.value").replace(/\.value$/, ".max"))) || 0) : null;
    const newHp       = curHp !== null ? Math.max(0, curHp + delta) : null;
    const hpBarPct    = maxHp ? Math.round((Math.max(0, newHp ?? curHp) / maxHp) * 100) : 0;
    const safeHpPath  = hpPath ?? "system.resources.hp.value";

    const multBtns = isDamage ? `
      <div class="sd-card-mults" style="display:flex;gap:3px;margin-top:8px;flex-wrap:wrap;">
        ${[["½","0.5"],["¼","0.25"],["⅛","0.125"],["×2","2"],["×4","4"]].map(([lbl,mul]) => `
        <button type="button" class="sd-mult-btn"
          data-mult="${mul}"
          style="flex:1;min-width:28px;background:#e0dcd4;border:1px solid #b5b3a4;border-radius:4px;
                 color:#555555;cursor:pointer;font-size:11px;font-weight:700;padding:3px 2px;
                 transition:background .12s,color .12s"
          title="Apply ${lbl} damage">
          ${lbl}
        </button>`).join("")}
      </div>` : "";

    const applyBtns = autoApplied
      ? `<div style="text-align:center;font-size:11px;color:#5ae07a;padding:4px 0;margin-top:8px;
                     border:1px solid #2a6a3a;border-radius:4px;background:#0a2a0a;">
           <i class="fas fa-check"></i> Applied automatically
         </div>`
      : showApply ? `
      <div class="sd-card-apply-row" style="display:flex;gap:5px;margin-top:8px;">
        ${targetId ? `
        <button type="button" class="sd-apply-hp-btn"
          data-actor-id="${targetId}"
          data-hp-path="${safeHpPath}"
          data-delta="${delta}"
          data-amount="${amount}"
          data-label="${label}"
          data-target-name="${targetName}"
          style="flex:2;background:${accentColor};border:1px solid ${dimColor};border-radius:5px;
                 color:#fff;cursor:pointer;font-size:11px;font-weight:700;padding:5px 4px;
                 display:flex;align-items:center;justify-content:center;gap:5px;transition:.12s">
          <i class="fas ${iconClass}"></i> Apply ${amount}
        </button>` : ""}
        <button type="button" class="sd-apply-selected-btn"
          data-hp-path="${safeHpPath}"
          data-base-amount="${amount}"
          data-delta="${delta}"
          data-is-damage="${isDamage ? 1 : 0}"
          data-label="${label}"
          style="flex:${targetId ? 1 : 3};background:#e0dcd4;border:1px solid #b5b3a4;border-radius:5px;
                 color:#191813;cursor:pointer;font-size:11px;font-weight:600;padding:5px 4px;
                 display:flex;align-items:center;justify-content:center;gap:5px;transition:.12s"
          title="Preview: selected / targeted tokens">
          <i class="fas fa-bullseye"></i> → Selected
        </button>
      </div>
      <!-- Live-selection preview (hidden until '→ Selected' is clicked) -->
      <div class="sd-selected-preview" style="display:none;margin-top:8px;
           border:1px solid #b5b3a4;border-radius:5px;background:#f0ebe4;padding:8px;">
        <div style="font-size:10px;color:#555555;margin-bottom:5px;
                    display:flex;align-items:center;gap:4px;">
          <i class="fas fa-bullseye" style="color:${accentColor}"></i>
          <span>Apply to selected:</span>
        </div>
        <div class="sd-selected-actors-list" style="margin-bottom:6px;"></div>
        <div style="display:flex;gap:5px;">
          <button type="button" class="sd-selected-confirm-btn"
            data-hp-path="${safeHpPath}"
            data-is-damage="${isDamage ? 1 : 0}"
            data-label="${label}"
            style="flex:3;background:${accentColor};border:1px solid ${dimColor};border-radius:4px;
                   color:#fff;cursor:pointer;font-size:11px;font-weight:700;padding:5px 4px;
                   display:flex;align-items:center;justify-content:center;gap:5px;transition:.12s">
            <i class="fas ${iconClass}"></i> Confirm Apply
          </button>
          <button type="button" class="sd-selected-cancel-btn"
            style="flex:1;background:#1a1a2e;border:1px solid #b5b3a4;border-radius:4px;
                   color:#6868a0;cursor:pointer;font-size:13px;padding:5px;
                   display:flex;align-items:center;justify-content:center;transition:.12s">
            ✗
          </button>
        </div>
      </div>` : "";

    const rerollBtn = rollFormula ? `
      <div style="margin-top:6px;">
        <button type="button" class="sd-reroll-btn"
          data-formula="${rollFormula.replace(/"/g,"&quot;")}"
          data-src-actor-id="${srcActorId ?? ""}"
          data-hp-path="${safeHpPath}"
          data-is-damage="${isDamage ? 1 : 0}"
          data-target-id="${targetId ?? ""}"
          data-label="${label}"
          style="width:100%;background:#1e1e30;border:1px solid #4a4a6a;border-radius:5px;
                 color:#8080c0;cursor:pointer;font-size:11px;font-weight:600;padding:4px 0;
                 display:flex;align-items:center;justify-content:center;gap:6px;
                 transition:background .12s,color .12s">
          <i class="fas fa-dice"></i> Re-roll
        </button>
      </div>` : "";

    const hpBar = (newHp !== null && maxHp) ? `
      <div style="margin-top:8px">
        <div style="display:flex;justify-content:space-between;font-size:10px;color:#888;margin-bottom:2px">
          <span>${targetName} HP</span>
          <span>${newHp} / ${maxHp}</span>
        </div>
        <div style="background:#e0dcd4;border-radius:3px;height:6px;overflow:hidden">
          <div style="width:${hpBarPct}%;height:100%;background:${hpBarPct > 50 ? "#2e8b46" : hpBarPct > 25 ? "#c07820" : "#b83232"};transition:width .3s"></div>
        </div>
      </div>` : "";

    return `
<div class="sd-chat-card"
  data-base-amount="${amount}"
  data-hp-path="${safeHpPath}"
  data-is-damage="${isDamage ? 1 : 0}"
  data-roll-formula="${(rollFormula ?? "").replace(/"/g,"&quot;")}"
  data-src-actor-id="${srcActorId ?? ""}"
  data-target-id="${targetId ?? ""}"
  data-label="${label}"
  style="background:linear-gradient(135deg,#f0ebe4 0%,#f0ebe4 100%);
    border:1px solid ${dimColor};border-top:3px solid ${accentColor};
    border-radius:6px;font-family:'Signika Negative',serif;overflow:hidden;
    box-shadow:0 2px 8px rgba(0,0,0,.5)">

  <!-- Header -->
  <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;
              border-bottom:1px solid #e0dcd4;background:rgba(0,0,0,.25)">
    <img src="${srcImg}" style="width:36px;height:36px;border-radius:50%;
         border:2px solid ${accentColor};object-fit:cover;flex-shrink:0">
    <div style="min-width:0">
      <div style="font-size:12px;font-weight:700;color:#191813;white-space:nowrap;
                  overflow:hidden;text-overflow:ellipsis">${srcName}</div>
      <div style="font-size:10px;color:#555555">${label}</div>
    </div>
    <div style="margin-left:auto;text-align:right;flex-shrink:0">
      <div class="sd-card-total" style="font-size:28px;font-weight:700;color:${accentColor};line-height:1">${amount}</div>
      <div style="font-size:9px;color:#555555;text-transform:uppercase;letter-spacing:.5px">${isDamage ? "damage" : "healing"}</div>
    </div>
  </div>

  <!-- Body -->
  <div style="padding:6px 12px 10px">
    <div style="display:flex;align-items:center;gap:6px;font-size:11px;color:#555555">
      <i class="fas fa-crosshairs" style="color:${accentColor}"></i>
      <span>Target: <strong style="color:#c0c0d8">${targetName}</strong></span>
    </div>
    ${hpBar}
    ${multBtns}
    ${applyBtns}
    ${rerollBtn}
  </div>
</div>`;}

  static async _postChatApply(btnType, amount, sourceActor, targetActor) {
    const isHeal = btnType === "applyHealing";
    const content = ButtonExecutor._buildChatCard({
      type:     isHeal ? "heal" : "damage",
      label:    isHeal ? "Apply Healing" : "Apply Damage",
      amount:   Math.abs(amount),
      srcName:  sourceActor?.name ?? "?",
      srcImg:   sourceActor?.img  ?? "icons/svg/mystery-man.svg",
      tActor:   targetActor,
      hpPath:   "system.resources.hp.value",
      showApply: !!targetActor
    });
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: sourceActor }),
      content,
      flags: { "sd": { applyAction: { btnType, amount, targetId: targetActor?.id ?? null } } }
    });
  }

  static _getFieldValue(path, item, actor) {
    if (path.startsWith("slots."))       return SlotManager.resolveSlotPath(item, path);
    if (path.startsWith("self."))        return foundry.utils.getProperty(item, path.slice(5));
    if (path.startsWith("actor."))       return foundry.utils.getProperty(actor ?? {}, path.slice(6));
    return foundry.utils.getProperty(item, path);
  }

  static async _setFieldValue(path, item, actor, value) {
    if (path.startsWith("slots.")) {
      await SlotManager.setSlotPath(item, path, value);
    } else if (path.startsWith("self.")) {
      await item.update({ [path.slice(5)]: value });
    } else if (path.startsWith("actor.")) {
      if (actor) await actor.update({ [path.slice(6)]: value });
    } else {
      await item.update({ [path]: value });
    }
  }

}
