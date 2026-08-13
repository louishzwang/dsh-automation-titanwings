import assert from 'node:assert/strict'
import test from 'node:test'
import { createDefinition, createManualRun } from '../src/domain.ts'
import { AutomationService, type AutomationConfig } from '../src/service.ts'
import type { AutomationDefinition, AutomationRun } from '../src/types.ts'

class MemoryTable<Value> {
  constructor(readonly records = new Map<string, Value>()) {}
  get(key: string): Value | undefined { return this.records.get(key) }
  entries(): IterableIterator<[string, Value]> { return new Map(this.records).entries() }
  keys(): IterableIterator<string> { return new Map(this.records).keys() }
  get size(): number { return this.records.size }
  async put(key: string, value: Value): Promise<void> { this.records.set(key, value) }
  async delete(key: string): Promise<boolean> { return this.records.delete(key) }
  async update(key: string, transform: (current: Value) => Value): Promise<Value> {
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
    this.definitions = new MemoryTable(new Map(definitions.map(value => [value.id, value])))
    this.runs = new MemoryTable(new Map(runs.map(value => [value.id, value])))
  }
  table(name: 'definitions' | 'runs'): MemoryTable<AutomationDefinition> | MemoryTable<AutomationRun> {
    return name === 'definitions' ? this.definitions : this.runs
  }
  async close(): Promise<void> { this.closed = true }
}

const scope = { sessionId: 'session-source', creatorKind: 'web' as const }
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
}): Promise<{ service: AutomationService; domain: MemoryDomain }> {
  const domain = new MemoryDomain(seed?.definitions, seed?.runs)
  const workspace = {
    id: 'workspace-1', title: 'Repository', path: '/workspace/repo',
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
  const ctx = {
    storageDomain: { open: async () => domain },
    workspaceRegistry: {
      resolveByPath: async (path: string) => path === workspace.path ? workspace : undefined,
      get: () => workspace,
    },
    agents: {
      get: (id: string) => id === sourceAgent.id ? sourceAgent : undefined,
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
  return { service, domain }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 100; index += 1) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error('condition did not become true')
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
