import { z } from 'zod';

import type { IntegrationEvent } from './integration-event';
import { CURRENT_SCHEMA_VERSION, integrationEventEnvelopeSchema } from './integration-event';

export const INTEGRATION_EVENTS = {
  USER_REGISTERED: 'users.registered',
  USER_EMAIL_VERIFIED: 'users.email_verified',
  USER_DELETED: 'users.deleted',

  UPLOAD_CONFIRMED: 'uploads.confirmed',
  ORGANIZATION_ARCHIVED: 'organizations.archived',
  ORGANIZATION_RESTORED: 'organizations.restored',
  ORGANIZATION_PURGED: 'organizations.purged',
} as const;

export type IntegrationEventName = (typeof INTEGRATION_EVENTS)[keyof typeof INTEGRATION_EVENTS];

export const userRegisteredPayloadSchema = z.object({
  userId: z.uuid({ version: 'v7' }),
  email: z.email(),
  emailVerified: z.boolean(),
  registeredAt: z.iso.datetime(),
});

export const userEmailVerifiedPayloadSchema = z.object({
  userId: z.uuid({ version: 'v7' }),
  email: z.email(),
  verifiedAt: z.iso.datetime(),
});

export const userDeletedPayloadSchema = z.object({
  userId: z.uuid({ version: 'v7' }),
  deletedAt: z.iso.datetime(),
});

export const uploadConfirmedPayloadSchema = z.object({
  organizationId: z.uuid({ version: 'v7' }),
  fileId: z.uuid({ version: 'v7' }),
  ownerId: z.uuid({ version: 'v7' }),
  storageKey: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  confirmedAt: z.iso.datetime(),
});

export const organizationLifecyclePayloadSchema = z.object({
  organizationId: z.uuid({ version: 'v7' }),
  actorId: z.uuid({ version: 'v7' }),
});

export const INTEGRATION_EVENT_SCHEMAS = {
  [INTEGRATION_EVENTS.USER_REGISTERED]: userRegisteredPayloadSchema,
  [INTEGRATION_EVENTS.USER_EMAIL_VERIFIED]: userEmailVerifiedPayloadSchema,
  [INTEGRATION_EVENTS.USER_DELETED]: userDeletedPayloadSchema,
  [INTEGRATION_EVENTS.UPLOAD_CONFIRMED]: uploadConfirmedPayloadSchema,
  [INTEGRATION_EVENTS.ORGANIZATION_ARCHIVED]: organizationLifecyclePayloadSchema,
  [INTEGRATION_EVENTS.ORGANIZATION_RESTORED]: organizationLifecyclePayloadSchema,
  [INTEGRATION_EVENTS.ORGANIZATION_PURGED]: organizationLifecyclePayloadSchema,
} as const satisfies Record<IntegrationEventName, z.ZodType>;

const integrationEventNames = Object.keys(INTEGRATION_EVENT_SCHEMAS) as [
  IntegrationEventName,
  ...IntegrationEventName[],
];

const namedEnvelopeSchema = integrationEventEnvelopeSchema.extend({
  name: z.enum(integrationEventNames),
});

export function parseAnyIntegrationEvent(raw: unknown): z.ZodSafeParseResult<IntegrationEvent> {
  const envelope = namedEnvelopeSchema.safeParse(raw);

  if (!envelope.success) {
    return envelope as z.ZodSafeParseResult<IntegrationEvent>;
  }

  return parseIntegrationEvent(envelope.data.name, raw);
}

export type IntegrationEventPayload<TName extends IntegrationEventName> = z.infer<
  (typeof INTEGRATION_EVENT_SCHEMAS)[TName]
>;

export type TypedIntegrationEvent<TName extends IntegrationEventName> = IntegrationEvent<
  TName,
  IntegrationEventPayload<TName>
>;

export function parseIntegrationEvent<TName extends IntegrationEventName>(
  name: TName,
  raw: unknown,
): z.ZodSafeParseResult<TypedIntegrationEvent<TName>> {
  const schema = integrationEventEnvelopeSchema.extend({
    name: z.literal(name),
    payload: INTEGRATION_EVENT_SCHEMAS[name],
  });

  return schema.safeParse(raw) as z.ZodSafeParseResult<TypedIntegrationEvent<TName>>;
}

export { CURRENT_SCHEMA_VERSION };
