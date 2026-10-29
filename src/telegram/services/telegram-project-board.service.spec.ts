import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { TelegramProjectBoardService } from './telegram-project-board.service';

describe('TelegramProjectBoardService', () => {
  let service: TelegramProjectBoardService;
  let configService: jest.Mocked<Partial<ConfigService>>;

  beforeEach(async () => {
    configService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'GH_PROJECT_TOKEN') return 'ghp_mock_token_123';
        return undefined;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TelegramProjectBoardService,
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<TelegramProjectBoardService>(TelegramProjectBoardService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should return MOCK_ITEM_ID if token is not configured', async () => {
    (configService.get as jest.Mock).mockReturnValue(undefined);
    const result = await service.createDraftItem('Test Title', 'Test Body');
    expect(result.itemId).toBe('MOCK_ITEM_ID');
    expect(result.url).toBe('https://github.com/users/SergiiVdovareize/projects/4');
  });

  it('should call GitHub GraphQL API and return created project item ID and direct URL', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        data: {
          addProjectV2DraftIssue: {
            projectItem: {
              id: 'PVTI_123456789',
              databaseId: 1001,
            },
          },
        },
      }),
    } as any);

    const result = await service.createDraftItem('Test Title', 'Test Body');
    expect(result.itemId).toBe('PVTI_123456789');
    expect(result.databaseId).toBe(1001);
    expect(result.url).toBe('https://github.com/users/SergiiVdovareize/projects/4?pane=issue&itemId=1001');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.github.com/graphql',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer ghp_mock_token_123',
        }),
      })
    );
  });

  it('should fallback to GITHUB_TOKEN and handle missing databaseId', async () => {
    (configService.get as jest.Mock).mockImplementation((key: string) => {
      if (key === 'GITHUB_TOKEN') return 'ghp_fallback_token';
      return undefined;
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        data: {
          addProjectV2DraftIssue: {
            projectItem: {
              id: 'PVTI_fallback_999',
            },
          },
        },
      }),
    } as any);

    const result = await service.createDraftItem('Fallback', 'Body');
    expect(result.itemId).toBe('PVTI_fallback_999');
    expect(result.databaseId).toBeUndefined();
    expect(result.url).toBe('https://github.com/users/SergiiVdovareize/projects/4');
  });

  it('should throw an error when GitHub returns non-ok HTTP status', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: jest.fn().mockResolvedValue('Bad credentials'),
    } as any);

    await expect(service.createDraftItem('Test', 'Body')).rejects.toThrow(
      'Failed to create draft issue: HTTP 401'
    );
  });

  it('should throw an error when GitHub returns GraphQL errors', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        errors: [{ message: 'Project not found' }],
      }),
    } as any);

    await expect(service.createDraftItem('Test', 'Body')).rejects.toThrow(
      'GitHub GraphQL mutation error: Project not found'
    );
  });
});
