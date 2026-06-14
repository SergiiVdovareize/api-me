import { Test } from '@nestjs/testing';
import { MemesService } from './memes.service';
import {
  SnapsaveDownloader,
  MediasnapDownloader,
  NextDownloader,
  HighreachDownloader,
  VidssaveDownloader,
} from './downloaders';
import { sortMediaByQuality } from './utils/quality-sort';

describe('MemesService', () => {
  beforeEach(async () => {
    await Test.createTestingModule({
      providers: [
        MemesService,
        {
          provide: SnapsaveDownloader,
          useValue: {},
        },
        {
          provide: MediasnapDownloader,
          useValue: {},
        },
        {
          provide: NextDownloader,
          useValue: {},
        },
        {
          provide: HighreachDownloader,
          useValue: {},
        },
        {
          provide: VidssaveDownloader,
          useValue: {},
        },
      ],
    }).compile();
  });

  describe('sortMediaByQuality', () => {
    it('should sort media items by quality descending with best quality first', () => {
      const media = [
        { url: 'url1', quality: '360p' },
        { url: 'url2', quality: '1080P' },
        { url: 'url3', quality: '720p' },
        { url: 'url4', quality: null },
        { url: 'url5', quality: '480' },
      ];

      const sorted = sortMediaByQuality(media);

      expect(sorted).toEqual([
        { url: 'url2', quality: '1080P' },
        { url: 'url3', quality: '720p' },
        { url: 'url5', quality: '480' },
        { url: 'url1', quality: '360p' },
        { url: 'url4', quality: null },
      ]);
    });

    it('should handle qualities without numeric values or empty qualities gracefully', () => {
      const media = [
        { url: 'url1', quality: 'low' },
        { url: 'url2', quality: 'high-128kbps' },
        { url: 'url3', quality: 'mid-256kbps' },
        { url: 'url4', quality: undefined },
      ];

      const sorted = sortMediaByQuality(media as any);

      expect(sorted).toEqual([
        { url: 'url3', quality: 'mid-256kbps' },
        { url: 'url2', quality: 'high-128kbps' },
        { url: 'url1', quality: 'low' },
        { url: 'url4', quality: undefined },
      ]);
    });

    it('should correctly ignore format name digits (e.g. mp4, m4a, 3gp) when sorting', () => {
      const media = [
        { url: 'url1', quality: 'mp4 (360p)' },
        { url: 'url2', quality: 'mp4 (1080p)' },
        { url: 'url3', quality: 'm4a (50kb/s)' },
        { url: 'url4', quality: 'opus (128kb/s)' },
        { url: 'url5', quality: 'mp4 (720p)' },
      ];

      const sorted = sortMediaByQuality(media);

      expect(sorted).toEqual([
        { url: 'url2', quality: 'mp4 (1080p)' },
        { url: 'url5', quality: 'mp4 (720p)' },
        { url: 'url1', quality: 'mp4 (360p)' },
        { url: 'url4', quality: 'opus (128kb/s)' },
        { url: 'url3', quality: 'm4a (50kb/s)' },
      ]);
    });

    it('should correctly sort the exact user response example payload by quality', () => {
      const media = [
        { type: 'video', url: 'url-360p-1', quality: 'mp4 (360p)', format: 'mp4', sizeMB: null },
        { type: 'video', url: 'url-1080p', quality: 'mp4 (1080p)', format: 'mp4', sizeMB: null },
        { type: 'video', url: 'url-720p', quality: 'mp4 (720p)', format: 'mp4', sizeMB: null },
        { type: 'video', url: 'url-360p-2', quality: 'mp4 (360p)', format: 'mp4', sizeMB: null },
        { type: 'video', url: 'url-144p', quality: 'mp4 (144p)', format: 'mp4', sizeMB: null },
        { type: 'video', url: 'url-50kb', quality: 'm4a (50kb/s)', format: 'mp4', sizeMB: null },
        { type: 'video', url: 'url-131kb', quality: 'm4a (131kb/s)', format: 'mp4', sizeMB: null },
        { type: 'video', url: 'url-128kb', quality: 'opus (128kb/s)', format: 'mp4', sizeMB: null },
      ];

      const sorted = sortMediaByQuality(media);

      expect(sorted).toEqual([
        { type: 'video', url: 'url-1080p', quality: 'mp4 (1080p)', format: 'mp4', sizeMB: null },
        { type: 'video', url: 'url-720p', quality: 'mp4 (720p)', format: 'mp4', sizeMB: null },
        { type: 'video', url: 'url-360p-1', quality: 'mp4 (360p)', format: 'mp4', sizeMB: null },
        { type: 'video', url: 'url-360p-2', quality: 'mp4 (360p)', format: 'mp4', sizeMB: null },
        { type: 'video', url: 'url-144p', quality: 'mp4 (144p)', format: 'mp4', sizeMB: null },
        { type: 'video', url: 'url-131kb', quality: 'm4a (131kb/s)', format: 'mp4', sizeMB: null },
        { type: 'video', url: 'url-128kb', quality: 'opus (128kb/s)', format: 'mp4', sizeMB: null },
        { type: 'video', url: 'url-50kb', quality: 'm4a (50kb/s)', format: 'mp4', sizeMB: null },
      ]);
    });
  });
});
