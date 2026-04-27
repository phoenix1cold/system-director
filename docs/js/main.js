// Shared bootstrap: builds the site header / nav, wires up the language toggle.
import { loadI18n, applyLangAttrs, t, getLang, initLangToggle } from "./i18n.js";

const NAV = [
  { href: "index.html",            key: "ui.nav.home",     match: ["", "index.html"] },
  { href: "getting-started.html",  key: "ui.nav.start",    match: ["getting-started.html"] },
  { href: "widgets.html",          key: "ui.nav.widgets",  match: ["widgets.html"] },
  { href: "nodes.html",            key: "ui.nav.nodes",    match: ["nodes.html"] },
  { href: "examples.html",         key: "ui.nav.examples", match: ["examples.html"] }
];

function currentPage() {
  const path = location.pathname.split("/").pop();
  return path || "index.html";
}

function buildHeader() {
  const here = currentPage();
  const header = document.querySelector(".site-header");
  if (!header) return;

  header.innerHTML = `
    <a class="brand" href="index.html">
      <span class="logo">SD</span>
      <span data-i18n="ui.siteTitle">System Director — Wiki</span>
    </a>
    <nav id="topnav"></nav>
    <button class="lang-toggle" id="lang-toggle" type="button">RU</button>
  `;
  const nav = header.querySelector("#topnav");
  for (const item of NAV) {
    const a = document.createElement("a");
    a.href = item.href;
    a.dataset.i18n = item.key;
    if (item.match.includes(here)) a.classList.add("active");
    nav.appendChild(a);
  }
  initLangToggle(header.querySelector("#lang-toggle"));
}

export async function bootPage() {
  await loadI18n();
  buildHeader();
  applyLangAttrs();
  document.documentElement.lang = getLang();
  // Re-apply on language change anywhere on the page
  window.addEventListener("sd:lang-change", () => {
    applyLangAttrs();
    document.documentElement.lang = getLang();
  });
}
