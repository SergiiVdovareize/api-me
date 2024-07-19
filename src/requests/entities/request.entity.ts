import { Request } from '@prisma/client';

export class RequestEntity implements Request {
  id: number;

  apiType: number;

  createdAt: Date;
}