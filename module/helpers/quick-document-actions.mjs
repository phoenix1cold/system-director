import { FormulaEngine } from "./formula-engine.mjs";
import { getValueDefinition, resolveVariableReference, readDatabaseValue, writeDatabaseValue } from "./value-database.mjs";

/** Strict targets for form actions: an empty target set never falls back to Self. */
export function quickActors(mode, actor) {
  const targets = [...(globalThis.game?.user?.targets ?? [])].map(token => token.actor).filter(Boolean);
  const selected = (globalThis.canvas?.tokens?.controlled ?? []).map(token => token.actor).filter(Boolean);
  const list = mode === "all_targets" ? targets : mode === "token_target" ? targets.slice(0, 1)
    : mode === "selected_token" ? selected.slice(0, 1) : mode === "actor" || mode === "self" || !mode ? [actor].filter(Boolean)
    : [globalThis.game?.actors?.get?.(mode)].filter(Boolean);
  return [...new Set(list)];
}
function requireOwner(doc) {
  if (!doc || doc.isOwner === false) throw new Error(`No permission to change ${doc?.name ?? "missing document"}.`);
}
function ownedItem(owner, ref, contextItem) {
  if (!ref) return contextItem?.actor === owner ? contextItem : null;
  return owner?.items?.get?.(ref) ?? owner?.items?.find?.(entry => entry.uuid === ref) ?? null;
}
async function numberValue(raw, context) {
  const formula = FormulaEngine.resolveForRoll(String(raw ?? "0"), context);
  let value;
  if (/\d*d\d+/i.test(formula)) {
    const roll = await new Roll(formula, context?.getRollData?.() ?? {}).evaluate();
    value = Number(roll.total);
  } else value = Number(FormulaEngine.evaluate(formula, context));
  if (!Number.isFinite(value)) throw new Error("Amount must resolve to a finite number.");
  return value;
}

export async function runQuickDocumentAction(action, { actor, item, resolve = value => value, run } = {}) {
  actor ??= item?.actor ?? null;
  const owners = quickActors(action.target, actor);
  if (!owners.length && action.ownerType !== "item") throw new Error("No actor selected for this action.");
  const ref = String(resolve(action.itemId ?? ""));
  const docs = action.ownerType === "item"
    ? (action.target === "actor" && !ref && item ? [item] : owners.map(owner => ownedItem(owner, ref, item)))
    : owners;
  if (!docs.length || docs.some(doc => !doc)) throw new Error("Item was not found on the selected actor.");
  if (["variable", "damage", "heal"].includes(action.mode)) {
    const definition = getValueDefinition(action.variableId);
    if (!definition) throw new Error("Select a Database variable.");
    const bindings = docs.map(doc => {
      requireOwner(doc);
      const binding = resolveVariableReference(action.variableId, { document:doc });
      if (binding?.kind !== "document" || binding.document !== doc) throw new Error("Variable owner does not match the selected document.");
      return doc;
    });
    const healing = action.mode === "heal", damage = action.mode === "damage";
    if ((healing || damage) && !["number","integer"].includes(definition.type)) throw new Error("Damage and healing require a numeric variable.");
    const value = healing || damage ? Math.max(0, await numberValue(resolve(action.amount), item ?? actor))
      : FormulaEngine.evaluate(String(resolve(action.value ?? "")), item ?? actor);
    if ((healing || damage) && !action.autoApply) {
      // Store the exact resolved amount, not a dice formula that would reroll on Apply.
      await run({type:"messageComposer", title:action.label || (healing ? "Healing" : "Damage"), message:`${value} · ${definition.name ?? action.variableId}`,
        access:"actorOwner", buttonUse:"once", controls:[], buttons:[{id:"btn0",label:"Apply",enabled:true}],
        btn0Actions:bindings.map(doc => ({...action, target:doc.documentName === "Actor" ? doc.id : doc.actor?.id ?? "actor", itemId:doc.documentName === "Item" ? doc.id : "", amount:String(value), autoApply:true}))});
      return;
    }
    for (const doc of bindings) {
      const current = readDatabaseValue(doc, action.variableId);
      const operation = damage ? "subtract" : healing ? "add" : action.operation;
      let next = value;
      if (operation === "add") next = Number(current ?? 0) + Number(value);
      if (["sub", "subtract"].includes(operation)) next = Number(current ?? 0) - Number(value);
      if (operation === "multiply") next = Number(current ?? 0) * Number(value);
      if (operation === "toggle") next = !current;
      if (damage || healing) next = Math.max(0, next);
      if (!await writeDatabaseValue(doc, action.variableId, next)) throw new Error("Database value was not saved.");
    }
    return;
  }
  if (action.mode !== "items") throw new Error("Unknown document action.");
  const operation = action.itemOperation;
  if (!["add","remove","transfer","use","equip"].includes(operation)) throw new Error("Unknown item operation.");
  const quantity = Number(action.qty ?? 1);
  if (!Number.isSafeInteger(quantity) || quantity < 1) throw new Error("Quantity must be a positive integer.");
  for (const owner of owners) {
    requireOwner(owner);
    const source = operation === "add" ? await fromUuid(String(resolve(action.uuid ?? "")))
      : ownedItem(owner, String(resolve(action.itemId || action.uuid || "")), item);
    if (source?.documentName !== "Item") throw new Error("Select an exact Item UUID / owned item ID.");
    if (operation === "use") { requireOwner(source); await source.use({}); continue; }
    if (operation === "equip") {
      requireOwner(source);
      if (!source.system?.equippable) throw new Error("This item is not equippable.");
      if (action.equipped && source.canEquip) { const result = await source.canEquip(); if (!result.ok) throw new Error(result.reason || "Cannot equip item."); }
      await source.update({"system.equipped":!!action.equipped}); continue;
    }
    const available = Number(source.system?.quantity ?? 1);
    if (operation !== "add" && (!Number.isFinite(available) || available < quantity)) throw new Error("Not enough items.");
    if (operation === "add") {
      const data = source.toObject(); delete data._id; data.system.quantity = quantity;
      await owner.createEmbeddedDocuments("Item", [data]);
    } else if (operation === "remove") {
      requireOwner(source);
      if (quantity === available) await source.delete();
      else await source.update({"system.quantity":available - quantity});
    } else if (operation === "transfer") {
      const recipients = quickActors(action.destination, actor);
      if (recipients.length !== 1 || recipients[0] === owner) throw new Error("Select one different recipient actor.");
      const recipient = recipients[0]; requireOwner(recipient); requireOwner(source);
      const data = source.toObject(); delete data._id; data.system.quantity = quantity;
      const created = await recipient.createEmbeddedDocuments("Item", [data]);
      if (created.length !== 1) throw new Error("Recipient item was not created.");
      try {
        if (quantity === available) await source.delete();
        else await source.update({"system.quantity":available - quantity});
      } catch (error) {
        // Keep the source when decrement fails; undo the new recipient copy.
        await created[0].delete();
        throw error;
      }
    }
  }
}
