/**
 * The model-facing `git_worktree` tool: an agent may initialize its calling
 * directory as a repository with a conventions document, and create, list, and
 * remove managed worktrees of its calling session's repository.
 *
 * `init` exists because an agent that creates a repository on its own would
 * otherwise start with no document at all: the prompt injection has nothing to
 * read, and every rule the workspace agreed on is skipped. Running `init`
 * writes the same document the tab would write (same frameworks, same
 * front-matter switches) and, for `strict: true`, the commit-msg hook that
 * makes `git commit` refuse messages the document rejects.
 *
 * This file is spliced into `lib/index.js` between the agent-tool region
 * markers by `scripts/build-lib.mjs`; it is not a module of its own and uses
 * the host bundle's scope (the `GitService` methods `worktrees` /
 * `addWorktree` / `removeWorktree`, `repoInit` / `conventionBodyOf` /
 * `repoWriteConvention`, and the workspace registry reachable from `ctx`).
 *
 * EnterWorktree-style session migration is impossible (a session's cwd is
 * immutable), and under workspace-write sandboxing the agent cannot write
 * outside its session root, so `create` also registers the worktree as a
 * workspace: the NEXT session opened on it runs fully inside the worktree
 * with correct fences. Under danger-full-access the agent may additionally
 * operate in the returned path directly.
 * @module dsh-git-graph/host/agent-tool
 */

/** The registered tool name. */
const GIT_WORKTREE_TOOL = "git_worktree";

/**
 * Resolve the calling session's project cwd from the execution identity.
 * @param exec - the tool execution context.
 * @returns the session cwd, or undefined when the identity carries none.
 */
function callingCwd(exec) {
	const cwd = exec.agent?.session?.header?.cwd;
	return typeof cwd === "string" && cwd !== "" ? cwd : undefined;
}

/**
 * Build the tool definition bound to one service instance. The definition is
 * a plain literal (no defineTool): arguments arrive frozen and are narrowed
 * here, business rejections return `ok: false` values so the model can react.
 * @param ctx - host context (workspace registry for create/remove linkage).
 * @param service - the workspace-gated git service.
 * @param featureConfig - resolves the row's live config (document name).
 * @returns the tool definition to register.
 */
function buildWorktreeTool(ctx, service, featureConfig) {
	return {
		name: GIT_WORKTREE_TOOL,
		description: [
			"Git actions of the current session's repository.",
			"init initializes the calling directory as a repository (default branch main) and writes the workspace's conventions document into it, with the commit-msg hook for strict documents - use it instead of a bare `git init`, which leaves the repository without rules;",
			"create makes a new worktree under the DSH-managed worktrees home on a new wt/<name> branch and registers it as a workspace;",
			"the returned path is ready for a new session (or for direct use when the sandbox permits).",
			"list shows every worktree; remove deletes a managed worktree (uncommitted changes reject unless force)."
		].join(" "),
		parameters: {
			type: "object",
			additionalProperties: false,
			properties: {
				action: {
					type: "string",
					enum: ["init", "create", "list", "remove"],
					description: "The git operation to perform."
				},
				branch: {
					type: "string",
					description: "init: initial branch name; defaults to main."
				},
				framework: {
					type: "string",
					description: "init: conventions framework id (conventional-commits, github-flow, git-flow, trunk-based, conventional-branch, gitlab-flow, none), or the id of a user template saved from the sidebar. Omit for the empty scaffold."
				},
				strict: {
					type: "boolean",
					description: "init: write strict: true into the document and install the commit-msg hook that enforces it."
				},
				language: {
					type: "string",
					enum: ["zh", "en", "mixed"],
					description: "init: subject language written into the document."
				},
				ai: {
					type: "string",
					enum: ["required", "optional", "forbidden"],
					description: "init: whether the document requires an AI attribution trailer."
				},
				name: {
					type: "string",
					description: "create: worktree name (sanitized to [a-z0-9._-]); omit for an auto-generated one."
				},
				baseRef: {
					type: "string",
					description: "create: base revision (branch or rev); omit for the checkout's current HEAD. 'origin/HEAD' falls back to HEAD when no remote exists."
				},
				worktreePath: {
					type: "string",
					description: "remove: absolute worktree path, exactly as reported by list/create."
				},
				force: {
					type: "boolean",
					description: "remove: override the uncommitted-changes guard."
				},
				deleteBranch: {
					type: "boolean",
					description: "remove: also delete the wt/<name> branch after removal."
				}
			},
			required: ["action"]
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: true
			},
			render: (_args, value) => [{
				type: "text",
				text: JSON.stringify(value)
			}]
		},
		timeoutMs: 6e4,
		async execute(args, exec) {
			const input = typeof args === "object" && args !== null ? args : {};
			const cwd = callingCwd(exec);
			if (cwd === undefined) return {
				ok: false,
				code: "workspace-unknown",
				message: "git_worktree needs a calling session with a project cwd"
			};
			switch (input.action) {
				case "init": {
					const branch = typeof input.branch === "string" && input.branch.trim() !== "" ? input.branch.trim() : "main";
					const framework = typeof input.framework === "string" && input.framework.trim() !== "" ? input.framework.trim() : "none";
					if (framework !== "none" && conventionFrameworkOf(framework) === void 0 && conventionTemplateOf(framework) === void 0) return {
						ok: false,
						code: "convention-unknown-framework",
						message: "unknown framework: " + framework
					};
					const strict = input.strict === true;
					const language = input.language === "zh" || input.language === "en" || input.language === "mixed" ? input.language : void 0;
					const ai = input.ai === "required" || input.ai === "optional" || input.ai === "forbidden" ? input.ai : void 0;
					const initialized = await repoInit(service, cwd, branch);
					if (!initialized.ok) return {
						ok: false,
						code: initialized.error.code,
						message: initialized.error.message
					};
					const body = conventionBodyOf(framework, basename(cwd), strict, language, ai);
					if (body === void 0) return {
						ok: false,
						code: "convention-unknown-framework",
						message: "unknown framework: " + framework
					};
					let docName = CONVENTION_DOC_DEFAULT;
					try {
						const active = typeof featureConfig === "function" ? featureConfig() : void 0;
						if (active !== void 0 && active !== null && typeof active.conventionsDoc === "string" && active.conventionsDoc !== "") docName = active.conventionsDoc;
					} catch {}
					const written = await repoWriteConvention(cwd, docName, body, { force: false });
					if (!written.ok) return {
						ok: false,
						code: written.error.code,
						message: written.error.message
					};
					return {
						ok: true,
						root: initialized.value.root,
						branch: initialized.value.branch,
						docPath: written.value.docPath,
						framework,
						strict,
						hook: written.value.hook,
						note: strict ? "The commit-msg hook enforces the document; git commit --no-verify bypasses it." : "The document is in place. Set strict: true in it to also install the commit-msg hook."
					};
				}
				case "list": {
					const view = await service.worktrees(cwd, exec.signal);
					if (view === null) return {
						ok: false,
						code: "workspace-unknown",
						message: "not a git workspace"
					};
					return {
						ok: true,
						root: view.root,
						worktrees: view.worktrees
					};
				}
				case "create": {
					const rawName = typeof input.name === "string" && input.name.trim() !== "" ? input.name : `agent-${Date.now().toString(36)}`;
					const baseRef = typeof input.baseRef === "string" && input.baseRef.trim() !== "" ? input.baseRef : undefined;
					const result = await service.addWorktree(cwd, rawName, baseRef);
					if (!result.ok) return {
						ok: false,
						code: result.error.code,
						message: result.error.message
					};
					const workspace = await ctx.workspaceRegistry.create(result.path, `wt: ${result.name}`);
					return {
						ok: true,
						path: result.path,
						branch: result.branch,
						name: result.name,
						workspaceId: String(workspace.id),
						note: "The current session stays in its original checkout; open a new session on the registered workspace to work inside the worktree."
					};
				}
				case "remove": {
					if (typeof input.worktreePath !== "string" || input.worktreePath === "") return {
						ok: false,
						code: "invalid-worktree-name",
						message: "remove requires worktreePath"
					};
					const result = await service.removeWorktree(cwd, input.worktreePath, {
						force: input.force === true,
						deleteBranch: input.deleteBranch === true
					});
					if (!result.ok) return {
						ok: false,
						code: result.error.code,
						message: result.error.message
					};
					const linked = ctx.workspaceRegistry.list().find((item) => item.path === input.worktreePath);
					if (linked !== undefined) await ctx.workspaceRegistry.delete(linked.id);
					return {
						ok: true,
						removed: input.worktreePath
					};
				}
				default: return {
					ok: false,
					code: "internal",
					message: "action must be one of 'init', 'create', 'list', 'remove'"
				};
			}
		}
	};
}
