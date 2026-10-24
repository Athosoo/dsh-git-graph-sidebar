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
