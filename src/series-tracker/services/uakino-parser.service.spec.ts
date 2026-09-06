import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { UakinoParserService } from './uakino-parser.service';

describe('UakinoParserService', () => {
  let service: UakinoParserService;
  let configService: { get: jest.Mock };
  const originalFetch = global.fetch;

  beforeEach(async () => {
    configService = {
      get: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [UakinoParserService, { provide: ConfigService, useValue: configService }],
    }).compile();

    service = module.get<UakinoParserService>(UakinoParserService);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('extractNewsId', () => {
    it('should extract news ID from URL path', () => {
      const url = 'https://uakino.best/seriesss/26298-podil-rozryv-2-sezon.html';
      const id = service.extractNewsId(url, '');
      expect(id).toBe('26298');
    });

    it('should extract news ID from data-news-id attribute', () => {
      const html = '<div data-news-id="12345">Content</div>';
      const id = service.extractNewsId('https://uakino.best/series/show.html', html);
      expect(id).toBe('12345');
    });

    it('should extract news ID from name="news_id" input', () => {
      const html = '<input type="hidden" name="news_id" value="54321">';
      const id = service.extractNewsId('https://uakino.best/series/show.html', html);
      expect(id).toBe('54321');
    });

    it('should extract news ID from show_toloka(ID) call', () => {
      const html = '<button onclick="show_toloka(9876)">Toloka</button>';
      const id = service.extractNewsId('https://uakino.best/series/show.html', html);
      expect(id).toBe('9876');
    });

    it('should return undefined if no news ID found', () => {
      const id = service.extractNewsId('https://uakino.best/series/no-id', '<div>Nothing</div>');
      expect(id).toBeUndefined();
    });
  });

  describe('parseEpisodeNumber', () => {
    it('should parse standard Cyrillic Серії 1-8', () => {
      expect(service.parseEpisodeNumber('Серії 1-8 з 8')).toBe(8);
      expect(service.parseEpisodeNumber('Серія 5')).toBe(5);
    });

    it('should parse Latin "C" homoglyph (Cерії 1-9)', () => {
      // Latin C \u0043
      const text = '\u0043ерії 1-9';
      expect(service.parseEpisodeNumber(text)).toBe(9);
    });

    it('should parse S02E10 pattern', () => {
      expect(service.parseEpisodeNumber('Show S02E10 1080p')).toBe(10);
      expect(service.parseEpisodeNumber('Show S01E01-08 WEB-DL')).toBe(8);
    });

    it('should parse reverse order (1-10 серія)', () => {
      expect(service.parseEpisodeNumber('1-10 серія WEB-DL')).toBe(10);
    });

    it('should return 0 when no episode number found', () => {
      expect(service.parseEpisodeNumber('Severance Season 2 WEB-DL 1080p')).toBe(0);
    });
  });

  describe('parseSeasonsBlock', () => {
    it('should parse multiple seasons from ul.seasons', () => {
      const html = `
        <ul class="seasons">
          <li><a href="/series/100-s1.html">1 сезон</a></li>
          <li class="active"><a href="/series/200-s2.html">2 сезон</a></li>
        </ul>
      `;
      const seasons = service.parseSeasonsBlock(html, 'https://uakino.best/series/100-s1.html');
      expect(seasons.length).toBe(2);
      expect(seasons[0].seasonNumber).toBe(1);
      expect(seasons[0].url).toBe('https://uakino.best/series/100-s1.html');
      expect(seasons[1].seasonNumber).toBe(2);
      expect(seasons[1].url).toBe('https://uakino.best/series/200-s2.html');
    });

    it('should return empty array if no seasons block exists', () => {
      const html = '<div>Single season show</div>';
      const seasons = service.parseSeasonsBlock(html, 'https://uakino.best/single.html');
      expect(seasons).toEqual([]);
    });
  });

  describe('extractMaxEpisodeFromSchedule', () => {
    it('should extract max scheduled episode for target season from .epscape_tr', () => {
      const html = `
        <table>
          <tr class="epscape_tr"><td>1 сезон 10 серія</td></tr>
          <tr class="epscape_tr"><td>2 сезон 1 серія</td></tr>
          <tr class="epscape_tr"><td>2 сезон 10 серія</td></tr>
        </table>
      `;
      const total = service.extractMaxEpisodeFromSchedule(html, 2);
      expect(total).toBe(10);
    });

    it('should return 0 if no schedule rows match target season', () => {
      const html = '<table><tr class="epscape_tr"><td>1 сезон 8 серія</td></tr></table>';
      const total = service.extractMaxEpisodeFromSchedule(html, 3);
      expect(total).toBe(0);
    });
  });

  describe('extractMax1080pEpisode', () => {
    it('should return 0 for empty or invalid toloka response', async () => {
      expect(await service.extractMax1080pEpisode('', '', 1)).toBe(0);
      expect(await service.extractMax1080pEpisode('Invalid ID', '', 1)).toBe(0);
    });

    it('should ignore releases lower than 1080p (e.g. 720p)', async () => {
      const tolokaHtml = `
        <div class="toloka-item">
          <a class="genmed" href="#">Show (2024) WEB-DLRip 720p Ukr | Серії 1-10</a>
        </div>
      `;
      const maxEp = await service.extractMax1080pEpisode(tolokaHtml, '', 1);
      expect(maxEp).toBe(0);
    });

    it('should detect 1080p and 4K releases with explicit episodes', async () => {
      const tolokaHtml = `
        <div class="toloka-item">
          <a class="genmed" href="#">Show S01E05 WEB-DL 1080p</a>
        </div>
        <div class="toloka-item">
          <a class="genmed" href="#">Show S01E08 WEB-DL 2160p 4K</a>
        </div>
      `;
      const maxEp = await service.extractMax1080pEpisode(tolokaHtml, '', 1);
      expect(maxEp).toBe(8);
    });

    it('should use schedule total fallback when 1080p package is full season without episode numbers', async () => {
      const tolokaHtml = `
        <div class="toloka-item">
          <a class="genmed" href="#">Severance (Season 2) (2025) WEB-DL 1080p Ukr</a>
        </div>
      `;
      const pageHtml = `
        <tr class="epscape_tr"><td>2 сезон 10 серія</td></tr>
      `;
      const maxEp = await service.extractMax1080pEpisode(tolokaHtml, pageHtml, 2, 'Severance');
      expect(maxEp).toBe(10);
    });

    it('should use TVMaze fallback if schedule table is empty for full-season release', async () => {
      const tolokaHtml = `
        <div class="toloka-item">
          <a class="genmed" href="#">Severance (Season 2) (2025) WEB-DL 1080p Ukr</a>
        </div>
      `;
      jest.spyOn(service, 'fetchTvMazeEpisodeCount').mockResolvedValue(10);

      const maxEp = await service.extractMax1080pEpisode(tolokaHtml, '', 2, 'Severance');
      expect(maxEp).toBe(10);
      expect(service.fetchTvMazeEpisodeCount).toHaveBeenCalledWith('Severance', 2);
    });
  });

  describe('fetchPage', () => {
    it('should route via ScraperAPI when SCRAPERAPI_KEY is provided', async () => {
      configService.get.mockReturnValue('scraper-key-123');
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        text: jest.fn().mockResolvedValue('<html>Page content</html>'),
      });
      global.fetch = mockFetch;

      const html = await service.fetchPage('https://uakino.best/test.html');
      expect(html).toBe('<html>Page content</html>');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.scraperapi.com/?api_key=scraper-key-123&url=https%3A%2F%2Fuakino.best%2Ftest.html',
        expect.any(Object)
      );
    });

    it('should direct fetch when SCRAPERAPI_KEY is not configured', async () => {
      configService.get.mockReturnValue(undefined);
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        text: jest.fn().mockResolvedValue('<html>Direct content</html>'),
      });
      global.fetch = mockFetch;

      const html = await service.fetchPage('https://uakino.best/direct.html');
      expect(html).toBe('<html>Direct content</html>');
      expect(mockFetch).toHaveBeenCalledWith('https://uakino.best/direct.html', expect.any(Object));
    });

    it('should throw error when fetch returns not ok', async () => {
      configService.get.mockReturnValue(undefined);
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
      });

      await expect(service.fetchPage('https://uakino.best/blocked.html')).rejects.toThrow(
        'Failed to fetch https://uakino.best/blocked.html: HTTP 403 Forbidden'
      );
    });
  });

  describe('fetchTvMazeEpisodeCount', () => {
    it('should return episode count from TVMaze API', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          _embedded: {
            episodes: [
              { season: 1, number: 1 },
              { season: 1, number: 2 },
              { season: 2, number: 1 },
              { season: 2, number: 2 },
              { season: 2, number: 3 },
            ],
          },
        }),
      });

      const count = await service.fetchTvMazeEpisodeCount('Severance', 2);
      expect(count).toBe(3);
    });

    it('should return 0 on TVMaze error', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));
      const count = await service.fetchTvMazeEpisodeCount('NonExistent', 1);
      expect(count).toBe(0);
    });
  });

  describe('checkSeries', () => {
    it('should check single-season series and extract poster', async () => {
      const pageHtml = `
        <html>
          <head>
            <meta property="og:image" content="https://uakino.best/posters/silo.jpg">
          </head>
          <body>
            <div data-news-id="1234">Silo Season 1</div>
          </body>
        </html>
      `;

      jest.spyOn(service, 'fetchPage').mockResolvedValue(pageHtml);
      jest.spyOn(service, 'fetchTolokaDistributions').mockResolvedValue('<div>Toloka mock</div>');
      jest.spyOn(service, 'extractMax1080pEpisode').mockResolvedValue(10);

      const result = await service.checkSeries('https://uakino.best/1234-silo.html', 'Silo');

      expect(result.latestSeason).toBe(1);
      expect(result.latestEpisode).toBe(10);
      expect(result.posterUrl).toBe('https://uakino.best/posters/silo.jpg');
      expect(result.hasConfirmedRelease).toBe(true);
    });

    it('should resolve newest season when multiple seasons exist', async () => {
      const s1Html = `
        <html>
          <body>
            <ul class="seasons">
              <li><a href="https://uakino.best/100-s1.html">1 сезон</a></li>
              <li><a href="https://uakino.best/200-s2.html">2 сезон</a></li>
            </ul>
          </body>
        </html>
      `;
      const s2Html = `
        <html>
          <head>
            <meta property="og:image" content="/uploads/s2.jpg">
          </head>
          <body>
            <input type="hidden" name="news_id" value="200">
          </body>
        </html>
      `;

      jest.spyOn(service, 'fetchPage').mockImplementation(async (url: string) => {
        if (url.includes('s2.html')) return s2Html;
        return s1Html;
      });
      jest.spyOn(service, 'fetchTolokaDistributions').mockResolvedValue('<div>Toloka S2</div>');
      jest.spyOn(service, 'extractMax1080pEpisode').mockResolvedValue(8);

      const result = await service.checkSeries('https://uakino.best/100-s1.html', 'Show');

      expect(result.latestSeason).toBe(2);
      expect(result.latestEpisode).toBe(8);
      expect(result.posterUrl).toBe('https://uakino.best/uploads/s2.jpg');
      expect(result.hasConfirmedRelease).toBe(true);
    });

    it('should not re-fetch page if targetUrl is already the newest season', async () => {
      const s2Html = `
        <html>
          <head>
            <meta property="og:image" content="/uploads/s2.jpg">
          </head>
          <body>
            <ul class="seasons">
              <li><a href="https://uakino.best/100-s1.html">1 сезон</a></li>
              <li><a href="https://uakino.best/200-s2.html">2 сезон</a></li>
            </ul>
            <input type="hidden" name="news_id" value="200">
          </body>
        </html>
      `;

      const fetchPageSpy = jest.spyOn(service, 'fetchPage').mockResolvedValue(s2Html);
      jest.spyOn(service, 'fetchTolokaDistributions').mockResolvedValue('<div>Toloka S2</div>');
      jest.spyOn(service, 'extractMax1080pEpisode').mockResolvedValue(8);

      const result = await service.checkSeries('https://uakino.best/200-s2.html', 'Show');

      expect(result.latestSeason).toBe(2);
      expect(result.latestEpisode).toBe(8);
      expect(fetchPageSpy).toHaveBeenCalledTimes(1);
    });

    it('should throw error if newsId cannot be determined', async () => {
      jest.spyOn(service, 'fetchPage').mockResolvedValue('<html>No ID anywhere</html>');

      await expect(
        service.checkSeries('https://uakino.best/unknown.html', 'Unknown')
      ).rejects.toThrow('Could not determine news ID');
    });

    it('should parse initial season number from URL when season pattern matches', async () => {
      const s2Html = `
        <html>
          <body>
            <input type="hidden" name="news_id" value="26298">
          </body>
        </html>
      `;
      jest.spyOn(service, 'fetchPage').mockResolvedValue(s2Html);
      jest.spyOn(service, 'fetchTolokaDistributions').mockResolvedValue('<div>S2 Toloka</div>');
      jest.spyOn(service, 'extractMax1080pEpisode').mockResolvedValue(5);

      const result = await service.checkSeries('https://uakino.best/26298-podil-rozryv-2-sezon.html', 'Podil');
      expect(result.latestSeason).toBe(2);
      expect(result.latestEpisode).toBe(5);
    });

    it('should continue with initial season HTML if fetching newest season fails', async () => {
      const s1Html = `
        <html>
          <body>
            <ul class="seasons">
              <li><a href="https://uakino.best/100-s1.html">1 сезон</a></li>
              <li><a href="https://uakino.best/200-s2.html">2 сезон</a></li>
            </ul>
            <div data-news-id="100">S1 content</div>
          </body>
        </html>
      `;

      jest.spyOn(service, 'fetchPage').mockImplementation(async (url: string) => {
        if (url.includes('s2.html')) throw new Error('Fetch failed 500');
        return s1Html;
      });
      jest.spyOn(service, 'fetchTolokaDistributions').mockResolvedValue('<div>Toloka S1</div>');
      jest.spyOn(service, 'extractMax1080pEpisode').mockResolvedValue(10);

      const result = await service.checkSeries('https://uakino.best/100-s1.html', 'Show');
      expect(result.latestSeason).toBe(2);
      expect(result.latestEpisode).toBe(10);
    });
  });

  describe('fetchPage extended branches', () => {
    it('should mask short SCRAPERAPI_KEY with ***', async () => {
      configService.get.mockReturnValue('12345');
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        text: jest.fn().mockResolvedValue('<html>Page</html>'),
      });
      global.fetch = mockFetch;

      const html = await service.fetchPage('https://uakino.best/test.html');
      expect(html).toBe('<html>Page</html>');
      expect(mockFetch).toHaveBeenCalled();
    });

    it('should auto-retry with .html on 404 for URLs without .html extension', async () => {
      configService.get.mockReturnValue(undefined);
      const mockFetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          statusText: 'Not Found',
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: jest.fn().mockResolvedValue('<html>Retried Page</html>'),
        });
      global.fetch = mockFetch;

      const html = await service.fetchPage('https://uakino.best/show');
      expect(html).toBe('<html>Retried Page</html>');
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch).toHaveBeenNthCalledWith(2, 'https://uakino.best/show.html', expect.any(Object));
    });
  });

  describe('extractNewsId extended patterns', () => {
    it('should extract news ID from meta[property="og:url"]', () => {
      const html = '<meta property="og:url" content="https://uakino.best/9999-og-show.html">';
      const id = service.extractNewsId('https://uakino.best/series/other', html);
      expect(id).toBe('9999');
    });

    it('should extract news ID from [data-id] attribute', () => {
      const html = '<div data-id="8888">Show</div>';
      const id = service.extractNewsId('https://uakino.best/series/other', html);
      expect(id).toBe('8888');
    });

    it('should extract news ID from JS variable dle_news_id', () => {
      const html = '<script>var dle_news_id = "7777";</script>';
      const id = service.extractNewsId('https://uakino.best/series/other', html);
      expect(id).toBe('7777');
    });
  });

  describe('fetchTolokaDistributions fallbacks', () => {
    it('should retry with news_id if toloka returns Invalid ID', async () => {
      jest.spyOn(service, 'fetchPage')
        .mockResolvedValueOnce('Invalid ID')
        .mockResolvedValueOnce('<div>Toloka content with news_id</div>');

      const html = await service.fetchTolokaDistributions('https://uakino.best/show.html', '1234');
      expect(html).toBe('<div>Toloka content with news_id</div>');
    });

    it('should catch error on toloka with id and retry with news_id', async () => {
      jest.spyOn(service, 'fetchPage')
        .mockRejectedValueOnce(new Error('500 Internal Error'))
        .mockResolvedValueOnce('<div>Toloka fallback content</div>');

      const html = await service.fetchTolokaDistributions('https://uakino.best/show.html', '1234');
      expect(html).toBe('<div>Toloka fallback content</div>');
    });
  });

  describe('parseEpisodeNumber extended patterns', () => {
    it('should parse single episode prefix (7 серія)', () => {
      expect(service.parseEpisodeNumber('7 серія 1080p')).toBe(7);
    });

    it('should parse "X з Y" pattern (3 з 10)', () => {
      expect(service.parseEpisodeNumber('Епізод 3 з 10 WEB-DL 1080p')).toBe(3);
    });
  });
});

