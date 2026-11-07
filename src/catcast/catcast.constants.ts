import { Response } from 'express';

export const CATCAST_CONSTANTS = {
  REDIS_KEY_PREFIX: 'catcast:auth:device:',
  LEGACY_REDIS_KEY_PREFIX: 'catcast:auth:ip:',
  DEFAULT_TTL: 60 * 60 * 24 * 30, // 30 days
  DEFAULT_LATEST_VERSION: '1.8.12',
  CONFIG_KEYS: {
    ACCESS_KEYS: 'CATCAST_ACCESS_KEYS',
    LATEST_CLIENT_VERSION: 'LATEST_CLIENT_VERSION',
  },
  HEADERS: {
    APP_VERSION: 'X-App-Version',
    CATCAST_VERSION: 'X-CatCast-Version',
  },
  EXPOSED_HEADERS: 'X-App-Version, X-CatCast-Version',
  ERROR_MESSAGES: {
    KEY_REQUIRED: 'Access key is required',
    DEVICE_ID_REQUIRED: 'Device ID is required',
    INVALID_KEY: 'Invalid access key',
    DEVICE_MISMATCH: 'Key is already bound to another device. Access denied.',
    IP_MISMATCH: 'Key is already bound to another IP address. Access denied.',
  },
  ERROR_CODES: {
    KEY_REQUIRED: 'KEY_REQUIRED',
    DEVICE_ID_REQUIRED: 'DEVICE_ID_REQUIRED',
    INVALID_KEY: 'INVALID_KEY',
    DEVICE_MISMATCH: 'DEVICE_MISMATCH',
    IP_MISMATCH: 'IP_MISMATCH',
  },
};

export function applyCatcastCorsHeaders(res: Response, version?: string): void {
  const latestVersion =
    version || process.env.LATEST_CLIENT_VERSION || CATCAST_CONSTANTS.DEFAULT_LATEST_VERSION;
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.setHeader('Access-Control-Expose-Headers', CATCAST_CONSTANTS.EXPOSED_HEADERS);
  res.setHeader(CATCAST_CONSTANTS.HEADERS.APP_VERSION, latestVersion);
  res.setHeader(CATCAST_CONSTANTS.HEADERS.CATCAST_VERSION, latestVersion);
}
