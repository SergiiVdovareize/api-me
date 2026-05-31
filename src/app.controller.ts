import { Controller, Get, Query, HttpException, HttpStatus, StreamableFile } from '@nestjs/common';
import { Readable } from 'stream';
import { AppService } from './app.service';
import { AnalyticsService } from './analytics/analytics.service';
@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly analyticsService: AnalyticsService
  ) { }

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
    @Query('filename') filename: string,
  ): Promise<StreamableFile> {
    if (!url || !filename) {
      throw new HttpException('Missing url or filename parameter', HttpStatus.BAD_REQUEST);
    }

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new HttpException(`Failed to fetch media: ${response.statusText}`, response.status);
      }

      if (!response.body) {
        throw new HttpException('No response body received from media server', HttpStatus.INTERNAL_SERVER_ERROR);
      }

      const nodeReadable = Readable.fromWeb(response.body as any);
      const contentLength = response.headers.get('content-length');

      return new StreamableFile(nodeReadable, {
        type: response.headers.get('content-type') || 'application/octet-stream',
        disposition: `attachment; filename="${encodeURIComponent(filename)}"`,
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
