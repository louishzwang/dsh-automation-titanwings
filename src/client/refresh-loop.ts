/** A single completion-driven poller. Hidden pages pause reads; visibility resumes immediately. */
export function startRefreshLoop(refresh: () => Promise<void>, options: {
  readonly isVisible: () => boolean
  readonly subscribeVisibility: (listener: () => void) => () => void
  readonly intervalMs: number
  readonly retryMs: number
}): () => void {
  let stopped = false
  let pending = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const clear = (): void => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }
  const poll = async (): Promise<void> => {
    if (stopped || pending || !options.isVisible()) return
    pending = true
    let delay = options.intervalMs
    try { await refresh() } catch { delay = options.retryMs }
    pending = false
    if (!stopped && options.isVisible()) timer = setTimeout(() => { void poll() }, delay)
  }
  const unsubscribe = options.subscribeVisibility(() => { clear(); void poll() })
  void poll()
  return () => { stopped = true; clear(); unsubscribe() }
}

/** Coalesce DOM bursts and prevent callbacks after disposal. */
export function coalesceFrame(task: () => void, frames: {
  request(callback: () => void): number
  cancel(id: number): void
}): { schedule(): void; dispose(): void } {
  let frame: number | undefined
  let disposed = false
  return {
    schedule() {
      if (disposed || frame !== undefined) return
      frame = frames.request(() => {
        frame = undefined
        if (!disposed) task()
      })
    },
    dispose() {
      disposed = true
      if (frame !== undefined) frames.cancel(frame)
      frame = undefined
    },
  }
}
