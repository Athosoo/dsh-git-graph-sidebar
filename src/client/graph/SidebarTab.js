		/** The shared element factory (the bundle's JSX helpers stay untouched). */
		const h = react.createElement;
		/** Tab id registered into better-sidebar (also its SidebarTab.type). */
		const SIDEBAR_TAB_ID = "git-graph-repos";
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
			border: "1px solid var(--dsw-alias-border-l2)",
			background: "var(--dsw-alias-bg-base)",
			color: "var(--dsw-alias-label-primary)",
			fontSize: 12,
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
			fontSize: 11,
			textAlign: "left",
			cursor: "pointer"
		};
		const SIDEBAR_TAB_TREE = {
			flex: "none",
			maxHeight: 170,
			overflowY: "auto",
			overflowX: "hidden",
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 8,
			background: "var(--dsw-alias-bg-base)",
			padding: "2px 0"
		};
		const SIDEBAR_TAB_TREE_ROW = {
			display: "flex",
			alignItems: "center",
			gap: 4,
			padding: "2px 6px 2px 0",
			fontSize: 11,
			lineHeight: "16px",
			whiteSpace: "nowrap",
			cursor: "pointer"
		};
		const SIDEBAR_TAB_TREE_DIR = {
			cursor: "default",
			color: "var(--dsw-alias-label-tertiary)"
		};
		const SIDEBAR_TAB_TREE_ACTIVE = {
			background: "var(--dsw-alias-bg-layer-2)"
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
			border: "1px solid var(--dsw-alias-border-l2)",
			background: "var(--dsw-alias-button-tool-bar-fill)",
			color: "var(--dsw-alias-label-primary)",
			borderRadius: 8,
			fontSize: 12,
			padding: "0 10px",
			cursor: "pointer"
		};
		const SIDEBAR_TAB_STATUS = {
			display: "flex",
			alignItems: "center",
			gap: 6,
			flexWrap: "wrap",
			flex: "none",
			fontSize: 11,
			minHeight: 16
		};
		const SIDEBAR_TAB_BADGE = {
			borderRadius: 999,
			background: "var(--dsw-alias-bg-layer-2)",
			color: "var(--dsw-alias-label-secondary)",
			padding: "1px 7px",
			fontSize: 10
		};
		const SIDEBAR_TAB_MUTED = {
			color: "var(--dsw-alias-label-tertiary)",
			fontSize: 11
		};
		const SIDEBAR_TAB_WARN = {
			color: "var(--dsw-alias-state-warn-primary)",
			fontSize: 11
		};
		const SIDEBAR_TAB_ERROR = {
			color: "var(--dsw-alias-state-error-primary)",
			fontSize: 12,
			padding: "12px 4px"
		};
		const SIDEBAR_TAB_EMPTY = {
			color: "var(--dsw-alias-label-tertiary)",
			fontSize: 12,
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
			fontSize: 12,
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
		const SIDEBAR_TAB_MAX_ROW_H = 44;
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
			fontSize: 10,
			color: "var(--dsw-alias-label-tertiary)"
		};
		/** Commit subject: the one elastic column of a row. */
		const SIDEBAR_TAB_SUBJECT = {
			flex: "1 1 auto",
			minWidth: 0,
			overflow: "hidden",
			textOverflow: "ellipsis",
			whiteSpace: "nowrap",
			fontSize: 12,
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
		/** Author + relative time of one row (author lives in the tooltip). */
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
			gap: 2,
			padding: "6px 8px",
			borderRadius: 8,
			border: "1px solid var(--dsw-alias-border-l1)",
			background: "var(--dsw-alias-bg-layer-2)",
			fontSize: 10,
			color: "var(--dsw-alias-label-secondary)",
			wordBreak: "break-all"
		};
		/** Full object id of the pinned commit card (monospace, wraps at the card width). */
		const SIDEBAR_TAB_DETAIL_OID = {
			fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
			fontSize: 10,
			lineHeight: "14px",
			color: "var(--dsw-alias-label-primary)",
			wordBreak: "break-all"
		};
		/** Subject line of the pinned commit card. */
		const SIDEBAR_TAB_DETAIL_SUBJECT = {
			fontSize: 11,
			lineHeight: "15px",
			color: "var(--dsw-alias-label-primary)",
			wordBreak: "break-word"
		};
		/** Square zoom control of the toolbar. */
		const SIDEBAR_TAB_ZOOM = {
			flex: "none",
			width: 24,
			height: 26,
			border: "1px solid var(--dsw-alias-border-l2)",
			background: "var(--dsw-alias-button-tool-bar-fill)",
			color: "var(--dsw-alias-label-primary)",
			borderRadius: 8,
			fontSize: 13,
			lineHeight: "24px",
			padding: 0,
			cursor: "pointer"
		};
		/**
		* Row hover / pinned surfaces and smooth lane transitions. Inline styles
		* cannot express `:hover`, so the tab ships one tiny stylesheet, injected
		* once per document.
		*/
		const SIDEBAR_TAB_CSS = [
			"[data-gitgraph-sidebar-tab] [data-gitgraph-row]{transition:background-color 120ms ease}",
			"[data-gitgraph-sidebar-tab] [data-gitgraph-row]:hover{background-color:var(--dsw-alias-bg-layer-2)}",
			"[data-gitgraph-sidebar-tab] [data-gitgraph-row][data-gitgraph-pinned=\"true\"]{background-color:var(--dsw-alias-bg-layer-2)}",
			"[data-gitgraph-sidebar-tab] [data-gitgraph-zoom]:hover{border-color:var(--dsw-alias-label-tertiary)}",
			"[data-gitgraph-sidebar-tab] [data-gitgraph-detail]{transition:opacity 120ms ease}"
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
		/**
		 * Turn the lane table into drawable geometry: one node per commit and
		 * one bezier edge per parent link. A parent outside the loaded page is
		 * drawn as an edge leaving the bottom, so a partial page still reads as
		 * a continuous graph instead of a cut-off one.
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
					const span = Math.max(8, toY - fromY);
					const d = toX === fromX ? "M" + fromX + " " + fromY + "L" + toX + " " + toY : "M" + fromX + " " + fromY + "C" + fromX + " " + (fromY + span * 0.42) + " " + toX + " " + (toY - span * 0.42) + " " + toX + " " + toY;
					segments.push({
						key: "e" + position + "-" + parentIndex,
						d,
						color: sidebarTabLaneColor(lane),
						opacity: parentIndex === 0 ? 0.95 : 0.55,
						width: parentIndex === 0 ? 1.8 : 1.5
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
		/**
		 * The better-sidebar tab body: scan the workspace for its repositories
		 * (the root repository first, then nested ones), let the user pick one,
		 * and draw that repository's branch state and commit graph as an SVG
		 * lane canvas with colored lanes, bezier merges, ref badges, per-commit
		 * zoom and a pinned commit card. Read-only by design: no branch
		 * switches, no worktree mutations.
		 * @param props - the better-sidebar TabComponentProps.
		 */
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
			/** The scan view: idle before the first run, then scanning/ready/error. */
			const [scan, setScan] = react.useState({ phase: "idle" });
			const [selectedPath, setSelectedPath] = react.useState(() => {
				const meta = tab !== void 0 && tab !== null ? tab.meta : void 0;
				return meta !== void 0 && meta !== null && typeof meta.repoPath === "string" ? meta.repoPath : void 0;
			});
			/** The graph view of the selected repository (null before the first load). */
			const [graph, setGraph] = react.useState(null);
			/** Vertical pitch of the graph rows (the zoom control). */
			const [rowHeight, setRowHeight] = react.useState(SIDEBAR_TAB_ROW_H);
			/** The commit whose card is currently pinned, by full oid. */
			const [pinnedOid, setPinnedOid] = react.useState(void 0);
			/** Whether the repository tree (level relationships) is expanded. */
			const [treeOpen, setTreeOpen] = react.useState(true);
			const graphSeq = react.useRef(0);
			const runScan = react.useCallback((refresh) => {
				if (sessionCwd === void 0) {
					setScan({
						phase: "error",
						error: t("error.workspaceUnknown")
					});
					return;
				}
				setScan({ phase: "scanning" });
				sidebarTabGit().repos(sessionCwd, refresh).then((result) => {
					if (!result.ok || result.value === null) {
						setScan({
							phase: "error",
							error: t("sidebar.error.repos")
						});
						return;
					}
					const value = result.value;
					const repos = Array.isArray(value.repos) ? value.repos : [];
					setScan({
						phase: "ready",
						repos,
						truncated: value.truncated === true
					});
					setSelectedPath((current) => {
						if (typeof current === "string" && repos.some((entry) => entry.path === current)) return current;
						return repos.length > 0 ? repos[0].path : void 0;
					});
				}).catch(() => {
					setScan({
						phase: "error",
						error: t("sidebar.error.repos")
					});
				});
			}, [sessionCwd, t]);
			const scannedFor = react.useRef();
			react.useEffect(() => {
				if (!active) return;
				if (scannedFor.current === sessionCwd) return;
				scannedFor.current = sessionCwd;
				runScan(false);
			}, [active, sessionCwd, runScan]);
			const selected = react.useMemo(() => {
				if (scan.phase !== "ready") return void 0;
				return scan.repos.find((entry) => entry.path === selectedPath);
			}, [scan, selectedPath]);
			const loadGraph = react.useCallback((limit) => {
				if (selected === void 0) return;
				const seq = graphSeq.current + 1;
				graphSeq.current = seq;
				setGraph((current) => ({
					view: current !== null ? current.view : null,
					error: null,
					loading: true
				}));
				sidebarTabGit().graph(selected.path, limit).then((result) => {
					if (seq !== graphSeq.current) return;
					if (!result.ok) setGraph({
						view: null,
						error: t("sidebar.error.graph"),
						loading: false
					});
					else if (result.value === null) setGraph({
						view: null,
						error: t("error.internal"),
						loading: false
					});
					else setGraph({
						view: result.value,
						error: null,
						loading: false
					});
				}).catch(() => {
					if (seq !== graphSeq.current) return;
					setGraph({
						view: null,
						error: t("sidebar.error.graph"),
						loading: false
					});
				});
			}, [selected, t]);
			react.useEffect(() => {
				if (!active) return;
				if (selected === void 0) {
					setGraph(null);
					return;
				}
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
			const view = graph !== null ? graph.view : null;
			const graphError = graph !== null ? graph.error : null;
			const graphLoading = graph !== null && graph.loading === true;
			const lanes = react.useMemo(() => view === null ? [] : computeLanes(view.commits), [view]);
			const laneCount = react.useMemo(() => {
				let count = 0;
				for (const row of lanes) count = Math.max(count, row.columns.length);
				return count;
			}, [lanes]);
			const geometry = react.useMemo(() => view === null ? null : sidebarTabBuildGraph(view.commits, lanes, rowHeight), [view, lanes, rowHeight]);
			/** Tree rows: the workspace root, the directories between, each repository. */
			const treeRows = react.useMemo(() => scan.phase === "ready" ? sidebarTabRepoTree(scan.repos) : [], [scan]);
			const status = selected !== void 0 && selected.status !== void 0 && selected.status !== null ? selected.status : null;
			const dirty = status === null ? 0 : (status.dirtyFiles || 0) + (status.untrackedFiles || 0);
			const toolbarChildren = [];
			toolbarChildren.push(h("button", {
				key: "refresh",
				type: "button",
				style: SIDEBAR_TAB_BUTTON,
				onClick: () => runScan(true),
				disabled: scan.phase === "scanning",
				title: t("sidebar.refresh"),
				"aria-label": t("sidebar.refresh")
			}, scan.phase === "scanning" ? t("sidebar.scanning") : t("sidebar.refresh")));
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
					style: Object.assign({}, SIDEBAR_TAB_WARN, { flex: "none", fontSize: 10 })
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
					count: view === null ? 0 : view.commits.length,
					lanes: laneCount
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
			const rows = view === null || geometry === null ? [] : view.commits.map((commit, position) => {
				const row = lanes[position];
				if (row === void 0) return null;
				const pinned = pinnedOid === commit.oid;
				const dimmed = pinnedOid !== void 0 && !pinned;
				const stacked = rowHeight >= SIDEBAR_TAB_STACK_ROW_H;
				const refBudget = stacked ? SIDEBAR_TAB_REF_MAX : 1;
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
					style: Object.assign({}, SIDEBAR_TAB_REF, refWidth, ref === view.branch ? SIDEBAR_TAB_REF_CURRENT : void 0)
				}, ref));
				if (hiddenRefs.length > 0) refNodes.push(h("span", {
					key: "ref:more",
					title: hiddenRefs.join(", "),
					style: Object.assign({}, SIDEBAR_TAB_REF, { flex: "none", color: "var(--dsw-alias-label-tertiary)" })
				}, "+" + hiddenRefs.length));
				const oidNode = h("span", {
					key: "oid",
					style: SIDEBAR_TAB_OID,
					title: commit.oid
				}, String(commit.oid).slice(0, 7));
				const subjectNode = h("span", {
					key: "subject",
					style: SIDEBAR_TAB_SUBJECT,
					title: commit.subject + " \u2014 " + commit.author
				}, commit.subject);
				const timeNode = h("span", {
					key: "meta",
					style: SIDEBAR_TAB_ROW_META,
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
						borderLeft: "2px solid " + sidebarTabLaneColor(row.nodeColumn),
						opacity: dimmed ? 0.62 : 1
					}, pinned ? { background: "var(--dsw-alias-bg-layer-2)" } : void 0),
					onClick: () => setPinnedOid(pinned ? void 0 : commit.oid),
					title: commit.subject
				}, children);
			});
			const pinned = view === null ? void 0 : view.commits.find((commit) => commit.oid === pinnedOid);
			const detail = pinned === void 0 ? null : h("div", {
				key: "detail",
				"data-gitgraph-detail": true,
				style: SIDEBAR_TAB_DETAIL
			}, h("span", {
				key: "label",
				style: SIDEBAR_TAB_MUTED
			}, t("sidebar.detail")), h("span", {
				key: "oid",
				style: SIDEBAR_TAB_DETAIL_OID,
				title: pinned.oid
			}, pinned.oid), h("span", {
				key: "subject",
				style: SIDEBAR_TAB_DETAIL_SUBJECT
			}, pinned.subject), h("span", {
				key: "meta"
			}, pinned.author + " \u00b7 " + formatTime(pinned.authorTime, t) + " \u00b7 " + t("sidebar.parents", { count: pinned.parents.length })));
			let body;
			if (scan.phase === "idle" || scan.phase === "scanning") body = h("div", { style: SIDEBAR_TAB_EMPTY }, t("sidebar.loading"));
			else if (scan.phase === "error") body = h("div", { style: SIDEBAR_TAB_ERROR }, scan.error !== void 0 && scan.error !== null ? scan.error : t("sidebar.error.repos"));
			else if (scan.repos.length === 0) body = h("div", { style: SIDEBAR_TAB_EMPTY }, t("sidebar.noRepos"));
			else if (graphError !== null) body = h("div", { style: SIDEBAR_TAB_ERROR }, graphError);
			else if (view === null) body = h("div", { style: SIDEBAR_TAB_EMPTY }, graphLoading ? t("graph.loading") : t("graph.empty"));
			else if (view.commits.length === 0) body = h("div", { style: SIDEBAR_TAB_EMPTY }, t("graph.empty"));
			else body = h("div", {
				key: "canvas-host",
				style: {
					position: "relative",
					minHeight: geometry !== null ? geometry.height : 0
				}
			}, [canvas].concat(rows));
			const moreChild = view !== null && view.hasMore === true ? h("button", {
				key: "more",
				type: "button",
				style: SIDEBAR_TAB_MORE,
				onClick: () => loadGraph(view.commits.length + PAGE_STEP)
			}, t("graph.loadMore")) : null;
			return h("div", {
				style: SIDEBAR_TAB_ROOT,
				"data-gitgraph-sidebar-tab": true
			}, h("div", { style: SIDEBAR_TAB_TOOLBAR }, toolbarChildren), treeHeader, treeList, scan.phase === "ready" && scan.truncated === true ? h("div", { style: SIDEBAR_TAB_MUTED }, t("sidebar.truncated", { limit: SIDEBAR_TAB_REPO_LIMIT })) : null, selected !== void 0 ? h("div", { style: SIDEBAR_TAB_STATUS }, statusChildren) : null, h("div", {
				style: SIDEBAR_TAB_BODY,
				"data-gitgraph-sidebar-body": true
			}, body), detail, moreChild);
		}
