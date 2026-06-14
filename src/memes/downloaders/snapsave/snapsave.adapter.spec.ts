import { SnapsaveAdapter } from './snapsave.adapter';

describe('SnapsaveAdapter', () => {
  it('should successfully map a raw snapsave result to DownloadResult', () => {
    const rawResult = {
      success: true,
      platform: 'instagram',
      title: 'Cool video',
      description: 'Meme description',
      thumbnail: 'https://example.com/thumb.jpg',
      duration: '15',
      media: [
        {
          type: 'video',
          url: 'https://example.com/video.mp4',
          quality: '720p',
          format: 'mp4',
          sizeMB: 5.4,
        },
      ],
    };

    const result = SnapsaveAdapter.toDownloadResult(rawResult);

    expect(result).toEqual({
      success: true,
      platform: 'instagram',
      title: 'Cool video',
      description: 'Meme description',
      thumbnail: 'https://example.com/thumb.jpg',
      duration: '15',
      media: [
        {
          type: 'video',
          url: 'https://example.com/video.mp4',
          quality: '720p',
          format: 'mp4',
          sizeMB: 5.4,
        },
      ],
      error: undefined,
    });
  });

  it('should handle undefined or null input fields gracefully with defaults', () => {
    const result = SnapsaveAdapter.toDownloadResult(null);

    expect(result).toEqual({
      success: false,
      platform: 'unknown',
      title: null,
      description: null,
      thumbnail: null,
      duration: null,
      media: [],
      error: undefined,
    });
  });
});
