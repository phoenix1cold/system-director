const MODULE_ID = "sd";
const AI_SETTINGS_KEY = "aiSettings";
const AI_BIO_FLAG = "aiBio";
const AI_PROFILE_FLAG = "aiProfile";
const AI_MEMORY_FLAG = "aiMemory";
const { ApplicationV2 } = foundry.applications.api;

function _esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function _normalizeAISettings(value) {
  const provider = value?.provider ?? {};
  const events = Array.isArray(value?.worldEvents)
    ? value.worldEvents.map((ev, i) => ({
        id: String(ev?.id || `event_${i + 1}`),
        title: String(ev?.title ?? ""),
        text: String(ev?.text ?? ""),
        enabled: ev?.enabled !== false,
        created: Number(ev?.created ?? Date.now()) || Date.now(),
        updated: Number(ev?.updated ?? ev?.created ?? Date.now()) || Date.now()
      })).filter(ev => ev.title.trim() || ev.text.trim())
    : [];
  return {
    worldKnowledge: String(value?.worldKnowledge ?? ""),
    worldEvents: events,
    provider: {
      url: String(provider.url ?? ""),
      apiKey: String(provider.apiKey ?? ""),
      apiKeySetting: String(provider.apiKeySetting ?? ""),
      model: String(provider.model ?? ""),
      temperature: provider.temperature === "" || provider.temperature == null ? "" : Number(provider.temperature),
      maxTokens: provider.maxTokens === "" || provider.maxTokens == null ? "" : Number(provider.maxTokens),
      systemPrompt: String(provider.systemPrompt ?? "")
    }
  };
}

function _newId(prefix = "id") {
  try { return `${prefix}_${foundry.utils.randomID(8)}`; }
  catch { return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }
}

function _isMeaningful(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function _normalizeAIProfile(value, legacyBio = "") {
  const src = (value && typeof value === "object") ? value : {};
  return {
    background:    String(src.background    ?? legacyBio ?? ""),
    appearance:    String(src.appearance    ?? ""),
    goals:         String(src.goals         ?? ""),
    relationships: String(src.relationships ?? ""),
    speechStyle:   String(src.speechStyle   ?? ""),
    dynamicBio:    String(src.dynamicBio    ?? "")
  };
}

function _normalizeAIMemory(value) {
  const memories = Array.isArray(value?.memories)
    ? value.memories.map((m, i) => ({
        id: String(m?.id || `mem_${i + 1}`),
        text: String(m?.text ?? m ?? ""),
        source: String(m?.source ?? ""),
        created: Number(m?.created ?? Date.now()) || Date.now()
      })).filter(m => m.text.trim())
    : [];
  const interactions = Array.isArray(value?.interactions)
    ? value.interactions.map((m, i) => ({
        id: String(m?.id || `int_${i + 1}`),
        speaker: String(m?.speaker ?? ""),
        ai: String(m?.ai ?? ""),
        user: String(m?.user ?? ""),
        text: String(m?.text ?? ""),
        created: Number(m?.created ?? Date.now()) || Date.now()
      })).filter(m => m.ai.trim() || m.user.trim() || m.text.trim())
    : [];
  return { memories, interactions };
}

export function getAISettings() {
  try {
    return _normalizeAISettings(game.settings.get(MODULE_ID, AI_SETTINGS_KEY) ?? {});
  } catch {
    return _normalizeAISettings({});
  }
}

export async function setAISettings(value) {
  const clean = _normalizeAISettings(value);
  await game.settings.set(MODULE_ID, AI_SETTINGS_KEY, clean);
  return clean;
}

export function getAIProviderConfig(overrides = {}) {
  const settings = getAISettings();
  const provider = settings.provider ?? {};
  const pick = (key, fallback = "") => _isMeaningful(overrides[key])
    ? overrides[key]
    : (_isMeaningful(provider[key]) ? provider[key] : fallback);
  return {
    url: pick("url", "https://api.openai.com/v1/chat/completions"),
    apiKey: pick("apiKey", ""),
    apiKeySetting: pick("apiKeySetting", ""),
    model: pick("model", "gpt-4o-mini"),
    temperature: pick("temperature", 0.7),
    maxTokens: pick("maxTokens", 700),
    systemPrompt: pick("systemPrompt", "")
  };
}

export async function requestAIChat({
  systemPrompt = "",
  prompt = "",
  provider = {},
  json = false
} = {}) {
  const cfg = getAIProviderConfig(provider);
  const url = String(cfg.url ?? "").trim();
  if (!url) throw new Error("AI provider URL is empty.");

  let apiKey = String(cfg.apiKey ?? "").trim();
  const settingKey = String(cfg.apiKeySetting ?? "").trim();
  if (!apiKey && settingKey) {
    try {
      const v = game.settings.get(MODULE_ID, settingKey);
      if (v) apiKey = String(v).trim();
    } catch { }
  }

  const messages = [];
  const sys = [cfg.systemPrompt, systemPrompt].map(v => String(v ?? "").trim()).filter(Boolean).join("\n\n");
  if (sys) messages.push({ role: "system", content: sys });
  messages.push({ role: "user", content: String(prompt ?? "") });

  const body = { model: String(cfg.model || "gpt-4o-mini"), messages };
  const temperature = Number(cfg.temperature);
  const maxTokens = Number(cfg.maxTokens);
  if (Number.isFinite(temperature)) body.temperature = temperature;
  if (Number.isFinite(maxTokens) && maxTokens > 0) body.max_tokens = Math.trunc(maxTokens);
  if (json) body.response_format = { type: "json_object" };

  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  if (!response.ok) {
    const txt = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status} ${response.statusText} - ${txt.slice(0, 400)}`);
  }
  const data = await response.json();
  let text =
      data?.choices?.[0]?.message?.content
    ?? data?.choices?.[0]?.text
    ?? data?.message?.content
    ?? "";
  if (typeof text !== "string") text = JSON.stringify(text);
  return text;
}

export function getActorAIProfile(actor) {
  if (!actor) return _normalizeAIProfile({});
  let legacy = "";
  try { legacy = String(actor.getFlag(MODULE_ID, AI_BIO_FLAG) ?? ""); } catch { }
  try {
    return _normalizeAIProfile(actor.getFlag(MODULE_ID, AI_PROFILE_FLAG) ?? {}, legacy);
  } catch {
    return _normalizeAIProfile({}, legacy);
  }
}

export async function setActorAIProfile(actor, value) {
  if (!actor) return _normalizeAIProfile({});
  const clean = _normalizeAIProfile(value);
  try {
    await actor.setFlag(MODULE_ID, AI_PROFILE_FLAG, clean);
  } catch (e) {
    console.warn("SD | Could not save actor AI Profile:", e);
    ui.notifications?.error?.("SD | Could not save AI Bio for this actor.");
  }
  return clean;
}

export function getActorAIBio(actor) {
  const p = getActorAIProfile(actor);
  return [
    p.background    ? `Background:\n${p.background}` : "",
    p.appearance    ? `Appearance:\n${p.appearance}` : "",
    p.goals         ? `Goals:\n${p.goals}` : "",
    p.relationships ? `Relationships:\n${p.relationships}` : "",
    p.speechStyle   ? `Speech Style:\n${p.speechStyle}` : "",
    p.dynamicBio    ? `Dynamic Bio:\n${p.dynamicBio}` : ""
  ].filter(Boolean).join("\n\n");
}

export async function setActorAIBio(actor, value) {
  if (!actor) return "";
  const text = String(value ?? "");
  try {
    const cur = getActorAIProfile(actor);
    await actor.setFlag(MODULE_ID, AI_PROFILE_FLAG, { ...cur, background: text });
    await actor.setFlag(MODULE_ID, AI_BIO_FLAG, text);
    return text;
  } catch (e) {
    console.warn("SD | Could not save actor AI Bio:", e);
    ui.notifications?.error?.("SD | Could not save AI Bio for this actor.");
    return getActorAIBio(actor);
  }
}

export function getActorAIMemory(actor) {
  if (!actor) return _normalizeAIMemory({});
  try { return _normalizeAIMemory(actor.getFlag(MODULE_ID, AI_MEMORY_FLAG) ?? {}); }
  catch { return _normalizeAIMemory({}); }
}

export async function setActorAIMemory(actor, value) {
  if (!actor) return _normalizeAIMemory({});
  const clean = _normalizeAIMemory(value);
  try {
    await actor.setFlag(MODULE_ID, AI_MEMORY_FLAG, clean);
  } catch (e) {
    console.warn("SD | Could not save actor AI Memory:", e);
    ui.notifications?.error?.("SD | Could not save AI Memory for this actor.");
  }
  return clean;
}

export async function addActorAIMemory(actor, text, source = "") {
  const cleanText = String(text ?? "").trim();
  if (!actor || !cleanText) return getActorAIMemory(actor);
  const mem = getActorAIMemory(actor);
  if (!mem.memories.some(m => m.text.trim().toLowerCase() === cleanText.toLowerCase())) {
    mem.memories.push({ id: _newId("mem"), text: cleanText, source: String(source ?? ""), created: Date.now() });
  }
  return setActorAIMemory(actor, mem);
}

export async function addActorAIInteraction(actor, entry = {}) {
  if (!actor) return getActorAIMemory(actor);
  const mem = getActorAIMemory(actor);
  mem.interactions.push({
    id: _newId("int"),
    speaker: String(entry.speaker ?? ""),
    ai: String(entry.ai ?? ""),
    user: String(entry.user ?? ""),
    text: String(entry.text ?? ""),
    created: Date.now()
  });
  if (mem.interactions.length > 80) mem.interactions = mem.interactions.slice(-80);
  return setActorAIMemory(actor, mem);
}

export async function updateActorDynamicBio(actor, provider = {}) {
  if (!actor) return null;
  const profile = getActorAIProfile(actor);
  const mem = getActorAIMemory(actor);
  const interactions = mem.interactions.map((it, i) => {
    const line = it.text || [it.ai ? `AI/NPC: ${it.ai}` : "", it.user ? `Player: ${it.user}` : ""].filter(Boolean).join("\n");
    return `${i + 1}. ${line}`;
  }).join("\n\n");

  if (!interactions.trim()) {
    ui.notifications?.warn?.("SD | No AI interactions recorded for this actor yet.");
    return profile;
  }

  const prompt = [
    "Update this character profile from the interaction log.",
    "Return JSON only with keys: background, appearance, goals, relationships, speechStyle, dynamicBio.",
    "Keep stable facts from the existing profile unless the interactions clearly change them.",
    "",
    "Existing profile:",
    JSON.stringify(profile, null, 2),
    "",
    "Interaction log:",
    interactions
  ].join("\n");

  const text = await requestAIChat({
    provider,
    json: true,
    systemPrompt: "You maintain RPG character profiles from dialogue history.",
    prompt
  });
  let parsed = {};
  try {
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    parsed = JSON.parse(first >= 0 && last > first ? text.slice(first, last + 1) : text);
  } catch (e) {
    parsed = { dynamicBio: text };
  }
  const next = _normalizeAIProfile({ ...profile, ...parsed });
  await setActorAIProfile(actor, next);
  ui.notifications?.info?.(`SD | Dynamic Bio updated for ${actor.name}.`);
  return next;
}

export function buildAIDialogueContext({ actor = null, item = null, speaker = "" } = {}) {
  const settings = getAISettings();
  const actorName = String(speaker || actor?.name || item?.actor?.name || item?.name || "this character").trim();
  const profile = getActorAIProfile(actor);
  const memory = getActorAIMemory(actor);
  const worldKnowledge = settings.worldKnowledge;
  const eventText = (settings.worldEvents ?? [])
    .filter(ev => ev.enabled !== false && (ev.title.trim() || ev.text.trim()))
    .map(ev => `${ev.title ? ev.title + ": " : ""}${ev.text}`.trim())
    .join("\n");
  const memoryText = memory.memories.map(m => `- ${m.text}`).join("\n");

  const parts = [];
  if (actorName) parts.push(`You are ${actorName}.`);
  if (profile.background.trim()) parts.push(`Background:\n${profile.background.trim()}`);
  if (profile.appearance.trim()) parts.push(`Appearance:\n${profile.appearance.trim()}`);
  if (profile.goals.trim()) parts.push(`Goals:\n${profile.goals.trim()}`);
  if (profile.relationships.trim()) parts.push(`Relationships:\n${profile.relationships.trim()}`);
  if (profile.speechStyle.trim()) parts.push(`Speech Style:\n${profile.speechStyle.trim()}`);
  if (profile.dynamicBio.trim()) parts.push(`Dynamic Bio:\n${profile.dynamicBio.trim()}`);
  if (memoryText.trim()) parts.push(`Character Memories:\n${memoryText}`);
  if (worldKnowledge.trim()) parts.push(`World Knowledge:\n${worldKnowledge.trim()}`);
  if (eventText.trim()) parts.push(`World Events:\n${eventText}`);
  if (parts.length) {
    parts.push("Stay in character and use Bio, Memories, Relationships, World Knowledge and World Events as persistent context for every dialogue answer.");
  }
  return parts.join("\n\n");
}

class SDAITextEditor extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "sd-ai-text-editor",
    classes: ["sd", "sd-ai-text-editor"],
    window: {
      title: "AI",
      icon: "fa-solid fa-brain",
      resizable: true,
      minimizable: true
    },
    position: { width: 620, height: 560 }
  };

  constructor({
    id = "sd-ai-text-editor",
    title = "AI",
    label = "Text",
    value = "",
    placeholder = "",
    hint = "",
    saveLabel = "Save",
    onSave = null
  } = {}) {
    super({ id });
    this._title = title;
    this._label = label;
    this._value = String(value ?? "");
    this._placeholder = placeholder;
    this._hint = hint;
    this._saveLabel = saveLabel;
    this._onSave = onSave;
  }

  get title() {
    return this._title;
  }

  async _renderHTML(context, options) {
    return `
      <form class="sd-ai-editor-form" autocomplete="off"
            style="height:100%;min-height:0;display:flex;flex-direction:column;gap:10px;padding:2px 0;box-sizing:border-box;overflow:hidden;">
        <label style="font-size:12px;font-weight:800;color:var(--sd-text-2,var(--color-text-primary));flex:0 0 auto;">
          ${_esc(this._label)}
        </label>
        <textarea name="text"
                  placeholder="${_esc(this._placeholder)}"
                  style="width:100%;flex:1 1 auto;min-height:160px;box-sizing:border-box;resize:none;background:var(--sd-bg,var(--color-bg-option));border:1px solid var(--sd-border,var(--color-border-light-primary));border-radius:6px;color:var(--sd-text,var(--color-text-primary));padding:10px 12px;font-family:inherit;font-size:12px;line-height:1.45;overflow:auto;">${_esc(this._value)}</textarea>
        <p style="margin:0;font-size:11px;line-height:1.35;color:var(--sd-text-3,var(--color-text-secondary));flex:0 0 auto;">
          ${_esc(this._hint)}
        </p>
        <footer style="display:flex;gap:8px;justify-content:flex-end;flex:0 0 auto;padding-top:4px;">
          <button type="button" data-action="cancel"
                  style="min-width:110px;background:var(--sd-bg-2,var(--color-bg-option));border:1px solid var(--sd-border,var(--color-border-light-primary));border-radius:6px;color:var(--sd-text,var(--color-text-primary));padding:8px 12px;cursor:pointer;">
            <i class="fas fa-xmark"></i> Cancel
          </button>
          <button type="submit"
                  style="min-width:150px;background:var(--sd-accent,var(--color-border-highlight));border:1px solid var(--sd-accent,var(--color-border-highlight));border-radius:6px;color:var(--sd-accent-contrast,#fff);padding:8px 12px;font-weight:700;cursor:pointer;">
            <i class="fas fa-floppy-disk"></i> ${_esc(this._saveLabel)}
          </button>
        </footer>
      </form>`;
  }

  _replaceHTML(html, content, options) {
    content.innerHTML = html;
    content.style.minHeight = "0";
    content.style.overflow = "hidden";
    content.style.display = "flex";
    content.style.flexDirection = "column";

    const form = content.querySelector(".sd-ai-editor-form");
    form?.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const text = String(form.querySelector("[name='text']")?.value ?? "");
      try {
        await this._onSave?.(text);
      } finally {
        this.close();
      }
    });
    form?.querySelector("[data-action='cancel']")?.addEventListener("click", () => this.close());
  }
}

class SDAISettingsEditor extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "sd-ai-settings-editor",
    classes: ["sd", "sd-ai-settings-editor"],
    window: { title: "AI Settings", icon: "fa-solid fa-brain", resizable: true, minimizable: true },
    position: { width: 760, height: 720 }
  };

  constructor({ onSave = null } = {}) {
    super();
    this._onSave = onSave;
  }

  _eventRow(ev = {}) {
    const id = _esc(ev.id || _newId("event"));
    return `<div class="sd-ai-event-row" data-event-id="${id}" style="display:grid;grid-template-columns:24px minmax(120px,220px) 1fr 28px;gap:6px;align-items:start;margin-bottom:6px;">
      <input type="checkbox" name="eventEnabled" ${ev.enabled === false ? "" : "checked"} title="Enabled" style="margin-top:7px">
      <input type="text" name="eventTitle" value="${_esc(ev.title ?? "")}" placeholder="Event title" style="background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:5px;color:var(--sd-text);padding:6px 8px;">
      <textarea name="eventText" rows="2" placeholder="What happened?" style="background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:5px;color:var(--sd-text);padding:6px 8px;resize:vertical;min-height:34px;">${_esc(ev.text ?? "")}</textarea>
      <button type="button" data-action="delete-event" title="Delete event" style="height:30px;background:transparent;border:1px solid var(--sd-border);border-radius:5px;color:#d66;cursor:pointer;"><i class="fas fa-trash"></i></button>
    </div>`;
  }

  async _renderHTML(context, options) {
    const s = getAISettings();
    const p = s.provider ?? {};
    const rows = (s.worldEvents ?? []).map(ev => this._eventRow(ev)).join("");
    return `<form class="sd-ai-settings-form" autocomplete="off" style="height:100%;min-height:0;display:flex;flex-direction:column;gap:10px;overflow:hidden;">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;flex:0 0 auto;">
        <label style="display:flex;flex-direction:column;gap:3px;font-size:11px;color:var(--sd-text-2);font-weight:700;">Provider URL
          <input name="url" value="${_esc(p.url)}" placeholder="Use fallback OpenAI-compatible URL" style="background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:5px;color:var(--sd-text);padding:6px 8px;">
        </label>
        <label style="display:flex;flex-direction:column;gap:3px;font-size:11px;color:var(--sd-text-2);font-weight:700;">Model
          <input name="model" value="${_esc(p.model)}" placeholder="gpt-4o-mini / deepseek-chat / local model" style="background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:5px;color:var(--sd-text);padding:6px 8px;">
        </label>
        <label style="display:flex;flex-direction:column;gap:3px;font-size:11px;color:var(--sd-text-2);font-weight:700;">API Key
          <input name="apiKey" value="${_esc(p.apiKey)}" placeholder="Optional direct key" style="background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:5px;color:var(--sd-text);padding:6px 8px;">
        </label>
        <label style="display:flex;flex-direction:column;gap:3px;font-size:11px;color:var(--sd-text-2);font-weight:700;">API key setting
          <input name="apiKeySetting" value="${_esc(p.apiKeySetting)}" placeholder="e.g. openaiKey" style="background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:5px;color:var(--sd-text);padding:6px 8px;">
        </label>
        <label style="display:flex;flex-direction:column;gap:3px;font-size:11px;color:var(--sd-text-2);font-weight:700;">Temperature
          <input type="number" step="0.05" name="temperature" value="${_esc(p.temperature)}" placeholder="0.7" style="background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:5px;color:var(--sd-text);padding:6px 8px;">
        </label>
        <label style="display:flex;flex-direction:column;gap:3px;font-size:11px;color:var(--sd-text-2);font-weight:700;">Max Tokens
          <input type="number" step="1" name="maxTokens" value="${_esc(p.maxTokens)}" placeholder="700" style="background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:5px;color:var(--sd-text);padding:6px 8px;">
        </label>
      </div>
      <label style="display:flex;flex-direction:column;gap:4px;flex:0 0 auto;font-size:11px;color:var(--sd-text-2);font-weight:700;">Default System Prompt
        <textarea name="systemPrompt" rows="2" placeholder="Optional provider-wide system prompt" style="background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:5px;color:var(--sd-text);padding:7px 9px;resize:vertical;">${_esc(p.systemPrompt)}</textarea>
      </label>
      <label style="display:flex;flex-direction:column;gap:4px;flex:1 1 190px;min-height:140px;font-size:11px;color:var(--sd-text-2);font-weight:700;">World Knowledge
        <textarea name="worldKnowledge" placeholder="Setting, factions, places, lore, tone and facts every AI dialogue should know." style="flex:1;min-height:120px;background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:5px;color:var(--sd-text);padding:8px 10px;resize:none;line-height:1.4;">${_esc(s.worldKnowledge)}</textarea>
      </label>
      <div style="flex:1 1 180px;min-height:150px;display:flex;flex-direction:column;gap:6px;overflow:hidden;">
        <div style="display:flex;align-items:center;gap:8px;flex:0 0 auto;">
          <strong style="font-size:12px;color:var(--sd-text-2);text-transform:uppercase;">World Events</strong>
          <button type="button" data-action="add-event" style="margin-left:auto;background:var(--sd-bg-2);border:1px solid var(--sd-border);border-radius:5px;color:var(--sd-text);padding:4px 8px;cursor:pointer;"><i class="fas fa-plus"></i> Add Event</button>
        </div>
        <div class="sd-ai-events" style="overflow:auto;min-height:0;padding-right:2px;">${rows || `<div style="font-size:11px;color:var(--sd-text-3);font-style:italic;padding:8px;">No world events yet.</div>`}</div>
      </div>
      <footer style="display:flex;justify-content:flex-end;gap:8px;flex:0 0 auto;padding-top:4px;">
        <button type="button" data-action="cancel" style="min-width:110px;background:var(--sd-bg-2);border:1px solid var(--sd-border);border-radius:6px;color:var(--sd-text);padding:8px 12px;cursor:pointer;"><i class="fas fa-xmark"></i> Cancel</button>
        <button type="submit" style="min-width:150px;background:var(--sd-accent);border:1px solid var(--sd-accent);border-radius:6px;color:var(--sd-accent-contrast,#fff);padding:8px 12px;font-weight:700;cursor:pointer;"><i class="fas fa-floppy-disk"></i> Save</button>
      </footer>
    </form>`;
  }

  _replaceHTML(html, content, options) {
    content.innerHTML = html;
    content.style.minHeight = "0";
    content.style.overflow = "hidden";
    const form = content.querySelector(".sd-ai-settings-form");
    const eventsEl = form?.querySelector(".sd-ai-events");
    form?.querySelector("[data-action='add-event']")?.addEventListener("click", () => {
      if (!eventsEl) return;
      if (!eventsEl.querySelector(".sd-ai-event-row")) eventsEl.innerHTML = "";
      eventsEl.insertAdjacentHTML("beforeend", this._eventRow({ id: _newId("event"), enabled: true }));
    });
    form?.addEventListener("click", ev => {
      const btn = ev.target?.closest?.("[data-action='delete-event']");
      if (btn) btn.closest(".sd-ai-event-row")?.remove();
    });
    form?.querySelector("[data-action='cancel']")?.addEventListener("click", () => this.close());
    form?.addEventListener("submit", async ev => {
      ev.preventDefault();
      const events = [...form.querySelectorAll(".sd-ai-event-row")].map(row => ({
        id: row.dataset.eventId || _newId("event"),
        enabled: !!row.querySelector("[name='eventEnabled']")?.checked,
        title: String(row.querySelector("[name='eventTitle']")?.value ?? ""),
        text: String(row.querySelector("[name='eventText']")?.value ?? ""),
        updated: Date.now()
      })).filter(ev => ev.title.trim() || ev.text.trim());
      const saved = await setAISettings({
        provider: {
          url: form.querySelector("[name='url']")?.value ?? "",
          apiKey: form.querySelector("[name='apiKey']")?.value ?? "",
          apiKeySetting: form.querySelector("[name='apiKeySetting']")?.value ?? "",
          model: form.querySelector("[name='model']")?.value ?? "",
          temperature: form.querySelector("[name='temperature']")?.value ?? "",
          maxTokens: form.querySelector("[name='maxTokens']")?.value ?? "",
          systemPrompt: form.querySelector("[name='systemPrompt']")?.value ?? ""
        },
        worldKnowledge: form.querySelector("[name='worldKnowledge']")?.value ?? "",
        worldEvents: events
      });
      ui.notifications?.info?.("SD | AI Settings saved.");
      if (typeof this._onSave === "function") await this._onSave(saved);
      this.close();
    });
  }
}

class SDAIBioEditor extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "sd-ai-bio-editor",
    classes: ["sd", "sd-ai-bio-editor"],
    window: { title: "AI Bio", icon: "fa-solid fa-brain", resizable: true, minimizable: true },
    position: { width: 760, height: 720 }
  };

  constructor(actor) {
    super({ id: `sd-ai-bio-editor-${actor?.id ?? "actor"}` });
    this.actor = actor;
  }

  get title() { return `AI Bio - ${this.actor?.name ?? "Actor"}`; }

  _field(name, label, value, rows = 4, placeholder = "") {
    return `<label style="display:flex;flex-direction:column;gap:4px;min-height:0;font-size:11px;color:var(--sd-text-2);font-weight:800;text-transform:uppercase;">${_esc(label)}
      <textarea name="${_esc(name)}" rows="${rows}" placeholder="${_esc(placeholder)}" style="width:100%;box-sizing:border-box;background:var(--sd-bg);border:1px solid var(--sd-border);border-radius:6px;color:var(--sd-text);padding:8px 10px;resize:vertical;min-height:72px;line-height:1.4;">${_esc(value)}</textarea>
    </label>`;
  }

  async _renderHTML(context, options) {
    const p = getActorAIProfile(this.actor);
    const mem = getActorAIMemory(this.actor);
    return `<form class="sd-ai-bio-form" autocomplete="off" style="height:100%;min-height:0;display:flex;flex-direction:column;gap:10px;overflow:hidden;">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;overflow:auto;min-height:0;flex:1 1 auto;padding-right:2px;">
        ${this._field("background", "Background", p.background, 5, "Origin, history, role, important past facts.")}
        ${this._field("appearance", "Appearance", p.appearance, 5, "Visible look, clothing, marks, posture, presence.")}
        ${this._field("goals", "Goals", p.goals, 4, "Current plans, wants, fears, priorities.")}
        ${this._field("relationships", "Relationships", p.relationships, 4, "Named people and attitudes toward them.")}
        ${this._field("speechStyle", "Speech Style", p.speechStyle, 4, "Tone, vocabulary, accent, habits, taboos.")}
        ${this._field("dynamicBio", "Dynamic Bio", p.dynamicBio, 4, "AI-maintained changes from interactions.")}
      </div>
      <div style="font-size:11px;color:var(--sd-text-3);line-height:1.35;flex:0 0 auto;">
        Memories: ${mem.memories.length}. Interactions recorded for Dynamic Bio: ${mem.interactions.length}.
      </div>
      <footer style="display:flex;gap:8px;justify-content:flex-end;flex:0 0 auto;padding-top:4px;">
        <button type="button" data-action="update-dynamic" style="min-width:170px;background:var(--sd-bg-2);border:1px solid var(--sd-border);border-radius:6px;color:var(--sd-text);padding:8px 12px;cursor:pointer;"><i class="fas fa-wand-magic-sparkles"></i> Update Dynamic Bio</button>
        <button type="button" data-action="cancel" style="min-width:110px;background:var(--sd-bg-2);border:1px solid var(--sd-border);border-radius:6px;color:var(--sd-text);padding:8px 12px;cursor:pointer;"><i class="fas fa-xmark"></i> Cancel</button>
        <button type="submit" style="min-width:150px;background:var(--sd-accent);border:1px solid var(--sd-accent);border-radius:6px;color:var(--sd-accent-contrast,#fff);padding:8px 12px;font-weight:700;cursor:pointer;"><i class="fas fa-floppy-disk"></i> Save</button>
      </footer>
    </form>`;
  }

  _readProfile(form) {
    return {
      background: form.background?.value ?? "",
      appearance: form.appearance?.value ?? "",
      goals: form.goals?.value ?? "",
      relationships: form.relationships?.value ?? "",
      speechStyle: form.speechStyle?.value ?? "",
      dynamicBio: form.dynamicBio?.value ?? ""
    };
  }

  _replaceHTML(html, content, options) {
    content.innerHTML = html;
    content.style.minHeight = "0";
    content.style.overflow = "hidden";
    const form = content.querySelector(".sd-ai-bio-form");
    form?.querySelector("[data-action='cancel']")?.addEventListener("click", () => this.close());
    form?.querySelector("[data-action='update-dynamic']")?.addEventListener("click", async () => {
      await setActorAIProfile(this.actor, this._readProfile(form));
      await updateActorDynamicBio(this.actor);
      this.render();
    });
    form?.addEventListener("submit", async ev => {
      ev.preventDefault();
      await setActorAIProfile(this.actor, this._readProfile(form));
      ui.notifications?.info?.(`SD | AI Bio saved for ${this.actor.name}.`);
      this.close();
    });
  }
}

export async function openAISettingsDialog({ onSave = null } = {}) {
  const app = new SDAISettingsEditor({ onSave });
  app.render(true);
  return app;
}

export async function openActorAIBioDialog(actor) {
  if (!actor) return null;
  const app = new SDAIBioEditor(actor);
  app.render(true);
  return app;
}
