import { Test, TestingModule } from '@nestjs/testing';
import { HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import { CatcastController } from './catcast.controller';
import { CatcastService } from './catcast.service';

describe('CatcastController', () => {
  let controller: CatcastController;
  let service: jest.Mocked<Partial<CatcastService>>;

  beforeEach(async () => {
    service = {
      verifyAccess: jest.fn().mockResolvedValue({
        success: true,
        boundIp: '1.2.3.4',
        isNewBinding: false,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CatcastController],
      providers: [{ provide: CatcastService, useValue: service }],
    }).compile();

    controller = module.get<CatcastController>(CatcastController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should handle OPTIONS verify with CORS headers', () => {
    const res = {
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      end: jest.fn(),
    } as unknown as Response;

    controller.handleOptionsVerify(res);
    expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', '*');
    expect(res.status).toHaveBeenCalledWith(HttpStatus.OK);
    expect(res.end).toHaveBeenCalled();
  });

  it('should verify access with client IP from cf-connecting-ip header', async () => {
    const req = {
      headers: {
        'cf-connecting-ip': '203.0.113.195',
      },
    } as unknown as Request;

    const res = {
      setHeader: jest.fn(),
    } as unknown as Response;

    const result = await controller.verify({ key: 'test-key' }, req, res);
    expect(service.verifyAccess).toHaveBeenCalledWith('test-key', '203.0.113.195');
    expect(result).toEqual({
      success: true,
      boundIp: '1.2.3.4',
      isNewBinding: false,
    });
    expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', '*');
  });

  it('should fallback to x-forwarded-for or socket.remoteAddress', async () => {
    const req = {
      headers: {
        'x-forwarded-for': '198.51.100.4',
      },
    } as unknown as Request;

    const res = {
      setHeader: jest.fn(),
    } as unknown as Response;

    await controller.verify({ key: 'test-key' }, req, res);
    expect(service.verifyAccess).toHaveBeenCalledWith('test-key', '198.51.100.4');
  });
});
