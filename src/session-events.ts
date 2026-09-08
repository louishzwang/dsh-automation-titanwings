/** Compatibility boundary for old live event arrays and newer immutable Session snapshots. */
export interface SessionEventLike {
  readonly seq: number
  readonly type: string
  readonly data: Record<string, any>
}

/** Never turn an unsupported Host API into an apparently empty successful result. */
export function readSessionEvents(session: unknown, fromSeq = 0): readonly SessionEventLike[] {
  if (typeof session !== 'object' || session === null) throw new Error('The DSH Session is unavailable.')
  const source = session as {
    readonly snapshotEvents?: (fromSeq: number) => unknown
    readonly events?: unknown
  }
  const events = typeof source.snapshotEvents === 'function'
    ? source.snapshotEvents(fromSeq)
    : source.events
  if (!Array.isArray(events)) throw new Error('The DSH Session exposes neither snapshotEvents() nor a legacy events array.')
  return events
}
