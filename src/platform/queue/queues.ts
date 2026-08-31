import { INTEGRATION_EVENTS, type IntegrationEventName } from '#contracts/events';

export const QUEUES = {
  USERS_CREATE_PROFILE: 'users.create-profile',
  USERS_DELETE_PROFILE: 'users.delete-profile',
  AUDIT_RECORD_EVENT: 'audit-log.record-event',
  AUDIT_PRUNE: 'audit-log.prune',
  AUTH_PRUNE_EXPIRED: 'auth.prune-expired',
  MAIL_SEND_WELCOME: 'mailer.send-welcome',
  MAIL_SEND_AUTH_EMAIL: 'mailer.send-auth-email',
  ORGANIZATION_SEND_INVITATION: 'organizations.send-invitation',
  NOTIFICATIONS_PRUNE_LEDGER: 'notifications.prune-ledger',
  BILLING_APPLY_WEBHOOK: 'billing.apply-webhook',
  UPLOAD_PURGE_USER_FILES: 'upload.purge-user-files',
  UPLOAD_SWEEP_UNCONFIRMED: 'upload.sweep-unconfirmed',
  OUTBOX_DRAIN: 'messaging.outbox-drain',
  OUTBOX_PRUNE: 'messaging.outbox-prune',
  BILLING_WEBHOOK_PRUNE: 'billing.webhook-prune',
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];
export interface QueueDefinition {
  readonly name: QueueName;
  readonly retryLimit: number;
  readonly retryDelaySeconds: number;
  readonly retryDelayMaxSeconds: number;
  readonly retryBackoff: boolean;
  readonly failedJobRetentionSeconds: number;
  readonly completedJobRetentionSeconds: number;
}
const ONE_HOUR = 3600;
const FIFTEEN_MINUTES = 900;
const ONE_DAY = 86400;
const THREE_DAYS = ONE_DAY * 3;
const THIRTY_DAYS = ONE_DAY * 30;
const defaults = {
  retryLimit: 5,
  retryDelaySeconds: 5,
  retryDelayMaxSeconds: ONE_HOUR,
  retryBackoff: true,
  failedJobRetentionSeconds: THIRTY_DAYS,
  completedJobRetentionSeconds: THREE_DAYS,
} as const satisfies Omit<QueueDefinition, 'name'>;

export const QUEUE_DEFINITIONS: readonly QueueDefinition[] = [
  { ...defaults, name: QUEUES.USERS_CREATE_PROFILE },
  { ...defaults, name: QUEUES.USERS_DELETE_PROFILE },
  { ...defaults, name: QUEUES.AUDIT_RECORD_EVENT },
  {
    // This queue's payload embeds a credential in its link, so it is the one
    // queue whose data must not linger in Redis. Completed jobs are dropped the
    // moment they succeed, and a failed job outlives the token it carries by
    // minutes, not weeks. Retrying past the token's own lifetime would only
    // deliver a dead link, so the backoff ceiling is short by design.
    ...defaults,
    name: QUEUES.MAIL_SEND_AUTH_EMAIL,
    retryLimit: 5,
    retryDelayMaxSeconds: FIFTEEN_MINUTES,
    completedJobRetentionSeconds: 0,
    failedJobRetentionSeconds: FIFTEEN_MINUTES,
  },
  {
    // Same reasoning as the auth mail queue: the payload carries a bearer token,
    // so a completed job is dropped at once and a failed one is kept only long
    // enough to be noticed.
    ...defaults,
    name: QUEUES.ORGANIZATION_SEND_INVITATION,
    retryLimit: 8,
    completedJobRetentionSeconds: 0,
    failedJobRetentionSeconds: ONE_HOUR,
  },
  {
    ...defaults,
    name: QUEUES.MAIL_SEND_WELCOME,
    retryLimit: 8,
    retryDelayMaxSeconds: ONE_HOUR * 6,
  },
  { ...defaults, name: QUEUES.UPLOAD_PURGE_USER_FILES },
  {
    ...defaults,
    name: QUEUES.UPLOAD_SWEEP_UNCONFIRMED,
    retryLimit: 1,
    failedJobRetentionSeconds: ONE_HOUR,
  },
  {
    ...defaults,
    name: QUEUES.OUTBOX_DRAIN,
    retryLimit: 3,
    retryDelaySeconds: 2,
    retryDelayMaxSeconds: 60,
    failedJobRetentionSeconds: ONE_HOUR,
  },
  {
    ...defaults,
    name: QUEUES.OUTBOX_PRUNE,
    retryLimit: 1,
    failedJobRetentionSeconds: ONE_HOUR,
  },
  { ...defaults, name: QUEUES.BILLING_APPLY_WEBHOOK },
  {
    ...defaults,
    name: QUEUES.BILLING_WEBHOOK_PRUNE,
    retryLimit: 1,
    failedJobRetentionSeconds: ONE_HOUR,
  },
  {
    ...defaults,
    name: QUEUES.NOTIFICATIONS_PRUNE_LEDGER,
    retryLimit: 1,
    failedJobRetentionSeconds: ONE_HOUR,
  },
  {
    ...defaults,
    name: QUEUES.AUDIT_PRUNE,
    retryLimit: 1,
    failedJobRetentionSeconds: ONE_HOUR,
  },
  {
    ...defaults,
    name: QUEUES.AUTH_PRUNE_EXPIRED,
    retryLimit: 1,
    failedJobRetentionSeconds: ONE_HOUR,
  },
];

export interface CronSchedule {
  readonly queue: QueueName;
  readonly cron: string;
}

export const CRON_SCHEDULES: readonly CronSchedule[] = [
  { queue: QUEUES.UPLOAD_SWEEP_UNCONFIRMED, cron: '*/15 * * * *' },
  { queue: QUEUES.AUDIT_PRUNE, cron: '41 3 * * *' },
  { queue: QUEUES.AUTH_PRUNE_EXPIRED, cron: '23 4 * * *' },
  { queue: QUEUES.BILLING_WEBHOOK_PRUNE, cron: '7 5 * * *' },
  { queue: QUEUES.NOTIFICATIONS_PRUNE_LEDGER, cron: '53 4 * * *' },
];
export const EVENT_SUBSCRIBERS = {
  [INTEGRATION_EVENTS.USER_REGISTERED]: [QUEUES.USERS_CREATE_PROFILE, QUEUES.AUDIT_RECORD_EVENT],
  // Welcome mail belongs to verification, not registration. Registering only
  // proves someone typed an address; sending "your account is ready" at that
  // point both contradicts requireEmailVerification and lets anyone make this
  // system mail a stranger twice by signing up with their address.
  [INTEGRATION_EVENTS.USER_EMAIL_VERIFIED]: [QUEUES.AUDIT_RECORD_EVENT, QUEUES.MAIL_SEND_WELCOME],
  [INTEGRATION_EVENTS.USER_DELETED]: [
    QUEUES.USERS_DELETE_PROFILE,
    QUEUES.AUDIT_RECORD_EVENT,
    QUEUES.UPLOAD_PURGE_USER_FILES,
  ],
  [INTEGRATION_EVENTS.UPLOAD_CONFIRMED]: [QUEUES.AUDIT_RECORD_EVENT],
  [INTEGRATION_EVENTS.ORGANIZATION_ARCHIVED]: [QUEUES.AUDIT_RECORD_EVENT],
  [INTEGRATION_EVENTS.ORGANIZATION_RESTORED]: [QUEUES.AUDIT_RECORD_EVENT],
  [INTEGRATION_EVENTS.ORGANIZATION_PURGED]: [QUEUES.AUDIT_RECORD_EVENT],
} as const satisfies Record<IntegrationEventName, readonly QueueName[]>;
export const DEDUP_WINDOW_SECONDS = 600;
