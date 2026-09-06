import assert from 'node:assert/strict'
import test from 'node:test'
import { createAutomationRuntime, loadModelCatalog } from '../src/client/runtime.js'
import { defaultFormState, deriveOverview, modelRouteChoices, readRangeDefault, writeDraft } from '../src/client/helpers.js'
import { timeZoneChoices } from '../src/client/AutomationView.js'
import { coalesceFrame, startRefreshLoop } from '../src/client/refresh-loop.js'
import type { AutomationSnapshot, ModelCatalog } from '../src/client/protocol.js'

const snapshot: AutomationSnapshot = { scope: { cwd: '/workspace' }, automations: [], runs: [], serverNow: '2026-09-06T00:00:00Z' }
const settle = async (): Promise<void> => { for (let i = 0; i < 12; i++) await Promise.resolve() }

test('partial malformed model catalogs retain valid rows and unavailable saved pins', async () => {
  const value = {
    groups: [
      { id: 'good', name: 'Good', models: [{ id: 'valid', name: 'Valid' }] },
      { id: 'partial', name: 'Partial', models: [null, { id: 'bad', name: 'Bad', reasoning: { efforts: null } }, { id: 'ok', name: 'OK' }] },
      null,
    ],
    failures: [null, { id: 'offline', name: 'Offline', message: 'unavailable' }],
  } as unknown as ModelCatalog
  const catalog = await loadModelCatalog({ session: { modelCatalog: async () => ({ ok: true, value }) } })
  assert.deepEqual(catalog.groups.map(g => g.models.map(m => m.id)), [['valid'], ['ok']])
  assert.equal(catalog.failures.length, 4)
  const choices = modelRouteChoices(catalog, 'partial', 'bad')
  assert.equal(choices[0]?.unavailable, true)
  assert.equal(choices[0]?.model, 'bad')
})

test('storage denial is a safe preference fallback and is not reported as a saved draft', () => {
  const denied = { getItem(): never { throw new Error('denied') }, setItem(): never { throw new Error('denied') } }
  assert.equal(readRangeDefault(denied, 'range'), 'week')
  assert.equal(readRangeDefault({ ...denied, getItem: () => 'month' }, 'range'), 'month')
  assert.equal(writeDraft(denied, 'draft', defaultFormState()), false)
  assert.equal(writeDraft(undefined, 'draft', defaultFormState()), false)
})

test('timezone cache retains the selected zone without rebuilding the base list', () => {
  const first = timeZoneChoices('Asia/Shanghai')
  assert.equal(timeZoneChoices('Asia/Shanghai'), first)
  assert.equal(first.find(zone => zone.value === 'Asia/Shanghai')?.label.includes('UTC+08:00'), true)
  const unknown = timeZoneChoices('Retired/Zone')
  assert.equal(unknown.at(-1)?.value, 'Retired/Zone')
  assert.equal(first.some(zone => zone.value === 'Retired/Zone'), false)
})

test('acknowledged mutation succeeds despite failed refresh and recovers on the next read', async () => {
  let failRead = false
  let writes = 0
  const runtime = createAutomationRuntime({ call: async (_c, endpoint) => {
    if (endpoint !== 'snapshot') { writes++; return { ok: true, value: {} } }
    if (failRead) throw new Error('read disconnected')
    return { ok: true, value: snapshot }
  } }, 'source')
  await runtime.refresh()
  failRead = true
  await runtime.runNow('task', 'plain')
  assert.equal(writes, 1)
  assert.equal(runtime.source.getSnapshot().snapshot, snapshot)
  assert.equal(runtime.source.getSnapshot().refreshAfterMutationFailed, true)
  failRead = false
  await runtime.refresh()
  assert.equal(writes, 1)
  assert.equal(runtime.source.getSnapshot().refreshAfterMutationFailed, undefined)
})

test('a rejected mutation is still an error and never triggers a follow-up refresh', async () => {
  let calls = 0
  const runtime = createAutomationRuntime({ call: async () => {
    calls++
    return { ok: false, error: { code: 'conflict', message: 'revision changed' } }
  } }, 'source')
  await assert.rejects(runtime.runNow('task', 'plain'), /revision changed/)
  assert.equal(calls, 1)
})

test('inactive session snapshots are released while immediate resubscription stays stable', async () => {
  const runtime = createAutomationRuntime({ call: async () => ({ ok: true, value: snapshot }) }, 'source')
  const stop = runtime.source.subscribe(() => {})
  await runtime.refresh()
  stop()
  const resubscribe = runtime.source.subscribe(() => {})
  await settle()
  assert.equal(runtime.source.getSnapshot().snapshot, snapshot)
  resubscribe()
  await settle()
  assert.equal(runtime.source.getSnapshot().snapshot, undefined)
  await runtime.refresh()
  assert.equal(runtime.source.getSnapshot().snapshot, undefined)
})

test('overview uses host attention totals while remaining compatible with old snapshots', () => {
  assert.equal(deriveOverview(snapshot).attention, 0)
  assert.equal(deriveOverview({ ...snapshot, attentionCount: 42 }).attention, 42)
})

test('polling never overlaps, pauses hidden reads, retries errors quickly and stops cleanly', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  let visible = true
  let changed = () => {}
  let calls = 0
  let release!: () => void
  let fail = false
  let removed = false
  const stop = startRefreshLoop(async () => {
    calls++
    if (calls === 1) await new Promise<void>(resolve => { release = resolve })
    if (fail) throw new Error('offline')
  }, {
    intervalMs: 15000, retryMs: 3000, isVisible: () => visible,
    subscribeVisibility: listener => { changed = listener; return () => { removed = true } },
  })
  context.mock.timers.tick(60000)
  assert.equal(calls, 1)
  release()
  await settle()
  context.mock.timers.tick(15000)
  await settle()
  assert.equal(calls, 2)
  visible = false
  changed()
  context.mock.timers.tick(60000)
  assert.equal(calls, 2)
  visible = true
  fail = true
  changed()
  await settle()
  assert.equal(calls, 3)
  context.mock.timers.tick(3000)
  await settle()
  assert.equal(calls, 4)
  stop()
  assert.equal(removed, true)
  context.mock.timers.tick(60000)
  assert.equal(calls, 4)
})

test('sidebar mutation bursts coalesce and disposal prevents a late placement', () => {
  let callback = () => {}
  let requests = 0
  let placements = 0
  let cancelled = false
  const frame = coalesceFrame(() => { placements++ }, {
    request: next => { requests++; callback = next; return requests },
    cancel: () => { cancelled = true },
  })
  frame.schedule()
  frame.schedule()
  frame.schedule()
  assert.equal(requests, 1)
  callback()
  assert.equal(placements, 1)
  frame.schedule()
  frame.dispose()
  callback()
  frame.schedule()
  assert.equal(cancelled, true)
  assert.equal(placements, 1)
  assert.equal(requests, 2)
})
