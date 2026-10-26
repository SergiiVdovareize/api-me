import {
  Controller,
  Post,
  Get,
  Headers,
  Query,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OutboxQueueService, OutboxProcessResult } from './outbox-queue.service';

@Controller('outbox')
export class OutboxController {
  private readonly logger = new Logger(OutboxController.name);

  constructor(
    private readonly outboxQueueService: OutboxQueueService,
    private readonly configService: ConfigService
  ) {}

  private verifyAuth(providedSecret?: string): void {
    const configuredSecret =
      this.configService.get<string>('OUTBOX_SECRET_TOKEN') ||
      this.configService.get<string>('CRON_SECRET');

    if (configuredSecret && providedSecret !== configuredSecret) {
      throw new UnauthorizedException('Invalid or missing outbox authentication token');
    }
  }

  @Post('process')
  async processQueuePost(
    @Headers('x-outbox-secret') headerSecret?: string,
    @Query('secret') querySecret?: string
  ): Promise<OutboxProcessResult> {
    this.verifyAuth(headerSecret || querySecret);
    return this.outboxQueueService.processOutboxQueue();
  }

  @Get('process')
  async processQueueGet(
    @Headers('x-outbox-secret') headerSecret?: string,
    @Query('secret') querySecret?: string
  ): Promise<OutboxProcessResult> {
    this.verifyAuth(headerSecret || querySecret);
    return this.outboxQueueService.processOutboxQueue();
  }
}
