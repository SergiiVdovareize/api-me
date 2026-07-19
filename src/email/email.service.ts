import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly resend: Resend | null = null;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('RESEND_API_KEY');
    if (apiKey) {
      this.resend = new Resend(apiKey);
    } else {
      this.logger.warn('RESEND_API_KEY is not defined. Email service will not be functional.');
    }
  }

  private maskEmail(email: string): string {
    const [local, domain] = email.split('@');
    if (!domain) return '[INVALID EMAIL]';
    return `${local.charAt(0)}***@${domain}`;
  }

  async sendEmail(to: string, subject: string, html: string, from?: string) {
    if (!this.resend) {
      this.logger.warn('Skipping email send as Resend is not configured.');
      return null;
    }

    const sender = from || this.configService.get<string>('RESEND_FROM_EMAIL');
    if (!sender) {
      this.logger.error('Sender email is not configured (RESEND_FROM_EMAIL is missing).');
      throw new Error('Sender email is not configured.');
    }

    const maskedTo = this.maskEmail(to);

    try {
      this.logger.log(
        `Sending email to ${maskedTo} with subject: "${subject}" from sender: "${sender}"`
      );
      const { data, error } = await this.resend.emails.send({
        from: sender,
        to,
        subject,
        html,
      });

      if (error) {
        this.logger.error(`Failed to send email to ${maskedTo}: ${error.message}`, error);
        throw new Error(`Email sending failed: ${error.message}`);
      }

      this.logger.log(`Email sent successfully: ${data?.id}`);
      return data;
    } catch (err) {
      this.logger.error(
        `Unexpected error while sending email to ${maskedTo}: ${err.message}`,
        err.stack
      );
      throw err;
    }
  }
}
