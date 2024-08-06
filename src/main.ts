import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { env } from 'process';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: env.HOST === 'local' ? 'http://localhost:3001' : 'https://reactive.vdovareize.me',
  });
  await app.listen(3000);
}

bootstrap();
