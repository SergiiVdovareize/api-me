import { AccountType } from '../enums/account-type.enum';

export interface AccountIncomingDto {
  id: string;
  balance: number;
  trackedAt: Date;
  accountId: string;
}

export interface CreateAccountIncomingDto {
  balance: number;
  trackedAt: Date;
  accountId: string;
}

export interface UpdateAccountIncomingDto {
  balance?: number;
  trackedAt?: Date;
}
