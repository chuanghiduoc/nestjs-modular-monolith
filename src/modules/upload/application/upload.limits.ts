export interface UploadLimits {
  readonly maxFileBytes: number;
  readonly presignExpirySeconds: number;

  readonly pendingTtlMinutes: number;
}

export const UPLOAD_LIMITS = Symbol('UPLOAD_LIMITS');

export const DEFAULT_PRESIGN_EXPIRY_SECONDS = 900;
export const DEFAULT_PENDING_TTL_MINUTES = 60;
