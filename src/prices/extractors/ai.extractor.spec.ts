import { AiExtractor } from './ai.extractor';
import { LlmService } from '../../llm/llm.service';

describe('AiExtractor', () => {
  let extractor: AiExtractor;
  let mockLlmService: jest.Mocked<Partial<LlmService>>;

  beforeEach(() => {
    mockLlmService = {
      callAndParseJSON: jest.fn(),
    };
    extractor = new AiExtractor(mockLlmService as LlmService);
  });

  it('should extract product and validate matching selector', async () => {
    const html = `
      <html>
      <body>
        <main>
          <h1>Спортивний костюм</h1>
          <span class="actual-price">2 499 ₴</span>
        </main>
      </body>
      </html>
    `;

    mockLlmService.callAndParseJSON.mockResolvedValueOnce({
      title: 'Спортивний костюм',
      price: 2499,
      currency: 'UAH',
      inStock: true,
      selector: '.actual-price',
    });

    const result = await extractor.extract(html);
    expect(result).toEqual({
      title: 'Спортивний костюм',
      price: 2499,
      currency: 'UAH',
      inStock: true,
      selector: '.actual-price',
      strategy: 'AI',
    });
  });

  it('should omit selector if element text does not match price', async () => {
    const html = `
      <html>
      <body>
        <span class="wrong-element">Опис товару</span>
      </body>
      </html>
    `;

    mockLlmService.callAndParseJSON.mockResolvedValueOnce({
      title: 'Товар',
      price: 1500,
      currency: 'UAH',
      inStock: true,
      selector: '.wrong-element',
    });

    const result = await extractor.extract(html);
    expect(result).toBeDefined();
    expect(result?.price).toBe(1500);
    expect(result?.selector).toBeUndefined();
  });

  it('should return null if AI fails or returns invalid price', async () => {
    mockLlmService.callAndParseJSON.mockResolvedValueOnce({
      price: 0,
    });

    const result = await extractor.extract('<html></html>');
    expect(result).toBeNull();
  });
});
