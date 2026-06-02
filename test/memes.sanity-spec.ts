import * as request from 'supertest';

describe('Memes Sanity (e2e)', () => {
  const API_URL = process.env.API_URL || 'https://api.vdovareize.me';

  // Set a longer timeout because fetching real production APIs and downloading media can take time
  jest.setTimeout(30000);

  it('should successfully steal and download a meme from Instagram', async () => {
    const targetUrl = 'https://www.instagram.com/p/C51YHfWJwHK/';

    // 1. Call the real production API to steal the meme
    const response = await request(API_URL)
      .get(`/memes/${encodeURIComponent(targetUrl)}`)
      .expect(200);

    // 2. Validate the API response structure
    expect(response.body).toEqual(
      expect.objectContaining({
        success: true,
        platform: 'instagram',
        media: expect.arrayContaining([
          expect.objectContaining({
            type: expect.any(String),
            url: expect.stringContaining('http'),
          }),
        ]),
      })
    );

    // 3. Extract the media URL and download it to verify downloading works
    const mediaUrl = response.body.media[0].url;
    expect(mediaUrl).toBeDefined();

    const downloadResponse = await fetch(mediaUrl);
    expect(downloadResponse.status).toBe(200);

    const buffer = await downloadResponse.arrayBuffer();
    expect(buffer.byteLength).toBeGreaterThan(0);
  });

  it('should return error when URL is unsupported or invalid', async () => {
    const targetUrl = 'https://example.com/invalid-meme-url-12345';

    const response = await request(API_URL)
      .get(`/memes/${encodeURIComponent(targetUrl)}`)
      .expect(200);

    expect(response.body).toEqual({
      success: false,
      platform: 'unknown',
      title: null,
      description: null,
      thumbnail: null,
      duration: null,
      media: [],
      error: 'could not download the media',
    });
  });
});
