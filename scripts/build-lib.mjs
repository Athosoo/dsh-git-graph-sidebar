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
			['"sidebar.exportGraph"', '"导出图片"'],
			['"sidebar.exported"', '"已导出"'],
			['"sidebar.exportCopied"', '"已复制 SVG"'],
			['"sidebar.exportNote"', '"由 dsh-git-graph-sidebar 导出"'],
			['"sidebar.zoomIn"', '"放大图谱"'],
			['"sidebar.zoomOut"', '"缩小图谱"'],
			['"sidebar.detail"', '"提交详情"'],
			['"sidebar.parents"', '"{count} 个父提交"'],
			['"sidebar.repos"', '"{count} 个仓库"'],
			['"sidebar.expand"', '"展开仓库树"'],
			['"sidebar.collapse"', '"收起仓库树"'],
			['"sidebar.workspaceRoot"', '"工作区根"'],
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
			['"sidebar.conventionsClose"', '"关闭"'],
			['"sidebar.conventionsOpen"', '"查看文档"'],
			['"sidebar.conventionsAuto"', '"已为空仓库建立规范文档，请选择一套框架定稿。"'],
			['"sidebar.conventionsApplied"', '"规范文档已写入。"'],
			['"sidebar.conventionsWriting"', '"写入中…"'],
			['"sidebar.conventionsBestFor"', '"适合："'],
			['"sidebar.error.conventions"', '"读取或写入 Git 规范失败"'],
			['"sidebar.compliance"', '"提交合规"'],
			['"sidebar.complianceOff"', '"文档没有写明可机检的规则"'],
			['"sidebar.ruleTypes"', '"type：{types}"'],
			['"sidebar.ruleLength"', '"标题 ≤ {count} 字"'],
			['"sidebar.ruleLowercase"', '"小写开头"'],
			['"sidebar.rulePeriod"', '"不加句号"'],
			['"sidebar.ruleMood"', '"祈使句"'],
			['"sidebar.strict"', '"强约束"'],
			['"sidebar.strictHint"', '"写进文档的 strict: true：不合规的提交必须先改写，再提交"'],
			['"sidebar.language"', '"提交语言"'],
			['"sidebar.languageHint"', '"写进文档的 language: zh|en|mixed，主题语言不对会被标出来"'],
			['"sidebar.langZh"', '"中文"'],
			['"sidebar.langEn"', '"英文"'],
			['"sidebar.langMixed"', '"中英混排"'],
			['"sidebar.previewTitle"', '"写入前的差异"'],
			['"sidebar.previewAdded"', '"{count} 节新增"'],
			['"sidebar.previewChanged"', '"{count} 节改写"'],
			['"sidebar.previewRemoved"', '"{count} 节移除"'],
			['"sidebar.previewSame"', '"{count} 节不变"'],
			['"sidebar.previewNoChange"', '"内容一致，无需改写。"'],
			['"sidebar.previewConfirm"', '"确认写入"'],
			['"sidebar.previewCancel"', '"取消"'],
			['"sidebar.previewBadgeAdded"', '"新增"'],
			['"sidebar.previewBadgeChanged"', '"改写"'],
			['"sidebar.previewBadgeRemoved"', '"移除"'],
			['"sidebar.workspaceDoc"', '"工作区规范"'],
			['"sidebar.workspaceDocCreate"', '"创建工作区规范"'],
			['"sidebar.workspaceDocMissing"', '"这个工作区还没有总纲。写一份，子仓库没有自己的规范时会继承它。"'],
			['"sidebar.workspaceDocExists"', '"子仓库没有自己的规范时继承这份总纲。"'],
			['"sidebar.workspaceDocWritten"', '"工作区规范已写入。"'],
			['"sidebar.workspaceDocCopy"', '"复制路径"'],
			['"sidebar.conventionsSwitch"', '"更换框架"'],
			['"sidebar.ai"', '"AI 署名"'],
			['"sidebar.aiHint"', '"提交正文里的署名尾行，例如 Assisted-by: Claude Code。规范只决定它是否必须出现。"'],
			['"sidebar.aiRequired"', '"必须注明"'],
			['"sidebar.aiOptional"', '"可选"'],
			['"sidebar.aiForbidden"', '"禁止注明"'],
			['"sidebar.ruleAiRequired"', '"需要 AI 署名"'],
			['"sidebar.ruleAiOptional"', '"AI 署名可选"'],
			['"sidebar.ruleAiForbidden"', '"禁止 AI 署名"'],
			['"sidebar.conventionsConflicts"', '"{count} 处规范冲突"'],
			['"sidebar.conflictsReview"', '"交给 AI 合并"'],
			['"sidebar.consolidateAi"', '"AI 合并"'],
			['"sidebar.consolidateAiNotice"', '"已把合并请求复制到剪贴板，粘贴到对话里发送即可（AI 会读文档、判断冲突与重复，再合并进 GIT_CONVENTIONS.md）。"'],
			['"view.title"', '"仓库图谱"'],
			['"sidebar.mainViewOpen"', '"在主区域打开"'],
			['"sidebar.mainViewOn"', '"主区域已打开"'],
			['"sidebar.mainViewClose"', '"关闭主区域视图"'],
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
			['"sidebar.refsClear"', '"清除筛选"'],
			['"sidebar.refsMore"', '"展开其余引用"'],
			['"sidebar.refsLess"', '"收起"'],
			['"sidebar.filtered"', '"{shown} / {total} 条匹配"'],
			['"sidebar.noMatch"', '"没有匹配的提交"'],
			['"sidebar.worktrees"', '"{count} 个 worktree"'],
			['"sidebar.worktreeCurrent"', '"当前会话"'],
			['"sidebar.worktreeUnregistered"', '"未注册为工作区，无法读取状态"'],
			['"sidebar.worktreeMissing"', '"目录已不存在（可能被移动或删除）"'],
			['"sidebar.worktreeError"', '"worktree 列表读取失败"'],
			['"sidebar.worktreeOpenSession"', '"在新会话中打开"'],
			['"sidebar.worktreeOpenWorkspace"', '"打开为工作区"'],
			['"sidebar.worktreeCopyPath"', '"复制路径"'],
			['"sidebar.worktreeJumpHint"', '"点击切换视图；按钮可在会话中打开"'],
			['"sidebar.settings"', '"设置"'],
			['"sidebar.settingsTitle"', '"Git 规范模板"'],
			['"sidebar.settingsHint"', '"这里管理「我的模板」：保存后会出现在选择框架的列表末尾，可以写进任意仓库的规范文档；内置的六套框架保持只读，不能在这里修改或删除。"'],
			['"sidebar.templatesEmpty"', '"还没有自定义模板。点「新建模板」写一份。"'],
			['"sidebar.templatesCount"', '"{count} 个自定义模板"'],
			['"sidebar.templatesStore"', '"存放位置：{path}"'],
			['"sidebar.templateNew"', '"新建模板"'],
			['"sidebar.templateEdit"', '"编辑"'],
			['"sidebar.templateDelete"', '"删除"'],
			['"sidebar.templateDeleteConfirm"', '"确认删除"'],
			['"sidebar.templateSave"', '"保存"'],
			['"sidebar.templateCancel"', '"取消"'],
			['"sidebar.templateSaving"', '"保存中…"'],
			['"sidebar.templateSaved"', '"模板已保存。"'],
			['"sidebar.templateDeleted"', '"模板已删除。已写进仓库的文档不受影响，但其中记录的 framework 值会变成悬空值。"'],
			['"sidebar.templateError"', '"模板操作失败"'],
			['"sidebar.templateId"', '"模板 ID"'],
			['"sidebar.templateIdHint"', '"小写字母、数字和连字符，1–48 个字符；不能与内置模板或 none 重名。"'],
			['"sidebar.templateName"', '"名称"'],
			['"sidebar.templateNameZh"', '"中文名称（可选）"'],
			['"sidebar.templateTagline"', '"一句话说明（可选）"'],
			['"sidebar.templateTaglineZh"', '"中文说明（可选）"'],
			['"sidebar.templateBestFor"', '"适合什么项目（可选）"'],
			['"sidebar.templateBestForZh"', '"中文适用场景（可选）"'],
			['"sidebar.templateUrl"', '"参考链接（可选，http/https）"'],
			['"sidebar.templateBody"', '"模板正文（Markdown，≤64KB，必须含 status: 行）"'],
			['"sidebar.templateEditorHint"', '"正文会强制写入 framework: <模板 ID> 与 status: 行；保存前用同一套规则自检。"'],
			['"sidebar.templateBytes"', '"{count} 字节"'],
			['"sidebar.templateCustom"', '"自定义"'],
			['"sidebar.templateMine"', '"我的模板"'],
			['"sidebar.templateManage"', '"管理模板"'],
			['"sidebar.templateLoading"', '"读取中…"'],
			['"sidebar.templateBuiltin"', '"内置"'],
			['"sidebar.builtinGroup"', '"内置模板"'],
			['"sidebar.builtinHint"', '"内置模板不可编辑或删除，只控制是否出现在选择列表"'],
			['"sidebar.builtinShown"', '"显示中"'],
			['"sidebar.builtinHidden"', '"已隐藏"'],
			['"sidebar.builtinShow"', '"显示"'],
			['"sidebar.builtinHide"', '"隐藏"'],
		]
	},
	{
		anchor: '"sidebar.commitsLanes"',
		entries: [
			['"sidebar.exportGraph"', '"Export image"'],
			['"sidebar.exported"', '"Exported"'],
			['"sidebar.exportCopied"', '"SVG copied"'],
			['"sidebar.exportNote"', '"Exported by dsh-git-graph-sidebar"'],
			['"sidebar.zoomIn"', '"Zoom in graph"'],
			['"sidebar.zoomOut"', '"Zoom out graph"'],
			['"sidebar.detail"', '"Commit details"'],
			['"sidebar.parents"', '"{count} parents"'],
			['"sidebar.repos"', '"{count} repositories"'],
			['"sidebar.expand"', '"Expand repository tree"'],
			['"sidebar.collapse"', '"Collapse repository tree"'],
			['"sidebar.workspaceRoot"', '"workspace root"'],
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
			['"sidebar.conventionsClose"', '"Close"'],
			['"sidebar.conventionsOpen"', '"Open document"'],
			['"sidebar.conventionsAuto"', '"An empty convention document was created for this repository. Pick a framework to settle it."'],
			['"sidebar.conventionsApplied"', '"Convention document written."'],
			['"sidebar.conventionsWriting"', '"Writing…"'],
			['"sidebar.conventionsBestFor"', '"Best for: "'],
			['"sidebar.error.conventions"', '"Reading or writing the Git convention document failed"'],
			['"sidebar.compliance"', '"Commit compliance"'],
			['"sidebar.complianceOff"', '"The document states no checkable rule"'],
			['"sidebar.ruleTypes"', '"type: {types}"'],
			['"sidebar.ruleLength"', '"subject ≤ {count}"'],
			['"sidebar.ruleLowercase"', '"lowercase start"'],
			['"sidebar.rulePeriod"', '"no trailing period"'],
			['"sidebar.ruleMood"', '"imperative"'],
			['"sidebar.strict"', '"Strict"'],
			['"sidebar.strictHint"', '"Writes strict: true into the document: a message that breaks the rules must be rewritten before it is committed"'],
			['"sidebar.language"', '"Subject language"'],
			['"sidebar.languageHint"', '"Writes language: zh|en|mixed into the document, so a subject in the other language is flagged"'],
			['"sidebar.langZh"', '"Chinese"'],
			['"sidebar.langEn"', '"English"'],
			['"sidebar.langMixed"', '"Chinese + English"'],
			['"sidebar.previewTitle"', '"What would change"'],
			['"sidebar.previewAdded"', '"{count} sections added"'],
			['"sidebar.previewChanged"', '"{count} sections rewritten"'],
			['"sidebar.previewRemoved"', '"{count} sections removed"'],
			['"sidebar.previewSame"', '"{count} sections unchanged"'],
			['"sidebar.previewNoChange"', '"Identical - nothing to rewrite."'],
			['"sidebar.previewConfirm"', '"Write it"'],
			['"sidebar.previewCancel"', '"Cancel"'],
			['"sidebar.previewBadgeAdded"', '"added"'],
			['"sidebar.previewBadgeChanged"', '"rewritten"'],
			['"sidebar.previewBadgeRemoved"', '"removed"'],
			['"sidebar.workspaceDoc"', '"Workspace conventions"'],
			['"sidebar.workspaceDocCreate"', '"Create workspace document"'],
			['"sidebar.workspaceDocMissing"', '"This workspace has no shared document yet. Write one and the repositories below inherit it unless they carry their own."'],
			['"sidebar.workspaceDocExists"', '"Repositories below inherit this unless they carry their own document."'],
			['"sidebar.workspaceDocWritten"', '"Workspace document written."'],
			['"sidebar.workspaceDocCopy"', '"Copy path"'],
			['"sidebar.conventionsSwitch"', '"Switch framework"'],
			['"sidebar.ai"', '"AI attribution"'],
			['"sidebar.aiHint"', '"A trailer line in the message body, such as Assisted-by: Claude Code. The document only decides whether it must be there."'],
			['"sidebar.aiRequired"', '"required"'],
			['"sidebar.aiOptional"', '"optional"'],
			['"sidebar.aiForbidden"', '"forbidden"'],
			['"sidebar.ruleAiRequired"', '"AI attribution required"'],
			['"sidebar.ruleAiOptional"', '"AI attribution optional"'],
			['"sidebar.ruleAiForbidden"', '"AI attribution forbidden"'],
			['"sidebar.conventionsConflicts"', '"{count} convention conflicts"'],
			['"sidebar.conflictsReview"', '"Merge with AI"'],
			['"sidebar.consolidateAi"', '"Merge with AI"'],
			['"sidebar.consolidateAiNotice"', '"The merge request is on your clipboard: paste it into the conversation, and the agent reads every document, judges the duplicates and merges them into GIT_CONVENTIONS.md."'],
			['"view.title"', '"Repository graph"'],
			['"sidebar.mainViewOpen"', '"Open in the main view"'],
			['"sidebar.mainViewOn"', '"Shown in the main view"'],
			['"sidebar.mainViewClose"', '"Close the main view"'],
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
			['"sidebar.refsClear"', '"Clear filters"'],
			['"sidebar.refsMore"', '"Show every ref"'],
			['"sidebar.refsLess"', '"Fewer"'],
			['"sidebar.filtered"', '"{shown} of {total} matched"'],
			['"sidebar.noMatch"', '"No commits match the filter"'],
			['"sidebar.worktrees"', '"{count} worktrees"'],
			['"sidebar.worktreeCurrent"', '"this session"'],
			['"sidebar.worktreeUnregistered"', '"Not a registered workspace — status unavailable"'],
			['"sidebar.worktreeMissing"', '"Directory is gone (moved or removed)"'],
			['"sidebar.worktreeError"', '"Could not read the worktree list"'],
			['"sidebar.worktreeOpenSession"', '"Open in a new session"'],
			['"sidebar.worktreeOpenWorkspace"', '"Open as workspace"'],
			['"sidebar.worktreeCopyPath"', '"Copy path"'],
			['"sidebar.worktreeJumpHint"', '"Click to switch the view; the button opens it in a session"'],
			['"sidebar.settings"', '"Settings"'],
			['"sidebar.settingsTitle"', '"Git convention templates"'],
			['"sidebar.settingsHint"', '"Manage your own templates here: a saved template appears at the end of the framework picker and can be written into any repository\'s convention document. The six built-in frameworks stay read-only."'],
			['"sidebar.templatesEmpty"', '"No templates yet. Press New template to write one."'],
			['"sidebar.templatesCount"', '"{count} templates"'],
			['"sidebar.templatesStore"', '"Stored at {path}"'],
			['"sidebar.templateNew"', '"New template"'],
			['"sidebar.templateEdit"', '"Edit"'],
			['"sidebar.templateDelete"', '"Delete"'],
			['"sidebar.templateDeleteConfirm"', '"Confirm delete"'],
			['"sidebar.templateSave"', '"Save"'],
			['"sidebar.templateCancel"', '"Cancel"'],
			['"sidebar.templateSaving"', '"Saving…"'],
			['"sidebar.templateSaved"', '"Template saved."'],
			['"sidebar.templateDeleted"', '"Template deleted. Documents already written are untouched, but their framework value becomes dangling."'],
			['"sidebar.templateError"', '"Template operation failed"'],
			['"sidebar.templateId"', '"Template ID"'],
			['"sidebar.templateIdHint"', '"Lowercase letters, digits and hyphens, 1-48 characters; must not reuse a built-in id or none."'],
			['"sidebar.templateName"', '"Name"'],
			['"sidebar.templateNameZh"', '"Chinese name (optional)"'],
			['"sidebar.templateTagline"', '"Tagline (optional)"'],
			['"sidebar.templateTaglineZh"', '"Chinese tagline (optional)"'],
			['"sidebar.templateBestFor"', '"Best for (optional)"'],
			['"sidebar.templateBestForZh"', '"Chinese best-for (optional)"'],
			['"sidebar.templateUrl"', '"Reference URL (optional, http/https)"'],
			['"sidebar.templateBody"', '"Template body (Markdown, at most 64KB, must contain a status: line)"'],
			['"sidebar.templateEditorHint"', '"The body gets framework: <template id> and a status: line enforced on save, and is checked against the same rules first."'],
			['"sidebar.templateBytes"', '"{count} bytes"'],
			['"sidebar.templateCustom"', '"Custom"'],
			['"sidebar.templateMine"', '"My templates"'],
			['"sidebar.templateManage"', '"Manage templates"'],
			['"sidebar.templateLoading"', '"Loading…"'],
			['"sidebar.templateBuiltin"', '"Built-in"'],
			['"sidebar.builtinGroup"', '"Built-in templates"'],
			['"sidebar.builtinHint"', '"Built-ins cannot be edited or deleted; the switch only controls whether they appear in the picker."'],
			['"sidebar.builtinShown"', '"Shown"'],
			['"sidebar.builtinHidden"', '"Hidden"'],
			['"sidebar.builtinShow"', '"Show"'],
			['"sidebar.builtinHide"', '"Hide"'],
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
	guard: "conventionOptions(path, framework, force, strict, language, ai)",
	code: `
			/** Write a convention document with explicit strict, language and AI-attribution flags. */
			conventionOptions(path, framework, force, strict, language, ai) {
				const payload = { path };
				if (typeof framework === "string" && framework !== "") payload.framework = framework;
				if (force === true) payload.force = true;
				if (typeof strict === "boolean") payload.strict = strict;
				if ("zh" === language || "en" === language || "mixed" === language) payload.language = language;
				if ("required" === ai || "optional" === ai || "forbidden" === ai) payload.ai = ai;
				return post("git/convention", payload);
			}`
}, {
	guard: "conventionSettings(path, payload)",
	code: `
			/** Update only the subject language, strict switch and AI policy of an existing document. */
			conventionSettings(path, payload) {
				const body = payload !== null && typeof payload === "object" ? payload : {};
				const request = { path };
				if (typeof body.strict === "boolean") request.strict = body.strict;
				if ("zh" === body.language || "en" === body.language || "mixed" === body.language) request.language = body.language;
				if ("required" === body.ai || "optional" === body.ai || "forbidden" === body.ai) request.ai = body.ai;
				return post("git/convention/settings", request);
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
}, {
	guard: "git/compliance",
	code: `
			/** Check the last commits against the rules the document states. */
			commitCompliance(path) {
				return post("git/compliance", { path });
			}
			/** What choosing a framework would change in the existing document, AI policy included. */
			conventionPreview(path, framework, strict, language, ai) {
				const payload = { path };
				if (typeof framework === "string" && framework !== "") payload.framework = framework;
				if (typeof strict === "boolean") payload.strict = strict;
				if ("zh" === language || "en" === language || "mixed" === language) payload.language = language;
				if ("required" === ai || "optional" === ai || "forbidden" === ai) payload.ai = ai;
				return post("git/convention/preview", payload);
			}
			/** Workspace-wide document at a container root: state, preview or write. */
			workspaceConvention(path, payload) {
				const body = payload !== null && typeof payload === "object" ? payload : {};
				return post("git/workspace-convention", {
					path,
					action: typeof body.action === "string" ? body.action : "state",
					framework: typeof body.framework === "string" ? body.framework : void 0,
					force: body.force === true ? true : void 0,
					strict: typeof body.strict === "boolean" ? body.strict : void 0,
					language: typeof body.language === "string" ? body.language : void 0,
				ai: typeof body.ai === "string" ? body.ai : void 0
				});
			}`
}, {
	guard: "git/cleanup",
	code: `
			/** Branch cleanup hints: every local branch, and what the base already has. */
			cleanupBranches(path) {
				return post("git/cleanup", { path });
			}
			/** The read-only health report: detached HEAD, branches without upstream, stash, objects. */
			repoHealth(path) {
				return post("git/health", { path });
			}`
}, {
	guard: "conventionConflicts(path)",
	code: `
			/** Every convention document that governs this repository, and where they disagree. */
			conventionConflicts(path) {
				return post("git/conventions/conflicts", { path });
			}`
}, {
	guard: "git/worktree/list",
	code: `
			/** Linked worktrees of one repository; the anchor path must be a registered workspace. */
			worktreeList(path) {
				return post("git/worktree/list", { path });
			}
			/** Status of one linked worktree; the anchor repository authorizes the target. */
			worktreeStatus(path, worktree) {
				return post("git/worktree/status", { path, worktree });
			}
			/** Branch heads of one linked worktree. */
			worktreeBranches(path, worktree) {
				return post("git/worktree/branches", { path, worktree });
			}
			/** Commit graph of one linked worktree. */
			worktreeGraph(path, worktree, limit) {
				const payload = { path, worktree };
				if (typeof limit === "number" && limit > 0) payload.limit = limit;
				return post("git/worktree/graph", payload);
			}`
}, {
	guard: "git/convention/templates",
	code: `
			/** Read and write the user's own convention templates (list/starter/get/save/delete/toggle). */
			conventionTemplates(action, payload) {
				const body = payload !== null && typeof payload === "object" ? payload : {};
				const request = { action };
				if (typeof body.id === "string") request.id = body.id;
				if (body.template !== null && typeof body.template === "object") request.template = body.template;
				if (typeof body.hidden === "boolean") request.hidden = body.hidden;
				return post("git/convention/templates", request);
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
// GitApi additions: every managed method is stripped first and then inserted in
// order after the repos() anchor, so a changed signature can never leave a
// stale copy behind to win the object literal.
/** Every GitApi method name declared in one addition block. */
function methodNamesOf(code) {
	const names = [];
	const pattern = /\n\t{3}([A-Za-z_$][\w$]*)\(/g;
	let hit = pattern.exec(code);
	while (hit !== null) {
		names.push(hit[1]);
		hit = pattern.exec(code);
	}
	if (names.length === 0) throw new Error("build-lib: cannot read the method name from a GitApi addition");
	return names;
}

/** Remove every definition of one GitApi method, doc comment included. */
function stripMethod(text, name) {
	let out = text;
	for (let round = 0; round < 40; round += 1) {
		const at = out.indexOf("\n\t\t\t" + name + "(");
		if (at < 0) return out;
		let start = at;
		const docAt = out.lastIndexOf("\n\t\t\t/**", at);
		if (docAt >= 0 && out.slice(docAt, at).indexOf("*/") >= 0) start = docAt;
		const closeAt = out.indexOf("\n\t\t\t}", at);
		if (closeAt < 0) throw new Error("build-lib: cannot find the end of GitApi." + name + "()");
		out = out.slice(0, start) + out.slice(closeAt + 5);
	}
	throw new Error("build-lib: cannot settle the GitApi methods");
}

const beforeApi = next;
for (const method of API_METHODS) for (const name of methodNamesOf(method.code)) next = stripMethod(next, name);
for (const method of API_METHODS) {
	if (!next.includes(API_ANCHOR)) throw new Error("build-lib: GitApi.repos() anchor not found in lib/client.js");
	next = next.replace(API_ANCHOR, API_ANCHOR + method.code);
}
console.log("build-lib: synced GitApi additions (" + API_METHODS.length + " blocks)");
if (beforeApi === next) console.log("build-lib: GitApi additions unchanged");

// Client glue outside the tab region: opening a worktree in a session needs the
// workspace services, and the registration block lives in the `index.ts` region
// that this script never regenerates — so the inject list is patched here.
// The guard keeps re-runs a no-op; a missing anchor throws when the bundle drifts.
const GLUE_PATCHES = [{
	guard: "\t\t\t\tsidebarTabUiWorkspace = sidebarScope.uiWorkspace;",
	from: "\t\t\tctx.inject([\"betterSidebar\", \"sessions\"], (sidebarScope) => {\n\t\t\t\tsidebarTabSessions = sidebarScope.sessions;",
	to: "\t\t\tctx.inject([\"betterSidebar\", \"sessions\", \"workspaces\", \"uiWorkspace\"], (sidebarScope) => {\n\t\t\t\tsidebarTabSessions = sidebarScope.sessions;\n\t\t\t\tsidebarTabWorkspaces = sidebarScope.workspaces;\n\t\t\t\tsidebarTabUiWorkspace = sidebarScope.uiWorkspace;"
}];
let glueApplied = 0;
for (const patch of GLUE_PATCHES) {
	if (next.includes(patch.guard)) continue;
	if (!next.includes(patch.from)) throw new Error("build-lib: client glue anchor missing: " + patch.guard.trim());
	next = next.replace(patch.from, patch.to);
	glueApplied += 1;
}
if (glueApplied > 0) console.log("build-lib: patched " + glueApplied + " client glue anchor(s)");

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
const hostLibFile = join(root, "lib/index.js");
/** A line feed, spelled without escapes so this file survives any transport. */
const LF = String.fromCharCode(10);
/** Text that closes a spliced host region (the marker line itself is kept). */
const HOST_REGION_END = LF + "//#endregion";
/**
 * Host modules spliced verbatim into `lib/index.js`, each into its own region.
 * A region runs from its marker line to the next `//#endregion` after it.
 */
const HOST_MODULES = [
	{
		file: "src/host/conventions.js",
		start: "//#region src/host/conventions.ts"
	},
	{
		file: "src/host/branches.js",
		start: "//#region src/host/branches.ts"
	},
	{
		file: "src/host/agent-tool.js",
		start: "//#region src/host/agent-tool.ts"
	}
];

let hostLib = await readFile(hostLibFile, "utf8");
// `conventions` ships a region header of its own; the `branches` module gets
// one from here, so a fresh checkout never needs a hand edit before building.
if (hostLib.indexOf("//#region src/host/branches.ts") < 0) {
	const anchor = "function registerGitRoutes(ctx, service, config = defaultFeatureConfig) {";
	const at = hostLib.indexOf(anchor);
	if (at < 0) throw new Error("registerGitRoutes anchor not found in lib/index.js");
	hostLib = hostLib.slice(0, at) + "//#region src/host/branches.ts" + LF + "//#endregion" + LF + hostLib.slice(at);
}
// The `agent-tool` region sits just above `mount-once`; seed the empty pair of
// markers the first time so the splice below only ever deals with content.
if (hostLib.indexOf("//#region src/host/agent-tool.ts") < 0) {
	const anchor = "//#region src/mount-once.ts";
	const at = hostLib.indexOf(anchor);
	if (at < 0) throw new Error("mount-once region anchor not found in lib/index.js");
	hostLib = hostLib.slice(0, at) + "//#region src/host/agent-tool.ts" + LF + "//#endregion" + LF + hostLib.slice(at);
}
for (const module of HOST_MODULES) {
	const source = (await readFile(join(root, module.file), "utf8")).replace(/\s+$/, "");
	const startIndex = hostLib.indexOf(module.start);
	if (startIndex < 0) throw new Error(module.start + " not found in lib/index.js");
	const lineEnd = hostLib.indexOf(LF, startIndex);
	const endIndex = hostLib.indexOf(HOST_REGION_END, lineEnd);
	if (endIndex < 0) throw new Error("end marker for " + module.file + " not found in lib/index.js");
	hostLib = hostLib.slice(0, lineEnd + 1) + source + hostLib.slice(endIndex);
	console.log("build-lib: spliced " + source.split(LF).length + " lines of " + module.file + " into lib/index.js");
}
await writeFile(hostLibFile, hostLib, "utf8");
