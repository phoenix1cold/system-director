import { CharacterSheet } from "./character-sheet.mjs";

const { ActorSheetV2 } = foundry.applications.sheets;
const { HandlebarsApplicationMixin } = foundry.applications.api;

export class NPCSheet extends CharacterSheet {
  static DEFAULT_OPTIONS = {
    ...CharacterSheet.DEFAULT_OPTIONS,
    classes: ["sd", "sheet", "actor", "npc"]
  };
}
