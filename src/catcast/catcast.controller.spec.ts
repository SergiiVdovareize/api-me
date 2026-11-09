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
        deviceId: 'android_9774d56d682e549c',
        boundDeviceId: 'android_9774d56d682e549c',
        platform: 'android_tv',
      }),
      requestDeviceAccess: jest.fn().mockResolvedValue({
        requestId: 'req_123',
        status: 'pending',
        expiresAt: '2026-11-09T01:00:00.000Z',
      }),
      getDeviceStatus: jest.fn().mockResolvedValue({
        status: 'pending',
        expiresAt: '2026-11-09T01:00:00.000Z',
        requestId: 'req_123',
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

  it('should verify access with client IP from cf-connecting-ip header and DTO body', async () => {
    const req = {
      headers: {
        'cf-connecting-ip': '203.0.113.195',
      },
    } as unknown as Request;

    const res = {
      setHeader: jest.fn(),
    } as unknown as Response;

    const dto = {
      key: 'test-key',
      deviceId: 'android_9774d56d682e549c',
      platform: 'android_tv',
    };

    const result = await controller.verify(dto, req, res);
    expect(service.verifyAccess).toHaveBeenCalledWith(dto, '203.0.113.195');
    expect(result).toEqual({
      success: true,
      deviceId: 'android_9774d56d682e549c',
      boundDeviceId: 'android_9774d56d682e549c',
      platform: 'android_tv',
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

    const dto = {
      key: 'test-key',
      deviceId: 'web_uuid_123',
    };

    await controller.verify(dto, req, res);
    expect(service.verifyAccess).toHaveBeenCalledWith(dto, '198.51.100.4');
  });

  it('should handle OPTIONS request with CORS headers', () => {
    const res = {
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      end: jest.fn(),
    } as unknown as Response;

    controller.handleOptionsRequest(res);
    expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', '*');
    expect(res.status).toHaveBeenCalledWith(HttpStatus.OK);
    expect(res.end).toHaveBeenCalled();
  });

  it('should handle POST request with DTO and set CORS headers', async () => {
    const res = {
      setHeader: jest.fn(),
    } as unknown as Response;

    const dto = {
      deviceId: 'android_9774d56d682e549c',
      platform: 'android_tv',
      model: 'MIBOX4',
      os: '9',
    };

    const result = await controller.createRequest(dto, res);
    expect(service.requestDeviceAccess).toHaveBeenCalledWith(dto);
    expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', '*');
    expect(result).toEqual({
      requestId: 'req_123',
      status: 'pending',
      expiresAt: '2026-11-09T01:00:00.000Z',
    });
  });

  it('should handle OPTIONS status with CORS headers', () => {
    const res = {
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      end: jest.fn(),
    } as unknown as Response;

    controller.handleOptionsStatus(res);
    expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', '*');
    expect(res.status).toHaveBeenCalledWith(HttpStatus.OK);
    expect(res.end).toHaveBeenCalled();
  });

  it('should handle GET status with query and set CORS headers', async () => {
    const res = {
      setHeader: jest.fn(),
    } as unknown as Response;

    const result = await controller.getStatus('android_9774d56d682e549c', res);
    expect(service.getDeviceStatus).toHaveBeenCalledWith('android_9774d56d682e549c');
    expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', '*');
    expect(result).toEqual({
      status: 'pending',
      expiresAt: '2026-11-09T01:00:00.000Z',
      requestId: 'req_123',
    });
  });
});
