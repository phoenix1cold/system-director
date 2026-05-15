# System Director

<p align="center">
  <a href="https://discord.gg/qX6RMWuHDa">
    <img alt="Join the Discord" src="https://img.shields.io/badge/Discord-Join%20the%20community-5865F2?style=for-the-badge&logo=discord&logoColor=white">
  </a>
  &nbsp;
  <a href="https://www.donationalerts.com/r/pronikxside">
    <img alt="Donate via DonationAlerts" src="https://img.shields.io/badge/Donate-DonationAlerts-FF5C5C?style=for-the-badge&logo=ko-fi&logoColor=white">
  </a>
</p>

<p align="center">
  <img alt="Status" src="https://img.shields.io/badge/status-beta-orange?style=flat-square">
  <img alt="Foundry VTT" src="https://img.shields.io/badge/Foundry%20VTT-v13%20%E2%80%93%20v14-fe6a1f?style=flat-square">
  <img alt="License" src="https://img.shields.io/badge/license-source--available%20%2F%20non--commercial-blue?style=flat-square">
</p>

---

## ⚠️ Beta Notice

**System Director is currently in public beta.**

Things you should know before installing it on a real campaign:

- The system is **feature-complete enough to play**, but APIs, data shapes
  and node names may still change between releases.
- There is **no automatic data migration** between every minor version.
  Always back up your world before updating.
- Edge-case bugs are expected. If you hit one, please open an issue or
  drop into the Discord (link above).
- It runs on **Foundry VTT v13** and is verified up to **v14**.
  Older Foundry versions are not supported.

If you want a quiet, no-surprises experience right now, wait for the 1.0
release. If you want to help shape the system, jump in.

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

- **Discord:** https://discord.gg/wSfn962R — bug reports, feature
  requests, sharing actor / item templates, asking how to wire something.
- **Issues:** https://github.com/phoenix1cold/system-director/issues —
  reproducible bugs and concrete feature requests.
- **Donate:** https://www.donationalerts.com/r/pronikxside — if the
  system saved you time and you'd like to chip in toward continued
  development. Donations do not grant a commercial license (see
  [LICENSE](LICENSE)).
- **Wiki** https://phoenix1cold.github.io/system-director/

---

