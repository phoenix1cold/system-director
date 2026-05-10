export async function openItemSheetFromSnapshot(snapshot, parentActor) {
  if (!snapshot) return;
  try {
    if (snapshot._sourceUuid) {
      const live = await fromUuid(snapshot._sourceUuid).catch(() => null);
      if (live?.sheet) { live.sheet.render(true); return; }
    }
    if (snapshot._id && parentActor) {
      const live = parentActor.items?.get?.(snapshot._id);
      if (live?.sheet) { live.sheet.render(true); return; }
    }
    const cls = CONFIG.Item?.documentClass ?? Item;
    const tmp = new cls(foundry.utils.deepClone(snapshot), { parent: parentActor ?? null });
    tmp.sheet.render(true);
  } catch (err) {
    console.warn("SD | Could not open item card:", err);
    ui.notifications?.warn?.(game.i18n?.localize?.("SD.Progression.OpenItemFailed") ?? "Could not open item");
  }
}

export async function editEffectViaStandardConfig(snapshot, { parent, title } = {}) {
  if (!parent || !(parent.documentName === "Actor" || parent.documentName === "Item")) {
    console.warn("SD | Cannot open standard ActiveEffect editor without a parent document.");
    return null;
  }

  const data = foundry.utils.deepClone(snapshot ?? {});
  data.flags = data.flags ?? {};
  data.flags.sd = data.flags.sd ?? {};
  data.flags.sd._sdProgressionTempEffect = true;
  delete data._id;

  let temp;
  try {
    const created = await parent.createEmbeddedDocuments("ActiveEffect", [data], { keepId: false, render: false });
    temp = Array.isArray(created) ? created[0] : created;
  } catch (err) {
    console.warn("SD | Failed to create temp effect for editing:", err);
    return null;
  }
  if (!temp) return null;

  return new Promise((resolve) => {
    let settled = false;
    const finish = async (result) => {
      if (settled) return;
      settled = true;
      Hooks.off("closeApplicationV2", _hookV2);
      Hooks.off("closeActiveEffectConfig", _hookLegacy);
      try { await parent.deleteEmbeddedDocuments("ActiveEffect", [temp.id], { render: false }); }
      catch (err) { console.warn("SD | Failed to remove temp effect:", err); }
      resolve(result);
    };

    const _hookV2 = (app) => {
      if (app?.document?.id !== temp.id) return;
      const live = parent.effects?.get(temp.id);
      const out  = live ? live.toObject() : null;
      if (out) {
        delete out._id;
        if (out.flags?.sd) delete out.flags.sd._sdProgressionTempEffect;
      }
      finish(out);
    };
    const _hookLegacy = (app) => {
      if (app?.document?.id !== temp.id) return;
      const live = parent.effects?.get(temp.id);
      const out  = live ? live.toObject() : null;
      if (out) {
        delete out._id;
        if (out.flags?.sd) delete out.flags.sd._sdProgressionTempEffect;
      }
      finish(out);
    };
    Hooks.on("closeApplicationV2", _hookV2);
    Hooks.on("closeActiveEffectConfig", _hookLegacy);

    try {
      const sheet = temp.sheet;
      if (title && sheet) sheet.options = { ...(sheet.options ?? {}), window: { ...(sheet.options?.window ?? {}), title } };
      sheet?.render(true);
    } catch (err) {
      console.warn("SD | Failed to open ActiveEffect sheet:", err);
      finish(null);
    }
  });
}
