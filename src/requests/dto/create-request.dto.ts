import { IsNumber } from 'class-validator';

export class CreateRequestDto {
  @IsNumber()
  apiType: number;
}
