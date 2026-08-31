/**
 * The collection's own path, taken from the request that asked for it.
 *
 * Hard-coding `/api/v1/...` into a response makes the payload lie the moment
 * API_PREFIX or the version changes, and both are configuration.
 */
export function collectionUrl(request: { readonly url: string }): string {
  const [path = ''] = request.url.split('?');

  return path;
}
