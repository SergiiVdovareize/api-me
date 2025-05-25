import { Controller, Get } from '@nestjs/common';
import { BlobService } from './blob.service';

@Controller('blob')
export class BlobController {
  constructor(private readonly blobService: BlobService) {}

  @Get('refresh')
  async refresh() {
    await this.blobService.refresh();
    return { success: true };
  }
}
