export enum JarStatus {
  ACTIVE = 'ACTIVE',
  /** @public */
  CLOSED = 'CLOSED',
}

export type JarResponse = {
  success: boolean;
  message?: string;
  balance?: number;
  goal?: number;
  status?: JarStatus;
  title?: string;
  ownerName?: string;
  extra?: string;
};
