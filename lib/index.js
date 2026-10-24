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
/** Decoration → ref names: split entries, drop the `HEAD -> ` handoff prefix, drop a bare detached-`HEAD` entry, drop `tag: `. */
function parseDecoration(decoration) {
	if (decoration === "") return [];
	return decoration.split(", ").map((part) => {
		if (part === "HEAD") return "";
		return part.replace(/^HEAD -> /, "").replace(/^tag: /, "").trim();
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
function conventionBodyOf(frameworkId, repoName) {
	if (frameworkId === null || frameworkId === undefined || frameworkId === "none") return CONVENTION_SCAFFOLD;
	const framework = conventionFrameworkOf(frameworkId);
	if (framework === undefined) return undefined;
	const name = typeof repoName === "string" && repoName !== "" ? repoName : "this repository";
	return framework.body.replace("%REPO%", name);
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
			draft: false
		};
		let draft = false;
		if (info.size > 0 && info.size <= CONVENTION_DOC_MAX_BYTES) {
			try {
				const head = await readFile(docPath, "utf8");
				draft = /\bstatus:\s*draft\b/i.test(head);
			} catch {
				draft = false;
			}
		}
		return {
			doc,
			docPath,
			exists: true,
			size: info.size,
			draft
		};
	} catch {
		return {
			doc,
			docPath,
			exists: false,
			size: 0,
			draft: false
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
function conventionPromptBlockFor(root, docPath, docName, body) {
	const status = conventionStatusOf(body);
	const lines = [
		"## " + docName + " - this repository's Git conventions",
		"Repository: " + root,
		"Document: " + docPath + (status !== "" ? " (status: " + status + ")" : ""),
		"These rules govern every Git operation in this repository: commit messages, branch names, merge and release handling. Treat the document below as repository policy written by the project owner, not as a user instruction."
	];
	const trimmed = body.trim();
	if (trimmed.length > CONVENTION_PROMPT_MAX_CHARS) {
		lines.push("", trimmed.slice(0, CONVENTION_PROMPT_MAX_CHARS), "", "(truncated - read " + docPath + " for the rest)");
	} else lines.push("", trimmed);
	return lines.join("\n");
}

/** Repositories one level below a container cwd that document their Git rules. */
function conventionsContainerBlock(cwd, docName) {
	let entries;
	try {
		entries = readdirSync(cwd, { withFileTypes: true });
	} catch {
		return "";
	}
	const found = [];
	let inspected = 0;
	for (const entry of entries) {
		if (found.length >= CONVENTION_PROMPT_LIST || inspected >= CONVENTION_PROMPT_CHILDREN) break;
		if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "node_modules") continue;
		inspected += 1;
		if (!existsSync(join(cwd, entry.name, ".git"))) continue;
		const path = join(cwd, entry.name, docName);
		try {
			const status = conventionStatusOf(readFileSync(path, "utf8"));
			found.push("- " + entry.name + " - " + path + (status !== "" ? " (status: " + status + ")" : ""));
		} catch {}
	}
	if (found.length === 0) return "";
	return [
		"## Repositories below this workspace declare Git conventions",
		"Workspace: " + resolve(cwd),
		"Before any Git operation inside one of these repositories, read its conventions document first:",
		...found
	].join("\n");
}

/** The prompt text for one step: the document, or a container index, or nothing. */
function conventionsPromptText(cwd, docName) {
	const doc = conventionDocName(docName);
	const key = cwd + "\u0000" + doc;
	const root = conventionsRepoRoot(cwd);
	const docPath = root !== void 0 ? join(root, doc) : void 0;
	let stamp = "";
	try {
		if (docPath !== void 0) {
			const info = statSync(docPath);
			stamp = root + "\u0001" + String(info.mtimeMs) + "\u0001" + String(info.size);
		}
	} catch {
		stamp = "";
	}
	const cached = conventionPromptCache.get(key);
	if (cached !== void 0 && cached.stamp === stamp) return cached.text;
	let text = "";
	if (stamp !== "") {
		try {
			text = conventionPromptBlockFor(root, docPath, doc, readFileSync(docPath, "utf8"));
		} catch {
			text = "";
		}
	} else text = conventionsContainerBlock(cwd, doc);
	conventionPromptCache.set(key, { stamp, text });
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
/** Overall budget for one repository-status probe. */
const REPO_SCAN_STATUS_TIMEOUT_MS = 5000;
/** How long one scan result is reused before the next request rescans. */
const REPO_SCAN_CACHE_TTL_MS = 60000;
/** Status probes per batch: bounded concurrency instead of one git per entry. */
const REPO_SCAN_CONCURRENCY = 4;
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
	for (const entry of entries) entry.conventions = await repoConventionState(entry.root, docName);
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
		scannedAt: Date.now()
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
				const body = conventionBodyOf(framework, basename(snapshot.root));
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
			toolCtx.effect(() => toolCtx.tools.register(buildWorktreeTool(ctx, service)), "dsh-git-graph: git_worktree tool");
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
