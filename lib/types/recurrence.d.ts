import type { AutomationSchedule } from './types.ts';
export declare function assertValidSchedule(schedule: AutomationSchedule): void;
export declare function normalizeSchedule(schedule: AutomationSchedule): AutomationSchedule;
export declare function scheduleToRRule(schedule: AutomationSchedule): string;
export declare function nextOccurrence(schedule: AutomationSchedule, afterExclusive: string): string | null;
/** Latest scheduled occurrence at or before `now`, without materializing a backlog. */
export declare function latestDueOccurrence(schedule: AutomationSchedule, now: string): string | null;
export declare function occurrencesBetween(schedule: AutomationSchedule, afterExclusive: string, untilInclusive: string, limit?: number): string[];
/** Newest bounded occurrences, returned oldest first without scanning an entire backlog. */
export declare function recentOccurrencesBetween(schedule: AutomationSchedule, afterExclusive: string, untilInclusive: string, limit: number): string[];
