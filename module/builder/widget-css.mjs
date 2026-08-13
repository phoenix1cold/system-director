const MAX_CSS_LENGTH = 12000;

const ALLOWED_PROPERTIES = new Set([
  "align-content", "align-items", "align-self", "aspect-ratio",
  "background", "background-color", "background-image", "background-position", "background-repeat", "background-size",
  "border", "border-color", "border-radius", "border-style", "border-width",
  "border-top", "border-right", "border-bottom", "border-left",
  "box-shadow", "box-sizing",
  "color", "column-gap", "display",
  "flex", "flex-basis", "flex-direction", "flex-flow", "flex-grow", "flex-shrink", "flex-wrap",
  "font", "font-family", "font-size", "font-style", "font-variant", "font-weight",
  "gap", "grid", "grid-area", "grid-auto-columns", "grid-auto-flow", "grid-auto-rows",
  "grid-column", "grid-column-end", "grid-column-start", "grid-row", "grid-row-end", "grid-row-start",
  "grid-template", "grid-template-areas", "grid-template-columns", "grid-template-rows",
  "height", "justify-content", "justify-items", "justify-self", "letter-spacing", "line-height",
  "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
  "max-height", "max-width", "min-height", "min-width", "object-fit", "object-position", "opacity", "order",
  "outline", "outline-color", "outline-offset", "outline-style", "outline-width", "overflow", "overflow-x", "overflow-y",
  "padding", "padding-top", "padding-right", "padding-bottom", "padding-left", "place-content", "place-items", "place-self",
  "pointer-events", "position", "row-gap", "text-align", "text-decoration", "text-overflow", "text-shadow",
  "text-transform", "transform", "transform-origin", "transition", "vertical-align", "visibility", "white-space",
  "width", "word-break", "word-spacing", "z-index"
]);

const FORBIDDEN_SOURCE = /(?:<\/?style|@(?:import|charset|namespace|font-face|keyframes|layer|supports|media|container)|expression\s*\(|javascript\s*:|vbscript\s*:|data\s*:|url\s*\(|behavior\s*:|-moz-binding|\\0)/i;
const FORBIDDEN_VALUE = /(?:[{}<>]|@|expression\s*\(|javascript\s*:|vbscript\s*:|data\s*:|url\s*\(|behavior\s*:|-moz-binding|\\0)/i;
const FORBIDDEN_SELECTOR = /(?:[{}<>@]|\b(?:html|body|head|iframe|object|embed|script|style)\b|:root)/i;

function splitTopLevel(input, delimiter) {
  const out = [];
  let buf = "";
  let quote = "";
  let depth = 0;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quote) {
      buf += ch;
      if (ch === quote && input[i - 1] !== "\\") quote = "";
      continue;
    }
    if (ch === "\"" || ch === "'") { quote = ch; buf += ch; continue; }
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === delimiter && depth === 0) { out.push(buf); buf = ""; }
    else buf += ch;
  }
  out.push(buf);
  return out;
}

function sanitizeDeclarations(body, warnings) {
  const safe = [];
  for (const rawDecl of splitTopLevel(body, ";")) {
    const decl = rawDecl.trim();
    if (!decl) continue;
    const colon = decl.indexOf(":");
    if (colon <= 0) { warnings.push(`Skipped malformed declaration: ${decl.slice(0, 60)}`); continue; }
    const prop = decl.slice(0, colon).trim().toLowerCase();
    let value = decl.slice(colon + 1).trim();
    if (!value) continue;
    const customProperty = /^--sd-[a-z0-9-]{1,64}$/.test(prop);
    if (!customProperty && !ALLOWED_PROPERTIES.has(prop)) {
      warnings.push(`Property not allowed: ${prop}`);
      continue;
    }
    if (FORBIDDEN_VALUE.test(value)) {
      warnings.push(`Unsafe value removed for: ${prop}`);
      continue;
    }
    value = value.replace(/!\s*important/gi, "").trim();
    if (prop === "position" && !/^(?:static|relative|absolute)$/i.test(value)) {
      warnings.push("Only static, relative and absolute positioning is allowed");
      continue;
    }
    if (prop === "z-index") {
      const z = Number(value);
      if (!Number.isFinite(z)) continue;
      value = String(Math.max(-1000, Math.min(1000, Math.round(z))));
    }
    safe.push(`${prop}:${value}`);
  }
  return safe.join(";");
}

function scopeSelectors(selectorText, scopeSelector, warnings) {
  const safe = [];
  for (const raw of splitTopLevel(selectorText, ",")) {
    const selector = raw.trim();
    if (!selector) continue;
    if (FORBIDDEN_SELECTOR.test(selector)) {
      warnings.push(`Selector not allowed: ${selector.slice(0, 80)}`);
      continue;
    }
    if (/^[>+~]/.test(selector)) {
      warnings.push(`Malformed selector skipped: ${selector.slice(0, 80)}`);
      continue;
    }
    let scoped;
    if (selector.includes("&")) scoped = selector.replaceAll("&", scopeSelector);
    else if (selector.includes(":scope")) scoped = selector.replaceAll(":scope", scopeSelector);
    else scoped = `${scopeSelector} ${selector}`;
    safe.push(scoped);
  }
  return safe.join(",");
}

/**
 * Sanitize user-authored Widget Builder CSS and scope every selector to one
 * widget instance. At-rules, external resources and browser escape hatches are
 * deliberately rejected. A declaration-only input applies to the builder root.
 */
export function sanitizeWidgetCss(rawCss, scopeSelector) {
  const warnings = [];
  const scope = String(scopeSelector ?? "").trim();
  if (!/^\[data-sd-wb="[a-zA-Z0-9_-]+"\]$/.test(scope)) {
    return { css: "", warnings: ["Invalid Widget Builder scope"] };
  }
  let source = String(rawCss ?? "").slice(0, MAX_CSS_LENGTH);
  if (String(rawCss ?? "").length > MAX_CSS_LENGTH) warnings.push(`CSS truncated to ${MAX_CSS_LENGTH} characters`);
  source = source.replace(/\/\*[\s\S]*?\*\//g, "").trim();
  if (!source) return { css: "", warnings };
  if (FORBIDDEN_SOURCE.test(source)) return { css: "", warnings: [...warnings, "CSS contains a blocked construct"] };

  if (!source.includes("{")) {
    const declarations = sanitizeDeclarations(source, warnings);
    return { css: declarations ? `${scope}{${declarations}}` : "", warnings };
  }

  const rules = [];
  let cursor = 0;
  while (cursor < source.length) {
    const open = source.indexOf("{", cursor);
    if (open < 0) {
      if (source.slice(cursor).trim()) warnings.push("Trailing CSS text was skipped");
      break;
    }
    const selectorText = source.slice(cursor, open).trim();
    const close = source.indexOf("}", open + 1);
    if (close < 0) { warnings.push("Unclosed CSS rule was skipped"); break; }
    const body = source.slice(open + 1, close);
    if (body.includes("{") || body.includes("}")) {
      warnings.push("Nested CSS rules are not allowed");
      cursor = close + 1;
      continue;
    }
    const selectors = scopeSelectors(selectorText, scope, warnings);
    const declarations = sanitizeDeclarations(body, warnings);
    if (selectors && declarations) rules.push(`${selectors}{${declarations}}`);
    cursor = close + 1;
  }
  return { css: rules.join("\n"), warnings };
}

export function widgetBuilderScopeId(widgetId) {
  const safe = String(widgetId ?? "widget-builder").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
  return safe || "widget-builder";
}
