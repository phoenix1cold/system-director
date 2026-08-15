import { loadI18n, applyLangAttrs, getLang, initLangToggle } from "./i18n.js";

const NAV = [
  { href:"index.html", en:"Home", ru:"Главная", match:["","index.html"] },
  { href:"getting-started.html", en:"Start", ru:"Начало" },
  { href:"sheets.html", en:"Sheets", ru:"Листы" },
  { href:"node-graph.html", en:"Node Graph", ru:"Ноды" },
  { href:"database.html", en:"Database", ru:"База данных" },
  { href:"quests.html", en:"Quests", ru:"Квесты" },
  { href:"progression.html", en:"Progression", ru:"Прогрессия" },
  { href:"equipment.html", en:"Equipment", ru:"Экипировка" },
  { href:"areas-effects.html", en:"AoE & Effects", ru:"AoE и эффекты" },
  { href:"macros.html", en:"Macros", ru:"Макросы" },
  { href:"examples.html", en:"Examples", ru:"Примеры" },
  { href:"widgets.html", en:"Widget Reference", ru:"Виджеты" },
  { href:"nodes.html", en:"Node Reference", ru:"Справочник нод" }
];

function currentPage(){ return location.pathname.split("/").pop() || "index.html"; }
function buildHeader(){
  const header=document.querySelector(".site-header"); if(!header) return;
  const here=currentPage();
  header.innerHTML=`<a class="brand" href="index.html"><span class="logo">SD</span><span>System Director</span></a><nav id="topnav" aria-label="Wiki navigation"></nav><button class="lang-toggle" id="lang-toggle" type="button">RU</button>`;
  const nav=header.querySelector("#topnav");
  for(const item of NAV){
    const a=document.createElement("a"); a.href=item.href; a.dataset.bilingual=""; a.dataset.en=item.en; a.dataset.ru=item.ru;
    if((item.match??[item.href]).includes(here)) a.classList.add("active");
    nav.appendChild(a);
  }
  initLangToggle(header.querySelector("#lang-toggle"));
  applyLangAttrs(header);
}
export async function bootPage(){
  await loadI18n(); buildHeader(); applyLangAttrs(); document.documentElement.lang=getLang();
  window.addEventListener("sd:lang-change",()=>{ applyLangAttrs(); document.documentElement.lang=getLang(); });
}
