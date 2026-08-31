export interface JobSendOptions {
  readonly startAfterSeconds?: number;
  readonly singletonKey?: string;
  readonly singletonSeconds?: number;
}

export interface JobScheduleOptions {
  readonly repeatKey: string;
}

export interface JobQueuePort {
  send<TPayload extends object>(
    queue: string,
    payload: TPayload,
    options?: JobSendOptions,
  ): Promise<string | null>;
  schedule<TPayload extends object>(
    queue: string,
    cron: string,
    payload?: TPayload,
    options?: JobScheduleOptions,
  ): Promise<void>;
}

export interface JobQueueAdminPort {
  pause(queue: string): Promise<void>;
  resume(queue: string): Promise<void>;
  retryFailed(queue: string, limit?: number): Promise<number>;
  remove(queue: string, jobId: string): Promise<void>;
}

export const JOB_QUEUE = Symbol('JOB_QUEUE');
export const JOB_QUEUE_ADMIN = Symbol('JOB_QUEUE_ADMIN');
