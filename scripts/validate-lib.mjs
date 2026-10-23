// Static sanity pass over the built client bundle: every `t("key")` literal used
// anywhere in the file must exist in both bundled dictionaries (zh and en), and
// the fork region must define every top-level const/function it relies on.
//
//   node scripts/validate-lib.mjs
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const libFile = join(root, "lib/client.js");
const lib = await readFile(libFile, "utf8");

/** Slice one `const zh = { ... };` literal by brace matching. */
function dictionaryOf(name) {
	const start = lib.indexOf("const " + name + " = {");
	if (start < 0) throw new Error("dictionary " + name + " not found");
	let depth = 0;
	let index = lib.indexOf("{", start);
	const open = index;
	for (; index < lib.length; index += 1) {
		const char = lib[index];
		if (char === "{") depth += 1;
		else if (char === "}") {
			depth -= 1;
			if (depth === 0) break;
		}
	}
	return lib.slice(open + 1, index);
}

function keysOfBlock(block) {
	const keys = new Set();
	for (const match of block.matchAll(/"([^"\\]+)"\s*:/g)) keys.add(match[1]);
	return keys;
}

const zhKeys = keysOfBlock(dictionaryOf("zh"));
const enKeys = keysOfBlock(dictionaryOf("en"));

const used = new Set();
for (const match of lib.matchAll(/\bt\("([^"\\]+)"/g)) used.add(match[1]);

const problems = [];
for (const key of used) {
	if (!zhKeys.has(key)) problems.push("zh missing: " + key);
	if (!enKeys.has(key)) problems.push("en missing: " + key);
}

// The region's own definitions: collect `const X =` / `function X(` names between
// the region markers, then look for identifiers that are referenced but never
// defined anywhere in the bundle.
const regionStart = lib.indexOf("\t\t//#region src/client/graph/SidebarTab.tsx");
const regionEnd = lib.indexOf("\n\t\t//#endregion", regionStart);
const region = lib.slice(regionStart, regionEnd);
const defined = new Set();
for (const match of region.matchAll(/\b(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)/g)) defined.add(match[1]);
const suspicious = [];
for (const match of region.matchAll(/\b(sidebarTab[A-Za-z]*|SIDEBAR_TAB_[A-Z_]+)\b/g)) suspicious.push(match[1]);
const unresolved = [...new Set(suspicious)].filter((name) => !defined.has(name) && !new RegExp("\\b(?:const|let|var|function)\\s+" + name + "\\b").test(lib));

if (problems.length > 0) console.log("dictionary problems:\n  " + problems.join("\n  "));
if (unresolved.length > 0) console.log("unresolved identifiers: " + unresolved.join(", "));
if (problems.length === 0 && unresolved.length === 0) console.log("validate-lib: OK — " + used.size + " locale keys resolve, all fork identifiers defined");
process.exitCode = problems.length === 0 && unresolved.length === 0 ? 0 : 1;
