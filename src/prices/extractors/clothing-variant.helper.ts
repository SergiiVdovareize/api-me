import * as cheerio from 'cheerio';

export interface ClothingVariantsResult {
  sizes?: string[];
  colors?: string[];
  currentColor?: string;
}

/**
 * Extracts size and color information for clothing and footwear products.
 * Handles embedded JSON state (dataLayer, productCard, Next.js, Schema.org) and DOM elements.
 */
export function extractClothingVariants(html: string): ClothingVariantsResult {
  const result: ClothingVariantsResult = {};
  const $ = cheerio.load(html);

  // 1. Color from og:title or title (e.g. "Штани barrel fit Колір світло-сірий - HOUSE")
  const ogTitle = $('meta[property="og:title"]').attr('content') || $('title').text() || '';
  const titleColorMatch = ogTitle.match(/колір\s+([^\n\r,\.;<>{}[\]]+?)(?:\s+-\s+|$)/i);
  if (titleColorMatch) {
    const cand = titleColorMatch[1].trim();
    if (cand && cand.length >= 2 && cand.length <= 30) {
      result.currentColor = cand;
    }
  }

  // 2. Color from body text ("Колір - світло-сірий" or "Колір: чорний")
  if (!result.currentColor) {
    const bodyText = $('body').text();
    const bodyColorMatch = bodyText.match(
      /колір\s*[-:]\s*([^\n\r,\.;<>{}[\]]+?)(?:\s+-\s+|\n|\r|$)/i
    );
    if (bodyColorMatch) {
      const cand = bodyColorMatch[1].trim();
      if (
        cand &&
        !cand.toLowerCase().includes('оберіть') &&
        !cand.toLowerCase().includes('select') &&
        cand.length <= 30
      ) {
        result.currentColor = cand;
      }
    }
  }

  // 3. Search embedded scripts for sizes and color options
  $('script').each((_i, el) => {
    const text = $(el).text();
    if (!text) return;

    // A. Check for sizesList pattern
    if (!result.sizes && text.includes('sizesList')) {
      try {
        const sizesMatch = text.match(/"sizesList"\s*:\s*(\[[^\]]+\])/);
        if (sizesMatch) {
          const allSizes = JSON.parse(sizesMatch[1]) as string[];
          let unavailable: string[] = [];
          const unavMatch = text.match(/"unavailableSizesList"\s*:\s*(\[[^\]]+\])/);
          if (unavMatch) {
            unavailable = JSON.parse(unavMatch[1]) as string[];
          }
          const available = allSizes.filter(s => !unavailable.includes(s));
          if (available.length > 0) {
            result.sizes = available;
          }
        }
      } catch {}
    }

    // B. Check for colorOptions block
    if (!result.colors && text.includes('colorOptions')) {
      const idx = text.indexOf('colorOptions');
      const snippet = text.slice(idx, idx + 3000);
      const snippetMatches = snippet.matchAll(/"name"\s*:\s*"([^"]+)"/g);
      const foundColors: string[] = [];
      for (const m of snippetMatches) {
        const col = m[1]?.trim();
        if (col && col.length >= 2 && col.length <= 30 && !foundColors.includes(col)) {
          foundColors.push(col);
        }
      }
      if (foundColors.length > 0) {
        result.colors = foundColors;
        if (!result.currentColor) {
          result.currentColor = foundColors[0];
        }
      }
    }

    // C. General sizes array in dataLayer or config
    if (!result.sizes && text.includes('"sizes"')) {
      try {
        const genericSizes = text.match(/"sizes"\s*:\s*(\[[^\]]+\])/);
        if (genericSizes) {
          const parsed = JSON.parse(genericSizes[1]);
          if (
            Array.isArray(parsed) &&
            parsed.every(s => typeof s === 'string' || typeof s === 'number')
          ) {
            result.sizes = parsed.map(String);
          }
        }
      } catch {}
    }
  });

  // 4. Fallback DOM extraction for sizes if not found in scripts
  if (!result.sizes || result.sizes.length === 0) {
    const domSizes: string[] = [];
    $(
      '[data-size], [data-attr-value], button[class*="size"]:not(:disabled), .size-item:not(.disabled), .sizes-list li:not(.disabled)'
    ).each((_i, el) => {
      const sizeAttr = $(el).attr('data-size') || $(el).attr('data-attr-value');
      const text = sizeAttr || $(el).text().trim();
      if (text && text.length <= 8 && !domSizes.includes(text)) {
        domSizes.push(text);
      }
    });

    if (domSizes.length > 0) {
      result.sizes = domSizes;
    }
  }

  // 5. Ensure currentColor is included in colors if colors is present
  if (result.currentColor && result.colors && !result.colors.includes(result.currentColor)) {
    result.colors.unshift(result.currentColor);
  }

  return result;
}
