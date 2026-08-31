export const ERROR_CODES = {
  MALFORMED_REQUEST: 'malformed_request',
  VALIDATION_FAILED: 'validation_failed',
  NOT_FOUND: 'not_found',
  CONFLICT: 'conflict',
  FORBIDDEN: 'forbidden',
  UNAUTHENTICATED: 'unauthenticated',
  RATE_LIMITED: 'rate_limited',
  REQUEST_TIMEOUT: 'request_timeout',
  PAYLOAD_TOO_LARGE: 'payload_too_large',
  UNSUPPORTED_MEDIA_TYPE: 'unsupported_media_type',
  INTERNAL_ERROR: 'internal_error',
  SERVICE_UNAVAILABLE: 'service_unavailable',

  CURSOR_MALFORMED: 'cursor_malformed',

  USER_NOT_FOUND: 'user_not_found',
  USER_PROFILE_NOT_FOUND: 'user_profile_not_found',
  DISPLAY_NAME_INVALID: 'display_name_invalid',
  USER_ROLE_INVALID: 'user_role_invalid',

  ORGANIZATION_INVALID: 'organization_invalid',
  ORGANIZATION_NOT_FOUND: 'organization_not_found',
  ORGANIZATION_ACCESS_DENIED: 'organization_access_denied',

  INVITATION_INVALID: 'invitation_invalid',
  INVITATION_NOT_FOUND: 'invitation_not_found',
  MEMBER_NOT_FOUND: 'member_not_found',
  LAST_OWNER: 'last_owner',

  UPLOAD_NOT_FOUND: 'upload_not_found',
  UPLOAD_ALREADY_CONFIRMED: 'upload_already_confirmed',
  UPLOAD_SIZE_EXCEEDED: 'upload_size_exceeded',
  UPLOAD_MIME_NOT_ALLOWED: 'upload_mime_not_allowed',
  UPLOAD_OBJECT_MISSING: 'upload_object_missing',
  UPLOAD_CONTENT_MISMATCH: 'upload_content_mismatch',
  UPLOAD_FILENAME_INVALID: 'upload_filename_invalid',

  AUDIT_ENTRY_INVALID: 'audit_entry_invalid',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
