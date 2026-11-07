import './instrument';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { json, urlencoded } from 'express';
import helmet from 'helmet';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Trust proxy for accurate client IP resolution behind Vercel edge/proxies
  app.getHttpAdapter().getInstance().set('trust proxy', true);

  // Security headers via Helmet (configured to allow cross-origin requests from web clients)
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    })
  );

  // Attach latest client version headers to all API responses (Zero-Request Version Check)
  app.use((_req, res, next) => {
    const version = process.env.LATEST_CLIENT_VERSION || '1.8.12';
    res.setHeader('X-App-Version', version);
    res.setHeader('X-CatCast-Version', version);
    next();
  });

  // Payload limits: 10mb specifically for routes requiring media uploads (e.g. /alphadate), 1mb for standard APIs
  app.use((req, res, next) => {
    const isLargePayload = (req.originalUrl || req.url || '').startsWith('/alphadate');
    const limit = isLargePayload ? '10mb' : '1mb';
    json({ limit })(req, res, next);
  });
  app.use(urlencoded({ extended: true, limit: '1mb' }));
  app.enableCors({
    origin: (origin, callback) => {
      const isAllowedLocalOrTizen =
        !origin ||
        origin === 'null' ||
        origin.startsWith('file://') ||
        origin.startsWith('http://localhost:') ||
        origin.startsWith('http://127.0.0.1:');

      const allowedOrigins = [
        /https:\/\/.*\.vdovareize\.me$/,
        /https:\/\/vdovareize\.me$/,
        /^https:\/\/([a-zA-Z0-9-]+\.)?human\.ua$/,
        /https:\/\/.*\.vercel\.app$/,
      ];

      if (isAllowedLocalOrTizen || allowedOrigins.some(pattern => pattern.test(origin))) {
        callback(null, true);
      } else {
        // Reject cross-origin request gracefully without throwing an unhandled Error to Sentry
        callback(null, false);
      }
    },
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'x-board-pin',
      'x-sync-secret',
      'x-cron-secret',
      'x-check-secret',
      'Range',
      'Accept',
      'X-Requested-With',
    ],
    exposedHeaders: ['Content-Disposition', 'Content-Length', 'X-App-Version', 'X-CatCast-Version'],
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
  });
  await app.listen(3000);
}

bootstrap();
