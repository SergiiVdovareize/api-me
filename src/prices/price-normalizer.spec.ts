import { normalizePrice } from './price-normalizer';

describe('normalizePrice', () => {
  it('should parse Ukrainian price format with non-breaking space and currency sign', () => {
    const result = normalizePrice('1\u00A0299,00 ₴');
    expect(result).toEqual({ price: 1299.0, currency: 'UAH' });
  });

  it('should parse price with standard dot decimal and UAH text', () => {
    const result = normalizePrice('1299.50 UAH');
    expect(result).toEqual({ price: 1299.5, currency: 'UAH' });
  });

  it('should parse US format with comma thousands and dollar sign', () => {
    const result = normalizePrice('$1,499.99');
    expect(result).toEqual({ price: 1499.99, currency: 'USD' });
  });

  it('should parse European format with dot thousands and comma decimal', () => {
    const result = normalizePrice('2.499,90 €');
    expect(result).toEqual({ price: 2499.9, currency: 'EUR' });
  });

  it('should parse 4-digit prices without thousands separator or with space', () => {
    expect(normalizePrice('1899.00')).toEqual({ price: 1899, currency: 'UAH' });
    expect(normalizePrice('1 899 UAH')).toEqual({ price: 1899, currency: 'UAH' });
    expect(normalizePrice('1899')).toEqual({ price: 1899, currency: 'UAH' });
  });

  it('should parse numeric input directly', () => {
    const result = normalizePrice(1999);
    expect(result).toEqual({ price: 1999, currency: 'UAH' });
  });

  it('should return null for invalid, zero, or negative numbers', () => {
    expect(normalizePrice('0')).toBeNull();
    expect(normalizePrice('-100')).toBeNull();
    expect(normalizePrice('немає ціни')).toBeNull();
    expect(normalizePrice(null)).toBeNull();
  });
});
