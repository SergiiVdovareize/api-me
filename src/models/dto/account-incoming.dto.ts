export interface AccountIncomingDto {
  id: string;
  balance: number;
  trackedAt: Date;
  accountId: number;
}

export interface CreateAccountIncomingDto {
  balance: number;
  trackedAt: Date;
  accountId: number;
}

export interface UpdateAccountIncomingDto {
  balance?: number;
  trackedAt?: Date;
}
