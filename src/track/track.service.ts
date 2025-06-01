import * as Sentry from '@sentry/nestjs';
import { env } from 'process';
import { Injectable } from '@nestjs/common';
import { AccountType } from 'src/models/enums/account-type.enum';
import { PrismaService } from 'src/prisma.service';
import { JarResponse, JarStatus } from './types';
import { AnalyticsService } from 'src/analytics/analytics.service';
import { BlobReader } from 'src/common/helpers/blobReader';
import { promises as fs } from 'fs';

const useBlobStorage = false;

const BLOB_FILE_NAMES = {
  activeAccounts: `${env.HOST}-active-track-accounts`,
  recentIncoming: `${env.HOST}-recent-incoming`,
};

@Injectable()
export class TrackService {
  constructor(
    private prisma: PrismaService,
    private readonly analyticsService: AnalyticsService,
    private readonly blobReader: BlobReader
  ) {}

  findAll() {
    return `This action returns all track`;
  }

  async invalidateBlobActiveAccounts() {
    if (!useBlobStorage) {
      return;
    }
    console.log('invalidating blob active accounts');
    this.blobReader.delete(BLOB_FILE_NAMES.activeAccounts);
  }

  async invalidateBlobRecentIncoming(accountId: number) {
    if (!useBlobStorage) {
      return;
    }
    console.log('invalidating blob recent incoming', accountId);
    this.blobReader.delete(`${BLOB_FILE_NAMES.recentIncoming}-${accountId}`);
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
    const content = await this.readCache('bob.txt');
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

    const json = await response.json();
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
          status: json.jarStatus,
          ownerName: json.ownerName,
          extra: content
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

    await this.invalidateBlobActiveAccounts();

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
    // const blobActiveAccounts = null;
    if (useBlobStorage) {
      const blobActiveAccounts = await this.blobReader.read(BLOB_FILE_NAMES.activeAccounts);
      if (blobActiveAccounts) {
        console.log('BLOB: read active accounts');
        return blobActiveAccounts;
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

    if (useBlobStorage) {
      this.blobReader.create(BLOB_FILE_NAMES.activeAccounts, activeAccounts);
      console.log('DB: read active accounts and updated blob');
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
          this.analyticsService.trackEvent('TrackingAccountDeactivated', { account });
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

    await this.cacheData('bob.txt', 'bob is here');

    await Promise.all(
      accounts.map(async account => {
        switch (account.type) {
          case AccountType.MONO:
            const response = await this.checkMono(account.trackId);
            if (this.isJarActiveStatus(response)) {
              if (!response.balance) {
                console.log(`no balance: ${account.id} - ${response.balance}`);
                return;
              }

              let needUpdateIncoming = false;
              if (useBlobStorage) {
                const recentIncoming = await this.getRecentAccountIncoming(account.id);
                needUpdateIncoming = !recentIncoming || response.balance !== recentIncoming.balance;
              } else {
                needUpdateIncoming = response.balance !== account.accountIncomings?.[0]?.balance;
              }

              if (needUpdateIncoming) {
                try {
                  const incoming = await this.prisma.accountIncoming.create({
                    data: {
                      accountId: account.id,
                      balance: response.balance,
                      trackedAt: new Date(),
                    },
                  });

                  this.invalidateBlobRecentIncoming(account.id);
                  console.log(
                    `updated balance: ${response.title} (${account.trackId}) - ${incoming.balance} (added ${Math.ceil((incoming.balance - account.accountIncomings?.[0]?.balance) / 100)})`
                  );
                } catch (error) {
                  const errorMsg = `could not create incoming: ${account.trackId}, ${response.title}, ${response.balance}`;
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
    const blobRecentIncoming = await this.blobReader.read(
      `${BLOB_FILE_NAMES.recentIncoming}-${accountId}`
    );
    if (blobRecentIncoming) {
      console.log('BLOB: read recent incoming', accountId);
      return blobRecentIncoming;
    }

    const recentIncoming = await this.prisma.accountIncoming.findFirst({
      where: { accountId },
      orderBy: { trackedAt: 'desc' },
    });

    console.log('DB: read recent incoming and updated blob', accountId);
    this.blobReader.create(`${BLOB_FILE_NAMES.recentIncoming}-${accountId}`, recentIncoming);
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
    await this.invalidateBlobActiveAccounts();
  }

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
    await this.invalidateBlobActiveAccounts();
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
