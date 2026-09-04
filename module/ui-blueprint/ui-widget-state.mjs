import { MODULE_ID } from "./ui-widget-const.mjs";
import { requestWorldWrite } from "./ui-widget-net.mjs";
import {
  VARIABLE_SCOPES, VARIABLE_TYPES, coerceBlueprintValue, defaultForType,
  normalizeVariables, variableByRef, widgetByRef, safeId
} from "./ui-widget-blueprint.mjs";

export const VAR_SCOPES = VARIABLE_SCOPES;
export const VAR_TYPES = VARIABLE_TYPES;
export const coerceVarValue = coerceBlueprintValue;

/**
 * Legacy paths are read only for migration compatibility. The v3 editor and
 * graph use typed references and never ask the designer to author these paths.
 */
export function routePath(path, { hasActor = false, hasItem = false } = {}) {
  const raw = String(path ?? "").trim();
  if (!raw) return null;
  if (raw.startsWith("variable.")) return { target: "variable", key: raw.slice(9) };
  if (raw.startsWith("widget.")) {
    const [, id, ...rest] = raw.split(".");
    return { target: "widget", key: id, property: rest.join(".") || "value" };
  }
  if (raw.startsWith("actor.")) return { target: "actor", key: raw.slice(6) };
  if (raw.startsWith("item.")) return { target: "item", key: raw.slice(5) };
  for (const prefix of ["ui.", "var.", "system.vars.", "system.hiddenFields.", "system.flags."]) {
    if (raw.startsWith(prefix)) return { target: "variable", key: raw.slice(prefix.length).split(".")[0], legacy: true };
  }
  if (raw.startsWith("system.") && hasActor) return { target: "actor", key: raw };
  if (raw.startsWith("system.") && hasItem) return { target: "item", key: raw };
  return { target: "variable", key: raw, legacy: true };
}

const getProperty = (object, path) => globalThis.foundry?.utils?.getProperty?.(object, path);
const storageKey = blueprint => safeId(blueprint?.system?.blueprintId ?? blueprint?.system?.widgetKey, "ui-blueprint");

export class UIWidgetState {
  constructor(blueprint, { actor = null, item = null, initial = {} } = {}) {
    this.blueprint = blueprint;
    this.item = blueprint;
    this.actor = actor;
    this.contextItem = item;
    this._instance = {};
    this._widgets = {};
    this._listeners = new Set();
    this._defs = normalizeVariables(blueprint?.system?.variables);
    this._byId = new Map(this._defs.map(variable => [variable.id, variable]));
    this._byName = new Map(this._defs.map(variable => [variable.name, variable]));
    for (const variable of this._defs) {
      if (variable.scope === "instance") this._instance[variable.id] = coerceBlueprintValue(variable.default, variable.type);
    }
    for (const [ref, value] of Object.entries(initial ?? {})) {
      const variable = this.variableDef(ref);
      if (variable) this._instance[variable.id] = coerceBlueprintValue(value, variable.type);
    }
  }

  get widgetKey() { return storageKey(this.blueprint); }
  get hasActor() { return !!this.actor; }
  get hasItem() { return !!this.contextItem; }

  variableDef(ref) { return this._byId.get(String(ref)) ?? this._byName.get(String(ref)) ?? null; }
  varDef(ref) { return this.variableDef(ref) ?? { id: String(ref), name: String(ref), type: "any", scope: "instance", default: null }; }
  varDefs() { return [...this._defs]; }
  widgetDef(ref) { return widgetByRef(this.blueprint?.system, ref); }

  onChange(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  _notify(change) {
    for (const listener of this._listeners) {
      try { listener(change); } catch (error) { console.warn(`${MODULE_ID} | UI state listener failed`, error); }
    }
  }

  _userFlag(variable) { return `blueprintState.${this.widgetKey}.${variable.id}`; }
  _documentPath(variable) { return `system.blueprintState.${this.widgetKey}.${variable.id}`; }

  getVariable(ref) {
    const variable = this.variableDef(ref);
    if (!variable) return this._instance[String(ref)];
    let value;
    switch (variable.scope) {
      case "user": value = game.user?.getFlag?.(MODULE_ID, this._userFlag(variable)); break;
      case "actor": {
        value = getProperty(this.actor, this._documentPath(variable));
        if (value === undefined) value = this.actor?.system?.hiddenFields?.[variable.id] ?? this.actor?.system?.hiddenFields?.[variable.name];
        break;
      }
      case "item": {
        value = getProperty(this.contextItem, this._documentPath(variable));
        if (value === undefined) value = this.contextItem?.system?.hiddenFields?.[variable.id] ?? this.contextItem?.system?.hiddenFields?.[variable.name];
        break;
      }
      case "world": value = this.blueprint?.system?.worldState?.[variable.id]; break;
      default: value = this._instance[variable.id];
    }
    return value === undefined
      ? coerceBlueprintValue(variable.default ?? defaultForType(variable.type), variable.type)
      : coerceBlueprintValue(value, variable.type);
  }

  async setVariable(ref, raw, { force = false } = {}) {
    const variable = this.variableDef(ref) ?? { id: String(ref), name: String(ref), type: "any", scope: "instance" };
    if (variable.readOnly && !force) return this.getVariable(variable.id);
    const value = coerceBlueprintValue(raw, variable.type);
    const previous = this.getVariable(variable.id);
    if (Object.is(previous, value)) return value;

    switch (variable.scope) {
      case "user":
        await game.user?.setFlag?.(MODULE_ID, this._userFlag(variable), value);
        break;
      case "actor":
        if (!this.actor) throw new Error(`Variable '${variable.name}' requires an Actor context`);
        await this.actor.update({ [this._documentPath(variable)]: value }, { render: false });
        break;
      case "item":
        if (!this.contextItem) throw new Error(`Variable '${variable.name}' requires an Item context`);
        await this.contextItem.update({ [this._documentPath(variable)]: value }, { render: false });
        break;
      case "world":
        await requestWorldWrite(this.blueprint, { [variable.id]: value });
        break;
      default:
        this._instance[variable.id] = value;
    }

    this._notify({ kind: "variable", id: variable.id, name: variable.name, type: variable.type, value, previous });
    return value;
  }

  getWidgetProperty(ref, property = "value", fallback) {
    const widget = this.widgetDef(ref);
    const id = widget?.id ?? String(ref);
    const runtime = this._widgets[id];
    if (runtime && Object.hasOwn(runtime, property)) return runtime[property];
    if (property === "value" && widget?.valueVariableId) {
      const value = this.getVariable(widget.valueVariableId);
      return value === undefined ? fallback : value;
    }
    const value = widget?.props?.[property] ?? widget?.style?.[property] ?? widget?.[property];
    return value === undefined ? fallback : value;
  }

  /** True when a node (or macro) wrote a per-instance override for this property. */
  hasWidgetProperty(ref, property = "value") {
    const widget = this.widgetDef(ref);
    const id = widget?.id ?? String(ref);
    const runtime = this._widgets[id];
    return !!runtime && Object.hasOwn(runtime, property);
  }

  /** Drop a per-instance override so the designed value / binding applies again. */
  clearWidgetProperty(ref, property = "value", { emit = true } = {}) {
    const widget = this.widgetDef(ref);
    const id = widget?.id ?? String(ref);
    const runtime = this._widgets[id];
    if (!runtime || !Object.hasOwn(runtime, property)) return false;
    const previous = runtime[property];
    delete runtime[property];
    if (emit) this._notify({ kind: "widget", widgetId: id, property, value: this.getWidgetProperty(id, property), previous });
    return true;
  }

  async setWidgetProperty(ref, property = "value", value, { emit = true } = {}) {
    const widget = this.widgetDef(ref);
    const id = widget?.id ?? String(ref);
    if (!id) return value;
    const previous = this.getWidgetProperty(id, property);
    if (property === "value" && widget?.valueVariableId) await this.setVariable(widget.valueVariableId, value);
    else (this._widgets[id] ??= {})[property] = value;
    if (emit) this._notify({ kind: "widget", widgetId: id, property, value, previous });
    return value;
  }

  getPath(path, fallback = "") {
    const route = routePath(path, { hasActor: this.hasActor, hasItem: this.hasItem });
    if (!route) return fallback;
    let value;
    if (route.target === "variable") value = this.getVariable(route.key);
    else if (route.target === "widget") value = this.getWidgetProperty(route.key, route.property, fallback);
    else if (route.target === "actor") value = getProperty(this.actor ?? {}, route.key);
    else value = getProperty(this.contextItem ?? {}, route.key);
    return value == null ? fallback : value;
  }

  async setPath(path, value) {
    const route = routePath(path, { hasActor: this.hasActor, hasItem: this.hasItem });
    if (!route) return undefined;
    if (route.target === "variable") return this.setVariable(route.key, value);
    if (route.target === "widget") return this.setWidgetProperty(route.key, route.property, value);
    const document = route.target === "actor" ? this.actor : this.contextItem;
    if (document) await document.update({ [route.key]: value });
    return value;
  }

  snapshot() {
    return {
      blueprintId: this.widgetKey,
      variables: Object.fromEntries(this._defs.map(variable => [variable.id, this.getVariable(variable.id)])),
      widgets: Object.fromEntries((this.blueprint?.system?.elements ?? []).map(widget => [widget.id, {
        ...(widget.props ?? {}),
        ...(widget.style ?? {}),
        ...(this._widgets[widget.id] ?? {}),
        value: this.getWidgetProperty(widget.id, "value")
      }]))
    };
  }

  buildContext() {
    const snapshot = this.snapshot();
    const variables = { ...snapshot.variables };
    for (const variable of this._defs) {
      if (!(variable.name in variables)) variables[variable.name] = variables[variable.id];
    }
    const actor = this.actor;
    const item = this.contextItem;
    return {
      name: this.blueprint?.system?.title || this.blueprint?.name || "UI Blueprint",
      uuid: this.blueprint?.uuid ?? "",
      id: this.blueprint?.id ?? "",
      documentName: "Item",
      type: "uiwidget",
      isOwner: true,
      variables,
      ui: variables,
      widgets: snapshot.widgets,
      actor,
      item,
      system: { ui: variables, widgets: snapshot.widgets },
      items: actor?.items ?? [],
      effects: actor?.effects ?? [],
      getRollData: () => ({ ...actor?.getRollData?.(), ui: variables, widgets: snapshot.widgets }),
      testUserPermission: () => true,
      __uiState: this
    };
  }
}
