import { MODULE_ID } from "./ui-widget-const.mjs";
import {
  normalizeBlueprintAssets, normalizeVariables, safeId, uniqueId,
  VARIABLE_TYPES
} from "./ui-widget-blueprint.mjs";

const { ApplicationV2 } = foundry.applications.api;
const clone = value => foundry.utils.deepClone(value);
const esc = value => foundry.utils.escapeHTML(String(value ?? ""));
const t = (key, fallback) => {
  const value = game.i18n?.localize?.(key);
  return value && value !== key ? value : fallback;
};

const GROUPS = [
  ["functions", t("SDUI.Assets.Functions", "Functions"), "fa-code", t("SDUI.Assets.FunctionsDesc", "Callable graphs with typed inputs and outputs")],
  ["customEvents", t("SDUI.Assets.CustomEvents", "Custom Events"), "fa-bolt", t("SDUI.Assets.CustomEventsDesc", "Named events that can carry typed parameters")],
  ["enums", t("SDUI.Assets.Enums", "Enums"), "fa-list", t("SDUI.Assets.EnumsDesc", "Named constant values")],
  ["structs", t("SDUI.Assets.Structs", "Structs"), "fa-table-columns", t("SDUI.Assets.StructsDesc", "Reusable groups of typed fields")],
  ["dataTables", t("SDUI.Assets.DataTables", "Data Tables"), "fa-table", t("SDUI.Assets.DataTablesDesc", "Rows based on a Struct")]
];

function fresh(group, list) {
  const names = { functions: "Function", customEvents: "Event", enums: "Enum", structs: "Struct", dataTables: "Data Table" };
  const name = `${names[group]} ${list.length + 1}`;
  const base = { id: uniqueId(list, name, { fallback: safeId(names[group]) }), name };
  if (group === "functions") return { ...base, inputs: [], outputs: [], graphData: { nodes: [], edges: [], comments: [] }, compiled: "" };
  if (group === "customEvents") return { ...base, parameters: [] };
  if (group === "enums") return { ...base, entries: [{ id: "entry-1", name: "Entry 1", value: "entry-1" }] };
  if (group === "structs") return { ...base, fields: [] };
  return { ...base, structId: "", rows: [] };
}

function variableRows(list, group, assetIndex, listKey) {
  return normalizeVariables(list).map((variable, variableIndex) => `
    <div class="sduw-asset-var" data-var-row>
      <input data-edit-var="name" data-group="${group}" data-asset="${assetIndex}" data-list="${listKey}" data-var="${variableIndex}" value="${esc(variable.name)}" aria-label="Name">
      <select data-edit-var="type" data-group="${group}" data-asset="${assetIndex}" data-list="${listKey}" data-var="${variableIndex}" aria-label="Type">
        ${VARIABLE_TYPES.map(type => `<option value="${type}" ${type === variable.type ? "selected" : ""}>${type}</option>`).join("")}
      </select>
      <button type="button" data-remove-var data-group="${group}" data-asset="${assetIndex}" data-list="${listKey}" data-var="${variableIndex}" title="Remove"><i class="fa-solid fa-xmark"></i></button>
    </div>`).join("");
}

export class BlueprintAssetManager extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    classes: ["sd", "sduw-assets-window"],
    window: { title: t("SDUI.Assets.Title", "My Blueprint — Assets"), icon: "fa-solid fa-cubes", resizable: true, minimizable: true },
    position: { width: 980, height: 720 }
  };

  constructor(document) {
    super({ id: `sd-blueprint-assets-${document.id}` });
    this.document = document;
    this.activeGroup = "functions";
    this.assets = normalizeBlueprintAssets(document.system);
  }

  async _renderHTML() {
    const root = document.createElement("div");
    root.className = "sduw-assets";
    root.innerHTML = `
      <aside class="sduw-assets-nav">
        <div class="sduw-assets-brand"><i class="fa-solid fa-cubes"></i><div><b>${t("SDUI.Assets.MyBlueprint", "My Blueprint")}</b><span>${esc(this.document.system.title ?? this.document.name)}</span></div></div>
        ${GROUPS.map(([id, label, icon]) => `<button type="button" data-group-tab="${id}" class="${id === this.activeGroup ? "is-active" : ""}"><i class="fa-solid ${icon}"></i><span>${label}</span><b>${this.assets[id]?.length ?? 0}</b></button>`).join("")}
      </aside>
      <main class="sduw-assets-main">
        <header><div><h2>${GROUPS.find(entry => entry[0] === this.activeGroup)?.[1] ?? "Assets"}</h2><p>${GROUPS.find(entry => entry[0] === this.activeGroup)?.[3] ?? ""}</p></div><button type="button" data-add-asset><i class="fa-solid fa-plus"></i> ${t("SDUI.Assets.Add", "Add")}</button></header>
        <section class="sduw-assets-list">${this._cards()}</section>
      </main>`;
    return root;
  }

  _replaceHTML(result, content) {
    content.innerHTML = "";
    content.appendChild(result);
  }

  _cards() {
    const list = this.assets[this.activeGroup] ?? [];
    if (!list.length) return `<div class="sduw-assets-empty"><i class="fa-solid fa-cube"></i><b>${t("SDUI.Assets.Empty", "No assets yet")}</b><span>${t("SDUI.Assets.EmptyHint", "Create one with the Add button.")}</span></div>`;
    return list.map((asset, index) => this._card(asset, index)).join("");
  }

  _card(asset, index) {
    const group = this.activeGroup;
    let body = "";
    if (group === "functions") {
      body = `<div class="sduw-asset-columns"><section><h3>${t("SDUI.Assets.Inputs", "Inputs")}</h3>${variableRows(asset.inputs, group, index, "inputs")}<button type="button" data-add-var data-group="${group}" data-asset="${index}" data-list="inputs"><i class="fa-solid fa-plus"></i> ${t("SDUI.Assets.Input", "Input")}</button></section><section><h3>${t("SDUI.Assets.Outputs", "Outputs")}</h3>${variableRows(asset.outputs, group, index, "outputs")}<button type="button" data-add-var data-group="${group}" data-asset="${index}" data-list="outputs"><i class="fa-solid fa-plus"></i> ${t("SDUI.Assets.Output", "Output")}</button></section></div><button type="button" class="is-primary" data-open-function="${index}"><i class="fa-solid fa-diagram-project"></i> ${t("SDUI.Assets.OpenFunction", "Open Function Graph")}</button>`;
    } else if (group === "customEvents") {
      body = `<section><h3>${t("SDUI.Assets.Parameters", "Parameters")}</h3>${variableRows(asset.parameters, group, index, "parameters")}<button type="button" data-add-var data-group="${group}" data-asset="${index}" data-list="parameters"><i class="fa-solid fa-plus"></i> ${t("SDUI.Assets.Parameter", "Parameter")}</button></section>`;
    } else if (group === "structs") {
      body = `<section><h3>${t("SDUI.Assets.Fields", "Fields")}</h3>${variableRows(asset.fields, group, index, "fields")}<button type="button" data-add-var data-group="${group}" data-asset="${index}" data-list="fields"><i class="fa-solid fa-plus"></i> ${t("SDUI.Assets.Field", "Field")}</button></section>`;
    } else if (group === "enums") {
      body = `<section><h3>Entries</h3>${(asset.entries ?? []).map((entry, entryIndex) => `<div class="sduw-asset-var"><input data-edit-entry="name" data-asset="${index}" data-entry="${entryIndex}" value="${esc(entry.name)}" aria-label="Name"><input data-edit-entry="value" data-asset="${index}" data-entry="${entryIndex}" value="${esc(entry.value ?? entry.id)}" aria-label="Value"><button type="button" data-remove-entry data-asset="${index}" data-entry="${entryIndex}"><i class="fa-solid fa-xmark"></i></button></div>`).join("")}<button type="button" data-add-entry="${index}"><i class="fa-solid fa-plus"></i> Entry</button></section>`;
    } else if (group === "dataTables") {
      const structs = this.assets.structs ?? [];
      const struct = structs.find(item => item.id === asset.structId);
      const fields = normalizeVariables(struct?.fields);
      body = `<label class="sduw-asset-field"><span>Row Struct</span><select data-edit-asset="structId" data-asset="${index}"><option value="">Select Struct…</option>${structs.map(item => `<option value="${esc(item.id)}" ${item.id === asset.structId ? "selected" : ""}>${esc(item.name)}</option>`).join("")}</select></label><section><h3>Rows</h3>${(asset.rows ?? []).map((row, rowIndex) => `<article class="sduw-table-row"><div><input data-edit-row-name data-asset="${index}" data-row="${rowIndex}" value="${esc(row.name)}"><button type="button" data-remove-row data-asset="${index}" data-row="${rowIndex}"><i class="fa-solid fa-trash"></i></button></div>${fields.map(field => `<label><span>${esc(field.name)}</span><input data-edit-row-value data-asset="${index}" data-row="${rowIndex}" data-field="${esc(field.id)}" value="${esc(row.values?.[field.id] ?? field.default ?? "")}"></label>`).join("")}</article>`).join("")}<button type="button" data-add-row="${index}" ${struct ? "" : "disabled"}><i class="fa-solid fa-plus"></i> Row</button></section>`;
    }
    return `<article class="sduw-asset-card"><header><div><input class="sduw-asset-name" data-edit-asset="name" data-asset="${index}" value="${esc(asset.name)}"><code>${esc(asset.id)}</code></div><button type="button" data-remove-asset="${index}" class="is-danger" title="Remove"><i class="fa-solid fa-trash"></i></button></header>${body}</article>`;
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const root = this.element;
    root.querySelectorAll("[data-group-tab]").forEach(button => button.addEventListener("click", () => {
      this.activeGroup = button.dataset.groupTab;
      this.render({ force: true });
    }));
    root.querySelector("[data-add-asset]")?.addEventListener("click", async () => {
      const list = this.assets[this.activeGroup] ??= [];
      list.push(fresh(this.activeGroup, list));
      await this._save(true);
    });
    root.querySelectorAll("[data-remove-asset]").forEach(button => button.addEventListener("click", async () => {
      this.assets[this.activeGroup].splice(Number(button.dataset.removeAsset), 1);
      await this._save(true);
    }));
    root.querySelectorAll("[data-edit-asset]").forEach(input => input.addEventListener("change", async () => {
      const asset = this.assets[this.activeGroup][Number(input.dataset.asset)];
      asset[input.dataset.editAsset] = input.value;
      if (input.dataset.editAsset === "name" && !asset.id) asset.id = safeId(input.value);
      await this._save(this.activeGroup === "dataTables" && input.dataset.editAsset === "structId");
    }));
    root.querySelectorAll("[data-add-var]").forEach(button => button.addEventListener("click", async () => {
      const asset = this.assets[button.dataset.group][Number(button.dataset.asset)];
      const list = asset[button.dataset.list] ??= [];
      list.push({ id: uniqueId(list, `value-${list.length + 1}`, { fallback: "value" }), name: `Value ${list.length + 1}`, type: "any", scope: "instance", default: null });
      await this._save(true);
    }));
    root.querySelectorAll("[data-edit-var]").forEach(input => input.addEventListener("change", async () => {
      const asset = this.assets[input.dataset.group][Number(input.dataset.asset)];
      const variable = asset[input.dataset.list][Number(input.dataset.var)];
      variable[input.dataset.editVar] = input.value;
      await this._save(false);
    }));
    root.querySelectorAll("[data-remove-var]").forEach(button => button.addEventListener("click", async () => {
      const asset = this.assets[button.dataset.group][Number(button.dataset.asset)];
      asset[button.dataset.list].splice(Number(button.dataset.var), 1);
      await this._save(true);
    }));
    root.querySelectorAll("[data-add-entry]").forEach(button => button.addEventListener("click", async () => {
      const asset = this.assets.enums[Number(button.dataset.addEntry)];
      const entries = asset.entries ??= [];
      const id = uniqueId(entries, `entry-${entries.length + 1}`, { fallback: "entry" });
      entries.push({ id, name: `Entry ${entries.length + 1}`, value: id });
      await this._save(true);
    }));
    root.querySelectorAll("[data-edit-entry]").forEach(input => input.addEventListener("change", async () => {
      this.assets.enums[Number(input.dataset.asset)].entries[Number(input.dataset.entry)][input.dataset.editEntry] = input.value;
      await this._save(false);
    }));
    root.querySelectorAll("[data-remove-entry]").forEach(button => button.addEventListener("click", async () => {
      this.assets.enums[Number(button.dataset.asset)].entries.splice(Number(button.dataset.entry), 1);
      await this._save(true);
    }));
    root.querySelectorAll("[data-add-row]").forEach(button => button.addEventListener("click", async () => {
      const table = this.assets.dataTables[Number(button.dataset.addRow)];
      const rows = table.rows ??= [];
      rows.push({ id: uniqueId(rows, `row-${rows.length + 1}`, { fallback: "row" }), name: `Row ${rows.length + 1}`, values: {} });
      await this._save(true);
    }));
    root.querySelectorAll("[data-edit-row-name]").forEach(input => input.addEventListener("change", async () => {
      this.assets.dataTables[Number(input.dataset.asset)].rows[Number(input.dataset.row)].name = input.value;
      await this._save(false);
    }));
    root.querySelectorAll("[data-edit-row-value]").forEach(input => input.addEventListener("change", async () => {
      const row = this.assets.dataTables[Number(input.dataset.asset)].rows[Number(input.dataset.row)];
      (row.values ??= {})[input.dataset.field] = input.value;
      await this._save(false);
    }));
    root.querySelectorAll("[data-remove-row]").forEach(button => button.addEventListener("click", async () => {
      this.assets.dataTables[Number(button.dataset.asset)].rows.splice(Number(button.dataset.row), 1);
      await this._save(true);
    }));
    root.querySelectorAll("[data-open-function]").forEach(button => button.addEventListener("click", () => this._openFunction(Number(button.dataset.openFunction))));
  }

  async _save(rerender) {
    this.assets = normalizeBlueprintAssets(this.assets);
    await this.document.update(Object.fromEntries(GROUPS.map(([key]) => [`system.${key}`, this.assets[key]])), { render: false });
    if (rerender) await this.render({ force: true });
  }

  async _openFunction(index) {
    const fn = this.assets.functions[index];
    if (!fn) return;
    const { FormulaGraph } = await import("/systems/sd/module/builder/formula-graph.mjs");
    const graph = new FormulaGraph(null, this.document, null, null, null, {
      mode: "actionGraph",
      actionGraphContext: `ui-blueprint-function:${this.document.system.blueprintId}:${fn.id}`,
      entryTitle: `Function — ${fn.name}`,
      functionSignature: { inputs: fn.inputs ?? [], outputs: fn.outputs ?? [] },
      customLoad: () => fn.graphData ?? { nodes: [], edges: [], comments: [] },
      customSave: async (graphData, compiled) => {
        this.assets.functions[index].graphData = graphData;
        this.assets.functions[index].compiled = String(compiled ?? "");
        await this._save(false);
      }
    });
    graph.open();
  }
}

export function openBlueprintAssetManager(document) {
  const app = new BlueprintAssetManager(document);
  app.render({ force: true });
  return app;
}
