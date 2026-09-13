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
  source: string;
}
