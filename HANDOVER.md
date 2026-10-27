# Handover — dsh-git-graph-sidebar

> 交接文档。目标读者：接手这个项目的下一个会话（人或 AI）。
> 读这一份就够了：现状、改哪里、怎么发、坑在哪、下一步做什么。
> 最后更新：2026-10-27（1.13.1：把机械合并整条删掉——插件自己不再合并，只由智能体读文档后写；`desktop` 装完需重启 DSH）。

## 0. 一句话状态

1.8.3（字段解析修复）已发布并已装进 `desktop`：`conventionFieldValue()` 去掉行内 `#` 注释与引号，`conventionDocLanguageOf()` 容忍「中文 / zh / Chinese / 中英混排」，于是模板自带的注释不再把 `language: zh` 读成 `mixed`。

插件 **已开源**（`https://github.com/Athosoo/dsh-git-graph-sidebar`，Apache-2.0），**1.4.0 已发布、已推送、已装进 `desktop`**（Tier 1：复制回滚提示、提交搜索 + 引用筛选、导出独立 SVG）。**1.5.0（Tier 2：多仓库总览、分支清理提示、仓库体检）已发布、已推送、已装进 `desktop`**（host 95/95、客户端预览全过）。**1.6.0（Tier 3：提交合规提示、工作区总纲、规范升级预览）已发布、已推送、已装进 `desktop`**（host 132/132、客户端预览含 tier-3 一节全过；commit `92f15a1`、Release id `422695343`、资产 854388 字节）。市场收录 PR 已提交（`awesome-dsh-plugin#9196`，按维护者四条修正描述后 push 到 `a4521fc`）。

**1.8.0 已发布、已推送、已装进 `desktop`**：主题语言进了规范本身（1.7.3 的改动随 1.8.0 一起发布），并且扫描成本下来了——每个仓库的 refs 探针从三次合成一次 `git for-each-ref`，refs 没动时整轮命中缓存（`timings.probeSpawns` / `timings.probeHits` 写在 `/git/repos` 的返回里），规范文档改成并发批量读，状态探针并发 4 → 8、单仓超时 5s → 2.5s，客户端 20 秒轮询只刷仓库列表、图谱交给变更流。`build-lib` spliced 2674 / 1455 / 449 行、`patch-host` 22 处、166 个 locale 键、host 174/174。**1.7.3 的语言策略**：主题语言进了规范本身——文档前置元数据支持 `language: zh\|en\|mixed`（写在 `strict:` 之后），选择列表多一行「提交语言」，预览与写入都带上它，`git/compliance` 在语言写死时给违规主题一个 `lang` 原因，注入的提示块始终有一行 `Subject language: …`。顺手修掉两个真 bug：`conventionInsertField()` 重复拼冒号（`status::`）导致语言行永远落到文件顶部；`build-lib.mjs` 的 GitApi 注入改成「先按方法名删除、再按序插回」，避免旧签名残留覆盖新方法。
**1.8.1 已发布、已推送、已装进 `desktop`**：修「设置了却不生效」——新 `conventionSettings()` 与 `/git/convention/settings`（工作区侧用 `action: "settings"`）只改文档前置的 `strict` / `language` 而不重建正文，`repoConventionState()` / `workspaceConventionState()` 把这两个字段读出来，选择列表据此显示文档里的值，点开关即刻落盘；容器（不是仓库）的 cwd 现在会读 `<工作区>/.dsh/GIT_CONVENTIONS.md` 并把它（含语言行、strict 段、可机检规则与正文）连同子仓索引注入提示块。`patch-host` 23 处、host **186/186**。
**1.8.2 已发布、已推送、已装进 `desktop`**：规范条不再统计「最近 N 个提交里有几个不符合」（那些提交在面板上改不了，看了也没用），改成把**文档自己写明、并且真的会注入给助手的规则**列成小标签（`type: feat / fix / docs`、`标题 ≤ 72 字`、`小写开头`、`不加句号`、`祈使句`、`中文`、`强约束`），容器改成横向换行；选择列表底部的「取消」改成「关闭」。`build-lib` spliced 2707 行、163 个 locale 键、host 186/186、客户端预览全过。
**1.7.2 已发布、已推送、已装进 `desktop`**：工作区总纲条补上写入反馈——写成功后 `data-gitgraph-workspace-note="written"` 加「工作区规范已写入。」提示（8 秒淡出），写入失败的消息也改在这里显示（以前只落进选中仓库的规范条，工作区条静默）；文档已存在时按钮不再消失：有 `onOpenFile` 就给「打开」，否则给「复制路径」（`sidebar.workspaceDocCopy`）。`build-lib` spliced 2652 行、`patch-host` 24 处、`160` 个 locale 键、host 148/148。 **1.6.1 已发布、已推送、已装进 `desktop`**：工具栏去掉「总览」与「全屏查看」（客户端代码一并删除，只读路由 `/git/cleanup`、`/git/health` 保留），面板字号整体加大一号；commit `f077dd4`、tag `v1.6.1`、Release id `422709234`、资产 844839 字节；`build-lib` spliced 2561 行、`patch-host` 22 处、156 个 locale 键、host 132/132、客户端预览全过。 **1.7.0 已发布、已推送、已装进 `desktop`**（commit `a1c4619`、tag `v1.7.0`、Release id `422753809`、资产 852091 字节）：合规检查接受中文 / 英文 / 中英混排（type 中文别名、全角冒号、大小写与祈使句仅对拉丁首词生效），可选**强约束**模式（写入 `strict: true`，注入提示要求不合规提交先改写），框架选择列表选完自动收起，工具栏与操作按钮换成显式白色底 / 深色字的控制面板皮肤。`build-lib` spliced 2627 行、`patch-host` 24 处、158 个 locale 键、host 148/148。

**1.9.2 已发布、已推送、已装进 `desktop`**：补上 1.9.1 漏掉的 host 那一行——`lib/index.js:616` 的 `parseDecoration()` 不再剥掉 `tag: ` 前缀，客户端才真的能把标签和分支分开。**这一行没改，1.9.1 在实机上等于没修**：预览的 fixture 是手写的、自带 `tag: ` 前缀，所以测试全绿，而真实主机一直把前缀剥掉。`test-host` 因此新增第 [16] 段（真建仓库 + 打 annotated tag，断言 `/git/graph` 的 refs 里有 `tag: v1.0.0`、`main` 没有前缀），现在 **189/189**。 发布信息：commit `71c6571`、tag `v1.9.2`、release id **423303272**（`https://github.com/Athosoo/dsh-git-graph-sidebar/releases/tag/v1.9.2`）、资产 `dsh-git-graph-sidebar.tgz` **876179** 字节（`releases/latest/download/...` 校验一致）、`desktop` 已装 1.9.2（旧版 1.9.1 → 1.9.2，装前 `rm -rf node_modules/dsh-git-graph-sidebar`，否则 pnpm 复用 store 只报 `reused 1`）。安装后核对：`installed 1.9.2` / `host strips tag prefix: false` / `client ref-kind attr: 1`。**这次改的是主机半边，必须重启 DSH，`Ctrl+R` 不够。**

**1.10.0 已发布、已推送、已装进 `desktop`**：规范从「能读」走到「能主编排」。三件事：① **AI 署名政策** `ai: required | optional | forbidden`（前置字段，默认 `optional`，向后兼容）；`commitCompliance()` 的 `git log` 格式改成 `--format=%H%x00%s%x00%b%x1e`——以前只读 subject，trailer 在正文里，所以必须读 body；`required` 要求 `Assisted-by:` / `Co-authored-by:` 任一，`forbidden` 只拦 AI 专用 trailer、放过人类 `Co-authored-by:`。② **排他性检测** `conventionsConflicts()`：把工作区 `.dsh/<doc>`、本仓库 `<doc>`、祖先仓库的 `<doc>` 三方逐字段（`status/framework/strict/language/ai`）与逐规则（标题长度 / type 词表 / 小写 / 句号 / 祈使）比对，**只有双方都显式写了同一个字段且取值不同才算冲突**（沉默不算冲突）；`conventionsPromptBlock()` 把冲突写进每一步注入的提示，并明确要求「不要默默选边，先问用户」。③ **一键整合** `conventionsConsolidate()`：并集语义而非「谁赢」——把并集规则按 `parseConventionRules` 认得的标准措辞追加成 `## Unified rules (merged by dsh-git-graph)` 一节，再把各文档 `## ` 分节（同名时加 `(from workspace / this repository / parent repository)` 后缀）拼进来；写盘前每个被替换的文件都留 `*.bak-<yyyymmdd-HHmmss>`，仓库文档改成指针 `<!-- dsh-git-graph: inherited from … -->`，`repoConventionState()` 认指针、`conventionsDocumentFor()` 跳过指针以免重复治理。配套：`/git/conventions/conflicts`、`/git/conventions/consolidate` 两条只读/可写路由，`ai` 透传到写入、预览、设置、工作区四条既有路由，以及 **opt-in 的 `git_conventions` 工具**（`check` / `consolidate`，不带 `write: true` 只出计划），让中途加入工作区的模型自己就能检出冲突并回头问人。`build-lib` spliced 2843 / 3049 / 2102 / 449 行、`patch-host` 25 处、**181 个 locale 键**、host **232/232**、`preview-tab` 增加 tier-4 一段。发布信息：commit `8cad121`、tag `v1.10.0`、release id **425076679**（`https://github.com/Athosoo/dsh-git-graph-sidebar/releases/tag/v1.10.0`）、资产 `dsh-git-graph-sidebar.tgz` **900982** 字节（`releases/latest/download/...` 校验一致，sha256 `b457da0d6093297b62b583e196de983ec6fceea0d915f05a17eb908bfd13be18`）、`desktop` 已装 1.10.0（先 `rm -rf node_modules/dsh-git-graph-sidebar`，再 `pnpm add file:C:/Users/18316/.dsh/artifacts/dsh-git-graph-sidebar-1.10.0.tgz`；pnpm 顺手把 `billion-context` 从 0.1.206 升到 0.1.208）。**这次 host 与客户端都动了，必须重启 DSH，`Ctrl+R` 不够。**

**1.9.1 已发布、已推送、已装进 `desktop`（客户端半边）**：标签退出筛选排——一个标签只指向一个提交，静音它只能藏一行，所以它不再是筛选项，只留在提交行上作徽章；可筛分支少于 4 条时整排不显示；顺手删掉 1.6.1 遗留的两条死字典键 `sidebar.expandGraph`。`build-lib` spliced 2843 / 1560 / 449 行、`patch-host` 23 处、166 个 locale 键。**1.9.0 已发布、已推送、已装进 `desktop`**：引用筛选从「一个 ref 一枚标签」变成「一个分支一枚标签」——`feat/x` 与 `origin/feat/x` 合并成一枚并一起静音，`HEAD` / `origin/HEAD` 不再是标签，标签单独灰色一类，顺序是当前分支 → 其他本地分支 → 只有远程的分支 → 标签，超过 12 枚折成 `+N`，有静音时出现「清除筛选」；行内徽章与导出 SVG 用同一套标签（`HEAD -> main` 现在显示成 `main`）。`build-lib` spliced 2838 / 1560 / 449 行、`patch-host` 23 处、166 个 locale 键、host 186/186、客户端预览含新的 refs 一节全过。

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
| 插件源码（git 仓库，工作副本） | `E:\git-graph\dsh-git-graph-src` |
| 打包产物 | `E:\git-graph\dsh-git-graph-dist\<version>\`（含带版本与无版本两个 tgz） |
| 演示/测试用仓库 | `E:\git-graph\graph-demo`（13 提交、4 泳道、3 次合并、`feature/c` 故意不合并）；其余夹具由 `scripts/test-host.mjs` 与 `scripts/preview-tab.mjs` 自己现建 |
| 预览数据 | `scripts/preview-tab.mjs` 自带内置夹具（6 个仓库、5 行图谱），不带参数就能跑；要看真实仓库时传 `--repos <repos.json> --graph <graph.json>`，内容就是 `/git/repos`、`/git/graph` 的响应 |
| DSH profile | `C:\Users\18316\.dsh\profiles\desktop`（`package.json` 的 bundles 含包名；依赖指向稳定副本 `file:C:/Users/18316/.dsh/artifacts/dsh-git-graph-sidebar-1.9.2.tgz`，因为工作区会被搬走） |
| 市场收录克隆 | `E:\git-graph\awesome-dsh-plugin`（fork，分支 `add/athosoo-dsh-git-graph-sidebar`） |
| 市场投稿材料 | `E:\git-graph\.market-pr\{pr-body.md,open-pr.sh}` |

工作区已于 2026-10-25 从 `C:\Users\18316\Documents\deepseek-harness\default-workspace` 迁到 `E:\git-graph`（旧目录已清空，只剩空壳）。上表与全文的路径、命令都按新位置写；`dsh-git-graph-dist\1.6.0` 这类旧版本目录已不存在，§5 的「原始步骤留档」只作流程参考。今后以 `E:\git-graph` 为唯一工作区。

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
cd "E:/git-graph/dsh-git-graph-src"
node scripts/build-lib.mjs      # → synced GitApi additions (7 blocks) + spliced 2843 / 3223 / 2153 / 449 lines（tab / conventions / branches）
node scripts/patch-host.mjs     # → applied 0, already present 23（幂等）
node --check lib/client.js && node --check lib/index.js
node scripts/validate-lib.mjs   # → OK — 166 locale keys resolve, all fork identifiers defined
node scripts/test-host.mjs      # → 189/189 checks passed
node scripts/preview-tab.mjs    # fixture mode; add --repos/--graph for a real workspace
```

`preview-tab.mjs` 会写出 `preview/graph-tab-{preview,preview-light,states,hero,tier3,refs}.html`，可截图：

```bash
"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=2 --window-size=452,1040 \
  --screenshot="C:\...\preview-shot.png" \
  "file:///E:/git-graph/dsh-git-graph-src/preview/graph-tab-hero.html"
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
| 1.7.3 | 主题语言策略：`language:` 字段、选择器、`lang` 合规原因、注入块一行 `Subject language:`；随 1.8.0 一起发布 |
| 1.8.0 | 扫描成本：每仓一次 refs 探针（`for-each-ref` 带 `upstream:track`）、每仓指纹缓存（refs 没动就不 spawn）、规范文档并发批读、状态并发 8 / 超时 2.5s、`timings` 阶段计时、客户端轮询不再重读图谱；已发布并已装 |
| 1.8.1 | 修「设置了不生效」：`conventionSettings()` + `/git/convention/settings`（工作区 `action: "settings"`）只改前置字段、`repoConventionState` 回读 `strict`/`language`/`languageStated`、点开关即刻落盘、容器 cwd 读工作区文档并注入提示块；已发布并已装 |
| 1.8.2 | 规范条把「最近 N 个提交里有几个不符合」换成**生效规则标签**（type 词表 / 标题长度 / 小写 / 句号 / 祈使 / 主题语言 / 强约束），横向换行、不再给历史打分；选择列表的「取消」改成「关闭」；删掉 offender 渲染与 6 个 reason 键；已发布并已装 |
| 1.12.0 | 主区域视图：`conversation.view` 插槽注册（opt-in、可关、`localStorage` 记忆）、`GitGraphMainView` 包一层侧栏本体、locale 187 键、tab 3189 行、README 重写为先讲卖点 |
| 1.13.1 | 删掉机械合并：`conventionsConsolidate` / `conventionsUnionSection` / `conventionsMergedBody`、`/git/conventions/consolidate` 路由、工具 `draft` 动作、客户端合并面板与 11 个 locale 键全部移除；合并只能由智能体读完全部文档后自己写（`read` → `write`）。locale 180 键、host 232/232 |
| 1.13.0 | 合并改由智能体主导：`git_conventions` 新增 `read`（每份文档完整正文）与 `write`（写入模型写的合并稿，带备份与指针），`consolidate` 退为 `draft`；提示词在无冲突但多文档时也提示查重；面板「AI 合并」把请求复制到剪贴板（客户端无法直接发起模型回合），机械并集降级为通知里的「先看机械并集草稿」；locale 189 键、host 252/252 |
| 1.12.1 | 主区域布局修正（提交卡片移到图谱右侧、整列高度减掉宿主发布的 composer 高度）、被并入的仓库文档在指针下面保留合并前原文、locale 187 键、host 243/243 |
| 1.11.0 | 把 `AGENTS.md` / `CLAUDE.md` / `.cursorrules` / `CONTRIBUTING.md` 里的规则也读进来（`foreign` 来源、参与冲突与并集、合并时只读保留）、locale 185 键、host 242/242 |
| 1.10.1 | 规范面板标题行加「合并规范」按钮（不必先有冲突条）、只有一份规范时改为提示而非报错、tab 3068 行 / locale 183 键 |
| 1.10.0 | AI 署名政策（`ai: required/optional/forbidden`，读正文 trailer）、排他性检测（工作区 / 本仓库 / 祖先逐字段逐规则比对，冲突写进注入提示）、一键整合（并集规则 + `## Unified rules` 分节 + 时间戳备份 + 仓库文档改指针）、`git_conventions` 工具；已发布并已装 |
| 1.9.2 | 补上 1.9.1 漏掉的 host 那一行（`parseDecoration` 保留 `tag: ` 前缀），标签与分支终于真的能区分；`test-host` 增加第 [16] 段真标签断言（189/189）；已发布并已装 |
| 1.9.1 | 标签退出筛选排（只留行内徽章）、可筛分支少于 4 条时不画这一排、清掉 `sidebar.expandGraph` 死键（只改了客户端，实机无效，见 1.9.2）；已发布并已装 |
| 1.9.0 | 引用筛选改成一个分支一枚标签（本地与远程同名合并、符号引用不再出现、标签单独灰色、超 12 枚折 `+N`、静音时给「清除筛选」），行内徽章与导出 SVG 复用同一套标签；已发布并已装 |
| 1.8.3 | 修「文档里的行内注释把字段值污染」：`conventionFieldValue()` 现在去掉 `#` 之后的注释与首尾引号，`conventionDocLanguageOf()` 容忍「中文 / zh / Chinese」这类写法、先认 mix/混 再认中英，模板自带的 `status: draft   # draft | settled` 不再让 `language: zh   # zh | en | mixed` 被读成 mixed；已发布并已装 |

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

## 7.4 主题语言策略（1.7.3 的改动，随 1.8.0 发布）

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

## 7.5 1.8.0 的改动（扫描成本）

目标：让「工作区里仓库很多」不再等于「每次刷新都等好几秒」。改完的效果可以用 `/git/repos` 返回的
`timings` 自己核对，不用猜。

### 7.5.1 每个仓库一次 refs 探针（`src/host/branches.js`）

以前 `repoAugment()` 对每个仓库跑三条命令：`log -1 --format=%ct`、`rev-parse … @{upstream}`、
`rev-list --left-right --count HEAD...@{u}`。现在只有一条：

```js
const summaryRowsArgv = () => [
	"for-each-ref", "refs/heads",
	"--format=%(refname:short)%00%(committerdate:unix)%00%(upstream:short)%00%(upstream:track)"
];
```

`%(upstream:track)` 直接给出 `[ahead 3, behind 1]`，由 `parseUpstreamTrack()` 手写解析（不用正则，
免得源码穿过 shell 时被吃掉反斜杠）。`parseSummaryRows()` 出 `{name, lastCommit, upstream, ahead, behind}`，
`repoSummaryOf(service, root, branch)` 挑出「当前分支 → 第一个有上游的分支 → 第一个分支」，返回
`{activity, upstream}`（`activity` 取该分支 tip 时间，取不到时退回全仓最新）。`REPO_AUGMENT_CONCURRENCY` 4 → 8。

### 7.5.2 每仓指纹缓存

`repoSummaryFingerprint(root)` = `<gitDir>/HEAD` 的内容 + `<gitDir>/logs/HEAD` 的 `mtimeMs`。
**故意不看 `.git/index`**：`git status` 可能改写它，而状态探针每轮都跑，把 index 算进指纹会让缓存每轮失效。
`logs/HEAD` 在每次提交、切分支、建分支时都会被重写，正好是「refs 动没动」的信号。
命中就整条探针不 spawn（`repoProbeCounters.hits += 1`），未命中才跑并把 `{fingerprint, activity, upstream}`
存进 `repoSummaryCache`（上限 `REPO_SUMMARY_CACHE_LIMIT = 400`，超了删最旧）。
`.git` 是文件的工作树（submodule / worktree）由 `repoGitDirOf()` 读 `gitdir:` 解开。

### 7.5.3 计数窗口与 `timings`

`repoScan()` 里：扫描一开始 `repoTakeProbeCounters()` 清空窗口，`await repoAugment(...)` 之后再取一次，
所以 `timings` 报的是**这一轮**花的探针数（第一版在 augment 之前取，永远报 0，靠 `console.error` 才看出来）。
返回对象新增：

```js
timings: { statusMs, augmentMs, conventionsMs, totalMs, probeSpawns, probeHits }
```

`scannedAt` 改用同一次 `finishedAt`，不再多取一次 `Date.now()`。

### 7.5.4 规范文档并发批读（`lib/index.js` 的 repos region）

原来是串行 `for (const entry of entries) entry.conventions = await repoConventionState(...)`，
等于 N 次文件读排队；现在按 `REPO_SCAN_CONCURRENCY` 分批 `Promise.all`。同一段还改了
`REPO_SCAN_STATUS_TIMEOUT_MS` 5000 → 2500、`REPO_SCAN_CONCURRENCY` 4 → 8。

**这一段没有 `src/` 副本**（repos region 手工维护）。因此 `scripts/patch-host.mjs` 里原先给
`repoScan()` 打补丁的三段（`repo-scan-conventions`、`repo-scan-view`、`repo-scan-augment`）已删除：
它们的锚点就在这次改写的行上，留着只会「每次运行重插一遍」。现在补丁数 22。

### 7.5.5 客户端少一次图谱重读

`src/client/graph/SidebarTab.js` 的 20 秒轮询以前同时 `runScan(false, true)` 和 `loadGraph(void 0, true)`；
变更流（SSE）本来就在推「图谱该重读了」，所以轮询只留 `runScan`，依赖数组改成 `[active, runScan]`。

### 7.5.6 测试（`scripts/test-host.mjs` 第 [14] 段）

`scan-cost/alpha`、`scan-cost/beta` 两个真仓库，四次 `/git/repos`（都带 `refresh: true`）：

1. 首次扫描 `probeSpawns === 2`、`probeHits === 0`，四个阶段耗时都是数字；
2. 紧接着再扫 `probeSpawns === 0`、`probeHits === 2`，`activity` 与上一轮完全一致；
3. 造一个未跟踪文件 `scratch.txt`：`status.untrackedFiles >= 1`（状态永远新鲜），`probeSpawns === 0`（摘要仍走缓存）；
4. 在 beta 提交一次：`probeSpawns === 1`、`probeHits === 1`，且 beta 的 `activity` 变大。

比较仓库路径必须走 `rootKeyOf()`（小写 + 反斜杠换斜杠），Windows 会把同一个目录以另一种大小写还回来。


## 7.6 1.8.1 的改动（设置真的会生效）

起因是一个真实的用户反馈：在仓库图谱里把「提交语言」设成中文、把「强约束」打开，提交时却什么都没变。查下来是**四条彼此独立的断点**，代码从来没有一条链路把这两个开关从界面送到文档、再送到注入的提示里。

### 7.6.1 四个真因
1. `writeWorkspaceDoc`（`src/client/graph/SidebarTab.js`）只发 `{action: "write"}`，不带 `strict` / `language`，所以「创建工作区规范」写出的 `.dsh/GIT_CONVENTIONS.md` 里没有这两个字段——尽管 host 的 `workspaceConvention()` 早就接受它们。
2. 容器（不是 git 仓库的目录，例如工作区根）的提示注入完全不读工作区文档：`conventionsDocumentFor(cwd, docName)` 第一行 `const root = conventionsRepoRoot(cwd); if (root === void 0) return void 0;` → 退到 `conventionsContainerBlock()`，那里只列子仓文档路径，从不读文档自身内容。
3. 选择列表的两个开关从不从文档回读：`repoConventionState()` 只返回 `{doc, docPath, exists, size, draft}`，客户端是 `useState(false)` / `useState("mixed")`，看起来永远是没保存的样子。
4. 开关只在「点框架卡片」时随整篇文档写入，单点开关不落盘，界面也没有任何「未保存」提示。

### 7.6.2 host（`src/host/conventions.js`）
- `repoConventionState()` 与 `workspaceConventionState()` 读全文后返回 `strict: conventionStrictOf(text)`、`language: conventionDocLanguageOf(text)`、`languageStated: conventionFieldValue(text, "language") !== ""`；两个 `exists: false` 分支补 `strict: false, language: "mixed", languageStated: false`。
- 新 `async function conventionSettings(root, docName, strictMode, languageMode)`：读现有文档 → `conventionWithStrict(conventionWithLanguage(current, language), strict)` → `repoWriteConvention(root, doc, next, {force: true})`。**只改前置字段，不重建正文**；文档不存在或为空返回 `{ok: false, error: {code: "convention-missing-document"}}`；成功返回 `{ok: true, value: {root, doc, docPath, bytes, strict, language}}`。
- `workspaceConvention()` 加 `if (mode === "settings") return await conventionSettings(root, CONVENTION_WORKSPACE_DIR + "/" + doc, strict, language);`
- `conventionsDocumentFor()` 的 `root === void 0` 分支改为向上找 `.dsh/<doc>`（`conventionsWorkspaceDocFor(resolve(cwd), docName)`），命中返回 `{root: workspace, owner: workspace, path: containerPath, container: true}`。
- 新 `function conventionsWorkspacePromptBlock(root, docPath, docName, body)`：标题 `## <doc> - this workspace's Git conventions`、`Workspace: <root>`、`Document: ...`、容器导语、strict 段、`conventionLanguageLine(...)`、`conventionRuleSummary(...)`、正文（超 `CONVENTION_PROMPT_MAX_CHARS` 截断），末尾接 `conventionsContainerBlock(root, docName)` 的子仓索引。
- `conventionsPromptText()` 按 `found.container === true` 二选一。

### 7.6.3 路由（`scripts/patch-host.mjs` 第 16 段，共 23 处）
- `convention-settings-route`：在 `case "/git/convention": {` 之前插 `case "/git/convention/settings": {`，gate → `service.rootAndHead` → `conventionSettings(snapshot.root, feature.docName, policy.strict, policy.language)` → `OK(updated.value)`；guard 是 `			case "/git/convention/settings": {` 这一行。
- 工作区侧复用 `/git/workspace-convention` 的 `action: "settings"`，无需新路由。

### 7.6.4 客户端（`src/client/graph/SidebarTab.js`）
- `writeWorkspaceDoc` 的 payload 变成 `{action: "write", strict, language}`，依赖数组加 `conventionLang` / `strictMode`。
- 新 `applyConventionSettings`（`react.useCallback`，依赖 `[selected, runScan]`）：`selected.conventions.exists !== true` 直接返回，否则 `conventionSettings(selected.path, next)` 成功后 `runScan(true)`。
- 两个开关的 onClick 都是「先 setState，再 `applyConventionSettings({strict, language})`」。
- 新回读 effect（依赖 `[selectedKey, scan]`）：`setStrictMode(state.strict === true)`、`setConventionLang(state.languageStated === true ? state.language : "mixed")`。

### 7.6.5 测试
- `scripts/test-host.mjs` 第 [15] 段：`repos/switched` 上 `languageStated === false` → `POST /git/convention/settings {strict:true, language:"zh"}` 后正文仍在、出现 `strict: true` 与 `language: zh`、state 报回三字段 → 只传 `{strict:false}` 时 `language: zh` 保留 → `repos/undocumented`（真仓库、无文档）返回 `convention-missing-document` → 工作区 `write` 带 `strict:true, language:"en"` 后 `section.text(cwdOf(wsContainer))` 含 `this workspace's Git conventions` / `Subject language: English only` / `This document is strict` → `action:"settings", language:"zh"` 后文档同时有 `language: zh` 与 `strict: true`，提示块变成 `Subject language: Chinese only`。共 **186/186**。
- `scripts/preview-tab.mjs`：`SETTINGS_CALLS` 计数器 + `git/convention/settings` stub；点「中文」→ 立刻 1 次调用且 `language === "zh"`、`strict === false`；点强约束开 → 2 次且 `strict === true`、语言仍是 `zh`；再点关 → 3 次且 `strict === false`；创建工作区文档的 payload 必须带 `strict === false` 与 `language === "zh"`。
## 7.7 1.8.2 的改动（合规行改成「生效规则」，「取消」改「关闭」）

### 7.6.1 合规行不再统计已经写下的提交（`src/client/graph/SidebarTab.js`）

原先规范条里那句「最近 5 个提交里有 2 个不符合」配三行 offender 清单，指出的都是**已经提交、从面板上改不了**的历史记录——用户的原话是「这个本身没有意义啊，又改不了」。现在这一行只列**文档自己写明、并且真的会注入给助手的规则**，用小标签（chip）呈现：

- `data-gitgraph-rule="types"` → `type: feat / fix / docs`（`sidebar.ruleTypes`）
- `data-gitgraph-rule="length"` → `标题 ≤ 72 字` / `subject ≤ 72`（`sidebar.ruleLength`）
- `data-gitgraph-rule="case"` / `"period"` / `"mood"` → 小写开头 / 不加句号 / 祈使句
- `data-gitgraph-rule="language"` → 中文 / 英文 / 中英混排（仅当文档写了 `language:`）
- `data-gitgraph-compliance-strict` → 琥珀色「强约束」标记

容器 `SIDEBAR_TAB_COMPLIANCE` 从 `flexDirection: "column"` 改成 `row` + `flexWrap: "wrap"` + `gap: 4`，否则每个 chip 会被拉成整行（截图确认过，一行一个标签很难看）。`data-gitgraph-compliance` 的取值也随之改成 `none`（没有可机检规则）或 `rules`（有规则），不再有 `failing` / `clean` 这种「给历史打分」的状态。offender 数据仍由 `/git/compliance` 返回（host 不动、`test-host` 第 [13] / [15] 段照旧断言），只是界面不再渲染。

### 7.6.2 选择列表底部的「取消」改成「关闭」

`sidebar.conventionsCancel`（`取消` / `Cancel`）重命名为 `sidebar.conventionsClose`（`关闭` / `Close`）——那个按钮的动作是收起列表，不是撤销什么。**升级预览面板里的「取消」保持不动**（它旁边是「确认写入」，语义就是放弃这次升级），`sidebar.previewCancel` 未被触碰。

### 7.6.3 一并删掉的死代码

`sidebarTabReasonLabel(t, reason)` 只被 offender 行用过，随之一并删除；`sidebar.reasonLength` / `reasonType` / `reasonCase` / `reasonPeriod` / `reasonMood` / `reasonLang` 六个键（zh + en 共 12 行）与 `sidebar.complianceOk` / `complianceMiss`（4 行）一起从 `scripts/build-lib.mjs` 的 `EXTRA_KEYS` 移除，换成 `ruleTypes` / `ruleLength` / `ruleLowercase` / `rulePeriod` / `ruleMood` 五个键。locale 键总数 166 → **163**。

## 7.8 1.8.3 的改动（字段值不再被注释污染）

**症状**：在面板里把工作区规范设成「中文 + 强约束」，写进去的行是 `language: zh           # zh | en | mixed`、`strict: true           # 强约束：不合规的提交先改写再提交`（`conventionWithLanguage()` / `conventionWithStrict()` 只换行、不删注释），而 `conventionFieldValue()` 返回的是整段 `"zh           # zh | en | mixed"`，`conventionDocLanguageOf()` 精确比对失败 → 回落 `mixed`，注入给助手的提示块仍然写「Chinese, English or a mix of both」，看起来就是「设了中文没生效」。

**改法**（`src/host/conventions.js`）：

* `conventionFieldValue()` 先截断 `#` 之后的部分、再 `trim()`，并把成对的 `"…"` / `'…'` 引号去掉。
* `conventionDocLanguageOf()` 改成包含式判定：先认 `mix` / `混` → `mixed`，再认 `zh|cn|chinese|中文|中|汉语` → `zh`、`en|english|英文|英|英语` → `en`。
* `scripts/test-host.mjs` 第 [13] 段的 `repos/langzh` 文档改成带注释的写法（`status: settled        # draft | settled`、`language: zh           # zh | en | mixed`），原有的 `rules.language === "zh"` 断言从此覆盖注释场景。
* 工作区那份 `<workspace>/.dsh/GIT_CONVENTIONS.md` 的前置字段换成 `status: settled` / `strict: true` / `language: zh` / `framework: conventional-commits`（备份在 `.tmp/GIT_CONVENTIONS.workspace.bak`）。

**教训**：自己写进文档的行要能被自己读回——写入端保留注释、读取端就必须剥注释；`test-host` 的 fixture 要故意用带注释的写法。

## 7.9 1.9.0 的改动（引用标签：一个分支一枚）

**症状**（用户原话：「它有点乱，能不能搞一个方案解决一下」）：筛选那一排是「一个 ref 一枚标签」——`main`、`origin/main`、`origin/HEAD`、`feat/x`、`origin/feat/x`、`tag: v1.8.2` 各占一枚，同一个分支出现两次，符号引用也混在里面；超过 `SIDEBAR_TAB_FILTER_REFS_MAX`（12）后的部分被 `slice` 直接切掉，看不见也点不到；行内徽章显示 `HEAD -> main` 加一个 `+4`，比筛选排更吵。

**改法**（全部在 `src/client/graph/SidebarTab.js`；host、路由、locale 之外的构建脚本都没动）：

* `remoteNames`：远程名从 refs 自己推——某 ref 以 `/<本地分支>` 结尾时，前面那段就是远程名；只接受单段，所以 `origin/feat/x` 不会被误认成远程 `origin/feat`；一个都推不出来但有 `origin/` 开头的 ref 时兜底认 `origin`。
* `refGroups`：一枚标签一个分支。`feat/x` 与 `origin/feat/x` 合成一枚（`refs` 数组两条、`title` 两个都写出来），`HEAD`、`HEAD -> …`、`origin/HEAD` 不成为标签，`tag: …` 单独一类；`rank` = 当前分支 0、其他本地分支 1、只有远程的分支 2、标签 3，同级按名字比较。
* `refGroupOf`：`ref -> 标签键` 的 Map。可见性过滤改用它（`mutedRefs[key]`），于是静音一枚等于同时关掉本地与远程两边；行内徽章与导出 SVG 也用它。
* 折叠与清空：默认只画前 `SIDEBAR_TAB_FILTER_REFS_MAX` 枚，多出来的给 `data-gitgraph-refs-toggle` 的 `+N`（点开变「收起」）；任何一枚静音时旁边出现 `data-gitgraph-refs-clear`「清除筛选」，一键把 `mutedRefs` 清空。
* 视觉区分：本地或本地+远程合并 = 实心青蓝（`SIDEBAR_TAB_CHIP`），只有远程 = 虚线（`SIDEBAR_TAB_CHIP_MORE`），标签 = 灰底（`SIDEBAR_TAB_CHIP_TAG`）；静音仍是删除线（`SIDEBAR_TAB_CHIP_OFF`）。
* 行内徽章：`refLabels` 先把 ref 映射成标签键再去重，`HEAD -> x` 直接取 `x`，所以行首节点显示 `main` 而不是 `HEAD -> main`，计数也从 `+4` 变成 `+2`。
* 导出 SVG：`sidebarTabExportSvg()` 新增选项 `refLabels`（组件传 `refGroupOf`），refs 行用同一套标签；没有传 map 时退回旧行为（丢掉 `HEAD -> …`）。

**测试**：`scripts/preview-tab.mjs` 新增一节（合成仓库 `repos-refs/branchy` + `GRAPH_BY_ROOT` 里注册一份自己的 `/git/graph`，跑完还原 `REPOS` 与 `GRAPH_BY_ROOT`），断言标签顺序恰好 `main, feat/x, feat/y, tag: v1.0.0`、没有带 `origin/` 的标签、`data-gitgraph-ref-kind` 分别是 `branch / branch / remote / tag`、合并那枚的 `title` 含 `origin/feat/x`、四枚时不出现 `+N`、静音 `feat/y` 后行数减少且出现清除按钮、点清除后行数恢复；同时把这一屏写成 `preview/graph-tab-refs.html`（上半是初始态、下半是静音态）。

**locale**：新增 `sidebar.refsClear`（清除筛选 / Clear filters）、`sidebar.refsMore`（展开其余引用 / Show every ref）、`sidebar.refsLess`（收起 / Fewer），键数 163 → 166。

**教训**：标签的语义要跟着「用户在想什么」走，而不是跟着 Git 的字符串走——同一个分支的本地与远程两个名字、符号引用、行里的别名，都是同一个东西的三种写法，分开显示就只是噪音。`Map`/`Set` 走一遍就能合并，代价可以忽略。

## 7.9 1.9.1 的改动（标签不再是筛选项）

一句话：筛选排只留能「顺藤摸瓜」的东西。一个标签指向的是单个提交，不是一条线，静音它只能藏掉那一行——所以它不该占筛选项的位置。

### 7.9.1 host：保留 `tag: ` 前缀（`lib/index.js:616`，实际随 1.9.2 发布）

```js
return part.replace(/^HEAD -> /, "").trim();
```

原来还有一段 `.replace(/^tag: /, "")`，把标签和分支都变成光秃秃的名字，客户端根本分不出来——用户截图里那 9 枚 `v1.5.0 … v1.9.0` 被当成「分支」画成实心青蓝，就是这个原因。现在只剥 `HEAD -> `（和裸 `HEAD`），标签留着前缀，客户端才能区分。`lib/index.js` 的 graph 区域是上游代码、`repos` 区域是手工维护的，这一行直接改在 `lib/index.js` 里（`src/` 没有对应副本，所以不会被 `build-lib` 覆盖）。

**为什么 1.9.1 漏了它**：那次只改了 `src/client/graph/SidebarTab.js` 并全部验证通过——因为 `scripts/preview-tab.mjs` 的 fixture 是手写的 `["HEAD -> main", "main", "origin/main", "tag: v1.0.0"]`，自带了前缀，客户端逻辑在假数据上完全正确；真实主机却在链路的前一步把前缀剥掉了。**教训：fixture 里出现的字符串形态，必须与真主机实际返回的形态一致，否则测试只是在测自己的想象力。** 现在 `test-host` 第 [16] 段用真仓库 + 真 annotated tag 把这条链路钉住了。

### 7.9.2 客户端：标签不进 `refGroups`

* `refGroups` 遇到 `tag: ` 开头的 ref 直接 `continue`，`group` 记录里删掉 `tag` 字段，`rankOf` 从四级变三级（当前分支 0、其他本地 1、只有远程 2）。
* 但行内徽章与导出 SVG 仍要看得到标签，所以新增 `refLabelOf`：以 `refGroupOf` 为基础，把 `tag: v1.0.0` 映射成 `v1.0.0`。徽章的 ref 映射（`refLabelOf.get(ref)`）与 `sidebarTabExportSvg({refLabels})` 都用它，`refGroupOf` 只留给可见性过滤。
* 可见性过滤补一条：`usable` 里 `if (key === void 0) return true;`——标签不参与静音，但它的提交必须仍算「起点」，否则静音任意分支时，只有标签指着的老版本提交会凭空消失。`HEAD` / `HEAD -> x` 仍然返回 `false`（它们是别名，不是起点）。
* 整排的显示条件从 `refGroups.length === 0` 改成 `refGroups.length < SIDEBAR_TAB_FILTER_REFS_MIN && mutedCount === 0`（`MIN = 4`，在 `SIDEBAR_TAB_FILTER_REFS_MAX = 12` 旁边）；已经静音过东西时即使不足 4 枚也要显示，否则「清除筛选」按钮没地方点。
* 删掉不再使用的 `SIDEBAR_TAB_CHIP_TAG`（灰底 chip 样式）。

### 7.9.3 顺手清掉的死键

`sidebar.expandGraph`（「全屏查看」/「Full-window view」）在 1.6.1 删功能时只从 `scripts/build-lib.mjs` 的 `EXTRA_KEYS` 里拿掉了，`lib/client.js` 里那两行还在（`build-lib` 只插入、从不删除）。这次手工删掉，`grep -c expandGraph lib/client.js` = 0。`validate-lib` 仍是 166 键——那两条本来就不在 `EXTRA_KEYS` 里，删掉不影响计数（`validate-lib` 只校验「用到的键都在」，从不报未使用的键，所以这类残留只能靠 grep 找）。

### 7.9.4 测试（`scripts/preview-tab.mjs`）

* fixture 增加第四条分支 `feat/z`，否则 3 枚 chip 会低于 `MIN = 4`，整排不显示，测不到 chip 本身。
* 断言改为：chip 恰好 `main, feat/x, feat/z, feat/y`；没有任何 chip 的键是 `tag: …` 或 `v1.0.0`；没有 `data-gitgraph-ref-kind === "tag"`；行上（徽章或折叠计数的 `title`）仍能看到 `v1.0.0`，且**不出现** `tag: ` 前缀。
* 新增用例：`repos-refs/tiny`（单分支 + 一个标签）挂载后 `data-gitgraph-ref-filter` 节点数为 0，而搜索框仍在——证明只藏这一排，不动别的。
* 输出行：`preview-tab: ref chips folded to one per branch (main, feat/x, feat/z, feat/y), tags kept off the row, mute and clear wired`。
* 预览页 `preview/graph-tab-refs.html` 的标题改为「Ref chips - one per branch, tags stay on the rows」。

### 7.9.5 教训

筛选排的分量要和它能筛掉的东西成正比。一个仓库只有 1 条分支 + 9 个发布标签时，这一排既筛不出内容又占掉三成首屏高度——那是纯装饰。判断标准很简单：**能不能从这一枚「顺藤摸瓜」走到别的提交**。能（分支、远程分支）就留，不能（标签、符号引用）就当行内标记。

## 7.10 1.10.0 的改动（AI 署名政策、排他性检测、一键整合）

用户诉求（原话）：「我希望这个 git 规范新增一个选项：是否注明 AI 贡献，怎么样？然后我希望 git 规范能够具备排他性检测，即当 git 规范文件和已有的规范冲突，需要能够提供解决方案。我设想的方案是：一键整合工作区规范」；追加约束：「排他性检测我还要为了中途加插件的做准备，避免中途加的规范和旧规范冲突，可以让 AI 方便地检出冲突，询问是否合并」——所以这一版的验收标准不只是「面板上能点」，而是**模型自己也能检出、并且必须先问人**。

### 7.10.1 AI 署名政策（`src/host/conventions.js`）

- 前置字段 `ai: required | optional | forbidden`；`CONVENTION_AI_MODES = ["required", "optional", "forbidden"]`，`conventionAiOf()` 用中英文正则辨识（`forbid|禁止|不允许|不得|never|none|off` / `require|must|必须|必填|要求|注明|需要|always`），空值回 `optional` —— **默认 optional，老文档不受影响**；`conventionAiStated()` 区分「没写」与「写了 optional」，只有写了才在界面与提示里出现。
- `commitCompliance()` 的读法变了：`--format=%H%x00%s%x00%b%x1e`，按 `\u001e` 切记录、`\u0000` 切字段。**以前只读 subject，trailer 在正文里，所以 1.10.0 之前的合规检查根本看不到 AI 署名。**
- `required` 认 `assisted-by` / `generated-by` / `ai-assisted` / `ai-generated` / `co-authored-by`；`forbidden` 只拦 **AI 专用** trailer（`CONVENTION_AI_TOOL_TRAILERS`），放过人类 `Co-authored-by:` —— 否则「禁止 AI 署名」会误伤结对提交。
- 只有 `strict: true` 时才真的拒绝提交；否则只在面板标红（`reasons` 里多一个 `ai`）。`enforced` 现在也包含 ai 两个方向。

### 7.10.2 排他性检测（`conventionsConflicts()`）

- 参与比较的只有「管同一批提交」的三处：工作区 `<ws>/.dsh/<doc>`、本仓库 `<root>/<doc>`、祖先仓库 `<doc>`（`conventionsAncestorRoots()` 向上 3 层）。**子仓库文档不算冲突** —— 它们各自独立是合法的。
- 字段级比 `status / framework / strict / language / ai`，规则级比 `maxSubject / types / lowercase / noPeriod / imperative`。三条判定口径：①② 字段与布尔规则**只有双方都显式写了同一个字段且取值不同才算冲突**（沉默不算冲突，避免「谁没写谁就该被覆盖」的误判）；③ `types` 只有**交集为空**才算冲突（部分重叠可以共存）。
- `digest` = 参与比较的 `docPath + fields + rules` 与冲突数的 sha256 前 16 位，进了 `conventionsPromptText()` 的缓存 stamp —— 文档或冲突状态一变，提示立刻失效重算。
- 有冲突时，注入的提示块末尾追加 `conventionsConflictPromptBlock()`：逐条列 `<字段>: <值> (workspace) vs <值> (this repository)`，并明确要求模型**不要默默选边、先问用户**，要合并就调 `git_conventions` 的 `consolidate` 先出计划。

### 7.10.3 一键整合（`conventionsConsolidate()`）

- **并集语义，不是「谁赢」**。理由：`parseConventionRules()` 是全文扫描的（长度取全文最小值、types 取全文反引号名的词表并集、布尔「全文任意处出现即为 true」），所以只要把并集规则按它认得的标准措辞追加成一节，解析结果天然就是并集，不需要脆弱地改写原文 prose。追加的那一节标题固定 `## Unified rules (merged by dsh-git-graph)`，正文英文（用中文会污染 `conventionDocLanguageOf()` 的语言判定）。
- 各文档的 `## ` 分节一并搬过来；标题撞车时改写成 `## <原标题> (from workspace | this repository | parent repository)`，再撞就加序号 —— **早期实现直接跳过同名分节，会静默丢掉仓库文档的正文，已修**。
- 写盘：目标是 `<ws>/.dsh/<doc>`；已存在且没给 `force` 就报 `convention-exists`；写之前每个被替换的文件都留 `<name>.bak-<yyyymmdd-HHmmss>`；仓库级文档不再复制正文，改成指针文件（`> 本仓库的 Git 规范由工作区统一维护：…` + `<!-- dsh-git-graph: inherited from … -->`）。
- 指针的后继处理：`repoConventionState()` 认指针并回 `pointer: true / inherited`（避免 `conventionsAuto` 又给它铺一份模板）；`conventionsDocumentFor()` 跳过指针文件，让注入落到工作区文档上，不然同一个仓库会被两套文档各治理一次。
- 写盘前先出计划（`write` 不给就只返回 `{written: false, diff, union, absorbed}`），面板与工具都先预览再落盘。

### 7.10.4 路由、工具与客户端

- 两条新路由（`scripts/patch-host.mjs` 的 `convention-conflict-routes`）：`/git/conventions/conflicts`、`/git/conventions/consolidate`。`ai` 透传到 `/git/convention`（写入）、`/git/convention/preview`、`/git/convention/settings`、`/git/workspace-convention` 四条既有路由。
- **opt-in 的 `git_conventions` 工具**（`agentTool` 开着才注册，照 `buildWorktreeTool` 的形状写）：`action: check | consolidate`，另有 `write` / `force`；没给 `write: true` 时只出计划并把 guidance 写成「先给用户看，同意了再带 write true 重来」。这是「中途加入的插件/模型」场景的落地方式：模型每步都能从注入提示里看到冲突，也能主动查。
- 客户端（`src/client/graph/SidebarTab.js`）：AI 三态选择器（`data-gitgraph-ai`）、规范条新增 AI 规则 chip、冲突条（`data-gitgraph-conflicts` + 「查看并合并」按钮）、整合面板（`data-gitgraph-consolidate` = `ready` / `written`，列前 6 个被并掉的文档 + 「写入并备份」/「关闭」）。
- locale 键 166 → **181**（`sidebar.ai`、`aiHint`、`aiRequired/Optional/Forbidden`、`ruleAiRequired/Optional/Forbidden`、`conflicts`、`conflictsReview`、`consolidateTitle/Warn/Merge/Confirm/Cancel/Merged`）。

### 7.10.5 测试与教训

- `scripts/test-host.mjs` 增加三段，**232/232**：[17] AI 署名在正文里被检查（required / forbidden / optional 三态）；[18] 冲突被报告、合并先预览后写入（含备份、指针、合并后 `count 0`、提示里不再有冲突）；[19] `git_conventions` 工具（注册、check 出计划、consolidate 不带 write 不改盘、带 write 真合并、未知 action、无 cwd）。
- **`apply()` 是 `mountOnce()` 包的，靠 `globalThis[Symbol.for("dsh-web.mounted-plugins")]` 全局去重** —— 同一进程里第二次 `apply` 是 no-op，只会进 waiters。测试里必须先 `mountedPlugins.delete("dsh-git-graph-sidebar")` 才能再挂。
- 传给 `apply()` 的 config 必须是 schemastery 形态（字段带 `.get()`），例如 `{ agentTool: { get: () => true } }`；`featureConfig` 是 thunk，`buildConventionsTool(featureConfig)` 里 `readConfig()` 拿到的就是解包后的字符串。
## 7.11 1.10.1 的改动（规范面板自己的「合并规范」按钮）

- 反馈：冲突条只在真有冲突时出现，想手动整理一遍时面板上没有入口。1.10.1 在规范面板标题行（`Git 规范` / 文档名 / 状态 / 打开 / 更换框架 那一行，`flexWrap: "wrap"` 本来就允许换行）加了 **合并规范** 按钮：`data-gitgraph-action="conventions-consolidate-open"`，`exists` 才渲染，`conventionBusy` 时禁用，点击走和冲突条同一条 `previewConsolidate(selected.path)` → `conventionsConsolidate(repoPath, {})`，只出计划，再点「写入并备份」才落盘。
- 顺手修了一处体验：只有一份规范在生效时（`live < 2`），主机返回 `code: "convention-single-source"`，原来会把它当错误红字显示；现在 `previewConsolidate` 认这个 code，改成提示 `sidebar.consolidateSingle`（`data-gitgraph-conventions-single`）并清掉计划面板。
- 发布信息：commit `1c02dbf`、tag `v1.10.1`、release id **425292315**、资产 `dsh-git-graph-sidebar.tgz` **901665** 字节（sha256 `fe3ce6f628aaa24c6957d8c1bce37a714adb112e76ef07882aa047f504d2d16e`，`releases/latest/download/` 校验一致）、`desktop` 已装 1.10.1（`pnpm add file:C:/Users/18316/.dsh/artifacts/dsh-git-graph-sidebar-1.10.1.tgz`，锁文件 5 处全部指向 1.10.1、无 1.10.0 残留）。
- 代价很小：locale 键 181 → **183**（`sidebar.consolidateOpen`、`sidebar.consolidateSingle`），tab 源码 3049 → **3068** 行，`scripts/build-lib.mjs` 的 `EXTRA_KEYS` 加 4 条；`preview-tab` 的 tier-4 补一段断言（面板按钮出计划但不写盘、取消后计划面板消失）。
## 7.12 1.11.0 的改动（`AGENTS.md` 这类散文文档里的规则也能检出）

- 用户问（原话）：「规范写在 AGENTS.md 或其他文件里，能不能检测？」1.10.x 的答案是**不能**：`conventionsSources()` 只找 `<ws>/.dsh/<doc>`、`<root>/<doc>` 与祖先目录的同名文档，`AGENTS.md` 完全不看；实测「规范写 72 字符 + `AGENTS.md` 写 50 字符」的仓库回 `live 1 / count 0`。
- 但检出**不需要调模型**：把 `AGENTS.md` 直接喂给现成的 `parseConventionRules()` 就能得到 `{maxSubject: 50, types: ["feat","fix","docs"]}` —— 它本来就是全文正则扫描，散文里的「Keep the subject under 50 characters.」照样命中。所以 1.11.0 只是补上「哪些文件也算规范」，判定仍然确定性、可复现。
- `CONVENTION_FOREIGN_DOCS = ["AGENTS.md", "CLAUDE.md", ".cursorrules", "CONTRIBUTING.md"]`：`conventionsSources()` 在工作区根与本仓库根各扫一遍，产出 `kind: "foreign"` 的 source，**单独放进返回值的 `foreign`，不混进 `sources`** —— 否则 `total` / `live`（「有几份规范在治理这批提交」）的含义会被稀释，1.10.0 测试里 `total === 2` 的断言也会破。
- 冲突与并集：`conventionsConflicts()` 用 `allSources = live.concat(foreign)` 做规则三段（长度 / type / 三个布尔）与并集，散文里的规则因此参与「谁更严」。新增 `report.foreign`（每份 `{origin: 文件名, docPath, keys}`）并计入 `count`；`digest` 也纳入 foreign 的 rules，`AGENTS.md` 一改提示缓存就失效。
- 关键口径：foreign 与 **`governedUnion`（只看真正的规范文档）** 比，而不是与最终并集比 —— 否则并集早已把它的规则吃进去，永远算「没差异」，等于白检。
- 注入提示：`conventionsConflictPromptBlock()` 为每份 foreign 追加一行「`AGENTS.md` also states … - it is not rewritten by a merge, so ask the user whether those rules should move into the document first」。模型因此能说出「你的规范没写这条，但 `AGENTS.md` 要求了」。
- 合并：`conventionsConsolidate()` 的准入从 `live < 2` 放宽成 `live < 1 || (live < 2 && foreign.length === 0)` —— 只有一份规范但旁边有 `AGENTS.md` 时也允许整合；计划里新增 `leftInPlace`（这些文件**只读不写**，工作区里别的工具在读它们，改写会伤到别人），合并只把它们的规则写进并集，于是 `count` 归零。
- 客户端：计划面板在「并入」列表后多一段「保留原地：AGENTS.md」（`data-gitgraph-left`），locale 键 183 → **185**（`sidebar.consolidateLeft`、`sidebar.consolidateKeep`），tab 3068 → **3079** 行。
- 测试：`test-host` 增第 [20] 段（10 项）—— 散文文档被报成 foreign、长度规则把并集收紧到 50、提示里出现 `AGENTS.md`、计划列 `leftInPlace`、只读文件合并后原文未变、合并后 `count 0`；总数 232 → **242/242**。`preview-tab` 的 consolidate 假响应补 `leftInPlace` 并断言 `data-gitgraph-left`。
- 发布信息：commit `14e2e72`、tag `v1.11.0`、release id **425422415**（`https://github.com/Athosoo/dsh-git-graph-sidebar/releases/tag/v1.11.0`）、资产 `dsh-git-graph-sidebar.tgz` **904153** 字节（`releases/latest/download/...` 校验一致，sha256 `321617e084a95e4e8e2c77ea8b7d845b59e769c358a20e9bc157e4a62691e27e`）、`desktop` 已装 1.11.0（`pnpm add file:C:/Users/18316/.dsh/artifacts/dsh-git-graph-sidebar-1.11.0.tgz`，lockfile 五处全指 1.11.0，1.10.1 残留 0 处）。
- 边界（有意不做）：不改写 `AGENTS.md`，也不把它的散文整段搬进规范文档（只搬规则，落在并集一节）；`README.md` 等任意文件名不扫 —— 名单硬编码四个最常见的，宁可少扫也不误读。

## 7.13 1.12.0 的改动（图谱可开进对话主区域）

- 用户诉求（原话）：「做，不做文件树，但是加一个功能：支持在图示这个区域打开，要求是可选项，可关闭（主要入口还是在侧边栏那里），然后把介绍文档写好一点，突出独特卖点」——图里指的是宿主窗口顶部那条 `对话 | 轨迹 | 上下文 | 编队`。所以：**不做工作区文件树**，做「主区域视图」，并把 README 的开头改成先讲卖点。
- 契约（别再猜）：宿主 `@deepseek-ai/dsh-client-ui-conversation` 的 `conversation.view` 插槽，`kind: "list"`、`scope: "session"`；`registerOptions` 里 `id` 必填且**必须用自造 id**（复用内置 id 会替换掉那一格）、`order` 升序（内置轨迹是 10）、`label` 可传 thunk（每次投影重读，所以本地化不用重注册）。注册形态：`ctx.slots.inject("conversation.view", () => ctx.slots.register({ name: "conversation.view", id: "git-graph", order: 70, locale: NS, label: () => sidebarTabT(scope, "view.title"), inject: (sessionId) => ({...}) }, GitGraphMainView))`。
- 开关存 `localStorage["dsh-git-graph:main-view"]`（`"1"` 为开）；`sidebarTabMainViewEnabled()` 对没有 `localStorage` 或抛异常的宿主一律当「关」，`sidebarTabSetMainView()` 写值并通知 `sidebarTabMainViewSubscribe` 的监听者 —— 侧栏上的「在主区域打开」按钮与视图右上角的 `×` 走同一个入口，两处状态不可能不一致。
- 注册代码写在 `lib/client.js` 的 `ctx.inject(["slots", "sessions"], …)` 里（**不在 splice 区域内**，因为 splice 区域拿不到 `slots`）；内部 `syncView()` 先 `disposeView()` 再按当前偏好决定是否重新注册，外层 `effect` 的清理函数同时退订与 dispose，所以运行中开关立即生效。
- 视图本体是 `GitGraphMainView`：一个 `data-gitgraph-main-view` 的 flex 容器里渲染**原来的** `GitGraphSidebarTab`，右上角 `data-gitgraph-action="main-view-close"` 的 `×`。主区域没有 tab 对象，所以 `choose()` 里加了 `if (tab === void 0 || tab === null) return;` 守卫，避免往不存在的 tab 写 `meta.repoPath`。
- 一个坑：`scripts/validate-lib.mjs` 只用 `/\bt\("([^"\\]+)"/g` 统计**字面量**键，`t(cond ? "a" : "b")` 会静默逃过检查。所以标签提成 `const mainViewLabel = mainViewOpen ? t("sidebar.mainViewOn") : t("sidebar.mainViewOpen");`，键数从 185 涨到 **187** 说明两个键真的被检查到了。
- 测试：`preview-tab.mjs` 的假 ctx 补了 `slots`（记录 `inject`/`register`）、`sessions`（`session` → `cwd: WORKSPACE`）和一份内存版 `localStorage`；新断言组覆盖「偏好关时**不**注册」「打开后注册进 `conversation.view`、`id: "git-graph"`、`order: 70`、标签本地化」「视图元素树含容器、侧栏本体且**不带** `tab` 描述符」「`×` 关掉后偏好变 `"0"` 且注册被 dispose」「再打开能重新注册」。注意这套测试 harness **不能渲染嵌套组件**（子组件的 hooks 会跑在 render 通道之外），因此断言落在元素树上而不是 `html` 上。
- 文档：`README.md` / `README.zh.md` 开头新增 **Why this one / 为什么选它**（规范进提示、规范能被读回含散文、两份规范打架不会被悄悄投票、三个入口一套本体、全程本地只读），并在功能清单里补「可选的主区域视图」一条；`DEVELOPMENT.md` 加「The optional main-area View」一节记下偏好键、注册代码、`tab` 守卫、字面量 `t()` 的坑与测试限制；`package.json` 升 **1.12.0**。
- 自检值：`build-lib` spliced **3189 / 2149 / 449**、`patch-host` `already present 25`、`validate-lib` **187 键**、`test-host` **242/242**、`preview-tab` 全过（末行 `root 40067 / nested 24884 / pinned+zoomed 27231`）。
- 现场发现（值得记的用法坑）：工作区在 20:56 真的跑过一次整合 —— `E:/git-graph/.dsh/GIT_CONVENTIONS.md` 从 2832 B 涨到 4899 B，`graph-demo` 里多出指针文件与备份。原因是 `graph-demo` 的规范还是「每个小节都写待定」的脚手架，**整合会把脚手架的小节一起并进工作区总纲**（合并后多了 39 处「待定」）。已从插件自己留下的 `GIT_CONVENTIONS.md.bak-20261027-205657` 还原总纲（现在是 2832 B，`parseConventionRules` 回 `maxSubject 72 / language zh / strict true / count 0`），并把 `graph-demo` 里的两份残留挪出仓库。教训：**只该拿「已经写好规则」的文档去整合**，脚手架文档适合先填再并。
- 发布信息：commit `4e1a38e`、tag `v1.12.0`、release id **425494454**（`https://github.com/Athosoo/dsh-git-graph-sidebar/releases/tag/v1.12.0`）、资产 `dsh-git-graph-sidebar.tgz` **910380** 字节（asset id **681671318**，`releases/latest/download/...` 经镜像下载校验 sha256 `2963b69addc0646ad46abdd9d15c508fe026742766ffc861974d3cbe1797f5d7` 一致、154 条目、包内 version 1.12.0）、`desktop` 已装 1.12.0（`pnpm add file:C:/Users/18316/.dsh/artifacts/dsh-git-graph-sidebar-1.12.0.tgz`，lockfile `:41-43` / `:1198-1199` / `:3291` 全指 1.12.0，1.11.0 残留 0 处）。

## 7.15 1.13.0 的改动（合并交给智能体）

### 7.15.1 为什么推翻 1.10.0 的合并

1.10.0 的 `conventionsConsolidate()` 是确定性的并集：把各文档 `##` 小节搬过来、追加一节命中解析正则的 `## Unified rules`。它只能合并「正则看得见的东西」——**读不出两段话在说同一件事**，读不出「每节都写待定」的脚手架没有信息量，也不能把人话改写得更短。用户的判断是这种机械合并不够用，于是合并搬到模型侧，代码只留真正机械的部分（发现文档、备份、指针、落盘）。

### 7.15.2 工具面：`read` / `check` / `write`（`draft` 已在 1.13.1 删除）

- `read` → `conventionsReadDocuments(cwd, docName)` 返回 `{doc, root, workspace, target, documents}`；每份文档带 `origin`（`workspace` / `this repository` / `parent repository` / 散文文件名）、`docPath`、`bytes`、`pointer`、`inherited`、`truncated`、`text`（上限 `CONVENTION_READ_MAX_CHARS = 20000`）。**要点是模型看到原文件，而不是解析出来的规则列表。**
- `write` → `conventionsWriteMerged(cwd, docName, body, {force, absorb})`：空正文拒绝（`convention-empty`）；目标已存在且无 `force` 拒绝（`convention-exists`）；旧目标先复制成 `<名>.bak-<yyyymmdd-HHmmss>`；`absorb`（默认 true）时每份非工作区的规范文档备份后改写成指针，且**指针下面保留合并前原文**。读写都过 `conventionReadText` / `conventionWriteText`，失败返回 `{ok:false, error:{code:"internal"}}` 而不是抛异常。
- `check` 不变；`draft` 在 1.13.1 已删除（见 §7.16）。
- 参数：`action`（required）+ `body` / `force` / `absorb`。

### 7.15.3 提示词改了谁来做合并

- `conventionsConflictPromptBlock()` 不再让人去调 `consolidate`，而是要求：**完整读每一份文档 → 自己逐段比较 → 提出一份合并稿 → 用户同意后才写**；并且显式写出退路「工具不可用就用你自己的文件工具」——因为 `agentTool` 默认 `false`，工具是可选开启的。
- 同一函数**在文档之间没有机械冲突时也会触发一条提示**：文档数 ≥ 2 且 `count === 0` 时输出一行「这些文档在机械设置上一致，但正文仍可能重复，读全文再看」。这样「查重」是常驻指令，而不是只有字段打架时才被提醒。合并完成后仓库文档变指针、`live` 回到 1，这一行自动消失。

### 7.15.4 面板：交接而不是执行

- 「AI 合并」（`data-gitgraph-action="conventions-ai-merge"`）与冲突条上的「查看并合并」都改调 `requestAiMerge()`：把一段现成的请求复制到剪贴板（对 `globalThis.navigator.clipboard` 做容错），并显示 `data-gitgraph-conventions-ai` 通知。**客户端插件无法直接发起模型回合**（查过 `@deepseek-ai/dsh-api-session-controller` 与 ui-conversation，没有 composer submit API），所以这里只能复制。
- 机械并集保留在通知里的「先看机械并集草稿」（`conventions-consolidate-open` → `previewConsolidate`），旧的预览/确认面板与它的测试因此仍是活路径；面板自身永远不会背着人写盘。

### 7.15.5 测试与坑

- `preview-tab.mjs` 用 `Object.defineProperty(globalThis, "navigator", …)` 注入剪贴板桩（Node 24 的 `globalThis.navigator` 只有 getter，直接赋值报 `Cannot set property navigator of #<Object> which has only a getter`），断言：点 review 只复制不调接口（`CONSOLIDATE_CALLS.length === 0`）、点并集链接才出计划、面板按钮也只复制。
- `test-host.mjs` [19] 改成 `read` → `draft` → `write`，并断言「写到盘上的就是模型给的正文」「备份恰好 2 份」「指针 1 份且保留原文」「空正文被拒」「写完后 `count === 0`」。总数 **252/252**。
- **写补丁脚本的教训**：先用 `src` 算好索引、再对已经过一次替换（变长）的 `out` 切片，会把文件切坏（本次把 `const toolExec = …` 截断，靠 `git show HEAD:scripts/test-host.mjs > …` 还原后重做）。凡「先替换、再按行插入」一律在同一份字符串上重新 `find`。另外 bash heredoc 里两个反斜杠落进 python 非 raw 字符串会被折叠成一个，再写进 JS 就成了错的 `/\/g`；能不用转义就不用（改成 `includes` / `endsWith`）。

### 7.15.6 发布信息

- commit `9534f1e`「新增(conventions): 合并改由智能体读文档后自己写」（18 files, 531+/84−），tag `v1.13.0`，已推送（`47b2d0a..9534f1e HEAD -> main`）。
- 打包 `../dsh-git-graph-dist/1.13.0/dsh-git-graph-sidebar.tgz` = **919392 字节**、154 条目，sha256 `d2ca4972077b48c65d12f8c45f6ff56e9e935cbbd03a55e839be612b9aea7472`；解包后 `lib/index.js`、`lib/client.js` 与仓库 `diff -q` 一致。
- Release `v1.13.0` id **425545057**、资产 id **681786306**（919392 字节、`uploaded`）；镜像 `releases/latest/download/dsh-git-graph-sidebar.tgz` 下载校验 sha256 一致。**注意：创建 release 必须直连 `api.github.com`，经 `ghfast.top` 代理 POST 会返回空响应**（`JSONDecodeError: Expecting value: line 1 column 1 (char 0)`）；资产上传走 `uploads.github.com`（`api.github.com/.../assets` 是 404），`Content-Type: application/x-gzip`。
- `desktop` 已装 1.13.0（`pnpm add "file:C:/Users/18316/.dsh/artifacts/dsh-git-graph-sidebar-1.13.0.tgz"`，`- 1.12.1 / + 1.13.0`）；`package.json` 依赖与 `pnpm-lock.yaml`（6 处 `1.13.0`）全部指向 1.13.0、`1.12.1` 残留 0；已装 `lib/index.js` 195426 B（`CONVENTION_READ_MAX_CHARS` 4 处、`conventionsWriteMerged` 2 处）、`lib/client.js` 255543 B（`conventions-ai-merge` 1 处、`consolidateDraft` 3 处）。
- **用户需重启 DSH**：host 与客户端都改了，`Ctrl+R` 不够。

## 7.14 1.12.1 的改动（主区域布局、指针保留原文）

1.12.0 落地后现场发现两个问题，1.12.1 修掉。

### 7.14.1 主区域里提交卡片压在输入框上

- 现象：主区域打开图谱后点一个提交，卡片跑到最下面、占很高，滚到底时被粘在底部的输入框盖住。
- 根因：宿主 `.viewArea` 在 active 阶段是 `flex: 1 0 auto; min-height: auto`，也就是**跟着内容长高**；侧边栏里 `SIDEBAR_TAB_ROOT` 的 `height: 100%` 有确定父高所以没事，主区域里百分比高度退化成 auto，整列按画布高度撑开，卡片被推到滚动区底部，而 `.composerSeat` 是 `position: sticky; bottom: 0`，滚动时正好压在上面。
- 修法：宿主自己用 ResizeObserver 在滚动容器上写了两个变量 —— `--dsh-conversation-viewport-height`（滚动区 clientHeight）和 `--dsh-composer-height`（composer 的 offsetHeight）。主区域根节点改用 `SIDEBAR_TAB_MAIN_VIEW_ROOT = Object.assign({}, SIDEBAR_TAB_ROOT, { height: "calc(var(--dsh-conversation-viewport-height, 100vh) - var(--dsh-composer-height, 96px))", maxHeight: 同值, overflow: "hidden" })`，于是整列刚好等于「可视高 − 输入框」，页面不再滚动，卡片也不可能被盖住。改草稿导致 composer 变高时变量会跟着变。
- 布局：主区域是横的，所以卡片不再放底部 —— `inMainView && pinned !== void 0` 时把 body 和 detail 放进 `SIDEBAR_TAB_MAIN_VIEW_SPLIT`（`flex-direction: row`），右侧 `SIDEBAR_TAB_MAIN_VIEW_ASIDE`（`flex: 0 0 320px; minWidth: 240; maxWidth: 420; overflowY: auto`）；没选中提交时不分栏，避免空占 320px。侧边栏仍然是底部卡片，没变。
- `GitGraphMainView` 现在给 `GitGraphSidebarTab` 传 `mainView: true`，组件内 `const inMainView = props.mainView === true;`。

### 7.14.2 被并入的仓库文档只剩一行指针

- 现象：仓库级 `GIT_CONVENTIONS.md` 常被 git 跟踪，整合后它变成 228 字节的指针，指向 `../.dsh/GIT_CONVENTIONS.md` —— 别人 clone 下来根本看不到规则，等于提交了一个死链接。21:40 在本仓库真的发生过一次。
- 修法：`conventionPointerBody(target, original)` 在指针三行之后追加 `<!-- 合并前的原文 / the pre-merge copy follows -->` 与原文；`conventionsConsolidate` 把 `source.body` 传进去。指针标记仍在，所以 `conventionIsPointer()` / `repoConventionState()` 的 `pointer` 分支、`conventionsDocumentFor()` 的跳过逻辑都不变，只是文件对人仍然可读。
- 边界：原文保留会让文件变长，且 `parseConventionRules` 若直接读这个文件会把旧规则也算进来 —— 这就是为什么所有内部路径都先过 `conventionIsPointer()`。

### 7.14.3 测试与自检

- `test-host` 第 [18] 段加一条：「pointer keeps the pre-merge text so a clone still reads it」，总数 242 → **243/243**。
- `preview-tab` 新增一段 `main-area layout keeps the commit card off the composer ok`：挂载 `mainView: true` 的 tab，断言根节点 `height`/`maxHeight` 都含 `--dsh-conversation-viewport-height` 与 `--dsh-composer-height`、未选中提交时没有 `data-gitgraph-main-split`、点行后 split 恰好两个 pane（左 `data-gitgraph-sidebar-body`、右 `data-gitgraph-detail-aside` 且内含唯一 `data-gitgraph-detail`）、根节点直接子级里不再有 `data-gitgraph-detail`。
- 自检值：`build-lib` spliced **2843 / 3223 / 2153 / 449**、`patch-host` `already present 25`、`validate-lib` **187 键**、`test-host` **243/243**、`preview-tab` 全过。

## 7.16 1.13.1 的改动（只有智能体合并，插件不再合并）

### 7.16.1 用户的话与执行口径

用户看完 1.13.0 后的指示是「搞成只有 AI 整理这个功能」。因此不是「机械合并降级」，而是**整条删掉**：插件此后没有任何路径能自己合成一份规范，唯一写盘入口是 `git_conventions` 的 `write`，而它的正文必须由模型读过全部原文后写出。

保留的是「发现与报告」——它不产出规范，只回答「有哪些文档、它们在哪、哪里不一致」，正是触发智能体动手的那一步。

### 7.16.2 删了什么

- `src/host/conventions.js`（2303 → 2156 行）：`conventionsUnionSection`、`conventionsMergedBody`、`conventionsConsolidate` 三块整体删除；工具里删 `draft` 分支与 `write` 参数，`action` 枚举变为 `read | check | write`，未知动作文案改为 `action must be one of 'read', 'check', 'write'`。
- `scripts/patch-host.mjs`：`convention-conflict-routes` 只留只读的 `/git/conventions/conflicts`，并注明「Merging is the model's job, so there is no write route」。
- `lib/index.js`：删掉 `case "/git/conventions/consolidate"` 整个分支；现在打这个路由得到 **404 空 body**（走 `default: res.writeHead(404); res.end();`）。
- `scripts/build-lib.mjs`：GitApi 去掉 `conventionsConsolidate`，locale 去掉 11 个键 × 2 语言（`consolidateTitle/Warn/Confirm/Merge/Left/Keep/Draft/Cancel/Merged/Open/Single`），189 → **180**。
- `src/client/graph/SidebarTab.js`（→ 3104 行）：删掉 `consolidate` 状态、`reloadConflicts`、`previewConsolidate`、`confirmConsolidate`、`consolidatePanel` 及其挂载、`merged` 与 `single` 两个通知分支；「AI 合并」通知里的「先看机械并集草稿」退路按钮一并去掉。冲突条计数改用独立键 `sidebar.conventionsConflicts`（旧 `sidebar.conflicts` 被 git status 的「{count} 个冲突」占用），按钮文案改为 `sidebar.conflictsReview` = **交给 AI 合并 / Merge with AI**。

### 7.16.3 测试怎么改的

- 删掉的不再断言，改成断言**它不存在**：`test-host` [18] 与 [20] 各加一条 `POST /git/conventions/consolidate` 期望 `ok !== true`（实际 404 空 body），并顺手断言报告本身不写盘（原文档一字未变）。
- [19] 只走 `read` → `write`；`draft` 的三条断言删除。
- `preview-tab` tier-4 删掉机械并集整段，改为两条守卫：任何时刻 HTML 里都不许出现 `data-gitgraph-consolidate=`，且 `CONSOLIDATE_CALLS` 必须保持 0；头部也不再有 `conventions-consolidate-open`。
- 自检值：`build-lib` spliced **2843 / 3104 / 2156 / 449**、`patch-host` `already present 25`、`validate-lib` **180 键**、`test-host` **232/232**、`preview-tab` 8 组全过。

### 7.16.4 坑

- 删区间用注释行当边界时，**边界前一行常挂着还要用的常量**：第一刀把 `const CONVENTION_READ_MAX_CHARS = 20000;` 一起删了，`test-host` 直接 `ReferenceError`。删完要 grep 一遍关键标识符。
- 工具调用的 JSON 层会把 `\\t` 再折一次，所以脚本里要匹配 `patch-host.mjs` 那种字面 `\t` 转义的源码，必须用 `chr(92)` + `t` 拼。
- 以 `find("\n}];")` 当尾部锚点会吃掉模板字面量的收尾反引号。改 `scripts/build-lib.mjs` 一律先 `git show HEAD:scripts/build-lib.mjs > 临时文件`，在临时文件上改、`node --check` 过了再覆盖。

### 7.16.5 发布

- 版本 **1.13.1**，commit `619811b`，tag `v1.13.1`，release id `425586241`，资产 `dsh-git-graph-sidebar.tgz` **912561 字节**、sha256 `45e1b67ed76c9f73cc7a10853ce6bb1b1e9b80dea17b79c37f8282d992f77f6b`、154 条目、包内 version 1.13.1；经镜像 `releases/latest/download/dsh-git-graph-sidebar.tgz` 下载校验一致。包名不带版本号，市场条目 `latest/download` 自动跟随。
- `desktop` 已装 1.13.1（`pnpm add file:…/artifacts/dsh-git-graph-sidebar-1.13.1.tgz`，`- 1.13.0 / + 1.13.1`），`package.json` 与 `pnpm-lock.yaml` 六处全指 1.13.1、`1.13.0` 残留 0；已装 `lib/index.js` 188882 B（`conventionsConsolidate` / `consolidate` 各 0 处）、`lib/client.js` 248585 B（`conventions-ai-merge` 1 处、`sidebar.consolidateTitle` 0 处）。**装完必须重启 DSH。**

## 8. 待办清单（按优先级）

0. ~~发 1.12.0~~ **已完成**（commit `4e1a38e`、tag `v1.12.0`、release id `425494454`、资产 910380 字节、`desktop` 已装 1.12.0）。**用户需重启 DSH**：客户端新增的 `conversation.view` 注册只在启动时读取，`Ctrl+R` 不够。重启后侧栏规范条上应出现「在主区域打开」按钮。

1. ~~发 1.5.0~~ **已完成**（commit `2dcb974`、tag `v1.5.0`、Release 资产 `dsh-git-graph-sidebar.tgz` 834240 字节、`desktop` 已装 1.5.0）。
2. ~~发 1.6.0~~ **已完成**（commit `92f15a1`、tag `v1.6.0`、Release id `422695343`、资产 `dsh-git-graph-sidebar.tgz` 854388 字节、`desktop` 已装 1.6.0）；用户需重启 DSH 才能用上三条新路由。原始步骤留档：
   - `package.json:3` → `1.6.0`（唯一要改的版本号）；
   - 跑 §10 的全链路自检（应得 `spliced 2991 / 1278 / 329`、`already present 22`、`178 locale keys`、`132/132`、预览 9 节全过）；
   - `mkdir -p ../dsh-git-graph-dist/1.6.0 && npm pack --pack-destination ../dsh-git-graph-dist/1.6.0`，并复制一份无版本名；
   - commit（`feat(conventions): commit compliance, workspace document and upgrade preview (tier 3)`）→ `git gpush` → tag `v1.6.0` → GitHub Release（资产名 `dsh-git-graph-sidebar.tgz`）；tag 的 sha 必须用 `git rev-parse v1.6.0` 现取，别手写；
   - 换装 `desktop`：`node "C:/Users/18316/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/pnpm/bin/pnpm.mjs" add "file:E:/git-graph/dsh-git-graph-dist/1.6.0/dsh-git-graph-sidebar.tgz"`（先备份 profile 的 `package.json`）；
   - 让用户**重启 DSH**（三条新路由是 host 侧，不重启不生效）。
3. **市场收录 PR**：门槛 = 仓库满 1 天 = `2026-10-24T22:07:00+08:00`。之后：
   ```bash
   bash "E:/git-graph/.market-pr/open-pr.sh"
   ```
   （先 `--check` 看状态；脚本自带门禁，通过后自动开 PR，head = `Athosoo:add/athosoo-dsh-git-graph-sidebar`，只含 `data/plugins/Athosoo__dsh-git-graph-sidebar.yml` 8 行。）
5. ~~发 1.9.0~~ **已完成**（commit `94923c9`、tag `v1.9.0`、Release id `423280585`、资产 `dsh-git-graph-sidebar.tgz` 874347 字节、`desktop` 已装 1.9.0）。
5a. ~~发 1.9.1~~ **已完成**（只含客户端半边，实机无效）：标签退出筛选排、少于 4 枚不画这一排、清掉 `sidebar.expandGraph` 死键。
5b. ~~发 1.9.2~~ **已完成**：补上 `lib/index.js:616` 保留 `tag: ` 前缀 + `test-host` 第 [16] 段真标签断言；`spliced 2843 / 1560 / 449`、`patch-host` 23 处、166 个 locale 键、host **189/189**、预览 10 节全过。用户需重启 DSH 才看得到新的引用标签。下一版候选：图谱分页（host 已算 `hasMore`，`lib/index.js` 里 `/git/log` 支持 `limit`，tab 还没有「加载更早」入口）、真历史搜索（`--grep` / `--author` / `--since`）、状态条显示落后上游、详情卡加 `--stat`、PNG 导出（需要光栅化）。
4. ~~发 1.7.0~~ **已完成**（commit `a1c4619`、tag `v1.7.0`、Release id `422753809`、资产 `dsh-git-graph-sidebar.tgz` 852091 字节、`desktop` 已装 1.7.0；`patch-host` 24 处、`148/148`、158 个 locale 键）。下一版（Tier 4，尚未在 ROADMAP 立项）候选：提交信息模板（按文档生成 `type(scope): 描述`）、合规结果接进 `systemPrompt` 让模型自己避免、把仓库体检的「大未跟踪文件」做成可点开列表。
5. ~~发 1.8.0~~ **已完成**：主题语言（1.7.3 的改动）+ 扫描成本；`patch-host` 22 处、`174/174`、166 个 locale 键。
6. ~~发 1.8.1~~ **已完成**：开关即刻落盘、界面读文档、工作区总纲带开关、容器读工作区文档；`patch-host` 23 处、`186/186`、166 个 locale 键。
7. ~~发 1.10.0~~ **已完成**（commit `8cad121`、tag `v1.10.0`、release id `425076679`、资产 `dsh-git-graph-sidebar.tgz` 900982 字节、`desktop` 已装 1.10.0）。发布内容：AI 署名三态、排他性检测、一键整合、`git_conventions` 工具。发版照 §5，资产名仍是不带版本号的 `dsh-git-graph-sidebar.tgz`；自检结果：`spliced 2843 / 3049 / 2102 / 449`、`already present 25`、`181 locale keys`、`232/232`、`preview-tab` 12 段全过。**用户需重启 DSH 才能看到新面板与新路由。** 下一步候选：市场条目文案还没跟上 1.10.0（描述里仍写「flags the last 20 commit subjects」），以及「明确说明本插件依托 dsh-better-sidebar」的独立一句，两件事一起提一个 PR。**已完成**：分支 `update/athosoo-dsh-git-graph-sidebar-1100`、commit `e7da492d2`、PR [#9767](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/9767)，两项检查均已通过。
8. ~~发 1.11.0~~ **已完成**（commit `14e2e72`、tag `v1.11.0`、release id `425422415`、资产 `dsh-git-graph-sidebar.tgz` 904153 字节、`desktop` 已装 1.11.0）。发布内容：散文文档（`AGENTS.md` / `CLAUDE.md` / `.cursorrules` / `CONTRIBUTING.md`）里的规则也能检出并整合。自检：`spliced 2843 / 3079 / 2149 / 449`、`already present 25`、`185 locale keys`、host **242/242**、`preview-tab` 12 段全过。**用户需重启 DSH 才能看到新行为（注入提示里的 `AGENTS.md` 一行与面板的「保留原地」）。**
9. ~~发 1.13.0~~ **已完成**（commit `9534f1e`、tag `v1.13.0`、release id `425545057`、资产 `dsh-git-graph-sidebar.tgz` 919392 字节、`desktop` 已装 1.13.0）。发布内容：合并改由智能体读文档后自己写（`git_conventions` 增 `read` / `write`，旧的 `consolidate` 退为 `draft`）、提示词改口、面板改为把请求复制到剪贴板。自检：`spliced 2843 / 3253 / 2303 / 449`、`already present 25`、`189 locale keys`、host **252/252**、`preview-tab` 8 组全过。**用户需重启 DSH。** 下一步候选：市场条目文案仍是 1.11.0 口径（写的是一键整合），要与 1.13.0 的「智能体自己读自己写」对齐可再提一次 PR。
6. 下一步候选（未立项）：图谱分页（host 已经返回 `hasMore`，tab 还没有「加载更早」入口）、真历史搜索（`/git/log --grep/--author/--since`）、状态条显示落后上游、详情卡 `--stat`、PNG 导出（现在只有 SVG）；性能上还可以让首屏流式返回（先给目录树，再补状态）。

10. ~~发 1.13.1~~ **已完成**（按用户指示删掉机械合并：`conventionsConsolidate` / `conventionsUnionSection` / `conventionsMergedBody`、`/git/conventions/consolidate` 路由、工具 `draft`、客户端合并面板与 11 个 locale 键全部移除；合并只剩智能体读文档后自己写。自检：`spliced 2843 / 3104 / 2156 / 449`、`already present 25`、`180 locale keys`、host **232/232**、`preview-tab` 8 组全过。**用户需重启 DSH。**）

## 9. 坑与教训（每条都真踩过）

1. **性能计时，先取窗口再取数。** 计数/计时用的快照必须在「被测工作结束之后」取；1.8.0 第一版把 `repoTakeProbeCounters()` 放在 `await repoAugment()` 之前，`timings.probeSpawns` 永远是 0，靠临时 `console.error` 打了两轮才看出来。
2. **锚点在被手工维护的 region 里，补丁迟早变成地雷。** `scripts/patch-host.mjs` 里给 `repoScan()` 打的三段补丁（`repo-scan-conventions` / `repo-scan-view` / `repo-scan-augment`）锚点就落在后来重写的行上：改完代码后每次 `patch-host` 都会重插一遍或直接抛 `anchor not found`。repos region 没有 `src/` 副本，改动就该直接改 `lib/index.js` 并删掉对应补丁。
3. **绝对不要用 `link:` 装工作区目录做插件。** `remove_bundle` 会把软链目标目录**清空**（曾把整个工作副本删掉）。一律 `npm pack` 到 `dsh-git-graph-dist/<ver>/` 后按 `file:...tgz` 安装。
4. **Python 写文件必须 `newline="\n"`**，否则 CRLF 会让 build-lib 的 `\n//#endregion` 标记匹配失败。
5. **不要在 shell 字符串里写含反引号/`$`的 payload**：一次 `echo` 里的 `` `git init` `` 被执行，在工作区根建了一个假 `.git`。payload 一律先写文件再 `--data-binary @file`。
6. **GitHub Release API 只吃 JSON**（`--data-binary`），`-F` multipart 报 `Problems parsing JSON`；创建前先用 `POST /git/refs` 建 tag 更稳；资产名必须**无版本**。
7. **`desktop` profile 被 Electron 独占**：`dsh plugin --profile desktop add ...` 会报 `managed exclusively`；装 tgz 只能用 `plugin_manager` 或应用内插件页。
8. **host 半边不热更**：新路由/`systemPrompt` 注入必须重启 DSH；`/git/*` 在未加载时返回 405/404。
9. **better-sidebar 关闭 tab 会卸载组件**（`split-pane.tsx` 注释明说），所以重开必须靠 `SIDEBAR_TAB_CACHE` 模块级缓存（按 `sessionId|cwd`，保留 6 个会话）。
10. **`preview-tab.mjs` 的假运行时**：`mount.tree` 只在 `render()` 时刷新——点击后必须 `await mount.render()` 才能找到新节点；`setInterval` 要 `unref()` 否则进程挂住；`<select value>` 要序列化成 `selected`；受控 `<input value>` 需要序列化 `value`。
11. **`validate-lib.mjs` 是标配**：它抓「t() 用了但字典没有」和「分叉标识符没定义」——只有 `node --check` 抓不到的自由变量错误靠它。
12. **`test-host.mjs` 的 `equal()` 第三参是 detail 不是期望值**，判断要用 `check()`；`git()` 辅助不返回 stdout。
13. **gh-proxy.com 对认证 API 会伪装成别人**（返回代理账号身份），认证请求直连 `api.github.com`。
14. **端口会变**：每次 DSH 重启 GUI 端口都不同，探测 `/git/repos` 前先读 runtime context，且 curl 超时要给足（冷启动 3 秒会 000）。
15. **`lib/*.js` 的 region 内永手改**：手改会在下次 `build-lib.mjs` 被覆盖；要改就改 `src/**` 或 `scripts/patch-host.mjs`。
16. **`build-lib.mjs` 的字典插入是按字典块判定的**（zh/en 各自），早期版本曾因为「全文件查 key」导致 en 漏插 4 个键。
17. **长命令会被截断**：`ops_bash` 一次塞太长的 `cat > x <<'PY' … PY` 会被砍掉尾部（heredoc 未闭合，写出的脚本只剩前若干行）。长脚本要分块 `python - <<'PY'` 追加写。
18. **多层引号里的反斜杠会掉一层**：Python 三引号里的 `\\n` 生成出来是真换行（`out.join("` + 换行 → `SyntaxError: Invalid or unexpected token`），正则 `[\\/]` 也会退化成 `[\/]`（匹配不到反斜杠）。写这类字符用 `chr(92)`/`chr(10)` 拼，别依赖转义层数。

19. **新路由/新方法先 grep 上游有没有同名**：`/git/branches` 和 `GitApi.branches()` 都是上游已有的，同名会让 `switch` 只命中前一个 case、`API_METHODS` 的 guard 误判「已存在」而跳过注入。最终用 `/git/cleanup` + `/git/health`、`cleanupBranches()` + `repoHealth()`。
20. **region 头归 build-lib 所有**：patch-host 若也插 `//#region src/host/branches.ts`，第二次 build 会留下一个空 region（实测重复出现两次）。现在 build-lib 发现缺头时自己插 `region + //#endregion` 再 splice，patch-host 只负责路由与扫描挂载（21 处）。
21. **按锚点切文件后立刻 `node --check`**：一次用 `s.index(...)` 切 patch-host 的新增段，把相邻两个 `patch(` 调用一起吞掉，`node --check` 报 `missing ) after argument list`——切完先查语法再往下做。
22. **`git count-objects -v` 的 KB 会四舍五入成 0**：小仓库 `size: 0`，别断言 `gitBytes > 0`，用对象数（`count` + `in-pack`）判断 `.git` 是否读到。

23. **locale 键的引号会被外层吃掉**：用 python heredoc 写 `['"sidebar.x"', '"值"']` 时容易生成 `["sidebar.x", "值"]`，build-lib 插出 `sidebar.compliance: 提交合规`（无引号）→ `lib/client.js:1714 SyntaxError: Unexpected token '.'`。可靠写法：`Q = chr(34); OPEN = chr(39) + Q; CLOSE = Q + chr(39)`；已损坏的行用 `re.compile(r"^[ \t]*sidebar\.(compliance|preview|workspaceDoc)[A-Za-z]*: .*,$", re.M)` 删掉再重跑 build-lib。
24. **python 字符串里的 Windows 路径会语法报错**：`"...\Users\18316\..."` 触发 `SyntaxError: (unicode error) 'unicodeescape' codec can't decode bytes ... truncated \UXXXXXXXX escape`，`\d`/`\s` 则被吞成 `d`/`s`。用 `chr(92)` 拼、写 raw string，或把长文本先 `cat > .tmp.md <<'MD'`（单引号 heredoc 不解析反斜杠）再让 python 读文件插入。
25. **给预览页做「浅色变体」前先确认 CSS 支持**：`.html.replace("<body>", '<body data-theme="light">')` 只对含 `body[data-theme="light"]` 覆盖的页面（hero/overview）有效；states 页没有这些覆盖（`grep -c light preview/graph-tab-states.html` = 0），硬写出来是假的浅色页，已删。
26. **截图单面板要拼独立 HTML**：Chrome 传相对路径会 `net::ERR_HTTP_RESPONSE_CODE_FAILURE`，必须 `file:///C:/...` 绝对 URL；只想拍某一段时用 python 从生成页里 `s.index("<h2>Upgrade preview")` 切片，套上 shell 的 head/style 另存 `%TEMP%\preview-only.html`。

27. **`git checkout -- lib/*.js` 会把换行变成 CRLF**：仓库 `core.autocrlf=true`，blob 是 LF、检出成 CRLF，而 build-lib 的 `REGION_END = "\n\t\t//#endregion\n//#region src/client/index.ts"` 是 LF 字面量 → 直接报 `region end marker not found in lib/client.js`。恢复 `lib/` 后先 `python` 把 `\r\n` 换成 `\n` 再 build（提交时 git 会自己转回 LF，不会产生差异）。
28. **同一个 `switch` 里的多处补丁要各自带 guard**：`patch()` 的幂等判定是 `source.includes(replacement)`，可一旦后一个补丁把新 case 插进前一个补丁的「块 + 锚点行」之间，replacement 就再也不是连续文本 → 每次运行都重复插入（实测 `case "/git/init"` 累积到 7 份、`lib/index.js` 从 3743 涨到 4636 行）。现在 `patch(label, anchor, replacement, guard)` 支持第四参，第 9/13 段分别用 `'\t\t\tcase "/git/init": {'`、`'\t\t\tcase "/git/compliance": {'` 判定，连跑两次稳定输出 `applied 0, already present 22`。

29. 拼 JS 正则时 `\b` 的 `b` 会被 python 字符串吃掉（写成 `"\bstatus"` 结果是 `\status`），`SyntaxError: Invalid regular expression: missing /` 只在 `node --check lib/index.js` 时才暴露 → 正则里出现反斜杠一律用 `chr(92)` 拼，或者把整段 JS 用 quoted heredoc 写进文件再插入。
30. **按行号删代码必须两端都断言**：想删 `sidebarTabReasonLabel()` 时用「从函数行往下找第一个 `	}`」定位结尾，可它的收尾是 `		}`（2 tab），于是循环一路吃到 30 行之后的另一个 1 tab `}`——`SIDEBAR_TAB_CACHE` 的定义被删掉，`node --check lib/client.js` 依然通过，只有 `validate-lib` 的 `unresolved identifiers: sidebarTabCacheEntry, SIDEBAR_TAB_CACHE` 抓到了。现在删区间都写成「先断言起始行的 `/**` 或函数签名、再断言收尾行内容、再断言收尾行的下一行长什么样」，并用 `git diff --stat` 核对删掉的行数与预期相符。
` 会变成真换行**：在 `python - <<'PY'`（单引号 heredoc，本该原样保留）里写 `'console.log("\n[16] …")'`，落到文件里变成 `console.log("` + 真换行 → `SyntaxError: Invalid or unexpected token`（本次连踩两次，第一次在 `scripts/test-host.mjs:708`）。可靠写法：`B = chr(92)`、`N = chr(10)`，所有反斜杠用 `B + "n"` 拼；长 JS 用 `cat > ../.tmp/x.js <<'JSEOF' … JSEOF` 先落盘。
[15] …");` 这种 anchor 受转义层数影响极难对齐（先试 `s.count(anchor)` 得 0），改成 `idx = [i for i,l in enumerate(lines) if "[15] switch-only" in l]` + `lines[at:at] = block`，一次成功。定位用「内容片段」、写入用「整行列表」，比反复数反斜杠快得多。
31. **往 `EXTRA_KEYS` 里插字典项要连缩进和逗号一起带**：只写 `['"sidebar.ruleTypes"', '"…"']` 会把裸数组甩在数组外，`build-lib` 直接 `TypeError: Cannot read properties of undefined`；而 `["brew…` 这种 `Q` 拼法也匹配不到文件里实际存在的 `['"sidebar.xxx"'`。可靠做法：`T*3 + "['" + Q + "sidebar." + key + Q + "', '" + Q + value + Q + "'],"`，写完 `sed -n` 看一眼再跑 build。
32. 用户说「设置了不生效」时，先数链路节点：界面状态 → 请求 payload → 路由 → 写盘 → 回读 → 注入。这次四个节点各断一处，逐个用 `grep` 验证比猜快得多。
33. **fixture 自带的字符串形态，必须与真主机返回的一致**：1.9.1 里客户端已经能把 `tag: v1.0.0` 和 `main` 分开，`preview-tab` 全绿，但实机完全没变化——因为 `preview-tab.mjs` 的 fixture 是手写的 `["HEAD -> main", "main", "origin/main", "tag: v1.0.0"]`，而真主机 `lib/index.js:616` 一直在 `.replace(/^tag: /, "")`。客户端逻辑测的是一个真实链路永远不会产生的形状。**凡是「host 产出 → client 消费」的字段，测试要么两边都用真数据（`test-host` 建真仓库、真 tag、真 remote），要么在 fixture 上写明它是假的。** 1.9.2 加的第 [16] 段就是这条的形状：`git tag -a` 真打标签，再断言 `/git/graph` 的 refs 里有 `tag: v1.0.0`、没有 `v1.0.0` 裸名。
34. **`ops_bash` 会吃掉一层反斜杠，`
35. **按「行内文本」插入测试块比按整行字符串做 anchor 更稳**：`	console.log("

## 10. 下一步照做即可（最短路径）

```bash
cd "E:/git-graph/dsh-git-graph-src"
# 1) 全链路自检（都应为绿）
node scripts/build-lib.mjs && node scripts/patch-host.mjs
node --check lib/client.js && node --check lib/index.js
node scripts/validate-lib.mjs && node scripts/test-host.mjs
node scripts/preview-tab.mjs
# 2) 打包（版本号与目录名一致；cp 一份无版本名的给 Release 资产）
npm pack --pack-destination "../dsh-git-graph-dist/1.10.0"
cp "../dsh-git-graph-dist/1.10.0/dsh-git-graph-sidebar-1.10.0.tgz" "../dsh-git-graph-dist/1.10.0/dsh-git-graph-sidebar.tgz"
# 3) commit + push，建 tag/Release（资产名无版本），换装，让用户重启
# 4) 22:07 之后：bash ../.market-pr/open-pr.sh
```

## 11. 参考索引

- 路线图与逐项验收标准：`ROADMAP.md`（本仓库内）
- 开发说明（布局、构建、发布、host 两处 region）：`DEVELOPMENT.md`
- 用户向文档（中英双语）：`README.md` / `README.zh.md`
- 上游来源与改动归属：`NOTICE`（上游 `@linxin666/dsh-client-ui-git-graph` 0.4.8）
- 方案与早期评估：`E:\git-graph\git-graph-sidebar-multirepo-plan.md`
