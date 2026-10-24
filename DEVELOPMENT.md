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

Writes `preview/graph-tab-preview.html` (three panels: default two-line rows, a nested repository, a pinned-commit view with compact zoom), `preview/graph-tab-preview-light.html`, `preview/graph-tab-states.html` (the pinned detail card, the full-window overlay and the conventions picker) and `preview/graph-tab-hero.html` (a single narrow panel, the shape README screenshots use).

The script also exercises interaction against its own fake DOM: it asserts that no hover tooltip is rendered, clicks a row and asserts the detail card, clicks *Copy commit info* and asserts the button flips to "copied", opens the full-window view and asserts an overlay with an SVG, then closes it, and finally runs the conventions flow — a repository without a document must auto-write the scaffold, open the picker and list six framework cards. Any broken prop, missing locale key or missing DOM guard fails the run instead of silently rendering nothing.

The tab keeps a slow poll running so repositories created while it is open appear by themselves. Because the preview mounts components and never unmounts them, the script unrefs `setInterval` timers; without that Node waits for them forever and the run hangs.

## Live updates

The tab must never blank itself. Everything that reloads data follows one rule: keep the previous content on screen until a genuinely different result arrives.

| Path | Trigger | Behaviour |
| --- | --- | --- |
| `git/events` SSE | `subscribeChanges(path)` on the selected repository | 600 ms debounce, then a silent scan + graph reload |
| slow poll | every 20 s while the tab is active | silent scan + graph reload, skipped when `document.visibilityState === "hidden"` |
| `window` focus | user returns to the app | silent reload, throttled to one per 2 s |
| `visible` prop | tab becomes visible again | silent reload |
| refresh button | user | non-silent, keeps the current rows in place, button shows the scanning label |

Two comparison helpers make this cheap: `sidebarTabSameScan` and `sidebarTabSameGraph` (both in `SidebarTab.js`). When a reload returns the same repositories or the same commits, the state setter returns the previous object, so React skips the render entirely — no scroll jump, no flash. A silent reload that fails leaves the existing data alone instead of showing an error.

For the same reason `preview-tab.mjs` asserts that clicking refresh neither empties the commit rows nor the repository tree. If that assertion fails, something is setting a `scanning`/`loading` phase unconditionally again.

### Reopening the tab

better-sidebar keeps inactive tabs mounted but unmounts a tab that is closed, so every piece of component state dies with it. A cold mount used to mean a blank panel, a fresh scan and a graph request.

`SidebarTab.js` therefore keeps a module-level `SIDEBAR_TAB_CACHE` keyed by `sessionId|cwd`. It stores the last scan result, the selected repository, the row height, the open tree directories and the last graph view per repository (plus the tab's own `meta.repoPath` through `updateTab`, which survives restarts). On mount the state initialisers hydrate from that entry, so the first frame already draws the previous content; the mount-time scan and graph load then run **silently** behind it. The cache keeps 6 sessions (`SIDEBAR_TAB_CACHE_LIMIT`) and is written by one effect that mirrors `scan`/`selectedPath`/`rowHeight`/`treeOpen`/`graph`.

`preview-tab.mjs` asserts this behaviour by mounting the component a second time through the registered descriptor and checking that the very first render already contains `data-gitgraph-row` and `data-gitgraph-repo-tree`.

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

A third region, `src/host/conventions.ts` (source: `src/host/conventions.js`), holds the convention scaffold, the framework catalog, `repoConventionState` / `repoWriteConvention`, and `repoInit` (the `git init` used by the one-click button). `scripts/patch-host.mjs` wires it into the config schema (`conventionsDoc`, `conventionsAuto`), attaches a `conventions` state to every scanned repository, and adds the `/git/conventions`, `/git/convention` and `/git/init` routes.

`scripts/test-host.mjs` is the cheapest way to check host changes: it needs no DSH process, no browser and no restart.

### Prompt injection

The conventions document is only useful if the model reads it. The host registers a `systemPrompt` section (`conventionsPromptMount` in `src/host/conventions.js`) that the harness assembles before every model step:

```js
root.inject(["systemPrompt"], (scope) => {
  scope.effect(() => scope.systemPrompt.section({
    name: "git-conventions",
    order: 2400,
    interpolate: false,
    text: (context) => conventionsPromptText(conventionsPromptCwd(context), docName),
  }), "dsh-git-graph: git conventions prompt");
});
```

`interpolate: false` keeps the document text literal (no `$`-substitution), and `order: 2400` places the section ahead of the tooling policy that `dsh-ops` adds at 3250.

`conventionsPromptText` resolves the document in three steps (`conventionsDocumentFor`):

1. the repository the session `cwd` is in (`conventionsRepoRoot` walks up to the first `.git`),
2. the nearest enclosing repository (`conventionsAncestorRoots` collects every `.git` above it), which is how a monorepo container's document reaches the packages inside it — such a block is titled `inherited Git conventions` and carries `Inherited from: <container>`,
3. otherwise `conventionsContainerBlock`, a bounded breadth-first index of the documented repositories below the `cwd` (`CONVENTION_PROMPT_DEPTH` = 3, `CONVENTION_PROMPT_CHILDREN` = 40 directories inspected, `CONVENTION_PROMPT_LIST` = 6 entries, dot directories and `node_modules` skipped, a found repository is not descended into).

The document body is capped at `CONVENTION_PROMPT_MAX_CHARS` = 3000 characters and framed as repository policy rather than a user instruction. Results are cached by owner + `mtimeMs:size`; the index path uses a 10-second time bucket instead, so a document that appears later shows up without a restart.

`test-host.mjs` covers this with a fake `systemPrompt` service: it captures the descriptor, then calls `section.text({ agent: { session: { header: { cwd } } } })` for a documented repository, an undocumented one, an edited document (cache invalidation), a container directory, and a full inheritance fixture (own document, inherited document with its label, a deeper document overriding the inherited one, a plain subdirectory, and an index that reaches two levels down).

### One-click init

`case "/git/init"` runs `repoInit(service, gated.canonical, branch)`, which refuses (`already-repository`) when `service.repoRoot(path)` reports a root, then runs `service.runner.run(["init", "-b", branch], path)` and clears `repoScanCache` so the next `/git/repos` sees the new repository. The tab offers the button only while the workspace root is not itself a repository, and the `git init` result deliberately feeds the conventions flow: the new repository has an unborn `HEAD`, so the existing auto-scaffold creates the empty document and opens the framework picker.

`test-host.mjs` drives it end to end (init with a chosen branch, `.git` exists, second call refused, a subdirectory of an existing repository refused, a path outside the workspace rejected by the gate, and the following `/git/repos?refresh=true` listing the new empty repository). In `preview-tab.mjs` the fake `/git/init` records the call, so the UI flow is asserted too: the button, the confirm bar with its four branch options, cancel, confirm, and the empty-workspace button.

## Known debt

- `lib/client.js` still carries upstream code that duplicates some helpers; only the tab region is generated, the rest is the upstream bundle.
- The upstream TypeScript sources in `src/` no longer match the built output exactly (they predate this fork's changes). They are reference material, not an input to the build.
