import { Response } from 'express';

export const CATCAST_CONSTANTS = {
  REDIS_KEY_PREFIX: 'catcast:auth:ip:',
  DEFAULT_TTL: 60 * 60 * 24 * 30, // 30 days
  CONFIG_KEYS: {
    ACCESS_KEYS: 'CATCAST_ACCESS_KEYS',
  },
  ERROR_MESSAGES: {
    KEY_REQUIRED: 'Ключ доступу є обов’язковим',
    INVALID_KEY: 'Недійсний ключ доступу',
    IP_MISMATCH: 'Ключ прив’язано до іншої IP-адреси. Одночасний доступ з різних адрес заборонено.',
  },
};

export function applyCatcastCorsHeaders(res: Response): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
}
