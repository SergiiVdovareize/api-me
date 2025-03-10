import { Injectable } from '@nestjs/common';
import { AccountType } from 'src/models/enums/account-type.enum';
import { PrismaService } from 'src/prisma.service';
import { JarResponse, JarStatus } from './types';

const tenDaysAgo = new Date();
tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);

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
      title: json.name,
      balance: json.jarAmount,
      status: json.jarStatus,
    }
  }

  isJarActiveStatus(json: JarResponse) {
    return json.status && json.status === JarStatus.ACTIVE
  }

  async watch(type: AccountType, id: string) {
    let trackingAccount = await this.prisma.account.findFirst({where: {trackId: id}})
    if (trackingAccount) {
      return trackingAccount
    }

    const jar = await this.checkMono(id)
    if (!jar.success) {
      return jar
    }
    
    trackingAccount = await this.prisma.account.create({data: {
      trackId: id,
      type,
    }})
  }

  async getActiveAccounts() {
    return await this.prisma.account.findMany({where: {isActive: true}})
  }

  async getActiveAccountIncomings() {
    return await this.prisma.account.findMany({
      where: { isActive: true },
      include: {
        accountIncomings: {
          take: 1,
          orderBy: { trackedAt: 'desc' },
        },
      },
    });
  }
  
  async syncAccounts() {
    const accounts = await this.getActiveAccountIncomings()

    await Promise.all(accounts.map(async (account) => {
      if (this.isAccountOld(account)) {
        console.log(`inactivating old account: ${account.trackId}`);
        await this.inactivateAccount(account.id);
        return;
      }

      switch (account.type) {
        case AccountType.MONO:
          const response = await this.checkMono(account.trackId);
          if (this.isJarActiveStatus(response)) {
            if (response.balance !== account.accountIncomings?.[0]?.balance) {
              const incoming = await this.prisma.accountIncoming.create({
                data: {
                  accountId: account.id,
                  balance: response.balance,
                  trackedAt: new Date(),
                }
              });
              console.log(`updated balance: ${response.title} - ${incoming.balance}`);
            }
          }
          break;
        case AccountType.PRIVAT:
          console.log({
            success: false,
            message: `Type is not yet supported: ${account.type}`
          });
          break;
        default:
          console.log({
            success: false,
            message: `Invalid type: ${account.type}`
          });
          break;
      }
    }));
  }

  isAccountOld(account) {
    return account?.createdAt < tenDaysAgo;
  }

  async inactivateAccount(id: number) {
    this.prisma.account.update({
      where: { id },
      data: { isActive: false },
    });
  }

}
