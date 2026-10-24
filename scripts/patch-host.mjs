#!/usr/bin/env node
/**
 * Applies the conventions (Git discipline) edits to the built host bundle
 * `lib/index.js`. Idempotent: every edit is keyed by a marker comment, so a
 * second run reports "already applied" instead of duplicating code.
 *
 * The framework catalogue and the document builders live in
 * `src/host/conventions.js`; `scripts/build-lib.mjs` splices that file into the
 * `//#region src/host/conventions.ts` block this script creates.
 *
 *   node scripts/patch-host.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const file = join(root, "lib/index.js");
let source = readFileSync(file, "utf8");
const applied = [];
const skipped = [];

function patch(label, anchor, replacement) {
	if (source.includes(replacement)) {
		skipped.push(label);
		return;
	}
	if (!source.includes(anchor)) throw new Error("patch-host: anchor not found for " + label);
	if (source.split(anchor).length !== 2) throw new Error("patch-host: anchor is not unique for " + label);
	source = source.replace(anchor, replacement);
	applied.push(label);
}

// 1. fs helpers used by the conventions module.
patch(
	"imports",
	'import { mkdir, readdir, realpath } from "node:fs/promises";',
	'import { mkdir, readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";'
);

// 2. Config schema: document name + the auto-scaffold switch.
patch(
	"config-schema",
	'\tagentTool: z.boolean().default(false).volatile()\n});',
	'\tagentTool: z.boolean().default(false).volatile(),\n\tconventionsDoc: z.string().default("GIT_CONVENTIONS.md").volatile(),\n\tconventionsAuto: z.boolean().default(true).volatile()\n});'
);
patch(
	"config-effective",
	'\t\tagentTool: config?.agentTool?.get() ?? false\n\t};',
	'\t\tagentTool: config?.agentTool?.get() ?? false,\n\t\tconventionsDoc: config?.conventionsDoc?.get() ?? "GIT_CONVENTIONS.md",\n\t\tconventionsAuto: config?.conventionsAuto?.get() ?? true\n\t};'
);

// 3. Region the conventions module is spliced into.
patch(
	"conventions-region",
	"//#region src/host/repos.ts — multi-repo discovery (dsh-git-graph sidebar fork)",
	"//#region src/host/conventions.ts\n//#endregion\n//#region src/host/repos.ts — multi-repo discovery (dsh-git-graph sidebar fork)"
);

// 4. Scan entries carry the convention state; the scan view advertises the
//    document name and whether the client may scaffold automatically.
patch(
	"repo-scan-signature",
	"async function repoScan(base, service) {",
	"async function repoScan(base, service, docName, autoScaffold) {"
);
patch(
	"repo-scan-conventions",
	"\tentries.sort((left, right) => {",
	"\tfor (const entry of entries) entry.conventions = await repoConventionState(entry.root, docName);\n\tentries.sort((left, right) => {"
);
patch(
	"repo-scan-view",
	"\t\ttruncated: dirs.length >= REPO_SCAN_LIMIT,\n\t\tmaxDepth: REPO_SCAN_MAX_DEPTH,\n\t\tscannedAt: Date.now()\n\t};",
	"\t\ttruncated: dirs.length >= REPO_SCAN_LIMIT,\n\t\tmaxDepth: REPO_SCAN_MAX_DEPTH,\n\t\tconventions: {\n\t\t\tdoc: conventionDocName(docName),\n\t\t\tautoScaffold: autoScaffold !== false\n\t\t},\n\t\tscannedAt: Date.now()\n\t};"
);
patch(
	"repo-scan-cached-signature",
	"async function repoScanCached(base, service, refresh) {",
	"async function repoScanCached(base, service, refresh, docName, autoScaffold) {"
);
patch(
	"repo-scan-cached-key",
	"\tconst key = gatePathKey(base);",
	"\tconst key = gatePathKey(base) + \"\\u0000\" + conventionDocName(docName);"
);
patch(
	"repo-scan-cached-call",
	"const promise = repoScan(base, service).catch((error) => {",
	"const promise = repoScan(base, service, docName, autoScaffold).catch((error) => {"
);

// 5. /git/repos passes the configured document name and switch through.
patch(
	"repos-route",
	"\t\t\t\t\twriteJson(res, 200, OK(await repoScanCached(path, service, refresh)));",
	"\t\t\t\t\twriteJson(res, 200, OK(await repoScanCached(path, service, refresh, feature.docName, feature.autoScaffold)));"
);
patch(
	"repos-route-feature",
	"\t\t\tcase \"/git/repos\": {\n\t\t\t\tconst refresh = payload !== null && typeof payload === \"object\" && payload.refresh === true;",
	"\t\t\tcase \"/git/repos\": {\n\t\t\t\tconst refresh = payload !== null && typeof payload === \"object\" && payload.refresh === true;\n\t\t\t\tconst feature = featureOf(config);"
);

// 6. Two new routes: read the convention state + catalogue, and write a
//    document (empty scaffold or a framework template).
patch(
	"conventions-routes",
	"\t\t\tdefault:\n\t\t\t\tres.writeHead(404);\n\t\t\t\tres.end();",
	`\t\t\tcase "/git/conventions": {
\t\t\t\tconst gated = await createWorkspaceGate(ctx)(path);
\t\t\t\tif (!gated.ok) {
\t\t\t\t\twriteJson(res, 200, FAIL(gated.error));
\t\t\t\t\treturn;
\t\t\t\t}
\t\t\t\tconst feature = featureOf(config);
\t\t\t\tconst snapshot = await service.rootAndHead(gated.canonical).catch(() => null);
\t\t\t\tconst rootPath = snapshot !== null && typeof snapshot.root === "string" ? snapshot.root : gated.canonical;
\t\t\t\tconst state = await repoConventionState(rootPath, feature.docName);
\t\t\t\twriteJson(res, 200, OK({
\t\t\t\t\troot: rootPath,
\t\t\t\t\t...state,
\t\t\t\t\tautoScaffold: feature.autoScaffold,
\t\t\t\t\tcatalog: conventionCatalog()
\t\t\t\t}));
\t\t\t\treturn;
\t\t\t}
\t\t\tcase "/git/convention": {
\t\t\t\tconst gated = await createWorkspaceGate(ctx)(path);
\t\t\t\tif (!gated.ok) {
\t\t\t\t\twriteJson(res, 200, FAIL(gated.error));
\t\t\t\t\treturn;
\t\t\t\t}
\t\t\t\tconst feature = featureOf(config);
\t\t\t\tconst snapshot = await service.rootAndHead(gated.canonical).catch(() => null);
\t\t\t\tif (snapshot === null || typeof snapshot.root !== "string") {
\t\t\t\t\twriteJson(res, 200, FAIL({
\t\t\t\t\t\tcode: "not-a-repository",
\t\t\t\t\t\tmessage: "path is not a git repository"
\t\t\t\t\t}));
\t\t\t\t\treturn;
\t\t\t\t}
\t\t\t\tconst framework = payload !== null && typeof payload === "object" && typeof payload.framework === "string" ? payload.framework : null;
\t\t\t\tconst body = conventionBodyOf(framework, basename(snapshot.root));
\t\t\t\tif (body === undefined) {
\t\t\t\t\twriteJson(res, 200, FAIL({
\t\t\t\t\t\tcode: "convention-unknown-framework",
\t\t\t\t\t\tmessage: "unknown convention framework"
\t\t\t\t\t}));
\t\t\t\t\treturn;
\t\t\t\t}
\t\t\t\tconst written = await repoWriteConvention(snapshot.root, feature.docName, body, {
\t\t\t\t\tforce: payload !== null && typeof payload === "object" && payload.force === true
\t\t\t\t});
\t\t\t\tif (!written.ok) {
\t\t\t\t\twriteJson(res, 200, FAIL(written.error));
\t\t\t\t\treturn;
\t\t\t\t}
\t\t\t\tctx.logger.info("dsh-git-graph: wrote " + written.value.docPath + " (" + (framework ?? "scaffold") + ")");
\t\t\t\twriteJson(res, 200, OK({
\t\t\t\t\t...written.value,
\t\t\t\t\tframework: framework ?? "none",
\t\t\t\t\tdoc: feature.docName
\t\t\t\t}));
\t\t\t\treturn;
\t\t\t}
\t\t\tdefault:
\t\t\t\tres.writeHead(404);
\t\t\t\tres.end();`
);

// 7. The routes receive the conventions knobs through the feature-config thunk.
patch(
	"feature-config-conventions",
	"\t\t\tworktreesHome: worktreesHome()\n\t\t};\n\t};",
	"\t\t\tworktreesHome: worktreesHome(),\n\t\t\tconventionsDoc: active.conventionsDoc,\n\t\t\tconventionsAuto: active.conventionsAuto\n\t\t};\n\t};"
);
patch(
	"default-feature-config",
	"const defaultFeatureConfig = () => ({\n\tautoIsolate: false,\n\tautoBaseline: \"current\",\n\tworktreesHome: worktreesHome()\n});",
	"const defaultFeatureConfig = () => ({\n\tautoIsolate: false,\n\tautoBaseline: \"current\",\n\tworktreesHome: worktreesHome(),\n\tconventionsDoc: \"GIT_CONVENTIONS.md\",\n\tconventionsAuto: true\n});"
);

console.log("patch-host: applied " + applied.length + ", already present " + skipped.length +
	(applied.length > 0 ? " -> " + applied.join(", ") : ""));
writeFileSync(file, source, "utf8");
