import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as cheerio from 'cheerio';
import { UakinoCheckResult, UakinoSeasonInfo } from '../types';

@Injectable()
export class UakinoParserService {
  private readonly logger = new Logger(UakinoParserService.name);

  constructor(private readonly configService: ConfigService) {}

  /**
   * Fetches URL content, routing through ScraperAPI if an API key is provided
   */
  async fetchPage(targetUrl: string): Promise<string> {
    const apiKey = this.configService.get<string>('SCRAPERAPI_KEY')?.trim();

    let requestUrl = targetUrl;
    if (apiKey) {
      const maskedKey = apiKey.length > 6 ? `${apiKey.slice(0, 4)}...${apiKey.slice(-2)}` : '***';
      this.logger.debug(`[ScraperAPI] Using key ${maskedKey} to proxy: ${targetUrl}`);
      requestUrl = `https://api.scraperapi.com/?api_key=${encodeURIComponent(apiKey)}&url=${encodeURIComponent(targetUrl)}`;
    } else {
      this.logger.warn(
        `SCRAPERAPI_KEY is not set. Making direct request to ${targetUrl} (may be blocked by Cloudflare).`
      );
    }

    const startTime = Date.now();

    const response = await fetch(requestUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'uk-UA,uk;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    });

    const elapsed = Date.now() - startTime;

    if (!response.ok) {
      // Auto-retry with .html if 404 occurs on an article URL missing extension
      if (
        response.status === 404 &&
        !targetUrl.endsWith('.html') &&
        !targetUrl.includes('toloka.php')
      ) {
        this.logger.warn(`404 received for ${targetUrl}. Retrying with '.html' appended...`);
        return await this.fetchPage(`${targetUrl}.html`);
      }

      this.logger.error(
        `Failed to fetch ${targetUrl} after ${elapsed}ms: HTTP ${response.status} ${response.statusText}`
      );
      throw new Error(
        `Failed to fetch ${targetUrl}: HTTP ${response.status} ${response.statusText}`
      );
    }

    const html = await response.text();
    this.logger.debug(
      `Successfully fetched ${targetUrl} in ${elapsed}ms (status: ${response.status}, length: ${html.length} chars)`
    );

    return html;
  }

  /**
   * Checks a series starting from its initial or cached recent season URL:
   * 1. Loads season page
   * 2. Finds latest season in <ul class="seasons">
   * 3. Loads latest season page / gets its news ID (skips fetch if already on latest season)
   * 4. Queries /engine/ajax/toloka.php?id={newsId} for distributions
   * 5. Filters for 1080p+ quality and determines max confirmed episode
   */
  async checkSeries(seasonUrl: string, seriesTitle?: string): Promise<UakinoCheckResult> {
    this.logger.log(`========== Checking series: ${seasonUrl} ==========`);

    const initialHtml = await this.fetchPage(seasonUrl);
    const seasons = this.parseSeasonsBlock(initialHtml, seasonUrl);

    // Detect initial season from URL pattern (e.g. 26298-podil-rozryv-2-sezon.html -> 2)
    const urlSeasonMatch = seasonUrl.match(/(\d+)-sezon/i);
    const initialSeasonNumber = urlSeasonMatch ? parseInt(urlSeasonMatch[1], 10) : 1;

    let latestSeason: UakinoSeasonInfo = {
      seasonNumber: initialSeasonNumber,
      url: seasonUrl,
      newsId: this.extractNewsId(seasonUrl, initialHtml),
    };

    let latestSeasonHtml = initialHtml;

    if (seasons.length > 0) {
      // Sort descending by season number to find the highest season
      seasons.sort((a, b) => b.seasonNumber - a.seasonNumber);
      const newest = seasons[0];

      this.logger.log(
        `Discovered ${seasons.length} season(s). Highest is Season ${newest.seasonNumber} (${newest.url})`
      );

      const isSameUrl = (u1: string, u2: string) => {
        const clean = (s: string) => s.replace(/\.html$/i, '').replace(/\/+$/, '').toLowerCase();
        return clean(u1) === clean(u2);
      };

      if (newest.seasonNumber > latestSeason.seasonNumber || !isSameUrl(newest.url, seasonUrl)) {
        if (!isSameUrl(newest.url, seasonUrl)) {
          try {
            this.logger.log(
              `Fetching page for newest Season ${newest.seasonNumber}: ${newest.url}`
            );
            latestSeasonHtml = await this.fetchPage(newest.url);
          } catch (e) {
            this.logger.warn(`Failed to fetch latest season page (${newest.url}): ${e.message}`);
          }
        }
        latestSeason = {
          seasonNumber: newest.seasonNumber,
          url: newest.url,
          newsId: this.extractNewsId(newest.url, latestSeasonHtml),
        };
      } else {
        latestSeason.seasonNumber = newest.seasonNumber;
      }
    } else {
      this.logger.log(
        `No multi-season block found on page. Treating current page as Season ${latestSeason.seasonNumber}.`
      );
    }

    if (!latestSeason.newsId) {
      this.logger.error(`Could not determine news ID for series at URL: ${latestSeason.url}`);
      throw new Error(`Could not determine news ID for series season at ${latestSeason.url}`);
    }

    this.logger.log(
      `Latest season resolved: Season ${latestSeason.seasonNumber} | News ID: "${latestSeason.newsId}" | Page URL: ${latestSeason.url}`
    );

    // Fetch distributions via Toloka AJAX endpoint
    const distributionsHtml = await this.fetchTolokaDistributions(
      latestSeason.url,
      latestSeason.newsId
    );

    // Parse max episode with 1080p+ criteria and full-season fallback
    const max1080pEpisode = await this.extractMax1080pEpisode(
      distributionsHtml,
      latestSeasonHtml,
      latestSeason.seasonNumber,
      seriesTitle
    );

    // Extract poster image URL
    let posterUrl: string | undefined;
    try {
      const $ = cheerio.load(latestSeasonHtml);
      const rawPoster =
        $('meta[property="og:image"]').attr('content') ||
        $('meta[name="twitter:image"]').attr('content') ||
        $('.film-poster img, .poster img').attr('src');

      if (rawPoster) {
        posterUrl = rawPoster.startsWith('http')
          ? rawPoster
          : new URL(rawPoster, latestSeason.url).toString();
        this.logger.debug(`Poster image detected: ${posterUrl}`);
      }
    } catch (e) {
      this.logger.debug(`Could not extract poster: ${e.message}`);
    }

    return {
      latestSeason: latestSeason.seasonNumber,
      latestEpisode: max1080pEpisode,
      latestUrl: latestSeason.url,
      posterUrl,
      hasConfirmedRelease: max1080pEpisode > 0,
    };
  }

  /**
   * Parses the <ul class="seasons"> block from page HTML
   */
  parseSeasonsBlock(html: string, baseUrl: string): UakinoSeasonInfo[] {
    const $ = cheerio.load(html);
    const seasons: UakinoSeasonInfo[] = [];

    // Find list inside <ul class="seasons"> or similar selectors
    const seasonsList = $('ul.seasons, .seasons, .season-list');

    this.logger.debug(
      `Searching for season navigation block. Matches found: ${seasonsList.length}`
    );

    seasonsList.find('li, a, button').each((_, element) => {
      const el = $(element);
      const text = el.text().trim();
      const href = el.attr('href') || el.find('a').attr('href');

      // Match "1 сезон", "Сезон 2", "Season 3", "2-й сезон"
      const match =
        text.match(/(\d+)\s*(?:-?[йі]й)?\s*сезон/i) ||
        text.match(/сезон\s*(\d+)/i) ||
        text.match(/season\s*(\d+)/i);

      if (match) {
        const seasonNumber = parseInt(match[1], 10);
        let absoluteUrl = baseUrl;

        if (href && href !== '#' && !href.startsWith('javascript:')) {
          try {
            absoluteUrl = new URL(href, baseUrl).toString();
          } catch {
            absoluteUrl = href;
          }
        }

        if (seasonNumber > 0) {
          seasons.push({ seasonNumber, url: absoluteUrl });
        }
      }
    });

    // De-duplicate seasons by seasonNumber
    const uniqueMap = new Map<number, UakinoSeasonInfo>();
    for (const item of seasons) {
      if (!uniqueMap.has(item.seasonNumber) || uniqueMap.get(item.seasonNumber)!.url === baseUrl) {
        uniqueMap.set(item.seasonNumber, item);
      }
    }

    const result = Array.from(uniqueMap.values());
    this.logger.debug(
      `Parsed unique seasons: ${JSON.stringify(result.map(s => `Season ${s.seasonNumber} -> ${s.url}`))}`
    );
    return result;
  }

  /**
   * Extracts the numeric article/news ID from URL or page HTML
   */
  extractNewsId(url: string, html?: string): string | undefined {
    // 1. Try URL pattern: /12345-title.html
    const urlMatch = url.match(/(?:^|\/)(\d+)-[^/]+\.html/i);
    if (urlMatch) {
      this.logger.debug(`Extracted news ID "${urlMatch[1]}" directly from URL pattern: ${url}`);
      return urlMatch[1];
    }

    if (!html) {
      return undefined;
    }

    // 2. Try og:url meta tag
    const $ = cheerio.load(html);
    const ogUrl = $('meta[property="og:url"]').attr('content');
    if (ogUrl) {
      const ogMatch = ogUrl.match(/(?:^|\/)(\d+)-[^/]+\.html/i);
      if (ogMatch) {
        this.logger.debug(`Extracted news ID "${ogMatch[1]}" from meta og:url: ${ogUrl}`);
        return ogMatch[1];
      }
    }

    // 3. Try hidden inputs or data attributes
    const inputNewsId =
      $('input[name="news_id"]').val() ||
      $('[data-news-id]').attr('data-news-id') ||
      $('[data-id]').attr('data-id');

    if (inputNewsId && /^\d+$/.test(String(inputNewsId))) {
      this.logger.debug(`Extracted news ID "${inputNewsId}" from input/data attribute.`);
      return String(inputNewsId);
    }

    // 4. Try JS variables in script tags or onclick handlers
    const scriptMatch =
      html.match(/(?:news_id|newsid|dle_news_id)\s*[:=]\s*['"]?(\d+)['"]?/i) ||
      html.match(/show_toloka\((\d+)\)/i);
    if (scriptMatch) {
      this.logger.debug(`Extracted news ID "${scriptMatch[1]}" from script content.`);
      return scriptMatch[1];
    }

    this.logger.warn(`Could not extract news ID from URL or HTML for: ${url}`);
    return undefined;
  }

  /**
   * Queries /engine/ajax/toloka.php for distributions of the specified news ID
   * Note: UAKino requires 'id', not 'news_id'.
   */
  async fetchTolokaDistributions(pageUrl: string, newsId: string): Promise<string> {
    const urlObj = new URL(pageUrl);
    const origin = urlObj.origin; // e.g. https://uakino.best

    // Endpoint requires 'id'
    const tolokaUrl = `${origin}/engine/ajax/toloka.php?id=${encodeURIComponent(newsId)}`;
    this.logger.log(`Querying Toloka distributions: ${tolokaUrl}`);

    try {
      const html = await this.fetchPage(tolokaUrl);
      if (html.trim() === 'Invalid ID') {
        this.logger.warn(`Toloka returned 'Invalid ID' for id=${newsId}. Retrying with news_id...`);
        return await this.fetchPage(
          `${origin}/engine/ajax/toloka.php?news_id=${encodeURIComponent(newsId)}`
        );
      }
      this.logger.debug(`Toloka response received (${html.length} chars).`);
      return html;
    } catch (error) {
      this.logger.warn(
        `GET toloka with id failed (${tolokaUrl}): ${error.message}. Retrying with 'news_id'...`
      );
      const fallbackUrl = `${origin}/engine/ajax/toloka.php?news_id=${encodeURIComponent(newsId)}`;
      const html = await this.fetchPage(fallbackUrl);
      this.logger.debug(`Toloka fallback response received (${html.length} chars).`);
      return html;
    }
  }

  /**
   * Extracts max episode from the page's release schedule table (.epscape_tr)
   */
  extractMaxEpisodeFromSchedule(pageHtml: string, targetSeason: number): number {
    if (!pageHtml) return 0;
    const $ = cheerio.load(pageHtml);
    let maxEpisode = 0;

    $('.epscape_tr').each((_, el) => {
      const text = $(el).text().replace(/\s+/g, ' ').trim();
      const seasonMatch = text.match(/(\d+)\s*сезон/i);
      const episodeMatch = text.match(/(\d+)\s*серія/i);

      if (episodeMatch) {
        const ep = parseInt(episodeMatch[1], 10);
        const s = seasonMatch ? parseInt(seasonMatch[1], 10) : targetSeason;
        if (s === targetSeason && ep > maxEpisode) {
          maxEpisode = ep;
        }
      }
    });

    return maxEpisode;
  }

  /**
   * Queries the free TVMaze API to get official episode count for a season
   */
  async fetchTvMazeEpisodeCount(showTitle: string, seasonNumber: number): Promise<number> {
    try {
      // Split on '/' to get the English or main title: e.g. "Поділ / Розрив / Severance" -> "Severance"
      const parts = showTitle.split('/');
      const query = (parts[parts.length - 1] || parts[0]).trim();

      const url = `https://api.tvmaze.com/singlesearch/shows?q=${encodeURIComponent(query)}&embed=episodes`;
      this.logger.debug(`[TVMaze Fallback] Querying: ${url}`);

      const res = await fetch(url);
      if (!res.ok) return 0;

      const data = (await res.json()) as any;
      const episodes = data?._embedded?.episodes || [];
      const seasonEpisodes = episodes.filter((e: any) => e.season === seasonNumber);

      this.logger.debug(
        `[TVMaze Fallback] "${query}" Season ${seasonNumber}: ${seasonEpisodes.length} total episodes found.`
      );
      return seasonEpisodes.length;
    } catch (e) {
      this.logger.warn(`TVMaze query failed: ${e.message}`);
      return 0;
    }
  }

  /**
   * Analyzes Toloka HTML snippet and finds the maximum episode number
   * with confirmed quality >= 1080p (1080p, 4K, 2160p, FHD).
   *
   * If a torrent release covers the full season without episode numbers
   * (e.g. "Severance (Season 2) (2025) WEB-DL 1080p"), it extracts the total
   * episode count from UAKino's .epscape_tr schedule or TVMaze fallback.
   */
  async extractMax1080pEpisode(
    tolokaHtml: string,
    pageHtml: string,
    targetSeason: number,
    seriesTitle?: string
  ): Promise<number> {
    if (!tolokaHtml || !tolokaHtml.trim() || tolokaHtml.trim() === 'Invalid ID') {
      this.logger.warn('Toloka HTML response is empty or invalid.');
      return 0;
    }

    const $ = cheerio.load(tolokaHtml);
    let maxEpisode = 0;

    // Look at table rows, release cards, or blocks
    const items = $('tr, .toloka-item, .torrent-item, .rel-item, li, div.item');
    this.logger.debug(`Evaluating distributions: ${items.length} container item(s) found.`);

    let count1080pPlus = 0;
    let countLowerQuality = 0;

    // Pre-calculate schedule max episode from page if available
    const scheduleMaxEp = this.extractMaxEpisodeFromSchedule(pageHtml, targetSeason);
    if (scheduleMaxEp > 0) {
      this.logger.debug(
        `UAKino schedule (.epscape_tr) indicates max ${scheduleMaxEp} episodes for Season ${targetSeason}.`
      );
    }

    for (let i = 0; i < items.length; i++) {
      const rawText = $(items[i]).text().replace(/\s+/g, ' ').trim();
      if (!rawText || rawText.length < 5) continue;

      // Quality check: must have 1080p, 2160p, 4K, or FHD
      const has1080pPlus = /\b(1080p|2160p|4k|fhd)\b/i.test(rawText);
      if (!has1080pPlus) {
        if (/720p|480p|hdtv/i.test(rawText)) {
          countLowerQuality++;
          this.logger.debug(`[IGNORED - Quality < 1080p]: "${rawText.slice(0, 100)}..."`);
        }
        continue;
      }

      count1080pPlus++;
      const ep = this.parseEpisodeNumber(rawText);

      if (ep > 0) {
        this.logger.log(`[1080p+ CONFIRMED]: "${rawText.slice(0, 110)}" -> parsed episode: ${ep}`);
        if (ep > maxEpisode) {
          maxEpisode = ep;
        }
      }
    }

    // If 1080p+ releases exist but NONE of them contained explicit episode numbers,
    // this indicates a completed full-season package (e.g. "Severance (Season 2) WEB-DL 1080p")
    if (count1080pPlus > 0 && maxEpisode === 0) {
      this.logger.log(
        `All 1080p+ releases appear to be full-season packages without episode numbers. Resolving season total...`
      );

      if (scheduleMaxEp > 0) {
        maxEpisode = scheduleMaxEp;
        this.logger.log(
          `[FULL SEASON 1080p+ CONFIRMED]: using UAKino schedule total: ${maxEpisode} episodes`
        );
      } else if (seriesTitle) {
        const tvMazeTotal = await this.fetchTvMazeEpisodeCount(seriesTitle, targetSeason);
        if (tvMazeTotal > 0) {
          maxEpisode = tvMazeTotal;
          this.logger.log(
            `[FULL SEASON 1080p+ CONFIRMED]: using TVMaze total: ${maxEpisode} episodes`
          );
        }
      }
    }

    this.logger.log(
      `Distribution analysis completed. 1080p+ releases: ${count1080pPlus}, Lower quality ignored: ${countLowerQuality}. Max episode: ${maxEpisode}`
    );

    return maxEpisode;
  }

  /**
   * Parses episode numbers from text descriptions like:
   * "Серії 1-8 з 8", "Серія 5", "s02e08", "1-10 серія", "Серії: 1-12", "Епізоди 1-6"
   * Handles both Cyrillic 'с' and Latin 'c' homoglyphs.
   */
  parseEpisodeNumber(text: string): number {
    let maxFound = 0;

    // Helper to validate reasonable episode number (< 1000 to prevent resolution numbers like 1080p, 720p, 2160p)
    const validEp = (n: number) => n > 0 && n < 1000;

    // Pattern 1: S01E08 or S01E01-08
    const sPattern = /s\d+\s*e(\d+)(?:\s*-\s*e?(\d+))?/gi;
    let match: RegExpExecArray | null;
    while ((match = sPattern.exec(text)) !== null) {
      const ep1 = parseInt(match[1], 10);
      const ep2 = match[2] ? parseInt(match[2], 10) : ep1;
      if (validEp(ep1)) maxFound = Math.max(maxFound, ep1);
      if (validEp(ep2)) maxFound = Math.max(maxFound, ep2);
    }

    // Pattern 2: (серії|серія|серій|серии|серия|епізоди|епізод|episodes?|ep\.?)\s*[:#-]?\s*(\d+)(?:\s*(?:-|–|—|до)\s*(\d+))?
    // Matches both Cyrillic 'с' and Latin 'c' (e.g. Cерії 1-9)
    // Negative lookahead (?![pPkK0-9]) ensures we do not match video resolutions (1080p, 720p, 2160p)
    const epPattern =
      /(?:[сc]ерії|[сc]ерія|[сc]ерій|[сc]ерии|[сc]ерия|епізоди|епізод|episodes?|ep\.?)\s*[:#-]?\s*(?<!\d)(\d+)(?![pPkK0-9])(?:\s*(?:-|–|—|до)\s*(?<!\d)(\d+)(?![pPkK0-9]))?/gi;
    while ((match = epPattern.exec(text)) !== null) {
      const ep1 = parseInt(match[1], 10);
      const ep2 = match[2] ? parseInt(match[2], 10) : ep1;
      if (validEp(ep1)) maxFound = Math.max(maxFound, ep1);
      if (validEp(ep2)) maxFound = Math.max(maxFound, ep2);
    }

    // Pattern 3: (\d+)\s*(?:-|–|—)\s*(\d+)\s*(?:серія|серії|серій|серии|серия|епізод|епізоди)/gi (e.g. "1-8 серія")
    const rangePattern =
      /(?<!\d)(\d+)\s*(?:-|–|—)\s*(\d+)\s*(?:[сc]ерія|[сc]ерії|[сc]ерій|[сc]ерии|[сc]ерия|епізод|епізоди)(?![а-яА-ЯіїєґІЇЄҐa-zA-Z0-9])/gi;
    while ((match = rangePattern.exec(text)) !== null) {
      const ep1 = parseInt(match[1], 10);
      const ep2 = parseInt(match[2], 10);
      if (validEp(ep1)) maxFound = Math.max(maxFound, ep1);
      if (validEp(ep2)) maxFound = Math.max(maxFound, ep2);
    }

    // Pattern 4: Single episode prefix: (\d+)\s*(?:серія|серия|епізод) (e.g. "7 серія")
    const singlePattern =
      /(?<!\d)(\d+)\s*(?:[сc]ерія|[сc]ерия|епізод)(?![а-яА-ЯіїєґІЇЄҐa-zA-Z0-9])/gi;
    while ((match = singlePattern.exec(text)) !== null) {
      const ep = parseInt(match[1], 10);
      if (validEp(ep)) maxFound = Math.max(maxFound, ep);
    }

    // Pattern 5: "(\d+)\s*з\s*(\d+)" (e.g. "Серії 1-5 з 10" or "5 з 10" -> current released is 5)
    const outOfPattern = /(?<!\d)(\d+)\s*з\s*(?<!\d)\d+(?![pPkK0-9])/gi;
    while ((match = outOfPattern.exec(text)) !== null) {
      const ep = parseInt(match[1], 10);
      if (validEp(ep)) maxFound = Math.max(maxFound, ep);
    }

    return maxFound;
  }
}
