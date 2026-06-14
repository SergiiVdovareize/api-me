import { DownloadResult } from 'mediasnap';

export interface MemeDownloader {
  readonly name: string;
  steal(url: string): Promise<DownloadResult>;
}
