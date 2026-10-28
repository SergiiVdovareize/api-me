import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class TelegramProjectBoardService {
  private readonly logger = new Logger(TelegramProjectBoardService.name);
  private readonly defaultProjectId = 'PVT_kwHOADkqQ84BosFc'; // Project Board #4 (AI Tasks Flow)

  constructor(private readonly configService: ConfigService) {}

  /**
   * Creates a draft issue card directly on the GitHub Project Board #4.
   */
  async createDraftItem(
    title: string,
    body: string,
    projectId: string = this.defaultProjectId
  ): Promise<string> {
    const token =
      this.configService.get<string>('GH_PROJECT_TOKEN')?.trim() ||
      this.configService.get<string>('GITHUB_TOKEN')?.trim();

    if (!token) {
      this.logger.warn('GH_PROJECT_TOKEN / GITHUB_TOKEN not configured. Skipping live project item creation.');
      return 'MOCK_ITEM_ID';
    }

    const mutation = `
      mutation AddDraftItem($projectId: ID!, $title: String!, $body: String!) {
        addProjectV2DraftIssue(input: {
          projectId: $projectId
          title: $title
          body: $body
        }) {
          projectItem {
            id
          }
        }
      }
    `;

    const res = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'api-me-telegram-bot',
      },
      body: JSON.stringify({
        query: mutation,
        variables: {
          projectId,
          title,
          body,
        },
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      this.logger.error(`GitHub GraphQL request failed (HTTP ${res.status}): ${text}`);
      throw new Error(`Failed to create draft issue: HTTP ${res.status}`);
    }

    const json = (await res.json()) as any;
    if (json.errors && json.errors.length > 0) {
      const errMsg = json.errors.map((e: any) => e.message).join('; ');
      this.logger.error(`GraphQL mutation errors: ${errMsg}`);
      throw new Error(`GitHub GraphQL mutation error: ${errMsg}`);
    }

    const itemId = json.data?.addProjectV2DraftIssue?.projectItem?.id;
    this.logger.log(`Created draft item on Project Board ${projectId}: ${itemId} ("${title}")`);
    return itemId;
  }
}
