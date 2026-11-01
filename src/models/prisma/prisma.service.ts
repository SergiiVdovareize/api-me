import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';

export const TRANSIENT_ERROR_CODES = ['P1001', 'P1002', 'P1008', 'P1017'];
export const MAX_CONNECTION_RETRIES = 2;
export const RETRY_BASE_DELAY_MS = 250;

export function isTransientConnectionError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string' && TRANSIENT_ERROR_CODES.includes(code)) {
    return true;
  }

  if (error instanceof Prisma.PrismaClientInitializationError) {
    return true;
  }

  const msg = (error as { message?: unknown }).message;
  if (typeof msg === 'string') {
    const lower = msg.toLowerCase();
    return (
      lower.includes('server has closed the connection') ||
      lower.includes('connection closed') ||
      lower.includes('connection terminated') ||
      lower.includes('econnreset') ||
      lower.includes('etimedout') ||
      lower.includes('closed the connection') ||
      lower.includes('terminating connection due to administrator command')
    );
  }

  return false;
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super();

    const client = this;
    const logger = this.logger;

    return client.$extends({
      query: {
        $allOperations: async ({ model, operation, args, query }) => {
          let attempt = 0;

          while (true) {
            try {
              return await query(args);
            } catch (err: unknown) {
              attempt++;

              if (attempt <= MAX_CONNECTION_RETRIES && isTransientConnectionError(err)) {
                const errorCode =
                  (err as { code?: string })?.code ||
                  (err instanceof Prisma.PrismaClientKnownRequestError ? err.code : 'TRANSIENT_ERR');
                const errorMessage = (err as Error)?.message || String(err);

                logger.warn(
                  `[PrismaService] Transient connection error (${errorCode}) on ${model || 'query'}.${operation}: ${errorMessage}. Retrying attempt ${attempt}/${MAX_CONNECTION_RETRIES}...`
                );

                try {
                  await client.$disconnect();
                } catch {
                  // ignore disconnect failure during cleanup
                }

                await new Promise((resolve) =>
                  setTimeout(resolve, RETRY_BASE_DELAY_MS * attempt)
                );
                continue;
              }

              throw err;
            }
          }
        },
      },
    }) as unknown as PrismaService;
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
