import { Test, TestingModule } from '@nestjs/testing';
import { BlobService } from './blob.service';
import { put, del, list } from '@vercel/blob';

jest.mock('@vercel/blob', () => ({
  put: jest.fn(),
  del: jest.fn(),
  list: jest.fn(),
}));

describe('BlobService', () => {
  let service: BlobService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [BlobService],
    }).compile();

    service = module.get<BlobService>(BlobService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('list', () => {
    it('should return blobs list from vercel blob list', async () => {
      const mockBlobs = [{ url: 'url1' }, { url: 'url2' }];
      (list as jest.Mock).mockResolvedValue({ blobs: mockBlobs });

      const result = await service.list('my-prefix');
      expect(list).toHaveBeenCalledWith({ prefix: 'my-prefix' });
      expect(result).toEqual(mockBlobs);
    });

    it('should return empty array if no blobs in list result', async () => {
      (list as jest.Mock).mockResolvedValue(null);
      const result = await service.list();
      expect(result).toEqual([]);
    });

    it('should throw error if list fails', async () => {
      const error = new Error('Vercel Blob list error');
      (list as jest.Mock).mockRejectedValue(error);

      await expect(service.list()).rejects.toThrow(error);
    });
  });

  describe('find', () => {
    it('should return the blob with matching pathname', async () => {
      const mockBlobs = [
        { pathname: 'other-file', url: 'url1' },
        { pathname: 'target-file', url: 'url2' },
      ];
      jest.spyOn(service, 'list').mockResolvedValue(mockBlobs);

      const result = await service.find('target-file');
      expect(service.list).toHaveBeenCalledWith('target-file');
      expect(result).toEqual({ pathname: 'target-file', url: 'url2' });
    });

    it('should return null if matching pathname not found', async () => {
      const mockBlobs = [{ pathname: 'other-file', url: 'url1' }];
      jest.spyOn(service, 'list').mockResolvedValue(mockBlobs);

      const result = await service.find('target-file');
      expect(result).toBeNull();
    });

    it('should throw error if list fails during find', async () => {
      const error = new Error('List fail');
      jest.spyOn(service, 'list').mockRejectedValue(error);

      await expect(service.find('file')).rejects.toThrow(error);
    });
  });

  describe('read', () => {
    it('should fetch and return JSON from the blob URL if found', async () => {
      const mockBlob = { pathname: 'file.json', url: 'https://blob.url/file.json' };
      jest.spyOn(service, 'find').mockResolvedValue(mockBlob);

      const mockData = { foo: 'bar' };
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockData),
      } as any);

      const result = await service.read('file.json');
      expect(service.find).toHaveBeenCalledWith('file.json');
      expect(fetchSpy).toHaveBeenCalledWith('https://blob.url/file.json');
      expect(result).toEqual(mockData);
    });

    it('should return null if blob is not found or has no URL', async () => {
      jest.spyOn(service, 'find').mockResolvedValue(null);
      const result = await service.read('file.json');
      expect(result).toBeNull();
    });

    it('should throw error if fetch is not ok', async () => {
      const mockBlob = { pathname: 'file.json', url: 'https://blob.url/file.json' };
      jest.spyOn(service, 'find').mockResolvedValue(mockBlob);

      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        statusText: 'Not Found',
      } as any);

      await expect(service.read('file.json')).rejects.toThrow('Failed to fetch blob: Not Found');
    });

    it('should throw error if find fails during read', async () => {
      const error = new Error('Find fail');
      jest.spyOn(service, 'find').mockRejectedValue(error);

      await expect(service.read('file.json')).rejects.toThrow(error);
    });
  });

  describe('create', () => {
    it('should call put and return results', async () => {
      const mockResult = { url: 'https://blob.url/created' };
      (put as jest.Mock).mockResolvedValue(mockResult);

      const data = { val: 42 };
      const result = await service.create('key1', data);
      expect(put).toHaveBeenCalledWith('key1', JSON.stringify(data), {
        access: 'public',
        contentType: 'application/json',
        addRandomSuffix: false,
        allowOverwrite: false,
      });
      expect(result).toEqual(mockResult);
    });

    it('should throw error if put fails', async () => {
      const error = new Error('Put fail');
      (put as jest.Mock).mockRejectedValue(error);

      await expect(service.create('key1', {})).rejects.toThrow(error);
    });
  });

  describe('remove', () => {
    it('should call del and return results', async () => {
      (del as jest.Mock).mockResolvedValue(true);

      const result = await service.remove('key1');
      expect(del).toHaveBeenCalledWith('key1');
      expect(result).toBe(true);
    });

    it('should throw error if del fails', async () => {
      const error = new Error('Del fail');
      (del as jest.Mock).mockRejectedValue(error);

      await expect(service.remove('key1')).rejects.toThrow(error);
    });
  });
});
