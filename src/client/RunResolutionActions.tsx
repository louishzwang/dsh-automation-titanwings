import { useState } from 'react'
import type { Translate } from './contracts.js'
import type { AutomationRunViewModel } from './protocol.js'
import { runNeedsAttention } from './helpers.js'

/** Shared actions keep the calendar and run history on the same resolution path. */
export function RunResolutionActions({ run, t, busy, onResolve, onIgnore, canRetry = true }: {
  run: AutomationRunViewModel
  t: Translate
  busy: boolean
  onResolve?: ((id: string, action: 'confirm' | 'retry') => void) | undefined
  onIgnore?: ((id: string) => void) | undefined
  canRetry?: boolean
}): JSX.Element | null {
  const [pending, setPending] = useState<'confirm' | 'retry'>()
  if (run.resolution !== undefined) return (
    <details className="dsh-automation-prompt-details">
      <summary>{t(run.resolution.kind === 'confirmed' ? 'run.confirmed' : 'run.retried')} · {t('run.audit')}</summary>
      <p>{t(`status.${run.resolution.previousStatus}`)} · {run.resolution.at}</p>
      {run.resolution.previousError !== null && <pre>{run.resolution.previousError.message}</pre>}
    </details>
  )
  if (!['failed', 'interrupted', 'skipped', 'cancelled'].includes(run.status)) return null
  const needsAttention = runNeedsAttention(run)
  return (
    <div>
      {!needsAttention && <p>{t('run.ignored')}</p>}
      {onResolve !== undefined && (pending === undefined ? (
        <div className="dsh-automation-run-actions">
          <button className="dsh-automation-button dsh-automation-button--ghost" type="button" disabled={busy} onClick={() => setPending('confirm')}>{t('run.confirmResult')}</button>
          {canRetry && <button className="dsh-automation-button dsh-automation-button--ghost" type="button" disabled={busy} onClick={() => setPending('retry')}>{t('card.retry')}</button>}
          {needsAttention && onIgnore !== undefined && <button className="dsh-automation-button dsh-automation-button--ghost" type="button" disabled={busy} onClick={() => onIgnore(run.id)}>{t('run.markRead')}</button>}
        </div>
      ) : (
        <div className="dsh-automation-delete-confirm dsh-automation-run-confirm">
          <div><strong>{t(pending === 'confirm' ? 'run.confirmResult' : 'card.retry')}</strong><span>{t(pending === 'confirm' ? 'run.confirmHint' : 'run.retryHint')}</span></div>
          <div>
            <button className="dsh-automation-button dsh-automation-button--ghost" type="button" disabled={busy} onClick={() => setPending(undefined)}>{t('card.cancel')}</button>
            <button className="dsh-automation-button dsh-automation-button--primary" type="button" disabled={busy} onClick={() => { onResolve(run.id, pending); setPending(undefined) }}>{t('card.confirm')}</button>
          </div>
        </div>
      ))}
    </div>
  )
}
