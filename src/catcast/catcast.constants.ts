import { Response } from 'express';

export const CATCAST_CONSTANTS = {
  REDIS_KEY_PREFIX: 'catcast:auth:device:',
  LEGACY_REDIS_KEY_PREFIX: 'catcast:auth:ip:',
  DEFAULT_TTL: 60 * 60 * 24 * 30, // 30 days
  CONFIG_KEYS: {
    ACCESS_KEYS: 'CATCAST_ACCESS_KEYS',
  },
  ERROR_MESSAGES: {
    KEY_REQUIRED: 'Access key is required',
    DEVICE_ID_REQUIRED: 'Device ID is required',
    INVALID_KEY: 'Invalid access key',
    KEY_EXPIRED: 'Activation window expired. The key must be activated within 24 hours of creation.',
    DEVICE_MISMATCH: 'Key is already bound to another device. Access denied.',
    IP_MISMATCH: 'Key is already bound to another IP address. Access denied.',
  },
  ERROR_CODES: {
    KEY_REQUIRED: 'KEY_REQUIRED',
    DEVICE_ID_REQUIRED: 'DEVICE_ID_REQUIRED',
    INVALID_KEY: 'INVALID_KEY',
    KEY_EXPIRED: 'KEY_EXPIRED',
    DEVICE_MISMATCH: 'DEVICE_MISMATCH',
    IP_MISMATCH: 'IP_MISMATCH',
  },
};

export function applyCatcastCorsHeaders(res: Response): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
}
