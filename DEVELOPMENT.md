# Development notes

This repository ships a prebuilt plugin. Running DSH loads `lib/index.js` (host half) and `lib/client.js` (browser half) directly — there is no build step at install time, and no `node_modules` requirement beyond the peer packages DSH already provides.

## Layout

| Path | What it is |
| --- | --- |
| `lib/index.js` | Host half: git service, `/git/*` HTTP routes, workspace gate, multi-repository discovery. Edited directly; the added sections sit in marked `//#region` blocks. |
| `lib/client.js` | Browser half, in DSH's `__ModuleLoader__` wrapper format. The better-sidebar tab lives in one spliced `//#region` block. |
| `src/client/graph/SidebarTab.js` | **Single source of truth for the tab.** Plain JS (no JSX, it uses `react.createElement`), spliced into `lib/client.js`. |
| `src/host/conventions.js` | **Single source of truth for Git conventions.** The scaffold document, the seven framework templates, the read/write helpers, commit compliance (`commitCompliance`), the upgrade preview (`conventionPreview`), the workspace document (`workspaceConvention`), conflict detection (`conventionsConflicts`) and the prompt block that hands the merge to the model, spliced into `lib/index.js`. |
| `src/host/branches.js` | Overview fields (`repoAugment`), branch cleanup reports (`branchReport`), repository health (`repoHealth`), and since 1.15.0 the read-only worktree views (`parseWorktreeRows`, `worktreeKeyOf`, `commonGitDirOf`, `worktreeListViewOf` with its 60 s digest cache, `resolveWorktreeOf`, `worktreeTargetOf`, `worktreeBranchesOf`, `worktreeGraphOf`), spliced into `lib/index.js`. |
| `src/**/*.ts` | The upstream TypeScript sources, kept for reference. They are not compiled here. |
| `scripts/build-lib.mjs` | Splices `SidebarTab.js` into `lib/client.js`, inserts the tab's locale keys into both dictionaries, adds the fork's `GitApi` methods, and splices `conventions.js` and `branches.js` into `lib/index.js` (writing the `branches` region header itself). Idempotent. |
| `scripts/patch-host.mjs` | Idempotent patch of the upstream host bundle in 26 places: config fields, repository scan entries and decoration, the four read-only `/git/worktree/*` routes, and the `/git/conventions` + `/git/convention` + `/git/convention/preview` + `/git/convention/templates` + `/git/compliance` + `/git/workspace-convention` + `/git/init` + `/git/cleanup` + `/git/health` routes. |
| `scripts/test-host.mjs` | Offline end-to-end test of the host half (360 assertions): stubs the subprocess and web-server services, mounts the real route table, and asserts discovery, overview fields, branch cleanup, health, convention reads/writes, the user template store (list/starter/get/save/delete, its error codes and its effect on the catalogue and on written documents), commit compliance (including the AI attribution trailer), upgrade previews, the workspace document, document conflicts and the prompt block that hands the merge to the model, the cost of a scan (one ref probe per repository, cached while the refs sit still), gate rejections and error codes, and the read-only worktree routes against real `git worktree` fixtures (bare, locked, detached, prunable). |
| `scripts/validate-lib.mjs` | Checks that every `t("…")` key used in the tab exists in both the `zh` and `en` dictionaries, and that every `sidebarTab*` / `SIDEBAR_TAB_*` identifier is defined. |
| `scripts/preview-tab.mjs` | Loads `lib/client.js` with a fake React runtime, runs `apply(ctx)`, renders the tab with sample data and writes `preview/*.html` (`-preview`, `-states`, `-hero`, `-overview`, `-tier3`, `-worktrees`). Its fake `ctx` also serves the `slots`/`sessions` injection, so the opt-in main-area View is exercised here. |
| `scripts/prepend-shared.mjs` | One-off helper: extracts the shared prelude (helpers and style constants) of the tab region from a pristine `lib/client.js`. |

## Building the tab

```sh
node scripts/build-lib.mjs      # rewrite both regions from their sources
node --check lib/client.js      # syntax, browser half
node --check lib/index.js       # syntax, host half
node scripts/validate-lib.mjs   # locale keys + identifiers
node scripts/test-host.mjs      # host routes, conventions, gate
```

`build-lib.mjs` replaces the text between `//#region src/client/graph/SidebarTab.tsx` and `//#endregion`, and appends any locale key that is not yet present. Edit `SidebarTab.js`, never the region in `lib/client.js` — the next build overwrites it. The same script also patches the client glue outside that region (`GLUE_PATCHES`): the registration's `ctx.inject` list is widened there, because services the tab needs (`workspaces`, `uiWorkspace`) are captured at registration, not inside the region. Patches are idempotent and guarded by an exact anchor line, so a second run reports `applied 0`.

The same script splices the two host modules (`conventions.js`, `branches.js`) between their `//#region` header and the following `//#endregion`, writes the `branches` region header when it is missing, and adds the fork's `GitApi` methods when they are missing. Run it twice when touching either region: a second run must print the same line counts and leave one region per module.

## Previewing without DSH

```sh
node scripts/preview-tab.mjs
```

Writes `preview/graph-tab-preview.html` (three panels: default two-line rows, a nested repository, a pinned-commit view with compact zoom), `preview/graph-tab-preview-light.html`, `preview/graph-tab-states.html` (the pinned detail card, the init flow and the conventions picker), `preview/graph-tab-hero.html` and `-light` (a single narrow panel, the shape README screenshots use), `preview/graph-tab-tier3.html` (compliance chips, the upgrade preview and the workspace strip), `preview/graph-tab-refs.html` (the ref chips, plain and muted) and `preview/graph-tab-worktrees.html` (a selected linked checkout with its status strip and jump actions, and a repository with no linked checkout). The generated HTML is tracked so the pages are reviewable in a diff; the PNGs you take from them are not (`preview/*.png`).

The script also exercises interaction against its own fake DOM: it asserts that no hover tooltip is rendered, clicks a row and asserts the detail card, clicks *Copy commit info* and asserts the button flips to "copied", opens the full-window view and asserts an overlay with an SVG, then closes it, and finally runs the conventions flow — a repository without a document must auto-write the scaffold, open the picker and list seven framework cards. Any broken prop, missing locale key or missing DOM guard fails the run instead of silently rendering nothing.

The same run covers the 1.4.0 tier-1 features: the rollback prompt (asserted token by token), the search field and the ref toggles, and the SVG export. The export is checked as a document, not as a download: it must start with `<svg`, carry `xmlns` + `viewBox` + a `<title>`, avoid CSS variables, hold one `data-gitgraph-export-row` per panel row, mark the pinned commit, and keep the lane pitch identical to the panel's row height (a zoomed panel used to drift). Two environment switches help when working on it:

```sh
EXPORT_SVG_PATH=/tmp/export-graph.svg node scripts/preview-tab.mjs   # dump the SVG
EXPORT_DARK=1 EXPORT_SVG_PATH=/tmp/export-dark.svg node scripts/preview-tab.mjs   # dark palette
```

The exported file opens on its own — `google-chrome --headless=new --screenshot=… file.svg` is enough to eyeball it.

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

With no arguments the harness runs on its built-in fixture. To render the real repositories of this machine, pass the JSON responses of `/git/repos` and `/git/graph` (one `--graph` per repository) and point the first panel at one of them with `--focus <relPath>`:

```sh
node scripts/preview-tab.mjs
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

## Overview, branch cleanup and health (1.5.0)

Tier 2 adds two read-only host routes and one client panel; nothing here mutates a repository.

**Host module.** `src/host/branches.js` is spliced into `lib/index.js` between `//#region src/host/branches.ts` and the next `//#endregion`, immediately before `function registerGitRoutes`. Its region header is written by `scripts/build-lib.mjs`, not by `patch-host.mjs`: the patch script's idempotency check only looks for its own replacement text, and the region body would make that check true again on the second build, leaving an empty duplicate region behind.

- `repoGit(service, root, argv)` runs one git command through `service.runner.run` and returns `null` on any failure, so a single broken repository never aborts a workspace-wide scan. Everything else builds argv arrays (`branchRowsArgv`, `upstreamNameArgv`, `unmergedCountArgv`, `stashListArgv`, `untrackedArgv`, …) and parses stdout.
- `repoAugment(service, entries)` adds `activity` (epoch seconds) and `upstream` (`{ name, ahead, behind }`, or `null` without a remote) to every entry the scanner returns, so `/git/repos` carries what the overview sorts on. It runs at `REPO_AUGMENT_CONCURRENCY` = 4.
- `branchReport(service, path)` picks a base from `BRANCH_BASE_CANDIDATES` (`main`, `master`, `trunk`, `develop`), falling back to the current branch and then the first branch, and marks each branch `merged` when `rev-list --count <base>..<branch>` is 0. `BRANCH_STALE_DAYS` = 30 flags quiet branches.
- `repoHealth(service, path)` reports detached HEAD, dirty files, conflicts, an in-progress operation, stash count, branches without an upstream, untracked files (scan capped at `HEALTH_UNTRACKED_LIMIT` = 400, big ones above `HEALTH_BIG_BYTES` = 1 MiB measured with `stat`), and `.git` size. Read the object count, not the byte count: `git count-objects -v` reports KiB and rounds a small repository down to `0`.

**Routes.** `case "/git/cleanup"` and `case "/git/health"` sit next to `/git/init`, go through `createWorkspaceGate`, and answer a non-repository with `FAIL(MALFORMED_VIEW)`. They are deliberately not called `/git/branches`: the upstream bundle already registers that path and a `GitApi.branches()` method, and a duplicate `switch` case would never run while the injected client method would be skipped as "already present".

**Client.** The toolbar's `data-gitgraph-action="overview"` button swaps the panel for a list sorted by `conflicts → dirty → behind → has-branch → path` (`sidebarTabOverviewRank`), showing branch, conflicts, changed files, ahead/behind, missing upstream, activity age and, on click of `data-gitgraph-overview-detail`, a lazily loaded branch/health block. Clicking a row selects that repository and returns to the graph. `overviewOpen` is mirrored into `SIDEBAR_TAB_CACHE` like the other view state.

`test-host.mjs` builds a real `repos/branchy` fixture (a merged branch, an unmerged branch, an untracked big file) and asserts both reports plus the gate rejections; `preview-tab.mjs` stubs the two routes and asserts the overview ordering, the toolbar collapse, the detail block and the drill-in.

## UI cleanup in 1.6.1

- 工具栏回到五项：refresh、zoom-out、zoom-in、export、init-repo。`data-gitgraph-action="overview"` 与 `"expand"` 不再存在，`data-gitgraph-overlay` / `data-gitgraph-overview-list` 也不再渲染（`preview-tab.mjs` 有断言守着）。
- 删掉的实现：`overviewOpen`/`overviewDetail`/`overviewInflight`/`expanded` 状态、`toggleOverviewDetail()`、`sidebarTabOverview*()` 六个纯函数、`SIDEBAR_TAB_OVERVIEW*`/`SIDEBAR_TAB_OVERLAY*`/`SIDEBAR_TAB_EXPAND` 样式常量、21 条 `sidebar.overview*` locale 键。host 侧 `/git/cleanup` 与 `/git/health` 保留（只读，仍在 `test-host` 里断言）。
- 字号：`src/client/graph/SidebarTab.js` 里所有 `fontSize: 10/11/12/13` 各自 +1（10→11、11→12、12→13、13→14）；`SIDEBAR_TAB_ROW_H = 34` 与泳道几何未动，导出 SVG 的行距仍取自面板行高。

## Commit compliance, workspace document and upgrade preview (1.6.0)

Tier 3 makes the written document do something. All three additions are read-only except the explicit "write" actions, which already existed in shape and still only touch the conventions file.

**Rules come from the document, never from the plugin.** `parseConventionRules(text)` (in `src/host/conventions.js`) scans the text for the few rules a document tends to state in prose: a subject-length cap (`/(\d{2,3})\s*(?:个)?\s*(?:字符|characters|chars)/gi`, the smallest match, clamped to 20–200), a type vocabulary (at least three known `CONVENTION_TYPE_VOCAB` words in backticks, returned in vocabulary order), a lowercase start, "no trailing period" and "imperative mood". Anything the document does not say is `null` in `CONVENTION_NO_RULES` and is not checked.

- `conventionSubjectReasons(subject, rules)` returns which rules a subject breaks (`length`, `type`, `case`, `period`, `mood`). The type is matched with `/^([a-z]+)(?:\([^)]*\))?!?:\s+/` and stripped before the remaining subject is checked, so `feat(parser): add the loop` is judged on `add the loop`.
- `commitCompliance(service, root, docName)` reads the document (capped at 64 KB) and runs `log -20 --format=%H%x00%s`, returning `{ root, doc, docPath, exists, enforced, checked, failing, rules, offenders }` with at most six offenders.
- The tab renders one line — `failing` of `checked` — and up to three offenders as `oid  subject  [reasons]`, with the reason codes translated by `sidebarTabReasonLabel`.

**The upgrade preview never writes.** `conventionSectionsOf(text)` splits on `^##\s+` so the leading prose counts as its own section, and `conventionDiff(current, next)` compares titles to classify each section `added` / `changed` / `removed` / `same`, carrying the dropped and fresh paragraphs. A blank current document reports every section as `added` instead of `changed`. `conventionPreview(root, docName, frameworkId)` returns that diff plus `currentBytes` / `nextBytes` and touches nothing; a framework id it does not know answers `{ ok: false, error: { code: "convention-unknown-framework" } }`.

On the client, `pickFramework(path, framework, exists)` writes straight away only when no document exists; otherwise it fetches the preview into `upgrade` and the framework cards are replaced by a *what would change* panel with counts, the first six non-`same` sections, and **Write it** / **Cancel**. Only `confirmUpgrade()` calls `/git/convention`. A repository that already has a document also gets a *Switch framework* button — without it the preview was unreachable, because the picker only opened when the document was missing.

**The workspace document is one level above the repositories.** `conventionWorkspaceDocPath(root, docName)` is `<root>/.dsh/<doc>`; `conventionsWorkspaceDocFor(start, docName)` walks up at most eight levels looking for it, and `conventionsDocumentFor(cwd, docName)` now falls back to it after the repository candidates fail. When the owner is not the repository root, the injected prompt block says `- inherited Git conventions` and names the directory under `Inherited from:`. `/git/workspace-convention` takes an `action` of `state`, `preview` or `write` and deliberately does not require a repository — it is the one route that works in a workspace with no root repository at all.

**Routes and methods.** `case "/git/compliance"`, `case "/git/convention/preview"` and `case "/git/workspace-convention"` are inserted by `patch-host.mjs` (`compliance-routes`), the `GitApi` methods are `commitCompliance(path)`, `conventionPreview(path, framework)` and `workspaceConvention(path, payload)`. None of them collide with an upstream path or method — check that before adding a route, because a duplicate `switch` case silently loses and a duplicate `GitApi` method is skipped as "already present".

`test-host.mjs` adds a `repos/ruled` fixture (a document spelling out a 40-character cap and three types, four commits of which three break a rule), a `repos/docless` fixture proving an absent document yields `enforced: false`, and a container/child pair proving the workspace document is created, reported and inherited. `preview-tab.mjs` stubs the three routes, injects a synthetic `repos-tier3/ruled` entry, and asserts that the compliance line and offenders render, that opening the picker fetches a preview **without** calling `/git/convention` (the counter must stay at zero), that confirming calls it exactly once, and that the workspace button writes once.

## Chinese, English and strict documents (1.7.0)

Compliance never assumes English. `normalizeConventionType()` maps Chinese aliases
(`新增`, `修复`, `文档`, ...) onto the canonical types, `parseConventionRules()` only
treats a tick list as a type vocabulary when at least three *valid* names appear, and
`conventionSubjectReasons()` runs the lowercase and imperative checks only when the
first word of the subject is Latin - a Chinese subject can never be flagged for case
or mood, only for length and a trailing period (`/[\.。]$/`).

`strict: true` in a document is read by `conventionStrictOf()`;
`conventionWithStrict()` rewrites the front matter so the flag lands right after
`status:`, and the injected prompt block gains an explicit paragraph plus one
`Machine-checkable rules: ...` line from `conventionRuleSummary()`.

Two traps worth remembering:

- `API_METHODS` in `scripts/build-lib.mjs` is guarded by `next.includes(guard)`, and the
  tab source is spliced *before* the GitApi methods are injected - so a guard of
  `"conventionOptions"` matches the tab's own call site and the method never lands.
  Guards must be substrings that only exist in the injected code.
  (`"conventionOptions(path, framework, force, strict)"`).
- The control skin lives in `--dsh-gg-ctl-{bg,fg,bd}` on `[data-gitgraph-sidebar-tab]`,
  overridden under `body[data-ds-dark-theme]`. Every inline fallback must be legible on
  its own (`#ffffff` background, `#14181f` text), because the static preview pages never
  run `sidebarTabEnsureStyle()`; `scripts/preview-tab.mjs` declares the same three
  variables in its own shell so the previews match.

## Subject language (1.7.3, shipped in 1.8.0)

`src/host/conventions.js` stores the language policy as one more front line of the same document:

```
status: settled
strict: true
language: en
```

`conventionDocLanguageOf()` reads it back (`zh` / `en` / `mixed`, anything unknown counts as `mixed`), `parseConventionRules()` reports `language` plus `languageStated`, and only a stated language produces the `lang` compliance reason - a document that never mentions a language accepts either one. `conventionWithLanguage()` keeps the order `status -> strict -> language`, `conventionPromptBlockFor()` always emits one `Subject language: ...` line, and the picker passes the choice as `language` on `/git/convention` and `/git/convention/preview`, so the preview diff shows the line that will be written.

Two traps worth knowing:

- `conventionInsertField()` takes a key that may already carry a colon; normalise it (`replace(/:+$/, "")`) before appending one, otherwise the anchor becomes `status::` and never matches, and the new line lands at the top of the file.
- `scripts/build-lib.mjs` strips a GitApi addition by method name before inserting it again. Never rely on `includes(guard)`: when a signature changes the guard no longer matches, the old definition stays, and in an object literal the later (older) method wins.

## Scan cost and caches (1.8.0)

A scan answers "what is in this workspace": one `status` probe per repository, one ref probe per repository, and one document read per repository. The first two used to be four spawns; now it is two on a cold scan and one on every later scan.

- **One ref probe.** `summaryRowsArgv()` asks `for-each-ref refs/heads` for name, tip date, upstream and `%(upstream:track)` in a single call, so `parseUpstreamTrack()` derives ahead/behind without `rev-list` or `rev-parse`. `repoSummaryOf()` picks the checked-out branch, else the first branch with an upstream, else the first branch, and returns `{activity, upstream}`.
- **The fingerprint cache.** `repoSummaryFingerprint(root)` is the content of `.git/HEAD` plus the `mtimeMs` of `.git/logs/HEAD` — every commit, checkout and branch creation rewrites that reflog. It deliberately ignores `.git/index`: `git status` may touch it, and the status probe runs on every scan anyway, so folding the index in would make the cache miss every time. A hit skips the spawn entirely and records `probeHits`. `.git` as a file (submodule or linked worktree) is resolved through its `gitdir:` line.
- **The counter window.** `repoScan()` clears the counters before `repoAugment()` and reads them after, so `timings` describes this scan only:

  ```js
  timings: { statusMs, augmentMs, conventionsMs, totalMs, probeSpawns, probeHits }
  ```

  Taking the snapshot before the work it measures silently reports zeros — that is exactly what the first cut did.
- **Batched document reads.** `repoScan()` groups `repoConventionState()` calls by `REPO_SCAN_CONCURRENCY` instead of awaiting them one at a time. Status probes are 8 at a time with a 2.5 s budget per repository (`REPO_SCAN_STATUS_TIMEOUT_MS`), so one slow repository cannot hold a batch slot for five seconds.
- **The client polls less.** The twenty-second tick only re-scans the repository list; the graph follows the host's change stream, which already says when the selected repository moved. `loadGraph` is no longer in that effect's dependency list.

The three `patch-host.mjs` patches that used to add the convention state, the scan view and the augment call to `repoScan()` are gone: that region has no `src/` counterpart, so it is edited directly and the patch count is 22. Section `[14]` of `test-host.mjs` proves the behaviour — two repositories, four scans, `2/0`, `0/2`, `0/2` (dirty worktree, still cached), `1/1` (one repository committed, the other cached).

## Switches that stick (1.8.1)

The picker's two front fields are part of the document, not of the session.

- `conventionSettings(root, docName, strict, language)` in `src/host/conventions.js` rewrites only the front fields of an existing document (`conventionWithStrict` + `conventionWithLanguage`) and reports `convention-missing-document` when there is nothing to rewrite. It is reachable as `POST /git/convention/settings` and as `action: "settings"` on `/git/workspace-convention`.
- `repoConventionState()` and `workspaceConventionState()` return `strict`, `language` and `languageStated`, so the picker opens on what the document says. `languageStated` matters: a document with no `language:` line means "mixed" without claiming a rule.
- The client stores a switch the moment it is clicked (`applyConventionSettings`) and re-reads it on the next scan; `writeWorkspaceDoc` sends both fields with the write.
- A container that is not a repository used to inject only the index of the repositories below it. `conventionsDocumentFor()` now climbs to `<workspace>/.dsh/<doc>` and the prompt carries the document itself (language line, strict paragraph, machine-checkable rules, body) plus that index.

Two traps worth remembering:

1. A regex written through a python heredoc loses its backslash escapes (`\b` becomes `b`), and the only检查 that catches it is `node --check lib/index.js`.
2. `test-host.mjs` needs a real repository to prove `convention-missing-document`; a plain directory answers `not-a-repository` first.

## Rule chips instead of a tally (1.8.2)

The conventions strip used to say *2 of the last 5 commits do not match* and print three offenders. Those commits are already written and cannot be fixed from the panel, so the line was noise. It now prints the rules the document puts in force, which is the same list the prompt block receives:

| chip | source | `data-gitgraph-rule` |
| --- | --- | --- |
| `type: feat / fix / docs` | `rules.types` | `types` |
| `subject ≤ 72` | `rules.maxSubject` | `length` |
| `lowercase start` | `rules.lowercase` | `case` |
| `no trailing period` | `rules.noPeriod` | `period` |
| `imperative` | `rules.imperative` | `mood` |
| `Chinese` / `English` / `Chinese + English` | `rules.languageStated` + `rules.language` | `language` |
| amber *Strict* | `compliance.strict` | — |

`SIDEBAR_TAB_COMPLIANCE` is a wrapping row (`flexWrap: "wrap"`, `gap: 4`); as a column every chip was stretched into its own full-width row. `data-gitgraph-compliance` now reads `none` (no checkable rule) or `rules`, never `failing` / `clean`.

`/git/compliance` still returns `checked`, `failing`, `offenders` and `languages` — the host side is unchanged and `scripts/test-host.mjs` keeps asserting it. The preview stub keeps those fields too, so the assertions only cover the chips and the absence of the old tally.

The picker's cancel button is now `sidebar.conventionsClose` (*Close*); the upgrade preview keeps `sidebar.previewCancel` (*Cancel*), because there it really does cancel a write. `sidebarTabReasonLabel()` and six `sidebar.reason*` keys went with the offender rows: 166 → 163 locale keys.

## Front-matter values carry comments (1.8.3)

The templates and the scaffold write their fields with an explanatory comment on the same line:

```yaml
status: draft          # draft | settled
language: zh           # zh | en | mixed
```

`conventionWithLanguage()` and `conventionWithStrict()` only replace the line, so the comment survives - and a reader that compares the raw value against `zh` sees `zh           # zh | en | mixed` and falls back to `mixed`. `conventionFieldValue()` therefore cuts at the first `#` and strips paired quotes, and `conventionDocLanguageOf()` matches by containment (mix/混 first, then Chinese tokens, then English ones). The `repos/langzh` fixture in `test-host.mjs` keeps its comments on purpose: if the strip ever regresses, `rules.language` turns into `mixed` and the suite fails.

## Ref chips: one per branch (1.9.0)

The filter row is built from `refGroups`, not from the raw refs, so a branch and its remote twin are one chip and one mute.

* `remoteNames` derives remote names from the refs: a ref ending in `/<local branch>` contributes the single-segment prefix in front of it. Fallback: if nothing can be derived and some ref starts with `origin/`, treat `origin` as a remote.
* `refGroups` folds refs into `{key, refs, local, remote}`, drops `HEAD` / `HEAD -> …` / `<remote>/HEAD` and skips `tag: …` outright (see 1.9.1 below), and sorts by `rank` (current branch, other local, remote-only) then by name.
* `refGroupOf` (`ref -> key`) drives the visibility filter, the row badges and the export, so muting a chip mutes both twins.
* The row shows at most `SIDEBAR_TAB_FILTER_REFS_MAX` chips plus a `data-gitgraph-refs-toggle` `+N`, and a `data-gitgraph-refs-clear` chip whenever anything is muted; below `SIDEBAR_TAB_FILTER_REFS_MIN` (four) chips it is not drawn at all unless something is muted.
* Row badges map `HEAD -> main` to `main` and reuse the chip labels; tags map through `refLabelOf` to their bare name. `sidebarTabExportSvg()` takes that map as its `refLabels` option.

Tests live in the refs section of `scripts/preview-tab.mjs` (synthetic repo + its own `GRAPH_BY_ROOT` entry, restored afterwards) and the page it writes is `preview/graph-tab-refs.html`.

## Tags are not filters (1.9.1)

A tag points at one commit, so muting it hides exactly one row - it cannot pay for a slot in the filter row. Host `lib/index.js:616` therefore keeps the `tag: ` prefix (it used to strip it, which made every release tag look like a branch in the panel). **That host line shipped one version late (1.9.2)**: the client half was verified only against `scripts/preview-tab.mjs` fixtures that wrote `tag: v1.0.0` by hand, so the code was correct against data the real host never produced. `test-host` section [16] now builds a repository with a real annotated tag and asserts the ref shape coming out of `/git/graph`.

* `refGroups` skips `tag: …`, so a repository with one branch and nine release tags ends up with a single chip and the row disappears (`SIDEBAR_TAB_FILTER_REFS_MIN = 4`, beside `SIDEBAR_TAB_FILTER_REFS_MAX = 12`).
* `refLabelOf` keeps tags readable: it starts from `refGroupOf` and adds `tag: v1.0.0 -> v1.0.0`. Row badges and the export use it; the visibility filter keeps using `refGroupOf`.
* `usable` in the visibility memo returns `true` when a ref has no chip key, otherwise muting any branch would also drop release commits that only a tag points at. `HEAD` / `HEAD -> x` still return `false`.
* The muted case always shows the row, because *Clear filters* lives there.
* `SIDEBAR_TAB_CHIP_TAG` is gone; `sidebar.expandGraph` (dead since 1.6.1) is gone from `lib/client.js` as well, since `build-lib` only inserts keys and never deletes them.
* `scripts/preview-tab.mjs` needs four branches in its fixture to reach the chip assertions, plus a one-branch mount (`repos-refs/tiny`) that proves the row is skipped while the search field stays.

## AI attribution, conflicting documents and one-click merge (1.10.0)

**AI attribution is a documented policy, not a guess.** The front matter grew a fourth switch, `ai: required | optional | forbidden`; `conventionAiOf()` reads it with the same comment-stripping `conventionFieldValue()` as every other field and recognises the Chinese phrasings (`禁止` / `必须` / `注明`), and `conventionAiStated()` keeps "absent" apart from "explicitly optional" so the UI and the prompt stay quiet for documents that never mention it. `commitCompliance()` had to change *how* it reads history: the old format was `%H%x00%s`, subject only — but a trailer lives in the body, so the format is now `%H%x00%s%x00%b%x1e`, records split on `\u001e` and fields on `\u0000`. `required` accepts any of `assisted-by`, `generated-by`, `ai-assisted`, `ai-generated`, `co-authored-by`; `forbidden` only rejects the AI-specific ones (`CONVENTION_AI_TOOL_TRAILERS`), so a human `Co-authored-by:` is not collateral damage. As with every other rule, it is reported always and refused only under `strict: true`.

**Conflicts are computed, never assumed away.** `conventionsConflicts(cwd, docName)` compares only the documents that govern the same commits: the workspace one (`<ws>/.dsh/<doc>`), the repository's own, and the ancestor repositories' (`conventionsAncestorRoots`). Child repositories are *not* conflicts — being independent is the point of them. Fields (`status`, `framework`, `strict`, `language`, `ai`) need **both** sides to state the field before a difference counts, and so do the boolean rules; `types` only conflicts when the vocabularies do not intersect at all. `digest` (sha256 of the compared paths, fields, rules and the conflict count) joins the `conventionsPromptText` cache stamp, so editing a document or a conflict appearing invalidates the injected text immediately. When the count is non-zero, `conventionsConflictPromptBlock()` appends the disagreements to the prompt and tells the model, in so many words, not to pick a winner on its own and to ask the user first.

**Merging is a union, because parsing is already a union.** `parseConventionRules()` scans the whole document — the cap is the smallest number anywhere, the type vocabulary is every backticked known word, each boolean is "true if it appears anywhere". So `conventionsConsolidate()` appends one `## Unified rules (merged by dsh-git-graph)` section phrased to hit those same regexes (English on purpose: Chinese text would flip `conventionDocLanguageOf`) and copies every `##` section of the other documents, renaming a colliding title to `## <title> (from workspace | this repository | parent repository)` and numbering it if that collides too. Parsing the merged file therefore yields the union without rewriting anyone's prose. The earlier version skipped colliding sections outright, which silently dropped the repository document's body.

**Writing is reversible and idempotent.** The target is always `<ws>/.dsh/<doc>`; without `force` an existing target answers `convention-exists`; every replaced file is copied to `<name>.bak-<yyyymmdd-HHmmss>` first (the bundle imports no `rename`/`unlink`, so backups are read-then-write); a repository document is replaced by a pointer (`<!-- dsh-git-graph: inherited from <relative path> -->`). `repoConventionState()` reports such a file as `pointer: true` with `inherited`, which keeps the auto-scaffold from laying a second template over it, and `conventionsDocumentFor()` skips pointers so the injected block comes from the workspace document exactly once. A call without `write: true` returns the plan (`written: false`, `diff`, `union`, `absorbed`), which is what both the panel and the tool show before touching anything.

**Routes, tool and client.** `patch-host.mjs` adds `/git/conventions/conflicts` (`convention-conflict-routes`) — the read-only report; there is deliberately no write route — threads `ai` through the existing write, preview, settings and workspace routes,. (1.14.0 removed the `git_conventions` tool this paragraph used to describe — conventions never regained a tool — and 1.16.0 brought back a single fallback `git_worktree` tool, see *One fallback tool, and a quieter worktree list (1.16.0)*; since 1.17.0 that tool can also `init` a repository and install the commit-msg hook, see *Initializing a repository (1.17.0)*.) On the client, `SidebarTab.js` gained the three-way AI selector (`data-gitgraph-ai`), the AI rule chip, and the conflict strip (`data-gitgraph-conflicts` + *Merge with AI*), backed by 15 new locale keys (166 → 181).

**Testing.** `test-host.mjs` covers it in three new groups (**215 assertions**): [17] the attribution policy is checked in the body (required / forbidden / optional), [18] conflicting documents are reported to the agent and there is no merge route to call (a 404 on `/git/conventions/consolidate`, and the report writes nothing), [20] rules written in a prose document (`AGENTS.md`) are reported as a `foreign` source and tighten the union, and such a file is never rewritten. Tests run through the HTTP surface, so `apply()` is only mounted once per process: it is wrapped in `mountOnce()`, which de-duplicates through `globalThis[Symbol.for("dsh-web.mounted-plugins")]`.
## The optional main-area View (1.12.0)

The same tab body can render as a page in the conversation area, beside the shipped
Views. It is **opt-in and closable**, so the sidebar tab stays the primary entry and
hosts that never switch it on see no new tab.

- Preference: `localStorage["dsh-git-graph:main-view"]` (`"1"` on). `sidebarTabMainViewEnabled`
  reads it defensively — a host without `localStorage`, or one that throws, simply means off.
- `sidebarTabSetMainView` writes it and notifies `sidebarTabMainViewSubscribe` listeners; the
  sidebar's toggle button and the View's own close button both go through it, so the two
  surfaces can never disagree.
- Registration lives in `lib/client.js` — **not** in the spliced region — because it needs
  `slots`: `ctx.inject(["slots", "sessions"], …)` then `slots.inject("conversation.view", () =>
  slots.register({ name: "conversation.view", id: "git-graph", order: 70, locale: NS,
  label: () => sidebarTabT(scope, "view.title"), inject: (sessionId) => ({ ctx, scope: { sessionId,
  cwd }, tab: void 0, visible: true }) }, GitGraphMainView))`. A fresh `id` is required: reusing a
  shipped id would replace that cell instead of adding one.
- `syncView()` disposes the previous registration before registering again, and the surrounding
  `effect` returns a cleanup that both unsubscribes and disposes, so flipping the switch takes
  effect in the running client without a restart of the plugin.
- The View has no `tab` descriptor, so `GitGraphSidebarTab` guards `choose()` with
  `if (tab === void 0 || tab === null) return;` before writing `meta.repoPath` through `updateTab`.
- The label must be built from **literal** `t("…")` arguments (`const mainViewLabel = open ?
  t("sidebar.mainViewOn") : t("sidebar.mainViewOpen")`), because `scripts/validate-lib.mjs` only
  counts literal keys; a ternary inside `t()` silently escapes the locale check.
- Testing: this harness cannot render nested components (a child component's hooks would run
  outside a render pass), so `preview-tab.mjs` asserts against the element tree the View returns —
  container marker, tab body without a `tab` descriptor, and the close button flipping the
  preference and disposing the registration.

## The agent does the merge (1.13.0, and nothing else does since 1.13.1)

**Why the code stopped merging.** The union path is deterministic, but it can only merge what a regex can see: it cannot tell that two paragraphs say the same thing in different words, cannot drop a scaffold section that says "TBD" in every heading, and cannot rewrite prose to be shorter. The user's verdict was that a regex merge is not good enough, so the merge moved to the model and the code kept only the parts that are actually mechanical — and 1.13.1 finished the job by deleting the union itself (`conventionsConsolidate`, `conventionsUnionSection`, `conventionsMergedBody`, the `/git/conventions/consolidate` route, the `draft` action and the client merge panel). What remains below is the whole of it: read, judge, write.

**Read, judge, write — by the model, with its own tools.** There is no conventions tool to call: 1.14.0 removed `git_conventions` together with the `agentTool` switch (the 1.16.0 `git_worktree` tool touches no document unless it is asked to `init`, and then it only writes the template — see *Initializing a repository (1.17.0)*), so the model reads the documents with whatever file tools it already has. What the code still owns is discovery and comparison: `conventionsSources(cwd, docName)` and `conventionsConflicts(cwd, docName)` (see above). The former `conventionsReadDocuments(cwd, docName)` returns `{doc, root, workspace, target, documents}` where each document carries `origin` (`workspace` / `this repository` / `parent repository` / the prose file's own name), `docPath`, `bytes`, `pointer`, `inherited`, `truncated` and up to `CONVENTION_READ_MAX_CHARS` (20000) of `text` — the whole point is that the model sees the real file, not the parsed rule list. `conventionsWriteMerged(cwd, docName, body, {force, absorb})` stores the body the model authored: an empty body is refused (`convention-empty`), an existing target without `force` is refused (`convention-exists`), the old target is copied to `<name>.bak-<yyyymmdd-HHmmss>`, and with `absorb` (default) every non-workspace governing document is backed up and replaced by `conventionPointerBody(...)`, which keeps the original text below the marker. Both helpers went through `conventionReadText` / `conventionWriteText` so a failed read or write became `{ok: false, error: {code: "internal"}}` instead of a throw — all of it is gone; nothing in the plugin writes a conventions document any more.

**The prompt says who merges, and how.** `conventionsConflictPromptBlock()` never suggests a code path; it tells the model to read every document in full with its own file tools, compare the texts itself, propose one merged document, and write it only after the user agrees. Since 1.14.0 it also spells out the conventions that used to live inside the tool: the workspace document governs, every replaced file keeps a `<name>.bak-<yyyymmdd-HHmmss>` copy, and a repository document becomes a pointer in exactly three lines (`> 本仓库的 Git 规范由工作区统一维护：<path>`, `> This repository inherits the workspace conventions; this file only points at it.`, `<!-- dsh-git-graph: inherited from <path> -->`) with the pre-merge text kept below them. The same block also fires when the documents do *not* mechanically disagree: with two or more documents and `count === 0` it emits one line saying the texts may still duplicate each other, so "look for duplicated conventions" is a standing instruction rather than something only a field mismatch triggers.

**The panel hands it over instead of doing it.** *Merge with AI* (`data-gitgraph-action="conventions-ai-merge"`) and the conflict strip's button (`conventions-conflicts-review`) copy a ready-made request to the clipboard (`requestAiMerge`, defensive about `globalThis.navigator.clipboard`) and show a notice (`data-gitgraph-conventions-ai`), because a client plugin cannot start a model turn — it has no composer submit API. There is no fallback panel and no plan to confirm: the plugin writes nothing on its own, so the only way a merged document appears is the tool's `write` after a model read the sources.

**Testing.** `preview-tab.mjs` stubs `navigator.clipboard` (via `Object.defineProperty`, because `globalThis.navigator` is getter-only in Node 24) and asserts that both entry points copy and that `CONSOLIDATE_CALLS` stays at zero — no plan panel appears either. [18] and [20] assert the absent route (404) since a mechanical merge is no longer reachable even by hand, and [18] additionally checks that the prompt names the pointer and the backup convention.

## No tools at all (1.14.0)

The plugin used to ship two model-facing tools behind one `agentTool` switch: `git_worktree` (created, listed and removed managed worktrees) and `git_conventions` (`read` / `check` / `write`). Both are gone, on the grounds that a model with a shell and file tools can do all of it, and a tool description costs every request in every session.

What was deleted, so a reader does not go looking:

- `lib/index.js`: the whole `src/host/agent-tool.ts` region (`GIT_WORKTREE_TOOL`, `callingCwd`, `buildWorktreeTool`), the `agentTool` field of `Config` and of `effectiveConfig()`, `toolFiber` / `syncTool()` and the `loader/volatile-update` listener that re-ran it.
- `src/host/conventions.js`: `GIT_CONVENTIONS_TOOL`, `buildConventionsTool`, `conventionsReadDocuments`, `conventionsWriteMerged`, `conventionReadText`, `conventionWriteText`, `conventionPointerBody`, `conventionRelativePath`, `CONVENTION_READ_MAX_CHARS`.
- `scripts/patch-host.mjs`: the `conventions-tool` patch (24 patches left, down from 25). `config-schema`, `config-effective` and `prompt-mount` were re-keyed on `autoBaseline` / `ctx.effect(...)` because their old anchors contained the removed `agentTool` / `syncTool()` lines.
- `scripts/build-lib.mjs` never carried the tools; `scripts/test-host.mjs` lost group [19] and gained one assertion in [18] (232 → 215).

What replaced it is text, not code. `conventionsConflictPromptBlock()` now carries the three facts the tool used to encode: the workspace document governs, every replaced file keeps `<name>.bak-<yyyymmdd-HHmmss>`, and a repository document becomes a three-line pointer (`<!-- dsh-git-graph: inherited from <path> -->`) with its pre-merge text kept below. [18] asserts that wording, so a refactor cannot quietly drop it.

Still there, and deliberately so: the `systemPrompt` section (`conventionsPromptMount`) is **not** a tool and cannot be switched off. It is the whole point of the plugin — every model step in a documented session is told which document governs and what it says.

## Linked checkouts, read-only (1.15.0)

A repository row in the tree expands to its linked worktrees. The tab shows them, shows one checkout's branch/HEAD/dirty state, and offers jumps; it never creates, removes or switches a worktree — that stays in the chip's dialog, in the auto-isolation wrapper around `startSession`, and (since 1.16.0) in the agent's `git_worktree` tool.

**The gate is the hard part.** `/git/worktrees` only answers for paths inside a registered workspace, and a managed checkout lives under `$DSH_HOME/worktrees`, usually outside every workspace. Loosening `createWorkspaceGate` was not an option: the same gate guards `/git/switch`, `/git/create-branch`, `/git/worktree-add` and `/git/worktree-remove`. Instead each new route has the client send the *anchor repository* path (which is inside a workspace) plus the checkout it wants, and the route:

1. runs `createWorkspaceGate(ctx)(path)` on the anchor — unregistered anchors get `workspace-unknown` with no subprocess spawned;
2. reads `git worktree list --porcelain` **once** and treats that output as the only whitelist;
3. normalises both sides (`worktreeKeyOf`: strip `\\?\` / `\\?\UNC\`, `realpath`, then `gatePathKey`) and runs every probe with the path *git printed* as cwd — the request string never becomes a cwd.

`GitService` is untouched: `status` reuses `statusFromGatedPath()` (the existing caller-authorized seam), and `branches`/`graph` are composed from the module-level argv builders and parsers the service already exports internally (`forEachRefArgv` + `parseBranches`, `headBranchArgv` + `graphLogArgv` + `parseGraph`). The shared body of work lives in `src/host/branches.js`; the routes themselves are one `patch-host.mjs` patch inserted before `case "/git/repos":` (anchor `'\t\t\tcase "/git/repos": {'`, guard `'case "/git/worktree/list": {'`). `patch-host.mjs` asserts that no route case appears twice.

**Porcelain details.** `git worktree list --porcelain` prints forward slashes on Windows, may prefix paths with `\\?\` (or `\\?\UNC\`), and marks `bare`, `locked [reason]`, `prunable <reason>` and `detached`. The new `parseWorktreeRows()` keeps all of them; the old `parseWorktrees()` is left byte-identical because the chip's worktree manager consumes it through `/git/worktrees`. `bare` repositories get `ok(null)` for status (a bare checkout cannot be dirty); `prunable` rows stay listed but are skipped when matching a requested checkout, so a deleted directory answers `worktree-not-found` instead of spawning git in nothing.

**List cache.** `worktreeListViewOf()` caches for 60 s per anchor, keyed on `worktreeKeyOf(anchor)`, and invalidates on a digest of `<commonGitDir>/worktrees/*/HEAD` (name + rounded mtime). It cannot reuse `repoSummaryFingerprint()`: a managed worktree is created outside the main repository, so the main repository's `HEAD`/`logs/HEAD` never change. A cached list is also dropped when a row's directory no longer exists. The digest is pure `stat`/`readdir` — a cached list spawns nothing.

**Client.** `sidebarTabWorktrees` / `sidebarTabUiWorkspace` are stashed by the registration glue (`build-lib.mjs` `GLUE_PATCHES`, because that `ctx.inject` block sits outside the tab region). Worktree state is keyed `sessionId|cwd` like the rest of the tab cache, and a path change resets the selection. The list is fetched when a repository is expanded and refreshed when the change stream fires; only the *selected* checkout asks for a status (`/git/worktree/status`), and SSE keeps subscribing to the repository root — subscribing to a checkout path would make the host key collapse to `no-repo` and blank the graph. The status strip switches to `worktreeStatusShown ?? status`, otherwise it would keep describing the main checkout. Jump actions use `workspaces.create({path})` → `sessions.create({workspaceId})` → `uiWorkspace.openSession(sessionId)`; `uiWorkspace.startSession` is deliberately **not** used, because auto-isolation wraps it and would create a second worktree. Markers: `data-gitgraph-worktrees` / `-worktree` / `-worktree-active` / `-worktree-current` / `-worktree-dirty` / `-worktree-missing` / `-worktree-count` / `-head` / `-actions` / `-notice`, plus `data-gitgraph-action="worktree-open-session|worktree-open-workspace|worktree-copy-path"`.

**Tests.** `test-host.mjs` groups `[21]`–`[24]` build real worktrees with the real `git` binary in a `mkdtemp` directory outside the workspace (plus one bare anchor inside it, so the gate can pass), assert the routes, the whitelist behaviour, cache spawn counts and that `/git/worktrees` keeps its exact shape. `preview-tab.mjs` stubs `git/worktree/list` and `git/worktree/status`, and asserts the checkout rows, the status hand-off, the HEAD marker and the jump actions.

## One fallback tool, and a quieter worktree list (1.16.0)

**The sidebar renders no worktree controls.** The tab's worktree group is a read-only projection with no lifecycle of its own: it renders nothing while the list is loading or failing (`worktrees.phase !== "ready"` returns `null`, so the old "could not read the worktree list" row disappeared with the host-version mismatch that produced it), it renders nothing for a repository with no linked checkout, and it no longer carries a hint row explaining where creation lives. What remains is the count, the linked checkouts, their status hand-off and the jump actions. Creation and removal stay in the branch chip's dialog (`worktree-create` / `worktree-manage`), in a plain `git worktree add`, and in the agent tool below — the tab never grows a write action, so there is no empty state and no failure row to explain.

**One tool comes back, deliberately narrow.** `src/host/agent-tool.js` is plain JavaScript and is spliced into `lib/index.js` between the historical `//#region src/host/agent-tool.ts` markers, so `build-lib.mjs` reads a `.js` source while the region name stays put. It registers `git_worktree` **unconditionally**: there is no `agentTool` setting and no hard dependency on the tools service at load time (it is injected lazily with `ctx.inject(['tools'], …)`), because the tool exists precisely for the sessions where the user does not want to click a dialog. The actions are `init` / `create` / `list` / `remove` (`init` arrived in 1.17.0 — see *Initializing a repository (1.17.0)*); `create` also registers the new worktree as a workspace (`ctx.workspaceRegistry.create` runs *after* `addWorktree` succeeds), which is how the next session opened there ends up with the worktree as its cwd under workspace-write sandboxing — the calling session cannot migrate its own cwd. Every guard the routes enforce applies to the tool too, because it calls the same `GitService.worktrees` / `addWorktree` / `removeWorktree`: managed-home containment, sanitized names, the `wt/` branch convention, the uncommitted-changes refusal behind `force`, and optional `deleteBranch`. A session with no project cwd gets `{ok: false, code: "workspace-unknown"}` instead of a throw. The `git_conventions` tool stays gone: reading, judging and writing a conventions document is a prompt job, and the injected text already carries the three facts a tool used to encode (workspace document governs, `.bak-<timestamp>`, three-line pointer).

**Testing.** `test-host.mjs` group `[25]` mounts the tool through the real `tools.register` seam (the fake `inject` records the `['tools']` dependency and runs `toolCtx.effect`) and asserts all three actions, the generated name, the auto-registered workspace, the workspace-unknown rejection and the removal path — **299 assertions**, up from 215. `preview-tab.mjs`'s nested-repository fixture now proves the silent states: a mount with linked checkouts renders the count and no notice, a mount with none renders no group at all.

## Initializing a repository (1.17.0)

**The gap this closes.** Everything the plugin knows about a repository's conventions is injected from a `GIT_CONVENTIONS.md` on disk (`conventionsPromptMount`). A repository the agent created itself with a bare `git init` has no document, so that session gets no rules at all — the agent then commits in whatever shape it likes. The same holds for the naming convention the plugin enforces elsewhere: `addWorktree()` forces a `wt/` branch under `$DSH_HOME/worktrees`, but a hand-written `git worktree add ../foo` is just git. Since 1.17.0 the fallback tool may initialize a repository the plugin's way, and a strict document installs a hook that checks a plain `git commit` as well.

**`init` is one more action on the same tool.** `git_worktree({action: "init", branch?, framework?, strict?, language?, ai?})`:

1. validates `framework` *before* any subprocess (an unknown id answers `convention-unknown-framework` and leaves the directory untouched);
2. runs `repoInit(service, cwd, branch || "main")` — the same helper the tab's `/git/init` route uses, so a directory that already holds a repository is refused with `already-repository` instead of being re-initialized;
3. renders the document with `conventionBodyOf(framework || "none", basename(cwd), strict, language, ai)`, takes the document name from the row's live config (`featureConfig().conventionsDoc`, default `CONVENTION_DOC_DEFAULT`), and writes it with `repoWriteConvention(cwd, docName, body, {force: false})` — the same write path as the preview panel, so backups, `convention-exists` and the pointer rules stay in one place;
4. returns `{ok, root, branch, docPath, framework, strict, hook, note}` where `hook` is whatever the commit-msg installer reported.

There is no second tool and no settings switch: `init` exists for the same reason `create` does — the agent should be able to work without the user clicking through the UI, and the tab's row-menu entry (`data-dsh-part="worktree-create"` in the branch chip) is still the interactive path.

**The commit-msg hook makes a strict document bite.** `repoWriteConvention()` now ends by calling `repoInstallCommitMsgHook(root, doc, rules)` whenever the written document is repository-level (`doc` does not start with `CONVENTION_WORKSPACE_DIR`, i.e. `.dsh/`) and the directory is a repository. It writes two files into the hooks directory — `.git/hooks/commit-msg` (a three-line `sh` shim that runs the checker next to it with `node`, and exits 0 with a banner when `node` is not on `PATH`, so a broken toolchain never locks the user out of committing) and `.git/hooks/graph-commit-msg.mjs` (a self-contained ESM script). The checker embeds the rules parsed from the document — `maxSubject`, `types`, `lowercase`, `noPeriod`, `imperative`, `language`, `ai` — together with the type vocabulary and aliases, and reproduces `conventionSubjectReasons()`'s checks in plain JavaScript, because the hook must not import the plugin. It reads the message file git passes as `$1`, prints every reason it found (Chinese and English) plus the `--no-verify` escape hatch, and exits non-zero; `git commit --no-verify` bypasses it by design.

**Safety rules, so the installer never fights the user.** A document that is not `strict: true` removes a hook that carries our marker (`installed: false, reason: "not-strict"`, or `{removed: true}` when one was there) — flipping the setting off retires the hook. A `commit-msg` hook that does not carry the marker is never overwritten (`foreign-hook`), so Husky and its friends win. `core.hooksPath` is honoured: the installer reads it with a tiny INI reader (`conventionGitConfigValue`) and writes into that directory, resolving relative paths against the repository root; `conventionGitDir()` also understands a `.git` *file* (`gitdir: …`) so linked worktrees and submodules work. Workspace-level documents (under `.dsh/`) install nothing — they govern many repositories, and a hook per repository is not the plugin's call to make.

**Testing.** `test-host.mjs` group `[25]` grew the whole flow in a temp directory: an unknown framework is refused before `git init`; `init` creates the repository, writes `strict: true` / `language: zh` and installs both files; the generated checker accepts a compliant message and rejects an unknown type (naming `GIT_CONVENTIONS.md`), a trailing period, an over-long subject and a Chinese-policy violation from an English subject; `ai: "required"` rejects a missing trailer and accepts one; `init` without `strict` writes the document and no hook; a second `init` answers `already-repository`; and `/git/convention` with `{force: true, strict: false}` retires the hook again — **318 assertions**. The checker is executed for real (`spawnSync(process.execPath, [checker, file])`), and additionally smoke-tested once against a real `git commit` on Windows.

## User-defined convention templates (1.18.0)

**The gap this closes.** The seven frameworks are compiled into `conventions.js`, so a team whose house style does not match any of them had to write the document by hand and lose the picker, the upgrade preview and the settings switches. Since 1.18.0 a user can keep their own templates next to the built-ins, write one into any repository, and delete it again — without a rebuild and without touching profile config.

**Storage is a JSON store under `$DSH_HOME`, not config.** `conventionTemplatesFile()` resolves `$DSH_HOME/git-graph/conventions-templates.json` through `dshHome()`, the same helper the managed worktrees use. The file is `{version: 1, templates: [...]}`; each record carries `id`, `name`, the optional display fields (`nameZh`, `tagline`, `taglineZh`, `bestFor`, `bestForZh`, `url`), `body`, `createdAt` and `updatedAt`. Writes are atomic (`mkdir`, temp file, `rename`) and serialised through one promise chain, a corrupt or foreign-version file degrades to zero templates with `error.code = "convention-template-store"` instead of breaking the picker, and reads are cached on `path|mtimeMs|size`, so the picker costs one `stat` per opening rather than one parse. Nothing goes into `cordis.patch.yml`: a 64KB document body is not a settings value, and writing schema fields would drag in revision conflicts for a screen the user opens rarely.

**One catalogue, two sources.** `conventionCatalog()` now returns the seven built-ins with `custom: false` followed by the user records projected by `conventionTemplateCatalogMeta()` with `custom: true`; the metadata projection stays body-free so `/git/conventions` (and the workspace route) do not ship document bodies. `conventionBodyOf(frameworkId, …)` resolves a user id through `conventionTemplateBodyOf()`, which runs the built-in pipeline (`%REPO%`, language, strict, AI) and then *forces* `framework: <id>` into the front matter — a template copied from another framework can never write the wrong id. Unknown ids still answer `convention-unknown-framework`.

**Validation refuses early and names the field.** `conventionTemplateValidate()` checks the id (`^[a-z0-9][a-z0-9-]{1,47}$`, not a built-in id, not `none` → `convention-template-reserved`), the name (1–80), the optional fields (≤200, URL empty or `http(s)://`), the body (20B–64KB, must contain a `status:` line) and the 50-template cap (`convention-template-limit`). Every failure is `{ok: false, error: {code, message, field}}`; save is an upsert that keeps `createdAt`, delete refuses built-ins and `none` (`convention-template-reserved`) and unknown ids (`convention-template-unknown`).

**The route is path-less, like `/git/config`.** `POST /git/convention/templates` takes `{action, id?, template?}` with `list` / `starter` / `get` / `save` / `delete`; it is dispatched before the `path` requirement in `lib/index.js` (patch 21), so it needs no repository and therefore no `createWorkspaceGate` — no filesystem path crosses the boundary. The client method `conventionTemplates(action, payload)` is injected by `build-lib.mjs` (`API_METHODS`) like the other fork additions, so `src/client/api.ts` stays untouched.

**The UI is a tab-level page, not a modal.** A gear at the right end of the tab's own toolbar (`marginLeft: "auto"`; `data-gitgraph-action="conventions-settings"`) replaces the whole tab body with the settings page while it is open (`data-gitgraph-settings="open"`): a list (name, id, bytes, updated-at, edit, two-step delete), a "New template" button that starts from `starter`, an editor with the metadata fields plus a monospace body textarea, and an error/notice line. The picker keeps the built-ins first and appends a "My templates" group (custom badge, "Manage templates" button) only when the catalogue carries a `custom: true` entry, so a user with no templates sees the seven-card picker they always saw. Saving refreshes both the list and `/git/conventions` so the new card is one render away. 33 new locale keys per dictionary (the tab now resolves 221 keys), all literal `t("…")` calls so `validate-lib.mjs` sees them.

**Deletion is a copy-boundary, not a cascade.** A written document embeds the body text; deleting the template does not touch it. What dangles is the `framework:` value in the document — it no longer resolves for the picker, the upgrade preview or the compliance conflict report (`conventionsConflicts()` compares front-matter fields, so it will show the unknown value). The UI says exactly that in the confirmation notice.

**Testing.** `test-host.mjs` group `[2b]` drives the whole store against a temporary `DSH_HOME`: empty list, starter body, save → catalogue 7 with `custom: true`, get, a document written from `team-strict` carrying `framework: team-strict`, preview, reserved ids, malformed ids, a body without `status:`, an unknown action, delete → catalogue back to 6, deleting a built-in, deleting an unknown id, a corrupt JSON file (empty list plus `convention-template-store`, catalogue still 6) and recovery after the file is removed — **360 assertions**. `preview-tab.mjs` gained a stateful fetch stub for the new route and a settings-page section: gear opens the page, the list starts empty, new → editor → save, the card appears under "My templates" with the custom badge (7 cards), close, manage from the picker, two-step delete returns the picker to 6 and the list to empty.

**Known limits.** Templates are global (one store per `$DSH_HOME`), an id cannot be renamed in place (delete and recreate; written documents keep the old id), there is no import/export or archive yet, and the picker's built-ins stay read-only by design. A future batch can move the entry to better-sidebar's `rightActions` slot (a true tab-strip button, v0.25.0+) and add a `settings.section` page for the profile-level switches.

## Known debt

- `lib/client.js` still carries upstream code that duplicates some helpers; only the tab region is generated, the rest is the upstream bundle.
- The upstream TypeScript sources in `src/` no longer match the built output exactly (they predate this fork's changes). They are reference material, not an input to the build. `src/host/agent-tool.js` is the one plain-JavaScript host source: the tool is spliced into `lib/index.js` as-is, so it cannot be a `.ts` file the build never compiles.
- The export is SVG only. A PNG would need a canvas rasteriser or a headless renderer; the SVG is what a browser, GitHub and most editors accept anyway.
- The overview renders every repository at once. Dozens of repositories are fine; hundreds would want a virtualised list.
- Overview detail requests are not cached: reopening a detail block asks the host twice again (branches + health).
- The upgrade preview diffs section titles only, not paragraph content, and rebuilds the whole document on write. Compliance looks at the last 20 commits and parses rules with regexes, so a document that phrases a rule unusually simply yields no rule.
- The commit-msg hook checks the subject line and the AI trailer only; it does not read the body, cannot see a scope's meaning, and treats a missing `node` as a pass (it prints a banner instead of blocking). It is a file in `.git/hooks`, so a fresh clone does not carry it — re-running `init`/`/git/convention` or the settings write re-installs it. A hook somebody else installed is never touched.
