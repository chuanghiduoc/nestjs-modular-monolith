import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { ensureRequestIds } from '#platform/observability';
import { LOCAL_UPLOAD_PREFIX, type LocalStorageAdapter } from '#platform/storage';
import { ERROR_CODES } from '#shared/errors';
import { constantTimeEquals } from '#shared/util';

import { buildProblemDetails, PROBLEM_CONTENT_TYPE } from '../http/problem-details';

const UPLOAD_TOKEN_HEADER = 'x-upload-token';

export interface LocalUploadRouteOptions {
  readonly storage: LocalStorageAdapter;
  readonly bucket: string;
  readonly maxFileBytes: number;
}

/**
 * The destination a presigned URL points at when FILE_DRIVER=local.
 *
 * Registered as its own Fastify scope, the same way the auth routes are, because
 * it needs a binary body parser that the rest of the API must not have — every
 * other endpoint takes JSON, and a global `*` parser would quietly swallow a
 * wrong content type instead of answering 415.
 *
 * Only mounted for the local driver. In production the equivalent URL belongs to
 * the object store and never reaches this application.
 */
export async function registerLocalUploadRoutes(
  instance: FastifyInstance,
  options: LocalUploadRouteOptions,
): Promise<void> {
  await instance.register(
    (scope: FastifyInstance, _options: unknown, done: (error?: Error) => void) => {
      scope.addContentTypeParser(
        '*',
        { parseAs: 'buffer', bodyLimit: options.maxFileBytes },
        (_request, body: Buffer, parsed: (error: Error | null, value?: Buffer) => void) => {
          parsed(null, body);
        },
      );

      scope.put('/:bucket/*', async (request: FastifyRequest, reply: FastifyReply) => {
        const params = request.params as { bucket?: string; '*'?: string };
        const key = params['*'] ?? '';
        const token = request.headers[UPLOAD_TOKEN_HEADER];

        // The token proves this server issued the key. Without it the route is
        // an open write endpoint for anyone who can guess a path. The comparison
        // is constant-time: a plain `!==` returns on the first differing byte,
        // which is how a token gets recovered one character at a time.
        if (
          params.bucket !== options.bucket ||
          key === '' ||
          typeof token !== 'string' ||
          !constantTimeEquals(token, options.storage.tokenFor(key))
        ) {
          await refuse(request, reply);

          return;
        }

        if (!Buffer.isBuffer(request.body)) {
          await refuse(request, reply);

          return;
        }

        await options.storage.putObject(key, request.body);
        await reply.status(200).send();
      });

      done();
    },
    { prefix: LOCAL_UPLOAD_PREFIX },
  );
}

/**
 * One answer for a wrong bucket, an unknown key, a missing token and a bad body.
 * Telling them apart only helps a caller who is guessing.
 */
async function refuse(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { requestId } = ensureRequestIds(request.raw);

  await reply
    .status(403)
    .header('content-type', PROBLEM_CONTENT_TYPE)
    .send(
      buildProblemDetails({
        status: 403,
        code: ERROR_CODES.FORBIDDEN,
        detail: 'This upload URL is not valid.',
        instance: request.url.split('?')[0] ?? request.url,
        requestId,
      }),
    );
}
