# Roadmap

This file is the delivery plan that follows 1.3.0. Each tier is one release; every item is read-only unless it says otherwise, and the plugin still never changes an existing repository's Git state (no commits, no branch switching, no worktrees — those stay in the chip's dialog).

本文件是 1.3.0 之后的交付计划。每个梯队对应一个版本；除特别标注外全部只读，插件依旧不改动已有仓库的 Git 状态（不提交、不切分支、不动 worktree——那些仍在对话栏 chip 的对话框里）。

## Where the plugin stands / 现状基座

| Area / 方面 | Delivered / 已交付 |
| --- | --- |
| Discovery / 仓库发现 | Every repository below the workspace directory, three levels deep, 200-repo cap, 60 s cache. 工作区下三层内全部仓库，上限 200，缓存 60 秒。 |
| Graph / 图谱 | Real SVG lane canvas, curved cross-lane edges, zoom that scales text, pinned commit card, full-window view, standalone SVG export. 真 SVG 泳道画布、跨道圆角连线、缩放带字号、提交详情卡、全屏视图、导出独立 SVG。 |
| Live / 实时 | SSE plus 20 s polling, silent refresh, no blanking, tab reopens from cache. SSE + 20 秒轮询，静默刷新不清空，重开走缓存。 |
| Conventions / 规范 | Scaffold, six frameworks, status strip, `systemPrompt` injection with inheritance from enclosing repositories. 空壳、六套框架、状态带、按继承链注入系统提示。 |
| Init / 初始化 | One-click `git init` for a workspace that is not a repository yet. 非仓库目录一键 `git init`。 |
| Overview / 总览 | One row per repository: branch, changes, conflicts, upstream distance, last activity, sorted by what needs attention. 每个仓库一行：分支、改动、冲突、上游距离、最近活动，按需要处理的程度排序。 |
| Cleanup and health / 清理与体检 | Merged/unmerged counts per local branch plus a read-only health report. 本地分支已合并/未合并计数与只读体检报告。 |
| AI hand-off / 交接 | Copy commit info and SHA, formatted for a model; copy an actionable rollback prompt. 复制提交信息与 SHA（面向模型排版）；复制可执行的回滚提示。 |

## Delivery status / 交付进度

| Version | State | What |
| --- | --- | --- |
| 1.3.0 | **released and installed** / 已发布并已装 | Conventions inheritance + repository index injection. |
| 1.4.0 | **released and installed** / 已发布并已装 | Tier 1 complete: rollback prompt, commit search + ref filters, standalone SVG export. |
| 1.5.0 | **code complete, unreleased** / 代码完成待发版 | Tier 2: workspace overview, branch cleanup hints, repository health. |
| 1.6.0 | planned / 计划中 | Tier 3 below. |

1.4.0 shipped from `src/client/graph/SidebarTab.js`, `scripts/build-lib.mjs` and `scripts/preview-tab.mjs` (plus the generated `lib/*.js` and `preview/*.html`). `HANDOVER.md` keeps the release trail and the next checklist.

## Tier 1 — 1.4.0 "make it usable" / 让图谱变得好用

Three items, all front end; no new host routes, no migration.

### 1. Copy an actionable rollback prompt / 复制可执行的回滚提示 — **shipped in 1.4.0** / 已随 1.4.0 发布

**Why.** The origin of this feature was "让我能跟 AI 说回滚到某一个提交". The old copy button produced a neutral commit description; the model still had to invent the commands. / 需求起点就是「让用户能和 AI 交流，要求回滚」。旧的复制只给中性描述，命令还得模型自己拼。

**Design (as built).** A third button in the pinned-commit card, `copy-rollback`, next to copy-info and copy-sha. It produces:

```
请把我的仓库回滚到某个提交（只描述，不要直接执行）。
仓库: <label>
Path: <absolute path>
当前分支: <branch>
提交: <shortSha> <subject>
SHA: <full sha>
提交时间: <YYYY-MM-DD HH:mm>
引用: <refs>
该提交之后，当前视图里还有 <n> 个提交。
候选做法:
- git revert <short>  安全，保留历史，适合已推送的分支
- git reset --hard <short>  丢弃该提交之后的提交，已推送的分支慎用
- git cherry-pick <short>  只把这一条提交搬到别的分支
请先确认用哪一种，并说明会丢失哪些提交。
```

Builder: `sidebarTabRollbackText(commit, repo, branch, commitsAbove, t)` in `src/client/graph/SidebarTab.js`. The count comes from the loaded view (`commits` is newest first, so the pinned index is the number above it) and is labelled "当前视图里" so it never claims more precision than it has. / 「之后还有几个提交」取自当前已加载视图，并标注范围。

**Acceptance (met).** `preview-tab.mjs` clicks `copy-rollback`, captures the clipboard text through a fake `navigator.clipboard`, and asserts it contains `git revert `, `git reset --hard `, `git cherry-pick ` and `Path: ` (417 chars against the demo repository).

### 2. Search and ref filtering / 搜索与引用筛选 — **shipped in 1.4.0** / 已随 1.4.0 发布

**Why.** Beyond a few dozen commits the graph cannot be navigated. / 提交一多就翻不动。

**Design (as built).** A filter bar above the canvas: one search input (`data-gitgraph-search`) plus one toggle per ref (`data-gitgraph-ref-filter`), capped at 12 refs (`SIDEBAR_TAB_FILTER_REFS_MAX`), HEAD aliases skipped because they duplicate a branch. Text matches subject, author, full SHA and ref names, case-insensitively. Both filters map onto `visibleCommits`:

- a ref toggle keeps only the commits reachable from the refs still enabled (parent walk inside the loaded page);
- a query keeps every hit **plus its ancestors inside the page**, so lanes stay connected;
- `lanes`, `laneCount`, `geometry`, the rows and both commit counters all read `visibleCommits`, so geometry stays valid;
- a `data-gitgraph-filtered` chip reports `{shown} / {total} 条匹配`, and an empty result shows `sidebar.noMatch` instead of an empty canvas.

Filtering is purely local — no network call. / 过滤全在本地，不发请求。

**Acceptance (met).** Against `graph-demo` (13 commits) the preview test asserts: typing `changelog` narrows 13 → 9 rows and shows the counter; clearing restores 13; walking the ref toggles until one actually hides rows finds `feature/c` (2 rows hidden — merged branches correctly hide nothing); unmuting restores 13. Note for future work: a *merged* branch's commits stay reachable from `main`, so its toggle legitimately changes nothing.

### 3. Export the graph as an image / 导出图谱图片 — **shipped in 1.4.0** / 已随 1.4.0 发布

**Why.** A picture of the graph is what gets pasted into a pull request, an issue or a design doc. / 贴 PR、Issue、文档靠的是图片。

**Design.** An `export` button serialises the current `<svg>` plus its row labels into a standalone SVG document (inline styles, explicit width/height, background from the active theme), then offers it as a download through a Blob URL. Falls back to copying the SVG markup as text when `URL.createObjectURL` is unavailable — which is also what keeps the headless preview test runnable. / 把 SVG 与行标签序列化为独立 SVG 文档（内联样式、显式尺寸、主题背景），经 Blob 下载；无 `createObjectURL` 时退化为复制 SVG 文本。

**Acceptance.** The exported document opens standalone with no missing classes; the button reports success; the preview test asserts the serialiser returns a `<svg` root with a `viewBox` and the expected row count.

**Implemented / 实现。** The toolbar's *Export image* serialises the current view — filtered rows, lanes, ref chips and the highlight on the pinned row — into one standalone SVG: the theme palette is written out as literal fills (no CSS variables, no classes), the size is explicit, the row pitch is taken from the live lane geometry so zoomed panels stay aligned, and a long subject is truncated instead of overflowing. Browsers get a real download named `git-graph-<repo>.svg`; where object URLs are unavailable (webviews, the preview harness) the markup is copied to the clipboard instead, and the button says which happened. / 工具栏「导出图片」把当前视图（筛选后的行、泳道、ref 徽章、固定行高亮）序列化为独立 SVG：主题色写字面量、显式尺寸、行距取自实时泳道几何（缩放后仍对齐）、过长主题截断而非溢出；浏览器直接下载 `git-graph-<仓库名>.svg`，无 object URL 环境退化为复制文本，按钮会说明发生了哪一种。

## Tier 2 — 1.5.0 "many repositories at a glance" / 多仓库一眼看清 — **code complete, unreleased** / 代码完成待发版

### 4. Workspace overview / 多仓库总览

A list view besides the single-repository graph: one row per discovered repository with branch, dirty count, conflicts, last commit age and whether it trails its upstream. Sorted so the repositories that need attention come first. Read-only; extends the `/git/repos` entry with an optional `upstream` block (`ahead`, `behind`) and computes the last activity from the graph head date already present in `status`.


**Implemented / 实现（1.5.0）**：`repoAugment()` 在每次扫描后给条目补 `activity`（秒）与 `upstream`（`{name, ahead, behind}`，无远端时保持 `null`）；工具栏的「总览」把仓库树换成清单，行内是分支、改动数（脏文件 + 未跟踪）、冲突、领先/落后、最近活动，排序依次看 `conflicts > 0` → `dirty > 0` → `behind > 0` → 是否有分支 → 路径；只读，点一行关闭清单并打开该仓库的图谱。

### 5. Branch cleanup hints / 可清理分支提示

For the selected repository, one row per local branch: "merged into main" or "N commits not merged". Read-only suggestion, never deletes. Needs a new host route `/git/branches/merged` because `rev-list --count` cannot be derived from the graph page.


**Implemented / 实现（1.5.0）**：新路由 `/git/cleanup`（不是原计划的 `/git/branches/merged`——上游插件已经占用 `/git/branches`，同名路由和方法都会被覆盖）。`branchReport()` 用 `for-each-ref` 取分支，基线依次取 `main` / `master` / `trunk` / `develop` / 当前分支 / 第一个分支，其余分支并发 4 条跑 `rev-list --count <base>..<branch>`，0 即 `merged: true`，否则带未合并计数。

### 6. Repository health check / 仓库体检

A read-only report: detached HEAD, branches without upstream, untracked files above a size threshold, stash count, `.git` size, repositories deeper than the discovery depth. Pure information with reasons, no fixes.


**Implemented / 实现（1.5.0）**：新路由 `/git/health`。`repoHealth()` 报告 `detached`、`noUpstream`（最多 20 条 + 计数）、`stale`（30 天未动）、`stash`、`untracked`（最多扫 400 个）、`bigUntracked`（超过 1 MB 的未跟踪文件，逐个 `stat`）与 `gitObjects`/`gitBytes`（`count-objects -v`；小仓库的 KB 会四舍五入成 0，对象数才可靠）。全部是信息与原因，没有任何修复动作。

## Tier 3 — 1.6.0 "the document earns its keep" / 让规范真正起作用

### 7. Commit compliance hint / 提交合规提示

Read the selected repository's conventions document, extract the rules that can be checked mechanically (subject length, imperative mood prefix, Conventional Commits type list) and report "6 of the last 20 commits do not match". Local, no model, no network. This is what turns a written document into something visible.

### 8. Workspace-wide document / 工作区总纲

1.3.0 already lets a container document reach the repositories inside it; what is missing is the entry point. Add the conventions strip at the container level with a "create workspace document" action writing `.dsh/GIT_CONVENTIONS.md` (or the root one) from the same six frameworks.

### 9. Conventions upgrade preview / 规范升级预览

Choosing a framework while a document exists currently overwrites it with `force`. Show a diff preview first (missing sections, paragraphs that would be replaced) and only write after confirmation.

## Not planned / 不做

- **Hover cards.** Tried and removed on request; the pinned commit card is the better answer.
- **A full diff viewer.** better-sidebar already ships one; the plugin links to it instead of duplicating it.
- **Branch switching and worktrees inside the tab.** Technically possible and deliberately out of scope: the chip's dialog owns those actions.

## Delivery loop / 每个版本的交付动作

1. `node scripts/build-lib.mjs` — regenerate `lib/client.js` (tab region) and `lib/index.js` (host regions).
2. `node scripts/patch-host.mjs` — idempotent host patches.
3. `node --check lib/client.js && node --check lib/index.js`.
4. `node scripts/validate-lib.mjs` — locale keys and fork identifiers.
5. `node scripts/test-host.mjs` — offline host end-to-end (71 checks).
6. `node scripts/preview-tab.mjs --repos ../.demo/data/repos.json --graph ../.demo/data/graph-graph-demo.json --graph ../.demo/data/graph-dsh-git-graph-src.json --focus graph-demo` — offline client end-to-end.
7. Bump `package.json`, update `README.md` / `README.zh.md` / `DEVELOPMENT.md`, `npm pack --pack-destination ../dsh-git-graph-dist/<version>`, copy to a version-less `dsh-git-graph-sidebar.tgz`.
8. Commit, push, create the GitHub release, upload the asset, verify the mirror checksum, `remove_bundle` + `install_bundle`, restart DSH.

Compatibility rules: host routes only ever get added; locale keys only ever get added; a repository response may gain fields but never lose one.
