export enum MemeType {
  YOUTUBE = 'youtube',
  INSTAGRAM = 'instagram',
  TWITTER = 'twitter',
  FACEBOOK = 'facebook',
  TIKTOK = 'tiktok',
  LINKEDIN = 'linkedin',
  UNKNOWN = 'unknown',
  THREADS = 'threads',
}

export function getMemeTypeFromUrl(url: string): MemeType {
  if (url.includes('youtube.com') || url.includes('youtu.be')) return MemeType.YOUTUBE;
  if (url.includes('instagram.com')) return MemeType.INSTAGRAM;
  if (url.includes('x.com') || url.includes('twitter.com')) return MemeType.TWITTER;
  if (url.includes('facebook.com') || url.includes('fb.watch')) return MemeType.FACEBOOK;
  if (url.includes('tiktok.com')) return MemeType.TIKTOK;
  if (url.includes('linkedin.com')) return MemeType.LINKEDIN;
  if (url.includes('threads.com')) return MemeType.THREADS;
  return MemeType.UNKNOWN;
}
