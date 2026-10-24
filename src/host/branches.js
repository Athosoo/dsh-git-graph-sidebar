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
const REPO_AUGMENT_CONCURRENCY = 4;
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

/** `git rev-parse --abbrev-ref --symbolic-full-name @{upstream}` — the tracking ref. */
const upstreamNameArgv = () => [
	"rev-parse",
	"--abbrev-ref",
	"--symbolic-full-name",
	"@{upstream}"
];

/** `git rev-list --left-right --count HEAD...@{upstream}` — ahead, then behind. */
const upstreamCountArgv = () => [
	"rev-list",
	"--left-right",
	"--count",
	"HEAD...@{upstream}"
];

/** `git log -1 --format=%ct` — the tip commit time, in seconds. */
const lastCommitArgv = () => ["log", "-1", "--format=%ct"];

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

/** Tip commit time of one repository, in seconds; null when it has no commits. */
async function repoActivity(service, root) {
	const stdout = await repoGit(service, root, lastCommitArgv());
	if (stdout === null) return null;
	const stamp = Number.parseInt(stdout.trim(), 10);
	return Number.isFinite(stamp) ? stamp : null;
}

/**
 * The branch's upstream and how far apart the two are; null when the branch
 * tracks nothing (no remote, or a local-only branch).
 * @param service - the workspace-gated git service.
 * @param root - repository root to run in.
 */
async function repoUpstream(service, root) {
	const name = await repoGit(service, root, upstreamNameArgv());
	if (name === null) return null;
	const label = name.trim();
	if (label === "") return null;
	const counts = await repoGit(service, root, upstreamCountArgv());
	if (counts === null) return null;
	const [ahead = "0", behind = "0"] = counts.trim().split(/\s+/);
	return {
		name: label,
		ahead: Number.parseInt(ahead, 10) || 0,
		behind: Number.parseInt(behind, 10) || 0
	};
}

/**
 * Fill in the overview fields of scanned repositories: last activity and the
 * upstream distance. Bounded concurrency, one repository per slot; a failing
 * probe leaves its field null instead of failing the scan.
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
			const [activity, upstream] = await Promise.all([repoActivity(service, entry.root), repoUpstream(service, entry.root)]);
			entry.activity = activity;
			entry.upstream = upstream;
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
