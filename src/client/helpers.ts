import type { Translate } from './contracts.js'
import type { AutomationLocaleKey } from './locales.js'
import type {
  AutomationSchedule,
  AutomationRunStatus,
  AutomationSnapshot,
  CreateAutomationInput,
} from './protocol.js'

export type ScheduleKind = 'once' | 'interval' | 'daily' | 'weekly'

export interface AutomationFormState {
  readonly name: string
  readonly prompt: string
  readonly scheduleKind: ScheduleKind
  readonly onceAt: string
  readonly everyMinutes: string
  readonly time: string
  readonly weekdays: readonly number[]
  readonly timeZone: string
  readonly permission: CreateAutomationInput['permission']
}

export type FormErrorKey =
  | 'form.error.name'
  | 'form.error.prompt'
  | 'form.error.once'
  | 'form.error.interval'
  | 'form.error.weekdays'

export class AutomationFormError extends Error {
  constructor(readonly key: FormErrorKey) {
    super(key)
  }
}

export function localDateTimeValue(date = new Date()): string {
  const future = new Date(date.getTime() + 60 * 60 * 1000)
  future.setMinutes(0, 0, 0)
  const offset = future.getTimezoneOffset() * 60_000
  return new Date(future.getTime() - offset).toISOString().slice(0, 16)
}

export function defaultFormState(now = new Date()): AutomationFormState {
  return {
    name: '',
    prompt: '',
    scheduleKind: 'daily',
    onceAt: localDateTimeValue(now),
    everyMinutes: '60',
    time: '09:00',
    weekdays: [1, 2, 3, 4, 5],
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    permission: 'read-only',
  }
}

export function buildCreateInput(form: AutomationFormState, now = new Date()): CreateAutomationInput {
  const name = form.name.trim()
  const prompt = form.prompt.trim()
  if (name === '') throw new AutomationFormError('form.error.name')
  if (prompt === '') throw new AutomationFormError('form.error.prompt')

  let schedule: CreateAutomationInput['schedule']
  switch (form.scheduleKind) {
    case 'once': {
      const at = new Date(form.onceAt)
      if (!Number.isFinite(at.getTime()) || at.getTime() <= now.getTime()) {
        throw new AutomationFormError('form.error.once')
      }
      schedule = { kind: 'once', at: at.toISOString(), timeZone: form.timeZone }
      break
    }
    case 'interval': {
      const everyMinutes = Number(form.everyMinutes)
      if (!Number.isInteger(everyMinutes) || everyMinutes < 5 || everyMinutes > 43_200) {
        throw new AutomationFormError('form.error.interval')
      }
      schedule = { kind: 'interval', everyMinutes, anchor: now.toISOString(), timeZone: form.timeZone }
      break
    }
    case 'daily':
      schedule = { kind: 'daily', time: form.time, timeZone: form.timeZone }
      break
    case 'weekly':
      if (form.weekdays.length === 0) throw new AutomationFormError('form.error.weekdays')
      schedule = { kind: 'weekly', time: form.time, weekdays: [...form.weekdays].sort((a, b) => a - b), timeZone: form.timeZone }
      break
  }
  return { name, prompt, schedule, timeZone: form.timeZone, permission: form.permission }
}

const ATTENTION_STATUSES = new Set<AutomationRunStatus>(['failed', 'interrupted'])

export interface OverviewStats {
  readonly total: number
  readonly active: number
  readonly attention: number
  readonly nextRunAt?: string
}

export function deriveOverview(snapshot: AutomationSnapshot): OverviewStats {
  const next = snapshot.automations
    .filter(item => item.status === 'active' && item.nextRunAt !== undefined)
    .map(item => item.nextRunAt as string)
    .sort((a, b) => Date.parse(a) - Date.parse(b))[0]
  return {
    total: snapshot.automations.length,
    active: snapshot.automations.filter(item => item.status === 'active').length,
    attention: snapshot.runs.filter(run => ATTENTION_STATUSES.has(run.status) && run.unread !== false).length,
    ...(next === undefined ? {} : { nextRunAt: next }),
  }
}

export function formatRelativeTime(iso: string, now: Date, t: Translate): string {
  const value = Date.parse(iso)
  if (!Number.isFinite(value)) return iso
  const deltaMinutes = Math.round((value - now.getTime()) / 60_000)
  const abs = Math.abs(deltaMinutes)
  if (abs < 1) return t('time.now')
  const future = deltaMinutes > 0
  if (abs < 60) return t(future ? 'time.inMinute' : 'time.minuteAgo', { count: abs })
  const hours = Math.round(abs / 60)
  if (hours < 24) return t(future ? 'time.inHour' : 'time.hourAgo', { count: hours })
  const days = Math.round(hours / 24)
  return t(future ? 'time.inDay' : 'time.dayAgo', { count: days })
}

export function shortSessionId(sessionId: string): string {
  return sessionId.length <= 12 ? sessionId : `${sessionId.slice(0, 8)}…${sessionId.slice(-4)}`
}

export function formatSchedule(schedule: AutomationSchedule, t: Translate): string {
  switch (schedule.kind) {
    case 'once':
      return t('schedule.onceAt', {
        time: new Date(schedule.at).toLocaleString(undefined, {
          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
        }),
      })
    case 'interval':
      return t('schedule.everyMinutes', { count: schedule.everyMinutes })
    case 'daily':
      return t('schedule.dailyAt', { time: schedule.time })
    case 'weekly':
      return t('schedule.weeklyAt', {
        days: schedule.weekdays.map(day => t(`day.${day}` as AutomationLocaleKey)).join(' · '),
        time: schedule.time,
      })
  }
}
