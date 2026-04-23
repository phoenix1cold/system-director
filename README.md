# System Director (sd)

Foundry VTT game system, currently in beta.

Compatibility: Foundry VTT v13 (verified up to v14).

---

## Install in Foundry VTT (users)

1. In the Foundry **Setup** screen open **Game Systems** → **Install System**.
2. Paste the **manifest URL** into the *Manifest URL* field at the bottom:
   ```
   https://github.com/phoenix1cold/system-director/releases/latest/download/system.json
   ```
3. Click **Install**. Foundry fetches the manifest, then downloads the
   zipped system from the same GitHub release.
4. Future updates: Foundry checks this same manifest URL and will offer
   an in-app update whenever a new release is published.

> Replace `phoenix1cold/system-director` in the URL above with your own
> GitHub `<owner>/<repo>` if you forked or published the system under a
> different name.

### Manual install (no internet / offline)

Download `system.zip` from the
[latest release](https://github.com/phoenix1cold/system-director/releases/latest)
and extract it into your Foundry user-data folder at:

```
<FoundryUserData>/Data/systems/sd/
```

The extracted folder must contain `system.json` at its root.

---

## Publishing a release (maintainers)

This repository ships with a GitHub Actions workflow at
`.github/workflows/release.yml` that builds a zip, rewrites
`system.json` with the correct per-release URLs, and uploads both to
the GitHub Release.

### One-time setup

1. Create a GitHub repo (any name — update the placeholder URLs in
   `system.json` and this README if it's not `phoenix1cold/system-director`).
2. Push this directory:
   ```bash
   git init
   git add .
   git commit -m "Initial release"
   git branch -M main
   git remote add origin https://github.com/<owner>/<repo>.git
   git push -u origin main
   ```

### Cutting a release

Two options — either works, the workflow handles both.

**A. Tag-driven (recommended).** Push a version tag; the workflow
builds and publishes a release automatically.

```bash
git tag v0.0.3
git push origin v0.0.3
```

**B. UI-driven.** In GitHub → **Releases** → **Draft a new release**,
pick/create a tag like `v0.0.3` and publish. The workflow runs on
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

Foundry's manifest-install accepts the `/latest/download/system.json`
URL and from there follows the pinned `download` field inside that
JSON to fetch the matching `system.zip`.

---

## License

**Source-available, non-commercial, use-by-permission.**
See the full terms in [LICENSE](LICENSE).

In short:

- You may run this system **locally** for your own non-paying games.
- You may **not** redistribute, fork, mirror, repackage, translate, or build
  a derivative work without prior **written permission** from the author.
- You may **not** use the system in any **commercial** setting
  (paid GM-for-hire services, paid subscriptions, paid servers, bundling it
  with anything sold, patronage tiers that gate access/features to it, etc.)
  without a separate **commercial licence** from the author.

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
