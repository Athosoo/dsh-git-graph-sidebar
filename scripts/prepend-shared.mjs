// One-off repair: the sidebar-tab region owns both the fork's new SVG code and
// the shared scaffolding (element factory, tab id, /git client, translator,
// tab-strip icon, layout style constants). The scaffold lives in the published
// 0.4.8 bundle; restore it from the pristine copy installed in the profile and
// prepend it to the region source.
//
//   node scripts/prepend-shared.mjs <pristine-lib-client.js>
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const regionFile = join(root, "src/client/graph/SidebarTab.js");

const pristinePath = process.argv[2];
if (pristinePath === undefined) throw new Error("usage: prepend-shared.mjs <pristine lib/client.js>");

const pristine = await readFile(pristinePath, "utf8");
const sharedStart = pristine.indexOf("\t\t/** The shared element factory");
if (sharedStart < 0) throw new Error("shared scaffolding start not found");
const sharedEnd = pristine.indexOf("\t\t/**\n\t\t * The better-sidebar tab body:");
if (sharedEnd < 0) throw new Error("tab body docblock not found");
const shared = pristine.slice(sharedStart, sharedEnd).replace(/\s+$/, "");

let region = await readFile(regionFile, "utf8");
if (region.includes("const SIDEBAR_TAB_MORE")) {
	console.log("prepend-shared: scaffolding already present, nothing to do");
} else {
	region = shared + "\n" + region;
	await writeFile(regionFile, region, "utf8");
	console.log("prepend-shared: prepended " + shared.split("\n").length + " lines of shared scaffolding");
}
