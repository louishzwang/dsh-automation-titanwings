import assert from 'node:assert/strict'
import test from 'node:test'
import {
  automationDefinitionSchema, automationDomainSpec, automationRunSchema,
  createDefinition, createManualRun, createScheduledRun, deleteDefinition,
  pauseDefinition, resumeDefinition, runIdForOccurrence, updateDefinition,
} from '../src/domain.ts'

const definition = () => createDefinition({
  id: 'automation-security',
  name: 'Security review',
  prompt: 'Review dependency security and summarize concrete findings.',
  schedule: { kind: 'daily', time: '09:00', timeZone: 'Asia/Shanghai' },
  workspaceId: 'workspace-1',
  cwd: '/workspace/repo',
  agentPreset: 'coding',
  createdBy: { kind: 'agent', sessionId: 'session-source' },
  now: '2026-08-13T00:00:00Z',
})

test('domain declaration owns definitions and runs at version one', () => {
  assert.equal(automationDomainSpec.name, 'dsh_automation')
  assert.equal(automationDomainSpec.version, 1)
  assert.deepEqual(Object.keys(automationDomainSpec.tables).sort(), ['definitions', 'runs'])
})

test('creation derives canonical RRULE and rejects inconsistent stored records', () => {
  const value = definition()
  assert.equal(value.revision, 1)
  assert.equal(value.timeZone, 'Asia/Shanghai')
  assert.equal(value.reasoningEffort, null)
  assert.match(value.rrule, /FREQ=DAILY/)
  assert.equal(automationDefinitionSchema.safeParse(value).success, true)
  assert.equal(automationDefinitionSchema.safeParse({ ...value, rrule: 'RRULE:FREQ=HOURLY' }).success, false)
  assert.equal(automationDefinitionSchema.safeParse({ ...value, timeZone: 'Europe/Paris' }).success, false)
})

test('legacy version-one records default a missing reasoning effort to null', () => {
  const current = definition()
  const { reasoningEffort: _definitionEffort, ...legacyDefinition } = current
  const parsedDefinition = automationDefinitionSchema.parse(legacyDefinition)
  assert.equal(parsedDefinition.reasoningEffort, null)

  const run = createManualRun(current, '2026-08-13T01:00:00Z', 'legacy-run')
  const { reasoningEffort: _runEffort, ...legacyTarget } = run.targetSnapshot
  const parsedRun = automationRunSchema.parse({ ...run, targetSnapshot: legacyTarget })
  assert.equal(parsedRun.targetSnapshot.reasoningEffort, null)
})

test('model targets are paired and reasoning requires a pinned route', () => {
  const base = {
    id: 'automation-model-target',
    name: 'Model target',
    prompt: 'Inspect one condition.',
    schedule: { kind: 'daily' as const, time: '09:00', timeZone: 'UTC' },
    workspaceId: 'workspace-1',
    cwd: '/workspace/repo',
    agentPreset: 'coding',
    createdBy: { kind: 'agent' as const, sessionId: 'session-source' },
    now: '2026-08-13T00:00:00Z',
  }
  assert.throws(() => createDefinition({ ...base, provider: 'route' }), /provider and model/)
  assert.throws(() => createDefinition({ ...base, reasoningEffort: 'high' }), /requires a pinned/)

  const pinned = createDefinition({
    ...base,
    provider: 'route',
    model: 'analysis-model',
    reasoningEffort: 'opaque-effort',
  })
  assert.equal(pinned.reasoningEffort, 'opaque-effort')
  const run = createManualRun(pinned, '2026-08-13T01:00:00Z', 'pinned-run')
  assert.deepEqual(run.targetSnapshot, {
    workspaceId: 'workspace-1',
    cwd: '/workspace/repo',
    agentPreset: 'coding',
    provider: 'route',
    model: 'analysis-model',
    reasoningEffort: 'opaque-effort',
    permissionPreset: 'read-only',
  })
})

test('model target identifiers remain opaque while all-whitespace values are rejected', () => {
  const value = createDefinition({
    id: 'automation-opaque-model-target',
    name: 'Opaque model target',
    prompt: 'Inspect one condition.',
    schedule: { kind: 'daily', time: '09:00', timeZone: 'UTC' },
    workspaceId: 'workspace-1',
    cwd: '/workspace/repo',
    agentPreset: 'coding',
    provider: ' provider-route ',
    model: ' model-id ',
    reasoningEffort: ' adapter-owned-effort ',
    createdBy: { kind: 'agent', sessionId: 'session-source' },
    now: '2026-08-13T00:00:00Z',
  })

  assert.deepEqual(
    { provider: value.provider, model: value.model, reasoningEffort: value.reasoningEffort },
    {
      provider: ' provider-route ',
      model: ' model-id ',
      reasoningEffort: ' adapter-owned-effort ',
    },
  )
  const run = createManualRun(value, '2026-08-13T01:00:00Z', 'opaque-target-run')
  assert.deepEqual(
    {
      provider: run.targetSnapshot.provider,
      model: run.targetSnapshot.model,
      reasoningEffort: run.targetSnapshot.reasoningEffort,
    },
    {
      provider: ' provider-route ',
      model: ' model-id ',
      reasoningEffort: ' adapter-owned-effort ',
    },
  )
  assert.throws(() => automationDefinitionSchema.parse({ ...value, reasoningEffort: '   ' }))
})

test('model route updates are atomic and clear stale reasoning by default', () => {
  const pinned = createDefinition({
    id: 'automation-model-update',
    name: 'Model update',
    prompt: 'Inspect one condition.',
    schedule: { kind: 'daily', time: '09:00', timeZone: 'UTC' },
    workspaceId: 'workspace-1',
    cwd: '/workspace/repo',
    agentPreset: 'coding',
    provider: 'route-a',
    model: 'model-a',
    reasoningEffort: 'high',
    createdBy: { kind: 'agent', sessionId: 'session-source' },
    now: '2026-08-13T00:00:00Z',
  })
  assert.throws(() => updateDefinition(pinned, {
    provider: 'route-b',
    now: '2026-08-13T01:00:00Z',
  }), /updated together/)

  const changedRoute = updateDefinition(pinned, {
    provider: 'route-b',
    model: 'model-b',
    now: '2026-08-13T01:00:00Z',
  })
  assert.equal(changedRoute.reasoningEffort, null)

  const changedEffort = updateDefinition(changedRoute, {
    reasoningEffort: 'custom-budget',
    now: '2026-08-13T02:00:00Z',
  })
  assert.equal(changedEffort.reasoningEffort, 'custom-budget')

  const followsGlobal = updateDefinition(changedEffort, {
    provider: null,
    model: null,
    now: '2026-08-13T03:00:00Z',
  })
  assert.deepEqual(
    { provider: followsGlobal.provider, model: followsGlobal.model, reasoningEffort: followsGlobal.reasoningEffort },
    { provider: null, model: null, reasoningEffort: null },
  )
  assert.throws(() => updateDefinition(followsGlobal, {
    reasoningEffort: 'high',
    now: '2026-08-13T04:00:00Z',
  }), /requires a pinned/)
})

test('update and status transitions are immutable, revisioned pure transforms', () => {
  const original = definition()
  const updated = updateDefinition(original, {
    name: 'Daily security review',
    schedule: {
      kind: 'weekly', weekdays: ['FR', 'MO'], time: '10:30', timeZone: 'America/New_York',
    },
    now: '2026-08-13T01:00:00Z',
  })
  assert.equal(original.revision, 1)
  assert.equal(updated.revision, 2)
  assert.deepEqual(updated.schedule.kind === 'weekly' ? updated.schedule.weekdays : [], ['MO', 'FR'])
  assert.equal(updated.timeZone, 'America/New_York')

  const paused = pauseDefinition(updated, '2026-08-13T02:00:00Z')
  assert.equal(paused.status, 'paused')
  assert.equal(paused.revision, 3)
  assert.equal(pauseDefinition(paused, '2026-08-13T03:00:00Z'), paused)
  const resumed = resumeDefinition(paused, '2026-08-13T04:00:00Z')
  assert.equal(resumed.status, 'active')
  assert.equal(resumed.revision, 4)
  assert.deepEqual(deleteDefinition(resumed), { id: resumed.id, preserveRunHistory: true })
})

test('scheduled occurrence id is deterministic while manual runs require a nonce', () => {
  const value = definition()
  const first = createScheduledRun(value, '2026-08-14T01:00:00Z')
  const duplicate = createScheduledRun(value, '2026-08-14T09:00:00+08:00')
  assert.equal(first.occurrenceKey, duplicate.occurrenceKey)
  assert.equal(first.id, duplicate.id)
  assert.equal(first.id, runIdForOccurrence(first.occurrenceKey))
  assert.equal(automationRunSchema.safeParse(first).success, true)

  const manualOne = createManualRun(value, '2026-08-14T01:00:00Z', 'click-1')
  const manualTwo = createManualRun(value, '2026-08-14T01:00:00Z', 'click-2')
  assert.notEqual(manualOne.id, manualTwo.id)
})

test('strict validation rejects blank prompts and unsafe permission presets', () => {
  assert.throws(() => createDefinition({
    id: 'x', name: 'x', prompt: '  ',
    schedule: { kind: 'interval', everyMinutes: 5, anchor: '2026-08-13T00:00:00Z', timeZone: 'Etc/UTC' },
    workspaceId: 'w', cwd: '/repo', agentPreset: 'coding',
    createdBy: { kind: 'web', sessionId: 's' }, now: '2026-08-13T00:00:00Z',
  }), /prompt/)
  assert.equal(automationDefinitionSchema.safeParse({
    ...definition(), permissionPreset: 'danger-full-access',
  }).success, false)
})
