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

// `guard` is what to look for when the inserted text cannot be matched
// verbatim: patches 9, 12 and 13 all insert into the same `switch`, so a
// replacement stops being contiguous as soon as a later patch slips another
// case between the inserted block and its own anchor line.
//
// When no guard is given, the first `case "...": {` line the replacement adds
// becomes the guard by itself. That is the marker this script promises: a
// route case is either there or it is not, and a later patch editing one line
// inside it can no longer make the whole replacement look absent.
function routeCaseOf(anchor, replacement) {
	if (typeof replacement !== "string") return void 0;
	for (const line of replacement.split(String.fromCharCode(10))) {
		if (!/^	{3}case "[^"]+": \{$/.test(line)) continue;
		if (!anchor.includes(line.trim())) return line;
	}
	return void 0;
}

/** A marker counts as present when it matches a whole line, whatever its indent. */
function present(source, marker) {
	if (source.includes(marker)) return true;
	const flat = marker.replace(/[ \t]+/g, " ").trim();
	if (flat.indexOf(String.fromCharCode(10)) >= 0) return false;
	return source.split(String.fromCharCode(10)).some((line) => line.replace(/[ \t]+/g, " ").trim() === flat);
}

function patch(label, anchor, replacement, guard) {
	const marker = guard !== undefined ? guard : routeCaseOf(anchor, replacement);
	if (present(source, marker === undefined ? replacement : marker)) {
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

// 3. Region the conventions module is spliced into. Keyed on the region marker
//    alone: once build-lib has spliced the module in, the replacement string no
//    longer matches, but the marker itself is still there.
if (source.includes("//#region src/host/conventions.ts")) skipped.push("conventions-region");
else
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
// The three patches that used to add the convention state, the scan view and
// the activity/upstream probe to `repoScan()` are gone: that region of
// lib/index.js is maintained by hand (it has no `src/` counterpart), the scan
// now batches the convention reads and probes the refs in one spawn, so an
// anchor inside it would only fight the code. Everything below still patches
// text that `src/` does not own.
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

// 8. Prompt injection: the conventions module needs sync fs helpers, `dirname`
//    and one call from apply() to register its system-prompt section.
patch(
	"imports-fs-sync",
	'import { existsSync } from "node:fs";',
	'import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";'
);
patch(
	"imports-dirname",
	'import { basename, isAbsolute, join, resolve, sep } from "node:path";',
	'import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";'
);
patch(
	"prompt-mount",
	"\tctx.effect(() => {\n\t\tsyncTool();\n\t\tconst disposeRoutes = registerGitRoutes(ctx, service, featureConfig);",
	"\tconventionsPromptMount(ctx, featureConfig);\n\tctx.effect(() => {\n\t\tsyncTool();\n\t\tconst disposeRoutes = registerGitRoutes(ctx, service, featureConfig);"
);

// 9. One-click repository init (used by the tab for folders without a repo).
patch(
	"route-init",
	'\t\t\tcase "/git/conventions": {',
	`\t\t\tcase "/git/init": {
\t\t\t\tconst gated = await createWorkspaceGate(ctx)(path);
\t\t\t\tif (!gated.ok) {
\t\t\t\t\twriteJson(res, 200, FAIL(gated.error));
\t\t\t\t\treturn;
\t\t\t\t}
\t\t\t\tconst requested = payload !== null && typeof payload === "object" && typeof payload.branch === "string" ? payload.branch : void 0;
\t\t\t\tconst created = await repoInit(service, gated.canonical, requested);
\t\t\t\tif (!created.ok) {
\t\t\t\t\twriteJson(res, 200, FAIL(created.error));
\t\t\t\t\treturn;
\t\t\t\t}
\t\t\t\trepoScanCache.clear();
\t\t\t\tctx.logger.info("dsh-git-graph: initialized repository at " + created.value.root);
\t\t\t\twriteJson(res, 200, OK(created.value));
\t\t\t\treturn;
\t\t\t}
\t\t\tcase "/git/conventions": {`,
	'\t\t\tcase "/git/init": {'
);


// 12. Two read-only routes: branch cleanup hints (/git/cleanup, NOT
//     /git/branches — upstream already owns that path) and the health
//     report. Both answer FAIL(malformed-view) for a path that is not a
//     repository, the same verdict the other views give.
patch(
	"overview-routes",
	`			case "/git/init": {`,
	`			case "/git/cleanup": {
				const gated = await createWorkspaceGate(ctx)(path);
				if (!gated.ok) {
					writeJson(res, 200, FAIL(gated.error));
					return;
				}
				const report = await branchReport(service, gated.canonical);
				if (report === null) {
					writeJson(res, 200, FAIL(MALFORMED_VIEW));
					return;
				}
				writeJson(res, 200, OK(report));
				return;
			}
			case "/git/health": {
				const gated = await createWorkspaceGate(ctx)(path);
				if (!gated.ok) {
					writeJson(res, 200, FAIL(gated.error));
					return;
				}
				const report = await repoHealth(service, gated.canonical);
				if (report === null) {
					writeJson(res, 200, FAIL(MALFORMED_VIEW));
					return;
				}
				writeJson(res, 200, OK(report));
				return;
			}
			case "/git/init": {`
);

// 13. 1.6.0 routes: a compliance hint for the commits already made, an upgrade
//     preview for the document (never writes), and the workspace-wide document
//     at a container root. The preview route is added, never substituted: the
//     existing /git/convention stays the only writer.
patch(
	"compliance-routes",
	`			case "/git/conventions": {`,
	`			case "/git/compliance": {
				const gated = await createWorkspaceGate(ctx)(path);
				if (!gated.ok) {
					writeJson(res, 200, FAIL(gated.error));
					return;
				}
				const feature = featureOf(config);
				const snapshot = await service.rootAndHead(gated.canonical).catch(() => null);
				if (snapshot === null || typeof snapshot.root !== "string") {
					writeJson(res, 200, FAIL(MALFORMED_VIEW));
					return;
				}
				const report = await commitCompliance(service, snapshot.root, feature.docName);
				writeJson(res, 200, OK(report));
				return;
			}
			case "/git/convention/preview": {
				const gated = await createWorkspaceGate(ctx)(path);
				if (!gated.ok) {
					writeJson(res, 200, FAIL(gated.error));
					return;
				}
				const feature = featureOf(config);
				const snapshot = await service.rootAndHead(gated.canonical).catch(() => null);
				if (snapshot === null || typeof snapshot.root !== "string") {
					writeJson(res, 200, FAIL(MALFORMED_VIEW));
					return;
				}
				const framework = payload !== null && typeof payload === "object" && typeof payload.framework === "string" ? payload.framework : null;
				const preview = await conventionPreview(snapshot.root, feature.docName, framework);
				if (!preview.ok) {
					writeJson(res, 200, FAIL(preview.error));
					return;
				}
				writeJson(res, 200, OK(preview.value));
				return;
			}
			case "/git/workspace-convention": {
				const gated = await createWorkspaceGate(ctx)(path);
				if (!gated.ok) {
					writeJson(res, 200, FAIL(gated.error));
					return;
				}
				const feature = featureOf(config);
				const action = payload !== null && typeof payload === "object" && typeof payload.action === "string" ? payload.action : "state";
				const framework = payload !== null && typeof payload === "object" && typeof payload.framework === "string" ? payload.framework : null;
				const force = payload !== null && typeof payload === "object" && payload.force === true;
				const result = await workspaceConvention(gated.canonical, feature.docName, action, framework, force);
				if (!result.ok) {
					writeJson(res, 200, FAIL(result.error));
					return;
				}
				if (action === "write") ctx.logger.info("dsh-git-graph: wrote workspace document " + result.value.docPath);
				writeJson(res, 200, OK(result.value));
				return;
			}
			case "/git/conventions": {`,
	'\t\t\tcase "/git/compliance": {'
);

// 15. The language policy travels with the document too: the write stamps
//     `language: zh|en|mixed` into the front matter, and the upgrade preview
//     renders the same body the write would produce (strict included).
patch(
	"convention-preview-flags",
	`				const preview = await conventionPreview(snapshot.root, feature.docName, framework);`,
	`				const flags = payload !== null && typeof payload === "object" ? payload : {};
				const preview = await conventionPreview(snapshot.root, feature.docName, framework, flags.strict, flags.language, flags.ai);`
);

patch(
	"convention-language-write",
	`				const body = conventionBodyOf(framework, basename(snapshot.root), payload !== null && typeof payload === "object" ? payload.strict : void 0);`,
	`				const policy = payload !== null && typeof payload === "object" ? payload : {};
				const body = conventionBodyOf(framework, basename(snapshot.root), policy.strict, policy.language, policy.ai);`,
	"conventionBodyOf(framework, basename(snapshot.root), policy.strict"
);

patch(
	"workspace-language-write",
	`				const result = await workspaceConvention(gated.canonical, feature.docName, action, framework, force, payload !== null && typeof payload === "object" ? payload.strict : void 0);`,
	`				const policy = payload !== null && typeof payload === "object" ? payload : {};
				const result = await workspaceConvention(gated.canonical, feature.docName, action, framework, force, policy.strict, policy.language, policy.ai);`,
	"workspaceConvention(gated.canonical, feature.docName, action, framework, force, policy.strict"
);

patch(
	"convention-settings-route",
	`			case "/git/convention": {`,
	`			case "/git/convention/settings": {
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
				const policy = payload !== null && typeof payload === "object" ? payload : {};
				const updated = await conventionSettings(snapshot.root, feature.docName, policy.strict, policy.language, policy.ai);
				if (!updated.ok) {
					writeJson(res, 200, FAIL(updated.error));
					return;
				}
				ctx.logger.info("dsh-git-graph: updated the convention switches in " + updated.value.docPath);
				writeJson(res, 200, OK(updated.value));
				return;
			}
			case "/git/convention": {`,
	`			case "/git/convention/settings": {`
);

// 19. Exclusive detection: one route reports the disagreement, one merges the
//     documents (a dry run unless the payload asks to write).
patch(
	"convention-conflict-routes",
	'\t\tcase "/git/conventions": {',
	`\t\tcase "/git/conventions/conflicts": {
\t\t\tconst gated = await createWorkspaceGate(ctx)(path);
\t\t\tif (!gated.ok) {
\t\t\t\twriteJson(res, 200, FAIL(gated.error));
\t\t\t\treturn;
\t\t\t}
\t\t\tconst feature = featureOf(config);
\t\t\twriteJson(res, 200, OK(conventionsConflicts(gated.canonical, feature.docName)));
\t\t\treturn;
\t\t}
\t\tcase "/git/conventions/consolidate": {
\t\t\tconst gated = await createWorkspaceGate(ctx)(path);
\t\t\tif (!gated.ok) {
\t\t\t\twriteJson(res, 200, FAIL(gated.error));
\t\t\t\treturn;
\t\t\t}
\t\t\tconst feature = featureOf(config);
\t\t\tconst policy = payload !== null && typeof payload === "object" ? payload : {};
\t\t\tconst merged = await conventionsConsolidate(gated.canonical, feature.docName, {
\t\t\t\twrite: policy.write === true,
\t\t\t\tforce: policy.force === true
\t\t\t});
\t\t\tif (!merged.ok) {
\t\t\t\twriteJson(res, 200, FAIL(merged.error));
\t\t\t\treturn;
\t\t\t}
\t\t\tif (merged.value.written === true) ctx.logger.info("dsh-git-graph: consolidated " + merged.value.docPath);
\t\t\twriteJson(res, 200, OK(merged.value));
\t\t\treturn;
\t\t}
\t\tcase "/git/conventions": {`,
	'\t\t\tcase "/git/conventions/conflicts": {'
);

// 20. The same detection is reachable from a model step: the session's cwd is
//     the only input, and the tool reports rather than decides.
patch(
	"conventions-tool",
	'\t\ttoolCtx.effect(() => toolCtx.tools.register(buildWorktreeTool(ctx, service)), "dsh-git-graph: git_worktree tool");',
	'\t\ttoolCtx.effect(() => toolCtx.tools.register(buildWorktreeTool(ctx, service)), "dsh-git-graph: git_worktree tool");' +
	'\t\ttoolCtx.effect(() => toolCtx.tools.register(buildConventionsTool(featureConfig)), "dsh-git-graph: git_conventions tool");'
);

// A route case may appear exactly once: two copies mean an earlier run
// inserted a block a second time, and the second copy is dead code.
const caseLines = source.split(String.fromCharCode(10)).map((line) => line.trim()).filter((line) => line.startsWith("case \"") && line.endsWith(": {"));
const seenRoutes = new Set();
for (const line of caseLines) {
	if (seenRoutes.has(line)) throw new Error("patch-host: duplicate route case " + line);
	seenRoutes.add(line);
}

console.log("patch-host: applied " + applied.length + ", already present " + skipped.length +
	(applied.length > 0 ? " -> " + applied.join(", ") : ""));
writeFileSync(file, source, "utf8");
