import { DownloadResult } from 'mediasnap';

export class MediasnapAdapter {
  static toDownloadResult(result: any): DownloadResult {
    return {
      success: !!result?.success,
      platform: result?.platform || 'unknown',
      title: result?.title || null,
      description: result?.description || null,
      thumbnail: result?.thumbnail || null,
      duration: result?.duration || null,
      media: Array.isArray(result?.media)
        ? result.media.map((item: any) => ({
            type: item.type || 'video',
            url: item.url,
            quality: item.quality || null,
            format: item.format || 'mp4',
            sizeMB: item.sizeMB || null,
          }))
        : [],
      error: result?.error,
    };
  }
}
