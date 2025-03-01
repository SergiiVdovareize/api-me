import { Controller, Get, Post, Body, Patch, Param, Delete, Query } from '@nestjs/common';
import { TrackService } from './track.service';

@Controller('track')
export class TrackController {
  constructor(private readonly trackService: TrackService) {}

  @Get('mono/:id')
  async findOne(@Param('id') id: string, @Query('plain') plain: string) {
    return await this.trackService.findOne(id, ["true", "1"].includes(plain));
  }

}
