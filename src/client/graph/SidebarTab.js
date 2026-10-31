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
			 * The template settings page. Everything below only manages the user's
			 * own templates: the six built-ins are never editable or deletable.
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
					const listBody = rows.length === 0 ? h("span", {
						key: "empty",
						style: SIDEBAR_TAB_CONVENTIONS_NOTE
					}, t("sidebar.templatesEmpty")) : rows;
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
