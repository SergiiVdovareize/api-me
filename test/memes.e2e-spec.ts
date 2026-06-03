import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from './../src/app.module';
import * as Sentry from '@sentry/nestjs';
import { PrismaService as PrismaService1 } from 'src/prisma.service';
import { PrismaService as PrismaService2 } from 'src/models/prisma/prisma.service';
import { MemesService } from 'src/memes/memes.service';


jest.mock('@sentry/nestjs', () => {
  const actual = jest.requireActual('@sentry/nestjs');
  return {
    ...actual,
    captureMessage: jest.fn(),
    flush: jest.fn().mockResolvedValue(undefined),
  };
});

describe('MemesController (e2e)', () => {
  jest.setTimeout(30000);
  let app: INestApplication;

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService1)
      .useValue({
        $connect: jest.fn().mockResolvedValue(undefined),
        $disconnect: jest.fn().mockResolvedValue(undefined),
        onModuleInit: jest.fn().mockResolvedValue(undefined),
      })
      .overrideProvider(PrismaService2)
      .useValue({
        $connect: jest.fn().mockResolvedValue(undefined),
        $disconnect: jest.fn().mockResolvedValue(undefined),
        onModuleInit: jest.fn().mockResolvedValue(undefined),
        request: {
          create: jest.fn().mockResolvedValue({ id: 1 }),
        },
      })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should return error when URL is unsupported or invalid', async () => {
    const targetUrl = 'https://example.com/invalid-meme-url-12345';

    const response = await request(app.getHttpServer())
      .get(`/memes/${encodeURIComponent(targetUrl)}`)
      .expect(200);

    expect(response.body).toEqual({
      success: false,
      platform: 'unknown',
      title: null,
      description: null,
      thumbnail: null,
      duration: null,
      media: [],
      error: 'could not download the media',
    });

    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining('stealMeme failed'),
      expect.objectContaining({
        level: 'error',
        extra: expect.objectContaining({
          url: targetUrl,
          errors: expect.arrayContaining([
            expect.objectContaining({ downloader: 'mediasnap' }),
            expect.objectContaining({ downloader: 'snapsave' }),
            expect.objectContaining({ downloader: 'nextdownloader' }),
          ]),
        }),
      })
    );
    expect(Sentry.flush).toHaveBeenCalled();
  });

  it('should return a successful result when using a real Instagram URL', async () => {
    const targetUrl = 'https://www.instagram.com/p/C51YHfWJwHK/';

    const response = await request(app.getHttpServer())
      .get(`/memes/${encodeURIComponent(targetUrl)}`)
      .expect(200);

    expect(response.body).toEqual(
      expect.objectContaining({
        success: true,
        platform: 'instagram',
        media: expect.arrayContaining([
          expect.objectContaining({
            type: expect.any(String),
            url: expect.stringContaining('http'),
          }),
        ]),
      })
    );

    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('should return a successful result when using a real Facebook URL', async () => {
    const targetUrl = 'https://www.facebook.com/share/v/1GWYmVZBUE/';

    const response = await request(app.getHttpServer())
      .get(`/memes/${encodeURIComponent(targetUrl)}`)
      .expect(200);

    expect(response.body).toEqual(
      expect.objectContaining({
        success: true,
        platform: 'facebook',
        media: expect.arrayContaining([
          expect.objectContaining({
            type: expect.any(String),
            url: expect.stringContaining('http'),
          }),
        ]),
      })
    );

    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('should filter out media items that contain relative URLs or URLs starting with /render', async () => {
    const memesService = app.get(MemesService);
    jest.spyOn(memesService, 'stealWithMediasnap').mockResolvedValue({
      success: true,
      platform: 'instagram',
      title: null,
      description: null,
      thumbnail: null,
      duration: null,
      media: [
        {
          type: 'video',
          url: '/render.php?token=123',
          quality: '1080p',
          format: 'mp4',
          sizeMB: null,
        },
        {
          type: 'video',
          url: 'https://d.rapidcdn.app/v2?token=456',
          quality: '720p',
          format: 'mp4',
          sizeMB: null,
        },
        {
          type: 'video',
          url: 'render.php?token=789',
          quality: '360p',
          format: 'mp4',
          sizeMB: null,
        },
        {
          type: 'video',
          url: '//d.rapidcdn.app/v2?token=abc',
          quality: '480p',
          format: 'mp4',
          sizeMB: null,
        },
      ],
    });
    // Ensure snapsave and nextdownloader throw errors so that mediasnap is used
    jest.spyOn(memesService, 'stealWithSnapsave').mockRejectedValue(new Error('snapsave error'));
    jest
      .spyOn(memesService, 'stealWithNextdownloader')
      .mockRejectedValue(new Error('nextdownloader error'));

    const targetUrl = 'https://www.instagram.com/p/C51YHfWJwHK/';
    const response = await request(app.getHttpServer())
      .get(`/memes/${encodeURIComponent(targetUrl)}`)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.media).toHaveLength(2);
    expect(response.body.media).toEqual([
      {
        type: 'video',
        url: 'https://d.rapidcdn.app/v2?token=456',
        quality: '720p',
        format: 'mp4',
        sizeMB: null,
      },
      {
        type: 'video',
        url: '//d.rapidcdn.app/v2?token=abc',
        quality: '480p',
        format: 'mp4',
        sizeMB: null,
      },
    ]);
  });
});
