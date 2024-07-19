import { IsNotEmpty, IsString, IsInt, IsPositive, IsDateString } from 'class-validator';

export class CreateVisitDto {
  @IsInt()
  apiType: number;

  @IsNotEmpty({ message: 'Timestamp must be set' })
  @IsDateString()
  timestamp: number;
}