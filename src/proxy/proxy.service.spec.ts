import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ProxyService } from './proxy.service';
import { Request, Response } from 'express';
import { EventEmitter } from 'events';
import * as https from 'https';
import * as http from 'http';

class MockUpstreamResponse extends EventEmitter {
  statusCode: number;
  headers: Record<string, string>;
  pipe = jest.fn().mockImplementation((res: Response) => {
    return res;
  });

  constructor(statusCode = 200, headers: Record<string, string> = {}) {
    super();
    this.statusCode = statusCode;
    this.headers = headers;
  }
}

class MockUpstreamRequest extends EventEmitter {
  end = jest.fn();
  destroy = jest.fn();
}

describe('ProxyService', () => {
  let service: ProxyService;

  const createMockResponse = () => {
    const res: any = {};
    res.headersSent = false;
    res.status = jest.fn().mockImplementation((code: number) => {
      res.statusCode = code;
      return res;
    });
    res.json = jest.fn().mockImplementation((body: any) => {
      res.body = body;
      res.headersSent = true;
      return res;
    });
    res.send = jest.fn().mockImplementation(() => {
      res.headersSent = true;
      return res;
    });
    res.setHeader = jest.fn().mockImplementation((key: string, val: string) => {
      res[key.toLowerCase()] = val;
      return res;
    });
    return res as Response;
  };

  const createMockRequest = (
    urlParam?: string | null,
    headers: Record<string, string | string[]> = {}
  ) => {
    const emitter = new EventEmitter() as any;
    emitter.query = urlParam !== undefined ? { url: urlParam } : {};
    emitter.headers = headers;
    return emitter as Request;
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ProxyService],
    }).compile();

    service = module.get<ProxyService>(ProxyService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('handleProxy validation', () => {
    it('should throw BadRequestException if query url is missing or empty', async () => {
      const res = createMockResponse();

      await expect(service.handleProxy(createMockRequest(undefined), res)).rejects.toThrow(
        BadRequestException
      );
      await expect(service.handleProxy(createMockRequest(''), res)).rejects.toThrow(
        BadRequestException
      );
      await expect(service.handleProxy(createMockRequest('   '), res)).rejects.toThrow(
        BadRequestException
      );
    });

    it('should throw BadRequestException if query url is malformed', async () => {
      const res = createMockResponse();
      await expect(service.handleProxy(createMockRequest('not-a-valid-url'), res)).rejects.toThrow(
        BadRequestException
      );
    });

    it('should throw BadRequestException if domain is not allowed', async () => {
      const res = createMockResponse();
      await expect(
        service.handleProxy(createMockRequest('https://google.com/search'), res)
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.handleProxy(createMockRequest('https://ashdi.vip.attacker.com/video'), res)
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('forwardStream headers & routing', () => {
    it('should forward request to ashdi.vip with correct Referer and Origin headers', async () => {
      const req = createMockRequest('https://ashdi.vip/hls/index.m3u8');
      const res = createMockResponse();

      const mockUpstreamReq = new MockUpstreamRequest();
      const mockUpstreamRes = new MockUpstreamResponse(200, {
        'content-type': 'application/vnd.apple.mpegurl',
        'content-length': '123',
      });

      const httpsSpy = jest
        .spyOn(https, 'request')
        .mockImplementation((_url: any, opts: any, callback: any) => {
          expect(opts.headers['Referer']).toBe('https://ashdi.vip/');
          expect(opts.headers['Origin']).toBe('https://ashdi.vip');
          expect(opts.headers['User-Agent']).toContain('Mozilla/5.0');
          callback(mockUpstreamRes);
          return mockUpstreamReq as any;
        });

      const handlePromise = service.handleProxy(req, res);
      mockUpstreamRes.emit('end');
      await handlePromise;

      expect(httpsSpy).toHaveBeenCalled();
      expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', '*');
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/vnd.apple.mpegurl');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(mockUpstreamRes.pipe).toHaveBeenCalledWith(res);
    });

    it('should forward request to club.uakino.fun with correct Referer and Origin headers', async () => {
      const req = createMockRequest('https://club.uakino.fun/embed/123');
      const res = createMockResponse();

      const mockUpstreamReq = new MockUpstreamRequest();
      const mockUpstreamRes = new MockUpstreamResponse(200, {});

      jest.spyOn(https, 'request').mockImplementation((_url: any, opts: any, callback: any) => {
        expect(opts.headers['Referer']).toBe('https://club.uakino.fun/');
        expect(opts.headers['Origin']).toBe('https://club.uakino.fun');
        callback(mockUpstreamRes);
        return mockUpstreamReq as any;
      });

      const handlePromise = service.handleProxy(req, res);
      mockUpstreamRes.emit('end');
      await handlePromise;
    });

    it('should forward request to uafix.net/zetvideo.net with correct Referer and Origin headers', async () => {
      const req = createMockRequest('https://sub.zetvideo.net/video.mp4');
      const res = createMockResponse();

      const mockUpstreamReq = new MockUpstreamRequest();
      const mockUpstreamRes = new MockUpstreamResponse(200, {});

      jest.spyOn(https, 'request').mockImplementation((_url: any, opts: any, callback: any) => {
        expect(opts.headers['Referer']).toBe('https://uafix.net/');
        expect(opts.headers['Origin']).toBe('https://uafix.net');
        callback(mockUpstreamRes);
        return mockUpstreamReq as any;
      });

      const handlePromise = service.handleProxy(req, res);
      mockUpstreamRes.emit('end');
      await handlePromise;
    });

    it('should forward Range header and return 206 Partial Content if received from upstream', async () => {
      const req = createMockRequest('https://ashdi.vip/video.ts', {
        range: 'bytes=0-1024',
      });
      const res = createMockResponse();

      const mockUpstreamReq = new MockUpstreamRequest();
      const mockUpstreamRes = new MockUpstreamResponse(206, {
        'content-range': 'bytes 0-1024/5000',
        'content-length': '1025',
        'accept-ranges': 'bytes',
      });

      jest.spyOn(https, 'request').mockImplementation((_url: any, opts: any, callback: any) => {
        expect(opts.headers['Range']).toBe('bytes=0-1024');
        callback(mockUpstreamRes);
        return mockUpstreamReq as any;
      });

      const handlePromise = service.handleProxy(req, res);
      mockUpstreamRes.emit('end');
      await handlePromise;

      expect(res.setHeader).toHaveBeenCalledWith('Content-Range', 'bytes 0-1024/5000');
      expect(res.setHeader).toHaveBeenCalledWith('Accept-Ranges', 'bytes');
      expect(res.status).toHaveBeenCalledWith(206);
    });

    it('should handle Range header as an array and fallback status when undefined', async () => {
      const req = createMockRequest('https://ashdi.vip/video.ts', {
        range: ['bytes=0-500'],
      });
      const res = createMockResponse();

      const mockUpstreamReq = new MockUpstreamRequest();
      const mockUpstreamRes = new MockUpstreamResponse(undefined as any, {});

      jest.spyOn(https, 'request').mockImplementation((_url: any, opts: any, callback: any) => {
        expect(opts.headers['Range']).toBe('bytes=0-500');
        callback(mockUpstreamRes);
        return mockUpstreamReq as any;
      });

      const handlePromise = service.handleProxy(req, res);
      mockUpstreamRes.emit('end');
      await handlePromise;

      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('should use http.request when URL is http protocol', async () => {
      const req = createMockRequest('http://ashdi.vip/video.ts');
      const res = createMockResponse();

      const mockUpstreamReq = new MockUpstreamRequest();
      const mockUpstreamRes = new MockUpstreamResponse(200, {});

      const httpSpy = jest
        .spyOn(http, 'request')
        .mockImplementation((_url: any, _opts: any, callback: any) => {
          callback(mockUpstreamRes);
          return mockUpstreamReq as any;
        });

      const handlePromise = service.handleProxy(req, res);
      mockUpstreamRes.emit('end');
      await handlePromise;

      expect(httpSpy).toHaveBeenCalled();
    });
  });

  describe('redirects and error scenarios', () => {
    it('should follow redirects when upstream returns 302 with location', async () => {
      const req = createMockRequest('https://ashdi.vip/old-stream.m3u8');
      const res = createMockResponse();

      const mockRedirectReq = new MockUpstreamRequest();
      const mockRedirectRes = new MockUpstreamResponse(302, {
        location: 'https://ashdi.vip/node2/stream.m3u8',
      });

      const mockFinalReq = new MockUpstreamRequest();
      const mockFinalRes = new MockUpstreamResponse(200, {
        'content-type': 'application/vnd.apple.mpegurl',
      });

      let callCount = 0;
      jest.spyOn(https, 'request').mockImplementation((targetUrl: any, _opts: any, callback: any) => {
        callCount++;
        if (callCount === 1) {
          expect(targetUrl).toBe('https://ashdi.vip/old-stream.m3u8');
          callback(mockRedirectRes);
          return mockRedirectReq as any;
        } else {
          expect(targetUrl).toBe('https://ashdi.vip/node2/stream.m3u8');
          callback(mockFinalRes);
          return mockFinalReq as any;
        }
      });

      const handlePromise = service.handleProxy(req, res);
      mockFinalRes.emit('end');
      await handlePromise;

      expect(callCount).toBe(2);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('should respond with 502 when max redirects are exceeded', async () => {
      const req = createMockRequest('https://ashdi.vip/loop');
      const res = createMockResponse();

      const mockReq = new MockUpstreamRequest();
      const mockRes = new MockUpstreamResponse(302, {
        location: 'https://ashdi.vip/loop',
      });

      jest.spyOn(https, 'request').mockImplementation((_url: any, _opts: any, callback: any) => {
        callback(mockRes);
        return mockReq as any;
      });

      await service.handleProxy(req, res);

      expect(res.status).toHaveBeenCalledWith(502);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Too many redirects' }));
    });

    it('should respond with 502 when upstream request emits error', async () => {
      const req = createMockRequest('https://ashdi.vip/fail');
      const res = createMockResponse();

      const mockReq = new MockUpstreamRequest();

      jest.spyOn(https, 'request').mockImplementation(() => {
        return mockReq as any;
      });

      const handlePromise = service.handleProxy(req, res);
      mockReq.emit('error', new Error('Connection refused'));
      await handlePromise;

      expect(res.status).toHaveBeenCalledWith(502);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Proxy request failed', details: 'Connection refused' })
      );
    });

    it('should respond with 400 when redirect location is an invalid URL', async () => {
      const req = createMockRequest('https://ashdi.vip/stream');
      const res = createMockResponse();

      const mockReq = new MockUpstreamRequest();
      const mockRes = new MockUpstreamResponse(302, {
        location: 'http://[::1',
      });

      jest.spyOn(https, 'request').mockImplementation((_url: any, _opts: any, callback: any) => {
        callback(mockRes);
        return mockReq as any;
      });

      await service.handleProxy(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid redirect URL' });
    });

    it('should respond with 403 when redirect target domain is not allowed', async () => {
      const req = createMockRequest('https://ashdi.vip/stream');
      const res = createMockResponse();

      const mockReq = new MockUpstreamRequest();
      const mockRes = new MockUpstreamResponse(302, {
        location: 'https://malicious.com/hack',
      });

      jest.spyOn(https, 'request').mockImplementation((_url: any, _opts: any, callback: any) => {
        callback(mockRes);
        return mockReq as any;
      });

      await service.handleProxy(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Redirect to domain "malicious.com" is not allowed',
      });
    });

    it('should respond with 502 when upstream response stream emits error', async () => {
      const req = createMockRequest('https://ashdi.vip/stream');
      const res = createMockResponse();

      const mockReq = new MockUpstreamRequest();
      const mockRes = new MockUpstreamResponse(200);

      jest.spyOn(https, 'request').mockImplementation((_url: any, _opts: any, callback: any) => {
        callback(mockRes);
        return mockReq as any;
      });

      const handlePromise = service.handleProxy(req, res);
      mockRes.emit('error', new Error('Premature close'));
      await handlePromise;

      expect(res.status).toHaveBeenCalledWith(502);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Stream error', details: 'Premature close' })
      );
    });

    it('should destroy upstream request when client request closes', async () => {
      const req = createMockRequest('https://ashdi.vip/stream');
      const res = createMockResponse();

      const mockReq = new MockUpstreamRequest();
      jest.spyOn(https, 'request').mockImplementation(() => {
        return mockReq as any;
      });

      service.handleProxy(req, res);

      (req as any).emit('close');
      expect(mockReq.destroy).toHaveBeenCalled();
    });
  });

  describe('proxy.constants helpers', () => {
    it('isAllowedProxyDomain should correctly identify whitelisted domains and subdomains', () => {
      const { isAllowedProxyDomain } = require('./proxy.constants');
      expect(isAllowedProxyDomain('ashdi.vip')).toBe(true);
      expect(isAllowedProxyDomain('node1.ashdi.vip')).toBe(true);
      expect(isAllowedProxyDomain('club.uakino.fun')).toBe(true);
      expect(isAllowedProxyDomain('zetvideo.net')).toBe(true);
      expect(isAllowedProxyDomain('uafix.net')).toBe(true);
      expect(isAllowedProxyDomain('attacker-ashdi.vip')).toBe(false);
      expect(isAllowedProxyDomain('google.com')).toBe(false);
    });

    it('getDomainHeaders should return default ashdi headers for unknown hostname', () => {
      const { getDomainHeaders } = require('./proxy.constants');
      const headers = getDomainHeaders('unknown-domain.com');
      expect(headers).toEqual({
        referer: 'https://ashdi.vip/',
        origin: 'https://ashdi.vip',
      });
    });
  });
});
