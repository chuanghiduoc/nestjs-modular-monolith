import type { IncomingHttpHeaders } from 'node:http';

import { describe, expect, it } from 'vitest';

import { isUuidV7 } from '#shared/util';

import { ensureRequestIds, type RequestIdCarrier } from './request-id';

function nodeRequest(headers: IncomingHttpHeaders = {}): RequestIdCarrier {
  return { headers };
}

function fastifyRequest(raw: RequestIdCarrier): RequestIdCarrier {
  return { headers: raw.headers, raw };
}

const TRUSTED = { trustInboundRequestId: true };

describe('ensureRequestIds', () => {
  it('resolves once and returns the same ids on every later call', () => {
    const request = nodeRequest();

    const first = ensureRequestIds(request);
    const second = ensureRequestIds(request);

    expect(second).toStrictEqual(first);
  });

  it('shares one id between the Fastify request and the raw request it wraps', () => {
    const raw = nodeRequest();
    const wrapper = fastifyRequest(raw);

    const fromWrapper = ensureRequestIds(wrapper);
    const fromRaw = ensureRequestIds(raw);

    expect(fromRaw.requestId).toBe(fromWrapper.requestId);
  });

  it('mints a UUID v7 when there is no inbound id', () => {
    const { requestId } = ensureRequestIds(nodeRequest());

    expect(isUuidV7(requestId)).toBe(true);
  });

  it('ignores an inbound x-request-id while the trust option is off', () => {
    const inbound = '0199e0a0-0000-7000-8000-000000000000';

    const { requestId } = ensureRequestIds(nodeRequest({ 'x-request-id': inbound }));

    expect(requestId).not.toBe(inbound);
    expect(isUuidV7(requestId)).toBe(true);
  });

  it('honours an inbound x-request-id once the trust option is on', () => {
    const inbound = '0199e0a0-0000-7000-8000-000000000000';

    const { requestId } = ensureRequestIds(nodeRequest({ 'x-request-id': inbound }), TRUSTED);

    expect(requestId).toBe(inbound);
  });

  it('mints instead of trusting an inbound id with unsafe characters', () => {
    const forged = 'abc\r\nlevel=error msg="not a real log line"';

    const { requestId } = ensureRequestIds(nodeRequest({ 'x-request-id': forged }), TRUSTED);

    expect(requestId).not.toBe(forged);
    expect(isUuidV7(requestId)).toBe(true);
  });

  it('mints instead of trusting an over-long inbound id', () => {
    const tooLong = 'a'.repeat(129);

    const { requestId } = ensureRequestIds(nodeRequest({ 'x-request-id': tooLong }), TRUSTED);

    expect(requestId).not.toBe(tooLong);
  });

  it('falls back to the request id when no correlation id was sent', () => {
    const ids = ensureRequestIds(nodeRequest());

    expect(ids.correlationId).toBe(ids.requestId);
  });

  it('honours a caller-supplied correlation id even with inbound request ids untrusted', () => {
    const ids = ensureRequestIds(nodeRequest({ 'x-correlation-id': 'checkout-42:attempt.3' }));

    expect(ids.correlationId).toBe('checkout-42:attempt.3');
  });

  it('rejects a correlation id outside the safe charset', () => {
    const ids = ensureRequestIds(nodeRequest({ 'x-correlation-id': 'drop table users;' }));

    expect(ids.correlationId).toBe(ids.requestId);
  });

  it('rejects an over-long correlation id', () => {
    const ids = ensureRequestIds(nodeRequest({ 'x-correlation-id': 'c'.repeat(129) }));

    expect(ids.correlationId).toBe(ids.requestId);
  });

  it('takes the first value when a header arrives repeated', () => {
    const ids = ensureRequestIds(nodeRequest({ 'x-correlation-id': ['first', 'second'] }));

    expect(ids.correlationId).toBe('first');
  });
});
