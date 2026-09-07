import type { ClientRemote, ClientRpc } from './contracts.js'
import type {
  ArchiveRunRequest,
  AutomationSnapshot,
  CreateAutomationInput,
  CreateRequest,
  DeleteRunRequest,
  MarkReadRequest,
  MutateRequest,
  RunNowRequest,
  RunNowMode,
  SettingsUpdateInput,
  SnapshotRequest,
  UpdateAutomationInput,
  UpdateRequest,
  UpdateSettingsRequest,
  ModelCatalog,
} from './protocol.js'
import { unwrapRpcResult } from './protocol.js'

const CHANNEL = '/dsh-automation'

export interface AutomationClientState {
  readonly phase: 'idle' | 'loading' | 'ready' | 'error' | 'unavailable'
  readonly snapshot?: AutomationSnapshot
  readonly error?: string
  readonly refreshedAt?: number
  readonly refreshAfterMutationFailed?: boolean
}

export interface AutomationStateSource {
  getSnapshot(): AutomationClientState
  subscribe(listener: () => void): () => void
}

export interface AutomationRuntime {
  readonly source: AutomationStateSource
  refresh(): Promise<void>
  createAutomation(input: CreateAutomationInput): Promise<void>
  updateAutomation(automationId: string, expectedRevision: number, input: UpdateAutomationInput): Promise<void>
  mutateAutomation(automationId: string, mutation: MutateRequest['mutation']): Promise<void>
  runNow(automationId: string, mode: RunNowMode): Promise<void>
  markRunRead(runId: string): Promise<void>
  confirmRun(runId: string): Promise<void>
  retryRun(runId: string): Promise<void>
  archiveRun(runId: string): Promise<void>
  deleteRun(runId: string): Promise<void>
  updateSettings(settings: SettingsUpdateInput): Promise<void>
  openRunSession(runId: string, open: () => Promise<void>): Promise<void>
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function named(value: unknown): value is Record<string, unknown> & { id: string; name: string } {
  return object(value) && typeof value.id === 'string' && value.id.trim() !== '' && typeof value.name === 'string'
}
function model(value: unknown): boolean {
  if (!named(value) || (value.description !== undefined && typeof value.description !== 'string')) return false
  if (value.reasoning === undefined) return true
  const reasoning = value.reasoning
  return object(reasoning) && Array.isArray(reasoning.efforts)
    && reasoning.efforts.every(effort => named(effort)
      && (effort.description === undefined || typeof effort.description === 'string'))
    && (reasoning.defaultEffort === undefined || typeof reasoning.defaultEffort === 'string')
}

/** Keep valid provider/model rows and explicitly report malformed partial responses. */
export async function loadModelCatalog(remote: ClientRemote): Promise<ModelCatalog> {
  const value: unknown = unwrapRpcResult(await remote.session.modelCatalog())
  if (!object(value) || !Array.isArray(value.groups) || !Array.isArray(value.failures)) {
    throw new Error('The model catalog returned an invalid response.')
  }
  let changed = false
  const failures: Array<{ id: string; name: string; message: string }> = []
  for (const failure of value.failures) {
    if (named(failure) && typeof failure.message === 'string') {
      failures.push({ id: failure.id, name: failure.name, message: failure.message })
    } else {
      changed = true
      failures.push({ id: 'invalid-failure', name: 'Model catalog', message: 'The model catalog returned an invalid failure record.' })
    }
  }
  const groups: ModelCatalog['groups'][number][] = []
  for (const [index, group] of value.groups.entries()) {
    if (!named(group) || !Array.isArray(group.models)) {
      changed = true
      failures.push({ id: named(group) ? group.id : 'invalid-provider-' + index,
        name: named(group) ? group.name : 'Model catalog', message: 'The provider returned an invalid model catalog.' })
      continue
    }
    const models = group.models.filter(model)
    if (models.length !== group.models.length) {
      changed = true
      failures.push({ id: group.id, name: group.name, message: 'Some invalid model entries were omitted. You can retry loading this provider.' })
    }
    groups.push({ id: group.id, name: group.name, models: models as ModelCatalog['groups'][number]['models'] })
  }
  return changed ? { groups, failures } : value as unknown as ModelCatalog
}

/** One session-scoped observable; the framework binds it into useAutomationState. */
export function createAutomationRuntime(rpc: ClientRpc, sessionId: string): AutomationRuntime {
  let state: AutomationClientState = { phase: 'idle' }
  let refreshPromise: Promise<void> | undefined
  const listeners = new Set<() => void>()
  let subscribed = false
  let committedMutation = false
  const publish = (next: AutomationClientState): void => {
    state = subscribed && listeners.size === 0 ? { phase: 'idle' } : next
    for (const listener of [...listeners]) listener()
  }
  const source: AutomationStateSource = {
    getSnapshot: () => state,
    subscribe: (listener) => {
      subscribed = true
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
        // Preserve identity during StrictMode replay, but release inactive sessions' snapshots.
        queueMicrotask(() => { if (listeners.size === 0) state = { phase: 'idle' } })
      }
    },
  }

  const refresh = async (): Promise<void> => {
    if (refreshPromise !== undefined) return refreshPromise
    const previous = state.snapshot
    publish(previous === undefined
      ? { phase: 'loading' }
      : {
          phase: 'loading',
          snapshot: previous,
          ...(state.refreshedAt === undefined ? {} : { refreshedAt: state.refreshedAt }),
        })
    refreshPromise = (async () => {
      try {
        const payload: SnapshotRequest = { sessionId }
        const response = await rpc.call(CHANNEL, 'snapshot', payload)
        const snapshot = unwrapRpcResult<AutomationSnapshot>(response)
        committedMutation = false
        publish({ phase: 'ready', snapshot, refreshedAt: Date.now() })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        // The source conversation has no live Agent yet (switching to a
        // fresh/resuming conversation): show a friendly prompt instead of a
        // hard error and let the poll recover once the Agent exists.
        const unavailable = /requires a live source session/.test(message)
        const phase = unavailable ? 'unavailable' : 'error'
        publish(previous === undefined
          ? { phase, error: message, refreshAfterMutationFailed: committedMutation }
          : {
              phase,
              snapshot: previous,
              error: message,
              refreshAfterMutationFailed: committedMutation,
              ...(state.refreshedAt === undefined ? {} : { refreshedAt: state.refreshedAt }),
            })
        throw error
      } finally {
        refreshPromise = undefined
      }
    })()
    return refreshPromise
  }

  const mutateThenRefresh = async (endpoint: string, payload: unknown): Promise<void> => {
    unwrapRpcResult<unknown>(await rpc.call(CHANNEL, endpoint, payload))
    // A poll may have started before the mutation completed. Let it settle,
    // then require a post-mutation snapshot instead of accepting stale data.
    const pendingBeforeRefresh = refreshPromise
    if (pendingBeforeRefresh !== undefined) await pendingBeforeRefresh.catch(() => undefined)
    committedMutation = true
    // The write was acknowledged. A read failure must never invite resubmission.
    await refresh().catch(() => undefined)
  }
  const markRunRead = async (runId: string): Promise<void> => {
    const payload: MarkReadRequest = { sessionId, runId }
    await mutateThenRefresh('mark-read', payload)
  }
  const archiveRun = async (runId: string): Promise<void> => {
    const payload: ArchiveRunRequest = { sessionId, runId }
    await mutateThenRefresh('archive-run', payload)
  }
  const deleteRun = async (runId: string): Promise<void> => {
    const payload: DeleteRunRequest = { sessionId, runId }
    await mutateThenRefresh('delete-run', payload)
  }

  return {
    source,
    refresh,
    async createAutomation(input) {
      const payload: CreateRequest = { sessionId, input }
      await mutateThenRefresh('create', payload)
    },
    async updateAutomation(automationId, expectedRevision, input) {
      const payload: UpdateRequest = { sessionId, automationId, expectedRevision, input }
      await mutateThenRefresh('update', payload)
    },
    async mutateAutomation(automationId, mutation) {
      const payload: MutateRequest = { sessionId, automationId, mutation }
      await mutateThenRefresh('mutate', payload)
    },
    async runNow(automationId, mode) {
      const payload: RunNowRequest = { sessionId, automationId, mode }
      await mutateThenRefresh('run-now', payload)
    },
    markRunRead,
    async confirmRun(runId) { await mutateThenRefresh('confirm-run', { sessionId, runId }) },
    async retryRun(runId) { await mutateThenRefresh('retry-run', { sessionId, runId }) },
    archiveRun,
    deleteRun,
    async updateSettings(settings) {
      const payload: UpdateSettingsRequest = { sessionId, settings }
      await mutateThenRefresh('settings-update', payload)
    },
    async openRunSession(runId, open) {
      // A failed navigation must leave the run unread so it still asks for
      // attention. Mark it only after the destination Session is available.
      await open()
      if (source.getSnapshot().snapshot?.runResolutionSupported === true) {
        await mutateThenRefresh('read-run', { sessionId, runId })
      } else await markRunRead(runId)
    },
  }
}
