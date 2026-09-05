/**
 * 1.11.10 — A structured Roll Result must survive the runtime injector,
 * reach To Text as an object, and render as result.total in Message.
 */
import assert from "node:assert";
import fs from "node:fs";

const read = name => fs.readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
const getProperty = (object, path) => String(path ?? "").split(".").reduce((value, key) => value?.[key], object);
const setProperty = (object, path, value) => {
  const parts = String(path).split(".");
  let cursor = object;
  for (const key of parts.slice(0, -1)) cursor = cursor[key] ??= {};
  cursor[parts.at(-1)] = value;
  return true;
};

class Field { constructor(...args) { this.args = args; } }
globalThis.foundry = {
  utils: {
    getProperty, setProperty,
    deepClone: value => structuredClone(value),
    mergeObject: (left, right) => Object.assign({}, left, right),
    randomID: () => "id",
    getDocumentClass: () => globalThis.Item
  },
  data: { fields: {
    StringField: Field, NumberField: Field, BooleanField: Field,
    ArrayField: Field, ObjectField: Field, SchemaField: Field
  } },
  applications: { api: {
    ApplicationV2: class {},
    HandlebarsApplicationMixin: Base => Base,
    DialogV2: class {}
  } }
};
globalThis.Application = class {};
globalThis.FormApplication = class {};
globalThis.Actor = class Actor {};
globalThis.Item = class Item {};
globalThis.ActiveEffect = class {};
globalThis.Hooks = { on: () => 0, once: () => 0, off() {}, call() {}, callAll() {} };
globalThis.CONFIG = { SD: { currencies: [] }, Actor: { documentClass: Actor }, Item: { documentClass: Item } };
globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OWNER: 3 }, CHAT_MESSAGE_TYPES: { OTHER: 0 } };
globalThis.ui = { notifications: { warn() {}, info() {}, error() {} } };
globalThis.canvas = { tokens: { controlled: [], get: () => null }, scene: null };
globalThis.game = {
  settings: { get: () => ({ database: [] }), set: async () => {} },
  i18n: { localize: key => key, format: key => key },
  user: { targets: new Set(), isGM: true, id: "u" },
  users: [], actors: new Map(), items: new Map(), modules: new Map(), scenes: new Map()
};

globalThis.fromUuid = async () => null;
globalThis.fromUuidSync = () => null;
globalThis.renderTemplate = async () => "";
globalThis.fetch = async () => ({ ok: false });
globalThis.TextEditor = { enrichHTML: async value => value };
globalThis.loadTemplates = async () => {};
globalThis.Dialog = class {};
globalThis.FilePicker = class {};
globalThis.AudioHelper = { play() {} };
globalThis.Sequencer = undefined;

const messages = [];
globalThis.ChatMessage = class ChatMessage {
  static getSpeaker() { return {}; }
  static async create(data) { messages.push(data); return { id: "message-id" }; }
};
globalThis.Roll = class Roll {
  constructor(formula) {
    this.formula = formula;
    this.total = 17;
    this.dice = [{ faces: 20, number: 1, results: [{ result: 17, active: true }] }];
  }
  async evaluate() { return this; }
  async toMessage() { return null; }
};

const { FormulaEngine } = await import("../module/helpers/formula-engine.mjs");
const { ButtonExecutor } = await import("../module/helpers/button-executor.mjs");

// This is the exact formula emitted by: Roll Result → To Text.
const valueArg = "b64:" + Buffer.from("{__rollResult}", "utf8").toString("base64");
const separatorArg = "b64:" + Buffer.from(", ", "utf8").toString("base64");
const toText = `{convertValue:text|${valueArg}|${separatorArg}}`;

await ButtonExecutor._runAction({
  type: "rollResultV2",
  mode: "formula",
  formula: "1d20",
  flavor: "Test",
  execActions: [{ type: "message", messageParts: ["Damage:", toText] }]
}, null, new Actor(), {}, {});

assert.equal(messages.length, 1, "the Message action must be reached");
assert.match(messages[0].content, /Damage:<br>17/,
  "Roll Result → To Text → Message must print result.total");
assert.doesNotMatch(messages[0].content, /\[object Object\]/,
  "a Roll Result object must never be stringified before To Text");
assert.equal(FormulaEngine.valueToText({ type: "sd.roll-result", formula: "1d20", total: 17 }), "17");

const executorSource = read("module/helpers/button-executor.mjs");
assert.ok(executorSource.includes('decoded.trim() === "{__rollResult}"'),
  "the Base64 runtime injector must preserve the structured Roll Result token");

const manifest = JSON.parse(read("system.json"));
assert.equal(manifest.version, "1.11.10");
console.log("PASS: Roll Result → To Text → Message renders total (1.11.10).");
