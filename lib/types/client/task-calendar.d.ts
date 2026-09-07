import type { AutomationRunStatus, AutomationRunViewModel, AutomationViewModel } from './protocol.js';
export interface CalendarTask extends AutomationViewModel {
    readonly calendarRun?: AutomationRunViewModel;
    readonly calendarDate?: string;
    readonly calendarStatus?: AutomationRunStatus;
}
export type CalendarTaskKind = 'active' | 'paused' | 'executed' | 'attention' | 'running' | 'ignored';
export declare function calendarDateKey(iso: string | Date | undefined): string | undefined;
export declare function calendarTaskStatus(task: CalendarTask): AutomationRunStatus | undefined;
export declare function isUnverifiedRun(run: AutomationRunViewModel | undefined): boolean;
export declare function calendarTaskKind(task: CalendarTask): CalendarTaskKind;
/** Index once per snapshot; each date contains a definition at most once. */
export declare function buildTaskCalendar(automations: readonly AutomationViewModel[], runs: readonly AutomationRunViewModel[]): {
    readonly days: ReadonlyMap<string, readonly CalendarTask[]>;
    readonly all: readonly CalendarTask[];
};
export declare function calendarCounts(tasks: readonly CalendarTask[]): Record<CalendarTaskKind, number>;
