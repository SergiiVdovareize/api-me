import { DownloadResult } from 'mediasnap';

export interface VidssaveResource {
  type?: string;
  download_url?: string;
  quality?: string;
  format?: string;
  size?: number;
}

export interface VidssaveMediaItem {
  resources?: VidssaveResource[];
}

export interface VidssaveParseData {
  title?: string;
  description?: string;
  thumbnail?: string;
  duration?: string;
  media?: VidssaveMediaItem[];
  resources?: VidssaveResource[];
}

export interface VidssaveParseResponse {
  status?: number;
  message?: string;
  data?: VidssaveParseData;
}

export class VidssaveAdapter {
  static toDownloadResult(data: VidssaveParseData, platform: string): DownloadResult {
    const mediaList: DownloadResult['media'] = [];
    if (Array.isArray(data.media)) {
      for (const item of data.media) {
        if (item && Array.isArray(item.resources)) {
          for (const res of item.resources) {
            if (res && res.download_url) {
              const isAudio =
                res.type === 'audio' ||
                ['mp3', 'm4a', 'aac', 'flac', 'opus', 'wav'].includes(res.format?.toLowerCase());
              mediaList.push({
                type: (isAudio ? 'audio' : 'video') as 'audio' | 'video',
                url: res.download_url,
                quality: res.quality || null,
                format: res.format?.toLowerCase() || null,
                sizeMB: res.size ? Number((res.size / (1024 * 1024)).toFixed(2)) : null,
              });
            }
          }
        }
      }
    }

    if (mediaList.length === 0 && Array.isArray(data.resources)) {
      for (const res of data.resources) {
        if (res && res.download_url) {
          const isAudio =
            res.type === 'audio' ||
            ['mp3', 'm4a', 'aac', 'flac', 'opus', 'wav'].includes(res.format?.toLowerCase());
          mediaList.push({
            type: (isAudio ? 'audio' : 'video') as 'audio' | 'video',
            url: res.download_url,
            quality: res.quality || null,
            format: res.format?.toLowerCase() || null,
            sizeMB: res.size ? Number((res.size / (1024 * 1024)).toFixed(2)) : null,
          });
        }
      }
    }

    return {
      success: true,
      platform,
      title: data.title || null,
      description: data.description || null,
      thumbnail: data.thumbnail || null,
      duration: data.duration || null,
      media: mediaList,
    };
  }
}
