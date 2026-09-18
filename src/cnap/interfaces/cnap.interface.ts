export interface CnapSlotDay {
  date: string;
  times: string[];
}

export interface CnapBranchResult {
  guid: string;
  name: string;
  address: string;
  available: boolean;
  slots: CnapSlotDay[];
}

export interface CnapServiceResult {
  serviceName: string;
  branches: CnapBranchResult[];
  available: boolean;
}

export interface CnapCheckResult {
  category: string;
  targetLocation: string;
  hasSlots: boolean;
  services: CnapServiceResult[];
  message: string;
}

export interface CnapCheckResponse {
  success: boolean;
  hasSlots: boolean;
  category: string;
  targetLocation: string;
  telegramQueued: boolean;
  telegramSkipReason?: string;
  message: string;
  report: string;
  data: CnapCheckResult;
}
