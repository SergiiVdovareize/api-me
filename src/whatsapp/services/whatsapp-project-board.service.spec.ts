import { WhatsappProjectBoardService } from './whatsapp-project-board.service';
import { ConfigService } from '@nestjs/config';

describe('WhatsappProjectBoardService', () => {
  let service: WhatsappProjectBoardService;
  let configService: ConfigService;
  const originalFetch = global.fetch;

  beforeEach(() => {
    configService = {
      get: jest.fn(),
    } as any;
    service = new WhatsappProjectBoardService(configService);
    jest.clearAllMocks();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('should return mock item ID if GH_PROJECT_TOKEN is missing', async () => {
    (configService.get as jest.Mock).mockReturnValue(undefined);

    const itemId = await service.createDraftItem('Test Title', 'Test Body');
    expect(itemId).toBe('MOCK_ITEM_ID');
  });

  it('should create draft item on GitHub Project Board #4 when token is configured', async () => {
    (configService.get as jest.Mock).mockImplementation((key: string) => {
      if (key === 'GH_PROJECT_TOKEN') return 'ghp_test_token';
      return undefined;
    });

    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValueOnce({
        data: {
          addProjectV2DraftIssue: {
            projectItem: {
              id: 'PVTI_new_item_123',
            },
          },
        },
      }),
    } as any);

    const itemId = await service.createDraftItem('feat(auth): add biometrics', '## Overview\nTest');
    expect(itemId).toBe('PVTI_new_item_123');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.github.com/graphql',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer ghp_test_token',
        }),
      })
    );
  });

  it('should throw an error when GitHub GraphQL API returns an error response', async () => {
    (configService.get as jest.Mock).mockReturnValue('ghp_test_token');

    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValueOnce({
        errors: [{ message: 'Project not found' }],
      }),
    } as any);

    await expect(service.createDraftItem('Title', 'Body')).rejects.toThrow(
      'GraphQL error creating draft item: Project not found'
    );
  });
});
