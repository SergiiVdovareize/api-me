import { DownloadResult } from 'mediasnap';

export interface HighreachFormat {
  type?: 'video' | 'audio' | 'image';
  url?: string;
  download_url?: string;
  quality?: string;
  ext?: string;
  format?: string;
}

export interface HighreachResponse {
  title?: string;
  description?: string;
  thumbnail?: string;
  duration?: string;
  url?: string;
  download_url?: string;
  downloadUrl?: string;
  video_url?: string;
  gif?: string;
  video?: string;
  formats?: HighreachFormat[];
  media?: HighreachFormat[];
}

export class HighreachAdapter {
  static toDownloadResult(data: HighreachResponse, platform: string): DownloadResult {
    const directUrl =
      data.url || data.download_url || data.downloadUrl || data.video_url || data.gif || data.video;
    let media: DownloadResult['media'] = [];

    if (directUrl && typeof directUrl === 'string') {
      media.push({
        type: 'video',
        url: directUrl,
        quality: null,
        format: 'mp4',
        sizeMB: null,
      });
    } else if (Array.isArray(data.formats)) {
      media = data.formats.map((format: any) => ({
        type: (format.type || 'video') as 'video' | 'audio' | 'image',
        url: format.url || format.download_url,
        quality: format.quality || null,
        format: format.ext || format.format || 'mp4',
        sizeMB: null,
      }));
    } else if (Array.isArray(data.media)) {
      media = data.media.map((item: any) => ({
        type: (item.type || 'video') as 'video' | 'audio' | 'image',
        url: item.url,
        quality: item.quality || null,
        format: item.format || 'mp4',
        sizeMB: null,
      }));
    }

    return {
      success: true,
      platform,
      title: data.title || null,
      description: data.description || null,
      thumbnail: data.thumbnail || null,
      duration: data.duration || null,
      media,
    };
  }
}
