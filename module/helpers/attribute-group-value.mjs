import { widgetVarPath } from "./widget-variables.mjs";
import { FormulaEngine } from "./formula-engine.mjs";

const displayKey = key => String(key).match(/^system\.attributes\.([^.]+)(?:\.(?:value|score|mod))?$/)?.[1] ?? String(key).split(".").at(-1);
export const attributeGroupModifierPath = (widget, key) => `${widgetVarPath(widget,"modifiers")}.${encodeURIComponent(displayKey(key)).replaceAll(".","%2E")}`;

export function attributeGroupModifier(widget, doc, key, score) {
  const stored=foundry.utils.getProperty(doc,attributeGroupModifierPath(widget,key));
  if(stored!==undefined&&stored!==null&&Number.isFinite(Number(stored)))return Number(stored);
  const formula=widget.attrGraphs?.[displayKey(key)]?.modValueFormula;
  if(formula){const result=Number(FormulaEngine.evaluate(formula,doc));if(Number.isFinite(result))return result;}
  return (globalThis.CONFIG?.SD?.computeModifier ?? (value=>Math.floor((Number(value)-10)/2)))(score);
}
