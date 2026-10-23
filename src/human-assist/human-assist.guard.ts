import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

@Injectable()
export class HumanAssistGuard implements CanActivate {
  private readonly humanOriginRegex = /^https:\/\/([a-zA-Z0-9-]+\.)?human\.ua$/;

  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    if (request.method === 'OPTIONS') {
      return true;
    }

    const origin = (request.headers.origin || request.headers.referer) as string | undefined;

    const host = this.configService.get<string>('HOST');
    const nodeEnv = this.configService.get<string>('NODE_ENV');
    const isLocalDev = host === 'local' && nodeEnv !== 'production';

    // 1. Origin verification
    const isAllowedOrigin =
      (origin && this.humanOriginRegex.test(origin.replace(/\/$/, ''))) ||
      (isLocalDev && (!origin || origin.startsWith('http://localhost:')));

    if (!isAllowedOrigin) {
      throw new ForbiddenException({ error: 'Forbidden: Origin not allowed' });
    }

    // 2. Secret verification
    const clientSecret = request.headers['x-sync-secret'];
    const expectedSecret =
      this.configService.get<string>('HUMAN_ASSIST_SYNC_SECRET') ||
      this.configService.get<string>('SYNC_SECRET');

    if (!expectedSecret || !clientSecret || clientSecret !== expectedSecret) {
      throw new UnauthorizedException({ error: 'Unauthorized: Invalid secret' });
    }

    return true;
  }
}
