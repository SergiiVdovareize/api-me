import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from './../src/app.module';
import * as Sentry from '@sentry/nestjs';
import { PrismaService as PrismaService1 } from 'src/prisma.service';
import { PrismaService as PrismaService2 } from 'src/models/prisma/prisma.service';

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
});
