import { z } from 'zod';

export const CURRENT_SCHEMA_VERSION = 1;

export const integrationEventEnvelopeSchema = z.object({
  eventId: z.uuid({ version: 'v7' }),
  name: z.string().min(1),
  occurredAt: z.iso.datetime(),

  schemaVersion: z.number().int().positive(),

  correlationId: z.uuid({ version: 'v7' }).optional(),
});

export type IntegrationEventEnvelope = z.infer<typeof integrationEventEnvelopeSchema>;

export interface IntegrationEvent<
  TName extends string = string,
  TPayload = unknown,
> extends IntegrationEventEnvelope {
  readonly name: TName;
  readonly payload: TPayload;
}
