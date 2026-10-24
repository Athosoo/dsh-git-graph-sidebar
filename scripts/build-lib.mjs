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
			['"sidebar.pinHint"', '"点击可固定此提交"'],
			['"sidebar.parentsLabel"', '"父提交"']
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
			['"sidebar.pinHint"', '"Click to pin this commit"'],
			['"sidebar.parentsLabel"', '"Parents"']
		]
	}
];

const lib = await readFile(libFile, "utf8");
const region = (await readFile(regionFile, "utf8")).replace(/\s+$/, "");

const startIndex = lib.indexOf(REGION_START);
if (startIndex < 0) throw new Error("region start marker not found in lib/client.js");
const startLineEnd = lib.indexOf("\n", startIndex);
const endIndex = lib.indexOf(REGION_END, startLineEnd);
if (endIndex < 0) throw new Error("region end marker not found in lib/client.js");

let next = lib.slice(0, startLineEnd + 1) + region + lib.slice(endIndex);

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
