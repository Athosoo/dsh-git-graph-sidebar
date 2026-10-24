# Handover — dsh-git-graph-sidebar

> 交接文档。目标读者：接手这个项目的下一个会话（人或 AI）。
> 读这一份就够了：现状、改哪里、怎么发、坑在哪、下一步做什么。
> 最后更新：2026-10-24 19:20 (+08)。

## 0. 一句话状态

插件 **已开源**（`https://github.com/Athosoo/dsh-git-graph-sidebar`，Apache-2.0），**1.4.0 已发布、已推送、已装进 `desktop`**（Tier 1：复制回滚提示、提交搜索 + 引用筛选、导出独立 SVG）。**1.5.0（Tier 2：多仓库总览、分支清理提示、仓库体检）已发布、已推送、已装进 `desktop`**（host 95/95、客户端预览全过）。市场收录 PR 仍等 **今晚 22:07 (+08)** 之后跑一条脚本。

## 1. 这个插件是什么（读懂需求演进）

起点（用户原话）：「修改GIT-graph插件，令它能够显示在better sidebar里面，且支持多级仓库处理，即从当前工作区根目录往下每个目录的各自仓库，评估工作方案。」

演进出来的实际产品形态：
1. **多级仓库发现**：从工作区根往下三层，找出根仓库与所有嵌套仓库（跳过 `node_modules`/`dist`/`build`/`out`/`coverage`/`target`/`vendor` 与点目录），上限 200，60 秒缓存。
2. **better-sidebar 里的「仓库图谱」tab**：仓库树（层级关系）+ 真 SVG 泳道图谱 + 提交详情卡 + 全屏视图 + 缩放。
3. **静默热重载**：SSE（`git/events`）+ 20 秒轮询 + 窗口聚焦刷新，刷新不清空、不闪；关闭再打开走模块级缓存直接出图。
4. **给 AI 的交接**：复制提交信息 / 复制 SHA / **复制回滚提示**（三种命令 + 风险）。
5. **Git 规范体系**：选定框架（六套）→ 写 `GIT_CONVENTIONS.md`（空壳/模板）→ 状态带（已定稿/草稿/未建立）→ 通过 `systemPrompt` **每步注入模型**，且**就近继承**（仓库自己的优先，其次祖先容器仓库，最后给容器下的仓库指针清单）。
6. **一键初始化仓库**：工作区根不是仓库时，tab 提供 `git init`（可选初始分支 main/master/trunk/develop），建完自动接规范流程。

明确**不做**：tab 内切分支/worktree（在 chip 的对话框里）、完整 diff 查看器、悬停卡（做过，按要求删了）。

## 2. 环境与路径

| 东西 | 位置 |
| --- | --- |
| 插件源码（git 仓库，工作副本） | `C:\Users\18316\Documents\deepseek-harness\default-workspace\dsh-git-graph-src` |
| 打包产物 | `...\default-workspace\dsh-git-graph-dist\<version>\`（含带版本与无版本两个 tgz） |
| 演示/测试用仓库 | `...\default-workspace\graph-demo`（13 提交、4 泳道、3 次合并、`feature/c` 故意不合并）、`...\default-workspace\dsh-git-graph-smoke\{alpha,nest/beta}` |
| 真实图谱数据（预览/断言用） | `...\default-workspace\.demo\data\repos.json`、`graph-*.json` |
| 开发期脚本/截图 | `...\default-workspace\.demo\`（`patch-*.py`、`probe-*.mjs`、`fetch-graphs.mjs`、`data\*.png`） |
| DSH profile | `C:\Users\18316\.dsh\profiles\desktop`（`package.json:31` bundles 含包名；`:45` 依赖为 `file:...dsh-git-graph-dist/1.4.0/dsh-git-graph-sidebar.tgz`） |
| 市场收录克隆 | `...\default-workspace\awesome-dsh-plugin`（fork，分支 `add/athosoo-dsh-git-graph-sidebar`） |
| 市场投稿材料 | `...\default-workspace\.market-pr\{pr-body.md,open-pr.sh}` |

环境注意：
- GUI 端口**每次重启都变**（历史上 65206/56515/50836/52702/56428/56004），一律以 runtime context 为准。
- `host` 半边改动**必须重启 DSH** 才生效；客户端 bundle `Ctrl+R` 即可。
- 审批策略是 `never`，不能请求沙箱升级；文件策略 danger-full-access。
- 本机 SSH/直连 GitHub 网页被墙，但 **`api.github.com` 现在直连可用**；git 推送走 `git gpush`（已把 `github.com` insteadOf 到 `ghfast.top`，token 从 Windows 用户环境变量 `GH_TOKEN` 读）。`gh-proxy.com` 对需要认证的 API 会返回代理自己的身份，**别用于认证请求**。

## 3. 代码地图（只改这几个文件）

```
src/client/graph/SidebarTab.js   ← tab 的唯一真源（约 2660 行）。所有 UI/交互都改这里
src/host/conventions.js          ← host 规范体系 + prompt 注入 + repoInit（约 879 行）
src/host/branches.js             ← 总览/分支清理/体检的 host 模块（约 310 行，build-lib 拼进 lib/index.js）
scripts/build-lib.mjs            ← 把上面三个模块拼进 lib/*.js，补 branches 的 region 头，并幂等插入 GitApi 方法与 locale 键
scripts/patch-host.mjs           ← 21 处幂等 host 补丁（imports/Config/路由/prompt/扫描挂载）
scripts/validate-lib.mjs         ← 校验 t("key") 都能解析 + 分叉标识符都有定义
scripts/test-host.mjs            ← 离线 host 端到端（95 项断言，假 ctx + 真 git）
scripts/preview-tab.mjs          ← 离线客户端端到端（假 React/DOM/fetch，跑真实 apply）
scripts/prepend-shared.mjs       ← 从干净副本抽 tab 共享脚手架（很少用）
lib/client.js / lib/index.js     ← **构建产物**：`//#region` 之间的内容由 build-lib 生成，永不手改
README.md / README.zh.md / DEVELOPMENT.md / ROADMAP.md / NOTICE / cordis.patch.yml / icon.svg / assets/
```

关键标识符（grep 用）：`SIDEBAR_TAB_*`（样式与常量）、`sidebarTab*`（函数）、`GitGraphSidebarTab`（组件）、`git-conventions`（prompt section 名）、`CONVENTION_FRAMEWORKS`、`repoScan*`、`gatePathKey`、`branchReport`、`repoHealth`、`repoAugment`、`sidebarTabOverview*`。

## 4. 构建与测试（改完必须全过）

```bash
cd "C:/Users/18316/Documents/deepseek-harness/default-workspace/dsh-git-graph-src"
node scripts/build-lib.mjs      # → spliced 2660 / 879 / 329 lines（tab / conventions / branches）
node scripts/patch-host.mjs     # → applied 0, already present 21（幂等）
node --check lib/client.js && node --check lib/index.js
node scripts/validate-lib.mjs   # → OK — 155 locale keys resolve, all fork identifiers defined
node scripts/test-host.mjs      # → 95/95 checks passed
node scripts/preview-tab.mjs \
  --repos ../.demo/data/repos.json \
  --graph ../.demo/data/graph-graph-demo.json \
  --graph ../.demo/data/graph-dsh-git-graph-src.json \
  --focus graph-demo
```

`preview-tab.mjs` 会写出 `preview/graph-tab-{preview,preview-light,states,hero,overview,overview-light}.html`，可截图：

```bash
"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=2 --window-size=452,1040 \
  --screenshot="C:\...\.demo\data\shot.png" \
  "file:///C:/Users/18316/Documents/deepseek-harness/default-workspace/dsh-git-graph-src/preview/graph-tab-hero.html"
```

## 5. 发布与安装（照抄）

1. 改 `package.json` 的 `version`。
2. 更新 `README.md` / `README.zh.md` / `DEVELOPMENT.md`（新功能、路由表、测试说明）。
3. 打包：
   ```bash
   mkdir -p ../dsh-git-graph-dist/<ver>
   npm pack --pack-destination ../dsh-git-graph-dist/<ver>
   cp ../dsh-git-graph-dist/<ver>/dsh-git-graph-sidebar-<ver>.tgz ../dsh-git-graph-dist/<ver>/dsh-git-graph-sidebar.tgz
   ```
   （无版本名那份是给 Release 资产用的：`releases/latest/download/<名字>` 只按字面文件名取。）
4. `git add -A && git commit -m "..." && git gpush`。
5. 建 tag + Release（**payload 必须写文件、用 JSON**）：
   ```bash
   python - <<'PY'
   import json,pathlib
   pathlib.Path("rel.json").write_text(json.dumps({"tag_name":"v<ver>","name":"v<ver>","body":"<正文>"}),encoding="utf-8")
   PY
   export GH_TOKEN="$(powershell.exe -NoProfile -Command '[Environment]::GetEnvironmentVariable("GH_TOKEN","User")' | tr -d '\r\n')"
   curl -sS -X POST https://api.github.com/repos/Athosoo/dsh-git-graph-sidebar/releases \
     -H "Authorization: token $GH_TOKEN" -H "content-type: application/json" --data-binary @rel.json
   curl -sS -X POST "https://uploads.github.com/repos/Athosoo/dsh-git-graph-sidebar/releases/<id>/assets?name=dsh-git-graph-sidebar.tgz" \
     -H "Authorization: token $GH_TOKEN" -H "content-type: application/gzip" \
     --data-binary @../dsh-git-graph-dist/<ver>/dsh-git-graph-sidebar.tgz
   ```
   校验（走镜像）：`https://ghfast.top/https://github.com/Athosoo/dsh-git-graph-sidebar/releases/latest/download/dsh-git-graph-sidebar.tgz`，比 sha256。
6. 本地换装（`plugin_manager`）：`remove_bundle` → `install_bundle target=<工作区内绝对路径的 tgz>`，返回 `application:"applied"`。
7. 告诉用户：host 改动要**重启 DSH**；纯客户端改动 `Ctrl+R`。

## 6. 版本历史

| 版本 | 内容 |
| --- | --- |
| 1.0.0 | 开源首发：多级仓库发现 + better-sidebar tab（SVG 泳道）+ 复制提交信息 |
| 1.0.1 | 连线改正交折线（竖线 + 圆角横移），删掉误造成「花括号」的行首色带 |
| 1.0.2 | 常驻提交详情卡、悬停简略信息、复制给 AI、全屏视图、缩放真放大字号 |
| 1.1.0 | Git 规范：空壳/六套框架/状态带/`/git/conventions` 与 `/git/convention` |
| 1.1.1 | 按要求删除悬停卡 |
| 1.1.2 | 静默刷新：SSE + 轮询 + 比较器，刷新不再整块清空 |
| 1.1.3 | 关闭重开走缓存不空白；仓库选中改淡青蓝；**规范经 `systemPrompt` 每步注入** |
| 1.2.0 | 一键 `git init`（`/git/init`，可选初始分支） |
| 1.3.0 | 规范**就近继承** + 容器仓库缺文档时回退为指针清单（有界 BFS，三层） |
| 1.4.0 | Tier 1 三项：复制回滚提示、提交搜索 + 引用筛选、导出独立 SVG（`git-graph-<repo>.svg`）；已发布并已装 |
| 1.5.0 | Tier 2 三项：多仓库总览（`activity`/`upstream`）、`/git/cleanup` + `/git/health`、分支清理提示与仓库体检；已发布并已装 |

## 7. 1.4.0 的三项改动（已随 1.4.0 发布）

`git status` 应为：`M lib/client.js`、`M scripts/build-lib.mjs`、`M scripts/preview-tab.mjs`、`M src/client/graph/SidebarTab.js`、`M preview/*.html`、`?? ROADMAP.md`（+ 本次新增的 `HANDOVER.md`）。

**第 1 项 复制回滚提示**
- `sidebarTabRollbackText(commit, repo, branch, commitsAbove, t)`：输出「仓库/Path/当前分支/提交/SHA/提交时间/引用/该提交之后还有 N 个提交/三种候选命令+风险/请先确认」。
- 详情卡按钮 `data-gitgraph-action="copy-rollback"`，`copiedKey === "rollback"` 时显示「已复制」。
- 预览断言：点击后抓 `navigator.clipboard` 文本，含 `git revert `/`git reset --hard `/`git cherry-pick `/`Path: `（实测 417 字符）。

**第 2 项 搜索 + 引用筛选**
- 状态 `query`、`mutedRefs`；派生 `refNames`（跳过 `HEAD -> ` 别名，上限 `SIDEBAR_TAB_FILTER_REFS_MAX = 12`）、`mutedCount`、`visibleCommits`、`filtering`。
- `visibleCommits`：先按启用 ref 做父链可达集，再按 query 命中集 + **页内祖先**取并；`lanes`/`laneCount`/`geometry`/`rows`/两处计数全部改用它。
- UI：`data-gitgraph-filter`（输入框 `data-gitgraph-search` + 引用 chip `data-gitgraph-ref-filter`/`data-gitgraph-ref-muted`）、`data-gitgraph-filtered` 计数、`data-gitgraph-nomatch` 空态。
- 预览断言：`changelog` 命中 13→9 行并显示计数；清空恢复 13；逐个点引用直到有一个真隐藏行（`feature/c` 藏 2 行），取消后恢复 13。
- **语义注意**：已合并分支（如 `feature/a`）的提交仍可从 main 到达，所以它的 toggle 合法地不减行——测试是「遍历直到找到真减行的 ref」，别改回「取第一个」。

**第 3 项 导出图片**
- `sidebarTabExportSvg({view, repo, commits, lanes, geometry, rowHeight, pinned, dark, t, generatedAt})` 生成一份独立 SVG（`xmlns`/显式 `width`+`height`/`viewBox`/`role="img"`/`<title>`），配色来自 `sidebarTabExportPalette(dark)`，`sidebarTabIsDark()` 读 `document.body[data-ds-dark-theme]`（`matchMedia` 兜底）。**不引用任何 CSS 变量或类名**，导出文可脱离应用直接打开。
- **行距必须等于泳道几何的 pitch**：`Math.min(72, Math.max(24, Math.round(rowHeight)))`。曾用 `Math.max(34, rowHeight)`，面板缩小到 27px 后节点与行逐行漂移（实测导出 `cy` 40.5/67.5 而导出按 34 排）。
- 每行 `<g data-gitgraph-export-row="N">`；固定提交多一个 `data-gitgraph-export-pinned="true"` 底色；ref 用 `<tspan>`，当前分支用 accent 加粗；无 ref 时只留作者；主题过长按宽度截断加 `…`；页脚左 `sidebar.exportNote`、右仓库地址。
- `sidebarTabSaveSvg(name, svg)`：`Blob` + `URL.createObjectURL` + 隐藏 `<a download>`；任何一步抛错即退化为 `sidebarTabCopy(svg)`，返回 `"download" | "copy" | "failed"`。按钮 `data-gitgraph-action="export"`，成功显示「已导出 / 已复制 SVG」2.2 秒。
- 预览断言：以 `<svg` 开头、含 `xmlns`/`viewBox`/`<title>`/仓库名、无 `var(--`、`data-gitgraph-export-row` 数 = 面板行数、`data-gitgraph-export-pinned` 存在、相邻圆 `cy` 差 = 面板行高、浅/深背景色正确。
- 调试开关：`EXPORT_SVG_PATH=<path>` 把导出结果落盘（`node scripts/preview-tab.mjs …`）；`EXPORT_DARK=1` 让假 `document.body.hasAttribute("data-ds-dark-theme")` 返回真，可离线检查深色导出。

## 7.1 1.5.0 的三项改动（Tier 2，已随 1.5.0 发布）

**host 新模块 `src/host/branches.js`**（由 build-lib 拼进 `//#region src/host/branches.ts`，位置紧跟 repos region、在 `registerGitRoutes` 之前）
- 常量：`BRANCH_REPORT_LIMIT=120`、`BRANCH_REPORT_CONCURRENCY=4`、`BRANCH_STALE_DAYS=30`、`REPO_AUGMENT_CONCURRENCY=4`、`HEALTH_UNTRACKED_LIMIT=400`、`HEALTH_BIG_BYTES=1048576`、`HEALTH_UPSTREAM_LIMIT=20`、`BRANCH_BASE_CANDIDATES=["main","master","trunk","develop"]`。
- `repoGit(service, root, argv)`：跑一条 git，任何失败一律 `null`——单个仓库异常绝不拖垮整次扫描。
- `repoAugment(service, entries)`：给扫描条目就地补 `activity`（秒）与 `upstream`（`{name, ahead, behind}`；无远端保持 `null`）。
- `branchReport(service, path)` → `{root, branch, base, truncated, branches:[{name,current,upstream,lastCommit,stale,base,merged,unmerged}]}`；基线取 `BRANCH_BASE_CANDIDATES` 里第一个存在的分支，否则当前分支、再否则第一个分支；非基线分支并发 4 跑 `rev-list --count <base>..<branch>`，0 即 `merged: true`。
- `repoHealth(service, path)` → `{root, branch, detached, dirtyFiles, conflicts, operationInProgress, stash, branches, noUpstream[], noUpstreamCount, stale[], untracked, untrackedScanned, bigUntracked[], gitObjects, gitBytes, checkedAt}`。
- 两个只读路由：`/git/cleanup`、`/git/health`（gate 与其它视图一致，非仓库返回 `FAIL(MALFORMED_VIEW)`）；GitApi 方法 `cleanupBranches(path)`、`repoHealth(path)`。
- **命名注意**：别用 `/git/branches` 或 `branches()`——上游已有同名路由与方法，`switch` 会让前一个 case 胜出、`API_METHODS` 的 guard 也会误判「已存在」而跳过注入。

**客户端 `src/client/graph/SidebarTab.js`**
- 状态：`overviewOpen`（经 `sidebarTabCached(sessionCwd, "overviewOpen")` 记住，重开 tab 保住状态）、`overviewDetail`、`overviewDetailRef`、`overviewInflight`。
- 纯函数：`sidebarTabOverviewRank/Compare`（排序键依次 conflicts → dirty → behind → 有无分支 → relPath）、`sidebarTabOverviewAgo`、`sidebarTabOverviewBytes`、`sidebarTabOverviewDetailRows`。
- 工具栏按钮 `data-gitgraph-action="overview"`：打开时工具栏只留「刷新」+「返回图谱」（`toolbarItems` 过滤），文案在 `sidebar.overview` / `sidebar.overviewBack` 间切换。
- `overviewPanel`：打开时替换 `treeHeader`/`treeList`/`status`/`conventionsBar`/`initBar`/`filterBar`/`body`/`detail`/`moreChild`（全是 `overviewPanel === null ? X : null`，否则会留下空壳元素）。行 `data-gitgraph-overview=<relPath>`，点行（或 Enter/Space）关闭总览并 `choose(path)`；「分支与体检」按钮 `data-gitgraph-overview-detail=<path>` 懒加载两个路由，详情块 `data-gitgraph-overview-detail-body`。
- 21 个新 locale 键（zh/en）：`sidebar.overview`、`overviewBack`、`overviewHint`、`overviewClean`、`overviewDirty`、`overviewConflicts`、`overviewAhead`、`overviewBehind`、`overviewUpstream`、`overviewDetached`、`overviewNow`、`overviewMinutes`、`overviewHours`、`overviewDays`、`overviewDetail`、`overviewMerged`、`overviewUnmerged`、`overviewMeta`、`overviewBase`、`overviewFailed`、`overviewEmpty`；`validate-lib` 现在报 155 键。
- 预览：`preview-tab.mjs` 新增 `git/cleanup` + `git/health` stub、给 `--repos` 条目装饰确定性的 `activity`/`upstream`、总览测试块（默认不显示 → 点开 → 行数 = 仓库数 → 排序与测试内独立重算一致 → 工具栏只剩 refresh+overview → 详情加载出 merged/unmerged/health → 点行回到图谱），并写出 `preview/graph-tab-overview.html`（+ `-light`）。

## 8. 待办清单（按优先级）

1. ~~发 1.5.0~~ **已完成**（commit `2dcb974`、tag `v1.5.0`、Release 资产 `dsh-git-graph-sidebar.tgz` 834240 字节、`desktop` 已装 1.5.0）；用户需重启 DSH 才能用上 host 新路由。
2. **市场收录 PR**：门槛 = 仓库满 1 天 = `2026-10-24T22:07:00+08:00`。之后：
   ```bash
   bash "C:/Users/18316/Documents/deepseek-harness/default-workspace/.market-pr/open-pr.sh"
   ```
   （先 `--check` 看状态；脚本自带门禁，通过后自动开 PR，head = `Athosoo:add/athosoo-dsh-git-graph-sidebar`，只含 `data/plugins/Athosoo__dsh-git-graph-sidebar.yml` 8 行。）
3. **Tier 3（1.6.0）**：提交合规提示、工作区总纲一键创建（`.dsh/GIT_CONVENTIONS.md`）、规范升级差异预览。
4. 可选打磨：仓库很多时总览改虚拟滚动；总览里标出「比发现深度更深」的仓库；`activity` 改用 `status.head` 的提交时间以省掉一次 `log -1`。

## 9. 坑与教训（每条都真踩过）

1. **绝对不要用 `link:` 装工作区目录做插件。** `remove_bundle` 会把软链目标目录**清空**（曾把整个工作副本删掉）。一律 `npm pack` 到 `dsh-git-graph-dist/<ver>/` 后按 `file:...tgz` 安装。
2. **Python 写文件必须 `newline="\n"`**，否则 CRLF 会让 build-lib 的 `\n//#endregion` 标记匹配失败。
3. **不要在 shell 字符串里写含反引号/`$`的 payload**：一次 `echo` 里的 `` `git init` `` 被执行，在工作区根建了一个假 `.git`。payload 一律先写文件再 `--data-binary @file`。
4. **GitHub Release API 只吃 JSON**（`--data-binary`），`-F` multipart 报 `Problems parsing JSON`；创建前先用 `POST /git/refs` 建 tag 更稳；资产名必须**无版本**。
5. **`desktop` profile 被 Electron 独占**：`dsh plugin --profile desktop add ...` 会报 `managed exclusively`；装 tgz 只能用 `plugin_manager` 或应用内插件页。
6. **host 半边不热更**：新路由/`systemPrompt` 注入必须重启 DSH；`/git/*` 在未加载时返回 405/404。
7. **better-sidebar 关闭 tab 会卸载组件**（`split-pane.tsx` 注释明说），所以重开必须靠 `SIDEBAR_TAB_CACHE` 模块级缓存（按 `sessionId|cwd`，保留 6 个会话）。
8. **`preview-tab.mjs` 的假运行时**：`mount.tree` 只在 `render()` 时刷新——点击后必须 `await mount.render()` 才能找到新节点；`setInterval` 要 `unref()` 否则进程挂住；`<select value>` 要序列化成 `selected`；受控 `<input value>` 需要序列化 `value`。
9. **`validate-lib.mjs` 是标配**：它抓「t() 用了但字典没有」和「分叉标识符没定义」——只有 `node --check` 抓不到的自由变量错误靠它。
10. **`test-host.mjs` 的 `equal()` 第三参是 detail 不是期望值**，判断要用 `check()`；`git()` 辅助不返回 stdout。
11. **gh-proxy.com 对认证 API 会伪装成别人**（返回代理账号身份），认证请求直连 `api.github.com`。
12. **端口会变**：每次 DSH 重启 GUI 端口都不同，探测 `/git/repos` 前先读 runtime context，且 curl 超时要给足（冷启动 3 秒会 000）。
13. **`lib/*.js` 的 region 内永手改**：手改会在下次 `build-lib.mjs` 被覆盖；要改就改 `src/**` 或 `scripts/patch-host.mjs`。
14. **`build-lib.mjs` 的字典插入是按字典块判定的**（zh/en 各自），早期版本曾因为「全文件查 key」导致 en 漏插 4 个键。
15. **长命令会被截断**：`ops_bash` 一次塞太长的 `cat > x <<'PY' … PY` 会被砍掉尾部（heredoc 未闭合，写出的脚本只剩前若干行）。长脚本要分块 `python - <<'PY'` 追加写。
16. **多层引号里的反斜杠会掉一层**：Python 三引号里的 `\\n` 生成出来是真换行（`out.join("` + 换行 → `SyntaxError: Invalid or unexpected token`），正则 `[\\/]` 也会退化成 `[\/]`（匹配不到反斜杠）。写这类字符用 `chr(92)`/`chr(10)` 拼，别依赖转义层数。

17. **新路由/新方法先 grep 上游有没有同名**：`/git/branches` 和 `GitApi.branches()` 都是上游已有的，同名会让 `switch` 只命中前一个 case、`API_METHODS` 的 guard 误判「已存在」而跳过注入。最终用 `/git/cleanup` + `/git/health`、`cleanupBranches()` + `repoHealth()`。
18. **region 头归 build-lib 所有**：patch-host 若也插 `//#region src/host/branches.ts`，第二次 build 会留下一个空 region（实测重复出现两次）。现在 build-lib 发现缺头时自己插 `region + //#endregion` 再 splice，patch-host 只负责路由与扫描挂载（21 处）。
19. **按锚点切文件后立刻 `node --check`**：一次用 `s.index(...)` 切 patch-host 的新增段，把相邻两个 `patch(` 调用一起吞掉，`node --check` 报 `missing ) after argument list`——切完先查语法再往下做。
20. **`git count-objects -v` 的 KB 会四舍五入成 0**：小仓库 `size: 0`，别断言 `gitBytes > 0`，用对象数（`count` + `in-pack`）判断 `.git` 是否读到。

## 10. 下一步照做即可（最短路径）

```bash
cd "C:/Users/18316/Documents/deepseek-harness/default-workspace/dsh-git-graph-src"
# 1) 全链路自检（都应为绿）
node scripts/build-lib.mjs && node scripts/patch-host.mjs
node --check lib/client.js && node --check lib/index.js
node scripts/validate-lib.mjs && node scripts/test-host.mjs
node scripts/preview-tab.mjs --repos ../.demo/data/repos.json   --graph ../.demo/data/graph-graph-demo.json --graph ../.demo/data/graph-dsh-git-graph-src.json --focus graph-demo
# 2) 升 1.5.0 后打包
npm pack --pack-destination "../dsh-git-graph-dist/1.5.0"
# 3) commit + push，建 tag/Release（资产名无版本），换装，让用户重启
# 4) 22:07 之后：bash ../.market-pr/open-pr.sh
```

## 11. 参考索引

- 路线图与逐项验收标准：`ROADMAP.md`（本仓库内）
- 开发说明（布局、构建、发布、host 两处 region）：`DEVELOPMENT.md`
- 用户向文档（中英双语）：`README.md` / `README.zh.md`
- 上游来源与改动归属：`NOTICE`（上游 `@linxin666/dsh-client-ui-git-graph` 0.4.8）
- 方案与早期评估：`...\default-workspace\git-graph-sidebar-multirepo-plan.md`
