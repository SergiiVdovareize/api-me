import { Injectable } from '@nestjs/common';
import { CreateAccountDto } from 'src/models/dto/account.dto';
import { AccountType } from 'src/models/enums/account-type.enum';
import { PrismaService } from 'src/prisma.service';
@Injectable()
export class TrackService {
  constructor(
    private prisma: PrismaService,
  ) {}

  findAll() {
    return `This action returns all track`;
  }

  async checkMono(id: string, plain: boolean = false) {
    const response = await fetch("https://send.monobank.ua/api/handler", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        c: "hello",
        clientId: id,
        Pc: crypto.randomUUID(),
      })
    })
    
    const json = await response.json();
    if (!response.ok) {
      return {
        success: false,
        message: response.status,
      }
    }
    if (json.errCode) {
      return {
        success: false,
        message: "check the jar id",
      }
    }
    return plain ? json.jarAmount : {
      success: true,
      balance: json.jarAmount,
    }
  }

  async watch(type: AccountType, id: string) {
    const newAccount: CreateAccountDto = {
      trackId: id,
      type,
    };

    let trackingAccount = await this.prisma.account.findFirst({where: {trackId: id}})
    if (!trackingAccount) {
      trackingAccount = await this.prisma.account.create({data: newAccount})
    }

    return trackingAccount
  }

  async getActiveAccounts() {
    return await this.prisma.account.findMany({where: {isActive: true}})
  }

  async syncAccounts() {
    const accounts = await this.getActiveAccounts();

    return Promise.all(accounts.map(async (account) => {
      switch (account.type) {
        case AccountType.MONO:
          this.checkMono(account.trackId).then(res => {
            console.log('res', res)
          })
          return {};
        case AccountType.PRIVAT:
          return {
            success: false,
            message: `Type is not yet supported: ${account.type}`
          }
        default:
          return {
            success: false,
            message: `Invalid type: ${account.type}` 
          }
      }
    }))
  }
}
