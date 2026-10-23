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
- **缩放**——默认双行；`−` / `+` 收成紧凑单行或展开。
- **提交详情卡**——点击某一行，固定显示完整 hash、主题、作者、时间与父提交数。
- **刷新**——按需重新扫描；宿主对一次扫描结果缓存 60 秒。

### 分支徽章（输入框）

沿用上游插件的徽章：空白会话里可以切换或新建分支，并打开交互式提交图对话框与 worktree 管理器。分支操作在宿主进程中执行；活跃会话上徽章自动隐藏。

## 运行要求

| 项目 | 值 |
| --- | --- |
| DSH | `>=0.2.1-rc.2 <0.3.0-0` |
| Node（宿主运行时） | `^22.19.0 \|\| >=24.0.0` |
| `dsh-better-sidebar` | **只影响图谱页**——没装时插件照常加载、徽章照常工作，只是不注册这个页 |

## 安装

从 GitHub 装：

```sh
dsh plugin --profile desktop add github:Athosoo/dsh-git-graph-sidebar
```

或从 Release 的预构建 tarball 装（无需构建步骤）：

```sh
curl -L -o dsh-git-graph-sidebar.tgz \
  https://github.com/Athosoo/dsh-git-graph-sidebar/releases/latest/download/dsh-git-graph-sidebar.tgz
dsh plugin --profile desktop add ./dsh-git-graph-sidebar.tgz
```

装完需要重启 DSH：宿主那一半在启动时注册 HTTP 路由，首次安装仅刷新页面不够。

## 仓库发现规则

| 规则 | 值 |
| --- | --- |
| 扫描深度 | 工作目录往下 3 层（某层命中仓库后不再向下钻） |
| 数量上限 | 单次最多 200 个仓库，超出后结果标记为截断 |
| 跳过的目录名 | `node_modules`、`dist`、`build`、`out`、`coverage`、`target`、`vendor`，以及所有点开头目录 |
| 仓库判定 | 存在 `.git` 条目（目录、文件或符号链接都算，因此 worktree 与 submodule 都能识别） |
| 单条状态预算 | 5 秒；`git status` 超时的条目仍会列出，只是没有分支元信息 |
| 缓存 | 按基路径缓存 60 秒，并发请求共用一次扫描；面板上的刷新按钮会绕过缓存 |

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
| `/git/events` | 变更通知（界面轮询） |

每个路由都会先 `realpath` 解析请求路径，只有在某个已注册工作区**内部**时才放行；嵌套仓库目录会被接受，工作区之外的路径返回 `workspace-unknown`。

## 已知限制

- **图谱页是只读的。** 切换分支、worktree 操作目前仍在徽章的对话框里，还没有搬进这个页。
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
