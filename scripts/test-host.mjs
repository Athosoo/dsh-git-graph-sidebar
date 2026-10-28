#!/usr/bin/env node
/**
 * Offline end-to-end test for the host half: mounts the real plugin bundle
 * against a fake Cordis context (one registered workspace, a real git
 * subprocess service built on node:child_process) and drives the `/git/*`
 * routes exactly like the browser does.
 *
 * This is how a host change can be verified without restarting DSH — the
 * bundle is imported from `lib/index.js`, so whatever the routes will do after
 * the next restart is what this script tests.
 *
 *   node scripts/test-host.mjs
 */
import { spawn } from "node:child_process";
import { appendFile, mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const checks = [];
function check(name, ok, detail) {
	checks.push({ name, ok });
	console.log((ok ? "  ok   " : "  FAIL ") + name + (detail === undefined || ok ? "" : "  -> " + detail));
}
function equal(name, actual, expected) {
	check(name, actual === expected, "got " + JSON.stringify(actual) + ", want " + JSON.stringify(expected));
}

/** The subprocess service contract, backed by a real child process. */
function fakeSubprocess() {
	return { spawn(spec) {
		const child = spawn(spec.argv[0], spec.argv.slice(1), {
			cwd: spec.cwd,
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true
		});
		let out = "";
		let err = "";
		child.stdout.on("data", (chunk) => { out += chunk.toString("utf8"); });
		child.stderr.on("data", (chunk) => { err += chunk.toString("utf8"); });
		const done = new Promise((resolve) => {
			child.on("close", (code) => resolve({ exitCode: code === null ? -1 : code }));
			child.on("error", () => resolve({ exitCode: -1 }));
		});
		return {
			done,
			collected: {
				stdout: { readFrom: () => ({ text: out }) },
				stderr: { readFrom: () => ({ text: err }) }
			}
		};
	} };
}

/** One fake HTTP response that records status, headers and body. */
function fakeResponse() {
	const res = {
		statusCode: 0,
		headers: {},
		body: "",
		ended: false,
		writeHead(code, headers) {
			res.statusCode = code;
			Object.assign(res.headers, headers ?? {});
			return res;
		},
		write(chunk) {
			res.body += String(chunk);
			return true;
		},
		end(chunk) {
			if (chunk !== undefined) res.body += String(chunk);
			res.ended = true;
			return res;
		},
		on() {
			return res;
		},
		destroy() {
			res.ended = true;
		}
	};
	return res;
}

/** One fake HTTP request: loopback socket, loopback Host, JSON body. */
function fakeRequest(pathname, payload) {
	const body = JSON.stringify(payload ?? {});
	const headers = {
		host: "127.0.0.1:1234",
		"content-type": "application/json"
	};
	return {
		method: "POST",
		url: pathname,
		headers,
		socket: { remoteAddress: "127.0.0.1" },
		async *[Symbol.asyncIterator]() {
			yield Buffer.from(body, "utf8");
		},
		on() {},
		destroy() {}
	};
}

async function git(cwd, ...args) {
	await new Promise((resolve, reject) => {
		const child = spawn("git", args, { cwd, stdio: "ignore", windowsHide: true });
		child.on("close", (code) => (code === 0 ? resolve() : reject(new Error("git " + args.join(" ") + " exited " + code))));
		child.on("error", reject);
	});
}

async function main() {
	const workspace = await mkdtemp(join(tmpdir(), "gitgraph-conventions-"));
	const emptyRepo = join(workspace, "repos", "empty");
	const commitRepo = join(workspace, "repos", "with-commits");
	const plainDir = join(workspace, "repos", "plain");
	await mkdir(emptyRepo, { recursive: true });
	await mkdir(commitRepo, { recursive: true });
	await mkdir(plainDir, { recursive: true });
	await git(emptyRepo, "init", "-b", "main");
	await git(commitRepo, "init", "-b", "main");
	await writeFile(join(commitRepo, "README.md"), "# demo\n", "utf8");
	await git(commitRepo, "add", ".");
	await git(commitRepo, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "chore: initial");

	const routes = [];
	const injected = [];
	const ctx = {
		logger: { info() {}, warn() {}, error() {}, debug() {} },
		subprocess: fakeSubprocess(),
		workspaceRegistry: { list: () => [{ path: workspace }] },
		webServer: {
			register(route) {
				routes.push(route);
				return () => {};
			}
		},
		effect(fn) {
			const disposer = fn();
			return () => {
				if (typeof disposer === "function") disposer();
			};
		},
		on() {
			return () => {};
		},
		inject(deps, callback) {
			injected.push({ deps, callback });
			return { dispose() {} };
		},
		get() {
			return undefined;
		}
	};

	const { apply } = await import(new URL("../lib/index.js", import.meta.url).href);
	apply(ctx, {});

	const prefix = routes.find((route) => route.kind === "prefix" && route.path === "/git");
	if (prefix === undefined) throw new Error("no /git prefix route registered (" + routes.length + " routes)");
	check("mounts the /git prefix route", true);

	const call = async (pathname, payload) => {
		const res = fakeResponse();
		await prefix.handler(fakeRequest(pathname, payload), res);
		let json;
		try {
			json = JSON.parse(res.body);
		} catch {
			json = undefined;
		}
		return { status: res.statusCode, json, raw: res.body };
	};

	console.log("\n[1] /git/repos carries the convention state");
	const scan = await call("/git/repos", { path: workspace, refresh: true });
	check("/git/repos ok", scan.json?.ok === true, scan.raw.slice(0, 200));
	const repos = scan.json?.value?.repos ?? [];
	equal("finds two repositories (plain dir is not one)", repos.length, 2);
	equal("scan advertises the document name", scan.json?.value?.conventions?.doc, "GIT_CONVENTIONS.md");
	equal("scan advertises auto scaffold", scan.json?.value?.conventions?.autoScaffold, true);
	const emptyEntry = repos.find((entry) => entry.relPath === "repos/empty");
	const commitEntry = repos.find((entry) => entry.relPath === "repos/with-commits");
	check("empty repository has no head", emptyEntry !== undefined && emptyEntry.status !== null && emptyEntry.status.head === "", JSON.stringify(emptyEntry?.status ?? null));
	check("empty repository has no convention document", emptyEntry?.conventions?.exists === false, JSON.stringify(emptyEntry?.conventions ?? null));
	check("empty repository reports its document path", String(emptyEntry?.conventions?.docPath ?? "").replace(/\\/g, "/").endsWith("/repos/empty/GIT_CONVENTIONS.md"), emptyEntry?.conventions?.docPath);
	check("repository with commits keeps its head", typeof commitEntry?.status?.head === "string" && commitEntry.status.head.length > 0, JSON.stringify(commitEntry?.status ?? null));

	console.log("\n[2] /git/conventions exposes the catalogue");
	const state = await call("/git/conventions", { path: emptyRepo });
	check("/git/conventions ok", state.json?.ok === true, state.raw.slice(0, 200));
	equal("document does not exist yet", state.json?.value?.exists, false);
	equal("catalogue ships six frameworks", state.json?.value?.catalog?.length, 6);
	equal("catalogue ids are stable", state.json?.value?.catalog?.map((item) => item.id).join(","), "conventional-commits,github-flow,git-flow,trunk-based,conventional-branch,gitlab-flow");

	console.log("\n[3] /git/convention writes a framework template");
	const applied = await call("/git/convention", { path: emptyRepo, framework: "conventional-commits" });
	check("write ok", applied.json?.ok === true, applied.raw.slice(0, 300));
	equal("reports the framework", applied.json?.value?.framework, "conventional-commits");
	equal("reports created", applied.json?.value?.created, true);
	const written = await readFile(join(emptyRepo, "GIT_CONVENTIONS.md"), "utf8");
	check("template mentions Conventional Commits", written.includes("Conventional Commits"), written.slice(0, 80));
	check("template declares status settled", /status: settled/.test(written), written.slice(0, 200));
	equal("template is the documented size", applied.json?.value?.bytes, Buffer.byteLength(written, "utf8"));

	console.log("\n[4] an existing document is never overwritten without force");
	const again = await call("/git/convention", { path: emptyRepo, framework: "git-flow" });
	equal("second write is refused", again.json?.ok, false);
	equal("refusal code", again.json?.error?.code, "convention-exists");
	const untouched = await readFile(join(emptyRepo, "GIT_CONVENTIONS.md"), "utf8");
	check("document is unchanged", untouched === written);

	console.log("\n[5] force + no framework writes the empty scaffold");
	const scaffolded = await call("/git/convention", { path: emptyRepo, force: true });
	check("scaffold write ok", scaffolded.json?.ok === true, scaffolded.raw.slice(0, 300));
	equal("scaffold framework id", scaffolded.json?.value?.framework, "none");
	const scaffold = await readFile(join(emptyRepo, "GIT_CONVENTIONS.md"), "utf8");
	check("scaffold is a draft", /status: draft/.test(scaffold), scaffold.slice(0, 200));
	check("scaffold asks for a decision", scaffold.includes("待定"), scaffold.slice(0, 200));

	console.log("\n[6] /git/conventions now reports the draft");
	const after = await call("/git/conventions", { path: emptyRepo });
	equal("document exists", after.json?.value?.exists, true);
	equal("document is a draft", after.json?.value?.draft, true);
	check("document has a size", (after.json?.value?.size ?? 0) > 0, String(after.json?.value?.size));

	console.log("\n[7] the workspace gate still fences the new routes");
	const outside = await call("/git/repos", { path: tmpdir() });
	equal("outside base refused", outside.json?.ok, false);
	equal("outside base code", outside.json?.error?.code, "workspace-unknown");
	const outsideWrite = await call("/git/convention", { path: tmpdir(), framework: "git-flow" });
	equal("outside write refused", outsideWrite.json?.ok, false);
	equal("outside write code", outsideWrite.json?.error?.code, "workspace-unknown");

	console.log("\n[8] non-repository paths are reported, not written");
	const notRepo = await call("/git/convention", { path: plainDir, framework: "git-flow" });
	equal("plain directory refused", notRepo.json?.ok, false);
	equal("plain directory code", notRepo.json?.error?.code, "not-a-repository");

	console.log("\n[9] unknown framework ids are rejected");
	const unknown = await call("/git/convention", { path: commitRepo, framework: "no-such-framework" });
	equal("unknown framework refused", unknown.json?.ok, false);
	equal("unknown framework code", unknown.json?.error?.code, "convention-unknown-framework");

	const NL = String.fromCharCode(10);
	const fail = [];
	const check2 = (name, ok) => {
		check(name, ok);
		if (!ok) fail.push(name);
	};
	// The system-prompt section is what makes an agent read the rules document;
	// it is registered on apply and computed for every step.
	const promptEntry = injected.find((entry) => Array.isArray(entry.deps) && entry.deps.includes("systemPrompt"));
	check2("registers a system prompt section", promptEntry !== undefined);
	const sections = [];
	if (promptEntry !== undefined) {
		promptEntry.callback({
			systemPrompt: {
				section(descriptor) {
					sections.push(descriptor);
					return () => {};
				}
			},
			effect(fn) {
				const disposer = fn();
				return () => {
					if (typeof disposer === "function") disposer();
				};
			}
		});
	}
	const section = sections[0];
	check2("section is named git-conventions", section !== undefined && section.name === "git-conventions");
	check2("section text is a per-step function", section !== undefined && typeof section.text === "function");
	const cwdOf = (path) => ({ agent: { session: { header: { cwd: path } } } });
	check2("no prompt text without a document", section.text(cwdOf(join(workspace, "repos", "plain"))) === "");
	const docPath = join(commitRepo, "GIT_CONVENTIONS.md");
	await writeFile(docPath, ["# Git 规范", "status: settled", "", "- 使用 Conventional Commits", ""].join(NL), "utf8");
	const filled = section.text(cwdOf(join(commitRepo, "src", "nested")));
	check2("prompt carries the document", filled.includes("Conventional Commits"));
	check2("prompt names the repository root", filled.includes(commitRepo));
	check2("prompt reports the document status", filled.includes("status: settled"));
	await appendFile(docPath, "- 分支命名 feature/<topic>" + NL, "utf8");
	check2("prompt reloads an edited document", section.text(cwdOf(join(commitRepo, "src", "nested"))).includes("feature/<topic>"));
	const container = section.text(cwdOf(join(workspace, "repos")));
	check2("container lists documented repositories", container.includes("commit") && container.includes("GIT_CONVENTIONS.md"));

	console.log("\n[10] /git/init creates a repository, and only where it may");
	const freshDir = join(workspace, "repos", "fresh");
	await mkdir(freshDir, { recursive: true });
	const initOk = await call("/git/init", { path: freshDir, branch: "trunk" });
	equal("init ok", initOk.json?.ok, true);
	check("init reports the root", String(initOk.json?.value?.root ?? "").replace(/\\/g, "/").endsWith("/repos/fresh"), initOk.json?.value?.root);
	equal("init reports the branch", initOk.json?.value?.branch, "trunk");
	const dotGit = await stat(join(freshDir, ".git")).catch(() => null);
	check("init created .git", dotGit !== null && dotGit.isDirectory() === true);
	let head = "";
	await new Promise((resolve) => {
		const child = spawn("git", ["symbolic-ref", "--short", "HEAD"], {
			cwd: freshDir,
			windowsHide: true
		});
		child.stdout.on("data", (chunk) => {
			head += String(chunk);
		});
		child.on("close", (code) => resolve(code === 0 ? head.trim() : ""));
		child.on("error", () => resolve(""));
	});
	head = head.trim();
	equal("init used the requested branch", head, "trunk");
	const initAgain = await call("/git/init", { path: freshDir });
	equal("second init refused", initAgain.json?.ok, false);
	equal("second init code", initAgain.json?.error?.code, "already-repository");
	await mkdir(join(commitRepo, "src"), { recursive: true });
	const initInside = await call("/git/init", { path: join(commitRepo, "src") });
	equal("init inside a repository refused", initInside.json?.ok, false);
	equal("init inside a repository code", initInside.json?.error?.code, "already-repository");
	const initOutside = await call("/git/init", { path: tmpdir() });
	equal("init outside the workspace refused", initOutside.json?.ok, false);
	equal("init outside the workspace code", initOutside.json?.error?.code, "workspace-unknown");
	const rescan = await call("/git/repos", { path: workspace, refresh: true });
	const freshEntry = (rescan.json?.value?.repos ?? []).find((entry) => String(entry.root ?? "").replace(/\\/g, "/").endsWith("/repos/fresh"));
	check("rescan sees the new repository", freshEntry !== undefined);
	check("new repository is empty", freshEntry !== undefined && freshEntry.status !== null && freshEntry.status.head === "", JSON.stringify(freshEntry?.status ?? null));

	console.log("\n[11] conventions are inherited by repositories in an enclosing repository");
	const gitInit = (dir, branch) => new Promise((resolve, reject) => {
		const child = spawn("git", ["init", "-b", branch ?? "main"], {
			cwd: dir,
			windowsHide: true,
			stdio: ["ignore", "pipe", "pipe"]
		});
		let failure = "";
		child.stderr.on("data", (chunk) => {
			failure += String(chunk);
		});
		child.on("error", reject);
		child.on("close", (code) => (code === 0 ? resolve() : reject(new Error("git init failed: " + failure))));
	});
	const mono = join(workspace, "mono");
	const api = join(mono, "packages", "api");
	const web = join(mono, "packages", "web");
	const vendored = join(web, "vendor-lib");
	await mkdir(api, { recursive: true });
	await mkdir(web, { recursive: true });
	await mkdir(vendored, { recursive: true });
	await gitInit(mono);
	await gitInit(api);
	await gitInit(web);
	await gitInit(vendored);
	await writeFile(join(api, "GIT_CONVENTIONS.md"), ["# API rules", "status: settled", "", "- api-own-marker", ""].join(NL), "utf8");
	await writeFile(join(mono, "GIT_CONVENTIONS.md"), ["# Mono rules", "status: settled", "", "- mono-marker", ""].join(NL), "utf8");
	await writeFile(join(vendored, "GIT_CONVENTIONS.md"), ["# Vendor rules", "status: settled", "", "- vendor-marker", ""].join(NL), "utf8");
	const apiText = section.text(cwdOf(api));
	check2("nested repository uses its own document", apiText.includes("api-own-marker"));
	check2("own document is not labelled inherited", !apiText.includes("Inherited from:"));
	const monoText = section.text(cwdOf(mono));
	check2("container repository uses its own document", monoText.includes("mono-marker"));
	check2("container document is not labelled inherited", !monoText.includes("Inherited from:"));
	const webText = section.text(cwdOf(web));
	check2("nested repository without a document inherits the enclosing one", webText.includes("mono-marker"));
	check2("inherited document is labelled", webText.includes("inherited Git conventions") && webText.includes("Inherited from: " + mono));
	check2("inherited block names the asking repository", webText.includes("Repository: " + web));
	const vendorText = section.text(cwdOf(vendored));
	check2("a deeper document overrides the inherited one", vendorText.includes("vendor-marker") && !vendorText.includes("mono-marker"));
	const plainText = section.text(cwdOf(join(mono, "packages")));
	check2("a plain subdirectory shows the enclosing repository document", plainText.includes("mono-marker") && plainText.includes("Repository: " + mono));
	const mono2 = join(workspace, "mono2");
	await mkdir(join(mono2, "lib"), { recursive: true });
	await gitInit(mono2);
	await gitInit(join(mono2, "lib"));
	await writeFile(join(mono2, "lib", "GIT_CONVENTIONS.md"), ["# Lib rules", "status: draft", "", "- lib-marker", ""].join(NL), "utf8");
	const deeper = join(mono2, "deep", "inner");
	await mkdir(deeper, { recursive: true });
	await gitInit(deeper);
	await writeFile(join(deeper, "GIT_CONVENTIONS.md"), ["# Inner rules", "status: settled", "", "- inner-marker", ""].join(NL), "utf8");
	const mono2Text = section.text(cwdOf(mono2));
	check2("a repository without a document still indexes the repositories below it", mono2Text.includes("Repositories below this directory") && mono2Text.includes("lib - "));
	check2("the container index reaches repositories two levels down", mono2Text.includes("deep/inner - "));
	check2("a repository with no document anywhere injects nothing", section.text(cwdOf(join(workspace, "repos", "fresh"))).includes("Git conventions") === false);

	console.log("\n[12] overview fields: activity, upstream, branch cleanup and health");
	check("scan entries carry last activity", typeof commitEntry?.activity === "number" && commitEntry.activity > 0, JSON.stringify(commitEntry?.activity));
	check("a repository without a remote reports no upstream", emptyEntry?.upstream === null && commitEntry?.upstream === null, JSON.stringify([emptyEntry?.upstream, commitEntry?.upstream]));
	const branchy = join(workspace, "repos", "branchy");
	await mkdir(branchy, { recursive: true });
	await git(branchy, "init", "-b", "main");
	await writeFile(join(branchy, "README.md"), "# branchy\n", "utf8");
	await git(branchy, "add", ".");
	await git(branchy, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "chore: initial");
	await git(branchy, "switch", "-c", "shipped");
	await writeFile(join(branchy, "shipped.txt"), "shipped\n", "utf8");
	await git(branchy, "add", ".");
	await git(branchy, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "feat: shipped work");
	await git(branchy, "switch", "main");
	await git(branchy, "-c", "user.name=Test", "-c", "user.email=test@example.com", "merge", "--no-ff", "-m", "merge: shipped", "shipped");
	await git(branchy, "switch", "-c", "wip");
	await writeFile(join(branchy, "wip.txt"), "wip\n", "utf8");
	await git(branchy, "add", ".");
	await git(branchy, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "feat: unfinished");
	await git(branchy, "switch", "main");
	const cleanup = await call("/git/cleanup", { path: branchy });
	check("/git/cleanup ok", cleanup.json?.ok === true, cleanup.raw.slice(0, 200));
	equal("cleanup uses main as the base", cleanup.json?.value?.base, "main");
	const branchRows = cleanup.json?.value?.branches ?? [];
	const shippedRow = branchRows.find((row) => row.name === "shipped");
	const wipRow = branchRows.find((row) => row.name === "wip");
	const mainRow = branchRows.find((row) => row.name === "main");
	check("merged branch is reported as merged", shippedRow?.merged === true && shippedRow.unmerged === 0, JSON.stringify(shippedRow ?? null));
	check("unmerged branch reports its pending commits", wipRow?.merged === false && wipRow.unmerged === 1, JSON.stringify(wipRow ?? null));
	check("the base branch is marked as the base", mainRow?.base === true && mainRow.merged === true, JSON.stringify(mainRow ?? null));
	check("cleanup marks the checked-out branch", mainRow?.current === true, JSON.stringify(mainRow ?? null));
	const cleanupMissing = await call("/git/cleanup", { path: join(workspace, "repos", "plain") });
	equal("cleanup refuses a plain directory", cleanupMissing.json?.ok, false);
	equal("cleanup refusal code", cleanupMissing.json?.error?.code, "internal");
	const health = await call("/git/health", { path: branchy });
	check("/git/health ok", health.json?.ok === true, health.raw.slice(0, 200));
	equal("health reports the branch", health.json?.value?.branch, "main");
	equal("health reports a normal head", health.json?.value?.detached, false);
	equal("health counts the stash", health.json?.value?.stash, 0);
	check("health counts the branches", health.json?.value?.branches === 3, JSON.stringify(health.json?.value?.branches));
	check("health counts the objects", typeof health.json?.value?.gitObjects === "number" && health.json.value.gitObjects > 0, JSON.stringify(health.json?.value?.gitObjects));
	check("health reports an object-store size", typeof health.json?.value?.gitBytes === "number" && health.json.value.gitBytes >= 0, JSON.stringify(health.json?.value?.gitBytes));
	await writeFile(join(branchy, "small-untracked.txt"), "small\n", "utf8");
	await writeFile(join(branchy, "big-untracked.bin"), Buffer.alloc(1200000, 7));
	const healthBig = await call("/git/health", { path: branchy });
	const big = healthBig.json?.value?.bigUntracked ?? [];
	equal("health sees both untracked files", healthBig.json?.value?.untracked, 2);
	equal("health reports only the large untracked file", big.length, 1);
	check("health names the large untracked file", String(big[0]?.path ?? "").split(String.fromCharCode(92)).join("/") === "big-untracked.bin", JSON.stringify(big));
	check("health keeps the byte size", big[0]?.bytes === 1200000, JSON.stringify(big[0] ?? null));
	const healthPlain = await call("/git/health", { path: join(workspace, "repos", "plain") });
	equal("health refuses a plain directory", healthPlain.json?.ok, false);
	const rescanBranchy = await call("/git/repos", { path: workspace, refresh: true });
	const branchyEntry = (rescanBranchy.json?.value?.repos ?? []).find((entry) => entry.relPath === "repos/branchy");
	check("rescan reports the branchy repository", branchyEntry !== undefined);
	check("rescan reports its activity", typeof branchyEntry?.activity === "number" && branchyEntry.activity > 0, JSON.stringify(branchyEntry?.activity));

	console.log("\n[13] compliance hints, upgrade preview and the workspace document");
	const ruled = join(workspace, "repos", "ruled");
	await mkdir(ruled, { recursive: true });
	await git(ruled, "init", "-b", "main");
	await writeFile(join(ruled, "GIT_CONVENTIONS.md"), [
		"# Git 规范 / Git conventions",
		"",
		"```yaml",
		"status: settled",
		"framework: conventional-commits",
		"```",
		"",
		"## 1. 提交信息 / Commit messages",
		"",
		"- type 取值：`feat` / `fix` / `docs`",
		"- 标题祈使句、小写开头、不加句号，≤ 40 字符",
		""
	].join("\n"), "utf8");
	await writeFile(join(ruled, "a.txt"), "a\n", "utf8");
	await git(ruled, "add", ".");
	await git(ruled, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "feat: add the parser");
	await writeFile(join(ruled, "b.txt"), "b\n", "utf8");
	await git(ruled, "add", ".");
	await git(ruled, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "Fix parser crash.");
	await writeFile(join(ruled, "c.txt"), "c\n", "utf8");
	await git(ruled, "add", ".");
	await git(ruled, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "chore: tidy the tree");
	await writeFile(join(ruled, "d.txt"), "d\n", "utf8");
	await git(ruled, "add", ".");
	await git(ruled, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "feat: a very long subject that keeps going past the cap");
	const compliance = await call("/git/compliance", { path: ruled });
	check("/git/compliance ok", compliance.json?.ok === true, compliance.raw.slice(0, 200));
	equal("compliance reads the stated subject cap", compliance.json?.value?.rules?.maxSubject, 40);
	equal("compliance reads the stated type list", (compliance.json?.value?.rules?.types ?? []).join(","), "feat,fix,docs");
	equal("compliance counts the commits it checked", compliance.json?.value?.checked, 4);
	equal("compliance counts the offenders", compliance.json?.value?.failing, 3);
	check("compliance says it is enforcing", compliance.json?.value?.enforced === true);
	const reasons = (compliance.json?.value?.offenders ?? []).map((entry) => (entry.reasons ?? []).join("+"));
	check("a mixed-case subject breaks type, case and period", reasons.includes("type+case+period"), JSON.stringify(reasons));
	check("an unknown type breaks the type rule", reasons.includes("type"), JSON.stringify(reasons));
	check("an over-long subject breaks only the length rule", reasons.includes("length") && !reasons.includes("type+length"), JSON.stringify(reasons));
		// The rules must read the same for Chinese, English and mixed subjects, and a
	// document may ask for them to be enforced instead of suggested.
	const EOLX = String.fromCharCode(10);
	const cjk = join(workspace, "repos", "cjk");
	await mkdir(cjk, { recursive: true });
	await git(cjk, "init", "-b", "main");
	await writeFile(join(cjk, "GIT_CONVENTIONS.md"), [
		"# Git 规范",
		"",
		"```yaml",
		"status: settled",
		"strict: true",
		"```",
		"",
		"## 1. 提交信息",
		"",
		"- type 取值：`feat` / `fix` / `新增`",
		"- 标题小写开头、不加句号，≤ 40 字符",
		""
	].join(EOLX), "utf8");
	const cjkSubjects = [
		"feat: 加入解析器",
		"新增: 加入解析器",
		"fix: 修复崩溃",
		"fix: repair the crash",
		"Feat: 混合 subject with English 和中文。",
		"fix: Repair the crash 修复"
	];
	for (let index = 0; index < cjkSubjects.length; index += 1) {
		await writeFile(join(cjk, "row-" + index + ".txt"), String(index) + EOLX, "utf8");
		await git(cjk, "add", ".");
		await git(cjk, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", cjkSubjects[index]);
	}
	const cjkReport = await call("/git/compliance", { path: cjk });
	check("/git/compliance ok for a Chinese document", cjkReport.json?.ok === true, cjkReport.raw.slice(0, 200));
	equal("a Chinese type label joins the vocabulary", (cjkReport.json?.value?.rules?.types ?? []).join(","), "feat,fix");
	equal("a Chinese document can ask for a strict policy", cjkReport.json?.value?.strict, true);
	equal("only the two careless subjects fail", cjkReport.json?.value?.failing, 2);
	equal("both failing subjects are reported", (cjkReport.json?.value?.offenders ?? []).length, 2);
	const cjkReasons = (cjkReport.json?.value?.offenders ?? []).map((entry) => (entry.reasons ?? []).join("+"));
	check("a Chinese period still counts as a period", cjkReasons.includes("period"), JSON.stringify(cjkReasons));
	check("a Latin capital after the type still counts as case", cjkReasons.includes("case"), JSON.stringify(cjkReasons));
	check("Chinese subjects are counted as Chinese", (cjkReport.json?.value?.languages?.zh ?? 0) >= 1, JSON.stringify(cjkReport.json?.value?.languages));
	check("mixed subjects are counted as mixed", (cjkReport.json?.value?.languages?.mixed ?? 0) >= 2, JSON.stringify(cjkReport.json?.value?.languages));
	const cjkSection = section.text(cwdOf(cjk));
	check("the injected block calls a strict document strict", /strict/i.test(cjkSection), cjkSection.slice(0, 400));
	check("the injected block lists the machine-checked rules", /Machine-checkable rules/.test(cjkSection), cjkSection.slice(0, 400));
	const strictWrite = await call("/git/convention", { path: cjk, framework: "github-flow", force: true, strict: true });
	check("a strict write is accepted", strictWrite.json?.ok === true, strictWrite.raw.slice(0, 200));
	const strictBody = await readFile(join(cjk, "GIT_CONVENTIONS.md"), "utf8");
	check("the strict flag lands in the front matter", strictBody.indexOf("strict: true") >= 0, strictBody.slice(0, 200));
	check("the strict flag sits next to the status", strictBody.indexOf(EOLX + "strict: true") >= 0, strictBody.slice(0, 200));
	const looseWrite = await call("/git/convention", { path: cjk, framework: "github-flow", force: true, strict: false });
	check("a loose write is accepted", looseWrite.json?.ok === true, looseWrite.raw.slice(0, 200));
	const looseBody = await readFile(join(cjk, "GIT_CONVENTIONS.md"), "utf8");
	check("a loose write keeps a single flag", looseBody.split("strict:").length === 2 && looseBody.indexOf("strict: false") >= 0, looseBody.slice(0, 200));

	// The language policy: written into the document, enforced on the subject,
	// and restated in the injected block. Chinese, English or a mix only when asked.
	const langzh = join(workspace, "repos", "langzh");
	await mkdir(langzh, { recursive: true });
	await git(langzh, "init", "-b", "main");
	await writeFile(join(langzh, "GIT_CONVENTIONS.md"), [
		"# Git 规范",
		"",
		"status: settled        # draft | settled",
		"language: zh           # zh | en | mixed",
		"",
		"## 提交信息",
		"",
		"- type 取值：`feat` / `fix` / `docs`",
		"- 标题不加句号，≤ 40 字符",
	].join(EOLX), "utf8");
	const langSubjects = [
		"feat: 加入解析器",
		"fix: 修复崩溃",
		"fix: repair the crash",
		"docs: 更新文档"
	];
	for (let index = 0; index < langSubjects.length; index += 1) {
		await writeFile(join(langzh, "row-" + index + ".txt"), String(index) + EOLX, "utf8");
		await git(langzh, "add", ".");
		await git(langzh, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", langSubjects[index]);
	}
	const langReport = await call("/git/compliance", { path: langzh });
	check("/git/compliance ok for a Chinese-only document", langReport.json?.ok === true, langReport.raw.slice(0, 200));
	equal("the document language is read from the front matter", langReport.json?.value?.rules?.language, "zh");
	equal("a stated language is reported as stated", langReport.json?.value?.rules?.languageStated, true);
	equal("only the English subject fails a Chinese document", langReport.json?.value?.failing, 1);
	const langReasons = (langReport.json?.value?.offenders ?? []).map((entry) => (entry.reasons ?? []).join("+"));
	check("the English subject is flagged as the wrong language", langReasons.some((entry) => entry.split("+").includes("lang")), JSON.stringify(langReasons));
	const langSection = section.text(cwdOf(langzh));
	check("the injected block names the subject language", /Subject language/.test(langSection), langSection.slice(0, 200));
	check("the injected block says Chinese only", /Chinese only/.test(langSection), langSection.slice(0, 200));
	const langWrite = await call("/git/convention", { path: langzh, framework: "conventional-commits", force: true, language: "en" });
	check("a write with a language is accepted", langWrite.json?.ok === true, langWrite.raw.slice(0, 200));
	const langBody = await readFile(join(langzh, "GIT_CONVENTIONS.md"), "utf8");
	check("the language lands in the front matter", langBody.indexOf("language: en") >= 0, langBody.slice(0, 240));
	check("the language sits under the status", langBody.indexOf(EOLX + "language: en") > langBody.indexOf("status:"), langBody.slice(0, 240));
	const strictLang = await call("/git/convention", { path: langzh, framework: "conventional-commits", force: true, strict: true, language: "mixed" });
	check("a write with strict and language together", strictLang.json?.ok === true, strictLang.raw.slice(0, 200));
	const combined = await readFile(join(langzh, "GIT_CONVENTIONS.md"), "utf8");
	check("strict and language coexist in a fixed order", combined.indexOf("strict: true") > combined.indexOf("status:") && combined.indexOf("language: mixed") > combined.indexOf("strict: true"), combined.slice(0, 260));
	equal("only one language line survives a rewrite", combined.split("language:").length, 2);

	const docless = join(workspace, "repos", "docless");
	await mkdir(docless, { recursive: true });
	await git(docless, "init", "-b", "main");
	await writeFile(join(docless, "README.md"), "# docless", "utf8");
	await git(docless, "add", ".");
	await git(docless, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "chore: initial");
const noRules = await call("/git/compliance", { path: docless });
	check("/git/compliance on a repository without a document", noRules.json?.ok === true, noRules.raw.slice(0, 200));
	equal("no document means nothing is enforced", noRules.json?.value?.enforced, false);
	equal("no document means no offenders", noRules.json?.value?.failing, 0);
	const previewBlank = await call("/git/convention/preview", { path: docless, framework: "conventional-commits" });
	check("preview ok for a repository without a document", previewBlank.json?.ok === true, previewBlank.raw.slice(0, 200));
	equal("preview reports no existing document", previewBlank.json?.value?.exists, false);
	check("preview lists the sections it would add", (previewBlank.json?.value?.added ?? 0) >= 5, JSON.stringify(previewBlank.json?.value?.added));
	equal("preview changes nothing when there is nothing", previewBlank.json?.value?.changed, 0);
	check("preview does not write the document", (await stat(join(docless, "GIT_CONVENTIONS.md")).catch(() => null)) === null);
	const wrote = await call("/git/convention", { path: docless, framework: "conventional-commits", force: true });
	check("the framework document is written", wrote.json?.ok === true, wrote.raw.slice(0, 200));
	const beforeDocument = await readFile(join(docless, "GIT_CONVENTIONS.md"), "utf8");
	const previewSwitch = await call("/git/convention/preview", { path: docless, framework: "github-flow" });
	check("preview ok for an existing document", previewSwitch.json?.ok === true, previewSwitch.raw.slice(0, 200));
	equal("preview reports the existing document", previewSwitch.json?.value?.exists, true);
	check("preview names the sections that change", (previewSwitch.json?.value?.changed ?? 0) + (previewSwitch.json?.value?.added ?? 0) + (previewSwitch.json?.value?.removed ?? 0) > 0, JSON.stringify(previewSwitch.json?.value?.sections ?? []).slice(0, 300));
	check("preview sizes both documents", previewSwitch.json?.value?.currentBytes > 0 && previewSwitch.json?.value?.nextBytes > 0, JSON.stringify([previewSwitch.json?.value?.currentBytes, previewSwitch.json?.value?.nextBytes]));
	check("preview never rewrites the document", (await readFile(join(docless, "GIT_CONVENTIONS.md"), "utf8")) === beforeDocument);
	const wsContainer = join(workspace, "wsdoc");
	const inner = join(wsContainer, "repos", "one");
	await mkdir(inner, { recursive: true });
	await git(inner, "init", "-b", "main");
	await writeFile(join(inner, "README.md"), "# one\n", "utf8");
	await git(inner, "add", ".");
	await git(inner, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "feat: first");
	const wsState = await call("/git/workspace-convention", { path: wsContainer, action: "state" });
	check("/git/workspace-convention ok", wsState.json?.ok === true, wsState.raw.slice(0, 200));
	equal("the workspace document lives in .dsh", wsState.json?.value?.doc, ".dsh/GIT_CONVENTIONS.md");
	equal("the container has no workspace document yet", wsState.json?.value?.exists, false);
	equal("the container gets the whole catalogue", (wsState.json?.value?.catalog ?? []).length, 6);
	const wsPreview = await call("/git/workspace-convention", { path: wsContainer, action: "preview", framework: "conventional-commits" });
	check("workspace preview ok", wsPreview.json?.ok === true, wsPreview.raw.slice(0, 200));
	check("workspace preview lists additions", (wsPreview.json?.value?.added ?? 0) >= 5, JSON.stringify(wsPreview.json?.value?.added));
	check("workspace preview writes nothing", (await stat(join(wsContainer, ".dsh", "GIT_CONVENTIONS.md")).catch(() => null)) === null);
	const wsWrite = await call("/git/workspace-convention", { path: wsContainer, action: "write", framework: "conventional-commits" });
	check("workspace document is written", wsWrite.json?.ok === true, wsWrite.raw.slice(0, 200));
	equal("workspace write reports creation", wsWrite.json?.value?.created, true);
	const wsAfter = await call("/git/workspace-convention", { path: wsContainer, action: "state" });
	equal("the workspace document now exists", wsAfter.json?.value?.exists, true);
	equal("the workspace document is settled", wsAfter.json?.value?.draft, false);
	const inherited = section.text(cwdOf(join(inner, "nested")));
	check("the workspace document reaches a repository below it", inherited.includes("inherited Git conventions"), inherited.slice(0, 240));
	check("the inherited block names the document", inherited.includes(".dsh") && inherited.includes("GIT_CONVENTIONS.md"), inherited.slice(0, 240));
	check("the inherited block names the container", inherited.includes(wsContainer), inherited.slice(0, 240));

	console.log("\n[14] scan cost: one ref probe per repository, none while the refs sit still");

	const scanRoot = join(workspace, "scan-cost");
	const scanA = join(scanRoot, "alpha");
	const scanB = join(scanRoot, "beta");
	await mkdir(scanA, { recursive: true });
	await mkdir(scanB, { recursive: true });
	/** Windows hands the same directory back in another case and separator. */
	const rootKeyOf = (value) => String(value ?? "").toLowerCase().split(String.fromCharCode(92)).join("/");
	const entryAt = (payload, root) => (payload?.value?.repos ?? []).find((entry) => rootKeyOf(entry.root) === rootKeyOf(root)) ?? {};
	await git(scanA, "init", "-b", "main");
	await writeFile(join(scanA, "README.md"), "# alpha\n", "utf8");
	await git(scanA, "add", ".");
	await git(scanA, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "feat: seed alpha");
	await git(scanB, "init", "-b", "main");
	await writeFile(join(scanB, "README.md"), "# beta\n", "utf8");
	await git(scanB, "add", ".");
	await git(scanB, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "feat: seed beta");

	const scanFirst = await call("/git/repos", {
		path: scanRoot,
		refresh: true
	});
	equal("the scan lists both repositories", (scanFirst.json?.value?.repos ?? []).length, 2);
	const firstTimings = scanFirst.json?.value?.timings ?? {};
	equal("one ref probe per repository, not three", firstTimings.probeSpawns, 2);
	equal("nothing comes from the cache on a cold scan", firstTimings.probeHits, 0);
	check("the scan reports every phase", [
		firstTimings.statusMs,
		firstTimings.augmentMs,
		firstTimings.conventionsMs,
		firstTimings.totalMs
	].every((value) => typeof value === "number" && value >= 0), JSON.stringify(firstTimings));
	const activityFirst = {};
	for (const entry of scanFirst.json?.value?.repos ?? []) activityFirst[rootKeyOf(entry.root)] = entry.activity;
	check("every repository reports activity", Object.values(activityFirst).every((value) => typeof value === "number" && value > 0), JSON.stringify(activityFirst));

	const scanSecond = await call("/git/repos", {
		path: scanRoot,
		refresh: true
	});
	const secondTimings = scanSecond.json?.value?.timings ?? {};
	equal("a second scan spawns no ref probe", secondTimings.probeSpawns, 0);
	equal("a second scan answers from the cache", secondTimings.probeHits, 2);
	const activitySecond = {};
	for (const entry of scanSecond.json?.value?.repos ?? []) activitySecond[rootKeyOf(entry.root)] = entry.activity;
	check("the cached activity matches", JSON.stringify(activitySecond) === JSON.stringify(activityFirst), JSON.stringify(activitySecond));

	await writeFile(join(scanA, "scratch.txt"), "dirty\n", "utf8");
	const scanDirty = await call("/git/repos", {
		path: scanRoot,
		refresh: true
	});
	const dirtyEntry = entryAt(scanDirty.json, scanA);
	check("an untracked file is seen while the summary stays cached", (dirtyEntry.status?.untrackedFiles ?? 0) >= 1, JSON.stringify(dirtyEntry.status));
	equal("a dirty worktree does not re-probe the refs", (scanDirty.json?.value?.timings ?? {}).probeSpawns, 0);

	await writeFile(join(scanB, "README.md"), "# beta again\n", "utf8");
	await git(scanB, "add", ".");
	await git(scanB, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "feat: second beta");
	const scanMoved = await call("/git/repos", {
		path: scanRoot,
		refresh: true
	});
	const movedTimings = scanMoved.json?.value?.timings ?? {};
	equal("only the repository that moved is re-probed", movedTimings.probeSpawns, 1);
	equal("the untouched repository stays cached", movedTimings.probeHits, 1);
	const movedB = entryAt(scanMoved.json, scanB);
	check("the moved repository reports newer activity", typeof movedB.activity === "number" && movedB.activity >= (activityFirst[rootKeyOf(scanB)] ?? 0), JSON.stringify(movedB.activity));

	console.log("\n[16] a tag keeps its own prefix, so the panel can tell it from a branch");

	const tagged = join(workspace, "repos", "tagged");
	await mkdir(tagged, { recursive: true });
	await git(tagged, "init", "-b", "main");
	await writeFile(join(tagged, "a.txt"), "a\n", "utf8");
	await git(tagged, "add", ".");
	await git(tagged, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "feat: first");
	await git(tagged, "-c", "user.name=Test", "-c", "user.email=test@example.com", "tag", "-a", "v1.0.0", "-m", "release one");
	await writeFile(join(tagged, "b.txt"), "b\n", "utf8");
	await git(tagged, "add", ".");
	await git(tagged, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "feat: second");
	const taggedGraph = await call("/git/graph", { path: tagged, limit: 10 });
	check("the graph loads for a tagged repository", taggedGraph.json?.ok === true, taggedGraph.raw.slice(0, 200));
	const taggedRefs = [];
	for (const entry of taggedGraph.json?.value?.commits ?? []) for (const ref of entry.refs ?? []) taggedRefs.push(ref);
	check("a tag arrives with its own prefix", taggedRefs.indexOf("tag: v1.0.0") >= 0, JSON.stringify(taggedRefs));
	check("the branch arrives without one", taggedRefs.some((ref) => ref === "main" || ref === "HEAD -> main"), JSON.stringify(taggedRefs));

	console.log("\n[15] switch-only updates keep the document, and the workspace document reaches the prompt");

	const switched = join(workspace, "repos", "switched");
	await mkdir(switched, { recursive: true });
	await git(switched, "init", "-b", "main");
	await writeFile(join(switched, "GIT_CONVENTIONS.md"), [
		"# Git 规范 / Git conventions",
		"",
		"```yaml",
		"status: settled",
		"framework: conventional-commits",
		"```",
		"",
		"## 1. 提交信息 / Commit messages",
		"",
		"- type 取值：`feat` / `fix` / `docs`",
		""
	].join("\n"), "utf8");
	await writeFile(join(switched, "a.txt"), "a\n", "utf8");
	await git(switched, "add", ".");
	await git(switched, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "feat: keep the body");

	const beforeSwitches = await call("/git/conventions", { path: switched });
	check("no language is reported before one is stated", beforeSwitches.json?.value?.languageStated === false, JSON.stringify(beforeSwitches.json?.value?.languageStated));

	const setSwitches = await call("/git/convention/settings", { path: switched, strict: true, language: "zh" });
	check("/git/convention/settings ok", setSwitches.json?.ok === true, setSwitches.raw.slice(0, 200));
	const switchedBody = await readFile(join(switched, "GIT_CONVENTIONS.md"), "utf8");
	check("a switch update keeps the body", switchedBody.includes("## 1. 提交信息 / Commit messages"), switchedBody.slice(0, 160));
	check("a switch update writes strict and language", /\nstrict: true/.test(switchedBody) && /\nlanguage: zh/.test(switchedBody), switchedBody.slice(0, 200));

	const switchedState = await call("/git/conventions", { path: switched });
	check("the state reports the stored switches", switchedState.json?.value?.strict === true && switchedState.json?.value?.language === "zh" && switchedState.json?.value?.languageStated === true, JSON.stringify(switchedState.json?.value?.strict) + "/" + JSON.stringify(switchedState.json?.value?.language));

	const strictOnly = await call("/git/convention/settings", { path: switched, strict: false });
	const strictOnlyBody = await readFile(join(switched, "GIT_CONVENTIONS.md"), "utf8");
	check("a strict-only update keeps the language", strictOnly.json?.ok === true && /\nlanguage: zh/.test(strictOnlyBody) && /\nstrict: false/.test(strictOnlyBody), strictOnlyBody.slice(0, 200));

	const undocumented = join(workspace, "repos", "undocumented");
	await mkdir(undocumented, { recursive: true });
	await git(undocumented, "init", "-b", "main");
	await writeFile(join(undocumented, "a.txt"), "a\n", "utf8");
	await git(undocumented, "add", ".");
	await git(undocumented, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "feat: first");
	const noDocument = await call("/git/convention/settings", { path: undocumented });
	check("switches without a document are refused", noDocument.json?.ok === false && noDocument.json?.error?.code === "convention-missing-document", JSON.stringify(noDocument.json?.error?.code));

	await call("/git/workspace-convention", { path: wsContainer, action: "write", framework: "conventional-commits", strict: true, language: "en", force: true });
	const workspaceText = section.text(cwdOf(wsContainer));
	check("the workspace document reaches a container prompt", workspaceText.includes("this workspace's Git conventions"), workspaceText.slice(0, 200));
	check("the container prompt states the language", workspaceText.includes("Subject language: English only"), workspaceText.slice(0, 400));
	check("the container prompt states the strict mode", workspaceText.includes("This document is strict"), workspaceText.slice(0, 400));

	const workspaceSwitches = await call("/git/workspace-convention", { path: wsContainer, action: "settings", language: "zh" });
	const workspaceBody = await readFile(join(wsContainer, ".dsh", "GIT_CONVENTIONS.md"), "utf8");
	check("the workspace switches update in place", workspaceSwitches.json?.ok === true && /\nlanguage: zh/.test(workspaceBody) && /\nstrict: true/.test(workspaceBody), workspaceBody.slice(0, 200));
	check("the container prompt follows a switch update", section.text(cwdOf(wsContainer)).includes("Subject language: Chinese only"), section.text(cwdOf(wsContainer)).slice(0, 300));

	console.log("\n[17] the AI attribution policy is checked in the message body");

	const aiRepo = join(workspace, "repos", "ai-required");
	await mkdir(aiRepo, { recursive: true });
	await git(aiRepo, "init", "-b", "main");
	await writeFile(join(aiRepo, "GIT_CONVENTIONS.md"), [
		"status: settled",
		"strict: true",
		"language: zh",
		"ai: required",
		""
	].join(NL), "utf8");
	await writeFile(join(aiRepo, "a.txt"), "a\n", "utf8");
	await git(aiRepo, "add", ".");
	await git(aiRepo, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "feat: 新增功能", "-m", "Assisted-by: Claude Code");
	await writeFile(join(aiRepo, "b.txt"), "b\n", "utf8");
	await git(aiRepo, "add", ".");
	await git(aiRepo, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "fix: 修复问题");
	const aiState = await call("/git/conventions", { path: aiRepo });
	check("the state reports the AI policy", aiState.json?.value?.ai === "required" && aiState.json?.value?.aiStated === true, JSON.stringify(aiState.json?.value?.ai) + "/" + JSON.stringify(aiState.json?.value?.aiStated));
	const aiRequired = await call("/git/compliance", { path: aiRepo });
	check("/git/compliance ok for an AI-required document", aiRequired.json?.ok === true, aiRequired.raw.slice(0, 200));
	const requiredReasons = (aiRequired.json?.value?.offenders ?? []).map((entry) => entry.subject + ":" + (entry.reasons ?? []).join("+")).join(" | ");
	check("a message without a trailer breaks the AI rule", requiredReasons.includes("fix: 修复问题:ai"), requiredReasons);
	check("a message that carries one passes", !requiredReasons.includes("feat: 新增功能"), requiredReasons);
	check("the report names the policy it applied", aiRequired.json?.value?.ai === "required" && aiRequired.json?.value?.enforced === true, JSON.stringify(aiRequired.json?.value?.ai));
	await call("/git/convention/settings", { path: aiRepo, ai: "forbidden" });
	const aiForbidden = await call("/git/compliance", { path: aiRepo });
	const forbiddenReasons = (aiForbidden.json?.value?.offenders ?? []).map((entry) => entry.subject + ":" + (entry.reasons ?? []).join("+")).join(" | ");
	check("a forbidden policy flags the trailer", forbiddenReasons.includes("feat: 新增功能:ai"), forbiddenReasons);
	check("a forbidden policy lets a plain message pass", !forbiddenReasons.includes("fix: 修复问题"), forbiddenReasons);
	await call("/git/convention/settings", { path: aiRepo, ai: "optional" });
	const aiOptional = await call("/git/compliance", { path: aiRepo });
	check("an optional policy never flags the trailer", (aiOptional.json?.value?.offenders ?? []).every((entry) => !(entry.reasons ?? []).includes("ai")), JSON.stringify((aiOptional.json?.value?.offenders ?? []).map((entry) => entry.reasons)));
	check("the AI policy reaches the prompt", /AI attribution| Assisted-by/.test(section.text(cwdOf(aiRepo))), section.text(cwdOf(aiRepo)).slice(0, 300));


	console.log("\n[18] conflicting documents are reported to the agent, which owns the merge");

	const consolidable = join(workspace, "ws-consolidate");
	const childRepo = join(consolidable, "repo");
	await mkdir(join(consolidable, ".dsh"), { recursive: true });
	await mkdir(childRepo, { recursive: true });
	await git(childRepo, "init", "-b", "main");
	await writeFile(join(consolidable, ".dsh", "GIT_CONVENTIONS.md"), [
		"status: settled",
		"strict: true",
		"language: zh",
		"ai: required",
		"",
		"## 1. Subject",
		"",
		"标题不超过 72 字符。",
		"",
	].join(NL), "utf8");
	await writeFile(join(childRepo, "GIT_CONVENTIONS.md"), [
		"status: settled",
		"strict: false",
		"language: en",
		"ai: forbidden",
		"",
		"## 1. Subject",
		"",
		"Keep the subject under 50 characters.",
		"",
	].join(NL), "utf8");
	await writeFile(join(childRepo, "a.txt"), "a\n", "utf8");
	await git(childRepo, "add", ".");
	await git(childRepo, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "feat: first");
	const conflicts = await call("/git/conventions/conflicts", { path: childRepo });
	check("/git/conventions/conflicts ok", conflicts.json?.ok === true, conflicts.raw.slice(0, 200));
	const report = conflicts.json?.value ?? {};
	check("both documents are counted", report.live === 2 && report.total === 2, JSON.stringify([report.live, report.total]));
	const conflictKeys = (report.fields ?? []).map((entry) => entry.key);
	check("the field conflicts are named", conflictKeys.includes("strict") && conflictKeys.includes("language") && conflictKeys.includes("ai"), JSON.stringify(conflictKeys));
	check("the rule conflict is named", (report.rules ?? []).some((entry) => entry.key === "maxSubject"), JSON.stringify((report.rules ?? []).map((entry) => entry.key)));
	check("the report carries a digest", typeof report.digest === "string" && report.digest.length > 0, String(report.digest));
	check("the union keeps the stricter side", report.union?.maxSubject === 50 && report.union?.strict === true && report.union?.ai === "required", JSON.stringify(report.union));
	const noticeText = section.text(cwdOf(childRepo));
	check("the prompt tells the agent the documents disagree", noticeText.includes("conflict"), noticeText.slice(-400));
	check("the prompt asks before picking a side", /Do not pick a side silently/.test(noticeText) && /your own file tools/.test(noticeText), noticeText.slice(-400));
	check("the prompt spells out the pointer a merge leaves behind", /dsh-git-graph: inherited from/.test(noticeText) && /\.bak-/.test(noticeText), noticeText.slice(-700));
	const noRoute = await call("/git/conventions/consolidate", { path: childRepo });
	check("there is no mechanical merge route any more", noRoute.json === void 0 || noRoute.json?.ok !== true, noRoute.raw);
	const conflictDoc = await readFile(join(consolidable, ".dsh", "GIT_CONVENTIONS.md"), "utf8");
	check("reporting a conflict writes nothing", conflictDoc.includes("标题不超过 72 字符"), conflictDoc.slice(0, 120));

	console.log("\n[20] rules written in prose files such as AGENTS.md are detected");

	const prose = join(workspace, "ws-prose");
	const proseRepo = join(prose, "repo");
	await mkdir(join(prose, ".dsh"), { recursive: true });
	await mkdir(proseRepo, { recursive: true });
	await git(proseRepo, "init", "-b", "main");
	await writeFile(join(prose, ".dsh", "GIT_CONVENTIONS.md"), [
		"status: settled",
		"strict: true",
		"language: zh",
		"",
		"## 1. Subject",
		"",
		"标题不超过 72 字符。",
		"",
	].join(NL), "utf8");
	await writeFile(join(proseRepo, "AGENTS.md"), [
		"# Agent notes",
		"",
		"## Commits",
		"",
		"Keep the subject under 50 characters.",
		"",
		"Type prefix must be one of `feat` `fix` `docs`.",
		"",
	].join(NL), "utf8");
	await writeFile(join(proseRepo, "a.txt"), "a\n", "utf8");
	await git(proseRepo, "add", ".");
	await git(proseRepo, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "feat: first");
	const proseReport = (await call("/git/conventions/conflicts", { path: proseRepo })).json?.value ?? {};
	check("the conventions document stays the only governing one", proseReport.live === 1, JSON.stringify(proseReport.live));
	check("the prose document is reported as a foreign source", (proseReport.foreign ?? []).some((entry) => entry.origin === "AGENTS.md"), JSON.stringify(proseReport.foreign));
	check("its length rule tightens the union", proseReport.union?.maxSubject === 50, JSON.stringify(proseReport.union));
	const prosePrompt = section.text(cwdOf(proseRepo));
	check("the prompt names the prose document", prosePrompt.includes("AGENTS.md"), prosePrompt.slice(-500));
	const proseNoRoute = await call("/git/conventions/consolidate", { path: proseRepo });
	check("a prose document is not merged mechanically", proseNoRoute.json === void 0 || proseNoRoute.json?.ok !== true, proseNoRoute.raw);
	const agentsLeft = await readFile(join(proseRepo, "AGENTS.md"), "utf8");
	check("the prose document is never rewritten", agentsLeft.includes("Keep the subject under 50 characters"), agentsLeft.slice(0, 200));

	await rm(workspace, { recursive: true, force: true });

	const failed = checks.filter((entry) => !entry.ok);
	console.log("\n" + (checks.length - failed.length) + "/" + checks.length + " checks passed");
	if (failed.length > 0) {
		console.error("failed: " + failed.map((entry) => entry.name).join(", "));
		process.exitCode = 1;
	}
}

main().catch((error) => {
	console.error("test-host: " + (error instanceof Error ? error.stack ?? error.message : String(error)));
	process.exitCode = 1;
});
