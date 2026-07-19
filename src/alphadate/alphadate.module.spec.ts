import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { AlphadateModule } from './alphadate.module';
import { AlphadateService } from './alphadate.service';
import { AlphadateController } from './alphadate.controller';

describe('AlphadateModule', () => {
  it('should compile the module', async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
        }),
        AlphadateModule,
      ],
    }).compile();

    expect(module).toBeDefined();
    expect(module.get(AlphadateService)).toBeDefined();
    expect(module.get(AlphadateController)).toBeDefined();
  });
});
