import { MediasnapAdapter } from './mediasnap.adapter';

describe('MediasnapAdapter', () => {
  it('should map raw mediasnap result correctly', () => {
    const rawResult = {
      success: true,
      platform: 'facebook',
      title: 'Nice FB video',
      description: null,
      thumbnail: 'https://fbcdn.net/t.jpg',
      duration: 60,
      media: [
        {
          type: 'video',
          url: 'https://fbcdn.net/v.mp4',
          quality: 'hd',
          format: 'mp4',
          sizeMB: 12.5,
        },
      ],
    };

    const result = MediasnapAdapter.toDownloadResult(rawResult);

    expect(result).toEqual({
      success: true,
      platform: 'facebook',
      title: 'Nice FB video',
      description: null,
      thumbnail: 'https://fbcdn.net/t.jpg',
      duration: 60,
      media: [
        {
          type: 'video',
          url: 'https://fbcdn.net/v.mp4',
          quality: 'hd',
          format: 'mp4',
          sizeMB: 12.5,
        },
      ],
      error: undefined,
    });
  });

  it('should fall back to defaults for empty inputs', () => {
    const result = MediasnapAdapter.toDownloadResult({});
    expect(result.success).toBe(false);
    expect(result.platform).toBe('unknown');
    expect(result.media).toEqual([]);
  });
});
