export const CATCAST_SYNC_CONSTANTS = {
  HISTORY_LIMIT: 200,
  FAVORITES_LIMIT: 500,
  SEARCH_QUERIES_LIMIT: 5,
  SEARCH_QUERY_MIN_LENGTH: 3,
  SEARCH_QUERY_MAX_LENGTH: 100,
  WATCHED_EPISODES_MAX_KEYS: 2000,
  CLOCK_SKEW_MAX_FUTURE_MS: 5 * 60 * 1000, // 5 minutes
  PAIR_CODE_LENGTH: 4,
  PAIR_CODE_ALPHABET: 'ABCDEFGHIJKLMNOP',
  PAIR_TTL_SECONDS: 5 * 60, // 5 minutes
  PAIR_CONFIRMED_TTL_SECONDS: 2 * 60, // 2 minutes for final pickup
  PAIR_MAX_FAILED_ATTEMPTS: 5,
  LAST_SEEN_UPDATE_INTERVAL_MS: 5 * 60 * 1000, // 5 minutes
  TOMBSTONE_RETENTION_DAYS: 60,
  ORPHAN_PROFILE_RETENTION_DAYS: 90,
  RATE_LIMITS: {
    PROFILE_INIT: { limit: 10, windowSeconds: 60 },
    PAIR_INIT: { limit: 10, windowSeconds: 60 },
    PAIR_CONFIRM: { limit: 10, windowSeconds: 60 },
    PAIR_ACCEPT: { limit: 10, windowSeconds: 60 },
    PAIR_STATUS: { limit: 60, windowSeconds: 60 },
    PUSH: { limit: 60, windowSeconds: 60 },
  },
  REDIS_KEYS: {
    pairSession: (code: string) => `catcast:pair:${code}`,
    pairAttempts: (code: string) => `catcast:pair:attempts:${code}`,
    rateLimit: (action: string, subject: string) => `catcast:rl:${action}:${subject}`,
  },
  ERROR_CODES: {
    INVALID_SYNC_TOKEN: 'INVALID_SYNC_TOKEN',
    DEVICE_NOT_ALLOWED: 'DEVICE_NOT_ALLOWED',
    DEVICE_NOT_PAIRED: 'DEVICE_NOT_PAIRED',
    PAIR_CODE_INVALID: 'PAIR_CODE_INVALID',
    PAIR_CODE_EXPIRED: 'PAIR_CODE_EXPIRED',
    PAIR_TOO_MANY_ATTEMPTS: 'TOO_MANY_ATTEMPTS',
    RATE_LIMIT: 'RATE_LIMIT',
    CANNOT_REVOKE_CURRENT_DEVICE: 'CANNOT_REVOKE_CURRENT_DEVICE',
  },
} as const;
