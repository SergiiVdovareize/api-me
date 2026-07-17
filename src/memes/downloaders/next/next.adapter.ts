import { DownloadResult } from 'mediasnap';

export interface NextDownloaderFormat {
  ext?: string;
  quality?: string;
}

export interface NextDownloaderAnalyzeResponse {
  title?: string;
  description?: string;
  thumbnail?: string;
  duration?: string;
  formats?: NextDownloaderFormat[];
}

export class NextDownloaderAdapter {
  static toDownloadResult(
    data: NextDownloaderAnalyzeResponse,
    url: string,
    host: string,
    platform: string
  ): DownloadResult {
    const title = data.title || 'video';
    const duration = data.duration || '';
    const media: DownloadResult['media'] = (data.formats || []).map(format => {
      const isAudio = ['mp3', 'm4a', 'aac', 'flac', 'opus', 'wav'].includes(
        format.ext?.toLowerCase() || ''
      );
      const type: 'audio' | 'video' = isAudio ? 'audio' : 'video';
      const quality = format.quality || null;
      const formatExt = format.ext || 'mp4';

      const proxyUrl = `${host}/memes/download/next?url=${encodeURIComponent(url)}&type=${type}&quality=${encodeURIComponent(quality || '')}&ext=${formatExt}&title=${encodeURIComponent(title)}&duration=${encodeURIComponent(duration)}`;

      return {
        type,
        url: proxyUrl,
        quality,
        format: formatExt,
        sizeMB: null,
      };
    });

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
