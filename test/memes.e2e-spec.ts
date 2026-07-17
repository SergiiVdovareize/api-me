import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from './../src/app.module';
import * as Sentry from '@sentry/nestjs';
import { PrismaService as PrismaService1 } from 'src/prisma.service';
import { PrismaService as PrismaService2 } from 'src/models/prisma/prisma.service';
import {
  SnapsaveDownloader,
  MediasnapDownloader,
  NextDownloader,
  HighreachDownloader,
  VidssaveDownloader,
} from 'src/memes/downloaders';

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
    const mediasnapDownloader = app.get(MediasnapDownloader);
    const snapsaveDownloader = app.get(SnapsaveDownloader);
    const highreachDownloader = app.get(HighreachDownloader);
    const vidssaveDownloader = app.get(VidssaveDownloader);

    jest.spyOn(mediasnapDownloader, 'steal').mockRejectedValue(new Error('mediasnap error'));
    jest.spyOn(snapsaveDownloader, 'steal').mockRejectedValue(new Error('snapsave error'));
    jest.spyOn(highreachDownloader, 'steal').mockRejectedValue(new Error('highreach error'));
    jest.spyOn(vidssaveDownloader, 'steal').mockRejectedValue(new Error('vidssave error'));

    const response = await request(app.getHttpServer())
      .get(`/memes/${encodeURIComponent(targetUrl)}`)
      .set('referer', 'https://snip.vdovareize.me/')
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
            expect.objectContaining({ downloader: 'highreach' }),
            expect.objectContaining({ downloader: 'vidssave' }),
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
      .set('referer', 'https://snip.vdovareize.me/')
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
      .set('referer', 'https://snip.vdovareize.me/')
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
    const mediasnapDownloader = app.get(MediasnapDownloader);
    const snapsaveDownloader = app.get(SnapsaveDownloader);
    const nextDownloader = app.get(NextDownloader);
    const highreachDownloader = app.get(HighreachDownloader);
    const vidssaveDownloader = app.get(VidssaveDownloader);

    jest.spyOn(mediasnapDownloader, 'steal').mockResolvedValue({
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
    // Ensure snapsave, nextdownloader, highreach and vidssave throw errors so that mediasnap is used
    jest.spyOn(snapsaveDownloader, 'steal').mockRejectedValue(new Error('snapsave error'));
    jest.spyOn(nextDownloader, 'steal').mockRejectedValue(new Error('nextdownloader error'));
    jest.spyOn(highreachDownloader, 'steal').mockRejectedValue(new Error('highreach error'));
    jest.spyOn(vidssaveDownloader, 'steal').mockRejectedValue(new Error('vidssave error'));

    const targetUrl = 'https://www.instagram.com/p/C51YHfWJwHK/';
    const response = await request(app.getHttpServer())
      .get(`/memes/${encodeURIComponent(targetUrl)}`)
      .set('referer', 'https://snip.vdovareize.me/')
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

  it('should retry up to MAX_ATTEMPTS and succeed if a downloader succeeds on a subsequent attempt', async () => {
    const mediasnapDownloader = app.get(MediasnapDownloader);
    const snapsaveDownloader = app.get(SnapsaveDownloader);
    const highreachDownloader = app.get(HighreachDownloader);
    const vidssaveDownloader = app.get(VidssaveDownloader);

    jest.spyOn(snapsaveDownloader, 'steal').mockRejectedValue(new Error('snapsave error'));
    jest.spyOn(highreachDownloader, 'steal').mockRejectedValue(new Error('highreach error'));
    jest.spyOn(vidssaveDownloader, 'steal').mockRejectedValue(new Error('vidssave error'));

    jest
      .spyOn(mediasnapDownloader, 'steal')
      .mockRejectedValueOnce(new Error('mediasnap error attempt 1'))
      .mockResolvedValueOnce({
        success: true,
        platform: 'instagram',
        title: 'Meme',
        description: null,
        thumbnail: null,
        duration: null,
        media: [
          {
            type: 'video',
            url: 'https://example.com/media.mp4',
            quality: '1080p',
            format: 'mp4',
            sizeMB: null,
          },
        ],
      });

    const targetUrl = 'https://www.instagram.com/p/C51YHfWJwHK/';
    const response = await request(app.getHttpServer())
      .get(`/memes/${encodeURIComponent(targetUrl)}`)
      .set('referer', 'https://snip.vdovareize.me/')
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.media).toHaveLength(1);
    expect(response.body.media[0].url).toBe('https://example.com/media.mp4');

    expect(Sentry.captureMessage).not.toHaveBeenCalled();
    expect(mediasnapDownloader.steal).toHaveBeenCalledTimes(2);
  });

  it('should call all downloaders exactly MAX_ATTEMPTS times when all attempts fail', async () => {
    const mediasnapDownloader = app.get(MediasnapDownloader);
    const snapsaveDownloader = app.get(SnapsaveDownloader);
    const highreachDownloader = app.get(HighreachDownloader);
    const vidssaveDownloader = app.get(VidssaveDownloader);

    jest.spyOn(mediasnapDownloader, 'steal').mockRejectedValue(new Error('mediasnap error'));
    jest.spyOn(snapsaveDownloader, 'steal').mockRejectedValue(new Error('snapsave error'));
    jest.spyOn(highreachDownloader, 'steal').mockRejectedValue(new Error('highreach error'));
    jest.spyOn(vidssaveDownloader, 'steal').mockRejectedValue(new Error('vidssave error'));

    const targetUrl = 'https://www.instagram.com/p/C51YHfWJwHK/';
    const response = await request(app.getHttpServer())
      .get(`/memes/${encodeURIComponent(targetUrl)}`)
      .set('referer', 'https://snip.vdovareize.me/')
      .expect(200);

    expect(response.body.success).toBe(false);

    expect(mediasnapDownloader.steal).toHaveBeenCalledTimes(3);
    expect(snapsaveDownloader.steal).toHaveBeenCalledTimes(3);
    expect(highreachDownloader.steal).toHaveBeenCalledTimes(3);
    expect(vidssaveDownloader.steal).toHaveBeenCalledTimes(3);

    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining('stealMeme failed'),
      expect.any(Object)
    );
  });

  it('should correctly download using vidssave', async () => {
    const mediasnapDownloader = app.get(MediasnapDownloader);
    const snapsaveDownloader = app.get(SnapsaveDownloader);
    const highreachDownloader = app.get(HighreachDownloader);
    const vidssaveDownloader = app.get(VidssaveDownloader);

    jest.spyOn(vidssaveDownloader, 'steal').mockResolvedValue({
      success: true,
      platform: 'youtube',
      title: 'Meme Video',
      description: null,
      thumbnail: 'https://example.com/thumb.jpg',
      duration: 120,
      media: [
        {
          type: 'video',
          url: 'https://example.com/vidssave-resource.mp4',
          quality: '720p',
          format: 'mp4',
          sizeMB: 10.5,
        },
      ],
    });
    // Mock other services to fail
    jest.spyOn(mediasnapDownloader, 'steal').mockRejectedValue(new Error('mediasnap error'));
    jest.spyOn(snapsaveDownloader, 'steal').mockRejectedValue(new Error('snapsave error'));
    jest.spyOn(highreachDownloader, 'steal').mockRejectedValue(new Error('highreach error'));

    const targetUrl = 'https://www.youtube.com/watch?v=M-jtZUHWZ-o';
    const response = await request(app.getHttpServer())
      .get(`/memes/${encodeURIComponent(targetUrl)}`)
      .set('referer', 'https://snip.vdovareize.me/')
      .expect(200);

    expect(response.body).toEqual({
      success: true,
      platform: 'youtube',
      title: 'Meme Video',
      description: null,
      thumbnail: 'https://example.com/thumb.jpg',
      duration: 120,
      media: [
        {
          type: 'video',
          url: 'https://example.com/vidssave-resource.mp4',
          quality: '720p',
          format: 'mp4',
          sizeMB: 10.5,
        },
      ],
    });
  });

  it('should restrict access when request referer and origin are missing or not matching allowed site', async () => {
    const targetUrl = 'https://www.youtube.com/watch?v=M-jtZUHWZ-o';
    await request(app.getHttpServer())
      .get(`/memes/${encodeURIComponent(targetUrl)}`)
      .expect(403);

    await request(app.getHttpServer())
      .get(`/memes/${encodeURIComponent(targetUrl)}`)
      .set('referer', 'https://example.com/')
      .expect(403);
  });
});
