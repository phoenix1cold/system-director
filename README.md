<p align="center">
  <img alt="System Director" src="assets/system-cover.webp" width="100%">
</p>

# System Director

<p align="center">
  <a href="https://discord.gg/Qfx5y8cPCw">
    <img alt="Join the Discord" src="https://img.shields.io/badge/Discord-Join%20the%20community-5865F2?style=for-the-badge&logo=discord&logoColor=white">
  </a>
  &nbsp;
  <a href="https://www.donationalerts.com/r/pronikxside">
    <img alt="Donate via DonationAlerts" src="https://img.shields.io/badge/Donate-DonationAlerts-FF5C5C?style=for-the-badge&logo=ko-fi&logoColor=white">
  </a>
</p>

<p align="center">
  <img alt="Status" src="https://img.shields.io/badge/status-pre--release-blueviolet?style=flat-square">
  <img alt="Version" src="https://img.shields.io/badge/version-0.9.10-informational?style=flat-square">
  <img alt="Foundry VTT" src="https://img.shields.io/badge/Foundry%20VTT-v13%20%E2%80%93%20v14-fe6a1f?style=flat-square">
  <img alt="License" src="https://img.shields.io/badge/license-source--available%20%2F%20non--commercial-blue?style=flat-square">
</p>

---

## 📦 Pre-Release Notice

**System Director is now in the `0.9.x` pre-release line on the way to `1.0`.**

What that means in practice:

- The system is **feature-complete for normal play** — sheet builder,
  node graph, hidden fields, slots, spellbooks, inventory / trade,
  Rich Text, action HUD, etc. all work.
- Pre-release is the **API-freeze window**: existing node names, data
  paths and widget keys are not expected to change before `1.0`. New
  nodes / widgets may still be added, but anything you build against
  today should keep working.
- There is **no automatic data migration** between every patch.
  Always back up your world before updating.
- Runs on **Foundry VTT v13** and is verified up to **v14**. Older
  Foundry versions are not supported.
- Bug reports are still very welcome — please open a GitHub issue or
  drop into the Discord (link above).

---

## Install in Foundry VTT

1. Open Foundry, go to **Game Systems** → **Install System**.
2. Paste the **manifest URL** into the *Manifest URL* field at the bottom:
   ```
   https://github.com/phoenix1cold/system-director/releases/latest/download/system.json
   ```
3. Click **Install**. Foundry will fetch the manifest and pull the matching
   `system.zip` from the same GitHub Release.
4. Future updates: Foundry checks the same URL and offers an in-app
   update whenever a new release is published.

### Manual install (offline)

Download `system.zip` from the
[latest release](https://github.com/phoenix1cold/system-director/releases/latest)
and extract it into your Foundry user-data folder at:

```
<FoundryUserData>/Data/systems/sd/
```

The extracted folder must contain `system.json` at its root.

---

## What is it?

System Director is a **build-your-own-system** sandbox for Foundry VTT.
Instead of hard-coding stats, abilities and rules, you compose them
visually:

- **Sheet Builder** — drag widgets (numbers, dice, attributes, slots,
  inventories, spellbooks, custom buttons) onto actor / item sheets and
  bind them to any data path.
- **Node Graph** — wire formulas, attribute calculations, on-click
  actions and event triggers without writing JavaScript. Supports
  conditions, loops, target sources, math, dice, chat output, Active
  Effect templates and more.
- **Hidden Fields** — define your own ad-hoc data on actors and items
  (e.g. `system.hiddenFields.mana`, `system.hiddenFields.power`) and
  reference them anywhere from sheets, nodes and slot filters.
- **Slots & Templates** — build inventory, spellbooks, equipment slots
  and class progression purely from the editor. Save sheet layouts as
  templates and reuse them across actors / items.
- **Localization** — UI is translated to English and Russian out of the
  box; node graph labels go through the same i18n layer.

The core idea: **anything Foundry exposes as data, you can put on a sheet
and react to it from a node graph.** No system-specific assumptions.

---

## Support / Community

- **Discord:** https://discord.gg/Qfx5y8cPCw — bug reports, feature
  requests, sharing actor / item templates, asking how to wire something.
- **Issues:** https://github.com/phoenix1cold/system-director/issues —
  reproducible bugs and concrete feature requests.
- **Donate:** https://www.donationalerts.com/r/pronikxside — if the
  system saved you time and you'd like to chip in toward continued
  development. Donations do not grant a commercial license (see
  [LICENSE](LICENSE)).
- **Wiki** https://phoenix1cold.github.io/system-director/

---

