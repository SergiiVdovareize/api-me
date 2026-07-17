import { Test, TestingModule } from '@nestjs/testing';
import { AsyncService } from './async.service';
import { put, del, list } from '@vercel/blob';

jest.mock('@vercel/blob', () => ({
  put: jest.fn(),
  del: jest.fn(),
  list: jest.fn(),
}));

describe('AsyncService', () => {
  let service: AsyncService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AsyncService],
    }).compile();

    service = module.get<AsyncService>(AsyncService);
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('generateFilename', () => {
    it('should generate a string of expected format', () => {
      const filename = service.generateFilename();
      expect(typeof filename).toBe('string');
      expect(filename.length).toBeGreaterThan(10);
    });
  });

  describe('removeResultFile', () => {
    it('should call del with the given url', () => {
      service.removeResultFile('https://example.com/blob');
      expect(del).toHaveBeenCalledWith('https://example.com/blob');
    });
  });

  describe('createResultFile', () => {
    it('should call put and return the url', async () => {
      (put as jest.Mock).mockResolvedValue({ url: 'https://example.com/result' });
      const data = { foo: 'bar' } as any;

      const result = await service.createResultFile('test-file', data);
      expect(put).toHaveBeenCalledWith('test-file', JSON.stringify(data), {
        access: 'public',
        contentType: 'application/json',
      });
      expect(result).toBe('https://example.com/result');
    });
  });

  describe('findResultFileUrl', () => {
    it('should return url if exactly one blob is found', async () => {
      (list as jest.Mock).mockResolvedValue({
        blobs: [{ url: 'https://example.com/found' }],
      });

      const url = await service.findResultFileUrl('id-123');
      expect(list).toHaveBeenCalledWith({ prefix: 'id-123' });
      expect(url).toBe('https://example.com/found');
    });

    it('should return null if no blobs are found', async () => {
      (list as jest.Mock).mockResolvedValue({ blobs: [] });
      const url = await service.findResultFileUrl('id-123');
      expect(url).toBeNull();
    });

    it('should return null if multiple blobs are found', async () => {
      (list as jest.Mock).mockResolvedValue({
        blobs: [{ url: 'url1' }, { url: 'url2' }],
      });
      const url = await service.findResultFileUrl('id-123');
      expect(url).toBeNull();
    });
  });

  describe('findResultFileUrlWithRetry', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    it('should return url immediately if found on first try', async () => {
      jest.spyOn(service, 'findResultFileUrl').mockResolvedValue('https://found.url');

      const promise = service.findResultFileUrlWithRetry('id-123');
      const result = await promise;
      expect(result).toBe('https://found.url');
    });

    it('should retry if not found initially and return url if found eventually', async () => {
      const findSpy = jest.spyOn(service, 'findResultFileUrl');
      findSpy
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce('https://retry.url');

      const promise = service.findResultFileUrlWithRetry('id-123');

      // Fast-forward timers for retries
      await jest.advanceTimersByTimeAsync(500); // 1st retry
      await jest.advanceTimersByTimeAsync(500); // 2nd retry

      const result = await promise;
      expect(result).toBe('https://retry.url');
      expect(findSpy).toHaveBeenCalledTimes(3);
    });

    it('should return null if max retries are exceeded', async () => {
      jest.spyOn(service, 'findResultFileUrl').mockResolvedValue(null);

      const promise = service.findResultFileUrlWithRetry('id-123');

      // Fast-forward all 7 retries
      for (let i = 0; i < 7; i++) {
        await jest.advanceTimersByTimeAsync(500);
      }

      const result = await promise;
      expect(result).toBeNull();
    });
  });

  describe('readResult', () => {
    it('should fetch and parse JSON if successful', async () => {
      const mockJson = { data: 'my-result' };
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        json: () => Promise.resolve(mockJson),
      } as any);

      const result = await service.readResult('https://example.com/file');
      expect(fetchSpy).toHaveBeenCalledWith('https://example.com/file');
      expect(result).toEqual(mockJson);
    });

    it('should return null if fetch fails', async () => {
      jest.spyOn(global, 'fetch').mockRejectedValue(new Error('Network error'));
      const result = await service.readResult('https://example.com/file');
      expect(result).toBeNull();
    });
  });

  describe('prepareResult', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    it('should resolve sync result if execute completes before timeout', async () => {
      const mockData = { a: 1 } as any;
      const execute = () => Promise.resolve(mockData);
      const track = jest.fn();

      const promise = service.prepareResult(execute, track);

      // Resolve promise instantly
      await jest.advanceTimersByTimeAsync(0);

      const result = await promise;
      expect(result).toEqual({ type: 'sync', data: mockData });
      expect(track).toHaveBeenCalled();
    });

    it('should resolve async result (filename) if execute takes longer than timeout', async () => {
      let resolveExecute: any;
      const executePromise = new Promise<any>(resolve => {
        resolveExecute = resolve;
      });
      const execute = () => executePromise;
      const track = jest.fn();

      jest.spyOn(service, 'createResultFile').mockResolvedValue('https://blob.url');

      const promise = service.prepareResult(execute, track);

      // Trigger the 1000ms timeout
      await jest.advanceTimersByTimeAsync(1000);

      // Now resolve the execute promise
      const mockData = { b: 2 } as any;
      resolveExecute(mockData);
      await jest.advanceTimersByTimeAsync(0);

      const result = (await promise) as any;
      expect(result.type).toBe('async');
      expect(typeof result.data).toBe('string'); // filename
      expect(service.createResultFile).toHaveBeenCalledWith(result.data, mockData);
      expect(track).toHaveBeenCalled();
    });
  });
});
