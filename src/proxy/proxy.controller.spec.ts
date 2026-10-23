import { Test, TestingModule } from '@nestjs/testing';
import { ProxyController } from './proxy.controller';
import { ProxyService } from './proxy.service';
import { HttpStatus } from '@nestjs/common';

describe('ProxyController', () => {
  let controller: ProxyController;
  let service: ProxyService;

  const mockService = {
    proxyUrl: jest.fn(),
  };

  const createMockResponse = () => {
    const res: any = {};
    res.status = jest.fn().mockReturnValue(res);
    res.send = jest.fn().mockReturnValue(res);
    res.setHeader = jest.fn().mockReturnValue(res);
    return res;
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProxyController],
      providers: [
        {
          provide: ProxyService,
          useValue: mockService,
        },
      ],
    }).compile();

    controller = module.get<ProxyController>(ProxyController);
    service = module.get<ProxyService>(ProxyService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('options', () => {
    it('should set CORS headers and return 204 No Content', () => {
      const res = createMockResponse();

      controller.options(res);

      expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', '*');
      expect(res.status).toHaveBeenCalledWith(HttpStatus.NO_CONTENT);
      expect(res.send).toHaveBeenCalled();
    });
  });

  describe('proxy', () => {
    it('should call proxyService.proxyUrl and return upstream response', async () => {
      const res = createMockResponse();
      mockService.proxyUrl.mockResolvedValue({
        data: '<html>content</html>',
        contentType: 'text/html; charset=utf-8',
        status: 200,
      });

      await controller.proxy('https://zetvideo.net/vod/1122', res);

      expect(service.proxyUrl).toHaveBeenCalledWith('https://zetvideo.net/vod/1122');
      expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', '*');
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/html; charset=utf-8');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.send).toHaveBeenCalledWith('<html>content</html>');
    });
  });
});
