export type StudentStatus = 'abroad' | 'family' | 'withdrawn' | 'standard' | string;

export interface StoredAutomatorData {
  studentStatuses?: Record<string, Record<string, StudentStatus>>;
  settings?: Record<string, any>;
  [key: string]: any;
}

export interface SyncGetResponse {
  userId: string;
  data: StoredAutomatorData | Record<string, any>;
  updatedAt: number | null;
}

export interface SyncPostResponse {
  success: boolean;
  updatedAt: number;
}
