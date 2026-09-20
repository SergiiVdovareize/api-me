import { GenderizeService } from './genderize.service';

describe('GenderizeService', () => {
  let service: GenderizeService;

  beforeEach(() => {
    service = new GenderizeService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('detectGenders', () => {
    it('should return empty array when names is empty', async () => {
      const result = await service.detectGenders([]);
      expect(result).toEqual([]);
    });

    it('should detect genders for single and multiple names using batch name[] parameter', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          { name: 'Андрій', gender: 'male', probability: 0.99 },
          { name: 'Олена', gender: 'female', probability: 0.99 },
        ],
      } as any);

      const result = await service.detectGenders(['Андрій', 'Олена']);
      expect(result).toEqual(['male', 'female']);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(
          'name[]=%D0%90%D0%BD%D0%B4%D1%80%D1%96%D0%B9&name[]=%D0%9E%D0%BB%D0%B5%D0%BD%D0%B0'
        ),
        expect.any(Object)
      );
    });

    it('should return null if gender is not detected by Genderize', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          { name: 'Unknown', gender: null },
          { name: 'Олена', gender: 'female' },
        ],
      } as any);

      const result = await service.detectGenders(['Unknown', 'Олена']);
      expect(result).toEqual([null, 'female']);
    });

    it('should handle API failure gracefully without throwing and return nulls', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

      const result = await service.detectGenders(['Андрій', 'Олена']);
      expect(result).toEqual([null, null]);
    });

    it('should handle non-ok status code gracefully', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 429,
      } as any);

      const result = await service.detectGenders(['Андрій', 'Олена']);
      expect(result).toEqual([null, null]);
    });
  });

  describe('assignPlayerIds', () => {
    it('should assign odd numbers for males and even numbers for females (M + W -> 1, 2)', () => {
      const result = service.assignPlayerIds(['male', 'female']);
      expect(result).toEqual([1, 2]);
    });

    it('should assign 1, 3, 2 for M M W', () => {
      const result = service.assignPlayerIds(['male', 'male', 'female']);
      expect(result).toEqual([1, 3, 2]);
    });

    it('should assign 2, 4, 1 for W W M', () => {
      const result = service.assignPlayerIds(['female', 'female', 'male']);
      expect(result).toEqual([2, 4, 1]);
    });

    it('should assign 1, 3, 5 for M M M', () => {
      const result = service.assignPlayerIds(['male', 'male', 'male']);
      expect(result).toEqual([1, 3, 5]);
    });

    it('should assign 2, 4, 6 for W W W', () => {
      const result = service.assignPlayerIds(['female', 'female', 'female']);
      expect(result).toEqual([2, 4, 6]);
    });

    it('should assign null for null or unknown genders', () => {
      const result = service.assignPlayerIds(['male', null, 'female']);
      expect(result).toEqual([1, null, 2]);
    });
  });
});
