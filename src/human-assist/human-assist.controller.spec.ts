import { Test, TestingModule } from '@nestjs/testing';
import { HumanAssistController } from './human-assist.controller';
import { HumanAssistService } from './human-assist.service';
import { HumanAssistGuard } from './human-assist.guard';
import { ConfigService } from '@nestjs/config';

describe('HumanAssistController', () => {
  let controller: HumanAssistController;
  let service: HumanAssistService;

  const mockService = {
    getSyncData: jest.fn(),
    saveSyncData: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HumanAssistController],
      providers: [
        {
          provide: HumanAssistService,
          useValue: mockService,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        HumanAssistGuard,
      ],
    }).compile();

    controller = module.get<HumanAssistController>(HumanAssistController);
    service = module.get<HumanAssistService>(HumanAssistService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getSync', () => {
    it('should call humanAssistService.getSyncData and return result', async () => {
      const expected = {
        userId: '964486',
        data: {},
        updatedAt: null,
      };
      mockService.getSyncData.mockResolvedValue(expected);

      const result = await controller.getSync('964486');

      expect(service.getSyncData).toHaveBeenCalledWith('964486');
      expect(result).toBe(expected);
    });
  });

  describe('saveSync', () => {
    it('should call humanAssistService.saveSyncData and return result', async () => {
      const payload = { data: { settings: { show: true } } };
      const expected = { success: true, updatedAt: 1740000000000 };
      mockService.saveSyncData.mockResolvedValue(expected);

      const result = await controller.saveSync('964486', payload);

      expect(service.saveSyncData).toHaveBeenCalledWith('964486', payload);
      expect(result).toBe(expected);
    });
  });
});
