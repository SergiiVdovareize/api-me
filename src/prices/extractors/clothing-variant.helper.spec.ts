import { extractClothingVariants } from './clothing-variant.helper';

describe('extractClothingVariants', () => {
  it('should extract sizes and filter out unavailable sizes from script', () => {
    const html = `
      <html>
      <head>
        <script>
          window.product = {
            "sizesList": ["XS", "S", "M", "L"],
            "unavailableSizesList": ["L"]
          };
        </script>
      </head>
      <body></body>
      </html>
    `;

    const result = extractClothingVariants(html);
    expect(result.sizes).toEqual(['XS', 'S', 'M']);
  });

  it('should extract current color from og:title', () => {
    const html = `
      <html>
      <head>
        <meta property="og:title" content="Джинси прямі Колір темно-синій - Бренд - 12345" />
      </head>
      <body></body>
      </html>
    `;

    const result = extractClothingVariants(html);
    expect(result.currentColor).toBe('темно-синій');
  });

  it('should extract colorOptions from script', () => {
    const html = `
      <script>
        const colorOptions = [{"color":{"name":"бежевий"}},{"color":{"name":"чорний"}}];
      </script>
    `;

    const result = extractClothingVariants(html);
    expect(result.colors).toContain('бежевий');
    expect(result.colors).toContain('чорний');
  });

  it('should fallback to DOM sizes when script sizes are absent', () => {
    const html = `
      <div>
        <button class="product-size" data-size="S">S</button>
        <button class="product-size" data-size="M">M</button>
        <button class="product-size disabled" disabled data-size="L">L</button>
      </div>
    `;

    const result = extractClothingVariants(html);
    expect(result.sizes).toContain('S');
    expect(result.sizes).toContain('M');
  });

  it('should return empty object if no clothing variants are present', () => {
    const html = `
      <html>
      <head><title>Ноутбук Asus ZenBook</title></head>
      <body><p>Характеристики ноутбука</p></body>
      </html>
    `;

    const result = extractClothingVariants(html);
    expect(result.sizes).toBeUndefined();
    expect(result.colors).toBeUndefined();
  });
});
