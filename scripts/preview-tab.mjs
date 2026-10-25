// Offline preview of the better-sidebar tab, straight from the built client
// bundle (no browser, no DSH restart).
//
// The bundle is a `window.__ModuleLoader__.load({ factory })` wrapper, so this
// script stubs the globals it touches (window/document/navigator/localStorage/
// fetch), stubs `react` with a tiny hook runtime, runs `apply(ctx)` with a stub
// context, captures the descriptor handed to `betterSidebar.registerTab`, and
// then renders that real component against canned `/git/repos` + `/git/graph`
// responses. The resulting element tree is serialised to HTML, which doubles as
// a smoke test: any ReferenceError/TypeError in the tab code fails the run.
//
//   node scripts/preview-tab.mjs [outFile]
//
// With real data instead of the canned samples (one JSON per file, either the
// raw view or the `{ok:true,value}` envelope returned by the host routes):
//
//   node scripts/preview-tab.mjs --out preview/real.html \
//     --repos /tmp/repos.json --graph /tmp/graph-a.json --graph /tmp/graph-b.json
import { readFile, writeFile, mkdir } from "node:fs/promises";

// The tab keeps a slow poll running (`setInterval`) so repositories created
// while it is open show up without a manual refresh. The preview mounts
// components and never unmounts them, so those timers must not keep the
// process alive after the assertions are done.
const nativeSetInterval = globalThis.setInterval;
globalThis.setInterval = (fn, ms, ...rest) => {
	const id = nativeSetInterval(fn, ms, ...rest);
	if (id !== null && typeof id === "object" && typeof id.unref === "function") id.unref();
	return id;
};
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const libFile = join(root, "lib/client.js");

const argv = process.argv.slice(2);
const argValue = (name) => {
	const at = argv.indexOf(name);
	return at < 0 ? undefined : argv[at + 1];
};
const reposFile = argValue("--repos");
const focusArg = argValue("--focus");
const graphFiles = [];
for (let at = 0; at < argv.length; at += 1)
	if (argv[at] === "--graph" && argv[at + 1] !== undefined) graphFiles.push(argv[at + 1]);
const outFile = argValue("--out") !== undefined
	? argValue("--out")
	: argv[0] !== undefined && argv[0].charAt(0) !== "-"
		? argv[0]
		: join(root, "preview/graph-tab-preview.html");
const usingRealData = reposFile !== undefined || graphFiles.length > 0;

const WORKSPACE = "C:/Users/18316/Documents/deepseek-harness/default-workspace";
const NESTED = WORKSPACE + "/dsh-git-graph-src";

// ---------------------------------------------------------------- fake react
let currentRender = null;

function createElement(type, props, ...children) {
	const next = Object.assign({}, props);
	const flat = children.length === 1 ? children[0] : children.length > 0 ? children : undefined;
	if (flat !== undefined) next.children = flat;
	return { type, props: next };
}

function hookSlot() {
	const render = currentRender;
	const slot = render.index;
	render.index += 1;
	return { render, slot };
}

const fakeReact = {
	createElement,
	Fragment: "Fragment",
	useState(initial) {
		const { render, slot } = hookSlot();
		if (render.hooks[slot] === undefined) {
			render.hooks[slot] = { kind: "state", value: typeof initial === "function" ? initial() : initial };
		}
		const hook = render.hooks[slot];
		return [hook.value, (next) => {
			const value = typeof next === "function" ? next(hook.value) : next;
			if (!Object.is(value, hook.value)) {
				hook.value = value;
				render.instance.dirty = true;
			}
		}];
	},
	useMemo(factory, deps) {
		const { render, slot } = hookSlot();
		const previous = render.hooks[slot];
		if (previous !== undefined && sameDeps(previous.deps, deps)) return previous.value;
		const value = factory();
		render.hooks[slot] = { kind: "memo", deps, value };
		return value;
	},
	useCallback(fn, deps) {
		const { render, slot } = hookSlot();
		const previous = render.hooks[slot];
		if (previous !== undefined && sameDeps(previous.deps, deps)) return previous.value;
		render.hooks[slot] = { kind: "callback", deps, value: fn };
		return fn;
	},
	useRef(initial) {
		const { render, slot } = hookSlot();
		if (render.hooks[slot] === undefined) render.hooks[slot] = { kind: "ref", value: { current: initial } };
		return render.hooks[slot].value;
	},
	useEffect(effect, deps) {
		const { render, slot } = hookSlot();
		const previous = render.hooks[slot];
		if (previous !== undefined && sameDeps(previous.deps, deps)) return;
		render.hooks[slot] = { kind: "effect", deps };
		render.pendingEffects.push({ effect, slot });
	},
	useLayoutEffect(effect, deps) {
		fakeReact.useEffect(effect, deps);
	}
};

function sameDeps(left, right) {
	if (left === undefined || right === undefined) return false;
	if (left.length !== right.length) return false;
	return left.every((value, index) => Object.is(value, right[index]));
}

/**
 * Mount one component instance. Effects run to quiescence on every `render()`,
 * so a test can drive handlers (click a row, press zoom) and re-render into the
 * settled state, exactly like the tab behaves in the sidebar.
 */
async function mountComponent(component, props) {
	const instance = { hooks: [], dirty: false };
	// `html` and `tree` are refreshed by every render, so a test can click a
	// control and then look up the node it revealed on the next assertion.
	const mount = { instance, render: undefined, html: "", tree: null };
	const render = async () => {
		let last = { html: "", tree: null };
		for (let pass = 0; pass < 60; pass += 1) {
			instance.dirty = false;
			currentRender = { hooks: instance.hooks, index: 0, instance, pendingEffects: [] };
			let tree;
			let pending;
			try {
				tree = component(props);
			} finally {
				pending = currentRender.pendingEffects;
				currentRender = null;
			}
			for (const { effect } of pending) {
				const cleanup = await effect();
				if (typeof cleanup === "function") instance.cleanups = (instance.cleanups || []).concat(cleanup);
			}
			// let async work (fetch stubs resolve on the microtask/immediate queue)
			await new Promise((resolve) => setTimeout(resolve, 5));
			last = { html: serialize(tree), tree };
			if (!instance.dirty) break;
		}
		mount.html = last.html;
		mount.tree = last.tree;
		return last;
	};
	mount.render = render;
	await render();
	return mount;
}

/** Depth-first walk over an element tree, collecting host nodes that match. */
function findAll(tree, predicate) {
	const hits = [];
	const visit = (node) => {
		if (node === null || node === undefined || typeof node !== "object") return;
		if (Array.isArray(node)) {
			node.forEach(visit);
			return;
		}
		if (predicate(node)) hits.push(node);
		visit(node.props !== undefined ? node.props.children : undefined);
	};
	visit(tree);
	return hits;
}

function click(node, label) {
	const handler = node.props !== undefined ? node.props.onClick : undefined;
	if (typeof handler !== "function") throw new Error("node has no onClick: " + label);
	handler({ stopPropagation() {}, preventDefault() {} });
}

// ------------------------------------------------------------- html serializer
const VOID_TAGS = new Set(["circle", "path", "rect", "line", "br", "input", "img", "polyline", "polygon", "ellipse", "use"]);
const UNITLESS = new Set(["flex", "flexGrow", "flexShrink", "opacity", "zIndex", "lineHeight", "fontWeight", "order", "minHeight", "minWidth"]);

function kebabCase(name) {
	return name.replace(/[A-Z]/g, (char) => "-" + char.toLowerCase());
}

function styleToCss(style) {
	const parts = [];
	for (const [key, value] of Object.entries(style)) {
		if (value === undefined || value === null || value === "") continue;
		const name = key.startsWith("--") ? key : kebabCase(key);
		let text = String(value);
		if (typeof value === "number" && !UNITLESS.has(key) && !key.startsWith("--")) text = value + "px";
		parts.push(name + ":" + text);
	}
	return parts.join(";");
}

function escapeHtml(text) {
	return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function serialize(node, selectValue) {
	if (node === null || node === undefined || node === false || node === true) return "";
	if (typeof node === "string" || typeof node === "number") return escapeHtml(node);
	if (Array.isArray(node)) return node.map((child) => serialize(child, selectValue)).join("");
	if (typeof node.type === "function") return serialize(node.type(node.props), selectValue);
	if (node.type === "Fragment") return serialize(node.props.children, selectValue);
	const props = node.props || {};
	// React controls a <select> through its value property; a serialised `value`
	// attribute is inert, so the matching <option> has to carry `selected`.
	const childSelectValue = node.type === "select" && props.value !== undefined ? String(props.value) : selectValue;
	let attrs = "";
	for (const [key, value] of Object.entries(props)) {
		if (value === undefined || value === null || value === false) continue;
		if (key === "children" || key.startsWith("on")) continue;
		if (key === "value" && node.type === "select") continue;
		if (key === "style") {
			const css = styleToCss(value);
			if (css !== "") attrs += ' style="' + escapeHtml(css) + '"';
			continue;
		}
		attrs += " " + kebabCase(key) + '="' + escapeHtml(String(value)) + '"';
	}
	if (node.type === "option" && childSelectValue !== undefined && props.value !== undefined && String(props.value) === childSelectValue) {
		attrs += " selected";
	}
	const children = serialize(props.children, childSelectValue);
	const tag = node.type;
	if (VOID_TAGS.has(tag) && children === "") return "<" + tag + attrs + " />";
	return "<" + tag + attrs + ">" + children + "</" + tag + ">";
}

// --------------------------------------------------------------- canned repos
const NOW = Math.floor(Date.now() / 1000);

function commit(oid, parents, subject, author, ageHours, refs) {
	return { oid, parents, subject, author, authorTime: NOW - Math.round(ageHours * 3600), refs };
}

let ROOT_GRAPH = {
	root: WORKSPACE,
	branch: "main",
	hasMore: true,
	commits: [
		commit("9f4c1a7d2e8b3c5a6d7e8f90123456789abcdef0", ["4c2b8e1fa3d5c7b9e0f1a2b3c4d5e6f708192a3b", "8d1e5c3b7a9f2e4d6c8b0a1f3e5d7c9b2a4f6e8d"], "merge: sidebar graph tab into main", "Athos", 0.4, ["HEAD -> main", "origin/main"]),
		commit("4c2b8e1fa3d5c7b9e0f1a2b3c4d5e6f708192a3b", ["b7e2d9c4a1f8b6e3d0c7a5f2e9b6d4c1a8f5e2b9"], "feat(tab): SVG lane canvas with bezier merges", "Athos", 1.2, ["main"]),
		commit("8d1e5c3b7a9f2e4d6c8b0a1f3e5d7c9b2a4f6e8d", ["c3a9f7e5d1b8c6a4f2e0d9b7a5c3f1e8d6b4a2c9"], "fix(host): widen workspace gate to prefix membership", "Athos", 2.5, ["feature/multi-repo"]),
		commit("b7e2d9c4a1f8b6e3d0c7a5f2e9b6d4c1a8f5e2b9", ["5e1c8b4f7a2d9e6c3b0f8a5d2e7c4b1f9a6d3e0c"], "feat(tab): pin a commit card on click", "Athos", 3.1, []),
		commit("c3a9f7e5d1b8c6a4f2e0d9b7a5c3f1e8d6b4a2c9", ["5e1c8b4f7a2d9e6c3b0f8a5d2e7c4b1f9a6d3e0c"], "feat(host): /git/repos discovery with 60s cache", "Athos", 4.6, ["feature/multi-repo"]),
		commit("5e1c8b4f7a2d9e6c3b0f8a5d2e7c4b1f9a6d3e0c", ["d0f7b3a6c9e2d5b8a1f4c7e0b3d6a9f2c5e8b1d4"], "refactor: extract lane geometry builder", "Athos", 6.2, []),
		commit("d0f7b3a6c9e2d5b8a1f4c7e0b3d6a9f2c5e8b1d4", ["a6c9e2b5d8f1a4c7e0b3d6a9f2c5e8b1d4a7f0c3"], "chore: bump bundle to 0.5.2 (english dict fix)", "Athos", 9.5, []),
		commit("a6c9e2b5d8f1a4c7e0b3d6a9f2c5e8b1d4a7f0c3", ["e2b5d8a1c4f7e0b3d6a9f2c5e8b1d4a7f0c3e6b9"], "docs: FORK-NOTES with the link: incident", "Athos", 14.0, []),
		commit("e2b5d8a1c4f7e0b3d6a9f2c5e8b1d4a7f0c3e6b9", ["7b0d4f8a2c6e0b4d8f2a6c0e4b8d2f6a0c4e8b1d"], "test: offline preview harness for the tab", "Athos", 20.0, ["v0.5.2"]),
		commit("7b0d4f8a2c6e0b4d8f2a6c0e4b8d2f6a0c4e8b1d", ["1c5e9b3d7f0a4c8e2b6d0f4a8c2e6b0d4f8a1c5e"], "feat(tab): repository switcher + zoom controls", "Athos", 30.0, []),
		commit("1c5e9b3d7f0a4c8e2b6d0f4a8c2e6b0d4f8a1c5e", ["f8a2c6e0b4d8f2a6c0e4b8d2f6a0c4e8b1d7b0d4"], "feat(chip): keep the existing graph dialog untouched", "Athos", 44.0, []),
		commit("f8a2c6e0b4d8f2a6c0e4b8d2f6a0c4e8b1d7b0d4", [], "chore: import 0.4.8 upstream sources", "Athos", 60.0, ["v0.4.8"])
	]
};

let NESTED_GRAPH = {
	root: NESTED,
	branch: "feature/multi-repo",
	hasMore: false,
	commits: [
		commit("3d7b1f5a9c2e6b0d4f8a2c6e0b4d8f2a6c0e4b8d", ["a1f4c7e0b3d6a9f2c5e8b1d4a7f0c3e6b9d2a5f8"], "feat(tab): colour palette per lane", "Athos", 0.8, ["HEAD -> feature/multi-repo"]),
		commit("a1f4c7e0b3d6a9f2c5e8b1d4a7f0c3e6b9d2a5f8", ["6c0e4b8d2f6a0c4e8b1d7b0d4f8a2c6e0b4d8f2a"], "feat(tab): bezier parent edges, merge diamonds", "Athos", 2.0, []),
		commit("6c0e4b8d2f6a0c4e8b1d7b0d4f8a2c6e0b4d8f2a", ["b4d8f2a6c0e4b8d2f6a0c4e8b1d7b0d4f8a2c6e0", "3d7b1f5a9c2e6b0d4f8a2c6e0b4d8f2a6c0e4b8d"], "merge: preview harness", "Athos", 5.0, []),
		commit("b4d8f2a6c0e4b8d2f6a0c4e8b1d7b0d4f8a2c6e0", ["e0b4d8f2a6c0e4b8d2f6a0c4e8b1d7b0d4f8a2c6"], "chore: preview css variables", "Athos", 8.0, []),
		commit("e0b4d8f2a6c0e4b8d2f6a0c4e8b1d7b0d4f8a2c6", [], "chore: bootstrap nested sample", "Athos", 12.0, [])
	]
};

let REPOS = {
	base: WORKSPACE,
	maxDepth: 3,
	scannedAt: Date.now(),
	truncated: false,
	conventions: { doc: "GIT_CONVENTIONS.md", autoScaffold: true },
	repos: [
		{
			path: WORKSPACE,
			root: WORKSPACE,
			name: "default-workspace",
			relPath: "",
			kind: "root",
			outside: false,
			conventions: {
				doc: "GIT_CONVENTIONS.md",
				docPath: WORKSPACE + "/GIT_CONVENTIONS.md",
				exists: true,
				size: 2048,
				draft: false
			},
			status: {
				root: WORKSPACE,
				branch: "main",
				head: ROOT_GRAPH.commits[0].oid,
				dirtyFiles: 3,
				untrackedFiles: 2,
				conflicts: 0,
				operationInProgress: false
			}
		},
		{
			path: NESTED,
			root: NESTED,
			name: "dsh-git-graph-src",
			relPath: "dsh-git-graph-src",
			kind: "nested",
			outside: false,
			conventions: {
				doc: "GIT_CONVENTIONS.md",
				docPath: NESTED + "/GIT_CONVENTIONS.md",
				exists: true,
				size: 900,
				draft: true
			},
			status: {
				root: NESTED,
				branch: "feature/multi-repo",
				head: NESTED_GRAPH.commits[0].oid,
				dirtyFiles: 0,
				untrackedFiles: 0,
				conflicts: 0,
				operationInProgress: false
			}
		},
		{
			path: WORKSPACE + "/dsh-git-graph-dist",
			root: WORKSPACE + "/dsh-git-graph-dist",
			name: "dsh-git-graph-dist",
			relPath: "dsh-git-graph-dist",
			kind: "nested",
			outside: false,
			conventions: {
				doc: "GIT_CONVENTIONS.md",
				docPath: WORKSPACE + "/dsh-git-graph-dist/GIT_CONVENTIONS.md",
				exists: false,
				size: 0,
				draft: false
			},
			status: null
		},
		// Deep entry: exercises the intermediate directory rows. Real discovery
		// never descends inside a repository, so the parents are plain folders.
		{
			path: WORKSPACE + "/tools/releases/nightly",
			root: WORKSPACE + "/tools/releases/nightly",
			name: "nightly",
			relPath: "tools/releases/nightly",
			kind: "nested",
			outside: false,
			conventions: {
				doc: "GIT_CONVENTIONS.md",
				docPath: WORKSPACE + "/tools/releases/nightly/GIT_CONVENTIONS.md",
				exists: true,
				size: 1200,
				draft: false
			},
			status: {
				root: WORKSPACE + "/tools/releases/nightly",
				branch: "wt/nightly",
				head: NESTED_GRAPH.commits[0].oid,
				dirtyFiles: 1,
				untrackedFiles: 0,
				conflicts: 0,
				operationInProgress: false
			}
		},
		// A freshly initialised repository: no commit yet (unborn HEAD) and no
		// convention document. This is the trigger the conventions feature is
		// built around, so the harness renders it and watches the auto scaffold.
		{
			path: WORKSPACE + "/sandbox/blank",
			root: WORKSPACE + "/sandbox/blank",
			name: "blank",
			relPath: "sandbox/blank",
			kind: "nested",
			outside: false,
			conventions: {
				doc: "GIT_CONVENTIONS.md",
				docPath: WORKSPACE + "/sandbox/blank/GIT_CONVENTIONS.md",
				exists: false,
				size: 0,
				draft: false
			},
			status: {
				root: WORKSPACE + "/sandbox/blank",
				branch: "main",
				head: "",
				dirtyFiles: 0,
				untrackedFiles: 0,
				conflicts: 0,
				operationInProgress: false
			}
		}
	]
};

// The six proven frameworks the host serves on /git/conventions. The harness
// only needs the card fields; the document bodies live on the host.
const CONVENTION_CATALOG = [
	{ id: "conventional-commits", name: "Conventional Commits", nameZh: "约定式提交", tagline: "type(scope): subject, with a machine-readable body and footer", taglineZh: "type(scope): 描述，正文与脚注机器可读", bestFor: "projects that generate changelogs", bestForZh: "需要自动生成变更日志的项目", url: "https://www.conventionalcommits.org/" },
	{ id: "github-flow", name: "GitHub Flow", nameZh: "GitHub Flow", tagline: "short-lived branches, one review, merge to main", taglineZh: "短分支、一次评审、合并回主干", bestFor: "continuously deployed web apps", bestForZh: "持续部署的 Web 应用", url: "https://docs.github.com/get-started/using-github/github-flow" },
	{ id: "git-flow", name: "Git Flow", nameZh: "Git Flow", tagline: "main, develop, release, hotfix and feature branches", taglineZh: "main/develop/release/hotfix/feature 五类分支", bestFor: "versioned releases with several supported versions", bestForZh: "多版本并行维护的发布节奏", url: "https://nvie.com/posts/a-successful-git-branching-model/" },
	{ id: "trunk-based", name: "Trunk-Based Development", nameZh: "主干开发", tagline: "tiny commits straight to trunk behind flags", taglineZh: "小步提交直接进主干，用特性开关隔离", bestFor: "high-trust teams with strong CI", bestForZh: "CI 完善、协作紧密的团队", url: "https://trunkbaseddevelopment.com/" },
	{ id: "conventional-branch", name: "Conventional Branch", nameZh: "约定式分支名", tagline: "feature/, bugfix/, hotfix/, release/ with ticket ids", taglineZh: "feature/、bugfix/、hotfix/、release/ 加需求编号", bestFor: "repositories that mine branch names in tooling", bestForZh: "用工具依赖分支名做自动化的仓库", url: "https://conventional-branch.github.io/" },
	{ id: "gitlab-flow", name: "GitLab Flow", nameZh: "GitLab Flow", tagline: "environment branches plus feature branches", taglineZh: "环境分支加特性分支", bestFor: "staged deployments (staging before production)", bestForZh: "分阶段发布（预发再上线）", url: "https://docs.gitlab.com/ee/topics/gitlab_flow.html" }
];

// --------------------------------------------------- optional real workspace
// `--repos` / `--graph` replace the canned samples with live host responses, so
// the same harness can render a real repository (used for the branch/merge
// demo under <workspace>/graph-demo). A file may hold the bare view or the
// `{ok:true,value}` envelope that the host routes return.
const viewKey = (path) => String(path).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
let GRAPH_BY_ROOT = null;

async function readView(file) {
	const raw = JSON.parse(await readFile(file, "utf8"));
	return raw !== null && typeof raw === "object" && raw.ok === true && raw.value !== undefined ? raw.value : raw;
}

if (usingRealData) {
	if (reposFile !== undefined) REPOS = await readView(reposFile);
	if (graphFiles.length > 0) {
		GRAPH_BY_ROOT = new Map();
		for (const file of graphFiles) {
			const view = await readView(file);
			GRAPH_BY_ROOT.set(viewKey(view.root), view);
		}
		const first = GRAPH_BY_ROOT.values().next().value;
		if (first !== undefined) ROOT_GRAPH = first;
	}
}

// ------------------------------------------------------------------- stubs
const styles = [];
function fakeElement(tag) {
	return {
		tagName: tag,
		style: {},
		dataset: {},
		textContent: "",
		setAttribute() {},
		removeAttribute() {},
		appendChild() {},
		remove() {},
		select() {},
		addEventListener() {},
		removeEventListener() {},
		hasAttribute() { return false; }
	};
}
const fakeDocument = {
	head: { appendChild(element) { styles.push(element.textContent); } },
	body: (() => {
		// EXPORT_DARK=1 flips the theme the same way the app does, so the exported
		// palette can be checked without a browser.
		const body = fakeElement("body");
		if (process.env.EXPORT_DARK === "1") body.hasAttribute = (name) => name === "data-ds-dark-theme";
		return body;
	})(),
	documentElement: fakeElement("html"),
	baseURI: "http://127.0.0.1:56515/",
	createElement: fakeElement,
	execCommand() { return true; },
	querySelector() { return null; },
	querySelectorAll() { return []; },
	getElementById() { return null; },
	addEventListener() {},
	removeEventListener() {}
};

const INIT_CALLS = [];
/** Every string the tab asked the clipboard to hold. */
const COPIED = [];
/** Every `git/convention` write the tab asked for. */
const CONVENTION_CALLS = [];
/** Every workspace document write, and the shared document's fake state. */
const WORKSPACE_CALLS = [];
const WORKSPACE_DOC = { exists: false, draft: false, size: 0 };
const fakeFetch = async (path, init) => {
	const payload = init !== undefined && typeof init.body === "string" ? JSON.parse(init.body) : {};
	let value;
	if (path === "git/repos") value = REPOS;
	else if (path === "git/init") {
		INIT_CALLS.push(Object.assign({}, payload));
		value = { root: payload.path, branch: payload.branch === undefined ? "main" : payload.branch };
	}
	else if (path === "git/graph") {
		const key = viewKey(payload.path);
		value = GRAPH_BY_ROOT !== null && GRAPH_BY_ROOT.has(key)
			? GRAPH_BY_ROOT.get(key)
			: String(payload.path).indexOf("dsh-git-graph-src") >= 0 ? NESTED_GRAPH : ROOT_GRAPH;
	} else if (path === "git/cleanup") {
		const repo = (REPOS.repos || []).find((item) => viewKey(item.path) === viewKey(payload.path)) || {};
		const status = repo.status !== undefined && repo.status !== null ? repo.status : {};
		const branch = typeof status.branch === "string" && status.branch !== "" ? status.branch : "main";
		const now = Math.floor(Date.now() / 1000);
		value = {
			root: repo.root !== undefined ? repo.root : payload.path,
			branch,
			base: "main",
			truncated: false,
			branches: [
				{ name: "main", current: branch === "main", upstream: "origin/main", lastCommit: now - 7200, stale: false, base: true, merged: true, unmerged: null },
				{ name: "feature/merged-old", current: false, upstream: "", lastCommit: now - 864000, stale: true, base: false, merged: true, unmerged: 0 },
				{ name: "feature/c", current: branch === "feature/c", upstream: "", lastCommit: now - 1800, stale: false, base: false, merged: false, unmerged: 3 }
			]
		};
	} else if (path === "git/health") {
		value = {
			root: payload.path,
			branch: "main",
			detached: false,
			dirtyFiles: 2,
			conflicts: 0,
			operationInProgress: null,
			stash: 1,
			branches: 3,
			noUpstream: ["feature/c"],
			noUpstreamCount: 1,
			stale: ["feature/merged-old"],
			untracked: 4,
			untrackedScanned: 4,
			bigUntracked: [{ path: "tmp/archive.zip", bytes: 5242880 }],
			gitBytes: 3670016,
			checkedAt: Date.now()
		};
	} else if (path === "git/conventions") {
		const entry = (REPOS.repos || []).find((item) => viewKey(item.path) === viewKey(payload.path));
		const state = entry !== undefined && entry.conventions !== undefined && entry.conventions !== null
			? entry.conventions
			: { doc: "GIT_CONVENTIONS.md", docPath: String(payload.path) + "/GIT_CONVENTIONS.md", exists: false, size: 0, draft: false };
		value = Object.assign({ root: payload.path, autoScaffold: REPOS.conventions === undefined || REPOS.conventions.autoScaffold !== false, catalog: CONVENTION_CATALOG }, state);
	} else if (path === "git/convention") {
		// The host writes the document and reports the new state; the stub flips
		// the repository entry so the following /git/repos refresh sees it.
		const framework = typeof payload.framework === "string" ? payload.framework : "none";
		const docPath = String(payload.path) + "/GIT_CONVENTIONS.md";
		CONVENTION_CALLS.push(Object.assign({}, payload));
		const bytes = framework === "none" ? 820 : 2400;
		const entry = (REPOS.repos || []).find((item) => viewKey(item.path) === viewKey(payload.path));
		if (entry !== undefined) entry.conventions = { doc: "GIT_CONVENTIONS.md", docPath, exists: true, size: bytes, draft: framework === "none" };
		value = { root: payload.path, docPath, bytes, created: true, framework, doc: "GIT_CONVENTIONS.md" };
	} else if (path === "git/compliance") {
		const entry = (REPOS.repos || []).find((item) => viewKey(item.path) === viewKey(payload.path));
		const state = entry !== undefined && entry.conventions !== undefined && entry.conventions !== null ? entry.conventions : null;
		const exists = state !== null && state.exists === true;
		value = {
			root: payload.path,
			doc: "GIT_CONVENTIONS.md",
			docPath: String(payload.path) + "/GIT_CONVENTIONS.md",
			exists,
			enforced: exists,
			strict: true,
			checked: 5,
			failing: exists ? 2 : 0,
			rules: { maxSubject: 72, types: ["feat", "fix", "docs"], lowercase: true, noPeriod: true, imperative: true },
			offenders: exists ? [
				{ oid: "aaaaaaa", subject: "Fixed the parser crash.", reasons: ["case", "period"] },
				{ oid: "bbbbbbb", subject: "chore: tidy the tree", reasons: ["type"] }
			] : []
		};
	} else if (path === "git/convention/preview") {
		const framework = typeof payload.framework === "string" ? payload.framework : "none";
		value = {
			root: payload.path,
			doc: "GIT_CONVENTIONS.md",
			docPath: String(payload.path) + "/GIT_CONVENTIONS.md",
			exists: true,
			size: 900,
			draft: false,
			framework,
			currentBytes: 900,
			nextBytes: 2400,
			added: 3,
			changed: 1,
			removed: 0,
			same: 2,
			removedTitles: [],
			sections: [
				{ title: "Header", status: "same", dropped: [], fresh: [] },
				{ title: "Commit types", status: "changed", dropped: ["old line"], fresh: ["new line"] },
				{ title: "Review", status: "added", dropped: [], fresh: ["review line"] },
				{ title: "Release", status: "added", dropped: [], fresh: [] }
			]
		};
	} else if (path === "git/workspace-convention") {
		const action = typeof payload.action === "string" ? payload.action : "state";
		const docPath = WORKSPACE + "/.dsh/GIT_CONVENTIONS.md";
		if (action === "write") {
			WORKSPACE_DOC.exists = true;
			WORKSPACE_DOC.draft = true;
			WORKSPACE_DOC.size = 900;
			WORKSPACE_CALLS.push(Object.assign({}, payload));
			value = { root: WORKSPACE, doc: ".dsh/GIT_CONVENTIONS.md", docPath, bytes: 900, created: true, framework: "none" };
		} else value = Object.assign({ root: WORKSPACE, doc: ".dsh/GIT_CONVENTIONS.md", docPath, catalog: CONVENTION_CATALOG }, WORKSPACE_DOC);
	} else value = { ok: false, error: { code: "not-found", message: "stub" } };
	return { ok: true, json: async () => ({ ok: true, value }) };
};

const fakeLocalStorage = {
	getItem() { return null; },
	setItem() {},
	removeItem() {}
};

// -------------------------------------------------------------- load bundle
const source = await readFile(libFile, "utf8");
let captured;
const fakeWindow = {
	__ModuleLoader__: { load(definition) { captured = definition; } },
	addEventListener() {},
	removeEventListener() {},
	setTimeout,
	clearTimeout,
	setInterval: () => 0,
	clearInterval() {},
	localStorage: fakeLocalStorage,
	location: { href: "http://127.0.0.1:56515/", origin: "http://127.0.0.1:56515" },
	matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
};
const fakeNavigator = {
	language: "zh-CN",
	userAgent: "node-preview",
	clipboard: {
		writeText(value) {
			COPIED.push(String(value));
			return Promise.resolve();
		}
	}
};

const loadBundle = new Function("window", "document", "navigator", "localStorage", "fetch", "self", "globalThis", source);
loadBundle(fakeWindow, fakeDocument, fakeNavigator, fakeLocalStorage, fakeFetch, fakeWindow, globalThis);

if (captured === undefined) throw new Error("bundle did not call window.__ModuleLoader__.load");
const requireStub = (id) => {
	if (id === "react") return fakeReact;
	if (id === "react-dom") return { createPortal: (element) => element, render() {}, createRoot: () => ({ render() {}, unmount() {} }) };
	if (id === "react/jsx-runtime") return { jsx: createElement, jsxs: createElement, Fragment: "Fragment" };
	if (id === "@deepseek-ai/dsh-client-ui-primitives") return new Proxy({}, { get: () => () => null });
	throw new Error("unexpected require: " + id);
};
const plugin = captured.factory(requireStub);

// -------------------------------------------------------------- run apply()
let descriptor;
const sessions = { list: { getSnapshot: () => ({ byId: { session: { cwd: WORKSPACE } } }) } };
const betterSidebar = {
	version: 1,
	features: ["tabLifecycle", "updateTab"],
	registerTab(next) { descriptor = next; return () => {}; },
	updateTab() {}
};
const locale = {
	register() { return () => {}; },
	bind() { return (key) => key; },
	subscribe() { return () => {}; }
};
const silent = { info() {}, warn() {}, error() {}, debug() {} };

const ctx = {
	effect(effect) {
		try {
			return effect();
		} catch {
			return () => {};
		}
	},
	inject(services, callback) {
		// Only the sidebar-tab injection is wired: the other two belong to the
		// chip/worktree faces that this preview does not render.
		if (Array.isArray(services) && services.indexOf("betterSidebar") >= 0) {
			callback({
				betterSidebar,
				sessions,
				locale,
				logger: silent,
				effect(effect) {
					try {
						return effect();
					} catch {
						return () => {};
					}
				}
			});
		}
	},
	locale,
	logger: silent,
	connection: { on() { return () => {}; } }
};

plugin.apply(ctx);
if (descriptor === undefined) throw new Error("apply() did not register the sidebar tab");

const tabProps = (repoPath) => ({
	ctx: { locale, logger: silent, betterSidebar },
	store: {},
	scope: { sessionId: "session", cwd: WORKSPACE },
	tab: { id: descriptor.id, type: descriptor.id, title: descriptor.title, meta: repoPath === undefined ? {} : { repoPath } },
	visible: true
});

// `--focus <relPath|path>` renders that repository in the first panel instead of
// whatever the discovery order puts first — handy when demoing one repository.
const focusEntry = focusArg !== undefined
	? (REPOS.repos || []).find((entry) => viewKey(entry.relPath || "") === viewKey(focusArg) || viewKey(entry.path).endsWith("/" + viewKey(focusArg)))
	: undefined;
const focusPath = focusEntry !== undefined ? focusEntry.path : undefined;

const rootMount = await mountComponent(descriptor.component, tabProps(focusPath));
// Second panel: a nested repository, so the tree highlight and the status row
// are exercised with something other than the default selection.
const secondaryRepo = usingRealData
	? (REPOS.repos || []).find((entry) => viewKey(entry.path) !== viewKey(focusPath === undefined ? REPOS.base : focusPath) && entry.status !== null)
	: undefined;
const secondaryPath = secondaryRepo !== undefined ? secondaryRepo.path : NESTED;
const secondaryLabel = secondaryRepo !== undefined ? secondaryRepo.relPath || secondaryRepo.name : "feature/multi-repo";
const nestedMount = await mountComponent(descriptor.component, tabProps(secondaryPath));
const detailMount = await mountComponent(descriptor.component, tabProps(focusPath));

// Drive the real handlers: pin a row, then zoom in until rows switch to two
// lines. This is a behaviour smoke test, not a screenshot trick.
const rows = findAll(detailMount.tree, (node) => node.props !== undefined && node.props["data-gitgraph-row"] === true);
if (rows.length < 3) throw new Error("expected at least 3 commit rows, got " + rows.length);
click(rows[2], "commit row");
let detailHtml = (await detailMount.render()).html;
if (detailHtml.indexOf("data-gitgraph-detail") < 0) throw new Error("clicking a row did not open the commit card");
// One step down folds every row back into a single line (compact mode).
for (let step = 0; step < 1; step += 1) {
	const zoomOut = findAll(detailMount.tree, (node) => node.props !== undefined && node.props["data-gitgraph-zoom"] === "out");
	if (zoomOut.length === 0) throw new Error("zoom-out control missing");
	click(zoomOut[0], "zoom out");
	detailHtml = (await detailMount.render()).html;
}
if (detailHtml.indexOf("data-gitgraph-detail") < 0) throw new Error("zooming lost the pinned commit card");

// The copy action turns its label into the "copied" confirmation (the
// clipboard call is stubbed to succeed).
const canvasHosts = findAll(detailMount.tree, (node) => node.props !== undefined && node.props["data-gitgraph-canvas"] === true);
if (canvasHosts.length === 0) throw new Error("graph canvas host missing");
if (findAll(detailMount.tree, (node) => node.props !== undefined && node.props["data-gitgraph-tooltip"] === true).length > 0) {
    throw new Error("the hover card was removed but a tooltip is still rendered");
}
const copyButton = findAll(detailMount.tree, (node) => node.props !== undefined && node.props["data-gitgraph-action"] === "copy-info")[0];
if (copyButton === undefined) throw new Error("commit card has no copy action");
click(copyButton, "copy commit info");
detailHtml = (await detailMount.render()).html;
if (!/已复制|Copied/.test(detailHtml)) throw new Error("copy action did not confirm");

// The second copy action is the one the feature exists for: a rollback prompt
// an agent can act on, carrying both SHAs and all three candidate commands.
const rollbackButton = findAll(detailMount.tree, (node) => node.props !== undefined && node.props["data-gitgraph-action"] === "copy-rollback")[0];
if (rollbackButton === undefined) throw new Error("commit card has no rollback prompt action");
click(rollbackButton, "copy rollback prompt");
await detailMount.render();
const rollbackText = COPIED[COPIED.length - 1] ?? "";
for (const expected of ["git revert ", "git reset --hard ", "git cherry-pick ", "Path: "]) {
	if (rollbackText.indexOf(expected) < 0) throw new Error("rollback prompt is missing " + JSON.stringify(expected) + ": " + rollbackText.slice(0, 200));
}
if (process.env.PRINT_ROLLBACK === "1") console.log(String.fromCharCode(10) + rollbackText + String.fromCharCode(10));
console.log("preview-tab: rollback prompt names all three commands (" + rollbackText.length + " chars)");

// --- Tier 1: search and ref toggles -----------------------------------------
const rowNodes = (mount) => findAll(mount.tree, (node) => node.props !== undefined && node.props["data-gitgraph-row"] === true);

// --- Tier 1 item 3: export ---------------------------------------------------
// The harness has no object URLs, so the action must fall back to copying the
// markup; the SVG itself is the deliverable and is what gets checked here.
const exportButton = findAll(detailMount.tree, (node) => node.props !== undefined && node.props["data-gitgraph-action"] === "export")[0];
if (exportButton === undefined) throw new Error("toolbar has no export action");
const copiedBeforeExport = COPIED.length;
click(exportButton, "export image");
detailHtml = (await detailMount.render()).html;
if (!/已导出|已复制|Exported|SVG copied/.test(detailHtml)) throw new Error("export action did not confirm");
if (COPIED.length !== copiedBeforeExport + 1) throw new Error("export produced neither a download nor copied markup");
const exportedSvg = COPIED[COPIED.length - 1] ?? "";
if (exportedSvg.slice(0, 4) !== "<svg") throw new Error("exported markup does not start with <svg: " + exportedSvg.slice(0, 60));
const exportRepoName = usingRealData ? "graph-demo" : focusEntry !== undefined ? focusEntry.name : "default-workspace";
for (const expected of ["xmlns=\"http://www.w3.org/2000/svg\"", "viewBox=\"0 0 ", "<title>", exportRepoName, "data-gitgraph-export-row="]) {
	if (exportedSvg.indexOf(expected) < 0) throw new Error("exported SVG is missing " + JSON.stringify(expected));
}
if (exportedSvg.indexOf("var(--") >= 0) throw new Error("exported SVG still relies on CSS variables");
if (exportedSvg.indexOf('data-gitgraph-export-pinned="true"') < 0) throw new Error("the pinned commit is not marked in the exported image");
if (process.env.EXPORT_DARK === "1") {
	if (exportedSvg.indexOf('fill="#0f1115"') < 0) throw new Error("dark export is missing the dark background");
} else if (exportedSvg.indexOf('fill="#ffffff"') < 0) throw new Error("light export is missing its background");
// The lane geometry keeps its own row pitch: a zoomed panel must not produce
// an image whose nodes drift away from the rows they belong to.
const panelRowHeight = Number(rowNodes(detailMount)[0].props.style.height);
const laneYs = Array.from(new Set((exportedSvg.match(/<circle cx="[0-9.]+" cy="([0-9.]+)"/g) ?? []).map((tag) => Number(tag.slice(tag.indexOf("cy=\"") + 4, -1))))).sort((a, b) => a - b);
if (laneYs.length > 1 && laneYs[1] - laneYs[0] !== panelRowHeight) {
	throw new Error("exported lanes use a " + (laneYs[1] - laneYs[0]) + "px pitch, the panel rows are " + panelRowHeight + "px");
}
const exportedRows = (exportedSvg.match(/data-gitgraph-export-row=/g) ?? []).length;
if (exportedRows !== rowNodes(detailMount).length) throw new Error("exported SVG has " + exportedRows + " rows, the panel has " + rowNodes(detailMount).length);
console.log("preview-tab: exported a standalone SVG (" + exportedSvg.length + " chars, " + exportedRows + " rows)");
if (process.env.EXPORT_SVG_PATH !== undefined) {
	const { writeFileSync } = await import("node:fs");
	writeFileSync(process.env.EXPORT_SVG_PATH, exportedSvg, "utf8");
	console.log("preview-tab: wrote " + process.env.EXPORT_SVG_PATH);
}
const searchField = findAll(detailMount.tree, (node) => node.props !== undefined && node.props["data-gitgraph-search"] === true)[0];
if (searchField === undefined) throw new Error("filter bar has no search field");
const rowsBeforeSearch = rowNodes(detailMount).length;
searchField.props.onChange({ target: { value: "changelog" } });
await detailMount.render();
const rowsAfterSearch = rowNodes(detailMount);
if (rowsAfterSearch.length === 0) throw new Error("search removed every row instead of narrowing");
if (rowsAfterSearch.length >= rowsBeforeSearch) throw new Error("search did not narrow the rows: " + rowsBeforeSearch + " -> " + rowsAfterSearch.length);
const filteredChip = findAll(detailMount.tree, (node) => node.props !== undefined && node.props["data-gitgraph-filtered"] === true)[0];
if (filteredChip === undefined) throw new Error("filtered counter is missing");

// Clearing the query brings every row back.
const clearField = findAll(detailMount.tree, (node) => node.props !== undefined && node.props["data-gitgraph-search"] === true)[0];
clearField.props.onChange({ target: { value: "" } });
await detailMount.render();
if (rowNodes(detailMount).length !== rowsBeforeSearch) throw new Error("clearing the search did not restore the rows");

// A ref toggle hides the commits that only that ref reaches.
const refToggles = findAll(detailMount.tree, (node) => node.props !== undefined && typeof node.props["data-gitgraph-ref-filter"] === "string");
if (refToggles.length === 0) throw new Error("filter bar lists no refs");
// Not every ref hides something: the commits of a merged branch are still
// reachable from main, so that toggle correctly keeps them. Walk the toggles
// until one actually removes rows, then undo it and check the rows come back.
let mutedRefName = "";
let hiddenByRef = 0;
for (const toggle of refToggles) {
	const name = toggle.props["data-gitgraph-ref-filter"];
	click(toggle, "toggle ref " + name);
	await detailMount.render();
	const after = rowNodes(detailMount).length;
	if (after < rowsBeforeSearch) {
		mutedRefName = name;
		hiddenByRef = rowsBeforeSearch - after;
		const muted = findAll(detailMount.tree, (node) => node.props !== undefined && node.props["data-gitgraph-ref-filter"] === name)[0];
		if (muted === undefined || muted.props["data-gitgraph-ref-muted"] !== "true") throw new Error("muted ref is not marked");
		click(muted, "unmute ref " + name);
		await detailMount.render();
		if (rowNodes(detailMount).length !== rowsBeforeSearch) throw new Error("unmuting the ref did not restore the rows");
		break;
	}
	const restore = findAll(detailMount.tree, (node) => node.props !== undefined && node.props["data-gitgraph-ref-filter"] === name)[0];
	if (restore === undefined) throw new Error("ref toggle disappeared: " + name);
	click(restore, "restore ref " + name);
	await detailMount.render();
}
if (mutedRefName === "") throw new Error("no ref toggle hid any commit");
console.log("preview-tab: search narrows to " + rowsAfterSearch.length + " of " + rowsBeforeSearch + " rows, muting " + mutedRefName + " hides " + hiddenByRef);

// The toolbar carries only what the panel still offers: the full-window view
// and the workspace overview were removed, the graph export stayed.
const bareMount = await mountComponent(descriptor.component, tabProps(focusPath));
await bareMount.render();
const bareActions = findAll(bareMount.tree, (node) => node.props !== undefined && typeof node.props["data-gitgraph-action"] === "string").map((node) => node.props["data-gitgraph-action"]);
if (bareActions.indexOf("expand") >= 0) throw new Error("the full-window control is still in the toolbar");
if (bareActions.indexOf("overview") >= 0) throw new Error("the overview switch is still in the toolbar");
if (bareActions.indexOf("export") < 0) throw new Error("the export control is missing from the toolbar");
if (bareActions.indexOf("refresh") < 0) throw new Error("the refresh control is missing from the toolbar");
if (findAll(bareMount.tree, (node) => node.props !== undefined && node.props["data-gitgraph-overview-list"] === true).length > 0) throw new Error("the overview list is still rendered");
console.log("preview-tab: toolbar offers " + bareActions.join(", "));

// A refresh must never blank the panel. The scan keeps its previous rows on
// screen while the request is in flight, and an identical result leaves the
// rendered tree untouched (no scroll jump, no loading placeholder).
const refreshMount = await mountComponent(descriptor.component, tabProps(focusPath));
const rowsBefore = findAll(refreshMount.tree, (node) => node.props !== undefined && node.props["data-gitgraph-row"] === true).length;
const reposBefore = findAll(refreshMount.tree, (node) => node.props !== undefined && node.props["data-gitgraph-repo"] !== undefined).length;
const refreshButton = findAll(refreshMount.tree, (node) => node.props !== undefined && node.props["data-gitgraph-action"] === "refresh")[0];
if (refreshButton === undefined) throw new Error("toolbar has no refresh control");
click(refreshButton, "refresh");
const refreshHtml = (await refreshMount.render()).html;
if (refreshHtml.indexOf("data-gitgraph-row") < 0) throw new Error("refreshing blanked the commit rows");
if (refreshHtml.indexOf("data-gitgraph-repo-tree") < 0) throw new Error("refreshing blanked the repository tree");
const rowsAfter = findAll(refreshMount.tree, (node) => node.props !== undefined && node.props["data-gitgraph-row"] === true).length;
const reposAfter = findAll(refreshMount.tree, (node) => node.props !== undefined && node.props["data-gitgraph-repo"] !== undefined).length;
if (rowsAfter !== rowsBefore) throw new Error("refresh changed the commit row count: " + rowsBefore + " -> " + rowsAfter);
if (reposAfter !== reposBefore) throw new Error("refresh changed the repository row count: " + reposBefore + " -> " + reposAfter);
console.log("preview-tab: refresh keeps content on screen ok");

// A closed tab is unmounted by better-sidebar, so a reopen must paint from the
// module cache on its very first frame instead of flashing an empty panel.
const reopenInstance = { hooks: [], dirty: false };
currentRender = { hooks: reopenInstance.hooks, index: 0, instance: reopenInstance, pendingEffects: [] };
let reopenTree;
try {
	reopenTree = descriptor.component(tabProps(focusPath));
} finally {
	currentRender = null;
}
const reopenFirst = serialize(reopenTree);
if (reopenFirst.indexOf("data-gitgraph-row") < 0) throw new Error("reopened tab painted no commit rows on its first frame");
if (reopenFirst.indexOf("data-gitgraph-repo-tree") < 0) throw new Error("reopened tab painted no repository tree on its first frame");
console.log("preview-tab: reopen paints from cache ok");

// Repository switching: clicking another row in the tree must reload that
// repository's graph and move the active highlight (choose() + fetch + state).
const switchMount = await mountComponent(descriptor.component, tabProps(focusPath));
const switchBaseKey = viewKey(focusPath === undefined ? REPOS.base : focusPath);
const beforeSwitchHtml = (await switchMount.render()).html;
const repoRows = findAll(switchMount.tree, (node) => node.props !== undefined && typeof node.props["data-gitgraph-repo"] === "string");
if (repoRows.length < 3) throw new Error("expected at least 3 repository tree rows, got " + repoRows.length);
const targetRow = usingRealData
	? repoRows.find((node) => viewKey(node.props["data-gitgraph-repo"]) !== switchBaseKey)
	: repoRows.find((node) => viewKey(node.props["data-gitgraph-repo"]).endsWith("/dsh-git-graph-src"));
if (targetRow === undefined) throw new Error("no second repository row to switch to in the repository tree");
click(targetRow, "repository tree row");
const switchedHtml = (await switchMount.render()).html;
if (!usingRealData && switchedHtml.indexOf("colour palette per lane") < 0) throw new Error("selecting a repository did not load its graph");
if (usingRealData && switchedHtml === beforeSwitchHtml) throw new Error("selecting a repository did not change the rendered graph");
if (switchedHtml.indexOf("data-gitgraph-repo-active") < 0) throw new Error("the selected repository is not highlighted in the tree");
console.log("preview-tab: repository switch ok (" + repoRows.length + " tree rows, " +
	(usingRealData ? "real repository graph loaded" : "nested graph loaded") + ")");


// The conventions strip: an unborn repository without a document must make the
// tab write the empty scaffold by itself and open the framework picker.
let conventionsHtml = "";
if (!usingRealData) {
	const blankEntry = REPOS.repos.find((entry) => entry.relPath === "sandbox/blank");
	if (blankEntry === undefined) throw new Error("preview data lost the blank repository");
	const blankMount = await mountComponent(descriptor.component, tabProps(blankEntry.path));
	await new Promise((resolve) => setTimeout(resolve, 40));
	let blankHtml = (await blankMount.render()).html;
	if (blankHtml.indexOf("data-gitgraph-conventions") < 0) throw new Error("conventions strip missing");
	const scaffolded = REPOS.repos.find((entry) => entry.path === blankEntry.path);
	if (scaffolded === undefined || scaffolded.conventions === undefined || scaffolded.conventions.exists !== true) throw new Error("auto scaffold did not write the empty document");
	if (scaffolded.conventions.draft !== true) throw new Error("auto scaffold must leave the document as a draft");
	if (blankHtml.indexOf("data-gitgraph-conventions-picker") < 0) throw new Error("auto scaffold did not open the framework picker");
	const cards = findAll(blankMount.tree, (node) => node.props !== undefined && typeof node.props["data-gitgraph-framework"] === "string");
	if (cards.length !== 6) throw new Error("expected six framework cards, got " + cards.length);
	const draftHtml = blankHtml;
	conventionsHtml = blankHtml;
	click(cards[0], "framework card");
	await new Promise((resolve) => setTimeout(resolve, 40));
	blankHtml = (await blankMount.render()).html;
	const settled = REPOS.repos.find((entry) => entry.path === blankEntry.path);
	if (settled === undefined || settled.conventions === undefined || settled.conventions.draft !== false) throw new Error("picking a framework did not settle the document");
	if (blankHtml.indexOf('data-gitgraph-conventions-state="settled"') < 0) throw new Error("conventions strip did not report the settled document");
	if (draftHtml.indexOf('data-gitgraph-conventions-state="draft"') < 0) throw new Error("conventions strip did not report the draft after the auto scaffold");
	if (blankHtml.indexOf("data-gitgraph-conventions-picker") >= 0) throw new Error("the framework list stayed open after the write");
	console.log("preview-tab: conventions strip, auto scaffold and framework picker ok");
}

// Tier 3: the compliance line, the upgrade preview before a framework replaces
// an existing document, and the shared workspace strip. The synthetic entry is
// injected into whichever repository list this mode uses and removed again, so
// the later sections still see the original scan.
const TIER3_PATH = WORKSPACE + "/repos-tier3/ruled";
let tier3Html = "";
let tier3PreviewHtml = "";
let pickerHtml = "";
{
	const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
	const savedRepos = REPOS;
	const injected = {
		path: TIER3_PATH,
		root: TIER3_PATH,
		name: "ruled",
		relPath: "repos-tier3/ruled",
		kind: "nested",
		outside: false,
		conventions: {
			doc: "GIT_CONVENTIONS.md",
			docPath: TIER3_PATH + "/GIT_CONVENTIONS.md",
			exists: true,
			size: 900,
			draft: false
		},
		status: {
			root: TIER3_PATH,
			branch: "main",
			head: "abc1234",
			dirtyFiles: 0,
			untrackedFiles: 0,
			conflicts: 0,
			operationInProgress: false
		}
	};
	REPOS = Object.assign({}, savedRepos, { repos: (savedRepos.repos || []).concat([injected]) });
	const tierMount = await mountComponent(descriptor.component, tabProps(TIER3_PATH));
	await wait(60);
	let tierHtml = (await tierMount.render()).html;
	if (tierHtml.indexOf('data-gitgraph-compliance="failing"') < 0) throw new Error("the compliance line did not report the failing commits");
	if (tierHtml.indexOf("aaaaaaa") < 0) throw new Error("the compliance line lost the offending subject");
	if (tierHtml.indexOf("不符合") < 0 && tierHtml.indexOf("do not match") < 0) throw new Error("the compliance line lost its sentence");
	if (tierHtml.indexOf("data-gitgraph-compliance-strict") < 0) throw new Error("a strict document shows no strict chip");
	if (tierHtml.indexOf("data-gitgraph-workspace-bar") < 0) throw new Error("the workspace document strip is missing");
	if (tierHtml.indexOf('data-gitgraph-action="workspace-doc-create"') < 0) throw new Error("the workspace document strip has no create button");
	if (tierHtml.indexOf('data-gitgraph-workspace-doc="none"') < 0) throw new Error("the workspace document strip did not report the missing document");
	tier3Html = tierHtml;
	const switchButton = findAll(tierMount.tree, (node) => node.props !== undefined && node.props["data-gitgraph-action"] === "switch-conventions")[0];
	if (switchButton === undefined) throw new Error("a settled document offers no switch-framework button");
	click(switchButton, "switch framework");
	await wait(60);
	pickerHtml = (await tierMount.render()).html;
	if (pickerHtml.indexOf("data-gitgraph-conventions-picker") < 0) throw new Error("the picker snapshot is empty");
	await wait(40);
	tierHtml = (await tierMount.render()).html;
	if (tierHtml.indexOf("data-gitgraph-conventions-picker") < 0) throw new Error("the switch button did not open the framework picker");
	if (tierHtml.indexOf('data-gitgraph-action="conventions-strict"') < 0) throw new Error("the picker has no strict switch");
	if (tierHtml.indexOf('data-gitgraph-strict="off"') < 0) throw new Error("the strict switch should start off");
	const langButtons = findAll(tierMount.tree, (node) => node.props !== undefined && typeof node.props["data-gitgraph-lang"] === "string");
	if (langButtons.length !== 3) throw new Error("the picker should offer three subject languages, got " + langButtons.length);
	const langOf = (value) => langButtons.filter((node) => node.props["data-gitgraph-lang"] === value)[0];
	const zhButton = langOf("zh");
	if (zhButton === undefined || langOf("en") === undefined || langOf("mixed") === undefined) throw new Error("the language switch is missing a choice");
	if (langOf("mixed").props["aria-pressed"] !== "true") throw new Error("the subject language should default to mixed");
	click(zhButton, "choose Chinese subjects");
	await wait(20);
	await tierMount.render();
	const zhAfter = findAll(tierMount.tree, (node) => node.props !== undefined && node.props["data-gitgraph-lang"] === "zh")[0];
	if (zhAfter === undefined || zhAfter.props["aria-pressed"] !== "true") throw new Error("choosing Chinese did not mark the button");
	const tierCard = findAll(tierMount.tree, (node) => node.props !== undefined && typeof node.props["data-gitgraph-framework"] === "string")[0];
	if (tierCard === undefined) throw new Error("no framework card to preview");
	const tierFramework = tierCard.props["data-gitgraph-framework"];
	click(tierCard, "framework card on a settled document");
	await wait(60);
	tierHtml = (await tierMount.render()).html;
	if (tierHtml.indexOf('data-gitgraph-upgrade="ready"') < 0) throw new Error("the upgrade preview did not render");
	if (tierHtml.indexOf("data-gitgraph-upgrade-counts") < 0) throw new Error("the upgrade preview lost its counts");
	if (tierHtml.indexOf("data-gitgraph-conventions-picker") >= 0) throw new Error("the framework list stayed open next to the preview");
	if (tierHtml.indexOf("Commit types") < 0) throw new Error("the upgrade preview lost the rewritten section");
	tier3PreviewHtml = tierHtml;
	if (CONVENTION_CALLS.length !== 0) throw new Error("the upgrade preview wrote the document before the confirmation");
	const confirmButton = findAll(tierMount.tree, (node) => node.props !== undefined && node.props["data-gitgraph-action"] === "conventions-confirm")[0];
	if (confirmButton === undefined) throw new Error("the upgrade preview has no confirmation button");
	click(confirmButton, "confirm upgrade");
	await wait(60);
	if (CONVENTION_CALLS.length !== 1) throw new Error("confirming the preview must write the document exactly once, got " + CONVENTION_CALLS.length);
	if (CONVENTION_CALLS[0].framework !== tierFramework) throw new Error("the confirmation wrote " + CONVENTION_CALLS[0].framework + " instead of " + tierFramework);
	if (CONVENTION_CALLS[0].strict !== false) throw new Error("the strict flag should travel as false, got " + String(CONVENTION_CALLS[0].strict));
	if (CONVENTION_CALLS[0].language !== "zh") throw new Error("the chosen subject language should travel with the write, got " + String(CONVENTION_CALLS[0].language));
	tierHtml = (await tierMount.render()).html;
	if (tierHtml.indexOf("data-gitgraph-upgrade") >= 0) throw new Error("the upgrade preview stayed open after the write");
	const createButton = findAll(tierMount.tree, (node) => node.props !== undefined && node.props["data-gitgraph-action"] === "workspace-doc-create")[0];
	if (createButton === undefined) throw new Error("the workspace create button disappeared");
	click(createButton, "create workspace document");
	await wait(60);
	if (WORKSPACE_CALLS.length !== 1) throw new Error("creating the workspace document must call the host once, got " + WORKSPACE_CALLS.length);
	tierHtml = (await tierMount.render()).html;
	if (tierHtml.indexOf('data-gitgraph-workspace-doc="draft"') < 0) throw new Error("the workspace strip did not report the new document");
	if (tierHtml.indexOf('data-gitgraph-workspace-note="written"') < 0) throw new Error("creating the workspace document left no confirmation in the strip");
	if (tierHtml.indexOf('data-gitgraph-action="workspace-doc-copy"') < 0) throw new Error("without an editor to open, the strip must offer the document path instead");
	if (tierHtml.indexOf("workspace-doc-create") >= 0) throw new Error("the create button stayed after the document exists");
	REPOS = savedRepos;
	console.log("preview-tab: compliance, upgrade preview and workspace document ok");
}

// The one-click init flow: a workspace whose root is not a repository offers the
// button, the bar states the target and the branch, and confirming issues
// exactly one `git/init` call before the silent refresh.
let initHtml = "";
if (!usingRealData) {
	const scopedProps = (cwd, repoPath) => Object.assign(tabProps(repoPath), {
		scope: { sessionId: "session", cwd }
	});
	const savedRepos = REPOS;
	const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

	REPOS = Object.assign({}, savedRepos, {
		repos: (savedRepos.repos || []).filter((entry) => entry.kind !== "root")
	});
	const initMount = await mountComponent(descriptor.component, scopedProps(WORKSPACE + "/fresh-workspace"));
	await wait(60);
	let html = (await initMount.render()).html;
	const buttons = findAll(initMount.tree, (node) => node.props !== undefined && node.props["data-gitgraph-action"] === "init-repo");
	if (buttons.length !== 1) throw new Error("expected one init button, got " + buttons.length);
	if (html.indexOf("data-gitgraph-init") >= 0) throw new Error("the init bar must stay closed until asked for");

	click(buttons[0], "init button");
	await wait(60);
	html = (await initMount.render()).html;
	if (html.indexOf('data-gitgraph-init="true"') < 0) throw new Error("the init bar did not open");
	const branches = findAll(initMount.tree, (node) => node.props !== undefined && node.props["data-gitgraph-init-branch"] === true);
	if (branches.length !== 1) throw new Error("expected one branch picker, got " + branches.length);
	const options = findAll(initMount.tree, (node) => node.type === "option");
	if (options.length !== 4) throw new Error("expected four branch options, got " + options.length);
	const cancels = findAll(initMount.tree, (node) => node.props !== undefined && node.props["data-gitgraph-action"] === "init-cancel");
	if (cancels.length !== 1) throw new Error("expected a cancel button");
	click(cancels[0], "init cancel");
	await wait(60);
	html = (await initMount.render()).html;
	if (html.indexOf("data-gitgraph-init") >= 0) throw new Error("cancel did not close the init bar");

	click(findAll(initMount.tree, (node) => node.props !== undefined && node.props["data-gitgraph-action"] === "init-repo")[0], "init button again");
	await wait(60);
	await initMount.render();
	const confirms = findAll(initMount.tree, (node) => node.props !== undefined && node.props["data-gitgraph-action"] === "init-confirm");
	if (confirms.length !== 1) throw new Error("expected a confirm button, got " + confirms.length);
	click(confirms[0], "init confirm");
	await wait(120);
	html = (await initMount.render()).html;
	if (INIT_CALLS.length !== 1) throw new Error("expected one git/init call, got " + INIT_CALLS.length);
	if (INIT_CALLS[0].path !== WORKSPACE + "/fresh-workspace") throw new Error("git/init went to " + INIT_CALLS[0].path);
	if (INIT_CALLS[0].branch !== "main") throw new Error("git/init asked for branch " + INIT_CALLS[0].branch);
	if (html.indexOf("data-gitgraph-init") >= 0) throw new Error("the init bar stayed open after the call");
	initHtml = html;

	REPOS = Object.assign({}, savedRepos, { repos: [] });
	const emptyMount = await mountComponent(descriptor.component, scopedProps(WORKSPACE + "/empty-workspace"));
	await wait(60);
	const emptyButtons = findAll(emptyMount.tree, (node) => node.props !== undefined && node.props["data-gitgraph-action"] === "init-repo-empty");
	if (emptyButtons.length !== 1) throw new Error("an empty workspace must offer the init button, got " + emptyButtons.length);
	REPOS = savedRepos;
	console.log("preview-tab: one-click init button, confirm bar and empty state ok");
}

const rootPanel = rootMount.html;
const nestedPanel = nestedMount.html;

// Screenshot frame for the README: default two-line rows, one row pinned so the
// detail card is filled instead of showing its empty hint.
const heroMount = await mountComponent(descriptor.component, tabProps(focusPath));
const heroRows = findAll(heroMount.tree, (node) => node.props !== undefined && node.props["data-gitgraph-row"] === true);
if (heroRows.length > 3) click(heroRows[2], "commit row (hero)");
const heroPanel = (await heroMount.render()).html;
if (heroPanel.indexOf("data-gitgraph-detail") < 0) throw new Error("hero panel has no commit card");

if (rootPanel.indexOf("<svg") < 0 || rootPanel.indexOf("<path") < 0) throw new Error("preview did not produce an SVG lane canvas");
if (rootPanel === detailHtml) throw new Error("pinned/zoomed render is identical to the default render");
console.log("preview-tab: rendered tab (root " + rootPanel.length + " chars, nested " + nestedPanel.length +
	" chars, pinned+zoomed " + detailHtml.length + " chars; " + rows.length + " rows handled)");

// ------------------------------------------------------------------ html
const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>GIT-graph sidebar tab — preview</title>
<style>
	:root {
		--dsw-alias-bg-base: #ffffff;
		--dsw-alias-bg-layer-1: #fafafa;
		--dsw-alias-bg-layer-2: #f1f3f5;
		--dsw-alias-label-primary: #1f2329;
		--dsh-gg-ctl-bg: #ffffff;
		--dsh-gg-ctl-fg: #14181f;
		--dsh-gg-ctl-bd: rgba(20,24,31,0.16);
		--dsw-alias-label-secondary: #5c6370;
		--dsw-alias-label-tertiary: #9aa1ab;
		--dsw-alias-border-l1: #e6e8eb;
		--dsw-alias-border-l2: #d5d8dd;
		--dsw-alias-button-tool-bar-fill: #f1f3f5;
		--dsw-alias-state-warn-primary: #c26a00;
		--dsw-alias-state-error-primary: #c62828;
		--dsw-alias-state-business-primary: #4c8dff;
	}
	@media (prefers-color-scheme: dark) {
		:root {
			--dsw-alias-bg-base: #1b1d21;
			--dsw-alias-bg-layer-1: #22252a;
			--dsw-alias-bg-layer-2: #2b2f36;
			--dsw-alias-label-primary: #e8eaed;
			--dsh-gg-ctl-bg: rgba(255,255,255,0.06);
			--dsh-gg-ctl-fg: #eef2f7;
			--dsh-gg-ctl-bd: rgba(255,255,255,0.22);
			--dsw-alias-label-secondary: #a8aeb8;
			--dsw-alias-label-tertiary: #767d88;
			--dsw-alias-border-l1: #33383f;
			--dsw-alias-border-l2: #41474f;
			--dsw-alias-button-tool-bar-fill: #2b2f36;
		}
	}
	body[data-theme="light"] {
		--dsw-alias-bg-base: #ffffff;
		--dsw-alias-bg-layer-1: #fafafa;
		--dsw-alias-bg-layer-2: #f1f3f5;
		--dsw-alias-label-primary: #1f2329;
		--dsh-gg-ctl-bg: #ffffff;
		--dsh-gg-ctl-fg: #14181f;
		--dsh-gg-ctl-bd: rgba(20,24,31,0.16);
		--dsw-alias-label-secondary: #5c6370;
		--dsw-alias-label-tertiary: #9aa1ab;
		--dsw-alias-border-l1: #e6e8eb;
		--dsw-alias-border-l2: #d5d8dd;
		--dsw-alias-button-tool-bar-fill: #f1f3f5;
		background: #eef0f3;
		color: #1f2329;
	}
	body[data-theme="light"] .panel { box-shadow: 0 1px 3px rgba(16, 24, 40, 0.08); }
	body[data-theme="light"] h1 { color: #1f2329; }
	body[data-theme="light"] p.note, body[data-theme="light"] .legend { color: #5c6370; }
	body[data-theme="light"] code { background: #e6e8eb; }
	body {
		margin: 0;
		padding: 24px;
		background: #131417;
		color: #e8eaed;
		font: 13px/1.5 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
	}
	h1 { font-size: 15px; font-weight: 600; margin: 0 0 4px; }
	p.note { margin: 0 0 18px; color: #9aa1ab; font-size: 12px; }
	.stage { display: flex; gap: 20px; align-items: flex-start; flex-wrap: wrap; }
	.panel { width: 380px; height: 560px; border-radius: 12px; overflow: hidden;
		background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l1);
		color: var(--dsw-alias-label-primary); display: flex; flex-direction: column; }
	.panel > header { flex: none; padding: 8px 12px; font-size: 12px; color: var(--dsw-alias-label-secondary);
		border-bottom: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); }
	.panel > div { flex: 1 1 auto; min-height: 0; }
	.legend { margin-top: 18px; color: #9aa1ab; font-size: 12px; line-height: 1.8; }
	code { background: #24262b; padding: 1px 5px; border-radius: 4px; }
</style>
</head>
<body>
	<h1>GIT-graph · better-sidebar 仓库图谱 tab — 离线预览</h1>
	<p class="note">此文件由 <code>scripts/preview-tab.mjs</code> 直接执行已构建的 <code>lib/client.js</code> 生成：假 React 运行时跑真实 <code>apply()</code> → 取出注册给 better-sidebar 的组件 → 注入${usingRealData ? "真实 <code>/git/repos</code> 与 <code>/git/graph</code> 响应" : "样例 <code>/git/repos</code> 与 <code>/git/graph</code> 数据"}渲染。② 为嵌套仓库（选中状态由 <code>tab.meta.repoPath</code> 恢复），③ 是脚本真的触发了一次行点击与一次「缩小」后的结果（单行紧凑模式）。</p>
	<div class="stage">
		<div class="panel">
			<header>① 工作区根仓库 · 默认双行</header>
			<div>${rootPanel}</div>
		</div>
		<div class="panel">
			<header>② 嵌套仓库 · ${secondaryLabel}</header>
			<div>${nestedPanel}</div>
		</div>
		<div class="panel">
			<header>③ 点击固定提交 + 缩小一级（单行紧凑）</header>
			<div>${detailHtml}</div>
		</div>
	</div>
	<div class="legend">
		泳道颜色按 lane 编号循环 8 色；merge 提交画成菱形；父边为贝塞尔曲线（第一父不透明、其余半透明）；工具栏 <b>−</b>/<b>+</b> 调整行高；点击提交固定详情卡。<br>
		深色变量随 <code>prefers-color-scheme</code> 切换。真实 GUI 里这些颜色来自 DSH 主题 token（<code>--dsw-alias-*</code>）。
	</div>
</body>
</html>
`;

await mkdir(dirname(outFile), { recursive: true });
await writeFile(outFile, html, "utf8");
console.log("preview-tab: wrote " + outFile);

const lightFile = outFile.replace(/\.html$/, "-light.html");
await writeFile(lightFile, html.replace("<body>", '<body data-theme="light">'), "utf8");
console.log("preview-tab: wrote " + lightFile);

// A side-by-side sheet of the states that are hard to judge from the panel
// render alone: the pinned commit card and the full-window view. `transform: translateZ(0)` on the wrapper turns the
// overlay's `position: fixed` into a box local to the wrapper, so a static
// page can show it.
const statesFile = join(dirname(outFile), "graph-tab-states.html");
/** Fourth states section: the conventions picker, only when the fixture ran. */
const tier3Section = tier3Html === ""
	? ""
	: "<h2>Tier 3 - compliance, upgrade preview, workspace document</h2>" +
		'<div class="panel">' + tier3Html + "</div>";
const conventionsSection = conventionsHtml === ""
	? ""
	: "<h2>Git conventions — empty scaffold written, framework picker open</h2>" +
		'<div class="panel">' + conventionsHtml + "</div>";
const statesHtml = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>GIT-graph sidebar tab — states</title>
<style>
	:root {
		--dsw-alias-bg-base: #1b1d21;
		--dsw-alias-bg-layer-1: #212429;
		--dsw-alias-bg-layer-2: #262a31;
		--dsw-alias-label-primary: #e8eaed;
		--dsh-gg-ctl-bg: rgba(255,255,255,0.06);
		--dsh-gg-ctl-fg: #eef2f7;
		--dsh-gg-ctl-bd: rgba(255,255,255,0.22);
		--dsw-alias-label-secondary: #a8b0ba;
		--dsw-alias-label-tertiary: #7d858f;
		--dsw-alias-border-l1: #2f343d;
		--dsw-alias-border-l2: #3a404a;
		--dsw-alias-button-tool-bar-fill: #262a31;
		--dsw-alias-state-warn-primary: #e0a24a;
		--dsw-alias-state-error-primary: #e57373;
		--dsw-alias-state-business-primary: #4c8dff;
	}
	body { margin: 0; padding: 24px; background: #0f1115; color: #e6e8eb; font: 13px/1.5 system-ui, sans-serif; }
	h2 { font-size: 13px; font-weight: 600; margin: 24px 0 10px; color: #9aa1ab; text-transform: uppercase; letter-spacing: .06em; }
	.panel { width: 400px; background: var(--dsw-alias-bg-base); border: 1px solid #2a2f38; border-radius: 10px; overflow: hidden; }
</style>
</head>
<body>
<h2>Pinned commit card</h2>
<div class="panel">${detailHtml}</div>
${conventionsSection}${tier3Section}</body>
</html>`;
await writeFile(statesFile, statesHtml, "utf8");
console.log("preview-tab: wrote " + statesFile);

// A single, taller panel per theme — this is what the README screenshots are
// taken from: the sidebar is narrow, so a 420x960 frame is the realistic
// proportion (tree, graph and the pinned detail card all visible at once).
const heroFile = join(dirname(outFile), "graph-tab-hero.html");
const heroHtml = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>GIT-graph sidebar tab — hero</title>
<style>
\t:root {
\t\t--dsw-alias-bg-base: #1b1d21;
\t\t--dsw-alias-bg-layer-1: #212429;
\t\t--dsw-alias-bg-layer-2: #262a31;
\t\t--dsw-alias-label-primary: #e8eaed;
--dsh-gg-ctl-bg: rgba(255,255,255,0.06);
--dsh-gg-ctl-fg: #eef2f7;
--dsh-gg-ctl-bd: rgba(255,255,255,0.22);
\t\t--dsw-alias-label-secondary: #a8b0ba;
\t\t--dsw-alias-label-tertiary: #7d858f;
\t\t--dsw-alias-border-l1: #2f343d;
\t\t--dsw-alias-border-l2: #3a404a;
\t\t--dsw-alias-button-tool-bar-fill: #262a31;
\t\t--dsw-alias-state-warn-primary: #e0a24a;
\t\t--dsw-alias-state-error-primary: #e57373;
\t\t--dsw-alias-state-business-primary: #4c8dff;
\t}
\tbody[data-theme="light"] {
\t\t--dsw-alias-bg-base: #ffffff;
\t\t--dsw-alias-bg-layer-1: #fafafa;
\t\t--dsw-alias-bg-layer-2: #f1f3f5;
\t\t--dsw-alias-label-primary: #1f2329;
--dsh-gg-ctl-bg: #ffffff;
--dsh-gg-ctl-fg: #14181f;
--dsh-gg-ctl-bd: rgba(20,24,31,0.16);
\t\t--dsw-alias-label-secondary: #5c6370;
\t\t--dsw-alias-label-tertiary: #9aa1ab;
\t\t--dsw-alias-border-l1: #e6e8eb;
\t\t--dsw-alias-border-l2: #d5d8dd;
\t\t--dsw-alias-button-tool-bar-fill: #f1f3f5;
\t\t--dsw-alias-state-warn-primary: #b7791f;
\t\t--dsw-alias-state-error-primary: #d64545;
\t\t--dsw-alias-state-business-primary: #2f6fed;
\t}
\tbody { margin: 0; padding: 16px; background: #131417; font: 13px/1.5 system-ui, sans-serif; }
\tbody[data-theme="light"] { background: #eef0f3; }
\t.panel { width: 420px; height: 960px; border-radius: 12px; overflow: hidden;
\t\tbackground: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l1);
\t\tcolor: var(--dsw-alias-label-primary); display: flex; flex-direction: column; }
\t.panel > div { flex: 1 1 auto; min-height: 0; }
</style>
</head>
<body>
<div class="panel">${heroPanel}</div>
</body>
</html>`;
await writeFile(heroFile, heroHtml, "utf8");
await writeFile(heroFile.replace(/\.html$/, "-light.html"), heroHtml.replace("<body>", '<body data-theme="light">'), "utf8");
console.log("preview-tab: wrote " + heroFile);

// A page with just the Tier 3 states, for a quick visual check of the
// compliance line, the upgrade preview and the workspace strip.
if (tier3Html !== "") {
	const tier3File = join(dirname(outFile), "graph-tab-tier3.html");
	const shellEnd = statesHtml.indexOf("</head>") + "</head>".length;
	const shell = statesHtml.slice(0, shellEnd);
	const panels = "<body>" +
		"<h2>Compliance and the workspace document</h2>" +
		'<div class="panel">' + tier3Html + "</div>" +
		"<h2>The framework picker, with the strict switch</h2>" +
		'<div class="panel">' + pickerHtml + "</div>" +
		"<h2>Upgrade preview - nothing written yet</h2>" +
		'<div class="panel">' + tier3PreviewHtml + "</div>" +
		"</body>\n</html>\n";
	const tier3Page = shell + panels;
	await writeFile(tier3File, tier3Page, "utf8");
	console.log("preview-tab: wrote " + tier3File);
}
