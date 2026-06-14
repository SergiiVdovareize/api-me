import { NextDownloaderAdapter } from './next.adapter';

describe('NextDownloaderAdapter', () => {
  it('should format NextDownloader raw response into DownloadResult with proxy URLs', () => {
    const rawData = {
      title: 'Awesome Song',
      description: 'Music video',
      thumbnail: 'https://img.youtube.com/vi/123.jpg',
      duration: '03:45',
      formats: [
        {
          ext: 'mp3',
          quality: '320kbps',
        },
        {
          ext: 'mp4',
          quality: '1080p',
        },
      ],
    };

    const host = 'http://localhost:3000';
    const targetUrl = 'https://youtube.com/watch?v=123';
    const result = NextDownloaderAdapter.toDownloadResult(rawData, targetUrl, host, 'youtube');

    expect(result.success).toBe(true);
    expect(result.platform).toBe('youtube');
    expect(result.title).toBe('Awesome Song');
    expect(result.duration).toBe('03:45');
    expect(result.media).toHaveLength(2);

    // Verify proxy URLs construction and type mapping
    expect(result.media[0]).toEqual({
      type: 'audio',
      url: 'http://localhost:3000/memes/download/next?url=https%3A%2F%2Fyoutube.com%2Fwatch%3Fv%3D123&type=audio&quality=320kbps&ext=mp3&title=Awesome%20Song&duration=03%3A45',
      quality: '320kbps',
      format: 'mp3',
      sizeMB: null,
    });

    expect(result.media[1]).toEqual({
      type: 'video',
      url: 'http://localhost:3000/memes/download/next?url=https%3A%2F%2Fyoutube.com%2Fwatch%3Fv%3D123&type=video&quality=1080p&ext=mp4&title=Awesome%20Song&duration=03%3A45',
      quality: '1080p',
      format: 'mp4',
      sizeMB: null,
    });
  });

  it('should map empty formats array correctly', () => {
    const result = NextDownloaderAdapter.toDownloadResult(
      {},
      'https://youtube.com/watch?v=123',
      'http://localhost:3000',
      'youtube'
    );
    expect(result.media).toEqual([]);
  });
});
