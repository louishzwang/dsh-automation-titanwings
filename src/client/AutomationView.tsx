import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { AutomationViewProps, Translate } from './contracts.js'
import {
  AutomationFormError,
  buildCreateInput,
  defaultFormState,
  deriveOverview,
  formatSchedule,
  formatRelativeTime,
  shortSessionId,
  type AutomationFormState,
  type ScheduleKind,
} from './helpers.js'
import {
  AlertIcon,
  AutomationIcon,
  CalendarIcon,
  CheckIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  RefreshIcon,
  ShieldIcon,
  TrashIcon,
} from './icons.js'
import type {
  AutomationRunStatus,
  AutomationRunViewModel,
  AutomationViewModel,
} from './protocol.js'

const POLL_INTERVAL_MS = 15_000
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const

type BusyAction = 'create' | 'pause' | 'resume' | 'run' | 'read' | 'delete'

function actionKey(action: BusyAction, id = ''): string {
  return `${action}:${id}`
}

function statusLabel(t: Translate, status: AutomationRunStatus): string {
  return t(`status.${status}`)
}

function AutomationStatusBadge({ status, t }: { status: AutomationViewModel['status']; t: Translate }): JSX.Element {
  return (
    <span className={`dsh-automation-badge dsh-automation-badge--${status}`}>
      <span className="dsh-automation-status-dot" />
      {t(`status.${status}`)}
    </span>
  )
}

function RunStatusBadge({ status, t }: { status: AutomationRunStatus; t: Translate }): JSX.Element {
  const icon = status === 'succeeded'
    ? <CheckIcon />
    : status === 'failed' || status === 'interrupted'
      ? <AlertIcon />
      : status === 'running' || status === 'queued'
        ? <AutomationIcon />
        : undefined
  return (
    <span className={`dsh-automation-run-status dsh-automation-run-status--${status}`}>
      {icon}
      {statusLabel(t, status)}
    </span>
  )
}

interface CreateFormProps {
  readonly t: Translate
  readonly busy: boolean
  readonly onCancel: () => void
  readonly onSubmit: (input: ReturnType<typeof buildCreateInput>) => Promise<void>
}

function CreateAutomationForm({ t, busy, onCancel, onSubmit }: CreateFormProps): JSX.Element {
  const [form, setForm] = useState<AutomationFormState>(() => defaultFormState())
  const [validationError, setValidationError] = useState<string>()

  const update = <Key extends keyof AutomationFormState>(key: Key, value: AutomationFormState[Key]): void => {
    setForm(current => ({ ...current, [key]: value }))
    setValidationError(undefined)
  }
  const toggleWeekday = (day: number): void => {
    update('weekdays', form.weekdays.includes(day)
      ? form.weekdays.filter(value => value !== day)
      : [...form.weekdays, day])
  }
  const submit = (event: FormEvent): void => {
    event.preventDefault()
    try {
      const input = buildCreateInput(form)
      setValidationError(undefined)
      void onSubmit(input)
    } catch (error) {
      if (error instanceof AutomationFormError) {
        setValidationError(t(error.key))
        return
      }
      throw error
    }
  }

  return (
    <form className="dsh-automation-create" onSubmit={submit}>
      <div className="dsh-automation-create-heading">
        <div>
          <span className="dsh-automation-kicker">{t('header.eyebrow')}</span>
          <h2>{t('form.title')}</h2>
          <p>{t('form.subtitle')}</p>
        </div>
        <button className="dsh-automation-button dsh-automation-button--ghost" type="button" onClick={onCancel} disabled={busy}>
          {t('form.cancel')}
        </button>
      </div>

      <div className="dsh-automation-form-grid">
        <label className="dsh-automation-field">
          <span>{t('form.name')}</span>
          <input value={form.name} maxLength={80} placeholder={t('form.namePlaceholder')} onChange={event => update('name', event.currentTarget.value)} />
        </label>
        <label className="dsh-automation-field dsh-automation-field--wide">
          <span>{t('form.prompt')}</span>
          <textarea value={form.prompt} maxLength={12_000} rows={4} placeholder={t('form.promptPlaceholder')} onChange={event => update('prompt', event.currentTarget.value)} />
        </label>

        <fieldset className="dsh-automation-fieldset dsh-automation-field--wide">
          <legend>{t('form.schedule')}</legend>
          <div className="dsh-automation-segmented">
            {(['once', 'interval', 'daily', 'weekly'] as const).map(kind => (
              <button
                key={kind}
                type="button"
                className={form.scheduleKind === kind ? 'is-selected' : ''}
                aria-pressed={form.scheduleKind === kind}
                onClick={() => update('scheduleKind', kind as ScheduleKind)}
              >
                {t(`form.${kind}`)}
              </button>
            ))}
          </div>
          <div className="dsh-automation-schedule-fields">
            {form.scheduleKind === 'once' && (
              <label className="dsh-automation-field">
                <span>{t('form.runAt')}</span>
                <input type="datetime-local" value={form.onceAt} onChange={event => update('onceAt', event.currentTarget.value)} />
              </label>
            )}
            {form.scheduleKind === 'interval' && (
              <label className="dsh-automation-field">
                <span>{t('form.every')}</span>
                <span className="dsh-automation-inline-input">
                  <input type="number" min={5} max={43_200} value={form.everyMinutes} onChange={event => update('everyMinutes', event.currentTarget.value)} />
                  <span>{t('form.minutes')}</span>
                </span>
              </label>
            )}
            {(form.scheduleKind === 'daily' || form.scheduleKind === 'weekly') && (
              <label className="dsh-automation-field">
                <span>{t('form.time')}</span>
                <input type="time" value={form.time} onChange={event => update('time', event.currentTarget.value)} />
              </label>
            )}
            {form.scheduleKind === 'weekly' && (
              <div className="dsh-automation-field dsh-automation-weekdays">
                <span>{t('form.days')}</span>
                <div>
                  {WEEKDAYS.map(day => (
                    <button key={day} type="button" aria-pressed={form.weekdays.includes(day)} className={form.weekdays.includes(day) ? 'is-selected' : ''} onClick={() => toggleWeekday(day)}>
                      {t(`day.${day}`)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <label className="dsh-automation-field">
              <span>{t('form.timeZone')}</span>
              <input value={form.timeZone} onChange={event => update('timeZone', event.currentTarget.value)} />
            </label>
          </div>
        </fieldset>

        <fieldset className="dsh-automation-fieldset dsh-automation-field--wide">
          <legend>{t('form.permission')}</legend>
          <div className="dsh-automation-permission-grid">
            {(['read-only', 'workspace-write'] as const).map(permission => (
              <label key={permission} className={form.permission === permission ? 'is-selected' : ''}>
                <input type="radio" name="permission" value={permission} checked={form.permission === permission} onChange={() => update('permission', permission)} />
                <ShieldIcon />
                <span>
                  <strong>{t(permission === 'read-only' ? 'form.readOnly' : 'form.workspaceWrite')}</strong>
                  <small>{t(permission === 'read-only' ? 'form.readOnlyHint' : 'form.workspaceWriteHint')}</small>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <div className="dsh-automation-form-footer">
        <span className="dsh-automation-form-error" role="alert">{validationError}</span>
        <button className="dsh-automation-button dsh-automation-button--primary" type="submit" disabled={busy}>
          <PlusIcon />
          {busy ? t('form.submitting') : t('form.submit')}
        </button>
      </div>
    </form>
  )
}

interface AutomationCardProps {
  readonly automation: AutomationViewModel
  readonly now: Date
  readonly t: Translate
  readonly busyKey: string | undefined
  readonly confirmingDelete: boolean
  readonly onConfirmDelete: (id?: string) => void
  readonly onMutate: (id: string, mutation: 'pause' | 'resume' | 'delete') => void
  readonly onRun: (id: string) => void
}

function AutomationCard(props: AutomationCardProps): JSX.Element {
  const { automation, now, t, busyKey, confirmingDelete, onConfirmDelete, onMutate, onRun } = props
  const isBusy = busyKey?.endsWith(`:${automation.id}`) === true
  return (
    <article className="dsh-automation-card">
      <div className="dsh-automation-card-top">
        <div className="dsh-automation-card-title">
          <span className="dsh-automation-card-icon"><AutomationIcon /></span>
          <div>
            <h3>{automation.name}</h3>
            <div className="dsh-automation-card-badges">
              <AutomationStatusBadge status={automation.status} t={t} />
              <span className="dsh-automation-permission-badge"><ShieldIcon />{t(`card.permission.${automation.permission}`)}</span>
            </div>
          </div>
        </div>
        <span className="dsh-automation-revision">v{automation.revision}</span>
      </div>

      <p className="dsh-automation-prompt">{automation.prompt}</p>
      <div className="dsh-automation-schedule-line">
        <CalendarIcon />
        <strong>{formatSchedule(automation.schedule, t)}</strong>
        <span>{automation.timeZone}</span>
      </div>
      <dl className="dsh-automation-card-times">
        <div>
          <dt>{t('card.nextRun')}</dt>
          <dd>{automation.status === 'active' && automation.nextRunAt !== undefined
            ? formatRelativeTime(automation.nextRunAt, now, t)
            : '—'}</dd>
        </div>
        <div>
          <dt>{t('card.lastRun')}</dt>
          <dd>{automation.lastRunAt === undefined
            ? t('card.never')
            : <><span className={`dsh-automation-mini-dot dsh-automation-mini-dot--${automation.lastRunStatus ?? 'succeeded'}`} />{formatRelativeTime(automation.lastRunAt, now, t)}</>}</dd>
        </div>
      </dl>

      {confirmingDelete ? (
        <div className="dsh-automation-delete-confirm">
          <div><strong>{t('card.confirmDelete')}</strong><span>{t('card.confirmDeleteHint')}</span></div>
          <div>
            <button className="dsh-automation-button dsh-automation-button--ghost" type="button" onClick={() => onConfirmDelete()} disabled={isBusy}>{t('card.cancel')}</button>
            <button className="dsh-automation-button dsh-automation-button--danger" type="button" onClick={() => onMutate(automation.id, 'delete')} disabled={isBusy}><TrashIcon />{t('card.confirm')}</button>
          </div>
        </div>
      ) : (
        <div className="dsh-automation-card-actions">
          <button className="dsh-automation-button dsh-automation-button--ghost" type="button" onClick={() => onRun(automation.id)} disabled={isBusy}>
            <PlayIcon />{t('card.runNow')}
          </button>
          <button className="dsh-automation-button dsh-automation-button--ghost" type="button" onClick={() => onMutate(automation.id, automation.status === 'active' ? 'pause' : 'resume')} disabled={isBusy}>
            {automation.status === 'active' ? <PauseIcon /> : <PlayIcon />}
            {t(automation.status === 'active' ? 'card.pause' : 'card.resume')}
          </button>
          <button className="dsh-automation-icon-button" type="button" aria-label={t('card.delete')} title={t('card.delete')} onClick={() => onConfirmDelete(automation.id)} disabled={isBusy}>
            <TrashIcon />
          </button>
        </div>
      )}
    </article>
  )
}

function RecentRun({ run, now, t, busy, onOpen, onMarkRead }: {
  run: AutomationRunViewModel
  now: Date
  t: Translate
  busy: boolean
  onOpen: (runId: string, sessionId: string) => void
  onMarkRead: (runId: string) => void
}): JSX.Element {
  const timestamp = run.finishedAt ?? run.startedAt ?? run.scheduledFor
  const canMarkRead = run.unread !== false
    && (run.status === 'failed' || run.status === 'interrupted'
      || run.status === 'skipped' || run.status === 'cancelled')
  return (
    <article className="dsh-automation-run">
      <div className="dsh-automation-run-head">
        <div>
          <span className="dsh-automation-run-name">{run.automationName}</span>
          <span className="dsh-automation-run-trigger">{t(`run.trigger.${run.trigger}`)}</span>
        </div>
        <time dateTime={timestamp}>{formatRelativeTime(timestamp, now, t)}</time>
      </div>
      <RunStatusBadge status={run.status} t={t} />
      {(run.summary !== undefined || run.error !== undefined) && (
        <p className={run.error === undefined ? '' : 'is-error'}>{run.error ?? run.summary}</p>
      )}
      {run.sessionId !== undefined && (
        <button className="dsh-automation-session-id" type="button" onClick={() => onOpen(run.id, run.sessionId!)}>
          {t('run.openSession', { id: shortSessionId(run.sessionId) })}
        </button>
      )}
      {canMarkRead && (
        <button className="dsh-automation-run-review" type="button" onClick={() => onMarkRead(run.id)} disabled={busy}>
          <CheckIcon />{t('run.markRead')}
        </button>
      )}
    </article>
  )
}

/** Native conversation view: all data and effects arrive through the slot's four shares. */
export function AutomationView({
  t, useAutomationState, refresh, createAutomation, mutateAutomation, runNow, markRunRead, openSession,
}: AutomationViewProps): JSX.Element {
  const state = useAutomationState(value => value)
  const [showCreate, setShowCreate] = useState(false)
  const [busyKey, setBusyKey] = useState<string>()
  const [actionError, setActionError] = useState<string>()
  const [confirmDeleteId, setConfirmDeleteId] = useState<string>()

  useEffect(() => {
    void refresh().catch(() => undefined)
    const timer = window.setInterval(() => { void refresh().catch(() => undefined) }, POLL_INTERVAL_MS)
    return () => { window.clearInterval(timer) }
  }, [refresh])

  const snapshot = state.snapshot
  const stats = useMemo(() => snapshot === undefined ? undefined : deriveOverview(snapshot), [snapshot])
  const now = useMemo(() => new Date(snapshot?.serverNow ?? Date.now()), [snapshot?.serverNow])

  const perform = async (key: string, action: () => Promise<void>): Promise<void> => {
    setBusyKey(key)
    setActionError(undefined)
    try {
      await action()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : t('error.action'))
    } finally {
      setBusyKey(undefined)
    }
  }
  const onMutate = (id: string, mutation: 'pause' | 'resume' | 'delete'): void => {
    void perform(actionKey(mutation, id), async () => {
      await mutateAutomation(id, mutation)
      if (mutation === 'delete') setConfirmDeleteId(undefined)
    })
  }
  const onRun = (id: string): void => {
    void perform(actionKey('run', id), () => runNow(id))
  }
  const onOpenSession = (runId: string, sessionId: string): void => {
    void perform(actionKey('run', runId), () => openSession(runId, sessionId))
  }
  const onMarkRead = (runId: string): void => {
    void perform(actionKey('read', runId), () => markRunRead(runId))
  }
  const onCreate = async (input: ReturnType<typeof buildCreateInput>): Promise<void> => {
    await perform(actionKey('create'), async () => {
      await createAutomation(input)
      setShowCreate(false)
    })
  }

  if (snapshot === undefined && (state.phase === 'idle' || state.phase === 'loading')) {
    return (
      <div className="dsh-automation-shell dsh-automation-centered" role="status">
        <span className="dsh-automation-loader"><AutomationIcon /></span>
        <span>{t('loading')}</span>
      </div>
    )
  }

  if (snapshot === undefined) {
    return (
      <div className="dsh-automation-shell dsh-automation-centered">
        <span className="dsh-automation-error-icon"><AlertIcon /></span>
        <h2>{t('error.title')}</h2>
        <p>{state.error}</p>
        <button className="dsh-automation-button dsh-automation-button--primary" type="button" onClick={() => { void refresh().catch(() => undefined) }}>
          <RefreshIcon />{t('error.retry')}
        </button>
      </div>
    )
  }

  return (
    <div className="dsh-automation-shell">
      <header className="dsh-automation-header">
        <div className="dsh-automation-heading">
          <span className="dsh-automation-logo"><AutomationIcon /></span>
          <div>
            <span className="dsh-automation-kicker">{t('header.eyebrow')}</span>
            <h1>{t('header.title')}</h1>
            <p>{t('header.subtitle')}</p>
          </div>
        </div>
        <button className="dsh-automation-button dsh-automation-button--primary" type="button" onClick={() => setShowCreate(value => !value)}>
          {showCreate ? <PauseIcon /> : <PlusIcon />}
          {showCreate ? t('header.closeCreate') : t('header.create')}
        </button>
      </header>

      <div className="dsh-automation-scope">
        <span><strong>{t('scope.workspace')}</strong>{snapshot.scope.workspaceName ?? snapshot.scope.workspaceId ?? '—'}</span>
        <span><strong>{t('scope.folder')}</strong><code>{snapshot.scope.cwd}</code></span>
      </div>

      {showCreate && (
        <CreateAutomationForm t={t} busy={busyKey === actionKey('create')} onCancel={() => setShowCreate(false)} onSubmit={onCreate} />
      )}

      <section className="dsh-automation-stats" aria-label={t('header.title')}>
        <div><span>{t('stats.total')}</span><strong>{stats?.total ?? 0}</strong></div>
        <div><span>{t('stats.active')}</span><strong>{stats?.active ?? 0}</strong></div>
        <div><span>{t('stats.next')}</span><strong>{stats?.nextRunAt === undefined ? t('stats.noneScheduled') : formatRelativeTime(stats.nextRunAt, now, t)}</strong></div>
        <div className={(stats?.attention ?? 0) > 0 ? 'is-attention' : ''}><span>{t('stats.attention')}</span><strong>{(stats?.attention ?? 0) === 0 ? t('stats.noAttention') : stats?.attention}</strong></div>
      </section>

      {(actionError !== undefined || state.error !== undefined) && (
        <div className="dsh-automation-inline-error" role="alert"><AlertIcon />{actionError ?? state.error}</div>
      )}

      <div className="dsh-automation-content">
        <section className="dsh-automation-main-column">
          <div className="dsh-automation-section-heading">
            <div><h2>{t('section.automations')}</h2><p>{t('section.automationsHint')}</p></div>
            <button className="dsh-automation-icon-button" type="button" aria-label={t('section.refresh')} title={t('section.refresh')} onClick={() => { void refresh().catch(() => undefined) }} disabled={state.phase === 'loading'}><RefreshIcon /></button>
          </div>
          {snapshot.automations.length === 0 ? (
            <div className="dsh-automation-empty">
              <span><AutomationIcon /></span>
              <h3>{t('empty.title')}</h3>
              <p>{t('empty.body')}</p>
              <button className="dsh-automation-button dsh-automation-button--primary" type="button" onClick={() => setShowCreate(true)}><PlusIcon />{t('empty.action')}</button>
            </div>
          ) : (
            <div className="dsh-automation-card-list">
              {snapshot.automations.map(automation => (
                <AutomationCard
                  key={automation.id}
                  automation={automation}
                  now={now}
                  t={t}
                  busyKey={busyKey}
                  confirmingDelete={confirmDeleteId === automation.id}
                  onConfirmDelete={setConfirmDeleteId}
                  onMutate={onMutate}
                  onRun={onRun}
                />
              ))}
            </div>
          )}
        </section>

        <aside className="dsh-automation-runs-column">
          <div className="dsh-automation-section-heading">
            <div><h2>{t('section.runs')}</h2><p>{t('section.runsHint')}</p></div>
          </div>
          {snapshot.runs.length === 0
            ? <div className="dsh-automation-runs-empty">{t('runs.empty')}</div>
            : <div className="dsh-automation-run-list">{snapshot.runs.slice(0, 12).map(run => (
                <RecentRun
                  key={run.id}
                  run={run}
                  now={now}
                  t={t}
                  busy={busyKey?.endsWith(`:${run.id}`) === true}
                  onOpen={onOpenSession}
                  onMarkRead={onMarkRead}
                />
              ))}</div>}
        </aside>
      </div>
    </div>
  )
}
