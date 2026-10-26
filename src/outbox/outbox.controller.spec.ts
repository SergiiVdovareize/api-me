import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { OutboxController } from './outbox.controller';
import { OutboxQueueService } from './outbox-queue.service';

describe('OutboxController', () => {
  let controller: OutboxController;
  let outboxQueueService: jest.Mocked<OutboxQueueService>;
  let configService: jest.Mocked<ConfigService>;

  beforeEach(() => {
    outboxQueueService = {
      processOutboxQueue: jest.fn().mockResolvedValue({
        totalRows: 5,
        processed: 2,
        sent: 2,
        errors: 0,
        details: [],
      }),
    } as any;

    configService = {
      get: jest.fn(),
    } as any;

    controller = new OutboxController(outboxQueueService, configService);
  });

  it('should process queue when no secret is configured', async () => {
    configService.get.mockReturnValue(undefined);

    const result = await controller.processQueuePost();

    expect(result.processed).toBe(2);
    expect(outboxQueueService.processOutboxQueue).toHaveBeenCalled();
  });

  it('should process queue when valid secret is provided via header', async () => {
    configService.get.mockImplementation(key => {
      if (key === 'OUTBOX_SECRET_TOKEN') return 'secret123';
      return undefined;
    });

    const result = await controller.processQueuePost('secret123');

    expect(result.sent).toBe(2);
  });

  it('should throw UnauthorizedException when secret is invalid', async () => {
    configService.get.mockImplementation(key => {
      if (key === 'OUTBOX_SECRET_TOKEN') return 'secret123';
      return undefined;
    });

    await expect(controller.processQueuePost('wrong-secret')).rejects.toThrow(
      UnauthorizedException
    );
  });
});
