const checks = [];
const check = (value, message) => { if (!value) throw new Error(message); checks.push(message); };
const tick = () => new Promise(resolve => setTimeout(resolve, 25));

class Application {
  constructor(options = {}) { this.options = options; this.rendered = false; }
  async render() {
    this.element = document.createElement("section");
    this.element.className = `application ${this.options.classes?.join(" ") ?? ""}`;
    document.querySelector("#scratch").append(this.element);
    this._replaceHTML?.(await this._renderHTML(), this.element);
    this.rendered = true;
    return this;
  }
  async close() { this.element?.remove(); this.rendered = false; return this; }
}

globalThis.foundry = {
  applications: { api: { ApplicationV2: Application } },
  utils: {
    deepClone: value => structuredClone(value),
    randomID: () => crypto.randomUUID().slice(0, 8),
    getProperty: (object, path) => String(path).split(".").reduce((value, key) => value?.[key], object),
    escapeHTML: value => String(value ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")
  }
};
globalThis.Hooks = { once() {} };
globalThis.ui = { notifications: { warn: message => { throw new Error(message); }, info() {} } };
globalThis.game = {
  i18n: { lang: "en", localize: key => key },
  settings: { get: () => ({ database: { values: [
    { id: "strength", name: "Strength", type: "number", scope: "actor", initial: 0 },
    { id: "luck", name: "Luck", type: "number", scope: "both", initial: 0 }
  ] } }) }
};
globalThis.Actor = class Actor {
  constructor() { this.id = "actor"; this.uuid = "Actor.actor"; this.documentName = "Actor"; this.system = { customTabs: [] }; }
};
globalThis.Item = class Item {};

try {
  const { installSearchableSelects } = await import("../module/helpers/editor-controls.mjs");
  const { createWidget } = await import("../module/builder/widget-registry.mjs");
  const { openEasyButtonWizard } = await import("../module/builder/easy-button-wizard.mjs");
  const { WidgetRenderer } = await import("../module/builder/widget-renderer.mjs");
  const doc = new Actor();
  doc.system.customTabs = [{ id:"main", rows:[{ id:"row", widgets:[
    { id:"number", type:"number", label:"Strength bonus", widgetKey:"strength_widget", path:"system.values.strength" }
  ] }] }];
  installSearchableSelects();

  const resultPromise = openEasyButtonWizard(createWidget("easyButton"), doc, { tabs: doc.system.customTabs });
  await tick();
  const root = document.querySelector(".sd-easy-button-wizard");
  check(root, "Creation wizard opens in a Foundry window");
  check(root.querySelector('[data-mode="constructor"].is-active'), "Constructor mode is the default");
  root.querySelector('[data-state="label"]').value = "Attack";
  root.querySelector('[data-state="widgetKey"]').value = "attack";
  root.querySelector("[data-next]").click(); await tick();
  check(root.querySelectorAll("[data-die-row]").length === 1, "Dice page starts with one group");
  root.querySelector("[data-add-die]").click(); await tick();
  check(root.querySelectorAll("[data-die-row]").length === 2, "Additional dice groups can be added");
  const secondDie = root.querySelectorAll("[data-die-row]")[1];
  secondDie.querySelector('[data-die="count"]').value = "2";
  secondDie.querySelector('[data-die="count"]').dispatchEvent(new Event("input", {bubbles:true}));
  secondDie.querySelector('[data-die="sides"]').value = "8";
  secondDie.querySelector('[data-die="sides"]').dispatchEvent(new Event("input", {bubbles:true}));
  root.querySelector("[data-next]").click(); await tick();

  root.querySelector("[data-add-variable]").click(); await tick();
  const variableSelect = root.querySelector('[data-variable-row] select[data-term="variableId"]');
  variableSelect.dispatchEvent(new MouseEvent("mousedown", {bubbles:true, button:0})); await tick();
  check(document.querySelector(".sd-search-select input"), "Database variable selector has search");
  document.querySelector(".sd-search-select input").value = "strength";
  document.querySelector(".sd-search-select input").dispatchEvent(new Event("input", {bubbles:true}));
  document.querySelector('.sd-search-options [role="option"]').click(); await tick();

  root.querySelector("[data-add-widget]").click(); await tick();
  const widgetSelect = root.querySelector('[data-widget-row] select[data-term="widgetKey"]');
  widgetSelect.dispatchEvent(new MouseEvent("mousedown", {bubbles:true, button:0})); await tick();
  check(document.querySelector(".sd-search-select input"), "Widget value selector has search");
  document.querySelector(".sd-search-select input").value = "strength bonus";
  document.querySelector(".sd-search-select input").dispatchEvent(new Event("input", {bubbles:true}));
  document.querySelector('.sd-search-options [role="option"]').click(); await tick();

  check(root.querySelector(".sdew-preview code").textContent.includes("{system.values.strength}"), "Preview includes the Database variable");
  check(root.querySelector(".sdew-preview code").textContent.includes("{widget:strength_widget}"), "Preview includes the widget value");
  root.querySelector("[data-next]").click();
  const result = await resultPromise;
  check(result.formula === "1d20 + 2d8 + {system.values.strength} + {widget:strength_widget}", "Constructor saves the compiled Foundry formula");
  const rendered = document.createElement("div");
  rendered.innerHTML = WidgetRenderer.render(result, doc);
  const rollButton = rendered.querySelector('[data-action="widgetButton"]');
  check(rollButton?.dataset.formulaRaw === result.formula, "Rendered Easy Button exposes its formula to sheet and HUD roll handlers");

  const customPromise = openEasyButtonWizard(createWidget("easyButton"), doc, { tabs: doc.system.customTabs });
  await tick();
  const customRoot = document.querySelector(".sd-easy-button-wizard");
  customRoot.querySelector('[data-state="widgetKey"]').value = "custom_roll";
  customRoot.querySelector('[data-mode="formula"]').click(); await tick();
  customRoot.querySelector("[data-next]").click(); await tick();
  check(customRoot.querySelector('[data-state="customFormula"]'), "Custom Formula mode has a normal formula field");
  customRoot.querySelector('[data-state="customFormula"]').value = "3d10kh2 + 4";
  customRoot.querySelector('[data-state="customFormula"]').dispatchEvent(new Event("input", {bubbles:true}));
  customRoot.querySelector("[data-next]").click();
  const custom = await customPromise;
  check(custom.formula === "3d10kh2 + 4", "Custom Formula mode saves the entered formula");

  document.querySelector("#result").textContent = `PASS · ${checks.length} checks`;
  globalThis.qa = { checks, result, custom };
  document.title = "READY";
} catch (error) {
  document.querySelector("#result").textContent = error.stack;
  document.title = "FAIL";
}
