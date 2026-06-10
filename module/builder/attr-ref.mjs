export const FILTER_OPERATORS = [
  { value: "==",         label: "= equals" },
  { value: "!=",         label: "≠ not equals" },
  { value: ">",          label: "> greater than" },
  { value: "<",          label: "< less than" },
  { value: ">=",         label: "≥ greater or equal" },
  { value: "<=",         label: "≤ less or equal" },
  { value: "contains",   label: "contains" },
  { value: "startsWith", label: "starts with" }
];

export class HiddenFields {

  static getAll(doc) {
    const hf = doc?.system?.hiddenFields ?? {};
    return Object.entries(hf).map(([key, value]) => ({ key, value, path: `system.hiddenFields.${key}` }));
  }

  static get(doc, key) {
    return doc?.system?.hiddenFields?.[key];
  }

  static async set(doc, key, value) {
    await doc.update({ [`system.hiddenFields.${key}`]: value });
  }

  static async rename(doc, oldKey, newKey) {
    const hf  = foundry.utils.deepClone(doc.system.hiddenFields ?? {});
    const val = hf[oldKey];
    delete hf[oldKey];
    hf[newKey] = val;
    await doc.update({ "system.hiddenFields": hf });
  }

  static async remove(doc, key) {
    const hf = foundry.utils.deepClone(doc.system.hiddenFields ?? {});
    delete hf[key];
    await doc.update({ "system.hiddenFields": hf });
  }
}

export class AttrFilter {

  static check(itemData, slotDef) {
    const filters = slotDef.attrFilters ?? [];
    if (!filters.length) return { pass: true, failed: [] };

    const failed = [];
    for (const f of filters) {
      const actual = this._resolveValue(itemData, f.fieldPath);
      if (!this._compare(actual, f.operator, f.expectedValue)) {
        failed.push(`${f.fieldPath} ${f.operator} "${f.expectedValue}" (got: "${actual ?? "—"}")`);
      }
    }
    return { pass: failed.length === 0, failed };
  }

  static _resolveValue(itemData, path) {
    return foundry.utils.getProperty(itemData, path);
  }

  static _compare(actual, op, expected) {
    const a = isNaN(actual)   ? String(actual ?? "")   : Number(actual);
    const e = isNaN(expected) ? String(expected ?? "")  : Number(expected);
    switch (op) {
      case "==":         return a == e;
      case "!=":         return a != e;
      case ">":          return Number(a) > Number(e);
      case "<":          return Number(a) < Number(e);
      case ">=":         return Number(a) >= Number(e);
      case "<=":         return Number(a) <= Number(e);
      case "contains":   return String(a).includes(String(e));
      case "startsWith": return String(a).startsWith(String(e));
      default:           return true;
    }
  }

  static async buildFromDrop(droppedItem, slotDef) {
    const fields = HiddenFields.getAll(droppedItem);

    if (!fields.length) {
      ui.notifications.warn(`"${droppedItem.name}" has no hidden fields. Add hidden fields to an item in its Attributes tab.`);
      return null;
    }

    const fieldOptions = fields.map((f, i) =>
      `<option value="${i}">${f.key} = "${f.value}"</option>`
    ).join("");

    const opOptions = FILTER_OPERATORS.map(o =>
      `<option value="${o.value}"${o.value === "==" ? " selected" : ""}>${o.label}</option>`
    ).join("");

    const style = `
      background:#22222e;border:1px solid #3a3a52;border-radius:4px;
      color:#e0e0ee;font-size:12px;padding:4px 8px;width:100%;box-sizing:border-box
    `;

    const content = `
      <div style="display:flex;flex-direction:column;gap:10px;padding:6px 0">
        <p style="font-size:11px;color:#888;margin:0">
          Fields from <strong style="color:#7b68ee">${droppedItem.name}</strong>:
        </p>
        <div style="display:grid;grid-template-columns:1fr auto 1fr;gap:6px;align-items:center">
          <select name="fieldIdx" style="${style}">${fieldOptions}</select>
          <select name="operator" style="${style};width:auto">${opOptions}</select>
          <input type="text" name="expectedValue" placeholder="expected value"
            value="${fields[0]?.value ?? ""}" style="${style}">
        </div>
        <p style="font-size:10px;color:#555;margin:0">
          The slot will only accept items where this field matches.
        </p>
      </div>`;

    return new Promise(resolve => {
      new foundry.applications.api.DialogV2({
        window: { title: "Add Attribute Filter" },
        content,
        buttons: [
          {
            label: "Add Filter", icon: "fas fa-filter",
            callback: (ev, btn) => {
              const dlgRoot      = btn.closest?.("[data-application]") ?? document;
              const idxEl        = dlgRoot.querySelector("select[name='fieldIdx']");
              const opEl         = dlgRoot.querySelector("select[name='operator']");
              const valEl        = dlgRoot.querySelector("input[name='expectedValue']");
              const idx          = parseInt(idxEl?.value ?? "0");
              const field        = fields[idx];
              resolve({
                id:            foundry.utils.randomID(8),
                fieldPath:     field?.path     ?? "",
                fieldLabel:    field?.key      ?? "",
                operator:      opEl?.value     ?? "==",
                expectedValue: valEl?.value?.trim() ?? ""
              });
            }
          },
          { label: "Cancel", callback: () => resolve(null) }
        ]
      }).render(true);
    });
  }
}
