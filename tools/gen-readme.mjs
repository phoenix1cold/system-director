#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot  = resolve(__dirname, "..");

globalThis.foundry     = globalThis.foundry     ?? { utils: { randomID: () => "xxx" } };
globalThis.game        = globalThis.game        ?? {};
globalThis.Hooks       = globalThis.Hooks       ?? { on:()=>{}, once:()=>{}, call:()=>{}, callAll:()=>{} };
globalThis.CONFIG      = globalThis.CONFIG      ?? {};
globalThis.CONST       = globalThis.CONST       ?? {};
globalThis.ui          = globalThis.ui          ?? {};
globalThis.canvas      = globalThis.canvas      ?? {};
globalThis.ChatMessage = globalThis.ChatMessage ?? {};
globalThis.Roll        = globalThis.Roll        ?? class {};
globalThis.document    = globalThis.document    ?? {
  getElementById: () => ({ appendChild(){}, setAttribute(){}, addEventListener(){} }),
  createElement:  () => ({ appendChild(){}, setAttribute(){}, addEventListener(){}, style:{}, classList:{ add(){}, remove(){} } }),
  head:           { appendChild(){} },
  body:           { appendChild(){}, addEventListener(){} },
  addEventListener: () => {},
  querySelector:  () => null,
  querySelectorAll: () => []
};
globalThis.window      = globalThis.window      ?? globalThis;

const mod = await import(resolve(repoRoot, "module/builder/formula-graph.mjs"));
const { NODE_DEFS } = mod;

const src = readFileSync(resolve(repoRoot, "module/builder/formula-graph.mjs"), "utf8");
function extractArrayLiteral(name) {
  const m = new RegExp(`const\\s+${name}\\s*=\\s*\\[([\\s\\S]*?)\\];`, "m").exec(src);
  if (!m) return [];
  return Function(`"use strict"; return [${m[1]}];`)();
}
const CATS = extractArrayLiteral("CATS");

// Helpers

const esc = (s) => String(s ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

const kindOf = (def) => {
  if (!def) return "pure";
  if (def.isEvent)   return "event";
  if (def.isTrigger) return "event";
  if (def.isAction)  return "imperative";
  if (def.isBranch || def.isSaveBranch || def.isAttackBranch ||
      def.isTieredBranch || def.isGenericBranch || def.isProgressionBranch) return "imperative";
  if (def.isMacroInput || def.isMacroOutput || def.isMacro) return "imperative";
  return "pure";
};

const flagsOf = (def) => {
  const f = [];
  if (def.isEvent)               f.push("event");
  if (def.isTrigger)             f.push("trigger");
  if (def.isAction)              f.push("action");
  if (def.isBranch)              f.push("branch");
  if (def.isSaveBranch)          f.push("save-branch");
  if (def.isAttackBranch)        f.push("attack-branch");
  if (def.isTieredBranch)        f.push("tiered-branch");
  if (def.isGenericBranch)       f.push("generic-branch");
  if (def.isProgressionBranch)   f.push("progression-branch");
  if (def.isMacro)               f.push("macro");
  if (def.isMacroInput)          f.push("macro-input");
  if (def.isMacroOutput)         f.push("macro-output");
  if (def.wideNode)              f.push("wide");
  if (def.hidden)                f.push("hidden");
  if (def.sheetOnly)             f.push("sheet-only");
  if (def.itemOnly)              f.push("item-only");
  if (def.attributeOnly)         f.push("attribute-only");
  if (def.widgetContext)         f.push(`widget:${def.widgetContext}`);
  return f;
};

const pinType = (p) => p.type === "exec" ? "exec" : "value";

const fieldType = (f) => {
  if (f.type === "select" && Array.isArray(f.options)) {
    return `select (${f.options.map(o => `<code>${esc(o)}</code>`).join(", ")})`;
  }
  return esc(f.type || "text");
};

// Slugify a node id for anchors.
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

// Category grouping

// Build category → [nodes]
const categoryOrder = CATS.map(c => c.id);
const categoryColor = Object.fromEntries(CATS.map(c => [c.id, c.color]));
const byCategory = {};

const nodeEntries = Object.entries(NODE_DEFS);
for (const [id, def] of nodeEntries) {
  if (!def || def.hidden) continue;
  const cat = def.cat && def.cat !== "_system" ? def.cat : "System";
  if (!byCategory[cat]) byCategory[cat] = [];
  byCategory[cat].push([id, def]);
}

const orderedCats = [
  "System",
  ...categoryOrder.filter(c => byCategory[c]),
  ...Object.keys(byCategory).filter(c => c !== "System" && !categoryOrder.includes(c)).sort()
].filter((c, i, a) => byCategory[c] && a.indexOf(c) === i);

for (const c of orderedCats) {
  byCategory[c].sort((a, b) => (a[1].title ?? a[0]).localeCompare(b[1].title ?? b[0]));
}

// Renderers

function renderPinRow(p) {
  const t = pinType(p);
  const cls = t === "exec" ? "pin pin-exec" : "pin pin-value";
  return `<tr>
    <td><code>${esc(p.id)}</code></td>
    <td>${esc(p.label || "")}</td>
    <td><span class="${cls}">${t}</span></td>
  </tr>`;
}

function renderFieldRow(f) {
  const dflt = (f.default === undefined || f.default === "") ? "—" : esc(JSON.stringify(f.default));
  return `<tr>
    <td><code>${esc(f.key)}</code></td>
    <td>${esc(f.label || "")}</td>
    <td>${fieldType(f)}</td>
    <td><code>${dflt}</code></td>
  </tr>`;
}

function renderNode(id, def) {
  const k = kindOf(def);
  const flags = flagsOf(def);
  const inputs  = def.inputs  ?? [];
  const outputs = def.outputs ?? [];
  const fields  = def.fields  ?? [];

  return `
<article class="node" id="node-${slug(id)}">
  <header class="node-header" style="border-left:5px solid ${def.color || "#888"};">
    <div class="node-title-row">
      <h3 class="node-title">${esc(def.title || id)}</h3>
      <code class="node-id">${esc(id)}</code>
    </div>
    <div class="node-meta">
      <span class="kind kind-${k}">${k}</span>
      ${flags.map(f => `<span class="flag">${esc(f)}</span>`).join("")}
      <span class="cat-tag" style="background:${def.color || "#888"};">${esc(def.cat || "_")}</span>
    </div>
  </header>
  ${def.desc ? `<p class="node-desc">${esc(def.desc)}</p>` : ""}

  <div class="pin-grid">
    <section>
      <h4>Inputs (${inputs.length})</h4>
      ${inputs.length ? `
        <table class="pins">
          <thead><tr><th>id</th><th>label</th><th>type</th></tr></thead>
          <tbody>${inputs.map(renderPinRow).join("")}</tbody>
        </table>` : `<p class="empty">—</p>`}
    </section>
    <section>
      <h4>Outputs (${outputs.length})</h4>
      ${outputs.length ? `
        <table class="pins">
          <thead><tr><th>id</th><th>label</th><th>type</th></tr></thead>
          <tbody>${outputs.map(renderPinRow).join("")}</tbody>
        </table>` : `<p class="empty">—</p>`}
    </section>
  </div>

  ${fields.length ? `
  <section class="fields">
    <h4>Fields (${fields.length})</h4>
    <table class="pins">
      <thead><tr><th>key</th><th>label</th><th>type</th><th>default</th></tr></thead>
      <tbody>${fields.map(renderFieldRow).join("")}</tbody>
    </table>
  </section>` : ""}
</article>`;
}

function renderCategory(cat) {
  const nodes = byCategory[cat] ?? [];
  const color = categoryColor[cat] || "#555";
  return `
<section class="category" id="cat-${slug(cat)}">
  <h2 class="category-title" style="border-bottom:3px solid ${color};">
    ${esc(cat)} <small class="cat-count">${nodes.length} nodes</small>
  </h2>
  ${nodes.map(([id, def]) => renderNode(id, def)).join("\n")}
</section>`;
}

function renderToc() {
  return `
<nav class="toc">
  <h4>Categories</h4>
  <ul>
    ${orderedCats.map(c => {
      const count = (byCategory[c] ?? []).length;
      const color = categoryColor[c] || "#555";
      return `<li><a href="#cat-${slug(c)}"><span class="toc-sw" style="background:${color};"></span>${esc(c)} <small>${count}</small></a></li>`;
    }).join("")}
  </ul>
  <h4>Examples</h4>
  <ul>
    <li><a href="#ex-basic">Basic on_click</a></li>
    <li><a href="#ex-aoe-save-branch">AoE Save Branch</a></li>
    <li><a href="#ex-damage-aura">Damage Aura</a></li>
    <li><a href="#ex-progression">Progression / Threshold</a></li>
    <li><a href="#ex-opposed">Opposed Roll</a></li>
    <li><a href="#ex-equip">Activate-on-Equip</a></li>
  </ul>
  <h4>Reference</h4>
  <ul>
    <li><a href="#ref-kinds">Node kinds</a></li>
    <li><a href="#ref-runtime">Runtime placeholders</a></li>
  </ul>
</nav>`;
}

// Worked examples

const examples = `
<section class="examples">
  <h2 id="examples-top">Worked examples</h2>

  <article class="example" id="ex-basic">
    <h3>1. Basic on_click → chat damage</h3>
    <p>Posts a damage card when the widget button is pressed.  The simplest possible pipeline — one entry-point, one action.</p>
<pre class="graph">
[on_click] ── exec ──▶ [act_damage]
                         • formula     "1d8 + @mod.str"
                         • damageType  "slashing"
                         • hpPath      "system.resources.hp.value"
</pre>
    <p>The target is resolved automatically: if no <code>target</code> pin is wired, the runtime falls back to <code>game.user.targets</code> then to <code>canvas.tokens.controlled</code>.</p>
  </article>

  <article class="example" id="ex-aoe-save-branch">
    <h3>2. AoE Save Branch (Fireball-style)</h3>
    <p>Post a chat card with a <em>Place Template</em> button.  When placed, every token caught inside rolls a saving throw; the <code>Saved →</code> branch fires per token that passed, the <code>Failed →</code> branch per token that failed.</p>
<pre class="graph">
[on_click] ──▶ [act_place_aoe_save_branch]
                 • shape       "circle"
                 • size        20
                 • saveAttr    "system.attributes.dex.value"
                 • dc          15
                 • perTarget   "yes"
                 • persist     "no"

               Saved ─▶ [act_damage]
                          • formula  "(8d6) / 2"            ← half on save
                          • damageType "fire"

               Failed ─▶ [act_damage]
                          • formula  "8d6"
                          • damageType "fire"
</pre>
    <p>Inside the branches the caught token set is available to sub-actions via the runtime placeholders:</p>
    <ul>
      <li><code>{__savedTargets}</code> — comma-joined token-ids that passed</li>
      <li><code>{__failedTargets}</code> — comma-joined token-ids that failed</li>
      <li><code>{__allTargets}</code> — every token originally caught</li>
      <li><code>{__currentTarget}</code> — the token id for the current per-target iteration (only set when <code>perTarget="yes"</code>)</li>
    </ul>
  </article>

  <article class="example" id="ex-damage-aura">
    <h3>3. Damage Aura (Spirit-Guardians-style)</h3>
    <p>Attach a region to the caster; every token inside takes damage on entry and at the start of each turn they spend inside.</p>
<pre class="graph">
[on_click] ──▶ [act_place_aura_damage]
                 • owner             "self"
                 • shape             "emanation"
                 • size              15
                 • formula           "3d8"
                 • damageType        "radiant"
                 • tickMode          "onEnter+eachTurn"
                 • chatMode          "card"
                 • visibility        "everyone"
                 • rounds            10
                 • conditionEffect   "Unconscious"   ← suppressed while owner is KO
</pre>
    <p><strong>Condition suppression:</strong> if the owner has an ActiveEffect whose name matches <code>conditionEffect</code>, the aura stops ticking and stops applying damage until the condition is gone.  Perfect for "only works while concentrating" or "disabled while prone" mechanics.</p>
  </article>

  <article class="example" id="ex-progression">
    <h3>4. Progression / Threshold roll</h3>
    <p>Roll, persist the value, compare against the previous roll, branch on the delta.  Great for corruption tracks, exhaustion levels, or sanity checks.</p>
<pre class="graph">
[on_click] ──▶ [act_progression]
                 • formula   "1d100"
                 • statePath "flags.sd.vars.sanity"
                 • compare   "greater"

               Higher    ─▶ [act_apply_effect]  name="Shaken"
               Lower     ─▶ [act_remove_effect] name="Shaken"
               Equal     ─▶ [act_chat]          text="No change"
               NoHistory ─▶ [act_chat]          text="Baseline set"

               value     ─▶  {__lastRoll}       ← current roll
               previous  ─▶  {__progPrev}       ← previous stored value
</pre>
  </article>

  <article class="example" id="ex-opposed">
    <h3>5. Opposed check</h3>
    <p>Chat card posts an initial attacker roll and N opponent buttons.  The runtime picks the highest opponent total and branches on who won.</p>
<pre class="graph">
[on_click] ──▶ [act_roll_check]
                 • formula          "1d20 + @prof"
                 • opposed          true
                 • opposedCount     3
                 • opposedFormula   "1d20 + @ath"

               YouWon   ─▶ [act_damage]  formula "2d6"
               YouLost  ─▶ [act_chat]    text "Outmatched!"

               winnerTokenId ─▶ {__opposedWinnerRoll}
</pre>
  </article>

  <article class="example" id="ex-equip">
    <h3>6. Activate-on-Equip</h3>
    <p>Drop this into the <em>item → sheet-trigger-graph</em> tab.  The on_equip event fires when the player equips the item; on_unequip does the reverse.</p>
<pre class="graph">
[on_equip]   ──▶ [act_apply_effect]  name="Longsword Proficiency"
[on_unequip] ──▶ [act_remove_effect] name="Longsword Proficiency"
</pre>
    <p>The <em>Activate on Equip</em> checkbox on any ActiveEffect row on the Effects tab does the same thing for simple effects — no graph required.</p>
  </article>
</section>`;

// Reference sections

const reference = `
<section class="reference">
  <h2 id="reference-top">Reference</h2>

  <article id="ref-kinds">
    <h3>Node kinds</h3>
    <p>Every node belongs to one of three behavioural kinds.  Kind is reflected in the border colour of the node and by the <code>kind-*</code> tag in this doc.</p>
    <table class="pins">
      <thead><tr><th>Kind</th><th>Meaning</th><th>Examples</th></tr></thead>
      <tbody>
        <tr>
          <td><span class="kind kind-pure">pure</span></td>
          <td>Computes a value.  No exec pins, never mutates document state.</td>
          <td><code>lit_num</code>, <code>get_path</code>, <code>math_add</code>, <code>cmp_eq</code></td>
        </tr>
        <tr>
          <td><span class="kind kind-imperative">imperative</span></td>
          <td>Executes on an exec chain and usually mutates a document (actor / item / region).</td>
          <td><code>act_damage</code>, <code>act_apply_effect</code>, <code>act_place_aoe_*</code></td>
        </tr>
        <tr>
          <td><span class="kind kind-event">event</span></td>
          <td>Entry point.  Fires on a Foundry hook instead of on button click.</td>
          <td><code>on_click</code>, <code>on_update</code>, <code>on_turn_start</code>, <code>on_equip</code></td>
        </tr>
      </tbody>
    </table>
  </article>

  <article id="ref-runtime">
    <h3>Runtime placeholders</h3>
    <p>Value-pin outputs of certain nodes compile to runtime placeholder tokens that the executor substitutes when resolving formulas downstream.  This lets you feed e.g. "the margin of the last attack roll" into an <code>act_damage.formula</code>.</p>
    <table class="pins">
      <thead><tr><th>Token</th><th>Set by</th><th>Meaning</th></tr></thead>
      <tbody>
        <tr><td><code>{__lastRoll}</code></td><td>any roll / attack / save / check action</td><td>Numeric total of the most recent roll in this exec chain.</td></tr>
        <tr><td><code>{__lastMargin}</code></td><td><code>act_attack_check</code>, <code>act_roll_check</code></td><td>Difference between the roll total and the target DC / AC.</td></tr>
        <tr><td><code>{__lastSuccesses}</code> / <code>{__lastBotches}</code></td><td><code>act_dice_pool</code>, <code>act_throw_on_*</code></td><td>Dice-pool counters.</td></tr>
        <tr><td><code>{__progPrev}</code></td><td><code>act_progression</code></td><td>Previous persisted value before the current roll.</td></tr>
        <tr><td><code>{__loopIndex}</code></td><td><code>act_for_loop</code>, <code>act_for_each_target</code></td><td>Current iteration index (0-based).</td></tr>
        <tr><td><code>{__castActorId}</code> / <code>{__castItemId}</code></td><td><code>cast_to_actor</code>, <code>cast_to_item</code></td><td>Cast-target document ids.</td></tr>
        <tr><td><code>{__macroArg:a}</code>…<code>{__macroArg:h}</code></td><td>inside a macro subgraph</td><td>Positional argument pins fed by <code>macro_call</code>.</td></tr>
        <tr><td><code>{__macroRetA}</code>, <code>{__macroRetB}</code></td><td><code>macro_output</code> / <code>macro_call</code></td><td>Values returned from a macro back to its caller.</td></tr>
        <tr><td><code>{__savedTargets}</code> / <code>{__failedTargets}</code> / <code>{__allTargets}</code></td><td><code>act_place_aoe_save_branch</code></td><td>Comma-joined token-id lists for the saved / failed / all buckets.</td></tr>
        <tr><td><code>{__currentTarget}</code></td><td>per-target iterators</td><td>Token id of the current iteration when a branch is fanning out per-target.</td></tr>
        <tr><td><code>{__var:name|default}</code></td><td>Variables panel</td><td>Reads <code>actor.flags.sd.vars.&lt;name&gt;</code> with a literal default fallback.</td></tr>
        <tr><td><code>{__sdEqCount:category}</code></td><td>Equip state</td><td>Count of equipped inventory items in the named category (or <code>any</code>).</td></tr>
        <tr><td><code>{__lastDice}</code></td><td>Roll → Value / Roll Check / Attack / Tiered / etc.</td><td>Comma-joined per-die results (active dice only) from the most recent roll node.</td></tr>
      </tbody>
    </table>
  </article>
</section>`;

// Styles

const styles = `
:root {
  --bg:       #f6f2eb;
  --bg-alt:   #ffffff;
  --fg:       #191813;
  --muted:    #4a4a42;
  --border:   #b5b3a4;
  --accent:   #5a4ec0;
  --code-bg:  #eee7d8;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: "Signika", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: var(--bg);
  color: var(--fg);
  line-height: 1.5;
}
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
code {
  background: var(--code-bg);
  padding: 1px 5px;
  border-radius: 3px;
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  font-size: 0.92em;
}
pre.graph {
  background: var(--bg-alt);
  border: 1px solid var(--border);
  border-left: 4px solid var(--accent);
  padding: 12px 16px;
  border-radius: 4px;
  overflow-x: auto;
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  font-size: 13px;
  line-height: 1.4;
}
h1, h2, h3, h4 { font-family: "Modesto Condensed", "Signika", sans-serif; letter-spacing: .02em; }
h1 { font-size: 2.2em; margin: 0 0 .3em; }
h2 { font-size: 1.6em; margin: 40px 0 20px; padding-bottom: 8px; }
h3 { font-size: 1.15em; margin: 0; }
h4 { font-size: 0.9em; text-transform: uppercase; color: var(--muted); margin: 12px 0 6px; letter-spacing: .05em; }

.layout { display: grid; grid-template-columns: 240px minmax(0,1fr); gap: 28px; max-width: 1200px; margin: 0 auto; padding: 20px; }
.toc {
  position: sticky;
  top: 20px;
  align-self: flex-start;
  max-height: calc(100vh - 40px);
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-alt);
  padding: 12px;
  font-size: 13px;
}
.toc ul { list-style: none; padding: 0; margin: 0 0 10px; }
.toc li a { display: flex; align-items: center; gap: 6px; padding: 3px 0; }
.toc li a small { color: var(--muted); margin-left: auto; }
.toc-sw { display: inline-block; width: 10px; height: 10px; border-radius: 2px; border: 1px solid rgba(0,0,0,.15); }

.intro { background: var(--bg-alt); border: 1px solid var(--border); border-radius: 4px; padding: 16px 20px; margin-bottom: 28px; }
.intro p { margin: 6px 0; }
.intro ul { margin: 8px 0; padding-left: 22px; }

.category { margin-bottom: 44px; }
.category-title { padding-bottom: 6px; }
.cat-count { font-size: 0.7em; color: var(--muted); font-weight: normal; margin-left: 8px; }

.node {
  background: var(--bg-alt);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 14px 16px;
  margin-bottom: 16px;
}
.node-header { margin-bottom: 8px; padding-left: 10px; }
.node-title-row { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.node-title { font-weight: 600; }
.node-id { color: var(--muted); font-size: 12px; }
.node-meta { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; align-items: center; }
.node-desc { margin: 10px 0 12px; color: #2a2925; }

.kind { font-size: 11px; padding: 1px 8px; border-radius: 10px; font-weight: 600; text-transform: uppercase; }
.kind-pure       { background: #d4efdb; color: #14572b; }
.kind-imperative { background: #f7e1c9; color: #7a3f00; }
.kind-event      { background: #f6d2d2; color: #7a1414; }

.flag { font-size: 11px; padding: 1px 6px; border-radius: 3px; background: #e5e2d8; color: var(--muted); }
.cat-tag { font-size: 11px; padding: 1px 8px; border-radius: 10px; color: #fff; }

.pin-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
@media (max-width: 720px) { .pin-grid { grid-template-columns: 1fr; } .layout { grid-template-columns: 1fr; } .toc { position: relative; max-height: none; } }

table.pins { width: 100%; border-collapse: collapse; font-size: 13px; }
table.pins th, table.pins td { border: 1px solid var(--border); padding: 4px 8px; text-align: left; vertical-align: top; }
table.pins th { background: var(--code-bg); font-weight: 600; }
.empty { color: var(--muted); font-style: italic; font-size: 13px; margin: 6px 0; }

.pin { display: inline-block; font-size: 11px; padding: 1px 6px; border-radius: 3px; font-weight: 600; }
.pin-exec  { background: #e6dcff; color: #3a1a7a; }
.pin-value { background: #d9edff; color: #0f3a7a; }

.example { background: var(--bg-alt); border: 1px solid var(--border); border-radius: 4px; padding: 16px 20px; margin-bottom: 18px; }
.example h3 { margin-bottom: 8px; }

.reference article { background: var(--bg-alt); border: 1px solid var(--border); border-radius: 4px; padding: 16px 20px; margin-bottom: 18px; }

footer { text-align: center; padding: 20px; color: var(--muted); font-size: 12px; }
`;

// Page

const visibleCount = Object.values(NODE_DEFS).filter(d => d && !d.hidden).length;
const hiddenCount  = Object.values(NODE_DEFS).filter(d => d && d.hidden).length;

const pkg = JSON.parse(readFileSync(resolve(repoRoot, "system.json"), "utf8"));

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>VTTPhoenix — Node Reference</title>
  <style>${styles}</style>
</head>
<body>
<div class="layout">
  ${renderToc()}
  <main>
    <header>
      <h1>VTTPhoenix — Node Reference</h1>
      <p>Generated from <code>module/builder/formula-graph.mjs</code>. System <strong>${esc(pkg.id ?? "vttphoenix")}</strong> v<strong>${esc(pkg.version ?? "dev")}</strong>.</p>
    </header>

    <section class="intro">
      <h2 style="border:none;margin-top:0;">About this document</h2>
      <p>This reference lists every node available in the visual graph editor. Nodes are grouped by palette category and sorted alphabetically within each group.</p>
      <p><strong>${visibleCount}</strong> visible node types${hiddenCount ? ` (+${hiddenCount} hidden / legacy)` : ""} across <strong>${orderedCats.length}</strong> categories.</p>
      <ul>
        <li>Each node has a unique <em>id</em> (used in serialised graphs) and a human-readable <em>title</em>.</li>
        <li><strong>Inputs</strong> / <strong>Outputs</strong> are pin slots exposed on the node. Pins are either <span class="pin pin-exec">exec</span> (flow) or <span class="pin pin-value">value</span> (data).</li>
        <li><strong>Fields</strong> are per-instance configuration edited inside the node body (not wired).</li>
        <li>Scroll to the <a href="#examples-top">Worked examples</a> section for end-to-end pipelines.</li>
        <li>Scroll to the <a href="#reference-top">Reference</a> section for runtime placeholder tokens that cross wire-value boundaries.</li>
      </ul>
    </section>

    ${orderedCats.map(renderCategory).join("\n")}

    ${examples}
    ${reference}

    <footer>Generated by <code>tools/gen-readme.mjs</code> — regenerate after editing <code>NODE_DEFS</code>.</footer>
  </main>
</div>
</body>
</html>
`;

const out = resolve(repoRoot, "readme.html");
writeFileSync(out, html);
console.log(`Wrote ${out} (${html.length} bytes, ${visibleCount} visible nodes across ${orderedCats.length} categories)`);
