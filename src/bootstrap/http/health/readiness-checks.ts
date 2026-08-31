export type ReadinessCheck = 'postgres' | 'redis' | 'queue';

export type ReadinessChecks = readonly ReadinessCheck[];

export const READINESS_CHECKS = Symbol('READINESS_CHECKS');

export const API_READINESS: ReadinessChecks = ['postgres', 'redis'];
export const WORKER_READINESS: ReadinessChecks = ['postgres', 'queue'];
export const SCHEDULER_READINESS: ReadinessChecks = ['postgres', 'queue'];
