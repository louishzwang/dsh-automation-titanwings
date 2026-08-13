import { AutomationView } from './AutomationView.js'
import type { ClientContext } from './contracts.js'
import { en, NS, zh } from './locales.js'
import { createAutomationRuntime } from './runtime.js'
import { installStyles } from './styles.js'

export const name = 'dsh-automation-client'
export const inject = ['slots', 'locale', 'connection', 'sessions']

/** Register one native Automations tab into DSH's session-scoped view ring. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => installStyles(), 'dsh-automation: styles')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-automation: locale')
  const t = ctx.locale.bind(NS)
  // Inject factories can run more than once while React reconciles. Keep one
  // observable identity per session for the lifetime of this plugin fiber.
  const runtimes = new Map<string, ReturnType<typeof createAutomationRuntime>>()
  ctx.effect(() => () => { runtimes.clear() }, 'dsh-automation: session runtimes')
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'automation',
    order: 40,
    locale: NS,
    label: () => t('tab'),
    inject: (sessionId) => {
      let runtime = runtimes.get(sessionId)
      if (runtime === undefined) {
        runtime = createAutomationRuntime(ctx.connection.rpc, sessionId)
        runtimes.set(sessionId, runtime)
      }
      return {
        hooks: { automationState: runtime.source },
        refresh: runtime.refresh,
        createAutomation: runtime.createAutomation,
        mutateAutomation: runtime.mutateAutomation,
        runNow: runtime.runNow,
        markRunRead: runtime.markRunRead,
        openSession: (runId, runSessionId) => runtime!.openRunSession(runId, async () => {
          await ctx.sessions.refresh()
          ctx.sessions.open(runSessionId)
        }),
      }
    },
  }, AutomationView))
}
