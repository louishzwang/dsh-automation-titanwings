export interface AutomationTab {
  readonly textContent: string | null
  click(): void
}

export type AutomationNavigationResult = 'opened' | 'unavailable'

function normalizedLabel(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

/** Find the localized Automations tab without coupling navigation to CSS classes. */
export function findAutomationTab(
  tabs: Iterable<AutomationTab>,
  label: string,
): AutomationTab | undefined {
  const expected = normalizedLabel(label)
  return [...tabs].find(tab => normalizedLabel(tab.textContent ?? '') === expected)
}

/** Open the tab when it exists; otherwise require the caller to surface feedback. */
export function activateAutomationTab(
  tabs: Iterable<AutomationTab>,
  label: string,
  onUnavailable: () => void,
): AutomationNavigationResult {
  const tab = findAutomationTab(tabs, label)
  if (tab === undefined) {
    onUnavailable()
    return 'unavailable'
  }
  tab.click()
  return 'opened'
}
