import assert from 'node:assert/strict'
import test from 'node:test'
import { registerAutomationTools } from '../src/tools.ts'

interface ToolDefinition {
  readonly name: string
  readonly parameters?: Record<string, unknown>
  execute(args: unknown, context: { readonly agent?: unknown; readonly signal: AbortSignal }): Promise<unknown>
}

test('Agent management tools require the exact registered Agent identity, not a recycled id', async () => {
  const registered = new Map<string, ToolDefinition>()
  let createCalls = 0
  let createRequest: Record<string, unknown> | undefined
  const service = {
    create: async (_scope: unknown, request: Record<string, unknown>) => {
      createCalls += 1
      createRequest = request
      return { id: 'automation-created' }
    },
    snapshot: async () => ({ definitions: [], runs: [] }),
    update: async () => ({}),
    runNow: async () => ({}),
    delete: async () => ({}),
  }
  const agent = {
    id: 'agent-reused-id',
    ctx: {
      tools: {
        register: (definition: unknown) => {
          const tool = definition as ToolDefinition
          registered.set(tool.name, tool)
          return () => { registered.delete(tool.name) }
        },
      },
    },
  }
  const dispose = registerAutomationTools(service as never, agent)
  const tool = registered.get('automation_create')!
  const signal = new AbortController().signal
  const args = {
    name: 'Scoped automation',
    prompt: 'Inspect one bounded condition.',
    kind: 'daily',
    time_zone: 'UTC',
    time: '09:00',
  }

  const staleResult = await tool.execute(args, { agent: { id: agent.id }, signal })
  assert.deepEqual(staleResult, { ok: false, code: 'cancelled' })
  assert.equal(createCalls, 0)

  const ownerResult = await tool.execute(args, { agent, signal })
  assert.deepEqual(ownerResult, { ok: true, automation: { id: 'automation-created' } })
  assert.equal(createCalls, 1)
  assert.equal(Object.hasOwn(createRequest ?? {}, 'provider'), false)
  assert.equal(Object.hasOwn(createRequest ?? {}, 'model'), false)
  assert.equal(Object.hasOwn(createRequest ?? {}, 'reasoningEffort'), false)
  dispose()
  assert.equal(registered.size, 0)
})

test('Agent tools expose nullable model fields and preserve explicit pin/global updates', async () => {
  const registered = new Map<string, ToolDefinition>()
  const calls: Array<{ readonly method: string; readonly input: Record<string, unknown> }> = []
  const service = {
    create: async (_scope: unknown, input: Record<string, unknown>) => {
      calls.push({ method: 'create', input })
      return { id: 'automation-created' }
    },
    update: async (_scope: unknown, _id: string, input: Record<string, unknown>) => {
      calls.push({ method: 'update', input })
      return { id: 'automation-created' }
    },
  }
  const agent = {
    id: 'agent-owner',
    ctx: {
      tools: {
        register: (definition: unknown) => {
          const tool = definition as ToolDefinition
          registered.set(tool.name, tool)
          return () => { registered.delete(tool.name) }
        },
      },
    },
  }
  const dispose = registerAutomationTools(service as never, agent)
  const signal = new AbortController().signal
  const create = registered.get('automation_create')!
  assert.deepEqual(
    (create.parameters?.provider as { readonly oneOf?: unknown }).oneOf,
    [{ type: 'string' }, { type: 'null' }],
  )

  const created = await create.execute({
    name: 'Pinned automation',
    prompt: 'Inspect one bounded condition.',
    kind: 'daily',
    time_zone: 'UTC',
    time: '09:00',
    provider: 'provider-route',
    model: 'model-id',
    reasoning_effort: 'custom-effort',
  }, { agent, signal })
  assert.deepEqual(created, { ok: true, automation: { id: 'automation-created' } })
  assert.deepEqual(calls[0]?.input, {
    name: 'Pinned automation',
    prompt: 'Inspect one bounded condition.',
    schedule: { kind: 'daily', time: '09:00', timeZone: 'UTC' },
    provider: 'provider-route',
    model: 'model-id',
    reasoningEffort: 'custom-effort',
    permissionPreset: 'read-only',
  })

  const updated = await registered.get('automation_update')!.execute({
    id: 'automation-created',
    provider: null,
    model: null,
  }, { agent, signal })
  assert.deepEqual(updated, { ok: true, automation: { id: 'automation-created' } })
  assert.deepEqual(calls[1]?.input, { provider: null, model: null })

  const partial = await registered.get('automation_update')!.execute({
    id: 'automation-created',
    provider: 'provider-only',
  }, { agent, signal }) as { readonly ok: boolean; readonly message?: string }
  assert.equal(partial.ok, false)
  assert.match(partial.message ?? '', /provided together/)
  assert.equal(calls.length, 2)
  dispose()
})

test('a cancelled Agent mutation receives the execution signal and reports cancellation', async () => {
  const registered = new Map<string, ToolDefinition>()
  let receivedSignal: AbortSignal | undefined
  let release = () => {}
  const gate = new Promise<void>(resolve => { release = resolve })
  const service = {
    create: async (_scope: unknown, _request: unknown, signal?: AbortSignal) => {
      receivedSignal = signal
      await gate
      throw new Error('The automation request was cancelled.')
    },
  }
  const agent = {
    id: 'agent-owner',
    ctx: {
      tools: {
        register: (definition: unknown) => {
          const tool = definition as ToolDefinition
          registered.set(tool.name, tool)
          return () => { registered.delete(tool.name) }
        },
      },
    },
  }
  const dispose = registerAutomationTools(service as never, agent)
  const controller = new AbortController()
  const execution = registered.get('automation_create')!.execute({
    name: 'Cancelled automation',
    prompt: 'Inspect one bounded condition.',
    kind: 'daily',
    time_zone: 'UTC',
    time: '09:00',
  }, { agent, signal: controller.signal })
  await Promise.resolve()
  controller.abort()
  release()

  assert.deepEqual(await execution, { ok: false, code: 'cancelled' })
  assert.equal(receivedSignal, controller.signal)
  dispose()
})

test('Agent tools reject ambiguous cadence fields instead of silently discarding them', async () => {
  const registered = new Map<string, ToolDefinition>()
  let createCalls = 0
  let updateCalls = 0
  const service = {
    create: async () => { createCalls += 1; return {} },
    update: async () => { updateCalls += 1; return {} },
  }
  const agent = {
    id: 'agent-owner',
    ctx: {
      tools: {
        register: (definition: unknown) => {
          const tool = definition as ToolDefinition
          registered.set(tool.name, tool)
          return () => { registered.delete(tool.name) }
        },
      },
    },
  }
  const dispose = registerAutomationTools(service as never, agent)
  const signal = new AbortController().signal

  const createResult = await registered.get('automation_create')!.execute({
    name: 'Ambiguous cadence',
    prompt: 'Inspect one bounded condition.',
    kind: 'daily',
    time_zone: 'UTC',
    time: '09:00',
    every_minutes: 5,
  }, { agent, signal }) as { readonly ok: boolean; readonly message?: string }
  assert.equal(createResult.ok, false)
  assert.match(createResult.message ?? '', /daily schedule does not accept every_minutes/)
  assert.equal(createCalls, 0)

  const updateResult = await registered.get('automation_update')!.execute({
    id: 'automation-1',
    name: 'New name',
    time_zone: 'UTC',
  }, { agent, signal }) as { readonly ok: boolean; readonly message?: string }
  assert.equal(updateResult.ok, false)
  assert.match(updateResult.message ?? '', /kind is required/)
  assert.equal(updateCalls, 0)
  dispose()
})
