# Handover — dsh-git-graph-sidebar

> 交接文档。目标读者：接手这个项目的下一个会话（人或 AI）。
> 读这一份就够了：现状、改哪里、怎么发、坑在哪、下一步做什么。
> 最后更新：2026-10-24 19:45 (+08)。

## 0. 一句话状态

插件 **已开源**（`https://github.com/Athosoo/dsh-git-graph-sidebar`，Apache-2.0），**1.4.0 已发布、已推送、已装进 `desktop`**（Tier 1：复制回滚提示、提交搜索 + 引用筛选、导出独立 SVG）。**1.5.0（Tier 2：多仓库总览、分支清理提示、仓库体检）已发布、已推送、已装进 `desktop`**（host 95/95、客户端预览全过）。**1.6.0（Tier 3：提交合规提示、工作区总纲、规范升级预览）已发布、已推送、已装进 `desktop`**（host 132/132、客户端预览含 tier-3 一节全过；commit `92f15a1`、Release id `422695343`、资产 854388 字节）。市场收录 PR 已提交（`awesome-dsh-plugin#9196`，按维护者四条修正描述后 push 到 `a4521fc`）。

**1.7.3 代码完成、测试全绿、待发版**：主题语言进了规范本身——文档前置元数据支持 `language: zh\|en\|mixed`（写在 `strict:` 之后），选择列表多一行「提交语言」，预览与写入都带上它，`git/compliance` 在语言写死时给违规主题一个 `lang` 原因，注入的提示块始终有一行 `Subject language: …`。顺手修掉两个真 bug：`conventionInsertField()` 重复拼冒号（`status::`）导致语言行永远落到文件顶部；`build-lib.mjs` 的 GitApi 注入改成「先按方法名删除、再按序插回」，避免旧签名残留覆盖新方法。
**1.7.2 已发布、已推送、已装进 `desktop`**：工作区总纲条补上写入反馈——写成功后 `data-gitgraph-workspace-note="written"` 加「工作区规范已写入。」提示（8 秒淡出），写入失败的消息也改在这里显示（以前只落进选中仓库的规范条，工作区条静默）；文档已存在时按钮不再消失：有 `onOpenFile` 就给「打开」，否则给「复制路径」（`sidebar.workspaceDocCopy`）。`build-lib` spliced 2652 行、`patch-host` 24 处、`160` 个 locale 键、host 148/148。 **1.6.1 已发布、已推送、已装进 `desktop`**：工具栏去掉「总览」与「全屏查看」（客户端代码一并删除，只读路由 `/git/cleanup`、`/git/health` 保留），面板字号整体加大一号；commit `f077dd4`、tag `v1.6.1`、Release id `422709234`、资产 844839 字节；`build-lib` spliced 2561 行、`patch-host` 22 处、156 个 locale 键、host 132/132、客户端预览全过。 **1.7.0 已发布、已推送、已装进 `desktop`**（commit `a1c4619`、tag `v1.7.0`、Release id `422753809`、资产 852091 字节）：合规检查接受中文 / 英文 / 中英混排（type 中文别名、全角冒号、大小写与祈使句仅对拉丁首词生效），可选**强约束**模式（写入 `strict: true`，注入提示要求不合规提交先改写），框架选择列表选完自动收起，工具栏与操作按钮换成显式白色底 / 深色字的控制面板皮肤。`build-lib` spliced 2627 行、`patch-host` 24 处、158 个 locale 键、host 148/148。

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
| DSH profile | `C:\Users\18316\.dsh\profiles\desktop`（`package.json:31` bundles 含包名；`:45` 依赖为 `file:...dsh-git-graph-dist/1.5.0/dsh-git-graph-sidebar.tgz`） |
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

关键标识符（grep 用）：`SIDEBAR_TAB_*`（样式与常量）、`sidebarTab*`（函数）、`GitGraphSidebarTab`（组件）、`git-conventions`（prompt section 名）、`CONVENTION_FRAMEWORKS`、`repoScan*`、`gatePathKey`、`branchReport`、`repoHealth`、`repoAugment`、`sidebarTabOverview*`、`commitCompliance`、`conventionPreview`、`workspaceConvention`、`sidebarTabReasonLabel`。

## 4. 构建与测试（改完必须全过）

```bash
cd "C:/Users/18316/Documents/deepseek-harness/default-workspace/dsh-git-graph-src"
node scripts/build-lib.mjs      # → synced GitApi additions (5 blocks) + spliced 2670 / 1455 / 329 lines（tab / conventions / branches）
node scripts/patch-host.mjs     # → applied 0, already present 25（幂等）
node --check lib/client.js && node --check lib/index.js
node scripts/validate-lib.mjs   # → OK — 166 locale keys resolve, all fork identifiers defined
node scripts/test-host.mjs      # → 161/161 checks passed
node scripts/preview-tab.mjs \
  --repos ../.demo/data/repos.json \
  --graph ../.demo/data/graph-graph-demo.json \
  --graph ../.demo/data/graph-dsh-git-graph-src.json \
  --focus graph-demo
```

`preview-tab.mjs` 会写出 `preview/graph-tab-{preview,preview-light,states,hero,overview,overview-light,tier3}.html`，可截图：

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
| 1.6.0 | Tier 3 三项：提交合规提示（`/git/compliance`）、工作区总纲（`/git/workspace-convention`）、规范升级预览（`/git/convention/preview`）；已发布并已装 |
| 1.6.1 | 界面收尾：工具栏只留刷新 / 缩放 / 导出 / 初始化，去掉「总览」与「全屏查看」（只读路由 `/git/cleanup`、`/git/health` 保留）；面板字号整体加大一号；已发布并已装 |
| 1.7.0 | 合规接受中文 / 英文 / 中英混排，可选强约束（`strict: true`），选择列表选完自动收起，控制按钮换白色皮肤；已发布并已装（commit `a1c4619`、Release id `422753809`、资产 852091 字节） |
| 1.7.1 | 纯文档版：把 README 里的「每个仓库 / every repository」改成「往下三层」，代码未变；已发布并已装 |
| 1.7.2 | 工作区总纲写入后的反馈：成功提示、失败消息、以及「打开 / 复制路径」按钮；已发布并已装 |
| 1.7.3 | **[代码完成，待发布]** 主题语言策略：`language:` 字段、选择器、`lang` 合规原因、注入块一行 `Subject language:` |

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

## 7.2 1.6.0 的三项改动（Tier 3，已随 1.6.0 发布）

**host `src/host/conventions.js`（1278 行，build-lib 拼进 `lib/index.js` 的 conventions region）**
- 常量：`CONVENTION_TYPE_VOCAB`（feat/fix/docs/style/refactor/perf/test/build/ci/chore/revert）、`CONVENTION_NON_IMPERATIVE`（added/adds/adding/fixed/…/supporting 等屈折动词）、`CONVENTION_NO_RULES = {maxSubject:null, types:null, lowercase:false, noPeriod:false, imperative:false}`、`CONVENTION_WORKSPACE_DIR = ".dsh"`。
- `parseConventionRules(text)`：只认文档自己写明的规则。长度上限取 `/(\d{2,3})\s*(?:个)?\s*(?:字符|characters|chars)/gi` 的最小值并限定 20–200；type 词表要求反引号里出现至少 3 个已知 type，返回时按词表顺序；小写开头 `lowercase`、不加句号 `noPeriod`、祈使句 `imperative` 靠短语匹配。文档没写的一律不检查。
- `conventionSubjectReasons(subject, rules)` → `["length"|"type"|"case"|"period"|"mood"]` 子集；type 用 `/^([a-z]+)(?:\([^)]*\))?!?:\s+/` 匹配并从剩余主题里剥离后再判大小写/语气。
- `commitCompliance(service, root, docName)`：`repoConventionState` → 读文档（≤64KB）→ `service.runner.run(["log","-20","--format=%H%x00%s"], root)` → `{root, doc, docPath, exists, enforced, checked, failing, rules, offenders:[{oid, subject, reasons}] 最多 6}`。
- `conventionSectionsOf(text)`（按 `^##\s+` 切节，含前言节）、`conventionDiff(current, next)` → `{added, changed, removed, same, sections:[{title,status,dropped,fresh}], removedTitles}`；空当前文档时全部算 `added`（否则会被误判成 changed）。
- `conventionPreview(root, docName, frameworkId)` → `{ok, value:{root, doc, docPath, exists, framework, currentBytes, nextBytes, ...diff}}`，未知框架 `{ok:false, error:{code:"convention-unknown-framework"}}`；**全程只读，不落盘**。
- 工作区总纲：`conventionWorkspaceDocPath(root, docName)` = `<root>/.dsh/<doc>`；`conventionsWorkspaceDocFor(start, docName)` 向上最多 8 层找 `.dsh/<doc>`；`workspaceConventionState(root, docName)`、`async workspaceConvention(root, docName, action, frameworkId, force)`（`state` / `preview` / `write`，`write` 走 `repoWriteConvention(root, ".dsh/" + doc, body, {force})`）。
- 继承：`conventionsDocumentFor(cwd, docName)` 在仓库自己的候选都落空后回退到工作区总纲，返回 `{root, owner, path}`；`owner !== root` 时 `conventionPromptBlockFor` 会写 `- inherited Git conventions` 与 `Inherited from: <dir>`。
- 路由（patch-host 第 13 段 `compliance-routes`，现共 22 处补丁）：`/git/compliance`、`/git/convention/preview`（前两者先 `service.rootAndHead` 取 `snapshot.root`，非仓库 `FAIL(MALFORMED_VIEW)`）、`/git/workspace-convention`（只吃 gate 的 `gated.canonical`，**不需要仓库**；`action` 默认 `"state"`）。
- GitApi（`scripts/build-lib.mjs` 的 `API_METHODS`，guard `"git/compliance"`）：`commitCompliance(path)`、`conventionPreview(path, framework)`、`workspaceConvention(path, payload)`。

**客户端 `src/client/graph/SidebarTab.js`（2991 行）**
- 状态：`compliance`、`upgrade`、`workspaceBusy`、`workspaceDoc`；effect 分别盯 `[selectedKey, scan]`、`[workspaceKey, scan]`，`setUpgrade(null)` 盯 `[selectedKey]`。
- **顺序坑**：`const selectedKey = selected !== void 0 ? selected.path : void 0;` 必须在用到它的 effect 之前声明（原本在 handlers 之后，渲染期依赖数组求值会 TDZ 崩）。
- handlers：`pickFramework(repoPath, frameworkId, exists)`（`exists !== true` 直接写；否则先 `conventionPreview`）、`confirmUpgrade()`、`writeWorkspaceDoc()`。
- UI：`complianceLine`（`data-gitgraph-compliance` = `none|failing|clean`，最多 3 行 offender，原因经 `sidebarTabReasonLabel(t, reason)` 翻成「超长/类型/大小写/句号/语气」）、`upgradePanel`（`data-gitgraph-upgrade` = loading/ready，计数行 + 前 6 个非 `same` 小节 + `conventions-confirm`/`conventions-dismiss`）、`workspaceBar`（`head` 行 + `hint` 行；**别平铺进 column 容器，会把按钮拉成整行**）、`switch-conventions` 按钮（否则已写过的仓库里升级预览不可达）。
- 42 个新 locale 键（zh/en 各 21，含 `sidebar.conventionsSwitch`、5 个原因码）；`validate-lib` 现在报 178 键。
- 预览：`preview-tab.mjs` 新增 `git/compliance`、`git/convention/preview`、`git/workspace-convention` stub 与 `CONVENTION_CALLS`/`WORKSPACE_CALLS`/`WORKSPACE_DOC` 计数器、注入合成条目 `repos-tier3/ruled` 的 tier-3 测试块（断言未确认不写：`CONVENTION_CALLS.length === 0`）、写出 `preview/graph-tab-tier3.html`。

## 7.3 1.7.0 的改动（语言、强约束、收起与皮肤，代码完成待发版）

### 7.3.1 合规接受中文 / 英文 / 中英混排（`src/host/conventions.js`）

- `CONVENTION_TYPE_ALIASES` 把「新增 / 特性 / 功能 → feat」「修复 / 修正 / 缺陷 → fix」「文档 / 注释 → docs」「样式 / 格式 → style」「重构 → refactor」「性能 / 优化 → perf」「测试 → test」「构建 / 打包 → build」「持续集成 → ci」「杂项 / 清理 → chore」「回滚 / 撤销 → revert」映射到规范 type；`normalizeConventionType(name)` 先查词表再查别名，查不到返回空串。
- `parseConventionRules` 的 ticks 正则放宽成 `/`([^`
]{1,16})`/g` 再经 `normalizeConventionType` 过滤；**阈值从「任意 ≥3 个词」改成「合法 type（含别名）出现 ≥3 次」**，所以「type 取值：`feat` / `fix` / `新增`」也算数。`rules.strict = conventionStrictOf(text)`。
- `conventionSubjectReasons` 的 type 正则改成 `/^([\p{L}\p{N}_-]+)(?:\([^)]*\))?!?[:：]\s+/u`——允许中文 type 与全角冒号；比较前先 `normalizeConventionType`；`case` 只在 `/[A-Za-z]/.test(first)` 时才判，`mood` 只在首词是纯 ASCII 时才查英文屈折表，所以中文标题不会被误判；`period` 仍是 `/[.。]$/`。
- `commitCompliance` 多了 `languages: {zh, en, mixed}`（`conventionLanguageOf`）与 `strict`；`conventionRuleSummary(rules)` 生成一行 `Machine-checkable rules: …`，写进注入块的提示里。

### 7.3.2 强约束模式

- 文档里写 `strict: true`（`conventionStrictOf` 认 true / yes / on / 是 / 开 / 强制）。`conventionWithStrict(body, strict)` 负责改写：先删掉所有 `strict:` 行，再插到 `status:` 行之后；`conventionBodyOf(frameworkId, repoName, strict)` 对六套框架都过一遍。
- `conventionPreview(root, docName, frameworkId, strict)` 与 `workspaceConvention(root, docName, action, frameworkId, force, strictMode)` 都透传；`scripts/patch-host.mjs` 的第 14 段（`convention-strict-write`、`workspace-strict-write`）把 `payload.strict` 从 `/git/convention` 与 `/git/workspace-convention` 接到 `conventionBodyOf` / `workspaceConvention`。
- 注入提示：strict 文档追加「This document is strict … never commit a message that breaks them … Subjects may be Chinese, English or a mix of both - only the rules below decide.」，并附上 `conventionRuleSummary` 那一行。
- 客户端 `GitApi.conventionOptions(path, framework, force, strict)`（`scripts/build-lib.mjs` 的 `API_METHODS`，**guard 必须选只出现在注入代码里的子串** `conventionOptions(path, framework, force, strict)`，否则会被 tab 源码里的调用点误判成「已存在」）。

### 7.3.3 选择列表自动收起

- `writeConvention` 成功后 `setPickerOpen(false)`；`pickFramework` 走「已存在文档」分支时也在 `setUpgrade(...)` 之前 `setPickerOpen(false)`。依赖数组跟着加上 `strictMode`。

### 7.3.4 控制按钮的白色皮肤（`src/client/graph/SidebarTab.js`）

- 新增两个 CSS 变量，写在 `SIDEBAR_TAB_CSS` 里：`[data-gitgraph-sidebar-tab]{--dsh-gg-ctl-bg:#ffffff;--dsh-gg-ctl-fg:#14181f;--dsh-gg-ctl-bd:rgba(20,24,31,0.16)}`，深色主题用 `body[data-ds-dark-theme] [data-gitgraph-sidebar-tab]{--dsh-gg-ctl-bg:rgba(255,255,255,0.06);--dsh-gg-ctl-fg:#eef2f7;--dsh-gg-ctl-bd:rgba(255,255,255,0.22)}` 覆盖。
- `SIDEBAR_TAB_BUTTON`、`SIDEBAR_TAB_ZOOM`、`SIDEBAR_TAB_DETAIL_BUTTON` 的背景 / 边框 / 文字都改成 `var(--dsh-gg-ctl-bg, #ffffff)`、`var(--dsh-gg-ctl-bd, var(--dsw-alias-border-l2))`、`var(--dsh-gg-ctl-fg, #14181f)`——**fallback 必须能单独在白色底上成立**，否则样式表没注入时会出现白底浅字。
- 框架卡片保持 `--dsw-alias-bg-layer-2`（卡片不是按钮）；虚线面板与「强约束」药丸改用 `--dsh-gg-ctl-bd`。
- `scripts/preview-tab.mjs` 的静态页 shell 里同步补上这三个变量（亮色 / 深色两处），否则预览页会白底浅字。

## 7.4 1.7.3 的改动（主题语言策略）

### 7.4.1 host：字段、解析与注入（`src/host/conventions.js`）

- 字段读写全按行解析，不写正则转义：`conventionFieldValue(body, key)`、`conventionDropField(body, key)`、`conventionInsertField(body, line, keys)`（字段名可带或不带冒号，内部 `replace(/:+$/, "")` 归一）。
- `conventionHasChinese(text)`（`codePointAt` 判 `0x4e00–0x9fff`）、`conventionDocLanguageOf(text)`（`zh|cn|chinese|中文|中|汉语` → `zh`；`en|english|英文|英|英语` → `en`；其余 `mixed`）、`conventionLanguageLine(language)`（注入块那一行）、`conventionWithLanguage(body, language)`（插到 `strict:` 后，否则 `status:` 后，否则置顶）。
- `parseConventionRules()` 的规则对象新增 `language: "mixed"` 与 `languageStated: false`；`conventionRuleSummary()` 在语言写死时追加 `subject written in Chinese only` / `in English only` / `in Chinese, English or a mix`。
- `conventionSubjectReasons()`：`languageStated && language === "en" && conventionHasChinese(text)`，或 `languageStated && language === "zh" && !conventionHasChinese(text)` → 原因 `lang`。
- `conventionBodyOf(frameworkId, repoName, strict, language)`、`conventionPreview(root, docName, frameworkId, strict, language)`、`workspaceConvention(root, docName, action, frameworkId, force, strictMode, languageMode)` 全部透传。
- `conventionPromptBlockFor()` 在 `Machine-checkable rules:` 之前固定推入 `conventionLanguageLine(...)`，即注入块里始终有一行 `Subject language: …`。

### 7.4.2 路由补丁（`scripts/patch-host.mjs` 第 15 段，共 25 处）

- `convention-preview-flags`：预览也带 `strict` 与 `language`（预览此前从不传 strict，属顺带修好的疏漏）。
- `convention-language-write`：`conventionBodyOf(framework, basename(snapshot.root), policy.strict, policy.language)`。
- `workspace-language-write`：`workspaceConvention(..., policy.strict, policy.language)`。
- 第 14 段的两个 strict 补丁被第 15 段取代，已删除；`patch()` 现在对 `case "/git/..."` 类锚点自己推导 guard，并在写盘前断言同名 `case` 唯一。

### 7.4.3 客户端（`src/client/graph/SidebarTab.js`）

- 新状态 `const [conventionLang, setConventionLang] = react.useState("mixed");`；`writeConvention` 与 `pickFramework` 都把它传给 `conventionOptions(...)` / `conventionPreview(...)`，依赖数组加 `conventionLang`。
- picker 里 `strictRow` 之后是 `langRow`：`h("div", {key: "lang-row", style: SIDEBAR_TAB_STRICT_ROW}, [标签 span].concat(["zh", "en", "mixed"].map(...)))`，按钮带 `data-gitgraph-lang`、`aria-pressed`，选中样式复用 `SIDEBAR_TAB_STRICT_ON`。
- `sidebarTabReasonLabel()` 增加 `lang` → `sidebar.reasonLang`。

### 7.4.4 测试

- `scripts/test-host.mjs` 第 [13] 段新增 `repos/langzh`（文档 `language: zh`，4 个提交含一个英文主题）：断言 `rules.language === "zh"`、`languageStated === true`、`failing === 1`、原因含 `lang`、注入块含 `Subject language` 与 `Chinese only`、写入 `language: "en"` 后出现 `language: en`、`strict: true` 与 `language: mixed` 同时写入时顺序为 `status → strict → language` 且只有一处 `language:`。
- `scripts/preview-tab.mjs`：三个 `data-gitgraph-lang` 按钮、默认 `mixed` 被按下、点「中文」后 `aria-pressed` 变化、写入 payload 的 `language === "zh"`。
- 结果：host **161/161**、preview 全绿、**166** locale 键、`patch-host` **25** 处。

### 7.4.5 两个必须记住的坑

- `conventionInsertField()` 的 key 参数本身已带冒号，早期实现又拼了一个 → `status::`，`startsWith` 永不命中，语言行被塞到文件第一行。任何「字段名 + 冒号」的拼接都要先归一。
- `build-lib.mjs` 的 GitApi 注入不能只靠 `includes(guard)`：改了签名后 guard 变、旧方法留下，**对象字面量里后定义的旧方法赢**（`conventionOptions` 4 参数盖住 5 参数）。现在实现是 `stripMethod()`（连带删除前面的文档注释，收尾标记 `
			}` 是 5 个字符）+ 按序插回 `API_ANCHOR` 之后。

## 8. 待办清单（按优先级）

1. ~~发 1.5.0~~ **已完成**（commit `2dcb974`、tag `v1.5.0`、Release 资产 `dsh-git-graph-sidebar.tgz` 834240 字节、`desktop` 已装 1.5.0）。
2. ~~发 1.6.0~~ **已完成**（commit `92f15a1`、tag `v1.6.0`、Release id `422695343`、资产 `dsh-git-graph-sidebar.tgz` 854388 字节、`desktop` 已装 1.6.0）；用户需重启 DSH 才能用上三条新路由。原始步骤留档：
   - `package.json:3` → `1.6.0`（唯一要改的版本号）；
   - 跑 §10 的全链路自检（应得 `spliced 2991 / 1278 / 329`、`already present 22`、`178 locale keys`、`132/132`、预览 9 节全过）；
   - `mkdir -p ../dsh-git-graph-dist/1.6.0 && npm pack --pack-destination ../dsh-git-graph-dist/1.6.0`，并复制一份无版本名；
   - commit（`feat(conventions): commit compliance, workspace document and upgrade preview (tier 3)`）→ `git gpush` → tag `v1.6.0` → GitHub Release（资产名 `dsh-git-graph-sidebar.tgz`）；tag 的 sha 必须用 `git rev-parse v1.6.0` 现取，别手写；
   - 换装 `desktop`：`node "C:/Users/18316/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/pnpm/bin/pnpm.mjs" add "file:C:/Users/18316/Documents/deepseek-harness/default-workspace/dsh-git-graph-dist/1.6.0/dsh-git-graph-sidebar.tgz"`（先备份 profile 的 `package.json`）；
   - 让用户**重启 DSH**（三条新路由是 host 侧，不重启不生效）。
3. **市场收录 PR**：门槛 = 仓库满 1 天 = `2026-10-24T22:07:00+08:00`。之后：
   ```bash
   bash "C:/Users/18316/Documents/deepseek-harness/default-workspace/.market-pr/open-pr.sh"
   ```
   （先 `--check` 看状态；脚本自带门禁，通过后自动开 PR，head = `Athosoo:add/athosoo-dsh-git-graph-sidebar`，只含 `data/plugins/Athosoo__dsh-git-graph-sidebar.yml` 8 行。）
4. ~~发 1.7.0~~ **已完成**（commit `a1c4619`、tag `v1.7.0`、Release id `422753809`、资产 `dsh-git-graph-sidebar.tgz` 852091 字节、`desktop` 已装 1.7.0；`patch-host` 24 处、`148/148`、158 个 locale 键）。下一版（Tier 4，尚未在 ROADMAP 立项）候选：提交信息模板（按文档生成 `type(scope): 描述`）、合规结果接进 `systemPrompt` 让模型自己避免、把仓库体检的「大未跟踪文件」做成可点开列表。
5. 可选打磨：总览虚拟滚动；总览里标出「比发现深度更深」的仓库；`activity` 改用 `status.head` 的提交时间以省掉一次 `log -1`；升级预览目前重建整份文档，未来可只替换变化的小节。

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

21. **locale 键的引号会被外层吃掉**：用 python heredoc 写 `['"sidebar.x"', '"值"']` 时容易生成 `["sidebar.x", "值"]`，build-lib 插出 `sidebar.compliance: 提交合规`（无引号）→ `lib/client.js:1714 SyntaxError: Unexpected token '.'`。可靠写法：`Q = chr(34); OPEN = chr(39) + Q; CLOSE = Q + chr(39)`；已损坏的行用 `re.compile(r"^[ \t]*sidebar\.(compliance|preview|workspaceDoc)[A-Za-z]*: .*,$", re.M)` 删掉再重跑 build-lib。
22. **python 字符串里的 Windows 路径会语法报错**：`"...\Users\18316\..."` 触发 `SyntaxError: (unicode error) 'unicodeescape' codec can't decode bytes ... truncated \UXXXXXXXX escape`，`\d`/`\s` 则被吞成 `d`/`s`。用 `chr(92)` 拼、写 raw string，或把长文本先 `cat > .tmp.md <<'MD'`（单引号 heredoc 不解析反斜杠）再让 python 读文件插入。
23. **给预览页做「浅色变体」前先确认 CSS 支持**：`.html.replace("<body>", '<body data-theme="light">')` 只对含 `body[data-theme="light"]` 覆盖的页面（hero/overview）有效；states 页没有这些覆盖（`grep -c light preview/graph-tab-states.html` = 0），硬写出来是假的浅色页，已删。
24. **截图单面板要拼独立 HTML**：Chrome 传相对路径会 `net::ERR_HTTP_RESPONSE_CODE_FAILURE`，必须 `file:///C:/...` 绝对 URL；只想拍某一段时用 python 从生成页里 `s.index("<h2>Upgrade preview")` 切片，套上 shell 的 head/style 另存 `.demo/preview-only.html`。

25. **`git checkout -- lib/*.js` 会把换行变成 CRLF**：仓库 `core.autocrlf=true`，blob 是 LF、检出成 CRLF，而 build-lib 的 `REGION_END = "\n\t\t//#endregion\n//#region src/client/index.ts"` 是 LF 字面量 → 直接报 `region end marker not found in lib/client.js`。恢复 `lib/` 后先 `python` 把 `\r\n` 换成 `\n` 再 build（提交时 git 会自己转回 LF，不会产生差异）。
26. **同一个 `switch` 里的多处补丁要各自带 guard**：`patch()` 的幂等判定是 `source.includes(replacement)`，可一旦后一个补丁把新 case 插进前一个补丁的「块 + 锚点行」之间，replacement 就再也不是连续文本 → 每次运行都重复插入（实测 `case "/git/init"` 累积到 7 份、`lib/index.js` 从 3743 涨到 4636 行）。现在 `patch(label, anchor, replacement, guard)` 支持第四参，第 9/13 段分别用 `'\t\t\tcase "/git/init": {'`、`'\t\t\tcase "/git/compliance": {'` 判定，连跑两次稳定输出 `applied 0, already present 22`。

## 10. 下一步照做即可（最短路径）

```bash
cd "C:/Users/18316/Documents/deepseek-harness/default-workspace/dsh-git-graph-src"
# 1) 全链路自检（都应为绿）
node scripts/build-lib.mjs && node scripts/patch-host.mjs
node --check lib/client.js && node --check lib/index.js
node scripts/validate-lib.mjs && node scripts/test-host.mjs
node scripts/preview-tab.mjs --repos ../.demo/data/repos.json   --graph ../.demo/data/graph-graph-demo.json --graph ../.demo/data/graph-dsh-git-graph-src.json --focus graph-demo
# 2) 升 1.6.0 后打包
npm pack --pack-destination "../dsh-git-graph-dist/1.7.3"
# 3) commit + push，建 tag/Release（资产名无版本），换装，让用户重启
# 4) 22:07 之后：bash ../.market-pr/open-pr.sh
```

## 11. 参考索引

- 路线图与逐项验收标准：`ROADMAP.md`（本仓库内）
- 开发说明（布局、构建、发布、host 两处 region）：`DEVELOPMENT.md`
- 用户向文档（中英双语）：`README.md` / `README.zh.md`
- 上游来源与改动归属：`NOTICE`（上游 `@linxin666/dsh-client-ui-git-graph` 0.4.8）
- 方案与早期评估：`...\default-workspace\git-graph-sidebar-multirepo-plan.md`
