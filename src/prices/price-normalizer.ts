export interface NormalizedPriceResult {
  price: number;
  currency: string;
}

const CURRENCY_MAP: Record<string, string> = {
  '₴': 'UAH',
  грн: 'UAH',
  uah: 'UAH',
  $: 'USD',
  usd: 'USD',
  '€': 'EUR',
  eur: 'EUR',
  zł: 'PLN',
  pln: 'PLN',
  '£': 'GBP',
  gbp: 'GBP',
};

/**
 * Normalizes price string or raw number to clean numeric price and ISO currency.
 * Handles Ukrainian, European, and US number formatting conventions.
 */
export function normalizePrice(
  rawPrice: string | number | null | undefined,
  fallbackCurrency = 'UAH'
): NormalizedPriceResult | null {
  if (rawPrice === null || rawPrice === undefined) {
    return null;
  }

  if (typeof rawPrice === 'number') {
    if (isNaN(rawPrice) || rawPrice <= 0) return null;
    return {
      price: Math.round(rawPrice * 100) / 100,
      currency: fallbackCurrency.toUpperCase(),
    };
  }

  const str = rawPrice.toString().trim();
  if (!str || str.startsWith('-')) return null;

  // 1. Detect Currency
  let detectedCurrency: string = fallbackCurrency;
  const lowerStr = str.toLowerCase();

  for (const [key, code] of Object.entries(CURRENCY_MAP)) {
    if (lowerStr.includes(key)) {
      detectedCurrency = code;
      break;
    }
  }

  // 2. Extract numeric component
  const cleaned = str
    .replace(/[\u00A0\u200E\u200F\u202F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Match full number with optional thousand separators and decimal point
  const numericMatch = cleaned.match(/\d+(?:[.,\s]\d+)*/);
  if (!numericMatch) {
    return null;
  }

  let numPart = numericMatch[0].replace(/\s+/g, '');

  const hasComma = numPart.includes(',');
  const hasDot = numPart.includes('.');

  if (hasComma && hasDot) {
    if (numPart.lastIndexOf(',') > numPart.lastIndexOf('.')) {
      // 1.299,00 -> dot is thousands, comma is decimal
      numPart = numPart.replace(/\./g, '').replace(',', '.');
    } else {
      // 1,299.00 -> comma is thousands, dot is decimal
      numPart = numPart.replace(/,/g, '');
    }
  } else if (hasComma) {
    const parts = numPart.split(',');
    // If comma has 1 or 2 digits after it at the end (e.g. 1899,99 or 1899,5) -> decimal
    if (parts.length === 2 && (parts[1].length === 1 || parts[1].length === 2)) {
      numPart = `${parts[0]}.${parts[1]}`;
    } else {
      // Otherwise comma is thousand separator (e.g. 1,899)
      numPart = numPart.replace(/,/g, '');
    }
  } else if (hasDot) {
    const parts = numPart.split('.');
    // If dot is used as thousand separator (e.g. 1.899)
    if (parts.length === 2 && parts[1].length === 3) {
      numPart = `${parts[0]}${parts[1]}`;
    }
  }

  const parsedNumber = parseFloat(numPart);
  if (isNaN(parsedNumber) || parsedNumber <= 0) {
    return null;
  }

  return {
    price: Math.round(parsedNumber * 100) / 100,
    currency: detectedCurrency.toUpperCase(),
  };
}
