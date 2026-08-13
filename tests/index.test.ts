import assert from 'node:assert/strict'
import test from 'node:test'
import { humanApprovalReason, needsHumanApproval } from '../src/index.ts'

test('approval is scoped to mounted Agents, includes delete, and ignores cancelled calls', () => {
  const signal = new AbortController().signal
  assert.equal(needsHumanApproval({ name: 'automation_create', signal }, true), true)
  assert.equal(needsHumanApproval({ name: 'automation_delete', signal }, true), true)
  assert.equal(needsHumanApproval({
    name: 'automation_update',
    arguments: { id: 'automation-1', status: 'paused' },
    signal,
  }, true), false)
  assert.equal(needsHumanApproval({ name: 'automation_create', signal }, false), false)

  const cancelled = new AbortController()
  cancelled.abort()
  assert.equal(needsHumanApproval({ name: 'automation_run_now', signal: cancelled.signal }, true), false)
  assert.match(humanApprovalReason('automation_delete'), /permanently deletes/)
})
