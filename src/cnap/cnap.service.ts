import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleSheetsService } from '../series-tracker/services/google-sheets.service';
import {
  CnapCheckResponse,
  CnapCheckResult,
  CnapServiceResult,
  CnapBranchResult,
  CnapSlotDay,
} from './interfaces/cnap.interface';

const CNAP_API_BASE = 'https://cnap_lviv.qsolutions.com.ua:2651/prelim';

@Injectable()
export class CnapService {
  private readonly logger = new Logger(CnapService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly googleSheetsService: GoogleSheetsService
  ) {}

  /**
   * Fetches available jobs (services) for the given job group (category)
   */
  async getJobsByCategory(category: string): Promise<string[]> {
    const url = `${CNAP_API_BASE}/GetJobsByGroupName?jobGroupName=${encodeURIComponent(category)}`;
    this.logger.debug(`Fetching jobs from: ${url}`);

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to fetch jobs for "${category}": HTTP ${res.status}`);
    }

    const data = await res.json();
    if (!data.isSucceeded || !Array.isArray(data.result)) {
      throw new Error(`CNAP API returned error or invalid format: ${JSON.stringify(data.errors)}`);
    }

    return data.result;
  }

  /**
   * Fetches branches and their available slots for a job and group
   */
  async getBranchesForJob(jobName: string, category: string): Promise<any[]> {
    const url = `${CNAP_API_BASE}/GetBranchesByJobAndGroupName?jobName=${encodeURIComponent(jobName)}&jobGroupName=${encodeURIComponent(category)}`;
    this.logger.debug(`Fetching branches from: ${url}`);

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to fetch branches for "${jobName}": HTTP ${res.status}`);
    }

    const data = await res.json();
    if (!data.isSucceeded || !Array.isArray(data.result)) {
      throw new Error(`CNAP API returned error or invalid format: ${JSON.stringify(data.errors)}`);
    }

    return data.result;
  }

  /**
   * Checks slot availability for given category, optional service and location
   */
  async checkSlots(options: {
    category?: string;
    service?: string;
    location?: string;
  }): Promise<CnapCheckResult> {
    const category = (options.category || 'Паспортні послуги').trim();
    const targetLocation = (options.location || 'Хвильового').trim();
    const serviceFilter = options.service?.trim();

    this.logger.log(
      `Checking CNAP slots: category="${category}", location="${targetLocation}", service="${serviceFilter || 'ALL'}"`
    );

    const availableJobs = await this.getJobsByCategory(category);
    if (availableJobs.length === 0) {
      return {
        category,
        targetLocation,
        hasSlots: false,
        services: [],
        message: `Для категорії "${category}" наразі відсутні доступні послуги або онлайн-запис закритий.`,
      };
    }

    const jobsToCheck = serviceFilter
      ? availableJobs.filter(j => j.toLowerCase().includes(serviceFilter.toLowerCase()))
      : availableJobs;

    if (jobsToCheck.length === 0) {
      return {
        category,
        targetLocation,
        hasSlots: false,
        services: [],
        message: `Послугу "${serviceFilter}" не знайдено серед доступних: ${availableJobs.join(', ')}`,
      };
    }

    const servicesResult: CnapServiceResult[] = [];
    let overallHasSlots = false;

    for (const jobName of jobsToCheck) {
      const rawBranches = await this.getBranchesForJob(jobName, category);

      // Filter branches by target location (e.g. "Хвильового")
      const matchedBranches = rawBranches.filter(b =>
        b.name?.toLowerCase().includes(targetLocation.toLowerCase())
      );

      const branchResults: CnapBranchResult[] = matchedBranches.map(b => {
        const rawFreeSlots: any[] = b.freeSlots || [];
        const slots: CnapSlotDay[] = rawFreeSlots
          .filter(s => Array.isArray(s.freeTimeSlots) && s.freeTimeSlots.length > 0)
          .map(s => {
            const dateStr = s.workDaySlot ? s.workDaySlot.split('T')[0] : 'Дата';
            return {
              date: dateStr,
              times: s.freeTimeSlots.map((t: string) => t.slice(0, 5)), // format "09:00"
            };
          });

        const hasSlots = slots.length > 0;
        if (hasSlots) {
          overallHasSlots = true;
        }

        return {
          guid: b.guid,
          name: b.name,
          address: b.address || b.name,
          available: hasSlots,
          slots,
        };
      });

      servicesResult.push({
        serviceName: jobName,
        branches: branchResults,
        available: branchResults.some(b => b.available),
      });
    }

    let summaryMessage = '';
    if (overallHasSlots) {
      summaryMessage = `Знайдено вільні слоти для підрозділу на вул. ${targetLocation}!`;
    } else {
      summaryMessage = `Вільних місць для підрозділу на вул. ${targetLocation} наразі немає.`;
    }

    return {
      category,
      targetLocation,
      hasSlots: overallHasSlots,
      services: servicesResult,
      message: summaryMessage,
    };
  }

  /**
   * Generates formatted HTML message for Telegram
   */
  formatTelegramReport(result: CnapCheckResult): string {
    const bookingUrl = 'https://cnap-lviv.qsolutions.com.ua:2657/booking';

    if (result.hasSlots) {
      let report = `🟢 <b>ЦНАП Львів: Є вільні місця!</b>\n\n`;
      report += `📂 Категорія: <b>${this.escapeHtml(result.category)}</b>\n`;
      report += `🏢 Підрозділ: <b>вул. ${this.escapeHtml(result.targetLocation)}</b>\n\n`;

      for (const service of result.services) {
        if (!service.available) continue;

        report += `📋 <b>${this.escapeHtml(service.serviceName)}</b>\n`;

        for (const branch of service.branches) {
          if (!branch.available) continue;

          for (const slot of branch.slots) {
            report += `📅 <b>${slot.date}</b>: ${slot.times.join(', ')}\n`;
          }
        }
        report += `\n`;
      }

      report += `🔗 <a href="${bookingUrl}">Перейти до запису</a>`;
      return report.trim();
    }

    // No slots
    let report = `🔴 <b>ЦНАП Львів: Вільних місць немає</b>\n\n`;
    report += `📂 Категорія: <b>${this.escapeHtml(result.category)}</b>\n`;
    report += `🏢 Підрозділ: <b>вул. ${this.escapeHtml(result.targetLocation)}</b>\n\n`;
    report += `<i>${this.escapeHtml(result.message)}</i>\n`;
    report += `<i>Попередній запис відкривається щодня о 07:00.</i>\n\n`;
    report += `🔗 <a href="${bookingUrl}">Онлайн-запис ЦНАП</a>`;
    return report.trim();
  }

  /**
   * Returns the current hour (0..23) in Europe/Kyiv timezone
   */
  getKyivHour(date = new Date()): number {
    try {
      const parts = new Intl.DateTimeFormat('en-GB', {
        hour: 'numeric',
        hour12: false,
        timeZone: 'Europe/Kyiv',
      }).formatToParts(date);
      const hourPart = parts.find(p => p.type === 'hour');
      return hourPart ? parseInt(hourPart.value, 10) : (date.getUTCHours() + 3) % 24;
    } catch {
      return (date.getUTCHours() + 3) % 24;
    }
  }

  /**
   * Checks slots and conditionally pushes a report to TELEGRAM_OUTBOX_SPREADSHEET_ID:
   * - If slots ARE available: ALWAYS sends notification.
   * - If slots are NOT available: skips notification (unless forced).
   */
  async checkAndNotify(options: {
    category?: string;
    service?: string;
    location?: string;
    notify?: boolean | string;
    force?: boolean | string;
    chatId?: string;
  }): Promise<CnapCheckResponse> {
    const result = await this.checkSlots({
      category: options.category,
      service: options.service,
      location: options.location,
    });

    const report = this.formatTelegramReport(result);
    let telegramQueued = false;
    let telegramSkipReason: string | undefined;

    const notifyParam = options.notify ?? true;
    const isNotifyDisabled = notifyParam === false || notifyParam === 'false';

    const isForced =
      options.force === true ||
      options.force === 'true' ||
      notifyParam === 'force' ||
      notifyParam === 'always';

    if (isNotifyDisabled) {
      telegramSkipReason = 'Сповіщення вимкнено параметром notify=false.';
    } else if (result.hasSlots) {
      // Є вільні місця — надсилаємо повідомлення щоразу!
      try {
        await this.googleSheetsService.appendMessageToOutbox(report, options.chatId);
        telegramQueued = true;
        this.logger.log(`[CNAP] 🎉 Знайдено слоти! Повідомлення додано в Telegram Outbox.`);
      } catch (error: any) {
        this.logger.error(`Failed to queue CNAP report to Telegram: ${error.message}`, error.stack);
      }
    } else if (isForced) {
      // Примусовий запит (force=true) — надсилаємо навіть якщо місць немає
      try {
        await this.googleSheetsService.appendMessageToOutbox(report, options.chatId);
        telegramQueued = true;
        this.logger.log(`[CNAP] Примусове повідомлення про стан слотів надіслано.`);
      } catch (error: any) {
        this.logger.error(`Failed to queue CNAP report to Telegram: ${error.message}`, error.stack);
      }
    } else {
      telegramSkipReason = 'Вільних місць немає. Сповіщення не надсилається.';
      this.logger.log(`[CNAP] ${telegramSkipReason}`);
    }

    return {
      success: true,
      hasSlots: result.hasSlots,
      category: result.category,
      targetLocation: result.targetLocation,
      telegramQueued,
      telegramSkipReason,
      message: result.message,
      report,
      data: result,
    };
  }

  private escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}
