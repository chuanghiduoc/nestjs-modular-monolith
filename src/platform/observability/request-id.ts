import type { IncomingHttpHeaders } from 'node:http';

import { newId } from '#shared/util';

export const REQUEST_ID_HEADER = 'x-request-id';
export const CORRELATION_ID_HEADER = 'x-correlation-id';

const SAFE_ID_PATTERN = /^[A-Za-z0-9_.:-]+$/;
const MAX_ID_LENGTH = 128;

const REQUEST_IDS = Symbol('observability.requestIds');

export interface RequestIds {
  readonly requestId: string;
  readonly correlationId: string;
}

export interface RequestIdCarrier {
  readonly headers: IncomingHttpHeaders;
  readonly raw?: RequestIdCarrier;
  [REQUEST_IDS]?: RequestIds;
}

export interface EnsureRequestIdsOptions {
  readonly trustInboundRequestId?: boolean;
}

export function ensureRequestIds(
  request: RequestIdCarrier,
  options: EnsureRequestIdsOptions = {},
): RequestIds {
  const target = request.raw ?? request;

  const stamped = target[REQUEST_IDS];
  if (stamped !== undefined) {
    return stamped;
  }

  const requestId = resolveRequestId(target.headers, options.trustInboundRequestId === true);
  const ids: RequestIds = {
    requestId,
    correlationId: resolveCorrelationId(target.headers, requestId),
  };

  target[REQUEST_IDS] = ids;

  return ids;
}

function resolveRequestId(headers: IncomingHttpHeaders, trustInbound: boolean): string {
  if (!trustInbound) {
    return newId();
  }

  const inbound = firstHeaderValue(headers[REQUEST_ID_HEADER]);

  return inbound !== undefined && isSafeId(inbound) ? inbound : newId();
}

function resolveCorrelationId(headers: IncomingHttpHeaders, fallback: string): string {
  const inbound = firstHeaderValue(headers[CORRELATION_ID_HEADER]);

  return inbound !== undefined && isSafeId(inbound) ? inbound : fallback;
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isSafeId(value: string): boolean {
  return value.length > 0 && value.length <= MAX_ID_LENGTH && SAFE_ID_PATTERN.test(value);
}
