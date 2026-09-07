/**
 * ModelDirectoryResolver (`ctx.modelDirectories`): the root owner of per-session
 * {@link ModelDirectory} instances. Both selection entries (the /model popup
 * and the composer model seat) resolve their session's directory through
 * this service, which is what makes the dual entry one shared state.
 *
 * Per-session storage follows the client service pattern (InputTriggerService /
 * CommandUiRuntime): a lazy service-internal map whose entry is deleted by the
 * owning scope's disposer. The host `dsh-scope` ScopedLayers registry does
 * does not belong here: it derives scope from the host carrier mechanism
 * (object-keyed), while client scopes tag contexts with branded SessionId
 * strings, and it models global+shadow named registries — this is a
 * per-session singleton with no global layer to merge.
 */
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle, SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionRuntime } from '@deepseek-ai/dsh-client-runtime/client'
import type { ComposerAttachment } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { ModelDirectory } from './directory.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    modelDirectories: ModelDirectoryResolver
  }
}

/** Live mutable state in one holder (service methods run behind the caller-ctx tracker). */
interface LiveState {
  /** Per-session directories; entries are deleted by their scope disposer. */
  readonly directories: Map<SessionId, ModelDirectory>
}

/** The `ctx.modelDirectories` session model-selection service. */
export class ModelDirectoryResolver extends Service {
  static inject = ['connection', 'sessions', 'remote']

  private readonly live: LiveState = { directories: new Map() }

  /** Localized composer-block copy; this plugin owns the string it raises. */
  private readonly blockReason: () => string
  /** Localized image-capability refusal; read when a prompt is attempted. */
  private readonly imageReason: () => string

  /**
   * @param ctx - owning root context (the service registers itself as `models`).
   * @param config - bound translators for this plugin's own composer copy.
   */
  constructor(ctx: Context, config: { blockReason: () => string; imageReason: () => string }) {
    super(ctx, 'modelDirectories')
    this.blockReason = config.blockReason
    this.imageReason = config.imageReason
    ctx.on('connection/reset', () => {
      for (const directory of this.live.directories.values()) directory.resetConnected()
    })
    // Either source can change the directory: registry topology commits and
    // settings documents that carry provider catalogs or default selection.
    const refresh = (): void => {
      for (const directory of this.live.directories.values()) {
        directory.load().catch(() => undefined)
      }
    }
    ctx.remote.$on('llm/adapters-updated', refresh)
    ctx.remote.$on('settings/document-updated', refresh)
  }

  /**
   * Resolve the per-session shared directory (lazy; the scope disposer
   * removes and disposes it). Unknown sessions fail loud.
   * @param sessionId - the owning session.
   * @returns the resident directory both entries share.
   */
  directoryFor(sessionId: SessionId): ModelDirectory {
    const { live } = this
    const existing = live.directories.get(sessionId)
    if (existing !== undefined) return existing
    const sessions = this.ctx.get('sessions') as SessionRuntime
    const actx = sessions.scope(sessionId)
    if (actx === undefined) throw new Error(`ui-model-selection: session "${String(sessionId)}" resolved no scope`)
    const connection = this.ctx.get('connection') as ConnectionHandle
    const directory = new ModelDirectory(
      connection.api.sessions,
      sessionId,
      () => sessions.subagentAddress(sessionId) === undefined,
    )
    live.directories.set(sessionId, directory)
    // The composer cannot read this plugin (the dependency runs one way), so
    // this plugin publishes route and image-capability blocks into its service.
    // Unknown route or modality metadata remains permissive.
    const conversation = this.ctx.get('conversation')
    if (conversation !== undefined) {
      const input = conversation.input.for(actx)
      const imageIncompatible = (): boolean => {
        const modalities = directory.store.getSnapshot().currentModel?.inputModalities
        if (modalities === undefined || modalities.includes('image')) return false
        return conversation.draftAttachments(input.state.getSnapshot().attachmentIds)
          .some((attachment: ComposerAttachment) => attachment.kind === 'image')
      }
      const publish = (): void => {
        const { routable } = directory.store.getSnapshot()
        conversation.blocks.set(sessionId, routable === false
          ? { reason: this.blockReason() }
          : imageIncompatible()
            ? { reason: this.imageReason() }
            : undefined)
      }
      publish()
      const disposePolicy = this.ctx.effect(() => {
        const stopDirectory = directory.store.subscribe(publish)
        const stopInput = input.state.subscribe(publish)
        const unregisterAdmission = conversation.registerPromptAdmission(sessionId, (attachments: readonly ComposerAttachment[]) =>
          attachments.some((attachment: ComposerAttachment) => attachment.kind === 'image')
          && directory.store.getSnapshot().currentModel?.inputModalities?.includes('image') === false
            ? this.imageReason()
            : undefined)
        return () => {
          stopDirectory()
          stopInput()
          unregisterAdmission()
          conversation.blocks.set(sessionId, undefined)
        }
      }, 'ui-model-selection: composer policy plugin owner')
      actx.effect(() => disposePolicy, 'ui-model-selection: composer policy session owner')
    }
    const disposeDirectory = this.ctx.effect(() => () => {
      directory.dispose()
      if (live.directories.get(sessionId) === directory) live.directories.delete(sessionId)
    }, 'ui-model-selection: session directory plugin owner')
    actx.effect(() => disposeDirectory, 'ui-model-selection: session directory session owner')
    return directory
  }
}
