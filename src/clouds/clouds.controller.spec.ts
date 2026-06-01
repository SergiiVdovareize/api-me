import { Test, TestingModule } from '@nestjs/testing';
import { CloudsController } from './clouds.controller';
import { CloudsService } from './clouds.service';

import { RequestsService } from 'src/requests/requests.service';
import { AsyncService } from 'src/async/async.service';

describe('CloudsController', () => {
  let controller: CloudsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CloudsController],
      providers: [
        {
          provide: CloudsService,
          useValue: {},
        },
        {
          provide: RequestsService,
          useValue: {},
        },
        {
          provide: AsyncService,
          useValue: {},
        },
      ],
    }).compile();

    controller = module.get<CloudsController>(CloudsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
