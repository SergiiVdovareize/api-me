export type ExtractionStrategy = 'JSON_LD' | 'META' | 'RECIPE' | 'AI';

export interface ExtractedProductData {
  title?: string;
  price: number;
  currency: string;
  inStock: boolean;
  selector?: string;
  strategy: ExtractionStrategy;
  sizes?: string[];
  colors?: string[];
  currentColor?: string;
}

export interface ExtractOptions {
  selector?: string;
  url?: string;
}

export interface PriceExtractor {
  readonly strategy: ExtractionStrategy;
  extract(html: string, options?: ExtractOptions): Promise<ExtractedProductData | null>;
}
