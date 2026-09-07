import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AutomationCard, AutomationRunDialog, AutomationView } from '../src/client/AutomationView.js'
import { buildTaskCalendar, calendarDateKey, calendarCounts, calendarTaskKind, calendarTaskStatus } from '../src/client/task-calendar.js'
import { zh } from '../src/client/locales.js'
import type { AutomationRunViewModel, AutomationViewModel } from '../src/client/protocol.js'

const at = (day: number, hour = 9) => new Date(2026, 8, day, hour).toISOString()
function task(changes: Partial<AutomationViewModel> = {}): AutomationViewModel {
  return { id: 'a', revision: 1, name: 'Calendar task', prompt: 'Read only', status: 'active',
    schedule: { kind: 'once', at: at(5) }, scheduleSummary: 'Once', timeZone: 'UTC',
    provider: null, model: null, reasoningEffort: null, permission: 'read-only',
    createdAt: at(1), updatedAt: at(1), ...changes }
}
function run(changes: Partial<AutomationRunViewModel> = {}): AutomationRunViewModel {
  return { id: 'r', automationId: 'a', automationName: 'Calendar task', status: 'failed',
    trigger: 'schedule', scheduledFor: at(5), startedAt: at(5), finishedAt: at(5, 10),
    sessionId: 'session-a', sessionArchived: false, unread: true, ...changes }
}
const dayTasks = (calendar: ReturnType<typeof buildTaskCalendar>, day: number) =>
  calendar.days.get(calendarDateKey(at(day))!) ?? []

test('failed one-shots remain on their scheduled date with a visible attention count', () => {
  for (const status of ['failed', 'interrupted', 'skipped', 'cancelled'] as const) {
    const source = task({ lastRunAt: at(5, 10), lastRunStatus: status })
    const history = run({ status, unread: false })
    const calendar = buildTaskCalendar([source], [history])
    assert.equal(dayTasks(calendar, 5).length, 1)
    assert.equal(calendarCounts(dayTasks(calendar, 5)).attention, 1)
    assert.equal(calendarTaskStatus(dayTasks(calendar, 5)[0]!), status)
    assert.equal(calendarCounts(calendar.all).attention, 1)
  }
})

test('late catch-up and midnight completion stay on the planned local date', () => {
  const source = task({ lastRunAt: at(7), lastRunStatus: 'failed' })
  const calendar = buildTaskCalendar([source], [run({ startedAt: at(6, 23), finishedAt: at(7) })])
  assert.equal(dayTasks(calendar, 5).length, 1)
  assert.equal(dayTasks(calendar, 6).length, 0)
  assert.equal(dayTasks(calendar, 7).length, 0)
})

test('recurring tasks retain past results without mislabelling the next occurrence', () => {
  const source = task({ schedule: { kind: 'daily', time: '09:00' }, nextRunAt: at(6),
    lastRunAt: at(5, 10), lastRunStatus: 'failed' })
  const calendar = buildTaskCalendar([source], [run()])
  assert.equal(calendarTaskKind(dayTasks(calendar, 5)[0]!), 'attention')
  assert.equal(calendarTaskKind(dayTasks(calendar, 6)[0]!), 'active')
  assert.equal(calendarTaskStatus(dayTasks(calendar, 6)[0]!), undefined)
  assert.equal(dayTasks(calendar, 5)[0]?.nextRunAt, at(6))
})

test('same-day retries count once and show the newest run regardless of input order', () => {
  const source = task({ lastRunStatus: 'succeeded', lastRunAt: at(5, 12) })
  const success = run({ id: 'retry', status: 'succeeded', trigger: 'manual', scheduledFor: at(5, 11), startedAt: at(5, 11), finishedAt: at(5, 12) })
  for (const rows of [[run(), success], [success, run()]]) {
    const calendar = buildTaskCalendar([source], rows)
    assert.equal(dayTasks(calendar, 5).length, 1)
    assert.equal(dayTasks(calendar, 5)[0]?.calendarRun?.id, 'retry')
    assert.equal(calendarCounts(dayTasks(calendar, 5)).executed, 1)
    assert.equal(calendarCounts(dayTasks(calendar, 5)).attention, 0)
  }
})

test('running one-shots remain visible and a future same-day occurrence stays pending after success', () => {
  const running = buildTaskCalendar([task({ lastRunStatus: 'running' })], [run({ status: 'running' })])
  assert.equal(calendarCounts(dayTasks(running, 5)).running, 1)
  const source = task({ schedule: { kind: 'interval', everyMinutes: 60 }, nextRunAt: at(5, 11), lastRunStatus: 'succeeded', lastRunAt: at(5, 10) })
  const calendar = buildTaskCalendar([source], [run({ status: 'succeeded' })])
  assert.equal(dayTasks(calendar, 5).length, 1)
  assert.equal(calendarCounts(dayTasks(calendar, 5)).active, 1)
})

test('older or truncated snapshots recover the latest result without reviving deleted definitions', () => {
  const source = task({ lastRunStatus: 'failed', lastRunAt: at(7) })
  assert.equal(calendarCounts(dayTasks(buildTaskCalendar([source], []), 5)).attention, 1)
  assert.equal(buildTaskCalendar([], [run()]).days.size, 0)
  const succeeded = task({ lastRunStatus: 'succeeded', lastRunAt: at(5, 12) })
  const calendar = buildTaskCalendar([succeeded], [run()])
  assert.equal(calendarTaskKind(calendar.all[0]!), 'executed')
  assert.equal(calendarTaskKind(dayTasks(calendar, 5)[0]!), 'executed')
})

test('calendar indexing preserves source data and does not duplicate successful one-shots on finish day', () => {
  const source = task({ lastRunStatus: 'succeeded', lastRunAt: at(6) })
  const history = run({ status: 'succeeded', finishedAt: at(6) })
  const before = JSON.stringify([source, history])
  const calendar = buildTaskCalendar([source], [history])
  assert.equal(dayTasks(calendar, 5).length, 1)
  assert.equal(dayTasks(calendar, 6).length, 0)
  assert.equal(JSON.stringify([source, history]), before)
})

test('task cards show unverified results and a conversation link without changing persisted failure', () => {
  const history = run({ error: 'events is not iterable' })
  const calendar = buildTaskCalendar([task({ lastRunStatus: 'failed', lastRunAt: at(5, 10) })], [history])
  const noop = () => {}
  const render = (archived: boolean) => renderToStaticMarkup(createElement(AutomationCard, {
    automation: { ...dayTasks(calendar, 5)[0]!, calendarRun: { ...history, sessionArchived: archived } },
    now: new Date(at(7)), t: (key, params) => Object.entries(params ?? {}).reduce((value, [name, replacement]) => value.replaceAll('{'+name+'}', String(replacement)), zh[key]),
    busyKey: undefined, confirmingDelete: false, onConfirmDelete: noop, onEdit: noop, onMutate: noop, onRun: noop, onOpen: noop,
  }))
  assert.match(render(false), /结果待核实/)
  assert.match(render(false), /先打开会话核实/)
  assert.match(render(false), /<button[^>]*class="dsh-automation-session-id"/)
  assert.doesNotMatch(render(true), /<button[^>]*class="dsh-automation-session-id"/)
  assert.equal(history.status, 'failed')
})

test('retrying a failed recurring task defaults to a plain run and keeps the future schedule', () => {
  const source = task({ schedule: { kind: 'daily', time: '09:00' }, nextRunAt: at(6), lastRunStatus: 'failed', lastRunAt: at(5, 10) })
  const calendar = buildTaskCalendar([source], [run()])
  const html = renderToStaticMarkup(createElement(AutomationRunDialog, {
    automation: dayTasks(calendar, 5)[0]!, busy: false, t: key => zh[key],
    onCancel: () => {}, onRun: async () => {},
  }))
  assert.match(html, /<input[^>]*checked=""[^>]*value="plain"/)
  assert.doesNotMatch(html, /<input[^>]*checked=""[^>]*value="ahead"/)
  assert.equal(source.nextRunAt, at(6))
})

test('the actual task view counts and renders a failed task instead of an empty day', () => {
  const never = async (): Promise<never> => { throw new Error('Unexpected write during render') }
  const html = renderToStaticMarkup(createElement(AutomationView, {
    sessionId: 'source', t: (key, params) => Object.entries(params ?? {}).reduce((value, [name, replacement]) => value.replaceAll('{'+name+'}', String(replacement)), zh[key]),
    useAutomationState: selector => selector({ phase: 'ready', snapshot: {
      scope: { cwd: '/test' }, serverNow: at(5, 12),
      automations: [task({ lastRunStatus: 'failed', lastRunAt: at(5, 10) })],
      runs: [run({ error: 'events is not iterable' })],
    } }),
    refresh: never, createAutomation: never, updateAutomation: never, mutateAutomation: never, runNow: never,
    markRunRead: never, archiveRun: never, deleteRun: never, updateSettings: never,
    loadModelCatalog: never, openSession: never, refreshSessions: never,
  }))
  const taskColumn = html.split('<aside')[0]!
  assert.match(taskColumn, /今日任务<\/span><b>1<\/b>/)
  assert.match(taskColumn, /需关注<\/b><em>1<\/em>/)
  assert.match(taskColumn, /结果待核实/)
  assert.match(taskColumn, /dsh-automation-card-list/)
  assert.doesNotMatch(taskColumn, /今天没有待执行的任务/)
})
