/**
 * module/sheets/npc-sheet.mjs
 * Same blank-canvas approach as CharacterSheet.
 */

import { CharacterSheet } from "./character-sheet.mjs";

const { ActorSheetV2 } = foundry.applications.sheets;
const { HandlebarsApplicationMixin } = foundry.applications.api;

// NPC sheet reuses CharacterSheet completely -- same blank canvas
export class NPCSheet extends CharacterSheet {
  static DEFAULT_OPTIONS = {
    ...CharacterSheet.DEFAULT_OPTIONS,
    classes: ["sd", "sheet", "actor", "npc"]
  };
}
