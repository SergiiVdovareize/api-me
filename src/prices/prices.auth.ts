import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

export function timingSafeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function validateCronSecret(
  configService: ConfigService,
  cronSecretHeader?: string,
  checkSecretHeader?: string,
  authHeader?: string
): void {
  const providedSecret =
    cronSecretHeader ||
    checkSecretHeader ||
    (authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : authHeader);

  const expectedSecret =
    configService.get<string>('PRICES_CHECK_SECRET') || configService.get<string>('CRON_SECRET');

  if (!providedSecret || !expectedSecret) {
    throw new UnauthorizedException('Unauthorized: Missing or invalid secret header');
  }

  if (!timingSafeCompare(providedSecret, expectedSecret)) {
    throw new UnauthorizedException('Unauthorized: Invalid secret header');
  }
}
