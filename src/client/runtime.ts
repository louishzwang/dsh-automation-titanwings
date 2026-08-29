import type { ClientLlmApi, ClientRpc } from './contracts.js'
import type {
  ArchiveRunRequest,
  AutomationSnapshot,
  CreateAutomationInput,
  CreateRequest,
  DeleteRunRequest,
  MarkReadRequest,
  MutateRequest,
  RunNowRequest,
  SnapshotRequest,
  UpdateAutomationInput,
  UpdateRequest,
  ModelCatalog,
} from './protocol.js'
import { unwrapRpcResult } from './protocol.js'

const CHANNEL = '/dsh-automation'

export interface AutomationClientState {
  readonly phase: 'idle' | 'loading' | 'ready' | 'error'
  readonly snapshot?: AutomationSnapshot
  readonly error?: string
  readonly refreshedAt?: number
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
  runNow(automationId: string): Promise<void>
  markRunRead(runId: string): Promise<void>
  archiveRun(runId: string): Promise<void>
  deleteRun(runId: string): Promise<void>
  openRunSession(runId: string, open: () => Promise<void>): Promise<void>
}

/** Read the Host-wide catalog without discarding sound providers when peers fail. */
export async function loadModelCatalog(api: ClientLlmApi): Promise<ModelCatalog> {
  const response = await api.models({})
  return unwrapRpcResult<ModelCatalog>(response.result)
}

/** One session-scoped observable; the framework binds it into useAutomationState. */
export function createAutomationRuntime(rpc: ClientRpc, sessionId: string): AutomationRuntime {
  let state: AutomationClientState = { phase: 'idle' }
  let refreshPromise: Promise<void> | undefined
  const listeners = new Set<() => void>()
  const publish = (next: AutomationClientState): void => {
    state = next
    for (const listener of [...listeners]) listener()
  }
  const source: AutomationStateSource = {
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
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
        publish({ phase: 'ready', snapshot, refreshedAt: Date.now() })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        publish(previous === undefined
          ? { phase: 'error', error: message }
          : {
              phase: 'error',
              snapshot: previous,
              error: message,
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
    await refresh()
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
    async runNow(automationId) {
      const payload: RunNowRequest = { sessionId, automationId }
      await mutateThenRefresh('run-now', payload)
    },
    markRunRead,
    archiveRun,
    deleteRun,
    async openRunSession(runId, open) {
      // A failed navigation must leave the run unread so it still asks for
      // attention. Mark it only after the destination Session is available.
      await open()
      await markRunRead(runId)
    },
  }
}
