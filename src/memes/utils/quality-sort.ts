export function sortMediaByQuality<T extends { quality?: string | null }>(media: T[]): T[] {
  return media.sort((a, b) => {
    const getQualityNum = (q: string | null | undefined): number => {
      if (!q) return 0;
      const cleanQ = q.replace(/mp4|mp3|m4a|3gp/gi, '');
      const match = cleanQ.match(/\d+/);
      return match ? parseInt(match[0], 10) : 0;
    };
    return getQualityNum(b.quality) - getQualityNum(a.quality);
  });
}
