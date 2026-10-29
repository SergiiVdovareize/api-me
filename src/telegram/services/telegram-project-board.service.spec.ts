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
});
