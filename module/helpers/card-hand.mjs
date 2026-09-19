import { emitSheetWidgetEvent } from "./sheet-widget-events.mjs";

const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const label = (en, ru) => globalThis.game?.i18n?.lang === "ru" ? ru : en;
const clamp = (value, fallback, min, max) => Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Number(value))) : fallback;

export function renderCardHand(widget, stack) {
  const w = widget;
  const width = clamp(w.cardWidth, 132, 96, 240);
  const variant = String(w.variant ?? "");
  const layout = ["fan", "poker-fan", "tabletop"].includes(variant) ? "fan"
    : variant === "grid" ? "grid" : ["fan", "grid", "strip"].includes(w.layout) ? w.layout : "strip";
  const all = [...(stack?.cards ?? [])];
  const limit = Math.max(0, Number(w.maxVisible) || 0);
  const cards = limit ? all.slice(0, limit) : all;
  const mode = w.clickAction === "runGraph" ? "blueprint" : w.clickAction || "inspect";
  const runOn = mode === "blueprint" ? w.runGraphOn || "click" : "click";
  const cardHTML = (card, index, count) => {
    const back = card.face == null;
    const img = (back ? card.back?.img : card.faces?.[card.face]?.img) || "icons/svg/card-joker.svg";
    const name = card.name || label("Card", "Карта");
    const t = count <= 1 ? 0 : (index / (count - 1) * 2 - 1);
    return `<article class="sd-hand-card" style="--card-angle:${t * 18}deg;--card-lift:${Math.abs(t) ** 2 * 30}px;--card-order:${index};--card-left:${28 + index * width * 0.62}px">
      <button type="button" class="sd-hand-open" data-hand-action="card" data-card-id="${esc(card.id)}" aria-label="${esc(name)}" title="${esc(name)}">
        <img src="${esc(img)}" alt="" loading="lazy" draggable="false">
        <span class="sd-hand-name">${esc(name)}</span>
      </button>
      <button type="button" class="sd-hand-flip" data-hand-action="flip" data-card-id="${esc(card.id)}" title="${label("Flip card", "Перевернуть карту")}" aria-label="${label("Flip card", "Перевернуть карту")}: ${esc(name)}"><i class="fas fa-arrows-rotate" aria-hidden="true"></i></button>
    </article>`;
  };
  let body = "";
  // Limit each fan to ten cards so every card keeps a generous visible hit area.
  if (layout === "fan") {
    for (let start = 0; start < cards.length; start += 10) {
      const row = cards.slice(start, start + 10);
      body += `<div class="sd-hand-scroll"><div class="sd-hand-fan" style="--fan-width:${56 + width + (row.length - 1) * width * 0.62}px">${row.map((c, i) => cardHTML(c, i, row.length)).join("")}</div></div>`;
    }
  } else body = `<div class="sd-hand-${layout}">${cards.map((c, i) => cardHTML(c, i, cards.length)).join("")}</div>`;
  const empty = !stack ? label("Choose a Cards stack in widget settings.", "Выберите колоду или руку в настройках виджета.") : label("No cards in this hand.", "В этой руке пока нет карт.");
  const actions = stack && w.showActions !== "no" ? `<div class="sd-hand-actions">
    <button type="button" data-hand-action="draw"><i class="fas fa-hand"></i> ${label("Draw", "Взять")}</button>
    <button type="button" data-hand-action="pass"><i class="fas fa-share"></i> ${label("Pass", "Передать")}</button>
    <button type="button" data-hand-action="shuffle"><i class="fas fa-shuffle"></i> ${label("Shuffle", "Перемешать")}</button>
    <button type="button" data-hand-action="recall"><i class="fas fa-arrow-rotate-left"></i> ${label("Recall", "Вернуть")}</button>
    <button type="button" data-hand-action="flipAll"><i class="fas fa-arrows-rotate"></i> ${label("Flip all", "Перевернуть все")}</button>
  </div>` : "";
  return `<div class="widget widget-cardhand sd-hand-view ${variant === "poker-fan" ? "sd-hand-poker" : ""}" data-cardhand
    data-stack-uuid="${esc(stack?.uuid)}" data-widget-id="${esc(w.id)}" data-widget-key="${esc(w.widgetKey || w.id)}" data-widget-label="${esc(w.label || "Hand")}" data-click-mode="${esc(mode)}" data-run-on="${esc(runOn)}"
    ${mode === "blueprint" && w.actionGraph ? `data-legacy-card-graph="${esc(w.actionGraph)}"` : ""}
    style="--card-width:${width}px;--card-height:${Math.round(width * 1.42)}px">
    <div class="sd-hand-heading"><span class="widget-label">${esc(w.label || label("Hand", "Рука"))}</span>${w.showCount !== "no" ? `<span class="sd-hand-count">${cards.length}${cards.length < all.length ? ` / ${all.length}` : ""}</span>` : ""}</div>
    ${cards.length ? body : `<div class="sd-hand-empty">${empty}</div>`}
    ${cards.length < all.length ? `<button type="button" class="sd-hand-more" data-hand-action="stack">${label("Open full hand", "Открыть всю руку")} (${all.length})</button>` : ""}
    ${actions}</div>`;
}

export function cardEventRuntime(card, stack) {
  const face = card?.face == null ? -1 : card.face;
  return {
    __cardClickedId: card?.id ?? "", __cardClickedName: card?.name ?? "", __cardClickedFace: face,
    __cardClickedFaceImg: (face < 0 ? card?.back?.img : card?.faces?.[face]?.img) ?? "",
    __cardClickedValue: Number(card?.value ?? card?.faces?.[face]?.value) || 0,
    __cardClickedStackId: stack?.id ?? "", __cardClickedStackUuid: stack?.uuid ?? "", __cardClickedStackName: stack?.name ?? ""
  };
}

/** One accessible interaction path shared by actor sheets, item sheets and HUD. */
export function bindCardHands(root, doc, { disabled = () => false } = {}) {
  root.querySelectorAll("[data-cardhand]").forEach(hand => {
    if (hand._sdHandBound) return;
    hand._sdHandBound = true;
    const handle = async event => {
      const button = event.target.closest?.("[data-hand-action]");
      if (!button || !hand.contains(button) || disabled()) return;
      const action = button.dataset.handAction;
      const eventName = event.type === "contextmenu" ? "rightclick" : event.type;
      const trigger = action === "card" && hand.dataset.clickMode === "blueprint" ? hand.dataset.runOn : "click";
      if (action !== "card" && eventName !== "click") return;
      event.preventDefault(); event.stopPropagation();
      if (hand.dataset.busy === "true") return;
      hand.dataset.busy = "true"; button.setAttribute("aria-busy", "true");
      try {
        const stack = await fromUuid(hand.dataset.stackUuid);
        if (!stack) throw new Error(label("Cards stack not found", "Колода не найдена"));
        const card = button.dataset.cardId ? stack.cards.get(button.dataset.cardId) : null;
        if (button.dataset.cardId && !card) throw new Error(label("Card no longer in this hand", "Карты больше нет в этой руке"));
        const runtime = cardEventRuntime(card, stack);
        const fired = await emitSheetWidgetEvent(doc, {
          event: action === "card" ? eventName : action, value: card?.uuid || (card ? `${stack.uuid}.Card.${card.id}` : stack.uuid),
          widgetId: hand.dataset.widgetId, widgetKey: hand.dataset.widgetKey, widgetLabel: hand.dataset.widgetLabel, widgetType: "cardHand",
          elementKey: card?.id ?? action, documentUuid: doc.uuid, sourceUuid: doc.uuid,
          actorId: doc.documentName === "Actor" ? doc.id : doc.actor?.id ?? "", cardRuntime: runtime
        });
        if (action === "card") {
          if (eventName !== trigger) return;
          const mode = hand.dataset.clickMode;
          if (mode === "inspect") await card.sheet?.render(true);
          else if (mode === "flip") await card.update({ face: card.face == null ? 0 : null });
          else if (mode === "play" || mode === "discard") {
            // Foundry's passDialog operates on the whole stack; playDialog targets this card.
            if (typeof stack.playDialog !== "function") throw new Error("This stack does not support playing cards");
            await stack.playDialog(card);
          } else if (mode === "blueprint" && !fired && hand.dataset.legacyCardGraph) {
            // Preserve old saves until their logic is moved to Sheet Blueprint.
            const { parseActionPayload } = await import("../ui-blueprint/ui-widget-events.mjs");
            const { ButtonExecutor } = await import("./button-executor.mjs");
            const payload = parseActionPayload(hand.dataset.legacyCardGraph);
            const buttonDef = { __macros: payload.macros, __eventRuntime: runtime };
            for (const action of payload.actions ?? []) await ButtonExecutor._runAction(action, doc.documentName === "Item" ? doc : null, doc.documentName === "Actor" ? doc : doc.actor, buttonDef, runtime);
          }
        } else if (action === "flip") await card.update({ face: card.face == null ? 0 : null });
        else if (action === "draw") await stack.drawDialog();
        else if (action === "pass") await stack.passDialog();
        else if (action === "shuffle") await stack.shuffle({ chatNotification: true });
        else if (action === "recall") await stack.recall({ chatNotification: true });
        else if (action === "flipAll") await stack.updateEmbeddedDocuments("Card", [...stack.cards].map(c => ({ _id: c.id, face: c.face == null ? 0 : null })));
        else if (action === "stack") await stack.sheet?.render(true);
      } catch (error) {
        console.error("SD | Card Hand", error);
        globalThis.ui?.notifications?.error?.(String(error.message ?? error));
      } finally { delete hand.dataset.busy; button.removeAttribute("aria-busy"); }
    };
    for (const event of ["click", "dblclick", "contextmenu"]) hand.addEventListener(event, handle);
  });
}
