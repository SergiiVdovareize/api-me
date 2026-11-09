import { Response } from 'express';

export const CATCAST_CONSTANTS = {
  ERROR_MESSAGES: {
    DEVICE_ID_REQUIRED: 'Device ID is required',
    DEVICE_NOT_ALLOWED: 'Device access is not allowed',
  },
  ERROR_CODES: {
    DEVICE_ID_REQUIRED: 'DEVICE_ID_REQUIRED',
    DEVICE_NOT_ALLOWED: 'DEVICE_NOT_ALLOWED',
    RATE_LIMIT: 'RATE_LIMIT',
  },
  DEVICE_STATUS: {
    UNKNOWN: 'unknown',
    PENDING: 'pending',
    APPROVED: 'approved',
    DENIED: 'denied',
    EXPIRED: 'expired',
  } as const,
  DEVICE_REQUEST: {
    TTL_MINUTES: 30,
    RATE_LIMIT_HOURLY: 5,
  },
};

export function applyCatcastCorsHeaders(res: Response): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
}
