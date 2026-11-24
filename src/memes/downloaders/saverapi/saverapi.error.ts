export type SaverapiErrorCode =
  | 'DISABLED'
  | 'CIRCUIT_OPEN'
  | 'PROVIDER_AUTH_FAILED'
  | 'PROVIDER_QUOTA_EXHAUSTED'
  | 'PROVIDER_RATE_LIMIT'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_TEMPORARY_FAILURE'
  | 'UPSTREAM_RESPONSE_INVALID'
  | 'UNSUPPORTED_URL'
  | 'PRIVATE_CONTENT'
  | 'PAID_CONTENT'
  | 'VIDEO_UNAVAILABLE';

export class SaverapiError extends Error {
  constructor(
    public readonly code: SaverapiErrorCode,
    message: string,
    public readonly shouldFallbackToNext: boolean
  ) {
    super(message);
    this.name = 'SaverapiError';
  }
}
