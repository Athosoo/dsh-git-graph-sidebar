// Splice the fork's sidebar-tab region into the prebuilt client bundle.
//
// The published 0.4.8 package ships `lib/client.js` (a plain
// `window.__ModuleLoader__.load({ factory })` wrapper, no transpiler needed).
// Rather than hand-editing that 2500-line artifact, the fork keeps the tab
// implementation in `src/client/graph/SidebarTab.js` and this script copies it
// between the `//#region src/client/graph/SidebarTab.tsx` markers, then makes
// sure the bundled zh/en dictionaries carry the extra keys.
//
//   node scripts/build-lib.mjs      # rewrite lib/client.js
//
// Idempotent: re-running replaces the region again with the current source.
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const regionFile = join(root, "src/client/graph/SidebarTab.js");
const libFile = join(root, "lib/client.js");

const REGION_START = "\t\t//#region src/client/graph/SidebarTab.tsx";
const REGION_END = "\n\t\t//#endregion\n//#region src/client/index.ts";

const EXTRA_KEYS = [
	{
		anchor: '"sidebar.commitsLanes"',
		// The first occurrence is the zh dictionary, the second the en one.
		entries: [
			['"sidebar.zoomIn"', '"放大图谱"'],
			['"sidebar.zoomOut"', '"缩小图谱"'],
			['"sidebar.detail"', '"提交详情"'],
			['"sidebar.parents"', '"{count} 个父提交"'],
			['"sidebar.repos"', '"{count} 个仓库"'],
			['"sidebar.expand"', '"展开仓库树"'],
			['"sidebar.collapse"', '"收起仓库树"'],
			['"sidebar.workspaceRoot"', '"工作区根"'],
			['"sidebar.expandGraph"', '"全屏查看"'],
			['"sidebar.close"', '"关闭"'],
			['"sidebar.copyInfo"', '"复制提交信息"'],
			['"sidebar.copySha"', '"复制 SHA"'],
			['"sidebar.copied"', '"已复制"'],
			['"sidebar.author"', '"作者"'],
			['"sidebar.committedAt"', '"提交时间"'],
			['"sidebar.references"', '"引用"'],
			['"sidebar.commit"', '"提交"'],
			['"sidebar.subject"', '"主题"'],
			['"sidebar.detailHint"', '"点击任一提交查看详情"'],
			['"sidebar.repoPath"', '"仓库"'],
			['"sidebar.parentsLabel"', '"父提交"'],
			['"sidebar.conventions"', '"Git 规范"'],
			['"sidebar.conventionsNone"', '"未建立"'],
			['"sidebar.conventionsDraft"', '"草稿"'],
			['"sidebar.conventionsSettled"', '"已定稿"'],
			['"sidebar.conventionsMissing"', '"这个仓库还没有 Git 规范。建议先定下提交与分支约定，再继续提交。"'],
			['"sidebar.conventionsSetup"', '"建立规范"'],
			['"sidebar.conventionsPick"', '"选一套经过验证的框架，或先建立空文档由团队填写。"'],
			['"sidebar.conventionsScaffold"', '"只建空文档"'],
			['"sidebar.conventionsCancel"', '"取消"'],
			['"sidebar.conventionsOpen"', '"查看文档"'],
			['"sidebar.conventionsAuto"', '"已为空仓库建立规范文档，请选择一套框架定稿。"'],
			['"sidebar.conventionsApplied"', '"规范文档已写入。"'],
			['"sidebar.conventionsWriting"', '"写入中…"'],
			['"sidebar.conventionsBestFor"', '"适合："'],
			['"sidebar.error.conventions"', '"读取或写入 Git 规范失败"'],
			['"sidebar.initRepo"', '"初始化 Git 仓库"'],
			['"sidebar.initRepoHint"', '"这个文件夹还不是 Git 仓库。可以直接在这里初始化，工作区里的其它仓库不受影响。"'],
			['"sidebar.initBranch"', '"初始分支"'],
			['"sidebar.initConfirm"', '"初始化"'],
			['"sidebar.initCancel"', '"取消"'],
			['"sidebar.initRunning"', '"正在初始化…"'],
			['"sidebar.initAfter"', '"初始化后会自动建立 Git 规范文档，并提示选择框架。"'],
			['"sidebar.error.init"', '"初始化 Git 仓库失败"'],
			['"sidebar.copyRollback"', '"复制回滚提示"'],
			['"sidebar.rollbackIntro"', '"请把我的仓库回滚到某个提交（只描述，不要直接执行）。"'],
			['"sidebar.rollbackAfter"', '"该提交之后，当前视图里还有 {count} 个提交。"'],
			['"sidebar.rollbackOptions"', '"候选做法"'],
			['"sidebar.rollbackSafe"', '"安全，保留历史，适合已推送的分支"'],
			['"sidebar.rollbackHard"', '"丢弃该提交之后的提交，已推送的分支慎用"'],
			['"sidebar.rollbackPick"', '"只把这一条提交搬到别的分支"'],
			['"sidebar.rollbackConfirm"', '"请先确认用哪一种，并说明会丢失哪些提交。"'],
			['"sidebar.search"', '"搜索提交（主题 / 作者 / SHA / 引用）"'],
			['"sidebar.refFilter"', '"点击切换该引用的提交"'],
			['"sidebar.filtered"', '"{shown} / {total} 条匹配"'],
			['"sidebar.noMatch"', '"没有匹配的提交"'],
		]
	},
	{
		anchor: '"sidebar.commitsLanes"',
		entries: [
			['"sidebar.zoomIn"', '"Zoom in graph"'],
			['"sidebar.zoomOut"', '"Zoom out graph"'],
			['"sidebar.detail"', '"Commit details"'],
			['"sidebar.parents"', '"{count} parents"'],
			['"sidebar.repos"', '"{count} repositories"'],
			['"sidebar.expand"', '"Expand repository tree"'],
			['"sidebar.collapse"', '"Collapse repository tree"'],
			['"sidebar.workspaceRoot"', '"workspace root"'],
			['"sidebar.expandGraph"', '"Full-window view"'],
			['"sidebar.close"', '"Close"'],
			['"sidebar.copyInfo"', '"Copy commit info"'],
			['"sidebar.copySha"', '"Copy SHA"'],
			['"sidebar.copied"', '"Copied"'],
			['"sidebar.author"', '"Author"'],
			['"sidebar.committedAt"', '"Committed at"'],
			['"sidebar.references"', '"References"'],
			['"sidebar.commit"', '"Commit"'],
			['"sidebar.subject"', '"Subject"'],
			['"sidebar.detailHint"', '"Click a commit to see details"'],
			['"sidebar.repoPath"', '"Repository"'],
			['"sidebar.parentsLabel"', '"Parents"'],
			['"sidebar.conventions"', '"Git conventions"'],
			['"sidebar.conventionsNone"', '"not set up"'],
			['"sidebar.conventionsDraft"', '"draft"'],
			['"sidebar.conventionsSettled"', '"settled"'],
			['"sidebar.conventionsMissing"', '"This repository has no Git conventions yet. Agree on commit and branch rules before the next commit."'],
			['"sidebar.conventionsSetup"', '"Set up"'],
			['"sidebar.conventionsPick"', '"Pick one of the proven frameworks, or write the empty document and fill it in as a team."'],
			['"sidebar.conventionsScaffold"', '"Empty document only"'],
			['"sidebar.conventionsCancel"', '"Cancel"'],
			['"sidebar.conventionsOpen"', '"Open document"'],
			['"sidebar.conventionsAuto"', '"An empty convention document was created for this repository. Pick a framework to settle it."'],
			['"sidebar.conventionsApplied"', '"Convention document written."'],
			['"sidebar.conventionsWriting"', '"Writing…"'],
			['"sidebar.conventionsBestFor"', '"Best for: "'],
			['"sidebar.error.conventions"', '"Reading or writing the Git convention document failed"'],
			['"sidebar.initRepo"', '"Initialize Git repository"'],
			['"sidebar.initRepoHint"', '"This folder is not a Git repository yet. Initialize it here; other repositories in the workspace are untouched."'],
			['"sidebar.initBranch"', '"Initial branch"'],
			['"sidebar.initConfirm"', '"Initialize"'],
			['"sidebar.initCancel"', '"Cancel"'],
			['"sidebar.initRunning"', '"Initializing…"'],
			['"sidebar.initAfter"', '"A Git convention document is created automatically afterwards, and the framework picker opens."'],
			['"sidebar.error.init"', '"Failed to initialize the Git repository"'],
			['"sidebar.copyRollback"', '"Copy rollback prompt"'],
			['"sidebar.rollbackIntro"', '"Roll my repository back to a specific commit (describe only, do not execute anything)."'],
			['"sidebar.rollbackAfter"', '"There are {count} commits after it in the current view."'],
			['"sidebar.rollbackOptions"', '"Candidate approaches"'],
			['"sidebar.rollbackSafe"', '"safe, keeps history, fine on a pushed branch"'],
			['"sidebar.rollbackHard"', '"discards the commits after it, avoid on a pushed branch"'],
			['"sidebar.rollbackPick"', '"moves only this commit onto another branch"'],
			['"sidebar.rollbackConfirm"', '"Confirm which one to use first, and say which commits would be lost."'],
			['"sidebar.search"', '"Filter commits (subject / author / SHA / ref)"'],
			['"sidebar.refFilter"', '"Click to toggle the commits of this ref"'],
			['"sidebar.filtered"', '"{shown} of {total} matched"'],
			['"sidebar.noMatch"', '"No commits match the filter"'],
		]
	}
];

/**
 * GitApi methods the tab needs that the upstream API class does not carry.
 * Inserted after `repos()`; the marker comment keeps this idempotent.
 */
const API_METHODS = [{
	guard: "git/conventions",
	code: `
			/** The repository's Git-convention state plus the framework catalogue. */
			conventions(path) {
				return post("git/conventions", { path });
			}
			/** Write the convention document: a framework template, or the empty scaffold. */
			convention(path, framework, force) {
				const payload = { path };
				if (typeof framework === "string" && framework !== "") payload.framework = framework;
				if (force === true) payload.force = true;
				return post("git/convention", payload);
			}`
}, {
	guard: "git/init",
	code: `
			/** Initialize a repository in a directory that has none yet. */
			initRepo(path, branch) {
				const payload = { path };
				if (typeof branch === "string" && branch.trim() !== "") payload.branch = branch.trim();
				return post("git/init", payload);
			}`
}];
const API_ANCHOR = "\t\t\trepos(path, refresh) {\n\t\t\t\treturn post(\"git/repos\", refresh === true ? { path, refresh: true } : { path });\n\t\t\t}";

const lib = await readFile(libFile, "utf8");
const region = (await readFile(regionFile, "utf8")).replace(/\s+$/, "");

const startIndex = lib.indexOf(REGION_START);
if (startIndex < 0) throw new Error("region start marker not found in lib/client.js");
const startLineEnd = lib.indexOf("\n", startIndex);
const endIndex = lib.indexOf(REGION_END, startLineEnd);
if (endIndex < 0) throw new Error("region end marker not found in lib/client.js");

let next = lib.slice(0, startLineEnd + 1) + region + lib.slice(endIndex);

// GitApi additions (conventions/convention). Guarded by the marker so re-runs
// neither duplicate the methods nor depend on their exact formatting.
for (const method of API_METHODS) {
	if (next.includes(method.guard)) continue;
	if (!next.includes(API_ANCHOR)) throw new Error("build-lib: GitApi.repos() anchor not found in lib/client.js");
	next = next.replace(API_ANCHOR, API_ANCHOR + method.code);
}

/** Absolute `[open, close]` brace positions of one `const <name> = { ... }` literal. */
function dictionaryRange(text, name) {
	const start = text.indexOf("const " + name + " = {");
	if (start < 0) throw new Error("dictionary " + name + " not found");
	const open = text.indexOf("{", start);
	let depth = 0;
	let index = open;
	for (; index < text.length; index += 1) {
		const char = text[index];
		if (char === "{") depth += 1;
		else if (char === "}") {
			depth -= 1;
			if (depth === 0) break;
		}
	}
	return { open, close: index };
}

// Dictionary keys: zh and en each own a copy of the anchor line, and the check
// for "already present" must stay inside that dictionary — a file-wide check
// would let the zh insert mask the en one (which is exactly how the first
// version of this script shipped an English dictionary without the new keys).
const DICTIONARIES = ["zh", "en"];
for (let dictIndex = 0; dictIndex < DICTIONARIES.length; dictIndex += 1) {
	const { anchor, entries } = EXTRA_KEYS[dictIndex];
	const { open, close } = dictionaryRange(next, DICTIONARIES[dictIndex]);
	const block = next.slice(open, close);
	const anchorIndex = block.indexOf(anchor);
	if (anchorIndex < 0) throw new Error("dictionary anchor not found in " + DICTIONARIES[dictIndex]);
	const missing = entries.filter(([key]) => !block.includes(key + ":"));
	if (missing.length === 0) continue;
	const lineStart = open + block.lastIndexOf("\n", anchorIndex) + 1;
	const lineEnd = open + block.indexOf("\n", anchorIndex);
	const line = next.slice(lineStart, lineEnd);
	const indent = /^\t*/.exec(line)[0];
	const additions = missing.map(([key, value]) => indent + key + ": " + value + ",").join("\n");
	next = next.slice(0, lineEnd + 1) + additions + "\n" + next.slice(lineEnd + 1);
}

await writeFile(libFile, next, "utf8");
console.log("build-lib: spliced " + region.split("\n").length + " lines of tab source into lib/client.js");

// ---------------------------------------------------------------------------
// Host half: the conventions module (framework catalogue + document writers)
// lives in `src/host/conventions.js` and is spliced into the host bundle
// between its own region markers. Same idea, different artifact.
// ---------------------------------------------------------------------------
const hostRegionFile = join(root, "src/host/conventions.js");
const hostLibFile = join(root, "lib/index.js");
const HOST_START = "//#region src/host/conventions.ts";
const HOST_END = "\n//#endregion\n//#region src/host/repos.ts";

const hostLib = await readFile(hostLibFile, "utf8");
const hostRegion = (await readFile(hostRegionFile, "utf8")).replace(/\s+$/, "");
const hostStart = hostLib.indexOf(HOST_START);
if (hostStart < 0) throw new Error("host region start marker not found in lib/index.js (run scripts/patch-host.mjs first)");
const hostLineEnd = hostLib.indexOf("\n", hostStart);
const hostEnd = hostLib.indexOf(HOST_END, hostLineEnd);
if (hostEnd < 0) throw new Error("host region end marker not found in lib/index.js");
const nextHost = hostLib.slice(0, hostLineEnd + 1) + hostRegion + hostLib.slice(hostEnd);
await writeFile(hostLibFile, nextHost, "utf8");
console.log("build-lib: spliced " + hostRegion.split("\n").length + " lines of conventions source into lib/index.js");
