import assert from 'node:assert/strict'
import test from 'node:test'
import { createDefinition, createManualRun } from '../src/domain.ts'
import { AutomationService, type AutomationConfig } from '../src/service.ts'
import type { AutomationDefinition, AutomationRun } from '../src/types.ts'

class MemoryTable<Value> {
  constructor(
    readonly records = new Map<string, Value>(),
    private readonly writable: () => boolean = () => true,
  ) {}
  get(key: string): Value | undefined { return this.records.get(key) }
  entries(): IterableIterator<[string, Value]> { return new Map(this.records).entries() }
  keys(): IterableIterator<string> { return new Map(this.records).keys() }
  get size(): number { return this.records.size }
  async put(key: string, value: Value): Promise<void> {
    if (!this.writable()) throw new Error('domain is closed')
    this.records.set(key, value)
  }
  async delete(key: string): Promise<boolean> {
    if (!this.writable()) throw new Error('domain is closed')
    return this.records.delete(key)
  }
  async update(key: string, transform: (current: Value) => Value): Promise<Value> {
    if (!this.writable()) throw new Error('domain is closed')
    const current = this.records.get(key)
    if (current === undefined) throw new Error(`missing key '${key}'`)
    const next = transform(current)
    this.records.set(key, next)
    return next
  }
}

class MemoryDomain {
  readonly definitions: MemoryTable<AutomationDefinition>
  readonly runs: MemoryTable<AutomationRun>
  closed = false
  constructor(
    definitions: readonly AutomationDefinition[] = [],
    runs: readonly AutomationRun[] = [],
  ) {
    const writable = () => !this.closed
    this.definitions = new MemoryTable(new Map(definitions.map(value => [value.id, value])), writable)
    this.runs = new MemoryTable(new Map(runs.map(value => [value.id, value])), writable)
  }
  table(name: 'definitions' | 'runs'): MemoryTable<AutomationDefinition> | MemoryTable<AutomationRun> {
    return name === 'definitions' ? this.definitions : this.runs
  }
  async close(): Promise<void> { this.closed = true }
}

const scope = { sessionId: 'session-source', creatorKind: 'web' as const }
const otherWorkspaceScope = { sessionId: 'session-other-workspace', creatorKind: 'web' as const }
const defaults: AutomationConfig = {
  maxConcurrentRuns: 0,
  runTimeoutMs: 60_000,
  misfireGraceMs: 15 * 60_000,
  historyLimit: 200,
}

function storedDefinition(now: string): AutomationDefinition {
  return createDefinition({
    id: 'automation-existing',
    name: 'Existing automation',
    prompt: 'Inspect the repository and return a bounded report.',
    schedule: { kind: 'daily', time: '09:00', timeZone: 'UTC' },
    workspaceId: 'workspace-1',
    cwd: '/workspace/repo',
    agentPreset: 'standard',
    createdBy: { kind: 'web', sessionId: scope.sessionId },
    now,
  })
}

async function harness(seed?: {
  readonly definitions?: readonly AutomationDefinition[]
  readonly runs?: readonly AutomationRun[]
  readonly config?: Partial<AutomationConfig>
  readonly resolveWorkspaceGate?: Promise<void>
  readonly onResolveWorkspace?: () => void
}): Promise<{
  service: AutomationService
  domain: MemoryDomain
  removeSourceAgent(): void
}> {
  const domain = new MemoryDomain(seed?.definitions, seed?.runs)
  const workspace = {
    id: 'workspace-1', title: 'Repository', path: '/workspace/repo',
    status: async () => 'ok' as const,
    attachSession: async () => {},
  }
  const otherWorkspace = {
    id: 'workspace-2', title: 'Other repository', path: '/workspace/other',
    status: async () => 'ok' as const,
    attachSession: async () => {},
  }
  const sourceAgent = {
    id: scope.sessionId,
    ctx: {},
    session: {
      header: { cwd: workspace.path, agentPreset: 'legacy-preset' },
      requestHeader: () => ({ config: { provider: 'current-provider', model: 'current-model' } }),
    },
  }
  const otherSourceAgent = {
    id: otherWorkspaceScope.sessionId,
    ctx: {},
    session: {
      header: { cwd: otherWorkspace.path, agentPreset: 'legacy-preset' },
      requestHeader: () => ({ config: { provider: 'current-provider', model: 'current-model' } }),
    },
  }
  let liveSourceAgent: typeof sourceAgent | undefined = sourceAgent
  const ctx = {
    storageDomain: { open: async () => domain },
    workspaceRegistry: {
      resolveByPath: async (path: string) => {
        seed?.onResolveWorkspace?.()
        await seed?.resolveWorkspaceGate
        if (path === workspace.path) return workspace
        if (path === otherWorkspace.path) return otherWorkspace
        return undefined
      },
      get: () => workspace,
    },
    agents: {
      get: (id: string) => {
        if (id === liveSourceAgent?.id) return liveSourceAgent
        if (id === otherSourceAgent.id) return otherSourceAgent
        return undefined
      },
      withoutInitiator: (task: () => unknown) => task(),
      create: async () => { throw new Error('executor is not expected in service unit tests') },
    },
    agentDefaultModel: { currentSelection: () => ({ provider: 'provider', model: 'model' }) },
    agentPresets: {
      mount: async () => ({ id: 'standard' }),
      composedPreset: () => 'code',
    },
    sessions: { flush: async () => true },
    logger: { warn: () => {} },
  }
  const service = await AutomationService.open(ctx as never, { ...defaults, ...seed?.config })
  return {
    service,
    domain,
    removeSourceAgent: () => { liveSourceAgent = undefined },
  }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 100; index += 1) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error('condition did not become true')
}

async function flushMicrotasks(rounds = 30): Promise<void> {
  for (let index = 0; index < rounds; index += 1) await Promise.resolve()
}

test('run now admits at most one queued or running occurrence per automation', async () => {
  const { service } = await harness()
  const definition = await service.create(scope, {
    name: 'Regression triage',
    prompt: 'Inspect test failures and return evidence without editing files.',
    schedule: { kind: 'daily', time: '09:00', timeZone: 'UTC' },
  })
  const first = await service.runNow(scope, definition.id)
  assert.equal(definition.agentPreset, 'code')
  assert.equal(definition.provider, 'current-provider')
  assert.equal(definition.model, 'current-model')
  assert.equal(first.status, 'queued')
  await assert.rejects(() => service.runNow(scope, definition.id), /queued or running/)
  await service.dispose()
})

test('concurrent updates are serialized and a deletion cannot be resurrected', async () => {
  const { service } = await harness()
  const definition = await service.create(scope, {
    name: 'Health report',
    prompt: 'Inspect repository health.',
    schedule: { kind: 'daily', time: '09:00', timeZone: 'UTC' },
  })
  await Promise.all([
    service.update(scope, definition.id, { name: 'Repository health' }),
    service.update(scope, definition.id, { prompt: 'Inspect repository health and cite files.' }),
  ])
  const updated = (await service.snapshot(scope)).definitions[0]!
  assert.equal(updated.revision, 3)
  assert.equal(updated.name, 'Repository health')
  assert.match(updated.prompt, /cite files/)

  const deleting = service.delete(scope, definition.id)
  const staleUpdate = service.update(scope, definition.id, { name: 'Must not reappear' })
  await deleting
  await assert.rejects(() => staleUpdate, /unknown automation/)
  assert.equal((await service.snapshot(scope)).definitions.length, 0)
  await service.dispose()
})

test('one update that changes fields and status advances the definition revision once', async () => {
  const { service } = await harness()
  const definition = await service.create(scope, {
    name: 'Combined update',
    prompt: 'Inspect repository health.',
    schedule: { kind: 'daily', time: '09:00', timeZone: 'UTC' },
  })

  const paused = await service.update(scope, definition.id, {
    name: 'Paused health report',
    status: 'paused',
  })
  assert.equal(paused.revision, definition.revision + 1)
  assert.equal(paused.name, 'Paused health report')
  assert.equal(paused.status, 'paused')
  await service.dispose()
})

test('mark read is workspace-scoped and clears durable attention state', async () => {
  const definition = storedDefinition('2026-08-13T00:00:00Z')
  const failed: AutomationRun = {
    ...createManualRun(definition, '2026-08-13T00:05:00Z', 'unread-failure'),
    status: 'failed',
    finishedAt: '2026-08-13T00:06:00Z',
    error: { code: 'fixture', message: 'failed run' },
    unread: true,
  }
  // Deleted definitions deliberately leave their runs behind for audit. Those
  // retained failures must still be dismissible by a Session in the same
  // workspace, or the UI's attention count can never clear.
  const { service, domain } = await harness({ runs: [failed] })

  const updated = await service.markRead(scope, failed.id)
  assert.equal(updated.unread, false)
  assert.equal(domain.runs.get(failed.id)?.unread, false)

  await assert.rejects(
    () => service.markRead({ sessionId: 'unknown-session', creatorKind: 'web' }, failed.id),
    /live source session/,
  )
  await assert.rejects(
    () => service.markRead(otherWorkspaceScope, failed.id),
    /another workspace/,
  )
  await service.dispose()
})

test('mark read is serialized ahead of disposal so it cannot write after domain close', async () => {
  const definition = storedDefinition('2026-08-13T00:00:00Z')
  const failed: AutomationRun = {
    ...createManualRun(definition, '2026-08-13T00:05:00Z', 'mark-read-dispose'),
    status: 'failed',
    finishedAt: '2026-08-13T00:06:00Z',
    error: { code: 'fixture', message: 'failed run' },
    unread: true,
  }
  let releaseWorkspace = () => {}
  const resolveWorkspaceGate = new Promise<void>(resolve => { releaseWorkspace = resolve })
  let reportResolveStarted = () => {}
  const resolveStarted = new Promise<void>(resolve => { reportResolveStarted = resolve })
  const { service, domain } = await harness({
    runs: [failed],
    resolveWorkspaceGate,
    onResolveWorkspace: reportResolveStarted,
  })

  const marking = service.markRead(scope, failed.id)
  await resolveStarted
  const disposing = service.dispose()
  await new Promise<void>(resolve => setImmediate(resolve))
  const closedBeforeMutationSettled = domain.closed
  releaseWorkspace()
  const [markResult, disposeResult] = await Promise.allSettled([marking, disposing])

  assert.equal(closedBeforeMutationSettled, false, 'dispose must drain an admitted mark-read mutation')
  assert.equal(markResult.status, 'fulfilled')
  assert.equal(disposeResult.status, 'fulfilled')
  assert.equal(domain.runs.get(failed.id)?.unread, false)
  assert.equal(domain.closed, true)
})

test('snapshot holds the domain read lease until workspace resolution completes', async () => {
  let releaseWorkspace = () => {}
  const resolveWorkspaceGate = new Promise<void>(resolve => { releaseWorkspace = resolve })
  let reportResolveStarted = () => {}
  const resolveStarted = new Promise<void>(resolve => { reportResolveStarted = resolve })
  const { service, domain } = await harness({
    resolveWorkspaceGate,
    onResolveWorkspace: reportResolveStarted,
  })

  const snapshotting = service.snapshot(scope)
  await resolveStarted
  const disposing = service.dispose()
  await new Promise<void>(resolve => setImmediate(resolve))
  const closedBeforeSnapshotSettled = domain.closed
  releaseWorkspace()
  const [snapshotResult, disposeResult] = await Promise.allSettled([snapshotting, disposing])

  assert.equal(closedBeforeSnapshotSettled, false, 'dispose must drain an admitted snapshot')
  assert.equal(snapshotResult.status, 'fulfilled')
  assert.equal(disposeResult.status, 'fulfilled')
  assert.equal(domain.closed, true)
})

test('a source Session disposed during workspace resolution cannot mutate durable state', async () => {
  const definition = storedDefinition('2026-08-13T00:00:00Z')
  let releaseWorkspace = () => {}
  const resolveWorkspaceGate = new Promise<void>(resolve => { releaseWorkspace = resolve })
  let reportResolveStarted = () => {}
  const resolveStarted = new Promise<void>(resolve => { reportResolveStarted = resolve })
  const { service, domain, removeSourceAgent } = await harness({
    definitions: [definition],
    resolveWorkspaceGate,
    onResolveWorkspace: reportResolveStarted,
  })

  const mutation = service.runNow(scope, definition.id)
  await resolveStarted
  removeSourceAgent()
  releaseWorkspace()

  await assert.rejects(mutation, /live source session/)
  assert.equal(domain.runs.size, 0)
  await service.dispose()
})

test('a mutation cancelled while waiting for the service queue never writes durable state', async () => {
  const definition = storedDefinition('2026-08-13T00:00:00Z')
  const failed: AutomationRun = {
    ...createManualRun(definition, '2026-08-13T00:05:00Z', 'queue-blocker'),
    status: 'failed',
    finishedAt: '2026-08-13T00:06:00Z',
    error: { code: 'fixture', message: 'failed run' },
    unread: true,
  }
  let releaseWorkspace = () => {}
  const resolveWorkspaceGate = new Promise<void>(resolve => { releaseWorkspace = resolve })
  let reportResolveStarted = () => {}
  const resolveStarted = new Promise<void>(resolve => { reportResolveStarted = resolve })
  const { service, domain } = await harness({
    definitions: [definition],
    runs: [failed],
    resolveWorkspaceGate,
    onResolveWorkspace: reportResolveStarted,
  })
  const blockingMutation = service.markRead(scope, failed.id)
  await resolveStarted

  const controller = new AbortController()
  const cancelledMutation = (service.runNow as unknown as (
    requestScope: typeof scope,
    automationId: string,
    signal: AbortSignal,
  ) => Promise<AutomationRun>)(scope, definition.id, controller.signal)
  controller.abort()
  releaseWorkspace()

  await blockingMutation
  await assert.rejects(cancelledMutation, /cancelled/)
  assert.deepEqual([...domain.runs.records.keys()], [failed.id])
  await service.dispose()
})

test('a snapshot cancelled while waiting for the service queue does not enter workspace resolution', async () => {
  const definition = storedDefinition('2026-08-13T00:00:00Z')
  const failed: AutomationRun = {
    ...createManualRun(definition, '2026-08-13T00:05:00Z', 'snapshot-queue-blocker'),
    status: 'failed',
    finishedAt: '2026-08-13T00:06:00Z',
    error: { code: 'fixture', message: 'failed run' },
    unread: true,
  }
  let releaseWorkspace = () => {}
  const resolveWorkspaceGate = new Promise<void>(resolve => { releaseWorkspace = resolve })
  let resolves = 0
  let reportFirstResolveStarted = () => {}
  const firstResolveStarted = new Promise<void>(resolve => { reportFirstResolveStarted = resolve })
  const { service } = await harness({
    runs: [failed],
    resolveWorkspaceGate,
    onResolveWorkspace: () => {
      resolves += 1
      if (resolves === 1) reportFirstResolveStarted()
    },
  })
  const blockingMutation = service.markRead(scope, failed.id)
  await firstResolveStarted

  const controller = new AbortController()
  const cancelledSnapshot = service.snapshot(scope, controller.signal)
  controller.abort()
  releaseWorkspace()

  await blockingMutation
  await assert.rejects(cancelledSnapshot, /cancelled/)
  assert.equal(resolves, 1)
  await service.dispose()
})

test('opening after a host stop terminalizes queued work without rerunning it', async () => {
  const definition = storedDefinition('2026-08-13T00:00:00Z')
  const queued = createManualRun(definition, '2026-08-13T00:05:00Z', 'interrupted')
  const { service, domain } = await harness({ definitions: [definition], runs: [queued] })
  const recovered = domain.runs.get(queued.id)!
  assert.equal(recovered.status, 'failed')
  assert.equal(recovered.error?.code, 'host_interrupted')
  assert.equal(recovered.unread, true)
  await service.dispose()
  assert.equal(domain.closed, true)
})

test('durable retention is bounded per automation and keeps automation session identity', async () => {
  const definition = storedDefinition('2026-08-13T00:00:00Z')
  const otherDefinition = createDefinition({
    ...definition,
    id: 'automation-other',
    name: 'Other automation',
    now: '2026-08-13T00:00:00Z',
  })
  const oldRun: AutomationRun = {
    ...createManualRun(definition, '2026-08-13T00:01:00Z', 'old'),
    status: 'succeeded',
    finishedAt: '2026-08-13T00:02:00Z',
  }
  const newRun: AutomationRun = {
    ...createManualRun(definition, '2026-08-13T00:03:00Z', 'new'),
    status: 'failed',
    finishedAt: '2026-08-13T00:04:00Z',
    error: { code: 'fixture', message: 'newer terminal result' },
  }
  const activeRun = createManualRun(definition, '2026-08-13T00:05:00Z', 'active')
  const otherRun: AutomationRun = {
    ...createManualRun(otherDefinition, '2026-08-13T00:00:30Z', 'other'),
    status: 'succeeded',
    sessionId: 'session-other-automation',
    finishedAt: '2026-08-13T00:00:45Z',
  }
  const { service, domain } = await harness({
    definitions: [definition, otherDefinition],
    runs: [oldRun, newRun, activeRun, otherRun],
    config: { historyLimit: 1 },
  })
  assert.equal(domain.runs.get(oldRun.id), undefined)
  // Startup recovery terminalizes the active record before retention, so only
  // the newest recovered terminal remains at a limit of one.
  assert.equal(domain.runs.get(activeRun.id)?.status, 'failed')
  assert.equal(domain.runs.get(newRun.id), undefined)
  assert.equal(domain.runs.get(otherRun.id)?.status, 'succeeded')
  assert.equal(service.ownsSession(otherRun.sessionId!), true)
  assert.equal(service.ownsSession('dsh-automation-session-pruned-before-prompt'), true)
  assert.equal(service.ownsSession('session-pruned', [{
    type: 'user/message',
    data: { source: { kind: 'automation', automationId: definition.id } },
  }]), true)
  assert.equal(service.ownsSession('session-human', [{
    type: 'user/message',
    data: { source: { kind: 'user' } },
  }]), false)
  await service.dispose()
})

test('a queued run whose definition is deleted still enforces terminal retention', async () => {
  const { service, domain } = await harness({
    config: { maxConcurrentRuns: 1, historyLimit: 1 },
  })
  const definition = await service.create(scope, {
    name: 'Deletion race',
    prompt: 'Inspect one bounded condition.',
    schedule: { kind: 'daily', time: '09:00', timeZone: 'UTC' },
  })
  const oldRun: AutomationRun = {
    ...createManualRun(definition, '2026-08-13T00:01:00Z', 'old-retained'),
    status: 'succeeded',
    finishedAt: '2026-08-13T00:02:00Z',
  }
  await domain.runs.put(oldRun.id, oldRun)
  const queued = await service.runNow(scope, definition.id)
  await service.delete(scope, definition.id)

  service.start()
  await waitFor(() => domain.runs.get(queued.id)?.status === 'failed')
  const related = [...domain.runs.records.values()]
    .filter(run => run.automationId === definition.id)
  assert.equal(domain.runs.get(queued.id)?.error?.code, 'definition_deleted')
  assert.deepEqual(related.map(run => run.id), [queued.id])
  await service.dispose()
})

test('the clock dispatches a due one-time occurrence exactly once without run-now', async (context) => {
  const now = Date.parse('2026-08-13T00:00:00Z')
  context.mock.timers.enable({ apis: ['Date', 'setTimeout'], now })
  const { service, domain } = await harness({ config: { maxConcurrentRuns: 1 } })
  const at = new Date(now + 60_000).toISOString()
  const definition = await service.create(scope, {
    name: 'Actual clock occurrence',
    prompt: 'Inspect one bounded condition.',
    schedule: { kind: 'once', at, timeZone: 'UTC' },
  })

  service.start()
  await flushMicrotasks()
  context.mock.timers.tick(59_999)
  await flushMicrotasks()
  assert.equal(domain.runs.size, 0)

  context.mock.timers.tick(1)
  await flushMicrotasks()
  const runs = [...domain.runs.records.values()]
  assert.equal(runs.length, 1)
  assert.equal(runs[0]?.automationId, definition.id)
  assert.equal(runs[0]?.trigger, 'schedule')
  assert.equal(runs[0]?.scheduledFor, at)
  assert.equal(runs[0]?.status, 'failed')
  assert.equal(runs[0]?.error?.code, 'executor_error')

  context.mock.timers.tick(60_000)
  await flushMicrotasks()
  assert.equal(domain.runs.size, 1)
  await service.dispose()
})

test('pause blocks a due interval and resume waits for the next future occurrence', async (context) => {
  const now = Date.parse('2026-08-13T00:00:00Z')
  context.mock.timers.enable({ apis: ['Date', 'setTimeout'], now })
  const { service, domain } = await harness({ config: { maxConcurrentRuns: 1 } })
  const definition = await service.create(scope, {
    name: 'Pause and resume',
    prompt: 'Inspect one bounded condition.',
    schedule: { kind: 'interval', everyMinutes: 5, anchor: new Date(now).toISOString(), timeZone: 'UTC' },
  })
  await service.update(scope, definition.id, { status: 'paused' })
  service.start()
  await flushMicrotasks()

  context.mock.timers.tick(5 * 60_000)
  await flushMicrotasks()
  assert.equal(domain.runs.size, 0, 'a paused definition must not claim the due occurrence')

  await service.update(scope, definition.id, { status: 'active' })
  await flushMicrotasks()
  assert.equal(domain.runs.size, 0, 'resume must not replay the occurrence at the activation boundary')

  context.mock.timers.tick(5 * 60_000)
  await flushMicrotasks()
  const runs = [...domain.runs.records.values()]
  assert.equal(runs.length, 1)
  assert.equal(runs[0]?.trigger, 'schedule')
  assert.equal(runs[0]?.scheduledFor, new Date(now + 10 * 60_000).toISOString())
  await service.dispose()
})

test('scheduler materializes only the latest due interval and records overlap', async () => {
  const anchorMs = Date.now() - 6 * 60_000
  const anchor = new Date(anchorMs).toISOString()
  const definition = createDefinition({
    id: 'automation-interval',
    name: 'Interval check',
    prompt: 'Inspect one bounded condition.',
    schedule: { kind: 'interval', everyMinutes: 5, anchor, timeZone: 'UTC' },
    workspaceId: 'workspace-1',
    cwd: '/workspace/repo',
    agentPreset: 'standard',
    createdBy: { kind: 'web', sessionId: scope.sessionId },
    now: new Date(anchorMs - 60_000).toISOString(),
  })
  const { service, domain } = await harness({ definitions: [definition] })
  try {
    const manual = await service.runNow(scope, definition.id)
    service.start()
    await waitFor(() => domain.runs.records.size === 2)
    const scheduled = [...domain.runs.records.values()].find(run => run.trigger === 'schedule')!
    assert.equal(manual.status, 'queued')
    assert.equal(scheduled.status, 'skipped')
    assert.equal(scheduled.error?.code, 'overlap')
    assert.equal(Date.parse(scheduled.scheduledFor), Date.parse(anchor) + 5 * 60_000)
  } finally {
    await service.dispose()
  }
})
