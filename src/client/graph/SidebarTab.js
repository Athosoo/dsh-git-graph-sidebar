		/** The shared element factory (the bundle's JSX helpers stay untouched). */
		const h = react.createElement;
		/** Tab id registered into better-sidebar (also its SidebarTab.type). */
		const SIDEBAR_TAB_ID = "git-graph-repos";
	/** Branch names offered by the one-click "initialize repository" bar. */
	const SIDEBAR_TAB_INIT_BRANCHES = ["main", "master", "trunk", "develop"];
	/** How many refs the filter offers as toggles before it stops listing them. */
	const SIDEBAR_TAB_FILTER_REFS_MAX = 12;
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
			flexDirection: "column",
			gap: 1,
			padding: "2px 2px 0",
			fontSize: 12,
			lineHeight: "16px"
		};
		/** The upgrade preview: what a write would add, rewrite or drop. */
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
		 *   geometry, rowHeight, dark, t and generatedAt.
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
				const refs = Array.isArray(commit.refs) ? commit.refs.filter((ref) => String(ref).indexOf("HEAD -> ") !== 0) : [];
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
		function sidebarTabReasonLabel(t, reason) {
			if (reason === "length") return t("sidebar.reasonLength");
			if (reason === "type") return t("sidebar.reasonType");
			if (reason === "case") return t("sidebar.reasonCase");
			if (reason === "period") return t("sidebar.reasonPeriod");
			if (reason === "mood") return t("sidebar.reasonMood");
			if (reason === "lang") return t("sidebar.reasonLang");
			return reason;
		}
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
	function GitGraphSidebarTab(props) {
			sidebarTabEnsureStyle();
			const ctx = props.ctx;
			const scope = props.scope !== void 0 && props.scope !== null ? props.scope : {};
			const tab = props.tab;
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
			/** Free-text filter over the loaded commits (subject, author, sha, refs). */
			const [query, setQuery] = react.useState("");
			/** Refs whose commits are hidden; name -> true. */
			const [mutedRefs, setMutedRefs] = react.useState(() => ({}));
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
			/** The picker's strict switch: rules become enforced policy, not advice. */
			const [strictMode, setStrictMode] = react.useState(false);
			/** The subject language the document asks for: zh, en or mixed. */
			const [conventionLang, setConventionLang] = react.useState("mixed");
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
				return sidebarTabGit().conventionOptions(repoPath, frameworkId, true, strictMode, conventionLang).then((result) => {
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
			}, [conventionLang, runScan, strictMode, t]);
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
				return sidebarTabGit().conventionPreview(repoPath, frameworkId, strictMode, conventionLang).then((result) => {
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
			}, [conventionLang, strictMode, t, writeConvention]);
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
					action: "write"
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
			}, [runScan, t, workspaceBusy, workspaceDoc, workspaceKey]);
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
				}, 600);
			}, [runScan, loadGraph]);
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
			const refNames = react.useMemo(() => {
				const names = [];
				for (const commit of allCommits) for (const ref of commit.refs) {
					if (ref.indexOf("HEAD -> ") === 0) continue;
					if (names.indexOf(ref) < 0) names.push(ref);
				}
				return names.slice(0, SIDEBAR_TAB_FILTER_REFS_MAX);
			}, [allCommits]);
			const mutedCount = react.useMemo(() => {
				let count = 0;
				for (const name of refNames) if (mutedRefs[name] === true) count += 1;
				return count;
			}, [mutedRefs, refNames]);
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
						const usable = commit.refs.some((ref) => ref.indexOf("HEAD -> ") !== 0 && mutedRefs[ref] !== true);
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
			}, [allCommits, mutedRefs, mutedCount, query]);
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
					dark: sidebarTabIsDark(),
					t,
					generatedAt: Date.now()
				});
				setExportState(sidebarTabSaveSvg(sidebarTabExportName(selected !== void 0 && selected !== null ? selected.root ?? selected.path : view.root), svg));
			};
			/** Tree rows: the workspace root, the directories between, each repository. */
			const treeRows = react.useMemo(() => scan.phase === "ready" ? sidebarTabRepoTree(scan.repos) : [], [scan]);
			const status = selected !== void 0 && selected.status !== void 0 && selected.status !== null ? selected.status : null;
			const dirty = status === null ? 0 : (status.dirtyFiles || 0) + (status.untrackedFiles || 0);
			const toolbarChildren = [];
			toolbarChildren.push(h("button", {
				key: "refresh",
				type: "button",
				"data-gitgraph-action": "refresh",
				style: SIDEBAR_TAB_BUTTON,
				onClick: () => runScan(true),
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
			const treeList = treeHeader !== null && treeOpen ? h("div", {
				key: "tree",
				"data-gitgraph-repo-tree": true,
				style: SIDEBAR_TAB_TREE
			}, treeRows.map(treeRow)) : null;
			const statusChildren = [];
			if (selected !== void 0) {
				const branch = status !== null && typeof status.branch === "string" && status.branch !== "" ? status.branch : t("branch.detached");
				statusChildren.push(h("span", {
					key: "branch",
					style: SIDEBAR_TAB_BADGE,
					title: t("sidebar.branch")
				}, branch));
				if (status !== null && status.operationInProgress === true) statusChildren.push(h("span", {
					key: "op",
					style: SIDEBAR_TAB_WARN
				}, t("sidebar.operationInProgress")));
				if (status !== null && status.conflicts > 0) statusChildren.push(h("span", {
					key: "conflicts",
					style: SIDEBAR_TAB_WARN
				}, t("sidebar.conflicts", { count: status.conflicts })));
				statusChildren.push(h("span", {
					key: "dirty",
					style: dirty > 0 ? SIDEBAR_TAB_WARN : SIDEBAR_TAB_MUTED
				}, dirty > 0 ? t("sidebar.dirty", { count: dirty }) : t("sidebar.clean")));
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
				const shownRefs = orderedRefs.slice(0, refBudget);
				const hiddenRefs = orderedRefs.slice(refBudget);
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
					style: Object.assign({}, SIDEBAR_TAB_ROW, {
						height: rowHeight,
						paddingLeft: geometry.width + 2,
						opacity: dimmed ? 0.62 : 1
					}, pinned ? { background: "var(--dsw-alias-bg-layer-2)" } : void 0),
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
				}, t("sidebar.conventionsSwitch")) : exists ? null : h("button", {
					key: "setup",
					type: "button",
					"data-gitgraph-action": "setup-conventions",
					style: SIDEBAR_TAB_DETAIL_BUTTON,
					onClick: () => setPickerOpen((current) => !current),
					title: t("sidebar.conventionsSetup"),
					"aria-label": t("sidebar.conventionsSetup")
				}, t("sidebar.conventionsSetup"))]);
				/**
				 * Compliance against the document's own checkable rules. It is a
				 * read, so a repository without a document says so instead of
				 * pretending everything is fine.
				 */
				const complianceLine = compliance === null ? null : (() => {
					const enforced = compliance.enforced === true;
					const failing = typeof compliance.failing === "number" ? compliance.failing : 0;
					const checked = typeof compliance.checked === "number" ? compliance.checked : 0;
					const parts = [h("span", {
						key: "text",
						style: SIDEBAR_TAB_CONVENTIONS_NOTE
					}, enforced !== true ? t("sidebar.complianceOff") : failing === 0 ? t("sidebar.complianceOk", {
						count: checked
					}) : t("sidebar.complianceMiss", {
						count: checked,
						failing
					}))];
					if (compliance.strict === true) parts.push(h("span", {
						key: "strict",
						"data-gitgraph-compliance-strict": true,
						title: t("sidebar.strictHint"),
						style: Object.assign({}, SIDEBAR_TAB_CONVENTIONS_CHIP, {
							alignSelf: "flex-start",
							color: "var(--dsw-alias-state-warn-primary, #b45309)"
						})
					}, t("sidebar.strict")));
					const offenders = compliance.offenders !== void 0 && compliance.offenders !== null ? compliance.offenders : [];
					offenders.slice(0, 3).forEach((offender) => {
						const reasons = offender.reasons !== void 0 && offender.reasons !== null ? offender.reasons.map((reason) => sidebarTabReasonLabel(t, reason)).join(", ") : "";
						parts.push(h("span", {
							key: "offender-" + offender.oid,
							"data-gitgraph-offender": offender.oid,
							style: SIDEBAR_TAB_PREVIEW_SNIPPET
						}, offender.oid + "  " + offender.subject + (reasons === "" ? "" : "  [" + reasons + "]")));
					});
					return h("div", {
						key: "compliance",
						"data-gitgraph-compliance": enforced !== true ? "none" : failing > 0 ? "failing" : "clean",
						style: SIDEBAR_TAB_COMPLIANCE
					}, parts);
				})();
				const children = [head];
				if (complianceLine !== null) children.push(complianceLine);
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
					const cards = (catalog !== null ? catalog : []).map((framework) => h("button", {
						key: "framework-" + framework.id,
						type: "button",
						"data-gitgraph-framework": framework.id,
						style: SIDEBAR_TAB_FRAMEWORK,
						disabled: conventionBusy,
						onClick: () => pickFramework(selected.path, framework.id, exists),
						title: framework.url
					}, [h("span", {
						key: "name",
						style: SIDEBAR_TAB_FRAMEWORK_NAME
					}, zh && typeof framework.nameZh === "string" ? framework.nameZh : framework.name), h("span", {
						key: "tag",
						style: SIDEBAR_TAB_FRAMEWORK_TAG
					}, zh && typeof framework.taglineZh === "string" ? framework.taglineZh : framework.tagline), h("span", {
						key: "meta",
						style: SIDEBAR_TAB_FRAMEWORK_META
					}, t("sidebar.conventionsBestFor") + (zh && typeof framework.bestForZh === "string" ? framework.bestForZh : framework.bestFor))]));
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
						onClick: () => setStrictMode((current) => current !== true)
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
							onClick: () => setConventionLang(value)
						}, value === "zh" ? t("sidebar.langZh") : value === "en" ? t("sidebar.langEn") : t("sidebar.langMixed")))));
					children.push(langRow);
					children.push(h("div", {
						key: "picker",
						"data-gitgraph-conventions-picker": true,
						style: SIDEBAR_TAB_PICKER
					}, [h("span", {
						key: "hint",
						style: SIDEBAR_TAB_CONVENTIONS_NOTE
					}, conventionBusy ? t("sidebar.conventionsWriting") : t("sidebar.conventionsPick")), strictRow].concat(cards).concat([h("button", {
						key: "scaffold",
						type: "button",
						"data-gitgraph-action": "conventions-scaffold",
						style: SIDEBAR_TAB_DETAIL_BUTTON,
						disabled: conventionBusy,
						onClick: () => writeConvention(selected.path, null)
					}, t("sidebar.conventionsScaffold")), h("button", {
						key: "cancel",
						type: "button",
						"data-gitgraph-action": "conventions-cancel",
						style: SIDEBAR_TAB_DETAIL_BUTTON,
						disabled: conventionBusy,
						onClick: () => {
							setPickerOpen(false);
							setConventionError(null);
						}
					}, t("sidebar.conventionsCancel"))])));
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
			}), refNames.length === 0 ? null : h("div", {
				key: "refs",
				style: SIDEBAR_TAB_FILTER_REFS
			}, refNames.map((ref) => {
				const muted = mutedRefs[ref] === true;
				return h("button", {
					key: "ref:" + ref,
					type: "button",
					"data-gitgraph-ref-filter": ref,
					"data-gitgraph-ref-muted": muted ? "true" : "false",
					style: muted ? Object.assign({}, SIDEBAR_TAB_CHIP, SIDEBAR_TAB_CHIP_OFF) : SIDEBAR_TAB_CHIP,
					title: t("sidebar.refFilter"),
					"aria-pressed": muted ? "false" : "true",
					onClick: () => setMutedRefs((current) => {
						const next = Object.assign({}, current);
						if (next[ref] === true) delete next[ref];
						else next[ref] = true;
						return next;
					})
				}, ref);
			}))]);
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
			return h("div", {
				style: SIDEBAR_TAB_ROOT,
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
			}, statusChildren) : null, conventionsBar, initBar, filterBar, h("div", {
				key: "body-wrap",
				style: SIDEBAR_TAB_BODY,
				"data-gitgraph-sidebar-body": true
			}, body), detail, moreChild]);
		}
