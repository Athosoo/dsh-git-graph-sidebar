/**
 * dsh-git-graph-sidebar — host half: the workspace-gated git
 * service and its /git/* HTTP routes (JSON operations + SSE change stream)
 * on the shared webserver, plus the model-facing git_worktree tool.
 * The browser half (exports "./client") is served by client-modules from
 * the same package's dsh.client declaration.
 *
 * The UI-triggered git verbs (switch/create-branch/worktree operations) own
 * no model-visible surface. The git_worktree tool is the single, deliberate
 * exception: the sidebar renders no worktree controls, so the agent's only
 * way to create/list/remove a managed worktree is this tool, which also
 * registers the new worktree as a workspace.
 * @module dsh-git-graph-sidebar
 */

import { realpath } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-workspace'
import type { GitFeatureConfig } from './core/types.ts'
import { Config, effectiveConfig } from './host/config.ts'
import { GitService, subprocessRunner, type WorkspaceGate } from './host/git-service.ts'
import { registerGitRoutes } from './host/routes.ts'
import { buildWorktreeTool } from './host/agent-tool.js'
import { worktreesHome } from './host/worktree-home.ts'
import { mountOnce } from './mount-once.ts'

/** Required services: the route registry, the managed subprocess seam, and the workspace registry. */
export const inject = ['webServer', 'subprocess', 'workspaceRegistry']

/**
 * The plugin's Config schema, re-exported for the Host: the Loader validates
 * this row's profile patch against it and the settings service generates the
 * entry's page from it.
 */
export { Config } from './host/config.ts'
export type { ConfigInput, ResolvedConfig } from './host/config.ts'

declare module '@deepseek-ai/cordis' {
  /**
   * Loader event carrying the volatile config paths it just committed into a
   * running plugin. Declared locally: this package reads the event but does
   * not depend on `@deepseek-ai/cordis-plugin-loader`, the package that owns
   * the declaration (the running Loader emits it either way).
   */
  interface Events {
    /** Volatile config values were committed into this fiber without a remount. */
    'loader/volatile-update'(paths: readonly (readonly string[])[]): void
  }
}

/**
 * The workspace-membership gate: canonicalize the requested path and require
 * it to equal a registered workspace path. This is the security boundary of
 * the /git routes — the browser may only run git on workspace roots, never
 * arbitrary host directories.
 */
function createWorkspaceGate(ctx: Context): WorkspaceGate {
  return async (path) => {
    let canonical: string
    try {
      canonical = await realpath(path)
    } catch {
      return { ok: false, error: { code: 'workspace-unknown', message: 'path does not resolve on disk' } }
    }
    if (ctx.workspaceRegistry.list().some(workspace => workspace.path === canonical)) {
      return { ok: true, canonical }
    }
    return { ok: false, error: { code: 'workspace-unknown', message: 'path is not a registered workspace' } }
  }
}

/**
 * Mount the git service, its routes, and the model-facing worktree tool. The
 * settings page is the Host's own generation from {@link Config}: this half
 * registers no settings section.
 * @param ctx - context carrying webServer, subprocess, and workspaceRegistry.
 * @param config - the row's config as the Host resolved it (live references).
 */
export const apply = mountOnce('dsh-git-graph-sidebar', applyImpl)

function applyImpl(ctx: Context, config?: Config): void {
  const service = new GitService(subprocessRunner(ctx), createWorkspaceGate(ctx))

  // The settings subsystem commits an edit into these references without
  // remounting the row, so every read goes through effectiveConfig.
  const featureConfig = (): GitFeatureConfig => {
    const active = effectiveConfig(config)
    return {
      autoIsolate: active.autoIsolate,
      autoBaseline: active.autoBaseline,
      worktreesHome: worktreesHome(),
    }
  }

  // The git_worktree tool is the single surface the agent may use to create
  // or remove a worktree: the sidebar renders no worktree controls. The tools
  // service is awaited lazily so the plugin never hard-depends on it.
  ctx.inject(['tools'], (toolCtx: Context) => {
    toolCtx.effect(() => toolCtx.tools.register(buildWorktreeTool(ctx, service)), 'dsh-git-graph: git_worktree tool')
  })

  ctx.effect(() => registerGitRoutes(ctx, service, featureConfig), 'dsh-git-graph: /git routes')
}