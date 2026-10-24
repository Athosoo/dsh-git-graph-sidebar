## 1.5.0 — 多仓库总览 / 分支清理提示 / 仓库体检

### 新增功能
- **多仓库总览**：工具栏多了「总览」，把当前工作区里发现的每个仓库列成一行——分支、冲突数、改动文件数、领先/落后上游多少提交、最近一次活动。按「需要处理的程度」排序（冲突 → 有改动 → 落后上游 → 没有分支 → 路径），点一行直接回到该仓库的图谱。
- **可清理分支提示**：总览里点「分支与体检」，列出仓库的本地分支，标出已合并进基线（`main`，没有就 `master` / `trunk` / `develop` / 当前分支）的分支，和还剩多少提交没合并。只是提示，不会删任何分支。
- **仓库体检**：同一处并列显示分离头指针、没有上游的分支、stash 数、超过 1 MB 的未跟踪文件、`.git` 体积。

### Host 改动
- 新路由 `/git/cleanup`（分支整理报告）与 `/git/health`（仓库体检），均为只读。
- `/git/repos` 的每个条目新增 `activity`（最近提交时间，秒）与 `upstream`（`{ name, ahead, behind }`，无远端时为 `null`）。
- 客户端新增 `cleanupBranches(path)` / `repoHealth(path)` 两个 `GitApi` 方法。

### 升级
1. 下载下面的 `dsh-git-graph-sidebar.tgz`。
2. 在插件管理里重新安装（或用 `file:` 依赖指向该 tgz）。
3. **重启 DSH**——这次带 host 新路由，刷新页面不会生效。

### English
- **Workspace overview**: the toolbar's new *Overview* button lists every discovered repository with branch, conflicts, changed files, ahead/behind its upstream and last activity, sorted by what needs attention. Clicking a row jumps back to that repository's graph.
- **Branch cleanup hints**: expand *Branches & health* on a row to see which local branches are already merged into the base branch, and how many commits the others still carry. Hints only — nothing is deleted.
- **Repository health**: detached HEAD, branches without an upstream, stash count, untracked files above 1 MB and `.git` size.
- New read-only host routes `/git/cleanup` and `/git/health`; `/git/repos` entries now carry `activity` and `upstream`. Restart DSH after upgrading — the host half is not hot-reloaded.
