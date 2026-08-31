import { ERROR_CODES, type ErrorCode } from './error-codes';

export interface ErrorCatalogEntry {
  readonly summary: string;
  readonly clientAction: string;
}

export const ERROR_CATALOG = {
  [ERROR_CODES.MALFORMED_REQUEST]: {
    summary: 'The request could not be parsed.',
    clientAction: 'Fix the request shape. Retrying it unchanged will fail again.',
  },
  [ERROR_CODES.VALIDATION_FAILED]: {
    summary: 'One or more fields broke a rule the client can fix.',
    clientAction: 'Read errors[] and correct the named fields.',
  },
  [ERROR_CODES.NOT_FOUND]: {
    summary: 'The resource is absent, or the caller may not learn it exists.',
    clientAction: 'Do not retry with the same identifier.',
  },
  [ERROR_CODES.CONFLICT]: {
    summary: 'The request collided with the current state.',
    clientAction: 'Re-read the resource and decide again; a later attempt may win.',
  },
  [ERROR_CODES.FORBIDDEN]: {
    summary: 'Authenticated, but not permitted.',
    clientAction: 'Do not retry. Request access.',
  },
  [ERROR_CODES.UNAUTHENTICATED]: {
    summary: 'No valid session.',
    clientAction: 'Sign in, then retry.',
  },
  [ERROR_CODES.RATE_LIMITED]: {
    summary: 'The caller exceeded its request budget.',
    clientAction: 'Back off for the number of seconds in Retry-After.',
  },
  [ERROR_CODES.REQUEST_TIMEOUT]: {
    summary: 'The request took longer than the server is willing to wait.',
    clientAction: 'Retry with backoff. The work may still have completed.',
  },
  [ERROR_CODES.PAYLOAD_TOO_LARGE]: {
    summary: 'The body or file exceeded the configured limit.',
    clientAction: 'Send less. The limit is in the API documentation.',
  },
  [ERROR_CODES.UNSUPPORTED_MEDIA_TYPE]: {
    summary: 'No parser is registered for that Content-Type.',
    clientAction: 'Send application/json, or multipart on upload routes.',
  },
  [ERROR_CODES.INTERNAL_ERROR]: {
    summary: 'The server failed for a reason it will not disclose.',
    clientAction: 'Retry with backoff, and quote requestId in a bug report.',
  },
  [ERROR_CODES.SERVICE_UNAVAILABLE]: {
    summary: 'A dependency is degraded and the request cannot be served now.',
    clientAction: 'Back off for the number of seconds in Retry-After.',
  },
  [ERROR_CODES.CURSOR_MALFORMED]: {
    summary: 'The pagination cursor did not decode.',
    clientAction: 'Restart the listing without a cursor.',
  },
  [ERROR_CODES.USER_NOT_FOUND]: {
    summary: 'No identity exists for that id.',
    clientAction: 'Do not retry with the same id.',
  },
  [ERROR_CODES.USER_PROFILE_NOT_FOUND]: {
    summary: 'The identity exists but has no profile yet.',
    clientAction: 'Retry shortly: the profile is created asynchronously after sign-up.',
  },
  [ERROR_CODES.DISPLAY_NAME_INVALID]: {
    summary: 'The display name broke a length or character rule.',
    clientAction: 'Send a name of 2 to 80 printable characters.',
  },
  [ERROR_CODES.USER_ROLE_INVALID]: {
    summary: 'The role is not one this system recognises.',
    clientAction: 'Do not retry. Roles are assigned server-side.',
  },
  [ERROR_CODES.ORGANIZATION_INVALID]: {
    summary: 'The organization name or slug is invalid.',
    clientAction: 'Use a unique lowercase slug and a name between 2 and 160 characters.',
  },
  [ERROR_CODES.ORGANIZATION_NOT_FOUND]: {
    summary: 'The organization does not exist or is not visible to the caller.',
    clientAction: 'Choose an organization returned by the membership endpoint.',
  },
  [ERROR_CODES.ORGANIZATION_ACCESS_DENIED]: {
    summary: 'The caller does not have the required organization permission.',
    clientAction: 'Request a suitable organization role.',
  },
  [ERROR_CODES.INVITATION_INVALID]: {
    summary: 'The invitation could not be issued as asked.',
    clientAction: 'Check the address and the role, then send it again.',
  },
  [ERROR_CODES.INVITATION_NOT_FOUND]: {
    summary: 'The invitation is unknown, already used, or past its expiry.',
    clientAction: 'Ask the organization for a fresh invitation.',
  },
  [ERROR_CODES.MEMBER_NOT_FOUND]: {
    summary: 'That person is not a member of this organization.',
    clientAction: 'Re-read the member list before repeating the change.',
  },
  [ERROR_CODES.LAST_OWNER]: {
    summary: 'The change would leave the organization with no owner.',
    clientAction: 'Promote another member to owner first, then repeat this.',
  },
  [ERROR_CODES.UPLOAD_NOT_FOUND]: {
    summary: 'No upload with that id belongs to the caller.',
    clientAction: 'Presign again.',
  },
  [ERROR_CODES.UPLOAD_ALREADY_CONFIRMED]: {
    summary: 'The upload was confirmed by an earlier request.',
    clientAction: 'Treat it as success and use the file.',
  },
  [ERROR_CODES.UPLOAD_SIZE_EXCEEDED]: {
    summary: 'The declared size is outside the accepted range.',
    clientAction: 'Send a smaller file.',
  },
  [ERROR_CODES.UPLOAD_MIME_NOT_ALLOWED]: {
    summary: 'The type is not on the allow-list, declared or detected.',
    clientAction: 'Upload an accepted file type.',
  },
  [ERROR_CODES.UPLOAD_OBJECT_MISSING]: {
    summary: 'Confirm ran but no object was stored under the issued key.',
    clientAction: 'Upload the bytes with the policy, then confirm.',
  },
  [ERROR_CODES.UPLOAD_CONTENT_MISMATCH]: {
    summary: 'The stored bytes do not match what was declared.',
    clientAction: 'Presign again with the real size and type.',
  },
  [ERROR_CODES.UPLOAD_FILENAME_INVALID]: {
    summary: 'The filename is empty after sanitisation.',
    clientAction: 'Send a filename with at least one usable character.',
  },
  [ERROR_CODES.AUDIT_ENTRY_INVALID]: {
    summary: 'An audit entry did not match the published contract.',
    clientAction: 'None: this is a server-side contract failure.',
  },
} as const satisfies Record<ErrorCode, ErrorCatalogEntry>;

export function describeErrorCode(code: ErrorCode): ErrorCatalogEntry {
  return ERROR_CATALOG[code];
}
