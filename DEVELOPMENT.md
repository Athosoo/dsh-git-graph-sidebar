# Development notes

This repository ships a prebuilt plugin. Running DSH loads `lib/index.js` (host half) and `lib/client.js` (browser half) directly — there is no build step at install time, and no `node_modules` requirement beyond the peer packages DSH already provides.

## Layout

| Path | What it is |
| --- | --- |
| `lib/index.js` | Host half: git service, `/git/*` HTTP routes, workspace gate, multi-repository discovery. Edited directly; the added sections sit in marked `//#region` blocks. |
| `lib/client.js` | Browser half, in DSH's `__ModuleLoader__` wrapper format. The better-sidebar tab lives in one spliced `//#region` block. |
| `src/client/graph/SidebarTab.js` | **Single source of truth for the tab.** Plain JS (no JSX, it uses `react.createElement`), spliced into `lib/client.js`. |
| `src/host/conventions.js` | **Single source of truth for Git conventions.** The scaffold document, the six framework templates, the read/write helpers, commit compliance (`commitCompliance`), the upgrade preview (`conventionPreview`) and the workspace document (`workspaceConvention`), spliced into `lib/index.js`. |
| `src/host/branches.js` | Overview fields (`repoAugment`), branch cleanup reports (`branchReport`) and repository health (`repoHealth`), spliced into `lib/index.js`. |
| `src/**/*.ts` | The upstream TypeScript sources, kept for reference. They are not compiled here. |
| `scripts/build-lib.mjs` | Splices `SidebarTab.js` into `lib/client.js`, inserts the tab's locale keys into both dictionaries, adds the fork's `GitApi` methods, and splices `conventions.js` and `branches.js` into `lib/index.js` (writing the `branches` region header itself). Idempotent. |
| `scripts/patch-host.mjs` | Idempotent patch of the upstream host bundle in 22 places: config fields, repository scan entries and decoration, and the `/git/conventions` + `/git/convention` + `/git/convention/preview` + `/git/compliance` + `/git/workspace-convention` + `/git/init` + `/git/cleanup` + `/git/health` routes. |
| `scripts/test-host.mjs` | Offline end-to-end test of the host half (186 assertions): stubs the subprocess and web-server services, mounts the real route table, and asserts discovery, overview fields, branch cleanup, health, convention reads/writes, commit compliance, upgrade previews, the workspace document, the cost of a scan (one ref probe per repository, cached while the refs sit still), gate rejections and error codes. |
| `scripts/validate-lib.mjs` | Checks that every `t("…")` key used in the tab exists in both the `zh` and `en` dictionaries, and that every `sidebarTab*` / `SIDEBAR_TAB_*` identifier is defined. |
| `scripts/preview-tab.mjs` | Loads `lib/client.js` with a fake React runtime, runs `apply(ctx)`, renders the tab with sample data and writes `preview/*.html` (`-preview`, `-states`, `-hero`, `-overview`, `-tier3`). |
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

The same script splices the two host modules (`conventions.js`, `branches.js`) between their `//#region` header and the following `//#endregion`, writes the `branches` region header when it is missing, and adds the fork's `GitApi` methods when they are missing. Run it twice when touching either region: a second run must print the same line counts and leave one region per module.

## Previewing without DSH

```sh
node scripts/preview-tab.mjs
```

Writes `preview/graph-tab-preview.html` (three panels: default two-line rows, a nested repository, a pinned-commit view with compact zoom), `preview/graph-tab-preview-light.html`, `preview/graph-tab-states.html` (the pinned detail card, the full-window overlay and the conventions picker), `preview/graph-tab-hero.html` (a single narrow panel, the shape README screenshots use) and `preview/graph-tab-overview.html` plus `-light` (the workspace overview with one detail block expanded).

The script also exercises interaction against its own fake DOM: it asserts that no hover tooltip is rendered, clicks a row and asserts the detail card, clicks *Copy commit info* and asserts the button flips to "copied", opens the full-window view and asserts an overlay with an SVG, then closes it, and finally runs the conventions flow — a repository without a document must auto-write the scaffold, open the picker and list six framework cards. Any broken prop, missing locale key or missing DOM guard fails the run instead of silently rendering nothing.

The same run covers the 1.4.0 tier-1 features: the rollback prompt (asserted token by token), the search field and the ref toggles, and the SVG export. The export is checked as a document, not as a download: it must start with `<svg`, carry `xmlns` + `viewBox` + a `<title>`, avoid CSS variables, hold one `data-gitgraph-export-row` per panel row, mark the pinned commit, and keep the lane pitch identical to the panel's row height (a zoomed panel used to drift). Two environment switches help when working on it:

```sh
EXPORT_SVG_PATH=../.demo/data/export-graph-demo.svg node scripts/preview-tab.mjs …   # dump the SVG
EXPORT_DARK=1 EXPORT_SVG_PATH=../.demo/data/export-dark.svg node scripts/preview-tab.mjs …   # dark palette
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

## Known debt

- `lib/client.js` still carries upstream code that duplicates some helpers; only the tab region is generated, the rest is the upstream bundle.
- The upstream TypeScript sources in `src/` no longer match the built output exactly (they predate this fork's changes). They are reference material, not an input to the build.
- The export is SVG only. A PNG would need a canvas rasteriser or a headless renderer; the SVG is what a browser, GitHub and most editors accept anyway.
- The overview renders every repository at once. Dozens of repositories are fine; hundreds would want a virtualised list.
- Overview detail requests are not cached: reopening a detail block asks the host twice again (branches + health).
- The upgrade preview diffs section titles only, not paragraph content, and rebuilds the whole document on write. Compliance looks at the last 20 commits and parses rules with regexes, so a document that phrases a rule unusually simply yields no rule.
