import type { FactoryProvider, ModuleMetadata } from '@nestjs/common';
import type { Level } from 'pino';

export type LogLevel = Level;

export const METRICS_OPTIONS = Symbol('METRICS_OPTIONS');

export const METRICS_ALLOW_LIST = Symbol('METRICS_ALLOW_LIST');

export interface LoggerOptions {
  readonly level: LogLevel;
  readonly role: string;

  readonly trustInboundRequestId: boolean;

  readonly quietPaths?: readonly string[];
}

export interface MetricsOptions {
  readonly allowCidrs: readonly string[];

  readonly cacheTtlSeconds: number;

  readonly sharedStateTimeoutMs?: number;
}

export interface ObservabilityAsyncOptions<
  TOptions,
  TDeps extends readonly unknown[] = readonly unknown[],
> {
  readonly imports?: ModuleMetadata['imports'];
  readonly inject?: FactoryProvider['inject'];
  readonly useFactory: (...deps: TDeps) => TOptions | Promise<TOptions>;
}
