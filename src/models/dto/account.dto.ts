import { AccountType } from '../enums/account-type.enum';

export interface CreateAccountDto {
  trackId: string;
  type: AccountType;
  description?: string;
}

export interface UpdateAccountDto {
  isActive?: boolean;
  type?: AccountType;
  description?: string;
}

export interface AccountDto {
  id: number;
  createdAt: Date;
  isActive: boolean;
  trackId: string;
  type: AccountType;
  description?: string;
}

export interface DeactivateAccountDto {
  isActive: false;
}
