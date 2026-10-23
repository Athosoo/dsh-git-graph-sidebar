/**
 * Git-graph surface plugin, browser half. The branch selector is rendered
 * only for blank sessions and mounts on `conversation.input.dock`, the
 * composer dock every shipped shell declares; in the blank-session hero phase
 * the chip joins the official hero chip row after the agent-preset seat.
 * Active sessions render no branch-selection control.
 *
 * All git facts arrive through this package's host /git routes. The inject
 * face carries the business verbs and the components remain pure props.
 * @module dsh-git-graph/client
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis';
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client';
import type { BranchesView, GitFeatureConfig, GraphView, RepoStatus, SwitchResult, WorktreeAddResult, WorktreeListView, WorktreeRemoveResult } from '../core/types.ts';
import { type GitGraphKey } from './locales.ts';
export type { GitGraphKey } from './locales.ts';
export { BranchChip } from './chips/BranchChip.tsx';
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        /** The git-graph chip copy. */
        'git-graph': GitGraphKey;
    }
}
/** Required services: slots for the dock entry, sessions for the cwd lookup, workspaces for worktree sessions, locale for the copy. */
export declare const inject: string[];
/** Injected business face of the branch chip: git verbs, keyed by the current session id. */
export interface GitGraphInjected {
    /** The workspace repository snapshot; null when not a repository. */
    repoStatus: (sessionId: SessionId | undefined) => Promise<RepoStatus | null>;
    /** Local branch list with the current branch marked. */
    branches: (sessionId: SessionId | undefined) => Promise<BranchesView | null>;
    /** Workspace-level `git switch --no-guess <branch>`. */
    switchBranch: (sessionId: SessionId | undefined, branch: string) => Promise<SwitchResult>;
    /** `git switch --no-guess -c <name>` from the current HEAD. */
    createBranch: (sessionId: SessionId | undefined, name: string) => Promise<SwitchResult>;
    /** Topo-ordered commit graph. */
    graph: (sessionId: SessionId | undefined, limit?: number) => Promise<GraphView | null>;
    /** All linked worktrees of the session's repository. */
    worktrees: (sessionId: SessionId | undefined) => Promise<WorktreeListView | null>;
    /** Create a managed worktree, register it as a workspace, and start a session in it. */
    createWorktreeSession: (sessionId: SessionId | undefined, name: string, baseRef?: string) => Promise<WorktreeAddResult>;
    /** Remove a managed worktree and unregister its workspace when linked. */
    removeWorktree: (sessionId: SessionId | undefined, worktreePath: string, opts?: {
        force?: boolean;
        deleteBranch?: boolean;
    }) => Promise<WorktreeRemoveResult>;
    /** The live feature config (auto-isolation flags + managed home). */
    gitConfig: () => Promise<GitFeatureConfig | null>;
    /** Host-pushed branch-state changes for the session's workspace. */
    subscribeChanges: (sessionId: SessionId | undefined, onChange: () => void) => () => void;
}
/**
 * Client plugin body: the branch chip entry with its git verbs, on the
 * composer's input dock.
 * @param ctx - client root context.
 */
export declare function apply(ctx: ClientContext): void;
//# sourceMappingURL=index.d.ts.map