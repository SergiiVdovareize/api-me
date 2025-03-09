import { Injectable } from '@nestjs/common';
import { CreateAccountDto } from 'src/models/dto/account.dto';
import { AccountType } from 'src/models/enums/account-type.enum';
import { PrismaService } from 'src/prisma.service';
import { JarResponse, JarStatus } from './types';
@Injectable()
export class TrackService {
  constructor(
    private prisma: PrismaService,
  ) {}

  findAll() {
    return `This action returns all track`;
  }

  async checkMono(id: string, plain: boolean = false): Promise<JarResponse> {
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
        message: response.status.toString(),
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
      status: json.jarStatus,
    }
  }

  isJarActiveStatus(json: JarResponse) {
    return json.status && json.status === JarStatus.ACTIVE
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

  async getActiveAccountIncomings() {
    return await this.prisma.account.findMany({
      where: { isActive: true },
      include: {
        accountIncomings: {
          take: 1, // Get only the most recent record
          orderBy: { trackedAt: 'desc' }, // Sort by the latest trackedAt date
        },
      },
    });
  }
  
  async syncAccounts() {
    const accounts = await this.getActiveAccountIncomings()

    console.log('found active accounts:', accounts.length)
    return Promise.all(accounts.map(async (account) => {
      switch (account.type) {
        case AccountType.MONO:
          this.checkMono(account.trackId).then((response: JarResponse) => {
            if (this.isJarActiveStatus(response)) {
              if (response.balance !== account.accountIncomings?.[0]?.balance) {
                this.prisma.accountIncoming.create({
                  data: {
                    accountId: account.id,
                    balance: response.balance,
                    trackedAt: new Date(),
                  }
                }).then((inc) => {console.log('incoming added', inc.balance)})
              } else {
                console.log('balance did not change')
              }
            }
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
