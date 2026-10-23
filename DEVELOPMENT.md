# Development notes

This repository ships a prebuilt plugin. Running DSH loads `lib/index.js` (host half) and `lib/client.js` (browser half) directly — there is no build step at install time, and no `node_modules` requirement beyond the peer packages DSH already provides.

## Layout

| Path | What it is |
| --- | --- |
| `lib/index.js` | Host half: git service, `/git/*` HTTP routes, workspace gate, multi-repository discovery. Edited directly; the added sections sit in marked `//#region` blocks. |
| `lib/client.js` | Browser half, in DSH's `__ModuleLoader__` wrapper format. The better-sidebar tab lives in one spliced `//#region` block. |
| `src/client/graph/SidebarTab.js` | **Single source of truth for the tab.** Plain JS (no JSX, it uses `react.createElement`), spliced into `lib/client.js`. |
| `src/**/*.ts` | The upstream TypeScript sources, kept for reference. They are not compiled here. |
| `scripts/build-lib.mjs` | Splices `SidebarTab.js` into `lib/client.js` and inserts the tab's locale keys into both dictionaries. Idempotent. |
| `scripts/validate-lib.mjs` | Checks that every `t("…")` key used in the tab exists in both the `zh` and `en` dictionaries, and that every `sidebarTab*` / `SIDEBAR_TAB_*` identifier is defined. |
| `scripts/preview-tab.mjs` | Loads `lib/client.js` with a fake React runtime, runs `apply(ctx)`, renders the tab with sample data and writes `preview/*.html`. |
| `scripts/prepend-shared.mjs` | One-off helper: extracts the shared prelude (helpers and style constants) of the tab region from a pristine `lib/client.js`. |

## Building the tab

```sh
node scripts/build-lib.mjs      # rewrite the region in lib/client.js from SidebarTab.js
node --check lib/client.js      # syntax
node scripts/validate-lib.mjs   # locale keys + identifiers
```

`build-lib.mjs` replaces the text between `//#region src/client/graph/SidebarTab.tsx` and `//#endregion`, and appends any locale key that is not yet present. Edit `SidebarTab.js`, never the region in `lib/client.js` — the next build overwrites it.

## Previewing without DSH

```sh
node scripts/preview-tab.mjs
```

Writes `preview/graph-tab-preview.html` (three panels: default two-line rows, a nested repository, a pinned-commit view with compact zoom) and `preview/graph-tab-preview-light.html`. The script also exercises interaction: it clicks a row and asserts the details card appears, then clicks zoom and asserts the card survives.

## Releasing

```sh
npm run check && npm run validate
npm pack --pack-destination ../dist        # produces dsh-git-graph-sidebar-<version>.tgz
```

Attach the tarball to the GitHub release as **`dsh-git-graph-sidebar.tgz`** — the version-free name matters: the market entry links `releases/latest/download/dsh-git-graph-sidebar.tgz`, which resolves `latest` at request time but takes the filename literally, so a versioned asset name 404s after the next release.

## Host half changes

The host half is not generated from `src/index.ts`; edits go into `lib/index.js` directly. Two regions were added on top of the upstream 0.4.8 bundle:

- the widened workspace gate (`function gatePathKey`, and the membership test inside `createWorkspaceGate`);
- `src/host/repos.ts` — multi-repository discovery (`repoStatusOf`, `repoScanDirectories`, `repoScan`, `repoScanCached`) plus the `case "/git/repos"` route.

Both are marked with `//#region` comments so they stay findable in the bundle.

## Known debt

- `lib/client.js` still carries upstream code that duplicates some helpers; only the tab region is generated, the rest is the upstream bundle.
- The upstream TypeScript sources in `src/` no longer match the built output exactly (they predate this fork's changes). They are reference material, not an input to the build.
