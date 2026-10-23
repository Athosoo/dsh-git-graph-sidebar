/**
 * The git branch selector chip for blank sessions. It mounts on the composer's
 * input dock (`conversation.input.dock`) and, in the blank-session hero phase,
 * lifts itself into the official hero chip row immediately after the
 * agent-preset seat and before the row's trailing options group. It is
 * intentionally absent while a session is running.
 * @module dsh-git-graph/client/chips/BranchChip
 */
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { GitGraphInjected } from '../index.ts';
/** Full props of the branch chip: the input dock's runtime share (the blank-session hero) + the git-graph inject face + the locale seat. */
export type BranchChipProps = PropsRuntime<'conversation.input.dock'> & GitGraphInjected & PropsLocale<'git-graph'>;
/** Minimum gap between window-focus git refetches (ms). */
export declare const FOCUS_REFRESH_MIN_MS = 5000;
/**
 * The git branch selector chip for blank sessions.
 * @param props - the composed entry props of whichever seat it mounted in.
 */
export declare function BranchChip(props: BranchChipProps): import("react").JSX.Element | null;
//# sourceMappingURL=BranchChip.d.ts.map