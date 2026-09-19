export interface FuelPrices {
  a95Premium?: number;
  a95?: number;
  a92?: number;
  diesel?: number;
  dieselPremium?: number;
  gas?: number;
}

export interface FuelPricesResponse {
  requestedDate: string;
  effectiveDate: string;
  isFallback: boolean;
  currency: string;
  unit: string;
  prices: FuelPrices;
  delta?: FuelPrices;
  source: string;
}

export interface FuelHistoryItem {
  date: string;
  prices: FuelPrices;
  delta?: FuelPrices;
}

export interface FuelHistoryResponse {
  startDate: string;
  endDate: string;
  days: number;
  currency: string;
  unit: string;
  items: FuelHistoryItem[];
  source: string;
}
