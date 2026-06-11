import {
  Controller,
  Get,
  Query,
  HttpException,
  HttpStatus,
  StreamableFile,
  Res,
} from '@nestjs/common';
import { Readable } from 'stream';
import { Response } from 'express';
import { AppService } from './app.service';
import { AnalyticsService } from './analytics/analytics.service';
@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly analyticsService: AnalyticsService
  ) {}

  @Get()
  async getHello(): Promise<string> {
    // this.analyticsService.trackEvent(AnalyticsEvent.HelloApi);
    return this.appService.getHello();
  }

  @Get('test')
  async test(@Query('v') v: string) {
    console.log('test', v);
    return {
      success: true,
    };
  }

  @Get('download')
  async download(
    @Query('url') url: string,
    @Res({ passthrough: true }) res: Response,
    @Query('filename') filename?: string
  ): Promise<StreamableFile | void> {
    if (!url) {
      throw new HttpException('Missing url parameter', HttpStatus.BAD_REQUEST);
    }

    // Direct redirect for known IP-bound CDNs (googlevideo/youtube) to bypass server IP limitations
    if (
      url.includes('googlevideo.com') ||
      url.includes('youtube.com') ||
      url.includes('youtu.be')
    ) {
      return res.redirect(url);
    }

    try {
      const response = await fetch(url);
      if (!response.ok) {
        // Fallback: If target CDN returns 403 Forbidden or 401 Unauthorized, redirect the browser to the URL directly
        if (
          response.status === HttpStatus.FORBIDDEN ||
          response.status === HttpStatus.UNAUTHORIZED
        ) {
          return res.redirect(url);
        }
        throw new HttpException(`Failed to fetch media: ${response.statusText}`, response.status);
      }

      if (!response.body) {
        throw new HttpException(
          'No response body received from media server',
          HttpStatus.INTERNAL_SERVER_ERROR
        );
      }

      const nodeReadable = Readable.fromWeb(response.body as any);
      const contentLength = response.headers.get('content-length');
      const contentType = response.headers.get('content-type') || 'application/octet-stream';

      const extensionMap: Record<string, string> = {
        'video/mp4': 'mp4',
        'video/webm': 'webm',
        'video/ogg': 'ogg',
        'video/quicktime': 'mov',
        'audio/mpeg': 'mp3',
        'audio/mp3': 'mp3',
        'audio/ogg': 'mp3',
        'audio/wav': 'wav',
        'audio/webm': 'webm',
        'audio/x-m4a': 'm4a',
        'audio/m4a': 'm4a',
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/gif': 'gif',
        'image/webp': 'webp',
      };

      let ext = 'mp4';
      let mediaType = 'video';
      if (contentType.startsWith('audio/')) {
        ext = 'mp3';
        mediaType = 'audio';
      } else if (contentType.startsWith('image/')) {
        ext = 'jpg';
        mediaType = 'image';
      }

      const contentTypeBase = contentType.split(';')[0].trim().toLowerCase();
      if (extensionMap[contentTypeBase]) {
        ext = extensionMap[contentTypeBase];
      } else {
        try {
          const urlObj = new URL(url);
          const pathExt = urlObj.pathname.split('.').pop();
          if (pathExt && /^[a-zA-Z0-9]{2,4}$/.test(pathExt)) {
            ext = pathExt.toLowerCase();
          }
        } catch {
          // ignore parsing error
        }
      }

      let finalFilename = filename;
      if (!finalFilename) {
        const alphanumId = Math.random().toString(36).concat('00000000').slice(2, 10);
        finalFilename = `${mediaType}_${alphanumId}.${ext}`;
      }

      return new StreamableFile(nodeReadable, {
        type: contentType,
        disposition: `attachment; filename="${encodeURIComponent(finalFilename)}"`,
        length: contentLength ? parseInt(contentLength, 10) : undefined,
      });
    } catch (error: any) {
      console.error('Error proxying download:', error.message);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException('Failed to download resource', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  // @Get('/debug-sentry')
  // getError() {
  //   throw new Error('My first Sentry error!');
  // }
}
