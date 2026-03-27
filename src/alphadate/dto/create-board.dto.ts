import { IsArray, IsString, IsNotEmpty, ArrayMinSize } from 'class-validator';

export class CreateBoardDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  partners: string[];
}
