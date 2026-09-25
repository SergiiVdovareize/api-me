import 'dotenv/config';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AlphadateService } from '../src/alphadate/alphadate.service';
import { PrismaService } from '../src/models/prisma/prisma.service';
import { EmailService } from '../src/email/email.service';
import { GenderizeService } from '../src/alphadate/genderize.service';
import { LlmModule } from '../src/llm/llm.module';

async function bootstrap() {
  const letter = (process.argv[2] || 'А').trim();
  const lang = process.argv[3] || 'uk';

  console.log(`\n🔍 Запит ідей для літери: "${letter}" (мова: ${lang})...\n`);

  const moduleRef = await Test.createTestingModule({
    imports: [LlmModule],
    providers: [
      AlphadateService,
      { provide: PrismaService, useValue: {} },
      { provide: EmailService, useValue: {} },
      { provide: ConfigService, useValue: new ConfigService() },
      { provide: GenderizeService, useValue: {} },
    ],
  }).compile();

  try {
    const service = moduleRef.get(AlphadateService);
    const startTime = Date.now();
    const result = await service.getSuggestions(letter, lang);
    const elapsed = Date.now() - startTime;

    console.log(`✅ Успішно отримано відповідь за ${elapsed}мс:\n`);
    console.log(JSON.stringify(result, null, 2));

    await moduleRef.close();
    process.exit(0);
  } catch (error: any) {
    console.error(`\n❌ Помилка: [${error.status || 500}] ${error.message}\n`);
    await moduleRef.close();
    process.exit(1);
  }
}

bootstrap();
