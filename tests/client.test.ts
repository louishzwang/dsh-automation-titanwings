import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AutomationFormError,
  buildCreateInput,
  defaultFormState,
  deriveOverview,
  formatRelativeTime,
  formatSchedule,
} from '../src/client/helpers.js'
import { en, zh } from '../src/client/locales.js'
import { createAutomationRuntime } from '../src/client/runtime.js'
import type { AutomationSnapshot } from '../src/client/protocol.js'

const t = (key: keyof typeof en, params?: Record<string, unknown>): string => {
  let value: string = en[key]
  for (const [name, replacement] of Object.entries(params ?? {})) {
    value = value.replaceAll(`{${name}}`, String(replacement))
  }
  return value
}

test('English and Chinese dictionaries own exactly the same keys', () => {
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort())
  assert.equal(en.tab, 'Automations')
  assert.equal(zh.tab, '自动化')
})

test('overview labels distinguish enabled definitions from running executions', () => {
  assert.equal(en['stats.active'], 'Active')
  assert.equal(zh['stats.active'], '已启用')
  assert.notEqual(zh['stats.active'], zh['status.running'])
})

test('buildCreateInput trims text and normalizes a weekly schedule', () => {
  const form = {
    ...defaultFormState(new Date('2026-08-13T00:00:00Z')),
    name: '  Regression triage  ',
    prompt: '  Inspect failed tests.  ',
    scheduleKind: 'weekly' as const,
    time: '08:30',
    weekdays: [5, 1, 3],
    timeZone: 'Asia/Shanghai',
    permission: 'workspace-write' as const,
  }
  assert.deepEqual(buildCreateInput(form, new Date('2026-08-13T00:00:00Z')), {
    name: 'Regression triage',
    prompt: 'Inspect failed tests.',
    schedule: { kind: 'weekly', time: '08:30', weekdays: [1, 3, 5], timeZone: 'Asia/Shanghai' },
    timeZone: 'Asia/Shanghai',
    permission: 'workspace-write',
  })
})

test('buildCreateInput rejects empty weekly days and unsafe intervals', () => {
  const base = { ...defaultFormState(), name: 'Task', prompt: 'Do the task.' }
  assert.throws(
    () => buildCreateInput({ ...base, scheduleKind: 'weekly', weekdays: [] }),
    (error: unknown) => error instanceof AutomationFormError && error.key === 'form.error.weekdays',
  )
  assert.throws(
    () => buildCreateInput({ ...base, scheduleKind: 'interval', everyMinutes: '1' }),
    (error: unknown) => error instanceof AutomationFormError && error.key === 'form.error.interval',
  )
})

test('deriveOverview counts active definitions and unread failures', () => {
  const snapshot: AutomationSnapshot = {
    scope: { cwd: '/workspace' },
    serverNow: '2026-08-13T00:00:00.000Z',
    automations: [
      {
        id: 'a1', revision: 1, name: 'A', prompt: 'A', status: 'active',
        schedule: { kind: 'daily', time: '09:00' }, scheduleSummary: 'Daily at 09:00',
        timeZone: 'UTC', permission: 'read-only', nextRunAt: '2026-08-13T09:00:00.000Z',
        createdAt: '2026-08-12T00:00:00.000Z', updatedAt: '2026-08-12T00:00:00.000Z',
      },
      {
        id: 'a2', revision: 1, name: 'B', prompt: 'B', status: 'paused',
        schedule: { kind: 'interval', everyMinutes: 60 }, scheduleSummary: 'Every hour',
        timeZone: 'UTC', permission: 'workspace-write', createdAt: '2026-08-12T00:00:00.000Z',
        updatedAt: '2026-08-12T00:00:00.000Z',
      },
    ],
    runs: [
      { id: 'r1', automationId: 'a1', automationName: 'A', status: 'failed', trigger: 'schedule', scheduledFor: '2026-08-12T09:00:00.000Z' },
      { id: 'r2', automationId: 'a1', automationName: 'A', status: 'failed', trigger: 'schedule', scheduledFor: '2026-08-11T09:00:00.000Z', unread: false },
      { id: 'r3', automationId: 'a2', automationName: 'B', status: 'succeeded', trigger: 'manual', scheduledFor: '2026-08-12T10:00:00.000Z' },
    ],
  }
  assert.deepEqual(deriveOverview(snapshot), {
    total: 2,
    active: 1,
    attention: 1,
    nextRunAt: '2026-08-13T09:00:00.000Z',
  })
})

test('formatRelativeTime handles past and future windows', () => {
  const now = new Date('2026-08-13T12:00:00.000Z')
  assert.equal(formatRelativeTime('2026-08-13T11:48:00.000Z', now, t), '12m ago')
  assert.equal(formatRelativeTime('2026-08-13T14:00:00.000Z', now, t), 'in 2h')
  assert.equal(formatRelativeTime('2026-08-16T12:00:00.000Z', now, t), 'in 3d')
})

test('formatSchedule localizes friendly cadence instead of exposing raw RRULE', () => {
  const translateZh = (key: keyof typeof zh, params?: Record<string, unknown>): string => {
    let value = zh[key]
    for (const [name, replacement] of Object.entries(params ?? {})) {
      value = value.replaceAll(`{${name}}`, String(replacement))
    }
    return value
  }
  assert.equal(formatSchedule({
    kind: 'weekly', weekdays: [1, 3, 5], time: '09:30', timeZone: 'Asia/Shanghai',
  }, translateZh), '周一 · 周三 · 周五 · 09:30')
  assert.equal(formatSchedule({
    kind: 'interval', everyMinutes: 30, anchor: '2026-08-13T00:00:00Z', timeZone: 'UTC',
  }, translateZh), '每 30 分钟')
})

test('opening a run Session marks it read only after navigation succeeds', async () => {
  const calls: Array<{ endpoint: string; payload: unknown }> = []
  const rpc = {
    call: async (_channel: string, endpoint: string, payload: unknown) => {
      calls.push({ endpoint, payload })
      if (endpoint === 'snapshot') {
        return {
          ok: true,
          value: { scope: { cwd: '/workspace' }, automations: [], runs: [], serverNow: new Date().toISOString() },
        }
      }
      return { ok: true, value: {} }
    },
  }
  const runtime = createAutomationRuntime(rpc, 'session-source')

  await runtime.openRunSession('run-1', async () => {})
  assert.deepEqual(calls.map(call => call.endpoint), ['mark-read', 'snapshot'])
  assert.deepEqual(calls[0]?.payload, { sessionId: 'session-source', runId: 'run-1' })

  calls.length = 0
  await assert.rejects(
    () => runtime.openRunSession('run-2', async () => { throw new Error('navigation failed') }),
    /navigation failed/,
  )
  assert.equal(calls.length, 0)

  await runtime.markRunRead('run-without-session')
  assert.deepEqual(calls.map(call => call.endpoint), ['mark-read', 'snapshot'])
  assert.deepEqual(calls[0]?.payload, { sessionId: 'session-source', runId: 'run-without-session' })
})
