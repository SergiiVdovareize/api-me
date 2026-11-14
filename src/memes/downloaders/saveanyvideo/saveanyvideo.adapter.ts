import { DownloadResult } from 'mediasnap';

export interface SaveanyvideoStatusReady {
  status: 'ready';
  size?: number;
  title?: string;
  kind?: 'video' | 'photo' | 'album' | string;
  count?: number;
}

export class SaveanyvideoAdapter {
  static toDownloadResult(
    statusData: SaveanyvideoStatusReady,
    upstreamId: string,
    apiBase: string,
    platform: string
  ): DownloadResult {
    if (statusData.kind === 'album') {
      throw new Error(
        'SaveAnyVideo returned album archive, which is not supported as direct media'
      );
    }

    const isPhoto = statusData.kind === 'photo';
    const downloadUrl = `${apiBase}?action=download&id=${encodeURIComponent(upstreamId)}`;

    return {
      success: true,
      platform,
      title: statusData.title || null,
      description: null,
      thumbnail: null,
      duration: null,
      media: [
        {
          type: isPhoto ? 'image' : 'video',
          url: downloadUrl,
          quality: null,
          format: isPhoto ? 'jpg' : 'mp4',
          sizeMB:
            typeof statusData.size === 'number'
              ? Number((statusData.size / (1024 * 1024)).toFixed(2))
              : null,
        },
      ],
    };
  }
}
