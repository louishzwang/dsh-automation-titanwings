export interface AutomationTab {
    readonly textContent: string | null;
    click(): void;
}
export type AutomationNavigationResult = 'opened' | 'unavailable';
/** Find the localized Automations tab without coupling navigation to CSS classes. */
export declare function findAutomationTab(tabs: Iterable<AutomationTab>, label: string): AutomationTab | undefined;
/** Open the tab when it exists; otherwise require the caller to surface feedback. */
export declare function activateAutomationTab(tabs: Iterable<AutomationTab>, label: string, onUnavailable: () => void): AutomationNavigationResult;
