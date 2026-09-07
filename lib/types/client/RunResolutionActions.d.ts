import type { Translate } from './contracts.js';
import type { AutomationRunViewModel } from './protocol.js';
/** Shared actions keep the calendar and run history on the same resolution path. */
export declare function RunResolutionActions({ run, t, busy, onResolve, onIgnore, canRetry }: {
    run: AutomationRunViewModel;
    t: Translate;
    busy: boolean;
    onResolve?: ((id: string, action: 'confirm' | 'retry') => void) | undefined;
    onIgnore?: ((id: string) => void) | undefined;
    canRetry?: boolean;
}): JSX.Element | null;
