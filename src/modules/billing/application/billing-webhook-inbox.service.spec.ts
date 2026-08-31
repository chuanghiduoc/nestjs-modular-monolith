import { describe, expect, it, vi } from 'vitest';

import type { BillingWebhookVerifierPort } from '../domain/billing-provider.port';
import type { BillingWebhookInboxRepository } from '../domain/billing-webhook.repository';
import { BillingWebhookInboxService } from './billing-webhook-inbox.service';

const CLAIM_TOKEN = '01a00000-0000-7000-8000-000000000001';
const PAYLOAD = { type: 'subscription.updated' };

function harness(options: { claimed?: boolean; stillClaimed?: boolean } = {}): {
  readonly service: BillingWebhookInboxService;
  readonly repository: BillingWebhookInboxRepository;
} {
  const repository: BillingWebhookInboxRepository = {
    claim: vi.fn().mockResolvedValue(options.claimed === false ? null : CLAIM_TOKEN),
    findClaimed: vi
      .fn()
      .mockResolvedValue(options.stillClaimed === false ? null : { payload: PAYLOAD }),
    markProcessed: vi.fn().mockResolvedValue(undefined),
    markFailed: vi.fn().mockResolvedValue(undefined),
    deleteProcessedBefore: vi.fn().mockResolvedValue(0),
  };
  const verifier: BillingWebhookVerifierPort = {
    verify: vi.fn().mockResolvedValue(PAYLOAD),
  };

  return { service: new BillingWebhookInboxService(repository, verifier), repository };
}

const RECEIVED = {
  provider: 'test',
  providerEventId: 'evt_123',
  rawPayload: '{}',
  signature: 'signature',
};

const CLAIMED = {
  provider: 'test',
  providerEventId: 'evt_123',
  claimToken: CLAIM_TOKEN,
};

describe('BillingWebhookInboxService', () => {
  describe('receive', () => {
    it('verifies the signature and claims a new event without applying it', async () => {
      const { service, repository } = harness();

      await expect(service.receive(RECEIVED)).resolves.toEqual({
        result: 'accepted',
        claimToken: CLAIM_TOKEN,
      });
      // Receiving must not touch billing state: that happens in the worker,
      // under credentials the API does not hold.
      expect(repository.markProcessed).not.toHaveBeenCalled();
    });

    it('reports a redelivery as a duplicate and hands back no claim', async () => {
      const { service } = harness({ claimed: false });

      await expect(service.receive(RECEIVED)).resolves.toEqual({ result: 'duplicate' });
    });

    it('refuses to accept anything when no verifier is configured', async () => {
      const repository = {
        claim: vi.fn(),
        findClaimed: vi.fn(),
        markProcessed: vi.fn(),
        markFailed: vi.fn(),
        deleteProcessedBefore: vi.fn(),
      } as unknown as BillingWebhookInboxRepository;
      const service = new BillingWebhookInboxService(repository);

      expect(service.isConfigured).toBe(false);
      await expect(service.receive(RECEIVED)).rejects.toThrow(
        'Billing webhook verifier is not configured.',
      );
      expect(repository.claim).not.toHaveBeenCalled();
    });
  });

  describe('applyClaimed', () => {
    it('applies the recorded payload and marks the event processed', async () => {
      const { service, repository } = harness();
      const handle = vi.fn().mockResolvedValue(undefined);

      await expect(service.applyClaimed({ ...CLAIMED, handle })).resolves.toBe('processed');
      expect(handle).toHaveBeenCalledWith(PAYLOAD);
      expect(repository.markProcessed).toHaveBeenCalledWith('test', 'evt_123', CLAIM_TOKEN);
      expect(repository.markFailed).not.toHaveBeenCalled();
    });

    it('does nothing when the lease has moved on to another worker', async () => {
      const { service, repository } = harness({ stillClaimed: false });
      const handle = vi.fn().mockResolvedValue(undefined);

      await expect(service.applyClaimed({ ...CLAIMED, handle })).resolves.toBe('claim-lost');
      expect(handle).not.toHaveBeenCalled();
      expect(repository.markProcessed).not.toHaveBeenCalled();
      expect(repository.markFailed).not.toHaveBeenCalled();
    });

    it('records failures so a later delivery can retry the event', async () => {
      const { service, repository } = harness();
      const handle = vi.fn().mockRejectedValue(new Error('provider state conflict'));

      await expect(service.applyClaimed({ ...CLAIMED, handle })).rejects.toThrow(
        'provider state conflict',
      );
      expect(repository.markFailed).toHaveBeenCalledWith(
        'test',
        'evt_123',
        CLAIM_TOKEN,
        'Error: provider state conflict',
      );
    });
  });
});
