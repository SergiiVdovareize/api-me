import './instrument';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { env } from 'process';
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

  // Payload limits: 10mb specifically for routes requiring media uploads (e.g. /alphadate), 1mb for standard APIs
  app.use((req, res, next) => {
    const isLargePayload = (req.originalUrl || req.url || '').startsWith('/alphadate');
    const limit = isLargePayload ? '10mb' : '1mb';
    json({ limit })(req, res, next);
  });
  app.use(urlencoded({ extended: true, limit: '1mb' }));
  app.enableCors({
    origin: (origin, callback) => {
      if (env.HOST === 'local' && (!origin || origin.startsWith('http://localhost:'))) {
        callback(null, true);
        return;
      }

      const allowedOrigins = [/https:\/\/.*\.vdovareize\.me$/, /https:\/\/vdovareize\.me$/];

      if (!origin || allowedOrigins.some(pattern => pattern.test(origin))) {
        callback(null, true); // Allow the request if origin matches
      } else {
        callback(new Error('Not allowed by CORS')); // Reject the request if origin doesn't match
      }
    },
  });
  await app.listen(3000);
}

bootstrap();
