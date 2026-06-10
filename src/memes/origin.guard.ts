import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';
import { Request } from 'express';
import { env } from 'process';

@Injectable()
export class OriginGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const origin = request.headers.origin as string;
    const referer = request.headers.referer as string;

    // Local development bypass
    if (env.HOST === 'local' && process.env.NODE_ENV !== 'test') {
      const isLocalhost = (val: string | undefined) =>
        val && (val.startsWith('http://localhost:') || val.startsWith('https://localhost:'));
      if (isLocalhost(origin) || isLocalhost(referer) || (!origin && !referer)) {
        return true;
      }
    }

    const allowedOrigin = 'https://snip.vdovareize.me/';

    const matchesAllowed = (val: string | undefined) => {
      if (!val) return false;
      const url = val.endsWith('/') ? val : `${val}/`;
      return url === allowedOrigin;
    };

    if (matchesAllowed(origin) || matchesAllowed(referer)) {
      return true;
    }

    throw new ForbiddenException('Access denied. Allowed only from https://snip.vdovareize.me/');
  }
}
