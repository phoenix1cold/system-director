// Simple i18n + language toggle, persisting choice in localStorage.
// Translations are loaded from data/i18n.json. Pages can render bilingual
// content by calling setLang() / t() and listening on `sd:lang-change`.

const SD_LS_KEY = "sd-wiki-lang";
let _i18n = null;
let _lang = (typeof localStorage !== "undefined" && localStorage.getItem(SD_LS_KEY)) || navigatorLang();

function navigatorLang() {
  if (typeof navigator === "undefined") return "en";
  const l = (navigator.language || "en").toLowerCase();
  return l.startsWith("ru") ? "ru" : "en";
}

export async function loadI18n() {
  if (_i18n) return _i18n;
  const r = await fetch(new URL("../data/i18n.json", import.meta.url));
  _i18n = await r.json();
  return _i18n;
}

export function getLang() { return _lang; }

export function setLang(l) {
  if (l !== "ru" && l !== "en") return;
  _lang = l;
  try { localStorage.setItem(SD_LS_KEY, l); } catch {}
  document.documentElement.lang = l;
  applyLangAttrs();
  window.dispatchEvent(new CustomEvent("sd:lang-change", { detail: { lang: l } }));
}

export function toggleLang() { setLang(_lang === "ru" ? "en" : "ru"); }

/** Translate by key path like "ui.nav.home" or arbitrary {en,ru}. */
export function t(key) {
  if (!_i18n) return key;
  if (typeof key === "object" && key) {
    return key[_lang] ?? key.en ?? key.ru ?? "";
  }
  // dotted key path
  const parts = String(key).split(".");
  let cur = _i18n;
  for (const p of parts) {
    if (cur && typeof cur === "object" && p in cur) cur = cur[p];
    else return key;
  }
  if (cur && typeof cur === "object") return cur[_lang] ?? cur.en ?? cur.ru ?? key;
  return cur;
}

/** Apply data-i18n="…" placeholders across the page. */
export function applyLangAttrs(root = document) {
  for (const el of root.querySelectorAll("[data-i18n]")) {
    const v = t(el.dataset.i18n);
    // Translations may contain inline HTML (<kbd>, <code>, <strong>, …),
    // so we render as HTML rather than escape it.
    el.innerHTML = (v == null ? "" : String(v));
  }
  for (const el of root.querySelectorAll("[data-i18n-attr]")) {
    const [attr, key] = el.dataset.i18nAttr.split("|");
    el.setAttribute(attr, t(key));
  }
  for (const el of root.querySelectorAll("[data-bilingual]")) {
    // Element provides both languages with optional inline HTML.
    const en = el.dataset.en ?? "";
    const ru = el.dataset.ru ?? "";
    el.innerHTML = _lang === "ru" ? (ru || en) : (en || ru);
  }
}

/** Pick from a node/widget translation overlay. */
export function pickLocale(obj, fallback = "") {
  if (!obj) return fallback;
  if (typeof obj === "string") return obj;
  return obj[_lang] ?? obj.en ?? obj.ru ?? fallback;
}

export function initLangToggle(btn) {
  if (!btn) return;
  btn.addEventListener("click", toggleLang);
  const refresh = () => { btn.textContent = _lang === "ru" ? "EN" : "RU"; };
  refresh();
  window.addEventListener("sd:lang-change", refresh);
}
