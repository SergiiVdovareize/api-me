import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class WhatsappProjectBoardService {
  private readonly logger = new Logger(WhatsappProjectBoardService.name);
  private readonly defaultProjectId = 'PVT_kwHOADkqQ84BosFc'; // Project Board #4 (AI Tasks Flow)

  constructor(private readonly configService: ConfigService) {}

  /**
   * Creates a draft issue card directly on the GitHub Project Board.
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
        'User-Agent': 'api-me-whatsapp-bot',
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
      this.logger.error(`GitHub GraphQL API error (${res.status}): ${text}`);
      throw new Error(`Failed to create draft item on GitHub Project: HTTP ${res.status}`);
    }

    const json = (await res.json()) as any;
    if (json.errors && json.errors.length > 0) {
      const err = json.errors[0]?.message || 'Unknown GraphQL error';
      this.logger.error(`GitHub GraphQL error: ${err}`);
      throw new Error(`GraphQL error creating draft item: ${err}`);
    }

    const itemId = json.data?.addProjectV2DraftIssue?.projectItem?.id;
    this.logger.log(`Created GitHub Project Draft Item: ${itemId} ("${title}")`);
    return itemId;
  }
}
