import { normalizeProductUrl } from './url-normalizer';

describe('normalizeProductUrl', () => {
  it('should lowercase hostname and strip fragment', () => {
    const input = 'https://ROZETKA.COM.UA/product-123/#reviews';
    const result = normalizeProductUrl(input);

    expect(result.domain).toBe('rozetka.com.ua');
    expect(result.normalizedUrl).toBe('https://rozetka.com.ua/product-123/');
  });

  it('should strip www prefix from domain', () => {
    const input = 'https://www.foxtrot.com.ua/p/456';
    const result = normalizeProductUrl(input);

    expect(result.domain).toBe('foxtrot.com.ua');
  });

  it('should strip UTM and tracking parameters', () => {
    const input =
      'https://allo.ua/item?utm_source=facebook&utm_medium=cpc&id=999&gclid=12345&fbclid=xyz&ref=partner';
    const result = normalizeProductUrl(input);

    expect(result.normalizedUrl).toBe('https://allo.ua/item?id=999');
  });

  it('should prepend https if scheme is missing', () => {
    const input = 'moyo.ua/goods/789';
    const result = normalizeProductUrl(input);

    expect(result.normalizedUrl).toBe('https://moyo.ua/goods/789');
    expect(result.domain).toBe('moyo.ua');
  });

  it('should throw error for unsupported protocols like ftp or file', () => {
    expect(() => normalizeProductUrl('ftp://example.com/file')).toThrow('Unsupported protocol');
  });
});
