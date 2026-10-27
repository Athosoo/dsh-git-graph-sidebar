import { mkdir, readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import z from "@deepseek-ai/schemastery";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { isAbsolute as isAbsolute$1, join as join$1 } from "node:path/posix";
//#region src/host/config.ts
/** Schemastery schema backing the profile patch values and the generated settings page. */
const Config = z.object({
	autoIsolate: z.boolean().default(false).volatile(),
	autoBaseline: z.union(["current", "default"]).default("current").volatile(),
	agentTool: z.boolean().default(false).volatile(),
	conventionsDoc: z.string().default("GIT_CONVENTIONS.md").volatile(),
	conventionsAuto: z.boolean().default(true).volatile()
});
/**
* Resolve the effective config with schema defaults applied. Volatile fields
* arrive as live references, so this reads the value the settings subsystem
* last committed rather than a snapshot taken at mount.
* @param config - the config the Host handed to the plugin row.
* @returns the resolved values.
*/
function effectiveConfig(config) {
	return {
		autoIsolate: config?.autoIsolate?.get() ?? false,
		autoBaseline: config?.autoBaseline?.get() ?? "current",
		agentTool: config?.agentTool?.get() ?? false,
		conventionsDoc: config?.conventionsDoc?.get() ?? "GIT_CONVENTIONS.md",
		conventionsAuto: config?.conventionsAuto?.get() ?? true
	};
}
//#endregion
//#region src/host/git-runner.ts
/** Collected-output cap for one git command. */
const OUTPUT_CAP_BYTES = 1 << 20;
/**
* Production runner over the subprocess service: one managed child per
* command, bounded collect on both streams. A caller-owned AbortSignal reaches
* the subprocess tree and remains authoritative even in degrade mode. Degrade
* mode keeps the SCM tab showing the friendly "not a git repository" state
* instead of a bare 400 when git is missing or the subprocess service fails.
* @param ctx - context carrying the subprocess service.
* @param options - per-package behavior knobs.
* @returns the runner.
*/
function subprocessRunner$1(ctx, options = {}) {
	const spawnArgv = options.spawnArgv ?? ((argv) => ["git", ...argv]);
	const degrade = options.failureMode === "degrade";
	const errorTag = options.errorTag ?? "git";
	const failure = (prefix, error) => ({
		exitCode: 127,
		stdout: "",
		stderr: prefix + (error instanceof Error ? error.message : String(error))
	});
	return { async run(argv, cwd, signal) {
		signal?.throwIfAborted();
		const spec = {
			argv: spawnArgv(argv),
			cwd,
			stdio: {
				stdin: "ignore",
				stdout: { maxBytes: OUTPUT_CAP_BYTES },
				stderr: { maxBytes: OUTPUT_CAP_BYTES }
			},
			graceMs: 1e4,
			signal
		};
		if (degrade) {
			let handle;
			try {
				handle = ctx.subprocess.spawn(spec);
			} catch (error) {
				signal?.throwIfAborted();
				console.error("[" + errorTag + "] git spawn failed:", error);
				return failure("git: spawn failed: ", error);
			}
			try {
				const outcome = await handle.done;
				signal?.throwIfAborted();
				const stdout = handle.collected.stdout?.readFrom(0).text ?? "";
				const stderr = handle.collected.stderr?.readFrom(0).text ?? "";
				return {
					exitCode: outcome.exitCode,
					stdout,
					stderr
				};
			} catch (error) {
				signal?.throwIfAborted();
				console.error("[" + errorTag + "] git run failed:", error);
				return failure("git: run failed: ", error);
			}
		}
		const handle = ctx.subprocess.spawn(spec);
		const outcome = await handle.done;
		signal?.throwIfAborted();
		const stdout = handle.collected.stdout?.readFrom(0).text ?? "";
		const stderr = handle.collected.stderr?.readFrom(0).text ?? "";
		return {
			exitCode: outcome.exitCode,
			stdout,
			stderr
		};
	} };
}
//#endregion
//#region src/core/git-command.ts
/** `git rev-parse --show-toplevel` — canonical repository root. */
const topLevelArgv = () => ["rev-parse", "--show-toplevel"];
/** `git rev-parse --abbrev-ref HEAD` — current branch ('HEAD' when detached). */
const headBranchArgv = () => [
	"rev-parse",
	"--abbrev-ref",
	"HEAD"
];
/** `git for-each-ref refs/heads --format=%(refname:short)%00%(HEAD)%00%(objectname)` — local branches. */
const forEachRefArgv = () => [
	"for-each-ref",
	"refs/heads",
	"--format=%(refname:short)%00%(HEAD)%00%(objectname)"
];
/** `git status --porcelain` — worktree dirtiness and conflicts. */
const statusPorcelainArgv = () => ["status", "--porcelain"];
/** `git diff --name-only --diff-filter=U` — unmerged (conflict) files. */
const unmergedArgv = () => [
	"diff",
	"--name-only",
	"--diff-filter=U"
];
/** `git worktree list --porcelain` — all worktrees and their checked-out branches. */
const worktreeListArgv = () => [
	"worktree",
	"list",
	"--porcelain"
];
/** `git worktree add -b <branch> <path> <baseRef>` — a linked worktree on a NEW branch. */
const worktreeAddArgv = (path, branch, baseRef) => [
	"worktree",
	"add",
	"-b",
	branch,
	path,
	baseRef
];
/** `git worktree remove [--force] <path>` — remove a linked worktree. */
const worktreeRemoveArgv = (path, force) => force ? [
	"worktree",
	"remove",
	"--force",
	path
] : [
	"worktree",
	"remove",
	path
];
/** `git branch -D <name>` — force-delete a branch (only for opted-in wt/ cleanup after removal). */
const branchDeleteForceArgv = (name) => [
	"branch",
	"-D",
	name
];
/** `git rev-parse --verify --quiet <rev>` — generic revision probe (base refs such as origin/HEAD). */
const verifyRevArgv = (rev) => [
	"rev-parse",
	"--verify",
	"--quiet",
	rev
];
/**
* Sanitize a user/agent-supplied worktree name into a safe directory and
* branch component: lowercase, alnum plus ._-, no leading/trailing dash/dot,
* capped at 64 chars. Returns null when nothing usable remains.
* @param raw - the proposed worktree name.
*/
function sanitizeWorktreeName(raw) {
	const cleaned = raw.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/-{2,}/g, "-").replace(/^[-.]+/, "").replace(/[-.]+$/, "").slice(0, 64);
	if (cleaned === "" || cleaned === "." || cleaned === "..") return null;
	return cleaned;
}
/** `git rev-parse --verify --quiet refs/heads/<branch>` — branch existence probe. */
const verifyRefArgv = (branch) => [
	"rev-parse",
	"--verify",
	"--quiet",
	`refs/heads/${branch}`
];
/** `git check-ref-format --branch <name>` — the authoritative branch-name gate. */
const checkRefFormatArgv = (name) => [
	"check-ref-format",
	"--branch",
	name
];
/** `git switch --no-guess -- <branch>` — workspace-level branch switch (ZCode semantics). */
const switchArgv = (branch) => [
	"switch",
	"--no-guess",
	"--",
	branch
];
/** `git switch --no-guess -c <name>` — create from current HEAD and switch. */
const createBranchArgv = (name) => [
	"switch",
	"--no-guess",
	"-c",
	name
];
/** Graph log: `git log --branches --tags --remotes --topo-order --parents --format=... --max-count <n>`. */
const graphLogArgv = (limit) => [
	"log",
	"--branches",
	"--tags",
	"--remotes",
	"--topo-order",
	"--parents",
	"--format=%H%x00%P%x00%an%x00%at%x00%D%x00%s%x1e",
	"--max-count",
	String(limit)
];
/** Git markers whose presence means an operation is in progress. */
const OPERATION_MARKERS = [
	"MERGE_HEAD",
	"CHERRY_PICK_HEAD",
	"REVERT_HEAD",
	"BISECT_LOG",
	"rebase-merge",
	"rebase-apply",
	"sequencer"
];
/**
* git rev-parse --git-path <marker> - resolve ONE operation marker to its
* on-disk path. Kept as the per-marker probe for the service's fallback
* when the single combined spawn fails (a hung or non-zero combined call
* must not silently hide an in-progress operation).
*/
const gitPathArgv = (marker) => [
	"rev-parse",
	"--git-path",
	marker
];
/**
* git rev-parse --git-path <marker>... - resolve every operation-marker path
* in ONE spawn (one --git-path option per marker; the option form is
* repeatable, unlike positional paths). On Windows, where each git.exe cold
* start costs about 0.7s, this replaces the previous 7 sequential marker
* probes with a single process.
*/
const operationMarkersArgv = () => ["rev-parse", ...OPERATION_MARKERS.flatMap((marker) => ["--git-path", marker])];
const OVERWRITE_PATTERNS = [
	{
		code: "tracked-changes-would-be-overwritten",
		header: /Your local changes to the following files would be overwritten by checkout/
	},
	{
		code: "untracked-changes-would-be-overwritten",
		header: /The following untracked working tree files would be overwritten by checkout/
	},
	{
		code: "tracked-changes-would-be-overwritten",
		header: /Your local changes to the following files would be overwritten by merge/
	}
];
/**
* Extract the blocked-file list following an overwrite header: git indents
* paths with a tab (quoted when they contain spaces); the trailing hint
* lines ("Please commit your changes...") end the list.
* @param stderr - the full git stderr.
* @param header - the matched header regex.
* @returns up to two file paths plus the count of remaining files.
*/
const gitPathEncoder = new TextEncoder();
const gitPathDecoder = new TextDecoder();
/** The C-style escapes git uses besides the octal byte runs. */
const GIT_SIMPLE_ESCAPES = {
	a: 7,
	b: 8,
	f: 12,
	n: 10,
	r: 13,
	t: 9,
	v: 11
};
/**
* Decode one git-quoted path. Under the default `core.quotePath`, git escapes
* every non-ASCII byte as octal — 'ä' arrives as \303\244 — so octal runs are
* collected as bytes and decoded together as UTF-8. Decoding escape by escape
* would pair the digits into mojibake instead of the original character (#1491).
* @param input - a path with or without the surrounding quotes.
* @returns the decoded path.
*/
function decodeGitQuoted(input) {
	if (!input.includes("\\")) return input;
	const bytes = [];
	const pattern = /\\(?:([0-7]{3})|([\s\S]))/g;
	let index = 0;
	let match;
	while ((match = pattern.exec(input)) !== null) {
		bytes.push(...gitPathEncoder.encode(input.slice(index, match.index)));
		const octal = match[1];
		if (octal !== void 0) bytes.push(Number.parseInt(octal, 8) & 255);
		else {
			const escaped = match[2];
			const control = GIT_SIMPLE_ESCAPES[escaped];
			if (control === void 0) bytes.push(...gitPathEncoder.encode(escaped));
			else bytes.push(control);
		}
		index = match.index + match[0].length;
	}
	bytes.push(...gitPathEncoder.encode(input.slice(index)));
	return gitPathDecoder.decode(new Uint8Array(bytes));
}
/**
* Extract the blocked-file list following an overwrite header: git indents
* paths with a tab (quoted when they contain spaces); the trailing hint
* lines ("Please commit your changes...") end the list.
* @param stderr - the full git stderr.
* @param header - the matched header regex.
* @returns up to two file paths plus the count of remaining files.
*/
function extractBlockedPaths(stderr, header) {
	const start = stderr.indexOf("\n", stderr.search(header));
	if (start === -1) return {
		paths: [],
		moreFiles: 0
	};
	const paths = [];
	for (const line of stderr.slice(start + 1).split("\n")) {
		const trimmed = line.trim();
		if (trimmed === "" || !line.startsWith("	")) break;
		const quoted = /^"(.+)"$/.exec(trimmed);
		const path = quoted === null ? decodeGitQuoted(trimmed) : decodeGitQuoted(quoted[1] ?? "");
		paths.push(path);
	}
	return {
		paths: paths.slice(0, 2),
		moreFiles: Math.max(0, paths.length - 2)
	};
}
/**
* Classify a failed switch's stderr onto the stable error vocabulary.
* @param stderr - git stderr from the failed switch/create.
* @returns the classified error; `internal` when nothing matches.
*/
function classifySwitchFailure(stderr) {
	const head = stderr.trim().split("\n")[0] ?? stderr;
	for (const pattern of OVERWRITE_PATTERNS) if (pattern.header.test(stderr)) {
		const { paths, moreFiles } = extractBlockedPaths(stderr, pattern.header);
		return {
			code: pattern.code,
			message: head,
			paths,
			moreFiles
		};
	}
	if (/did not match any file\(s\) known to git|invalid reference|not a valid branch/.test(stderr)) return {
		code: "target-branch-not-found",
		message: head
	};
	if (/already used by worktree|is already checked out at/.test(stderr)) return {
		code: "branch-in-other-worktree",
		message: head
	};
	if (/local changes to the following files would be overwritten/.test(stderr)) return {
		code: "tracked-changes-would-be-overwritten",
		message: head
	};
	return {
		code: "internal",
		message: head || "git switch failed"
	};
}
/**
* Pure mirror of `git check-ref-format --branch` short-name rules, for
* instant client-side feedback; the host's check-ref-format call stays the
* authoritative gate. Returns the reason when the name is invalid.
* @param name - proposed branch name (short form, no refs/ prefix).
* @returns null when valid, else a short reason.
*/
function validateBranchName(name) {
	if (name === "") return "empty";
	if (name === "@") return "at-sign";
	if (name.startsWith("-")) return "leading-dash";
	if (name.endsWith(".")) return "trailing-dot";
	if (name.endsWith(".lock")) return "lock-suffix";
	if (name.includes("..")) return "double-dot";
	if (name.includes("@{")) return "at-brace";
	if (name.includes("//")) return "double-slash";
	if (name.includes(" ")) return "space";
	if (name.includes("~") || name.includes("^") || name.includes(":")) return "forbidden-char";
	if (name.includes("?") || name.includes("*") || name.includes("[") || name.includes("\\")) return "forbidden-char";
	for (const ch of name) {
		const code = ch.codePointAt(0);
		if (code !== void 0 && (code < 32 || code === 127)) return "control-char";
	}
	for (const component of name.split("/")) {
		if (component === "") return "empty-component";
		if (component.startsWith(".")) return "dot-component";
		if (component.endsWith(".lock")) return "lock-suffix";
	}
	if (name.length > 1e3) return "too-long";
	return null;
}
//#endregion
//#region src/host/status-porcelain.ts
/**
* The status plumbing's command shapes and the porcelain-v2 parser (GG-1).
*
* Host-local on purpose: this path is host-only (the browser half never spawns
* git), and keeping the new argv/parser pair here leaves the shared `core/`
* modules (the single home for the other argv builders and parsers) untouched.
*
* Command shape (one `git status` = three spawns):
*   1. `git rev-parse --show-toplevel --short HEAD` — repository root + short head.
*   2. `git rev-parse --git-path <marker>...`       — operation markers (unchanged).
*   3. `git status --porcelain=v2 --branch`         — counts + branch header.
*
* Why the short head cannot come from the v2 header: `# branch.oid` carries the
* FULL object name, and `git status --porcelain=v2 --branch --abbrev=7` is
* rejected (`error: unknown option 'abbrev=7'`, exit 129), while both the
* branch chip and the SSE change key (`routes.ts` computes
* `root|branch|head`) consume the abbreviated id that `rev-parse --short HEAD`
* prints — whose length is git's own adaptive abbreviation. `--abbrev-ref` and
* `--short` also cannot share one rev-parse invocation: with
* `--abbrev-ref HEAD --short HEAD` the branch is printed twice (the mode
* persists), and with the two swapped the command fails with `Needed a single
* revision`. Both forms were measured against real repositories; the captured
* outputs are the fixtures under `tests/fixtures/status-porcelain/`.
*/
/** `git rev-parse --show-toplevel --short HEAD` — root and short head in one spawn. */
const rootAndHeadArgv = () => [
	"rev-parse",
	"--show-toplevel",
	"--short",
	"HEAD"
];
/** `git status --porcelain=v2 --branch` — v2 entry records plus the branch header lines. */
const statusV2BranchArgv = () => [
	"status",
	"--porcelain=v2",
	"--branch"
];
/**
* Parse `git status --porcelain=v2 --branch`.
*
* Count equivalence with `parsePorcelain` (porcelain=v1) is the contract, and
* it is proven against real captured outputs in
* `tests/fixtures/status-porcelain/` (rename, paths with spaces, untracked
* directories, non-ASCII paths, ignored files, UU/AA conflicts, detached head,
* unborn head, bulk changes all agree):
* - ordinary change `1`, rename/copy `2` -> dirty (v1's fall-through);
* - untracked `?` -> untracked (v1's `??`);
* - unmerged `u` -> conflict (v1's seven unmerged XY codes);
* - ignored `!` -> not counted (v1 does not emit them without `--ignored`);
* - `#` header lines are skipped (v1 has none).
*
* Branch equivalence with `rev-parse --abbrev-ref HEAD`: that command prints
* `HEAD` for a detached head and also for an unborn branch (exit 128), so the
* service maps both to `''`. v2 reports `(detached)`/`(unknown)` and, for an
* unborn branch, `# branch.head <name>` with `# branch.oid (initial)`; the
* sentinels are mapped back to `''` so the field keeps its previous value.
* @param stdout - the command's stdout.
* @returns the branch (already sentinel-mapped) and the three counts.
*/
function parseStatusV2(stdout) {
	let dirtyFiles = 0;
	let untrackedFiles = 0;
	let conflicts = 0;
	let head = null;
	let oid = null;
	for (const line of stdout.split("\n")) {
		if (line === "") continue;
		if (line.startsWith("#")) {
			const header = /^# branch\.(oid|head) (.*)$/.exec(line);
			if (header !== null) if (header[1] === "oid") oid = header[2].trim();
			else head = header[2].trim();
			continue;
		}
		const type = line[0];
		if (type === "1" || type === "2") dirtyFiles += 1;
		else if (type === "?") untrackedFiles += 1;
		else if (type === "u") conflicts += 1;
		else if (type === "!") continue;
		else dirtyFiles += 1;
	}
	const counts = {
		dirtyFiles,
		untrackedFiles,
		conflicts
	};
	if (head === null || head.startsWith("(") || oid === "(initial)") return {
		branch: "",
		counts
	};
	return {
		branch: head,
		counts
	};
}
//#endregion
//#region src/core/types.ts
/** Parse output of `git for-each-ref refs/heads --format=...`. */
function parseBranches(stdout) {
	const rows = [];
	for (const line of stdout.split("\n")) {
		if (line === "") continue;
		const [name, head, oid] = line.split("\0");
		if (name === void 0 || head === void 0 || oid === void 0) continue;
		rows.push({
			name,
			current: head === "*"
		});
	}
	rows.sort((a, b) => a.name.localeCompare(b.name));
	return rows;
}
/** Parse `git worktree list --porcelain` into the branch refs checked out (porcelain prints `branch refs/heads/<name>`). */
function parseWorktreeBranches(stdout) {
	const branches = [];
	for (const line of stdout.split("\n")) {
		if (!line.startsWith("branch refs/heads/")) continue;
		const name = line.slice(18).trim();
		if (name !== "" && !branches.includes(name)) branches.push(name);
	}
	return branches;
}
/**
* Parse `git worktree list --porcelain` into full rows: blank-line-separated
* records of `worktree <path>` / `HEAD <oid>` / `branch refs/heads/<name>`
* (or `detached` / `bare`). The first record is the primary checkout.
*/
function parseWorktrees(stdout) {
	const rows = [];
	let current = null;
	const flush = () => {
		if (current === null || current.path === void 0) return;
		rows.push({
			path: current.path,
			head: current.head ?? "",
			branch: current.branch ?? "",
			main: rows.length === 0
		});
	};
	for (const line of stdout.split("\n")) {
		if (line === "") {
			flush();
			current = null;
			continue;
		}
		if (line.startsWith("worktree ")) {
			flush();
			current = { path: line.slice(9).trim() };
			continue;
		}
		if (current === null) continue;
		if (line.startsWith("HEAD ")) current.head = line.slice(5).trim();
		else if (line.startsWith("branch refs/heads/")) current.branch = line.slice(18).trim();
	}
	flush();
	return rows;
}
/** Parse the porcelain status into counts. */
function parsePorcelain(stdout) {
	let dirtyFiles = 0;
	let untrackedFiles = 0;
	let conflicts = 0;
	const unmerged = /* @__PURE__ */ new Set([
		"DD",
		"AU",
		"UD",
		"UA",
		"DU",
		"AA",
		"UU"
	]);
	for (const line of stdout.split("\n")) {
		if (line === "") continue;
		const xy = line.slice(0, 2);
		if (unmerged.has(xy)) conflicts += 1;
		else if (xy.startsWith("??")) untrackedFiles += 1;
		else dirtyFiles += 1;
	}
	return {
		dirtyFiles,
		untrackedFiles,
		conflicts
	};
}
/**
* Parse the graph format rows (`%H %P %an %at %D %s` split by \x1e). `git
* log` (tformat) appends a newline after the record separator, so every
* record except the first carries a leading `\n` — strip it or the oid gets
* corrupted and a trailing `\n` would parse as a phantom commit.
*/
function parseGraph(stdout) {
	const commits = [];
	for (const raw of stdout.split("")) {
		const entry = raw.replace(/^\n/, "");
		if (entry === "") continue;
		const [oid, parentsRaw, author, authorTimeRaw, decoration, subject] = entry.split("\0");
		if (oid === void 0 || oid === "") continue;
		commits.push({
			oid,
			parents: parentsRaw === void 0 || parentsRaw === "" ? [] : parentsRaw.split(" "),
			subject: subject ?? "",
			author: author ?? "",
			authorTime: Number(authorTimeRaw ?? "0"),
			refs: parseDecoration(decoration ?? "")
		});
	}
	return commits;
}
/** Decoration → ref names: split entries, drop the `HEAD -> ` handoff prefix, drop a bare detached-`HEAD` entry. The `tag: ` prefix is kept, so the sidebar can tell a tag from a branch. */
function parseDecoration(decoration) {
	if (decoration === "") return [];
	return decoration.split(", ").map((part) => {
		if (part === "HEAD") return "";
		return part.replace(/^HEAD -> /, "").trim();
	}).filter((name) => name !== "");
}
/**
* Runtime narrowing for the wire types served to the browser. Zod is not a
* dependency of this package, so each guard is a hand-written structural
* check over the same shape the host service produces. The routes boundary
* runs these before sending a view so a malformed service output can never
* leak to the client as a typed envelope value.
* @module dsh-git-graph/core/types
*/
/** Narrow an unknown value onto {@link RepoStatus}. */
function isRepoStatus(value) {
	if (typeof value !== "object" || value === null) return false;
	const record = value;
	return typeof record.root === "string" && typeof record.branch === "string" && typeof record.head === "string" && typeof record.dirtyFiles === "number" && typeof record.untrackedFiles === "number" && typeof record.conflicts === "number" && typeof record.operationInProgress === "boolean";
}
/** Narrow an unknown value onto {@link BranchRow}. */
function isBranchRow(value) {
	if (typeof value !== "object" || value === null) return false;
	const record = value;
	return typeof record.name === "string" && typeof record.current === "boolean";
}
/** Narrow an unknown value onto {@link BranchesView}. */
function isBranchesView(value) {
	if (typeof value !== "object" || value === null) return false;
	const record = value;
	return typeof record.root === "string" && typeof record.branch === "string" && Array.isArray(record.branches) && record.branches.every(isBranchRow) && typeof record.dirtyFiles === "number" && typeof record.untrackedFiles === "number" && typeof record.conflicts === "number" && typeof record.operationInProgress === "boolean";
}
/** Narrow an unknown value onto {@link GraphCommit}. */
function isGraphCommit(value) {
	if (typeof value !== "object" || value === null) return false;
	const record = value;
	return typeof record.oid === "string" && Array.isArray(record.parents) && record.parents.every((parent) => typeof parent === "string") && typeof record.subject === "string" && typeof record.author === "string" && typeof record.authorTime === "number" && Array.isArray(record.refs) && record.refs.every((ref) => typeof ref === "string");
}
/** Narrow an unknown value onto {@link GraphView}. */
function isGraphView(value) {
	if (typeof value !== "object" || value === null) return false;
	const record = value;
	return typeof record.root === "string" && typeof record.branch === "string" && Array.isArray(record.commits) && record.commits.every(isGraphCommit) && typeof record.hasMore === "boolean";
}
/** The set of stable {@link GitErrorCode} members the client maps onto copy. */
const GIT_ERROR_CODES = /* @__PURE__ */ new Set([
	"conflicts-present",
	"operation-in-progress",
	"branch-in-other-worktree",
	"tracked-changes-would-be-overwritten",
	"untracked-changes-would-be-overwritten",
	"target-branch-not-found",
	"invalid-branch-name",
	"branch-already-exists",
	"workspace-unknown",
	"invalid-worktree-name",
	"worktree-already-exists",
	"worktree-dirty",
	"worktree-not-found",
	"worktree-is-main",
	"base-ref-not-found",
	"internal"
]);
/** Narrow an unknown value onto {@link WorktreeInfo}. */
function isWorktreeInfo(value) {
	if (typeof value !== "object" || value === null) return false;
	const record = value;
	return typeof record.path === "string" && typeof record.head === "string" && typeof record.branch === "string" && typeof record.main === "boolean";
}
/** Narrow an unknown value onto {@link WorktreeListView}. */
function isWorktreeListView(value) {
	if (typeof value !== "object" || value === null) return false;
	const record = value;
	return typeof record.root === "string" && Array.isArray(record.worktrees) && record.worktrees.every(isWorktreeInfo);
}
/** Narrow an unknown value onto {@link GitFeatureConfig}. */
function isGitFeatureConfig(value) {
	if (typeof value !== "object" || value === null) return false;
	const record = value;
	return typeof record.autoIsolate === "boolean" && (record.autoBaseline === "current" || record.autoBaseline === "default") && typeof record.worktreesHome === "string";
}
/** Narrow an unknown value onto {@link GitErrorCode}. */
function isGitErrorCode(value) {
	return typeof value === "string" && GIT_ERROR_CODES.has(value);
}
/** Narrow an unknown value onto {@link GitError}. */
function isGitError(value) {
	if (typeof value !== "object" || value === null) return false;
	const record = value;
	if (!isGitErrorCode(record.code)) return false;
	if (typeof record.message !== "string") return false;
	if (record.paths !== void 0 && (!Array.isArray(record.paths) || !record.paths.every((path) => typeof path === "string"))) return false;
	if (record.moreFiles !== void 0 && typeof record.moreFiles !== "number") return false;
	return true;
}
//#endregion
//#region src/host/dsh-home.ts
/**
* DSH_HOME resolution shared by the plugin family's Host halves: the
* environment override wins, the platform home fallback follows. Mirrors
* what dsh-pet and dsh-liangshen each used to implement locally.
*/
/** Expand a leading ~ (or ~user) in a path, platform-style. */
function expandHome(path, home = homedir()) {
	const j = home.startsWith("/") ? join$1 : join;
	if (path === "~") return home;
	if (path.startsWith("~/") || path.startsWith("~\\")) return j(home, path.slice(2));
	return path;
}
/**
* Resolve the DSH home directory.
* @param env - process environment to read DSH_HOME from.
* @param home - platform home directory fallback (test seam).
* @returns the absolute DSH home path.
*/
function resolveDshHome(env = process.env, home = homedir()) {
	const isPosix = home.startsWith("/");
	const j = isPosix ? join$1 : join;
	const isAbs = isPosix ? isAbsolute$1 : isAbsolute;
	const raw = env.DSH_HOME;
	if (raw !== void 0 && raw.trim() !== "") {
		const expanded = expandHome(raw.trim(), home);
		return isAbs(expanded) ? expanded : j(process.cwd(), expanded);
	}
	return j(home, ".dsh");
}
/** Resolve the DSH home directory from the live environment. */
function dshHome() {
	return resolveDshHome();
}
//#endregion
//#region src/host/worktree-home.ts
/**
* Managed-worktree location: every plugin-created worktree lives under
* `$DSH_HOME/worktrees/<repo-key>/<name>/` where repo-key pairs the
* sanitized repository basename with a short hash of its canonical root, so
* same-named repositories never collide. Host-only (node:crypto); the
* browser learns the absolute prefix through the /git/config view.
* @module dsh-git-graph/host/worktree-home
*/
/** The absolute directory every managed worktree family lives under. */
function worktreesHome() {
	return join(dshHome(), "worktrees");
}
/**
* The stable key of one repository inside the managed home: sanitized
* basename plus 8 hex chars of its canonical root's sha1.
* @param root - canonical repository root (realpath'd).
*/
function repoKeyFor(root) {
	return `${sanitizeWorktreeName(basename(root)) ?? "repo"}-${createHash("sha1").update(root).digest("hex").slice(0, 8)}`;
}
/** The absolute path one named worktree of one repository would occupy. */
function worktreePathFor(root, name) {
	return join(worktreesHome(), repoKeyFor(root), name);
}
/** The absolute directory holding every managed worktree of one repository. */
function repoWorktreesDir(root) {
	return join(worktreesHome(), repoKeyFor(root));
}
/**
* Containment check for removal: a managed worktree path must be a DIRECT
* child of the repository's managed directory. Both inputs must already be
* canonical (realpath'd) absolute paths — DSH_HOME may itself traverse
* symlinks, so the call site canonicalizes the managed directory too.
* @param dir - canonical managed directory (repoWorktreesDir output, resolved).
* @param candidate - canonical worktree path.
*/
function isManagedWorktreeOf(dir, candidate) {
	if (!candidate.startsWith(dir + sep)) return false;
	return !candidate.slice(dir.length + 1).includes(sep);
}
//#endregion
//#region src/host/git-service.ts
/**
* Host git service: workspace-scoped git operations through a runner seam
* (production: the subprocess service; tests: a plain child_process runner).
* Guards mirror ZCode's branchSwitcher semantics — unresolved conflicts,
* in-progress operations, and branches checked out in another worktree are
* rejected with stable codes before any mutation.
* @module dsh-git-graph/host/git-service
*/
/**
* Build the argv for one git invocation, with the win32 binary variant.
* Windows ships git as git.exe (git for Windows); a .cmd/.bat shim in PATH
* would otherwise be the resolution target and Node's spawn cannot launch
* a .cmd file directly (the dsh-subprocess seam applies no shell). Naming
* git.exe bypasses any shim and always hits the native executable. cmd.exe
* routing is deliberately NOT used: several git args carry %-format specs
* (for-each-ref/log --format) that cmd would expand and corrupt.
* @param platform - the process platform (process.platform in production; a test seam).
* @param argv - the git subcommand args.
* @returns the full spawn argv, starting with the platform git binary.
*/
function gitSpawnArgv(platform, argv) {
	return platform === "win32" ? ["git.exe", ...argv] : ["git", ...argv];
}
/**
* Production runner over `ctx.subprocess`: shared plumbing with the win32
* git.exe argv variant.
* @param ctx - context carrying the subprocess service.
* @returns the runner.
*/
function subprocessRunner(ctx) {
	return subprocessRunner$1(ctx, { spawnArgv: (argv) => gitSpawnArgv(process.platform, argv) });
}
/** HEAD is the symbolic value `git rev-parse --abbrev-ref HEAD` prints when detached. */
const DETACHED = "HEAD";
/** Rejection for a path outside the workspace registry. */
const WORKSPACE_UNKNOWN = {
	code: "workspace-unknown",
	message: "path is not a registered workspace"
};
/**
* Workspace-scoped git operations. Every public method first passes the
* workspace gate, then resolves the repository root from the requested path
* and rejects non-repositories with `null` (or a rejection for mutations).
*/
var GitService = class {
	runner;
	gate;
	/**
	* @param runner - the spawn seam.
	* @param gate - workspace-membership gate (host: canonical path ∈ registered workspace paths).
	*/
	constructor(runner, gate) {
		this.runner = runner;
		this.gate = gate;
	}
	/** Status work currently running for each requested workspace path. */
	statusFlights = /* @__PURE__ */ new Map();
	/**
	* The plumbing every read view shares: gate, repository root, current branch,
	* short head, the porcelain counts and the operation marker. Null when the
	* path is not a usable repository (the workspace-gate semantics both views
	* keep). Three spawns: one `rev-parse` for root+short-head, then the marker
	* probe and the status scan in parallel.
	*/
	async snapshot(path, signal) {
		const gated = await this.gate(path);
		if (!gated.ok) return null;
		return this.plumbing(gated.canonical, signal);
	}
	/**
	* The repository snapshot the branch chip renders; null when not a repository.
	* Concurrent reads for the same requested workspace share one underlying
	* status task until it settles, preventing timed-out polls from accumulating.
	*/
	status(path, signal) {
		const existing = this.statusFlights.get(path);
		if (existing !== void 0) return existing;
		const flight = this.statusFromPath(path, signal);
		this.statusFlights.set(path, flight);
		const clear = () => {
			if (this.statusFlights.get(path) === flight) this.statusFlights.delete(path);
		};
		flight.then(clear, clear);
		return flight;
	}
	async statusFromPath(path, signal) {
		const gated = await this.gate(path);
		if (!gated.ok) return null;
		return this.statusFromGatedPath(gated.canonical, signal);
	}
	async statusFromGatedPath(path, signal) {
		const snap = await this.plumbing(path, signal);
		if (snap === null) return null;
		return {
			root: snap.root,
			branch: snap.branch,
			head: snap.head,
			dirtyFiles: snap.counts.dirtyFiles,
			untrackedFiles: snap.counts.untrackedFiles,
			conflicts: snap.counts.conflicts,
			operationInProgress: snap.operationInProgress
		};
	}
	/**
	* Repository root and short head from ONE `rev-parse`. The combined call
	* prints the root first and the short id second; an unborn HEAD makes the
	* second half fail (exit 128) after the root has already been printed, which
	* is the same verdict as the previous separate probes (root resolved, head
	* empty). A path outside any repository prints nothing at all -> null.
	*/
	async rootAndHead(path, signal) {
		const [rootLine = "", headLine = ""] = (await this.runner.run(rootAndHeadArgv(), path, signal)).stdout.split("\n").map((line) => line.trim());
		return rootLine === "" ? null : {
			root: rootLine,
			head: headLine
		};
	}
	/** The three-spawn plumbing shared by `status` and `branches`. */
	async plumbing(path, signal) {
		const base = await this.rootAndHead(path, signal);
		if (base === null) return null;
		const [markers, status] = await Promise.all([this.runner.run(operationMarkersArgv(), base.root, signal), this.runner.run(statusV2BranchArgv(), base.root, signal)]);
		const parsed = parseStatusV2(status.stdout);
		return {
			root: base.root,
			branch: parsed.branch,
			head: base.head,
			counts: parsed.counts,
			operationInProgress: await this.operationVerdict(base.root, markers, signal)
		};
	}
	/** Local branch list with the current branch marked (git for-each-ref refs/heads). */
	async branches(path) {
		const snap = await this.snapshot(path);
		if (snap === null) return null;
		const refs = await this.runner.run(forEachRefArgv(), snap.root);
		return {
			root: snap.root,
			branch: snap.branch,
			branches: parseBranches(refs.stdout),
			dirtyFiles: snap.counts.dirtyFiles,
			untrackedFiles: snap.counts.untrackedFiles,
			conflicts: snap.counts.conflicts,
			operationInProgress: snap.operationInProgress
		};
	}
	/**
	* Switch the workspace's checked-out branch: real `git switch --no-guess`
	* on disk, affecting every session in the workspace (never a per-session
	* override). Guards run before the mutation; switch failures classify onto
	* the stable error codes.
	* @param path - workspace root.
	* @param branch - existing local branch name.
	*/
	async switchBranch(path, branch) {
		const gated = await this.gate(path);
		if (!gated.ok) return {
			ok: false,
			error: WORKSPACE_UNKNOWN
		};
		const root = await this.repoRoot(gated.canonical);
		if (root === null) return {
			ok: false,
			error: {
				code: "internal",
				message: "not a git repository"
			}
		};
		const formatted = await this.runner.run(checkRefFormatArgv(branch), root);
		if (formatted.exitCode !== 0) return {
			ok: false,
			error: {
				code: "invalid-branch-name",
				message: formatted.stderr.trim() || "invalid branch name"
			}
		};
		if ((await this.runner.run(verifyRefArgv(branch), root)).exitCode !== 0) return {
			ok: false,
			error: {
				code: "target-branch-not-found",
				message: `branch "${branch}" does not exist locally`
			}
		};
		if ((await this.runner.run(headBranchArgv(), root)).stdout.trim() === branch) return {
			ok: true,
			branch
		};
		const blocked = await this.guardBlock(root, branch);
		if (blocked !== null) return {
			ok: false,
			error: blocked
		};
		const switched = await this.runner.run(switchArgv(branch), root);
		if (switched.exitCode === 0) return {
			ok: true,
			branch
		};
		return {
			ok: false,
			error: classifySwitchFailure(switched.stderr)
		};
	}
	/**
	* Create a branch from the current HEAD and switch to it
	* (`git switch --no-guess -c <name>`). The authoritative name gate is
	* `git check-ref-format --branch`; duplicates are rejected up front.
	* @param path - workspace root.
	* @param name - proposed branch name.
	*/
	async createBranch(path, name) {
		const mirrorReason = validateBranchName(name);
		if (mirrorReason !== null) return {
			ok: false,
			error: {
				code: "invalid-branch-name",
				message: `invalid branch name: ${mirrorReason}`
			}
		};
		const gated = await this.gate(path);
		if (!gated.ok) return {
			ok: false,
			error: WORKSPACE_UNKNOWN
		};
		const root = await this.repoRoot(gated.canonical);
		if (root === null) return {
			ok: false,
			error: {
				code: "internal",
				message: "not a git repository"
			}
		};
		const formatted = await this.runner.run(checkRefFormatArgv(name), root);
		if (formatted.exitCode !== 0) return {
			ok: false,
			error: {
				code: "invalid-branch-name",
				message: formatted.stderr.trim() || "invalid branch name"
			}
		};
		if ((await this.runner.run(verifyRefArgv(name), root)).exitCode === 0) return {
			ok: false,
			error: {
				code: "branch-already-exists",
				message: `branch "${name}" already exists`
			}
		};
		const blocked = await this.guardBlock(root, void 0);
		if (blocked !== null) return {
			ok: false,
			error: blocked
		};
		const created = await this.runner.run(createBranchArgv(name), root);
		if (created.exitCode === 0) return {
			ok: true,
			branch: name
		};
		return {
			ok: false,
			error: classifySwitchFailure(created.stderr)
		};
	}
	/** Topo-ordered commit graph across branches/tags/remotes (read-only). */
	async graph(path, limit = 200) {
		const gated = await this.gate(path);
		if (!gated.ok) return null;
		const root = await this.repoRoot(gated.canonical);
		if (root === null) return null;
		const [logResult, branchResult] = await Promise.all([this.runner.run(graphLogArgv(limit + 1), root), this.runner.run(headBranchArgv(), root)]);
		const commits = parseGraph(logResult.stdout);
		const hasMore = commits.length > limit;
		const branch = branchResult.stdout.trim();
		return {
			root,
			branch: branch === DETACHED ? "" : branch,
			commits: hasMore ? commits.slice(0, limit) : commits,
			hasMore
		};
	}
	/** All linked worktrees of the workspace's repository (read-only). */
	async worktrees(path, signal) {
		const gated = await this.gate(path);
		if (!gated.ok) return null;
		const root = await this.repoRoot(gated.canonical, signal);
		if (root === null) return null;
		const result = await this.runner.run(worktreeListArgv(), root, signal);
		if (result.exitCode !== 0) return null;
		return {
			root,
			worktrees: parseWorktrees(result.stdout)
		};
	}
	/**
	* Create a managed worktree: `git worktree add -b wt/<name> <target> <baseRef>`
	* under $DSH_HOME/worktrees/<repo-key>/<name>/. The target path is ALWAYS
	* host-constructed (the caller supplies only a name, never a path), and the
	* worktree always checks out a NEW wt/ branch — git allows one branch in
	* one checkout, so reusing the base branch would break the main checkout.
	* @param path - workspace root.
	* @param rawName - proposed worktree name (sanitized; collisions reject).
	* @param baseRef - base revision; omitted means the checkout's current HEAD,
	*   and an unresolvable 'origin/HEAD' falls back to HEAD (no remote).
	*/
	async addWorktree(path, rawName, baseRef) {
		const name = sanitizeWorktreeName(rawName);
		if (name === null) return {
			ok: false,
			error: {
				code: "invalid-worktree-name",
				message: `invalid worktree name: ${JSON.stringify(rawName)}`
			}
		};
		const gated = await this.gate(path);
		if (!gated.ok) return {
			ok: false,
			error: WORKSPACE_UNKNOWN
		};
		const root = await this.repoRoot(gated.canonical);
		if (root === null) return {
			ok: false,
			error: {
				code: "internal",
				message: "not a git repository"
			}
		};
		const branch = "wt/" + name;
		const formatted = await this.runner.run(checkRefFormatArgv(branch), root);
		if (formatted.exitCode !== 0) return {
			ok: false,
			error: {
				code: "invalid-worktree-name",
				message: formatted.stderr.trim() || "invalid worktree name"
			}
		};
		if ((await this.runner.run(verifyRefArgv(branch), root)).exitCode === 0) return {
			ok: false,
			error: {
				code: "worktree-already-exists",
				message: `branch "${branch}" already exists`
			}
		};
		const target = worktreePathFor(root, name);
		if (existsSync(target)) return {
			ok: false,
			error: {
				code: "worktree-already-exists",
				message: `worktree path already exists: ${target}`
			}
		};
		let base = baseRef === void 0 || baseRef.trim() === "" ? "HEAD" : baseRef.trim();
		if ((await this.runner.run(verifyRevArgv(base), root)).exitCode !== 0) if (base === "origin/HEAD") base = "HEAD";
		else return {
			ok: false,
			error: {
				code: "base-ref-not-found",
				message: `base ref "${base}" does not resolve`
			}
		};
		if (await this.operationInProgress(root)) return {
			ok: false,
			error: {
				code: "operation-in-progress",
				message: "a git operation is in progress"
			}
		};
		await mkdir(repoWorktreesDir(root), { recursive: true });
		const added = await this.runner.run(worktreeAddArgv(target, branch, base), root);
		if (added.exitCode === 0) return {
			ok: true,
			path: target,
			branch,
			name
		};
		return {
			ok: false,
			error: classifySwitchFailure(added.stderr)
		};
	}
	/**
	* Remove a managed worktree. Containment is enforced twice: the canonical
	* target must be a direct child of the repository's managed directory, and
	* it must appear in `git worktree list`. A dirty worktree (or one with an
	* in-progress operation) rejects unless force is set; deleteBranch removes
	* the wt/ branch afterwards and only ever applies to that prefix.
	* @param path - workspace root.
	* @param worktreePath - the worktree to remove (any spelling; canonicalized here).
	* @param opts - force overrides the dirtiness guard; deleteBranch drops the wt/ branch.
	*/
	async removeWorktree(path, worktreePath, opts = {}) {
		const gated = await this.gate(path);
		if (!gated.ok) return {
			ok: false,
			error: WORKSPACE_UNKNOWN
		};
		const root = await this.repoRoot(gated.canonical);
		if (root === null) return {
			ok: false,
			error: {
				code: "internal",
				message: "not a git repository"
			}
		};
		let canonical;
		try {
			canonical = await realpath(worktreePath);
		} catch {
			return {
				ok: false,
				error: {
					code: "worktree-not-found",
					message: `worktree path does not resolve: ${worktreePath}`
				}
			};
		}
		let canonicalHome;
		try {
			canonicalHome = await realpath(repoWorktreesDir(root));
		} catch {
			return {
				ok: false,
				error: {
					code: "worktree-not-found",
					message: "this repository has no managed worktree directory"
				}
			};
		}
		if (!isManagedWorktreeOf(canonicalHome, canonical)) return {
			ok: false,
			error: {
				code: "worktree-not-found",
				message: "not a managed worktree of this repository"
			}
		};
		const listed = await this.runner.run(worktreeListArgv(), root);
		let entry;
		for (const item of parseWorktrees(listed.stdout)) try {
			if (await realpath(item.path) === canonical) {
				entry = item;
				break;
			}
		} catch {}
		if (entry === void 0) return {
			ok: false,
			error: {
				code: "worktree-not-found",
				message: `git does not list ${canonical} as a worktree`
			}
		};
		if (entry.main) return {
			ok: false,
			error: {
				code: "worktree-is-main",
				message: "the primary checkout cannot be removed"
			}
		};
		if (opts.force !== true) {
			const counts = parsePorcelain((await this.runner.run(statusPorcelainArgv(), canonical)).stdout);
			if (counts.dirtyFiles + counts.untrackedFiles + counts.conflicts > 0) return {
				ok: false,
				error: {
					code: "worktree-dirty",
					message: "the worktree has uncommitted changes"
				}
			};
			if (await this.operationInProgress(canonical)) return {
				ok: false,
				error: {
					code: "operation-in-progress",
					message: "a git operation is in progress in the worktree"
				}
			};
		}
		const removed = await this.runner.run(worktreeRemoveArgv(canonical, opts.force === true), root);
		if (removed.exitCode !== 0) return {
			ok: false,
			error: {
				code: "internal",
				message: removed.stderr.trim() || "git worktree remove failed"
			}
		};
		if (opts.deleteBranch === true && entry.branch.startsWith("wt/")) await this.runner.run(branchDeleteForceArgv(entry.branch), root);
		return { ok: true };
	}
	/** Repository root of a canonical path, or null when not inside a git repository. */
	async repoRoot(path, signal) {
		const result = await this.runner.run(topLevelArgv(), path, signal);
		if (result.exitCode !== 0) return null;
		const root = result.stdout.trim();
		return root === "" ? null : root;
	}
	/** Whether any git operation marker is present in the repository. */
	async operationInProgress(root, signal) {
		const resolved = await this.runner.run(operationMarkersArgv(), root, signal);
		return this.operationVerdict(root, resolved, signal);
	}
	/**
	* Marker verdict from an already-run combined probe (the status plumbing
	* runs it in parallel with the status scan), with the per-marker fallback
	* kept for a non-zero combined exit.
	*/
	async operationVerdict(root, resolved, signal) {
		if (resolved.exitCode === 0) return resolved.stdout.split("\n").map((line) => line.trim()).filter((line) => line !== "").some((markerPath) => existsSync(resolve(root, markerPath)));
		let inProgress = false;
		for (const marker of OPERATION_MARKERS) {
			const markerPath = (await this.runner.run(gitPathArgv(marker), root, signal)).stdout.trim();
			if (markerPath !== "" && existsSync(resolve(root, markerPath))) inProgress = true;
		}
		return inProgress;
	}
	/**
	* The pre-switch guards (ZCode branchSwitcher semantics): unresolved
	* conflicts, in-progress operations, and a target already checked out in
	* another worktree.
	* @param root - repository root.
	* @param target - target branch; undefined for create (worktree check skipped).
	* @returns the rejection, or null when the switch may proceed.
	*/
	async guardBlock(root, target) {
		const [conflicts, inProgress, worktrees] = await Promise.all([
			this.runner.run(unmergedArgv(), root),
			this.operationInProgress(root),
			target === void 0 ? Promise.resolve(null) : this.runner.run(worktreeListArgv(), root)
		]);
		const conflictCount = conflicts.stdout.split("\n").filter((line) => line !== "").length;
		if (conflictCount > 0) return {
			code: "conflicts-present",
			message: `repository has ${conflictCount} unresolved conflict(s)`
		};
		if (inProgress) return {
			code: "operation-in-progress",
			message: "a git operation is in progress"
		};
		if (target !== void 0 && worktrees !== null && parseWorktreeBranches(worktrees.stdout).includes(target)) return {
			code: "branch-in-other-worktree",
			message: `branch "${target}" is checked out in another worktree`
		};
		return null;
	}
};
//#endregion
//#region src/host/poll-guard.ts
const DEFAULT_TIMERS = {
	set: (fn, ms) => setTimeout(fn, ms),
	clear: (handle) => {
		clearTimeout(handle);
	}
};
/**
* Owns one bounded poll loop.
*
* Guarantees: at most one task runs at a time (a scheduled tick whose turn
* arrives while a run is in flight is dropped); consecutive failures double
* the delay up to maxBackoffMs and reset on the first success; the loop
* stops forever at deadlineMs and cancels its timer.
*/
var PollGuard = class {
	options;
	handle;
	running = false;
	startedAt = 0;
	stopped = false;
	failures = 0;
	/** @param options - loop bounds; interval/deadline/backoff/onRun are required, the rest optional. */
	constructor(options) {
		this.options = {
			timers: DEFAULT_TIMERS,
			onDeadline: () => {},
			onSettled: () => {},
			...options
		};
	}
	/** Start the loop. Safe to call once; later calls are ignored. */
	start() {
		if (this.startedAt !== 0) return;
		this.startedAt = Date.now();
		this.schedule(this.options.intervalMs);
	}
	/** Stop the loop permanently and drop any pending tick. */
	stop() {
		this.stopped = true;
		this.options.timers.clear(this.handle);
		this.handle = void 0;
	}
	schedule(delayMs) {
		if (this.stopped) return;
		this.handle = this.options.timers.set(() => {
			this.tick();
		}, delayMs);
	}
	delay() {
		const backoff = this.options.intervalMs * 2 ** Math.min(this.failures, 8);
		return Math.min(backoff, this.options.maxBackoffMs);
	}
	async tick() {
		if (this.stopped) return;
		if (this.running) return;
		if (Date.now() - this.startedAt >= this.options.deadlineMs) {
			this.stopped = true;
			this.options.onDeadline();
			return;
		}
		this.running = true;
		try {
			await this.options.onRun();
			this.failures = 0;
		} catch {
			this.failures += 1;
		} finally {
			this.running = false;
			this.options.onSettled(this.failures);
			this.schedule(this.delay());
		}
	}
};
//#endregion
//#region src/host/loopback.ts
/** IPv4 127/8 predicate (four decimal octets, first == 127). */
function isIPv4Loopback(v4) {
	const parts = v4.split(".");
	return parts.length === 4 && parts[0] === "127" && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}
/** Whether a socket remote address names the loopback range (127/8, ::1, IPv4-mapped). */
function isLoopbackAddress(address) {
	if (address === void 0) return false;
	const normalized = address.toLowerCase();
	if (normalized === "::1") return true;
	if (normalized.startsWith("::ffff:")) return isIPv4Loopback(normalized.slice(7));
	return isIPv4Loopback(normalized);
}
/** Whether a normalized URL hostname names the loopback authority (localhost, [::1], 127/8). */
function isLoopbackHostname(hostname) {
	if (hostname === "localhost" || hostname === "[::1]") return true;
	return isIPv4Loopback(hostname);
}
/**
* Whether a reverse proxy stood between the client and this host: the request
* carries CF-Connecting-IP or X-Forwarded-For. Either header is stamped by a
* hop that forwards traffic, so the request did not originate on this machine.
* @param request - node HTTP request.
* @returns true when a forwarding header is present.
*/
function isProxiedRequest(request) {
	return request.headers["cf-connecting-ip"] !== void 0 || request.headers["x-forwarded-for"] !== void 0;
}
/**
* Request-level trust fence: a loopback socket address AND a loopback Host
* header, plus browser same-origin markers. The socket address is
* authoritative for a direct connection; a request that carries a forwarding
* header is refused outright, because a proxy in front of the host makes both
* the socket address and the Host header describe the proxy rather than the
* client. X-Forwarded-For is therefore never evidence *for* loopback.
*/
function isLoopbackRequest(request) {
	if (!isLoopbackAddress(request.socket.remoteAddress)) return false;
	if (isProxiedRequest(request)) return false;
	const host = request.headers.host;
	if (typeof host !== "string") return false;
	let hostUrl;
	try {
		hostUrl = new URL("http://" + host);
	} catch {
		return false;
	}
	if (!isLoopbackHostname(hostUrl.hostname)) return false;
	if (request.headers["sec-fetch-site"] === "cross-site") return false;
	const origin = request.headers.origin;
	if (origin === void 0) return true;
	try {
		return new URL(origin).host === hostUrl.host;
	} catch {
		return false;
	}
}
//#endregion
//#region src/host/pair-access.ts
/**
* Whether this request may enter the plugin's host routes.
* @param ctx - host context; may expose remoteWebUiPairing.
* @param request - the incoming HTTP request.
* @returns true for loopback, or a live paired-device cookie.
*/
function isPairedOrLoopbackAllowed(ctx, request) {
	if (isLoopbackRequest(request)) return true;
	const fromGet = typeof ctx.get === "function" ? ctx.get("remoteWebUiPairing", false) : void 0;
	return (isPairingAccess(fromGet) ? fromGet : ctx.remoteWebUiPairing)?.isPairedDevice(request) === true;
}
function isPairingAccess(value) {
	return value !== void 0 && value !== null && typeof value.isPairedDevice === "function";
}
//#endregion
//#region src/host/access.ts
/**
* Whether this request may enter any /git route (JSON operations or SSE).
* @param ctx - host context; may expose remoteWebUiPairing.
* @param request - the incoming HTTP request.
* @returns true for loopback, or a live paired-device cookie.
*/
function isGitAllowed(ctx, request) {
	return isPairedOrLoopbackAllowed(ctx, request);
}
//#endregion
//#region src/host/http.ts
/** Default body cap for readJsonBody: 64 KiB. */
const DEFAULT_JSON_BODY_MAX_BYTES = 64 * 1024;
/** Family-default JSON response headers; callers may append or override. */
const JSON_HEADERS = {
	"content-type": "application/json; charset=utf-8",
	"referrer-policy": "no-referrer"
};
/**
* Lenient bounded body reader: parse a request body as JSON, or null on an
* empty body, invalid JSON, or a body past maxBytes (default 64 KiB).
* Overflow destroys the request instead of draining the remainder (no drain
* call, matching the current repo-wide behavior); callers must not keep
* reading the request afterwards. With objectOnly, non-JSON-object payloads
* also yield null.
*/
async function readJsonBody(req, opts = {}) {
	const maxBytes = opts.maxBytes ?? DEFAULT_JSON_BODY_MAX_BYTES;
	const chunks = [];
	let size = 0;
	for await (const chunk of req) {
		const buffer = chunk;
		size += buffer.length;
		if (size > maxBytes) {
			req.destroy();
			return null;
		}
		chunks.push(buffer);
	}
	const text = Buffer.concat(chunks).toString("utf8");
	if (text === "") return null;
	try {
		const parsed = JSON.parse(text);
		if (opts.objectOnly && !isJsonObject(parsed)) return null;
		return parsed;
	} catch {
		return null;
	}
}
/** Whether a value is a JSON object: typeof object, not null, not an array. */
function isJsonObject(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/**
* Write one JSON response. Default headers are the family defaults
* (content-type and referrer-policy); caller headers are appended or
* override them.
*/
function writeJson(res, status, body, headers = {}) {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		...JSON_HEADERS,
		...headers
	});
	res.end(payload);
}
//#endregion
//#region src/host/routes.ts
/** Test-friendly default: every gateable feature off, the real managed home. */
const defaultFeatureConfig = () => ({
	autoIsolate: false,
	autoBaseline: "current",
	worktreesHome: worktreesHome(),
	conventionsDoc: "GIT_CONVENTIONS.md",
	conventionsAuto: true
});
const OK = (value) => ({
	ok: true,
	value
});
const FAIL = (error) => ({
	ok: false,
	error
});
/** Git operation error for structurally invalid requests (never a workspace fault). */
const BAD_REQUEST = {
	code: "internal",
	message: "malformed request"
};
/**
* Poll interval for external git-state changes while subscribers are
* connected. Kept deliberately long (30s): each tick spawns several git
* processes per subscriber, and on Windows a cold git.exe costs ~0.7s per
* spawn — a short interval turns the poll itself into a self-exciting
* storm. Window focus and the client's own refresh calls cover the
* interactive freshness path.
*/
const POLL_INTERVAL_MS = 3e4;
/** SSE keep-alive comment interval (proxies drop idle connections). */
const HEARTBEAT_INTERVAL_MS = 15e3;
/**
* Route-layer deadline for one git status request. On expiry the controller
* aborts the read path so the subprocess can terminate; the JSON handler keeps
* the stable envelope and the SSE poll loop can clear its overlap guard.
*/
const STATUS_TIMEOUT_MS = 15e3;
const STATUS_TIMEOUT_MESSAGE = "git status timed out";
/**
* PollGuard lifetime bound. The SSE loop must live exactly as long as the
* subscriber set (start on first join, stop on empty), so there is no natural
* server-side expiry: the deadline is set to a sentinel that never fires and
* the loop is terminated by {@link PollGuard.stop} when the last subscriber
* closes. The per-subscriber 15s {@link STATUS_TIMEOUT_MS} deadline is a run
* bound, unrelated to this loop-lifetime value.
*/
const POLL_LIFETIME_MS = Number.MAX_SAFE_INTEGER;
/** Git operation error for a structurally invalid service view (never a workspace fault). */
const MALFORMED_VIEW = {
	code: "internal",
	message: "malformed git response"
};
/** Extract the required string field from a JSON object payload. */
function pathOf(payload) {
	if (typeof payload !== "object" || payload === null) return null;
	const path = payload.path;
	return typeof path === "string" && path !== "" ? path : null;
}
/**
* Send a service view under the ok envelope, rejecting structurally invalid
* values (a malformed RepoStatus / BranchesView / GraphView would otherwise
* leak to the browser as a typed-but-wrong payload).
* @param res - the server response.
* @param value - the view the service produced.
* @param guard - the runtime narrowing for the view.
*/
function okView(res, value, guard) {
	if (value !== null && !guard(value)) {
		writeJson(res, 200, FAIL(MALFORMED_VIEW));
		return;
	}
	writeJson(res, 200, OK(value));
}
/**
* Register the /git routes (prefix for the JSON operations, exact for the
* SSE stream — longest-prefix-wins keeps them disjoint).
* @param ctx - context carrying the webServer service.
* @param service - the workspace-gated git service.
* @param config - live feature-config thunk (the /git/config view; settings-driven). Optional for tests: the default disables every gateable feature.
* @returns the route disposers.
*/
//#region src/host/conventions.ts
/**
 * Git conventions (workspace discipline) — the document a repository gets told
 * to follow, plus the catalogue of proven frameworks the UI offers.
 *
 * This file is spliced into `lib/index.js` between the
 * `//#region src/host/conventions.ts` markers by `scripts/build-lib.mjs`; it is
 * not a module of its own and uses the host bundle's scope (`stat`,
 * `writeFile`, `join`, `basename`, `readdir` come from `node:fs/promises` and
 * `node:path` at the top of `lib/index.js`).
 */

/** Default document name, relative to the repository root. */
const CONVENTION_DOC_DEFAULT = "GIT_CONVENTIONS.md";

/**
 * Normalize a configured document name: a bare relative path inside the
 * repository root. Anything suspicious (absolute, `..`, empty) falls back to
 * the default instead of escaping the repository.
 */
function conventionDocName(docName) {
	if (typeof docName !== "string") return CONVENTION_DOC_DEFAULT;
	const trimmed = docName.trim().replace(/\\/g, "/").replace(/^\/+/, "");
	if (trimmed === "" || trimmed.includes("..") || trimmed.includes("\u0000")) return CONVENTION_DOC_DEFAULT;
	return trimmed;
}

/** The convention-related part of the feature config, resolved and normalized. */
function featureOf(config) {
	let active;
	try {
		active = typeof config === "function" ? config() : config;
	} catch {
		active = void 0;
	}
	return {
		docName: conventionDocName(active?.conventionsDoc),
		autoScaffold: active?.conventionsAuto !== false
	};
}

/** Upper bound on the document the UI is willing to preview/serve. */
const CONVENTION_DOC_MAX_BYTES = 64 * 1024;

/**
 * The empty scaffold written when a repository is created before the team has
 * picked a framework. Every heading is a question to answer, so the document
 * is useful even unfilled, and `status: draft` marks it as unfinished.
 */
const CONVENTION_SCAFFOLD = `# Git 规范 / Git conventions

> 本文件由 dsh-git-graph-sidebar 在仓库创建时生成。请把每节的「待定」换成你们团队的决定，
> 定稿后把下面的 \`status\` 改成 \`settled\`。空文档就是一次约定：**先立规矩，再写代码。**
>
> Generated by dsh-git-graph-sidebar when the repository was created. Replace every
> 「待定」 with your team's decision and change \`status\` below to \`settled\`.

\`\`\`yaml
status: draft          # draft | settled
framework: none        # 选定后填框架 id，例如 conventional-commits
owner: 待定             # 谁维护这份规范
updated: 待定           # 最近一次定稿日期
\`\`\`

## 1. 提交信息 / Commit messages

- 格式：待定（例：\`type(scope): subject\`，见 Conventional Commits）
- type 取值：待定（feat / fix / docs / refactor / test / chore …）
- 语言：待定（中文 / English / 两者）
- 一行长度上限：待定
- 关联 issue：待定（例：\`Refs #123\`）

## 2. 分支模型 / Branching

- 长期分支：待定（例：只保留 \`main\`）
- 工作分支命名：待定（例：\`feature/<slug>\`、\`fix/<slug>\`）
- 分支生命周期：待定（最长存活几天）
- 合并方式：待定（squash / merge commit / rebase）

## 3. 评审与合并 / Review & merge

- 必须几人评审：待定
- 必须通过哪些检查：待定（构建 / 测试 / lint）
- 谁可以合并：待定
- 是否允许直接推 \`main\`：待定

## 4. 版本与发布 / Versioning & release

- 版本号规则：待定（例：SemVer \`MAJOR.MINOR.PATCH\`）
- tag 格式：待定（例：\`v1.2.3\`）
- 发布节奏：待定（按需 / 每周 / 每迭代）
- 破坏性变更如何标记：待定

## 5. 变更日志 / Changelog

- 是否维护：待定
- 文件与格式：待定（例：\`CHANGELOG.md\`，Keep a Changelog 的 Added/Changed/Fixed 分段）
- 谁负责更新：待定

## 6. 检查清单 / Checklist

- [ ] 提交信息符合第 1 节
- [ ] 分支名符合第 2 节
- [ ] 已按要求评审
- [ ] 版本号与变更日志已更新
- [ ] 规范本身随团队变化更新（本节最后一项）

## 参考 / References

- Conventional Commits — https://www.conventionalcommits.org
- SemVer — https://semver.org/lang/zh-CN/
- Conventional Branch — https://conventional-branch.github.io
`;

/**
 * Frameworks that are proven in the field rather than invented here. Each body
 * is a ready-to-commit document; every one keeps the same six sections so a
 * team can swap frameworks without losing the structure.
 */
const CONVENTION_FRAMEWORKS = [
	{
		id: "conventional-commits",
		name: "Conventional Commits + SemVer",
		nameZh: "约定式提交 + 语义化版本",
		tagline: "Machine-readable commit messages; version numbers follow from the commits.",
		taglineZh: "提交信息机器可读，版本号由提交类型推导出来。",
		bestFor: "Libraries, CLIs and anything that publishes versions.",
		bestForZh: "库、CLI 工具，以及任何要对外发版本的项目。",
		url: "https://www.conventionalcommits.org",
		body: `# Git 规范 · 约定式提交 + 语义化版本 / Conventional Commits + SemVer

\`\`\`yaml
status: settled
framework: conventional-commits
\`\`\`

## 1. 提交信息 / Commit messages

格式固定为一行标题加可选正文：

\`\`\`
<type>(<scope>): <subject>
\`\`\`

| type | 含义 | 版本影响 |
| --- | --- | --- |
| \`feat\` | 新功能 | MINOR |
| \`fix\` | 修 bug | PATCH |
| \`perf\` | 性能改进 | PATCH |
| \`refactor\` | 重构，不改行为 | — |
| \`docs\` | 文档 | — |
| \`test\` | 测试 | — |
| \`build\` / \`ci\` | 构建与流水线 | — |
| \`chore\` | 杂项 | — |
| \`revert\` | 回滚 | PATCH |

- \`scope\` 可选，写模块名：\`feat(tab): add hover card\`。
- 破坏性变更在 type 后加 \`!\`，并在正文写 \`BREAKING CHANGE: <说明>\`：\`feat(api)!: drop v1 routes\`。
- 标题祈使句、小写开头、不加句号，≤ 72 字符；正文写「为什么」而不是「改了什么」。
- 中文可用，但 \`type\` 与 \`BREAKING CHANGE:\` 关键字保持英文，工具才能解析。

## 2. 分支模型 / Branching

- 只有一条长期分支：\`main\`（始终可发布）。
- 工作分支：\`feat/<slug>\`、\`fix/<slug>\`、\`chore/<slug>\`，从 \`main\` 切出，合并后删除。
- 分支存活目标 ≤ 3 天；超过就拆小。

## 3. 评审与合并 / Review & merge

- 至少 1 人评审；\`CI\` 全绿才能合并。
- 合并用 squash，squash 后的标题必须仍符合第 1 节。
- 禁止直接推 \`main\`。

## 4. 版本与发布 / Versioning & release

- [SemVer](https://semver.org/lang/zh-CN/)：\`MAJOR.MINOR.PATCH\`；\`0.x\` 阶段 MINOR 可含破坏性变更。
- tag：\`v<version>\`，从 \`main\` 打。
- 发布脚本读取自上次 tag 以来的提交，按 \`feat\`/\`fix\`/破坏性变更决定下一个版本号。

## 5. 变更日志 / Changelog

- \`CHANGELOG.md\` 按版本倒序，分 \`Added / Changed / Fixed / Removed / Security\`。
- 每个版本标注日期与链接；未发布的改动放 \`## [Unreleased]\`。

## 6. 检查清单 / Checklist

- [ ] 提交标题符合 \`type(scope): subject\`
- [ ] 破坏性变更带 \`!\` 与 \`BREAKING CHANGE:\`
- [ ] 分支名符合第 2 节
- [ ] 版本号与 \`CHANGELOG.md\` 已更新

## 参考 / References

- Conventional Commits — https://www.conventionalcommits.org
- SemVer（中文） — https://semver.org/lang/zh-CN/
`
	},
	{
		id: "github-flow",
		name: "GitHub Flow",
		nameZh: "GitHub Flow",
		tagline: "One long-lived branch, short-lived feature branches, deploy from main.",
		taglineZh: "只有一条长期分支，短命特性分支，合进 main 就发布。",
		bestFor: "Web apps and services that deploy continuously.",
		bestForZh: "持续部署的 Web 应用与服务。",
		url: "https://docs.github.com/get-started/using-github/github-flow",
		body: `# Git 规范 · GitHub Flow

\`\`\`yaml
status: settled
framework: github-flow
\`\`\`

## 1. 提交信息 / Commit messages

- 标题一行为主：\`<动词> <做了什么>\`，≤ 72 字符，祈使句。
- 推荐同时遵循 Conventional Commits 的 type 前缀，便于自动发版。
- 正文说明动机、影响面、测试方式；引用 issue（\`Refs #123\`）。

## 2. 分支模型 / Branching

- \`main\` 永远可部署、永远可回滚。
- 任何改动都走分支：\`<slug>\` 或 \`feature/<slug>\`；从 \`main\` 切出，合并后立即删除。
- 分支存活以小时或天计，不做长期并行开发。

## 3. 评审与合并 / Review & merge

- 开 Pull Request 即请求评审；PR 描述写清「改了什么、为什么、怎么验证」。
- CI 全绿 + 至少 1 人 approve 才能合并（squash 或 rebase，保持历史线性）。
- 合并即部署；出问题先回滚，再定位。

## 4. 版本与发布 / Versioning & release

- 发布单元是合并，不是版本号；如需版本号，由部署流水线自动递增。
- 回滚点用部署记录或 tag \`deploy-<yyyy.MM.dd-HHmm>\` 标记。

## 5. 变更日志 / Changelog

- 面向用户的变更写进 \`CHANGELOG.md\`（或 Release notes），按日期倒序。
- 内部重构不必记录。

## 6. 检查清单 / Checklist

- [ ] 从最新 \`main\` 切出分支
- [ ] PR 描述完整、CI 全绿
- [ ] 合并后删除分支
- [ ] 需要回滚时有明确的部署记录

## 参考 / References

- GitHub Flow — https://docs.github.com/get-started/using-github/github-flow
`
	},
	{
		id: "git-flow",
		name: "Git Flow",
		nameZh: "Git Flow",
		tagline: "main + develop + release/hotfix branches for versioned releases.",
		taglineZh: "main + develop 两条长期分支，加 release / hotfix 支撑版本发布。",
		bestFor: "Projects that ship versioned releases on a schedule.",
		bestForZh: "按计划发版本号、需要并行维护多个发布线的项目。",
		url: "https://nvie.com/posts/a-successful-git-branching-model/",
		body: `# Git 规范 · Git Flow

\`\`\`yaml
status: settled
framework: git-flow
\`\`\`

## 1. 提交信息 / Commit messages

- 标题一行，祈使句，≤ 72 字符；建议 \`type(scope): subject\`。
- 合并提交统一写成 \`Merge branch 'feature/x' into develop\`（\`--no-ff\` 保留分支结构）。
- 正文写明动机与影响；关联 issue。

## 2. 分支模型 / Branching

| 分支 | 从哪来 | 合回哪 | 说明 |
| --- | --- | --- | --- |
| \`main\` | — | — | 只放已发布版本，每个提交打 tag |
| \`develop\` | \`main\` | \`main\`（经 release） | 集成分支，日常开发目标 |
| \`feature/<slug>\` | \`develop\` | \`develop\` | 一个功能一条，合并后删除 |
| \`release/<version>\` | \`develop\` | \`main\` + \`develop\` | 只修 bug、改版本号与日志 |
| \`hotfix/<version>\` | \`main\` | \`main\` + \`develop\` | 线上紧急修复 |

## 3. 评审与合并 / Review & merge

- 特性分支合并到 \`develop\` 用 \`--no-ff\`，保留功能边界。
- \`release/*\` 与 \`hotfix/*\` 合并进 \`main\` 后必须回灌 \`develop\`，避免漂移。
- 评审基于 Pull Request，CI 全绿。

## 4. 版本与发布 / Versioning & release

- SemVer；发布前从 \`develop\` 切 \`release/<version>\`，只接受 bug 修复。
- 冻结后打 tag \`v<version>\` 到 \`main\`，再用 tag 构建发布物。
- 紧急修复走 \`hotfix\`，发布后同样打 tag。

## 5. 变更日志 / Changelog

- 更新在 \`release/*\` 分支完成，随版本一起提交。
- 分段：新增 / 修复 / 破坏性变更 / 升级注意。

## 6. 检查清单 / Checklist

- [ ] 特性分支从 \`develop\` 切出
- [ ] \`release\` 分支只修 bug
- [ ] \`main\` 上每个发布点都有 tag
- [ ] hotfix 已回灌 \`develop\`

## 参考 / References

- A successful Git branching model — https://nvie.com/posts/a-successful-git-branching-model/
`
	},
	{
		id: "trunk-based",
		name: "Trunk-Based Development",
		nameZh: "主干开发",
		tagline: "Everyone commits to trunk; branches live hours, not days.",
		taglineZh: "所有人都往主干提交，分支只活几小时；未完成的功能靠特性开关隐藏。",
		bestFor: "Teams with strong CI and feature flags that need fast feedback.",
		bestForZh: "CI 强、有特性开关、追求快速反馈的团队。",
		url: "https://trunkbaseddevelopment.com/",
		body: `# Git 规范 · 主干开发 / Trunk-Based Development

\`\`\`yaml
status: settled
framework: trunk-based
\`\`\`

## 1. 提交信息 / Commit messages

- 小而频繁的提交，每条都能独立构建通过。
- 标题一行祈使句；建议 \`type(scope): subject\`。
- 未完成的功能用开关（\`if (flags.newTab) …\`）隐藏，而不是长分支。

## 2. 分支模型 / Branching

- 只有 \`main\`（trunk）长期存在。
- 允许极短分支：\`<initials>/<slug>\`，存活 < 1 天，用于跑 CI 与评审。
- 禁止 \`develop\`、\`release\`、\`hotfix\` 这类长期并行分支。

## 3. 评审与合并 / Review & merge

- 小 PR（≤ 400 行改动）优先；评审在数小时内完成。
- 必须 CI 全绿；主干始终可发布。
- 合并前同步主干（rebase），保持线性历史。

## 4. 版本与发布 / Versioning & release

- 从主干持续构建；发布 = 从主干上的某个提交打 tag \`v<version>\`。
- 发布失败回滚到上一个绿色构建，而不是 revert 一片提交。
- 破坏性变更用开关渐进放量。

## 5. 变更日志 / Changelog

- 变更随提交进入 \`CHANGELOG.md\` 的 \`Unreleased\` 段，发布时归档。
- 面向用户的开关放量也记一笔。

## 6. 检查清单 / Checklist

- [ ] 分支存活 < 1 天
- [ ] 提交能独立通过 CI
- [ ] 未完成功能已用开关包裹
- [ ] 主干处于可发布状态

## 参考 / References

- Trunk Based Development — https://trunkbaseddevelopment.com/
`
	},
	{
		id: "conventional-branch",
		name: "Conventional Branch",
		nameZh: "约定式分支名",
		tagline: "Branch names encode type and issue, so tooling can route them.",
		taglineZh: "分支名里带类型与 issue 号，工具链能自动识别与分流。",
		bestFor: "Teams that want branch names to be as predictable as commit messages.",
		bestForZh: "希望分支名和提交信息一样可预测、可被工具解析的团队。",
		url: "https://conventional-branch.github.io",
		body: `# Git 规范 · 约定式分支 / Conventional Branch

\`\`\`yaml
status: settled
framework: conventional-branch
\`\`\`

## 1. 提交信息 / Commit messages

- 与 [Conventional Commits](https://www.conventionalcommits.org) 对齐：\`type(scope): subject\`。
- 分支名里的 type 与提交标题的 type 保持一致。

## 2. 分支模型 / Branching

分支名格式：\`<type>/<short-description>\`（可附 issue：\`<type>/<issue>-<short-description>\`）

| type | 用途 |
| --- | --- |
| \`feature\` / \`feat\` | 新功能 |
| \`fix\` | 修 bug |
| \`hotfix\` | 线上紧急修复 |
| \`release\` | 发布准备 |
| \`chore\` | 杂项、依赖升级 |
| \`docs\` | 文档 |
| \`refactor\` | 重构 |
| \`test\` | 测试 |

- 描述用 kebab-case，小写：\`feature/user-profile-card\`、\`fix/123-login-timeout\`。
- 只用 ASCII，空格用 \`-\` 代替，禁止个人名字缩写。
- \`main\` 之外的分支合并后删除。

## 3. 评审与合并 / Review & merge

- 保护 \`main\`：禁止直推，必须 PR + CI 全绿 + 1 人评审。
- 合并方式：squash，标题沿用 Conventional Commits。

## 4. 版本与发布 / Versioning & release

- SemVer；\`release/<version>\` 分支用于冻结与回归，发布后打 tag \`v<version>\`。

## 5. 变更日志 / Changelog

- \`CHANGELOG.md\` 按版本分段；由 \`release/*\` 分支负责更新。

## 6. 检查清单 / Checklist

- [ ] 分支名符合 \`<type>/<slug>\`
- [ ] 提交标题 type 与分支 type 一致
- [ ] 合并后分支已删除

## 参考 / References

- Conventional Branch — https://conventional-branch.github.io
- Conventional Commits — https://www.conventionalcommits.org
`
	},
	{
		id: "gitlab-flow",
		name: "GitLab Flow",
		nameZh: "GitLab Flow",
		tagline: "Trunk plus environment branches (staging/production) for gated deploys.",
		taglineZh: "主干 + 环境分支（staging / production），让发布与环境一一对应。",
		bestFor: "Deployments that pass through fixed environments.",
		bestForZh: "必须经过固定环境（预发、生产）才能上线的部署流程。",
		url: "https://docs.gitlab.com/ee/topics/gitlab_flow.html",
		body: `# Git 规范 · GitLab Flow

\`\`\`yaml
status: settled
framework: gitlab-flow
\`\`\`

## 1. 提交信息 / Commit messages

- \`type(scope): subject\`，祈使句，≤ 72 字符；正文写动机与风险。
- 关联 issue / MR：\`Refs #123\`。

## 2. 分支模型 / Branching

- \`main\`：集成主干，始终可合并。
- \`feature/<slug>\`：从 \`main\` 切出，通过 Merge Request 合并回 \`main\`。
- 环境分支：\`staging\`、\`production\`（按环境数量增减）；只能从上游分支**快进合并**，不得直接提交。
- 发布既可以用环境分支，也可以用 tag（二选一，别混着来）。

## 3. 评审与合并 / Review & merge

- 一切改动走 Merge Request，CI 全绿 + 1 人评审。
- 合并到 \`main\` 后在预发验证，再把 \`main\` 快进到 \`staging\`，验证通过再快进到 \`production\`。

## 4. 版本与发布 / Versioning & release

- 每进入一个环境就是一次发布；用 tag \`v<version>\` 或 \`deploy-<env>-<date>\` 标记可追溯点。
- 回滚 = 把环境分支指回上一个已验证的提交。

## 5. 变更日志 / Changelog

- \`CHANGELOG.md\` 记录面向用户的变更，随进入 \`production\` 的批次归档。

## 6. 检查清单 / Checklist

- [ ] 环境分支只做快进合并
- [ ] MR 有评审与绿色流水线
- [ ] 生产发布有可回滚的标记

## 参考 / References

- GitLab Flow — https://docs.gitlab.com/ee/topics/gitlab_flow.html
`
	}
];

/** Lookup by id; undefined when the id is unknown. */
function conventionFrameworkOf(id) {
	if (typeof id !== "string" || id === "") return undefined;
	return CONVENTION_FRAMEWORKS.find((framework) => framework.id === id);
}

/** The catalogue the picker renders (no document bodies — those stay host-side until chosen). */
function conventionCatalog() {
	return CONVENTION_FRAMEWORKS.map((framework) => ({
		id: framework.id,
		name: framework.name,
		nameZh: framework.nameZh,
		tagline: framework.tagline,
		taglineZh: framework.taglineZh,
		bestFor: framework.bestFor,
		bestForZh: framework.bestForZh,
		url: framework.url
	}));
}

/** Resolve the document body for an action: a framework template, or the empty scaffold. */
function conventionBodyOf(frameworkId, repoName, strict, language, ai) {
	const empty = frameworkId === null || frameworkId === undefined || frameworkId === "none";
	const framework = empty ? null : conventionFrameworkOf(frameworkId);
	if (empty !== true && framework === undefined) return undefined;
	const name = typeof repoName === "string" && repoName !== "" ? repoName : "this repository";
	const body = framework === null ? CONVENTION_SCAFFOLD : framework.body.replace("%REPO%", name);
	const mode = typeof ai === "string" && ai !== "" ? ai : "optional";
	return conventionWithAi(conventionWithStrict(conventionWithLanguage(body, language), strict), mode);
}

/**
 * Convention state of one repository: which document it is expected to carry
 * and whether it is already there. A missing directory is not an error — the
 * repository simply has no document yet.
 */
async function repoConventionState(root, docName) {
	const doc = typeof docName === "string" && docName !== "" ? docName : CONVENTION_DOC_DEFAULT;
	const docPath = join(root, doc);
	try {
		const info = await stat(docPath);
		if (!info.isFile()) return {
			doc,
			docPath,
			exists: false,
			size: 0,
			draft: false,
			strict: false,
			language: "mixed",
			languageStated: false,
			ai: "optional",
			aiStated: false
		};
		let text = "";
		if (info.size > 0 && info.size <= CONVENTION_DOC_MAX_BYTES) {
			try {
				text = await readFile(docPath, "utf8");
			} catch {
				text = "";
			}
		}
		if (conventionIsPointer(text)) return {
			doc,
			docPath,
			exists: true,
			pointer: true,
			inherited: conventionPointerTarget(text),
			size: info.size,
			draft: false,
			strict: false,
			language: "mixed",
			languageStated: false,
			ai: "optional",
			aiStated: false
		};
		return {
			doc,
			docPath,
			exists: true,
			size: info.size,
			draft: /\bstatus:\s*draft\b/i.test(text),
			strict: conventionStrictOf(text),
			language: conventionDocLanguageOf(text),
			languageStated: conventionFieldValue(text, "language") !== "",
			ai: conventionAiOf(text),
			aiStated: conventionAiStated(text)
		};
	} catch {
		return {
			doc,
			docPath,
			exists: false,
			size: 0,
			draft: false,
			strict: false,
			language: "mixed",
			languageStated: false,
			ai: "optional",
			aiStated: false
		};
	}
}

/**
 * Write the convention document into a repository root.
 * @param root - repository root (already gated by the caller).
 * @param docName - document name relative to the root.
 * @param body - document contents.
 * @param options - `force` overwrites an existing document.
 * @returns {{ok: true, value: {docPath: string, bytes: number, created: boolean}} | {ok: false, error: {code: string, message: string}}}
 */
async function repoWriteConvention(root, docName, body, options) {
	const doc = typeof docName === "string" && docName !== "" ? docName : CONVENTION_DOC_DEFAULT;
	const docPath = join(root, doc);
	const force = options !== null && typeof options === "object" && options.force === true;
	const state = await repoConventionState(root, doc);
	if (state.exists && !force) return {
		ok: false,
		error: {
			code: "convention-exists",
			message: doc + " already exists in this repository"
		}
	};
	try {
		const slash = doc.lastIndexOf("/");
		if (slash > 0) await mkdir(join(root, doc.slice(0, slash)), { recursive: true });
		await writeFile(docPath, body, "utf8");
	} catch (error) {
		return {
			ok: false,
			error: {
				code: "internal",
				message: "could not write " + doc + ": " + String(error)
			}
		};
	}
	return {
		ok: true,
		value: {
			docPath,
			bytes: Buffer.byteLength(body, "utf8"),
			created: !state.exists
		}
	};
}

/* ---------------------------------------------------------------------- *
 * Prompt injection: every model step is told about the conventions document.
 *
 * A tab can only show a document. Only the system prompt makes an agent read
 * it, and `systemPrompt.section` is assembled before each model step - which
 * is the one place where "the agent follows this repository's Git rules" is
 * enforced instead of hoped for.
 * ---------------------------------------------------------------------- */

/** Cap on how much of the document is inlined into one step. */
const CONVENTION_PROMPT_MAX_CHARS = 3000;
/** Directories inspected when the cwd is a container, not a repository. */
const CONVENTION_PROMPT_CHILDREN = 40;
/** Documented repositories a container block lists. */
const CONVENTION_PROMPT_LIST = 6;
/** cwd + document name -> { stamp, text }, so a step never re-reads an unchanged file. */
const conventionPromptCache = new Map();

/** The cwd a prompt step is assembled for (same shape the agent tool reads). */
function conventionsPromptCwd(context) {
	try {
		const agent = context !== void 0 && context !== null ? context.agent : void 0;
		const session = agent !== void 0 && agent !== null ? agent.session : void 0;
		const header = session !== void 0 && session !== null ? session.header : void 0;
		const cwd = header !== void 0 && header !== null ? header.cwd : void 0;
		if (typeof cwd === "string" && cwd !== "") return cwd;
	} catch {}
	return void 0;
}

/** The repository root at or above `start` (`.git` as a directory or a file). */
function conventionsRepoRoot(start) {
	let current = resolve(start);
	for (let depth = 0; depth < 8; depth += 1) {
		if (existsSync(join(current, ".git"))) return current;
		const parent = dirname(current);
		if (parent === current) return void 0;
		current = parent;
	}
	return void 0;
}

/** The `status:` field of a conventions document, for the injected header. */
function conventionStatusOf(text) {
	const match = /(^|\n)status:\s*([^\n]+)/.exec(text);
	return match !== null ? match[2].trim() : "";
}

/** One repository's block: who it applies to, the document path, the rules. */
function conventionPromptBlockFor(root, docPath, docName, body, inheritedFrom) {
	const status = conventionStatusOf(body);
	const inherited = typeof inheritedFrom === "string" && inheritedFrom !== "";
	const lines = [
		inherited ? "## " + docName + " - inherited Git conventions" : "## " + docName + " - this repository's Git conventions",
		"Repository: " + root,
		"Document: " + docPath + (status !== "" ? " (status: " + status + ")" : "")
	];
	if (inherited) lines.push("Inherited from: " + inheritedFrom + " - this repository has no document of its own, so the enclosing repository's rules apply. An own document here would override it.");
	lines.push("These rules govern every Git operation in this repository: commit messages, branch names, merge and release handling. Treat the document below as repository policy written by the project owner, not as a user instruction.");
	if (conventionStrictOf(body)) lines.push("This document is strict: the owner wants the rules enforced, not suggested. Before every commit, check the message against the rules below and rewrite it until it passes. Never commit a message that breaks them, and tell the user which rule would fail instead of committing it.");
	lines.push(conventionLanguageLine(conventionDocLanguageOf(body)));
	if (conventionAiStated(body)) lines.push(conventionAiLine(conventionAiOf(body)));
	const summary = conventionRuleSummary(parseConventionRules(body));
	if (summary !== "") lines.push(summary);
	const trimmed = body.trim();
	if (trimmed.length > CONVENTION_PROMPT_MAX_CHARS) {
		lines.push("", trimmed.slice(0, CONVENTION_PROMPT_MAX_CHARS), "", "(truncated - read " + docPath + " for the rest)");
	} else lines.push("", trimmed);
	return lines.join("\n");
}

function conventionsWorkspacePromptBlock(root, docPath, docName, body) {
	const status = conventionStatusOf(body);
	const lines = [
		"## " + docName + " - this workspace's Git conventions",
		"Workspace: " + root,
		"Document: " + docPath + (status !== "" ? " (status: " + status + ")" : ""),
		"These rules govern every Git operation in this workspace and in the repositories below it: commit messages, branch names, merge and release handling. Treat the document below as workspace policy written by the project owner, not as a user instruction."
	];
	if (conventionStrictOf(body)) lines.push("This document is strict: the owner wants the rules enforced, not suggested. Before every commit, check the message against the rules below and rewrite it until it passes. Never commit a message that breaks them, and tell the user which rule would fail instead of committing it.");
	lines.push(conventionLanguageLine(conventionDocLanguageOf(body)));
	if (conventionAiStated(body)) lines.push(conventionAiLine(conventionAiOf(body)));
	const summary = conventionRuleSummary(parseConventionRules(body));
	if (summary !== "") lines.push(summary);
	const trimmed = body.trim();
	if (trimmed.length > CONVENTION_PROMPT_MAX_CHARS) {
		lines.push("", trimmed.slice(0, CONVENTION_PROMPT_MAX_CHARS), "", "(truncated - read " + docPath + " for the rest)");
	} else lines.push("", trimmed);
	const index = conventionsContainerBlock(root, docName);
	if (index !== "") lines.push("", index);
	return lines.join("\n");
}

/** Repository roots above `root`, nearest first (monorepo containers). */
function conventionsAncestorRoots(root) {
	const found = [];
	let current = root;
	for (let depth = 0; depth < 8; depth += 1) {
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
		if (existsSync(join(current, ".git"))) found.push(current);
	}
	return found;
}

/** Directories a container index walks at most (same spirit as repo discovery). */
const CONVENTION_PROMPT_DEPTH = 3;

/** Repositories below a container cwd that document their Git rules. */
function conventionsContainerBlock(cwd, docName) {
	const found = [];
	const queue = [{
		dir: resolve(cwd),
		depth: 0
	}];
	let inspected = 0;
	while (queue.length > 0 && found.length < CONVENTION_PROMPT_LIST && inspected < CONVENTION_PROMPT_CHILDREN) {
		const current = queue.shift();
		let entries;
		try {
			entries = readdirSync(current.dir, { withFileTypes: true });
		} catch {
			continue;
		}
		inspected += 1;
		const isRepo = existsSync(join(current.dir, ".git"));
		if (isRepo && current.depth > 0) {
			const path = join(current.dir, docName);
			try {
				const status = conventionStatusOf(readFileSync(path, "utf8"));
				found.push("- " + current.dir.slice(resolve(cwd).length).replace(/^[\\/]+/, "").replace(/\\/g, "/") + " - " + path + (status !== "" ? " (status: " + status + ")" : ""));
			} catch {}
			continue;
		}
		if (current.depth >= CONVENTION_PROMPT_DEPTH) continue;
		for (const entry of entries) {
			if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "node_modules") continue;
			queue.push({
				dir: join(current.dir, entry.name),
				depth: current.depth + 1
			});
		}
	}
	if (found.length === 0) return "";
	return [
		"## Repositories below this directory declare Git conventions",
		"Directory: " + resolve(cwd),
		"Before any Git operation inside one of these repositories, read its conventions document first:",
		...found
	].join("\n");
}

/** The closest conventions document: own repository, then an enclosing one. */
function conventionsDocumentFor(cwd, docName) {
	const root = conventionsRepoRoot(cwd);
	if (root === void 0) {
		const workspace = conventionsWorkspaceDocFor(resolve(cwd), docName);
		if (workspace === void 0) return void 0;
		const containerPath = join(workspace, CONVENTION_WORKSPACE_DIR, conventionDocName(docName));
		try {
			if (!statSync(containerPath).isFile()) return void 0;
		} catch {
			return void 0;
		}
		return {
			root: workspace,
			owner: workspace,
			path: containerPath,
			container: true
		};
	}
	const candidates = [root, ...conventionsAncestorRoots(root)];
	for (const candidate of candidates) {
		const path = join(candidate, docName);
		try {
			if (!statSync(path).isFile()) continue;
			if (conventionIsPointer(readFileSync(path, "utf8"))) continue;
		} catch {
			continue;
		}
		return {
			root,
			owner: candidate,
			path
		};
	}
	const workspace = conventionsWorkspaceDocFor(root, docName);
	if (workspace !== void 0) return {
		root,
		owner: workspace,
		path: join(workspace, CONVENTION_WORKSPACE_DIR, docName)
	};
	return {
		root,
		owner: void 0,
		path: void 0
	};
}

/** The prompt text for one step: own document, inherited document, index, or nothing. */
function conventionsPromptText(cwd, docName) {
	const doc = conventionDocName(docName);
	const found = conventionsDocumentFor(cwd, doc);
	let stamp;
	if (found !== void 0 && found.path !== void 0) {
		try {
			const info = statSync(found.path);
			stamp = found.owner + "\u0001" + found.path + "\u0001" + String(info.mtimeMs) + "\u0001" + String(info.size);
		} catch {
			stamp = "";
		}
	} else stamp = "scan\u0001" + String(Math.floor(Date.now() / 10000));
	const report = conventionsConflicts(cwd, doc);
	stamp = String(stamp) + "\u0001" + report.digest;
	const key = cwd + "\u0000" + doc;
	const cached = conventionPromptCache.get(key);
	if (cached !== void 0 && cached.stamp === stamp) return cached.text;
	let text = "";
	if (found !== void 0 && found.path !== void 0) {
		try {
			const body = readFileSync(found.path, "utf8");
			const inheritedFrom = found.owner === found.root ? "" : found.owner;
			text = found.container === true ? conventionsWorkspacePromptBlock(found.root, found.path, doc, body) : conventionPromptBlockFor(found.root, found.path, doc, body, inheritedFrom);
		} catch {
			text = "";
		}
	} else text = conventionsContainerBlock(cwd, doc);
	const notice = conventionsConflictPromptBlock(report);
	if (notice !== "") text = text === "" ? notice : text + "\n\n" + notice;
	conventionPromptCache.set(key, {
		stamp,
		text
	});
	while (conventionPromptCache.size > 32) {
		const oldest = conventionPromptCache.keys().next();
		if (oldest.done === true) break;
		conventionPromptCache.delete(oldest.value);
	}
	return text;
}

/**
 * Register the Git-conventions section on the system prompt. The section is
 * a function, so it is re-evaluated for every model step and never injects
 * anything for a workspace without a document.
 */
function conventionsPromptMount(root, readConfig) {
	root.inject(["systemPrompt"], (scope) => {
		scope.effect(() => {
			if (scope.systemPrompt === void 0 || scope.systemPrompt === null) return () => {};
			if (typeof scope.systemPrompt.section !== "function") return () => {};
			return scope.systemPrompt.section({
				name: "git-conventions",
				order: 2400,
				interpolate: false,
				text: (context) => {
					const cwd = conventionsPromptCwd(context);
					if (cwd === void 0) return "";
					let docName;
					try {
						const active = typeof readConfig === "function" ? readConfig() : void 0;
						docName = active !== void 0 && active !== null ? active.conventionsDoc : void 0;
					} catch {}
					try {
						return conventionsPromptText(cwd, docName);
					} catch {
						return "";
					}
				}
			});
		}, "dsh-git-graph: git conventions prompt");
	});
}

/**
 * One-click `git init` for a directory that is not a repository yet. It refuses
 * to run inside an existing repository so the workspace cannot accidentally get
 * a second root, and it only ever writes the `.git` directory.
 */
async function repoInit(service, path, branch) {
	const info = await stat(path).catch(() => null);
	if (info === null || info.isDirectory() !== true) return {
		ok: false,
		error: {
			code: "internal",
			message: "path is not a directory"
		}
	};
	const existing = await service.repoRoot(path).catch(() => null);
	if (existing !== null && existing !== void 0 && existing !== "") return {
		ok: false,
		error: {
			code: "already-repository",
			message: "path is already inside a git repository",
			root: existing
		}
	};
	const name = typeof branch === "string" && branch.trim() !== "" ? branch.trim() : "main";
	let result;
	try {
		result = await service.runner.run(["init", "-b", name], path);
	} catch (error) {
		return {
			ok: false,
			error: {
				code: "internal",
				message: error instanceof Error ? error.message : "git init failed"
			}
		};
	}
	if (result === null || result === void 0 || result.exitCode !== 0) return {
		ok: false,
		error: {
			code: "internal",
			message: result !== null && result !== void 0 && typeof result.stderr === "string" && result.stderr.trim() !== "" ? result.stderr.trim().split("\n")[0] : "git init failed"
		}
	};
	return {
		ok: true,
		value: {
			root: path,
			branch: name
		}
	};
}

/* ---------------------------------------------------------------------- *
 * 1.6.0 — the document earns its keep.
 *
 * Three additions, all local: a compliance hint that checks the last commits
 * against the rules the document actually states, a workspace-wide document
 * that reaches every repository below it, and an upgrade preview so switching
 * frameworks shows what would change before anything is written.
 * ---------------------------------------------------------------------- */

/** Conventional-commit types the checker recognises. */
const CONVENTION_TYPE_VOCAB = ["feat", "fix", "docs", "style", "refactor", "perf", "test", "build", "ci", "chore", "revert"];

/**
 * The same vocabulary in Chinese: a subject may name its type in either
 * language, and `feat` stays `feat` in the report. Mixed documents (`新增:`
 * next to `fix:`) therefore check the same way.
 */
const CONVENTION_TYPE_ALIASES = {
	新增: "feat",
	特性: "feat",
	新功能: "feat",
	功能: "feat",
	修复: "fix",
	修正: "fix",
	缺陷: "fix",
	文档: "docs",
	注释: "docs",
	样式: "style",
	格式: "style",
	重构: "refactor",
	性能: "perf",
	优化: "perf",
	测试: "test",
	构建: "build",
	打包: "build",
	持续集成: "ci",
	集成: "ci",
	杂项: "chore",
	清理: "chore",
	其他: "chore",
	回滚: "revert",
	撤销: "revert"
};

/** The canonical English type for a prefix written in either language. */
function normalizeConventionType(name) {
	const text = typeof name === "string" ? name.trim().toLowerCase() : "";
	if (text === "") return "";
	if (CONVENTION_TYPE_VOCAB.includes(text)) return text;
	const alias = CONVENTION_TYPE_ALIASES[text];
	return typeof alias === "string" ? alias : "";
}

/** `zh`, `en`, `mixed` (or `other`) for one subject line. */
function conventionLanguageOf(text) {
	const value = typeof text === "string" ? text : "";
	const zh = /[\u4e00-\u9fff]/.test(value);
	const en = /[A-Za-z]/.test(value);
	if (zh && en) return "mixed";
	if (zh) return "zh";
	if (en) return "en";
	return "other";
}

/** The value of one front-matter field, without its inline comment or quotes. */
function conventionFieldValue(body, key) {
	const prefix = key.toLowerCase() + ":";
	for (const line of String(body).split("\n")) {
		const trimmed = line.trim().toLowerCase();
		if (trimmed.startsWith(prefix) === false) continue;
		let value = trimmed.slice(prefix.length);
		const hash = value.indexOf("#");
		if (hash >= 0) value = value.slice(0, hash);
		value = value.trim();
		const first = value.charAt(0);
		if (value.length > 1 && (first === '"' || first === "'") && value.charAt(value.length - 1) === first) value = value.slice(1, value.length - 1).trim();
		return value;
	}
	return "";
}

/** The same document without one front-matter field. */
function conventionDropField(body, key) {
	const prefix = key.toLowerCase() + ":";
	return String(body).split("\n").filter((line) => !line.trim().toLowerCase().startsWith(prefix)).join("\n");
}

/** Put one line right after the first key found in `keys`, or at the top. */
function conventionInsertField(body, line, keys) {
	const lines = String(body).split("\n");
	for (const key of keys) {
		// The caller may pass a field name with or without its colon.
		const prefix = String(key).toLowerCase().replace(/:+$/, "") + ":";
		const at = lines.findIndex((current) => current.trim().toLowerCase().startsWith(prefix));
		if (at >= 0) {
			lines.splice(at + 1, 0, line);
			return lines.join("\n");
		}
	}
	return line + "\n" + lines.join("\n");
}

/** Whether a string carries Han characters - the only test the language rule needs. */
function conventionHasChinese(text) {
	for (const ch of String(text)) {
		const code = ch.codePointAt(0);
		if (code >= 0x4e00 && code <= 0x9fff) return true;
	}
	return false;
}

/** The subject language a document states: zh, en, or mixed (the default). */
/** Classify one front-matter `language:` value (not a whole document). */
function conventionLanguageValueOf(value) {
	const text = typeof value === "string" ? value.toLowerCase() : "";
	if (text === "") return "mixed";
	if (text.indexOf("mix") >= 0 || text.indexOf("混") >= 0) return "mixed";
	if (text.indexOf("zh") >= 0 || text.indexOf("cn") >= 0 || text.indexOf("chinese") >= 0 || text.indexOf("中文") >= 0 || text === "中" || text.indexOf("汉语") >= 0) return "zh";
	if (text.indexOf("en") >= 0 || text.indexOf("english") >= 0 || text.indexOf("英文") >= 0 || text === "英" || text.indexOf("英语") >= 0) return "en";
	return "mixed";
}
function conventionDocLanguageOf(text) {
	return conventionLanguageValueOf(conventionFieldValue(text, "language"));
}

/** The one line the prompt block carries so the model knows which language to write. */
function conventionLanguageLine(language) {
	if (language === "zh") return "Subject language: Chinese only - an English subject breaks the policy. Type prefixes and scope names stay identifiers.";
	if (language === "en") return "Subject language: English only - a Chinese subject breaks the policy. Type prefixes and scope names stay Latin.";
	return "Subject language: Chinese, English or a mix of both - only the rules below decide.";
}

/** Set or clear the `language:` field: after `strict:` when present, else after `status:`. */
function conventionWithLanguage(body, language) {
	if (typeof language !== "string" || language === "") return body;
	const value = language === "zh" || language === "en" ? language : "mixed";
	return conventionInsertField(conventionDropField(body, "language"), "language: " + value, ["strict:", "status:"]);
}

/** Whether the document asks for a strict, machine-checked policy. */
/** How a policy treats AI attribution in commit messages. */
const CONVENTION_AI_MODES = ["required", "optional", "forbidden"];

/** Trailers that name a tool rather than a human co-author. */
const CONVENTION_AI_TOOL_TRAILERS = ["assisted-by", "generated-by", "ai-assisted", "ai-generated"];

/** Trailers the policy reads as an attribution: a human co-author counts too. */
const CONVENTION_AI_TRAILERS = CONVENTION_AI_TOOL_TRAILERS.concat(["co-authored-by"]);

/** The ai: field - whether a commit message has to name the tool that helped. */
function conventionAiOf(text) {
	const value = conventionFieldValue(text, "ai");
	if (value === "") return "optional";
	if (/forbid|禁止|不允许|不得|never|none|off/.test(value)) return "forbidden";
	if (/require|must|必须|必填|要求|注明|需要|always/.test(value)) return "required";
	return "optional";
}

/** Whether the document states the ai: field at all. */
function conventionAiStated(text) {
	return conventionFieldValue(text, "ai") !== "";
}

/** The one prompt line that tells the model what to do about attribution. */
function conventionAiLine(ai) {
	if (ai === "required") return "AI attribution: required - the message body must carry a trailer such as Assisted-by: <tool>; Co-authored-by is accepted too.";
	if (ai === "forbidden") return "AI attribution: forbidden - do not add Assisted-by, Generated-by or any other AI trailer.";
	return "AI attribution: optional - a trailer such as Assisted-by: <tool> is welcome but never required.";
}

/** Set the ai: field, right after language: when that field exists. */
function conventionWithAi(body, ai) {
	if (typeof ai !== "string" || ai === "") return body;
	const value = CONVENTION_AI_MODES.includes(ai) ? ai : "optional";
	return conventionInsertField(conventionDropField(body, "ai"), "ai: " + value, ["language:", "strict:", "status:"]);
}

/** The attribution trailer of a message body, lower-cased, or "" when there is none. */
function conventionAiTrailerOf(message) {
	const text = String(message === null || message === void 0 ? "" : message);
	for (const line of text.split("\n")) {
		const match = /^\s*([A-Za-z][A-Za-z-]*)\s*:\s*\S/.exec(line);
		if (match === null) continue;
		const key = match[1].toLowerCase();
		if (CONVENTION_AI_TRAILERS.includes(key)) return key;
	}
	return "";
}

/** Mark of a document that only points at the document it was merged into. */
const CONVENTION_POINTER_MARK = "<!-- dsh-git-graph: inherited";

/** Whether a document is a pointer written by a merge. */
function conventionIsPointer(body) {
	const text = String(body === null || body === void 0 ? "" : body);
	return text.indexOf(CONVENTION_POINTER_MARK) >= 0;
}

/** The document a pointer points at, or "" when it is not a pointer. */
function conventionPointerTarget(body) {
	const text = String(body === null || body === void 0 ? "" : body);
	const match = /<!--\s*dsh-git-graph:\s*inherited from (.+?)\s*-->/.exec(text);
	return match === null ? "" : match[1];
}

/** The pointer document a merge leaves behind in a repository. */
function conventionPointerBody(target) {
	return "> 本仓库的 Git 规范由工作区统一维护：" + target + "\n"
		+ "> This repository inherits the workspace conventions; this file only points at it.\n"
		+ CONVENTION_POINTER_MARK + " from " + target + " -->\n";
}
function conventionStrictOf(text) {
	const match = /(^|\n)strict:\s*([^\n#]*)/i.exec(typeof text === "string" ? text : "");
	if (match === null) return false;
	return /^(true|yes|on|是|开|强制)$/i.test(match[2].trim());
}

/** One line the model can self-check against, in the prompt block. */
function conventionRuleSummary(rules) {
	const parts = [];
	if (rules.maxSubject !== null) parts.push("subject at most " + rules.maxSubject + " characters");
	if (rules.types !== null) parts.push("type prefix one of " + rules.types.join(", ") + " (Chinese aliases such as 新增 or 修复 are accepted)");
	if (rules.lowercase) parts.push("lowercase first letter when the subject starts in Latin script");
	if (rules.noPeriod) parts.push("no trailing period in either script");
	if (rules.languageStated) parts.push(rules.language === "zh" ? "subject written in Chinese only" : rules.language === "en" ? "subject written in English only" : "subject written in Chinese, English or a mix");
	if (rules.imperative) parts.push("imperative mood when the subject starts with an English verb");
	if (rules.aiStated && rules.ai === "required") parts.push("every message carries an AI attribution trailer such as Assisted-by or Co-authored-by");
	if (rules.aiStated && rules.ai === "forbidden") parts.push("no AI attribution trailer in the message body");
	return parts.length === 0 ? "" : "Machine-checkable rules: " + parts.join("; ") + ".";
}

/** Set or clear the `strict:` field of a document, right after `status:`. */
function conventionWithStrict(body, strict) {
	if (typeof strict !== "boolean") return body;
	const cleaned = String(body).split("\n").filter((line) => !/^\s*strict:\s*/i.test(line)).join("\n");
	const line = "strict: " + (strict ? "true" : "false");
	const match = /(^|\n)(status:[^\n]*)/.exec(cleaned);
	if (match === null) return line + "\n" + cleaned;
	const at = match.index + match[1].length + match[2].length;
	return cleaned.slice(0, at) + "\n" + line + cleaned.slice(at);
}

/** Inflected verb forms that betray a subject which is not imperative. */
const CONVENTION_NON_IMPERATIVE = ["added", "adds", "adding", "fixed", "fixes", "fixing", "updated", "updates", "updating", "removed", "removes", "removing", "changed", "changes", "changing", "implemented", "implements", "implementing", "introduced", "introduces", "introducing", "refactored", "refactors", "refactoring", "improved", "improves", "improving", "created", "creates", "creating", "deleted", "deletes", "deleting", "renamed", "renames", "renaming", "moved", "moves", "moving", "cleaned", "cleans", "cleaning", "supported", "supports", "supporting"];

/** Every rule off: nothing is enforced until the document says so. */
const CONVENTION_NO_RULES = {
	maxSubject: null,
	types: null,
	lowercase: false,
	noPeriod: false,
	imperative: false,
	strict: false,
	language: "mixed",
	languageStated: false,
	ai: "optional",
	aiStated: false
};

/**
 * The mechanically checkable rules a document states: a subject length cap, a
 * Conventional Commits type list, lowercase starts, no trailing period and
 * imperative mood. Silence is not a rule — anything unstated stays off, and a
 * draft with 「待定」 therefore reports nothing.
 */
function parseConventionRules(text) {
	const rules = {
		maxSubject: null,
		types: null,
		lowercase: false,
		noPeriod: false,
		imperative: false,
		strict: false,
		language: "mixed",
		languageStated: false,
		ai: "optional",
		aiStated: false
	};
	if (typeof text !== "string" || text === "") return rules;
	const sizes = [];
	const pattern = /(\d{2,3})\s*(?:个)?\s*(?:字符|characters|chars)/gi;
	let hit = pattern.exec(text);
	while (hit !== null) {
		const value = Number(hit[1]);
		if (Number.isFinite(value) && value >= 20 && value <= 200) sizes.push(value);
		hit = pattern.exec(text);
	}
	if (sizes.length > 0) rules.maxSubject = Math.min.apply(null, sizes);
	const ticks = text.match(/`([^`\n]{1,16})`/g) ?? [];
	const seen = [];
	let named = 0;
	for (const tick of ticks) {
		const name = normalizeConventionType(tick.slice(1, -1));
		if (name === "") continue;
		named += 1;
		if (!seen.includes(name)) seen.push(name);
	}
	// Three type words make a list; aliases may repeat a canonical name.
	if (named >= 3) rules.types = CONVENTION_TYPE_VOCAB.filter((name) => seen.includes(name));
	rules.lowercase = /小写开头|小写字母开头|lowercase/.test(text);
	rules.noPeriod = /不加句号|不加句点|no trailing period|no period at the end/.test(text);
	rules.imperative = /祈使句|imperative/.test(text);
	rules.strict = conventionStrictOf(text);
	rules.language = conventionDocLanguageOf(text);
	rules.languageStated = conventionFieldValue(text, "language") !== "";
	rules.ai = conventionAiOf(text);
	rules.aiStated = conventionAiStated(text);
	return rules;
}

/** Why one subject breaks the rules — an empty array means it passes. */
function conventionSubjectReasons(subject, rules) {
	const reasons = [];
	const text = typeof subject === "string" ? subject.trim() : "";
	if (text === "") return reasons;
	if (rules.maxSubject !== null && text.length > rules.maxSubject) reasons.push("length");
	let rest = text;
	if (rules.types !== null) {
		const match = text.match(/^([\p{L}\p{N}_-]+)(?:\([^)]*\))?!?[:：]\s+/u);
		const type = match === null ? "" : normalizeConventionType(match[1]);
		if (type === "" || !rules.types.includes(type)) reasons.push("type");
		else rest = text.slice(match[0].length);
	}
	if (rules.languageStated && rules.language === "en" && conventionHasChinese(text)) reasons.push("lang");
	if (rules.languageStated && rules.language === "zh" && !conventionHasChinese(text)) reasons.push("lang");
	const first = rest.charAt(0);
	if (rules.lowercase && /[A-Za-z]/.test(first) && first === first.toUpperCase()) reasons.push("case");
	if (rules.noPeriod && /[.。]$/.test(text)) reasons.push("period");
	if (rules.imperative) {
		const head = rest.split(/\s+/)[0] ?? "";
		if (!/[^\x00-\x7F]/.test(head) && CONVENTION_NON_IMPERATIVE.includes(head.toLowerCase())) reasons.push("mood");
	}
	return reasons;
}

/**
 * Check the last commits of one repository against its own document. Local
 * only: one `git log`, no model, no network. When the document states no
 * rule at all the report says `enforced: false` and the UI stays quiet.
 */
async function commitCompliance(service, root, docName) {
	const doc = conventionDocName(docName);
	const state = await repoConventionState(root, doc);
	let rules = Object.assign({}, CONVENTION_NO_RULES);
	if (state.exists && state.size > 0 && state.size <= CONVENTION_DOC_MAX_BYTES) {
		try {
			rules = parseConventionRules(await readFile(state.docPath, "utf8"));
		} catch {
			rules = Object.assign({}, CONVENTION_NO_RULES);
		}
	}
	let commits = [];
	try {
		const result = await service.runner.run(["log", "-20", "--format=%H%x00%s%x00%b%x1e"], root);
		if (result !== null && result !== void 0 && result.exitCode === 0 && typeof result.stdout === "string") {
			commits = result.stdout.split("\u001e").map((record) => record.replace(/^[\r\n]+/, "").replace(/[\s\r\n]+$/, "")).filter((record) => record !== "").map((record) => {
				const parts = record.split("\u0000");
				return {
					oid: (parts[0] ?? "").slice(0, 7),
					subject: parts[1] === void 0 ? "" : parts[1],
					body: parts.slice(2).join("\u0000")
				};
			});
		}
	} catch {
		commits = [];
	}
	const languages = {
		zh: 0,
		en: 0,
		mixed: 0
	};
	for (const commit of commits) {
		const language = conventionLanguageOf(commit.subject);
		if (language === "zh" || language === "en" || language === "mixed") languages[language] += 1;
	}
	const offenders = [];
	let failing = 0;
	for (const commit of commits) {
		const reasons = conventionSubjectReasons(commit.subject, rules);
		const trailer = conventionAiTrailerOf(commit.body);
		if (rules.ai === "required" && trailer === "") reasons.push("ai");
		if (rules.ai === "forbidden" && CONVENTION_AI_TOOL_TRAILERS.includes(trailer)) reasons.push("ai");
		if (reasons.length === 0) continue;
		failing += 1;
		if (offenders.length < 6) offenders.push({
			oid: commit.oid,
			subject: commit.subject,
			reasons
		});
	}
	return {
		root,
		doc,
		docPath: state.docPath,
		exists: state.exists,
		enforced: rules.maxSubject !== null || rules.types !== null || rules.lowercase || rules.noPeriod || rules.imperative || rules.ai === "required" || rules.ai === "forbidden",
		strict: rules.strict === true,
		checked: commits.length,
		languages,
		failing,
		rules,
		ai: rules.ai,
		aiStated: rules.aiStated === true,
		offenders
	};
}

/** One paragraph, shortened for a preview line. */
function conventionSnippet(text) {
	const flat = String(text ?? "").replace(/\s+/g, " ").trim();
	return flat.length > 96 ? flat.slice(0, 95) + "\u2026" : flat;
}

/**
 * Split a document into `## ` sections (the preamble keeps the empty title).
 * Paragraphs are the unit of comparison: a preview only needs to say which
 * paragraphs appear, change or disappear.
 */
function conventionSectionsOf(text) {
	const sections = [];
	let current = {
		title: "",
		lines: []
	};
	for (const line of String(text ?? "").split("\n")) {
		if (/^##\s+/.test(line)) {
			sections.push(current);
			current = {
				title: line.trim(),
				lines: []
			};
			continue;
		}
		current.lines.push(line);
	}
	sections.push(current);
	return sections.map((section) => {
		const body = section.lines.join("\n").trim();
		return {
			title: section.title,
			body,
			paragraphs: body === "" ? [] : body.split(/\n\s*\n/).map((part) => part.trim()).filter((part) => part !== "")
		};
	});
}

/** Section- and paragraph-level difference between the current and next document. */
function conventionDiff(current, next) {
	const before = conventionSectionsOf(current);
	const after = conventionSectionsOf(next);
	const blank = String(current ?? "").trim() === "";
	const pending = blank ? new Map() : new Map(before.map((section) => [section.title, section]));
	const sections = [];
	let added = 0;
	let changed = 0;
	let same = 0;
	for (const section of after) {
		const previous = pending.get(section.title);
		const title = section.title === "" ? "(intro)" : section.title;
		if (previous === void 0) {
			added += 1;
			sections.push({
				title,
				status: "added",
				dropped: [],
				fresh: section.paragraphs.slice(0, 3).map(conventionSnippet)
			});
			continue;
		}
		pending.delete(section.title);
		const freshSet = new Set(section.paragraphs);
		const beforeSet = new Set(previous.paragraphs);
		const dropped = previous.paragraphs.filter((part) => !freshSet.has(part)).slice(0, 3).map(conventionSnippet);
		const fresh = section.paragraphs.filter((part) => !beforeSet.has(part)).slice(0, 3).map(conventionSnippet);
		const status = dropped.length === 0 && fresh.length === 0 ? "same" : "changed";
		if (status === "changed") changed += 1;
		else same += 1;
		sections.push({
			title,
			status,
			dropped,
			fresh
		});
	}
	const removed = [];
	for (const section of pending.values()) {
		removed.push(section.title === "" ? "(intro)" : section.title);
	}
	return {
		added,
		changed,
		removed: removed.length,
		same,
		sections,
		removedTitles: removed.slice(0, 6)
	};
}

/**
 * What choosing a framework would do to an existing document, without doing
 * it. The write itself still goes through `/git/convention` with `force`.
 */
async function conventionPreview(root, docName, frameworkId, strict, language, ai) {
	const doc = conventionDocName(docName);
	const state = await repoConventionState(root, doc);
	const next = conventionBodyOf(frameworkId, basename(root), strict, language, ai);
	if (next === void 0) return {
		ok: false,
		error: {
			code: "convention-unknown-framework",
			message: "unknown convention framework"
		}
	};
	let current = "";
	if (state.exists && state.size > 0 && state.size <= CONVENTION_DOC_MAX_BYTES) {
		try {
			current = await readFile(state.docPath, "utf8");
		} catch {
			current = "";
		}
	}
	const diff = conventionDiff(current, next);
	return {
		ok: true,
		value: Object.assign({
			root,
			doc,
			docPath: state.docPath,
			exists: state.exists,
			framework: typeof frameworkId === "string" && frameworkId !== "" ? frameworkId : "none",
			currentBytes: Buffer.byteLength(current, "utf8"),
			nextBytes: Buffer.byteLength(next, "utf8")
		}, diff)
	};
}

/* ---------------------------------------------------------------------- *
 * 1.6.0 — the workspace-wide document.
 *
 * A container (a workspace holding several repositories, possibly no
 * repository at all) can carry `.dsh/<doc>`. It reaches every repository
 * below it through the same inheritance the prompt already understands, and
 * it never competes with a repository's own document.
 * ---------------------------------------------------------------------- */

/** Folder that holds the workspace-wide document. */
const CONVENTION_WORKSPACE_DIR = ".dsh";

/** Absolute path of the workspace-wide document at one container root. */
function conventionWorkspaceDocPath(root, docName) {
	return join(root, CONVENTION_WORKSPACE_DIR, conventionDocName(docName));
}

/** The nearest directory at or above `start` that carries `.dsh/<doc>`. */
function conventionsWorkspaceDocFor(start, docName) {
	const doc = conventionDocName(docName);
	let current = start;
	for (let depth = 0; depth < 8; depth += 1) {
		try {
			if (statSync(join(current, CONVENTION_WORKSPACE_DIR, doc)).isFile()) return current;
		} catch {
			// no document here: keep walking up
		}
		const parent = dirname(current);
		if (parent === current) return void 0;
		current = parent;
	}
	return void 0;
}

/** Whether a container already carries the workspace document. */
async function workspaceConventionState(root, docName) {
	const doc = conventionDocName(docName);
	const docPath = conventionWorkspaceDocPath(root, doc);
	const info = await stat(docPath).catch(() => null);
	if (info === null || info.isFile() !== true) return {
		root,
		doc: CONVENTION_WORKSPACE_DIR + "/" + doc,
		docPath,
		exists: false,
		size: 0,
		draft: false,
	strict: false,
	language: "mixed",
	languageStated: false,
	ai: "optional",
	aiStated: false
	};
	let text = "";
	if (info.size > 0 && info.size <= CONVENTION_DOC_MAX_BYTES) {
		try {
			text = await readFile(docPath, "utf8");
		} catch {
			text = "";
		}
	}
	return {
		root,
		doc: CONVENTION_WORKSPACE_DIR + "/" + doc,
		docPath,
		exists: true,
		size: info.size,
		draft: /\bstatus:\s*draft\b/i.test(text),
		strict: conventionStrictOf(text),
		language: conventionDocLanguageOf(text),
		languageStated: conventionFieldValue(text, "language") !== "",
		ai: conventionAiOf(text),
		aiStated: conventionAiStated(text)
	};
}

/** Rewrite only the front-matter switches of an existing document. */
async function conventionSettings(root, docName, strictMode, languageMode, aiMode) {
	const doc = conventionDocName(docName);
	const docPath = join(root, doc);
	const state = await repoConventionState(root, doc);
	if (state.exists !== true) return {
		ok: false,
		error: {
			code: "convention-missing-document",
			message: "there is no conventions document to update yet"
		}
	};
	let current = "";
	try {
		current = await readFile(docPath, "utf8");
	} catch {
		current = "";
	}
	if (current.trim() === "") return {
		ok: false,
		error: {
			code: "convention-missing-document",
			message: "the conventions document is empty"
		}
	};
	const strict = typeof strictMode === "boolean" ? strictMode : state.strict === true;
	const language = typeof languageMode === "string" && languageMode !== "" ? languageMode : state.language;
	const ai = typeof aiMode === "string" && aiMode !== "" ? aiMode : state.aiStated === true ? state.ai : void 0;
	const next = conventionWithAi(conventionWithStrict(conventionWithLanguage(current, language), strict), ai);
	const written = await repoWriteConvention(root, doc, next, {
		force: true
	});
	if (written.ok !== true) return written;
	return {
		ok: true,
		value: {
			root,
			doc,
			docPath,
			bytes: written.value.bytes,
			strict,
			language,
			ai: conventionAiOf(next)
		}
	};
}

/**
 * One entry point for the workspace document: `state`, `preview` or `write`.
 * Same six frameworks, same bodies, just a different destination — and the
 * preview never writes, so an accidental click cannot replace a settled
 * document.
 */
async function workspaceConvention(root, docName, action, frameworkId, force, strictMode, languageMode, aiMode) {
	const doc = conventionDocName(docName);
	const state = await workspaceConventionState(root, doc);
	const mode = typeof action === "string" && action !== "" ? action : "state";
	const framework = typeof frameworkId === "string" && frameworkId !== "" ? frameworkId : null;
	const strict = typeof strictMode === "boolean" ? strictMode : void 0;
	const language = typeof languageMode === "string" ? languageMode : void 0;
	const ai = typeof aiMode === "string" ? aiMode : void 0;
	if (mode === "settings") return await conventionSettings(root, CONVENTION_WORKSPACE_DIR + "/" + doc, strict, language, ai);
	if (mode === "state") return {
		ok: true,
		value: Object.assign({}, state, {
			catalog: conventionCatalog()
		})
	};
	const next = conventionBodyOf(framework, basename(root), strict, language, ai);
	if (next === void 0) return {
		ok: false,
		error: {
			code: "convention-unknown-framework",
			message: "unknown convention framework"
		}
	};
	let current = "";
	if (state.exists && state.size > 0 && state.size <= CONVENTION_DOC_MAX_BYTES) {
		try {
			current = await readFile(state.docPath, "utf8");
		} catch {
			current = "";
		}
	}
	const diff = conventionDiff(current, next);
	if (mode === "preview") return {
		ok: true,
		value: Object.assign({}, state, {
			framework: framework ?? "none",
			currentBytes: Buffer.byteLength(current, "utf8"),
			nextBytes: Buffer.byteLength(next, "utf8")
		}, diff)
	};
	const written = await repoWriteConvention(root, CONVENTION_WORKSPACE_DIR + "/" + doc, next, {
		force: force === true
	});
	if (!written.ok) return written;
	return {
		ok: true,
		value: {
			root,
			doc: CONVENTION_WORKSPACE_DIR + "/" + doc,
			docPath: written.value.docPath,
			bytes: written.value.bytes,
			created: written.value.created,
			framework: framework ?? "none"
		}
	};
}

/** Timestamp used to name a backup file: 20261027-131500. */
function conventionTimestamp() {
	const now = new Date();
	const pad = (value) => String(value).padStart(2, "0");
	return String(now.getFullYear()) + pad(now.getMonth() + 1) + pad(now.getDate()) + "-" + pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds());
}

/** Whether a document states one of the boolean rules, whatever the answer is. */
function conventionStatesRule(text, rule) {
	const source = String(text === null || text === void 0 ? "" : text);
	if (rule === "lowercase") return /小写开头|小写字母开头|lowercase/i.test(source);
	if (rule === "noPeriod") return /不加句号|不加句点|no trailing period|no period at the end/i.test(source);
	if (rule === "imperative") return /祈使句|imperative/i.test(source);
	return false;
}

/** One document that governs the commits of the current workspace. */
function conventionSourceOf(kind, owner, docPath) {
	let body = "";
	let exists = false;
	try {
		const info = statSync(docPath);
		if (info.isFile()) {
			exists = true;
			if (info.size > 0 && info.size <= CONVENTION_DOC_MAX_BYTES) body = readFileSync(docPath, "utf8");
		}
	} catch {
		exists = false;
	}
	const pointer = exists && conventionIsPointer(body);
	return {
		kind,
		owner,
		docPath,
		exists,
		pointer,
		inherited: pointer ? conventionPointerTarget(body) : "",
		body: exists && !pointer ? body : "",
		fields: {
			status: conventionFieldValue(body, "status"),
			framework: conventionFieldValue(body, "framework"),
			strict: conventionFieldValue(body, "strict"),
			language: conventionFieldValue(body, "language"),
			ai: conventionFieldValue(body, "ai")
		},
		rules: exists && !pointer ? parseConventionRules(body) : Object.assign({}, CONVENTION_NO_RULES)
	};
}

/**
 * Prose documents that state commit rules without being one of ours: agent
 * notes, contributor guides, editor rule files. They are read, never written.
 */
const CONVENTION_FOREIGN_DOCS = ["AGENTS.md", "CLAUDE.md", ".cursorrules", "CONTRIBUTING.md"];

/** Every document that governs the same commits, in priority order. */
function conventionsSources(cwd, docName) {
	const doc = conventionDocName(docName);
	const start = resolve(String(cwd === null || cwd === void 0 || cwd === "" ? "." : cwd));
	const workspace = conventionsWorkspaceDocFor(start, doc);
	const root = conventionsRepoRoot(start);
	const sources = [];
	if (workspace !== void 0) sources.push(conventionSourceOf("workspace", workspace, join(workspace, CONVENTION_WORKSPACE_DIR, doc)));
	if (root !== void 0) {
		if (workspace === void 0 || resolve(workspace) !== resolve(root)) sources.push(conventionSourceOf("repo", root, join(root, doc)));
		for (const ancestor of conventionsAncestorRoots(root)) {
			if (workspace !== void 0 && resolve(ancestor) === resolve(workspace)) continue;
			sources.push(conventionSourceOf("ancestor", ancestor, join(ancestor, doc)));
		}
	}
	const foreign = [];
	const seen = new Set(sources.map((source) => resolve(source.docPath)));
	for (const owner of [workspace, root]) {
		if (owner === void 0) continue;
		for (const name of CONVENTION_FOREIGN_DOCS) {
			const docPath = join(owner, name);
			const key = resolve(docPath);
			if (seen.has(key)) continue;
			seen.add(key);
			foreign.push(conventionSourceOf("foreign", name, docPath));
		}
	}
	return {
		doc,
		root,
		workspace,
		sources,
		foreign
	};
}

/** Short label for the prompt and the tab. */
function conventionsOriginLabel(kind) {
	if (kind === "workspace") return "workspace";
	if (kind === "repo") return "this repository";
	if (kind === "foreign") return "another document";
	if (kind === "ancestor") return "parent repository";
	return String(kind);
}

/** The union of the rule sets: the strictest cap, every type, any boolean set. */
function conventionsUnionRules(live) {
	const union = Object.assign({}, CONVENTION_NO_RULES);
	const lengths = live.map((source) => source.rules.maxSubject).filter((value) => value !== null);
	if (lengths.length > 0) union.maxSubject = Math.min.apply(null, lengths);
	const types = [];
	for (const source of live) {
		const list = source.rules.types;
		if (list === null) continue;
		for (const type of list) if (!types.includes(type)) types.push(type);
	}
	if (types.length > 0) union.types = types;
	union.lowercase = live.some((source) => source.rules.lowercase === true);
	union.noPeriod = live.some((source) => source.rules.noPeriod === true);
	union.imperative = live.some((source) => source.rules.imperative === true);
	union.strict = live.some((source) => source.rules.strict === true);
	const languages = live.map((source) => source.fields.language).filter((value) => value !== "");
	union.language = languages.length > 0 ? conventionLanguageValueOf(languages[0]) : "mixed";
	union.languageStated = languages.length > 0;
	const ais = live.map((source) => source.fields.ai).filter((value) => value !== "");
	union.ai = ais.length > 0 ? conventionAiOf("ai: " + ais[0]) : "optional";
	union.aiStated = ais.length > 0;
	return union;
}

/** Field- and rule-level conflicts between the documents of one workspace. */
function conventionsConflicts(cwd, docName) {
	const scan = conventionsSources(cwd, docName);
	const live = scan.sources.filter((source) => source.exists === true && source.pointer !== true);
	const foreign = scan.foreign.filter((source) => source.exists === true);
	const allSources = live.concat(foreign);
	const union = conventionsUnionRules(allSources);
	const fields = [];
	for (const key of ["status", "framework", "strict", "language", "ai"]) {
		const values = live.filter((source) => source.fields[key] !== "").map((source) => ({
			origin: source.kind === "foreign" ? source.owner : source.kind,
			docPath: source.docPath,
			value: source.fields[key]
		}));
		if (new Set(values.map((entry) => entry.value)).size < 2) continue;
		fields.push({
			key,
			values
		});
	}
	const rules = [];
	const lengths = allSources.filter((source) => source.rules.maxSubject !== null);
	if (new Set(lengths.map((source) => source.rules.maxSubject)).size > 1) rules.push({
		key: "maxSubject",
		values: lengths.map((source) => ({
			origin: source.kind === "foreign" ? source.owner : source.kind,
			docPath: source.docPath,
			value: source.rules.maxSubject
		}))
	});
	const typed = allSources.filter((source) => source.rules.types !== null);
	if (typed.length > 1) {
		let common = typed[0].rules.types.slice();
		for (const source of typed.slice(1)) common = common.filter((type) => source.rules.types.includes(type));
		if (common.length === 0) rules.push({
			key: "types",
			values: typed.map((source) => ({
				origin: source.kind === "foreign" ? source.owner : source.kind,
				docPath: source.docPath,
				value: source.rules.types.join(", ")
			}))
		});
	}
	for (const key of ["lowercase", "noPeriod", "imperative"]) {
		const stated = allSources.filter((source) => conventionStatesRule(source.body, key) === true);
		if (stated.length < 2) continue;
		if (new Set(stated.map((source) => source.rules[key])).size > 1) rules.push({
			key,
			values: stated.map((source) => ({
				origin: source.kind === "foreign" ? source.owner : source.kind,
				docPath: source.docPath,
				value: source.rules[key]
			}))
		});
	}
	const governedUnion = conventionsUnionRules(live);
	const extra = [];
	for (const source of foreign) {
		const declared = [];
		if (source.rules.maxSubject !== null && (governedUnion.maxSubject === null || source.rules.maxSubject !== governedUnion.maxSubject)) declared.push("subject at most " + String(source.rules.maxSubject) + " characters");
		if (source.rules.types !== null) {
			const missing = source.rules.types.filter((type) => governedUnion.types === null || !governedUnion.types.includes(type));
			if (missing.length > 0) declared.push("types " + missing.join(", "));
		}
		for (const key of ["lowercase", "noPeriod", "imperative"]) {
			if (conventionStatesRule(source.body, key) === true && governedUnion[key] !== source.rules[key]) declared.push(key + " " + String(source.rules[key]));
		}
		if (declared.length > 0) extra.push({
			origin: source.owner,
			docPath: source.docPath,
			keys: declared
		});
	}
	const count = fields.length + rules.length + extra.length;
	const digest = createHash("sha256").update(JSON.stringify({
		sources: live.map((source) => [source.docPath, source.fields, source.rules]),
		foreign: foreign.map((source) => [source.docPath, source.rules]),
		count
	})).digest("hex").slice(0, 16);
	return {
		doc: scan.doc,
		root: scan.root,
		workspace: scan.workspace,
		live: live.length,
		total: scan.sources.length,
		sources: scan.sources.map((source) => ({
			kind: source.kind,
			owner: source.owner,
			docPath: source.docPath,
			exists: source.exists,
			pointer: source.pointer,
			inherited: source.inherited,
			fields: source.fields,
			rules: {
				maxSubject: source.rules.maxSubject,
				types: source.rules.types,
				lowercase: source.rules.lowercase,
				noPeriod: source.rules.noPeriod,
				imperative: source.rules.imperative,
				ai: source.rules.ai,
				aiStated: source.rules.aiStated === true
			}
		})),
		fields,
		rules,
		foreign: extra,
		count,
		digest,
		union
	};
}

/** The prompt paragraph that turns a conflict into a question for the user. */
function conventionsConflictPromptBlock(report) {
	if (report === void 0 || report.count === 0) return "";
	const lines = ["Git conventions conflict across " + String(report.live) + " documents; the settings below disagree:"];
	for (const field of report.fields) lines.push("- " + field.key + ": " + field.values.map((entry) => String(entry.value) + " (" + conventionsOriginLabel(entry.origin) + ")").join(" vs "));
	for (const rule of report.rules) lines.push("- " + rule.key + ": " + rule.values.map((entry) => String(entry.value) + " (" + conventionsOriginLabel(entry.origin) + ")").join(" vs "));
	for (const entry of report.foreign === void 0 ? [] : report.foreign) lines.push("- " + entry.origin + " also states " + entry.keys.join("; ") + " - it is not rewritten by a merge, so ask the user whether those rules should move into the document first");
	lines.push("Do not pick a side silently: ask the user which document should govern. To merge them into one workspace document, call the git_conventions tool with action consolidate and write false first, show the plan, and only then repeat with write true.");
	return lines.join("\n");
}

/** Relative path from one absolute directory to a file, with forward slashes. */
function conventionRelativePath(from, to) {
	const source = String(from).replace(/\\/g, "/").split("/").filter((part) => part !== "");
	const target = String(to).replace(/\\/g, "/").split("/").filter((part) => part !== "");
	let index = 0;
	while (index < source.length && index < target.length && source[index] === target[index]) index += 1;
	const parts = [];
	for (let up = index; up < source.length; up += 1) parts.push("..");
	for (let down = index; down < target.length; down += 1) parts.push(target[down]);
	return parts.join("/");
}

/** The machine-readable union, appended as its own section. */
function conventionsUnionSection(union) {
	const lines = ["## Unified rules (merged by dsh-git-graph)", "", "Every source document is reduced to the rules below; the parser reads them as a union."];
	lines.push("");
	if (union.maxSubject !== null) lines.push("- subject at most " + String(union.maxSubject) + " characters");
	if (union.types !== null && union.types.length >= 3) lines.push("- type prefix one of `" + union.types.join("` `") + "`");
	if (union.lowercase) lines.push("- lowercase first letter");
	if (union.noPeriod) lines.push("- no trailing period");
	if (union.imperative) lines.push("- imperative mood");
	return lines.join("\n");
}

/** The merged document: priority body, the sections it lacks, then the union. */
function conventionsMergedBody(primary, others, union) {
	const parts = [primary.body.trim()];
	const titles = new Set(conventionSectionsOf(primary.body).map((section) => section.title));
	for (const source of others) {
		for (const section of conventionSectionsOf(source.body)) {
			if (section.title === "" || section.body === "") continue;
			/** A section that already exists keeps both texts: the second one is labelled with its origin. */
			const base = titles.has(section.title) ? section.title + " (from " + conventionsOriginLabel(source.kind) + ")" : section.title;
			let label = base;
			let repeat = 2;
			while (titles.has(label)) label = base + " " + repeat++;
			titles.add(label);
			parts.push(label + "\n\n" + section.body);
		}
	}
	parts.push(conventionsUnionSection(union));
	const joined = parts.filter((part) => part.trim() !== "").join("\n\n");
	const withLanguage = union.languageStated ? conventionWithLanguage(joined, union.language) : joined;
	const withStrict = conventionWithStrict(withLanguage, union.strict);
	return union.aiStated ? conventionWithAi(withStrict, union.ai) : withStrict;
}

/**
 * Merge every governing document into one workspace document, keeping a backup
 * of each file it replaces and leaving a pointer in the repository documents.
 * `write` stays false until the caller has shown the user the plan.
 */
async function conventionsConsolidate(cwd, docName, options) {
	const opt = options !== null && typeof options === "object" ? options : {};
	const report = conventionsConflicts(cwd, docName);
	const scan = conventionsSources(cwd, docName);
	const live = scan.sources.filter((source) => source.exists === true && source.pointer !== true);
	const foreign = scan.foreign.filter((source) => source.exists === true);
	if (live.length < 1 || (live.length < 2 && foreign.length === 0)) return {
		ok: false,
		error: {
			code: "convention-single-source",
			message: "only one document governs this workspace; there is nothing to merge"
		}
	};
	const start = resolve(String(cwd === null || cwd === void 0 || cwd === "" ? "." : cwd));
	const workspaceRoot = report.workspace !== void 0 ? report.workspace : report.root !== void 0 ? report.root : start;
	const target = join(workspaceRoot, CONVENTION_WORKSPACE_DIR, report.doc);
	let current = "";
	let exists = false;
	try {
		const info = statSync(target);
		if (info.isFile()) {
			exists = true;
			current = readFileSync(target, "utf8");
		}
	} catch {
		exists = false;
	}
	const primary = live[0];
	const others = live.slice(1);
	const merged = conventionsMergedBody(primary, others, report.union);
	const plan = {
		target,
		primary: primary.docPath,
		absorbed: others.map((source) => source.docPath),
		leftInPlace: foreign.map((source) => source.docPath),
		bytes: Buffer.byteLength(merged, "utf8"),
		conflicts: report.count,
		union: report.union,
		diff: conventionDiff(current, merged),
		body: merged
	};
	if (opt.write !== true) return {
		ok: true,
		value: Object.assign({
			written: false,
			exists
		}, plan)
	};
	if (exists && opt.force !== true) return {
		ok: false,
		error: {
			code: "convention-exists",
			message: ".dsh/" + report.doc + " already exists; preview the plan, then repeat with force"
		}
	};
	const stamp = conventionTimestamp();
	const backups = [];
	if (exists && current !== "") {
		const backup = target + ".bak-" + stamp;
		await writeFile(backup, current, "utf8");
		backups.push(backup);
	}
	const written = await repoWriteConvention(workspaceRoot, CONVENTION_WORKSPACE_DIR + "/" + report.doc, merged, {
		force: true
	});
	if (written.ok !== true) return written;
	const pointers = [];
	for (const source of others) {
		const backup = source.docPath + ".bak-" + stamp;
		await writeFile(backup, source.body, "utf8");
		backups.push(backup);
		await writeFile(source.docPath, conventionPointerBody(conventionRelativePath(source.owner, target)), "utf8");
		pointers.push(source.docPath);
	}
	return {
		ok: true,
		value: Object.assign({
			written: true,
			exists,
			docPath: written.value.docPath,
			backups,
			pointers
		}, plan)
	};
}

/** The registered tool name. */
const GIT_CONVENTIONS_TOOL = "git_conventions";

/**
 * Model-facing tool: report the conflicts between the governing documents, and
 * merge them into the workspace document once the user has agreed to it. The
 * write stays behind `write: true` so the model shows the plan first.
 * @param readConfig - thunk returning the live feature config.
 */
function buildConventionsTool(readConfig) {
	return {
		name: GIT_CONVENTIONS_TOOL,
		description: [
			"Read and merge the git conventions documents that govern this session's workspace.",
			"check reports the settings on which the workspace document, the repository document and the parent repositories disagree;",
			"consolidate merges every document into .dsh/GIT_CONVENTIONS.md, keeps a timestamped backup of each file it replaces and leaves a pointer in the repository documents.",
			"Always run consolidate with write false first, show the plan, and only write after the user agrees."
		].join(" "),
		parameters: {
			type: "object",
			additionalProperties: false,
			properties: {
				action: {
					type: "string",
					enum: ["check", "consolidate"],
					description: "check reports conflicts; consolidate merges them into the workspace document."
				},
				write: {
					type: "boolean",
					description: "consolidate only: false (default) returns the plan without touching any file."
				},
				force: {
					type: "boolean",
					description: "consolidate only: replace an existing workspace document (a backup is still kept)."
				}
			},
			required: ["action"]
		},
		async execute(args, exec) {
			const input = typeof args === "object" && args !== null ? args : {};
			const cwd = callingCwd(exec);
			if (cwd === void 0) return {
				ok: false,
				code: "workspace-unknown",
				message: "git_conventions needs a calling session with a project cwd"
			};
			const config = readConfig();
			const docName = typeof config.conventionsDoc === "string" && config.conventionsDoc !== "" ? config.conventionsDoc : CONVENTION_DOC_DEFAULT;
			if (input.action === "check") {
				const report = conventionsConflicts(cwd, docName);
				return Object.assign({
					ok: true,
					guidance: report.count === 0 ? "The documents agree; nothing to merge." : "Ask the user which document should govern before calling consolidate."
				}, report);
			}
			if (input.action === "consolidate") {
				const merged = await conventionsConsolidate(cwd, docName, {
					write: input.write === true,
					force: input.force === true
				});
				if (!merged.ok) return {
					ok: false,
					code: merged.error.code,
					message: merged.error.message
				};
				return Object.assign({
					ok: true,
					guidance: merged.value.written === true ? "Tell the user which files were backed up and which now point at the workspace document." : "Show this plan to the user, then repeat with write true once they agree."
				}, merged.value);
			}
			return {
				ok: false,
				code: "internal",
				message: "action must be one of 'check', 'consolidate'"
			};
		}
	};
}
//#endregion
//#region src/host/repos.ts — multi-repo discovery (dsh-git-graph sidebar fork)
/** Path-identity alias (the gate owns the implementation; declarations hoist). */
const repoPathKeyOf = gatePathKey;
/** Directory names never descended into while scanning for nested repositories. */
const REPO_SCAN_SKIP = new Set([
	"node_modules",
	"dist",
	"build",
	"out",
	"coverage",
	"target",
	"vendor"
]);
/** Repository directories are reported at most this many levels below the base. */
const REPO_SCAN_MAX_DEPTH = 3;
/** Upper bound on the repositories reported for one base path. */
const REPO_SCAN_LIMIT = 200;
/** Overall budget for one repository-status probe (a lagging repository must not sit on a batch slot). */
const REPO_SCAN_STATUS_TIMEOUT_MS = 2500;
/** How long one scan result is reused before the next request rescans. */
const REPO_SCAN_CACHE_TTL_MS = 60000;
/** Status probes per batch: bounded concurrency instead of one git per entry. */
const REPO_SCAN_CONCURRENCY = 8;
/** Scan results by canonical base path (the in-flight promise is shared too). */
const repoScanCache = new Map();
/**
* One repository's snapshot, or undefined when the probe did not return in
* time (the entry then surfaces without branch metadata instead of stalling
* the whole scan).
*/
async function repoStatusOf(service, path, timeoutMs) {
	let timer;
	const deadline = new Promise((resolve) => {
		timer = setTimeout(() => resolve(void 0), timeoutMs);
	});
	try {
		const probe = service.status(path).catch(() => null);
		return await Promise.race([probe, deadline]);
	} finally {
		if (timer !== void 0) clearTimeout(timer);
	}
}
/**
* Depth-bounded breadth-first scan for repository directories (.git marker)
* under one base directory. Repositories are not descended into, dot
* directories and build output are skipped, and symbolic links are never
* followed (no cycles).
*/
async function repoScanDirectories(base) {
	const found = [];
	const queue = [{
		dir: base,
		depth: 0
	}];
	while (queue.length > 0 && found.length < REPO_SCAN_LIMIT) {
		const current = queue.shift();
		let dirents;
		try {
			dirents = await readdir(current.dir, { withFileTypes: true });
		} catch {
			continue;
		}
		let isRepo = false;
		for (const dirent of dirents) if (dirent.name === ".git") isRepo = true;
		if (isRepo && current.depth > 0) {
			found.push(current.dir);
			continue;
		}
		if (current.depth >= REPO_SCAN_MAX_DEPTH) continue;
		for (const dirent of dirents) {
			const name = dirent.name;
			if (name === ".git" || name.startsWith(".")) continue;
			if (REPO_SCAN_SKIP.has(name.toLowerCase())) continue;
			if (!dirent.isDirectory()) continue;
			queue.push({
				dir: join(current.dir, name),
				depth: current.depth + 1
			});
		}
	}
	return found;
}
/**
* Scan one workspace base directory for its repositories: the base's own
* repository first (which may sit ABOVE the workspace, when the workspace is
* a plain subdirectory of a checkout), then every nested repository.
* @param base - canonical workspace base directory.
* @param service - the workspace-gated git service.
* @returns the scan view the /git/repos route returns.
*/
async function repoScan(base, service, docName, autoScaffold) {
	const baseKey = repoPathKeyOf(base);
	const entries = [];
	const seen = new Set();
	const startedAt = Date.now();
	const baseStatus = await repoStatusOf(service, base, REPO_SCAN_STATUS_TIMEOUT_MS);
	if (baseStatus !== undefined && baseStatus !== null && typeof baseStatus.root === "string") {
		const rootKey = repoPathKeyOf(baseStatus.root);
		seen.add(rootKey);
		entries.push({
			path: base,
			root: baseStatus.root,
			name: basename(baseStatus.root),
			relPath: "",
			kind: "root",
			outside: rootKey !== baseKey,
			status: baseStatus
		});
	}
	const dirs = await repoScanDirectories(base);
	for (let offset = 0; offset < dirs.length; offset += REPO_SCAN_CONCURRENCY) {
		const batch = dirs.slice(offset, offset + REPO_SCAN_CONCURRENCY);
		const statuses = await Promise.all(batch.map((dir) => repoStatusOf(service, dir, REPO_SCAN_STATUS_TIMEOUT_MS)));
		for (let index = 0; index < batch.length; index += 1) {
			const dir = batch[index];
			const status = statuses[index];
			const root = status !== undefined && status !== null && typeof status.root === "string" ? status.root : dir;
			const rootKey = repoPathKeyOf(root);
			if (seen.has(rootKey)) continue;
			seen.add(rootKey);
			const relPath = dir.slice(baseKey.length).replace(/^[\\/]+/, "").replace(/\\/g, "/");
			entries.push({
				path: dir,
				root,
				name: basename(dir),
				relPath,
				kind: "nested",
				outside: false,
				status: status === undefined ? null : status
			});
		}
	}
	/** Open the probe window: whatever an earlier scan left behind is not ours. */
	repoTakeProbeCounters();
	const probedAt = Date.now();
	await repoAugment(service, entries);
	/** Probes this scan actually spawned, and how often the cache answered instead. */
	const probes = repoTakeProbeCounters();
	const augmentedAt = Date.now();
	/** Convention documents are file reads, so they batch like the probes instead of queueing up. */
	for (let offset = 0; offset < entries.length; offset += REPO_SCAN_CONCURRENCY) {
		const batch = entries.slice(offset, offset + REPO_SCAN_CONCURRENCY);
		await Promise.all(batch.map(async (entry) => {
			entry.conventions = await repoConventionState(entry.root, docName);
		}));
	}
	const finishedAt = Date.now();
	entries.sort((left, right) => {
		if (left.kind !== right.kind) return left.kind === "root" ? -1 : 1;
		return left.relPath < right.relPath ? -1 : left.relPath > right.relPath ? 1 : 0;
	});
	return {
		base,
		repos: entries,
		truncated: dirs.length >= REPO_SCAN_LIMIT,
		maxDepth: REPO_SCAN_MAX_DEPTH,
		conventions: {
			doc: conventionDocName(docName),
			autoScaffold: autoScaffold !== false
		},
		/** Phase timings for this scan: a slow workspace gets explained, not guessed at. */
		timings: {
			statusMs: probedAt - startedAt,
			augmentMs: augmentedAt - probedAt,
			conventionsMs: finishedAt - augmentedAt,
			totalMs: finishedAt - startedAt,
			probeSpawns: probes.spawns,
			probeHits: probes.hits
		},
		scannedAt: finishedAt
	};
}
/**
* Cached repository scan. The cache holds the in-flight promise, so two
* concurrent sidebar requests share one scan; refresh bypasses the cache.
*/
async function repoScanCached(base, service, refresh, docName, autoScaffold) {
	const key = gatePathKey(base) + "\u0000" + conventionDocName(docName);
	const now = Date.now();
	const cached = repoScanCache.get(key);
	if (!refresh && cached !== void 0 && now - cached.at < REPO_SCAN_CACHE_TTL_MS) return cached.promise;
	const promise = repoScan(base, service, docName, autoScaffold).catch((error) => {
		const current = repoScanCache.get(key);
		if (current !== void 0 && current.promise === promise) repoScanCache.delete(key);
		throw error;
	});
	repoScanCache.set(key, {
		at: now,
		promise
	});
	for (const [cachedKey, entry] of repoScanCache) {
		if (now - entry.at > REPO_SCAN_CACHE_TTL_MS * 5) repoScanCache.delete(cachedKey);
	}
	return promise;
}
//#endregion
//#region src/host/branches.ts — overview, branches, health (dsh-git-graph sidebar fork)
/**
 * Multi-repository overview helpers — upstream tracking, branch cleanup hints
 * and the read-only health report.
 *
 * This file is spliced into `lib/index.js` between the
 * `//#region src/host/branches.ts` markers by `scripts/build-lib.mjs`; it is
 * not a module of its own and uses the host bundle's scope (`stat` and `join`
 * come from `node:fs/promises` / `node:path` at the top of `lib/index.js`,
 * `DETACHED` from the git service).
 *
 * Everything here is READ-ONLY: nothing checks out, resets or deletes. The
 * plugin reports what the user could do and never does it.
 */

/** Local branches read per repository; beyond that the list says it is truncated. */
const BRANCH_REPORT_LIMIT = 120;
/** Branches probed against the base branch at once. */
const BRANCH_REPORT_CONCURRENCY = 4;
/** A branch whose tip is older than this is reported as stale. */
const BRANCH_STALE_DAYS = 30;
/** Repositories augmented with upstream/activity per batch. */
const REPO_AUGMENT_CONCURRENCY = 8;
/** Cached per-repository probes kept before the oldest are dropped. */
const REPO_SUMMARY_CACHE_LIMIT = 400;
/** Untracked files measured for the health report (one stat per file, so bounded). */
const HEALTH_UNTRACKED_LIMIT = 400;
/** A single untracked file at or above this size is called out. */
const HEALTH_BIG_BYTES = 1048576;
/** Branches without upstream named in the health report. */
const HEALTH_UPSTREAM_LIMIT = 20;
/** Base-branch candidates, most likely first. */
const BRANCH_BASE_CANDIDATES = ["main", "master", "trunk", "develop"];

/**
 * Run one git command inside a repository. Returns stdout, or null when the
 * command failed or threw — every caller treats null as "not available" so a
 * single odd repository never fails a whole scan.
 * @param service - the workspace-gated git service.
 * @param root - repository root to run in.
 * @param argv - git arguments WITHOUT the binary (the runner prepends it).
 */
async function repoGit(service, root, argv) {
	try {
		const result = await service.runner.run(argv, root);
		if (result === null || result === void 0) return null;
		if (result.exitCode !== 0) return null;
		return typeof result.stdout === "string" ? result.stdout : "";
	} catch {
		return null;
	}
}

/** `git for-each-ref refs/heads --format=...` — name, tip date, upstream, HEAD mark. */
const branchRowsArgv = () => [
	"for-each-ref",
	"refs/heads",
	"--format=%(refname:short)%00%(committerdate:unix)%00%(upstream:short)%00%(HEAD)"
];

/** `git for-each-ref refs/heads --format=...` — tip date, upstream and its distance, one spawn. */
const summaryRowsArgv = () => [
	"for-each-ref",
	"refs/heads",
	"--format=%(refname:short)%00%(committerdate:unix)%00%(upstream:short)%00%(upstream:track)"
];

/** Probe counters for one scan, so a test can prove the cache removed the spawns. */
const repoProbeCounters = {
	spawns: 0,
	hits: 0
};

/** Read and reset the probe counters (a scan owns the window between two calls). */
function repoTakeProbeCounters() {
	const snapshot = {
		spawns: repoProbeCounters.spawns,
		hits: repoProbeCounters.hits
	};
	repoProbeCounters.spawns = 0;
	repoProbeCounters.hits = 0;
	return snapshot;
}

/** `git rev-list --count <base>..<branch>` — commits on the branch the base lacks. */
const unmergedCountArgv = (base, branch) => [
	"rev-list",
	"--count",
	base + ".." + branch
];

/** `git stash list` — one line per stash entry. */
const stashListArgv = () => ["stash", "list"];

/** `git ls-files --others --exclude-standard -z` — untracked files, NUL-separated. */
const untrackedArgv = () => [
	"ls-files",
	"--others",
	"--exclude-standard",
	"-z"
];

/**
 * Parse `git for-each-ref` output produced by {@link branchRowsArgv}.
 * @param stdout - NUL-separated fields, one branch per line.
 * @returns branch rows, sorted by name.
 */
function parseBranchRows(stdout) {
	const rows = [];
	const now = Math.floor(Date.now() / 1000);
	for (const line of String(stdout).split("\n")) {
		if (line === "") continue;
		const [name, date, upstream, head] = line.split("\0");
		if (typeof name !== "string" || name === "") continue;
		const stamp = Number.parseInt(date, 10);
		const lastCommit = Number.isFinite(stamp) ? stamp : null;
		rows.push({
			name,
			current: head === "*",
			upstream: typeof upstream === "string" ? upstream : "",
			lastCommit,
			stale: lastCommit === null ? false : now - lastCommit > BRANCH_STALE_DAYS * 86400
		});
	}
	rows.sort((left, right) => left.name.localeCompare(right.name));
	return rows;
}

/**
 * The reference branch cleanup is judged against: the project's usual trunk
 * when it exists, otherwise whatever is checked out. Read-only either way.
 * @param rows - branch rows of the repository.
 * @param current - the checked-out branch ("" when detached).
 */
function branchBaseOf(rows, current) {
	for (const candidate of BRANCH_BASE_CANDIDATES) {
		if (rows.some((row) => row.name === candidate)) return candidate;
	}
	if (current !== "" && current !== DETACHED) return current;
	return rows.length > 0 ? rows[0].name : "";
}

/**
 * Parse `%(upstream:track)` into counts: "" while level, "[ahead 3, behind 1]"
 * while apart, "[gone]" once the remote branch is deleted. Split by hand so
 * the source survives shells that eat backslashes.
 * @param track - raw track field of one branch.
 */
function parseUpstreamTrack(track) {
	const text = typeof track === "string" ? track : "";
	const plain = text.split("[").join("").split("]").join("").trim();
	if (plain === "" || plain.indexOf("gone") >= 0) return { ahead: 0, behind: 0 };
	let ahead = 0;
	let behind = 0;
	for (const part of plain.split(",")) {
		const piece = part.trim();
		if (piece.indexOf("ahead ") === 0) ahead = Number.parseInt(piece.slice(6), 10) || 0;
		else if (piece.indexOf("behind ") === 0) behind = Number.parseInt(piece.slice(7), 10) || 0;
	}
	return {
		ahead,
		behind
	};
}

/**
 * Parse {@link summaryRowsArgv} output: one row per local branch.
 * @param stdout - NUL-separated fields, one branch per line.
 */
function parseSummaryRows(stdout) {
	const rows = [];
	for (const line of String(stdout).split("\n")) {
		if (line === "") continue;
		const fields = line.split("\0");
		const name = fields[0];
		if (typeof name !== "string" || name === "") continue;
		const stamp = Number.parseInt(fields[1], 10);
		const distance = parseUpstreamTrack(fields[3]);
		rows.push({
			name,
			lastCommit: Number.isFinite(stamp) ? stamp : null,
			upstream: typeof fields[2] === "string" ? fields[2] : "",
			ahead: distance.ahead,
			behind: distance.behind
		});
	}
	return rows;
}

/** The git directory of a working tree: `.git` itself, or the path its file points at. */
async function repoGitDirOf(root) {
	const dot = join(root, ".git");
	try {
		const info = await stat(dot);
		if (info.isDirectory()) return dot;
		const text = await readFile(dot, "utf8");
		const line = String(text).split("\n")[0].trim();
		if (line.indexOf("gitdir:") !== 0) return null;
		const target = line.slice(7).trim();
		if (target === "") return null;
		return isAbsolute(target) ? target : join(root, target);
	} catch {
		return null;
	}
}

/**
 * A cheap identity for "the refs have not moved": the HEAD pointer plus the
 * reflog of HEAD, which every commit, checkout and branch creation rewrites.
 * Deliberately ignores `.git/index`, since `git status` may touch it and the
 * status probe runs on every scan anyway.
 * @param root - repository root.
 */
async function repoSummaryFingerprint(root) {
	try {
		const gitDir = await repoGitDirOf(root);
		if (gitDir === null) return null;
		const head = await readFile(join(gitDir, "HEAD"), "utf8");
		const reflog = await stat(join(gitDir, "logs", "HEAD"));
		return head.trim() + "|" + Math.round(reflog.mtimeMs);
	} catch {
		return null;
	}
}

/**
 * Last activity and upstream distance for one repository, in a single spawn.
 * The probed branch is the checked-out one when it still exists, else the
 * first branch that tracks something, else the first branch at all.
 * @param service - the workspace-gated git service.
 * @param root - repository root to run in.
 * @param branch - the checked-out branch, "" when detached.
 */
async function repoSummaryOf(service, root, branch) {
	repoProbeCounters.spawns += 1;
	const stdout = await repoGit(service, root, summaryRowsArgv());
	if (stdout === null) return null;
	const rows = parseSummaryRows(stdout);
	if (rows.length === 0) return null;
	let row = rows.find((item) => item.name === branch);
	if (row === undefined) row = rows.find((item) => item.upstream !== "");
	if (row === undefined) row = rows[0];
	let newest = null;
	for (const item of rows) {
		if (item.lastCommit === null) continue;
		if (newest === null || item.lastCommit > newest) newest = item.lastCommit;
	}
	return {
		activity: row.lastCommit === null ? newest : row.lastCommit,
		upstream: row.upstream === "" ? null : {
			name: row.upstream,
			ahead: row.ahead,
			behind: row.behind
		}
	};
}

/** Per-repository summary cache: root key -> fingerprint and the values it produced. */
const repoSummaryCache = new Map();

/**
 * Fill in the overview fields of scanned repositories: last activity and the
 * upstream distance. One spawn per repository instead of three, and none at
 * all while the refs have not moved since the last scan; a failing probe
 * leaves its field null instead of failing the scan.
 * @param service - the workspace-gated git service.
 * @param entries - repository entries as produced by the scan (mutated).
 */
async function repoAugment(service, entries) {
	const rows = Array.isArray(entries) ? entries : [];
	for (let offset = 0; offset < rows.length; offset += REPO_AUGMENT_CONCURRENCY) {
		const batch = rows.slice(offset, offset + REPO_AUGMENT_CONCURRENCY);
		await Promise.all(batch.map(async (entry) => {
			if (entry === null || entry === void 0) return;
			if (typeof entry.root !== "string" || entry.root === "") return;
			const key = repoPathKeyOf(entry.root);
			const branch = entry.status !== null && entry.status !== void 0 && typeof entry.status.branch === "string" ? entry.status.branch : "";
			const fingerprint = await repoSummaryFingerprint(entry.root);
			if (fingerprint !== null) {
				const cached = repoSummaryCache.get(key);
				if (cached !== void 0 && cached.fingerprint === fingerprint) {
					entry.activity = cached.activity;
					entry.upstream = cached.upstream;
					repoProbeCounters.hits += 1;
					return;
				}
			}
			const summary = await repoSummaryOf(service, entry.root, branch);
			entry.activity = summary === null ? null : summary.activity;
			entry.upstream = summary === null ? null : summary.upstream;
			if (summary !== null && fingerprint !== null) {
				if (repoSummaryCache.size >= REPO_SUMMARY_CACHE_LIMIT && !repoSummaryCache.has(key)) {
					const oldest = repoSummaryCache.keys().next();
					if (oldest.done !== true) repoSummaryCache.delete(oldest.value);
				}
				repoSummaryCache.set(key, {
					fingerprint,
					activity: summary.activity,
					upstream: summary.upstream
				});
			}
		}));
	}
	return rows;
}

/**
 * Branch cleanup hints for one repository: every local branch, whether the
 * base branch already contains it, and how many commits it would bring along.
 * A suggestion, never a deletion.
 * @param service - the workspace-gated git service.
 * @param path - any path inside the repository.
 * @returns the report, or null when the path is not a repository.
 */
async function branchReport(service, path) {
	const status = await service.status(path);
	if (status === null || status === void 0) return null;
	const stdout = await repoGit(service, status.root, branchRowsArgv());
	if (stdout === null) return null;
	const rows = parseBranchRows(stdout);
	const base = branchBaseOf(rows, status.branch);
	const kept = rows.slice(0, BRANCH_REPORT_LIMIT);
	const branches = kept.map((row) => ({
		name: row.name,
		current: row.current,
		upstream: row.upstream,
		lastCommit: row.lastCommit,
		stale: row.stale,
		base: row.name === base,
		merged: null,
		unmerged: null
	}));
	const probes = branches.filter((row) => !row.base);
	for (let offset = 0; offset < probes.length; offset += BRANCH_REPORT_CONCURRENCY) {
		const batch = probes.slice(offset, offset + BRANCH_REPORT_CONCURRENCY);
		await Promise.all(batch.map(async (row) => {
			const counts = await repoGit(service, status.root, unmergedCountArgv(base, row.name));
			if (counts === null) return;
			const value = Number.parseInt(counts.trim(), 10);
			if (!Number.isFinite(value)) return;
			row.unmerged = value;
			row.merged = value === 0;
		}));
	}
	const baseRow = branches.find((row) => row.base);
	if (baseRow !== void 0) baseRow.merged = true;
	return {
		root: status.root,
		branch: status.branch,
		base,
		truncated: rows.length > kept.length,
		branches
	};
}

/**
 * Read `git count-objects -v`: how many objects the repository holds and how
 * much disk the object store takes. Loose objects are reported in KiB, so a
 * tiny repository can round to zero bytes while still holding objects — the
 * object COUNT is the reliable signal, the byte figure is an estimate.
 * @param stdout - the command's output.
 */
function parseGitObjects(stdout) {
	if (stdout === null) return {
		objects: null,
		bytes: null
	};
	let kib = 0;
	let objects = 0;
	let seenSize = false;
	let seenCount = false;
	for (const line of String(stdout).split(String.fromCharCode(10))) {
		const trimmed = line.trim();
		const sizeMatch = /^(size|size-pack):\s*(\d+)$/.exec(trimmed);
		if (sizeMatch !== null) {
			kib += Number.parseInt(sizeMatch[2], 10);
			seenSize = true;
			continue;
		}
		const countMatch = /^(count|in-pack):\s*(\d+)$/.exec(trimmed);
		if (countMatch !== null) {
			objects += Number.parseInt(countMatch[2], 10);
			seenCount = true;
		}
	}
	return {
		objects: seenCount ? objects : null,
		bytes: seenSize ? kib * 1024 : null
	};
}

/**
 * The read-only health report of one repository: a detached HEAD, branches
 * that track nothing, untracked files that are large, the stash count, the
 * size of the object store and how many branches are already merged. Pure
 * information with reasons — no fixes.
 * @param service - the workspace-gated git service.
 * @param path - any path inside the repository.
 * @returns the report, or null when the path is not a repository.
 */
async function repoHealth(service, path) {
	const status = await service.status(path);
	if (status === null || status === void 0) return null;
	const root = status.root;
	const [branchStdout, stashStdout, untrackedStdout, objectsStdout] = await Promise.all([
		repoGit(service, root, branchRowsArgv()),
		repoGit(service, root, stashListArgv()),
		repoGit(service, root, untrackedArgv()),
		repoGit(service, root, ["count-objects", "-v"])
	]);
	const objects = parseGitObjects(objectsStdout);
	const rows = branchStdout === null ? [] : parseBranchRows(branchStdout);
	const noUpstream = rows.filter((row) => row.upstream === "" && !row.current).map((row) => row.name);
	const stale = rows.filter((row) => row.stale && !row.current).map((row) => row.name);
	const stash = stashStdout === null ? null : stashStdout.split("\n").filter((line) => line.trim() !== "").length;
	const untracked = untrackedStdout === null ? [] : untrackedStdout.split("\0").filter((name) => name !== "");
	const bigUntracked = [];
	for (const rel of untracked.slice(0, HEALTH_UNTRACKED_LIMIT)) {
		try {
			const info = await stat(join(root, rel));
			if (!info.isFile()) continue;
			if (info.size < HEALTH_BIG_BYTES) continue;
			bigUntracked.push({
				path: rel,
				bytes: info.size
			});
		} catch {}
	}
	bigUntracked.sort((left, right) => right.bytes - left.bytes);
	const branch = typeof status.branch === "string" ? status.branch : "";
	return {
		root,
		branch,
		detached: branch === "" || branch === DETACHED,
		dirtyFiles: status.dirtyFiles ?? 0,
		conflicts: status.conflicts ?? 0,
		operationInProgress: status.operationInProgress ?? null,
		stash,
		branches: rows.length,
		noUpstream: noUpstream.slice(0, HEALTH_UPSTREAM_LIMIT),
		noUpstreamCount: noUpstream.length,
		stale,
		untracked: untracked.length,
		untrackedScanned: Math.min(untracked.length, HEALTH_UNTRACKED_LIMIT),
		bigUntracked,
		gitObjects: objects.objects,
		gitBytes: objects.bytes,
		checkedAt: Date.now()
	};
}
//#endregion
function registerGitRoutes(ctx, service, config = defaultFeatureConfig) {
	const subscribers = /* @__PURE__ */ new Set();
	let guard;
	let heartbeatTimer;
	const removeSubscriber = (subscriber) => {
		subscriber.statusAbort?.abort(/* @__PURE__ */ new Error("git status subscriber closed"));
		subscriber.statusAbort = void 0;
		subscribers.delete(subscriber);
		if (subscribers.size === 0) {
			guard?.stop();
			guard = void 0;
			if (heartbeatTimer !== void 0) clearInterval(heartbeatTimer);
			heartbeatTimer = void 0;
		}
	};
	const push = (subscriber, payload) => {
		subscriber.res.write(`event: change\ndata: ${JSON.stringify(payload)}\n\n`);
	};
	const statusWithDeadline = async (path, controller = new AbortController()) => {
		let timeout;
		const deadline = new Promise((_, reject) => {
			timeout = setTimeout(() => {
				const error = /* @__PURE__ */ new Error(STATUS_TIMEOUT_MESSAGE);
				controller.abort(error);
				reject(error);
			}, STATUS_TIMEOUT_MS);
		});
		try {
			return await Promise.race([service.status(path, controller.signal), deadline]);
		} finally {
			if (timeout !== void 0) clearTimeout(timeout);
		}
	};
	const runPoll = async () => {
		await Promise.all([...subscribers].map(async (subscriber) => {
			const controller = new AbortController();
			subscriber.statusAbort = controller;
			try {
				const status = await statusWithDeadline(subscriber.path, controller);
				let worktreeDigest = subscriber.lastWorktreeDigest ?? "";
				try {
					const view = await service.worktrees(subscriber.path, controller.signal);
					if (view !== null) {
						worktreeDigest = view.worktrees.map((item) => `${item.path}:${item.branch}:${item.head}`).join(",");
						subscriber.lastWorktreeDigest = worktreeDigest;
					}
				} catch {}
				const key = status === null ? "no-repo" : `${status.root}|${status.branch}|${status.head}|wt:${worktreeDigest}`;
				if (key === subscriber.last) return;
				subscriber.last = key;
				push(subscriber, {
					path: subscriber.path,
					status
				});
			} catch (error) {
				if (subscribers.has(subscriber)) ctx.logger.warn(`dsh-git-graph: status poll failed for ${subscriber.path}: ${String(error)}`);
			} finally {
				if (subscriber.statusAbort === controller) subscriber.statusAbort = void 0;
			}
		}));
	};
	const handler = async (req, res) => {
		if (!isGitAllowed(ctx, req)) {
			writeJson(res, 403, { error: "forbidden: loopback-only" });
			return;
		}
		if (req.method !== "POST") {
			res.writeHead(405);
			res.end();
			return;
		}
		if (!(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
			res.writeHead(415);
			res.end();
			return;
		}
		const pathname = new URL(req.url ?? "/", "http://x").pathname;
		const payload = await readJsonBody(req, { maxBytes: 1024 * 1024 });
		if (pathname === "/git/config") {
			const view = config();
			writeJson(res, 200, isGitFeatureConfig(view) ? OK(view) : FAIL(MALFORMED_VIEW));
			return;
		}
		const path = pathOf(payload);
		if (path === null) {
			writeJson(res, 200, FAIL(BAD_REQUEST));
			return;
		}
		switch (pathname) {
			case "/git/status":
				try {
					okView(res, await statusWithDeadline(path), isRepoStatus);
				} catch (error) {
					ctx.logger.warn(`dsh-git-graph: status request failed for ${path}: ${String(error)}`);
					writeJson(res, 200, FAIL({
						code: "internal",
						message: STATUS_TIMEOUT_MESSAGE
					}));
				}
				return;
			case "/git/branches":
				okView(res, await service.branches(path), isBranchesView);
				return;
			case "/git/graph": {
				const rawLimit = typeof payload === "object" && payload !== null ? payload.limit : void 0;
				const limit = typeof rawLimit === "number" && rawLimit > 0 ? Math.min(rawLimit, 1e3) : void 0;
				okView(res, await service.graph(path, limit), isGraphView);
				return;
			}
			case "/git/switch": {
				const branch = typeof payload === "object" && payload !== null ? payload.branch : void 0;
				if (typeof branch !== "string" || branch === "") {
					writeJson(res, 200, FAIL(BAD_REQUEST));
					return;
				}
				const result = await service.switchBranch(path, branch);
				writeJson(res, 200, result.ok ? OK({ branch: result.branch }) : FAIL(isGitError(result.error) ? result.error : MALFORMED_VIEW));
				return;
			}
			case "/git/create-branch": {
				const name = typeof payload === "object" && payload !== null ? payload.name : void 0;
				if (typeof name !== "string" || name === "") {
					writeJson(res, 200, FAIL(BAD_REQUEST));
					return;
				}
				const result = await service.createBranch(path, name);
				writeJson(res, 200, result.ok ? OK({ branch: result.branch }) : FAIL(isGitError(result.error) ? result.error : MALFORMED_VIEW));
				return;
			}
			case "/git/worktrees":
				okView(res, await service.worktrees(path), isWorktreeListView);
				return;
			case "/git/worktree-add": {
				const record = typeof payload === "object" && payload !== null ? payload : {};
				const name = record.name;
				const baseRef = record.baseRef;
				if (typeof name !== "string" || name === "" || baseRef !== void 0 && typeof baseRef !== "string") {
					writeJson(res, 200, FAIL(BAD_REQUEST));
					return;
				}
				const result = await service.addWorktree(path, name, baseRef);
				writeJson(res, 200, result.ok ? OK({
					path: result.path,
					branch: result.branch,
					name: result.name
				}) : FAIL(isGitError(result.error) ? result.error : MALFORMED_VIEW));
				return;
			}
			case "/git/worktree-remove": {
				const record = typeof payload === "object" && payload !== null ? payload : {};
				const worktreePath = record.worktreePath;
				if (typeof worktreePath !== "string" || worktreePath === "") {
					writeJson(res, 200, FAIL(BAD_REQUEST));
					return;
				}
				const result = await service.removeWorktree(path, worktreePath, {
					force: record.force === true,
					deleteBranch: record.deleteBranch === true
				});
				writeJson(res, 200, result.ok ? OK({ removed: true }) : FAIL(isGitError(result.error) ? result.error : MALFORMED_VIEW));
				return;
			}
			case "/git/repos": {
				const refresh = payload !== null && typeof payload === "object" && payload.refresh === true;
				const feature = featureOf(config);
				const gated = await createWorkspaceGate(ctx)(path);
				if (!gated.ok) {
					writeJson(res, 200, FAIL(gated.error));
					return;
				}
				try {
					writeJson(res, 200, OK(await repoScanCached(path, service, refresh, feature.docName, feature.autoScaffold)));
				} catch (error) {
					ctx.logger.warn("dsh-git-graph: repository scan failed for " + path + ": " + String(error));
					writeJson(res, 200, FAIL({
						code: "internal",
						message: "repository scan failed"
					}));
				}
				return;
			}
			case "/git/cleanup": {
				const gated = await createWorkspaceGate(ctx)(path);
				if (!gated.ok) {
					writeJson(res, 200, FAIL(gated.error));
					return;
				}
				const report = await branchReport(service, gated.canonical);
				if (report === null) {
					writeJson(res, 200, FAIL(MALFORMED_VIEW));
					return;
				}
				writeJson(res, 200, OK(report));
				return;
			}
			case "/git/health": {
				const gated = await createWorkspaceGate(ctx)(path);
				if (!gated.ok) {
					writeJson(res, 200, FAIL(gated.error));
					return;
				}
				const report = await repoHealth(service, gated.canonical);
				if (report === null) {
					writeJson(res, 200, FAIL(MALFORMED_VIEW));
					return;
				}
				writeJson(res, 200, OK(report));
				return;
			}
			case "/git/init": {
				const gated = await createWorkspaceGate(ctx)(path);
				if (!gated.ok) {
					writeJson(res, 200, FAIL(gated.error));
					return;
				}
				const requested = payload !== null && typeof payload === "object" && typeof payload.branch === "string" ? payload.branch : void 0;
				const created = await repoInit(service, gated.canonical, requested);
				if (!created.ok) {
					writeJson(res, 200, FAIL(created.error));
					return;
				}
				repoScanCache.clear();
				ctx.logger.info("dsh-git-graph: initialized repository at " + created.value.root);
				writeJson(res, 200, OK(created.value));
				return;
			}
			case "/git/compliance": {
				const gated = await createWorkspaceGate(ctx)(path);
				if (!gated.ok) {
					writeJson(res, 200, FAIL(gated.error));
					return;
				}
				const feature = featureOf(config);
				const snapshot = await service.rootAndHead(gated.canonical).catch(() => null);
				if (snapshot === null || typeof snapshot.root !== "string") {
					writeJson(res, 200, FAIL(MALFORMED_VIEW));
					return;
				}
				const report = await commitCompliance(service, snapshot.root, feature.docName);
				writeJson(res, 200, OK(report));
				return;
			}
			case "/git/convention/preview": {
				const gated = await createWorkspaceGate(ctx)(path);
				if (!gated.ok) {
					writeJson(res, 200, FAIL(gated.error));
					return;
				}
				const feature = featureOf(config);
				const snapshot = await service.rootAndHead(gated.canonical).catch(() => null);
				if (snapshot === null || typeof snapshot.root !== "string") {
					writeJson(res, 200, FAIL(MALFORMED_VIEW));
					return;
				}
				const framework = payload !== null && typeof payload === "object" && typeof payload.framework === "string" ? payload.framework : null;
				const flags = payload !== null && typeof payload === "object" ? payload : {};
				const preview = await conventionPreview(snapshot.root, feature.docName, framework, flags.strict, flags.language, flags.ai);
				if (!preview.ok) {
					writeJson(res, 200, FAIL(preview.error));
					return;
				}
				writeJson(res, 200, OK(preview.value));
				return;
			}
			case "/git/workspace-convention": {
				const gated = await createWorkspaceGate(ctx)(path);
				if (!gated.ok) {
					writeJson(res, 200, FAIL(gated.error));
					return;
				}
				const feature = featureOf(config);
				const action = payload !== null && typeof payload === "object" && typeof payload.action === "string" ? payload.action : "state";
				const framework = payload !== null && typeof payload === "object" && typeof payload.framework === "string" ? payload.framework : null;
				const force = payload !== null && typeof payload === "object" && payload.force === true;
				const policy = payload !== null && typeof payload === "object" ? payload : {};
				const result = await workspaceConvention(gated.canonical, feature.docName, action, framework, force, policy.strict, policy.language, policy.ai);
				if (!result.ok) {
					writeJson(res, 200, FAIL(result.error));
					return;
				}
				if (action === "write") ctx.logger.info("dsh-git-graph: wrote workspace document " + result.value.docPath);
				writeJson(res, 200, OK(result.value));
				return;
			}
			case "/git/conventions/conflicts": {
			const gated = await createWorkspaceGate(ctx)(path);
			if (!gated.ok) {
				writeJson(res, 200, FAIL(gated.error));
				return;
			}
			const feature = featureOf(config);
			writeJson(res, 200, OK(conventionsConflicts(gated.canonical, feature.docName)));
			return;
		}
		case "/git/conventions/consolidate": {
			const gated = await createWorkspaceGate(ctx)(path);
			if (!gated.ok) {
				writeJson(res, 200, FAIL(gated.error));
				return;
			}
			const feature = featureOf(config);
			const policy = payload !== null && typeof payload === "object" ? payload : {};
			const merged = await conventionsConsolidate(gated.canonical, feature.docName, {
				write: policy.write === true,
				force: policy.force === true
			});
			if (!merged.ok) {
				writeJson(res, 200, FAIL(merged.error));
				return;
			}
			if (merged.value.written === true) ctx.logger.info("dsh-git-graph: consolidated " + merged.value.docPath);
			writeJson(res, 200, OK(merged.value));
			return;
		}
		case "/git/conventions": {
				const gated = await createWorkspaceGate(ctx)(path);
				if (!gated.ok) {
					writeJson(res, 200, FAIL(gated.error));
					return;
				}
				const feature = featureOf(config);
				const snapshot = await service.rootAndHead(gated.canonical).catch(() => null);
				const rootPath = snapshot !== null && typeof snapshot.root === "string" ? snapshot.root : gated.canonical;
				const state = await repoConventionState(rootPath, feature.docName);
				writeJson(res, 200, OK({
					root: rootPath,
					...state,
					autoScaffold: feature.autoScaffold,
					catalog: conventionCatalog()
				}));
				return;
			}
			case "/git/convention/settings": {
				const gated = await createWorkspaceGate(ctx)(path);
				if (!gated.ok) {
					writeJson(res, 200, FAIL(gated.error));
					return;
				}
				const feature = featureOf(config);
				const snapshot = await service.rootAndHead(gated.canonical).catch(() => null);
				if (snapshot === null || typeof snapshot.root !== "string") {
					writeJson(res, 200, FAIL({
						code: "not-a-repository",
						message: "path is not a git repository"
					}));
					return;
				}
				const policy = payload !== null && typeof payload === "object" ? payload : {};
				const updated = await conventionSettings(snapshot.root, feature.docName, policy.strict, policy.language, policy.ai);
				if (!updated.ok) {
					writeJson(res, 200, FAIL(updated.error));
					return;
				}
				ctx.logger.info("dsh-git-graph: updated the convention switches in " + updated.value.docPath);
				writeJson(res, 200, OK(updated.value));
				return;
			}
			case "/git/convention": {
				const gated = await createWorkspaceGate(ctx)(path);
				if (!gated.ok) {
					writeJson(res, 200, FAIL(gated.error));
					return;
				}
				const feature = featureOf(config);
				const snapshot = await service.rootAndHead(gated.canonical).catch(() => null);
				if (snapshot === null || typeof snapshot.root !== "string") {
					writeJson(res, 200, FAIL({
						code: "not-a-repository",
						message: "path is not a git repository"
					}));
					return;
				}
				const framework = payload !== null && typeof payload === "object" && typeof payload.framework === "string" ? payload.framework : null;
				const policy = payload !== null && typeof payload === "object" ? payload : {};
				const body = conventionBodyOf(framework, basename(snapshot.root), policy.strict, policy.language, policy.ai);
				if (body === undefined) {
					writeJson(res, 200, FAIL({
						code: "convention-unknown-framework",
						message: "unknown convention framework"
					}));
					return;
				}
				const written = await repoWriteConvention(snapshot.root, feature.docName, body, {
					force: payload !== null && typeof payload === "object" && payload.force === true
				});
				if (!written.ok) {
					writeJson(res, 200, FAIL(written.error));
					return;
				}
				ctx.logger.info("dsh-git-graph: wrote " + written.value.docPath + " (" + (framework ?? "scaffold") + ")");
				writeJson(res, 200, OK({
					...written.value,
					framework: framework ?? "none",
					doc: feature.docName
				}));
				return;
			}
			default:
				res.writeHead(404);
				res.end();
		}
	};
	const sse = (req, res) => {
		if (!isGitAllowed(ctx, req)) {
			writeJson(res, 403, { error: "forbidden: loopback-only" });
			return;
		}
		const path = new URL(req.url ?? "/", "http://x").searchParams.get("path");
		if (path === null || path === "") {
			res.writeHead(400);
			res.end();
			return;
		}
		res.writeHead(200, {
			"content-type": "text/event-stream; charset=utf-8",
			"cache-control": "no-cache",
			connection: "keep-alive"
		});
		res.write("retry: 2000\n\n");
		const subscriber = {
			path,
			last: "",
			res
		};
		subscribers.add(subscriber);
		res.on("error", () => {
			removeSubscriber(subscriber);
		});
		if (guard === void 0) guard = new PollGuard({
			intervalMs: POLL_INTERVAL_MS,
			deadlineMs: POLL_LIFETIME_MS,
			maxBackoffMs: POLL_INTERVAL_MS,
			onRun: runPoll
		});
		guard.start();
		if (heartbeatTimer === void 0) heartbeatTimer = setInterval(() => {
			for (const current of subscribers) current.res.write(": ping\n\n");
		}, HEARTBEAT_INTERVAL_MS);
		req.on("close", () => {
			removeSubscriber(subscriber);
		});
	};
	const disposers = [ctx.webServer.register({
		kind: "prefix",
		path: "/git",
		handler
	}), ctx.webServer.register({
		kind: "exact",
		path: "/git/events",
		handler: sse
	})];
	return () => {
		for (const dispose of disposers) dispose();
		guard?.stop();
		if (heartbeatTimer !== void 0) clearInterval(heartbeatTimer);
		for (const subscriber of subscribers) {
			subscriber.statusAbort?.abort(/* @__PURE__ */ new Error("git status routes disposed"));
			subscriber.res.end();
		}
		subscribers.clear();
	};
}
//#endregion
//#region src/host/agent-tool.ts
/** The registered tool name. */
const GIT_WORKTREE_TOOL = "git_worktree";
/** Resolve the calling session's project cwd from the execution identity. */
function callingCwd(exec) {
	const cwd = exec.agent?.session?.header?.cwd;
	return typeof cwd === "string" && cwd !== "" ? cwd : void 0;
}
/**
* Build the tool definition bound to one service instance. The definition is
* a plain literal (no defineTool): arguments arrive frozen and are narrowed
* here, business rejections return `ok: false` values so the model can react.
* @param ctx - host context (workspace registry for create/remove linkage).
* @param service - the workspace-gated git service.
*/
function buildWorktreeTool(ctx, service) {
	return {
		name: GIT_WORKTREE_TOOL,
		description: [
			"Manage isolated git worktrees of the current session's repository.",
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
					enum: [
						"create",
						"list",
						"remove"
					],
					description: "The worktree operation to perform."
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
			if (cwd === void 0) return {
				ok: false,
				code: "workspace-unknown",
				message: "git_worktree needs a calling session with a project cwd"
			};
			switch (input.action) {
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
					const baseRef = typeof input.baseRef === "string" && input.baseRef.trim() !== "" ? input.baseRef : void 0;
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
					if (linked !== void 0) await ctx.workspaceRegistry.delete(linked.id);
					return {
						ok: true,
						removed: input.worktreePath
					};
				}
				default: return {
					ok: false,
					code: "internal",
					message: "action must be one of 'create', 'list', 'remove'"
				};
			}
		}
	};
}
//#endregion
//#region src/mount-once.ts
/**
* Host single-instance guard shared by the plugin family. The family bundle
* (dsh-web-all / dsh-skins) namespaces every child row id (web-ui-*), so
* the loader accepts a standalone install of the same package side by side;
* without this guard the second instance would still re-register the same
* webserver routes, tools, settings namespaces, and system-prompt sections
* and fail the boot. mountOnce makes a mount of an already-mounted package a
* no-op for as long as the first instance lives (the browser half is already
* deduped by package name in the client module host).
*
* A no-op is only safe while the holder is ALIVE. The holder can be disposed
* long after the refused mount ran its course: the Host reloads a profile by
* creating the new loader entries before the old ones are torn down (a
* plugin-manager enable/disable/install write, a settings-driven row reload,
* HMR), so the new aggregate shell entry mounts its family plugin while the
* previous entry still owns the name. Dropping that refused mount lost the
* plugin for good - the previous entry then disposed its own mount, releasing
* the name with nobody left to take it, and the family row stayed listed as
* active while its host routes 404ed (the task-board panel showed
* "board.hostError.notMounted", no degraded record appeared, and only a Host
* restart recovered it).
*
* The refused mount is therefore QUEUED, not dropped, and replayed the moment
* the holder releases the name - if the waiting fiber is still alive then. The
* single-instance guarantee is unchanged: exactly one mount is live per
* package name, and the replay re-enters the guard so a later mount still
* dedupes against it.
*
* The registry rides a global symbol so two module instances of the same
* package (npm copy vs repository link) still share one verdict. That symbol
* is a CROSS-REPOSITORY contract, not this file's private state: the four
* satellite packages (dsh-skins / dsh-pet / dsh-presets /
* dsh-community-plugins) are separate repositories carrying their own copy of
* this guard, rebuilt on their own schedule, so the value under `MOUNTED`
* must keep the shape every published copy reads (a `Set` of package names
* with `has`/`add`/`delete`). The wait queues this guard added therefore live
* under their own additive key, and the registry reads back a `Set` even when
* some other build left a different value there. Changing `MOUNTED`'s shape
* in place broke that contract once: a satellite's legacy copy created a
* `Set`, the family's new copy read it as a `Map`, and every family row
* mounted after it failed with "claims.get is not a function".
*
* cordis `ctx.effect` runs its callback immediately and treats the callback's
* return value as the fiber disposer, so the unmarker is returned, not run.
*/
/** Published cross-repository contract: package names currently mounted. */
const MOUNTED = Symbol.for("dsh-web.mounted-plugins");
/** Additive key this guard owns: refused mounts waiting for the name. */
const WAITERS = Symbol.for("dsh-web.mounted-plugins.waiters");
/**
* The shared name registry, always a `Set` whatever another build stored here:
* a foreign value (an interim shape, a hand-written global) must not take every
* family plugin down with it.
* @returns the process-wide set of mounted package names.
*/
function mountedSet() {
	const registry = globalThis;
	const existing = registry[MOUNTED];
	if (existing instanceof Set) return existing;
	const created = /* @__PURE__ */ new Set();
	registry[MOUNTED] = created;
	return created;
}
/** Queue per package name for mounts refused while a holder was alive. */
function mountWaiters() {
	const registry = globalThis;
	return registry[WAITERS] ??= /* @__PURE__ */ new Map();
}
/**
* Wrap a cordis plugin apply so the package runs at most once per process.
* The first mount registers normally and releases the name when its fiber
* disposes; a mount refused while that name is held waits for the release and
* then runs, unless its own fiber disposes first.
* @param packageName - npm package identity shared by every install source.
* @param fn - the original plugin apply.
* @returns an apply of the same shape.
*/
function mountOnce(packageName, fn) {
	const mount = (...args) => {
		const mounted = mountedSet();
		const ctx = args[0];
		if (mounted.has(packageName)) {
			const waiters = mountWaiters();
			const queue = waiters.get(packageName) ?? [];
			let alive = true;
			const pending = { run: () => {
				if (alive) mount(...args);
			} };
			ctx?.effect?.(() => () => {
				alive = false;
				const index = queue.indexOf(pending);
				if (index >= 0) queue.splice(index, 1);
			});
			queue.push(pending);
			waiters.set(packageName, queue);
			return;
		}
		mounted.add(packageName);
		ctx?.effect?.(() => () => {
			mounted.delete(packageName);
			const waiters = mountWaiters();
			const queue = waiters.get(packageName);
			if (queue === void 0) return;
			waiters.delete(packageName);
			for (const waiter of queue.splice(0)) queueMicrotask(() => {
				waiter.run();
			});
		});
		return fn(...args);
	};
	return mount;
}
//#endregion
//#region src/index.ts
/**
* dsh-git-graph-sidebar — host half: the workspace-gated git
* service and its /git/* HTTP routes (JSON operations + SSE change stream)
* on the shared webserver, plus the opt-in model-facing git_worktree tool.
* The browser half (exports "./client") is served by client-modules from
* the same package's dsh.client declaration.
*
* The UI-triggered git verbs (switch/create-branch/worktree operations) own
* no model-visible surface. The git_worktree tool is the deliberate,
* settings-gated exception (agentTool, default off): while enabled, agents
* may create/list/remove managed worktrees of their calling session's
* repository.
* @module dsh-git-graph-sidebar
*/
/** Required services: the route registry, the managed subprocess seam, and the workspace registry. */
const inject = [
	"webServer",
	"subprocess",
	"workspaceRegistry"
];
/**
* Path identity shared by the gate and the repository scanner: forward
* slashes, no trailing separator, case-folded on Windows (whose filesystems
* are case-insensitive).
*/
function gatePathKey(path) {
	let value = String(path).replace(/\\/g, "/");
	while (value.length > 1 && value.endsWith("/")) value = value.slice(0, -1);
	return process.platform === "win32" ? value.toLowerCase() : value;
}
/**
* The workspace-membership gate: canonicalize the requested path and require
* it to be a registered workspace root or any directory beneath one. A
* multi-repository workspace legitimately runs git in nested repository
* directories, so membership is a prefix test on canonical paths — the
* browser still cannot reach anything outside the registered workspaces.
* @param ctx - context carrying the workspace registry.
* @returns the gate the git service consults before every command.
*/
function createWorkspaceGate(ctx) {
	return async (path) => {
		let canonical;
		try {
			canonical = await realpath(path);
		} catch {
			return {
				ok: false,
				error: {
					code: "workspace-unknown",
					message: "path does not resolve on disk"
				}
			};
		}
		const requested = gatePathKey(canonical);
		const member = ctx.workspaceRegistry.list().some((workspace) => {
			const root = gatePathKey(workspace.path);
			if (root === "") return false;
			return requested === root || requested.startsWith(root === "/" ? "/" : root + "/");
		});
		if (member) return {
			ok: true,
			canonical
		};
		return {
			ok: false,
			error: {
				code: "workspace-unknown",
				message: "path is not inside a registered workspace"
			}
		};
	};
}
/**
* Mount the git service, its routes, and the opt-in tool. The settings page
* is the Host's own generation from {@link Config}: this half registers no
* settings section.
* @param ctx - context carrying webServer, subprocess, and workspaceRegistry.
* @param config - the row's config as the Host resolved it (live references).
*/
const apply = mountOnce("dsh-git-graph-sidebar", applyImpl);
function applyImpl(ctx, config) {
	const service = new GitService(subprocessRunner(ctx), createWorkspaceGate(ctx));
	const featureConfig = () => {
		const active = effectiveConfig(config);
		return {
			autoIsolate: active.autoIsolate,
			autoBaseline: active.autoBaseline,
			worktreesHome: worktreesHome(),
			conventionsDoc: active.conventionsDoc,
			conventionsAuto: active.conventionsAuto
		};
	};
	let toolFiber;
	const syncTool = () => {
		const want = effectiveConfig(config).agentTool;
		if (want && toolFiber === void 0) toolFiber = ctx.inject(["tools"], (toolCtx) => {
			toolCtx.effect(() => toolCtx.tools.register(buildWorktreeTool(ctx, service)), "dsh-git-graph: git_worktree tool");		toolCtx.effect(() => toolCtx.tools.register(buildConventionsTool(featureConfig)), "dsh-git-graph: git_conventions tool");
		});
		else if (!want && toolFiber !== void 0) {
			toolFiber.dispose();
			toolFiber = void 0;
		}
	};
	ctx.effect(() => {
		const dispose = ctx.on("loader/volatile-update", (paths) => {
			if (paths.some((path) => path[0] === "agentTool")) syncTool();
		});
		return () => {
			dispose();
		};
	}, "dsh-git-graph: settings-committed tool sync");
	conventionsPromptMount(ctx, featureConfig);
	ctx.effect(() => {
		syncTool();
		const disposeRoutes = registerGitRoutes(ctx, service, featureConfig);
		return () => {
			disposeRoutes();
			toolFiber?.dispose();
			toolFiber = void 0;
		};
	}, "dsh-git-graph: /git routes + tool");
}
//#endregion
export { Config, apply, inject };
