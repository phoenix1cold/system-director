# System Director

<p align="center">
  <a href="https://discord.gg/wSfn962R">
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

---

## Publishing a release (maintainers)

This repository ships with a GitHub Actions workflow at
`.github/workflows/release.yml` that builds a zip, rewrites
`system.json` with the correct per-release URLs, and uploads both to
the GitHub Release.

### Cutting a release

Two options — either works, the workflow handles both.

**A. Tag-driven (recommended).** Push a version tag; the workflow
builds and publishes a release automatically.

```bash
git tag v0.0.3
git push origin v0.0.3
```

**B. UI-driven.** In GitHub → **Releases** → **Draft a new release**,
pick or create a tag like `v0.0.3` and publish. The workflow runs on
`release: published` and attaches `system.json` + `system.zip` to the
release.

Tag format is `v<semver>` (e.g. `v0.0.3`, `v1.2.0`). The workflow
strips the leading `v` and writes the resulting version into the
released `system.json`.

### What the workflow produces

For a release tagged `v0.0.3` in repo `owner/repo`, the release page
ends up with two assets:

| Asset         | URL                                                                                       |
| ------------- | ----------------------------------------------------------------------------------------- |
| `system.json` | `https://github.com/owner/repo/releases/download/v0.0.3/system.json` (+ `/latest/...`)    |
| `system.zip`  | `https://github.com/owner/repo/releases/download/v0.0.3/system.zip`  (+ `/latest/...`)    |

Foundry's manifest install accepts the `/latest/download/system.json`
URL and from there follows the pinned `download` field inside that
JSON to fetch the matching `system.zip`.

---

## License

**Source-available, non-commercial, use-by-permission.**
Full terms in [LICENSE](LICENSE).

In short:

- You may run this system **locally** for your own non-paying games.
- You may **not** redistribute, fork, mirror, repackage, translate, or
  build a derivative work without prior **written permission** from the
  author.
- You may **not** use the system in any **commercial** setting (paid
  GM-for-hire services, paid subscriptions, paid servers, bundling it
  with anything sold, patronage tiers that gate access or features
  behind it, etc.) without a separate **commercial license** from the
  author.

For permission requests, open an issue at
[phoenix1cold/system-director/issues](https://github.com/phoenix1cold/system-director/issues).

---

## Development

- Source layout follows the usual Foundry system convention:
  `sd.mjs` is the ES-module entry declared in `system.json`,
  `module/` holds engine code, `templates/` holds Handlebars,
  `styles/` holds CSS, `lang/` holds i18n JSON.
- Syntax-check before committing:
  ```bash
  find module -name '*.mjs' -print0 | xargs -0 -n1 node --check
  node --check sd.mjs
  ```
- The release workflow uses only stock Ubuntu tools (`jq`, `zip`) plus
  `softprops/action-gh-release@v2`, so there are no extra secrets or
  tokens to configure beyond the default `GITHUB_TOKEN`.
