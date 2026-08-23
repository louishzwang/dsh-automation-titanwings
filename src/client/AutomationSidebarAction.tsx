import { useState } from 'react'
import type { AutomationSidebarActionProps } from './contracts.js'
import { AutomationIcon } from './icons.js'
import { activateAutomationTab } from './navigation.js'

/** Compatibility entry for DSH's root-scoped sidebar footer. */
export function AutomationSidebarAction({
  wide,
  t,
  automationTabs,
}: AutomationSidebarActionProps): JSX.Element {
  const [unavailable, setUnavailable] = useState(false)
  const noticeId = 'dsh-automation-sidebar-unavailable'

  const open = (): void => {
    // DSH removes the whole tab ring in its blank Hero. Creating another
    // blank Session would leave it removed, so make that state explicit.
    const result = activateAutomationTab(
      automationTabs(),
      t('tab'),
      () => { setUnavailable(true) },
    )
    if (result === 'opened') setUnavailable(false)
  }

  return (
    <div className="dsh-automation-sidebar-action" data-wide={wide || undefined}>
      <button
        type="button"
        className="dsh-automation-sidebar-button"
        data-dsh-automation-entry=""
        aria-label={t('sidebar.open')}
        aria-describedby={unavailable ? noticeId : undefined}
        title={wide ? undefined : t('sidebar.open')}
        onClick={open}
      >
        <AutomationIcon />
        {wide && <span>{t('tab')}</span>}
      </button>
      {unavailable && (
        <span id={noticeId} className="dsh-automation-sidebar-feedback" role="status">
          {t('sidebar.unavailable')}
        </span>
      )}
    </div>
  )
}
