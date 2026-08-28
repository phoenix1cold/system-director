import { openFoundryWindow } from "./foundry-window-host.mjs";
import { localizeTree } from "./localization.mjs";

const CHOICE_TYPES = new Set(["button", "choice"]);

function _text(value) {
  return String(value ?? "");
}

function _resolve(value, ctx, state = null) {
  let s = _text(value);
  if (state && s.includes("{")) {
    s = s.replace(/\{([A-Za-z_][\w]*)\}/g, (m, id) => {
      const v = state[id];
      if (v === undefined || v === null) return m;
      if (typeof v === "boolean") return v ? "yes" : "no";
      return String(v);
    });
  }
  try {
    if (typeof ctx?.resolveText === "function") s = _text(ctx.resolveText(s));
  } catch { }
  return s;
}

function _boolFrom(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const s = _text(value).trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(s);
}

function _isChoice(el) {
  return CHOICE_TYPES.has(_text(el?.type));
}

function _normaliseElements(action) {
  if (Array.isArray(action?.elements)) return action.elements.filter(Boolean);
  if (typeof action?.elementsJson !== "string" || action.elementsJson.trim() === "") return [];
  try {
    const parsed = JSON.parse(action.elementsJson);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch (err) {
    ui.notifications?.warn?.("SD | Dialog Builder: bad legacy elementsJson.");
    console.warn("SD | Dialog Builder: bad legacy elementsJson.", err);
    return [];
  }
}

function _elementPin(el, seq) {
  if (Number.isInteger(el?.execIndex)) return `el${el.execIndex}_exec`;
  return `btn${seq}`;
}

function _initialState(elements, ctx) {
  const state = {};
  for (const el of elements) {
    if (!el || typeof el !== "object" || el.id == null) continue;
    if (_isChoice(el) || el.type === "label" || el.type === "section") continue;
    let value = el.default;
    if (value === undefined) value = el.type === "checkbox" ? false : "";
    if (el.type === "checkbox") value = _boolFrom(value);
    else if (el.type === "number") {
      const n = Number(_resolve(value, ctx));
      value = Number.isFinite(n) ? n : 0;
    } else {
      value = _resolve(value, ctx);
    }
    state[String(el.id)] = value;
  }
  return state;
}

function _evalCondition(expr, state, ctx) {
  if (!expr) return true;
  let s = _resolve(expr, ctx, state);
  s = s.replace(/\{([A-Za-z_][\w]*)\}/g, (_, id) => {
    const v = state[id];
    if (v === undefined) return "undefined";
    if (typeof v === "boolean") return v ? "true" : "false";
    if (typeof v === "number") return String(v);
    return JSON.stringify(String(v));
  });
  try { return !!(new Function(`"use strict";return (${s});`))(); }
  catch { return false; }
}

function _optionsFor(el, ctx) {
  let opts = Array.isArray(el?.options) ? [...el.options] : [];
  const actor = ctx?.actor;
  if (el?.optionsFrom && actor) {
    try {
      const path = String(el.optionsFrom).replace(/^actor\./, "");
      const raw = foundry.utils.getProperty(actor, path);
      let dyn = [];
      if (Array.isArray(raw)) {
        dyn = raw.map(v => (v && typeof v === "object")
          ? { value: String(v.value ?? v.id ?? v.key ?? ""), label: String(v.label ?? v.name ?? v.value ?? "") }
          : String(v));
      } else if (raw && typeof raw === "object") {
        dyn = Object.entries(raw).map(([k, v]) => ({
          value: k,
          label: (v && typeof v === "object") ? String(v.label ?? v.name ?? k) : String(v ?? k)
        }));
      } else if (typeof raw === "string") {
        dyn = raw.split(/[\n,]/).map(s => s.trim()).filter(Boolean);
      }
      opts = [...opts, ...dyn];
    } catch (err) {
      console.warn("SD | Dialog Builder optionsFrom failed:", err);
    }
  }
  return opts;
}

function _setTheme(el) {
  const theme = document.documentElement?.getAttribute("data-sd-theme")
    || document.body?.getAttribute?.("data-sd-theme")
    || "";
  if (theme) el.setAttribute("data-sd-theme", theme);
}

function _iconElement(icon) {
  const i = document.createElement("i");
  i.className = icon ? String(icon) : "fas fa-comment-dots";
  return i;
}

const VALID_MODES = new Set(["rpg-fullscreen", "rpg", "foundry", "form"]);
function _normaliseMode(raw) {
  let m = _text(raw ?? "rpg-fullscreen").toLowerCase().trim();
  // Legacy migration — "rpg" (older graphs) → new fullscreen default.
  if (m === "rpg") m = "rpg-fullscreen";
  if (!VALID_MODES.has(m)) m = "rpg-fullscreen";
  return m;
}

export class SDDialogueBuilder {
  static async show(action = {}, ctx = {}) {
    action = localizeTree(action);
    const elements = _normaliseElements(action);
    const state = _initialState(elements, ctx);
    const mode = _normaliseMode(action.mode ?? action.presentation);
    const isFullscreen = mode === "rpg-fullscreen";
    const isFoundry    = mode === "foundry";
    const actor = ctx.actor;
    const item = ctx.item;

    return new Promise((resolve) => {
      let done = false;
      let choiceSeq = 0;
      let windowApp = null;

      const finish = (payload, { fromHost=false }={}) => {
        if (done) return;
        done = true;
        syncState();
        document.removeEventListener("keydown", onKeyDown, true);
        overlay.remove();
        if (!fromHost) windowApp?.close?.({ sdSkipCallback:true });
        if (payload && typeof payload === "object") payload.state = { ...state };
        resolve(payload);
      };

      const overlay = document.createElement("div");
      overlay.className = `sd-dialogue-overlay sd-dialogue-mode-${mode}`;
      if (isFullscreen) {
        // Native fullscreen overlay: mounted directly to <body>, no ApplicationV2 chrome.
        overlay.style.cssText = "position:fixed;inset:0;z-index:100000;display:flex;align-items:flex-end;justify-content:center;padding:22px clamp(12px,4vw,56px) clamp(18px,6vh,58px);background:rgba(0,0,0,.55);backdrop-filter:blur(3px);box-sizing:border-box";
      } else {
        // Hosted inside SDFoundryWindowHost (a real Foundry window).
        overlay.style.cssText = "position:relative;inset:auto;width:100%;height:100%;min-width:0;min-height:0;display:flex;overflow:hidden;background:transparent";
      }
      _setTheme(overlay);

      const win = document.createElement("section");
      win.className = "sd-dialogue-window";
      win.setAttribute("role", "dialog");
      win.setAttribute("aria-modal", "true");
      overlay.appendChild(win);

      const portraitWrap = document.createElement("aside");
      portraitWrap.className = "sd-dialogue-portrait";
      const portrait = _resolve(action.portrait ?? action.avatar ?? actor?.img ?? item?.img ?? "", ctx, state);
      if (portrait) {
        const img = document.createElement("img");
        img.src = portrait;
        img.alt = "";
        portraitWrap.appendChild(img);
      } else {
        portraitWrap.appendChild(_iconElement("fas fa-user-circle"));
      }
      win.appendChild(portraitWrap);

      const main = document.createElement("div");
      main.className = "sd-dialogue-main";
      win.appendChild(main);

      const top = document.createElement("header");
      top.className = "sd-dialogue-top";
      const heading = document.createElement("div");
      heading.className = "sd-dialogue-heading";
      const title = document.createElement("div");
      title.className = "sd-dialogue-title";
      title.textContent = _resolve(action.title ?? "Dialogue", ctx, state);
      const speaker = document.createElement("div");
      speaker.className = "sd-dialogue-speaker";
      speaker.textContent = _resolve(action.speaker ?? actor?.name ?? item?.name ?? "", ctx, state);
      heading.appendChild(title);
      if (speaker.textContent) heading.appendChild(speaker);
      const close = document.createElement("button");
      close.type = "button";
      close.className = "sd-dialogue-close";
      close.title = _resolve(action.cancelLabel ?? "Cancel", ctx, state);
      close.innerHTML = '<i class="fas fa-times"></i>';
      close.addEventListener("click", () => finish({ cancelled: true }));
      top.appendChild(heading);
      top.appendChild(close);
      main.appendChild(top);

      const body = document.createElement("div");
      body.className = "sd-dialogue-body";
      main.appendChild(body);

      const controls = document.createElement("div");
      controls.className = "sd-dialogue-controls";
      main.appendChild(controls);

      const choices = document.createElement("div");
      choices.className = "sd-dialogue-choices";
      main.appendChild(choices);

      const footer = document.createElement("footer");
      footer.className = "sd-dialogue-footer";
      main.appendChild(footer);

      const visibleChoices = [];

      const syncInput = (input) => {
        const id = input?.getAttribute?.("data-sd-dialogue-id");
        if (!id) return null;
        if (input.type === "checkbox") state[id] = !!input.checked;
        else if (input.type === "number") {
          const n = Number(input.value);
          state[id] = Number.isFinite(n) ? n : 0;
        } else {
          state[id] = input.value;
        }
        return id;
      };

      const syncState = () => {
        overlay.querySelectorAll("[data-sd-dialogue-id]").forEach(syncInput);
      };

      const needsRefreshFor = (id) => {
        if (!id) return false;
        const re = new RegExp(`\\{${id}\\}`);
        if (re.test(_text(action.body ?? action.text ?? action.description ?? ""))) return true;
        return elements.some(e => e && (
          re.test(_text(e.visibleWhen)) ||
          re.test(_text(e.disabledWhen)) ||
          re.test(_text(e.label)) ||
          re.test(_text(e.text)) ||
          re.test(_text(e.hint)) ||
          re.test(_text(e.description))
        ));
      };

      const maybeRefresh = (ev) => {
        const id = syncInput(ev?.currentTarget ?? ev?.target);
        if (needsRefreshFor(id)) renderDynamic();
      };

      const makeField = (el) => {
        const id = String(el.id ?? "");
        const row = document.createElement("label");
        row.className = `sd-dialogue-field sd-dialogue-field-${el.type}`;
        const label = document.createElement("span");
        label.textContent = _resolve(el.label ?? id, ctx, state);
        row.appendChild(label);

        const disabled = el.disabledWhen ? _evalCondition(el.disabledWhen, state, ctx) : false;
        let input;
        if (el.type === "checkbox") {
          input = document.createElement("input");
          input.type = "checkbox";
          input.checked = !!state[id];
        } else if (el.type === "select") {
          input = document.createElement("select");
          for (const opt of _optionsFor(el, ctx)) {
            const option = document.createElement("option");
            const value = (opt && typeof opt === "object") ? String(opt.value ?? "") : String(opt);
            const optLabel = (opt && typeof opt === "object") ? String(opt.label ?? opt.value ?? "") : String(opt);
            option.value = value;
            option.textContent = _resolve(optLabel, ctx, state);
            if (String(state[id] ?? "") === value) option.selected = true;
            input.appendChild(option);
          }
        } else {
          input = document.createElement("input");
          input.type = el.type === "number" ? "number" : "text";
          input.value = state[id] ?? "";
          input.placeholder = _resolve(el.placeholder ?? "", ctx, state);
        }
        input.disabled = !!disabled;
        input.setAttribute("data-sd-dialogue-id", id);
        input.addEventListener("input", maybeRefresh);
        input.addEventListener("change", maybeRefresh);
        row.appendChild(input);
        return row;
      };

      const makeChoice = (el, seq) => {
        const pinId = _elementPin(el, seq);
        const pickedId = String(el.id ?? pinId);
        const disabled = el.disabledWhen ? _evalCondition(el.disabledWhen, state, ctx) : false;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "sd-dialogue-choice";
        btn.disabled = !!disabled;
        btn.dataset.pinId = pinId;
        const number = document.createElement("span");
        number.className = "sd-dialogue-choice-number";
        number.textContent = String(seq + 1);
        const label = document.createElement("span");
        label.className = "sd-dialogue-choice-label";
        label.textContent = _resolve(el.label ?? pickedId, ctx, state) || pickedId;
        btn.appendChild(number);
        btn.appendChild(_iconElement(el.icon ?? "fas fa-chevron-right"));
        btn.appendChild(label);
        const hintText = _resolve(el.hint ?? el.description ?? "", ctx, state);
        if (hintText) {
          const hint = document.createElement("span");
          hint.className = "sd-dialogue-choice-hint";
          hint.textContent = hintText;
          btn.appendChild(hint);
        }
        btn.addEventListener("click", () => {
          finish({
            pinId,
            pickedId,
            pickedLabel: label.textContent,
            emitFlag: el.emit === false ? "no" : "yes"
          });
        });
        return btn;
      };

      const renderDynamic = () => {
        body.replaceChildren();
        controls.replaceChildren();
        choices.replaceChildren();
        footer.replaceChildren();
        visibleChoices.length = 0;
        choiceSeq = 0;

        const desc = _resolve(action.body ?? action.text ?? action.description ?? "", ctx, state);
        if (desc) {
          const text = document.createElement("div");
          text.className = "sd-dialogue-text";
          text.textContent = desc;
          body.appendChild(text);
        }

        for (const el of elements) {
          if (!el || typeof el !== "object") continue;
          if (!_evalCondition(el.visibleWhen, state, ctx)) continue;
          if (_isChoice(el)) {
            const btn = makeChoice(el, choiceSeq);
            choices.appendChild(btn);
            visibleChoices.push(btn);
            choiceSeq += 1;
            continue;
          }
          if (el.type === "label" || el.type === "section") {
            const line = document.createElement(el.type === "section" ? "div" : "p");
            line.className = el.type === "section" ? "sd-dialogue-section" : "sd-dialogue-note";
            line.textContent = _resolve(el.text ?? el.label ?? "", ctx, state);
            body.appendChild(line);
            continue;
          }
          if (el.id != null) controls.appendChild(makeField(el));
        }

        if (!visibleChoices.length) {
          const ok = document.createElement("button");
          ok.type = "button";
          ok.className = "sd-dialogue-submit";
          ok.innerHTML = '<i class="fas fa-check"></i>';
          ok.append(` ${_resolve(action.okLabel ?? "OK", ctx, state)}`);
          ok.addEventListener("click", () => finish({
            pinId: "submit",
            pickedId: "",
            pickedLabel: _resolve(action.okLabel ?? "OK", ctx, state),
            emitFlag: "yes"
          }));
          footer.appendChild(ok);
        }

        const cancel = document.createElement("button");
        cancel.type = "button";
        cancel.className = "sd-dialogue-cancel";
        cancel.innerHTML = '<i class="fas fa-times"></i>';
        cancel.append(` ${_resolve(action.cancelLabel ?? "Cancel", ctx, state)}`);
        cancel.addEventListener("click", () => finish({ cancelled: true }));
        footer.appendChild(cancel);
      };

      const onKeyDown = (ev) => {
        if (done) return;
        if (ev.key === "Escape") {
          ev.preventDefault();
          finish({ cancelled: true });
          return;
        }
        if (/^[1-9]$/.test(ev.key)) {
          const idx = Number(ev.key) - 1;
          const btn = visibleChoices[idx];
          if (btn && !btn.disabled) {
            ev.preventDefault();
            btn.click();
          }
          return;
        }
        if (ev.key === "Enter" && !["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName ?? "")) {
          if (visibleChoices.length === 1 && !visibleChoices[0].disabled) {
            ev.preventDefault();
            visibleChoices[0].click();
          } else if (!visibleChoices.length) {
            ev.preventDefault();
            footer.querySelector(".sd-dialogue-submit")?.click();
          }
        }
      };

      renderDynamic();

      if (isFullscreen) {
        // Mount overlay directly on the body — no Foundry window frame at all.
        document.body.appendChild(overlay);
        windowApp = null;
      } else {
        const width = mode === "form" ? 760 : 920;
        const height = mode === "form" ? 560 : 680;
        // Classes drive theming: sd-dialogue-foundry-form (compact form),
        // sd-dialogue-foundry-native (plain Foundry-style, no portrait panel).
        const modeClass = isFoundry
          ? "sd-dialogue-foundry-native"
          : `sd-dialogue-foundry-${mode === "form" ? "form" : "rpg"}`;
        windowApp = openFoundryWindow({
          id:`sd-dialogue-${foundry.utils.randomID(8)}`,
          title:_resolve(action.title ?? "Dialogue", ctx, state),
          icon:"fa-solid fa-comment-dots",
          width:Math.min(width, Math.floor(window.innerWidth * 0.92)),
          height:Math.min(height, Math.floor(window.innerHeight * 0.88)),
          minWidth:420,
          minHeight:300,
          classes:["sd-dialogue-foundry-window", modeClass],
          content:overlay,
          onClose:()=>finish({ cancelled:true }, { fromHost:true })
        });
      }
      document.addEventListener("keydown", onKeyDown, true);
      setTimeout(() => {
        const first = choices.querySelector("button:not(:disabled)")
          ?? controls.querySelector("input, select, button")
          ?? footer.querySelector("button");
        first?.focus?.();
      }, 0);
    });
  }
}
