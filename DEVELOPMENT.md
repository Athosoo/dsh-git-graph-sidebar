# Development notes

This repository ships a prebuilt plugin. Running DSH loads `lib/index.js` (host half) and `lib/client.js` (browser half) directly — there is no build step at install time, and no `node_modules` requirement beyond the peer packages DSH already provides.

## Layout

| Path | What it is |
| --- | --- |
| `lib/index.js` | Host half: git service, `/git/*` HTTP routes, workspace gate, multi-repository discovery. Edited directly; the added sections sit in marked `//#region` blocks. |
| `lib/client.js` | Browser half, in DSH's `__ModuleLoader__` wrapper format. The better-sidebar tab lives in one spliced `//#region` block. |
| `src/client/graph/SidebarTab.js` | **Single source of truth for the tab.** Plain JS (no JSX, it uses `react.createElement`), spliced into `lib/client.js`. |
| `src/host/conventions.js` | **Single source of truth for Git conventions.** The scaffold document, the six framework templates and the read/write helpers, spliced into `lib/index.js`. |
| `src/**/*.ts` | The upstream TypeScript sources, kept for reference. They are not compiled here. |
| `scripts/build-lib.mjs` | Splices `SidebarTab.js` into `lib/client.js`, inserts the tab's locale keys into both dictionaries, adds the `conventions` / `convention` methods to `GitApi`, and splices `conventions.js` into `lib/index.js`. Idempotent. |
| `scripts/patch-host.mjs` | Idempotent patch of the upstream host bundle: config fields, repository scan entries, and the `/git/conventions` + `/git/convention` routes. |
| `scripts/test-host.mjs` | Offline end-to-end test of the host half: stubs the subprocess and web-server services, mounts the real route table, and asserts discovery, convention reads/writes, gate rejections and error codes. |
| `scripts/validate-lib.mjs` | Checks that every `t("…")` key used in the tab exists in both the `zh` and `en` dictionaries, and that every `sidebarTab*` / `SIDEBAR_TAB_*` identifier is defined. |
| `scripts/preview-tab.mjs` | Loads `lib/client.js` with a fake React runtime, runs `apply(ctx)`, renders the tab with sample data and writes `preview/*.html`. |
| `scripts/prepend-shared.mjs` | One-off helper: extracts the shared prelude (helpers and style constants) of the tab region from a pristine `lib/client.js`. |

## Building the tab

```sh
node scripts/build-lib.mjs      # rewrite both regions from their sources
node --check lib/client.js      # syntax, browser half
node --check lib/index.js       # syntax, host half
node scripts/validate-lib.mjs   # locale keys + identifiers
node scripts/test-host.mjs      # host routes, conventions, gate
```

`build-lib.mjs` replaces the text between `//#region src/client/graph/SidebarTab.tsx` and `//#endregion`, and appends any locale key that is not yet present. Edit `SidebarTab.js`, never the region in `lib/client.js` — the next build overwrites it.

The same script splices `src/host/conventions.js` between `//#region src/host/conventions.ts` and the following `//#endregion`, and adds the two convention methods to `GitApi` when they are missing.

## Previewing without DSH

```sh
node scripts/preview-tab.mjs
```

Writes `preview/graph-tab-preview.html` (three panels: default two-line rows, a nested repository, a pinned-commit view with compact zoom), `preview/graph-tab-preview-light.html`, `preview/graph-tab-states.html` (the pinned detail card, the hover card, the full-window overlay and the conventions picker) and `preview/graph-tab-hero.html` (a single narrow panel, the shape README screenshots use).

The script also exercises interaction against its own fake DOM: it moves a pointer over a row and asserts the hover card appears and disappears, clicks a row and asserts the detail card, clicks *Copy commit info* and asserts the button flips to "copied", opens the full-window view and asserts an overlay with an SVG, then closes it, and finally runs the conventions flow — a repository without a document must auto-write the scaffold, open the picker and list six framework cards. Any broken prop, missing locale key or missing DOM guard fails the run instead of silently rendering nothing.

The tab keeps a slow poll running so repositories created while it is open appear by themselves. Because the preview mounts components and never unmounts them, the script unrefs `setInterval` timers; without that Node waits for them forever and the run hangs.

To render the real repositories of this machine, pass the JSON responses of `/git/repos` and `/git/graph` (one `--graph` per repository) and point the first panel at one of them:

```sh
node scripts/preview-tab.mjs --repos .demo/data/repos.json \
  --graph .demo/data/graph-graph-demo.json --focus graph-demo
```

Screenshot the generated HTML with Chrome headless (`--headless=new --screenshot=<absolute windows path> --window-size=1160,2100 --force-device-scale-factor=2`); relative paths and missing directories make it fail with exit code 0x3.

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

A third region, `src/host/conventions.ts` (source: `src/host/conventions.js`), holds the convention scaffold, the framework catalog and `repoConventionState` / `repoWriteConvention`. `scripts/patch-host.mjs` wires it into the config schema (`conventionsDoc`, `conventionsAuto`), attaches a `conventions` state to every scanned repository, and adds the `/git/conventions` and `/git/convention` routes.

`scripts/test-host.mjs` is the cheapest way to check host changes: it needs no DSH process, no browser and no restart.

## Known debt

- `lib/client.js` still carries upstream code that duplicates some helpers; only the tab region is generated, the rest is the upstream bundle.
- The upstream TypeScript sources in `src/` no longer match the built output exactly (they predate this fork's changes). They are reference material, not an input to the build.
