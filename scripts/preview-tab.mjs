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
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const libFile = join(root, "lib/client.js");
const outFile = process.argv[2] !== undefined ? process.argv[2] : join(root, "preview/graph-tab-preview.html");

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
		return last;
	};
	const settled = await render();
	return { instance, render, html: settled.html, tree: settled.tree };
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

const ROOT_GRAPH = {
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

const NESTED_GRAPH = {
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

const REPOS = {
	base: WORKSPACE,
	maxDepth: 3,
	scannedAt: Date.now(),
	truncated: false,
	repos: [
		{
			path: WORKSPACE,
			root: WORKSPACE,
			name: "default-workspace",
			relPath: "",
			kind: "root",
			outside: false,
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
			status: {
				root: WORKSPACE + "/tools/releases/nightly",
				branch: "wt/nightly",
				head: NESTED_GRAPH.commits[0].oid,
				dirtyFiles: 1,
				untrackedFiles: 0,
				conflicts: 0,
				operationInProgress: false
			}
		}
	]
};

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
		addEventListener() {},
		removeEventListener() {}
	};
}
const fakeDocument = {
	head: { appendChild(element) { styles.push(element.textContent); } },
	body: fakeElement("body"),
	documentElement: fakeElement("html"),
	baseURI: "http://127.0.0.1:56515/",
	createElement: fakeElement,
	querySelector() { return null; },
	querySelectorAll() { return []; },
	getElementById() { return null; },
	addEventListener() {},
	removeEventListener() {}
};

const fakeFetch = async (path, init) => {
	const payload = init !== undefined && typeof init.body === "string" ? JSON.parse(init.body) : {};
	let value;
	if (path === "git/repos") value = REPOS;
	else if (path === "git/graph") {
		value = String(payload.path).indexOf("dsh-git-graph-src") >= 0 ? NESTED_GRAPH : ROOT_GRAPH;
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
const fakeNavigator = { language: "zh-CN", userAgent: "node-preview" };

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

const rootMount = await mountComponent(descriptor.component, tabProps(undefined));
const nestedMount = await mountComponent(descriptor.component, tabProps(NESTED));
const detailMount = await mountComponent(descriptor.component, tabProps(undefined));

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

// Repository switching: clicking another row in the tree must reload that
// repository's graph and move the active highlight (choose() + fetch + state).
const switchMount = await mountComponent(descriptor.component, tabProps(undefined));
const repoRows = findAll(switchMount.tree, (node) => node.props !== undefined && typeof node.props["data-gitgraph-repo"] === "string");
if (repoRows.length < 3) throw new Error("expected at least 3 repository tree rows, got " + repoRows.length);
const targetRow = repoRows.find((node) => {
	const path = String(node.props["data-gitgraph-repo"]).replace(/\\/g, "/");
	return path.endsWith("/dsh-git-graph-src");
});
if (targetRow === undefined) throw new Error("nested repository row missing from the repository tree");
click(targetRow, "repository tree row");
const switchedHtml = (await switchMount.render()).html;
if (switchedHtml.indexOf("colour palette per lane") < 0) throw new Error("selecting a repository did not load its graph");
if (switchedHtml.indexOf("data-gitgraph-repo-active") < 0) throw new Error("the selected repository is not highlighted in the tree");
console.log("preview-tab: repository switch ok (" + repoRows.length + " tree rows, nested graph loaded)");

const rootPanel = rootMount.html;
const nestedPanel = nestedMount.html;

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
	<p class="note">此文件由 <code>scripts/preview-tab.mjs</code> 直接执行已构建的 <code>lib/client.js</code> 生成：假 React 运行时跑真实 <code>apply()</code> → 取出注册给 better-sidebar 的组件 → 注入样例 <code>/git/repos</code> 与 <code>/git/graph</code> 数据渲染。② 为嵌套仓库（选中状态由 <code>tab.meta.repoPath</code> 恢复），③ 是脚本真的触发了一次行点击与一次「缩小」后的结果（单行紧凑模式）。</p>
	<div class="stage">
		<div class="panel">
			<header>① 工作区根仓库 · main · 默认双行</header>
			<div>${rootPanel}</div>
		</div>
		<div class="panel">
			<header>② 嵌套仓库 · feature/multi-repo</header>
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
