import assert from 'node:assert/strict'
import test from 'node:test'
import { readSessionEvents } from '../src/session-events.ts'
import { AutomationService } from '../src/service.ts'

test('Session snapshots preserve the receiver and requested range without touching the legacy getter', () => {
  const events = [{ seq: 8, type: 'turn/end', data: { reason: { kind: 'completed' } } }]
  const session = {
    marker: 42,
    snapshotEvents(fromSeq: number) {
      assert.equal(this.marker, 42)
      assert.equal(fromSeq, 8)
      return Object.freeze(events)
    },
    get events(): never { throw new Error('removed legacy API') },
  }
  assert.equal(readSessionEvents(session, 8), events)
})

test('legacy Session arrays remain readable; unsupported or broken APIs fail explicitly', () => {
  const events = [{ seq: 0, type: 'turn/start', data: {} }]
  assert.equal(readSessionEvents({ events }), events)
  for (const session of [null, {}, { events: {} }, { snapshotEvents: () => undefined, events }]) {
    assert.throws(() => readSessionEvents(session), /DSH Session/)
  }
  assert.throws(() => readSessionEvents({ snapshotEvents() { throw new Error('snapshot failed') }, events }), /snapshot failed/)
})

test('automation provenance survives history pruning on both Session APIs', () => {
  const events = [{ seq: 3, type: 'user/message', data: { source: { kind: 'automation' } } }]
  const owner = { runs: { entries: () => new Map().entries() } } as unknown as AutomationService
  for (const session of [{ events }, { snapshotEvents: () => events }]) {
    assert.equal(AutomationService.prototype.ownsSession.call(owner, 'legacy-session', readSessionEvents(session)), true)
  }
  assert.equal(AutomationService.prototype.ownsSession.call(owner, 'human-session', []), false)
})
