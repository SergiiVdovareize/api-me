export interface TrackedSeriesItem {
  rowIndex: number;
  id: string;
  title: string;
  seasonUrl?: string;
  season1Url?: string;
  lastSeason: number;
  lastEpisode: number;
  minQuality: string;
  isActive: boolean;
  lastChecked?: string;
}

export interface UakinoSeasonInfo {
  seasonNumber: number;
  url: string;
  newsId?: string;
}

export interface UakinoCheckResult {
  latestSeason: number;
  latestEpisode: number;
  latestUrl: string;
  posterUrl?: string;
  hasConfirmedRelease: boolean;
}

export interface CheckReportItem {
  id: string;
  title: string;
  previous: { season: number; episode: number };
  current: { season: number; episode: number };
  status: 'up-to-date' | 'notified' | 'skipped' | 'error';
  url?: string;
  error?: string;
}

export interface SeriesCheckOptions {
  seriesId?: string;
  limit?: number;
  checkAll?: boolean;
}

export interface SeriesCheckSummary {
  checkedCount: number;
  totalActiveCount?: number;
  notifiedCount: number;
  timestamp: string;
  nextSeriesId?: string;
  details: CheckReportItem[];
}
