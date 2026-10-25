import { JsonLdExtractor } from './json-ld.extractor';
import { MetaExtractor } from './meta.extractor';
import { RecipeExtractor } from './recipe.extractor';

describe('Price Extractors', () => {
  describe('JsonLdExtractor', () => {
    const extractor = new JsonLdExtractor();

    it('should extract price, currency, title, and stock from JSON-LD schema', async () => {
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <script type="application/ld+json">
          {
            "@context": "https://schema.org/",
            "@type": "Product",
            "name": "Ноутбук Apple MacBook Air 13 M2",
            "offers": {
              "@type": "Offer",
              "price": "43999",
              "priceCurrency": "UAH",
              "availability": "https://schema.org/InStock"
            }
          }
          </script>
        </head>
        <body></body>
        </html>
      `;

      const result = await extractor.extract(html);
      expect(result).toEqual({
        title: 'Ноутбук Apple MacBook Air 13 M2',
        price: 43999,
        currency: 'UAH',
        inStock: true,
        strategy: 'JSON_LD',
      });
    });

    it('should correctly detect OutOfStock availability in JSON-LD', async () => {
      const html = `
        <script type="application/ld+json">
        {
          "@type": "Product",
          "name": "Кавоварка DeLonghi",
          "offers": [{
            "@type": "Offer",
            "price": "12500.00",
            "priceCurrency": "UAH",
            "availability": "http://schema.org/OutOfStock"
          }]
        }
        </script>
      `;

      const result = await extractor.extract(html);
      expect(result).toBeDefined();
      expect(result?.inStock).toBe(false);
      expect(result?.price).toBe(12500);
    });

    it('should extract price from @graph array with AggregateOffer lowPrice and multi-type', async () => {
      const html = `
        <script type="application/ld+json">
        {
          "@graph": [
            {
              "@type": ["Product", "IndividualProduct"],
              "title": "Зимова куртка",
              "offers": {
                "@type": "AggregateOffer",
                "lowPrice": 3200,
                "priceCurrency": "UAH",
                "availability": "https://schema.org/Discontinued"
              }
            }
          ]
        }
        </script>
      `;

      const result = await extractor.extract(html);
      expect(result).toEqual({
        title: 'Зимова куртка',
        price: 3200,
        currency: 'UAH',
        inStock: false,
        strategy: 'JSON_LD',
      });
    });

    it('should ignore invalid json or product without offers', async () => {
      expect(await extractor.extract('<script type="application/ld+json">invalid</script>')).toBeNull();
      expect(
        await extractor.extract(
          '<script type="application/ld+json">{"@type":"Product","name":"Test"}</script>'
        )
      ).toBeNull();
      expect(await extractor.extract('<div>No ld json</div>')).toBeNull();
    });
  });

  describe('MetaExtractor', () => {
    const extractor = new MetaExtractor();

    it('should extract price and currency from OpenGraph and product meta tags', async () => {
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta property="og:title" content="Смартфон Samsung Galaxy S24" />
          <meta property="product:price:amount" content="34999.00" />
          <meta property="product:price:currency" content="UAH" />
          <meta property="product:availability" content="in stock" />
        </head>
        <body></body>
        </html>
      `;

      const result = await extractor.extract(html);
      expect(result).toEqual({
        title: 'Смартфон Samsung Galaxy S24',
        price: 34999,
        currency: 'UAH',
        inStock: true,
        strategy: 'META',
      });
    });

    it('should fallback to twitter:title and detect outofstock in meta', async () => {
      const html = `
        <html>
        <head>
          <meta name="twitter:title" content="Годинник Garmin" />
          <meta name="price" content="18000" />
          <meta property="og:availability" content="discontinued" />
        </head>
        </html>
      `;

      const result = await extractor.extract(html);
      expect(result?.title).toBe('Годинник Garmin');
      expect(result?.price).toBe(18000);
      expect(result?.inStock).toBe(false);
    });

    it('should return null when no price meta tags found', async () => {
      const html = `<html><head><title>No price</title></head></html>`;
      expect(await extractor.extract(html)).toBeNull();
    });
  });

  describe('RecipeExtractor', () => {
    const extractor = new RecipeExtractor();

    it('should extract price from CSS selector and title from h1', async () => {
      const html = `
        <!DOCTYPE html>
        <html>
        <body>
          <h1>Навушники Sony WH-1000XM5</h1>
          <div class="product-pricing">
            <span class="current-price">14 999 ₴</span>
          </div>
        </body>
        </html>
      `;

      const result = await extractor.extract(html, { selector: '.current-price' });
      expect(result).toEqual({
        title: 'Навушники Sony WH-1000XM5',
        price: 14999,
        currency: 'UAH',
        inStock: true,
        selector: '.current-price',
        strategy: 'RECIPE',
      });
    });

    it('should detect out of stock when buy button is disabled and text mentions sold out', async () => {
      const html = `
        <html>
        <head><title>Планшет iPad</title></head>
        <body>
          <span class="price-val">22 000 ₴</span>
          <p>На жаль, товар закінчився</p>
          <button disabled class="out-of-stock">Купити</button>
        </body>
        </html>
      `;

      const result = await extractor.extract(html, { selector: '.price-val' });
      expect(result?.title).toBe('Планшет iPad');
      expect(result?.price).toBe(22000);
      expect(result?.inStock).toBe(false);
    });

    it('should return null when selector is missing or not matched or price invalid', async () => {
      const html = `<div>Price: 100 UAH</div>`;
      expect(await extractor.extract(html)).toBeNull();
      expect(await extractor.extract(html, { selector: '.non-existent' })).toBeNull();
      expect(await extractor.extract('<div><span class="bad">Not a price</span></div>', { selector: '.bad' })).toBeNull();
    });
  });
});
