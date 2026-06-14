import { HighreachAdapter } from './highreach.adapter';

describe('HighreachAdapter', () => {
  it('should map a single direct URL string into a default mp4 video format', () => {
    const rawData = {
      title: 'Short GIF',
      video_url: 'https://highreach-cdn.com/direct.mp4',
    };

    const result = HighreachAdapter.toDownloadResult(rawData, 'twitter');

    expect(result.success).toBe(true);
    expect(result.platform).toBe('twitter');
    expect(result.title).toBe('Short GIF');
    expect(result.media).toEqual([
      {
        type: 'video',
        url: 'https://highreach-cdn.com/direct.mp4',
        quality: null,
        format: 'mp4',
        sizeMB: null,
      },
    ]);
  });

  it('should map an array of formats correctly', () => {
    const rawData = {
      title: 'Multiple resolutions',
      formats: [
        {
          type: 'video' as const,
          url: 'https://highreach-cdn.com/720.mp4',
          quality: '720p',
          ext: 'mp4',
        },
      ],
    };

    const result = HighreachAdapter.toDownloadResult(rawData, 'twitter');

    expect(result.media).toEqual([
      {
        type: 'video',
        url: 'https://highreach-cdn.com/720.mp4',
        quality: '720p',
        format: 'mp4',
        sizeMB: null,
      },
    ]);
  });

  it('should map from data.media array correctly', () => {
    const rawData = {
      media: [
        {
          type: 'video' as const,
          url: 'https://highreach-cdn.com/1080.mp4',
          quality: '1080p',
          format: 'mp4',
        },
      ],
    };

    const result = HighreachAdapter.toDownloadResult(rawData, 'twitter');

    expect(result.media).toEqual([
      {
        type: 'video',
        url: 'https://highreach-cdn.com/1080.mp4',
        quality: '1080p',
        format: 'mp4',
        sizeMB: null,
      },
    ]);
  });

  it('should fallback cleanly on empty data', () => {
    const result = HighreachAdapter.toDownloadResult({}, 'twitter');
    expect(result.media).toEqual([]);
  });
});
