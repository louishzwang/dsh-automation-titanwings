import type { AutomationRunStatus, AutomationRunViewModel, AutomationViewModel } from './protocol.js'
import { isFulfilledAutomation } from './helpers.js'

export interface CalendarTask extends AutomationViewModel {
  readonly calendarRun?: AutomationRunViewModel
  readonly calendarDate?: string
  readonly calendarStatus?: AutomationRunStatus
}
export type CalendarTaskKind = 'active' | 'paused' | 'executed' | 'attention' | 'running'
const PROBLEM_STATUSES = new Set<AutomationRunStatus>(['failed', 'interrupted', 'skipped', 'cancelled'])

export function calendarDateKey(iso: string | Date | undefined): string | undefined {
  if (iso === undefined) return undefined
  const date = typeof iso === 'string' ? new Date(iso) : iso
  if (!Number.isFinite(date.getTime())) return undefined
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}

export function calendarTaskStatus(task: CalendarTask): AutomationRunStatus | undefined {
  return task.calendarRun?.status ?? (task.calendarDate === undefined ? task.lastRunStatus : task.calendarStatus)
}
export function isUnverifiedRun(run: AutomationRunViewModel | undefined): boolean {
  return run?.status === 'failed' && run.error === 'events is not iterable'
}
export function calendarTaskKind(task: CalendarTask): CalendarTaskKind {
  const status = calendarTaskStatus(task)
  if (status === 'queued' || status === 'running') return 'running'
  if (status !== undefined && PROBLEM_STATUSES.has(status)) return 'attention'
  if (task.calendarDate !== undefined && status === 'succeeded'
    && calendarDateKey(task.nextRunAt) !== task.calendarDate) return 'executed'
  if (isFulfilledAutomation(task)) return 'executed'
  return task.status === 'paused' ? 'paused' : 'active'
}

/** Index once per snapshot; each date contains a definition at most once. */
export function buildTaskCalendar(
  automations: readonly AutomationViewModel[],
  runs: readonly AutomationRunViewModel[],
): { readonly days: ReadonlyMap<string, readonly CalendarTask[]>; readonly all: readonly CalendarTask[] } {
  const definitions = new Map(automations.map(item => [item.id, item]))
  const latest = new Map<string, AutomationRunViewModel>()
  const buckets = new Map<string, Map<string, CalendarTask>>()
  const newer = (left: AutomationRunViewModel, right: AutomationRunViewModel): boolean => {
    const order = (run: AutomationRunViewModel): number => Date.parse(run.startedAt ?? run.scheduledFor)
    return order(left) > order(right) || (order(left) === order(right) && left.id.localeCompare(right.id) > 0)
  }
  const put = (date: string | undefined, task: CalendarTask): void => {
    if (date === undefined) return
    let bucket = buckets.get(date)
    if (bucket === undefined) { bucket = new Map(); buckets.set(date, bucket) }
    const previous = bucket.get(task.id)
    if (previous?.calendarRun !== undefined && (task.calendarRun === undefined || !newer(task.calendarRun, previous.calendarRun))) return
    bucket.set(task.id, { ...task, calendarDate: date })
  }
  for (const definition of automations) put(calendarDateKey(definition.nextRunAt), definition)
  for (const run of runs) {
    const definition = definitions.get(run.automationId)
    if (definition === undefined) continue // Explicitly deleted definitions stay deleted.
    const previous = latest.get(run.automationId)
    if (previous === undefined || newer(run, previous)) latest.set(run.automationId, run)
    put(calendarDateKey(run.retryScheduledFor ?? run.scheduledFor), { ...definition, calendarRun: run })
  }
  for (const definition of automations) {
    // Older/truncated snapshots still expose the latest status on the definition.
    // Only use this fallback when the actual latest row is absent.
    const run = latest.get(definition.id)
    const lastAt = run?.finishedAt ?? run?.startedAt ?? run?.scheduledFor
    if (definition.lastRunStatus === undefined || (lastAt !== undefined
      && definition.lastRunAt !== undefined && Date.parse(lastAt) >= Date.parse(definition.lastRunAt))) continue
    const date = definition.schedule.kind === 'once' ? definition.schedule.at : definition.lastRunAt
    const key = calendarDateKey(date)
    if (key !== undefined) buckets.get(key)?.delete(definition.id)
    put(key, { ...definition, calendarStatus: definition.lastRunStatus })
  }
  return {
    days: new Map([...buckets].map(([date, entries]) => [date, [...entries.values()]])),
    all: automations.map(definition => {
      const run = latest.get(definition.id)
      // Do not let retained older problem rows override a newer host summary.
      if (run === undefined || (definition.lastRunAt !== undefined
        && Date.parse(run.finishedAt ?? run.startedAt ?? run.scheduledFor) < Date.parse(definition.lastRunAt))) return definition
      return { ...definition, calendarRun: run }
    }),
  }
}
export function calendarCounts(tasks: readonly CalendarTask[]): Record<CalendarTaskKind, number> {
  const counts = { active: 0, paused: 0, executed: 0, attention: 0, running: 0 }
  for (const task of tasks) counts[calendarTaskKind(task)] += 1
  return counts
}


/** Select the exact history row, even when a newer run exists on the same date. */
export function taskForRun(automations: readonly AutomationViewModel[], runs: readonly AutomationRunViewModel[], runId: string): CalendarTask | undefined {
  const run = runs.find(item => item.id === runId)
  const automation = run === undefined ? undefined : automations.find(item => item.id === run.automationId)
  if (automation === undefined || run === undefined) return undefined
  const date = calendarDateKey(run.retryScheduledFor ?? run.scheduledFor)
  return { ...automation, calendarRun: run, ...(date === undefined ? {} : { calendarDate: date }) }
}
