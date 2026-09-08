/** A single completion-driven poller. Hidden pages pause reads; visibility resumes immediately. */
export declare function startRefreshLoop(refresh: () => Promise<void>, options: {
    readonly isVisible: () => boolean;
    readonly subscribeVisibility: (listener: () => void) => () => void;
    readonly intervalMs: number;
    readonly retryMs: number;
}): () => void;
/** Coalesce DOM bursts and prevent callbacks after disposal. */
export declare function coalesceFrame(task: () => void, frames: {
    request(callback: () => void): number;
    cancel(id: number): void;
}): {
    schedule(): void;
    dispose(): void;
};
