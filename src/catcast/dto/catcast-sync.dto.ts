import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
  ArrayMaxSize,
  IsIn,
} from 'class-validator';

export class InitProfileDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  deviceId: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  deviceName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  browser?: string;
}

export class PairInitDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  deviceId: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  deviceName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  browser?: string;
}

export class PairConfirmDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(16)
  code: string;
}

export class PairAcceptDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(16)
  code: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  pairSecret: string;

  @IsBoolean()
  accept: boolean;
}

export class SyncHistoryItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  mediaKey: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  url?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  canonicalId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  orig?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  poster?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  season?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  episode?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  episodeName?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(86400 * 10)
  currentTime?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(86400 * 10)
  duration?: number;

  @IsOptional()
  @IsBoolean()
  completed?: boolean;

  @IsOptional()
  @IsObject()
  watchedEpisodes?: Record<string, number>;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  voice?: string;

  @IsInt()
  @Min(0)
  ts: number;
}

export class SyncFavoriteItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  mediaKey: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  url?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  canonicalId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  orig?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  poster?: string;

  @IsInt()
  @Min(0)
  ts: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  deletedAt?: number | null;
}

export class SyncSearchHistoryDto {
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  queries: string[];

  @IsInt()
  @Min(0)
  updatedAt: number;
}

export class SyncPushDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  history?: SyncHistoryItemDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  favorites?: SyncFavoriteItemDto[];

  @IsOptional()
  @IsInt()
  @Min(0)
  historyClearedTs?: number;

  @IsOptional()
  @ValidateNested()
  searchHistory?: SyncSearchHistoryDto;
}

export class UnlinkDeviceQueryDto {
  @IsOptional()
  @IsIn(['unlink', 'revoke'])
  mode?: 'unlink' | 'revoke';
}
