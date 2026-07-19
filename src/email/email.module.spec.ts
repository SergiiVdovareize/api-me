import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { EmailModule } from './email.module';
import { EmailService } from './email.service';

describe('EmailModule', () => {
  it('should compile the module', async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
        }),
        EmailModule,
      ],
    }).compile();

    expect(module).toBeDefined();
    expect(module.get(EmailService)).toBeDefined();
  });
});
