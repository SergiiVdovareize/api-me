export class CreateProductDto {
  url!: string;
  chatId?: string;
  targetPrice?: number;
  dropPercent?: number;
  notifyOnRestock?: boolean;
  desiredSize?: string;
  desiredColor?: string;
}

export interface CreateProductResponse {
  id: number;
  url: string;
  title: string;
  price: number;
  currency: string;
  inStock: boolean;
  status: string;
  sizes?: string[];
  colors?: string[];
  currentColor?: string;
}
