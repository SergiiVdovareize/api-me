import * as Sentry from '@sentry/nestjs';
import { env } from 'process';
import { Injectable } from '@nestjs/common';
import { AccountType } from 'src/models/enums/account-type.enum';
import { PrismaService } from 'src/prisma.service';
import { JarResponse, JarStatus } from './types';
import { AnalyticsService } from 'src/analytics/analytics.service';
import { promises as fs } from 'fs';
import { AnalyticsEvent } from 'src/analytics/analytics.events';
import { RedisReader } from 'src/common/helpers/redisReader';

const cacheStorageEnabled = true;

const CACHE_KEYS = {
  activeAccounts: `${env.HOST}-active-track-accounts`,
  recentIncoming: `${env.HOST}-recent-incoming`,
};

@Injectable()
export class TrackService {
  get useCacheStorage(): boolean {
    return cacheStorageEnabled;
    // if (!cacheStorageEnabled) {
    //   return false;
    // }
    // const currentDay = new Date().getDate();
    // return currentDay % 3 !== 0;
  }

  constructor(
    private prisma: PrismaService,
    private readonly analyticsService: AnalyticsService,
    private readonly redisReader: RedisReader
  ) {}

  findAll() {
    return `This action returns all track`;
  }

  async invalidateCachedActiveAccounts() {
    if (!this.useCacheStorage) {
      return;
    }
    console.log('invalidating cached active accounts');
    this.redisReader.delete(CACHE_KEYS.activeAccounts);
  }

  async invalidateCacheRecentIncoming(accountId: number) {
    if (!this.useCacheStorage) {
      return;
    }
    console.log('invalidating cached recent incoming', accountId);
    this.redisReader.delete(`${CACHE_KEYS.recentIncoming}-${accountId}`);
  }

  wasTwoWeeksAgo(date: Date) {
    if (!date) {
      return false;
    }

    const twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
    return date < twoWeeksAgo;
  }

  wasOneMonthAgo(date: Date) {
    if (!date) {
      return false;
    }

    const oneMonthAgo = new Date();
    oneMonthAgo.setDate(oneMonthAgo.getDate() - 30);
    return date < oneMonthAgo;
  }

  // async checkPrivat(id: string, plain: boolean = false) {
  //   const url = new URL('https://next.privat24.ua/api/p24/init');
  //   const timestamp = Date.now().toString();
  //   url.searchParams.append('lang', 'ua');
  //   url.searchParams.append('_', timestamp);

  //   const resp = await fetch(url.toString(), {
  //     method: 'POST',
  //     headers: {
  //       'Content-Type': 'application/json',
  //     },
  //     body: JSON.stringify({}), // Add your request payload if needed
  //   });

  //   const json = await resp.json();
  //   const xref = json.data.xref;
  //   console.log(xref);

  //   const url2 = `https://next.privat24.ua/api/p24/pub/basket/get?xref=${xref}`;
  //   const resp2 = await fetch(url2);
  //   const json2 = await resp2.json();
  //   console.log('json2', json2);

  //   // const url2_1 = 'https://next.privat24.ua/api/p24/pub/ziplink'
  //   // const resp2_1 = await fetch(url2_1, {
  //   //   method: "POST",
  //   //   headers: {
  //   //     "Content-Type": "application/json",
  //   //   },
  //   //   body: JSON.stringify({
  //   //     _: timestamp,
  //   //     xref,
  //   //     action: 'get',
  //   //     type: 'sharing',
  //   //     hash: 'g289x',
  //   //   }),
  //   // })

  //   // const json2_1 = await resp2_1.json()
  //   // console.log('json2_1', json2_1)

  //   // const url3 = 'https://next.privat24.ua/api/p24/pub/envelopes/pubinfo'
  //   // const resp3 = await fetch(url3, {
  //   //   method: "POST",
  //   //   headers: {
  //   //     "Content-Type": "application/json",
  //   //   },
  //   //   body: JSON.stringify({
  //   //     _: timestamp,
  //   //     xref
  //   //   }),
  //   // })

  //   // const json3 = await resp3.json()
  //   // console.log('json3', json3)
  // }

  async checkMono(id: string, plain: boolean = false): Promise<JarResponse> {
    const response = await fetch('https://send.monobank.ua/api/handler', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        c: 'hello',
        clientId: id,
        Pc: crypto.randomUUID(),
      }),
    });

    let json;
    try {
      json = await response.json();
    } catch (error) {
      // console.log('Error parsing JSON response:', error);
      console.error('Error parsing JSON response:', error);
      const html = await response.text();
      console.error('Check HTML:', html);

      return {
        success: false,
        message: 'error parsing json',
      };
    }

    if (!response.ok) {
      return {
        success: false,
        message: response.status.toString(),
      };
    }
    if (json.errCode) {
      return {
        success: false,
        message: 'check the jar id',
      };
    }
    return plain
      ? json.jarAmount
      : {
          success: true,
          title: json.name,
          balance: json.jarAmount,
          goal: json.jarGoal,
          status: json.jarStatus,
          ownerName: json.ownerName,
        };
  }

  isJarActiveStatus(json: JarResponse) {
    return json.status && json.status === JarStatus.ACTIVE;
  }

  async watch(type: AccountType, id: string, force: boolean = false) {
    const jar = await this.checkMono(id);
    if (!jar.success) {
      return jar;
    }

    let trackingAccount = await this.prisma.account.findFirst({ where: { trackId: id } });
    if (trackingAccount) {
      if (!trackingAccount.isActive && force) {
        console.log(`reactivating old account: ${trackingAccount.trackId}`);
        await this.activateAccount(trackingAccount.id);
      }
      const incoming = await this.prisma.accountIncoming.findMany({
        where: { accountId: trackingAccount.id },
        orderBy: { trackedAt: 'desc' },
        take: 30,
      });
      return {
        account: trackingAccount,
        jar,
        incoming,
      };
    }

    trackingAccount = await this.prisma.account.create({
      data: {
        trackId: id,
        type,
      },
    });

    await this.invalidateCachedActiveAccounts();

    return {
      account: trackingAccount,
      jar,
      incoming: [],
    };
  }

  async getActiveAccounts() {
    return await this.prisma.account.findMany({ where: { isActive: true } });
  }

  async getActiveAccountIncomings() {
    if (this.useCacheStorage) {
      const cachedActiveAccounts = await this.redisReader.read(CACHE_KEYS.activeAccounts);
      if (cachedActiveAccounts) {
        // console.log('CACHE: read active accounts');
        return cachedActiveAccounts;
      }
    }

    const activeAccounts = await this.prisma.account.findMany({
      where: { isActive: true },
      include: {
        accountIncomings: {
          take: 1,
          orderBy: { trackedAt: 'desc' },
        },
      },
    });

    if (this.useCacheStorage) {
      this.redisReader.write(CACHE_KEYS.activeAccounts, activeAccounts);
      console.log('DB: read active accounts and updated cache');
    }

    return activeAccounts;
  }

  async refreshAccounts() {
    const accounts = await this.getActiveAccountIncomings();
    if (accounts.length == 0) {
      console.log('no active accounts were found');
      return;
    }
    let deactivatedAccounts = 0;
    await Promise.all(
      accounts.map(async account => {
        if (this.isAccountOld(account)) {
          console.log(`deactivating old account: ${account.trackId}`);
          await this.deactivateAccount(account.id);
          this.analyticsService.trackEvent(AnalyticsEvent.TrackingAccountDeactivated, { account });
          deactivatedAccounts++;
          return;
        }
      })
    );
    if (deactivatedAccounts > 0) {
      console.log('deactivated accounts:', deactivatedAccounts);
    } else {
      console.log('non of accounts was deactivated');
    }
  }

  async syncAccounts() {
    const accounts = await this.getActiveAccountIncomings();

    await Promise.all(
      accounts.map(async account => {
        switch (account.type) {
          case AccountType.MONO:
            const response = await this.checkMono(account.trackId);
            if (this.isJarActiveStatus(response)) {
              const balance = response.balance || 0;
              // if (!balance) {
              //   console.log(`no balance: ${account.id} - ${response.balance}`);
              //   return;
              // }

              let needUpdateIncoming = false;
              if (this.useCacheStorage) {
                const recentIncoming = await this.getRecentAccountIncoming(account.id);
                needUpdateIncoming = !recentIncoming || balance !== recentIncoming.balance;
              } else {
                needUpdateIncoming = balance !== account.accountIncomings?.[0]?.balance;
              }

              if (needUpdateIncoming) {
                try {
                  const incoming = await this.prisma.accountIncoming.create({
                    data: {
                      accountId: account.id,
                      balance: balance,
                      trackedAt: new Date(),
                    },
                  });

                  this.invalidateCacheRecentIncoming(account.id);
                  console.log(
                    `updated balance: ${response.title} (${account.trackId}) - ${incoming.balance} (added ${Math.ceil((incoming.balance - account.accountIncomings?.[0]?.balance) / 100)})`
                  );
                } catch (error) {
                  const errorMsg = `could not create incoming: ${account.trackId}, ${response.title}, ${balance}`;
                  Sentry.captureMessage(errorMsg, error);
                  console.log(errorMsg);
                }
              }
            }
            break;
          case AccountType.PRIVAT:
            console.log({
              success: false,
              message: `Type is not yet supported: ${account.type}`,
            });
            break;
          default:
            console.log({
              success: false,
              message: `Invalid type: ${account.type}`,
            });
            break;
        }
      })
    );
  }

  async getRecentAccountIncoming(accountId: number) {
    const cachedRecentIncoming = await this.redisReader.read(
      `${CACHE_KEYS.recentIncoming}-${accountId}`
    );
    if (cachedRecentIncoming) {
      // console.log('CACHE: read recent incoming', accountId);
      return cachedRecentIncoming;
    }

    const recentIncoming = await this.prisma.accountIncoming.findFirst({
      where: { accountId },
      orderBy: { trackedAt: 'desc' },
    });

    console.log('DB: read recent incoming and updated cache', accountId);
    this.redisReader.write(`${CACHE_KEYS.recentIncoming}-${accountId}`, recentIncoming);
    return recentIncoming;
  }

  isAccountOld(account) {
    if (!account?.accountIncomings?.[0] && this.wasTwoWeeksAgo(account?.createdAt)) {
      return true;
    }

    if (this.wasTwoWeeksAgo(account?.accountIncomings?.[0]?.createdAt)) {
      return true;
    }

    return this.wasOneMonthAgo(account?.createdAt);
  }

  async activateAccount(id: number) {
    await this.prisma.account.update({
      where: { id },
      data: { isActive: true },
    });
    await this.invalidateCachedActiveAccounts();
  }

  // async updateAccount(id: number) {}

  async deactivateAccountByTrackId(trackId: string) {
    const account = await this.prisma.account.findFirst({ where: { trackId: trackId } });
    if (!account) {
      console.log(`account for deactivation not found: ${trackId}`);
      return;
    }

    const jar = await this.checkMono(trackId);

    if (!account.isActive) {
      console.log(`account is already deactivated: ${jar.title} (${trackId})`);
      return;
    }

    await this.deactivateAccount(account.id);
    await this.invalidateCachedActiveAccounts();
    console.log(`account deactivated: ${jar.title} (${trackId})`);
  }

  async deactivateAccount(id: number) {
    await this.prisma.account.update({
      where: { id },
      data: { isActive: false },
    });
  }

  /**
   * Creates a file with the given name and writes the provided text if it does not exist.
   * @param fileName The name of the file to create.
   * @param text The text to write into the file.
   */
  async cacheData(fileName: string, text: string) {
    const filePath = `tmp/${fileName}`;
    try {
      await fs.mkdir('tmp', { recursive: true });
      await fs.access(filePath);
      // File exists, do nothing
    } catch {
      // File does not exist, create and write text
      await fs.writeFile(filePath, text, { encoding: 'utf-8' });
      console.log(`File created: ${filePath}`);
    }
  }

  /**
   * Reads the contents of a file in the tmp folder if it exists.
   * @param fileName The name of the file to read.
   * @returns The file contents as a string, or null if the file does not exist.
   */
  async readCache(fileName: string): Promise<string | null> {
    const filePath = `tmp/${fileName}`;
    try {
      await fs.mkdir('tmp', { recursive: true });
      await fs.access(filePath);
      const content = await fs.readFile(filePath, { encoding: 'utf-8' });
      console.log(`File content: ${content}`);
      return content;
    } catch {
      // File does not exist
      console.log(`File does not exist: ${filePath}`);
      return null;
    }
  }
}
