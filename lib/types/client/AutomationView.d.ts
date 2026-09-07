import { type CalendarTask } from './task-calendar.js';
import type { AutomationViewProps, Translate } from './contracts.js';
import type { AutomationRunViewModel, AutomationViewModel, RunNowMode } from './protocol.js';
interface TimeZoneChoice {
    readonly value: string;
    readonly label: string;
}
/** Cache standard-offset labels without rebuilding hundreds of formatters while typing. */
export declare function timeZoneChoices(current: string): readonly TimeZoneChoice[];
export interface AutomationFloatBox {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
}
export interface AutomationFloatViewport {
    readonly width: number;
    readonly height: number;
    readonly offsetLeft?: number;
    readonly offsetTop?: number;
}
export interface AutomationFloatAnchor {
    readonly left: number;
    readonly right: number;
    readonly top: number;
    readonly bottom: number;
}
/** Keep the complete floating editor inside even a narrow visual viewport. */
export declare function clampAutomationFloatBox(value: AutomationFloatBox, viewport: AutomationFloatViewport): AutomationFloatBox;
export declare function initialAutomationFloatBox(anchor?: AutomationFloatAnchor, viewport?: AutomationFloatViewport, initialHeight?: number): AutomationFloatBox;
interface AutomationRunDialogProps {
    readonly t: Translate;
    readonly automation: CalendarTask;
    readonly busy: boolean;
    readonly onCancel: () => void;
    readonly onRun: (automationId: string, mode: RunNowMode) => Promise<void>;
}
/** Ask how a manual run should treat the pending schedule: replace it or leave it. */
export declare function AutomationRunDialog(props: AutomationRunDialogProps): JSX.Element;
interface AutomationCardProps {
    readonly onResolve?: ((runId: string, action: 'confirm' | 'retry') => void) | undefined;
    readonly onIgnore?: ((runId: string) => void) | undefined;
    readonly resolutionBusy?: boolean | undefined;
    readonly automation: CalendarTask;
    readonly onOpen: (runId: string, sessionId: string) => void;
    readonly now: Date;
    readonly t: Translate;
    readonly busyKey: string | undefined;
    readonly confirmingDelete: boolean;
    readonly onConfirmDelete: (id?: string) => void;
    readonly onEdit: (automation: AutomationViewModel, anchor?: DOMRect) => void;
    readonly onMutate: (id: string, mutation: 'pause' | 'resume' | 'delete') => void;
    readonly onRun: (automation: AutomationViewModel, anchor?: DOMRect) => void;
}
export declare function AutomationCard(props: AutomationCardProps): JSX.Element;
export declare function RecentRun({ run, now, t, busy, automationMissing, confirmingDelete, onOpen, onMarkRead, onReadd, onConfirmDelete, onDelete, onResolve, onAgain, resolutionBusy }: {
    onResolve?: ((runId: string, action: 'confirm' | 'retry') => void) | undefined;
    onAgain?: (() => void) | undefined;
    resolutionBusy?: boolean | undefined;
    run: AutomationRunViewModel;
    now: Date;
    t: Translate;
    busy: boolean;
    automationMissing: boolean;
    confirmingDelete: boolean;
    onOpen: (runId: string, sessionId: string) => void;
    onMarkRead: (runId: string) => void;
    onReadd: (run: AutomationRunViewModel, anchor?: DOMRect) => void;
    onConfirmDelete: (runId?: string) => void;
    onDelete: (runId: string) => void;
}): JSX.Element;
/** Native conversation view: all data and effects arrive through the slot's four shares. */
export declare function AutomationView({ t, useAutomationState, refresh, createAutomation, updateAutomation, mutateAutomation, runNow, markRunRead, confirmRun, retryRun, deleteRun, updateSettings, loadModelCatalog, openSession, refreshSessions, }: AutomationViewProps): JSX.Element;
export {};
