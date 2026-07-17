import { VidssaveAdapter } from './vidssave.adapter';

describe('VidssaveAdapter', () => {
  it('should extract media resources from nested data.media.resources array', () => {
    const rawData = {
      title: 'VidsSave title',
      media: [
        {
          resources: [
            {
              type: 'video',
              download_url: 'https://vids-cdn.com/hd.mp4',
              quality: '720p',
              format: 'mp4',
              size: 10485760, // 10MB
            },
          ],
        },
      ],
    };

    const result = VidssaveAdapter.toDownloadResult(rawData, 'youtube');

    expect(result.success).toBe(true);
    expect(result.platform).toBe('youtube');
    expect(result.title).toBe('VidsSave title');
    expect(result.media).toHaveLength(1);
    expect(result.media[0]).toEqual({
      type: 'video',
      url: 'https://vids-cdn.com/hd.mp4',
      quality: '720p',
      format: 'mp4',
      sizeMB: 10,
    });
  });

  it('should fall back to data.resources if media array is empty', () => {
    const rawData = {
      media: [],
      resources: [
        {
          type: 'audio',
          download_url: 'https://vids-cdn.com/sound.mp3',
          quality: '128kbps',
          format: 'mp3',
          size: 2097152, // 2MB
        },
      ],
    };

    const result = VidssaveAdapter.toDownloadResult(rawData, 'youtube');

    expect(result.media).toHaveLength(1);
    expect(result.media[0].type).toBe('audio');
    expect(result.media[0].url).toBe('https://vids-cdn.com/sound.mp3');
    expect(result.media[0].sizeMB).toBe(2);
  });

  it('should return empty media array if no download urls are found', () => {
    const rawData = {
      media: [
        {
          resources: [
            {
              type: 'video',
              quality: '720p',
            },
          ],
        },
      ],
    };

    const result = VidssaveAdapter.toDownloadResult(rawData, 'youtube');
    expect(result.media).toEqual([]);
  });
});
