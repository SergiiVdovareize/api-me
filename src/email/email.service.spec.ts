import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EmailService } from './email.service';
import { Resend } from 'resend';

const mockSend = jest.fn();
jest.mock('resend', () => {
  return {
    Resend: jest.fn().mockImplementation(() => {
      return {
        emails: {
          send: mockSend,
        },
      };
    }),
  };
});

describe('EmailService', () => {
  let service: EmailService;
  let configService: jest.Mocked<ConfigService>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const setupService = async (env: Record<string, string>) => {
    configService = {
      get: jest.fn().mockImplementation((key: string) => env[key]),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailService,
        {
          provide: ConfigService,
          useValue: configService,
        },
      ],
    }).compile();

    service = module.get<EmailService>(EmailService);
  };

  it('should be defined', async () => {
    await setupService({ RESEND_API_KEY: 'test-key' });
    expect(service).toBeDefined();
  });

  it('should initialize Resend if API key is provided', async () => {
    await setupService({ RESEND_API_KEY: 'test-key' });
    expect(Resend).toHaveBeenCalledWith('test-key');
  });

  it('should warn and skip initialization if API key is missing', async () => {
    await setupService({});
    expect(Resend).not.toHaveBeenCalled();
  });

  describe('sendEmail', () => {
    it('should return null and warn if Resend is not configured', async () => {
      await setupService({});
      const result = await service.sendEmail('to@example.com', 'Sub', 'Body');
      expect(result).toBeNull();
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('should throw an error if sender email is not configured/passed', async () => {
      await setupService({ RESEND_API_KEY: 'test-key' });
      await expect(service.sendEmail('to@example.com', 'Sub', 'Body')).rejects.toThrow(
        'Sender email is not configured.'
      );
    });

    it('should send email successfully when RESEND_FROM_EMAIL is set', async () => {
      await setupService({ RESEND_API_KEY: 'test-key', RESEND_FROM_EMAIL: 'from@example.com' });
      mockSend.mockResolvedValue({ data: { id: 'msg-123' }, error: null });

      const result = await service.sendEmail('to@example.com', 'Sub', 'Body');
      expect(result).toEqual({ id: 'msg-123' });
      expect(mockSend).toHaveBeenCalledWith({
        from: 'from@example.com',
        to: 'to@example.com',
        subject: 'Sub',
        html: 'Body',
      });
    });

    it('should send email successfully when from parameter is passed directly', async () => {
      await setupService({ RESEND_API_KEY: 'test-key' });
      mockSend.mockResolvedValue({ data: { id: 'msg-456' }, error: null });

      const result = await service.sendEmail('to@example.com', 'Sub', 'Body', 'param@example.com');
      expect(result).toEqual({ id: 'msg-456' });
      expect(mockSend).toHaveBeenCalledWith({
        from: 'param@example.com',
        to: 'to@example.com',
        subject: 'Sub',
        html: 'Body',
      });
    });

    it('should throw an error when Resend returns an error structure', async () => {
      await setupService({ RESEND_API_KEY: 'test-key', RESEND_FROM_EMAIL: 'from@example.com' });
      mockSend.mockResolvedValue({ data: null, error: { message: 'Some API Error' } });

      await expect(service.sendEmail('to@example.com', 'Sub', 'Body')).rejects.toThrow(
        'Email sending failed: Some API Error'
      );
    });

    it('should throw an error when Resend call throws an unexpected error', async () => {
      await setupService({ RESEND_API_KEY: 'test-key', RESEND_FROM_EMAIL: 'from@example.com' });
      mockSend.mockRejectedValue(new Error('Network failure'));

      await expect(service.sendEmail('to@example.com', 'Sub', 'Body')).rejects.toThrow(
        'Network failure'
      );
    });
  });
});
