window.__ModuleLoader__.load({
	id: "dsh-git-graph-sidebar",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_dom = require("react-dom");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/sse-leader.ts
		/** Live relays keyed by event name + URL (one per tab, ref-counted by listeners). */
		const relays = /* @__PURE__ */ new Map();
		/**
		* Subscribe to an SSE endpoint shared across every tab of the browser.
		* @param url - same-origin EventSource URL (including its query string).
		* @param eventName - the SSE event field to listen for (e.g. 'change').
		* @param onEvent - fired with the raw event data string on every push.
		* @param seams - constructor overrides (tests).
		* @returns the disposer; destroying the LAST local listener tears the relay down.
		*/
		function subscribeSharedEvents(url, eventName, onEvent, seams = {}) {
			const key = eventName + " " + url;
			let relay = relays.get(key);
			if (relay === void 0) {
				relay = createRelay(key, url, eventName, seams);
				relays.set(key, relay);
			}
			relay.listeners.add(onEvent);
			return () => {
				const current = relays.get(key);
				if (current === void 0) return;
				current.listeners.delete(onEvent);
				if (current.listeners.size === 0) {
					current.destroy();
					relays.delete(key);
				}
			};
		}
		function createRelay(key, url, eventName, seams) {
			const listeners = /* @__PURE__ */ new Set();
			const dispatch = (data) => {
				for (const listener of [...listeners]) listener(data);
			};
			const EventSourceImpl = seams.eventSource ?? EventSource;
			const ChannelImpl = seams.broadcastChannel ?? (typeof BroadcastChannel === "undefined" ? void 0 : BroadcastChannel);
			const locks = seams.locks ?? (typeof navigator === "undefined" || navigator.locks === void 0 ? void 0 : navigator.locks);
			if (ChannelImpl === void 0 || locks === void 0) {
				const source = new EventSourceImpl(url);
				source.addEventListener(eventName, (raw) => {
					dispatch(raw.data);
				});
				return {
					listeners,
					destroy: () => {
						source.close();
					}
				};
			}
			const channel = new ChannelImpl("dsh-sse:" + key);
			channel.addEventListener("message", (raw) => {
				dispatch(raw.data);
			});
			const abort = new AbortController();
			let release;
			let source;
			locks.request("dsh-sse:" + key, { signal: abort.signal }, () => {
				source = new EventSourceImpl(url);
				source.addEventListener(eventName, (raw) => {
					const data = raw.data;
					channel.postMessage(data);
					dispatch(data);
				});
				return new Promise((resolve) => {
					release = resolve;
				});
			}).catch(() => {});
			return {
				listeners,
				destroy() {
					channel.close();
					abort.abort();
					release?.();
					source?.close();
				}
			};
		}
		//#endregion
		//#region src/client/api.ts
		/**
		* Browser client for the host /git/* routes: typed JSON envelope calls plus
		* the SSE change subscription. Same-origin relative fetch (the page and the
		* routes share the webserver).
		* @module dsh-git-graph/client/api
		*/
		/** Transport failure (fetch threw or the response was not JSON). */
		const TRANSPORT_ERROR = {
			code: "internal",
			message: "git route unavailable"
		};
		/**
		* POST one JSON payload and decode the envelope; never throws.
		*
		* `path` is DOCUMENT-RELATIVE (no leading slash): the harness serves the GUI
		* with `<base href="./">`, so a sub-path deployment resolves the route
		* against its entry directory. A root-absolute path escapes that prefix and
		* never reaches the host route (issue #1707); the official client posts its
		* own routes the same way.
		*/
		async function post(path, payload) {
			let response;
			try {
				response = await fetch(path, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(payload)
				});
			} catch {
				return {
					ok: false,
					error: TRANSPORT_ERROR
				};
			}
			try {
				const envelope = await response.json();
				if (typeof envelope !== "object" || envelope === null) return {
					ok: false,
					error: TRANSPORT_ERROR
				};
				const record = envelope;
				if (record.ok === true) return {
					ok: true,
					value: record.value
				};
				return {
					ok: false,
					error: record.error ?? TRANSPORT_ERROR
				};
			} catch {
				return {
					ok: false,
					error: TRANSPORT_ERROR
				};
			}
		}
		/** Typed git operations over the wire. */
		var GitApi = class {
			/** The repository snapshot (null: not a git repository / not a workspace). */
			status(path) {
				return post("git/status", { path });
			}
			/** Local branch list with the current branch marked. */
			branches(path) {
				return post("git/branches", { path });
			}
			/** Workspace-level `git switch --no-guess <branch>` (host guards first). */
			switchBranch(path, branch) {
				return post("git/switch", {
					path,
					branch
				});
			}
			/** `git switch --no-guess -c <name>` from the current HEAD. */
			createBranch(path, name) {
				return post("git/create-branch", {
					path,
					name
				});
			}
			/** Topo-ordered commit graph across branches/tags/remotes. */
			graph(path, limit) {
				return post("git/graph", limit === void 0 ? { path } : {
					path,
					limit
				});
			}
			/** All linked worktrees of the workspace's repository. */
			worktrees(path) {
				return post("git/worktrees", { path });
			}
			/** Create a managed worktree on a new wt/<name> branch (host picks the path). */
			addWorktree(path, name, baseRef) {
				return post("git/worktree-add", baseRef === void 0 ? {
					path,
					name
				} : {
					path,
					name,
					baseRef
				});
			}
			/** Remove a managed worktree (dirty rejects unless force; deleteBranch drops the wt/ branch). */
			removeWorktree(path, worktreePath, opts) {
				return post("git/worktree-remove", {
					path,
					worktreePath,
					force: opts?.force === true,
					deleteBranch: opts?.deleteBranch === true
				});
			}
			/** The live feature config (auto-isolation flags + managed worktree home). */
			config() {
				return post("git/config", {});
			}
			/** The workspace's repositories: the base repository plus nested ones (read-only scan). */
			repos(path, refresh) {
				return post("git/repos", refresh === true ? { path, refresh: true } : { path });
			}
			/** Read and write the user's own convention templates (list/starter/get/save/delete/toggle). */
			conventionTemplates(action, payload) {
				const body = payload !== null && typeof payload === "object" ? payload : {};
				const request = { action };
				if (typeof body.id === "string") request.id = body.id;
				if (body.template !== null && typeof body.template === "object") request.template = body.template;
				if (typeof body.hidden === "boolean") request.hidden = body.hidden;
				return post("git/convention/templates", request);
			}
			/** Linked worktrees of one repository; the anchor path must be a registered workspace. */
			worktreeList(path) {
				return post("git/worktree/list", { path });
			}
			/** Status of one linked worktree; the anchor repository authorizes the target. */
			worktreeStatus(path, worktree) {
				return post("git/worktree/status", { path, worktree });
			}
			/** Branch heads of one linked worktree. */
			worktreeBranches(path, worktree) {
				return post("git/worktree/branches", { path, worktree });
			}
			/** Commit graph of one linked worktree. */
			worktreeGraph(path, worktree, limit) {
				const payload = { path, worktree };
				if (typeof limit === "number" && limit > 0) payload.limit = limit;
				return post("git/worktree/graph", payload);
			}
			/** Every convention document that governs this repository, and where they disagree. */
			conventionConflicts(path) {
				return post("git/conventions/conflicts", { path });
			}
			/** Branch cleanup hints: every local branch, and what the base already has. */
			cleanupBranches(path) {
				return post("git/cleanup", { path });
			}
			/** The read-only health report: detached HEAD, branches without upstream, stash, objects. */
			repoHealth(path) {
				return post("git/health", { path });
			}
			/** Check the last commits against the rules the document states. */
			commitCompliance(path) {
				return post("git/compliance", { path });
			}
			/** What choosing a framework would change in the existing document, AI policy included. */
			conventionPreview(path, framework, strict, language, ai) {
				const payload = { path };
				if (typeof framework === "string" && framework !== "") payload.framework = framework;
				if (typeof strict === "boolean") payload.strict = strict;
				if ("zh" === language || "en" === language || "mixed" === language) payload.language = language;
				if ("required" === ai || "optional" === ai || "forbidden" === ai) payload.ai = ai;
				return post("git/convention/preview", payload);
			}
			/** Workspace-wide document at a container root: state, preview or write. */
			workspaceConvention(path, payload) {
				const body = payload !== null && typeof payload === "object" ? payload : {};
				return post("git/workspace-convention", {
					path,
					action: typeof body.action === "string" ? body.action : "state",
					framework: typeof body.framework === "string" ? body.framework : void 0,
					force: body.force === true ? true : void 0,
					strict: typeof body.strict === "boolean" ? body.strict : void 0,
					language: typeof body.language === "string" ? body.language : void 0,
				ai: typeof body.ai === "string" ? body.ai : void 0
				});
			}
			/** Initialize a repository in a directory that has none yet. */
			initRepo(path, branch) {
				const payload = { path };
				if (typeof branch === "string" && branch.trim() !== "") payload.branch = branch.trim();
				return post("git/init", payload);
			}
			/** Update only the subject language, strict switch and AI policy of an existing document. */
			conventionSettings(path, payload) {
				const body = payload !== null && typeof payload === "object" ? payload : {};
				const request = { path };
				if (typeof body.strict === "boolean") request.strict = body.strict;
				if ("zh" === body.language || "en" === body.language || "mixed" === body.language) request.language = body.language;
				if ("required" === body.ai || "optional" === body.ai || "forbidden" === body.ai) request.ai = body.ai;
				return post("git/convention/settings", request);
			}
			/** Write a convention document with explicit strict, language and AI-attribution flags. */
			conventionOptions(path, framework, force, strict, language, ai) {
				const payload = { path };
				if (typeof framework === "string" && framework !== "") payload.framework = framework;
				if (force === true) payload.force = true;
				if (typeof strict === "boolean") payload.strict = strict;
				if ("zh" === language || "en" === language || "mixed" === language) payload.language = language;
				if ("required" === ai || "optional" === ai || "forbidden" === ai) payload.ai = ai;
				return post("git/convention", payload);
			}
			/** The repository's Git-convention state plus the framework catalogue. */
			conventions(path) {
				return post("git/conventions", { path });
			}
			/** Write the convention document: a framework template, or the empty scaffold. */
			convention(path, framework, force) {
				const payload = { path };
				if (typeof framework === "string" && framework !== "") payload.framework = framework;
				if (force === true) payload.force = true;
				return post("git/convention", payload);
			}








			/** Merge the conflicting documents into the workspace one; a dry run unless write is true. */
			conventionsConsolidate(path, payload) {
				const body = payload !== null && typeof payload === "object" ? payload : {};
				const request = { path };
				if (body.write === true) request.write = true;
				if (body.force === true) request.force = true;
				return post("git/conventions/consolidate", request);
			}
		};
		/**
		* Subscribe to host-pushed branch-state changes for one workspace path (the
		* host polls the workspace while a subscriber is connected). Reconnects are
		* handled by the EventSource; the caller re-subscribes when the path changes.
		* @param path - workspace root to watch.
		* @param onChange - fired on every pushed change.
		* @returns the disposer closing the stream.
		*/
		function subscribeChanges(path, onChange) {
			return subscribeSharedEvents(`git/events?path=${encodeURIComponent(path)}`, "change", () => {
				onChange();
			});
		}
		//#endregion
		//#region \0dsh-css:packages/dsh-git-graph/src/client/chips/context.module.css.mjs
		const css = "._7rgC5q_anchor{position:relative}._7rgC5q_chipWrap{display:inline-flex;position:relative}._7rgC5q_anchorHero{align-items:center;padding-left:0;display:inline-flex}._7rgC5q_chip{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-button-tool-bar-fill);height:24px;color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap;border-radius:999px;align-items:center;gap:6px;padding:0 10px;font-size:12px;line-height:1;transition:background-color .12s,border-color .12s,color .12s,gap .12s,padding .12s;display:inline-flex}._7rgC5q_chip:hover{background:var(--dsw-alias-interactive-bg-hover)}._7rgC5q_chip:active{background:var(--dsw-alias-interactive-bg-active)}._7rgC5q_chip:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-brand-primary);outline:none}._7rgC5q_chip:disabled{opacity:.55;cursor:not-allowed}._7rgC5q_chip:disabled:hover{background:var(--dsw-alias-button-tool-bar-fill)}._7rgC5q_chipOpen{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary)}._7rgC5q_chipLabel{text-overflow:ellipsis;max-width:220px;overflow:hidden}._7rgC5q_chipChevron{color:var(--dsw-alias-label-tertiary)}._7rgC5q_chipHero{max-width:min(100%,240px);height:auto;min-height:28px;color:var(--dsw-alias-label-primary);background:0 0;border:none;border-radius:16px;gap:4px;padding:0 8px;font-size:13px;font-weight:500;line-height:20px;overflow:hidden}._7rgC5q_chipHero:hover,._7rgC5q_chipHero:active,._7rgC5q_chipHero._7rgC5q_chipOpen{background:var(--dsw-alias-interactive-bg-hover)}._7rgC5q_chipHero ._7rgC5q_chipLabel{max-width:180px}._7rgC5q_chipHero ._7rgC5q_chipChevron{color:var(--dsw-alias-label-caption)}._7rgC5q_backdrop{z-index:30;position:fixed;inset:0}._7rgC5q_popover{z-index:100;border:1px solid var(--dsw-alias-border-inverted);background:var(--dsw-specific-menu);width:280px;max-height:360px;box-shadow:var(--dsw-shadow-lv3);border-radius:12px;flex-direction:column;padding:4px;display:flex;position:absolute;bottom:calc(100% + 8px);left:0;overflow:hidden}._7rgC5q_popoverHero{top:calc(100% + 4px);bottom:auto}._7rgC5q_searchBox{background:var(--dsw-alias-interactive-bg-hover-solid);color:var(--dsw-alias-label-primary);border:2px solid #0000;border-radius:8px;align-items:center;gap:6px;margin:8px;padding:6px 10px;transition:border-color .12s,box-shadow .12s;display:flex}._7rgC5q_searchBox:focus-within{border-color:var(--dsw-alias-brand-primary);box-shadow:none}body[data-ds-dark-theme] ._7rgC5q_searchBox{background:var(--dsw-alias-bg-base)}._7rgC5q_searchInput{min-width:0;color:var(--dsw-alias-label-primary);background:0 0;border:none;outline:none;flex:1;font-size:13px;transition:box-shadow .12s}._7rgC5q_searchInput::placeholder{color:var(--dsw-alias-label-tertiary)}._7rgC5q_list{scrollbar-width:thin;scrollbar-color:var(--dsw-alias-scrollbar-bg-l2) transparent;flex:1;min-height:64px;padding:2px 6px 6px;overflow:hidden auto}._7rgC5q_list::-webkit-scrollbar{width:6px}._7rgC5q_list::-webkit-scrollbar-thumb{background:var(--dsw-alias-scrollbar-bg-l2);border-radius:3px}._7rgC5q_list::-webkit-scrollbar-track{background:0 0}._7rgC5q_item{box-sizing:border-box;cursor:pointer;text-align:left;background:0 0;border:none;border-radius:8px;align-items:center;gap:8px;width:100%;min-width:0;max-width:100%;padding:7px 8px;transition:background-color .12s;display:flex;position:relative}._7rgC5q_item:hover{background:var(--dsw-alias-interactive-bg-hover)}._7rgC5q_item:active{background:var(--dsw-alias-interactive-bg-active)}._7rgC5q_item:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-brand-primary);outline:none}._7rgC5q_item:disabled{opacity:.55;cursor:not-allowed}._7rgC5q_item:disabled:hover{background:0 0}._7rgC5q_itemText{flex:1;min-width:0}._7rgC5q_itemName{text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary);font-size:13px;display:block;overflow:hidden}._7rgC5q_itemPath{text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary);margin-top:1px;font-size:11px;overflow:hidden}._7rgC5q_check{color:var(--dsw-alias-brand-primary);flex:none}._7rgC5q_empty{text-align:center;color:var(--dsw-alias-label-tertiary);padding:14px 10px;font-size:12px}._7rgC5q_dirty{color:var(--dsw-alias-state-warn-primary);margin:0 10px 4px;font-size:11px}._7rgC5q_notice{background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 14%, transparent);color:var(--dsw-alias-state-error-primary);border-radius:8px;margin:0 8px 8px;padding:6px 10px;font-size:12px}._7rgC5q_noticeOk{background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 14%, transparent);color:var(--dsw-alias-state-success-primary)}._7rgC5q_footer{border-top:1px solid var(--dsw-alias-border-l1);flex-direction:column;gap:2px;padding:6px;display:flex}._7rgC5q_footerItem{cursor:pointer;color:var(--dsw-alias-label-primary);text-align:left;background:0 0;border:none;border-radius:8px;align-items:center;gap:8px;padding:7px 10px;font-size:13px;transition:background-color .12s;display:flex}._7rgC5q_footerItem:hover{background:var(--dsw-alias-interactive-bg-hover)}._7rgC5q_footerItem:active{background:var(--dsw-alias-interactive-bg-active)}._7rgC5q_footerItem:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-brand-primary);outline:none}._7rgC5q_footerItem:disabled{opacity:.55;cursor:not-allowed}._7rgC5q_footerItem:disabled:hover{background:0 0}._7rgC5q_footerItemDisabled{opacity:.55;cursor:not-allowed}._7rgC5q_footerItemDisabled:hover{background:0 0}._7rgC5q_footerHint{color:var(--dsw-alias-label-tertiary);margin-left:auto;font-size:11px}._7rgC5q_dialog{z-index:50;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-overlay);width:min(760px,100vw - 48px);max-height:min(76vh,720px);box-shadow:0 12px 32px var(--dsw-alias-bg-mask-2);border-radius:12px;flex-direction:column;padding:16px 16px 12px;display:flex;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%)}._7rgC5q_dialogHeader{justify-content:space-between;align-items:flex-start;gap:12px;padding:0 4px;display:flex}._7rgC5q_dialogHeading{min-width:0}._7rgC5q_dialogClose{width:26px;height:26px;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:none;border-radius:8px;flex:none;justify-content:center;align-items:center;margin:-2px;transition:background-color .12s,color .12s;display:inline-flex}._7rgC5q_dialogClose:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}._7rgC5q_dialogClose:active{background:var(--dsw-alias-interactive-bg-active)}._7rgC5q_dialogClose:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-brand-primary);outline:none}._7rgC5q_dialogTitle{color:var(--dsw-alias-label-primary);margin:0 0 2px;font-size:15px;font-weight:600}._7rgC5q_dialogDescription{color:var(--dsw-alias-label-secondary);margin:0 0 12px;font-size:12px;line-height:1.5}._7rgC5q_dialogField{flex-direction:column;gap:6px;display:flex}._7rgC5q_dialogLabel{color:var(--dsw-alias-label-secondary);font-size:12px}._7rgC5q_dialogInput{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);border-radius:8px;outline:none;padding:8px 10px;font-size:13px;transition:border-color .12s,box-shadow .12s}._7rgC5q_dialogInput:focus{border-color:var(--dsw-alias-brand-primary)}._7rgC5q_dialogInput:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-brand-primary)}._7rgC5q_dialogError{color:var(--dsw-alias-state-error-primary);margin-top:8px;font-size:12px}._7rgC5q_dialogActions{justify-content:flex-end;gap:8px;margin-top:14px;display:flex}._7rgC5q_dialogButton{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-button-tool-bar-fill);color:var(--dsw-alias-label-primary);cursor:pointer;border-radius:8px;padding:6px 14px;font-size:13px;transition:background-color .12s,border-color .12s,color .12s}._7rgC5q_dialogButton:hover{background:var(--dsw-alias-interactive-bg-hover)}._7rgC5q_dialogButton:active{background:var(--dsw-alias-interactive-bg-active)}._7rgC5q_dialogButton:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-brand-primary);outline:none}._7rgC5q_dialogButton:disabled{opacity:.55;cursor:not-allowed}._7rgC5q_dialogButton:disabled:hover{background:var(--dsw-alias-button-tool-bar-fill)}._7rgC5q_dialogButtonPrimary{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-button-contrast-fill);transition:background-color .12s,border-color .12s,filter .12s}._7rgC5q_dialogButtonPrimary:hover{background:var(--dsw-alias-button-primary-hover)}._7rgC5q_dialogButtonPrimary:active{filter:brightness(.92)}._7rgC5q_dialogButtonPrimary:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-button-contrast-fill), 0 0 0 4px var(--dsw-alias-brand-primary);outline:none}._7rgC5q_dialogButtonPrimary:disabled{opacity:.6;cursor:not-allowed}._7rgC5q_dialogButtonPrimary:disabled:hover{background:var(--dsw-alias-brand-primary)}._7rgC5q_graphBody{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;flex:1;min-height:240px;margin-top:10px;padding:4px;overflow-y:auto}._7rgC5q_graphSubtitle{color:var(--dsw-alias-label-tertiary);margin-top:2px;font-size:11px}._7rgC5q_graphRow{border-radius:8px;align-items:center;gap:10px;padding:7px 8px;font-size:12px;display:flex}._7rgC5q_graphRow:hover{background:var(--dsw-alias-interactive-bg-hover)}._7rgC5q_graphLanes{color:var(--dsw-alias-label-tertiary);flex:none;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:1.4;display:flex}._7rgC5q_graphLaneCell{text-align:center;flex:none;width:15px;display:inline-block}._7rgC5q_graphLaneNode,._7rgC5q_graphLaneMerge{color:var(--dsw-alias-brand-primary);font-weight:700}._7rgC5q_graphLanePass{color:var(--dsw-alias-label-tertiary)}._7rgC5q_graphOid{min-width:58px;color:var(--dsw-alias-label-tertiary);flex:none;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px}._7rgC5q_graphMain{flex-direction:column;flex:1;gap:3px;min-width:0;display:flex}._7rgC5q_graphSubject{text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;overflow:hidden}._7rgC5q_graphMeta{color:var(--dsw-alias-label-tertiary);flex-wrap:wrap;align-items:center;gap:4px 6px;font-size:11px;display:flex}._7rgC5q_graphMetaSep{color:var(--dsw-alias-label-tertiary);flex:none}._7rgC5q_graphRef{text-overflow:ellipsis;background:var(--dsw-alias-bg-layer-2);max-width:120px;color:var(--dsw-alias-label-secondary);border-radius:999px;flex:none;padding:1px 6px;font-size:10px;overflow:hidden}._7rgC5q_graphRefCurrent{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-button-contrast-fill)}[data-gitgraph-chip-anchor][data-gitgraph-stock-light]{--gitgraph-stock-ink-rgb:15, 17, 21;--gitgraph-stock-ink:#0f1115;--gitgraph-stock-on-success:#fff;--gitgraph-stock-success-fill:#137333;--gitgraph-stock-success-border:#0f5f2b;--dsw-alias-button-tool-bar-fill:rgba(var(--gitgraph-stock-ink-rgb), .04);--dsw-alias-button-tool-bar-hover:rgba(var(--gitgraph-stock-ink-rgb), .08);--dsw-alias-border-l2:rgba(var(--gitgraph-stock-ink-rgb), .16);--dsw-alias-interactive-bg-hover:rgba(var(--gitgraph-stock-ink-rgb), .06);--dsw-alias-interactive-bg-active:rgba(var(--gitgraph-stock-ink-rgb), .1);--dsw-alias-label-primary:var(--gitgraph-stock-ink);--dsw-alias-label-secondary:var(--gitgraph-stock-ink);--dsw-alias-label-tertiary:rgba(var(--gitgraph-stock-ink-rgb), .56);--dsw-alias-button-contrast-fill:var(--gitgraph-stock-on-success)}[data-gitgraph-chip-anchor][data-gitgraph-stock-light] ._7rgC5q_noticeOk{background:var(--gitgraph-stock-success-fill);color:var(--gitgraph-stock-on-success);box-shadow:inset 0 0 0 1px var(--gitgraph-stock-success-border)}._7rgC5q_graphEmpty{text-align:center;color:var(--dsw-alias-label-tertiary);padding:24px 10px;font-size:12px}._7rgC5q_graphMore{border:1px solid var(--dsw-alias-border-l1);width:100%;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border-radius:8px;margin-top:8px;padding:6px;font-size:12px;transition:background-color .12s;display:block}._7rgC5q_graphMore:hover{background:var(--dsw-alias-interactive-bg-hover)}._7rgC5q_graphMore:active{background:var(--dsw-alias-interactive-bg-active)}._7rgC5q_graphMore:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-brand-primary);outline:none}@media (prefers-reduced-motion:reduce){._7rgC5q_chip,._7rgC5q_searchBox,._7rgC5q_searchInput,._7rgC5q_item,._7rgC5q_footerItem,._7rgC5q_dialogClose,._7rgC5q_dialogInput,._7rgC5q_dialogButton,._7rgC5q_dialogButtonPrimary,._7rgC5q_graphMore{transition:none}}._7rgC5q_item:after{content:attr(data-tip);z-index:80;background:var(--dsw-alias-label-primary,#111);color:var(--dsw-alias-bg-base,#fff);border:1px solid var(--dsw-alias-border-l1,#ffffff40);white-space:normal;word-break:break-all;box-shadow:var(--dsw-shadow-lv3);pointer-events:none;border-radius:8px;padding:6px 8px;font-size:12px;line-height:1.5;display:none;position:absolute;bottom:calc(100% + 4px);left:0;right:0}._7rgC5q_item[data-tip=\"\"]:after{display:none!important}._7rgC5q_item[data-tip-dir=down]:after{top:calc(100% + 4px);bottom:auto}._7rgC5q_item[data-tip-ready=true]:hover:after{display:block}._7rgC5q_managerList{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;flex:1;min-height:120px;margin-top:10px;padding:4px;overflow-y:auto}._7rgC5q_managerRow{border-radius:8px;justify-content:space-between;align-items:flex-start;gap:10px;padding:8px;font-size:12px;display:flex}._7rgC5q_managerRow:hover{background:var(--dsw-alias-interactive-bg-hover)}._7rgC5q_managerInfo{flex-direction:column;flex:1;gap:3px;min-width:0;display:flex}._7rgC5q_managerHeadline{color:var(--dsw-alias-label-primary);align-items:center;gap:6px;display:flex}._7rgC5q_managerBranch{text-overflow:ellipsis;white-space:nowrap;font-weight:500;overflow:hidden}._7rgC5q_managerBadge{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);border-radius:999px;flex:none;padding:1px 6px;font-size:10px}._7rgC5q_managerOid{color:var(--dsw-alias-label-tertiary);flex:none;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px}._7rgC5q_managerPath{text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;overflow:hidden}._7rgC5q_managerConfirm{color:var(--dsw-alias-state-error-primary);align-items:center;gap:8px;margin-top:2px;font-size:12px;display:flex}._7rgC5q_managerActions{flex-direction:column;flex:none;align-items:flex-end;gap:6px;display:flex}._7rgC5q_managerCheck{color:var(--dsw-alias-label-secondary);cursor:pointer;align-items:center;gap:4px;font-size:11px;display:flex}";
		const tagId = "dsh-git-graph-sidebar/packages/dsh-git-graph/src/client/chips/context.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-git-graph-sidebar";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var context_module_css_default = {
			"anchor": "_7rgC5q_anchor",
			"anchorHero": "_7rgC5q_anchorHero",
			"backdrop": "_7rgC5q_backdrop",
			"check": "_7rgC5q_check",
			"chip": "_7rgC5q_chip",
			"chipChevron": "_7rgC5q_chipChevron",
			"chipHero": "_7rgC5q_chipHero",
			"chipLabel": "_7rgC5q_chipLabel",
			"chipOpen": "_7rgC5q_chipOpen",
			"chipWrap": "_7rgC5q_chipWrap",
			"dialog": "_7rgC5q_dialog",
			"dialogActions": "_7rgC5q_dialogActions",
			"dialogButton": "_7rgC5q_dialogButton",
			"dialogButtonPrimary": "_7rgC5q_dialogButtonPrimary",
			"dialogClose": "_7rgC5q_dialogClose",
			"dialogDescription": "_7rgC5q_dialogDescription",
			"dialogError": "_7rgC5q_dialogError",
			"dialogField": "_7rgC5q_dialogField",
			"dialogHeader": "_7rgC5q_dialogHeader",
			"dialogHeading": "_7rgC5q_dialogHeading",
			"dialogInput": "_7rgC5q_dialogInput",
			"dialogLabel": "_7rgC5q_dialogLabel",
			"dialogTitle": "_7rgC5q_dialogTitle",
			"dirty": "_7rgC5q_dirty",
			"empty": "_7rgC5q_empty",
			"footer": "_7rgC5q_footer",
			"footerHint": "_7rgC5q_footerHint",
			"footerItem": "_7rgC5q_footerItem",
			"footerItemDisabled": "_7rgC5q_footerItemDisabled",
			"graphBody": "_7rgC5q_graphBody",
			"graphEmpty": "_7rgC5q_graphEmpty",
			"graphLaneCell": "_7rgC5q_graphLaneCell",
			"graphLaneMerge": "_7rgC5q_graphLaneMerge",
			"graphLaneNode": "_7rgC5q_graphLaneNode",
			"graphLanePass": "_7rgC5q_graphLanePass",
			"graphLanes": "_7rgC5q_graphLanes",
			"graphMain": "_7rgC5q_graphMain",
			"graphMeta": "_7rgC5q_graphMeta",
			"graphMetaSep": "_7rgC5q_graphMetaSep",
			"graphMore": "_7rgC5q_graphMore",
			"graphOid": "_7rgC5q_graphOid",
			"graphRef": "_7rgC5q_graphRef",
			"graphRefCurrent": "_7rgC5q_graphRefCurrent",
			"graphRow": "_7rgC5q_graphRow",
			"graphSubject": "_7rgC5q_graphSubject",
			"graphSubtitle": "_7rgC5q_graphSubtitle",
			"item": "_7rgC5q_item",
			"itemName": "_7rgC5q_itemName",
			"itemPath": "_7rgC5q_itemPath",
			"itemText": "_7rgC5q_itemText",
			"list": "_7rgC5q_list",
			"managerActions": "_7rgC5q_managerActions",
			"managerBadge": "_7rgC5q_managerBadge",
			"managerBranch": "_7rgC5q_managerBranch",
			"managerCheck": "_7rgC5q_managerCheck",
			"managerConfirm": "_7rgC5q_managerConfirm",
			"managerHeadline": "_7rgC5q_managerHeadline",
			"managerInfo": "_7rgC5q_managerInfo",
			"managerList": "_7rgC5q_managerList",
			"managerOid": "_7rgC5q_managerOid",
			"managerPath": "_7rgC5q_managerPath",
			"managerRow": "_7rgC5q_managerRow",
			"notice": "_7rgC5q_notice",
			"noticeOk": "_7rgC5q_noticeOk",
			"popover": "_7rgC5q_popover",
			"popoverHero": "_7rgC5q_popoverHero",
			"searchBox": "_7rgC5q_searchBox",
			"searchInput": "_7rgC5q_searchInput"
		};
		//#endregion
		//#region src/client/chips/Chip.tsx
		/** Join conditional class names (the dependency-free clsx stand-in). */
		function cx(...parts) {
			return parts.filter((part) => typeof part === "string" && part !== "").join(" ");
		}
		/** The pill button shared by the project and branch chips. */
		function Chip({ icon, label, ariaLabel, open, onClick, hero = false }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				"data-gitgraph-chip": true,
				className: cx(context_module_css_default.chip, open && context_module_css_default.chipOpen, hero && context_module_css_default.chipHero),
				onClick,
				"aria-label": ariaLabel,
				"aria-expanded": open,
				children: [
					icon,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: context_module_css_default.chipLabel,
						title: label,
						children: label
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutlineMedium, {
						className: context_module_css_default.chipChevron,
						size: 12
					})
				]
			});
		}
		/** Full-screen transparent backdrop closing the open popover/dialog on click. */
		function Backdrop({ onClose }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: context_module_css_default.backdrop,
				onClick: onClose
			});
		}
		//#endregion
		//#region src/client/chips/error-copy.ts
		/** The blocked-file sentence tail: quoted paths plus the overflow count. */
		function pathsText(error, t) {
			return `${(error.paths ?? []).map((path) => `"${path}"`).join(t("error.pathsSeparator"))}${error.moreFiles !== void 0 && error.moreFiles > 0 ? ` ${t("error.moreFiles", { count: error.moreFiles })}` : ""}`;
		}
		/**
		* One readable message for a git operation rejection.
		* @param error - the classified git error.
		* @param t - the git-graph namespace translate seat.
		* @returns the sentence for the error's code.
		*/
		function errorMessage(error, t) {
			switch (error.code) {
				case "conflicts-present": return t("error.conflictsPresent");
				case "operation-in-progress": return t("error.operationInProgress");
				case "branch-in-other-worktree": return t("error.branchInOtherWorktree");
				case "tracked-changes-would-be-overwritten": return t("error.trackedOverwrite", { paths: pathsText(error, t) });
				case "untracked-changes-would-be-overwritten": return t("error.untrackedOverwrite", { paths: pathsText(error, t) });
				case "target-branch-not-found": return t("error.targetBranchNotFound");
				case "invalid-branch-name": return t("error.invalidBranchName");
				case "branch-already-exists": return t("error.branchAlreadyExists");
				case "workspace-unknown": return t("error.workspaceUnknown");
				case "invalid-worktree-name": return t("error.invalidWorktreeName");
				case "worktree-already-exists": return t("error.worktreeAlreadyExists");
				case "worktree-dirty": return t("error.worktreeDirty");
				case "worktree-not-found": return t("error.worktreeNotFound");
				case "worktree-is-main": return t("error.worktreeIsMain");
				case "base-ref-not-found": return t("error.baseRefNotFound");
				case "internal": return t("error.requestFailed", { error: error.message });
			}
		}
		//#endregion
		//#region src/client/chips/BranchPopover.tsx
		/**
		* The branch picker popover: searchable local branch list with the current
		* branch checked, the dirtiness line, switch feedback (success/error), and
		* the footer flows (create branch / Git graph).
		* @module dsh-git-graph/client/chips/BranchPopover
		*/
		/** How long the success notice stays before the popover closes itself. */
		const SUCCESS_DISMISS_MS = 900;
		/**
		* The branch picker popover.
		* @param props - see {@link BranchPopoverProps}.
		*/
		function BranchPopover({ view, onSwitch, onSwitched, onCreate, onGraph, onCreateWorktree, onManageWorktrees, onClose, t, hero = false }) {
			const [query, setQuery] = (0, react.useState)("");
			const [pending, setPending] = (0, react.useState)(null);
			const [error, setError] = (0, react.useState)(null);
			const [success, setSuccess] = (0, react.useState)(null);
			const dismissTimer = (0, react.useRef)(void 0);
			const [tipReadyName, setTipReadyName] = (0, react.useState)(null);
			const [tipActive, setTipActive] = (0, react.useState)(false);
			const [tipDir, setTipDir] = (0, react.useState)("up");
			const tipTimer = (0, react.useRef)(void 0);
			(0, react.useEffect)(() => () => {
				if (dismissTimer.current !== void 0) clearTimeout(dismissTimer.current);
				if (tipTimer.current !== void 0) clearTimeout(tipTimer.current);
			}, []);
			const filtered = (0, react.useMemo)(() => {
				const needle = query.trim().toLowerCase();
				if (needle === "") return view.branches;
				return view.branches.filter((branch) => branch.name.toLowerCase().includes(needle));
			}, [view.branches, query]);
			const switchTo = (branch) => {
				if (pending !== null) return;
				setPending(branch);
				setError(null);
				setSuccess(null);
				onSwitch(branch).then((result) => {
					if (result.ok) {
						onSwitched();
						setSuccess(t("toast.switchSuccess", { branchName: result.branch }));
						dismissTimer.current = setTimeout(onClose, SUCCESS_DISMISS_MS);
						return;
					}
					setError(errorMessage(result.error, t));
				}).finally(() => {
					setPending(null);
				});
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Backdrop, { onClose }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: cx(context_module_css_default.popover, hero && context_module_css_default.popoverHero),
				role: "listbox",
				"aria-label": t("branch.search"),
				"data-gitgraph-popover": true,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: context_module_css_default.searchBox,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconSearchOutlineRegular, { size: 14 }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							className: context_module_css_default.searchInput,
							value: query,
							onChange: (event) => {
								setQuery(event.target.value);
							},
							placeholder: t("branch.search"),
							autoFocus: true
						})]
					}),
					view.dirtyFiles > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: context_module_css_default.dirty,
						children: t("branch.dirty", { count: view.dirtyFiles })
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: context_module_css_default.list,
						onMouseLeave: () => {
							if (tipTimer.current !== void 0) {
								clearTimeout(tipTimer.current);
								tipTimer.current = void 0;
							}
							setTipActive(false);
							setTipReadyName(null);
						},
						children: filtered.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: context_module_css_default.empty,
							children: t("branch.empty")
						}) : filtered.map((branch) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							className: cx(context_module_css_default.item, branch.current && context_module_css_default.itemActive),
							onClick: () => {
								switchTo(branch.name);
							},
							role: "option",
							"aria-selected": branch.current,
							"data-tip": branch.name.length > 18 ? branch.name : "",
							"data-tip-ready": branch.name === tipReadyName ? "true" : "",
							"aria-label": branch.name,
							"data-tip-dir": tipDir,
							onMouseEnter: (event) => {
								if (tipTimer.current !== void 0) clearTimeout(tipTimer.current);
								const list = event.currentTarget.parentElement;
								if (list !== null) {
									const itemTop = event.currentTarget.getBoundingClientRect().top;
									const listTop = list.getBoundingClientRect().top;
									setTipDir(itemTop - listTop < 56 ? "down" : "up");
								}
								if (tipActive) setTipReadyName(branch.name);
								else tipTimer.current = setTimeout(() => {
									setTipActive(true);
									setTipReadyName(branch.name);
								}, 500);
							},
							disabled: pending !== null,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconBranchOutlineRegular, { size: 14 }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: context_module_css_default.itemText,
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: context_module_css_default.itemName,
										title: branch.name,
										children: branch.name
									})
								}),
								branch.current && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCheckOutlineMedium, {
									className: context_module_css_default.check,
									size: 14
								})
							]
						}, branch.name))
					}),
					success !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: cx(context_module_css_default.notice, context_module_css_default.noticeOk),
						children: success
					}),
					error !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: context_module_css_default.notice,
						children: error
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: context_module_css_default.footer,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: context_module_css_default.footerItem,
								onClick: onCreate,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconBranchOutlineRegular, { size: 14 }), t("branch.create")]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: context_module_css_default.footerItem,
								onClick: onGraph,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconBranchOutlineRegular, { size: 14 }), t("branch.graph")]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: context_module_css_default.footerItem,
								onClick: onCreateWorktree,
								"data-dsh-part": "worktree-create",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconBranchOutlineRegular, { size: 14 }), t("worktree.create")]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: context_module_css_default.footerItem,
								onClick: onManageWorktrees,
								"data-dsh-part": "worktree-manage",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconBranchOutlineRegular, { size: 14 }), t("worktree.manage")]
							})
						]
					})
				]
			})] });
		}
		//#endregion
		//#region src/core/git-command.ts
		/**
		* Sanitize a user/agent-supplied worktree name into a safe directory and
		* branch component: lowercase, alnum plus ._-, no leading/trailing dash/dot,
		* capped at 64 chars. Returns null when nothing usable remains.
		* @param raw - the proposed worktree name.
		*/
		function sanitizeWorktreeName(raw) {
			const cleaned = raw.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/-{2,}/g, "-").replace(/^[-.]+/, "").replace(/[-.]+$/, "").slice(0, 64);
			if (cleaned === "" || cleaned === "." || cleaned === "..") return null;
			return cleaned;
		}
		new TextEncoder();
		new TextDecoder();
		/**
		* Pure mirror of `git check-ref-format --branch` short-name rules, for
		* instant client-side feedback; the host's check-ref-format call stays the
		* authoritative gate. Returns the reason when the name is invalid.
		* @param name - proposed branch name (short form, no refs/ prefix).
		* @returns null when valid, else a short reason.
		*/
		function validateBranchName(name) {
			if (name === "") return "empty";
			if (name === "@") return "at-sign";
			if (name.startsWith("-")) return "leading-dash";
			if (name.endsWith(".")) return "trailing-dot";
			if (name.endsWith(".lock")) return "lock-suffix";
			if (name.includes("..")) return "double-dot";
			if (name.includes("@{")) return "at-brace";
			if (name.includes("//")) return "double-slash";
			if (name.includes(" ")) return "space";
			if (name.includes("~") || name.includes("^") || name.includes(":")) return "forbidden-char";
			if (name.includes("?") || name.includes("*") || name.includes("[") || name.includes("\\")) return "forbidden-char";
			for (const ch of name) {
				const code = ch.codePointAt(0);
				if (code !== void 0 && (code < 32 || code === 127)) return "control-char";
			}
			for (const component of name.split("/")) {
				if (component === "") return "empty-component";
				if (component.startsWith(".")) return "dot-component";
				if (component.endsWith(".lock")) return "lock-suffix";
			}
			if (name.length > 1e3) return "too-long";
			return null;
		}
		//#endregion
		//#region src/client/chips/CreateBranchDialog.tsx
		/**
		* The create-branch dialog: name input with the pure validation mirror for
		* instant feedback, the host `check-ref-format` gate as the authority, and
		* readable rejection copy.
		* @module dsh-git-graph/client/chips/CreateBranchDialog
		*/
		/**
		* The create-and-switch dialog.
		* @param props - see {@link CreateBranchDialogProps}.
		*/
		function CreateBranchDialog({ onCreate, onClose, t }) {
			const [name, setName] = (0, react.useState)("");
			const [pending, setPending] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)(null);
			const submit = () => {
				if (pending) return;
				const trimmed = name.trim();
				if (validateBranchName(trimmed) !== null) {
					setError(t("error.invalidBranchName"));
					return;
				}
				setPending(true);
				setError(null);
				onCreate(trimmed).then((result) => {
					if (result.ok) {
						onClose();
						return;
					}
					setError(errorMessage(result.error, t));
				}).finally(() => {
					setPending(false);
				});
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Backdrop, { onClose }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: context_module_css_default.dialog,
				role: "dialog",
				"aria-label": t("branch.createDialog.title"),
				"data-gitgraph-dialog": true,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
						className: context_module_css_default.dialogTitle,
						children: t("branch.createDialog.title")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: context_module_css_default.dialogDescription,
						children: t("branch.createDialog.description")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: context_module_css_default.dialogField,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
							className: context_module_css_default.dialogLabel,
							htmlFor: "git-graph-branch-name",
							children: t("branch.createDialog.nameLabel")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							id: "git-graph-branch-name",
							className: context_module_css_default.dialogInput,
							value: name,
							onChange: (event) => {
								setName(event.target.value);
							},
							placeholder: t("branch.createDialog.placeholder"),
							onKeyDown: (event) => {
								if (event.key === "Enter") submit();
							},
							autoFocus: true
						})]
					}),
					error !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: context_module_css_default.dialogError,
						children: error
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: context_module_css_default.dialogActions,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: context_module_css_default.dialogButton,
							onClick: onClose,
							children: t("branch.createDialog.cancel")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: context_module_css_default.dialogButtonPrimary,
							onClick: submit,
							disabled: pending || name.trim() === "",
							children: t("branch.createDialog.confirm")
						})]
					})
				]
			})] });
		}
		//#endregion
		//#region src/client/chips/CreateWorktreeDialog.tsx
		/**
		* The create-worktree dialog: name input with the sanitizer mirror for
		* instant feedback, a base-branch picker (default: the checkout's current
		* branch), and readable rejection copy. Success registers the worktree as a
		* workspace and starts a new session in it (the owner owns that flow).
		* @module dsh-git-graph/client/chips/CreateWorktreeDialog
		*/
		/**
		* The create-worktree-and-start-session dialog.
		* @param props - see {@link CreateWorktreeDialogProps}.
		*/
		function CreateWorktreeDialog({ branches, currentBranch, onCreate, onClose, t }) {
			const [name, setName] = (0, react.useState)("");
			const [baseRef, setBaseRef] = (0, react.useState)(currentBranch);
			const [pending, setPending] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)(null);
			const sanitized = sanitizeWorktreeName(name);
			const submit = () => {
				if (pending) return;
				if (sanitized === null) {
					setError(t("error.invalidWorktreeName"));
					return;
				}
				setPending(true);
				setError(null);
				onCreate(sanitized, baseRef === "" ? void 0 : baseRef).then((result) => {
					if (result.ok) {
						onClose();
						return;
					}
					setError(errorMessage(result.error, t));
				}).finally(() => {
					setPending(false);
				});
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Backdrop, { onClose }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: context_module_css_default.dialog,
				role: "dialog",
				"aria-label": t("worktree.dialog.title"),
				"data-gitgraph-worktree-dialog": true,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
						className: context_module_css_default.dialogTitle,
						children: t("worktree.dialog.title")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: context_module_css_default.dialogDescription,
						children: t("worktree.dialog.description")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: context_module_css_default.dialogField,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
							className: context_module_css_default.dialogLabel,
							htmlFor: "git-graph-worktree-name",
							children: t("worktree.dialog.nameLabel")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							id: "git-graph-worktree-name",
							className: context_module_css_default.dialogInput,
							value: name,
							onChange: (event) => {
								setName(event.target.value);
							},
							placeholder: t("worktree.dialog.namePlaceholder"),
							onKeyDown: (event) => {
								if (event.key === "Enter") submit();
							},
							autoFocus: true
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: context_module_css_default.dialogField,
						style: { marginTop: 10 },
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
							className: context_module_css_default.dialogLabel,
							htmlFor: "git-graph-worktree-base",
							children: t("worktree.dialog.baseLabel")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
							id: "git-graph-worktree-base",
							className: context_module_css_default.dialogInput,
							value: baseRef,
							onChange: (event) => {
								setBaseRef(event.target.value);
							},
							children: branches.map((branch) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: branch.name,
								children: branch.name
							}, branch.name))
						})]
					}),
					error !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: context_module_css_default.dialogError,
						children: error
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: context_module_css_default.dialogActions,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: context_module_css_default.dialogButton,
							onClick: onClose,
							children: t("worktree.dialog.cancel")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: context_module_css_default.dialogButtonPrimary,
							onClick: submit,
							disabled: pending || name.trim() === "",
							children: t("worktree.dialog.confirm")
						})]
					})
				]
			})] });
		}
		//#endregion
		//#region src/client/worktrees/WorktreeManager.tsx
		/**
		* The worktree manager dialog: every linked worktree of the repository with
		* its branch/head, plus removal of managed worktrees. Dirty worktrees reject
		* once and surface an inline force-confirm; the wt/ branch survives removal
		* unless the row's delete-branch checkbox is on. The primary checkout row is
		* display-only.
		* @module dsh-git-graph/client/worktrees/WorktreeManager
		*/
		/**
		* The worktree manager dialog.
		* @param props - see {@link WorktreeManagerProps}.
		*/
		function WorktreeManager({ fetchWorktrees, onRemove, onClose, t }) {
			const [view, setView] = (0, react.useState)(null);
			const [loading, setLoading] = (0, react.useState)(true);
			const [error, setError] = (0, react.useState)(null);
			/** Row awaiting an inline force-confirm after a worktree-dirty rejection. */
			const [forcePath, setForcePath] = (0, react.useState)(null);
			/** Rows whose wt/ branch should be deleted together with the worktree. */
			const [branchDelete, setBranchDelete] = (0, react.useState)(/* @__PURE__ */ new Set());
			const [pending, setPending] = (0, react.useState)(null);
			const reload = (0, react.useCallback)(() => {
				let live = true;
				setLoading(true);
				fetchWorktrees().then((fresh) => {
					if (!live) return;
					setView(fresh);
					setLoading(false);
				});
				return () => {
					live = false;
				};
			}, [fetchWorktrees]);
			(0, react.useEffect)(() => reload(), [reload]);
			const remove = (item, force) => {
				if (pending !== null) return;
				setPending(item.path);
				setError(null);
				onRemove(item.path, {
					force,
					deleteBranch: branchDelete.has(item.path)
				}).then((result) => {
					if (result.ok) {
						setForcePath(null);
						reload();
						return;
					}
					if (result.error.code === "worktree-dirty" && !force) {
						setForcePath(item.path);
						return;
					}
					setError(errorMessage(result.error, t));
				}).finally(() => {
					setPending(null);
				});
			};
			const toggleBranchDelete = (path) => {
				setBranchDelete((previous) => {
					const next = new Set(previous);
					if (next.has(path)) next.delete(path);
					else next.add(path);
					return next;
				});
			};
			const rows = view?.worktrees ?? [];
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Backdrop, { onClose }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: context_module_css_default.dialog,
				role: "dialog",
				"aria-label": t("worktree.manager.title"),
				"data-gitgraph-worktree-manager": true,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
						className: context_module_css_default.dialogTitle,
						children: t("worktree.manager.title")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: context_module_css_default.managerList,
						children: [
							loading && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: context_module_css_default.graphEmpty,
								children: t("worktree.manager.loading")
							}),
							!loading && rows.length <= 1 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: context_module_css_default.graphEmpty,
								children: t("worktree.manager.empty")
							}),
							!loading && rows.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: context_module_css_default.managerRow,
								"data-main": item.main || void 0,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: context_module_css_default.managerInfo,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: context_module_css_default.managerHeadline,
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconBranchOutlineRegular, { size: 13 }),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: context_module_css_default.managerBranch,
													children: item.branch === "" ? t("worktree.manager.detached") : item.branch
												}),
												item.main && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: context_module_css_default.managerBadge,
													children: t("worktree.manager.main")
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: context_module_css_default.managerOid,
													children: item.head.slice(0, 7)
												})
											]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: context_module_css_default.managerPath,
											title: item.path,
											children: item.path
										}),
										forcePath === item.path && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: context_module_css_default.managerConfirm,
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("worktree.manager.forceConfirm") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: context_module_css_default.dialogButton,
												disabled: pending !== null,
												onClick: () => {
													remove(item, true);
												},
												children: t("worktree.manager.forceYes")
											})]
										})
									]
								}), !item.main && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: context_module_css_default.managerActions,
									children: [item.branch.startsWith("wt/") && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
										className: context_module_css_default.managerCheck,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											type: "checkbox",
											checked: branchDelete.has(item.path),
											onChange: () => {
												toggleBranchDelete(item.path);
											}
										}), t("worktree.manager.deleteBranch")]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: context_module_css_default.dialogButton,
										disabled: pending !== null,
										onClick: () => {
											remove(item, false);
										},
										children: t("worktree.manager.remove")
									})]
								})]
							}, item.path))
						]
					}),
					error !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: context_module_css_default.dialogError,
						children: error
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: context_module_css_default.dialogActions,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: cx(context_module_css_default.dialogButton),
							onClick: onClose,
							children: t("worktree.manager.close")
						})
					})
				]
			})] });
		}
		//#endregion
		//#region src/core/types.ts
		/**
		* Minimal lane assignment over topo-ordered rows: each lane waits for one
		* commit; the first parent continues the node's lane, further parents start
		* (or join) lanes to the right. Correct for linear, branched, and merged
		* histories; the columns alone carry the topology (the renderer draws them
		* as monospace lane text).
		* @param rows - topo-ordered rows with parents (later rows = ancestors).
		* @returns per-row lane maps.
		*/
		function computeLanes(rows) {
			const later = /* @__PURE__ */ new Set();
			for (const row of rows) for (const parent of row.parents) later.add(parent);
			const lanes = [];
			const result = [];
			for (const row of rows) {
				let nodeColumn = lanes.findIndex((pending) => pending === row.oid);
				if (nodeColumn === -1) {
					lanes.push(row.oid);
					nodeColumn = lanes.length - 1;
				}
				const columns = [];
				for (let i = 0; i < lanes.length; i += 1) {
					const pending = lanes[i];
					if (pending === null) columns.push("gap");
					else if (i === nodeColumn) columns.push(row.parents.length > 1 ? "merge" : "node");
					else if (pending === row.oid) columns.push("gap");
					else if (typeof pending === "string" && later.has(pending)) columns.push("pass");
					else columns.push("gap");
				}
				const [first, ...rest] = row.parents.filter((parent) => later.has(parent));
				for (let i = 0; i < lanes.length; i += 1) if (lanes[i] === row.oid && i !== nodeColumn) lanes[i] = null;
				lanes[nodeColumn] = first ?? null;
				for (const parent of rest) if (!lanes.includes(parent)) lanes.push(parent);
				while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();
				result.push({
					columns,
					nodeColumn,
					merge: row.parents.length > 1
				});
			}
			return result;
		}
		//#endregion
		//#region src/client/graph/GraphDialog.tsx
		/**
		* The Git graph panel: a read-only commit list with lane topology, ref
		* labels, and paging (git log --branches --tags --remotes --topo-order).
		* @module dsh-git-graph/client/graph/GraphDialog
		*/
		/** Initial page size of the graph fetch. */
		const INITIAL_LIMIT = 200;
		/** Page size of one "load more" step. */
		const PAGE_STEP = 100;
		/** Lane glyph → the rendered monospace character. */
		function glyphChar(glyph) {
			switch (glyph) {
				case "node": return "●";
				case "merge": return "◆";
				case "pass": return "│";
				case "gap": return " ";
			}
		}
		/** Seconds per time bucket (relative timestamps). */
		const MINUTE = 60;
		const HOUR = 60 * MINUTE;
		const DAY = 24 * HOUR;
		/**
		* A compact relative timestamp (GitHub-style): "just now", "5 分钟前",
		* falling back to a plain date past 30 days.
		* @param epochSeconds - commit author time in seconds.
		* @param t - the dictionary.
		* @returns the display string.
		*/
		function formatTime(epochSeconds, t) {
			const elapsed = Math.max(0, Math.floor(Date.now() / 1e3) - epochSeconds);
			if (elapsed < MINUTE) return t("graph.time.justNow");
			if (elapsed < HOUR) return t("graph.time.minutesAgo", { count: Math.floor(elapsed / MINUTE) });
			if (elapsed < DAY) return t("graph.time.hoursAgo", { count: Math.floor(elapsed / HOUR) });
			if (elapsed < 30 * DAY) return t("graph.time.daysAgo", { count: Math.floor(elapsed / DAY) });
			const date = /* @__PURE__ */ new Date(epochSeconds * 1e3);
			const pad = (n) => String(n).padStart(2, "0");
			return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
		}
		/**
		* The Git graph panel.
		* @param props - see {@link GraphDialogProps}.
		*/
		function GraphDialog({ graph, onClose, t }) {
			const [view, setView] = (0, react.useState)(null);
			const [error, setError] = (0, react.useState)(null);
			const [loading, setLoading] = (0, react.useState)(true);
			const requestSeq = (0, react.useRef)(0);
			const load = (0, react.useCallback)((limit) => {
				const seq = requestSeq.current + 1;
				requestSeq.current = seq;
				setLoading(true);
				graph(limit).then((next) => {
					if (seq !== requestSeq.current) return;
					setView(next);
					setError(next === null ? t("error.internal") : null);
				}).catch(() => {
					if (seq !== requestSeq.current) return;
					setError(t("error.internal"));
				}).finally(() => {
					if (seq === requestSeq.current) setLoading(false);
				});
			}, [graph, t]);
			const loadRef = (0, react.useRef)(load);
			loadRef.current = load;
			(0, react.useEffect)(() => {
				loadRef.current(INITIAL_LIMIT);
			}, []);
			const lanes = (0, react.useMemo)(() => {
				if (view === null) return [];
				return computeLanes(view.commits);
			}, [view]);
			const laneCount = (0, react.useMemo)(() => {
				let count = 0;
				for (const row of lanes) count = Math.max(count, row.columns.length);
				return count;
			}, [lanes]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Backdrop, { onClose }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: context_module_css_default.dialog,
				role: "dialog",
				"aria-label": t("graph.title"),
				"data-gitgraph-dialog": true,
				"data-dsh-plugin": "git-graph",
				"data-dsh-part": "dialog",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: context_module_css_default.dialogHeader,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: context_module_css_default.dialogHeading,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
								className: context_module_css_default.dialogTitle,
								children: t("graph.title")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: context_module_css_default.graphSubtitle,
								children: t("graph.subtitle", {
									count: view === null ? 0 : view.commits.length,
									lanes: laneCount
								})
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: context_module_css_default.dialogClose,
							onClick: onClose,
							"aria-label": t("graph.close"),
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCloseOutlineRegular, { size: 16 })
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: context_module_css_default.graphBody,
						children: loading && view === null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: context_module_css_default.graphEmpty,
							children: t("graph.loading")
						}) : error !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: context_module_css_default.graphEmpty,
							children: error
						}) : view === null || view.commits.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: context_module_css_default.graphEmpty,
							children: t("graph.empty")
						}) : view.commits.map((commit, index) => {
							const row = lanes[index];
							if (row === void 0) return null;
							return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: context_module_css_default.graphRow,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: context_module_css_default.graphLanes,
										"aria-hidden": "true",
										"data-gitgraph-lanes": true,
										children: row.columns.map((glyph, column) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											"data-gitgraph-glyph": glyph,
											className: cx(context_module_css_default.graphLaneCell, glyph === "node" && context_module_css_default.graphLaneNode, glyph === "merge" && context_module_css_default.graphLaneMerge, glyph === "pass" && context_module_css_default.graphLanePass),
											children: glyphChar(glyph)
										}, column))
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: context_module_css_default.graphOid,
										title: commit.oid,
										children: commit.oid.slice(0, 7)
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: context_module_css_default.graphMain,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: context_module_css_default.graphSubject,
											title: commit.subject,
											children: commit.subject
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: context_module_css_default.graphMeta,
											children: [
												commit.refs.map((ref) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													title: ref,
													"data-gitgraph-ref": true,
													"data-gitgraph-ref-current": ref === view.branch || void 0,
													className: cx(context_module_css_default.graphRef, ref === view.branch && context_module_css_default.graphRefCurrent),
													children: ref
												}, ref)),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: commit.author }),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: context_module_css_default.graphMetaSep,
													children: "·"
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: formatTime(commit.authorTime, t) })
											]
										})]
									})
								]
							}, commit.oid);
						})
					}),
					view !== null && view.hasMore && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: context_module_css_default.graphMore,
						onClick: () => {
							load(view.commits.length + PAGE_STEP);
						},
						children: t("graph.loadMore")
					})
				]
			})] });
		}
		const SKIN_CENTER_BODY_ATTR = "data-dsh-skin-center";
		const DARK_THEME_BODY_ATTR = "data-ds-dark-theme";
		const DSH_BODY_ATTR_PREFIX = "data-dsh-";
		/** Whether a body attribute belongs to an applied skin rather than the skin center shell. */
		function hasAppliedSkinBodyAttr(name) {
			return name.startsWith(DSH_BODY_ATTR_PREFIX) && name !== SKIN_CENTER_BODY_ATTR;
		}
		/** Whether the page is using the unskinned stock light theme. */
		function readStockLightTheme() {
			if (typeof document === "undefined") return false;
			const body = document.body;
			if (!body.hasAttribute(SKIN_CENTER_BODY_ATTR) || body.hasAttribute(DARK_THEME_BODY_ATTR)) return false;
			return !body.getAttributeNames().some(hasAppliedSkinBodyAttr);
		}
		/** Track stock-light theme changes from body attributes. */
		function useStockLightTheme() {
			const [stockLightTheme, setStockLightTheme] = (0, react.useState)(readStockLightTheme);
			(0, react.useEffect)(() => {
				const update = () => {
					setStockLightTheme(readStockLightTheme());
				};
				update();
				if (typeof document === "undefined" || typeof MutationObserver !== "function") return void 0;
				const observer = new MutationObserver(update);
				observer.observe(document.body, { attributes: true });
				return () => {
					observer.disconnect();
				};
			}, []);
			return stockLightTheme;
		}
		function isConnectedElement(node) {
			return node instanceof HTMLElement && node.isConnected;
		}
		/**
		* Resolve the hero workspace row element that the branch chip should join
		* during the blank-session hero phase.
		*/
		function findHeroRow(anchor) {
			if (anchor === null || !anchor.isConnected) return null;
			const outlet = anchor.parentElement;
			if (outlet === null) return null;
			const prev = outlet.previousElementSibling;
			if (prev !== null && isConnectedElement(prev) && prev.className.includes("heroWorkspaceRow")) return prev;
			const rowInStack = outlet.closest("[class*=\"composerStack\"], [class*=\"composerHero\"]")?.querySelector("[class*=\"heroWorkspaceRow\"]");
			if (rowInStack !== null && isConnectedElement(rowInStack)) return rowInStack;
			if (typeof document !== "undefined") {
				const docRow = document.querySelector("[class*=\"heroWorkspaceRow\"]");
				if (docRow !== null && isConnectedElement(docRow)) return docRow;
			}
			return null;
		}
		/**
		* Resolve the hero row's trailing options group. That group carries
		* `margin-left: auto`, so every later sibling is pushed to the row's right
		* edge: a chip appended after it would sit above the composer card's top-right
		* corner instead of beside the agent-preset seat.
		*/
		function findHeroTrailingGroup(row) {
			for (const child of Array.from(row.children)) {
				if (!(child instanceof HTMLElement)) continue;
				if ((child.getAttribute("class") ?? "").includes("heroOptions")) return child;
			}
			return null;
		}
		/**
		* The git branch selector chip for blank sessions.
		* @param props - the composed entry props of whichever seat it mounted in.
		*/
		function BranchChip(props) {
			const sessionId = props.sessionId;
			const blankSession = props.useSessions((state) => {
				if (sessionId === void 0) return false;
				return state.byId?.[sessionId]?.blank === true;
			});
			const sessionSnapshot = props.session;
			const heroSeat = sessionSnapshot?.blank === true && (sessionSnapshot.openState === "open" || blankSession === true);
			const stockLightTheme = useStockLightTheme();
			/** Repository state: undefined = loading, null = not a repository, else the snapshot. */
			const [repo, setRepo] = (0, react.useState)(void 0);
			/** Fresh branch list, fetched when the branch popover opens. */
			const [branchesView, setBranchesView] = (0, react.useState)(null);
			const [branchOpen, setBranchOpen] = (0, react.useState)(false);
			const [createOpen, setCreateOpen] = (0, react.useState)(false);
			const [graphOpen, setGraphOpen] = (0, react.useState)(false);
			const [worktreeCreateOpen, setWorktreeCreateOpen] = (0, react.useState)(false);
			const [worktreeManageOpen, setWorktreeManageOpen] = (0, react.useState)(false);
			const [heroRow, setHeroRow] = (0, react.useState)(null);
			const anchorRef = (0, react.useRef)(null);
			const chipRef = (0, react.useRef)(null);
			(0, react.useLayoutEffect)(() => {
				if (!heroSeat || repo === void 0 || repo === null) {
					setHeroRow(null);
					return;
				}
				const update = () => {
					const found = findHeroRow(anchorRef.current);
					setHeroRow((prev) => prev === found ? prev : found);
				};
				update();
				const parent = anchorRef.current?.parentElement;
				if (parent === null || parent === void 0 || typeof MutationObserver === "undefined") return void 0;
				const observer = new MutationObserver(update);
				observer.observe(parent.parentElement ?? parent, {
					childList: true,
					subtree: true
				});
				return () => {
					observer.disconnect();
				};
			}, [heroSeat, repo !== void 0 && repo !== null]);
			(0, react.useLayoutEffect)(() => {
				if (!heroSeat || heroRow === null) return void 0;
				const place = () => {
					const anchor = chipRef.current;
					if (anchor === null || anchor.parentElement !== heroRow) return;
					const trailing = findHeroTrailingGroup(heroRow);
					if (trailing === null || anchor.nextElementSibling === trailing) return;
					heroRow.insertBefore(anchor, trailing);
				};
				place();
				if (typeof MutationObserver === "undefined") return void 0;
				const observer = new MutationObserver(place);
				observer.observe(heroRow, { childList: true });
				return () => {
					observer.disconnect();
				};
			}, [
				heroSeat,
				heroRow,
				repo
			]);
			const refetch = (0, react.useCallback)(() => {
				let live = true;
				props.repoStatus(sessionId).then((status) => {
					if (live) setRepo(status);
				}).catch(() => {
					if (live) setRepo(null);
				});
				return () => {
					live = false;
				};
			}, [props.repoStatus, sessionId]);
			const lastFocusRefetch = (0, react.useRef)(0);
			(0, react.useEffect)(() => {
				if (!heroSeat) return void 0;
				return refetch();
			}, [heroSeat, refetch]);
			(0, react.useEffect)(() => {
				if (!heroSeat) return void 0;
				const unsubscribe = props.subscribeChanges(sessionId, () => {
					refetch();
				});
				const onFocus = () => {
					const now = Date.now();
					if (now - lastFocusRefetch.current < 5e3) return;
					lastFocusRefetch.current = now;
					refetch();
				};
				window.addEventListener("focus", onFocus);
				return () => {
					unsubscribe();
					window.removeEventListener("focus", onFocus);
				};
			}, [
				heroSeat,
				props.subscribeChanges,
				sessionId,
				refetch
			]);
			const closeCreate = () => {
				setCreateOpen(false);
				refetch();
			};
			(0, react.useEffect)(() => {
				if (!heroSeat || !branchOpen) return void 0;
				let live = true;
				setBranchesView(null);
				props.branches(sessionId).then((view) => {
					if (live) setBranchesView(view);
				});
				return () => {
					live = false;
				};
			}, [
				heroSeat,
				branchOpen,
				props.branches,
				sessionId
			]);
			if (!heroSeat || repo === void 0 || repo === null) return null;
			const openBranchPopover = () => {
				setBranchOpen((open) => !open);
			};
			const chipNode = /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				ref: chipRef,
				"data-gitgraph-chip-anchor": true,
				"data-dsh-plugin": "git-graph",
				"data-dsh-part": "chip",
				"data-gitgraph-stock-light": stockLightTheme || void 0,
				className: cx(context_module_css_default.anchor, heroSeat && context_module_css_default.anchorHero),
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: context_module_css_default.chipWrap,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Chip, {
							hero: heroSeat,
							icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconBranchOutlineRegular, { size: 14 }),
							label: repo.branch === "" ? props.t("branch.detached") : repo.branch,
							ariaLabel: props.t("chip.aria.branch"),
							open: branchOpen,
							onClick: openBranchPopover
						}), branchOpen && branchesView !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(BranchPopover, {
							hero: heroSeat,
							view: branchesView,
							onSwitch: (branch) => props.switchBranch(sessionId, branch),
							onSwitched: refetch,
							onCreate: () => {
								setBranchOpen(false);
								setCreateOpen(true);
							},
							onGraph: () => {
								setBranchOpen(false);
								setGraphOpen(true);
							},
							onCreateWorktree: () => {
								setBranchOpen(false);
								setWorktreeCreateOpen(true);
							},
							onManageWorktrees: () => {
								setBranchOpen(false);
								setWorktreeManageOpen(true);
							},
							onClose: () => {
								setBranchOpen(false);
							},
							t: props.t
						})]
					}),
					createOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CreateBranchDialog, {
						onCreate: (name) => props.createBranch(sessionId, name),
						onClose: closeCreate,
						t: props.t
					}),
					graphOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(GraphDialog, {
						graph: (limit) => props.graph(sessionId, limit),
						onClose: () => {
							setGraphOpen(false);
						},
						t: props.t
					}),
					worktreeCreateOpen && branchesView !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CreateWorktreeDialog, {
						branches: branchesView.branches,
						currentBranch: branchesView.branch,
						onCreate: (name, baseRef) => props.createWorktreeSession(sessionId, name, baseRef),
						onClose: () => {
							setWorktreeCreateOpen(false);
							refetch();
						},
						t: props.t
					}),
					worktreeManageOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(WorktreeManager, {
						fetchWorktrees: () => props.worktrees(sessionId),
						onRemove: (worktreePath, opts) => props.removeWorktree(sessionId, worktreePath, opts),
						onClose: () => {
							setWorktreeManageOpen(false);
						},
						t: props.t
					})
				]
			});
			if (heroSeat) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				ref: anchorRef,
				style: { display: "none" }
			}), heroRow !== null && isConnectedElement(heroRow) ? (0, react_dom.createPortal)(chipNode, heroRow) : chipNode] });
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				ref: anchorRef,
				style: { display: "contents" },
				children: chipNode
			});
		}
		//#endregion
		//#region src/client/main-session.ts
		/**
		* Resolve the Session the main view currently shows.
		*
		* Reads the catalog's rows rather than a per-id retain-info source: ownership
		* counts ride the list snapshot, so this neither allocates observers nor opens
		* history, and a subscription to the list still fires when the selection moves.
		* @param byId - the session catalog's rows (`SessionListState.byId`), when available.
		* @returns the main-view session id, or undefined when the main view shows none.
		*/
		function mainViewSessionId(byId) {
			if (byId === void 0 || byId === null) return void 0;
			for (const row of Object.values(byId)) if (row !== void 0 && (row.retainedBy?.mainView ?? 0) > 0) return row.id;
		}
		//#endregion
		//#region src/client/auto-isolation.ts
		/** Log line prefix for every auto-isolation diagnostic. */
		const TAG = "[git-graph] auto-isolation";
		/**
		* Probe the two service shapes the wrapper needs: the navigation face that
		* owns `startSession` and the registry face that owns the workspace rows.
		* The wrapper only installs when every member it shadows or calls is a
		* function of the expected kind; a changed client-runtime surface leaves the
		* official behavior untouched.
		*
		* Both faces have been read from the live context rather than assumed:
		* 0.1.7's `workspaces` service is the registry (no `startSession`), and the
		* navigation service supplies `startSession` — reading only `workspaces`, as
		* this probe did before the split, disabled the feature on every 0.1.7 boot
		* and printed the shape warning on each page load (#1690).
		* @param navigation - the navigation service (`uiWorkspace`), or undefined.
		* @param registry - the registry service (`workspaces`), or undefined.
		* @returns the probed pair, or null when either face is unusable.
		*/
		function probeWorkspaces(navigation, registry) {
			if (typeof navigation !== "object" || navigation === null) return null;
			if (typeof registry !== "object" || registry === null) return null;
			const nav = navigation;
			const reg = registry;
			if (typeof nav.startSession !== "function") return null;
			if (typeof reg.create !== "function" || typeof reg.list?.getSnapshot !== "function") return null;
			return {
				navigation: nav,
				registry: reg
			};
		}
		/**
		* Install the startSession wrapper on the shared navigation service.
		* @param scope - client context carrying the navigation (`uiWorkspace`) and
		* registry (`workspaces`) faces plus the sessions list.
		* @param git - the /git/* client (config + worktree verbs).
		* @returns the disposer restoring the official method.
		*/
		function installAutoIsolation(scope, git) {
			const probe = probeWorkspaces(scope.uiWorkspace, scope.workspaces);
			if (probe === null) {
				console.warn(`${TAG} disabled: the uiWorkspace/workspaces service shape changed; using the official new-session behavior`);
				return () => {};
			}
			const { navigation, registry } = probe;
			let original;
			try {
				original = navigation.startSession;
			} catch {
				console.warn(`${TAG} disabled: startSession is not readable`);
				return () => {};
			}
			/**
			* The target resolution the official New Session uses (explicit > the
			* current session's workspace > the first registered workspace). The 0.1.7
			* `workspaces` snapshot carries no `recentWorkspaceId`; the first row is the
			* registry's own ordering, which the New Session default follows.
			*/
			const resolveTarget = (workspaceId) => {
				const snapshot = registry.list.getSnapshot();
				const current = mainViewSessionId(scope.sessions.list.getSnapshot().byId);
				const currentWorkspaceId = current === void 0 ? void 0 : snapshot.items.find((item) => item.sessionIds.includes(current))?.workspaceId;
				return workspaceId ?? currentWorkspaceId ?? snapshot.items[0]?.workspaceId;
			};
			/**
			* Targets with a routing flow already in flight. The new-session button
			* fires `startSession` on every click and nothing upstream debounces it, so
			* a fast double click would otherwise run two isolation flows and create two
			* worktrees; the second click is absorbed while the first is routing.
			*/
			const routing = /* @__PURE__ */ new Set();
			const routed = (workspaceId) => {
				const target = resolveTarget(workspaceId);
				if (target === void 0) {
					original.call(navigation);
					return;
				}
				if (routing.has(target)) return;
				routing.add(target);
				(async () => {
					const configResult = await git.config();
					if (!configResult.ok || !configResult.value.autoIsolate) {
						original.call(navigation, target);
						return;
					}
					const config = configResult.value;
					const item = registry.list.getSnapshot().items.find((entry) => entry.workspaceId === target);
					if (item === void 0) {
						original.call(navigation, target);
						return;
					}
					const home = config.worktreesHome;
					if (item.path.startsWith(home + "/") || item.path.startsWith(home + "\\")) {
						original.call(navigation, target);
						return;
					}
					const status = await git.status(item.path);
					if (!status.ok || status.value === null) {
						original.call(navigation, target);
						return;
					}
					const name = `s-${Date.now().toString(36)}`;
					const baseRef = config.autoBaseline === "default" ? "origin/HEAD" : void 0;
					const created = await git.addWorktree(item.path, name, baseRef);
					if (!created.ok) {
						console.warn(`${TAG} worktree creation failed; starting the session in the main checkout instead`, created.error);
						original.call(navigation, target);
						return;
					}
					let registeredId;
					try {
						const workspace = await registry.create({ path: created.value.path });
						registeredId = workspace.workspaceId;
						original.call(navigation, workspace.workspaceId);
					} catch (error) {
						if (registeredId !== void 0 && typeof registry.delete === "function") try {
							await registry.delete(registeredId);
						} catch (cleanupError) {
							console.warn(`${TAG} could not drop the failed workspace registration`, cleanupError);
						}
						await git.removeWorktree(item.path, created.value.path, { force: true });
						console.warn(`${TAG} workspace registration failed; rolled back the worktree`, error);
						original.call(navigation, target);
					}
				})().catch((error) => {
					console.warn(`${TAG} routing failed; using the official behavior`, error);
					original.call(navigation, target);
				}).finally(() => {
					routing.delete(target);
				});
			};
			try {
				navigation.startSession = routed;
			} catch {
				console.warn(`${TAG} disabled: startSession is not writable`);
				return () => {};
			}
			return () => {
				try {
					navigation.startSession = original;
				} catch {}
			};
		}
		//#endregion
		//#region src/client/locales.ts
		/** `git-graph` namespace dictionaries (branch selector + Git graph copy). */
		/** Simplified Chinese dictionary (the key-set source of truth). */
		const zh = {
			"sidebar.tabTitle": "仓库图谱",
			"sidebar.tabDescription": "工作区内的多级仓库、分支与提交图谱（只读）",
			"sidebar.repo": "仓库",
			"sidebar.branch": "当前分支",
			"sidebar.refresh": "刷新",
			"sidebar.scanning": "扫描中…",
			"sidebar.loading": "正在扫描工作区内的仓库…",
			"sidebar.noRepos": "此工作区下没有发现 Git 仓库",
			"sidebar.error.repos": "仓库列表加载失败",
			"sidebar.error.graph": "提交图谱加载失败",
			"sidebar.dirty": "{count} 个未提交修改",
			"sidebar.clean": "没有未提交修改",
			"sidebar.conflicts": "{count} 个冲突",
			"sidebar.operationInProgress": "有进行中的 Git 操作",
			"sidebar.repoAbove": "工作区位于该仓库的子目录",
			"sidebar.truncated": "仓库过多，仅显示前 {limit} 个",
			"sidebar.commitsLanes": "{count} 个提交 · {lanes} 条泳道",
			"sidebar.templateBuiltin": "内置",
			"sidebar.builtinGroup": "内置模板",
			"sidebar.builtinHint": "内置模板不可编辑或删除，只控制是否出现在选择列表",
			"sidebar.builtinShown": "显示中",
			"sidebar.builtinHidden": "已隐藏",
			"sidebar.builtinShow": "显示",
			"sidebar.builtinHide": "隐藏",
			"sidebar.settings": "设置",
			"sidebar.settingsTitle": "Git 规范模板",
			"sidebar.settingsHint": "这里管理「我的模板」：保存后会出现在选择框架的列表末尾，可以写进任意仓库的规范文档；内置的六套框架保持只读，不能在这里修改或删除。",
			"sidebar.templatesEmpty": "还没有自定义模板。点「新建模板」写一份。",
			"sidebar.templatesCount": "{count} 个自定义模板",
			"sidebar.templatesStore": "存放位置：{path}",
			"sidebar.templateNew": "新建模板",
			"sidebar.templateEdit": "编辑",
			"sidebar.templateDelete": "删除",
			"sidebar.templateDeleteConfirm": "确认删除",
			"sidebar.templateSave": "保存",
			"sidebar.templateCancel": "取消",
			"sidebar.templateSaving": "保存中…",
			"sidebar.templateSaved": "模板已保存。",
			"sidebar.templateDeleted": "模板已删除。已写进仓库的文档不受影响，但其中记录的 framework 值会变成悬空值。",
			"sidebar.templateError": "模板操作失败",
			"sidebar.templateId": "模板 ID",
			"sidebar.templateIdHint": "小写字母、数字和连字符，1–48 个字符；不能与内置模板或 none 重名。",
			"sidebar.templateName": "名称",
			"sidebar.templateNameZh": "中文名称（可选）",
			"sidebar.templateTagline": "一句话说明（可选）",
			"sidebar.templateTaglineZh": "中文说明（可选）",
			"sidebar.templateBestFor": "适合什么项目（可选）",
			"sidebar.templateBestForZh": "中文适用场景（可选）",
			"sidebar.templateUrl": "参考链接（可选，http/https）",
			"sidebar.templateBody": "模板正文（Markdown，≤64KB，必须含 status: 行）",
			"sidebar.templateEditorHint": "正文会强制写入 framework: <模板 ID> 与 status: 行；保存前用同一套规则自检。",
			"sidebar.templateBytes": "{count} 字节",
			"sidebar.templateCustom": "自定义",
			"sidebar.templateMine": "我的模板",
			"sidebar.templateManage": "管理模板",
			"sidebar.templateLoading": "读取中…",
			"sidebar.worktrees": "{count} 个 worktree",
			"sidebar.worktreeCurrent": "当前会话",
			"sidebar.worktreeUnregistered": "未注册为工作区，无法读取状态",
			"sidebar.worktreeMissing": "目录已不存在（可能被移动或删除）",
			"sidebar.worktreeError": "worktree 列表读取失败",
			"sidebar.worktreeOpenSession": "在新会话中打开",
			"sidebar.worktreeOpenWorkspace": "打开为工作区",
			"sidebar.worktreeCopyPath": "复制路径",
			"sidebar.worktreeJumpHint": "点击切换视图；按钮可在会话中打开",
			"sidebar.conventionsConflicts": "{count} 处规范冲突",
			"sidebar.consolidateAi": "AI 合并",
			"sidebar.consolidateAiNotice": "已把合并请求复制到剪贴板，粘贴到对话里发送即可（AI 会读文档、判断冲突与重复，再合并进 GIT_CONVENTIONS.md）。",
			"view.title": "仓库图谱",
			"sidebar.mainViewOpen": "在主区域打开",
			"sidebar.mainViewOn": "主区域已打开",
			"sidebar.mainViewClose": "关闭主区域视图",
			"sidebar.ai": "AI 署名",
			"sidebar.aiHint": "提交正文里的署名尾行，例如 Assisted-by: Claude Code。规范只决定它是否必须出现。",
			"sidebar.aiRequired": "必须注明",
			"sidebar.aiOptional": "可选",
			"sidebar.aiForbidden": "禁止注明",
			"sidebar.ruleAiRequired": "需要 AI 署名",
			"sidebar.ruleAiOptional": "AI 署名可选",
			"sidebar.ruleAiForbidden": "禁止 AI 署名",
			"sidebar.conflictsReview": "交给 AI 合并",
			"sidebar.refsClear": "清除筛选",
			"sidebar.refsMore": "展开其余引用",
			"sidebar.refsLess": "收起",
			"sidebar.conventionsClose": "关闭",
			"sidebar.ruleTypes": "type：{types}",
			"sidebar.ruleLength": "标题 ≤ {count} 字",
			"sidebar.ruleLowercase": "小写开头",
			"sidebar.rulePeriod": "不加句号",
			"sidebar.ruleMood": "祈使句",
			"sidebar.language": "提交语言",
			"sidebar.languageHint": "写进文档的 language: zh|en|mixed，主题语言不对会被标出来",
			"sidebar.langZh": "中文",
			"sidebar.langEn": "英文",
			"sidebar.langMixed": "中英混排",
			"sidebar.workspaceDocCopy": "复制路径",
			"sidebar.strict": "强约束",
			"sidebar.strictHint": "写进文档的 strict: true：不合规的提交必须先改写，再提交",
			"sidebar.compliance": "提交合规",
			"sidebar.complianceOff": "文档没有写明可机检的规则",
			"sidebar.previewTitle": "写入前的差异",
			"sidebar.previewAdded": "{count} 节新增",
			"sidebar.previewChanged": "{count} 节改写",
			"sidebar.previewRemoved": "{count} 节移除",
			"sidebar.previewSame": "{count} 节不变",
			"sidebar.previewNoChange": "内容一致，无需改写。",
			"sidebar.previewConfirm": "确认写入",
			"sidebar.previewCancel": "取消",
			"sidebar.previewBadgeAdded": "新增",
			"sidebar.previewBadgeChanged": "改写",
			"sidebar.previewBadgeRemoved": "移除",
			"sidebar.workspaceDoc": "工作区规范",
			"sidebar.workspaceDocCreate": "创建工作区规范",
			"sidebar.workspaceDocMissing": "这个工作区还没有总纲。写一份，子仓库没有自己的规范时会继承它。",
			"sidebar.workspaceDocExists": "子仓库没有自己的规范时继承这份总纲。",
			"sidebar.workspaceDocWritten": "工作区规范已写入。",
			"sidebar.conventionsSwitch": "更换框架",
			"sidebar.overview": "总览",
			"sidebar.overviewBack": "返回图谱",
			"sidebar.overviewHint": "按需要处理的程度排序：冲突、改动、落后上游的仓库在前。",
			"sidebar.overviewClean": "干净",
			"sidebar.overviewDirty": "{count} 个改动",
			"sidebar.overviewConflicts": "{count} 个冲突",
			"sidebar.overviewAhead": "领先 {count}",
			"sidebar.overviewBehind": "落后 {count}",
			"sidebar.overviewUpstream": "无上游",
			"sidebar.overviewDetached": "分离头指针",
			"sidebar.overviewNow": "刚刚",
			"sidebar.overviewMinutes": "{count} 分钟前",
			"sidebar.overviewHours": "{count} 小时前",
			"sidebar.overviewDays": "{count} 天前",
			"sidebar.overviewDetail": "分支与体检",
			"sidebar.overviewMerged": "已合并",
			"sidebar.overviewUnmerged": "{count} 个未合并",
			"sidebar.overviewMeta": "{branches} 个分支 · stash {stash} · 对象 {size}",
			"sidebar.overviewBase": "基线 {name}",
			"sidebar.overviewFailed": "读取失败",
			"sidebar.overviewEmpty": "这个工作区还没有仓库。",
			"sidebar.exportGraph": "导出图片",
			"sidebar.exported": "已导出",
			"sidebar.exportCopied": "已复制 SVG",
			"sidebar.exportNote": "由 dsh-git-graph-sidebar 导出",
			"sidebar.search": "搜索提交（主题 / 作者 / SHA / 引用）",
			"sidebar.refFilter": "点击切换该引用的提交",
			"sidebar.filtered": "{shown} / {total} 条匹配",
			"sidebar.noMatch": "没有匹配的提交",
			"sidebar.copyRollback": "复制回滚提示",
			"sidebar.rollbackIntro": "请把我的仓库回滚到某个提交（只描述，不要直接执行）。",
			"sidebar.rollbackAfter": "该提交之后，当前视图里还有 {count} 个提交。",
			"sidebar.rollbackOptions": "候选做法",
			"sidebar.rollbackSafe": "安全，保留历史，适合已推送的分支",
			"sidebar.rollbackHard": "丢弃该提交之后的提交，已推送的分支慎用",
			"sidebar.rollbackPick": "只把这一条提交搬到别的分支",
			"sidebar.rollbackConfirm": "请先确认用哪一种，并说明会丢失哪些提交。",
			"sidebar.initRepo": "初始化 Git 仓库",
			"sidebar.initRepoHint": "这个文件夹还不是 Git 仓库。可以直接在这里初始化，工作区里的其它仓库不受影响。",
			"sidebar.initBranch": "初始分支",
			"sidebar.initConfirm": "初始化",
			"sidebar.initCancel": "取消",
			"sidebar.initRunning": "正在初始化…",
			"sidebar.initAfter": "初始化后会自动建立 Git 规范文档，并提示选择框架。",
			"sidebar.error.init": "初始化 Git 仓库失败",
			"sidebar.conventions": "Git 规范",
			"sidebar.conventionsNone": "未建立",
			"sidebar.conventionsDraft": "草稿",
			"sidebar.conventionsSettled": "已定稿",
			"sidebar.conventionsMissing": "这个仓库还没有 Git 规范。建议先定下提交与分支约定，再继续提交。",
			"sidebar.conventionsSetup": "建立规范",
			"sidebar.conventionsPick": "选一套经过验证的框架，或先建立空文档由团队填写。",
			"sidebar.conventionsScaffold": "只建空文档",
			"sidebar.conventionsCancel": "取消",
			"sidebar.conventionsOpen": "查看文档",
			"sidebar.conventionsAuto": "已为空仓库建立规范文档，请选择一套框架定稿。",
			"sidebar.conventionsApplied": "规范文档已写入。",
			"sidebar.conventionsWriting": "写入中…",
			"sidebar.conventionsBestFor": "适合：",
			"sidebar.error.conventions": "读取或写入 Git 规范失败",
			"sidebar.close": "关闭",
			"sidebar.copyInfo": "复制提交信息",
			"sidebar.copySha": "复制 SHA",
			"sidebar.copied": "已复制",
			"sidebar.author": "作者",
			"sidebar.committedAt": "提交时间",
			"sidebar.references": "引用",
			"sidebar.commit": "提交",
			"sidebar.subject": "主题",
			"sidebar.detailHint": "点击任一提交查看详情",
			"sidebar.repoPath": "仓库",
			"sidebar.parentsLabel": "父提交",
			"sidebar.repos": "{count} 个仓库",
			"sidebar.expand": "展开仓库树",
			"sidebar.collapse": "收起仓库树",
			"sidebar.workspaceRoot": "工作区根",
			"sidebar.zoomIn": "放大图谱",
			"sidebar.zoomOut": "缩小图谱",
			"sidebar.detail": "提交详情",
			"sidebar.parents": "{count} 个父提交",
			"branch.search": "搜索分支",
			"branch.empty": "未找到匹配分支",
			"branch.detached": "分离 HEAD",
			"branch.dirty": "未提交的更改：{count} 个文件",
			"branch.create": "创建并检出新分支…",
			"branch.graph": "Git 图谱",
			"branch.createDialog.title": "创建并检出新分支",
			"branch.createDialog.description": "基于当前 HEAD 创建一个新的本地分支，并在创建成功后立即切换过去。",
			"branch.createDialog.nameLabel": "分支名",
			"branch.createDialog.placeholder": "例如 feature/git-branch-switcher",
			"branch.createDialog.confirm": "创建并切换",
			"branch.createDialog.cancel": "取消",
			"graph.title": "Git 图谱",
			"graph.subtitle": "{count} 个提交，{lanes} 条泳道",
			"graph.loading": "加载中…",
			"graph.loadMore": "加载更多",
			"graph.close": "关闭",
			"graph.empty": "没有提交记录",
			"graph.time.justNow": "刚刚",
			"graph.time.minutesAgo": "{count} 分钟前",
			"graph.time.hoursAgo": "{count} 小时前",
			"graph.time.daysAgo": "{count} 天前",
			"error.conflictsPresent": "当前仓库还有未解决的冲突，先处理完再切换分支。",
			"error.operationInProgress": "当前仓库还有进行中的 Git 操作，完成后再切换分支。",
			"error.branchInOtherWorktree": "目标分支已在其他 worktree 中被检出，当前工作区无法直接切换。",
			"error.trackedOverwrite": "切换失败，以下已跟踪文件的修改会被目标分支覆盖：{paths}。",
			"error.untrackedOverwrite": "切换失败，以下未跟踪文件会被目标分支覆盖：{paths}。",
			"error.moreFiles": "等另外 {count} 个文件",
			"error.pathsSeparator": "、",
			"error.targetBranchNotFound": "目标分支不存在于本地仓库。",
			"error.invalidBranchName": "分支名无效，请重新输入。",
			"error.branchAlreadyExists": "分支已存在，请换一个名称。",
			"error.workspaceUnknown": "当前目录不是已注册的工作区。",
			"error.internal": "操作失败，请稍后重试。",
			"error.requestFailed": "分支操作失败：{error}",
			"toast.switchSuccess": "已切换到分支 {branchName}",
			"chip.aria.branch": "分支",
			"worktree.create": "在 worktree 中开始新会话…",
			"worktree.manage": "管理 worktree…",
			"worktree.dialog.title": "在 worktree 中开始新会话",
			"worktree.dialog.description": "在 DSH 托管目录（$DSH_HOME/worktrees/）创建隔离 worktree，携带新分支 wt/<名称>，并在其中打开新会话。当前检出不受影响。",
			"worktree.dialog.nameLabel": "worktree 名称",
			"worktree.dialog.namePlaceholder": "例如 fix-login-race",
			"worktree.dialog.baseLabel": "基线分支",
			"worktree.dialog.confirm": "创建并开始会话",
			"worktree.dialog.cancel": "取消",
			"worktree.manager.title": "Worktree 管理",
			"worktree.manager.loading": "加载中…",
			"worktree.manager.empty": "没有托管的 worktree",
			"worktree.manager.main": "主检出",
			"worktree.manager.detached": "分离 HEAD",
			"worktree.manager.remove": "删除",
			"worktree.manager.forceConfirm": "该 worktree 有未提交更改，确认强制删除？",
			"worktree.manager.forceYes": "强制删除",
			"worktree.manager.deleteBranch": "同时删除分支",
			"worktree.manager.close": "关闭",
			"toast.worktreeCreated": "已创建 worktree {name}",
			"error.invalidWorktreeName": "worktree 名称无效，请重新输入。",
			"error.worktreeAlreadyExists": "同名 worktree 或分支已存在，请换一个名称。",
			"error.worktreeDirty": "该 worktree 有未提交的更改。",
			"error.worktreeNotFound": "找不到该 worktree（可能已被删除）。",
			"error.worktreeIsMain": "主检出不能删除。",
			"error.baseRefNotFound": "基线分支或修订不存在。"
		};
		/** English dictionary, checked complete against the zh key set. */
		const en = {
			"sidebar.tabTitle": "Repository graph",
			"sidebar.tabDescription": "Multi-repository branches and commit graph inside this workspace (read-only)",
			"sidebar.repo": "Repository",
			"sidebar.branch": "Current branch",
			"sidebar.refresh": "Refresh",
			"sidebar.scanning": "Scanning…",
			"sidebar.loading": "Scanning the workspace for repositories…",
			"sidebar.noRepos": "No git repository found under this workspace",
			"sidebar.error.repos": "Failed to load the repository list",
			"sidebar.error.graph": "Failed to load the commit graph",
			"sidebar.dirty": "{count} pending changes",
			"sidebar.clean": "No pending changes",
			"sidebar.conflicts": "{count} conflicts",
			"sidebar.operationInProgress": "A git operation is in progress",
			"sidebar.repoAbove": "This workspace is a subdirectory of the repository",
			"sidebar.truncated": "Too many repositories; showing the first {limit}",
			"sidebar.commitsLanes": "{count} commits · {lanes} lanes",
			"sidebar.templateBuiltin": "Built-in",
			"sidebar.builtinGroup": "Built-in templates",
			"sidebar.builtinHint": "Built-ins cannot be edited or deleted; the switch only controls whether they appear in the picker.",
			"sidebar.builtinShown": "Shown",
			"sidebar.builtinHidden": "Hidden",
			"sidebar.builtinShow": "Show",
			"sidebar.builtinHide": "Hide",
			"sidebar.settings": "Settings",
			"sidebar.settingsTitle": "Git convention templates",
			"sidebar.settingsHint": "Manage your own templates here: a saved template appears at the end of the framework picker and can be written into any repository's convention document. The six built-in frameworks stay read-only.",
			"sidebar.templatesEmpty": "No templates yet. Press New template to write one.",
			"sidebar.templatesCount": "{count} templates",
			"sidebar.templatesStore": "Stored at {path}",
			"sidebar.templateNew": "New template",
			"sidebar.templateEdit": "Edit",
			"sidebar.templateDelete": "Delete",
			"sidebar.templateDeleteConfirm": "Confirm delete",
			"sidebar.templateSave": "Save",
			"sidebar.templateCancel": "Cancel",
			"sidebar.templateSaving": "Saving…",
			"sidebar.templateSaved": "Template saved.",
			"sidebar.templateDeleted": "Template deleted. Documents already written are untouched, but their framework value becomes dangling.",
			"sidebar.templateError": "Template operation failed",
			"sidebar.templateId": "Template ID",
			"sidebar.templateIdHint": "Lowercase letters, digits and hyphens, 1-48 characters; must not reuse a built-in id or none.",
			"sidebar.templateName": "Name",
			"sidebar.templateNameZh": "Chinese name (optional)",
			"sidebar.templateTagline": "Tagline (optional)",
			"sidebar.templateTaglineZh": "Chinese tagline (optional)",
			"sidebar.templateBestFor": "Best for (optional)",
			"sidebar.templateBestForZh": "Chinese best-for (optional)",
			"sidebar.templateUrl": "Reference URL (optional, http/https)",
			"sidebar.templateBody": "Template body (Markdown, at most 64KB, must contain a status: line)",
			"sidebar.templateEditorHint": "The body gets framework: <template id> and a status: line enforced on save, and is checked against the same rules first.",
			"sidebar.templateBytes": "{count} bytes",
			"sidebar.templateCustom": "Custom",
			"sidebar.templateMine": "My templates",
			"sidebar.templateManage": "Manage templates",
			"sidebar.templateLoading": "Loading…",
			"sidebar.worktrees": "{count} worktrees",
			"sidebar.worktreeCurrent": "this session",
			"sidebar.worktreeUnregistered": "Not a registered workspace — status unavailable",
			"sidebar.worktreeMissing": "Directory is gone (moved or removed)",
			"sidebar.worktreeError": "Could not read the worktree list",
			"sidebar.worktreeOpenSession": "Open in a new session",
			"sidebar.worktreeOpenWorkspace": "Open as workspace",
			"sidebar.worktreeCopyPath": "Copy path",
			"sidebar.worktreeJumpHint": "Click to switch the view; the button opens it in a session",
			"sidebar.conventionsConflicts": "{count} convention conflicts",
			"sidebar.consolidateAi": "Merge with AI",
			"sidebar.consolidateAiNotice": "The merge request is on your clipboard: paste it into the conversation, and the agent reads every document, judges the duplicates and merges them into GIT_CONVENTIONS.md.",
			"view.title": "Repository graph",
			"sidebar.mainViewOpen": "Open in the main view",
			"sidebar.mainViewOn": "Shown in the main view",
			"sidebar.mainViewClose": "Close the main view",
			"sidebar.ai": "AI attribution",
			"sidebar.aiHint": "A trailer line in the message body, such as Assisted-by: Claude Code. The document only decides whether it must be there.",
			"sidebar.aiRequired": "required",
			"sidebar.aiOptional": "optional",
			"sidebar.aiForbidden": "forbidden",
			"sidebar.ruleAiRequired": "AI attribution required",
			"sidebar.ruleAiOptional": "AI attribution optional",
			"sidebar.ruleAiForbidden": "AI attribution forbidden",
			"sidebar.conflictsReview": "Merge with AI",
			"sidebar.refsClear": "Clear filters",
			"sidebar.refsMore": "Show every ref",
			"sidebar.refsLess": "Fewer",
			"sidebar.conventionsClose": "Close",
			"sidebar.ruleTypes": "type: {types}",
			"sidebar.ruleLength": "subject ≤ {count}",
			"sidebar.ruleLowercase": "lowercase start",
			"sidebar.rulePeriod": "no trailing period",
			"sidebar.ruleMood": "imperative",
			"sidebar.language": "Subject language",
			"sidebar.languageHint": "Writes language: zh|en|mixed into the document, so a subject in the other language is flagged",
			"sidebar.langZh": "Chinese",
			"sidebar.langEn": "English",
			"sidebar.langMixed": "Chinese + English",
			"sidebar.workspaceDocCopy": "Copy path",
			"sidebar.strict": "Strict",
			"sidebar.strictHint": "Writes strict: true into the document: a message that breaks the rules must be rewritten before it is committed",
			"sidebar.compliance": "Commit compliance",
			"sidebar.complianceOff": "The document states no checkable rule",
			"sidebar.previewTitle": "What would change",
			"sidebar.previewAdded": "{count} sections added",
			"sidebar.previewChanged": "{count} sections rewritten",
			"sidebar.previewRemoved": "{count} sections removed",
			"sidebar.previewSame": "{count} sections unchanged",
			"sidebar.previewNoChange": "Identical - nothing to rewrite.",
			"sidebar.previewConfirm": "Write it",
			"sidebar.previewCancel": "Cancel",
			"sidebar.previewBadgeAdded": "added",
			"sidebar.previewBadgeChanged": "rewritten",
			"sidebar.previewBadgeRemoved": "removed",
			"sidebar.workspaceDoc": "Workspace conventions",
			"sidebar.workspaceDocCreate": "Create workspace document",
			"sidebar.workspaceDocMissing": "This workspace has no shared document yet. Write one and the repositories below inherit it unless they carry their own.",
			"sidebar.workspaceDocExists": "Repositories below inherit this unless they carry their own document.",
			"sidebar.workspaceDocWritten": "Workspace document written.",
			"sidebar.conventionsSwitch": "Switch framework",
			"sidebar.overview": "Overview",
			"sidebar.overviewBack": "Back to graph",
			"sidebar.overviewHint": "Sorted by what needs attention: conflicts, changes, then branches trailing their upstream.",
			"sidebar.overviewClean": "clean",
			"sidebar.overviewDirty": "{count} changed",
			"sidebar.overviewConflicts": "{count} conflicts",
			"sidebar.overviewAhead": "{count} ahead",
			"sidebar.overviewBehind": "{count} behind",
			"sidebar.overviewUpstream": "no upstream",
			"sidebar.overviewDetached": "detached",
			"sidebar.overviewNow": "just now",
			"sidebar.overviewMinutes": "{count}m ago",
			"sidebar.overviewHours": "{count}h ago",
			"sidebar.overviewDays": "{count}d ago",
			"sidebar.overviewDetail": "branches",
			"sidebar.overviewMerged": "merged",
			"sidebar.overviewUnmerged": "{count} unmerged",
			"sidebar.overviewMeta": "{branches} branches · stash {stash} · {size} objects",
			"sidebar.overviewBase": "base {name}",
			"sidebar.overviewFailed": "could not read",
			"sidebar.overviewEmpty": "No repositories in this workspace yet.",
			"sidebar.exportGraph": "Export image",
			"sidebar.exported": "Exported",
			"sidebar.exportCopied": "SVG copied",
			"sidebar.exportNote": "Exported by dsh-git-graph-sidebar",
			"sidebar.search": "Filter commits (subject / author / SHA / ref)",
			"sidebar.refFilter": "Click to toggle the commits of this ref",
			"sidebar.filtered": "{shown} of {total} matched",
			"sidebar.noMatch": "No commits match the filter",
			"sidebar.copyRollback": "Copy rollback prompt",
			"sidebar.rollbackIntro": "Roll my repository back to a specific commit (describe only, do not execute anything).",
			"sidebar.rollbackAfter": "There are {count} commits after it in the current view.",
			"sidebar.rollbackOptions": "Candidate approaches",
			"sidebar.rollbackSafe": "safe, keeps history, fine on a pushed branch",
			"sidebar.rollbackHard": "discards the commits after it, avoid on a pushed branch",
			"sidebar.rollbackPick": "moves only this commit onto another branch",
			"sidebar.rollbackConfirm": "Confirm which one to use first, and say which commits would be lost.",
			"sidebar.initRepo": "Initialize Git repository",
			"sidebar.initRepoHint": "This folder is not a Git repository yet. Initialize it here; other repositories in the workspace are untouched.",
			"sidebar.initBranch": "Initial branch",
			"sidebar.initConfirm": "Initialize",
			"sidebar.initCancel": "Cancel",
			"sidebar.initRunning": "Initializing…",
			"sidebar.initAfter": "A Git convention document is created automatically afterwards, and the framework picker opens.",
			"sidebar.error.init": "Failed to initialize the Git repository",
			"sidebar.conventions": "Git conventions",
			"sidebar.conventionsNone": "not set up",
			"sidebar.conventionsDraft": "draft",
			"sidebar.conventionsSettled": "settled",
			"sidebar.conventionsMissing": "This repository has no Git conventions yet. Agree on commit and branch rules before the next commit.",
			"sidebar.conventionsSetup": "Set up",
			"sidebar.conventionsPick": "Pick one of the proven frameworks, or write the empty document and fill it in as a team.",
			"sidebar.conventionsScaffold": "Empty document only",
			"sidebar.conventionsCancel": "Cancel",
			"sidebar.conventionsOpen": "Open document",
			"sidebar.conventionsAuto": "An empty convention document was created for this repository. Pick a framework to settle it.",
			"sidebar.conventionsApplied": "Convention document written.",
			"sidebar.conventionsWriting": "Writing…",
			"sidebar.conventionsBestFor": "Best for: ",
			"sidebar.error.conventions": "Reading or writing the Git convention document failed",
			"sidebar.close": "Close",
			"sidebar.copyInfo": "Copy commit info",
			"sidebar.copySha": "Copy SHA",
			"sidebar.copied": "Copied",
			"sidebar.author": "Author",
			"sidebar.committedAt": "Committed at",
			"sidebar.references": "References",
			"sidebar.commit": "Commit",
			"sidebar.subject": "Subject",
			"sidebar.detailHint": "Click a commit to see details",
			"sidebar.repoPath": "Repository",
			"sidebar.parentsLabel": "Parents",
			"sidebar.repos": "{count} repositories",
			"sidebar.expand": "Expand repository tree",
			"sidebar.collapse": "Collapse repository tree",
			"sidebar.workspaceRoot": "workspace root",
			"sidebar.zoomIn": "Zoom in graph",
			"sidebar.zoomOut": "Zoom out graph",
			"sidebar.detail": "Commit details",
			"sidebar.parents": "{count} parents",
			"branch.search": "Search branches",
			"branch.empty": "No matching branches",
			"branch.detached": "Detached HEAD",
			"branch.dirty": "Uncommitted changes: {count} files",
			"branch.create": "Create and switch to new branch…",
			"branch.graph": "Git Graph",
			"branch.createDialog.title": "Create and switch to new branch",
			"branch.createDialog.description": "Create a new local branch from the current HEAD and switch to it immediately.",
			"branch.createDialog.nameLabel": "Branch name",
			"branch.createDialog.placeholder": "For example, feature/git-branch-switcher",
			"branch.createDialog.confirm": "Create and switch",
			"branch.createDialog.cancel": "Cancel",
			"graph.title": "Git Graph",
			"graph.subtitle": "{count} commits across {lanes} lanes",
			"graph.loading": "Loading…",
			"graph.loadMore": "Load more",
			"graph.close": "Close",
			"graph.empty": "No commits",
			"graph.time.justNow": "just now",
			"graph.time.minutesAgo": "{count} minutes ago",
			"graph.time.hoursAgo": "{count} hours ago",
			"graph.time.daysAgo": "{count} days ago",
			"error.conflictsPresent": "The repository still has unresolved conflicts. Resolve them before switching branches.",
			"error.operationInProgress": "Another Git operation is still in progress. Finish it before switching branches.",
			"error.branchInOtherWorktree": "That branch is already checked out in another worktree.",
			"error.trackedOverwrite": "Switch failed because tracked files would be overwritten: {paths}.",
			"error.untrackedOverwrite": "Switch failed because untracked files would be overwritten: {paths}.",
			"error.moreFiles": "{count} more files",
			"error.pathsSeparator": ", ",
			"error.targetBranchNotFound": "The target branch does not exist locally.",
			"error.invalidBranchName": "The branch name is invalid. Enter a different name.",
			"error.branchAlreadyExists": "That branch already exists. Choose another name.",
			"error.workspaceUnknown": "This directory is not a registered workspace.",
			"error.internal": "The operation failed. Please try again.",
			"error.requestFailed": "Branch operation failed: {error}",
			"toast.switchSuccess": "Switched to branch {branchName}",
			"chip.aria.branch": "Branch",
			"worktree.create": "Start a new session in a worktree…",
			"worktree.manage": "Manage worktrees…",
			"worktree.dialog.title": "Start a new session in a worktree",
			"worktree.dialog.description": "Create an isolated worktree in the DSH-managed home ($DSH_HOME/worktrees/) on a new wt/<name> branch, and open a new session in it. The current checkout is untouched.",
			"worktree.dialog.nameLabel": "Worktree name",
			"worktree.dialog.namePlaceholder": "For example, fix-login-race",
			"worktree.dialog.baseLabel": "Base branch",
			"worktree.dialog.confirm": "Create and start session",
			"worktree.dialog.cancel": "Cancel",
			"worktree.manager.title": "Worktree Manager",
			"worktree.manager.loading": "Loading…",
			"worktree.manager.empty": "No managed worktrees",
			"worktree.manager.main": "main checkout",
			"worktree.manager.detached": "detached HEAD",
			"worktree.manager.remove": "Remove",
			"worktree.manager.forceConfirm": "This worktree has uncommitted changes. Force-remove it?",
			"worktree.manager.forceYes": "Force remove",
			"worktree.manager.deleteBranch": "Also delete the branch",
			"worktree.manager.close": "Close",
			"toast.worktreeCreated": "Created worktree {name}",
			"error.invalidWorktreeName": "The worktree name is invalid. Enter a different name.",
			"error.worktreeAlreadyExists": "A worktree or branch with that name already exists. Choose another name.",
			"error.worktreeDirty": "The worktree has uncommitted changes.",
			"error.worktreeNotFound": "That worktree was not found (it may already be gone).",
			"error.worktreeIsMain": "The primary checkout cannot be removed.",
			"error.baseRefNotFound": "The base branch or revision does not exist."
		};
		//#endregion
		//#region src/client/telemetry.ts
		/** localStorage key carrying the family-wide telemetry opt-out ('1' = off). */
		const TELEMETRY_OPT_OUT_KEY = "dsh-web-ui-telemetry-opt-out";
		const VISITOR_KEY = "dsh-web-ui-telemetry-visitor";
		const DAY_KEY_PREFIX = "dsh-web-ui-telemetry-day:";
		const ENDPOINT = "https://dsh-market.com/api/telemetry/event";
		/** The building package's version, when the bundle carries it. */
		function bakedVersion() {
			try {
				return "0.4.8";
			} catch {
				return;
			}
		}
		/** Whether the user switched the family-wide opt-out on (reads storage only). */
		function isTelemetryOptedOut() {
			try {
				return localStorage.getItem(TELEMETRY_OPT_OUT_KEY) === "1";
			} catch {
				return false;
			}
		}
		/** Whether the browser itself asks not to be tracked; a failed read means no signal. */
		function doNotTrackRequested() {
			try {
				return navigator.doNotTrack === "1" || navigator.doNotTrack === "yes";
			} catch {
				return false;
			}
		}
		/** Whether a heartbeat must be suppressed right now: opt-out stored, or the browser asks not to be tracked. */
		function isTelemetrySuppressed() {
			return isTelemetryOptedOut() || doNotTrackRequested();
		}
		/** Read or lazily create the anonymous visitor id; null when storage is unavailable. */
		function visitorId() {
			try {
				const existing = localStorage.getItem(VISITOR_KEY);
				if (existing && /^[A-Za-z0-9_-]{16,64}$/.test(existing)) return existing;
				const fresh = crypto.randomUUID().replaceAll("-", "");
				localStorage.setItem(VISITOR_KEY, fresh);
				return fresh;
			} catch {
				return null;
			}
		}
		/** Drop stale per-day dedup keys so localStorage does not grow forever. */
		function pruneDayKeys(today) {
			try {
				for (let index = localStorage.length - 1; index >= 0; index -= 1) {
					const key = localStorage.key(index);
					if (key !== null && key.startsWith(DAY_KEY_PREFIX) && key !== DAY_KEY_PREFIX + today) localStorage.removeItem(key);
				}
			} catch {}
		}
		/**
		* Fire the daily heartbeat for the given items at most once per UTC day per
		* browser. Never throws and never blocks the caller. Items without an explicit
		* version inherit the bundle's baked build version.
		*/
		function reportDailyHeartbeat(items) {
			try {
				if (isTelemetrySuppressed()) return;
				if (items.length === 0) return;
				const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
				if (navigator.webdriver) return;
				if (localStorage.getItem(DAY_KEY_PREFIX + today) !== null) return;
				const visitor = visitorId();
				if (visitor === null) return;
				pruneDayKeys(today);
				const payloadItems = items.map((item) => {
					const out = { name: item.name };
					const version = item.version ?? bakedVersion();
					if (version !== void 0) out.version = version;
					if (item.channel !== void 0) out.channel = item.channel;
					return out;
				});
				const body = JSON.stringify({
					kind: "heartbeat",
					visitor,
					items: payloadItems
				});
				fetch(ENDPOINT, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body,
					keepalive: true
				}).then((response) => {
					if (response.ok) localStorage.setItem(DAY_KEY_PREFIX + today, "1");
				}).catch(() => {});
			} catch {}
		}
		//#endregion
		//#region src/client/graph/SidebarTab.tsx — multi-repo graph tab (dsh-git-graph sidebar fork)
		/** The shared element factory (the bundle's JSX helpers stay untouched). */
		const h = react.createElement;
		/** Tab id registered into better-sidebar (also its SidebarTab.type). */
		const SIDEBAR_TAB_ID = "git-graph-repos";
	/** Branch names offered by the one-click "initialize repository" bar. */
	const SIDEBAR_TAB_INIT_BRANCHES = ["main", "master", "trunk", "develop"];
	/** How many refs the filter offers as toggles before it stops listing them. */
	const SIDEBAR_TAB_FILTER_REFS_MAX = 12;
	/** Fewer chips than this cannot filter much, so the row stays out of the way. */
	const SIDEBAR_TAB_FILTER_REFS_MIN = 4;
	const SIDEBAR_TAB_INIT = {
		display: "flex",
		flexDirection: "column",
		gap: 6,
		padding: "8px 10px",
		borderRadius: 8,
		background: "var(--dsw-alias-bg-layer-2)",
		border: "1px solid var(--dsw-alias-border-l2)"
	};
	const SIDEBAR_TAB_INIT_ROW = { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" };
	const SIDEBAR_TAB_INIT_PATH = {
		flex: "1 1 100%",
		minWidth: 0,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
		fontSize: 12,
		color: "var(--dsw-alias-text-secondary)"
	};
		/** Repositories reported by one scan at most (mirrors the host limit). */
		const SIDEBAR_TAB_REPO_LIMIT = 200;
		/** Lazily created /git client for the tab (the chip keeps its own). */
		let sidebarTabClient;
		/** The sessions service captured by the tab registration (cwd fallback). */
		let sidebarTabSessions;
		/** The workspaces registry captured by the tab registration (worktree jump). */
		let sidebarTabWorkspaces;
		/** The workspace UI captured by the tab registration (open a session). */
		let sidebarTabUiWorkspace;
		/** localStorage key remembering whether the graph also opens as a main-area View. */
		const MAIN_VIEW_KEY = "dsh-git-graph:main-view";
		/** Listeners waiting for the preference to change (the View registration follows). */
		const sidebarTabMainViewListeners = new Set();
		/** Read the opt-in flag; a broken or missing storage counts as off. */
		function sidebarTabMainViewEnabled() {
			try {
				const store = globalThis.localStorage;
				return store !== void 0 && store !== null && store.getItem(MAIN_VIEW_KEY) === "1";
			} catch {
				return false;
			}
		}
		/** Persist the opt-in flag and wake every subscriber (sidebar and View). */
		function sidebarTabSetMainView(value) {
			const next = value === true;
			try {
				const store = globalThis.localStorage;
				if (store !== void 0 && store !== null) store.setItem(MAIN_VIEW_KEY, next ? "1" : "0");
			} catch {}
			for (const listener of [...sidebarTabMainViewListeners]) {
				try {
					listener();
				} catch {}
			}
		}
		/** Follow the flag; returns the unsubscribe function the effect cleans up with. */
		function sidebarTabMainViewSubscribe(listener) {
			sidebarTabMainViewListeners.add(listener);
			return () => {
				sidebarTabMainViewListeners.delete(listener);
			};
		}
		/** The session's workspace root, resolved at call time from the sessions baseline. */
		function sidebarTabCwdOf(sessions, sessionId) {
			if (sessions === void 0 || sessions === null || sessionId === void 0) return void 0;
			try {
				const entry = sessions.list.getSnapshot().byId[sessionId];
				return entry === void 0 || entry === null ? void 0 : entry.cwd;
			} catch {
				return void 0;
			}
		}
		/** The tab's /git client: stateless, shared for the whole client. */
		function sidebarTabGit() {
			if (sidebarTabClient === void 0) sidebarTabClient = new GitApi();
			return sidebarTabClient;
		}
		/** Interpolate {name} placeholders of one dictionary entry. */
		function sidebarTabInterpolate(template, params) {
			if (typeof template !== "string") return "";
			if (params === void 0 || params === null) return template;
			return template.replace(/\{(\w+)\}/g, (match, name) => params[name] === void 0 ? match : String(params[name]));
		}
		/** The browser language, used only when the locale service is missing. */
		function sidebarTabIsZh() {
			if (typeof navigator === "undefined") return false;
			const language = typeof navigator.language === "string" ? navigator.language : "";
			return /^zh/i.test(language);
		}
		/**
		 * Translate one key of this plugin's namespace. The locale service wins
		 * (its bind honours the Host-backed preference and switches live); the
		 * bundled dictionaries are the fallback for standalone compositions.
		 */
		function sidebarTabT(ctx, key, params) {
			const service = ctx !== void 0 && ctx !== null ? ctx.locale : void 0;
			if (service !== void 0 && service !== null && typeof service.bind === "function") {
				try {
					const bound = service.bind(NS);
					if (typeof bound === "function") {
						const text = bound(key, params);
						if (typeof text === "string" && text !== "" && text !== key) return text;
					}
				} catch {}
			}
			const dict = sidebarTabIsZh() ? zh : en;
			const entry = dict[key];
			return sidebarTabInterpolate(entry === void 0 ? key : entry, params);
		}
		/** The tab-strip mark: a minimal commit graph. */
		function sidebarTabIcon() {
			return h("svg", {
				width: 16,
				height: 16,
				viewBox: "0 0 16 16",
				"aria-hidden": "true",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: 1.4,
				strokeLinecap: "round"
			}, h("circle", {
				cx: 4.5,
				cy: 3.5,
				r: 1.7
			}), h("circle", {
				cx: 4.5,
				cy: 12.5,
				r: 1.7
			}), h("circle", {
				cx: 11.5,
				cy: 8,
				r: 1.7
			}), h("path", { d: "M4.5 5.2v5.6" }), h("path", { d: "M6.2 5.6c3.2.6 4 1.2 4.2 1.9" }));
		}
		/** One repository option label: the directory name, plus its relative path when nested. */
		function sidebarTabRepoLabel(entry) {
			const name = typeof entry.name === "string" && entry.name !== "" ? entry.name : entry.path;
			const relPath = typeof entry.relPath === "string" ? entry.relPath : "";
			if (relPath === "") return name;
			// Nested repositories are identified by their path below the workspace
			// root; repeating the basename ("x · x") reads like a bug.
			return relPath === name ? relPath : relPath + "  ·  " + name;
		}
		/**
		 * Flatten the discovered repositories into tree rows so the panel can show
		 * how the levels relate: the workspace root first, then every directory on
		 * the way down (muted) and the repository it leads to. Rows are sorted by
		 * relative path, so parents always precede their children.
		 */
		function sidebarTabRepoTree(repos) {
			const rows = [];
			const seenDirs = new Set();
			const entries = Array.isArray(repos) ? repos.slice() : [];
			entries.sort((a, b) => {
				const left = typeof a.relPath === "string" ? a.relPath : "";
				const right = typeof b.relPath === "string" ? b.relPath : "";
				if (left === "") return -1;
				if (right === "") return 1;
				return left < right ? -1 : left > right ? 1 : 0;
			});
			for (const entry of entries) {
				const relPath = typeof entry.relPath === "string" ? entry.relPath : "";
				const name = typeof entry.name === "string" && entry.name !== "" ? entry.name : entry.path;
				if (relPath === "") {
					rows.push({ key: "root:" + entry.path, depth: 0, kind: "root", label: name, entry });
					continue;
				}
				const segments = relPath.split("/").filter((part) => part !== "");
				for (let index = 0; index < segments.length - 1; index += 1) {
					const dirPath = segments.slice(0, index + 1).join("/");
					if (seenDirs.has(dirPath)) continue;
					seenDirs.add(dirPath);
					rows.push({ key: "dir:" + dirPath, depth: index + 1, kind: "dir", label: segments[index] });
				}
				rows.push({ key: "repo:" + entry.path, depth: segments.length, kind: "repo", label: name, entry });
			}
			// A row is the last child of its parent when no sibling of the same
			// depth follows before a shallower row: that drives the connector glyph.
			for (let index = 0; index < rows.length; index += 1) {
				const row = rows[index];
				let last = true;
				for (let probe = index + 1; probe < rows.length; probe += 1) {
					if (rows[probe].depth < row.depth) break;
					if (rows[probe].depth === row.depth) {
						last = false;
						break;
					}
				}
				row.last = last;
			}
			return rows;
		}
		/** Root container: the tab owns its full height and scrolls its own body. */
		const SIDEBAR_TAB_ROOT = {
			display: "flex",
			flexDirection: "column",
			height: "100%",
			minHeight: 0,
			boxSizing: "border-box",
			gap: 6,
			padding: "8px 8px 6px"
		};
		const SIDEBAR_TAB_TOOLBAR = {
			display: "flex",
			alignItems: "center",
			gap: 6,
			flexWrap: "wrap",
			flex: "none"
		};
		const SIDEBAR_TAB_SELECT = {
			flex: "1 1 150px",
			minWidth: 0,
			height: 26,
			borderRadius: 8,
			border: "1px solid var(--dsh-gg-ctl-bd, var(--dsw-alias-border-l2))",
			background: "var(--dsw-alias-bg-base)",
			color: "var(--dsw-alias-label-primary)",
			fontSize: 13,
			padding: "0 6px"
		};
		const SIDEBAR_TAB_TREE_HEADER = {
			display: "flex",
			alignItems: "center",
			gap: 4,
			flex: "none",
			width: "100%",
			padding: "1px 2px",
			border: "none",
			background: "transparent",
			color: "var(--dsw-alias-label-secondary)",
			fontSize: 12,
			textAlign: "left",
			cursor: "pointer"
		};
		const SIDEBAR_TAB_TREE = {
			flex: "none",
			maxHeight: 170,
			overflowY: "auto",
			overflowX: "hidden",
			border: "1px solid var(--dsh-gg-ctl-bd, var(--dsw-alias-border-l2))",
			borderRadius: 8,
			background: "var(--dsw-alias-bg-base)",
			padding: "2px 0"
		};
		const SIDEBAR_TAB_TREE_ROW = {
			display: "flex",
			alignItems: "center",
			gap: 4,
			padding: "2px 6px 2px 0",
			fontSize: 12,
			lineHeight: "16px",
			whiteSpace: "nowrap",
			cursor: "pointer"
		};
		const SIDEBAR_TAB_TREE_DIR = {
			cursor: "default",
			color: "var(--dsw-alias-label-tertiary)"
		};
		const SIDEBAR_TAB_TREE_ACTIVE = {
			background: "rgba(56, 189, 248, 0.18)",
			boxShadow: "inset 0 0 0 1px rgba(56, 189, 248, 0.5)",
			borderRadius: 6
		};
		const SIDEBAR_TAB_TREE_GLYPH = {
			flex: "none",
			color: "var(--dsw-alias-label-tertiary)",
			fontFamily: "ui-monospace, SFMono-Regular, monospace"
		};
		const SIDEBAR_TAB_TREE_NAME = {
			flex: "1 1 auto",
			minWidth: 0,
			overflow: "hidden",
			textOverflow: "ellipsis"
		};
		const SIDEBAR_TAB_TREE_DOT = {
			flex: "none",
			width: 6,
			height: 6,
			borderRadius: 999
		};
		const SIDEBAR_TAB_BUTTON = {			flex: "none",
			height: 26,
			border: "1px solid var(--dsh-gg-ctl-bd, var(--dsw-alias-border-l2))",
			background: "var(--dsh-gg-ctl-bg, #ffffff)",
			color: "var(--dsh-gg-ctl-fg, #14181f)",
			borderRadius: 8,
			fontSize: 13,
			padding: "0 10px",
			cursor: "pointer"
		};
		const SIDEBAR_TAB_STATUS = {
			display: "flex",
			alignItems: "center",
			gap: 6,
			flexWrap: "wrap",
			flex: "none",
			fontSize: 12,
			minHeight: 16
		};
		const SIDEBAR_TAB_BADGE = {
			borderRadius: 999,
			background: "var(--dsw-alias-bg-layer-2)",
			color: "var(--dsw-alias-label-secondary)",
			padding: "1px 7px",
			fontSize: 11
		};
		const SIDEBAR_TAB_MUTED = {
			color: "var(--dsw-alias-label-tertiary)",
			fontSize: 12
		};
		const SIDEBAR_TAB_WARN = {
			color: "var(--dsw-alias-state-warn-primary)",
			fontSize: 12
		};
		const SIDEBAR_TAB_ERROR = {
			color: "var(--dsw-alias-state-error-primary)",
			fontSize: 13,
			padding: "12px 4px"
		};
		const SIDEBAR_TAB_EMPTY = {
			color: "var(--dsw-alias-label-tertiary)",
			fontSize: 13,
			textAlign: "center",
			padding: "20px 8px"
		};
		const SIDEBAR_TAB_BODY = {
			flex: "1 1 auto",
			minHeight: 96,
			overflowY: "auto",
			border: "1px solid var(--dsw-alias-border-l1)",
			borderRadius: 10,
			padding: 4
		};
		const SIDEBAR_TAB_MORE = {
			flex: "none",
			width: "100%",
			border: "1px solid var(--dsw-alias-border-l1)",
			background: "0 0",
			color: "var(--dsw-alias-label-secondary)",
			borderRadius: 8,
			padding: 6,
			fontSize: 13,
			cursor: "pointer"
		};
		/** Lane palette of the SVG graph, indexed by lane number. */
		const SIDEBAR_TAB_GRAPH_PALETTE = ["#4c8dff", "#f59e0b", "#10b981", "#ef4444", "#a855f7", "#06b6d4", "#eab308", "#ec4899"];
		/** Horizontal pitch between two lanes, in CSS pixels. */
		const SIDEBAR_TAB_LANE_W = 13;
		/** Default vertical pitch of one commit row: two lines (subject, then refs + time). */
		const SIDEBAR_TAB_ROW_H = 34;
		/** Zoom bounds and step for the commit rows; below SIDEBAR_TAB_STACK_ROW_H rows fold into one line. */
		const SIDEBAR_TAB_MIN_ROW_H = 20;
		const SIDEBAR_TAB_MAX_ROW_H = 52;
		const SIDEBAR_TAB_ZOOM_STEP = 7;
		/** One commit line: clickable, pinned lines get a highlighted surface. */
		const SIDEBAR_TAB_ROW = {
			display: "flex",
			alignItems: "center",
			gap: 6,
			boxSizing: "border-box",
			paddingRight: 6,
			borderRadius: 6,
			cursor: "pointer",
			overflow: "hidden"
		};
		/** Row height at which a row switches from one line to two. */
		const SIDEBAR_TAB_STACK_ROW_H = 30;
		/** At most this many ref badges per row; the rest collapse into a +N badge. */
		const SIDEBAR_TAB_REF_MAX = 2;
		/** Short object id gutter of one row. */
		const SIDEBAR_TAB_OID = {
			flex: "none",
			width: 44,
			fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
			fontSize: 11,
			color: "var(--dsw-alias-label-tertiary)"
		};
		/** Commit subject: the one elastic column of a row. */
		const SIDEBAR_TAB_SUBJECT = {
			flex: "1 1 auto",
			minWidth: 0,
			overflow: "hidden",
			textOverflow: "ellipsis",
			whiteSpace: "nowrap",
			fontSize: 13,
			color: "var(--dsw-alias-label-primary)"
		};
		/** One ref badge (branch, tag, HEAD). */
		const SIDEBAR_TAB_REF = {
			flex: "none",
			maxWidth: 78,
			overflow: "hidden",
			textOverflow: "ellipsis",
			whiteSpace: "nowrap",
			borderRadius: 999,
			padding: "0 6px",
			fontSize: 9,
			lineHeight: "14px",
			color: "var(--dsw-alias-label-secondary)",
			background: "var(--dsw-alias-bg-layer-2)"
		};
		/** Ref badges of one row, clipped as a group so the subject keeps its room. */
		const SIDEBAR_TAB_REFS = {
			flex: "0 0 auto",
			display: "flex",
			alignItems: "center",
			gap: 4,
			minWidth: 0,
			overflow: "hidden"
		};
		/** Filter bar: a search field above one toggle per ref. */
		const SIDEBAR_TAB_FILTER = {
			display: "flex",
			flexDirection: "column",
			gap: 4
		};
		const SIDEBAR_TAB_SEARCH = {
			width: "100%",
			boxSizing: "border-box",
			padding: "3px 6px",
			borderRadius: 6,
			border: "1px solid var(--dsw-alias-border-default, rgba(127, 127, 127, 0.35))",
			background: "var(--dsw-alias-bg-base)",
			color: "var(--dsw-alias-label-primary)",
			fontFamily: "inherit",
			fontSize: 12
		};
		const SIDEBAR_TAB_FILTER_REFS = {
			display: "flex",
			flexWrap: "wrap",
			gap: 4
		};
		/** One ref toggle: cyan while it is visible, struck through once muted. */
		const SIDEBAR_TAB_CHIP = {
			flex: "none",
			padding: "1px 6px",
			borderRadius: 999,
			border: "1px solid rgba(56, 189, 248, 0.55)",
			background: "rgba(56, 189, 248, 0.18)",
			color: "var(--dsw-alias-label-primary)",
			fontFamily: "inherit",
			fontSize: 11,
			lineHeight: "14px",
			cursor: "pointer"
		};
		const SIDEBAR_TAB_CHIP_OFF = {
			border: "1px solid transparent",
			background: "transparent",
			color: "var(--dsw-alias-label-tertiary)",
			textDecoration: "line-through"
		};
		/** A remote-only branch: dashed, so it reads as "same thing, other side". */
		const SIDEBAR_TAB_CHIP_MORE = Object.assign({}, SIDEBAR_TAB_CHIP, {
			border: "1px dashed rgba(56, 189, 248, 0.45)",
			background: "transparent",
			color: "var(--dsw-alias-label-secondary)"
		});
		/** Elastic column holding subject (and, when zoomed in, the refs line). */
		const SIDEBAR_TAB_ROW_COLUMN = {
			flex: "1 1 auto",
			display: "flex",
			flexDirection: "column",
			justifyContent: "center",
			gap: 1,
			minWidth: 0
		};
		/** Second line of a zoomed-in row: refs + relative time. */
		const SIDEBAR_TAB_ROW_SUB = {
			flex: "none",
			display: "flex",
			alignItems: "center",
			gap: 4,
			minWidth: 0,
			overflow: "hidden"
		};
		/** The ref badge of the branch currently checked out. */
		const SIDEBAR_TAB_REF_CURRENT = {
			color: "#ffffff",
			background: "var(--dsw-alias-state-business-primary, #4c8dff)"
		};
		/**
		 * Whether two scan results describe the same repositories. A silent poll
		 * that finds nothing new must not re-render the whole panel: the graph,
		 * the tree and the scroll position would all flicker for no reason.
		 */
		function sidebarTabSameScan(previous, next) {
			if (previous === void 0 || previous === null || previous.phase !== "ready") return false;
			if (previous.truncated !== next.truncated || previous.autoScaffold !== next.autoScaffold || previous.docName !== next.docName) return false;
			const before = previous.repos;
			const after = next.repos;
			if (before.length !== after.length) return false;
			for (let index = 0; index < before.length; index += 1) {
				const a = before[index];
				const b = after[index];
				const aState = a.conventions !== void 0 && a.conventions !== null ? a.conventions : {};
				const bState = b.conventions !== void 0 && b.conventions !== null ? b.conventions : {};
				if (a.path !== b.path || a.kind !== b.kind || a.relPath !== b.relPath) return false;
				if (JSON.stringify(a.status ?? null) !== JSON.stringify(b.status ?? null)) return false;
				if (aState.exists !== bState.exists || aState.draft !== bState.draft || aState.size !== bState.size || aState.doc !== bState.doc) return false;
			}
			return true;
		}
		/**
		 * Whether two graph views are the same for display purposes. Ref logins
		 * and commit rows decide it; the commit graph of a quiet repository then
		 * costs one request and zero DOM work.
		 */
		function sidebarTabSameGraph(previous, next) {
			if (previous === void 0 || previous === null || next === void 0 || next === null) return false;
			if (previous.branch !== next.branch || previous.hasMore !== next.hasMore) return false;
			const before = previous.commits;
			const after = next.commits;
			if (before.length !== after.length) return false;
			for (let index = 0; index < before.length; index += 1) {
				const a = before[index];
				const b = after[index];
				if (a.oid !== b.oid || a.subject !== b.subject) return false;
				if (JSON.stringify(a.refs) !== JSON.stringify(b.refs)) return false;
				if (JSON.stringify(a.parents) !== JSON.stringify(b.parents)) return false;
			}
			return true;
		}
		/**
		 * A path as the panel compares paths: `git worktree list`, the workspace
		 * registry and the sessions baseline all spell Windows paths a little
		 * differently (drive case, separators, `\\?\` long form, trailing slash),
		 * so every side is folded before it is compared.
		 */
		function sidebarTabPathKey(value) {
			if (typeof value !== "string") return "";
			let text = value.replace(/\\/g, "/");
			if (text.startsWith("//?/UNC/")) text = "//" + text.slice(8);
			else if (text.startsWith("//?/")) text = text.slice(4);
			while (text.length > 1 && text.endsWith("/")) text = text.slice(0, -1);
			return text.toLowerCase();
		}
		/** The directory name of a worktree, as its display label. */
		function sidebarTabWorktreeName(path) {
			let text = String(path).replace(/\\/g, "/");
			while (text.length > 1 && text.endsWith("/")) text = text.slice(0, -1);
			const cut = text.lastIndexOf("/");
			return cut < 0 ? text : text.slice(cut + 1);
		}
		/** How many uncommitted files one status counts. */
		function sidebarTabDirtyCount(status) {
			if (status === void 0 || status === null) return 0;
			return (status.dirtyFiles || 0) + (status.untrackedFiles || 0);
		}
		/**
		 * Whether two worktree lists describe the same checkouts. A quiet refresh
		 * that finds nothing new must not re-render the tree under the pointer.
		 */
		function sidebarTabSameWorktrees(previous, next) {
			if (previous === void 0 || previous === null || previous.phase !== "ready") return false;
			if (next === void 0 || next === null || next.phase !== "ready") return false;
			if (previous.root !== next.root || previous.count !== next.count) return false;
			const before = previous.list;
			const after = next.list;
			if (before.length !== after.length) return false;
			for (let index = 0; index < before.length; index += 1) {
				const a = before[index];
				const b = after[index];
				if (a.path !== b.path || a.head !== b.head || a.branch !== b.branch) return false;
				if (a.main !== b.main || a.locked === b.locked || a.prunable === b.prunable || a.bare === b.bare) return false;
			}
			return true;
		}
		/** The linked worktrees under the selected repository (read-only rows). */
		const SIDEBAR_TAB_WORKTREE_GROUP = {
			display: "flex",
			flexDirection: "column",
			gap: 1,
			marginLeft: 12,
			padding: "1px 0 3px 6px",
			borderLeft: "1px solid var(--dsw-alias-border-l2)"
		};
		const SIDEBAR_TAB_WORKTREE_ROW = {
			display: "flex",
			alignItems: "center",
			gap: 4,
			padding: "1px 6px 1px 0",
			fontSize: 12,
			lineHeight: "15px",
			whiteSpace: "nowrap",
			cursor: "pointer",
			color: "var(--dsw-alias-label-secondary)",
			borderRadius: 6
		};
		const SIDEBAR_TAB_WORKTREE_ACTIONS = {
			display: "flex",
			alignItems: "center",
			gap: 6,
			flexWrap: "wrap",
			flex: "none"
		};
		/** Author + relative time of one row. */
		const SIDEBAR_TAB_ROW_META = {
			flex: "none",
			fontSize: 9,
			fontVariantNumeric: "tabular-nums",
			color: "var(--dsw-alias-label-tertiary)",
			whiteSpace: "nowrap"
		};
		/** Pinned commit card. */
		const SIDEBAR_TAB_DETAIL = {
			flex: "none",
			display: "flex",
			flexDirection: "column",
			gap: 4,
			padding: "10px 12px",
			borderRadius: 10,
			border: "1px solid var(--dsw-alias-border-l1)",
			background: "var(--dsw-alias-bg-layer-2)",
			fontSize: 13,
			color: "var(--dsw-alias-label-secondary)",
			wordBreak: "break-all"
		};
		/** Full object id of the pinned commit card (monospace, wraps at the card width). */
		const SIDEBAR_TAB_DETAIL_OID = {
			fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
			fontSize: 12,
			lineHeight: "16px",
			color: "var(--dsw-alias-label-primary)",
			wordBreak: "break-all"
		};
		/** Subject line of the pinned commit card. */
		const SIDEBAR_TAB_DETAIL_SUBJECT = {
			fontSize: 14,
			lineHeight: "18px",
			color: "var(--dsw-alias-label-primary)",
			wordBreak: "break-word"
		};
		/** Square zoom control of the toolbar. */
		const SIDEBAR_TAB_ZOOM = {
			flex: "none",
			width: 24,
			height: 26,
			border: "1px solid var(--dsh-gg-ctl-bd, var(--dsw-alias-border-l2))",
			background: "var(--dsh-gg-ctl-bg, #ffffff)",
			color: "var(--dsh-gg-ctl-fg, #14181f)",
			borderRadius: 8,
			fontSize: 14,
			lineHeight: "24px",
			padding: 0,
			cursor: "pointer"
		};
		/** Small action button of the commit card. */
		const SIDEBAR_TAB_DETAIL_BUTTON = {
			flex: "none",
			height: 24,
			padding: "0 8px",
			border: "1px solid var(--dsh-gg-ctl-bd, var(--dsw-alias-border-l2))",
			background: "var(--dsh-gg-ctl-bg, #ffffff)",
			color: "var(--dsh-gg-ctl-fg, #14181f)",
			borderRadius: 6,
			fontSize: 12,
			lineHeight: "22px",
			whiteSpace: "nowrap",
			cursor: "pointer"
		};
		/** Header line of the commit card. */
		const SIDEBAR_TAB_DETAIL_HEAD = {
			display: "flex",
			alignItems: "center",
			gap: 6,
			minWidth: 0
		};
		/** One labelled line of the commit card. */
		const SIDEBAR_TAB_DETAIL_LINE = {
			display: "flex",
			gap: 8,
			minWidth: 0,
			fontSize: 13,
			lineHeight: "18px"
		};
		/** Label column of a commit-card line. */
		const SIDEBAR_TAB_DETAIL_KEY = {
			flex: "none",
			width: 58,
			color: "var(--dsw-alias-label-tertiary)"
		};
		/** Value column of a commit-card line. */
		const SIDEBAR_TAB_DETAIL_VALUE = {
			flex: "1 1 auto",
			minWidth: 0,
			color: "var(--dsw-alias-label-secondary)",
			wordBreak: "break-word"
		};
		/** The strict switch row inside the framework picker. */
		const SIDEBAR_TAB_STRICT_ROW = {
			display: "flex",
			alignItems: "center",
			gap: "8px",
			flexWrap: "wrap",
			padding: "2px 0 0"
		};
		/** The strict switch, off: a dashed pill that reads as an option. */
		const SIDEBAR_TAB_STRICT_OFF = {
			font: "inherit",
			fontSize: "12px",
			padding: "3px 9px",
			borderRadius: "999px",
			border: "1px dashed var(--dsh-gg-ctl-bd, var(--dsw-alias-border-2))",
			background: "var(--dsh-gg-ctl-bg, transparent)",
			color: "var(--dsw-alias-label-secondary)",
			cursor: "pointer",
			whiteSpace: "nowrap"
		};
		/** The strict switch, on: solid and amber, because it changes policy. */
		const SIDEBAR_TAB_STRICT_ON = Object.assign({}, SIDEBAR_TAB_STRICT_OFF, {
			border: "1px solid var(--dsw-alias-state-warn-primary, #b45309)",
			color: "var(--dsw-alias-state-warn-primary, #b45309)",
			fontWeight: 600
		});
		/** The one line explanation next to the strict switch. */
		const SIDEBAR_TAB_STRICT_NOTE = {
			flex: "1 1 140px",
			minWidth: "0",
			fontSize: "11px",
			lineHeight: "16px",
			color: "var(--dsw-alias-label-tertiary)"
		};
		/** The compliance line: one sentence plus the offending subjects. */
const SIDEBAR_TAB_COMPLIANCE = {
			display: "flex",
			flexDirection: "row",
			flexWrap: "wrap",
			alignItems: "center",
			gap: 4,
			padding: "2px 2px 0",
			fontSize: 12,
			lineHeight: "16px"
		};
		/** The upgrade preview: what a write would add, rewrite or drop. */
		/** The cross-document conflict banner: it never guesses, it reports and offers the merge. */
		/** Full-height frame the main-area View renders the tab inside. */
		const SIDEBAR_TAB_MAIN_VIEW = {
			position: "relative",
			display: "flex",
			flexDirection: "column",
			flex: "1 1 auto",
			minHeight: 0,
			overflow: "hidden",
			background: "var(--dsw-alias-bg-base)"
		};
		/** The corner button that turns the opt-in off again. */
		const SIDEBAR_TAB_MAIN_VIEW_CLOSE = {
			position: "absolute",
			top: 6,
			right: 8,
			width: 22,
			height: 22,
			padding: 0,
			lineHeight: "20px",
			fontSize: 14,
			border: "none",
			borderRadius: 4,
			cursor: "pointer",
			color: "var(--dsw-alias-text-2)",
			background: "transparent"
		};
		/** Same tab filling the main area: the host publishes both numbers, so nothing hides under the composer. */
		const SIDEBAR_TAB_MAIN_VIEW_ROOT = Object.assign({}, SIDEBAR_TAB_ROOT, {
			height: "calc(var(--dsh-conversation-viewport-height, 100vh) - var(--dsh-composer-height, 96px))",
			maxHeight: "calc(var(--dsh-conversation-viewport-height, 100vh) - var(--dsh-composer-height, 96px))",
			overflow: "hidden"
		});
		/** Graph left, pinned commit right: the main area is wide, and the card leaves the bottom alone. */
		const SIDEBAR_TAB_MAIN_VIEW_SPLIT = {
			display: "flex",
			flexDirection: "row",
			flex: "1 1 auto",
			minHeight: 0,
			gap: 8
		};
		const SIDEBAR_TAB_MAIN_VIEW_ASIDE = {
			flex: "0 0 320px",
			minWidth: 240,
			maxWidth: 420,
			display: "flex",
			flexDirection: "column",
			minHeight: 0,
			overflowY: "auto"
		};
		const SIDEBAR_TAB_CONFLICTS = {
			display: "flex",
			flexDirection: "row",
			flexWrap: "wrap",
			alignItems: "center",
			gap: 6,
			marginTop: 4,
			padding: "4px 6px",
			borderRadius: 6,
			fontSize: 12,
			lineHeight: "16px",
			background: "var(--dsw-alias-bg-layer-2)"
		};
		const SIDEBAR_TAB_PREVIEW = {
			display: "flex",
			flexDirection: "column",
			gap: 4,
			marginTop: 6,
			padding: 8,
			borderRadius: 8,
			border: "1px dashed var(--dsh-gg-ctl-bd, var(--dsw-alias-border-2))",
			background: "var(--dsw-alias-bg-layer-1)"
		};
		/** One section of the preview. */
		const SIDEBAR_TAB_PREVIEW_ROW = {
			display: "flex",
			alignItems: "baseline",
			gap: 6,
			fontSize: 12,
			lineHeight: "16px"
		};
		const SIDEBAR_TAB_PREVIEW_SNIPPET = {
			color: "var(--dsw-alias-label-tertiary)",
			fontSize: 11,
			lineHeight: "15px",
			wordBreak: "break-word"
		};
		/**
		 * The Git-conventions strip: it reports whether the selected repository
		 * carries a convention document and opens the framework picker.
		 */
		const SIDEBAR_TAB_CONVENTIONS = {
			display: "flex",
			flexDirection: "column",
			gap: 6,
			padding: "8px 10px",
			border: "1px solid var(--dsh-gg-ctl-bd, var(--dsw-alias-border-1))",
			borderRadius: 8,
			background: "var(--dsw-alias-bg-layer-1)",
			fontSize: 12,
			flex: "none"
		};
		const SIDEBAR_TAB_CONVENTIONS_HEAD = {
			display: "flex",
			alignItems: "center",
			gap: 6,
			flexWrap: "wrap"
		};
		const SIDEBAR_TAB_CONVENTIONS_TITLE = {
			fontWeight: 600,
			color: "var(--dsw-alias-label-primary)",
			flex: "1 1 auto",
			minWidth: 0
		};
		const SIDEBAR_TAB_CONVENTIONS_NOTE = {
			color: "var(--dsw-alias-label-tertiary)",
			lineHeight: "16px"
		};
		const SIDEBAR_TAB_CONVENTIONS_CHIP = {
			flex: "none",
			padding: "1px 5px",
			borderRadius: 4,
			fontSize: 11,
			lineHeight: "14px",
			background: "var(--dsw-alias-bg-layer-2)",
			color: "var(--dsw-alias-label-secondary)"
		};
		const SIDEBAR_TAB_PICKER = {
			display: "flex",
			flexDirection: "column",
			gap: 6,
			maxHeight: 360,
			overflowY: "auto"
		};
		const SIDEBAR_TAB_FRAMEWORK = {
			display: "flex",
			flexDirection: "column",
			gap: 3,
			padding: "7px 9px",
			border: "1px solid var(--dsh-gg-ctl-bd, var(--dsw-alias-border-1))",
			borderRadius: 8,
			background: "var(--dsw-alias-bg-layer-2)",
			cursor: "pointer",
			textAlign: "left",
			color: "inherit"
		};
		const SIDEBAR_TAB_FRAMEWORK_NAME = {
			fontSize: 13,
			fontWeight: 600,
			color: "var(--dsw-alias-label-primary)"
		};
		const SIDEBAR_TAB_FRAMEWORK_TAG = {
			fontSize: 12,
			lineHeight: "16px",
			color: "var(--dsw-alias-label-secondary)"
		};
		const SIDEBAR_TAB_FRAMEWORK_META = {
			fontSize: 11,
			lineHeight: "15px",
			color: "var(--dsw-alias-label-tertiary)"
		};
		/** The template settings page: it replaces the tab body, it is not an overlay. */
		const SIDEBAR_TAB_SETTINGS_PAGE = {
			display: "flex",
			flexDirection: "column",
			gap: 8,
			flex: "1 1 auto",
			minHeight: 0,
			overflowY: "auto",
			paddingRight: 2
		};
		const SIDEBAR_TAB_SETTINGS_HEAD = {
			display: "flex",
			alignItems: "center",
			gap: 6,
			flex: "none"
		};
		const SIDEBAR_TAB_SETTINGS_ROW = {
			display: "flex",
			alignItems: "center",
			gap: 6,
			flexWrap: "wrap"
		};
		const SIDEBAR_TAB_SETTINGS_CARD = {
			display: "flex",
			flexDirection: "column",
			gap: 4,
			padding: "7px 9px",
			border: "1px solid var(--dsh-gg-ctl-bd, var(--dsw-alias-border-1))",
			borderRadius: 8,
			background: "var(--dsw-alias-bg-layer-2)"
		};
		const SIDEBAR_TAB_SETTINGS_FIELD = {
			display: "flex",
			flexDirection: "column",
			gap: 3
		};
		const SIDEBAR_TAB_SETTINGS_LABEL = {
			fontSize: 11,
			lineHeight: "14px",
			color: "var(--dsw-alias-label-tertiary)"
		};
		const SIDEBAR_TAB_INPUT = {
			boxSizing: "border-box",
			width: "100%",
			height: 26,
			borderRadius: 8,
			border: "1px solid var(--dsh-gg-ctl-bd, var(--dsw-alias-border-l2))",
			background: "var(--dsw-alias-bg-base)",
			color: "var(--dsw-alias-label-primary)",
			fontSize: 13,
			padding: "0 6px"
		};
		const SIDEBAR_TAB_TEXTAREA = Object.assign({}, SIDEBAR_TAB_INPUT, {
			height: 220,
			minHeight: 120,
			padding: "6px",
			fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
			fontSize: 12,
			lineHeight: "16px",
			resize: "vertical",
			whiteSpace: "pre"
		});
		/**
		* Row hover / pinned surfaces and smooth lane transitions. Inline styles
		* cannot express `:hover`, so the tab ships one tiny stylesheet, injected
		* once per document.
		*/
		const SIDEBAR_TAB_CSS = [
			"[data-gitgraph-sidebar-tab]{--dsh-gg-ctl-bg:#ffffff;--dsh-gg-ctl-fg:#14181f;--dsh-gg-ctl-bd:rgba(20,24,31,0.16)}",
			"body[data-ds-dark-theme] [data-gitgraph-sidebar-tab]{--dsh-gg-ctl-bg:rgba(255,255,255,0.06);--dsh-gg-ctl-fg:#eef2f7;--dsh-gg-ctl-bd:rgba(255,255,255,0.22)}",
			"[data-gitgraph-sidebar-tab] [data-gitgraph-row]{transition:background-color 120ms ease}",
			"[data-gitgraph-sidebar-tab] [data-gitgraph-row]:hover{background-color:var(--dsw-alias-bg-layer-2)}",
			"[data-gitgraph-sidebar-tab] [data-gitgraph-row][data-gitgraph-pinned=\"true\"]{background-color:var(--dsw-alias-bg-layer-2)}",
			"[data-gitgraph-sidebar-tab] [data-gitgraph-zoom]:hover{border-color:var(--dsw-alias-label-tertiary)}",
			"[data-gitgraph-sidebar-tab] [data-gitgraph-action]:hover{border-color:var(--dsw-alias-label-tertiary)}",
			"[data-gitgraph-sidebar-tab] [data-gitgraph-detail]{transition:opacity 120ms ease}",
			"[data-gitgraph-sidebar-tab] [data-gitgraph-framework]:hover{border-color:var(--dsw-alias-label-tertiary)}"
		].join("");
		/** True once the tab stylesheet is in the document. */
		let sidebarTabStyleInstalled = false;
		/** Inject the tab stylesheet (idempotent, no-op outside a browser). */
		function sidebarTabEnsureStyle() {
			if (sidebarTabStyleInstalled || typeof document === "undefined") return;
			sidebarTabStyleInstalled = true;
			try {
				const style = document.createElement("style");
				style.setAttribute("data-plugin-css", "dsh-git-graph: sidebar tab");
				style.textContent = SIDEBAR_TAB_CSS;
				(document.head ?? document.body)?.appendChild(style);
			} catch {
				sidebarTabStyleInstalled = false;
			}
		}
		/** Color of one lane, wrapping around the palette. */
		function sidebarTabLaneColor(lane) {
			const size = SIDEBAR_TAB_GRAPH_PALETTE.length;
			return SIDEBAR_TAB_GRAPH_PALETTE[((lane % size) + size) % size];
		}
		/** One commit time as `YYYY-MM-DD HH:mm` in the browser zone. */
		function sidebarTabIsoTime(epochSeconds) {
			try {
				const date = new Date(epochSeconds * 1000);
				if (Number.isNaN(date.getTime())) return String(epochSeconds);
				const pad = (value) => value < 10 ? "0" + value : String(value);
				return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate()) + " " + pad(date.getHours()) + ":" + pad(date.getMinutes());
			} catch {
				return String(epochSeconds);
			}
		}
		/** Write one string to the clipboard, falling back to a hidden textarea. */
		function sidebarTabCopy(text) {
			try {
				const clipboard = typeof navigator === "undefined" ? void 0 : navigator.clipboard;
				if (clipboard !== void 0 && clipboard !== null && typeof clipboard.writeText === "function") {
					clipboard.writeText(text);
					return true;
				}
			} catch {}
			try {
				const area = document.createElement("textarea");
				area.value = text;
				area.setAttribute("readonly", "");
				area.style.position = "fixed";
				area.style.top = "-1000px";
				area.style.opacity = "0";
				(document.body ?? document.documentElement)?.appendChild(area);
				area.select();
				const copied = document.execCommand("copy");
				area.remove();
				return copied !== false;
			} catch {
				return false;
			}
		}
		/** Escape one string for XML text or attribute content. */
		function sidebarTabXmlEscape(value) {
			return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
		}
		/** Whether the page is on a dark theme, read the way the app marks it. */
		function sidebarTabIsDark() {
			try {
				const body = typeof document === "undefined" ? void 0 : document.body;
				if (body !== void 0 && body !== null) {
					if (typeof body.hasAttribute === "function" && body.hasAttribute("data-ds-dark-theme")) return true;
					if (typeof body.getAttribute === "function" && body.getAttribute("data-ds-dark-theme") !== null) return true;
				}
				if (typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches === true) return true;
			} catch {}
			return false;
		}
		/** Font stacks of the exported image; a saved file carries no CSS. */
		const SIDEBAR_TAB_EXPORT_FONT = "ui-sans-serif, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif";
		const SIDEBAR_TAB_EXPORT_MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
		const SIDEBAR_TAB_EXPORT_PAD = 18;
		const SIDEBAR_TAB_EXPORT_HEAD = 60;
		const SIDEBAR_TAB_EXPORT_FOOT = 26;
		const SIDEBAR_TAB_EXPORT_ROW = 34;
		const SIDEBAR_TAB_EXPORT_WIDTH_MIN = 680;
		const SIDEBAR_TAB_EXPORT_WIDTH_MAX = 1180;
		const SIDEBAR_TAB_EXPORT_REF_MAX = 3;
		/** Explicit colors for the exported image: CSS variables do not survive a save. */
		function sidebarTabExportPalette(dark) {
			return dark === true ? {
				bg: "#0f1115",
				line: "#242b36",
				primary: "#e8ecf3",
				secondary: "#a4acba",
				tertiary: "#7b8494",
				row: "#161d28"
			} : {
				bg: "#ffffff",
				line: "#e3e6ea",
				primary: "#14181f",
				secondary: "#4b5563",
				tertiary: "#6b7280",
				row: "#f1f5fc"
			};
		}
		/** The file name of an export: the repository's own directory name. */
		function sidebarTabExportName(root) {
			const text = String(root === void 0 || root === null ? "graph" : root).replace(/[\\/]+$/, "");
			const base = text.split(/[\\/]/).pop();
			const safe = String(base === void 0 || base === "" ? "graph" : base).replace(/[^A-Za-z0-9._-]+/g, "-");
			return "git-graph-" + safe + ".svg";
		}
		/**
		 * Serialise the current graph into a standalone SVG document: explicit
		 * colors (no CSS variables), explicit width and height, the theme
		 * background, the lane canvas and one text block per visible commit.
		 * A picture is what gets pasted into a pull request or an issue, so the
		 * file has to open on its own, without the panel or its stylesheet.
		 * @param options - view, repo, commits (visible, newest first), lanes,
		 *   geometry, rowHeight, dark, t, refLabels (ref -> chip label) and
		 *   generatedAt.
		 * @returns the SVG markup.
		 */
		function sidebarTabExportSvg(options) {
			const view = options.view;
			const repo = options.repo === void 0 ? null : options.repo;
			const commits = Array.isArray(options.commits) ? options.commits : [];
			const geometry = options.geometry === void 0 ? null : options.geometry;
			const t = options.t;
			const palette = sidebarTabExportPalette(options.dark === true);
			const esc = sidebarTabXmlEscape;
			// Exactly the pitch the lane geometry was built with, otherwise the nodes drift
			// away from their rows as soon as the panel is zoomed.
			const rowHeight = Math.max(24, Math.min(72, Math.round(typeof options.rowHeight === "number" ? options.rowHeight : SIDEBAR_TAB_ROW_H)));
			const graphWidth = Math.max(24, Math.round(geometry === null ? 24 : geometry.width));
			const pad = SIDEBAR_TAB_EXPORT_PAD;
			const labelX = pad + graphWidth + 12;
			const oidWidth = 54;
			const subjectX = labelX + oidWidth + 8;
			const metaWidth = 210;
			let longest = 0;
			for (const commit of commits) longest = Math.max(longest, String(commit.subject).length);
			const width = Math.max(SIDEBAR_TAB_EXPORT_WIDTH_MIN, Math.min(SIDEBAR_TAB_EXPORT_WIDTH_MAX, Math.round(subjectX + longest * 6.6 + metaWidth)));
			const head = SIDEBAR_TAB_EXPORT_HEAD;
			const height = head + commits.length * rowHeight + SIDEBAR_TAB_EXPORT_FOOT;
			const branch = view !== null && typeof view.branch === "string" ? view.branch : "";
			const root = repo !== null && typeof repo.root === "string" ? repo.root : view !== null && typeof view.root === "string" ? view.root : "";
			const label = repo !== null ? sidebarTabRepoLabel(repo) : String(root).split(/[\\/]/).pop();
			const stamped = sidebarTabIsoTime(Math.floor((typeof options.generatedAt === "number" ? options.generatedAt : Date.now()) / 1000));
			const heading = (label === "" || label === void 0 || label === null ? "graph" : label) + (branch === "" ? "" : "  ·  " + branch);
			const out = [];
			out.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '" font-family="' + SIDEBAR_TAB_EXPORT_FONT + '" role="img">');
			out.push("<title>" + esc(heading) + "</title>");
			out.push('<rect x="0" y="0" width="' + width + '" height="' + height + '" fill="' + palette.bg + '"/>');
			out.push('<text x="' + pad + '" y="27" fill="' + palette.primary + '" font-size="15" font-weight="600">' + esc(heading) + "</text>");
			out.push('<text x="' + (width - pad) + '" y="27" text-anchor="end" fill="' + palette.secondary + '" font-size="11">' + esc(sidebarTabInterpolate(t("sidebar.commitsLanes"), { count: commits.length, lanes: geometry === null ? 1 : geometry.laneCount })) + "</text>");
			if (repo !== null && typeof repo.path === "string") out.push('<text x="' + pad + '" y="45" fill="' + palette.tertiary + '" font-size="11" font-family="' + SIDEBAR_TAB_EXPORT_MONO + '">' + esc(repo.path) + "</text>");
			out.push('<text x="' + (width - pad) + '" y="45" text-anchor="end" fill="' + palette.tertiary + '" font-size="11">' + esc(stamped) + "</text>");
			out.push('<line x1="' + pad + '" y1="' + (head - 10) + '" x2="' + (width - pad) + '" y2="' + (head - 10) + '" stroke="' + palette.line + '" stroke-width="1"/>');
			if (geometry !== null) {
				out.push('<g transform="translate(0 ' + head + ')">');
				for (const segment of geometry.segments) out.push('<path d="' + segment.d + '" fill="none" stroke="' + segment.color + '" stroke-width="' + segment.width + '" stroke-opacity="' + segment.opacity + '" stroke-linecap="round"/>');
				for (const node of geometry.nodes) {
					if (node.merge === true) out.push('<rect x="' + (node.x - 4.2) + '" y="' + (node.y - 4.2) + '" width="8.4" height="8.4" rx="1.4" fill="' + node.color + '" stroke="' + palette.bg + '" stroke-width="1.4" transform="rotate(45 ' + node.x + ' ' + node.y + ')"/>');
					else out.push('<circle cx="' + node.x + '" cy="' + node.y + '" r="3.6" fill="' + node.color + '" stroke="' + palette.bg + '" stroke-width="1.4"/>');
				}
				out.push("</g>");
			}
			out.push('<line x1="' + (pad + graphWidth + 6) + '" y1="' + head + '" x2="' + (pad + graphWidth + 6) + '" y2="' + (head + commits.length * rowHeight) + '" stroke="' + palette.line + '" stroke-width="1"/>');
			for (let position = 0; position < commits.length; position += 1) {
				const commit = commits[position];
				const top = head + position * rowHeight;
				const mid = top + rowHeight / 2;
				const pinned = options.pinned !== void 0 && options.pinned === commit.oid;
				out.push('<g data-gitgraph-export-row="' + position + '"' + (pinned ? ' data-gitgraph-export-pinned="true"' : "") + ">");
				if (pinned) out.push('<rect x="' + (pad - 4) + '" y="' + top + '" width="' + (width - pad * 2 + 8) + '" height="' + rowHeight + '" rx="6" fill="' + palette.row + '"/>');
				out.push('<line x1="' + (labelX - 6) + '" y1="' + (head + (position + 1) * rowHeight) + '" x2="' + (width - pad) + '" y2="' + (head + (position + 1) * rowHeight) + '" stroke="' + palette.line + '" stroke-width="0.6" stroke-opacity="0.55"/>');
				out.push('<text x="' + labelX + '" y="' + Math.round(mid + 4) + '" fill="' + palette.tertiary + '" font-size="11" font-family="' + SIDEBAR_TAB_EXPORT_MONO + '">' + esc(String(commit.oid).slice(0, 7)) + "</text>");
				const subjectRoom = Math.max(12, Math.floor((width - pad - subjectX - 16) / 6.6));
				const subjectText = String(commit.subject).length > subjectRoom ? String(commit.subject).slice(0, Math.max(1, subjectRoom - 1)) + "…" : commit.subject;
				out.push('<text x="' + subjectX + '" y="' + Math.round(mid - 1) + '" fill="' + palette.primary + '" font-size="12.5">' + esc(subjectText) + "</text>");
				// Same labels as the chips: an alias becomes its branch, a remote twin
				// folds into the local branch, so the exported picture reads like the panel.
				const labels = options.refLabels === void 0 ? null : options.refLabels;
				const refs = [];
				for (const raw of Array.isArray(commit.refs) ? commit.refs : []) {
					const text = String(raw);
					if (text.indexOf("HEAD -> ") === 0) {
						if (labels === null) continue;
						const label = text.slice("HEAD -> ".length);
						if (refs.indexOf(label) < 0) refs.push(label);
						continue;
					}
					const mapped = labels === null ? void 0 : labels.get(raw);
					const label = mapped === void 0 ? raw : mapped;
					if (refs.indexOf(label) < 0) refs.push(label);
				}
				const shown = refs.slice(0, SIDEBAR_TAB_EXPORT_REF_MAX);
				if (refs.length > shown.length) shown.push("+" + (refs.length - shown.length));
				let meta = esc(commit.author);
				if (shown.length > 0) {
					const dots = '<tspan fill="' + palette.tertiary + '">  ·  </tspan>';
					meta = shown.map((ref) => '<tspan fill="' + (String(ref) === branch ? palette.accent : palette.secondary) + '" font-weight="' + (String(ref) === branch ? "600" : "400") + '">' + esc(ref) + "</tspan>").join(dots);
					meta += '<tspan fill="' + palette.tertiary + '">   — ' + esc(commit.author) + "</tspan>";
				}
				out.push('<text x="' + subjectX + '" y="' + Math.round(mid + 11) + '" fill="' + palette.secondary + '" font-size="10">' + meta + "</text>");
				out.push('<text x="' + (width - pad) + '" y="' + Math.round(mid + 11) + '" text-anchor="end" fill="' + palette.tertiary + '" font-size="10">' + esc(sidebarTabIsoTime(commit.authorTime)) + "</text>");
				out.push("</g>");
			}
			out.push('<text x="' + pad + '" y="' + (height - 9) + '" fill="' + palette.tertiary + '" font-size="10">' + esc(t("sidebar.exportNote")) + "</text>");
			out.push('<text x="' + (width - pad) + '" y="' + (height - 9) + '" text-anchor="end" fill="' + palette.tertiary + '" font-size="10">github.com/Athosoo/dsh-git-graph-sidebar</text>');
			out.push("</svg>");
			return out.join("\n");
		}
		/**
		 * Save one SVG string. A browser gets a real download through a Blob URL;
		 * wherever that is unavailable (the offline preview harness, a webview
		 * without object URLs) the markup is copied instead, so the action always
		 * produces something the user can use.
		 * @returns "download", "copy" or "failed".
		 */
		function sidebarTabSaveSvg(filename, svg) {
			try {
				const canBlob = typeof Blob !== "undefined" && typeof URL !== "undefined" && URL !== null && typeof URL.createObjectURL === "function";
				const body = typeof document === "undefined" ? void 0 : document.body ?? document.documentElement;
				if (canBlob && body !== void 0 && body !== null && typeof document.createElement === "function") {
					const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
					const anchor = document.createElement("a");
					anchor.href = url;
					anchor.download = filename;
					anchor.setAttribute("rel", "noopener");
					anchor.style.display = "none";
					body.appendChild(anchor);
					anchor.click();
					anchor.remove();
					setTimeout(() => {
						try {
							URL.revokeObjectURL(url);
						} catch {}
					}, 1000);
					return "download";
				}
			} catch {}
			return sidebarTabCopy(svg) ? "copy" : "failed";
		}
		/**
		 * One commit as a plain-text block a person can paste into a chat with an
		 * agent: the repository it belongs to, the full object id, the subject,
		 * the author and time, the refs and the parents. That is exactly the
		 * context a "revert / roll back to this commit" request needs.
		 */
		function sidebarTabCommitText(commit, repo, t) {
			const lines = [];
			if (repo !== void 0 && repo !== null) {
				lines.push(t("sidebar.repoPath") + ": " + sidebarTabRepoLabel(repo));
				lines.push("Path: " + repo.path);
			}
			lines.push(t("sidebar.commit") + ": " + commit.oid);
			lines.push(t("sidebar.subject") + ": " + commit.subject);
			lines.push(t("sidebar.author") + ": " + commit.author);
			lines.push(t("sidebar.committedAt") + ": " + sidebarTabIsoTime(commit.authorTime));
			if (Array.isArray(commit.refs) && commit.refs.length > 0) lines.push(t("sidebar.references") + ": " + commit.refs.join(", "));
			if (Array.isArray(commit.parents) && commit.parents.length > 0) lines.push(t("sidebar.parentsLabel") + ": " + commit.parents.join(", "));
			return lines.join("\n");
		}
		/**
		 * The same commit, phrased as a request an agent can act on: which
		 * repository and branch, what to roll back to, and the three candidate
		 * commands with the risk of each. It is a prompt, not a script - nothing
		 * here executes anything, and the last line asks for confirmation.
		 */
		function sidebarTabRollbackText(commit, repo, branch, commitsAbove, t) {
			const short = String(commit.oid).slice(0, 7);
			const lines = [t("sidebar.rollbackIntro")];
			if (repo !== void 0 && repo !== null) {
				lines.push(t("sidebar.repoPath") + ": " + sidebarTabRepoLabel(repo));
				lines.push("Path: " + repo.path);
			}
			lines.push(t("sidebar.branch") + ": " + (typeof branch === "string" && branch !== "" ? branch : "\u2014"));
			lines.push(t("sidebar.commit") + ": " + short + " " + commit.subject);
			lines.push("SHA: " + commit.oid);
			lines.push(t("sidebar.committedAt") + ": " + sidebarTabIsoTime(commit.authorTime));
			if (Array.isArray(commit.refs) && commit.refs.length > 0) lines.push(t("sidebar.references") + ": " + commit.refs.join(", "));
			if (typeof commitsAbove === "number" && commitsAbove >= 0) lines.push(sidebarTabInterpolate(t("sidebar.rollbackAfter"), {
				count: commitsAbove
			}));
			lines.push(t("sidebar.rollbackOptions") + ":");
			lines.push("- git revert " + short + "  " + t("sidebar.rollbackSafe"));
			lines.push("- git reset --hard " + short + "  " + t("sidebar.rollbackHard"));
			lines.push("- git cherry-pick " + short + "  " + t("sidebar.rollbackPick"));
			lines.push(t("sidebar.rollbackConfirm"));
			return lines.join("\n");
		}
		/**
		 * Path of one parent edge, drawn the way desktop git clients (gitk,
		 * GitAhead, VS Code Git Graph, Fork) draw them: the line leaves the
		 * child node straight down, hops sideways inside the row gap directly
		 * below that node through two rounded corners, and then runs straight
		 * down the parent lane. No diagonal ever spans several rows, so two
		 * branches read as parallel rails with short, tidy hops.
		 * @param x1 - child lane x.
		 * @param y1 - child node y.
		 * @param x2 - parent lane x.
		 * @param y2 - parent node y (or the bottom edge when off-page).
		 * @param rowHeight - vertical pitch, used to size the hop.
		 * @returns an SVG path command string.
		 */
		function sidebarTabEdgePath(x1, y1, x2, y2, rowHeight) {
			if (x1 === x2) return "M" + x1 + " " + y1 + "V" + y2;
			const span = Math.abs(x2 - x1);
			// Two corners per hop, so the radius must fit inside half the span.
			const radius = Math.max(1.5, Math.min(6, SIDEBAR_TAB_LANE_W * 0.4, span / 2 - 0.1));
			// Keep the whole hop inside the gap under the child node; a node sits
			// at the middle of its row, so half a row remains below it.
			const available = Math.max(0, y2 - y1);
			const drop = Math.min(radius + 2, Math.max(2, available * 0.18));
			const turnY = y1 + drop;
			const midY = turnY + radius;
			const landY = midY + radius;
			if (landY >= y2) return "M" + x1 + " " + y1 + "V" + y2;
			const direction = x2 > x1 ? 1 : -1;
			const afterX = x1 + direction * radius;
			const innerX = x2 - direction * radius;
			return "M" + x1 + " " + y1 + "V" + turnY +
				"Q" + x1 + " " + midY + " " + afterX + " " + midY +
				"H" + innerX +
				"Q" + x2 + " " + midY + " " + x2 + " " + landY +
				"V" + y2;
		}
		/**
		 * Turn the lane table into drawable geometry: one node per commit and
		 * one edge per parent link. A parent outside the loaded page is drawn
		 * as an edge leaving the bottom, so a partial page still reads as a
		 * continuous graph instead of a cut-off one.
		 * @param commits - the graph page commits, newest first.
		 * @param lanes - the computeLanes rows of the same page.
		 * @param rowHeight - vertical pitch of one commit row.
		 * @returns width, height, nodes and edge segments in SVG space.
		 */
		function sidebarTabBuildGraph(commits, lanes, rowHeight) {
			const index = new Map();
			for (let position = 0; position < commits.length; position += 1) index.set(commits[position].oid, position);
			let laneCount = 1;
			for (const row of lanes) laneCount = Math.max(laneCount, row.columns.length);
			const padX = 7;
			const width = padX * 2 + Math.max(1, laneCount) * SIDEBAR_TAB_LANE_W;
			const height = Math.max(rowHeight, commits.length * rowHeight);
			const cyOf = (position) => position * rowHeight + rowHeight / 2;
			const cxOf = (lane) => padX + lane * SIDEBAR_TAB_LANE_W + 1;
			const nodes = [];
			const segments = [];
			for (let position = 0; position < commits.length; position += 1) {
				const commit = commits[position];
				const lane = lanes[position].nodeColumn;
				const fromX = cxOf(lane);
				const fromY = cyOf(position);
				nodes.push({
					key: "n" + position,
					x: fromX,
					y: fromY,
					color: sidebarTabLaneColor(lane),
					merge: lanes[position].merge === true
				});
				const parents = Array.isArray(commit.parents) ? commit.parents : [];
				for (let parentIndex = 0; parentIndex < parents.length; parentIndex += 1) {
					const parent = parents[parentIndex];
					const target = index.get(parent);
					const toLane = target === void 0 ? lane : lanes[target].nodeColumn;
					const toY = target === void 0 ? commits.length * rowHeight : cyOf(target);
					const toX = cxOf(toLane);
					segments.push({
						key: "e" + position + "-" + parentIndex,
						d: sidebarTabEdgePath(fromX, fromY, toX, toY, rowHeight),
						color: sidebarTabLaneColor(lane),
						opacity: parentIndex === 0 ? 0.95 : 0.72,
						width: parentIndex === 0 ? 1.8 : 1.6
					});
				}
			}
			return {
				width,
				height,
				nodes,
				segments,
				laneCount
			};
		}
		/** The localized name of one compliance reason code. */
		/**
		 * The better-sidebar tab body: scan the workspace for its repositories
		 * (the root repository first, then nested ones), let the user pick one,
		 * and draw that repository's branch state and commit graph as an SVG
		 * lane canvas with colored lanes, bezier merges, ref badges, per-commit
		 * zoom and a pinned commit card. Read-only by design: no branch
		 * switches, no worktree mutations.
		 * @param props - the better-sidebar TabComponentProps.
		 */
		/**
	 * Why this cache exists: better-sidebar unmounts a tab when it is closed, so
	 * a reopen used to start from zero and flash the empty state. Module scope
	 * is deliberate - the cache outlives the unmount, so the first frame of a
	 * reopened tab already has the repository list, the selection and the graph,
	 * and the work behind them is a quiet refresh instead of a reload.
	 */
	const SIDEBAR_TAB_CACHE = new Map();
	const SIDEBAR_TAB_CACHE_LIMIT = 6;
	/** The cache entry of one workspace directory, created on first use. */
	function sidebarTabCacheEntry(cwd) {
		let entry = SIDEBAR_TAB_CACHE.get(cwd);
		if (entry !== void 0) return entry;
		entry = {
			scan: void 0,
			selectedPath: void 0,
			rowHeight: void 0,
			treeOpen: void 0,
			viewByPath: new Map()
		};
		SIDEBAR_TAB_CACHE.set(cwd, entry);
		while (SIDEBAR_TAB_CACHE.size > SIDEBAR_TAB_CACHE_LIMIT) {
			const oldest = SIDEBAR_TAB_CACHE.keys().next();
			if (oldest.done === true) break;
			SIDEBAR_TAB_CACHE.delete(oldest.value);
		}
		return entry;
	}
	/** A cached field, or undefined when this tab never painted that workspace. */
	function sidebarTabCached(cwd, field) {
		if (cwd === void 0) return void 0;
		const entry = sidebarTabCacheEntry(cwd);
		return field === void 0 ? entry : entry[field];
	}
	/**
	 * The same graph as a main-area Conversation View. The sidebar tab stays the
	 * primary entry: this is opt-in, and the close button turns the opt-in off so
	 * the View leaves the tab bar instead of lingering empty.
	 */
	function GitGraphMainView(props) {
		const ctx = props !== void 0 && props !== null ? props.ctx : void 0;
		const scope = props !== void 0 && props !== null && props.scope !== void 0 && props.scope !== null ? props.scope : {};
		return react.createElement("div", {
			"data-gitgraph-main-view": true,
			style: SIDEBAR_TAB_MAIN_VIEW
		}, react.createElement(GitGraphSidebarTab, {
			ctx,
			scope,
			visible: true,
			mainView: true
		}), react.createElement("button", {
			type: "button",
			"data-gitgraph-action": "main-view-close",
			style: SIDEBAR_TAB_MAIN_VIEW_CLOSE,
			onClick: () => sidebarTabSetMainView(false),
			title: sidebarTabT(ctx, "sidebar.mainViewClose"),
			"aria-label": sidebarTabT(ctx, "sidebar.mainViewClose")
		}, "×"));
	}
	function GitGraphSidebarTab(props) {
			sidebarTabEnsureStyle();
			const ctx = props.ctx;
			const scope = props.scope !== void 0 && props.scope !== null ? props.scope : {};
			const tab = props.tab;
			const inMainView = props.mainView === true;
			const active = props.visible !== false;
			const t = react.useCallback((key, params) => sidebarTabT(ctx, key, params), [ctx]);
			const [, setLocaleTick] = react.useState(0);
			react.useEffect(() => {
				const service = ctx !== void 0 && ctx !== null ? ctx.locale : void 0;
				if (service === void 0 || service === null || typeof service.subscribe !== "function") return void 0;
				const dispose = service.subscribe(() => setLocaleTick((tick) => tick + 1));
				return typeof dispose === "function" ? dispose : void 0;
			}, [ctx]);
			/**
			 * The session's workspace directory: the scope value wins, then the
			 * sessions baseline the registration captured.
			 */
			const sessionCwd = react.useMemo(() => {
				if (typeof scope.cwd === "string" && scope.cwd !== "") return scope.cwd;
				const sessionId = scope.sessionId;
				const sessions = sidebarTabSessions;
				if (typeof sessionId !== "string" || sessions === void 0 || sessions === null) return void 0;
				try {
					const snapshot = sessions.list.getSnapshot();
					const session = snapshot.byId !== void 0 ? snapshot.byId[sessionId] : void 0;
					const cwd = session !== void 0 ? session.cwd : void 0;
					return typeof cwd === "string" && cwd !== "" ? cwd : void 0;
				} catch {
					return void 0;
				}
			}, [scope.cwd, scope.sessionId]);
			/** What this workspace looked like the last time the tab was open. */
			const restore = sidebarTabCached(sessionCwd);
			const restorePath = (() => {
				const meta = tab !== void 0 && tab !== null ? tab.meta : void 0;
				if (meta !== void 0 && meta !== null && typeof meta.repoPath === "string") return meta.repoPath;
				return restore !== void 0 && typeof restore.selectedPath === "string" ? restore.selectedPath : void 0;
			})();
			/** The scan view: idle before the first run, then scanning/ready/error. */
			const [scan, setScan] = react.useState(() => {
				const cached = sidebarTabCached(sessionCwd, "scan");
				return cached !== void 0 ? cached : { phase: "idle" };
			});
			const [selectedPath, setSelectedPath] = react.useState(restorePath);
			/** The graph view of the selected repository (null before the first load). */
			const [graph, setGraph] = react.useState(() => {
				if (restore === void 0 || restorePath === void 0) return null;
				const cached = restore.viewByPath.get(restorePath);
				return cached !== void 0 ? { view: cached, error: null, loading: false } : null;
			});
			/** Vertical pitch of the graph rows (the zoom control). */
			const [rowHeight, setRowHeight] = react.useState(() => {
				const cached = sidebarTabCached(sessionCwd, "rowHeight");
				return typeof cached === "number" ? cached : SIDEBAR_TAB_ROW_H;
			});
			/** True while this mount still shows a cached graph (its first load is silent). */
			const warmGraph = react.useRef(graph !== null && graph.view !== null);
			/** The commit whose card is currently pinned, by full oid. */
			const [pinnedOid, setPinnedOid] = react.useState(void 0);
			/** Whether the repository tree (level relationships) is expanded. */
			const [treeOpen, setTreeOpen] = react.useState(() => {
				const cached = sidebarTabCached(sessionCwd, "treeOpen");
				return typeof cached === "boolean" ? cached : true;
			});
			/**
			 * The linked worktree the panel describes: undefined means the selected
			 * repository's main checkout (the repository row itself). A worktree only
			 * changes which checkout is read, never which graph is drawn: checkouts of
			 * one repository share its refs and object database.
			 */
			const [worktreePath, setWorktreePath] = react.useState(void 0);
			/** The linked worktrees of the selected repository, loaded on selection. */
			const [worktrees, setWorktrees] = react.useState({
				phase: "idle",
				root: void 0,
				list: [],
				count: 0,
				error: null
			});
			/** The status of the selected linked worktree (the row keeps the main one). */
			const [worktreeStatus, setWorktreeStatus] = react.useState(null);
			const worktreeSeq = react.useRef(0);
			const worktreeStatusSeq = react.useRef(0);
			/** A worktree jump is in flight, so the buttons say so. */
			const [worktreeBusy, setWorktreeBusy] = react.useState(false);
			/** A failed worktree read, shown with the worktree rows. */
			const [worktreeNotice, setWorktreeNotice] = react.useState(null);
			/** Free-text filter over the loaded commits (subject, author, sha, refs). */
			const [query, setQuery] = react.useState("");
			/** Refs whose commits are hidden; name -> true. */
			const [mutedRefs, setMutedRefs] = react.useState(() => ({}));
			const [refsExpanded, setRefsExpanded] = react.useState(false);
			/** Which copy action ran last, so its button can flash "copied". */
			const [copiedKey, setCopiedKey] = react.useState(void 0);
			/** Remember one copy action for a moment, then clear the label. */
			const copyText = react.useCallback((key, text) => {
				setCopiedKey(sidebarTabCopy(text) ? key : void 0);
			}, []);
			react.useEffect(() => {
				if (copiedKey === void 0) return void 0;
				const timer = setTimeout(() => setCopiedKey(void 0), 1600);
				return () => clearTimeout(timer);
			}, [copiedKey]);
			/** Which export path ran last ("download"/"copy"), so the button can confirm. */
			const [exportState, setExportState] = react.useState(void 0);
			react.useEffect(() => {
				if (exportState === void 0) return void 0;
				const timer = setTimeout(() => setExportState(void 0), 2200);
				return () => clearTimeout(timer);
			}, [exportState]);
			/** The proven convention frameworks, loaded from the host on demand. */
			const [catalog, setCatalog] = react.useState(null);
			/** Whether the framework picker is open under the conventions strip. */
			const [pickerOpen, setPickerOpen] = react.useState(false);
			/** Whether the template settings page replaces the tab content. */
			const [settingsOpen, setSettingsOpen] = react.useState(false);
			/** The user's own templates as read from the host; null while loading. */
			const [templates, setTemplates] = react.useState(null);
			/** Where the template store lives, for the page footer. */
			const [templateStore, setTemplateStore] = react.useState(null);
			/** The template being edited; null shows the list instead. */
			const [templateDraft, setTemplateDraft] = react.useState(null);
			/** True while the draft is new, so its id stays editable. */
			const [templateCreating, setTemplateCreating] = react.useState(false);
			/** A delete waiting for its second click, by template id. */
			const [templateDeleteId, setTemplateDeleteId] = react.useState(void 0);
			/** A template read or write in flight. */
			const [templateBusy, setTemplateBusy] = react.useState(false);
			/** The last failed template action, shown on the page. */
			const [templateError, setTemplateError] = react.useState(null);
			/** The built-in frameworks with their show/hide preference; null while loading. */
			const [builtinTemplates, setBuiltinTemplates] = react.useState(null);
			/** The last successful save or delete, shown until the next action. */
			const [templateNotice, setTemplateNotice] = react.useState(null);
			/** The picker's strict switch: rules become enforced policy, not advice. */
			const [strictMode, setStrictMode] = react.useState(false);
			/** The subject language the document asks for: zh, en or mixed. */
			const [conventionLang, setConventionLang] = react.useState("mixed");
			/** The AI-attribution policy the document states: required, optional or forbidden. */
			const [conventionAi, setConventionAi] = react.useState("optional");
			/** Where the documents that govern this repository disagree, as read from the host. */
			const [conflicts, setConflicts] = react.useState(null);
			/** Whether the graph also opens as a main-area View (opt-in, persisted). */
			const [mainViewOpen, setMainViewOpen] = react.useState(() => sidebarTabMainViewEnabled());
			/** Follow the flag: the sidebar button and the View's close button both write it. */
			react.useEffect(() => sidebarTabMainViewSubscribe(() => setMainViewOpen(sidebarTabMainViewEnabled())), []);
			/** The pending consolidation: a dry-run plan, written only on confirm. */
			/** Whether a convention document is being written right now. */
			const [conventionBusy, setConventionBusy] = react.useState(false);
			/** The last successful write, so the strip can confirm it. */
			const [conventionNotice, setConventionNotice] = react.useState(null);
			/** The last failed read/write, shown instead of the hint. */
			const [conventionError, setConventionError] = react.useState(null);
			/** The last compliance read for the selected repository, if any. */
			const [compliance, setCompliance] = react.useState(null);
			/** The pending framework upgrade: a read-only diff, written on confirm. */
			const [upgrade, setUpgrade] = react.useState(null);
			/** The workspace document write in flight. */
			const [workspaceBusy, setWorkspaceBusy] = react.useState(false);
			/** The workspace-level document, read once per workspace. */
			const [workspaceDoc, setWorkspaceDoc] = react.useState(null);
			/** Set for a few seconds after a write, so the strip says what happened. */
			const [workspaceNote, setWorkspaceNote] = react.useState(false);
			/** A failed write has nowhere else to be reported: the workspace strip shows it. */
			const [workspaceError, setWorkspaceError] = react.useState(null);
			/** Repositories the auto-scaffold already ran for (once per session). */
			const autoScaffolded = react.useRef(new Set());
			const graphSeq = react.useRef(0);
			/** The row count the graph is showing, so a silent reload keeps it. */
			const graphLimitRef = react.useRef(INITIAL_LIMIT);
			/** A scan is in flight (the refresh button says so; nothing else moves). */
			const [refreshing, setRefreshing] = react.useState(false);
			/** One-click repository initialization for a folder that is not one yet. */
			const [initOpen, setInitOpen] = react.useState(false);
			const [initBranch, setInitBranch] = react.useState(() => SIDEBAR_TAB_INIT_BRANCHES[0]);
			const [initBusy, setInitBusy] = react.useState(false);
			const [initError, setInitError] = react.useState(null);
			/** Keep the last painted state for the next mount (see SIDEBAR_TAB_CACHE). */
			react.useEffect(() => {
				if (sessionCwd === void 0) return;
				const entry = sidebarTabCacheEntry(sessionCwd);
				entry.scan = scan;
				entry.selectedPath = selectedPath;
				entry.rowHeight = rowHeight;
				entry.treeOpen = treeOpen;
				if (selectedPath !== void 0 && graph !== null && graph.view !== null) entry.viewByPath.set(selectedPath, graph.view);
			}, [sessionCwd, scan, selectedPath, rowHeight, treeOpen, graph]);
			/**
			 * Load the repository list. `silent` is the background path: it never
			 * clears what is on screen, it drops a result identical to the current
			 * one (no re-render, no scroll jump) and it does not report transient
			 * failures over data the panel already has.
			 */
			const runScan = react.useCallback((refresh, silent) => {
				const quiet = silent === true;
				if (sessionCwd === void 0) {
					setScan(current => current.phase === "ready" ? current : {
						phase: "error",
						error: t("error.workspaceUnknown")
					});
					return;
				}
				if (!quiet) setRefreshing(true);
				if (!quiet) setScan(current => current.phase === "ready" ? current : { phase: "scanning" });
				const done = () => {
					if (!quiet) setRefreshing(false);
				};
				sidebarTabGit().repos(sessionCwd, refresh).then((result) => {
					if (!result.ok || result.value === null) {
						setScan(current => current.phase === "ready" ? current : {
							phase: "error",
							error: t("sidebar.error.repos")
						});
						done();
						return;
					}
					const value = result.value;
					const repos = Array.isArray(value.repos) ? value.repos : [];
					const meta = value.conventions !== void 0 && value.conventions !== null ? value.conventions : {};
					const next = {
						phase: "ready",
						repos,
						truncated: value.truncated === true,
						autoScaffold: meta.autoScaffold === true,
						docName: typeof meta.doc === "string" ? meta.doc : "GIT_CONVENTIONS.md"
					};
					setScan(current => sidebarTabSameScan(current, next) ? current : next);
					setSelectedPath((current) => {
						if (typeof current === "string" && repos.some((entry) => entry.path === current)) return current;
						return repos.length > 0 ? repos[0].path : void 0;
					});
					done();
				}).catch(() => {
					setScan(current => current.phase === "ready" ? current : {
						phase: "error",
						error: t("sidebar.error.repos")
					});
					done();
				});
			}, [sessionCwd, t]);
			const scannedFor = react.useRef();
			react.useEffect(() => {
				if (!active) return;
				if (scannedFor.current === sessionCwd) return;
				scannedFor.current = sessionCwd;
				runScan(false, sidebarTabCached(sessionCwd, "scan") !== void 0);
			}, [active, sessionCwd, runScan]);
			const selected = react.useMemo(() => {
				if (scan.phase !== "ready") return void 0;
				return scan.repos.find((entry) => entry.path === selectedPath);
			}, [scan, selectedPath]);
			/**
			 * Load the commit graph of the selected repository. A silent reload
			 * keeps the current rows on screen until an actually different graph
			 * arrives, so live updates never blank the panel or reset the scroll.
			 */
			const loadGraph = react.useCallback((limit, silent) => {
				if (selected === void 0) return;
				const wanted = typeof limit === "number" && limit > 0 ? limit : graphLimitRef.current;
				graphLimitRef.current = wanted;
				const quiet = silent === true;
				const seq = graphSeq.current + 1;
				graphSeq.current = seq;
				if (!quiet) setGraph((current) => ({
					view: current !== null ? current.view : null,
					error: null,
					loading: true
				}));
				sidebarTabGit().graph(selected.path, wanted).then((result) => {
					if (seq !== graphSeq.current) return;
					if (!result.ok || result.value === null) {
						setGraph((current) => {
							if (quiet && current !== null && current.view !== null) return current;
							return {
								view: null,
								error: !result.ok ? t("sidebar.error.graph") : t("error.internal"),
								loading: false
							};
						});
						return;
					}
					const value = result.value;
					setGraph((current) => sidebarTabSameGraph(current !== null ? current.view : null, value) ? Object.assign({}, current, { loading: false, error: null }) : {
						view: value,
						error: null,
						loading: false
					});
				}).catch(() => {
					if (seq !== graphSeq.current) return;
					setGraph((current) => {
						if (quiet && current !== null && current.view !== null) return current;
						return {
							view: null,
							error: t("sidebar.error.graph"),
							loading: false
						};
					});
				});
			}, [selected, t]);
			/**
			 * Load the linked worktrees of the selected repository. One read per
			 * selection plus the quiet refreshes the change stream triggers; the list
			 * is the only source of the checkout rows the panel offers.
			 */
			const loadWorktrees = react.useCallback((silent) => {
				if (selected === void 0) {
					setWorktrees({
						phase: "idle",
						root: void 0,
						list: [],
						count: 0,
						error: null
					});
					return;
				}
				const root = selected.path;
				const seq = worktreeSeq.current + 1;
				worktreeSeq.current = seq;
				if (silent !== true) setWorktrees((current) => current.root === root && current.phase === "ready" ? current : {
					phase: "loading",
					root,
					list: current.root === root ? current.list : [],
					count: current.root === root ? current.count : 0,
					error: null
				});
				const git = sidebarTabGit();
				if (typeof git.worktreeList !== "function") {
					setWorktrees({
						phase: "error",
						root,
						list: [],
						count: 0,
						error: t("sidebar.worktreeError")
					});
					return;
				}
				git.worktreeList(root).then((result) => {
					if (seq !== worktreeSeq.current) return;
					if (!result.ok || result.value === null) {
						setWorktrees((current) => silent === true && current.root === root && current.phase === "ready" ? current : {
							phase: "error",
							root,
							list: current.root === root ? current.list : [],
							count: current.root === root ? current.count : 0,
							error: result.ok ? t("error.internal") : t("sidebar.worktreeError")
						});
						return;
					}
					const value = result.value;
					const list = Array.isArray(value.worktrees) ? value.worktrees : [];
					const next = {
						phase: "ready",
						root,
						list,
						count: list.length,
						error: null
					};
					setWorktrees((current) => sidebarTabSameWorktrees(current, next) ? current : next);
					/** A checkout that was pruned or moved falls back to the repository row. */
					setWorktreePath((current) => {
						if (current === void 0) return current;
						return list.some((entry) => entry.path === current) ? current : void 0;
					});
				}).catch(() => {
					if (seq !== worktreeSeq.current) return;
					setWorktrees((current) => silent === true && current.root === root && current.phase === "ready" ? current : {
						phase: "error",
						root,
						list: current.root === root ? current.list : [],
						count: current.root === root ? current.count : 0,
						error: t("sidebar.worktreeError")
					});
				});
			}, [selected, t]);
			/**
			 * Load the status of the selected linked worktree. The main checkout never
			 * asks: its status already arrived with the repository scan.
			 */
			const loadWorktreeStatus = react.useCallback((silent) => {
				const root = selected !== void 0 ? selected.path : void 0;
				const target = worktreePath;
				if (root === void 0 || target === void 0) {
					worktreeStatusSeq.current += 1;
					setWorktreeStatus(null);
					return;
				}
				const git = sidebarTabGit();
				if (typeof git.worktreeStatus !== "function") {
					setWorktreeStatus({
						path: target,
						phase: "error",
						value: null,
						error: t("sidebar.worktreeError")
					});
					return;
				}
				const seq = worktreeStatusSeq.current + 1;
				worktreeStatusSeq.current = seq;
				if (silent !== true) setWorktreeStatus((current) => current !== null && current.path === target ? current : {
					path: target,
					phase: "loading",
					value: null,
					error: null
				});
				git.worktreeStatus(root, target).then((result) => {
					if (seq !== worktreeStatusSeq.current) return;
					if (!result.ok || result.value === null) {
						const code = !result.ok && result.error !== void 0 && result.error !== null ? String(result.error.code) : "";
						const message = code === "worktree-not-found" ? t("sidebar.worktreeMissing") : code === "workspace-unknown" ? t("sidebar.worktreeUnregistered") : t("sidebar.worktreeError");
						setWorktreeStatus((current) => silent === true && current !== null && current.path === target && current.phase === "ready" ? current : {
							path: target,
							phase: "error",
							value: current !== null && current.path === target ? current.value : null,
							error: message
						});
						return;
					}
					const value = result.value;
					setWorktreeStatus((current) => current !== null && current.path === target && current.phase === "ready" && JSON.stringify(current.value) === JSON.stringify(value) ? current : {
						path: target,
						phase: "ready",
						value,
						error: null
					});
				}).catch(() => {
					if (seq !== worktreeStatusSeq.current) return;
					setWorktreeStatus((current) => silent === true && current !== null && current.path === target && current.phase === "ready" ? current : {
						path: target,
						phase: "error",
						value: current !== null && current.path === target ? current.value : null,
						error: t("sidebar.worktreeError")
					});
				});
			}, [selected, worktreePath, t]);
			/** Another repository selected: the worktree rows start over. */
			react.useEffect(() => {
				setWorktreePath(void 0);
				setWorktreeNotice(null);
			}, [selectedPath]);
			/** Load the linked worktrees when this tab starts describing a repository. */
			react.useEffect(() => {
				if (!active) return;
				if (selected === void 0) return;
				loadWorktrees(false);
			}, [active, selected, loadWorktrees]);
			/** Load the selected worktree's status (identical refreshes are dropped). */
			react.useEffect(() => {
				if (!active) return;
				loadWorktreeStatus(false);
			}, [active, loadWorktreeStatus]);
			/** Where the workspaces registry already points, matched on folded paths. */
			const workspaceAt = (path) => {
				const registry = sidebarTabWorkspaces;
				if (registry === void 0 || registry === null || registry.list === void 0 || registry.list === null || typeof registry.list.getSnapshot !== "function") return void 0;
				try {
					const snapshot = registry.list.getSnapshot();
					const items = snapshot !== void 0 && snapshot !== null && Array.isArray(snapshot.items) ? snapshot.items : [];
					const key = sidebarTabPathKey(path);
					return items.find((item) => typeof item.path === "string" && sidebarTabPathKey(item.path) === key);
				} catch {
					return void 0;
				}
			};
			/** Adopt one checkout as a workspace (read-only otherwise: no session). */
			const openWorktreeWorkspace = react.useCallback((target) => {
				const registry = sidebarTabWorkspaces;
				if (registry === void 0 || registry === null || typeof registry.create !== "function") {
					setWorktreeNotice(t("sidebar.worktreeUnregistered"));
					return;
				}
				setWorktreeNotice(null);
				setWorktreeBusy(true);
				Promise.resolve(registry.create({ path: target.path })).then(() => {
					setWorktreeBusy(false);
				}).catch(() => {
					setWorktreeBusy(false);
					setWorktreeNotice(t("sidebar.worktreeError"));
				});
			}, [t]);
			/**
			 * Open one checkout as a fresh session: adopt it as a workspace, then let
			 * the sessions face create the session and the workspace UI open it. The
			 * plugin's auto-isolation wraps `uiWorkspace.startSession`, so that entry
			 * is never used here: it would create a second worktree.
			 */
			const openWorktreeSession = react.useCallback((target) => {
				const registry = sidebarTabWorkspaces;
				const sessions = sidebarTabSessions;
				const ui = sidebarTabUiWorkspace;
				if (registry === void 0 || registry === null || typeof registry.create !== "function" || sessions === void 0 || sessions === null || typeof sessions.create !== "function" || ui === void 0 || ui === null || typeof ui.openSession !== "function") {
					setWorktreeNotice(t("sidebar.worktreeUnregistered"));
					return;
				}
				setWorktreeNotice(null);
				setWorktreeBusy(true);
				const existing = workspaceAt(target.path);
				Promise.resolve(existing !== void 0 ? existing : registry.create({ path: target.path })).then((workspace) => {
					if (workspace === void 0 || workspace === null || workspace.workspaceId === void 0) throw new Error("workspace");
					return sessions.create({ workspaceId: workspace.workspaceId });
				}).then((sessionId) => {
					setWorktreeBusy(false);
					if (typeof sessionId === "string" && sessionId !== "") ui.openSession(sessionId);
				}).catch(() => {
					setWorktreeBusy(false);
					setWorktreeNotice(t("sidebar.worktreeError"));
				});
			}, [t]);
			react.useEffect(() => {
				if (!active) return;
				if (selected === void 0) {
					setGraph(null);
					return;
				}
				if (warmGraph.current) {
					warmGraph.current = false;
					loadGraph(void 0, true);
					return;
				}
				graphLimitRef.current = INITIAL_LIMIT;
				loadGraph(INITIAL_LIMIT);
			}, [active, selected, loadGraph]);
			/** Drop the pinned card whenever another repository is selected. */
			react.useEffect(() => {
				setPinnedOid(void 0);
			}, [selectedPath]);
			/** Pick a repository and persist the choice on the tab (cross-reload). */
			const choose = (path) => {
				setSelectedPath(path);
				const sidebar = ctx !== void 0 && ctx !== null ? ctx.betterSidebar : void 0;
				if (sidebar === void 0 || sidebar === null || typeof sidebar.updateTab !== "function") return;
				/** The main-area View passes no tab, so the choice stays in local state there. */
				if (tab === void 0 || tab === null) return;
				try {
					const meta = tab !== void 0 && tab !== null && tab.meta !== void 0 && tab.meta !== null ? tab.meta : {};
					sidebar.updateTab(tab.id, { meta: Object.assign({}, meta, { repoPath: path }) }, scope.sessionId);
				} catch {}
			};
			/**
			 * One-click `git init` for the session directory. The host refuses when
			 * the directory already sits inside a repository, so this cannot re-root
			 * an existing checkout. Afterwards the scan is refreshed and the new
			 * repository is selected, which also triggers the scaffold and picker.
			 */
			const runInit = react.useCallback(() => {
				if (initBusy === true || sessionCwd === void 0) return;
				setInitBusy(true);
				setInitError(null);
				sidebarTabGit().initRepo(sessionCwd, initBranch).then((result) => {
					setInitBusy(false);
					if (!result.ok) {
						setInitError(result.error !== void 0 && result.error !== null && typeof result.error.message === "string" ? result.error.message : t("sidebar.error.init"));
						return;
					}
					setInitOpen(false);
					const created = result.value !== void 0 && result.value !== null && typeof result.value.root === "string" ? result.value.root : sessionCwd;
					setSelectedPath(created);
					runScan(true, true);
				}).catch(() => {
					setInitBusy(false);
					setInitError(t("sidebar.error.init"));
				});
			}, [initBranch, initBusy, runScan, sessionCwd, t]);
			/**
			 * Write a convention document into one repository: a framework
			 * template, or the empty scaffold when `frameworkId` is null.
			 */
			const writeConvention = react.useCallback((repoPath, frameworkId) => {
				setConventionBusy(true);
				setConventionError(null);
				return sidebarTabGit().conventionOptions(repoPath, frameworkId, true, strictMode, conventionLang, conventionAi).then((result) => {
					setConventionBusy(false);
					if (!result.ok) {
						setConventionError(result.error !== void 0 && result.error !== null && typeof result.error.message === "string" ? result.error.message : t("sidebar.error.conventions"));
						return false;
					}
					setConventionNotice(frameworkId === null ? "auto" : "applied");
					setPickerOpen(false);
					runScan(true);
					return true;
				}).catch(() => {
					setConventionBusy(false);
					setConventionError(t("sidebar.error.conventions"));
					return false;
				});
			}, [conventionAi, conventionLang, runScan, strictMode, t]);
			/** The selected repository's path, as an effect dependency. */
			const selectedKey = selected !== void 0 ? selected.path : void 0;
			/** The workspace whose shared document strip is shown, as a dependency. */
			const workspaceKey = sessionCwd;
			/**
			 * Choose a framework. With no document yet the template is written
			 * straight away, exactly like before; when one exists the host is asked
			 * for a read-only diff first, and nothing is written until the user
			 * confirms it. This is the Tier 3 upgrade preview.
			 */
			const pickFramework = react.useCallback((repoPath, frameworkId, exists) => {
				if (exists !== true) return writeConvention(repoPath, frameworkId);
				setPickerOpen(false);
				setUpgrade({
					phase: "loading",
					path: repoPath,
					framework: frameworkId
				});
				return sidebarTabGit().conventionPreview(repoPath, frameworkId, strictMode, conventionLang, conventionAi).then((result) => {
					if (!result.ok || result.value === null || result.value === void 0) {
						setUpgrade(null);
						setConventionError(result.error !== void 0 && result.error !== null && typeof result.error.message === "string" ? result.error.message : t("sidebar.error.conventions"));
						return false;
					}
					setUpgrade({
						phase: "ready",
						path: repoPath,
						framework: frameworkId,
						value: result.value
					});
					return true;
				}).catch(() => {
					setUpgrade(null);
					setConventionError(t("sidebar.error.conventions"));
					return false;
				});
			}, [conventionAi, conventionLang, strictMode, t, writeConvention]);
			/** Write the previewed framework, replacing the document on purpose. */
			const confirmUpgrade = react.useCallback(() => {
				if (upgrade === null || upgrade.phase !== "ready") return;
				const target = upgrade.framework;
				const repoPath = upgrade.path;
				setUpgrade(null);
				writeConvention(repoPath, target).then((ok) => {
					if (ok) setPickerOpen(false);
				});
			}, [upgrade, writeConvention]);
			/**
			 * The template settings page. Everything below manages the user's own
			 * templates, plus a show/hide switch per built-in: the built-ins are never
			 * editable or deletable, only hidden from the picker.
			 */
			/** Read the user's own convention templates from the host. */
			const loadTemplates = react.useCallback(() => {
				sidebarTabGit().conventionTemplates("list").then((result) => {
					if (!result.ok) {
						setTemplateError(result.error !== void 0 && result.error !== null && typeof result.error.message === "string" ? result.error.message : t("sidebar.templateError"));
						return;
					}
					const value = result.value !== null && result.value !== void 0 ? result.value : {};
					setTemplates(Array.isArray(value.templates) ? value.templates : []);
					setBuiltinTemplates(Array.isArray(value.builtins) ? value.builtins : []);
					setTemplateStore(typeof value.path === "string" ? value.path : null);
					setTemplateError(value.error !== void 0 && value.error !== null && typeof value.error.message === "string" ? value.error.message : null);
				}).catch(() => setTemplateError(t("sidebar.templateError")));
			}, [t]);
			/** Open the settings page and read the store on the way in. */
			const openSettings = react.useCallback(() => {
				setSettingsOpen(true);
				setTemplateDraft(null);
				setTemplateCreating(false);
				setTemplateDeleteId(void 0);
				setTemplateError(null);
				setTemplateNotice(null);
				loadTemplates();
			}, [loadTemplates]);
			const closeSettings = react.useCallback(() => {
				setSettingsOpen(false);
				setTemplateDraft(null);
				setTemplateCreating(false);
				setTemplateDeleteId(void 0);
			}, []);
			/** Re-read the catalogue so the picker shows a saved or deleted template. */
			const refreshCatalog = react.useCallback(() => {
				if (selectedKey === void 0) return;
				sidebarTabGit().conventions(selectedKey).then((result) => {
					if (!result.ok || result.value === null || result.value === void 0) return;
					setCatalog(Array.isArray(result.value.catalog) ? result.value.catalog : []);
				}).catch(() => void 0);
			}, [selectedKey]);
			const startTemplateCreate = react.useCallback(() => {
				setTemplateError(null);
				setTemplateNotice(null);
				setTemplateDeleteId(void 0);
				sidebarTabGit().conventionTemplates("starter").then((result) => {
					if (!result.ok) {
						setTemplateError(result.error !== void 0 && result.error !== null && typeof result.error.message === "string" ? result.error.message : t("sidebar.templateError"));
						return;
					}
					const value = result.value !== null && result.value !== void 0 ? result.value : {};
					setTemplateDraft({
						id: "",
						name: "",
						nameZh: "",
						tagline: "",
						taglineZh: "",
						bestFor: "",
						bestForZh: "",
						url: "",
						body: typeof value.body === "string" ? value.body : ""
					});
					setTemplateCreating(true);
				}).catch(() => setTemplateError(t("sidebar.templateError")));
			}, [t]);
			const startTemplateEdit = react.useCallback((id) => {
				setTemplateError(null);
				setTemplateNotice(null);
				setTemplateDeleteId(void 0);
				sidebarTabGit().conventionTemplates("get", { id }).then((result) => {
					if (!result.ok) {
						setTemplateError(result.error !== void 0 && result.error !== null && typeof result.error.message === "string" ? result.error.message : t("sidebar.templateError"));
						return;
					}
					const value = result.value !== null && result.value !== void 0 ? result.value : {};
					const text = (field) => typeof value[field] === "string" ? value[field] : "";
					setTemplateDraft({
						id: text("id") !== "" ? text("id") : id,
						name: text("name"),
						nameZh: text("nameZh"),
						tagline: text("tagline"),
						taglineZh: text("taglineZh"),
						bestFor: text("bestFor"),
						bestForZh: text("bestForZh"),
						url: text("url"),
						body: text("body")
					});
					setTemplateCreating(false);
				}).catch(() => setTemplateError(t("sidebar.templateError")));
			}, [t]);
			const updateTemplateDraft = react.useCallback((field, value) => {
				setTemplateDraft((current) => current === null ? current : Object.assign({}, current, { [field]: value }));
			}, []);
			const saveTemplate = react.useCallback(() => {
				const draft = templateDraft;
				if (draft === null || templateBusy === true) return;
				const trimmed = (field) => typeof draft[field] === "string" ? draft[field].trim() : "";
				const template = {};
				["id", "name", "nameZh", "tagline", "taglineZh", "bestFor", "bestForZh", "url"].forEach((field) => {
					const value = trimmed(field);
					if (value !== "") template[field] = value;
				});
				template.body = typeof draft.body === "string" ? draft.body : "";
				setTemplateBusy(true);
				setTemplateError(null);
				setTemplateNotice(null);
				sidebarTabGit().conventionTemplates("save", { template }).then((result) => {
					setTemplateBusy(false);
					if (!result.ok) {
						setTemplateError(result.error !== void 0 && result.error !== null && typeof result.error.message === "string" ? result.error.message : t("sidebar.templateError"));
						return;
					}
					setTemplateDraft(null);
					setTemplateCreating(false);
					setTemplateNotice(t("sidebar.templateSaved"));
					loadTemplates();
					refreshCatalog();
				}).catch(() => {
					setTemplateBusy(false);
					setTemplateError(t("sidebar.templateError"));
				});
			}, [templateDraft, templateBusy, loadTemplates, refreshCatalog, t]);
			const deleteTemplate = react.useCallback((id) => {
				if (templateDeleteId !== id) {
					setTemplateDeleteId(id);
					return;
				}
				setTemplateDeleteId(void 0);
				setTemplateBusy(true);
				setTemplateError(null);
				setTemplateNotice(null);
				sidebarTabGit().conventionTemplates("delete", { id }).then((result) => {
					setTemplateBusy(false);
					if (!result.ok) {
						setTemplateError(result.error !== void 0 && result.error !== null && typeof result.error.message === "string" ? result.error.message : t("sidebar.templateError"));
						return;
					}
					setTemplateNotice(t("sidebar.templateDeleted"));
					loadTemplates();
					refreshCatalog();
				}).catch(() => {
					setTemplateBusy(false);
					setTemplateError(t("sidebar.templateError"));
				});
			}, [templateDeleteId, templateBusy, loadTemplates, refreshCatalog, t]);
			/** Hide or show one built-in framework in the picker (never edits its body). */
			const toggleBuiltin = react.useCallback((id, hidden) => {
				if (templateBusy === true) return;
				setTemplateBusy(true);
				setTemplateError(null);
				setTemplateNotice(null);
				sidebarTabGit().conventionTemplates("toggle", {
					id,
					hidden
				}).then((result) => {
					setTemplateBusy(false);
					if (!result.ok) {
						setTemplateError(result.error !== void 0 && result.error !== null && typeof result.error.message === "string" ? result.error.message : t("sidebar.templateError"));
						return;
					}
					setTemplateNotice(hidden === true ? t("sidebar.builtinHidden") : t("sidebar.builtinShown"));
					loadTemplates();
					refreshCatalog();
				}).catch(() => {
					setTemplateBusy(false);
					setTemplateError(t("sidebar.templateError"));
				});
			}, [templateBusy, loadTemplates, refreshCatalog, t]);
			/**
			 * Hand the merge to the model. The agent reads every document itself and judges
			 * the duplicates, so the request is copied for the conversation.
			 */
			const requestAiMerge = react.useCallback(() => {
				const request = "请读出我工作区里所有 Git 规范文档（用你自己的文件工具读），逐段比较，找出冲突和重复的规范，把它们合并成一份完整的规范写进 .dsh/GIT_CONVENTIONS.md；覆盖之前把要被替换的文件各留一份 .bak-<时间戳> 副本，被并入的仓库文档改成指向工作区文档的指针（指针下面保留合并前原文）；写入之前先把合并稿给我看。";
				const nav = globalThis.navigator;
				const clipboard = nav === void 0 || nav === null ? void 0 : nav.clipboard;
				if (clipboard !== void 0 && clipboard !== null && typeof clipboard.writeText === "function") {
					try {
						clipboard.writeText(request);
					} catch (error) {
						void error;
					}
				}
				setConventionNotice("ai");
				return true;
			}, []);
			/** Read the workspace document once per scan, so the strip stays honest. */
			react.useEffect(() => {
				if (workspaceKey === void 0) return void 0;
				let alive = true;
				sidebarTabGit().workspaceConvention(workspaceKey, {
					action: "state"
				}).then((result) => {
					if (!alive || !result.ok || result.value === null || result.value === void 0) return;
					setWorkspaceDoc(result.value);
				}).catch(() => void 0);
				return () => {
					alive = false;
				};
			}, [workspaceKey, scan]);
			/** Write the shared document of the workspace the session lives in. */
			const writeWorkspaceDoc = react.useCallback(() => {
				if (workspaceBusy === true || workspaceKey === void 0) return;
				setWorkspaceBusy(true);
				setConventionError(null);
				setWorkspaceError(null);
				sidebarTabGit().workspaceConvention(workspaceKey, {
					action: "write",
					strict: strictMode,
					language: conventionLang,
					ai: conventionAi
				}).then((result) => {
					setWorkspaceBusy(false);
					if (!result.ok || result.value === null || result.value === void 0) {
						setWorkspaceError(result.error !== void 0 && result.error !== null && typeof result.error.message === "string" ? result.error.message : t("sidebar.error.conventions"));
						return;
					}
					setWorkspaceDoc(Object.assign({}, workspaceDoc, {
						root: result.value.root,
						docPath: result.value.docPath,
						exists: true,
						size: result.value.bytes,
						draft: true
					}));
					setWorkspaceNote(true);
					runScan(true);
				}).catch(() => {
					setWorkspaceBusy(false);
					setWorkspaceError(t("sidebar.error.conventions"));
				});
			}, [conventionAi, conventionLang, runScan, strictMode, t, workspaceBusy, workspaceDoc, workspaceKey]);

		/** A switch clicked on an existing document is stored right away, not on the next framework pick. */
		const applyConventionSettings = react.useCallback((next) => {
			if (selected === void 0) return;
			const state = selected.conventions !== null && typeof selected.conventions === "object" ? selected.conventions : null;
			if (state === null || state.exists !== true) return;
			sidebarTabGit().conventionSettings(selected.path, next).then((result) => {
				if (!result.ok) return;
				runScan(true);
			}).catch(() => {});
		}, [selected, runScan]);

		/** The switches always show what the document says, not what was clicked last. */
		react.useEffect(() => {
			const state = selected !== void 0 && selected.conventions !== null && typeof selected.conventions === "object" ? selected.conventions : null;
			if (state === null) return;
			setStrictMode(state.strict === true);
			setConventionLang(state.languageStated === true && (state.language === "zh" || state.language === "en" || state.language === "mixed") ? state.language : "mixed");
		setConventionAi(state.aiStated === true && (state.ai === "required" || state.ai === "optional" || state.ai === "forbidden") ? state.ai : "optional");
		}, [selectedKey, scan]);
			/** The confirmation fades out on its own; the chip keeps the new state. */
			react.useEffect(() => {
				if (workspaceNote !== true) return void 0;
				const timer = setTimeout(() => setWorkspaceNote(false), 8000);
				return () => clearTimeout(timer);
			}, [workspaceNote]);
			/** Read the selected repository's compliance against its own document. */
			react.useEffect(() => {
				if (selectedKey === void 0) return void 0;
				let alive = true;
				sidebarTabGit().commitCompliance(selectedKey).then((result) => {
					if (!alive || !result.ok || result.value === null || result.value === void 0) return;
					setCompliance(result.value);
				}).catch(() => void 0);
				return () => {
					alive = false;
				};
			}, [selectedKey, scan]);

			/** Read where the documents that govern this repository disagree. */
			react.useEffect(() => {
				if (selectedKey === void 0) return void 0;
				let alive = true;
				sidebarTabGit().conventionConflicts(selectedKey).then((result) => {
					if (!alive || !result.ok || result.value === null || result.value === void 0) return;
					setConflicts(result.value);
				}).catch(() => void 0);
				return () => {
					alive = false;
				};
			}, [selectedKey, scan]);
			react.useEffect(() => {
				setUpgrade(null);
			}, [selectedKey]);
			/** Load the framework catalogue for the selected repository. */
			react.useEffect(() => {
				if (selectedKey === void 0) return void 0;
				let alive = true;
				sidebarTabGit().conventions(selectedKey).then((result) => {
					if (!alive || !result.ok || result.value === null || result.value === void 0) return;
					setCatalog(Array.isArray(result.value.catalog) ? result.value.catalog : []);
					setConventionError(null);
				}).catch(() => void 0);
				return () => {
					alive = false;
				};
			}, [selectedKey]);
			react.useEffect(() => {
				setConventionNotice(null);
				setConventionError(null);
				setPickerOpen(false);
			}, [selectedKey]);
			/**
			 * The trigger the feature is built around: a repository that exists but
			 * has no commit yet (`git init`, HEAD unborn) and no convention document
			 * is a bare workspace. The plugin writes the empty scaffold once, then
			 * opens the picker so the team chooses one of the proven frameworks.
			 * Host-side `conventionsAuto` is the master switch.
			 */
			react.useEffect(() => {
				if (!active || scan.phase !== "ready" || selected === void 0) return;
				if (scan.autoScaffold !== true) return;
				const state = selected.conventions !== void 0 && selected.conventions !== null ? selected.conventions : null;
				if (state === null || state.exists === true) return;
				const status = selected.status !== void 0 && selected.status !== null ? selected.status : null;
				if (status === null || status.head !== "") return;
				if (autoScaffolded.current.has(selected.path)) return;
				autoScaffolded.current.add(selected.path);
				writeConvention(selected.path, null).then((ok) => {
					if (ok) setPickerOpen(true);
				});
			}, [active, scan, selected, writeConvention]);
			/**
			 * One debounced background refresh. Git fires a change per edited file,
			 * so the events are folded into a single reload shortly after they
			 * settle; the panel keeps showing its current content the whole time.
			 */
			const reloadTimer = react.useRef();
			const scheduleReload = react.useCallback(() => {
				if (reloadTimer.current !== void 0) clearTimeout(reloadTimer.current);
				reloadTimer.current = setTimeout(() => {
					reloadTimer.current = void 0;
					runScan(false, true);
					loadGraph(void 0, true);
					/** A worktree added, removed or checked out elsewhere moves the rows. */
					loadWorktrees(true);
					loadWorktreeStatus(true);
				}, 600);
			}, [runScan, loadGraph, loadWorktrees, loadWorktreeStatus]);
			react.useEffect(() => () => {
				if (reloadTimer.current !== void 0) clearTimeout(reloadTimer.current);
			}, []);
			/**
			 * Live updates. The host watches the selected repository and pushes a
			 * `change` event when its branch, head, worktree list or dirty state
			 * moves; subscribing here is what makes commits appear without the
			 * user pressing refresh.
			 */
			react.useEffect(() => {
				if (!active || selectedKey === void 0) return void 0;
				const git = sidebarTabGit();
				if (typeof git.subscribeChanges !== "function") return void 0;
				let unsubscribe;
				try {
					unsubscribe = git.subscribeChanges(selectedKey, () => scheduleReload());
				} catch {
					return void 0;
				}
				return () => {
					try {
						if (typeof unsubscribe === "function") unsubscribe();
					} catch {}
				};
			}, [active, selectedKey, scheduleReload]);
			/**
			 * A slow poll catches repositories created while the tab is open. The
			 * graph itself is not reloaded here: the change stream from the host
			 * already says when the selected repository moved, so polling it again
			 * every twenty seconds only re-reads a log nobody asked for.
			 */
			react.useEffect(() => {
				if (!active) return void 0;
				const tick = () => {
					if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
					runScan(false, true);
				};
				const timer = setInterval(tick, 20000);
				return () => clearInterval(timer);
			}, [active, runScan]);
			/**
			 * Coming back to the window (or reopening the tab) refreshes quietly:
			 * the sidebar is a glance surface, so it must be current on arrival
			 * instead of whenever the next poll fires.
			 */
			react.useEffect(() => {
				if (!active) return void 0;
				if (typeof window === "undefined" || typeof window.addEventListener !== "function") return void 0;
				let lastFocus = 0;
				const onFocus = () => {
					const now = Date.now();
					if (now - lastFocus < 2000) return;
					lastFocus = now;
					scheduleReload();
				};
				window.addEventListener("focus", onFocus);
				return () => {
					try {
						window.removeEventListener("focus", onFocus);
					} catch {}
				};
			}, [active, scheduleReload]);
			react.useEffect(() => {
				if (!active || props.visible !== true) return;
				scheduleReload();
			}, [active, props.visible, scheduleReload]);
			const view = graph !== null ? graph.view : null;
			const graphError = graph !== null ? graph.error : null;
			const graphLoading = graph !== null && graph.loading === true;
			const allCommits = view === null ? [] : view.commits;
			/** Refs offered as toggles; HEAD aliases are skipped, they duplicate a branch. */
			/**
			 * Remote names, derived from the refs themselves: a ref that ends with
			 * "/<local branch>" is that branch's remote-tracking twin, and whatever
			 * sits in front of the slash is the remote. Only single-segment names
			 * count, so "origin/feat/x" cannot be mistaken for a remote "origin/feat".
			 */
			const remoteNames = react.useMemo(() => {
				const names = new Set();
				const all = [];
				const locals = new Set();
				for (const commit of allCommits) for (const ref of commit.refs) {
					if (ref === "HEAD" || ref.indexOf("HEAD -> ") === 0 || ref.indexOf("tag: ") === 0) continue;
					all.push(ref);
					locals.add(ref);
				}
				for (const ref of all) for (const local of locals) {
					if (ref.length <= local.length + 1 || ref.endsWith("/" + local) === false) continue;
					const prefix = ref.slice(0, ref.length - local.length - 1);
					if (prefix.indexOf("/") < 0) names.add(prefix);
				}
				if (names.size === 0) for (const ref of all) if (ref.indexOf("origin/") === 0) names.add("origin");
				return names;
			}, [allCommits]);
			/**
			 * One chip per branch: `feat/x` and `origin/feat/x` are the same thing to
			 * a reader, so they share a chip and mute together. Symbolic refs
			 * (`HEAD`, `origin/HEAD`) never become chips, and neither do tags: a tag is
			 * a label on a single commit, not a line to follow, so muting one would only
			 * hide that single row. Tags stay readable as row badges.
			 * Order is current branch, other local branches, then remote-only ones.
			 */
			const refGroups = react.useMemo(() => {
				const groups = new Map();
				const currentBranch = view !== null && typeof view.branch === "string" ? view.branch : "";
				const add = (key, ref, kind) => {
					let group = groups.get(key);
					if (group === void 0) {
						group = { key, refs: [], local: false, remote: false };
						groups.set(key, group);
					}
					if (group.refs.indexOf(ref) < 0) group.refs.push(ref);
					if (kind === "remote") group.remote = true;
					else group.local = true;
				};
				for (const commit of allCommits) for (const ref of commit.refs) {
					if (ref === "HEAD" || ref.indexOf("HEAD -> ") === 0) continue;
					if (ref.indexOf("tag: ") === 0) continue;
					let kind = "local";
					let key = ref;
					for (const remote of remoteNames) {
						if (ref.indexOf(remote + "/") !== 0) continue;
						kind = "remote";
						key = ref.slice(remote.length + 1);
						break;
					}
					if (key === "HEAD") continue;
					add(key, ref, kind);
				}
				const rankOf = (group) => group.local === true && group.key === currentBranch ? 0 : group.local === true ? 1 : 2;
				return Array.from(groups.values()).sort((left, right) => {
					const byRank = rankOf(left) - rankOf(right);
					if (byRank !== 0) return byRank;
					return left.key < right.key ? -1 : left.key > right.key ? 1 : 0;
				});
			}, [allCommits, remoteNames, view]);
			/** ref -> chip key, so the visibility filter can honour a grouped mute. */
			const refGroupOf = react.useMemo(() => {
				const map = new Map();
				for (const group of refGroups) for (const ref of group.refs) map.set(ref, group.key);
				return map;
			}, [refGroups]);
			/** ref -> its badge text: branches reuse the chip label, tags drop the `tag: ` prefix. */
			const refLabelOf = react.useMemo(() => {
				const map = new Map(refGroupOf);
				for (const commit of allCommits) for (const ref of commit.refs) {
					if (ref.indexOf("tag: ") !== 0) continue;
					map.set(ref, ref.slice("tag: ".length));
				}
				return map;
			}, [allCommits, refGroupOf]);
			const visibleRefGroups = refsExpanded === true ? refGroups : refGroups.slice(0, SIDEBAR_TAB_FILTER_REFS_MAX);
			const hiddenRefCount = refGroups.length - visibleRefGroups.length;
			const mutedCount = react.useMemo(() => {
				let count = 0;
				for (const group of refGroups) if (mutedRefs[group.key] === true) count += 1;
				return count;
			}, [mutedRefs, refGroups]);
			/**
			 * The commits the lanes are drawn from. A ref toggle keeps only the
			 * commits reachable from the refs that are still enabled; a search keeps
			 * every hit plus its ancestors inside this page, so the lines that lead
			 * to a match are not cut off.
			 */
			const visibleCommits = react.useMemo(() => {
				const byOid = new Map();
				for (const commit of allCommits) byOid.set(commit.oid, commit);
				const reachable = (starts) => {
					const seen = new Set();
					const stack = starts.slice();
					while (stack.length > 0) {
						const oid = stack.pop();
						if (seen.has(oid) || !byOid.has(oid)) continue;
						seen.add(oid);
						for (const parent of byOid.get(oid).parents) stack.push(parent);
					}
					return seen;
				};
				let allowed = null;
				if (mutedCount > 0) {
					const starts = [];
					for (const commit of allCommits) {
						const usable = commit.refs.some((ref) => {
							if (ref === "HEAD" || ref.indexOf("HEAD -> ") === 0) return false;
							const key = refGroupOf.get(ref);
							// A tag is never muted, so a release commit still counts as a start.
							if (key === void 0) return true;
							return mutedRefs[key] !== true;
						});
						if (usable) starts.push(commit.oid);
					}
					allowed = reachable(starts);
				}
				const needle = query.trim().toLowerCase();
				let matched = null;
				if (needle !== "") {
					const hits = [];
					for (const commit of allCommits) {
						const haystack = (commit.subject + " " + commit.author + " " + commit.oid + " " + commit.refs.join(" ")).toLowerCase();
						if (haystack.indexOf(needle) >= 0) hits.push(commit.oid);
					}
					matched = reachable(hits);
				}
				return allCommits.filter((commit) => (allowed === null || allowed.has(commit.oid)) && (matched === null || matched.has(commit.oid)));
			}, [allCommits, mutedRefs, mutedCount, query, refGroupOf]);
			const filtering = query.trim() !== "" || mutedCount > 0;
			const lanes = react.useMemo(() => computeLanes(visibleCommits), [visibleCommits]);
			const laneCount = react.useMemo(() => {
				let count = 0;
				for (const row of lanes) count = Math.max(count, row.columns.length);
				return count;
			}, [lanes]);
			const geometry = react.useMemo(() => sidebarTabBuildGraph(visibleCommits, lanes, rowHeight), [visibleCommits, lanes, rowHeight]);
			/** Export the visible graph as one standalone SVG file. */
			const exportGraph = () => {
				if (view === null || geometry === null) return;
				const svg = sidebarTabExportSvg({
					view,
					repo: selected,
					commits: visibleCommits,
					lanes,
					geometry,
					rowHeight,
					pinned: pinnedOid,
					refLabels: refLabelOf,
					dark: sidebarTabIsDark(),
					t,
					generatedAt: Date.now()
				});
				setExportState(sidebarTabSaveSvg(sidebarTabExportName(selected !== void 0 && selected !== null ? selected.root ?? selected.path : view.root), svg));
			};
			/** Tree rows: the workspace root, the directories between, each repository. */
			const treeRows = react.useMemo(() => scan.phase === "ready" ? sidebarTabRepoTree(scan.repos) : [], [scan]);
			const status = selected !== void 0 && selected.status !== void 0 && selected.status !== null ? selected.status : null;
			/** The linked checkout under the selected repository, when one is selected. */
			const activeWorktree = worktreePath === void 0 ? void 0 : worktrees.list.find((entry) => entry.path === worktreePath && entry.main !== true);
			/** The status of that checkout; the main checkout reuses the scanned row. */
			const worktreeStatusShown = activeWorktree !== void 0 && worktreeStatus !== null && worktreeStatus.path === activeWorktree.path ? worktreeStatus : null;
			const currentStatus = worktreeStatusShown !== null && worktreeStatusShown.value !== null ? worktreeStatusShown.value : status;
			const dirty = sidebarTabDirtyCount(currentStatus);
			const toolbarChildren = [];
			toolbarChildren.push(h("button", {
				key: "refresh",
				type: "button",
				"data-gitgraph-action": "refresh",
				style: SIDEBAR_TAB_BUTTON,
				onClick: () => {
					runScan(true);
					loadWorktrees(false);
					loadWorktreeStatus(false);
				},
				disabled: refreshing === true,
				title: t("sidebar.refresh"),
				"aria-label": t("sidebar.refresh")
			}, refreshing === true ? t("sidebar.scanning") : t("sidebar.refresh")));
			toolbarChildren.push(h("button", {
				key: "zoom-out",
				type: "button",
				"data-gitgraph-zoom": "out",
				style: SIDEBAR_TAB_ZOOM,
				onClick: () => setRowHeight((current) => Math.max(SIDEBAR_TAB_MIN_ROW_H, current - SIDEBAR_TAB_ZOOM_STEP)),
				disabled: rowHeight <= SIDEBAR_TAB_MIN_ROW_H,
				title: t("sidebar.zoomOut"),
				"aria-label": t("sidebar.zoomOut")
			}, "\u2212"));
			toolbarChildren.push(h("button", {
				key: "zoom-in",
				type: "button",
				"data-gitgraph-zoom": "in",
				style: SIDEBAR_TAB_ZOOM,
				onClick: () => setRowHeight((current) => Math.min(SIDEBAR_TAB_MAX_ROW_H, current + SIDEBAR_TAB_ZOOM_STEP)),
				disabled: rowHeight >= SIDEBAR_TAB_MAX_ROW_H,
				title: t("sidebar.zoomIn"),
				"aria-label": t("sidebar.zoomIn")
			}, "+"));
			toolbarChildren.push(h("button", {
				key: "export",
				type: "button",
				"data-gitgraph-action": "export",
				style: SIDEBAR_TAB_BUTTON,
				onClick: exportGraph,
				disabled: view === null,
				title: t("sidebar.exportGraph"),
				"aria-label": t("sidebar.exportGraph")
			}, exportState === "copy" ? t("sidebar.exportCopied") : exportState === "download" ? t("sidebar.exported") : t("sidebar.exportGraph")));
			/** One-click init is offered only while the workspace root is not a repository. */
			if (scan.phase === "ready" && !scan.repos.some((entry) => entry.kind === "root")) toolbarChildren.push(h("button", {
				key: "init",
				type: "button",
				"data-gitgraph-action": "init-repo",
				style: SIDEBAR_TAB_BUTTON,
				onClick: () => setInitOpen((current) => !current),
				title: t("sidebar.initRepo"),
				"aria-label": t("sidebar.initRepo")
			}, t("sidebar.initRepo")));
			/**
			 * The convention-template settings live behind a gear pinned to the
			 * right end of the toolbar, so they are reachable from the tab itself.
			 */
			toolbarChildren.push(h("button", {
				key: "conventions-settings",
				type: "button",
				"data-gitgraph-action": "conventions-settings",
				"aria-pressed": settingsOpen ? "true" : "false",
				style: Object.assign({}, SIDEBAR_TAB_BUTTON, {
					marginLeft: "auto"
				}),
				onClick: () => {
					if (settingsOpen) closeSettings();
					else openSettings();
				},
				title: t("sidebar.settings"),
				"aria-label": t("sidebar.settings")
			}, "\u2699"));
			/** Where the selected repository sits: roots get "workspace", nested ones a ↑ when above. */
			const repoIndexOf = new Map();
			if (scan.phase === "ready") scan.repos.forEach((entry, index) => repoIndexOf.set(entry.path, index));
			const treeHeader = scan.phase === "ready" && scan.repos.length > 0 ? h("button", {
				key: "tree-header",
				type: "button",
				"data-gitgraph-repo-tree-toggle": true,
				"aria-expanded": treeOpen,
				style: SIDEBAR_TAB_TREE_HEADER,
				onClick: () => setTreeOpen((current) => !current),
				title: treeOpen ? t("sidebar.collapse") : t("sidebar.expand")
			}, h("span", {
				key: "chevron",
				style: SIDEBAR_TAB_TREE_GLYPH
			}, treeOpen ? "\u25be" : "\u25b8"), h("span", {
				key: "count",
				style: { flex: "0 0 auto" }
			}, t("sidebar.repos", { count: scan.repos.length })), h("span", {
				key: "current",
				style: {
					flex: "1 1 auto",
					minWidth: 0,
					overflow: "hidden",
					textOverflow: "ellipsis",
					whiteSpace: "nowrap",
					textAlign: "right",
					color: "var(--dsw-alias-label-primary)"
				}
			}, selected !== void 0 ? sidebarTabRepoLabel(selected) : "")) : null;
			const treeRow = (row) => {
				const gutter = 6 + row.depth * 12;
				const glyph = row.kind === "root" ? "\u25cf" : row.last ? "\u2514\u2500" : "\u251c\u2500";
				if (row.kind === "dir") return h("div", {
					key: row.key,
					"data-gitgraph-repo-dir": row.label,
					style: Object.assign({}, SIDEBAR_TAB_TREE_ROW, SIDEBAR_TAB_TREE_DIR, { paddingLeft: gutter })
				}, h("span", {
					key: "glyph",
					style: SIDEBAR_TAB_TREE_GLYPH
				}, glyph), h("span", {
					key: "name",
					style: Object.assign({}, SIDEBAR_TAB_TREE_NAME, { flex: "0 1 auto" })
				}, row.label + "/"));
				const entry = row.entry;
				const entryStatus = entry.status !== void 0 && entry.status !== null ? entry.status : null;
				const entryDirty = entryStatus === null ? 0 : (entryStatus.dirtyFiles || 0) + (entryStatus.untrackedFiles || 0);
				const entryBranch = entryStatus !== null && typeof entryStatus.branch === "string" && entryStatus.branch !== "" ? entryStatus.branch : null;
				const isActive = selected !== void 0 && selected.path === entry.path;
				const index = repoIndexOf.get(entry.path);
				const dotColor = row.kind === "root" ? "var(--dsw-alias-label-tertiary)" : sidebarTabLaneColor(typeof index === "number" ? index : 0);
				const children = [h("span", {
					key: "glyph",
					style: SIDEBAR_TAB_TREE_GLYPH
				}, glyph), h("span", {
					key: "dot",
					style: Object.assign({}, SIDEBAR_TAB_TREE_DOT, { background: dotColor })
				}), h("span", {
					key: "name",
					style: Object.assign({}, SIDEBAR_TAB_TREE_NAME, { fontWeight: isActive ? 600 : 400 })
				}, row.label)];
				if (row.kind === "root") children.push(h("span", {
					key: "root",
					style: Object.assign({}, SIDEBAR_TAB_BADGE, { flex: "none" })
				}, t("sidebar.workspaceRoot")));
				if (entryBranch !== null) children.push(h("span", {
					key: "branch",
					style: Object.assign({}, SIDEBAR_TAB_BADGE, { flex: "none" })
				}, entryBranch));
				if (entry.outside === true) children.push(h("span", {
					key: "outside",
					title: t("sidebar.repoAbove"),
					style: Object.assign({}, SIDEBAR_TAB_TREE_GLYPH, { flex: "none" })
				}, "\u2191"));
				if (entryDirty > 0) children.push(h("span", {
					key: "dirty",
					style: Object.assign({}, SIDEBAR_TAB_WARN, { flex: "none", fontSize: 11 })
				}, t("sidebar.dirty", { count: entryDirty })));
				return h("div", {
					key: row.key,
					role: "button",
					tabIndex: 0,
					"data-gitgraph-repo": entry.path,
					"data-gitgraph-repo-active": isActive ? true : void 0,
					style: Object.assign({}, SIDEBAR_TAB_TREE_ROW, isActive ? SIDEBAR_TAB_TREE_ACTIVE : {}, { paddingLeft: gutter }),
					title: entry.path,
					onClick: () => choose(entry.path),
					onKeyDown: (event) => {
						if (event.key !== "Enter" && event.key !== " ") return;
						event.preventDefault();
						choose(entry.path);
					}
				}, children);
			};
			/**
			 * The linked worktrees of one repository, indented under its row. They are a
			 * read-only projection: selecting one only changes which checkout the status
			 * strip, the graph highlight and the jump buttons describe. Creating or
			 * removing belongs to the branch chip or the agent's git_worktree tool; the
			 * tab never grows a worktree write action, so it also has no empty state and
			 * no failure row to explain.
			 */
			const worktreeGroup = (repoPath) => {
				if (worktrees.root !== repoPath) return null;
				if (worktrees.phase !== "ready") return null;
				const linked = worktrees.list.filter((entry) => entry.main !== true);
				if (linked.length === 0) return null;
				const children = [h("span", {
					key: "count",
					"data-gitgraph-worktree-count": linked.length,
					style: SIDEBAR_TAB_MUTED
				}, t("sidebar.worktrees", { count: linked.length }))];
				for (const entry of linked.slice(0, 50)) {
					if (typeof entry.path !== "string" || entry.path === "") continue;
					children.push(worktreeRow(entry));
				}
				if (worktreeNotice !== null) children.push(h("span", {
					key: "jump-error",
					"data-gitgraph-worktree-notice": "jump-error",
					style: SIDEBAR_TAB_WARN
				}, worktreeNotice));
				return h("div", {
					key: "wt-group:" + repoPath,
					"data-gitgraph-worktrees": repoPath,
					style: SIDEBAR_TAB_WORKTREE_GROUP
				}, children);
			};
			/** One checkout: name, branch, and only the selected one carries a status. */
			const worktreeRow = (entry) => {
				const isActive = worktreePath === entry.path;
				const key = sidebarTabPathKey(entry.path);
				const sessionKey = sessionCwd !== void 0 ? sidebarTabPathKey(sessionCwd) : "";
				/** Whether this session's cwd sits inside the checkout. */
				const isCurrentSession = sessionKey !== "" && (sessionKey === key || sessionKey.startsWith(key + "/"));
				const branch = typeof entry.branch === "string" && entry.branch !== "" ? entry.branch : t("worktree.manager.detached");
				const rowDirty = worktreeStatus !== null && worktreeStatus.path === entry.path && worktreeStatus.value !== null ? sidebarTabDirtyCount(worktreeStatus.value) : -1;
				const children = [h("span", {
					key: "glyph",
					style: SIDEBAR_TAB_TREE_GLYPH
				}, isActive ? "●" : "○"), h("span", {
					key: "name",
					style: Object.assign({}, SIDEBAR_TAB_TREE_NAME, {
						flex: "0 1 auto",
						fontWeight: isActive ? 600 : 400
					})
				}, sidebarTabWorktreeName(entry.path)), h("span", {
					key: "branch",
					style: Object.assign({}, SIDEBAR_TAB_BADGE, { flex: "none" })
				}, branch)];
				if (rowDirty >= 0) children.push(h("span", {
					key: "dirty",
					"data-gitgraph-worktree-dirty": rowDirty,
					style: rowDirty > 0 ? SIDEBAR_TAB_WARN : SIDEBAR_TAB_MUTED
				}, rowDirty > 0 ? t("sidebar.dirty", { count: rowDirty }) : t("sidebar.clean")));
				if (isCurrentSession) children.push(h("span", {
					key: "current",
					"data-gitgraph-worktree-current": true,
					style: Object.assign({}, SIDEBAR_TAB_BADGE, { flex: "none" })
				}, t("sidebar.worktreeCurrent")));
				if (entry.locked === true) children.push(h("span", {
					key: "locked",
					title: "locked",
					style: Object.assign({}, SIDEBAR_TAB_TREE_GLYPH, { flex: "none" })
				}, "■"));
				if (entry.prunable === true) children.push(h("span", {
					key: "missing",
					"data-gitgraph-worktree-missing": true,
					style: SIDEBAR_TAB_WARN
				}, t("sidebar.worktreeMissing")));
				return h("div", {
					key: "wt:" + entry.path,
					role: "button",
					tabIndex: 0,
					"data-gitgraph-worktree": entry.path,
					"data-gitgraph-worktree-active": isActive ? true : void 0,
					style: Object.assign({}, SIDEBAR_TAB_WORKTREE_ROW, isActive ? {
						background: "var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.14))"
					} : {}),
					title: entry.path,
					onClick: () => setWorktreePath(entry.path),
					onKeyDown: (event) => {
						if (event.key !== "Enter" && event.key !== " ") return;
						event.preventDefault();
						setWorktreePath(entry.path);
					}
				}, children);
			};
			const treeList = treeHeader !== null && treeOpen ? h("div", {
				key: "tree",
				"data-gitgraph-repo-tree": true,
				style: SIDEBAR_TAB_TREE
			}, (() => {
				const nodes = [];
				for (const row of treeRows) {
					nodes.push(treeRow(row));
					if (row.entry !== void 0 && row.entry.path === selectedKey) {
						const group = worktreeGroup(row.entry.path);
						if (group !== null) nodes.push(group);
					}
				}
				return nodes;
			})()) : null;
			const statusChildren = [];
			if (selected !== void 0) {
				if (activeWorktree !== void 0) statusChildren.push(h("span", {
					key: "worktree",
					"data-gitgraph-worktree-badge": activeWorktree.path,
					style: SIDEBAR_TAB_BADGE,
					title: activeWorktree.path
				}, sidebarTabWorktreeName(activeWorktree.path)));
				const branchSource = currentStatus;
				const branch = branchSource !== null && typeof branchSource.branch === "string" && branchSource.branch !== "" ? branchSource.branch : t("branch.detached");
				statusChildren.push(h("span", {
					key: "branch",
					style: SIDEBAR_TAB_BADGE,
					title: t("sidebar.branch")
				}, branch));
				if (branchSource !== null && branchSource.operationInProgress === true) statusChildren.push(h("span", {
					key: "op",
					style: SIDEBAR_TAB_WARN
				}, t("sidebar.operationInProgress")));
				if (branchSource !== null && branchSource.conflicts > 0) statusChildren.push(h("span", {
					key: "conflicts",
					style: SIDEBAR_TAB_WARN
				}, t("sidebar.conflicts", { count: branchSource.conflicts })));
				statusChildren.push(h("span", {
					key: "dirty",
					style: dirty > 0 ? SIDEBAR_TAB_WARN : SIDEBAR_TAB_MUTED
				}, dirty > 0 ? t("sidebar.dirty", { count: dirty }) : t("sidebar.clean")));
				if (activeWorktree !== void 0) {
					const jumpTitle = t("sidebar.worktreeJumpHint");
					const actions = [h("button", {
						key: "session",
						type: "button",
						"data-gitgraph-action": "worktree-open-session",
						style: SIDEBAR_TAB_DETAIL_BUTTON,
						onClick: () => openWorktreeSession(activeWorktree),
						disabled: worktreeBusy === true,
						title: t("sidebar.worktreeOpenSession"),
						"aria-label": t("sidebar.worktreeOpenSession")
					}, t("sidebar.worktreeOpenSession")), h("button", {
						key: "workspace",
						type: "button",
						"data-gitgraph-action": "worktree-open-workspace",
						style: SIDEBAR_TAB_DETAIL_BUTTON,
						onClick: () => openWorktreeWorkspace(activeWorktree),
						disabled: worktreeBusy === true,
						title: t("sidebar.worktreeOpenWorkspace"),
						"aria-label": t("sidebar.worktreeOpenWorkspace")
					}, t("sidebar.worktreeOpenWorkspace")), h("button", {
						key: "copy",
						type: "button",
						"data-gitgraph-action": "worktree-copy-path",
						style: SIDEBAR_TAB_DETAIL_BUTTON,
						onClick: () => copyText("worktree", activeWorktree.path),
						title: t("sidebar.worktreeCopyPath"),
						"aria-label": t("sidebar.worktreeCopyPath")
					}, copiedKey === "worktree" ? t("sidebar.copied") : t("sidebar.worktreeCopyPath"))];
					statusChildren.push(h("span", {
						key: "wt-actions",
						"data-gitgraph-worktree-actions": activeWorktree.path,
						style: SIDEBAR_TAB_WORKTREE_ACTIONS,
						title: jumpTitle
					}, actions));
				}
				if (selected.outside === true) statusChildren.push(h("span", {
					key: "outside",
					style: SIDEBAR_TAB_MUTED
				}, t("sidebar.repoAbove")));
				statusChildren.push(h("span", {
					key: "commits",
					style: SIDEBAR_TAB_MUTED
				}, t("sidebar.commitsLanes", {
					count: visibleCommits.length,
					lanes: laneCount
				})));
				if (filtering === true) statusChildren.push(h("span", {
					key: "filtered",
					"data-gitgraph-filtered": true,
					style: SIDEBAR_TAB_MUTED
				}, t("sidebar.filtered", {
					shown: visibleCommits.length,
					total: allCommits.length
				})));
			}
			const canvas = geometry === null ? null : h("svg", {
				key: "canvas",
				width: geometry.width,
				height: geometry.height,
				style: {
					position: "absolute",
					left: 0,
					top: 0,
					overflow: "visible",
					pointerEvents: "none"
				},
				"aria-hidden": "true"
			}, geometry.segments.map((segment) => h("path", {
				key: segment.key,
				d: segment.d,
				fill: "none",
				stroke: segment.color,
				strokeWidth: segment.width,
				strokeOpacity: segment.opacity,
				strokeLinecap: "round"
			})), geometry.nodes.map((node) => node.merge === true ? h("rect", {
				key: node.key,
				x: node.x - 4.2,
				y: node.y - 4.2,
				width: 8.4,
				height: 8.4,
				rx: 1.4,
				fill: node.color,
				stroke: "var(--dsw-alias-bg-base, #ffffff)",
				strokeWidth: 1.4,
				transform: "rotate(45 " + node.x + " " + node.y + ")"
			}) : h("circle", {
				key: node.key,
				cx: node.x,
				cy: node.y,
				r: 3.6,
				fill: node.color,
				stroke: "var(--dsw-alias-bg-base, #ffffff)",
				strokeWidth: 1.4
			})));
			const rows = geometry === null ? [] : visibleCommits.map((commit, position) => {
				const row = lanes[position];
				if (row === void 0) return null;
				const pinned = pinnedOid === commit.oid;
				/** The commit the selected checkout has checked out (B2: one graph, overlay). */
				const isWorktreeHead = activeWorktree !== void 0 && typeof activeWorktree.head === "string" && activeWorktree.head !== "" && activeWorktree.head === commit.oid;
				const dimmed = pinnedOid !== void 0 && !pinned;
				const stacked = rowHeight >= SIDEBAR_TAB_STACK_ROW_H;
				const refBudget = stacked ? SIDEBAR_TAB_REF_MAX : 1;
				// The zoom control changes the row pitch; scale the type with it, so
				// "+" really enlarges the graph instead of only spreading the lines.
				const scale = rowHeight / SIDEBAR_TAB_ROW_H;
				const oidStyle = scale === 1 ? SIDEBAR_TAB_OID : Object.assign({}, SIDEBAR_TAB_OID, {
					fontSize: Math.max(9, Math.round(10 * scale)),
					width: Math.round(44 * Math.min(1.25, Math.max(1, scale)))
				});
				const subjectStyle = scale === 1 ? SIDEBAR_TAB_SUBJECT : Object.assign({}, SIDEBAR_TAB_SUBJECT, {
					fontSize: Math.max(11, Math.round(12 * scale))
				});
				const metaStyle = scale === 1 ? SIDEBAR_TAB_ROW_META : Object.assign({}, SIDEBAR_TAB_ROW_META, {
					fontSize: Math.max(9, Math.round(9 * scale))
				});
				const badgeStyle = scale === 1 ? SIDEBAR_TAB_REF : Object.assign({}, SIDEBAR_TAB_REF, {
					fontSize: Math.max(9, Math.round(9 * scale)),
					lineHeight: Math.round(14 * scale) + "px",
					maxWidth: Math.round(78 * Math.min(1.4, Math.max(1, scale)))
				});
				// A compact row has room for exactly one badge: keep the one that names
				// the checked-out branch ("HEAD -> main" or "main"), else the first ref,
				// and collapse everything else into a counter that never gets clipped.
				const orderedRefs = commit.refs.slice().sort((left, right) => {
					const rank = (ref) => ref === view.branch || ref.slice(-(view.branch.length + 1)) === " " + view.branch ? 0 : 1;
					return rank(left) - rank(right);
				});
				// Badges carry the chip labels, not the raw refs: "HEAD -> main" and
				// "origin/main" both read as "main", so a row cannot look busier than
				// the filter row above it.
				const refLabels = [];
				for (const ref of orderedRefs) {
					const text = String(ref);
					const key = text.indexOf("HEAD -> ") === 0 ? text.slice("HEAD -> ".length) : refLabelOf.get(ref);
					const label = key !== void 0 ? key : ref;
					if (refLabels.indexOf(label) < 0) refLabels.push(label);
				}
				const shownRefs = refLabels.slice(0, refBudget);
				const hiddenRefs = refLabels.slice(refBudget);
				// The second line of a stacked row spans the full width, so badges there
				// may show a longer branch name than the compact counter slot allows.
				const refWidth = stacked ? { maxWidth: 150 } : void 0;
				const refNodes = shownRefs.map((ref) => h("span", {
					key: "ref:" + ref,
					title: ref,
					style: Object.assign({}, badgeStyle, refWidth, ref === view.branch ? SIDEBAR_TAB_REF_CURRENT : void 0)
				}, ref));
				if (hiddenRefs.length > 0) refNodes.push(h("span", {
					key: "ref:more",
					title: hiddenRefs.join(", "),
					style: Object.assign({}, badgeStyle, { flex: "none", color: "var(--dsw-alias-label-tertiary)" })
				}, "+" + hiddenRefs.length));
				const oidNode = h("span", {
					key: "oid",
					style: oidStyle,
					title: commit.oid
				}, String(commit.oid).slice(0, 7));
				const subjectNode = h("span", {
					key: "subject",
					style: subjectStyle,
					title: commit.subject + " \u2014 " + commit.author
				}, commit.subject);
				const timeNode = h("span", {
					key: "meta",
					style: metaStyle,
					title: commit.author + " \u00b7 " + commit.subject
				}, formatTime(commit.authorTime, t));
				const refGroup = refNodes.length === 0 ? null : h("span", {
					key: "refs",
					style: SIDEBAR_TAB_REFS
				}, refNodes);
				const children = stacked ? [oidNode, h("span", {
					key: "column",
					style: SIDEBAR_TAB_ROW_COLUMN
				}, [subjectNode, h("span", {
					key: "sub",
					style: SIDEBAR_TAB_ROW_SUB
				}, [refGroup, timeNode])])] : [oidNode, subjectNode, refGroup, timeNode];
				return h("div", {
					key: commit.oid,
					"data-gitgraph-row": true,
					"data-gitgraph-pinned": pinned ? "true" : "false",
					"data-gitgraph-head": isWorktreeHead ? activeWorktree.path : void 0,
					style: Object.assign({}, SIDEBAR_TAB_ROW, {
						height: rowHeight,
						paddingLeft: geometry.width + 2,
						opacity: dimmed ? 0.62 : 1
					}, pinned ? { background: "var(--dsw-alias-bg-layer-2)" } : void 0, isWorktreeHead ? { boxShadow: "inset 0 0 0 1px var(--dsw-alias-state-business-primary, #4c8dff)" } : void 0),
					onClick: () => setPinnedOid(pinned ? void 0 : commit.oid),
					title: commit.subject
				}, children);
			});
			const pinned = view === null ? void 0 : view.commits.find((commit) => commit.oid === pinnedOid);
			const pinnedAbove = view === null || pinned === void 0 ? -1 : view.commits.findIndex((commit) => commit.oid === pinned.oid);
			const graphBody = view === null || geometry === null ? null : h("div", {
				key: "canvas-host",
				"data-gitgraph-canvas": true,
				style: {
					position: "relative",
					minHeight: geometry.height
				}
			}, [canvas].concat(rows));
			/** One labelled line of the commit card. */
			const detailLine = (key, label, value, valueStyle) => h("div", {
				key: "line-" + key,
				style: SIDEBAR_TAB_DETAIL_LINE
			}, [h("span", {
				key: "k",
				style: SIDEBAR_TAB_DETAIL_KEY
			}, label), h("span", {
				key: "v",
				style: Object.assign({}, SIDEBAR_TAB_DETAIL_VALUE, valueStyle)
			}, value)]);
			/**
			 * The commit card. It is always visible (it explains how to open it
			 * before anything is pinned) and, once a commit is pinned, carries the
			 * whole commit plus the copy actions a "roll this back" conversation
			 * needs: the plain-text block and the bare object id.
			 */
			const detail = h("div", {
				key: "detail",
				"data-gitgraph-detail": true,
				style: SIDEBAR_TAB_DETAIL
			}, pinned === void 0 ? h("span", {
				key: "hint",
				style: SIDEBAR_TAB_MUTED
			}, t("sidebar.detailHint")) : [h("div", {
				key: "head",
				style: SIDEBAR_TAB_DETAIL_HEAD
			}, [h("span", {
				key: "label",
				style: Object.assign({}, SIDEBAR_TAB_MUTED, { flex: "1 1 auto" })
			}, t("sidebar.detail")), h("button", {
				key: "copy-info",
				type: "button",
				"data-gitgraph-action": "copy-info",
				style: SIDEBAR_TAB_DETAIL_BUTTON,
				onClick: () => copyText("info", sidebarTabCommitText(pinned, selected, t)),
				title: t("sidebar.copyInfo"),
				"aria-label": t("sidebar.copyInfo")
			}, copiedKey === "info" ? t("sidebar.copied") : t("sidebar.copyInfo")), h("button", {
				key: "copy-rollback",
				type: "button",
				"data-gitgraph-action": "copy-rollback",
				style: SIDEBAR_TAB_DETAIL_BUTTON,
				onClick: () => copyText("rollback", sidebarTabRollbackText(pinned, selected, view === null ? void 0 : view.branch, pinnedAbove, t)),
				title: t("sidebar.copyRollback"),
				"aria-label": t("sidebar.copyRollback")
			}, copiedKey === "rollback" ? t("sidebar.copied") : t("sidebar.copyRollback")), h("button", {
				key: "copy-sha",
				type: "button",
				"data-gitgraph-action": "copy-sha",
				style: SIDEBAR_TAB_DETAIL_BUTTON,
				onClick: () => copyText("sha", pinned.oid),
				title: t("sidebar.copySha"),
				"aria-label": t("sidebar.copySha")
			}, copiedKey === "sha" ? t("sidebar.copied") : t("sidebar.copySha")), h("button", {
				key: "close",
				type: "button",
				"data-gitgraph-action": "unpin",
				style: SIDEBAR_TAB_DETAIL_BUTTON,
				onClick: () => setPinnedOid(void 0),
				title: t("sidebar.close"),
				"aria-label": t("sidebar.close")
			}, "\u00d7")]), detailLine("oid", "SHA", pinned.oid, {
				fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
				color: "var(--dsw-alias-label-primary)",
				wordBreak: "break-all"
			}), detailLine("subject", t("sidebar.subject"), pinned.subject, {
				fontSize: 14,
				lineHeight: "18px",
				color: "var(--dsw-alias-label-primary)"
			}), detailLine("author", t("sidebar.author"), pinned.author + " \u00b7 " + sidebarTabIsoTime(pinned.authorTime)), detailLine("refs", t("sidebar.references"), pinned.refs.length === 0 ? "\u2014" : pinned.refs.join(", ")), detailLine("parents", t("sidebar.parentsLabel"), pinned.parents.length === 0 ? "\u2014" : pinned.parents.map((parent) => String(parent).slice(0, 7)).join(", "), {
				fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
			})]);
			/**
			 * The Git-conventions strip. It always states which document the
			 * repository should carry, and when none exists it opens the picker
			 * with the proven frameworks (or writes just the empty scaffold).
			 */
			const conventionsBar = selected === void 0 ? null : (() => {
				const state = selected.conventions !== void 0 && selected.conventions !== null ? selected.conventions : null;
				const exists = state !== null && state.exists === true;
				const draft = state !== null && state.draft === true;
				const docName = state !== null && typeof state.doc === "string" ? state.doc : scan.docName !== void 0 ? scan.docName : "GIT_CONVENTIONS.md";
				const zh = sidebarTabIsZh();
				/** Literal t() arguments: the locale validator only counts literal keys. */
				const mainViewLabel = mainViewOpen ? t("sidebar.mainViewOn") : t("sidebar.mainViewOpen");
				const head = h("div", {
					key: "head",
					style: SIDEBAR_TAB_CONVENTIONS_HEAD
				}, [h("span", {
					key: "title",
					style: SIDEBAR_TAB_CONVENTIONS_TITLE
				}, t("sidebar.conventions")), h("span", {
					key: "doc",
					style: Object.assign({}, SIDEBAR_TAB_CONVENTIONS_NOTE, {
						flex: "0 1 auto",
						minWidth: 0,
						overflow: "hidden",
						textOverflow: "ellipsis",
						whiteSpace: "nowrap"
					}),
					title: state !== null && typeof state.docPath === "string" ? state.docPath : docName
				}, docName), h("span", {
					key: "state",
					"data-gitgraph-conventions-state": exists ? draft ? "draft" : "settled" : "none",
					style: SIDEBAR_TAB_CONVENTIONS_CHIP
				}, exists ? draft ? t("sidebar.conventionsDraft") : t("sidebar.conventionsSettled") : t("sidebar.conventionsNone")), exists && typeof props.onOpenFile === "function" && state !== null && typeof state.docPath === "string" ? h("button", {
					key: "open",
					type: "button",
					"data-gitgraph-action": "open-conventions",
					style: SIDEBAR_TAB_DETAIL_BUTTON,
					onClick: () => props.onOpenFile(state.docPath),
					title: t("sidebar.conventionsOpen"),
					"aria-label": t("sidebar.conventionsOpen")
				}, t("sidebar.conventionsOpen")) : null, exists ? h("button", {
					key: "switch",
					type: "button",
					"data-gitgraph-action": "switch-conventions",
					style: SIDEBAR_TAB_DETAIL_BUTTON,
					disabled: conventionBusy,
					onClick: () => setPickerOpen((current) => !current),
					title: t("sidebar.conventionsSwitch"),
					"aria-label": t("sidebar.conventionsSwitch")
				}, t("sidebar.conventionsSwitch")) : null, exists ? h("button", {
					key: "merge",
					type: "button",
					"data-gitgraph-action": "conventions-ai-merge",
					style: SIDEBAR_TAB_DETAIL_BUTTON,
					disabled: conventionBusy,
					onClick: () => requestAiMerge(),
					title: t("sidebar.consolidateAi"),
					"aria-label": t("sidebar.consolidateAi")
				}, t("sidebar.consolidateAi")) : null, h("button", {
					key: "main-view",
					type: "button",
					"data-gitgraph-action": "main-view-toggle",
					"data-gitgraph-main-view-open": mainViewOpen ? "1" : "0",
					style: SIDEBAR_TAB_DETAIL_BUTTON,
					onClick: () => sidebarTabSetMainView(!mainViewOpen),
					title: mainViewLabel,
					"aria-label": mainViewLabel
				}, mainViewLabel), exists ? null : h("button", {
					key: "setup",
					type: "button",
					"data-gitgraph-action": "setup-conventions",
					style: SIDEBAR_TAB_DETAIL_BUTTON,
					onClick: () => setPickerOpen((current) => !current),
					title: t("sidebar.conventionsSetup"),
					"aria-label": t("sidebar.conventionsSetup")
				}, t("sidebar.conventionsSetup"))]);
				/**
				 * The rules the document puts in force, shown as chips. Nothing
				 * here counts the past: a commit that is already written cannot be
				 * fixed from this panel, so the line says what the agent is told
				 * before the next commit instead of scolding about history.
				 */
				const complianceLine = compliance === null ? null : (() => {
					const enforced = compliance.enforced === true;
					const rules = compliance.rules !== void 0 && compliance.rules !== null ? compliance.rules : null;
					const parts = [];
					let shown = 0;
					const push = (key, rule, label) => {
						shown += 1;
						parts.push(h("span", {
							key,
							"data-gitgraph-rule": rule,
							style: SIDEBAR_TAB_CONVENTIONS_CHIP
						}, label));
					};
					if (enforced === true && rules !== null) {
						if (Array.isArray(rules.types) && rules.types.length > 0) push("types", "types", t("sidebar.ruleTypes", {
							types: rules.types.join(" / ")
						}));
						if (typeof rules.maxSubject === "number") push("length", "length", t("sidebar.ruleLength", {
							count: rules.maxSubject
						}));
						if (rules.lowercase === true) push("case", "case", t("sidebar.ruleLowercase"));
						if (rules.noPeriod === true) push("period", "period", t("sidebar.rulePeriod"));
						if (rules.imperative === true) push("mood", "mood", t("sidebar.ruleMood"));
						if (rules.languageStated === true) push("language", "language", rules.language === "zh" ? t("sidebar.langZh") : rules.language === "en" ? t("sidebar.langEn") : t("sidebar.langMixed"));
						if (rules.aiStated === true) push("ai", "ai", rules.ai === "required" ? t("sidebar.ruleAiRequired") : rules.ai === "forbidden" ? t("sidebar.ruleAiForbidden") : t("sidebar.ruleAiOptional"));
					}
					if (shown === 0) parts.push(h("span", {
						key: "text",
						style: SIDEBAR_TAB_CONVENTIONS_NOTE
					}, t("sidebar.complianceOff")));
					if (compliance.strict === true) parts.push(h("span", {
						key: "strict",
						"data-gitgraph-compliance-strict": true,
						title: t("sidebar.strictHint"),
						style: Object.assign({}, SIDEBAR_TAB_CONVENTIONS_CHIP, {
							color: "var(--dsw-alias-state-warn-primary, #b45309)"
						})
					}, t("sidebar.strict")));
					return h("div", {
						key: "compliance",
						"data-gitgraph-compliance": enforced !== true || shown === 0 ? "none" : "rules",
						style: SIDEBAR_TAB_COMPLIANCE
					}, parts);
				})();

				/**
				 * The exclusivity check: the documents that govern this repository do
				 * not always agree, and silently picking one would be wrong. The banner
				 * states how many documents disagree; the merge itself is the model's job.
				 */
				const conflictLine = conflicts === null || typeof conflicts.count !== "number" || conflicts.count === 0 ? null : h("div", {
					key: "conflicts",
					"data-gitgraph-conflicts": conflicts.count,
					style: SIDEBAR_TAB_CONFLICTS
				}, [h("span", {
						key: "count",
						style: Object.assign({}, SIDEBAR_TAB_CONVENTIONS_CHIP, {
							color: "var(--dsw-alias-state-warn-primary, #b45309)"
						})
					}, t("sidebar.conventionsConflicts", {
						count: conflicts.count
					})), h("button", {
						key: "review",
						type: "button",
						"data-gitgraph-action": "conventions-conflicts-review",
						style: SIDEBAR_TAB_DETAIL_BUTTON,
						disabled: conventionBusy,
						onClick: () => requestAiMerge()
					}, t("sidebar.conflictsReview"))]);
				const children = [head];
				if (complianceLine !== null) children.push(complianceLine);
				if (conflictLine !== null) children.push(conflictLine);
				if (conventionError !== null) children.push(h("span", {
					key: "error",
					"data-gitgraph-conventions-error": true,
					style: SIDEBAR_TAB_ERROR
				}, conventionError));
				else if (conventionNotice === "auto") children.push(h("span", {
					key: "notice",
					style: SIDEBAR_TAB_CONVENTIONS_NOTE
				}, t("sidebar.conventionsAuto")));
				else if (conventionNotice === "applied") children.push(h("span", {
					key: "notice",
					style: SIDEBAR_TAB_CONVENTIONS_NOTE
				}, t("sidebar.conventionsApplied")));
				else if (conventionNotice === "ai") children.push(h("span", {
					key: "notice",
					"data-gitgraph-conventions-ai": true,
					style: SIDEBAR_TAB_CONVENTIONS_NOTE
				}, t("sidebar.consolidateAiNotice")));
				else if (!exists) children.push(h("span", {
					key: "missing",
					style: SIDEBAR_TAB_CONVENTIONS_NOTE
				}, t("sidebar.conventionsMissing")));
				/**
				 * The upgrade preview: what choosing a framework would do to the
				 * document that is already there. Nothing is written until the
				 * confirmation button is pressed.
				 */
				const upgradePanel = (() => {
					if (upgrade === null || upgrade.path !== selected.path) return null;
					const value = upgrade.phase === "ready" ? upgrade.value : null;
					const parts = [h("span", {
						key: "title",
						style: SIDEBAR_TAB_CONVENTIONS_NOTE
					}, t("sidebar.previewTitle"))];
					if (value === null) parts.push(h("span", {
						key: "wait",
						style: SIDEBAR_TAB_CONVENTIONS_NOTE
					}, t("sidebar.loading")));
					else {
						const counts = [t("sidebar.previewAdded", {
							count: value.added
						}), t("sidebar.previewChanged", {
							count: value.changed
						}), t("sidebar.previewRemoved", {
							count: value.removed
						}), t("sidebar.previewSame", {
							count: value.same
						})].join("  /  ");
						parts.push(h("span", {
							key: "counts",
							"data-gitgraph-upgrade-counts": true,
							style: SIDEBAR_TAB_CONVENTIONS_NOTE
						}, counts));
						const sections = (value.sections !== void 0 && value.sections !== null ? value.sections : []).filter((section) => section.status !== "same").slice(0, 6);
						sections.forEach((section) => {
							parts.push(h("div", {
								key: "section-" + section.title,
								style: SIDEBAR_TAB_PREVIEW_ROW
							}, [h("span", {
								key: "badge",
								style: Object.assign({}, SIDEBAR_TAB_CONVENTIONS_CHIP, {
									color: section.status === "added" ? "var(--dsw-alias-state-business-primary, #4c8dff)" : "var(--dsw-alias-state-warn-primary, #b45309)"
								})
							}, section.status === "added" ? t("sidebar.previewBadgeAdded") : t("sidebar.previewBadgeChanged")), h("span", {
								key: "name",
								style: SIDEBAR_TAB_PREVIEW_SNIPPET
							}, section.title)]));
						});
						if ((value.added ?? 0) + (value.changed ?? 0) + (value.removed ?? 0) === 0) parts.push(h("span", {
							key: "same",
							style: SIDEBAR_TAB_CONVENTIONS_NOTE
						}, t("sidebar.previewNoChange")));
						parts.push(h("div", {
							key: "actions",
							style: SIDEBAR_TAB_PREVIEW_ROW
						}, [h("button", {
							key: "confirm",
							type: "button",
							"data-gitgraph-action": "conventions-confirm",
							style: SIDEBAR_TAB_DETAIL_BUTTON,
							onClick: confirmUpgrade
						}, t("sidebar.previewConfirm")), h("button", {
							key: "dismiss",
							type: "button",
							"data-gitgraph-action": "conventions-dismiss",
							style: SIDEBAR_TAB_DETAIL_BUTTON,
							onClick: () => setUpgrade(null)
						}, t("sidebar.previewCancel"))]));
					}
					return h("div", {
						key: "upgrade",
						"data-gitgraph-upgrade": upgrade.phase,
						style: SIDEBAR_TAB_PREVIEW
					}, parts);
				})();
				if (upgradePanel !== null) children.push(upgradePanel);
				if (pickerOpen) {
					/** One card: a built-in framework, or one of the user's own templates. */
					const frameworkCard = (framework, custom) => {
						const name = zh && typeof framework.nameZh === "string" && framework.nameZh !== "" ? framework.nameZh : framework.name;
						const tagline = zh && typeof framework.taglineZh === "string" && framework.taglineZh !== "" ? framework.taglineZh : framework.tagline;
						const bestFor = zh && typeof framework.bestForZh === "string" && framework.bestForZh !== "" ? framework.bestForZh : framework.bestFor;
						const parts = [h("span", {
							key: "name",
							style: SIDEBAR_TAB_SETTINGS_ROW
						}, [h("span", {
							key: "text",
							style: SIDEBAR_TAB_FRAMEWORK_NAME
						}, typeof name === "string" && name !== "" ? name : framework.id), custom === true ? h("span", {
							key: "badge",
							style: SIDEBAR_TAB_CONVENTIONS_CHIP
						}, t("sidebar.templateCustom")) : null])];
						if (typeof tagline === "string" && tagline !== "") parts.push(h("span", {
							key: "tag",
							style: SIDEBAR_TAB_FRAMEWORK_TAG
						}, tagline));
						if (typeof bestFor === "string" && bestFor !== "") parts.push(h("span", {
							key: "meta",
							style: SIDEBAR_TAB_FRAMEWORK_META
						}, t("sidebar.conventionsBestFor") + bestFor));
						return h("button", {
							key: (custom === true ? "custom-" : "framework-") + framework.id,
							type: "button",
							"data-gitgraph-framework": framework.id,
							"data-gitgraph-framework-custom": custom === true ? "1" : void 0,
							style: SIDEBAR_TAB_FRAMEWORK,
							disabled: conventionBusy,
							onClick: () => pickFramework(selected.path, framework.id, exists),
							title: typeof framework.url === "string" ? framework.url : void 0
						}, parts);
					};
					const catalogue = catalog !== null ? catalog : [];
					const builtinCards = catalogue.filter((framework) => framework.custom !== true).map((framework) => frameworkCard(framework, false));
					const customCards = catalogue.filter((framework) => framework.custom === true).map((framework) => frameworkCard(framework, true));
					/** The strict switch: it turns the document into policy, not advice. */
					const strictRow = h("div", {
						key: "strict-row",
						style: SIDEBAR_TAB_STRICT_ROW
					}, [h("button", {
						key: "strict",
						type: "button",
						"data-gitgraph-action": "conventions-strict",
						"data-gitgraph-strict": strictMode === true ? "on" : "off",
						title: t("sidebar.strictHint"),
						style: strictMode === true ? SIDEBAR_TAB_STRICT_ON : SIDEBAR_TAB_STRICT_OFF,
						disabled: conventionBusy,
						onClick: () => {
							const next = strictMode !== true;
							setStrictMode(next);
							applyConventionSettings({
								strict: next,
								language: conventionLang,
								ai: conventionAi
							});
						}
					}, (strictMode === true ? "☑ " : "☐ ") + t("sidebar.strict")), h("span", {
						key: "strict-hint",
						style: SIDEBAR_TAB_STRICT_NOTE
					}, t("sidebar.strictHint"))]);
					/** The language switch: three explicit choices, never inferred. */
					const langRow = h("div", {
						key: "lang-row",
						style: SIDEBAR_TAB_STRICT_ROW
					}, [h("span", {key: "lang-label", style: SIDEBAR_TAB_STRICT_NOTE}, t("sidebar.language"))].concat(["zh", "en", "mixed"].map((value) => h("button", {
							key: value,
							type: "button",
							"data-gitgraph-lang": value,
							"aria-pressed": conventionLang === value ? "true" : "false",
							title: t("sidebar.languageHint"),
							style: conventionLang === value ? SIDEBAR_TAB_STRICT_ON : SIDEBAR_TAB_STRICT_OFF,
							disabled: conventionBusy,
							onClick: () => {
								setConventionLang(value);
								applyConventionSettings({
									strict: strictMode,
									language: value,
									ai: conventionAi
								});
							}
						}, value === "zh" ? t("sidebar.langZh") : value === "en" ? t("sidebar.langEn") : t("sidebar.langMixed")))));
					children.push(langRow);
					/** The AI-attribution switch: three explicit choices, never inferred. */
					const aiRow = h("div", {
						key: "ai-row",
						style: SIDEBAR_TAB_STRICT_ROW
					}, [h("span", {key: "ai-label", style: SIDEBAR_TAB_STRICT_NOTE}, t("sidebar.ai"))].concat(["required", "optional", "forbidden"].map((value) => h("button", {
							key: value,
							type: "button",
							"data-gitgraph-ai": value,
							"aria-pressed": conventionAi === value ? "true" : "false",
							title: t("sidebar.aiHint"),
							style: conventionAi === value ? SIDEBAR_TAB_STRICT_ON : SIDEBAR_TAB_STRICT_OFF,
							disabled: conventionBusy,
							onClick: () => {
								setConventionAi(value);
								applyConventionSettings({
									strict: strictMode,
									language: conventionLang,
									ai: value
								});
							}
						}, value === "required" ? t("sidebar.aiRequired") : value === "forbidden" ? t("sidebar.aiForbidden") : t("sidebar.aiOptional")))));
					children.push(aiRow);
					children.push(h("div", {
						key: "picker",
						"data-gitgraph-conventions-picker": true,
						style: SIDEBAR_TAB_PICKER
					}, (() => {
						const groups = [h("span", {
							key: "hint",
							style: SIDEBAR_TAB_CONVENTIONS_NOTE
						}, conventionBusy ? t("sidebar.conventionsWriting") : t("sidebar.conventionsPick")), strictRow].concat(builtinCards);
						if (customCards.length > 0) {
							groups.push(h("span", {
								key: "mine",
								style: SIDEBAR_TAB_CONVENTIONS_TITLE
							}, t("sidebar.templateMine")));
							customCards.forEach((card) => groups.push(card));
						}
						groups.push(h("button", {
							key: "manage",
							type: "button",
							"data-gitgraph-action": "conventions-settings",
							style: SIDEBAR_TAB_DETAIL_BUTTON,
							disabled: conventionBusy,
							onClick: openSettings
						}, t("sidebar.templateManage")));
						groups.push(h("button", {
							key: "scaffold",
							type: "button",
							"data-gitgraph-action": "conventions-scaffold",
							style: SIDEBAR_TAB_DETAIL_BUTTON,
							disabled: conventionBusy,
							onClick: () => writeConvention(selected.path, null)
						}, t("sidebar.conventionsScaffold")));
						groups.push(h("button", {
							key: "cancel",
							type: "button",
							"data-gitgraph-action": "conventions-cancel",
							style: SIDEBAR_TAB_DETAIL_BUTTON,
							disabled: conventionBusy,
							onClick: () => {
								setPickerOpen(false);
								setConventionError(null);
							}
						}, t("sidebar.conventionsClose")));
						return groups;
					})()));
				}
				return h("div", {
					key: "conventions",
					"data-gitgraph-conventions": true,
					style: SIDEBAR_TAB_CONVENTIONS
				}, children);
			})();
			/**
			 * The initialize bar: a two-step confirm so a stray click cannot write
			 * into the workspace. It states the target path and the branch.
			 */
			const initBar = initOpen !== true ? null : h("div", {
				key: "init",
				"data-gitgraph-init": true,
				style: SIDEBAR_TAB_INIT
			}, [h("div", {
				key: "head",
				style: SIDEBAR_TAB_INIT_ROW
			}, [h("span", {
				key: "title",
				style: { flex: "0 0 auto", fontWeight: 600 }
			}, t("sidebar.initRepo")), h("span", {
				key: "path",
				style: SIDEBAR_TAB_INIT_PATH,
				title: sessionCwd
			}, sessionCwd === void 0 ? "" : sessionCwd)]), h("div", {
				key: "row",
				style: SIDEBAR_TAB_INIT_ROW
			}, [h("span", {
				key: "branch",
				style: Object.assign({}, SIDEBAR_TAB_MUTED, { flex: "0 0 auto" })
			}, t("sidebar.initBranch")), h("select", {
				key: "select",
				"data-gitgraph-init-branch": true,
				style: SIDEBAR_TAB_SELECT,
				value: initBranch,
				onChange: (event) => setInitBranch(String(event.target.value)),
				disabled: initBusy === true
			}, SIDEBAR_TAB_INIT_BRANCHES.map((name) => h("option", {
				key: name,
				value: name
			}, name))), h("button", {
				key: "confirm",
				type: "button",
				"data-gitgraph-action": "init-confirm",
				style: SIDEBAR_TAB_DETAIL_BUTTON,
				onClick: () => runInit(),
				disabled: initBusy === true
			}, initBusy === true ? t("sidebar.initRunning") : t("sidebar.initConfirm")), h("button", {
				key: "cancel",
				type: "button",
				"data-gitgraph-action": "init-cancel",
				style: SIDEBAR_TAB_DETAIL_BUTTON,
				onClick: () => setInitOpen(false),
				disabled: initBusy === true
			}, t("sidebar.initCancel"))]), h("span", {
				key: "hint",
				style: SIDEBAR_TAB_CONVENTIONS_NOTE
			}, t("sidebar.initAfter")), initError === null ? null : h("span", {
				key: "error",
				"data-gitgraph-init-error": true,
				style: SIDEBAR_TAB_ERROR
			}, initError)]);
			/** Search field plus one toggle per ref; both feed visibleCommits. */
			const filterBar = view === null || view.commits.length === 0 ? null : h("div", {
				key: "filter",
				"data-gitgraph-filter": true,
				style: SIDEBAR_TAB_FILTER
			}, [h("input", {
				key: "query",
				type: "search",
				value: query,
				"data-gitgraph-search": true,
				placeholder: t("sidebar.search"),
				style: SIDEBAR_TAB_SEARCH,
				onChange: (event) => setQuery(event.target.value === void 0 ? "" : event.target.value)
			}), refGroups.length < SIDEBAR_TAB_FILTER_REFS_MIN && mutedCount === 0 ? null : h("div", {
				key: "refs",
				style: SIDEBAR_TAB_FILTER_REFS
			}, visibleRefGroups.map((group) => {
				const muted = mutedRefs[group.key] === true;
				const base = group.local === true ? SIDEBAR_TAB_CHIP : SIDEBAR_TAB_CHIP_MORE;
				return h("button", {
					key: "ref:" + group.key,
					type: "button",
					"data-gitgraph-ref-filter": group.key,
					"data-gitgraph-ref-muted": muted ? "true" : "false",
					"data-gitgraph-ref-kind": group.local === true ? "branch" : "remote",
					style: muted ? Object.assign({}, base, SIDEBAR_TAB_CHIP_OFF) : base,
					title: t("sidebar.refFilter") + "  " + group.refs.join(", "),
					"aria-pressed": muted ? "false" : "true",
					onClick: () => setMutedRefs((current) => {
						const next = Object.assign({}, current);
						if (next[group.key] === true) delete next[group.key];
						else next[group.key] = true;
						return next;
					})
				}, group.key);
			}).concat(hiddenRefCount > 0 || refsExpanded === true || mutedCount > 0 ? [h("span", {
				key: "ref-extra",
				style: SIDEBAR_TAB_FILTER_REFS
			}, [hiddenRefCount > 0 || refsExpanded === true ? h("button", {
				key: "toggle",
				type: "button",
				"data-gitgraph-refs-toggle": refsExpanded === true ? "collapse" : "expand",
				style: SIDEBAR_TAB_CHIP_MORE,
				title: refsExpanded === true ? t("sidebar.refsLess") : t("sidebar.refsMore"),
				onClick: () => setRefsExpanded((open) => open !== true)
			}, refsExpanded === true ? t("sidebar.refsLess") : "+" + String(hiddenRefCount)) : null, mutedCount > 0 ? h("button", {
				key: "clear",
				type: "button",
				"data-gitgraph-refs-clear": true,
				style: SIDEBAR_TAB_CHIP_MORE,
				title: t("sidebar.refsClear"),
				onClick: () => setMutedRefs({})
			}, t("sidebar.refsClear")) : null])] : []))]);
			let body;
			if (scan.phase === "idle" || scan.phase === "scanning") body = h("div", { style: SIDEBAR_TAB_EMPTY }, t("sidebar.loading"));
			else if (scan.phase === "error") body = h("div", { style: SIDEBAR_TAB_ERROR }, scan.error !== void 0 && scan.error !== null ? scan.error : t("sidebar.error.repos"));
			else if (scan.repos.length === 0) body = h("div", {
				style: Object.assign({}, SIDEBAR_TAB_EMPTY, { display: "flex", flexDirection: "column", alignItems: "center", gap: 8 })
			}, [h("span", {
				key: "hint",
				style: { textAlign: "center" }
			}, t("sidebar.initRepoHint")), h("button", {
				key: "init",
				type: "button",
				"data-gitgraph-action": "init-repo-empty",
				style: SIDEBAR_TAB_BUTTON,
				onClick: () => setInitOpen(true)
			}, t("sidebar.initRepo"))]);
			else if (graphError !== null) body = h("div", { style: SIDEBAR_TAB_ERROR }, graphError);
			else if (view === null) body = h("div", { style: SIDEBAR_TAB_EMPTY }, graphLoading ? t("graph.loading") : t("graph.empty"));
			else if (view.commits.length === 0) body = h("div", { style: SIDEBAR_TAB_EMPTY }, t("graph.empty"));
			else if (filtering === true && visibleCommits.length === 0) body = h("div", {
				"data-gitgraph-nomatch": true,
				style: SIDEBAR_TAB_EMPTY
			}, t("sidebar.noMatch"));
			else body = graphBody;
			const moreChild = view !== null && view.hasMore === true ? h("button", {
				key: "more",
				type: "button",
				style: SIDEBAR_TAB_MORE,
				onClick: () => loadGraph(view.commits.length + PAGE_STEP)
			}, t("graph.loadMore")) : null;
			/**
			 * The shared workspace document: one `.dsh/<doc>` at the session
			 * directory that every nested repository inherits unless it carries
			 * its own. Only shown when the workspace actually holds more than one
			 * repository, so a single checkout keeps the plain strip.
			 */
			const workspaceBar = (() => {
				if (scan.phase !== "ready") return null;
				if (scan.repos.length < 2) return null;
				if (workspaceDoc === null || sessionCwd === void 0) return null;
				const exists = workspaceDoc.exists === true;
				const docName = typeof workspaceDoc.doc === "string" ? workspaceDoc.doc : ".dsh/" + (scan.docName !== void 0 ? scan.docName : "GIT_CONVENTIONS.md");
				const head = [h("span", {
					key: "title",
					style: SIDEBAR_TAB_CONVENTIONS_TITLE
				}, t("sidebar.workspaceDoc")), h("span", {
					key: "doc",
					style: Object.assign({}, SIDEBAR_TAB_CONVENTIONS_NOTE, {
						flex: "0 1 auto",
						minWidth: 0,
						overflow: "hidden",
						textOverflow: "ellipsis",
						whiteSpace: "nowrap"
					}),
					title: typeof workspaceDoc.docPath === "string" ? workspaceDoc.docPath : docName
				}, docName), h("span", {
					key: "state",
					"data-gitgraph-workspace-doc": exists !== true ? "none" : workspaceDoc.draft === true ? "draft" : "settled",
					style: SIDEBAR_TAB_CONVENTIONS_CHIP
				}, exists !== true ? t("sidebar.conventionsNone") : workspaceDoc.draft === true ? t("sidebar.conventionsDraft") : t("sidebar.conventionsSettled"))];
				if (workspaceBusy === true) head.push(h("span", {
					key: "busy",
					style: SIDEBAR_TAB_CONVENTIONS_NOTE
				}, t("sidebar.conventionsWriting")));
				else if (exists !== true) head.push(h("button", {
					key: "create",
					type: "button",
					"data-gitgraph-action": "workspace-doc-create",
					style: SIDEBAR_TAB_DETAIL_BUTTON,
					onClick: writeWorkspaceDoc,
					title: t("sidebar.workspaceDocCreate"),
					"aria-label": t("sidebar.workspaceDocCreate")
				}, t("sidebar.workspaceDocCreate")));
				else if (typeof props.onOpenFile === "function" && typeof workspaceDoc.docPath === "string") head.push(h("button", {
					key: "open",
					type: "button",
					"data-gitgraph-action": "workspace-doc-open",
					style: SIDEBAR_TAB_DETAIL_BUTTON,
					onClick: () => props.onOpenFile(workspaceDoc.docPath),
					title: t("sidebar.conventionsOpen"),
					"aria-label": t("sidebar.conventionsOpen")
				}, t("sidebar.conventionsOpen")));
				/** Without an editor to open it, at least hand over the path of the document. */
				else head.push(h("button", {
					key: "copy",
					type: "button",
					"data-gitgraph-action": "workspace-doc-copy",
					style: SIDEBAR_TAB_DETAIL_BUTTON,
					onClick: () => {
						if (typeof workspaceDoc.docPath === "string") sidebarTabCopy(workspaceDoc.docPath);
					},
					title: t("sidebar.workspaceDocCopy"),
					"aria-label": t("sidebar.workspaceDocCopy")
				}, t("sidebar.workspaceDocCopy")));
				return h("div", {
					key: "workspace-doc",
					"data-gitgraph-workspace-bar": true,
				"data-gitgraph-workspace-note": workspaceError !== null ? "error" : workspaceNote === true ? "written" : "idle",
					style: SIDEBAR_TAB_CONVENTIONS
				}, [h("div", {
					key: "head",
					style: SIDEBAR_TAB_CONVENTIONS_HEAD
				}, head), h("span", {
					key: "hint",
					style: SIDEBAR_TAB_CONVENTIONS_NOTE
				}, workspaceError !== null ? workspaceError : workspaceNote === true ? t("sidebar.workspaceDocWritten") + "  " + docName : exists !== true ? t("sidebar.workspaceDocMissing") : t("sidebar.workspaceDocExists"))]);
			})();
			const bodyWrap = h("div", {
				key: "body-wrap",
				style: SIDEBAR_TAB_BODY,
				"data-gitgraph-sidebar-body": true
			}, body);
			/**
			 * The template settings page. It replaces the whole tab content while
			 * open: the user's own templates and the editor for one of them. The
			 * six built-in frameworks stay read-only, and never appear here.
			 */
			const settingsPage = (() => {
				const zh = sidebarTabIsZh();
				const head = h("div", {
					key: "settings-head",
					style: SIDEBAR_TAB_SETTINGS_HEAD
				}, [h("span", {
					key: "title",
					style: SIDEBAR_TAB_CONVENTIONS_TITLE
				}, t("sidebar.settingsTitle")), h("button", {
					key: "close",
					type: "button",
					"data-gitgraph-action": "settings-close",
					style: SIDEBAR_TAB_DETAIL_BUTTON,
					onClick: closeSettings,
					title: t("sidebar.close"),
					"aria-label": t("sidebar.close")
				}, "\u00d7")]);
				const parts = [head];
				if (templateError !== null) parts.push(h("span", {
					key: "error",
					"data-gitgraph-settings-error": true,
					style: SIDEBAR_TAB_ERROR
				}, templateError));
				else if (templateNotice !== null) parts.push(h("span", {
					key: "notice",
					style: SIDEBAR_TAB_CONVENTIONS_NOTE
				}, templateNotice));
				if (templateStore !== null) parts.push(h("span", {
					key: "store",
					style: SIDEBAR_TAB_CONVENTIONS_NOTE,
					title: templateStore
				}, t("sidebar.templatesStore", { path: templateStore })));
				parts.push(h("span", {
					key: "hint",
					style: SIDEBAR_TAB_CONVENTIONS_NOTE
				}, t("sidebar.settingsHint")));
				if (templateDraft !== null) {
					const draft = templateDraft;
					/** One labelled control of the editor; the id is fixed on an existing template. */
					const field = (name, label, placeholder, multiline) => {
						const value = typeof draft[name] === "string" ? draft[name] : "";
						const onChange = (event) => updateTemplateDraft(name, String(event.target.value));
						return h("label", {
							key: "field-" + name,
							style: SIDEBAR_TAB_SETTINGS_FIELD
						}, [h("span", {
							key: "label",
							style: SIDEBAR_TAB_SETTINGS_LABEL
						}, label), multiline === true ? h("textarea", {
							key: "control",
							"data-gitgraph-template-field": name,
							style: SIDEBAR_TAB_TEXTAREA,
							value,
							placeholder,
							spellCheck: false,
							onChange
						}) : h("input", {
							key: "control",
							type: "text",
							"data-gitgraph-template-field": name,
							style: SIDEBAR_TAB_INPUT,
							value,
							placeholder,
							disabled: name === "id" && templateCreating !== true,
							onChange
						})]);
					};
					parts.push(h("div", {
						key: "editor",
						"data-gitgraph-template-editor": true,
						style: {
							display: "flex",
							flexDirection: "column",
							gap: 8
						}
					}, [h("span", {
						key: "editor-hint",
						style: SIDEBAR_TAB_CONVENTIONS_NOTE
					}, t("sidebar.templateEditorHint")), field("id", t("sidebar.templateId"), t("sidebar.templateIdHint"), false), field("name", t("sidebar.templateName"), "", false), field("nameZh", t("sidebar.templateNameZh"), "", false), field("tagline", t("sidebar.templateTagline"), "", false), field("taglineZh", t("sidebar.templateTaglineZh"), "", false), field("bestFor", t("sidebar.templateBestFor"), "", false), field("bestForZh", t("sidebar.templateBestForZh"), "", false), field("url", t("sidebar.templateUrl"), "", false), field("body", t("sidebar.templateBody"), "", true), h("div", {
						key: "actions",
						style: SIDEBAR_TAB_SETTINGS_ROW
					}, [h("button", {
						key: "save",
						type: "button",
						"data-gitgraph-action": "template-save",
						style: SIDEBAR_TAB_DETAIL_BUTTON,
						disabled: templateBusy,
						onClick: saveTemplate
					}, templateBusy ? t("sidebar.templateSaving") : t("sidebar.templateSave")), h("button", {
						key: "cancel",
						type: "button",
						"data-gitgraph-action": "template-cancel",
						style: SIDEBAR_TAB_DETAIL_BUTTON,
						disabled: templateBusy,
						onClick: () => {
							setTemplateDraft(null);
							setTemplateCreating(false);
						}
					}, t("sidebar.templateCancel"))])]));
				} else {
					const rows = (templates !== null ? templates : []).map((template) => {
						const id = typeof template.id === "string" ? template.id : "";
						const name = zh && typeof template.nameZh === "string" && template.nameZh !== "" ? template.nameZh : template.name;
						const tagline = zh && typeof template.taglineZh === "string" && template.taglineZh !== "" ? template.taglineZh : template.tagline;
						const row = [h("div", {
							key: "head",
							style: SIDEBAR_TAB_SETTINGS_ROW
						}, [h("span", {
							key: "name",
							style: SIDEBAR_TAB_FRAMEWORK_NAME
						}, typeof name === "string" && name !== "" ? name : id), h("span", {
							key: "badge",
							style: SIDEBAR_TAB_CONVENTIONS_CHIP
						}, t("sidebar.templateCustom")), h("span", {
							key: "bytes",
							style: SIDEBAR_TAB_FRAMEWORK_META
						}, t("sidebar.templateBytes", {
							count: typeof template.bodyBytes === "number" ? template.bodyBytes : 0
						}))])];
						if (typeof tagline === "string" && tagline !== "") row.push(h("span", {
							key: "tagline",
							style: SIDEBAR_TAB_FRAMEWORK_TAG
						}, tagline));
						row.push(h("div", {
							key: "actions",
							style: SIDEBAR_TAB_SETTINGS_ROW
						}, [h("button", {
							key: "edit",
							type: "button",
							"data-gitgraph-action": "template-edit",
							style: SIDEBAR_TAB_DETAIL_BUTTON,
							disabled: templateBusy,
							onClick: () => startTemplateEdit(id)
						}, t("sidebar.templateEdit")), h("button", {
							key: "delete",
							type: "button",
							"data-gitgraph-action": templateDeleteId === id ? "template-delete-confirm" : "template-delete",
							style: SIDEBAR_TAB_DETAIL_BUTTON,
							disabled: templateBusy,
							onClick: () => deleteTemplate(id)
						}, templateDeleteId === id ? t("sidebar.templateDeleteConfirm") : t("sidebar.templateDelete"))]));
						return h("div", {
							key: "template-" + id,
							"data-gitgraph-template": id,
							style: SIDEBAR_TAB_SETTINGS_CARD
						}, row);
					});
					const listHead = h("div", {
						key: "list-head",
						style: SIDEBAR_TAB_SETTINGS_ROW
					}, [h("span", {
						key: "count",
						style: SIDEBAR_TAB_CONVENTIONS_NOTE
					}, templates === null ? t("sidebar.templateLoading") : t("sidebar.templatesCount", { count: rows.length })), h("button", {
						key: "new",
						type: "button",
						"data-gitgraph-action": "template-new",
						style: Object.assign({}, SIDEBAR_TAB_DETAIL_BUTTON, {
							marginLeft: "auto"
						}),
						disabled: templateBusy,
						onClick: startTemplateCreate
					}, t("sidebar.templateNew"))]);
					const builtinRows = (builtinTemplates !== null ? builtinTemplates : []).map((framework) => {
						const id = typeof framework.id === "string" ? framework.id : "";
						const hidden = framework.hidden === true;
						const name = zh && typeof framework.nameZh === "string" && framework.nameZh !== "" ? framework.nameZh : framework.name;
						return h("div", {
							key: "builtin-" + id,
							"data-gitgraph-builtin": id,
							"data-gitgraph-builtin-hidden": hidden ? "1" : void 0,
							style: SIDEBAR_TAB_SETTINGS_ROW
						}, [h("span", {
							key: "name",
							style: SIDEBAR_TAB_FRAMEWORK_NAME
						}, typeof name === "string" && name !== "" ? name : id), h("span", {
							key: "badge",
							style: SIDEBAR_TAB_CONVENTIONS_CHIP
						}, t("sidebar.templateBuiltin")), h("span", {
							key: "state",
							style: SIDEBAR_TAB_FRAMEWORK_META
						}, hidden ? t("sidebar.builtinHidden") : t("sidebar.builtinShown")), h("button", {
							key: "toggle",
							type: "button",
							"data-gitgraph-action": "builtin-toggle",
							style: SIDEBAR_TAB_DETAIL_BUTTON,
							disabled: templateBusy,
							onClick: () => toggleBuiltin(id, hidden === false)
						}, hidden ? t("sidebar.builtinShow") : t("sidebar.builtinHide"))]);
					});
					const builtinGroup = h("div", {
						key: "builtins",
						"data-gitgraph-builtin-group": true,
						style: SIDEBAR_TAB_SETTINGS_CARD
					}, [h("div", {
						key: "head",
						style: SIDEBAR_TAB_SETTINGS_ROW
					}, [h("span", {
						key: "title",
						style: SIDEBAR_TAB_CONVENTIONS_TITLE
					}, t("sidebar.builtinGroup")), h("span", {
						key: "hint",
						style: SIDEBAR_TAB_CONVENTIONS_NOTE
					}, t("sidebar.builtinHint"))])].concat(builtinRows));
					const listBody = rows.length === 0 ? h("span", {
						key: "empty",
						style: SIDEBAR_TAB_CONVENTIONS_NOTE
					}, t("sidebar.templatesEmpty")) : rows;
					parts.push(builtinGroup);
					parts.push(h("div", {
						key: "list",
						"data-gitgraph-template-list": true,
						style: {
							display: "flex",
							flexDirection: "column",
							gap: 6
						}
					}, [listHead].concat(listBody)));
				}
				return h("div", {
					key: "settings",
					"data-gitgraph-settings": "open",
					style: SIDEBAR_TAB_SETTINGS_PAGE
				}, parts);
			})();
			/** The settings page owns the whole tab while it is open. */
			if (settingsOpen) return h("div", {
				style: inMainView ? SIDEBAR_TAB_MAIN_VIEW_ROOT : SIDEBAR_TAB_ROOT,
				"data-gitgraph-sidebar-tab": true,
				"data-gitgraph-settings": "open"
			}, [h("div", {
				key: "toolbar",
				style: SIDEBAR_TAB_TOOLBAR
			}, toolbarChildren), settingsPage]);
			return h("div", {
				style: inMainView ? SIDEBAR_TAB_MAIN_VIEW_ROOT : SIDEBAR_TAB_ROOT,
				"data-gitgraph-sidebar-tab": true
			}, [h("div", {
				key: "toolbar",
				style: SIDEBAR_TAB_TOOLBAR
			}, toolbarChildren), workspaceBar, treeHeader, treeList, scan.phase === "ready" && scan.truncated === true ? h("div", {
				key: "truncated",
				style: SIDEBAR_TAB_MUTED
			}, t("sidebar.truncated", { limit: SIDEBAR_TAB_REPO_LIMIT })) : null, selected !== void 0 ? h("div", {
				key: "status",
				style: SIDEBAR_TAB_STATUS
			}, statusChildren) : null, conventionsBar, initBar, filterBar, inMainView && pinned !== void 0 ? h("div", {
				key: "split",
				style: SIDEBAR_TAB_MAIN_VIEW_SPLIT,
				"data-gitgraph-main-split": true
			}, [bodyWrap, h("div", {
				key: "aside",
				style: SIDEBAR_TAB_MAIN_VIEW_ASIDE,
				"data-gitgraph-detail-aside": true
			}, detail)]) : bodyWrap, inMainView ? null : detail, moreChild]);
		}
		//#endregion
//#region src/client/index.ts
		/** Dictionary namespace owned by this plugin. */
		const NS = "git-graph";
		/** Required services: slots for the dock entry, sessions for the cwd lookup, workspaces for worktree sessions, locale for the copy. */
		const inject = [
			"slots",
			"sessions",
			"workspaces",
			"connection",
			"locale"
		];
		/** The session-cwd lookup failure shared by the injected verbs. */
		const NO_WORKSPACE = {
			code: "workspace-unknown",
			message: "session has no workspace"
		};
		/**
		* Client plugin body: the branch chip entry with its git verbs, on the
		* composer's input dock.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			reportDailyHeartbeat([{ name: "dsh-git-graph-sidebar" }]);
			ctx.effect(() => {
				try {
					return ctx.locale.register(NS, {
						zh,
						en
					});
				} catch {
					return () => {};
				}
			}, "dsh-git-graph: dictionaries");
			const git = new GitApi();

			// Multi-repo graph tab: registers while better-sidebar is installed (ctx.inject
			// defers until that service mounts, and stays a no-op without it).
			ctx.inject(["betterSidebar", "sessions", "workspaces", "uiWorkspace"], (sidebarScope) => {
				sidebarTabSessions = sidebarScope.sessions;
				sidebarTabWorkspaces = sidebarScope.workspaces;
				sidebarTabUiWorkspace = sidebarScope.uiWorkspace;
				sidebarScope.effect(() => {
					try {
						return sidebarScope.betterSidebar.registerTab({
							id: SIDEBAR_TAB_ID,
							title: sidebarTabT(sidebarScope, "sidebar.tabTitle"),
							description: sidebarTabT(sidebarScope, "sidebar.tabDescription"),
							icon: sidebarTabIcon(),
							order: 60,
							single: true,
							component: GitGraphSidebarTab
						});
					} catch (error) {
						console.warn("dsh-git-graph: sidebar tab registration failed", error);
						return () => {};
					}
				}, "dsh-git-graph: sidebar tab");
			});
			// Main-area View: the graph can also sit in the Conversation tab bar beside the
			// shipped views. It is opt-in from the sidebar tab and closable there, so the
			// sidebar stays the primary entry.
			ctx.inject(["slots", "sessions"], (viewScope) => {
				let disposeView;
				/** Register or drop the View so the tab bar follows the opt-in immediately. */
				const syncView = () => {
					if (typeof disposeView === "function") {
						disposeView();
						disposeView = void 0;
					}
					if (!sidebarTabMainViewEnabled()) return;
					try {
						disposeView = viewScope.slots.inject("conversation.view", () => {
							try {
								return viewScope.slots.register({
									name: "conversation.view",
									id: "git-graph",
									order: 70,
									locale: NS,
									label: () => sidebarTabT(viewScope, "view.title"),
									inject: (sessionId) => ({
										ctx: viewScope,
										scope: {
											sessionId,
											cwd: sidebarTabCwdOf(viewScope.sessions, sessionId)
										},
										tab: void 0,
										visible: true
									})
								}, GitGraphMainView);
							} catch {
								return () => {};
							}
						});
					} catch (error) {
						console.warn("dsh-git-graph: conversation view registration failed", error);
					}
				};
				viewScope.effect(() => {
					syncView();
					const off = sidebarTabMainViewSubscribe(syncView);
					return () => {
						off();
						if (typeof disposeView === "function") disposeView();
					};
				}, "dsh-git-graph: conversation view preference");
			});
			ctx.inject([
				"workspaces",
				"sessions",
				"uiWorkspace"
			], (worktreeScope) => {
				worktreeScope.effect(() => installAutoIsolation(worktreeScope, git), "dsh-git-graph: auto-isolation");
			});
			ctx.inject([
				"slots",
				"conversation",
				"sessions",
				"uiWorkspace"
			], (scope) => {
				const sessions = scope.sessions;
				/** The session's workspace root, resolved at call time from the sessions baseline. */
				const cwdOf = (sessionId) => sessionId === void 0 ? void 0 : sessions.list.getSnapshot().byId[sessionId]?.cwd;
				/** The injected face shared by every seat this chip registers into. */
				const injected = () => {
					/** Resolve the workspace root for one git call. */
					const pathOf = (sessionId) => {
						const cwd = cwdOf(sessionId);
						if (cwd === void 0 || cwd === "") return {
							ok: false,
							error: NO_WORKSPACE
						};
						return {
							ok: true,
							path: cwd
						};
					};
					return {
						repoStatus: async (sessionId) => {
							const resolved = pathOf(sessionId);
							if (!resolved.ok) return null;
							const result = await git.status(resolved.path);
							return result.ok ? result.value : null;
						},
						branches: async (sessionId) => {
							const resolved = pathOf(sessionId);
							if (!resolved.ok) return null;
							const result = await git.branches(resolved.path);
							return result.ok ? result.value : null;
						},
						switchBranch: async (sessionId, branch) => {
							const resolved = pathOf(sessionId);
							if (!resolved.ok) return {
								ok: false,
								error: resolved.error
							};
							const result = await git.switchBranch(resolved.path, branch);
							return result.ok ? {
								ok: true,
								branch: result.value.branch
							} : result;
						},
						createBranch: async (sessionId, name) => {
							const resolved = pathOf(sessionId);
							if (!resolved.ok) return {
								ok: false,
								error: resolved.error
							};
							const result = await git.createBranch(resolved.path, name);
							return result.ok ? {
								ok: true,
								branch: result.value.branch
							} : result;
						},
						graph: async (sessionId, limit) => {
							const resolved = pathOf(sessionId);
							if (!resolved.ok) return null;
							const result = await git.graph(resolved.path, limit);
							return result.ok ? result.value : null;
						},
						worktrees: async (sessionId) => {
							const resolved = pathOf(sessionId);
							if (!resolved.ok) return null;
							const result = await git.worktrees(resolved.path);
							return result.ok ? result.value : null;
						},
						createWorktreeSession: async (sessionId, name, baseRef) => {
							const resolved = pathOf(sessionId);
							if (!resolved.ok) return {
								ok: false,
								error: resolved.error
							};
							const created = await git.addWorktree(resolved.path, name, baseRef);
							if (!created.ok) return {
								ok: false,
								error: created.error
							};
							try {
								const workspace = await scope.workspaces.create({ path: created.value.path });
								const createdSessionId = await scope.sessions.create({ workspaceId: workspace.workspaceId });
								scope.uiWorkspace.openSession(createdSessionId);
							} catch (error) {
								await git.removeWorktree(resolved.path, created.value.path, { force: true });
								return {
									ok: false,
									error: {
										code: "internal",
										message: `workspace registration failed: ${String(error)}`
									}
								};
							}
							return {
								ok: true,
								path: created.value.path,
								branch: created.value.branch,
								name: created.value.name
							};
						},
						removeWorktree: async (sessionId, worktreePath, opts) => {
							const resolved = pathOf(sessionId);
							if (!resolved.ok) return {
								ok: false,
								error: resolved.error
							};
							const removed = await git.removeWorktree(resolved.path, worktreePath, opts);
							if (!removed.ok) return {
								ok: false,
								error: removed.error
							};
							const linked = scope.workspaces.list.getSnapshot().items.find((item) => item.path === worktreePath);
							if (linked !== void 0) await scope.workspaces.delete(linked.workspaceId);
							return { ok: true };
						},
						gitConfig: async () => {
							const result = await git.config();
							return result.ok ? result.value : null;
						},
						subscribeChanges: (sessionId, onChange) => {
							const resolved = pathOf(sessionId);
							if (!resolved.ok) return () => {};
							return subscribeChanges(resolved.path, onChange);
						}
					};
				};
				scope.slots.inject("conversation.input.dock", () => {
					try {
						return scope.slots.register({
							name: "conversation.input.dock",
							id: "git-graph",
							order: 100,
							locale: NS,
							inject: injected
						}, BranchChip);
					} catch {
						return () => {};
					}
				});
			});
		}
		//#endregion
		exports.BranchChip = BranchChip;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map