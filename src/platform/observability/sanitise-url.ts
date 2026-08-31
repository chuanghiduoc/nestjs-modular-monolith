const SENSITIVE_QUERY_KEYS = new Set([
  'token',
  'code',
  'secret',
  'password',
  'access_token',
  'refresh_token',
  'id_token',
  'signature',
  'x-amz-signature',
  'x-amz-credential',
  'callbackurl',
]);

const CREDENTIAL_PATH_PREFIXES = ['/reset-password/', '/verify-email/', '/delete-user/callback/'];

export const REDACTED = '[REDACTED]';

export function sanitiseUrl(url: string): string {
  const [rawPath = '', rawQuery] = splitOnce(url, '?');
  const path = redactCredentialSegment(rawPath);

  if (rawQuery === undefined) {
    return path;
  }

  const query = rawQuery.split('&').map(redactPair).join('&');

  return `${path}?${query}`;
}

function redactPair(pair: string): string {
  const [key = '', value] = splitOnce(pair, '=');

  if (value === undefined) {
    return pair;
  }

  return SENSITIVE_QUERY_KEYS.has(key.toLowerCase()) ? `${key}=${REDACTED}` : pair;
}

function redactCredentialSegment(path: string): string {
  for (const prefix of CREDENTIAL_PATH_PREFIXES) {
    const at = path.indexOf(prefix);

    if (at !== -1) {
      return `${path.slice(0, at + prefix.length)}${REDACTED}`;
    }
  }

  return path;
}

function splitOnce(value: string, separator: string): [string, string | undefined] {
  const at = value.indexOf(separator);

  return at === -1 ? [value, undefined] : [value.slice(0, at), value.slice(at + separator.length)];
}
