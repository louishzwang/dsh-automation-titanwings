/** Compatibility boundary for old live event arrays and newer immutable Session snapshots. */
export interface SessionEventLike {
    readonly seq: number;
    readonly type: string;
    readonly data: Record<string, any>;
}
/** Never turn an unsupported Host API into an apparently empty successful result. */
export declare function readSessionEvents(session: unknown, fromSeq?: number): readonly SessionEventLike[];
