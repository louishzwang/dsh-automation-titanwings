import assert from 'node:assert/strict'
import test from 'node:test'
import { registerAutomationRpc } from '../src/rpc.ts'

test('mark-read RPC is loopback-only and propagates scoped service calls and cancellation', async () => {
  let handler: ((endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>) | undefined
  let removed = false
  const ctx = {
    connection: {
      rpc: {
        handle: (
          channel: string,
          value: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>,
          options: unknown,
        ) => {
          assert.equal(channel, '/dsh-automation')
          assert.deepEqual(options, { authority: 'loopback' })
          handler = value
          return async () => { removed = true }
        },
      },
    },
  }
  const calls: Array<{ scope: unknown; runId: string; signal: AbortSignal | undefined }> = []
  const service = {
    markRead: async (scope: unknown, runId: string, signal?: AbortSignal) => {
      calls.push({ scope, runId, signal })
      return { id: runId, unread: false }
    },
  }
  const remove = registerAutomationRpc(ctx, service as never)
  const controller = new AbortController()

  const response = await handler?.('mark-read', {
    sessionId: 'session-source',
    runId: 'run-deleted-definition',
  }, controller.signal)
  assert.deepEqual(response, {
    ok: true,
    value: { runId: 'run-deleted-definition', unread: false },
  })
  assert.deepEqual(calls, [{
    scope: { sessionId: 'session-source', creatorKind: 'web' },
    runId: 'run-deleted-definition',
    signal: controller.signal,
  }])

  controller.abort()
  const cancelled = await handler?.('mark-read', {
    sessionId: 'session-source',
    runId: 'run-not-admitted',
  }, controller.signal)
  assert.deepEqual(cancelled, {
    ok: false,
    error: { code: 'cancelled', message: 'The automation request was cancelled.', details: {} },
  })
  assert.equal(calls.length, 1)
  await remove()
  assert.equal(removed, true)
})

test('RPC schedule inputs are strict JSON contracts and do not coerce strings or booleans', async () => {
  let handler: ((endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>) | undefined
  let createCalls = 0
  const ctx = {
    connection: { rpc: { handle: (_channel: string, value: typeof handler) => { handler = value; return async () => {} } } },
  }
  const service = { create: async () => { createCalls += 1; return { id: 'created', revision: 1 } } }
  registerAutomationRpc(ctx as never, service as never)
  const signal = new AbortController().signal
  const base = { sessionId: 'session-source', input: { name: 'Strict input', prompt: 'Inspect one condition.', timeZone: 'UTC' } }

  const interval = await handler?.('create', {
    ...base,
    input: { ...base.input, schedule: { kind: 'interval', everyMinutes: '5' } },
  }, signal) as { readonly ok: boolean; readonly error?: { readonly code: string } }
  assert.equal(interval.ok, false)
  assert.equal(interval.error?.code, 'bad-request')

  const weekly = await handler?.('create', {
    ...base,
    input: { ...base.input, schedule: { kind: 'weekly', time: '09:00', weekdays: [true] } },
  }, signal) as { readonly ok: boolean; readonly error?: { readonly code: string } }
  assert.equal(weekly.ok, false)
  assert.equal(weekly.error?.code, 'bad-request')
  assert.equal(createCalls, 0)
})
