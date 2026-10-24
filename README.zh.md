# dsh-git-graph-sidebar

[English](README.md) | 中文

一个给 DeepSeek Harness（DSH）用的 Git 浏览插件：输入框旁的**分支徽章**，以及 [dsh-better-sidebar](https://www.npmjs.com/package/dsh-better-sidebar) 里的**仓库图谱**页——把当前工作区目录往下发现的每个 Git 仓库列出来，并把选中仓库的提交图渲染成 SVG 泳道画布。

![仓库图谱页，深色主题](assets/shot-dark.png)

## 功能

### 仓库图谱页（better-sidebar）

它把会话的工作目录当作一个容器：目录下面所有 Git 仓库都能直接访问，不需要把每个仓库单独注册成 DSH 工作区。

- **多级仓库发现**——工作区根目录本身，加上最多 3 层以内的嵌套仓库。每个条目带当前分支、短 head、脏文件数与冲突数。
- **仓库树**——根目录、中间目录、每个仓库按层级排开，层级关系直接看得见，而不是靠路径去猜。
- **SVG 提交图**——一次提交一行，一条分支一条彩色泳道，父提交在别的泳道时画曲线连接，合并提交画成菱形，带 ref 徽章与相对时间。
- **缩放**——默认双行；`−` / `+` 把行与文字一起放大缩小，从紧凑单行到宽松列表。
- **提交详情卡**——图下方的卡片始终显示你点选的提交：完整 hash、主题、作者、绝对提交时间、引用与父提交。点一行固定，再点一次（或 `×`）取消。
- **复制给 AI**——「复制提交信息」把一段可直接粘贴的文本放进剪贴板（仓库路径、hash、主题、作者、时间、引用、父提交），要模型「回滚到这个提交」时不用再手打；「复制 SHA」只复制完整 hash。
- **全屏查看**——侧栏窄，图谱可以铺满整个窗口打开，缩放、仓库与固定提交保持一致，`Esc` 关闭。
- **自动更新且不闪烁**——页面订阅宿主的 Git 变更事件，同时自己安静地后台轮询，新提交、新分支会自己出现。每次后台刷新都保留当前内容：结果没变化就不重渲染，轮询失败也不会把已有数据换成报错。
- **刷新**——按需重新扫描；手动刷新期间同样保留面板内容。宿主对一次扫描结果缓存 60 秒（点刷新会绕过缓存）。
- **Git 规范**——图上方一条状态带标出当前仓库的规范文档状态（`草稿` / `已定稿` / 未建立），可一键在编辑器打开，并为全新仓库提供六套验证过的框架来起步。

### 分支徽章（输入框）

沿用上游插件的徽章：空白会话里可以切换或新建分支，并打开交互式提交图对话框与 worktree 管理器。分支操作在宿主进程中执行；活跃会话上徽章自动隐藏。

## 运行要求

| 项目 | 值 |
| --- | --- |
| DSH | `>=0.2.1-rc.2 <0.3.0-0` |
| Node（宿主运行时） | `^22.19.0 \|\| >=24.0.0` |
| `dsh-better-sidebar` | **只影响图谱页**——没装时插件照常加载、徽章照常工作，只是不注册这个页 |

## 安装

从 [最新 Release](https://github.com/Athosoo/dsh-git-graph-sidebar/releases/latest) 下载预构建包 `dsh-git-graph-sidebar.tgz`（无需构建），当成插件 bundle 安装：

- **桌面版**（`desktop` profile 由 Electron 应用独占，CLI 会拒绝）：在应用的插件页里安装这个 `.tgz`。
- **CLI 管理的 profile**：

  ```sh
  dsh plugin --profile <profile> add github:Athosoo/dsh-git-graph-sidebar
  # 或用已下载的 tarball
  dsh plugin --profile <profile> add ./dsh-git-graph-sidebar.tgz
  ```

**装完需要重启 DSH。** 宿主那一半在启动时注册 `/git/*` HTTP 路由，首次安装仅刷新页面不够；升级到新构建同样要重启进程才会被加载。

图谱页需要 [`dsh-better-sidebar`](https://github.com/omdsh-dev/DSH-better-sidebar)；没装它时，分支徽章、图谱对话框、worktree 全部照常工作，只是没有那个侧栏页。

## 仓库发现规则

| 规则 | 值 |
| --- | --- |
| 扫描深度 | 工作目录往下 3 层（某层命中仓库后不再向下钻） |
| 数量上限 | 单次最多 200 个仓库，超出后结果标记为截断 |
| 跳过的目录名 | `node_modules`、`dist`、`build`、`out`、`coverage`、`target`、`vendor`，以及所有点开头目录 |
| 仓库判定 | 存在 `.git` 条目（目录、文件或符号链接都算，因此 worktree 与 submodule 都能识别） |
| 单条状态预算 | 5 秒；`git status` 超时的条目仍会列出，只是没有分支元信息 |
| 缓存 | 按基路径缓存 60 秒，并发请求共用一次扫描；面板上的刷新按钮会绕过缓存 |

## Git 规范

提交图记录「已经发生了什么」，规范文档记录「下次打算怎么做」。图谱页可以为它列出的每个仓库架起这份文档。

- **文档由你定**——插件不替你编团队规矩。它写出的是一份空壳：六节都标着 `待定`、`status: draft`，决定权留给团队，而不是继承别人的默认值。

- **由新仓库触发**——还没有文档、且一次提交都没有（`unborn HEAD`）的仓库，会自动建出空壳并直接弹出框架选择；已有提交但缺文档的仓库只显示「未建立」，点一下即写空壳。

- **六套验证过的框架**——选中一套即把完整模板写进文档，并置为 `status: settled`：

  | 框架 | 适合 |
  | --- | --- |
  | 约定式提交（Conventional Commits） | 需要从提交信息自动生成变更日志与语义化版本的项目 |
  | GitHub Flow | 从 `main` 发布、用短生命周期功能分支的小团队 |
  | Git Flow | 需要在多套环境间推进版本发布的项目 |
  | 主干开发（Trunk-based） | 持续交付、分支生命极短的团队 |
  | 约定式分支（Conventional Branch） | 分支名要编码类型与 issue 编号的团队 |
  | GitLab Flow | 在 `main` 与生产之间显式设置环境分支的团队 |

- **绝不覆盖**——已存在的文档只有在请求带 `force` 时才会被替换，界面不会对已定稿的文档提供这个选项。文档是仓库根目录里的普通 Markdown，可以像源码一样评审和修改。

## HTTP 路由

由宿主半边注册在 `/git` 下，除 `/git/events` 是 SSE 事件流外，其余都返回 JSON（`{ok:true,value}` / `{ok:false,error}`）。

| 路由 | 用途 |
| --- | --- |
| `/git/repos` | 多级仓库发现（`{path, refresh?}`） |
| `/git/status` | 分支、head、脏文件/未跟踪/冲突数量 |
| `/git/branches` | 分支列表（标出当前分支） |
| `/git/graph` | 提交列表与父提交、refs（`{path, limit?}`） |
| `/git/switch` | 切换分支 |
| `/git/create-branch` | 新建并切换 |
| `/git/worktrees` | worktree 列表 |
| `/git/worktree-add` | 创建 worktree |
| `/git/worktree-remove` | 删除 worktree |
| `/git/conventions` | 某仓库的规范文档状态 + 框架目录（`{path}`） |
| `/git/convention` | 写入规范文档（`{path, framework?, force?}`） |
| `/git/events` | 变更通知（界面轮询） |

每个路由都会先 `realpath` 解析请求路径，只有在某个已注册工作区**内部**时才放行；嵌套仓库目录会被接受，工作区之外的路径返回 `workspace-unknown`。

## 已知限制

- **图谱页不碰 Git 状态。** 它只写一样东西：规范文档，而且只在被要求时写（或对一个还没有提交的新仓库自动写）。切换分支、worktree 操作仍在徽章的对话框里。
- **不要和 `@linxin666/dsh-client-ui-git-graph` 同时安装。** 两者都占用 `/git` 这个路由前缀，重复注册会冲突，二选一。
- **超过 3 层的仓库不会被列出**；位于被跳过目录名（`node_modules`、`dist` 等）里的仓库同样不会列出，这是设计如此。
- **宿主半边是构建产物。** `lib/index.js` 是直接改的（新增部分在带标记的 `//#region` 块里）；`lib/client.js` 由 `src/client/graph/SidebarTab.js` 拼接生成。细节见 [DEVELOPMENT.md](DEVELOPMENT.md)。

## 开发

```sh
npm run build     # 把 src/client/graph/SidebarTab.js 拼进 lib/client.js
npm run check     # 对两个 bundle 跑 node --check
npm run validate  # 校验每个 t("…") 键在两套语言字典里都存在
npm run preview   # 不启动 DSH，直接渲染出 preview/*.html
```

`npm run preview` 会写出独立的 HTML（深色与浅色各一份），用示例仓库与提交展示这个页，改完布局可以直接在浏览器里看，不用装进 DSH。

## 归属与许可

Apache-2.0——见 [LICENSE](LICENSE) 与 [NOTICE](NOTICE)。

本项目是 linxin666 的 [`@linxin666/dsh-client-ui-git-graph`](https://www.npmjs.com/package/@linxin666/dsh-client-ui-git-graph) 0.4.8（同为 Apache-2.0）的分叉：分支徽章、提交图对话框、worktree 管理器与宿主 git 服务来自上游。本分叉的改动：重命名包、把工作区校验从「路径完全相等」放宽到「位于工作区内」、新增 `/git/repos` 发现路由、新增 better-sidebar 图谱页（仓库树、SVG 画布、缩放、提交详情卡）及其语言键。
