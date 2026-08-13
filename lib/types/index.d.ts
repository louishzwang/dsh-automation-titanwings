/** Cordis Host plugin for durable standalone DSH automations. */
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "dsh-automation";
export declare const inject: string[];
export interface Config {
    readonly maxConcurrentRuns?: number;
    readonly runTimeoutMinutes?: number;
    readonly misfireGraceMinutes?: number;
    readonly historyLimit?: number;
}
export declare const Config: any;
/** Mount one host-wide authority and agent-scoped management tools. */
export declare function apply(ctx: Context, rawConfig: Config): Promise<void>;
export type * from './types.ts';
export { automationDomainSpec } from './domain.ts';
