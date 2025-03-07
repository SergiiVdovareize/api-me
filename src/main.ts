// import './instrument';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { env } from 'process';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: (origin, callback) => {
      if (
        env.HOST === 'local' &&
        (!origin || origin.startsWith('http://localhost:'))
      ) {
        callback(null, true);
        return;
      }

      const allowedOrigin = /https:\/\/.*\.vdovareize\.me$/;
      if (!origin || allowedOrigin.test(origin)) {
        callback(null, true); // Allow the request if origin matches
      } else {
        callback(new Error('Not allowed by CORS')); // Reject the request if origin doesn't match
      }
    },
  });
  await app.listen(3000);
}

bootstrap();
