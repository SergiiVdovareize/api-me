import { SaveanyvideoAdapter } from './saveanyvideo.adapter';

describe('SaveanyvideoAdapter', () => {
  const apiBase = 'https://saveanyvideo.top/api.php';
  const upstreamId = 'a'.repeat(64);

  it('should map video ready status to DownloadResult', () => {
    const result = SaveanyvideoAdapter.toDownloadResult(
      {
        status: 'ready',
        size: 9515158,
        title: 'Video by example',
        kind: 'video',
        count: 1,
      },
      upstreamId,
      apiBase,
      'instagram'
    );

    expect(result).toEqual({
      success: true,
      platform: 'instagram',
      title: 'Video by example',
      description: null,
      thumbnail: null,
      duration: null,
      media: [
        {
          type: 'video',
          url: `${apiBase}?action=download&id=${upstreamId}`,
          quality: null,
          format: 'mp4',
          sizeMB: 9.07,
        },
      ],
    });
  });

  it('should map photo ready status to image DownloadResult', () => {
    const result = SaveanyvideoAdapter.toDownloadResult(
      {
        status: 'ready',
        kind: 'photo',
      },
      upstreamId,
      apiBase,
      'instagram'
    );

    expect(result.media[0]).toEqual({
      type: 'image',
      url: `${apiBase}?action=download&id=${upstreamId}`,
      quality: null,
      format: 'jpg',
      sizeMB: null,
    });
  });

  it('should throw when kind is album', () => {
    expect(() =>
      SaveanyvideoAdapter.toDownloadResult(
        { status: 'ready', kind: 'album', count: 3 },
        upstreamId,
        apiBase,
        'instagram'
      )
    ).toThrow('album');
  });
});
