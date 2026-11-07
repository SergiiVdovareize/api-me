import { Test, TestingModule } from '@nestjs/testing';
import { ProxyController } from './proxy.controller';
import { ProxyService } from './proxy.service';
import { Request, Response } from 'express';

describe('ProxyController', () => {
  let controller: ProxyController;
  let service: ProxyService;

  const mockService = {
    handleProxy: jest.fn(),
  };

  const createMockResponse = () => {
    const res: any = {};
    res.status = jest.fn().mockReturnValue(res);
    res.send = jest.fn().mockReturnValue(res);
    res.end = jest.fn().mockReturnValue(res);
    res.setHeader = jest.fn().mockReturnValue(res);
    return res as Response;
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
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('handleOptions', () => {
    it('should set CORS headers and return 200 OK', () => {
      const res = createMockResponse();

      controller.handleOptions(res);

      expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', '*');
      expect(res.setHeader).toHaveBeenCalledWith(
        'Access-Control-Allow-Methods',
        'GET, POST, HEAD, OPTIONS'
      );
      expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Headers', '*');
      expect(res.setHeader).toHaveBeenCalledWith(
        'Access-Control-Expose-Headers',
        'Content-Length, Content-Range, Accept-Ranges'
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.end).toHaveBeenCalled();
    });
  });

  describe('getProxy', () => {
    it('should call proxyService.handleProxy with req and res on POST', async () => {
      const req = { method: 'POST', query: { url: 'https://club.uakino.fun/search/' } } as unknown as Request;
      const res = {} as unknown as Response;

      await controller.postProxy(req, res);

      expect(service.handleProxy).toHaveBeenCalledWith(req, res);
    });

    it('should call proxyService.handleProxy with req and res', async () => {
      const req = { query: { url: 'https://ashdi.vip/playlist.m3u8' } } as unknown as Request;
      const res = createMockResponse();
      mockService.handleProxy.mockResolvedValue(undefined);

      await controller.getProxy(req, res);

      expect(service.handleProxy).toHaveBeenCalledWith(req, res);
    });
  });
});
