import { Test, TestingModule } from '@nestjs/testing';
import { CloudsController } from './clouds.controller';
import { CloudsService } from './clouds.service';

describe('CloudsController', () => {
  let controller: CloudsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CloudsController],
      providers: [CloudsService],
    }).compile();

    controller = module.get<CloudsController>(CloudsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
