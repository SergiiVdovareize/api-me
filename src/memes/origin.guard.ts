import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

@Injectable()
export class OriginGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    // Allow preflight OPTIONS requests to be handled by CORS middleware
    if (request.method === 'OPTIONS') {
      return true;
    }

    const origin = request.headers.origin as string;
    const referer = request.headers.referer as string;

    const host = this.configService.get<string>('HOST');
    const nodeEnv = this.configService.get<string>('NODE_ENV');
    const allowedOrigin = this.configService.get<string>(
      'ALLOWED_ORIGIN',
      'https://snip.vdovareize.me/'
    );

    // Local development bypass
    if (host === 'local' && nodeEnv !== 'test') {
      const isLocalhost = (val: string | undefined) =>
        val && (val.startsWith('http://localhost:') || val.startsWith('https://localhost:'));
      if (isLocalhost(origin) || isLocalhost(referer) || (!origin && !referer)) {
        return true;
      }
    }

    const normalizeOrigin = (val: string | undefined): string | null => {
      if (!val) return null;
      try {
        return new URL(val).origin.toLowerCase();
      } catch {
        return val.replace(/\/+$/, '').toLowerCase();
      }
    };

    const targetOrigin = normalizeOrigin(allowedOrigin);
    const reqOrigin = normalizeOrigin(origin);
    const reqReferer = normalizeOrigin(referer);

    if (
      (reqOrigin && reqOrigin === targetOrigin) ||
      (reqReferer && reqReferer === targetOrigin)
    ) {
      return true;
    }

    throw new ForbiddenException(`Access denied. Allowed only from ${allowedOrigin}`);
  }
}
