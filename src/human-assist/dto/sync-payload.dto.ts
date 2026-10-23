import { IsNotEmpty, IsObject, IsOptional, IsNumber } from 'class-validator';

export class SyncPayloadDto {
  @IsNotEmpty({ message: 'Invalid payload: data object is required' })
  @IsObject({ message: 'Invalid payload: data must be an object' })
  data: Record<string, any>;

  @IsOptional()
  @IsNumber({}, { message: 'clientUpdatedAt must be a valid number' })
  clientUpdatedAt?: number;
}
